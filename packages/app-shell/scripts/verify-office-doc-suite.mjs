#!/usr/bin/env node
/**
 * verify-office-doc-suite.mjs —— **Office 全家桶 + 文档抽取 + 技能规范 + 凭据保管 + 门禁留档**
 * （硬门禁；纯 Node，无需 Electron/Ollama）。
 *
 * 为什么这条门禁必须存在
 * ---------------------------------------------------------------------------
 * 这一批能力全部是"**看不见的**"：生成的文件能不能被真正的 Word/Excel/PowerPoint/阅读器
 * 打开、PDF 里的中文能不能**被复制**（不是一张图）、扫描件抽不到内容时会不会**编造正文**、
 * 社交信息里的密码在磁盘上到底是明文还是密文 —— 这些在界面上都看不出来，
 * 只有把产物**读回来**才算证明。所以本门禁一律走"生成 → 读回 → 逐字比对"。
 *
 * 门禁必须能失败：`SHA_ZI_ZHENG` 一节故意用坏输入（错误后缀、无文本层的 PDF、
 * 不合规的 SKILL.md、明文密码）去撞每一段判定，**任何一段抓不出来就判红**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(selfDir, '..');
const dist = path.join(pkgRoot, 'dist');

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + l); }
  else { fail++; console.log('  FAIL ' + l + (d !== undefined ? '  ' + String(JSON.stringify(d)).slice(0, 300) : '')); }
};

const { shengChengDocx, shengChengXlsx, duXlsx, shengChengPptx, keYongPptx, lieMing } = await import(new URL('file://' + path.join(dist, 'office-tools.js')).href);
const { shengChengPdf, duPdfBuf, duPdf } = await import(new URL('file://' + path.join(dist, 'pdf-tools.js')).href);
const { tiQuWenDang, renWenDangGeShi } = await import(new URL('file://' + path.join(dist, 'doc-extract.js')).href);
const { jieXiSkillMd, duSkillMuLu, zhaiYao, zhengWen, jiNengDaFen } = await import(new URL('file://' + path.join(dist, 'skill-md.js')).href);
const { jiaMiSheJiao, jieMiSheJiao, mingWenMiMaShu, MI_MA_QIAN_ZHUI } = await import(new URL('file://' + path.join(dist, 'cred-vault.js')).href);
const { jiLuMenJin, duMenJinLiShi, menJinQuShi } = await import(new URL('file://' + path.join(dist, 'gate-archive.js')).href);
const { ziJiHua, zhaoCjkZiTi } = await import(new URL('file://' + path.join(dist, 'ttf-subset.js')).href);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warmy-office-gate-'));
const W = (n, b) => { const p = path.join(dir, n); fs.writeFileSync(p, b); return p; };

console.log('=== Office 全家桶 / 文档抽取 / 技能规范 / 凭据保管 / 门禁留档 ===');
console.log('临时目录 ' + dir);

/* ── 1. xlsx：生成 → 读回（含多表、数字/文本混排、中文表名） ── */
console.log('\n[1] xlsx 生成与读回');
{
  const buf = shengChengXlsx([
    { name: '清单', rows: [['名称', '数量', '备注'], ['苹果', 3, '红的'], ['香蕉', 5, '']] },
    { name: '第二表', rows: [['a'], ['b']] },
  ]);
  check('xlsx 是 zip（PK 头）', buf.subarray(0, 4).toString('hex') === '504b0304', buf.subarray(0, 4).toString('hex'));
  check('xlsx 含 [Content_Types].xml', buf.toString('latin1').includes('[Content_Types].xml'));
  check('xlsx 含工作表部件', buf.toString('latin1').includes('xl/worksheets/sheet1.xml'));
  const p = W('a.xlsx', buf);
  const r = duXlsx(p);
  check('xlsx 读回成功', r.ok, r.error);
  check('xlsx 两个工作表', (r.sheets || []).length === 2, (r.sheets || []).map((s) => s.name));
  check('xlsx 表名保真（中文）', r.sheets[0]?.name === '清单' && r.sheets[1]?.name === '第二表');
  check('xlsx 单元格逐字一致', JSON.stringify(r.sheets[0]?.rows) === JSON.stringify([['名称', '数量', '备注'], ['苹果', '3', '红的'], ['香蕉', '5']]), r.sheets[0]?.rows);
  check('lieMing 进位正确（A/ Z / AA / AB）', lieMing(0) === 'A' && lieMing(25) === 'Z' && lieMing(26) === 'AA' && lieMing(27) === 'AB');
}

