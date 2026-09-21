"use client";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { api, formatDuration } from "@/lib/client/api";

/**
 * Plays one part of the conversation audio.
 *
 * Recordings are written live by MediaRecorder, which cannot know how long they will be, so the
 * file carries no duration: browsers report `Infinity`, show no timeline and refuse to seek. Seeking
 * far past the end makes the browser work the real length out, after which the normal controls
 * behave — so that is done once, quietly, as soon as the metadata arrives.
 */
export function RecordingPlayer({ interviewId, segment, part, onDeleted }: { interviewId: string; segment: number; part?: string; onDeleted: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const src = `/api/interviews/${interviewId}/recording?segment=${segment}`;

  const repairDuration = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (Number.isFinite(el.duration)) return setDuration(el.duration);
    const onDurationChange = () => {
      if (!Number.isFinite(el.duration)) return;
      el.removeEventListener("durationchange", onDurationChange);
      setDuration(el.duration);
      el.currentTime = 0; // back to the start, now that the length is known
    };
    el.addEventListener("durationchange", onDurationChange);
    el.currentTime = 1e101; // forces the browser to read to the end and work out the length
  }, []);

  useEffect(() => {
    const el = audio.current;
    if (el && el.readyState >= 1) repairDuration(); // metadata already arrived before this ran
  }, [repairDuration]);

  async function remove() {
    if (!confirm(`Delete this conversation audio${part ? ` (${part})` : ""}? Your answers, scores and feedback are kept. This cannot be undone.`)) return;
    setDeleting(true);
    setError("");
    try {
      await api(`/api/interviews/${interviewId}/recording?segment=${segment}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  return (
    <Card>
      {part && <div className="mb-2 text-sm font-medium">{part}</div>}
      <audio
        ref={audio}
        controls
        preload="metadata"
        src={src}
        onLoadedMetadata={repairDuration}
        onError={() => setError("This recording couldn't be played. It may have been deleted, or the upload didn't finish.")}
        className="w-full"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
        <span>
          {duration ? `${formatDuration(duration)} of conversation — ` : ""}
          replay it to review your answers, pace and clarity.
        </span>
        <span className="flex items-center gap-4">
          <a href={`${src}&download=1`} className="font-medium text-brand-600 hover:underline">Download audio</a>
          <button
            onClick={remove}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 font-medium text-rose-600 hover:underline disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> {deleting ? "Deleting…" : "Delete audio"}
          </button>
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Card>
  );
}
