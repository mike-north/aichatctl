import type { Platform, Project, RemoteFile, SeedResult } from "../types.js";

/** Options controlling seeded-session creation. */
export interface CreateSessionOptions {
  /** When false, the prompt is staged in the composer but not submitted. */
  readonly send: boolean;
}

/**
 * Platform driver: all deterministic, DOM-level mechanics for one web AI chat
 * platform, driven through the AppleScript transport (the user's real,
 * logged-in Chrome). NotebookLM has its own standalone driver.
 */
export interface Driver {
  readonly platform: Platform;

  /** Whether the user appears to be signed in. */
  isLoggedIn(): Promise<boolean>;

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
