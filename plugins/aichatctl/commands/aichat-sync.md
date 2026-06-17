---
description: Sync repo files and instructions into a Claude.ai/ChatGPT project, with a dry-run preview first.
argument-hint: [optional: --platform claude|chatgpt]
---

You are syncing the repo's declared files (and instructions) into a web project so
it tracks the git source of truth. Extra arguments: `$ARGUMENTS`.

Steps:

1. Confirm a manifest exists at `aichatctl.config.yaml` (repo root). If not, help
   the user create one — per platform: the target `project` (name, URL, or id), an
   optional `instructions` markdown path, and `files` globs. (Gemini has no file
   library and is not a sync target.)
2. **Preview** the plan (`aichatctl` uses Chrome's "Allow JavaScript from Apple Events"
   toggle — preflight with `aichatctl doctor --json`):
   ```bash
   aichatctl sync --dry-run --json $ARGUMENTS
   ```
   If `doctor` reports the toggle is off or a platform isn't logged in, tell the
   user how to fix it, then stop. Otherwise summarize the
   upload/replace/delete/noop steps + instructions plan.
3. If the plan looks right, apply it:
   ```bash
   aichatctl sync --json $ARGUMENTS
   ```
4. Report what changed. Note that only files aichatctl previously synced are ever
   deleted; manually-added files in the web UI are left alone.

Do not drive the browser yourself — the CLI handles all of that.
