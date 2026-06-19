/**
 * `@aichatctl/sdk` — the engine for driving the Claude.ai, ChatGPT, and
 * NotebookLM web UIs from agents: drive the user's real, logged-in Chrome via
 * AppleScript (`osascript`) and reconcile project file libraries against a local
 * source of truth.
 *
 * @packageDocumentation
 */

export * from "./types.js";
export * from "./errors.js";
export { getVersion } from "./version.js";
export { configDir } from "./config.js";

export type { Driver, CreateSessionOptions } from "./drivers/driver.js";
export { AppleScriptDriver } from "./drivers/applescript/driver.js";
export type { ChatPlatform } from "./drivers/applescript/conversation.js";
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

export * from "./service.js";
