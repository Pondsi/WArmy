const fs = require('node:fs');
const p = 'C:/Users/<user>/workspace/<repo>/WArmy/packages/app-shell/src/renderer/yingYong.js';
let j = fs.readFileSync(p, 'utf8');

// 1) 在 anNiuYuYin 绑定前关闭 settings 分支与 renderPage
const voiceAnchor = "  $('anNiuYuYin').onclick = async () => {";
if (j.includes(voiceAnchor) && !j.includes('/* renderPage-end */')) {
  j = j.replace(
    voiceAnchor,
    `    }
  }
  /* renderPage-end */

${voiceAnchor}`
  );
  console.log('closed renderPage');
}

// 2) 补回 createGroupFlow / addInstanceFlow / bindResizer
if (!j.includes('function createGroupFlow')) {
  const anchor = '  function bindVerticalResizer(handleId, targetId, dir) {';
  const add = `  function createGroupFlow() {
    uiPrompt(t('list.createGroup'), state.nav === 'internalGroup' ? t('placeholder.groupName') : t('placeholder.groupNameExt')).then(async (ming) => {
      if (!ming) return;
      const type = state.nav === 'internalGroup' ? 'internal' : 'external';
      const id = 'g' + Date.now();
      try {
        await window.warmy.groupCreate({ groupId: id, ming, type, directedMode: false });
      } catch (e) {
        uiAlert(String(e.message || e));
        return;
      }
      state.groups.push({ id, ming, type, members: [] });
      renderList();
    });
  }

  function addInstanceFlow() {
    uiPrompt(t('instances.name'), t('placeholder.agentName') + '-' + (state.instances.length + 1)).then((ming) => {
      if (!ming) return;
      const inst = {
        id: 'inst-' + Date.now(),
        ming,
        status: 'stopped',
        dutyEligible: true,
        model: 'deepseek-chat',
        memoryFile: 'persona/' + ming + '.md',
        persona: t('instances.personaDefault'),
      };
      state.instances.push(inst);
      state.selectedInstance = inst;
      hideMain();
      $('shiLiXiangQing').classList.remove('yinCang');
      renderInstanceDetail();
      renderList();
    });
  }

  function bindResizer(el, cssVar, min, max) {
    if (!el) return;
    let startX = 0;
    let startW = 0;
    let dragging = false;
    el.addEventListener('mousedown', (e) => {
      dragging = true;
      el.classList.add('dragging');
      startX = e.clientX;
      startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || 280;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = Math.min(max, Math.max(min, startW + (e.clientX - startX)));
      document.documentElement.style.setProperty(cssVar, w + 'px');
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
    });
  }

${anchor}`;
  j = j.replace(anchor, add);
  console.log('restored missing functions');
}

fs.writeFileSync(p, j);
