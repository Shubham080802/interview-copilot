import "server-only";
import { currentUser } from "@clerk/nextjs/server";
import { authConfigured, legacyOwnerEmail } from "./auth";
import { claimLegacyData, LEGACY_USER_ID } from "./repo";

let legacyClaimed = false;

/**
 * The signed-in Clerk user's id, or LEGACY_USER_ID when no login is configured — every request then
 * shares the same tenant, matching the app's pre-login behaviour exactly (see src/lib/repo.ts).
 */
export async function currentUserId(): Promise<string> {
  if (!authConfigured()) return LEGACY_USER_ID;
  const user = await currentUser();
  if (!user) return LEGACY_USER_ID;
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  if (!legacyClaimed && email && email.toLowerCase() === legacyOwnerEmail()) {
    legacyClaimed = true;
    await claimLegacyData(user.id);
  }
  return user.id;
}
