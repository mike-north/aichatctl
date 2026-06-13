/**
 * aichatctl bridge — MV3 service worker.
 *
 * Connects to the local bridge daemon (started by `aichatctl bridge serve`),
 * receives deterministic commands, and executes them against the user's real,
 * logged-in Claude.ai / ChatGPT tabs. No model in the loop, no screenshots.
 *
 * This is the spike transport: it implements `seedSession` via injected
 * page scripting. File-library sync (which needs trusted file-input handling)
 * will be added later via the chrome.debugger CDP path.
 */

const BRIDGE_PORT = 8917;
const BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
// The shared secret is configured via the options page (chrome.storage.local).

let ws = null;
let reconnectTimer = null;
let suppressTokenReconnect = false;

function log(...args) {
  console.log("[aichatctl]", ...args);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  let token = "";
  try {
    token = (await chrome.storage.local.get("bridgeToken")).bridgeToken || "";
  } catch {
    /* no token configured yet */
  }
  let socket;
  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch (err) {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    log("connected to bridge");
    const hello = { type: "hello", role: "extension" };
    if (token) hello.token = token;
    socket.send(JSON.stringify(hello));
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "command") {
      const reply = await runCommand(msg).catch((err) => ({
        ok: false,
        error: String((err && err.message) || err),
      }));
      ws.send(JSON.stringify({ type: "result", id: msg.id, ...reply }));
    }
  };

  ws.onclose = () => {
    log("bridge connection closed");
    scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

/**
 * Connect only if not already open/connecting. Called both by the fast
 * setTimeout path (while the worker is alive) and by the alarm (which wakes a
 * suspended worker), so the extension self-heals after daemon restarts / sleep.
 */
function ensureConnected() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  connect();
}

async function runCommand(msg) {
  const p = msg.params || {};
  switch (msg.action) {
    case "seedSession":
      return seedSession(p);
    case "selftest":
      return selftest(p);
    case "getProjectFiles":
      return getProjectFiles(p);
    case "uploadProjectFile":
      return uploadProjectFile(p);
    case "deleteProjectFile":
      return deleteProjectFile(p);
    case "getProjectInstructions":
      return getProjectInstructions(p);
    case "setProjectInstructions":
      return setProjectInstructions(p);
    case "setBridgeToken":
      // Bootstrap convenience: store the shared secret without the options page.
      // Suppress the onChanged-triggered reconnect so this command's own reply
      // isn't lost when the socket closes (the new token applies on next connect).
      suppressTokenReconnect = true;
      await chrome.storage.local.set({ bridgeToken: p.token || "" });
      return { ok: true, data: { set: true } };
    case "reloadSelf":
      // Re-read the unpacked extension from disk so code changes deploy without
      // a manual chrome://extensions reload. Result is sent before reloading.
      setTimeout(() => chrome.runtime.reload(), 500);
      return { ok: true, data: { reloading: true } };
    case "evalInProject":
      return evalInProject(p);
    case "inspectProject":
      return inspectProject(p);
    case "listProjects":
      return listProjects(p);
    case "resolveProject":
      return resolveProject(p);
    default:
      return { ok: false, error: `unknown action: ${msg.action}` };
  }
}

// --- project file operations --------------------------------------------------

// ⚠️ LIVE CALIBRATION REQUIRED — these selectors are best-effort.
const PROJECT_SELECTORS = {
  claude: {
    // Library docs render as file-thumbnail cards (name is the first text line).
    fileRow: ['[data-testid="file-thumbnail"]'],
    // The project-library input is distinct from the composer attachment input.
    fileInput: ['input[data-testid="project-doc-upload"]', 'input[type="file"]'],
    deleteButton: ['button[aria-label*="delete" i]', 'button[aria-label*="remove" i]'],
    instructions: ['textarea', 'div[contenteditable="true"][role="textbox"]'],
  },
  chatgpt: {
    fileRow: ['[data-testid="project-file-row"]', '[data-testid*="file"]'],
    fileInput: ['input[type="file"]'],
    deleteButton: ['button[aria-label*="delete" i]', 'button[aria-label*="remove" i]', 'button[aria-label*="trash" i]'],
    instructions: ['textarea', 'div[contenteditable="true"][role="textbox"]'],
  },
};

const projectTabs = new Map();

