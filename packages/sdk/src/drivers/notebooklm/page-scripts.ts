/**
 * Typed page-script builders for NotebookLM. Each function returns a
 * self-contained JS string that runs in the Chrome page context via
 * evalInChromeTab. Parameters are serialized into the script; result shapes
 * are exported as interfaces so the driver can parse them safely.
 *
 * This keeps untyped JS to a minimum: the string bodies are short,
 * templated from typed inputs, and their return shapes are enforced at
 * the call site.
 *
 * @packageDocumentation
 */

// --- Result interfaces (used by the driver when parsing eval output) ---------

export interface GetNameResult {
  readonly name: string;
  readonly found: boolean;
}

export interface RenameResult {
  readonly ok: boolean;
  readonly why?: string;
}

export interface ListSourcesResult {
  readonly sources: string[];
}

export interface SourceMenuResult {
  readonly ok: boolean;
  readonly why?: string;
}

// --- Selector constants (single source of truth for calibration) -------------

const TITLE_INPUT_SELECTOR = [
  "input.title-input",
  'input[aria-label*="notebook title" i]',
  'input[placeholder*="Untitled" i]',
  '[contenteditable="true"][data-placeholder*="Untitled" i]',
].join(",");

const SOURCE_CONTAINER_SELECTOR = ".single-source-container";

const ICON_TEXT_PATTERN =
  "markdown|more_vert|description|check_box|close|content_paste|link|drive|upload|docs";

// --- Script builders ---------------------------------------------------------

export function scriptGetNotebookName(): string {
  return `
    const el = document.querySelector(${JSON.stringify(TITLE_INPUT_SELECTOR)});
    if (!el) return JSON.stringify({ name: "", found: false });
    const v = el.value !== undefined ? el.value : (el.innerText || "");
    return JSON.stringify({ name: v.trim(), found: true });`;
}

export function scriptRenameNotebook(name: string): string {
  return `
    const el = document.querySelector(${JSON.stringify(TITLE_INPUT_SELECTOR)});
    if (!el) return JSON.stringify({ ok: false, why: "title element not found" });
    el.focus();
    if (el.value !== undefined) {
      const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      d.set.call(el, ${JSON.stringify(name)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.innerText = ${JSON.stringify(name)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.blur();
    return JSON.stringify({ ok: true });`;
}

export function scriptListSources(): string {
  return `
    const containers = document.querySelectorAll(${JSON.stringify(SOURCE_CONTAINER_SELECTOR)});
    const icons = /^(${ICON_TEXT_PATTERN})$/;
    const names = [];
    for (const c of containers) {
      const leaves = [...c.querySelectorAll("span,div,p")].filter(el => el.children.length === 0);
      for (const leaf of leaves) {
        const t = (leaf.textContent || "").trim();
        if (t.length > 1 && !icons.test(t)) { names.push(t); break; }
      }
    }
    return JSON.stringify({ sources: names });`;
}

/**
 * Clicks the three-dot menu button for the source matching `sourceName`.
 * After this resolves, call `scriptClickMenuItem` to pick an action.
 */
export function scriptClickSourceMenu(sourceName: string): string {
  return `
    const containers = document.querySelectorAll(${JSON.stringify(SOURCE_CONTAINER_SELECTOR)});
    const icons = /^(${ICON_TEXT_PATTERN})$/;
    const matches = [];
    for (const c of containers) {
      const leaves = [...c.querySelectorAll("span,div,p")].filter(el => el.children.length === 0);
      for (const leaf of leaves) {
        const t = (leaf.textContent || "").trim();
        if (t.length > 1 && !icons.test(t)) {
          if (t.startsWith(${JSON.stringify(sourceName)})) { matches.push({ container: c, title: t }); }
          break;
        }
      }
    }
    if (matches.length === 0) return JSON.stringify({ ok: false, why: "source not found" });
    if (matches.length > 1) return JSON.stringify({ ok: false, why: "ambiguous prefix: " + matches.map(m => m.title).join(", ") });
    const target = matches[0].container;
    const menuBtn = target.querySelector('button[class*="source-item-more"]')
      || target.querySelector('button[aria-label*="more" i]');
    if (!menuBtn) return JSON.stringify({ ok: false, why: "menu button not found" });
    menuBtn.click();
    return JSON.stringify({ ok: true });`;
}

export function scriptClickMenuItem(actionPattern: string): string {
  return `
    const pattern = ${JSON.stringify(actionPattern)};
    const re = new RegExp(pattern, "i");
    const items = document.querySelectorAll('[role="menuitem"], button.mat-mdc-menu-item, [class*="menu-item"]');
    for (const item of items) {
      if (re.test((item.textContent || "").trim())) {
        item.click();
        return JSON.stringify({ ok: true });
      }
    }
    return JSON.stringify({ ok: false, why: "menu item not found: " + pattern });`;
}

export function scriptConfirmDelete(): string {
  return `
    const btn = document.querySelector("button.primary-button")
      || [...document.querySelectorAll("button")].find(b => /^delete$/i.test((b.textContent || "").trim()));
    if (!btn) return JSON.stringify({ ok: false, why: "delete button not found" });
    btn.click();
    return JSON.stringify({ ok: true });`;
}

export interface LatestSourceResult {
  readonly count: number;
  readonly latestTitle: string;
  readonly settled: boolean;
}

export function scriptGetLatestSource(): string {
  return `
    const containers = document.querySelectorAll(${JSON.stringify(SOURCE_CONTAINER_SELECTOR)});
    const icons = /^(${ICON_TEXT_PATTERN})$/;
    const names = [];
    for (const c of containers) {
      const leaves = [...c.querySelectorAll("span,div,p")].filter(el => el.children.length === 0);
      for (const leaf of leaves) {
        const t = (leaf.textContent || "").trim();
        if (t.length > 1 && !icons.test(t)) { names.push(t); break; }
      }
    }
    const latest = names[names.length - 1] || "";
    const settled = latest.length > 0 && !/^pasted text$/i.test(latest);
    return JSON.stringify({ count: names.length, latestTitle: latest, settled: settled });`;
}

export interface ArtifactTile {
  readonly title: string;
  readonly rawType: string;
  readonly rawState: string;
}

export interface ListArtifactsResult {
  readonly tiles: ArtifactTile[];
}

// CALIBRATION: Studio artifact tiles. Verify against the live NotebookLM UI
// during implementation; this is a best-effort starting selector.
const STUDIO_TILE_SELECTOR = ["artifact-card", ".studio-panel mat-card", '[class*="artifact"]'].join(
  ",",
);

export function scriptListArtifacts(): string {
  return `
    const tiles = document.querySelectorAll(${JSON.stringify(STUDIO_TILE_SELECTOR)});
    const out = [];
    for (const c of tiles) {
      const titleEl = c.querySelector('[class*="title"], .title, h3, h2');
      const title = ((titleEl || c).textContent || "").trim().split("\\n")[0];
      const rawType = c.getAttribute("data-artifact-type") || (c.textContent || "");
      const statusEl = c.querySelector('[class*="status"], [class*="progress"], .loading');
      const rawState = ((statusEl && statusEl.textContent) || "").trim();
      if (title) out.push({ title: title, rawType: rawType, rawState: rawState });
    }
    return JSON.stringify({ tiles: out });`;
}
