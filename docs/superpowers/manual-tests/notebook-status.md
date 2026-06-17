# Manual test — `notebook status` (live calibration)

Cannot run in CI (needs a real logged-in Chrome on macOS).

1. Create a notebook, add a source, and start an Audio Overview:
   `aichatctl notebook podcast create --notebook <ref>`
2. Immediately run `aichatctl notebook status --notebook <ref> --json`.
   Expect an artifact with `"state": "generating"`.
3. Wait for the audio to finish; re-run.
   Expect `"state": "ready"`.
4. Start a second Audio Overview and run status again.
   Expect two entries in `artifacts`.

If `artifacts` is empty while a tile is clearly visible, recalibrate
`STUDIO_TILE_SELECTOR` in `packages/sdk/src/drivers/notebooklm/page-scripts.ts`.