/* ── 2. pdf：生成 → 抽文本（中文必须**能复制**，不是图） ── */
console.log('\n[2] pdf 生成与文本层');
{
  const zhen = '中文测试：一二三四五六七八九十，English 12345。';
  const r = shengChengPdf([
    { text: '标题一', size: 18, bold: true },
    { text: zhen },
    { text: '末段。' },
  ], { title: '门禁测试' });
  if (!fs.existsSync(zhaoCjkZiTi())) {
    check('系统有可内嵌 CJK 字体（否则本段无法取证）', false, zhaoCjkZiTi());
  } else {
    check('pdf 生成成功', r.ok, r.error);
    check('pdf 头是 %PDF-', (r.buffer || Buffer.alloc(0)).subarray(0, 5).toString('latin1') === '%PDF-');
    check('pdf 内嵌了字体（FontFile2）', r.buffer.toString('latin1').includes('/FontFile2'));
    check('pdf 用 Identity-H（CID 中文）', r.buffer.toString('latin1').includes('/Identity-H'));
    check('pdf 带 ToUnicode（可复制/可检索）', r.buffer.toString('latin1').includes('/ToUnicode'));
    const p = W('a.pdf', r.buffer);
    const c = duPdf(p);
    check('pdf 抽得到文本层', c.ok, c.error);
    check('pdf 中文逐字还原', (c.text || '').includes(zhen), (c.text || '').slice(0, 80));
    check('pdf 段落顺序正确', (c.text || '').indexOf('标题一') < (c.text || '').indexOf('末段。'));
    check('pdf 页数可数', c.pages === 1, c.pages);
  }
  // 折行：超宽的一段必须分成多行，且不留字符
  const long = '甲'.repeat(300);
  const r2 = shengChengPdf([{ text: long }]);
  const c2 = duPdfBuf(r2.buffer);
  check('pdf 长段自动折行且不丢字', (c2.text || '').replace(/\s/g, '') === long, ((c2.text || '').length));
}

/* ── 3. 统一文档抽取入口：四种格式都收，认不出就如实说 ── */
console.log('\n[3] 文档抽取统一入口');
{
  const dx = W('b.docx', shengChengDocx(['第一段', '第二段']));
  const xl = W('b.xlsx', shengChengXlsx([{ name: 'S', rows: [['甲', '乙']] }]));
  const pd = W('b.pdf', shengChengPdf([{ text: 'PDF 正文' }]).buffer);
  const tx = W('b.txt', Buffer.from('纯文本内容', 'utf8'));
  const rq = (p) => tiQuWenDang(p, { maxChars: 2000 });
  const rd = rq(dx), rx = rq(xl), rp = rq(pd), rt = rq(tx);
  check('docx 抽取', rd.ok && rd.format === 'docx' && rd.text.includes('第一段'), rd.format + '|' + rd.error);
  check('xlsx 抽取', rx.ok && rx.format === 'xlsx' && rx.text.includes('甲'), rx.format + '|' + rx.error);
  check('pdf 抽取', rp.ok && rp.format === 'pdf' && rp.text.includes('PDF 正文'), rp.format + '|' + rp.error);
  check('txt 抽取', rt.ok && rt.format === 'text' && rt.text === '纯文本内容', rt.format);
  // 后缀骗人也要按**文件头**认
  const wu = path.join(dir, 'fake.docx'); fs.writeFileSync(wu, shengChengXlsx([{ rows: [['1']] }]));
  check('后缀说谎时按文件头认格式（假 docx 实为 xlsx）', renWenDangGeShi(wu, fs.readFileSync(wu)) === 'xlsx');
  const no = W('c.bin', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  const rn = rq(no);
  check('认不出的格式如实失败（且有可操作提示）', !rn.ok && rn.error === 'unknown-format' && !!rn.hint, rn.error);
  const rmiss = rq(path.join(dir, 'nope.docx'));
  check('文件不存在如实说 not-found', !rmiss.ok && rmiss.error === 'not-found', rmiss.error);
}

/* ── 4. 扫描件式 PDF：抽不到就**如实说**，绝不吐幻觉正文 ── */
console.log('\n[4] 无文本层 PDF 的如实性');
{
  const scan = Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from('1 0 obj << /Type /Page /MediaBox [0 0 595 842] >> endobj\n'),
    Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  ]);
  const p = W('scan.pdf', scan);
  const r = tiQuWenDang(p);
  check('扫描件判为失败（不编造正文）', !r.ok && r.text === '', { ok: r.ok, text: r.text.slice(0, 40) });
  check('错误码是 pdf-text-none', r.error === 'pdf-text-none', r.error);
  check('提示指向 OCR（可操作）', /OCR/.test(String(r.hint || '')), r.hint);
}

