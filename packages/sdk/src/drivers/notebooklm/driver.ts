import { evalInChromeTab } from "../../applescript/runner.js";
import { AichatctlError } from "../../errors.js";
import {
  scriptClickMenuItem,
  scriptClickSourceMenu,
  scriptConfirmDelete,
  scriptGetLatestSource,
  scriptGetNotebookName,
  scriptListSources,
  scriptRenameNotebook,
} from "./page-scripts.js";
import type {
  GetNameResult,
  LatestSourceResult,
  ListSourcesResult,
  RenameResult,
  SourceMenuResult,
} from "./page-scripts.js";
import { AUDIO_FORMAT_LABEL, AUDIO_LENGTH_LABEL } from "./types.js";
import type { AudioOverviewOptions } from "./types.js";

const NB_HOST = "notebooklm.google.com";
const NB_HOME = "https://notebooklm.google.com/";
const NOTEBOOK_ID = /\/notebook\/([0-9a-f-]+)/i;
const BARE_UUID = /^[0-9a-f-]+$/i;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A NotebookLM notebook resolved from the URL after creation. */
export interface Notebook {
  readonly id: string;
  readonly url: string;
}

/**
 * Drives the user's real, logged-in Chrome to create a NotebookLM notebook, add
 * sources, and kick off an Audio Overview — via AppleScript (`osascript`), with
 * no extension. macOS-only; requires Chrome's "Allow JavaScript from Apple
 * Events". NotebookLM is not a chat platform, so this is a standalone driver
 * (it does not implement the chat `Driver` interface).
 */
export class NotebookLmDriver {
  readonly #windowIds: readonly string[] | undefined;

  constructor(windowIds?: readonly string[]) {
    this.#windowIds = windowIds;
  }

  /**
   * Parses a notebook reference (full URL or bare hex-UUID id) into a Notebook.
   * Throws if the reference doesn't match the expected format.
   */
  static parseNotebookRef(ref: string): Notebook {
    const urlMatch = NOTEBOOK_ID.exec(ref);
    if (urlMatch?.[1]) {
      return { id: urlMatch[1], url: `https://${NB_HOST}/notebook/${urlMatch[1]}` };
    }
    if (BARE_UUID.test(ref)) {
      return { id: ref, url: `https://${NB_HOST}/notebook/${ref}` };
    }
    throw new AichatctlError(
      `Invalid notebook reference: "${ref}". Provide a NotebookLM URL or a notebook UUID.`,
    );
  }

  /** Runs `jsBody` (which must `return` a JSON string) in the matched tab. */
  async #eval(matchUrl: string, createUrl: string, jsBody: string): Promise<unknown> {
    const js = `(function(){try{${jsBody}}catch(e){return JSON.stringify({__error:String((e&&e.message)||e)});}})()`;
    const out = await evalInChromeTab(js, {
      matchUrl,
      createUrl,
      ...(this.#windowIds !== undefined ? { windowIds: this.#windowIds } : {}),
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new AichatctlError(`AppleScript returned non-JSON: ${out.slice(0, 200)}`);
    }
    if (parsed && typeof parsed === "object" && "__error" in parsed) {
      throw new AichatctlError(`page JS error: ${String(parsed.__error)}`);
    }
    return parsed;
  }

  #evalHome(jsBody: string): Promise<unknown> {
    return this.#eval(NB_HOST, NB_HOME, jsBody);
  }

