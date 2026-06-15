import { evalInChromeTab } from "../../applescript/runner.js";
import { AichatctlError } from "../../errors.js";
import { AUDIO_FORMAT_LABEL, AUDIO_LENGTH_LABEL } from "./types.js";
import type { AudioOverviewOptions } from "./types.js";

const NB_HOST = "notebooklm.google.com";
const NB_HOME = "https://notebooklm.google.com/";
const NOTEBOOK_ID = /\/notebook\/([0-9a-f-]+)/i;

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
  /** Runs `jsBody` (which must `return` a JSON string) in the matched tab. */
  async #eval(matchUrl: string, createUrl: string, jsBody: string): Promise<unknown> {
    const js = `(function(){try{${jsBody}}catch(e){return JSON.stringify({__error:String((e&&e.message)||e)});}})()`;
    const out = await evalInChromeTab(js, { matchUrl, createUrl });
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
    if (!clicked.ok) throw new AichatctlError("NotebookLM 'Create notebook' not found (calibration).");
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const r = (await this.#evalHome(`return JSON.stringify({url:location.href});`)) as { url: string };
      const m = NOTEBOOK_ID.exec(r.url);
      if (m) {
        const id = m[1];
        if (id) return { id, url: `https://${NB_HOST}/notebook/${id}` };
      }
    }
    throw new AichatctlError("NotebookLM notebook did not open after Create (timed out).");
  }

  /** Opens the Add-source picker if it isn't already showing. */
  async #openSourcePicker(nb: Notebook): Promise<void> {
    await this.#evalNotebook(nb, `
      var hasPicker=Array.from(document.querySelectorAll('button,[role="button"]')).some(function(e){return /copied text/i.test(e.innerText||"");});
      if(!hasPicker){var add=document.querySelector('button[aria-label^="Add source"]')||Array.from(document.querySelectorAll('button')).find(function(b){return /add source/i.test(b.innerText||"");});if(add)add.click();}
      return JSON.stringify({ok:true});`);
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
    const clicked = (await this.#evalNotebook(nb, `
      var b=Array.from(document.querySelectorAll('button')).find(function(x){return /^insert$/i.test((x.innerText||"").trim());});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!clicked.ok) throw new AichatctlError("NotebookLM 'Insert' not found (calibration).");
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const r = (await this.#evalNotebook(nb, `
        var open=Array.from(document.querySelectorAll('button')).some(function(x){return /^insert$/i.test((x.innerText||"").trim());});
        return JSON.stringify({open:open});`)) as { open: boolean };
      // Insert button gone = dialog committed (proxy for "source added").
      if (!r.open) return;
    }
    throw new AichatctlError("NotebookLM source add did not complete (Insert dialog stayed open — possible source limit).");
  }

  /** Adds one "Copied text" source. */
  public async addTextSource(nb: Notebook, content: string): Promise<void> {
    await this.#openSourcePicker(nb);
    const opened = (await this.#evalNotebook(nb, `
      var el=Array.from(document.querySelectorAll('button,[role="button"]')).find(function(e){return /copied text/i.test(e.innerText||"");});
      if(!el)return JSON.stringify({ok:false});
      el.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!opened.ok) throw new AichatctlError("NotebookLM 'Copied text' option not found (calibration).");
    await sleep(700);
    const filled = (await this.#evalNotebook(
      nb,
      NotebookLmDriver.#fillTextareaJs("/paste text/i", content),
    )) as { ok: boolean; why?: string };
    if (!filled.ok) throw new AichatctlError(`NotebookLM text paste failed: ${filled.why ?? "unknown"}`);
    await this.#insertAndSettle(nb);
  }

  /** Adds one "Websites" source (a single URL → one distinct document source). */
  public async addUrlSource(nb: Notebook, url: string): Promise<void> {
    await this.#openSourcePicker(nb);
    const opened = (await this.#evalNotebook(nb, `
      var el=Array.from(document.querySelectorAll('button,[role="button"]')).find(function(e){return /website/i.test(e.innerText||"");});
      if(!el)return JSON.stringify({ok:false});
      el.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!opened.ok) throw new AichatctlError("NotebookLM 'Websites' option not found (calibration).");
    await sleep(700);
    const filled = (await this.#evalNotebook(
      nb,
      NotebookLmDriver.#fillTextareaJs("/paste any links/i", url),
    )) as { ok: boolean; why?: string };
    if (!filled.ok) throw new AichatctlError(`NotebookLM URL paste failed: ${filled.why ?? "unknown"}`);
    await this.#insertAndSettle(nb);
  }

  /**
   * Opens "Customize Audio Overview", sets format/length/prompt, and clicks Generate.
   * Returns immediately after clicking Generate; the audio renders asynchronously
   * (minutes) — callers do not await completion.
   */
  public async generateAudioOverview(nb: Notebook, opts: AudioOverviewOptions): Promise<void> {
    const open = (await this.#evalNotebook(nb, `
      var b=document.querySelector('button[aria-label="Customize Audio Overview"]')||Array.from(document.querySelectorAll('button')).find(function(x){return /customize audio overview/i.test(x.getAttribute("aria-label")||"");});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!open.ok) throw new AichatctlError("NotebookLM 'Customize Audio Overview' not found (calibration).");
    await sleep(1200);

    // Format cards are <mat-radio-button> tiles (text = label + subtitle), so match
    // by prefix and click the inner radio input.
    const formatLabel = AUDIO_FORMAT_LABEL[opts.format];
    const fmt = (await this.#evalNotebook(nb, `
      var el=Array.from(document.querySelectorAll('mat-radio-button')).find(function(e){return (e.innerText||"").trim().indexOf(${JSON.stringify(formatLabel)})===0;});
      if(!el)return JSON.stringify({ok:false});
      (el.querySelector('input[type="radio"]')||el).click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!fmt.ok) throw new AichatctlError(`NotebookLM format "${formatLabel}" not found (calibration).`);
    await sleep(500);

    // Length is a <mat-button-toggle> group that only appears for some formats
    // (e.g. Deep Dive); Brief/Critique/Debate omit it. Apply best-effort — skip
    // silently when the control isn't present rather than failing.
    const lengthLabel = AUDIO_LENGTH_LABEL[opts.length];
    const len = (await this.#evalNotebook(nb, `
      var el=Array.from(document.querySelectorAll('mat-button-toggle button,button[role="radio"]')).find(function(e){return (e.innerText||"").trim()===${JSON.stringify(lengthLabel)};});
      if(!el)return JSON.stringify({present:false});
      el.click();return JSON.stringify({present:true});`)) as { present: boolean };
    if (len.present) await sleep(300);

    if (opts.prompt !== undefined && opts.prompt.length > 0) {
      await this.#evalNotebook(nb, NotebookLmDriver.#fillTextareaJs("/focus|things to try/i", opts.prompt));
      await sleep(300);
    }

    const gen = (await this.#evalNotebook(nb, `
      var b=Array.from(document.querySelectorAll('button')).find(function(x){return /^generate$/i.test((x.innerText||"").trim());});
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`)) as { ok: boolean };
    if (!gen.ok) throw new AichatctlError("NotebookLM 'Generate' not found (calibration).");
  }
}
