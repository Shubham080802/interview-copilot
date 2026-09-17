import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : /\.tsx?$/.test(e.name) ? [full] : [];
  });

describe("React effects", () => {
  // An expression-bodied effect returns whatever the expression returns. Some DOM APIs now return
  // Promises (e.g. scrollIntoView), which React calls as a cleanup and crashes ("destroy is not a function").
  it("always use a block body so nothing but a cleanup function can be returned", () => {
    const offenders = files(path.join(process.cwd(), "src")).flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        // Allowed: "() => {" (block body) and "() => () => {" (directly returns a cleanup function).
        .filter(({ line }) => /use(Layout)?Effect\(\s*(async\s*)?\(\)\s*=>\s*(?!\{|\(\)\s*=>)\S/.test(line))
        .map(({ i }) => `${path.relative(process.cwd(), file)}:${i + 1}`),
    );
    expect(offenders).toEqual([]);
  });
});
