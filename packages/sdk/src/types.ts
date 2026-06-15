/**
 * Shared domain types for the aichatctl SDK.
 *
 * @packageDocumentation
 */

/**
 * A supported web AI chat platform.
 *
 * `claude` and `chatgpt` support the full feature set (project file sync,
 * instructions, seeded sessions). `gemini` is **seed-sessions only** — it has no
 * project file library or project instructions to sync — and is reachable only
 * via the AppleScript transport.
 */
export type Platform = "claude" | "chatgpt" | "gemini";

/** The set of all supported platforms, for iteration/validation. */
export const PLATFORMS: readonly Platform[] = ["claude", "chatgpt", "gemini"];

/** Platforms that support project file/instructions sync (excludes Gemini). */
export const SYNC_PLATFORMS: readonly Platform[] = ["claude", "chatgpt"];

/** A project (a.k.a. "Project" on Claude.ai / ChatGPT) as seen in the web UI. */
export interface Project {
  /** Stable identifier parsed from the project URL, when available. */
  readonly id: string;
  /** Human-visible project name. */
  readonly name: string;
  /** Canonical URL of the project landing page. */
  readonly url: string;
}

/**
 * A file currently present in a project's file library, as observed in the UI.
 *
 * Only metadata is available — the web UIs expose no way to read a file's
 * uploaded content back, which is why drift is tracked via local hashes.
 */
export interface RemoteFile {
  /** File name as displayed in the project library. */
  readonly name: string;
}

/** Result of creating a seeded chat session. */
export interface SeedResult {
  /** URL of the newly created conversation. */
  readonly url: string;
  /** Whether the seed prompt was actually submitted (vs. left staged). */
  readonly sent: boolean;
}

/** Identifies a project either by its display name or by URL/id. */
export interface ProjectRef {
  readonly platform: Platform;
  /** A project name, URL, or id — resolved by the driver. */
  readonly project: string;
}
