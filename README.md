# aichatctl

Drive the **Claude.ai** and **ChatGPT** web interfaces from agents — to keep a
project's file library in sync with a git source of truth, and to create seeded
chat sessions you can continue by voice on mobile. **Google Gemini** is also
supported for seeded sessions (it has no project file library to sync).

These platforms expose no public API for project files, instructions, or
project-scoped chat creation. `aichatctl` does it deterministically against your
**real, logged-in Chrome** — fixed code, no model in the loop, no tokens spent on
the browser. Agents handle the reasoning (what to sync, what prompt to seed); the
tool handles every click.

| Capability | Claude.ai | ChatGPT | Gemini |
| --- | :-: | :-: | :-: |
| Discover projects (by name / URL) | ✅ | ✅ | n/a² |
| Seed a session | ✅ | ✅ | ✅ |
| File library: upload / list / delete | ✅ | ✅ | n/a² |
| Sync (idempotent upload → no-op) | ✅ | ✅ | n/a² |
| Project instructions sync | ✅ | ✅¹ | n/a² |

¹ ChatGPT instructions are the one operation with no drivable UI save, so they
use ChatGPT's own internal endpoint, authenticated through your live session (see
[How it works](#how-it-works)). Everything else is UI-driven.

² Gemini has no project file library or instructions, so it is **seed-sessions
only**.

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
| `@aichatctl/sdk` | The engine: platform drivers, transports, sync engine |
| `aichatctl` (CLI) | Thin command-line over the SDK; `--json` everywhere |
| `@aichatctl/mcp` | MCP server exposing the operations as agent tools |
| `plugins/aichatctl` | Agent plugin (skill + `/aichat-sync`, `/aichat-seed-session`) |

## Setup

```bash
pnpm install
pnpm build
```

Copy `aichatctl.config.example.yaml` to `aichatctl.config.yaml` and declare your
projects, file globs, and (optionally) an instructions markdown file.

### Transports

`aichatctl` drives your **real, logged-in Chrome** through one of two transports:

- **AppleScript (primary, macOS).** `--transport applescript` drives Chrome with
  no extension — `osascript` executes JS in the tab. It needs **one toggle**:
  Chrome → View → Developer → **Allow JavaScript from Apple Events**. Preflight
  with `aichatctl doctor --transport applescript`.
- **CDP (fallback, default).** `--transport cdp` drives a Playwright connection to
  a dedicated automation Chrome profile (`aichatctl browser launch`, then sign in
  once) — for non-macOS or headless/unattended use. Recent Chrome refuses
  `--remote-debugging-port` on the *default* profile, hence the dedicated one.

```bash
# AppleScript: enable the toggle, then preflight (checks toggle + per-platform login)
aichatctl doctor --transport applescript

# CDP: launch the dedicated profile and sign in once
aichatctl browser launch
aichatctl doctor
```

## Usage

```bash
# Sync repo files + instructions into project libraries (preview, then apply)
aichatctl sync --transport applescript --dry-run
aichatctl sync --transport applescript
aichatctl sync --transport applescript --platform chatgpt   # limit to one platform

# Seed a session and get its URL (--project takes a name, URL, or id)
aichatctl session create --transport applescript \
  --platform claude --project "My Project" --seed-file notes.md --json

# Seed a Gemini chat (seed-only): --project is a Gem URL/id, or "new" for a plain chat
aichatctl session create --transport applescript \
  --platform gemini --project new --seed-file notes.md --json
```

The JSON result of `session create` includes the conversation `url` — open it in
the mobile app and continue (e.g. tap voice). `--no-send` stages the prompt
without submitting. Sync only ever deletes files **it** previously synced; files
you added manually in the web UI are left untouched.

## How it works

- **UI-driven, deterministically.** The per-platform drivers run fixed code
  against the logged-in web UIs — navigation, uploads, clicks, typing, send. No
  model is in the loop and no tokens are spent driving the browser.
- **AppleScript transport.** `osascript` runs JS in the tab via Chrome's
  `execute javascript`. That call doesn't await promises, so page JS uses
  synchronous `XMLHttpRequest` for any network call. File operations use each
  platform's own endpoints (Claude docs API; ChatGPT register → blob PUT →
  process → associate) rather than the native file picker, which would need
  Accessibility permission. macOS-only.
- **CDP transport.** Playwright against the dedicated automation profile. Its
  per-platform selectors live in `packages/sdk/src/drivers/<platform>/selectors.ts`
  and are best-effort — calibrate with `aichatctl doctor` before relying on it.
- **Internal API, only where the UI fails.** Driving the UI is preferred (no
  brittle API coupling). ChatGPT project *instructions* are the lone exception:
  the field fires no save under automation, so the driver calls ChatGPT's own
  `PATCH /backend-api/projects/{id}` from the page context — it carries your live
  session (cookies + bearer from `/api/auth/session`); no credentials are stored.

### Per-transport capabilities

| Operation | Claude | ChatGPT | Gemini |
| --- | :-: | :-: | :-: |
| Seed session, resolve project, login check | ✅ | ✅ | ✅ (AppleScript only) |
| File library: upload / read / delete | ✅ (docs API) | ✅ (files API) | n/a |
| Instructions sync | ✅ (UI flow) | ✅ (internal API) | n/a |

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
