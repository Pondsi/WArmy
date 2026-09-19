# WArmy

## English

**Workhorse Army** · **无限牛马**

> An infinite army of AI workhorses working for you.
>
> 让AI成为你的无限牛马

[![Release](https://img.shields.io/github/v/release/Pondsi/WArmy?include_prereleases&label=v0.1.0)](https://github.com/Pondsi/WArmy/releases/tag/v0.1.0)
[![License](https://img.shields.io/badge/license-custom%20MIT%20%2B%20attribution-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-informational)](https://github.com/Pondsi/WArmy/releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848f?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![i18n](https://img.shields.io/badge/UI%20locales-10-success)](#internationalization)
[![Author](https://img.shields.io/badge/author-Pondsi-lightgrey)](https://github.com/Pondsi)

**WArmy** is a **local-first multi-agent group-chat desktop app**.
Create AI **workhorses** (agent instances), put them into **project groups**, and let a **duty agent** orchestrate tools, board tasks, and bounded context — many models working like a team, while chats and files stay on **your device** by default.

Chinese product name: **无限牛马** (ja: 無限社畜 / ko: 무한 사축). This is not another “chat wrapper”: it is a desktop product for **multi-agent teamwork, project lifecycle, container-isolated development, and local-first mesh identity**.

### What makes WArmy different

1. **Group is the product surface** — My workhorses / Projects / Contacts & groups / Overview board (not a single chat box).
2. **Duty, not shouting** — duty is local-only; order-based dispatch; directed `@` mode; P0–P3 urgency with **persisted queues that are never dropped**.
3. **Container = development isolation** — host editing refused when container-dev is chosen; no silent host fallback; console is the container shell or greyed; solidify requires real commit + image inspect.
4. **Local-first by default** — no collection/upload of chats/files by default; identity/mesh/queues/boards under app user data.
5. **Ports that refuse to lie** — production **59599** (dev 58588 / test 62666); bind failure fails loudly with clickable candidates; **never silent port switch**.

### Compared with similar open-source projects

| Genre | Typical strength | How WArmy differs |
| --- | --- | --- |
| Agent prompt packs (e.g. agency-agents style) | Rich personas & recipes | WArmy ships a **running desktop product** (instances, groups, duty, persistence, identity) |
| Single-window chat UIs | Simple model chat | Unit of work is **group + duty + board + tools + project policy** |
| Coding-agent CLIs / IDE plugins (Claude Code, Cursor, Aider, …) | Deep repo editing in your IDE | WArmy is a **project command center**, not an IDE plugin |
| Multi-agent frameworks (AutoGen/CrewAI-class) | Code-first flexibility | WArmy is a **batteries-included desktop app** with UI, i18n, queues, security gates |
| Desktop agent runtimes (OpenClaw / dsh-class) | Strong local agent execution | WArmy adds **group product semantics** (duty order, project stop face, container-dev policy) |
| Container platforms (Docker Desktop, …) | Excellent container UX | WArmy **does not bundle** Docker Desktop; it probes **user-installed** runtimes and encodes product policy |

**Pitch:** other stacks give you *an agent*, *a chat*, or *a library*. **WArmy gives you an army with ranks, duty, projects, and a sandbox door that stays shut.**

### Features

- Multi-instance workhorse manager (hardware advice, persona, fallback chain)
- Project / contact / external groups; external groups reply **only on @**
- Board commands, knowledge recall/retrieve, checkpoints, metrics/cost
- Bounded context renderer (cap inject size, keep details retrievable)
- Container projects: 12-runtime probe, start/stop, member face = creator-offline, file ledger (project-level)
- Mesh identity / membership / `WARMY-*` protocol constants
- **10 UI locales** with equal key sets

### Install (Windows)

1. Open [Releases v0.1.0](https://github.com/Pondsi/WArmy/releases/tag/v0.1.0)
2. Download **`WArmy-Setup-0.1.0.exe`** — [direct link](https://github.com/Pondsi/WArmy/releases/download/v0.1.0/WArmy-Setup-0.1.0.exe)
3. Optional SHA-256 check against [`checksums.txt`](./checksums.txt)
4. Install → **Settings** → language / providers

**Source build**

```bash
git clone https://github.com/Pondsi/WArmy.git
cd WArmy
pnpm install
pnpm -r build
pnpm --filter @warmy/app-shell start
```

Requires Node.js **>= 24** and **pnpm**.

### How to use

1. **My agents** → create workhorse → provider + model → start  
2. **Projects** → create group → choose **host** or **container** development  
3. Send with urgency: **P1** urgent · **P2** insert (default) · **P3** queue  
4. Right panel: files / products / progress / metrics  
5. **Settings → Language** → any of 10 packs (applies immediately)

**Container-dev rules:** container is for **development isolation** (not a default test farm); not ready ⇒ grey console, no host fallback; stop ≈ creator offline for members; history stays readable.

### Ports & networking

| Constant | Default |
| --- | --- |
| Production mesh TCP | **59599** |
| Development convention | 58588 |
| Testing convention | 62666 |

### Security & privacy

- Default: no collection/upload of conversations and files
- Secrets env scrubbed before container commands
- Honest limits: bind-mount visibility on host is by design; optional ACL lock ≠ encryption; public NAT cases need a second machine

### Technical highlights

| Area | Approach |
| --- | --- |
| Shell | Electron 33 + TypeScript; **zero native modules** in app main/renderer |
| Isolation | sqlite/embedding paths in Worker / child processes |
| Monorepo | pnpm packages (`app-shell`, `group-router`, `sync-protocol`, …) |
| Context | Bounded renderer + retrieve pointers |
| Router | Duty machine + priority queues + disk serialize |
| Verify | i18n / wiring / protocol / container / router / CDP UI inspect |

Deep dive: [`references/ARCHITECTURE.md`](./references/ARCHITECTURE.md) · [`docs/ADR/`](./docs/ADR/)

### Quality gates

```bash
node packages/app-shell/scripts/verify-i18n-locales.mjs
node packages/app-shell/scripts/verify-router-queue.mjs
node packages/app-shell/scripts/verify-wiring.mjs
node packages/app-shell/scripts/verify-container-probe.mjs
node packages/sync-protocol/scripts/verify-connectivity.mjs
node packages/app-shell/scripts/verify-docs.mjs
```

### Internationalization

zh-CN · zh-TW · en-US · ja · ko · ru · es · fr · pt · eo — equal key sets; runtime list includes all packs.

### Limitations

Primary target Windows x64; mobile is a companion preview (orchestration on desktop); Docker runtime is user-installed.

### License & sponsors

[LICENSE](./LICENSE) (mandatory **Pondsi** attribution) · [SPONSORS.md](./SPONSORS.md) · full Chinese manual: [说明.md](./说明.md)


---

## 简体中文

**WArmy**（全名 **Workhorse Army**，中文名 **无限牛马**）是**本地优先的多智能体群聊桌面应用**。

副标题：**让AI成为你的无限牛马**。

### 优点

- **群聊是主界面**：我的牛马 / 项目 / 联系人与群聊 / 总看板，不是单聊天框
- **值班编排**：本机值班、定向 @、优先级队列落盘，弹出必处理不丢弃
- **容器语义诚实**：开发环境隔离；未就绪不静默降级；没真 commit 不报已固化
- **文件台账是产品功能**：项目级、成员可见
- **本地优先 + 端口不说谎**：默认 59599，失败必报错并给候选

### 与同类产品的不同

| 类型 | 常见长处 | WArmy 差异 |
| --- | --- | --- |
| Agent 提示词/角色库 | 人格与工作流模板丰富 | 交付**可安装桌面产品**（实例/群/值班/持久化/身份） |
| 单窗口聊天 UI | 换模型聊天简单 | 工作单元是**项目群+值班+看板+工具门禁** |
| 编程智能体 CLI/IDE | 在编辑器里改代码深 | WArmy 是**项目指挥台**，不是 IDE 插件 |
| 多智能体框架库 | 代码灵活 | WArmy 是**开箱桌面应用**（UI/语言包/队列/安全门禁） |
| 桌面智能体运行时（OpenClaw/dsh 类） | 本机执行强 | WArmy 补上**队伍编制与项目策略**产品语义 |
| 容器平台 | 容器体验专业 | **不捆绑** Docker Desktop；探测用户已装运行时 |

### 安装方法

1. [Releases v0.1.0](https://github.com/Pondsi/WArmy/releases/tag/v0.1.0) 下载 **`WArmy-Setup-0.1.0.exe`**  
   直链：[WArmy-Setup-0.1.0.exe](https://github.com/Pondsi/WArmy/releases/download/v0.1.0/WArmy-Setup-0.1.0.exe)
2. 可选对照 [`checksums.txt`](./checksums.txt) 做 SHA-256
3. 安装后在「设置」配置语言与模型供应商

源码：

```bash
git clone https://github.com/Pondsi/WArmy.git
cd WArmy
pnpm install
pnpm -r build
pnpm --filter @warmy/app-shell start
```

需要 Node.js **≥ 24**、**pnpm**。

### 使用方法

1. **我的牛马** → 创建实例 → 配置供应商/模型 → 启动  
2. **项目** → 创建项目群 → 选择开发环境（本机 / 容器中开发）  
3. 发送消息并选紧急度：P1 加急 / P2 插入（默认）/ P3 排队  
4. 右侧查看文件、产物、进度、指标  
5. **设置 → 语言** 切换 10 种界面语言（立即生效）

**容器项目**：开发只在容器内；容器未启动=项目不可用（成员等同创建者下线）；历史可读；控制台未就绪置灰。

### 端口

生产默认 **59599** · 开发约定 58588 · 测试约定 62666；绑定失败绝不静默换端口。

### 技术要点

Electron + TypeScript 零原生模块主/渲染 · pnpm monorepo · 有界上下文渲染 · 值班路由队列落盘 · Ed25519 身份与 `WARMY-*` 协议 · 容器探测/能力表/证据等级 · 10 语言键集对齐。

详见 [说明.md](./说明.md) 与 [references/ARCHITECTURE.md](./references/ARCHITECTURE.md)。

### 安全与限制

默认不收集不上传对话文件；容器 bind mount 宿主可见属设计；ACL 锁≠加密；跨公网/NAT 需第二台机器验证。法律与免责见 [LICENSE](./LICENSE)。


---

## Other languages / 其他语言


<details>
<summary>繁體中文（摘要）</summary>

WArmy（無限牛馬）是本地優先的多智能體群組聊天桌面應用。優點、同類比較、安裝與使用見下方「简体中文」完整段（語義等價）。詳細手冊：[说明.md](./说明.md)。

</details>

<details>
<summary>한국어（요약）</summary>

WArmy(무한 사축)은 로컬 우선 다중 에이전트 그룹 채팅 데스크톱 앱입니다. 설치·사용·차이점은 아래 简体中文 절과 의미가 동일합니다. 상세: [说明.md](./说明.md).

</details>

<details>
<summary>Русский（кратко）</summary>

WArmy — local-first настольное приложение группового чата с ИИ-агентами. Установка и отличия эквивалентны разделу 简体中文. Подробности: [说明.md](./说明.md).

</details>

<details>
<summary>日本語（概要）</summary>

WArmy（無限社畜）はローカル優先のマルチエージェント・グループチャット卓上アプリです。導入・使い方・差分は下の简体中文節と同義です。詳細: [说明.md](./说明.md).

</details>

<details>
<summary>Español（resumen）</summary>

WArmy es una app desktop de chat grupal multiagente local-first. Instalación y uso equivalentes a la sección 简体中文. Manual: [说明.md](./说明.md).

</details>

<details>
<summary>Français（résumé）</summary>

WArmy est une application de bureau local-first de chat de groupe multi-agents. Installation et usage équivalents à la section 简体中文. Manuel : [说明.md](./说明.md).

</details>

<details>
<summary>Português（resumo）</summary>

WArmy é um app desktop local-first de chat em grupo multiagente. Instalação e uso equivalentes à seção 简体中文. Manual: [说明.md](./说明.md).

</details>

<details>
<summary>Esperanto (resumo)</summary>

WArmy estas loka pluragenteca grupbreta programo. Instalo kaj uzo ekvivalentas al la ĉina sekcio. Manlibro: [说明.md](./说明.md).

</details>


---

## Repository layout

```text
WArmy/
├── README.md  说明.md  LICENSE  SPONSORS.md  CHANGELOG.md
├── checksums.txt  index.html
├── docs/ADR/  references/
├── packages/  sponsors/  spikes/
```

---

Pondsi (+mimo-X-por-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop

Pondsi（+mimo-X-por-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash）— 由 Xiaomi MiMo Desktop 自行提交
