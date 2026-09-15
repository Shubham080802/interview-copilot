import type { IntegrityReport, ProctorEvent, ProctorEventType } from "./types";

const WEIGHTS: Record<ProctorEventType, number> = {
  multiple_faces: 12,
  no_face: 6,
  looking_away: 3,
  tab_hidden: 8,
  window_blur: 3,
  fullscreen_exit: 4,
  paste: 8,
  copy: 2,
  multiple_screens: 6,
  camera_off: 10,
  note: 0,
};

export const EVENT_LABELS: Record<ProctorEventType, string> = {
  multiple_faces: "Multiple people in frame",
  no_face: "Candidate not visible",
  looking_away: "Looking away from screen",
  tab_hidden: "Switched tab / minimised",
  window_blur: "Left the interview window",
  fullscreen_exit: "Exited full screen",
  paste: "Pasted text",
  copy: "Copied text",
  multiple_screens: "Extended display detected",
  camera_off: "Camera off / blocked",
  note: "Note",
};

/** Deterministic integrity score from proctoring events (no AI involved, so it is auditable). */
export function computeIntegrity(events: ProctorEvent[]): IntegrityReport {
  const counts: IntegrityReport["counts"] = {};
  let penalty = 0;
  let awaySeconds = 0;
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    const sev = e.severity === "high" ? 1.5 : e.severity === "low" ? 0.5 : 1;
    // Long absences cost more than blips.
    const durationFactor = 1 + Math.min(e.durationSec, 120) / 30;
    penalty += WEIGHTS[e.type] * sev * durationFactor;
    if (["no_face", "looking_away", "tab_hidden", "window_blur", "camera_off"].includes(e.type)) awaySeconds += e.durationSec;
  }
  const score = Math.max(0, Math.round(100 - penalty));
  const level: IntegrityReport["level"] =
    score >= 90 ? "clean" : score >= 70 ? "minor_flags" : score >= 45 ? "suspicious" : "high_risk";

  const notes: string[] = [];
  const cameraOffSeconds = events.filter((e) => e.type === "camera_off").reduce((s, e) => s + e.durationSec, 0);
  if (counts.camera_off) notes.push(`The camera was off ${counts.camera_off} time(s), about ${Math.round(cameraOffSeconds)}s in total; the interview was paused meanwhile.`);
  if (counts.multiple_faces) notes.push(`Another person appeared on camera ${counts.multiple_faces} time(s).`);
  if (counts.tab_hidden) notes.push(`The interview tab was hidden ${counts.tab_hidden} time(s).`);
  if (counts.paste) notes.push(`Text was pasted into an answer ${counts.paste} time(s).`);
  if (awaySeconds > 30) notes.push(`About ${Math.round(awaySeconds)}s spent away from the screen or out of frame.`);
  if (!events.length) notes.push("No integrity flags were raised during this session.");
  return { score, level, counts, awaySeconds: Math.round(awaySeconds), notes };
}
