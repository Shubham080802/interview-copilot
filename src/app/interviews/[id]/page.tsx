import { AppShell } from "@/components/AppShell";
import { InterviewOverview } from "./InterviewOverview";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <InterviewOverview id={id} />
    </AppShell>
  );
}
