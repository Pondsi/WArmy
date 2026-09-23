/**
 * 把自定义标识符 / 契约字符串改成**汉语拼音全拼**（docs/TECHNICAL.md §3.6）。
 *
 * v2（产品主授权全面改名）：
 *  - **成员/字段名**：声明 + 所有 `.field` / `field:` 一起改
 *  - **字符串契约**：IPC 频道、DOM id、CSS 类名（映射表驱动，引用必须完整）
 *  - 能确定含义的改；不能确定的按现名猜测后改
 *  - 保留：JS/TS 关键字、Node/Electron/DOM 外部 API、专有名词
 *
 * 用法：
 *   node scripts/pinyin-rename.mjs --pkg board --local-only | --global-only | --dry | --invert
 *   node scripts/pinyin-rename.mjs --strings [--dry] [--invert]
 *   node scripts/pinyin-rename.mjs --check-collisions
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(selfDir, '..');
const MAP_FILE = path.join(ROOT, 'docs', 'PINYIN-MAP.json');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const invert = args.includes('--invert');
const localOnly = args.includes('--local-only');
const globalOnly = args.includes('--global-only');
const stringsMode = args.includes('--strings');
const pkgs = [];
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pkg' && args[i + 1]) pkgs.push(args[++i]);
  if (args[i] === '--file' && args[i + 1]) files.push(args[++i]);
}

const doc = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const flip = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [v, k]));

const RESERVED = new Set([
  'break','case','catch','class','const','continue','debugger','default','delete','do',
  'else','enum','export','extends','false','finally','for','function','if','import','in',
  'instanceof','new','null','return','super','switch','this','throw','true','try',
  'typeof','var','void','while','with','yield','await','async','static','get','set',
  'any','boolean','constructor','declare','infer','interface','is','keyof','let','module',
  'namespace','never','object','of','package','private','protected','public','readonly',
  'require','number','string','symbol','bigint','type','undefined','unique','unknown',
  'abstract','as','asserts','assert','satisfies','override','out','from','global','accessor',
  'Array','ArrayBuffer','BigInt','Boolean','Buffer','DataView','Date','Error','EvalError',
  'Function','Infinity','Intl','JSON','Map','Math','NaN','Number','Object','Promise',
  'Proxy','RangeError','ReferenceError','Reflect','RegExp','Set','String','Symbol',
  'SyntaxError','TypeError','URIError','URL','URLSearchParams','Uint8Array','WeakMap',
  'WeakSet','console','document','exports','globalThis','navigator','process','setInterval',
  'setTimeout','clearInterval','clearTimeout','window'
]);

/** 外部 API / 外部成员黑名单：出现 `.name` / `ming:` 也绝不改 */
const EXTERNAL_MEMBERS = new Set([
  'length','push','pop','shift','unshift','slice','splice','concat','join','split',
  'indexOf','lastIndexOf','includes','forEach','map','filter','reduce','reduceRight',
  'some','every','find','findIndex','findLast','sort','reverse','flat','flatMap',
  'fill','copyWithin','at','toString','valueOf','hasOwnProperty','isPrototypeOf',
  'propertyIsEnumerable','keys','values','entries','from','of','isArray','fromAsync',
  'then','catch','finally','apply','call','bind','ming','constructor','prototype',
  'arguments','caller','callee','stack','message','cause','code','errno','syscall',
  'errors','aggregate','species','raw',
  'trim','trimStart','trimEnd','charAt','charCodeAt','codePointAt','startsWith','endsWith',
  'repeat','padStart','padEnd','replace','replaceAll','match','matchAll','search',
  'normalize','localeCompare','substring','toLowerCase','toUpperCase',
  'style','classList','className','innerHTML','outerHTML','textContent','innerText',
  'dataset','value','checked','disabled','selected','yinCang','id','href','src','srcset',
  'alt','biaoTi','type','placeholder','readOnly','multiple','files','form','elements',
  'options','selectedIndex','parentElement','parentNode','children','childElementCount',
  'firstChild','lastChild','firstElementChild','lastElementChild','nextSibling',
  'previousSibling','nextElementSibling','previousElementSibling','nodeType','nodeName',
  'ownerDocument','baseURI','querySelector','querySelectorAll','getElementById',
  'getElementsByClassName','getElementsByTagName','createElement','createTextNode',
  'createDocumentFragment','addEventListener','removeEventListener','dispatchEvent',
  'appendChild','removeChild','insertBefore','replaceChild','cloneNode','contains',
  'closest','matches','focus','blur','click','submit','reset','select','setSelectionRange',
  'preventDefault','stopPropagation','stopImmediatePropagation','getAttribute',
  'setAttribute','removeAttribute','hasAttribute','scrollIntoView','scrollTo','scrollBy',
  'getBoundingClientRect','getClientRects','offsetWidth','offsetHeight','offsetTop',
  'offsetLeft','clientWidth','clientHeight','scrollTop','scrollLeft','scrollWidth',
  'scrollHeight','insertAdjacentHTML','insertAdjacentElement','remove','before','after',
  'replaceWith','prepend','append','toggleAttribute','animate','computedStyleMap',
  'matchMedia','getComputedStyle','requestAnimationFrame','cancelAnimationFrame',
  'localStorage','sessionStorage','getItem','setItem','removeItem','clear','key',
  'cwd','env','argv','argv0','execPath','execArgv','stdout','stderr','stdin','pid','ppid',
  'exit','exitCode','kill','platform','arch','version','versions','homedir','tmpdir',
  'hostname','networkInterfaces','cpus','totalmem','freemem','uptime','loadavg',
  'memoryUsage','nextTick','hrtime','binding',
  'readFile','writeFile','readFileSync','writeFileSync','existsSync','exists','mkdir',
  'mkdirSync','readdir','readdirSync','stat','statSync','lstat','lstatSync','unlink',
  'unlinkSync','rename','renameSync','copyFile','copyFileSync','appendFile',
  'appendFileSync','access','accessSync','rm','rmSync','rmdir','rmdirSync',
  'openSync','closeSync','readSync','writeSync','promises','constants',
  'createReadStream','createWriteStream','watch','watchFile','unwatchFile',
  'realpath','realpathSync','symlink','symlinkSync','readlink','readlinkSync',
  'chmod','chmodSync','chown','chownSync','utimes','utimesSync','truncate','truncateSync',
  'opendir','opendirSync','cp','cpSync',
  'normalize','join','dirname','basename','extname','relative','isAbsolute','parse',
  'format','toNamespacedPath','sep','delimiter','posix','win32',
  'spawn','spawnSync','execSync','execFile','execFileSync','fork','unref','ref',
  'connected','channel','stdio','detached','uid',
  'qiYong','off','once','emit','addListener','removeListener','removeAllListeners',
  'listenerCount','listeners','prependListener','prependOnceListener','rawListeners',
  'pipe','unpipe','pause','resume','destroy','end','cork','uncork','setEncoding',
  'setKeepAlive','setNoDelay','address','remoteAddress','remotePort',
  'localAddress','localPort','bytesRead','bytesWritten','connecting','pending',
  'headers','statusCode','statusMessage','httpVersion','url','method','ti','query',
  'webContents','loadURL','loadFile','show','isVisible','isMinimized','isMaximized',
  'isFullScreen','isDestroyed','setTitle','getTitle','setBounds','getBounds',
  'getContentBounds','setContentBounds','center','maximize','minimize','restore',
  'unmaximize','setFullScreen','setMenuBarVisibility','setAutoHideMenuBar',
  'openDevTools','closeDevTools','faSong','reload','setIgnoreMouseEvents',
  'setAlwaysOnTop','isAlwaysOnTop','setPosition','getPosition','setSize','getSize',
  'setMinimumSize','setMaximumSize','flashFrame','setProgressBar','setOverlayIcon',
  'setThumbarButtons','setAppDetails','setIcon','setMenu','removeMenu',
  'requestSingleInstanceLock','hasSingleInstanceLock','quit','relaunch',
  'getPath','setPath','getName','setName','getVersion','getLocale','getSystemLocale',
  'isPackaged','dock','huiZhang','bounce','safeStorage','isEncryptionAvailable',
  'encryptString','decryptString','showOpenDialog','showSaveDialog','showMessageBox',
  'showErrorBox','BrowserWindow','Tray','Menu','MenuItem','nativeImage','clipboard',
  'globalShortcut','shell','dialog','ipcMain','ipcRenderer','contextBridge',
  'powerMonitor','screen','session','protocol','netLog','crashReporter',
  'update','digest','copy','equals','compare','byteLength','isBuffer','isEncoding',
  'alloc','allocUnsafe','createHash','createHmac','createCipheriv','createDecipheriv',
  'randomBytes','randomUUID','randomInt','timingSafeEqual','generateKeyPair',
  'generateKeyPairSync','sign','verify','publicKey','privateKey','deriveBits','deriveKey',
  'status','ok','data','meta','opts','args','params','payload','signal','timeout','retry',
  'size','width','height','count','total','min','max','avg','sum','index','start','to',
  'at','by','in','out','up','down','yuYan','theme','debug','log','logs',
  'time','date','timestamp','createdAt','updatedAt','deletedAt',
  'user','username','password','token','secret','salt','hash','sig',
  'host','port','family','address','addresses','ip','ipv4','ipv6',
  'enabled','jiHuo','inactive','ready','pending','failed','success',
  'parent','next','prev','first','last','current','default','all',
  'content','role','model','provider','apiKey','baseURL','xiaoXiJi','temperature',
  'stream','tools','tool_calls','tool_choice','system','assistant','function',
  'usage','prompt_tokens','completion_tokens','total_tokens','choices','delta',
  'finish_reason','object','created','revised_prompt',
  'path','file','dir','result','results','error','errors','biaoQian','text','html','css',
  'js','ts','json','xml','uri','href','src','alt','biaoTi','value','id','type','mode',
  'ed25519','x25519','sha256','sha512','sha1','md5','aes','gcm','hmac','hkdf',
  'scrypt','pbkdf2','uuid','jwt','oauth','smtp','imap','pop3','http','https',
  'tcp','udp','ws','wss','dht','p2p','tls','ssl','dns','api','cli','ipc',
  'jsonl','yaml','yml','toml','csv','svg','png','jpg','jpeg','gif','webp','ico',
  'mp3','mp4','wav','pdf','md','txt','docker','podman','wsl','nerdctl','colima','lima',
  'lxd','incus','kata','ubuntu','debian','alpine','windows','linux','darwin','win32',
  'macos','utf8','utf16','hex','base64','base32','base33','ascii','binary','buffer',
  'openai','anthropic','ollama','deepseek','wasm','simd','onnx','bert','acp',
  'guid','nanoid','cron','semver','npm','node','git','ssh','github','electron',
  'warmy','wamy',
  'abs','on','off','send','signal','meta','name','flag','body','hidden','input',
  'open','close','filter','find','split','includes','forEach','reduce','some','every',
  'toString','valueOf','apply','call','bind','style','classList','className',
  'innerHTML','textContent','dataset','checked','selected','placeholder','form',
  'message','code','stack','cause','headers','method','timeout','retry','params',
  'buffer','stream','read','write','destroy','pipe','pause','resume','event',
  'once','emit','addListener','removeListener','error','errors','data','type',
  'value','id','path','file','status','state','mode','key','time','user','log',
  'host','port','url','src','alt','title','label','text','size','width','height',
  'center','row','col','item','items','block','pane','out','in','to','at','by',
  'all','first','last','next','prev','current','default','enabled','disabled',
  'active','ready','pending','result','results','options','config','debug',
  'version','platform','locale','theme','content','role','model','provider',
  'children','parent','length','push','pop','shift','unshift','concat','join',
  'slice','keys','values','entries','from','of','map','then','catch','finally',
  'signal','meta','fallback','abs','min','max','random','floor','ceil','round',
  'pow','sqrt','log','exp','sin','cos','tan','atan2','imul','clz32','hypot',
  'assign','freeze','seal','create','defineProperty','getOwnPropertyDescriptor',
  'getPrototypeOf','setPrototypeOf','isExtensible','preventExtensions',
]);

