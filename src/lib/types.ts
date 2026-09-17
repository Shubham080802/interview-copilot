import type {
  CandidateInsights,
  InterviewConfig,
  InterviewPlan,
  OverallEvaluation,
  RetryEvaluation,
  RoundEvaluation,
  RoundType,
  StudyPlan,
} from "./schemas";

export type InterviewStatus =
  | "preparing"
  | "ready"
  | "in_progress"
  | "evaluating"
  | "completed"
  | "cancelled" // ended for cheating: not evaluated
  | "failed";

export interface ResearchBrief {
  summary: string; // markdown
  sources: { title: string; url: string }[];
}

export interface ZoomMeeting {
  joinUrl: string;
  startUrl?: string;
  meetingId?: string;
  password?: string;
  source: "api" | "manual";
}

export interface Profile {
  name: string;
  headline: string;
  experienceYears: number;
  resume: string;
  updatedAt: string;
}

export interface InterviewResponse {
  id: string;
  interviewId: string;
  questionId: string;
  roundType: RoundType;
  prompt: string;
  isFollowUp: boolean;
  parentResponseId: string | null;
  answerText: string;
  code: string;
  codeLanguage: string;
  skipped: boolean;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  wordsPerMinute: number;
  fillerCount: number;
  retries: RetryAttempt[];
  /** Clarifying questions the candidate asked before answering (absent on older records). */
  clarifications?: Clarification[];
}

export interface Clarification {
  at: string;
  question: string;
  reply: string;
  gaveHint: boolean;
}

export interface RetryAttempt {
  at: string;
  answerText: string;
  code: string;
  result: RetryEvaluation;
}

export type ProctorEventType =
  | "no_face"
  | "multiple_faces"
  | "looking_away"
  | "tab_hidden"
  | "window_blur"
  | "fullscreen_exit"
  | "paste"
  | "copy"
  | "multiple_screens"
  | "camera_off"
  | "other_voice"
  | "terminated"
  | "assistance"
  | "note";

export interface ProctorEvent {
  id: string;
  interviewId: string;
  at: string;
  type: ProctorEventType;
  severity: "low" | "medium" | "high";
  detail: string;
  durationSec: number;
  snapshot: string | null; // file name under data/snapshots
}

export interface IntegrityReport {
  score: number;
  level: "clean" | "minor_flags" | "suspicious" | "high_risk";
  counts: Partial<Record<ProctorEventType, number>>;
  awaySeconds: number;
  notes: string[];
  /** Set when the interview was ended automatically (absent on older reports). */
  terminatedReason?: string | null;
  /** True when another person was determined to be helping the candidate (absent on older reports). */
  cheatingDetermined?: boolean;
}

export interface Evaluation {
  rounds: RoundEvaluation[];
  overall: OverallEvaluation;
  generatedBy: "ai" | "demo";
  generatedAt: string;
}

export interface Interview {
  id: string;
  createdAt: string;
  status: InterviewStatus;
  prepStage: string;
  error: string | null;
  config: InterviewConfig;
  research: ResearchBrief | null;
  plan: InterviewPlan | null;
  zoom: ZoomMeeting | null;
  startedAt: string | null;
  endedAt: string | null;
  evaluation: Evaluation | null;
  integrity: IntegrityReport | null;
  hasRecording: boolean;
  recordingSegments: number[];
  generatedBy: "ai" | "demo" | null;
}

export interface InterviewSummary {
  id: string;
  createdAt: string;
  status: InterviewStatus;
  role: string;
  company: string;
  field: string;
  rounds: RoundType[];
  overallScore: number | null;
  recommendation: string | null;
  integrityLevel: IntegrityReport["level"] | null;
  /** True when the interview was ended automatically (e.g. another voice after a warning). */
  terminated: boolean;
}

export interface StoredInsights extends CandidateInsights {
  sessionCount: number;
  nextFocus: string[];
  updatedAt: string;
  studyPlan: StudyPlan | null;
}

export interface CoachMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AppStatus {
  aiMode: "ai" | "demo";
  model: string;
  zoomConfigured: boolean;
}
