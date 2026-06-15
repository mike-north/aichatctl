# Security Policy

## Supported versions

`aichatctl` is pre-1.0. Security fixes land on the latest `0.x` release only.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/mike-north/aichatctl/security/advisories/new)
rather than a public issue. Include reproduction steps and the affected version.
You'll get an acknowledgement, and a fix or mitigation will be coordinated before
public disclosure.

## What aichatctl does and doesn't touch

- It drives **your own** logged-in browser session. It stores no passwords and
  never persists auth tokens — credentials stay in your Chrome profile.
- It makes no network calls of its own beyond driving the target web UIs in your
  browser; it sends no telemetry and collects no data.
- The one place it calls a provider's internal endpoint (ChatGPT project
  *instructions*) runs in your page context using your existing session; nothing
  is exfiltrated or stored.

## Hardening notes for users

- Treat any `aichatctl.config.yaml` as personal — it can contain your project
  names/URLs/ids. It's gitignored by default; don't commit it.
- The AppleScript transport requires Chrome's "Allow JavaScript from Apple Events"
  toggle. Disable it when you're not using `aichatctl` if you prefer.
