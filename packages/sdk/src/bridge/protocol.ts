import type { RawData } from "ws";
import { z } from "zod";

/**
 * Wire protocol for the localhost bridge between the CLI and the in-browser
 * extension. All messages are JSON over a WebSocket.
 *
 * Roles:
 *  - `extension`: the MV3 service worker running in the user's real Chrome.
 *  - `cli`: a short-lived CLI invocation submitting one command.
 *
 * The server relays a `command` from a cli client to the extension, then routes
 * the extension's `result` back to the originating cli client.
 */

/** Default port the bridge listens on (loopback only). */
export const DEFAULT_BRIDGE_PORT = 8917;

export const helloSchema = z.object({
  type: z.literal("hello"),
  role: z.enum(["extension", "cli"]),
  token: z.string().optional(),
});

export const commandSchema = z.object({
  type: z.literal("command"),
  id: z.string().min(1),
  action: z.string().min(1),
  params: z.unknown(),
});

export const resultSchema = z.union([
  z.object({ type: z.literal("result"), id: z.string().min(1), ok: z.literal(true), data: z.unknown() }),
  z.object({
    type: z.literal("result"),
    id: z.string().min(1),
    ok: z.literal(false),
    error: z.string(),
  }),
]);

export const pingSchema = z.object({ type: z.literal("ping") });
export const pongSchema = z.object({ type: z.literal("pong") });

export const messageSchema = z.union([
  helloSchema,
  commandSchema,
  resultSchema,
  pingSchema,
  pongSchema,
]);

export type HelloMessage = z.infer<typeof helloSchema>;
export type CommandMessage = z.infer<typeof commandSchema>;
export type ResultMessage = z.infer<typeof resultSchema>;
export type BridgeMessage = z.infer<typeof messageSchema>;

/** Parses an incoming JSON string into a validated bridge message. */
export function parseMessage(raw: string): BridgeMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = messageSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Serializes a bridge message to a JSON string. */
export function encodeMessage(message: BridgeMessage): string {
  return JSON.stringify(message);
}

/** Decodes a `ws` RawData frame (Buffer | ArrayBuffer | Buffer[]) to a UTF-8 string. */
export function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}
