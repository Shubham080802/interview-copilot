import "server-only";
import { nanoid } from "nanoid";
import type { InterviewConfig } from "./schemas";
import { storage } from "./storage";
import { fromJson, toJson, type Row } from "./storage/sql";
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

const sql = async () => (await storage()).sql;
const files = async () => (await storage()).files;

/* ----------------------------- profile ----------------------------- */

const DEFAULT_PROFILE: Profile = { name: "", headline: "", experienceYears: 0, resume: "", updatedAt: "" };

export async function getProfile(): Promise<Profile> {
  const row = await (await sql()).get("SELECT data FROM profile WHERE id = 1");
  return { ...DEFAULT_PROFILE, ...(fromJson<Profile>(row?.data) ?? {}) };
}

export async function saveProfile(p: Omit<Profile, "updatedAt">): Promise<Profile> {
  const profile = { ...p, updatedAt: now() };
  await (await sql()).run("INSERT INTO profile (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", [JSON.stringify(profile)]);
  return profile;
}

/* ---------------------------- interviews --------------------------- */

function rowToInterview(r: Row, recordingSegments: number[]): Interview {
  return {
    id: r.id as string,
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
    recordingSegments,
    hasRecording: recordingSegments.length > 0,
    generatedBy: (r.generated_by as Interview["generatedBy"]) ?? null,
  };
}

export async function createInterview(config: InterviewConfig): Promise<Interview> {
  const id = nanoid(12);
  const at = now();
  await (await sql()).run(
    "INSERT INTO interviews (id, created_at, updated_at, status, prep_stage, config) VALUES (?, ?, ?, 'preparing', 'Queued', ?)",
    [id, at, at, JSON.stringify(config)],
  );
  return (await getInterview(id))!;
}

