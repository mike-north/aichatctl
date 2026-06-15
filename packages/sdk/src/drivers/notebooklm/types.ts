/**
 * NotebookLM Audio Overview ("podcast") option types, the UI labels they map to,
 * and the typed source model. NotebookLM is seed/generate-only (no projects),
 * so these types live with the driver rather than in the shared chat-`Platform`
 * types.
 *
 * @packageDocumentation
 */
import { AichatctlError } from "../../errors.js";

/** Audio Overview format ("podcast type") — the Format cards in the dialog. */
export type AudioOverviewFormat = "deep-dive" | "brief" | "critique" | "debate";

/** Audio Overview length control. */
export type AudioOverviewLength = "short" | "default" | "long";

/** Options for generating an Audio Overview. */
export interface AudioOverviewOptions {
  readonly format: AudioOverviewFormat;
  readonly length: AudioOverviewLength;
  /** Free-text "what should the AI hosts focus on in this episode?" (optional). */
  readonly prompt?: string;
}

/**
 * A source to add to a notebook.
 *
 * Future source kinds (e.g. `"drive" | "youtube" | "upload"`) will extend this union.
 */
export type NotebookSource =
  | { readonly kind: "text"; readonly title?: string; readonly content: string }
  | { readonly kind: "url"; readonly url: string };

/** Format value → the clickable Format card label in the NotebookLM UI. */
export const AUDIO_FORMAT_LABEL: Readonly<Record<AudioOverviewFormat, string>> = {
  "deep-dive": "Deep Dive",
  brief: "Brief",
  critique: "Critique",
  debate: "Debate",
};

/** Length value → the Length control label in the NotebookLM UI. */
export const AUDIO_LENGTH_LABEL: Readonly<Record<AudioOverviewLength, string>> = {
  short: "Short",
  default: "Default",
  long: "Long",
};

/** Parses a CLI format string, throwing a usage-style error on an unknown value. */
export function parseAudioFormat(value: string): AudioOverviewFormat {
  if (value in AUDIO_FORMAT_LABEL) {
    return value as AudioOverviewFormat;
  }
  throw new AichatctlError(
    `format must be one of: ${Object.keys(AUDIO_FORMAT_LABEL).join(", ")}`,
  );
}

/** Parses a CLI length string, throwing a usage-style error on an unknown value. */
export function parseAudioLength(value: string): AudioOverviewLength {
  if (value in AUDIO_LENGTH_LABEL) {
    return value as AudioOverviewLength;
  }
  throw new AichatctlError(
    `length must be one of: ${Object.keys(AUDIO_LENGTH_LABEL).join(", ")}`,
  );
}
