# WArmy

**Workhorse Army** — An infinite army of AI workhorses working for you.

**无限牛马** · 让AI成为你的无限牛马

Multi-agent group-chat desktop app (Electron). Local-first: your conversations and files stay on your device by default.

---

## English

WArmy is a multi-agent group-chat desktop application. You create AI “workhorses” (agents), put them in project groups, and let a duty agent orchestrate tools, board tasks, and context.

### Install (Windows)

1. Download `无限牛马 Setup 0.1.0.exe` from GitHub Releases (or build from source).
2. Run the installer.
3. Open **Settings** to configure models / providers.

### Build from source

```bash
pnpm install
pnpm -r build
pnpm --filter @warmy/app-shell start
```

### Safety notes

- Default: **no cloud upload** of chats/files; data stays local.
- Container projects: development happens **only inside the container** when that mode is chosen; host-side editing is refused by the app.
- Container runtime is **user-installed** (Docker / Podman / WSL …). WArmy probes existing runtimes; it does not bundle Docker Desktop.
- Bind mounts make the project folder visible on the host by design; that is not filesystem-level enforcement by itself. Optional directory ACL lock exists on Windows.

### Languages

UI packs: zh-CN, zh-TW, en-US, ja, ko, ru, es, fr, pt, eo.

---

## 简体中文

WArmy（无限牛马 / Workhorse Army）是多智能体群聊桌面应用：创建 AI「牛马」，编入项目群，由值班者编排工具、看板与上下文。

### 安装（Windows）

1. 从 GitHub Releases 下载 `无限牛马 Setup 0.1.0.exe`
2. 安装后打开应用，在「设置」里配置模型

### 源码构建

```bash
pnpm install
pnpm -r build
pnpm --filter @warmy/app-shell start
```

### 安全说明

- 默认**不收集、不上传**对话与文件
- 选了「容器中开发」的项目：**只能在容器里开发**；应用拒绝宿主侧编辑
- 容器运行时由用户自装；未就绪时控制台置灰，不静默降级到本机
- 端口默认生产 59599 / 开发 58588 / 测试 62666；绑定失败**绝不静默换端口**

---

## 繁體中文

WArmy（無限牛馬）是多智能體群聊桌面應用。安裝與安全說明見「简体中文」段（語義等價）。

---

## 한국어

WArmy(무한 사축)은 다중 에이전트 그룹 채팅 데스크톱 앱입니다. 설치·안전 규칙은 English 절과 의미가 같습니다.

---

## Русский

WArmy — настольное приложение группового чата с несколькими ИИ-агентами. Установка и правила безопасности эквивалентны разделу English.

---

## 日本語

WArmy（無限社畜）はマルチエージェントのグループチャット卓上アプリです。導入と安全ルールは English 節と同義です。

---

## Español

WArmy es una aplicación de escritorio de chat grupal multiagente. Instalación y seguridad equivalentes a English.

---

## Français

WArmy est une application de bureau de chat de groupe multi-agents. Installation et sécurité équivalentes à la section English.

---

## Português

WArmy é um aplicativo desktop de chat em grupo multiagente. Instalação e segurança equivalentes à seção English.

---

## Esperanto

WArmy estas pluragenteca grupbreta babila programo. Instalo kaj sekureco ekvivalentas al la angla sekcio.

---

## License

See [LICENSE](./LICENSE). Attribution to **Pondsi** is mandatory.

## Sponsors

See [SPONSORS.md](./SPONSORS.md).

---

Pondsi (+mimo-X-por-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop

Pondsi（+mimo-X-por-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash）— 由 Xiaomi MiMo Desktop 自行提交
