import { basename } from "node:path";

import fg from "fast-glob";

import { ConfigError } from "../errors.js";
import { hashFile } from "./hash.js";
import type { DesiredFile } from "./plan.js";

/** A local file resolved from the manifest globs. */
export interface ResolvedFile extends DesiredFile {
  /** Absolute path on disk. */
  readonly localPath: string;
}

/**
 * Expands manifest globs (relative to `baseDir`) into a deduplicated, hashed
 * list of files. The remote name is the file's basename; basename collisions
 * across different paths are a configuration error.
 */
export function resolveDesiredFiles(globs: readonly string[], baseDir: string): ResolvedFile[] {
  const matches = fg.sync([...globs], {
    cwd: baseDir,
    absolute: true,
    dot: false,
    onlyFiles: true,
    unique: true,
  });

  const byName = new Map<string, ResolvedFile>();
  for (const localPath of matches) {
    const name = basename(localPath);
    const existing = byName.get(name);
    if (existing && existing.localPath !== localPath) {
      throw new ConfigError(
        `Two files map to the same library name "${name}":\n` +
          `  - ${existing.localPath}\n  - ${localPath}\n` +
          `Web project libraries are flat; rename one or narrow the globs.`,
      );
    }
    byName.set(name, { localPath, name, hash: hashFile(localPath) });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
