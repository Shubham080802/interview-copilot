import "server-only";
import { aiEnabled, describeError } from "./ai/client";
import * as ai from "./ai/engine";
import * as demo from "./demo";
import { computeIntegrity } from "./integrity";
import * as repo from "./repo";
import type { RoundType } from "./schemas";
import type { Evaluation, Interview, InterviewResponse } from "./types";
import { createZoomMeeting, zoomConfigured } from "./zoom";

const running = new Set<string>();

/** Research the company, then build the question plan. Runs in the background; the UI polls status. */
export function startPreparation(id: string, forceDemo = false): void {
  if (running.has(id)) return;
  running.add(id);
  prepare(id, forceDemo).finally(() => running.delete(id));
}

async function prepare(id: string, forceDemo: boolean) {
  const interview = repo.getInterview(id);
  if (!interview) return;
  const { config } = interview;
  const useAI = aiEnabled() && !forceDemo;
  repo.updateInterview(id, { status: "preparing", error: null, prepStage: "Loading your interview history" });

  try {
    const profile = repo.getProfile();
    const insights = repo.getInsights();
    const past = repo.pastQuestionHistory(id);

    // Zoom meeting (non-fatal if it fails)
    if (config.zoomMode === "manual" && config.zoomUrl) {
      repo.updateInterview(id, { zoom: { joinUrl: config.zoomUrl, source: "manual" } });
    } else if (config.zoomMode === "auto" && zoomConfigured() && !interview.zoom) {
      repo.updateInterview(id, { prepStage: "Creating Zoom meeting" });
      try {
        const zoom = await createZoomMeeting(`Mock interview — ${config.role} at ${config.company}`, config.scheduledAt || undefined);
        repo.updateInterview(id, { zoom });
      } catch (err) {
        console.warn("[zoom]", err);
      }
    }

    let research = interview.research;
    if (useAI && config.researchCompany && !research) {
      repo.updateInterview(id, { prepStage: `Researching ${config.company}'s current work on the web` });
      try {
        research = await ai.researchCompany(config);
        repo.updateInterview(id, { research });
      } catch (err) {
        // Research is an enhancement — continue with the user's own notes if it fails.
        console.warn("[research]", describeError(err));
      }
    }

    repo.updateInterview(id, {
      prepStage: useAI ? "Designing your personalised questions" : "Building questions from the demo bank",
    });
    const plan = useAI
      ? await ai.generatePlan({ config, profile, research, insights, pastQuestions: past })
      : demo.demoPlan(config, insights, past.map((p) => p.prompt));

    repo.updateInterview(id, { plan, status: "ready", prepStage: "Ready", generatedBy: useAI ? "ai" : "demo" });
  } catch (err) {
    console.error("[prepare]", err);
    repo.updateInterview(id, { status: "failed", error: describeError(err), prepStage: "Failed" });
  }
}

/** Saves an answer and asks the interviewer whether to follow up. */
export async function recordAnswer(
  interview: Interview,
  input: Omit<InterviewResponse, "id" | "retries" | "interviewId">,
) {
  const response = repo.addResponse({ ...input, interviewId: interview.id });
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
  evaluate(id).finally(() => running.delete(id));
}

async function evaluate(id: string) {
  const interview = repo.getInterview(id);
  if (!interview) return;
  const responses = repo.listResponses(id);
  const integrity = computeIntegrity(repo.listProctorEvents(id));
  repo.updateInterview(id, { status: "evaluating", integrity, error: null, endedAt: interview.endedAt ?? new Date().toISOString() });
  const useAI = interview.generatedBy === "ai" && aiEnabled();
  const insights = repo.getInsights();

  // Nothing answered: record an empty result without AI calls or touching the long-term profile.
  if (!responses.some((r) => !r.skipped)) {
    const overall = demo.demoEvaluateOverall([], responses, insights, integrity);
    overall.headline = "Interview ended before any question was answered";
    overall.summary = "No answers were given, so there is nothing to evaluate. Start a new interview when you're ready.";
    overall.action_plan = [];
    overall.updated_profile = insights;
    repo.updateInterview(id, {
      evaluation: { rounds: [], overall, generatedBy: "demo", generatedAt: new Date().toISOString() },
      status: "completed",
    });
    return;
  }

  try {
    const roundTypes = [...new Set(responses.map((r) => r.roundType))] as RoundType[];
    const refreshed = repo.getInterview(id)!;
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
    repo.updateInterview(id, { evaluation, status: "completed" });

    // Persist the learning into the long-term candidate profile used for future interviews.
    const alreadyCounted = interview.evaluation !== null;
    repo.saveInsights({
      ...insights,
      ...overall.updated_profile,
      nextFocus: overall.next_interview_focus,
      sessionCount: insights.sessionCount + (alreadyCounted ? 0 : 1),
      studyPlan: null,
    });
  } catch (err) {
    console.error("[evaluate]", err);
    repo.updateInterview(id, { status: "failed", error: `Evaluation failed: ${describeError(err)}` });
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
  repo.saveResponse(response);
  return result;
}

export async function studyPlan() {
  const insights = repo.getInsights();
  const recent = repo
    .listInterviews()
    .filter((i) => i.status === "completed")
    .slice(0, 5)
    .map((i) => `- ${i.role} at ${i.company}: ${i.overallScore ?? "?"}/100`)
    .join("\n");
  const plan = aiEnabled() ? await ai.generateStudyPlan(insights, recent || "none") : demo.demoStudyPlan(insights);
  repo.saveInsights({ ...insights, studyPlan: plan });
  return plan;
}
