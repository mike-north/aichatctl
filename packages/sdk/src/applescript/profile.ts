/**
 * Chrome profile discovery and resolution for the AppleScript transport.
 *
 * Enumerates open Chrome windows, identifies which profile each belongs to
 * (via `chrome://version` → Preferences file), and resolves a user-provided
 * hint (`--browser-account` or `--browser-profile`) to exactly one profile.
 *
 * @packageDocumentation
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AichatctlError } from "../errors.js";
import { runAppleScript } from "./runner.js";

/** A discovered Chrome profile with its associated window IDs. */
export interface ChromeProfile {
  readonly path: string;
  readonly name: string;
  readonly email?: string;
  readonly windowIds: readonly string[];
}

/** A user-provided hint for selecting a Chrome profile. */
export interface ProfileHint {
  readonly account?: string;
  readonly name?: string;
}

interface PreferencesProfile {
  name?: string;
}

interface PreferencesAccountInfo {
  email?: string;
  full_name?: string;
}

interface Preferences {
  profile?: PreferencesProfile;
  account_info?: PreferencesAccountInfo[];
}

/** Raw discovery result before reading Preferences. */
interface RawWindowProfile {
  windowId: string;
  profilePath: string | null;
}

function readPreferences(profilePath: string): { name: string; email?: string } {
  const prefsPath = join(profilePath, "Preferences");
  try {
    const raw: unknown = JSON.parse(readFileSync(prefsPath, "utf8"));
    const prefs = raw as Preferences;
    const name = prefs.profile?.name ?? profilePath.split("/").pop() ?? "Unknown";
    const email = prefs.account_info?.[0]?.email;
    return email !== undefined ? { name, email } : { name };
  } catch {
    return { name: profilePath.split("/").pop() ?? "Unknown" };
  }
}

interface LocalStateProfileInfo {
  name?: string;
  user_name?: string;
}

function readLocalState(chromeDir: string): Map<string, LocalStateProfileInfo> | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(chromeDir, "Local State"), "utf8"));
    const infoCache = (raw as { profile?: { info_cache?: Record<string, LocalStateProfileInfo> } })
      .profile?.info_cache;
    if (infoCache === undefined) return undefined;
    const result = new Map<string, LocalStateProfileInfo>();
    for (const [dir, info] of Object.entries(infoCache)) {
      result.set(join(chromeDir, dir), info);
    }
    return result;
  } catch {
    return undefined;
  }
}

const CHROME_DIR = join(homedir(), "Library", "Application Support", "Google", "Chrome");

/**
 * Discovers all Chrome profiles that currently have open windows.
 *
 * Reads Chrome's `Local State` for profile metadata (no tabs opened). Then
 * maps each open window to its profile by opening a temporary `chrome://version`
 * tab — but deduplicates: once all known profiles have been seen, remaining
 * windows are assigned to the profile that already claimed the most windows
 * (avoids flashing tabs in every window of a multi-window profile).
 */
