import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  AssistanceCheckSchema,
  ClarificationReplySchema,
  FollowUpSchema,
  JobPostingSchema,
  ResumeProfileSchema,
  InterviewPlanSchema,
  OverallEvaluationSchema,
  ROUND_LABELS,
  RetryEvaluationSchema,
  RoundEvaluationSchema,
  StudyPlanSchema,
  type AssistanceCheck,
  type ClarificationReply,
  type FollowUp,
  type JobPosting,
  type ResumeProfile,
  type InterviewConfig,
  type InterviewPlan,
  type OverallEvaluation,
  type PlanQuestion,
  type RetryEvaluation,
  type RoundEvaluation,
  type RoundType,
  type StudyPlan,
} from "../schemas";
import type {
  CoachMessage,
  Interview,
  InterviewResponse,
  IntegrityReport,
  Profile,
  ResearchBrief,
  StoredInsights,
} from "../types";
import { AIError, client, FALLBACK_BETA, MODEL, structured } from "./client";
import { describeConfig, describeInsights, describeProfile, describeResearch, describeTranscript } from "./prompts";

/* ------------------------------------------------------------------ */
/*  1. Company research (web search)                                   */
/* ------------------------------------------------------------------ */

export async function researchCompany(config: InterviewConfig): Promise<ResearchBrief> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Research ${config.company}${config.companyWebsite ? ` (${config.companyWebsite})` : ""} for a candidate preparing to interview for "${config.role}" (${config.field}).

Find what an interviewer there would care about right now:
- current products, recent launches, strategy and news from the last 12 months
- engineering / technical stack and the kind of problems the team works on
- how they interview (known round formats, values, culture signals)
- challenges the company or industry is facing that could come up in questions

${config.jobDescription ? `Job description for context:\n${config.jobDescription}\n` : ""}
Write a concise markdown brief (max ~400 words) with headings: Current focus, Tech & problems, Interview style & values, Likely talking points. Be factual; say when information could not be found.`,
    },
  ];

  let response: Anthropic.Beta.BetaMessage | null = null;
  for (let turn = 0; turn < 4; turn++) {
    response = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  if (!response || response.stop_reason === "refusal") throw new AIError("Company research was declined.");

  const summary = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const sources = new Map<string, string>();
  const allBlocks = [
    ...messages.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : [])),
    ...response.content,
  ];
  for (const block of allBlocks) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content) {
        if ("url" in item && item.url && !sources.has(item.url)) sources.set(item.url, item.title ?? item.url);
      }
    }
  }
  return {
    summary: summary || "No research summary was produced.",
    sources: [...sources].slice(0, 10).map(([url, title]) => ({ url, title })),
  };
}

/* ------------------------------------------------------------------ */
/*  2. Interview plan                                                 */
/* ------------------------------------------------------------------ */

export async function generatePlan(input: {
  config: InterviewConfig;
  profile: Profile;
  research: ResearchBrief | null;
  insights: StoredInsights;
  pastQuestions: { prompt: string; round: string; company: string; score: number | null }[];
}): Promise<InterviewPlan> {
  const { config } = input;
  const past = input.pastQuestions.length
    ? input.pastQuestions
        .map((q) => `- [${q.round}${q.score !== null ? `, scored ${q.score}/10` : ""}] ${q.prompt}`)
        .join("\n")
    : "None.";

  const plan = await structured({
    schema: InterviewPlanSchema,
    effort: "high",
    system: `You are a senior interviewer and hiring-panel designer. You design realistic, company-specific mock interviews that feel like the real loop at the target company, and you adapt each new interview to the candidate's history so they keep improving.`,
    prompt: `Design a mock interview.

<interview_setup>
${describeConfig(config)}
</interview_setup>

<candidate>
${describeProfile(input.profile)}
</candidate>

${describeResearch(input.research)}

<candidate_history>
${describeInsights(input.insights)}
</candidate_history>

<previously_asked_questions>
${past}
</previously_asked_questions>

Requirements:
- Create exactly these rounds in this order: ${config.rounds.map((r) => `${r} (${ROUND_LABELS[r]})`).join(", ")}; each with exactly ${config.questionsPerRound} questions.
- Tie questions to the company's current work, products and the stated requirements wherever it is natural, and mention that link in why_asked.
- Use the history: do not repeat previous questions verbatim; deliberately probe the weaknesses and "topics to revisit" with fresh questions; don't spend time on topics already mastered unless the role demands it.
- Mix in the classic challenges candidates face in these rounds (e.g. ambiguity handling, trade-off discussions, STAR stories on conflict/failure, complexity analysis, edge cases).
- coding round questions use kind "coding" with a short starter_code snippet and language_hint; other rounds use kind "verbal" with starter_code and language_hint set to null. A system_design question is verbal.
- Difficulty "${config.difficulty}" for a ${config.seniority} candidate${config.difficulty === "adaptive" ? " (start moderate, escalate within each round, and calibrate to past scores)" : ""}.
- time_limit_seconds: roughly 120-240 for verbal, 600-1500 for coding, 600-900 for system design.
- Questions are read aloud by a voice interviewer, so phrase them conversationally and keep each prompt under ~70 words (put code in starter_code, not the prompt).
- Interviewer persona: ${config.persona}. The intro_script and closing_script are spoken aloud; mention the company name and the interviewer's first name, and tell the candidate they can ask clarifying questions at any time.
- Question ids must be unique, like "coding-2".`,
  });

  // Guard against ids colliding across rounds and clamp time limits.
  const seen = new Set<string>();
  plan.rounds.forEach((round, ri) =>
    round.questions.forEach((q, qi) => {
      if (!q.id || seen.has(q.id)) q.id = `${round.type}-${ri + 1}-${qi + 1}`;
      seen.add(q.id);
      q.time_limit_seconds = Math.min(Math.max(q.time_limit_seconds || 180, 60), 2400);
    }),
  );
  return plan;
}

