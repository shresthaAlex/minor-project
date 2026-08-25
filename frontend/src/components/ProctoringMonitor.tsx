"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Detection {
  class_id: number;
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
}

interface Alert {
  type: string;
  message: string;
}

interface ActiveWarning {
  type: string;
  message: string;
  level: "warning" | "violation";
}

interface GazeData {
  face_detected: boolean;
  status: string;
  predicted_point: string | null;
  confidence: number;
  yaw: number | null;
  pitch?: number | null;
  head_direction: string;
  eye_direction: string;
  violation_active: boolean;
  violation_type: string | null;
  violation_duration: number;
}

interface ProctorResult {
  person_count: number;
  phone_detected: boolean;
  detections: Detection[];
  alerts: Alert[];
  active_warnings?: ActiveWarning[];
  snapshot_reasons: string[];
  snapshots?: string[];
  gaze?: GazeData;
}

const WS_BASE =
  process.env.NEXT_PUBLIC_PROCTOR_WS_URL || "ws://localhost:8000/ws/proctor";
// Send a camera frame to the proctoring WebSocket three times each second.
const SEND_INTERVAL_MS = 1000 / 3;

interface ProctoringMonitorProps {
  sessionId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onAlert?: (alert: Alert) => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// Direction → display label and status colour:
//   center → Normal (green), left/right/up/down → Attention (amber),
//   not_detected → Detection issue (red)
function directionMeta(dir: string | undefined) {
  const d = dir || "not_detected";
  const label =
    d === "not_detected" ? "Not Detected" : d.charAt(0).toUpperCase() + d.slice(1);
  const color =
    d === "center" ? "#22c55e" : d === "not_detected" ? "#ef4444" : "#f59e0b";
  return { label, color };
}

export default function ProctoringMonitor({
  sessionId,
  videoRef,
  onAlert,
}: ProctoringMonitorProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const alertsRef = useRef<Alert[]>([]);
  const gazeRef = useRef<GazeData | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;
  const connectRef = useRef<(() => void) | null>(null);

  const [connected, setConnected] = useState(false);
  const [activeWarnings, setActiveWarnings] = useState<ActiveWarning[]>([]);
  const [mounted, setMounted] = useState(false);
  const [gazeStatus, setGazeStatus] = useState<string | null>("normal");
  const [wsError, setWsError] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const buildUrl = useCallback(() => {
    let tokenParam = "";
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("access_token");
      if (token) tokenParam = `?token=${encodeURIComponent(token)}`;
    }

    let wsUrl = WS_BASE;
    if (typeof window !== "undefined") {
      try {
        const urlObj = new URL(wsUrl);
        if (window.location.protocol === "https:" && urlObj.protocol === "ws:") {
          urlObj.protocol = "wss:";
        }
        if (window.location.protocol === "http:" && urlObj.protocol === "wss:") {
          urlObj.protocol = "ws:";
        }

        const isLocalBackend = urlObj.hostname === "localhost" || urlObj.hostname === "127.0.0.1";
        if (isLocalBackend) {
          urlObj.hostname = window.location.hostname;
        }

        wsUrl = urlObj.toString();
      } catch {
        const scheme = window.location.protocol === "https:" ? "wss" : "ws";
        wsUrl = `${scheme}://${window.location.hostname}:8000/ws/proctor`;
      }
    }
    return `${wsUrl}/${sessionId}${tokenParam}`;
  }, [sessionId]);

  const connect = useCallback(function connectFn() {
    if (!mountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnected(false);

    try {
      const ws = new WebSocket(buildUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        setConnected(true);
        setWsError(false);
        setFatalError(null);
        reconnectAttemptRef.current = 0;
      };

      ws.onclose = (e) => {
        if (!mountedRef.current) return;
        setConnected(false);
        setActiveWarnings([]);

        console.warn("Proctor WS closed: code=%d reason=%s", e.code, e.reason);

        if (e.code === 1000) return;

        if (e.code >= 4000) {
          setFatalError(`Server rejected connection (code ${e.code})`);
          return;
        }

        setWsError(true);
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
            RECONNECT_MAX_MS
          );
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = setTimeout(connectFn, delay);
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        setActiveWarnings([]);
        setWsError(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            setFatalError(data.error);
            ws.close();
            return;
          }

          const result = data as ProctorResult;

          if (result.active_warnings) {
            setActiveWarnings(result.active_warnings);
          }

          if (result.gaze) {
            gazeRef.current = result.gaze;
            setGazeStatus(result.gaze.status);
          }

          for (const alert of result.alerts) {
            const alreadyShown = alertsRef.current.some((a) => a.type === alert.type && a.message === alert.message);
            if (!alreadyShown) {
              alertsRef.current = [alert, ...alertsRef.current].slice(0, 30);
              onAlertRef.current?.(alert);
            }
          }
        } catch {
          // ignore parse errors
        }
      };
    } catch {
      if (!mountedRef.current) return;
      setWsError(true);
      setConnected(false);
      if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current),
          RECONNECT_MAX_MS
        );
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connectFn, delay);
      }
    }
  }, [buildUrl]);

  connectRef.current = connect;

  useEffect(() => {
    mountedRef.current = true;
    reconnectAttemptRef.current = 0;
    connectRef.current?.();

    setMounted(true);

    return () => {
      mountedRef.current = false;
      setMounted(false);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (wsError || fatalError) return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      const ws = wsRef.current;
      if (
        !video ||
        !ws ||
        ws.readyState !== WebSocket.OPEN ||
        video.videoWidth === 0
      )
        return;

      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);

      const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.6);
      ws.send(JSON.stringify({ frame: dataUrl }));
    }, SEND_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [videoRef, wsError, fatalError]);

  return (
    <div className="w-full">
      {/* ── Main-screen warning overlay (over the exam, not below the camera) ── */}
      {mounted &&
        activeWarnings.length > 0 &&
        createPortal(
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[min(92vw,640px)] space-y-2 pointer-events-none">
            {activeWarnings.map((w) => (
              <div
                key={w.type}
                role="alert"
                className={`w-full px-5 py-4 rounded-2xl shadow-2xl border-2 font-bold text-sm sm:text-base text-center flex items-center justify-center gap-2.5 ${
                  w.level === "violation"
                    ? "bg-red-600 border-red-400 text-white"
                    : "bg-amber-400 border-amber-300 text-amber-950"
                }`}
              >
                <span className="material-symbols-outlined text-xl shrink-0">
                  {w.level === "violation" ? "gavel" : "warning"}
                </span>
                <span>{w.message}</span>
              </div>
            ))}
          </div>,
          document.body
        )}

      <div className="relative w-full aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full rounded-lg bg-black object-cover"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {fatalError ? (
          <span className="text-red-600">AI Proctor: {fatalError}</span>
        ) : wsError ? (
          <span className="text-yellow-600">AI Proctor unavailable — reconnecting...</span>
        ) : (
          <>
            <span className="flex items-center gap-1">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  connected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className={connected ? "text-green-600" : "text-red-600"}>
                AI Proctor: {connected ? "Connected" : "Disconnected"}
              </span>
            </span>

            {gazeStatus && (() => {
              const gaze = gazeRef.current;
              if (!gaze) return null;
              const head = directionMeta(gaze.head_direction);
              const eye = directionMeta(gaze.eye_direction);
              return (
                <>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: head.color }} />
                    <span className="text-gray-600 font-medium">Head: {head.label}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: eye.color }} />
                    <span className="text-gray-600 font-medium">Eyes: {eye.label}</span>
                  </span>
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
