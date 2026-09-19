"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { INTERVIEWER_VOICE_IDS } from "../schemas";
import { KOKORO_SAMPLE_RATE, KokoroEngine } from "../voice/kokoro";
import { splitIntoSpeechChunks, trimSilence } from "../voice-text";

/*
 * The interview recording contains only the voice conversation: the candidate's microphone and
 * the interviewer's voice, mixed into one audio track. Browser speech synthesis can't be captured
 * by web pages, so the interviewer speaks with an in-browser natural voice (Kokoro) whose audio is
 * played through Web Audio — to the speakers and into the recording at the same time.
 */

/** Mixes the interviewer's voice and the candidate's microphone into one recordable audio stream. */
export class ConversationMixer {
  readonly ctx: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly voiceBus: GainNode;
  private readonly speakers: GainNode;
  private mic: MediaStreamAudioSourceNode | null = null;
  private readonly playing = new Set<AudioBufferSourceNode>();

  constructor() {
    this.ctx = new AudioContext();
    this.destination = this.ctx.createMediaStreamDestination();
    this.voiceBus = this.ctx.createGain();
    this.speakers = this.ctx.createGain();
    this.voiceBus.connect(this.destination); // into the recording
    this.voiceBus.connect(this.speakers); // and out loud
    this.speakers.connect(this.ctx.destination);
  }

  /** Stable stream for MediaRecorder; microphone changes (reconnects) don't interrupt it. */
  get recordStream(): MediaStream {
    return this.destination.stream;
  }

  resume(): Promise<void> {
    return this.ctx.state === "running" ? Promise.resolve() : this.ctx.resume();
  }

  /** The candidate's mic goes into the recording only — never to the speakers (no echo). */
  setMicrophone(stream: MediaStream | null) {
    this.mic?.disconnect();
    this.mic = null;
    const tracks = stream?.getAudioTracks().filter((t) => t.readyState === "live") ?? [];
    if (!tracks.length) return;
    this.mic = this.ctx.createMediaStreamSource(new MediaStream(tracks));
    this.mic.connect(this.destination);
  }

  setSpeakerVolume(volume: number) {
    this.speakers.gain.value = volume;
  }

  /** Wraps raw mono samples as an AudioBuffer (resampled by Web Audio on playback). */
  bufferFrom(samples: Float32Array, sampleRate: number): AudioBuffer {
    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    return buffer;
  }

  play(buffer: AudioBuffer): Promise<void> {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceBus);
    this.playing.add(source);
    return new Promise((resolve) => {
      source.onended = () => {
        this.playing.delete(source);
        source.disconnect();
        resolve();
      };
      source.start();
    });
  }

  stop() {
    for (const source of this.playing) {
      try {
        source.stop(); // fires onended, which resolves play()
      } catch {
        /* already stopped */
      }
    }
  }

  close() {
    this.stop();
    this.mic?.disconnect();
    void this.ctx.close();
  }
}

export type VoiceStatus = "loading" | "ready" | "fallback";

/** Natural-sounding interviewer voices (Kokoro). */
export const INTERVIEWER_VOICES: Record<InterviewerVoiceId, string> = {
  af_heart: "Heart — US English, female",
  am_michael: "Michael — US English, male",
  af_bella: "Bella — US English, female",
  bf_emma: "Emma — UK English, female",
};
export type InterviewerVoiceId = (typeof INTERVIEWER_VOICE_IDS)[number];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** People pause briefly between sentences; a little variation keeps it from sounding mechanical. */
const sentencePause = () => 250 + Math.random() * 200;

/**
 * Interviewer voice: the Kokoro natural voice, mixed into the conversation recording, with the
 * browser's built-in voice as a fallback. Known lines can be prepared ahead of time so the
 * interviewer starts speaking without a synthesis delay.
 */
