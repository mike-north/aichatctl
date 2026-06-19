# Manual test — `project create` (live calibration)

Cannot run in CI (needs a real logged-in Chrome on macOS).

1. `aichatctl project create --platform claude --name "Test Project" --json`
   Expect the full `CreateProjectResult`:
   `{ "platform": "claude", "project": { "id": "…", "name": "Test Project", "url": "https://claude.ai/project/…" }, "instructionsSet": false, "filesUploaded": [] }`.
   Confirm the project appears in the Claude web UI.
2. With instructions + a file:
   `aichatctl project create --platform claude --name "Briefed" --instructions "Be terse." --file ./README.md`
   Confirm `instructionsSet: true`, `filesUploaded: ["README.md"]`, and that the
   instructions + file are present in the new project.
3. Repeat with `--platform chatgpt`.
4. `aichatctl sync` against the newly created project to confirm the id/url are
   usable downstream.

If create fails with an HTTP status, recalibrate the endpoint/payload in
`AppleScriptDriver.createProject` (`packages/sdk/src/drivers/applescript/driver.ts`).
