# aichatctl

Drive the **Claude.ai** and **ChatGPT** web interfaces from agents — to keep a
project's file library in sync with a git source of truth, and to create seeded
chat sessions you can continue by voice on mobile.

These platforms expose no public API for project files or project-scoped chat
creation, so `aichatctl` does it the only reliable way: deterministic DOM
automation (Playwright) against your **real, logged-in Chrome**, attached over
the Chrome DevTools Protocol. Agents handle the reasoning (what to sync, what
prompt to seed); the tool handles every click.

## Why

- **Project files rot.** You upload a spec to a Claude/ChatGPT project, the spec
  changes in the repo, and the uploaded copy silently goes stale. `aichatctl sync`
  mirrors a declared subset of repo files into the project library on demand.
- **Voice-ready handoff.** A local agent composes a prompt, `aichatctl` creates a
  new chat in the right project and starts it; you open the mobile app and talk.

## Layout

| Package | What it is |
| --- | --- |
| `@aichatctl/sdk` | The engine: CDP attach, per-platform drivers, sync engine |
| `aichatctl` (CLI) | Thin command-line over the SDK; `--json` everywhere |
| `@aichatctl/mcp` | MCP server exposing the operations as agent tools |
| `plugins/aichatctl` | Claude Code plugin (skill + `/aichat-sync`, `/aichat-seed-session`) |

## Setup

```bash
pnpm install
pnpm build
```

### Browser & login (one-time)

`aichatctl` attaches to Chrome over CDP. Recent Chrome refuses remote debugging on
your *default* profile, so the tool uses a **dedicated automation profile** you
sign into once:

```bash
node packages/cli/dist/bin.js browser launch
# Sign in to claude.ai and chatgpt.com in the window that opens.
aichatctl doctor   # verify: CDP reachable + logged in + selectors resolve
```

The profile lives under `~/.config/aichatctl/chrome-profile` and persists across
runs. It is real Google Chrome with real cookies — just isolated from everyday
browsing so it is allowed to expose the debugging port.

## Usage

```bash
# Sync repo files + instructions into project libraries (preview, then apply)
aichatctl sync --dry-run
aichatctl sync

# Create a seeded session and get its URL
aichatctl session create --platform claude --project "My Project" --seed-file notes.md --json
```

Copy `aichatctl.config.example.yaml` to `aichatctl.config.yaml` and edit it to
declare your projects and file globs.

## Claude Code plugin

```
/plugin marketplace add /path/to/aichatctl
/plugin install aichatctl@aichatctl-marketplace
```

Then use `/aichat-sync` and `/aichat-seed-session`, or just ask — the `aichatctl`
skill activates automatically. Cross-platform plugin builds (Codex, etc.) are
produced with [`aipm`](https://github.com/ai-plugin-marketplace/tools).

## ⚠️ Live selector calibration

The per-platform locators in `packages/sdk/src/drivers/<platform>/selectors.ts`
are best-effort and **must be calibrated against the live, logged-in UI** before
the file-management and session flows are fully reliable. `aichatctl doctor`
reports which selectors resolve; fix failing ones with Playwright codegen:

```bash
pnpm exec playwright codegen https://claude.ai
pnpm exec playwright codegen https://chatgpt.com
```

Because every locator lives in that one file per platform, UI drift is always a
single-file fix.

## Verifying end-to-end (UAT)

With Chrome launched and logged in:

1. **Seeded session** — `aichatctl session create --platform claude --project "<name>" --seed-file scratch/notes.md --json`,
   then open the printed URL on desktop and on the mobile app; confirm it is in
   the right project and started.
2. **Sync** — edit a tracked file, `aichatctl sync --dry-run` should show exactly
   that file as `replace`; `aichatctl sync` applies it; confirm the project's file
   list updated. Remove a tracked file and confirm a `delete` step.

## Notes

`aichatctl` operates *your own* authenticated personal accounts for personal
productivity, at human pace. It performs no credential harvesting and stores no
passwords (the browser profile holds your normal session cookies).
