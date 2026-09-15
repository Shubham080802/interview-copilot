import { AppShell } from "@/components/AppShell";
import { aiEnabled } from "@/lib/ai/client";
import { getInsights } from "@/lib/repo";
import { zoomConfigured } from "@/lib/zoom";
import { NewInterviewForm } from "./NewInterviewForm";

export const dynamic = "force-dynamic";

export default async function NewInterviewPage() {
  const insights = await getInsights();
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight">Set up your interview</h1>
        <p className="mt-1 text-sm text-slate-500">
          The more you tell us about the company and role, the closer the questions get to the real thing.
          {insights.sessionCount > 0 && ` Your history from ${insights.sessionCount} previous interview(s) will be used automatically.`}
        </p>
        <NewInterviewForm aiEnabled={aiEnabled()} zoomConfigured={zoomConfigured()} />
      </div>
    </AppShell>
  );
}
