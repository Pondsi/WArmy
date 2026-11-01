/* 牛马冲锋 · 十幕概念场景
 * 每一幕都是「一个很小的牛马 × 一个巨大的世界」。所有元素硬边、清晰，
 * 不使用全屏模糊/扫描线；动效是慢的：星云旋转、云海漂移、极光起伏、熔岩流动。
 */
(() => {
  'use strict';
  const A = window.CHARGE_API;
  const S = window.CHARGE_SCENES;

  // ── 01 星河 · 跃迁 ────────────────────────────────────────────────────
  (() => {
    const st = A.stars(A.rng(11), 260, 640);
    const r = A.rng(12);
    const neb = [];
    for (let i = 0; i < 560; i++) {
      const ang = r() * Math.PI * 2;
      const rr = Math.pow(r(), 0.62) * 400;
      neb.push({
        x: 880 + Math.cos(ang) * rr * 1.5,
        y: 250 + Math.sin(ang) * rr * 0.5,
        s: r() < 0.18 ? 3 : 1,
        c: r() < 0.5 ? '#5b4bff' : '#b06bff',
        a: 0.05 + r() * 0.15,
      });
    }
    const trail = [];
    for (let i = 0; i < 96; i++) {
      const u = i / 95;
      trail.push({ x: 60 + u * 780, y: 648 - u * u * 190, s: i % 4 === 0 ? 3 : 2 });
    }
    S.push({
      title: '星河 · 跃迁', short: '星河',
      sub: '越过最后一块碎星，向旋臂尽头跃迁。没有号角，只有星尘在身后拉成一条光。',
      draw(t) {
        A.sky([[0, '#040611'], [0.45, '#0b0f2a'], [0.78, '#1a1543'], [1, '#251a4d']]);
        for (const d of neb) A.rect(d.x + Math.sin(t * 0.05 + d.y) * 12, d.y, d.s, d.s, A.rgba(d.c, d.a));
        A.galaxy(1050, 182, 268, t, 77, ['#ffe8c2', '#cdd6ff', '#8f8cff', '#5a55c9', '#2c2a66']);
        A.planet(255, 245, 152, '#2b3157', '#141831', '#aebdff', '#8f9ddd');
        A.drawStars(st, t);
        for (let i = 0; i < trail.length; i++) {
          const d = trail[i];
          const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.1 - i * 0.18));
          A.rect(d.x, d.y, d.s, d.s, A.rgba('#bfe2ff', pulse * 0.9));
        }
        A.ridge(668, 24, 31, '#050711', { freq: 0.006, rough: 0.9, jag: 2 });
        A.ridgeEdge(668, 24, 31, '#3b4c86', { thick: 2 });
        A.ridge(706, 12, 32, '#03040a', { freq: 0.008, jag: 3 });
        // 最后一块碎星：牛马真正踩着它起跳
        for (let y = 0; y < 26; y += 2) {
          const half = 74 - y * 2.6;
          A.rect(566 - half, 568 + y, half * 2, 2, '#050711');
        }
        A.rect(492, 568, 148, 2, '#3b4c86');
        A.rect(516, 574, 100, 1, A.rgba('#2c3a66', 0.8));
        A.beast(566, 570, 5, { t, rim: '#bcd4ff', color: '#04050c' });
        for (let i = 0; i < 9; i++) {
          A.rect(500 - i * 12, 564 - Math.sin(t * 2 + i) * 5, 2, 2, A.rgba('#9db8ff', 0.2));
        }
      },
    });
  })();

  // ── 02 千军 · 独影 ────────────────────────────────────────────────────
  (() => {
    const army = [];
    for (let row = 0; row < 10; row++) {
      const r = A.rng(200 + row);
      const y = 452 + row * 15;
      const n = 44 - row * 3;
      for (let i = 0; i < n; i++) {
        army.push({
          x: 24 + i * (1232 / n) + r() * 8,
          y: y + r() * 3,
          h: 7 + row * 3,
          flag: r() < 0.17,
          gh: r() < 0.14,
          ph: r() * 6,
        });
      }
    }
    const craters = [];
    const cr = A.rng(223);
    for (let i = 0; i < 16; i++) {
      craters.push({ x: 900 + (cr() - 0.5) * 170, y: 130 + (cr() - 0.5) * 170, r: 3 + cr() * 14 });
    }
    S.push({
      title: '千军 · 独影', short: '千军',
      sub: '一面坡，一匹马。坡下是看不见尽头的枪林与旗影，风把鬃毛吹向身后，它仍然向前。',
      draw(t) {
        A.sky([[0, '#050815'], [0.52, '#241a2c'], [0.84, '#6d3428'], [1, '#a85a33']]);
        A.disc(982, 188, 116, '#e8d8b4', 2);
        for (const c of craters) A.disc(c.x, c.y, c.r, '#c9b896', 4, 0.55);
        A.glow(982, 188, 230, '#e8d8b4', 0.16);
        A.ridge(452, 26, 230, '#120f1c', { freq: 0.0038, rough: 0.8 });
        for (const a of army) {
          const c = A.rgba('#04050b', 0.52 + (a.y - 452) / 300);
          const bodyH = Math.max(3, Math.round(a.h * 0.3));
          A.rect(a.x - 1, a.y - bodyH, 3, bodyH, c);
          A.rect(a.x - 1, a.y - bodyH - 2, 3, 2, c);
          A.line(a.x, a.y, a.x, a.y - a.h, c, 1);
          if (a.flag) {
            const w = Math.sin(t * 2.2 + a.ph) * 1.5;
            A.rect(a.x + 1, a.y - a.h + 1 + w, 4, 3, A.rgba('#6d1f22', 0.9));
          }
          if (a.gh) A.rect(a.x + 2, a.y - a.h * 0.55, 2, 1, A.rgba('#d9a15c', 0.45));
        }
        const banners = [[300, 600, 96], [520, 610, 122], [846, 620, 88], [1046, 606, 108]];
        for (const [x, y, h] of banners) A.flag(x, y, h, '#7a2226', t, { thick: 2, w: 22 });
        A.ridge(602, 10, 240, '#070911', { freq: 0.006, jag: 1 });
        A.ridgeEdge(602, 10, 240, '#7a5240', { thick: 3 });
        A.beast(590, 622, 5, { t, rim: '#d9a15c', color: '#0a0c13' });
        for (let i = 0; i < 7; i++) {
          A.rect(600 + i * 48 + Math.sin(t * 0.6 + i) * 10, 604 + Math.sin(i) * 4, 26, 1, A.rgba('#b97a52', 0.08));
        }
      },
    });
  })();

  // ── 03 高岭 · 天梯 ────────────────────────────────────────────────────
  (() => {
    const sr = A.rng(310);
    const ledges = [];
    let lx = 636;
    let ly = 664;
    for (let i = 0; i < 8; i++) {
      ledges.push({ x: lx, y: ly, w: 104 - i * 5 });
      lx += i % 2 === 0 ? 62 : -46;
      ly -= 64;
    }
    const snow = [];
    for (let i = 0; i < 34; i++) snow.push({ x: sr() * 1280, y: sr() * 620, s: sr() < 0.3 ? 2 : 1, ph: sr() * 6 });
    const icicles = [];
    for (let i = 0; i < 12; i++) icicles.push({ x: sr() * 1280, h: 10 + sr() * 34 });
    S.push({
      title: '高岭 · 天梯', short: '天梯',
      sub: '绝壁高到看不见顶，凿出的栈道只有一人宽。云在脚下翻涌，它一步一步向上。',
      draw(t) {
        A.sky([[0, '#081420'], [0.42, '#173242'], [0.7, '#41636b'], [0.86, '#9d8f6e'], [1, '#d9b47a']]);
        A.disc(238, 172, 66, '#f6e7c6', 2);
        A.glow(238, 172, 150, '#f6e7c6', 0.16);
        A.ridge(418, 34, 301, '#1a333c', { freq: 0.004, rough: 0.7 });
        A.ridgeEdge(418, 34, 301, '#6d8f92', { thick: 2 });
        A.ridge(472, 22, 302, '#12262e', { freq: 0.006, rough: 0.8 });
        A.ridgeEdge(472, 22, 302, '#476b70', { thick: 2 });
        A.cloudSea(492, t, 303, '#33474d', '#b7c8c8');
        // 瀑布（崖壁缺口，落在云海）
        for (let i = 0; i < 20; i++) {
          const off = (t * 110 + i * 37) % 360;
          A.rect(700 + (i % 5) * 6, 190 + off, 2, 54, A.rgba('#dff6ff', 0.24 + (i % 3) * 0.06));
        }
        A.rect(688, 540, 46, 3, A.rgba('#dff6ff', 0.18));
        // 巨崖：亮面 + 暗面，让岩壁有体积
        A.ctx.fillStyle = '#101d26';
        A.ctx.beginPath();
        A.ctx.moveTo(756, 720);
        A.ctx.lineTo(806, 210);
        A.ctx.lineTo(900, 62);
        A.ctx.lineTo(1090, 0);
        A.ctx.lineTo(1280, 0);
        A.ctx.lineTo(1280, 720);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.fillStyle = '#0a141c';
        A.ctx.beginPath();
        A.ctx.moveTo(920, 720);
        A.ctx.lineTo(900, 62);
        A.ctx.lineTo(1090, 0);
        A.ctx.lineTo(1280, 0);
        A.ctx.lineTo(1280, 720);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.strokeStyle = '#7fa1a6';
        A.ctx.lineWidth = 3;
        A.ctx.beginPath();
        A.ctx.moveTo(756, 720);
        A.ctx.lineTo(806, 210);
        A.ctx.lineTo(900, 62);
        A.ctx.lineTo(1090, 0);
        A.ctx.stroke();
        // 岩壁竖纹
        for (let i = 0; i < 16; i++) {
          const x = 840 + i * 26;
          A.line(x, 160 + (i % 5) * 34, x - 18, 720, A.rgba('#1d2c36', 0.7), 3);
        }
        // 雪线
        for (let i = 0; i < 26; i++) {
          const yy = 70 + i * 24;
          const w = 26 + ((i * 47) % 100);
          A.rect(810 + ((i * 61) % 430), yy, w, 3, A.rgba('#d8e9ea', 0.3));
        }
        for (const c of icicles) A.rect(c.x, 600, 2, c.h, A.rgba('#bfe8f2', 0.16));
        // 悬崖栈道：横向石台 + 支撑梁 + 台阶
        for (let i = 0; i < ledges.length; i++) {
          const L = ledges[i];
          A.rect(L.x, L.y, L.w, 13, '#1c2a2d');
          A.rect(L.x, L.y - 2, L.w, 3, '#cfe4e8');
          A.rect(L.x + 2, L.y + 13, L.w - 4, 4, '#0a1218');
          A.line(L.x + L.w - 8, L.y + 16, L.x + L.w + 20, L.y + 52, '#0a1218', 4);
          for (let k = 8; k < L.w - 6; k += 12) A.rect(L.x + k, L.y - 1, 6, 2, A.rgba('#8fb3b8', 0.55));
          if (i < ledges.length - 1) {
            const N = ledges[i + 1];
            const topY = N.y;
            for (let s = 0; s < 8; s++) {
              A.rect(N.x + N.w - 18, topY + s * 8, 16, 4, '#243438');
              A.rect(N.x + N.w - 18, topY + s * 8, 16, 1, A.rgba('#9fb7ba', 0.5));
            }
          }
        }
        A.glow(ledges[4].x + 58, ledges[4].y - 42, 86, '#9fc7c9', 0.07);
        A.beast(ledges[4].x + 34, ledges[4].y - 2, 4, { t, rim: '#b9d6d6', color: '#04070c' });
        for (const s of snow) {
          const y = (s.y + t * 10) % 700;
          A.rect(s.x + Math.sin(t * 0.4 + s.ph) * 8, y, s.s, s.s, A.rgba('#eaf7f7', 0.55));
        }
      },
    });
  })();

  // ── 04 巨树 · 攀登 ────────────────────────────────────────────────────
  (() => {
    const r = A.rng(410);
    const clusters = [];
    const centers = [
      [120, 150, 120], [330, 92, 135], [560, 128, 120], [790, 74, 118],
      [1010, 132, 140], [1200, 76, 120], [280, 250, 96], [480, 178, 84],
      [650, 198, 76], [800, 214, 80], [420, 278, 70], [560, 300, 62],
    ];
    for (const [cx, cy, rad] of centers) {
      for (let i = 0; i < 30; i++) {
        const a = r() * Math.PI * 2;
        const rr = Math.pow(r(), 0.6) * rad;
        clusters.push({
          x: cx + Math.cos(a) * rr,
          y: cy + Math.sin(a) * rr * 0.58,
          w: 7 + r() * 20,
          h: 5 + r() * 10,
          c: r() < 0.5 ? '#1d4a33' : '#2f6b47',
          a: 0.5 + r() * 0.5,
        });
      }
    }
    const flies = [];
    for (let i = 0; i < 36; i++) flies.push({ x: 280 + r() * 660, y: 220 + r() * 320, ph: r() * 6, sp: 0.4 + r() * 0.7 });
    const rocks = [[160, 500, 150, 36], [360, 570, 108, 28], [80, 620, 170, 40]];
    const glowLeaves = [];
    for (let i = 0; i < 20; i++) glowLeaves.push({ x: 430 + r() * 400, y: 280 + r() * 70, h: 10 + r() * 24 });
    S.push({
      title: '巨树 · 攀登', short: '巨树',
      sub: '世界树的枝干比道路还宽。它沿着一条旧枝走向树心，头顶的光像一场安静的雨。',
      draw(t) {
        A.sky([[0, '#04120e'], [0.45, '#0a231b'], [0.8, '#0e3324'], [1, '#061410']]);
        A.drawStars(A.stars(A.rng(411), 120, 300), t, 0.5);
        A.rays(410, -30, 600, 320, '#ffd98a', 0.065);
        for (const c of clusters) {
          const sway = Math.sin(t * 0.28 + c.x * 0.01) * 3;
          A.rect(c.x + sway, c.y, c.w, c.h, A.rgba(c.c, c.a));
          A.rect(c.x + sway + 2, c.y, Math.max(2, c.w * 0.4), 2, A.rgba('#4e8a5e', c.a * 0.5));
        }
        // 树干与树根
        A.ctx.fillStyle = '#07130d';
        A.ctx.beginPath();
        A.ctx.moveTo(840, 720);
        A.ctx.lineTo(880, 220);
        A.ctx.lineTo(930, 60);
        A.ctx.lineTo(1030, 0);
        A.ctx.lineTo(1280, 0);
        A.ctx.lineTo(1280, 720);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.strokeStyle = '#4e7a4a';
        A.ctx.lineWidth = 3;
        A.ctx.beginPath();
        A.ctx.moveTo(840, 720);
        A.ctx.lineTo(880, 220);
        A.ctx.lineTo(930, 60);
        A.ctx.stroke();
        A.ctx.fillStyle = '#05100a';
        A.ctx.beginPath();
        A.ctx.moveTo(840, 720);
        A.ctx.lineTo(760, 720);
        A.ctx.lineTo(820, 640);
        A.ctx.lineTo(860, 660);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.beginPath();
        A.ctx.moveTo(900, 700);
        A.ctx.lineTo(1030, 720);
        A.ctx.lineTo(940, 640);
        A.ctx.closePath();
        A.ctx.fill();
        for (let i = 0; i < 10; i++) {
          A.line(900 + i * 34, 100 + i * 28, 872 + i * 28, 720, A.rgba('#1b3523', 0.6), 4);
        }
        // 三条主枝把树冠与树干连起来（否则叶团会像浮在空中的方块）
        A.line(930, 240, 520, 140, '#07130d', 20);
        A.line(930, 240, 520, 140, '#3f6c3c', 3);
        A.line(930, 300, 330, 250, '#07130d', 24);
        A.line(930, 300, 330, 250, '#3f6c3c', 3);
        A.line(970, 250, 1150, 180, '#07130d', 18);
        A.line(970, 250, 1150, 180, '#3f6c3c', 2);
        A.line(520, 140, 340, 90, '#07130d', 10);
        A.line(330, 250, 210, 200, '#07130d', 10);
        // 树根：从树干底部向两侧铺开
        A.line(830, 690, 470, 706, '#07130d', 28);
        A.line(830, 690, 470, 706, '#3f6c3c', 3);
        A.line(880, 700, 1180, 712, '#07130d', 24);
        A.line(880, 700, 1180, 712, '#3f6c3c', 2);
        A.line(560, 702, 240, 720, '#07130d', 14);
        A.ridge(706, 6, 412, '#06110b', { freq: 0.007, jag: 2 });
        // 树心：发光的洞
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
        A.disc(950, 300, 32, '#2a1a0c', 4);
        A.ellipseRing(950, 300, 33 + pulse * 3, 30 + pulse * 2, 3, '#ffd98a', 0.55 + pulse * 0.25);
        A.glow(950, 300, 100, '#ffd98a', 0.12 + pulse * 0.06);
        for (const c of glowLeaves) A.rect(c.x, c.y, 2, c.h, A.rgba('#ffd98a', 0.14));
        // 主枝（有厚度的旧枝）
        A.ctx.fillStyle = '#07130d';
        A.ctx.beginPath();
        A.ctx.moveTo(930, 350);
        A.ctx.lineTo(220, 288);
        A.ctx.lineTo(220, 322);
        A.ctx.lineTo(930, 430);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.strokeStyle = '#3f6c3c';
        A.ctx.lineWidth = 4;
        A.ctx.beginPath();
        A.ctx.moveTo(930, 350);
        A.ctx.lineTo(220, 288);
        A.ctx.stroke();
        for (let i = 0; i < 7; i++) {
          A.line(870 - i * 90, 356 + i * 7, 870 - i * 90, 420 + i * 7, A.rgba('#18301f', 0.5), 3);
        }
        // 枝上的小枝与叶团
        A.line(720, 348, 690, 292, '#07130d', 8);
        A.line(520, 334, 500, 276, '#07130d', 7);
        A.line(380, 322, 360, 270, '#07130d', 6);
        for (const [x, y] of [[690, 286], [500, 270], [360, 264]]) {
          for (let i = 0; i < 5; i++) {
            A.rect(x - 18 + i * 8, y - 8 + (i % 2) * 4, 14, 8, A.rgba('#2f6b47', 0.9));
          }
        }
        A.beast(590, 320, 4, { t, rim: '#e6b56a', color: '#050b08' });
        // 浮石
        for (const [x, y, w, h] of rocks) {
          A.rect(x, y, w, h, '#0a1a14');
          A.rect(x + 4, y - 2, w - 8, 3, '#3f6c3c');
          A.rect(x + 10, y + 6, w - 24, 3, '#2f5738');
          A.ctx.fillStyle = '#0a1a14';
          A.ctx.beginPath();
          A.ctx.moveTo(x + 6, y + h);
          A.ctx.lineTo(x + w * 0.46, y + h + 34);
          A.ctx.lineTo(x + w * 0.62, y + h + 10);
          A.ctx.lineTo(x + w - 8, y + h);
          A.ctx.closePath();
          A.ctx.fill();
        }
        for (const f of flies) {
          const x = f.x + Math.sin(t * f.sp + f.ph) * 10;
          const y = f.y + Math.cos(t * f.sp * 0.8 + f.ph) * 7;
          const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2 + f.ph));
          A.rect(x, y, 2, 2, A.rgba('#ffe3a0', a * 0.8));
        }
      },
    });
  })();

  // ── 05 深海 · 孤航 ────────────────────────────────────────────────────
  (() => {
    const r = A.rng(510);
    const fish = [];
    for (let i = 0; i < 120; i++) fish.push({ x: r() * 1280, y: 160 + r() * 420, s: r() < 0.3 ? 3 : 2, ph: r() * 6 });
    const bubbles = [];
    for (let i = 0; i < 26; i++) bubbles.push({ x: 380 + r() * 260, y: r() * 640, s: 1 + Math.floor(r() * 2), sp: 8 + r() * 18 });
    const corals = [];
    for (let i = 0; i < 16; i++) corals.push({ x: r() * 1280, h: 18 + r() * 54, w: 2 + Math.floor(r() * 3) });
    const whaleTail = (t) => Math.sin(t * 0.9) * 12;
    S.push({
      title: '深海 · 孤航', short: '深海',
      sub: '海面在六百米之上。巨鲸从头顶掠过，它踩着海脊的微光继续向前，气泡是唯一的蹄声。',
      draw(t) {
        A.sky([[0, '#0c4b56'], [0.42, '#072836'], [0.78, '#031620'], [1, '#020c12']]);
        A.rays(560, -80, 720, 320, '#bff4ff', 0.055);
        for (let i = 0; i < 4; i++) {
          A.bandWave(150 + i * 52, 14, 0.008 + i * 0.002, A.rgba('#9fe6ee', 0.05), 3, t * 0.2 + i);
        }
        // 巨鲸：头在右、尾在左，背脊有一线青光
        const swing = whaleTail(t);
        A.ctx.fillStyle = '#03121a';
        A.ctx.beginPath();
        A.ctx.moveTo(680, 300 + swing * 0.4);
        A.ctx.bezierCurveTo(760, 210, 1000, 196, 1160, 250);
        A.ctx.bezierCurveTo(1216, 266, 1212, 318, 1150, 334);
        A.ctx.bezierCurveTo(1010, 386, 790, 372, 690, 344);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.beginPath();
        A.ctx.moveTo(700, 316 + swing * 0.4);
        A.ctx.lineTo(590, 244 + swing);
        A.ctx.lineTo(620, 312 + swing * 0.6);
        A.ctx.lineTo(580, 372 + swing);
        A.ctx.lineTo(700, 344 + swing * 0.4);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.beginPath();
        A.ctx.moveTo(930, 356);
        A.ctx.lineTo(986, 412);
        A.ctx.lineTo(902, 390);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.strokeStyle = A.rgba('#3b8f9c', 0.6);
        A.ctx.lineWidth = 2;
        A.ctx.beginPath();
        A.ctx.moveTo(690, 300);
        A.ctx.bezierCurveTo(800, 216, 1000, 202, 1158, 252);
        A.ctx.stroke();
        A.line(1146, 318, 980, 344, '#03121a', 3);
        A.rect(1132, 292, 4, 4, A.rgba('#7fd4dd', 0.65));
        for (let i = 0; i < 6; i++) A.line(880 + i * 38, 344 + i * 4, 1010 + i * 24, 330 + i * 4, A.rgba('#1e4e58', 0.5), 1);
        for (const f of fish) {
          const x = (f.x + t * 9) % 1280;
          A.rect(x, f.y + Math.sin(t * 0.8 + f.ph) * 5, f.s, 1, A.rgba('#7fd4dd', 0.45));
        }
        A.ridge(646, 18, 511, '#020c11', { freq: 0.006, jag: 2 });
        for (const c of corals) {
          A.rect(c.x, 646 - c.h, c.w, c.h, '#04141a');
          A.rect(c.x + c.w, 640 - c.h * 0.7, 2, c.h * 0.7, '#04141a');
        }
        const boulders = [[90, 600, 96, 34], [250, 618, 64, 24], [1020, 600, 110, 36], [1170, 626, 66, 22], [760, 632, 44, 16]];
        for (const [x, y, w, h] of boulders) {
          A.rect(x, y, w, h, '#020a0f');
          A.rect(x + 6, y - 2, w - 12, 2, '#1e4e58');
          A.ctx.fillStyle = '#020a0f';
          A.ctx.beginPath();
          A.ctx.moveTo(x, y + h);
          A.ctx.lineTo(x + w * 0.4, y + h + 18);
          A.ctx.lineTo(x + w * 0.7, y + h + 6);
          A.ctx.lineTo(x + w, y + h);
          A.ctx.closePath();
          A.ctx.fill();
        }
        for (const [x, h] of [[40, 90], [150, 130], [1090, 110], [1230, 150], [660, 70]]) {
          for (let i = 0; i < h; i += 8) {
            const sway = Math.sin(t * 0.9 + i * 0.1) * 4;
            A.rect(x + sway, 650 - i, 2, 8, A.rgba('#0a2a30', 0.85));
          }
        }
        A.beast(430, 658, 5, { t, rim: '#7fd4dd', color: '#020a0f' });
        for (const b of bubbles) {
          const y = (b.y - t * b.sp) % 700;
          const yy = y < 0 ? y + 700 : y;
          A.rect(b.x + Math.sin(t + b.y) * 6, yy, b.s, b.s, A.rgba('#c8f6fb', 0.4));
        }
      },
    });
  })();

  // ── 06 大漠 · 风碑 ────────────────────────────────────────────────────
  (() => {
    const r = A.rng(610);
    const sand = [];
    for (let i = 0; i < 46; i++) sand.push({ x: r() * 1280, y: 380 + r() * 300, len: 14 + r() * 50, sp: 60 + r() * 120, a: 0.1 + r() * 0.2 });
    const birds = [];
    for (let i = 0; i < 7; i++) birds.push({ x: 300 + r() * 700, y: 200 + r() * 120, p: r() * 6, drift: 10 + r() * 18 });
    S.push({
      title: '大漠 · 风碑', short: '风碑',
      sub: '沙海没有路，只有风刻出的脊线。它朝着那块不知年代的巨碑奔跑，影子被落日拉得很长。',
      draw(t) {
        A.sky([[0, '#170f20'], [0.45, '#4a2424'], [0.75, '#a45332'], [0.9, '#d98a4c'], [1, '#efb56d']]);
        A.disc(1000, 306, 72, '#ffd9a0', 2);
        A.disc(1108, 344, 28, '#ffc37a', 2);
        A.glow(1000, 306, 180, '#ffd9a0', 0.2);
        A.ridge(452, 20, 611, '#6b3a26', { freq: 0.004, rough: 0.7 });
        A.ridgeEdge(452, 20, 611, '#c9864d', { thick: 2 });
        A.ridge(508, 16, 612, '#4e2a1e', { freq: 0.005, rough: 0.8 });
        A.ridgeEdge(508, 16, 612, '#b0713f', { thick: 2 });
        A.ridge(560, 12, 613, '#341b16', { freq: 0.006, rough: 0.7 });
        A.ridgeEdge(560, 12, 613, '#94603a', { thick: 2 });
        A.ridge(620, 10, 614, '#20110f', { freq: 0.007, rough: 0.6 });
        A.ridgeEdge(620, 10, 614, '#6f462c', { thick: 2 });
        // 巨碑
        A.ctx.fillStyle = '#100c0c';
        A.ctx.beginPath();
        A.ctx.moveTo(852, 620);
        A.ctx.lineTo(872, 286);
        A.ctx.lineTo(944, 258);
        A.ctx.lineTo(966, 620);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.strokeStyle = '#c9864d';
        A.ctx.lineWidth = 2;
        A.ctx.stroke();
        A.rect(884, 320, 6, 210, A.rgba('#7a4a2c', 0.5));
        A.rect(916, 344, 4, 160, A.rgba('#7a4a2c', 0.4));
        for (let i = 0; i < 8; i++) A.rect(888 + (i % 3) * 18, 360 + i * 26, 26, 2, A.rgba('#e0a15c', 0.16));
        // 长影
        A.ctx.fillStyle = A.rgba('#0b0707', 0.55);
        A.ctx.beginPath();
        A.ctx.moveTo(852, 620);
        A.ctx.lineTo(966, 620);
        A.ctx.lineTo(640, 680);
        A.ctx.lineTo(560, 676);
        A.ctx.closePath();
        A.ctx.fill();
        for (const b of birds) A.rect(b.x + Math.sin(t * 0.12 + b.p) * b.drift, b.y + Math.cos(t * 0.1 + b.p) * 4, 5, 1, A.rgba('#2a1614', 0.6));
        A.beast(470, 646, 5, { t, rim: '#ffd9a0', color: '#0a0606' });
        for (const s of sand) {
          const x = (s.x + t * s.sp) % 1280;
          A.rect(x, s.y + Math.sin(t * 0.8 + s.y) * 4, s.len, 2, A.rgba('#e8b07c', s.a));
        }
      },
    });
  })();

  // ── 07 极夜 · 极光 ────────────────────────────────────────────────────
  (() => {
    const r = A.rng(710);
    const snow = [];
    for (let i = 0; i < 70; i++) snow.push({ x: r() * 1280, y: r() * 700, s: r() < 0.25 ? 3 : 1, sp: 7 + r() * 18, ph: r() * 6 });
    const stars = A.stars(r, 180, 400);
    S.push({
      title: '极夜 · 极光', short: '极夜',
      sub: '长夜把冰川压成一条细线，极光在天顶缓慢翻页。它朝那盏孤灯走去，脚下每一步都发出脆响。',
      draw(t) {
        A.sky([[0, '#040a14'], [0.5, '#081626'], [0.82, '#0d2036'], [1, '#132b42']]);
        A.drawStars(stars, t);
        A.aurora(120, t, '#3fe0a0', '#2ba6c9');
        A.aurora(192, t * 0.8 + 1.8, '#8a6cff', '#3fe0a0');
        A.aurora(258, t * 1.1 + 3.2, '#2ba6c9', '#8a6cff');
        A.ridge(430, 28, 711, '#0c2130', { freq: 0.005, rough: 0.9, jag: 10 });
        A.ridgeEdge(430, 28, 711, '#5fa3b8', { thick: 2 });
        A.ridge(478, 18, 712, '#0a1c2a', { freq: 0.007, rough: 0.8 });
        A.ridgeEdge(478, 18, 712, '#3f7f96', { thick: 2 });
        A.ridge(560, 8, 713, '#102a3e', { freq: 0.006, rough: 0.6 });
        A.ridgeEdge(560, 8, 713, '#244a60', { thick: 2 });
        for (let i = 0; i < 20; i++) {
          A.rect(40 + i * 64, 566 + (i % 3) * 5, 48, 2, A.rgba('#5b8fa6', 0.18));
        }
        // 冰凌
        for (let i = 0; i < 9; i++) {
          A.rect(60 + i * 52, 540 - i * 3, 4, 34, A.rgba('#bfe8f2', 0.22));
        }
        // 冰裂与冰柱，让雪原不是一整块空色
        for (let i = 0; i < 12; i++) {
          const x = 60 + i * 104;
          A.line(x, 586 + (i % 3) * 8, x + 44, 646 + (i % 4) * 6, A.rgba('#6fa8bd', 0.22), 2);
        }
        for (let i = 0; i < 8; i++) {
          const x = 96 + i * 148;
          A.rect(x, 536 - (i % 3) * 10, 4, 64, '#0a2030');
          A.rect(x, 536 - (i % 3) * 10, 2, 64, A.rgba('#7fc7d9', 0.25));
        }
        // 孤灯 + 光柱
        const pulse = 0.55 + 0.45 * Math.sin(t * 2);
        A.rect(1044, 300, 4, 180, A.rgba('#ffd9a0', 0.07));
        A.glow(1046, 486, 70, '#ffd9a0', 0.2 + pulse * 0.12);
        A.rect(1042, 476, 8, 24, '#ffd9a0');
        A.ellipseRing(1046, 486, 22 + pulse * 6, 7 + pulse * 2, 2, '#ffd9a0', 0.4 * pulse);
        A.beast(500, 642, 5, { t, rim: '#9fe6ee', color: '#040a10' });
        for (const s of snow) {
          const y = (s.y + t * s.sp) % 700;
          A.rect(s.x + Math.sin(t * 0.5 + s.ph) * 12, y, s.s, s.s, A.rgba('#dff6ff', 0.5));
        }
      },
    });
  })();

  // ── 08 熔心 · 彼岸 ────────────────────────────────────────────────────
  (() => {
    const r = A.rng(810);
    const embers = [];
    for (let i = 0; i < 60; i++) embers.push({ x: 200 + r() * 1000, y: 300 + r() * 380, s: r() < 0.25 ? 3 : 1, sp: 10 + r() * 30, ph: r() * 6 });
    const spikes = [];
    for (let i = 0; i < 14; i++) spikes.push({ x: 60 + i * 88, w: 10 + r() * 26, h: 20 + r() * 70 });
    S.push({
      title: '熔心 · 彼岸', short: '熔心',
      sub: '地心只剩两种颜色：岩石的黑，和熔岩的金。它踏上天然石桥，向那道光的裂口走去。',
      draw(t) {
        A.sky([[0, '#0a0605'], [0.45, '#210b08'], [0.72, '#45170c'], [1, '#1a0906']]);
        A.glow(1060, 400, 260, '#ff7a2a', 0.16);
        // 前景岩体只占底部两角，避免把洞廊画成帐篷
        A.ctx.fillStyle = '#050303';
        A.ctx.beginPath();
        A.ctx.moveTo(0, 720); A.ctx.lineTo(0, 540); A.ctx.lineTo(90, 590);
        A.ctx.lineTo(170, 560); A.ctx.lineTo(250, 660); A.ctx.lineTo(260, 720);
        A.ctx.closePath(); A.ctx.fill();
        A.ctx.beginPath();
        A.ctx.moveTo(1280, 720); A.ctx.lineTo(1280, 500); A.ctx.lineTo(1200, 560);
        A.ctx.lineTo(1140, 520); A.ctx.lineTo(1100, 640); A.ctx.lineTo(1080, 720);
        A.ctx.closePath(); A.ctx.fill();
        for (let i = 0; i < 5; i++) A.rect(44 + i * 44, 610 - i * 12, 10, 52, '#050303');
        for (let i = 0; i < 4; i++) A.rect(1160 + i * 26, 590 - i * 8, 8, 44, '#050303');
        // 溶洞顶
        A.ctx.fillStyle = '#050303';
        A.ctx.beginPath();
        A.ctx.moveTo(0, 0);
        A.ctx.lineTo(1280, 0);
        A.ctx.lineTo(1280, 120);
        A.ctx.lineTo(1120, 90);
        A.ctx.lineTo(980, 140);
        A.ctx.lineTo(760, 70);
        A.ctx.lineTo(560, 120);
        A.ctx.lineTo(360, 60);
        A.ctx.lineTo(120, 130);
        A.ctx.lineTo(0, 90);
        A.ctx.closePath();
        A.ctx.fill();
        for (const s of spikes) {
          A.ctx.fillStyle = '#050303';
          A.ctx.beginPath();
          A.ctx.moveTo(s.x, 100);
          A.ctx.lineTo(s.x + s.w / 2, 100 + s.h);
          A.ctx.lineTo(s.x + s.w, 100);
          A.ctx.closePath();
          A.ctx.fill();
        }
        // 熔岩河
        for (let y = 540; y < 720; y += 8) {
          const p = (y - 540) / 180;
          A.rect(0, y, 1280, 9, A.mix('#7a1e07', '#ffb347', p));
        }
        for (let i = 0; i < 5; i++) {
          A.bandWave(556 + i * 30, 6, 0.004 + i * 0.001, A.rgba('#ffd06a', 0.55 - i * 0.07), 3, t * 0.6 + i);
        }
        for (let i = 0; i < 6; i++) {
          const x = (i * 210 + t * 40) % 1280;
          A.rect(x, 600 + (i % 3) * 26, 10, 3, A.rgba('#ffd06a', 0.7));
        }
        // 远处的巨石拱与岩浆瀑布：把洞窟的尺度撑起来
        A.ctx.fillStyle = '#080403';
        A.ctx.beginPath();
        A.ctx.moveTo(220, 560); A.ctx.lineTo(260, 420); A.ctx.lineTo(360, 340);
        A.ctx.lineTo(520, 330); A.ctx.lineTo(640, 380); A.ctx.lineTo(700, 560);
        A.ctx.lineTo(620, 560); A.ctx.lineTo(590, 430); A.ctx.lineTo(500, 390);
        A.ctx.lineTo(390, 400); A.ctx.lineTo(320, 460); A.ctx.lineTo(300, 560);
        A.ctx.closePath(); A.ctx.fill();
        A.ctx.strokeStyle = A.rgba('#8a3a14', 0.55);
        A.ctx.lineWidth = 2;
        A.ctx.stroke();
        for (let i = 0; i < 14; i++) {
          const off = (t * 70 + i * 26) % 230;
          A.rect(344 + (i % 4) * 5, 386 + off, 3, 34, A.rgba('#ffb347', 0.45));
        }
        A.rect(330, 560, 52, 3, A.rgba('#ffd06a', 0.6));
        // 石桥
        A.ctx.fillStyle = '#0b0707';
        A.ctx.beginPath();
        A.ctx.moveTo(120, 566);
        A.ctx.lineTo(1140, 512);
        A.ctx.lineTo(1160, 552);
        A.ctx.lineTo(140, 606);
        A.ctx.closePath();
        A.ctx.fill();
        A.ctx.strokeStyle = '#c96a2a';
        A.ctx.lineWidth = 2;
        A.ctx.beginPath();
        A.ctx.moveTo(120, 566);
        A.ctx.lineTo(1140, 512);
        A.ctx.stroke();
        // 光之裂口：不规则的岩缝，而不是一扇门
        const pulse = 0.65 + 0.35 * Math.sin(t * 1.6);
        A.ctx.beginPath();
        A.ctx.moveTo(1038, 226);
        A.ctx.lineTo(1076, 244);
        A.ctx.lineTo(1060, 306);
        A.ctx.lineTo(1092, 338);
        A.ctx.lineTo(1064, 420);
        A.ctx.lineTo(1084, 500);
        A.ctx.lineTo(1042, 560);
        A.ctx.lineTo(1018, 470);
        A.ctx.lineTo(1032, 396);
        A.ctx.lineTo(1012, 330);
        A.ctx.lineTo(1024, 272);
        A.ctx.closePath();
        A.ctx.strokeStyle = '#1a0f0b';
        A.ctx.lineWidth = 16;
        A.ctx.stroke();
        A.ctx.fillStyle = A.rgba('#ffe9b0', 0.26 + pulse * 0.24);
        A.ctx.fill();
        A.rect(1052, 248, 6, 292, A.rgba('#fff8e0', 0.9));
        A.rect(1062, 280, 3, 230, A.rgba('#ffe9b0', 0.5));
        A.rect(1044, 300, 2, 208, A.rgba('#ffe9b0', 0.45));
        A.glow(1058, 396, 170, '#ffd06a', 0.16 + pulse * 0.08);
        A.rect(1018, 566, 70, 3, A.rgba('#ffd06a', 0.3 * pulse));
        A.beast(648, 542, 5, { t, rim: '#ffd06a', color: '#050303' });
        for (const e of embers) {
          const y = (e.y - t * e.sp) % 420;
          const yy = y < 0 ? y + 420 : y;
          A.rect(e.x + Math.sin(t + e.ph) * 8, 300 + yy, e.s, e.s, A.rgba('#ffb347', 0.55));
        }
      },
    });
  })();

  // ── 09 云海 · 天关 ────────────────────────────────────────────────────
  (() => {
    const r = A.rng(910);
    const birds = [];
    for (let i = 0; i < 9; i++) birds.push({ x: 300 + r() * 760, y: 180 + r() * 160, p: r() * 6, drift: 12 + r() * 20 });
    const islands = [
      { x: 60, y: 420, w: 360, h: 90 },
      { x: 420, y: 470, w: 240, h: 70 },
    ];
    S.push({
      title: '云海 · 天关', short: '天关',
      sub: '云在脚下铺成海，浮岛像被遗忘的台阶。石关在前方发亮，它沿着断桥一路奔跑。',
      draw(t) {
        A.sky([[0, '#081226'], [0.4, '#1b3a5a'], [0.68, '#5f7f8f'], [1, '#e8b07c']]);
        A.disc(1052, 244, 54, '#ffe6b8', 2);
        A.glow(1052, 244, 140, '#ffe6b8', 0.2);
        A.drawStars(A.stars(A.rng(911), 90, 260), t, 0.4);
        // 远山
        A.ridge(400, 26, 912, '#22374d', { freq: 0.004, rough: 0.8 });
        A.cloudSea(440, t, 913, '#7f93a0', '#aebfc6');
        A.cloudSea(520, t * 0.8 + 1, 914, '#5e7482', '#93a7b1');
        // 浮岛
        for (const is of islands) {
          A.ctx.fillStyle = '#0c1824';
          A.ctx.beginPath();
          A.ctx.moveTo(is.x, is.y);
          A.ctx.lineTo(is.x + is.w, is.y - 10);
          A.ctx.lineTo(is.x + is.w * 0.72, is.y + is.h);
          A.ctx.lineTo(is.x + is.w * 0.3, is.y + is.h * 0.7);
          A.ctx.closePath();
          A.ctx.fill();
          A.rect(is.x + 8, is.y - 4, is.w - 16, 6, '#3f6c3c');
          A.rect(is.x + 20, is.y + 8, is.w * 0.5, 2, A.rgba('#6b8f5a', 0.5));
          for (let i = 0; i < 7; i++) {
            A.rect(is.x + 18 + i * 26, is.y - 8 - (i % 3) * 2, 2, 6, A.rgba('#5c8552', 0.8));
          }
          for (let i = 0; i < 4; i++) {
            A.line(is.x + 24 + i * 48, is.y + 14, is.x + 16 + i * 52, is.y + is.h * 0.7, A.rgba('#1d303f', 0.7), 2);
          }
        }
        // 浮石（给云海一点纵深）
        for (const [x, y, w] of [[250, 360, 46], [470, 330, 34], [1080, 360, 40], [720, 300, 28]]) {
          A.rect(x, y, w, 10, '#0c1824');
          A.rect(x + 4, y - 2, w - 8, 3, '#3f6c3c');
          A.ctx.fillStyle = '#0c1824';
          A.ctx.beginPath();
          A.ctx.moveTo(x + 3, y + 10);
          A.ctx.lineTo(x + w / 2, y + 30);
          A.ctx.lineTo(x + w - 3, y + 10);
          A.ctx.closePath();
          A.ctx.fill();
        }
        // 石关
        const gx = 860;
        A.ctx.fillStyle = '#0a1118';
        A.ctx.fillRect(gx, 190, 36, 250);
        A.ctx.fillRect(gx + 166, 190, 36, 250);
        A.ctx.fillRect(gx - 20, 168, 242, 34);
        A.ctx.strokeStyle = '#9db7c6';
        A.ctx.lineWidth = 2;
        A.ctx.strokeRect(gx, 190, 36, 250);
        A.ctx.strokeRect(gx + 166, 190, 36, 250);
        A.ctx.strokeRect(gx - 20, 168, 242, 34);
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.4);
        A.rect(gx + 40, 202, 122, 238, A.rgba('#ffe9b0', 0.08 + pulse * 0.1));
        A.rect(gx + 62, 210, 78, 230, A.rgba('#ffe9b0', 0.05 + pulse * 0.08));
        A.rect(gx + 92, 236, 18, 200, A.rgba('#fff3cf', 0.16 + pulse * 0.12));
        A.rect(gx + 84, 168, 24, 8, A.rgba('#ffe9b0', 0.5));
        A.glow(gx + 101, 340, 110, '#ffe9b0', 0.08 + pulse * 0.05);
        for (let i = 0; i < 3; i++) {
          A.rect(gx + 72 + i * 18, 434, 12, 4, A.rgba('#9db7c6', 0.35));
        }
        // 断桥
        A.ctx.fillStyle = '#0a1118';
        A.ctx.beginPath();
        A.ctx.moveTo(250, 470);
        A.ctx.lineTo(820, 418);
        A.ctx.lineTo(820, 446);
        A.ctx.lineTo(250, 500);
        A.ctx.closePath();
        A.ctx.fill();
        A.line(250, 470, 820, 418, '#8fa7b2', 2);
        A.beast(600, 437, 5, { t, rim: '#ffe9b0', color: '#050a0e' });
        A.birds(birds, t, A.rgba('#0c1620', 0.7));
      },
    });
  })();

  // ── 10 顿悟 · 倒影 ────────────────────────────────────────────────────
  (() => {
    const r = A.rng(1010);
    const st = A.stars(r, 220, 400);
    const gx = 640;
    const gy = 196;
    const gR = 210;
    const gd = [];
    for (let i = 0; i < 460; i++) {
      const arm = i % 2;
      const rr = Math.pow(i / 460, 0.62) * gR;
      const ang = arm * Math.PI + rr * 0.03 + i * 0.618 + 0.4;
      gd.push({
        x: gx + Math.cos(ang) * rr * 1.5 + (r() - 0.5) * 8,
        y: gy + Math.sin(ang) * rr * 0.6 + (r() - 0.5) * 8,
        s: rr < gR * 0.2 ? 2 : 1,
        c: rr < gR * 0.35 ? '#ffe8c2' : rr < gR * 0.7 ? '#bcd4ff' : '#7f8fd8',
        a: 0.25 + r() * 0.55,
      });
    }
    const flies = [];
    for (let i = 0; i < 20; i++) flies.push({ x: 400 + r() * 480, y: 380 + r() * 160, ph: r() * 6 });
    S.push({
      title: '顿悟 · 倒影', short: '顿悟',
      sub: '没有风，水面把整条星河完整地放回大地。它停在光的正中央，忽然明白了要往哪里去。',
      draw(t) {
        A.sky([[0, '#04050f'], [0.4, '#091230'], [0.62, '#122048'], [0.66, '#1b315a']]);
        A.drawStars(st, t);
        for (const d of gd) {
          const rot = t * 0.018;
          const dx = d.x - gx;
          const dy = d.y - gy;
          const x = gx + dx * Math.cos(rot) - dy * Math.sin(rot);
          const y = gy + dx * Math.sin(rot) + dy * Math.cos(rot);
          A.rect(x, y, d.s, d.s, A.rgba(d.c, d.a));
        }
        A.disc(gx, gy, gR * 0.1, '#fff6dc', 2, 0.85);
        // 巨环（顿悟的核）
        const pulse = 0.55 + 0.45 * Math.sin(t * 1.1);
        A.ellipseRing(gx, 392, 132, 132, 4, '#ffe9b0', 0.85);
        A.ellipseRing(gx, 392, 142 + pulse * 6, 142 + pulse * 6, 2, '#ffe9b0', 0.2);
        A.ellipseRing(gx, 392, 120, 120, 2, '#fff3cf', 0.5);
        A.disc(gx, 392, 116, '#060914', 2);
        A.disc(gx, 392, 108, '#04050f', 2);
        A.glow(gx, 392, 200, '#ffe9b0', 0.09 + pulse * 0.05);
        // 水面
        for (let y = 452; y < 720; y += 6) {
          A.rect(0, y, 1280, 7, A.mix('#0b1730', '#05080f', (y - 452) / 268));
        }
        A.rect(0, 450, 1280, 2, A.rgba('#9fb8e0', 0.22));
        // 星河倒影
        for (const d of gd) {
          const ry = 884 - d.y;
          if (ry > 454) A.rect(d.x, ry, d.s, d.s, A.rgba(d.c, d.a * 0.35));
        }
        // 巨环倒影（椭圆，不是第二个圆）
        A.ellipseRing(gx, 494, 124, 40, 3, '#ffe9b0', 0.28);
        A.ellipseRing(gx, 494, 106, 32, 2, '#ffe9b0', 0.16);
        // 水面光路
        for (let i = 0; i < 12; i++) {
          const w = 22 - Math.abs(i - 6) * 2;
          A.rect(gx - w / 2 + Math.sin(t * 0.8 + i) * 4, 460 + i * 8, w, 2, A.rgba('#ffe9b0', 0.07 + (i % 3) * 0.02));
        }
        for (let i = 0; i < 10; i++) {
          A.bandWave(470 + i * 26, 3, 0.006 + i * 0.001, A.rgba('#7f9fd0', 0.1), 2, t * 0.3 + i);
        }
        // 牛马与它的倒影
        A.beast(640, 586, 5, { t, mode: 'stand', rim: '#ffe9b0', color: '#04050b' });
        A.ctx.save();
        A.ctx.translate(0, 1172);
        A.ctx.scale(1, -1);
        A.ctx.globalAlpha = 0.18;
        A.beast(640, 586, 5, { t, mode: 'stand', color: '#04050b' });
        A.ctx.restore();
        for (let i = 0; i < 10; i++) {
          A.rect(580 + i * 14, 592 + Math.sin(t * 1.4 + i) * 2, 8, 1, A.rgba('#9fb8e0', 0.16));
        }
        for (const f of flies) {
          const x = f.x + Math.sin(t * 0.5 + f.ph) * 12;
          const y = f.y + Math.cos(t * 0.4 + f.ph) * 8;
          const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.8 + f.ph));
          A.rect(x, y, 2, 2, A.rgba('#ffe3a0', a * 0.7));
        }
      },
    });
  })();
})();
