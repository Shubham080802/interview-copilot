"use client";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProctorEventType } from "../types";

type Severity = "low" | "medium" | "high";
interface PendingEvent {
  at: string;
  type: ProctorEventType;
  severity: Severity;
  detail: string;
  durationSec: number;
  snapshot: string | null;
}

export type FaceStatus = "loading" | "ok" | "no_face" | "multiple_faces" | "looking_away" | "unavailable";

export interface LiveWarning {
  type: ProctorEventType;
  message: string;
}

const WARNINGS: Partial<Record<ProctorEventType, string>> = {
  no_face: "We can't see you — please return to the camera frame.",
  multiple_faces: "Another person was detected. The interview must be taken alone.",
  looking_away: "Please keep your eyes on the screen.",
  tab_hidden: "You left the interview tab. This has been recorded.",
  window_blur: "The interview window lost focus. This has been recorded.",
  fullscreen_exit: "You exited full screen. Please return to full screen.",
  paste: "Pasting into answers is flagged by proctoring.",
  camera_off: "Your camera was off. The gap has been recorded.",
};

// How long a visual condition must persist before it becomes a flag.
const THRESHOLD_MS: Partial<Record<ProctorEventType, number>> = { no_face: 3000, multiple_faces: 1500, looking_away: 4000, window_blur: 1000 };

let consolePatched = false;

async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  // The WASM runtime prints routine "INFO:" lines through console.error; keep real errors visible.
  if (!consolePatched) {
    consolePatched = true;
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("INFO:")) return;
      original(...args);
    };
  }
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const attempts = [
    { wasm: "/mediapipe/wasm", model: "/mediapipe/face_landmarker.task" },
    {
      wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
      model: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    },
  ];
  let lastError: unknown;
  for (const a of attempts) {
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const fileset = await FilesetResolver.forVisionTasks(a.wasm);
        return await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: a.model, delegate },
          runningMode: "VIDEO",
          numFaces: 3,
          minFaceDetectionConfidence: 0.6,
          minFacePresenceConfidence: 0.6,
        });
      } catch (e) {
        lastError = e;
      }
    }
  }
  throw lastError;
}

/** Classifies head orientation from landmarks: nose position relative to the cheeks and forehead/chin. */
function isLookingAway(landmarks: { x: number; y: number }[]): boolean {
  const nose = landmarks[1];
  const left = landmarks[234];
  const right = landmarks[454];
  const top = landmarks[10];
  const chin = landmarks[152];
  if (!nose || !left || !right || !top || !chin) return false;
  const h = (nose.x - left.x) / (right.x - left.x || 1);
  const v = (nose.y - top.y) / (chin.y - top.y || 1);
  return h < 0.28 || h > 0.72 || v < 0.32 || v > 0.78;
}

