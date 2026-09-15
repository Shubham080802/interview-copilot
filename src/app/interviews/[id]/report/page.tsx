import { AppShell } from "@/components/AppShell";
import { Report } from "./Report";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <Report id={id} />
    </AppShell>
  );
}
