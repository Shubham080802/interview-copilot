"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge, Button, Card, LinkButton, Markdown, Spinner } from "@/components/ui";
import { api, formatDate } from "@/lib/client/api";
import { useInterview } from "@/lib/client/useInterview";
import { ROUND_LABELS } from "@/lib/schemas";
import { isWebLink } from "@/lib/types";

const PREP_STEPS = ["Loading your interview history", "Creating Zoom meeting", "Researching", "Designing", "Ready"];

export function InterviewOverview({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, reload } = useInterview(id, (d) => !d || d.interview.status === "preparing" || d.interview.status === "evaluating");
  const [busy, setBusy] = useState(false);

  const status = data?.interview.status;
  useEffect(() => {
    if (status === "completed" || status === "cancelled") router.replace(`/interviews/${id}/report`);
  }, [status, id, router]);

  if (error) return <Card className="text-rose-700">{error}</Card>;
  if (!data) return <div className="flex items-center gap-2 text-slate-500"><Spinner /> Loading…</div>;
  const { interview: i, responses } = data;

  async function action(url: string, body?: unknown) {
    setBusy(true);
    try {
      await api(url, { method: "POST", json: body ?? {} });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this interview, its answers, recording and snapshots? This cannot be undone.")) return;
    await api(`/api/interviews/${id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  const totalQuestions = i.plan?.rounds.reduce((s, r) => s + r.questions.length, 0) ?? 0;
  const stepIndex = Math.max(0, PREP_STEPS.findIndex((s) => i.prepStage.startsWith(s)));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><StatusBadge status={i.status} />{i.generatedBy && <Badge tone={i.generatedBy === "ai" ? "green" : "amber"}>{i.generatedBy === "ai" ? "AI generated" : "Demo bank"}</Badge>}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{i.config.role} at {i.config.company}</h1>
          <p className="text-sm text-slate-500">{i.config.field} · {i.config.seniority} · created {formatDate(i.createdAt)}</p>
        </div>
        <Button variant="ghost" onClick={remove} className="text-rose-600">Delete</Button>
      </div>

      {i.status === "preparing" && (
        <Card className="py-10 text-center">
          <Spinner className="h-8 w-8 text-brand-600" />
          <h2 className="mt-4 text-lg font-semibold">Preparing your interview</h2>
          <p className="mt-1 text-sm text-slate-500">{i.prepStage}…</p>
          <div className="mx-auto mt-6 flex max-w-md justify-between gap-2">
            {["History", "Zoom", "Research", "Questions"].map((s, n) => (
              <div key={s} className="flex-1">
                <div className={`h-1.5 rounded-full ${n <= stepIndex ? "bg-brand-500" : "bg-slate-200"}`} />
                <div className="mt-1 text-xs text-slate-500">{s}</div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-slate-400">Company research and question design can take a minute or two.</p>
        </Card>
      )}

      {i.status === "failed" && (
        <Card className="border-rose-200 bg-rose-50/50">
          <h2 className="font-semibold text-rose-800">Something went wrong</h2>
          <p className="mt-1 text-sm text-rose-700">{i.error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {i.plan && responses.length > 0 ? (
              <Button disabled={busy} onClick={() => action(`/api/interviews/${id}/finish`)}>Retry evaluation</Button>
            ) : (
              <>
                <Button disabled={busy} onClick={() => action(`/api/interviews/${id}/prepare`)}>Retry</Button>
                <Button variant="secondary" disabled={busy} onClick={() => action(`/api/interviews/${id}/prepare`, { demo: true })}>Continue in demo mode</Button>
              </>
            )}
          </div>
        </Card>
      )}

      {i.status === "evaluating" && (
        <Card className="py-10 text-center">
          <Spinner className="h-8 w-8 text-brand-600" />
          <h2 className="mt-4 text-lg font-semibold">Evaluating your interview</h2>
          <p className="mt-1 text-sm text-slate-500">Scoring {responses.length} answers, writing model answers and updating your long-term profile…</p>
        </Card>
      )}

      {(i.status === "ready" || i.status === "in_progress") && i.plan && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-4 border-brand-200 bg-brand-50/40">
            <div>
              <h2 className="font-semibold">{i.status === "ready" ? "Your interview is ready" : "Interview in progress"}</h2>
              <p className="text-sm text-slate-600">
                {i.plan.rounds.length} round(s) · {totalQuestions} questions · interviewer: {i.plan.interviewer_name}
                {i.status === "in_progress" && ` · ${responses.length} answered so far`}
              </p>
            </div>
            <div className="flex gap-2">
              {i.status === "in_progress" && responses.length > 0 && (
                <Button variant="secondary" disabled={busy} onClick={() => action(`/api/interviews/${id}/finish`)}>End & evaluate now</Button>
              )}
              <LinkButton href={`/interviews/${id}/room`} className="px-5">{i.status === "ready" ? "Enter interview room" : "Resume interview"}</LinkButton>
            </div>
          </Card>

          {i.zoom && (
            <Card>
              <h3 className="font-semibold">Zoom meeting</h3>
              <p className="mt-1 text-sm text-slate-500">Share this with anyone joining as a panelist. Keep the in-app room open during the interview — that&apos;s where the AI interviewer and proctoring run.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isWebLink(i.zoom.joinUrl) ? (
                  <a href={i.zoom.joinUrl} target="_blank" rel="noreferrer" className="break-all text-sm font-medium text-brand-600 hover:underline">{i.zoom.joinUrl}</a>
                ) : (
                  <span className="break-all text-sm text-slate-600">{i.zoom.joinUrl}</span>
                )}
                {i.zoom.password && <Badge>Passcode: {i.zoom.password}</Badge>}
              </div>
            </Card>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <h3 className="font-semibold">What this interview will focus on</h3>
              <p className="mt-2 text-sm text-slate-600">{i.plan.company_context_summary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{i.plan.focus_areas.map((f) => <Badge key={f} tone="brand">{f}</Badge>)}</div>
              <div className="mt-5 space-y-3">
                {i.plan.rounds.map((r) => (
                  <div key={r.type} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between text-sm font-medium"><span>{r.title}</span><span className="text-slate-500">{r.questions.length} Q</span></div>
                    <p className="mt-0.5 text-xs text-slate-500">{r.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">{[...new Set(r.questions.map((q) => q.topic))].map((t) => <Badge key={t}>{t}</Badge>)}</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">Questions stay hidden until the interview, just like the real thing.</p>
            </Card>
            <div className="space-y-6">
              <Card>
                <h3 className="font-semibold">Before you start</h3>
                <ul className="mt-2 space-y-2 text-sm text-slate-600">
                  <li>• Use Chrome or Edge for voice answers (speech recognition). You can always type instead.</li>
                  <li>• Keep your camera on for the whole interview — if it turns off or is covered, the interview pauses until it&apos;s back.</li>
                  <li>• Be alone: you&apos;ll record a short voice check first. If another voice is heard nearby you get a warning, and if it&apos;s heard again within 2 minutes the interview ends automatically. If someone is heard helping you, the interview is cancelled immediately and not scored.</li>
                  <li>• Sit in a quiet, well-lit room facing the camera.</li>
                  {i.config.proctoring && <li>• Proctoring is on: stay in frame, alone, in full screen, and don&apos;t switch tabs or paste answers.</li>}
                  {i.config.recordVideo && <li>• The voice conversation between you and the interviewer is recorded as audio (no video).</li>}
                  <li>• Think out loud — the interviewer may ask follow-ups.</li>
                </ul>
              </Card>
              {i.research && (
                <Card>
                  <h3 className="font-semibold">Company research</h3>
                  <Markdown className="mt-2 text-slate-700">{i.research.summary}</Markdown>
                  {i.research.sources.length > 0 && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <div className="text-xs font-semibold uppercase text-slate-500">Sources</div>
                      <ul className="mt-1 space-y-1">{i.research.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">{s.title}</a></li>)}</ul>
                    </div>
                  )}
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
