# aichatctl

**Drive your logged-in Claude.ai, ChatGPT, Gemini, and NotebookLM from the command line — deterministically, no API keys, no model in the loop.**

These products have no public API for the things that matter day to day: the files
and instructions attached to a _project_, creating a project-scoped chat, or turning
your sources into a NotebookLM audio overview. So those things rot or stay manual.
`aichatctl` automates them by driving your **real, signed-in Chrome** with fixed
code — every click is scripted, nothing is screenshotted or "reasoned about," and
no tokens are spent. An agent decides _what_ to do (which files to sync, what prompt
to seed); `aichatctl` does the _doing_.

```bash
# Compose a NotebookLM podcast from a spec + a design doc, started and ready to listen
aichatctl notebook create \
  --source docs/specs --source-url https://docs.google.com/document/d/<id> \
  --format deep-dive --prompt "Explain the migration plan to a new engineer" --json
```

## What it does

Two jobs, across the platforms that support them:

| Capability                                                       | Claude.ai | ChatGPT | Gemini | NotebookLM |
| ---------------------------------------------------------------- | :-------: | :-----: | :----: | :--------: |
| Discover projects (by name / URL)                                |    ✅     |   ✅    |   —    |     —      |
| **Seed a chat session** (start a chat, hand off to mobile/voice) |    ✅     |   ✅    |   ✅   |     —      |
| **Sync a file library** (upload / list / delete)                 |    ✅     |   ✅    |   —    |     —      |
| Sync project instructions                                        |    ✅     |   ✅¹   |   —    |     —      |
| **Create a notebook → audio podcast**                            |     —     |    —    |   —    |     ✅     |

