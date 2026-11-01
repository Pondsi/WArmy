/* nm 文件查看器 —— 渲染层（纯 JS，无框架、无 CDN）。
 *
 * 三层职责分清楚，免得又变成"看起来在跑其实没跑"：
 *   1) 取内容：一律问主进程（`window.warmy.nmDu`）—— 读文件、认格式、抽正文都在主进程，
 *      页面自己不碰文件系统（独立窗口同样沙箱化，没有 node 集成）。
 *   2) 显示：可编辑文本用 textarea（编辑最可靠）；SVG/HTML/Markdown 左源码右效果；
 *      docx/pdf 纸张式预览、xlsx 表格、pptx 幻灯片；图片/音频/视频用自定义控件。
 *   3) 查找：可编辑文本用"高亮层 + 透明文字"叠在 textarea 底下（几何完全对齐），
 *      只读文档直接给 <mark>；两者都能上一个/下一个，并滚到当前位置。
 *
 * 主题：?theme= / ?accent= 由主进程带进来；没有 theme 参数时跟随系统 prefers-color-scheme，
 * 再取不到才用 CSS 默认值。主界面改主题不会自动刷新本窗口（重开才生效，产品要求）。
 */
(() => {
  'use strict';

  const el = (id) => document.getElementById(id);
  /** 时间显示统一走 time-tz.js（记录是 epoch，显示按设置里的时区） */
  const TZ = window.__warmyTime;
  const canShu = new URLSearchParams(location.search);
  const chuangKouId = Number(canShu.get('id') || '0');
  /** 聊天框临时编辑模式：内容实时回传聊天框，不落盘、不提示保存 */
  const chatEditor = canShu.get('chatEditor') === '1';

  /* ── 主题 / 强调色 / 字体颜色 ─────────────────────────────
   * 参数优先；缺 theme 时用系统深浅色；再取不到用 CSS 默认值。
   * 这里**故意不监听** prefers-color-scheme 变化：主界面改主题时 nm 不自动刷新，
   * 用户重开窗口才拿到新参数（避免两个窗口主题各变各的）。
   */
  const zhuTiCan = String(canShu.get('theme') || '').toLowerCase();
  const xiTongShen = (() => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } })();
  const zhuTi = zhuTiCan === 'dark' || zhuTiCan === 'light' ? zhuTiCan : (xiTongShen ? 'dark' : 'light');
  document.documentElement.dataset.theme = zhuTi;
  const qiangDiao = String(canShu.get('accent') || '');
  if (/^#[0-9a-fA-F]{3,8}$/.test(qiangDiao)) document.documentElement.style.setProperty('--accent', qiangDiao);
  const ziSe = String(canShu.get('ink') || canShu.get('fg') || '');
  if (/^#[0-9a-fA-F]{3,8}$/.test(ziSe)) document.documentElement.style.setProperty('--ink', ziSe);

  const zt = {
    luJing: '',
    ming: '',
    leiXing: 'text',
    keBianJi: false,
    huanHang: 'lf',
    zang: false,
    chatEditor,
    kuai: [],
    ziJie: 0,
    huanHangKai: true,
    souCi: '',
    souPi: [],
    souWei: 0,
    ziDong: true,
    suoFang: 1,
    suoFangPanX: 0,     // 图片 transform:translate 的平移量（只读查看用）
    suoFangPanY: 0,
    fenLan: null,       // null | 'svg' | 'html' | 'md'
    fenLanBi: 0.5,
    quanPingEl: null,
    tiHuanKai: false,   // 替换输入是否展开（由结果数按钮切换）
    /**
     * 二进制虚拟十六进制视图（项 32/33）：
     * 只把**可见行**画出来；字节按 256KB 块向主进程取；编辑只记增量字节。
     */
    shiLiu: null,
    souDingShi: null,
    /* ── 第 78 轮项 18 ── */
    yaSuoBao: null,       // { luJing, ming, xinXi, zhanKai:Set, haiZi:Map, mima:[] }
    tiaoMu: null,         // 当前包内条目
    jieYaMuLu: '',
    fenLanZuoShou: false,
    fenLanYouShou: false,
    /* 第 81 轮项 12：网站模式（标签页可指向网址或本地网页；每个标签页自己的分栏 0..3） */
    wangYe: {
      ka: [], dang: -1, kai: false, dingShi: null,
      /** 第 122 轮：链接在新标签页打开（开关，默认关；主进程按这个值拦 will-navigate） */
      xinKai: false,
      ziDong: false,      // 自动保存默认**不勾**（与文件模式默认勾不同）
      souCi: '', souPi: [], souWei: 0,
      suoFang: 1, wenDai: null, jieGuo: '', huanHangKai: true,
      /** 第 116 轮：远程页查找条（与本地源码搜索分开；远程页只能走 findInPage） */
      wangSou: { kai: false, dingShi: null, ci: '' },
      /** 上次同步给主进程的视图 key（url+可见+边界），避免每个状态事件都重复 invoke */
      shiTuKey: '',
      /** 上次画进源码框的标签/源码版本；远程源码异步到达时据此刷新 */
      yuanKey: '',
      /** 分栏拖动中：临时隐藏 WebContentsView，否则原生视图会吃掉鼠标移动事件 */
      tuoFenGe: false,
      yeKuangHide: false,
    },
    mimaDai: null,
    wangYeFanHui: null,
  };
  let liShi = [];
  let liShiWei = -1;
  const SHI_LIU_KUAI = 256 * 1024;      // 每块字节数（与主进程上限一致）
  const SHI_LIU_HANG_GAO = 22;          // 与 CSS .shLiuHang 高度一致
  const SHI_LIU_MEI_HANG = 16;          // 每行 16 字节
  const SHI_LIU_YU_RE = 6;              // 上下各多渲染 6 行，滚动时不露白

  /* ── 小工具 ───────────────────────────────────────────── */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /** 压缩包请求信封（与 nm-viewer-win.ts 的 nmz1: 保持一致；密码只走内存/IPC） */
  function zipQing(q) {
    const bytes = new TextEncoder().encode(JSON.stringify(q));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return 'nmz1:' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function nmDuZip(q) {
    try {
      return await window.warmy.nmDu({ path: zipQing(q) });
    } catch (e) {
      return { ok: false, cuo: String((e && e.message) || e) };
    }
  }
  function ziJieWen(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / 1048576).toFixed(1) + ' MB';
    return (v / 1073741824).toFixed(2) + ' GB';
  }
  function zhuangTaiWen(t) { el('zhuangTai').textContent = String(t || ''); }
  /** 每帧最多做一次：滚动/滚动同步都走它，避免每个 scroll 事件都强制布局（项 33） */
  function anPaiZhen(fn) {
    if (typeof requestAnimationFrame !== 'function') { fn(); return; }
    let ding = false;
    return () => {
      if (ding) return;
      ding = true;
      requestAnimationFrame(() => { ding = false; fn(); });
    };
  }
  function shiLiuWen(n) {
    return (Number(n) || 0).toString(16).toUpperCase().padStart(8, '0');
  }
  function ziJieWenASCII(b) {
    return b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
  }
  function tiShiWen(t) {
    const he = el('tiShiLie');
    if (!t) { he.hidden = true; he.textContent = ''; return; }
    he.hidden = false;
    he.textContent = String(t);
  }
  function gengXinBiaoTi() {
    let ming = zt.ming || '未命名';
    let lu = zt.luJing || '';
    if (zt.yaSuoBao && zt.tiaoMu) {
      ming = (zt.yaSuoBao.ming || '压缩包') + ' › ' + zt.tiaoMu.ming;
      lu = zt.yaSuoBao.luJing + ' › ' + zt.tiaoMu.luJing;
    } else if (zt.wangYe.kai) {
      const ka = wangYeDangQian();
      ming = (ka && (ka.title || ka.url)) || '网页';
      lu = (ka && (ka.luJing || ka.url)) || '';
      if (ka && ka.zang) ming = '● ' + ming;
    }
    el('wenJianMing').textContent = (zt.zang ? '● ' : '') + ming;
    el('wenJianMing').title = lu;
    el('wenJianLuJing').textContent = lu;
    el('wenJianLuJing').title = lu;
    document.title = (ming ? ming + ' · ' : '') + 'nm 文件查看器';
  }
  function tingMeiTi() {
    const mei = el('meiTiLie').querySelector('video,audio');
    if (mei) { try { mei.pause(); } catch { /* 忽略 */ } }
  }
  function sheZiDongBaoCun() {
    const gou = el('gouZiDongBaoCun');
    if (!gou) return;
    const ke = !!zt.keBianJi;
    gou.disabled = !ke;
    // 只读内容：强制不勾选且灰色不可用；可编辑内容：默认勾选（用户手动关掉则保留到下次加载）
    gou.checked = ke ? zt.ziDong !== false : false;
    gongJuCaiDanShuaXin();
  }
  function tiHuanKeYong() {
    // 替换只在「可编辑的纯文本」里安全；只读正文/二进制视图可查找但不可替换
    return !!zt.keBianJi && zt.leiXing === 'text';
  }
  function xianShi(na) {
    el('juanCuo').hidden = na !== 'text';
    el('kuaiLie').hidden = na !== 'kuai';
    el('meiTiLie').hidden = na !== 'meiTi';
    el('shiLiuLie').hidden = na !== 'hex';
    el('yaSuoKong').hidden = na !== 'archive';
    el('wangYeLie').hidden = na !== 'wangYe';
    const ys = !!zt.yaSuoBao && na !== 'wangYe';
    el('yaSuoBaoLie').hidden = !ys;
    el('yaSuoFenGe').hidden = !ys;
    if (na !== 'wangYe' && el('wangYeYuan')) el('wangYeYuan').hidden = true;
    if (na !== 'text') guanFenLan();
    // 切走媒体时先暂停：只 hidden 不暂停会让声音/视频在后台继续播
    if (na !== 'meiTi') tingMeiTi();
    el('anNiuBaoCun').disabled = !zt.keBianJi;
    el('anNiuLingCunWei').disabled = !zt.keBianJi;
    el('anNiuHuanHang').disabled = na !== 'text';
    // 只读文件：查找框和上下箭头**保持可用**，只有替换被禁用（项 8）
    el('tiHuanRu').disabled = !tiHuanKeYong();
    el('anNiuTiHuan').disabled = !tiHuanKeYong() || !zt.souCi || !zt.souPi.length;
    el('tiHuanRu').title = tiHuanKeYong() ? '' : '当前内容不可编辑，替换不可用';
    el('anNiuTiHuan').title = tiHuanKeYong()
      ? '替换当前匹配（需要先有搜索结果）'
      : '当前内容不可编辑，替换不可用';
    sheZiDongBaoCun();
    anPaiGongJuLan();
    try { yingYongShiTu(); } catch { /* 缩放系统还没初始化时忽略 */ }
    try { gengXinXiTongAnNiu(); } catch { /* 浮钮还没初始化时忽略 */ }
    try { wangYeShiTuTongBu(); } catch { /* noop */ }
  }

  /* ── 历史（后退 / 前进）—— 记**内容快照**，不只是路径 ──────
   * 为什么：用户改了内容之后要能后退回改动前；只记路径的话后退按钮永远是灰的。
   * 每条 = { lu, wen }；wen 是当时的正文（只读文档存空串，回退时重新按路径加载）。
   */
  function tuiRuLiShi(lu, wen) {
    if (!lu) return;
    const x = { lu, wen: String(wen ?? '') };
    const shang = liShi[liShiWei];
    if (shang && shang.lu === x.lu && shang.wen === x.wen) { gengXinHouQianJin(); return; }
    liShi = liShi.slice(0, liShiWei + 1);
    liShi.push(x);
    if (liShi.length > 100) liShi = liShi.slice(-100);
    liShiWei = liShi.length - 1;
    gengXinHouQianJin();
  }
  function gengXinHouQianJin() {
    el('anNiuHouTui').disabled = liShiWei <= 0;
    el('anNiuQianJin').disabled = liShiWei >= liShi.length - 1;
    try { gongJuCaiDanShuaXin(); } catch { /* 菜单还没初始化时忽略 */ }
  }
  async function huiFu(wei) {
    const x = liShi[wei];
    if (!x) return;
    if (x.lu !== zt.luJing) {
      await jiaZai(x.lu, false);
      if (x.wen && zt.leiXing === 'text') el('wenBen').value = x.wen;
    } else if (zt.leiXing === 'text') {
      el('wenBen').value = x.wen;
    }
    zt.zang = false;
    /**
     * 第 101 轮：聊天框临时编辑模式下，后退/前进只是改 textarea.value 不会触发 input
     * ⇒ 聊天框那边收不到同步、历史按钮看着"没生效"。这里补发一次 input，让同步与预览都走真实路径。
     */
    if (zt.chatEditor && zt.leiXing === 'text') {
      try { el('wenBen').dispatchEvent(new Event('input', { bubbles: true })); } catch { /* noop */ }
    }
    gengXinBiaoTi();
    gengXinYuLan();
    chongXinSouSuo();
  }

  /* ── 读 + 渲染 ─────────────────────────────────────────── */
  async function jiaZai(lu, tuiRu) {
    if (!lu) return;
    if (zt.wangYe.kai) {
      zt.wangYe.kai = false;
      el('wangYeGongJu').hidden = true;
      el('wangYeKuang').src = 'about:blank';
      el('wangYeTiShi').hidden = true;
    }
    let r = null;
    try {
      r = await window.warmy.nmDu({ path: lu });
    } catch (e) {
      r = { ok: false, cuo: String((e && e.message) || e) };
    }
    if (!r || r.ok === false) {
      tiShiWen('打开失败：' + ((r && (r.cuo || r.error)) || '未知原因'));
      zhuangTaiWen('打开失败 · ' + lu);
      return;
    }
    if (r.leiXing === 'archive') {
      xuanRanYaSuoBao(r);
      if (tuiRu) tuiRuLiShi(zt.luJing || lu, '');
      return;
    }
    if (zt.yaSuoBao) guanYaSuoBao();
    yingYongNeiRong(r);
    const geShi = String(r.kuoZhan || '').toLowerCase();

    // SVG 在主进程按图片分流（nmDu 给 file:// URL，没有源码）。这里用同一份文件的
    // 图片预览接口取回 data URL 再解 base64 —— 不新增 IPC、不读别的文件，只读当前这一个。
    if (r.leiXing === 'image' && geShi === 'svg') {
      const yuan = await duSvgYuanMa(r);
      if (yuan != null) {
        zt.leiXing = 'text';
        zt.keBianJi = true;
        r = { ...r, keBianJi: true, wenBen: yuan };
        gengXinBiaoTi();
        tiShiWen('SVG 源码已载入：左侧改源码，右侧看效果；Ctrl+S 保存。');
        xuanRanWenBen(r, { svg: true });
        chongXinSouSuo();
        if (tuiRu) tuiRuLiShi(zt.luJing, el('wenBen').value);
        return;
      }
      tiShiWen('这个 SVG 的源码读不出来（可能超过 8MB），只显示渲染效果。');
    }

    chongXinSouSuo();
    if (tuiRu) tuiRuLiShi(zt.luJing, zt.leiXing === 'text' ? el('wenBen').value : '');
  }

  /**
   * 把一次 nmDu 结果落到状态并画出来（普通文件与包内条目共用）。
   * opts.baoLiuYaSuo=true：包内条目预览，保留左侧树。
   */
  function yingYongNeiRong(r, opts = {}) {
    zt.luJing = r.luJing || zt.luJing;
    zt.ming = r.ming || '';
    zt.leiXing = r.leiXing || 'text';
    zt.keBianJi = !!r.keBianJi;
    zt.huanHang = r.huanHang === 'crlf' ? 'crlf' : 'lf';
    zt.zang = false;
    zt.ziDong = true;
    zt.kuai = Array.isArray(r.kuai) ? r.kuai : [];
    zt.ziJie = Number(r.ziJie) || 0;
    zt.souWei = 0;
    zt.fenLan = null;
    zt.shiLiu = null;
    zt.tiaoMu = r.tiaoMu || null;
    zt.fenLanZuoShou = false;
    zt.fenLanYouShou = false;
    el('neiRongHang').classList.remove('zuoShou', 'youShou');
    // 新文件回到 100%：避免上一个文件的缩放/平移把新内容顶出视口
    zt.suoFang = 1;
    zt.suoFangPanX = 0;
    zt.suoFangPanY = 0;
    tingShiTuTuo();
    gengXinBiaoTi();
    tiShiWen(r.tiShi || '');

    if (zt.leiXing === 'text') xuanRanWenBen(r);
    else if (zt.leiXing === 'binary' && r.erJinZhi) xuanRanShiLiu(r);
    else if (zt.leiXing === 'image' || zt.leiXing === 'audio' || zt.leiXing === 'video') xuanRanMeiTi(r);
    else xuanRanKuai(r);
    if (opts.baoLiuYaSuo && zt.yaSuoBao) {
      xianShi(zt.leiXing === 'binary' && r.erJinZhi ? 'hex' : zt.leiXing === 'text' ? 'text' : zt.leiXing === 'image' || zt.leiXing === 'audio' || zt.leiXing === 'video' ? 'meiTi' : 'kuai');
      shuaYaSuoXuanZhong();
    }
  }

  /** 用图片预览接口（只读当前文件）取回 SVG 文本；失败返回 null */
  async function duSvgYuanMa(r) {
    try {
      const q = await window.warmy?.wenJianYuLan?.({ path: r.luJing || zt.luJing, maxBytes: 8 * 1024 * 1024 });
      if (!q || q.ok === false || !q.dataUrl) return null;
      const m = /^data:image\/svg\+xml(?:;[^,]*)?;base64,([\s\S]+)$/i.exec(String(q.dataUrl));
      if (!m) return null;
      const bin = atob(m[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const wen = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
      return wen.trim() ? wen : null;
    } catch {
      return null;
    }
  }

  function xuanRanWenBen(r, opts = {}) {
    xianShi('text');
    const ta = el('wenBen');
    ta.readOnly = !zt.keBianJi;
    ta.value = typeof r.wenBen === 'string' ? r.wenBen : '';
    ta.scrollTop = 0;
    ta.scrollLeft = 0;
    el('gaoLiang').scrollTop = 0;
    duiQiGaoLiang();
    const geShi = String(r.kuoZhan || '').toLowerCase();
    const fenLanLei = opts.svg ? 'svg'
      : (geShi === 'html' || geShi === 'htm' || geShi === 'xhtml') ? 'html'
        : (geShi === 'md' || geShi === 'markdown' || geShi === 'mdx') ? 'md'
          : null;
    if (fenLanLei) kaiFenLan(fenLanLei);
    else guanFenLan();
    gengXinYuLan();
    sheZiDongBaoCun();
    const hang = ta.value ? ta.value.split('\n').length : 0;
    const lei = opts.svg ? 'SVG 源码' : '文本';
    zhuangTaiWen([
      lei,
      zt.keBianJi ? '可编辑' : '只读',
      ziJieWen(zt.ziJie),
      hang + ' 行',
      ta.value.length + ' 字符',
    ].join(' · '));
  }

  /* ── 压缩包：左树 + 右预览（第 78 轮项 18） ─────────────── */
  const TU_WEN_JIAN = '<svg class="yaSuoIcon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h5.2L12.5 6v7.5h-9z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.6 2.6V6h3.8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
  const TU_WEN_JIAN_JIA = '<svg class="yaSuoIcon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.2h4l1.1 1.4H14v6.2c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1V4.2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  function tianYaSuoGeShi() {
    const he = el('yaSuoGeShi');
    if (!he) return;
    const b = zt.yaSuoBao;
    const ji = b ? b.xinXi : {};
    const jiaMi = Number(ji.jiaMiShu) || 0;
    he.innerHTML = [
      '<b>可打开</b>',
      'ZIP（stored / deflate，含包内套的 .zip，可逐层展开）',
      '传统 ZipCrypto 加密：会弹密码框，密码只在内存里用',
      '包内文本 / 图片 / 音视频 / PDF / Office / 网页（只读预览）',
      jiaMi ? `<span class="jingYin">当前这一层有 ${jiaMi} 个加密条目</span>` : '',
      '<b>受保护 / 打不开</b>',
      'AES-256 加密 ZIP（条目带「保」标记）',
      'RAR / 7z / tar.gz 等非 ZIP 容器（本查看器不装第三方库）',
      'ZIP 内 bzip2 / lzma / zstd / deflate64 等压缩法',
      '压缩比 >200:1、单条 >64MB 的条目（防压缩炸弹）',
      '含 .. / 绝对路径 / 盘符的条目：可查看，解压一定跳过',
    ].filter(Boolean).join('<br>');
  }

  function xuanRanYaSuoBao(r) {
    const x = r.yaSuoBao || { tiaoMu: [], tiaoMuShu: 0, jiaMiShu: 0 };
    zt.yaSuoBao = {
      luJing: r.luJing || zt.luJing,
      ming: r.ming || '',
      xinXi: x,
      zhanKai: new Set(),
      haiZi: new Map(),
      cuo: new Map(),
      mima: [],
      dangQian: '',
    };
    zt.tiaoMu = null;
    zt.leiXing = 'archive';
    zt.keBianJi = false;
    zt.kuai = [];
    zt.shiLiu = null;
    zt.fenLan = null;
    zt.ziJie = Number(r.ziJie) || 0;
    zt.ming = r.ming || '';
    zt.luJing = r.luJing || zt.luJing;
    el('yaSuoBaoMing').textContent = zt.yaSuoBao.ming || '压缩包';
    el('yaSuoBaoMing').title = zt.yaSuoBao.luJing || '';
    el('yaSuoBaoJi').textContent = `${Number(x.tiaoMuShu) || 0} 项${Number(x.jiaMiShu) ? ` · ${x.jiaMiShu} 加密` : ''}`;
    el('yaSuoJieGuo').hidden = true;
    // 第 81 轮项 6：新压缩包回到默认宽度（拖动过的宽度不带到下一个包）
    el('yaSuoBaoLie').style.flexBasis = '';
    el('yaSuoFenGe').hidden = false;
    tianYaSuoGeShi();
    huaYaSuoShu();
    xianShi('archive');
    gengXinBiaoTi();
    tiShiWen(x.cuo || r.tiShi || '');
    zhuangTaiWen(['压缩包', x.geShi || 'ZIP', `${Number(x.tiaoMuShu) || 0} 项`, ziJieWen(zt.ziJie)].join(' · '));
  }

  function guanYaSuoBao() {
    zt.yaSuoBao = null;
    zt.tiaoMu = null;
    el('yaSuoBaoLie').hidden = true;
    el('yaSuoBaoLie').style.flexBasis = '';
    el('yaSuoFenGe').hidden = true;
    el('yaSuoGeShi').hidden = true;
    el('yaSuoJieGuo').hidden = true;
    el('yaSuoShu').innerHTML = '';
  }

  /** 扁平条目名 → 树（隐式目录也建出来；排序：目录/嵌套包在前） */
  function shuJieDian(tiaoMu, prefix) {
    const root = [];
    for (const t of Array.isArray(tiaoMu) ? tiaoMu : []) {
      const segs = String(t.ming || '').replace(/\\/g, '/').split('/').filter(Boolean);
      if (!segs.length) continue;
      let arr = root;
      for (let i = 0; i < segs.length; i += 1) {
        const last = i === segs.length - 1;
        const name = segs[i];
        let n = arr.find((x) => x.name === name);
        if (!n) {
          n = { name, path: [...prefix, ...segs.slice(0, i + 1)], isDir: !last || !!t.isDir, entry: null, children: [], nested: false };
          arr.push(n);
        }
        if (last) {
          n.entry = t;
          n.isDir = !!t.isDir;
          n.nested = !!t.shiZip;
        }
        arr = n.children;
      }
    }
    const sort = (list) => {
      list.sort((a, b) => {
        const ad = a.isDir || a.nested;
        const bd = b.isDir || b.nested;
        if (ad !== bd) return ad ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
      });
      list.forEach((n) => sort(n.children));
    };
    sort(root);
    return root;
  }

  function huaYaSuoShu() {
    const box = el('yaSuoShu');
    if (!box) return;
    box.innerHTML = '';
    const b = zt.yaSuoBao;
    if (!b) return;
    if (b.xinXi.cuo) {
      const d = document.createElement('div');
      d.className = 'yaSuoKongWen';
      d.style.padding = '12px';
      d.textContent = '这个压缩包解析不了：' + b.xinXi.cuo;
      box.appendChild(d);
      return;
    }
    if (!Array.isArray(b.xinXi.tiaoMu) || !b.xinXi.tiaoMu.length) {
      const d = document.createElement('div');
      d.className = 'yaSuoKongWen';
      d.style.padding = '12px';
      d.textContent = '空压缩包（没有条目）。';
      box.appendChild(d);
      return;
    }
    b.jieDian = new Map();
    const frag = document.createDocumentFragment();
    huaYaSuoLie(shuJieDian(b.xinXi.tiaoMu, []), 0, frag);
    box.appendChild(frag);
  }

  function huaYaSuoLie(nodes, depth, parent) {
    const b = zt.yaSuoBao;
    for (const n of nodes) {
      const key = n.path.join('\u0001');
      b.jieDian.set(key, n);
      const row = document.createElement('div');
      row.className = 'yaSuoTiao' + (b.dangQian === key ? ' dangQian' : '');
      row.dataset.key = key;
      row.setAttribute('role', 'treeitem');
      row.style.paddingLeft = (4 + depth * 12) + 'px';
      const you = n.children.length > 0 || n.nested;
      row.title = n.path.join('/') + (n.entry && n.entry.weiXian ? '\n' + n.entry.weiXian : '');

      const chev = document.createElement('button');
      chev.type = 'button';
      chev.className = 'yaSuoChevron' + (you ? '' : ' kong');
      if (you) {
        chev.textContent = b.zhanKai.has(key) ? '▾' : '▸';
        chev.setAttribute('aria-label', b.zhanKai.has(key) ? '收起' : '展开');
        chev.addEventListener('click', (e) => { e.stopPropagation(); void yaSuoZhanKai(n); });
      }
      row.appendChild(chev);

      const icon = document.createElement('span');
      icon.innerHTML = (n.isDir || n.nested) ? TU_WEN_JIAN_JIA : TU_WEN_JIAN;
      row.appendChild(icon.firstChild);

      const ming = document.createElement('span');
      ming.className = 'yaSuoMing';
      ming.textContent = n.name;
      row.appendChild(ming);

      if (n.entry && n.entry.jiaMi) row.appendChild(yaSuoBiao('密', 'jia', '加密：需要密码'));
      if (n.entry && n.entry.shouBaoHu) row.appendChild(yaSuoBiao('保', 'suo', n.entry.yuanYin || '受保护'));
      if (n.entry && n.entry.weiXian) row.appendChild(yaSuoBiao('险', 'wei', n.entry.weiXian));
      if (n.entry && n.entry.anQuan === false) row.appendChild(yaSuoBiao('!', 'wei', '路径不安全：可查看，解压会跳过'));

      if (n.entry && !n.isDir) {
        const dx = document.createElement('span');
        dx.className = 'yaSuoDaXiao';
        dx.textContent = ziJieWen(n.entry.ziJie);
        row.appendChild(dx);
      }

      row.addEventListener('click', () => {
        if (n.isDir || n.nested) void yaSuoZhanKai(n);
        else void jiaZaiTiaoMu(n);
      });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); yaSuoYouJian(n, row); });
      parent.appendChild(row);

      if (you && b.zhanKai.has(key)) {
        const kids = n.nested ? b.haiZi.get(key) : n.children;
        if (kids && kids.length) huaYaSuoLie(kids, depth + 1, parent);
        else if (n.nested && !b.haiZi.has(key)) {
          const d = document.createElement('div');
          d.className = 'yaSuoTiao';
          d.style.paddingLeft = (4 + (depth + 1) * 12 + 20) + 'px';
          d.textContent = b.cuo.get(key) || '展开中…';
          if (b.cuo.get(key)) d.style.color = '#a22';
          parent.appendChild(d);
        }
      }
    }
  }

  function yaSuoBiao(wen, lei, title) {
    const s = document.createElement('span');
    s.className = 'yaSuoBiao ' + (lei || '');
    s.textContent = wen;
    s.title = title || '';
    return s;
  }

  async function yaSuoZhanKai(n) {
    const b = zt.yaSuoBao;
    if (!b) return;
    const key = n.path.join('\u0001');
    if (b.zhanKai.has(key)) { b.zhanKai.delete(key); huaYaSuoShu(); return; }
    b.zhanKai.add(key);
    if (!n.nested) { huaYaSuoShu(); return; }
    if (b.haiZi.has(key)) { huaYaSuoShu(); return; }
    b.cuo.delete(key);
    huaYaSuoShu();
    let r = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      r = await nmDuZip({ a: 'tree', z: b.luJing, e: n.path, p: b.mima });
      if (r && r.ok && r.yaSuoBao) {
        b.haiZi.set(key, shuJieDian(r.yaSuoBao.tiaoMu, n.path));
        huaYaSuoShu();
        return;
      }
      if (r && r.needPassword) {
        const pw = await wenMiMa(r.cuo || '这个嵌套压缩包需要密码', n.path.join('/'));
        if (pw == null) break;
        b.mima[n.path.length - 1] = pw;
        continue;
      }
      b.cuo.set(key, (r && r.cuo) || '展开失败');
      break;
    }
    if (!b.haiZi.has(key)) b.zhanKai.delete(key);
    huaYaSuoShu();
    if (b.cuo.get(key)) tiShiWen('展开失败：' + b.cuo.get(key));
  }

  async function jiaZaiTiaoMu(n) {
    const b = zt.yaSuoBao;
    if (!b) return;
    const ceng = n.path.length - 1;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const r = await nmDuZip({ a: 'read', z: b.luJing, e: n.path, p: b.mima });
      if (r && r.ok) {
        b.dangQian = n.path.join('\u0001');
        yingYongNeiRong(r, { baoLiuYaSuo: true });
        zhuangTaiWen([n.name, ziJieWen(r.ziJie), '包内只读'].join(' · '));
        return;
      }
      if (r && r.needPassword) {
        const pw = await wenMiMa(r.cuo || '这个文件加密了', n.path.join('/'));
        if (pw == null) return;
        b.mima[ceng] = pw;
        continue;
      }
      if (r && r.shouBaoHu) { tiShiWen('这个条目受保护，当前打不开：' + (r.cuo || '')); return; }
      tiShiWen('预览失败：' + ((r && r.cuo) || '未知原因'));
      return;
    }
    tiShiWen('密码重试次数过多，已停止。');
  }

  function shuaYaSuoXuanZhong() {
    const b = zt.yaSuoBao;
    if (!b) return;
    document.querySelectorAll('#yaSuoShu .yaSuoTiao').forEach((row) => {
      row.classList.toggle('dangQian', row.dataset.key === b.dangQian);
    });
  }

  /* ── 密码框（只在内存里；关闭窗口即清除） ─────────────── */
  function wenMiMa(cuo, ming) {
    if (zt.mimaDai) { try { zt.mimaDai(null); } catch { /* 旧对话框被新请求顶掉 */ } }
    return new Promise((resolve) => {
      zt.mimaDai = resolve;
      el('mimaZheZhao').hidden = false;
      el('mimaWen').textContent = ming ? ('条目：' + ming) : '';
      el('mimaCuo').hidden = !cuo;
      el('mimaCuo').textContent = cuo || '';
      const shu = el('mimaShuRu');
      shu.value = '';
      setTimeout(() => { try { shu.focus(); } catch { /* noop */ } }, 0);
    });
  }
  function jieShuMiMa(zhi) {
    const fn = zt.mimaDai;
    zt.mimaDai = null;
    el('mimaZheZhao').hidden = true;
    el('mimaShuRu').value = '';
    if (fn) fn(zhi);
  }
  function miMaQue() {
    const v = String(el('mimaShuRu').value || '');
    if (!v) { el('mimaCuo').hidden = false; el('mimaCuo').textContent = '请输入密码（密码可以是空字符串的压缩包很少见，这里按非空处理）'; return; }
    jieShuMiMa(v);
  }

  /* ── 解压（目标目录由主进程在压缩包旁边新建；绝不覆盖） ── */
  async function jieYaTiaoMu(n, all) {
    const b = zt.yaSuoBao;
    if (!b) return;
    const ePath = n ? n.path : [];
    const yaoQuanBu = !!all;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      zhuangTaiWen('正在解压…');
      const r = await nmDuZip({ a: 'extract', z: b.luJing, e: ePath, p: b.mima, all: yaoQuanBu });
      if (r && r.ok) {
        zt.jieYaMuLu = r.jieYaDao || '';
        el('yaSuoJieGuo').hidden = false;
        el('yaSuoJieGuoWen').textContent = `已解压 ${r.xieRu || 0} 个文件${Array.isArray(r.tiaoGuo) && r.tiaoGuo.length ? `，跳过 ${r.tiaoGuo.length} 项` : ''}`;
        el('yaSuoJieGuoWen').title = Array.isArray(r.tiaoGuo) ? r.tiaoGuo.slice(0, 20).map((x) => x.ming + '：' + x.yuanYin).join('\n') : '';
        el('yaSuoJieGuo').dataset.dir = zt.jieYaMuLu;
        el('anNiuDaKaiJieYaMuLu').hidden = !zt.jieYaMuLu;
        tiShiWen(r.tiShi || '');
        zhuangTaiWen('已解压 · ' + (r.jieYaDao || ''));
        return;
      }
      if (r && r.needPassword) {
        const pw = await wenMiMa(r.cuo || '这个压缩包需要密码', ePath.join('/'));
        if (pw == null) { zhuangTaiWen('已取消解压'); return; }
        b.mima[ePath.length] = pw;
        continue;
      }
      const cuo = (r && r.cuo) || '未知原因';
      tiShiWen('解压失败：' + cuo);
      zhuangTaiWen('解压失败 · ' + cuo);
      return;
    }
    tiShiWen('密码重试次数过多，已停止解压。');
  }

  function yaSuoYouJian(n, row) {
    const xiang = [];
    const key = n.path.join('\u0001');
    if (!n.isDir && !n.nested) xiang.push({ label: '预览', onClick: () => { void jiaZaiTiaoMu(n); } });
    if (n.nested) {
      xiang.push({ label: zt.yaSuoBao.zhanKai.has(key) ? '收起' : '展开', onClick: () => { void yaSuoZhanKai(n); } });
      xiang.push({ label: '解压这个压缩包（展开内容）', onClick: () => { void jieYaTiaoMu(n, true); } });
    } else if (!n.isDir) {
      xiang.push({ label: '解压此文件', onClick: () => { void jieYaTiaoMu(n, false); } });
    }
    xiang.push({ label: '解压这一层全部', onClick: () => { void jieYaTiaoMu(null, true); } });
    xiang.push({ sep: true });
    xiang.push({
      label: '复制包内路径',
      onClick: () => fuZhiWen(n.path.join('/')),
    });
    kaiCaiDan(row, xiang, 'archive');
  }

  function fuZhiWen(wen) {
    const s = String(wen || '');
    if (!s) return;
    const jiuTi = () => {
      const ta = document.createElement('textarea');
      ta.value = s;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); zhuangTaiWen('已复制：' + s.slice(0, 80)); } catch { zhuangTaiWen('复制失败'); }
      ta.remove();
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(s).then(
          () => zhuangTaiWen('已复制：' + s.slice(0, 80)),
          () => jiuTi(),
        );
      } else {
        jiuTi();
      }
    } catch { jiuTi(); }
  }

  /** 预览右上角「系统默认打开」是否该出现 */
  function gengXinXiTongAnNiu() {
    const b = el('anNiuXiTongDaKai');
    if (!b) return;
    let ke = false;
    if (zt.wangYe.kai) {
      const ka = zt.wangYe.ka[zt.wangYe.dang];
      ke = !!(ka && ka.url);
    } else if (zt.yaSuoBao && zt.tiaoMu) {
      ke = true;
    } else if (zt.luJing && zt.leiXing !== 'archive') {
      // 可编辑纯文本没有"预览"，不显示；HTML/只读文档/图片/音视频都显示
      ke = zt.leiXing !== 'text' || !!zt.fenLan || !zt.keBianJi;
    }
    b.hidden = !ke;
  }

  async function xiTongDaKai() {
    if (zt.wangYe.kai) {
      const ka = zt.wangYe.ka[zt.wangYe.dang];
      const u = ka && ka.url;
      if (!u) return;
      try {
        const r = await window.warmy.openExternal(u);
        if (r && r.ok === false) tiShiWen('系统浏览器打开失败：' + (r.error || ''));
        else zhuangTaiWen('已交给系统浏览器 · ' + u);
      } catch (e) { tiShiWen('系统浏览器打开失败：' + String((e && e.message) || e)); }
      return;
    }
    let r = null;
    if (zt.yaSuoBao && zt.tiaoMu) {
      r = await nmDuZip({ a: 'sysopen', z: zt.yaSuoBao.luJing, e: zt.tiaoMu.luJing.split('/'), p: zt.yaSuoBao.mima });
    } else if (zt.luJing) {
      r = await nmDuZip({ a: 'sysopen', f: zt.luJing });
    }
    if (!r || r.ok === false) {
      if (r && r.needPassword) tiShiWen('这个条目加密了，先输入密码预览后再用系统程序打开。');
      else tiShiWen('系统默认打开失败：' + ((r && r.cuo) || '未知原因'));
      return;
    }
    zhuangTaiWen('已交给系统默认程序 · ' + (r.luJing || ''));
  }


  /* ── 网站模式（第 81 轮项 12）：两行工具栏 + 标签页 + 4 态分栏 ──
   * 标签页可以指向远程网址（只读）或本地网页（本窗口打开的那个文件可编辑源码）。
   * 本地源码改动即时写进 iframe 的 srcdoc —— 未保存也跟随。
   */
  function wangYeDangQian() {
    return zt.wangYe.ka[zt.wangYe.dang] || null;
  }
  /** 每个标签页自己的分栏状态（0..3）与网页占比（0.2..0.8） */
  function wangYeFenLanShu() {
    return Math.max(0, Math.min(3, Number(wangYeDangQian()?.fenLan) || 0));
  }
  function wangYeFenLanBi() {
    const b = Number(wangYeDangQian()?.fenLanBi);
    return Number.isFinite(b) ? Math.max(0.2, Math.min(0.8, b)) : 0.5;
  }
  const WANG_YE_XIN_MO_REN = 'https://www.numumu.com/';
  function guiFanWangYe(u) {
    let s = String(u || '').trim();
    if (!s) return '';
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) s = 'https://' + s;
    try {
      const x = new URL(s);
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
      return x.href;
    } catch { return ''; }
  }
  /** 本地路径 / file:// URL → 绝对路径；不是本地就返回空 */
  function benDiLuJing(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    if (/^file:/i.test(s)) {
      try {
        let p = decodeURIComponent(new URL(s).pathname || '');
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
        return p.replace(/\//g, '\\');
      } catch { return ''; }
    }
    if (/^[A-Za-z]:[\\/]/.test(s) || /^\\\\/.test(s) || /^\//.test(s)) return s;
    return '';
  }
  function wenJianUrl(lu) {
    const p = String(lu || '').replace(/\\/g, '/');
    const abs = /^[A-Za-z]:/.test(p) ? '/' + p : p;
    return 'file://' + encodeURI(abs).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }
  function wangYeBiaoTi(ka) {
    if (!ka) return '网页';
    if (ka.shiBenDi) return (ka.title || '本地网页') + (ka.keBianJi ? '' : '（只读）');
    return ka.title || ka.url || '新网页';
  }
  function wangYeKa(url) {
    return {
      url: '', luJing: '', title: '新网页', history: [], idx: -1,
      yuan: null, zang: false, shiBenDi: false, keBianJi: false,
      /** 第 122 轮：每个标签页自己的分栏方式与比例 */
      fenLan: 0, fenLanBi: 0.5,
      /** 远程网页源码缓存（主进程从 WebContentsView 读渲染后的 HTML） */
      yuanUrl: '', yuanDai: false, yuanErr: '',
    };
  }
  function gengXinWangYe() {
    const ka = wangYeDangQian();
    const bu = el('wangYeUrl');
    if (bu) bu.value = ka ? (ka.shiBenDi ? (ka.luJing || '') : (ka.url || '')) : '';
    const hou = el('anNiuWangYeHou');
    const qian = el('anNiuWangYeQian');
    const yuanCheng = !!(ka && !ka.shiBenDi && ka.url);
    if (hou) hou.disabled = yuanCheng ? !ka.remoteNav?.canGoBack : (!ka || ka.idx <= 0);
    if (qian) qian.disabled = yuanCheng ? !ka.remoteNav?.canGoForward : (!ka || ka.idx >= ka.history.length - 1);
    const shua = el('anNiuWangYeShua');
    if (shua) {
      const ting = !!(yuanCheng && ka.loading);
      shua.title = ting ? '停止载入' : '刷新';
      shua.setAttribute('aria-label', ting ? '停止载入' : '刷新');
    }
    yingYongWangYeFenLan(true);
    huaWangYeTab();
    gengXinWangYeYuan();
  }

  /* ── 第 116 轮：远程页查找条（主进程 findInPage + before-input-event 快捷键） ── */
  function wangYeSouJiWen(text) {
    const ji = el('wangYeSouJi');
    if (ji) {
      ji.textContent = text;
      ji.classList.toggle('wu', text === '0/0');
    }
  }
  function wangYeSouQing() {
    const w = zt.wangYe.wangSou;
    if (w.dingShi) { clearTimeout(w.dingShi); w.dingShi = null; }
    w.ci = '';
    const ru = el('wangYeSouRu');
    if (ru) ru.value = '';
    wangYeSouJiWen('0/0');
    try { window.warmy.nmWangYeChaZhao?.({ id: chuangKouId, wen: '' }); } catch { /* noop */ }
  }
  function wangYeSouKai(kai) {
    const hang = el('wangYeSouHang');
    const ka = wangYeDangQian();
    if (!hang) return;
    if (kai && !(ka && !ka.shiBenDi && ka.url)) {
      zhuangTaiWen('当前网页还没有可查找的内容');
      return;
    }
    hang.hidden = !kai;
    zt.wangYe.wangSou.kai = !!kai;
    if (!kai) { wangYeSouQing(); return; }
    const ru = el('wangYeSouRu');
    try { ru.focus(); ru.select(); } catch { /* noop */ }
    if (ru.value) wangYeSouCha(1, true);
  }
  function wangYeSouCha(fang, liJi) {
    const w = zt.wangYe.wangSou;
    const ru = el('wangYeSouRu');
    const ci = String(ru?.value || '');
    if (w.dingShi) { clearTimeout(w.dingShi); w.dingShi = null; }
    if (!ci) { w.ci = ''; wangYeSouJiWen('0/0'); try { window.warmy.nmWangYeChaZhao?.({ id: chuangKouId, wen: '' }); } catch { /* noop */ } return; }
    const pao = () => {
      w.ci = ci;
      wangYeSouJiWen('…');
      try { window.warmy.nmWangYeChaZhao?.({ id: chuangKouId, wen: ci, xiangQian: fang > 0 }); } catch { wangYeSouJiWen('0/0'); }
    };
    if (liJi) pao();
    else w.dingShi = setTimeout(() => { w.dingShi = null; pao(); }, 160);
  }

  function huaWangYeTab() {
    const lie = el('wangYeTabLie');
    if (!lie) return;
    lie.innerHTML = '';
    zt.wangYe.ka.forEach((k, i) => {
      const b = document.createElement('div');
      b.className = 'wangYeTab' + (i === zt.wangYe.dang ? ' dangQian' : '');
      b.dataset.i = String(i);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === zt.wangYe.dang ? 'true' : 'false');
      b.title = k.shiBenDi ? (k.luJing || '') : (k.url || '新网页');
      const s = document.createElement('span');
      s.className = 'tabMing';
      s.textContent = (k.zang ? '● ' : '') + wangYeBiaoTi(k);
      b.appendChild(s);
      const g = document.createElement('button');
      g.type = 'button';
      g.className = 'tabGuan';
      g.title = '关闭标签页';
      g.setAttribute('aria-label', '关闭标签页');
      g.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">'
        + '<path d="M2.2 2.2l5.6 5.6M7.8 2.2 2.2 7.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
      g.addEventListener('click', (e) => { e.stopPropagation(); void guanWangYeKa(i); });
      b.appendChild(g);
      b.addEventListener('click', () => { void qieHuanWangYeKa(i); });
      lie.appendChild(b);
    });
    gengXinTabGun();
  }
  function gengXinTabGun() {
    const lie = el('wangYeTabLie');
    if (!lie) return;
    const zuo = el('anNiuWangYeTabZuo');
    const you = el('anNiuWangYeTabYou');
    if (zuo) zuo.disabled = lie.scrollLeft <= 1;
    if (you) you.disabled = lie.scrollLeft + lie.clientWidth >= lie.scrollWidth - 1;
  }
  async function qieHuanWangYeKa(i) {
    if (i === zt.wangYe.dang) return;
    if (!(await zhunBeiQieHuanWangYe())) return;
    try { wangYeSouKai(false); } catch { /* noop */ }
    zt.wangYe.dang = Math.max(0, Math.min(i, zt.wangYe.ka.length - 1));
    huaWangYeDangQian();
  }
  async function guanWangYeKa(i) {
    if (i !== zt.wangYe.dang) {
      zt.wangYe.ka.splice(i, 1);
      if (zt.wangYe.dang > i) zt.wangYe.dang -= 1;
      gengXinWangYe();
      gengXinBiaoTi();
      return;
    }
    if (!(await zhunBeiQieHuanWangYe())) return;
    try { wangYeSouKai(false); } catch { /* noop */ }
    zt.wangYe.ka.splice(i, 1);
    if (!zt.wangYe.ka.length) {
      wangYeKai(false);
      return;
    }
    zt.wangYe.dang = Math.max(0, Math.min(i, zt.wangYe.ka.length - 1));
    huaWangYeDangQian();
  }
  function huaWangYeDangQian() {
    const ka = wangYeDangQian();
    if (!ka) return;
    huaWangYeYuLan(ka);
    gengXinWangYe();
    gengXinBiaoTi();
    zhuangTaiWen(ka.shiBenDi ? ('本地网页 · ' + (ka.luJing || '')) : ('网页 · ' + (ka.url || '')));
  }
  /** 第 104 轮 项 12：量网页容器，交给主进程的 WebContentsView（CSS px = DIP） */
  function wangYeKuangCeLiang() {
    const box = el('wangYeKuangHe');
    if (!box) return { x: 0, y: 0, width: 0, height: 0 };
    const r = box.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }
  /** 远程网页显示/隐藏/换边界；本地网页和文件模式一律隐藏视图（视图会盖住 DOM）。 */
  function wangYeShiTuTongBu() {
    const ka = wangYeDangQian();
    const ying = !!(zt.wangYe.kai && ka && !ka.shiBenDi && ka.url && !zt.wangYe.yeKuangHide);
    const kuang = ying ? wangYeKuangCeLiang() : null;
    const key = ying ? [ka.url, kuang.x, kuang.y, kuang.width, kuang.height].join('|') : 'off';
    if (key === zt.wangYe.shiTuKey) return;
    zt.wangYe.shiTuKey = key;
    try {
      if (!ying) { window.warmy.nmWangYeGuan?.(chuangKouId); return; }
      window.warmy.nmWangYeKai?.({ id: chuangKouId, url: ka.url, kuang });
    } catch { /* 视图不可用时保持 iframe 空态，不阻塞查看器 */ }
  }
  function huaWangYeYuLan(ka) {
    const f = el('wangYeKuang');
    if (!f) return;
    if (!ka) { f.src = 'about:blank'; wangYeShiTuTongBu(); return; }
    if (ka.shiBenDi) {
      const u = wenJianUrl(ka.luJing);
      const base = u.slice(0, u.lastIndexOf('/') + 1);
      f.removeAttribute('src');
      f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><base href="' + escapeHtml(base) + '"></head><body>'
        + String(ka.yuan || '') + '</body></html>';
      el('wangYeTiShi').hidden = true;
      wangYeShiTuTongBu();
      return;
    }
    f.removeAttribute('srcdoc');
    f.src = 'about:blank';
    el('wangYeTiShi').hidden = !!ka.url;
    el('wangYeTiShi').textContent = ka.url ? '' : '输入网址开始浏览';
    wangYeShiTuTongBu();
  }
  function wangYeKai(kai) {
    zt.wangYe.kai = !!kai;
    el('wangYeGongJu').hidden = !zt.wangYe.kai;
    if (!zt.wangYe.kai) {
      try { wangYeSouKai(false); } catch { /* noop */ }
      zt.wangYe.shiTuKey = '';
      el('wangYeKuang').src = 'about:blank';
      el('wangYeKuang').removeAttribute('srcdoc');
      el('wangYeTiShi').hidden = true;
      try { window.warmy.nmWangYeGuan?.(chuangKouId); } catch { /* noop */ }
      if (zt.yaSuoBao) {
        huaYaSuoShu();
        xianShi(zt.tiaoMu ? (zt.leiXing === 'binary' ? 'hex' : zt.leiXing === 'text' ? 'text' : zt.leiXing === 'image' || zt.leiXing === 'audio' || zt.leiXing === 'video' ? 'meiTi' : 'kuai') : 'archive');
      } else if (zt.luJing) {
        void jiaZai(zt.luJing, false);
      }
      gengXinBiaoTi();
      return;
    }
    if (zt.wangYe.dang < 0 || !wangYeDangQian()) {
      zt.wangYe.ka.push(wangYeKa());
      zt.wangYe.dang = zt.wangYe.ka.length - 1;
    }
    /** 打开网站模式时把开关状态同步给主进程（主进程按它决定是否拦链接跳转） */
    wangYeXinKaiKai(zt.wangYe.xinKai, true);
    xianShi('wangYe');
    gengXinWangYe();
    gengXinBiaoTi();
  }
  function wangYeTuiRu(ka, u) {
    if (!ka || !u) return;
    ka.history = ka.history.slice(0, ka.idx + 1);
    ka.history.push(u);
    if (ka.history.length > 100) ka.history = ka.history.slice(-100);
    ka.idx = ka.history.length - 1;
  }
  /** 地址栏回车：网址走远程；file:// 或本地路径走本地网页 */
  function wangYeSheZhi(u, tuiRu) {
    const ka = wangYeDangQian();
    if (!ka) return;
    const s = String(u || '').trim();
    const lu = benDiLuJing(s);
    if (lu) { void wangYeDaKaiBenDi(lu, tuiRu, ka); return; }
    const url = guiFanWangYe(s);
    if (!url) {
      tiShiWen('只支持 http/https 网址，或本机网页文件路径（不会执行 javascript: 或本地脚本）。');
      return;
    }
    ka.shiBenDi = false;
    ka.luJing = '';
    ka.yuan = null;
    ka.keBianJi = false;
    ka.url = url;
    try { ka.title = new URL(url).host || url; } catch { ka.title = url; }
    if (tuiRu !== false) wangYeTuiRu(ka, url);
    huaWangYeYuLan(ka);
    gengXinWangYe();
    gengXinBiaoTi();
    zhuangTaiWen('网页 · ' + url);
  }
  async function wangYeDaKaiBenDi(lu, tuiRu, kaDing) {
    const ka = kaDing || wangYeDangQian();
    if (!ka) return false;
    let r = null;
    try { r = await window.warmy.nmDu({ path: lu }); } catch (e) { r = { ok: false, cuo: String((e && e.message) || e) }; }
    if (!r || r.ok === false) {
      tiShiWen('打开本地网页失败：' + ((r && (r.cuo || r.error)) || '未知原因'));
      return false;
    }
    if (r.leiXing !== 'text') {
      tiShiWen('网站模式只打开文本/网页文件；这个文件是 ' + (r.leiXing || '其它类型') + '，请在文件模式查看。');
      return false;
    }
    ka.shiBenDi = true;
    ka.luJing = r.luJing || lu;
    ka.url = wenJianUrl(ka.luJing);
    ka.title = r.ming || '本地网页';
    ka.yuan = String(r.wenBen ?? '');
    // 只有"本窗口打开的那个文件"才能保存（保存 IPC 按窗口当前文件写回）
    ka.keBianJi = !!r.keBianJi && String(r.luJing || lu) === String(zt.luJing || '');
    ka.zang = false;
    if (tuiRu !== false) wangYeTuiRu(ka, ka.url);
    huaWangYeYuLan(ka);
    gengXinWangYe();
    gengXinBiaoTi();
    zhuangTaiWen('本地网页 · ' + ka.luJing + (ka.keBianJi ? '' : ' · 源码只读（不是本窗口打开的文件）'));
    return true;
  }
  function wangYeXin(url) {
    try { wangYeSouKai(false); } catch { /* noop */ }
    const ka = wangYeKa();
    zt.wangYe.ka.push(ka);
    zt.wangYe.dang = zt.wangYe.ka.length - 1;
    wangYeKai(true);
    if (url) wangYeSheZhi(url, true);
    else { buXuanZhuan(); setTimeout(() => { try { el('wangYeUrl').focus(); el('wangYeUrl').select(); } catch { /* noop */ } }, 0); }
    return ka;
  }
  /** 新建标签页前先处理当前标签的未保存源码（和切标签/关标签同一套提醒） */
  async function wangYeXinAnQuan(url) {
    if (!(await zhunBeiQieHuanWangYe())) return false;
    wangYeXin(url);
    return true;
  }
  function buXuanZhuan() {
    const f = el('wangYeKuang');
    if (f) f.src = 'about:blank';
    try { window.warmy.nmWangYeGuan?.(chuangKouId); } catch { /* noop */ }
    gengXinWangYe();
    gengXinBiaoTi();
  }
  /** 第 81 轮：目录菜单「打开网站」——在当前 nm 窗口进入网站模式（本地网页文件作为第一个标签页） */
  function daKaiWangYeMoShi() {
    if (zt.wangYe.kai) { wangYeKai(false); }
    zt.wangYe.ka = [];
    zt.wangYe.dang = -1;
    el('wangYeUrl').value = '';
    const ming = String(zt.ming || '');
    const shiHtml = zt.leiXing === 'text' && /\.(html?|xhtml|svg|md|markdown|mdx)$/i.test(ming);
    if (shiHtml && zt.luJing) {
      const ka = wangYeKa();
      ka.shiBenDi = true;
      ka.luJing = zt.luJing;
      ka.url = wenJianUrl(zt.luJing);
      ka.title = zt.ming || '本地网页';
      ka.yuan = el('wenBen') ? el('wenBen').value : '';
      ka.keBianJi = !!zt.keBianJi;
      ka.zang = !!zt.zang;
      wangYeTuiRu(ka, ka.url);
      zt.wangYe.ka.push(ka);
      zt.wangYe.dang = 0;
      wangYeKai(true);
      setTimeout(() => { try { el('wangYeUrl').focus(); el('wangYeUrl').select(); } catch { /* noop */ } }, 0);
      zhuangTaiWen('网站模式 · 本地网页可改源码，右侧预览即时跟随');
      return;
    }
    wangYeXin('');
    zhuangTaiWen('网站模式 · 输入网址开始；本地网页可编辑源码');
  }
  function wangYeHouQian(fang) {
    const ka = wangYeDangQian();
    if (!ka) return;
    if (!ka.shiBenDi && ka.url) {
      if (fang > 0 && ka.remoteNav && !ka.remoteNav.canGoForward) return;
      if (fang < 0 && ka.remoteNav && !ka.remoteNav.canGoBack) return;
      try { window.warmy.nmWangYeDaoHang?.({ id: chuangKouId, dong: fang > 0 ? 'forward' : 'back' }); } catch { /* noop */ }
      return;
    }
    const i = ka.idx + (fang > 0 ? 1 : -1);
    if (i < 0 || i >= ka.history.length) return;
    ka.idx = i;
    const u = ka.history[i];
    if (benDiLuJing(u) || ka.shiBenDi) {
      // 历史里同属本地网页：重新读源码（文件可能已经被保存过）
      const lu = benDiLuJing(u) || ka.luJing;
      if (lu) { void wangYeDaKaiBenDi(lu, false, ka); return; }
    }
    ka.url = u;
    ka.shiBenDi = false;
    try { ka.title = new URL(u).host || u; } catch { ka.title = u; }
    huaWangYeYuLan(ka);
    gengXinWangYe();
    gengXinBiaoTi();
  }
  function wangYeShua() {
    const ka = wangYeDangQian();
    if (!ka) return;
    if (ka.shiBenDi) {
      yuanYuLanShua();
      zhuangTaiWen('已刷新预览（未保存的改动也生效）');
      return;
    }
    if (!ka.url) return;
    if (ka.loading) {
      try { window.warmy.nmWangYeDaoHang?.({ id: chuangKouId, dong: 'stop' }); } catch { /* noop */ }
      zhuangTaiWen('已停止载入 · ' + ka.url);
      return;
    }
    try { window.warmy.nmWangYeDaoHang?.({ id: chuangKouId, dong: 'reload' }); } catch { /* noop */ }
    zhuangTaiWen('刷新 · ' + ka.url);
  }
  function wangYeLiShiCaiDan() {
    const ka = wangYeDangQian();
    if (!ka || !ka.history.length) { zhuangTaiWen('当前标签页没有历史'); return; }
    const xiang = [];
    for (let i = ka.history.length - 1; i >= 0; i -= 1) {
      const u = ka.history[i];
      xiang.push({
        label: (i === ka.idx ? '● ' : '') + (u.length > 60 ? u.slice(0, 58) + '…' : u),
        onClick: () => {
          ka.idx = i;
          if (benDiLuJing(u)) void wangYeDaKaiBenDi(benDiLuJing(u), false, ka);
          else { ka.url = u; ka.shiBenDi = false; huaWangYeYuLan(ka); gengXinWangYe(); gengXinBiaoTi(); }
        },
      });
    }
    kaiCaiDan(el('anNiuWangYeLiShi'), xiang, 'web');
  }
  /** 第 122 轮：工具栏按钮是**开关**——开启后网页里的链接在新标签页打开，不再覆盖当前页 */
  function wangYeXinKaiKai(on, wuTiShi) {
    zt.wangYe.xinKai = !!on;
    const b = el('anNiuWangYeXinBiaoQian');
    if (b) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('kai', !!on);
      b.title = on ? '在新标签页打开链接：开（点击关闭）' : '在新标签页打开链接：关（点击开启）';
    }
    try {
      const p = window.warmy.nmWangYeXinKai?.({ id: chuangKouId, kai: !!on });
      if (p && typeof p.catch === 'function') p.catch(() => { /* noop */ });
    } catch { /* 老版本主进程没有这个通道时不影响浏览 */ }
    if (!wuTiShi) zhuangTaiWen(on ? '链接将在新标签页打开' : '链接在当前标签页打开');
  }

  /* 分栏 4 态：0 只网页（正常色）/ 1 网页左源码右 / 2 源码左网页右 / 3 网页上源码下（主题色） */
  const WANG_YE_FEN_LAN_MING = ['只网页', '网页左 / 源码右', '源码左 / 网页右', '网页上 / 源码下'];
  function yingYongWangYeFenLan(wuTiShi) {
    const n = wangYeFenLanShu();
    const bi = wangYeFenLanBi();
    const lie = el('wangYeLie');
    lie.classList.remove('fen1', 'fen2', 'fen3');
    if (n > 0) lie.classList.add('fen' + n);
    const yuan = el('wangYeYuan');
    const kuang = el('wangYeKuangHe');
    const fg = el('wangYeFenGe');
    if (yuan) yuan.hidden = n === 0;
    if (fg) {
      fg.hidden = n === 0;
      fg.setAttribute('aria-orientation', n === 3 ? 'horizontal' : 'vertical');
      fg.setAttribute('aria-valuenow', String(Math.round(bi * 100)));
    }
    /** 网页占比 bi 是唯一真值：左右分栏给源码 (1-bi)，上下分栏给网页 bi */
    if (kuang) kuang.style.flexBasis = n === 3 ? (bi * 100).toFixed(2) + '%' : '';
    if (yuan) yuan.style.flexBasis = n > 0 && n !== 3 ? ((1 - bi) * 100).toFixed(2) + '%' : '';
    const b = el('anNiuWangYeFenLan');
    if (b) {
      b.setAttribute('aria-pressed', n > 0 ? 'true' : 'false');
      b.title = '分栏：' + WANG_YE_FEN_LAN_MING[n] + '（点击切换）';
      b.classList.toggle('kai', n > 0);
    }
    if (!wuTiShi) zhuangTaiWen('分栏 · ' + WANG_YE_FEN_LAN_MING[n] + ' · ' + Math.round(bi * 100) + '%');
    try { wangYeShiTuTongBu(); } catch { /* noop */ }
  }
  async function xunHuanWangYeFenLan() {
    const ka = wangYeDangQian();
    if (!ka) return;
    const xin = ((Number(ka.fenLan) || 0) + 1) % 4;
    if (xin !== ka.fenLan && !(await zhunBeiQieHuanWangYe())) return;
    ka.fenLan = xin;
    yingYongWangYeFenLan();
    gengXinWangYeYuan();
  }

  /* 源码栏：本地可编辑、远程只读；远程源码由主进程从 WebContentsView 读渲染后的 HTML */
  function wangYeQingQiuYuan(ka) {
    if (!ka || ka.shiBenDi || !ka.url || ka.yuanDai) return;
    if (ka.yuan != null && ka.yuanUrl === ka.url) return;
    const url = ka.url;
    ka.yuanDai = true;
    ka.yuanErr = '';
    void (async () => {
      try {
        const r = await window.warmy.nmWangYeYuan?.({ id: chuangKouId, url });
        if (r && r.ok) {
          ka.yuan = String(r.html ?? '');
          ka.yuanUrl = String(r.url || url);
          ka.yuanErr = '';
        } else {
          ka.yuan = null;
          ka.yuanErr = String((r && (r.cuo || r.error)) || '没有拿到网页源码');
        }
      } catch (e) {
        ka.yuan = null;
        ka.yuanErr = String((e && e.message) || e || '读取源码失败');
      } finally {
        ka.yuanDai = false;
        zt.wangYe.yuanKey = '';
        if (wangYeDangQian() === ka) gengXinWangYeYuan();
      }
    })();
  }
  function gengXinWangYeYuan() {
    const ka = wangYeDangQian();
    const n = wangYeFenLanShu();
    const yuan = el('wangYeYuan');
    if (!yuan) return;
    if (!n) { yuan.hidden = true; return; }
    yuan.hidden = false;
    const ta = el('wangYeYuanWen');
    const ke = !!(ka && ka.keBianJi);
    const yuanKey = ka
      ? (ka.shiBenDi
        ? 'b:' + String(ka.luJing || '')
        : 'r:' + String(ka.url || '') + ':' + String(ka.yuanUrl || '') + ':'
          + (ka.yuanDai ? 'd' : '') + ':' + String(ka.yuanErr || ''))
      : '';
    if (zt.wangYe.yuanKa !== ka || zt.wangYe.yuanKey !== yuanKey) {
      zt.wangYe.yuanKa = ka;
      zt.wangYe.yuanKey = yuanKey;
      if (!ka) ta.value = '';
      else if (ka.shiBenDi) ta.value = String(ka.yuan ?? '');
      else if (ka.yuan != null) ta.value = ka.yuan;
      else if (ka.yuanErr) ta.value = '读取网页源码失败：' + ka.yuanErr;
      else ta.value = '正在读取网页源码…';
      ta.scrollTop = 0;
      zt.wangYe.souCi = '';
      el('yuanSouRu').value = '';
    }
    ta.readOnly = !ke;
    ta.wrap = zt.wangYe.huanHangKai === false ? 'off' : 'soft';
    ta.style.fontSize = (13 * (zt.wangYe.suoFang || 1)).toFixed(1) + 'px';
    ta.placeholder = ka && ka.shiBenDi
      ? ''
      : '远程网页源码（只读：显示当前页面渲染后的 HTML；可拖动分隔条调整比例）';
    el('yuanSuoFangZhi').textContent = Math.round((zt.wangYe.suoFang || 1) * 100) + '%';
    el('anNiuYuanBaoCun').disabled = !ke;
    el('anNiuYuanBaoCunXia').disabled = !ke;
    el('yuanSouRu').disabled = !ke && !(ka && ka.shiBenDi);
    el('yuanTiHuanRu').disabled = !ke;
    el('anNiuYuanTiHuan').disabled = !ke || !zt.wangYe.souCi;
    el('anNiuYuanHuanHang').classList.toggle('kai', ta.wrap !== 'off');
    el('yuanLeiXing').textContent = ka
      ? (ka.shiBenDi ? (ke ? '本地源码 · 可编辑' : '本地源码 · 只读') : '远程网页 · 只读')
      : '源码';
    if (ka && ka.shiBenDi) { yuanChongXinSouSuo(); }
    else {
      zt.wangYe.souPi = [];
      el('yuanSouJi').textContent = '0/0';
      /** 远程网页第一次打开源码栏：向主进程要渲染后的 HTML（跨域也能拿到） */
      if (ka && ka.url && ka.yuan == null && !ka.yuanDai && !ka.yuanErr) wangYeQingQiuYuan(ka);
    }
    huaWangYeYuanGaoLiang();
  }
  /** 查找结果：textarea 无高亮层，这里只做计数并在跳转时选中 */
  function yuanChongXinSouSuo() {
    const ka = wangYeDangQian();
    const ci = String(el('yuanSouRu').value || '');
    zt.wangYe.souCi = ci;
    zt.wangYe.souPi = [];
    if (ka && ci) {
      const wen = String(ka.yuan || '').toLowerCase();
      const xia = ci.toLowerCase();
      let i = wen.indexOf(xia);
      while (i >= 0 && zt.wangYe.souPi.length < 5000) {
        zt.wangYe.souPi.push({ start: i, end: i + xia.length });
        i = wen.indexOf(xia, i + Math.max(1, xia.length));
      }
    }
    if (zt.wangYe.souWei >= zt.wangYe.souPi.length) zt.wangYe.souWei = 0;
    el('yuanSouJi').textContent = !ci ? '0/0' : (zt.wangYe.souPi.length ? (Math.min(zt.wangYe.souWei + 1, zt.wangYe.souPi.length) + '/' + zt.wangYe.souPi.length) : '0/0');
    el('anNiuYuanTiHuan').disabled = !(ka && ka.keBianJi) || !ci || !zt.wangYe.souPi.length;
    huaWangYeYuanGaoLiang();
  }
  function huaWangYeYuanGaoLiang() {
    // textarea 没有高亮层：滚动到当前命中并选中（只在用户主动查找时调用，避免抢选区）
    const ta = el('wangYeYuanWen');
    const pi = zt.wangYe.souPi[zt.wangYe.souWei];
    if (!ta || !pi || !zt.wangYe.souCi) return;
    try { ta.setSelectionRange(pi.start, pi.end); } catch { /* noop */ }
  }
  function yuanTiaoDao(fang) {
    if (!zt.wangYe.souPi.length) return;
    const n = zt.wangYe.souPi.length;
    zt.wangYe.souWei = (zt.wangYe.souWei + (fang > 0 ? 1 : -1) + n) % n;
    el('yuanSouJi').textContent = (zt.wangYe.souWei + 1) + '/' + n;
    const pi = zt.wangYe.souPi[zt.wangYe.souWei];
    const ta = el('wangYeYuanWen');
    ta.focus();
    try { ta.setSelectionRange(pi.start, pi.end); } catch { /* noop */ }
  }
  function yuanTiHuan() {
    const ka = wangYeDangQian();
    if (!ka || !ka.keBianJi) { zhuangTaiWen('远程网页源码只读，不能替换'); return; }
    const pi = zt.wangYe.souPi[zt.wangYe.souWei];
    if (!pi) return;
    const ta = el('wangYeYuanWen');
    ka.yuan = String(ka.yuan || '').slice(0, pi.start) + String(el('yuanTiHuanRu').value || '') + String(ka.yuan || '').slice(pi.end);
    ta.value = ka.yuan;
    ka.zang = true;
    gengXinBiaoTi();
    huaWangYeTab();
    yuanChongXinSouSuo();
    anPaiWangYeYuLan();
    zhuangTaiWen('已替换 1 处 · ' + TZ.locTime(Date.now()));
  }
  function yuanYuLanShua() {
    const ka = wangYeDangQian();
    if (!ka || !ka.shiBenDi) return;
    huaWangYeYuLan(ka);
  }
  function anPaiWangYeYuLan() {
    if (zt.wangYe.dingShi) clearTimeout(zt.wangYe.dingShi);
    zt.wangYe.dingShi = setTimeout(() => { zt.wangYe.dingShi = null; yuanYuLanShua(); }, 80);
  }
  async function yuanBaoCun() {
    const ka = wangYeDangQian();
    if (!ka || !ka.keBianJi) { tiShiWen('当前标签页不是本窗口的本地网页，不能保存源码。'); return false; }
    let r = null;
    try { r = await window.warmy.nmBaoCun({ id: chuangKouId, wenBen: String(ka.yuan || ''), huanHang: zt.huanHang }); } catch (e) { r = { ok: false, cuo: String((e && e.message) || e) }; }
    if (r && r.ok) {
      ka.zang = false;
      zt.zang = false;
      // 文件模式看到的是同一份内容：同步过去，切回文件预览不会看到旧文本
      if (el('wenBen') && el('wenBen').value !== ka.yuan) {
        el('wenBen').value = ka.yuan;
        duiQiGaoLiang();
        if (zt.souCi) chongXinSouSuo();
      }
      gengXinBiaoTi();
      huaWangYeTab();
      zhuangTaiWen('已保存 · ' + TZ.locTime(Date.now()) + ' · ' + ziJieWen(r.ziJie));
      return true;
    }
    tiShiWen('保存失败：' + ((r && (r.cuo || r.error)) || '未知原因'));
    return false;
  }
  async function yuanLingCunWei() {
    const ka = wangYeDangQian();
    if (!ka || !ka.keBianJi) return;
    let r = null;
    try { r = await window.warmy.nmLingCunWei({ id: chuangKouId, wenBen: String(ka.yuan || ''), huanHang: zt.huanHang, jianYiMing: ka.title || 'page.html' }); } catch (e) { r = { ok: false, cuo: String((e && e.message) || e) }; }
    if (r && r.ok && r.luJing) {
      ka.luJing = r.luJing;
      ka.title = String(r.luJing).split(/[\\/]/).pop() || ka.title;
      ka.shiBenDi = true;
      ka.zang = false;
      zt.luJing = r.luJing;
      zt.ming = ka.title;
      zt.zang = false;
      gengXinBiaoTi();
      gengXinWangYe();
      huaWangYeTab();
      zhuangTaiWen('已另存为 · ' + r.luJing);
    } else if (r && !r.yiQuXiao) {
      tiShiWen('另存为失败：' + ((r && (r.cuo || r.error)) || '未知原因'));
    }
  }
  function kaiYuanBaoCunCaiDan() {
    const ka = wangYeDangQian();
    kaiCaiDan(el('anNiuYuanBaoCunXia'), [
      { label: '另存为', icon: TU_FILE, disabled: !(ka && ka.keBianJi), onClick: () => { void yuanLingCunWei(); } },
      { sep: true },
      { label: '自动保存', check: true, checked: zt.wangYe.ziDong === true, disabled: !(ka && ka.keBianJi), onCheck: (k) => sheWangYeZiDong(k) },
    ], 'yuanSave');
  }
  function sheWangYeZiDong(kai) {
    zt.wangYe.ziDong = !!kai;
    zhuangTaiWen(zt.wangYe.ziDong ? '网站模式：自动保存已开（停手 1.5 秒）' : '网站模式：自动保存已关');
    gongJuCaiDanShuaXin();
  }
  function yuanBianJi() {
    const ka = wangYeDangQian();
    if (!ka || !ka.keBianJi) return;
    ka.yuan = el('wangYeYuanWen').value;
    ka.zang = true;
    gengXinBiaoTi();
    huaWangYeTab();
    if (zt.wangYe.ziDong && zt.wangYe.bao) clearTimeout(zt.wangYe.bao);
    if (zt.wangYe.ziDong) zt.wangYe.bao = setTimeout(() => { void yuanBaoCun(); }, 1500);
    anPaiWangYeYuLan();
  }

  /* 未保存提醒：关闭 / 切换分栏 / 切标签 用同一个 Promise 对话框 */
  function youWeiBaoCun() {
    const ka = wangYeDangQian();
    return !!(ka && ka.keBianJi && ka.zang);
  }
  function wenWangYeBaoCun() {
    if (zt.wangYe.wenDai) { try { zt.wangYe.wenDai(null); } catch { /* 旧对话框被新请求顶掉 */ } }
    return new Promise((resolve) => {
      zt.wangYe.wenDai = resolve;
      el('wangYeWeiBaoCun').hidden = false;
      setTimeout(() => { try { el('anNiuWangYeSaveJiXu').focus(); } catch { /* noop */ } }, 0);
    });
  }
  function jieShuWangYeWen(zhi) {
    const fn = zt.wangYe.wenDai;
    zt.wangYe.wenDai = null;
    el('wangYeWeiBaoCun').hidden = true;
    if (fn) fn(zhi);
  }
  async function zhunBeiQieHuanWangYe() {
    if (!youWeiBaoCun()) return true;
    const jie = await wenWangYeBaoCun();
    if (jie === 'save') return await yuanBaoCun();
    if (jie === 'discard') {
      const ka = wangYeDangQian();
      if (ka) ka.zang = false;
      gengXinBiaoTi();
      huaWangYeTab();
      return true;
    }
    return false;
  }

  function kaiFenLan(lei) {
    zt.fenLan = lei;
    zt.fenLanZuoShou = false;
    zt.fenLanYouShou = false;
    el('neiRongHang').classList.remove('zuoShou', 'youShou');
    el('yuLanLie').hidden = false;
    el('fenGeTiao').hidden = false;
    el('yuLanLei').textContent = lei === 'svg' ? 'SVG 效果' : lei === 'html' ? 'HTML 效果' : 'Markdown 效果';
    yingYongFenLanBi();
    gengXinYuLan();
    gengXinXiTongAnNiu();
  }
  function guanFenLan() {
    zt.fenLan = null;
    zt.fenLanZuoShou = false;
    zt.fenLanYouShou = false;
    el('neiRongHang').classList.remove('zuoShou', 'youShou');
    el('yuLanLie').hidden = true;
    el('fenGeTiao').hidden = true;
    el('juanCuo').style.flex = '';
    el('yuLanNei').innerHTML = '';
    gengXinXiTongAnNiu();
  }
  function yingYongFenLanBi() {
    if (!zt.fenLan) return;
    const pct = Math.max(20, Math.min(80, zt.fenLanBi * 100));
    el('juanCuo').style.flex = '0 0 ' + pct.toFixed(2) + '%';
    el('yuLanLie').style.flex = '1 1 0';
  }
  /** 两侧收起（第 78 轮项 18）：任何一侧收起都只剩另一侧；两侧都收起就留空白 + 分隔条按钮 */
  function sheFenLanShou(bian, kai) {
    if (!zt.fenLan) return;
    if (bian === 'zuo') zt.fenLanZuoShou = !!kai;
    else zt.fenLanYouShou = !!kai;
    el('neiRongHang').classList.toggle('zuoShou', zt.fenLanZuoShou);
    el('neiRongHang').classList.toggle('youShou', zt.fenLanYouShou);
    el('anNiuShouZuo').title = zt.fenLanZuoShou ? '展开源码' : '收起源码（只留预览）';
    el('anNiuShouYou').title = zt.fenLanYouShou ? '展开预览' : '收起预览（只留源码）';
    el('juanCuo').style.display = '';
    el('yuLanLie').style.display = '';
    if (!zt.fenLanZuoShou && !zt.fenLanYouShou) {
      yingYongFenLanBi();
    } else {
      /**
       * 第 97 轮项 10：只收起一侧时，**留下的一侧必须铺满**。
       * 以前预览收起后 #juanCuo 仍保留 62% 的 flex，右侧 38% 就成了空白 —— 用户看到的正是"文档不见了、只剩空白"。
       */
      el('juanCuo').style.flex = zt.fenLanYouShou ? '1 1 0' : '0 0 62%';
      el('yuLanLie').style.flex = '1 1 0';
    }
    zhuangTaiWen(zt.fenLanZuoShou || zt.fenLanYouShou ? '分栏已收起一侧（点分隔条上的箭头恢复）' : '分栏已展开');
  }
  function gengXinYuLan() {
    if (!zt.fenLan) return;
    const wen = el('wenBen').value;
    const nei = el('yuLanNei');
    if (zt.fenLan === 'svg') {
      let img = nei.querySelector('img.yuLanTu');
      let cuo = nei.querySelector('.yuLanCuo');
      if (!img) {
        nei.innerHTML = '<img class="yuLanTu" alt="SVG 效果预览" draggable="false"/><div class="yuLanCuo" hidden></div>';
        img = nei.querySelector('img.yuLanTu');
        cuo = nei.querySelector('.yuLanCuo');
        img.addEventListener('error', () => { if (cuo) { cuo.hidden = false; cuo.textContent = 'SVG 语法或内容有错，效果区渲染不出来；源码仍可编辑、保存。'; } });
      }
      if (cuo) cuo.hidden = true;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wen);
      return;
    }
    let f = nei.querySelector('iframe');
    if (!f) {
      // sandbox 里只放 allow-same-origin：不放开脚本（预览不执行用户 HTML 的 JS），
      // 但保留同源让 srcdoc 能正常排版/绘制；否则在这个页面的 CSP 下会是一块白板。
      nei.innerHTML = '<iframe sandbox="allow-same-origin" title="效果预览"></iframe>';
      f = nei.querySelector('iframe');
    }
    const yang = '<style>html,body{margin:0}body{padding:16px;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-size:14px;line-height:1.65;color:#1b1b1b;background:#fff}img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:break-word;background:#f6f6f6;padding:10px;border-radius:6px}code{font-family:Consolas,monospace;font-size:13px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}blockquote{margin:0 0 1em;padding-left:12px;border-left:3px solid #ddd;color:#555}a{color:#8a5a3c}</style>';
    f.srcdoc = '<!doctype html><html><head><meta charset="utf-8">' + yang + '</head><body>'
      + (zt.fenLan === 'md' ? markdownToHtml(wen) : wen) + '</body></html>';
  }
  function anPaiYuLan() {
    if (!zt.fenLan) return;
    if (anPaiYuLan.ding) clearTimeout(anPaiYuLan.ding);
    anPaiYuLan.ding = setTimeout(gengXinYuLan, 320);
  }
  function markdownToHtml(src) {
    const lines = String(src || '').split(/\r?\n/);
    let out = '';
    let list = '';
    let code = null;
    const inline = (s) => {
      let x = escapeHtml(s);
      x = x.replace(/`([^`]+)`/g, '<code>$1</code>');
      x = x.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      x = x.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
      x = x.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
      return x;
    };
    const closeList = () => { if (list) { out += '<ul>' + list + '</ul>'; list = ''; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (/^```/.test(line)) {
        if (code === null) { closeList(); code = []; }
        else { out += '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>'; code = null; }
        continue;
      }
      if (code !== null) { code.push(raw); continue; }
      if (!line.trim()) { closeList(); continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { closeList(); out += '<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'; continue; }
      if (/^>\s?/.test(line)) { closeList(); out += '<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'; continue; }
      if (/^\s*[-*+]\s+/.test(line)) { list += '<li>' + inline(line.replace(/^\s*[-*+]\s+/, '')) + '</li>'; continue; }
      if (/^\s*\d+\.\s+/.test(line)) { list += '<li>' + inline(line.replace(/^\s*\d+\.\s+/, '')) + '</li>'; continue; }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { closeList(); out += '<hr>'; continue; }
      closeList();
      out += '<p>' + inline(line) + '</p>';
    }
    if (code !== null) out += '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>';
    closeList();
    return out;
  }

  /* ── 二进制：虚拟十六进制视图（项 32/33） ────────────────
   * 设计取舍：
   *  · 不把整文件搬进页面（16MB 的 hex 文本 ≈ 70MB，滚动必卡）；
   *  · 主进程按 256KB 块供字节，页面只画可见的几十行；
   *  · 编辑只记 `offset → byte` 增量，保存时主进程校验 SHA-256 后原子写 + 备份；
   *  · 滚动/尺寸变化一律 rAF 合并，不做"每次 scroll 重建整页 DOM"。
   */
  function shiLiuHuanCun(offset) {
    const s = zt.shiLiu;
    if (!s) return null;
    if (s.bianGeng.has(offset)) return s.bianGeng.get(offset);
    const kuai = Math.floor(offset / SHI_LIU_KUAI);
    const buf = s.huanCun.get(kuai);
    return buf ? buf[offset - kuai * SHI_LIU_KUAI] : null;
  }

  function baoZhengShiLiuKuai(kuai) {
    const s = zt.shiLiu;
    if (!s || kuai < 0) return;
    if (s.huanCun.has(kuai) || s.qingQiu.has(kuai)) return;
    s.qingQiu.add(kuai);
    Promise.resolve(window.warmy.nmQuZiJie?.({
      id: chuangKouId,
      offset: kuai * SHI_LIU_KUAI,
      length: SHI_LIU_KUAI,
    })).then((r) => {
      if (!zt.shiLiu || zt.shiLiu !== s) return;
      s.qingQiu.delete(kuai);
      if (!r || r.ok === false || !r.bytes) return;
      try {
        const bin = atob(String(r.bytes));
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
        s.huanCun.set(kuai, buf);
        huiShiLiu(true);
      } catch { /* 坏块就当还没加载 */ }
    }).catch(() => { s.qingQiu.delete(kuai); });
  }

  function xuanRanShiLiu(r) {
    xianShi('hex');
    const er = r.erJinZhi || {};
    const ziJie = Number(r.ziJie) || 0;
    const hangShu = Math.ceil(ziJie / SHI_LIU_MEI_HANG);
    zt.shiLiu = {
      ziJie,
      hangShu,
      sha256: String(er.sha256 || ''),
      keBianJi: !!er.keBianJi,
      huanCun: new Map(),
      qingQiu: new Set(),
      bianGeng: new Map(),
      xuanZhong: 0,
      pool: [],
      cuo: '',
    };
    el('shiLiuNei').style.height = Math.max(0, hangShu * SHI_LIU_HANG_GAO) + 'px';
    el('shiLiuGunDong').scrollTop = 0;
    el('shiLiuGunDong').scrollLeft = 0;
    el('shiLiuShuRu').hidden = true;
    el('shiLiuXinXi').textContent = zt.keBianJi ? '十六进制 · 可编辑' : '十六进制 · 只读';
    el('shiLiuXuanZhong').textContent = zt.keBianJi
      ? '点字节后输入两位十六进制；Ctrl+S 保存（自动备份）'
      : '只读（不可写或超过编辑上限）';
    huiShiLiu(true);
    const lei = zt.keBianJi ? '可编辑' : '只读';
    zhuangTaiWen(['二进制', ziJieWen(ziJie), hangShu + ' 行', lei].join(' · '));
    try { yingYongShiTu(); } catch { /* 十六进制布局刚建立 */ }
  }

  const anPaiHuiShiLiu = anPaiZhen(() => {
    try { huiShiLiu(); } catch { /* 滚动期间算错不打断用户 */ }
  });

  function huiShiLiu(qiangZhi) {
    const s = zt.shiLiu;
    const gun = el('shiLiuGunDong');
    if (!s || el('shiLiuLie').hidden) return;
    // 十六进制行被 transform 缩放后，scrollTop/clientHeight 是视觉像素；换算回逻辑行高
    const bili = zt.suoFang > 0 ? zt.suoFang : 1;
    const hangGao = SHI_LIU_HANG_GAO * bili;
    const start = Math.max(0, Math.floor(gun.scrollTop / hangGao) - SHI_LIU_YU_RE);
    const keJian = Math.ceil(gun.clientHeight / hangGao) + SHI_LIU_YU_RE * 2;
    const count = Math.max(1, Math.min(keJian, s.hangShu - start));
    /**
     * 滚动发生在同一行以内时不重画（行是绝对定位，滚动本身已经把内容带上去）。
     * 只有跨行、尺寸变化、字节/选中变化才需要更新 DOM —— 这是不卡的关键。
     */
    if (!qiangZhi && s.shangCiStart === start && s.shangCiCount === count) {
      gengXinShiLiuXuanZhong();
      return;
    }
    s.shangCiStart = start;
    s.shangCiCount = count;
    // 预取可见范围 + 前后各一块
    const di = Math.max(0, Math.floor((start * SHI_LIU_MEI_HANG) / SHI_LIU_KUAI) - 1);
    const gao = Math.min(
      Math.floor(((start + count) * SHI_LIU_MEI_HANG) / SHI_LIU_KUAI) + 1,
      Math.max(0, Math.ceil(s.ziJie / SHI_LIU_KUAI) - 1),
    );
    for (let k = di; k <= gao; k += 1) baoZhengShiLiuKuai(k);

    const nei = el('shiLiuNei');
    while (s.pool.length < count) {
      const hang = document.createElement('div');
      hang.className = 'shiLiuHang';
      const pian = document.createElement('span');
      pian.className = 'shiLiuPian';
      const hex = document.createElement('span');
      hex.className = 'shiLiuHex';
      const ascii = document.createElement('span');
      ascii.className = 'shiLiuAscii';
      for (let i = 0; i < SHI_LIU_MEI_HANG; i += 1) {
        const hs = document.createElement('span');
        hs.dataset.i = String(i);
        hex.appendChild(hs);
        const as = document.createElement('span');
        as.dataset.i = String(i);
        ascii.appendChild(as);
        if (i < SHI_LIU_MEI_HANG - 1) {
          const kong = document.createTextNode(' ');
          hex.appendChild(kong);
        }
      }
      hang.appendChild(pian);
      hang.appendChild(hex);
      hang.appendChild(ascii);
      nei.appendChild(hang);
      s.pool.push({ hang, pian, hex, ascii });
    }
    for (let i = 0; i < s.pool.length; i += 1) {
      const row = s.pool[i];
      const hangIndex = start + i;
      const keYong = i < count && hangIndex < s.hangShu;
      row.hang.hidden = !keYong;
      if (!keYong) continue;
      row.hang.style.top = (hangIndex * SHI_LIU_HANG_GAO) + 'px';
      row.hang.dataset.hang = String(hangIndex);
      row.pian.textContent = shiLiuWen(hangIndex * SHI_LIU_MEI_HANG);
      const base = hangIndex * SHI_LIU_MEI_HANG;
      for (let j = 0; j < SHI_LIU_MEI_HANG; j += 1) {
        const off = base + j;
        const hs = row.hex.children[j];
        const as = row.ascii.children[j];
        if (!hs || !as) continue;
        if (off >= s.ziJie) {
          hs.textContent = '  ';
          as.textContent = ' ';
          hs.className = '';
          as.className = '';
          delete hs.dataset.off;
          delete as.dataset.off;
          continue;
        }
        hs.dataset.off = String(off);
        as.dataset.off = String(off);
        const b = shiLiuHuanCun(off);
        const gai = s.bianGeng.has(off);
        const xuan = off === s.xuanZhong;
        hs.textContent = b == null ? '··' : b.toString(16).toUpperCase().padStart(2, '0');
        as.textContent = b == null ? ' ' : ziJieWenASCII(b);
        hs.className = (gai ? 'gai ' : '') + (xuan ? 'xuan' : '');
        as.className = (gai ? 'gai ' : '') + (xuan ? 'xuan' : '');
      }
    }
    gengXinShiLiuXuanZhong();
  }

  function shiLiuDingWei(off) {
    const s = zt.shiLiu;
    if (!s) return;
    const x = Math.max(0, Math.min(s.ziJie - 1, Math.floor(Number(off) || 0)));
    s.xuanZhong = x;
    const hang = Math.floor(x / SHI_LIU_MEI_HANG);
    const gun = el('shiLiuGunDong');
    const bili = zt.suoFang > 0 ? zt.suoFang : 1;
    const top = hang * SHI_LIU_HANG_GAO * bili;
    if (top < gun.scrollTop || top + SHI_LIU_HANG_GAO * bili > gun.scrollTop + gun.clientHeight) {
      gun.scrollTop = Math.max(0, top - gun.clientHeight / 2);
    }
    huiShiLiu(true);
    gengXinShiLiuXuanZhong();
  }

  function gengXinShiLiuXuanZhong() {
    const s = zt.shiLiu;
    if (!s) return;
    const off = s.xuanZhong;
    const b = shiLiuHuanCun(off);
    el('shiLiuXuanZhong').textContent = s.ziJie
      ? `选中 0x${shiLiuWen(off)}（${off} / ${s.ziJie}）${b == null ? '' : ' · 0x' + b.toString(16).toUpperCase().padStart(2, '0')}`
      : '空文件';
  }

  function kaiShiLiuShuRu() {
    const s = zt.shiLiu;
    const shu = el('shiLiuShuRu');
    if (!s || !s.keBianJi) { zhuangTaiWen('这个二进制文件是只读的，不能改字节'); return; }
    const hang = Math.floor(s.xuanZhong / SHI_LIU_MEI_HANG);
    const row = s.pool.find((x) => Number(x.hang.dataset.hang) === hang);
    if (!row) return;
    const j = s.xuanZhong - hang * SHI_LIU_MEI_HANG;
    const hs = row.hex.children[j];
    if (!hs) return;
    const kuang = el('shiLiuGunDong').getBoundingClientRect();
    const r = hs.getBoundingClientRect();
    shu.hidden = false;
    shu.style.left = (r.left - kuang.left + el('shiLiuGunDong').scrollLeft - 2) + 'px';
    shu.style.top = (r.top - kuang.top + el('shiLiuGunDong').scrollTop - 3) + 'px';
    shu.value = '';
    /** 第 97 轮项 5：空输入框用「原内容」当提示（当前字节的两位十六进制），避免看起来像被清空了 */
    const yuanZiJie = shiLiuHuanCun(s.xuanZhong);
    shu.placeholder = yuanZiJie == null ? '??' : yuanZiJie.toString(16).toUpperCase().padStart(2, '0');
    shu.title = yuanZiJie == null ? '原内容未知' : '原内容：' + shu.placeholder;
    try { shu.focus({ preventScroll: true }); } catch { shu.focus(); }
  }

  function gaiShiLiuZiJie(off, value) {
    const s = zt.shiLiu;
    if (!s || !s.keBianJi) return;
    const yuan = shiLiuHuanCun(off);
    if (yuan === value) s.bianGeng.delete(off);
    else s.bianGeng.set(off, value);
    zt.zang = s.bianGeng.size > 0;
    gengXinBiaoTi();
    // 自动保存：停手 2 秒（与文本一致）
    if (zt.ziDong !== false && !el('gouZiDongBaoCun').disabled && el('gouZiDongBaoCun').checked) {
      if (gaiShiLiuZiJie.bao) clearTimeout(gaiShiLiuZiJie.bao);
      gaiShiLiuZiJie.bao = setTimeout(() => { void baoCun(); }, 2000);
    }
    huiShiLiu(true);
  }

  /* ── 只读文档 ─────────────────────────────────────────── */
  function xuanRanKuai(r) {
    xianShi('kuai');
    const biaoQian = { docx: 'Word 文档', xlsx: 'Excel 表格', pptx: 'PowerPoint 演示', pdf: 'PDF 文档', binary: '二进制文件' };
    if (!zt.kuai.length && typeof r.wenBen === 'string') zt.kuai = [{ biaoTi: '正文', wenBen: r.wenBen }];
    huaKuai();
    zhuangTaiWen([biaoQian[zt.leiXing] || zt.leiXing, ziJieWen(zt.ziJie), '只读'].join(' · '));
    try { yingYongShiTu(); } catch { /* 文档刚重建，下一帧再量 */ }
  }

  function huaKuai() {
    const lie = el('kuaiNei');
    lie.innerHTML = '';
    if (!zt.kuai.length) {
      const kong = document.createElement('div');
      kong.className = 'kuaiKong';
      kong.textContent = '没有可预览的内容。';
      lie.appendChild(kong);
      return;
    }
    if (zt.leiXing === 'xlsx') { huaXlsx(lie); return; }
    if (zt.leiXing === 'pptx') { huaPptx(lie); return; }
    if (zt.leiXing === 'docx' || zt.leiXing === 'pdf') { huaDoc(lie); return; }
    huaPuTong(lie);
  }

  /** 纯文本 / 二进制：一段一个 <pre>（二进制仍有十六进制，不冒充正文） */
  function huaPuTong(lie) {
    zt.kuai.forEach((k, bi) => {
      const kuang = document.createElement('div');
      kuang.className = 'kuai';
      const biao = document.createElement('div');
      biao.className = 'kuaiBiaoTi';
      biao.textContent = k.biaoTi || '';
      const pre = document.createElement('pre');
      pre.className = 'kuaiWen';
      pre.innerHTML = huaWenBenPian(k.wenBen || '', bi, 0);
      kuang.appendChild(biao);
      kuang.appendChild(pre);
      lie.appendChild(kuang);
    });
  }

  /** DOCX / PDF：纸张式预览页（段落来源是主进程已经抽好的正文） */
  function huaDoc(lie) {
    zt.kuai.forEach((k, bi) => {
      const kuang = document.createElement('div');
      kuang.className = 'kuai';
      const ye = document.createElement('div');
      ye.className = 'docYe';
      const hao = document.createElement('div');
      hao.className = 'docYeHao';
      hao.textContent = [k.biaoTi || zt.ming, zt.ming, zt.ziJie ? ziJieWen(zt.ziJie) : ''].filter(Boolean).join(' · ');
      const body = document.createElement('div');
      body.className = 'docWen';
      const lines = String(k.wenBen || '').split('\n');
      const cap = Math.min(lines.length, 6000);
      // 主进程抽 DOCX 时按 <w:t> 拼接，一个段落里的多个 run 会各占一行。
      // 这里按句末标点/空行把相邻 run 合回段落（PDF 的行是版面行，不合并）。
      const segs = [];
      let pos = 0;
      for (let i = 0; i < cap; i += 1) {
        const line = lines[i] || '';
        segs.push({ t: line, s: pos });
        pos += line.length + 1;
      }
      const duanLuo = [];
      if (zt.leiXing === 'docx') {
        let cur = [];
        segs.forEach((seg) => {
          if (!seg.t.trim()) { if (cur.length) duanLuo.push(cur); cur = []; duanLuo.push(null); return; }
          cur.push(seg);
          if (/[。！？!?；;]$/.test(seg.t.trim())) { duanLuo.push(cur); cur = []; }
        });
        if (cur.length) duanLuo.push(cur);
      } else {
        segs.forEach((seg) => { if (seg.t.trim()) duanLuo.push([seg]); else if (duanLuo.length) duanLuo.push(null); });
      }
      let youWen = false;
      const yaoKong = (a, b) => /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
      duanLuo.forEach((zu) => {
        const p = document.createElement('p');
        if (!zu) { body.appendChild(p); return; }
        let html = '';
        let prev = '';
        zu.forEach((seg) => {
          if (prev && yaoKong(prev, seg.t)) html += ' ';
          html += huaWenBenPian(seg.t, bi, seg.s);
          prev = seg.t;
        });
        p.innerHTML = html;
        if (zu.some((seg) => seg.t.trim())) youWen = true;
        body.appendChild(p);
      });
      if (!youWen) {
        const p = document.createElement('p');
        p.className = 'docKong';
        p.textContent = '（这份文档没有可抽取的正文：可能是扫描件，或内容都在图片里。）';
        body.appendChild(p);
      }
      ye.appendChild(hao);
      ye.appendChild(body);
      kuang.appendChild(ye);
      lie.appendChild(kuang);
    });
  }

  /** PPTX：每页一张 16:9 幻灯片（文字版式；不伪造图片/动画） */
  function huaPptx(lie) {
    const ding = document.createElement('div');
    ding.className = 'kuaiBiaoTi';
    ding.textContent = (zt.ming || '演示文稿') + ' · 共 ' + zt.kuai.length + ' 页 · 文字版式预览';
    lie.appendChild(ding);
    const wrap = document.createElement('div');
    wrap.className = 'pptLie';
    zt.kuai.forEach((k, bi) => {
      const ye = document.createElement('div');
      ye.className = 'pptYe';
      const body = document.createElement('div');
      body.className = 'pptWen';
      const lines = String(k.wenBen || '').split('\n');
      let pos = 0;
      let first = true;
      let youWen = false;
      lines.forEach((line) => {
        if (line.trim()) {
          youWen = true;
          const p = document.createElement(first ? 'h3' : 'p');
          p.innerHTML = huaWenBenPian(line, bi, pos);
          body.appendChild(p);
          first = false;
        } else if (!first) {
          const p = document.createElement('p');
          p.innerHTML = '';
          body.appendChild(p);
        }
        pos += line.length + 1;
      });
      if (!youWen) {
        const p = document.createElement('p');
        p.className = 'docKong';
        p.textContent = '（这一页没有可抽取的文字。）';
        body.appendChild(p);
      }
      const hao = document.createElement('div');
      hao.className = 'pptYeHao';
      hao.textContent = '第 ' + (bi + 1) + ' 页 / ' + zt.kuai.length;
      ye.appendChild(body);
      ye.appendChild(hao);
      wrap.appendChild(ye);
    });
    lie.appendChild(wrap);
  }

  /** XLSX：把主进程已经抽好的制表符正文还原成表格（表头、行号、横向滚动） */
  function huaXlsx(lie) {
    const MAX_HANG = 3000;
    const MAX_LIE = 200;
    zt.kuai.forEach((k, bi) => {
      const kuang = document.createElement('div');
      kuang.className = 'kuai xlsxKuai';
      const biao = document.createElement('div');
      biao.className = 'kuaiBiaoTi';
      biao.textContent = k.biaoTi || '';
      const wai = document.createElement('div');
      wai.className = 'biaoGeWai';
      const rows = String(k.wenBen || '').split('\n');
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const tbody = document.createElement('tbody');
      let rowStart = 0;
      let maxLie = 0;
      const cut = rows.slice(0, MAX_HANG);
      cut.forEach((row) => { maxLie = Math.max(maxLie, Math.min(MAX_LIE, row.split('\t').length)); });
      maxLie = Math.max(1, maxLie);
      cut.forEach((line, ri) => {
        const cells = line.split('\t');
        const tr = document.createElement('tr');
        const hao = document.createElement(ri === 0 ? 'th' : 'td');
        hao.className = 'hao';
        hao.textContent = ri === 0 ? '#' : String(ri + 1);
        tr.appendChild(hao);
        let cellStart = rowStart;
        for (let ci = 0; ci < maxLie; ci += 1) {
          const cell = cells[ci] || '';
          const td = document.createElement(ri === 0 ? 'th' : 'td');
          td.innerHTML = huaWenBenPian(cell, bi, cellStart);
          if (cell) td.title = cell;
          tr.appendChild(td);
          cellStart += cell.length + 1;
        }
        (ri === 0 ? thead : tbody).appendChild(tr);
        rowStart += line.length + 1;
      });
      table.appendChild(thead);
      table.appendChild(tbody);
      wai.appendChild(table);
      kuang.appendChild(biao);
      kuang.appendChild(wai);
      if (rows.length > MAX_HANG) {
        const note = document.createElement('div');
        note.className = 'kuaiBiaoTi';
        note.textContent = '只预览前 ' + MAX_HANG + ' 行（共 ' + rows.length + ' 行）；查找仍按已抽取的正文生效。';
        kuang.appendChild(note);
      }
      lie.appendChild(kuang);
    });
  }

  /* ── 媒体 ─────────────────────────────────────────────── */
  function xuanRanMeiTi(r) {
    xianShi('meiTi');
    const lie = el('meiTiLie');
    lie.innerHTML = '';
    const url = String(r.meiTiUrl || '');
    if (zt.leiXing === 'image') {
      const he = document.createElement('div');
      he.className = 'meiTiHe tuPianHe';
      const img = document.createElement('img');
      img.alt = zt.ming;
      img.src = url;
      img.draggable = false;
      img.addEventListener('error', () => {
        tiShiWen('这张图片系统解不出来（' + (r.mime || '未知格式') + '）。文件可能损坏，或编码不在浏览器支持范围。');
      });
      he.appendChild(img);
      he.addEventListener('dblclick', () => { void qieHuanQuanPing(img); });
      lie.appendChild(he);
    } else if (zt.leiXing === 'audio') {
      lie.appendChild(zaoYinPin(r, url));
    } else {
      lie.appendChild(zaoShiPin(r, url));
    }
    const lei = { image: '图片', audio: '音频', video: '视频' }[zt.leiXing] || '媒体';
    zhuangTaiWen([lei, r.mime || '', ziJieWen(zt.ziJie), '只读'].filter(Boolean).join(' · '));
    try { yingYongShiTu(); } catch { /* 图片还没布局完时下一次 resize 会补 */ }
  }

  function shiJianWen(miao) {
    const s = Math.max(0, Math.floor(Number(miao) || 0));
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    const h = Math.floor(m / 60);
    return (h ? h + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + ss;
  }

  function jieXiGeQu(ming) {
    const base = String(ming || '').replace(/\.[^.]+$/, '');
    const parts = base.split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 3) return { yiShu: parts[0], zhuanJi: parts[1], geMing: parts.slice(2).join(' - ') };
    if (parts.length === 2) return { yiShu: parts[0], geMing: parts[1] };
    return { geMing: base };
  }

  const YIN_PIN_SU_DU = [0.1, 0.2, 0.5, 1, 1.5, 2, 2.5, 3, 5];
  function zaoYinPin(r, url) {
    const he = document.createElement('div');
    he.className = 'meiTiHe yinPinHe';
    const ge = jieXiGeQu(zt.ming);
    const heGe = (zt.ming.split('.').pop() || '').toUpperCase();
    // 第 81 轮项 6：去掉「音乐 · 只读」标签与静音按钮，加 0.1–5 倍速
    he.innerHTML = [
      '<div class="yinPinJinDuKuai">',
      '  <div class="geQuMing" title=""></div>',
      '  <div class="jinDu" role="slider" aria-label="播放进度" tabindex="0"><div class="jinDuDi"></div><div class="jinDuTian"></div><div class="jinDuHuaDian"></div></div>',
      '</div>',
      '<div class="yinPinKongZhi"><button class="boFang">播放</button><span class="shiJian">0:00 / 0:00</span>',
      '  <label class="suDu">倍速<select class="suDuXuan" aria-label="播放速度">',
      YIN_PIN_SU_DU.map((x) => '<option value="' + x + '"' + (x === 1 ? ' selected' : '') + '>' + x + '×</option>').join(''),
      '  </select></label></div>',
      '<details class="geQuXiangQing"><summary>详情（格式 / 大小' + (ge.yiShu || ge.zhuanJi ? ' / 名称识别' : '') + '）</summary><div class="geQuXiangQingNei"></div></details>',
    ].join('');
    const mingHe = he.querySelector('.geQuMing');
    mingHe.textContent = ge.geMing || zt.ming;
    mingHe.title = zt.ming;
    const xiang = he.querySelector('.geQuXiangQingNei');
    const jia = (k, v) => {
      const b = document.createElement('b'); b.textContent = k;
      const s = document.createElement('span'); s.textContent = v;
      xiang.appendChild(b); xiang.appendChild(s);
    };
    jia('格式', heGe || (r.mime || '未知'));
    jia('大小', ziJieWen(zt.ziJie));
    jia('文件名', zt.ming);
    if (ge.yiShu) jia('艺人', ge.yiShu + '（从文件名识别）');
    if (ge.zhuanJi) jia('专辑', ge.zhuanJi + '（从文件名识别）');

    const audio = document.createElement('audio');
    audio.src = url;
    audio.preload = 'metadata';
    he.appendChild(audio);
    const jd = he.querySelector('.jinDu');
    const tian = he.querySelector('.jinDuTian');
    const dian = he.querySelector('.jinDuHuaDian');
    const boFang = he.querySelector('.boFang');
    const shiJian = he.querySelector('.shiJian');
    const suDu = he.querySelector('.suDuXuan');
    const geng = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      const p = d ? Math.min(1, audio.currentTime / d) : 0;
      tian.style.width = (p * 100) + '%';
      dian.style.left = (p * 100) + '%';
      shiJian.textContent = shiJianWen(audio.currentTime) + ' / ' + shiJianWen(d);
    };
    const xun = (ev) => {
      const box = jd.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (ev.clientX - box.left) / Math.max(1, box.width)));
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        try { audio.currentTime = p * audio.duration; } catch { /* 忽略 */ }
      }
      geng();
    };
    jd.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try { jd.setPointerCapture(ev.pointerId); } catch { /* 忽略 */ }
      xun(ev);
    });
    jd.addEventListener('pointermove', (ev) => { if (ev.buttons) xun(ev); });
    boFang.addEventListener('click', () => {
      if (audio.paused) void audio.play().catch(() => zhuangTaiWen('播放失败：这个音频格式系统解不出来'));
      else audio.pause();
    });
    suDu.addEventListener('change', () => {
      const v = Number(suDu.value) || 1;
      try { audio.playbackRate = v; } catch { /* 忽略 */ }
      zhuangTaiWen('播放速度 · ' + v + '×');
    });
    audio.addEventListener('play', () => { boFang.textContent = '暂停'; });
    audio.addEventListener('pause', () => { boFang.textContent = '播放'; });
    audio.addEventListener('timeupdate', geng);
    audio.addEventListener('loadedmetadata', geng);
    audio.addEventListener('durationchange', geng);
    audio.addEventListener('ended', () => { boFang.textContent = '播放'; geng(); });
    audio.addEventListener('error', () => {
      tiShiWen('这个音频格式系统解不出来（' + (r.mime || heGe || '未知') + '）。文件可能损坏。');
      zhuangTaiWen('音频加载失败 · ' + zt.ming);
    });
    geng();
    return he;
  }

  function zaoShiPin(r, url) {
    const he = document.createElement('div');
    he.className = 'meiTiHe shiPinHe';
    he.innerHTML = [
      '<video preload="metadata" playsinline></video>',
      '<div class="shiPinKongZhi">',
      '  <button class="boFang" title="播放 / 暂停">播放</button>',
      '  <div class="jinDu" role="slider" aria-label="播放进度" tabindex="0"><div class="jinDuDi"></div><div class="jinDuTian"></div><div class="jinDuHuaDian"></div></div>',
      '  <span class="shiJian">0:00 / 0:00</span>',
      '  <button class="jingYin" title="静音 / 取消静音">静音</button>',
      '  <button class="quanPing" title="全屏 / 恢复（也可以双击视频）">全屏</button>',
      '</div>',
    ].join('');
    const v = he.querySelector('video');
    v.src = url;
    const jd = he.querySelector('.jinDu');
    const tian = he.querySelector('.jinDuTian');
    const dian = he.querySelector('.jinDuHuaDian');
    const boFang = he.querySelector('.boFang');
    const shiJian = he.querySelector('.shiJian');
    const jingYin = he.querySelector('.jingYin');
    const quan = he.querySelector('.quanPing');
    const geng = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      const p = d ? Math.min(1, v.currentTime / d) : 0;
      tian.style.width = (p * 100) + '%';
      dian.style.left = (p * 100) + '%';
      shiJian.textContent = shiJianWen(v.currentTime) + ' / ' + shiJianWen(d);
    };
    const xun = (ev) => {
      const box = jd.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (ev.clientX - box.left) / Math.max(1, box.width)));
      if (Number.isFinite(v.duration) && v.duration > 0) {
        try { v.currentTime = p * v.duration; } catch { /* 忽略 */ }
      }
      geng();
    };
    jd.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try { jd.setPointerCapture(ev.pointerId); } catch { /* 忽略 */ }
      xun(ev);
    });
    jd.addEventListener('pointermove', (ev) => { if (ev.buttons) xun(ev); });
    boFang.addEventListener('click', () => {
      if (v.paused) void v.play().catch(() => zhuangTaiWen('播放失败：这个视频格式系统解不出来'));
      else v.pause();
    });
    jingYin.addEventListener('click', () => { v.muted = !v.muted; jingYin.textContent = v.muted ? '取消静音' : '静音'; });
    quan.addEventListener('click', () => { void qieHuanQuanPing(he); });
    // 双击视频/播放器空白处全屏；再次双击恢复（按钮上的双击不算）
    he.addEventListener('dblclick', (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest('button')) return;
      void qieHuanQuanPing(he);
    });
    v.addEventListener('play', () => { boFang.textContent = '暂停'; });
    v.addEventListener('pause', () => { boFang.textContent = '播放'; });
    v.addEventListener('timeupdate', geng);
    v.addEventListener('loadedmetadata', geng);
    v.addEventListener('durationchange', geng);
    v.addEventListener('ended', () => { boFang.textContent = '播放'; geng(); });
    v.addEventListener('error', () => {
      tiShiWen('这个视频格式系统解不出来（' + (r.mime || '未知') + '）。文件可能损坏，或编码不在浏览器支持范围。');
      zhuangTaiWen('视频加载失败 · ' + zt.ming);
    });
    geng();
    return he;
  }

  /* ── 全屏（再次双击恢复） ─────────────────────────────── */
  async function qieHuanQuanPing(mu) {
    if (!mu) return;
    const xian = document.fullscreenElement;
    if (xian) {
      try { await document.exitFullscreen(); } catch { /* 忽略 */ }
      if (zt.quanPingEl) { zt.quanPingEl.classList.remove('quanPing'); zt.quanPingEl = null; }
      return;
    }
    if (zt.quanPingEl) {
      zt.quanPingEl.classList.remove('quanPing');
      zt.quanPingEl = null;
      return;
    }
    try {
      await mu.requestFullscreen();
    } catch {
      mu.classList.add('quanPing');
      zt.quanPingEl = mu;
    }
  }

  /* ── 查找 ─────────────────────────────────────────────── */
  function chongXinSouSuo() {
    const ci = String(el('souRu').value || '');
    zt.souCi = ci;
    zt.souPi = [];
    if (!ci) {
      zt.souWei = 0;
      if (zt.leiXing === 'text') huaGaoLiang();
      else if (zt.leiXing !== 'binary') huaKuai();
      el('souJi').textContent = '0/0';
      gengXinSouJi();
      return;
    }
    // 二进制十六进制视图：查找框仍可输入（不 disabled），但不对 16MB 二进制做全文索引
    if (zt.leiXing === 'binary') {
      zt.souWei = 0;
      el('souJi').textContent = '0/0';
      gengXinSouJi();
      zhuangTaiWen('二进制视图：查找不可用；可按字节编辑（只读文件仍可滚动浏览）');
      return;
    }
    const ciXiao = ci.toLowerCase();
    if (zt.leiXing === 'text') {
      const wen = el('wenBen').value.toLowerCase();
      let i = wen.indexOf(ciXiao);
      while (i >= 0 && zt.souPi.length < 5000) {
        zt.souPi.push({ kuai: -1, start: i, end: i + ciXiao.length });
        i = wen.indexOf(ciXiao, i + Math.max(1, ciXiao.length));
      }
    } else {
      zt.kuai.forEach((k, bi) => {
        const wen = String(k.wenBen || '').toLowerCase();
        let i = wen.indexOf(ciXiao);
        while (i >= 0 && zt.souPi.length < 5000) {
          zt.souPi.push({ kuai: bi, start: i, end: i + ciXiao.length });
          i = wen.indexOf(ciXiao, i + Math.max(1, ciXiao.length));
        }
      });
    }
    if (zt.souWei >= zt.souPi.length) zt.souWei = 0;
    if (zt.leiXing === 'text') huaGaoLiang();
    else huaKuai();
    gengXinSouJi();
    tiaoDaoPiPei();
  }

  function gengXinSouJi() {
    const zong = zt.souPi.length;
    const nengTiHuan = !!zt.souCi && zong > 0 && tiHuanKeYong();
    if (el('anNiuTiHuan')) el('anNiuTiHuan').disabled = !nengTiHuan;
    if (el('tiHuanRu')) el('tiHuanRu').disabled = !tiHuanKeYong();
    if (!zt.souCi) { el('souJi').textContent = '0/0'; el('souJi').classList.remove('wuPiPei'); el('souJi').title = '展开 / 收起替换'; return; }
    if (!zong) {
      el('souJi').textContent = '';
      el('souJi').innerHTML = TU_WU_PI_PEI;
      el('souJi').classList.add('wuPiPei');
      el('souJi').title = '无匹配';
      el('souJi').setAttribute('aria-label', '无匹配');
      return;
    }
    el('souJi').classList.remove('wuPiPei');
    el('souJi').textContent = Math.min(zt.souWei + 1, zong) + '/' + zong;
    el('souJi').title = '展开 / 收起替换';
  }

  /** 替换当前匹配：替换后重新查找、并把结果压入历史（可后退回替换前） */
  function tiHuanDangQian() {
    if (!tiHuanKeYong() || !zt.souCi || !zt.souPi.length) return;
    const pi = zt.souPi[zt.souWei];
    if (!pi) return;
    const ta = el('wenBen');
    ta.value = ta.value.slice(0, pi.start) + el('tiHuanRu').value + ta.value.slice(pi.end);
    zt.zang = true;
    gengXinBiaoTi();
    tuiRuLiShi(zt.luJing, ta.value);
    chongXinSouSuo();
    gengXinYuLan();
    zhuangTaiWen('已替换 1 处 · ' + TZ.locTime(Date.now()));
  }

  function huaGaoLiang() {
    const ceng = el('gaoLiangNei');
    const taiDa = el('wenBen').value.length > 300000;
    if (zt.leiXing !== 'text' || !zt.souCi || !zt.souPi.length || taiDa) {
      ceng.innerHTML = '';
      duiQiGaoLiang();
      // 太大就只计数不高亮（高亮要重排整篇，几万字以上会卡），但定位仍然可用
      if (taiDa && zt.souCi && zt.souPi.length) {
        zhuangTaiWen('文件较大：查找只计数、不做高亮；「上一个 / 下一个」仍可定位');
      }
      return;
    }
    const wen = el('wenBen').value;
    let out = '';
    let last = 0;
    zt.souPi.forEach((m, i) => {
      out += escapeHtml(wen.slice(last, m.start));
      out += '<mark class="mingZhong' + (i === zt.souWei ? ' dangQian' : '') + '">' + escapeHtml(wen.slice(m.start, m.end)) + '</mark>';
      last = m.end;
    });
    out += escapeHtml(wen.slice(last));
    ceng.innerHTML = out;
    duiQiGaoLiang();
  }

  function duiQiGaoLiang() {
    const ta = el('wenBen');
    const nei = el('gaoLiangNei');
    // 换行关掉时内容比可视区宽：高亮层要跟 textarea 的**内容宽**一致，否则右端会差一个滚动条宽度
    const kuan = zt.huanHangKai ? Math.max(0, ta.clientWidth) : Math.max(ta.clientWidth, ta.scrollWidth);
    nei.style.width = kuan + 'px';
  }

  function tiaoDaoPiPei() {
    if (!zt.souPi.length || zt.leiXing === 'binary') return;
    if (zt.leiXing === 'text') {
      const ta = el('wenBen');
      const m = el('gaoLiangNei').querySelector('mark.dangQian');
      if (!m) {
        // 超大文件不做高亮（会卡），但"上一个/下一个"照样要能定位：按行号估算滚到哪里
        const pi = zt.souPi[zt.souWei];
        if (!pi) return;
        const hang = (ta.value.slice(0, pi.start).match(/\n/g) || []).length;
        ta.scrollTop = Math.max(0, hang * 13 * 1.55 - ta.clientHeight * 0.4);
        el('gaoLiang').scrollTop = ta.scrollTop;
        el('gaoLiang').scrollLeft = ta.scrollLeft;
        return;
      }
      const y = m.offsetTop;
      ta.scrollTop = Math.max(0, y - ta.clientHeight * 0.4);
      el('gaoLiang').scrollTop = ta.scrollTop;
      el('gaoLiang').scrollLeft = ta.scrollLeft;
      return;
    }
    const mm = el('kuaiLie').querySelector('mark.dangQian');
    if (mm && mm.scrollIntoView) mm.scrollIntoView({ block: 'center' });
  }

  function buJin(fangXiang) {
    if (zt.leiXing === 'binary' || !zt.souCi || !zt.souPi.length) return;
    const n = zt.souPi.length;
    zt.souWei = (zt.souWei + (fangXiang > 0 ? 1 : -1) + n) % n;
    if (zt.leiXing === 'text') huaGaoLiang();
    else huaKuai();
    gengXinSouJi();
    tiaoDaoPiPei();
  }

  /* ── 只读正文里出现的本地路径：点一下在本窗口打开（这也是"后退"的来源） ── */
  const LU_JING_RE = /(?:[A-Za-z]:\\[^\s"'<>|*?\r\n]+|\/(?:[\w.\-]+\/)+[\w.\-]+)/g;
  function lianJieHTML(wen) {
    let out = '';
    let last = 0;
    const re = new RegExp(LU_JING_RE.source, 'g');
    let m = re.exec(wen);
    while (m) {
      const p = m[0];
      if (p.length >= 4) {
        out += escapeHtml(wen.slice(last, m.index));
        out += '<a class="luJing" data-lu="' + escapeHtml(p) + '">' + escapeHtml(p) + '</a>';
        last = m.index + p.length;
      }
      m = re.exec(wen);
    }
    out += escapeHtml(wen.slice(last));
    return out;
  }
  /** 高亮一块正文里的一个片段；start 是这块在 k.wenBen 里的绝对偏移（表格单元格/段落都用） */
  function huaWenBenPian(wen, kuaiIndex, start) {
    const s = String(wen || '');
    const base = Number(start) || 0;
    const youSou = !!zt.souCi;
    const piPei = youSou ? zt.souPi.filter((m) => m.kuai === kuaiIndex && m.start >= base && m.end <= base + s.length) : [];
    if (piPei.length) {
      let out = '';
      let last = base;
      piPei.forEach((m) => {
        out += escapeHtml(s.slice(last - base, m.start - base));
        const dang = zt.souPi[zt.souWei] === m;
        out += '<mark class="mingZhong' + (dang ? ' dangQian' : '') + '">' + escapeHtml(s.slice(m.start - base, m.end - base)) + '</mark>';
        last = m.end;
      });
      out += escapeHtml(s.slice(last - base));
      return out;
    }
    if (youSou) return escapeHtml(s);
    return lianJieHTML(s);
  }
  function kuaiDaoHTML(wen, kuaiIndex) {
    return huaWenBenPian(wen, kuaiIndex, 0);
  }

  /* ── 编辑 / 保存 ──────────────────────────────────────── */
  function yiXiuGai() {
    if (!zt.keBianJi) return;
    /**
     * 聊天框临时编辑模式：**不设脏标记、不自动保存到文件**，只把内容实时回传聊天框。
     * 关闭时 therefore 不会弹“未保存”确认。
     */
    if (zt.chatEditor) {
      if (yiXiuGai.sync) clearTimeout(yiXiuGai.sync);
      yiXiuGai.sync = setTimeout(() => {
        try { void window.warmy.chatEditorSync?.({ content: el('wenBen').value }); } catch { /* noop */ }
      }, 120);
      /**
       * 第 101 轮：聊天编辑器也要有**撤销/后退/前进**。旧代码在这里直接 return，
       * 历史永远只有进入时的那一条 ⇒ 两个按钮全灰。现在按普通编辑同一套防抖压历史；
       * 只压"内容快照"（虚拟路径不变），不写文件、不设脏标记。
       */
      if (yiXiuGai.lishi) clearTimeout(yiXiuGai.lishi);
      yiXiuGai.lishi = setTimeout(() => { tuiRuLiShi(zt.luJing, el('wenBen').value); }, 600);
      anPaiYuLan();
      return;
    }
    if (!zt.zang) { zt.zang = true; gengXinBiaoTi(); }
    /** 改动也进历史（防抖 600ms）：这样后退能回到改动前，后退之后还能前进回来 */
    if (yiXiuGai.lishi) clearTimeout(yiXiuGai.lishi);
    yiXiuGai.lishi = setTimeout(() => { tuiRuLiShi(zt.luJing, el('wenBen').value); }, 600);
    if (el('gouZiDongBaoCun') && !el('gouZiDongBaoCun').disabled && el('gouZiDongBaoCun').checked) {
      if (yiXiuGai.bao) clearTimeout(yiXiuGai.bao);
      yiXiuGai.bao = setTimeout(() => { void baoCun(); }, 2000);
    }
    anPaiYuLan();
    if (zt.souCi) {
      // 正文变了 ⇒ 命中位置也变了（防抖，别每敲一个键就重排一遍）
      if (yiXiuGai.dingShi) clearTimeout(yiXiuGai.dingShi);
      yiXiuGai.dingShi = setTimeout(() => { chongXinSouSuo(); }, 180);
    }
  }

  async function baoCun() {
    if (zt.chatEditor) {
      try {
        const r = await window.warmy.chatEditorSync?.({ content: el('wenBen').value });
        if (r && r.ok) { zhuangTaiWen('已同步到聊天框（不保存成文件）'); return true; }
        tiShiWen('同步到聊天框失败：' + ((r && r.error) || '未知原因'));
        return false;
      } catch (e) { tiShiWen('同步到聊天框失败：' + String((e && e.message) || e)); return false; }
    }
    if (!zt.keBianJi) { tiShiWen('这个格式是只读的，不能保存。'); return false; }
    if (zt.leiXing === 'binary' && zt.shiLiu) {
      const s = zt.shiLiu;
      const bianGeng = [...s.bianGeng.entries()];
      if (!bianGeng.length) {
        zt.zang = false;
        gengXinBiaoTi();
        zhuangTaiWen('没有改动');
        return true;
      }
      let r = null;
      try {
        r = await window.warmy.nmBaoCun({ id: chuangKouId, sha256: s.sha256, bianGeng });
      } catch (e) {
        r = { ok: false, cuo: String((e && e.message) || e) };
      }
      if (r && r.ok) {
        s.sha256 = String(r.sha256 || s.sha256);
        s.bianGeng.clear();
        s.huanCun.clear();
        s.qingQiu.clear();
        zt.zang = false;
        gengXinBiaoTi();
        huiShiLiu(true);
        zhuangTaiWen('已保存 · ' + TZ.locTime(Date.now()) + ' · ' + ziJieWen(r.ziJie)
          + (r.beiFen ? ' · 备份：' + r.beiFen : ''));
        return true;
      }
      tiShiWen('保存失败：' + ((r && (r.cuo || r.error)) || '未知原因'));
      return false;
    }
    const ta = el('wenBen');
    const ciShi = ta.value;
    let r = null;
    try {
      r = await window.warmy.nmBaoCun({ id: chuangKouId, wenBen: ciShi, huanHang: zt.huanHang });
    } catch (e) {
      r = { ok: false, cuo: String((e && e.message) || e) };
    }
    if (r && r.ok) {
      // 保存期间又改了：保留"未保存"标记，别把新改动误标成已保存
      if (ta.value === ciShi) zt.zang = false;
      gengXinBiaoTi();
      zhuangTaiWen('已保存 · ' + TZ.locTime(Date.now()) + ' · ' + ziJieWen(r.ziJie));
      return !zt.zang;
    }
    tiShiWen('保存失败：' + ((r && (r.cuo || r.error)) || '未知原因'));
    return false;
  }

  async function lingCunWei() {
    if (!zt.keBianJi) { tiShiWen('这个格式是只读的，不能另存为。'); return; }
    let r = null;
    try {
      if (zt.leiXing === 'binary' && zt.shiLiu) {
        const s = zt.shiLiu;
        r = await window.warmy.nmLingCunWei({
          id: chuangKouId,
          sha256: s.sha256,
          bianGeng: [...s.bianGeng.entries()],
          jianYiMing: zt.ming,
        });
      } else {
        r = await window.warmy.nmLingCunWei({ id: chuangKouId, wenBen: el('wenBen').value, huanHang: zt.huanHang, jianYiMing: zt.ming });
      }
    } catch (e) {
      r = { ok: false, cuo: String((e && e.message) || e) };
    }
    if (r && r.ok && r.luJing) {
      zt.luJing = r.luJing;
      zt.ming = String(r.luJing).split(/[\\/]/).pop() || zt.ming;
      zt.zang = false;
      if (zt.leiXing === 'binary' && zt.shiLiu) {
        zt.shiLiu.sha256 = String(r.sha256 || '');
        zt.shiLiu.bianGeng.clear();
        zt.shiLiu.huanCun.clear();
        zt.shiLiu.qingQiu.clear();
        huiShiLiu(true);
      }
      tuiRuLiShi(zt.luJing, zt.leiXing === 'text' && el('wenBen') ? el('wenBen').value : '');
      gengXinBiaoTi();
      zhuangTaiWen('已另存为 · ' + zt.luJing);
    } else if (r && !r.yiQuXiao) {
      tiShiWen('另存为失败：' + ((r && (r.cuo || r.error)) || '未知原因'));
    }
  }

  /* ── 关闭确认（自定义窗控的可见降级） ─────────────────── */
  function xianShiGuanBi(kai) {
    el('guanBiZheZhao').hidden = !kai;
    if (kai) setTimeout(() => { try { el('anNiuQuXiaoGuanBi').focus(); } catch { /* 忽略 */ } }, 0);
  }
  function qingQiuGuanBi() {
    if (zt.zang && zt.keBianJi) { xianShiGuanBi(true); return; }
    if (zt.wangYe.kai && youWeiBaoCun()) {
      void (async () => {
        const jie = await wenWangYeBaoCun();
        if (jie === 'save') { if (!(await yuanBaoCun())) return; }
        else if (jie !== 'discard') return;
        void window.warmy.winClose?.();
      })();
      return;
    }
    void window.warmy.winClose?.();
  }
  function guanBiQueRen() {
    xianShiGuanBi(false);
    void window.warmy.winClose?.();
  }

  /* ── 只读视图缩放 / 拖动（第 67 轮项 19） ──────────────
   * 用 transform: translate(x,y) scale(s) 或"滚动容器的 scale"实现，**不用 CSS zoom**：
   * CSS zoom 改的是布局尺寸，文本框/分栏/查找高亮的坐标全会跟着变，编辑和命中位置会错。
   * 音频/视频不接管：它们的滚轮、拖动保持原生行为。
   */
  /** 只读文字的命中测试：鼠标在字上（含 3px 容差）⇒ 选择；否则拖动画面 */
  let ceLiangHua = null;
  function wenZiKuanDu(ta, wen) {
    try {
      if (!ceLiangHua) ceLiangHua = document.createElement('canvas');
      const ctx = ceLiangHua.getContext('2d');
      const cs = getComputedStyle(ta);
      ctx.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].filter(Boolean).join(' ');
      return ctx.measureText(String(wen || '').replace(/\t/g, '    ')).width;
    } catch { return 0; }
  }
  /**
   * 只读文字的**逐视觉行矩形**（自动换行也按真实回行算）。
   * 用同字体/同内边距/同宽度的隐藏镜像 + Range.getClientRects()，
   * 拿到每行文字的左右边界；只在文字上（含 3px 溢出）才算"点在字上"，
   * 行尾空白、段落之间、右侧留白都能拖动画布。
   *
   * 只读文档不会在查看时改内容，所以按"文本+宽度+字体+换行"缓存；编辑态不走进这里。
   */
  let wenZiKuangCache = null;
  function wenZiHangKuang(ta) {
    const cs = getComputedStyle(ta);
    const key = [
      ta.value, ta.clientWidth, zt.huanHangKai ? 1 : 0, cs.font, cs.letterSpacing,
      cs.lineHeight, cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.tabSize,
    ].join('\u0000');
    if (wenZiKuangCache && wenZiKuangCache.key === key) return wenZiKuangCache.rects;
    const rects = [];
    if (String(ta.value || '').length <= 2_000_000) {
      const mirror = document.createElement('div');
      mirror.setAttribute('aria-hidden', 'true');
      mirror.style.cssText = [
        'position:fixed', 'left:-100000px', 'top:0', 'visibility:hidden', 'pointer-events:none',
        'box-sizing:border-box', 'white-space:' + (zt.huanHangKai ? 'pre-wrap' : 'pre'),
        'overflow-wrap:break-word', 'word-break:break-word',
        'font:' + cs.font, 'letter-spacing:' + cs.letterSpacing, 'line-height:' + cs.lineHeight,
        'padding:' + [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
        'width:' + ta.clientWidth + 'px', 'tab-size:' + (cs.tabSize || 4),
      ].join(';');
      mirror.textContent = ta.value || '';
      document.body.appendChild(mirror);
      try {
        const range = document.createRange();
        range.selectNodeContents(mirror);
        const mr = mirror.getBoundingClientRect();
        for (const r of range.getClientRects()) {
          rects.push({ l: r.left - mr.left, t: r.top - mr.top, r: r.right - mr.left, b: r.bottom - mr.top });
        }
      } catch { /* 量不出来就退回旧逻辑 */ }
      mirror.remove();
    }
    wenZiKuangCache = { key, rects };
    return rects;
  }

  function zaiWenZiShang(e) {
    const jc = el('juanCuo');
    const ta = el('wenBen');
    if (!jc || jc.hidden || !ta || jc.hidden !== false) return false;
    const r = ta.getBoundingClientRect();
    const s = zt.suoFang || 1;
    const lx = (e.clientX - r.left) / s;
    const ly = (e.clientY - r.top) / s;
    if (lx < 0 || ly < 0) return false;
    // 坐标换算到"textarea 边框盒 + 滚动量"；镜像里的矩形也是相对边框盒（含 padding）
    const x = lx + ta.scrollLeft;
    const y = ly + ta.scrollTop;
    const hang = wenZiHangKuang(ta);
    if (hang.length) {
      const R = 3; // 文字边缘一点点溢出也算文字上
      return hang.some((h) => x >= h.l - R && x <= h.r + R && y >= h.t - R && y <= h.b + R);
    }
    // 镜像失败（或空文件/超大文件）：退回按逻辑行估算
    const cs = getComputedStyle(ta);
    const pt = parseFloat(cs.paddingTop) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const lh = parseFloat(cs.lineHeight) || ((parseFloat(cs.fontSize) || 13) * 1.55);
    const neiKuan = Math.max(0, ta.clientWidth - pl - pr);
    if (lx < pl - 3 || lx > pl + neiKuan + 3) return false;
    if (zt.huanHangKai) return y <= ta.scrollHeight - Math.min(6, lh * 0.4);
    const lines = String(ta.value || '').split('\n');
    const idx = Math.floor((ly - pt + ta.scrollTop) / lh);
    if (idx < 0 || idx >= lines.length) return false;
    return lx - pl + ta.scrollLeft <= wenZiKuanDu(ta, lines[idx]) + 3;
  }

  function shiTuMiaoShu() {
    if (!el('juanCuo').hidden) {
      return {
        lei: 'text', kuang: el('juanCuo'),
        mian: [el('wenBen'), el('gaoLiang')],
        gun: el('wenBen'),
        // 第 81 轮项 6：只读文字可框选；鼠标不在文字上（2–3px 容差）时拖动画面
        keTuo: !zt.keBianJi,
        wenZi: true,
        zhiDu: !zt.keBianJi,
      };
    }
    if (!el('kuaiLie').hidden) {
      const nei = el('kuaiNei');
      return {
        lei: 'kuai', kuang: el('kuaiLie'),
        mian: nei ? [nei] : [],
        gun: el('kuaiLie'),
        keTuo: true,
        zhiDu: true,
      };
    }
    if (!el('shiLiuLie').hidden) {
      const keBian = !!(zt.shiLiu && zt.shiLiu.keBianJi);
      return {
        lei: 'hex', kuang: el('shiLiuGunDong'),
        mian: [el('shiLiuNei')],
        gun: el('shiLiuGunDong'),
        keTuo: !keBian,
        zhiDu: !keBian,
      };
    }
    if (!el('meiTiLie').hidden) {
      if (zt.leiXing === 'audio' || zt.leiXing === 'video') return null;
      const he = el('meiTiLie').querySelector('.tuPianHe');
      if (!he) return null;
      return {
        lei: 'image', kuang: el('meiTiLie'),
        mian: [he],
        gun: null,
        keTuo: true,
        zhiDu: true,
      };
    }
    return null;
  }

  function gengXinShiTuLei() {
    document.querySelectorAll('.nmKeTuo').forEach((x) => x.classList.remove('nmKeTuo'));
    el('meiTiLie').classList.remove('nmKeSuo');
    const d = shiTuMiaoShu();
    ['anNiuSuoXiao', 'anNiuFangDa', 'suoFangZhi'].forEach((id) => {
      const b = el(id);
      if (b) b.disabled = !d;
    });
    if (!d) return;
    if (d.keTuo) {
      d.kuang.classList.add('nmKeTuo');
      if (d.gun && d.gun !== d.kuang) d.gun.classList.add('nmKeTuo');
    }
    if (d.lei === 'image') d.kuang.classList.add('nmKeSuo');
  }

  /** 把当前缩放/平移落到真实的 transform 上（标签、按钮、光标同步） */
  function yingYongShiTu() {
    const d = shiTuMiaoShu();
    const n = zt.suoFang;
    if (d) {
      d.mian.forEach((m) => {
        if (!m) return;
        if (d.lei === 'image') {
          m.style.transformOrigin = '50% 50%';
          m.style.transform = (n === 1 && zt.suoFangPanX === 0 && zt.suoFangPanY === 0)
            ? ''
            : 'translate(' + zt.suoFangPanX.toFixed(1) + 'px,' + zt.suoFangPanY.toFixed(1) + 'px) scale(' + n + ')';
        } else {
          m.style.transformOrigin = '0 0';
          m.style.transform = n === 1 ? '' : 'scale(' + n + ')';
        }
      });
    }
    el('suoFangZhi').textContent = Math.round(n * 100) + '%';
    gengXinShiTuLei();
    if (d && d.lei === 'hex') {
      try { huiShiLiu(true); } catch { /* 缩放期间重画失败不打断用户 */ }
    }
  }

  /** 图片平移限位：内容不能被拖丢，至少留一截在视口里 */
  function jiaPan(base, x, y) {
    const d = shiTuMiaoShu();
    if (!d || d.lei !== 'image' || !base) return { x: 0, y: 0 };
    if (zt.suoFang <= 1) return { x: 0, y: 0 };
    const k = d.kuang.getBoundingClientRect();
    const vw = base.width * zt.suoFang;
    const vh = base.height * zt.suoFang;
    const keepX = Math.min(80, Math.max(24, k.width / 3), vw * 0.6);
    const keepY = Math.min(80, Math.max(24, k.height / 3), vh * 0.6);
    const minX = k.left + keepX - base.left - vw;
    const maxX = k.right - keepX - base.left;
    const minY = k.top + keepY - base.top - vh;
    const maxY = k.bottom - keepY - base.top;
    const ding = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    return { x: ding(x, minX, maxX), y: ding(y, minY, maxY) };
  }

  /** 缩放（0.25–5）：给了鼠标坐标就以该点为焦点，否则用视口中心 */
  function sheSuoFang(v, dian) {
    const d = shiTuMiaoShu();
    if (!d) return;
    const cu = Number(v);
    const n = Math.min(5, Math.max(0.25, Math.round((Number.isFinite(cu) ? cu : 1) * 100) / 100));
    const cuS = zt.suoFang || 1;
    const kr = d.kuang.getBoundingClientRect();
    const fx = dian && Number.isFinite(dian.clientX) ? dian.clientX : kr.left + kr.width / 2;
    const fy = dian && Number.isFinite(dian.clientY) ? dian.clientY : kr.top + kr.height / 2;

    if (n === 1) { zt.suoFangPanX = 0; zt.suoFangPanY = 0; }

    if (d.lei === 'image' && d.mian[0]) {
      const r = d.mian[0].getBoundingClientRect();
      const bw = r.width / cuS;
      const bh = r.height / cuS;
      const bcx = r.left + r.width / 2 - zt.suoFangPanX;
      const bcy = r.top + r.height / 2 - zt.suoFangPanY;
      const base = { left: bcx - bw / 2, top: bcy - bh / 2, width: bw, height: bh };
      const lx = (fx - bcx - zt.suoFangPanX) / cuS + bw / 2;
      const ly = (fy - bcy - zt.suoFangPanY) / cuS + bh / 2;
      zt.suoFang = n;
      zt.suoFangPanX = fx - bcx - (lx - bw / 2) * n;
      zt.suoFangPanY = fy - bcy - (ly - bh / 2) * n;
      const j = jiaPan(base, zt.suoFangPanX, zt.suoFangPanY);
      zt.suoFangPanX = n === 1 ? 0 : j.x;
      zt.suoFangPanY = n === 1 ? 0 : j.y;
      yingYongShiTu();
      return;
    }

    // 文本 / 文档 / 十六进制：容器原生滚动负责平移，scale 负责放大缩小
    if (d.gun && cuS > 0) {
      const offX = fx - kr.left;
      const offY = fy - kr.top;
      const c0 = (d.gun.scrollLeft + offX) / cuS;
      const r0 = (d.gun.scrollTop + offY) / cuS;
      zt.suoFang = n;
      yingYongShiTu();
      d.gun.scrollLeft = Math.max(0, c0 * n - offX);
      d.gun.scrollTop = Math.max(0, r0 * n - offY);
      return;
    }
    zt.suoFang = n;
    yingYongShiTu();
  }

  /** 复位：100%、平移归零、滚动回到起点（按钮 / Ctrl+0 用） */
  function chongZhiShiTu() {
    zt.suoFangPanX = 0;
    zt.suoFangPanY = 0;
    zt.suoFang = 1;
    const d = shiTuMiaoShu();
    if (d && d.gun) { d.gun.scrollLeft = 0; d.gun.scrollTop = 0; }
    yingYongShiTu();
  }

  /** 适应窗口：图片按原始尺寸缩到视口内；文本/文档本来就会重排，回到 100% */
  function shiYingChuangKou() {
    const d = shiTuMiaoShu();
    if (!d) return;
    if (d.lei === 'image') {
      const img = d.kuang.querySelector('img');
      const kr = d.kuang.getBoundingClientRect();
      if (img && img.naturalWidth > 0 && kr.width > 20 && kr.height > 20) {
        const s = Math.min(5, Math.max(0.25, Math.min(
          (kr.width - 24) / img.naturalWidth,
          (kr.height - 24) / img.naturalHeight,
        )));
        zt.suoFangPanX = 0;
        zt.suoFangPanY = 0;
        sheSuoFang(s);
        return;
      }
    }
    chongZhiShiTu();
  }

  /* 左键拖动平移（只读内容；可编辑文本/二进制保留原生选择与滚动） */
  let shiTuTuo = null;
  function tingShiTuTuo() {
    if (!shiTuTuo) return;
    const t = shiTuTuo;
    shiTuTuo = null;
    document.body.classList.remove('nmTuoZhong');
    try { el('zhengWen').releasePointerCapture?.(t.pointerId); } catch { /* 指针已经释放 */ }
  }
  function daYin() {
    const ka = wangYeDangQian();
    if (zt.wangYe.kai && ka && !ka.shiBenDi && ka.url) {
      try { window.warmy.nmWangYeDaYin?.(chuangKouId); } catch { /* noop */ }
      return;
    }
    const pre = el('daYinWenBen');
    // 分栏时打印"效果"这一侧；纯文本文件才用 pre 替身（textarea 不能可靠地整篇打印）
    if (!el('juanCuo').hidden && !zt.fenLan) {
      pre.textContent = el('wenBen').value;
      pre.hidden = false;
    } else {
      pre.hidden = true;
    }
    try {
      window.print();
    } catch {
      zhuangTaiWen('这个环境不支持直接打印');
    }
  }

  /* ── 工具栏：响应式收/放 + 下拉菜单（项 9） ─────────────
   * 一条硬规则：**永远没有横向滚动条**。放不下就收进「…」，替换展开还放不下就变两行，
   * 第二行把「…」里的项回排出来；宽度回来再自动回到一行。
   */
  const GONG_JU_SHOU_QI = () => [
    el('suoFangZu'),      // 先收缩放
    el('anNiuHuanHang'),  // 再收换行
    el('houQianZu'),      // 再收撤销/前进
    el('muLuZu'),         // 目录也可收
  ].filter(Boolean);
  let gongJuLiangHang = false;
  let gongJuYiCang = [];
  let gongJuRaf = 0;
  let gongJuZhengZaiBu = false;
  let caiDanZuiHou = null;

  const TU_UNDO = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6.2 3.2 2.6 6.8l3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.8 6.8h5.1c2.8 0 4.6 1.5 4.6 4.1v1.4" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>';
  const TU_REDO = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9.8 3.2l3.6 3.6-3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.2 6.8H8.1c-2.8 0-4.6 1.5-4.6 4.1v1.4" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>';
  const TU_FOLDER = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 4.2h4l1.1 1.4H14v6.2c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1V4.2Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>';
  const TU_PRINT = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 6V2.8h7V6M4.5 11.2H3.2c-.7 0-1.2-.5-1.2-1.2V7.2c0-.7.5-1.2 1.2-1.2h9.6c.7 0 1.2.5 1.2 1.2V10c0 .7-.5 1.2-1.2 1.2h-1.3" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><rect x="4.5" y="9.2" width="7" height="4" rx=".6" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>';
  const TU_FILE = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 2.5h5.2L12.5 6v7.5h-9z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M8.6 2.6V6h3.8" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>';
  const TU_YU = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M2.6 8h10.8M8 2.4c1.7 1.5 2.6 3.4 2.6 5.6S9.7 12.1 8 13.6M8 2.4C6.3 3.9 5.4 5.8 5.4 8s.9 4.1 2.6 5.6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  /** 第 81 轮项 11：无匹配用图标，不再写「无匹配」文字 */
  const TU_WU_PI_PEI = '<svg class="wuPiPeiTu" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="m10.2 10.2 3 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5.3 5.3l3.4 3.4M8.7 5.3 5.3 8.7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  function anPaiGongJuLan() {
    if (gongJuRaf) return;
    if (typeof requestAnimationFrame !== 'function') { buJuGongJuLan(); return; }
    gongJuRaf = requestAnimationFrame(() => { gongJuRaf = 0; buJuGongJuLan(); });
  }

  function gongJuHuanYuan() {
    const row1 = el('gongJuHang1');
    const row2 = el('gongJuHang2');
    const order = [el('baoChunZu'), el('muLuZu'), el('houQianZu'), el('souKuang'), el('anNiuHuanHang'), el('suoFangZu'), el('anNiuGengDuo')];
    order.forEach((x) => { if (x) { if (x.parentElement !== row1) row1.appendChild(x); x.hidden = false; } });
    const th = el('tiHuanZu');
    if (th.parentElement !== el('souKuang')) el('souKuang').appendChild(th);
    th.hidden = !zt.tiHuanKai;
    row2.hidden = true;
    row2.innerHTML = '';
    row1.hidden = false;
    gongJuLiangHang = false;
    gongJuYiCang = [];
  }

  function gongJuFangDeXia(row) {
    return row.scrollWidth <= row.clientWidth + 1;
  }

  function buJuGongJuLan() {
    if (gongJuZhengZaiBu) return;
    gongJuZhengZaiBu = true;
    try {
      const row1 = el('gongJuHang1');
      if (el('gongJuCaiDan') && !el('gongJuCaiDan').hidden) guanCaiDan();
      gongJuHuanYuan();
      el('gongJuLan').classList.remove('zhai');
      el('souJi').setAttribute('aria-expanded', zt.tiHuanKai ? 'true' : 'false');
      // 收藏起优先级的项，直到一行放得下
      for (const x of GONG_JU_SHOU_QI()) {
        if (gongJuFangDeXia(row1)) break;
        x.hidden = true;
        gongJuYiCang.push(x);
      }
      /**
       * 替换展开时：一行怎么收都放不下，或查找区已经被压得放不下「搜索框 + 替换框」的最小宽度 ⇒ 两行。
       * 第二行 = 与查找框左对齐的替换组 + 从「…」回排出来的按钮（能放几个放几个）。
       */
      const souKuan = el('souKuang') ? el('souKuang').clientWidth : 0;
      if (zt.tiHuanKai && (!gongJuFangDeXia(row1) || souKuan < 290 || window.innerWidth < 560)) {
        const row2 = el('gongJuHang2');
        gongJuLiangHang = true;
        row2.hidden = false;
        const th = el('tiHuanZu');
        row2.appendChild(th);
        th.hidden = false;
        const qian = document.createElement('span');
        qian.className = 'tiHuanQian';
        row2.appendChild(qian);
        const left = el('souRuKe').getBoundingClientRect().left - row2.getBoundingClientRect().left;
        qian.style.width = Math.max(0, Math.min(left, Math.max(0, row1.clientWidth - 160))) + 'px';
        for (const x of [...gongJuYiCang]) {
          row2.appendChild(x);
          x.hidden = false;
          if (!gongJuFangDeXia(row2)) {
            row1.appendChild(x);
            x.hidden = true;
          } else {
            gongJuYiCang = gongJuYiCang.filter((y) => y !== x);
          }
        }
      }
      if (gongJuLiangHang) {
        try { const d = Math.max(0, el('souRuKe').getBoundingClientRect().left - el('gongJuHang2').getBoundingClientRect().left); el('tiHuanZu').style.marginLeft = d + 'px'; const q2 = el('gongJuHang2').querySelector('.tiHuanQian'); if (q2) q2.style.width = '0px'; } catch { /* noop */ }
      }
      // 极窄：把查找框再压一点（仍然保留保存 + 查找 + 「…」）
      if (!gongJuFangDeXia(row1)) {
        el('gongJuLan').classList.add('zhai');
        // 两行时行 2 也允许压缩
        if (gongJuLiangHang && !gongJuFangDeXia(row1)) { /* 不再有可收项 */ }
      }
      el('anNiuGengDuo').hidden = gongJuYiCang.length === 0;
      gengXinGengDuo();
    } finally {
      gongJuZhengZaiBu = false;
    }
  }

  function guanCaiDan() {
    const m = el('gongJuCaiDan');
    if (!m) return;
    m.hidden = true;
    m.innerHTML = '';
    caiDanZuiHou = null;
  }

  function kaiCaiDan(anchor, xiang, zhongLei, dian) {
    const m = el('gongJuCaiDan');
    if (!m || (!anchor && !dian)) return;
    /**
     * 第 97 轮项 6：同一个按钮再点一次 = 收起（不是重新展开）。
     * 菜单外的点击由 document 捕获阶段统一收起（同一按钮的 mousedown 会放行，交给这里切换）。
     */
    if (!m.hidden && !dian && caiDanZuiHou && caiDanZuiHou.anchor === anchor && caiDanZuiHou.zhongLei === zhongLei) {
      guanCaiDan();
      return;
    }
    m.innerHTML = '';
    for (const x of xiang) {
      if (!x) continue;
      if (x.sep) {
        const ge = document.createElement('div');
        ge.className = 'caiDanGe';
        m.appendChild(ge);
        continue;
      }
      if (x.check) {
        const lab = document.createElement('label');
        const ck = document.createElement('input');
        ck.type = 'checkbox';
        ck.checked = !!x.checked;
        ck.disabled = !!x.disabled;
        const sp = document.createElement('span');
        sp.textContent = x.label;
        lab.appendChild(ck);
        lab.appendChild(sp);
        ck.addEventListener('change', () => { try { x.onCheck?.(!!ck.checked); } catch { /* noop */ } });
        m.appendChild(lab);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = !!x.disabled;
      if (x.icon) b.innerHTML = x.icon;
      const sp = document.createElement('span');
      sp.textContent = x.label;
      b.appendChild(sp);
      if (x.hint) {
        const h = document.createElement('span');
        h.className = 'jianTou';
        h.textContent = x.hint;
        b.appendChild(h);
      }
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (x.disabled) return;
        guanCaiDan();
        try { x.onClick?.(); } catch { /* 动作失败不改菜单状态 */ }
      });
      m.appendChild(b);
    }
    m.hidden = false;
    m.style.left = '0px';
    m.style.top = '0px';
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    let left;
    let top;
    if (dian) {
      left = dian.x;
      top = dian.y;
      if (left + mw > window.innerWidth - 8) left = Math.max(8, dian.x - mw);
      if (top + mh > window.innerHeight - 8) top = Math.max(8, dian.y - mh);
    } else {
      const a = anchor.getBoundingClientRect();
      left = a.left;
      if (left + mw > window.innerWidth - 8) left = Math.max(8, a.right - mw);
      top = a.bottom + 4;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, a.top - mh - 4);
    }
    m.style.left = Math.round(left) + 'px';
    m.style.top = Math.round(top) + 'px';
    caiDanZuiHou = { anchor, xiang, zhongLei };
  }

  /* ── 右键菜单（第 81 轮项 12）：所有可选择 / 输入区域 ──
   * 顺序按桌面惯例：撤销 / 重做（前进）→ 剪切 / 复制 / 粘贴 → 全选 → 插入对话。
   * 「插入对话」目前没有现成 IPC：先找 window.warmy 上可能存在的插入通道，
   * 找不到就如实提示并把内容复制到剪贴板（不假装插入成功）。
   */
  function shuRuYuanSu(t) {
    if (!t || !t.closest) return null;
    const x = t.closest('input,textarea,[contenteditable="true"]');
    if (!x) return null;
    if (x.tagName === 'INPUT' && /^(checkbox|radio|file|range|button)$/i.test(x.type || '')) return null;
    return x;
  }
  function quXuanZhongWen(t) {
    if (t && t.tagName === 'TEXTAREA' || (t && t.tagName === 'INPUT')) {
      try {
        const a = Number(t.selectionStart) || 0;
        const b = Number(t.selectionEnd) || 0;
        if (b > a) return String(t.value || '').slice(a, b);
      } catch { /* 某些 input 不支持 selection */ }
      return '';
    }
    try { return String(window.getSelection ? window.getSelection().toString() : ''); } catch { return ''; }
  }
  function quanWenQu(t) {
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return String(t.value || '');
    const he = t && t.closest ? t.closest('.docWen,.pptWen,.kuaiWen,.biaoGeWai,.kuai,.geQuXiangQingNei,.yaSuoMing') : null;
    return he ? String(he.textContent || '') : '';
  }
  function xuanQuan(t) {
    try {
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) { t.focus(); t.select(); return true; }
      const r = document.createRange();
      const he = t && t.closest ? (t.closest('.docWen,.pptWen,.kuaiWen,.biaoGeWai,.kuai') || t) : t;
      r.selectNodeContents(he);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    } catch { return false; }
  }
  function fuZhiXuanZhong(t) {
    const wen = quXuanZhongWen(t);
    if (wen) { fuZhiWen(wen); return true; }
    try {
      if (document.execCommand && document.execCommand('copy')) { zhuangTaiWen('已复制'); return true; }
    } catch { /* 退回下面的 clipboard */ }
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
      const q = quanWenQu(t);
      if (q) { fuZhiWen(q); return true; }
    }
    return false;
  }
  async function duJianTieBan() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) return String(await navigator.clipboard.readText());
    } catch { /* 权限被拒/无剪贴板 API */ }
    return null;
  }
  async function jianTieDao(t) {
    if (!t) { zhuangTaiWen('这里不能粘贴'); return; }
    const wen = await duJianTieBan();
    if (wen == null) { zhuangTaiWen('粘贴不可用：当前环境读不到剪贴板（可用 Ctrl+V）'); return; }
    try {
      t.focus();
      if (!document.execCommand('insertText', false, wen)) throw new Error('execCommand 拒绝');
      zhuangTaiWen('已粘贴');
    } catch {
      try {
        const a = Number(t.selectionStart) || 0;
        const b = Number(t.selectionEnd) || 0;
        t.setRangeText(wen, a, b, 'end');
        t.dispatchEvent(new Event('input', { bubbles: true }));
        zhuangTaiWen('已粘贴');
      } catch { zhuangTaiWen('粘贴失败：这个控件不接受插入'); }
    }
  }
  function zhiXingMingLing(cmd) {
    try { document.execCommand(cmd); return true; } catch { return false; }
  }
  /** 插入当前激活聊天框：没有可用的 IPC 就如实说缺口（不伪造成功） */
  async function chaRuDuiHua(wen) {
    const w = window.warmy || {};
    const ming = ['chaRuDuiHua', 'chaRuWenBen', 'chaRuLiaoTian', 'insertChatText', 'insertIntoChat', 'tianJiaDaoDuiHua'];
    const fn = ming.map((n) => w[n]).find((x) => typeof x === 'function');
    if (fn) {
      try {
        const r = await fn.call(w, wen);
        if (r && r.ok === false) tiShiWen('插入对话失败：' + (r.cuo || r.error || '未知原因'));
        else zhuangTaiWen('已插入当前对话');
        return;
      } catch (e) { tiShiWen('插入对话失败：' + String((e && e.message) || e)); return; }
    }
    fuZhiWen(wen);
    zhuangTaiWen('插入对话暂不可用：window.warmy 还没有「插入当前聊天框」的 IPC；内容已复制到剪贴板。');
    tiShiWen('插入对话暂不可用（缺少 window.warmy 插入 IPC）。内容已复制到剪贴板，可到聊天框 Ctrl+V。');
  }
  function kaiYouJianCaiDan(e, t) {
    const keBian = shuRuYuanSu(t);
    const youXuan = !!quXuanZhongWen(t);
    const wen = quXuanZhongWen(t) || quanWenQu(t);
    const xiang = [
      { label: '撤销', disabled: !keBian, onClick: () => { keBian.focus(); zhiXingMingLing('undo'); } },
      { label: '重做（前进）', disabled: !keBian, onClick: () => { keBian.focus(); zhiXingMingLing('redo'); } },
      { sep: true },
      { label: '剪切', disabled: !keBian || !youXuan, onClick: () => { keBian.focus(); zhiXingMingLing('cut'); } },
      { label: '复制', disabled: !youXuan && !keBian, onClick: () => fuZhiXuanZhong(t) },
      { label: '粘贴', disabled: !keBian, onClick: () => { void jianTieDao(keBian); } },
      { sep: true },
      { label: '全选', onClick: () => { if (!xuanQuan(keBian || t)) zhuangTaiWen('这里没有可全选的内容'); } },
      { sep: true },
      { label: '插入对话', disabled: !wen, onClick: () => { void chaRuDuiHua(wen.slice(0, 200000)); } },
    ];
    kaiCaiDan(null, xiang, 'youJian', { x: e.clientX, y: e.clientY });
  }

  function kaiBaoCunCaiDan() {
    kaiCaiDan(el('anNiuBaoCunXia'), [
      { label: '另存为', icon: TU_FILE, disabled: !zt.keBianJi, onClick: () => { void lingCunWei(); } },
      { sep: true },
      { label: '自动保存', check: true, checked: zt.ziDong !== false, disabled: !zt.keBianJi, onCheck: sheZhiZiDong },
    ], 'save');
  }

  function sheZhiZiDong(kai) {
    zt.ziDong = !!kai;
    const gou = el('gouZiDongBaoCun');
    if (gou) gou.checked = zt.ziDong;
    if (zt.ziDong && zt.zang) void baoCun();
    zhuangTaiWen(zt.ziDong ? '自动保存已开（停手 2 秒保存）' : '自动保存已关');
    gongJuCaiDanShuaXin();
  }

  function kaiMuLuCaiDan() {
    kaiCaiDan(el('anNiuMuLuXia'), [
      { label: '打开', icon: TU_FILE, onClick: () => { void window.warmy.nmDaKai?.(); } },
      // 第 81 轮项 11：目录选项里加「打开网站」（新开 nm 网站模式）
      { label: '打开网站', icon: TU_YU, onClick: () => daKaiWangYeMoShi() },
      { label: '打印', icon: TU_PRINT, onClick: daYin },
    ], 'dir');
  }

  function gengXinGengDuo() {
    const more = el('anNiuGengDuo');
    if (!more) return;
    more.hidden = gongJuYiCang.length === 0;
  }

  function kaiGengDuoCaiDan() {
    const xiang = [];
    if (gongJuYiCang.includes(el('muLuZu'))) {
      xiang.push({ label: '打开', icon: TU_FILE, onClick: () => { void window.warmy.nmDaKai?.(); } });
      xiang.push({ label: '打开网站', icon: TU_YU, onClick: () => daKaiWangYeMoShi() });
      xiang.push({ label: '打印', icon: TU_PRINT, onClick: daYin });
      xiang.push({ sep: true });
    }
    if (gongJuYiCang.includes(el('houQianZu'))) {
      xiang.push({ label: '后退', icon: TU_UNDO, disabled: liShiWei <= 0, onClick: () => el('anNiuHouTui').click() });
      xiang.push({ label: '前进', icon: TU_REDO, disabled: liShiWei >= liShi.length - 1, onClick: () => el('anNiuQianJin').click() });
      xiang.push({ sep: true });
    }
    if (gongJuYiCang.includes(el('anNiuHuanHang'))) {
      xiang.push({ label: '自动换行', check: true, checked: zt.huanHangKai, disabled: el('anNiuHuanHang').disabled, onCheck: (k) => sheHuanHang(k) });
      xiang.push({ sep: true });
    }
    if (gongJuYiCang.includes(el('suoFangZu'))) {
      xiang.push({ label: '缩小', hint: '−', onClick: () => sheSuoFang(zt.suoFang - 0.1) });
      xiang.push({ label: '实际大小', hint: Math.round(zt.suoFang * 100) + '%', onClick: chongZhiShiTu });
      xiang.push({ label: '适应窗口', hint: 'Ctrl+9', onClick: shiYingChuangKou });
      xiang.push({ label: '放大', hint: '+', onClick: () => sheSuoFang(zt.suoFang + 0.1) });
    }
    // 去掉尾部/连续分隔线
    while (xiang.length && xiang[xiang.length - 1] && xiang[xiang.length - 1].sep) xiang.pop();
    if (!xiang.length) { guanCaiDan(); return; }
    kaiCaiDan(el('anNiuGengDuo'), xiang, 'more');
  }

  function gongJuCaiDanShuaXin() {
    if (!caiDanZuiHou || el('gongJuCaiDan').hidden) return;
    if (caiDanZuiHou.zhongLei === 'save') kaiBaoCunCaiDan();
    else if (caiDanZuiHou.zhongLei === 'yuanSave') kaiYuanBaoCunCaiDan();
    else if (caiDanZuiHou.zhongLei === 'more') kaiGengDuoCaiDan();
  }

  function sheTiHuan(kai) {
    zt.tiHuanKai = !!kai;
    el('tiHuanZu').hidden = !zt.tiHuanKai;
    el('souJi').setAttribute('aria-expanded', zt.tiHuanKai ? 'true' : 'false');
    buJuGongJuLan();
    if (zt.tiHuanKai) setTimeout(() => { try { el('tiHuanRu').focus(); } catch { /* noop */ } }, 0);
  }

  /* ── 交互绑定 ─────────────────────────────────────────── */
  el('anNiuBaoCun').addEventListener('click', () => { void baoCun(); });
  el('anNiuBaoCunXia').addEventListener('click', (e) => { e.stopPropagation(); kaiBaoCunCaiDan(); });
  el('anNiuMuLuXia').addEventListener('click', (e) => { e.stopPropagation(); kaiMuLuCaiDan(); });
  el('anNiuGengDuo').addEventListener('click', (e) => { e.stopPropagation(); kaiGengDuoCaiDan(); });
  el('souJi').addEventListener('click', () => sheTiHuan(!zt.tiHuanKai));
  el('anNiuLingCunWei').addEventListener('click', () => { void lingCunWei(); });
  el('anNiuHouTui').addEventListener('click', () => {
    if (liShiWei <= 0) return;
    liShiWei -= 1;
    gengXinHouQianJin();
    void huiFu(liShiWei);
  });
  el('anNiuQianJin').addEventListener('click', () => {
    if (liShiWei >= liShi.length - 1) return;
    liShiWei += 1;
    gengXinHouQianJin();
    void huiFu(liShiWei);
  });
  el('anNiuHuanHang').addEventListener('click', () => {
    sheHuanHang(!zt.huanHangKai);
  });
  el('anNiuTiHuan').addEventListener('click', tiHuanDangQian);
  el('anNiuDaKai').addEventListener('click', () => { void window.warmy.nmDaKai?.(); });
  el('anNiuSuoZaiMuLu').addEventListener('click', () => { void window.warmy.nmSuoZaiMuLu?.({ id: chuangKouId }); });
  el('gouZiDongBaoCun').addEventListener('change', (e) => {
    zt.ziDong = !!e.target.checked;
    if (zt.ziDong && zt.zang) void baoCun();
    zhuangTaiWen(zt.ziDong ? '自动保存已开（停手 2 秒保存）' : '自动保存已关');
    gongJuCaiDanShuaXin();
  });
  el('souRu').addEventListener('input', () => {
    zt.souWei = 0;
    // 项 33：输入防抖，别每敲一个键就重扫整篇并重建高亮层
    if (zt.souDingShi) clearTimeout(zt.souDingShi);
    zt.souDingShi = setTimeout(() => { zt.souDingShi = null; chongXinSouSuo(); }, 120);
  });
  el('souRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); buJin(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { el('souRu').value = ''; chongXinSouSuo(); }
  });
  el('anNiuXiaYiGe').addEventListener('click', () => buJin(1));
  el('anNiuShangYiGe').addEventListener('click', () => buJin(-1));
  el('anNiuFangDa').addEventListener('click', () => sheSuoFang(zt.suoFang + 0.1));
  el('anNiuSuoXiao').addEventListener('click', () => sheSuoFang(zt.suoFang - 0.1));
  el('suoFangZhi').addEventListener('click', chongZhiShiTu);
  el('suoFangZhi').addEventListener('wheel', (e) => {
    e.preventDefault();
    sheSuoFang(zt.suoFang + (e.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  el('anNiuDaYin').addEventListener('click', daYin);
  /**
   * 滚轮：只读内容（图片/PDF/文本/只读二进制）不按 Ctrl 也缩放，焦点在鼠标位置；
   * 可编辑文本仍保留"滚轮滚动、Ctrl+滚轮缩放"，避免破坏编辑手感；
   * 音频/视频直接放行，原生控件自己处理。
   */
  el('zhengWen').addEventListener('wheel', (e) => {
    if (zt.leiXing === 'audio' || zt.leiXing === 'video') {
      // 普通滚轮/拖动留给原生控件；只挡住 Ctrl+滚轮，别把整个页面缩放掉
      if (e.ctrlKey || e.metaKey) e.preventDefault();
      return;
    }
    const d = shiTuMiaoShu();
    if (!d) return;
    if (!d.zhiDu && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    sheSuoFang(zt.suoFang + (e.deltaY < 0 ? 0.1 : -0.1), { clientX: e.clientX, clientY: e.clientY });
  }, { passive: false });

  /* 左键拖动平移：只读文本/文档/图片/只读十六进制；音频/视频与可编辑内容不接管 */
  el('zhengWen').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (zt.leiXing === 'audio' || zt.leiXing === 'video') return;
    const d = shiTuMiaoShu();
    if (!d || !d.keTuo) return;
    const t = e.target;
    if (t && t.closest && t.closest('button,a,input,select')) return;
    // 可编辑文本/二进制保留原生选择；只读文字由下面的命中测试决定"选字还是拖画布"
    if (t && t.closest && t.closest('textarea') && d.lei !== 'text') return;
    // 压缩包左树 / 网页 iframe / 右上角浮钮：不是画布
    if (t && t.closest && t.closest('#yaSuoBaoLie,#wangYeLie')) return;
    /**
     * PDF/PPT/Word/Excel：**文字上拖动是选中复制，文字外（纸张边距/空白）才是移动画面**。
     * 这里不 preventDefault，让浏览器原生选择生效。
     */
    if (d.lei === 'kuai' && t && t.closest && t.closest('.docWen,.pptWen,.kuaiWen,.biaoGeWai')) return;
    // 第 81 轮项 6：只读文字上拖 = 原生框选复制，不当成画布
    if (d.lei === 'text' && zaiWenZiShang(e)) return;
    e.preventDefault();
    const base = d.lei === 'image' && d.mian[0] ? (() => {
      const r = d.mian[0].getBoundingClientRect();
      const s = zt.suoFang || 1;
      return {
        left: r.left - zt.suoFangPanX,
        top: r.top - zt.suoFangPanY,
        width: r.width / s,
        height: r.height / s,
      };
    })() : null;
    shiTuTuo = {
      pointerId: e.pointerId,
      d,
      base,
      x0: e.clientX,
      y0: e.clientY,
      panX: zt.suoFangPanX,
      panY: zt.suoFangPanY,
      sl: d.gun ? d.gun.scrollLeft : 0,
      st: d.gun ? d.gun.scrollTop : 0,
    };
    try { el('zhengWen').setPointerCapture(e.pointerId); } catch { /* 没有指针捕获也能拖 */ }
    document.body.classList.add('nmTuoZhong');
  });
  el('zhengWen').addEventListener('pointermove', (e) => {
    if (!shiTuTuo || shiTuTuo.pointerId !== e.pointerId) {
      // 第 81 轮项 6：文字上 text 光标，文字外 grab
      if (!shiTuTuo && !el('juanCuo').hidden && !zt.keBianJi) {
        el('juanCuo').classList.toggle('nmWenZiShang', zaiWenZiShang(e));
      }
      return;
    }
    e.preventDefault();
    const t = shiTuTuo;
    const dx = e.clientX - t.x0;
    const dy = e.clientY - t.y0;
    if (t.d.lei === 'image') {
      const j = jiaPan(t.base, t.panX + dx, t.panY + dy);
      zt.suoFangPanX = j.x;
      zt.suoFangPanY = j.y;
      yingYongShiTu();
      return;
    }
    if (t.d.gun) {
      // 文本的 textarea 自己就是被 scale 的元素：滚动量要除以比例，指针才和内容 1:1
      // 文档/十六进制是"滚动容器里放一个 scale 的内容层"，scrollLeft/Top 本身就是视觉像素
      const bili = t.d.lei === 'text' ? (zt.suoFang || 1) : 1;
      t.d.gun.scrollLeft = Math.max(0, t.sl - dx / bili);
      t.d.gun.scrollTop = Math.max(0, t.st - dy / bili);
    }
  });
  const jieShuTuo = (e) => {
    if (shiTuTuo && e && e.pointerId !== undefined && shiTuTuo.pointerId !== e.pointerId) return;
    tingShiTuTuo();
  };
  el('zhengWen').addEventListener('pointerup', jieShuTuo);
  el('zhengWen').addEventListener('pointercancel', jieShuTuo);
  el('zhengWen').addEventListener('lostpointercapture', jieShuTuo);

  const qieHuan = async (lei, kai) => {
    let r = null;
    try { r = await window.warmy.nmSheZhi({ id: chuangKouId, [lei]: kai }); } catch (err) { r = { ok: false, cuo: String((err && err.message) || err) }; }
    if (!r || r.ok === false) { zhuangTaiWen('切换失败：' + ((r && r.cuo) || '未知原因')); return false; }
    return true;
  };
  el('anNiuZongShiDing').addEventListener('click', async () => {
    const kai = el('anNiuZongShiDing').getAttribute('aria-pressed') !== 'true';
    if (await qieHuan('zongShiDing', kai)) {
      el('anNiuZongShiDing').setAttribute('aria-pressed', kai ? 'true' : 'false');
      el('anNiuZongShiDing').classList.toggle('kai', kai);
      zhuangTaiWen(kai ? '本窗口已置顶' : '本窗口取消置顶');
    }
  });
  el('anNiuXiFu').addEventListener('click', async () => {
    const kai = el('anNiuXiFu').getAttribute('aria-pressed') !== 'true';
    if (await qieHuan('xiFu', kai)) {
      el('anNiuXiFu').setAttribute('aria-pressed', kai ? 'true' : 'false');
      el('anNiuXiFu').classList.toggle('kai', kai);
      zhuangTaiWen(kai ? '吸附已开：靠近其它 nm 窗口会贴边' : '吸附已关');
    }
  });
  el('anNiuZuiXiao').addEventListener('click', () => { void window.warmy.winMinimize?.(); });
  el('anNiuZuiDa').addEventListener('click', () => { void window.warmy.winMaximize?.(); });
  el('anNiuGuanBi').addEventListener('click', qingQiuGuanBi);

  el('anNiuBaoCunGuanBi').addEventListener('click', async () => {
    if (await baoCun()) guanBiQueRen();
  });
  el('anNiuBuBaoCunGuanBi').addEventListener('click', () => { zt.zang = false; guanBiQueRen(); });
  el('anNiuQuXiaoGuanBi').addEventListener('click', () => xianShiGuanBi(false));

  el('anNiuYuLanQuanPing').addEventListener('click', () => { void qieHuanQuanPing(el('yuLanLie')); });
  el('yuLanBiao').addEventListener('dblclick', (e) => {
    if (e.target && e.target.closest && e.target.closest('button')) return;
    void qieHuanQuanPing(el('yuLanLie'));
  });
  el('yuLanLie').addEventListener('dblclick', (e) => {
    if (e.target && (e.target.tagName === 'IFRAME' || (e.target.closest && e.target.closest('button')))) return;
    void qieHuanQuanPing(el('yuLanLie'));
  });
  el('kuaiLie').addEventListener('dblclick', (e) => {
    if (e.target && e.target.closest && e.target.closest('a.luJing')) return;
    const ye = e.target && e.target.closest ? e.target.closest('.docYe,.pptYe,.kuai') : null;
    if (ye) void qieHuanQuanPing(ye);
  });

  el('fenGeTiao').addEventListener('mousedown', (e) => {
    if (e.target && e.target.closest && e.target.closest('.fenGeAnNiu')) return;
    e.preventDefault();
    zt.tuoFenGe = true;
    document.body.classList.add('tuoFenGe');
  });
  document.addEventListener('mousemove', (e) => {
    if (!zt.tuoFenGe) return;
    const box = el('neiRongHang').getBoundingClientRect();
    if (box.width <= 0) return;
    zt.fenLanBi = Math.min(0.8, Math.max(0.2, (e.clientX - box.left) / box.width));
    yingYongFenLanBi();
  });
  document.addEventListener('mouseup', () => {
    if (!zt.tuoFenGe) return;
    zt.tuoFenGe = false;
    document.body.classList.remove('tuoFenGe');
  });
  el('fenGeTiao').addEventListener('dblclick', () => {
    zt.fenLanBi = 0.5;
    sheFenLanShou('zuo', false);
    sheFenLanShou('you', false);
    yingYongFenLanBi();
  });

  /* 第 81 轮项 6：压缩包左右分隔线（拖动改目录宽度；双击恢复 28%） */
  let ysTuoFenGe = false;
  el('yaSuoFenGe').addEventListener('mousedown', (e) => {
    e.preventDefault();
    ysTuoFenGe = true;
    document.body.classList.add('tuoYaSuoFenGe');
  });
  document.addEventListener('mousemove', (e) => {
    if (!ysTuoFenGe) return;
    const wai = el('neiRongWai').getBoundingClientRect();
    const kuan = Math.max(160, Math.min(wai.width * 0.7, e.clientX - wai.left));
    el('yaSuoBaoLie').style.flexBasis = Math.round(kuan) + 'px';
    el('yaSuoBaoLie').style.flexGrow = '0';
    el('yaSuoBaoLie').style.flexShrink = '0';
  });
  document.addEventListener('mouseup', () => {
    if (!ysTuoFenGe) return;
    ysTuoFenGe = false;
    document.body.classList.remove('tuoYaSuoFenGe');
  });
  el('yaSuoFenGe').addEventListener('dblclick', () => {
    el('yaSuoBaoLie').style.flexBasis = '';
    el('yaSuoBaoLie').style.flexGrow = '';
    el('yaSuoBaoLie').style.flexShrink = '';
  });
  el('anNiuShouZuo').addEventListener('mousedown', (e) => e.stopPropagation());
  el('anNiuShouYou').addEventListener('mousedown', (e) => e.stopPropagation());
  el('anNiuShouZuo').addEventListener('click', (e) => { e.stopPropagation(); sheFenLanShou('zuo', !zt.fenLanZuoShou); });
  el('anNiuShouYou').addEventListener('click', (e) => { e.stopPropagation(); sheFenLanShou('you', !zt.fenLanYouShou); });

  /* ── 压缩包 / 密码（第 78 轮项 18） ── */
  el('anNiuJieYaQuanBu').addEventListener('click', () => { void jieYaTiaoMu(null, true); });
  el('anNiuYaSuoGeShi').addEventListener('click', () => {
    const he = el('yaSuoGeShi');
    he.hidden = !he.hidden;
  });
  el('anNiuDaKaiJieYaMuLu').addEventListener('click', () => {
    if (zt.jieYaMuLu) void window.warmy.shellShowItemInFolder?.(zt.jieYaMuLu);
  });
  el('anNiuMimaQue').addEventListener('click', miMaQue);
  el('anNiuMimaQu').addEventListener('click', () => jieShuMiMa(null));
  el('mimaShuRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); miMaQue(); }
    else if (e.key === 'Escape') { e.preventDefault(); jieShuMiMa(null); }
  });
  el('mimaZheZhao').addEventListener('mousedown', (e) => { if (e.target === el('mimaZheZhao')) jieShuMiMa(null); });

  /* ── 下载管理（第 120 轮 W10）：进度来自主进程 will-download，不在这里发网络请求 ── */
  const xiaZai = { items: [], kai: false };
  const xiaZaiDaXiao = (n) => {
    const v = Math.max(0, Number(n) || 0);
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
    return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };
  const xiaZaiZhuangTaiWen = (x) => x.state === 'completed' ? '已完成' : x.state === 'cancelled' ? '已取消' : x.state === 'interrupted' ? '中断' : '下载中';
  const xiaZaiHua = () => {
    const lie = el('xiaZaiLie');
    const ji = el('xiaZaiJiShu');
    if (!lie) return;
    ji.textContent = String(xiaZai.items.length);
    if (!xiaZai.items.length) {
      lie.innerHTML = '<div class="xiaZaiKong">还没有下载。网页里点击下载后会出现在这里，并保存到系统下载目录。</div>';
      return;
    }
    lie.innerHTML = xiaZai.items.map((x) => {
      const pct = x.total > 0 ? Math.min(100, Math.round(x.received / x.total * 100)) : (x.state === 'completed' ? 100 : 0);
      return '<div class="xiaZaiHang" role="listitem" data-id="' + escapeHtml(String(x.id)) + '">'
        + '<div class="xiaZaiMing" title="' + escapeHtml(x.path || '') + '">' + escapeHtml(x.name || '') + '</div>'
        + '<div class="xiaZaiBei">' + escapeHtml(xiaZaiZhuangTaiWen(x)) + ' · ' + escapeHtml(xiaZaiDaXiao(x.received)) + (x.total ? ' / ' + escapeHtml(xiaZaiDaXiao(x.total)) : '') + '</div>'
        + '<div class="xiaZaiTiao"><span style="width:' + pct + '%"></span></div>'
        + '<div class="xiaZaiAnNiu">'
        + '<button type="button" class="tb2" data-xz-open="' + escapeHtml(String(x.id)) + '"' + (x.state === 'completed' ? '' : ' disabled') + '>打开</button>'
        + '<button type="button" class="tb2" data-xz-show="' + escapeHtml(String(x.id)) + '"' + (x.state === 'completed' ? '' : ' disabled') + '>定位</button>'
        + '</div></div>';
    }).join('');
  };
  const xiaZaiKaiGuan = (kai) => {
    xiaZai.kai = !!kai;
    el('xiaZaiMianBan').hidden = !xiaZai.kai;
    el('anNiuWangYeXiaZai').setAttribute('aria-expanded', xiaZai.kai ? 'true' : 'false');
    if (xiaZai.kai) xiaZaiHua();
  };
  const xiaZaiGengXin = (x) => {
    if (!x || !x.id) return;
    const i = xiaZai.items.findIndex((y) => y.id === x.id);
    if (i >= 0) xiaZai.items[i] = x; else xiaZai.items.unshift(x);
    if (xiaZai.kai) xiaZaiHua();
  };
  const xiaZaiJiaZai = async () => {
    try {
      const r = await window.warmy?.nmXiaZaiLieBiao?.();
      if (r?.ok) { xiaZai.items = Array.isArray(r.items) ? r.items : []; if (xiaZai.kai) xiaZaiHua(); }
    } catch { /* 面板打不开不影响浏览 */ }
  };
  el('anNiuWangYeXiaZai').addEventListener('click', (e) => { e.stopPropagation(); xiaZaiKaiGuan(!xiaZai.kai); });
  el('anNiuXiaZaiGuan').addEventListener('click', () => xiaZaiKaiGuan(false));
  el('anNiuXiaZaiQingKong').addEventListener('click', async () => {
    try { await window.warmy?.nmXiaZaiQingKong?.(); } catch { /* noop */ }
    await xiaZaiJiaZai();
  });
  el('xiaZaiLie').addEventListener('click', async (e) => {
    const kai = e.target?.closest?.('[data-xz-open]');
    if (kai) { try { const r = await window.warmy.nmXiaZaiDaKai(Number(kai.dataset.xzOpen)); if (!r?.ok) alert(r?.error || '打开失败'); } catch { /* noop */ } return; }
    const xian = e.target?.closest?.('[data-xz-show]');
    if (xian) { try { await window.warmy.nmXiaZaiXianShi(Number(xian.dataset.xzShow)); } catch { /* noop */ } }
  });
  document.addEventListener('click', (e) => { if (xiaZai.kai && !e.target?.closest?.('#xiaZaiMianBan') && !e.target?.closest?.('#anNiuWangYeXiaZai')) xiaZaiKaiGuan(false); });
  try { window.warmy?.nmXiaZaiGengXin?.((x) => xiaZaiGengXin(x)); } catch { /* noop */ }
  void xiaZaiJiaZai();

  /* ── 网站模式工具栏（第 81 轮项 12） ── */
  el('anNiuWangYeHou').addEventListener('click', () => wangYeHouQian(-1));
  el('anNiuWangYeQian').addEventListener('click', () => wangYeHouQian(1));
  el('anNiuWangYeShua').addEventListener('click', wangYeShua);
  el('anNiuWangYeLiShi').addEventListener('click', (e) => { e.stopPropagation(); wangYeLiShiCaiDan(); });
  el('anNiuWangYeXinBiaoQian').addEventListener('click', () => wangYeXinKaiKai(!zt.wangYe.xinKai));
  el('anNiuWangYeTabJia').addEventListener('click', () => { void wangYeXinAnQuan(WANG_YE_XIN_MO_REN); });
  el('anNiuWangYeFenLan').addEventListener('click', () => { void xunHuanWangYeFenLan(); });
  el('anNiuWangYeGuan').addEventListener('click', async () => {
    if (!(await zhunBeiQieHuanWangYe())) return;
    wangYeKai(false);
  });
  el('anNiuWangYeTabZuo').addEventListener('click', () => { el('wangYeTabLie').scrollBy({ left: -160, behavior: 'smooth' }); setTimeout(gengXinTabGun, 220); });
  el('anNiuWangYeTabYou').addEventListener('click', () => { el('wangYeTabLie').scrollBy({ left: 160, behavior: 'smooth' }); setTimeout(gengXinTabGun, 220); });
  el('wangYeTabLie').addEventListener('scroll', gengXinTabGun, { passive: true });

  /* 第 122 轮：网站分栏分隔条可拖动（每个标签页记住自己的比例；双击回 50%） */
  el('wangYeFenGe').addEventListener('mousedown', (e) => {
    const ka = wangYeDangQian();
    if (!ka || wangYeFenLanShu() === 0) return;
    e.preventDefault();
    zt.wangYe.tuoFenGe = true;
    document.body.classList.add('tuoWangYeFenGe');
    document.body.classList.toggle('tuoWangYeFenGeShu', wangYeFenLanShu() === 3);
    /** 原生 WebContentsView 在 DOM 之上，会吃掉 mousemove：拖动期间先隐藏，松手再按新边界显示 */
    if (!ka.shiBenDi && ka.url) {
      zt.wangYe.yeKuangHide = true;
      zt.wangYe.shiTuKey = '';
      try { wangYeShiTuTongBu(); } catch { /* noop */ }
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!zt.wangYe.tuoFenGe) return;
    const ka = wangYeDangQian();
    if (!ka) return;
    const box = el('wangYeLie').getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const n = wangYeFenLanShu();
    let bi = 0.5;
    if (n === 3) bi = (e.clientY - box.top) / box.height;
    else if (n === 2) bi = (box.right - e.clientX) / box.width;
    else bi = (e.clientX - box.left) / box.width;
    ka.fenLanBi = Math.max(0.2, Math.min(0.8, bi));
    yingYongWangYeFenLan(true);
  });
  document.addEventListener('mouseup', () => {
    if (!zt.wangYe.tuoFenGe) return;
    zt.wangYe.tuoFenGe = false;
    document.body.classList.remove('tuoWangYeFenGe', 'tuoWangYeFenGeShu');
    zt.wangYe.yeKuangHide = false;
    zt.wangYe.shiTuKey = '';
    yingYongWangYeFenLan();
    gengXinWangYeYuan();
  });
  el('wangYeFenGe').addEventListener('dblclick', () => {
    const ka = wangYeDangQian();
    if (!ka || wangYeFenLanShu() === 0) return;
    ka.fenLanBi = 0.5;
    yingYongWangYeFenLan();
  });
  el('wangYeFenGe').addEventListener('keydown', (e) => {
    const ka = wangYeDangQian();
    const n = wangYeFenLanShu();
    if (!ka || !n) return;
    let d = 0;
    if (n === 3) { if (e.key === 'ArrowUp') d = -0.02; else if (e.key === 'ArrowDown') d = 0.02; }
    else { if (e.key === 'ArrowLeft') d = -0.02; else if (e.key === 'ArrowRight') d = 0.02; }
    if (!d) return;
    e.preventDefault();
    ka.fenLanBi = Math.max(0.2, Math.min(0.8, wangYeFenLanBi() + d));
    yingYongWangYeFenLan();
  });
  el('wangYeUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); wangYeSheZhi(el('wangYeUrl').value, true); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      const ka = wangYeDangQian();
      el('wangYeUrl').value = ka ? (ka.shiBenDi ? (ka.luJing || '') : (ka.url || '')) : '';
    }
  });
  el('wangYeSouRu').addEventListener('input', () => wangYeSouCha(1, false));
  el('wangYeSouRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); wangYeSouCha(e.shiftKey ? -1 : 1, true); }
    else if (e.key === 'Escape') { e.preventDefault(); wangYeSouKai(false); }
  });
  el('anNiuWangYeSouShang').addEventListener('click', () => wangYeSouCha(-1, true));
  el('anNiuWangYeSouXia').addEventListener('click', () => wangYeSouCha(1, true));
  el('anNiuWangYeSouGuan').addEventListener('click', () => wangYeSouKai(false));
  el('wangYeKuang').addEventListener('load', () => {
    if (zt.wangYe.kai) gengXinTabGun();
  });

  /* 源码栏事件 */
  el('wangYeYuanWen').addEventListener('input', yuanBianJi);
  el('anNiuYuanBaoCun').addEventListener('click', () => { void yuanBaoCun(); });
  el('anNiuYuanBaoCunXia').addEventListener('click', (e) => { e.stopPropagation(); kaiYuanBaoCunCaiDan(); });
  el('anNiuYuanHouTui').addEventListener('click', () => wangYeHouQian(-1));
  el('anNiuYuanQianJin').addEventListener('click', () => wangYeHouQian(1));
  el('anNiuYuanHuanHang').addEventListener('click', () => {
    zt.wangYe.huanHangKai = zt.wangYe.huanHangKai === false;
    gengXinWangYeYuan();
  });
  el('yuanSouRu').addEventListener('input', () => {
    if (zt.wangYe.yuanDingShi) clearTimeout(zt.wangYe.yuanDingShi);
    zt.wangYe.yuanDingShi = setTimeout(() => { zt.wangYe.yuanDingShi = null; zt.wangYe.souWei = 0; yuanChongXinSouSuo(); }, 120);
  });
  el('yuanSouRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); yuanTiaoDao(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); el('yuanSouRu').value = ''; yuanChongXinSouSuo(); }
  });
  el('anNiuYuanXia').addEventListener('click', () => yuanTiaoDao(1));
  el('anNiuYuanShang').addEventListener('click', () => yuanTiaoDao(-1));
  el('anNiuYuanTiHuan').addEventListener('click', yuanTiHuan);
  el('anNiuYuanSuoXiao').addEventListener('click', () => {
    zt.wangYe.suoFang = Math.max(0.5, Math.round(((zt.wangYe.suoFang || 1) - 0.1) * 10) / 10);
    gengXinWangYeYuan();
  });
  el('anNiuYuanFangDa').addEventListener('click', () => {
    zt.wangYe.suoFang = Math.min(2.5, Math.round(((zt.wangYe.suoFang || 1) + 0.1) * 10) / 10);
    gengXinWangYeYuan();
  });
  el('yuanSuoFangZhi').addEventListener('click', () => { zt.wangYe.suoFang = 1; gengXinWangYeYuan(); });
  el('anNiuWangYeSaveJiXu').addEventListener('click', async () => { if (await yuanBaoCun()) jieShuWangYeWen('save'); });
  el('anNiuWangYeFangQi').addEventListener('click', () => jieShuWangYeWen('discard'));
  el('anNiuWangYeQuXiao').addEventListener('click', () => jieShuWangYeWen(null));
  el('wangYeWeiBaoCun').addEventListener('mousedown', (e) => { if (e.target === el('wangYeWeiBaoCun')) jieShuWangYeWen(null); });

  el('wenBen').addEventListener('input', yiXiuGai);
  // 项 33：滚动同步合并到一帧，避免每个 scroll 事件都读写布局
  const anPaiGunDongWenBen = anPaiZhen(() => {
    const ta = el('wenBen');
    const gl = el('gaoLiang');
    if (gl.scrollTop !== ta.scrollTop) gl.scrollTop = ta.scrollTop;
    if (gl.scrollLeft !== ta.scrollLeft) gl.scrollLeft = ta.scrollLeft;
  });
  el('wenBen').addEventListener('scroll', anPaiGunDongWenBen, { passive: true });

  /* ── 十六进制视图事件（点击选字节 / 键盘导航 / 输入两位十六进制） ── */
  el('shiLiuGunDong').addEventListener('scroll', anPaiHuiShiLiu, { passive: true });
  el('shiLiuGunDong').addEventListener('click', (e) => {
    const s = zt.shiLiu;
    if (!s) return;
    const alvo = e.target && e.target.closest ? e.target.closest('[data-off]') : null;
    if (alvo) {
      const off = Number(alvo.getAttribute('data-off'));
      if (Number.isInteger(off)) { shiLiuDingWei(off); if (s.keBianJi) kaiShiLiuShuRu(); }
      return;
    }
    const hang = e.target && e.target.closest ? e.target.closest('.shiLiuHang') : null;
    if (hang) shiLiuDingWei(Number(hang.dataset.hang) * SHI_LIU_MEI_HANG);
  });
  el('shiLiuGunDong').addEventListener('keydown', (e) => {
    const s = zt.shiLiu;
    if (!s) return;
    const k = e.key;
    if (/^[0-9a-fA-F]$/.test(k) && s.keBianJi) {
      e.preventDefault();
      kaiShiLiuShuRu();
      const shu = el('shiLiuShuRu');
      shu.value = k.toUpperCase();
      return;
    }
    const bu = SHI_LIU_MEI_HANG;
    if (k === 'ArrowLeft') { e.preventDefault(); shiLiuDingWei(s.xuanZhong - 1); }
    else if (k === 'ArrowRight') { e.preventDefault(); shiLiuDingWei(s.xuanZhong + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); shiLiuDingWei(s.xuanZhong - bu); }
    else if (k === 'ArrowDown') { e.preventDefault(); shiLiuDingWei(s.xuanZhong + bu); }
    else if (k === 'PageUp') { e.preventDefault(); shiLiuDingWei(s.xuanZhong - bu * Math.max(1, Math.floor(el('shiLiuGunDong').clientHeight / SHI_LIU_HANG_GAO))); }
    else if (k === 'PageDown') { e.preventDefault(); shiLiuDingWei(s.xuanZhong + bu * Math.max(1, Math.floor(el('shiLiuGunDong').clientHeight / SHI_LIU_HANG_GAO))); }
    else if (k === 'Home') { e.preventDefault(); shiLiuDingWei((Math.floor(s.xuanZhong / bu)) * bu); }
    else if (k === 'End') { e.preventDefault(); shiLiuDingWei(Math.min(s.ziJie - 1, (Math.floor(s.xuanZhong / bu) + 1) * bu - 1)); }
  });
  el('shiLiuShuRu').addEventListener('input', () => {
    const s = zt.shiLiu;
    if (!s) return;
    const shu = el('shiLiuShuRu');
    const zhi = String(shu.value || '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 2);
    shu.value = zhi;
    if (zhi.length === 2) {
      const v = parseInt(zhi, 16);
      const off = s.xuanZhong;
      gaiShiLiuZiJie(off, v);
      shu.hidden = true;
      shiLiuDingWei(off + 1);
    }
  });
  el('shiLiuShuRu').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el('shiLiuShuRu').blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); el('shiLiuShuRu').hidden = true; el('shiLiuGunDong').focus(); }
  });
  el('shiLiuShuRu').addEventListener('blur', () => { el('shiLiuShuRu').hidden = true; });

  el('kuaiLie').addEventListener('click', async (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a.luJing') : null;
    if (!a) return;
    e.preventDefault();
    const p = a.getAttribute('data-lu') || '';
    if (!p) return;
    let cun = false;
    try {
      const r = await window.warmy.luJingCunZai?.([p]);
      cun = !!(r && r.cunZai && r.cunZai[p]);
    } catch (err) {
      cun = false;
    }
    if (!cun) { zhuangTaiWen('这个路径在本机不存在：' + p); return; }
    await jiaZai(p, true);
  });

  // 尺寸变化：工具栏重新收/放；高亮层宽度按新宽度对齐（都合并到 rAF）
  const anPaiChiCun = anPaiZhen(() => { duiQiGaoLiang(); anPaiGongJuLan(); });
  window.addEventListener('resize', () => { anPaiChiCun(); if (zt.wangYe.kai) wangYeShiTuTongBu(); }, { passive: true });
  try {
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => anPaiGongJuLan()).observe(el('gongJuLan'));
      new ResizeObserver(() => { try { huiShiLiu(true); } catch { /* noop */ } }).observe(el('shiLiuGunDong'));
    }
  } catch { /* 老 Electron 没有 ResizeObserver 就只靠 window.resize */ }
  try { document.fonts?.ready?.then?.(() => anPaiGongJuLan()); } catch { /* 字体加载失败不影响布局 */ }

  // 菜单：点外面 / Esc 关闭（捕获阶段，避免被正文的点击处理吃掉）
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#gongJuCaiDan,#guanBiZheZhao,#mimaZheZhao,#wangYeWeiBaoCun,#biaoTiLan,#chuangKouAnNiu')) return;
    if (t.closest('button,a,select')) return;
    if (!t.closest('#zhengWen,#gongJuLan,#wangYeGongJu,#zhuangTaiLan,input,textarea')) return;
    e.preventDefault();
    kaiYouJianCaiDan(e, t);
  });
  document.addEventListener('mousedown', (e) => {
    const m = el('gongJuCaiDan');
    if (!m || m.hidden) return;
    if (m.contains(e.target)) return;
    /** 第 97 轮项 6：点菜单外的任何位置都收起；只有「当前这个展开按钮」交给 click 做切换 */
    const anchor = caiDanZuiHou && caiDanZuiHou.anchor;
    if (anchor && anchor.contains && anchor.contains(e.target)) return;
    guanCaiDan();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('gongJuCaiDan').hidden) { e.preventDefault(); guanCaiDan(); }
  });

  // 未保存就关窗/刷新：先拦一下，并**在页面里弹出我们自己的确认框**。
  // 为什么不是只靠 beforeunload：Electron 默认不弹 Chromium 的确认框，只会阻止卸载；
  // 不补一个可见提示的话，Alt+F4 看起来像"点了没反应"。原生对话框仍建议主进程
  // 监听 will-prevent-unload（见交接清单），但这一层已经做到"有改动一定能看见提示"。
  window.addEventListener('beforeunload', (e) => {
    /** 聊天框临时编辑：关闭不提醒、不保存（改动已实时回传） */
    if (zt.chatEditor) return;
    if (!zt.zang && !youWeiBaoCun()) return;
    e.preventDefault();
    e.returnValue = '';
    xianShiGuanBi(true);
  });
  window.addEventListener('beforeprint', () => {
    if (!el('juanCuo').hidden && !zt.fenLan && el('daYinWenBen')) {
      el('daYinWenBen').textContent = el('wenBen').value;
      el('daYinWenBen').hidden = false;
    }
  });
  window.addEventListener('afterprint', () => { if (el('daYinWenBen')) el('daYinWenBen').hidden = true; });

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' && !el('guanBiZheZhao').hidden) { xianShiGuanBi(false); return; }
    if (ctrl && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (zt.wangYe.kai && wangYeFenLanShu() > 0) void yuanBaoCun();
      else void baoCun();
      return;
    }
    if (ctrl && e.shiftKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (zt.wangYe.kai && wangYeFenLanShu() > 0) void yuanLingCunWei();
      else void lingCunWei();
      return;
    }
    if (ctrl && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      const ka = wangYeDangQian();
      const yuanCheng = !!(zt.wangYe.kai && ka && !ka.shiBenDi && ka.url);
      if (zt.wangYe.kai && wangYeFenLanShu() > 0) { el('yuanSouRu').focus(); el('yuanSouRu').select(); }
      else if (yuanCheng) { wangYeSouKai(true); }
      else { el('souRu').focus(); el('souRu').select(); }
      return;
    }
    if (ctrl && (e.key === 'l' || e.key === 'L') && zt.wangYe.kai) { e.preventDefault(); el('wangYeUrl').focus(); el('wangYeUrl').select(); return; }
    if (ctrl && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      daYin();
      return;
    }
    if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); sheSuoFang(zt.suoFang + 0.1); return; }
    if (ctrl && e.key === '-') { e.preventDefault(); sheSuoFang(zt.suoFang - 0.1); return; }
    if (ctrl && e.key === '0') { e.preventDefault(); chongZhiShiTu(); return; }
    if (ctrl && e.key === '9') { e.preventDefault(); shiYingChuangKou(); return; }
    if (e.key === 'F3') {
      e.preventDefault();
      const ka = wangYeDangQian();
      if (zt.wangYe.wangSou.kai && zt.wangYe.kai && ka && !ka.shiBenDi && ka.url) wangYeSouCha(e.shiftKey ? -1 : 1, true);
      else buJin(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (zt.wangYe.kai) wangYeHouQian(-1); else el('anNiuHouTui').click();
      return;
    }
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      if (zt.wangYe.kai) wangYeHouQian(1); else el('anNiuQianJin').click();
      return;
    }
    if (e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); sheHuanHang(!zt.huanHangKai); }
  });

  function sheHuanHang(kai) {
    zt.huanHangKai = !!kai;
    const ta = el('wenBen');
    ta.wrap = zt.huanHangKai ? 'soft' : 'off';
    ta.classList.toggle('buHuanHang', !zt.huanHangKai);
    el('gaoLiang').classList.toggle('buHuanHang', !zt.huanHangKai);
    el('anNiuHuanHang').classList.toggle('kai', zt.huanHangKai);
    el('anNiuHuanHang').setAttribute('aria-pressed', zt.huanHangKai ? 'true' : 'false');
    duiQiGaoLiang();
    anPaiGongJuLan();
    if (zt.souCi) tiaoDaoPiPei();
    gongJuCaiDanShuaXin();
  }

  /* ── 启动 ─────────────────────────────────────────────── */
  (function qiDong() {
    try {
      window.warmy?.settingsGet?.().then((r) => {
        const tz = r && r.settings && r.settings.timezone;
        if (tz) TZ.setTimezone(tz);
      }).catch(() => { /* 读不到就按系统时区显示 */ });
    } catch { /* noop */ }
    const lu = String(canShu.get('path') || '');
    if (chatEditor) {
      try {
        document.body.classList.add('chatEditorMode');
        document.title = '编辑聊天内容 · nm 文件查看器';
        for (const id of ['anNiuBaoCun', 'anNiuLingCunWei', 'anNiuZongShiDing', 'anNiuXiFu']) {
          const b = el(id);
          if (b) b.style.display = 'none';
        }
      } catch { /* noop */ }
    }
    sheHuanHang(true);
    gengXinHouQianJin();
    el('anNiuTiHuan').disabled = true;
    el('tiHuanRu').disabled = true;
    el('souJi').textContent = '0/0';
    el('anNiuXiFu').setAttribute('aria-pressed', 'true');
    el('anNiuXiFu').classList.add('kai');
    el('anNiuZongShiDing').setAttribute('aria-pressed', 'false');
    zt.ziDong = true;
    sheZiDongBaoCun();
    anPaiGongJuLan();
    try {
      const he = el('wangYeKuangHe');
      if (he && typeof ResizeObserver === 'function') {
        new ResizeObserver(() => { if (zt.wangYe.kai) wangYeShiTuTongBu(); }).observe(he);
      }
    } catch { /* noop */ }
    try {
      window.warmy.nmWangYeZhuangTai?.((d) => {
        if (!d || Number(d.id) !== chuangKouId) return;
        /** 主进程拦截的“在新标签页打开”：开关开启后的链接点击 / target=_blank 都走这里 */
        if (d.openInNewTab) {
          const u = guiFanWangYe(String(d.openInNewTab));
          if (u) {
            void wangYeXinAnQuan(u).then((ok) => { if (ok) zhuangTaiWen('已在新标签页打开 · ' + u); });
          } else {
            zhuangTaiWen('已拦截非 http(s) 新标签页：' + String(d.openInNewTab).slice(0, 80));
          }
          return;
        }
        const ka = wangYeDangQian();
        if (!ka || ka.shiBenDi) return;
        if (d.shortcut) {
          const s = String(d.shortcut);
          if (s === 'find') wangYeSouKai(true);
          else if (s === 'address') { try { el('wangYeUrl').focus(); el('wangYeUrl').select(); } catch { /* noop */ } }
          else if (s === 'back') wangYeHouQian(-1);
          else if (s === 'forward') wangYeHouQian(1);
          else if (s === 'reload') wangYeShua();
          else if (s === 'print') daYin();
          else if (s === 'escape') wangYeSouKai(false);
        }
        if (d.nav) {
          ka.remoteNav = { canGoBack: !!d.nav.canGoBack, canGoForward: !!d.nav.canGoForward };
          ka.loading = !!d.nav.loading;
          if (d.nav.url && String(d.nav.url) !== ka.url) {
            ka.url = String(d.nav.url);
            /** 换页后旧源码作废；下次打开源码栏时重新向主进程读取 */
            ka.yuan = null;
            ka.yuanUrl = '';
            ka.yuanErr = '';
          }
        }
        if (d.found) {
          const f = d.found;
          if (f.query === '') {
            wangYeSouJiWen('0/0');
            if (zt.wangYe.wangSou.kai) wangYeSouKai(false);
          } else if (f.pending) wangYeSouJiWen('…');
          else wangYeSouJiWen(f.matches ? `${Math.max(1, Number(f.active) || 1)}/${Number(f.matches)}` : '0/0');
        }
        if (d.url && String(d.url) !== ka.url) {
          ka.url = String(d.url);
          ka.yuan = null;
          ka.yuanUrl = '';
          ka.yuanErr = '';
        }
        if (d.title) ka.title = String(d.title);
        if (d.crashed) { zt.wangYe.shiTuKey = ''; zhuangTaiWen('网页进程异常：' + (d.reason || '')); }
        else if (d.blocked) zhuangTaiWen('已拦截非 http(s) 跳转：' + String(d.blocked).slice(0, 80));
        else if (d.loading === true) zhuangTaiWen('载入中 · ' + (ka.url || ''));
        else if (d.loading === false) {
          /** 页面渲染完成（含脚本改过的 DOM）：清掉旧源码，源码栏开着时马上重新读取 */
          ka.yuan = null;
          ka.yuanUrl = '';
          ka.yuanErr = '';
          zhuangTaiWen('网页 · ' + (ka.url || ''));
        }
        gengXinWangYe();
      });
    } catch { /* noop */ }
    if (!lu) {
      tiShiWen('没有拿到文件路径（这个窗口需要由 WArmy 打开某个文件才会显示内容）。');
      zhuangTaiWen('就绪');
      return;
    }
    void jiaZai(lu, true).then(() => {
      /** 聊天编辑器打开后直接聚焦正文：用户马上可以 Ctrl+Z / 输入，撤销快捷键不用先点一下 */
      if (chatEditor) { try { el('wenBen')?.focus(); } catch { /* noop */ } }
    });
  })();
})();
