"use client";
import { useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { Profile } from "@/lib/types";

export function ProfileForm({ initial }: { initial: Profile }) {
  const [p, setP] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");

  async function save() {
    setState("saving");
    try {
      await api("/api/profile", { method: "PUT", json: p });
      setState("saved");
    } catch (e) {
      setState((e as Error).message);
    }
  }

  return (
    <Card className="mt-6 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input className={inputClass} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Years of experience"><input type="number" min={0} className={inputClass} value={p.experienceYears} onChange={(e) => setP({ ...p, experienceYears: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Headline" hint="e.g. Backend engineer, 3 years in fintech, Python & AWS"><input className={inputClass} value={p.headline} onChange={(e) => setP({ ...p, headline: e.target.value })} /></Field>
      <Field label="Resume / experience" hint="Paste your resume text, key projects and achievements.">
        <textarea rows={14} className={inputClass} value={p.resume} onChange={(e) => setP({ ...p, resume: e.target.value })} />
      </Field>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save profile"}</Button>
        {state === "saved" && <span className="text-sm text-emerald-600">Saved</span>}
        {!["idle", "saving", "saved"].includes(state) && <span className="text-sm text-rose-600">{state}</span>}
      </div>
    </Card>
  );
}
