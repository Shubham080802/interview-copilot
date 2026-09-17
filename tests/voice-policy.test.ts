import { describe, expect, it } from "vitest";
import { OTHER_VOICE_POLICY as P, OtherVoicePolicy } from "@/lib/voice-id/policy";

const CANDIDATE_DB = -20;
const other = (at: number, levelDb = -22) => ({ at, similarity: 0.1, levelDb });
const candidate = (at: number) => ({ at, similarity: 0.8, levelDb: -20 });

describe("OtherVoicePolicy", () => {
  it("ignores the candidate's own voice", () => {
    const policy = new OtherVoicePolicy(CANDIDATE_DB);
    for (let t = 0; t < 60_000; t += 2000) expect(policy.observe(candidate(t)).kind).toBe("none");
  });

  it("ignores voices far away (much quieter than the candidate)", () => {
    const policy = new OtherVoicePolicy(CANDIDATE_DB);
    const far = CANDIDATE_DB - P.proximityDb - 1;
    expect(policy.observe(other(0, far)).kind).toBe("none");
    expect(policy.observe(other(2000, far)).kind).toBe("none");
  });

  it("needs repeated mismatches close together before warning", () => {
    const policy = new OtherVoicePolicy(CANDIDATE_DB);
    expect(policy.observe(other(0)).kind).toBe("none");
    // A single stray window long ago doesn't combine with a new one.
    expect(policy.observe(other(P.confirmSpanMs + 5000)).kind).toBe("none");
    const decision = policy.observe(other(P.confirmSpanMs + 7000));
    expect(decision.kind).toBe("warn");
    expect(decision.kind === "warn" && decision.warningEndsAt).toBe(P.confirmSpanMs + 7000 + P.warningMs);
  });

  it("terminates when another voice is detected again within 2 minutes of the warning", () => {
    const policy = new OtherVoicePolicy(CANDIDATE_DB);
    policy.observe(other(0));
    expect(policy.observe(other(2000)).kind).toBe("warn");
    expect(policy.warningRemaining(62_000)).toBe(60_000);
    policy.observe(other(90_000));
    expect(policy.observe(other(92_000)).kind).toBe("terminate");
    // Once terminated, nothing further is reported.
    expect(policy.observe(other(94_000)).kind).toBe("none");
  });

  it("gives the candidate time to react: speech right after a warning doesn't terminate", () => {
    const policy = new OtherVoicePolicy(CANDIDATE_DB);
    policy.observe(other(0));
    expect(policy.observe(other(2000)).kind).toBe("warn");
    // The same sentence continuing for a few seconds after the warning.
    for (const t of [3000, 4000, 5000, 6000, 7000]) expect(policy.observe(other(t)).kind).toBe("none");
    // Heard again after the grace period (but within 2 minutes) → terminate.
    policy.observe(other(2000 + P.graceAfterWarningMs + 1000));
    expect(policy.observe(other(2000 + P.graceAfterWarningMs + 3000)).kind).toBe("terminate");
  });

  it("clears the warning when the voice isn't heard again within 2 minutes", () => {
    const policy = new OtherVoicePolicy(CANDIDATE_DB);
    policy.observe(other(0));
    policy.observe(other(2000));
    expect(policy.warningRemaining(2000 + P.warningMs + 1)).toBe(0);
    policy.observe(other(2000 + P.warningMs + 10_000));
    // A later detection starts a new warning instead of terminating.
    expect(policy.observe(other(2000 + P.warningMs + 12_000)).kind).toBe("warn");
  });

  it("extends the warning window by paused time", () => {
    const policy = new OtherVoicePolicy(CANDIDATE_DB);
    policy.observe(other(0));
    policy.observe(other(2000));
    policy.extendWarning(30_000);
    expect(policy.warningRemaining(2000)).toBe(P.warningMs + 30_000);
  });
});
