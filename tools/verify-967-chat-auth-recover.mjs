// ===== 回归脚本：回前台/读库失败时聊天永久空屏无提示（#967） =====
// 用法：node tools/verify-967-chat-auth-recover.mjs   （MOCHI_ROOT 可指向隔离副本）
// 症状（用户实报）：挂后台切回来会卡、聊天里什么也看不到。
// 根因（无头实证，与机型无关）：权威读超时/在飞链被冻结后，
//   ① armReadyFuse 的 15s 保险丝把 chatDbReady 置真 ⇒ updateChatLoading 收起进度条，
//      而屏上一条消息都没有（进度条认「保险丝跳没跳」而不是「数据到没到」）；
//   ② scheduleIdbRetry 的 IDB_RETRY_MAX=6 次快重试耗尽后永久放弃 ⇒ 再无读库入口；
//   ③ 回前台只做贴底复核（chatResumeRepin），没有重新起读的入口 ⇒ 停在空屏，只有再点一次进聊天才回来。
// 修复（src/js/chat.js 单文件）：
//   chatAuthPending（权威未达）＋ 进度条判定并入该标记；快重试耗尽转 15s 慢重试看门狗；
//   读到不可用形态按读失败重试（不再静默收口）；回前台/bfcache 恢复时补一发真读。
// 用例：
//   S1~S6 静态锚（源里在不在）
//   B1 【判别力核心】读全失败时屏上无消息 ⇒ 进度条必须保持可见（修复前第 15s 起收起）
//   B2 快重试耗尽后仍有慢重试：读失败次数继续增长（修复前停在 16 次再不增长）
//   B3 【用户症状】回前台补读：注入停止 + 派发回前台信号后，无需再点进聊天即可上屏（修复前恒空）
//   B4 权威到手后进度条收敛（防修过头：不能一直亮着）
//   B5 健康路径零回归：读正常时内容上屏且进度条收起
//   Z1 零 JS 异常
// RED 基线（纯 HEAD）：B1/B2/B3 红（S1~S6 锚缺失）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
function A(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

console.log('静态断言:');
const cj = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
A('S1 权威未达标记存在', /let chatAuthPending = false;/.test(cj));
// #1010 起进度条条件尾部新增「收尾媒体窗」chatSettleHoldOn()——断言改锚到「两个标记同处一条
// 条件式」的语义片段（本批面与 #967 的判别力都保住，也不再被后续新增标记牵动）。
A('S2 进度条判定并入权威未达', cj.includes('chatRebuilding || chatAuthPending'));
A('S3 快重试耗尽转看门狗', cj.includes('if (idbRetryTimer || idbRetryCount >= IDB_RETRY_MAX) { armChatAuthWatch(); return; }'));
A('S4 慢重试看门狗（15s 档）', /CHAT_AUTH_WATCH_MS = 15000;/.test(cj) && cj.includes('function armChatAuthWatch() {'));
A('S5 回前台补读入口', cj.includes("document.addEventListener('mochi-fg-resume', chatResumeRearmRead);"));
A('S6 读到不可用形态按读失败重试', cj.includes('if (!Array.isArray(idbArr)) { // #967'));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9920 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-967-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('CDP 连接失败');
}
async function cdp(method, params) { const id = ++msgId; ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => pend.set(id, r)); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) console.log('  [eval 异常] ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r && r.result ? r.result.value : null;
}
async function gotoApp() { 
await cdp('Page.navigate', { url: baseUrl + '/index.html' }); for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); } }

