import "server-only";
import { ROUND_LABELS, type InterviewConfig, type PlanQuestion } from "../schemas";
import type { Interview, InterviewResponse, Profile, ResearchBrief, StoredInsights } from "../types";

export function describeConfig(c: InterviewConfig): string {
  return [
    `Field: ${c.field}`,
    `Role: ${c.role} (${c.seniority} level)`,
    `Company: ${c.company}${c.companyWebsite ? ` — ${c.companyWebsite}` : ""}`,
    `Rounds: ${c.rounds.map((r) => ROUND_LABELS[r]).join(", ")}`,
    `Questions per round: ${c.questionsPerRound}`,
    `Difficulty: ${c.difficulty}`,
    `Interviewer style: ${c.persona}`,
    c.jobDescription && `\n<job_description>\n${c.jobDescription}\n</job_description>`,
    c.requirements && `\n<requirements>\n${c.requirements}\n</requirements>`,
    c.companyNotes && `\n<candidate_notes_about_company>\n${c.companyNotes}\n</candidate_notes_about_company>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function describeProfile(p: Profile): string {
  if (!p.name && !p.resume && !p.headline) return "No candidate profile provided.";
  return [
    p.name && `Name: ${p.name}`,
    p.headline && `Headline: ${p.headline}`,
    p.experienceYears ? `Years of experience: ${p.experienceYears}` : "",
    p.resume && `\n<resume>\n${p.resume}\n</resume>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function describeInsights(ins: StoredInsights): string {
  if (!ins.sessionCount) return "This is the candidate's first recorded interview — no history yet.";
  const list = (label: string, items: string[]) => (items.length ? `${label}:\n- ${items.join("\n- ")}` : "");
  return [
    `Completed interviews so far: ${ins.sessionCount}`,
    list("Strengths", ins.strengths),
    list("Weaknesses", ins.weaknesses),
    list("Topics mastered", ins.topics_mastered),
    list("Topics to revisit", ins.topics_to_revisit),
    list("Recurring patterns", ins.recurring_patterns),
    list("Recommended focus for the next interview", ins.nextFocus),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function describeResearch(r: ResearchBrief | null): string {
  if (!r) return "No web research available — rely on the job description and the candidate's notes.";
  return `<company_research>\n${r.summary}\n</company_research>`;
}

export function describeTranscript(interview: Interview, responses: InterviewResponse[]): string {
  const questions = new Map<string, PlanQuestion>();
  interview.plan?.rounds.forEach((r) => r.questions.forEach((q) => questions.set(q.id, q)));
  return responses
    .map((r) => {
      const q = questions.get(r.questionId);
      return [
        `<response id="${r.id}" round="${r.roundType}"${r.isFollowUp ? ' follow_up="true"' : ""}>`,
        `Question: ${r.prompt}`,
        r.clarifications?.length
          ? `Clarifying questions asked by the candidate:\n${r.clarifications.map((c) => `- Candidate: ${c.question}\n  Interviewer: ${c.reply}${c.gaveHint ? " (interviewer gave a hint)" : ""}`).join("\n")}`
          : "",
        q && !r.isFollowUp ? `Rubric: ${q.rubric.join("; ")}` : "",
        r.skipped ? "Candidate SKIPPED this question." : `Answer (speech transcript / typed):\n${r.answerText || "(empty)"}`,
        r.code ? `Code (${r.codeLanguage}):\n\`\`\`\n${r.code}\n\`\`\`` : "",
        `Time taken: ${r.durationSec}s · Speaking pace: ${r.wordsPerMinute || "n/a"} wpm · Filler words: ${r.fillerCount}`,
        "</response>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
