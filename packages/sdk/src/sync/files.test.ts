import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { ConfigError } from "../errors.js";
import { hashContent } from "./hash.js";
import { resolveDesiredFiles } from "./files.js";

describe("resolveDesiredFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aichatctl-files-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("expands globs, hashes content, and uses basenames as remote names", () => {
    mkdirSync(join(dir, "docs", "specs"), { recursive: true });
    writeFileSync(join(dir, "docs", "specs", "a.md"), "alpha", "utf8");
    writeFileSync(join(dir, "README.md"), "readme", "utf8");

    const files = resolveDesiredFiles(["docs/**/*.md", "README.md"], dir);

    expect(files.map((f) => f.name)).toEqual(["a.md", "README.md"]);
    const a = files.find((f) => f.name === "a.md");
    expect(a?.hash).toBe(hashContent("alpha"));
  });

  it("returns an empty list when nothing matches", () => {
    expect(resolveDesiredFiles(["nope/*.md"], dir)).toEqual([]);
  });

  it("throws when two different files map to the same library name", () => {
    mkdirSync(join(dir, "x"), { recursive: true });
    mkdirSync(join(dir, "y"), { recursive: true });
    writeFileSync(join(dir, "x", "spec.md"), "1", "utf8");
    writeFileSync(join(dir, "y", "spec.md"), "2", "utf8");

    expect(() => resolveDesiredFiles(["**/spec.md"], dir)).toThrow(ConfigError);
  });
});
