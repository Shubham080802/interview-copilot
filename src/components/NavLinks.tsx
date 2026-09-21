"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/interviews/new", label: "New interview" },
  { href: "/progress", label: "Progress & learning" },
  { href: "/profile", label: "Profile" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 whitespace-nowrap">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={cx("rounded-lg px-3 py-1.5 text-sm font-medium transition", active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100")}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
