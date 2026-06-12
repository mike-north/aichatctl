import type { Page } from "playwright-core";

import type { BrowserSession } from "../browser/session.js";
import type { Platform, Project, RemoteFile, SeedResult } from "../types.js";
import type {
  CreateSessionOptions,
  Driver,
  NamedSelector,
  SelectorProbe,
  SelftestResult,
} from "./driver.js";

/**
 * Shared scaffolding for platform drivers: connection plumbing, a generic
 * selector-probing selftest, and page lifecycle helpers. Concrete drivers
 * implement the platform-specific navigation and the actual DOM actions.
 */
export abstract class BaseDriver implements Driver {
  public abstract readonly platform: Platform;
  /** Landing URL used for login checks and selftest. */
  protected abstract readonly baseUrl: string;
  /** Selectors probed by {@link selftest} (expected on {@link baseUrl} when logged in). */
  protected abstract readonly smokeSelectors: readonly NamedSelector[];

  protected constructor(protected readonly session: BrowserSession) {}

  /** Opens a page (optionally navigating to a URL) in the attached browser. */
  protected open(url?: string): Promise<Page> {
    return this.session.newPage(url);
  }

  /** Platform-specific login check given an open page on {@link baseUrl}. */
  protected abstract checkLoggedIn(page: Page): Promise<boolean>;

  public async isLoggedIn(): Promise<boolean> {
    const page = await this.open(this.baseUrl);
    try {
      return await this.checkLoggedIn(page);
    } finally {
      await page.close();
    }
  }

  public async selftest(): Promise<SelftestResult> {
    const page = await this.open(this.baseUrl);
    try {
      const loggedIn = await this.checkLoggedIn(page);
      const probes: SelectorProbe[] = [];
      for (const selector of this.smokeSelectors) {
        let ok = false;
        try {
          ok = (await selector.locate(page).count()) > 0;
        } catch {
          ok = false;
        }
        probes.push({ name: selector.name, ok });
      }
      return {
        platform: this.platform,
        loggedIn,
        probes,
        ok: loggedIn && probes.every((p) => p.ok),
      };
    } finally {
      await page.close();
    }
  }

  public abstract listProjects(): Promise<Project[]>;
  public abstract resolveProject(ref: string): Promise<Project>;
  public abstract getProjectFiles(project: Project): Promise<RemoteFile[]>;
  public abstract uploadProjectFile(project: Project, localPath: string): Promise<void>;
  public abstract deleteProjectFile(project: Project, remoteName: string): Promise<void>;
  public abstract getProjectInstructions(project: Project): Promise<string>;
  public abstract setProjectInstructions(project: Project, text: string): Promise<void>;
  public abstract createSeededSession(
    project: Project,
    prompt: string,
    options: CreateSessionOptions,
  ): Promise<SeedResult>;
}
