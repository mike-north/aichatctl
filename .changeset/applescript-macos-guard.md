---
"@aichatctl/sdk": patch
---

The AppleScript transport now fails fast with a clear, actionable error on
non-macOS platforms ("requires macOS … use the CDP transport") instead of a
low-level `spawn osascript ENOENT`. This flows through to the CLI and MCP server
(e.g. `aichat_session_create`/`aichat_notebook_create` with the AppleScript path).
