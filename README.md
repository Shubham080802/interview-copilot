# Interview Copilot

AI mock interviews tailored to the company and role you're targeting — run as a proctored video interview, scored answer by answer, with a learning session afterwards. Every interview is stored and used to shape the next one.

## What it does

| Step | What happens |
|---|---|
| **1. Set up** | Import a job posting from its link (or pick the field, role, level and company yourself), add requirements and what you know about the company, and choose rounds: Technical, Coding, Behavioural, System Design, HR. Upload your resume (PDF) once to fill in your profile. |
| **2. Prepare** | Claude researches the company's current work on the web (products, launches, tech stack, interview style), reads your profile/resume and your **history from past interviews**, then designs the questions — avoiding repeats and deliberately probing past weak spots. |
| **3. Interview (video mode)** | An AI interviewer asks each question out loud. You answer by voice (live speech-to-text) or typing; coding questions open a code editor (JavaScript can be run in-browser). The interviewer asks follow-ups when an answer is vague or incomplete, and you can **ask clarifying questions** (scope, constraints, assumptions) — the interviewer answers without giving away the solution, and good clarifying questions count in your evaluation. |
| **Camera on, always** | Every interview runs on camera. If the camera turns off, is taken by another app, or is covered (black image), the interview **pauses**: the question is hidden, the timer stops, and the server refuses answers until the camera is back. Each gap is logged in the integrity report. |
| **Only you (voice monitored)** | Before starting, you record a short voice check. During the interview, speech on your microphone is compared with your voice: if **another person's voice is heard nearby**, a warning appears with a 2-minute countdown; if another voice is heard again within those 2 minutes (after a 10-second reaction window), **the interview ends automatically**. Detections are logged with snapshots and their time in the conversation audio, and the API refuses to continue a terminated interview. |
| **Cheating determined** | Speech recognized while another voice is heard is checked against the current question. If that person is clearly **helping** (giving answers, hints, code or telling you what to say), the interview is **cancelled immediately** with "Cheating determined. Good Bye": it isn't scored, doesn't update your profile, and the words heard are kept as evidence. |
| **Conversation recording (audio only)** | The recording contains only the spoken conversation — your microphone and the interviewer's voice mixed into one audio track. **No video of you is recorded.** The interviewer speaks with a natural, human-sounding voice (Kokoro, generated in your browser — pick one of four voices when setting up), because browser speech synthesis can't be captured by web pages. Upcoming lines are prepared while you answer, so the interviewer replies without robotic delays. If that voice can't load, the browser voice is used and only your side is recorded. |
| **4. Proctoring** | Runs in parallel: camera face tracking (out of frame, multiple people, looking away), tab switches, window focus loss, leaving full screen, pasting, extended displays. Flags include snapshots and produce an auditable integrity score. The session can be recorded. |
| **5. Evaluation** | Every answer gets a score, strengths, improvements, missed points, a model answer and a coaching tip. Rounds and the overall interview get scores, a hire recommendation, communication analysis (pace, filler words) and an action plan. |
| **6. Learning session** | Replay the conversation audio, chat with an AI coach that has your full transcript, and **practice any question again** to get re-scored. |
| **7. Memory** | Your cumulative strengths, weaknesses, topics to revisit and recurring patterns are updated after each interview and fed into the next one. A 7-day study plan can be generated from them. |
| **8. Download** | Per interview: JSON, Markdown, HTML, PDF (print), and the conversation audio. Everything: one JSON export. |

## Quick start

Requirements: **Node.js 22.13+** (uses the built-in `node:sqlite`) and **Chrome or Edge** (for voice answers and recording).

```bash
npm install
```

```bash
cp .env.example .env.local
```

Add your Anthropic API key to `.env.local` (`ANTHROPIC_API_KEY=...`), then:

```bash
npm run dev
```

Open http://localhost:3000.

Without an API key the app runs in **Demo mode**: questions come from a built-in bank and answers are scored with simple heuristics, so you can try the whole flow offline. Add a key and restart to switch to AI mode.

### Zoom (optional)

The AI interviewer, voice and proctoring run in the app's own video room (a bot can't take part in a Zoom call without Zoom's separate meeting-bot APIs). Zoom is for when a human — a friend, mentor or panelist — should join the session:

