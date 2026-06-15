/**
 * Tests for the AppleScript driver's pure (osascript-free) logic paths.
 *
 * These cover Gemini, which is seed-sessions only: project resolution, the empty
 * project list, and the "unsupported operation" guards for file/instructions ops.
 * The osascript-driven flows (login probe, seeding, Claude/ChatGPT file ops) need
 * a live Chrome and are exercised by the UAT documented in the README.
 *
 * @see Gemini web app — https://gemini.google.com/app
 */
import { describe, expect, it } from "vitest";

import { UnsupportedOperationError } from "../../errors.js";
import type { Project } from "../../types.js";
import { AppleScriptDriver } from "./driver.js";

const gemini = (): AppleScriptDriver => new AppleScriptDriver("gemini");
const GEM_PROJECT: Project = {
  id: "abc123",
  name: "My Gem",
  url: "https://gemini.google.com/gem/abc123",
};

describe("AppleScriptDriver — Gemini project resolution", () => {
  it.each(["new", "app", "chat", "NEW", "App", ""])(
    "resolves %j to a plain new chat at /app",
    async (ref) => {
      const p = await gemini().resolveProject(ref);
      expect(p).toEqual({
        id: "app",
        name: "New chat",
        url: "https://gemini.google.com/app",
      });
    },
  );

  it("trims surrounding whitespace before matching the plain-chat sentinels", async () => {
    const p = await gemini().resolveProject("  new  ");
    expect(p.url).toBe("https://gemini.google.com/app");
  });

  it("extracts the Gem id from a full Gem URL", async () => {
    const p = await gemini().resolveProject("https://gemini.google.com/gem/xyz789/abcdef");
    expect(p.id).toBe("xyz789");
    expect(p.url).toBe("https://gemini.google.com/gem/xyz789");
  });

  it("treats a bare non-sentinel ref as a Gem id", async () => {
    const p = await gemini().resolveProject("my-custom-gem");
    expect(p).toEqual({
      id: "my-custom-gem",
      name: "my-custom-gem",
      url: "https://gemini.google.com/gem/my-custom-gem",
    });
  });
});

describe("AppleScriptDriver — Gemini has no project library", () => {
  it("lists no projects (Gemini exposes none)", async () => {
    expect(await gemini().listProjects()).toEqual([]);
  });

  it("rejects getProjectFiles as unsupported", async () => {
    await expect(gemini().getProjectFiles(GEM_PROJECT)).rejects.toThrow(UnsupportedOperationError);
  });

  it("rejects uploadProjectFile as unsupported (before touching the filesystem)", async () => {
    await expect(
      gemini().uploadProjectFile(GEM_PROJECT, "/nonexistent/does-not-exist.md"),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it("rejects deleteProjectFile as unsupported", async () => {
    await expect(gemini().deleteProjectFile(GEM_PROJECT, "x.md")).rejects.toThrow(
      UnsupportedOperationError,
    );
  });

  it("rejects getProjectInstructions as unsupported", async () => {
    await expect(gemini().getProjectInstructions(GEM_PROJECT)).rejects.toThrow(
      UnsupportedOperationError,
    );
  });

  it("rejects setProjectInstructions as unsupported", async () => {
    await expect(gemini().setProjectInstructions(GEM_PROJECT, "hi")).rejects.toThrow(
      UnsupportedOperationError,
    );
  });
});
