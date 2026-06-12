import type { Page } from "playwright-core";

import type { BrowserSession } from "../../browser/session.js";
import { ProjectNotFoundError, SelectorError } from "../../errors.js";
import type { Platform, Project, RemoteFile, SeedResult } from "../../types.js";
import { BaseDriver } from "../base.js";
import type { CreateSessionOptions, NamedSelector } from "../driver.js";
import { chatgptSelectors, chatgptUrls } from "./selectors.js";

const PROJECT_ID_FROM_URL = /\/g\/(g-p-[^/?#]+)/;

/**
 * ChatGPT driver. All locators live in {@link chatgptSelectors}.
 *
 * File-management and instructions flows are marked for live calibration.
 */
export class ChatgptDriver extends BaseDriver {
  public readonly platform: Platform = "chatgpt";
  protected readonly baseUrl = chatgptUrls.base;
  protected readonly smokeSelectors: readonly NamedSelector[] = [
    chatgptSelectors.composer,
    chatgptSelectors.accountButton,
  ];

  public constructor(session: BrowserSession) {
    super(session);
  }

  protected async checkLoggedIn(page: Page): Promise<boolean> {
    const hasAccount = (await chatgptSelectors.accountButton.locate(page).count()) > 0;
    const hasLogin = (await chatgptSelectors.loginButton.locate(page).count()) > 0;
    return hasAccount && !hasLogin;
  }

  public async listProjects(): Promise<Project[]> {
    const page = await this.open(chatgptUrls.base);
    try {
      const links = chatgptSelectors.projectLink.locate(page);
      const count = await links.count();
      const seen = new Set<string>();
      const projects: Project[] = [];
      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        const href = await link.getAttribute("href");
        const name = (await link.innerText()).trim();
        const id = href === null ? undefined : PROJECT_ID_FROM_URL.exec(href)?.[1];
        if (id === undefined || seen.has(id)) {
          continue;
        }
        seen.add(id);
        projects.push({ id, name, url: chatgptUrls.project(id) });
      }
      return projects;
    } finally {
      await page.close();
    }
  }

  public async resolveProject(ref: string): Promise<Project> {
    const fromUrl = PROJECT_ID_FROM_URL.exec(ref)?.[1];
    if (fromUrl !== undefined) {
      return { id: fromUrl, name: ref, url: chatgptUrls.project(fromUrl) };
    }
    const projects = await this.listProjects();
    const match =
      projects.find((p) => p.name === ref) ??
      projects.find((p) => p.name.toLowerCase() === ref.toLowerCase());
    if (!match) {
      throw new ProjectNotFoundError(this.platform, ref);
    }
    return match;
  }

  public async getProjectFiles(project: Project): Promise<RemoteFile[]> {
    const page = await this.open(project.url);
    try {
      const rows = chatgptSelectors.projectFile.locate(page);
      const count = await rows.count();
      const files: RemoteFile[] = [];
      for (let i = 0; i < count; i++) {
        const name = (await rows.nth(i).innerText()).trim();
        if (name.length > 0) {
          files.push({ name });
        }
      }
      return files;
    } finally {
      await page.close();
    }
  }

  public async uploadProjectFile(project: Project, localPath: string): Promise<void> {
    const page = await this.open(project.url);
    try {
      const input = chatgptSelectors.fileInput.locate(page);
      if ((await input.count()) === 0) {
        throw new SelectorError(this.platform, chatgptSelectors.fileInput.name);
      }
      await input.setInputFiles(localPath);
      await page.waitForTimeout(1500);
    } finally {
      await page.close();
    }
  }

  public async deleteProjectFile(project: Project, remoteName: string): Promise<void> {
    const page = await this.open(project.url);
    try {
      const row = chatgptSelectors.projectFile
        .locate(page)
        .filter({ hasText: remoteName })
        .first();
      if ((await row.count()) === 0) {
        return;
      }
      // TODO(live-calibration): confirm delete affordance + confirmation step.
      await row.getByRole("button", { name: /delete|remove|trash/i }).click();
      await page
        .getByRole("button", { name: /^(delete|remove|confirm)$/i })
        .click({ timeout: 3000 })
        .catch(() => undefined);
    } finally {
      await page.close();
    }
  }

  public async getProjectInstructions(project: Project): Promise<string> {
    const page = await this.open(project.url);
    try {
      // TODO(live-calibration): locate the instructions textarea.
      const box = page.getByRole("textbox", { name: /instruction/i }).first();
      if ((await box.count()) === 0) {
        return "";
      }
      return (await box.inputValue().catch(() => box.innerText())).trim();
    } finally {
      await page.close();
    }
  }

  public async setProjectInstructions(project: Project, text: string): Promise<void> {
    const page = await this.open(project.url);
    try {
      // TODO(live-calibration): open instructions editor and persist.
      const box = page.getByRole("textbox", { name: /instruction/i }).first();
      if ((await box.count()) === 0) {
        throw new SelectorError(this.platform, "instructionsEditor");
      }
      await box.fill(text);
      await page
        .getByRole("button", { name: /save|update|done/i })
        .first()
        .click({ timeout: 3000 })
        .catch(() => undefined);
    } finally {
      await page.close();
    }
  }

  public async createSeededSession(
    project: Project,
    prompt: string,
    options: CreateSessionOptions,
  ): Promise<SeedResult> {
    const page = await this.open(project.url);
    try {
      const composer = chatgptSelectors.composer.locate(page);
      if ((await composer.count()) === 0) {
        throw new SelectorError(this.platform, chatgptSelectors.composer.name);
      }
      await composer.click();
      await composer.fill(prompt);
      if (!options.send) {
        return { url: page.url(), sent: false };
      }
      await composer.press("Enter");
      await page.waitForURL(/\/c\//, { timeout: 30_000 }).catch(() => undefined);
      return { url: page.url(), sent: true };
    } finally {
      await page.close();
    }
  }
}
