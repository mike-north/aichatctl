import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";

import { AichatctlError } from "../errors.js";
import {
  DEFAULT_BRIDGE_PORT,
  encodeMessage,
  parseMessage,
  rawDataToString,
} from "./protocol.js";

/** Options for a one-shot bridge command. */
export interface BridgeCommandOptions {
  readonly port?: number;
  readonly token?: string;
  readonly timeoutMs?: number;
}

/** Thrown when the bridge daemon is unreachable or a command fails. */
export class BridgeError extends AichatctlError {
  public override readonly name = "BridgeError";
}

/**
 * Connects to the bridge daemon as a `cli` client, submits a single command,
 * and resolves with the extension's result payload (or throws on failure).
 */
export function sendBridgeCommand(
  action: string,
  params: unknown,
  options: BridgeCommandOptions = {},
): Promise<unknown> {
  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const id = randomUUID();

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}`);
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      ws.close();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        reject(new BridgeError(`Bridge command "${action}" timed out after ${String(timeoutMs)}ms.`));
      });
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(encodeMessage({ type: "hello", role: "cli", ...(options.token ? { token: options.token } : {}) }));
      ws.send(encodeMessage({ type: "command", id, action, params }));
    });

    ws.on("message", (data) => {
      const message = parseMessage(rawDataToString(data));
      if (message?.type !== "result" || message.id !== id) {
        return;
      }
      finish(() => {
        if (message.ok) {
          resolve(message.data);
        } else {
          reject(new BridgeError(message.error));
        }
      });
    });

    ws.on("error", (err: Error) => {
      finish(() => {
        reject(
          new BridgeError(
            `Could not reach the bridge on port ${String(port)} (${err.message}). ` +
              `Start it with \`aichatctl bridge serve\`.`,
          ),
        );
      });
    });

    ws.on("close", (code: number) => {
      // The daemon closes with 4001 when the token is missing/wrong; fail fast
      // instead of waiting out the timeout.
      finish(() => {
        reject(
          new BridgeError(
            code === 4001
              ? "Bridge rejected the token (unauthorized). Run `aichatctl bridge token` and configure the extension."
              : `Bridge connection closed before a result (code ${String(code)}).`,
          ),
        );
      });
    });
  });
}
