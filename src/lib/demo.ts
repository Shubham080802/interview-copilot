import "server-only";
/**
 * Demo engine: used when no Anthropic credentials are configured.
 * Generates interviews from a local question bank and scores answers with simple
 * heuristics (rubric keyword coverage, depth, delivery) so the full flow works offline.
 */
import {
  ROUND_LABELS,
  type ClarificationReply,
  type FollowUp,
  type InterviewConfig,
  type InterviewPlan,
  type OverallEvaluation,
  type PlanQuestion,
  type QuestionEvaluation,
  type RetryEvaluation,
  type RoundEvaluation,
  type RoundType,
  type StudyPlan,
} from "./schemas";
import { wordCount } from "./speech-metrics";
import type { Interview, InterviewResponse, IntegrityReport, StoredInsights } from "./types";

type BankItem = Omit<PlanQuestion, "id" | "time_limit_seconds" | "difficulty"> & {
  difficulty: PlanQuestion["difficulty"];
  time: number;
};

const verbal = (
  topic: string,
  prompt: string,
  rubric: string[],
  outline: string,
  followUps: string[],
  difficulty: PlanQuestion["difficulty"] = "medium",
  time = 180,
): BankItem => ({
  topic,
  prompt,
  kind: "verbal",
  difficulty,
  why_asked: "",
  rubric,
  ideal_answer_outline: outline,
  follow_up_hints: followUps,
  starter_code: null,
  language_hint: null,
  time,
});

