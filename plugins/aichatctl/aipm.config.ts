import { defineConfig } from "@ai-plugin-marketplace/core";

// Claude is the initial target; codex is wired so `aipm build` can emit a
// Codex-flavored plugin from the same canonical skill/command sources.
export default defineConfig({
  version: "0.1.0",
  targets: ["claude", "codex"],
});
