# aichatctl

**Drive your logged-in Claude.ai, ChatGPT, Gemini, and NotebookLM from the command line — deterministically, no API keys, no model in the loop.**

These products have no public API for the things that matter day to day: the files
and instructions attached to a _project_, creating a project-scoped chat, or turning
your sources into a NotebookLM audio overview. `aichatctl` automates them by driving
your **real, signed-in Chrome** with fixed code — every click is scripted, no tokens
are spent.

```bash
npm install -g aichatctl
```

```bash
# NotebookLM podcast from a spec + a design doc
aichatctl notebook create \
  --source docs/specs --source-url https://docs.google.com/document/d/<id> \
  --format deep-dive --prompt "Explain the migration plan to a new engineer" --json

# Seed a Claude chat to continue by voice on mobile
aichatctl session create --platform claude --project "My Project" \
  --seed-file notes.md --json

# Mirror repo files into a project's file library
aichatctl sync --dry-run
```

Requires **macOS** (drives Chrome via `osascript`) and a Chrome toggle
(View → Developer → Allow JavaScript from Apple Events). Run `aichatctl doctor --json`
to check readiness.

Full documentation, configuration, and the security/scope
notes are in the [project README](https://github.com/mike-north/aichatctl#readme).

MIT © Mike North
