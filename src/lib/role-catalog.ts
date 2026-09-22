import { SENIORITY_LEVELS, type InterviewConfig } from "./schemas";

/**
 * Fields and roles for the interview setup form: what the "Field" picker offers, the "popular roles"
 * shown once a field is picked, and a keyword-based match from a candidate's profile to the fields
 * they are likely suited for. Pure data and string matching — no AI required, so it works the same
 * in demo mode and with a key configured.
 */

export interface FieldEntry {
  name: string;
  /** Common job titles for this field, one per seniority level, roughly least to most senior. */
  roles: Record<(typeof SENIORITY_LEVELS)[number], string>;
  /** Words that suggest a resume or headline belongs to this field. Multi-word phrases match as substrings. */
  keywords: string[];
}

export const FIELD_CATALOG: FieldEntry[] = [
  {
    name: "Software Engineering",
    roles: { intern: "Software Engineering Intern", junior: "Software Engineer I", mid: "Software Engineer II", senior: "Senior Software Engineer", staff: "Staff Software Engineer", manager: "Engineering Manager" },
    keywords: ["software engineer", "full stack", "fullstack", "algorithm", "data structure", "git", "ci/cd", "microservice", "rest api", "object-oriented", "unit test"],
  },
  {
    name: "Frontend Engineering",
    roles: { intern: "Frontend Engineering Intern", junior: "Frontend Engineer I", mid: "Frontend Engineer II", senior: "Senior Frontend Engineer", staff: "Staff Frontend Engineer", manager: "Frontend Engineering Manager" },
    keywords: ["frontend", "front-end", "react", "vue", "angular", "css", "html", "typescript", "javascript", "next.js", "ui component", "accessibility", "web performance"],
  },
  {
    name: "Backend Engineering",
    roles: { intern: "Backend Engineering Intern", junior: "Backend Engineer I", mid: "Backend Engineer II", senior: "Senior Backend Engineer", staff: "Staff Backend Engineer", manager: "Backend Engineering Manager" },
    keywords: ["backend", "back-end", "api", "database", "sql", "postgres", "distributed system", "server-side", "message queue", "caching", "grpc"],
  },
  {
    name: "Data Science / ML",
    roles: { intern: "Data Science Intern", junior: "Data Analyst", mid: "Data Scientist", senior: "Senior Data Scientist", staff: "Staff Data Scientist", manager: "Data Science Manager" },
    keywords: ["machine learning", "data scientist", "pytorch", "tensorflow", "nlp", "deep learning", "regression", "statistics", "pandas", "scikit-learn", "llm", "model training"],
  },
  {
    name: "Data Engineering",
    roles: { intern: "Data Engineering Intern", junior: "Data Engineer I", mid: "Data Engineer II", senior: "Senior Data Engineer", staff: "Staff Data Engineer", manager: "Data Engineering Manager" },
    keywords: ["data engineer", "etl", "data pipeline", "airflow", "data warehouse", "spark", "kafka", "dbt", "big data"],
  },
  {
    name: "DevOps / SRE / Cloud",
    roles: { intern: "DevOps Intern", junior: "DevOps Engineer", mid: "Site Reliability Engineer", senior: "Senior Site Reliability Engineer", staff: "Staff SRE", manager: "SRE Manager" },
    keywords: ["devops", "site reliability", "kubernetes", "docker", "terraform", "aws", "azure", "gcp", "infrastructure", "observability", "on-call", "incident response"],
  },
  {
    name: "Mobile Development",
    roles: { intern: "Mobile Engineering Intern", junior: "Mobile Engineer I", mid: "Mobile Engineer II", senior: "Senior Mobile Engineer", staff: "Staff Mobile Engineer", manager: "Mobile Engineering Manager" },
    keywords: ["ios", "android", "swift", "kotlin", "react native", "flutter", "mobile app", "xcode", "app store"],
  },
  {
    name: "Cybersecurity",
    roles: { intern: "Security Intern", junior: "Security Analyst", mid: "Security Engineer", senior: "Senior Security Engineer", staff: "Staff Security Engineer", manager: "Security Engineering Manager" },
    keywords: ["security", "penetration test", "vulnerability", "incident response", "siem", "threat", "compliance", "encryption", "soc analyst"],
  },
  {
    name: "Product Management",
    roles: { intern: "Product Management Intern", junior: "Associate Product Manager", mid: "Product Manager", senior: "Senior Product Manager", staff: "Group Product Manager", manager: "Director of Product" },
    keywords: ["product manager", "roadmap", "product strategy", "user story", "stakeholder", "go-to-market", "product-market fit", "prioritisation", "prioritization", "backlog"],
  },
  {
    name: "UX / Product Design",
    roles: { intern: "UX Design Intern", junior: "Product Designer I", mid: "Product Designer II", senior: "Senior Product Designer", staff: "Staff Product Designer", manager: "Design Manager" },
    keywords: ["ux design", "ui design", "product designer", "figma", "user research", "wireframe", "prototype", "design system", "usability"],
  },
  {
    name: "Business / Data Analyst",
    roles: { intern: "Business Analyst Intern", junior: "Business Analyst", mid: "Data Analyst", senior: "Senior Data Analyst", staff: "Analytics Lead", manager: "Analytics Manager" },
    keywords: ["business analyst", "data analyst", "dashboard", "sql query", "tableau", "power bi", "excel", "kpi", "reporting", "a/b test"],
  },
  {
    name: "QA / Test Engineering",
    roles: { intern: "QA Intern", junior: "QA Engineer", mid: "SDET", senior: "Senior QA Engineer", staff: "Staff QA Engineer", manager: "QA Manager" },
    keywords: ["qa engineer", "test automation", "selenium", "cypress", "test case", "regression test", "quality assurance", "sdet"],
  },
  {
    name: "Consulting",
    roles: { intern: "Consulting Intern", junior: "Business Analyst", mid: "Consultant", senior: "Senior Consultant", staff: "Engagement Manager", manager: "Principal" },
    keywords: ["consultant", "consulting", "client engagement", "case study", "strategy engagement", "management consulting"],
  },
  {
    name: "Finance",
    roles: { intern: "Finance Intern", junior: "Financial Analyst", mid: "Senior Financial Analyst", senior: "Finance Manager", staff: "Director of Finance", manager: "VP Finance" },
    keywords: ["financial analyst", "financial modeling", "forecasting", "budgeting", "valuation", "accounting", "fp&a", "investment"],
  },
  {
    name: "Marketing",
    roles: { intern: "Marketing Intern", junior: "Marketing Associate", mid: "Marketing Manager", senior: "Senior Marketing Manager", staff: "Director of Marketing", manager: "VP Marketing" },
    keywords: ["marketing", "campaign", "seo", "content strategy", "brand", "growth marketing", "social media", "demand generation"],
  },
  {
    name: "Sales",
    roles: { intern: "Sales Development Intern", junior: "Sales Development Representative", mid: "Account Executive", senior: "Senior Account Executive", staff: "Sales Manager", manager: "Regional Sales Director" },
    keywords: ["sales", "account executive", "quota", "pipeline", "crm", "salesforce", "closing deals", "business development"],
  },
];

