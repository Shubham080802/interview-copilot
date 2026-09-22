"use client";
import { FileUp, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button, Card, CardHeading, Field, inputClass, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";
import { suggestRoles } from "@/lib/role-catalog";
import type { ResumeProfile } from "@/lib/schemas";
import type { Profile } from "@/lib/types";

interface ImportResult {
  data: ResumeProfile;
  method: "ai" | "basic";
  warning?: string;
}

export function ProfileForm({ initial }: { initial: Profile }) {
  const [p, setP] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Recomputed live as the candidate types, so it reflects what is on the screen, not just what was
  // last saved — the same heuristic the "New interview" page uses, so the two stay in agreement.
  const suggestions = useMemo(() => suggestRoles(p, 3), [p.headline, p.resume, p.experienceYears]);
  const hasContent = p.headline.trim().length > 0 || p.resume.trim().length > 0;

  async function save() {
    setState("saving");
    try {
      await api("/api/profile", { method: "PUT", json: p });
      setState("saved");
    } catch (e) {
      setState((e as Error).message);
    }
  }

  async function importResume(file: File) {
    setImporting(true);
    setImportNote(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<ImportResult>("/api/profile/resume", { method: "POST", body });
      const d = result.data;
      // Keep anything the resume didn't provide; the user reviews before saving.
      setP((prev) => ({
        ...prev,
        name: d.name || prev.name,
        headline: d.headline || prev.headline,
        experienceYears: d.experience_years || prev.experienceYears,
        resume: d.resume_markdown || prev.resume,
      }));
      setState("idle");
      setImportNote(
        result.warning
          ? { tone: "warn", text: result.warning }
          : { tone: "ok", text: `Imported ${file.name}. Review the details below, then save.` },
      );
    } catch (e) {
      setImportNote({ tone: "error", text: (e as Error).message });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const noteColor = { ok: "bg-emerald-50 text-emerald-800", warn: "bg-amber-50 text-amber-800", error: "bg-rose-50 text-rose-700" };

  return (
    <div className="mt-6 space-y-6">
      <Card className="space-y-3">
        <CardHeading icon={FileUp}>Import your resume</CardHeading>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) importResume(file);
          }}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-brand-300 bg-brand-50/40 p-4"
        >
          <div>
            <div className="text-sm font-medium">PDF, .txt or .md up to 4 MB</div>
            <div className="text-xs text-slate-500">Drop it here or choose a file. Fields below are filled in for you to review.</div>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" className="hidden" onChange={(e) => e.target.files?.[0] && importResume(e.target.files[0])} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? <><Spinner /> Reading resume…</> : <><FileUp className="h-4 w-4" /> Upload resume</>}
          </Button>
        </div>
        {importNote && <div className={`rounded-lg px-3 py-2 text-sm ${noteColor[importNote.tone]}`}>{importNote.text}</div>}
      </Card>

      <Card className="space-y-5">
        <CardHeading icon={UserRound}>Your details</CardHeading>
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

      {(suggestions.length > 0 || hasContent) && (
        <Card className="space-y-3 border-violet-200 bg-violet-50/40">
          <CardHeading icon={Sparkles} tone="violet">Roles that suit you</CardHeading>
          {suggestions.length > 0 ? (
            <>
              <p className="text-sm text-slate-500">Based on your headline and resume above. Pick one to jump straight into setting up that interview.</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Link
                    key={s.field}
                    href={`/interviews/new?${new URLSearchParams({ field: s.field, role: s.role, seniority: s.seniority })}`}
                    className="rounded-full border border-violet-300 bg-white px-3 py-1.5 text-sm font-medium text-violet-800 shadow-sm transition hover:bg-violet-50"
                  >
                    {s.role} <span className="text-violet-500">· {s.field}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">We couldn&apos;t tell what roles fit best from this yet — mention specific skills, tools or past job titles above and suggestions will appear here.</p>
          )}
        </Card>
      )}
    </div>
  );
}
