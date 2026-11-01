/* 牛马冲锋 · 十幕概念演示 — 共用像素画/粒子/切换引擎
 * 1280×720 低分辨率渲染，CSS 等比放大保持硬像素；不使用模糊滤镜。
 */
(() => {
  'use strict';

  const VW = 1280;
  const VH = 720;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = VW;
  canvas.height = VH;
  ctx.imageSmoothingEnabled = false;

  const stage = document.getElementById('stage');
  const curtain = document.getElementById('curtain');
  const chooser = document.getElementById('chooser');
  const scenes = (window.CHARGE_SCENES = []);
  let active = null;
  let activeIndex = -1;
  let start = 0;
  let token = 0;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hexRgb(hex) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function mix(hexA, hexB, p) {
    const a = hexRgb(hexA);
    const b = hexRgb(hexB);
    return `rgb(${Math.round(lerp(a[0], b[0], p))},${Math.round(lerp(a[1], b[1], p))},${Math.round(lerp(a[2], b[2], p))})`;
  }
  function colorAt(stops, p) {
    for (let i = 1; i < stops.length; i++) {
      if (p <= stops[i][0]) {
        const a = stops[i - 1];
        const b = stops[i];
        return mix(a[1], b[1], (p - a[0]) / Math.max(0.0001, b[0] - a[0]));
      }
    }
    return stops[stops.length - 1][1];
  }

  function rect(x, y, w, h, color) {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
  }
  function line(x1, y1, x2, y2, color, thick = 1) {
    let x = Math.round(x1);
    let y = Math.round(y1);
    const tx = Math.round(x2);
    const ty = Math.round(y2);
    const dx = Math.abs(tx - x);
    const dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx - dy;
    for (let guard = 0; guard < 2000; guard++) {
      rect(x, y, thick, thick, color);
      if (x === tx && y === ty) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  function sky(stops, band = 4) {
    for (let y = 0; y < VH; y += band) rect(0, y, VW, band + 1, colorAt(stops, y / (VH - 1)));
  }
  function disc(cx, cy, r, color, block = 2, alpha = 1) {
    ctx.globalAlpha = alpha;
    for (let y = -r; y <= r; y += block) {
      const half = Math.sqrt(Math.max(0, r * r - y * y));
      rect(cx - half, cy + y, half * 2, block, color);
    }
    ctx.globalAlpha = 1;
  }
  function ellipseRing(cx, cy, rx, ry, thick, color, alpha = 1, from = 0, to = Math.PI * 2) {
    ctx.globalAlpha = alpha;
    const stepA = 0.008;
    for (let a = from; a < to; a += stepA) {
      rect(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, thick, thick, color);
    }
    ctx.globalAlpha = 1;
  }
  function glow(x, y, r, color, alpha = 0.3) {
    ctx.globalAlpha = alpha;
    const bands = 6;
    for (let i = bands; i >= 1; i--) {
      disc(x, y, (r * i) / bands, color, 4, (alpha / bands) * 0.9);
    }
    ctx.globalAlpha = 1;
  }
  function stars(rand, count, maxY = 460, spreadX = VW) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({ x: rand() * spreadX, y: Math.pow(rand(), 1.35) * maxY, s: rand() < 0.14 ? 3 : rand() < 0.4 ? 2 : 1, p: rand() * Math.PI * 2, a: 0.3 + rand() * 0.7 });
    }
    return out;
  }
  function drawStars(list, t, maxAlpha = 1) {
    for (const s of list) {
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.4 + s.p));
      rect(s.x, s.y, s.s, s.s, rgba('#dbe6ff', Math.min(1, s.a * tw * maxAlpha)));
    }
  }

  function ridge(base, amp, seed, color, o = {}) {
    const step = o.step || 4;
    const freq = o.freq || 0.0045;
    const freq2 = o.freq2 || 0.017;
    const r = rng(seed);
    const p1 = r() * 9;
    const p2 = r() * 9;
    const p3 = r() * 9;
    for (let x = 0; x < VW; x += step) {
      const y = base + Math.sin(x * freq + p1) * amp + Math.sin(x * freq2 + p2) * amp * (o.rough || 0.38) + Math.sin(x * 0.05 + p3) * (o.jag || 0);
      rect(x, y, step, VH - y, color);
    }
  }
  function ridgeEdge(base, amp, seed, color, o = {}) {
    const step = o.step || 4;
    const freq = o.freq || 0.0045;
    const freq2 = o.freq2 || 0.017;
    const r = rng(seed);
    const p1 = r() * 9;
    const p2 = r() * 9;
    for (let x = 0; x < VW; x += step) {
      const y = base + Math.sin(x * freq + p1) * amp + Math.sin(x * freq2 + p2) * amp * 0.38;
      rect(x, y, step, o.thick || 2, color);
    }
  }
  function bandWave(base, amp, freq, color, thick, phase = 0) {
    for (let x = 0; x < VW; x += 4) {
      const y = base + Math.sin(x * freq + phase) * amp;
      rect(x, y, 4, thick, color);
    }
  }

  /** 牛马像素剪影：厚躯干、弯角、鬃毛、长尾、蹄；mode = gallop | stand | leap */
  function beast(x, y, s, o = {}) {
    const dir = o.dir === -1 ? -1 : 1;
    const mode = o.mode || 'gallop';
    const t = o.t || 0;
    const color = o.color || '#04060a';
    const rim = o.rim || null;
    const p = ((Math.floor(t * (o.fps || 6.2)) % 4) + 4) % 4;
    const gallop = mode === 'gallop';
    const leap = mode === 'leap';
    const bob = gallop ? [0, 1, 0, 1][p] : 0;
    const bx = Math.round(x);
    const by = Math.round(y);
    const S = s;
    const rectU = (ux, uy, uw, uh, c) => {
      const gx = dir > 0 ? bx + ux * S : bx - (ux + uw) * S;
      rect(gx, by - (uy + uh) * S + bob * S, uw * S, uh * S, c);
    };

    // 长尾（向后再向下飘）
    const tail = Math.sin(t * 3.1) * 1.1;
    rectU(4, 12, 3, 3, color);
    rectU(2 + tail, 14, 2, 3, color);
    rectU(0 + tail, 16, 2, 3, color);
    rectU(0 + tail, 19, 1, 2, color);

    // 躯干：厚背、圆臀、宽胸
    rectU(4, 8, 6, 7, color);
    rectU(8, 7, 12, 8, color);
    rectU(18, 8, 5, 7, color);
    // 腹线做一点收
    rectU(6, 8, 14, 1, color);

    // 颈（斜向上）+ 头 + 口鼻
    rectU(22, 12, 4, 5, color);
    rectU(24, 15, 3, 4, color);
    rectU(24, 17, 6, 4, color);
    rectU(30, 17, 3, 3, color);
    rectU(32, 17, 1, 2, color);
    // 耳朵
    rectU(24, 21, 1, 2, color);
    rectU(27, 21, 1, 2, color);
    // 弯角（左右各一，向后上弯）
    rectU(28, 21, 2, 3, color);
    rectU(30, 22, 1, 2, color);
    rectU(25, 21, 1, 3, color);
    rectU(23, 22, 1, 2, color);
    // 鬃毛
    rectU(21, 16, 2, 5, rim || color);
    rectU(22, 20, 1, 2, rim || color);

    // 腿：上粗下细 + 蹄
    if (leap) {
      rectU(7, 4, 3, 5, color);
      rectU(5, 2, 4, 2, color);
      rectU(10, 3, 3, 4, color);
      rectU(9, 0, 3, 2, color);
      rectU(18, 5, 3, 4, color);
      rectU(17, 2, 4, 2, color);
      rectU(21, 3, 3, 3, color);
      rectU(23, 1, 3, 2, color);
    } else if (gallop) {
      const a = [[2, -1], [0, 0], [-2, 1], [0, 0]][p];
      const b = [[-2, 1], [0, 0], [2, -1], [0, 0]][p];
      rectU(6 + a[0], 4, 3, 5, color);
      rectU(6 + a[0] + a[1], 0, 2, 4, color);
      rectU(10 + b[0], 4, 3, 5, color);
      rectU(10 + b[0] + b[1], 0, 2, 4, color);
      rectU(17 + b[0], 4, 3, 5, color);
      rectU(17 + b[0] + b[1], 0, 2, 4, color);
      rectU(21 + a[0], 4, 3, 5, color);
      rectU(21 + a[0] + a[1], 0, 2, 4, color);
      rectU(7 + a[0], 0, 4, 1, color);
      rectU(11 + b[0], 0, 4, 1, color);
      rectU(18 + b[0], 0, 4, 1, color);
      rectU(22 + a[0], 0, 4, 1, color);
    } else {
      rectU(7, 0, 3, 9, color);
      rectU(10, 0, 3, 9, color);
      rectU(17, 0, 3, 9, color);
      rectU(20, 0, 3, 9, color);
      rectU(7, 0, 4, 1, color);
      rectU(10, 0, 4, 1, color);
      rectU(17, 0, 4, 1, color);
      rectU(20, 0, 4, 1, color);
    }

    // 轮廓光只放在背、颈、头、尾上；身体内部用一层中间调勾出体积，
    // 避免整匹牛马变成“黑色方块的白色描边”。
    if (rim) {
      const shade = mix(color, rim, 0.18);
      rectU(8, 14, 11, 1, shade);
      rectU(18, 14, 5, 1, shade);
      rectU(22, 16, 5, 1, shade);
      rectU(8, 15, 10, 1, rim);
      rectU(18, 15, 4, 1, rim);
      rectU(22, 17, 4, 1, rim);
      rectU(24, 21, 5, 1, rim);
      rectU(28, 24, 2, 1, rim);
      rectU(0 + tail, 19, 1, 1, rim);
      rectU(6, 8, 3, 1, shade);
      rectU(18, 8, 3, 1, shade);
    }
  }

  function flag(x, y, h, color, t, o = {}) {
    const pole = o.pole || color;
    line(x, y, x, y - h, pole, o.thick || 2);
    const w = o.w || 18;
    for (let i = 0; i < w; i += 2) {
      const wave = Math.sin(t * 2.6 + i * 0.35) * 2.5;
      rect(x + i, y - h + 2 + wave, 2, 7, color);
    }
  }

  function planet(cx, cy, r, base, shade, lit, ring) {
    if (ring) {
      ellipseRing(cx, cy, r * 1.72, r * 0.44, 3, ring, 0.55, Math.PI, Math.PI * 2);
    }
    for (let y = -r; y <= r; y += 2) {
      const half = Math.sqrt(Math.max(0, r * r - y * y));
      const t = (y + r) / (2 * r);
      rect(cx - half, cy + y, half * 2, 2, base);
      rect(cx - half, cy + y, half * 0.9, 2, shade);
      if (Math.abs(y) < r * 0.72) {
        rect(cx - half * 0.98, cy + y, half * 1.96, 1, rgba(base, 0.9));
      }
      if (t > 0.18 && t < 0.82 && Math.sin(y * 0.11) > 0.55) {
        rect(cx - half * 0.9, cy + y, half * 1.8, 1, rgba(shade, 0.55));
      }
    }
    disc(cx - r * 0.28, cy - r * 0.34, r * 0.12, lit, 2, 0.5);
    if (ring) {
      ellipseRing(cx, cy, r * 1.72, r * 0.44, 3, ring, 0.85, 0, Math.PI);
    }
  }

  function galaxy(cx, cy, R, t, seed, colors) {
    const r = rng(seed);
    const dots = [];
    for (let i = 0; i < 620; i++) {
      const arm = i % 2;
      const rr = Math.pow(i / 620, 0.62) * R;
      const ang = arm * Math.PI + rr * 0.028 + i * 0.618 + t * 0.025;
      dots.push({
        x: cx + Math.cos(ang) * rr * 1.5 + (r() - 0.5) * 10,
        y: cy + Math.sin(ang) * rr * 0.55 + (r() - 0.5) * 10,
        s: rr < R * 0.18 ? 2 : 1,
        c: colors[Math.min(colors.length - 1, Math.floor((rr / R) * colors.length))],
        a: 0.35 + r() * 0.6,
      });
    }
    for (const d of dots) rect(d.x, d.y, d.s, d.s, rgba(d.c, d.a));
    disc(cx, cy, R * 0.12, '#fff6dc', 2, 0.9);
    disc(cx, cy, R * 0.26, colors[0], 4, 0.18);
  }

  function aurora(base, t, colorA, colorB) {
    for (let x = 0; x < VW; x += 4) {
      const top = base + Math.sin(x * 0.006 + t * 0.25) * 20 + Math.sin(x * 0.019 - t * 0.4) * 8;
      const h = 150 + Math.sin(x * 0.008 + t * 0.42) * 52;
      const seg = 6;
      for (let k = 0; k < seg; k++) {
        const y = top + (h * k) / seg;
        const a = 0.02 + (k / seg) * 0.085;
        rect(x, y, 4, h / seg + 1, rgba(k < 2 ? colorB : colorA, a));
      }
      const hem = top + h;
      rect(x, hem - 2, 4, 2, rgba(colorA, 0.46));
      rect(x, hem + Math.sin(x * 0.03 + t) * 6, 4, 1, rgba(colorB, 0.2));
    }
  }

  function rays(x, y, len, spread, color, alpha) {
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = alpha * (0.5 + i * 0.16);
      ctx.fillStyle = color;
      const w0 = spread * (0.12 + i * 0.05);
      const x0 = x + i * spread * 0.26;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + w0, y);
      ctx.lineTo(x0 + w0 + len * 0.35, y + len);
      ctx.lineTo(x0 + len * 0.12, y + len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function cloudSea(base, t, seed, color, edge) {
    const r = rng(seed);
    const p = [r() * 9, r() * 9, r() * 9];
    for (let layer = 0; layer < 4; layer++) {
      const y0 = base + layer * 26;
      const amp = 8 + layer * 4;
      const off = Math.sin(t * 0.08 + layer) * 12;
      for (let x = -40; x < VW + 40; x += 4) {
        const y = y0 + Math.sin((x + off) * 0.006 + p[0] + layer) * amp + Math.sin((x + off) * 0.02 + p[1]) * amp * 0.3;
        rect(x, y, 4, 26, layer === 0 ? edge : color);
        rect(x, y, 4, 2, rgba('#ffffff', 0.1 + layer * 0.03));
      }
    }
  }

  function birds(list, t, color) {
    for (const b of list) {
      const flap = Math.sin(t * 3 + b.p) > 0 ? 1 : -1;
      const x = b.x + Math.sin(t * 0.12 + b.p) * b.drift;
      const y = b.y + Math.cos(t * 0.1 + b.p) * 4;
      rect(x - 3, y - flap, 3, 1, color);
      rect(x, y, 1, 1, color);
      rect(x + 1, y - flap, 3, 1, color);
    }
  }

  // ── 公共 API ────────────────────────────────────────────────────────────
  const A = {
    VW, VH, ctx, rect, line, sky, disc, ellipseRing, glow, stars, drawStars, ridge, ridgeEdge,
    bandWave, beast, flag, planet, galaxy, aurora, rays, cloudSea, birds, rgba, mix, colorAt,
    rng, clamp, lerp,
  };
  window.CHARGE_API = A;

  // ── UI / 切换 ───────────────────────────────────────────────────────────
  const SHORT = [];
  function buildChooser() {
    chooser.innerHTML = '';
    scenes.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.i = String(i);
      const num = String(i + 1).padStart(2, '0');
      b.innerHTML = `<span class="num">${num}</span><span>${s.short || s.title}</span>`;
      b.addEventListener('click', () => select(i));
      chooser.appendChild(b);
      SHORT[i] = s.short || s.title;
    });
  }

  function syncUI(i) {
    const s = scenes[i];
    document.getElementById('sTitle').textContent = s.title;
    document.getElementById('sSub').textContent = s.sub;
    document.getElementById('sIndex').textContent = String(i + 1).padStart(2, '0');
    document.querySelectorAll('#chooser button').forEach((b, k) => {
      b.classList.toggle('is-on', k === i);
      b.setAttribute('aria-pressed', k === i ? 'true' : 'false');
    });
    try { history.replaceState(null, '', '#s' + (i + 1)); } catch { /* file:// 某些环境不允许 */ }
  }

  function select(i) {
    if (!scenes.length) return;
    const next = clamp(i, 0, scenes.length - 1);
    if (next === activeIndex) return;
    const my = ++token;
    curtain.classList.add('is-on');
    setTimeout(() => {
      if (my !== token) return;
      activeIndex = next;
      active = scenes[next];
      start = performance.now();
      syncUI(next);
      if (typeof active.setup === 'function') active.setup();
      draw(0);
      curtain.classList.remove('is-on');
    }, 130);
  }

  function draw(t) {
    if (!active) return;
    ctx.globalAlpha = 1;
    active.draw(t);
  }

  let raf = 0;
  function loop(now) {
    if (active) {
      // RAF 的 now 可能早于 select() 里刚取的 start 几毫秒 ⇒ 夹到 0，避免负帧号。
      const t = Math.max(0, Math.min(600, (now - start) / 1000));
      draw(t);
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
      else if (e.key >= '0' && e.key <= '9') {
        const n = e.key === '0' ? 10 : Number(e.key);
        if (n <= scenes.length) select(n - 1);
      } else if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
      }
    });
    document.getElementById('fsBtn').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });

    window.__charge = {
      scenes: () => scenes.map((s) => ({ title: s.title, short: s.short, sub: s.sub })),
      select,
      get current() { return activeIndex; },
      get elapsed() { return (performance.now() - start) / 1000; },
    };
  }

  window.__chargeBoot = boot;
})();
