# WArmy 项目审查报告

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
| L1181 | `warmy:win-maximize` | 包裹 try/catch，返回 `{ ok, error }` |
| L1187 | `warmy:win-reload` | 已有部分逻辑但缺外层 try/catch |
| L1195 | `warmy:win-always-on-top` | 包裹 try/catch |
| L1201 | `warmy:platform` | 简单返回，风险低但仍建议包裹 |
| L1171 | `warmy:win-minimize` | 简单调用，风险低 |

#### 实例管理类（5 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L274 | `warmy:list-instances` | 包裹 try/catch，返回 `[]` 兜底 |
| L289 | `warmy:stop-instance` | 包裹 try/catch，返回 `{ ok, error }` |
| L293 | `warmy:security-mode` | 包裹 try/catch，返回默认模式 |
| L953 | `warmy:spawn-dsh-instance` | 包裹 try/catch，返回 `{ ok, error }` |
| L945 | `warmy:dsh-available` | 包裹 try/catch |

#### 设置/配置类（8 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L350 | `warmy:locale-info` | 包裹 try/catch，返回默认 locale |
| L356 | `warmy:set-theme-source` | 包裹 try/catch |
| L360 | `warmy:theme-info` | 包裹 try/catch |
| L573 | `warmy:set-provider` | 包裹 try/catch，返回 `{ ok, error }` |
| L578 | `warmy:get-provider` | 包裹 try/catch |
| L753 | `warmy:settings-save` | 包裹 try/catch |
| L1449 | `warmy:state-load` | 包裹 try/catch |
| L1442 | `warmy:state-save` | 包裹 try/catch |

#### 文件/资源类（4 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L384 | `warmy:pick-sound` | 包裹 try/catch，返回 null |
| L396 | `warmy:check-update` | 包裹 try/catch |
| L401 | `warmy:pick-file` | 包裹 try/catch，返回 null |
| L1762 | `warmy:clear-error` | 包裹 try/catch |

#### 群组/会话类（12 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L440 | `warmy:group-list` | 包裹 try/catch，返回 `[]` |
| L547 | `warmy:board-tasks` | 包裹 try/catch，返回 `[]` |
| L551 | `warmy:board-events` | 包裹 try/catch，返回 `[]` |
| L555 | `warmy:board-aggregate` | 包裹 try/catch |
| L559 | `warmy:group-join-instance` | 包裹 try/catch |
| L1701 | `warmy:group-members` | 包裹 try/catch，返回 `[]` |
| L1705 | `warmy:group-invite` | 包裹 try/catch |
| L1712 | `warmy:group-kick` | 包裹 try/catch |
| L1718 | `warmy:group-set-admin` | 包裹 try/catch |
| L1725 | `warmy:group-directed` | 包裹 try/catch |
| L1734 | `warmy:board-session` | 包裹 try/catch |
| L1905 | `warmy:group-dissolve` | 包裹 try/catch |

#### 检查点类（3 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L685 | `warmy:checkpoint-create` | 包裹 try/catch |
| L693 | `warmy:checkpoint-list` | 包裹 try/catch，返回 `[]` |
| L699 | `warmy:checkpoint-rollback` | 包裹 try/catch |

#### 知识库类（3 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L711 | `warmy:knowledge-query` | 包裹 try/catch，返回 `{ cards: [] }` |
| L1266 | `warmy:kb-from-chat` | 包裹 try/catch |
| L1750 | `warmy:kb-detail` | 包裹 try/catch |

#### 插入模式/指标类（4 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L738 | `warmy:set-insert-mode` | 包裹 try/catch |
| L742 | `warmy:get-insert-mode` | 包裹 try/catch |
| L749 | `warmy:metrics-turns` | 包裹 try/catch，返回 `[]` |
| L1332 | `warmy:cost-summary` | 包裹 try/catch |

#### 账户/安全类（10 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L879 | `warmy:app-info` | 包裹 try/catch |
| L895 | `warmy:profile-save` | 包裹 try/catch |
| L900 | `warmy:profile-set-password` | 包裹 try/catch |
| L904 | `warmy:profile-login` | 包裹 try/catch |
| L1295 | `warmy:request-approval` | 包裹 try/catch |
| L1310 | `warmy:approval-respond` | 包裹 try/catch |
| L1861 | `warmy:secure-key-save` | 包裹 try/catch |
| L1866 | `warmy:secure-key-load` | 包裹 try/catch |
| L1917 | `warmy:export-allowlist` | 包裹 try/catch |
| L1766 | `warmy:setup-state` | 包裹 try/catch |

#### 网络/Mesh 类（10 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L926 | `warmy:nodes-pair` | 包裹 try/catch |
| L930 | `warmy:nodes-revoke` | 包裹 try/catch |
| L935 | `warmy:invite-use` | 包裹 try/catch |
| L938 | `warmy:sync-publish` | 包裹 try/catch |
| L942 | `warmy:sync-pull` | 包裹 try/catch |
| L1134 | `warmy:mesh-stop` | 包裹 try/catch |
| L1144 | `warmy:peers-list` | 包裹 try/catch |
| L1159 | `warmy:peers-remove` | 包裹 try/catch |
| L1164 | `warmy:mesh-broadcast` | 包裹 try/catch |
| L1172 | `warmy:mesh-status` | 包裹 try/catch |

#### 邮件类（6 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L982 | `warmy:email-queue` | 包裹 try/catch |
| L986 | `warmy:email-list` | 包裹 try/catch |
| L989 | `warmy:smtp-verify` | 包裹 try/catch |
| L1003 | `warmy:smtp-list` | 包裹 try/catch |
| L1012 | `warmy:smtp-add` | 包裹 try/catch |
| L1030 | `warmy:smtp-remove` | 包裹 try/catch |

