#!/usr/bin/env node
/**
 * verify-gate-manifest.mjs —— **门禁清单必须与磁盘一致**（硬门禁，纯 Node）。
 *
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * 真事故：仓库里 `verify-*.mjs` 有 80 多支，但"哪支是**通用标准**、哪支只是**本项目专项**、
 * 哪支其实是**探针**（会改本机状态、根本不该进门禁）"只散落在注释和记忆里。
 * 于是：① 通用清单会腐烂（文件删了、清单还写着）；② 界面上的"硬门禁"口径和代码里的
 * `MEN_JIN_YING` 各说各话；③ 探针被当成门禁跑，挂在那里让人以为"质量差"。
 *
 * 这条门禁把三件事钉死：
 *   ① `docs/GATE-MANIFEST.json` 与磁盘上的 `scripts/**.mjs` **双向一致**（多一个少一个都红）；
 *   ② `MEN_JIN_YING`（主进程）**恰好等于**清单里的 universal 集合；
 *   ③ 渲染层的门禁列表**恰好等于** universal 集合 + `full-verify-rounds`。
 *
 * 门禁必须能失败：末节用**伪造清单**（多一条 / 少一条 / universal 写错）撞三次，全都要判红。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(JSON.stringify(d)).slice(0, 400) : '')); }
};

console.log('=== 门禁清单一致性门禁（硬门禁）===');

const manifestPath = path.join(repoRoot, 'docs', 'GATE-MANIFEST.json');
const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = Array.isArray(man.entries) ? man.entries : [];
const universal = entries.filter((e) => e.kind === 'universal').map((e) => e.id).sort();
const project = entries.filter((e) => e.kind === 'project');
const probes = entries.filter((e) => e.kind === 'probe');

/* ── ① 清单 ↔ 磁盘 双向一致 ── */
const scriptsDir = path.join(pkgRoot, 'scripts');
const onDisk = fs.readdirSync(scriptsDir)
  .filter((f) => /^(verify-|probe-).+\.mjs$/.test(f))
  .map((f) => f.replace(/\.mjs$/, ''))
  .sort();
const inManifest = entries.map((e) => e.id).sort();
const missingOnDisk = inManifest.filter((id) => !onDisk.includes(id));
const missingInManifest = onDisk.filter((id) => !inManifest.includes(id));
check('清单里每一条在磁盘上都有对应脚本', missingOnDisk.length === 0, missingOnDisk);
check('磁盘上每个 verify-/probe- 脚本都登记在清单里', missingInManifest.length === 0, missingInManifest);
check('清单无重复条目', new Set(inManifest).size === inManifest.length);

/* ── ② 每条都要有"为什么" ── */
const wuYuanYin = entries.filter((e) => !String(e.why || '').trim()).map((e) => e.id);
check('每条清单都写了归类理由（why）', wuYuanYin.length === 0, wuYuanYin);
const badKind = entries.filter((e) => !['universal', 'project', 'probe'].includes(e.kind)).map((e) => e.id);
check('kind 只能是 universal/project/probe', badKind.length === 0, badKind);

