/**
 * Typed error classes for the aichatctl SDK.
 *
 * @packageDocumentation
 */

/** Base class for all errors thrown by the SDK. */
export class AichatctlError extends Error {
  public override readonly name: string = "AichatctlError";
}

/** Thrown when no CDP endpoint can be reached (Chrome not launched with debugging). */
export class BrowserNotReachableError extends AichatctlError {
  public override readonly name = "BrowserNotReachableError";
  public constructor(
    public readonly endpoint: string,
    options?: { cause?: unknown },
  ) {
    super(
      `Could not connect to Chrome over CDP at ${endpoint}. ` +
        `Start it with \`aichatctl browser launch\` (or run Chrome with --remote-debugging-port).`,
      options,
    );
  }
}

/** Thrown when the user does not appear to be logged in to a platform. */
export class NotLoggedInError extends AichatctlError {
  public override readonly name = "NotLoggedInError";
  public constructor(public readonly platform: string) {
    super(
      `Not logged in to ${platform}. Open the platform in the automation browser and sign in, ` +
        `then re-run.`,
    );
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

/** Thrown when a centralized selector fails to resolve, indicating UI drift. */
export class SelectorError extends AichatctlError {
  public override readonly name = "SelectorError";
  public constructor(
    public readonly platform: string,
    public readonly selectorName: string,
  ) {
    super(
      `Selector "${selectorName}" did not resolve on ${platform}. ` +
        `The web UI likely changed; update packages/sdk/src/drivers/${platform}/selectors.ts.`,
    );
  }
}

/** Thrown when the on-disk manifest/config is malformed. */
export class ConfigError extends AichatctlError {
  public override readonly name = "ConfigError";
}
