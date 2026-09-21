import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-100">
        <Compass className="h-7 w-7 text-brand-700" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-sm text-slate-600">This page doesn&apos;t exist, or the interview it pointed to was deleted.</p>
      <Link href="/" className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700">
        Back to the dashboard
      </Link>
    </main>
  );
}
