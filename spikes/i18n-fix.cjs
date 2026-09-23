const fs = require('node:fs');
const f = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js';
let j = fs.readFileSync(f, 'utf8');
const rep = [
  ["username: '主人'", "username: 'nav.touXiang'"],
  ["ming: '项目推进群'", "ming: 'demo.project1'"],
  ["ming: '研发排期群'", "ming: 'demo.project2'"],
  ["ming: '客户对接群'", "ming: 'demo.client'"],
  ["ming: '主力牛马'", "ming: 'demo.agent'"],
  ["title: '整理周报'", "title: 'demo.task1'"],
  ["title: '整理周报 → 40%'", "title: 'demo.task1'"],
  ["title: '等待接口文档'", "title: 'demo.task2'"],
  ["title: '记忆库归档'", "title: 'demo.task3'"],
  ["recent: ['实例主力牛马已启动', '完成 FTS 中文检索校验']", "recent: ['demo.recent1', 'demo.recent2']"],
  ["desc: '多智能体团队编排：在会话中用自然语言驱动 AgentTeams 分工协作，适合内部群值班者派活。'", "desc: 'plugin.teams.desc'"],
  ["desc: '记忆增强：中文全文检索、工具结果去重、混合向量+FTS5、跨会话核心记忆与压缩定位。'", "desc: 'plugin.memory.desc'"],
  ["biaoQian: 'Ollama 本地'", "biaoQian: 'Ollama'"],
  ["state.nav === 'internalGroup' ? '项目群' : '外部协作群'", "state.nav === 'internalGroup' ? t('placeholder.groupName') : t('placeholder.groupNameExt')"],
  ["'牛马-' + (state.instances.length + 1)", "t('placeholder.agentName') + '-' + (state.instances.length + 1)"],
  ["(state.profile.username || '我').slice(0, 1)", "(state.profile.username || t('nav.touXiang')).slice(0, 1)"],
  ['placeholder="工作邮箱"', 'placeholder="\' + t(\'placeholder.email\') + \'"'],
  ['placeholder="节点名"', 'placeholder="\' + t(\'placeholder.nodeName\') + \'"'],
  ['placeholder="192.168.1.123 或公网IP"', 'placeholder="\' + t(\'placeholder.peerHost\') + \'"'],
  ["persona: '性格：沉稳可靠\\n角色：值班执行者\\n戒律：不泄露密钥，不越权写文件'", "persona: 'instances.personaDefault'"],
];
const missed = [];
for (const [a, b] of rep) {
  if (!j.includes(a)) missed.push(a);
  else j = j.split(a).join(b);
}
// popup key usage
j = j.replace(/\$\('smtpBiaoQian'\)\.value\.trim\(\),/, "$('smtpBiaoQian').value.trim(),");
fs.writeFileSync(f, j);
console.log('missed:', JSON.stringify(missed, null, 1));