function externalImportNames(fileList) {
  const names = new Set();
  const IMPORT_RE = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
  for (const f of fileList) {
    if (isThirdParty(f)) continue;
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    let m;
    while ((m = IMPORT_RE.exec(src))) {
      const mod = m[3] || '';
      const isOurCode = mod.startsWith('.') || mod.startsWith('@warmy/') || mod.startsWith('/') || mod.startsWith('packages/');
      if (isOurCode) continue;
      if (m[1]) names.add(m[1]);
      for (const part of String(m[2] || '').split(',')) {
        const nm = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
        if (nm && /^[A-Za-z_$][\w$]*$/.test(nm)) names.add(nm);
      }
    }
  }
  return names;
}

function safeMap(map) {
  const out = {};
  const dropped = [];
  const external = externalImportNames(allRepoFiles());
  for (const [from, to] of Object.entries(map || {})) {
    if (RESERVED.has(from) || RESERVED.has(to) || EXTERNAL_MEMBERS.has(from) || external.has(from)) {
      dropped.push(from); continue;
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(from) || !/^[A-Za-z_$][\w$]*$/.test(to)) { dropped.push(from); continue; }
    out[from] = to;
  }
  if (dropped.length) {
    console.log('[guard] 跳过 ' + dropped.length + '（保留字/外部API/非法名），前40: ' + dropped.slice(0, 40).join(' , '));
  }
  return out;
}

