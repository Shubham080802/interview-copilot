import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { authConfigured } from "@/lib/auth";

/*
 * Requires sign-in for every page and API route once Clerk is configured (see src/lib/auth.ts);
 * with no keys set, this is a no-op and the app runs exactly as it does today. Clerk's own
 * sign-in/sign-up pages stay reachable while signed out — otherwise nobody could ever sign in.
 *
 * This only enforces "must be signed in". Who is *allowed* to sign in at all is enforced by the
 * Clerk Dashboard's own "Restricted" sign-up mode (see README) — that runs before any of this code
 * and can't be bypassed by calling an API route directly, which a check made only in a page layout
 * could be.
 */
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default authConfigured()
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) await auth.protect();
    })
  : () => NextResponse.next();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
