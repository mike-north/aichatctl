/**
 * `@aichatctl/sdk` — the engine for driving the Claude.ai and ChatGPT web UIs
 * from agents: attach to Chrome over CDP, drive per-platform DOM flows, and
 * reconcile project file libraries against a local source of truth.
 *
 * @packageDocumentation
 */

export * from "./types.js";
export * from "./errors.js";
export { getVersion } from "./version.js";
export { DEFAULT_CDP_PORT, configDir, chromeProfileDir } from "./config.js";

export { BrowserSession, isCdpReachable } from "./browser/session.js";
export type { ConnectOptions } from "./browser/session.js";
export { launchChrome, findChromeExecutable } from "./browser/chrome.js";
export type { LaunchChromeOptions, LaunchChromeResult } from "./browser/chrome.js";

export type {
  Driver,
  NamedSelector,
  SelftestResult,
  SelectorProbe,
  CreateSessionOptions,
} from "./drivers/driver.js";
export { createDriver } from "./drivers/factory.js";
export { AppleScriptDriver } from "./drivers/applescript/driver.js";
export { NotebookLmDriver } from "./drivers/notebooklm/driver.js";
export type { Notebook } from "./drivers/notebooklm/driver.js";
export {
  AUDIO_FORMAT_LABEL,
  AUDIO_LENGTH_LABEL,
  parseAudioFormat,
  parseAudioLength,
} from "./drivers/notebooklm/types.js";
export type {
  AudioOverviewFormat,
  AudioOverviewLength,
  AudioOverviewOptions,
  NotebookArtifact,
  NotebookArtifactState,
  NotebookArtifactType,
  NotebookSource,
} from "./drivers/notebooklm/types.js";
export { evalInChromeTab, runAppleScript, AppleScriptError } from "./applescript/runner.js";
export { discoverProfiles, resolveProfile } from "./applescript/profile.js";
export type { ChromeProfile, ProfileHint } from "./applescript/profile.js";

export * from "./sync/manifest.js";
export * from "./sync/plan.js";
export * from "./sync/state.js";
export * from "./sync/files.js";
export { syncPlatform } from "./sync/sync.js";
export type { SyncOptions, SyncReport, InstructionsPlan } from "./sync/sync.js";
export { hashContent, hashFile } from "./sync/hash.js";

export { doctor } from "./doctor.js";
export type { DoctorReport, DoctorOptions } from "./doctor.js";

export * from "./service.js";
