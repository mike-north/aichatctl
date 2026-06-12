import type { Page } from "playwright-core";

import type { NamedSelector } from "../driver.js";

/**
 * Centralized ChatGPT (chatgpt.com) locators.
 *
 * ⚠️ LIVE CALIBRATION REQUIRED. Best-effort locators written without access to
 * the live, logged-in DOM. Validate with `aichatctl doctor` and adjust via
 * `pnpm exec playwright codegen https://chatgpt.com`. UI drift is a single-file
 * fix here.
 */
export const chatgptUrls = {
  base: "https://chatgpt.com",
  project: (id: string): string => `https://chatgpt.com/g/${id}/project`,
} as const;

export const chatgptSelectors = {
  /** Prompt composer (ChatGPT uses #prompt-textarea). */
  composer: {
    name: "composer",
    describe: "prompt composer",
    locate: (page: Page) => page.locator("#prompt-textarea"),
  },
  /** Send button. */
  sendButton: {
    name: "sendButton",
    describe: "submit/send button",
    locate: (page: Page) => page.getByTestId("send-button"),
  },
  /** Account button — logged-in signal. */
  accountButton: {
    name: "accountButton",
    describe: "account/profile button",
    locate: (page: Page) => page.getByTestId("accounts-profile-button"),
  },
  /** Login affordance — logged-out signal. */
  loginButton: {
    name: "loginButton",
    describe: "login affordance",
    locate: (page: Page) => page.getByTestId("login-button"),
  },
  /** Sidebar project links. */
  projectLink: {
    name: "projectLink",
    describe: "project entry in the sidebar",
    locate: (page: Page) => page.locator('a[href*="/g/g-p-"]'),
  },
  /** File rows in a project. */
  projectFile: {
    name: "projectFile",
    describe: "a file row in the project files panel",
    locate: (page: Page) => page.getByTestId("project-file-row"),
  },
  /** Hidden file input for uploads. */
  fileInput: {
    name: "fileInput",
    describe: "file upload input",
    locate: (page: Page) => page.locator('input[type="file"]'),
  },
} as const satisfies Record<string, NamedSelector>;

export type ChatgptSelectorName = keyof typeof chatgptSelectors;
