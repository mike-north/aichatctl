import type { Page } from "playwright-core";

import type { Platform, Project, RemoteFile, SeedResult } from "../types.js";

/** Outcome of probing one named selector during a selftest. */
export interface SelectorProbe {
  readonly name: string;
  readonly ok: boolean;
}

/** Result of a driver selftest, used by `aichatctl doctor`. */
export interface SelftestResult {
  readonly platform: Platform;
  readonly loggedIn: boolean;
  readonly probes: readonly SelectorProbe[];
  /** True when logged in and every probed selector resolved. */
  readonly ok: boolean;
}

/** Options controlling seeded-session creation. */
export interface CreateSessionOptions {
  /** When false, the prompt is staged in the composer but not submitted. */
  readonly send: boolean;
}

/**
 * Platform driver: all deterministic, DOM-level mechanics for one web AI chat
 * platform. Implementations keep every locator in a sibling `selectors.ts` so
 * UI drift is a one-file fix.
 */
export interface Driver {
  readonly platform: Platform;

  /** Whether the user appears to be signed in. */
  isLoggedIn(): Promise<boolean>;

  /** Verifies that the platform's centralized selectors still resolve. */
  selftest(): Promise<SelftestResult>;

  /** Lists the projects visible to the signed-in user. */
  listProjects(): Promise<Project[]>;

  /** Resolves a name/URL/id reference to a concrete project. */
  resolveProject(ref: string): Promise<Project>;

  /** Lists files currently in the project's library (names only). */
  getProjectFiles(project: Project): Promise<RemoteFile[]>;

  /** Uploads a local file into the project's library. */
  uploadProjectFile(project: Project, localPath: string): Promise<void>;

  /** Removes a file from the project's library by displayed name. */
  deleteProjectFile(project: Project, remoteName: string): Promise<void>;

  /** Reads the project's instructions text. */
  getProjectInstructions(project: Project): Promise<string>;

  /** Replaces the project's instructions text. */
  setProjectInstructions(project: Project, text: string): Promise<void>;

  /** Creates a new chat in the project, seeded with `prompt`. */
  createSeededSession(
    project: Project,
    prompt: string,
    options: CreateSessionOptions,
  ): Promise<SeedResult>;
}

/** A named, self-describing locator used by a driver and by selftest. */
export interface NamedSelector {
  /** Stable key referenced in code. */
  readonly name: string;
  /** Human-readable description of what it targets. */
  readonly describe: string;
  /** Builds a Playwright locator against a page. */
  locate(page: Page): import("playwright-core").Locator;
}
