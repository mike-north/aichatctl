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
// Optional shared secret — leave empty to match a daemon started without --token.
const BRIDGE_TOKEN = "";

let ws = null;
let reconnectTimer = null;

function log(...args) {
  console.log("[aichatctl]", ...args);
}

function connect() {
  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    log("connected to bridge");
    const hello = { type: "hello", role: "extension" };
    if (BRIDGE_TOKEN) hello.token = BRIDGE_TOKEN;
    ws.send(JSON.stringify(hello));
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

async function runCommand(msg) {
  switch (msg.action) {
    case "seedSession":
      return seedSession(msg.params || {});
    default:
      return { ok: false, error: `unknown action: ${msg.action}` };
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
  const { platform, project, prompt, send } = params;
  if (!platform || !project || !prompt) {
    return { ok: false, error: "seedSession requires platform, project, prompt" };
  }
  const url = projectUrl(platform, project);
  // active:true so the page is focused — execCommand-based text entry needs an
  // active document. (Background/unattended seeding will use chrome.debugger.)
  const tab = await chrome.tabs.create({ url, active: true });
  await waitForComplete(tab.id);
  // Give the SPA a moment to hydrate the composer.
  await new Promise((r) => setTimeout(r, 1500));

  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [platform, prompt, !!send],
    func: seedInPage,
  });

  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || "seedInPage returned no result" };
  }
  return { ok: true, data: { url: result.url, sent: !!send } };
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

connect();