export const FIELDS = FIELD_CATALOG.map((f) => f.name);

/** Shown first, before the rest of the fields, when the picker's search box is empty. */
export const POPULAR_FIELDS = ["Software Engineering", "Product Management", "Data Science / ML", "UX / Product Design", "Marketing", "Sales"];

const fieldByName = new Map(FIELD_CATALOG.map((f) => [f.name, f]));

/** Popular job titles for a field, across seniority levels, for quick-fill chips. */
export function popularRoles(field: string): string[] {
  const entry = fieldByName.get(field);
  if (!entry) return [];
  // De-duplicate: a few fields reuse the same title at more than one level (e.g. "Business Analyst").
  return [...new Set(SENIORITY_LEVELS.map((level) => entry.roles[level]))];
}

/** The field's usual title for a seniority level, or its mid-level title if that level isn't listed. */
export function roleForSeniority(field: string, seniority: InterviewConfig["seniority"]): string | null {
  const entry = fieldByName.get(field);
  return entry ? entry.roles[seniority] ?? entry.roles.mid : null;
}

/** Rough seniority from years of experience — used only to pick a plausible role title to suggest. */
export function seniorityFromExperience(years: number): InterviewConfig["seniority"] {
  if (years < 1) return "intern";
  if (years < 3) return "junior";
  if (years < 6) return "mid";
  if (years < 9) return "senior";
  if (years < 13) return "staff";
  return "manager";
}

export interface RoleSuggestion {
  field: string;
  role: string;
  seniority: InterviewConfig["seniority"];
  /** Keywords from the profile that matched this field, for a short "because you mentioned…" note. */
  matched: string[];
}

/**
 * Matches a candidate's headline and resume against each field's keywords and returns the best-fitting
 * fields with a role title picked for their experience level. A headline match counts for more than a
 * resume match, since the headline is what the candidate chose to describe themselves with.
 */
export function suggestRoles(profile: { headline: string; resume: string; experienceYears: number }, limit = 3): RoleSuggestion[] {
  const headline = profile.headline.toLowerCase();
  const resume = profile.resume.toLowerCase();
  const seniority = seniorityFromExperience(profile.experienceYears);

  const scored = FIELD_CATALOG.map((entry) => {
    const matched = entry.keywords.filter((k) => headline.includes(k) || resume.includes(k));
    const score = matched.reduce((s, k) => s + (headline.includes(k) ? 3 : 0) + (resume.includes(k) ? 1 : 0), 0);
    return { field: entry.name, role: entry.roles[seniority] ?? entry.roles.mid, seniority, matched, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ field, role, seniority: level, matched }) => ({ field, role, seniority: level, matched }));
}

export type SearchParamValue = string | string[] | undefined;
const firstValue = (v: SearchParamValue) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/**
 * Prefills the setup form from a link's query string, e.g. the "Start an interview" shortcut on the
 * Profile page for a suggested role. Only keys the link actually provided are included: spreading an
 * explicit `undefined` into the form's defaults would blank them out instead of leaving them alone.
 */
export function prefillFromParams(params: Record<string, SearchParamValue>): Partial<Pick<InterviewConfig, "field" | "role" | "seniority">> {
  const field = firstValue(params.field);
  const role = firstValue(params.role);
  const seniority = firstValue(params.seniority);
  const validSeniority = seniority && (SENIORITY_LEVELS as readonly string[]).includes(seniority) ? (seniority as InterviewConfig["seniority"]) : undefined;
  return {
    ...(field && { field }),
    ...(role && { role }),
    ...(validSeniority && { seniority: validSeniority }),
  };
}
