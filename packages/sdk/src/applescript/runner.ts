import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { AichatctlError } from "../errors.js";

const execFileAsync = promisify(execFile);

/** Thrown when osascript / Chrome automation fails. */
export class AppleScriptError extends AichatctlError {
  public override readonly name = "AppleScriptError";
}

/**
 * AppleScript runner: finds (or creates) a Chrome tab matching `matchUrl`, waits
 * for it to finish loading, executes `jsCode` in it, and returns the result.
 *
 * The JS is read from a temp file (avoids quoting hell) and runs via Chrome's
 * `execute … javascript`, which requires "Allow JavaScript from Apple Events"
 * (View → Developer). Because that call does NOT await promises, page JS must use
 * synchronous XMLHttpRequest for any network call.
 */
const RUNNER_SCRIPT = `on run argv
  set matchUrl to item 1 of argv
  set createUrl to item 2 of argv
  set jsFile to item 3 of argv
  set jsCode to (do shell script "cat " & quoted form of jsFile)
  tell application "Google Chrome"
    if (count of windows) is 0 then make new window
    set found to missing value
    repeat with w in windows
      repeat with tb in tabs of w
        if (URL of tb) contains matchUrl then
          set found to tb
          exit repeat
        end if
      end repeat
      if found is not missing value then exit repeat
    end repeat
    if found is missing value then
      set found to (make new tab at end of tabs of front window with properties {URL:createUrl})
      delay 2
    end if
    repeat 40 times
      if (loading of found) is false then exit repeat
      delay 0.3
    end repeat
    set r to (execute found javascript jsCode)
  end tell
  return r
end run`;

/** Options for {@link evalInChromeTab}. */
export interface EvalOptions {
  /** Substring identifying the target tab (e.g. a project id). */
  readonly matchUrl: string;
  /** URL to open if no matching tab exists. */
  readonly createUrl: string;
  /** Per-call timeout (ms). */
  readonly timeoutMs?: number;
}

/** Executes `jsCode` in the matching Chrome tab and returns its string result. */
export async function evalInChromeTab(jsCode: string, options: EvalOptions): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "aichatctl-as-"));
  const jsPath = join(dir, "code.js");
  const scptPath = join(dir, "run.applescript");
  writeFileSync(jsPath, jsCode, "utf8");
  writeFileSync(scptPath, RUNNER_SCRIPT, "utf8");
  try {
    const { stdout } = await execFileAsync(
      "osascript",
      [scptPath, options.matchUrl, options.createUrl, jsPath],
      { maxBuffer: 16 * 1024 * 1024, timeout: options.timeoutMs ?? 30_000 },
    );
    return stdout.replace(/\n$/, "");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/Allow JavaScript from Apple Events/i.test(message)) {
      throw new AppleScriptError(
        "Chrome blocks JavaScript from Apple Events. Enable it: View → Developer → Allow JavaScript from Apple Events.",
      );
    }
    if (/Application isn.t running|Google Chrome got an error/i.test(message)) {
      throw new AppleScriptError(`Chrome automation failed: ${message}`);
    }
    throw new AppleScriptError(message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a raw AppleScript (e.g. System Events keystrokes) and returns stdout. */
export async function runAppleScript(script: string, timeoutMs = 30_000): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "aichatctl-as-"));
  const scptPath = join(dir, "script.applescript");
  writeFileSync(scptPath, script, "utf8");
  try {
    const { stdout } = await execFileAsync("osascript", [scptPath], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return stdout.replace(/\n$/, "");
  } catch (cause) {
    throw new AppleScriptError(cause instanceof Error ? cause.message : String(cause));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
