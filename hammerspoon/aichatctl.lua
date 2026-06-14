-- aichatctl — Hammerspoon helper
--
-- The aichatctl "applescript" transport drives your real, logged-in Chrome with
-- NO extension — it runs JS in the tab via osascript. That's the right path for
-- locked-down/managed Macs where you can install apps (like Hammerspoon) but not
-- Chrome extensions.
--
-- The core needs no Hammerspoon at all — `aichatctl ... --transport applescript`
-- works on its own. This file is just a convenience host: it binds hotkeys to the
-- CLI so you can seed a session or sync from anywhere. Drop it next to your
-- ~/.hammerspoon/init.lua and `require("aichatctl")`, or paste the bindings in.
--
-- Prerequisites:
--   * `aichatctl` on your PATH (adjust AICHATCTL below if not).
--   * Chrome: View → Developer → Allow JavaScript from Apple Events.
--   * Grant Hammerspoon (or your terminal) Automation access to Google Chrome
--     when first prompted.

local AICHATCTL = "aichatctl"            -- or an absolute path, e.g. "/opt/homebrew/bin/aichatctl"
local DEFAULT_PLATFORM = "claude"        -- claude | chatgpt
local DEFAULT_PROJECT = "My Project"     -- a project name, URL, or id

local function run(cmd)
  -- `true` runs through a login shell so PATH is set.
  local out, ok = hs.execute(cmd, true)
  return ok, (out or "")
end

-- ⌘⌥⌃S — seed a session from the current clipboard contents, then show its URL.
hs.hotkey.bind({ "cmd", "alt", "ctrl" }, "S", function()
  local prompt = hs.pasteboard.getContents() or ""
  if prompt == "" then
    hs.alert.show("aichatctl: clipboard is empty")
    return
  end
  local tmp = os.tmpname()
  local f = io.open(tmp, "w")
  f:write(prompt)
  f:close()
  local ok, out = run(
    AICHATCTL
      .. " session create --transport applescript"
      .. " --platform " .. DEFAULT_PLATFORM
      .. " --project " .. ("%q"):format(DEFAULT_PROJECT)
      .. " --seed-file " .. ("%q"):format(tmp)
      .. " --json"
  )
  os.remove(tmp)
  hs.alert.show(ok and "aichatctl: session started" or ("aichatctl failed:\n" .. out))
end)

-- ⌘⌥⌃Y — sync the repo's manifest (run from a dir containing aichatctl.config.yaml).
hs.hotkey.bind({ "cmd", "alt", "ctrl" }, "Y", function()
  local ok, out = run(AICHATCTL .. " sync --transport applescript --json")
  hs.alert.show(ok and "aichatctl: synced" or ("aichatctl sync failed:\n" .. out))
end)

return { run = run }
