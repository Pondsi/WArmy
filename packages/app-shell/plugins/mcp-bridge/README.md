# MCP Bridge — a built-in WArmy plugin

WArmy does not speak MCP. This plugin bridges **MCP (Model Context Protocol) stdio
servers** into WArmy so agents can call their tools like any other tool.

- Plain Node ESM, **zero dependencies**, **no network** of its own.
- JSON-RPC 2.0 over the child server's stdin/stdout, newline-delimited (the MCP stdio transport).
- Protocol version `2024-11-05`, with negotiation: `initialize` → `notifications/initialized` →
  `tools/list` → `tools/call`, plus optional `resources/list` / `resources/read`.
- Spawns children with `spawn(command, argsArray, { shell: false })`. Never a shell string.

## Files

| File | Purpose |
| --- | --- |
| `bridge.mjs` | `StdioMcpClient` (transport + JSON-RPC), `McpBridge` (multi-server registry), CLI. |
| `echo-server.mjs` | Tiny MCP server (`echo`, `add`, `slow` tools + one resource). Demo and test fixture. |
| `selftest.mjs` | Spawns `echo-server.mjs` and asserts the whole round trip. `node selftest.mjs`. |
| `seed.mjs` | Copies this folder into WArmy's plugin scan directory; optional settings seeding. |
| `plugin.json` / `package.json` | Manifest + scanner markers; both carry `defaultEnabled: false`. |
| `mcp-servers.json.example` | Config template. Copy to `mcp-servers.json` (gitignored by intent). |

## Where WArmy looks for plugins

The app scans these directories (`chaJianJiSaoMiao` / `chaJianJiSaoMiaoMuLuJiQu` in
`packages/app-shell/src/electron-main.ts`):

1. the mandatory default: **`<userData>/scan-dirs/plugins`**
   - Windows `%APPDATA%\WARMY\scan-dirs\plugins`
   - macOS `~/Library/Application Support/WARMY/scan-dirs/plugins`
   - Linux `~/.config/WARMY/scan-dirs/plugins`
2. plus any extra dirs in `settings.json` → `pluginScanDirs` (max 10 total).

A sub-directory is recognized as a plugin when it contains **`package.json`** whose package
matches `warmy|plugin` by **name**, **dependency**, **field** (`warmy`/`warmyPlugin`), or
**keyword**. This package satisfies all four; `id` shown in the UI comes from `package.json.name`
(`warmy-plugin-mcp-bridge`), see `source` note below.

### Install (seed)

```powershell
# from the repo
node packages\app-shell\plugins\mcp-bridge\seed.mjs
# or be explicit
node packages\app-shell\plugins\mcp-bridge\seed.mjs --target "$env:APPDATA\WARMY\scan-dirs\plugins"
```

