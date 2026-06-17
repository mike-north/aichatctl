import { readFileSync } from "node:fs";

import { resolveProfile } from "./applescript/profile.js";
import type { ProfileHint } from "./applescript/profile.js";
import { AppleScriptDriver } from "./drivers/applescript/driver.js";
import type { Driver } from "./drivers/driver.js";
import { NotebookLmDriver } from "./drivers/notebooklm/driver.js";
import type { Notebook } from "./drivers/notebooklm/driver.js";
import type { AudioOverviewOptions, NotebookArtifact } from "./drivers/notebooklm/types.js";
import { AichatctlError, NotLoggedInError } from "./errors.js";
import { loadManifest, manifestForPlatform } from "./sync/manifest.js";
import { syncPlatform } from "./sync/sync.js";
import type { SyncReport } from "./sync/sync.js";
import type { Platform, Project, SeedResult } from "./types.js";
import { PLATFORMS } from "./types.js";

/** Options for {@link createSeededSession}. */
export interface SeedSessionOptions {
  readonly platform: Platform;
  /** Project name, URL, or id. */
  readonly project: string;
  /** The prompt to seed (and optionally submit). */
  readonly prompt: string;
  /** Submit the prompt (true) or leave it staged (false). */
  readonly send: boolean;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/**
 * Creates a seeded chat session in a project by driving the user's real,
 * logged-in Chrome via AppleScript (`osascript`). Requires Chrome's "Allow
 * JavaScript from Apple Events" (macOS).
 */
export async function createSeededSession(options: SeedSessionOptions): Promise<SeedResult> {
  const driver = new AppleScriptDriver(options.platform);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError(options.platform);
  }
  const project = await driver.resolveProject(options.project);
  return driver.createSeededSession(project, options.prompt, { send: options.send });
}

/** Per-platform readiness for the AppleScript transport. */
export interface ApplescriptPlatformStatus {
  readonly platform: Platform;
  readonly loggedIn: boolean;
  readonly error?: string;
}

/** Readiness report for `aichatctl doctor`. */
export interface ApplescriptDoctorReport {
  /** False when Chrome's "Allow JavaScript from Apple Events" is off. */
  readonly jsFromAppleEventsEnabled: boolean;
  readonly platforms: readonly ApplescriptPlatformStatus[];
  /** True when JS is enabled and every probed platform is logged in. */
  readonly ok: boolean;
}

/**
 * Preflight for the AppleScript transport: verifies Chrome's JS-from-Apple-Events
 * toggle and the logged-in state per platform. Never throws — failures are
 * reported in the result so an agent can guide the user.
 */
export async function doctorApplescript(
  platforms: readonly Platform[] = PLATFORMS,
): Promise<ApplescriptDoctorReport> {
  let jsEnabled = true;
  const statuses: ApplescriptPlatformStatus[] = [];
  for (const platform of platforms) {
    try {
      const loggedIn = await new AppleScriptDriver(platform).isLoggedIn();
      statuses.push({ platform, loggedIn });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Allow JavaScript from Apple Events/i.test(message)) {
        jsEnabled = false;
      }
      statuses.push({ platform, loggedIn: false, error: message });
    }
  }
  return {
    jsFromAppleEventsEnabled: jsEnabled,
    platforms: statuses,
    ok: jsEnabled && statuses.every((s) => s.loggedIn),
  };
}

/** Reads a prompt from a file, or from stdin when path is "-". */
export function readPromptSource(source: string): string {
  if (source === "-") {
    return readFileSync(0, "utf8");
  }
  return readFileSync(source, "utf8");
}

/** Options for {@link listProjects}. */
export interface ListProjectsOptions {
  readonly platform: Platform;
}

/** Lists projects on a platform (drives the user's real Chrome via AppleScript). */
export async function listProjects(options: ListProjectsOptions): Promise<Project[]> {
  return new AppleScriptDriver(options.platform).listProjects();
}

/** Options for {@link runSync}. */
export interface RunSyncOptions {
  /** Path to the manifest (aichatctl.config.yaml). */
  readonly configPath: string;
  /** Limit to specific platforms (defaults to all configured in the manifest). */
  readonly platforms?: readonly Platform[];
  /** Compute the plan without making changes. */
  readonly dryRun: boolean;
  /** Override the sync-state file path. */
  readonly statePath?: string;
}

