// #211 聊天收发消息整窗重建闪灭 行为验证（无头 Chrome，测构建产物 index.html）
// 立项：iQOO12+Chrome 报障「打开聊天偶尔闪动+对方回复消息闪一下」，用户明说其他机型也有。
// 根因（src/js/chat.js addRec）：窗口超限判定 `msgs.length - renderStart > RENDER_MAX` 在每次
// 钳位渲染后（renderStart=len−RENDER_MAX）只要再来一条消息就恒为真——历史超过 200 条的桌面
// 每收发一条消息都 renderWindow(false,true) 整窗重建 200 个气泡（img 全部重建重新解码=肉眼
// 可见闪一下）；历史 ≤200 条 renderStart=0 从不命中=同版本不闪（假象为机型相关，实为历史
// 长度相关）。修复：判定收紧到 WINDOW_MAX 硬上限（与 loadOlderIncremental→pruneWindowBottom
// 同一口径），常规收发走 renderMsg 增量追加。
// 本脚本用 MutationObserver 给 #chat-body 的 childList 变动分类：removed≥50 且 added≥50 判为
// 「整窗重建」；收发消息后 5s 内出现整窗重建=回归。历史长度 ≤200 条时重建分支本就不可达，
// 种入大历史并夹带窗口外老格式数据（低于阈值/无迁移源场景无区分度）。
// 用法：node build.mjs && node tools/verify-chat-rebuild.mjs
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
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vcr-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 423, height: 896, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(800);

// —— 种入大历史：300 条×30KB≈9MB，账本 b 超 CHAT_LAZY_BYTES(8MB) → 冷启动跳过预读、
//    进聊天页才读库 = 后台归一化在聊天页可见时收尾（真实用户大历史的闪动路径）。
//    最旧 10 条为老格式（dataURL 无 type=迁移源），落在渲染窗口（最后 200 条）之外 ——
const seeded = await evalJs(`(function(){
  if (!window.chatImportMsgs) return 'no-fn';
  var arr=[];var t=Date.now()-300*60000;
  var px='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4GBgYGJgYGBAQAkBgMBOOSShwAAAABJRU5ErkJggg==';
  var pad='';for(var p=0;p<30000;p++)pad+='x';
  for(var i=0;i<300;i++){
    if(i<10) arr.push({side:'in',text:px,ts:t+i*60000});
    else arr.push({side:i%2?'in':'out',type:'text',text:'历史消息'+i+pad,ts:t+i*60000});
  }
  return String(window.chatImportMsgs(arr));
})()`);
ok(seeded === 'true', 'S0 种入 300 条×30KB≈9MB 历史（懒读门槛上）+最旧 10 条老格式', String(seeded));
await sleep(3000);

// —— 冷启动：刷新（IDB 已有大历史），进桌面 ——
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(600);

// —— 观测器：#chat-body childList 分类，事件挂 window.__vcr ——
const armRes = await evalJs(`(function(){
  var body=document.getElementById('chat-body');
  if(!body) return 'no-body';
  window.__vcr={events:[],t0:0};
  var P=window.__vcr;
  window.__vcrArm=function(){P.events.length=0;P.t0=performance.now();};
  var mo=new MutationObserver(function(recs){
    for(var k=0;k<recs.length;k++){
      var r=recs[k],add=r.addedNodes.length,rem=r.removedNodes.length;
      P.events.push({t:Math.round(performance.now()-P.t0),add:add,rem:rem});
    }
  });
  mo.observe(body,{childList:true,subtree:false});
  return 'ok';
})()`);
ok(armRes === 'ok', 'S1 观测器安装（#chat-body）', String(armRes));

// —— S2 打开聊天：静置 6s，除首屏渲染外不得出现整窗重建（读库收尾 changed 才重建，常态无改动不应闪）——
await evalJs('window.__vcrArm(); window.enterChat(); true');
await sleep(10000);
let evs = await evalJs('JSON.stringify(window.__vcr.events)') || '[]';
let evArr = JSON.parse(evs);
const rebuildsOf = (arr) => arr.filter(e => e.rem >= 50 && e.add >= 50);
ok(evArr.some(e => e.add >= 100), 'S2 打开聊天首屏渲染到位（批量 add≥100）', evs.slice(0, 200));
ok(rebuildsOf(evArr.filter(e => e.t > 500)).length === 0, 'S2 打开后静置期无整窗重建（首屏 500ms 后）',
  JSON.stringify(rebuildsOf(evArr)));

// —— S3 对方回复（typing 指示器→收起→消息进来）：不得整窗重建，须增量追加 ——
await evalJs(`(function(){
  window.__vcrArm();
  var te=document.getElementById('chat-typing');
  if(te)te.hidden=false;
  setTimeout(function(){ if(te)te.hidden=true; window.chatAddIn('测试回复消息一句'); },1200);
  return true;
})()`);
await sleep(5000);
evs = await evalJs('JSON.stringify(window.__vcr.events)') || '[]';
evArr = JSON.parse(evs);
ok(rebuildsOf(evArr).length === 0, 'S3 对方回复不整窗重建（#211 核心）', JSON.stringify(rebuildsOf(evArr)));
ok(evArr.some(e => e.add >= 1 && e.add <= 3 && e.rem === 0), 'S3 回复走增量追加（add 1~3/rem 0）', evs.slice(0, 200));

// —— S5 归一化迁移真实发生（type 已被后台迁移补上）但零重建=S2 断言非空转——
await evalJs('window.__vcrArm(); true');
const m0type = await evalJs('(window.getChatMsgs && window.getChatMsgs()[0] && window.getChatMsgs()[0].type) || "?"');
ok(m0type === 'image', 'S5 老格式消息已被后台归一化迁移（type 补上）', String(m0type));

// —— S4 自己发送消息：同样不得整窗重建 ——
await evalJs('window.__vcrArm(); window.chatSendMsg("我自己发的一条测试消息"); true');
await sleep(3000);
evs = await evalJs('JSON.stringify(window.__vcr.events)') || '[]';
evArr = JSON.parse(evs);
ok(rebuildsOf(evArr).length === 0, 'S4 自己发送不整窗重建', JSON.stringify(rebuildsOf(evArr)));

console.log(fail ? ('FAIL ' + pass + '/' + (pass + fail)) : ('ALL PASS ' + pass + '/' + (pass + fail)));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