`seed.mjs` probes the user-data roots above (and `$WARMY_USER_DATA`), copies the whitelist into
`<scanDir>\mcp-bridge\`, and creates `mcp-servers.json` from the example if absent.
Flags: `--target <dir>`, `--settings <settings.json>`, `--enable`, `--dry-run`, `--force`.
It never writes into the app bundle.

## Enable / disable

Enable state lives in `settings.json` (not in the plugin folder), in the `chaJianJi` array.
Exact shape of one entry (values used by this plugin):

```json
{
  "id": "mcp-bridge",
  "ming": "warmy-plugin-mcp-bridge",
  "desc": "Bridge MCP stdio servers into WArmy agents as ordinary tools.",
  "enabled": false,
  "source": "discovered"
}
```

- `id` — stable key; `ming` — what Settings renders; `enabled` — the checkbox; `source` — `builtin` | `discovered` | `folder`.
- **Default is disabled.** `package.json` and `plugin.json` both declare `defaultEnabled: false`.
  Note: when you click **Settings → 插件 → 扫描检查**, WArmy appends newly discovered plugins with
  `enabled: true` (`app.js`, `anNiuPlugSaoMiaoJianCha`). So after discovery, **uncheck the box once** —
  the unchecked state persists in `settings.json`. To arrive already unchecked, seed the entry:
  `node seed.mjs --settings "<userData>\settings.json"` (writes `enabled: false`, backs up to
  `settings.json.mcp-bridge.bak`). Add `--enable` if you want it on.
- Removal is the trash button in the same list; it only drops the `chaJianJi` entry, not the folder.

## Configure an MCP server

Copy `mcp-servers.json.example` → `mcp-servers.json` in this folder (or point `WARMY_MCP_CONFIG` /
`--config` at another path). Resolution order: `--config` → `$WARMY_MCP_CONFIG` →
`<pluginDir>/mcp-servers.json` → `~/.warmy/mcp-servers.json`.

```json
{
  "version": 1,
  "servers": {
    "echo": {
      "command": "node",
      "args": ["./echo-server.mjs"],
      "cwd": ".",
      "env": { "SOME_TOKEN": "..." },
      "timeoutMs": 15000,
      "enabled": true
    }
  }
}
```

- `command` + `args` are passed as an argv array — no shell, no quoting games.
- `cwd` is resolved against the process cwd; `args` are handed through verbatim, so use an
  absolute path or set `cwd` when in doubt.
- `env` is merged over `process.env` for that child only.
- `timeoutMs` defaults to 30000 (20000 floor for `initialize`).
- `enabled: false` skips the server entirely.

## Use it from an agent (works today, no app changes)

WArmy's plugin UI manages metadata only — it scans, lists, toggles and deletes; it does **not**
execute plugin code. So the bridge is driven as a process/library:

```powershell
cd packages\app-shell\plugins\mcp-bridge
node bridge.mjs list                       # humans: servers + tool names
node bridge.mjs tools                      # OpenAI tool specs JSON (feed into a tool loop)
node bridge.mjs call mcp__echo__add --args-file args.json
'{"a":40,"b":2}' | node bridge.mjs call mcp__echo__add -
```

Inline JSON as the third positional arg also works, but shells are unreliable about quotes —
PowerShell in particular strips them, so `'{"a":2}'` arrives as `{a:2}`. Prefer `--args-file`
or stdin (`-`) when an agent is driving the CLI. `call` exits 0 on success, 1 on a tool error,
2 when some server failed to start, 64 on a usage error.

`bridge.mjs tools` output is exactly WArmy's function-tool shape
(`{ type: 'function', function: { name, description, parameters } }`), so any agent that already
consumes `workToolSpecs()` can ingest it unchanged. Tool names are `mcp__<server>__<tool>`,
sanitized to `[a-z0-9_-]` and ≤64 chars (deduped with a numeric suffix on collision).

Programmatic use:

```js
import { McpBridge } from './bridge.mjs';
const bridge = new McpBridge({ configPath: './mcp-servers.json' });
await bridge.start();                 // per-server failures land in bridge.errors, others keep running
const specs = bridge.toolSpecs();     // [{ type:'function', function:{ name, description, parameters } }]
const out = await bridge.callTool('mcp__echo__echo', { message: 'hi' });
// out = { ok, server, tool, qualifiedName, text, isError, content, structured }
bridge.stop();
```

To wire it into the agent loop proper, the host needs one hook that merges `bridge.toolSpecs()`
into its tool list and routes `mcp__*` calls to `bridge.callTool()`. That hook is deliberately
**not** added here: this plugin ships as pure new files, no existing source is edited.

## Errors, timeouts, protocol

- JSON-RPC errors surface as `McpError` with `.code` / `.message` / `.data` / `.method`.
  Client-side codes: `-32000` timeout, `-32001` spawn failure, `-32002` transport closed,
  `-32003` write failure. Server codes pass through (`-32601` unknown method, `-32602` invalid params…).
- Pending calls are keyed by numeric id, so a late reply to a timed-out id is dropped, not
  mismatched onto the next call.
- Non-JSON lines on stdout are recorded in `client.protocolWarnings` instead of crashing the bridge.
- A server that requests something from the client (`sampling/*`, `roots/*`) gets `-32601`; `ping` gets `{}`.
- `resources/list` returning `-32601`/`-32602` is treated as "unsupported" → empty list.

## Self-test

```powershell
node selftest.mjs
```

Covers: scanner predicate match, `defaultEnabled: false` markers, `initialize` version +
`serverInfo`, `tools/list` schemas, `tools/call` text, unknown-method/unknown-tool error codes,
timeout at `-32000` **and** id-matching recovery afterwards, `resources/list` + `resources/read`,
OpenAI spec shape + name safety, disabled-server skip, broken-server isolation, config-file load
(with a UTF-8 BOM), invalid-JSON rejection, and the CLI (`tools`, `call --args-file`, `call -` stdin,
unknown-tool exit code). Exits 0 only when every check passes.

Verified on Node v24.20.0 / Windows: `ALL PASS — 47/47 checks`.

## Limitations (stated plainly)

- WArmy never executes plugin code. Enabling this plugin in Settings is a **declaration**; the
  bridge runs when something calls it (CLI, or a host hook you add). No fake "active" state.
- No prompts, sampling, roots, elicitation or notifications forwarding — tools and the read-only
  resources surface only.
- No reconnect: a child that exits mid-session fails only its own pending calls; restart the process.
- Tool schemas are trusted as the server declares them; the bridge does not repair bad JSON Schema.
