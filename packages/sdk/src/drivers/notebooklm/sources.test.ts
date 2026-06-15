/**
 * Tests for NotebookLM source normalization.
 *
 * @see docs/superpowers/specs/2026-06-14-notebooklm-podcast-design.md (Source model)
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildNotebookSources } from "./sources.js";

let dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "nlm-src-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("buildNotebookSources", () => {
  it("turns a file into a titled text source", () => {
    const d = tmp();
    writeFileSync(join(d, "spec.md"), "# Spec\nbody", "utf8");
    const out = buildNotebookSources({ files: [join(d, "spec.md")] });
    expect(out).toEqual([{ kind: "text", title: "spec.md", content: "# Spec\nbody" }]);
  });

  it("expands a directory into one text source per file (glob order)", () => {
    const d = tmp();
    writeFileSync(join(d, "a.md"), "AAA", "utf8");
    mkdirSync(join(d, "sub"));
    writeFileSync(join(d, "sub", "b.txt"), "BBB", "utf8");
    const out = buildNotebookSources({ files: [d] });
    expect(out.map((s) => s.kind)).toEqual(["text", "text"]);
    expect(out.map((s) => (s.kind === "text" ? s.title : ""))).toEqual(["a.md", "b.txt"]);
  });

  it("adds inline text as one untitled text source", () => {
    const out = buildNotebookSources({ text: "an agent brief" });
    expect(out).toEqual([{ kind: "text", content: "an agent brief" }]);
  });

  it("adds each URL as its own url source, preserving order", () => {
    const out = buildNotebookSources({
      urls: ["https://docs.google.com/document/d/1", "https://example.com"],
    });
    expect(out).toEqual([
      { kind: "url", url: "https://docs.google.com/document/d/1" },
      { kind: "url", url: "https://example.com" },
    ]);
  });

  it("orders files, then inline text, then urls", () => {
    const d = tmp();
    writeFileSync(join(d, "f.md"), "F", "utf8");
    const out = buildNotebookSources({
      files: [join(d, "f.md")],
      text: "T",
      urls: ["https://x.test"],
    });
    expect(out.map((s) => s.kind)).toEqual(["text", "text", "url"]);
    expect(out[2]).toEqual({ kind: "url", url: "https://x.test" });
  });

  it("returns an empty list when nothing is provided", () => {
    expect(buildNotebookSources({})).toEqual([]);
  });

  it("treats empty-string text as no source", () => {
    expect(buildNotebookSources({ text: "" })).toEqual([]);
  });

  it("throws when a --source path matches no files", () => {
    expect(() => buildNotebookSources({ files: ["/no/such/path-xyz"] })).toThrow(
      /no files/i,
    );
  });
});
