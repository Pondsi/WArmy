# CCArmy 项目审查报告

**审查时间**：2026-09-17 19:00  
**审查方法**：基于 agency-agents 6 个专业 Agent 方法论（Security Engineer / Code Reviewer / Frontend Developer / UI Designer / Mobile App Builder / Software Architect）  
**审查范围**：`packages/app-shell/src/electron-main.ts`、`src/renderer/app.js`、`src/renderer/app.css`、`src/renderer/index.html`、`src/preload.cjs`、`mobile/` 全部文件、`src/i18n/`  

---

## 问题 #1：103 个 IPC Handler 缺少 try/catch

**严重级别**：🔴 必须修复  
**影响**：主进程未捕获异常会导致渲染进程收到未处理的 rejection，界面可能卡死或显示空白  
**文件**：`packages/app-shell/src/electron-main.ts`  
**当前状态**：126 个 `ipcMain.handle` 中只有 23 个有 try/catch，103 个直接返回值或调用外部函数无保护  

### 完整缺失列表（103 个）

#### 窗口控制类（5 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1181 | `ccarmy:win-maximize` | 包裹 try/catch，返回 `{ ok, error }` |
| L1187 | `ccarmy:win-reload` | 已有部分逻辑但缺外层 try/catch |
| L1195 | `ccarmy:win-always-on-top` | 包裹 try/catch |
| L1201 | `ccarmy:platform` | 简单返回，风险低但仍建议包裹 |
| L1171 | `ccarmy:win-minimize` | 简单调用，风险低 |

#### 实例管理类（5 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L274 | `ccarmy:list-instances` | 包裹 try/catch，返回 `[]` 兜底 |
| L289 | `ccarmy:stop-instance` | 包裹 try/catch，返回 `{ ok, error }` |
| L293 | `ccarmy:security-mode` | 包裹 try/catch，返回默认模式 |
| L953 | `ccarmy:spawn-dsh-instance` | 包裹 try/catch，返回 `{ ok, error }` |
| L945 | `ccarmy:dsh-available` | 包裹 try/catch |

#### 设置/配置类（8 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L350 | `ccarmy:locale-info` | 包裹 try/catch，返回默认 locale |
| L356 | `ccarmy:set-theme-source` | 包裹 try/catch |
| L360 | `ccarmy:theme-info` | 包裹 try/catch |
| L573 | `ccarmy:set-provider` | 包裹 try/catch，返回 `{ ok, error }` |
| L578 | `ccarmy:get-provider` | 包裹 try/catch |
| L753 | `ccarmy:settings-save` | 包裹 try/catch |
| L1449 | `ccarmy:state-load` | 包裹 try/catch |
| L1442 | `ccarmy:state-save` | 包裹 try/catch |

#### 文件/资源类（4 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L384 | `ccarmy:pick-sound` | 包裹 try/catch，返回 null |
| L396 | `ccarmy:check-update` | 包裹 try/catch |
| L401 | `ccarmy:pick-file` | 包裹 try/catch，返回 null |
| L1762 | `ccarmy:clear-error` | 包裹 try/catch |

#### 群组/会话类（12 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L440 | `ccarmy:group-list` | 包裹 try/catch，返回 `[]` |
| L547 | `ccarmy:board-tasks` | 包裹 try/catch，返回 `[]` |
| L551 | `ccarmy:board-events` | 包裹 try/catch，返回 `[]` |
| L555 | `ccarmy:board-aggregate` | 包裹 try/catch |
| L559 | `ccarmy:group-join-instance` | 包裹 try/catch |
| L1701 | `ccarmy:group-members` | 包裹 try/catch，返回 `[]` |
| L1705 | `ccarmy:group-invite` | 包裹 try/catch |
| L1712 | `ccarmy:group-kick` | 包裹 try/catch |
| L1718 | `ccarmy:group-set-admin` | 包裹 try/catch |
| L1725 | `ccarmy:group-directed` | 包裹 try/catch |
| L1734 | `ccarmy:board-session` | 包裹 try/catch |
| L1905 | `ccarmy:group-dissolve` | 包裹 try/catch |

#### 检查点类（3 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L685 | `ccarmy:checkpoint-create` | 包裹 try/catch |
| L693 | `ccarmy:checkpoint-list` | 包裹 try/catch，返回 `[]` |
| L699 | `ccarmy:checkpoint-rollback` | 包裹 try/catch |

#### 知识库类（3 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L711 | `ccarmy:knowledge-query` | 包裹 try/catch，返回 `{ cards: [] }` |
| L1266 | `ccarmy:kb-from-chat` | 包裹 try/catch |
| L1750 | `ccarmy:kb-detail` | 包裹 try/catch |