const BANK: Record<RoundType, BankItem[]> = {
  technical: [
    verbal("Core skills", "Walk me through how you would apply {skill} in a production project at {company}. What pitfalls have you run into?", ["concrete project example", "trade-offs", "pitfalls and how they were solved", "measurable outcome"], "Pick a real project, explain the context, how {skill} was used, a pitfall, the fix, and the result.", ["What would you do differently today?"], "easy"),
    verbal("Debugging", "A service you own suddenly has p99 latency ten times higher after a deploy. How do you investigate?", ["check recent changes / rollback", "metrics and tracing", "form and test hypotheses", "database or dependency bottlenecks", "communicate and post-mortem"], "Stabilise first (rollback), then use dashboards, traces and profiling to isolate the cause, fix, verify, and write a post-mortem.", ["How would you prevent it next time?"]),
    verbal("Fundamentals", "Explain the difference between processes and threads, and when you'd choose async I/O instead.", ["memory isolation", "context switching cost", "shared state and locking", "I/O-bound vs CPU-bound", "event loop"], "Processes isolate memory, threads share it; async suits I/O-bound work with many waiting tasks; CPU-bound work needs parallelism.", ["How does this affect a web server's design?"], "easy"),
    verbal("Data", "How would you design the data model and indexes for a feature that {company} customers use every day?", ["access patterns first", "normalisation vs denormalisation", "index choice", "consistency needs", "scaling / partitioning"], "Start from queries, choose SQL/NoSQL based on consistency and relations, index for hot paths, plan for growth.", ["What happens when this table has a billion rows?"], "hard"),
    verbal("Quality", "How do you decide what to test, and how do you keep a test suite fast and trustworthy?", ["test pyramid", "risk-based testing", "flaky test handling", "CI speed", "contract / integration tests"], "Unit tests for logic, fewer integration and e2e tests for critical flows, quarantine flakes, parallelise CI.", ["How do you test code that depends on external APIs?"]),
    verbal("Security", "What are the most common security mistakes you'd look for when reviewing a pull request for a {role}?", ["input validation / injection", "authn and authz checks", "secrets handling", "dependency risk", "least privilege"], "Look for injection, broken access control, leaked secrets, unsafe deserialisation and vulnerable dependencies.", ["How would you roll out a fix for a live vulnerability?"]),
    verbal("Performance", "Tell me how you would find and fix a memory leak in a long-running application.", ["reproduce and measure", "heap snapshots / profilers", "common causes (caches, listeners, closures)", "verify fix under load"], "Measure growth, take heap snapshots over time, diff retained objects, fix the reference, verify with load tests.", ["What monitoring would catch this earlier?"], "hard"),
  ],
  coding: [
    { ...verbal("Arrays & hashing", "Given an array of integers and a target, return the indices of two numbers that add up to the target. Talk me through your approach before coding.", ["clarify constraints", "brute force first", "hash map O(n) solution", "edge cases (duplicates, no answer)", "complexity analysis"], "Use a hash map from value to index; for each number check whether target - n is already present. O(n) time, O(n) space.", ["What if the array were sorted?"], "easy", 900), kind: "coding", starter_code: "function twoSum(nums, target) {\n  // return [i, j]\n}\n", language_hint: "javascript" },
    { ...verbal("Sliding window", "Find the length of the longest substring without repeating characters. Explain the complexity of your solution.", ["sliding window", "set or last-seen map", "window shrink logic", "O(n) complexity", "empty string edge case"], "Keep a map of last seen index; move the left pointer past duplicates; track max window length.", ["How would you return the substring itself?"], "medium", 1200), kind: "coding", starter_code: "function lengthOfLongestSubstring(s) {\n  \n}\n", language_hint: "javascript" },
    { ...verbal("Intervals", "Given a list of meeting time intervals, merge all overlapping intervals.", ["sort by start", "merge when overlapping", "handle touching intervals", "O(n log n)", "input validation"], "Sort by start time, iterate and extend the last merged interval when the next start <= current end.", ["How many meeting rooms would be required?"], "medium", 1200), kind: "coding", starter_code: "function merge(intervals) {\n  \n}\n", language_hint: "javascript" },
    { ...verbal("Graphs", "Count the number of islands in a 2D grid of '1's (land) and '0's (water).", ["DFS or BFS flood fill", "visited marking", "bounds checks", "O(rows*cols)", "iterative vs recursive stack depth"], "Scan the grid; on each unvisited '1' increment count and flood-fill neighbours to mark them visited.", ["How would you handle a grid too large for memory?"], "medium", 1200), kind: "coding", starter_code: "function numIslands(grid) {\n  \n}\n", language_hint: "javascript" },
    { ...verbal("Design a cache", "Implement an LRU cache with get and put in O(1) time.", ["hash map + doubly linked list", "eviction on capacity", "update recency on get", "O(1) operations", "edge cases (capacity 0/1)"], "Combine a Map for lookups with ordering (doubly linked list or Map insertion order); evict the least recently used on overflow.", ["How would you make it thread-safe?"], "hard", 1500), kind: "coding", starter_code: "class LRUCache {\n  constructor(capacity) {}\n  get(key) {}\n  put(key, value) {}\n}\n", language_hint: "javascript" },
  ],
  behavioral: [
    verbal("Conflict", "Tell me about a time you disagreed with a teammate or manager. How did you handle it and what was the outcome?", ["STAR structure", "respectful communication", "data-driven resolution", "outcome", "what you learned"], "Situation, task, the actions you took to understand their view and align on data, the result, and the lesson.", ["What would you do if they still disagreed?"], "easy"),
    verbal("Failure", "Describe a project that failed or missed its goal. What was your role and what did you learn?", ["ownership, no blame", "root cause", "actions taken to recover", "lesson applied later"], "Own your part, explain the root cause, the recovery, and a later situation where you applied the lesson.", ["How did you communicate the failure?"]),
    verbal("Ownership", "Tell me about a time you went beyond your responsibilities to deliver something important.", ["initiative", "impact on users/business", "stakeholder management", "measurable result"], "Pick a story with a clear gap you noticed, the initiative you took, who you aligned with, and quantified impact.", ["How did you balance it with your main work?"]),
    verbal("Pressure", "Describe a situation with a very tight deadline. How did you prioritise?", ["prioritisation framework", "scope negotiation", "communication", "quality trade-offs", "result"], "Explain how you cut scope, communicated early, protected quality on critical parts, and delivered.", ["What did you have to say no to?"], "easy"),
    verbal("Motivation", "Why {company}, and why this {role} role right now?", ["specific knowledge of the company", "connection to own experience", "career direction", "enthusiasm backed by facts"], "Link something specific the company is working on to your past work and to where you want to grow.", ["What would you want to achieve in your first 90 days?"], "easy"),
    verbal("Feedback", "Tell me about the most useful critical feedback you have received and how you acted on it.", ["receptiveness", "specific change in behaviour", "evidence of improvement"], "Share the feedback, your initial reaction, the concrete change you made, and how you know it worked.", ["How do you give difficult feedback to others?"]),
  ],
  system_design: [
    verbal("Scalable service", "Design a URL shortener that handles 100 million new links per month. Start with requirements.", ["clarify functional/non-functional requirements", "capacity estimates", "API and data model", "ID generation strategy", "caching, scaling, analytics"], "Requirements → estimates → API → key generation (base62, counters or hashing) → storage → cache hot links → replication and analytics pipeline.", ["How do you prevent abuse?"], "medium", 900),
    verbal("Real-time", "Design a real-time notification system for a product like the ones {company} builds.", ["delivery channels", "fan-out strategy", "queues / pub-sub", "retries and idempotency", "user preferences and rate limits"], "Event producers → queue → notification service with preferences → channel workers (push, email, websocket) with retries and dedupe.", ["How would you guarantee ordering?"], "hard", 900),
    verbal("Feed", "How would you design a news feed ranking system for millions of users?", ["fan-out on write vs read", "ranking signals", "storage and caching", "celebrity problem", "freshness vs cost"], "Hybrid fan-out, candidate generation plus ranking, cached timelines, special handling for high-follower accounts.", ["How would you A/B test ranking changes?"], "hard", 900),
    verbal("Rate limiting", "Design a distributed rate limiter for a public API.", ["algorithms (token bucket, sliding window)", "where to enforce", "shared state store", "consistency vs latency", "client feedback headers"], "Token bucket per key stored in Redis with atomic scripts, enforced at the gateway, with fallbacks when the store is slow.", ["What happens if Redis goes down?"], "medium", 900),
  ],
  hr: [
    verbal("Career goals", "Where do you see yourself in three years, and how does this role at {company} fit into that?", ["realistic goals", "alignment with role", "growth mindset"], "Describe a concrete growth path that this role helps you build toward.", ["What skills do you want to build first?"], "easy", 120),
    verbal("Work style", "What kind of team environment helps you do your best work?", ["self-awareness", "collaboration", "adaptability"], "Describe your ideal environment honestly and how you adapt when it differs.", ["Tell me about a team culture that didn't work for you."], "easy", 120),
    verbal("Strengths", "What is your greatest professional strength, and what is something you're actively working to improve?", ["specific strength with evidence", "genuine weakness", "improvement actions"], "Pick a strength with a story, and a real weakness with the steps you're taking.", ["How would your last manager describe you?"], "easy", 120),
    verbal("Expectations", "What questions do you have for us about {company}?", ["thoughtful, researched questions", "interest in team and challenges"], "Ask about current challenges, how success is measured, and team practices.", [], "easy", 120),
  ],
};

