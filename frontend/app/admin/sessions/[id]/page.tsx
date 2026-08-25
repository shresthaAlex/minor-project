"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, serverUrl } from "@/src/services/api";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import { useAuth } from "@/src/contexts/AuthContext";

function EventBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    tab_switch: "bg-amber-100 text-amber-700",
    fullscreen_exit: "bg-amber-100 text-amber-700",
    multiple_faces: "bg-red-100 text-red-700",
    person_absent: "bg-red-100 text-red-700",
    identity_mismatch: "bg-red-100 text-red-700",
    phone_detected: "bg-orange-100 text-orange-700",
    object_detected: "bg-orange-100 text-orange-700",
    gaze_away: "bg-slate-100 text-slate-700",
    head_pose_abnormal: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${colors[type] || "bg-slate-100 text-slate-700"}`}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

export default function AdminSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isClientEvent = (type: string) => type === "tab_switch" || type === "fullscreen_exit";
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [finalScore, setFinalScore] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [showReleasedModal, setShowReleasedModal] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    api.getAdminSessionDetail(id)
      .then((d) => {
        setData(d);
        // Pre-fill with the released score, otherwise with the auto-computed
        // score (unanswered = wrong) so a fresh release can't default to 100%.
        if (d.session?.final_score != null) setFinalScore(String(Math.round(d.session.final_score)));
        else if (d.session?.score != null) setFinalScore(String(Math.round(d.session.score)));
        if (d.session?.admin_notes) setNotes(d.session.admin_notes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id, user]);

  async function handleGrade() {
    if (!data || grading) return;
    const score = parseFloat(finalScore);
    if (Number.isNaN(score) || score < 0 || score > 100) {
      setGradeError("Score must be between 0 and 100.");
      return;
    }
    setGrading(true);
    setGradeError(null);
    try {
      await api.gradeSession(data.session.id, score, notes.trim() || undefined);
      const refreshed = await api.getAdminSessionDetail(data.session.id);
      setData(refreshed);
      if (refreshed.session?.admin_notes) setNotes(refreshed.session.admin_notes);
      setShowReleasedModal(true);
    } catch (err: any) {
      setGradeError(err.message || "Failed to release result");
    } finally {
      setGrading(false);
    }
  }

  if (loading) {
    return (
      <ProtectedRoute role="admin">
        <div>
          <div className="skeleton h-6 w-32 mb-6" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
          </div>
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (!data) {
    return (
      <ProtectedRoute role="admin">
        <div className="p-6 text-center"><p className="text-red-600">Session not found</p></div>
      </ProtectedRoute>
    );
  }

  const { session, events, cheating_logs, answers, questions } = data;
  const reviewed = session.result_status === "reviewed";
  const autoCorrect = (questions || []).reduce(
    (n: number, q: any, i: number) =>
      n + (answers?.[String(i)] != null && answers[String(i)] === q.correct_answer ? 1 : 0),
    0
  );

  return (
    <ProtectedRoute role="admin">
      <div className="animate-fade-in">
        <Link href="/admin/sessions" className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 mb-6">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Sessions
        </Link>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Student Report</h1>
          <div className="flex items-center gap-2">
            <span className={`status-badge ${
              session.status === "submitted" ? "status-badge--success" :
              session.status === "in_progress" ? "status-badge--info" :
              session.status === "flagged" ? "status-badge--danger" : "status-badge--default"
            }`}>{session.status}</span>
            <span className={`status-badge ${reviewed ? "status-badge--success" : "status-badge--warning"}`}>
              Result: {reviewed ? "Released" : "Pending"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="stat-card">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Student</p>
            <p className="font-semibold text-slate-900">{session.student_name}</p>
            <p className="text-sm text-slate-500">{session.student_email}</p>
            {session.student_display_id && (
              <p className="text-xs text-slate-400 mt-0.5">ID: {session.student_display_id}</p>
            )}
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Exam</p>
            <p className="font-semibold text-slate-900">{session.exam_title}</p>
            {session.started_at && (
              <p className="text-xs text-slate-400 mt-1">
                {new Date(session.started_at).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {/* ── Grade / release result ─────────────────────────────────── */}
        <div className={`content-card mb-8 ${reviewed ? "border-emerald-200" : "border-amber-200"}`}>
          <h2 className="text-base font-semibold text-slate-900 mb-1">
            {reviewed ? "Result Released" : "Release Result"}
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            {reviewed
              ? `Released on ${new Date(session.reviewed_at).toLocaleString()}. You can update the result below.`
              : "Review the violation snapshots and the student's answers below, then assign the final score. The student will only see their result after you release it."}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Final Score (%)</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={finalScore}
                  onChange={(e) => setFinalScore(e.target.value)}
                  className="w-32 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-900"
                  placeholder="0 - 100"
                />
              </div>
              {!reviewed && session.score != null && (
                <p className="text-xs text-slate-500 mt-1.5">
                  Auto score: {Math.round(session.score)}% ({autoCorrect}/{questions?.length || 0} correct) — unanswered counts as wrong
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Administrator Note (visible to student)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 resize-none"
                placeholder="e.g. Score adjusted for 2 recorded gaze-away violations."
              />
            </div>
          </div>

          {gradeError && (
            <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{gradeError}</div>
          )}

          <div className="mt-4">
            <button
              onClick={handleGrade}
              disabled={grading}
              className="btn-primary inline-flex items-center gap-2"
            >
              {grading ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Releasing...
                </>
              ) : reviewed ? "Update Result" : "Release Result"}
            </button>
          </div>
        </div>

        {/* ── Answer review ──────────────────────────────────────────── */}
        <div className="content-card mb-8">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Student Answers ({questions?.length || 0})</h2>
          {questions?.length > 0 ? (
            <div className="space-y-4">
              {questions.map((q: any, i: number) => {
                const selected = answers?.[String(i)];
                const isCorrect = selected != null && selected === q.correct_answer;
                const answered = selected != null;
                return (
                  <div key={i} className="border border-slate-200 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <p className="font-medium text-slate-900 text-sm">
                        <span className="font-bold text-indigo-600 mr-2">{i + 1}.</span>
                        {q.question}
                      </p>
                      {answered ? (
                        <span className={`inline-flex shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                          isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                        }`}>
                          {isCorrect ? "Correct" : "Incorrect"}
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                          Unanswered
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5 ml-2">
                      {q.options?.map((opt: string, oi: number) => {
                        const isStudent = selected === oi;
                        const isAnswer = oi === q.correct_answer;
                        return (
                          <div
                            key={oi}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${
                              isAnswer
                                ? "bg-emerald-50 border-emerald-200"
                                : isStudent
                                  ? "bg-red-50 border-red-200"
                                  : "border-transparent text-slate-600"
                            }`}
                          >
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                              isAnswer ? "bg-emerald-500 text-white" :
                              isStudent ? "bg-red-500 text-white" : "bg-slate-100 text-slate-500"
                            }`}>
                              {String.fromCharCode(65 + oi)}
                            </span>
                            <span className={isAnswer || isStudent ? "font-medium text-slate-800" : ""}>{opt}</span>
                            {isAnswer && (
                              <span className="text-xs text-emerald-600 ml-auto font-medium shrink-0">Correct</span>
                            )}
                            {isStudent && !isAnswer && (
                              <span className="text-xs text-red-600 ml-auto font-medium shrink-0">Student&apos;s choice</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-6">No questions available.</p>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Proctoring Events", value: events?.length || 0, color: "", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
            { label: "Cheating Logs", value: cheating_logs?.length || 0, color: "text-red-600", icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" },
            { label: "Tab Switches", value: events?.filter((e: any) => isClientEvent(e.event_type)).length || 0, color: "text-amber-600", icon: "M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" },
          ].map((item, i) => (
            <div key={i} className="text-center border border-slate-200 rounded-xl p-4">
              <p className={`text-2xl font-bold ${item.color || "text-slate-900"}`}>{item.value}</p>
              <p className="text-xs text-slate-500 mt-1">{item.label}</p>
            </div>
          ))}
        </div>

        {session.started_at && (
          <div className="flex items-center gap-6 text-sm text-slate-500 mb-6 bg-slate-50 rounded-xl px-4 py-3">
            <span>Started: {new Date(session.started_at).toLocaleString()}</span>
            {session.submitted_at && <span>Submitted: {new Date(session.submitted_at).toLocaleString()}</span>}
            {session.started_at && session.submitted_at && (
              <span>Duration: {Math.round((new Date(session.submitted_at).getTime() - new Date(session.started_at).getTime()) / 60000)} min</span>
            )}
          </div>
        )}

        <div className="content-card mb-8">
          <h2 className="text-base font-semibold text-slate-900 mb-1">Proctoring Events &amp; Evidence ({events?.length || 0})</h2>
          <p className="text-sm text-slate-500 mb-4">
            Chronological event history. Evidence snapshots appear directly below the event
            that produced them; select an image to preview it.
          </p>
          {events?.length > 0 ? (
            <div className="space-y-4">
              {events.map((e: any) => {
                const snapshotAlt = `${e.event_type.replace(/_/g, " ")} snapshot`;
                return (
                  <article key={e.id} className={`overflow-hidden rounded-xl border transition-colors ${
                    isClientEvent(e.event_type)
                      ? e.occurrence && e.occurrence >= 2
                        ? "border-red-200 bg-red-50/40"
                        : "border-amber-200 bg-amber-50/40"
                      : "border-slate-200 bg-white"
                  }`}>
                    <div className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <EventBadge type={e.event_type} />
                        <time className="text-xs text-slate-400">{new Date(e.timestamp).toLocaleString()}</time>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                        {isClientEvent(e.event_type) && e.occurrence && (
                          <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Occurrence</p><p className="mt-0.5 text-slate-700">#{e.occurrence}</p></div>
                        )}
                        {isClientEvent(e.event_type) && e.duration != null && (
                          <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Time away</p><p className="mt-0.5 text-slate-700">{e.duration >= 60 ? `${Math.floor(e.duration / 60)}m ` : ""}{(e.duration % 60).toFixed(1)}s</p></div>
                        )}
                      </div>
                    </div>
                    {e.snapshot_path ? (
                      <button
                        type="button"
                        onClick={() => setPreviewSnapshot({ src: serverUrl(e.snapshot_path), alt: snapshotAlt })}
                        className="block w-full border-t border-slate-200 bg-white text-left"
                        aria-label={`Preview ${snapshotAlt}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={serverUrl(e.snapshot_path)}
                          alt={snapshotAlt}
                          className="max-h-96 w-full object-contain object-left"
                          onError={(ev) => {
                            const t = ev.currentTarget;
                            t.style.display = "none";
                            const p = t.nextElementSibling as HTMLElement | null;
                            if (p) p.style.display = "flex";
                          }}
                        />
                        <span className="block px-4 py-2 text-xs font-medium text-indigo-600">Click image to preview</span>
                      </button>
                    ) : !isClientEvent(e.event_type) && (
                      <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-400">
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        No snapshot captured for this event
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : session.status === "registered" ? (
            <div className="text-center py-8 text-slate-500">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                <span className="material-symbols-outlined text-xl">pending</span>
              </div>
              <p className="text-sm font-semibold text-slate-700">Exam Not Started Yet</p>
              <p className="text-xs text-slate-400 mt-1">This student registered for the exam. Proctoring events and snapshots will appear once they start the session.</p>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                <span className="material-symbols-outlined text-xl">verified_user</span>
              </div>
              <p className="text-sm font-semibold text-slate-700">Clean Proctoring Session</p>
              <p className="text-xs text-slate-400 mt-1">No violations or suspicious events were recorded during this exam session.</p>
            </div>
          )}
        </div>

        {previewSnapshot && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Snapshot preview"
            onClick={() => setPreviewSnapshot(null)}
          >
            <div className="relative flex h-[92vh] w-[96vw] items-center justify-center" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                onClick={() => setPreviewSnapshot(null)}
                className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black"
                aria-label="Close preview"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewSnapshot.src} alt={previewSnapshot.alt} className="max-h-full max-w-full rounded-xl bg-white object-contain shadow-2xl" />
            </div>
          </div>
        )}

        {showReleasedModal && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Result released"
            onClick={() => setShowReleasedModal(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl animate-fade-in"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-9 w-9 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900">Result Released</h3>
              <p className="mt-1 text-sm text-slate-500">The result has been released to the student.</p>
              <button
                type="button"
                onClick={() => setShowReleasedModal(false)}
                className="btn-primary mt-5 w-full"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {cheating_logs && cheating_logs.length > 0 && (
          <div className="content-card">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Cheating Evidence ({cheating_logs.length})</h2>
            <div className="space-y-3">
              {cheating_logs.map((c: any) => (
                <div key={c.id} className="border border-red-200 bg-red-50/30 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-red-600 bg-red-100 px-2 py-0.5 rounded-full">Evidence</span>
                    <span className="text-xs text-slate-400">{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  {c.description && <p className="text-sm text-slate-700 mb-2">{c.description}</p>}
                  {c.evidence_path && (
                    <a href={serverUrl(c.evidence_path)} target="_blank" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      View Evidence
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
