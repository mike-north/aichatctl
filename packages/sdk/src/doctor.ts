import { BrowserSession } from "./browser/session.js";
import { isCdpReachable } from "./browser/session.js";
import { DEFAULT_CDP_PORT } from "./config.js";
import { createDriver } from "./drivers/factory.js";
import type { SelftestResult } from "./drivers/driver.js";
import { SYNC_PLATFORMS } from "./types.js";
import type { Platform } from "./types.js";

/** Aggregated health report for `aichatctl doctor`. */
export interface DoctorReport {
  readonly cdpPort: number;
  readonly cdpReachable: boolean;
  readonly platforms: readonly SelftestResult[];
  /** True when CDP is reachable and every probed platform passed its selftest. */
  readonly ok: boolean;
}

/** Options for {@link doctor}. */
export interface DoctorOptions {
  readonly port?: number;
  /** Platforms to probe (defaults to all). */
  readonly platforms?: readonly Platform[];
}

/**
 * Runs end-to-end health checks: CDP reachability plus a per-platform selftest
 * (login state + smoke selectors). Never throws for an unreachable browser —
 * the unreachable state is reported in the result.
 */
export async function doctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const port = options.port ?? DEFAULT_CDP_PORT;
  // Gemini is AppleScript-only (no CDP driver); the CDP doctor probes the
  // CDP-capable platforms. Use `doctor --transport applescript` for Gemini.
  const platforms = options.platforms ?? SYNC_PLATFORMS;
  const reachable = await isCdpReachable(port);
  if (!reachable) {
    return { cdpPort: port, cdpReachable: false, platforms: [], ok: false };
  }

  const session = await BrowserSession.connect({ port });
  try {
    const results: SelftestResult[] = [];
    for (const platform of platforms) {
      results.push(await createDriver(platform, session).selftest());
    }
    return {
      cdpPort: port,
      cdpReachable: true,
      platforms: results,
      ok: results.every((r) => r.ok),
    };
  } finally {
    await session.close();
  }
}
