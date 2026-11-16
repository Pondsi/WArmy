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
  /* R222 项9：Q 版形象重绘 —— 大头小身 + 高光眼睛 + 腮红 + w 嘴 + 内耳/尾巴/脚掌，参数不变 */
  function hua2DSvg(a) {
    /* R223 项8：预设角色成品 SVG 直通（主窗口下发 a.svg） */
    if (a && a.svg) return a.svg;
    const zhu = a.zhuSe || '#f4a460', fu = a.fuSe || '#e8e0d0', yanSe = a.yanSe || '#2b2b2b', hong = a.hongSe || '#e05a5a';
    const er = a.erDuo !== false, wei = a.weiBa !== false;
    const yan = {
      yuan: '<circle cx="86" cy="96" r="8" fill="' + yanSe + '"/><circle cx="134" cy="96" r="8" fill="' + yanSe + '"/><circle cx="83.5" cy="93" r="2.8" fill="#fff"/><circle cx="131.5" cy="93" r="2.8" fill="#fff"/><circle cx="88" cy="99" r="1.2" fill="#fff" opacity=".8"/><circle cx="136" cy="99" r="1.2" fill="#fff" opacity=".8"/>',
      xiao: '<circle cx="86" cy="96" r="6" fill="' + yanSe + '"/><circle cx="134" cy="96" r="6" fill="' + yanSe + '"/><circle cx="84" cy="94" r="2" fill="#fff"/><circle cx="132" cy="94" r="2" fill="#fff"/>',
      qiao: '<path d="M78 97 q8 -9 16 0" stroke="' + yanSe + '" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M126 97 q8 -9 16 0" stroke="' + yanSe + '" stroke-width="3" fill="none" stroke-linecap="round"/>',
      hei: '<circle cx="86" cy="96" r="9.5" fill="' + yanSe + '"/><circle cx="134" cy="96" r="9.5" fill="' + yanSe + '"/><circle cx="83" cy="92.5" r="3.2" fill="#fff"/><circle cx="131" cy="92.5" r="3.2" fill="#fff"/><circle cx="89" cy="99" r="1.5" fill="#fff" opacity=".85"/><circle cx="137" cy="99" r="1.5" fill="#fff" opacity=".85"/>',
      xing: '<path d="M86 87 l2.6 5.4 6 .8 -4.4 4.2 1.1 5.9 -5.3 -2.9 -5.3 2.9 1.1 -5.9 -4.4 -4.2 6 -.8z" fill="' + yanSe + '"/><path d="M134 87 l2.6 5.4 6 .8 -4.4 4.2 1.1 5.9 -5.3 -2.9 -5.3 2.9 1.1 -5.9 -4.4 -4.2 6 -.8z" fill="' + yanSe + '"/>',
    };
    const zui = {
      xiao: '<path d="M102 118 q4 5 8 0 q4 5 8 0" stroke="' + hong + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
      wei: '<path d="M101 116 q9 10 18 0 q-9 3 -18 0z" fill="' + hong + '"/><ellipse cx="110" cy="121" rx="4" ry="2.4" fill="#ff9d9d"/>',
      kai: '<ellipse cx="110" cy="120" rx="7" ry="5.5" fill="' + hong + '"/><ellipse cx="110" cy="123" rx="4" ry="2.5" fill="#ff9d9d"/>',
      qiao: '<path d="M103 118 q8 5 15 -2" stroke="' + hong + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
      ping: '<line x1="102" y1="119" x2="118" y2="119" stroke="' + hong + '" stroke-width="2.2" stroke-linecap="round"/>',
    };
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">' +
      (wei ? '<path d="M150 170 q30 4 36 -16 q5 -18 -16 -16 q-10 1 -12 8" fill="' + fu + '"/>' : '') +
      '<ellipse cx="110" cy="164" rx="40" ry="30" fill="' + zhu + '"/>' +
      '<ellipse cx="110" cy="170" rx="26" ry="20" fill="' + fu + '"/>' +
      '<ellipse cx="88" cy="194" rx="12" ry="7" fill="' + zhu + '"/><ellipse cx="132" cy="194" rx="12" ry="7" fill="' + zhu + '"/>' +
      (er ? '<path d="M60 64 Q50 14 96 40 Q74 46 66 66z" fill="' + zhu + '"/><path d="M64 56 Q60 28 88 44 Q74 48 68 60z" fill="' + fu + '"/><path d="M160 64 Q170 14 124 40 Q146 46 154 66z" fill="' + zhu + '"/><path d="M156 56 Q160 28 132 44 Q146 48 152 60z" fill="' + fu + '"/>' : '') +
      '<circle cx="110" cy="96" r="56" fill="' + zhu + '"/>' +
      '<ellipse cx="92" cy="66" rx="16" ry="9" fill="#ffffff" opacity=".16" transform="rotate(-18 92 66)"/>' +
      '<ellipse cx="110" cy="114" rx="32" ry="24" fill="' + fu + '" opacity=".9"/>' +
      (yan[a.yanXing] || yan.yuan) +
      '<circle cx="70" cy="112" r="7" fill="' + hong + '" opacity=".4"/><circle cx="150" cy="112" r="7" fill="' + hong + '" opacity=".4"/>' +
      '<ellipse cx="110" cy="108" rx="4" ry="3" fill="' + hong + '"/>' +
      (zui[a.zuiXing] || zui.xiao) +
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
    /* R223 项8：角色特征 —— logo牛马（鬃毛/吻部/蹄子/深色尾）与牛马娘（发盖刘海双马尾/连衣裙/马耳）。
       附加网格全部挂头/身/腿骨骼 ⇒ 动作系统照常驱动。 */
    if (String(a.teZheng || '') === 'niuMa') {
      const zong = a.zongSe ? parseInt(String(a.zongSe).replace('#', ''), 16) : 0x3E2723;
      const wen = a.wenSe ? parseInt(String(a.wenSe).replace('#', ''), 16) : 0xC19A6B;
      const ti = a.tiSe ? parseInt(String(a.tiSe).replace('#', ''), 16) : 0x1A1A1A;
      const zongM = new THREE.MeshStandardMaterial({ color: zong });
      [[0, 1.18, -0.34], [0, 1.22, -0.12], [0, 1.2, 0.1], [0, 1.1, 0.3], [0, 0.98, 0.48]].forEach((p) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), zongM);
        m.position.set(p[0], p[1], p[2]); m.scale.set(1, 0.85, 1); m.userData.buWei = '鬃毛'; tou.add(m);
      });
      const wenM = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), new THREE.MeshStandardMaterial({ color: wen }));
      wenM.position.set(0, 0.3, 0.6); wenM.scale.set(1.25, 0.8, 0.85); tou.add(wenM);
      const biKong = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), zongM);
      biKong.position.set(-0.08, 0.32, 0.78);
      const biKong2 = biKong.clone(); biKong2.position.x = 0.08;
      tou.add(biKong, biKong2);
      wenM.userData.buWei = '鼻子'; biKong.userData.buWei = '鼻子'; biKong2.userData.buWei = '鼻子';
      zui.visible = false; /* 马脸用吻部+鼻孔，不收红嘴 */
      const tiM = new THREE.MeshStandardMaterial({ color: ti });
      const hoofL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), tiM);
      hoofL.position.set(0, -0.3, 0); hoofL.scale.set(1.2, 0.7, 1.2); hoofL.userData.buWei = '蹄子'; legL.add(hoofL);
      const hoofR = hoofL.clone(); hoofR.userData.buWei = '蹄子'; legR.add(hoofR);
      earL.material = new THREE.MeshStandardMaterial({ color: bodyColor });
      earL.scale.set(0.6, 1.7, 0.5);
      earR.material = earL.material; earR.scale.set(0.6, 1.7, 0.5);
      weiM.material = zongM;
    }
    if (String(a.teZheng || '') === 'niuMaNiang') {
      const fa = a.faSe ? parseInt(String(a.faSe).replace('#', ''), 16) : 0x5a3a22;
      const qun = a.qunSe ? parseInt(String(a.qunSe).replace('#', ''), 16) : 0xA0522D;
      const faM = new THREE.MeshStandardMaterial({ color: fa });
      const faMao = new THREE.Mesh(new THREE.SphereGeometry(0.72 * (a.touDa || 1), 20, 16), faM);
      faMao.position.set(0, 0.72, -0.14); faMao.scale.set(1.04, 1.02, 1); faMao.userData.buWei = '头发'; tou.add(faMao);
      [[-0.26, 1.02, 0.52], [0, 1.08, 0.56], [0.26, 1.02, 0.52]].forEach((p) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), faM);
        m.position.set(p[0], p[1], p[2]); m.scale.set(1.15, 0.8, 0.7); m.userData.buWei = '头发'; tou.add(m);
      });
      const binL = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), faM);
      binL.position.set(-0.72, 0.28, -0.05); binL.scale.set(0.55, 1.9, 0.55); binL.userData.buWei = '头发'; tou.add(binL);
      const binR = binL.clone(); binR.position.x = 0.72; binR.userData.buWei = '头发'; tou.add(binR);
      earL.material = faM; earL.position.set(-0.42, 1.28, -0.05); earL.scale.set(0.55, 1.5, 0.45);
      earR.material = faM; earR.position.set(0.42, 1.28, -0.05); earR.scale.set(0.55, 1.5, 0.45);
      const qunM = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.88, 1.15, 18), new THREE.MeshStandardMaterial({ color: qun }));
      qunM.position.y = -0.82; qunM.userData.buWei = '裙子'; body.add(qunM);
      const qunBian = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.9, 0.12, 18), faM);
      qunBian.position.y = -1.36; qunBian.userData.buWei = '裙子'; body.add(qunBian);
      armL.material = new THREE.MeshStandardMaterial({ color: bodyColor });
      armR.material = armL.material;
      legL.material = armL.material; legR.material = armL.material;
      const xieL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), faM);
      xieL.position.set(0, -0.3, 0); xieL.scale.set(1.2, 0.7, 1.2); xieL.userData.buWei = '鞋子'; legL.add(xieL);
      const xieR = xieL.clone(); xieR.userData.buWei = '鞋子'; legR.add(xieR);
      weiM.material = faM;
      yanM.scale.set(1.15, 1.25, 1); yanR.scale.set(1.15, 1.25, 1);
    }
    body.add(tou, armL, armR, legL, legR);
    boneRoot.add(body);
    scene.add(boneRoot);
    // 命名骨骼（动作系统用）
    BONE.body = body; BONE.tou = tou; BONE.armL = armL; BONE.armR = armR;
    BONE.legL = legL; BONE.legR = legR; BONE.wei = weiG; BONE.zui = zui;
    BONE.yanL = yanM; BONE.yanR = yanR; BONE.earL = earL; BONE.earR = earR;
    BONE.root = boneRoot;
    /* R223 项9：部位标签 —— 左键射线反馈用（细部位优先，粗部位按骨骼归属兜底） */
    yanM.userData.buWei = '眼睛'; yanR.userData.buWei = '眼睛';
    tong.userData.buWei = '眼睛'; tong2.userData.buWei = '眼睛';
    earL.userData.buWei = '耳朵'; earR.userData.buWei = '耳朵';
    zui.userData.buWei = '嘴巴';
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
  /* R223 项7：禁用（未选中）动作表 —— 主窗口网格切换后随轮询跟上，内置/外部同口径 */
  let jinYongDongZuo = {};
  function gengXinJinYongBiao() {
    try {
      if (!window.warmyMimic || !window.warmyMimic.dongZuoLieBiao) return;
      window.warmyMimic.dongZuoLieBiao().then((r) => {
        try {
          const biao = {};
          for (const x of ((r && r.items) || [])) { if (x && x.enabled === false) biao[String(x.id)] = true; }
          jinYongDongZuo = biao;
        } catch { /* noop */ }
      }).catch(() => { /* noop */ });
    } catch { /* noop */ }
  }

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

  /* R221：外部动作包注册（动作模型目录扫描结果）—— 之前外部动作 id 进 boFang 恒 return false，AI/触发词都播不了 */
  function zhuCeWaiBuDongZuo() {
    try {
      if (!window.warmyMimic || !window.warmyMimic.dongZuoLieBiao) return;
      window.warmyMimic.dongZuoLieBiao().then((r) => {
        try {
          for (const x of ((r && r.items) || [])) {
            const id = String(x.id || '');
            if (!id || DONG_ZUO[id]) continue;
            DONG_ZUO[id] = { ming: String(x.name || id), lei: 'ext', ms: Number(x.duration) || 1500, file: String(x.file || ''), zhiLing: 'trigger' };
          }
        } catch { /* noop */ }
      }).catch(() => { /* noop */ });
    } catch { /* noop */ }
  }
  /** 播放动作（3D 骨骼关键帧 / 2D 图层类 / R221 外部动作精灵图） */
  function boFang(id) {
    let k = String(id || '');
    if (!DONG_ZUO[k]) {
      /* R219：AI【动作:名字】给的是中文名 —— 按 ming 回退查拼音 id */
      const hit = Object.keys(DONG_ZUO).find((x) => DONG_ZUO[x] && DONG_ZUO[x].ming === k);
      if (!hit) return false;
      k = hit;
    }
    /* R223 项7：禁用（未选中）的动作不播（主进程也拦，这里是兜底；auto idle 同样生效） */
    if (jinYongDongZuo[k]) return false;
    /* R221：外部动作 —— 2D 换动作图 + 通用摆动，播完还原；3D 无骨骼数据，映射到内置蹦跳（诚实可用） */
    if (DONG_ZUO[k] && DONG_ZUO[k].lei === 'ext') {
      if (xingTai !== '2d') return boFang('bengTiao');
      const yi = document.getElementById('tupian');
      if (!yi) return false;
      const jiuSrc = yi.src;
      if (DONG_ZUO[k].file) yi.src = DONG_ZUO[k].file;
      dongZuo2D(k);
      setTimeout(() => { try { if (jiuSrc) yi.src = jiuSrc; } catch { /* noop */ } }, DONG_ZUO[k].ms || 1500);
      return true;
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
    if (gltfMixer) {
      try { gltfMixer.update(1 / 60); } catch { /* noop */ }
      /* R222 项9 真缺陷：原来更新完 mixer 直接 return，从不 renderer.render ⇒ GLB 3D 模型完全看不到 */
      if (renderer && scene && camera) { try { renderer.render(scene, camera); } catch { /* noop */ } }
      return;
    }
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
        const sanXin = document.getElementById('tiSanD');
        if (sanXin) sanXin.style.display = 'block';
        kaiShi3D();
        kaiShiAutoDongZuo();
        return;
      }
      if (init3D(a || {})) {
        img.style.display = 'none';
        const sanXin = document.getElementById('tiSanD');
        if (sanXin) sanXin.style.display = 'block';
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
      /* R222 项9：旧 canvas 必须从 DOM 移除（原来只置空引用 ⇒ 重复画布叠在一起）；GLB 残留一并清 */
      const jiuCanvas = document.getElementById('tiSanD'); if (jiuCanvas) jiuCanvas.remove();
      gltfRoot = null; gltfMixer = null; gltfClips = {};
      img.style.display = '';
      /* R221：精灵图模型 → 读 JSON 走帧动画（__mimicSheet 此前有实现无调用方）；失败回退整图，不留空白 */
      if (a && a.kind === 'sheet' && a.sheetJson && window.warmyMimic && window.warmyMimic.sheetJson) {
        const src = String(a.sheetJson);
        const base = src.slice(0, src.lastIndexOf('/') + 1);
        if (a.imgSrc) img.src = a.imgSrc; /* 先显示整图兜底，JSON 到位后切帧动画 */
        window.warmyMimic.sheetJson({ src }).then((r) => {
          try {
            if (r && r.ok && yingYongSheet(r.json, img, base)) return;
          } catch { /* noop */ }
          try { if (a.imgSrc) img.src = a.imgSrc; } catch { /* noop */ }
        }).catch(() => { /* 读不到保持整图 */ });
        return;
      }
      /* R221：Live2D 渲染未实现（需 Cubism Core）—— 诚实降级：程序化形象 + 字幕说明，绝不把 .model3.json 当图片显示 */
      if (a && a.kind === 'live2d') {
        img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(hua2DSvg(a || {}));
        try { if (window.__shuo) window.__shuo('Live2D 渲染尚未实现，先用替身形象', 4200); } catch { /* noop */ }
        return;
      }
      /* 2D：优先用给定图片（内置/外部模型），否则程序化 SVG（手捏） */
      tingZhiSheet();
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
  /* R223 项9：3D 交互 —— 右键拖动旋转 / 左键部位射线（反馈 AI） */
  function buWeiOf(obj) {
    let n = obj;
    while (n) {
      if (n.userData && n.userData.buWei) return String(n.userData.buWei);
      if (n === BONE.tou) return '头';
      if (n === BONE.armL) return '左手';
      if (n === BONE.armR) return '右手';
      if (n === BONE.legL) return '左腿';
      if (n === BONE.legR) return '右腿';
      if (n === BONE.wei) return '尾巴';
      if (n === BONE.body) return '身体';
      n = n.parent;
    }
    return '身体';
  }
  window.__mimicIs3D = () => xingTai === '3d' && !!(boneRoot || gltfRoot);
  window.__mimicXuanZhuanBy = (dx, dy) => {
    const mu = gltfRoot || boneRoot;
    if (!mu) return;
    mu.rotation.y += Number(dx || 0) * 0.01;
    mu.rotation.x = Math.max(-0.5, Math.min(0.5, mu.rotation.x + Number(dy || 0) * 0.008));
  };
  /* 旋转结束重录基准 —— 否则转圈等动作的关键帧会把模型拍回旧朝向 */
  window.__mimicXuanZhuanJieShu = () => { try { jiLuJiZhun(); } catch { /* noop */ } };
  window.__mimicRaycast = (clientX, clientY) => {
    try {
      if (xingTai !== '3d' || !renderer || !scene || !camera || !sanD || !window.THREE) return '';
      const mu = gltfRoot || boneRoot;
      if (!mu) return '';
      const r = sanD.getBoundingClientRect();
      if (!r.width || !r.height) return '';
      const nx = ((Number(clientX) - r.left) / r.width) * 2 - 1;
      const ny = -((Number(clientY) - r.top) / r.height) * 2 + 1;
      const rc = new window.THREE.Raycaster();
      rc.setFromCamera({ x: nx, y: ny }, camera);
      const hits = rc.intersectObject(mu, true);
      for (const h of hits) {
        if (gltfRoot) return String((h.object && h.object.name) || '模型');
        const w = buWeiOf(h.object);
        if (w) return w;
      }
      return '';
    } catch { return ''; }
  };
  /* R220：GLB 状态暴露（探针/调试用） */
  window.__mimicGltfZhuangTai = () => ({ loaded: !!gltfRoot, mixer: !!gltfMixer, clips: Object.keys(gltfClips), dongZuo: dongZuoZhengZai ? String(dongZuoZhengZai.ming || '') : '' });
  jiChuDongZuo();
  zhuCeWaiBuDongZuo();
  /* R223 项7：禁用表起手拉一次 + 10s 轮询（主窗口切换启用/禁用后及时生效） */
  gengXinJinYongBiao();
  setInterval(gengXinJinYongBiao, 10000);

  /* 精灵图支持：sheet JSON（帧动画）—— R221：fps 时基步进（原来每 RAF 换帧=60fps 闪瞎）+ 相对帧路径解析 + 可停止 */
  let sheetZt = null;
  function yingYongSheet(srcJson, imgEl, baseDir) {
    try {
      const d = typeof srcJson === 'string' ? JSON.parse(srcJson) : srcJson;
      if (!d || !d.frames || !Array.isArray(d.frames) || !d.frames.length) return false;
      const base = String(baseDir || '');
      const jieXi = (f) => {
        const s = String(typeof f === 'string' ? f : (f && f.src) || '');
        if (!s) return '';
        if (/^(data:|file:|https?:|\.\/mimic\/)/.test(s) || !base) return s;
        return base + s; /* 相对帧路径 → 相对 JSON 所在目录 */
      };
      const frames = d.frames.map(jieXi).filter(Boolean);
      if (!frames.length) return false;
      tingZhiSheet();
      sheetZt = { frames, img: imgEl || document.getElementById('tupian'), i: 0, fps: Math.max(1, Math.min(30, Number(d.fps) || 8)), last: 0 };
      if (sheetZt.img) { sheetZt.img.src = frames[0]; kaiShiSheet(); }
      return true;
    } catch { return false; }
  }
  let sheetLoop = null;
  function kaiShiSheet() {
    if (sheetLoop) return;
    const step = (t) => {
      if (!sheetZt || !sheetZt.img || sheetZt.frames.length < 2) { sheetLoop = null; return; }
      if (!sheetZt.last || t - sheetZt.last >= 1000 / sheetZt.fps) {
        sheetZt.last = t;
        sheetZt.i = (sheetZt.i + 1) % sheetZt.frames.length;
        sheetZt.img.src = sheetZt.frames[sheetZt.i];
      }
      sheetLoop = requestAnimationFrame(step);
    };
    sheetLoop = requestAnimationFrame(step);
  }
  function tingZhiSheet() {
    if (sheetLoop) { try { cancelAnimationFrame(sheetLoop); } catch { /* noop */ } sheetLoop = null; }
    sheetZt = null;
  }
  window.__mimicSheet = yingYongSheet;
  window.__mimicSheetTing = tingZhiSheet;
  /* R221：探针暴露点（帧数/fps/当前帧） */
  window.__mimicSheetZt = () => (sheetZt ? { frames: sheetZt.frames.length, fps: sheetZt.fps, i: sheetZt.i } : null);
})();
