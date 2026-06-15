import { readFileSync } from "node:fs";

import { BrowserSession } from "./browser/session.js";
import { DEFAULT_CDP_PORT } from "./config.js";
import { AppleScriptDriver } from "./drivers/applescript/driver.js";
import { createDriver } from "./drivers/factory.js";
import type { Driver } from "./drivers/driver.js";
import { NotebookLmDriver } from "./drivers/notebooklm/driver.js";
import type { AudioOverviewOptions, NotebookSource } from "./drivers/notebooklm/types.js";
import { AichatctlError, NotLoggedInError } from "./errors.js";
import { loadManifest, manifestForPlatform } from "./sync/manifest.js";
import { syncPlatform } from "./sync/sync.js";
import type { SyncReport } from "./sync/sync.js";
import type { Platform, Project, SeedResult } from "./types.js";
import { PLATFORMS } from "./types.js";

/** Common connection options. */
export interface ConnectionOptions {
  readonly port?: number;
}

/** Options for {@link createSeededSession}. */
export interface SeedSessionOptions extends ConnectionOptions {
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

/** Creates a seeded chat session in a project on the given platform. */
export async function createSeededSession(options: SeedSessionOptions): Promise<SeedResult> {
  const session = await BrowserSession.connect({ port: options.port ?? DEFAULT_CDP_PORT });
  try {
    const driver = createDriver(options.platform, session);
    if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
      throw new NotLoggedInError(options.platform);
    }
    const project = await driver.resolveProject(options.project);
    return await driver.createSeededSession(project, options.prompt, { send: options.send });
  } finally {
    await session.close();
  }
}

/** Per-platform readiness for the AppleScript transport. */
export interface ApplescriptPlatformStatus {
  readonly platform: Platform;
  readonly loggedIn: boolean;
  readonly error?: string;
}

/** Readiness report for `doctor --transport applescript`. */
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

/** Options for {@link createSeededSessionViaApplescript}. */
export interface SeedViaApplescriptOptions {
  readonly platform: Platform;
  readonly project: string;
  readonly prompt: string;
  readonly send: boolean;
  readonly skipLoginCheck?: boolean;
}

/**
 * Creates a seeded session by driving the user's real Chrome with no extension,
 * via AppleScript (`osascript`). For locked-down environments where apps are
 * installable but Chrome extensions are not. Requires Chrome's "Allow JavaScript
 * from Apple Events".
 */
export async function createSeededSessionViaApplescript(
  options: SeedViaApplescriptOptions,
): Promise<SeedResult> {
  const driver = new AppleScriptDriver(options.platform);
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError(options.platform);
  }
  const project = await driver.resolveProject(options.project);
  return driver.createSeededSession(project, options.prompt, { send: options.send });
}

/** Reads a prompt from a file, or from stdin when path is "-". */
export function readPromptSource(source: string): string {
  if (source === "-") {
    return readFileSync(0, "utf8");
  }
  return readFileSync(source, "utf8");
}

/** Options for {@link listProjects}. */
export interface ListProjectsOptions extends ConnectionOptions {
  readonly platform: Platform;
}

/** Lists projects on a platform. */
export async function listProjects(options: ListProjectsOptions): Promise<Project[]> {
  const session = await BrowserSession.connect({ port: options.port ?? DEFAULT_CDP_PORT });
  try {
    return await createDriver(options.platform, session).listProjects();
  } finally {
    await session.close();
  }
}

/** Options for {@link runSync}. */
export interface RunSyncOptions extends ConnectionOptions {
  /** Path to the manifest (aichatctl.config.yaml). */
  readonly configPath: string;
  /** Limit to specific platforms (defaults to all configured in the manifest). */
  readonly platforms?: readonly Platform[];
  /** Compute the plan without making changes. */
  readonly dryRun: boolean;
  /** Override the sync-state file path. */
  readonly statePath?: string;
  /** How to drive the browser: CDP (dedicated profile) or AppleScript (real Chrome, macOS). */
  readonly transport?: "cdp" | "applescript";
}

/**
 * Syncs every platform configured in the manifest (or the requested subset).
 * For a dry run no browser mutations occur, but the live browser is still used
 * to read the current remote file list for accurate planning.
 */
export async function runSync(options: RunSyncOptions): Promise<SyncReport[]> {
  const manifest = loadManifest(options.configPath);
  // Sync targets come from the manifest's configured (syncable) platforms; Gemini
  // has no file library and is never a sync target.
  const configured = Object.keys(manifest.platforms) as Platform[];
  const targets = configured.filter(
    (p) => options.platforms === undefined || options.platforms.includes(p),
  );

  const syncTargets = async (drivers: Map<Platform, Driver>): Promise<SyncReport[]> => {
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
  };

  if (options.transport === "applescript") {
    const drivers = new Map<Platform, Driver>(targets.map((p) => [p, new AppleScriptDriver(p)]));
    return syncTargets(drivers);
  }

  const session = await BrowserSession.connect({ port: options.port ?? DEFAULT_CDP_PORT });
  try {
    const drivers = new Map<Platform, Driver>(targets.map((p) => [p, createDriver(p, session)]));
    return await syncTargets(drivers);
  } finally {
    await session.close();
  }
}

/** Options for {@link createNotebookPodcast}. */
export interface CreateNotebookPodcastOptions {
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
    throw new AichatctlError(
      "Provide at least one source: --source, --source-url, or --source-text.",
    );
  }
  const driver = new NotebookLmDriver();
  if (options.skipLoginCheck !== true && !(await driver.isLoggedIn())) {
    throw new NotLoggedInError("notebooklm");
  }
  const notebook = await driver.createNotebook();
  let sourcesAdded = 0;
  for (const [index, source] of options.sources.entries()) {
    const label = source.kind === "url" ? source.url : (source.title ?? "inline text");
    try {
      if (source.kind === "text") {
        const body =
          source.title !== undefined ? `# ${source.title}\n\n${source.content}` : source.content;
        await driver.addTextSource(notebook, body);
      } else {
        await driver.addUrlSource(notebook, source.url);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AichatctlError(
        `Failed to add source ${String(index + 1)}/${String(options.sources.length)} (${label}): ${detail}`,
      );
    }
    sourcesAdded += 1;
  }
  await driver.generateAudioOverview(notebook, options.audio);
  return { url: notebook.url, notebookId: notebook.id, sourcesAdded, podcastKicked: true };
}
