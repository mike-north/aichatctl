/**
 * Tests for the AppleScript runner's platform guard. The transport uses
 * `osascript` (macOS only); off-macOS it must fail fast with a clear message
 * rather than a low-level spawn error.
 */
import { afterEach, describe, expect, it } from "vitest";

import { evalInChromeTab, runAppleScript } from "./runner.js";

const realPlatform = process.platform;
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}
afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
});

describe("AppleScript runner platform guard", () => {
  it("evalInChromeTab rejects with a clear message off macOS", async () => {
    setPlatform("linux");
    await expect(evalInChromeTab("return '1';", { matchUrl: "x", createUrl: "y" })).rejects.toThrow(
      /requires macOS/,
    );
  });

  it("runAppleScript rejects with a clear message off macOS", async () => {
    setPlatform("win32");
    await expect(runAppleScript("return 1")).rejects.toThrow(/requires macOS/);
  });
});