#### 插入模式/指标类（4 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L738 | `ccarmy:set-insert-mode` | 包裹 try/catch |
| L742 | `ccarmy:get-insert-mode` | 包裹 try/catch |
| L749 | `ccarmy:metrics-turns` | 包裹 try/catch，返回 `[]` |
| L1332 | `ccarmy:cost-summary` | 包裹 try/catch |

#### 账户/安全类（10 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L879 | `ccarmy:app-info` | 包裹 try/catch |
| L895 | `ccarmy:profile-save` | 包裹 try/catch |
| L900 | `ccarmy:profile-set-password` | 包裹 try/catch |
| L904 | `ccarmy:profile-login` | 包裹 try/catch |
| L1295 | `ccarmy:request-approval` | 包裹 try/catch |
| L1310 | `ccarmy:approval-respond` | 包裹 try/catch |
| L1861 | `ccarmy:secure-key-save` | 包裹 try/catch |
| L1866 | `ccarmy:secure-key-load` | 包裹 try/catch |
| L1917 | `ccarmy:export-allowlist` | 包裹 try/catch |
| L1766 | `ccarmy:setup-state` | 包裹 try/catch |

#### 网络/Mesh 类（10 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L926 | `ccarmy:nodes-pair` | 包裹 try/catch |
| L930 | `ccarmy:nodes-revoke` | 包裹 try/catch |
| L935 | `ccarmy:invite-use` | 包裹 try/catch |
| L938 | `ccarmy:sync-publish` | 包裹 try/catch |
| L942 | `ccarmy:sync-pull` | 包裹 try/catch |
| L1134 | `ccarmy:mesh-stop` | 包裹 try/catch |
| L1144 | `ccarmy:peers-list` | 包裹 try/catch |
| L1159 | `ccarmy:peers-remove` | 包裹 try/catch |
| L1164 | `ccarmy:mesh-broadcast` | 包裹 try/catch |
| L1172 | `ccarmy:mesh-status` | 包裹 try/catch |

#### 邮件类（6 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L982 | `ccarmy:email-queue` | 包裹 try/catch |
| L986 | `ccarmy:email-list` | 包裹 try/catch |
| L989 | `ccarmy:smtp-verify` | 包裹 try/catch |
| L1003 | `ccarmy:smtp-list` | 包裹 try/catch |
| L1012 | `ccarmy:smtp-add` | 包裹 try/catch |
| L1030 | `ccarmy:smtp-remove` | 包裹 try/catch |

#### LAN 同步类（4 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1065 | `ccarmy:lan-stop` | 包裹 try/catch |
| L1071 | `ccarmy:lan-send` | 包裹 try/catch |
| L1083 | `ccarmy:lan-inbox` | 包裹 try/catch，返回 `[]` |
| L1088 | `ccarmy:lan-status` | 包裹 try/catch |

#### 执行者类（5 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1211 | `ccarmy:executor-run` | 包裹 try/catch |
| L1231 | `ccarmy:executor-batch` | 包裹 try/catch |
| L1248 | `ccarmy:assets-retrieve` | 包裹 try/catch |
| L1253 | `ccarmy:assets-register` | 包裹 try/catch |
| L1258 | `ccarmy:assets-feedback` | 包裹 try/catch |

#### 资产/审计类（8 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1263 | `ccarmy:assets-sweep` | 包裹 try/catch |
| L1319 | `ccarmy:checkpoint-auto` | 包裹 try/catch |
| L1419 | `ccarmy:executors-run-brief` | 包裹 try/catch |
| L1486 | `ccarmy:diagnostics` | 包裹 try/catch |
| L1742 | `ccarmy:ccr-tool-output` | 包裹 try/catch |
| L1838 | `ccarmy:archived-add` | 包裹 try/catch |
| L1842 | `ccarmy:archived-restore` | 包裹 try/catch |
| L1851 | `ccarmy:audit-log` | 包裹 try/catch |

#### 归档/清理/特殊模型类（8 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1855 | `ccarmy:audit-clear` | 包裹 try/catch |
| L1872 | `ccarmy:archive-external` | 包裹 try/catch |
| L1883 | `ccarmy:archive-list` | 包裹 try/catch |
| L1889 | `ccarmy:cleanup-run` | 包裹 try/catch |
| L1897 | `ccarmy:role-models-set` | 包裹 try/catch |
| L1902 | `ccarmy:role-models-get` | 包裹 try/catch |
| L1962 | `ccarmy:special-models-set` | 包裹 try/catch |
| L1970 | `ccarmy:special-models-get` | 包裹 try/catch |

