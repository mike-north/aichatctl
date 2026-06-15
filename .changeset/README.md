# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).

To record a change for the next release, run:

```bash
pnpm changeset
```

Pick the affected packages and a bump type (patch/minor/major) and write a short
summary. Commit the generated markdown file alongside your change. On merge to
`main`, the release workflow opens a "Version Packages" PR; merging that publishes
to npm and tags the release.
