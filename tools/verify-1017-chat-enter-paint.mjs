// ===== 常驻回归：#1017 进聊天页「没有加载动画缓冲、页面卡几秒」=====
// 用户原话：「进入桌面，然后点击进入聊天，还是没有加载动画缓冲啊，导致页面卡几秒」。
// 根因（零机型分支，纯时序；纯 HEAD 无头实测取证）：enterChat 把「切页 + 顶进度条」与重活
// （loadMsgs 里同步 parse LS 快照、权威收尾、整窗重建、贴底三连、chatEntrySettle）放在**同一个任务**里，
// 而进度条的撤销点（#841j 同窗补丁命中当场 `chatRebuilding=false`）也在这个任务内 ⇒ 进度条的
// 「置位→撤销」窗口完全落在一帧之内，浏览器一个中间帧都画不出来，用户看到的顺序是
// 「点下去 → 主线程被占住（实测 4× 节流下 878ms 长任务）→ 聊天页与记录一起出现」，全程零反馈。
// 实测数据（无头 Chrome，390×844，探针只读、不改写 hidden）：
//   · 纯 HEAD：进度条 hidden false→true 相隔 **2ms（1×）/ 16ms（4×）**，可见帧数 **0**；
//     同一次进入里 4× 节流下有一记 878ms 的长任务（真机上就是用户说的「卡几秒」）。
//   · 修后（#1017 把重活挪到「聊天页＋进度条」真正上屏之后的一帧）：可见帧数 ≥1，
//     可见时长 158ms（1×）/ 372ms（4×）。
// 断言（每场景全新存储；4× CPU 节流＝中低端机等效慢速，把重活拉长以便稳定采样）：
//  F 组（用户报障的那条路：启动落在桌面 → 点聊天图标；屏上窗口已预渲＝走同窗补丁快路）
//    F1 前提：点击前 进度条隐藏 + 聊天页隐藏 + 桌面可见（防「跑在别的状态上」的假绿）
//    F2 ★主判据：点击后**至少有一帧**真的把进度条画到屏上（可见＝非 hidden＋有几何框）
//       —— HEAD 恒 0 帧（置位与撤销同任务）＝红；修后 ≥1 帧＝绿
//    F3 进度条不许卡死：点击后 3s 内收起，且随后 1.5s 保持收起
//    F4 内容照常到达：点击后出现气泡
//    F5 收尾不回归：贴底（gap≤8）且窗口尾贴最新（lastIdx===maxIdx）、data-idx 升序无重复
//  注：「进页有空窗期时进度条必须在屏上」那条不变量（#841/#1010 家族）由 verify-1010-chat-settle-sync.mjs
//  与 verify-chat-entry-load-window.mjs 覆盖；本脚本只锁 #1017 这一型（进度条**从未上屏**）。8× 节流下
//  空窗期长度随本机速度漂移、采样会被整窗重建与预渲时序抢走（实测同一脚本两次跑一绿一红），
//  故不在此重复断言，免得给出一条会随机变红的假红线。
//  Z 组
//    Z1 rAF 被节流/不派发（模拟后台标签）：内容仍必须渲染出来（#1017 的 120ms 保险丝）
//    Z2 全程零未捕获 JS 异常
// 用法：node tools/verify-1011-chat-enter-paint.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
let ws = null, msgId = 0, pend = new Map(), chrome = null, cdpPort = 0;
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
// 每个场景一个全新浏览器进程 + 全新 profile：三场景共享一个 profile 会互相污染
//（实测踩过：第二、三场景带着上一场景的页面上/存储状态跑，出现「只画 4 条系统消息」
//  之类与脚本种子无关的假象，断言随机红绿）。启动/关闭各一次约数秒，换确定性值得。
async function withFreshBrowser(rate, fn) {
  cdpPort = 9880 + Math.floor(Math.random() * 60);
  msgId = 0; pend = new Map(); ws = null;
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'mochi-1011-')),
    '--remote-debugging-port=' + cdpPort, 'about:blank'
  ], { stdio: 'ignore' });
  let connected = false;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        connected = true;
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!connected) throw new Error('无法连接无头浏览器');
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setCPUThrottlingRate', { rate: rate });
  try { return await fn(); } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(300);
  }
}

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

