import type { InterviewStatus } from "@/lib/types";
import { Badge } from "./ui";

const MAP: Record<InterviewStatus, { label: string; tone: "slate" | "green" | "amber" | "red" | "brand" | "blue" }> = {
  preparing: { label: "Preparing", tone: "blue" },
  ready: { label: "Ready to start", tone: "brand" },
  in_progress: { label: "In progress", tone: "amber" },
  evaluating: { label: "Evaluating", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  failed: { label: "Needs attention", tone: "red" },
};

export function StatusBadge({ status }: { status: InterviewStatus }) {
  const s = MAP[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
