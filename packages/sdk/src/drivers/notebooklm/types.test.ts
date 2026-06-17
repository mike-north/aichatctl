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
  coerceArtifactType,
  normalizeArtifactState,
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

describe("coerceArtifactType", () => {
  it("classifies audio-overview labels", () => {
    expect(coerceArtifactType("Audio Overview")).toBe("audio-overview");
    expect(coerceArtifactType("Deep Dive podcast")).toBe("audio-overview");
  });
  it("falls back to unknown for unrecognized or empty labels", () => {
    expect(coerceArtifactType("Mind map")).toBe("unknown");
    expect(coerceArtifactType("")).toBe("unknown");
  });
});

describe("normalizeArtifactState", () => {
  it("maps generating cues", () => {
    expect(normalizeArtifactState("Generating…")).toBe("generating");
    expect(normalizeArtifactState("Loading")).toBe("generating");
  });
  it("treats other in-flight cues (queued/pending/rendering/waiting) as generating", () => {
    expect(normalizeArtifactState("Queued")).toBe("generating");
    expect(normalizeArtifactState("Pending")).toBe("generating");
    expect(normalizeArtifactState("Rendering…")).toBe("generating");
    expect(normalizeArtifactState("Waiting")).toBe("generating");
  });
  it("maps failure cues, checked before generating", () => {
    expect(normalizeArtifactState("Failed")).toBe("failed");
    expect(normalizeArtifactState("Error generating audio")).toBe("failed");
  });
  it("treats a settled tile (no progress text) as ready", () => {
    expect(normalizeArtifactState("")).toBe("ready");
    expect(normalizeArtifactState("12:34")).toBe("ready");
  });
});
