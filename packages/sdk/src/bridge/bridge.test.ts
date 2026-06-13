/**
 * Integration tests for the localhost bridge: a real BridgeServer with a
 * simulated extension (raw ws client) verifies the CLI<->extension relay,
 * auth, and the no-extension error path — all without Chrome.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { sendBridgeCommand } from "./client.js";
import { encodeMessage, parseMessage, rawDataToString } from "./protocol.js";
import { BridgeServer } from "./server.js";

/** Connects a fake extension that echoes seedSession commands back as results. */
function connectFakeExtension(port: number, token?: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}`);
    ws.on("open", () => {
      ws.send(encodeMessage({ type: "hello", role: "extension", ...(token ? { token } : {}) }));
      resolve(ws);
    });
    ws.on("message", (data) => {
      const msg = parseMessage(rawDataToString(data));
      if (msg?.type === "command") {
        ws.send(
          encodeMessage({
            type: "result",
            id: msg.id,
            ok: true,
            data: { echoedAction: msg.action, params: msg.params },
          }),
        );
      }
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition not met in time");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("BridgeServer relay", () => {
  let server: BridgeServer;

  beforeEach(async () => {
    // Port 0 lets the OS pick a free port, avoiding collisions across tests.
    server = new BridgeServer({ port: 0, heartbeatMs: 50 });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("relays a command to the extension and routes the result back to the cli", async () => {
    const ext = await connectFakeExtension(server.port);
    await waitFor(() => server.extensionConnected);

    const data = await sendBridgeCommand(
      "seedSession",
      { platform: "claude", prompt: "hello" },
      { port: server.port },
    );

    expect(data).toEqual({
      echoedAction: "seedSession",
      params: { platform: "claude", prompt: "hello" },
    });
    ext.close();
  });

  it("returns an error when no extension is connected", async () => {
    await expect(
      sendBridgeCommand("seedSession", {}, { port: server.port, timeoutMs: 1500 }),
    ).rejects.toThrow(/No extension connected/);
  });
});

describe("BridgeServer auth", () => {
  it("rejects an extension presenting the wrong token", async () => {
    const server = new BridgeServer({ port: 0, token: "secret", heartbeatMs: 50 });
    await server.start();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${String(server.port)}`);
      const closed = new Promise<number>((resolve) => {
        ws.on("close", (code) => {
          resolve(code);
        });
      });
      ws.on("open", () => {
        ws.send(encodeMessage({ type: "hello", role: "extension", token: "wrong" }));
      });
      expect(await closed).toBe(4001);
    } finally {
      await server.stop();
    }
  });
});
