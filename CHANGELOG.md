# Changelog

## 0.1.0 — 2026-09-19

### i18n / product naming
- 「我的牛马」localized: ja `マイ社畜たち`, ko `일꾼들`, en/other `My Workhorses` (cattle.family)
- High-visibility nav/chat/me/panel/dashboard strings filled for ja/ko/ru/es/fr/pt/eo
- Default updateFeedUrl → GitHub Releases API

### Docs
- Document memory system as a product feature (JSONL + FTS + vector + recall/retrieve).
- README English primary; Chinese lives in 说明.md; single author signature line.
- README top links to 说明.md（简体中文完整说明请点这里）.
- Signature model corrected to `mimo-X-pro-Preview`.
- Add CONTRIBUTING, mesh dual-machine checklist, multi-language release notes, node-runtime fetch script.
- Add README screenshots under `docs/screenshots/`.
- Add `references/ARCHITECTURE.md` short architecture map.
- Add `packages/app-shell/scripts/verify-docs.mjs` docs compliance checker.
- Installer asset published as `WArmy-Setup-0.1.0.exe` on GitHub Releases; `checksums.txt` lists both local and release names.

### Memory system (product feature completed this line)
- Env rename: `WARMY_MEMORY_DIR` (legacy `CCA_ARMY_MEMORY_DIR` accepted).
- MemoryClient: `recallScoped` / `retrieve(opts)` / `rebuildProjection` / `vectorStatus` / `stats`.
- IPC: `warmy:memory-status` / `warmy:memory-rebuild` / `warmy:memory-retrieve`; scoped recall.
- Settings → About: memory status + rebuild button (10-locale i18n keys `memory.*`).
- Live verify: `verify-memory.mjs` **20/0** (append/recall/retrieve/scope/writer/rebuild/fail-closed).

### Added (product 0.1.0)
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

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
