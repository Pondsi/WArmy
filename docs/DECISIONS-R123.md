# R123 decisions — no-account web search + unified local search

Date: 2026-10-31

> **最终状态更正（2026-10-31 晚）**：本轮后来实现了后台全盘索引与跨会话授权，并发布了 0.2.32/0.2.33。§4 与 §7 里“无持久索引 / 无跨会话授权 / 未发布”的描述是早期草案，最终口径见 **§8**。

## 1. What was tested live

| Provider / endpoint | Test | Result | Notes |
| --- | --- | --- | --- |
| Firecrawl Keyless `POST https://api.firecrawl.dev/v2/search` | no `Authorization` header | HTTP 200 | returned real web results; `data.web[]` |
| Firecrawl Keyless `POST https://api.firecrawl.dev/v2/scrape` | no `Authorization` header | HTTP 200 | returned `data.markdown` |
| Firecrawl credits observed | one search / one scrape | search `creditsUsed=2`, scrape `creditsUsed=1` | exact keyless daily caps are not published; docs say per-IP daily caps on requests + credits, 429 when either is hit |
| Jina Reader `GET https://r.jina.ai/<url>` | no key | HTTP 200 | anonymous 20 RPM; some networks are blocked |
| Jina Search `GET https://s.jina.ai/?q=...` | no key | HTTP 401 `AuthenticationRequiredError` | Jina Search is **not** a no-registration option |
| Firecrawl invalid key → Jina Reader | scrape with invalid key | Firecrawl failed, Jina Reader returned 200 | live fallback verified |
| Full disk scan | temporary file under user home with a fake key | found, masked `*****`, hover revealed, mouseleave re-masked | real Electron UI via CDP |

Commands used:
- `node packages/app-shell/scripts/probe-research-pipeline.mjs "SQLite FTS5 full text search"`
- a forced fallback probe with an invalid Firecrawl key
- the temporary UI harness (removed afterwards)

## 2. Decision: built-in host capability, not a skill

WArmy skills are `SKILL.md` Markdown instruction packages. They do not carry:

- network implementation or provider endpoints;
- API-key storage / optional-key policy;
- quota, 429, retry and fallback handling;
- IPC/IPC-sender validation, audit, read-only enforcement;
- per-session permission checks.

Putting search into a skill would only tell the model to call something that may not exist. The correct placement is:

- **settings → Tools**: provider status and an optional Firecrawl key (encrypted locally);
- **host tools**: `web_search`, `web_extract`, `local_search`;
- optional future skill: a citation/workflow guide only. The backend stays in the host.

## 3. Provider chain

Search:
1. Firecrawl Keyless / optional Firecrawl key.
2. On 401/403 with a configured key, retry once without the key (Keyless) so a stale key cannot block a user.
3. On 429, return a truthful quota error and a hint; never fabricate results.

Extract:
1. Firecrawl Keyless / optional key.
2. Per URL, if Firecrawl fails, Jina Reader.
3. If both fail, return the failed URLs and say so.

Jina Search is deliberately not used because it now returns 401 without a key.

## 4. Unified local search

Order shown to the user:

1. current session;
2. all app UI labels/buttons/tips (10 locale packs + static renderer strings);
3. other sessions (memory service);
4. knowledge base (all layers for the user);
5. local disks (on-demand scan, no persistent index).

The UI uses one popup with section headers. Full-disk hits carry a drive label such as `C:` or `D:`.

Sensitive data:

- patterns: `sk-*`, Anthropic/OpenAI-style keys, AWS keys, GitHub tokens, JWTs, Bearer tokens, private-key blocks, `api_key`/`secret`/`token`/`password`, mnemonic words;
- display default: `*****`;
- hover: main process decrypts a short-lived **AES-256-GCM** copy (5 minutes, memory only, no disk/log);
- mouse leave: UI restores the masked text; an async guard prevents a late reveal after leaving.

Read-only:

- `local-search.ts` exposes no write/delete/rename API;
- `local_search` has no write path;
- full-disk scan only reads text-like files and skips OS internals/caches, `node_modules`, `.git`, temp/cache dirs.

Model permissions:

- current session records;
- current session readable knowledge layers (existing layer rules);
- current session workspace files;
- no other-session reads by default (no cross-session grant exists);
- `include_disk` only for sessions whose ID is in `settings.instances` and has no group record («My Workhorses»);
- every full-disk request shows an approval card;
- group/project/contact sessions are denied outright;
- sensitive snippets stay masked and real paths are hidden from the model.

User search is treated as explicit authorization: no prompt, no approval card. Full-disk scan is still bounded by time and file count; when truncated, the UI says so.

