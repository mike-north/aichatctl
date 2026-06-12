/**
 * CLI behavior tests (UAT layer).
 *
 * These drive the program through its real parser + the real SDK service layer.
 * They never reach a browser: doctor short-circuits when CDP is unreachable, and
 * the seed validation fails before any connection is attempted.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";

import { run } from "./cli.js";
import type { IO } from "./cli.js";
import { getCliVersion } from "./version.js";

function captureIO(): { io: IO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

function argv(...args: string[]): string[] {
  return ["node", "aichatctl", ...args];
}

describe("getCliVersion", () => {
  it("equals the version in package.json (never hardcoded)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg: unknown = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    const expected =
      typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined;
    expect(getCliVersion()).toBe(expected);
  });
});

describe("run", () => {
  it("prints help and exits 0", async () => {
    const { io, out } = captureIO();
    const code = await run(argv("--help"), io);
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/Usage: aichatctl/);
  });

  it("reports CDP unreachable and exits 1 for doctor with no browser", async () => {
    const { io, out } = captureIO();
    // Use an almost-certainly-closed port so the test is hermetic.
    const code = await run(argv("doctor", "--json", "--port", "65535"), io);
    const report: unknown = JSON.parse(out.join("\n"));
    expect(report).toMatchObject({ cdpReachable: false, ok: false });
    expect(code).toBe(1);
  });

  it("rejects an empty seed before connecting and exits 1", async () => {
    const { io, err } = captureIO();
    const code = await run(
      argv("session", "create", "--platform", "claude", "--project", "P", "--seed", "   "),
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/non-empty --seed/);
  });

  it("rejects an unknown platform as a usage error", async () => {
    const { io } = captureIO();
    const code = await run(argv("project", "list", "--platform", "gemini"), io);
    expect(code).not.toBe(0);
  });
});
