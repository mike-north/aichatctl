import type { Page } from "playwright-core";

import type { BrowserSession } from "../../browser/session.js";
import { ProjectNotFoundError, SelectorError } from "../../errors.js";
import type { Platform, Project, RemoteFile, SeedResult } from "../../types.js";
import { BaseDriver } from "../base.js";
import type { CreateSessionOptions, NamedSelector } from "../driver.js";
import { claudeSelectors, claudeUrls } from "./selectors.js";

const PROJECT_ID_FROM_URL = /\/project\/([^/?#]+)/;

/**
 * Claude.ai driver. All locators live in {@link claudeSelectors}.
 *
 * Several flows (delete confirmation, instructions editor) are marked for live
 * calibration — verify them with `aichatctl doctor` and Playwright codegen.
 */
export class ClaudeDriver extends BaseDriver {
  public readonly platform: Platform = "claude";
  protected readonly baseUrl = claudeUrls.base;
  protected readonly smokeSelectors: readonly NamedSelector[] = [
    claudeSelectors.composer,
    claudeSelectors.userMenu,
  ];

  public constructor(session: BrowserSession) {
    super(session);
  }

  protected async checkLoggedIn(page: Page): Promise<boolean> {
    // Logged in if the account menu is present and no login affordance is shown.
    const hasUserMenu = (await claudeSelectors.userMenu.locate(page).count()) > 0;
    const hasLogin = (await claudeSelectors.loginButton.locate(page).count()) > 0;
    return hasUserMenu && !hasLogin;
  }

  public async listProjects(): Promise<Project[]> {
    const page = await this.open(claudeUrls.projects);
    try {
      const links = claudeSelectors.projectLink.locate(page);
      const count = await links.count();
      const projects: Project[] = [];
      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        const href = await link.getAttribute("href");
        const name = (await link.innerText()).trim();
        if (href === null) {
          continue;
        }
        const id = PROJECT_ID_FROM_URL.exec(href)?.[1];
        if (id === undefined) {
          continue;
        }
        projects.push({ id, name, url: claudeUrls.project(id) });
      }
      return projects;
    } finally {
      await page.close();
    }
  }

  public async resolveProject(ref: string): Promise<Project> {
    const fromUrl = PROJECT_ID_FROM_URL.exec(ref)?.[1];
    if (fromUrl !== undefined) {
      return { id: fromUrl, name: ref, url: claudeUrls.project(fromUrl) };
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
      const rows = claudeSelectors.projectFile.locate(page);
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
      const input = claudeSelectors.fileInput.locate(page);
      if ((await input.count()) === 0) {
        throw new SelectorError(this.platform, claudeSelectors.fileInput.name);
      }
      await input.setInputFiles(localPath);
      // Allow the upload to register before the page is torn down.
      await page.waitForTimeout(1500);
    } finally {
      await page.close();
    }
  }

  public async deleteProjectFile(project: Project, remoteName: string): Promise<void> {
    const page = await this.open(project.url);
    try {
      const row = claudeSelectors.projectFile.locate(page).filter({ hasText: remoteName }).first();
      if ((await row.count()) === 0) {
        // Already absent — nothing to do.
        return;
      }
      // TODO(live-calibration): confirm the exact delete affordance + confirm dialog.
      await row.getByRole("button", { name: /delete|remove/i }).click();
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
      // TODO(live-calibration): locate the instructions editor textbox.
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
      // TODO(live-calibration): open the instructions editor and persist.
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
      const composer = claudeSelectors.composer.locate(page);
      if ((await composer.count()) === 0) {
        throw new SelectorError(this.platform, claudeSelectors.composer.name);
      }
      await composer.fill(prompt);
      if (!options.send) {
        return { url: page.url(), sent: false };
      }
      await composer.press("Enter");
      // A new conversation navigates to /chat/<id>.
      await page.waitForURL(/\/chat\//, { timeout: 30_000 }).catch(() => undefined);
      return { url: page.url(), sent: true };
    } finally {
      await page.close();
    }
  }
}
