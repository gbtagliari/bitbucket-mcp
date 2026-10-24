import { readFileSync } from "node:fs";
import { join } from "node:path";

// src/index.ts starts the server at import, so this test reads its source instead.
const source = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

describe("list tool responses", () => {
  it("return a page with next, never the bare values that hide the pages after the first", () => {
    expect(source).not.toMatch(/JSON\.stringify\(\s*result\.values\b/);
  });
});
