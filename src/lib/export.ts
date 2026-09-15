import "server-only";
import { EVENT_LABELS } from "./integrity";
import { ROUND_LABELS } from "./schemas";
import type { CoachMessage, Interview, InterviewResponse, ProctorEvent } from "./types";

export interface InterviewBundle {
  exportedAt: string;
  interview: Interview;
  responses: InterviewResponse[];
  proctorEvents: ProctorEvent[];
  coachSession: CoachMessage[];
}

const REC: Record<string, string> = {
  strong_hire: "Strong hire",
  hire: "Hire",
  lean_hire: "Lean hire",
  lean_no_hire: "Lean no hire",
  no_hire: "No hire",
};

export function toMarkdown(b: InterviewBundle): string {
  const { interview: i, responses } = b;
  const ev = i.evaluation;
  const qe = new Map(ev?.rounds.flatMap((r) => r.question_evaluations).map((q) => [q.response_id, q]));
  const lines: string[] = [];
  const list = (items: string[]) => items.map((x) => `- ${x}`).join("\n");

  lines.push(`# Interview report — ${i.config.role} at ${i.config.company}`);
  lines.push(`_${new Date(i.createdAt).toLocaleString()} · ${i.config.field} · ${i.config.seniority} · ${i.generatedBy === "ai" ? "AI generated" : "Demo mode"}_`);
  if (ev) {
    lines.push(`\n## Result\n**Overall score:** ${ev.overall.overall_score}/100 — **${REC[ev.overall.hire_recommendation]}**\n\n**${ev.overall.headline}**\n\n${ev.overall.summary}`);
    lines.push(`\n### Scores by round\n${ev.rounds.map((r) => `- ${ROUND_LABELS[r.round_type]}: ${r.round_score}/100`).join("\n")}`);
    lines.push(`\n### Communication (${ev.overall.communication.score}/10)\n${ev.overall.communication.notes}`);
    lines.push(`\n### Top strengths\n${list(ev.overall.top_strengths)}\n\n### Key gaps\n${list(ev.overall.key_gaps)}`);
    lines.push(`\n### Action plan\n${ev.overall.action_plan.map((a, n) => `${n + 1}. **${a.title}** — ${a.detail}${a.resources.length ? ` _(Resources: ${a.resources.join(", ")})_` : ""}`).join("\n")}`);
  }
  if (i.integrity) {
    lines.push(`\n## Integrity (proctoring)\n**${i.integrity.score}/100 — ${i.integrity.level.replace("_", " ")}**\n\n${list(i.integrity.notes)}`);
    if (b.proctorEvents.length) {
      lines.push(`\n| Time | Event | Severity | Detail |\n|---|---|---|---|\n${b.proctorEvents.map((e) => `| ${new Date(e.at).toLocaleTimeString()} | ${EVENT_LABELS[e.type]} | ${e.severity} | ${e.detail.replace(/\|/g, "/")} |`).join("\n")}`);
    }
  }
  if (i.research) lines.push(`\n## Company research\n${i.research.summary}\n\n${list(i.research.sources.map((s) => `[${s.title}](${s.url})`))}`);

  lines.push(`\n## Question by question`);
  for (const r of responses) {
    const e = qe.get(r.id);
    lines.push(`\n### ${r.isFollowUp ? "↳ Follow-up" : ROUND_LABELS[r.roundType]}: ${r.prompt}`);
    lines.push(r.skipped ? "_Skipped_" : `**Your answer** (${r.durationSec}s, ${r.wordsPerMinute || "–"} wpm, ${r.fillerCount} fillers):\n\n> ${(r.answerText || "(no verbal answer)").replace(/\n/g, "\n> ")}`);
    if (r.code) lines.push(`\n\`\`\`${r.codeLanguage}\n${r.code}\n\`\`\``);
    if (e) {
      lines.push(`\n**Score:** ${e.score}/10 (${e.verdict.replace("_", " ")})`);
      if (e.strengths.length) lines.push(`\n**Strengths**\n${list(e.strengths)}`);
      if (e.improvements.length) lines.push(`\n**How to improve**\n${list(e.improvements)}`);
      if (e.missed_points.length) lines.push(`\n**Missed points**\n${list(e.missed_points)}`);
      if (e.model_answer) lines.push(`\n**Model answer**\n\n${e.model_answer}`);
      if (e.coaching_tip) lines.push(`\n**Coaching tip:** ${e.coaching_tip}`);
    }
    for (const retry of r.retries) {
      lines.push(`\n**Practice attempt (${new Date(retry.at).toLocaleString()}) — ${retry.result.score}/10**\n\n> ${retry.answerText.replace(/\n/g, "\n> ")}\n\n${retry.result.feedback}`);
    }
  }
  if (b.coachSession.length) {
    lines.push(`\n## Learning session`);
    for (const m of b.coachSession) lines.push(`\n**${m.role === "user" ? "You" : "Coach"}:**\n\n${m.content}`);
  }
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Minimal markdown → HTML for the printable report (headings, lists, bold, code, quotes, tables). */
function mdToHtml(md: string): string {
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  let inTable = false;
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  const closeBlocks = () => {
    if (inList) out.push("</ul>");
    if (inTable) out.push("</table>");
    inList = inTable = false;
  };
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      closeBlocks();
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(esc(line));
      continue;
    }
    if (/^\|/.test(line)) {
      if (/^\|[-| ]+\|$/.test(line)) continue;
      if (!inTable) {
        closeBlocks();
        out.push("<table>");
        inTable = true;
      }
      out.push(`<tr>${line.split("|").slice(1, -1).map((c) => `<td>${inline(c.trim())}</td>`).join("")}</tr>`);
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      closeBlocks();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (/^(- |\d+\. )/.test(line)) {
      if (!inList) {
        closeBlocks();
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^(- |\d+\. )/, ""))}</li>`);
    } else if (line.startsWith("> ")) {
      closeBlocks();
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    } else if (line.trim()) {
      closeBlocks();
      out.push(`<p>${inline(line)}</p>`);
    } else closeBlocks();
  }
  closeBlocks();
  return out.join("\n");
}

export function toHtml(b: InterviewBundle): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Interview report — ${esc(b.interview.config.role)} at ${esc(b.interview.config.company)}</title>
<style>
body{font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#1e293b}
h1{font-size:26px;margin-bottom:4px}h2{margin-top:36px;border-bottom:2px solid #e2e8f0;padding-bottom:6px}h3{margin-top:26px}
blockquote{margin:0;padding:2px 14px;border-left:3px solid #6366f1;background:#f8fafc;color:#334155}
pre{background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow:auto;font-size:13px}
code{font-family:ui-monospace,Menlo,monospace}table{border-collapse:collapse;width:100%;font-size:13px}td{border:1px solid #e2e8f0;padding:4px 8px}
@media print{body{margin:0}pre{white-space:pre-wrap}}
</style></head><body>${mdToHtml(toMarkdown(b))}</body></html>`;
}
