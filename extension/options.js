const tokenInput = document.getElementById("token");
const statusEl = document.getElementById("status");

chrome.storage.local.get("bridgeToken").then(({ bridgeToken }) => {
  if (bridgeToken) tokenInput.value = bridgeToken;
});

document.getElementById("save").addEventListener("click", async () => {
  const bridgeToken = tokenInput.value.trim();
  await chrome.storage.local.set({ bridgeToken });
  statusEl.textContent = bridgeToken
    ? "Saved. The extension will reconnect with this token shortly."
    : "Cleared.";
});
