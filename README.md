# Interview Copilot

> An AI mock-interview workspace for deliberate practice, feedback, and measurable improvement across interviews.

**[Open the deployed app →](https://interview-copilot-sepia.vercel.app)** _(deployment access is currently protected)_

## Inspiration

Most interview practice is hard to personalize and even harder to carry forward. Interview Copilot was built to turn a target role, job posting, resume, and prior interview history into a focused practice loop that helps candidates identify weak areas and return better prepared.

## What it does

- Imports a resume and job posting, researches the target company, and generates tailored technical, coding, behavioral, system-design, and HR interview plans.
- Runs video or text-based interviews with voice input, follow-up questions, browser-based JavaScript coding, and answer-by-answer feedback.
- Stores interview history to surface recurring strengths, weaknesses, communication patterns, study plans, and exportable reports.

## How we built it

The product is built with **Next.js**, **TypeScript**, React, and an Anthropic-powered AI engine with Zod-validated structured outputs. It uses local SQLite in development and hosted Postgres/Vercel Blob in deployment, alongside browser media APIs, MediaPipe, ONNX Runtime, and a modular test suite.

## Challenges we ran into

- Making an interview feel conversational required low-latency follow-ups without weakening evaluation quality or schema validation.
- Proctoring signals such as camera state, tab focus, pasted content, and nearby voices needed to be treated as auditable indicators—not proof of misconduct.
- Handling resumes, recordings, snapshots, and interview history required a privacy-conscious local/hosted storage design.

## Accomplishments we're proud of

- Built a complete practice loop: preparation, live interview, evaluation, coaching, repeat practice, cross-interview insights, and export.
- Added an integrity layer with face/camera checks, focus and paste events, voice enrollment, nearby-speaker detection, and audio-only conversation recording.

## What we learned

AI coaching works best when it remembers prior practice while keeping feedback specific, explainable, and respectful of uncertainty. The project also reinforced that integrity tooling must present evidence and limitations clearly.

## What's next

Potential next steps include stronger multi-user access control, richer interview analytics, and a reviewer workflow for human-led mock interviews.

## Built with

`Next.js` · `TypeScript` · `React` · `Anthropic` · `Zod` · `SQLite` · `PostgreSQL` · `Vercel Blob` · `MediaPipe` · `ONNX Runtime` · `Vitest`

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app has a built-in demo mode for trying the core workflow without an API key. Run `npm test` and `npm run typecheck` to validate the project.
