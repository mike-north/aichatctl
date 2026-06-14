---
description: Create a new seeded Claude.ai/ChatGPT chat session in a project, ready to continue by voice on mobile.
argument-hint: [platform] [project name or url]
---

You are creating a seeded web chat session the user can continue from their phone
(e.g. by voice). The arguments are: `$ARGUMENTS` (platform = claude|chatgpt, and a
project name or URL — ask if either is missing).

Steps:

1. **Compose the seed prompt** from the current context — what the user is working
   on, relevant notes, the question or task they'd want to talk through. This is
   the part that needs your reasoning. Write it to `scratch/seed.md`.
2. Show the user the prompt you composed and confirm the target project.
3. Create the session:
   ```bash
   aichatctl session create --transport extension --platform <p> --project "<ref>" --seed-file scratch/seed.md --json
   ```
   If this errors with "No extension connected to the bridge", tell the user to run
   `aichatctl bridge serve` and load the unpacked `extension/` in Chrome (token from
   `aichatctl bridge token` into its options page once), then retry.
4. Return the conversation `url` from the JSON and tell the user they can open it in
   the mobile app and tap voice to continue.

Flags: `--no-send` stages the prompt without sending (for review); `--background`
seeds in an inactive tab without stealing focus (good for unattended runs).
Do not drive the browser yourself — the CLI/extension handles all of that.
