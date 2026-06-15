# NotebookLM Podcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-shot `aichatctl notebook create` command that creates a NotebookLM notebook, adds an ordered list of typed sources (files-as-text, inline text, and one-per-URL website sources), and kicks off a customized Audio Overview ("podcast").

**Architecture:** A standalone `NotebookLmDriver` (AppleScript transport, macOS-only — NotebookLM is **not** a chat `Platform`/`Driver`). Sources are normalized into an ordered `NotebookSource[]` by a pure SDK helper; a `createNotebookPodcast` service function orchestrates create → add-each → generate; a thin CLI command wires flags to it.

**Tech Stack:** TypeScript (NodeNext ESM, strict), pnpm workspace, vitest, Commander, `osascript` via the existing `evalInChromeTab` runner, `fast-glob` (existing SDK dep).

**Spec:** `docs/superpowers/specs/2026-06-14-notebooklm-podcast-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/sdk/src/drivers/notebooklm/types.ts` (create) | `AudioOverviewFormat`/`AudioOverviewLength`/`AudioOverviewOptions`, `NotebookSource`, UI label maps, parse helpers |
| `packages/sdk/src/drivers/notebooklm/sources.ts` (create) | `buildNotebookSources` — normalize files/text/urls → ordered `NotebookSource[]` (uses fast-glob, reads file contents) |
| `packages/sdk/src/drivers/notebooklm/driver.ts` (create) | `NotebookLmDriver` — `isLoggedIn`, `createNotebook`, `addTextSource`, `addUrlSource`, `generateAudioOverview` |
| `packages/sdk/src/service.ts` (modify) | `createNotebookPodcast` + option/result types |
| `packages/sdk/src/index.ts` (modify) | export the new types, driver, helper, service fn |
| `packages/cli/src/cli.ts` (modify) | `notebook create` command group |
| `packages/sdk/src/drivers/notebooklm/types.test.ts` (create) | label mapping + parse (positive + negative) |
| `packages/sdk/src/drivers/notebooklm/sources.test.ts` (create) | normalization, order, per-URL, empty, file read |
| `packages/sdk/src/service.notebook.test.ts` (create) | empty-sources guard (no browser) |
| `packages/cli/src/cli.test.ts` (modify) | notebook-command validation tests |
| `README.md`, `plugins/aichatctl/skills/aichatctl/SKILL.md` (modify) | docs |

---

## Task 1: NotebookLM types, label maps, and parse helpers

**Files:**
- Create: `packages/sdk/src/drivers/notebooklm/types.ts`
- Test: `packages/sdk/src/drivers/notebooklm/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * Tests for NotebookLM Audio Overview option types + UI label mapping.
 *
 * @see NotebookLM Audio Overview customize dialog (Format / Length controls)
 */
import { describe, expect, it } from "vitest";

import {
  AUDIO_FORMAT_LABEL,
  AUDIO_LENGTH_LABEL,
  parseAudioFormat,
  parseAudioLength,
} from "./types.js";

describe("audio overview label maps", () => {
  it("maps every format to its NotebookLM card label", () => {
    expect(AUDIO_FORMAT_LABEL).toEqual({
      "deep-dive": "Deep Dive",
      brief: "Brief",
      critique: "Critique",
      debate: "Debate",
    });
  });

  it("maps every length to its NotebookLM control label", () => {
    expect(AUDIO_LENGTH_LABEL).toEqual({ short: "Short", default: "Default", long: "Long" });
  });
});

describe("parseAudioFormat", () => {
  it("accepts each valid format", () => {
    expect(parseAudioFormat("deep-dive")).toBe("deep-dive");
    expect(parseAudioFormat("debate")).toBe("debate");
  });
  it("rejects an unknown format", () => {
    expect(() => parseAudioFormat("podcast")).toThrow(/deep-dive/);
  });
});

describe("parseAudioLength", () => {
  it("accepts each valid length", () => {
    expect(parseAudioLength("short")).toBe("short");
    expect(parseAudioLength("default")).toBe("default");
  });
  it("rejects an unknown length", () => {
    expect(() => parseAudioLength("medium")).toThrow(/short, default, long/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aichatctl/sdk exec vitest run src/drivers/notebooklm/types.test.ts`
