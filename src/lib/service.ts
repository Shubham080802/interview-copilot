import "server-only";
import { after } from "next/server";
import { aiEnabled, describeError } from "./ai/client";
import * as ai from "./ai/engine";
import * as demo from "./demo";
import { computeIntegrity } from "./integrity";
import { basicJobPosting, extractPdfText, ImportError, isPdf, safeFetchText, scrapeJobPage } from "./importers";
import * as repo from "./repo";
import type { ClarificationReply, JobPosting, ResumeProfile, RoundType } from "./schemas";
import type { Clarification, Evaluation, Interview, InterviewResponse } from "./types";
import { createZoomMeeting, zoomConfigured } from "./zoom";

const running = new Set<string>();

/**
 * Keeps a background task alive after the HTTP response. On serverless hosts (Vercel) the function
 * would otherwise be frozen once the response is sent; locally and in tests the promise just runs.
 */
function runInBackground(task: Promise<unknown>) {
  try {
    after(() => task);
  } catch {
    // Not inside a request (e.g. tests) — the task is already running.
  }
}

/** Research the company, then build the question plan. Runs in the background; the UI polls status. */
export function startPreparation(id: string, forceDemo = false): void {
  if (running.has(id)) return;
  running.add(id);
  runInBackground(prepare(id, forceDemo).finally(() => running.delete(id)));
}

async function prepare(id: string, forceDemo: boolean) {
  const interview = await repo.getInterview(id);
  if (!interview) return;
  const { config } = interview;
  const useAI = aiEnabled() && !forceDemo;
  await repo.updateInterview(id, { status: "preparing", error: null, prepStage: "Loading your interview history" });

  try {
    const profile = await repo.getProfile();
    const insights = await repo.getInsights();
    const past = await repo.pastQuestionHistory(id);

    // Zoom meeting (non-fatal if it fails)
    if (config.zoomMode === "manual" && config.zoomUrl) {
      await repo.updateInterview(id, { zoom: { joinUrl: config.zoomUrl, source: "manual" } });
    } else if (config.zoomMode === "auto" && zoomConfigured() && !interview.zoom) {
      await repo.updateInterview(id, { prepStage: "Creating Zoom meeting" });
      try {
        const zoom = await createZoomMeeting(`Mock interview — ${config.role} at ${config.company}`, config.scheduledAt || undefined);
        await repo.updateInterview(id, { zoom });
      } catch (err) {
        console.warn("[zoom]", err);
      }
    }

    let research = interview.research;
    if (useAI && config.researchCompany && !research) {
      await repo.updateInterview(id, { prepStage: `Researching ${config.company}'s current work on the web` });
      try {
        research = await ai.researchCompany(config);
        await repo.updateInterview(id, { research });
      } catch (err) {
        // Research is an enhancement — continue with the user's own notes if it fails.
        console.warn("[research]", describeError(err));
      }
    }

    await repo.updateInterview(id, {
      prepStage: useAI ? "Designing your personalised questions" : "Building questions from the demo bank",
    });
    const plan = useAI
      ? await ai.generatePlan({ config, profile, research, insights, pastQuestions: past })
      : demo.demoPlan(config, insights, past.map((p) => p.prompt));

    await repo.updateInterview(id, { plan, status: "ready", prepStage: "Ready", generatedBy: useAI ? "ai" : "demo" });
  } catch (err) {
    console.error("[prepare]", err);
    await repo.updateInterview(id, { status: "failed", error: describeError(err), prepStage: "Failed" });
  }
}

/** Saves an answer and asks the interviewer whether to follow up. */
export async function recordAnswer(
  interview: Interview,
  input: Omit<InterviewResponse, "id" | "retries" | "interviewId">,
) {
  const response = await repo.addResponse({ ...input, interviewId: interview.id });
  const question = interview.plan?.rounds.flatMap((r) => r.questions).find((q) => q.id === input.questionId) ?? null;

  if (input.skipped) {
    return { response, followUp: { acknowledgement: "No problem, let's move on.", ask_follow_up: false, follow_up_question: null } };
  }
  if (interview.generatedBy === "ai" && aiEnabled()) {
    try {
      const followUp = await ai.decideFollowUp({
        config: interview.config,
        question,
        prompt: input.prompt,
        answer: input.answerText,
        code: input.code,
        isFollowUp: input.isFollowUp,
      });
      if (input.isFollowUp) followUp.ask_follow_up = false;
      return { response, followUp };
    } catch (err) {
      console.warn("[follow-up]", describeError(err));
    }
  }
  return { response, followUp: demo.demoFollowUp(input.answerText + input.code, input.isFollowUp, question?.follow_up_hints ?? []) };
}

