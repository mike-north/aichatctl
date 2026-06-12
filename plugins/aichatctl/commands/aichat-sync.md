---
description: Sync repo files and instructions into a Claude.ai/ChatGPT project library, with a dry-run preview first.
argument-hint: [optional: --platform claude|chatgpt]
---

You are syncing the repo's declared files into a web project's file library so it
tracks the git source of truth. Extra arguments: `$ARGUMENTS`.

Steps:

1. Confirm a manifest exists at `aichatctl.config.yaml` (repo root). If not, help
   the user create one — per platform: the target `project` (name or URL), an
   optional `instructions` markdown path, and `files` globs.
2. Run `aichatctl doctor --json`. If CDP is unreachable or a target platform is
   not logged in, tell the user to run `aichatctl browser launch` and sign in,
   then stop.
3. **Preview** the plan:
   ```bash
   aichatctl sync --dry-run --json $ARGUMENTS
   ```
   Summarize the upload/replace/delete/noop steps for the user.
4. If the plan looks right, apply it:
   ```bash
   aichatctl sync --json $ARGUMENTS
   ```
5. Report what changed. Note that only files aichatctl previously synced are ever
   deleted; manually-added files in the web UI are left alone.

Do not drive the browser yourself — the CLI handles all of that.
