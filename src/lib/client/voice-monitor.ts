"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { averageEmbedding, computeFbank, cosineSimilarity, NUM_MEL_BINS, resampleTo16k, SAMPLE_RATE } from "../voice-id/fbank";
import { OtherVoicePolicy, type VoiceDecision } from "../voice-id/policy";
import { SpeechBuffer } from "../voice-id/speech-buffer";

/*
 * Voice monitoring: only the candidate may speak during the interview.
 * 1. Enrollment — the candidate reads a sentence; speaker embeddings of their speech form a profile.
 * 2. Monitoring — the microphone is screened by a speech detector (so music/noise is ignored); each
 *    2-second speech window is embedded and compared with the profile. Voices that don't match and
 *    are loud enough to be nearby are passed to OtherVoicePolicy (warn, then terminate).
 * Everything runs in the browser; audio and voice profiles never leave the device.
 */

export const ENROLLMENT_TEXT =
  "I'm taking this interview on my own. I will think out loud, explain my reasoning clearly, and ask a question whenever something is unclear. Today I'd like to show how I approach real problems.";

const ENROLL_SPEECH_SECONDS = 8;
const WINDOW = 2 * SAMPLE_RATE; // samples per speech window
const HOP = SAMPLE_RATE; // 1 s overlap between windows
const CHUNK = 512;
const VAD_CONTEXT = 64;
const SPEECH_PROBABILITY = 0.5;
const SUPPRESS_TAIL_MS = 800; // ignore the room echo right after the interviewer stops talking
const MIN_ENROLLMENT_CONSISTENCY = 0.55;

type Ort = typeof import("onnxruntime-web/wasm");

/** Loads the ONNX runtime and both models once; all inference is serialized through one queue. */
class VoiceEngine {
  private queue: Promise<unknown> = Promise.resolve();
  private vadState: import("onnxruntime-web/wasm").Tensor;
  private vadContext = new Float32Array(VAD_CONTEXT);

  private constructor(
    private readonly ort: Ort,
    private readonly vad: import("onnxruntime-web/wasm").InferenceSession,
    private readonly speaker: import("onnxruntime-web/wasm").InferenceSession,
  ) {
    this.vadState = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  }

  private static instance: Promise<VoiceEngine> | null = null;

  static load(): Promise<VoiceEngine> {
    VoiceEngine.instance ??= (async () => {
      // The WASM-only build, served from /voice/ort (the interviewer voice's worker uses the same files).
      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.wasmPaths = "/voice/ort/";
      // The runtime falls back to a single thread when multi-threading isn't available.
      ort.env.wasm.numThreads = navigator.hardwareConcurrency;
      const options = { executionProviders: ["wasm"] };
      const vad = await ort.InferenceSession.create("/voice/monitor/vad.onnx", options);
      const speaker = await ort.InferenceSession.create("/voice/monitor/speaker.onnx", options);
      return new VoiceEngine(ort, vad, speaker);
    })().catch((err) => {
      VoiceEngine.instance = null;
      throw err;
    });
    return VoiceEngine.instance;
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  resetSpeechDetector() {
    this.vadState = new this.ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    this.vadContext = new Float32Array(VAD_CONTEXT);
  }

  /** Probability that a 512-sample (32 ms) chunk contains speech. */
  speechProbability(chunk: Float32Array): Promise<number> {
    return this.run(async () => {
      const input = new Float32Array(VAD_CONTEXT + CHUNK);
      input.set(this.vadContext);
      input.set(chunk, VAD_CONTEXT);
      this.vadContext = chunk.slice(CHUNK - VAD_CONTEXT);
      const out = await this.vad.run({
        input: new this.ort.Tensor("float32", input, [1, input.length]),
        state: this.vadState,
        sr: new this.ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []),
      });
      this.vadState = out.stateN as typeof this.vadState;
      return (out.output.data as Float32Array)[0];
    });
  }

  /** Speaker embedding for 16 kHz speech. */
  embed(samples: Float32Array): Promise<Float32Array> {
    return this.run(async () => {
      const { data, frames } = computeFbank(samples);
      const out = await this.speaker.run({ input_features: new this.ort.Tensor("float32", data, [1, frames, NUM_MEL_BINS]) });
      return out[this.speaker.outputNames[0]].data as Float32Array;
    });
  }
}

const levelDb = (samples: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return 10 * Math.log10(sum / Math.max(1, samples.length) + 1e-12);
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : -60;
};

export type MonitorStatus = "loading" | "needs_enrollment" | "enrolling" | "ready" | "unavailable";

