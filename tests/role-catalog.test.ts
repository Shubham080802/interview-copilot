import { describe, expect, it } from "vitest";
import { SENIORITY_LEVELS } from "@/lib/schemas";
import { FIELDS, FIELD_CATALOG, POPULAR_FIELDS, popularRoles, prefillFromParams, roleForSeniority, seniorityFromExperience, suggestRoles } from "@/lib/role-catalog";

describe("field catalog", () => {
  it("gives every field a role for every seniority level, and the field list matches the catalog", () => {
    expect(FIELDS).toEqual(FIELD_CATALOG.map((f) => f.name));
    for (const entry of FIELD_CATALOG) {
      for (const level of SENIORITY_LEVELS) expect(entry.roles[level]).toBeTruthy();
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });

  it("only lists popular fields that exist in the catalog", () => {
    for (const name of POPULAR_FIELDS) expect(FIELDS).toContain(name);
  });

  it("returns a field's roles without duplicates, and null for an unknown field", () => {
    const roles = popularRoles("Software Engineering");
    expect(roles).toContain("Senior Software Engineer");
    expect(new Set(roles).size).toBe(roles.length);
    expect(popularRoles("Astrology")).toEqual([]);
    expect(roleForSeniority("Astrology", "senior")).toBeNull();
  });

  it("falls back to the mid-level title when a level isn't distinct", () => {
    expect(roleForSeniority("Software Engineering", "senior")).toBe("Senior Software Engineer");
  });
});

describe("seniority from years of experience", () => {
  it("buckets years into a plausible level", () => {
    expect(seniorityFromExperience(0)).toBe("intern");
    expect(seniorityFromExperience(2)).toBe("junior");
    expect(seniorityFromExperience(4)).toBe("mid");
    expect(seniorityFromExperience(7)).toBe("senior");
    expect(seniorityFromExperience(10)).toBe("staff");
    expect(seniorityFromExperience(20)).toBe("manager");
  });
});

describe("suggesting roles from a profile", () => {
  it("matches a backend-leaning resume to Backend Engineering, not the frontend field", () => {
    const suggestions = suggestRoles({
      headline: "Backend engineer, distributed systems",
      resume: "Built REST APIs on Postgres, worked on distributed systems and message queues.",
      experienceYears: 4,
    });
    expect(suggestions[0].field).toBe("Backend Engineering");
    expect(suggestions[0].role).toBe("Backend Engineer II"); // mid-level, from 4 years
    expect(suggestions[0].seniority).toBe("mid");
    expect(suggestions[0].matched.length).toBeGreaterThan(0);
  });

  it("weighs the headline more heavily than the resume body", () => {
    const suggestions = suggestRoles({
      headline: "Product manager",
      resume: "Mentioned react and css once while describing a side project.",
      experienceYears: 5,
    });
    expect(suggestions[0].field).toBe("Product Management");
  });

  it("picks a role title matching the candidate's experience", () => {
    const senior = suggestRoles({ headline: "Frontend engineer", resume: "React, TypeScript", experienceYears: 8 });
    expect(senior[0].role).toBe("Senior Frontend Engineer");
    const junior = suggestRoles({ headline: "Frontend engineer", resume: "React, TypeScript", experienceYears: 1 });
    expect(junior[0].role).toBe("Frontend Engineer I");
  });

  it("returns nothing for a blank profile", () => {
    expect(suggestRoles({ headline: "", resume: "", experienceYears: 0 })).toEqual([]);
  });

  it("never returns more than the requested number of suggestions", () => {
    const resume = FIELD_CATALOG.map((f) => f.keywords[0]).join(", ");
    expect(suggestRoles({ headline: "", resume, experienceYears: 3 }, 2)).toHaveLength(2);
  });
});

describe("prefilling the setup form from a link's query string", () => {
  it("carries over the fields a link actually provided", () => {
    expect(prefillFromParams({ field: "Product Management", role: "Senior PM", seniority: "senior" })).toEqual({
      field: "Product Management",
      role: "Senior PM",
      seniority: "senior",
    });
  });

  it("never overrides the form's defaults with an explicit undefined for a param that was never provided", () => {
    // Regression: object spread copies a key even when its value is undefined, which would blank out
    // the form's DEFAULTS (e.g. field: "Software Engineering") — every key here must be omitted.
    const result = prefillFromParams({});
    expect(result).toEqual({});
    expect("field" in result).toBe(false);
    expect("role" in result).toBe(false);
    expect("seniority" in result).toBe(false);
  });

  it("drops an invalid seniority instead of passing it through", () => {
    expect(prefillFromParams({ seniority: "godlike" })).toEqual({});
  });

  it("takes the first value when a param repeats", () => {
    expect(prefillFromParams({ field: ["Sales", "Marketing"] })).toEqual({ field: "Sales" });
  });

  it("treats a blank value the same as a missing one", () => {
    expect(prefillFromParams({ role: "   " })).toEqual({});
  });
});
