import { describe, expect, it } from "vitest";
import { basicJobPosting, extractPdfText, guessSeniority, htmlToText, isPdf, isPrivateAddress, publicOnlyLookup, safeFetchText, scrapeJobPage } from "@/lib/importers";
import { importJobPosting, importResume } from "@/lib/service";
import { makePdf } from "./pdf";

describe("private address blocking", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(["8.8.8.8", "172.32.0.1", "104.16.0.1", "2606:4700::1111"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it("refuses to fetch local, private and non-http URLs", async () => {
    await expect(safeFetchText("http://localhost/api/export-all")).rejects.toThrow(/private|local/i);
    await expect(safeFetchText("http://localhost:3000/api/export-all")).rejects.toThrow(/port/i);
    await expect(safeFetchText("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private|local/i);
    await expect(safeFetchText("file:///etc/passwd")).rejects.toThrow(/http/i);
    await expect(safeFetchText("https://example.com:8443/job")).rejects.toThrow(/port/i);
    await expect(safeFetchText("not a url")).rejects.toThrow(/valid URL/i);
  });

  it("refuses the connection when the name resolves to a private address", async () => {
    // The check runs in the lookup the socket uses, so a name that only points inside the network
    // at connection time (DNS rebinding) is refused as well.
    const lookup = () =>
      new Promise((resolve, reject) => {
        publicOnlyLookup("localhost", {}, (err, address) => (err ? reject(err) : resolve(address)));
      });
    await expect(lookup()).rejects.toThrow(/private|local/i);
  });

  it("does not fall back to other strategies for blocked URLs", async () => {
    await expect(importJobPosting({ url: "http://127.0.0.1/jobs/1" })).rejects.toThrow(/private|local/i);
  });
});

describe("job page scraping", () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Senior Backend Engineer",
    hiringOrganization: { "@type": "Organization", name: "Acme Payments", sameAs: "https://acme.example" },
    description:
      "&lt;p&gt;We build payment rails.&lt;/p&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;5+ years Go&lt;/li&gt;&lt;li&gt;PostgreSQL&lt;/li&gt;&lt;/ul&gt;",
  };
  const html = `<html><head><title>Careers</title><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body>ignored</body></html>`;

  it("prefers schema.org JobPosting data", () => {
    const job = scrapeJobPage("https://jobs.example/1", html);
    expect(job).toMatchObject({ title: "Senior Backend Engineer", company: "Acme Payments", companyWebsite: "https://acme.example", fromStructuredData: true });
    expect(job.description).toContain("We build payment rails.");
    expect(job.description).not.toContain("<");
  });

  it("maps a scraped job into setup fields without AI", () => {
    const posting = basicJobPosting(scrapeJobPage("https://jobs.example/1", html));
    expect(posting).toMatchObject({ role: "Senior Backend Engineer", company: "Acme Payments", seniority: "senior" });
    expect(posting.requirements).toBe("5+ years Go\nPostgreSQL");
  });

  it("falls back to page title and visible text", () => {
    const page = `<html><head><meta property="og:title" content="Data Analyst at Globex"><meta property="og:site_name" content="Globex"></head>
      <body><nav>Menu</nav><main><h1>Data Analyst</h1><p>Analyse things &amp; report.</p><script>track()</script></main></body></html>`;
    const job = scrapeJobPage("https://globex.example/careers/9", page);
    expect(job).toMatchObject({ title: "Data Analyst at Globex", company: "Globex", fromStructuredData: false });
    expect(job.description).toContain("Analyse things & report.");
    expect(job.description).not.toContain("track()");
    expect(basicJobPosting(job)).toMatchObject({ role: "Data Analyst", company: "Globex", company_website: "https://globex.example" });
  });

  it("strips tags and decodes entities", () => {
    expect(htmlToText("<p>A&nbsp;&amp;&#39;B&#x21;</p><style>.x{}</style>")).toBe("A &'B!");
  });

  it.each([
    ["Software Engineering Intern", "intern"],
    ["Staff Engineer", "staff"],
    ["Engineering Manager", "manager"],
    ["Sr. Data Scientist", "senior"],
    ["Junior Developer", "junior"],
    ["Software Engineer", "mid"],
  ])("guesses seniority for %s", (title, level) => expect(guessSeniority(title)).toBe(level));

  it("requires AI mode to structure pasted text", async () => {
    await expect(importJobPosting({ text: "x".repeat(100) })).rejects.toThrow(/AI mode/);
  });
});

describe("resume import (no AI)", () => {
  const lines = ["Priya Sharma", "Backend Engineer at Acme 2019 - present", "Skills: Go, Kubernetes"];

  it("extracts text from a PDF", async () => {
    const pdf = makePdf(lines);
    expect(isPdf(pdf)).toBe(true);
    const text = await extractPdfText(pdf);
    expect(text).toContain("Priya Sharma");
    expect(text).toContain("Kubernetes");
  });

  it("builds a reviewable profile draft from a PDF", async () => {
    const result = await importResume(makePdf(lines), "resume.pdf");
    expect(result.method).toBe("basic");
    expect(result.data.name).toBe("Priya Sharma");
    expect(result.data.experience_years).toBe(new Date().getFullYear() - 2019);
    expect(result.data.resume_markdown).toContain("Kubernetes");
    expect(result.warning).toBeTruthy();
  });

  it("accepts plain-text resumes and rejects other formats", async () => {
    const txt = new TextEncoder().encode("Sam Lee\nProduct Manager since 2021");
    expect((await importResume(txt, "cv.md")).data.name).toBe("Sam Lee");
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    await expect(importResume(docx, "cv.docx")).rejects.toThrow(/PDF/);
  });

  it("rejects corrupt PDFs with a helpful message", async () => {
    await expect(extractPdfText(new TextEncoder().encode("%PDF-1.4 garbage"))).rejects.toThrow(/Couldn't read that PDF/);
  });
});
