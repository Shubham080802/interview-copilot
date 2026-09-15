"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Play } from "lucide-react";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-400">Loading editor…</div>,
});

export const LANGUAGES = ["javascript", "typescript", "python", "java", "cpp", "go", "csharp", "sql"];

/** Runs JavaScript in a throwaway Web Worker (no DOM, no network access to the page) with a time limit. */
function runJavaScript(code: string): Promise<string> {
  const source = `
    const out = [];
    const fmt = (a) => a.map(x => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ");
    console.log = (...a) => out.push(fmt(a));
    console.error = (...a) => out.push("[error] " + fmt(a));
    self.onmessage = async (e) => {
      try { await (0, eval)(e.data); } catch (err) { out.push("[exception] " + (err && err.message || err)); }
      self.postMessage(out.join("\\n"));
    };`;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      resolve("[timeout] Execution stopped after 3 seconds.");
    }, 3000);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(String(e.data) || "(no output — use console.log to print results)");
    };
    worker.postMessage(code);
  });
}

export function CodeEditor({
  value,
  onChange,
  language,
  onLanguageChange,
  dark = true,
  height = "100%",
}: {
  value: string;
  onChange: (v: string) => void;
  language: string;
  onLanguageChange: (l: string) => void;
  dark?: boolean;
  height?: string;
}) {
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const canRun = language === "javascript";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#1e1e1e]">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-1.5">
        <select value={language} onChange={(e) => onLanguageChange(e.target.value)} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none">
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button
          type="button"
          disabled={!canRun || running}
          title={canRun ? "Run JavaScript" : "Running is available for JavaScript; other languages are reviewed by the evaluator"}
          onClick={async () => {
            setRunning(true);
            setOutput(await runJavaScript(value));
            setRunning(false);
          }}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          <Play className="h-3 w-3" /> {running ? "Running…" : "Run"}
        </button>
      </div>
      <div className="min-h-0 flex-1" style={{ height }}>
        <Monaco
          value={value}
          language={language === "cpp" ? "cpp" : language}
          theme={dark ? "vs-dark" : "light"}
          onChange={(v) => onChange(v ?? "")}
          options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }}
        />
      </div>
      {output !== null && (
        <pre className="max-h-32 overflow-auto border-t border-slate-700 bg-black/60 px-3 py-2 font-mono text-xs text-slate-200">{output}</pre>
      )}
    </div>
  );
}