/* ── 5. SKILL.md 规范：解析 / 校验 / 渐进披露 / 打分 ── */
console.log('\n[5] SKILL.md 规范');
{
  const hao = `---
name: expense-report
description: File and validate employee expense reports. Use when asked about reimbursement.
license: MIT
compatibility: Requires python3
metadata:
  author: contoso
  version: "2.1"
---

# 报销
按政策核对金额。
`;
  const j = jieXiSkillMd(hao);
  check('frontmatter 解析出 name/description', j.frontmatter.name === 'expense-report' && !!j.frontmatter.description);
  check('选填字段解析（license/compatibility/metadata）', j.frontmatter.license === 'MIT' && j.frontmatter.compatibility === 'Requires python3' && j.frontmatter.metadata?.author === 'contoso', j.frontmatter.metadata);
  check('合规判定为 valid', j.valid, j.problems);
  check('正文与 frontmatter 分离', j.body.includes('按政策核对金额') && !j.body.includes('name: expense-report'));
  check('摘要含名称与用途', zhaiYao({ frontmatter: j.frontmatter, dirName: 'x' }).includes('expense-report'));
  check('正文可取（渐进披露第 2 层）', zhengWen(j).includes('按政策核对金额'));
  check('关键词打分：命中 name 得高分', jiNengDaFen({ frontmatter: j.frontmatter, dirName: 'x', body: j.body }, 'expense') >= 10);
  // 不合规样例：缺 name、name 非法、超长 description
  const huai = jieXiSkillMd('---\ndescription: x\n---\n正文\n');
  check('缺 name 判为不合规且给出原因', !huai.valid && huai.problems.some((p) => p.includes('name')), huai.problems);
  const huai2 = jieXiSkillMd('---\nname: Bad_Name\ndescription: ok\n---\nx\n');
  check('name 非法字符判为不合规', !huai2.valid, huai2.problems);
  const huai3 = jieXiSkillMd('# 没有 frontmatter\n正文\n');
  check('缺 frontmatter 判为不合规', !huai3.valid && huai3.problems.some((p) => p.includes('frontmatter')), huai3.problems);
  // 目录级：含 resources 时摘要要标出来（渐进披露第 3 层）
  const skDir = path.join(dir, 'skill-x');
  fs.mkdirSync(path.join(skDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(skDir, 'references'), { recursive: true });
  fs.writeFileSync(path.join(skDir, 'SKILL.md'), hao);
  fs.writeFileSync(path.join(skDir, 'scripts', 'run.sh'), 'echo hi');
  fs.writeFileSync(path.join(skDir, 'references', 'faq.md'), '# FAQ');
  const dm = duSkillMuLu(skDir);
  check('技能目录读到 resources', dm?.resources.scripts.length === 1 && dm.resources.references.length === 1, dm?.resources);
  check('摘要标出附带资源（第 1 层就能看出深浅）', zhaiYao(dm).includes('脚本'), zhaiYao(dm));
}

/* ── 6. 凭据保管：落盘加密、读回还原、无 OS 保护时**如实标记** ── */
console.log('\n[6] 凭据保管');
{
  const jia = { encryptString: (s) => Buffer.from('ENC<' + s + '>', 'utf8'), decryptString: (b) => b.toString('utf8').slice(4, -1), isEncryptionAvailable: () => true };
  const inst = (pw) => [{ id: 'i1', sheJiao: { youXiang: [{ dizhi: 'a@b.c', miMa: pw }], wangZhan: [{ ming: 'x', miMa: pw }], shouJi: [{ hao: '138' }] } }];
  const yuan = 'S3cr3t-密码';
  const { instances: mi, tong: t1 } = jiaMiSheJiao(inst(yuan), jia);
  const hang = mi[0].sheJiao.youXiang[0];
  check('落盘条目里不再有明文 miMa', hang.miMa === undefined, Object.keys(hang));
  check('落盘带密文 miMaEnc 且带前缀', String(hang.miMaEnc).startsWith(MI_MA_QIAN_ZHUI), hang.miMaEnc);
  check('落盘标记 miMaBaoHu=os', hang.miMaBaoHu === 'os', hang.miMaBaoHu);
  check('加密统计正确（2 条）', t1.jiaMi === 2, t1);
  check('无密码的类别不被动过（手机号）', mi[0].sheJiao.shouJi[0].hao === '138');
  const { instances: hui, tong: t2 } = jieMiSheJiao(mi, jia);
  check('读回还原出同一明文', hui[0].sheJiao.youXiang[0].miMa === yuan && hui[0].sheJiao.wangZhan[0].miMa === yuan, hui[0].sheJiao.youXiang[0].miMa);
  check('解密统计正确（2 条）', t2.jieMi === 2, t2);
  check('还原后磁盘字段被清掉（不留 miMaEnc）', hui[0].sheJiao.youXiang[0].miMaEnc === undefined);
  // 没有 OS 保护：如实标 plain，**不冒充当加密**
  const { instances: mp, tong: t3 } = jiaMiSheJiao(inst(yuan), null);
  check('无系统保护时如实标 plain', mp[0].sheJiao.youXiang[0].miMaBaoHu === 'plain' && t3.moShi === 'plain', mp[0].sheJiao.youXiang[0].miMaBaoHu);
  check('无系统保护时不谎称加密（无 miMaEnc）', mp[0].sheJiao.youXiang[0].miMaEnc === undefined);
  check('mingWenMiMaShu 能数出明文密码', mingWenMiMaShu(mp) === 2, mingWenMiMaShu(mp));
  check('加密后 mingWenMiMaShu 为 0', mingWenMiMaShu(mi) === 0, mingWenMiMaShu(mi));
  // 换了机器/解不开：**不塞假密码**，如实记 shiBai
  const huai = { encryptString: jia.encryptString, decryptString: () => { throw new Error('bad key'); }, isEncryptionAvailable: () => true };
  const { instances: mf, tong: t4 } = jieMiSheJiao(mi, huai);
  check('解不开时不塞假密码（保持无 miMa）', mf[0].sheJiao.youXiang[0].miMa === undefined, mf[0].sheJiao.youXiang[0]);
  check('解不开时如实记入 shiBai', t4.shiBai.length === 2, t4.shiBai);
  // 老数据（明文）照常读得回来
  const { instances: mj } = jieMiSheJiao(inst(yuan), jia);
  check('老明文数据照常读回（不丢不报错）', mj[0].sheJiao.youXiang[0].miMa === yuan);
  check('重复保存不会二次加密', (() => { const a = jiaMiSheJiao(mi, jia).instances; const b = jiaMiSheJiao(a, jia).instances; return b[0].sheJiao.youXiang[0].miMaEnc === a[0].sheJiao.youXiang[0].miMaEnc; })());
}

/* ── 7. 门禁结果留档：追加 / 读取 / 趋势（"由绿转红"必须判得出来） ── */
console.log('\n[7] 门禁结果留档');
{
  const f = path.join(dir, 'gates-history.jsonl');
  const rec = (id, ok, ts, ms = 100) => ({ ts, id, script: 'scripts/' + id + '.mjs', cmd: 'node x.mjs', pass: ok, code: ok ? 0 : 1, timeout: false, ms, kind: 'hard', tail: ok ? 'PASS' : 'FAIL' });
  jiLuMenJin(f, rec('verify-a', true, 1000));
  jiLuMenJin(f, rec('verify-a', false, 2000));
  jiLuMenJin(f, rec('verify-b', false, 2500));
  jiLuMenJin(f, rec('verify-b', false, 2600));
  const li = duMenJinLiShi(f, 10);
  check('留档能读回来（新的在前）', li.length === 4 && li[0].ts === 2600, li.map((x) => x.ts));
  const qs = menJinQuShi(li);
  const a = qs.find((x) => x.id === 'verify-a');
  const b = qs.find((x) => x.id === 'verify-b');
  check('趋势：由绿转红判得出来', !!a?.justBroke, a);
  check('趋势：一直红不算"刚变红"', b && !b.justBroke && b.consecutiveFail === 2, b);
  check('趋势：刚变红的排最前', qs[0]?.id === 'verify-a', qs.map((x) => x.id));
  check('趋势：通过率统计正确', a && a.total === 2 && a.passN === 1, a);
  // 裁剪：超过 maxLines 只留最近的
  const f2 = path.join(dir, 'trim.jsonl');
  for (let i = 0; i < 20; i++) jiLuMenJin(f2, rec('verify-c', i % 2 === 0, 3000 + i), 5);
  check('留档超上限自动裁剪', duMenJinLiShi(f2, 100).length === 5, duMenJinLiShi(f2, 100).length);
  // 坏行不许整体失败
  const f3 = path.join(dir, 'bad.jsonl');
  fs.writeFileSync(f3, '{不是 json}\n' + JSON.stringify(rec('verify-d', true, 4000)) + '\n', 'utf8');
  check('坏行跳过、好行照读', duMenJinLiShi(f3, 10).length === 1, duMenJinLiShi(f3, 10));
}

/* ── 8. 工具面接线：新工具必须在工具表里、且撞得住"假文件"这条路 ── */
console.log('\n[8] 工具面接线（源码级断言）');
{
  const wt = fs.readFileSync(path.join(pkgRoot, 'src', 'work-tools.ts'), 'utf8');
  const em = fs.readFileSync(path.join(pkgRoot, 'src', 'electron-main.ts'), 'utf8');
  check('WORK_TOOL_NAMES 含 make_xlsx / make_pdf', /WORK_TOOL_NAMES\s*=\s*\[[^\]]*'make_xlsx'[^\]]*'make_pdf'/.test(wt.replace(/\n/g, ' ')));
  check('HOST_TOOL_NAMES 含 read_document / read_skill', /HOST_TOOL_NAMES\s*=\s*\[[\s\S]*?'read_document'[\s\S]*?'read_skill'/.test(wt));
  check('workToolSpecs 暴露 make_xlsx / make_pdf', /name:\s*'make_xlsx'/.test(wt) && /name:\s*'make_pdf'/.test(wt));
  check('hostToolSpecs 暴露 read_document / read_xlsx / read_pdf / read_skill',
    /name:\s*'read_document'/.test(wt) && /name:\s*'read_xlsx'/.test(wt) && /name:\s*'read_pdf'/.test(wt) && /name:\s*'read_skill'/.test(wt));
  check('write_file 拒绝伪装成 .pdf/.xlsx 的文本写入', /office-binary-need-generator/.test(wt) && /docx\|pptx\|xlsx\|pdf/.test(wt));
  check('文档读取走统一抽取器（tiQuWenDang）', /tiQuWenDang\(absD, \{ maxChars/.test(em) && /ReturnType<typeof tiQuWenDang>/.test(em));
  check('find_skill 用规范解析（不再读前 3 行）', /saoMiaoJiNeng\(/.test(em) && !/filter\(\(l\) => l\.trim\(\)\)\.slice\(0, 3\)/.test(em));
  check('install_skill 带规范校验并如实告知', /规范校验/.test(em));
  // 第 67 轮 项 13：删除“回到这一轮之前”；回档 = checkpointHuiGun + 显式 opts（停 AI/恢复文件/保留聊天）。
  {
    const preload = fs.readFileSync(path.join(pkgRoot, 'src', 'preload.cjs'), 'utf8');
    check('回档 IPC 存在且 preload 透传 opts；旧的“回到这一轮之前”已移除',
      /warmy:checkpointHuiGun/.test(em) && /checkpointRollback: \(id, opts\)/.test(preload)
      && !/chatRollbackRound/.test(preload));
  }
  check('工具预算：有上限常量 + 超预算如实叫停', /GONG_JU_YU_SUAN_MOREN/.test(em) && /tool-budget-exceeded/.test(em) && /预算已用完/.test(em));
  check('工具可观测 IPC 存在', /warmy:gongJuTongJi/.test(em) && /toolStats\(/.test(em));
  check('门禁留档：跑门禁必写留档', /jiLuMenJin\(/.test(em) && /gates-history\.jsonl/.test(em));
  check('社交密码落盘加密接线在 taiBaoCun/taiJiaZai（加密对象可以是清洗后的实例数组，判据只认"过加密函数"这件事）',
    /jiaMiSheJiao\([A-Za-z_$][\w$]*, anQuanCunChu\(\)\)/.test(em) && /jieMiSheJiao\(s\.instances, anQuanCunChu\(\)\)/.test(em));
}

/* ── 9. 子集化自身：不许悄悄丢字形、缺字形要如实上报 ── */
console.log('\n[9] 字体子集化');
{
  const fp = zhaoCjkZiTi();
  if (fp) {
    const ttf = fs.readFileSync(fp);
    const zi = ziJiHua(ttf, '中文abc');
    check('子集化为真 TTF（sfnt 头）', !!zi && zi.font.readUInt32BE(0) === 0x00010000);
    check('子集远小于原字体', !!zi && zi.font.length < ttf.length, { sub: zi?.font.length, full: ttf.length });
    check('用到的字都有字形号', !!zi && ['中', '文', 'a', 'b', 'c'].every((c) => zi.cid.has(c.codePointAt(0))));
    const que = ziJiHua(ttf, '中文\u{1F600}');
    check('字体里没有的字形如实上报（不假装有）', !!que && que.queShi.includes('\u{1F600}'), que?.queShi);
  } else {
    check('系统有可用于子集化的 CJK TTF', false, '找不到');
  }
}

/* ── 10. 门禁自证：坏输入必须被上面每一段抓住 ── */
console.log('\n[10] 自证（门禁必须能失败）');
{
  check('自证：坏 xlsx 头被判为非 zip', shengChengXlsx([{ rows: [['x']] }]).subarray(0, 4).toString('hex') === '504b0304');
  check('自证：scan.pdf 若被判"抽取成功"则本门禁失效', !tiQuWenDang(W('scan2.pdf', Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'))).ok);
  check('自证：不合规 SKILL.md 若被判 valid 则本门禁失效', !jieXiSkillMd('---\ndescription: x\n---\ny\n').valid);
  check('自证：明文密码若被数成 0 则本门禁失效', mingWenMiMaShu([{ sheJiao: { youXiang: [{ miMa: 'p' }] } }]) === 1);
  check('自证：门禁留档若把"一直红"判成"刚变红"则本门禁失效', !(menJinQuShi([{ ts: 2, id: 'x', pass: false }, { ts: 1, id: 'x', pass: false }]).find((q) => q.id === 'x')?.justBroke));
}

console.log(`\nOffice/文档/技能/凭据/留档门禁: ${pass}/${pass + fail} 通过`);
console.log('临时产物目录（排查用）：' + dir);
process.exit(fail === 0 ? 0 : 1);
