import { describe, expect, it } from "vitest";
import { groupOptions } from "@/lib/combobox";

const OPTIONS = ["Software Engineering", "Product Management", "Data Science / ML", "Sales", "Backend Engineering"];
const POPULAR = ["Software Engineering", "Product Management"];

describe("what a combobox lists", () => {
  it("shows everything, split into popular and the rest, while not filtering", () => {
    expect(groupOptions(OPTIONS, POPULAR, "", false)).toEqual({
      popular: ["Software Engineering", "Product Management"],
      rest: ["Data Science / ML", "Sales", "Backend Engineering"],
    });
  });

  it("keeps filtering by what was typed even once the field's value catches up to it", () => {
    // Regression: a combobox that reports every keystroke to its parent gets that same text back as
    // its `value` prop on the next render, so comparing the typed text to the value can never tell
    // "just opened" apart from "the user typed the whole list away" — `filtering` must decide instead.
    const afterTyping = groupOptions(OPTIONS, POPULAR, "Software Engineering", true);
    expect(afterTyping).toEqual({ popular: [], rest: ["Software Engineering"] });
  });

  it("filters case-insensitively by substring, and drops the popular grouping", () => {
    expect(groupOptions(OPTIONS, POPULAR, "eng", true)).toEqual({ popular: [], rest: ["Software Engineering", "Backend Engineering"] });
    expect(groupOptions(OPTIONS, POPULAR, "SALES", true)).toEqual({ popular: [], rest: ["Sales"] });
  });

  it("shows nothing for text that matches no option, rather than falling back to the full list", () => {
    expect(groupOptions(OPTIONS, POPULAR, "robotics", true)).toEqual({ popular: [], rest: [] });
  });

  it("treats a cleared search box as not filtering", () => {
    expect(groupOptions(OPTIONS, POPULAR, "   ", true)).toEqual({
      popular: ["Software Engineering", "Product Management"],
      rest: ["Data Science / ML", "Sales", "Backend Engineering"],
    });
  });

  it("never lists a popular item twice", () => {
    const { popular, rest } = groupOptions(OPTIONS, POPULAR, "", false);
    expect(rest.some((o) => popular.includes(o))).toBe(false);
  });

  it("ignores a popular entry that isn't in the option list", () => {
    expect(groupOptions(OPTIONS, ["Marketing"], "", false)).toEqual({ popular: [], rest: OPTIONS });
  });
});
