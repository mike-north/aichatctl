import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  addNotebookSource,
  createEmptyNotebook,
  createSeededSession,
  doctorApplescript,
  generateNotebookPodcast,
  listNotebookSources,
  listProjects,
  removeNotebookSource,
  renameNotebook,
  runSync,
} from "@aichatctl/sdk";
import type { Platform } from "@aichatctl/sdk";

import { getServerVersion } from "./version.js";

const seedPlatformSchema = z.enum(["claude", "chatgpt", "gemini"]);
const syncPlatformSchema = z.enum(["claude", "chatgpt"]);
const formatSchema = z.enum(["deep-dive", "brief", "critique", "debate"]).default("deep-dive");
const lengthSchema = z.enum(["short", "default", "long"]).default("default");

/** Input shapes (ZodRawShape) for each tool, declared at module scope. */
const projectListShape = { platform: syncPlatformSchema } as const;
const syncShape = {
  configPath: z.string().min(1).default("aichatctl.config.yaml"),
  platform: syncPlatformSchema.optional(),
  dryRun: z.boolean().default(false),
} as const;
const sessionCreateShape = {
  platform: seedPlatformSchema,
  project: z.string().min(1),
  prompt: z.string().min(1),
  send: z.boolean().default(true),
} as const;
const notebookNewShape = {
  name: z.string().min(1).optional(),
} as const;
const notebookRenameShape = {
  notebook: z.string().min(1),
  name: z.string().min(1),
} as const;
const notebookSourcesShape = {
  notebook: z.string().min(1),
} as const;
const notebookPodcastShape = {
  notebook: z.string().min(1),
  type: formatSchema,
  length: lengthSchema,
  prompt: z.string().min(1).optional(),
} as const;
const notebookSourceAddShape = {
  notebook: z.string().min(1),
  kind: z.enum(["text", "url"]),
  content: z.string().min(1),
} as const;
const notebookSourceRemoveShape = {
  notebook: z.string().min(1),
  source: z.string().min(1),
} as const;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `error: ${message}` }], isError: true };
}

/** Builds the aichatctl MCP server with all tools registered. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "aichatctl", version: getServerVersion() });

  server.registerTool(
    "aichat_doctor",
    {
      description:
        "Check readiness: Chrome's 'Allow JavaScript from Apple Events' setting plus per-platform login state (macOS, drives your real Chrome).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await doctorApplescript());
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
    async ({ platform }) => {
      try {
        return ok(await listProjects({ platform }));
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
        "Use dryRun=true first to preview the plan. Drives your real, logged-in Chrome (macOS).",
      inputSchema: syncShape,
    },
    async ({ configPath, platform, dryRun }) => {
      try {
        const platforms: readonly Platform[] | undefined =
          platform === undefined ? undefined : [platform];
        return ok(
          await runSync({
            configPath,
            dryRun,
            ...(platforms ? { platforms } : {}),
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
        "conversation can be continued from the mobile app. Drives your real, logged-in Chrome (macOS).",
      inputSchema: sessionCreateShape,
    },
    async ({ platform, project, prompt, send }) => {
      try {
        return ok(await createSeededSession({ platform, project, prompt, send }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_notebook_new",
    {
      description:
        "Create an empty NotebookLM notebook, optionally naming it. Returns the notebook id, " +
        "URL, and name. macOS only (uses AppleScript).",
      inputSchema: notebookNewShape,
    },
    async ({ name }) => {
      try {
        return ok(await createEmptyNotebook({ ...(name !== undefined ? { name } : {}) }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_notebook_rename",
    {
      description: "Rename an existing NotebookLM notebook. macOS only (uses AppleScript).",
      inputSchema: notebookRenameShape,
    },
    async ({ notebook, name }) => {
      try {
        await renameNotebook({ notebook, name });
        return ok({ notebook, name, renamed: true });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_notebook_sources",
    {
      description:
        "List the display names of sources currently in a NotebookLM notebook. " +
        "Use this to verify sources were added before generating a podcast. macOS only (uses AppleScript).",
      inputSchema: notebookSourcesShape,
    },
    async ({ notebook }) => {
      try {
        return ok(await listNotebookSources({ notebook }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_notebook_podcast",
    {
      description:
        "Generate an Audio Overview (podcast) on an existing NotebookLM notebook that already " +
        "has sources. Returns once generation is kicked off (audio renders in the background over minutes). " +
        "macOS only (uses AppleScript).",
      inputSchema: notebookPodcastShape,
    },
    async ({ notebook, type, length, prompt }) => {
      try {
        await generateNotebookPodcast({
          notebook,
          audio: { format: type, length, ...(prompt !== undefined ? { prompt } : {}) },
        });
        return ok({ notebook, podcastKicked: true, type, length });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_notebook_source_add",
    {
      description:
        "Add a source to a NotebookLM notebook (text content or a URL). Waits for NotebookLM to " +
        "auto-generate a title, then returns it. The title is the handle for future source_remove calls. " +
        "macOS only (uses AppleScript).",
      inputSchema: notebookSourceAddShape,
    },
    async ({ notebook, kind, content }) => {
      try {
        return ok(await addNotebookSource({ notebook, kind, content }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "aichat_notebook_source_remove",
    {
      description:
        "Remove a source from a NotebookLM notebook by its display name (or prefix). " +
        "macOS only (uses AppleScript).",
      inputSchema: notebookSourceRemoveShape,
    },
    async ({ notebook, source }) => {
      try {
        await removeNotebookSource({ notebook, source });
        return ok({ notebook, source, removed: true });
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