/**
 * Syncs every platform configured in the manifest (or the requested subset) by
 * driving the user's real, logged-in Chrome via AppleScript. For a dry run no
 * browser mutations occur, but the live browser is still read to compute an
 * accurate plan.
 */
export async function runSync(options: RunSyncOptions): Promise<SyncReport[]> {
  const manifest = loadManifest(options.configPath);
  // Sync targets come from the manifest's configured (syncable) platforms; Gemini
  // has no file library and is never a sync target.
  const configured = Object.keys(manifest.platforms) as Platform[];
  const targets = configured.filter(
    (p) => options.platforms === undefined || options.platforms.includes(p),
  );

  const drivers = new Map<Platform, Driver>(targets.map((p) => [p, new AppleScriptDriver(p)]));
  const reports: SyncReport[] = [];
  for (const platform of targets) {
    const driver = drivers.get(platform);
    if (!driver) {
      continue;
    }
    reports.push(
      await syncPlatform(driver, manifestForPlatform(manifest, platform), {
        baseDir: manifest.baseDir,
        dryRun: options.dryRun,
        ...(options.statePath !== undefined ? { statePath: options.statePath } : {}),
      }),
    );
  }
  return reports;
}

async function resolveWindowIds(
  profile: ProfileHint | undefined,
): Promise<readonly string[] | undefined> {
  if (profile === undefined) return undefined;
  const resolved = await resolveProfile(profile);
  return resolved.windowIds;
}

