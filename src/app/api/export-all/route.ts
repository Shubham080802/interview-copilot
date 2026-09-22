import { currentUserId } from "@/lib/current-user";
import { getInsights, getInterview, getProfile, listCoachMessages, listInterviews, listProctorEvents, listResponses } from "@/lib/repo";

/** Full data export: profile, cumulative insights and every interview. */
export async function GET() {
  const userId = await currentUserId();
  const interviews = [];
  for (const s of await listInterviews(userId)) {
    interviews.push({
      interview: await getInterview(s.id, userId),
      responses: await listResponses(s.id),
      proctorEvents: await listProctorEvents(s.id),
      coachSession: await listCoachMessages(s.id),
    });
  }
  const body = JSON.stringify(
    { exportedAt: new Date().toISOString(), profile: await getProfile(userId), insights: await getInsights(userId), interviews },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="interview-copilot-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