## 5. Files changed

- `packages/app-shell/src/research-tools.ts`
- `packages/app-shell/src/local-search.ts` (new)
- `packages/app-shell/src/electron-main.ts`
- `packages/app-shell/src/work-tools.ts`
- `packages/app-shell/src/preload.cjs`
- `packages/app-shell/src/renderer/app.js`
- `packages/app-shell/src/renderer/app.css`
- `packages/app-shell/src/i18n/*.json` (14 new keys per locale)
- `packages/contracts/src/index.ts` (recall card `sessionId`)
- `packages/memory-os/src/index.ts` (recall card `sessionId`)
- `packages/app-shell/scripts/verify-research-pipeline.mjs`
- `packages/app-shell/scripts/verify-local-search.mjs` (new)
- `packages/app-shell/scripts/probe-research-pipeline.mjs`
- `packages/app-shell/scripts/gen-gate-manifest.mjs`
- `docs/GATE-MANIFEST.json`
- `README.md`, `说明.md`

## 6. Verification

- `pnpm build`: pass.
- `verify-research-pipeline`: 41/41.
- `verify-local-search`: 49/49.
- `verify-gate-manifest`: 23/23.
- `verify-i18n-locales`: 163/163.
- `verify-wiring`: 238/238.
- `verify-ipc-probe`: 46/46.
- `verify-security`: 28/28.
- `verify-secret-at-rest`: all pass.
- `verify-import-integrity`: all pass.
- `verify-docs`: 93/93.
- `verify-strict-language`: 10/10.
- live probe: Firecrawl search/extract and Jina Reader fallback pass.
- live Electron UI: popup opens, UI-label search works, disk hits are drive-labelled, sensitive values mask/reveal/re-mask.

## 7. Known limits / open items

- Firecrawl keyless daily caps are not documented as exact numbers. The program handles 429 truthfully; it does not assume a quota.
- Full-disk scan is bounded to 10 s / 60k files per query and 30 hits; it may not cover every directory. The UI says “not fully scanned” when truncated.
- UI-label index covers locale packs and static renderer strings; dynamic content is covered by session/knowledge sections, not by a DOM-wide crawler.
- Other-session search depends on the memory service; when it is unavailable, those sections are empty rather than fabricated.
- Model cross-session access remains denied because no explicit cross-session grant model exists. If the user wants it, a separate grant UI and security review are needed.
- Jina Search is not integrated; adding it would require a key and would contradict the no-registration requirement.
- No release/publish was performed in this round. Version remains 0.2.31 until acceptance and a new release.

---

## 8. Final state (supersedes §4 and §7)

The earlier sections described the first scan-only iteration. The shipped 0.2.32/0.2.33 behavior is:

- **Background index**: `packages/app-shell/src/disk-index.ts` builds a SQLite FTS5 (trigram) index under `userData` for every root (home + all drives). System/temp files are not skipped; they get lower priority. Names/paths are indexed first, body content later; body text is masked before entering FTS. The loop works 40 ms and sleeps 400 ms. It is a low-duty loop, not OS-idle detection.
- **On-demand fallback**: if the index has no hit, `saoMiaoQuanPan` scans with a 12 s / 120k file / 200 result cap and caches results for 2 minutes. UI pages results 20 at a time and says when exhausted/truncated.
- **Unified user search**: current session → app UI text → other sessions → knowledge base → workspace (the popup covers the first four plus cards; disk is the separate paginated section). Non-app hits show drive labels; sensitive values mask/reveal/re-mask.
- **Cross-session model search**: implemented and source-gated.
  - My Workhorses: approval card for other sessions; separate card for full disk; full authorization skips the card.
  - Project: may read all projects and group chats with approval; My Workhorses and contacts are forbidden with no approval path.
  - Group/contact: direct denial, no approval path.
  - Full disk: My Workhorses only, with approval.
  - Read-only: no write/delete/rename path.
- **429**: search providers and model calls classify rate limiting and offer wait/switch/stop.
- **Wording fix**: 0.2.32 shipped with a stale approval card saying “no persistent index”; 0.2.33 corrects the approval card, progress line, setting label, and gate descriptions. No behavior changed in 0.2.33.
- **Release**: 0.2.33 is published at <https://github.com/Pondsi/WArmy/releases/tag/v0.2.33>; installer SHA-256 `03f0b484fc00db4d678b6b7f9d9f16fda4c4449225af21234df38c5c47e91073`, 228,775,742 bytes.

Remaining known limits are recorded in `docs/HANDOFF-R123.md` §4.

