import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Interview setup (entered by the candidate)                        */
/* ------------------------------------------------------------------ */

export const ROUND_TYPES = ["technical", "coding", "behavioral", "system_design", "hr"] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "staff", "manager"] as const;

export const ROUND_LABELS: Record<RoundType, string> = {
  technical: "Technical",
  coding: "Coding",
  behavioral: "Behavioural",
  system_design: "System Design",
  hr: "HR / Culture Fit",
};

export const INTERVIEWER_VOICE_IDS = ["af_heart", "am_michael", "af_bella", "bf_emma"] as const;

export const InterviewConfigSchema = z.object({
  field: z.string().trim().min(1, "Pick a field"),
  role: z.string().trim().min(1, "Role is required"),
  seniority: z.enum(SENIORITY_LEVELS),
  company: z.string().trim().min(1, "Company is required"),
  companyWebsite: z.string().trim().default(""),
  jobDescription: z.string().trim().default(""),
  requirements: z.string().trim().default(""),
  companyNotes: z.string().trim().default(""),
  rounds: z.array(z.enum(ROUND_TYPES)).min(1, "Pick at least one round"),
  questionsPerRound: z.number().int().min(1).max(8).default(3),
  difficulty: z.enum(["easy", "medium", "hard", "adaptive"]).default("adaptive"),
  persona: z.enum(["friendly", "neutral", "tough"]).default("neutral"),
  interviewerVoice: z.enum(INTERVIEWER_VOICE_IDS).default("af_heart"),
  researchCompany: z.boolean().default(true),
  proctoring: z.boolean().default(true),
  recordVideo: z.boolean().default(true),
  zoomMode: z.enum(["none", "auto", "manual"]).default("none"),
  zoomUrl: z.string().trim().default(""),
  scheduledAt: z.string().default(""),
});
export type InterviewConfig = z.infer<typeof InterviewConfigSchema>;

/* ------------------------------------------------------------------ */
/*  AI structured outputs                                             */
/*  (no min/max constraints: keep schemas friendly to structured      */
/*  outputs; values are clamped in code where it matters)             */
/* ------------------------------------------------------------------ */

export const PlanQuestionSchema = z.object({
  id: z.string().describe("Short unique id such as 'tech-1'"),
  prompt: z.string().describe("The exact question the interviewer will say out loud"),
  kind: z.enum(["verbal", "coding"]),
  topic: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  why_asked: z
    .string()
    .describe("Why this question matters for this company/role, or which past weakness it probes"),
  rubric: z.array(z.string()).describe("Key points a strong answer covers"),
  ideal_answer_outline: z.string(),
  follow_up_hints: z.array(z.string()),
  time_limit_seconds: z.number().int(),
  starter_code: z.string().nullable().describe("Only for coding questions; otherwise null"),
  language_hint: z.string().nullable(),
});
export type PlanQuestion = z.infer<typeof PlanQuestionSchema>;

export const PlanRoundSchema = z.object({
  type: z.enum(ROUND_TYPES),
  title: z.string(),
  description: z.string(),
  questions: z.array(PlanQuestionSchema),
});
export type PlanRound = z.infer<typeof PlanRoundSchema>;

export const InterviewPlanSchema = z.object({
  interviewer_name: z.string(),
  intro_script: z.string().describe("Spoken greeting + format overview, 2-4 sentences"),
  company_context_summary: z.string(),
  focus_areas: z.array(z.string()),
  rounds: z.array(PlanRoundSchema),
  closing_script: z.string(),
});
export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;

