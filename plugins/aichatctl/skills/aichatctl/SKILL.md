---
name: aichatctl
description: Use when the user wants to sync repo files (and instructions) into a Claude.ai or ChatGPT project, keep that project up to date with a git source of truth, or create a new seeded web chat session (e.g. to continue by voice on mobile). Drives the real, logged-in web UIs via the deterministic `aichatctl` CLI — the agent reasons about WHAT to do; the CLI does the browser mechanics.
---

# aichatctl

`aichatctl` drives the Claude.ai and ChatGPT web UIs to do two things there is no
public API for — on **both platforms**:

1. **Sync** a declared subset of repo files (and the project instructions) into a
   project, so the web project tracks the git source of truth.
2. **Seed a session**: create a new chat inside a project, pre-filled with a
   prompt and started — ready to continue from the mobile app (e.g. by voice).

## The contract: you reason, the CLI executes

**Never drive the browser yourself** (no screenshot-and-click loops). All browser
mechanics are deterministic and belong to the CLI/extension. Your job is the
reasoning: deciding what to sync and composing the seed prompt. Always pass
`--json` and parse the result.

## Prerequisite: the bridge + extension

The primary transport drives the user's real, logged-in Chrome via an in-browser
extension over a localhost bridge. Before running commands, the bridge daemon must
be running and the extension loaded/connected:

- If a command errors with "No extension connected to the bridge", tell the user
  to run `aichatctl bridge serve` (long-running) and load the unpacked extension
  from `extension/` in Chrome (chrome://extensions → Load unpacked), pasting the
  token from `aichatctl bridge token` into its options page once.
- The CLI reads the bridge token automatically; you don't pass it.

Pass `--transport extension` on the commands below.

## Use case 1 — sync project files + instructions

The manifest `aichatctl.config.yaml` (repo root) declares, per platform, the
target project, an optional instructions markdown file, and which local file globs
to mirror. **Always dry-run first**, show the plan, then apply.

```bash
aichatctl sync --transport extension --dry-run --json    # preview upload/replace/delete + instructions
aichatctl sync --transport extension --json              # apply it
aichatctl sync --transport extension --platform chatgpt --json   # one platform
```

Only files aichatctl previously synced are ever deleted — files the user added
manually in the web UI are left untouched.

## Use case 2 — seed a voice-ready session

Compose the seed prompt yourself from the current context (notes, plan, recent
work), then:

```bash
aichatctl session create --transport extension \
  --platform claude --project "My Project" --seed-file scratch/seed.md --json
```

The JSON result includes the conversation `url`. Give it to the user; they open
the platform's mobile app and continue. Flags: `--no-send` stages without
submitting; `--background` seeds in an inactive tab (unattended, via chrome.debugger).

## Reference

- `--project` accepts a project name, URL, or id (name resolution works on both platforms).
- Default transport is `cdp` (a dedicated Playwright profile, fallback); prefer `--transport extension`.
- Diagnostics for UI drift: `aichatctl bridge call screenshot|inspectProject|evalInProject|reloadSelf`.
- Full setup, the security model, and the one internal-API exception (ChatGPT
  instructions) are in the project README.
