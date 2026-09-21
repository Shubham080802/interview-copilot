"use client";
import { Pause, Play, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Card, Spinner, cx } from "@/components/ui";
import { api, formatDuration } from "@/lib/client/api";
import { webmDurationSeconds, withWebmDuration } from "@/lib/voice/webm-duration";

const SPEEDS = [1, 1.25, 1.5, 2];

/**
 * Plays one part of the conversation audio.
 *
 * Recordings are written while the interview is still running, so they carry no duration and
 * browsers show an unusable timeline ("0:00 / 0:00") for them. The length is read back out of the
 * recording instead, and the controls below are driven by it, so the conversation can be scrubbed
 * through like any other audio.
 */
export function RecordingPlayer({ interviewId, segment, part, onDeleted }: { interviewId: string; segment: number; part?: string; onDeleted: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState("");
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const url = `/api/interviews/${interviewId}/recording?segment=${segment}`;

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (cancelled) return;
        setDuration(webmDurationSeconds(bytes) ?? 0);
        // The saved copy carries its length, so it also opens properly in other players.
        const playable = withWebmDuration(bytes) as Uint8Array<ArrayBuffer>;
        objectUrl = URL.createObjectURL(new Blob([playable], { type: "audio/webm" }));
        setSource(objectUrl);
      } catch {
        if (!cancelled) setError("This recording couldn't be loaded. It may have been deleted, or the upload didn't finish.");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setError("Your browser wouldn't play this recording."));
    else el.pause();
  }

  function seek(to: number) {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(duration || el.currentTime, to));
    setTime(el.currentTime);
  }

  function changeSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  }

  async function remove() {
    if (!confirm(`Delete this conversation audio${part ? ` (${part})` : ""}? Your answers, scores and feedback are kept. This cannot be undone.`)) return;
    setDeleting(true);
    setError("");
    try {
      await api(url, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  const ready = Boolean(source);
  return (
    <Card>
      {part && <div className="mb-3 text-sm font-medium">{part}</div>}
      <audio
        ref={audio}
        src={source}
        preload="auto"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />

      {ready ? (
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
          </button>
          <button onClick={() => seek(time - 10)} aria-label="Back 10 seconds" className="hidden text-slate-500 hover:text-slate-800 sm:block">
            <RotateCcw className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(time, duration || time)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Position in the conversation"
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
          />
          <button onClick={() => seek(time + 10)} aria-label="Forward 10 seconds" className="hidden text-slate-500 hover:text-slate-800 sm:block">
            <RotateCw className="h-4 w-4" />
          </button>
          <span className="shrink-0 font-mono text-xs tabular-nums text-slate-600">
            {formatDuration(time)} / {duration ? formatDuration(duration) : "--:--"}
          </span>
          <button
            onClick={changeSpeed}
            aria-label="Playback speed"
            className={cx("shrink-0 rounded-full px-2 py-1 text-xs font-medium transition", speed === 1 ? "text-slate-500 hover:bg-slate-100" : "bg-brand-50 text-brand-700")}
          >
            {speed}×
          </button>
        </div>
      ) : (
        <div className="flex h-11 items-center gap-2 text-sm text-slate-500">
          {error ? error : <><Spinner className="text-slate-400" /> Loading the conversation…</>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
        <span>Replay it to review your answers, pace and clarity.</span>
        <span className="flex items-center gap-4">
          <a href={source || `${url}&download=1`} download={`interview-${interviewId}${segment > 1 ? `-part${segment}` : ""}.webm`} className="font-medium text-brand-600 hover:underline">
            Download audio
          </a>
          <button onClick={remove} disabled={deleting} className="inline-flex items-center gap-1.5 font-medium text-rose-600 hover:underline disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> {deleting ? "Deleting…" : "Delete audio"}
          </button>
        </span>
      </div>
      {error && ready && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Card>
  );
}
