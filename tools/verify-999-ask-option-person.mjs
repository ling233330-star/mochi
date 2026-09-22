// ===== 回归验证 #999：互动卡选项「人称错位」根治（用户直派） =====
// 用户原话（2026-09-21）：「联系人发送的互动卡片：你希望我以后多做一些什么？✓ 你选择了：多关心你
//   他：那关心什么最够？ 多关心你应该是多关心我，人称错了，要改正。并且检查其他互动的问题选项和答案里，
//   有没有这种问题？」
// 口径（同族先例：cw12「帮我掖一下被角」、#600 选项视角修正）：互动卡选项＝【用户自答】——
//   题干由 TA 发问，题干里的「你」＝用户；选项里的「我」＝用户自己、「你」＝TA。
// 本批修的六处（四道题）：cr11「多关心我／多逗我笑」、cl10「我难过的样子／我认真做事的样子」、
//   cf9「关于我的」、cs6「关于我自己的」。每处都用该选项的 TA 回应反证（回应里「你」＝用户：
//   「关心你这件事，不会少」「认真的你，最好看」「画你？那我画得最像」「也该为自己许一次了」）。
// 根因（为什么必须配迁移）：TA的小问题题库首次合并后整块固化在用户本地，tcMerge 只按选项 t 同步
//   reply——只改源码到不了已装用户；而且改了 t 之后，按 t 匹配的 reply 同步会永久失配。
// 修复：①六处选项文案站回用户口径；②tcOptLabelSync：预设题按【选项顺序】把文案同步回代码
//   （幂等；只认 isPreset===true；条数对不上就跳过；用户自加的题一律不碰）。
// 断言：S 组＝源码/产物静态；A 组＝无头行为（旧文案库启动即迁移并落盘、迁移后 reply 仍与代码配对、
//   用户自加题一字不动、端到端：触发小问题卡→卡片选项即新文案→作答→用户气泡与 TA 回应成对）；Z 组＝零 JS 异常。
// 用法：node build.mjs && node tools/verify-999-ask-option-person.mjs
//       隔离副本：MOCHI_ROOT=<副本目录> node tools/verify-999-ask-option-person.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = 9800 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-p996-' + Date.now()),
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EX:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'ERR:' + e.message; }
}
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