Expected: FAIL — cannot find module `./types.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * NotebookLM Audio Overview ("podcast") option types, the UI labels they map to,
 * and the typed source model. NotebookLM is seed/generate-only (no projects),
 * so these types live with the driver rather than in the shared chat-`Platform`
 * types.
 *
 * @packageDocumentation
 */
import { AichatctlError } from "../../errors.js";

/** Audio Overview format ("podcast type") — the Format cards in the dialog. */
export type AudioOverviewFormat = "deep-dive" | "brief" | "critique" | "debate";

/** Audio Overview length control. */
export type AudioOverviewLength = "short" | "default" | "long";

/** Options for generating an Audio Overview. */
export interface AudioOverviewOptions {
  readonly format: AudioOverviewFormat;
  readonly length: AudioOverviewLength;
  /** Free-text "what should the AI hosts focus on in this episode?" (optional). */
  readonly prompt?: string;
}

/**
 * A source to add to a notebook.
 *
 * Reserved for later (interface-only this round): `"drive" | "youtube" | "upload"`.
 */
export type NotebookSource =
  | { readonly kind: "text"; readonly title?: string; readonly content: string }
  | { readonly kind: "url"; readonly url: string };

/** Format value → the clickable Format card label in the NotebookLM UI. */
export const AUDIO_FORMAT_LABEL: Readonly<Record<AudioOverviewFormat, string>> = {
  "deep-dive": "Deep Dive",
  brief: "Brief",
  critique: "Critique",
  debate: "Debate",
};

/** Length value → the Length control label in the NotebookLM UI. */
export const AUDIO_LENGTH_LABEL: Readonly<Record<AudioOverviewLength, string>> = {
  short: "Short",
  default: "Default",
  long: "Long",
};

/** Parses a CLI format string, throwing a usage-style error on an unknown value. */
export function parseAudioFormat(value: string): AudioOverviewFormat {
  if (value in AUDIO_FORMAT_LABEL) {
    return value as AudioOverviewFormat;
  }
  throw new AichatctlError(
    `format must be one of: ${Object.keys(AUDIO_FORMAT_LABEL).join(", ")}`,
  );
}

/** Parses a CLI length string, throwing a usage-style error on an unknown value. */
export function parseAudioLength(value: string): AudioOverviewLength {
  if (value in AUDIO_LENGTH_LABEL) {
    return value as AudioOverviewLength;
  }
  throw new AichatctlError(
    `length must be one of: ${Object.keys(AUDIO_LENGTH_LABEL).join(", ")}`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aichatctl/sdk exec vitest run src/drivers/notebooklm/types.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/drivers/notebooklm/types.ts packages/sdk/src/drivers/notebooklm/types.test.ts
git commit --author="Mike North <michael.l.north@gmail.com>" -m "feat(notebooklm): audio overview option types + label maps"
```

---

## Task 2: Source normalization (`buildNotebookSources`)

**Files:**
- Create: `packages/sdk/src/drivers/notebooklm/sources.ts`
- Test: `packages/sdk/src/drivers/notebooklm/sources.test.ts`

