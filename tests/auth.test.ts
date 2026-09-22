import { afterEach, describe, expect, it } from "vitest";
import { authConfigured, legacyOwnerEmail } from "@/lib/auth";

const ENV_KEYS = ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "ALLOWED_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("authConfigured", () => {
  it("is off with neither key set — the app stays open, like AI mode without an API key", () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    expect(authConfigured()).toBe(false);
  });

  it("needs both keys, not just one", () => {
    process.env.CLERK_SECRET_KEY = "sk_test_x";
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    expect(authConfigured()).toBe(false);
    delete process.env.CLERK_SECRET_KEY;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_x";
    expect(authConfigured()).toBe(false);
  });

  it("is on once both are set", () => {
    process.env.CLERK_SECRET_KEY = "sk_test_x";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_x";
    expect(authConfigured()).toBe(true);
  });
});

describe("legacyOwnerEmail", () => {
  it("is null when unset", () => {
    delete process.env.ALLOWED_EMAILS;
    expect(legacyOwnerEmail()).toBeNull();
  });

  it("reads the first email, lowercased and trimmed", () => {
    process.env.ALLOWED_EMAILS = " Me@Example.com, other@example.com ";
    expect(legacyOwnerEmail()).toBe("me@example.com");
  });
});
