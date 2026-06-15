import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  buildNotebookSources,
  createNotebookPodcast,
  createSeededSession,
  createSeededSessionViaApplescript,
  doctor,
  doctorApplescript,
  listProjects,
  runSync,
} from "@aichatctl/sdk";
import type { Platform } from "@aichatctl/sdk";

import { getServerVersion } from "./version.js";

const seedPlatformSchema = z.enum(["claude", "chatgpt", "gemini"]);
const syncPlatformSchema = z.enum(["claude", "chatgpt"]);
const transportSchema = z.enum(["cdp", "applescript"]);
const portSchema = z.number().int().positive().max(65535).optional();
const formatSchema = z.enum(["deep-dive", "brief", "critique", "debate"]).default("deep-dive");
const lengthSchema = z.enum(["short", "default", "long"]).default("default");

/** Input shapes (ZodRawShape) for each tool, declared at module scope. */
const doctorShape = { transport: transportSchema.default("cdp"), port: portSchema } as const;
const projectListShape = { platform: syncPlatformSchema, port: portSchema } as const;
const syncShape = {
  configPath: z.string().min(1).default("aichatctl.config.yaml"),
  platform: syncPlatformSchema.optional(),
  dryRun: z.boolean().default(false),
  transport: transportSchema.default("cdp"),
  port: portSchema,
} as const;
const sessionCreateShape = {
  platform: seedPlatformSchema,
  project: z.string().min(1),
  prompt: z.string().min(1),
  send: z.boolean().default(true),
  transport: transportSchema.default("cdp"),
  port: portSchema,
} as const;
const notebookCreateShape = {
  files: z.array(z.string().min(1)).default([]),
  urls: z.array(z.string().min(1)).default([]),
  text: z.string().min(1).optional(),
  format: formatSchema,
  length: lengthSchema,
  prompt: z.string().min(1).optional(),
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
        "Check transport readiness: CDP reachability + login (transport=cdp), or the " +
        "AppleScript prerequisites + per-platform login (transport=applescript).",
      inputSchema: doctorShape,
    },
    async ({ transport, port }) => {
      try {
        return ok(
          transport === "applescript" ? await doctorApplescript() : await doctor(conn(port)),
        );
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
        "Use dryRun=true first to preview the plan. transport=applescript drives your real Chrome (macOS).",
      inputSchema: syncShape,
    },
    async ({ configPath, platform, dryRun, transport, port }) => {
      try {
        const platforms: readonly Platform[] | undefined =
          platform === undefined ? undefined : [platform];
        return ok(
          await runSync({
            configPath,
            dryRun,
            transport,
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
        "Create a new chat session in a project, seeded with a prompt. send=true submits it so the " +
        "conversation can be continued from the mobile app. Gemini is seed-only and requires transport=applescript.",
      inputSchema: sessionCreateShape,
    },
    async ({ platform, project, prompt, send, transport, port }) => {
      try {
        if (platform === "gemini" && transport !== "applescript") {
          return fail(new Error("Gemini is supported only via transport=applescript."));
        }
        const result =
          transport === "applescript"
            ? await createSeededSessionViaApplescript({ platform, project, prompt, send })
            : await createSeededSession({ platform, project, prompt, send, ...conn(port) });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_notebook_create",
    {
      description:
        "Create a NotebookLM notebook from local files and/or URLs and kick off an Audio Overview " +
        "(podcast). Each file becomes a text source; each URL its own source. Returns the notebook URL " +
        "once generation starts (the audio renders in the background). macOS only (uses AppleScript).",
      inputSchema: notebookCreateShape,
    },
    async ({ files, urls, text, format, length, prompt }) => {
      try {
        const sources = buildNotebookSources({
          files,
          urls,
          ...(text !== undefined ? { text } : {}),
        });
        if (sources.length === 0) {
          return fail(new Error("Provide at least one source: files, urls, or text."));
        }
        return ok(
          await createNotebookPodcast({
            sources,
            audio: { format, length, ...(prompt !== undefined ? { prompt } : {}) },
          }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
