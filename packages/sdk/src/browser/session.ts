import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";

import { DEFAULT_CDP_PORT } from "../config.js";
import { BrowserNotReachableError } from "../errors.js";

/** Options for attaching to a running Chrome over CDP. */
export interface ConnectOptions {
  /** Remote debugging port to attach to. */
  readonly port?: number;
  /** Per-operation timeout (ms) applied to pages created from this session. */
  readonly timeoutMs?: number;
}

/** Probes whether a CDP endpoint is reachable on the given port. */
export async function isCdpReachable(port: number = DEFAULT_CDP_PORT): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Owns a CDP connection to the user's real Chrome and hands out pages.
 *
 * Attaching (rather than launching a throwaway Chromium) reuses the user's
 * logged-in cookies. `close()` disconnects without closing the browser.
 */
export class BrowserSession {
  readonly #browser: Browser;
  readonly #timeoutMs: number;

  private constructor(browser: Browser, timeoutMs: number) {
    this.#browser = browser;
    this.#timeoutMs = timeoutMs;
  }

  /** Attaches to Chrome over CDP, verifying reachability first. */
  public static async connect(options: ConnectOptions = {}): Promise<BrowserSession> {
    const port = options.port ?? DEFAULT_CDP_PORT;
    const endpoint = `http://127.0.0.1:${String(port)}`;
    if (!(await isCdpReachable(port))) {
      throw new BrowserNotReachableError(endpoint);
    }
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      return new BrowserSession(browser, options.timeoutMs ?? 30_000);
    } catch (cause) {
      throw new BrowserNotReachableError(endpoint, { cause });
    }
  }

  /** The real profile's browser context (the first existing context). */
  public context(): BrowserContext {
    const [context] = this.#browser.contexts();
    if (!context) {
      throw new BrowserNotReachableError("cdp", {
        cause: new Error("Connected browser exposed no contexts"),
      });
    }
    return context;
  }

  /** Opens a fresh page in the real profile context, optionally navigating to a URL. */
  public async newPage(url?: string): Promise<Page> {
    const page = await this.context().newPage();
    page.setDefaultTimeout(this.#timeoutMs);
    if (url !== undefined) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
    return page;
  }

  /** Disconnects from Chrome. Does NOT close the user's browser. */
  public async close(): Promise<void> {
    await this.#browser.close();
  }
}
