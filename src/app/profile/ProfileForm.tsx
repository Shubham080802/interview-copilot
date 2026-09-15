"use client";
import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Card, Field, inputClass, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";
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
    <Card className="mt-6 space-y-5">
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
          <div className="text-sm font-medium">Import your resume</div>
          <div className="text-xs text-slate-500">PDF, .txt or .md up to 4 MB — drop it here or choose a file. Fields below are filled in for you to review.</div>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" className="hidden" onChange={(e) => e.target.files?.[0] && importResume(e.target.files[0])} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? <><Spinner /> Reading resume…</> : <><FileUp className="h-4 w-4" /> Upload resume</>}
        </Button>
      </div>
      {importNote && <div className={`rounded-lg px-3 py-2 text-sm ${noteColor[importNote.tone]}`}>{importNote.text}</div>}

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