function regexStartsAt(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  if (k < 0) return false;
  const prev = src[k];
  if ('([{=,:;!&|?+-*%~^<>'.includes(prev)) return true;
  const word = (src.slice(0, k + 1).match(/[A-Za-z_$][A-Za-z0-9_$]*$/) || [''])[0];
  return ['return','typeof','case','in','of','new','delete','void','instanceof','do','else','yield','await'].includes(word);
}

function scanRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '\n') return -1;
    if (inClass) { if (c === ']') inClass = false; j += 1; continue; }
    if (c === '[') { inClass = true; j += 1; continue; }
    if (c === '/') {
      j += 1;
      while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
      return j;
    }
    j += 1;
  }
  return -1;
}

function segment(src) {
  const segs = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { segs.push({ code: true, text: buf }); buf = ''; } };
  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === '/' && nx === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = src.length;
      flush(); segs.push({ code: false, text: src.slice(i, j) }); i = j; continue;
    }
    if (ch === '/' && nx === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      flush(); segs.push({ code: false, text: src.slice(i, j) }); i = j; continue;
    }
    if (ch === '/' && regexStartsAt(src, i)) {
      const j = scanRegex(src, i);
      if (j > 0) { flush(); segs.push({ code: false, text: src.slice(i, j) }); i = j; continue; }
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === ch) { j += 1; break; }
        j += 1;
      }
      flush(); segs.push({ code: false, text: src.slice(i, Math.min(j, src.length)) }); i = Math.min(j, src.length); continue;
    }
    if (ch === '`') {
      flush();
      let j = i + 1;
      let lit = '`';
      while (j < src.length) {
        if (src[j] === '\\') { lit += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === '`') { lit += '`'; j += 1; break; }
        if (src[j] === '$' && src[j + 1] === '{') {
          segs.push({ code: false, text: lit + '${' });
          lit = '';
          let depth = 1;
          let k = j + 2;
          while (k < src.length && depth > 0) {
            const c = src[k];
            if (c === '/' && src[k + 1] === '/') {
              const nl = src.indexOf('\n', k);
              k = nl < 0 ? src.length : nl;
              continue;
            }
            if (c === '/' && src[k + 1] === '*') {
              const close = src.indexOf('*/', k + 2);
              k = close < 0 ? src.length : close + 2;
              continue;
            }
            if (c === '/' && regexStartsAt(src, k)) {
              const rEnd = scanRegex(src, k);
              if (rEnd > 0) { k = rEnd; continue; }
            }
            if (c === '{') depth += 1;
            else if (c === '}') { depth -= 1; if (depth === 0) break; }
            if (c === '"' || c === "'" || c === '`') {
              let m = k + 1;
              while (m < src.length) {
                if (src[m] === '\\') { m += 2; continue; }
                if (src[m] === c) { m += 1; break; }
                m += 1;
              }
              k = m;
              continue;
            }
            k += 1;
          }
          for (const inner of segment(src.slice(j + 2, k))) segs.push(inner);
          segs.push({ code: false, text: '}' });
          j = k + 1;
          lit = '';
          continue;
        }
        lit += src[j];
        j += 1;
      }
      if (lit) segs.push({ code: false, text: lit });
      i = j;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return segs;
}

