/**
 * Tests for the createNotebookPodcast guard that runs before any browser work.
 *
 * @see docs/superpowers/specs/2026-06-14-notebooklm-podcast-design.md
 */
import { describe, expect, it } from "vitest";

import { createNotebookPodcast } from "./service.js";

describe("createNotebookPodcast", () => {
  it("rejects an empty source list before touching the browser", async () => {
    await expect(
      createNotebookPodcast({
        sources: [],
        audio: { format: "deep-dive", length: "default" },
      }),
    ).rejects.toThrow(/at least one source/i);
  });
});