/* ------------------------------------------------------------------ */
/*  3. Live follow-up during the interview                             */
/* ------------------------------------------------------------------ */

export async function decideFollowUp(input: {
  config: InterviewConfig;
  question: PlanQuestion | null;
  prompt: string;
  answer: string;
  code: string;
  isFollowUp: boolean;
}): Promise<FollowUp> {
  return structured({
    schema: FollowUpSchema,
    effort: "low",
    maxTokens: 4000,
    system: `You are ${input.config.persona === "tough" ? "a demanding" : input.config.persona === "friendly" ? "a warm, encouraging" : "a professional"} interviewer at ${input.config.company} running a live voice interview for ${input.config.role}. Latency-sensitive; respond quickly. Never reveal scores or the ideal answer.`,
    prompt: `Question asked: ${input.prompt}
${input.question ? `What a strong answer covers: ${input.question.rubric.join("; ")}\nPossible follow-ups: ${input.question.follow_up_hints.join("; ")}` : ""}

Candidate's answer:
${input.answer || "(no spoken/typed answer)"}
${input.code ? `\nCode:\n${input.code}` : ""}

${
  input.isFollowUp
    ? "This was already a follow-up. Set ask_follow_up to false and give a brief acknowledgement that moves on."
    : "Decide whether one follow-up question would reveal meaningfully more (e.g. vague answer, missing key point, interesting claim to probe). If the answer was thorough or empty, don't follow up. The follow-up must be a single spoken sentence or two."
}`,
  });
}

/* ------------------------------------------------------------------ */
/*  3b. Clarifying questions from the candidate                       */
/* ------------------------------------------------------------------ */

export async function answerClarification(input: {
  config: InterviewConfig;
  question: PlanQuestion | null;
  prompt: string;
  candidateQuestion: string;
  previous: { question: string; reply: string }[];
}): Promise<ClarificationReply> {
  const { config, question } = input;
  return structured({
    schema: ClarificationReplySchema,
    effort: "low",
    maxTokens: 4000,
    system: `You are ${config.persona === "tough" ? "a demanding" : config.persona === "friendly" ? "a warm" : "a professional"} interviewer at ${config.company} running a live voice interview for ${config.role} (${config.seniority}). The candidate is asking you a clarifying question before or while answering. Latency-sensitive; respond quickly.`,
    prompt: `Current question: ${input.prompt}
${question ? `\nInterviewer-only notes (never read these out or reveal the rubric):\nTopic: ${question.topic}\nIdeal answer outline: ${question.ideal_answer_outline}` : ""}
${input.previous.length ? `\nEarlier clarifications on this question:\n${input.previous.map((p) => `Candidate: ${p.question}\nYou: ${p.reply}`).join("\n")}` : ""}

Candidate asks: ${input.candidateQuestion}

Reply the way a real interviewer would, in 1-3 spoken sentences:
- Answer questions about scope, constraints, input sizes, assumptions, users or scale directly, choosing reasonable specifics when the question leaves them open.
- Do not give away the solution, algorithm or model answer. If they ask for it, decline politely and ask how they would approach it${config.persona === "friendly" ? ", optionally with a gentle nudge" : ""}.
- If the question is unrelated to the interview, briefly steer back.
Set gave_hint to true only if your reply points toward the solution beyond clarifying the problem.`,
  });
}