/** Ends the interview: integrity report, per-round evaluation, overall synthesis, and profile update. */
export function startEvaluation(id: string): void {
  if (running.has(id)) return;
  running.add(id);
  runInBackground(evaluate(id).finally(() => running.delete(id)));
}

async function evaluate(id: string) {
  const interview = await repo.getInterview(id);
  if (!interview) return;
  const responses = await repo.listResponses(id);
  const integrity = computeIntegrity(await repo.listProctorEvents(id));
  await repo.updateInterview(id, { status: "evaluating", integrity, error: null, endedAt: interview.endedAt ?? new Date().toISOString() });
  const useAI = interview.generatedBy === "ai" && aiEnabled();
  const insights = await repo.getInsights();

  // Nothing answered: record an empty result without AI calls or touching the long-term profile.
  if (!responses.some((r) => !r.skipped)) {
    const overall = demo.demoEvaluateOverall([], responses, insights, integrity);
    overall.headline = "Interview ended before any question was answered";
    overall.summary = "No answers were given, so there is nothing to evaluate. Start a new interview when you're ready.";
    overall.action_plan = [];
    overall.updated_profile = insights;
    await repo.updateInterview(id, {
      evaluation: { rounds: [], overall, generatedBy: "demo", generatedAt: new Date().toISOString() },
      status: "completed",
    });
    return;
  }

  try {
    const roundTypes = [...new Set(responses.map((r) => r.roundType))] as RoundType[];
    const refreshed = (await repo.getInterview(id))!;
    const rounds = await Promise.all(
      roundTypes.map((type) => {
        const rs = responses.filter((r) => r.roundType === type);
        return useAI ? ai.evaluateRound(refreshed, type, rs) : Promise.resolve(demo.demoEvaluateRound(refreshed, type, rs));
      }),
    );
    const overall = useAI
      ? await ai.evaluateOverall({ interview: refreshed, rounds, responses, integrity, insights })
      : demo.demoEvaluateOverall(rounds, responses, insights, integrity);

    const evaluation: Evaluation = { rounds, overall, generatedBy: useAI ? "ai" : "demo", generatedAt: new Date().toISOString() };
    await repo.updateInterview(id, { evaluation, status: "completed" });

    // Persist the learning into the long-term candidate profile used for future interviews.
    const alreadyCounted = interview.evaluation !== null;
    await repo.saveInsights({
      ...insights,
      ...overall.updated_profile,
      nextFocus: overall.next_interview_focus,
      sessionCount: insights.sessionCount + (alreadyCounted ? 0 : 1),
      studyPlan: null,
    });
  } catch (err) {
    console.error("[evaluate]", err);
    await repo.updateInterview(id, { status: "failed", error: `Evaluation failed: ${describeError(err)}` });
  }
}

export async function retryAnswer(interview: Interview, response: InterviewResponse, answerText: string, code: string) {
  const question = interview.plan?.rounds.flatMap((r) => r.questions).find((q) => q.id === response.questionId) ?? null;
  const previous = interview.evaluation?.rounds.flatMap((r) => r.question_evaluations).find((q) => q.response_id === response.id);
  const result =
    interview.generatedBy === "ai" && aiEnabled()
      ? await ai.evaluateRetry({ interview, response, question, previousScore: previous?.score ?? null, answerText, code })
      : demo.demoRetry(previous?.score ?? null, `${answerText} ${code}`, question?.rubric ?? []);
  response.retries.push({ at: new Date().toISOString(), answerText, code, result });
  await repo.saveResponse(response);
  return result;
}

export async function studyPlan() {
  const insights = await repo.getInsights();
  const recent = (await repo.listInterviews())
    .filter((i) => i.status === "completed")
    .slice(0, 5)
    .map((i) => `- ${i.role} at ${i.company}: ${i.overallScore ?? "?"}/100`)
    .join("\n");
  const plan = aiEnabled() ? await ai.generateStudyPlan(insights, recent || "none") : demo.demoStudyPlan(insights);
  await repo.saveInsights({ ...insights, studyPlan: plan });
  return plan;
}

