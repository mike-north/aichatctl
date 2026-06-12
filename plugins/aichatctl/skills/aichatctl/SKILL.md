---
name: aichatctl
description: Use when the user wants to sync repo files into a Claude.ai or ChatGPT project's file library, keep that library up to date with a git source of truth, or create a new seeded web chat session (e.g. to continue by voice on mobile). Drives the web UIs via the deterministic `aichatctl` CLI — the agent reasons about WHAT to do; the CLI does the browser mechanics.
---

# aichatctl

`aichatctl` drives the Claude.ai and ChatGPT web UIs over the Chrome DevTools
Protocol to do two things there is no public API for:

1. **Sync** a declared subset of repo files (and project instructions) into a
   project's file library, so the web project tracks the git source of truth.
2. **Seed a session**: create a new chat inside a project, pre-filled with a
   prompt and started — ready to continue from the mobile app (e.g. by voice).

## The contract: you reason, the CLI executes

**Never drive the browser yourself** (no screenshot-and-click loops). All browser
mechanics are deterministic and belong to the CLI. Your job is the reasoning:
deciding what to sync and composing the seed prompt. Always pass `--json` and
parse the result.

## Prerequisites (check first)

The CLI attaches to a Chrome started with remote debugging, using a dedicated
automation profile the user signs into once.

```bash
aichatctl doctor --json    # verify CDP reachable + logged in + selectors OK
```

If `cdpReachable` is false, tell the user to run `aichatctl browser launch` and
sign in to claude.ai / chatgpt.com in the window that opens. If `loggedIn` is
false for a platform, they need to sign in there. If a selector probe is
`MISSING`, the web UI drifted — point them at the platform's `selectors.ts`.

## Use case 1 — sync project files

The manifest `aichatctl.config.yaml` (repo root) declares, per platform, the
target project and which local files/instructions to mirror. **Always dry-run
first**, show the plan, then apply.

```bash
aichatctl sync --dry-run --json          # preview the upload/replace/delete plan
aichatctl sync --json                     # apply it
aichatctl sync --platform claude --json   # limit to one platform
```

Only files aichatctl has previously synced are ever deleted — files the user
added manually in the web UI are left untouched.

## Use case 2 — seed a voice-ready session

Compose the seed prompt yourself from the current context (notes, plan, recent
work), then:

```bash
# prompt from a file you wrote:
aichatctl session create --platform claude --project "My Project" --seed-file scratch/seed.md --json
# or pipe a prompt you composed:
echo "$PROMPT" | aichatctl session create --platform chatgpt --project "<url-or-name>" --seed-file - --json
```

The JSON result includes the conversation `url`. Give it to the user; they open
the platform's mobile app and continue (e.g. tap voice). Use `--no-send` to
stage the prompt without submitting it.

## Reference

- `--project` accepts a project name, URL, or id.
- `--port` overrides the CDP port (default 9222).
- Full setup, the macOS profile caveat, and live selector calibration are in the
  project README.