export function useInterviewerVoice(voiceId: InterviewerVoiceId | null) {
  const [status, setStatus] = useState<VoiceStatus>("loading");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const mixerRef = useRef<ConversationMixer | null>(null);
  const engineRef = useRef<KokoroEngine | null>(null);
  const token = useRef(0);
  const statusRef = useRef<VoiceStatus>("loading");
  const browserVoice = useRef<SpeechSynthesisVoice | null>(null);
  // Synthesized sentences, and requests in flight, keyed by text.
  const audioCache = useRef(new Map<string, Promise<AudioBuffer>>());
  const liveRequests = useRef(0);
  // Background preparation runs one sentence at a time, so live speech never waits behind a batch.
  const prepareChain = useRef<Promise<unknown>>(Promise.resolve());
  const loadSeq = useRef(0);

  const setVoiceStatus = (s: VoiceStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  // Audio graph for the recording (always available, even with the browser-voice fallback).
  const [mixer, setMixer] = useState<ConversationMixer | null>(null);
  useEffect(() => {
    const m = new ConversationMixer();
    mixerRef.current = m;
    setMixer(m);
    return () => {
      m.close();
      mixerRef.current = null;
    };
  }, []);

  useEffect(() => {
    mixerRef.current?.setSpeakerVolume(enabled ? 1 : 0);
  }, [enabled, mixer]);

  const load = useCallback(async () => {
    if (!voiceId) return; // wait until the interview (and its chosen voice) is known
    const seq = ++loadSeq.current;
    setVoiceStatus("loading");
    setError("");
    setProgress(0);
    engineRef.current?.dispose();
    engineRef.current = null;
    audioCache.current.clear();
    try {
      const engine = await KokoroEngine.load(voiceId, (loaded, total) => {
        if (seq === loadSeq.current && total > 1_000_000) setProgress(Math.min(99, Math.round((loaded / total) * 100)));
      });
      if (seq !== loadSeq.current) return engine.dispose(); // a newer load (another voice) superseded this one
      engineRef.current = engine;
      setProgress(100);
      setVoiceStatus("ready");
    } catch (err) {
      if (seq !== loadSeq.current) return;
      console.warn("[voice] natural voice unavailable", err);
      setError("The interviewer voice couldn't be loaded, so the browser's built-in voice will be used — it can't be included in the recording.");
      setVoiceStatus("fallback");
    }
  }, [voiceId]);

  useEffect(() => {
    void load();
    return () => {
      loadSeq.current++;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [load]);

  // Browser voice for the fallback path.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      const preferred = ["Google US English", "Samantha", "Microsoft Aria Online (Natural) - English (United States)", "Microsoft Jenny Online (Natural) - English (United States)"];
      browserVoice.current =
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

  const speakWithBrowser = useCallback(
    (text: string, myToken: number) =>
      new Promise<void>((resolve) => {
        if (!enabled || typeof speechSynthesis === "undefined") return resolve();
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (browserVoice.current) u.voice = browserVoice.current;
        u.rate = 1.02;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          resolve();
        };
        u.onend = done;
        u.onerror = done;
        speechSynthesis.speak(u);
        setTimeout(done, Math.max(4000, text.length * 90)); // some browsers never fire onend
        if (myToken !== token.current) done();
      }),
    [enabled],
  );

  /**
   * Audio for one sentence. Live requests (someone is waiting to hear it) go first; background
   * preparation yields to them between sentences.
   */
  const sentenceAudio = useCallback((sentence: string, live: boolean): Promise<AudioBuffer> => {
    const cached = audioCache.current.get(sentence);
    if (cached) return cached;
    const engine = engineRef.current;
    const m = mixerRef.current;
    if (!engine || !m) return Promise.reject(new Error("voice not ready"));
    const synthesize = async () => m.bufferFrom(trimSilence(await engine.synthesize(sentence), KOKORO_SAMPLE_RATE), KOKORO_SAMPLE_RATE);
    let request: Promise<AudioBuffer>;
    if (live) {
      liveRequests.current++;
      request = synthesize().finally(() => liveRequests.current--);
    } else {
      request = prepareChain.current.then(async () => {
        while (liveRequests.current > 0) await sleep(60); // yield to anything someone is waiting to hear
        return synthesize();
      });
      prepareChain.current = request.catch(() => undefined);
    }
    audioCache.current.set(sentence, request);
    request.catch(() => audioCache.current.delete(sentence));
    // Keep memory bounded: forget the oldest prepared sentences.
    if (audioCache.current.size > 60) audioCache.current.delete(audioCache.current.keys().next().value!);
    return request;
  }, []);

  /** Synthesizes lines in the background so they play instantly when spoken later. */
  const prepare = useCallback(
    (lines: string[]) => {
      if (statusRef.current !== "ready") return;
      for (const line of lines) for (const sentence of splitIntoSpeechChunks(line)) void sentenceAudio(sentence, false).catch(() => undefined);
    },
    [sentenceAudio],
  );

  /** Speaks text and resolves when finished or cancelled. */
  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const myToken = ++token.current;
      setSpeaking(true);
      try {
        const m = mixerRef.current;
        if (statusRef.current === "ready" && engineRef.current && m) {
          const sentences = splitIntoSpeechChunks(text);
          // Request every sentence now (first one first) and play each as soon as it's ready.
          const pending = sentences.map((sentence) => sentenceAudio(sentence, true));
          for (let i = 0; i < pending.length; i++) {
            if (myToken !== token.current) return;
            const buffer = await pending[i];
            if (myToken !== token.current) return;
            await m.play(buffer);
            if (i < pending.length - 1) await sleep(sentencePause());
          }
        } else {
          await speakWithBrowser(text, myToken);
        }
      } catch (err) {
        console.warn("[voice] synthesis failed, using browser voice", err);
        if (myToken === token.current) await speakWithBrowser(text, myToken);
      } finally {
        if (myToken === token.current) setSpeaking(false);
      }
    },
    [sentenceAudio, speakWithBrowser],
  );

  const cancel = useCallback(() => {
    token.current++;
    mixerRef.current?.stop();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const switchToBrowserVoice = useCallback(() => {
    setError("");
    setVoiceStatus("fallback");
  }, []);

  return {
    status,
    progress,
    error,
    speaking,
    speak,
    prepare,
    cancel,
    enabled,
    setEnabled,
    retry: load,
    switchToBrowserVoice,
    /** Interviewer audio is included in the recording only with the natural voice. */
    recordsInterviewer: status === "ready",
    mixer,
  };
}