function extractSkills(config: InterviewConfig): string[] {
  const text = `${config.requirements}\n${config.jobDescription}`;
  const skills = text
    .split(/[,;\n•\-·|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 40 && s.split(" ").length <= 4);
  return skills.length ? skills : [config.field];
}

export function demoPlan(config: InterviewConfig, insights: StoredInsights, pastPrompts: string[]): InterviewPlan {
  const skills = extractSkills(config);
  const fill = (s: string, i: number) =>
    s.replaceAll("{company}", config.company).replaceAll("{role}", config.role).replaceAll("{skill}", skills[i % skills.length]);
  const asked = new Set(pastPrompts);
  const order = { easy: 0, medium: 1, hard: 2 };

  const rounds = config.rounds.map((type) => {
    let pool = [...BANK[type]];
    if (config.difficulty !== "adaptive") pool.sort((a, b) => Number(b.difficulty === config.difficulty) - Number(a.difficulty === config.difficulty));
    // Prefer questions not asked before, then order by difficulty for a natural ramp.
    pool = [...pool.filter((q, i) => !asked.has(fill(q.prompt, i))), ...pool.filter((q, i) => asked.has(fill(q.prompt, i)))];
    const picked = pool.slice(0, config.questionsPerRound).sort((a, b) => order[a.difficulty] - order[b.difficulty]);
    return {
      type,
      title: `${ROUND_LABELS[type]} round`,
      description: `${picked.length} question(s) focused on ${[...new Set(picked.map((q) => q.topic))].join(", ")}.`,
      questions: picked.map((q, i) => ({
        ...q,
        id: `${type}-${i + 1}`,
        prompt: fill(q.prompt, i),
        ideal_answer_outline: fill(q.ideal_answer_outline, i),
        why_asked: insights.topics_to_revisit.length
          ? `Common ${ROUND_LABELS[type].toLowerCase()} challenge; also revisits: ${insights.topics_to_revisit.slice(0, 2).join(", ")}.`
          : `A common ${ROUND_LABELS[type].toLowerCase()} challenge for ${config.role} candidates.`,
        time_limit_seconds: q.time,
      })),
    };
  });

  return {
    interviewer_name: "Alex",
    intro_script: `Hi, I'm Alex, and I'll be your interviewer today for the ${config.role} position at ${config.company}. We'll go through ${rounds.length} round${rounds.length > 1 ? "s" : ""}. Think out loud, and feel free to ask clarifying questions at any time. Let's begin.`,
    company_context_summary: config.companyNotes || `Demo mode: questions come from a built-in bank tailored with the job details you entered for ${config.company}.`,
    focus_areas: [...skills.slice(0, 4), ...insights.topics_to_revisit.slice(0, 2)],
    rounds,
    closing_script: `That's the end of our interview. Thank you for your time — your detailed feedback report will be ready in a moment.`,
  };
}

const CLARIFY_REPLIES: Record<RoundType, string> = {
  coding: "Good question. Assume the input fits in memory and can include edge cases like empty input or duplicates. State any other assumptions out loud and go with them.",
  system_design: "Great question. Assume a large global user base with read-heavy traffic, and aim for high availability. Tell me which other assumptions you're making.",
  technical: "Good question — use whatever context is most realistic from your own experience, and state your assumptions as you go.",
  behavioral: "Any situation from work, school or a personal project is fine, as long as you were directly involved.",
  hr: "There's no single right answer here — just be specific and honest.",
};

export function demoClarification(roundType: RoundType, candidateQuestion: string): ClarificationReply {
  if (/\b(answer|solution|hint|how (do|would) i solve|what should i)\b/i.test(candidateQuestion)) {
    return { reply: "I'd rather hear how you'd approach it first. Walk me through your initial thinking and we'll go from there.", gave_hint: false };
  }
  return { reply: CLARIFY_REPLIES[roundType], gave_hint: false };
}

export function demoFollowUp(answer: string, isFollowUp: boolean, hints: string[]): FollowUp {
  const words = wordCount(answer);
  if (!isFollowUp && words > 0 && words < 45) {
    return {
      acknowledgement: "Thanks, that's a start.",
      ask_follow_up: true,
      follow_up_question: hints[0] ?? "Could you go a bit deeper and give a specific example from your experience?",
    };
  }
  return { acknowledgement: words ? "Thank you, that's helpful." : "Okay, let's move on.", ask_follow_up: false, follow_up_question: null };
}

function scoreAnswer(r: InterviewResponse, q: PlanQuestion | undefined): QuestionEvaluation {
  const text = `${r.answerText} ${r.code}`.toLowerCase();
  const words = wordCount(r.answerText) + Math.round(wordCount(r.code) / 2);
  if (r.skipped || words === 0) {
    return { response_id: r.id, score: 0, verdict: "no_answer", strengths: [], improvements: ["Attempt every question — even a partial approach earns credit."], missed_points: q?.rubric ?? [], model_answer: q?.ideal_answer_outline ?? "", coaching_tip: "If stuck, state your assumptions and outline a brute-force approach out loud." };
  }
  const rubric = q?.rubric ?? [];
  const covered = rubric.filter((point) =>
    point
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .some((w) => text.includes(w)),
  );
  const coverage = rubric.length ? covered.length / rubric.length : 0.5;
  const depth = Math.min(words / 150, 1);
  const delivery = r.fillerCount > 8 ? 0.6 : 1;
  const clarified = (r.clarifications?.length ?? 0) > 0;
  const clarifyBonus = clarified && (r.roundType === "coding" || r.roundType === "system_design") ? 0.5 : 0;
  const score = Math.round((coverage * 6 + depth * 3 + delivery + clarifyBonus) * 10) / 10;
  return {
    response_id: r.id,
    score: Math.min(score, 10),
    verdict: score >= 7.5 ? "strong" : score >= 5 ? "acceptable" : "weak",
    strengths: [
      ...(covered.length ? [`Touched on: ${covered.join(", ")}`] : []),
      ...(depth > 0.7 ? ["Gave a detailed answer"] : []),
      ...(clarified ? ["Asked clarifying questions before answering"] : []),
    ],
    improvements: [
      ...(depth < 0.5 ? ["Answer was brief — add a concrete example and outcome"] : []),
      ...(r.fillerCount > 8 ? [`Reduce filler words (${r.fillerCount} detected)`] : []),
      ...(r.roundType === "behavioral" ? ["Structure the story with STAR: Situation, Task, Action, Result"] : []),
    ],
    missed_points: rubric.filter((p) => !covered.includes(p)),
    model_answer: q?.ideal_answer_outline ?? "",
    coaching_tip: "Open with a one-sentence summary of your answer, then support it with specifics.",
  };
}

export function demoEvaluateRound(interview: Interview, type: RoundType, responses: InterviewResponse[]): RoundEvaluation {
  const questions = new Map(interview.plan?.rounds.flatMap((r) => r.questions).map((q) => [q.id, q]));
  const evals = responses.map((r) => scoreAnswer(r, questions.get(r.questionId)));
  const avg = evals.length ? evals.reduce((s, e) => s + e.score, 0) / evals.length : 0;
  return {
    round_type: type,
    round_score: Math.round(avg * 10),
    summary: `Demo scoring based on rubric coverage and answer depth across ${evals.length} answer(s). Connect an Anthropic API key for detailed AI feedback.`,
    question_evaluations: evals,
  };
}

export function demoEvaluateOverall(rounds: RoundEvaluation[], responses: InterviewResponse[], insights: StoredInsights, integrity: IntegrityReport): OverallEvaluation {
  const overall = rounds.length ? Math.round(rounds.reduce((s, r) => s + r.round_score, 0) / rounds.length) : 0;
  const weakRounds = rounds.filter((r) => r.round_score < 60).map((r) => ROUND_LABELS[r.round_type]);
  const strongRounds = rounds.filter((r) => r.round_score >= 70).map((r) => ROUND_LABELS[r.round_type]);
  const missed = [...new Set(rounds.flatMap((r) => r.question_evaluations.flatMap((q) => q.missed_points)))].slice(0, 6);
  const fillers = responses.reduce((s, r) => s + r.fillerCount, 0);
  const merge = (a: string[], b: string[]) => [...new Set([...b, ...a])].slice(0, 8);
  return {
    overall_score: overall,
    hire_recommendation: overall >= 85 ? "strong_hire" : overall >= 72 ? "hire" : overall >= 60 ? "lean_hire" : overall >= 45 ? "lean_no_hire" : "no_hire",
    headline: overall >= 70 ? "Solid performance with room to sharpen details" : "Keep practising — focus on depth and structure",
    summary: `**Demo evaluation.** Overall score ${overall}/100. ${strongRounds.length ? `Strongest: ${strongRounds.join(", ")}. ` : ""}${weakRounds.length ? `Needs work: ${weakRounds.join(", ")}.` : ""}\n\nIntegrity: ${integrity.score}/100 (${integrity.level.replace("_", " ")}).`,
    communication: { score: fillers > 20 ? 5 : 7, notes: `${fillers} filler words detected across the interview.` },
    top_strengths: strongRounds.map((r) => `Good coverage in the ${r} round`),
    key_gaps: missed,
    action_plan: [
      { title: "Cover the missed key points", detail: missed.slice(0, 3).join("; ") || "Review the model answers for each question.", resources: ["Model answers in this report"] },
      { title: "Structure every answer", detail: "Lead with a summary, then details; use STAR for behavioural questions.", resources: ["STAR method"] },
      { title: "Practice out loud", detail: "Re-answer your weakest questions in the learning session below.", resources: ["Practice again buttons"] },
    ],
    next_interview_focus: weakRounds.length ? weakRounds : ["Harder follow-up questions"],
    updated_profile: {
      strengths: merge(insights.strengths, strongRounds.map((r) => `${r} fundamentals`)),
      weaknesses: merge(insights.weaknesses, weakRounds.map((r) => `${r} depth`)),
      topics_mastered: insights.topics_mastered,
      topics_to_revisit: merge(insights.topics_to_revisit, missed.slice(0, 4)),
      recurring_patterns: merge(insights.recurring_patterns, fillers > 20 ? ["Frequent filler words"] : []),
    },
  };
}

export function demoRetry(previousScore: number | null, answer: string, rubric: string[]): RetryEvaluation {
  const text = answer.toLowerCase();
  const covered = rubric.filter((p) => p.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length > 3 && text.includes(w)));
  const score = Math.min(10, Math.round(((rubric.length ? covered.length / rubric.length : 0.5) * 7 + Math.min(wordCount(answer) / 150, 1) * 3) * 10) / 10);
  return {
    score,
    improved: previousScore === null || score > previousScore,
    feedback: `**Demo feedback.** You covered ${covered.length}/${rubric.length} key points.${rubric.length - covered.length ? `\n\nStill missing:\n- ${rubric.filter((p) => !covered.includes(p)).join("\n- ")}` : ""}`,
  };
}

