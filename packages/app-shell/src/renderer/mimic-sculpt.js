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
