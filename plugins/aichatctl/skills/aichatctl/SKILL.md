---
name: aichatctl
description: Use when the user wants to sync repo files (and instructions) into a Claude.ai or ChatGPT project, keep that project up to date with a git source of truth, or create a new seeded web chat session (e.g. to continue by voice on mobile — Claude, ChatGPT, or Gemini). Drives the real, logged-in web UIs via the deterministic `aichatctl` CLI — the agent reasons about WHAT to do; the CLI does the browser mechanics.
---

# aichatctl

`aichatctl` drives the Claude.ai and ChatGPT web UIs to do two things there is no
public API for — on **both platforms**:

1. **Sync** a declared subset of repo files (and the project instructions) into a
   project, so the web project tracks the git source of truth.
2. **Seed a session**: create a new chat inside a project, pre-filled with a
   prompt and started — ready to continue from the mobile app (e.g. by voice).

**Google Gemini** is also supported, for **seed sessions only** (it has no project
file library to sync).

## The contract: you reason, the CLI executes

**Never drive the browser yourself** (no screenshot-and-click loops). All browser
mechanics are deterministic and belong to the CLI. Your job is the reasoning:
deciding what to sync and composing the seed prompt. Always pass `--json` and
parse the result.

## Prerequisite: pick a transport

Two transports drive the user's real, logged-in Chrome:

- **`--transport applescript`** (primary, macOS) — drives Chrome with no
  extension via `osascript`. It needs one toggle: Chrome → View → Developer →
  **Allow JavaScript from Apple Events**. Preflight with
  `aichatctl doctor --transport applescript --json` (checks the toggle + login per
  platform). **Gemini requires this transport.**
- **`--transport cdp`** (fallback, default) — a dedicated Playwright automation
  profile (`aichatctl browser launch`, then sign in once). For non-macOS or
  headless use.

If `doctor` reports the Apple Events toggle is off or a platform isn't logged in,
tell the user how to fix it, then retry.

## Use case 1 — sync project files + instructions

The manifest `aichatctl.config.yaml` (repo root) declares, per platform, the
target project, an optional instructions markdown file, and which local file globs
to mirror. **Always dry-run first**, show the plan, then apply.

```bash
aichatctl sync --transport applescript --dry-run --json    # preview upload/replace/delete + instructions
aichatctl sync --transport applescript --json              # apply it
aichatctl sync --transport applescript --platform chatgpt --json   # one platform
```

Only files aichatctl previously synced are ever deleted — files the user added
manually in the web UI are left untouched.

## Use case 2 — seed a voice-ready session

Compose the seed prompt yourself from the current context (notes, plan, recent
work), then:

```bash
aichatctl session create --transport applescript \
  --platform claude --project "My Project" --seed-file scratch/seed.md --json

# Gemini (seed only): --project is a Gem URL/id, or "new" for a plain chat
aichatctl session create --transport applescript \
  --platform gemini --project new --seed-file scratch/seed.md --json
```

The JSON result includes the conversation `url`. Give it to the user; they open
the platform's mobile app and continue. `--no-send` stages the prompt without
submitting.

## Reference

- `--project` accepts a project name, URL, or id (name resolution works on Claude
  and ChatGPT). For Gemini it is a Gem URL/id, or `new` for a plain chat.
- Full setup, the security model, and the one internal-API exception (ChatGPT
  instructions) are in the project README.
