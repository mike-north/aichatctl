import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

import {
  DEFAULT_BRIDGE_PORT,
  encodeMessage,
  parseMessage,
  rawDataToString,
} from "./protocol.js";
import type { CommandMessage } from "./protocol.js";

/** Options for {@link BridgeServer}. */
export interface BridgeServerOptions {
  readonly port?: number;
  /** Shared secret required from both roles; when set, mismatches are rejected. */
  readonly token?: string;
  /** Heartbeat interval (ms) that keeps the MV3 service worker alive. */
  readonly heartbeatMs?: number;
  /** Optional log sink (defaults to no-op). */
  readonly log?: (line: string) => void;
}

/**
 * Loopback WebSocket bridge between short-lived CLI invocations and the
 * long-lived in-browser extension service worker.
 *
 * Relays a `command` from a cli client to the connected extension and routes the
 * extension's `result` back to the originating cli client. A periodic ping keeps
 * the MV3 service worker from being suspended (Chrome resets its idle timer on
 * any extension activity, including received socket messages).
 */
export class BridgeServer {
  readonly #port: number;
  readonly #token: string | undefined;
  readonly #heartbeatMs: number;
  readonly #log: (line: string) => void;

  #wss: WebSocketServer | undefined;
  #boundPort: number | undefined;
  #extension: WebSocket | undefined;
  #heartbeat: ReturnType<typeof setInterval> | undefined;
  readonly #cliByCommandId = new Map<string, WebSocket>();

  public constructor(options: BridgeServerOptions = {}) {
    this.#port = options.port ?? DEFAULT_BRIDGE_PORT;
    this.#token = options.token;
    this.#heartbeatMs = options.heartbeatMs ?? 20_000;
    this.#log = options.log ?? ((): void => undefined);
  }

  /** The port the server is bound to (resolved when `port: 0` is used). */
  public get port(): number {
    return this.#boundPort ?? this.#port;
  }

  /** Whether an extension is currently connected. */
  public get extensionConnected(): boolean {
    return this.#extension !== undefined && this.#extension.readyState === this.#extension.OPEN;
  }

  /** Starts listening on the loopback interface. */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: "127.0.0.1", port: this.#port });
      wss.on("listening", () => {
        this.#wss = wss;
        const address = wss.address();
        if (typeof address === "object" && address !== null) {
          this.#boundPort = address.port;
        }
        this.#heartbeat = setInterval(() => {
          this.#pingExtension();
        }, this.#heartbeatMs);
        this.#log(`bridge listening on 127.0.0.1:${String(this.#port)}`);
        resolve();
      });
      wss.on("error", reject);
      wss.on("connection", (socket) => {
        this.#onConnection(socket);
      });
    });
  }

  /** Stops the server and drops all connections. */
  public stop(): Promise<void> {
    if (this.#heartbeat) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = undefined;
    }
    const wss = this.#wss;
    this.#wss = undefined;
    this.#extension = undefined;
    this.#cliByCommandId.clear();
    if (!wss) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
  }

  #pingExtension(): void {
    if (this.extensionConnected) {
      this.#extension?.send(encodeMessage({ type: "ping" }));
    }
  }

  #authOk(token: string | undefined): boolean {
    return this.#token === undefined || this.#token === token;
  }

  #onConnection(socket: WebSocket): void {
    let role: "extension" | "cli" | undefined;

    socket.on("message", (data) => {
      const message = parseMessage(rawDataToString(data));
      if (!message) {
        return;
      }
      switch (message.type) {
        case "hello": {
          if (!this.#authOk(message.token)) {
            this.#log(`rejected ${message.role} (bad token)`);
            socket.close(4001, "unauthorized");
            return;
          }
          role = message.role;
          if (role === "extension") {
            this.#extension = socket;
            this.#log("extension connected");
          }
          return;
        }
        case "command": {
          if (role !== "cli") {
            return;
          }
          this.#relayCommand(socket, message);
          return;
        }
        case "result": {
          if (role !== "extension") {
            return;
          }
          const cli = this.#cliByCommandId.get(message.id);
          this.#cliByCommandId.delete(message.id);
          cli?.send(encodeMessage(message));
          return;
        }
        case "pong":
          return;
        case "ping":
          socket.send(encodeMessage({ type: "pong" }));
          return;
      }
    });

    socket.on("close", () => {
      if (role === "extension" && this.#extension === socket) {
        this.#extension = undefined;
        this.#log("extension disconnected");
      }
    });
    socket.on("error", () => {
      /* connection errors surface as close events */
    });
  }

  #relayCommand(cli: WebSocket, command: CommandMessage): void {
    if (!this.extensionConnected || !this.#extension) {
      cli.send(
        encodeMessage({
          type: "result",
          id: command.id,
          ok: false,
          error: "No extension connected to the bridge. Is Chrome open with the aichatctl extension loaded?",
        }),
      );
      return;
    }
    this.#cliByCommandId.set(command.id, cli);
    this.#extension.send(encodeMessage(command));
  }
}
