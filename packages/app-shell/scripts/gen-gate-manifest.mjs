#!/usr/bin/env node
/**
 * gen-gate-manifest.mjs —— 生成/刷新 `docs/GATE-MANIFEST.json`（**门禁审计清单**）。
 *
 * 只做一件事：把 `packages/app-shell/scripts/` 下的 `verify-*.mjs` 与 `probe-*.mjs`
 * 按"能不能给别的项目直接复用"分成三类，落成一份机器可读清单：
 *   · universal —— 编码**通用工程规则**（安全/作用域/模板/沙箱/如实性/多语言/接线…），换项目照样适用；
 *   · project   —— 本项目专项（本产品的具体功能与约定）；
 *   · probe     —— 探针：会改本机状态、依赖外部服务、或只做对照实验，**刻意不进默认门禁**。
 *
 * ⚠️ 这份清单**不是**"跑一遍就知道对错"的东西 —— 归类是判断，所以要留 `why`（理由）。
 * 清单与磁盘的一致性由 `verify-gate-manifest.mjs` 双向校验（多一条少一条都判红）。
 *
 * 用法：node packages/app-shell/scripts/gen-gate-manifest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const scriptsDir = path.join(pkgRoot, 'scripts');

/** 通用门禁：任何项目都该有这一档（每条的"为什么通用"必须写清） */
const UNIVERSAL = {
  'verify-security': '路径越权 / 命令注入 / 凭据泄漏 —— 任何带文件与命令的产品都适用',
  'verify-repo-guard': '仓库守卫：坏路径、重复树、敏感文件入库',
  'verify-docs': '文档里不许出现真实用户路径与密钥',
  'verify-truth-guard': '「声称完成但本轮零工具调用」必须判出来 —— 任何 agent 产品都会踩',
  'verify-renderer-scope': 'window.__x 只读别名（有读无写）、跨作用域调用、顶层重复声明',
  'verify-renderer-template-balance': '模板字面量 / 括号配平（字符串拼 HTML 的通病）',
  'verify-template-integrity': '模板里的 ${} 不许在改动中丢失',
  'verify-import-integrity': '导入的符号必须真的存在（删了实现忘了改引用）',
  'verify-css-consistency': 'CSS 变量必须真实存在（写了 --bg 而项目只有 --card ⇒ 深底深字）',
  'verify-i18n-locales': '多语言键集合相等、占位符一致、拉丁语系不含 CJK',
  'verify-strict-language': '界面文案语言一致性（不许中英硬编码混排）',
  'verify-work-tools': '工作区沙箱：越权路径 / 超限写入一律拒绝（不是尽力而为）',
  'verify-tool-calls': '工具调用参数容错解析（截断/手写 JSON 不许把解析器报错当回复）',
  'verify-tool-call-e2e': '工具调用端到端（真跑到结果）',
  'verify-credential': '凭据派生与格式（"ID 即私钥"那一类确定性）',
  'verify-nm-format': '文件包格式：加解密与格式校验，解不开如实报错',
  'verify-identity': '身份 / 私钥派生的确定性与可恢复性',
  'verify-raf-batching': '同帧排队的回调必须全跑（rAF 节流写错的经典坑）',
  'verify-wiring': '桥接接线一致性（界面用到的 API 必须真的挂在桥上）',
  'verify-ipc-probe': 'IPC 通道白名单一致性',
  'verify-electron-app-binding': 'Electron 主进程绑定完整性',
  'verify-updater': '更新器行为',
  'verify-updater-github': '发布/更新源校验',
  'verify-runtime-errors': '真机运行期无未捕获异常',
  'verify-office-doc-suite': 'Office 生成 / 文档抽取 / 技能规范 / 凭据保管 / 门禁留档（生成→读回逐字比对）',
  'verify-gate-manifest': '门禁清单必须与磁盘一致（这份审计本身不许腐烂）',
  'verify-audio-first-class': '语音一等公民：型号必须被认成 asr/tts；只暴露 /chat/completions 的网关要有兜底；401 不许"换形状"硬试',
  'verify-research-pipeline': '调研管线：搜索条目必须带 URL、抓取要摘录、**没密钥就如实失败**（不许编结果）',
};

/**
 * **已确认红着的门禁**（本轮实测确认，**不是**本轮的回归）。
 * 为什么要登记：一份"门禁清单"如果不写清哪些当下是红的，"清单全绿"就是自欺。
 * 每一条都必须写**证据**（怎么确认的），并且**必须出现在 docs/GATE-AUDIT.md 里**
 * （由 verify-gate-manifest.mjs 强制校验）—— 免得这份状态悄悄腐烂。
 */
