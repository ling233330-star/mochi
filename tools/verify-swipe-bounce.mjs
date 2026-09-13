// #393 聊天/群聊滑动「弹一下」行为断言（红米 K80 Chrome 报障，多机型同族）
// 断言：
//  A) 单聊上翻 loadOlderIncremental 补偿=锚点差值：单批加载视觉跳变 ≤8px（修复前恒 -14px）
//  B) 群聊解钉挂 scroll-anchor-auto（#316 群聊侧补齐）：touchstart 后 computed auto
//  C) 群聊锚定生效：gc-body 上方内容撑高 200px 参照消息视口稳定（drift ≤10px）
//  D) 群聊回钉摘类：轻点贴底（touchend dy<10）→ 类摘除（#199 钉住态 none 语义不回归）
//  E) 单聊 #199/#316 不回归：初始钉住态类未挂且 none；touchstart 解钉挂上且 auto
// 用法：node tools/verify-swipe-bounce.mjs（对产物 index.html）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9560 + Math.floor(Math.random() * 80);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vsb-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
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
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// 种 600 条（LS 直写 + 同任务 location.reload 原子化，防存活期被写回覆盖）
await cdp('Page.navigate', { url: 'about:blank' });
await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await passMandatory();
await sleep(400);
const seeded = await evalJs(`(function(){
  try {
    var N = 600, seed = [], t0 = 1700000000000;
    for (var i = 0; i < N; i++) seed.push({ side: i % 2 ? 'in' : 'out', text: '滑动弹跳验证' + i + '，用于撑起滚动', ts: t0 + i * 60000 });
    localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(seed));
    localStorage.setItem('xy-home-v2:group-chat-msgs', JSON.stringify(seed));
    localStorage.setItem('xy-home-v2:default:chat-meta', JSON.stringify({ n: N, b: 3000000 }));
    return Promise.all([
      window.idbSet('xy-home-v2:default:chat-msgs', JSON.stringify(seed)),
      window.idbSet('xy-home-v2:group-chat-msgs', JSON.stringify(seed)),
      window.idbSet('xy-home-v2:default:chat-meta', JSON.stringify({ n: N, b: 3000000 }))
    ]).then(function(){ location.reload(); return 'ok'; });
    try { localStorage.setItem('xy-home-v2:reply-rs-min', '9999'); localStorage.setItem('xy-home-v2:reply-rs-max', '9999'); } catch (e) {}
    location.reload();
    return 'ok';
  } catch (e) { return 'err:' + String(e); }
})()`);
await sleep(3500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await passMandatory();
await sleep(800);
const memN = await evalJs('(function(){ try { return window.getChatMsgs().length; } catch(e){ return 0; } })()');

// #384 强制公告：点 splash 后必须滑到底 + 点确认才真正进入
async function passMandatory() {
  for (let i = 0; i < 10; i++) {
    const r = await evalJs(`(function(){
      var m = document.getElementById('splash-mandatory');
      if (!m || m.hidden) return 'none';
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var en = document.getElementById('splash-mandatory-enter');
      if (en && !en.classList.contains('is-disabled')) { en.click(); return 'entered'; }
      return 'wait';
    })()`);
    if (r === 'entered' || r === 'none') return r;
    await sleep(250);
  }
  return 'timeout';
}

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// 单聊打开
console.log('href:', await evalJs('(function(){try{return location.href + " | ready=" + document.readyState + " | dataReady=" + !!window.__mochiDataReady;}catch(e){return "err:/"+String(e);}})()'));
console.log('bodyLen:', await evalJs('(function(){try{return document.body ? document.body.innerHTML.length : "nobody";}catch(e){return "err";}})()'));
console.log('body:', await evalJs('(function(){try{return document.body.innerHTML.slice(0,200);}catch(e){return "err";}})()'));
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="chat"]'); if (ic) ic.click(); return !!ic; })()`);
await sleep(1600);

// E) #199/#316 不回归：初始钉住态类未挂且 none；touchstart 解钉挂上且 auto
{
  const e0 = JSON.parse(await evalJs(`JSON.stringify((function(){
    var b = document.getElementById('chat-body');
    return { cls: b.classList.contains('scroll-anchor-auto'), oa: getComputedStyle(b).overflowAnchor };
  })())`));
  chk('E1 初始钉住态未挂锚定类且 overflow-anchor=none（#199 不回归）', e0.cls === false && e0.oa === 'none', JSON.stringify(e0));
  await evalJs(`(function(){
    var b = document.getElementById('chat-body');
    try {
      var t = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 400 });
      b.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    } catch (e) { b.dispatchEvent(new Event('touchstart', { bubbles: true })); }
    return 1;
  })()`);
  const e1 = JSON.parse(await evalJs(`JSON.stringify((function(){
    var b = document.getElementById('chat-body');
    return { cls: b.classList.contains('scroll-anchor-auto'), oa: getComputedStyle(b).overflowAnchor };
  })())`));
  chk('E2 触摸解钉挂类且 overflow-anchor=auto（#316 不回归）', e1.cls === true && e1.oa === 'auto', JSON.stringify(e1));
}