Behavior: expand each `--source` path (file → itself; directory → `**/*` files via fast-glob) reading UTF-8 content into `{ kind: "text", title: <basename>, content }`; `--source-text` → one `{ kind: "text", content }` (no title); each URL → `{ kind: "url", url }`. Order: files (glob order) → inline text → urls (input order).

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * Tests for NotebookLM source normalization.
 *
 * @see docs/superpowers/specs/2026-06-14-notebooklm-podcast-design.md (Source model)
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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

  it("throws when a --source path matches no files", () => {
    expect(() => buildNotebookSources({ files: ["/no/such/path-xyz"] })).toThrow(
      /no files/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aichatctl/sdk exec vitest run src/drivers/notebooklm/sources.test.ts`
Expected: FAIL — cannot find module `./sources.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Normalizes raw CLI source inputs (file/dir paths, inline text, URLs) into an
 * ordered, typed {@link NotebookSource} list the NotebookLM driver iterates.
 *
 * @packageDocumentation
 */
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import fg from "fast-glob";

import { AichatctlError } from "../../errors.js";
import type { NotebookSource } from "./types.js";

/** Raw inputs for {@link buildNotebookSources}. */
export interface BuildSourcesInput {
  /** `--source` paths: files used as-is, directories expanded to their files. */
  readonly files?: readonly string[];
  /** `--source-text` / stdin inline text (one source). */
  readonly text?: string;
  /** `--source-url` values (one source each, order preserved). */
  readonly urls?: readonly string[];
}

/** Expands a single path into concrete files (itself if a file, glob if a dir). */
function expandPath(path: string): string[] {
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {
    isDir = false;
  }
  if (isDir) {
    return fg.sync("**/*", { cwd: path, absolute: true, onlyFiles: true, dot: false });
  }
  const matches = fg.sync(path, { absolute: true, onlyFiles: true, dot: false });
  if (matches.length === 0) {
    throw new AichatctlError(`--source matched no files: ${path}`);
  }
  return matches;
}

/**
 * Builds the ordered source list: files (glob order) → inline text → URLs
 * (input order). Each file becomes a titled text source (title = basename);
 * inline text an untitled text source; each URL its own url source.
 */
export function buildNotebookSources(input: BuildSourcesInput): NotebookSource[] {
  const sources: NotebookSource[] = [];
  for (const path of input.files ?? []) {
    for (const file of expandPath(path)) {
      sources.push({ kind: "text", title: basename(file), content: readFileSync(file, "utf8") });
    }
  }
  if (input.text !== undefined && input.text.length > 0) {
    sources.push({ kind: "text", content: input.text });
  }
  for (const url of input.urls ?? []) {
    sources.push({ kind: "url", url });
  }
  return sources;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aichatctl/sdk exec vitest run src/drivers/notebooklm/sources.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/drivers/notebooklm/sources.ts packages/sdk/src/drivers/notebooklm/sources.test.ts
git commit --author="Mike North <michael.l.north@gmail.com>" -m "feat(notebooklm): normalize file/text/url inputs into ordered source list"
```

---

## Task 3: `NotebookLmDriver` (AppleScript)

**Files:**
- Create: `packages/sdk/src/drivers/notebooklm/driver.ts`

No unit test: every method drives the live UI via `osascript` (same as `AppleScriptDriver`'s osascript paths, which are UAT-covered, not unit-tested). The pure logic it depends on (label maps) is tested in Task 1. Verification here is `tsc` build + the live UAT in Task 8.

- [ ] **Step 1: Write the driver**

```typescript
import { evalInChromeTab } from "../../applescript/runner.js";
import { AichatctlError } from "../../errors.js";
import { AUDIO_FORMAT_LABEL, AUDIO_LENGTH_LABEL } from "./types.js";
import type { AudioOverviewOptions } from "./types.js";

const NB_HOST = "notebooklm.google.com";
const NB_HOME = "https://notebooklm.google.com/";
const NOTEBOOK_ID = /\/notebook\/([0-9a-f-]+)/i;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A NotebookLM notebook resolved from the URL after creation. */
export interface Notebook {
  readonly id: string;
  readonly url: string;
}

/**
 * Drives the user's real, logged-in Chrome to create a NotebookLM notebook, add
 * sources, and kick off an Audio Overview — via AppleScript (`osascript`), with
 * no extension. macOS-only; requires Chrome's "Allow JavaScript from Apple
 * Events". NotebookLM is not a chat platform, so this is a standalone driver
 * (it does not implement the chat `Driver` interface).
 */
export class NotebookLmDriver {
  /** Runs `jsBody` (which must `return` a JSON string) in the matched tab. */
  async #eval(matchUrl: string, createUrl: string, jsBody: string): Promise<unknown> {
    const js = `(function(){try{${jsBody}}catch(e){return JSON.stringify({__error:String((e&&e.message)||e)});}})()`;
    const out = await evalInChromeTab(js, { matchUrl, createUrl });
    let parsed: unknown;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new AichatctlError(`AppleScript returned non-JSON: ${out.slice(0, 200)}`);
    }
    if (parsed && typeof parsed === "object" && "__error" in parsed) {
      throw new AichatctlError(`page JS error: ${String(parsed.__error)}`);
    }
    return parsed;
  }

  #evalHome(jsBody: string): Promise<unknown> {
    return this.#eval(NB_HOST, NB_HOME, jsBody);
  }

  #evalNotebook(nb: Notebook, jsBody: string): Promise<unknown> {
    return this.#eval(`notebook/${nb.id}`, nb.url, jsBody);
  }

  public async isLoggedIn(): Promise<boolean> {
    const r = (await this.#evalHome(
      `return JSON.stringify({v: /notebooklm\\.google\\.com/.test(location.host) && (!!document.querySelector('button[aria-label="Create notebook"]') || Array.from(document.querySelectorAll('button')).some(function(b){return /create notebook/i.test(b.innerText||"");}))});`,
    )) as { v: boolean };
    return r.v;
  }

  /** Clicks "Create notebook" and returns the new notebook's id + URL. */
  public async createNotebook(): Promise<Notebook> {
    const clicked = (await this.#evalHome(`
      var b=document.querySelector('button[aria-label="Create notebook"]')||Array.from(document.querySelectorAll('button')).find(function(x){return /create notebook/i.test(x.innerText||"");});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!clicked.ok) throw new AichatctlError("NotebookLM 'Create notebook' not found (calibration).");
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const r = (await this.#evalHome(`return JSON.stringify({url:location.href});`)) as { url: string };
      const m = NOTEBOOK_ID.exec(r.url);
      if (m) {
        const id = m[1];
        return { id, url: `https://${NB_HOST}/notebook/${id}` };
      }
    }
    throw new AichatctlError("NotebookLM notebook did not open after Create (timed out).");
  }

  /** Opens the Add-source picker if it isn't already showing. */
  async #openSourcePicker(nb: Notebook): Promise<void> {
    await this.#evalNotebook(nb, `
      var hasPicker=Array.from(document.querySelectorAll('button,[role="button"]')).some(function(e){return /copied text/i.test(e.innerText||"");});
      if(!hasPicker){var add=document.querySelector('button[aria-label^="Add source"]')||Array.from(document.querySelectorAll('button')).find(function(b){return /add source/i.test(b.innerText||"");});if(add)add.click();}
      return JSON.stringify({ok:true});`);
    await sleep(900);
  }

  /** Fills a dialog textarea matching `placeholderRe` via the native setter + input event. */
  static #fillTextareaJs(placeholderRe: string, value: string): string {
    return `
      var dlg=document.querySelector('[role="dialog"]')||document;
      var tas=Array.from(dlg.querySelectorAll('textarea'));
      var ta=tas.find(function(t){return ${placeholderRe}.test((t.getAttribute("placeholder")||t.getAttribute("aria-label")||""));})||tas[0];
      if(!ta)return JSON.stringify({ok:false,why:"no textarea"});
      ta.focus();
      var d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value");d.set.call(ta,${JSON.stringify(value)});
      ta.dispatchEvent(new Event("input",{bubbles:true}));ta.dispatchEvent(new Event("change",{bubbles:true}));
      return JSON.stringify({ok:true});`;
  }

  /** Clicks the dialog "Insert" button, then waits for the dialog to close. */
  async #insertAndSettle(nb: Notebook): Promise<void> {
    const clicked = (await this.#evalNotebook(nb, `
      var dlg=document.querySelector('[role="dialog"]')||document;
      var b=Array.from(dlg.querySelectorAll('button')).find(function(x){return /^insert$/i.test((x.innerText||"").trim());});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!clicked.ok) throw new AichatctlError("NotebookLM 'Insert' not found (calibration).");
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const r = (await this.#evalNotebook(nb, `
        var open=Array.from(document.querySelectorAll('button')).some(function(x){return /^insert$/i.test((x.innerText||"").trim());});
        return JSON.stringify({open:open});`)) as { open: boolean };
      if (!r.open) return;
    }
    throw new AichatctlError("NotebookLM source add did not complete (Insert dialog stayed open — possible source limit).");
  }

  /** Adds one "Copied text" source. */
  public async addTextSource(nb: Notebook, content: string): Promise<void> {
    await this.#openSourcePicker(nb);
    const opened = (await this.#evalNotebook(nb, `
      var el=Array.from(document.querySelectorAll('button,[role="button"]')).find(function(e){return /copied text/i.test(e.innerText||"");});
      if(!el)return JSON.stringify({ok:false});
      el.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!opened.ok) throw new AichatctlError("NotebookLM 'Copied text' option not found (calibration).");
    await sleep(700);
    const filled = (await this.#evalNotebook(
      nb,
      NotebookLmDriver.#fillTextareaJs("/paste text/i", content),
    )) as { ok: boolean; why?: string };
    if (!filled.ok) throw new AichatctlError(`NotebookLM text paste failed: ${filled.why ?? "unknown"}`);
    await this.#insertAndSettle(nb);
  }

  /** Adds one "Websites" source (a single URL → one distinct document source). */
  public async addUrlSource(nb: Notebook, url: string): Promise<void> {
    await this.#openSourcePicker(nb);
    const opened = (await this.#evalNotebook(nb, `
      var el=Array.from(document.querySelectorAll('button,[role="button"]')).find(function(e){return /website/i.test(e.innerText||"");});
      if(!el)return JSON.stringify({ok:false});
      el.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!opened.ok) throw new AichatctlError("NotebookLM 'Websites' option not found (calibration).");
    await sleep(700);
    const filled = (await this.#evalNotebook(
      nb,
      NotebookLmDriver.#fillTextareaJs("/paste any links/i", url),
    )) as { ok: boolean; why?: string };
    if (!filled.ok) throw new AichatctlError(`NotebookLM URL paste failed: ${filled.why ?? "unknown"}`);
    await this.#insertAndSettle(nb);
  }

  /** Opens "Customize Audio Overview", sets format/length/prompt, and clicks Generate. */
  public async generateAudioOverview(nb: Notebook, opts: AudioOverviewOptions): Promise<void> {
    const open = (await this.#evalNotebook(nb, `
      var b=document.querySelector('button[aria-label="Customize Audio Overview"]')||Array.from(document.querySelectorAll('button')).find(function(x){return /customize audio overview/i.test(x.getAttribute("aria-label")||"");});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!open.ok) throw new AichatctlError("NotebookLM 'Customize Audio Overview' not found (calibration).");
    await sleep(1200);

    const formatLabel = AUDIO_FORMAT_LABEL[opts.format];
    const fmt = (await this.#evalNotebook(nb, `
      var dlg=document.querySelector('[role="dialog"]')||document;
      var el=Array.from(dlg.querySelectorAll('button,[role="radio"],[role="option"],[role="button"]')).find(function(e){return (e.innerText||"").trim().indexOf(${JSON.stringify(formatLabel)})===0;});
      if(!el)return JSON.stringify({ok:false});
      el.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!fmt.ok) throw new AichatctlError(`NotebookLM format "${formatLabel}" not found (calibration).`);
    await sleep(400);

    const lengthLabel = AUDIO_LENGTH_LABEL[opts.length];
    const len = (await this.#evalNotebook(nb, `
      var dlg=document.querySelector('[role="dialog"]')||document;
      var el=Array.from(dlg.querySelectorAll('button,[role="radio"],[role="option"],[role="button"]')).find(function(e){return (e.innerText||"").trim()===${JSON.stringify(lengthLabel)};});
      if(!el)return JSON.stringify({ok:false});
      el.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!len.ok) throw new AichatctlError(`NotebookLM length "${lengthLabel}" not found (calibration).`);
    await sleep(300);

    if (opts.prompt !== undefined && opts.prompt.length > 0) {
      await this.#evalNotebook(nb, NotebookLmDriver.#fillTextareaJs("/focus|things to try/i", opts.prompt));
      await sleep(300);
    }

    const gen = (await this.#evalNotebook(nb, `
      var dlg=document.querySelector('[role="dialog"]')||document;
      var b=Array.from(dlg.querySelectorAll('button')).find(function(x){return /^generate$/i.test((x.innerText||"").trim());});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!gen.ok) throw new AichatctlError("NotebookLM 'Generate' not found (calibration).");
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: succeeds (no `tsc` errors).

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/drivers/notebooklm/driver.ts
git commit --author="Mike North <michael.l.north@gmail.com>" -m "feat(notebooklm): AppleScript driver for create/add-source/generate"
```

---

## Task 4: `createNotebookPodcast` service function

**Files:**
- Modify: `packages/sdk/src/service.ts`
- Test: `packages/sdk/src/service.notebook.test.ts`

- [ ] **Step 1: Write the failing test (empty-sources guard — no browser)**

```typescript
/**
 * Tests for the createNotebookPodcast guard that runs before any browser work.
 *
 * @see docs/superpowers/specs/2026-06-14-notebooklm-podcast-design.md
 */
import { describe, expect, it } from "vitest";

import { createNotebookPodcast } from "./service.js";

describe("createNotebookPodcast", () => {
  it("rejects an empty source list before touching the browser", async () => {
    await expect(
      createNotebookPodcast({
        sources: [],
        audio: { format: "deep-dive", length: "default" },
      }),
    ).rejects.toThrow(/at least one source/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aichatctl/sdk exec vitest run src/service.notebook.test.ts`
Expected: FAIL — `createNotebookPodcast` is not exported.

- [ ] **Step 3: Add the imports to `packages/sdk/src/service.ts`**

Add to the existing import block (after the `AppleScriptDriver` import near the top):

```typescript
import { NotebookLmDriver } from "./drivers/notebooklm/driver.js";
import type { AudioOverviewOptions, NotebookSource } from "./drivers/notebooklm/types.js";
```

- [ ] **Step 4: Append the service function at the end of `packages/sdk/src/service.ts`**

```typescript
/** Options for {@link createNotebookPodcast}. */
export interface CreateNotebookPodcastOptions {
  /** Optional notebook title (NotebookLM auto-titles from content if omitted). */
  readonly title?: string;
  /** Ordered, normalized source list (build with `buildNotebookSources`). */
  readonly sources: readonly NotebookSource[];
  /** Audio Overview format/length/prompt. */
  readonly audio: AudioOverviewOptions;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/** Result of {@link createNotebookPodcast}. */
export interface NotebookPodcastResult {
  readonly url: string;
  readonly notebookId: string;
  readonly sourcesAdded: number;
  readonly podcastKicked: boolean;
}

/**
 * Creates a NotebookLM notebook, adds the given sources (one insert each — URLs
 * become distinct document sources), and kicks off an Audio Overview. Returns
 * once generation is kicked off; it does not wait for the (minutes-long) render.
 * AppleScript transport only (NotebookLM is a Google product; macOS-only).
 */
export async function createNotebookPodcast(
  options: CreateNotebookPodcastOptions,
): Promise<NotebookPodcastResult> {
  if (options.sources.length === 0) {
    throw new AichatctlError("Provide at least one source (--source, --source-url, or --source-text).");
  }
  const driver = new NotebookLmDriver();
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  const notebook = await driver.createNotebook();
  let sourcesAdded = 0;
  for (const source of options.sources) {
    if (source.kind === "text") {
      const body = source.title !== undefined ? `# ${source.title}\n\n${source.content}` : source.content;
      await driver.addTextSource(notebook, body);
    } else {
      await driver.addUrlSource(notebook, source.url);
    }
    sourcesAdded += 1;
  }
  await driver.generateAudioOverview(notebook, options.audio);
  return { url: notebook.url, notebookId: notebook.id, sourcesAdded, podcastKicked: true };
}
```

Note: `AichatctlError` and `NotLoggedInError` are already imported in `service.ts`. If `AichatctlError` is not in the existing import, add it to the `./errors.js` import line.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @aichatctl/sdk exec vitest run src/service.notebook.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/service.ts packages/sdk/src/service.notebook.test.ts
git commit --author="Mike North <michael.l.north@gmail.com>" -m "feat(notebooklm): createNotebookPodcast orchestration service"
```

---

## Task 5: Export from the SDK barrel

**Files:**
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Add exports after the `AppleScriptDriver` export line**

```typescript
export { NotebookLmDriver } from "./drivers/notebooklm/driver.js";
export type { Notebook } from "./drivers/notebooklm/driver.js";
export {
  AUDIO_FORMAT_LABEL,
  AUDIO_LENGTH_LABEL,
  parseAudioFormat,
  parseAudioLength,
} from "./drivers/notebooklm/types.js";
export type {
  AudioOverviewFormat,
  AudioOverviewLength,
  AudioOverviewOptions,
  NotebookSource,
} from "./drivers/notebooklm/types.js";
export { buildNotebookSources } from "./drivers/notebooklm/sources.js";
export type { BuildSourcesInput } from "./drivers/notebooklm/sources.js";
```

(`createNotebookPodcast` and its types are already re-exported via `export * from "./service.js";`.)

- [ ] **Step 2: Regenerate the API report**

Run: `pnpm api`
Expected: `api-extractor` updates `packages/sdk/api-report/sdk.api.md` (new exports), `api-documenter` regenerates `docs/`.

- [ ] **Step 3: Build to verify**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/index.ts packages/sdk/api-report/sdk.api.md docs/
git commit --author="Mike North <michael.l.north@gmail.com>" -m "feat(notebooklm): export driver, types, and source helper from SDK"
```

---

## Task 6: CLI `notebook create` command

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/src/cli.test.ts`

- [ ] **Step 1: Write the failing tests (add to the existing `describe("run", ...)` block)**

```typescript
  it("rejects notebook create with no sources", async () => {
    const { io, err } = captureIO();
    const code = await run(
      argv("notebook", "create", "--format", "deep-dive", "--length", "default"),
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/at least one source/i);
  });

  it("rejects an unknown --format as a usage error", async () => {
    const { io, err } = captureIO();
    const code = await run(
      argv("notebook", "create", "--source-text", "hi", "--format", "podcast"),
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/deep-dive/);
  });

  it("rejects a non-applescript transport for notebook create", async () => {
    const { io, err } = captureIO();
    const code = await run(
      argv("notebook", "create", "--source-text", "hi", "--transport", "cdp"),
      io,
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/AppleScript transport/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter aichatctl exec vitest run src/cli.test.ts`
Expected: FAIL — `notebook` is not a known command (Commander usage error gives a non-matching message / wrong exit reason).

- [ ] **Step 3: Add imports to `packages/cli/src/cli.ts`**

Add to the `@aichatctl/sdk` import block:

```typescript
  buildNotebookSources,
  createNotebookPodcast,
  parseAudioFormat,
  parseAudioLength,
```

And add the value-import (Commander helper) — `collect` is defined locally below, no new import needed.

- [ ] **Step 4: Add a repeatable-option collector helper near `parseTransport`**

```typescript
/** Commander reducer: accumulate a repeatable option into an array. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
```

- [ ] **Step 5: Register the command (before `return program;` in `buildProgram`)**

```typescript
  // notebook create ------------------------------------------------------------
  const notebook = program.command("notebook").description("Create NotebookLM notebooks + podcasts");
  notebook
    .command("create")
    .description("Create a notebook, add sources, and kick off an Audio Overview (podcast)")
    .option("--source <path>", "file or directory to add as a source (repeatable)", collect, [])
    .option("--source-url <url>", "URL to add as its own source (repeatable)", collect, [])
    .option("--source-text <text>", 'inline text source ("-" reads stdin)')
    .option("--title <name>", "optional notebook title")
    .option("--format <format>", "deep-dive | brief | critique | debate", "deep-dive")
    .option("--length <length>", "short | default | long", "default")
    .option("--prompt <text>", "what the AI hosts should focus on")
    .option("--prompt-file <path>", 'read the host-focus prompt from a file ("-" for stdin)')
    .option("--transport <t>", "applescript (only)", parseTransport, "applescript")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: {
        source: string[];
        sourceUrl: string[];
        sourceText?: string;
        title?: string;
        format: string;
        length: string;
        prompt?: string;
        promptFile?: string;
        transport: Transport;
        json: boolean;
      }) => {
        if (opts.transport !== "applescript") {
          throw new AichatctlError(
            "NotebookLM is supported only via the AppleScript transport. Re-run with --transport applescript.",
          );
        }
        const format = parseAudioFormat(opts.format);
        const length = parseAudioLength(opts.length);
        const text =
          opts.sourceText === "-" ? readPromptSource("-") : opts.sourceText;
        const sources = buildNotebookSources({
          files: opts.source,
          urls: opts.sourceUrl,
          ...(text !== undefined ? { text } : {}),
        });
        if (sources.length === 0) {
          throw new AichatctlError(
            "Provide at least one source: --source, --source-url, or --source-text.",
          );
        }
        const prompt =
          opts.promptFile !== undefined ? readPromptSource(opts.promptFile) : opts.prompt;
        const result = await createNotebookPodcast({
          sources,
          audio: { format, length, ...(prompt !== undefined ? { prompt } : {}) },
          ...(opts.title !== undefined ? { title: opts.title } : {}),
        });
        emit(
          io,
          opts.json,
          `Created notebook + kicked off ${format} podcast: ${result.url}`,
          result,
        );
      },
    );
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter aichatctl exec vitest run src/cli.test.ts`
Expected: PASS (existing tests + 3 new).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/cli.test.ts
git commit --author="Mike North <michael.l.north@gmail.com>" -m "feat(notebooklm): add 'notebook create' CLI command"
```

---

## Task 7: Docs (README + skill)

**Files:**
- Modify: `README.md`
- Modify: `plugins/aichatctl/skills/aichatctl/SKILL.md`

- [ ] **Step 1: Add a NotebookLM section to `README.md`**

Insert after the "Usage" section (before "How it works"):

````markdown
## NotebookLM podcasts

Create a NotebookLM notebook from local files and/or URLs and kick off a
customized Audio Overview ("podcast") — then open the notebook on mobile to
listen once it finishes rendering. AppleScript transport only (NotebookLM is a
Google product; macOS).

```bash
aichatctl notebook create \
  --source docs/specs --source README.md \
  --source-url https://docs.google.com/document/d/<id> \
  --format deep-dive --length default \
  --prompt "Focus on the migration plan for someone new to the codebase" --json
```

Each `--source` file (directories expand to their files) becomes a pasted text
source; each `--source-url` becomes its **own** website source (so a Google Doc
URL lands as that document). Formats: `deep-dive` (default), `brief`, `critique`,
`debate`. Lengths: `short`, `default`, `long`. The command returns the notebook
`url` once generation is kicked off — it does not wait for the audio to render.
````

- [ ] **Step 2: Add a "Use case 3" entry to `SKILL.md`** (after Use case 2)

```markdown
## Use case 3 — NotebookLM podcast (macOS / AppleScript)

Create a notebook from sources and start an Audio Overview the user can listen to
on mobile. You compose the host-focus prompt; the CLI does the mechanics.

```bash
aichatctl notebook create --transport applescript \
  --source <file-or-dir>... --source-url <url>... \
  --format deep-dive --length default --prompt "<focus for the hosts>" --json
```

Each file is added as a text source and each URL as its own website source.
Returns the notebook `url` once the podcast generation is kicked off (the audio
renders in the background — give the user the URL to open later).
```

- [ ] **Step 3: Commit**

```bash
git add README.md plugins/aichatctl/skills/aichatctl/SKILL.md
git commit --author="Mike North <michael.l.north@gmail.com>" -m "docs(notebooklm): document notebook create command + skill use case"
```

---

## Task 8: Clean verification + live UAT

**Files:** none (verification only)

- [ ] **Step 1: Clean build/lint/test**

Run: `pnpm clean && pnpm build && pnpm lint && pnpm test`
Expected: all pass; new tests from Tasks 1, 2, 4, 6 included.

- [ ] **Step 2: Live UAT (manual, requires a logged-in NotebookLM + Apple Events toggle)**

Run:
```bash
printf 'aichatctl turns repo files into a NotebookLM podcast.' > /tmp/nlm-uat.md
node packages/cli/dist/bin.js notebook create \
  --source /tmp/nlm-uat.md \
  --source-url https://example.com \
  --format brief --length short \
  --prompt "Keep it under two minutes; explain to a newcomer" --json
```
Expected: JSON with a `notebook/<id>` `url`, `sourcesAdded: 2`, `podcastKicked: true`. Open the URL in Chrome and confirm: two sources are present (the text file + example.com as distinct sources) and the Studio panel shows an Audio Overview generating/loading card.

- [ ] **Step 3: Report results** — note the notebook URL and that both sources landed distinctly and generation started. If any UI control wasn't found (calibration error), record which one for a selector fix.

---

## Self-Review notes

- **Spec coverage:** create notebook (Task 3 `createNotebook` + Task 4) ✓; typed ordered source list (Task 1 `NotebookSource`, Task 2 `buildNotebookSources`) ✓; one insert per source incl. per-URL distinct (Task 3 `addUrlSource`, Task 4 loop) ✓; per-source settle/verify (Task 3 `#insertAndSettle`) ✓; format/length/prompt customize + Generate (Task 3 `generateAudioOverview`) ✓; defaults deep-dive/default (Task 6 option defaults) ✓; AppleScript-only guard + login check + empty guard (Tasks 4, 6) ✓; kicked-not-waited (Task 4 returns after Generate) ✓; CLI one-shot (Task 6) ✓; tests + UAT (Tasks 1,2,4,6,8) ✓; docs (Task 7) ✓.
- **Type consistency:** `NotebookSource`, `AudioOverviewOptions`, `Notebook`, `createNotebookPodcast`, `buildNotebookSources`, `parseAudioFormat`/`parseAudioLength` names are used identically across tasks.
- **Limit-awareness:** surfaced via `#insertAndSettle` timeout error message (Task 3) rather than a separate code path.
