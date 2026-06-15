/**
 * Smoke test: the MCP server constructs and registers all tools without error.
 * (Tool behavior is exercised through the SDK's own tests; this guards against
 * schema/registration regressions.)
 */
import { describe, expect, it } from "vitest";

import { createServer } from "./server.js";

describe("createServer", () => {
  it("constructs the MCP server without throwing", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