export async function discoverProfiles(): Promise<ChromeProfile[]> {
  const localState = readLocalState(CHROME_DIR);
  const knownProfileCount = localState?.size ?? 0;

  const script = `
tell application "Google Chrome"
  set results to {}
  set seenPaths to {}
  set profileCount to ${String(knownProfileCount)}
  repeat with w in windows
    set wId to id of w as text
    -- If we've found all known profiles, just record the window ID without probing
    if (count of seenPaths) >= profileCount and profileCount > 0 then
      set end of results to wId & "|||__SKIP__"
    else
      try
        set newTab to (make new tab at end of tabs of w with properties {URL:"chrome://version"})
        delay 1
        repeat 10 times
          if (loading of newTab) is false then exit repeat
          delay 0.3
        end repeat
        set profilePath to (execute newTab javascript "document.getElementById('profile_path')?.textContent?.trim() || ''")
        close newTab
        set end of results to wId & "|||" & profilePath
        if profilePath is not in seenPaths then
          set end of seenPaths to profilePath
        end if
      on error
        set end of results to wId & "|||__BLOCKED__"
      end try
    end if
  end repeat
  set AppleScript's text item delimiters to "\\n"
  return results as text
end tell`;

  const output = await runAppleScript(script, 90_000);
  const lines = output.split("\n").filter((l) => l.includes("|||"));

  const rawEntries: RawWindowProfile[] = lines.map((line) => {
    const [windowId, profilePath] = line.split("|||") as [string, string];
    const trimmed = profilePath.trim();
    return {
      windowId: windowId.trim(),
      profilePath:
        trimmed === "__BLOCKED__" || trimmed === "__SKIP__" || trimmed.length === 0
          ? null
          : trimmed,
    };
  });

  const byPath = new Map<string, string[]>();
  let blockedCount = 0;
  const skippedWindowIds: string[] = [];

  for (const entry of rawEntries) {
    if (entry.profilePath === null) {
      if (lines.find((l) => l.startsWith(entry.windowId))?.includes("__BLOCKED__")) {
        blockedCount++;
      } else {
        skippedWindowIds.push(entry.windowId);
      }
      continue;
    }
    const existing = byPath.get(entry.profilePath);
    if (existing) {
      existing.push(entry.windowId);
    } else {
      byPath.set(entry.profilePath, [entry.windowId]);
    }
  }

  // Assign skipped windows to the profile with the most windows (most likely match)
  if (skippedWindowIds.length > 0 && byPath.size > 0) {
    let largest: string[] = [];
    for (const ids of byPath.values()) {
      if (ids.length > largest.length) largest = ids;
    }
    largest.push(...skippedWindowIds);
  }

  const profiles: ChromeProfile[] = [];
  for (const [path, windowIds] of byPath) {
    const localInfo = localState?.get(path);
    const name = localInfo?.name ?? readPreferences(path).name;
    const email = localInfo?.user_name ?? readPreferences(path).email;
    profiles.push({
      path,
      name,
      ...(email !== undefined && email.length > 0 ? { email } : {}),
      windowIds,
    });
  }

  if (blockedCount > 0 && profiles.length === 0) {
    throw new AichatctlError(
      `Found ${String(blockedCount)} Chrome profile(s) but none allow JavaScript from Apple Events. ` +
        "Enable it in each profile: View → Developer → Allow JavaScript from Apple Events.",
    );
  }

  return profiles;
}

function formatProfileList(profiles: ChromeProfile[], blockedCount: number): string {
  const lines = profiles.map((p) => {
    const account = p.email !== undefined ? `(${p.email})` : "(no account)";
    const windows = p.windowIds.length === 1 ? "1 window" : `${String(p.windowIds.length)} windows`;
    return `  • "${p.name}" ${account} — ${windows}`;
  });
  if (blockedCount > 0) {
    lines.push(
      `  • (${String(blockedCount)} profile(s) with JS blocked — enable View → Developer → Allow JavaScript from Apple Events)`,
    );
  }
  return lines.join("\n");
}

/**
 * Resolves a profile hint to exactly one Chrome profile.
 * Throws with an actionable error if zero or multiple profiles match.
 */
export async function resolveProfile(hint: ProfileHint): Promise<ChromeProfile> {
  if (hint.account === undefined && hint.name === undefined) {
    throw new AichatctlError("Profile hint must include at least one of: account (email) or name.");
  }

  const all = await discoverProfiles();

  // Count blocked profiles for error reporting
  const script = `
tell application "Google Chrome"
  set total to count of windows
  return total as text
end tell`;
  let blockedCount = 0;
  try {
    const totalWindows = Number.parseInt(await runAppleScript(script, 5000), 10);
    const discoveredWindows = all.reduce((sum, p) => sum + p.windowIds.length, 0);
    blockedCount = Math.max(0, totalWindows - discoveredWindows);
  } catch {
    // Non-critical — just affects error messaging
  }

  const matches = all.filter((p) => {
    if (hint.account !== undefined) {
      if (p.email === undefined) return false;
      if (p.email.toLowerCase() !== hint.account.toLowerCase()) return false;
    }
    if (hint.name !== undefined) {
      if (!p.name.toLowerCase().includes(hint.name.toLowerCase())) return false;
    }
    return true;
  });

  if (matches.length === 1) {
    const match = matches[0];
    if (match !== undefined) return match;
  }

  const hintDesc = [
    hint.account !== undefined ? `--browser-account "${hint.account}"` : null,
    hint.name !== undefined ? `--browser-profile "${hint.name}"` : null,
  ]
    .filter(Boolean)
    .join(" + ");

  if (matches.length === 0) {
    throw new AichatctlError(
      `${hintDesc} matched 0 profiles.\n\nDiscovered Chrome profiles:\n${formatProfileList(all, blockedCount)}\n\nProvide --browser-account <email> or --browser-profile <name> to select one.`,
    );
  }

  throw new AichatctlError(
    `${hintDesc} matched ${String(matches.length)} profiles (need exactly 1).\n\nMatches:\n${formatProfileList(matches, 0)}\n\nNarrow the hint to select exactly one profile.`,
  );
}
