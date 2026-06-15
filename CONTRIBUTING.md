# Contributing

Thanks for your interest in `aichatctl`.

## Development

Requires **Node ≥ 22** and **pnpm**.

```bash
pnpm install
pnpm build      # compile all packages (tsc --build)
pnpm test       # vitest
pnpm lint       # eslint (strict-type-checked)
```

- TypeScript is strict, ESM (NodeNext) — relative imports end in `.js`.
- Add tests for behavior changes (vitest). Bug fixes should include a regression test.
- The SDK's public API is tracked by API Extractor. If you change exports, run
  `pnpm --filter @aichatctl/sdk run api` and commit the updated `api-report/` + `docs/`.
  CI fails if the committed API report is out of date.

## Browser drivers

The drivers automate live web UIs, so selectors drift. When a UI control stops
resolving, the driver throws a `(calibration)` error naming what wasn't found —
fix the selector in the relevant driver and verify against the live UI. See the
transport notes in the [README](README.md#how-it-works).

## Submitting changes

1. Branch from `main`.
2. Make your change with tests; keep `pnpm build && pnpm lint && pnpm test` green.
3. **Add a changeset** describing the change for the release notes:
   ```bash
   pnpm changeset
   ```
   Pick the affected packages and a bump type (patch/minor/major). Commit the
   generated file in `.changeset/` with your PR.
4. Open a pull request.

On merge to `main`, the release workflow runs: if there are **pending
changesets**, it opens (or updates) a "Version Packages" PR that applies the
bumps + changelog — merging that PR publishes to npm and creates the GitHub
release. If there are **no pending changesets** but a package's version isn't yet
on npm, it publishes directly. So always include a changeset with behavior
changes, or the version won't bump.

## Scope & conduct

`aichatctl` drives a user's own authenticated accounts. Please don't contribute
features aimed at evading bot detection, scraping other people's data, or
operating accounts that aren't the user's own. Be kind in issues and reviews.
