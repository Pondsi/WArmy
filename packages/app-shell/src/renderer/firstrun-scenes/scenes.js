/* 首启场景 · 十幕「水墨光景」v2
 * 宇宙 / 禅意 / 神意 / 迁徙 / 宏大 / 未来 / 勇敢 / 无畏 / 千军 / 千千万万
 * 主角始终是真实 logo 牛马：站着只呼吸，行走就真的位移。
 */
(() => {
  'use strict';
  const A = window.FIRSTRUN_API;
  const C = A.ctx;
  const S = window.FIRSTRUN_SCENES;
  const { TAU, rgba, mix, clamp, lerp, rng } = A;

  function poly(pts, close = true) {
    C.beginPath();
    C.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[i - 1];
      const mx = (q[0] + p[0]) / 2;
      const my = (q[1] + p[1]) / 2;
      C.quadraticCurveTo(q[0], q[1], mx, my);
    }
    const last = pts[pts.length - 1];
    C.lineTo(last[0], last[1]);
    if (close) C.closePath();
  }
  function fillPoly(pts, fill) {
    poly(pts);
    C.fillStyle = fill;
    C.fill();
  }
  /** 硬折角山体：用于岩石/崖壁，避免被 quadratic 磨成蛋形。 */
  function sharpPoly(pts, fill) {
    C.beginPath();
    C.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) C.lineTo(pts[i][0], pts[i][1]);
    C.closePath();
    if (fill) { C.fillStyle = fill; C.fill(); }
  }
  /** 远处兽群剪影：小、软、有腿；不抢主角。 */
  function herdBeast(x, y, s, color, alpha, t, i) {
    const bob = Math.sin(t * 2.1 + i * 0.9) * s * 0.22;
    A.softEllipse(x - s * 1.1, y + 1, s * 2.6, s * 0.45, '#6b4e32', alpha * 0.45);
    C.globalAlpha = alpha;
    C.fillStyle = color;
    C.beginPath();
    C.ellipse(x, y - s * 1.5 + bob, s * 1.9, s * 0.88, 0, 0, TAU);
    C.fill();
    C.beginPath();
    C.ellipse(x + s * 2.05, y - s * 2.05 + bob, s * 0.62, s * 0.48, -0.35, 0, TAU);
    C.fill();
    C.strokeStyle = color;
    C.lineWidth = Math.max(0.8, s * 0.22);
    for (let k = 0; k < 4; k++) {
      C.beginPath();
      C.moveTo(x - s * 1.2 + k * s * 0.85, y - s * 0.9 + bob);
      C.lineTo(x - s * 1.38 + k * s * 0.95, y);
      C.stroke();
    }
    C.beginPath();
    C.moveTo(x - s * 1.75, y - s * 1.8 + bob);
    C.quadraticCurveTo(x - s * 2.5, y - s * 1.4 + bob, x - s * 2.3, y - s * 0.8 + bob);
    C.stroke();
    C.globalAlpha = 1;
  }
  function bridgeY(x, x0, x1, y0, y1, sag) {
    const u = clamp((x - x0) / (x1 - x0), 0, 1);
    return y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * sag;
  }
  function wind(x0, y0, x1, y1, color, alpha) {
    C.strokeStyle = rgba(color, alpha);
    C.lineWidth = 1.1;
    C.beginPath();
    C.moveTo(x0, y0);
    C.bezierCurveTo(lerp(x0, x1, 0.35), y0 - 8, lerp(x0, x1, 0.7), y1 + 6, x1, y1);
    C.stroke();
  }
  function softCloud(x, y, rx, ry, a) {
    A.softEllipse(x, y, rx, ry, '#ffffff', a);
    A.softEllipse(x + rx * 0.18, y + ry * 0.34, rx * 0.72, ry * 0.5, '#b9c9d6', a * 0.22);
  }

  // ── 01 星河 · 天穹 ─────────────────────────────────────────────
  (() => {
    const r = A.rng(1101);
    const stars = [];
    for (let i = 0; i < 240; i++) {
      stars.push({ x: r() * 1280, y: r() * 480, r: r() < 0.1 ? 2.1 : 0.8 + r() * 0.8, p: r() * TAU, a: 0.35 + r() * 0.55, speed: 1 + r() * 1.6 });
    }
    S.push({
      title: '星河 · 天穹', short: '星河',
      tags: '宇宙 · 星空 · 宏大',
      sub: '星子还没退，旋臂已经醒来。它站在云的边缘，看一颗巨大的行星慢慢转过脸。',
      draw(t) {
        A.sky([[0, '#e3dcf0'], [0.3, '#ede4f0'], [0.62, '#f8ecdf'], [1, '#f3e3d2']]);
        A.wash(300 + Math.sin(t * 0.05) * 10, 250, 380, 130, '#c3b0dc', 0.26, 5);
        A.wash(760 - Math.sin(t * 0.04) * 12, 170, 330, 110, '#e9bdd2', 0.2, 6);
        A.wash(1090, 300, 280, 120, '#bfcdea', 0.2, 7);
        A.stars(stars, t, '#a98a5c');
        A.stars(stars.slice(0, 36), t, '#8f84ad');
        // 银河带
        C.save();
        C.translate(740, 220);
        C.rotate(-0.28);
        A.wash(0, 0, 420, 70, '#ffffff', 0.13, 8);
        A.wash(60, 10, 260, 46, '#d9c7e8', 0.1, 9);
        C.restore();
        // 行星与环
        C.save();
        C.translate(292, 258);
        C.rotate(-0.36);
        C.strokeStyle = rgba('#b9a8d2', 0.42);
        C.lineWidth = 26;
        C.beginPath(); C.ellipse(0, 0, 318, 74, 0, 0, TAU); C.stroke();
        C.strokeStyle = rgba('#ffffff', 0.4);
        C.lineWidth = 4;
        C.beginPath(); C.ellipse(0, 0, 304, 69, 0, 0, TAU); C.stroke();
        C.restore();
        const pg = C.createRadialGradient(232, 198, 24, 292, 258, 196);
        pg.addColorStop(0, '#fdfcfa');
        pg.addColorStop(0.45, '#dfe7f2');
        pg.addColorStop(0.82, '#c4d2e7');
        pg.addColorStop(1, '#aabdd8');
        C.fillStyle = pg;
        C.beginPath(); C.arc(292, 258, 194, 0, TAU); C.fill();
        C.save();
        C.beginPath(); C.arc(292, 258, 194, 0, TAU); C.clip();
        C.globalAlpha = 0.14;
        C.fillStyle = '#9fb4d2';
        for (let i = 0; i < 5; i++) {
          C.beginPath();
          C.ellipse(292, 178 + i * 38, 220, 10 + i * 2, -0.05, 0, TAU);
          C.fill();
        }
        C.globalAlpha = 0.22;
        C.fillStyle = '#ffffff';
        C.beginPath(); C.ellipse(230, 190, 80, 46, -0.5, 0, TAU); C.fill();
        C.restore();
        C.save();
        C.translate(292, 258);
        C.rotate(-0.36);
        C.strokeStyle = rgba('#d9cdea', 0.82);
        C.lineWidth = 11;
        C.beginPath(); C.ellipse(0, 0, 318, 74, 0, 0.16, Math.PI - 0.16); C.stroke();
        C.strokeStyle = rgba('#ffffff', 0.65);
        C.lineWidth = 2.4;
        C.beginPath(); C.ellipse(0, 0, 310, 70, 0, 0.24, Math.PI - 0.24); C.stroke();
        C.restore();
        A.shootingStar(t, 9.5, 0.15, 1180, 80, 880, 250);
        A.shootingStar(t, 14, 0.62, 980, 60, 700, 210);
        A.sun(1090, 372, 40, '#fff0c6', '#ffe8b8');
        A.cloudSea(598, '#fff8ee', 13, t, 5, 20, 0.85);
        A.mist(590, 40, '#ffffff', 0.22, 14, t, 7);
        A.inkRidge({ base: 690, amp: 20, seed: 15, waves: 1.2, color: '#6f655d', alpha: 0.52, bottom: 770, grain: 64 });
        A.softEllipse(946, 690, 190, 20, '#6f655d', 0.42);
        A.grassField(688, 724, 90, '#5b5148', 16, t, { minH: 6, maxH: 20, alpha: 0.45, width: 1.4 });
        A.horse(946, 688, { k: 17, dir: -1, mode: 'stand', t, auraColor: '#f9dfb1', auraAlpha: 0.2 });
        A.paper();
      },
    });
  })();

  // ── 02 空山 · 禅意 ─────────────────────────────────────────────
  (() => {
    const birds = [
      { x: 650, y: 210, p: 0.4, drift: 16, size: 5 },
      { x: 705, y: 194, p: 2.1, drift: 12, size: 4 },
      { x: 752, y: 218, p: 4.2, drift: 10, size: 3.4 },
    ];
    const leaf = [];
    for (let i = 0; i < 5; i++) leaf.push({ x: 240 + i * 140, y: 120 + i * 80, vx: 8 + i * 2, vy: 6 + i, ph: i * 1.3, spin: 0.6 + i * 0.1, r: 3 + i * 0.4, a: 0.5 - i * 0.05, c: '#8b6a45' });
    S.push({
      title: '空山 · 禅意', short: '空山',
      tags: '禅意 · 简洁 · 静谧',
      sub: '山不说话，雾也不说话。它只沿着山脊走了一步，整座山就安静下来。',
      draw(t) {
        A.sky([[0, '#fdfbf5'], [0.55, '#f8f5ec'], [1, '#eef3ee']]);
        A.sun(1030, 172, 30, '#f6d2b6', '#fdf0e2');
        C.fillStyle = 'rgba(244,198,166,.86)';
        C.beginPath(); C.arc(1030, 172, 24, 0, TAU); C.fill();
        C.strokeStyle = 'rgba(255,248,236,.7)';
        C.lineWidth = 1.6;
        C.beginPath(); C.arc(1030, 172, 27, 0, TAU); C.stroke();
        A.inkRidge({ base: 512, amp: 62, seed: 21, waves: 1.5, color: '#a1b2ab', alpha: 0.2, bottom: 760, grain: 24 });
        A.mist(520, 60, '#ffffff', 0.4, 22, t, 5);
        A.inkRidge({ base: 566, amp: 52, seed: 23, waves: 1.2, color: '#7f948d', alpha: 0.24, bottom: 760, grain: 34 });
        A.mist(576, 54, '#ffffff', 0.32, 24, t, 7);
        A.inkRidge({ base: 626, amp: 44, seed: 25, waves: 1.7, color: '#5f7771', alpha: 0.3, bottom: 760, grain: 46 });
        A.pine(-32, 108, 380, 0.42, '#4d605b', t, 0.62);
        A.pine(-8, 44, 260, 0.58, '#5a6c66', t, 0.44);
        A.birds(birds, t, '#5e716d', 0.5);
        // 山脊小亭
        C.fillStyle = 'rgba(78,98,94,.5)';
        C.fillRect(1006, 570, 5, 34);
        C.fillRect(1048, 570, 5, 34);
        C.fillRect(998, 600, 62, 4);
        C.beginPath();
        C.moveTo(990, 574);
        C.quadraticCurveTo(1030, 548, 1070, 574);
        C.quadraticCurveTo(1030, 562, 990, 574);
        C.closePath(); C.fill();
        C.fillStyle = 'rgba(255,236,196,.5)';
        C.fillRect(1024, 582, 10, 12);
        A.inkRidge({ base: 668, amp: 16, seed: 26, waves: 1.1, color: '#4e625e', alpha: 0.34, bottom: 760, grain: 38 });
        A.softEllipse(782, 666, 180, 18, '#4e625e', 0.4);
        A.grassField(664, 714, 70, '#4e5f58', 27, t, { minH: 8, maxH: 26, alpha: 0.35, width: 1.2 });
        A.horse(782, 664, { k: 14, dir: -1, mode: 'stand', t, auraColor: '#f0e4cc', auraAlpha: 0.14 });
        A.petals(leaf, t, '#8b6a45');
        A.paper();
      },
    });
  })();

  // ── 03 金殿 · 神意 ─────────────────────────────────────────────
  (() => {
    const r = A.rng(3103);
    const gold = [];
    for (let i = 0; i < 70; i++) gold.push({ x: r() * 1280, y: r() * 680, r: 0.7 + r() * 2.2, p: r() * TAU, a: 0.2 + r() * 0.55, vy: 5 + r() * 12 });
    const floaters = [];
    for (let i = 0; i < 12; i++) floaters.push({ x: 620 + r() * 600, y: r() * 420, p: r() * TAU, vy: 6 + r() * 10 });
    function roof(cx, y, halfW, h, fill) {
      C.beginPath();
      C.moveTo(cx - halfW - 30, y - 8);
      C.quadraticCurveTo(cx - halfW * 0.74, y - h * 0.7, cx, y - h);
      C.quadraticCurveTo(cx + halfW * 0.74, y - h * 0.7, cx + halfW + 30, y - 8);
      C.quadraticCurveTo(cx + halfW * 0.62, y - h * 0.14, cx, y - h * 0.2);
      C.quadraticCurveTo(cx - halfW * 0.62, y - h * 0.14, cx - halfW - 30, y - 8);
      C.closePath();
      C.fillStyle = fill;
      C.fill();
      C.strokeStyle = rgba('#f6d79b', 0.55);
      C.lineWidth = 2;
      C.beginPath();
      C.moveTo(cx - halfW - 30, y - 8);
      C.quadraticCurveTo(cx - halfW * 0.74, y - h * 0.7, cx, y - h);
      C.quadraticCurveTo(cx + halfW * 0.74, y - h * 0.7, cx + halfW + 30, y - 8);
      C.stroke();
      C.strokeStyle = rgba('#f2cf8f', 0.32);
      C.lineWidth = 1.4;
      for (let i = -5; i <= 5; i++) {
        C.beginPath();
        C.moveTo(cx + i * halfW * 0.14, y - h * 0.9);
        C.quadraticCurveTo(cx + i * halfW * 0.2, y - h * 0.5, cx + i * halfW * 0.28, y - h * 0.24);
        C.stroke();
      }
      // 檐下阴影
      C.fillStyle = 'rgba(96,58,22,.22)';
      C.beginPath();
      C.moveTo(cx - halfW * 0.88, y - 4);
      C.quadraticCurveTo(cx, y + 10, cx + halfW * 0.88, y - 4);
      C.lineTo(cx + halfW * 0.74, y - h * 0.2);
      C.quadraticCurveTo(cx, y - h * 0.05, cx - halfW * 0.74, y - h * 0.2);
      C.closePath();
      C.fill();
    }
    function lantern(x, y, s) {
      C.strokeStyle = 'rgba(116,78,38,.5)';
      C.lineWidth = 1.2;
      C.beginPath(); C.moveTo(x, y - s * 3); C.lineTo(x, y - s * 0.8); C.stroke();
      A.softEllipse(x, y, s * 2.1, s * 2.1, '#f7b861', 0.25);
      C.fillStyle = '#c96842';
      C.beginPath(); C.ellipse(x, y, s * 0.78, s * 1.05, 0, 0, TAU); C.fill();
      C.fillStyle = '#ffe4ae';
      C.fillRect(x - s * 0.12, y - s * 0.95, s * 0.24, s * 1.9);
      C.fillRect(x - s * 0.95, y - s * 0.12, s * 1.9, s * 0.24);
    }
    function cloth(x, y, w, h, color, t, ph) {
      const sway = Math.sin(t * 1.1 + ph) * 6;
      C.fillStyle = rgba(color, 0.72);
      C.beginPath();
      C.moveTo(x - w / 2, y);
      C.quadraticCurveTo(x - w * 0.62 + sway, y + h * 0.4, x - w * 0.48 + sway, y + h);
      C.lineTo(x + w * 0.48 + sway, y + h);
      C.quadraticCurveTo(x + w * 0.62 + sway, y + h * 0.4, x + w / 2, y);
      C.closePath();
      C.fill();
      C.strokeStyle = 'rgba(255,232,180,.55)';
      C.lineWidth = 1.6;
      C.beginPath();
      C.moveTo(x - w * 0.34, y + h * 0.2);
      C.quadraticCurveTo(x + sway * 0.5, y + h * 0.5, x - w * 0.26 + sway, y + h * 0.82);
      C.stroke();
    }
    S.push({
      title: '金殿 · 神意', short: '金殿',
      tags: '神意 · 宏大 · 金色',
      sub: '光从殿顶落下来，像一场很慢的金色雨。它穿过自己的影子，朝台阶上走。',
      draw(t) {
        A.sky([[0, '#fffaf0'], [0.42, '#ffefcf'], [1, '#f3d094']]);
        A.sun(930, 258, 64, '#fff2c8', '#ffe6ae');
        A.rays(930, 258, 9, 680, 1.45, '#fff3ce', 0.12, t);
        A.inkRidge({ base: 538, amp: 38, seed: 31, waves: 1.2, color: '#d9ae70', alpha: 0.2, bottom: 640, grain: 22 });
        A.cloudSea(576, '#fff5e4', 32, t, 4, 18, 0.62);
        // 殿前的光晕
        A.softEllipse(930, 360, 390, 300, '#fff4d2', 0.4);
        // 远层台基
        C.fillStyle = A.vgrad(590, 720, [[0, '#eed7ac'], [1, '#d8b57c']]);
        C.fillRect(0, 590, 1280, 130);
        C.strokeStyle = 'rgba(160,116,62,.2)';
        C.lineWidth = 1.4;
        for (let i = 0; i < 5; i++) {
          C.beginPath();
          C.moveTo(520 + i * 24, 604 + i * 18);
          C.lineTo(1280, 590 + i * 18);
          C.stroke();
        }
        // 殿身
        A.softEllipse(930, 330, 300, 300, '#ffe8b0', 0.32);
        C.strokeStyle = 'rgba(226,182,106,.24)';
        C.lineWidth = 2.2;
        C.beginPath(); C.arc(930, 330, 244, 0, TAU); C.stroke();
        C.strokeStyle = 'rgba(236,196,124,.28)';
        C.lineWidth = 16;
        C.beginPath(); C.arc(930, 352, 306, 0.16, Math.PI - 0.16); C.stroke();
        // 背墙与内殿暖光
        C.fillStyle = '#6f4824';
        C.fillRect(740, 410, 380, 186);
        A.softEllipse(930, 520, 150, 100, '#ffd88a', 0.2);
        C.fillStyle = 'rgba(70,40,14,.18)';
        C.fillRect(1060, 410, 60, 186);
        // 前廊柱
        C.fillStyle = '#b8874a';
        for (const px of [760, 824, 888, 952, 1016, 1080]) C.fillRect(px, 418, 16, 178);
        C.fillStyle = '#d9ae6a';
        for (const px of [760, 824, 888, 952, 1016, 1080]) {
          C.fillRect(px - 4, 412, 24, 8);
          C.fillRect(px - 4, 588, 24, 8);
        }
        C.fillStyle = '#c79a58';
        C.fillRect(740, 432, 380, 10);
        C.fillRect(740, 566, 380, 8);
        // 门洞
        C.fillStyle = '#4a2c14';
        C.beginPath();
        C.moveTo(884, 596); C.lineTo(884, 512);
        C.quadraticCurveTo(930, 478, 976, 512);
        C.lineTo(976, 596); C.closePath(); C.fill();
        A.softEllipse(930, 550, 40, 46, '#ffd88a', 0.28);
        C.strokeStyle = 'rgba(240,206,146,.55)';
        C.lineWidth = 2;
        C.beginPath();
        C.moveTo(884, 596); C.lineTo(884, 512);
        C.quadraticCurveTo(930, 478, 976, 512);
        C.lineTo(976, 596);
        C.stroke();
        // 侧窗
        for (const wx of [796, 1000]) {
          C.fillStyle = 'rgba(72,42,16,.7)';
          C.fillRect(wx, 462, 44, 62);
          C.strokeStyle = 'rgba(240,206,146,.5)';
          C.lineWidth = 1.4;
          C.strokeRect(wx + 4, 466, 36, 54);
          C.beginPath(); C.moveTo(wx + 22, 466); C.lineTo(wx + 22, 520); C.moveTo(wx + 4, 493); C.lineTo(wx + 40, 493); C.stroke();
        }
        // 前廊栏板
        C.strokeStyle = 'rgba(118,78,36,.55)';
        C.lineWidth = 2;
        C.beginPath(); C.moveTo(744, 548); C.lineTo(1116, 548); C.stroke();
        for (let px = 752; px <= 1112; px += 40) {
          C.beginPath(); C.moveTo(px, 548); C.lineTo(px, 578); C.stroke();
        }
        roof(930, 408, 236, 86, '#8d5c2b');
        roof(930, 318, 168, 74, '#96632f');
        roof(930, 238, 108, 62, '#9d6a34');
        C.fillStyle = '#e9c078';
        C.fillRect(924, 158, 12, 58);
        C.beginPath(); C.arc(930, 152, 8, 0, TAU); C.fill();
        // 檐角金铃
        for (const [ox, oy] of [[-266, 402], [266, 402], [-198, 312], [198, 312], [-138, 232], [138, 232]]) {
          C.fillStyle = '#e7bf74';
          C.beginPath(); C.arc(930 + ox, oy, 4, 0, TAU); C.fill();
        }
        lantern(696, 452, 15);
        lantern(1164, 452, 15);
        cloth(724, 414, 34, 132, '#b4483c', t, 0.2);
        cloth(1136, 414, 34, 132, '#b4483c', t, 1.4);
        // 台基前缘与栏板
        C.fillStyle = '#e6c892';
        C.fillRect(0, 646, 1280, 74);
        C.strokeStyle = 'rgba(150,104,54,.28)';
        C.lineWidth = 2;
        C.beginPath(); C.moveTo(0, 650); C.lineTo(1280, 650); C.stroke();
        for (let i = 0; i < 13; i++) {
          C.strokeStyle = 'rgba(150,104,54,.16)';
          C.lineWidth = 1.3;
          C.beginPath(); C.moveTo(40 + i * 100, 650); C.lineTo(24 + i * 100, 720); C.stroke();
        }
        // 台阶
        for (let i = 0; i < 5; i++) {
          C.fillStyle = `rgba(176,132,76,${0.2 - i * 0.03})`;
          C.fillRect(720 + i * 20, 610 + i * 10, 420 - i * 40, 3);
        }
        // 前景石灯
        C.fillStyle = 'rgba(112,74,36,.8)';
        C.fillRect(118, 674, 14, 34);
        C.fillRect(92, 704, 66, 10);
        C.fillRect(102, 694, 46, 8);
        C.fillRect(104, 652, 42, 26);
        C.fillStyle = 'rgba(255,226,160,.72)';
        C.fillRect(112, 658, 26, 14);
        C.fillStyle = 'rgba(112,74,36,.82)';
        C.beginPath();
        C.moveTo(94, 652); C.lineTo(156, 652); C.lineTo(142, 636); C.lineTo(108, 636);
        C.closePath(); C.fill();
        A.softEllipse(125, 666, 34, 24, '#ffe8b0', 0.3);
        // 殿前薄雾
        A.mist(604, 50, '#fff4dc', 0.34, 33, t, 6);
        A.mist(660, 34, '#fff8e8', 0.22, 34, t, 8);
        const w = A.walk(t, 210, 656, 26, 0.6);
        A.horse(w.x, 676, { k: 17, dir: w.dir, mode: w.moving ? 'walk' : 'stand', t, travel: w.travel, gait: w.gait, auraColor: '#ffe2a8', auraAlpha: 0.28, shadowColor: '#8a5c2e' });
        // 升起的孔明灯
        for (const f of floaters) {
          const x = f.x + Math.sin(t * 0.3 + f.p) * 14;
          const y = 640 - ((f.y + t * f.vy) % 430);
          A.softEllipse(x, y, 13, 16, '#ffd489', 0.28);
          C.fillStyle = '#f6c36e';
          C.beginPath(); C.arc(x, y, 3.2, 0, TAU); C.fill();
        }
        A.lightDust(gold, t, '#fff0c0');
        A.birds([
          { x: 760, y: 252, p: 0.6, drift: 24, size: 7 },
          { x: 826, y: 230, p: 2.2, drift: 18, size: 6 },
          { x: 884, y: 258, p: 4.1, drift: 14, size: 5 },
        ], t, '#ffffff', 0.72);
        A.birds([{ x: 300, y: 190, p: 0.5, drift: 22, size: 4.4 }, { x: 356, y: 170, p: 2.4, drift: 16, size: 3.6 }], t, '#b98a4d', 0.4);
        A.paper();
      },
    });
  })();

  // ── 04 长野 · 迁徙 ─────────────────────────────────────────────
  (() => {
    const r = A.rng(4104);
    const rows = [
      { y: 432, s: 3.1, a: 0.16, c: '#8e7457', speed: 3.5 },
      { y: 474, s: 4.0, a: 0.23, c: '#7d6247', speed: 6 },
      { y: 522, s: 5.1, a: 0.3, c: '#6a523a', speed: 9 },
      { y: 566, s: 6.6, a: 0.4, c: '#5f4931', speed: 11 },
      { y: 606, s: 8.2, a: 0.5, c: '#523d29', speed: 13 },
    ];
    rows.forEach((row, k) => {
      const rr = rng(4104 + k * 17);
      row.items = [];
      let x = -120;
      while (x < 1380) {
        const group = 2 + Math.floor(rr() * 5);
        for (let i = 0; i < group; i++) {
          row.items.push({
            x: x + i * (row.s * 3.6 + rr() * 8),
            y: row.y + (rr() - 0.5) * 22,
            s: row.s * (0.72 + rr() * 0.55),
          });
        }
        x += group * (row.s * 3.6 + 4) + 18 + rr() * 74;
      }
    });
    const grass = [];
    for (let i = 0; i < 150; i++) grass.push({ x: r() * 1280, y: 596 + r() * 124, h: 10 + r() * 40, ph: r() * TAU });
    S.push({
      title: '长野 · 迁徙', short: '迁徙',
      tags: '迁徙 · 千秋 · 远方',
      sub: '草浪一层层压过去，队伍像一条缓慢的河。它走在队伍里，和所有牛马一起往前走。',
      draw(t) {
        A.sky([[0, '#fff6e2'], [0.4, '#ffe8ba'], [0.72, '#f4cf96'], [1, '#deb374']]);
        A.sun(1008, 184, 54, '#fff0c6', '#ffe4ae');
        A.inkRidge({ base: 372, amp: 18, seed: 41, waves: 1.4, color: '#d8bd90', alpha: 0.32, bottom: 560, grain: 16 });
        A.mist(430, 40, '#fff6e2', 0.28, 42, t, 4);
        rows.forEach((row, k) => {
          const span = 1280 + 300;
          for (const it of row.items) {
            const x = ((it.x + t * row.speed + k * 37) % span + span) % span - 150;
            herdBeast(x, it.y, it.s, row.c, row.a, t, it.x * 0.01 + k * 9);
          }
          A.mist(row.y + 12, 26, '#f6d6a0', 0.2, 43 + k, t, 6);
        });
        A.inkRidge({ base: 586, amp: 14, seed: 45, waves: 1.3, color: '#c39a5c', alpha: 0.35, bottom: 700, grain: 26 });
        A.inkRidge({ base: 646, amp: 10, seed: 46, waves: 1.7, color: '#a67c46', alpha: 0.4, bottom: 760, grain: 30 });
        // 牛马走进队伍：与最近一行同地平线、同方向；同伴与尘雾把它夹在队伍里
        const hx = ((t * 15 + 560) % (1280 + 280)) - 140;
        herdBeast(hx - 88, 610, 7.4, '#5a432c', 0.44, t, 2.4);
        A.dust(hx - 58, 611, 30, 0.18, '#b98f5a');
        A.horse(hx, 608, { k: 8, dir: 1, mode: 'walk', t, travel: t * 15, gait: 1, alpha: 0.94, auraColor: '#e8c188', auraAlpha: 0.16 });
        herdBeast(hx + 96, 611, 6.6, '#4e3927', 0.3, t, 5.1);
        A.dust(hx - 96, 612, 36, 0.12, '#c49a63');
        A.dust(hx - 18, 613, 24, 0.08, '#c49a63');
        // 近景两头兽从前面掠过，形成前后遮挡，而不是让主角单独站在最前面
        for (const [ox, s, a, ph] of [[430, 9.5, 0.42, 0.6], [980, 10.5, 0.38, 3.1]]) {
          const fx = ((ox + t * 8) % (1280 + 320)) - 160;
          herdBeast(fx, 654, s, '#463421', a, t, ph);
        }
        for (const g of grass) {
          const sway = Math.sin(t * 0.85 + g.x * 0.02 + g.ph) * 4;
          A.grassBlade(g.x, g.y, g.h, sway, '#7c5c34', 0.42, 1.8);
        }
        A.birds([
          { x: 300, y: 196, p: 0.2, drift: 20, size: 4.6 },
          { x: 360, y: 176, p: 2.2, drift: 15, size: 3.8 },
          { x: 416, y: 204, p: 4.1, drift: 11, size: 3.2 },
        ], t, '#86694a', 0.45);
        A.paper();
      },
    });
  })();

  // ── 05 天关 · 宏大 ─────────────────────────────────────────────
  (() => {
    const r = A.rng(5105);
    const motes = [];
    for (let i = 0; i < 46; i++) motes.push({ x: r() * 1280, y: r() * 680, r: 0.7 + r() * 1.8, p: r() * TAU, a: 0.2 + r() * 0.4, vy: 4 + r() * 8 });
    const moss = [];
    for (let i = 0; i < 42; i++) moss.push({ x: r() * 1280, y: 180 + r() * 470, s: 2 + r() * 4, a: 0.08 + r() * 0.12 });
    function rock(side) {
      const pts = side < 0
        ? [[-70, -40], [70, 8], [118, 92], [172, 176], [150, 244], [206, 318], [182, 396], [232, 472], [198, 548], [250, 626], [214, 760], [-70, 760]]
        : [[1350, -40], [1210, 8], [1162, 92], [1108, 176], [1130, 244], [1074, 318], [1098, 396], [1048, 472], [1082, 548], [1030, 626], [1066, 760], [1350, 760]];
      const g = A.grad(side < 0 ? 0 : 1280, 0, side < 0 ? 260 : 1020, 760, [
        [0, 'rgba(84,103,99,.5)'],
        [0.45, 'rgba(74,94,90,.42)'],
        [1, 'rgba(102,118,110,.24)'],
      ]);
      sharpPoly(pts, g);
      // 岩面块体：先裁进山体，再叠深浅不同的面
      C.save();
      sharpPoly(pts);
      C.clip();
      const rp = rng(side < 0 ? 5105 : 6105);
      for (let i = 0; i < 30; i++) {
        const x = side < 0 ? rp() * 260 : 1020 + rp() * 260;
        const y = rp() * 760;
        const w = 30 + rp() * 90;
        const h = 26 + rp() * 70;
        C.fillStyle = rp() < 0.5
          ? `rgba(238,246,240,${0.02 + rp() * 0.05})`
          : `rgba(38,58,55,${0.02 + rp() * 0.05})`;
        C.beginPath();
        C.moveTo(x, y);
        C.quadraticCurveTo(x + w * 0.4, y - h * 0.2, x + w, y + h * 0.1);
        C.lineTo(x + w * 0.7, y + h);
        C.quadraticCurveTo(x + w * 0.2, y + h * 0.8, x, y);
        C.closePath();
        C.fill();
      }
      for (let i = 0; i < 12; i++) {
        const x = side < 0 ? 40 + rp() * 200 : 1040 + rp() * 200;
        const y = 60 + rp() * 620;
        C.strokeStyle = `rgba(44,62,59,${0.12 + rp() * 0.16})`;
        C.lineWidth = 1.2 + rp() * 2.2;
        C.beginPath();
        C.moveTo(x, y);
        C.quadraticCurveTo(x + 18 + rp() * 26, y + 24, x + 8 + rp() * 30, y + 70 + rp() * 60);
        C.stroke();
      }
      C.restore();
      // 岩面折线
      C.save();
      C.strokeStyle = 'rgba(52,72,69,.22)';
      C.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const y = 40 + i * 76;
        C.beginPath();
        C.moveTo(side < 0 ? 20 : 1260, y);
        C.quadraticCurveTo(side < 0 ? 120 : 1160, y + 18, side < 0 ? 196 : 1084, y + 6);
        C.stroke();
      }
      C.restore();
      const inner = side < 0
        ? [[172, 176], [150, 244], [206, 318], [182, 396], [232, 472], [198, 548], [250, 626]]
        : [[1108, 176], [1130, 244], [1074, 318], [1098, 396], [1048, 472], [1082, 548], [1030, 626]];
      A.brush(inner, 4, '#334a47', 0.35);
      A.brush(inner.slice(2), 2.2, '#eef4ee', 0.22);
      // 岩缝与苔
      for (const m of moss) {
        if (side < 0 ? m.x < 260 : m.x > 1020) A.softEllipse(m.x, m.y, m.s * 2.4, m.s, '#7f9a6c', m.a);
      }
      const pines = side < 0
        ? [[136, 218, 92, -0.72], [196, 366, 74, -0.5], [168, 512, 86, -0.82], [224, 640, 68, -0.6]]
        : [[1146, 214, 92, Math.PI + 0.72], [1092, 362, 74, Math.PI + 0.5], [1114, 510, 86, Math.PI + 0.82], [1058, 638, 68, Math.PI + 0.6]];
      for (const [px, py, pl, pa] of pines) A.pineTree(px, py, pl * 1.15, '#334b46', 0.62, 0, pa);
    }
    function gate() {
      const cx = 640;
      // 门楼石体：让屋顶、门洞和桥落在同一座山门上
      const body = [
        [cx - 196, 302], [cx + 196, 302], [cx + 214, 664],
        [cx + 74, 664], [cx + 74, 372], [cx - 74, 372], [cx - 74, 664], [cx - 214, 664],
      ];
      sharpPoly(body, A.grad(cx - 214, 302, cx + 214, 664, [[0, '#6b837b'], [0.55, '#5a736c'], [1, '#4c635d']]));
      C.save();
      sharpPoly(body);
      C.clip();
      C.strokeStyle = 'rgba(232,240,232,.13)';
      C.lineWidth = 1.3;
      for (let y = 338; y < 664; y += 36) {
        C.beginPath(); C.moveTo(cx - 220, y); C.lineTo(cx + 220, y); C.stroke();
      }
      for (let x = cx - 196; x <= cx + 196; x += 56) {
        C.beginPath(); C.moveTo(x, 302); C.lineTo(x, 664); C.stroke();
      }
      for (let i = 0; i < 14; i++) {
        const gx = cx - 220 + ((i * 97) % 440);
        const gy = 330 + ((i * 53) % 300);
        A.softEllipse(gx, gy, 6 + (i % 3) * 4, 3 + (i % 2) * 3, '#8ea79b', 0.16);
      }
      C.restore();
      // 门内天光与门框
      A.softEllipse(cx, 470, 150, 200, '#fff8e6', 0.7);
      C.fillStyle = '#3f5a54';
      C.fillRect(cx - 78, 358, 16, 306);
      C.fillRect(cx + 62, 358, 16, 306);
      C.fillStyle = '#536b66';
      C.fillRect(cx - 98, 312, 196, 22);
      C.fillRect(cx - 116, 282, 232, 18);
      C.fillStyle = 'rgba(226,198,140,.45)';
      C.fillRect(cx - 98, 326, 196, 4);
      C.fillRect(cx - 116, 294, 232, 4);
      // 门楼顶
      C.beginPath();
      C.moveTo(cx - 212, 300);
      C.quadraticCurveTo(cx - 112, 232, cx, 218);
      C.quadraticCurveTo(cx + 112, 232, cx + 212, 300);
      C.quadraticCurveTo(cx + 112, 280, cx, 276);
      C.quadraticCurveTo(cx - 112, 280, cx - 212, 300);
      C.closePath();
      C.fillStyle = '#4a615c';
      C.fill();
      C.strokeStyle = 'rgba(214,190,140,.6)';
      C.lineWidth = 2.4;
      C.beginPath();
      C.moveTo(cx - 212, 300);
      C.quadraticCurveTo(cx - 112, 232, cx, 218);
      C.quadraticCurveTo(cx + 112, 232, cx + 212, 300);
      C.stroke();
      C.strokeStyle = 'rgba(230,240,232,.18)';
      C.lineWidth = 1.4;
      for (let i = -5; i <= 5; i++) {
        C.beginPath();
        C.moveTo(cx + i * 24, 276);
        C.quadraticCurveTo(cx + i * 30, 252, cx + i * 36, 236 + Math.abs(i) * 3);
        C.stroke();
      }
      // 檐角风铃
      for (const x of [cx - 212, cx + 212]) {
        C.strokeStyle = 'rgba(214,190,140,.5)';
        C.lineWidth = 1.2;
        C.beginPath(); C.moveTo(x, 300); C.lineTo(x, 320); C.stroke();
        C.fillStyle = '#d8b878';
        C.beginPath(); C.arc(x, 324, 4, 0, TAU); C.fill();
      }
      // 门前挂灯
      for (const x of [cx - 112, cx + 112]) {
        A.softEllipse(x, 392, 18, 24, '#f4c274', 0.45);
        C.fillStyle = '#c56b43';
        C.beginPath(); C.ellipse(x, 392, 8, 12, 0, 0, TAU); C.fill();
      }
    }
    S.push({
      title: '天关 · 宏大', short: '天关',
      tags: '宏大 · 天险 · 无畏',
      sub: '两山之间只留一道门。水从门里落下去，它从桥上走过去——世界忽然变得很小。',
      draw(t) {
        A.sky([[0, '#f3f8f5'], [0.48, '#e7f1ed'], [1, '#d6e5e0']]);
        A.sun(640, 176, 42, '#fff8e2', '#ffeec6');
        A.rays(640, 176, 8, 600, 1.15, '#ffffff', 0.1, t);
        // 门后的远山
        A.inkRidge({ base: 430, amp: 34, seed: 51, waves: 1.4, color: '#b6c8c1', alpha: 0.2, bottom: 560, grain: 18 });
        A.inkRidge({ base: 468, amp: 24, seed: 52, waves: 1.2, color: '#a4b9b2', alpha: 0.24, bottom: 580, grain: 16 });
        A.mist(520, 60, '#ffffff', 0.36, 53, t, 6);
        // 门后崖壁：把天门嵌进山体，而不是悬在空中
        const wallPts = [[410, 760], [420, 470], [438, 386], [462, 340], [492, 356], [522, 312], [560, 330], [600, 296], [640, 312], [680, 292], [720, 322], [758, 300], [792, 344], [816, 400], [830, 500], [838, 760]];
        sharpPoly(wallPts, A.grad(500, 300, 780, 760, [[0, 'rgba(58,80,75,.86)'], [0.5, 'rgba(68,88,82,.76)'], [1, 'rgba(84,101,94,.58)']]));
        C.save();
        sharpPoly(wallPts);
        C.clip();
        const wr = rng(5150);
        for (let i = 0; i < 16; i++) {
          const x = 490 + wr() * 300;
          const y = 320 + wr() * 330;
          C.strokeStyle = `rgba(30,50,47,${0.12 + wr() * 0.16})`;
          C.lineWidth = 1.2 + wr() * 2;
          C.beginPath(); C.moveTo(x, y); C.quadraticCurveTo(x + 20, y + 30, x + 8, y + 70); C.stroke();
        }
        for (let i = 0; i < 12; i++) {
          A.softEllipse(500 + wr() * 280, 340 + wr() * 300, 10 + wr() * 16, 5 + wr() * 8, '#7f9a6c', 0.12 + wr() * 0.1);
        }
        C.restore();
        // 门洞里的天光
        C.fillStyle = 'rgba(246,251,247,.94)';
        C.beginPath();
        C.moveTo(604, 664);
        C.lineTo(604, 360);
        C.quadraticCurveTo(640, 320, 676, 360);
        C.lineTo(676, 664);
        C.closePath();
        C.fill();
        C.strokeStyle = 'rgba(44,64,60,.45)';
        C.lineWidth = 5;
        C.stroke();
        gate();
        // 瀑布从门内落下，严格留在门洞里
        C.fillStyle = 'rgba(38,60,56,.2)';
        C.fillRect(606, 362, 68, 204);
        C.save();
        C.beginPath();
        C.moveTo(606, 664); C.lineTo(606, 362);
        C.quadraticCurveTo(640, 326, 674, 362);
        C.lineTo(674, 664); C.closePath();
        C.clip();
        A.waterfall(640, 330, 70, 338, '#effaf7', t, 0.95);
        C.restore();
        A.softEllipse(640, 664, 130, 22, '#ffffff', 0.5);
        A.mist(668, 58, '#ffffff', 0.55, 54, t, 8);
        // 两侧山体
        rock(-1);
        rock(1);
        A.inkRidge({ base: 678, amp: 18, seed: 55, waves: 1.5, color: '#8ba09a', alpha: 0.24, bottom: 760, grain: 30 });
        // 石桥
        const x0 = 150, x1 = 1130;
        const deckY = (x) => bridgeY(x, x0, x1, 652, 594, 10);
        // 桥拱下的雾
        C.fillStyle = 'rgba(229,240,235,.92)';
        C.beginPath();
        C.moveTo(340, deckY(340) + 14);
        C.quadraticCurveTo(640, 748, 940, deckY(940) + 14);
        C.lineTo(940, 760); C.lineTo(340, 760);
        C.closePath(); C.fill();
        // 桥体
        C.strokeStyle = '#bcab90';
        C.lineWidth = 26;
        C.beginPath(); C.moveTo(x0, deckY(x0));
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x));
        C.stroke();
        C.strokeStyle = 'rgba(255,250,238,.8)';
        C.lineWidth = 3;
        C.beginPath(); C.moveTo(x0, deckY(x0) - 13);
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x) - 13);
        C.stroke();
        // 桥体石拱：实心拱肩 + 拱洞
        const ax0 = 340, ax1 = 940;
        C.fillStyle = '#a8977e';
        C.beginPath();
        C.moveTo(ax0, deckY(ax0) + 12);
        for (let x = ax0; x <= ax1; x += 16) C.lineTo(x, deckY(x) + 12);
        C.lineTo(ax1, 714);
        C.lineTo(ax0, 714);
        C.closePath();
        C.fill();
        C.fillStyle = 'rgba(226,238,233,.96)';
        C.beginPath();
        C.moveTo(ax0 + 48, 714);
        C.lineTo(ax0 + 48, 670);
        C.quadraticCurveTo(640, 630, ax1 - 48, 670);
        C.lineTo(ax1 - 48, 714);
        C.closePath();
        C.fill();
        C.strokeStyle = '#8d7b63';
        C.lineWidth = 12;
        C.beginPath();
        C.moveTo(ax0 + 48, 670);
        C.quadraticCurveTo(640, 630, ax1 - 48, 670);
        C.stroke();
        C.strokeStyle = 'rgba(255,250,238,.28)';
        C.lineWidth = 2;
        C.beginPath();
        C.moveTo(ax0 + 48, 664);
        C.quadraticCurveTo(640, 624, ax1 - 48, 664);
        C.stroke();
        // 拱石与石缝
        for (let i = 0; i <= 12; i++) {
          const u = i / 12;
          const x = (1 - u) * (1 - u) * (ax0 + 48) + 2 * (1 - u) * u * 640 + u * u * (ax1 - 48);
          const y = (1 - u) * (1 - u) * 670 + 2 * (1 - u) * u * 630 + u * u * 670;
          C.strokeStyle = 'rgba(96,80,60,.24)';
          C.lineWidth = 1.3;
          C.beginPath(); C.moveTo(x, y - 7); C.lineTo(x, y + 7); C.stroke();
        }
        C.strokeStyle = 'rgba(96,80,60,.18)';
        C.lineWidth = 1.2;
        for (let x = ax0 + 70; x < ax1 - 50; x += 54) {
          C.beginPath(); C.moveTo(x, deckY(x) + 22); C.lineTo(x, 714); C.stroke();
        }
        C.fillStyle = 'rgba(96,80,60,.2)';
        C.fillRect(x0, deckY(x0) + 12, x1 - x0, 4);
        // 桥墩与栏板
        for (const x of [340, 940]) {
          C.fillStyle = '#a8987e';
          C.fillRect(x - 15, deckY(x) + 10, 30, 104);
          C.fillStyle = 'rgba(255,250,238,.28)';
          C.fillRect(x - 15, deckY(x) + 10, 6, 104);
        }
        for (let x = x0 + 20; x < x1; x += 38) {
          C.strokeStyle = 'rgba(128,106,80,.55)';
          C.lineWidth = 2;
          C.beginPath(); C.moveTo(x, deckY(x) - 12); C.lineTo(x, deckY(x) - 46); C.stroke();
          C.strokeStyle = 'rgba(128,106,80,.32)';
          C.beginPath(); C.moveTo(x, deckY(x) + 10); C.lineTo(x + 5, deckY(x) + 24); C.stroke();
        }
        C.strokeStyle = 'rgba(128,106,80,.62)';
        C.lineWidth = 2.2;
        C.beginPath();
        C.moveTo(x0, deckY(x0) - 46);
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x) - 46);
        C.stroke();
        // 桥上的牛马
        const w = A.walk(t, 372, 908, 24, 2.2);
        A.horse(w.x, deckY(w.x) - 13, { k: 14, dir: w.dir, mode: w.moving ? 'walk' : 'stand', t, travel: w.travel, gait: w.gait, auraColor: '#eef7f1', auraAlpha: 0.26, shadowColor: '#6d5b45' });
        // 前景松枝剪影
        A.pine(-28, 760, 250, -0.62, '#3e534f', t * 0.4, 0.34);
        A.pine(1300, 740, 220, Math.PI + 0.5, '#435753', t * 0.4 + 1, 0.3);
        A.lightDust(motes, t, '#ffffff');
        A.birds([{ x: 420, y: 214, p: 1, drift: 14, size: 4.2 }, { x: 470, y: 198, p: 3, drift: 10, size: 3.2 }], t, '#6d8580', 0.5);
        A.paper();
      },
    });
  })();

  // ── 06 白塔 · 未来 ─────────────────────────────────────────────
  (() => {
    const r = A.rng(6106);
    const towers = [];
    for (let i = 0; i < 12; i++) {
      towers.push({
        x: 28 + i * 104 + r() * 18,
        w: 38 + r() * 44,
        h: 110 + r() * 240,
        type: i % 4,
        accent: i % 5 === 1,
      });
    }
    const lights = [];
    for (let i = 0; i < 22; i++) lights.push({ x: r() * 1280, y: 240 + r() * 280, p: r() * TAU, r: 1.1 + r() * 1.8 });
    const fliers = [];
    for (let i = 0; i < 5; i++) fliers.push({ x: 180 + r() * 900, y: 210 + r() * 200, p: r() * TAU, sp: 0.25 + r() * 0.4 });
    const backTowers = [];
    for (let i = 0; i < 9; i++) backTowers.push({ x: 20 + i * 146 + r() * 30, w: 54 + r() * 50, h: 120 + r() * 190 });
    S.push({
      title: '白塔 · 未来', short: '白塔',
      tags: '未来 · 白塔 · 清澈',
      sub: '城市是白的，天也是白的。它沿着空中连廊跑向塔尖，那里有一束不会落下的光。',
      draw(t) {
        A.sky([[0, '#e9f7fe'], [0.48, '#d4edf9'], [1, '#bfe1ef']]);
        A.sun(1080, 168, 40, '#fff8e6', '#fffdf2');
        C.fillStyle = 'rgba(255,250,232,.75)';
        C.beginPath(); C.arc(1080, 168, 31, 0, TAU); C.fill();
        A.inkRidge({ base: 506, amp: 26, seed: 61, waves: 1.4, color: '#b7dbe8', alpha: 0.22, bottom: 620, grain: 18 });
        A.inkRidge({ base: 552, amp: 18, seed: 62, waves: 1.2, color: '#a4cede', alpha: 0.26, bottom: 700, grain: 20 });
        // 远景楼群
        for (const b of backTowers) {
          const top = 552 - b.h;
          C.fillStyle = 'rgba(146,192,214,.72)';
          C.beginPath();
          C.moveTo(b.x, 552); C.lineTo(b.x + b.w * 0.1, top);
          C.lineTo(b.x + b.w * 0.9, top); C.lineTo(b.x + b.w, 552);
          C.closePath(); C.fill();
        }
        // 白塔
        const sx = 930;
        A.softEllipse(sx, 300, 210, 300, '#ffffff', 0.5);
        C.fillStyle = A.vgrad(112, 570, [[0, '#ffffff'], [0.55, '#effbff'], [1, '#d8eef7']]);
        C.beginPath();
        C.moveTo(sx - 76, 570);
        C.lineTo(sx - 42, 208);
        C.lineTo(sx - 16, 136);
        C.lineTo(sx, 112);
        C.lineTo(sx + 16, 136);
        C.lineTo(sx + 42, 208);
        C.lineTo(sx + 76, 570);
        C.closePath(); C.fill();
        C.strokeStyle = 'rgba(132,184,204,.4)';
        C.lineWidth = 1.4;
        C.stroke();
        C.strokeStyle = 'rgba(140,196,216,.34)';
        C.lineWidth = 1.4;
        for (let y = 220; y < 558; y += 30) {
          C.beginPath(); C.moveTo(sx - 62 + (y - 220) * 0.04, y); C.lineTo(sx + 62 - (y - 220) * 0.04, y); C.stroke();
        }
        C.fillStyle = 'rgba(255,255,255,.85)';
        C.fillRect(sx - 12, 96, 24, 22);
        A.softEllipse(sx, 94, 34, 10, '#ffffff', 0.8);
        // 悬浮环
        for (let k = 0; k < 3; k++) {
          C.save();
          C.translate(sx, 260 + k * 64);
          C.rotate(-0.12 + Math.sin(t * 0.3 + k) * 0.02);
          C.strokeStyle = rgba(k === 1 ? '#efaa8d' : '#8fd2e7', 0.6 - k * 0.1);
          C.lineWidth = 4.2 - k * 0.8;
          C.setLineDash([28, 14]);
          C.lineDashOffset = -t * (14 + k * 6);
          C.beginPath(); C.ellipse(0, 0, 168 + k * 44, 22 + k * 8, 0, 0, TAU); C.stroke();
          C.setLineDash([]);
          C.restore();
        }
        // 城市
        for (const b of towers) {
          const top = 570 - b.h;
          const g = A.vgrad(top, 570, [[0, '#ffffff'], [0.68, '#ecf8fd'], [1, '#bedbe9']]);
          C.fillStyle = g;
          C.beginPath();
          if (b.type === 0) {
            C.moveTo(b.x, 570); C.lineTo(b.x, top + 10);
            C.quadraticCurveTo(b.x + b.w / 2, top - 8, b.x + b.w, top + 10);
            C.lineTo(b.x + b.w, 570);
          } else if (b.type === 1) {
            C.moveTo(b.x, 570); C.lineTo(b.x + b.w * 0.14, top);
            C.lineTo(b.x + b.w * 0.86, top);
            C.lineTo(b.x + b.w, 570);
          } else if (b.type === 2) {
            C.moveTo(b.x, 570); C.lineTo(b.x, top + 26);
            C.lineTo(b.x + b.w * 0.28, top);
            C.lineTo(b.x + b.w * 0.72, top);
            C.lineTo(b.x + b.w, top + 26);
            C.lineTo(b.x + b.w, 570);
          } else {
            C.moveTo(b.x, 570); C.lineTo(b.x + b.w * 0.1, top);
            C.lineTo(b.x + b.w * 0.9, top);
            C.lineTo(b.x + b.w, 570);
          }
          C.closePath(); C.fill();
          C.strokeStyle = 'rgba(110,168,190,.5)';
          C.lineWidth = 1.4;
          C.stroke();
          C.fillStyle = 'rgba(92,144,168,.34)';
          C.fillRect(b.x + b.w * 0.78, top + 12, b.w * 0.2, 570 - top - 16);
          A.softEllipse(b.x + b.w / 2, 572, b.w * 0.62, 7, '#8fbccc', 0.34);
          C.fillStyle = 'rgba(150,196,214,.3)';
          C.fillRect(b.x + b.w * 0.78, top + 14, b.w * 0.16, 570 - top - 20);
          C.strokeStyle = 'rgba(140,192,212,.5)';
          C.lineWidth = 1;
          for (let y = top + 24; y < 558; y += 22) {
            C.beginPath(); C.moveTo(b.x + 5, y); C.lineTo(b.x + b.w - 5, y); C.stroke();
          }
          if (b.accent) {
            C.fillStyle = 'rgba(240,166,138,.5)';
            C.fillRect(b.x + b.w * 0.42, top + 26, b.w * 0.16, b.h * 0.5);
            C.fillStyle = 'rgba(124,196,162,.34)';
            C.fillRect(b.x + b.w * 0.18, top + 40, b.w * 0.12, b.h * 0.28);
          }
          C.strokeStyle = 'rgba(180,220,234,.65)';
          C.lineWidth = 2;
          C.beginPath(); C.moveTo(b.x + b.w * 0.5, top); C.lineTo(b.x + b.w * 0.5, top - 16); C.stroke();
          A.softEllipse(b.x + b.w * 0.5, top - 18, 5, 5, '#ffd9c6', 0.5);
        }
        // 空中连廊：宽桥面 + 实体栏板 + 两端真正落进建筑
        const x0 = 190, x1 = 972;
        const deckY = (x) => bridgeY(x, x0, x1, 606, 534, 8);
        // 桥体投在云上的影
        C.strokeStyle = 'rgba(120,180,204,.14)';
        C.lineWidth = 64;
        C.beginPath(); C.moveTo(x0, deckY(x0) + 22);
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x) + 22);
        C.stroke();
        // 桥面
        C.strokeStyle = 'rgba(255,255,255,.98)';
        C.lineWidth = 46;
        C.beginPath(); C.moveTo(x0, deckY(x0));
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x));
        C.stroke();
        // 桥面顶沿与底沿
        C.strokeStyle = 'rgba(238,251,255,.95)';
        C.lineWidth = 3;
        C.beginPath(); C.moveTo(x0, deckY(x0) - 22);
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x) - 22);
        C.stroke();
        C.strokeStyle = 'rgba(146,198,216,.6)';
        C.lineWidth = 4;
        C.beginPath(); C.moveTo(x0, deckY(x0) + 22);
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x) + 22);
        C.stroke();
        // 桥面接缝
        C.strokeStyle = 'rgba(150,200,220,.2)';
        C.lineWidth = 1.4;
        for (let x = x0 + 30; x < x1; x += 54) {
          const y = deckY(x);
          C.beginPath(); C.moveTo(x, y - 20); C.lineTo(x, y + 20); C.stroke();
        }
        // 栏板：立柱 + 玻璃 + 上下扶手（在牛马之后画，牛马才在桥面里）
        const drawRail = () => {
          for (let x = x0 + 10; x < x1; x += 44) {
            C.strokeStyle = 'rgba(255,255,255,.96)';
            C.lineWidth = 3.2;
            C.beginPath(); C.moveTo(x, deckY(x) - 22); C.lineTo(x, deckY(x) - 58); C.stroke();
            C.fillStyle = 'rgba(255,255,255,.9)';
            C.fillRect(x - 2, deckY(x) - 60, 4, 4);
          }
          C.strokeStyle = 'rgba(215,242,250,.3)';
          C.lineWidth = 26;
          C.beginPath(); C.moveTo(x0, deckY(x0) - 40);
          for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x) - 40);
          C.stroke();
          C.strokeStyle = 'rgba(255,255,255,.95)';
          C.lineWidth = 3;
          C.beginPath(); C.moveTo(x0, deckY(x0) - 58);
          for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x) - 58);
          C.stroke();
          C.strokeStyle = 'rgba(150,205,224,.4)';
          C.lineWidth = 2;
          C.beginPath(); C.moveTo(x0, deckY(x0) - 24);
          for (let x = x0; x <= x1; x += 16) C.lineTo(x, deckY(x) - 24);
          C.stroke();
        };
        // 桥头灯
        for (let x = x0 + 64; x < x1; x += 132) {
          A.softEllipse(x, deckY(x) - 62, 7, 7, '#ffd9c6', 0.5);
          C.fillStyle = 'rgba(255,242,220,.95)';
          C.beginPath(); C.arc(x, deckY(x) - 62, 2.2, 0, TAU); C.fill();
        }
        // 左端：桥头堡，牛马从这里上桥
        const lx = x0, ly = deckY(lx);
        C.fillStyle = 'rgba(255,255,255,.98)';
        C.fillRect(108, ly - 88, 92, 118);
        C.strokeStyle = 'rgba(120,176,198,.45)';
        C.lineWidth = 1.6;
        C.strokeRect(108, ly - 88, 92, 118);
        C.fillStyle = 'rgba(150,205,226,.35)';
        C.fillRect(108, ly - 88, 16, 118);
        C.fillStyle = 'rgba(255,255,255,.99)';
        C.beginPath();
        C.moveTo(178, ly + 28); C.lineTo(178, ly - 34);
        C.quadraticCurveTo(200, ly - 64, 222, ly - 34);
        C.lineTo(222, ly + 28); C.closePath(); C.fill();
        C.fillStyle = 'rgba(126,184,208,.5)';
        C.beginPath();
        C.moveTo(192, ly + 26); C.lineTo(192, ly - 30);
        C.quadraticCurveTo(200, ly - 46, 208, ly - 30);
        C.lineTo(208, ly + 26); C.closePath(); C.fill();
        C.fillStyle = 'rgba(214,240,248,.9)';
        C.fillRect(126, ly + 32, 10, 92);
        C.fillRect(170, ly + 32, 8, 88);
        // 右端：桥面收进白塔门洞（在牛马之后画，牛马是"走进门里"）
        const drawRightDoor = () => {
          C.strokeStyle = 'rgba(146,198,216,.65)';
          C.lineWidth = 8;
          C.beginPath();
          C.moveTo(930, deckY(x1) + 30); C.lineTo(930, deckY(x1) - 40);
          C.quadraticCurveTo(972, deckY(x1) - 116, 1014, deckY(x1) - 40);
          C.lineTo(1014, deckY(x1) + 30);
          C.stroke();
          C.fillStyle = 'rgba(126,184,208,.35)';
          C.beginPath();
          C.moveTo(944, deckY(x1) + 28); C.lineTo(944, deckY(x1) - 34);
          C.quadraticCurveTo(972, deckY(x1) - 96, 1000, deckY(x1) - 34);
          C.lineTo(1000, deckY(x1) + 28); C.closePath(); C.fill();
        };
        // 桥墩伸进云里
        for (let x = x0 + 150; x < x1 - 80; x += 190) {
          C.fillStyle = 'rgba(255,255,255,.9)';
          C.fillRect(x - 7, deckY(x) + 22, 14, 54);
          C.fillStyle = 'rgba(146,198,216,.3)';
          C.fillRect(x - 7, deckY(x) + 22, 5, 54);
          A.softEllipse(x, deckY(x) + 78, 34, 13, '#ffffff', 0.55);
        }
        // 飞行器
        for (const f of fliers) {
          const x = f.x + Math.sin(t * f.sp + f.p) * 70;
          const y = f.y + Math.cos(t * f.sp * 0.8 + f.p) * 26;
          C.strokeStyle = 'rgba(255,255,255,.55)';
          C.lineWidth = 1.4;
          C.beginPath(); C.moveTo(x - 34, y + 4); C.lineTo(x, y); C.stroke();
          C.fillStyle = '#ffffff';
          C.beginPath(); C.ellipse(x, y, 7, 3, 0, 0, TAU); C.fill();
          C.fillStyle = 'rgba(240,166,138,.85)';
          C.beginPath(); C.arc(x + 5, y - 1, 1.8, 0, TAU); C.fill();
        }
        A.cloudSea(610, '#ffffff', 63, t, 5, 20, 0.9);
        A.mist(566, 56, '#ffffff', 0.28, 64, t, 6);
        // 单向循环：从左桥头堡出来 → 走进右塔门洞 → 隐去 → 下一匹再从左边出现
        const cu = ((t / 20 + 0.3) % 1 + 1) % 1;
        const walkFrac = 0.78;
        if (cu < walkFrac) {
          const p = cu / walkFrac;
          const hx = 205 + p * (948 - 205);
          const fade = Math.min(1, Math.min((hx - 205) / 42, (948 - hx) / 36));
          if (fade > 0.01) {
            A.horse(hx, deckY(hx) - 22, { k: 10.5, dir: 1, mode: 'walk', t, travel: hx - 205, gait: 1, alpha: fade, auraColor: '#ffffff', auraAlpha: 0.22, shadowColor: '#7f9baa' });
          }
        }
        drawRail();
        drawRightDoor();
        A.lightDust(lights, t, '#ffffff');
        A.birds([{ x: 420, y: 236, p: 1.4, drift: 16, size: 3.4 }, { x: 466, y: 220, p: 3.2, drift: 12, size: 2.8 }], t, '#78a9bd', 0.42);
        A.paper();
      },
    });
  })();

  // ── 07 云桥 · 勇敢 ─────────────────────────────────────────────
  (() => {
    const x0 = 300, x1 = 1120;
    const deck = (x, t) => bridgeY(x, x0, x1, 536, 468, 30) + Math.sin(t * 0.7) * 1.2;
    const birds = [
      { x: 400, y: 212, p: 0.6, drift: 18, size: 5 },
      { x: 456, y: 194, p: 2.4, drift: 14, size: 4 },
      { x: 506, y: 220, p: 4.2, drift: 10, size: 3.2 },
    ];
    const r = A.rng(7107);
    const puffs = [];
    for (let i = 0; i < 20; i++) puffs.push({ x: 120 + r() * 1040, y: 574 + r() * 118, rx: 70 + r() * 140, ry: 22 + r() * 38, a: 0.3 + r() * 0.3, sp: 4 + r() * 8 });
    S.push({
      title: '云桥 · 勇敢', short: '云桥',
      tags: '勇敢 · 桥 · 风',
      sub: '桥下不是深渊，是慢慢流动的云。它把每一步都踩实，然后继续往更亮的地方走。',
      draw(t) {
        A.sky([[0, '#eef9ff'], [0.5, '#dbedfc'], [1, '#c7e1f5']]);
        A.sun(1004, 172, 54, '#fff5d6', '#fff9e8');
        C.fillStyle = 'rgba(255,242,206,.7)';
        C.beginPath(); C.arc(1004, 172, 42, 0, TAU); C.fill();
        A.rays(1004, 172, 6, 520, 1.2, '#ffffff', 0.13, t);
        A.inkRidge({ base: 474, amp: 40, seed: 71, waves: 1.3, color: '#b6d5e8', alpha: 0.2, bottom: 600, grain: 18 });
        A.inkRidge({ base: 512, amp: 28, seed: 72, waves: 1.1, color: '#a4c9e0', alpha: 0.22, bottom: 640, grain: 16 });
        A.cloudSea(558, '#ffffff', 73, t, 7, 24, 0.95);
        A.mist(548, 72, '#ffffff', 0.42, 74, t, 8);
        // 云的体积
        for (const p of puffs) {
          const x = ((p.x + t * p.sp) % (A.VW + 300)) - 150;
          softCloud(x, p.y, p.rx, p.ry, p.a);
        }
        // 左侧崖台
        const cliffPts = [[-40, 492], [48, 486], [112, 494], [172, 510], [226, 536], [282, 574], [304, 620], [286, 760], [-40, 760]];
        const rockG = A.grad(0, 470, 300, 760, [[0, 'rgba(142,132,116,.66)'], [0.55, 'rgba(112,103,90,.5)'], [1, 'rgba(92,84,74,.34)']]);
        sharpPoly(cliffPts, rockG);
        C.save();
        sharpPoly(cliffPts);
        C.clip();
        const rk = rng(7108);
        for (let i = 0; i < 20; i++) {
          const x = rk() * 300;
          const y = 480 + rk() * 280;
          const w = 26 + rk() * 80;
          const h = 20 + rk() * 60;
          C.fillStyle = rk() < 0.5 ? `rgba(255,246,232,${0.05 + rk() * 0.08})` : `rgba(60,54,46,${0.05 + rk() * 0.09})`;
          C.beginPath();
          C.moveTo(x, y); C.quadraticCurveTo(x + w * 0.4, y - h * 0.2, x + w, y + h * 0.1);
          C.lineTo(x + w * 0.7, y + h); C.quadraticCurveTo(x + w * 0.2, y + h * 0.8, x, y);
          C.closePath(); C.fill();
        }
        for (let i = 0; i < 8; i++) {
          const x = 40 + rk() * 220;
          const y = 500 + rk() * 230;
          C.strokeStyle = `rgba(66,57,47,${0.22 + rk() * 0.2})`;
          C.lineWidth = 1.2 + rk() * 1.8;
          C.beginPath(); C.moveTo(x, y); C.quadraticCurveTo(x + 18, y + 20, x + 8, y + 56); C.stroke();
        }
        C.restore();
        A.brush([[70, 488], [152, 500], [228, 540], [290, 590]], 5, '#4f493f', 0.5);
        for (let i = 0; i < 10; i++) {
          A.softEllipse(30 + rk() * 240, 500 + rk() * 220, 8 + rk() * 18, 4 + rk() * 9, '#7f9a6c', 0.08 + rk() * 0.12);
        }
        A.pineTree(104, 500, 136, '#3d5149', 0.58, t, 0.4);
        A.pineTree(216, 538, 98, '#455a50', 0.5, t, 1.6);
        A.grassField(498, 542, 52, '#4f5d48', 75, t, { minH: 7, maxH: 22, alpha: 0.3, width: 1.3 });
        // 右侧桥塔
        C.fillStyle = A.vgrad(410, 626, [[0, '#d4c6ae'], [1, '#9b8a72']]);
        C.fillRect(1108, 420, 46, 204);
        C.fillStyle = '#c2b198';
        C.fillRect(1096, 412, 70, 16);
        C.fillRect(1088, 606, 86, 16);
        C.strokeStyle = 'rgba(255,250,238,.45)';
        C.lineWidth = 2;
        C.beginPath(); C.moveTo(1116, 434); C.lineTo(1116, 606); C.stroke();
        C.strokeStyle = 'rgba(96,80,60,.24)';
        C.lineWidth = 1.4;
        for (let y = 446; y < 600; y += 28) {
          C.beginPath(); C.moveTo(1108, y); C.lineTo(1154, y); C.stroke();
        }
        C.strokeStyle = 'rgba(120,100,76,.55)';
        C.lineWidth = 2;
        C.beginPath(); C.moveTo(1131, 412); C.lineTo(1131, 380); C.stroke();
        C.fillStyle = 'rgba(180,72,60,.7)';
        C.beginPath(); C.moveTo(1131, 382); C.quadraticCurveTo(1152, 388, 1158, 400); C.lineTo(1131, 402); C.closePath(); C.fill();
        // 桥面
        C.strokeStyle = 'rgba(198,182,156,.98)';
        C.lineWidth = 20;
        C.beginPath(); C.moveTo(x0, deck(x0, t));
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deck(x, t));
        C.stroke();
        C.strokeStyle = 'rgba(255,252,242,.92)';
        C.lineWidth = 3;
        C.beginPath(); C.moveTo(x0, deck(x0, t) - 10);
        for (let x = x0; x <= x1; x += 16) C.lineTo(x, deck(x, t) - 10);
        C.stroke();
        for (let x = x0 + 14; x < x1; x += 28) {
          C.strokeStyle = 'rgba(112,92,68,.38)';
          C.lineWidth = 1.3;
          C.beginPath(); C.moveTo(x, deck(x, t) - 9); C.lineTo(x + 4, deck(x, t) + 10); C.stroke();
        }
        // 主索与吊索
        for (const off of [-1, 1]) {
          C.strokeStyle = 'rgba(104,86,64,.5)';
          C.lineWidth = 2.2;
          C.beginPath();
          C.moveTo(x0, deck(x0, t) - 96);
          for (let x = x0; x <= x1; x += 16) {
            const u = (x - x0) / (x1 - x0);
            C.lineTo(x, deck(x, t) - 96 - Math.sin(u * Math.PI) * 18 + off * 12);
          }
          C.stroke();
          for (let x = x0 + 20; x < x1; x += 42) {
            const u = (x - x0) / (x1 - x0);
            const cy = deck(x, t) - 96 - Math.sin(u * Math.PI) * 18 + off * 12;
            C.strokeStyle = 'rgba(104,86,64,.34)';
            C.lineWidth = 1.2;
            C.beginPath(); C.moveTo(x, cy); C.lineTo(x, deck(x, t) - 10); C.stroke();
          }
        }
        for (const x of [x0, x1]) {
          C.fillStyle = 'rgba(120,101,78,.75)';
          C.fillRect(x - 4, deck(x, t) - 100, 8, 100);
        }
        wind(300 + Math.sin(t * 0.3) * 24, 330, 720, 286, '#ffffff', 0.34);
        wind(620, 244, 1020, 230, '#ffffff', 0.24);
        const w = A.walk(t, 382, 1010, 24, 4.1);
        A.horse(w.x, deck(w.x, t) - 10, { k: 15, dir: w.dir, mode: w.moving ? 'walk' : 'stand', t, travel: w.travel, gait: w.gait, auraColor: '#ffffff', auraAlpha: 0.34, shadowColor: '#7a6a56' });
        A.birds(birds, t, '#7596ac', 0.5);
        A.paper();
      },
    });
  })();

  // ── 08 潮汐 · 无畏 ─────────────────────────────────────────────
  (() => {
    const r = A.rng(8108);
    const spray = [];
    for (let i = 0; i < 90; i++) spray.push({ x: 830 + r() * 430, y: 210 + r() * 330, r: 0.9 + r() * 2.8, p: r() * TAU, sp: 0.5 + r() * 1.5 });
    const foam = [];
    for (let i = 0; i < 34; i++) foam.push({ x: 760 + r() * 520, y: 500 + r() * 150, rx: 8 + r() * 30, ry: 3 + r() * 8, a: 0.12 + r() * 0.3 });
    S.push({
      title: '潮汐 · 无畏', short: '潮汐',
      tags: '无畏 · 无惧 · 浪',
      sub: '浪比它高，声音比它大。它没有退，只是把蹄子往湿沙里再踩深一点。',
      draw(t) {
        A.sky([[0, '#eafafb'], [0.5, '#d4f1f4'], [1, '#bce7eb']]);
        A.sun(1038, 178, 50, '#fff7dc', '#fffdf0');
        C.fillStyle = 'rgba(255,248,220,.72)';
        C.beginPath(); C.arc(1038, 178, 40, 0, TAU); C.fill();
        A.inkRidge({ base: 424, amp: 10, seed: 81, waves: 1.2, color: '#9fd8e0', alpha: 0.3, bottom: 520, grain: 12 });
        A.water(432, [[0, '#a9e1e7'], [0.45, '#61b6c5'], [1, '#358ba0']], 82, t);
        // 远处浪线与小舟
        for (let i = 0; i < 5; i++) {
          C.strokeStyle = `rgba(255,255,255,${0.16 - i * 0.02})`;
          C.lineWidth = 2;
          C.beginPath();
          C.moveTo(0, 446 + i * 26);
          for (let x = 0; x <= 760; x += 30) C.lineTo(x, 446 + i * 26 + Math.sin(x * 0.013 + t * 0.5 + i) * 3);
          C.stroke();
        }
        C.fillStyle = 'rgba(84,70,56,.4)';
        C.beginPath(); C.moveTo(250, 438); C.quadraticCurveTo(272, 449, 300, 438); C.quadraticCurveTo(274, 443, 250, 438); C.fill();
        C.strokeStyle = 'rgba(84,70,56,.34)';
        C.lineWidth = 1.2;
        C.beginPath(); C.moveTo(274, 438); C.lineTo(274, 412); C.lineTo(288, 424); C.stroke();
        // 后浪主体：向右后方退开，给卷唇留出悬挑空间
        C.beginPath();
        C.moveTo(900, 676);
        C.bezierCurveTo(930, 540, 980, 400, 1058, 302);
        C.bezierCurveTo(1098, 248, 1158, 226, 1210, 250);
        C.bezierCurveTo(1258, 302, 1278, 384, 1280, 470);
        C.lineTo(1280, 676);
        C.closePath();
        C.fillStyle = A.grad(980, 230, 1240, 676, [[0, '#b4e7eb'], [0.34, '#6fc0cf'], [0.72, '#3f9cb1'], [1, '#2b7f95']]);
        C.fill();
        // 后浪内面的暗部
        A.softEllipse(1068, 430, 78, 126, '#1f6d83', 0.32);
        A.softEllipse(1104, 512, 60, 90, '#1b6178', 0.24);
        // 卷唇：从浪顶向左侧悬挑，唇下是空的
        C.beginPath();
        C.moveTo(1058, 302);
        C.bezierCurveTo(1000, 286, 930, 298, 872, 326);
        C.bezierCurveTo(852, 338, 852, 358, 866, 374);
        C.bezierCurveTo(900, 402, 942, 424, 982, 434);
        C.bezierCurveTo(1012, 402, 1032, 352, 1058, 302);
        C.closePath();
        C.fillStyle = A.grad(860, 290, 1060, 440, [[0, '#a8e3e6'], [0.55, '#63b8c8'], [1, '#3d97ac']]);
        C.fill();
        // 卷唇下缘的暗面（给唇厚度）
        C.beginPath();
        C.moveTo(872, 326);
        C.bezierCurveTo(852, 338, 852, 358, 866, 374);
        C.bezierCurveTo(900, 402, 942, 424, 982, 434);
        C.bezierCurveTo(1012, 402, 1032, 352, 1058, 302);
        C.bezierCurveTo(1038, 330, 1018, 368, 1000, 396);
        C.bezierCurveTo(968, 418, 928, 404, 898, 388);
        C.bezierCurveTo(880, 372, 874, 350, 872, 326);
        C.closePath();
        C.fillStyle = 'rgba(28,92,110,.42)';
        C.fill();
        // 卷唇外缘白沫
        C.save();
        C.shadowColor = 'rgba(255,255,255,.55)';
        C.shadowBlur = 12;
        C.strokeStyle = 'rgba(255,255,255,.98)';
        C.lineWidth = 12;
        C.beginPath();
        C.moveTo(1058, 302);
        C.bezierCurveTo(1000, 286, 930, 298, 872, 326);
        C.bezierCurveTo(852, 338, 852, 358, 866, 374);
        C.stroke();
        C.restore();
        // 沿外缘的泡沫颗粒，打散“刀锋”感
        for (let i = 0; i < 26; i++) {
          const u = i / 25;
          const x = 1058 - u * 190 + Math.sin(t * 1.7 + i) * 3;
          const y = 300 - Math.sin(u * Math.PI * 0.9) * 18 + u * 72;
          A.softEllipse(x, y, 7 + (i % 4) * 3, 5 + (i % 3) * 2, '#ffffff', 0.85);
        }
        // 卷唇内缘泡沫与浪爪
        for (let i = 0; i < 18; i++) {
          const u = i / 17;
          const x = 870 + u * 118 + Math.sin(t * 1.4 + i) * 4;
          const y = 340 + u * 94 + Math.cos(t * 1.1 + i) * 5;
          const rr = 15 - u * 6 + Math.sin(t * 2 + i) * 1.5;
          A.softEllipse(x, y, rr, rr * 0.86, '#ffffff', 0.94);
          if (i % 2 === 0) {
            C.strokeStyle = 'rgba(255,255,255,.8)';
            C.lineWidth = 2.4;
            C.beginPath();
            C.moveTo(x, y + rr * 0.7);
            C.quadraticCurveTo(x + 6, y + rr * 1.8, x + 1, y + rr * 2.6);
            C.stroke();
          }
        }
        // 卷唇处的水雾团
        for (let i = 0; i < 14; i++) {
          A.softEllipse(878 + Math.sin(t * 1.2 + i) * 14, 366 + i * 8, 24 + i * 3, 15 + i, '#ffffff', 0.34 - i * 0.018);
        }
        // 后浪左缘的雾，遮住水体直边
        A.softEllipse(1002, 470, 84, 180, '#b9e6ea', 0.3);
        A.softEllipse(1036, 560, 64, 96, '#c4eaee', 0.24);
        for (let i = 0; i < 8; i++) {
          A.softEllipse(950 + Math.sin(t * 0.8 + i) * 10, 520 + i * 22, 42 + i * 4, 24 + i * 3, '#ffffff', 0.26 - i * 0.015);
        }
        // 浪顶白沫与浪体水墨线
        C.save();
        C.strokeStyle = 'rgba(255,255,255,.9)';
        C.lineWidth = 7;
        C.beginPath();
        C.moveTo(1058, 296);
        C.bezierCurveTo(1104, 252, 1164, 236, 1212, 258);
        C.bezierCurveTo(1252, 306, 1272, 380, 1278, 450);
        C.stroke();
        for (let i = 0; i < 7; i++) {
          C.strokeStyle = `rgba(255,255,255,${0.28 - i * 0.03})`;
          C.lineWidth = 1.4 + (i % 3) * 0.8;
          C.beginPath();
          C.moveTo(1000 + i * 6, 630 - i * 20);
          C.bezierCurveTo(1010 + i * 8, 540 - i * 16, 1060 + i * 5, 440 - i * 12, 1120 + i * 3, 350 - i * 8);
          C.stroke();
        }
        C.restore();
        // 浪脚白沫
        for (let i = 0; i < 16; i++) {
          const x = 940 + i * 22 + Math.sin(t * 0.8 + i) * 6;
          A.softEllipse(x, 632 + (i % 3) * 5, 20 + (i % 4) * 5, 7 + (i % 3) * 3, '#ffffff', 0.32);
        }
        // 水雾
        for (const s of spray) {
          const x = s.x + Math.sin(t * s.sp + s.p) * 22;
          const y = s.y + Math.cos(t * s.sp * 0.8 + s.p) * 16 - ((t * 30) % 52);
          C.globalAlpha = 0.5 + 0.42 * Math.sin(t * 1.4 + s.p);
          C.fillStyle = '#ffffff';
          C.beginPath(); C.arc(x, y, s.r, 0, TAU); C.fill();
        }
        C.globalAlpha = 1;
        // 海面白沫
        for (const f of foam) {
          const x = ((f.x + t * 6) % (A.VW + 100)) - 50;
          C.globalAlpha = f.a;
          C.fillStyle = '#ffffff';
          C.beginPath(); C.ellipse(x, f.y, f.rx, f.ry, 0, 0, TAU); C.fill();
        }
        C.globalAlpha = 1;
        // 湿沙与倒影
        C.fillStyle = A.vgrad(618, 760, [[0, '#f0eef1'], [0.28, '#e8d9bf'], [1, '#d8bf96']]);
        C.fillRect(0, 618, 1280, 142);
        C.strokeStyle = 'rgba(255,255,255,.82)';
        C.lineWidth = 6;
        C.beginPath();
        C.moveTo(0, 630);
        for (let x = 0; x <= 1280; x += 40) C.lineTo(x, 630 + Math.sin(x * 0.012 + t * 0.5) * 6);
        C.stroke();
        C.save();
        C.globalAlpha = 0.16;
        C.fillStyle = '#8a5a38';
        C.beginPath(); C.ellipse(430, 700, 128, 20, 0, 0, TAU); C.fill();
        C.restore();
        for (let i = 0; i < 10; i++) {
          C.strokeStyle = 'rgba(255,255,255,.3)';
          C.lineWidth = 2;
          C.beginPath(); C.moveTo(160 + i * 96, 672 + (i % 3) * 16); C.lineTo(210 + i * 96, 672 + (i % 3) * 16); C.stroke();
        }
        A.horse(430, 664, { k: 20, dir: 1, mode: 'stand', t, auraColor: '#ffffff', auraAlpha: 0.26, shadowColor: '#8a6b47', shadowAlpha: 0.2 });
        A.birds([{ x: 300, y: 216, p: 1, drift: 18, size: 4.6 }, { x: 352, y: 198, p: 3, drift: 12, size: 3.4 }], t, '#5f93a3', 0.5);
        A.paper();
      },
    });
  })();

  // ── 09 千军 · 冲锋 ─────────────────────────────────────────────
  (() => {
    const r = A.rng(9109);
    const dustPuffs = [];
    for (let i = 0; i < 26; i++) dustPuffs.push({ x: r() * 1280, y: 500 + r() * 150, r: 40 + r() * 90, p: r() * TAU, a: 0.08 + r() * 0.1, sp: 0.3 + r() * 0.6 });
    const glints = [];
    for (let i = 0; i < 24; i++) glints.push({ x: r() * 1280, y: 470 + r() * 120, p: r() * TAU });
    S.push({
      title: '千军 · 冲锋', short: '千军',
      tags: '千军万马 · 冲锋 · 英勇',
      sub: '鼓声把尘土抬起来，旗子一直铺到天边。它跑在最前面，身后是整片大地。',
      draw(t) {
        A.sky([[0, '#fff4d8'], [0.38, '#fbe0ae'], [1, '#e9bb78']]);
        A.sun(918, 206, 58, '#fff2c9', '#ffe5ad');
        C.fillStyle = 'rgba(255,238,196,.62)';
        C.beginPath(); C.arc(918, 206, 46, 0, TAU); C.fill();
        A.rays(918, 206, 8, 620, 1.35, '#fff2c9', 0.12, t);
        A.inkRidge({ base: 400, amp: 30, seed: 91, waves: 1.4, color: '#d2ab72', alpha: 0.3, bottom: 560, grain: 20 });
        A.mist(466, 52, '#f7d6a1', 0.34, 92, t, 5);
        // 尘土（前后两层）
        for (const d of dustPuffs) {
          const x = ((d.x + t * 16 + Math.sin(t * d.sp + d.p) * 18) % (A.VW + 200)) - 100;
          A.softEllipse(x, d.y + Math.cos(t * d.sp + d.p) * 8, d.r * 1.35, d.r * 0.5, '#d6ad78', d.a * 1.7);
        }
        A.mist(520, 56, '#e7bf88', 0.26, 93, t, 7);
        A.armyRow({ y: 474, size: 3.2, color: '#9a7a58', alpha: 0.2, t, speed: 9, seed: 1, bannerEvery: 13, bannerColor: '#b4483c' });
        A.armyRow({ y: 516, size: 4.7, color: '#846347', alpha: 0.28, t, speed: 15, seed: 2, offset: 60, bannerEvery: 10, bannerColor: '#c0573f' });
        A.mist(566, 46, '#d9ad75', 0.24, 95, t, 9);
        A.armyRow({ y: 574, size: 6.3, color: '#6e5038', alpha: 0.38, t, speed: 23, seed: 3, offset: 140, bannerEvery: 8, bannerColor: '#b4483c' });
        A.armyRow({ y: 626, size: 8.0, color: '#5b412e', alpha: 0.48, t, speed: 32, seed: 4, offset: 230, bannerEvery: 7, bannerColor: '#a94539' });
        A.inkRidge({ base: 664, amp: 9, seed: 94, waves: 1.6, color: '#b98a51', alpha: 0.4, bottom: 760, grain: 30 });
        A.softEllipse(560, 660, 420, 36, '#c79a5f', 0.32);
        // 前景大旗
        A.banner(104, 648, 150, '#b4483c', t, 0.8);
        A.banner(1204, 638, 138, '#a94539', t, 2.1);
        for (const g of glints) {
          const tw = Math.sin(t * 3 + g.p);
          if (tw > 0.55) {
            C.globalAlpha = (tw - 0.55) * 0.9;
            C.fillStyle = '#fff7dd';
            C.fillRect(g.x, g.y, 2, 2);
            C.fillRect(g.x - 3, g.y + 1, 8, 1);
          }
        }
        C.globalAlpha = 1;
        // 领头牛马：与最前排同一条冲锋线、同一速度，前后都有士兵和尘土
        const u = ((t / 32 + 0.22) % 1 + 1) % 1;
        const x = 150 + u * 1040;
        const fade = Math.max(0, Math.min(1, Math.min(u, 1 - u) * 22));
        for (let i = 0; i < 7; i++) {
          A.dust(x - 110 - i * 22, 632 - i * 2, 26 + i * 8, 0.13 - i * 0.011, '#c9a06a');
        }
        A.soldier(x - 82, 632, 9.0, '#5b412e', 0.5, t, 0.8, '#a94539');
        A.horse(x, 628, { k: 9, dir: 1, mode: 'walk', t, travel: x - 150, gait: 1, alpha: fade * 0.96, auraColor: '#ffe0a8', auraAlpha: 0.2, dustColor: '#c9a06a' });
        A.dust(x - 30, 632, 30, 0.1, '#c9a06a');
        A.dust(x + 22, 633, 24, 0.08, '#c9a06a');
        A.soldier(x + 66, 636, 9.2, '#543c2a', 0.52, t, 2.6, '#b4483c');
        A.soldier(x + 150, 658, 9.0, '#4e3726', 0.44, t, 4.3, null);
        A.birds([{ x: 520, y: 250, p: 0.4, drift: 22, size: 4.2 }, { x: 580, y: 226, p: 2.3, drift: 16, size: 3.4 }, { x: 640, y: 244, p: 4.4, drift: 12, size: 3 }], t, '#7a6246', 0.34);
        // 升起的尘柱，补足天空下的战场体量
        for (let i = 0; i < 6; i++) {
          const px = 160 + i * 200 + Math.sin(t * 0.4 + i) * 18;
          const py = 520 - (i % 3) * 26;
          A.softEllipse(px, py, 74 + i * 6, 130, '#d9b07a', 0.07);
          A.softEllipse(px + 34, py - 56, 46 + i * 4, 88, '#e3c08c', 0.06);
        }
        A.grassField(650, 712, 80, '#7c5c34', 96, t, { minH: 8, maxH: 28, alpha: 0.28, width: 1.4 });
        A.paper();
      },
    });
  })();

  // ── 10 花野 · 千千万万 ─────────────────────────────────────────
  (() => {
    const r = A.rng(10110);
    const colors = ['#ef9fba', '#f2c56a', '#ffffff', '#e887a2', '#c3ade4', '#f4b183'];
    const flowers = A.makeFlowers(101, 1050, 478, 716, colors);
    const nearFlowers = A.makeFlowers(202, 80, 566, 652, colors).map((f) => ({
      ...f, s: 5.4 + (f.depth || 0) * 3.4, depth: 0.82 + (f.depth || 0) * 0.18,
    }));
    // 最前景：贴着镜头的高花，花冠在牛马身侧、花茎一直落到画面底，穿行时才会被花挡住
    const tr = A.rng(404);
    const tallFlowers = [];
    for (let i = 0; i < 12; i++) {
      tallFlowers.push({
        x: 120 + i * 95 + tr() * 40,
        y: 0,
        s: 9 + (i % 3) * 2 + tr() * 2,
        c: colors[Math.floor(tr() * colors.length)],
        ph: tr() * TAU,
        type: 0,
        depth: 1,
        lift: (i % 4) / 3,
      });
    }
    const petals = [];
    for (let i = 0; i < 70; i++) petals.push({ x: r() * 1280, y: r() * 700, vx: 8 + r() * 18, vy: 5 + r() * 11, ph: r() * TAU, spin: 0.5 + r() * 1.4, r: 2 + r() * 3, a: 0.35 + r() * 0.4, c: colors[Math.floor(r() * colors.length)] });
    const flies = [];
    for (let i = 0; i < 14; i++) flies.push({ x: 260 + r() * 760, y: 400 + r() * 220, ph: r() * TAU, c: colors[i % colors.length] });
    S.push({
      title: '花野 · 千千万万', short: '花野',
      tags: '千千万万 · 丰富多彩 · 生机',
      sub: '花多到看不见边，风一过就一起点头。它从中间穿过去，像穿过一场彩色的雨。',
      draw(t) {
        A.sky([[0, '#fff8ec'], [0.42, '#fdeaf2'], [1, '#f5dbe8']]);
        A.sun(1016, 172, 46, '#fff3cf', '#fffaf0');
        A.inkRidge({ base: 436, amp: 30, seed: 102, waves: 1.4, color: '#cbdcb2', alpha: 0.3, bottom: 580, grain: 20 });
        A.inkRidge({ base: 492, amp: 24, seed: 103, waves: 1.2, color: '#b3cf95', alpha: 0.34, bottom: 640, grain: 24 });
        A.mist(470, 40, '#ffffff', 0.22, 104, t, 5);
        A.inkRidge({ base: 566, amp: 18, seed: 105, waves: 1.6, color: '#94b579', alpha: 0.3, bottom: 700, grain: 26 });
        // 远处树丛
        for (const [tx, ty, ts] of [[186, 494, 42], [338, 486, 34], [892, 490, 38], [1074, 500, 46], [748, 480, 30]]) {
          C.fillStyle = 'rgba(96,74,50,.35)';
          C.fillRect(tx - 2, ty - 6, 4, 22);
          A.softEllipse(tx, ty - 18, ts, ts * 0.62, '#9bbb7c', 0.42);
          A.softEllipse(tx - ts * 0.4, ty - 10, ts * 0.6, ts * 0.4, '#88aa6c', 0.32);
        }
        A.grassField(590, 716, 110, '#6f9456', 106, t, { minH: 10, maxH: 40, alpha: 0.24, width: 1.4, color2: '#9aad63' });
        // 牛马在花野里穿行：慢速 S 形路线，忽快忽慢，远近由 y 与 k 一起决定
        // 横向为主、远近缓慢变化：速度慢到看不出缩放跳变，k 只随深度轻微变化
        const hs = t * 0.1 + Math.sin(t * 0.03) * 0.6;
        const hx = 640 + 360 * Math.sin(hs);
        const hy = 600 - 22 * Math.sin(hs + 0.6);
        const hk = 13.5 + (hy - 600) * 0.05;
        const hdir = Math.cos(hs) >= 0 ? 1 : -1;
        const behind = flowers.filter((f) => f.y < hy + 4);
        const infront = flowers.filter((f) => f.y >= hy + 4);
        A.drawFlowers(behind, t);
        A.petals(petals, t);
        A.butterflies(flies, t);
        A.horse(hx, hy, { k: hk, dir: hdir, mode: 'walk', t, travel: 360 * Math.sin(hs), gait: Math.min(1, Math.abs(Math.cos(hs)) * 1.6), alpha: 0.96, auraColor: '#ffffff', auraAlpha: 0.14 });
        A.drawFlowers(infront, t);
        A.drawFlowers(nearFlowers, t);
        // 前景草丛：牛马是从草梢里蹚过去的，蹄腿要被草叶压住
        A.grassField(620, 716, 150, '#6f9456', 307, t, { minH: 46, maxH: 92, alpha: 0.42, width: 1.6, color2: '#93a95f' });
        // 与牛马同一深度的花丛再压一层，让花梢盖住蹄腿
        A.drawFlowers(flowers.filter((f) => Math.abs(f.y - hy) < 34 && f.depth > 0.55), t);
        A.drawFlowers(tallFlowers.map((f) => ({ ...f, y: hy - 72 + f.lift * 50 })), t, '#5f8a52', 726);
        A.petals(petals.slice(0, 28), t);
        A.birds([{ x: 760, y: 210, p: 0.8, drift: 16, size: 4 }, { x: 812, y: 194, p: 2.6, drift: 12, size: 3.2 }], t, '#b07f8f', 0.42);
        A.paper();
      },
    });
  })();
})();