async function getProjectTab(url) {
  const existing = projectTabs.get(url);
  if (existing !== undefined) {
    try {
      const tab = await chrome.tabs.get(existing);
      if (tab) return existing;
    } catch {
      /* tab gone; recreate */
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  await waitForComplete(tab.id);
  await sleep(1200);
  projectTabs.set(url, tab.id);
  return tab.id;
}

async function runInTab(tabId, func, args) {
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

function selectorsFor(platform) {
  const s = PROJECT_SELECTORS[platform];
  if (!s) throw new Error(`unknown platform ${platform}`);
  return s;
}

async function selftest(params) {
  const { platform } = params;
  const base = platform === "claude" ? "https://claude.ai" : "https://chatgpt.com";
  const tabId = await getProjectTab(base);
  const probes = await runInTab(
    tabId,
    (sels) => {
      const has = (s) => !!document.querySelector(s);
      const account = has('[data-testid="user-menu-button"]') || has('[data-testid="accounts-profile-button"]');
      const login = has('[data-testid="login-button"]');
      return {
        loggedIn: account && !login,
        probes: [{ name: "composer", ok: has(sels.composer) }],
      };
    },
    [{ composer: platform === "claude" ? 'div[contenteditable="true"]' : "#prompt-textarea" }],
  );
  return { ok: true, data: probes };
}

async function getProjectFiles(params) {
  const { platform, projectUrl } = params;
  const sel = selectorsFor(platform);
  const tabId = await getProjectTab(projectUrl);
  const names = await runInTab(
    tabId,
    (rowSels) => {
      for (const s of rowSels) {
        const rows = document.querySelectorAll(s);
        if (rows.length) {
          return Array.from(rows)
            .map((r) => (r.innerText || "").trim().split("\n")[0])
            .filter(Boolean);
        }
      }
      return [];
    },
    [sel.fileRow],
  );
  return { ok: true, data: names.map((name) => ({ name })) };
}

async function uploadProjectFile(params) {
  const { platform, projectUrl, localPath } = params;
  const sel = selectorsFor(platform);
  const tabId = await getProjectTab(projectUrl);
  await attachDebugger(tabId);
  try {
    // Find the (often hidden) file input and get a CDP objectId for it.
    const objectId = await cdpEvalObjectId(
      tabId,
      `(function(){ var s=${JSON.stringify(sel.fileInput)};
        for (var i=0;i<s.length;i++){var el=document.querySelector(s[i]); if(el) return el;} return null; })()`,
    );
    if (!objectId) {
      return { ok: false, error: "file input not found (selectors need calibration)" };
    }
    await cdp(tabId, "DOM.setFileInputFiles", { files: [localPath], objectId });
    await sleep(2000);
    return { ok: true, data: {} };
  } finally {
    await detachDebugger(tabId);
  }
}

async function deleteProjectFile(params) {
  const { platform, projectUrl, name } = params;
  const sel = selectorsFor(platform);
  const tabId = await getProjectTab(projectUrl);
  const res = await runInTab(
    tabId,
    (rowSels, delSels, target) => {
      const findRow = () => {
        for (const s of rowSels) {
          for (const r of document.querySelectorAll(s)) {
            if ((r.innerText || "").includes(target)) return r;
          }
        }
        return null;
      };
      const row = findRow();
      if (!row) return { ok: true, data: {}, note: "already absent" };
      let btn = null;
      for (const s of delSels) {
        btn = row.querySelector(s) || document.querySelector(s);
        if (btn) break;
      }
      if (!btn) return { ok: false, error: "delete control not found (selectors need calibration)" };
      btn.click();
      // Best-effort confirm.
      setTimeout(() => {
        for (const b of document.querySelectorAll("button")) {
          if (/^(delete|remove|confirm)$/i.test((b.innerText || "").trim())) {
            b.click();
            break;
          }
        }
      }, 400);
      return { ok: true, data: {} };
    },
    [sel.fileRow, sel.deleteButton, name],
  );
  await sleep(1000);
  return res;
}

/**
 * Diagnostic: evaluates an arbitrary expression in the project tab via CDP
 * (bypasses page CSP), returning the value. Lets the agent self-verify DOM
 * state without adding a named command for every check.
 */
async function evalInProject(params) {
  const { projectUrl, expression } = params;
  if (!expression) return { ok: false, error: "evalInProject requires an expression" };
  const tabId = await getProjectTab(projectUrl);
  await attachDebugger(tabId);
  try {
    const value = await cdpEval(tabId, expression);
    return { ok: true, data: { value } };
  } finally {
    await detachDebugger(tabId);
  }
}

/**
 * Diagnostic: dumps the real DOM facts needed to calibrate the project-library
 * upload control (distinct from the chat composer's attachment input).
 */
async function inspectProject(params) {
  const { projectUrl } = params;
  const tabId = await getProjectTab(projectUrl);
  const data = await runInTab(tabId, () => {
    const text = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
    const brief = (el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      name: el.getAttribute("name") || undefined,
      type: el.getAttribute("type") || undefined,
      accept: el.getAttribute("accept") || undefined,
      ariaLabel: el.getAttribute("aria-label") || undefined,
      testid: el.getAttribute("data-testid") || undefined,
      className: typeof el.className === "string" ? el.className.slice(0, 120) : undefined,
      hidden: el.offsetParent === null,
      text: text(el).slice(0, 60) || undefined,
    });

    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((el) => {
      const b = brief(el);
      // Describe surrounding context to tell composer-attach vs library-upload apart.
      let ctx = "";
      let p = el.parentElement;
      for (let i = 0; i < 6 && p; i++) {
        const t = (p.getAttribute("data-testid") || p.getAttribute("aria-label") || "").trim();
        if (t) {
          ctx = t;
          break;
        }
        p = p.parentElement;
      }
      return { ...b, context: ctx || undefined };
    });

    const re = /add|upload|content|knowledge|file|document|attach/i;
    const candidateButtons = Array.from(document.querySelectorAll('button,[role="button"],a'))
      .map((el) => ({ el, t: text(el) }))
      .filter(({ el, t }) => re.test(t) || re.test(el.getAttribute("aria-label") || ""))
      .slice(0, 25)
      .map(({ el }) => brief(el));

    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,[role=heading]"))
      .map((el) => text(el))
      .filter(Boolean)
      .slice(0, 25);

    return { fileInputs, candidateButtons, headings, url: location.href };
  });
  return { ok: true, data };
}

const PROJECTS_URL = { claude: "https://claude.ai/projects", chatgpt: "https://chatgpt.com" };

function buildProjectUrl(platform, id) {
  return platform === "claude"
    ? `https://claude.ai/project/${id}`
    : `https://chatgpt.com/g/${id}/project`;
}

async function listProjects(params) {
  const { platform } = params;
  const tabId = await getProjectTab(PROJECTS_URL[platform]);
  // Reload so a reused tab reflects projects created since it was opened.
  await chrome.tabs.reload(tabId);
  await waitForComplete(tabId);
  await sleep(1000);
  const raw = await runInTab(
    tabId,
    (plat) => {
      const sel = plat === "claude" ? 'a[href^="/project/"]' : 'a[href*="/g/g-p-"]';
      const seen = new Set();
      const out = [];
      document.querySelectorAll(sel).forEach((a) => {
        const href = a.getAttribute("href") || "";
        const m =
          plat === "claude" ? href.match(/\/project\/([^/?#]+)/) : href.match(/\/g\/(g-p-[^/?#]+)/);
        const id = m && m[1];
        if (!id || seen.has(id)) return;
        seen.add(id);
        out.push({ id, name: (a.innerText || "").trim().split("\n")[0] });
      });
      return out;
    },
    [platform],
  );
  return { ok: true, data: raw.map((p) => ({ id: p.id, name: p.name, url: buildProjectUrl(platform, p.id) })) };
}

async function resolveProject(params) {
  const { platform, ref } = params;
  const list = (await listProjects(params)).data;
  const match =
    list.find((p) => p.name === ref) ||
    list.find((p) => (p.name || "").toLowerCase() === (ref || "").toLowerCase());
  if (!match) return { ok: false, error: `No project matching "${ref}" on ${platform}` };
  return { ok: true, data: match };
}

async function getProjectInstructions(params) {
  const { platform, projectUrl } = params;
  const sel = selectorsFor(platform);
  const tabId = await getProjectTab(projectUrl);
  const text = await runInTab(
    tabId,
    (instrSels) => {
      for (const s of instrSels) {
        const el = document.querySelector(s);
        if (el) return (el.value !== undefined ? el.value : el.innerText || "").trim();
      }
      return "";
    },
    [sel.instructions],
  );
  return { ok: true, data: { text } };
}

async function setProjectInstructions(params) {
  const { platform, projectUrl, text } = params;
  const tabId = await getProjectTab(projectUrl);
  await attachDebugger(tabId);
  try {
    if (platform === "claude") {
      // The instructions editor is behind an "Edit instructions" button.
      const opened = await cdpEval(
        tabId,
        '(function(){var b=Array.from(document.querySelectorAll("button,[role=button]")).find(function(x){return (x.getAttribute("aria-label")||"")==="Edit instructions";});if(b){b.click();return true;}return false;})()',
      );
      if (!opened) return { ok: false, error: "'Edit instructions' button not found (calibration)" };
      let ready = false;
      for (let i = 0; i < 20; i++) {
        ready = await cdpEval(tabId, '!!document.querySelector("[data-testid=\\"custom-instructions-textarea\\"]")');
        if (ready) break;
        await sleep(150);
      }
      if (!ready) return { ok: false, error: "instructions textarea did not appear" };
      // Focus + select existing content so insertText replaces it.
      await cdpEval(
        tabId,
        '(function(){var t=document.querySelector("[data-testid=\\"custom-instructions-textarea\\"]");t.focus();t.select();return true;})()',
      );
      await cdp(tabId, "Input.insertText", { text });
      await sleep(300);
      const saved = await cdpEval(
        tabId,
        '(function(){var b=Array.from(document.querySelectorAll("button")).find(function(x){return /save instructions/i.test(x.innerText||"");});if(b){b.click();return true;}return false;})()',
      );
      if (!saved) return { ok: false, error: "'Save instructions' button not found (calibration)" };
      await sleep(1000);
      return { ok: true, data: {} };
    }
    // chatgpt: best-effort until calibrated.
    const sel = selectorsFor(platform);
    const focused = await cdpEval(
      tabId,
      `(function(){ var s=${JSON.stringify(sel.instructions)};
        for (var i=0;i<s.length;i++){var el=document.querySelector(s[i]);
          if(el){el.focus(); if(el.select)el.select(); return true;}} return false; })()`,
    );
    if (!focused) return { ok: false, error: "instructions editor not found (selectors need calibration)" };
    await cdp(tabId, "Input.insertText", { text });
    await sleep(800);
    return { ok: true, data: {} };
  } finally {
    await detachDebugger(tabId);
  }
}

const PROJECT_URL = {
  claude: (id) => `https://claude.ai/project/${id}`,
  chatgpt: (id) => `https://chatgpt.com/g/${id}/project`,
};

function looksLikeUrl(s) {
  return /^https?:\/\//i.test(s);
}

/** Resolves the project ref to a URL to open. */
function projectUrl(platform, project) {
  if (looksLikeUrl(project)) return project;
  // Bare id (e.g. "g-p-..." for chatgpt, or a uuid for claude).
  const build = PROJECT_URL[platform];
  if (build) return build(project);
  throw new Error(`cannot resolve project "${project}" for ${platform}`);
}

async function waitForComplete(tabId, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    if (Date.now() - start > timeoutMs) return tab;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function seedSession(params) {
  const { platform, project, prompt, send, background } = params;
  if (!platform || !project || !prompt) {
    return { ok: false, error: "seedSession requires platform, project, prompt" };
  }
  const url = projectUrl(platform, project);
  if (background) {
    return seedViaDebugger({ platform, url, prompt, send: !!send });
  }
  return seedViaScripting({ platform, url, prompt, send: !!send });
}

/** Foreground path: page scripting in an active tab (no debugger infobar). */
async function seedViaScripting({ platform, url, prompt, send }) {
  const tab = await chrome.tabs.create({ url, active: true });
  await waitForComplete(tab.id);
  await new Promise((r) => setTimeout(r, 1500));

  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [platform, prompt, send],
    func: seedInPage,
  });

  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || "seedInPage returned no result" };
  }
  return { ok: true, data: { url: result.url, sent: send } };
}

// --- chrome.debugger (CDP) path: trusted input, works in a background tab ------

function cdp(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(`${method}: ${err.message}`));
      else resolve(res);
    });
  });
}

