import { readFileSync } from "node:fs";

import { z } from "zod";

import { sendBridgeCommand } from "./bridge/client.js";
import { BrowserSession } from "./browser/session.js";
import { DEFAULT_CDP_PORT } from "./config.js";
import { AppleScriptDriver } from "./drivers/applescript/driver.js";
import { ExtensionDriver } from "./drivers/extension/driver.js";
import { createDriver } from "./drivers/factory.js";
import type { Driver } from "./drivers/driver.js";
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

const seedResultSchema = z.object({ url: z.string(), sent: z.boolean() });

/** Options for {@link createSeededSessionViaExtension}. */
export interface SeedViaExtensionOptions {
  readonly platform: Platform;
  /** Project name or URL — resolved inside the browser by the extension. */
  readonly project: string;
  readonly prompt: string;
  readonly send: boolean;
  /** Use the chrome.debugger path (trusted input, background tab). */
  readonly background?: boolean;
  /** Bridge daemon port. */
  readonly bridgePort?: number;
  /** Shared bridge token, if the daemon requires one. */
  readonly token?: string;
}

/**
 * Creates a seeded session by driving the user's real Chrome through the
 * in-browser extension over the bridge — using the real logged-in session and
 * extensions, with no CDP remote-debugging port required.
 */
export async function createSeededSessionViaExtension(
  options: SeedViaExtensionOptions,
): Promise<SeedResult> {
  const data = await sendBridgeCommand(
    "seedSession",
    {
      platform: options.platform,
      project: options.project,
      prompt: options.prompt,
      send: options.send,
      background: options.background ?? false,
    },
    {
      ...(options.bridgePort !== undefined ? { port: options.bridgePort } : {}),
      ...(options.token !== undefined ? { token: options.token } : {}),
    },
  );
  const parsed = seedResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new AichatctlError(`Extension returned an unexpected seedSession result: ${JSON.stringify(data)}`);
  }
  return parsed.data;
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
  /** How to drive the browser: CDP (dedicated profile), the real-Chrome extension, or AppleScript. */
  readonly transport?: "cdp" | "extension" | "applescript";
  /** Bridge daemon port (extension transport). */
  readonly bridgePort?: number;
  /** Bridge token (extension transport). */
  readonly token?: string;
}

/**
 * Syncs every platform configured in the manifest (or the requested subset).
 * For a dry run no browser mutations occur, but the live browser is still used
 * to read the current remote file list for accurate planning.
 */
export async function runSync(options: RunSyncOptions): Promise<SyncReport[]> {
  const manifest = loadManifest(options.configPath);
  const targets = (options.platforms ?? PLATFORMS).filter(
    (p) => manifest.platforms[p] !== undefined,
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

  if (options.transport === "extension") {
    const drivers = new Map<Platform, Driver>(
      targets.map((p) => [
        p,
        new ExtensionDriver(p, {
          ...(options.bridgePort !== undefined ? { bridgePort: options.bridgePort } : {}),
          ...(options.token !== undefined ? { token: options.token } : {}),
        }),
      ]),
    );
    return syncTargets(drivers);
  }

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