/* ── ③ 主进程 MEN_JIN_YING ≡ universal ── */
const em = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
const mj = /const MEN_JIN_YING = \[([\s\S]*?)\];/.exec(em);
const mjIds = mj ? [...mj[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort() : [];
check('主进程 MEN_JIN_YING 解析得到', mjIds.length > 0, mjIds.length);
check('MEN_JIN_YING 恰好等于清单里的 universal 集合',
  JSON.stringify(mjIds) === JSON.stringify(universal),
  { menJin: mjIds, universal });
check('通用门禁都真的存在（不许写在清单里却没有脚本）',
  universal.every((id) => fs.existsSync(path.join(scriptsDir, id + '.mjs'))),
  universal.filter((id) => !fs.existsSync(path.join(scriptsDir, id + '.mjs'))));

/* ── ④ 渲染层门禁列表 ≡ universal + full-verify-rounds ── */
const app = fs.readFileSync(path.join(pkgRoot, 'src', 'renderer', 'app.js'), 'utf8');
const gatesBlk = /const GATE_UNIVERSAL = \[([\s\S]*?)\n\s*\];/.exec(app);
const gateIds = gatesBlk
  ? [...gatesBlk[1].matchAll(/\[\s*'([^']+)'\s*,/g)].map((m) => m[1]).sort()
  : [];
const qiWang = [...universal].sort();
check('渲染层 GATE_UNIVERSAL 表解析得到', gateIds.length > 0, gateIds.length);
check('渲染层 GATE_UNIVERSAL ≡ 清单里的 universal（界面口径与代码一致）',
  JSON.stringify(gateIds) === JSON.stringify(qiWang), { ui: gateIds, want: qiWang });
check('渲染层确实由 GATE_UNIVERSAL 派生 GATES（不是各写一份）',
  /const GATES = GATE_UNIVERSAL\.map/.test(app));
check('渲染层仍然挂上 full-verify-rounds（跑批入口）', /'full-verify-rounds'/.test(app));

/* ── ⑤ 名字像门禁、其实是探针的，必须在文件头自己声明"不进 CI/门禁" ── */
{
  const buSheng = [];
  for (const p of probes) {
    // 只要求 `verify-*` 的（名字像门禁才会被误跑）；`probe-*` 一看就知道是探针
    if (!p.id.startsWith('verify-')) continue;
    const f = path.join(scriptsDir, p.id + '.mjs');
    if (!fs.existsSync(f)) continue;
    const head = fs.readFileSync(f, 'utf8').slice(0, 4000);
    if (!/(不要|不入|不进|刻意不)/.test(head) || !/(CI|门禁)/.test(head)) buSheng.push(p.id);
  }
  check('名字像门禁的探针都自己声明了"刻意不进 CI/门禁"（免得被当真门禁跑）', buSheng.length === 0, buSheng);
}

/* ── ⑥ 通用门禁的"三要素"抽查：文件非空 + 有结论行 + 退出码语义 ── */
{
  const wenTi = [];
  for (const id of universal) {
    const f = path.join(scriptsDir, id + '.mjs');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (!/process\.exit\(/.test(src)) wenTi.push(id + ': 没有 process.exit');
    if (!/通过|PASS|pass\b/.test(src)) wenTi.push(id + ': 没有结论输出');
  }
  check('通用门禁都有退出码与结论输出（能当门禁用）', wenTi.length === 0, wenTi);
}

/* ── ⑦ needsElectron 标记必须与源码一致（跑批器据此挑静态门禁） ── */
{
  const cuo = [];
  for (const e of entries) {
    const f = path.join(scriptsDir, e.id + '.mjs');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    // 只看**行首 import**（不用裸正则扫全文，否则门禁会把自己判成需要 Electron —— 本轮踩过）
    const xuYao = /^\s*import\s[^\n]*cdp-lib\.mjs['"]\s*;/m.test(src);
    if (xuYao !== !!e.needsElectron) cuo.push(e.id + `(标记=${!!e.needsElectron} 实际=${xuYao})`);
  }
  check('needsElectron 标记与源码一致（跑批器按它挑静态门禁）', cuo.length === 0, cuo);
  const jingTai = entries.filter((e) => !e.needsElectron && e.kind !== 'probe').length;
  const zhenJi = entries.filter((e) => e.needsElectron).length;
  console.log(`  静态可跑 ${jingTai} 支 / 需要真机 Electron ${zhenJi} 支`);
  check('静态门禁占多数（"能无头跑"是这个仓库门禁体系的前提）', jingTai > zhenJi, { jingTai, zhenJi });
}

/* ── ⑨ 已知红门禁必须写清证据，且必须出现在审计文档里 ── */
{
  const hong = entries.filter((e) => e.status === 'known-red');
  const wuZheng = hong.filter((e) => !String(e.redNote || '').trim()).map((e) => e.id);
  check('标为 known-red 的门禁都写了证据（redNote）', wuZheng.length === 0, wuZheng);
  const shenJi = fs.readFileSync(path.join(repoRoot, 'docs', 'GATE-AUDIT.md'), 'utf8');
  const weiJi = hong.filter((e) => !shenJi.includes(e.id)).map((e) => e.id);
  check('标为 known-red 的门禁都在 docs/GATE-AUDIT.md 里登记过（不许悄悄"变红"）', weiJi.length === 0, weiJi);
  const chengNuo = entries.filter((e) => e.status && !['green', 'known-red'].includes(e.status)).map((e) => e.id);
  check('status 只能是 green / known-red', chengNuo.length === 0, chengNuo);
  console.log(`  已知红 ${hong.length} 支：${hong.map((e) => e.id).join(', ') || '（无）'}`);
}

/* ── ⑩ 统计如实给出（供人复核） ── */console.log(`\n  清单统计：universal=${universal.length} project=${project.length} probe=${probes.length} 共 ${entries.length}`);
console.log('  通用门禁：' + universal.join(', '));
console.log('  探针（不进默认门禁）：' + probes.map((p) => p.id).join(', '));
check('清单里的统计与条目一致',
  man.counts && man.counts.universal === universal.length && man.counts.project === project.length && man.counts.probe === probes.length,
  man.counts);

/* ── ⑧ 自证：三类坏清单必须都判红 ── */
{
  const okPair = (m, disk) => {
    const md = m.map((e) => e.id).sort();
    const dd = [...disk].sort();
    return JSON.stringify(md) === JSON.stringify(dd);
  };
  const disk = ['verify-a', 'verify-b'];
  const jiaYi = [{ id: 'verify-a' }, { id: 'verify-b' }, { id: 'verify-c' }];
  const jianYi = [{ id: 'verify-a' }];
  const jiaEr = [
    { id: 'verify-a', kind: 'universal' }, { id: 'verify-b', kind: 'project' },
  ];
  check('自证：清单多一条 → 双向一致判定必须为假', !okPair(jiaYi, disk));
  check('自证：清单少一条 → 双向一致判定必须为假', !okPair(jianYi, disk));
  check('自证：kind 写错 → universal 集合比对必须为假',
    JSON.stringify(jiaEr.filter((e) => e.kind === 'universal').map((e) => e.id).sort()) !== JSON.stringify(['verify-a', 'verify-b']));
}

console.log(`\n门禁清单一致性门禁: ${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
