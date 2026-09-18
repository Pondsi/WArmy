# Changelog

## 0.1.0 — 2026-09-19

Initial public release of **WArmy** (Workhorse Army / 无限牛马).

### Added
- Multi-agent group chat desktop shell (Electron, zero native modules in app logic)
- 10 UI languages: zh-CN, zh-TW, en-US, ja, ko, ru, es, fr, pt, eo
- Project groups with duty orchestration, board commands, tool-call loop
- Container development projects: probe 12 runtimes, start/stop, project state
  (stopped = creator-offline face; host editing refused; history readable)
- Container shell console (in-container only; security contract: local human typed only)
- Environment solidify / rollback with runtime capability table (WSL has no commit)
- Project file ledger + project directory record (project-level, member-visible)
- Windows host-directory ACL lock (optional, reversible)
- Group mesh / identity / membership (local-first protocol constants `WARMY-*`)
- Router queues: persisted, not dropped on pop; UI P2/P3 queue also persisted

### Ports
- Production default **59599**, dev **58588**, test **62666** (user-configurable; bind failure never silent)

### Security / privacy
- Default: no collection/upload of chats and files
- Secrets env vars are scrubbed before container commands
- Wire protocol constants use `WARMY-` prefix

---

Pondsi (+mimo-X-por-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
