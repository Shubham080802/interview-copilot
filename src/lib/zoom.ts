import "server-only";
import type { ZoomMeeting } from "./types";

export function zoomConfigured(): boolean {
  return Boolean(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}

/** Creates a Zoom meeting through a Server-to-Server OAuth app. */
export async function createZoomMeeting(topic: string, startTime?: string): Promise<ZoomMeeting> {
  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) throw new Error("Zoom credentials are not configured");

  const tokenRes = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64")}` },
    },
  );
  if (!tokenRes.ok) throw new Error(`Zoom auth failed (${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const meetingRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: topic.slice(0, 190),
      type: startTime ? 2 : 1,
      start_time: startTime || undefined,
      duration: 60,
      settings: { join_before_host: true, waiting_room: false, auto_recording: "none" },
    }),
  });
  if (!meetingRes.ok) throw new Error(`Zoom meeting creation failed (${meetingRes.status})`);
  const m = (await meetingRes.json()) as { id: number; join_url: string; start_url: string; password?: string };
  return { joinUrl: m.join_url, startUrl: m.start_url, meetingId: String(m.id), password: m.password, source: "api" };
}
