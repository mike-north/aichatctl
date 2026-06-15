/**
 * Tests for NotebookLM Audio Overview option types + UI label mapping.
 *
 * @see NotebookLM Audio Overview customize dialog (Format / Length controls)
 */
import { describe, expect, it } from "vitest";

import {
  AUDIO_FORMAT_LABEL,
  AUDIO_LENGTH_LABEL,
  parseAudioFormat,
  parseAudioLength,
} from "./types.js";

describe("audio overview label maps", () => {
  it("maps every format to its NotebookLM card label", () => {
    expect(AUDIO_FORMAT_LABEL).toEqual({
      "deep-dive": "Deep Dive",
      brief: "Brief",
      critique: "Critique",
      debate: "Debate",
    });
  });

  it("maps every length to its NotebookLM control label", () => {
    expect(AUDIO_LENGTH_LABEL).toEqual({ short: "Short", default: "Default", long: "Long" });
  });
});

describe("parseAudioFormat", () => {
  it("accepts each valid format", () => {
    expect(parseAudioFormat("deep-dive")).toBe("deep-dive");
    expect(parseAudioFormat("brief")).toBe("brief");
    expect(parseAudioFormat("critique")).toBe("critique");
    expect(parseAudioFormat("debate")).toBe("debate");
  });
  it("rejects an unknown format", () => {
    expect(() => parseAudioFormat("podcast")).toThrow(/deep-dive, brief, critique, debate/);
  });
});

describe("parseAudioLength", () => {
  it("accepts each valid length", () => {
    expect(parseAudioLength("short")).toBe("short");
    expect(parseAudioLength("default")).toBe("default");
    expect(parseAudioLength("long")).toBe("long");
  });
  it("rejects an unknown length", () => {
    expect(() => parseAudioLength("medium")).toThrow(/short, default, long/);
  });
});