#### 加入请求/黑名单类（5 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1991 | `ccarmy:join-request` | 包裹 try/catch |
| L1998 | `ccarmy:join-pending` | 包裹 try/catch，返回 `[]` |
| L2003 | `ccarmy:join-respond` | 包裹 try/catch |
| L2016 | `ccarmy:blacklist-remove` | 包裹 try/catch |
| L1770 | `ccarmy:setup-complete` | 包裹 try/catch |

#### SMTP 更新类（2 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1037 | `ccarmy:smtp-update` | 包裹 try/catch |
| L1562 | `ccarmy:open-chat-window` | 包裹 try/catch |

### 统一修复模板

```typescript
// 修复前（当前代码）：
ipcMain.handle('ccarmy:list-instances', () => p1?.instances.list() ?? []);

// 修复后：
ipcMain.handle('ccarmy:list-instances', () => {
  try {
    return p1?.instances.list() ?? [];
  } catch (e) {
    return [];
  }
});
```

**推荐策略**：写一个辅助函数减少重复代码：

```typescript
function safeHandle<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch (e) { return fallback; }
}

// 使用：
ipcMain.handle('ccarmy:list-instances', () => safeHandle(() => p1?.instances.list() ?? [], []));
```

---

## 问题 #2：innerHTML 未确认转义覆盖

**严重级别**：🟡 建议修复  
**影响**：若用户输入（消息、名称等）未经 `escapeHtml()` 转义直接插入 innerHTML，存在 XSS 风险  
**文件**：`packages/app-shell/src/renderer/app.js`  
**当前状态**：165 处 innerHTML 使用  

### 排查方法

在 `app.js` 中搜索所有 `.innerHTML =` 赋值，检查右侧是否包含用户可控变量。若变量经过 `escapeHtml()` 或 `esc()` 处则安全，否则需补转义。

### 关键检查点

| 位置 | 变量 | 是否已转义 | 修复 |
|---|---|---|---|
| 消息气泡渲染 | `msg.text` | ✅ 已用 `escapeHtml` | 无需修改 |
| 群组名称显示 | `group.name` | 需确认 | 检查 `renderList` 函数 |
| 实例名称显示 | `instance.name` | 需确认 | 检查 `renderInstances` 函数 |
| 知识库条目 | `entity.name` | 需确认 | 检查 `renderKB` 函数 |
| 搜索结果 | `result.text` | 需确认 | 检查搜索渲染函数 |

### 批量修复方案

```javascript
// 在 app.js 顶部确认 escapeHtml 存在：
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// 对所有 innerHTML 赋值中的用户可控变量包裹 escapeHtml()
// 示例修复：
el.innerHTML = '<div class="name">' + escapeHtml(userInput) + '</div>';
```

---

## 问题 #3：6 处硬编码中文（演示数据）

**严重级别**：🟡 低优先级  
**影响**：切换英文语言时，演示数据仍显示中文  
**文件**：`packages/app-shell/src/renderer/app.js`  

### 精确位置

| 行号 | 硬编码文字 | 修复方式 |
|---|---|---|
| L43 | `项目推进群` | 改为 `t('demo.project1')` 或使用 i18n key |
| L44 | `项目推进群` | 同上 |
| L45 | `研发排期群` | 改为 `t('demo.project2')` |
| L46 | `主力牛马` | 改为 `t('demo.agent')` |
| L2646 | `未勾选提醒，无提示音` | 注释文字，不影响 UI，可保留 |
| L2647 | `全局开关` | 注释文字，不影响 UI，可保留 |

### 修复代码

```javascript
// L43-46: 演示数据中的会话名称
// 修复前：
{ id: 'g-1', name: '项目推进群', kind: 'internal', ... },
{ id: 'g-2', name: '研发排期群', kind: 'internal', ... },
{ id: 'demo-1', name: '主力牛马', kind: 'single', ... },

// 修复后（使用 i18n key）：
{ id: 'g-1', nameKey: 'demo.project1', kind: 'internal', ... },
{ id: 'g-2', nameKey: 'demo.project2', kind: 'internal', ... },
{ id: 'demo-1', nameKey: 'demo.agent', kind: 'single', ... },

// 渲染时：
const displayName = s.nameKey ? t(s.nameKey) : s.name;
```

**注意**：L2646、L2647 是代码注释，不影响用户界面，无需修改。

---

## 问题 #4：148 个 IPC Handler 未分组

**严重级别**：🟡 架构建议  
**影响**：可维护性差，新开发者难以定位功能  
**文件**：`packages/app-shell/src/electron-main.ts` + `packages/app-shell/src/preload.cjs`  

### 当前状态

