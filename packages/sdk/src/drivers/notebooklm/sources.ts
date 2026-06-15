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
  } catch (e) {
    // ENOENT just means it isn't a literal path (e.g. a glob) — let fg.sync resolve it.
    // Anything else (permissions, etc.) is a real error worth surfacing.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    isDir = false;
  }
  if (isDir) {
    // Sorted for deterministic ordering across platforms/filesystems.
    return fg.sync("**/*", { cwd: path, absolute: true, onlyFiles: true, dot: false }).sort();
  }
  // Sorted for deterministic ordering across platforms/filesystems.
  const matches = fg.sync(path, { absolute: true, onlyFiles: true, dot: false }).sort();
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
  // Empty-string text is intentionally treated as "no source" — it adds nothing useful.
  if (input.text !== undefined && input.text.length > 0) {
    sources.push({ kind: "text", content: input.text });
  }
  for (const url of input.urls ?? []) {
    sources.push({ kind: "url", url });
  }
  return sources;
}