- **Use my Zoom link**: paste any meeting link when setting up the interview.
- **Create automatically**: create a *Server-to-Server OAuth* app at [marketplace.zoom.us](https://marketplace.zoom.us) with the `meeting:write:meeting` scope and set `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` in `.env.local`. Each interview gets its own meeting.

Keep the in-app room open during the Zoom call so proctoring and recording keep running.

## How the AI is used

All calls go through the Anthropic SDK with `claude-opus-5` (override with `ANTHROPIC_MODEL`), adaptive thinking, structured outputs validated with Zod, and server-side refusal fallbacks.

| Task | File | Notes |
|---|---|---|
| Company research | `src/lib/ai/engine.ts` → `researchCompany` | Web search tool, max 6 searches |
| Question plan | `generatePlan` | Uses setup, profile, research, stored insights and previously asked questions |
| Live follow-ups | `decideFollowUp` | Low effort for low latency |
| Clarifying questions | `answerClarification` | Answers scope/constraint questions, flags when a hint was given |
| Resume import | `extractResume` | Claude reads the PDF directly; without AI, text is extracted locally |
| Job posting import | `structureJobPosting`, `fetchPageWithClaude` | Pages are fetched server-side (public addresses only, schema.org JobPosting preferred); Claude's web fetch is the fallback for blocked or JavaScript-heavy sites |
| Evaluation | `evaluateRound` (parallel per round) + `evaluateOverall` | Overall step also rewrites your long-term profile |
| Practice re-scoring | `evaluateRetry` | |
| Coach chat | `streamCoachReply` | Streaming; interview context is prompt-cached |
| Study plan | `generateStudyPlan` | |
| Help detection | `checkForAssistance` | Judges speech from another voice nearby; only high confidence cancels |

A typical interview makes about 10–20 API calls (research, plan, one per answer for follow-ups, one per round plus one overall for evaluation).

## Data & privacy

Everything is stored locally in `data/` (git-ignored):

- `data/interviews.db` — SQLite: profile, interviews, answers, proctoring events, coach chats, insights
- `data/recordings/` — conversation audio (`.webm`, Opus; no video)
- `data/snapshots/` — proctoring snapshots

Interview content is sent to the Anthropic API for generation and evaluation when AI mode is on. The interviewer's voice is generated entirely in your browser; its ~90 MB voice model is downloaded once from Hugging Face and cached (no interview content is sent there). The app is served cross-origin isolated (COOP/COEP headers) so the voice models can use all CPU cores; speech is generated in a background worker so the room stays responsive. Deleting an interview removes its answers, recording and snapshots.

**Voice monitoring** runs entirely in the browser: the voice sample, speaker profile and microphone audio used for detection never leave the device. Speech is found with Silero VAD (so music and noise are ignored), and each 2-second speech window is compared with the enrolled voice using a WeSpeaker ResNet34 speaker embedding (cosine similarity below 0.45 = a different speaker; in offline calibration with 12 voices, same-speaker windows never scored below 0.64). A microphone can't measure distance, so "nearby" (≈10 m) is approximated by loudness: voices more than 26 dB quieter than yours are ignored. Two mismatching windows within 15 s count as one detection. Known limits: voices that overlap exactly with yours are harder to detect, very similar voices can be missed, and detection pauses while the interviewer is speaking.

**Help from others** is judged only on speech heard *while another voice was detected*: browser speech recognition keeps running during the interview, its results are paired with those moments (allowing for recognition delay), and text that merely echoes the interviewer's own voice is filtered out. The server decides — with Claude in AI mode, or a conservative keyword check (strong overlap with the question plus cues like "tell them…") without an API key. Only a high-confidence "related and helping" verdict cancels; weaker signals are stored as evidence. Unrelated conversation, TV or encouragement doesn't count. Limits: browser speech recognition is needed (Chrome/Edge; Chrome uses Google's online service), recognition errors or quiet whispers may be missed, and speech overlapping with the candidate's is harder to separate.

**Camera enforcement** is checked in two places: the interview room watches the video track and picture (ended, muted, or near-black frames for 3s), and sends a heartbeat every 5 seconds. The API rejects starting, answering and clarifying questions unless a camera-on heartbeat arrived within the last 15 seconds.

Proctoring signals are automated indicators, not proof of cheating — the report says so and links the evidence (snapshots, timeline, recording) for review.

**Network access:** `npm run dev` and `npm start` listen on `127.0.0.1` only. The app has no login, so anyone who can reach it can read your recordings and use your API key — don't expose it to a network (e.g. `-H 0.0.0.0`) without adding authentication first.

## Third-party models

| Model | Used for | License |
|---|---|---|
| [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | Face tracking (proctoring) | Apache 2.0 |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), ONNX export by [onnx-community](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX); text processing adapted from [kokoro-js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), phonemes via [phonemizer](https://github.com/xenova/phonemizer) (eSpeak NG) | Interviewer voice | Apache 2.0 (phonemizer package: Apache 2.0; the eSpeak NG engine it bundles is GPL-3.0) |
| [WeSpeaker ResNet34 (pyannote/wespeaker-voxceleb-resnet34-LM)](https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM), ONNX export by [onnx-community](https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM) | Telling your voice apart from others | CC BY 4.0 |
| [Silero VAD](https://github.com/snakers4/silero-vad) | Detecting speech | MIT |

## Deployment (Vercel)

The app runs locally with SQLite and files on disk, and on Vercel with hosted storage — the switch is automatic:

| Setting | Local | Vercel |
|---|---|---|
| Database | `data/interviews.db` (SQLite) | Neon Postgres via `DATABASE_URL` (Vercel Marketplace) |
| Recordings & snapshots | `data/recordings`, `data/snapshots` | Private Vercel Blob store via `BLOB_READ_WRITE_TOKEN` |
| Background preparation / evaluation | In-process | Kept alive with `after()`, routes allow 300s |

To deploy your own copy:

1. `vercel link`, then create a private Blob store (`vercel blob create-store <name> --access private`) and add Neon (`vercel integration add neon`), both connected to Production and Preview.
2. Deploy (`vercel deploy --prod`, or push to the connected Git repository).
3. **Protect it.** The app has no login of its own. Set Vercel Authentication to cover *all* deployments including production domains (Project → Settings → Deployment Protection, or `PATCH /v9/projects/<id>` with `{"ssoProtection":{"deploymentType":"all"}}`). The default setting leaves the production `*.vercel.app` domain public.
4. Optional: add `ANTHROPIC_API_KEY` (and Zoom variables) in the project's environment variables and redeploy to enable AI mode.

## Modules

The codebase is organised into modules, and the git history adds them one commit at a time in dependency order:

| # | Module | Responsibility | Paths |
|---|---|---|---|
| 1 | Scaffolding | Next.js + TypeScript + Tailwind setup, proctoring model installer | `package.json`, `tsconfig.json`, `next.config.ts`, `scripts/` |
| 2 | Core domain | Interview config, AI output schemas, shared types, speech metrics | `src/lib/schemas.ts`, `types.ts`, `speech-metrics.ts` |
| 3 | Storage | SQLite database and repository functions | `src/lib/db.ts`, `repo.ts`, `api.ts` |
| 4 | AI engine | Claude calls: research, planning, follow-ups, evaluation, coaching | `src/lib/ai/` |
| 5 | Demo engine | Offline question bank and heuristic scoring | `src/lib/demo.ts` |
| 6 | Zoom integration | Meeting creation via Server-to-Server OAuth | `src/lib/zoom.ts` |
| 7 | Proctoring | Face tracking, browser integrity signals, integrity score, snapshots | `src/lib/client/proctoring.ts`, `src/lib/integrity.ts`, `api/.../proctor`, `api/snapshots` |
| 8 | Export | Markdown / HTML report generation | `src/lib/export.ts` |
| 9 | Interview service & API | Orchestration and REST endpoints | `src/lib/service.ts`, `src/app/api/` |
| 10b | Voice monitoring | Speaker features, warn/terminate policy, in-browser enrollment and monitoring | `src/lib/voice-id/`, `src/lib/client/voice-monitor.ts`, `public/worklets/pcm-capture.js` |
| 10 | Media & recording | Camera, speech recognition, interviewer natural voice (Kokoro worker) + audio mixer, audio-only conversation recording | `src/lib/client/media.ts`, `src/lib/client/interviewer-voice.ts`, `src/lib/voice/`, `api/.../recording` |
| 11 | UI foundation | Layout, design system, data hooks | `src/app/layout.tsx`, `globals.css`, `src/components/`, `src/lib/client/api.ts`, `useInterview.ts` |
| 12 | Dashboard & setup | Dashboard, profile, interview setup and overview | `src/app/page.tsx`, `profile/`, `interviews/new/`, `interviews/[id]/` |
| 13 | Interview room | Live video interview UI and code editor | `src/app/interviews/[id]/room/`, `src/components/CodeEditor.tsx` |
| 14 | Report & learning session | Scores, feedback, practice retries, coach, integrity, replay | `src/app/interviews/[id]/report/` |
| 15 | Progress | Cross-interview insights and study plan | `src/app/progress/` |
| 16 | Imports | Safe URL fetching, job posting parsing, resume PDF text extraction | `src/lib/importers.ts`, `api/import/job`, `api/profile/resume` |

## Project layout

```
src/
  app/                      Next.js pages + API routes
    interviews/new          setup form
    interviews/[id]         overview (preparing / ready / evaluating)
    interviews/[id]/room    video interview room
    interviews/[id]/report  report, practice, coach, integrity, conversation audio
    progress                cross-interview progress + study plan
    api/                    REST endpoints (see route.ts files)
  lib/
    ai/                     Claude calls and prompts
    demo.ts                 offline question bank + heuristic scoring
    service.ts              orchestration (prepare, answer, evaluate, retry)
    repo.ts, db.ts          SQLite storage
    integrity.ts            proctoring score
    export.ts               Markdown / HTML export
    client/                 browser hooks: camera, speech, TTS, recording, proctoring
scripts/fetch-models.mjs    copies the MediaPipe face-tracking model into public/ on install
```

## Development

- `npm test` — unit and lifecycle tests (Vitest; demo mode with a throwaway data directory, no API calls)
- `npm run typecheck` — TypeScript check
- CI (`.github/workflows/ci.yml`) runs type check, tests and a production build on every push and pull request
- `http://localhost:3000/interviews/<id>/room?fakeCamera=1` — synthetic camera for testing the room without hardware (development builds only)
- Set `DEMO_MODE=1` to force demo mode even with a key configured
- Set `DATA_DIR` to store data somewhere other than `./data`

## License

[MIT](LICENSE) © 2026 Shubham Kumar
