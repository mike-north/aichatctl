import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Platform } from "../types.js";

/** Last-synced state for one (platform, project): remote file name to content hash. */
export interface SyncState {
  readonly files: Record<string, string>;
  /** Content hash of the instructions last pushed, if instructions are managed. */
  readonly instructions?: string;
}

const STATE_VERSION = 1 as const;

interface StateFile {
  readonly version: number;
  readonly entries: Record<string, SyncState>;
}

/** Default location of the sync-state file within a project base directory. */
export function defaultStatePath(baseDir: string): string {
  return join(baseDir, ".aichatctl", "state.json");
}

function entryKey(platform: Platform, projectId: string): string {
  return `${platform}:${projectId}`;
}

function emptyStateFile(): StateFile {
  return { version: STATE_VERSION, entries: {} };
}

function readStateFile(path: string): StateFile {
  if (!existsSync(path)) {
    return emptyStateFile();
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "entries" in parsed &&
      typeof parsed.entries === "object" &&
      parsed.entries !== null
    ) {
      return parsed as StateFile;
    }
  } catch {
    // Corrupt state file: treat as empty rather than failing the sync.
  }
  return emptyStateFile();
}

/** Reads the persisted state for a single (platform, project). */
export function loadState(path: string, platform: Platform, projectId: string): SyncState {
  const file = readStateFile(path);
  return file.entries[entryKey(platform, projectId)] ?? { files: {} };
}

/** Persists the state for a single (platform, project), preserving other entries. */
export function saveState(
  path: string,
  platform: Platform,
  projectId: string,
  state: SyncState,
): void {
  const file = readStateFile(path);
  const next: StateFile = {
    version: STATE_VERSION,
    entries: { ...file.entries, [entryKey(platform, projectId)]: state },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
