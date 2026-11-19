# WArmy · 无限牛马

**WArmy = Workhorse Army.** *An army that's yours.*

### You don't command the workhorses. You command the commanders.

**A workhorse army that is yours alone — local-first, private by default, and it gets more efficient the more you use it, never more flattering.**

![First run: choose your interface language (27 locales) — ink-wash theme, Arabic selected](docs/screenshots/readme-hero.png)

WArmy is a desktop workspace where AI is a **team**, not a chat box. You give each workhorse a role, a persona, and a model; a duty agent assigns the work; a shared board keeps the plan and the artifacts; a local memory service remembers what happened and recalls it **inside the thinking chain** — there is no "context compression" that quietly throws your history away.

You are not the general shouting at oxen. You are the one who commands the commanders (**commander of commanders**). Set the direction, approve the dangerous moves, and let the army organize itself.

[Download for Windows](https://github.com/Pondsi/WArmy/releases) · [Chinese manual](./说明.md) · [Acknowledgments](#acknowledgments) · [License](#documentation-and-license)

[![Release](https://img.shields.io/github/v/release/Pondsi/WArmy)](https://github.com/Pondsi/WArmy/releases)
[![License](https://img.shields.io/badge/license-MIT%20%2B%20attribution-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-informational)](https://github.com/Pondsi/WArmy/releases)
[![Locales](https://img.shields.io/badge/UI%20locales-27-success)](#install)

---

## Why it feels different

- **Local-first, no server account.** Your chats, files, memory, and settings live on your disk. There is no WArmy cloud and no WArmy login. Bring your own models — local, self-hosted, or cloud — and pay your provider directly.
- **Privacy is the default, not a toggle.** No analytics, no ad SDK, no silent upload. Secrets use your OS secure storage. Networking, web search, and IM adapters stay **off until you turn them on**.
- **Memory recalled in the thinking chain.** An append-only log is the source of truth; a local service finds the right evidence and returns the original record by pointer. The team remembers without replaying the whole conversation.
- **It speaks only when it should.** No nagging, no endless one-question-one-answer ping-pong. The desktop companion stays quiet and proactive — it talks when there is something worth saying.
- **It gets sharper, not sycophantic.** Self-summary, self-improvement, and self-evolution aim at **efficient and correct**, not at agreeing with you. If you want it to change itself, a built-in modification manual lets your agents remodel themselves — toward usefulness, not flattery.

## A day with the army

It is 11 p.m. One chat wrote the plan. Another wrote the code. A third has no idea why any of it exists. You paste the same background into every window and hope the next one remembers.

WArmy keeps the team in one workspace. The plan, the board, the files, and the memory survive the window. The duty agent routes the brief; the builder writes; the reviewer checks the claims against the actual files; the board records the decision. Because the workspace is yours, the default path never goes through someone else's server.

![First-run language picker — flower-meadow theme, Simplified Chinese selected](docs/screenshots/readme-chat.png)

## Three ways to use it

| You want | WArmy gives you |
| --- | --- |
| **A private assistant** | One workhorse with your files, your tools, your model. It reads, searches, writes, and runs commands after you approve. |
| **A private expert team** | A product manager, a builder, a reviewer, a writer. The duty agent routes the brief; the board records decisions; memory carries context forward. |
| **A shared project room** | People and agents in one project. Roles, approvals, artifacts, and a paper trail — with optional LAN / DHT / relay networking when you choose. |

One person can use all three. A small studio can start with the assistant and grow into the project room without moving work to a hosted platform.

## What's inside

- **Multi-agent interaction & collaboration.** Workhorses talk to each other, hand work off, and share a blackboard. Agents are peers (**agent equality**) — no single agent silently owns the truth.
- **A desktop companion that lives on your screen.** A customizable mascot (**desktop pet**, appearance customization in development) that interacts with your desktop icons, walks over to them, and reacts. It can use camera, microphone, speaker, and network — each individually switchable.
- **Harness self-evolution.** A/B branch experiments, prompt self-update, prediction self-convergence, rollback points. The harness improves itself against evidence, and you can roll back any merge.
- **Knowledge base, plan board, rollback points.** Decisions and artifacts stay with the project; every claimed file is verified on disk before it counts as done.
- **Diwen system.** A structured machine-layer representation for facts (Chinese portion available today). User-visible content always stays in natural language. Diwen is its own open-source project — see [Acknowledgments](#acknowledgments).
- **Work like a colleague, not a tool.** Naturally use social software alongside your colleagues and your subordinates — except this time the subordinates are agents. Email notifications, prompt sounds, scheduled tasks.
- **Extensible by design.** Compatible with the **dsh plugin system**, installable **skills**, and **MCP** servers. Plugins can offer their own settings, update themselves, and provide deterministic (non-model-discretion) extension points.
- **A workbench for the output.** The built-in **nm viewer** opens Markdown with source/preview, extracts Office and PDF, edits binaries byte-by-byte, browses archives, and doubles as a tabbed browser with split views and autonomous browsing.

![First-run language picker — desert-army theme, English selected](docs/screenshots/readme-mimic.png)

## Scenes worth trying

- **Launch-note factory.** "Draft the launch note from these three files, then have the reviewer check every claim." The builder writes, the reviewer reads the actual files, the board records what passed.
- **Research that remembers.** Search the web, extract pages, read PDFs, archive the result. Next week, recall the sources by pointer instead of re-pasting the whole thread.
- **A quiet night shift.** Schedule a recurring export or a long-running watch. The army keeps an audit trail and stops with a stated reason if something needs you — it does not invent progress.
- **A second opinion that is actually second.** A reviewer with a different persona and a different model gives you a real second opinion, not a rerun of the same answer.
- **Local and private.** Point WArmy at a model server on `127.0.0.1` and the model never leaves your machine.

![First-run language picker — planet theme, Persian selected](docs/screenshots/readme-multiagent.png)

## Control and safety

- **Explicit before dangerous.** Shell commands, out-of-workspace writes, protected directories, and other-session data stop at an approval card. Every tool call is audited.
- **Permissions are per session.** A group-chat workhorse cannot browse a project or a private session just because it can chat. Authorization levels are chosen per session, not globally.
- **Optional isolation.** Workhorses run on the host or in a container; an unavailable container is reported honestly, never silently replaced.
- **Honest about limits.** Unfinished paths say so. Unavailable services fail loudly instead of inventing results.

![First-run language picker — savanna theme, French selected](docs/screenshots/readme-settings.png)

## What you get

- A desktop workspace with a team of agents, a duty dispatcher, a shared plan board, and a local memory service — installed on your machine, owned by you.
- A desktop companion (mimic) that lives on your screen, reacts to touch and voice, and speaks only when it should.
- The built-in nm viewer: Markdown source/preview, Office/PDF extraction, hex editing, archives, and a tabbed browser.
- An audit trail for every tool call, approval cards for dangerous moves, and rollback points for self-evolution.

## What you can do

- Run a private assistant, a private expert team, or a shared project room — one person can use all three.
- Draft → build → review pipelines where the reviewer checks claims against the actual files.
- Research that remembers: archive sources and recall them by pointer next week.
- Scheduled night shifts with honest stop reasons; local-only model setups that never leave your machine.

## The system

Electron main process + renderer workspace + isolated subprocesses for native work (SQLite/FTS5, segmentation, analytics, local speech). The main and renderer load **zero native modules**; Python/torch/whisper.cpp live only in child processes. Plugins (dsh-compatible), skills, and MCP servers extend the harness without giving models discretion over the host.

## How it works

You send a brief → the duty agent routes it → a workhorse plans and calls tools → dangerous calls stop at an approval card → artifacts are verified on disk → the round is appended to the local memory log and recalled inside the next thinking chain. Self-evolution runs A/B branches against evidence and merges only what proves better.

## Small details and technical notes

- **Memory you can inspect.** The append-only jsonl log is the source of truth; `recall` finds anchors and `retrieve` dereferences them to the original record. Nothing is silently compressed away.
- The local memory/service port is **59599** (loopback only); project networking (LAN/DHT/relay) is opt-in.
- 27 UI languages; pinyin-named IPC channels; per-session authorization levels; container isolation reported honestly when unavailable.

## Install

**Download, install, use.** No account, no server setup.

1. Open the [latest release](https://github.com/Pondsi/WArmy/releases) and download `WArmy-Setup-0.4.41.exe` (the current release; newer assets appear on the release page).
2. Run the installer, choose a folder, launch **WArmy / 无限牛马**.
3. First run: choose a language, create an identity, save the 24-word mnemonic. Add a model provider and create your first workhorse.

Your data lives in `WArmyData` inside the install folder and survives upgrades and uninstall. The installer is unsigned (Windows SmartScreen may warn); the release page lists SHA-256 for verification.

**Environment:** Windows 10 / 11 x64. A model endpoint (local server, OpenAI-compatible, or Anthropic). For local models, start your server and enter its base URL — the key field stays empty when the server does not need one. Web search, cloud models, and IM need network; everything else works offline.

**Languages / 语言 — 27 UI languages:** 简体中文 · 繁體中文 · English · 日本語 · 한국어 · Русский · Español · Français · Português · Esperanto · Deutsch · Italiano · Nederlands · Polski · Svenska · Čeština · Magyar · Dansk · Norsk bokmål · Türkçe · Українська · Bahasa Indonesia · Tiếng Việt · ไทย · हिन्दी · العربية · فارسی.

## Status and honesty

Core workflows are verified with local model servers through consecutive offline gate rounds plus first-run, search, index, and lazy-loading checks. macOS, physical 4K, real IM accounts, and cloud providers are still being verified. Account-level multi-device record sync is the next milestone (optional project networking between reachable machines is available now). Most workspace files are plaintext while the app is unlocked; a cloud provider receives whatever you send it. Model output can be wrong — review artifacts before shipping.

WArmy does not claim to be "unhackable" or to hold a security certification. The goal is narrower and testable: **local by default, explicit before dangerous, honest when a boundary is hit.**

## Acknowledgments

WArmy stands on open-source work. The complete transitive dependency tree, with each package's license, is in `pnpm-lock.yaml` and the package manifests. Every item below links to its upstream project.

**Bundled runtime & UI**

- **Electron** — MIT — <https://github.com/electron/electron> — the desktop shell. **Chromium** — BSD-3-Clause — <https://github.com/chromium/chromium> — the rendering engine. **Node.js** — MIT — <https://github.com/nodejs/node> — the runtime; a bundled `node.exe` runs the memory service in its own process.
- **three.js** — MIT — <https://github.com/mrdoob/three.js> — 3D rendering for the mimic. **@pixiv/three-vrm** — MIT — <https://github.com/pixiv/three-vrm> — VRM avatar loading (license text bundled beside the vendor bundle).
- **hash-wasm** — MIT — <https://github.com/Daninet/hash-wasm> — argon2id / hashing in pure WASM.
- **DeepSeek Harness (dsh)** — MIT — <https://github.com/deepseek-ai/deepseek-harness> — WArmy bundles the dsh runtime for the optional dsh execution path and is compatible with its plugin system. Its plugin-first design shaped how we keep the host in control while agents stay extensible. Bundled dsh companions: **@nanmicoder/dsh-agent-teams** — <https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams>; **node-pty** — MIT — <https://github.com/microsoft/node-pty>; **koffi** — MIT — <https://github.com/Koromix/koffi>; **protobufjs** — BSD-3-Clause — <https://github.com/protobufjs/protobuf.js>; **@google/genai** — Apache-2.0 — <https://github.com/googleapis/js-genai>.
- **Diwen** — see its own license — <https://github.com/Pondsi/dsh-diwen> — a separate open-source project: a structured, verifiable machine-layer representation for facts. WArmy integrates Diwen (Chinese portion available today); user-visible content always stays natural language. Also published on npm as `diwen`. Thank you to its author and contributors.
- **SQLite** — Public Domain — <https://www.sqlite.org/> — the local database (FTS5). **better-sqlite3** — MIT — <https://github.com/WiseLibs/better-sqlite3>; **better-sqlite3-multiple-ciphers** — MIT — <https://github.com/m4heshd/better-sqlite3-multiple-ciphers>; **SQLCipher** — BSD-style — <https://github.com/sqlcipher/sqlcipher> — optional memory encryption; **bindings** — MIT — <https://github.com/TooTallNate/node-bindings> and **file-uri-to-path** — MIT — <https://github.com/TooTallNate/file-uri-to-path> — the native loading chain (subprocess only).
- **DuckDB** — MIT — <https://github.com/duckdb/duckdb> with **@duckdb/node-api** — MIT — <https://github.com/duckdb/duckdb-node-neo> — optional local analytics (subprocess only).
- **ONNX Runtime Web** — MIT — <https://github.com/microsoft/onnxruntime> — optional local embeddings via WASM SIMD/WebGPU.
- **sherpa-onnx / sherpa-onnx-node** — Apache-2.0 — <https://github.com/k2-fsa/sherpa-onnx> — optional local speech (subprocess only).
- **qrcode-generator** — MIT — © Kazuhiko Arase — <https://github.com/kazuhikoarase/qrcode-generator>; **jsQR** — Apache-2.0 — <https://github.com/cozmo/jsQR>.

**Build & installer**

- **TypeScript** — Apache-2.0 — <https://github.com/microsoft/TypeScript>; **pnpm** — MIT — <https://github.com/pnpm/pnpm>; **electron-builder** — MIT — <https://github.com/electron-userland/electron-builder>; **esbuild** — MIT — <https://github.com/evanw/esbuild>; **NSIS** — zlib/libpng-style — <https://nsis.sourceforge.io/> — the Windows installer engine.

**On-demand subprocess tools** (not bundled; downloaded or installed only with your consent, hash-pinned)

- **whisper.cpp** — MIT — <https://github.com/ggml-org/whisper.cpp> — optional local speech-to-text.
- **TripoSR** — MIT — <https://github.com/VAST-AI-Research/TripoSR> — single-image → mesh for 3D mimic sculpting; runs on **PyTorch** — BSD-3-Clause — <https://github.com/pytorch/pytorch> under **Python** — PSF License — <https://www.python.org/>; model weights fetched from **Hugging Face** — <https://huggingface.co/> — per-model licenses apply.
- **Docling** — MIT — <https://github.com/docling-project/docling> — layout-faithful document parsing.
- **Tree-sitter / web-tree-sitter** — MIT — <https://github.com/tree-sitter/tree-sitter> — incremental AST parsing in a WASM subprocess.

**Protocols & optional external services** (not bundled code; their own licenses and terms apply)

- **Model Context Protocol** — <https://modelcontextprotocol.io/> — our bundled mcp-bridge plugin implements the MCP stdio JSON-RPC contract so external MCP servers become ordinary agent tools.
- **Ollama** — MIT — <https://github.com/ollama/ollama>; **ComfyUI** — GPL-3.0 — <https://github.com/comfyanonymous/ComfyUI>; **LibreOffice** — MPL-2.0 — <https://www.libreoffice.org/>; **WPS / Office** — proprietary — <https://www.wps.com/> — optional model servers or creative/office tools.
- Every other dependency retains its own copyright and license. If you redistribute WArmy, keep the upstream notices and license texts.

**无限牛马** is the Chinese name. The pixel ox is the mascot. The work is the point.

## Documentation and license

- [说明.md](./说明.md): full Chinese manual.
- [LICENSE](./LICENSE): MIT with mandatory attribution to **Pondsi** and a link to the original repository <https://github.com/Pondsi/WArmy> — required for the original code, modified versions, and code snippets, for both personal use and distribution.
- [SPONSORS.md](./SPONSORS.md): support the project.
- [Issues](https://github.com/Pondsi/WArmy/issues): bug reports and feature requests.