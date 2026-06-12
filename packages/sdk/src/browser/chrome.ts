import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { platform as osPlatform } from "node:os";

import { chromeProfileDir } from "../config.js";

/** Well-known install locations for Google Chrome, by OS. */
const CHROME_PATHS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

/** Resolves the path to an installed Google Chrome executable, or undefined. */
export function findChromeExecutable(): string | undefined {
  const candidates = CHROME_PATHS[osPlatform()] ?? [];
  return candidates.find((p) => existsSync(p));
}

/** Options for launching the automation Chrome instance. */
export interface LaunchChromeOptions {
  /** Remote debugging port to expose. */
  readonly port: number;
  /** Override the user-data-dir (defaults to the dedicated automation profile). */
  readonly userDataDir?: string;
  /** Override the Chrome executable path. */
  readonly executablePath?: string;
}

/** Result of a launch attempt. */
export interface LaunchChromeResult {
  /** PID of the spawned Chrome process. */
  readonly pid: number | undefined;
  /** The user-data-dir the instance was launched with. */
  readonly userDataDir: string;
  /** The executable that was launched. */
  readonly executablePath: string;
}

/**
 * Launches the user's installed Google Chrome with remote debugging enabled,
 * using a dedicated automation profile so it does not collide with everyday
 * browsing and is permitted to expose the debugging port.
 *
 * The process is detached so it outlives the calling CLI invocation.
 */
export function launchChrome(options: LaunchChromeOptions): LaunchChromeResult {
  const executablePath = options.executablePath ?? findChromeExecutable();
  if (!executablePath) {
    throw new Error(
      "Could not find Google Chrome. Install it or pass an explicit executablePath.",
    );
  }
  const userDataDir = options.userDataDir ?? chromeProfileDir();
  mkdirSync(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${String(options.port)}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  const child = spawn(executablePath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return { pid: child.pid, userDataDir, executablePath };
}
