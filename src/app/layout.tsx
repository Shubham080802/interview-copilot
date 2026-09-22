import type { Metadata } from "next";
import { ClerkProvider, SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { ShieldAlert } from "lucide-react";
import "./globals.css";
import { authConfigured, isAllowedEmail } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Interview Copilot",
  description: "AI mock interviews tailored to the company, with proctoring, evaluation and learning sessions.",
};

/**
 * Everyone reaching this point is already signed in (middleware requires it once Clerk is
 * configured); this only covers the rarer case of a signed-in email that isn't on ALLOWED_EMAILS —
 * see src/lib/auth.ts for why the Clerk Dashboard restriction, not this check, is what actually
 * keeps a stranger from getting an account in the first place.
 */
async function Gate({ children }: { children: React.ReactNode }) {
  if (!authConfigured()) return <>{children}</>;
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;
  if (user && !isAllowedEmail(email)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-rose-100">
          <ShieldAlert className="h-7 w-7 text-rose-700" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Access restricted</h1>
        <p className="mt-2 text-sm text-slate-600">
          {email ? (
            <>
              Signed in as <span className="font-medium">{email}</span>, which isn&apos;t allowed to use this app.
            </>
          ) : (
            "This account isn't allowed to use this app."
          )}
        </p>
        <SignOutButton>
          <button className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800">Sign out</button>
        </SignOutButton>
      </main>
    );
  }
  return <>{children}</>;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const body = (
    <body className="min-h-full font-sans">
      <Gate>{children}</Gate>
    </body>
  );
  if (!authConfigured()) return <html lang="en">{body}</html>;
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
      <html lang="en">{body}</html>
    </ClerkProvider>
  );
}