export function useVoiceMonitor(opts: {
  stream: MediaStream | null;
  /** True while monitoring should run (in session, not paused or closing). */
  active: boolean;
  /** True while the interviewer is speaking — its sound through the speakers must not be judged. */
  suppressed: boolean;
  onDecision: (decision: Exclude<VoiceDecision, { kind: "none" }>) => void;
  /** Called for every speech window that sounds like another person nearby (even before it's a confirmed detection). */
  onOtherVoiceSpeech?: (interval: { start: number; end: number; similarity: number }) => void;
}) {
  const { stream, active, suppressed, onDecision } = opts;
  const onOtherVoiceRef = useRef(opts.onOtherVoiceSpeech);
  onOtherVoiceRef.current = opts.onOtherVoiceSpeech;
  const [status, setStatus] = useState<MonitorStatus>("loading");
  const [error, setError] = useState("");
  const [enrollProgress, setEnrollProgress] = useState(0);
  const [warningEndsAt, setWarningEndsAt] = useState<number | null>(null);
  const [lastSimilarity, setLastSimilarity] = useState<number | null>(null);

  const engineRef = useRef<VoiceEngine | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ source: MediaStreamAudioSourceNode; worklet: AudioWorkletNode; sink: GainNode } | null>(null);
  const modeRef = useRef<"off" | "enrolling" | "monitoring">("off");
  const profileRef = useRef<{ embedding: Float32Array; levelDb: number } | null>(null);
  const policyRef = useRef<OtherVoicePolicy | null>(null);
  const enrollRef = useRef<{ embeddings: Float32Array[]; levels: number[]; voicedSamples: number }>({ embeddings: [], levels: [], voicedSamples: 0 });
  const speechRef = useRef(new SpeechBuffer({ windowSamples: WINDOW, hopSamples: HOP, sampleRate: SAMPLE_RATE }));
  const embeddingBusy = useRef(false);
  const suppressedUntil = useRef(0);
  const statusRef = useRef<MonitorStatus>("loading");
  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;

  const setMonitorStatus = (s: MonitorStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  // Load models as soon as the room opens.
  useEffect(() => {
    let cancelled = false;
    VoiceEngine.load()
      .then((engine) => {
        if (cancelled) return;
        engineRef.current = engine;
        setMonitorStatus(profileRef.current ? "ready" : "needs_enrollment");
      })
      .catch((err) => {
        console.warn("[voice-monitor] unavailable", err);
        if (!cancelled) {
          setError("Voice monitoring couldn't be loaded in this browser.");
          setMonitorStatus("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetSpeech = () => {
    speechRef.current.reset();
    engineRef.current?.resetSpeechDetector();
  };

  const finishEnrollment = useCallback(() => {
    const { embeddings, levels } = enrollRef.current;
    const profile = averageEmbedding(embeddings);
    const consistency = embeddings.reduce((s, e) => s + cosineSimilarity(e, profile), 0) / embeddings.length;
    modeRef.current = "off";
    if (consistency < MIN_ENROLLMENT_CONSISTENCY) {
      setError("We couldn't get a clear sample of only your voice (background noise or another voice?). Move somewhere quiet and try again.");
      setEnrollProgress(0);
      setMonitorStatus("needs_enrollment");
      return;
    }
    profileRef.current = { embedding: profile, levelDb: median(levels) };
    policyRef.current = new OtherVoicePolicy(profileRef.current.levelDb);
    setEnrollProgress(100);
    setMonitorStatus("ready");
  }, []);

  /** Handles one 2-second window of continuous speech. */
  const handleWindow = useCallback(
    async (window: Float32Array, windowLevel: number) => {
      const engine = engineRef.current;
      if (!engine || embeddingBusy.current) return; // drop rather than build a backlog
      embeddingBusy.current = true;
      try {
        const embedding = await engine.embed(window);
        if (modeRef.current === "enrolling") {
          const enroll = enrollRef.current;
          enroll.embeddings.push(embedding);
          enroll.levels.push(windowLevel);
          setEnrollProgress(Math.min(99, Math.round((enroll.voicedSamples / (ENROLL_SPEECH_SECONDS * SAMPLE_RATE)) * 100)));
          if (enroll.voicedSamples >= ENROLL_SPEECH_SECONDS * SAMPLE_RATE && enroll.embeddings.length >= 5) finishEnrollment();
        } else if (modeRef.current === "monitoring" && profileRef.current && policyRef.current) {
          const similarity = cosineSimilarity(embedding, profileRef.current.embedding);
          setLastSimilarity(similarity);
          const observed = { at: Date.now(), similarity, levelDb: windowLevel };
          if (policyRef.current.isOtherNearbyVoice(observed)) {
            // The 2 s of audio ended just before inference finished; widen slightly for processing time.
            onOtherVoiceRef.current?.({ start: observed.at - WINDOW / (SAMPLE_RATE / 1000) - 1000, end: observed.at, similarity });
          }
          const decision = policyRef.current.observe(observed);
          if (decision.kind === "warn") setWarningEndsAt(decision.warningEndsAt);
          if (decision.kind !== "none") onDecisionRef.current(decision);
        }
      } catch (err) {
        console.warn("[voice-monitor] embedding failed", err);
      } finally {
        embeddingBusy.current = false;
      }
    },
    [finishEnrollment],
  );

  /** Screens one 32 ms chunk and assembles speech windows. */
  const handleChunk = useCallback(
    async (raw: Float32Array, sampleRate: number) => {
      const engine = engineRef.current;
      if (!engine || modeRef.current === "off") return;
      if (modeRef.current === "monitoring" && Date.now() < suppressedUntil.current) return;
      const chunk = sampleRate === SAMPLE_RATE ? raw : resampleTo16k(raw, sampleRate);
      if (chunk.length !== CHUNK) return;

      const probability = await engine.speechProbability(chunk);
      const isSpeech = probability >= SPEECH_PROBABILITY;
      if (isSpeech && modeRef.current === "enrolling") enrollRef.current.voicedSamples += chunk.length;
      const window = speechRef.current.add(chunk, levelDb(chunk), isSpeech);
      if (window) void handleWindow(window.samples, window.levelDb);
    },
    [handleWindow],
  );

  /** Builds (or rebuilds after a mic change) the capture graph. Must first be called from a click. */
  const ensureCapture = useCallback(async () => {
    if (!stream?.getAudioTracks().length) throw new Error("No microphone");
    let ctx = ctxRef.current;
    if (!ctx) {
      try {
        ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      } catch {
        ctx = new AudioContext(); // resampled to 16 kHz per chunk instead
      }
      await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
      ctxRef.current = ctx;
    }
    if (ctx.state !== "running") await ctx.resume();
    const current = nodesRef.current;
    const track = stream.getAudioTracks()[0];
    if (current && (current.source.mediaStream.getAudioTracks()[0] === track)) return;
    current?.source.disconnect();
    current?.worklet.disconnect();
    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(new MediaStream([track]));
    } catch {
      // Some browsers can't feed a 16 kHz context from a 48 kHz microphone: fall back to the native rate.
      await ctx.close();
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
      await ctx.resume();
      ctxRef.current = ctx;
      source = ctx.createMediaStreamSource(new MediaStream([track]));
    }
    const worklet = new AudioWorkletNode(ctx, "pcm-capture");
    const sink = ctx.createGain();
    sink.gain.value = 0; // keep the graph pulling audio without playing the mic back
    const rate = ctx.sampleRate;
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => void handleChunk(e.data, rate);
    source.connect(worklet).connect(sink).connect(ctx.destination);
    nodesRef.current = { source, worklet, sink };
  }, [stream, handleChunk]);

  const startEnrollment = useCallback(async () => {
    if (statusRef.current !== "needs_enrollment" && statusRef.current !== "ready") return;
    setError("");
    try {
      await ensureCapture();
    } catch {
      setError("Your microphone isn't available — allow microphone access and try again.");
      return;
    }
    profileRef.current = null;
    enrollRef.current = { embeddings: [], levels: [], voicedSamples: 0 };
    resetSpeech();
    setEnrollProgress(0);
    modeRef.current = "enrolling";
    setMonitorStatus("enrolling");
  }, [ensureCapture]);

  const cancelEnrollment = useCallback(() => {
    modeRef.current = "off";
    setEnrollProgress(0);
    setMonitorStatus(profileRef.current ? "ready" : "needs_enrollment");
  }, []);

  // Rebuild capture on mic changes (e.g. camera/mic reconnect) once capture exists.
  useEffect(() => {
    if (ctxRef.current && stream) void ensureCapture().catch(() => undefined);
  }, [stream, ensureCapture]);

  // Monitoring runs only while active; the interviewer's own voice (plus echo tail) is skipped.
  useEffect(() => {
    if (suppressed) {
      suppressedUntil.current = Number.MAX_SAFE_INTEGER;
      resetSpeech();
    } else if (suppressedUntil.current === Number.MAX_SAFE_INTEGER) {
      suppressedUntil.current = Date.now() + SUPPRESS_TAIL_MS;
    }
  }, [suppressed]);

  useEffect(() => {
    if (statusRef.current !== "ready" || !profileRef.current) return;
    if (active && modeRef.current !== "monitoring") {
      resetSpeech();
      modeRef.current = "monitoring";
      void ensureCapture().catch(() => undefined);
    } else if (!active && modeRef.current === "monitoring") {
      modeRef.current = "off";
    }
  }, [active, status, ensureCapture]);

  useEffect(
    () => () => {
      modeRef.current = "off";
      nodesRef.current?.source.disconnect();
      nodesRef.current?.worklet.disconnect();
      void ctxRef.current?.close();
    },
    [],
  );

  const extendWarning = useCallback((ms: number) => {
    policyRef.current?.extendWarning(ms);
    setWarningEndsAt((end) => (end === null ? null : end + ms));
  }, []);

  return {
    status,
    error,
    enrollProgress,
    warningEndsAt,
    lastSimilarity,
    startEnrollment,
    cancelEnrollment,
    extendWarning,
  };
}