// A) 单聊上翻单批 loadOlder：视觉跳变 ≤8px、补偿误差≈0
async function probeLoadOlder2() {
  for (let i = 0; i < 40; i++) {
    const st = await evalJs(`(function(){ var b = document.getElementById('chat-body'); if (b.scrollTop < 400) return 'near'; b.scrollTop = b.scrollTop - Math.floor(b.clientHeight * 0.5); return Math.round(b.scrollTop); })()`);
    await sleep(320);
    if (st === 'near') break;
  }
  await sleep(1100);
  const m = JSON.parse(await evalJs(`(function(){
    var b = document.getElementById('chat-body');
    b.scrollTop = 80;
    var ms = b.querySelectorAll('.msg[data-idx]');
    for (var i = 0; i < ms.length; i++) { var r = ms[i].getBoundingClientRect(); if (r.top >= -10 && r.top < 400) { return JSON.stringify({ idx: Number(ms[i].dataset.idx), top: r.top, st: b.scrollTop, sh: b.scrollHeight }); } }
    return null;
  })()`));
  if (!m) return null;
  await sleep(1300);
  const m2 = JSON.parse(await evalJs(`(function(){
    var b = document.getElementById('chat-body');
    var mk = b.querySelector('.msg[data-idx="${m.idx}"]');
    if (!mk) return null;
    var r = mk.getBoundingClientRect();
    return JSON.stringify({ top: r.top, st: Math.round(b.scrollTop), sh: Math.round(b.scrollHeight) });
  })()`));
  if (!m2) return null;
  return { dTop: +(m2.top - m.top).toFixed(1), dSt: m2.st - m.st, dSh: Math.round(m2.sh - m.sh) };
}
{
  const r = await probeLoadOlder2();
  if (!r) chk('A1 单聊上翻单批视觉跳变 ≤8px', false, 'marker missing');
  else {
    chk('A1 单聊上翻单批视觉跳变 ≤8px（修复前恒 -14px）', Math.abs(r.dTop) <= 8, JSON.stringify(r));
    chk('A2 单聊上翻单批补偿误差 |Δst-Δsh| ≤8px', Math.abs(r.dSt - r.dSh) <= 8, JSON.stringify(r));
  }
}

// 群聊打开
await evalJs(`(function(){ var bk = document.getElementById('chat-back'); if (bk) bk.click(); return 1; })()`);
await sleep(700);
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="group-chat"]'); if (ic) ic.click(); return !!ic; })()`);
await sleep(1800);

// B) 群聊 touchstart 解钉挂类
{
  await evalJs(`(function(){
    var b = document.getElementById('gc-body');
    try {
      var t = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 400 });
      b.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    } catch (e) { b.dispatchEvent(new Event('touchstart', { bubbles: true })); }
    return 1;
  })()`);
  const s = JSON.parse(await evalJs(`JSON.stringify((function(){
    var b = document.getElementById('gc-body');
    return { cls: b.classList.contains('scroll-anchor-auto'), oa: getComputedStyle(b).overflowAnchor };
  })())`));
  chk('B1 群聊触摸接管挂 scroll-anchor-auto 且 computed auto（#316 群聊侧）', s.cls === true && s.oa === 'auto', JSON.stringify(s));
}

// C) 群聊锚定生效：上方内容撑高 200px 参照消息视口稳定
{
  const c = JSON.parse(await evalJs(`(async function(){
    var b = document.getElementById('gc-body');
    var grow = document.createElement('div');
    grow.style.cssText = 'height:0;flex:none';
    b.insertBefore(grow, b.firstChild);
    b.scrollTop = Math.round(b.scrollHeight * 0.5);
    await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
    var ref = null;
    for (var k = 0; k < b.children.length; k++) {
      var r = b.children[k].getBoundingClientRect();
      if (r.top >= 0 && r.bottom > 0 && !b.children[k].classList.contains('gc-earlier')) { ref = b.children[k]; break; }
    }
    if (!ref) { grow.remove(); return JSON.stringify({ err: 'no-ref' }); }
    var before = ref.getBoundingClientRect().top;
    grow.style.height = '200px';
    await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
    var after = ref.getBoundingClientRect().top;
    grow.remove();
    await new Promise(function(r){ requestAnimationFrame(r); });
    return JSON.stringify({ drift: Math.round(after - before) });
  })()`));
  chk('C 群聊锚定开启上方撑高 200px 视口稳定（drift ≤10px）', c && typeof c.drift === 'number' && Math.abs(c.drift) <= 10, JSON.stringify(c));
}

// D) 群聊轻点贴底回跟=摘类
{
  await evalJs(`(function(){
    var b = document.getElementById('gc-body');
    b.scrollTop = b.scrollHeight;
    return 1;
  })()`);
  await sleep(300);
  await evalJs(`(function(){
    var b = document.getElementById('gc-body');
    try {
      var t1 = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 400 });
      var t2 = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 402 });
      b.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], targetTouches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
      b.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
    } catch (e) {}
    return 1;
  })()`);
  const d = JSON.parse(await evalJs(`JSON.stringify((function(){
    var b = document.getElementById('gc-body');
    return { cls: b.classList.contains('scroll-anchor-auto'), oa: getComputedStyle(b).overflowAnchor };
  })())`));
  chk('D1 群聊轻点贴底回跟后摘类（#199 钉住态 none 语义不回归）', d.cls === false && d.oa === 'none', JSON.stringify(d));
}

console.log('\\nseed=' + seeded + ' memMsgs=' + memN + '  通过 ' + pass + ' / 失败 ' + fail);
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
