const fs = require('node:fs');
const base = 'C:/Users/p/.openclaw/workspace/大龙虾互动区/CCArmy/packages/app-shell/src/';
let m = fs.readFileSync(base + 'electron-main.ts', 'utf8');
let h = fs.readFileSync(base + 'renderer/index.html', 'utf8');
let j = fs.readFileSync(base + 'renderer/app.js', 'utf8');
let c = fs.readFileSync(base + 'renderer/app.css', 'utf8');

// 1. messages contain:strict
c = c.replace(
  '.messages {\n  flex: 1; overflow: auto; padding: var(--sp-4);\n  content-visibility: auto;\n  contain-intrinsic-size: auto 500px;\n}',
  '.messages {\n  flex: 1; overflow: auto; padding: var(--sp-4);\n  contain: strict;\n  height: 0;\n}'
);
console.log('messages contain:strict');

// 2. input cleaned
c = c.replace(
  '#input {\n  width: 100%; resize: none; border: 1px solid var(--input-border); border-radius: var(--radius-sm);\n  padding: 10px; font: inherit; outline: none; background: var(--input-bg);\n  contain: layout style;\n  will-change: contents;\n}',
  '#input {\n  width: 100%; resize: none; border: 1px solid var(--input-border); border-radius: var(--radius-sm);\n  padding: 10px; font: inherit; outline: none; background: var(--input-bg);\n}'
);
console.log('input cleaned');

// 3. backgroundThrottling + icon
const oldPrefs = "      sandbox: true,\n    },\n  });\n  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));";
const newPrefs = "      sandbox: true,\n      backgroundThrottling: false,\n      spellcheck: false,\n    },\n    icon: path.join(__dirname, 'renderer', 'icons', 'logo-color.svg'),\n  });\n  void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));";
if (m.includes(oldPrefs)) {
  m = m.replace(oldPrefs, newPrefs);
  console.log('backgroundThrottling added');
}

// 4. tray icon
const oldTray = "    const img = nativeImage.createEmpty();\n    const t = new Tray(img);";
const newTray = "    const img = nativeImage.createFromBuffer(\n      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVQ4y2NgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIwCAAgQAAF/lPurAAAAAElFTkSuQmCC', 'base64')\n    );\n    const t = new Tray(img);";
if (m.includes(oldTray)) {
  m = m.replace(oldTray, newTray);
  console.log('tray icon added');
}

// 5. username inline edit
const oldField = '          <div class="field" style="margin-bottom:10px">\n            <label for="p-name">${t(\'me.username\')}</label>\n            <input id="p-name" name="username" autocomplete="username" spellcheck="false" value="${escapeHtml(p.username)}" title="${escapeHtml(t(\'me.username\'))}"/>\n          </div>';
if (j.includes(oldField)) {
  j = j.replace(oldField, '');
  console.log('username field removed');
}

const oldDisplay = '<div id="p-name-display" class="username-display" title="${escapeHtml(t(\'me.username\'))}">${escapeHtml(p.username)}</div>';
const newDisplay = '<input id="p-name" class="username-input" value="${escapeHtml(p.username)}" title="${escapeHtml(t(\'me.username\'))}"/>';
if (j.includes(oldDisplay)) {
  j = j.replace(oldDisplay, newDisplay);
  console.log('username inline input');
}

// 6. settings two-column
const oldSettingsH1 = '        <h1>${t(\'nav.settings\')}</h1>';
const newSettingsH1 = `        <div class="settings-layout">
        <div class="settings-nav" id="settings-nav">
          <button data-sec="ui" class="on">UI</button>
          <button data-sec="notify">Notify</button>
          <button data-sec="model">Model</button>
          <button data-sec="func">Func</button>
        </div>
        <div class="settings-content" id="settings-content">`;
if (j.includes(oldSettingsH1)) {
  j = j.replace(oldSettingsH1, newSettingsH1);
  console.log('settings layout added');
}

// close the layout divs before the final backtick
const oldAbout = "        </div>`;\n\n      $('btn-about-update')";
const newAbout = "        </div></div></div>`;\n\n      $('btn-about-update')";
if (j.includes(oldAbout)) {
  j = j.replace(oldAbout, newAbout);
  console.log('settings layout closed');
}

// 7. settings nav binding
if (!j.includes('settings-nav')) {
  const localeBind = "      $('sel-locale').onchange = async (e) => {";
  const navBind = `      $('settings-nav')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-sec]');
        if (!btn) return;
        $('settings-nav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      });

      $('sel-locale').onchange = async (e) => {`;
  if (j.includes(localeBind)) {
    j = j.replace(localeBind, navBind);
    console.log('settings nav bound');
  }
}

// 8. CSS
c += `
.username-input {
  font-size: 18px; font-weight: 600;
  border: none; border-bottom: 1px dashed transparent;
  background: transparent; color: var(--ink);
  padding: 2px 0; outline: none; width: 200px;
}
.username-input:hover, .username-input:focus {
  border-bottom-color: var(--muted);
}
`;

fs.writeFileSync(base + 'electron-main.ts', m);
fs.writeFileSync(base + 'renderer/index.html', h);
fs.writeFileSync(base + 'renderer/app.js', j);
fs.writeFileSync(base + 'renderer/app.css', c);
console.log('all done');
