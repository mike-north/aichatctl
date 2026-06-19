# Manual test — `conversation pull` (live calibration)

Cannot run in CI (needs a real logged-in Chrome on macOS).

1. Open a Claude conversation with at least one assistant reply.
2. `aichatctl conversation pull --platform claude --conversation <url> --json`
   Expect `{ "platform": "claude", "url": "…", "text": "<the last assistant message>" }`.
3. Repeat with a ChatGPT conversation and `--platform chatgpt`.
4. Add `--out findings.md`; expect the file to contain the message text and the
   summary to report the character count + path.

If `text` is empty or the command reports "no assistant message found",
recalibrate the selectors in `packages/sdk/src/drivers/applescript/conversation.ts`.
