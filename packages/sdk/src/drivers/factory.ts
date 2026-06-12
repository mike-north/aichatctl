import type { BrowserSession } from "../browser/session.js";
import type { Platform } from "../types.js";
import { ChatgptDriver } from "./chatgpt/driver.js";
import { ClaudeDriver } from "./claude/driver.js";
import type { Driver } from "./driver.js";

/** Constructs the driver for a platform, bound to a browser session. */
export function createDriver(platform: Platform, session: BrowserSession): Driver {
  switch (platform) {
    case "claude":
      return new ClaudeDriver(session);
    case "chatgpt":
      return new ChatgptDriver(session);
  }
}