/** 标识符改名：裸名 + 点号成员（.field）+ 对象键（field: 已含在裸名匹配里） */
function applyMap(src, map) {
  let changed = 0;
  let delta = 0;
  const segs = segment(src);
  const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  for (const seg of segs) {
    if (!seg.code) continue;
    let text = seg.text;
    for (const [from, to] of entries) {
      const esc = from.replace(/\$/g, '\\$');
      const rx = new RegExp('(?<![A-Za-z0-9_$])((?:\\\\.)?)' + esc + '(?![A-Za-z0-9_$])', 'g');
      text = text.replace(rx, (match, dian) => {
        changed += 1;
        delta += to.length - from.length;
        return (dian || '') + to;
      });
    }
    seg.text = text;
  }
  return { text: segs.map((s) => s.text).join(''), changed, delta };
}

/**
 * 字符串契约：只在**字符串/HTML/CSS**里改，绝不动代码标识符。
 * 教训：整文件替换会把 CSS 类 `on` 写进 `sock.on(`，把 `body` 写进 RequestInit。
 */
function applyStringMap(src, map, filePath) {
  let changed = 0;
  let delta = 0;
  const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  const isMarkup = /\.(css|html)$/i.test(filePath || '');
  let text;
  if (isMarkup) {
    text = src;
  } else {
    // 代码文件：只替换字符串/模板字面量段
    const segs = segment(src);
    for (const seg of segs) {
      if (seg.code) continue;
      let t = seg.text;
      for (const [from, to] of entries) {
        if (!from || from === to) continue;
        const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // ⚠️ 模板字面量保护：禁止把 `${ident}` 整段或去掉 $ 的 ident 写回模板正文。
        // 历史事故：批量替换把 `prefix-${Date.now()}` 改成 `prefix-Date.now()`（丢了 ${}），
        // 造成 recordId 全冲突。标识符替换只作用于代码标识符位，不得改写模板字符串正文里的英文词。
        const rx = new RegExp('(?<![A-Za-z0-9_:-])' + esc + '(?![A-Za-z0-9_-])', 'g');
        t = t.replace(rx, () => {
          changed += 1;
          delta += to.length - from.length;
          return to;
        });
      }
      seg.text = t;
    }
    return { text: segs.map((s) => s.text).join(''), changed, delta };
  }
  for (const [from, to] of entries) {
    if (!from || from === to) continue;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('(?<![A-Za-z0-9_:-])' + esc + '(?![A-Za-z0-9_-])', 'g');
    text = text.replace(rx, () => {
      changed += 1;
      delta += to.length - from.length;
      return to;
    });
  }
  return { text, changed, delta };
}

