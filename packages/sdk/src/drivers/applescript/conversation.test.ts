/**
 * Tests for conversation ref parsing + the last-assistant-message page-script.
 *
 * @see Claude chat URLs — https://claude.ai/chat/<id>
 * @see ChatGPT conversation URLs — https://chatgpt.com/c/<id>
 */
import { describe, expect, it } from "vitest";

import { parseConversationRef, scriptLastAssistantMessage } from "./conversation.js";

describe("parseConversationRef — claude", () => {
  it("extracts the id from a chat URL", () => {
    expect(parseConversationRef("claude", "https://claude.ai/chat/abc-123")).toEqual({
      platform: "claude",
      id: "abc-123",
      url: "https://claude.ai/chat/abc-123",
      matchUrl: "chat/abc-123",
    });
  });
  it("accepts a bare id", () => {
    const r = parseConversationRef("claude", "0123456789abcdef0123");
    expect(r.url).toBe("https://claude.ai/chat/0123456789abcdef0123");
    expect(r.matchUrl).toBe("chat/0123456789abcdef0123");
  });
  it("rejects an invalid ref", () => {
    expect(() => parseConversationRef("claude", "not valid!")).toThrow(
      /invalid claude conversation reference/i,
    );
  });
});

describe("parseConversationRef — chatgpt", () => {
  it("extracts the id from a /c/ URL", () => {
    expect(parseConversationRef("chatgpt", "https://chatgpt.com/c/xyz-789")).toEqual({
      platform: "chatgpt",
      id: "xyz-789",
      url: "https://chatgpt.com/c/xyz-789",
      matchUrl: "c/xyz-789",
    });
  });
  it("rejects an invalid ref", () => {
    expect(() => parseConversationRef("chatgpt", "??")).toThrow(
      /invalid chatgpt conversation reference/i,
    );
  });
});

describe("scriptLastAssistantMessage", () => {
  it("uses ChatGPT's assistant-role selector", () => {
    expect(scriptLastAssistantMessage("chatgpt")).toContain('data-message-author-role="assistant"');
  });
  it("targets a Claude assistant-message container and JSON-stringifies", () => {
    const js = scriptLastAssistantMessage("claude");
    expect(js).toContain("assistant");
    expect(js).toContain("JSON.stringify");
  });
});
