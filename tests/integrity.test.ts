import { describe, expect, it } from "vitest";
import { computeIntegrity } from "@/lib/integrity";
import type { ProctorEvent } from "@/lib/types";

const event = (e: Partial<ProctorEvent>): ProctorEvent => ({
  id: "e",
  interviewId: "i",
  at: new Date().toISOString(),
  type: "note",
  severity: "medium",
  detail: "",
  durationSec: 0,
  snapshot: null,
  ...e,
});

describe("computeIntegrity", () => {
  it("is clean with no events", () => {
    const r = computeIntegrity([]);
    expect(r.score).toBe(100);
    expect(r.level).toBe("clean");
  });

  it("penalises serious and long-lasting flags more", () => {
    const blip = computeIntegrity([event({ type: "looking_away", severity: "low", durationSec: 4 })]);
    const long = computeIntegrity([event({ type: "no_face", severity: "high", durationSec: 90 })]);
    expect(blip.score).toBeGreaterThan(long.score);
    expect(long.awaySeconds).toBe(90);
  });

  it("escalates to high risk for repeated severe flags", () => {
    const events = Array.from({ length: 4 }, () => event({ type: "multiple_faces", severity: "high", durationSec: 10 }));
    const r = computeIntegrity(events);
    expect(r.level).toBe("high_risk");
    expect(r.counts.multiple_faces).toBe(4);
    expect(r.notes.join(" ")).toContain("Another person");
  });

  it("never goes below zero", () => {
    const events = Array.from({ length: 50 }, () => event({ type: "paste", severity: "high" }));
    expect(computeIntegrity(events).score).toBe(0);
  });

  it("marks an automatically terminated interview as high risk with the reason", () => {
    const r = computeIntegrity([
      event({ type: "other_voice", severity: "high" }),
      event({ type: "other_voice", severity: "high" }),
      event({ type: "terminated", severity: "high", detail: "another voice was heard again within 2 minutes of a warning" }),
    ]);
    expect(r.level).toBe("high_risk");
    expect(r.score).toBeLessThanOrEqual(25);
    expect(r.terminatedReason).toMatch(/another voice/);
    expect(r.notes.join(" ")).toMatch(/ended automatically/);
    expect(r.counts.other_voice).toBe(2);
  });

  it("reports determined cheating as high risk even without a termination event", () => {
    const r = computeIntegrity([event({ type: "assistance", severity: "high", detail: "clear help with the current question" })]);
    expect(r.cheatingDetermined).toBe(true);
    expect(r.score).toBe(0);
    expect(r.level).toBe("high_risk"); // the level must match the score the report shows
  });

  it("penalises a single other-voice warning without terminating", () => {
    const r = computeIntegrity([event({ type: "other_voice", severity: "high" })]);
    expect(r.terminatedReason).toBeNull();
    expect(r.score).toBeLessThan(90);
    expect(r.notes.join(" ")).toMatch(/Another person's voice/);
  });
});