function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(`attach: ${err.message}`));
      else resolve();
    });
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      void chrome.runtime.lastError; // ignore if already detached
      resolve();
    });
  });
}

/** Evaluates an expression in the page via CDP and returns its value. */
async function cdpEval(tabId, expression) {
  const res = await cdp(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res && res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text || "evaluate failed");
  }
  return res && res.result ? res.result.value : undefined;
}

/** Evaluates an expression and returns a CDP objectId (or null) for the result. */
async function cdpEvalObjectId(tabId, expression) {
  const res = await cdp(tabId, "Runtime.evaluate", { expression, returnByValue: false });
  if (res && res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text || "evaluate failed");
  }
  const objectId = res && res.result ? res.result.objectId : undefined;
  // A null DOM result has subtype "null" and no objectId.
  return objectId || null;
}

/**
 * Background path: attach CDP, focus the composer, type trusted text via
 * Input.insertText (no OS focus required), click send, read the URL, detach.
 */
async function seedViaDebugger({ platform, url, prompt, send }) {
  const tab = await chrome.tabs.create({ url, active: false });
  await waitForComplete(tab.id);
  await new Promise((r) => setTimeout(r, 1500));

  const composerSel =
    platform === "claude"
      ? ['div[contenteditable="true"]', "textarea"]
      : ["#prompt-textarea", 'div[contenteditable="true"]', "textarea"];
  const sendSel =
    platform === "claude"
      ? ['button[aria-label="Send message" i]', '[data-testid="send-button"]', 'button[aria-label*="send" i]']
      : ['[data-testid="send-button"]', 'button[aria-label*="send" i]'];

  await attachDebugger(tab.id);
  try {
    // Focus the composer inside the page (works regardless of tab activation).
    const focused = await cdpEval(
      tab.id,
      `(function(){
        var sels=${JSON.stringify(composerSel)};
        for (var i=0;i<sels.length;i++){var el=document.querySelector(sels[i]);
          if(el){el.focus(); return true;}}
        return false;
      })()`,
    );
    if (!focused) {
      return { ok: false, error: "composer not found (selectors need calibration)" };
    }

    // Trusted text insertion into the focused editable.
    await cdp(tab.id, "Input.insertText", { text: prompt });
    await new Promise((r) => setTimeout(r, 300));

    if (!send) {
      const url0 = await cdpEval(tab.id, "location.href");
      return { ok: true, data: { url: url0, sent: false } };
    }

    const startUrl = await cdpEval(tab.id, "location.href");
    await cdpEval(
      tab.id,
      `(function(){
        var sels=${JSON.stringify(sendSel)};
        for (var i=0;i<sels.length;i++){var b=document.querySelector(sels[i]);
          if(b){b.click(); return true;}}
        return false;
      })()`,
    );

    const deadline = Date.now() + 12000;
    let finalUrl = startUrl;
    while (Date.now() < deadline) {
      finalUrl = await cdpEval(tab.id, "location.href");
      if (finalUrl !== startUrl && /\/(chat|c)\//.test(finalUrl)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return { ok: true, data: { url: finalUrl, sent: true } };
  } finally {
    await detachDebugger(tab.id);
  }
}

/**
 * Runs in the page context. Finds the composer, types the prompt, and (when
 * send) clicks the send button, then reports the resulting conversation URL.
 *
 * Must be fully self-contained — no closure over service-worker scope.
 */
async function seedInPage(platform, prompt, send) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const SELECTORS = {
    claude: {
      composer: ['div[contenteditable="true"]', "textarea"],
      send: ['button[aria-label="Send message" i]', '[data-testid="send-button"]', 'button[aria-label*="send" i]'],
    },
    chatgpt: {
      composer: ["#prompt-textarea", 'div[contenteditable="true"]', "textarea"],
      send: ['[data-testid="send-button"]', 'button[aria-label*="send" i]'],
    },
  };
  const sel = SELECTORS[platform];
  if (!sel) return { ok: false, error: `unknown platform ${platform}` };

  const pick = (list) => {
    for (const s of list) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  const composer = pick(sel.composer);
  if (!composer) return { ok: false, error: "composer not found (selectors need calibration)" };

  composer.focus();
  if (composer.tagName === "TEXTAREA" || composer.tagName === "INPUT") {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(composer, prompt);
    else composer.value = prompt;
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    // contenteditable (ProseMirror/Lexical): execCommand emits the beforeinput/
    // input events these editors listen for.
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, prompt);
  }

  await sleep(300);

  if (!send) {
    return { ok: true, url: location.href };
  }

  const startUrl = location.href;
  const button = pick(sel.send);
  if (button) {
    button.click();
  } else {
    // Fall back to Enter (some composers submit on it).
    composer.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  }

  // Wait for the URL to change to a conversation.
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (location.href !== startUrl && /\/(chat|c)\//.test(location.href)) {
      return { ok: true, url: location.href };
    }
    await sleep(250);
  }
  return { ok: true, url: location.href };
}

// Keepalive: an alarm wakes the (possibly suspended) service worker on a
// schedule so it reconnects without a manual reload. 0.5 min is Chrome's floor.
const KEEPALIVE_ALARM = "aichatctl-keepalive";
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) ensureConnected();
});
chrome.runtime.onStartup.addListener(ensureConnected);
chrome.runtime.onInstalled.addListener(ensureConnected);

// Reconnect with the new secret when it's set/changed in the options page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.bridgeToken) {
    if (suppressTokenReconnect) {
      suppressTokenReconnect = false;
      return;
    }
    try {
      if (ws) ws.close();
    } catch {
      /* ignore */
    }
    connect();
  }
});

ensureConnected();
