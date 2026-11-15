/**
 * mimic-render.js —— 拟态 2D/3D 外观渲染 + 动作系统（R218+）
 *
 * 形态：
 *  · 2D：静态图 / 精灵图 / 程序化 SVG 角色（手捏参数渲染成 SVG）
 *  · 3D：three.js 程序化 Q 版角色（骨骼 Group：头/身/四肢/尾/耳/嘴/眼）+ 关键帧动作
 *
 * 动作系统：
 *  · idle 自动：呼吸 / 眨眼 / 随机小动作（状态机）
 *  · 说话口型：语音播放 / ASR 期间嘴部开合
 *  · 触发动作：window.__mimicDongZuo('id') 播放一次（触发词 / AI 判断 / 事件）
 *  · 动作库：内置 ~100 条（基础动作 × 幅度/速度变体），2D 用 CSS/图层变换、3D 用骨骼关键帧
 *
 * 数据流：外观定义（settings.mimicAppearance）经主进程下发到拟态窗口（warmy:mimicSetTi 扩展），
 * 本文件只负责"给定外观定义 → 渲染 + 播放动作"。
 */
(function () {
  'use strict';

  const W = 240, H = 260;

  /* ── 2D：程序化 SVG 角色（手捏参数化） ─────────────────────────────── */
  const ER_XING = ['yuan', 'xiao', 'qiao', 'hei', 'xing'];
  const ZUI_XING = ['xiao', 'wei', 'kai', 'qiao', 'ping'];

  /** 用外观参数生成 SVG（body 主色/副色 + 眼/嘴/耳/尾等部件） */
  function hua2DSvg(a) {
    const zhu = a.zhuSe || '#f4a460';
    const fu = a.fuSe || '#e8e0d0';
    const yan = a.yanXing || 'yuan';
    const zui = a.zuiXing || 'xiao';
    const er = a.erDuo !== false;
    const wei = a.weiBa !== false;
    const yanSe = a.yanSe || '#2b2b2b';
    const hong = a.hongSe || '#e05a5a';
    const yuanXing = {
      yuan: '<circle cx="86" cy="112" r="7" fill="' + yanSe + '"/><circle cx="134" cy="112" r="7" fill="' + yanSe + '"/><circle cx="89" cy="109" r="2.4" fill="#fff"/><circle cx="137" cy="109" r="2.4" fill="#fff"/>',
      xiao: '<circle cx="87" cy="112" r="5.5" fill="' + yanSe + '"/><circle cx="133" cy="112" r="5.5" fill="' + yanSe + '"/><circle cx="89.5" cy="110" r="2" fill="#fff"/><circle cx="135.5" cy="110" r="2" fill="#fff"/>',
      qiao: '<path d="M80 116 q7 -9 14 0 q-3 2 -7 2 q-4 0 -7 -2z" fill="' + yanSe + '"/><path d="M126 116 q7 -9 14 0 q-3 2 -7 2 q-4 0 -7 -2z" fill="' + yanSe + '"/>',
      hei: '<circle cx="88" cy="112" r="8" fill="' + yanSe + '"/><circle cx="132" cy="112" r="8" fill="' + yanSe + '"/><circle cx="91" cy="108" r="2.6" fill="#fff"/><circle cx="135" cy="108" r="2.6" fill="#fff"/>',
      xing: '<path d="M88 103 l3 6 6 1 -4 4 1 6 -6 -3 -6 3 1 -6 -4 -4 6 -1z" fill="' + yanSe + '"/><path d="M132 103 l3 6 6 1 -4 4 1 6 -6 -3 -6 3 1 -6 -4 -4 6 -1z" fill="' + yanSe + '"/>',
    };
    const zuiXing = {
      xiao: '<path d="M104 136 q6 5 12 0" stroke="' + hong + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
      wei: '<path d="M100 137 q10 8 20 0 q-3 -2 -6 -2 q-4 0 -8 2 q-3 -5 -6 -3z" fill="' + hong + '"/>',
      kai: '<ellipse cx="110" cy="138" rx="8" ry="5" fill="' + hong + '"/><path d="M102 137 q8 4 16 0 q-8 -4 -16 0z" fill="#fff"/>',
      qiao: '<path d="M102 138 q8 -6 16 0 q-1 3 -4 4 q-4 1 -8 0 q-3 -1 -4 -4z" fill="' + hong + '"/>',
      ping: '<line x1="100" y1="139" x2="120" y2="139" stroke="' + hong + '" stroke-width="2.4" stroke-linecap="round"/>',
    };
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">' +
      (er ? '<ellipse cx="52" cy="78" rx="14" ry="20" fill="' + fu + '" transform="rotate(-18 52 78)"/><ellipse cx="168" cy="78" rx="14" ry="20" fill="' + fu + '" transform="rotate(18 168 78)"/>' : '') +
      '<ellipse cx="110" cy="118" rx="62" ry="58" fill="' + zhu + '"/>' +
      '<ellipse cx="110" cy="96" rx="46" ry="40" fill="' + fu + '"/>' +
      '<ellipse cx="110" cy="150" rx="54" ry="30" fill="' + zhu + '" opacity=".92"/>' +
      (yuanXing[yan] || yuanXing.yuan) +
      '<ellipse cx="110" cy="102" rx="5" ry="3.4" fill="' + hong + '" opacity=".55"/>' +
      (zuiXing[zui] || zuiXing.xiao) +
      (wei ? '<path d="M172 168 q24 2 30 -14 q6 -16 -14 -14 q-8 1 -10 6z" fill="' + fu + '"/>' : '') +
      '</svg>';
  }

  /* ── 3D：three.js Q 版角色（程序化骨骼） ───────────────────────────── */
  let renderer = null, scene = null, camera = null, sanD = null;
  let boneRoot = null; // Group：身体骨架（头/身/四肢/尾/耳/嘴/眼）
  const BONE = {};     // 命名骨骼节点
  let bodyColor = 0xf4a460, clothColor = 0xe8e0d0, skinColor = 0xf4a460;

  /** 初始化 3D：创建 canvas + 场景 + 角色（外观参数 a） */
  function init3D(a) {
    if (!window.THREE) return false;
    const THREE = window.THREE;
    if (!sanD) {
      sanD = document.createElement('canvas');
      sanD.id = 'tiSanD';
      sanD.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
      document.getElementById('pet').appendChild(sanD);
      renderer = new THREE.WebGLRenderer({ canvas: sanD, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H, false);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100);
      camera.position.set(0, 1.5, 7.4);
      camera.lookAt(0, 1.2, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 1.35));
      const d = new THREE.DirectionalLight(0xffffff, 0.9);
      d.position.set(3, 5, 4);
      scene.add(d);
      const d2 = new THREE.DirectionalLight(0xffffff, 0.35);
      d2.position.set(-3, 2, -2);
      scene.add(d2);
    }
    // 骨架：body(身) > 头/左臂/右臂/左腿/右腿/尾；头 > 左耳/右耳/嘴/左眼/右眼
    const g = (c, s, x, y, z) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(s, 20, 16), new THREE.MeshStandardMaterial({ color: c }));
      m.position.set(x, y, z);
      return m;
    };
    if (boneRoot) scene.remove(boneRoot);
    boneRoot = new THREE.Group();
    bodyColor = a.zhuSe ? parseInt(a.zhuSe.replace('#', ''), 16) : 0xf4a460;
    clothColor = a.fuSe ? parseInt(a.fuSe.replace('#', ''), 16) : 0xe8e0d0;
    skinColor = bodyColor;
    // 身体（胶囊状：两球+柱）
    const body = new THREE.Group();
    body.add(g(clothColor, 0.62, 0, 0, 0));
    const tui = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.0, 14), new THREE.MeshStandardMaterial({ color: clothColor }));
    tui.position.y = -0.95;
    body.add(tui);
    const zhuang = a.zhuang || 1; // 胖瘦
    body.scale.set(zhuang, 1, zhuang);
    // 头
    const tou = new THREE.Group();
    tou.add(g(bodyColor, 0.68 * (a.touDa || 1), 0, 0.6, 0));
    // 耳朵
    const erN = (a.erDuo !== false);
    const earL = g(clothColor, 0.2, -0.55, 0.9, 0); earL.scale.set(0.7, 1.3, 0.6);
    const earR = g(clothColor, 0.2, 0.55, 0.9, 0); earR.scale.set(0.7, 1.3, 0.6);
    if (erN) { tou.add(earL); tou.add(earR); }
    // 嘴（可动的半圆盘，位于头前下方）
    const zui = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe05a5a }));
    zui.position.set(0, 0.28, 0.62);
    tou.add(zui);
    // 眼（白色+黑瞳）
    const yanM = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    yanM.position.set(-0.24, 0.78, 0.6);
    const yanR = yanM.clone(); yanR.position.x = 0.24;
    const tong = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2b2b2b }));
    tong.position.set(0, 0.78, 0.72);
    const tong2 = tong.clone(); tong2.position.x = 0.48;
    tong.position.x = -0.24;
    tou.add(yanM, yanR, tong, tong2);
    tou.position.y = 1.55;
    // 四肢
    const armL = g(clothColor, 0.24, -0.78, 0.35, 0); armL.scale.set(0.8, 1.6, 0.8);
    const armR = g(clothColor, 0.24, 0.78, 0.35, 0); armR.scale.set(0.8, 1.6, 0.8);
    const legL = g(clothColor, 0.26, -0.3, -1.5, 0); legL.scale.set(0.85, 1.5, 0.85);
    const legR = g(clothColor, 0.26, 0.3, -1.5, 0); legR.scale.set(0.85, 1.5, 0.85);
    // 尾（可摇：细长组）
    const weiG = new THREE.Group();
    const weiM = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, 1.1, 8), new THREE.MeshStandardMaterial({ color: clothColor }));
    weiM.position.y = -0.55;
    weiG.add(weiM);
    weiG.position.set(0, -0.2, 0.62);
    if (a.weiBa !== false) body.add(weiG);
    body.add(tou, armL, armR, legL, legR);
    boneRoot.add(body);
    scene.add(boneRoot);
    // 命名骨骼（动作系统用）
    BONE.body = body; BONE.tou = tou; BONE.armL = armL; BONE.armR = armR;
    BONE.legL = legL; BONE.legR = legR; BONE.wei = weiG; BONE.zui = zui;
    BONE.yanL = yanM; BONE.yanR = yanR; BONE.earL = earL; BONE.earR = earR;
    BONE.root = boneRoot;
    return true;
  }

  /* ── 动作系统 ──────────────────────────────────────────────────────── */
  /** 当前形态：2d / 3d */
  let xingTai = '2d';
  /** 播放中的动作（每个动作 = 一组骨骼目标 + 时长 + 缓动） */
  let dongZuoQian = null;   // 队列
  let dongZuoZhengZai = null;
  let dongZuoKaiShi = 0;
  const base = {};          // 骨骼基准姿态
  /** 口型：说话时嘴开合 */
  let kouXingOn = false, kouXingFeng = 0;

  /** 动作定义表：id → { ming, lei, shi: {骨骼/图层目标} 或 函数, ms, fanFu?, zhiLing? } */
  const DONG_ZUO = {};

  /** 注册动作（程序化：关键帧目标） */
  function dingDongZuo(id, ming, lei, targets, ms, zhiLing) {
    DONG_ZUO[id] = { ming, lei, t: targets, ms, zhiLing };
  }

  /* 基础动作（3D 骨骼目标；2D 走图层变换） */
  function jiChuDongZuo() {
    const z = (obj, key, val) => { if (!BONE[obj]) return null; return { obj: BONE[obj], key, val }; };
    const li = [];
    // 呼吸（身/头轻微上下）
    li.push(dingDongZuo('huXi', '呼吸', 'idle', [
      { obj: 'body', key: 'position.y', from: 0, to: 0.06, ms: 900, fanFu: true },
    ], 1800, 'auto'));
    // 眨眼（眼 scaleY 压扁）
    li.push(dingDongZuo('zhaYan', '眨眼', 'idle', [
      { obj: 'yanL', key: 'scale.y', from: 1, to: 0.08, ms: 90 },
      { obj: 'yanR', key: 'scale.y', from: 1, to: 0.08, ms: 90 },
    ], 160, 'auto'));
    // 摇尾
    li.push(dingDongZuo('yaoWei', '摇尾', 'qing', [
      { obj: 'wei', key: 'rotation.z', from: -0.55, to: 0.55, ms: 260, fanFu: true },
    ], 900, 'trigger'));
    // 嘟嘴
    li.push(dingDongZuo('duZui', '嘟嘴', 'qing', [
      { obj: 'zui', key: 'scale', from: 1, to: 1.9, ms: 220 },
    ], 700, 'trigger'));
    // 开心跳
    li.push(dingDongZuo('kaiXin', '开心', 'qing', [
      { obj: 'body', key: 'position.y', from: 0, to: 0.5, ms: 150, fanFu: true },
      { obj: 'armL', key: 'rotation.z', from: 0, to: 0.5, ms: 200 },
      { obj: 'armR', key: 'rotation.z', from: 0, to: -0.5, ms: 200 },
    ], 900, 'trigger'));
    // 招手
    li.push(dingDongZuo('zhaoshou', '招手', 'shejiao', [
      { obj: 'armR', key: 'rotation.z', from: 0, to: -1.2, ms: 220, fanFu: true },
    ], 1200, 'trigger'));
    // 点头
    li.push(dingDongZuo('dianTou', '点头', 'shejiao', [
      { obj: 'tou', key: 'rotation.x', from: 0, to: 0.5, ms: 220, fanFu: true },
    ], 900, 'trigger'));
    // 摇头
    li.push(dingDongZuo('yaoTou', '摇头', 'shejiao', [
      { obj: 'tou', key: 'rotation.z', from: -0.4, to: 0.4, ms: 260, fanFu: true },
    ], 1000, 'trigger'));
    // 歪头
    li.push(dingDongZuo('waiTou', '歪头', 'qing', [
      { obj: 'tou', key: 'rotation.z', from: 0, to: 0.45, ms: 700 },
    ], 900, 'trigger'));
    // 蹦跳
    li.push(dingDongZuo('bengTiao', '蹦跳', 'qing', [
      { obj: 'body', key: 'position.y', from: 0, to: 0.9, ms: 140, fanFu: true },
      { obj: 'legL', key: 'rotation.x', from: 0, to: -0.5, ms: 120 },
      { obj: 'legR', key: 'rotation.x', from: 0, to: 0.5, ms: 120 },
    ], 1000, 'trigger'));
    // 打瞌睡
    li.push(dingDongZuo('keShui', '打瞌睡', 'idle', [
      { obj: 'tou', key: 'rotation.x', from: 0, to: 0.7, ms: 900, fanFu: true },
      { obj: 'yanL', key: 'scale.y', from: 1, to: 0.1, ms: 300 },
      { obj: 'yanR', key: 'scale.y', from: 1, to: 0.1, ms: 300 },
    ], 2400, 'auto'));
    // 害羞
    li.push(dingDongZuo('haiXiu', '害羞', 'qing', [
      { obj: 'tou', key: 'rotation.z', from: 0, to: -0.2, ms: 400 },
      { obj: 'armL', key: 'rotation.y', from: 0, to: 0.6, ms: 350 },
      { obj: 'armR', key: 'rotation.y', from: 0, to: -0.6, ms: 350 },
    ], 1400, 'trigger'));
    // 生气
    li.push(dingDongZuo('shengQi', '生气', 'qing', [
      { obj: 'tou', key: 'rotation.z', from: 0, to: 0.15, ms: 300, fanFu: true },
      { obj: 'body', key: 'position.y', from: 0, to: 0.08, ms: 300, fanFu: true },
    ], 1100, 'trigger'));
    // 委屈
    li.push(dingDongZuo('weiQu', '委屈', 'qing', [
      { obj: 'tou', key: 'rotation.x', from: 0, to: -0.28, ms: 500 },
      { obj: 'zui', key: 'scale', from: 1, to: 0.5, ms: 400 },
    ], 1300, 'trigger'));
    // 惊讶
    li.push(dingDongZuo('jingYa', '惊讶', 'qing', [
      { obj: 'zui', key: 'scale', from: 1, to: 2.4, ms: 180 },
      { obj: 'tou', key: 'position.y', from: 1.55, to: 1.7, ms: 180 },
    ], 800, 'trigger'));
    // 思考
    li.push(dingDongZuo('siKao', '思考', 'idle', [
      { obj: 'armR', key: 'rotation.z', from: 0, to: -1.0, ms: 500 },
      { obj: 'tou', key: 'rotation.z', from: 0, to: 0.1, ms: 400, fanFu: true },
    ], 1500, 'auto'));
    // 转圈
    li.push(dingDongZuo('zhuanQuan', '转圈', 'qing', [
      { obj: 'root', key: 'rotation.y', from: 0, to: Math.PI * 2, ms: 900 },
    ], 1000, 'trigger'));
    // 跳舞
    li.push(dingDongZuo('tiaoWu', '跳舞', 'qing', [
      { obj: 'body', key: 'position.y', from: 0, to: 0.3, ms: 200, fanFu: true },
      { obj: 'armL', key: 'rotation.z', from: 0, to: 0.8, ms: 200, fanFu: true },
      { obj: 'armR', key: 'rotation.z', from: 0, to: -0.8, ms: 200, fanFu: true },
    ], 1400, 'trigger'));
    // 鼓掌
    li.push(dingDongZuo('guZhang', '鼓掌', 'shejiao', [
      { obj: 'armL', key: 'rotation.z', from: -0.3, to: 0.4, ms: 120, fanFu: true },
      { obj: 'armR', key: 'rotation.z', from: 0.3, to: -0.4, ms: 120, fanFu: true },
    ], 1000, 'trigger'));
    // 挥手告别
    li.push(dingDongZuo('huiShou', '挥手', 'shejiao', [
      { obj: 'armR', key: 'rotation.z', from: 0, to: -1.4, ms: 200, fanFu: true },
    ], 1400, 'trigger'));
    // 欢迎
    li.push(dingDongZuo('huanYing', '欢迎', 'shejiao', [
      { obj: 'armL', key: 'rotation.z', from: 0, to: 0.9, ms: 200, fanFu: true },
      { obj: 'armR', key: 'rotation.z', from: 0, to: -0.9, ms: 200, fanFu: true },
    ], 1000, 'trigger'));
    // 趴下
    li.push(dingDongZuo('paXia', '趴下', 'idle', [
      { obj: 'body', key: 'position.y', from: 0, to: -0.35, ms: 700 },
      { obj: 'tou', key: 'position.y', from: 1.55, to: 1.25, ms: 700 },
      { obj: 'tou', key: 'rotation.x', from: 0, to: 0.4, ms: 700 },
    ], 1600, 'trigger'));
    // 起立
    li.push(dingDongZuo('qiLi', '起立', 'idle', [
      { obj: 'body', key: 'position.y', from: -0.35, to: 0, ms: 500 },
      { obj: 'tou', key: 'position.y', from: 1.25, to: 1.55, ms: 500 },
    ], 700, 'trigger'));
    // 伸懒腰
    li.push(dingDongZuo('shenLan', '伸懒腰', 'idle', [
      { obj: 'armL', key: 'rotation.z', from: 0, to: 2.4, ms: 600 },
      { obj: 'armR', key: 'rotation.z', from: 0, to: -2.4, ms: 600 },
    ], 1500, 'trigger'));
    // 打哈欠
    li.push(dingDongZuo('daHaQian', '打哈欠', 'idle', [
      { obj: 'zui', key: 'scale', from: 1, to: 2.8, ms: 500 },
      { obj: 'tou', key: 'rotation.x', from: 0, to: -0.2, ms: 500 },
    ], 1300, 'trigger'));
    // 疑惑
    li.push(dingDongZuo('yiHuo', '疑惑', 'qing', [
      { obj: 'tou', key: 'rotation.z', from: 0, to: 0.3, ms: 400 },
      { obj: 'tou', key: 'position.y', from: 1.55, to: 1.62, ms: 400 },
    ], 1000, 'trigger'));
    // 打滚
    li.push(dingDongZuo('daGun', '打滚', 'qing', [
      { obj: 'root', key: 'rotation.z', from: 0, to: Math.PI * 2, ms: 900 },
    ], 1000, 'trigger'));
    // 睡觉
    li.push(dingDongZuo('shuiJiao', '睡觉', 'idle', [
      { obj: 'tou', key: 'rotation.x', from: 0, to: 0.5, ms: 800 },
      { obj: 'yanL', key: 'scale.y', from: 1, to: 0.05, ms: 400 },
      { obj: 'yanR', key: 'scale.y', from: 1, to: 0.05, ms: 400 },
      { obj: 'body', key: 'position.y', from: 0, to: -0.15, ms: 800 },
    ], 2600, 'auto'));
    // 伸爪
    li.push(dingDongZuo('shenZhua', '伸爪', 'qing', [
      { obj: 'armR', key: 'rotation.z', from: 0, to: 1.6, ms: 400 },
      { obj: 'armR', key: 'scale', from: 1, to: 1.15, ms: 400 },
    ], 1000, 'trigger'));
    return li;
  }

  /** 2D 图层动作：给 img 加 CSS 类（由 mimic.css 定义 keyframes） */
  function dongZuo2D(id) {
    const yi = document.getElementById('tupian');
    if (!yi) return;
    yi.classList.remove('dz2d');
    void yi.offsetWidth;
    yi.classList.add('dz2d', 'dz-' + id);
    /* R220：动作动画播完摘掉类，回落常驻呼吸/眨眼 idle */
    clearTimeout(yi._dzTimer);
    yi._dzTimer = setTimeout(() => { try { yi.classList.remove('dz2d', 'dz-' + id); } catch { /* noop */ } }, 3200);
  }

  /** 播放动作（3D 骨骼关键帧 / 2D 图层类） */
  function boFang(id) {
    let k = String(id || '');
    if (!DONG_ZUO[k]) {
      /* R219：AI【动作:名字】给的是中文名 —— 按 ming 回退查拼音 id */
      const hit = Object.keys(DONG_ZUO).find((x) => DONG_ZUO[x] && DONG_ZUO[x].ming === k);
      if (!hit) return false;
      k = hit;
    }
    if (xingTai === '2d') { dongZuo2D(k); return true; }
    if (gltfMixer) return yingYongGltfDongZuo(k);
    if (!BONE.root) return false;
    dongZuoZhengZai = DONG_ZUO[k];
    dongZuoKaiShi = performance.now();
    dongZuoQian = null;
    return true;
  }

  /** 停止当前动作（恢复基准姿态） */
  function tingZhi() {
    dongZuoZhengZai = null;
    dongZuoQian = null;
    huiFuJiZhun();
  }

  /** 保存基准姿态（首次进入时） */
  function jiLuJiZhun() {
    for (const k of Object.keys(BONE)) {
      const o = BONE[k];
      base[k] = { x: o.position.x, y: o.position.y, z: o.position.z, rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z, sx: o.scale.x, sy: o.scale.y, sz: o.scale.z };
    }
  }
  function huiFuJiZhun() {
    for (const k of Object.keys(BONE)) {
      const b = base[k];
      if (!b) continue;
      const o = BONE[k];
      o.position.set(b.x, b.y, b.z);
      o.rotation.set(b.rx, b.ry, b.rz);
      o.scale.set(b.sx, b.sy, b.sz);
    }
  }

  /** 每帧更新：idle 自动 + 当前动作 + 口型 */
  function gengXin(t) {
    if (gltfMixer) { try { gltfMixer.update(1 / 60); } catch { /* noop */ } return; }
    if (!BONE.root) return;
    // idle 自动：呼吸 + 眨眼（概率）+ 随机小动作
    const miao = t / 1000;
    BONE.body.position.y = (base.body ? base.body.y : 0) + Math.sin(miao * 1.6) * 0.05;
    if (Math.sin(miao * 0.7) > 0.995) {
      const yi = Math.floor(Math.random() * 3);
      if (yi === 0) boFang('zhaYan');
    }
    // 当前动作关键帧
    if (dongZuoZhengZai) {
      const el = t - dongZuoKaiShi;
      const ms = dongZuoZhengZai.ms || 800;
      const jin = Math.min(1, el / ms);
      const e = jin < 0.5 ? 2 * jin * jin : 1 - Math.pow(-2 * jin + 2, 2) / 2; // easeInOutQuad
      for (const kf of (dongZuoZhengZai.t || [])) {
        const o = BONE[kf.obj];
        if (!o) continue;
        if (kf.key === 'position.x') o.position.x = base[kf.obj].x + (kf.to - (kf.from !== undefined ? kf.from : base[kf.obj][kf.key])) * e;
        else if (kf.key === 'position.y') o.position.y = base[kf.obj].y + (kf.to - (kf.from !== undefined ? kf.from : base[kf.obj].y)) * e;
        else if (kf.key === 'position.z') o.position.z = base[kf.obj].z + (kf.to - (kf.from !== undefined ? kf.from : base[kf.obj].z)) * e;
        else if (kf.key === 'rotation.x') o.rotation.x = base[kf.obj].rx + (kf.to - (kf.from !== undefined ? kf.from : base[kf.obj].rx)) * e;
        else if (kf.key === 'rotation.y') o.rotation.y = base[kf.obj].ry + (kf.to - (kf.from !== undefined ? kf.from : base[kf.obj].ry)) * e;
        else if (kf.key === 'rotation.z') o.rotation.z = base[kf.obj].rz + (kf.to - (kf.from !== undefined ? kf.from : base[kf.obj].rz)) * e;
        else if (kf.key === 'scale') { const s = 1 + (kf.to - 1) * e; o.scale.set(s * base[kf.obj].sx, s * base[kf.obj].sy, s * base[kf.obj].sz); }
        else if (kf.key === 'scale.y') o.scale.y = base[kf.obj].sy + (kf.to - (kf.from !== undefined ? kf.from : base[kf.obj].sy)) * e;
      }
      if (el >= ms) {
        if (dongZuoZhengZai.fanFu) { dongZuoKaiShi = t; }
        else { tingZhi(); }
      }
    }
    // 口型：说话时嘴开合
    if (kouXingOn && BONE.zui) {
      const f = Math.abs(Math.sin(miao * 9));
      BONE.zui.scale.set(1 + f * 0.8, 1 + f * 0.5, 1 + f * 0.8);
    }
    renderer.render(scene, camera);
  }

  /** 外观渲染入口：a = { xingTai:'2d'|'3d', zhuSe, fuSe, yanXing, zuiXing, erDuo, weiBa, yanSe, hongSe, touDa, zhuang, modelId? } */
  /* ══ R220：GLB（glTF 2.0）现成模型 —— RobotExpressive 等开源模型直接用，动画剪辑驱动 ══ */
  let gltfRoot = null, gltfMixer = null, gltfClips = {};
  const GLTF_DONG_ZUO = {
    huXi: 'Idle', zhaYan: 'Idle', siKao: 'Idle', shuiJiao: 'Sitting', keShui: 'Sitting', paXia: 'Sitting',
    zhaoShou: 'Wave', huiShou: 'Wave', huanYing: 'Wave', kaiXin: 'ThumbsUp', guZhang: 'ThumbsUp',
    zhuanQuan: 'Dance', tiaoWu: 'Dance', bengTiao: 'Jump', daGun: 'Jump', qiLi: 'Jump',
    dianTou: 'Wave', yaoTou: 'Wave', waiTou: 'Wave', yaoWei: 'Dance', duZui: 'Wave',
    haiXiu: 'Idle', shengQi: 'Punch', weiQu: 'Idle', jingYa: 'Jump', shenLan: 'Jump',
    daHaQian: 'Sitting', yiHuo: 'Wave', shenZhua: 'Wave',
  };
  function yingYongGltfDongZuo(id) {
    if (!gltfMixer || !gltfRoot) return false;
    const ming = GLTF_DONG_ZUO[id] || 'Idle';
    const clip = gltfClips[ming] || gltfClips.Idle;
    if (!clip) return false;
    try {
      gltfMixer.stopAllAction();
      const act = gltfMixer.clipAction(clip);
      if (ming !== 'Idle' && clip.duration > 1.5) { act.setLoop(2201 /* LoopRepeat */, 1); act.clampWhenFinished = true; }
      act.reset().fadeIn(0.12).play();
      return true;
    } catch { return false; }
  }
  function init3DGlTF(src) {
    try {
      const THREE = window.THREE;
      if (!THREE || !window.GLTFLoader) return false;
      if (!sanD) init3D({});
      if (!scene) return false;
      if (gltfRoot) { try { scene.remove(gltfRoot); } catch { /* noop */ } gltfRoot = null; gltfMixer = null; gltfClips = {}; }
      if (BONE && BONE.root) BONE.root.visible = false;
      const loader = new window.GLTFLoader();
      loader.load(src, (gltf) => {
        try {
          gltfRoot = gltf.scene || gltf.scenes[0];
          if (!gltfRoot) return;
          /* 自适应尺寸：缩放到约 2.2 单位高、落在脚下 */
          const box = new THREE.Box3().setFromObject(gltfRoot);
          const size = new THREE.Vector3(); box.getSize(size);
          const s = size.y > 0.01 ? 2.2 / size.y : 1;
          gltfRoot.scale.setScalar(s);
          const box2 = new THREE.Box3().setFromObject(gltfRoot);
          gltfRoot.position.y -= box2.min.y;
          scene.add(gltfRoot);
          gltfMixer = new THREE.AnimationMixer(gltfRoot);
          gltfClips = {};
          for (const c of (gltf.animations || [])) gltfClips[c.name] = c;
          yingYongGltfDongZuo('huXi');
          if (window.__shangBaoBenTi) { try { window.__shangBaoBenTi(); } catch { /* noop */ } }
        } catch { /* noop */ }
      }, undefined, () => { /* 加载失败保持程序化骨骼可见 */ if (BONE && BONE.root) BONE.root.visible = true; });
      return true;
    } catch { return false; }
  }

  function yingYongWaiGuan(a, tupianEl) {
    xingTai = String((a && a.xingTai) || '2d');
    const pet = document.getElementById('pet');
    const img = tupianEl || document.getElementById('tupian');
    const san = document.getElementById('tiSanD');
    const glbSrc = String((a && (a.glbSrc || (String(a.imgSrc || '').toLowerCase().endsWith('.glb') ? a.imgSrc : ''))) || '');
    if (xingTai === '3d') {
      /* R220：.glb 现成模型走 GLTFLoader（动画剪辑）；否则程序化骨骼 */
      if (glbSrc && init3DGlTF(glbSrc)) {
        img.style.display = 'none';
        if (san) san.style.display = 'block';
        kaiShi3D();
        kaiShiAutoDongZuo();
        return;
      }
      if (init3D(a || {})) {
        img.style.display = 'none';
        if (san) san.style.display = 'block';
        jiLuJiZhun();
        kaiShi3D();
        kaiShiAutoDongZuo();
      } else {
        /* R219：3D 初始化失败（无 THREE/WebGL）回退 2D，绝不留空白 */
        xingTai = '2d';
        if (san) san.style.display = 'none';
        img.style.display = '';
        if (a && a.imgSrc) img.src = a.imgSrc;
        else img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(hua2DSvg(a || {}));
      }
    } else {
      /* R220：2D 的 idle 呼吸/眨眼由 CSS 常驻动画负责，停掉 3D 调度器 */
      try { clearTimeout(autoXunHuan); autoXunHuan = 0; } catch { /* noop */ }
      if (san) san.style.display = 'none';
      if (renderer) { renderer.dispose(); renderer = null; scene = null; camera = null; sanD = null; boneRoot = null; }
      img.style.display = '';
      /* 2D：优先用给定图片（内置/外部模型），否则程序化 SVG（手捏） */
      if (a && a.imgSrc) img.src = a.imgSrc;
      else img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(hua2DSvg(a || {}));
    }
  }

  let sanLoop = null;
  /* R220：auto 动作调度（呼吸常驻 + 周期眨眼）—— 之前 zhiLing:'auto' 定义了却从未被消费 */
  let autoXunHuan = 0;
  function kaiShiAutoDongZuo() {
    if (autoXunHuan) return;
    const yan = () => {
      try {
        const dang = dongZuoZhengZai;
        const beiDaDuan = !!(dang && dang.zhiLing === 'trigger');
        if (!beiDaDuan) {
          boFang('zhaYan');
          setTimeout(() => {
            if (!dongZuoZhengZai || dongZuoZhengZai === DONG_ZUO.zhaYan) boFang('huXi');
          }, 260);
        }
      } catch { /* noop */ }
      autoXunHuan = setTimeout(yan, 3400 + Math.random() * 4200);
    };
    autoXunHuan = setTimeout(yan, 2800);
    boFang('huXi');
  }
  function kaiShi3D() {
    if (sanLoop) return;
    const loop = (t) => { try { gengXin(t); } catch { /* noop */ } };
    const step = () => { if (renderer) { try { loop(performance.now()); } catch { /* noop */ } sanLoop = requestAnimationFrame(step); } else { sanLoop = null; } };
    sanLoop = requestAnimationFrame(step);
  }

  /* ── 对外接口 ──────────────────────────────────────────────────────── */
  window.__mimicWaiGuan = yingYongWaiGuan;
  window.__mimicDongZuo = boFang;
  window.__mimicKouXing = (on) => { kouXingOn = !!on; };
  window.__mimicTingZhi = tingZhi;
  window.__mimicDongZuoBiao = DONG_ZUO;
  /* R220：GLB 状态暴露（探针/调试用） */
  window.__mimicGltfZhuangTai = () => ({ loaded: !!gltfRoot, mixer: !!gltfMixer, clips: Object.keys(gltfClips), dongZuo: dongZuoZhengZai ? String(dongZuoZhengZai.ming || '') : '' });
  jiChuDongZuo();

  /* 精灵图支持：sheet JSON（帧动画由 mimic 窗口按时间播放）—— 基础实现：帧索引切换 */
  let sheetZt = null;
  function yingYongSheet(srcJson, imgEl) {
    try {
      const d = typeof srcJson === 'string' ? JSON.parse(srcJson) : srcJson;
      if (!d || !d.frames || !Array.isArray(d.frames)) return false;
      sheetZt = { frames: d.frames.map((f) => (typeof f === 'string' ? f : (f && f.src) || '')), img: imgEl || document.getElementById('tupian'), i: 0 };
      if (sheetZt.img) { sheetZt.img.src = sheetZt.frames[0] || ''; kaiShiSheet(); }
      return true;
    } catch { return false; }
  }
  let sheetLoop = null;
  function kaiShiSheet() {
    if (sheetLoop) return;
    const step = () => {
      if (sheetZt && sheetZt.img && sheetZt.frames.length > 1) {
        sheetZt.i = (sheetZt.i + 1) % sheetZt.frames.length;
        sheetZt.img.src = sheetZt.frames[sheetZt.i];
        sheetLoop = requestAnimationFrame(step);
      } else sheetLoop = null;
    };
    sheetLoop = requestAnimationFrame(step);
  }
  window.__mimicSheet = yingYongSheet;
})();
