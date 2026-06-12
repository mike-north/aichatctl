/**
 * Tests for manifest parsing/validation.
 *
 * @see Manifest schema in manifest.ts (aichatctl.config.yaml format)
 */
import { describe, expect, it } from "vitest";

import { ConfigError } from "../errors.js";
import { manifestForPlatform, parseManifest } from "./manifest.js";

const VALID = `
platforms:
  claude:
    project: "Spec Workspace"
    instructions: docs/instructions.md
    files:
      - docs/specs/**/*.md
      - README.md
  chatgpt:
    project: "https://chatgpt.com/g/g-p-abc/project"
    files:
      - docs/specs/**/*.md
`;

describe("parseManifest (valid)", () => {
  it("parses both platforms with files and optional instructions", () => {
    const m = parseManifest(VALID, "/base");
    expect(m.baseDir).toBe("/base");
    expect(m.platforms.claude?.project).toBe("Spec Workspace");
    expect(m.platforms.claude?.instructions).toBe("docs/instructions.md");
    expect(m.platforms.claude?.files).toEqual(["docs/specs/**/*.md", "README.md"]);
    expect(m.platforms.chatgpt?.instructions).toBeUndefined();
  });

  it("returns the entry for a configured platform", () => {
    const m = parseManifest(VALID, "/base");
    expect(manifestForPlatform(m, "chatgpt").project).toContain("chatgpt.com");
  });
});

describe("parseManifest (invalid)", () => {
  it("rejects a manifest with no platforms configured", () => {
    expect(() => parseManifest(`platforms: {}`, "/base")).toThrow(ConfigError);
  });

  it("rejects a platform missing the project field", () => {
    const yaml = `
platforms:
  claude:
    files:
      - a.md
`;
    expect(() => parseManifest(yaml, "/base")).toThrow(ConfigError);
  });

  it("rejects a platform with an empty files list", () => {
    const yaml = `
platforms:
  claude:
    project: "P"
    files: []
`;
    expect(() => parseManifest(yaml, "/base")).toThrow(/at least one file/);
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    const yaml = `
platforms:
  claude:
    project: "P"
    files: [a.md]
extra: true
`;
    expect(() => parseManifest(yaml, "/base")).toThrow(ConfigError);
  });

  it("rejects unknown platform names", () => {
    const yaml = `
platforms:
  gemini:
    project: "P"
    files: [a.md]
`;
    expect(() => parseManifest(yaml, "/base")).toThrow(ConfigError);
  });

  it("rejects malformed YAML", () => {
    expect(() => parseManifest(`platforms: [unterminated`, "/base")).toThrow(ConfigError);
  });

  it("throws ConfigError when asked for an unconfigured platform", () => {
    const m = parseManifest(VALID.replace(/ {2}chatgpt:[\s\S]*$/, ""), "/base");
    expect(() => manifestForPlatform(m, "chatgpt")).toThrow(ConfigError);
  });
});