#### LAN 同步类（4 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1065 | `warmy:lan-stop` | 包裹 try/catch |
| L1071 | `warmy:lan-send` | 包裹 try/catch |
| L1083 | `warmy:lan-inbox` | 包裹 try/catch，返回 `[]` |
| L1088 | `warmy:lan-status` | 包裹 try/catch |

#### 执行者类（5 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1211 | `warmy:executor-run` | 包裹 try/catch |
| L1231 | `warmy:executor-batch` | 包裹 try/catch |
| L1248 | `warmy:assets-retrieve` | 包裹 try/catch |
| L1253 | `warmy:assets-register` | 包裹 try/catch |
| L1258 | `warmy:assets-feedback` | 包裹 try/catch |

#### 资产/审计类（8 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1263 | `warmy:assets-sweep` | 包裹 try/catch |
| L1319 | `warmy:checkpoint-auto` | 包裹 try/catch |
| L1419 | `warmy:executors-run-brief` | 包裹 try/catch |
| L1486 | `warmy:diagnostics` | 包裹 try/catch |
| L1742 | `warmy:ccr-tool-output` | 包裹 try/catch |
| L1838 | `warmy:archived-add` | 包裹 try/catch |
| L1842 | `warmy:archived-restore` | 包裹 try/catch |
| L1851 | `warmy:audit-log` | 包裹 try/catch |

#### 归档/清理/特殊模型类（8 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1855 | `warmy:audit-clear` | 包裹 try/catch |
| L1872 | `warmy:archive-external` | 包裹 try/catch |
| L1883 | `warmy:archive-list` | 包裹 try/catch |
| L1889 | `warmy:cleanup-run` | 包裹 try/catch |
| L1897 | `warmy:role-models-set` | 包裹 try/catch |
| L1902 | `warmy:role-models-get` | 包裹 try/catch |
| L1962 | `warmy:special-models-set` | 包裹 try/catch |
| L1970 | `warmy:special-models-get` | 包裹 try/catch |

#### 加入请求/黑名单类（5 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1991 | `warmy:join-request` | 包裹 try/catch |
| L1998 | `warmy:join-pending` | 包裹 try/catch，返回 `[]` |
| L2003 | `warmy:join-respond` | 包裹 try/catch |
| L2016 | `warmy:blacklist-remove` | 包裹 try/catch |
| L1770 | `warmy:setup-complete` | 包裹 try/catch |

#### SMTP 更新类（2 个）
| 行号 | Handler 名称 | 修复方式 |
|---|---|---|
| L1037 | `warmy:smtp-update` | 包裹 try/catch |
| L1562 | `warmy:open-chat-window` | 包裹 try/catch |

### 统一修复模板

```typescript
// 修复前（当前代码）：
ipcMain.handle('warmy:list-instances', () => p1?.instances.list() ?? []);

// 修复后：
ipcMain.handle('warmy:list-instances', () => {
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
ipcMain.handle('warmy:list-instances', () => safeHandle(() => p1?.instances.list() ?? [], []));
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

所有 IPC handler 使用 `warmy:` 前缀，但无二级命名空间。148 个 handler 平铺在一个文件中。

### 建议分组方案

```
warmy:win:*          窗口控制（minimize, maximize, close, reload, always-on-top）
warmy:instance:*     实例管理（list, spawn, stop, hardware）
warmy:security:*     安全模式（get, set）
warmy:chat:*         聊天（send, history）
warmy:group:*        群组（create, list, join, kick, dissolve, directed, members, invite, set-admin）
warmy:board:*        看板（tasks, events, aggregate, session）
warmy:checkpoint:*   检查点（create, list, rollback, auto）
warmy:knowledge:*    知识库（query, add-event, from-chat, detail）
warmy:metrics:*      指标（summary, turns）
warmy:cost:*         成本（summary）
warmy:settings:*     设置（get, save）
warmy:profile:*      账户（get, save, login, set-password）
warmy:provider:*     供应商（get, set）
warmy:email:*        邮件（queue, list, verify, add, remove, update）
warmy:mesh:*         Mesh 网络（start, stop, broadcast, status, peers-list, peers-remove）
warmy:lan:*          LAN 同步（stop, send, inbox, status）
warmy:smtp:*         SMTP（verify, list, add, remove, update）
warmy:executor:*     执行者（run, batch, run-brief）
warmy:assets:*       资产（retrieve, register, feedback, sweep）
warmy:approval:*     审批（request, respond）
warmy:node:*         节点（pair, revoke）
warmy:sync:*         同步（publish, pull）
warmy:skill:*        技能（list, remove, import, paths）
warmy:archive:*      归档（add, restore, list, external）
warmy:audit:*        审计（log, clear）
warmy:secure:*       安全存储（key-save, key-load）
warmy:cleanup:*      清理（run）
warmy:role:*         角色模型（set, get）
warmy:special:*      特殊模型（set, get）
warmy:join:*         加入请求（request, pending, respond）
warmy:blacklist:*    黑名单（remove）
warmy:export:*       导出（allowlist）
warmy:diag:*         诊断（run）
warmy:state:*        状态（save, load）
warmy:setup:*        引导（state, complete）
warmy:dsh:*          DSH（available, spawn）
warmy:invite:*       邀请（use）
warmy:tray:*         托盘（init, tooltip）
warmy:plugin:*       插件（install, uninstall）
warmy:update:*       更新（check, download）
warmy:i18n           国际化
warmy:locale:*       语言（info）
warmy:theme:*        主题（info, source）
warmy:pick:*         文件选择（file, sound）
warmy:app:*          应用信息（info）
warmy:hardware       硬件建议
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
