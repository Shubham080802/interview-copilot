import { AppShell } from "@/components/AppShell";
import { aiEnabled } from "@/lib/ai/client";
import { plural } from "@/lib/format";
import { getInsights, getProfile } from "@/lib/repo";
import { prefillFromParams, suggestRoles, type SearchParamValue } from "@/lib/role-catalog";
import { zoomConfigured } from "@/lib/zoom";
import { NewInterviewForm } from "./NewInterviewForm";

export const dynamic = "force-dynamic";

export default async function NewInterviewPage({ searchParams }: { searchParams: Promise<Record<string, SearchParamValue>> }) {
  const [insights, profile, params] = await Promise.all([getInsights(), getProfile(), searchParams]);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight">Set up your interview</h1>
        <p className="mt-1 text-sm text-slate-500">
          The more you tell us about the company and role, the closer the questions get to the real thing.
          {insights.sessionCount > 0 && ` Your history from ${plural(insights.sessionCount, "previous interview")} will be used automatically.`}
        </p>
        <NewInterviewForm aiEnabled={aiEnabled()} zoomConfigured={zoomConfigured()} suggestions={suggestRoles(profile, 3)} initial={prefillFromParams(params)} />
      </div>
    </AppShell>
  );
}
