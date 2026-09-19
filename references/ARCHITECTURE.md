# WArmy Architecture (short reference)

> Companion to README / 说明.md. Authoritative decisions live under `docs/ADR/`.

## Layer map

```text
┌──────────────────────────────────────────────────────────┐
│ Renderer (app.js)  UI · i18n · queues · settings views   │
├──────────────────────────────────────────────────────────┤
│ Preload (window.warmy whitelist IPC)                     │
├──────────────────────────────────────────────────────────┤
│ Electron main                                            │
│  · group-router (duty + queues, persisted)               │
│  · orchestrator (status card → executors → board)        │
│  · container-probe / shell gates                         │
│  · identity + mesh + membership                          │
│  · settings / groups / ui-queues JSON stores             │
├──────────────────────────────────────────────────────────┤
│ Child processes / workers (native isolation)             │
│  · memory-os (sqlite FTS / vectors)                      │
│  · optional embedding WASM                               │
└──────────────────────────────────────────────────────────┘
```

## Key invariants (product)

1. Injected context size is **bounded**; history details remain retrievable.
2. Duty is **local-only**; remote AI never becomes duty.
3. Container-dev projects refuse host edits; no silent host fallback.
4. Queue items are processed or requeued — **never silently dropped**.
5. Bind-port failure **never** auto-switches ports.
6. Locale packs must expose equal key sets; runtime list includes all packs.

## Protocol / constants

- Mesh/handshake markers: `WARMY-HELLO/1`, `WARMY-HS1/HS2`, `WARMY-LAN/1`, relay markers.
- Env knobs: `WARMY_*` (e.g. `WARMY_DEFAULT_NET_PORT` 59599).
- Hook marker: `WARMY-REPO-GUARD-HOOK`.

## Verification entry points

| Script | Focus |
| --- | --- |
| `packages/app-shell/scripts/verify-i18n-locales.mjs` | pack key equality + brand |
| `verify-router-queue.mjs` | no drop + persistence |
| `verify-wiring.mjs` | identity/membership/repo-guard wiring |
| `verify-container-probe.mjs` | probe + project state + solidify policy |
| `verify-container-exec.mjs` | shell security contract + ACL |
| `ui-inspect-round.mjs` | CDP locale/brand/key-leak inspect |

---

Pondsi (+mimo-X-por-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