¹ ChatGPT's instructions field has no save button reachable by automation, so it's
the one place `aichatctl` calls ChatGPT's own endpoint (via your live session). See
[How it works](#how-it-works). Everything else is UI-driven.

**Why this exists**

- **Project files rot.** You attach a spec to a Claude/ChatGPT project; the spec
  changes in git; the uploaded copy silently goes stale. `aichatctl sync` mirrors a
  declared set of repo files (and the instructions) into the project on demand.
- **Voice-ready handoff.** A local agent composes a prompt; `aichatctl` opens a new
  chat in the right project and starts it. You open the mobile app and keep talking.
- **Podcasts from your sources.** Turn repo files and links into a NotebookLM audio
  overview you listen to on a walk.

## Requirements

- **macOS** — `aichatctl` uses `osascript` to drive your real Chrome tab. There is
  no other transport.
- **Node ≥ 22** (`npm i -g aichatctl`). `pnpm` is only needed to build from source.
- **Google Chrome**, signed in to the services you target (it uses your real session).
- One Chrome toggle: **View → Developer → Allow JavaScript from Apple Events**.

## Quickstart

```bash
npm install -g aichatctl        # or: pnpm add -g aichatctl
```

(Prefer to build from source? See [Repo layout](#repo-layout).)

Enable the Chrome toggle above, then check you're ready:

```bash
aichatctl doctor --json     # verifies the toggle + per-platform login
```

Make your first podcast (or seed your first session):

```bash
# NotebookLM audio overview from a file + a URL
aichatctl notebook create --source README.md --source-url https://example.com \
  --format brief --prompt "Two-minute overview for a newcomer" --json

# Or: start a Claude chat seeded with a prompt, to continue by voice on mobile
aichatctl session create --platform claude --project "My Project" \
  --seed-file notes.md --json
```

Each command prints JSON including the conversation/notebook `url` — open it on your
phone and go.

## Usage

### Seed a chat session

Starts a new chat in a project, pre-filled and submitted, so you can continue it
from the mobile app (e.g. by voice).

```bash
aichatctl session create --platform claude --project "My Project" --seed-file notes.md --json

# Gemini is seed-only; --project is a Gem URL/id, or "new" for a plain chat
aichatctl session create --platform gemini --project new --seed "Let's plan the week" --json
```

`--project` takes a name, URL, or id. `--no-send` stages the prompt without
submitting. `--seed-file -` reads the prompt from stdin.

### Sync a project's file library

Mirror a declared set of repo files (and, optionally, the instructions) into a
Claude/ChatGPT project so it tracks your git source of truth. Always preview first.

```bash
aichatctl sync --dry-run                    # show the upload/replace/delete plan
aichatctl sync                              # apply it
aichatctl sync --platform chatgpt          # one platform only
```

Sync only ever deletes files **it** previously synced — anything you added by hand
in the web UI is left alone.

Configure it with `aichatctl.config.yaml` at your repo root (copy
`aichatctl.config.example.yaml`):

```yaml
platforms:
  claude:
    project: "Product Spec Workspace" # name, or a project URL/id
    instructions: docs/project-instructions.md # optional
    files:
      - docs/specs/**/*.md
      - README.md
  chatgpt:
    project: "https://chatgpt.com/g/g-p-XXXXXXXX/project"
    files:
      - docs/specs/**/*.md
```

### Create a NotebookLM podcast

Create a notebook from files and/or links and kick off a customized audio overview.

```bash
aichatctl notebook create \
  --source docs/specs --source README.md \        # files/dirs → text sources
  --source-url https://docs.google.com/document/d/<id> \   # each URL → its own source
  --format deep-dive --length default \
  --prompt "Focus on the migration plan for a newcomer" --json
```

- **Format:** `deep-dive` (default), `brief`, `critique`, `debate`.
- **Length:** `short`, `default`, `long` (NotebookLM applies length only to some
  formats; it's ignored where the UI omits it).
- Each `--source` file (directories expand to their files) becomes a text source;
  each `--source-url` becomes its **own** source (so a Google Doc link lands as that
  document). `--source-text -` reads a source from stdin.

The command returns once generation is **kicked off** — the audio renders in the
background (minutes). Open the returned `url` on mobile to listen.

## How it works

`aichatctl` drives your **real, logged-in Chrome** via AppleScript (`osascript`) —
macOS only, no extension, no separate browser profile. It needs the one Chrome toggle
above. Because `osascript` can't await promises, page code uses synchronous requests;
file operations use each product's own upload endpoints rather than the native file
picker (which would need Accessibility permission).

Two principles keep it robust and trustworthy:

- **UI-driven, deterministically.** Drivers run fixed code against the logged-in UIs
  — navigate, upload, click, type, send. No model is in the loop; no tokens are
  spent on the browser.
- **Internal APIs only where the UI genuinely can't be driven.** Coupling to private
  endpoints is brittle, so it's avoided. The lone exception is ChatGPT project
  _instructions_ (no save fires under automation): `aichatctl` calls ChatGPT's own
  `PATCH /backend-api/projects/{id}` from the page, carrying your live session — no
  credentials are read or stored.

When a web UI drifts and a control stops resolving, commands fail with a clear
`(calibration)` error naming what wasn't found, so the fix is a one-line selector
change rather than a guess.

## Agent plugin

`aichatctl` ships an agent plugin so a coding agent can use it directly:

```
/plugin marketplace add /path/to/aichatctl
/plugin install aichatctl@aichatctl-marketplace
```

It provides the `aichatctl` skill (activates automatically) plus `/aichat-sync`,
`/aichat-seed-session`, and `/aichat-podcast`. The agent reasons about _what_ to do
and calls the CLI; it never drives the browser itself. Cross-platform builds (Codex,
etc.) are produced with [`aipm`](https://github.com/ai-plugin-marketplace/tools).

## MCP server

`@aichatctl/mcp` exposes the same operations as MCP tools (`aichat_doctor`,
`aichat_project_list`, `aichat_sync`, `aichat_session_create`,
`aichat_notebook_create`) for any MCP-capable client. Point your client at the
`aichatctl-mcp` binary over stdio:

```json
{
  "mcpServers": {
    "aichatctl": { "command": "npx", "args": ["-y", "@aichatctl/mcp"] }
  }
}
```

## Security & scope

`aichatctl` operates **your own** authenticated accounts for personal productivity,
at human pace. It stores no passwords (your Chrome session holds the cookies) and
never persists auth tokens. Automating a web UI may run against a service's terms —
this is a documented, deliberate trade-off, not hidden behavior.

## Repo layout

| Package             | What it is                                                |
| ------------------- | --------------------------------------------------------- |
| `@aichatctl/sdk`    | The engine: platform drivers, transports, the sync engine |
| `aichatctl` (CLI)   | Thin command-line over the SDK; `--json` on every command |
| `@aichatctl/mcp`    | MCP server exposing the operations as agent tools         |
| `plugins/aichatctl` | The agent plugin (skill + commands)                       |

Build from source (Node ≥ 22, pnpm):

```bash
git clone https://github.com/mike-north/aichatctl.git && cd aichatctl
pnpm install
pnpm build      # compile all packages
pnpm test       # run the test suite
pnpm lint       # eslint
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the change/release workflow.

## Status & license

Early (`0.x`) — APIs and commands may change. Released under the
[MIT License](LICENSE). Security disclosures: [SECURITY.md](SECURITY.md).
