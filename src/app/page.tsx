import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge, Card, LinkButton } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/client";
import { getInsights, getProfile, listInterviews } from "@/lib/repo";
import { ROUND_LABELS } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const REC: Record<string, string> = { strong_hire: "Strong hire", hire: "Hire", lean_hire: "Lean hire", lean_no_hire: "Lean no hire", no_hire: "No hire" };

export default async function Dashboard() {
  const ai = aiEnabled();
  const interviews = await listInterviews();
  const insights = await getInsights();
  const profile = await getProfile();
  const completed = interviews.filter((i) => i.overallScore !== null);
  const avg = completed.length ? Math.round(completed.reduce((s, i) => s + (i.overallScore ?? 0), 0) / completed.length) : null;
  const trend = completed.length >= 2 ? (completed[0].overallScore ?? 0) - (completed[1].overallScore ?? 0) : null;

  return (
    <AppShell>
      <section className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-indigo-800 p-8 text-white shadow-lg">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-brand-100">{profile.name ? `Welcome back, ${profile.name}` : "Welcome"}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Practise the interview you&apos;re actually going to have.</h1>
            <p className="mt-3 text-brand-100">
              Tell us the role and company — the AI researches what they&apos;re working on, runs a proctored video interview, scores every answer, and remembers your weak spots for next time.
            </p>
          </div>
          <div className="flex gap-3">
            <LinkButton href="/interviews/new" className="bg-white !text-brand-700 hover:bg-brand-50">Start a new interview</LinkButton>
            {!profile.name && <LinkButton href="/profile" variant="ghost" className="text-white hover:bg-white/10">Set up profile</LinkButton>}
          </div>
        </div>
      </section>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Interviews taken" value={String(interviews.length)} />
        <Stat label="Average score" value={avg !== null ? `${avg}/100` : "—"} />
        <Stat label="Last change" value={trend !== null ? `${trend >= 0 ? "+" : ""}${trend} pts` : "—"} tone={trend !== null ? (trend >= 0 ? "text-emerald-600" : "text-rose-600") : undefined} />
        <Stat label="Topics to revisit" value={String(insights.topics_to_revisit.length)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your interviews</h2>
            {interviews.length > 0 && <a href="/api/export-all" className="text-sm font-medium text-brand-600 hover:underline">Download all data</a>}
          </div>
          {interviews.length === 0 ? (
            <HowItWorks aiEnabled={ai} />
          ) : (
            <div className="space-y-3">
              {interviews.map((i) => (
                <Link key={i.id} href={`/interviews/${i.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{i.role} · <span className="text-slate-600">{i.company}</span></div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{new Date(i.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
                        <span>·</span>
                        <span>{i.rounds.map((r) => ROUND_LABELS[r]).join(", ")}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {i.terminated && i.status !== "cancelled" && <Badge tone="red">Ended automatically</Badge>}
                      {!i.terminated && i.integrityLevel && i.integrityLevel !== "clean" && <Badge tone={i.integrityLevel === "minor_flags" ? "amber" : "red"}>Integrity: {i.integrityLevel.replace("_", " ")}</Badge>}
                      {i.recommendation && <Badge tone="slate">{REC[i.recommendation]}</Badge>}
                      {i.overallScore !== null && <span className="text-lg font-semibold tabular-nums">{i.overallScore}</span>}
                      <StatusBadge status={i.status} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">What the AI remembers about you</h2>
          <Card>
            {insights.sessionCount === 0 ? (
              <p className="text-sm text-slate-500">After your first interview, your strengths, weak topics and recurring patterns appear here — and every new interview is built around them.</p>
            ) : (
              <div className="space-y-4 text-sm">
                <InsightList title="Focus next" items={insights.nextFocus} tone="brand" />
                <InsightList title="Weaknesses" items={insights.weaknesses} tone="red" />
                <InsightList title="Strengths" items={insights.strengths} tone="green" />
                <Link href="/progress" className="inline-block text-sm font-medium text-brand-600 hover:underline">See full progress →</Link>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

/** First run: what actually happens, so nobody has to guess before their first interview. */
function HowItWorks({ aiEnabled }: { aiEnabled: boolean }) {
  const steps = [
    { title: "Tell us the role", detail: "Paste a job posting or type the role and company. Your resume, if you add one, is used too." },
    { title: "The questions are prepared", detail: aiEnabled ? "The AI reads up on what the company is working on and writes rounds around it — this takes a minute." : "A built-in question bank is used until an Anthropic API key is added." },
    { title: "Sit the interview", detail: "Your interviewer speaks out loud and you answer by voice or by typing; coding questions open an editor. Camera stays on, and only the conversation audio is recorded." },
    { title: "Get scored and coached", detail: "Every answer is scored with model answers, you can practise weak ones again, and the next interview is built around what you missed." },
  ];
  return (
    <Card>
      <h3 className="font-semibold">How it works</h3>
      <ol className="mt-4 space-y-4">
        {steps.map((s, n) => (
          <li key={s.title} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{n + 1}</span>
            <div>
              <div className="text-sm font-medium">{s.title}</div>
              <p className="text-sm text-slate-600">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <LinkButton href="/interviews/new">Start your first interview</LinkButton>
        <span className="text-xs text-slate-500">Takes about a minute to prepare · everything stays on your own deployment</span>
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </Card>
  );
}

function InsightList({ title, items, tone }: { title: string; items: string[]; tone: "brand" | "red" | "green" }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 6).map((x) => <Badge key={x} tone={tone}>{x}</Badge>)}
      </div>
    </div>
  );
}
