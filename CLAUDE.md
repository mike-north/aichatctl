# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install              # install dependencies
pnpm build                # tsc --build (all packages, project references)
pnpm lint                 # eslint (strict-type-checked + stylistic-type-checked)
pnpm test                 # vitest run (all packages)
pnpm test -- --watch      # vitest watch mode
pnpm test -- packages/sdk/src/sync/plan.test.ts   # single test file
pnpm format               # prettier --write
pnpm format:check         # prettier --check (CI uses this)

# SDK API surface management
pnpm --filter @aichatctl/sdk run api        # regenerate api-report/ + docs/ (local)
pnpm --filter @aichatctl/sdk run api:check  # CI check — fails if report is stale
```

CI runs: `build → lint → test → api:check`. All four must pass.

## Architecture

**Monorepo** (pnpm workspaces, `packages/*`). Three published packages + one agent plugin:

```
@aichatctl/sdk (packages/sdk)   — the engine: drivers, transports, sync engine
aichatctl      (packages/cli)   — thin Commander CLI over the SDK
@aichatctl/mcp (packages/mcp)   — MCP server wrapping SDK operations
plugins/aichatctl               — agent plugin (skills + slash commands, built with aipm)
```

The CLI and MCP packages depend on the SDK via `workspace:*`. The plugin is built separately (`pnpm plugin:build`).

### SDK internals (`packages/sdk/src/`)

**Transports** — how we talk to Chrome:

- `applescript/` — `osascript` injects JS into the user's real Chrome tab (macOS only, primary)
- `browser/` — Playwright CDP connection to a dedicated automation Chrome profile (fallback, cross-platform)

**Drivers** — platform-specific DOM mechanics:

- `drivers/claude/` — Claude.ai driver + `selectors.ts`
- `drivers/chatgpt/` — ChatGPT driver + `selectors.ts`
- `drivers/notebooklm/` — NotebookLM driver (sources, audio overview)
- `drivers/applescript/` — AppleScript-transport driver (wraps platform drivers)
- `drivers/base.ts` — shared utilities
- `drivers/factory.ts` — `createDriver(platform, session)` dispatcher

Each driver implements the `Driver` interface (`drivers/driver.ts`). Selectors are isolated in a sibling `selectors.ts` — when a web UI drifts, it's a one-file fix.

**Sync engine** (`sync/`):

- `manifest.ts` — parses `aichatctl.config.yaml`
- `files.ts` — resolves globs to desired file list
- `hash.ts` — content hashing for drift detection
- `state.ts` — persists last-synced state (`.aichatctl/sync-state.json`)
- `plan.ts` — computes upload/replace/delete/noop steps
- `sync.ts` — orchestrates the full reconciliation

**Service layer** (`service.ts`) — high-level operations consumed by CLI and MCP: `runSync`, `createSeededSession`, `createEmptyNotebook`, `renameNotebook`, `listNotebookSources`, `generateNotebookPodcast`, `doctorApplescript`, `listProjects`.

### Key types

- `Platform`: `"claude" | "chatgpt" | "gemini"` — Gemini is seed-sessions only
- `Driver`: the full platform driver interface (list/resolve projects, CRUD files, seed sessions)
- `NamedSelector`: self-describing locator used by drivers and `selftest`/`doctor`

## Conventions

- **ESM, NodeNext** — all imports use `.js` extensions (even for `.ts` sources)
- **Strict TypeScript** — `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no `skipLibCheck`
- **API Extractor** tracks the SDK's public API — commit `api-report/` and `docs/` when exports change
- **Changesets** — every behavior change needs `pnpm changeset` committed with the PR
- **Tests** live next to source as `*.test.ts`; vitest, no mocking framework required

## Release flow

Merge to `main` with pending changesets → CI opens a "Version Packages" PR → merging that PR publishes to npm and creates a GitHub release. No changesets = no version bump.