/* ------------------------------------------------------------------ */
/*  3c. Is someone near the candidate helping them?                    */
/* ------------------------------------------------------------------ */

export async function checkForAssistance(input: {
  config: InterviewConfig;
  question: PlanQuestion | null;
  prompt: string;
  transcript: string;
}): Promise<AssistanceCheck> {
  const { config, question } = input;
  return structured({
    schema: AssistanceCheckSchema,
    effort: "medium",
    maxTokens: 4000,
    system:
      "You are the integrity reviewer for a proctored live interview. A voice other than the candidate's was detected near them. You decide whether that person's speech is helping the candidate with the interview. A wrong 'cheating' verdict cancels an honest candidate's interview, so only report high confidence when the help is clear.",
    prompt: `Interview: ${config.role} at ${config.company}.
Current question: ${input.prompt}
${question ? `Topic: ${question.topic}\nWhat a strong answer covers: ${question.rubric.join("; ")}` : ""}

Speech recognized from the OTHER person near the candidate (automatic transcription, may contain errors and fragments of the candidate's own words):
"""
${input.transcript}
"""

Decide:
- related_to_interview: is this speech about the question, the topic, or the interview?
- helping_candidate: does it give answers, hints, code, facts, structure, or tell the candidate what to say or type?
- confidence: "high" only when the speech clearly supplies interview-relevant content or instructions to the candidate. Unrelated conversation (chores, food, TV, phone calls), greetings, "good luck", or asking the candidate to be quiet is NOT help. Ambiguous fragments are "low" or "medium".
- evidence_quote: the exact helping words, or an empty string.`,
  });
}

/* ------------------------------------------------------------------ */
/*  4. Evaluation                                                      */
/* ------------------------------------------------------------------ */

export async function evaluateRound(
  interview: Interview,
  roundType: RoundType,
  responses: InterviewResponse[],
): Promise<RoundEvaluation> {
  const round = interview.plan?.rounds.find((r) => r.type === roundType);
  const result = await structured({
    schema: RoundEvaluationSchema,
    effort: "high",
    system: `You are a calibrated hiring-panel evaluator and interview coach. Score honestly against the bar for the stated seniority at this company — neither inflated nor harsh. Speech answers come from automatic transcription, so ignore transcription glitches but do note rambling or lack of structure.`,
    prompt: `Evaluate the ${ROUND_LABELS[roundType]} round.

<interview_setup>
${describeConfig(interview.config)}
</interview_setup>

<round_plan>
${JSON.stringify(round ?? {}, null, 1)}
</round_plan>

<transcript>
${describeTranscript(interview, responses)}
</transcript>

Return round_type "${roundType}" and one question_evaluation for EVERY response id above (including follow-ups), using the exact response_id.
- score 0-10 per answer; skipped/empty answers get verdict "no_answer" and score 0.
- strengths / improvements / missed_points: specific, referencing what the candidate actually said.
- model_answer: how a strong ${interview.config.seniority} candidate would answer (for coding, include a clean solution and complexity).
- coaching_tip: one concrete habit to practice.
- Clarifying questions: well-targeted questions about constraints, scale or assumptions (especially in coding and system design) are a strength; answering an ambiguous problem without clarifying is worth noting; if the interviewer had to give a hint, account for it in the score.
- round_score 0-100 reflects the whole round.`,
  });

  // Make sure every response has an evaluation, even if the model missed one.
  const byId = new Map(result.question_evaluations.map((q) => [q.response_id, q]));
  result.question_evaluations = responses.map(
    (r) =>
      byId.get(r.id) ?? {
        response_id: r.id,
        score: 0,
        verdict: "no_answer" as const,
        strengths: [],
        improvements: ["No evaluation was produced for this answer."],
        missed_points: [],
        model_answer: "",
        coaching_tip: "",
      },
  );
  result.round_type = roundType;
  result.round_score = clamp(result.round_score, 0, 100);
  result.question_evaluations.forEach((q) => (q.score = clamp(q.score, 0, 10)));
  return result;
}