/* ------------------------------------------------------------------ */
/*  Clarifying questions                                               */
/* ------------------------------------------------------------------ */

export const MAX_CLARIFICATIONS = 5;

export async function clarify(
  interview: Interview,
  input: { questionId: string; prompt: string; candidateQuestion: string; previous: Clarification[] },
): Promise<ClarificationReply> {
  const question = interview.plan?.rounds.flatMap((r) => r.questions).find((q) => q.id === input.questionId) ?? null;
  const roundType = interview.plan?.rounds.find((r) => r.questions.some((q) => q.id === input.questionId))?.type ?? "technical";
  if (interview.generatedBy === "ai" && aiEnabled()) {
    try {
      return await ai.answerClarification({
        config: interview.config,
        question,
        prompt: input.prompt,
        candidateQuestion: input.candidateQuestion,
        previous: input.previous,
      });
    } catch (err) {
      console.warn("[clarify]", describeError(err));
    }
  }
  return demo.demoClarification(roundType, input.candidateQuestion);
}

/* ------------------------------------------------------------------ */
/*  Imports                                                            */
/* ------------------------------------------------------------------ */

export interface ImportResult<T> {
  data: T;
  method: "ai" | "basic";
  warning?: string;
}

export async function importResume(file: Uint8Array, filename: string): Promise<ImportResult<ResumeProfile>> {
  const pdf = isPdf(file);
  if (!pdf && !/\.(txt|md)$/i.test(filename)) throw new ImportError("Upload a PDF, .txt or .md resume.");
  const text = pdf ? null : Buffer.from(file).toString("utf8");

  if (aiEnabled()) {
    try {
      const data = await ai.extractResume(pdf ? { pdfBase64: Buffer.from(file).toString("base64") } : { text: text! });
      return { data: { ...data, experience_years: Math.max(0, Math.round(data.experience_years)) }, method: "ai" };
    } catch (err) {
      console.warn("[resume]", describeError(err));
      const plain = await basicResume(pdf, file, text);
      return { ...plain, warning: `AI extraction failed (${describeError(err)}), so the raw text was imported.` };
    }
  }
  return basicResume(pdf, file, text);
}

async function basicResume(pdf: boolean, file: Uint8Array, text: string | null): Promise<ImportResult<ResumeProfile>> {
  const raw = pdf ? await extractPdfText(file) : text!;
  if (!raw.trim()) throw new ImportError("No text was found in that file. If it's a scanned image, paste the text instead.");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const name = lines.find((l) => /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(l) && l.split(" ").length <= 4) ?? "";
  const years = [...raw.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])).filter((y) => y <= new Date().getFullYear());
  return {
    data: {
      name,
      headline: "",
      experience_years: years.length ? Math.min(40, new Date().getFullYear() - Math.min(...years)) : 0,
      resume_markdown: raw,
    },
    method: "basic",
    warning: "Imported the resume text without AI — review the name and years of experience.",
  };
}

export async function importJobPosting(source: { url?: string; text?: string }): Promise<ImportResult<JobPosting>> {
  if (source.text) {
    if (!aiEnabled()) throw new ImportError("Extracting details from pasted text needs AI mode. You can still paste it into the fields.");
    return { data: await ai.structureJobPosting({ text: source.text }), method: "ai" };
  }

  let scraped: ReturnType<typeof scrapeJobPage> | null = null;
  let fetchError: unknown = null;
  try {
    const page = await safeFetchText(source.url!);
    scraped = scrapeJobPage(page.url, page.html);
  } catch (err) {
    if (err instanceof ImportError && /private|valid URL|http\(s\)|custom ports/.test(err.message)) throw err;
    fetchError = err;
  }
  const usable = scraped && scraped.description.length > 300;

  if (aiEnabled()) {
    const text = usable
      ? `${scraped!.title}\n${scraped!.company}\n\n${scraped!.description}`
      : await ai.fetchPageWithClaude(source.url!); // blocked or JS-rendered pages
    return { data: await ai.structureJobPosting({ url: source.url, text }), method: "ai" };
  }
  if (!usable) {
    throw fetchError instanceof ImportError
      ? fetchError
      : new ImportError("That page didn't contain a readable job description (it may need JavaScript or a login). Paste the description instead.");
  }
  return {
    data: basicJobPosting(scraped!),
    method: "basic",
    warning: scraped!.fromStructuredData ? undefined : "Imported without AI — double-check the role, company and requirements.",
  };
}
