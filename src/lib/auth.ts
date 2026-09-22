import "server-only";

/**
 * The login gate (Clerk) is entirely optional: with no keys set the app runs exactly as it does
 * today, open, the same way AI mode and Zoom fall back to demo/disabled without their own keys.
 */
export function authConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * What actually stops a stranger from getting an account at all is the Clerk Dashboard's own
 * "Restricted" sign-up mode (Restrictions → allow only your email) — that runs before any of this
 * code, and can't be bypassed by calling an API route directly. ALLOWED_EMAILS is only a second,
 * optional check that turns "somehow signed in anyway" into a clear in-app message instead of a
 * working app for the wrong person. Leave it unset to rely on the Dashboard restriction alone.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return Boolean(email) && allowed.includes(email!.toLowerCase());
}
