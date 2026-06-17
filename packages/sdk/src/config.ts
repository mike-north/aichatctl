import { homedir } from "node:os";
import { join } from "node:path";

/** Root config directory for aichatctl (honors XDG_CONFIG_HOME). */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "aichatctl");
}
