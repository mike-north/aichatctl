import type { SyncState } from "./state.js";

/** What to do with a single file during a sync. */
export type SyncAction = "upload" | "replace" | "delete" | "noop";

/** A single planned operation against the project library. */
export interface SyncStep {
  readonly action: SyncAction;
  /** Remote file name the step applies to. */
  readonly name: string;
  /** Human-readable justification (shown in --dry-run). */
  readonly reason: string;
}

/** A local file selected for sync: its remote name and current content hash. */
export interface DesiredFile {
  readonly name: string;
  readonly hash: string;
}

/** Inputs to {@link computePlan}. */
export interface PlanInput {
  /** Local files that should be present in the library. */
  readonly desired: readonly DesiredFile[];
  /** Last-synced state (the drift oracle). */
  readonly state: SyncState;
  /**
   * Names currently observed in the remote library, when available. Enables
   * baseline reconciliation on first run and avoids no-op deletes. When
   * omitted, the plan is computed from desired-vs-state alone.
   */
  readonly remoteNames?: readonly string[] | undefined;
}

/**
 * Computes the set of operations to reconcile a project's file library with the
 * desired local files.
 *
 * Policy: aichatctl only manages files it has previously synced (tracked in
 * {@link SyncState}). Files a user added manually in the web UI are never
 * deleted — only tracked files that have dropped out of the manifest are.
 *
 * Drift is detected via content hashes because the web UIs expose no way to
 * read uploaded file content back.
 */
export function computePlan(input: PlanInput): SyncStep[] {
  const { desired, state } = input;
  const remote = input.remoteNames ? new Set(input.remoteNames) : undefined;
  const steps: SyncStep[] = [];
  const desiredNames = new Set(desired.map((d) => d.name));

  for (const file of desired) {
    const prevHash = state.files[file.name];
    if (prevHash === undefined) {
      // Not previously synced by us.
      if (remote?.has(file.name)) {
        steps.push({
          action: "replace",
          name: file.name,
          reason: "untracked remote copy exists; refreshing to match source of truth",
        });
      } else {
        steps.push({ action: "upload", name: file.name, reason: "new file" });
      }
      continue;
    }
    if (prevHash !== file.hash) {
      steps.push({ action: "replace", name: file.name, reason: "content changed since last sync" });
      continue;
    }
    // Hash unchanged. If we know it is missing remotely, re-upload it.
    if (remote && !remote.has(file.name)) {
      steps.push({
        action: "upload",
        name: file.name,
        reason: "tracked but missing from remote library",
      });
      continue;
    }
    steps.push({ action: "noop", name: file.name, reason: "unchanged" });
  }

  // Tracked files no longer desired -> delete (unless already absent remotely).
  for (const name of Object.keys(state.files)) {
    if (desiredNames.has(name)) {
      continue;
    }
    if (remote && !remote.has(name)) {
      steps.push({ action: "noop", name, reason: "removed from manifest; already absent remotely" });
    } else {
      steps.push({ action: "delete", name, reason: "removed from manifest" });
    }
  }

  return steps;
}

/** True when a plan contains at least one mutating step. */
export function planHasChanges(steps: readonly SyncStep[]): boolean {
  return steps.some((s) => s.action !== "noop");
}
