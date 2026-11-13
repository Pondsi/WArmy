/**
 * plugin-manager —— 插件管理渲染层助手（R200）。
 *
 * 把主进程插件 IPC（安装双模式/Config/加载）封装成渲染层可用 API，供设置面板调用。
 * 对齐 cordis「一切皆插件」用户端：安装（pnpm/目录扫描）→ 启用/禁用 → Config 设置 → 独立界面（按插件设计）。
 * 依赖 preload 暴露的 window.warmy.*（R199 已暴露）。
 */
(function () {
  'use strict';
  const warmy = window.warmy;
  if (!warmy) return; // preload 未就绪则不挂载

  const api = {
    /** 目录扫描发现插件候选。 */
    async saoMiao(dirs) { return warmy.chaJianSaoMiao2 ? warmy.chaJianSaoMiao2({ dirs }) : { ok: false, error: 'ipc-missing' }; },
    /** pnpm 安装插件包（dsh 方式）。 */
    async anZhuangPnpm(pkg, profileDir) { return warmy.chaJianAnZhuangPnpm ? warmy.chaJianAnZhuangPnpm({ pkg, profileDir }) : { ok: false, error: 'ipc-missing' }; },
    /** 读已装插件的 Config 设置 schema（供设置面板渲染）。 */
    async sheZhiSchema() { return warmy.chaJianSheZhiSchema ? warmy.chaJianSheZhiSchema() : { ok: false, error: 'ipc-missing' }; },
    /** 按目录加载已装 cordis 插件。 */
    async jiaZaiYiZhuang(pluginDir, config) { return warmy.chaJianJiaZaiYiZhuang ? warmy.chaJianJiaZaiYiZhuang({ pluginDir, config }) : { ok: false, error: 'ipc-missing' }; },
    /** 直接加载 cordis 模块对象。 */
    async jiaZai(module, config) { return warmy.chaJianJiaZai ? warmy.chaJianJiaZai({ module, config }) : { ok: false, error: 'ipc-missing' }; },
    /** 渲染 Config 设置面板（按 schema 生成表单字段描述）。 */
    xuanRanSheZhiMianBan(schema) {
      const fields = [];
      for (const [key, rule] of Object.entries(schema || {})) {
        fields.push({ key, type: rule.type || 'string', required: !!rule.required, default: rule.default, description: rule.description || '' });
      }
      return fields;
    },
  };

  window.warmyPlugin = api;
})();