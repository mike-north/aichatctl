# NotebookLM podcast support — design

**Date:** 2026-06-14
**Status:** Approved (design)

## Goal

Add NotebookLM support to `aichatctl`: in one command, **create a new notebook**,
**add source content** to it, and **kick off an Audio Overview ("podcast")** with a
chosen format, length, and host-focus prompt. The user then opens the notebook on
mobile to listen once it finishes rendering.

This is the voice-ready-handoff use case extended to NotebookLM: a local agent
composes the focus prompt and assembles the sources; `aichatctl` does the
deterministic browser mechanics.

## Scope decisions (locked with the user)

- **Source inputs:** local files/dirs (pasted as text sources), URLs (website
  sources), and inline/stdin text. **Not** a manifest/glob system. Internally these
  are normalized into a **first-class, ordered list of typed sources** (see [Source
  model](#source-model)) so many sources — and new source kinds later — stay clean.
- **Command shape:** a single one-shot command (`notebook create`).
- **Notebook target:** always create a **new** notebook (no existing-notebook
  targeting, no notebook listing/resolution).
- **Podcast options:** format (Deep Dive | Brief | Critique | Debate), length
  (Short | Default | Long), and an optional host-focus prompt.
- **Defaults:** `--format deep-dive`, `--length default`.
- **Generation:** return once generation is **kicked off**; do **not** wait for
  the (minutes-long) audio render.
- **Transport:** AppleScript only (NotebookLM is a Google product; macOS-only,
  like Gemini). A non-AppleScript transport is a usage error.

## Verified UI flow (notebooklm.google.com, via osascript probes)

All steps are deterministic — no native file picker, no model in the loop.

| Step | Control(s) |
| --- | --- |
| Create notebook | Home → button **"Create notebook"** → navigates to `/notebook/{id}` |
| Add text/file content | **"Add source"** → **"Copied text"** → single `<textarea>` (placeholder "Paste text here") → **"Insert"** |
| Add URL content | **"Add source"** → **"Websites"** → single `<textarea>` (placeholder "Paste any links"; multiple allowed, newline/space separated) → **"Insert"** |
| Generate podcast | **"Customize Audio Overview"** → click **Format** card (Deep Dive / Brief / Critique / Debate) → click **Length** (Short / Default / Long) → fill focus `<textarea>` ("What should the AI hosts focus on in this episode?") → **"Generate"** |

Notes:
- The Copied-text and Websites forms auto-title the source (no title field). Each
  pasted file source is prefixed with a `# <filename>` header line so it stays
  identifiable inside the notebook.
- After **Generate**, the dialog closes and the Studio panel shows a generating
  audio card; we detect kick-off and return — we do not poll to completion.

## Source model

Sources are normalized into a single **ordered, typed list** that the service
iterates in order — not three independent flag handlers. This keeps arbitrarily
many sources clean and lets new source kinds be added later without reshaping the
interface.

```ts
export type NotebookSource =
  | { readonly kind: "text"; readonly title?: string; readonly content: string }
  | { readonly kind: "url"; readonly url: string };
// Reserved for later (designed-for, NOT built this round): "drive" | "youtube" | "upload".
```

Normalization (CLI layer, preserving the order the user supplied within each
group): each `--source` file → `{ kind: "text", title: <basename>, content }`;
`--source-text`/stdin → `{ kind: "text", content }`; each `--source-url` →
`{ kind: "url", url }`. A `text` source is pasted with its `title` rendered as a
leading `# <title>` line so it stays identifiable in the notebook.

Adding behavior (service → driver):
- **Order preserved.** The list is added front-to-back.
- **One insert per source.** Every item — `text` or `url` — is added via its own
  insert, producing exactly one NotebookLM source. URLs are **not** batched into a
  newline list: NotebookLM resolves each URL into its own document source (e.g. a
  Google Doc URL becomes that doc), and a single textarea of many URLs may not
  produce the same per-URL result. One URL per "Websites" insert guarantees it.
- **Per-source settle + verify.** After each insert, wait for the source list to
  reflect the new count before continuing; if it doesn't grow, throw a calibration
  error naming the source that failed (so a partial add is diagnosable, not silent).
- **Limit-aware.** If NotebookLM rejects an add for a source-count/size limit,
  surface its message as an `AichatctlError` rather than failing opaquely.
- **Empty guard.** Zero sources → error before any notebook/podcast work.

## Architecture (Approach A — standalone subsystem)

NotebookLM is **not** a chat platform: no projects, no seeded chat sessions, no
file-library sync. It is therefore **not** added to the `Platform` type or the
`Driver` interface (doing so would force irrelevant `resolveProject` /
`createSeededSession` / file-op methods and pollute the chat-platform
abstraction). Instead it is a self-contained subsystem.

### New: `packages/sdk/src/drivers/notebooklm/driver.ts`

`NotebookLmDriver` — a standalone AppleScript driver (does not implement
`Driver`). Mirrors the patterns in `AppleScriptDriver` (its own `#eval` wrapper
targeting `notebooklm.google.com`, synchronous page JS, `sleep`-based settling
between UI steps, calibration errors when a control is missing).

Methods:

- `isLoggedIn(): Promise<boolean>` — `notebooklm.google.com` host + a "Create
  notebook" control present (logged-out redirects to Google sign-in).
- `createNotebook(): Promise<{ id: string; url: string }>` — click "Create
  notebook"; poll for the `/notebook/{id}` URL; return id + canonical URL.
- `addTextSource(notebook, content: string): Promise<void>` — Add source →
  Copied text → set textarea value → Insert. Used once per file and once for
  inline/stdin text.
- `addUrlSource(notebook, url: string): Promise<void>` — Add source → Websites →
  set textarea to the single `url` → Insert. One call per URL → one distinct source.
- `generateAudioOverview(notebook, opts: AudioOverviewOptions): Promise<void>` —
  Customize Audio Overview → click format card → click length → fill focus
  textarea (if a prompt was given) → Generate. Throws a calibration error if any
  control is missing.

Textareas are filled with the established pattern: focus, then the native value
setter + an `input` event (Angular-aware), matching the Gemini composer fix.

### New types (`packages/sdk/src/types.ts` or a local module)

```ts
export type AudioOverviewFormat = "deep-dive" | "brief" | "critique" | "debate";
export type AudioOverviewLength = "short" | "default" | "long";
export interface AudioOverviewOptions {
  readonly format: AudioOverviewFormat;   // → "Deep Dive" | "Brief" | "Critique" | "Debate"
  readonly length: AudioOverviewLength;   // → "Short" | "Default" | "Long"
  readonly prompt?: string;               // host-focus textarea (optional)
}
```

Label maps (`deep-dive` → `"Deep Dive"`, `short` → `"Short"`, …) live next to the
driver and are the single source of truth for the UI labels.

### New: service function (`packages/sdk/src/service.ts`)

```ts
export interface CreateNotebookPodcastOptions {
  readonly title?: string;
  readonly sources: readonly NotebookSource[];   // already normalized + ordered
  readonly audio: AudioOverviewOptions;
  readonly skipLoginCheck?: boolean;
}
export interface NotebookPodcastResult {
  readonly url: string;
  readonly notebookId: string;
  readonly sourcesAdded: number;
  readonly podcastKicked: boolean;
}
export async function createNotebookPodcast(
  options: CreateNotebookPodcastOptions,
): Promise<NotebookPodcastResult>;
```

Orchestration: validate `sources` non-empty → login check → `createNotebook()` →
walk the ordered `sources` list, one insert per item (`text` → `addTextSource`,
`url` → `addUrlSource`), with per-source settle/verify → guard `sourcesAdded > 0`
→ `generateAudioOverview(audio)` → return result.

File reading and dir→file glob expansion happen in the **CLI layer** (reusing the
existing sync file-collection helper where practical): the CLI reads each file and
builds the normalized `NotebookSource[]`, so the service receives a transport- and
filesystem-agnostic list it simply iterates.

### New: CLI command (`packages/cli/src/cli.ts`)

`--transport` defaults to `applescript` (the only supported value for this
command) so the common invocation needs no transport flag; passing anything else
is a usage error.

```
aichatctl notebook create [--transport applescript]
  --source <path>            (repeatable; files, or dirs expanded by glob)
  --source-url <url>         (repeatable; collected into one Websites source)
  --source-text <text> | -   (inline, or "-" for stdin)
  --title <name>             (optional)
  --format <deep-dive|brief|critique|debate>   (default: deep-dive)
  --length <short|default|long>                (default: default)
  --prompt <text>            (host-focus; optional)
  --prompt-file <path>       (host-focus from a file; "-" = stdin)
  --json
```

Validation (usage errors, exit 1, before any browser work):
- at least one of `--source` / `--source-url` / `--source-text` is provided;
- `--format` / `--length` parse to the allowed sets;
- `--transport` defaults to `applescript` and accepts only `applescript`; any
  other value errors with a clear message (mirrors the Gemini guard).

Output: human line `Created notebook + kicked off <Format> podcast: <url>`; JSON is
the `NotebookPodcastResult`.

## Error handling

- **Not logged in** → `NotLoggedInError("notebooklm")`.
- **Missing UI control** → `AichatctlError("NotebookLM '<control>' not found (calibration).")`.
- **No sources** → `AichatctlError` before generation (don't create a podcast from
  an empty notebook).
- **Wrong transport** → usage error explaining AppleScript-only.
- Generation kick-off failure (Generate button absent) → calibration error.

## Testing

Pure unit tests (no osascript), following the existing AppleScript-driver test
pattern that exercises osascript-free logic:

- **Label mapping:** every `AudioOverviewFormat`/`AudioOverviewLength` → correct UI
  label; invalid string → parse error.
- **Source normalization:** files → `text` sources titled by basename; inline
  text → one `text` source; URLs → `url` sources; **order preserved** across the
  combined list; empty list rejected.
- **One source per item:** each `url` source is added via its own Websites insert
  (so each becomes a distinct NotebookLM document source — important for Google Doc
  URLs); interleaved text/url order stays correct; `sourcesAdded` equals the input
  list length.
- **CLI validation:** at least one source required; bad `--format`/`--length` are
  usage errors; non-AppleScript transport rejected; `--prompt-file -` reads stdin.

Live UAT (documented, manual — like the Gemini seed): run the real command against
a throwaway notebook, confirm a notebook is created with the sources and that an
Audio Overview generating-card appears. Not run in CI (needs a live login).

Docs: README gets a NotebookLM section (capabilities + example); the `aichatctl`
skill (`SKILL.md`) gets a short "Use case 3 — NotebookLM podcast" entry. No new
plugin command in this iteration (the skill covers it); a `/aichat-podcast`
command can follow if wanted.

## Out of scope (YAGNI)

- Other Studio outputs (Slides, Mind Map, Quiz, Flashcards, Infographic, Data Table).
- Existing-notebook targeting, notebook listing/resolution.
- Building Drive / YouTube / native-upload source kinds. The `NotebookSource`
  union **reserves** them (interface-only) so they slot in later, but only `text`
  and `url` are implemented this round.
- Waiting for / downloading the finished audio.
- Manifest/declarative notebooks.
- CDP/extension transports for NotebookLM.
