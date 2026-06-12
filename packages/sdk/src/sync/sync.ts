import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { Driver } from "../drivers/driver.js";
import type { Platform, Project } from "../types.js";
import { resolveDesiredFiles } from "./files.js";
import { hashContent } from "./hash.js";
import type { PlatformManifest } from "./manifest.js";
import { computePlan } from "./plan.js";
import type { SyncStep } from "./plan.js";
import { defaultStatePath, loadState, saveState } from "./state.js";
import type { SyncState } from "./state.js";

/** Options controlling a platform sync. */
export interface SyncOptions {
  /** Directory the manifest's relative globs/paths resolve against. */
  readonly baseDir: string;
  /** When true, compute the plan but make no changes. */
  readonly dryRun: boolean;
  /** Override the sync-state file location. */
  readonly statePath?: string;
}

/** Planned disposition of the project instructions. */
export interface InstructionsPlan {
  readonly managed: boolean;
  readonly willUpdate: boolean;
  readonly reason: string;
}

/** Outcome of syncing one platform. */
export interface SyncReport {
  readonly platform: Platform;
  readonly project: Project;
  readonly steps: SyncStep[];
  readonly instructions: InstructionsPlan;
  /** True when changes were actually written (false for dry runs). */
  readonly applied: boolean;
}

function readInstructions(entry: PlatformManifest, baseDir: string): string | undefined {
  if (entry.instructions === undefined) {
    return undefined;
  }
  const path = isAbsolute(entry.instructions)
    ? entry.instructions
    : resolve(baseDir, entry.instructions);
  return readFileSync(path, "utf8");
}

/**
 * Reconciles a project's file library (and optionally its instructions) with
 * the local source of truth declared in the manifest.
 *
 * Read-only work (resolving the project, listing remote files, computing the
 * plan) always runs; mutations run only when {@link SyncOptions.dryRun} is false.
 */
export async function syncPlatform(
  driver: Driver,
  entry: PlatformManifest,
  options: SyncOptions,
): Promise<SyncReport> {
  const project = await driver.resolveProject(entry.project);
  const desired = resolveDesiredFiles(entry.files, options.baseDir);
  const statePath = options.statePath ?? defaultStatePath(options.baseDir);
  const state = loadState(statePath, driver.platform, project.id);

  const remoteNames = (await driver.getProjectFiles(project)).map((f) => f.name);
  const steps = computePlan({ desired, state, remoteNames });

  const instructionsText = readInstructions(entry, options.baseDir);
  const instructionsHash =
    instructionsText !== undefined ? hashContent(instructionsText) : undefined;
  const instructions: InstructionsPlan =
    instructionsHash === undefined
      ? { managed: false, willUpdate: false, reason: "instructions not managed" }
      : {
          managed: true,
          willUpdate: state.instructions !== instructionsHash,
          reason:
            state.instructions === instructionsHash
              ? "instructions unchanged"
              : "instructions changed since last sync",
        };

  if (options.dryRun) {
    return { platform: driver.platform, project, steps, instructions, applied: false };
  }

  const localPathByName = new Map(desired.map((d) => [d.name, d.localPath]));
  for (const step of steps) {
    switch (step.action) {
      case "delete":
        await driver.deleteProjectFile(project, step.name);
        break;
      case "upload":
        await driver.uploadProjectFile(project, localPathByName.get(step.name) ?? step.name);
        break;
      case "replace":
        await driver.deleteProjectFile(project, step.name);
        await driver.uploadProjectFile(project, localPathByName.get(step.name) ?? step.name);
        break;
      case "noop":
        break;
    }
  }

  if (instructions.willUpdate && instructionsText !== undefined) {
    await driver.setProjectInstructions(project, instructionsText);
  }

  const nextFiles = Object.fromEntries(desired.map((d) => [d.name, d.hash]));
  const nextState: SyncState =
    instructionsHash === undefined
      ? { files: nextFiles }
      : { files: nextFiles, instructions: instructionsHash };
  saveState(statePath, driver.platform, project.id, nextState);

  return { platform: driver.platform, project, steps, instructions, applied: true };
}
