# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes (best effort) |

## Reporting a vulnerability

1. Prefer **GitHub Security Advisories** → Report a vulnerability (private).
2. If advisories are unavailable, open a **private** maintainer channel via repository contact in Issues **without** exploit details in the public body.
3. Never paste API keys, tokens, or personal absolute paths in public issues.

## Scope examples

- Remote code execution from untrusted chat/mesh content
- Sandbox escape on container-dev projects
- Memory service reading outside authorized scope
- Secret leakage into container snapshots or logs

## Non-issues / expected behavior

- Host visibility of bind-mounted project folders (by design; see 说明.md)
- AI model output quality
- Docker Desktop licensing on the user side

## Hardening notes (current design)

- Electron main/renderer: zero native modules; sqlite isolated in child process
- Container shell: local human typed only; secrets scrubbed; no auto-run
- Memory tools fail closed when service is down
- Port bind failures are loud, never silent switch

---
Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
