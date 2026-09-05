// ===== #215 验证脚本：发送取值兜底（构建后跑产物） =====
// 用法：node build.mjs && node tools/verify-chat-send-recover.mjs
// 背景（华为 P50E+Edge 报「我发送的聊天气泡里没有文字/文字消失了」，用户明说其他
// 设备型号也有；无头复现 362×764/DPR3.375/EdgA151 UA）：Edge 点发送瞬间可能把输入栏
// 未提交的组合文本整体撕掉（composition cancel：DOM 清空且零事件）→ addMsg 读空 →
// 消息 0 条、打的字静默消失。修复：捕获阶段维护最近输入快照 _mLastTyped，发送两入口
// 改走 readSendText——双口径读空且快照新鲜（真实编辑<15s 且晚于上次清空）才恢复。
// 断言：T1 正常发送照常；T2 撕文本→点发送＝消息照发（核心恢复）；T3 手动删空→不幻影；
//       T4 隔次空点发送→旧快照不复活；T5 Enter 发送路径同样恢复；T6 恢复后内核迟到
//       写回仍被既有守卫清掉（#115 语义保持）；T7 静态锚：两个发送入口都走 readSendText、
//       clearChatInput 作废快照；T8 静态锚：快照捕获监听在位。
// 注意：对未含本修复的旧产物，T2 红并级联 T3/T4（断言依赖 T2 的消息在场）、T5/T6 红；
// 静态锚与 T1 应恒绿——构建后应 11/11 全绿。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- T7/T8 静态锚（直接对 src 断言，产物构建前后都应绿） ----
const src = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
check('T7a 点击发送入口走 readSendText（取值兜底接线）',
  /send\.addEventListener\('click', \(\) => \{ addMsg\(readSendText\(\)\);/.test(src));
check('T7b Enter 发送入口走 readSendText', /addMsg\(readSendText\(\)\);\n\}\n\}\);/.test(src) || /e\.preventDefault\(\);\naddMsg\(readSendText\(\)\);/.test(src));
check('T7c clearChatInput 同步作废输入快照（防旧快照幻影重发）',
  /try \{ input\._mLastTyped = ''; \} catch \(e\) \{\}/.test(src));
check('T8 输入快照捕获监听在位（撕文本前最后一次内容可恢复的依据）',
  /input\._mLastTyped = input\.innerText \|\| '';/.test(src));
check('T7d 切桌面作废快照', /input\._mLastTyped = ''; \} catch \(e2\) \{\}/.test(src));

// ---- T1-T6 运行时（无头 Chrome 端到端，走真实构建产物） ----
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

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const cdpPort = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v213-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function connect() {
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
    if (r && r.exceptionDetails) return 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = async (expr) => JSON.parse((await evalJs(expr)) || '{}');
// IME 整段提交（真实中文输入法事件形态：composition 事件 + input 事件，快照捕获依赖它）
async function ime(text) {
  await evalJs("(function(){var el=document.getElementById('chat-input');el.focus();" +
    "el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));" +
    "el.textContent='" + text + "';" +
    "el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));" +
    "el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));" +
    "el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'" + text + "'}));" +
    "el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));return 1;})()");
  await sleep(100);
}
async function sendClick() { await evalJs("document.getElementById('chat-send').click()"); await sleep(400); }
const state = "(function(){var b=document.querySelectorAll('#chat-body .msg-out .msg-bubble');return JSON.stringify({n:b.length,last:b.length?(b[b.length-1].textContent||'').trim():null,inner:(document.getElementById('chat-input').innerText||'').trim()});})()";

await connect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 仿华为 P50E + Edge：362×764 / DPR 3.375 / EdgA151 UA
await cdp('Emulation.setDeviceMetricsOverride', { width: 362, height: 764, deviceScaleFactor: 3.375, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36 EdgA/151.0.0.0',
  platform: 'Linux armv81'
});
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});try{window.enterChat&&window.enterChat();}catch(e){}return 1;})()");
await sleep(800);
const n0 = (await J(state)).n;

await ime('正常发送一条消息');
await sendClick();
let s = await J(state);
check('T1 正常发送照常（气泡含全文、输入栏清空）', s.n === n0 + 1 && s.last === '正常发送一条消息' && s.inner === '', JSON.stringify(s));

await ime('撕掉前的这条消息xyz');
await evalJs("(function(){document.getElementById('chat-input').textContent='';return 1;})()"); // 模拟内核撕文本：零事件
await sendClick();
s = await J(state);
check('T2 发送瞬间文本被内核撕掉＝恢复照发（核心）', s.n === n0 + 2 && s.last === '撕掉前的这条消息xyz', JSON.stringify(s));

await ime('手动删空这条');
await evalJs("(function(){var el=document.getElementById('chat-input');el.textContent='';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));return 1;})()");
await sendClick();
s = await J(state);
check('T3 手动删空后点发送＝不幻影恢复', s.n === n0 + 2 && s.last === '撕掉前的这条消息xyz', JSON.stringify(s));

await sendClick();
s = await J(state);
check('T4 空输入栏再点发送＝旧快照不复活', s.n === n0 + 2 && s.last === '撕掉前的这条消息xyz', JSON.stringify(s));

await ime('回车发送被撕恢复');
await evalJs("(function(){document.getElementById('chat-input').textContent='';return 1;})()");
await evalJs("(function(){var el=document.getElementById('chat-input');el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',keyCode:13}));return 1;})()");
await sleep(400);
s = await J(state);
check('T5 Enter 发送路径同样恢复', s.n === n0 + 3 && s.last === '回车发送被撕恢复', JSON.stringify(s));

await ime('迟到写回这条');
await sendClick();
await evalJs("(function(){var el=document.getElementById('chat-input');el.textContent='迟到写回这条';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));return 1;})()");
await sleep(1200);
s = await J(state);
check('T6 恢复发送后内核迟到写回仍被 #115 守卫清掉（语义保持）', s.n === n0 + 4 && s.inner === '' && s.last === '迟到写回这条', JSON.stringify(s));

chrome.kill();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);
