/**
 * Tests for the sync diff engine.
 *
 * Assertions trace to the documented sync policy in plan.ts:
 *  - new local file (not in state)          -> upload
 *  - in state, hash changed                 -> replace
 *  - in state, hash same                    -> noop
 *  - tracked file dropped from manifest      -> delete
 *  - untracked remote copy of a desired file -> replace (refresh to source of truth)
 *  - manually-added remote files (not tracked, not desired) -> never touched
 */
import { describe, expect, it } from "@jest/globals";

import { computePlan, planHasChanges } from "./plan.js";
import type { DesiredFile } from "./plan.js";
import type { SyncState } from "./state.js";

const file = (name: string, hash: string): DesiredFile => ({ name, hash });
const state = (files: Record<string, string>): SyncState => ({ files });

describe("computePlan", () => {
  it("uploads a new file absent from state and remote", () => {
    const steps = computePlan({
      desired: [file("spec.md", "h1")],
      state: state({}),
      remoteNames: [],
    });
    expect(steps).toEqual([{ action: "upload", name: "spec.md", reason: "new file" }]);
  });

  it("no-ops an unchanged, present file", () => {
    const steps = computePlan({
      desired: [file("spec.md", "h1")],
      state: state({ "spec.md": "h1" }),
      remoteNames: ["spec.md"],
    });
    expect(steps.map((s) => s.action)).toEqual(["noop"]);
  });

  it("replaces a file whose content hash changed", () => {
    const steps = computePlan({
      desired: [file("spec.md", "h2")],
      state: state({ "spec.md": "h1" }),
      remoteNames: ["spec.md"],
    });
    expect(steps[0]?.action).toBe("replace");
    expect(steps[0]?.reason).toMatch(/changed/);
  });

  it("deletes a tracked file that dropped out of the manifest", () => {
    const steps = computePlan({
      desired: [],
      state: state({ "old.md": "h1" }),
      remoteNames: ["old.md"],
    });
    expect(steps).toEqual([{ action: "delete", name: "old.md", reason: "removed from manifest" }]);
  });

  it("re-uploads a tracked-but-unchanged file that is missing remotely", () => {
    const steps = computePlan({
      desired: [file("spec.md", "h1")],
      state: state({ "spec.md": "h1" }),
      remoteNames: [],
    });
    expect(steps[0]?.action).toBe("upload");
    expect(steps[0]?.reason).toMatch(/missing from remote/);
  });

  it("refreshes an untracked remote copy of a desired file (baseline reconciliation)", () => {
    const steps = computePlan({
      desired: [file("spec.md", "h1")],
      state: state({}),
      remoteNames: ["spec.md"],
    });
    expect(steps[0]?.action).toBe("replace");
    expect(steps[0]?.reason).toMatch(/untracked remote copy/);
  });

  it("never deletes a manually-added remote file it does not track", () => {
    const steps = computePlan({
      desired: [file("spec.md", "h1")],
      state: state({ "spec.md": "h1" }),
      remoteNames: ["spec.md", "user-upload.pdf"],
    });
    expect(steps.some((s) => s.name === "user-upload.pdf")).toBe(false);
  });

  it("no-ops a manifest deletion that is already absent remotely", () => {
    const steps = computePlan({
      desired: [],
      state: state({ "old.md": "h1" }),
      remoteNames: [],
    });
    expect(steps[0]?.action).toBe("noop");
    expect(steps[0]?.reason).toMatch(/already absent/);
  });

  it("treats every new file as an upload when remoteNames is omitted", () => {
    const steps = computePlan({
      desired: [file("a.md", "h1"), file("b.md", "h2")],
      state: state({}),
    });
    expect(steps.every((s) => s.action === "upload")).toBe(true);
  });
});

describe("planHasChanges", () => {
  it("is false when every step is a noop", () => {
    expect(planHasChanges([{ action: "noop", name: "x", reason: "unchanged" }])).toBe(false);
  });

  it("is true when any step mutates", () => {
    expect(
      planHasChanges([
        { action: "noop", name: "x", reason: "unchanged" },
        { action: "upload", name: "y", reason: "new file" },
      ]),
    ).toBe(true);
  });
});
