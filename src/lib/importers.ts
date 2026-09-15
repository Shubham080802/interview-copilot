import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import { SENIORITY_LEVELS, type JobPosting } from "./schemas";

export class ImportError extends Error {}

/* ------------------------------------------------------------------ */
/*  Safe fetching of user-supplied URLs                                */
/* ------------------------------------------------------------------ */

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ImportError("Only http(s) links can be imported.");
  if (url.port && !["80", "443"].includes(url.port)) throw new ImportError("Links with custom ports can't be imported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new ImportError("Couldn't resolve that website.");
  if (addresses.some(isPrivateAddress)) throw new ImportError("Links to private or local network addresses can't be imported.");
  return url;
}

const MAX_BYTES = 3 * 1024 * 1024;

/** Fetches a public web page with redirect re-validation, a size cap and a timeout. */
export async function safeFetchText(raw: string): Promise<{ url: string; html: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "Mozilla/5.0 (InterviewCopilot job importer)", Accept: "text/html,application/xhtml+xml" },
    }).catch(() => {
      throw new ImportError("The website didn't respond.");
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new ImportError(`The website returned an error (${res.status}).`);
    const reader = res.body?.getReader();
    if (!reader) return { url: url.toString(), html: "" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { url: url.toString(), html: Buffer.concat(chunks).toString("utf8") };
  }
  throw new ImportError("Too many redirects.");
}

/* ------------------------------------------------------------------ */
/*  HTML → text and job posting structured data                        */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|head|nav|footer)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

const meta = (html: string, key: string) =>
  decode(
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)?.[1] ??
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i").exec(html)?.[1] ??
      "",
  ).trim();

export interface ScrapedJob {
  url: string;
  title: string;
  company: string;
  companyWebsite: string;
  description: string; // plain text
  fromStructuredData: boolean;
}

type JsonLd = Record<string, unknown>;

function findJobPosting(node: unknown): JsonLd | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findJobPosting(n);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as JsonLd;
    const type = obj["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return obj;
    if (obj["@graph"]) return findJobPosting(obj["@graph"]);
  }
  return null;
}

/** Extracts a job posting from a page, preferring schema.org JobPosting data (used by most applicant tracking systems). */
export function scrapeJobPage(url: string, html: string): ScrapedJob {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const job = findJobPosting(JSON.parse(m[1].trim()));
      if (!job) continue;
      const org = (job.hiringOrganization ?? {}) as JsonLd;
      return {
        url,
        title: String(job.title ?? "").trim(),
        company: String(org.name ?? "").trim(),
        companyWebsite: String(org.sameAs ?? org.url ?? "").trim(),
        description: htmlToText(decode(String(job.description ?? ""))),
        fromStructuredData: true,
      };
    } catch {
      /* ignore malformed JSON-LD blocks */
    }
  }
  const title = meta(html, "og:title") || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  return {
    url,
    title,
    company: meta(html, "og:site_name"),
    companyWebsite: "",
    description: htmlToText(body),
    fromStructuredData: false,
  };
}

export function guessSeniority(title: string): JobPosting["seniority"] {
  const t = title.toLowerCase();
  if (/\b(intern|internship|graduate|new grad|trainee|apprentice)\b/.test(t)) return "intern";
  if (/\b(staff|principal|distinguished|architect)\b/.test(t)) return "staff";
  if (/\b(manager|head of|director|vp|lead)\b/.test(t)) return "manager";
  if (/\b(senior|sr\.?)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|associate|entry)\b/.test(t)) return "junior";
  return SENIORITY_LEVELS[2];
}

/** Heuristic (no-AI) mapping of a scraped page into interview setup fields. */
export function basicJobPosting(job: ScrapedJob): JobPosting {
  // Titles often look like "Senior Engineer - Acme | Careers" or "Senior Engineer at Acme".
  const [rolePart, companyPart] = job.title.split(/\s+(?:at|@|\||-|–|—)\s+/);
  const lines = job.description.split("\n").map((l) => l.trim());
  const reqStart = lines.findIndex((l) => /(requirements|qualifications|what you('ll)? (need|bring)|about you|skills)/i.test(l) && l.length < 80);
  const requirements =
    reqStart >= 0
      ? lines.slice(reqStart + 1).filter((l) => l.startsWith("- ")).slice(0, 15).map((l) => l.slice(2)).join("\n")
      : "";
  return {
    role: (rolePart ?? job.title).trim().slice(0, 120),
    company: (job.company || companyPart || "").replace(/careers?|jobs?/gi, "").trim().slice(0, 120),
    company_website: job.companyWebsite || new URL(job.url).origin,
    field: "Software Engineering",
    seniority: guessSeniority(job.title),
    job_description: job.description.slice(0, 20_000),
    requirements,
    company_notes: "",
  };
}

/* ------------------------------------------------------------------ */
/*  Resume files                                                       */
/* ------------------------------------------------------------------ */

// Hosted request bodies are capped (~4.5 MB on Vercel).
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(data);
    const { text } = await extractText(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+/g, " ").trim();
  } catch {
    throw new ImportError("Couldn't read that PDF. Try exporting it again or paste the text instead.");
  }
}

export function isPdf(data: Uint8Array): boolean {
  return data.length > 4 && Buffer.from(data.subarray(0, 5)).toString("latin1") === "%PDF-";
}
