# @aichatctl/mcp

An [MCP](https://modelcontextprotocol.io) server exposing
[`aichatctl`](https://www.npmjs.com/package/aichatctl) operations as tools for any
MCP-capable client (Claude, agents, etc.).

```json
{
  "mcpServers": {
    "aichatctl": { "command": "npx", "args": ["-y", "@aichatctl/mcp"] }
  }
}
```

## Tools

| Tool                     | Does                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `aichat_doctor`          | Check transport readiness + login (CDP or AppleScript)            |
| `aichat_project_list`    | List Claude/ChatGPT projects                                      |
| `aichat_sync`            | Mirror declared local files + instructions into a project library |
| `aichat_session_create`  | Start a seeded chat (Claude/ChatGPT/Gemini)                       |
| `aichat_notebook_create` | Create a NotebookLM notebook + kick off an audio podcast          |

The server drives your **real, signed-in Chrome** deterministically — no API keys,
no model in the loop. macOS is required for the AppleScript transport (Gemini and
NotebookLM are AppleScript-only). See the
[project README](https://github.com/mike-north/aichatctl#readme) for setup and the
security/scope notes.

MIT © Mike North
