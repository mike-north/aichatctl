/**
 * CLI behavior tests (UAT layer).
 *
 * These drive the program through its real parser + the real SDK service layer.
 * They never reach a browser: each asserts a usage/validation error (unknown
 * option or command, empty seed, invalid notebook ref) that is raised before any
 * AppleScript is run.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

  it("no longer accepts the removed --transport / --port flags (CDP removed)", async () => {
    const { io, err } = captureIO();
    const t = await run(argv("doctor", "--transport", "cdp"), io);
    expect(t).not.toBe(0);
    expect(err.join("\n")).toMatch(/unknown option '--transport'/);
    const { io: io2, err: err2 } = captureIO();
    const p = await run(argv("sync", "--port", "9222"), io2);
    expect(p).not.toBe(0);
    expect(err2.join("\n")).toMatch(/unknown option '--port'/);
  });

  it("has no `browser` command (CDP removed)", async () => {
    const { io, err } = captureIO();
    const code = await run(argv("browser", "launch"), io);
    expect(code).not.toBe(0);
    expect(err.join("\n")).toMatch(/unknown command 'browser'/);
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
    const code = await run(argv("project", "list", "--platform", "bard"), io);
    expect(code).not.toBe(0);
  });

  it("rejects an unknown --type as a usage error for notebook podcast create", async () => {
    const { io, err } = captureIO();
    const code = await run(
      argv("notebook", "podcast", "create", "--notebook", "abc123", "--type", "podcast"),
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/deep-dive/);
  });

  it("rejects an unknown --length as a usage error for notebook podcast create", async () => {
    const { io, err } = captureIO();
    const code = await run(
      argv("notebook", "podcast", "create", "--notebook", "abc123", "--length", "forever"),
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/short, default, long/);
  });

  it("rejects an invalid notebook ref for notebook sources list", async () => {
    const { io, err } = captureIO();
    const code = await run(argv("notebook", "sources", "list", "--notebook", "not valid!"), io);
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/invalid notebook reference/i);
  });

  it("rejects an invalid notebook ref for notebook status", async () => {
    const { io, err } = captureIO();
    const code = await run(argv("notebook", "status", "--notebook", "not valid!"), io);
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/invalid notebook reference/i);
  });
});