所有 IPC handler 使用 `ccarmy:` 前缀，但无二级命名空间。148 个 handler 平铺在一个文件中。

### 建议分组方案

```
ccarmy:win:*          窗口控制（minimize, maximize, close, reload, always-on-top）
ccarmy:instance:*     实例管理（list, spawn, stop, hardware）
ccarmy:security:*     安全模式（get, set）
ccarmy:chat:*         聊天（send, history）
ccarmy:group:*        群组（create, list, join, kick, dissolve, directed, members, invite, set-admin）
ccarmy:board:*        看板（tasks, events, aggregate, session）
ccarmy:checkpoint:*   检查点（create, list, rollback, auto）
ccarmy:knowledge:*    知识库（query, add-event, from-chat, detail）
ccarmy:metrics:*      指标（summary, turns）
ccarmy:cost:*         成本（summary）
ccarmy:settings:*     设置（get, save）
ccarmy:profile:*      账户（get, save, login, set-password）
ccarmy:provider:*     供应商（get, set）
ccarmy:email:*        邮件（queue, list, verify, add, remove, update）
ccarmy:mesh:*         Mesh 网络（start, stop, broadcast, status, peers-list, peers-remove）
ccarmy:lan:*          LAN 同步（stop, send, inbox, status）
ccarmy:smtp:*         SMTP（verify, list, add, remove, update）
ccarmy:executor:*     执行者（run, batch, run-brief）
ccarmy:assets:*       资产（retrieve, register, feedback, sweep）
ccarmy:approval:*     审批（request, respond）
ccarmy:node:*         节点（pair, revoke）
ccarmy:sync:*         同步（publish, pull）
ccarmy:skill:*        技能（list, remove, import, paths）
ccarmy:archive:*      归档（add, restore, list, external）
ccarmy:audit:*        审计（log, clear）
ccarmy:secure:*       安全存储（key-save, key-load）
ccarmy:cleanup:*      清理（run）
ccarmy:role:*         角色模型（set, get）
ccarmy:special:*      特殊模型（set, get）
ccarmy:join:*         加入请求（request, pending, respond）
ccarmy:blacklist:*    黑名单（remove）
ccarmy:export:*       导出（allowlist）
ccarmy:diag:*         诊断（run）
ccarmy:state:*        状态（save, load）
ccarmy:setup:*        引导（state, complete）
ccarmy:dsh:*          DSH（available, spawn）
ccarmy:invite:*       邀请（use）
ccarmy:tray:*         托盘（init, tooltip）
ccarmy:plugin:*       插件（install, uninstall）
ccarmy:update:*       更新（check, download）
ccarmy:i18n           国际化
ccarmy:locale:*       语言（info）
ccarmy:theme:*        主题（info, source）
ccarmy:pick:*         文件选择（file, sound）
ccarmy:app:*          应用信息（info）
ccarmy:hardware       硬件建议
```

### 迁移步骤

1. 先在 `preload.cjs` 中重命名所有 API（保持旧名兼容映射）
2. 在 `electron-main.ts` 中逐批重命名 handler 注册
3. 在 `app.js` 中逐批替换调用
4. 最后删除旧名兼容映射

**建议**：此为低优先级重构，可在功能稳定后进行。

---

## 修复优先级

| 优先级 | 问题 | 预计工时 | 风险 |
|---|---|---|---|
| P0 | #1 IPC try/catch | 2-3 小时 | 低（纯防御性代码） |
| P1 | #2 innerHTML 转义 | 1-2 小时 | 低（逐个检查） |
| P2 | #3 硬编码中文 | 10 分钟 | 极低 |
| P3 | #4 IPC 分组 | 4-6 小时 | 中（需全面回归） |

---

## 附录：审查使用的 Agent 定义来源

| Agent | 来源 | 用途 |
|---|---|---|
| Security Engineer | `agency-agents/engineering/engineering-security-engineer.md` | Electron 安全、输入验证、权限模型 |
| Code Reviewer | `agency-agents/engineering/engineering-code-reviewer.md` | 代码质量、错误处理、内存泄漏 |
| Frontend Developer | `agency-agents/engineering/engineering-frontend-developer.md` | 性能、CSP、响应式 |
| UI Designer | `agency-agents/design/design-ui-designer.md` | 设计一致性、对比度、图标规范 |
| Mobile App Builder | `agency-agents/engineering/engineering-mobile-app-builder.md` | 移动端布局、交互、安全区 |
| Software Architect | `agency-agents/engineering/engineering-software-architect.md` | 架构分层、命名空间、可维护性 |

---

*报告生成时间：2026-09-17 19:06 CST*  
*报告生成者：大龙虾 🦞*
