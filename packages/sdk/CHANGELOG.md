# @aichatctl/sdk

## 1.0.0

### Major Changes

- [#3](https://github.com/mike-north/aichatctl/pull/3) [`65089fc`](https://github.com/mike-north/aichatctl/commit/65089fcf1ebe2239051a278ff1c3d89daa49fd72) Thanks [@mike-north](https://github.com/mike-north)! - Replace the monolithic `notebook create` command with granular, observable operations:
  `notebook new`, `notebook rename`, `notebook sources list/add/remove`, and
  `notebook podcast create`. Each returns verifiable output so agents can confirm
  state between steps instead of assuming success.

### Minor Changes

- [#12](https://github.com/mike-north/aichatctl/pull/12) [`a937513`](https://github.com/mike-north/aichatctl/commit/a937513a2e6ec597037cfcc47d5c8b16beac19e4) Thanks [@mike-north](https://github.com/mike-north)! - Add `conversation pull`: fetch the latest assistant message from a Claude or ChatGPT conversation back to the caller (optionally to a file via `--out`), closing the seed → talk → read-back loop.

- [#8](https://github.com/mike-north/aichatctl/pull/8) [`8a291bb`](https://github.com/mike-north/aichatctl/commit/8a291bb378778cb2f4e87e707adc74aefbb1846d) Thanks [@mike-north](https://github.com/mike-north)! - Add `notebook status`: report the state of a NotebookLM notebook's Studio artifacts (Audio Overviews today) with a best-effort `type`/`state`, so consumers can poll until an Audio Overview is ready.

- [#14](https://github.com/mike-north/aichatctl/pull/14) [`24cabab`](https://github.com/mike-north/aichatctl/commit/24cabab94a98dc68b27710c3d12b8312e7e2150a) Thanks [@mike-north](https://github.com/mike-north)! - Add `project create`: create a Claude or ChatGPT project from the CLI, optionally setting its instructions (`--instructions`/`--instructions-file`) and uploading seed files (`--file`, repeatable). AppleScript transport only.

- [#9](https://github.com/mike-north/aichatctl/pull/9) [`7353964`](https://github.com/mike-north/aichatctl/commit/735396452281dce3f0853c59e23f212c0c23d5c1) Thanks [@mike-north](https://github.com/mike-north)! - Remove the CDP/Playwright transport entirely — AppleScript (the user's real, logged-in Chrome on macOS) is now the only transport.

  **Breaking changes:**

  - CLI: removed the `--transport` flag (everywhere), the `--port`/`-p` flag, and the `aichatctl browser launch` command. `aichatctl doctor` now checks only Chrome's "Allow JavaScript from Apple Events" toggle + per-platform login. All commands drive your real Chrome directly.
  - MCP: tool inputs no longer accept `transport`/`port`; `aichat_doctor` reports the AppleScript readiness check only.
  - SDK: removed `BrowserSession`, `launchChrome`, `findChromeExecutable`, `isCdpReachable`, `createDriver`, `doctor`/`DoctorReport`/`DoctorOptions`, `DEFAULT_CDP_PORT`, `chromeProfileDir`, `NamedSelector`, `SelftestResult`, `SelectorProbe`, `ConnectionOptions`, `BrowserNotReachableError`, `SelectorError`, and the `Driver.selftest` method. `createSeededSessionViaApplescript` is now just `createSeededSession`. Dropped the `playwright-core` dependency.

  The CDP path connected to a dedicated automation Chrome profile that was never signed into the user's real Claude/ChatGPT/NotebookLM sessions, so it could not perform the actual work — and offering it as a transport choice let callers select a path that silently could not succeed.

### Patch Changes

- [#2](https://github.com/mike-north/aichatctl/pull/2) [`b59e9f2`](https://github.com/mike-north/aichatctl/commit/b59e9f29456bd044a0f512220c446c6158a7b54c) Thanks [@mike-north](https://github.com/mike-north)! - The AppleScript transport now fails fast with a clear, actionable error on
  non-macOS platforms ("requires macOS … use the CDP transport") instead of a
  low-level `spawn osascript ENOENT`. This flows through to the CLI and MCP server
  (e.g. `aichat_session_create`/`aichat_notebook_create` with the AppleScript path).
