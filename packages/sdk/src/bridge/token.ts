import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { bridgeTokenPath } from "../config.js";

/** Reads the stored bridge token, or undefined if none has been created. */
export function readBridgeToken(): string | undefined {
  const path = bridgeTokenPath();
  if (!existsSync(path)) {
    return undefined;
  }
  const token = readFileSync(path, "utf8").trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Returns the bridge token, generating and persisting one (0600) on first use.
 * The CLI reads this automatically; the extension is configured with it once
 * via its options page.
 */
export function getOrCreateBridgeToken(): string {
  const existing = readBridgeToken();
  if (existing) {
    return existing;
  }
  const token = randomBytes(24).toString("base64url");
  const path = bridgeTokenPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort on platforms without POSIX modes */
  }
  return token;
}
