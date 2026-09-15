"use client";
import { useEffect, useRef, useState } from "react";

export type CameraProblem = "missing" | "ended" | "muted" | "blocked";

export const CAMERA_PROBLEM_TEXT: Record<CameraProblem, { title: string; help: string }> = {
  missing: { title: "Camera not connected", help: "Allow camera access for this site, then reconnect." },
  ended: { title: "Your camera turned off", help: "It was disconnected, or camera permission was revoked. Reconnect it to continue." },
  muted: { title: "Your camera is paused", help: "Another app may be using it, or the system paused it. Close other video apps, then reconnect." },
  blocked: { title: "Your camera is covered", help: "The camera is showing a black image. Uncover the lens or turn on a light." },
};

// A problem must persist this long before the interview pauses (avoids flicker on brief glitches).
export const PROBLEM_GRACE_MS = { missing: 0, ended: 0, muted: 1500, blocked: 3000 } satisfies Record<CameraProblem, number>;
const HEARTBEAT_MS = 5000;

/** Mean and standard deviation of luminance from a tiny downscaled frame. */
function frameStats(video: HTMLVideoElement, canvas: HTMLCanvasElement): { mean: number; std: number } | null {
  if (!video.videoWidth || video.readyState < 2) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  let sq = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += y;
    sq += y * y;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

/**
 * Keeps the interview in "camera on" mode: watches the video track and the picture itself,
 * and reports presence to the server, which refuses answers while the camera is off.
 */
export function useCameraGuard(opts: { interviewId: string; stream: MediaStream | null; video: HTMLVideoElement | null; heartbeat: boolean }) {
  const { interviewId, stream, video, heartbeat } = opts;
  const [problem, setProblem] = useState<CameraProblem | null>("missing");
  const candidate = useRef<{ problem: CameraProblem; since: number } | null>(null);
  const problemRef = useRef<CameraProblem | null>("missing");

  useEffect(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 32, height: 18 });
    const check = () => {
      const track = stream?.getVideoTracks()[0];
      let current: CameraProblem | null = null;
      if (!stream || !track) current = "missing";
      else if (track.readyState === "ended") current = "ended";
      else if (track.muted || !track.enabled) current = "muted";
      else if (video) {
        const stats = frameStats(video, canvas);
        // Very dark AND uniform = lens covered or a black feed; a dim room still has texture/noise.
        if (stats && stats.mean < 12 && stats.std < 6) current = "blocked";
      }

      const now = Date.now();
      if (!current) {
        candidate.current = null;
      } else if (candidate.current?.problem !== current) {
        candidate.current = { problem: current, since: now };
      }
      const confirmed = current && candidate.current && now - candidate.current.since >= PROBLEM_GRACE_MS[current] ? current : null;
      // Recover immediately; only confirmed problems pause the interview.
      const next = current === null ? null : (confirmed ?? problemRef.current);
      if (next !== problemRef.current) {
        problemRef.current = next;
        setProblem(next);
      }
    };
    check();
    const timer = setInterval(check, 500);
    const track = stream?.getVideoTracks()[0];
    track?.addEventListener("ended", check);
    track?.addEventListener("mute", check);
    track?.addEventListener("unmute", check);
    return () => {
      clearInterval(timer);
      track?.removeEventListener("ended", check);
      track?.removeEventListener("mute", check);
      track?.removeEventListener("unmute", check);
    };
  }, [stream, video]);

  // Heartbeat to the server (immediately on every change, then periodically).
  useEffect(() => {
    if (!heartbeat) return;
    const send = () =>
      fetch(`/api/interviews/${interviewId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraOn: problemRef.current === null }),
        keepalive: true,
      }).catch(() => {});
    send();
    const timer = setInterval(send, HEARTBEAT_MS);
    // Background tabs throttle timers; refresh presence as soon as the candidate is back.
    const onVisible = () => !document.hidden && send();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [heartbeat, interviewId, problem]);

  return { cameraOn: problem === null, problem };
}
