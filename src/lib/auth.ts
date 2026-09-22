import "server-only";

/**
 * The login gate (Clerk) is entirely optional: with no keys set the app runs exactly as it does
 * today, open, the same way AI mode and Zoom fall back to demo/disabled without their own keys.
 */
export function authConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * Anyone can sign up and use the app now — everyone gets their own private profile and interview
 * history. ALLOWED_EMAILS is repurposed for one thing only: whichever email it names inherits the
 * data that existed before accounts did, the first time it signs in. See claimLegacyData in repo.ts.
 */
export function legacyOwnerEmail(): string | null {
  return (process.env.ALLOWED_EMAILS ?? "").split(",")[0]?.trim().toLowerCase() || null;
}
