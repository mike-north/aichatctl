import { readFileSync } from "node:fs";

import { z } from "zod";

import { sendBridgeCommand } from "./bridge/client.js";
import { BrowserSession } from "./browser/session.js";
import { DEFAULT_CDP_PORT } from "./config.js";
import { createDriver } from "./drivers/factory.js";
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

  const session = await BrowserSession.connect({ port: options.port ?? DEFAULT_CDP_PORT });
  try {
    const reports: SyncReport[] = [];
    for (const platform of targets) {
      const driver = createDriver(platform, session);
      const entry = manifestForPlatform(manifest, platform);
      reports.push(
        await syncPlatform(driver, entry, {
          baseDir: manifest.baseDir,
          dryRun: options.dryRun,
          ...(options.statePath !== undefined ? { statePath: options.statePath } : {}),
        }),
      );
    }
    return reports;
  } finally {
    await session.close();
  }
}
