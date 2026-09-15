"use client";
import {
  AlertTriangle,
  HelpCircle,
  Send,
  Camera,
  CheckCircle2,
  Circle,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { cx, Spinner } from "@/components/ui";
import { api, formatDuration } from "@/lib/client/api";
import { useMediaStream, useRecorder, useSpeaker, useSpeechRecognition } from "@/lib/client/media";
import { useProctoring, type FaceStatus } from "@/lib/client/proctoring";
import { CAMERA_PROBLEM_TEXT, PROBLEM_GRACE_MS, useCameraGuard, type CameraProblem } from "@/lib/client/camera-guard";
import { useInterview } from "@/lib/client/useInterview";
import { ROUND_LABELS, type FollowUp, type PlanQuestion, type RoundType } from "@/lib/schemas";
import type { Clarification, InterviewResponse } from "@/lib/types";

type Phase = "setup" | "intro" | "question" | "submitting" | "reacting" | "closing";

interface Turn {
  index: number;
  question: PlanQuestion;
  roundType: RoundType;
  prompt: string;
  isFollowUp: boolean;
  parentResponseId: string | null;
}

const FACE_LABEL: Record<FaceStatus, { text: string; tone: string }> = {
  loading: { text: "Starting face tracking…", tone: "text-slate-300" },
  ok: { text: "Face detected", tone: "text-emerald-400" },
  no_face: { text: "No face detected", tone: "text-rose-400" },
  multiple_faces: { text: "Multiple faces", tone: "text-rose-400" },
  looking_away: { text: "Looking away", tone: "text-amber-300" },
  unavailable: { text: "Face tracking unavailable", tone: "text-slate-400" },
};

export function InterviewRoom({ id }: { id: string }) {
  const router = useRouter();
  const { data, error: loadError } = useInterview(id);
  const media = useMediaStream();
  const speaker = useSpeaker();
  const recorder = useRecorder(id);

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [consent, setConsent] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [answer, setAnswer] = useState("");
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [caption, setCaption] = useState("");
  const [startedAt, setStartedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [autoListen, setAutoListen] = useState(true);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [actionError, setActionError] = useState("");
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [asking, setAsking] = useState(false);
  const srTarget = useRef<"answer" | "ask">("answer");
  const turnRef = useRef<Turn | null>(null);
  turnRef.current = turn;

  const interview = data?.interview;
  const plan = interview?.plan;
  const proctoringOn = Boolean(interview?.config.proctoring);
  const inSession = phase !== "setup";

  const items = useMemo(
    () => plan?.rounds.flatMap((r) => r.questions.map((q) => ({ question: q, roundType: r.type }))) ?? [],
    [plan],
  );

  const sr = useSpeechRecognition(
    useCallback((text: string) => {
      const append = (a: string) => (a ? `${a} ${text}` : text);
      if (srTarget.current === "ask") setAskText(append);
      else setAnswer(append);
    }, []),
  );

  const proctor = useProctoring({
    interviewId: id,
    video: videoEl,
    enabled: proctoringOn,
    active: inSession && phase !== "closing",
  });

  /* ------------------------ camera-on enforcement ------------------------ */
  // The interview only runs with a live, unblocked camera. The server enforces the same rule
  // through presence heartbeats, so answers can't be submitted with the camera off.
  const camera = useCameraGuard({
    interviewId: id,
    stream: media.stream,
    video: videoEl,
    heartbeat: interview?.status === "ready" || interview?.status === "in_progress",
  });
  const paused = inSession && phase !== "closing" && !camera.cameraOn;
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const pauseRef = useRef<{ since: number; reason: CameraProblem } | null>(null);

  const confirmPresence = useCallback(
    () =>
      fetch(`/api/interviews/${id}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraOn: camera.cameraOn }),
      }).catch(() => {}),
    [id, camera.cameraOn],
  );

  // Recording restarts as a new part whenever the camera stream is replaced (reconnect).
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const nextSegmentRef = useRef(1);
  const startRecording = useCallback(
    async (stream: MediaStream) => {
      if (!interview?.config.recordVideo) return;
      if (recordingStreamRef.current) await recorder.stop();
      if (recorder.start(stream, nextSegmentRef.current)) {
        nextSegmentRef.current += 1;
        recordingStreamRef.current = stream;
      }
    },
    [interview?.config.recordVideo, recorder],
  );

  useEffect(() => {
    if (inSession && phase !== "closing" && media.stream && recordingStreamRef.current && media.stream !== recordingStreamRef.current) {
      startRecording(media.stream);
    }
  }, [inSession, phase, media.stream, startRecording]);

  // Attach the camera stream to the <video>.
  useEffect(() => {
    if (videoEl && media.stream && videoEl.srcObject !== media.stream) videoEl.srcObject = media.stream;
  }, [videoEl, media.stream]);

  // Ask for camera as soon as the room opens.
  const requested = useRef(false);
  useEffect(() => {
    if (!requested.current) {
      requested.current = true;
      media.request();
    }
  }, [media]);

  // Clock for timers.
  useEffect(() => {
    if (!inSession) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [inSession]);

  // Warn before leaving mid-interview.
  useEffect(() => {
    if (!inSession || phase === "closing") return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [inSession, phase]);

  const say = useCallback(
    async (text: string) => {
      setCaption(text);
      await speaker.speak(text);
    },
    [speaker],
  );

  // Pause: stop listening/speaking, freeze the question timer, and log the gap when the camera returns.
  useEffect(() => {
    if (paused && !pauseRef.current) {
      const reason = camera.problem ?? "missing";
      // The problem started before its detection grace period elapsed; log the full gap.
      pauseRef.current = { since: Date.now() - PROBLEM_GRACE_MS[reason], reason };
      sr.stop();
      speaker.cancel();
      setAskOpen(false);
    } else if (!paused && pauseRef.current && phase !== "closing") {
      const { since, reason } = pauseRef.current;
      pauseRef.current = null;
      setStartedAt((s) => s + (Date.now() - since));
      proctor.recordCameraGap(since, CAMERA_PROBLEM_TEXT[reason].title);
      const current = turnRef.current;
      if (current && phase === "question") say(`Thanks, I can see you again. ${current.prompt}`);
    }
  }, [paused, phase, camera.problem, sr, speaker, proctor, say]);

  /* ----------------------------- flow ----------------------------- */

  const finish = useCallback(
    async (early: boolean) => {
      if (pauseRef.current) {
        proctor.recordCameraGap(pauseRef.current.since, CAMERA_PROBLEM_TEXT[pauseRef.current.reason].title);
        pauseRef.current = null;
      }
      setPhase("closing");
      sr.stop();
      if (!early && plan) await say(plan.closing_script);
      else speaker.cancel();
      await proctor.finalize();
      await recorder.stop();
      try {
        await api(`/api/interviews/${id}/finish`, { method: "POST", json: {} });
      } catch (e) {
        // "cannot be evaluated" happens when nothing was answered — just leave the room.
        console.warn(e);
      }
      media.stream?.getTracks().forEach((t) => t.stop());
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      router.push(`/interviews/${id}`);
    },
    [id, media.stream, plan, proctor, recorder, router, say, speaker, sr],
  );

  const goTo = useCallback(
    async (index: number) => {
      const item = items[index];
      if (!item) return finish(false);
      const previous = turnRef.current;
      const next: Turn = { index, question: item.question, roundType: item.roundType, prompt: item.question.prompt, isFollowUp: false, parentResponseId: null };
      setTurn(next);
      setAnswer("");
      setClarifications([]);
      setAskOpen(false);
      srTarget.current = "answer";
      setCode(item.question.starter_code ?? "");
      if (item.question.language_hint) setLanguage(item.question.language_hint.toLowerCase());
      setStartedAt(Date.now());
      setPhase("question");
      if (previous && previous.roundType !== item.roundType) {
        await say(`Great. Let's move on to the ${ROUND_LABELS[item.roundType]} round.`);
      }
      await say(item.question.prompt);
      if (autoListen && sr.supported && !pausedRef.current && turnRef.current?.index === index) sr.start();
    },
    [autoListen, finish, items, say, sr],
  );

  async function begin() {
    if (!interview || !plan || !media.stream) return;
    if (!camera.cameraOn) return setActionError("Turn your camera on to start — the interview runs with the camera on throughout.");
    setActionError("");
    // Request full screen synchronously inside the click (user gesture); never block on it.
    if (proctoringOn && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    try {
      await confirmPresence();
      await api(`/api/interviews/${id}/start`, { method: "POST", json: {} });
    } catch (e) {
      setActionError((e as Error).message);
      return;
    }
    nextSegmentRef.current = Math.max(0, ...interview.recordingSegments) + 1;
    await startRecording(media.stream);

    const answered = new Set((data?.responses ?? []).filter((r) => !r.isFollowUp).map((r) => r.questionId));
    setAnsweredCount(answered.size);
    const startIndex = items.findIndex((it) => !answered.has(it.question.id));
    setPhase("intro");
    await say(answered.size ? `Welcome back. Let's continue where we left off.` : plan.intro_script);
    await goTo(startIndex === -1 ? items.length : startIndex);
  }

  async function submit(skipped: boolean) {
    const current = turnRef.current;
    if (!current || pausedRef.current) return;
    sr.stop();
    speaker.cancel();
    setPhase("submitting");
    setActionError("");
    const isCoding = current.question.kind === "coding";
    try {
      await confirmPresence();
      const { response, followUp } = await api<{ response: InterviewResponse; followUp: FollowUp }>(`/api/interviews/${id}/responses`, {
        method: "POST",
        json: {
          questionId: current.question.id,
          roundType: current.roundType,
          prompt: current.prompt,
          isFollowUp: current.isFollowUp,
          parentResponseId: current.parentResponseId,
          answerText: skipped ? "" : answer,
          code: skipped || !isCoding || code.trim() === (current.question.starter_code ?? "").trim() ? "" : code,
          codeLanguage: isCoding ? language : "",
          skipped,
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          speakingSeconds: sr.takeSpeakingSeconds(),
          clarifications,
        },
      });
      if (!current.isFollowUp) setAnsweredCount((n) => n + 1);
      setPhase("reacting");

      if (followUp.ask_follow_up && followUp.follow_up_question && !skipped) {
        await say(followUp.acknowledgement);
        const next: Turn = { ...current, prompt: followUp.follow_up_question, isFollowUp: true, parentResponseId: response.id };
        setTurn(next);
        setAnswer("");
        setClarifications([]);
        setAskOpen(false);
        srTarget.current = "answer";
        setStartedAt(Date.now());
        setPhase("question");
        await say(followUp.follow_up_question);
        if (autoListen && sr.supported && !pausedRef.current && turnRef.current === next) sr.start();
      } else {
        await say(followUp.acknowledgement);
        await goTo(current.index + 1);
      }
    } catch (e) {
      setActionError((e as Error).message);
      setPhase("question");
    }
  }

  function openAsk() {
    sr.stop();
    speaker.cancel();
    srTarget.current = "ask";
    setAskText("");
    setAskOpen(true);
  }

  function closeAsk() {
    sr.stop();
    srTarget.current = "answer";
    setAskOpen(false);
  }

  async function sendClarification() {
    const current = turnRef.current;
    const question = askText.trim();
    if (!current || !question || pausedRef.current) return;
    sr.stop();
    setAsking(true);
    setActionError("");
    try {
      await confirmPresence();
      const c = await api<Clarification>(`/api/interviews/${id}/clarify`, {
        method: "POST",
        json: { questionId: current.question.id, prompt: current.prompt, question, previous: clarifications },
      });
      setClarifications((list) => [...list, c]);
      closeAsk();
      await say(c.reply);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  /* ----------------------------- render ----------------------------- */

  if (loadError) return <FullMessage>{loadError}</FullMessage>;
  if (!interview) return <FullMessage><Spinner /> Loading interview…</FullMessage>;
  if (!plan || !["ready", "in_progress"].includes(interview.status)) {
    return (
      <FullMessage>
        This interview isn&apos;t ready to be taken.{" "}
        <Link className="text-brand-400 underline" href={`/interviews/${id}`}>Back to overview</Link>
      </FullMessage>
    );
  }

  const q = turn?.question;
  const isCoding = q?.kind === "coding";
  const elapsed = Math.max(0, Math.round(((pauseRef.current?.since ?? now) - startedAt) / 1000));
  const limit = turn?.isFollowUp ? 150 : (q?.time_limit_seconds ?? 180);
  const overTime = elapsed > limit;
  const canAnswer = phase === "question";
  const face = FACE_LABEL[proctoringOn ? proctor.faceStatus : "unavailable"];

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{interview.config.role} · {interview.config.company}</div>
          <div className="text-xs text-slate-400">
            {turn ? `${ROUND_LABELS[turn.roundType]} round · Question ${Math.min(turn.index + 1, items.length)} of ${items.length}${turn.isFollowUp ? " · follow-up" : ""}` : `${items.length} questions`}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {inSession && (
            <span className={cx("rounded-full px-2.5 py-1 font-mono tabular-nums", overTime ? "bg-rose-500/20 text-rose-300" : "bg-white/10")}>
              {formatDuration(elapsed)} / {formatDuration(limit)}
            </span>
          )}
          <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1", camera.cameraOn ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
            {camera.cameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
            {camera.cameraOn ? "Camera on" : inSession ? "Camera off · paused" : "Camera off"}
          </span>
          {proctoringOn && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Proctored{proctor.flagCount > 0 && ` · ${proctor.flagCount} flag${proctor.flagCount > 1 ? "s" : ""}`}
            </span>
          )}
          {recorder.recording && <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-rose-300"><Circle className="h-2.5 w-2.5 animate-pulse fill-current" /> REC</span>}
          <button onClick={() => speaker.setEnabled(!speaker.enabled)} className="rounded-full bg-white/10 p-1.5 hover:bg-white/20" title={speaker.enabled ? "Mute interviewer voice" : "Unmute interviewer voice"}>
            {speaker.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          {inSession && phase !== "closing" && (
            <button
              onClick={() => confirm("End the interview now? Unanswered questions will be skipped and your answers will be evaluated.") && finish(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1.5 font-medium hover:bg-rose-700"
            >
              <PhoneOff className="h-3.5 w-3.5" /> End interview
            </button>
          )}
        </div>
      </header>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-12">
        {/* Left: interviewer + candidate video. Video keeps its tree position across phases. */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          {inSession && (
            <div className="relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-900 p-6 ring-1 ring-white/10">
              <div className={cx("grid h-20 w-20 place-items-center rounded-full bg-brand-600 text-2xl font-semibold", speaker.speaking && "pulse-ring")}>
                {plan.interviewer_name.slice(0, 1)}
              </div>
              <div className="mt-3 text-sm font-medium">{plan.interviewer_name}</div>
              <div className="text-xs text-slate-400">Interviewer · {interview.config.company}</div>
              <div className="mt-3 flex h-5 items-end gap-1">
                {[0, 1, 2, 3, 4].map((n) => (
                  <span key={n} className={cx("w-1 rounded-full bg-brand-400", speaker.speaking ? "speak-bar" : "h-1")} style={speaker.speaking ? { height: 20, animationDelay: `${n * 0.12}s` } : undefined} />
                ))}
              </div>
              {(phase === "submitting" || phase === "reacting") && !speaker.speaking && <div className="mt-2 flex items-center gap-2 text-xs text-slate-300"><Spinner className="h-3 w-3" /> thinking…</div>}
              {caption && speaker.speaking && (
                <div className="mt-3 line-clamp-3 max-w-md rounded-lg bg-black/40 px-3 py-2 text-center text-xs leading-relaxed text-slate-100">{caption}</div>
              )}
            </div>
          )}

          <div className="relative aspect-video overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
            <video ref={setVideoEl} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            {!media.stream && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">
                {media.error ? (
                  <div>
                    <p className="text-rose-300">{media.error}</p>
                    <button onClick={media.request} className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-slate-100 hover:bg-white/20">Try again</button>
                  </div>
                ) : (
                  <span className="flex items-center gap-2"><Spinner /> Waiting for camera permission…</span>
                )}
              </div>
            )}
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-2.5 py-1 text-xs">
              <Video className="h-3.5 w-3.5" /> You
              {proctoringOn && <span className={face.tone}>· {face.text}</span>}
            </div>
            {sr.listening && (
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-rose-600/90 px-2.5 py-1 text-xs"><Mic className="h-3.5 w-3.5" /> Listening</div>
            )}
            {proctor.warning && inSession && (
              <div className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg bg-amber-500/95 px-3 py-2 text-xs font-medium text-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {proctor.warning.message}
              </div>
            )}
          </div>

          {inSession && interview.zoom && (
            <a href={interview.zoom.joinUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-white/5 px-4 py-3 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-white/10">
              Zoom meeting for panelists: <span className="text-brand-300 underline">{interview.zoom.joinUrl}</span>
            </a>
          )}
        </div>

        {/* Right: setup checklist or question + answer */}
        <div className="relative flex flex-col gap-4 lg:col-span-7">
          {paused && camera.problem && (
            <div role="alertdialog" aria-labelledby="camera-paused-title" className="absolute inset-0 z-20 flex justify-center rounded-2xl bg-slate-950 p-6 ring-1 ring-rose-500/40">
              <div className="sticky top-24 h-fit max-w-md pt-6 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-500/15"><VideoOff className="h-7 w-7 text-rose-300" /></div>
                <h2 id="camera-paused-title" className="mt-4 text-lg font-semibold">{CAMERA_PROBLEM_TEXT[camera.problem].title} — interview paused</h2>
                <p className="mt-2 text-sm text-slate-300">{CAMERA_PROBLEM_TEXT[camera.problem].help}</p>
                <p className="mt-2 text-xs text-slate-500">This interview runs with the camera on at all times. The question is hidden and the timer is stopped until your camera is back; the gap is recorded in your integrity report.</p>
                {(camera.problem === "ended" || camera.problem === "muted" || camera.problem === "missing") && (
                  <button onClick={media.request} className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold hover:bg-brand-500">
                    <Camera className="h-4 w-4" /> Reconnect camera
                  </button>
                )}
                {media.error && <p className="mt-3 text-sm text-rose-300">{media.error}</p>}
              </div>
            </div>
          )}
          {!inSession ? (
            <SetupPanel
              name={plan.interviewer_name}
              questionCount={items.length}
              resumed={(data?.responses.length ?? 0) > 0}
              cameraReady={camera.cameraOn}
              cameraProblem={camera.problem}
              speechSupported={sr.supported}
              faceStatus={proctoringOn ? proctor.faceStatus : null}
              proctoring={proctoringOn}
              recording={interview.config.recordVideo}
              consent={consent}
              setConsent={setConsent}
              autoListen={autoListen}
              setAutoListen={setAutoListen}
              onStart={begin}
              error={actionError}
            />
          ) : phase === "intro" || !turn ? (
            <div className="grid flex-1 place-items-center rounded-2xl bg-white/5 p-8 text-center ring-1 ring-white/10">
              <div>
                <p className="text-lg font-medium">{phase === "closing" ? "Wrapping up…" : "Your interviewer is introducing the session"}</p>
                <p className="mt-2 max-w-lg text-sm text-slate-400">{caption}</p>
                {phase === "closing" && <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-300"><Spinner /> Saving your answers, recording and proctoring log</div>}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-brand-500/20 px-2 py-0.5 font-medium text-brand-200">{turn.isFollowUp ? "Follow-up" : ROUND_LABELS[turn.roundType]}</span>
                  {!turn.isFollowUp && <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-300">{q?.topic}</span>}
                  {!turn.isFollowUp && <span className="rounded-full bg-white/10 px-2 py-0.5 capitalize text-slate-300">{q?.difficulty}</span>}
                  <button onClick={openAsk} disabled={!canAnswer || askOpen || clarifications.length >= 5} className="ml-auto inline-flex items-center gap-1 text-slate-400 hover:text-white disabled:opacity-40" title="Ask the interviewer about constraints, scope or assumptions">
                    <HelpCircle className="h-3.5 w-3.5" /> Ask a question
                  </button>
                  <button onClick={() => say(turn.prompt)} disabled={speaker.speaking} className="inline-flex items-center gap-1 text-slate-400 hover:text-white disabled:opacity-40">
                    <RotateCcw className="h-3.5 w-3.5" /> Repeat
                  </button>
                  {speaker.speaking && <button onClick={speaker.cancel} className="text-slate-400 hover:text-white">Skip reading</button>}
                </div>
                <p className="mt-3 text-lg leading-relaxed">{turn.prompt}</p>
                {overTime && <p className="mt-2 text-xs text-rose-300">You&apos;re over the suggested time — start wrapping up your answer.</p>}

                {clarifications.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
                    {clarifications.map((c, n) => (
                      <div key={n} className="space-y-1 text-sm">
                        <p className="text-slate-300"><span className="font-medium text-slate-100">You:</span> {c.question}</p>
                        <p className="text-brand-200"><span className="font-medium">{plan.interviewer_name}:</span> {c.reply}</p>
                      </div>
                    ))}
                  </div>
                )}

                {askOpen && (
                  <div className="mt-4 rounded-xl bg-black/30 p-3 ring-1 ring-brand-500/40">
                    <label className="text-xs text-slate-400" htmlFor="ask-input">Clarifying question for {plan.interviewer_name} — scope, constraints, input size, assumptions…</label>
                    <div className="mt-2 flex gap-2">
                      <input
                        id="ask-input"
                        autoFocus
                        value={askText}
                        onChange={(e) => setAskText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendClarification()}
                        placeholder={sr.supported ? "Type or use the mic…" : "Type your question…"}
                        className="min-w-0 flex-1 rounded-lg bg-black/40 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-brand-500"
                      />
                      {sr.supported && (
                        <button onClick={() => (sr.listening ? sr.stop() : sr.start())} className={cx("rounded-lg px-2.5", sr.listening ? "bg-rose-600" : "bg-white/10 hover:bg-white/20")} title={sr.listening ? "Stop mic" : "Speak your question"}>
                          {sr.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </button>
                      )}
                      <button onClick={sendClarification} disabled={asking || !askText.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium hover:bg-brand-500 disabled:opacity-40">
                        {asking ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />} Ask
                      </button>
                      <button onClick={closeAsk} className="rounded-lg px-2 text-sm text-slate-400 hover:text-white">Cancel</button>
                    </div>
                    {sr.interim && <p className="mt-2 text-xs italic text-slate-400">{sr.interim}</p>}
                  </div>
                )}
              </div>

              {isCoding && (
                <div className="h-[340px]">
                  <CodeEditor value={code} onChange={setCode} language={language} onLanguageChange={setLanguage} />
                </div>
              )}

              <div className="flex flex-1 flex-col rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                  <span>{isCoding ? "Explain your approach (speak or type)" : "Your answer (speak or type)"}</span>
                  {sr.error && <span className="text-amber-300">{sr.error}</span>}
                </div>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  disabled={!canAnswer}
                  placeholder={sr.supported ? "Press the microphone and start speaking — your words appear here. You can also type." : "Type your answer here (voice answers need Chrome or Edge)."}
                  className={cx("w-full flex-1 resize-none rounded-xl bg-black/30 p-3 text-sm leading-relaxed text-slate-100 outline-none ring-1 ring-white/10 placeholder:text-slate-500 focus:ring-brand-500", isCoding ? "min-h-[90px]" : "min-h-[180px]")}
                />
                {sr.interim && !askOpen && <p className="mt-2 text-sm italic text-slate-400">{sr.interim}</p>}
                {actionError && <p className="mt-2 text-sm text-rose-300">{actionError}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {sr.supported && (
                    <button
                      onClick={() => {
                        if (sr.listening) return sr.stop();
                        closeAsk();
                        sr.start();
                      }}
                      disabled={!canAnswer || speaker.speaking}
                      className={cx("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-40", sr.listening ? "bg-rose-600 hover:bg-rose-700" : "bg-white/10 hover:bg-white/20")}
                    >
                      {sr.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      {sr.listening ? "Stop mic" : "Answer by voice"}
                    </button>
                  )}
                  <span className="text-xs text-slate-500">{answeredCount} of {items.length} answered</span>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => submit(true)} disabled={!canAnswer} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40">
                      <SkipForward className="h-4 w-4" /> Skip
                    </button>
                    <button
                      onClick={() => submit(false)}
                      disabled={!canAnswer || (!answer.trim() && !(isCoding && code.trim() && code !== (q?.starter_code ?? "")))}
                      className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2 text-sm font-medium hover:bg-brand-500 disabled:opacity-40"
                    >
                      {phase === "submitting" ? <Spinner className="h-4 w-4" /> : null}
                      Submit answer
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FullMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center gap-2 bg-slate-950 p-6 text-slate-300">{children}</div>;
}

function SetupPanel(props: {
  name: string;
  questionCount: number;
  resumed: boolean;
  cameraReady: boolean;
  cameraProblem: CameraProblem | null;
  speechSupported: boolean;
  faceStatus: FaceStatus | null;
  proctoring: boolean;
  recording: boolean;
  consent: boolean;
  setConsent: (v: boolean) => void;
  autoListen: boolean;
  setAutoListen: (v: boolean) => void;
  onStart: () => void;
  error: string;
}) {
  const needsConsent = props.proctoring || props.recording;
  const faceOk = props.faceStatus === null || props.faceStatus === "ok" || props.faceStatus === "unavailable";
  const checks = [
    {
      ok: props.cameraReady,
      label: props.cameraReady ? "Camera and microphone on — keep the camera on for the whole interview" : props.cameraProblem ? `${CAMERA_PROBLEM_TEXT[props.cameraProblem].title}. ${CAMERA_PROBLEM_TEXT[props.cameraProblem].help}` : "Waiting for your camera",
      icon: Camera,
    },
    { ok: props.speechSupported, label: props.speechSupported ? "Voice answers supported" : "Voice answers need Chrome/Edge — you can type instead", icon: Mic, optional: true },
    ...(props.proctoring
      ? [{ ok: props.faceStatus === "ok", label: props.faceStatus === "unavailable" ? "Face tracking unavailable — other proctoring checks stay active" : props.faceStatus === "ok" ? "Your face is clearly visible" : "Position yourself so only your face is in frame", icon: ShieldCheck, optional: props.faceStatus === "unavailable" }]
      : []),
  ];

  return (
    <div className="flex flex-1 flex-col rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
      <h1 className="text-xl font-semibold">{props.resumed ? "Resume your interview" : "Get ready for your interview"}</h1>
      <p className="mt-1 text-sm text-slate-400">{props.name} will ask {props.questionCount} questions out loud. Answer by voice or by typing; coding questions open an editor.</p>

      <ul className="mt-6 space-y-3">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-3 text-sm">
            {c.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : c.optional ? <AlertTriangle className="h-5 w-5 text-amber-300" /> : <XCircle className="h-5 w-5 text-slate-500" />}
            <span className={c.ok ? "" : "text-slate-300"}>{c.label}</span>
          </li>
        ))}
      </ul>

      {props.speechSupported && (
        <label className="mt-6 flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="accent-brand-500" checked={props.autoListen} onChange={(e) => props.setAutoListen(e.target.checked)} />
          Hands-free: start the microphone automatically after each question
        </label>
      )}

      {needsConsent && (
        <label className="mt-4 flex items-start gap-2 rounded-xl bg-black/30 p-3 text-sm text-slate-300 ring-1 ring-white/10">
          <input type="checkbox" className="mt-0.5 accent-brand-500" checked={props.consent} onChange={(e) => props.setConsent(e.target.checked)} />
          <span>
            I understand this session is {props.proctoring && "proctored (camera face tracking, tab/focus changes, full screen and paste monitoring, with snapshots when something is flagged)"}
            {props.proctoring && props.recording && " and "}
            {props.recording && "recorded"}. Everything is stored locally on this computer.
          </span>
        </label>
      )}

      {props.error && <p className="mt-4 text-sm text-rose-300">{props.error}</p>}

      <div className="mt-auto flex items-center justify-between gap-3 pt-6">
        <span className="text-xs text-slate-500">{props.proctoring ? "The interview opens in full screen." : ""}{!faceOk && props.cameraReady ? " Waiting for a clear view of your face…" : ""}</span>
        <button
          onClick={props.onStart}
          disabled={!props.cameraReady || (needsConsent && !props.consent)}
          className="rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold hover:bg-brand-500 disabled:opacity-40"
        >
          {props.resumed ? "Resume interview" : "Start interview"}
        </button>
      </div>
    </div>
  );
}