export function demoCoachReply(interview: Interview, question: string): string {
  const ev = interview.evaluation;
  if (!ev) return "The evaluation isn't ready yet.";
  const weakest = ev.rounds.flatMap((r) => r.question_evaluations).sort((a, b) => a.score - b.score)[0];
  return `_Demo coach — add an Anthropic API key for a real conversational coach._\n\nYou asked: "${question}"\n\n**Your overall score:** ${ev.overall.overall_score}/100\n\n**Biggest gaps:**\n${ev.overall.key_gaps.map((g) => `- ${g}`).join("\n") || "- None recorded"}\n\n${weakest ? `**Weakest answer (${weakest.score}/10)** — improve it by covering:\n${weakest.missed_points.map((m) => `- ${m}`).join("\n")}\n\n**Tip:** ${weakest.coaching_tip}` : ""}`;
}

export function demoStudyPlan(insights: StoredInsights): StudyPlan {
  const topics = [...insights.topics_to_revisit, ...insights.weaknesses];
  const focus = (i: number) => topics[i % Math.max(topics.length, 1)] ?? "Mixed practice";
  return {
    headline: "7-day plan built from your interview history (demo)",
    days: Array.from({ length: 7 }, (_, i) => ({
      day: `Day ${i + 1}`,
      focus: i === 6 ? "Full mock interview" : focus(i),
      tasks: i === 6 ? ["Run a new mock interview in this app", "Review the report and retry weak answers"] : [`Study ${focus(i)} for 45 minutes`, "Answer 2 related questions out loud and record yourself", "Write down one STAR story or one solved problem"],
    })),
    practice_questions: topics.slice(0, 8).map((t) => `Explain ${t} with a real example from your work.`),
  };
}
