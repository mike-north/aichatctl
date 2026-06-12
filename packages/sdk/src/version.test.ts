import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getVersion } from "./version.js";

describe("getVersion", () => {
  it("equals the version declared in package.json (never a hardcoded literal)", () => {
    // Resolve package.json from this test file (src/version.test.ts -> ../package.json).
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg: unknown = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    const expected =
      typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined;
    expect(getVersion()).toBe(expected);
  });
});
