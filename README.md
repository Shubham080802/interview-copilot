# Interview Copilot

AI mock interviews tailored to the company and role you're targeting — run as a proctored video interview, scored answer by answer, with a learning session afterwards. Every interview is stored and used to shape the next one.

## What it does

| Step | What happens |
|---|---|
| **1. Set up** | Import a job posting from its link (or pick the field, role, level and company yourself), add requirements and what you know about the company, and choose rounds: Technical, Coding, Behavioural, System Design, HR. Upload your resume (PDF) once to fill in your profile. |
| **2. Prepare** | Claude researches the company's current work on the web (products, launches, tech stack, interview style), reads your profile/resume and your **history from past interviews**, then designs the questions — avoiding repeats and deliberately probing past weak spots. |
| **3. Interview (video mode)** | An AI interviewer asks each question out loud. You answer by voice (live speech-to-text) or typing; coding questions open a code editor (JavaScript can be run in-browser). The interviewer asks follow-ups when an answer is vague or incomplete, and you can **ask clarifying questions** (scope, constraints, assumptions) — the interviewer answers without giving away the solution, and good clarifying questions count in your evaluation. |
| **4. Proctoring** | Runs in parallel: camera face tracking (out of frame, multiple people, looking away), tab switches, window focus loss, leaving full screen, pasting, extended displays. Flags include snapshots and produce an auditable integrity score. The session can be recorded. |
| **5. Evaluation** | Every answer gets a score, strengths, improvements, missed points, a model answer and a coaching tip. Rounds and the overall interview get scores, a hire recommendation, communication analysis (pace, filler words) and an action plan. |
| **6. Learning session** | Replay the recording, chat with an AI coach that has your full transcript, and **practice any question again** to get re-scored. |
| **7. Memory** | Your cumulative strengths, weaknesses, topics to revisit and recurring patterns are updated after each interview and fed into the next one. A 7-day study plan can be generated from them. |
| **8. Download** | Per interview: JSON, Markdown, HTML, PDF (print), and the video. Everything: one JSON export. |

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

A typical interview makes about 10–20 API calls (research, plan, one per answer for follow-ups, one per round plus one overall for evaluation).

## Data & privacy

Everything is stored locally in `data/` (git-ignored):

- `data/interviews.db` — SQLite: profile, interviews, answers, proctoring events, coach chats, insights
- `data/recordings/` — session videos (`.webm`)
- `data/snapshots/` — proctoring snapshots

Interview content is sent to the Anthropic API for generation and evaluation when AI mode is on. Deleting an interview removes its answers, recording and snapshots.

Proctoring signals are automated indicators, not proof of cheating — the report says so and links the evidence (snapshots, timeline, recording) for review.

**Network access:** `npm run dev` and `npm start` listen on `127.0.0.1` only. The app has no login, so anyone who can reach it can read your recordings and use your API key — don't expose it to a network (e.g. `-H 0.0.0.0`) without adding authentication first.

## Deployment

Interview Copilot is currently built to run **locally**. Hosting it (e.g. on Vercel) needs these changes first:

1. **Authentication** — there is no login, so a public URL would expose every recording and let anyone spend your API key.
2. **Hosted storage** — SQLite, recordings and snapshots are written to the local disk; serverless platforms don't keep files between requests. Use a hosted database (e.g. Postgres) and object storage (e.g. Vercel Blob or S3).
3. **Durable background jobs** — interview preparation and evaluation continue after the HTTP response; serverless functions are frozen at that point. Move them to a job queue or `after()`/`waitUntil` with a long enough function duration.

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
| 10 | Media & recording | Camera, speech recognition, interviewer voice, session recording | `src/lib/client/media.ts`, `api/.../recording` |
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
    interviews/[id]/report  report, practice, coach, integrity, recording
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
