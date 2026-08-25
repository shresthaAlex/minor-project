"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, serverUrl } from "@/src/services/api";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import { useAuth } from "@/src/contexts/AuthContext";

export default function ResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[70vh] flex flex-col items-center justify-center p-8">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
          <p className="text-xs text-muted-foreground">Loading examination results...</p>
        </div>
      }
    >
      <ResultsContent />
    </Suspense>
  );
}

function ResultsHistory({ sessions }: { sessions: any[] }) {
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .myExams()
      .then((res) => setExams(Array.isArray(res) ? res : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const safeSessions = Array.isArray(sessions) ? sessions : [];

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground">Results &amp; History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review your past exam sessions and official results.</p>
      </div>

      <div className="bg-card border border-border/80 rounded-2xl p-6 shadow-sm">
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : safeSessions.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-border rounded-xl">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3 text-muted-foreground">
              <span className="material-symbols-outlined text-2xl">history</span>
            </div>
            <p className="text-sm font-semibold text-foreground">No Exam History Yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">Register for an available exam to begin your session.</p>
            <Link href="/student/exams" className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-medium inline-flex items-center gap-1">
              Browse Exams
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {safeSessions.map((s) => {
              const exam = exams.find((e) => e.id === s.exam_id);
              const reviewed = s.result_status === "reviewed" && s.final_score != null;
              return (
                <div
                  key={s.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-border/70 bg-background/50 hover:bg-muted/30 hover:border-primary/40 transition-all gap-3"
                >
                  <div>
                    <p className="text-sm font-bold text-foreground">{exam?.title || "Examination"}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                          s.status === "submitted"
                            ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                            : s.status === "in_progress"
                            ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                            : "bg-muted text-muted-foreground border border-border"
                        }`}
                      >
                        {s.status.replace("_", " ")}
                      </span>
                      {s.status === "submitted" && (
                        reviewed ? (
                          <span className="text-xs font-extrabold text-foreground">Score: {Math.round(s.final_score)}%</span>
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground">Result will be published by admin</span>
                        )
                      )}
                      {s.submitted_at && (
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(s.submitted_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    {s.status === "submitted" ? (
                      <Link
                        href={`/student/results?session=${s.id}`}
                        className="px-3.5 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg transition inline-flex items-center gap-1"
                      >
                        <span>{reviewed ? "View Result" : "View Details"}</span>
                        <span className="material-symbols-outlined text-sm">chevron_right</span>
                      </Link>
                    ) : s.status === "in_progress" ? (
                      <Link
                        href={`/student/exams/${s.exam_id}`}
                        className="px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-white text-xs font-semibold rounded-lg transition inline-flex items-center gap-1 shadow-sm"
                      >
                        <span>Resume Exam</span>
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const { user } = useAuth();
  const [sessionsList, setSessionsList] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);
  const [exam, setExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [previewSnapshot, setPreviewSnapshot] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    if (!sessionId) {
      api
        .mySessions()
        .then((s) => setSessionsList(Array.isArray(s) ? s : []))
        .catch(console.error)
        .finally(() => setLoading(false));
      return;
    }
    api
      .mySessionDetail(sessionId)
      .then((s) => {
        setSession(s);
        return api.getExam(s.exam_id);
      })
      .then((e) => setExam(e))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionId, user]);

  if (loading) return (
    <ProtectedRoute role="student">
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-8">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
        <p className="text-xs text-muted-foreground">Loading results...</p>
      </div>
    </ProtectedRoute>
  );

  if (!sessionId) {
    return (
      <ProtectedRoute role="student">
        <ResultsHistory sessions={sessionsList} />
      </ProtectedRoute>
    );
  }

  if (!session) {
    return (
      <ProtectedRoute role="student">
        <div className="max-w-md mx-auto my-12 p-8 bg-card border border-border/80 rounded-2xl text-center shadow-sm">
          <span className="material-symbols-outlined text-4xl text-muted-foreground mb-2">find_in_page</span>
          <h1 className="text-xl font-bold text-foreground mb-1">Session Not Found</h1>
          <p className="text-xs text-muted-foreground mb-6">This session could not be found. View your exam history below.</p>
          <Link href="/student/results" className="btn-primary inline-flex">Back to Results &amp; History</Link>
        </div>
      </ProtectedRoute>
    );
  }

  const reviewed = session.result_status === "reviewed" && session.final_score != null;
  const isClientEvent = (type: string) => type === "tab_switch" || type === "fullscreen_exit";

  if (!reviewed) {
    return (
      <ProtectedRoute role="student">
        <div className="min-h-[70vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center rounded-2xl border border-border bg-card p-10 shadow-sm animate-fade-in">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-3xl">check_circle</span>
            </div>
            <h1 className="text-xl font-bold text-foreground">Exam submitted</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Your result will be published by the administrator.
            </p>
            <Link href="/student/results" className="btn-primary inline-flex mt-6">Back to Results &amp; History</Link>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute role="student">
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
        {/* Score Header Card */}
        <div className="bg-card border border-border/80 rounded-2xl p-6 sm:p-8 text-center shadow-sm relative overflow-hidden">
          <div className="relative z-10">
            <div
              className={`w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-4 border shadow-xl ${
                session.final_score >= 60
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500 shadow-emerald-500/10"
                  : "bg-destructive/10 border-destructive/30 text-destructive shadow-destructive/10"
              }`}
            >
              <span className="text-3xl font-extrabold tracking-tight">
                {`${Math.round(session.final_score)}%`}
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">{exam?.title || "Examination Results"}</h1>
            <p className="text-xs font-bold uppercase tracking-wider mt-1.5 text-emerald-500">Official Score Released</p>
          </div>
        </div>

        <div className="bg-card border border-border/80 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-muted-foreground">Overall Performance</span>
              <span className="text-foreground">{Math.round(session.final_score)}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-700 ${
                  session.final_score >= 60 ? "bg-emerald-500" : session.final_score >= 40 ? "bg-amber-500" : "bg-destructive"
                }`}
                style={{ width: `${session.final_score}%` }}
              />
            </div>
          </div>

          {session.admin_notes && (
            <div className="bg-muted/50 border border-border/60 rounded-xl p-4 text-xs">
              <p className="font-bold text-foreground mb-1">Administrator Remarks</p>
              <p className="text-muted-foreground leading-relaxed">{session.admin_notes}</p>
            </div>
          )}
        </div>

        <section className="bg-card border border-border/80 rounded-2xl p-5 sm:p-6">
          <h2 className="text-base font-bold text-foreground">Proctoring Events &amp; Evidence</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The administrator has released the recorded events and related evidence for this exam.
          </p>

          {session.events?.length > 0 ? (
            <div className="mt-4 space-y-4">
              {session.events.map((event: any) => {
                const snapshotAlt = `${event.event_type.replace(/_/g, " ")} snapshot`;
                return (
                  <article key={event.id} className={`overflow-hidden rounded-xl border ${
                    isClientEvent(event.event_type)
                      ? "border-amber-200 bg-amber-50/40"
                      : "border-border bg-background"
                  }`}>
                    <div className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-foreground">
                          {event.event_type.replace(/_/g, " ")}
                        </span>
                        <time className="text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleString()}</time>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                        {isClientEvent(event.event_type) && event.occurrence && (
                          <div><p className="text-xs font-medium text-muted-foreground">Occurrence</p><p className="mt-0.5 text-foreground">#{event.occurrence}</p></div>
                        )}
                        {isClientEvent(event.event_type) && event.duration != null && (
                          <div><p className="text-xs font-medium text-muted-foreground">Time away</p><p className="mt-0.5 text-foreground">{event.duration >= 60 ? `${Math.floor(event.duration / 60)}m ` : ""}{(event.duration % 60).toFixed(1)}s</p></div>
                        )}
                      </div>
                    </div>
                    {event.snapshot_path && (
                      <button
                        type="button"
                        onClick={() => setPreviewSnapshot({ src: serverUrl(event.snapshot_path), alt: snapshotAlt })}
                        className="block w-full border-t border-border bg-background text-left"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={serverUrl(event.snapshot_path)} alt={snapshotAlt} className="max-h-96 w-full object-contain object-left" />
                        <span className="block px-4 py-2 text-xs font-medium text-primary">Click image to preview</span>
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No proctoring events were recorded.</p>
          )}

          {session.cheating_logs?.length > 0 && (
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="text-sm font-bold text-foreground">Additional Evidence</h3>
              <div className="mt-3 space-y-3">
                {session.cheating_logs.map((log: any) => (
                  <article key={log.id} className="overflow-hidden rounded-xl border border-destructive/20 bg-destructive/5">
                    <div className="p-4">
                      <time className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</time>
                      {log.description && <p className="mt-2 text-sm text-foreground">{log.description}</p>}
                    </div>
                    {log.evidence_path && (
                      <button
                        type="button"
                        onClick={() => setPreviewSnapshot({ src: serverUrl(log.evidence_path), alt: "Proctoring evidence" })}
                        className="block w-full border-t border-destructive/20 bg-background text-left"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={serverUrl(log.evidence_path)} alt="Proctoring evidence" className="max-h-96 w-full object-contain object-left" />
                        <span className="block px-4 py-2 text-xs font-medium text-primary">Click image to preview</span>
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        {previewSnapshot && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Evidence preview"
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

        {/* Footer Navigation */}
        <div className="flex gap-3">
          <Link href="/student/results" className="btn-primary flex-1">
            Back to Results &amp; History
          </Link>
          <Link href="/student/dashboard" className="btn-secondary flex-1">
            Student Dashboard
          </Link>
        </div>
      </div>
    </ProtectedRoute>
  );
}
