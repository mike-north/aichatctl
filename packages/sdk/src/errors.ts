/**
 * Typed error classes for the aichatctl SDK.
 *
 * @packageDocumentation
 */

/** Base class for all errors thrown by the SDK. */
export class AichatctlError extends Error {
  public override readonly name: string = "AichatctlError";
}

/** Thrown when the user does not appear to be logged in to a platform. */
export class NotLoggedInError extends AichatctlError {
  public override readonly name = "NotLoggedInError";
  public constructor(public readonly platform: string) {
    super(`Not logged in to ${platform}. Sign in to ${platform} in Chrome, then re-run.`);
  }
}

/** Thrown when a referenced project cannot be found in the UI. */
export class ProjectNotFoundError extends AichatctlError {
  public override readonly name = "ProjectNotFoundError";
  public constructor(
    public readonly platform: string,
    public readonly project: string,
  ) {
    super(`No project matching "${project}" was found on ${platform}.`);
  }
}

/** Thrown when the on-disk manifest/config is malformed. */
export class ConfigError extends AichatctlError {
  public override readonly name = "ConfigError";
}

/**
 * Thrown when an operation isn't supported for a platform/transport — e.g.
 * Gemini has no project file library or instructions to sync, and is reachable
 * only via the AppleScript transport.
 */
export class UnsupportedOperationError extends AichatctlError {
  public override readonly name = "UnsupportedOperationError";
  public constructor(
    public readonly platform: string,
    public readonly operation: string,
  ) {
    super(`Operation "${operation}" is not supported on ${platform}.`);
  }
}
