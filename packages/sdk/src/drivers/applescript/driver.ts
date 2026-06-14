import { evalInChromeTab } from "../../applescript/runner.js";
import { AichatctlError, ProjectNotFoundError } from "../../errors.js";
import type { Platform, Project, RemoteFile, SeedResult } from "../../types.js";
import type { CreateSessionOptions, Driver, SelftestResult } from "../driver.js";

const CLAUDE_ID = /\/project\/([^/?#]+)/;
const CHATGPT_ID = /\/g\/(g-p-[^/?#]+)/;

function projectUrl(platform: Platform, id: string): string {
  return platform === "claude"
    ? `https://claude.ai/project/${id}`
    : `https://chatgpt.com/g/${id}/project`;
}

function baseUrl(platform: Platform): string {
  return platform === "claude" ? "https://claude.ai" : "https://chatgpt.com";
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A {@link Driver} that drives the user's real, logged-in Chrome with no
 * extension — via AppleScript (`osascript`) executing JS in the tab. The
 * extension-free path for locked-down environments where apps can be installed
 * but Chrome extensions cannot.
 *
 * Requires Chrome's "Allow JavaScript from Apple Events" (View → Developer).
 * Network calls in page JS use synchronous XHR (AppleScript doesn't await
 * promises). Operations needing trusted mouse events or the native file picker
 * (uploads) are handled in a later phase.
 */
export class AppleScriptDriver implements Driver {
  public constructor(public readonly platform: Platform) {}

  /** Runs `jsBody` (which must `return` a JSON string) in the project/base tab. */
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

  #evalBase(jsBody: string): Promise<unknown> {
    // Target a specific app URL so a stray tab (e.g. an oauth page) isn't matched.
    const app =
      this.platform === "claude"
        ? { match: "claude.ai/new", url: "https://claude.ai/new" }
        : { match: "chatgpt.com", url: baseUrl("chatgpt") };
    return this.#eval(app.match, app.url, jsBody);
  }

  #evalProject(project: Project, jsBody: string): Promise<unknown> {
    return this.#eval(project.id, project.url, jsBody);
  }

  public async isLoggedIn(): Promise<boolean> {
    const r = (await this.#evalBase(
      this.platform === "claude"
        ? `return JSON.stringify({v: !!document.querySelector('div[contenteditable="true"]') && !/\\/login/.test(location.pathname)});`
        : `return JSON.stringify({v: !!document.querySelector('[data-testid="accounts-profile-button"]')});`,
    )) as { v: boolean };
    return r.v;
  }

  public async selftest(): Promise<SelftestResult> {
    const loggedIn = await this.isLoggedIn();
    return { platform: this.platform, loggedIn, probes: [{ name: "login", ok: loggedIn }], ok: loggedIn };
  }

  public async listProjects(): Promise<Project[]> {
    if (this.platform === "claude") {
      const r = (await this.#eval("claude.ai/projects", "https://claude.ai/projects", `
        var seen={};var out=[];
        document.querySelectorAll('a[href^="/project/"]').forEach(function(a){
          var m=(a.getAttribute("href")||"").match(/\\/project\\/([^/?#]+)/);if(!m)return;
          if(seen[m[1]])return;seen[m[1]]=1;
          out.push({id:m[1],name:(a.innerText||"").trim().split("\\n")[0]});});
        return JSON.stringify(out);`)) as { id: string; name: string }[];
      return r.map((p) => ({ ...p, url: projectUrl("claude", p.id) }));
    }
    const r = (await this.#evalBase(`
      var pre="Open project options for ";var out=[];
      document.querySelectorAll('button[aria-label^="'+pre+'"]').forEach(function(b){
        out.push((b.getAttribute("aria-label")||"").slice(pre.length).trim());});
      return JSON.stringify(out);`)) as string[];
    // ChatGPT projects expose no URL without opening them; names only for now.
    return r.filter(Boolean).map((name) => ({ id: "", name, url: "" }));
  }

  public async resolveProject(ref: string): Promise<Project> {
    const id =
      this.platform === "claude" ? CLAUDE_ID.exec(ref)?.[1] : CHATGPT_ID.exec(ref)?.[1];
    if (id !== undefined) {
      return { id, name: ref, url: projectUrl(this.platform, id) };
    }
    if (this.platform === "chatgpt" && /^g-p-[0-9a-f]{32}$/i.test(ref)) {
      return { id: ref, name: ref, url: projectUrl("chatgpt", ref) };
    }
    if (this.platform === "claude" && /^[0-9a-f-]{16,}$/i.test(ref)) {
      return { id: ref, name: ref, url: projectUrl("claude", ref) };
    }
    const match = (await this.listProjects()).find(
      (p) => p.name === ref || p.name.toLowerCase() === ref.toLowerCase(),
    );
    if (!match?.url) {
      throw new ProjectNotFoundError(this.platform, ref);
    }
    return match;
  }

  public async getProjectFiles(project: Project): Promise<RemoteFile[]> {
    if (this.platform === "claude") {
      const names = (await this.#evalProject(project, `
        var out=[];
        document.querySelectorAll('[data-testid="file-thumbnail"]').forEach(function(r){
          var n=(r.innerText||"").trim().split("\\n")[0];if(n)out.push(n);});
        return JSON.stringify(out);`)) as string[];
      return names.map((name) => ({ name }));
    }
    // ChatGPT sources require switching the Sources tab (trusted click) — phase 2.
    throw new AichatctlError("getProjectFiles for ChatGPT via the AppleScript transport is not yet supported.");
  }

  public uploadProjectFile(): Promise<void> {
    throw new AichatctlError(
      "uploadProjectFile via the AppleScript transport is not yet supported (native file picker — phase 2).",
    );
  }

  public deleteProjectFile(): Promise<void> {
    throw new AichatctlError(
      "deleteProjectFile via the AppleScript transport is not yet supported (phase 2).",
    );
  }

  public async getProjectInstructions(project: Project): Promise<string> {
    if (this.platform === "chatgpt") {
      const r = (await this.#evalProject(project, `
        function sx(m,u,t){var x=new XMLHttpRequest();x.open(m,u,false);if(t)x.setRequestHeader('Authorization','Bearer '+t);x.send();return x.responseText;}
        var s=JSON.parse(sx('GET','/api/auth/session'));var token=s.accessToken;
        var pid=${JSON.stringify(project.id)};
        var g=JSON.parse(sx('GET','/backend-api/gizmos/'+pid,token));
        return JSON.stringify({text:(g.gizmo&&g.gizmo.instructions)||""});`)) as { text: string };
      return r.text;
    }
    return "";
  }

  public async setProjectInstructions(project: Project, text: string): Promise<void> {
    if (this.platform === "chatgpt") {
      // No drivable UI save — use ChatGPT's own endpoint via synchronous XHR.
      const r = (await this.#evalProject(project, `
        function sx(m,u,t,b){var x=new XMLHttpRequest();x.open(m,u,false);if(t)x.setRequestHeader('Authorization','Bearer '+t);if(b)x.setRequestHeader('Content-Type','application/json');x.send(b||null);return {status:x.status,text:x.responseText};}
        var s=JSON.parse(sx('GET','/api/auth/session').text);var token=s.accessToken;
        var pid=${JSON.stringify(project.id)};
        var giz=(JSON.parse(sx('GET','/backend-api/gizmos/'+pid,token).text).gizmo)||{};
        var name=(giz.display&&giz.display.name)||giz.id||pid;
        var resp=sx('PATCH','/backend-api/projects/'+pid,token,JSON.stringify({name:name,instructions:${JSON.stringify(text)},emoji:null,theme:null}));
        return JSON.stringify({ok:resp.status>=200&&resp.status<300,status:resp.status});`)) as {
        ok: boolean;
        status: number;
      };
      if (!r.ok) throw new AichatctlError(`ChatGPT instructions update failed (HTTP ${String(r.status)})`);
      return;
    }
    // Claude: Edit instructions -> fill textarea -> Save, as a 2-step UI flow.
    const opened = (await this.#evalProject(project, `
      var b=Array.from(document.querySelectorAll("button,[role=button]")).find(function(x){return (x.getAttribute("aria-label")||"")==="Edit instructions";});
      if(b){b.click();return JSON.stringify({ok:true});}return JSON.stringify({ok:false});`)) as { ok: boolean };
    if (!opened.ok) throw new AichatctlError("Claude 'Edit instructions' button not found (calibration).");
    await sleep(900);
    const saved = (await this.#evalProject(project, `
      var t=document.querySelector('[data-testid="custom-instructions-textarea"]');
      if(!t)return JSON.stringify({ok:false,why:"no textarea"});
      t.focus();
      var d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value");d.set.call(t,${JSON.stringify(text)});
      t.dispatchEvent(new Event("input",{bubbles:true}));t.dispatchEvent(new Event("change",{bubbles:true}));
      var b=Array.from(document.querySelectorAll("button")).find(function(x){return /save instructions/i.test(x.innerText||"");});
      if(b){b.click();return JSON.stringify({ok:true});}return JSON.stringify({ok:false,why:"no save button"});`)) as {
      ok: boolean;
      why?: string;
    };
    if (!saved.ok) throw new AichatctlError(`Claude instructions save failed: ${saved.why ?? "unknown"}`);
  }

  public async createSeededSession(
    project: Project,
    prompt: string,
    options: CreateSessionOptions,
  ): Promise<SeedResult> {
    // Activate the project tab so editor focus/typing works, then fill the composer.
    const filled = (await this.#evalProject(project, `
      var sels=${JSON.stringify(
        this.platform === "claude"
          ? ['div[contenteditable="true"]', "textarea"]
          : ["#prompt-textarea", 'div[contenteditable="true"]', "textarea"],
      )};
      var el=null;for(var i=0;i<sels.length;i++){el=document.querySelector(sels[i]);if(el)break;}
      if(!el)return JSON.stringify({ok:false});
      el.focus();
      if(el.tagName==="TEXTAREA"){var d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value");d.set.call(el,${JSON.stringify(prompt)});el.dispatchEvent(new Event("input",{bubbles:true}));}
      else{document.execCommand("selectAll",false,null);document.execCommand("insertText",false,${JSON.stringify(prompt)});}
      return JSON.stringify({ok:true,url:location.href});`)) as { ok: boolean; url?: string };
    if (!filled.ok) throw new AichatctlError("composer not found (calibration).");
    if (!options.send) {
      return { url: filled.url ?? project.url, sent: false };
    }
    const startUrl = filled.url ?? project.url;
    await this.#evalProject(project, `
      var b=Array.from(document.querySelectorAll('button')).find(function(x){return /send/i.test((x.getAttribute("aria-label")||"")) || x.getAttribute("data-testid")==="send-button";});
      if(b)b.click();return JSON.stringify({ok:true});`);
    let url = startUrl;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const r = (await this.#evalProject(project, `return JSON.stringify({url:location.href});`)) as {
        url: string;
      };
      url = r.url;
      if (url !== startUrl && /\/(chat|c)\//.test(url)) break;
    }
    return { url, sent: true };
  }
}