export function useProctoring(opts: {
  interviewId: string;
  video: HTMLVideoElement | null;
  enabled: boolean;
  active: boolean;
}) {
  const { interviewId, video, enabled, active } = opts;
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("loading");
  const [warning, setWarning] = useState<LiveWarning | null>(null);
  const [flagCount, setFlagCount] = useState(0);
  const queue = useRef<PendingEvent[]>([]);
  const open = useRef<Partial<Record<ProctorEventType, { since: number; snapshot: string | null; reported: boolean }>>>({});
  const landmarker = useRef<FaceLandmarker | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const snapshot = useCallback((): string | null => {
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 320);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  }, [video]);

  const flash = useCallback((type: ProctorEventType, message?: string) => {
    const msg = message ?? WARNINGS[type];
    if (!msg) return;
    setWarning({ type, message: msg });
    setTimeout(() => setWarning((w) => (w?.type === type ? null : w)), 5000);
  }, []);

  const finalizing = useRef(false);
  const push = useCallback(
    (e: Omit<PendingEvent, "at"> & { at?: string }) => {
      if (!activeRef.current && !finalizing.current) return;
      queue.current.push({ ...e, at: e.at ?? new Date().toISOString() });
      setFlagCount((n) => n + 1);
    },
    [],
  );

  const flush = useCallback(async () => {
    if (!queue.current.length) return;
    const batch = queue.current.splice(0, 50);
    try {
      await fetch(`/api/interviews/${interviewId}/proctor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
    } catch {
      queue.current.unshift(...batch);
    }
  }, [interviewId]);

  /** Starts a timed condition (e.g. face missing). It becomes a flag once it passes its threshold. */
  const beginCondition = useCallback(
    (type: ProctorEventType, now: number) => {
      const cur = open.current[type];
      if (!cur) {
        open.current[type] = { since: now, snapshot: null, reported: false };
        return;
      }
      if (!cur.reported && now - cur.since >= (THRESHOLD_MS[type] ?? 0)) {
        cur.reported = true;
        cur.snapshot = snapshot();
        flash(type);
      }
    },
    [flash, snapshot],
  );

  const endCondition = useCallback(
    (type: ProctorEventType, now: number, severity: (sec: number) => Severity, detail: string) => {
      const cur = open.current[type];
      if (!cur) return;
      delete open.current[type];
      if (!cur.reported && now - cur.since < (THRESHOLD_MS[type] ?? 0)) return;
      const durationSec = Math.round((now - cur.since) / 1000);
      push({ at: new Date(cur.since).toISOString(), type, severity: severity(durationSec), detail: `${detail} for ${durationSec}s`, durationSec, snapshot: cur.snapshot });
    },
    [push],
  );

  /* --------------------------- face tracking --------------------------- */
  useEffect(() => {
    if (!enabled || !video) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    loadFaceLandmarker()
      .then((lm) => {
        if (cancelled) return lm.close();
        landmarker.current = lm;
        let lastTs = 0;
        timer = setInterval(() => {
          if (!video.videoWidth || video.readyState < 2) return;
          const ts = Math.max(performance.now(), lastTs + 1);
          lastTs = ts;
          let result;
          try {
            result = lm.detectForVideo(video, ts);
          } catch {
            return;
          }
          const now = Date.now();
          const faces = result.faceLandmarks.length;
          const away = faces === 1 && isLookingAway(result.faceLandmarks[0]);
          setFaceStatus(faces === 0 ? "no_face" : faces > 1 ? "multiple_faces" : away ? "looking_away" : "ok");
          if (!activeRef.current) return;

          if (faces === 0) beginCondition("no_face", now);
          else endCondition("no_face", now, (s) => (s > 20 ? "high" : "medium"), "Candidate out of frame");

          if (faces > 1) beginCondition("multiple_faces", now);
          else endCondition("multiple_faces", now, () => "high", "More than one face visible");

          if (away) beginCondition("looking_away", now);
          else endCondition("looking_away", now, (s) => (s > 15 ? "medium" : "low"), "Looking away from the screen");
        }, 300);
      })
      .catch((err) => {
        console.warn("[proctoring] face tracking unavailable", err);
        if (!cancelled) setFaceStatus("unavailable");
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      landmarker.current?.close();
      landmarker.current = null;
    };
  }, [enabled, video, beginCondition, endCondition]);

  /* ------------------------ browser / focus events ----------------------- */
  useEffect(() => {
    if (!enabled || !active) return;
    const onVisibility = () => {
      const now = Date.now();
      if (document.hidden) {
        open.current.tab_hidden = { since: now, snapshot: null, reported: true };
      } else {
        endCondition("tab_hidden", now, (s) => (s > 10 ? "high" : "medium"), "Interview tab hidden");
        flash("tab_hidden");
      }
    };
    const onBlur = () => {
      if (!document.hidden) open.current.window_blur = { since: Date.now(), snapshot: null, reported: false };
    };
    const onFocus = () => {
      const blur = open.current.window_blur;
      if (!blur) return;
      // Sub-second focus blips (system notifications, permission prompts) are ignored by the threshold.
      if (Date.now() - blur.since >= (THRESHOLD_MS.window_blur ?? 0)) flash("window_blur");
      endCondition("window_blur", Date.now(), (s) => (s > 10 ? "medium" : "low"), "Window lost focus");
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) {
        push({ type: "fullscreen_exit", severity: "medium", detail: "Exited full screen", durationSec: 0, snapshot: null });
        flash("fullscreen_exit");
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const len = e.clipboardData?.getData("text")?.length ?? 0;
      if (len < 15) return;
      push({ type: "paste", severity: len > 120 ? "high" : "medium", detail: `Pasted ${len} characters`, durationSec: 0, snapshot: null });
      flash("paste");
    };
    const onCopy = () => push({ type: "copy", severity: "low", detail: "Copied text from the page", durationSec: 0, snapshot: null });

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("copy", onCopy, true);

    const screenInfo = window.screen as Screen & { isExtended?: boolean };
    if (screenInfo.isExtended) push({ type: "multiple_screens", severity: "low", detail: "An extended display is connected", durationSec: 0, snapshot: null });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("copy", onCopy, true);
    };
  }, [enabled, active, push, flash, endCondition]);

  // Upload events while the session is active, even with proctoring checks disabled
  // (camera-off gaps are always recorded).
  useEffect(() => {
    if (!active) return;
    const flushTimer = setInterval(flush, 3000);
    return () => clearInterval(flushTimer);
  }, [active, flush]);

  /** Records a period during which the camera was off, covered or unavailable. */
  const recordCameraGap = useCallback(
    (sinceMs: number, reason: string) => {
      const durationSec = Math.round((Date.now() - sinceMs) / 1000);
      push({ at: new Date(sinceMs).toISOString(), type: "camera_off", severity: durationSec > 10 ? "high" : "medium", detail: `${reason} for ${durationSec}s`, durationSec, snapshot: null });
    },
    [push],
  );

  /** Closes any open conditions and uploads remaining events (call before finishing). */
  const finalize = useCallback(async () => {
    const now = Date.now();
    finalizing.current = true;
    for (const type of Object.keys(open.current) as ProctorEventType[]) {
      endCondition(type, now, () => "medium", "Still active when the interview ended");
    }
    finalizing.current = false;
    await flush();
  }, [endCondition, flush]);

  return { faceStatus, warning, flagCount, finalize, snapshot, recordCameraGap };
}
