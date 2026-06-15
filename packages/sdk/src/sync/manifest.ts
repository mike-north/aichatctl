import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { load as parseYaml } from "js-yaml";
import { z } from "zod";

import { ConfigError } from "../errors.js";
import type { Platform } from "../types.js";

/** Per-platform manifest: target project + which local files/instructions to mirror. */
const platformManifestSchema = z
  .object({
    project: z.string().min(1, "project must be a non-empty name, URL, or id"),
    instructions: z.string().min(1).optional(),
    files: z.array(z.string().min(1)).min(1, "at least one file glob is required"),
  })
  .strict();

/** Top-level manifest schema (`aichatctl.config.yaml`). */
const manifestSchema = z
  .object({
    platforms: z
      .object({
        claude: platformManifestSchema.optional(),
        chatgpt: platformManifestSchema.optional(),
      })
      .strict()
      .refine((p) => p.claude !== undefined || p.chatgpt !== undefined, {
        message: "at least one platform must be configured",
      }),
  })
  .strict();

/** A validated per-platform manifest. */
export type PlatformManifest = z.infer<typeof platformManifestSchema>;

/** A validated manifest plus the directory it was loaded from. */
export interface LoadedManifest {
  readonly platforms: z.infer<typeof manifestSchema>["platforms"];
  /** Absolute directory used to resolve relative file globs. */
  readonly baseDir: string;
}

/** Parses and validates a manifest from a YAML string. */
export function parseManifest(yaml: string, baseDir: string): LoadedManifest {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (cause) {
    throw new ConfigError(`Manifest is not valid YAML: ${String(cause)}`, { cause });
  }
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid manifest:\n${issues}`);
  }
  return { platforms: result.data.platforms, baseDir };
}

/** Loads and validates a manifest from disk. */
export function loadManifest(configPath: string): LoadedManifest {
  const abs = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  let yaml: string;
  try {
    yaml = readFileSync(abs, "utf8");
  } catch (cause) {
    throw new ConfigError(`Could not read manifest at ${abs}: ${String(cause)}`, { cause });
  }
  return parseManifest(yaml, dirname(abs));
}

/** Returns the manifest entry for a platform, or throws if not configured. */
export function manifestForPlatform(
  manifest: LoadedManifest,
  platform: Platform,
): PlatformManifest {
  if (platform === "gemini") {
    // Gemini has no file library / instructions, so it is never in a manifest.
    throw new ConfigError(`Platform "gemini" has no file library to sync.`);
  }
  const entry = manifest.platforms[platform];
  if (!entry) {
    throw new ConfigError(`Manifest has no configuration for platform "${platform}".`);
  }
  return entry;
}