// =====================================================================
// S 组：源码 / 产物静态断言
// =====================================================================
const src = readFileSync(join(root, 'src/js/ta-ask.js'), 'utf8');
const prod = readFileSync(join(root, 'js/ta-ask.js'), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');

// 六处「选项文案 + 该选项的 TA 回应」成对出现（回应里保留「你」＝用户，正是反证）
const PAIRS = [
  ['多关心我', '关心你这件事，不会少', 'cr11 多关心我'],
  ['多逗我笑', '那我攒几个笑话', 'cr11 多逗我笑'],
  ['我难过的样子', '记住了，以后多让你不难过', 'cl10 我难过的样子'],
  ['我认真做事的样子', '认真的你，最好看', 'cl10 我认真做事的样子'],
  ['关于我的', '画你？那我画得最像', 'cf9 关于我的'],
  ['关于我自己的', '也该为自己许一次了', 'cs6 关于我自己的']
];
PAIRS.forEach(([label, reply, tag], i) => {
  const needle = '{ t: "' + label + '", reply: ["' + reply + '"';
  ok(src.indexOf(needle) >= 0, 'S1' + 'abcdef'[i] + ' src：选项「' + tag + '」与它的 TA 回应成对在位');
});
// 旧（TA 视角）文案清零
const OLD = ['{ t: "多关心你", reply: ["关心你这件事', '{ t: "多逗你笑", reply: ["那我攒几个笑话',
  '{ t: "你难过的样子", reply: ["记住了', '{ t: "你认真做事的样子", reply: ["认真的你',
  '{ t: "关于你的", reply: ["画你', '{ t: "关于你自己的", reply: ["也该为自己许一次了'];
const oldLeft = OLD.filter((n) => src.indexOf(n) >= 0);
ok(oldLeft.length === 0, 'S2 src：六处 TA 视角旧文案全部清零', oldLeft.join(' / '));
// 迁移件 + 调用点（且调用在合并循环之前，否则按 t 匹配的 reply 同步会失配）
const iFn = src.indexOf('function tcOptLabelSync(d) {');
const iCall = src.indexOf('let changed = tcOptLabelSync(d);');
const iLoop = src.indexOf('TC_DEFAULT.forEach(q => {\n      if (!mergedSet[q.id] && !ids[q.id]) {');
ok(iFn >= 0, 'S3a src：预设选项文案同步件 tcOptLabelSync 在位（删＝已装用户拿不到修正）');
ok(iCall >= 0 && iLoop > iCall, 'S3b src：同步在合并循环之前执行（改到循环之后＝按 t 匹配的 reply 同步失配）');
ok(src.indexOf("x.id === def.id && x.isPreset === true") >= 0 && src.indexOf('local.options.length !== def.options.length') >= 0,
  'S4 src：同步只认预设题 + 条数守卫（不碰用户自加题、不冒错位覆盖风险）');
// 产物同款（构建真的接进去了）
const prodMissing = PAIRS.map(([label, reply]) => '{ t: "' + label + '", reply: ["' + reply + '"').filter((n) => prod.indexOf(n) < 0);
const prodOld = OLD.filter((n) => prod.indexOf(n) >= 0);
ok(prodMissing.length === 0, 'S5a 产物 js/ta-ask.js：六处修正文案全部在位', prodMissing.join(' / '));
ok(prodOld.length === 0, 'S5b 产物 js/ta-ask.js：旧文案零残留', prodOld.join(' / '));
const sent = ['#999a', '#999b', '#999c', '#999d', '#999e', '#999f', '#999g', '#999h', '#999i', '#999j', '#999k', '#999l'];
const sentMissing = sent.filter((n) => bm.indexOf(n) < 0);
ok(sentMissing.length === 0, 'S6 build.mjs：#999a~l 十二条哨兵在位', sentMissing.join(' / '));
// 四道受影响题的选项集合＝期望集合（防「改到别处 / 改漏一处」）
const optSetOf = (id) => {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.indexOf('{ id: "' + id + '",') >= 0);
  if (i < 0) return null;
  return [...lines[i + 1].matchAll(/\{ t: "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
};
const EXPECT = {
  cr11: ['多说想我', '多关心我', '多逗我笑', '现在这样就很好'],
  cl10: ['笑得最真的那次', '我难过的样子', '我认真做事的样子', '全都记住'],
  cf9: ['太抽象的', '太具体的', '关于我的', '什么都不怕'],
  cs6: ['关于我们的', '关于我自己的', '关于家人朋友', '不许，留着星星']
};
const badSets = Object.keys(EXPECT).filter((id) => JSON.stringify(optSetOf(id)) !== JSON.stringify(EXPECT[id]));
ok(badSets.length === 0, 'S7 四道题（cr11/cl10/cf9/cs6）的选项集合与期望逐条一致',
  badSets.map((id) => id + '=' + JSON.stringify(optSetOf(id))).join(' / '));

// =====================================================================
// A 组：无头行为（390×844）
// =====================================================================
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const jsErrors = [];
await cdp('Runtime.addBinding', { name: '__noop' }).catch(() => {});
const SEED_KEY = 'xy-home-v2:default:ta-choose';
// 老用户的固化题库：四道受影响题全是旧（TA 视角）文案；cr11 的 reply 故意写成旧值，
// 用来验证「改了 t 之后按 t 匹配的 reply 同步是否还活着」
const staleOpt = (t, reply) => ({ t: t, reply: reply, liked: false });
const STALE_BANK = {
  settings: { enabled: true, prob: 5, useDefault: true },
  questions: [
    { id: 'cr11', cat: 'rel', text: '你希望我以后多做一些什么？', pref: 2, isPreset: true, enabled: true, options: [
      staleOpt('多说想我', ['好，想你了，现在就说']), staleOpt('多关心你', ['旧回应·应被代码同步覆盖']),
      staleOpt('多逗你笑', ['那我攒几个笑话']), staleOpt('现在这样就很好', ['那就不加不减，保持'])] },
    { id: 'cl10', cat: 'like', text: '你希望我记住你的哪一个瞬间？', pref: 0, isPreset: true, enabled: true, options: [
      staleOpt('笑得最真的那次', ['那个瞬间，我也记得']), staleOpt('你难过的样子', ['记住了，以后多让你不难过']),
      staleOpt('你认真做事的样子', ['认真的你，最好看']), staleOpt('全都记住', ['贪心，但我也是这么想的'])] },
    { id: 'cf9', cat: 'fun', text: '玩你画我猜，你最怕我画什么？', pref: 2, isPreset: true, enabled: true, options: [
      staleOpt('太抽象的', ['抽象的我画得出来，你信吗']), staleOpt('太具体的', ['具体的我可能翻车']),
      staleOpt('关于你的', ['画你？那我画得最像']), staleOpt('什么都不怕', ['胆子大，那我出难题了'])] },
    { id: 'cs6', cat: 'star', text: '如果有一颗星星可以帮你实现一个小愿望，你会许什么方向？', pref: 0, isPreset: true, enabled: true, options: [
      staleOpt('关于我们的', ['那颗星星会加班的']), staleOpt('关于你自己的', ['也该为自己许一次了']),
      staleOpt('关于家人朋友', ['你心里装着很多人，我知道']), staleOpt('不许，留着星星', ['好，那颗星星就归你了'])] },
    // 用户自加的题（isPreset 不是 true）：文案与预设旧文案相同，也必须一字不动
    { id: 'q_mine_996', cat: 'rel', text: '我自己加的一道题', pref: 0, enabled: true, isPreset: false, options: [
      staleOpt('多关心你', ['我自己写的回应']), staleOpt('多逗你笑', ['我自己写的回应2'])] }
  ],
  mergedIds: ['cr11', 'cl10', 'cf9', 'cs6'],
  history: [], favs: [], groups: []
};

async function seedAndBoot(bank) {
  await cdp('Page.navigate', { url: baseUrl + '/icon-192.png' }); // 同源非应用页：先落种子再进应用
  await sleep(500);
  await evalJs("(function(){try{localStorage.setItem('xy-home-v2:applock-qaskip','1');localStorage.setItem('" + SEED_KEY + "'," + JSON.stringify(JSON.stringify(bank)) + ");}catch(e){}return true;})()");
  await reloadApp();
}
async function reloadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html?x=' + Date.now() });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(600);
}
const readBank = async () => {
  const raw = await evalJs("(function(){try{return window.activeStore().get('ta-choose');}catch(e){return 'ERR:'+e.message;}})()");
  try { return JSON.parse(raw); } catch (e) { return null; }
};
const optOf = (bank, qid, label) => {
  const q = (bank && bank.questions || []).filter((x) => x && x.id === qid)[0];
  if (!q || !Array.isArray(q.options)) return null;
  const o = q.options.filter((x) => x && x.t === label)[0];
  return o || null;
};
const optAt = (bank, qid, i) => {
  const q = (bank && bank.questions || []).filter((x) => x && x.id === qid)[0];
  return (q && Array.isArray(q.options) && q.options[i]) || null;
};

// —— 阶段 1：旧库 → 启动 + 触发一次小问题（触发会走 tcLoad＝合并/迁移/落盘） ——
await seedAndBoot(STALE_BANK);
await evalJs('window.triggerTaChooseNow && window.triggerTaChooseNow()');
await sleep(900);
let bank = await readBank();
ok(!!bank, 'A0 题库可读（种子已落盘并被应用接管）', bank ? '' : String(await evalJs("(function(){try{return window.activeStore().get('ta-choose');}catch(e){return 'ERR';}})()")).slice(0, 80));
const migrated = bank ? [
  optOf(bank, 'cr11', '多关心我') && 'cr11·多关心我',
  optOf(bank, 'cr11', '多逗我笑') && 'cr11·多逗我笑',
  optOf(bank, 'cl10', '我难过的样子') && 'cl10·我难过的样子',
  optOf(bank, 'cl10', '我认真做事的样子') && 'cl10·我认真做事的样子',
  optOf(bank, 'cf9', '关于我的') && 'cf9·关于我的',
  optOf(bank, 'cs6', '关于我自己的') && 'cs6·关于我自己的'
].filter(Boolean) : [];
ok(migrated.length === 6, 'A1 已装用户的固化旧文案被同步成新文案（六处全中）', '命中 ' + migrated.length + '/6：' + migrated.join(' '));
const oldStill = bank ? [
  optOf(bank, 'cr11', '多关心你') && 'cr11', optOf(bank, 'cr11', '多逗你笑') && 'cr11b',
  optOf(bank, 'cl10', '你难过的样子') && 'cl10', optOf(bank, 'cl10', '你认真做事的样子') && 'cl10b',
  optOf(bank, 'cf9', '关于你的') && 'cf9', optOf(bank, 'cs6', '关于你自己的') && 'cs6'
].filter(Boolean) : [];
ok(oldStill.length === 0, 'A2 迁移后存储里旧文案零残留', oldStill.join(' '));
const cr11Reply = bank ? (optOf(bank, 'cr11', '多关心我') || {}).reply : null;
ok(Array.isArray(cr11Reply) && cr11Reply.length === 4 && cr11Reply.indexOf('关心你这件事，不会少') >= 0,
  'A3 迁移后该选项的 reply 仍与代码配对（按 t 匹配的同步没被改 t 打断）',
  JSON.stringify(cr11Reply));
const mine = bank ? optAt(bank, 'q_mine_996', 0) : null;
ok(!!mine && mine.t === '多关心你' && mine.reply[0] === '我自己写的回应',
  'A4 用户自加的题一字不动（只认 isPreset===true）', JSON.stringify(mine));

// —— 阶段 2：端到端——把库里其余题全关掉（只留 cr11，保证抽到它）→ 触发 → 卡片选项即新文案 → 作答 → 气泡成对 ——
const only = await readBank();
(only.questions || []).forEach((q) => { if (q && q.id !== 'cr11') q.enabled = false; });
await evalJs("(function(){try{window.activeStore().set('ta-choose'," + JSON.stringify(JSON.stringify(only)) + ");}catch(e){}return true;})()");
await sleep(300);
await reloadApp();
await evalJs("(function(){var b=document.getElementById('chat-body');if(b)b.innerHTML='';var m=document.getElementById('modal-mask');if(m)m.hidden=true;var t=document.getElementById('tc-mask');if(t)t.hidden=true;return true;})()");
// 卡片进的是聊天页：先停在聊天页再触发（真实用户就是在聊天里收到卡的）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(500);
await evalJs('window.triggerTaChooseNow && window.triggerTaChooseNow()');
await sleep(1200);
let cardQ = await evalJs("(function(){var c=document.querySelector('.msg-choose-card .msg-ask-q');return c?c.textContent:'';})()");
if (String(cardQ).indexOf('你希望我以后多做一些什么？') < 0) {
  await evalJs("(function(){var m=document.getElementById('modal-mask');if(m)m.hidden=true;var t=document.getElementById('tc-mask');if(t)t.hidden=true;return true;})()");
  await sleep(600);
  cardQ = await evalJs("(function(){var c=document.querySelector('.msg-choose-card .msg-ask-q');return c?c.textContent:'';})()");
}
const diag996 = await evalJs("(function(){try{var ms=window.getChatMsgs?window.getChatMsgs():[];return JSON.stringify({msgs:ms.length,chooseCards:document.querySelectorAll('.msg-choose-card').length,lastType:ms.length?String(ms[ms.length-1].special||''):''});}catch(e){return 'ERR:'+e.message;}})()");
ok(String(cardQ).indexOf('你希望我以后多做一些什么？') >= 0, 'A5 小问题卡已进聊天（题干命中）', String(cardQ).slice(0, 40) + ' | ' + diag996);
// 点卡片＝打开选择题面板（chat.js：ask-choose → window.openTC）
await evalJs("(function(){var m=document.getElementById('modal-mask');if(m)m.hidden=true;var t=document.getElementById('tc-mask');if(t)t.hidden=true;var c=document.querySelector('.msg-choose-card');if(c){try{c.click();}catch(e){}}return true;})()");
await sleep(700);
let panelOpen = await evalJs("(function(){var m=document.getElementById('tc-mask');return !!(m&&!m.hidden&&document.querySelectorAll('#tc-body .tc-opt').length);})()");
if (!panelOpen) {
  await evalJs("(function(){var ms=window.getChatMsgs?window.getChatMsgs():[];var idx=ms.length-1;if(window.openTC)window.openTC(idx);return true;})()");
  await sleep(700);
}
const optLabels = await evalJs("(function(){var a=[];document.querySelectorAll('#tc-body .tc-opt').forEach(function(o){a.push(o.textContent.trim());});return JSON.stringify(a);})()");
let labels = [];
try { labels = JSON.parse(optLabels); } catch (e) {}
ok(labels.indexOf('多关心我') >= 0, 'A6 面板选项当场就是新文案（多关心我）', JSON.stringify(labels));
ok(labels.indexOf('多关心你') < 0, 'A7 面板选项不再出现旧文案（多关心你）', JSON.stringify(labels));
const clicked = await evalJs("(function(){var o=document.querySelectorAll('#tc-body .tc-opt');for(var i=0;i<o.length;i++){if(o[i].textContent.trim()==='多关心我'){try{o[i].click();}catch(e){}return true;}}return false;})()");
ok(!!clicked, 'A8 点选「多关心我」作答', String(clicked));
await sleep(700);
const READ_BUBBLES = "(function(){function last(sel){var a=document.querySelectorAll(sel);return a.length?a[a.length-1].textContent:'';}return JSON.stringify({out:last('.msg-out .msg-bubble'),in:last('.msg-in .msg-bubble'),card:(document.querySelector('.msg-choose-card.answered')||{}).textContent||''});})()";
// 作答后气泡是异步渲染的：轮询等它出现（最多 ~3.6s），别读早了判成空
let bb = {};
for (let i = 0; i < 12; i++) {
  try { bb = JSON.parse(await evalJs(READ_BUBBLES)) || {}; } catch (e) { bb = {}; }
  if (bb.out === '多关心我' && bb.in) break;
  await sleep(300);
}
const REPLIES = ['关心你这件事，不会少', '多关心？那我嘘寒问暖', '关心不会少', '那关心什么最够？'];
ok(bb.out === '多关心我', 'A9 用户气泡＝自己选的那条（多关心我）', JSON.stringify(bb.out));
ok(REPLIES.indexOf(bb.in) >= 0, 'A10 TA 回应＝该选项配对的那组话术（人称一致）', JSON.stringify(bb.in));
ok(String(bb.card).indexOf('✓ 你选择了：多关心我') >= 0 && REPLIES.some((r) => String(bb.card).indexOf(r) >= 0),
  'A11 卡片回填同款口径（✓ 你选择了：多关心我 ＋ TA 回应）', String(bb.card).slice(0, 60));

const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
let errList = [];
try { errList = JSON.parse(errs) || []; } catch (e) {}
ok(!Array.isArray(errList) || errList.length === 0, 'Z1 全程零 JS 异常', Array.isArray(errList) ? JSON.stringify(errList.slice(0, 2)) : String(errs));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
console.log('\nverify-999-ask-option-person：' + (pass + fail) + ' 断言，' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
