---
description: Create a new seeded Claude.ai/ChatGPT chat session in a project, ready to continue by voice on mobile.
argument-hint: [platform] [project name or url]
---

You are creating a seeded web chat session the user can continue from their phone
(e.g. by voice). The arguments are: `$ARGUMENTS` (platform = claude|chatgpt, and a
project name or URL — ask if either is missing).

Steps:

1. Run `aichatctl doctor --json`. If CDP is unreachable or the target platform is
   not logged in, tell the user to run `aichatctl browser launch` and sign in,
   then stop.
2. **Compose the seed prompt** from the current context — what the user is working
   on, relevant notes, the question or task they'd want to talk through. This is
   the part that needs your reasoning. Write it to `scratch/seed.md`.
3. Show the user the prompt you composed and confirm the target project.
4. Create the session:
   ```bash
   aichatctl session create --platform <p> --project "<ref>" --seed-file scratch/seed.md --json
   ```
5. Return the conversation `url` from the JSON and tell the user they can open it
   in the mobile app and tap voice to continue.

Use `--no-send` only if the user wants to review before the first message is sent.
Do not drive the browser yourself — the CLI handles all of that.
