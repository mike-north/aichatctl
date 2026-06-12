import { mkdtempSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { defaultStatePath, loadState, saveState } from "./state.js";

describe("sync state", () => {
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aichatctl-state-"));
    statePath = join(dir, "state.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty state when nothing has been saved", () => {
    expect(loadState(statePath, "claude", "p1")).toEqual({ files: {} });
  });

  it("round-trips a saved state for one (platform, project)", () => {
    saveState(statePath, "claude", "p1", { files: { "a.md": "h1" }, instructions: "hi" });
    expect(loadState(statePath, "claude", "p1")).toEqual({
      files: { "a.md": "h1" },
      instructions: "hi",
    });
  });

  it("keeps entries for other projects/platforms independent", () => {
    saveState(statePath, "claude", "p1", { files: { "a.md": "h1" } });
    saveState(statePath, "chatgpt", "p2", { files: { "b.md": "h2" } });
    expect(loadState(statePath, "claude", "p1").files).toEqual({ "a.md": "h1" });
    expect(loadState(statePath, "chatgpt", "p2").files).toEqual({ "b.md": "h2" });
  });

  it("treats a corrupt state file as empty rather than throwing", () => {
    writeFileSync(statePath, "{ not json", "utf8");
    expect(loadState(statePath, "claude", "p1")).toEqual({ files: {} });
  });

  it("derives a default state path under .aichatctl", () => {
    expect(defaultStatePath("/repo")).toBe(join("/repo", ".aichatctl", "state.json"));
  });
});