export async function evaluateOverall(input: {
  interview: Interview;
  rounds: RoundEvaluation[];
  responses: InterviewResponse[];
  integrity: IntegrityReport;
  insights: StoredInsights;
}): Promise<OverallEvaluation> {
  const { interview } = input;
  const answered = input.responses.filter((r) => !r.skipped && r.answerText);
  const avgWpm = answered.length ? Math.round(answered.reduce((s, r) => s + r.wordsPerMinute, 0) / answered.length) : 0;
  const fillers = input.responses.reduce((s, r) => s + r.fillerCount, 0);

  const result = await structured({
    schema: OverallEvaluationSchema,
    effort: "high",
    system: `You are the hiring-committee chair and the candidate's personal interview coach. You synthesize round feedback into an honest overall verdict and a practical improvement plan, and you maintain the candidate's long-term skills profile across interviews.`,
    prompt: `<interview_setup>
${describeConfig(interview.config)}
</interview_setup>

<round_evaluations>
${input.rounds
  .map(
    (r) =>
      `## ${ROUND_LABELS[r.round_type]} — ${r.round_score}/100\n${r.summary}\n${r.question_evaluations
        .map((q) => `- ${q.verdict} (${q.score}/10): +${q.strengths.join("; ")} | -${q.improvements.join("; ")}`)
        .join("\n")}`,
  )
  .join("\n\n")}
</round_evaluations>

<delivery_metrics>
Average speaking pace: ${avgWpm || "n/a"} wpm (comfortable is ~120-160). Total filler words: ${fillers}. Questions skipped: ${input.responses.filter((r) => r.skipped).length}.
</delivery_metrics>

<proctoring>
Integrity score ${input.integrity.score}/100 (${input.integrity.level}). ${input.integrity.notes.join(" ")}
</proctoring>

<previous_candidate_profile>
${describeInsights(input.insights)}
</previous_candidate_profile>

Produce the overall evaluation:
- overall_score 0-100 based on answer quality (do not deduct for proctoring flags, but mention serious ones in the summary).
- action_plan: 3-5 prioritized items with concrete resources (books, problem sets, frameworks such as STAR).
- next_interview_focus: what the next mock interview should test.
- updated_profile: merge this interview into the previous profile — keep still-relevant items, remove weaknesses that were clearly overcome (move them to topics_mastered), add new ones. Keep each list to at most 8 short items.`,
  });
  result.overall_score = clamp(result.overall_score, 0, 100);
  result.communication.score = clamp(result.communication.score, 0, 10);
  return result;
}

/* ------------------------------------------------------------------ */
/*  5. Learning session                                                */
/* ------------------------------------------------------------------ */

