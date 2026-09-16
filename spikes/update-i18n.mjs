import fs from 'node:fs';
import path from 'node:path';

const root = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/i18n';
const zhP = path.join(root, 'zh-CN.json');
const enP = path.join(root, 'en-US.json');
const zh = JSON.parse(fs.readFileSync(zhP, 'utf8'));
const en = JSON.parse(fs.readFileSync(enP, 'utf8'));

Object.assign(zh, {
  'nav.singleAi': '我的牛马',
  'nav.internalGroup': '项目',
  'nav.externalChat': '联系人',
  'nav.externalGroup': '群聊',
  'nav.instances': '牛马管理局',
  'list.addInstance': '创建牛马',
  'console.title': '控制台',
  'console.open': '控制台',
  'console.hide': '隐藏控制台',
  'chat.file': '文件',
  'chat.screenshot': '截图',
  'chat.voiceIcon': '语音',
  'urg.label': '优先级',
  'urg.P1': '加急（慎用）',
  'urg.P2': '插入',
  'urg.P3': '排队',
  'cp.title': '回退点',
  'cp.time': '节点',
  'cp.detail': '详情',
  'cp.tasks': '执行任务',
  'cp.filesChanged': '更改文件',
  'cp.filesCreated': '创建文件',
  'cp.irreversible': '不可恢复操作',
  'cp.assets': '使用资产',
  'cp.space': '节点空间',
  'cp.used': '已用',
  'cp.max': '上限',
  'cp.autoDelete': '超出后自动删除最早节点',
  'cp.load': '载入',
  'cp.stopLoad': '停止并载入',
  'cp.confirmTitle': '谨慎操作',
  'cp.confirmLoad': '将回退到该节点，当前未保存状态可能丢失。确定继续？',
  'cp.confirmStop': '将停止当前任务并回退。确定继续？',
  'model.smart': '智能选取',
  'model.allAvailable': '全部可用',
  'model.manual': '手动添加',
  'model.add': '添加',
  'model.up': '上移',
  'model.down': '下移',
  'model.chain': '调用链（异常兜底顺序）',
  'model.provider': '供应商',
  'model.pick': '选择模型',
  'embed.section': '嵌入模型',
  'embed.model': '向量模型',
  'mesh.section': '多节点组网',
  'harmony.note': '鸿蒙端外观可复用移动版布局',
});

Object.assign(en, {
  'nav.singleAi': 'My Agents',
  'nav.internalGroup': 'Projects',
  'nav.externalChat': 'Contacts',
  'nav.externalGroup': 'Groups',
  'nav.instances': 'Agent HQ',
  'list.addInstance': 'New Agent',
  'console.title': 'Console',
  'console.open': 'Console',
  'console.hide': 'Hide console',
  'chat.file': 'File',
  'chat.screenshot': 'Screenshot',
  'chat.voiceIcon': 'Voice',
  'urg.label': 'Priority',
  'urg.P1': 'Urgent',
  'urg.P2': 'Insert',
  'urg.P3': 'Queue',
  'cp.title': 'Checkpoints',
  'cp.time': 'Node',
  'cp.detail': 'Detail',
  'cp.tasks': 'Tasks',
  'cp.filesChanged': 'Changed files',
  'cp.filesCreated': 'Created files',
  'cp.irreversible': 'Irreversible',
  'cp.assets': 'Assets',
  'cp.space': 'Storage',
  'cp.used': 'Used',
  'cp.max': 'Max',
  'cp.autoDelete': 'Oldest checkpoints auto-deleted when full',
  'cp.load': 'Load',
  'cp.stopLoad': 'Stop & load',
  'cp.confirmTitle': 'Caution',
  'cp.confirmLoad': 'Rollback to this node? Unsaved work may be lost.',
  'cp.confirmStop': 'Stop current task and rollback?',
  'model.smart': 'Auto pick',
  'model.allAvailable': 'All available',
  'model.manual': 'Manual add',
  'model.add': 'Add',
  'model.up': 'Up',
  'model.down': 'Down',
  'model.chain': 'Fallback chain',
  'model.provider': 'Provider',
  'model.pick': 'Pick model',
  'embed.section': 'Embedding model',
  'embed.model': 'Vector model',
  'mesh.section': 'Multi-node mesh',
  'harmony.note': 'HarmonyOS can reuse mobile layout',
});

function save(p, o) {
  const s = {};
  Object.keys(o)
    .sort()
    .forEach((k) => (s[k] = o[k]));
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}
save(zhP, zh);
save(enP, en);
console.log('i18n', Object.keys(zh).length, Object.keys(en).length);
