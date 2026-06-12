import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Computes a stable content hash (sha256, hex) for a buffer or string. */
export function hashContent(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Computes the content hash of a file on disk. */
export function hashFile(path: string): string {
  return hashContent(readFileSync(path));
}
