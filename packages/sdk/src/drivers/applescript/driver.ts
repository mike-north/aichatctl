import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

import { evalInChromeTab } from "../../applescript/runner.js";
import { AichatctlError, ProjectNotFoundError, UnsupportedOperationError } from "../../errors.js";
import type { Platform, Project, RemoteFile, SeedResult } from "../../types.js";
import type { CreateSessionOptions, Driver } from "../driver.js";
import { parseConversationRef, scriptLastAssistantMessage } from "./conversation.js";

const MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".js": "text/javascript",
  ".ts": "text/plain",
  ".py": "text/x-python",
  ".html": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? "text/plain";
}

const CLAUDE_ID = /\/project\/([^/?#]+)/;
const CHATGPT_ID = /\/g\/(g-p-[^/?#]+)/;
const GEMINI_GEM_ID = /\/gem\/([^/?#]+)/;
/** Sentinel project id for a plain (non-Gem) Gemini chat at `/app`. */
const GEMINI_PLAIN = "app";

/**
 * Builds the landing URL for a project id. For Gemini, the "project" is either a
 * Gem (`/gem/{id}`) or the plain new-chat surface (`/app`, id {@link GEMINI_PLAIN}).
 */
function projectUrl(platform: Platform, id: string): string {
  switch (platform) {
    case "claude":
      return `https://claude.ai/project/${id}`;
    case "chatgpt":
      return `https://chatgpt.com/g/${id}/project`;
    case "gemini":
      return id === GEMINI_PLAIN
        ? "https://gemini.google.com/app"
        : `https://gemini.google.com/gem/${id}`;
  }
}

function baseUrl(platform: Platform): string {
  switch (platform) {
    case "claude":
      return "https://claude.ai";
    case "chatgpt":
      return "https://chatgpt.com";
    case "gemini":
      return "https://gemini.google.com";
  }
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
    const app = ((): { match: string; url: string } => {
      switch (this.platform) {
        case "claude":
          return { match: "claude.ai/new", url: "https://claude.ai/new" };
        case "chatgpt":
          return { match: "chatgpt.com", url: baseUrl("chatgpt") };
        case "gemini":
          return { match: "gemini.google.com/app", url: "https://gemini.google.com/app" };
      }
    })();
    return this.#eval(app.match, app.url, jsBody);
  }

  #evalProject(project: Project, jsBody: string): Promise<unknown> {
    return this.#eval(project.id, project.url, jsBody);
  }

  /**
   * Runs `opBody` against Claude's project-docs API, with `sx` (sync XHR) and
   * `base` (the docs collection URL) in scope. Claude stores project docs as
   * text, so upload/read/delete are simple cookie-authenticated JSON calls.
   */
  #claudeDocs(project: Project, opBody: string): Promise<unknown> {
    return this.#evalProject(
      project,
      `function sx(m,u,b,ct){var x=new XMLHttpRequest();x.open(m,u,false);if(ct)x.setRequestHeader('Content-Type',ct);x.send(b||null);return {status:x.status,text:x.responseText};}
       var org=JSON.parse(sx('GET','/api/organizations').text)[0].uuid;
       var base='/api/organizations/'+org+'/projects/'+${JSON.stringify(project.id)}+'/docs';
       ${opBody}`,
    );
  }

  public async isLoggedIn(): Promise<boolean> {
    const probe = ((): string => {
      switch (this.platform) {
        case "claude":
          return `return JSON.stringify({v: !!document.querySelector('div[contenteditable="true"]') && !/\\/login/.test(location.pathname)});`;
        case "chatgpt":
          return `return JSON.stringify({v: !!document.querySelector('[data-testid="accounts-profile-button"]')});`;
        case "gemini":
          // Logged-out Gemini redirects to a Google sign-in page (no composer).
          return `return JSON.stringify({v: !!document.querySelector('.ql-editor[contenteditable="true"]') && /gemini\\.google\\.com/.test(location.host)});`;
      }
    })();
    const r = (await this.#evalBase(probe)) as { v: boolean };
    return r.v;
  }

  public async listProjects(): Promise<Project[]> {
    if (this.platform === "gemini") {
      // Gemini has no project library to enumerate (seed-sessions only).
      return [];
    }
    if (this.platform === "claude") {
      const r = (await this.#eval(
        "claude.ai/projects",
        "https://claude.ai/projects",
        `
        var seen={};var out=[];
        document.querySelectorAll('a[href^="/project/"]').forEach(function(a){
          var m=(a.getAttribute("href")||"").match(/\\/project\\/([^/?#]+)/);if(!m)return;
          if(seen[m[1]])return;seen[m[1]]=1;
          out.push({id:m[1],name:(a.innerText||"").trim().split("\\n")[0]});});
        return JSON.stringify(out);`,
      )) as { id: string; name: string }[];
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
    if (this.platform === "gemini") {
      return this.#resolveGemini(ref);
    }
    const id = this.platform === "claude" ? CLAUDE_ID.exec(ref)?.[1] : CHATGPT_ID.exec(ref)?.[1];
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

  /**
   * Resolves a Gemini "project" ref. Gemini has no project library, so a ref is
   * either a Gem (a `/gem/{id}` URL or a bare Gem id) or the plain new-chat
   * surface (empty, `new`, `app`, or `chat`).
   */
  #resolveGemini(ref: string): Project {
    const trimmed = ref.trim();
    const gem = GEMINI_GEM_ID.exec(trimmed)?.[1];
    if (gem !== undefined) {
      return { id: gem, name: trimmed, url: projectUrl("gemini", gem) };
    }
    if (trimmed === "" || /^(new|app|chat)$/i.test(trimmed)) {
      return { id: GEMINI_PLAIN, name: "New chat", url: projectUrl("gemini", GEMINI_PLAIN) };
    }
    // Otherwise treat the ref as a bare Gem id.
    return { id: trimmed, name: trimmed, url: projectUrl("gemini", trimmed) };
  }

  /** Tab-matching substring for a Gemini project (specific enough to avoid stray tabs). */
  #geminiMatchUrl(project: Project): string {
    return project.id === GEMINI_PLAIN
      ? "gemini.google.com/app"
      : `gemini.google.com/gem/${project.id}`;
  }

  public async getProjectFiles(project: Project): Promise<RemoteFile[]> {
    if (this.platform === "gemini") {
      throw new UnsupportedOperationError("gemini", "getProjectFiles");
    }
    if (this.platform === "claude") {
      return (await this.#claudeDocs(
        project,
        `var docs=JSON.parse(sx('GET',base).text);return JSON.stringify(docs.map(function(d){return {name:d.file_name};}));`,
      )) as RemoteFile[];
    }
    // ChatGPT sources via the sidebar API (the Sources tab needs a trusted click).
    const files = (await this.#evalProject(
      project,
      `
      function sx(m,u,t){var x=new XMLHttpRequest();x.open(m,u,false);if(t)x.setRequestHeader('Authorization','Bearer '+t);x.send();return x.responseText;}
      var s=JSON.parse(sx('GET','/api/auth/session'));var token=s.accessToken;
      var pid=${JSON.stringify(project.id)};
      var sb=JSON.parse(sx('GET','/backend-api/gizmos/snorlax/sidebar',token));
      var item=(sb.items||[]).find(function(it){return it.gizmo&&it.gizmo.id===pid;});
      var files=(item&&(item.files||(item.gizmo&&item.gizmo.files)))||[];
      return JSON.stringify(files.map(function(f){return {name:f.name};}));`,
    )) as { name: string }[];
    return files;
  }

  public async uploadProjectFile(project: Project, localPath: string): Promise<void> {
    if (this.platform === "gemini") {
      throw new UnsupportedOperationError("gemini", "uploadProjectFile");
    }
    const content = readFileSync(localPath, "utf8");
    const name = basename(localPath);
    if (this.platform === "claude") {
      // Claude project docs are plain text: POST {file_name, content}.
      const r = (await this.#claudeDocs(
        project,
        `var up=sx('POST',base,JSON.stringify({file_name:${JSON.stringify(name)},content:${JSON.stringify(content)}}),'application/json');
         return JSON.stringify({ok:up.status>=200&&up.status<300,status:up.status});`,
      )) as { ok: boolean; status: number };
      if (!r.ok) throw new AichatctlError(`Claude upload failed (HTTP ${String(r.status)}).`);
      return;
    }
    // No native file picker (would need Accessibility). Replicate ChatGPT's own
    // upload sequence via synchronous XHR: register -> blob PUT -> process -> associate.
    const size = Buffer.byteLength(content, "utf8");
    const mime = mimeForExt(extname(localPath));
    const lastModified = Math.round(statSync(localPath).mtimeMs);
    const r = (await this.#evalProject(
      project,
      `
      function sx(m,u,t,b,ct){var x=new XMLHttpRequest();x.open(m,u,false);if(t)x.setRequestHeader('Authorization','Bearer '+t);if(ct)x.setRequestHeader('Content-Type',ct);x.send(b||null);return {status:x.status,text:x.responseText};}
      var s=JSON.parse(sx('GET','/api/auth/session').text);var token=s.accessToken;
      var pid=${JSON.stringify(project.id)},name=${JSON.stringify(name)},mime=${JSON.stringify(mime)},size=${String(size)},lm=${String(lastModified)};
      var content=${JSON.stringify(content)};
      var reg=JSON.parse(sx('POST','/backend-api/files',token,JSON.stringify({file_name:name,file_size:size,use_case:'agent',gizmo_id:pid,timezone_offset_min:new Date().getTimezoneOffset(),reset_rate_limits:false,mime_type:mime,entry_surface:'project_sources',selection_method:'drag_drop',client_resolved_mime_type:mime,mime_resolution_source:'filename_extension',store_in_library:false}),'application/json').text);
      if(!reg.upload_url)return JSON.stringify({ok:false,step:'register'});
      var put=new XMLHttpRequest();put.open('PUT',reg.upload_url,false);put.setRequestHeader('x-ms-blob-type','BlockBlob');put.setRequestHeader('Content-Type',mime);put.send(content);
      if(put.status<200||put.status>=300)return JSON.stringify({ok:false,step:'put',status:put.status});
      sx('POST','/backend-api/files/process_upload_stream',token,JSON.stringify({file_id:reg.file_id,use_case:'agent',gizmo_id:pid,index_for_retrieval:true,file_name:name,entry_surface:'project_sources',metadata:{store_in_library:false,is_temporary_chat:false,is_project_thread:true}}),'application/json');
      var assoc=sx('POST','/backend-api/projects/'+pid+'/files',token,JSON.stringify({files:[{file_id:reg.file_id,name:name,size:size,type:mime,last_modified:lm,location:'fs'}]}),'application/json');
      return JSON.stringify({ok:assoc.status>=200&&assoc.status<300,step:'associate',status:assoc.status});`,
    )) as { ok: boolean; step?: string; status?: number };
    if (!r.ok) {
      throw new AichatctlError(
        `ChatGPT upload failed at ${r.step ?? "?"} (HTTP ${String(r.status ?? "?")}).`,
      );
    }
  }

  public async deleteProjectFile(project: Project, remoteName: string): Promise<void> {
    if (this.platform === "gemini") {
      throw new UnsupportedOperationError("gemini", "deleteProjectFile");
    }
    if (this.platform === "claude") {
      const r = (await this.#claudeDocs(
        project,
        `var docs=JSON.parse(sx('GET',base).text);
         var d=docs.find(function(x){return x.file_name===${JSON.stringify(remoteName)};});
         if(!d)return JSON.stringify({ok:true,absent:true});
         var del=sx('DELETE',base+'/'+d.uuid);
         return JSON.stringify({ok:del.status>=200&&del.status<300,status:del.status});`,
      )) as { ok: boolean; status?: number };
      if (!r.ok)
        throw new AichatctlError(`Claude delete failed (HTTP ${String(r.status ?? "?")}).`);
      return;
    }
    const r = (await this.#evalProject(
      project,
      `
      function sx(m,u,t){var x=new XMLHttpRequest();x.open(m,u,false);if(t)x.setRequestHeader('Authorization','Bearer '+t);x.send();return {status:x.status,text:x.responseText};}
      var s=JSON.parse(sx('GET','/api/auth/session').text);var token=s.accessToken;
      var pid=${JSON.stringify(project.id)};
      var sb=JSON.parse(sx('GET','/backend-api/gizmos/snorlax/sidebar',token).text);
      var item=(sb.items||[]).find(function(it){return it.gizmo&&it.gizmo.id===pid;});
      var files=(item&&(item.files||(item.gizmo&&item.gizmo.files)))||[];
      var f=files.find(function(x){return x.name===${JSON.stringify(remoteName)};});
      if(!f)return JSON.stringify({ok:true,absent:true});
      var del=sx('DELETE','/backend-api/projects/'+pid+'/files/'+f.file_id,token);
      return JSON.stringify({ok:del.status>=200&&del.status<300,status:del.status});`,
    )) as {
      ok: boolean;
      status?: number;
    };
    if (!r.ok) throw new AichatctlError(`ChatGPT delete failed (HTTP ${String(r.status ?? "?")}).`);
  }

  public async getProjectInstructions(project: Project): Promise<string> {
    if (this.platform === "gemini") {
      throw new UnsupportedOperationError("gemini", "getProjectInstructions");
    }
    if (this.platform === "chatgpt") {
      const r = (await this.#evalProject(
        project,
        `
        function sx(m,u,t){var x=new XMLHttpRequest();x.open(m,u,false);if(t)x.setRequestHeader('Authorization','Bearer '+t);x.send();return x.responseText;}
        var s=JSON.parse(sx('GET','/api/auth/session'));var token=s.accessToken;
        var pid=${JSON.stringify(project.id)};
        var g=JSON.parse(sx('GET','/backend-api/gizmos/'+pid,token));
        return JSON.stringify({text:(g.gizmo&&g.gizmo.instructions)||""});`,
      )) as { text: string };
      return r.text;
    }
    return "";
  }

  public async setProjectInstructions(project: Project, text: string): Promise<void> {
    if (this.platform === "gemini") {
      throw new UnsupportedOperationError("gemini", "setProjectInstructions");
    }
    if (this.platform === "chatgpt") {
      // No drivable UI save — use ChatGPT's own endpoint via synchronous XHR.
      const r = (await this.#evalProject(
        project,
        `
        function sx(m,u,t,b){var x=new XMLHttpRequest();x.open(m,u,false);if(t)x.setRequestHeader('Authorization','Bearer '+t);if(b)x.setRequestHeader('Content-Type','application/json');x.send(b||null);return {status:x.status,text:x.responseText};}
        var s=JSON.parse(sx('GET','/api/auth/session').text);var token=s.accessToken;
        var pid=${JSON.stringify(project.id)};
        var giz=(JSON.parse(sx('GET','/backend-api/gizmos/'+pid,token).text).gizmo)||{};
        var name=(giz.display&&giz.display.name)||giz.id||pid;
        var resp=sx('PATCH','/backend-api/projects/'+pid,token,JSON.stringify({name:name,instructions:${JSON.stringify(text)},emoji:null,theme:null}));
        return JSON.stringify({ok:resp.status>=200&&resp.status<300,status:resp.status});`,
      )) as {
        ok: boolean;
        status: number;
      };
      if (!r.ok)
        throw new AichatctlError(`ChatGPT instructions update failed (HTTP ${String(r.status)})`);
      return;
    }
    // Claude: Edit instructions -> fill textarea -> Save, as a 2-step UI flow.
    const opened = (await this.#evalProject(
      project,
      `
      var b=Array.from(document.querySelectorAll("button,[role=button]")).find(function(x){return (x.getAttribute("aria-label")||"")==="Edit instructions";});
      if(b){b.click();return JSON.stringify({ok:true});}return JSON.stringify({ok:false});`,
    )) as { ok: boolean };
    if (!opened.ok)
      throw new AichatctlError("Claude 'Edit instructions' button not found (calibration).");
    await sleep(900);
    const saved = (await this.#evalProject(
      project,
      `
      var t=document.querySelector('[data-testid="custom-instructions-textarea"]');
      if(!t)return JSON.stringify({ok:false,why:"no textarea"});
      t.focus();
      var d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value");d.set.call(t,${JSON.stringify(text)});
      t.dispatchEvent(new Event("input",{bubbles:true}));t.dispatchEvent(new Event("change",{bubbles:true}));
      var b=Array.from(document.querySelectorAll("button")).find(function(x){return /save instructions/i.test(x.innerText||"");});
      if(b){b.click();return JSON.stringify({ok:true});}return JSON.stringify({ok:false,why:"no save button"});`,
    )) as {
      ok: boolean;
      why?: string;
    };
    if (!saved.ok)
      throw new AichatctlError(`Claude instructions save failed: ${saved.why ?? "unknown"}`);
  }

  public async createSeededSession(
    project: Project,
    prompt: string,
    options: CreateSessionOptions,
  ): Promise<SeedResult> {
    if (this.platform === "gemini") {
      return this.#createGeminiSession(project, prompt, options);
    }
    // Activate the project tab so editor focus/typing works, then fill the composer.
    const filled = (await this.#evalProject(
      project,
      `
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
      return JSON.stringify({ok:true,url:location.href});`,
    )) as { ok: boolean; url?: string };
    if (!filled.ok) throw new AichatctlError("composer not found (calibration).");
    if (!options.send) {
      return { url: filled.url ?? project.url, sent: false };
    }
    const startUrl = filled.url ?? project.url;
    await this.#evalProject(
      project,
      `
      var b=Array.from(document.querySelectorAll('button')).find(function(x){return /send/i.test((x.getAttribute("aria-label")||"")) || x.getAttribute("data-testid")==="send-button";});
      if(b)b.click();return JSON.stringify({ok:true});`,
    );
    let url = startUrl;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const r = (await this.#evalProject(
        project,
        `return JSON.stringify({url:location.href});`,
      )) as {
        url: string;
      };
      url = r.url;
      if (url !== startUrl && /\/(chat|c)\//.test(url)) break;
    }
    return { url, sent: true };
  }

  /**
   * Reads the latest assistant message from a Claude/ChatGPT conversation.
   * AppleScript transport only; Gemini is unsupported.
   */
  public async getLastAssistantMessage(ref: string): Promise<{ url: string; text: string }> {
    if (this.platform === "gemini") {
      throw new UnsupportedOperationError("gemini", "getLastAssistantMessage");
    }
    const conv = parseConversationRef(this.platform, ref);
    const r = (await this.#eval(
      conv.matchUrl,
      conv.url,
      scriptLastAssistantMessage(this.platform),
    )) as { ok: boolean; text?: string; url?: string; why?: string };
    if (!r.ok) {
      throw new AichatctlError(`Conversation read failed: ${r.why ?? "unknown"} (calibration).`);
    }
    return { url: r.url ?? conv.url, text: r.text ?? "" };
  }

  /**
   * Seeds a Gemini chat (plain `/app` or a Gem). Gemini's composer is a Quill
   * editor (`.ql-editor`); after inserting text we dispatch an `input` event so
   * Gemini reveals the "Send message" button. On send, Gemini navigates from the
   * composer URL to the new conversation URL, which we capture by polling.
   */
  async #createGeminiSession(
    project: Project,
    prompt: string,
    options: CreateSessionOptions,
  ): Promise<SeedResult> {
    const match = this.#geminiMatchUrl(project);
    const filled = (await this.#eval(
      match,
      project.url,
      `
      var el=document.querySelector('.ql-editor[contenteditable="true"]')||document.querySelector('div[contenteditable="true"]');
      if(!el)return JSON.stringify({ok:false});
      el.focus();
      document.execCommand("selectAll",false,null);
      document.execCommand("insertText",false,${JSON.stringify(prompt)});
      el.dispatchEvent(new Event("input",{bubbles:true}));
      return JSON.stringify({ok:true,url:location.href});`,
    )) as { ok: boolean; url?: string };
    if (!filled.ok) throw new AichatctlError("Gemini composer not found (calibration).");
    const startUrl = filled.url ?? project.url;
    if (!options.send) {
      return { url: startUrl, sent: false };
    }
    const clicked = (await this.#eval(
      match,
      project.url,
      `
      var b=document.querySelector('button[aria-label="Send message"]')||document.querySelector('button[aria-label*="Send" i]');
      if(!b)return JSON.stringify({ok:false});
      b.click();return JSON.stringify({ok:true});`,
    )) as { ok: boolean };
    if (!clicked.ok)
      throw new AichatctlError("Gemini 'Send message' button not found (calibration).");
    const norm = (u: string): string => u.replace(/\/+$/, "");
    let url = startUrl;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const r = (await this.#eval(
        match,
        project.url,
        `return JSON.stringify({url:location.href});`,
      )) as {
        url: string;
      };
      url = r.url;
      // Gemini navigates to the conversation URL (an extra path segment) on send.
      if (norm(url) !== norm(startUrl) && /gemini\.google\.com\/(app|gem)\/.+/.test(url)) break;
    }
    return { url, sent: true };
  }
}
