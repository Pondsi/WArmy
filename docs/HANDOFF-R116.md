# 第 116 轮交接：可自行完成的剩余项收口

## 0. 结论

本轮把前几轮“已列出、不需要用户环境/账号/拍板即可做”的剩余项做完了：

1. **加密层跨边界复制/流式写入**：`copyFileSync`、`cpSync`、`createWriteStream` 不再整文件读入内存；新增流式文件格式 `TYPE_STREAM`，写入先落临时文件、结束后回填长度并原子替换；中途销毁不留半截目标/临时文件。
2. **加密范围读取**：`createReadStream` 的 `start/end` 也走流式解密（不再整文件缓冲）；`encoding` 选项生效；`statSync({bigint:true})` 报逻辑大小。
3. **目录复制不绕过加密**：技能导入（`skills/`）与插件播种（`scan-dirs/`）使用的 `fs.cpSync` 现在逐文件走受管复制；外→内落密文、内→外解明文、`filter` 生效。
4. **nm 远程网页**：补齐键盘焦点（`before-input-event` 转发 Ctrl+F/L/R/P、Alt+←/→、F5、查找打开时的 Esc）、远程页查找条与匹配数、前进/后退状态改由主进程 `navigationHistory` 同步、载入中刷新按钮变“停止载入”。

本轮没有改任何已拍板的产品口径，也没有使用任何模型 API Key。

## 1. 加密层：跨边界复制 / 流式写入 / 范围读取

### 1.1 新格式 `TYPE_STREAM = 2`

- 普通文件的流式写入长度要到最后才知道，而 GCM 的 AAD 必须在开头定死；因此流式文件用独立的类型 2，**AAD 固定按逻辑长度 0**，头里的 `logicalSize` 在写完后回填。
- type0（一次性写入）、type1（JSONL 逐记录）、type2（流式文件）读取端都识别；`statSync`/`readFileSync`/`createReadStream` 均按逻辑内容工作。
- JSONL 流式写入仍是 type1，逐条记录封装，末尾回填记录数。

### 1.2 写入原子性

- `createWriteStream` 先写同目录 `*.wstream-*.tmp`；成功结束后：
  1. 等 raw 文件流真正 `close`（Windows 上 fd 未关会 EPERM）；
  2. 用 `r+` 回填头；
  3. `rename` 原子替换目标。
- 中途 `destroy`/出错：等 raw 关闭后删除临时文件（Windows 上带重试），**目标文件保持原样**。
- `flags:'a'` 的流：按追加语义逐块走 `appendLogical`（JSONL 逐记录；普通文件转成 JSONL 逻辑流，读取结果一致）。

### 1.3 `copyFileSync` / `cpSync`

- `copyFileSync` 的四种边界都覆盖：
  - 外→内：按块加密成 type2（`.jsonl` 目标成 type1）；
  - 内→外：按块解密成明文；
  - 内→内：解密后重新加密；
  - 外→外：仍走原生复制。
- 目标先写临时文件再原子替换；源在受管范围外时按原始字节处理（即使内容碰巧以 `WARMYEF2` 开头也不会误解密）。
- `cpSync`：目标或源在受管范围时递归复制，每个文件走受管 `copyFileSync`；`filter` 生效，`force:false`/`errorOnExist` 有明确报错。符号链接等特殊条目仍交原生实现（应用没有用它搬符号链接）。

### 1.4 范围读取

- `createReadStream(p, {start,end})` 对密文不再 `readFileSync` 整文件；按块解密、跳过 `start` 之前的内容、到 `end` 停止，内存只占一个解密块。
- `encoding` 选项会设置到返回的流上。

## 2. nm 远程网页：键盘 / 查找 / 历史

- **键盘焦点**：`WebContentsView` 的 `before-input-event` 把 nm 自己的快捷键转回宿主渲染层：
  - Ctrl/Cmd+F（查找）、Ctrl/Cmd+L（地址栏）、Ctrl/Cmd+R / F5（刷新）、Ctrl/Cmd+P（打印）、Alt+←/→（后退/前进）；
  - Esc 只在远程查找条打开时接管，避免抢网页自己的 Esc；
  - 普通按键、按键抬起、输入框输入不拦截。
- **查找条**：网站模式第三行查找栏；输入防抖后调 `findInPage`，匹配数/当前项显示在工具栏；Enter/Shift+Enter、↑/↓、Esc 都可用；切换标签、关闭网站模式、页面导航时自动清空查找。
- **历史同步**：工具栏前进/后退的禁用状态改用主进程 `navigationHistory.canGoBack/canGoForward`；载入中刷新按钮显示“停止载入”。渲染层自己的 URL 历史只继续服务本地网页标签。
- 新增 `verify-r81-nm` 断言：远程导航状态确实会变、查找条打开/聚焦、匹配数 2/3、下一个再次查找、Esc 收起、快捷键映射真值表（含 Esc 关闭时不接管、keyUp/普通字母不拦截）。

## 3. 边界（不变）

- `workspace/`、外部项目目录、截图/字体、mimic、Chromium 缓存、auth/identity/secure、vault.bin、memory.db 仍不在逐文件加密层。
- 应用侧加密不是文件系统级强制；同 OS 用户的管理员进程/内存转储不在威胁模型内。
- 远程页下载仍按 Chromium 默认行为（未接下载管理器）；`window.open` 仍拒绝。需要的话另开一轮做下载 UI。
- 第二设备/真实 IM/4K 物理屏/代码签名/真实 TTS-图像-视频供应商仍需用户环境或账号。

## 4. 测试

| 门禁 | 结果 |
|---|---|
| fast 档 | **130 项次 0 红**（1 遍） |
| `verify-r116-enc-stream` | **34/34** |
| `verify-r81-nm` | **63/63**（已加入 fast 清单） |
| `verify-r115-streaming` | 7/7 |
| `verify-r114-crypto` | 19/19 |
| `pnpm -r typecheck` | 11/11 包通过 |

`verify-r116-enc-stream` 覆盖：8MB 外→内/内→外/内→内复制、JSONL 三种边界、范围读取、encoding、bigint stat、流式普通文件/JSONL、追加流、销毁原子性、临时文件清理、cpSync 三向与 filter、写守卫、rename 封装。

## 5. 改动文件

- `packages/app-shell/src/enc-fs.cjs`（TYPE_STREAM、流式复制/写入/范围读取、cpSync、bigint stat、追加流）
- `packages/app-shell/src/nm-viewer-win.ts`（before-input-event 映射、导航状态、查找状态）
- `packages/app-shell/src/renderer/nm-viewer.js` / `nm-viewer.html` / `nm-viewer.css`（远程查找条、导航状态、快捷键接线）
- `dev/gates/verify-r116-enc-stream.mjs`（新增）
- `dev/gates/verify-r81-nm.mjs`（新增远程导航/查找/快捷键断言）
- `dev/gates/run-verify-22.mjs`（新增 r116、r81-fast 清单项）

## 6. 交付

- `release/win-unpacked` 用最终源码同步。
- 真实 profile 未删除、未重置；应用仍用现有真实 profile 运行。当前已打开的窗口是在同步前启动的，**重启应用后才会加载本轮新代码**；没有擅自关闭正在运行的用户窗口。
- 本轮未发布新的 GitHub Release。