function walk(dir, acc = [], extraExt = false) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'vendor' || e.name === '.git' || e.name === 'release' || e.name === 'win-unpacked' || e.name === 'out' || e.name === 'build') continue;
      walk(p, acc, extraExt);
    } else if (extraExt ? /\.(ts|tsx|js|mjs|cjs|css|html)$/.test(e.name) : /\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const isThirdParty = (p) => /(^|[\\/])(vendor|node_modules|dist|release|win-unpacked|\.git|out|build)([\\/]|$)/.test(p);

function assertSafeWrite(f, before, after, delta) {
  const count = (s, c) => (s.match(new RegExp('\\' + c, 'g')) || []).length;
  const pairs = [['{', '}'], ['(', ')'], ['[', ']']];
  for (const [o, c] of pairs) {
    const b = count(before, o) + '/' + count(before, c);
    const a = count(after, o) + '/' + count(after, c);
    if (b !== a) throw new Error(f + ': bracket count changed ' + o + c + ' ' + b + ' -> ' + a);
  }
  const hadNl = before.endsWith('\n');
  if (after.endsWith('\n') !== hadNl) throw new Error(f + ': trailing newline changed');
  const crlfCount = (s) => (s.match(/\r\n/g) || []).length;
  if (crlfCount(after) !== crlfCount(before)) throw new Error(f + ': CRLF style changed');
  if (after.length - before.length !== delta) {
    throw new Error(f + ': length delta ' + (after.length - before.length) + ' != ' + delta);
  }
  if (after.indexOf('\u0000') >= 0) throw new Error(f + ': NUL leaked');
}

const REPO_CODE_ROOTS = ['packages', 'spikes', 'scripts'];
const allRepoFiles = (extraExt = false) => {
  const acc = [];
  for (const r of REPO_CODE_ROOTS) walk(path.join(ROOT, r), acc, extraExt);
  return acc;
};
const targetFiles = () => {
  const out = files.map((f) => path.resolve(ROOT, f));
  for (const p of pkgs) out.push(...walk(path.join(ROOT, 'packages', p, 'src')));
  return out;
};

function writeFileSafe(f, src, text, delta) {
  if (dry) return;
  assertSafeWrite(f, src, text, delta);
  fs.writeFileSync(f, text, 'utf8');
}

function run(biaoQian, list, map) {
  let total = 0;
  const touched = [];
  let skipped = 0;
  for (const f of list) {
    if (isThirdParty(f)) { skipped += 1; continue; }
    const src = fs.readFileSync(f, 'utf8');
    const { text, changed, delta } = applyMap(src, map);
    if (!changed) continue;
    total += changed;
    touched.push([path.relative(ROOT, f), changed]);
    writeFileSafe(f, src, text, delta);
  }
  console.log('\n[' + (invert ? 'invert ' : '') + biaoQian + '] files=' + list.length + ' replacements=' + total + (dry ? ' (dry-run)' : '') + (skipped ? ' skipped=' + skipped : ''));
  for (const [f, n] of touched.slice(0, 40)) console.log('  ' + String(n).padStart(4) + '  ' + f);
  if (touched.length > 40) console.log('  ... +' + (touched.length - 40) + ' files');
  return total;
}

function runLocal(targets) {
  let total = 0;
  const touched = [];
  let skipped = 0;
  const pkgFiles = [];
  for (const f of targets) {
    if (isThirdParty(f)) { skipped += 1; continue; }
    pkgFiles.push(f);
  }
  for (const f of pkgFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const { text, changed, delta } = applyMap(src, LOCAL);
    if (!changed) continue;
    total += changed;
    touched.push([path.relative(ROOT, f), changed]);
    writeFileSafe(f, src, text, delta);
  }
  console.log('\n[' + (invert ? 'invert ' : '') + 'local] files=' + targets.length + ' replacements=' + total + (dry ? ' (dry-run)' : '') + (skipped ? ' skipped=' + skipped : ''));
  for (const [f, n] of touched.slice(0, 40)) console.log('  ' + String(n).padStart(4) + '  ' + f);
  if (touched.length > 40) console.log('  ... +' + (touched.length - 40) + ' files');
  return total;
}

function runStrings() {
  const maps = [
    ['ipc', STRINGS.ipc],
    ['domId', STRINGS.domId],
    ['cssClass', STRINGS.cssClass],
    ['i18nKey', STRINGS.i18nKey]
  ].filter(([, m]) => m && Object.keys(m).length);
  if (!maps.length) {
    console.log('[strings] map empty');
    return 0;
  }
  const list = allRepoFiles(true);
  let grand = 0;
  for (const [biaoQian, map] of maps) {
    let total = 0;
    const touched = [];
    for (const f of list) {
      if (isThirdParty(f)) continue;
      const src = fs.readFileSync(f, 'utf8');
      const { text, changed, delta } = applyStringMap(src, map, f);
      if (!changed) continue;
      total += changed;
      grand += changed;
      touched.push([path.relative(ROOT, f), changed]);
      writeFileSafe(f, src, text, delta);
    }
    console.log('\n[strings:' + (invert ? 'invert ' : '') + biaoQian + '] keys=' + Object.keys(map).length + ' replacements=' + total + (dry ? ' (dry-run)' : ''));
    for (const [f, n] of touched.slice(0, 25)) console.log('  ' + String(n).padStart(4) + '  ' + f);
    if (touched.length > 25) console.log('  ... +' + (touched.length - 25) + ' files');
  }
  return grand;
}

function checkCollisions() {
  const byTarget = new Map();
  for (const [src, dst] of Object.entries(Object.assign({}, GLOBAL, LOCAL))) {
    const arr = byTarget.get(dst) || [];
    arr.push(src);
    byTarget.set(dst, arr);
  }
  const dups = [...byTarget.entries()].filter(([, arr]) => arr.length > 1);
  if (!dups.length) {
    console.log('collision-check: no collisions');
    return 0;
  }
  console.log('collision-check: found collisions:');
  for (const [dst, arr] of dups) console.log('  ' + dst + '  <=  ' + arr.join(' , '));
  return dups.length;
}

// maps loaded after walk/allRepoFiles defined so safeMap can use externalImportNames
const GLOBAL = safeMap(invert ? flip(doc.global) : doc.global || {});
const LOCAL = safeMap(invert ? flip(doc.local) : doc.local || {});
const STRINGS = invert
  ? { ipc: flip(doc.strings && doc.strings.ipc), domId: flip(doc.strings && doc.strings.domId), cssClass: flip(doc.strings && doc.strings.cssClass), i18nKey: flip(doc.strings && doc.strings.i18nKey) }
  : { ipc: (doc.strings && doc.strings.ipc) || {}, domId: (doc.strings && doc.strings.domId) || {}, cssClass: (doc.strings && doc.strings.cssClass) || {}, i18nKey: (doc.strings && doc.strings.i18nKey) || {} };

if (args.includes('--check-collisions')) {
  const n = checkCollisions();
  process.exit(n ? 1 : 0);
}

let sum = 0;
if (stringsMode) {
  sum += runStrings();
} else {
  if (!localOnly) sum += run('global', allRepoFiles(), GLOBAL);
  if (!globalOnly) sum += runLocal(targetFiles());
}
console.log('\ntotal replacements: ' + sum);
if (!dry && sum && !invert) console.log('next: tsc -b + verify suite');
