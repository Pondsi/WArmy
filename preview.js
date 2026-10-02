// 预览页交互：与产品同款的「进行中动态小字 / 智能模式 / 思考级别 / 文字确定 / 卡片自动补回」
(function () {
  // ── 进行中动态小字：打字三点 + 文案轮换 + 已用秒数 ──
  var PHASES = ['正在思考…', '正在干活…', '正在训小弟…', '扣鼻子中…', '喝口茶…', '泡咖啡中…', '翻工具箱…', '抓耳挠腮…'];
  var busyTimer = null, busyStart = 0, busyIdx = 1;
  var busyLine = document.getElementById('busyLine');
  var busyText = document.getElementById('busyText');
  var busySec = document.getElementById('busySec');

  function paintBusy() {
    var s = Math.max(0, Math.floor((Date.now() - busyStart) / 1000));
    var t;
    if (s < 2) t = PHASES[0];
    else if (s >= 20) t = '还在干，没卡住…';
    else { busyIdx = (busyIdx % (PHASES.length - 1)) + 1; t = PHASES[busyIdx]; }
    busyText.textContent = t;
    busySec.textContent = s + 's';
  }
  function startBusy() {
    stopBusy();
    busyStart = Date.now();
    busyIdx = 1;
    busyLine.className = 'busy';
    paintBusy();
    busyTimer = setInterval(paintBusy, 1000);
  }
  function stopBusy(done) {
    if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }
    if (done === true) {
      busyLine.className = 'busy done';
      busyText.textContent = '干完了';
      busySec.textContent = '';
      setTimeout(function () { busyLine.className = 'busy'; busyText.textContent = '正在思考…'; busySec.textContent = '0s'; }, 1600);
    } else if (done === false) {
      busyLine.className = 'busy fail';
      busyText.textContent = '出了点问题…';
      busySec.textContent = '';
    }
  }
  document.getElementById('btnBusy').onclick = function () {
    startBusy();
    setTimeout(function () { stopBusy(true); }, 3200); // 3 秒后"回包"
  };
  document.getElementById('btnReset').onclick = function () { stopBusy(false); busyLine.className = 'busy'; busyText.textContent = '正在思考…'; busySec.textContent = '0s'; };

  // ── 调用链：智能模式 / 默认模型标签 ──
  var CHAIN = ['DeepSeek · deepseek-flash', 'DeepSeek · deepseek-v4-pro', 'MiMo · mimo-v2.5-pro'];
  var disabled = { 'DeepSeek · deepseek-v4-pro': true };
  var chainBox = document.getElementById('chain');
  var smart = document.getElementById('smart');

  function firstEnabled() {
    for (var i = 0; i < CHAIN.length; i++) if (!disabled[CHAIN[i]]) return CHAIN[i];
    return '';
  }
  function renderChain() {
    if (smart.checked) {
      chainBox.innerHTML = '<div class="dim">已开启智能模式：系统按任务自动安排调用链，这里不再展开各个模型。</div>';
      return;
    }
    var mo = firstEnabled();
    chainBox.innerHTML = CHAIN.map(function (m, i) {
      var on = !disabled[m];
      return '<div class="chainRow' + (on ? '' : ' disabled') + '">' +
        '<span class="name">' + m + (m === mo ? ' <span class="badge">默认模型</span>' : '') + '</span>' +
        '<button data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>上移</button>' +
        '<button data-down="' + i + '"' + (i === CHAIN.length - 1 ? ' disabled' : '') + '>下移</button>' +
        '<button data-tog="' + i + '">' + (on ? '禁用' : '启用') + '</button>' +
        '</div>';
    }).join('');
    chainBox.querySelectorAll('[data-up]').forEach(function (b) {
      b.onclick = function () { var i = +b.dataset.up; var t = CHAIN[i - 1]; CHAIN[i - 1] = CHAIN[i]; CHAIN[i] = t; renderChain(); };
    });
    chainBox.querySelectorAll('[data-down]').forEach(function (b) {
      b.onclick = function () { var i = +b.dataset.down; var t = CHAIN[i + 1]; CHAIN[i + 1] = CHAIN[i]; CHAIN[i] = t; renderChain(); };
    });
    chainBox.querySelectorAll('[data-tog]').forEach(function (b) {
      b.onclick = function () { var m = CHAIN[+b.dataset.tog]; disabled[m] = !disabled[m]; renderChain(); };
    });
  }
  smart.onchange = renderChain;
  renderChain();

  // ── 思考级别滑块 ──
  var THINK = ['自动', '关闭', '低', '中', '高'];
  var think = document.getElementById('think');
  var thinkLabel = document.getElementById('thinkLabel');
  think.oninput = function () { thinkLabel.textContent = THINK[+think.value]; };

  // ── 文字：确定才生效 ──
  var fw = document.getElementById('fw'), fs = document.getElementById('fs');
  var fwLabel = document.getElementById('fwLabel'), fsLabel = document.getElementById('fsLabel');
  var fontSel = document.getElementById('font'), preview = document.getElementById('fontPreview');
  var FW = { 100: '极细', 200: '特细', 300: '细', 400: '正常', 500: '中等', 600: '半粗', 700: '粗', 800: '特粗', 900: '黑体' };
  function labels() { fwLabel.textContent = FW[+fw.value] || fw.value; fsLabel.textContent = fs.value + '%'; }
  fw.oninput = labels; fs.oninput = labels; labels();
  document.getElementById('fontOk').onclick = function () {
    preview.style.fontFamily = fontSel.value ? ('"' + fontSel.value + '", sans-serif') : '';
    preview.style.fontWeight = fw.value;
    preview.style.fontSize = (14 * (+fs.value) / 100) + 'px';
    document.getElementById('fontTip').textContent = '已应用 ✓';
    setTimeout(function () { document.getElementById('fontTip').textContent = '改完点「确定」后生效。'; }, 1600);
  };

  // ── 前景色随背景（黑白灰分级）──
  function inkOf(bg) {
    var n = parseInt(String(bg).replace('#', ''), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (y > 0.62) return '#1a1a1a';
    if (y < 0.32) return '#f2f2f2';
    return y > 0.47 ? '#2b2b2b' : '#e8e8e8';
  }
  var accent = document.getElementById('accent');
  function applyAccent() {
    var v = accent.value;
    document.documentElement.style.setProperty('--accent', v);
    document.documentElement.style.setProperty('--accent-ink', inkOf(v));
    document.documentElement.style.setProperty('--me-bubble', v);
    document.documentElement.style.setProperty('--me-bubble-ink', inkOf(v));
  }
  accent.oninput = applyAccent;
  applyAccent();

  // ── 右栏卡片自动补回演示 ──
  var demo = document.getElementById('panelDemo');
  document.getElementById('btnPanel').onclick = function () {
    demo.innerHTML =
      '<div class="panelCard"><div class="panelTitle">定时任务</div>' +
      '<div class="dim">每天 09:00 · 下次 10月2日 09:00<br/>每天早上给我一份日程提醒</div>' +
      '<div class="dim" style="margin-top:4px">（即使刚才被关掉，到点也会自动补回这张卡片）</div></div>';
  };
})();
