"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Camera + microphone                                                */
/* ------------------------------------------------------------------ */

export function useMediaStream() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");

  const request = useCallback(async () => {
    setError("");
    if (process.env.NODE_ENV === "development" && new URLSearchParams(location.search).has("fakeCamera")) {
      const s = fakeStream();
      setStream(s);
      return s;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      setStream(s);
      return s;
    } catch (e) {
      const err = e as DOMException;
      setError(
        err.name === "NotAllowedError"
          ? "Camera/microphone permission was denied. Allow access in the browser's address bar and try again."
          : err.name === "NotFoundError"
            ? "No camera or microphone was found."
            : `Could not start camera: ${err.message}`,
      );
      return null;
    }
  }, []);

  // Release the camera when the component really unmounts. The deferred check skips
  // React StrictMode's simulated unmount/remount, which would otherwise kill the stream.
  const streamRef = useRef<MediaStream | null>(null);
  const mounted = useRef(false);
  streamRef.current = stream;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) streamRef.current?.getTracks().forEach((t) => t.stop());
      }, 0);
    };
  }, []);
  return { stream, error, request };
}

/** Development-only synthetic camera + silent mic, for testing the room without hardware. */
function fakeStream(): MediaStream {
  const canvas = Object.assign(document.createElement("canvas"), { width: 640, height: 360 });
  const ctx = canvas.getContext("2d")!;
  let t = 0;
  setInterval(() => {
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "#6366f1";
    ctx.beginPath();
    ctx.arc(320 + Math.sin(t++ / 10) * 60, 180, 50, 0, Math.PI * 2);
    ctx.fill();
  }, 100);
  return canvas.captureStream(10);
}

/* ------------------------------------------------------------------ */
/*  Speech recognition (Chrome / Edge)                                 */
/* ------------------------------------------------------------------ */

interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export function useSpeechRecognition(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  // Accumulated seconds the mic was on (for speaking-pace metrics).
  const speakingMs = useRef(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => setSupported(getRecognitionCtor() !== null), []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || wantRef.current) return;
    setError("");
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinalRef.current(r[0].transcript.trim());
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        wantRef.current = false;
        setError("Microphone access for speech recognition was blocked.");
      } else if (e.error === "network") {
        setError("Speech recognition needs an internet connection. You can type your answer instead.");
      }
    };
    // Chrome stops recognition after silences; restart while the user still wants it.
    rec.onend = () => {
      setInterim("");
      if (wantRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through */
        }
      }
      setListening(false);
    };
    recRef.current = rec;
    wantRef.current = true;
    startedAt.current = Date.now();
    try {
      rec.start();
      setListening(true);
    } catch {
      wantRef.current = false;
    }
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    if (startedAt.current) speakingMs.current += Date.now() - startedAt.current;
    startedAt.current = null;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const takeSpeakingSeconds = useCallback(() => {
    let ms = speakingMs.current;
    if (startedAt.current) {
      ms += Date.now() - startedAt.current;
      startedAt.current = Date.now();
    }
    speakingMs.current = 0;
    return Math.round(ms / 1000);
  }, []);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.stop();
  }, []);

  return { supported, listening, interim, error, start, stop, takeSpeakingSeconds };
}

/* ------------------------------------------------------------------ */
/*  Interviewer voice (speech synthesis)                               */
/* ------------------------------------------------------------------ */

export function useSpeaker() {
  const [speaking, setSpeaking] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      const preferred = ["Google US English", "Samantha", "Microsoft Aria Online (Natural) - English (United States)", "Microsoft Jenny Online (Natural) - English (United States)"];
      voiceRef.current =
        preferred.map((n) => voices.find((v) => v.name === n)).find(Boolean) ??
        voices.find((v) => v.lang.startsWith("en") && v.localService) ??
        voices.find((v) => v.lang.startsWith("en")) ??
        null;
    };
    pick();
    speechSynthesis.addEventListener("voiceschanged", pick);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", pick);
      speechSynthesis.cancel();
    };
  }, []);

  /** Speaks text and resolves when finished (or immediately if voice is off). */
  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (!enabled || typeof speechSynthesis === "undefined" || !text.trim()) return resolve();
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (voiceRef.current) u.voice = voiceRef.current;
        u.rate = 1.02;
        const done = () => {
          setSpeaking(false);
          resolve();
        };
        u.onend = done;
        u.onerror = done;
        setSpeaking(true);
        speechSynthesis.speak(u);
        // Safety net: some browsers never fire onend.
        setTimeout(done, Math.max(4000, text.length * 90));
      }),
    [enabled],
  );

  const cancel = useCallback(() => {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { speaking, speak, cancel, enabled, setEnabled };
}

/* ------------------------------------------------------------------ */
/*  Session recording (chunks uploaded as they are produced)          */
/* ------------------------------------------------------------------ */

export function useRecorder(interviewId: string) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const seqRef = useRef(0);
  const [recording, setRecording] = useState(false);

  const start = useCallback(
    (stream: MediaStream) => {
      const candidates = stream.getAudioTracks().length
        ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) return false; // e.g. Safari: skip recording rather than store an unplayable file
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 900_000 });
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        const seq = seqRef.current++;
        chainRef.current = chainRef.current.then(() =>
          fetch(`/api/interviews/${interviewId}/recording`, { method: "POST", headers: { "x-seq": String(seq) }, body: e.data }).catch(() => {}),
        );
      };
      rec.start(4000);
      recorderRef.current = rec;
      setRecording(true);
      return true;
    },
    [interviewId],
  );

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.addEventListener("stop", () => resolve(), { once: true });
        rec.stop();
      });
    }
    recorderRef.current = null;
    setRecording(false);
    await chainRef.current;
  }, []);

  return { start, stop, recording };
}