// 只读探针：每帧采样 #chat-loading 的**实际可见性**与气泡数。绝不能改 hidden 的读写通道
//（用访问器接管 hidden 而忘记转发＝探针自己把进度条钉成 display:none，本批第一版踩过这个坑，
//  量出来「全程 0 帧可见」是探针造出来的假象）。
const PROBE = `(function(){
  var _raf = window.requestAnimationFrame.bind(window);
  window.__vp = { frames: [], errs: [], t0: 0 };
  window.addEventListener('error', function(e){ try { window.__vp.errs.push(String((e && e.message) || 'err').slice(0,160)); } catch (x) {} });
  window.addEventListener('unhandledrejection', function(e){ try { window.__vp.errs.push('rej:' + String((e && e.reason) || '').slice(0,120)); } catch (x) {} });
  function barVisible(){
    var el = document.getElementById('chat-loading');
    if (!el) return -1;
    var cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return (!el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) ? 1 : 0;
  }
  var last = performance.now();
  function loop(){
    var now = performance.now();
    var cb = document.getElementById('chat-body');
    var pg = document.getElementById('page-chat');
    window.__vp.frames.push({ t: Math.round(now), gap: Math.round(now - last), bar: barVisible(),
      chat: pg ? (pg.hidden ? 0 : 1) : -1, bubbles: cb ? cb.children.length : -1 });
    last = now;
    if (window.__vp.frames.length > 3000) window.__vp.frames.shift();
    _raf(loop);
  }
  _raf(loop);
  return true;
})()`;

// 开屏闸门：`.splash:not(.hide) ~ .phone{visibility:hidden}` 会让整棵 UI 不可见，探针会把
//「不可见」误读成缺陷。诊断口径＝直接摘掉 splash 节点。
async function clearSplash() {
  await evalJs("(function(){var s=document.getElementById('splash');if(s)s.remove();return true;})()");
  await sleep(150);
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
  await sleep(1200);
  await clearSplash();
}
const N_MSGS = 300;
async function resetAndSeed() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,session_storage' });
  await openPage();
  // 种子必须同时落 **LS 与 IDB 权威**：只写 LS 时，本页加载期 app 自己往 IDB 落过一份空 chat-msgs
  //（或账本），冷启动回读时长的是 IDB 权威 ⇒ 种子被吃掉、场景变成「空库」＝断言随机红绿
  //（本批实测踩过：同一脚本两次跑，一次 200 条一次只剩 4 条系统消息）。写完等落盘再冷启动。
  await evalJs(`(function(){
    var now = Date.now(); var arr = [];
    for (var i = 0; i < ${N_MSGS}; i++) arr.push({ side: i % 2 ? 'in' : 'out', text: '记录' + String(i).padStart(3,'0'), ts: now - (${N_MSGS} - i) * 60000 });
    window.activeStore().set('cs-rp-auto-prob', '0');
    window.activeStore().set('chat-msgs', JSON.stringify(arr));
    try { window.idbSet(window.activePrefix() + 'chat-msgs', arr); } catch (e) {}
    return arr.length;
  })()`);
  await sleep(1200);
}
// 冷启动：重开页面 → 落在桌面（不点任何东西）→ 等屏上窗口预渲落定
async function coldLandOnDesk() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
  await sleep(1200);
  await clearSplash();
  await sleep(1500);
}
// 落桌面口径收口：诊断脚本别的场景（尤其上一轮的 F）可能把聊天页留在屏上、或 app 从
// sessionStorage 里恢复了「上次停留页」——那样 F/S/Z 跑的就不是同一条流。这里先确保在桌面页。
async function resetToDesk() {
  const vis = await evalJs("(function(){var pg=document.getElementById('page-chat');return !!(pg && !pg.hidden);})()");
  if (vis) {
    await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return true;})()");
    await sleep(600);
  }
  await sleep(200);
}
async function tapChat() {
  return await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(!a)return false;a.click();return true;})()");
}
async function resetProbe() {
  await evalJs("(function(){ if(!window.__vp) return false; window.__vp.frames.length = 0; window.__vp.errs.length = 0; window.__vp.t0 = Math.round(performance.now()); return true; })()");
}
async function readProbe() {
  const v = await evalJs('JSON.stringify({frames: window.__vp.frames, errs: window.__vp.errs, t0: window.__vp.t0})');
  try { return JSON.parse(v || '{}'); } catch (e) { return {}; }
}
async function precondition() {
  return JSON.parse(await evalJs("(function(){var b=document.getElementById('chat-loading');var pg=document.getElementById('page-chat');var ph=document.getElementById('page-phone');return JSON.stringify({barHidden:b?b.hidden:null, chatHidden:pg?pg.hidden:null, phoneHidden:ph?ph.hidden:null});})()") || '{}');
}
async function readList() {
  return JSON.parse(await evalJs(`(function(){
    var b = document.getElementById('chat-body'); var idxs = [];
    for (var i = 0; i < b.children.length; i++) { var el = b.children[i]; if (el.dataset && el.dataset.idx !== undefined) idxs.push(Number(el.dataset.idx)); }
    var asc = true; for (var j = 1; j < idxs.length; j++) if (idxs[j] <= idxs[j-1]) { asc = false; break; }
    var maxIdx = idxs.length ? Math.max.apply(null, idxs) : -1;
    return JSON.stringify({ lastIdx: idxs.length ? idxs[idxs.length-1] : -1, count: idxs.length, asc: asc, maxIdx: maxIdx,
      gap: Math.round(b.scrollHeight - b.scrollTop - b.clientHeight) });
  })()`) || '{}');
}

