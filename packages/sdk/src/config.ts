import { homedir } from "node:os";
import { join } from "node:path";

/** Default CDP remote-debugging port the SDK attaches to. */
export const DEFAULT_CDP_PORT = 9222;

/** Root config directory for aichatctl (honors XDG_CONFIG_HOME). */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "aichatctl");
}

/**
 * Dedicated Chrome user-data directory used by the automation browser.
 *
 * Recent Chrome refuses `--remote-debugging-port` on the default profile for
 * security, so we use an isolated profile the user signs into once.
 */
export function chromeProfileDir(): string {
  return join(configDir(), "chrome-profile");
}

/** Path to the shared bridge token (gates the localhost CLI↔extension channel). */
export function bridgeTokenPath(): string {
  return join(configDir(), "bridge-token");
}
