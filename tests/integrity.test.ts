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
});
