import { describe, expect, it } from "vitest";

import { scriptGetNotebookName, scriptListSources, scriptRenameNotebook } from "./page-scripts.js";

describe("scriptGetNotebookName", () => {
  it("returns valid JS that references the title-input selector", () => {
    const js = scriptGetNotebookName();
    expect(js).toContain("input.title-input");
    expect(js).toContain("JSON.stringify");
  });
});

describe("scriptRenameNotebook", () => {
  it("embeds the name as a JSON-safe literal", () => {
    const js = scriptRenameNotebook('Test "Quotes" & <Tags>');
    expect(js).toContain('"Test \\"Quotes\\" & <Tags>"');
    expect(js).toContain("input.title-input");
  });

  it("does not allow injection via the name parameter", () => {
    const js = scriptRenameNotebook('"); alert("xss');
    expect(js).not.toContain('alert("xss');
    expect(js).toContain('\\"'); // escaped
  });
});

describe("scriptListSources", () => {
  it("returns valid JS targeting single-source-container", () => {
    const js = scriptListSources();
    expect(js).toContain("single-source-container");
    expect(js).toContain("JSON.stringify");
  });
});
