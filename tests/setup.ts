import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Each test file gets its own throwaway data directory and never calls the real API.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "interview-copilot-test-"));
process.env.DEMO_MODE = "1";
delete process.env.ANTHROPIC_API_KEY;
