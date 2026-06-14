# aichatctl

Drive the **Claude.ai** and **ChatGPT** web interfaces from agents — to keep a
project's file library in sync with a git source of truth, and to create seeded
chat sessions you can continue by voice on mobile.

These platforms expose no public API for project files, instructions, or
project-scoped chat creation. `aichatctl` does it deterministically against your
**real, logged-in Chrome** via a small in-browser extension driven over a
localhost bridge — fixed code, no model in the loop, no tokens spent on the
browser. Agents handle the reasoning (what to sync, what prompt to seed); the
tool handles every click.

Both use cases work on **both platforms**, end to end:

| Capability | Claude.ai | ChatGPT |
| --- | :-: | :-: |
| Discover projects (by name / URL) | ✅ | ✅ |
| Seed a session (foreground + background) | ✅ | ✅ |
| File library: upload / list / delete | ✅ | ✅ |
| Sync (idempotent upload → no-op) | ✅ | ✅ |
| Project instructions sync | ✅ | ✅¹ |

¹ ChatGPT instructions are the one operation with no drivable UI save, so they
use ChatGPT's own internal endpoint, authenticated through your live session (see
[How it works](#how-it-works)). Everything else is UI-driven.

## Why

- **Project files rot.** You upload a spec to a Claude/ChatGPT project, the spec
  changes in the repo, and the uploaded copy silently goes stale. `aichatctl sync`
  mirrors a declared subset of repo files (and the instructions) into the project
  on demand.
- **Voice-ready handoff.** A local agent composes a prompt, `aichatctl` creates a
  new chat in the right project and starts it; you open the mobile app and talk.

## Layout

| Piece | What it is |
| --- | --- |
| `@aichatctl/sdk` | The engine: platform drivers, sync engine, the localhost bridge |
| `aichatctl` (CLI) | Thin command-line over the SDK; `--json` everywhere |
| `@aichatctl/mcp` | MCP server exposing the operations as agent tools |
| `extension/` | Unpacked MV3 extension that runs the deterministic actions in your real Chrome |
| `plugins/aichatctl` | Agent plugin (skill + `/aichat-sync`, `/aichat-seed-session`) |

## Setup

```bash
pnpm install
pnpm build
```

### Bridge + extension (one-time)

```bash
# 1. Start the bridge daemon (long-running). It auto-creates a token and prints it.
aichatctl bridge serve            # token stored in ~/.config/aichatctl/bridge-token

# 2. Load the unpacked extension in your everyday Chrome:
#    chrome://extensions -> Developer mode -> Load unpacked -> ./extension
#    Open its options page once and paste the token (`aichatctl bridge token` prints it).
```

The bridge requires the token by default, so a stray localhost process can't drive
your browser; the CLI reads it automatically. The extension self-heals its
connection (it reconnects across daemon restarts via `chrome.alarms`).
`aichatctl bridge serve --no-auth` disables auth (insecure; localhost only).

Copy `aichatctl.config.example.yaml` to `aichatctl.config.yaml` and declare your
projects, file globs, and (optionally) an instructions markdown file.

## Usage

```bash
# Sync repo files + instructions into project libraries (preview, then apply)
aichatctl sync --transport extension --dry-run
aichatctl sync --transport extension
aichatctl sync --transport extension --platform chatgpt   # limit to one platform

# Seed a session and get its URL (--project takes a name, URL, or id)
aichatctl session create --transport extension \
  --platform claude --project "My Project" --seed-file notes.md --json

# Background/unattended seed (opens an inactive tab via chrome.debugger):
aichatctl session create --transport extension --background \
  --platform chatgpt --project "My Project" --seed-file notes.md --json
```

The JSON result of `session create` includes the conversation `url` — open it in
the mobile app and continue (e.g. tap voice). `--no-send` stages the prompt
without submitting. Sync only ever deletes files **it** previously synced; files
you added manually in the web UI are left untouched.

## How it works

- **Extension transport (primary).** The MV3 extension in `extension/` runs the
  driver actions in your real, logged-in tabs. It sidesteps Chrome 136+'s block on
  `--remote-debugging-port` for the default profile, and uses `chrome.debugger`
  (CDP) for the parts the DOM can't do from a content script — `DOM.setFileInputFiles`
  for uploads, trusted input for background seeding. React controls (ChatGPT tabs,
  menus) are driven with dispatched mouse events, not synthetic `.click()`.
- **CDP transport (fallback).** `--transport cdp` (the default) drives a
  Playwright connection to a dedicated automation Chrome profile
  (`aichatctl browser launch`), for headless/unattended use without the extension.
  Its per-platform selectors live in `packages/sdk/src/drivers/<platform>/selectors.ts`
  and are best-effort — calibrate with `aichatctl doctor` before relying on it.
- **Internal API, only where the UI fails.** Driving the UI is preferred (no
  brittle API coupling). ChatGPT project *instructions* are the lone exception:
  the field fires no save under automation, so the extension calls ChatGPT's own
  `PATCH /backend-api/projects/{id}` from the page context — it carries your live
  session (cookies + bearer from `/api/auth/session`); no credentials are stored.

## Extension-free transport (AppleScript) — for locked-down Macs

Some managed Macs allow installing apps but **block Chrome extensions**. For those,
`--transport applescript` drives your real, logged-in Chrome with no extension —
`osascript` executes JS in the tab. It needs **one toggle**: Chrome → View →
Developer → **Allow JavaScript from Apple Events**.

```bash
aichatctl session create --transport applescript --platform claude --project "My Project" --seed-file notes.md --json
aichatctl sync --transport applescript          # ChatGPT file sync + instructions
```

What works extension-free today:

| Operation | Claude | ChatGPT |
| --- | :-: | :-: |
| Seed session, resolve project, login check | ✅ | ✅ |
| File library: upload / read / delete | ✅ (docs API) | ✅ (files API) |
| Instructions sync | UI flow | ✅ (internal API) |

Notes:
- AppleScript's `execute javascript` doesn't await promises, so page JS uses
  synchronous `XMLHttpRequest` for network calls.
- ChatGPT file upload uses ChatGPT's own endpoints (register → blob PUT →
  process → associate) rather than the native file picker, which would need
  Accessibility permission (often MDM-blocked in exactly these environments).
- Preflight with `aichatctl doctor --transport applescript` (checks the toggle +
  login per platform). This transport is **macOS-only** (it uses `osascript`).

## Diagnostics & calibration

Web UIs drift. When something stops resolving, the extension exposes diagnostic
commands over the bridge so you (or an agent) can recalibrate without guessing:

```bash
aichatctl bridge call screenshot     --params '{"projectUrl":"<url>"}'   # see the page
aichatctl bridge call inspectProject --params '{"platform":"claude","projectUrl":"<url>"}'
aichatctl bridge call evalInProject  --params '{"projectUrl":"<url>","expression":"..."}'
aichatctl bridge call reloadSelf                                          # redeploy extension edits
```

Edit selectors in `extension/background.js`, then `aichatctl bridge call reloadSelf`
to redeploy without touching `chrome://extensions`.

## Agent plugin

```
/plugin marketplace add /path/to/aichatctl
/plugin install aichatctl@aichatctl-marketplace
```

Then use `/aichat-sync` and `/aichat-seed-session`, or just ask — the `aichatctl`
skill activates automatically. Cross-platform plugin builds (Codex, etc.) are
produced with [`aipm`](https://github.com/ai-plugin-marketplace/tools).

## Notes

`aichatctl` operates *your own* authenticated personal accounts for personal
productivity, at human pace. It stores no passwords (your Chrome session holds the
cookies) and never persists auth tokens.