/** Options for {@link createEmptyNotebook}. */
export interface CreateNotebookOptions {
  /** Name to give the notebook (omit to leave untitled). */
  readonly name?: string;
  /** Target a specific Chrome profile by account email or display name. */
  readonly profile?: ProfileHint;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/** Result of {@link createEmptyNotebook}. */
export interface NotebookResult {
  readonly id: string;
  readonly url: string;
  readonly name: string;
}

/**
 * Creates an empty NotebookLM notebook, optionally naming it.
 * AppleScript transport only (macOS).
 */
export async function createEmptyNotebook(options: CreateNotebookOptions): Promise<NotebookResult> {
  const windowIds = await resolveWindowIds(options.profile);
  const driver = new NotebookLmDriver(windowIds);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  const notebook = await driver.createNotebook();
  if (options.name !== undefined && options.name.trim().length > 0) {
    await driver.renameNotebook(notebook, options.name);
  }
  const name = await driver.getNotebookName(notebook);
  return { id: notebook.id, url: notebook.url, name };
}

/** Options for {@link renameNotebook}. */
export interface RenameNotebookOptions {
  /** Notebook URL or UUID. */
  readonly notebook: string;
  /** New name for the notebook. */
  readonly name: string;
  /** Target a specific Chrome profile. */
  readonly profile?: ProfileHint;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/** Renames an existing NotebookLM notebook. AppleScript transport only (macOS). */
export async function renameNotebook(options: RenameNotebookOptions): Promise<void> {
  if (options.name.trim().length === 0) {
    throw new AichatctlError("Provide a non-empty --name.");
  }
  const nb = NotebookLmDriver.parseNotebookRef(options.notebook);
  const windowIds = await resolveWindowIds(options.profile);
  const driver = new NotebookLmDriver(windowIds);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  await driver.renameNotebook(nb, options.name);
}

/** Options for {@link listNotebookSources}. */
export interface ListSourcesOptions {
  /** Notebook URL or UUID. */
  readonly notebook: string;
  /** Target a specific Chrome profile. */
  readonly profile?: ProfileHint;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/** Result of {@link listNotebookSources}. */
export interface NotebookSourcesResult {
  readonly notebook: Notebook;
  readonly sources: string[];
}

/** Lists the display names of sources in a notebook. AppleScript transport only (macOS). */
export async function listNotebookSources(
  options: ListSourcesOptions,
): Promise<NotebookSourcesResult> {
  const nb = NotebookLmDriver.parseNotebookRef(options.notebook);
  const windowIds = await resolveWindowIds(options.profile);
  const driver = new NotebookLmDriver(windowIds);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  const sources = await driver.listSources(nb);
  return { notebook: nb, sources };
}

/** Options for {@link generateNotebookPodcast}. */
export interface GeneratePodcastOptions {
  /** Notebook URL or UUID. */
  readonly notebook: string;
  /** Audio Overview type/length/prompt. */
  readonly audio: AudioOverviewOptions;
  /** Target a specific Chrome profile. */
  readonly profile?: ProfileHint;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/**
 * Generates an Audio Overview (podcast) on an existing notebook that already
 * has sources. Returns once generation is kicked off (the audio renders in the
 * background over minutes). AppleScript transport only (macOS).
 */
export async function generateNotebookPodcast(options: GeneratePodcastOptions): Promise<void> {
  const nb = NotebookLmDriver.parseNotebookRef(options.notebook);
  const windowIds = await resolveWindowIds(options.profile);
  const driver = new NotebookLmDriver(windowIds);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  await driver.generateAudioOverview(nb, options.audio);
}

/** Options for {@link removeNotebookSource}. */
export interface RemoveSourceOptions {
  /** Notebook URL or UUID. */
  readonly notebook: string;
  /** Display name (or prefix) of the source to remove. */
  readonly source: string;
  /** Target a specific Chrome profile. */
  readonly profile?: ProfileHint;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/** Removes a source from a notebook by its display name. AppleScript transport only (macOS). */
export async function removeNotebookSource(options: RemoveSourceOptions): Promise<void> {
  const nb = NotebookLmDriver.parseNotebookRef(options.notebook);
  const windowIds = await resolveWindowIds(options.profile);
  const driver = new NotebookLmDriver(windowIds);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  await driver.removeSource(nb, options.source);
}

/** Options for {@link addNotebookSource}. */
export interface AddSourceOptions {
  /** Notebook URL or UUID. */
  readonly notebook: string;
  /** Source type: "text" (pasted content) or "url" (website link). */
  readonly kind: "text" | "url";
  /** The content (for kind=text) or URL (for kind=url) to add. */
  readonly content: string;
  /** Target a specific Chrome profile. */
  readonly profile?: ProfileHint;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/** Result of {@link addNotebookSource}. */
export interface AddSourceResult {
  readonly title: string;
}

/**
 * Adds a source to a notebook and waits for NotebookLM to auto-generate its
 * title. Returns the title (the handle for future `removeNotebookSource` calls).
 * AppleScript transport only (macOS).
 */
export async function addNotebookSource(options: AddSourceOptions): Promise<AddSourceResult> {
  if (options.content.trim().length === 0) {
    throw new AichatctlError("Provide non-empty content for the source.");
  }
  const nb = NotebookLmDriver.parseNotebookRef(options.notebook);
  const windowIds = await resolveWindowIds(options.profile);
  const driver = new NotebookLmDriver(windowIds);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  const title =
    options.kind === "url"
      ? await driver.addUrlSourceAndAwaitTitle(nb, options.content)
      : await driver.addTextSourceAndAwaitTitle(nb, options.content);
  return { title };
}

/** Options for {@link getNotebookStatus}. */
export interface NotebookStatusOptions {
  /** Notebook URL or UUID. */
  readonly notebook: string;
  /** Target a specific Chrome profile. */
  readonly profile?: ProfileHint;
  /** Skip the logged-in precondition check. */
  readonly skipLoginCheck?: boolean;
}

/** Result of {@link getNotebookStatus}. */
export interface NotebookStatusResult {
  readonly notebook: Notebook;
  readonly artifacts: NotebookArtifact[];
}

/**
 * Reports the artifacts (Audio Overviews, …) in a notebook's Studio panel with a
 * best-effort `type`/`state`. AppleScript transport only (macOS).
 */
export async function getNotebookStatus(
  options: NotebookStatusOptions,
): Promise<NotebookStatusResult> {
  const nb = NotebookLmDriver.parseNotebookRef(options.notebook);
  const windowIds = await resolveWindowIds(options.profile);
  const driver = new NotebookLmDriver(windowIds);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  const artifacts = await driver.listArtifacts(nb);
  return { notebook: nb, artifacts };
}
