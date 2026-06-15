# @aichatctl/sdk

The engine behind [`aichatctl`](https://www.npmjs.com/package/aichatctl) — drivers
for the Claude.ai, ChatGPT, Gemini, and NotebookLM web UIs, the browser transports
(AppleScript + CDP), and the file-sync engine.

Most people want the CLI (`npm i -g aichatctl`) or the
[MCP server](https://www.npmjs.com/package/@aichatctl/mcp). Use this package
directly to build your own automation on top of the same engine.

```bash
npm install @aichatctl/sdk
```

```ts
import { createNotebookPodcast, buildNotebookSources } from "@aichatctl/sdk";

const sources = buildNotebookSources({
  files: ["docs/spec.md"],
  urls: ["https://example.com"],
});
const { url } = await createNotebookPodcast({
  sources,
  audio: { format: "deep-dive", length: "default" },
});
console.log(url);
```

The public API is tracked with API Extractor; see the
[project README](https://github.com/mike-north/aichatctl#readme) for the transport
model, requirements, and security notes.

MIT © Mike North
