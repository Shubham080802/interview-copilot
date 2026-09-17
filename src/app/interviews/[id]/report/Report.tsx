"use client";
import { ChevronDown, Download, FileJson, FileText, Mic, MicOff, Printer, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { Badge, Bar, Button, Card, cx, EmptyState, inputClass, Markdown, ScoreRing, scoreTone, Spinner } from "@/components/ui";
import { api, formatDate, REC_LABELS } from "@/lib/client/api";
import { useSpeechRecognition } from "@/lib/client/media";
import { useInterview, type InterviewData } from "@/lib/client/useInterview";
import { EVENT_LABELS } from "@/lib/integrity";
import { ROUND_LABELS, type QuestionEvaluation, type RetryEvaluation } from "@/lib/schemas";
import type { CoachMessage, InterviewResponse } from "@/lib/types";

type Tab = "summary" | "answers" | "coach" | "integrity" | "recording";

export function Report({ id }: { id: string }) {
  const { data, error, reload } = useInterview(id, (d) => d?.interview.status === "evaluating");
  const [tab, setTab] = useState<Tab>("summary");

  if (error) return <Card className="text-rose-700">{error}</Card>;
  if (!data) return <div className="flex items-center gap-2 text-slate-500"><Spinner /> Loading report…</div>;
  const { interview: i } = data;

  if (!i.evaluation) {
    return (
      <Card className="py-10 text-center">
        {i.status === "evaluating" ? (
          <><Spinner className="h-8 w-8 text-brand-600" /><p className="mt-4 font-medium">Evaluating your interview…</p></>
        ) : (
          <p>No evaluation yet. <Link href={`/interviews/${id}`} className="text-brand-600 underline">Go to interview</Link></p>
        )}
      </Card>
    );
  }

  const ev = i.evaluation;
  const tabs: { key: Tab; label: string }[] = [
    { key: "summary", label: "Summary" },
    { key: "answers", label: "Answers & practice" },
    { key: "coach", label: "Learning session" },
    { key: "integrity", label: `Integrity${data.proctorEvents.length ? ` (${data.proctorEvents.length})` : ""}` },
    ...(i.hasRecording ? [{ key: "recording" as Tab, label: "Recording" }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={ev.generatedBy === "ai" ? "green" : "amber"}>{ev.generatedBy === "ai" ? "AI evaluation" : "Demo evaluation"}</Badge>
            <Badge>{formatDate(i.createdAt)}</Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{i.config.role} at {i.config.company}</h1>
          <p className="text-sm text-slate-500">{i.config.rounds.map((r) => ROUND_LABELS[r]).join(" · ")}</p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <a href={`/api/interviews/${id}/export?format=json`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50"><FileJson className="h-4 w-4" /> JSON</a>
          <a href={`/api/interviews/${id}/export?format=md`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50"><FileText className="h-4 w-4" /> Markdown</a>
          <a href={`/api/interviews/${id}/export?format=html`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50"><Download className="h-4 w-4" /> HTML</a>
          <a href={`/api/interviews/${id}/export?format=html&print=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"><Printer className="h-4 w-4" /> Save as PDF</a>
        </div>
      </div>

      <div className="no-print flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx("whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition", tab === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary" && <Summary data={data} />}
      {tab === "answers" && <Answers data={data} onChange={reload} />}
      {tab === "coach" && <Coach id={id} demo={ev.generatedBy !== "ai"} />}
      {tab === "integrity" && <Integrity data={data} />}
      {tab === "recording" && (
        <div className="space-y-4">
          {i.recordingSegments.length > 1 && (
            <p className="text-sm text-slate-500">This recording has {i.recordingSegments.length} parts — a new part starts when the camera reconnects or the interview is resumed.</p>
          )}
          {i.recordingSegments.map((segment) => (
            <Card key={segment}>
              {i.recordingSegments.length > 1 && <div className="mb-2 text-sm font-medium">Part {segment}</div>}
              <video controls preload="metadata" src={`/api/interviews/${id}/recording?segment=${segment}`} className="w-full rounded-xl bg-black" />
              <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
                <span>Replay your interview to review body language, pace and clarity.</span>
                <a href={`/api/interviews/${id}/recording?segment=${segment}&download=1`} className="font-medium text-brand-600 hover:underline">Download video</a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Summary ------------------------------ */

function Summary({ data }: { data: InterviewData }) {
  const { interview: i } = data;
  const ev = i.evaluation!;
  const o = ev.overall;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card className="flex flex-wrap items-center gap-6">
          <ScoreRing score={o.overall_score} size={120} label="overall" />
          <div className="min-w-0 flex-1">
            <Badge tone={scoreTone(o.overall_score)} className="text-sm">{REC_LABELS[o.hire_recommendation]}</Badge>
            <h2 className="mt-2 text-lg font-semibold">{o.headline}</h2>
            <Markdown className="mt-1 text-slate-600">{o.summary}</Markdown>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold">Scores by round</h3>
          <div className="mt-4 space-y-4">
            {ev.rounds.map((r) => (
              <div key={r.round_type}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{ROUND_LABELS[r.round_type]}</span><span className="tabular-nums">{Math.round(r.round_score)}/100</span></div>
                <Bar value={r.round_score} />
                <p className="mt-1.5 text-sm text-slate-500">{r.summary}</p>
              </div>
            ))}
            <div>
              <div className="mb-1 flex justify-between text-sm"><span className="font-medium">Communication</span><span className="tabular-nums">{o.communication.score}/10</span></div>
              <Bar value={o.communication.score} max={10} />
              <p className="mt-1.5 text-sm text-slate-500">{o.communication.notes}</p>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold">How to improve — your action plan</h3>
          <ol className="mt-4 space-y-4">
            {o.action_plan.map((a, n) => (
              <li key={n} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{n + 1}</span>
                <div>
                  <div className="font-medium">{a.title}</div>
                  <p className="text-sm text-slate-600">{a.detail}</p>
                  {a.resources.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{a.resources.map((r) => <Badge key={r}>{r}</Badge>)}</div>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="space-y-6">
        <ListCard title="Top strengths" items={o.top_strengths} tone="green" />
        <ListCard title="Key gaps" items={o.key_gaps} tone="red" />
        <ListCard title="Your next interview will focus on" items={o.next_interview_focus} tone="brand" />
        {i.integrity && (
          <Card>
            <h3 className="font-semibold">Integrity</h3>
            <div className="mt-2 flex items-center gap-3">
              <ScoreRing score={i.integrity.score} size={64} />
              <Badge tone={i.integrity.level === "clean" ? "green" : i.integrity.level === "minor_flags" ? "amber" : "red"}>{i.integrity.level.replace("_", " ")}</Badge>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ListCard({ title, items, tone }: { title: string; items: string[]; tone: "green" | "red" | "brand" }) {
  const dot = { green: "bg-emerald-500", red: "bg-rose-500", brand: "bg-brand-500" }[tone];
  return (
    <Card>
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.length ? items.map((x) => <li key={x} className="flex gap-2 text-sm text-slate-700"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />{x}</li>) : <li className="text-sm text-slate-400">None</li>}
      </ul>
    </Card>
  );
}

/* ------------------------------ Answers ------------------------------ */

function Answers({ data, onChange }: { data: InterviewData; onChange: () => void }) {
  const evals = new Map(data.interview.evaluation!.rounds.flatMap((r) => r.question_evaluations).map((q) => [q.response_id, q]));
  const questions = new Map(data.interview.plan?.rounds.flatMap((r) => r.questions).map((q) => [q.id, q]));
  if (!data.responses.length) return <EmptyState title="No answers were recorded" />;
  return (
    <div className="space-y-4">
      {data.responses.map((r, n) => (
        <AnswerCard key={r.id} n={n + 1} response={r} evaluation={evals.get(r.id)} isCoding={questions.get(r.questionId)?.kind === "coding" && !r.isFollowUp} interviewId={data.interview.id} onChange={onChange} />
      ))}
    </div>
  );
}

function AnswerCard({ n, response: r, evaluation: e, isCoding, interviewId, onChange }: { n: number; response: InterviewResponse; evaluation?: QuestionEvaluation; isCoding: boolean; interviewId: string; onChange: () => void }) {
  const [open, setOpen] = useState(n === 1);
  const [practice, setPractice] = useState(false);
  return (
    <Card className={cx(r.isFollowUp && "ml-6 border-l-4 border-l-brand-200")}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 text-left">
        <span className="text-xs font-semibold text-slate-400">#{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="brand">{r.isFollowUp ? "Follow-up" : ROUND_LABELS[r.roundType]}</Badge>
            {e && <Badge tone={e.verdict === "strong" ? "green" : e.verdict === "acceptable" ? "amber" : "red"}>{e.verdict.replace("_", " ")}</Badge>}
            {r.retries.length > 0 && <Badge tone="blue">Practised {r.retries.length}× · best {Math.max(...r.retries.map((x) => x.result.score))}/10</Badge>}
          </div>
          <p className="mt-1.5 font-medium">{r.prompt}</p>
        </div>
        {e && <span className="text-xl font-semibold tabular-nums">{e.score}<span className="text-sm text-slate-400">/10</span></span>}
        <ChevronDown className={cx("mt-1 h-5 w-5 text-slate-400 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
          {r.clarifications && r.clarifications.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Clarifying questions you asked</div>
              <div className="space-y-2 rounded-lg bg-brand-50/50 p-3 text-sm">
                {r.clarifications.map((c, k) => (
                  <div key={k}>
                    <p className="text-slate-700"><strong>You:</strong> {c.question}</p>
                    <p className="text-brand-800"><strong>Interviewer:</strong> {c.reply}{c.gaveHint && <Badge tone="amber" className="ml-2">hint given</Badge>}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 flex flex-wrap gap-3 text-xs text-slate-500">
              <span className="font-semibold uppercase">Your answer</span>
              <span>{r.durationSec}s</span>
              {r.wordsPerMinute > 0 && <span>{r.wordsPerMinute} wpm</span>}
              <span>{r.fillerCount} filler words</span>
            </div>
            {r.skipped ? <p className="text-sm italic text-slate-400">Skipped</p> : <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{r.answerText || "(no verbal answer)"}</p>}
            {r.code && <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">{r.code}</pre>}
          </div>

          {e && (
            <div className="grid gap-4 md:grid-cols-3">
              <FeedbackList title="What went well" items={e.strengths} className="text-emerald-700" />
              <FeedbackList title="How to improve" items={e.improvements} className="text-amber-700" />
              <FeedbackList title="Missed points" items={e.missed_points} className="text-rose-700" />
            </div>
          )}
          {e?.coaching_tip && <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900"><strong>Coaching tip:</strong> {e.coaching_tip}</div>}
          {e?.model_answer && (
            <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium">Show model answer</summary>
              <Markdown className="mt-2 text-slate-700">{e.model_answer}</Markdown>
            </details>
          )}

          {r.retries.map((x, k) => (
            <div key={k} className="rounded-lg border border-sky-100 bg-sky-50/50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500"><span className="font-semibold uppercase">Practice attempt {k + 1} · {formatDate(x.at)}</span><Badge tone={x.result.improved ? "green" : "amber"}>{x.result.score}/10 {x.result.improved ? "▲ improved" : ""}</Badge></div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{x.answerText}</p>
              <Markdown className="mt-2 text-slate-700">{x.result.feedback}</Markdown>
            </div>
          ))}

          {practice ? (
            <PracticePanel interviewId={interviewId} response={r} isCoding={isCoding} onDone={() => { onChange(); }} onClose={() => setPractice(false)} />
          ) : (
            <Button variant="secondary" onClick={() => setPractice(true)}>Practice this question again</Button>
          )}
        </div>
      )}
    </Card>
  );
}

function FeedbackList({ title, items, className }: { title: string; items: string[]; className: string }) {
  return (
    <div>
      <div className={`mb-1 text-xs font-semibold uppercase ${className}`}>{title}</div>
      {items.length ? <ul className="space-y-1 text-sm text-slate-700">{items.map((x) => <li key={x}>• {x}</li>)}</ul> : <p className="text-sm text-slate-400">—</p>}
    </div>
  );
}

function PracticePanel({ interviewId, response, isCoding, onDone, onClose }: { interviewId: string; response: InterviewResponse; isCoding: boolean; onDone: () => void; onClose: () => void }) {
  const [answer, setAnswer] = useState("");
  const [code, setCode] = useState(response.code);
  const [language, setLanguage] = useState(response.codeLanguage || "javascript");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RetryEvaluation | null>(null);
  const [error, setError] = useState("");
  const sr = useSpeechRecognition(useCallback((t: string) => setAnswer((a) => (a ? `${a} ${t}` : t)), []));

  async function submit() {
    sr.stop();
    setBusy(true);
    setError("");
    try {
      setResult(await api<RetryEvaluation>(`/api/interviews/${interviewId}/retry`, { method: "POST", json: { responseId: response.id, answerText: answer, code: isCoding ? code : "" } }));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/30 p-4">
      <div className="text-sm font-medium">Practice attempt — use the feedback above and answer again</div>
      {isCoding && <div className="h-72"><CodeEditor value={code} onChange={setCode} language={language} onLanguageChange={setLanguage} /></div>}
      <textarea rows={6} className={inputClass} placeholder="Speak or type your improved answer…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
      {sr.interim && <p className="text-sm italic text-slate-500">{sr.interim}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {result && (
        <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
          <Badge tone={result.improved ? "green" : "amber"}>{result.score}/10 {result.improved ? "— improved!" : ""}</Badge>
          <Markdown className="mt-2">{result.feedback}</Markdown>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {sr.supported && (
          <Button variant="secondary" onClick={() => (sr.listening ? sr.stop() : sr.start())}>
            {sr.listening ? <><MicOff className="h-4 w-4" /> Stop</> : <><Mic className="h-4 w-4" /> Speak</>}
          </Button>
        )}
        <Button onClick={submit} disabled={busy || (!answer.trim() && !(isCoding && code.trim()))}>{busy ? <><Spinner /> Scoring…</> : "Get feedback"}</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

/* ------------------------------ Coach ------------------------------ */

const SUGGESTIONS = [
  "Walk me through my weakest answer and rewrite it the way a top candidate would.",
  "What patterns in how I communicate should I fix first?",
  "Give me a 7-day plan to fix the gaps from this interview.",
  "Ask me my weakest question again and critique my new answer.",
];

function Coach({ id, demo }: { id: string; demo: boolean }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<CoachMessage[]>(`/api/interviews/${id}/coach`).then(setMessages).catch(() => {});
  }, [id]);
  // Block body: scrollIntoView() returns a Promise in newer browsers, and an effect must not return one.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    setInput("");
    setStreaming(true);
    const user: CoachMessage = { id: `u${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() };
    const reply: CoachMessage = { id: `a${Date.now()}`, role: "assistant", content: "", createdAt: new Date().toISOString() };
    setMessages((m) => [...m, user, reply]);
    try {
      const res = await fetch(`/api/interviews/${id}/coach`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Coach unavailable");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, content: x.content + chunk } : x)));
      }
    } catch (e) {
      setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, content: `**Error:** ${(e as Error).message}` } : x)));
    } finally {
      setStreaming(false);
    }
  }

  async function clear() {
    if (!confirm("Clear this learning session's conversation?")) return;
    await api(`/api/interviews/${id}/coach`, { method: "DELETE" });
    setMessages([]);
  }

  return (
    <Card className="flex h-[70vh] flex-col p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div>
          <h3 className="font-semibold">Learning session with your AI coach</h3>
          <p className="text-xs text-slate-500">The coach has your full transcript, code, scores and proctoring log.{demo && " (Demo mode: limited canned replies.)"}</p>
        </div>
        {messages.length > 0 && <Button variant="ghost" onClick={clear}><Trash2 className="h-4 w-4" /></Button>}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-xl border border-slate-200 p-3 text-left text-sm text-slate-700 transition hover:border-brand-300 hover:bg-brand-50/40">{s}</button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[85%] rounded-2xl px-4 py-2.5", m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800")}>
              {m.role === "user" ? <p className="whitespace-pre-wrap text-sm">{m.content}</p> : m.content ? <Markdown>{m.content}</Markdown> : <Spinner className="text-slate-400" />}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-100 p-3">
        <input className={inputClass} placeholder="Ask how to improve an answer, request a drill, or ask for a re-interview…" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" disabled={streaming || !input.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </Card>
  );
}

/* ------------------------------ Integrity ------------------------------ */

function Integrity({ data }: { data: InterviewData }) {
  const report = data.interview.integrity;
  if (!data.interview.config.proctoring) return <EmptyState title="Proctoring was turned off for this interview" />;
  if (!report) return <EmptyState title="No integrity report" />;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="space-y-4">
        <div className="flex items-center gap-4">
          <ScoreRing score={report.score} size={96} label="integrity" />
          <div>
            <Badge tone={report.level === "clean" ? "green" : report.level === "minor_flags" ? "amber" : "red"}>{report.level.replace("_", " ")}</Badge>
            <p className="mt-1 text-sm text-slate-500">{report.awaySeconds}s away / out of frame</p>
          </div>
        </div>
        <ul className="space-y-1.5 text-sm text-slate-600">{report.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
        <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
          {Object.entries(report.counts).map(([k, v]) => (
            <div key={k} className="flex justify-between"><span>{EVENT_LABELS[k as keyof typeof EVENT_LABELS]}</span><span className="tabular-nums">{v}</span></div>
          ))}
        </div>
        <p className="text-xs text-slate-400">Automated signals, not proof of cheating. Review snapshots and the recording before drawing conclusions.</p>
      </Card>
      <div className="space-y-3 lg:col-span-2">
        {data.proctorEvents.length === 0 ? (
          <EmptyState title="No flags raised">Great — you stayed in frame and focused throughout.</EmptyState>
        ) : (
          data.proctorEvents.map((e) => (
            <Card key={e.id} className="flex gap-4 p-4">
              {e.snapshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/snapshots/${e.snapshot}`} alt="Proctoring snapshot" className="h-20 w-28 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="grid h-20 w-28 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs text-slate-400">No snapshot</div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{EVENT_LABELS[e.type]}</span>
                  <Badge tone={e.severity === "high" ? "red" : e.severity === "medium" ? "amber" : "slate"}>{e.severity}</Badge>
                </div>
                <p className="text-sm text-slate-600">{e.detail}</p>
                <p className="mt-1 text-xs text-slate-400">{new Date(e.at).toLocaleTimeString()}</p>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
