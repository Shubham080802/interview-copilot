"use client";
import { useState } from "react";
import { Button, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { StudyPlan } from "@/lib/schemas";

export function StudyPlanPanel({ initial }: { initial: StudyPlan | null }) {
  const [plan, setPlan] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      setPlan(await api<StudyPlan>("/api/insights/study-plan", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Personal study plan</h2>
          <p className="text-sm text-slate-500">Built from your weaknesses and recurring patterns across all interviews.</p>
        </div>
        <Button variant={plan ? "secondary" : "primary"} onClick={generate} disabled={busy}>{busy ? <><Spinner /> Building…</> : plan ? "Regenerate" : "Generate 7-day plan"}</Button>
      </div>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {plan && (
        <div className="mt-5 space-y-4">
          <p className="font-medium">{plan.headline}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {plan.days.map((d) => (
              <div key={d.day} className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs font-semibold uppercase text-brand-600">{d.day}</div>
                <div className="font-medium">{d.focus}</div>
                <ul className="mt-1.5 space-y-1 text-sm text-slate-600">{d.tasks.map((t) => <li key={t}>• {t}</li>)}</ul>
              </div>
            ))}
          </div>
          {plan.practice_questions.length > 0 && (
            <div>
              <div className="text-sm font-semibold">Practice questions</div>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-slate-600">{plan.practice_questions.map((q) => <li key={q}>{q}</li>)}</ol>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
