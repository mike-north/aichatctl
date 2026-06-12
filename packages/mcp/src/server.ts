import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  createSeededSession,
  doctor,
  listProjects,
  runSync,
} from "@aichatctl/sdk";
import type { Platform } from "@aichatctl/sdk";

import { getServerVersion } from "./version.js";

const platformSchema = z.enum(["claude", "chatgpt"]);
const portSchema = z.number().int().positive().max(65535).optional();

/** Input shapes (ZodRawShape) for each tool, declared at module scope. */
const doctorShape = { port: portSchema } as const;
const projectListShape = { platform: platformSchema, port: portSchema } as const;
const syncShape = {
  configPath: z.string().min(1).default("aichatctl.config.yaml"),
  platform: platformSchema.optional(),
  dryRun: z.boolean().default(false),
  port: portSchema,
} as const;
const sessionCreateShape = {
  platform: platformSchema,
  project: z.string().min(1),
  prompt: z.string().min(1),
  send: z.boolean().default(true),
  port: portSchema,
} as const;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `error: ${message}` }], isError: true };
}

/** Conditionally includes `port` to satisfy exactOptionalPropertyTypes. */
function conn(port: number | undefined): { port?: number } {
  return port === undefined ? {} : { port };
}

/** Builds the aichatctl MCP server with all tools registered. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "aichatctl", version: getServerVersion() });

  server.registerTool(
    "aichat_doctor",
    {
      description:
        "Check CDP reachability, login state, and selector health for Claude.ai and ChatGPT.",
      inputSchema: doctorShape,
    },
    async ({ port }) => {
      try {
        return ok(await doctor(conn(port)));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_project_list",
    {
      description: "List the projects visible on a platform (claude or chatgpt).",
      inputSchema: projectListShape,
    },
    async ({ platform, port }) => {
      try {
        return ok(await listProjects({ platform, ...conn(port) }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_sync",
    {
      description:
        "Mirror local files and instructions declared in the manifest into the project library. " +
        "Use dryRun=true first to preview the plan.",
      inputSchema: syncShape,
    },
    async ({ configPath, platform, dryRun, port }) => {
      try {
        const platforms: readonly Platform[] | undefined =
          platform === undefined ? undefined : [platform];
        return ok(
          await runSync({
            configPath,
            dryRun,
            ...(platforms ? { platforms } : {}),
            ...conn(port),
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_session_create",
    {
      description:
        "Create a new chat session in a project, seeded with a prompt. With send=true the prompt " +
        "is submitted so the conversation can be continued from the mobile app.",
      inputSchema: sessionCreateShape,
    },
    async ({ platform, project, prompt, send, port }) => {
      try {
        return ok(
          await createSeededSession({ platform, project, prompt, send, ...conn(port) }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
