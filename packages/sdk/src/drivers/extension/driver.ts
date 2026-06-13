import { z } from "zod";

import { sendBridgeCommand } from "../../bridge/client.js";
import { AichatctlError } from "../../errors.js";
import type { Platform, Project, RemoteFile, SeedResult } from "../../types.js";
import type { CreateSessionOptions, Driver, SelftestResult } from "../driver.js";

const CLAUDE_ID = /\/project\/([^/?#]+)/;
const CHATGPT_ID = /\/g\/(g-p-[^/?#]+)/;

function projectUrl(platform: Platform, id: string): string {
  return platform === "claude"
    ? `https://claude.ai/project/${id}`
    : `https://chatgpt.com/g/${id}/project`;
}

const projectSchema = z.object({ id: z.string(), name: z.string(), url: z.string() });
const remoteFileSchema = z.object({ name: z.string() });
const seedResultSchema = z.object({ url: z.string(), sent: z.boolean() });
const selftestSchema = z.object({
  loggedIn: z.boolean(),
  probes: z.array(z.object({ name: z.string(), ok: z.boolean() })),
});

/**
 * A {@link Driver} whose operations execute in the user's real Chrome via the
 * bridge + extension, rather than over a Playwright CDP connection. Lets the
 * existing `syncPlatform` engine run against the real logged-in session.
 */
export class ExtensionDriver implements Driver {
  public constructor(
    public readonly platform: Platform,
    private readonly options: { bridgePort?: number; token?: string } = {},
  ) {}

  async #cmd<T>(action: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const data = await sendBridgeCommand(
      action,
      { platform: this.platform, ...params },
      {
        ...(this.options.bridgePort !== undefined ? { port: this.options.bridgePort } : {}),
        ...(this.options.token !== undefined ? { token: this.options.token } : {}),
      },
    );
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new AichatctlError(`Extension "${action}" returned unexpected data: ${JSON.stringify(data)}`);
    }
    return parsed.data;
  }

  public async isLoggedIn(): Promise<boolean> {
    const { loggedIn } = await this.#cmd("selftest", {}, selftestSchema);
    return loggedIn;
  }

  public async selftest(): Promise<SelftestResult> {
    const res = await this.#cmd("selftest", {}, selftestSchema);
    return {
      platform: this.platform,
      loggedIn: res.loggedIn,
      probes: res.probes,
      ok: res.loggedIn && res.probes.every((p) => p.ok),
    };
  }

  public async listProjects(): Promise<Project[]> {
    return this.#cmd("listProjects", {}, z.array(projectSchema));
  }

  public async resolveProject(ref: string): Promise<Project> {
    const id = this.platform === "claude" ? CLAUDE_ID.exec(ref)?.[1] : CHATGPT_ID.exec(ref)?.[1];
    if (id !== undefined) {
      return { id, name: ref, url: projectUrl(this.platform, id) };
    }
    // Bare id (no URL wrapper)?
    if (this.platform === "chatgpt" && ref.startsWith("g-p-")) {
      return { id: ref, name: ref, url: projectUrl(this.platform, ref) };
    }
    if (this.platform === "claude" && /^[0-9a-f-]{16,}$/i.test(ref)) {
      return { id: ref, name: ref, url: projectUrl(this.platform, ref) };
    }
    return this.#cmd("resolveProject", { ref }, projectSchema);
  }

  public async getProjectFiles(project: Project): Promise<RemoteFile[]> {
    return this.#cmd("getProjectFiles", { projectUrl: project.url }, z.array(remoteFileSchema));
  }

  public async uploadProjectFile(project: Project, localPath: string): Promise<void> {
    await this.#cmd("uploadProjectFile", { projectUrl: project.url, localPath }, z.unknown());
  }

  public async deleteProjectFile(project: Project, remoteName: string): Promise<void> {
    await this.#cmd("deleteProjectFile", { projectUrl: project.url, name: remoteName }, z.unknown());
  }

  public async getProjectInstructions(project: Project): Promise<string> {
    const { text } = await this.#cmd(
      "getProjectInstructions",
      { projectUrl: project.url },
      z.object({ text: z.string() }),
    );
    return text;
  }

  public async setProjectInstructions(project: Project, text: string): Promise<void> {
    await this.#cmd("setProjectInstructions", { projectUrl: project.url, text }, z.unknown());
  }

  public async createSeededSession(
    project: Project,
    prompt: string,
    options: CreateSessionOptions,
  ): Promise<SeedResult> {
    return this.#cmd(
      "seedSession",
      { project: project.url, prompt, send: options.send, background: true },
      seedResultSchema,
    );
  }
}
