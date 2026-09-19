# Contributing to WArmy

Thanks for your interest in **WArmy / 无限牛马**.

## Language of docs

- English primary entry: `README.md`
- Full Chinese manual: `说明.md`
- Keep security/port/container semantics **consistent** across both.

## Prerequisites

- Windows x64 recommended for desktop packaging
- Node.js >= 24, pnpm
- `pnpm install && pnpm -r build`

Optional bundled Node for packaging/memory child:

```bash
node scripts/fetch-node-runtime.mjs
```

## Verify before PR

```bash
node packages/app-shell/scripts/verify-docs.mjs
node packages/app-shell/scripts/verify-memory.mjs
node packages/app-shell/scripts/verify-router-queue.mjs
node packages/app-shell/scripts/verify-i18n-locales.mjs
node packages/app-shell/scripts/verify-wiring.mjs
node packages/app-shell/scripts/verify-container-probe.mjs
```

CI also runs docs/memory/i18n/router checks + `spikes/verify-all/run-full.mjs`.

## Product rules (do not regress)

1. Bounded context + memory pointers — do not drop history silently.
2. Duty is local-only.
3. Container-dev: no silent host execution.
4. Queues: never drop on pop; requeue on failure.
5. Ports: never silent bind fallback.
6. i18n packs must keep **equal key sets**.
7. Brand: `WArmy` / `Workhorse Army`; zh product name `无限牛马`.

## Commit signature

Project releases use author **Pondsi**. Automated commits from Xiaomi MiMo Desktop include model attribution in the message footer; human PRs need not copy that footer.

## Security

See [.github/SECURITY.md](./.github/SECURITY.md). Do not put tokens/paths with usernames in issues.

---

Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
