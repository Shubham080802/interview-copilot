import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { aiEnabled, MODEL } from "@/lib/ai/client";
import { authConfigured } from "@/lib/auth";
import { NavLinks } from "./NavLinks";

export function AppShell({ children }: { children: React.ReactNode }) {
  const ai = aiEnabled();
  const loginEnabled = authConfigured();
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        {/* On a phone the title and mode sit on one row and the links scroll sideways underneath. */}
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm text-white">IC</span>
              Interview Copilot
            </Link>
            <div className="hidden sm:block sm:flex-1">
              <NavLinks />
            </div>
            <span
              title={ai ? `Using ${MODEL}` : "Add ANTHROPIC_API_KEY to .env.local and restart to enable AI"}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${ai ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
            >
              {ai ? `AI mode · ${MODEL}` : "Demo mode · no API key"}
            </span>
            {loginEnabled && <UserButton afterSwitchSessionUrl="/sign-in" />}
          </div>
          <div className="-mx-1 mt-2 overflow-x-auto sm:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavLinks />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
