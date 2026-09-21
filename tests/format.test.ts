import { describe, expect, it } from "vitest";
import { plural } from "@/lib/format";

describe("plural", () => {
  it("keeps counts readable", () => {
    expect(plural(1, "question")).toBe("1 question");
    expect(plural(3, "question")).toBe("3 questions");
    expect(plural(0, "question")).toBe("0 questions");
    expect(plural(1, "previous interview")).toBe("1 previous interview");
  });
});
