import type { AssistanceCheck, PlanQuestion } from "../schemas";

/**
 * Decides whether speech from another person near the candidate is help with the interview.
 * Only a high-confidence "related and helping" verdict cancels an interview; anything weaker is
 * kept as evidence only, because a false cancellation is costly.
 */
export function isCheating(check: AssistanceCheck): boolean {
  return check.related_to_interview && check.helping_candidate && check.confidence === "high";
}

const STOPWORDS = new Set(
  "about above after again also always another answer because been before being between both could does doing during each explain from have having here into just like make many more most much need other over really said should since some such than that their them then there these they thing think this those through time very want well were what when where which while will with would your yours tell talk".split(
    " ",
  ),
);

const HELP_CUES =
  /\b(the answer( is)?|answer is|just say|say (that|this|it)|tell (him|her|them)|you should|you need to|write (down|this|that)|use (a|an|the)|it'?s called|it is called|mention|remember to|the solution|big ?o|o of n|o\(n|type (this|that))\b/i;

const contentWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );

/** Keyword-based check used without AI (and as a fallback if the AI check fails). Deliberately conservative. */
export function heuristicAssistanceCheck(input: { transcript: string; question: PlanQuestion | null; prompt: string }): AssistanceCheck {
  const vocabulary = contentWords(
    [input.prompt, input.question?.topic, input.question?.rubric.join(" "), input.question?.ideal_answer_outline, input.question?.follow_up_hints.join(" ")]
      .filter(Boolean)
      .join(" "),
  );
  const spoken = contentWords(input.transcript);
  const overlap = [...spoken].filter((w) => vocabulary.has(w));
  const cue = HELP_CUES.exec(input.transcript)?.[0] ?? "";

  const related = overlap.length >= 2;
  const helping = related && (Boolean(cue) || overlap.length >= 4);
  const confidence: AssistanceCheck["confidence"] =
    helping && ((cue && overlap.length >= 3) || overlap.length >= 5) ? "high" : helping ? "medium" : "low";

  return {
    related_to_interview: related,
    helping_candidate: helping,
    confidence,
    reason: helping
      ? `The other person's speech matches the question (${overlap.slice(0, 6).join(", ")})${cue ? ` and tells the candidate what to do ("${cue}")` : ""}.`
      : related
        ? "The speech touches on the question's topic but doesn't clearly help."
        : "The speech isn't about the interview question.",
    evidence_quote: helping ? input.transcript.slice(0, 200) : "",
  };
}
