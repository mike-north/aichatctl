import { describe, expect, it } from "vitest";

import { NotebookLmDriver } from "./drivers/notebooklm/driver.js";
import { renameNotebook } from "./service.js";

describe("NotebookLmDriver.parseNotebookRef", () => {
  it("parses a full NotebookLM URL", () => {
    const nb = NotebookLmDriver.parseNotebookRef(
      "https://notebooklm.google.com/notebook/abc123-def-456",
    );
    expect(nb.id).toBe("abc123-def-456");
    expect(nb.url).toBe("https://notebooklm.google.com/notebook/abc123-def-456");
  });

  it("parses a bare UUID", () => {
    const nb = NotebookLmDriver.parseNotebookRef("abc123-def-456");
    expect(nb.id).toBe("abc123-def-456");
    expect(nb.url).toBe("https://notebooklm.google.com/notebook/abc123-def-456");
  });

  it("throws on an invalid reference", () => {
    expect(() => NotebookLmDriver.parseNotebookRef("not a valid ref!")).toThrow(
      /invalid notebook reference/i,
    );
  });

  it("handles URL with trailing path segments", () => {
    const nb = NotebookLmDriver.parseNotebookRef(
      "https://notebooklm.google.com/notebook/aabbccdd-1234/sources",
    );
    expect(nb.id).toBe("aabbccdd-1234");
  });
});

describe("renameNotebook", () => {
  it("rejects an empty name before touching the browser", async () => {
    await expect(renameNotebook({ notebook: "abc123", name: "   " })).rejects.toThrow(/non-empty/i);
  });

  it("rejects an invalid notebook ref", async () => {
    await expect(renameNotebook({ notebook: "not valid!", name: "Test" })).rejects.toThrow(
      /invalid notebook reference/i,
    );
  });
});
