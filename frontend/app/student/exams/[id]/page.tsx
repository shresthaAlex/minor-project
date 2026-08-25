"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/src/services/api";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import { useAuth } from "@/src/contexts/AuthContext";
import ProctoringMonitor from "@/src/components/ProctoringMonitor";

export default function TakeExamPage() {
  const { id: examId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const fullscreenExitedRef = useRef(false);
  const fsExitCountRef = useRef(0);
  const handleSubmitRef = useRef<(() => void) | null>(null);

  const [exam, setExam] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== "undefined" && !!document.fullscreenElement
  );
  const [fullscreenExits, setFullscreenExits] = useState(0);
  const [tabWarningVisible, setTabWarningVisible] = useState(false);
  const pendingTabWarningRef = useRef(false);
  const tabHiddenAtRef = useRef(0);
  const tabSwitchCountRef = useRef(0);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [allowWindowMode, setAllowWindowMode] = useState(false);
  const mounted = typeof document !== "undefined";
  const tabWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!examId || !user) return;
    Promise.all([api.getExam(examId), api.mySessionForExam(examId)])
      .then(([e, s]) => {
        if (!s) { setError("You are not registered for this exam."); return; }
        setExam(e);
        setSession(s);
        if (s.status === "submitted") { router.push(`/student/results?session=${s.id}`); return; }
        if (s.status === "registered") { router.replace(`/student/exams/${examId}/verify`); return; }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [examId, router, user]);

  useEffect(() => {
    if (session?.status !== "registered" && session?.status !== "in_progress") return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        setError("Camera access denied. Camera is required for this exam.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    if (!session || session.status === "submitted") return;
    const handleVisibility = () => {
      if (document.hidden) {
        // Record the exact moment the student left, and bump the occurrence
        // counter (ref so the return handler can read the fresh value).
        tabHiddenAtRef.current = Date.now();
        tabSwitchCountRef.current += 1;
        setTabSwitches(tabSwitchCountRef.current);
        // Defer showing the warning until the student returns to the exam
        // page — the popup must not expire while they are still away.
        pendingTabWarningRef.current = true;
      } else if (pendingTabWarningRef.current) {
        pendingTabWarningRef.current = false;
        setTabWarningVisible(true);
        if (tabWarningTimerRef.current) clearTimeout(tabWarningTimerRef.current);
        tabWarningTimerRef.current = setTimeout(() => setTabWarningVisible(false), 4000);
        // Every occurrence, including the first warning, is recorded for the
        // administrator. The event carries the exact hidden-at timestamp,
        // the seconds the student stayed away, the occurrence number, and the
        // action taken. No snapshot is captured for tab-switch events.
        const n = tabSwitchCountRef.current;
        const durationSec = Math.max(0, (Date.now() - tabHiddenAtRef.current) / 1000);
        api.logProctoringEvent(
          session.id,
          "tab_switch",
          0,
          undefined,
          {
            timestamp: new Date(tabHiddenAtRef.current).toISOString(),
            occurrence: n,
            duration: Math.round(durationSec * 10) / 10,
            action: n === 1
              ? "warning issued (first tab switch)"
              : "incident recorded (repeated tab switch)",
          }
        ).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session]);

  // ── Fullscreen enforcement ─────────────────────────────────────
  // Leaving fullscreen mid-exam is recorded as a proctoring event and the
  // student is immediately forced back into fullscreen.
  const enterFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen request failed:", err);
    }
    // isFullscreen is kept in sync by the fullscreenchange listener.
  }, []);

  // Best-effort auto-fullscreen: only attempted when the browser grants a
  // user activation (e.g. immediately after the "Start Exam" click that
  // navigated here). Outside a gesture Chrome always rejects the request,
  // so we skip it silently — the gate / read-only banner buttons handle it.
  useEffect(() => {
    if (session?.status === "in_progress" && navigator.userActivation?.isActive) {
      enterFullscreen();
    }
  }, [session?.status, enterFullscreen]);

  useEffect(() => {
    if (!session || session.status !== "in_progress") return;
    const handleFullscreenChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) {
        // Every exit (ESC, F11, browser controls) records the exit and asks
        // the student to confirm: stay in the exam or leave. ESC is not
        // reliably delivered to the page as a keydown in some browsers, so
        // the confirmation dialog is opened from fullscreenchange itself.
        if (!fullscreenExitedRef.current) {
          fullscreenExitedRef.current = true;
          fsExitCountRef.current += 1;
          setFullscreenExits(fsExitCountRef.current);
        }
        // The confirmation dialog is the single fullscreen-exit message.
        setShowLeaveConfirm(true);
      } else {
        // Fullscreen restored — allow the next exit to be recorded and
        // dismiss the exit warning immediately.
        fullscreenExitedRef.current = false;
        setAllowWindowMode(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [session]);

  const stayInExam = () => {
    setShowLeaveConfirm(false);
    enterFullscreen();
  };

  // Leaving fullscreen never ends the exam — the student can keep going
  // in a normal window. The gate overlay is suppressed while in window mode.
  const continueInWindowMode = () => {
    setShowLeaveConfirm(false);
    setAllowWindowMode(true);
  };

  useEffect(() => {
    if (!session || session.status !== "in_progress" || !exam) return;
    const start = session.started_at
      ? new Date(session.started_at).getTime()
      : (exam.start_time ? new Date(exam.start_time).getTime() : Date.now());
    const endTime = start + exam.duration_min * 60000;
    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) handleSubmitRef.current?.();
    };
    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [session, exam]);

  async function handleSubmit() {
    if (submitting || !session) return;
    setSubmitting(true);
    setShowSubmitModal(false);
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      const updated = await api.submitSession(session.id, answers);
      setSession(updated);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch (err: any) {
      setError(err.message || "Failed to submit exam");
      setSubmitting(false);
    }
  }

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  useEffect(() => {
    return () => {
      if (tabWarningTimerRef.current) clearTimeout(tabWarningTimerRef.current);
    };
  }, []);

  if (loading) return (
    <ProtectedRoute role="student">
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-8">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium text-muted-foreground">Loading exam session & proctoring environment...</p>
      </div>
    </ProtectedRoute>
  );

  if (error && !session) return (
    <ProtectedRoute role="student">
      <div className="max-w-md mx-auto my-12 p-6 bg-destructive/10 border border-destructive/20 rounded-2xl text-center">
        <span className="material-symbols-outlined text-4xl text-destructive mb-2">error</span>
        <p className="text-sm font-semibold text-destructive">{error}</p>
      </div>
    </ProtectedRoute>
  );

  if (!exam) return (
    <ProtectedRoute role="student">
      <div className="p-12 text-center text-muted-foreground">Exam not found</div>
    </ProtectedRoute>
  );

  if (session?.status === "submitted") {
    return (
      <ProtectedRoute role="student">
        <div className="min-h-[70vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-5 rounded-2xl border border-border bg-card p-10 shadow-2xl animate-fade-in">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 border-2 border-emerald-500/40">
              <span className="material-symbols-outlined text-4xl text-emerald-500">check_circle</span>
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-foreground">Exam Submitted Successfully</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your responses have been recorded. Your final result will be reviewed and published by the administrator.
              </p>
            </div>
            <div className="pt-3 flex flex-col gap-2.5">
              <button
                onClick={() => router.push(`/student/results?session=${session.id}`)}
                className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-base">visibility</span>
                View Exam Summary
              </button>
              <button
                onClick={() => router.push("/student/exams")}
                className="w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition"
              >
                Return to Exams
              </button>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (session?.status === "in_progress") {
    // Tiered full-screen exit messaging: 1st, 2nd, 3rd+ exit
    const fsMessages = [
      {
        title: "Full-Screen Mode Exited",
        desc: "Please return to full-screen mode to continue your exam. Attempt recorded.",
      },
      {
        title: "Warning: Full-Screen Mode Exited Again",
        desc: "Please return to full-screen mode immediately. Repeated exits may be flagged for review.",
      },
      {
        title: "Repeated Full-Screen Exits",
        desc: "You have exited full-screen mode multiple times. This activity has been flagged for review.",
      },
    ];
    const fsMsg = fsMessages[Math.min(Math.max(fullscreenExits - 1, 0), 2)];
    // Answers can only be selected in fullscreen — outside of it the exam is
    // read-only (the student can view questions but cannot click options).
    const canAnswer = isFullscreen;

    return (
      <ProtectedRoute role="student">
        {!isFullscreen && !showLeaveConfirm && !allowWindowMode && (
          <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex items-center justify-center p-6">
            <div className="max-w-sm w-full text-center space-y-4 rounded-2xl border border-border bg-card p-8 shadow-2xl">
              <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border ${
                fullscreenExits >= 3
                  ? "bg-destructive/10 border-destructive/30 text-destructive"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-600"
              }`}>
                <span className="material-symbols-outlined text-3xl">
                  {fullscreenExits >= 3 ? "gavel" : "fullscreen"}
                </span>
              </div>
              <h2 className="text-lg font-bold text-foreground">{fsMsg.title}</h2>
              <p className="text-sm text-muted-foreground">
                {fsMsg.desc}{" "}
                {fullscreenExits > 0 && (
                  <span className="text-destructive font-semibold">
                    ({fullscreenExits} exit{fullscreenExits === 1 ? "" : "s"} recorded).
                  </span>
                )}
              </p>
              <button
                onClick={enterFullscreen}
                className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
              >
                Enter Fullscreen to Continue
              </button>
              <p className="text-[11px] text-muted-foreground pt-1">
                Re-entering fullscreen resumes the exam. Stay in fullscreen to answer.
              </p>
            </div>
          </div>
        )}
        {mounted &&
          tabWarningVisible &&
          tabSwitches > 0 &&
          createPortal(
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[110] w-[min(92vw,640px)] pointer-events-none">
              <div
                role="alert"
                className="w-full px-5 py-4 rounded-2xl shadow-2xl border-2 font-bold text-sm sm:text-base text-center flex items-center justify-center gap-2.5 bg-amber-400 border-amber-300 text-amber-950"
              >
                <span className="text-xl shrink-0">⚠️</span>
                <span>
                  Tab Switch Detected — You left the examination window. This activity
                  has been recorded for review. Please remain in the exam tab.
                </span>
              </div>
            </div>,
            document.body
          )}
        {showLeaveConfirm && (
          <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="max-w-sm w-full text-center space-y-4 rounded-2xl border border-border bg-card p-8 shadow-2xl">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600">
                <span className="material-symbols-outlined text-3xl">fullscreen_exit</span>
              </div>
              <h2 className="text-lg font-bold text-foreground">
                You have exited fullscreen
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your exam is still in progress and your answers are safe. Return to
                fullscreen to select answers, or continue in window mode. This exit
                has been recorded but does not end your exam.
              </p>
              <div className="space-y-2.5 pt-1">
                <button
                  onClick={stayInExam}
                  className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">fullscreen</span>
                  Return to Fullscreen
                </button>
                <button
                  onClick={continueInWindowMode}
                  className="w-full rounded-xl bg-muted/60 border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">fullscreen_exit</span>
                  Exit Fullscreen
                </button>
              </div>
            </div>
          </div>
        )}
        {showSubmitModal && (
          <div className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-border bg-card p-8 shadow-2xl animate-fade-in">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/30 text-primary">
                <span className="material-symbols-outlined text-3xl">send</span>
              </div>
              <h2 className="text-xl font-bold text-foreground">
                Submit Exam?
              </h2>
              <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
                <p>
                  You have answered <span className="font-bold text-foreground">{Object.keys(answers).length}</span> of <span className="font-bold text-foreground">{exam.questions?.length || 0}</span> questions.
                </p>
                {Object.keys(answers).length < (exam.questions?.length || 0) && (
                  <p className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-600 text-xs font-semibold text-left flex items-start gap-2">
                    <span className="material-symbols-outlined text-base shrink-0 mt-0.5">warning</span>
                    <span>{(exam.questions?.length || 0) - Object.keys(answers).length} unanswered question(s) will score zero points.</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Once submitted, your answers will be finalized.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition"
                  disabled={submitting}
                >
                  Continue Exam
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 rounded-xl bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-500 text-white font-bold py-2.5 text-sm transition shadow-lg shadow-primary/25 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Confirm Submit</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="min-h-screen flex flex-col lg:flex-row bg-background">
          {/* Main Questions Area */}
          <div className="flex-1 p-4 sm:p-6 lg:p-8 pb-8 overflow-y-auto bg-gradient-to-b from-primary/[0.05] via-background to-background">
            <div className="max-w-3xl mx-auto space-y-5">
              {/* Exam Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-card border border-border/80 rounded-2xl p-5 shadow-sm gap-4">
                <div>
                  <h1 className="text-xl font-bold text-foreground">{exam.title}</h1>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <span>{Object.keys(answers).length} of {exam.questions?.length || 0} questions answered</span>
                    <span>•</span>
                    <span>{exam.duration_min} minutes allotted</span>
                  </p>
                </div>

                {timeLeft !== null && (
                  <div
                    className={`flex items-center gap-2 text-xl font-mono font-bold px-4 py-2 rounded-xl border ${
                      timeLeft < 120
                        ? "bg-destructive/10 text-destructive border-destructive/20 animate-pulse"
                        : "bg-muted/70 text-foreground border-border"
                    }`}
                  >
                    <span className="material-symbols-outlined text-lg">timer</span>
                    <span>{formatTime(timeLeft)}</span>
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-4 text-sm text-destructive flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg shrink-0">warning</span>
                  <span>{error}</span>
                </div>
              )}

              {!canAnswer && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-sm text-amber-600 flex items-center gap-3">
                  <span className="material-symbols-outlined text-lg shrink-0">lock</span>
                  <div className="space-y-0.5 flex-1">
                    <p className="font-bold">Read-Only Mode</p>
                    <p className="text-xs leading-relaxed">
                      You can view the questions, but you must enter fullscreen mode to select answers.
                    </p>
                  </div>
                  <button
                    onClick={enterFullscreen}
                    className="shrink-0 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition"
                  >
                    Enter Fullscreen
                  </button>
                </div>
              )}

              {/* Previous — above the question */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setCurrentQuestion((c) => Math.max(0, c - 1))}
                  disabled={currentQuestion === 0}
                  className="px-6 py-2.5 bg-muted hover:bg-muted/60 text-foreground font-bold rounded-xl text-sm transition flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-base">chevron_left</span>
                  Previous
                </button>
                <span className="text-xs text-muted-foreground font-medium">
                  {Object.keys(answers).length} of {exam.questions?.length || 0} answered
                </span>
              </div>

              {/* Current Question (one per page) — large */}
              <div
                className={`bg-card border rounded-3xl overflow-hidden transition-all shadow-xl ${
                  answers[String(currentQuestion)] !== undefined
                    ? "border-primary/50 ring-2 ring-primary/20"
                    : "border-border/80"
                }`}
              >
                  {/* Card header strip */}
                  <div className="flex items-center justify-between gap-3 px-6 sm:px-8 py-4 bg-muted/50 border-b border-border/60">
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-primary/10 text-primary font-bold text-sm flex items-center justify-center shrink-0">
                        {currentQuestion + 1}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          Question {currentQuestion + 1}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          of {exam.questions?.length || 0} ·{" "}
                          {Object.keys(answers).length} answered
                        </p>
                        <div className="mt-1.5 w-28 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                              width: `${Math.round((Object.keys(answers).length / (exam.questions?.length || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-[11px] font-bold px-3 py-1.5 rounded-full shrink-0 ${
                        answers[String(currentQuestion)] !== undefined
                          ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
                          : "bg-amber-500/10 text-amber-600 border border-amber-500/30"
                      }`}
                    >
                      {answers[String(currentQuestion)] !== undefined
                        ? "✓ Answered"
                        : "Not answered"}
                    </span>
                  </div>

                  <div className="p-6 sm:p-8 space-y-6">
                    <p className="font-bold text-foreground text-lg sm:text-2xl leading-relaxed">
                      {exam.questions?.[currentQuestion]?.question}
                    </p>

                    <div className="space-y-3">
                      {exam.questions?.[currentQuestion]?.options?.map((opt: string, oi: number) => {
                        const selected = answers[String(currentQuestion)] === oi;
                        return (
                          <label
                            key={oi}
                            className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                              selected
                                ? "border-primary bg-primary/5 text-foreground font-medium shadow-md"
                                : "border-border/80 hover:border-primary/40 hover:bg-muted/50 text-muted-foreground"
                            } ${canAnswer ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                          >
                            <input
                              type="radio"
                              name={`q-${currentQuestion}`}
                              checked={selected}
                              disabled={!canAnswer}
                              onChange={() => {
                                if (!canAnswer) return;
                                setAnswers({ ...answers, [String(currentQuestion)]: oi });
                              }}
                              className="w-5 h-5 accent-primary shrink-0"
                            />
                            <span
                              className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 border ${
                                selected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {String.fromCharCode(65 + oi)}
                            </span>
                            <span className="text-[15px] sm:text-base flex-1">
                              {opt}
                            </span>
                            {selected && (
                              <span className="material-symbols-outlined text-primary shrink-0">
                                check_circle
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

              {/* Next / Submit — below the question */}
              <div className="flex items-center justify-end">
                {currentQuestion >= (exam.questions?.length || 1) - 1 ? (
                  <button
                    onClick={() => setShowSubmitModal(true)}
                    disabled={submitting}
                    className="px-7 py-2.5 bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-500 text-white font-bold rounded-xl text-sm transition shadow-lg shadow-primary/20 flex items-center gap-2 cursor-pointer disabled:opacity-70"
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <>
                        <span>Submit Exam</span>
                        <span className="material-symbols-outlined text-lg">send</span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentQuestion((c) => Math.min((exam.questions?.length || 1) - 1, c + 1))}
                    className="px-7 py-2.5 bg-muted hover:bg-muted/60 text-foreground font-bold rounded-xl text-sm transition flex items-center gap-1.5"
                  >
                    Next
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Live AI Proctoring Sidebar */}
          <div className="lg:w-88 border-t lg:border-t-0 lg:border-l border-border/80 bg-card p-5 space-y-5">
            {/* Questions palette — jump to any question */}
            <div className="pb-3 border-b border-border/80 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-foreground">Questions</p>
                <span className="text-[10px] font-medium text-muted-foreground">
                  {Object.keys(answers).length}/{exam.questions?.length || 0} answered
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {exam.questions?.map((_: any, i: number) => {
                  const answered = answers[String(i)] !== undefined;
                  const current = i === currentQuestion;
                  return (
                    <button
                      key={i}
                      onClick={() => setCurrentQuestion(i)}
                      className={`h-8 rounded-lg text-xs font-bold transition flex items-center justify-center ${
                        current
                          ? "bg-primary text-primary-foreground ring-2 ring-primary/40"
                          : answered
                            ? "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                            : "bg-muted text-muted-foreground border border-border hover:bg-muted/60"
                      }`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>

              {/* Quick Submit Exam button in sidebar — available from any question */}
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 font-bold rounded-xl text-xs sm:text-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">task_alt</span>
                <span>Submit Exam ({Object.keys(answers).length}/{exam.questions?.length || 0})</span>
              </button>
            </div>

            <div className="flex items-center justify-between pb-3 border-b border-border/80">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live AI Proctoring</span>
              </div>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                Active
              </span>
            </div>

            {session && (
              <ProctoringMonitor
                sessionId={session.id}
                videoRef={videoRef}
              />
            )}

            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-muted/40 border border-border/50">
                <span className="text-muted-foreground font-medium">Time Remaining</span>
                <span className="font-mono font-bold text-foreground">
                  {timeLeft !== null ? formatTime(timeLeft) : "--:--"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute role="student">
      <div className="p-8 text-center text-muted-foreground">Session status: {session?.status}</div>
    </ProtectedRoute>
  );
}
