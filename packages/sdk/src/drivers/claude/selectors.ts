import type { Page } from "playwright-core";

import type { NamedSelector } from "../driver.js";

/**
 * Centralized Claude.ai (claude.ai) locators.
 *
 * ⚠️ LIVE CALIBRATION REQUIRED. These are best-effort locators written without
 * access to the live, logged-in DOM. Before relying on the driver, run
 * `aichatctl doctor` and adjust any failing entry here using Playwright codegen
 * (`pnpm exec playwright codegen https://claude.ai`). Keeping every locator in
 * this one file means UI drift is always a single-file fix.
 */
export const claudeUrls = {
  base: "https://claude.ai",
  projects: "https://claude.ai/projects",
  project: (id: string): string => `https://claude.ai/project/${id}`,
} as const;

export const claudeSelectors = {
  /** Message composer textbox (present on home + project + chat). */
  composer: {
    name: "composer",
    describe: "main message input",
    locate: (page: Page) => page.getByRole("textbox").first(),
  },
  /** Account/user menu button — used as a logged-in signal. */
  userMenu: {
    name: "userMenu",
    describe: "account menu button",
    locate: (page: Page) => page.getByTestId("user-menu-button"),
  },
  /** A "log in" affordance — used as a logged-out signal. */
  loginButton: {
    name: "loginButton",
    describe: "login affordance",
    locate: (page: Page) => page.getByRole("button", { name: /log ?in|sign ?in/i }),
  },
  /** Links/cards in the projects list. */
  projectLink: {
    name: "projectLink",
    describe: "project entry in the projects list",
    locate: (page: Page) => page.locator('a[href^="/project/"]'),
  },
  /** Send button in the composer. */
  sendButton: {
    name: "sendButton",
    describe: "submit/send message button",
    locate: (page: Page) => page.getByRole("button", { name: /send/i }),
  },
  /** File-library rows on the project page. */
  projectFile: {
    name: "projectFile",
    describe: "a file row in the project knowledge/library",
    locate: (page: Page) => page.getByTestId("project-file-row"),
  },
  /** Hidden <input type=file> used for uploads. */
  fileInput: {
    name: "fileInput",
    describe: "file upload input",
    locate: (page: Page) => page.locator('input[type="file"]'),
  },
} as const satisfies Record<string, NamedSelector>;

export type ClaudeSelectorName = keyof typeof claudeSelectors;
