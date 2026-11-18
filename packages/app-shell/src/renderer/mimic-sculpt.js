/* R232：程序内提示词建模。预览只用宿主校验生成的 SVG；框选保持稳定部位 ID。 */
(() => {
  'use strict';
  window.__kaiMimicHuiTu = async (labels) => {
    const existing = document.getElementById('mimicHuiTu');
    if (existing) { existing.focus(); return; }
    const dlg = document.createElement('dialog'); dlg.id = 'mimicHuiTu'; dlg.className = 'mimicHuiTu';
    const header = document.createElement('h2'); header.textContent = labels.title;
    const stage = document.createElement('div'); stage.className = 'mimicHuiTuStage';
    const picture = document.createElement('div'); picture.className = 'mimicHuiTuSvg'; stage.appendChild(picture);
    const box = document.createElement('div'); box.className = 'mimicHuiTuBox'; box.hidden = true; stage.appendChild(box);
    const selectionText = document.createElement('div'); selectionText.className = 'jingYin';
    const prompt = document.createElement('textarea'); prompt.id = 'mimicHuiTuPrompt'; prompt.rows = 3; prompt.maxLength = 2000; prompt.placeholder = labels.prompt;
    const status = document.createElement('div'); status.setAttribute('role', 'status'); status.className = 'jingYin';
    const actions = document.createElement('div'); actions.className = 'mimicHuiTuActions';
    const button = (text, action) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'anNiuXiao'; b.textContent = text; b.onclick = action; actions.appendChild(b); return b; };
    let scene = { version: 1, parts: [] }, hash = '', selected = [], busy = false, seq = 0;
    const history = [];
    const invoke = (p) => window.warmy.mimicHuiTu(p);
    /** R260 项10：3D 形态判定（读设置里的形态单选）；3D 走 LLM→SVG→栅格化→TripoSR→glb。 */
    const shi3D = () => { try { return String(document.querySelector('input[name="mimicXingTai"]:checked')?.value || '2d') === '3d'; } catch { return false; } };
    const svgToPng = (svgEl) => new Promise((resolve, reject) => {
      try {
        const xml = new XMLSerializer().serializeToString(svgEl);
        const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
        const img = new Image();
        img.onload = () => {
          try {
            const c = document.createElement('canvas'); c.width = 512; c.height = 512;
            const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 512);
            g.drawImage(img, 0, 0, 512, 512); URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/png'));
          } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg-raster-failed')); };
        img.src = url;
      } catch (e) { reject(e); }
    });
    const update = (r) => {
      if (!r?.ok) throw new Error(r?.error || 'generation-failed');
      scene = r.scene; hash = r.hash; picture.innerHTML = r.svg; selected = []; selectionText.textContent = '';
      save.disabled = !scene.parts.length || busy;
    };
    const mark = () => {
      picture.querySelectorAll('[data-part]').forEach((g) => g.classList.toggle('xuan', selected.includes(g.dataset.part)));
      const names = scene.parts.filter((p) => selected.includes(p.id)).map((p) => p.name);
      selectionText.textContent = labels.selection + ': ' + names.join(', ');
      if (names.length) { prompt.setRangeText('【' + names.join(', ') + '】', prompt.selectionStart, prompt.selectionEnd, 'end'); prompt.focus(); }
    };
    const generate = button(labels.generate, async () => {
      if (busy || !prompt.value.trim()) return;
      busy = true; generate.disabled = true; save.disabled = true;
      const ticket = ++seq, before = structuredClone(scene), baseHash = hash;
      status.textContent = '…';
      try {
        const r = await invoke({ action: 'generate', prompt: prompt.value, scene: before, selection: [...selected] });
        if (!dlg.open || ticket !== seq || hash !== baseHash) return;
        if (!r?.ok) throw new Error(r?.error || 'generation-failed');
        history.push(before); if (history.length > 16) history.shift();
        update(r); status.textContent = '';
        /** R260 项10：3D 形态——把刚生成的 SVG 栅格化送 TripoSR 子进程出 glb（环境未就绪如实报错）。 */
        if (shi3D()) {
          status.textContent = '3D …';
          const svgEl = picture.querySelector('svg');
          if (!svgEl) throw new Error('no-svg');
          const png = await svgToPng(svgEl);
          const g = await window.warmy.sanDShengCheng?.({ png, name: 'sculpt-' + String(hash || '').slice(0, 12) });
          if (!dlg.open || ticket !== seq) return;
          if (!g?.ok) throw new Error(g?.hint || g?.error || '3d-generation-failed');
          status.textContent = labels.saved + ' (3D)';
        }
      } catch (e) { if (ticket === seq) status.textContent = e.message; }
      finally { if (ticket === seq) { busy = false; generate.disabled = false; save.disabled = !scene.parts.length; } }
    });
    const save = button(labels.save, async () => {
      if (busy) return;
      busy = true; save.disabled = true; generate.disabled = true;
      try { const r = await invoke({ action: 'save', scene }); if (!r?.ok) throw new Error(r?.error || 'save-failed'); status.textContent = labels.saved; }
      catch (e) { status.textContent = e.message; }
      finally { busy = false; generate.disabled = false; save.disabled = !scene.parts.length; }
    });
    button(labels.undo, async () => {
      if (busy || !history.length) return;
      try { update(await invoke({ action: 'preview', scene: history[history.length - 1] })); history.pop(); }
      catch (e) { status.textContent = e.message; }
    });
    button(labels.clear, () => { selected = []; mark(); });
    button(labels.cancel, () => dlg.close());
    dlg.append(header, stage, selectionText, prompt, status, actions); document.body.appendChild(dlg); dlg.showModal();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) { const r = dlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close(); } });
    dlg.addEventListener('close', () => { seq++; void invoke({ action: 'cancel' }); dlg.remove(); });
    let start = null;
    stage.onpointerdown = (e) => {
      if (busy || e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, part: e.target.closest('[data-part]')?.dataset.part };
      stage.setPointerCapture(e.pointerId);
    };
    stage.onpointermove = (e) => {
      if (!start) return;
      const r = stage.getBoundingClientRect(); box.hidden = false;
      Object.assign(box.style, { left: Math.min(start.x, e.clientX) - r.left + 'px', top: Math.min(start.y, e.clientY) - r.top + 'px', width: Math.abs(e.clientX - start.x) + 'px', height: Math.abs(e.clientY - start.y) + 'px' });
    };
    stage.onpointerup = (e) => {
      if (!start) return;
      const x0 = Math.min(start.x, e.clientX), x1 = Math.max(start.x, e.clientX), y0 = Math.min(start.y, e.clientY), y1 = Math.max(start.y, e.clientY);
      selected = x1 - x0 < 4 && y1 - y0 < 4 ? (start.part ? [start.part] : []) : [...picture.querySelectorAll('[data-part]')].filter((g) => {
        const r = g.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right >= x0 && r.left <= x1 && r.bottom >= y0 && r.top <= y1;
      }).map((g) => g.dataset.part);
      start = null; box.hidden = true; stage.releasePointerCapture(e.pointerId); mark();
    };
    stage.onpointercancel = () => { start = null; box.hidden = true; };
    try { update(await invoke({ action: 'read' })); } catch (e) { status.textContent = e.message; }
    prompt.focus();
  };
})();
