/**
 * P2 记忆层测试语料：覆盖 ADR §3.2 列出的每一类检索目标。
 *
 * 语料刻意让"词法通道够不着、向量通道够得着"的样本存在（m-010），
 * 以及"长 CJK 子串""ASCII 路径""错误码""1/2/3 字词"逐个可分辨。
 */

export const CORPUS = [
  // ── s1 / group-A ──────────────────────────────
  { id: 'm-001', sessionId: 's1', groupId: 'group-A', entityType: 'note', body: '无限牛马项目进度正常，值班者状态机已上线' },
  { id: 'm-002', sessionId: 's1', groupId: 'group-A', entityType: 'note', body: '错误码 E_MEMORY_CORRUPT 表示 SQLite 投影损坏，可从 JSONL 全量重建' },
  { id: 'm-003', sessionId: 's1', groupId: 'group-A', entityType: 'note', body: '实现文件 packages/memory-os/src/index.ts 新增 fts_tri 三元索引' },
  { id: 'm-004', sessionId: 's1', groupId: 'group-A', entityType: 'note', body: '构建脚本 spikes/p2-memory/run.mjs 会输出 result.json 原始数据' },
  { id: 'm-009', sessionId: 's1', groupId: 'group-A', entityType: 'note', body: '牛' },
  {
    id: 'm-010',
    sessionId: 's1',
    groupId: 'group-A',
    entityType: 'note',
    body: '值班者状态机在指定成员忙碌时自动排队并顺延到下一个空闲成员',
  },
  { id: 'm-012', sessionId: 's1', groupId: 'group-A', entityType: 'note', body: 'pnpm --filter @ccarmy/memory-os build 编译投影层' },
  { id: 'm-014', sessionId: 's1', groupId: 'group-A', entityType: 'note', body: '多智能体群聊桌面应用的定稿方案由 ADR 000 固化，十一条不变量为硬约束' },
  // ── s2 / group-B ──────────────────────────────
  { id: 'm-005', sessionId: 's2', groupId: 'group-B', entityType: 'archive', body: '外部群归档流水线 KnowledgeArchiver 处理证据锚点与双向索引' },
  { id: 'm-006', sessionId: 's2', groupId: 'group-B', entityType: 'archive', body: '群聊桌面应用支持单 AI、内部群、外部群三种群类型' },
  { id: 'm-007', sessionId: 's2', groupId: 'group-B', entityType: 'archive', body: 'E_WRITER_DENIED 执行者不能直接写 message 记录' },
  {
    id: 'm-008',
    sessionId: 's2',
    groupId: 'group-B',
    entityType: 'archive',
    body: '多智能体群聊桌面应用的记忆层采用极速层 JSONL 加深度层 SQLite 的双层设计',
  },
  {
    id: 'm-011',
    sessionId: 's2',
    groupId: 'group-B',
    entityType: 'archive',
    body: '记忆服务作为长驻子进程通过 IPC 与主进程通信，避免主进程加载原生模块',
  },
  { id: 'm-013', sessionId: 's2', groupId: 'group-B', entityType: 'archive', body: 'ELECTRON_RUN_AS_NODE=1 CCA_ARMY_MEMORY_DIR=/tmp/mem 启动子进程' },
];

/** 查询矩阵：每条都记录"预期该由哪一路命中"，用于人工/Auto 核对 */
export const QUERIES = [
  { q: '牛', kind: 'CJK-1字', expect: ['uni', 'like'] },
  { q: '牛马', kind: 'CJK-2字', expect: ['uni'] },
  { q: '状态机', kind: 'CJK-3字', expect: ['uni', 'tri'] },
  { q: '多智能体群聊', kind: 'CJK-长子串', expect: ['uni', 'tri'] },
  { q: '智能体群聊桌面应用', kind: 'CJK-长子串', expect: ['uni', 'tri'] },
  { q: '值班安排', kind: '语义（无词面重叠）', expect: ['vector'] },
  { q: 'memory-os', kind: 'ASCII-标识符', expect: ['uni', 'tri'] },
  { q: 'src/index.ts', kind: 'ASCII-路径', expect: ['uni', 'tri'] },
  { q: 'packages/memory-os/src/index.ts', kind: 'ASCII-长路径', expect: ['uni', 'tri'] },
  { q: 'E_MEMORY_CORRUPT', kind: '错误码', expect: ['uni', 'tri'] },
  { q: 'E_WRITER_DENIED', kind: '错误码', expect: ['uni', 'tri'] },
  { q: 'CCA_ARMY_MEMORY_DIR', kind: '环境变量', expect: ['uni', 'tri'] },
  { q: '--filter @ccarmy', kind: '命令行', expect: ['uni', 'tri'] },
  { q: 'JSONL 全量重建', kind: '混合（含空格）', expect: ['uni', 'tri'] },
  { q: 'zzz_not_present_zzz', kind: '完全不存在', expect: [] },
];

/** 每类目标在语料中的预期记录（词法三路之一必须命中；语义类单列在 SEMANTIC_PAIRS / 向量断言里） */
export const EXPECTED_HITS = {
  牛: ['m-009', 'm-001'],
  牛马: ['m-001'],
  状态机: ['m-001', 'm-010'],
  多智能体群聊: ['m-008', 'm-014'],
  'memory-os': ['m-003', 'm-012'],
  'src/index.ts': ['m-003'],
  'packages/memory-os/src/index.ts': ['m-003'],
  E_MEMORY_CORRUPT: ['m-002'],
  E_WRITER_DENIED: ['m-007'],
  CCA_ARMY_MEMORY_DIR: ['m-013'],
  '--filter @ccarmy': ['m-012'],
};

/** 无词面重叠、只能靠向量命中的查询（验证向量通道必要性） */
export const VECTOR_ONLY_QUERIES = [
  { q: '值班安排', expect: 'm-010' },
  { q: '子进程之间怎么通信', expect: 'm-011' },
  { q: '记忆层怎么设计', expect: 'm-008' },
];

/** 乱码/无关查询：向量通道必须有余弦地板，否则会返回一堆噪声 */
export const NOISE_QUERIES = ['zzz_not_present_zzz', '今天中午吃什么比较好', '量子纠缠与黑洞信息悖论'];

/** 语义相似度对照：用于验证嵌入质量（不是死记硬背的断言） */
export const SEMANTIC_PAIRS = [
  { a: '值班者状态机在指定成员忙碌时自动排队并顺延', b: '值班安排如何顺延到下一个空闲成员', label: 'paraphrase-值班' },
  { a: '记忆服务作为长驻子进程通过 IPC 通信', b: '子进程与主进程之间的通信方式', label: 'paraphrase-IPC' },
  { a: '记忆服务作为长驻子进程通过 IPC 通信', b: '今天中午吃什么比较好', label: 'unrelated' },
  { a: '错误码 E_MEMORY_CORRUPT 表示投影损坏', b: '数据库投影损坏的报错名', label: 'paraphrase-错误码' },
];
