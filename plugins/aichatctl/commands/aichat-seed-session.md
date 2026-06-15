---
description: Create a new seeded Claude.ai/ChatGPT/Gemini chat session in a project, ready to continue by voice on mobile.
argument-hint: [platform] [project name or url]
---

You are creating a seeded web chat session the user can continue from their phone
(e.g. by voice). The arguments are: `$ARGUMENTS` (platform = claude|chatgpt|gemini,
and a project name or URL — ask if either is missing). For Gemini, the project is a
Gem URL/id or `new` for a plain chat (Gemini is seed-only).

Steps:

1. **Compose the seed prompt** from the current context — what the user is working
   on, relevant notes, the question or task they'd want to talk through. This is
   the part that needs your reasoning. Write it to `scratch/seed.md`.
2. Show the user the prompt you composed and confirm the target project.
3. Create the session (use the AppleScript transport on macOS; it needs Chrome's
   "Allow JavaScript from Apple Events" toggle — preflight with
   `aichatctl doctor --transport applescript --json`):
   ```bash
   aichatctl session create --transport applescript --platform <p> --project "<ref>" --seed-file scratch/seed.md --json
   ```
   If `doctor` reports the toggle is off or the platform isn't logged in, tell the
   user how to fix it, then retry. (On non-macOS, use `--transport cdp` after
   `aichatctl browser launch`; Gemini supports AppleScript only.)
4. Return the conversation `url` from the JSON and tell the user they can open it in
   the mobile app and tap voice to continue.

Flags: `--no-send` stages the prompt without sending (for review).
Do not drive the browser yourself — the CLI handles all of that.
