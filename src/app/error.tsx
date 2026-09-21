"use client";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Shown when a page fails to render. Next.js hides the real cause in production, so this explains
 * what usually goes wrong instead of leaving a blank screen.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-amber-100">
        <AlertTriangle className="h-7 w-7 text-amber-700" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">This page didn&apos;t load</h1>
      <p className="mt-2 text-sm text-slate-600">
        Something went wrong on the server. It is usually the database or the data folder: check that the app can write to{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">DATA_DIR</code> locally, or that{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">DATABASE_URL</code> and{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">BLOB_READ_WRITE_TOKEN</code> are set on a hosted deployment.
      </p>
      {error.digest && <p className="mt-2 text-xs text-slate-400">Error reference: {error.digest}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
        <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">Back to the dashboard</Link>
      </div>
    </main>
  );
}
