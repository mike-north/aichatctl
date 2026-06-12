import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Returns this package's version, read from its `package.json` at runtime.
 *
 * Never hardcode a version literal — a hardcoded string silently drifts from
 * the real release and breaks diagnosis of which build a user is running.
 */
export function getVersion(): string {
  try {
    // Compiled location is dist/version.js, so package.json is one level up.
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "..", "package.json"), "utf8");
    const pkg: unknown = JSON.parse(raw);
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