export const FollowUpSchema = z.object({
  acknowledgement: z.string().describe("One short, natural spoken reaction to the answer (no scoring)"),
  ask_follow_up: z.boolean(),
  follow_up_question: z.string().nullable(),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export const QuestionEvaluationSchema = z.object({
  response_id: z.string(),
  score: z.number().describe("0-10"),
  verdict: z.enum(["strong", "acceptable", "weak", "no_answer"]),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  missed_points: z.array(z.string()),
  model_answer: z.string().describe("A strong sample answer in markdown"),
  coaching_tip: z.string(),
});
export type QuestionEvaluation = z.infer<typeof QuestionEvaluationSchema>;

export const RoundEvaluationSchema = z.object({
  round_type: z.enum(ROUND_TYPES),
  round_score: z.number().describe("0-100"),
  summary: z.string(),
  question_evaluations: z.array(QuestionEvaluationSchema),
});
export type RoundEvaluation = z.infer<typeof RoundEvaluationSchema>;

export const CandidateInsightsSchema = z.object({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  topics_mastered: z.array(z.string()),
  topics_to_revisit: z.array(z.string()),
  recurring_patterns: z.array(z.string()),
});
export type CandidateInsights = z.infer<typeof CandidateInsightsSchema>;

export const OverallEvaluationSchema = z.object({
  overall_score: z.number().describe("0-100"),
  hire_recommendation: z.enum(["strong_hire", "hire", "lean_hire", "lean_no_hire", "no_hire"]),
  headline: z.string(),
  summary: z.string().describe("Markdown, 1-3 short paragraphs"),
  communication: z.object({ score: z.number().describe("0-10"), notes: z.string() }),
  top_strengths: z.array(z.string()),
  key_gaps: z.array(z.string()),
  action_plan: z.array(z.object({ title: z.string(), detail: z.string(), resources: z.array(z.string()) })),
  next_interview_focus: z.array(z.string()),
  updated_profile: CandidateInsightsSchema.describe(
    "The candidate's cumulative profile after merging this interview into the previous profile",
  ),
});
export type OverallEvaluation = z.infer<typeof OverallEvaluationSchema>;

export const RetryEvaluationSchema = z.object({
  score: z.number().describe("0-10"),
  improved: z.boolean(),
  feedback: z.string().describe("Markdown: what got better, what is still missing"),
});
export type RetryEvaluation = z.infer<typeof RetryEvaluationSchema>;

export const StudyPlanSchema = z.object({
  headline: z.string(),
  days: z.array(z.object({ day: z.string(), focus: z.string(), tasks: z.array(z.string()) })),
  practice_questions: z.array(z.string()),
});
export type StudyPlan = z.infer<typeof StudyPlanSchema>;

/* ------------------------------------------------------------------ */
/*  Clarifying questions & imports                                    */
/* ------------------------------------------------------------------ */

export const ClarificationReplySchema = z.object({
  reply: z.string().describe("Spoken reply, 1-3 sentences"),
  gave_hint: z.boolean().describe("True if the reply points toward the solution beyond clarifying the problem"),
});
export type ClarificationReply = z.infer<typeof ClarificationReplySchema>;


export const ResumeProfileSchema = z.object({
  name: z.string(),
  headline: z.string().describe("One line: current role, years, domain, core stack"),
  experience_years: z.number().describe("Total years of professional experience, 0 if none"),
  resume_markdown: z
    .string()
    .describe("Complete resume rewritten as clean markdown: experience with achievements, projects, skills, education. Keep every fact; do not invent anything."),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

export const JobPostingSchema = z.object({
  role: z.string(),
  company: z.string(),
  company_website: z.string().describe("Company homepage URL, or empty string if unknown"),
  field: z.string().describe("Broad field such as Software Engineering, Data Science / ML, Product Management"),
  seniority: z.enum(SENIORITY_LEVELS),
  job_description: z.string().describe("The job description as clean plain text / markdown"),
  requirements: z.string().describe("Key required and preferred skills, one per line"),
  company_notes: z.string().describe("What the posting says about the company, team, product and mission"),
});
export type JobPosting = z.infer<typeof JobPostingSchema>;

/* ------------------------------------------------------------------ */
/*  Assistance check (another person helping the candidate)            */
/* ------------------------------------------------------------------ */

export const AssistanceCheckSchema = z.object({
  related_to_interview: z.boolean().describe("The speech is about the current question or the interview"),
  helping_candidate: z.boolean().describe("The speech gives the candidate answers, hints, code, facts or tells them what to say"),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string().describe("One sentence explaining the verdict"),
  evidence_quote: z.string().describe("The exact words that show help, or empty string"),
});
export type AssistanceCheck = z.infer<typeof AssistanceCheckSchema>;
