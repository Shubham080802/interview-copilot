import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

// Server-side refusal fallback: if the primary model declines, the API re-runs the
// request on Anthropic's recommended fallback model inside the same call.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function aiEnabled(): boolean {
  if (process.env.DEMO_MODE === "1") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let _client: Anthropic | null = null;
export function client(): Anthropic {
  _client ??= new Anthropic();
  return _client;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AIError extends Error {}

/** Turns SDK errors into short messages that are safe to show in the UI. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic API key is invalid. Check ANTHROPIC_API_KEY in .env.local.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key does not have access to the model.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API — wait a moment and retry.";
  if (err instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API — check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error (${err.status ?? "unknown"}): ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** One structured-output call validated against a Zod schema. */
export async function structured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  prompt: string | Anthropic.Beta.BetaContentBlockParam[];
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    system: opts.system,
    output_config: { effort: opts.effort ?? "high", format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.prompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new AIError("The AI declined to answer this request. Try rephrasing the job details.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AIError("The AI response was cut off. Try fewer questions per round.");
  }
  if (!response.parsed_output) throw new AIError("The AI returned an unexpected format. Please retry.");
  return response.parsed_output as z.infer<T>;
}
