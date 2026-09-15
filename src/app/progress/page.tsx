import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Badge, Bar, Card, EmptyState, LinkButton } from "@/components/ui";
import { getInsights, getInterview, listInterviews } from "@/lib/repo";
import { ROUND_LABELS, type RoundType } from "@/lib/schemas";
import { StudyPlanPanel } from "./StudyPlanPanel";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const insights = await getInsights();
  const completed = (await listInterviews()).filter((i) => i.overallScore !== null).reverse(); // oldest first

  const roundScores = new Map<RoundType, number[]>();
  for (const s of completed) {
    (await getInterview(s.id))?.evaluation?.rounds.forEach((r) => roundScores.set(r.round_type, [...(roundScores.get(r.round_type) ?? []), r.round_score]));
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Progress & learning</h1>
          <p className="mt-1 text-sm text-slate-500">Everything the app has learned from your {insights.sessionCount} completed interview(s). New interviews are generated from this profile.</p>
        </div>
        <a href="/api/export-all" className="text-sm font-medium text-brand-600 hover:underline">Download all my data (JSON)</a>
      </div>

      {completed.length === 0 ? (
        <EmptyState title="No completed interviews yet">
          <LinkButton href="/interviews/new" className="mt-3">Take your first interview</LinkButton>
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <h2 className="font-semibold">Overall score over time</h2>
              <ScoreChart points={completed.map((c) => ({ id: c.id, score: c.overallScore ?? 0, label: `${c.company} · ${new Date(c.createdAt).toLocaleDateString()}` }))} />
            </Card>
            <Card>
              <h2 className="font-semibold">Average by round type</h2>
              <div className="mt-4 space-y-3">
                {[...roundScores].map(([type, scores]) => {
                  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
                  const last = scores[scores.length - 1];
                  return (
                    <div key={type}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-medium">{ROUND_LABELS[type]} <span className="text-slate-400">({scores.length})</span></span>
                        <span className="tabular-nums">avg {avg} · last {Math.round(last)}</span>
                      </div>
                      <Bar value={avg} />
                    </div>
                  );
                })}
              </div>
            </Card>
            <StudyPlanPanel initial={insights.studyPlan} />
          </div>
          <div className="space-y-6">
            <InsightCard title="Focus for your next interview" items={insights.nextFocus} tone="brand" />
            <InsightCard title="Weaknesses" items={insights.weaknesses} tone="red" />
            <InsightCard title="Topics to revisit" items={insights.topics_to_revisit} tone="amber" />
            <InsightCard title="Recurring patterns" items={insights.recurring_patterns} tone="slate" />
            <InsightCard title="Strengths" items={insights.strengths} tone="green" />
            <InsightCard title="Topics mastered" items={insights.topics_mastered} tone="green" />
            <Card>
              <h3 className="font-semibold">Reports</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {[...completed].reverse().map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <Link href={`/interviews/${c.id}/report`} className="truncate text-brand-600 hover:underline">{c.role} · {c.company}</Link>
                    <span className="tabular-nums text-slate-500">{c.overallScore}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function InsightCard({ title, items, tone }: { title: string; items: string[]; tone: "brand" | "red" | "amber" | "slate" | "green" }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">{items.length ? items.map((x) => <Badge key={x} tone={tone}>{x}</Badge>) : <span className="text-sm text-slate-400">—</span>}</div>
    </Card>
  );
}

function ScoreChart({ points }: { points: { id: string; score: number; label: string }[] }) {
  const w = 640, h = 220, pad = 32;
  const x = (i: number) => (points.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (points.length - 1));
  const y = (s: number) => h - pad - (s / 100) * (h - 2 * pad);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 w-full">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={pad} x2={w - pad} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeDasharray="4 4" />
          <text x={4} y={y(g) + 4} fontSize="10" fill="#94a3b8">{g}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#6366f1" strokeWidth={2.5} />
      {points.map((p, i) => (
        <a key={p.id} href={`/interviews/${p.id}/report`}>
          <circle cx={x(i)} cy={y(p.score)} r={5} fill="#6366f1"><title>{`${p.label}: ${p.score}`}</title></circle>
          <text x={x(i)} y={y(p.score) - 10} fontSize="11" textAnchor="middle" fill="#334155">{p.score}</text>
        </a>
      ))}
    </svg>
  );
}
