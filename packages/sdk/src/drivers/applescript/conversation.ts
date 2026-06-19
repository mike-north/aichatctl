/**
 * Conversation read-back helpers for the AppleScript transport: parse a Claude
 * or ChatGPT conversation reference, and build the page-script that returns the
 * latest assistant message. Selectors are isolated here so a UI drift is a
 * one-file calibration fix.
 *
 * @packageDocumentation
 */
import { AichatctlError } from "../../errors.js";

/** Chat platforms that support conversation read-back. */
export type ChatPlatform = "claude" | "chatgpt";

/** A parsed conversation reference. */
export interface ConversationRef {
  readonly platform: ChatPlatform;
  readonly id: string;
  /** The canonical conversation URL (used as the tab `createUrl`). */
  readonly url: string;
  /** A substring that matches an already-open tab for this conversation. */
  readonly matchUrl: string;
}

const CLAUDE_CHAT_ID = /claude\.ai\/chat\/([0-9a-z-]+)/i;
const CHATGPT_CHAT_ID = /chatgpt\.com\/c\/([0-9a-z-]+)/i;
const BARE_ID = /^[0-9a-z-]{12,}$/i;

/** Parses a conversation URL or bare id for a platform. Throws on an unrecognized ref. */
export function parseConversationRef(platform: ChatPlatform, ref: string): ConversationRef {
  const trimmed = ref.trim();
  if (platform === "claude") {
    const id = CLAUDE_CHAT_ID.exec(trimmed)?.[1] ?? (BARE_ID.test(trimmed) ? trimmed : undefined);
    if (id === undefined) {
      throw new AichatctlError(
        `Invalid Claude conversation reference: "${ref}". Provide a claude.ai/chat/<id> URL or a conversation id.`,
      );
    }
    return { platform, id, url: `https://claude.ai/chat/${id}`, matchUrl: `chat/${id}` };
  }
  const id = CHATGPT_CHAT_ID.exec(trimmed)?.[1] ?? (BARE_ID.test(trimmed) ? trimmed : undefined);
  if (id === undefined) {
    throw new AichatctlError(
      `Invalid ChatGPT conversation reference: "${ref}". Provide a chatgpt.com/c/<id> URL or a conversation id.`,
    );
  }
  return { platform, id, url: `https://chatgpt.com/c/${id}`, matchUrl: `c/${id}` };
}

/**
 * Builds page JS (returning a JSON string) that reads the last assistant
 * message's text. CALIBRATION: assistant-message selectors are verified against
 * the live UI during implementation.
 */
export function scriptLastAssistantMessage(platform: ChatPlatform): string {
  const selector =
    platform === "chatgpt"
      ? '[data-message-author-role="assistant"]'
      : '[data-testid="assistant-message"], .font-claude-message';
  return `
    const nodes = document.querySelectorAll('${selector}');
    if (!nodes.length) return JSON.stringify({ ok: false, why: "no assistant message found" });
    const last = nodes[nodes.length - 1];
    const text = (last.innerText || last.textContent || "").trim();
    if (!text) return JSON.stringify({ ok: false, why: "assistant message was empty" });
    return JSON.stringify({ ok: true, text: text, url: location.href });`;
}
