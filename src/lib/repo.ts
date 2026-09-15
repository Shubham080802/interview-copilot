import "server-only";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db, fromJson, RECORDING_DIR, SNAPSHOT_DIR, toJson } from "./db";
import type { InterviewConfig } from "./schemas";
import type {
  CoachMessage,
  Interview,
  InterviewResponse,
  InterviewStatus,
  InterviewSummary,
  ProctorEvent,
  Profile,
  StoredInsights,
} from "./types";

const now = () => new Date().toISOString();
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
export const isValidId = (id: string) => ID_RE.test(id);

/* ----------------------------- profile ----------------------------- */

const DEFAULT_PROFILE: Profile = { name: "", headline: "", experienceYears: 0, resume: "", updatedAt: "" };

export function getProfile(): Profile {
  const row = db().prepare("SELECT data FROM profile WHERE id = 1").get();
  return { ...DEFAULT_PROFILE, ...(fromJson<Profile>(row?.data) ?? {}) };
}

export function saveProfile(p: Omit<Profile, "updatedAt">): Profile {
  const profile = { ...p, updatedAt: now() };
  db()
    .prepare("INSERT INTO profile (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(JSON.stringify(profile));
  return profile;
}

/* ---------------------------- interviews --------------------------- */

type Row = Record<string, unknown>;

function rowToInterview(r: Row): Interview {
  const id = r.id as string;
  return {
    id,
    createdAt: r.created_at as string,
    status: r.status as InterviewStatus,
    prepStage: (r.prep_stage as string) ?? "",
    error: (r.error as string) ?? null,
    config: fromJson(r.config)!,
    research: fromJson(r.research),
    plan: fromJson(r.plan),
    zoom: fromJson(r.zoom),
    startedAt: (r.started_at as string) ?? null,
    endedAt: (r.ended_at as string) ?? null,
    evaluation: fromJson(r.evaluation),
    integrity: fromJson(r.integrity),
    recordingSegments: listRecordingSegments(id),
    hasRecording: listRecordingSegments(id).length > 0,
    generatedBy: (r.generated_by as Interview["generatedBy"]) ?? null,
  };
}

export function createInterview(config: InterviewConfig): Interview {
  const id = nanoid(12);
  db()
    .prepare("INSERT INTO interviews (id, created_at, status, prep_stage, config) VALUES (?, ?, 'preparing', 'Queued', ?)")
    .run(id, now(), JSON.stringify(config));
  return getInterview(id)!;
}

export function getInterview(id: string): Interview | null {
  if (!isValidId(id)) return null;
  const row = db().prepare("SELECT * FROM interviews WHERE id = ?").get(id);
  return row ? rowToInterview(row) : null;
}

const COLUMN_MAP = {
  status: "status",
  prepStage: "prep_stage",
  error: "error",
  research: "research",
  plan: "plan",
  zoom: "zoom",
  startedAt: "started_at",
  endedAt: "ended_at",
  evaluation: "evaluation",
  integrity: "integrity",
  generatedBy: "generated_by",
} as const;
const JSON_FIELDS = new Set(["research", "plan", "zoom", "evaluation", "integrity"]);

export function updateInterview(
  id: string,
  patch: Partial<Pick<Interview, keyof typeof COLUMN_MAP>>,
): void {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const col = COLUMN_MAP[key as keyof typeof COLUMN_MAP];
    if (!col) continue;
    sets.push(`${col} = ?`);
    values.push(JSON_FIELDS.has(key) ? toJson(value) : ((value as string | null) ?? null));
  }
  if (!sets.length) return;
  db().prepare(`UPDATE interviews SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
}

export function listInterviews(): InterviewSummary[] {
  const rows = db().prepare("SELECT * FROM interviews ORDER BY created_at DESC").all();
  return rows.map((r) => {
    const i = rowToInterview(r);
    return {
      id: i.id,
      createdAt: i.createdAt,
      status: i.status,
      role: i.config.role,
      company: i.config.company,
      field: i.config.field,
      rounds: i.config.rounds,
      overallScore: i.evaluation?.overall.overall_score ?? null,
      recommendation: i.evaluation?.overall.hire_recommendation ?? null,
      integrityLevel: i.integrity?.level ?? null,
    };
  });
}

export function deleteInterview(id: string): void {
  if (!isValidId(id)) return;
  for (const e of listProctorEvents(id)) {
    if (e.snapshot) fs.rmSync(path.join(SNAPSHOT_DIR, e.snapshot), { force: true });
  }
  for (const segment of listRecordingSegments(id)) fs.rmSync(recordingPath(id, segment), { force: true });
  db().prepare("DELETE FROM interviews WHERE id = ?").run(id);
}

/* ---------------------------- responses ---------------------------- */

export function addResponse(r: Omit<InterviewResponse, "id" | "retries">): InterviewResponse {
  const response: InterviewResponse = { ...r, id: nanoid(12), retries: [] };
  const seqRow = db()
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM responses WHERE interview_id = ?")
    .get(r.interviewId);
  db()
    .prepare("INSERT INTO responses (id, interview_id, seq, data) VALUES (?, ?, ?, ?)")
    .run(response.id, r.interviewId, Number(seqRow?.next ?? 1), JSON.stringify(response));
  return response;
}

export function listResponses(interviewId: string): InterviewResponse[] {
  return db()
    .prepare("SELECT data FROM responses WHERE interview_id = ? ORDER BY seq")
    .all(interviewId)
    .map((row) => fromJson<InterviewResponse>(row.data)!);
}

export function getResponse(id: string): InterviewResponse | null {
  if (!isValidId(id)) return null;
  const row = db().prepare("SELECT data FROM responses WHERE id = ?").get(id);
  return fromJson<InterviewResponse>(row?.data);
}

export function saveResponse(r: InterviewResponse): void {
  db().prepare("UPDATE responses SET data = ? WHERE id = ?").run(JSON.stringify(r), r.id);
}

/* ------------------------- proctor events -------------------------- */

export function addProctorEvent(e: Omit<ProctorEvent, "id">): ProctorEvent {
  const event: ProctorEvent = { ...e, id: nanoid(12) };
  db()
    .prepare("INSERT INTO proctor_events (id, interview_id, at, data) VALUES (?, ?, ?, ?)")
    .run(event.id, e.interviewId, e.at, JSON.stringify(event));
  return event;
}

export function listProctorEvents(interviewId: string): ProctorEvent[] {
  return db()
    .prepare("SELECT data FROM proctor_events WHERE interview_id = ? ORDER BY at")
    .all(interviewId)
    .map((row) => fromJson<ProctorEvent>(row.data)!);
}

export function saveSnapshot(dataUrl: string): string | null {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const buf = Buffer.from(match[1], "base64");
  if (buf.length > 400_000) return null;
  const name = `${nanoid(16)}.jpg`;
  fs.writeFileSync(path.join(SNAPSHOT_DIR, name), buf);
  return name;
}

/* ---------------------------- recording ---------------------------- */

/** Recordings are stored in parts: a new part starts whenever the camera reconnects or the interview resumes. */
export function recordingPath(interviewId: string, segment = 1): string {
  return path.join(RECORDING_DIR, segment === 1 ? `${interviewId}.webm` : `${interviewId}.part${segment}.webm`);
}

export function listRecordingSegments(interviewId: string): number[] {
  if (!fs.existsSync(RECORDING_DIR)) return [];
  const escaped = interviewId.replace(/[-]/g, "\\-");
  const re = new RegExp(`^${escaped}(?:\\.part(\\d+))?\\.webm$`);
  return fs
    .readdirSync(RECORDING_DIR)
    .map((f) => re.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => (m[1] ? Number(m[1]) : 1))
    .sort((a, b) => a - b);
}

/* --------------------------- camera presence --------------------------- */

/** How recently the browser must have confirmed a live camera for answers to be accepted. */
export const CAMERA_HEARTBEAT_MAX_AGE_MS = 15_000;

export function setCameraPresence(interviewId: string, cameraOn: boolean): void {
  db()
    .prepare("UPDATE interviews SET last_camera_at = ? WHERE id = ?")
    .run(cameraOn ? new Date().toISOString() : null, interviewId);
}

export function isCameraLive(interviewId: string, now = Date.now()): boolean {
  const row = db().prepare("SELECT last_camera_at FROM interviews WHERE id = ?").get(interviewId);
  const at = typeof row?.last_camera_at === "string" ? Date.parse(row.last_camera_at) : NaN;
  return Number.isFinite(at) && now - at <= CAMERA_HEARTBEAT_MAX_AGE_MS;
}

/* ------------------------------ coach ------------------------------ */

export function listCoachMessages(interviewId: string): CoachMessage[] {
  return db()
    .prepare("SELECT id, role, content, created_at FROM coach_messages WHERE interview_id = ? ORDER BY created_at, rowid")
    .all(interviewId)
    .map((r) => ({
      id: r.id as string,
      role: r.role as CoachMessage["role"],
      content: r.content as string,
      createdAt: r.created_at as string,
    }));
}

export function addCoachMessage(interviewId: string, role: CoachMessage["role"], content: string): void {
  db()
    .prepare("INSERT INTO coach_messages (id, interview_id, created_at, role, content) VALUES (?, ?, ?, ?, ?)")
    .run(nanoid(12), interviewId, now(), role, content);
}

export function clearCoachMessages(interviewId: string): void {
  db().prepare("DELETE FROM coach_messages WHERE interview_id = ?").run(interviewId);
}

/* ----------------------------- insights ---------------------------- */

const EMPTY_INSIGHTS: StoredInsights = {
  strengths: [],
  weaknesses: [],
  topics_mastered: [],
  topics_to_revisit: [],
  recurring_patterns: [],
  sessionCount: 0,
  nextFocus: [],
  updatedAt: "",
  studyPlan: null,
};

export function getInsights(): StoredInsights {
  const row = db().prepare("SELECT data FROM insights WHERE id = 1").get();
  return { ...EMPTY_INSIGHTS, ...(fromJson<StoredInsights>(row?.data) ?? {}) };
}

export function saveInsights(insights: StoredInsights): void {
  db()
    .prepare("INSERT INTO insights (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(JSON.stringify({ ...insights, updatedAt: now() }));
}

/** Questions asked in previous interviews — used to avoid repeats and to track progress. */
export function pastQuestionHistory(excludeInterviewId?: string, limit = 60) {
  const rows = db()
    .prepare(
      `SELECT r.data AS data, i.config AS config, i.evaluation AS evaluation
       FROM responses r JOIN interviews i ON i.id = r.interview_id
       WHERE i.status = 'completed' AND i.id != ?
       ORDER BY i.created_at DESC, r.seq LIMIT ?`,
    )
    .all(excludeInterviewId ?? "", limit);
  return rows.map((row) => {
    const resp = fromJson<InterviewResponse>(row.data)!;
    const evaluation = fromJson<Interview["evaluation"]>(row.evaluation);
    const qe = evaluation?.rounds.flatMap((r) => r.question_evaluations).find((q) => q.response_id === resp.id);
    return {
      prompt: resp.prompt,
      round: resp.roundType,
      company: fromJson<InterviewConfig>(row.config)?.company ?? "",
      score: qe?.score ?? null,
      verdict: qe?.verdict ?? null,
    };
  });
}
