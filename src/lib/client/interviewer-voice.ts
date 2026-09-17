"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { splitIntoSpeechChunks } from "../voice-text";

/*
 * The interview recording contains only the voice conversation: the candidate's microphone and
 * the interviewer's voice, mixed into one audio track. Browser speech synthesis can't be captured
 * by web pages, so the interviewer speaks with an in-browser neural voice (Piper TTS) whose audio
 * is played through Web Audio — to the speakers and into the recording at the same time.
 */

const VOICE_ID = "en_US-hfc_female-medium";
const WASM_PATHS = {
  onnxWasm: "/voice/ort/",
  piperData: "/voice/piper/piper_phonemize.data",
  piperWasm: "/voice/piper/piper_phonemize.wasm",
};

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

  decode(audio: Blob): Promise<AudioBuffer> {
    return audio.arrayBuffer().then((data) => this.ctx.decodeAudioData(data));
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

interface PiperSession {
  predict(text: string): Promise<Blob>;
}

/** Interviewer voice: neural voice mixed into the recording, with browser speech as a fallback. */
export function useInterviewerVoice() {
  const [status, setStatus] = useState<VoiceStatus>("loading");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const mixerRef = useRef<ConversationMixer | null>(null);
  const sessionRef = useRef<PiperSession | null>(null);
  const synthChain = useRef<Promise<unknown>>(Promise.resolve());
  const token = useRef(0);
  const statusRef = useRef<VoiceStatus>("loading");
  const browserVoice = useRef<SpeechSynthesisVoice | null>(null);

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
    setVoiceStatus("loading");
    setError("");
    setProgress(0);
    try {
      const tts = await import("@mintplex-labs/piper-tts-web");
      const session = await tts.TtsSession.create({
        voiceId: VOICE_ID,
        wasmPaths: WASM_PATHS,
        progress: (p: { loaded: number; total: number }) => {
          if (p.total > 1_000_000) setProgress(Math.min(99, Math.round((p.loaded / p.total) * 100)));
        },
      });
      sessionRef.current = session;
      setProgress(100);
      setVoiceStatus("ready");
    } catch (err) {
      console.warn("[voice] neural voice unavailable", err);
      setError("The interviewer voice couldn't be loaded, so the browser's built-in voice will be used — it can't be included in the recording.");
      setVoiceStatus("fallback");
    }
  }, []);

  useEffect(() => {
    void load();
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

  /** Speaks text and resolves when finished or cancelled. */
  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const myToken = ++token.current;
      setSpeaking(true);
      try {
        const session = sessionRef.current;
        const m = mixerRef.current;
        if (statusRef.current === "ready" && session && m) {
          // Synthesize sentences one after another (the runtime is single-session) while playing each as soon as it's ready.
          const buffers = splitIntoSpeechChunks(text).map((chunk) => {
            const next = synthChain.current.then(() => session.predict(chunk)).then((wav) => m.decode(wav));
            synthChain.current = next.catch(() => undefined);
            return next;
          });
          for (const pending of buffers) {
            if (myToken !== token.current) return;
            await m.play(await pending);
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
    [speakWithBrowser],
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
    cancel,
    enabled,
    setEnabled,
    retry: load,
    switchToBrowserVoice,
    /** Interviewer audio is included in the recording only with the neural voice. */
    recordsInterviewer: status === "ready",
    mixer,
  };
}