const YI_HONG = {
  'verify-context-renderer': '已用「换回 HEAD 的 electron-main.ts 再跑」对照证明：**失败项完全一致**（同一批 bounded-view 断言），与本轮改动无关。根因：门禁的 mock 不实现 SSE，主链路走流式解析得空正文 ⇒ 触发"逼出正文"的第二次非流式请求（一轮两条 prompt），断言按"一轮一条"写死了。',
  'verify-history-persist': '在临时 userData 里 `memory-start-failed`（记忆服务没起来）⇒ 拿不到注入 prompt 里的「道」，断言自然红。属环境依赖，与本轮改动无关。',
  'verify-tool-calls': '本轮已修 4 处 API 漂移（`renderBoundedView`→`xuanranYoujieShitu`、`runMemoryTool`→`yunxingJiyiCangGongju`、返回字段中文化、选项 `maxRounds`→`zuiDaLunShu`、mock 报文形状），**仍余约 10 项断言按旧语义写**（工具面从 2 个变 35 个、`supportsTools` 语义改了、`tool_choice` 收敛行为改了）。需按现语义重写。',
  'verify-tool-call-e2e': '19/34：桩模型场景按旧工具集/旧降级语义写的断言。与本轮改动无关（本轮只新增工具）。',
  'verify-e2e': '需要**没有别的实例在跑**（单实例锁）——桌面应用正开着时必然 "no devtools port"。属环境依赖。',
  'verify-net-ui': 'UI 联调 harness 起不来（`fetch failed`）：依赖端口/预览服务。属环境依赖。',
  'verify-qr-scan': '21/22：一条 UI 等待超时（弹窗没在 12s 内出现）。属 flaky。',
  'verify-warmy-ipc-probe': 'harness 里 `ipcRenderer` 未定义（探针壳的问题），不是产品链路问题。',
  'verify-live-ui': '真机 UI 断言（悬停提示/凭证截断显示/头像尺寸）与当前渲染实现有出入，需逐条核对后重写。',
  'verify-mobile-ui': '需要移动端 CDP 端口（`fetch failed`）。属环境依赖。',
};

/** 探针：明确**不是门禁**（会改本机状态 / 依赖外部服务 / 只做对照实验） */
const PROBE = {
  'verify-container-real': '真机 Docker 启停与镜像拉取：会改本机状态、需要网络，文件头自己写明「不要挂进 CI/门禁」',
  'probe-freeze-capability': '能力探测：跑一遍看这台机器支不支持某项能力，结论随环境变，不能当门禁',
  'probe-sound-gate-discriminates': '门禁"能失败"的对照实验：把 dist 还原成老行为再跑一遍，用来证明门禁不是摆设',
  'probe-mimo-audio': '真机语音往返：需要网络 + 真实密钥（TTS 合成 → ASR 转回逐字比对），不能当门禁',
  'probe-research-pipeline': '真机调研管线：需要网络 + 真实搜索密钥，用来一次性取证，不能当门禁',
};

/**
 * 判断这支门禁是否**需要真机 Electron**。
 *
 * ⚠️ 用**行首 import 语句**判定，不用裸正则扫全文 —— 本轮就踩了这个自伤：
 * 门禁自己的源码里写着那段正则，全文扫描会把**门禁自己**判成"需要 Electron"
 * （和"门禁文案里的示例别名被自己当成真别名"是同一类坑）。
 */
function xuYaoZhenJi(src) {
  return /^\s*import\s[^\n]*cdp-lib\.mjs['"]\s*;/m.test(src);
}

const files = fs.readdirSync(scriptsDir).filter((f) => /^(verify-|probe-).+\.mjs$/.test(f)).sort();
const rows = [];
for (const f of files) {
  const id = f.replace(/\.mjs$/, '');
  const src = fs.readFileSync(path.join(scriptsDir, f), 'utf8');
  rows.push({
    id,
    file: 'packages/app-shell/scripts/' + f,
    kind: PROBE[id] ? 'probe' : (UNIVERSAL[id] ? 'universal' : 'project'),
    /** 门禁是否需要真机 Electron（GUI 门禁不能当静态门禁跑） */
    needsElectron: xuYaoZhenJi(src),
    /** 门禁自己是否带"能失败"的自证样例 */
    selfCheck: /自证|必须能失败|反例|discriminat/.test(src),
    /** 当下状态：green / known-red（附证据，见 YI_HONG） */
    status: YI_HONG[id] ? 'known-red' : 'green',
    ...(YI_HONG[id] ? { redNote: YI_HONG[id] } : {}),
    why: PROBE[id] || UNIVERSAL[id] || '项目专项：编码本产品具体功能/约定，换项目不适用',
  });
}

const out = {
  note: '门禁审计清单：kind=universal 表示"可给其他项目直接复用"；project=本项目专项；probe=刻意不进默认门禁的探针；status=known-red 表示**当下红着**（redNote 写清证据，且必须出现在 docs/GATE-AUDIT.md）。由 packages/app-shell/scripts/verify-gate-manifest.mjs 校验与磁盘/主进程/界面一致。',
  generatedAt: new Date().toISOString(),
  counts: {
    total: rows.length,
    universal: rows.filter((r) => r.kind === 'universal').length,
    project: rows.filter((r) => r.kind === 'project').length,
    probe: rows.filter((r) => r.kind === 'probe').length,
    knownRed: rows.filter((r) => r.status === 'known-red').length,
  },
  entries: rows,
};
fs.writeFileSync(path.join(repoRoot, 'docs', 'GATE-MANIFEST.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('docs/GATE-MANIFEST.json 已刷新：' + JSON.stringify(out.counts));
console.log('通用门禁：' + rows.filter((r) => r.kind === 'universal').map((r) => r.id).join(', '));
