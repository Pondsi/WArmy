# R108：话筒下拉间距、重组语言失败与首启验收

## 1. 话筒下拉箭头

- 原因：话筒按钮 36px（图标 22px，左右各 7px 空白），箭头按钮 22px（图标 16px，左右各 3px），再加上工具栏 4px gap；原 `margin-left:-4px` 只抵消 gap，两个图标实际相距约 10px。
- 修复：`.yuYinDd` 左移 12px，箭头按钮宽 20px（图标 16px，左右各 2px），视觉间距约 1px；发送按钮前仍有自身间距。
- 门禁：真实 Electron 测两个 SVG 的 `getBoundingClientRect` 间距（`verify-r106-interim-ui` **21/21**）。

## 2. 「重组语言」有模型但整理失败

**真因（审计日志实锤）**：

- `special-model.used`，`lei: organizer`，`chars: 0`：模型被调用了，但返回正文为空。
- 链头是 Ollama 的 Qwen3 思考模型；整理请求没关 thinking，短文本只给 512 token，thinking 先把预算吃光，正文为空。不是“模型没启用/没配 Key”。

**修复**：

- organizer 调用 Ollama 时显式 `think:false`（其它协议不发，避免网关 400）。
- organizer 的 `maxTokens` 下限从 512 提到 2048，仍封顶 4096。
- `organizer` 检查整条启用链：第一个模型空/失败时继续试下一个；`zhengLiKeYong` 也按整条链判断，不再因为链头不可用就误灰。
- 新增审计 `special-model.empty`（记录 finishReason、reasoning 长度），不再把空正文当成“成功”。
- 真实本机验证：同一句口述返回“今天下午三点左右，我在会议室与老王讨论了项目进度，他表示下周可以交付。”，审计 `chars:35`。

## 3. 测试

- `run-verify-22 --tier=fast --times=1`：**122 项次 0 红**
- `verify-r106-interim-ui`：**21/21**（新增话筒图标间距）
- `verify-r101-changes`：**89/89**（新增重组语言静态判据）
- `verify-r104-vault`：50/50；`verify-r107-export-schedule`：19/19

## 4. 首启

- 当前测试 profile 已备份后移走，应用重建为新 profile；启动后验收首启语言页。
- 备份路径与恢复方式写在交接/最终回复；备份含真实凭据，不能上传。

## 5. 仍未完成

仍为 `HANDOFF-R107.md` §2：A 全量运行期密文/storage-core、选择性 `.nm`、稳定 Kroot、IPC/nm 最小权限、命令沙箱、更新签名、身份轮换/API key 迁移。需要外部条件/多轮迁移，不能以本轮 UI/语音修复冒充完成。
