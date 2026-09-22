"use client";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};
const BTN = "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(BTN, VARIANTS[variant], className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(BTN, VARIANTS[variant], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", className)} {...props} />;
}

export function Badge({ tone = "slate", children, className }: { tone?: "slate" | "green" | "amber" | "red" | "brand" | "blue"; children: ReactNode; className?: string }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
    red: "bg-rose-50 text-rose-700 ring-rose-600/20",
    brand: "bg-brand-50 text-brand-700 ring-brand-600/20",
    blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent", tones[tone], className)}>{children}</span>;
}

export function CardHeading({ icon: Icon, tone = "brand", children }: { icon: LucideIcon; tone?: "brand" | "violet"; children: ReactNode }) {
  const toneClass = tone === "violet" ? "text-violet-600" : "text-brand-600";
  return (
    <div className="flex items-center gap-2 font-semibold">
      <Icon className={cx("h-4 w-4", toneClass)} /> {children}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="text-sm font-medium text-slate-800">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 placeholder:text-slate-400";

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cx("prose-sm text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function scoreTone(score: number, max = 100): "green" | "amber" | "red" {
  const pct = score / max;
  return pct >= 0.7 ? "green" : pct >= 0.5 ? "amber" : "red";
}

const RING_COLORS = { green: "#10b981", amber: "#f59e0b", red: "#f43f5e" };

export function ScoreRing({ score, max = 100, size = 96, label }: { score: number; max?: number; size?: number; label?: string }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / max));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={8} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING_COLORS[scoreTone(score, max)]} strokeWidth={8} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="absolute text-center">
        <div className="text-xl font-semibold tabular-nums">{Math.round(score * 10) / 10}</div>
        {label && <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>}
      </div>
    </div>
  );
}

export function Bar({ value, max = 100 }: { value: number; max?: number }) {
  const tone = scoreTone(value, max);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: RING_COLORS[tone] }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center">
      <div className="font-medium text-slate-800">{title}</div>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}
