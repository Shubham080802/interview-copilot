import { describe, expect, it, vi } from "vitest";
import { ConversationMixer } from "@/lib/client/interviewer-voice";

/**
 * Browsers only let audio start while a user gesture is active. Without one, `resume()` returns a
 * promise that never settles — the interview must not wait on it, or clicking "Start interview"
 * would appear to do nothing at all.
 */
function mixerWithContext(ctx: Partial<AudioContext>): ConversationMixer {
  const mixer = Object.create(ConversationMixer.prototype) as ConversationMixer;
  Object.defineProperty(mixer, "ctx", { value: ctx, writable: true });
  return mixer;
}

describe("unlocking audio", () => {
  it("gives up when the browser never allows playback", async () => {
    vi.useFakeTimers();
    const mixer = mixerWithContext({ state: "suspended", resume: () => new Promise<void>(() => {}) });
    const result = mixer.resume(2000);
    await vi.advanceTimersByTimeAsync(2100);
    expect(await result).toBe(false);
    vi.useRealTimers();
  });

  it("reports success once the context is running", async () => {
    const ctx = { state: "suspended" as AudioContextState, resume: vi.fn() };
    ctx.resume.mockImplementation(async () => {
      ctx.state = "running";
    });
    expect(await mixerWithContext(ctx).resume()).toBe(true);
  });

  it("does not call resume when audio is already playing", async () => {
    const resume = vi.fn();
    expect(await mixerWithContext({ state: "running", resume }).resume()).toBe(true);
    expect(resume).not.toHaveBeenCalled();
  });

  it("treats a refused resume as blocked rather than throwing", async () => {
    const mixer = mixerWithContext({ state: "suspended", resume: () => Promise.reject(new Error("not allowed")) });
    expect(await mixer.resume(500)).toBe(false);
  });
});