  #evalNotebook(nb: Notebook, jsBody: string): Promise<unknown> {
    return this.#eval(`notebook/${nb.id}`, nb.url, jsBody);
  }

  public async isLoggedIn(): Promise<boolean> {
    const r = (await this.#evalHome(
      `return JSON.stringify({v: /notebooklm\\.google\\.com/.test(location.host) && (!!document.querySelector('button[aria-label="Create notebook"]') || Array.from(document.querySelectorAll('button')).some(function(b){return /create notebook/i.test(b.innerText||"");}))});`,
    )) as { v: boolean };
    return r.v;
  }

  /** Clicks "Create notebook" and returns the new notebook's id + URL. */
  public async createNotebook(): Promise<Notebook> {
    const clicked = (await this.#evalHome(`
      var b=document.querySelector('button[aria-label="Create notebook"]')||Array.from(document.querySelectorAll('button')).find(function(x){return /create notebook/i.test(x.innerText||"");});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!clicked.ok)
      throw new AichatctlError("NotebookLM 'Create notebook' not found (calibration).");
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const r = (await this.#evalHome(`return JSON.stringify({url:location.href});`)) as {
        url: string;
      };
      const m = NOTEBOOK_ID.exec(r.url);
      if (m) {
        const id = m[1];
        if (id) return { id, url: `https://${NB_HOST}/notebook/${id}` };
      }
    }
    throw new AichatctlError("NotebookLM notebook did not open after Create (timed out).");
  }

  /** Ensures the source panel is visible (expands it if collapsed). */
  async #ensureSourcePanelOpen(nb: Notebook): Promise<void> {
    await this.#evalNotebook(
      nb,
      `
      var add=document.querySelector('button.add-source-button')||Array.from(document.querySelectorAll('button')).find(function(b){return /add source/i.test(b.innerText||"");});
      if(!add){var toggle=document.querySelector('button.toggle-source-panel-button')||Array.from(document.querySelectorAll('button')).find(function(b){return /collapse_content|dock_to_right/i.test(b.innerText||"");});if(toggle)toggle.click();}
      return JSON.stringify({ok:true});`,
    );
    await sleep(600);
  }

  /** Opens the Add-source picker if it isn't already showing. */
  async #openSourcePicker(nb: Notebook): Promise<void> {
    await this.#ensureSourcePanelOpen(nb);
    await this.#evalNotebook(
      nb,
      `
      var hasPicker=Array.from(document.querySelectorAll('button,[role="button"]')).some(function(e){return /copied text/i.test(e.innerText||"");});
      if(!hasPicker){var add=document.querySelector('button[aria-label^="Add source"]')||document.querySelector('button.add-source-button')||Array.from(document.querySelectorAll('button')).find(function(b){return /add source/i.test(b.innerText||"");});if(add)add.click();}
      return JSON.stringify({ok:true});`,
    );
    await sleep(900);
  }

  /**
   * Builds page JS that fills a dialog textarea matching `placeholderReLiteral`
   * via the native setter + input event.
   * @param placeholderReLiteral - a JS regex *literal* string, e.g. "/paste text/i".
   *   Emitted verbatim into page JS — never pass user-controlled data here.
   */
  static #fillTextareaJs(placeholderReLiteral: string, value: string): string {
    // Search the whole document (not the first [role="dialog"], which may be a
    // stray overlay) and match the textarea strictly by placeholder — no
    // first-textarea fallback, which would grab an unrelated field (e.g. the
    // source picker's "Search the web for new sources" box).
    return `
      var ta=Array.from(document.querySelectorAll('textarea')).find(function(t){return ${placeholderReLiteral}.test((t.getAttribute("placeholder")||t.getAttribute("aria-label")||""));});
      if(!ta)return JSON.stringify({ok:false,why:"no textarea"});
      ta.focus();
      var d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value");d.set.call(ta,${JSON.stringify(value)});
      ta.dispatchEvent(new Event("input",{bubbles:true}));ta.dispatchEvent(new Event("change",{bubbles:true}));
      return JSON.stringify({ok:true});`;
  }

  /** Clicks the dialog "Insert" button, then waits for the dialog to close. */
  async #insertAndSettle(nb: Notebook): Promise<void> {
    const clicked = (await this.#evalNotebook(
      nb,
      `
      var b=Array.from(document.querySelectorAll('button')).find(function(x){return /^insert$/i.test((x.innerText||"").trim());});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`,
    )) as { ok: boolean };
    if (!clicked.ok) throw new AichatctlError("NotebookLM 'Insert' not found (calibration).");
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const r = (await this.#evalNotebook(
        nb,
        `
        var open=Array.from(document.querySelectorAll('button')).some(function(x){return /^insert$/i.test((x.innerText||"").trim());});
        return JSON.stringify({open:open});`,
      )) as { open: boolean };
      // Insert button gone = dialog committed (proxy for "source added").
      if (!r.open) return;
    }
    throw new AichatctlError(
      "NotebookLM source add did not complete (Insert dialog stayed open — possible source limit).",
    );
  }

  /** Adds one "Copied text" source. */
  public async addTextSource(nb: Notebook, content: string): Promise<void> {
    await this.#openSourcePicker(nb);
    const opened = (await this.#evalNotebook(
      nb,
      `
      var el=Array.from(document.querySelectorAll('button,[role="button"]')).find(function(e){return /copied text/i.test(e.innerText||"");});
      if(!el)return JSON.stringify({ok:false});
      el.click();return JSON.stringify({ok:true});`,
    )) as { ok: boolean };
    if (!opened.ok)
      throw new AichatctlError("NotebookLM 'Copied text' option not found (calibration).");
    await sleep(700);
    const filled = (await this.#evalNotebook(
      nb,
      NotebookLmDriver.#fillTextareaJs("/paste text/i", content),
    )) as { ok: boolean; why?: string };
    if (!filled.ok)
      throw new AichatctlError(`NotebookLM text paste failed: ${filled.why ?? "unknown"}`);
    await this.#insertAndSettle(nb);
  }

  /** Adds one "Websites" source (a single URL → one distinct document source). */
  public async addUrlSource(nb: Notebook, url: string): Promise<void> {
    await this.#openSourcePicker(nb);
    const opened = (await this.#evalNotebook(
      nb,
      `
      var el=Array.from(document.querySelectorAll('button,[role="button"]')).find(function(e){return /website/i.test(e.innerText||"");});
      if(!el)return JSON.stringify({ok:false});
      el.click();return JSON.stringify({ok:true});`,
    )) as { ok: boolean };
    if (!opened.ok)
      throw new AichatctlError("NotebookLM 'Websites' option not found (calibration).");
    await sleep(700);
    const filled = (await this.#evalNotebook(
      nb,
      NotebookLmDriver.#fillTextareaJs("/paste any links/i", url),
    )) as { ok: boolean; why?: string };
    if (!filled.ok)
      throw new AichatctlError(`NotebookLM URL paste failed: ${filled.why ?? "unknown"}`);
    await this.#insertAndSettle(nb);
  }

  /** Reads the current notebook title (empty string if untitled). */
  public async getNotebookName(nb: Notebook): Promise<string> {
    const r = (await this.#evalNotebook(nb, scriptGetNotebookName())) as GetNameResult;
    return r.name;
  }

  /** Renames a notebook by setting the title input element. */
  public async renameNotebook(nb: Notebook, name: string): Promise<void> {
    const result = (await this.#evalNotebook(nb, scriptRenameNotebook(name))) as RenameResult;
    if (!result.ok) {
      throw new AichatctlError(
        `NotebookLM rename failed: ${result.why ?? "unknown"} (calibration).`,
      );
    }
    await sleep(1000);
  }

  /** Lists the display names of all sources currently in the notebook. */
  public async listSources(nb: Notebook): Promise<string[]> {
    await this.#ensureSourcePanelOpen(nb);
    const r = (await this.#evalNotebook(nb, scriptListSources())) as ListSourcesResult;
    return r.sources;
  }

  /** Removes a source by clicking its three-dot menu → "Remove source" → "Delete". */
  public async removeSource(nb: Notebook, sourceName: string): Promise<void> {
    await this.#ensureSourcePanelOpen(nb);
    const menu = (await this.#evalNotebook(
      nb,
      scriptClickSourceMenu(sourceName),
    )) as SourceMenuResult;
    if (!menu.ok) {
      throw new AichatctlError(
        `NotebookLM remove source failed: ${menu.why ?? "unknown"} (calibration).`,
      );
    }
    await sleep(500);
    const click = (await this.#evalNotebook(
      nb,
      scriptClickMenuItem("Remove source"),
    )) as SourceMenuResult;
    if (!click.ok) {
      throw new AichatctlError(`NotebookLM "Remove source" menu item not found (calibration).`);
    }
    await sleep(800);
    const confirm = (await this.#evalNotebook(nb, scriptConfirmDelete())) as SourceMenuResult;
    if (!confirm.ok) {
      throw new AichatctlError(
        `NotebookLM delete confirmation failed: ${confirm.why ?? "unknown"} (calibration).`,
      );
    }
    await sleep(1000);
  }

  /**
   * Adds a text source and waits for NotebookLM to assign it a generated title.
   * Returns the auto-generated title (the stable handle for `removeSource`).
   */
  public async addTextSourceAndAwaitTitle(
    nb: Notebook,
    content: string,
    timeoutMs = 15_000,
  ): Promise<string> {
    await this.addTextSource(nb, content);
    return this.#awaitSourceTitle(nb, timeoutMs);
  }

  /**
   * Adds a URL source and waits for NotebookLM to assign it a generated title.
   * Returns the auto-generated title (the stable handle for `removeSource`).
   */
  public async addUrlSourceAndAwaitTitle(
    nb: Notebook,
    url: string,
    timeoutMs = 15_000,
  ): Promise<string> {
    await this.addUrlSource(nb, url);
    return this.#awaitSourceTitle(nb, timeoutMs);
  }

  async #awaitSourceTitle(nb: Notebook, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(1500);
      const r = (await this.#evalNotebook(nb, scriptGetLatestSource())) as LatestSourceResult;
      if (r.settled) return r.latestTitle;
    }
    throw new AichatctlError(
      "Source was added but NotebookLM did not generate a title within the timeout. " +
        "Use 'notebook sources list' to check the current state.",
    );
  }

  /**
   * Opens "Customize Audio Overview", sets format/length/prompt, and clicks Generate.
   * Returns immediately after clicking Generate; the audio renders asynchronously
   * (minutes) — callers do not await completion.
   */
  public async generateAudioOverview(nb: Notebook, opts: AudioOverviewOptions): Promise<void> {
    const open = (await this.#evalNotebook(
      nb,
      `
      var b=document.querySelector('button[aria-label="Customize Audio Overview"]')||Array.from(document.querySelectorAll('button')).find(function(x){return /customize audio overview/i.test(x.getAttribute("aria-label")||"");});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`,
    )) as { ok: boolean };
    if (!open.ok)
      throw new AichatctlError("NotebookLM 'Customize Audio Overview' not found (calibration).");
    await sleep(1200);

    // Format cards are <mat-radio-button> tiles (text = label + subtitle), so match
    // by prefix and click the inner radio input.
    const formatLabel = AUDIO_FORMAT_LABEL[opts.format];
    const fmt = (await this.#evalNotebook(
      nb,
      `
      var el=Array.from(document.querySelectorAll('mat-radio-button')).find(function(e){return (e.innerText||"").trim().indexOf(${JSON.stringify(formatLabel)})===0;});
      if(!el)return JSON.stringify({ok:false});
      (el.querySelector('input[type="radio"]')||el).click();return JSON.stringify({ok:true});`,
    )) as { ok: boolean };
    if (!fmt.ok)
      throw new AichatctlError(`NotebookLM format "${formatLabel}" not found (calibration).`);
    await sleep(500);

    // Length is a <mat-button-toggle> group that only appears for some formats
    // (e.g. Deep Dive); Brief/Critique/Debate omit it. Apply best-effort — skip
    // silently when the control isn't present rather than failing.
    const lengthLabel = AUDIO_LENGTH_LABEL[opts.length];
    const len = (await this.#evalNotebook(
      nb,
      `
      var el=Array.from(document.querySelectorAll('mat-button-toggle button,button[role="radio"]')).find(function(e){return (e.innerText||"").trim()===${JSON.stringify(lengthLabel)};});
      if(!el)return JSON.stringify({present:false});
      el.click();return JSON.stringify({present:true});`,
    )) as { present: boolean };
    if (len.present) await sleep(300);

    if (opts.prompt !== undefined && opts.prompt.length > 0) {
      await this.#evalNotebook(
        nb,
        NotebookLmDriver.#fillTextareaJs("/focus|things to try/i", opts.prompt),
      );
      await sleep(300);
    }

    const gen = (await this.#evalNotebook(
      nb,
      `
      var b=Array.from(document.querySelectorAll('button')).find(function(x){return /^generate$/i.test((x.innerText||"").trim());});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`,
    )) as { ok: boolean };
    if (!gen.ok) throw new AichatctlError("NotebookLM 'Generate' not found (calibration).");
  }
}
