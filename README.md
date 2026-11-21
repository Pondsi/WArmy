# WArmy · 无限牛马

**WArmy = Workhorse Army.** *An army that's yours.*

### You don't command the workhorses. You command the commanders.

A local-first desktop workspace where AI is a **team**, not a chat box: give each workhorse a role, a persona and a model; a duty agent routes the work; a shared board keeps the plan and the artifacts; a local memory service recalls evidence **inside the thinking chain**. It gets more efficient the more you use it — never more flattering.

![First run: choose your interface language (27 locales)](docs/screenshots/readme-hero.png)

[Download for Windows](https://github.com/Pondsi/WArmy/releases) · [Chinese manual](./说明.md) · [Acknowledgments](#acknowledgments) · [License](#documentation-and-license)

[![Release](https://img.shields.io/github/v/release/Pondsi/WArmy)](https://github.com/Pondsi/WArmy/releases)
[![License](https://img.shields.io/badge/license-MIT%20%2B%20attribution-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-informational)](https://github.com/Pondsi/WArmy/releases)
[![Locales](https://img.shields.io/badge/UI%20locales-27-success)](#install)

---

## Scenes worth trying

- **Launch-note factory.** "Draft from these three files, then have the reviewer check every claim." The reviewer reads the actual files; the board records what passed.
- **Research that remembers.** Search, extract, archive; next week recall sources by pointer instead of re-pasting the thread.
- **A quiet night shift.** Scheduled exports / long watches with an audit trail and honest stop reasons — it never invents progress.
- **A real second opinion.** A reviewer with a different persona and model, not a rerun of the same answer.
- **A terminal that stays in the app.** The built-in console runs real commands in the session workspace with Tab completion, history, Ctrl+C and ANSI color — no external window, no host escape.

## Why it feels different

- **Your machine, your army.** Chats, files, memory and settings live on your disk. Bring your own models — local, self-hosted or cloud — and pay your provider directly. There is no WArmy cloud.
- **Private by default.** No analytics, no ad SDK, no silent upload. Secrets use OS secure storage; networking, web search and IM adapters stay off until you enable them.
- **Memory that survives the window.** An append-only log is the source of truth; `recall` finds anchors and `retrieve` returns the original record by pointer — no quiet "context compression" that throws history away.
- **Sharp, not sycophantic.** Self-summary and self-evolution aim at *efficient and correct*, verified against evidence, with rollback points for every merge.

## Memory & Diwen — measured, not claimed

What this means for you: the team **remembers across weeks without replaying the whole conversation**, your prompt stays small (cheaper, faster, less "context rot"), and nothing is silently thrown away — any omitted record can be pulled back **byte-exact**. Facts are kept as a verifiable structured layer (**Diwen**) while everything you read stays natural language, so the agent can be checked against real records instead of trusting its own prose.

These are not marketing numbers; they come from a 2,000-round real-conversation stress test (2,040 live model calls, ~10.7M characters / 25.7MB of append-only log, cloud + local models). Full method and raw data: [docs/MEMORY-STRESS-REPORT.md](./docs/MEMORY-STRESS-REPORT.md).

| What you get | Measured result |
| --- | --- |
| **Never blows the context window** | 0 budget overruns across 2,000 rounds, even as the log grew 1,000×. |
| **Fast regardless of history size** | view render ≈ **0.21 ms/round** (peak 2 ms) on a 5.2M-char log — cost scales with the view, not the log. |
| **Small prompts, lower cost** | the injected view is ~**0.74%** of the log (≈1:135 compression); 16.2% prompt-cache hit. |
| **Nothing lost** | `retrieve` returned the exact original record **40/40 (100%)** by pointer. |
| **No invented memories** | when a fact wasn't in context, the model said "not in context" **20/20 — zero fabrication**; every fact that was visible was answered correctly. |

Honest limit: very old mid-history facts are not auto-replayed; they are fetched on demand via `recall`/`retrieve` (100% byte-exact), and the agent tells you when it is doing so rather than guessing.

## Your account, your keys

WArmy has **no cloud account server** — but it does have a real account system that protects *your* local identity. You create a self-custodied identity (a 24-word mnemonic you keep); there is nothing to register on someone else's server. Day-to-day you stay signed in seamlessly via a local PIN / OS-backed unlock, and login verification is only demanded when a risk is predicted (new device, sensitive operation, anomalous access). Data at rest and the peer-to-peer protocol are encrypted; keys never leave your machine. Losing the mnemonic means losing the identity — that is the point of self-custody.

## One workspace, three scales

| You want | WArmy gives you |
| --- | --- |
| **A private assistant** | One workhorse with your files, tools and model; reads, searches, writes and runs commands after you approve. |
| **A private expert team** | PM / builder / reviewer / writer peers; the duty agent routes the brief, the board records decisions, memory carries context forward. |
| **A shared project room** | People and agents in one project with roles, approvals, artifacts and a paper trail. |

One person can use all three; a studio can grow from assistant to project room without moving work to a hosted platform.

![The workspace: plan board, agents and artifacts](docs/screenshots/readme-chat.png)

## What's inside

- **Multi-agent collaboration.** Workhorses hand work off and share a blackboard; agents are peers — no single agent silently owns the truth.
- **Contacts & instant messaging.** Add other people as contacts and chat in real time; a workhorse can join as a colleague. Social-software adapters let you work alongside your existing IM tools.
- **Remote operation & multi-device sync.** Operate a reachable machine remotely and keep sessions in sync across your devices over optional encrypted project networking (DHT discovery joined by default, switchable; LAN/relay opt-in). Only address/port/fingerprint/online-time metadata enters discovery — never chat content.
- **A desktop companion.** A customizable mascot that lives on your screen, walks to your icons and reacts; camera/mic/speaker/network each individually switchable. It speaks only when there is something worth saying.
- **Harness self-evolution.** A/B branch experiments, prompt self-update, prediction self-convergence, rollback points — improvement against evidence, not flattery.
- **Knowledge base, plan board, rollback points.** Every claimed file is verified on disk before it counts as done.
- **Diwen system.** A structured, verifiable machine-layer for facts (Chinese portion today); user-visible content stays natural language. Diwen is its own open-source project — see [Acknowledgments](#acknowledgments).
- **Extensible by design.** dsh-compatible plugins, installable skills, and MCP servers with deterministic (non-model-discretion) extension points.
- **A workbench for output.** The built-in nm viewer: Markdown source/preview, Office/PDF extraction, byte-level hex editing, archives, and a tabbed split browser with autonomous browsing.
- **A real console.** A DevTools-style terminal above the chat: run commands in the session workspace, Tab-complete paths, recall history, interrupt with Ctrl+C, ANSI-colored output.
- **An open, scoped agent API.** Settings → Shortcuts lists every `window.warmy` operation other agents can call (in-app IPC, no network port); sensitive calls still stop at approval cards.
- **Three-tier recall.** Current recall → a broader head+tail re-recall → agentic `retrieve`; if a fact truly isn't there, the agent says so instead of guessing.

![Desktop companion and workbench](docs/screenshots/readme-mimic.png)

## Control and safety

- **Explicit before dangerous.** Shell, out-of-workspace writes, protected dirs and other-session data stop at an approval card; every tool call is audited.
- **Per-session permissions.** A group workhorse cannot browse a project or private session just because it can chat.
- **Optional isolation.** Host or container; an unavailable container is reported honestly, never silently replaced.
- **Honest about limits.** Unfinished paths say so; unavailable services fail loudly instead of inventing results.
- **Device arbitration.** A session's microphone/speaker/camera use outranks the desktop companion: the companion yields while a session is using a device and resumes once it is released; when several sessions contend, the focused window wins.

![Settings and safety controls](docs/screenshots/readme-settings.png)

## The system, briefly

Electron main + renderer workspace + isolated subprocesses for native work (SQLite/FTS5, segmentation, analytics, local speech). Main and renderer load **zero native modules**; Python/torch/whisper.cpp live only in child processes. The local service port is **59599** (loopback only).

## How it works

You send a brief → the duty agent routes it → a workhorse plans and calls tools → dangerous calls stop at an approval card → artifacts are verified on disk → the round is appended to the local memory log and recalled inside the next thinking chain. Self-evolution runs A/B branches against evidence and merges only what proves better.

## What you can do

- Run a private assistant, an expert team, or a shared project room — and grow between them without migrating.
- Draft → build → review pipelines where the reviewer checks claims against the actual files.
- Chat with contacts in real time, operate a reachable machine remotely, and keep sessions synced across devices.
- Schedule night shifts with honest stop reasons; point at a `127.0.0.1` model server so nothing leaves your machine.

## Small details and technical notes

- **Memory you can inspect.** The append-only jsonl log is the source of truth; `recall` finds anchors and `retrieve` dereferences them to the original record — nothing is silently compressed away.
- DHT discovery joins by default (switchable in Settings → Network & Host); it publishes only address/port/fingerprint/online-time metadata, never chat content. LAN/relay networking stays opt-in.
- 27 UI languages; pinyin-named IPC channels; per-session authorization levels; container isolation reported honestly when unavailable.

## Install

**Download, install, use.** No server setup.

1. Download `WArmy-Setup-0.4.47.exe` from the [latest release](https://github.com/Pondsi/WArmy/releases).
2. Run the installer, choose a folder, launch **WArmy / 无限牛马**.
3. First run: choose a language, create your self-custodied identity, save the 24-word mnemonic, set a PIN; add a model provider and create your first workhorse.

Data lives in `WArmyData` inside the install folder and survives upgrades/uninstall. The installer is unsigned (SmartScreen may warn); the release page lists SHA-256 for verification.

**Environment:** Windows 10/11 x64; a model endpoint (local server, OpenAI-compatible, or Anthropic). For local models enter the base URL; the key field stays empty when unneeded. Web search/cloud/IM need network; everything else works offline.

**Languages / 语言 — 27 UI languages:** 简体中文 · 繁體中文 · English · 日本語 · 한국어 · Русский · Español · Français · Português · Esperanto · Deutsch · Italiano · Nederlands · Polski · Svenska · Čeština · Magyar · Dansk · Norsk bokmål · Türkçe · Українська · Bahasa Indonesia · Tiếng Việt · ไทย · हिन्दी · العربية · فارسی.

## Status and honesty

Core workflows are verified with local model servers through consecutive offline gate rounds plus first-run/search/index/lazy-load checks. macOS, physical 4K, real IM accounts and cloud providers are still being verified. Most workspace files are plaintext while unlocked; a cloud provider receives whatever you send it. Model output can be wrong — review artifacts before shipping. WArmy does not claim to be "unhackable"; the goal is narrower and testable: **local by default, explicit before dangerous, honest when a boundary is hit.**

## Acknowledgments

WArmy stands on open-source work. The complete transitive dependency tree with licenses is in `pnpm-lock.yaml` and package manifests; every item links upstream.

**Bundled runtime & UI** (ordered by share of use)

- **DeepSeek Harness (dsh)** — MIT — <https://github.com/deepseek-ai/deepseek-harness> — the agent harness WArmy builds on: bundled runtime + plugin-first compatibility. Companions: **@nanmicoder/dsh-agent-teams** — <https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams>; **node-pty** — MIT — <https://github.com/microsoft/node-pty>; **koffi** — MIT — <https://github.com/Koromix/koffi>; **protobufjs** — BSD-3-Clause — <https://github.com/protobufjs/protobuf.js>; **@google/genai** — Apache-2.0 — <https://github.com/googleapis/js-genai>.
- **Electron** — MIT — <https://github.com/electron/electron>; **Chromium** — BSD-3-Clause — <https://github.com/chromium/chromium>; **Node.js** — MIT — <https://github.com/nodejs/node> — the desktop shell and runtime (a bundled `node.exe` runs the memory service in its own process).
- **SQLite** — Public Domain — <https://www.sqlite.org/>; **better-sqlite3** — MIT — <https://github.com/WiseLibs/better-sqlite3>; **better-sqlite3-multiple-ciphers** — MIT — <https://github.com/m4heshd/better-sqlite3-multiple-ciphers>; **SQLCipher** — BSD-style — <https://github.com/sqlcipher/sqlcipher>; **bindings** — MIT — <https://github.com/TooTallNate/node-bindings>; **file-uri-to-path** — MIT — <https://github.com/TooTallNate/file-uri-to-path> — the memory store (FTS5 + optional encryption, subprocess only).
- **Diwen** — own license — <https://github.com/Pondsi/dsh-diwen> — separate open-source structured fact layer (also on npm as `diwen`).
- **hash-wasm** — MIT — <https://github.com/Daninet/hash-wasm> — argon2id/hashing in pure WASM (identity & keys).
- **three.js** — MIT — <https://github.com/mrdoob/three.js>; **@pixiv/three-vrm** — MIT — <https://github.com/pixiv/three-vrm> — 3D/VRM rendering for the mimic (license text bundled beside the vendor bundle).
- **ONNX Runtime Web** — MIT — <https://github.com/microsoft/onnxruntime> — local embeddings via WASM SIMD/WebGPU.
- **sherpa-onnx / sherpa-onnx-node** — Apache-2.0 — <https://github.com/k2-fsa/sherpa-onnx> — local speech (subprocess only).
- **DuckDB** — MIT — <https://github.com/duckdb/duckdb> + **@duckdb/node-api** — MIT — <https://github.com/duckdb/duckdb-node-neo> — local analytics (subprocess only).
- **qrcode-generator** — MIT — © Kazuhiko Arase — <https://github.com/kazuhikoarase/qrcode-generator>; **jsQR** — Apache-2.0 — <https://github.com/cozmo/jsQR> — QR encode/decode.

**Companion projects**

- **FWArmy** — <https://github.com/Pondsi/FWArmy> — the companion **relay service station** for WArmy: deploy a voluntary public relay site for the community, or run a private one for your own team. It pairs with WArmy's optional relay networking when direct connections aren't possible.

**Build & installer**

- **TypeScript** — Apache-2.0 — <https://github.com/microsoft/TypeScript>; **pnpm** — MIT — <https://github.com/pnpm/pnpm>; **electron-builder** — MIT — <https://github.com/electron-userland/electron-builder>; **esbuild** — MIT — <https://github.com/evanw/esbuild>; **NSIS** — zlib/libpng-style — <https://nsis.sourceforge.io/>.

**On-demand subprocess tools** (downloaded/installed only with consent, hash-pinned)

- **whisper.cpp** — MIT — <https://github.com/ggml-org/whisper.cpp>; **TripoSR** — MIT — <https://github.com/VAST-AI-Research/TripoSR> on **PyTorch** — BSD-3-Clause — <https://github.com/pytorch/pytorch> under **Python** — PSF — <https://www.python.org/>, weights from **Hugging Face** — <https://huggingface.co/>; **Docling** — MIT — <https://github.com/docling-project/docling>; **Tree-sitter / web-tree-sitter** — MIT — <https://github.com/tree-sitter/tree-sitter>.

**Protocols & optional external services** (own licenses/terms)

- **Model Context Protocol** — <https://modelcontextprotocol.io/> (bundled mcp-bridge implements the stdio JSON-RPC contract); **Ollama** — MIT — <https://github.com/ollama/ollama>; **ComfyUI** — GPL-3.0 — <https://github.com/comfyanonymous/ComfyUI>; **LibreOffice** — MPL-2.0 — <https://www.libreoffice.org/>; **WPS / Office** — proprietary — <https://www.wps.com/>.
- Every other dependency retains its own copyright/license; keep upstream notices when redistributing.

**无限牛马** is the Chinese name. The pixel ox is the mascot. The work is the point.

## Documentation and license

- [说明.md](./说明.md): full Chinese manual.
- [LICENSE](./LICENSE): MIT with mandatory attribution to **Pondsi** and a link to <https://github.com/Pondsi/WArmy> — required for original code, modified versions and snippets, personal or distributed.
- [SPONSORS.md](./SPONSORS.md): support the project.
- [Issues](https://github.com/Pondsi/WArmy/issues): bug reports and feature requests.