"use client";
import { useEffect, useState } from "react";
import { isVoiceCached, prefetchVoice } from "../voice/model-cache";

export type VoicePrefetchState = "unknown" | "downloading" | "ready" | "unavailable";

/**
 * Downloads the interviewer's voice while the candidate is still on the overview page, so the room
 * can start speaking straight away instead of waiting for a one-time ~90 MB download.
 */
export function useVoicePrefetch(voiceId: string | null): VoicePrefetchState {
  const [state, setState] = useState<VoicePrefetchState>("unknown");

  useEffect(() => {
    if (!voiceId) return;
    let cancelled = false;
    void (async () => {
      if (await isVoiceCached(voiceId)) return cancelled || setState("ready");
      if (cancelled) return;
      setState("downloading");
      const ok = await prefetchVoice(voiceId);
      if (!cancelled) setState(ok ? "ready" : "unavailable");
    })();
    return () => {
      cancelled = true;
    };
  }, [voiceId]);

  return state;
}
