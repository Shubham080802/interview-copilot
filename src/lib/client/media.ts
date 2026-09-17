"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Camera + microphone                                                */
/* ------------------------------------------------------------------ */

export function useMediaStream() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");

  const currentRef = useRef<MediaStream | null>(null);
  const request = useCallback(async () => {
    setError("");
    // Release the previous (possibly ended or hijacked) camera before asking again.
    currentRef.current?.getTracks().forEach((t) => t.stop());
    if (process.env.NODE_ENV === "development" && new URLSearchParams(location.search).has("fakeCamera")) {
      const s = fakeStream();
      currentRef.current = s;
      setStream(s);
      return s;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        // Automatic gain control is off so a distant voice isn't boosted to the candidate's loudness
        // (voice monitoring uses relative loudness as a proximity signal).
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      currentRef.current = s;
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

/** Development-only synthetic camera + tone "microphone", for testing the room without hardware. */
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
  // Fake microphone: a quiet 440 Hz tone (starts once the page receives a click, as browsers require).
  // `window.__fakeMic.play(url)` also plays an audio clip "into" the microphone, for end-to-end tests.
  const audio = new AudioContext();
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0.05;
  const mic = audio.createMediaStreamDestination();
  tone.frequency.value = 440;
  tone.connect(gain).connect(mic);
  tone.start();
  document.addEventListener("pointerdown", () => void audio.resume(), { once: true, capture: true });
  (window as unknown as { __fakeMic: { play(url: string): Promise<void> } }).__fakeMic = {
    async play(url: string) {
      const buffer = await audio.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(mic);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    },
  };
  return new MediaStream([...canvas.captureStream(10).getVideoTracks(), ...mic.stream.getAudioTracks()]);
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

/** Dev-only: `window.__fakeSpeech(text)` delivers text as if speech recognition had heard it. */
const fakeSpeechListeners = new Set<(text: string, at: number) => void>();
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as unknown as { __fakeSpeech: (text: string) => void }).__fakeSpeech = (text: string) => {
    for (const listener of fakeSpeechListeners) listener(text, Date.now());
  };
}

/**
 * Browser speech recognition.
 * - `start()`/`stop()` control *capture*: while capturing, recognized text is delivered to `onFinal`
 *   (e.g. the answer box) and interim text is shown.
 * - With `keepAlive`, recognition keeps running while not capturing, and every final result is passed
 *   to `onTranscript` with its time — used to understand speech from other voices near the candidate.
 */
export function useSpeechRecognition(
  onFinal: (text: string) => void,
  opts: { keepAlive?: boolean; onTranscript?: (text: string, at: number) => void } = {},
) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const captureRef = useRef(false);
  const keepAliveRef = useRef(Boolean(opts.keepAlive));
  keepAliveRef.current = Boolean(opts.keepAlive);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const onTranscriptRef = useRef(opts.onTranscript);
  onTranscriptRef.current = opts.onTranscript;
  // Accumulated seconds the mic was captured (for speaking-pace metrics).
  const speakingMs = useRef(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  const shouldRun = () => captureRef.current || keepAliveRef.current;

  const ensureRunning = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (!text) continue;
          onTranscriptRef.current?.(text, Date.now());
          if (captureRef.current) onFinalRef.current(text);
        } else interimText += r[0].transcript;
      }
      setInterim(captureRef.current ? interimText : "");
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        captureRef.current = false;
        keepAliveRef.current = false;
        setError("Microphone access for speech recognition was blocked.");
      } else if (e.error === "network") {
        setError("Speech recognition needs an internet connection. You can type your answer instead.");
      }
    };
    // Chrome stops recognition after silences; restart while it's still wanted.
    rec.onend = () => {
      setInterim("");
      if (shouldRun()) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through */
        }
      }
      recRef.current = null;
      if (!captureRef.current) setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!getRecognitionCtor() || captureRef.current) return;
    setError("");
    captureRef.current = true;
    startedAt.current = Date.now();
    setListening(true);
    ensureRunning();
  }, [ensureRunning]);

  const stop = useCallback(() => {
    if (captureRef.current && startedAt.current) speakingMs.current += Date.now() - startedAt.current;
    captureRef.current = false;
    startedAt.current = null;
    setListening(false);
    setInterim("");
    if (!keepAliveRef.current) recRef.current?.stop();
  }, []);

  // Keep-alive can be switched on and off (e.g. only while an interview is in session).
  useEffect(() => {
    if (opts.keepAlive) ensureRunning();
    else if (!captureRef.current) recRef.current?.stop();
  }, [opts.keepAlive, ensureRunning]);

  useEffect(() => {
    if (!opts.onTranscript) return;
    const listener = (text: string, at: number) => {
      onTranscriptRef.current?.(text, at);
      if (captureRef.current) onFinalRef.current(text);
    };
    fakeSpeechListeners.add(listener);
    return () => {
      fakeSpeechListeners.delete(listener);
    };
  }, [opts.onTranscript]);

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
    captureRef.current = false;
    keepAliveRef.current = false;
    recRef.current?.stop();
  }, []);

  return { supported, listening, interim, error, start, stop, takeSpeakingSeconds };
}

/* ------------------------------------------------------------------ */
/*  Session recording (chunks uploaded as they are produced)          */
/* ------------------------------------------------------------------ */

export function useRecorder(interviewId: string) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const seqRef = useRef(0);
  const [recording, setRecording] = useState(false);

  const segmentRef = useRef(1);
  /**
   * Records the voice conversation (audio only — no video) into the given part number.
   * A new part is only needed when the interview is resumed after leaving the room.
   */
  const start = useCallback(
    (audioStream: MediaStream, segment: number) => {
      const mime = ["audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) return false; // e.g. Safari: skip recording rather than store an unplayable file
      const rec = new MediaRecorder(new MediaStream(audioStream.getAudioTracks()), { mimeType: mime, audioBitsPerSecond: 64_000 });
      segmentRef.current = segment;
      seqRef.current = 0;
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        const seq = seqRef.current++;
        const part = String(segment);
        chainRef.current = chainRef.current.then(() =>
          fetch(`/api/interviews/${interviewId}/recording`, { method: "POST", headers: { "x-seq": String(seq), "x-segment": part }, body: e.data }).catch(() => {}),
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

  return { start, stop, recording, segmentRef };
}