// 读失败注入器（聊天权威键）+ 读取计数：__failOn 为真时 chat-msgs/chat-blk* 一律 resolve undefined
const PROBE = `(function () {
  window.__fails = 0; window.__reads = 0; window.__failOn = false; window.__failBoot = false;
  const iv = setInterval(function () {
    if (typeof window.idbGet === 'function' && !window.idbGet.__logged) {
      clearInterval(iv);
      const orig = window.idbGet;
      const w = function (k, o) {
        const ks = String(k);
        const isChat = ks.indexOf(':chat-msgs') >= 0 || ks.indexOf(':chat-blk') >= 0;
        if (isChat) window.__reads++;
        if ((window.__failOn || window.__failBoot) && isChat) { window.__fails++; return Promise.resolve(undefined); }
        return orig.call(window, k, o);
      };
      w.__logged = true; window.idbGet = w;
    }
  }, 5);
})();`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
try { await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) {}
try { await cdp('Page.bringToFront'); } catch (e) {}
try { await cdp('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_RATE || 5) }); } catch (e) {}

const STATE = `(function () {
  const bar = document.getElementById('chat-loading');
  const body = document.getElementById('chat-body') || { children: [], textContent: '' };
  return { kids: body.children.length, has: (body.textContent || '').indexOf('桌面消息') >= 0,
    bar: !!(bar && !bar.hidden), fails: window.__fails, reads: window.__reads };
})()`;

// ---- 种一个 600 条整包历史的桌面 ----
await gotoApp();
await evalJs(`(async () => {
  const G = 'xy-home-v2'; const pairs = [];
  const mkMsg = (say, i) => ({ role: i % 2 ? 'ta' : 'me', text: say + i + '，一段中等长度的聊天文本内容，再加一些填充让它接近真实体量。'.repeat(60), tm: Date.now() - i * 60e3 });
  const arr = []; const TOTAL = 600; for (let i = 0; i < TOTAL; i++) arr.push(mkMsg('桌面消息', i));
  pairs.push({ k: G + ':default:chat-msgs', v: JSON.stringify(arr) });
  pairs.push({ k: G + ':default:chat-meta', v: JSON.stringify({ n: TOTAL, t: Date.now(), b: JSON.stringify(arr).length }) });
  await window.idbSetAll(pairs); return true;
})()`);

// ---- B5 健康路径（先跑，防修过头：正常读必须照常上屏且进度条收敛） ----
await gotoApp(); await sleep(3500);
await evalJs('window.enterChat && window.enterChat()');
let healthy = null;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  healthy = await evalJs(STATE);
  if (healthy.has) break;
}
console.log('行为断言:');
A('B5 健康路径零回归：内容上屏', healthy && healthy.has === true, healthy);

// ---- 读全失败：B1 进度条必须保持可见 / B2 慢重试不让读库永久停摆 ----
// 注入必须在「启动前」就位（否则开屏回填把 LS 快照补齐，聊天根本不必读库＝注入测不到）
const bootScript = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__failBoot = true;' });
await evalJs(`(function () {
  const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(':chat-') >= 0) ks.push(k); }
  ks.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
  window.__failOn = true; window.__failBoot = true; window.__fails = 0; window.__reads = 0;
  return ks.length;
})()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(2000);
await evalJs('window.__failBoot = true; window.enterChat && window.enterChat()');

let barHiddenWhileBlankAt = -1, readsAtExhaust = 0, readsLater = 0;
for (let i = 1; i <= 14; i++) {
  await sleep(5000);
  const s = await evalJs(STATE);
  if (process.env.V967_TRACE === '1') console.log('  [trace +' + (i * 5) + 's] ' + JSON.stringify(s) + ' dbg=' + JSON.stringify(await evalJs('window.__chatDbg ? window.__chatDbg() : null')));
  if (i === 8) readsAtExhaust = s.reads; // 40s：快重试（6×5s）已耗尽
  if (i === 14) readsLater = s.reads;    // 70s：慢重试应已补过至少一次
  if (!s.has && !s.bar && barHiddenWhileBlankAt < 0) barHiddenWhileBlankAt = i * 5;
}
A('B1 读全失败时屏上无消息 ⇒ 进度条保持可见（修复前第 15s 起收起）', barHiddenWhileBlankAt < 0, { blankNoHintAtSec: barHiddenWhileBlankAt });

// ---- B3 回前台补读：停注入 + 派发回前台信号，不再点进聊天也应上屏 ----
await evalJs('window.__failOn = false; window.__failBoot = false; window.__fails = 0; document.dispatchEvent(new Event("mochi-fg-resume"));');
let recovered = null;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  recovered = await evalJs(STATE);
  if (recovered.has) break;
}
A('B3 回前台补读：无需再点进聊天即上屏（修复前恒空屏）', recovered && recovered.has === true, recovered);
A('B2 快重试耗尽后读库不停摆（慢重试续读，修复前停在 16 次不再增长）', readsLater > readsAtExhaust, { readsAt40s: readsAtExhaust, readsAt70s: readsLater });
try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: bootScript.identifier }); } catch (e) {}

// ---- B4 权威到手后进度条收敛（防修过头：不能一直亮着） ----
let settled = null;
for (let i = 0; i < 10; i++) { await sleep(1000); settled = await evalJs(STATE); if (settled.has && !settled.bar) break; }
A('B4 权威到手后内容在屏且进度条收起', settled && settled.has === true && settled.bar === false, settled);

// ---- Z1 零 JS 异常 ----
const errs = await evalJs('(window.__jsErrors || []).slice(0, 5)');
const fatal = (errs || []).filter((e) => String(e).indexOf('ReferenceError') >= 0 || String(e).indexOf('TypeError') >= 0);
A('Z1 零 JS 异常（ReferenceError/TypeError）', fatal.length === 0, errs);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