async function scenario(kind) {
  await resetAndSeed();
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await coldLandOnDesk();
  await resetToDesk();
  if (kind === 'noraf') {
    // 模拟后台标签/不可见页面：rAF 只返回句柄不回调（探针自己持有原始 rAF，不受影响）
    await evalJs("(function(){window.requestAnimationFrame = function(){ return 0; }; return true;})()");
  }
  await sleep(200);
  const pre = await precondition();
  pre.seeded = await evalJs("(function(){var cb=document.getElementById('chat-body');return cb?cb.children.length:-1;})()");
  pre.dbReady = await evalJs("(function(){return window.__chatDbReady?window.__chatDbReady():null;})()");
  await resetProbe();
  const tapped = await tapChat();
  await sleep(9000);
  const p = await readProbe();
  const list = await readList();
  const barAfter = await evalJs("(function(){var b=document.getElementById('chat-loading');return b?String(b.hidden):'none';})()");
  await sleep(1500);
  const barStays = await evalJs("(function(){var b=document.getElementById('chat-loading');return b?String(b.hidden):'none';})()");
  return { pre, tapped, p, list, barAfter, barStays };
}

const ok = (v) => v === true;
const rel = (t0, t) => Math.round(t - t0);

// ---------- F 组：用户报障路径（落在桌面 → 点聊天；屏上窗口已预渲＝同窗补丁快路） ----------
console.log('== F 组：落在桌面后点聊天（屏上窗口已预渲，4× 节流） ==');
const F = await withFreshBrowser(4, () => scenario('warm'));
{
  const Ff = F.p.frames || [];
  const relF = (t) => rel(F.p.t0 || 0, t);
  const firstBar = Ff.find((f) => f.bar === 1);
  const barCount = Ff.filter((f) => f.bar === 1).length;
  const firstContent = Ff.find((f) => f.chat === 1 && f.bubbles > 0);
  const maxGap = Math.max.apply(null, Ff.map((f) => f.gap).concat([0]));
  check('F1 前提：点击前进度条隐藏 / 聊天页隐藏 / 桌面可见', F.pre.barHidden === true && F.pre.chatHidden === true && F.pre.phoneHidden === false, JSON.stringify(F.pre));
  check('F1b 前提：点击命中聊天图标', F.tapped === true);
  check('F1c 前提：种子真的到了（屏上已预渲出 200 条＝冷启动读到权威历史，非空库态）', F.pre.seeded > 50 && F.pre.dbReady === true,
    '预渲条数=' + F.pre.seeded + ' chatDbReady=' + F.pre.dbReady);
  check('F2 ★ 点击后进度条至少被画到屏上 1 帧（用户要的「加载动画缓冲」）', barCount >= 1,
    '可见帧=' + barCount + (firstBar ? ' 首现@+' + relF(firstBar.t) + 'ms' : '') + ' 采样帧=' + Ff.length + ' 最大帧间隔=' + maxGap + 'ms');
  check('F3 进度条不卡死（9s 内已收起且随后 1.5s 保持收起）', F.barAfter === 'true' && F.barStays === 'true', 'barAfter=' + F.barAfter);
  check('F4 内容照常到达（气泡出现）', !!firstContent && F.list.count > 0, '首内容@+' + (firstContent ? relF(firstContent.t) : '-') + 'ms 气泡=' + F.list.count);
  check('F5 收尾不回归：贴底 + 窗口尾贴最新 + 下标升序', F.list.gap <= 8 && F.list.lastIdx === F.list.maxIdx && ok(F.list.asc),
    'gap=' + F.list.gap + ' last=' + F.list.lastIdx + ' max=' + F.list.maxIdx + ' asc=' + F.list.asc);
}

// ---------- Z 组：rAF 被节流（后台标签等效） ----------
console.log('== Z 组：rAF 不回调（后台标签等效，4× 节流） ==');
const Z = await withFreshBrowser(4, () => scenario('noraf'));
check('Z0 前提：点击前进度条隐藏 / 聊天页隐藏 / 桌面可见', Z.pre.barHidden === true && Z.pre.chatHidden === true && Z.pre.phoneHidden === false, JSON.stringify(Z.pre));
check('Z1 rAF 不回调时内容仍渲染（#1017 的 120ms 保险丝）', Z.list.count > 0 && Z.list.gap <= 8,
  '气泡=' + Z.list.count + ' gap=' + Z.list.gap + ' last=' + Z.list.lastIdx + '/' + Z.list.maxIdx);
const allErrs = [].concat(F.p.errs || [], Z.p.errs || []);
check('Z2 全程零未捕获 JS 异常', allErrs.length === 0, allErrs.slice(0, 3).join(' ; ') || '0');

console.log('');
console.log('合计：通过 ' + pass + ' / 失败 ' + fail);
server.close();
process.exit(fail ? 1 : 0);
