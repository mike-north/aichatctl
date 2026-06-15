---
description: Turn repo files and links into a NotebookLM notebook with a generated audio podcast.
argument-hint: [optional: files/urls or a topic]
---

You are creating a NotebookLM notebook and kicking off an audio overview
("podcast") the user can listen to on mobile. Extra arguments: `$ARGUMENTS`.

Steps:

1. **Decide the sources** from the current context and `$ARGUMENTS`: which repo
   files (or directories) and/or URLs should seed the notebook. Confirm the set
   with the user if it's ambiguous.
2. **Compose the host-focus prompt** — what the AI hosts should emphasize (the
   angle, audience, or depth). This is the part that needs your reasoning.
3. Pick a format (`deep-dive` default, or `brief` / `critique` / `debate`) and
   length (`short` / `default` / `long`); confirm with the user if unsure.
4. Create the notebook and start generation:
   ```bash
   aichatctl notebook create \
     --source <file-or-dir>... --source-url <url>... \
     --format <format> --length <length> \
     --prompt "<focus for the hosts>" --json
   ```
5. Return the notebook `url` from the JSON and tell the user the podcast is
   generating — they can open the URL on mobile and listen once it's ready.

Each file becomes a text source and each URL its own source. Do not drive the
browser yourself — the CLI handles all of it.
