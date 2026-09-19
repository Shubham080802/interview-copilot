"use client";
import { useRouter } from "next/navigation";
import { Link2, Play, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Card, cx, Field, inputClass, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";
import { INTERVIEWER_VOICES } from "@/lib/client/interviewer-voice";
import { INTERVIEWER_VOICE_IDS, ROUND_LABELS, ROUND_TYPES, type InterviewConfig, type JobPosting, type RoundType } from "@/lib/schemas";
import type { Interview } from "@/lib/types";

const FIELDS = ["Software Engineering", "Frontend Engineering", "Backend Engineering", "Data Science / ML", "Data Engineering", "DevOps / SRE / Cloud", "Mobile Development", "Cybersecurity", "Product Management", "UX / Product Design", "Business / Data Analyst", "QA / Test Engineering", "Consulting", "Finance", "Marketing", "Sales"];

const ROUND_HELP: Record<RoundType, string> = {
  technical: "Concepts, debugging, trade-offs",
  coding: "Live problem solving in an editor",
  behavioral: "STAR stories: conflict, failure, ownership",
  system_design: "Architecture & scalability",
  hr: "Motivation, culture fit, expectations",
};

const DEFAULTS: InterviewConfig = {
  field: "Software Engineering",
  role: "",
  seniority: "mid",
  company: "",
  companyWebsite: "",
  jobDescription: "",
  requirements: "",
  companyNotes: "",
  rounds: ["technical", "coding", "behavioral"],
  questionsPerRound: 3,
  difficulty: "adaptive",
  persona: "neutral",
  interviewerVoice: "af_heart",
  researchCompany: true,
  proctoring: true,
  recordVideo: true,
  zoomMode: "none",
  zoomUrl: "",
  scheduledAt: "",
};

export function NewInterviewForm({ aiEnabled, zoomConfigured }: { aiEnabled: boolean; zoomConfigured: boolean }) {
  const router = useRouter();
  const [c, setC] = useState<InterviewConfig>(DEFAULTS);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof InterviewConfig>(k: K, v: InterviewConfig[K]) => setC((prev) => ({ ...prev, [k]: v }));
  const [jobUrl, setJobUrl] = useState("");
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [importing, setImporting] = useState<"url" | "text" | null>(null);
  const [importNote, setImportNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  async function importJob(source: { url: string } | { text: string }) {
    setImporting("url" in source ? "url" : "text");
    setImportNote(null);
    try {
      const result = await api<{ data: JobPosting; method: "ai" | "basic"; warning?: string }>("/api/import/job", { method: "POST", json: source });
      const d = result.data;
      // Only overwrite fields the posting actually provided.
      setC((prev) => ({
        ...prev,
        role: d.role || prev.role,
        company: d.company || prev.company,
        companyWebsite: d.company_website || prev.companyWebsite,
        field: result.method === "ai" && d.field ? d.field : prev.field,
        seniority: d.seniority || prev.seniority,
        jobDescription: d.job_description || prev.jobDescription,
        requirements: d.requirements || prev.requirements,
        companyNotes: d.company_notes || prev.companyNotes,
      }));
      setImportNote(result.warning ? { tone: "warn", text: result.warning } : { tone: "ok", text: "Job details imported — review them below." });
    } catch (err) {
      setImportNote({ tone: "error", text: (err as Error).message });
    } finally {
      setImporting(null);
    }
  }

  const toggleRound = (r: RoundType) =>
    set("rounds", c.rounds.includes(r) ? c.rounds.filter((x) => x !== r) : ROUND_TYPES.filter((x) => x === r || c.rounds.includes(x)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!c.role.trim() || !c.company.trim()) return setError("Role and company are required.");
    if (!c.rounds.length) return setError("Pick at least one round.");
    setBusy(true);
    try {
      const interview = await api<Interview>("/api/interviews", { method: "POST", json: c });
      router.push(`/interviews/${interview.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const totalQuestions = c.rounds.length * c.questionsPerRound;

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <Card className="space-y-3 border-brand-200 bg-brand-50/30">
        <div className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-brand-600" /> Import from a job posting</div>
        <p className="text-sm text-slate-500">Paste a link to the job ad (company careers page, Greenhouse, Lever, Workday…) and we&apos;ll fill in the role, company, description and requirements.</p>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            className={cx(inputClass, "min-w-0 flex-1")}
            placeholder="https://boards.greenhouse.io/company/jobs/123"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (jobUrl.trim()) importJob({ url: jobUrl.trim() });
              }
            }}
          />
          <Button type="button" variant="secondary" disabled={!jobUrl.trim() || importing !== null} onClick={() => importJob({ url: jobUrl.trim() })}>
            {importing === "url" ? <><Spinner /> Importing…</> : "Import"}
          </Button>
        </div>
        {importNote && (
          <div className={cx("rounded-lg px-3 py-2 text-sm", importNote.tone === "ok" ? "bg-emerald-50 text-emerald-800" : importNote.tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700")}>{importNote.text}</div>
        )}
      </Card>

      <Card className="space-y-5">
        <SectionTitle n={1} title="Role" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Field">
            <input list="fields" className={inputClass} value={c.field} onChange={(e) => set("field", e.target.value)} />
            <datalist id="fields">{FIELDS.map((f) => <option key={f} value={f} />)}</datalist>
          </Field>
          <Field label="Job title *"><input className={inputClass} placeholder="e.g. Software Engineer II" value={c.role} onChange={(e) => set("role", e.target.value)} /></Field>
          <Field label="Level">
            <select className={inputClass} value={c.seniority} onChange={(e) => set("seniority", e.target.value as InterviewConfig["seniority"])}>
              <option value="intern">Intern / New grad</option><option value="junior">Junior</option><option value="mid">Mid-level</option>
              <option value="senior">Senior</option><option value="staff">Staff / Principal</option><option value="manager">Manager</option>
            </select>
          </Field>
        </div>
        <Field label="Interviewer voice" hint="A natural-sounding voice generated on your device. Press play to hear each one.">
          <div className="grid gap-2 sm:grid-cols-2">
            {INTERVIEWER_VOICE_IDS.map((voice) => (
              <label key={voice} className={cx("flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition", c.interviewerVoice === voice ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300")}>
                <input type="radio" name="interviewerVoice" className="accent-brand-600" checked={c.interviewerVoice === voice} onChange={() => set("interviewerVoice", voice)} />
                <span className="flex-1 text-sm">{INTERVIEWER_VOICES[voice]}</span>
                <button
                  type="button"
                  aria-label={`Play a sample of ${INTERVIEWER_VOICES[voice]}`}
                  onClick={(e) => {
                    e.preventDefault();
                    previewRef.current?.pause();
                    previewRef.current = new Audio(`/voice-samples/interviewer-${voice}.m4a`);
                    void previewRef.current.play();
                  }}
                  className="rounded-full bg-white p-1.5 text-brand-700 shadow-sm ring-1 ring-slate-200 hover:bg-brand-50"
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
              </label>
            ))}
          </div>
        </Field>
      </Card>

      <Card className="space-y-5">
        <SectionTitle n={2} title="Company & requirements" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company *"><input className={inputClass} placeholder="e.g. Stripe" value={c.company} onChange={(e) => set("company", e.target.value)} /></Field>
          <Field label="Company website"><input className={inputClass} placeholder="https://…" value={c.companyWebsite} onChange={(e) => set("companyWebsite", e.target.value)} /></Field>
        </div>
        <Field label="Job description" hint="Paste the full posting if you have it.">
          <textarea rows={6} className={inputClass} value={c.jobDescription} onChange={(e) => set("jobDescription", e.target.value)} />
        </Field>
        {aiEnabled && c.jobDescription.trim().length >= 50 && (
          <Button type="button" variant="ghost" className="-mt-3 text-brand-700" disabled={importing !== null} onClick={() => importJob({ text: c.jobDescription })}>
            {importing === "text" ? <><Spinner /> Extracting…</> : <><Sparkles className="h-4 w-4" /> Fill role, requirements and company notes from this description</>}
          </Button>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Key requirements / skills" hint="Comma or line separated">
            <textarea rows={4} className={inputClass} placeholder="Go, Kubernetes, distributed systems, payments" value={c.requirements} onChange={(e) => set("requirements", e.target.value)} />
          </Field>
          <Field label="What you know about the company's current work" hint="Products, recent launches, team, what the recruiter told you">
            <textarea rows={4} className={inputClass} value={c.companyNotes} onChange={(e) => set("companyNotes", e.target.value)} />
          </Field>
        </div>
        <Toggle
          checked={c.researchCompany && aiEnabled}
          disabled={!aiEnabled}
          onChange={(v) => set("researchCompany", v)}
          label="Research the company on the web"
          hint={aiEnabled ? "The AI looks up recent news, products and tech stack to shape the questions." : "Requires an Anthropic API key."}
        />
      </Card>

      <Card className="space-y-5">
        <SectionTitle n={3} title="Interview format" />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ROUND_TYPES.map((r) => (
            <button type="button" key={r} onClick={() => toggleRound(r)} className={cx("rounded-xl border p-3 text-left transition", c.rounds.includes(r) ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300")}>
              <div className="text-sm font-medium">{ROUND_LABELS[r]}</div>
              <div className="mt-0.5 text-xs text-slate-500">{ROUND_HELP[r]}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Questions per round: ${c.questionsPerRound}`} hint={`${totalQuestions} questions total, plus follow-ups`}>
            <input type="range" min={1} max={6} value={c.questionsPerRound} onChange={(e) => set("questionsPerRound", Number(e.target.value))} className="w-full accent-brand-600" />
          </Field>
          <Field label="Difficulty">
            <select className={inputClass} value={c.difficulty} onChange={(e) => set("difficulty", e.target.value as InterviewConfig["difficulty"])}>
              <option value="adaptive">Adaptive (uses your history)</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select>
          </Field>
          <Field label="Interviewer style">
            <select className={inputClass} value={c.persona} onChange={(e) => set("persona", e.target.value as InterviewConfig["persona"])}>
              <option value="friendly">Friendly</option><option value="neutral">Neutral / professional</option><option value="tough">Tough / bar-raiser</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card className="space-y-5">
        <SectionTitle n={4} title="Video, proctoring & Zoom" />
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
          <input type="checkbox" checked disabled aria-label="Camera on (required)" className="mt-0.5 h-4 w-4 accent-emerald-600" />
          <span>
            <span className="block text-sm font-medium">Camera on — required</span>
            <span className="mt-0.5 block text-xs text-slate-600">Every interview runs on camera. If the camera turns off or is covered, the interview pauses until it&apos;s back and the gap is recorded.</span>
          </span>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
          <input type="checkbox" checked disabled aria-label="Only you — voice monitored (required)" className="mt-0.5 h-4 w-4 accent-emerald-600" />
          <span>
            <span className="block text-sm font-medium">Only you — voice monitored, required</span>
            <span className="mt-0.5 block text-xs text-slate-600">You record a short voice check before starting. If another person&apos;s voice is heard nearby you get a warning; if it&apos;s heard again within 2 minutes, the interview ends automatically. If that person is heard helping with the interview, it is cancelled immediately (&ldquo;Cheating determined&rdquo;) and not scored. Voice analysis runs on your device; speech recognition is provided by your browser.</span>
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Toggle checked={c.proctoring} onChange={(v) => set("proctoring", v)} label="Proctoring" hint="Camera face tracking (absence, extra people, looking away), tab switching, paste and full-screen monitoring." />
          <Toggle checked={c.recordVideo} onChange={(v) => set("recordVideo", v)} label="Record the conversation" hint="Saves the voice conversation between you and the interviewer (audio only — no video) so you can replay it in the learning session." />
        </div>
        <Field label="Zoom meeting" hint="The AI interview and proctoring run in this app's video room. Add a Zoom meeting if a friend, mentor or human panelist should join too.">
          <div className="flex flex-wrap gap-2">
            {(["none", "auto", "manual"] as const).map((m) => (
              <button type="button" key={m} disabled={m === "auto" && !zoomConfigured} onClick={() => set("zoomMode", m)} className={cx("rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-40", c.zoomMode === m ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200")}>
                {m === "none" ? "No Zoom" : m === "auto" ? `Create meeting automatically${zoomConfigured ? "" : " (not configured)"}` : "Use my Zoom link"}
              </button>
            ))}
          </div>
        </Field>
        {c.zoomMode === "manual" && <Field label="Zoom link"><input className={inputClass} placeholder="https://zoom.us/j/…" value={c.zoomUrl} onChange={(e) => set("zoomUrl", e.target.value)} /></Field>}
        {c.zoomMode === "auto" && <Field label="Scheduled time (optional)"><input type="datetime-local" className={inputClass} value={c.scheduledAt ? c.scheduledAt.slice(0, 16) : ""} onChange={(e) => set("scheduledAt", e.target.value ? new Date(e.target.value).toISOString() : "")} /></Field>}
      </Card>

      {error && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <div className="flex items-center justify-end gap-3">
        {!aiEnabled && <span className="text-sm text-amber-700">Demo mode: questions come from the built-in bank.</span>}
        <Button type="submit" disabled={busy} className="px-5 py-2.5">{busy ? "Creating…" : "Generate my interview"}</Button>
      </div>
    </form>
  );
}

function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{n}</span>
      <h2 className="font-semibold">{title}</h2>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3", disabled && "cursor-not-allowed opacity-60")}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
