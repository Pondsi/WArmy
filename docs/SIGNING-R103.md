# 代码签名 / macOS 公证：2026-10 现状与免费方案

> 用户第 103 轮第 9 项：是否有办法绕过限制，或完全免费的方案。
> 结论先行：**不存在同时覆盖 Windows + macOS、对个人开源项目完全免费、且官方认可的方案**。Windows 对合资格开源项目有 $0 路线；macOS 对个人没有免费官方路线。

---

## 1. Windows

| 方案 | 成本 | 能否消除警告 | 最坏情况 |
|---|---|---|---|
| 不签名 / 自签名 | 0 | 否 | SmartScreen 强力拦截；UAC 显示“未知发布者”；自签名还要用户装根证书，公开分发不要用 |
| **SignPath Foundation**（推荐先申请） | **$0**（合资格 OSS） | 消除“未知发布者”；SmartScreen 首版仍可能提示 | 证书主体是 Foundation，不是个人；要求 OSI 许可证、无商业双许可/专有代码、可验证构建 |
| Azure Artifact Signing | 约 $9.99/月 | 不能立刻消除，要先积累声誉 | 个人仅限美国/加拿大，组织限指定国家；需付费 Azure、身份审核 |
| OV / EV 代码签名证书 | 约 $150–300 / $400+ 每年 | 不能立刻消除；EV 2024 起不再有 SmartScreen 特权 | 为 SmartScreen 买 EV 不值；私钥必须 HSM/硬件令牌 |
| Microsoft Store（MSIX） | 0 | 是 | 必须上架 Store，分发模型改变 |

**推荐**：先申请 **SignPath Foundation**。MIT 许可、公开仓库、持续发布、无商业双许可/专有代码、构建可验证，是它的目标对象。签名对象是 `WArmy.exe` 和 NSIS 安装包。

**需要准备**：公开仓库 URL、OSI 许可证、发布页、CI 工作流、维护者权限。申请通过后把签名步骤接进 GitHub Actions；仓库里不存证书私钥，用 SignPath 托管的签名服务。

---

## 2. macOS

| 方案 | 成本 | 能否消除警告 | 最坏情况 |
|---|---|---|---|
| 不签名 | 0 | 否 | arm64 可能完全不启动 |
| ad-hoc 签名（`codesign -s -` / electron-builder `identity: "-"`） | 0 | 否 | 无 Team ID、不能公证；macOS 15 起右键打开被移除；macOS 26 部分场景无法放行；自动更新不可靠 |
| **Developer ID + 公证** | **$99/年**（Apple Developer Program） | 基本消除“无法验证开发者”；首次打开仍有标准确认 | 必须付费会员；没有个人免费替代 |
| 非营利/教育/政府费用豁免 | 0 | 同上 | 仅限合法组织实体；个人/独资不符合 |

**明确回答**：

- 免费 Apple ID 只能做本机开发签名，不能做 Developer ID 分发签名/公证。
- `notarytool` 只是提交工具；提交必须有 Developer ID 和 Team ID，所以绕不开 $99/年。
- ad-hoc 只满足 arm64 的最低签名要求，能在本机运行，但**不建立发布者身份、不能公证、不能消除 Gatekeeper 警告**。
- macOS 15 起 Apple 移除了右键“打开”的快速放行；用户要去“系统设置 → 隐私与安全性 → 仍要打开”。macOS 26 有用户报告该按钮不出现/无效，不能保证放行。

**不建议**：`spctl --master-disable`、关闭 SIP、把自签名根证书装进系统信任库、伪造签名——这些会削弱整机安全，也会让用户不再信任发布物。

**无预算时的合规做法**：明确标“未公证/实验性”，提供 SHA-256（最好再加 minisign/GPG），写清“系统设置 → 隐私与安全性 → 仍要打开”的步骤和源码构建方式；不承诺自动更新，不把“校验和”说成“发布者证明”。

---

## 3. 推荐路线（按优先级）

1. **Windows P0**：申请 SignPath Foundation（$0，合资格 OSS）。
2. **macOS P1**：购买 Apple Developer Program（$99/年），用 Developer ID + `notarytool`；GitHub Actions macOS runner 可以完成签名/公证。
   - Secrets：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；或 `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。
3. **macOS P2（无预算）**：electron-builder 显式 ad-hoc（`mac.identity: "-"`、`mac.notarize: false`；25.x 语法；v27 用 `mac.sign.identity`），发布页写清未公证与放行步骤。
   - 不要用 `identity: null`：arm64 可能完全不启动。
4. **Windows P3**：合资格用 Azure Artifact Signing（约 $120/年）；否则 OV 证书，不买 EV。
5. **P4**：愿意上架 Microsoft Store 时用 MSIX（Store 重签，免费但分发模型改变）。

## 4. 需要用户提供什么

- SignPath：仓库 URL、OSI 许可证、发布页、CI 工作流、维护者权限。
- Apple：付费会员、Team ID、Developer ID `.p12` + 密码、App 专用密码或 API Key（Account Holder 操作）。
- Azure：付费订阅、Entra 租户、身份证明、符合地区；预算约 $9.99/月。
- 费用豁免：必须是合法非营利/教育/政府组织，个人不符合。

## 5. 最坏情况

- Windows：SmartScreen 或企业策略可能完全阻止；SignPath 首版仍可能提示；证书主体是 Foundation。
- macOS：未签名 arm64 可能不启动；ad-hoc 在 macOS 15/26 可能无法放行；自动更新可能被 Gatekeeper 阻断。
- 校验和只证明文件完整，不证明发布者身份；用户仍可能被假包欺骗，因此发布页要同时给源码/构建说明和官方下载入口。

---

## 来源

- Microsoft Learn：[Windows 代码签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)（2026-08-29）
- Microsoft Learn：[SmartScreen 声誉](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)（2026-08-17）
- [Azure Artifact Signing 定价](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)（2026-10 访问）
- [Azure Artifact Signing Quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)（2026-10-08）
- [SignPath Foundation](https://signpath.org/) 与 [OSS 条件](https://signpath.org/terms.html)（2026-10 访问）
- [Apple Developer ID](https://developer.apple.com/developer-id/)（2026-10 访问）
- Apple：[Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- Apple：[Developer Program 注册与年费](https://developer.apple.com/help/account/membership/program-enrollment/)
- Apple：[费用豁免](https://developer.apple.com/help/account/membership/fee-waivers/)
- Apple：[打开未识别开发者的 App](https://support.apple.com/en-us/102445)
- electron-builder：[macOS 签名](https://www.electron.build/docs/features/code-signing/code-signing-mac/) 与 [macOS 配置](https://www.electron.build/docs/mac/)
- [macOS Sequoia 移除右键放行](https://www.idownloadblog.com/2024/08/07/apple-macos-sequoia-gatekeeper-change-install-unsigned-apps-mac/)（2024-08-07）
- [Homebrew 5.0 取消 `--no-quarantine`](https://brew.sh/2025/11/12/homebrew-5.0.0/)（2025-11-12）
