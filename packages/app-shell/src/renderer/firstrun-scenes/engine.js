/* 首启场景 · 水墨光景引擎 v2（1280×720）
 * 背景是平滑的水彩/水墨层；主角是我们的真实像素 logo 牛马（最近邻放大，块宽取整）。
 */
(() => {
  'use strict';
  const VW = 1280;
  const VH = 720;
  const TAU = Math.PI * 2;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = VW;
  canvas.height = VH;
  ctx.imageSmoothingEnabled = true;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const logo = new Image();
  let logoReady = false;
  let logoBody = null;
  logo.onload = () => {
    // 拆出“去掉头/尾/腿”的身体，头尾腿分别按相位绘制
    const c = document.createElement('canvas');
    c.width = 700; c.height = 400;
    const g = c.getContext('2d');
    g.drawImage(logo, 0, 0);
    g.clearRect(500, 0, 200, 200);
    g.clearRect(0, 140, 105, 165);
    g.clearRect(0, 248, 700, 152);
    logoBody = c;
    logoReady = true;
  };
  logo.src = 'logo-tight.png';

  const chooser = document.getElementById('chooser');
  const scenes = (window.FIRSTRUN_SCENES = []);
  let active = null;
  let activeIndex = -1;
  let start = 0;
  let token = 0;
  let auto = false;
  const AUTO_MS = 12000;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexRgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (hex, a) => {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };
  function mix(a, b, p) {
    const x = hexRgb(a), y = hexRgb(b);
    return `rgb(${Math.round(lerp(x[0], y[0], p))},${Math.round(lerp(x[1], y[1], p))},${Math.round(lerp(x[2], y[2], p))})`;
  }
  function grad(x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [p, c] of stops) g.addColorStop(clamp(p, 0, 1), c);
    return g;
  }
  const vgrad = (y0, y1, stops) => grad(0, y0, 0, y1, stops);
  function sky(stops) {
    ctx.fillStyle = vgrad(0, VH, stops);
    ctx.fillRect(0, 0, VW, VH);
  }

  /** 柔边椭圆（水彩/云/雾/光晕都用它）。 */
  function softEllipse(x, y, rx, ry, color, alpha = 1) {
    const r = Math.max(1, rx);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, Math.max(0.02, ry / r));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.45, rgba(color, alpha * 0.72));
    g.addColorStop(0.78, rgba(color, alpha * 0.24));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  /** 不规则水彩晕：几个偏心柔斑叠在一起，避免“标准椭圆”。 */
  function wash(x, y, rx, ry, color, alpha = 0.4, seed = 1) {
    const r = rng(seed);
    for (let i = 0; i < 4; i++) {
      softEllipse(
        x + (r() - 0.5) * rx * 0.55,
        y + (r() - 0.5) * ry * 0.5,
        rx * (0.55 + r() * 0.5),
        ry * (0.55 + r() * 0.5),
        color,
        alpha * (0.5 + r() * 0.5),
      );
    }
  }

  // 纸张纤维：一次生成 192×192 的无色噪点，按 multiply 低透明度铺满。
  const paperPattern = (() => {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 192;
    const g = c.getContext('2d');
    const img = g.createImageData(192, 192);
    const r = rng(20261023);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.floor(r() * 90);
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
      img.data[i + 3] = r() < 0.32 ? 12 + Math.floor(r() * 20) : 0;
    }
    g.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  })();
  function paper() {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = paperPattern;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  function ridgePoints(o = {}) {
    const r = rng(o.seed || 1);
    const ph = r() * TAU, ph2 = r() * TAU, ph3 = r() * TAU;
    const amp = o.amp == null ? 60 : o.amp;
    const base = o.base == null ? 560 : o.base;
    const step = o.step || 48;
    const pts = [];
    for (let x = -100; x <= VW + 100; x += step) {
      const u = (x + 100) / (VW + 200);
      const y = base
        + Math.sin(u * TAU * (o.waves == null ? 1.35 : o.waves) + ph) * amp
        + Math.sin(u * TAU * (o.waves2 == null ? 4.3 : o.waves2) + ph2) * amp * 0.32
        + Math.sin(u * TAU * (o.waves3 == null ? 9.1 : o.waves3) + ph3) * amp * 0.09;
      pts.push([x, y]);
    }
    return pts;
  }
  function smoothPath(pts, bottom) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i][0] + pts[i + 1][0]) / 2;
      const yc = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    if (bottom != null) {
      ctx.lineTo(VW + 120, bottom);
      ctx.lineTo(-120, bottom);
      ctx.closePath();
    }
  }
  /** 水墨山脊：顶部浓、底部化进雾里；附带飞白与毛涩颗粒。 */
  function inkRidge(o = {}) {
    const pts = o.pts || ridgePoints(o);
    const bottom = o.bottom == null ? VH + 40 : o.bottom;
    let minY = Infinity;
    for (const p of pts) minY = Math.min(minY, p[1]);
    const a = o.alpha == null ? 0.5 : o.alpha;
    const color = o.color || '#5c6f6b';
    smoothPath(pts, bottom);
    ctx.fillStyle = vgrad(minY, bottom, [
      [0, rgba(color, a)],
      [0.45, rgba(color, a * 0.62)],
      [0.82, rgba(color, a * 0.18)],
      [1, rgba(color, a * 0.03)],
    ]);
    ctx.fill();
    if (o.bleed !== false) {
      ctx.save();
      smoothPath(pts.map(([x, y]) => [x + 2.5, y + 3]), bottom);
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = rgba(color, a * 0.3);
      ctx.fill();
      ctx.restore();
    }
    if (o.grain !== 0) {
      const r = rng((o.seed || 1) + 97);
      const n = o.grain == null ? 46 : o.grain;
      for (let i = 0; i < n; i++) {
        const p = pts[1 + Math.floor(r() * Math.max(1, pts.length - 2))];
        const y = p[1] + r() * Math.min(150, bottom - p[1]);
        const len = 8 + r() * 58;
        ctx.globalAlpha = 0.03 + r() * 0.08;
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.6 + r() * 1.7;
        ctx.beginPath();
        ctx.moveTo(p[0], y);
        ctx.quadraticCurveTo(p[0] + len * 0.5, y - 2 - r() * 3, p[0] + len, y + (r() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** 一笔毛笔：主线 + 两侧毛涩飞白。 */
  function brush(pts, width, color, alpha = 0.7) {
    ctx.save();
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i][0] + pts[i + 1][0]) / 2;
      const yc = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.3;
    ctx.lineWidth = Math.max(0.6, width * 0.45);
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] + k - 1, pts[0][1] + k * 0.8);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i][0] + pts[i + 1][0]) / 2;
        const yc = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0] + k - 1, pts[i][1] + k * 0.8, xc, yc);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 朱红印章：小、克制，只在留白多的幕里出现。 */
  function seal(x, y, size = 30, color = '#b4483c') {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    const r = size * 0.12;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + size - r, y);
    ctx.quadraticCurveTo(x + size, y, x + size, y + r);
    ctx.lineTo(x + size, y + size - r);
    ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
    ctx.lineTo(x + r, y + size);
    ctx.quadraticCurveTo(x, y + size, x, y + size - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#f8ecdc';
    ctx.lineWidth = Math.max(1.4, size * 0.075);
    ctx.beginPath();
    ctx.moveTo(x + size * 0.24, y + size * 0.3);
    ctx.lineTo(x + size * 0.76, y + size * 0.3);
    ctx.moveTo(x + size * 0.5, y + size * 0.3);
    ctx.lineTo(x + size * 0.5, y + size * 0.72);
    ctx.moveTo(x + size * 0.32, y + size * 0.52);
    ctx.lineTo(x + size * 0.68, y + size * 0.52);
    ctx.moveTo(x + size * 0.28, y + size * 0.72);
    ctx.lineTo(x + size * 0.72, y + size * 0.72);
    ctx.stroke();
    ctx.restore();
  }

  function sun(x, y, r, core = '#fff3d2', glow = '#ffe9bd') {
    softEllipse(x, y, r * 4.4, r * 4.4, glow, 0.12);
    softEllipse(x, y, r * 2.1, r * 2.1, glow, 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.72, core);
    g.addColorStop(1, rgba(glow, 0.92));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  function moon(x, y, r, color = '#fffaf0') {
    softEllipse(x, y, r * 3.6, r * 3.6, '#eef1ff', 0.16);
    softEllipse(x, y, r * 1.6, r * 1.6, color, 0.36);
    ctx.fillStyle = grad(x - r, y - r, x + r, y + r, [[0, '#ffffff'], [0.6, color], [1, '#eadfca']]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function stars(list, t, color = '#e6c98a') {
    for (const s of list) {
      const tw = 0.55 + 0.45 * Math.sin(t * (s.speed || 1.4) + s.p);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r || 1.1, 0, TAU);
      ctx.fill();
      if (s.r > 1.6) {
        ctx.globalAlpha *= 0.55;
        ctx.fillRect(s.x - s.r * 3.2, s.y - 0.5, s.r * 6.4, 1);
        ctx.fillRect(s.x - 0.5, s.y - s.r * 3.2, 1, s.r * 6.4);
      }
    }
    ctx.globalAlpha = 1;
  }
  function shootingStar(t, period, seed, x0, y0, x1, y1) {
    const u = (((t / period) + seed) % 1 + 1) % 1;
    if (u > 0.11) return;
    const p = u / 0.11;
    const x = lerp(x0, x1, p);
    const y = lerp(y0, y1, p);
    const a = Math.sin(p * Math.PI) * 0.9;
    const g = ctx.createLinearGradient(x - 90, y - 34, x, y);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(255,250,228,${a})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - 90, y - 34);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function rays(x, y, count, len, spread, color, alpha, t = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 0.05) * 0.02);
    for (let i = 0; i < count; i++) {
      const a = (-spread / 2 + (spread / (count - 1 || 1)) * i) + Math.sin(t * 0.07 + i) * 0.008;
      const w = 0.035 + (i % 3) * 0.012;
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(0.55, rgba(color, alpha * 0.35));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.lineTo(2, 0);
      ctx.lineTo(len * w, len);
      ctx.lineTo(-len * w, len);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function cloud(x, y, w, h, color = '#ffffff', shade = '#dfe7ef', alpha = 0.9) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const puffs = [
      [-0.28, 0.05, 0.44], [-0.06, -0.12, 0.56], [0.18, -0.02, 0.5], [0.34, 0.08, 0.38],
    ];
    for (const [px, py, pr] of puffs) {
      softEllipse(x + px * w, y + py * h, w * pr * 0.5, h * (0.55 + pr * 0.4), color, 0.95);
    }
    ctx.globalAlpha = alpha * 0.5;
    softEllipse(x, y + h * 0.34, w * 0.5, h * 0.22, shade, 0.7);
    ctx.restore();
  }
  function cloudSea(y, color, seed, t, speed = 7, count = 18, alpha = 0.8) {
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const baseX = r() * (VW + 520);
      const x = ((baseX + t * speed + i * 47) % (VW + 520)) - 260;
      const cy = y + (r() - 0.5) * 90;
      const rx = 90 + r() * 170;
      const ry = 22 + r() * 34;
      softEllipse(x, cy, rx, ry, color, alpha * (0.28 + r() * 0.4));
      softEllipse(x + rx * 0.18, cy + ry * 0.42, rx * 0.72, ry * 0.34, '#b9c6d2', alpha * 0.1);
    }
  }
  function mist(y, h, color, alpha, seed, t, speed = 9) {
    const r = rng(seed);
    for (let i = 0; i < 5; i++) {
      const x = ((r() * VW + t * speed * (0.5 + i * 0.12)) % (VW + 400)) - 200;
      softEllipse(x, y + (r() - 0.5) * h, 260 + r() * 240, h * (0.35 + r() * 0.4), color, alpha * (0.5 + r() * 0.5));
    }
  }

  function birds(list, t, color = '#6a7f82', alpha = 0.55) {
    ctx.save();
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = 1.6;
    for (const b of list) {
      const x = b.x + Math.sin(t * 0.16 + b.p) * (b.drift || 14);
      const y = b.y + Math.cos(t * 0.13 + b.p) * 5;
      const flap = Math.sin(t * (b.speed || 2.6) + b.p) * (b.size || 5) * 0.55;
      ctx.beginPath();
      ctx.moveTo(x - (b.size || 5), y - flap);
      ctx.quadraticCurveTo(x - (b.size || 5) * 0.4, y + 1, x, y);
      ctx.quadraticCurveTo(x + (b.size || 5) * 0.4, y + 1, x + (b.size || 5), y - flap);
      ctx.stroke();
    }
    ctx.restore();
  }

  function pine(x, y, len, angle, color, t = 0, alpha = 0.75) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.sin(t * 0.25) * 0.006);
    const pts = [[0, 0], [len * 0.28, -len * 0.12], [len * 0.6, -len * 0.22], [len, -len * 0.3]];
    brush(pts, 9, color, alpha);
    const r = rng(7);
    // 两簇侧枝
    for (const [bp, dir] of [[0.38, 1], [0.68, -1], [0.86, 1]]) {
      const bx = len * bp;
      const by = -len * 0.3 * bp;
      const bl = len * (0.22 + r() * 0.12);
      ctx.globalAlpha = alpha * 0.72;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + bl * 0.5, by + dir * bl * 0.25, bx + bl, by + dir * bl * 0.62);
      ctx.stroke();
      softEllipse(bx + bl * 0.68, by + dir * bl * 0.5, bl * 0.5, bl * 0.3, color, alpha * 0.2);
      for (let k = 0; k < 12; k++) {
        const u = 0.22 + (k / 11) * 0.74;
        const nx = bx + bl * u;
        const ny = by + dir * bl * 0.62 * u;
        const nl = 6 + r() * 12;
        if (k % 3 === 0) softEllipse(nx, ny, nl * 1.2, nl * 0.55, color, alpha * 0.22);
        ctx.strokeStyle = rgba(color, alpha * (0.4 + r() * 0.35));
        ctx.lineWidth = 1 + r() * 0.9;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx - nl * 0.12, ny + dir * nl);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + nl * 0.38, ny + dir * nl * 0.72);
        ctx.stroke();
      }
    }
    // 主枝针叶
    for (let i = 0; i < 30; i++) {
      const p = 0.16 + r() * 0.82;
      const bx = len * p;
      const by = -len * 0.3 * p;
      const dir = i % 2 ? 1 : -1;
      const nl = 10 + r() * 24;
      ctx.globalAlpha = alpha * (0.45 + r() * 0.38);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.9 + r() * 1.2;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - nl * 0.18, by + dir * nl * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + nl * 0.36, by + dir * nl * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 整棵松树剪影：分层树冠 + 针叶边缘；用于前景/崖顶，比单枝更有体量。 */
  function pineTree(x, baseY, h, color, alpha = 0.7, t = 0, phase = 0) {
    const sway = Math.sin(t * 0.28 + phase) * h * 0.012;
    ctx.save();
    ctx.translate(x, baseY);
    ctx.strokeStyle = rgba(color, alpha * 0.85);
    ctx.lineWidth = Math.max(3, h * 0.032);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(sway * 0.4, -h * 0.42, sway, -h * 0.94);
    ctx.stroke();
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const u = i / (tiers - 1);
      const cy = -h * (0.33 + u * 0.57);
      const rx = h * (0.34 - u * 0.075) * (1 - u * 0.1);
      const ry = h * 0.1;
      const cx = sway * (0.4 + u * 0.6);
      // 实心不规则冠层
      const n = 16;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const jit = 0.82 + 0.2 * Math.sin(k * 2.7 + i * 1.3);
        const px = cx + Math.cos(a) * rx * jit;
        const py = cy + Math.sin(a) * ry * (jit + (Math.sin(a) > 0 ? 0.22 : 0.02));
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(color, alpha * 0.5);
      ctx.fill();
      // 冠层下缘的针叶
      const m = 12 + i * 2;
      for (let k = 0; k < m; k++) {
        const p = k / (m - 1);
        const nx = cx + (p * 2 - 1) * rx * 0.92;
        const ny = cy + ry * (0.55 + Math.sin(p * Math.PI) * 0.3);
        const dir = p < 0.5 ? -1 : 1;
        ctx.strokeStyle = rgba(color, alpha * (0.3 + (k % 3) * 0.1));
        ctx.lineWidth = 0.9 + (k % 3) * 0.4;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + dir * h * 0.014, ny + h * 0.035);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function grassBlade(x, y, h, sway, color, alpha, width) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + sway * 0.35, y - h * 0.62, x + sway, y - h);
    ctx.stroke();
  }
  function grassField(y0, y1, count, color, seed, t, o = {}) {
    const r = rng(seed);
    const wind = o.wind == null ? 1 : o.wind;
    ctx.save();
    for (let i = 0; i < count; i++) {
      const x = r() * (VW + 40) - 20;
      const y = y0 + r() * (y1 - y0);
      const depth = (y - y0) / Math.max(1, y1 - y0);
      const h = (o.minH || 8) + r() * ((o.maxH || 34) - (o.minH || 8)) * (0.4 + depth);
      const sway = Math.sin(t * 0.9 * wind + x * 0.018 + r() * 6) * (4 + depth * 7);
      grassBlade(x, y, h, sway, o.color2 && r() < 0.3 ? o.color2 : color, (o.alpha || 0.5) * (0.55 + depth * 0.5), (o.width || 1.6) * (0.6 + depth * 0.7));
    }
    ctx.restore();
  }

  function makeFlowers(seed, count, y0, y1, colors) {
    const r = rng(seed);
    const out = [];
    for (let i = 0; i < count; i++) {
      const depth = r();
      out.push({
        x: r() * (VW + 60) - 30,
        y: y0 + r() * (y1 - y0),
        s: 1.5 + depth * 6.2,
        c: colors[Math.floor(r() * colors.length)],
        ph: r() * TAU,
        type: r() < 0.62 ? 0 : 1,
        depth,
      });
    }
    out.sort((a, b) => a.depth - b.depth);
    return out;
  }
  function drawFlowers(list, t, stem = '#6f9360', ground = null) {
    for (const f of list) {
      const sway = Math.sin(t * 0.75 + f.x * 0.012 + f.ph) * (2 + f.depth * 5);
      const x = f.x + sway;
      if (f.type === 0) {
        ctx.strokeStyle = rgba(stem, 0.35 + f.depth * 0.3);
        ctx.lineWidth = Math.max(0.6, f.s * 0.16);
        ctx.beginPath();
        ctx.moveTo(f.x, ground == null ? f.y + f.s * 1.8 : ground);
        ctx.quadraticCurveTo(f.x + sway * 0.4, f.y + f.s * 0.8, x, f.y);
        ctx.stroke();
        ctx.fillStyle = rgba(f.c, 0.62 + f.depth * 0.3);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + f.ph * 0.2;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * f.s * 0.55, f.y + Math.sin(a) * f.s * 0.5, f.s * 0.5, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,244,206,.9)';
        ctx.beginPath();
        ctx.arc(x, f.y, f.s * 0.24, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = rgba(f.c, 0.5 + f.depth * 0.35);
        ctx.beginPath();
        ctx.arc(x, f.y, f.s * 0.6, 0, TAU);
        ctx.fill();
      }
    }
  }
  function petals(list, t, color) {
    for (const p of list) {
      const x = ((p.x + t * p.vx + Math.sin(t * 0.6 + p.ph) * 22) % (VW + 80) + VW + 80) % (VW + 80) - 40;
      const y = ((p.y + t * p.vy + Math.cos(t * 0.45 + p.ph) * 12) % (VH + 60) + VH + 60) % (VH + 60) - 30;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.ph + t * p.spin);
      ctx.fillStyle = rgba(color || p.c, p.a);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.48, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  function butterflies(list, t, color) {
    for (const b of list) {
      const x = b.x + Math.sin(t * 0.5 + b.ph) * 26;
      const y = b.y + Math.cos(t * 0.43 + b.ph * 1.3) * 14;
      const flap = 0.35 + Math.abs(Math.sin(t * 5 + b.ph)) * 0.65;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = rgba(color || b.c, 0.82);
      ctx.beginPath();
      ctx.ellipse(-3.2 * flap, -1, 4.2 * flap, 2.6, -0.35, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(3.2 * flap, -1, 4.2 * flap, 2.6, 0.35, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function water(y0, colors, seed, t) {
    ctx.fillStyle = grad(0, y0, 0, VH, colors);
    ctx.fillRect(0, y0, VW, VH - y0);
    const r = rng(seed);
    ctx.save();
    for (let i = 0; i < 42; i++) {
      const y = y0 + 8 + r() * (VH - y0 - 10);
      const len = 30 + r() * 150;
      const x = ((r() * (VW + 200) + t * (6 + r() * 14)) % (VW + 200)) - 100;
      ctx.globalAlpha = 0.06 + r() * 0.14;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.8 + r() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
    ctx.restore();
  }
  function waterfall(x, y0, w, h, color, t, alpha = 0.65) {
    const g = grad(x - w / 2, y0, x + w / 2, y0, [[0, rgba(color, 0)], [0.5, rgba(color, alpha)], [1, rgba(color, 0)]]);
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, y0, w, h);
    ctx.save();
    for (let i = 0; i < 16; i++) {
      const sx = x - w * 0.36 + (i / 15) * w * 0.72;
      const y = y0 + ((i * 37 + t * (90 + (i % 5) * 22)) % h);
      const len = 18 + (i % 4) * 16;
      ctx.globalAlpha = 0.22 + (i % 3) * 0.12;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx + (i % 2 ? 2 : -2), Math.min(y0 + h, y + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  function dust(x, y, r, alpha, color = '#c9ab82') {
    softEllipse(x, y, r, r * 0.42, color, alpha);
    softEllipse(x + r * 0.4, y - r * 0.12, r * 0.7, r * 0.3, color, alpha * 0.7);
  }
  function lightDust(list, t, color = '#fff0c4') {
    for (const d of list) {
      const x = d.x + Math.sin(t * 0.4 + d.p) * 18;
      const y = ((d.y - t * d.vy) % (VH + 40) + VH + 40) % (VH + 40) - 20;
      ctx.globalAlpha = d.a * (0.6 + 0.4 * Math.sin(t * 1.2 + d.p));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function banner(x, y, h, color, t, phase = 0) {
    const flagH = h * 0.34;
    const flagW = h * 0.62;
    ctx.strokeStyle = 'rgba(92,68,46,.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h);
    ctx.stroke();
    const w1 = Math.sin(t * 2.1 + phase) * flagW * 0.22;
    const w2 = Math.sin(t * 2.1 + phase + 0.8) * flagW * 0.3;
    ctx.fillStyle = rgba(color, 0.72);
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.quadraticCurveTo(x + flagW * 0.5, y - h + w1, x + flagW, y - h + flagH * 0.2 + w2);
    ctx.lineTo(x + flagW * 0.86, y - h + flagH + w2);
    ctx.quadraticCurveTo(x + flagW * 0.42, y - h + flagH * 0.72 + w1, x, y - h + flagH);
    ctx.closePath();
    ctx.fill();
  }
  function soldier(x, y, size, color, alpha, t, i, bannerColor) {
    const bob = Math.sin(t * 5.4 + i * 0.7) * size * 0.2;
    const s = size;
    softEllipse(x - s * 0.2, y + 1, s * 1.9, s * 0.36, '#5c412c', alpha * 0.3);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    // 前倾的披风/躯干（三角剪影，比椭圆更像人）
    ctx.beginPath();
    ctx.moveTo(x - s * 0.55, y - s * 1.25 + bob);
    ctx.lineTo(x + s * 0.18, y - s * 3.35 + bob);
    ctx.lineTo(x + s * 1.08, y - s * 3.1 + bob);
    ctx.lineTo(x + s * 0.92, y - s * 1.15 + bob);
    ctx.closePath();
    ctx.fill();
    // 头
    ctx.beginPath();
    ctx.arc(x + s * 0.78, y - s * 3.72 + bob, s * 0.46, 0, TAU);
    ctx.fill();
    // 腿
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.26);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.1, y - s * 1.2 + bob);
    ctx.lineTo(x - s * 0.78, y);
    ctx.moveTo(x + s * 0.55, y - s * 1.2 + bob);
    ctx.lineTo(x + s * 1.35, y);
    ctx.stroke();
    // 持矛手臂
    ctx.lineWidth = Math.max(0.9, s * 0.2);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.55, y - s * 2.9 + bob);
    ctx.lineTo(x + s * 1.45, y - s * 2.2 + bob);
    ctx.stroke();
    // 长矛
    ctx.globalAlpha = alpha * 0.78;
    ctx.strokeStyle = '#6b5238';
    ctx.lineWidth = Math.max(0.8, s * 0.13);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y - s * 1.3 + bob);
    ctx.lineTo(x + s * 2.85, y - s * 5.15 + bob);
    ctx.stroke();
    ctx.fillStyle = '#e2cba2';
    ctx.beginPath();
    ctx.arc(x + s * 2.85, y - s * 5.15 + bob, Math.max(0.6, s * 0.13), 0, TAU);
    ctx.fill();
    if (bannerColor) banner(x - size * 0.9, y - size * 0.5, size * 5.6, bannerColor, t, i * 1.7);
    ctx.globalAlpha = 1;
  }
  function armyRow(o) {
    const { y, size, color, alpha, t, seed = 1 } = o;
    const span = o.span || VW + 300;
    const speed = o.speed == null ? 12 : o.speed;
    const rr = rng(seed * 131);
    const items = [];
    let x = -160;
    while (x < span + 120) {
      const group = 2 + Math.floor(rr() * 6);
      for (let i = 0; i < group; i++) {
        items.push({
          x: x + i * (size * 3.4 + rr() * 10),
          yj: (rr() - 0.5) * size * 3.4,
          sj: 0.7 + rr() * 0.62,
          ph: rr() * TAU,
        });
      }
      x += group * (size * 3.4 + 4) + 18 + rr() * 78;
    }
    for (const it of items) {
      const px = ((it.x + t * speed + (o.offset || 0)) % span + span) % span - 150;
      const py = y + it.yj + Math.sin(t * 0.9 + px * 0.012 + it.ph) * size * 0.55;
      const sz = size * it.sj;
      const bannerColor = o.bannerEvery && Math.floor(it.x / (size * 3.4)) % o.bannerEvery === 0 ? o.bannerColor : null;
      soldier(px, py, sz, color, alpha, t, it.ph, bannerColor);
    }
  }

  /** 真实 logo 牛马：k 为“一个像素块”的边长；头/尾/四腿按相位动。 */
  function horse(x, y, o = {}) {
    const k = Math.max(5, Math.round(o.k || 17));
    const w = 14 * k;
    const h = 8 * k;
    const dir = o.dir === -1 ? -1 : 1;
    const moving = o.mode === 'walk';
    const t = o.t || 0;
    const ph = o.phase || 0;
    const alpha = o.alpha == null ? 1 : o.alpha;
    if (alpha <= 0.01) return;
    const bob = Math.sin(t * 1.5 + ph) * k * 0.06;
    const gy = y - bob;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (o.aura !== false) {
      softEllipse(x, y - h * 0.48, w * 0.64, h * 0.78, o.auraColor || '#f7dcae', o.auraAlpha == null ? 0.13 : o.auraAlpha);
    }
    softEllipse(x, y + k * 0.28, w * 0.4, Math.max(3, k * 0.5), o.shadowColor || '#6b4c34', o.shadowAlpha == null ? 0.2 : o.shadowAlpha);
    if (!logoReady || !logoBody) {
      ctx.fillStyle = '#9a5b36';
      ctx.fillRect(x - w / 2, gy - h, w, h);
      ctx.restore();
      return;
    }
    const lx = (sx) => (sx / 700 - 0.5) * w;
    const ly = (sy) => -h + (sy / 400) * h;
    const phase = o.travel != null ? (o.travel / (k * 2.6)) * TAU : (moving ? t * 7.4 + ph : 0);
    const gait = o.gait == null ? (moving ? 1 : 0) : Math.max(0, Math.min(1, o.gait));
    ctx.save();
    ctx.translate(Math.round(x), Math.round(gy));
    ctx.scale(dir, 1);
    ctx.imageSmoothingEnabled = false;
    const leg = (sx, off, far) => {
      const sw = moving ? Math.sin(phase + off) * gait : 0;
      const lift = moving ? Math.max(0, Math.cos(phase + off)) * k * 0.5 * gait : 0;
      const step = sw * k * 0.75;
      const hx0 = lx(sx);
      ctx.fillStyle = far ? '#6e4522' : '#8b5a2b';
      ctx.fillRect(hx0 - k / 2 + step * 0.35, -k * 3 - lift * 0.5, k, k * 2);
      ctx.fillStyle = far ? '#5a371b' : '#7a4c26';
      ctx.fillRect(hx0 - k / 2 + step, -k * 1.4 - lift, k, k * 1.4);
      ctx.fillStyle = '#241a12';
      ctx.fillRect(hx0 - k / 2 + step, -k * 0.45 - lift, k, k * 0.45);
    };
    const part = (img, sx0, sy0, sw0, sh0, px0, py0, ang) => {
      const dx = lx(sx0), dy = ly(sy0), dw = (sw0 / 700) * w, dh = (sh0 / 400) * h;
      const ppx = lx(px0), ppy = ly(py0);
      ctx.save();
      ctx.translate(ppx, ppy);
      ctx.rotate(ang);
      ctx.translate(-ppx, -ppy);
      ctx.drawImage(img, sx0, sy0, sw0, sh0, dx, dy, dw, dh);
      ctx.restore();
    };
    // 远侧两腿 → 尾巴 → 身体 → 近侧两腿 → 头
    leg(125, 0, true);
    leg(375, Math.PI, true);
    const idleTail = Math.sin(t * 1.15 + ph) * 0.09 + Math.sin(t * 0.37 + ph * 1.7) * 0.05;
    part(logo, 0, 140, 155, 165, 135, 215, idleTail + Math.sin(phase + 0.7) * 0.04);
    ctx.drawImage(logoBody, 0, 0, 700, 400, -w / 2, -h, w, h);
    leg(225, Math.PI, false);
    leg(475, 0, false);
    const nib = Math.pow(Math.max(0, Math.sin(t * 0.33 + ph)), 6);
    const idleHead = Math.sin(t * 0.55 + ph) * 0.03 + Math.sin(t * 0.21 + ph * 1.7) * 0.02 + nib * 0.06;
    part(logo, 430, 0, 270, 200, 500, 200, idleHead + Math.sin(phase) * 0.012);
    ctx.restore();
    ctx.imageSmoothingEnabled = true;
    ctx.restore();
    if (moving && gait > 0.15) {
      for (let i = 0; i < 4; i++) {
        const dx = (dir > 0 ? -1 : 1) * (w * 0.44 + i * k * 1.3);
        const dy = -Math.abs(Math.sin(t * 7 + i * 1.6)) * k * 0.25;
        dust(x + dx, y - k * 0.1 + dy, k * (0.8 + i * 0.25), (0.16 - i * 0.025) * gait, o.dustColor || '#c8a97f');
      }
    }
  }
  /** 去程 → 停 → 回程 → 停；平滑加减速，行进距离/步态连续，暂停时腿自然收住。 */
  function walk(t, x0, x1, period, phase = 0) {
    const raw = (t + phase) / period;
    const cycles = Math.floor(raw);
    const u = raw - cycles;
    // 走到头停一下再原路走回：两端各半个停顿，整圈首尾都在原位，不瞬移
    const pause = 0.14;
    const leg = (1 - pause) / 2;
    const half = pause / 2;
    const dist = x1 - x0;
    const base = cycles * 2 * dist;
    if (u < leg) {
      const s = u / leg;
      const e = s * s * (3 - 2 * s);
      return { x: x0 + dist * e, dir: 1, moving: true, travel: base + dist * e, gait: Math.min(1, 6 * s * (1 - s)) };
    }
    if (u < leg + half) {
      return { x: x1, dir: 1, moving: false, travel: base + dist, gait: 0 };
    }
    if (u < leg * 2 + half) {
      const s = (u - leg - half) / leg;
      const e = s * s * (3 - 2 * s);
      return { x: x1 - dist * e, dir: -1, moving: true, travel: base + dist + dist * e, gait: Math.min(1, 6 * s * (1 - s)) };
    }
    return { x: x0, dir: -1, moving: false, travel: base + 2 * dist, gait: 0 };
  }

  const A = {
    VW, VH, ctx, TAU,
    clamp, lerp, rng, rgba, mix, grad, vgrad, sky,
    softEllipse, wash, paper,
    ridgePoints, smoothPath, inkRidge, brush, seal,
    sun, moon, stars, shootingStar, rays,
    cloud, cloudSea, mist, birds, pine, pineTree,
    grassBlade, grassField, makeFlowers, drawFlowers, petals, butterflies,
    water, waterfall, dust, lightDust, banner, soldier, armyRow,
    horse, walk,
  };
  window.FIRSTRUN_API = A;

  function buildChooser() {
    if (!chooser) return;
    chooser.innerHTML = '';
    scenes.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.i = String(i);
      b.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span><span>${s.short}</span>`;
      b.addEventListener('click', () => select(i));
      chooser.appendChild(b);
    });
  }
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function syncUI(i) {
    const s = scenes[i];
    setText('sTitle', s.title);
    setText('sSub', s.sub);
    setText('sTags', s.tags || '');
    setText('sIndex', String(i + 1).padStart(2, '0'));
    document.querySelectorAll('#chooser button').forEach((b, k) => {
      b.classList.toggle('is-on', k === i);
      b.setAttribute('aria-pressed', k === i ? 'true' : 'false');
    });
  }
  function select(i) {
    if (!scenes.length) return;
    const next = clamp(i, 0, scenes.length - 1);
    if (next === activeIndex) return;
    const my = ++token;
    activeIndex = next;
    active = scenes[next];
    start = performance.now();
    syncUI(next);
    active.draw(0);
  }
  function setAuto(v) {
    auto = !!v;
    const b = document.getElementById('autoBtn');
    if (b) {
      b.textContent = auto ? '自动轮播 · 开' : '自动轮播 · 关';
      b.classList.toggle('is-on', auto);
      b.setAttribute('aria-pressed', auto ? 'true' : 'false');
    }
  }
  let raf = 0;
  /** 第 120 轮（W10）：窗口不可见不画；系统要求减少动态效果时只画静态首帧，不自动轮播 */
  let jianDong = false;
  try { jianDong = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { /* noop */ }
  if (jianDong) auto = false;
  let lastDrawnToken = -1;
  function loop(now) {
    if (active && !document.hidden) {
      if (jianDong) {
        if (lastDrawnToken !== token) {
          active.draw(0);
          lastDrawnToken = token;
          window.__sceneFrames = (window.__sceneFrames || 0) + 1;
        }
      } else {
        if (auto && now - start > AUTO_MS) {
          select((activeIndex + 1) % scenes.length);
        }
        const t = Math.max(0, (now - start) / 1000);
        active.draw(t);
        window.__sceneFrames = (window.__sceneFrames || 0) + 1;
        const bar = document.getElementById('autoBar');
        if (bar) bar.style.width = auto ? `${Math.min(100, ((now - start) / AUTO_MS) * 100).toFixed(1)}%` : '0%';
      }
    }
    raf = requestAnimationFrame(loop);
  }
  function boot() {
    buildChooser();
    const hash = /^#s(\d+)$/.exec(location.hash || '');
    const first = hash ? clamp(Number(hash[1]) - 1, 0, scenes.length - 1) : 0;
    activeIndex = -1;
    select(first);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select((activeIndex + 1) % scenes.length); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select((activeIndex - 1 + scenes.length) % scenes.length); }
      else if (e.key >= '0' && e.key <= '9') { const n = e.key === '0' ? 10 : Number(e.key); if (n <= scenes.length) select(n - 1); }
      else if (e.key === 'a' || e.key === 'A') { setAuto(!auto); }
      else if (e.key === 'h' || e.key === 'H') { document.getElementById('stage')?.classList.toggle('is-clean'); }
      else if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
      }
    });
    document.getElementById('fsBtn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });
    document.getElementById('autoBtn')?.addEventListener('click', () => setAuto(!auto));
    window.__firstrun = {
      scenes: () => scenes.map((s) => ({ title: s.title, short: s.short, sub: s.sub, tags: s.tags })),
      select,
      toggleAuto: () => setAuto(!auto),
      get auto() { return auto; },
      get current() { return activeIndex; },
    };
  }
  window.__firstrunBoot = boot;
})();