export async function getInterview(id: string): Promise<Interview | null> {
  if (!isValidId(id)) return null;
  const row = await (await sql()).get("SELECT * FROM interviews WHERE id = ?", [id]);
  if (!row) return null;
  return rowToInterview(row, await (await files()).listRecordingSegments(id));
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

export async function updateInterview(id: string, patch: Partial<Pick<Interview, keyof typeof COLUMN_MAP>>): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const values: (string | null)[] = [now()];
  for (const [key, value] of Object.entries(patch)) {
    const col = COLUMN_MAP[key as keyof typeof COLUMN_MAP];
    if (!col) continue;
    sets.push(`${col} = ?`);
    values.push(JSON_FIELDS.has(key) ? toJson(value) : ((value as string | null) ?? null));
  }
  await (await sql()).run(`UPDATE interviews SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
}

export async function listInterviews(): Promise<InterviewSummary[]> {
  const rows = await (await sql()).all("SELECT * FROM interviews ORDER BY created_at DESC");
  return rows.map((r) => {
    const i = rowToInterview(r, []);
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
      terminated: Boolean(i.integrity?.terminatedReason),
    };
  });
}

export async function deleteInterview(id: string): Promise<void> {
  if (!isValidId(id)) return;
  const store = await files();
  for (const e of await listProctorEvents(id)) {
    if (e.snapshot) await store.deleteSnapshot(e.snapshot);
  }
  await store.deleteRecordings(id);
  const db = await sql();
  // Explicit child deletes: SQLite only cascades with foreign keys enabled on the connection.
  for (const table of ["responses", "proctor_events", "coach_messages"]) await db.run(`DELETE FROM ${table} WHERE interview_id = ?`, [id]);
  await db.run("DELETE FROM interviews WHERE id = ?", [id]);
}

/* ---------------------------- responses ---------------------------- */

export async function addResponse(r: Omit<InterviewResponse, "id" | "retries">): Promise<InterviewResponse> {
  const response: InterviewResponse = { ...r, id: nanoid(12), retries: [] };
  await (await sql()).run(
    `INSERT INTO responses (id, interview_id, seq, data)
     SELECT CAST(? AS TEXT), CAST(? AS TEXT), COALESCE(MAX(seq), 0) + 1, CAST(? AS TEXT) FROM responses WHERE interview_id = ?`,
    [response.id, r.interviewId, JSON.stringify(response), r.interviewId],
  );
  return response;
}

export async function listResponses(interviewId: string): Promise<InterviewResponse[]> {
  const rows = await (await sql()).all("SELECT data FROM responses WHERE interview_id = ? ORDER BY seq", [interviewId]);
  return rows.map((row) => fromJson<InterviewResponse>(row.data)!);
}

export async function getResponse(id: string): Promise<InterviewResponse | null> {
  if (!isValidId(id)) return null;
  const row = await (await sql()).get("SELECT data FROM responses WHERE id = ?", [id]);
  return fromJson<InterviewResponse>(row?.data);
}

export async function saveResponse(r: InterviewResponse): Promise<void> {
  await (await sql()).run("UPDATE responses SET data = ? WHERE id = ?", [JSON.stringify(r), r.id]);
}

/* ------------------------- proctor events -------------------------- */

export async function addProctorEvent(e: Omit<ProctorEvent, "id">): Promise<ProctorEvent> {
  const event: ProctorEvent = { ...e, id: nanoid(12) };
  await (await sql()).run("INSERT INTO proctor_events (id, interview_id, at, data) VALUES (?, ?, ?, ?)", [event.id, e.interviewId, e.at, JSON.stringify(event)]);
  return event;
}

export async function listProctorEvents(interviewId: string): Promise<ProctorEvent[]> {
  const rows = await (await sql()).all("SELECT data FROM proctor_events WHERE interview_id = ? ORDER BY at", [interviewId]);
  return rows.map((row) => fromJson<ProctorEvent>(row.data)!);
}

/** The "terminated" event, if the interview was ended automatically (e.g. another voice after a warning). */
export async function getTermination(interviewId: string): Promise<ProctorEvent | null> {
  const row = await (await sql()).get(
    "SELECT data FROM proctor_events WHERE interview_id = ? AND data LIKE ? ORDER BY at LIMIT 1",
    [interviewId, '%"type":"terminated"%'],
  );
  return fromJson<ProctorEvent>(row?.data);
}

export const SNAPSHOT_NAME_RE = /^[A-Za-z0-9_-]{16}\.jpg$/;

export async function saveSnapshot(dataUrl: string): Promise<string | null> {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const buf = Buffer.from(match[1], "base64");
  if (buf.length > 400_000) return null;
  const name = `${nanoid(16)}.jpg`;
  await (await files()).putSnapshot(name, buf);
  return name;
}

export async function getSnapshot(name: string): Promise<Uint8Array | null> {
  if (!SNAPSHOT_NAME_RE.test(name)) return null;
  return (await files()).getSnapshot(name);
}

/* ---------------------------- recording ---------------------------- */

/** Recordings are stored in parts: a new part starts whenever the camera reconnects or the interview resumes. */
export async function appendRecordingChunk(interviewId: string, segment: number, seq: number, data: Uint8Array) {
  await (await files()).appendRecordingChunk(interviewId, segment, seq, data);
}

export async function openRecording(interviewId: string, segment: number) {
  return (await files()).openRecording(interviewId, segment);
}

/* --------------------------- camera presence --------------------------- */

/** How recently the browser must have confirmed a live camera for answers to be accepted. */
export const CAMERA_HEARTBEAT_MAX_AGE_MS = 15_000;

export async function setCameraPresence(interviewId: string, cameraOn: boolean): Promise<void> {
  await (await sql()).run("UPDATE interviews SET last_camera_at = ? WHERE id = ?", [cameraOn ? now() : null, interviewId]);
}

export async function isCameraLive(interviewId: string, at = Date.now()): Promise<boolean> {
  const row = await (await sql()).get("SELECT last_camera_at FROM interviews WHERE id = ?", [interviewId]);
  const last = typeof row?.last_camera_at === "string" ? Date.parse(row.last_camera_at) : NaN;
  return Number.isFinite(last) && at - last <= CAMERA_HEARTBEAT_MAX_AGE_MS;
}

/* ------------------------------ coach ------------------------------ */

export async function listCoachMessages(interviewId: string): Promise<CoachMessage[]> {
  const rows = await (await sql()).all(
    "SELECT id, role, content, created_at FROM coach_messages WHERE interview_id = ? ORDER BY seq, created_at",
    [interviewId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    role: r.role as CoachMessage["role"],
    content: r.content as string,
    createdAt: r.created_at as string,
  }));
}

export async function addCoachMessage(interviewId: string, role: CoachMessage["role"], content: string): Promise<void> {
  await (await sql()).run(
    `INSERT INTO coach_messages (id, interview_id, created_at, role, content, seq)
     SELECT CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), COALESCE(MAX(seq), 0) + 1
     FROM coach_messages WHERE interview_id = ?`,
    [nanoid(12), interviewId, now(), role, content, interviewId],
  );
}

export async function clearCoachMessages(interviewId: string): Promise<void> {
  await (await sql()).run("DELETE FROM coach_messages WHERE interview_id = ?", [interviewId]);
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

export async function getInsights(): Promise<StoredInsights> {
  const row = await (await sql()).get("SELECT data FROM insights WHERE id = 1");
  return { ...EMPTY_INSIGHTS, ...(fromJson<StoredInsights>(row?.data) ?? {}) };
}

export async function saveInsights(insights: StoredInsights): Promise<void> {
  await (await sql()).run("INSERT INTO insights (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", [
    JSON.stringify({ ...insights, updatedAt: now() }),
  ]);
}

/** Questions asked in previous interviews — used to avoid repeats and to track progress. */
export async function pastQuestionHistory(excludeInterviewId?: string, limit = 60) {
  const rows = await (await sql()).all(
    `SELECT r.data AS data, i.config AS config, i.evaluation AS evaluation
     FROM responses r JOIN interviews i ON i.id = r.interview_id
     WHERE i.status = 'completed' AND i.id <> ?
     ORDER BY i.created_at DESC, r.seq LIMIT ?`,
    [excludeInterviewId ?? "", limit],
  );
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
