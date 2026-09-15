import { getInsights, getInterview, getProfile, listCoachMessages, listInterviews, listProctorEvents, listResponses } from "@/lib/repo";

/** Full data export: profile, cumulative insights and every interview. */
export async function GET() {
  const interviews = listInterviews().map((s) => ({
    interview: getInterview(s.id),
    responses: listResponses(s.id),
    proctorEvents: listProctorEvents(s.id),
    coachSession: listCoachMessages(s.id),
  }));
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), profile: getProfile(), insights: getInsights(), interviews }, null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="interview-copilot-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
