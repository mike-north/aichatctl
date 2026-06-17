---
"@aichatctl/sdk": minor
"aichatctl": minor
"@aichatctl/mcp": minor
---

Remove the CDP/Playwright transport entirely — AppleScript (the user's real, logged-in Chrome on macOS) is now the only transport.

**Breaking changes:**

- CLI: removed the `--transport` flag (everywhere), the `--port`/`-p` flag, and the `aichatctl browser launch` command. `aichatctl doctor` now checks only Chrome's "Allow JavaScript from Apple Events" toggle + per-platform login. All commands drive your real Chrome directly.
- MCP: tool inputs no longer accept `transport`/`port`; `aichat_doctor` reports the AppleScript readiness check only.
- SDK: removed `BrowserSession`, `launchChrome`, `findChromeExecutable`, `isCdpReachable`, `createDriver`, `doctor`/`DoctorReport`/`DoctorOptions`, `DEFAULT_CDP_PORT`, `chromeProfileDir`, `NamedSelector`, `SelftestResult`, `SelectorProbe`, `ConnectionOptions`, `BrowserNotReachableError`, `SelectorError`, and the `Driver.selftest` method. `createSeededSessionViaApplescript` is now just `createSeededSession`. Dropped the `playwright-core` dependency.

The CDP path connected to a dedicated automation Chrome profile that was never signed into the user's real Claude/ChatGPT/NotebookLM sessions, so it could not perform the actual work — and offering it as a transport choice let callers select a path that silently could not succeed.