export async function evaluateRetry(input: {
  interview: Interview;
  response: InterviewResponse;
  question: PlanQuestion | null;
  previousScore: number | null;
  answerText: string;
  code: string;
}): Promise<RetryEvaluation> {
  const result = await structured({
    schema: RetryEvaluationSchema,
    effort: "medium",
    maxTokens: 8000,
    system: "You are an interview coach running a practice drill. Be encouraging but honest.",
    prompt: `Role: ${input.interview.config.role} at ${input.interview.config.company} (${input.interview.config.seniority}).
Question: ${input.response.prompt}
${input.question ? `Strong answers cover: ${input.question.rubric.join("; ")}` : ""}

Original answer${input.previousScore !== null ? ` (scored ${input.previousScore}/10)` : ""}:
${input.response.answerText || "(none)"}${input.response.code ? `\n\`\`\`\n${input.response.code}\n\`\`\`` : ""}

New practice attempt:
${input.answerText || "(none)"}${input.code ? `\n\`\`\`\n${input.code}\n\`\`\`` : ""}

Score the new attempt 0-10 on the same bar, say whether it improved, and give short markdown feedback.`,
  });
  result.score = clamp(result.score, 0, 10);
  return result;
}

export function coachSystemPrompt(interview: Interview, responses: InterviewResponse[]): string {
  return `You are the candidate's personal interview coach running a learning session that reviews one completed mock interview. You explain what went well, what went wrong, and exactly how each answer could be improved — with rewritten example answers, frameworks (STAR, clarifying-questions-first, complexity analysis, trade-off tables) and drills. You may role-play the interviewer again if asked. Keep replies focused and use markdown.

<interview_setup>
${describeConfig(interview.config)}
</interview_setup>

<interview_plan>
${JSON.stringify(interview.plan, null, 1)}
</interview_plan>

<transcript>
${describeTranscript(interview, responses)}
</transcript>

<evaluation>
${JSON.stringify(interview.evaluation, null, 1)}
</evaluation>

<integrity_report>
${JSON.stringify(interview.integrity)}
</integrity_report>`;
}

/** Streams the coach's reply as plain text chunks. */
export async function* streamCoachReply(
  interview: Interview,
  responses: InterviewResponse[],
  history: CoachMessage[],
): AsyncGenerator<string> {
  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    // The interview context is large and identical on every turn — cache it.
    system: [{ type: "text", text: coachSystemPrompt(interview, responses), cache_control: { type: "ephemeral" } }],
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") yield "\n\n_The coach couldn't answer that. Try rephrasing your question._";
}

export async function generateStudyPlan(insights: StoredInsights, recent: string): Promise<StudyPlan> {
  return structured({
    schema: StudyPlanSchema,
    effort: "medium",
    system: "You are an interview preparation coach who builds realistic, focused study plans.",
    prompt: `Build a 7-day interview preparation plan from this candidate's cumulative profile.

${describeInsights(insights)}

Recent interviews:
${recent}

Each day: a focus and 3-5 concrete tasks (specific problems, stories to prepare, concepts to review). Add 8 practice questions that target the weaknesses.`,
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(n) ? n : min, min), max);
}

/* ------------------------------------------------------------------ */
/*  6. Imports: resume and job posting                                 */
/* ------------------------------------------------------------------ */

export async function extractResume(file: { pdfBase64?: string; text?: string }): Promise<ResumeProfile> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (file.pdfBase64) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.pdfBase64 } });
  } else {
    content.push({ type: "text", text: `<resume>\n${file.text ?? ""}\n</resume>` });
  }
  content.push({
    type: "text",
    text: "Extract this candidate's profile from the resume. Preserve every fact (roles, dates, companies, projects, metrics, skills, education) and never invent details. If the document is not a resume, return empty fields and experience_years 0.",
  });
  return structured({ schema: ResumeProfileSchema, effort: "low", system: "You convert resumes into structured candidate profiles.", prompt: content });
}

/** Uses Claude's web fetch tool for pages that can't be fetched directly (bot protection, JS-heavy sites). */
export async function fetchPageWithClaude(url: string): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Fetch ${url} and return the complete job posting text (title, company, description, responsibilities, requirements, benefits) verbatim as plain text. If it is not a job posting or cannot be fetched, reply with exactly NOT_A_JOB_POSTING.` },
  ];
  let response: Anthropic.Beta.BetaMessage | null = null;
  for (let turn = 0; turn < 3; turn++) {
    response = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low" },
      tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 }],
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  const text = (response?.content ?? [])
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text || text.includes("NOT_A_JOB_POSTING")) throw new AIError("Couldn't read a job posting at that link. Paste the description instead.");
  return text;
}

export async function structureJobPosting(source: { url?: string; text: string }): Promise<JobPosting> {
  return structured({
    schema: JobPostingSchema,
    effort: "low",
    system: "You turn job postings into structured interview-preparation fields. Only use information present in the posting.",
    prompt: `${source.url ? `Source: ${source.url}\n\n` : ""}<job_posting>\n${source.text}\n</job_posting>

Fill every field. Use empty strings when something isn't stated (except seniority and field, which you infer from the title and responsibilities).`,
  });
}
