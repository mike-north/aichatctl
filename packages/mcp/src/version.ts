import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Reads this server's version from its package.json (never hardcoded). */
export function getServerVersion(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg: unknown = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8"));
    if (
      typeof pkg === "object" &&
      pkg !== null &&
      "version" in pkg &&
      typeof pkg.version === "string"
    ) {
      return pkg.version;
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}
