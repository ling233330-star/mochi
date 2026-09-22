// ===== 回归验证 #1003：聊天「更多功能 → TA的提问」补三枚手动触发口 =====
// 用户原话（2026-09-21）：「聊天里的更多功能里的【ta的提问】分类里的功能，还缺少回复设置里的
//   【贴贴邀请】【邀请TA主动查岗】【邀请跨桌面查岗】。也是点击之后让联系人立即触发的功能。」
// 口径：这三件事原本只按概率发生（贴贴＝回复设置→其他「主动邀请贴贴」ai-cuddle-*；
//   查岗＝回复设置→查岗「TA 主动查岗」ckq-*；跨桌面查岗＝回复设置→其他「联系人跨桌面查岗」），
//   用户要的是「点一下当场来一次」。三枚各自接既有链路，不新开链路：
//   贴贴＝ta-invite 新增按 kind 抽卡 → chat.js sendTaInvite（弹同意/拒绝确认、同意轻震+TA 回应）；
//   查岗＝字卡库「让TA现在查岗一次」同一个 window.triggerCkQuestion；
//   跨桌面查岗＝incoming-requests 新增 window.triggerIncomingCheckinNow（挑一个开着查岗的其他桌面走既有弹窗）。
// 最容易被改错的一点（本脚本 A 组的判别核心）：贴贴那枚必须只从 cuddle 池抽。若退回
//   taInvitePickAny（rps/pong/snake/cuddle 全类型池），在数学随机的世界里「点贴贴收到猜拳」
//   就是必然会发生的事——A3 用「把 Math.random 钉成 0」把这件事变成确定性判据：
//   钉 0 时全类型池的头一张是猜拳（gInv=rps），贴贴池的头一张才是贴贴（gInv=cuddle）。
// 断言：S 组＝源码/产物静态；A 组＝无头行为（390×844，真实点击面板按钮）；Z 组＝零 JS 异常。
// 用法：node build.mjs && node tools/verify-1003-ta-checkin-cuddle-now.mjs
//       隔离副本：MOCHI_ROOT=<副本目录> node tools/verify-1003-ta-checkin-cuddle-now.mjs
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

const cdpPort = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-p1003-' + Date.now()),
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
    if (r && r.exceptionDetails) return 'EX:' + JSON.stringify(r.exceptionDetails).slice(0, 220);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'ERR:' + e.message; }
}
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

// =====================================================================
// S 组：源码 / 产物静态断言
// =====================================================================
const srcTpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const srcChat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const srcTi = readFileSync(join(root, 'src/js/ta-invite.js'), 'utf8');
const srcIr = readFileSync(join(root, 'src/js/incoming-requests.js'), 'utf8');
const srcHub = readFileSync(join(root, 'src/js/feature-hub.js'), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const prodHtml = readFileSync(join(root, 'index.html'), 'utf8');
const prodChat = readFileSync(join(root, 'js/chat.js'), 'utf8');
const prodTi = readFileSync(join(root, 'js/ta-invite.js'), 'utf8');
const prodIr = readFileSync(join(root, 'js/incoming-requests.js'), 'utf8');
const prodHub = readFileSync(join(root, 'js/feature-hub.js'), 'utf8');

// 三枚按钮必须在 TA的提问 那个 grid 里（不在互动/工具/小游戏 grid）
const askGrid = (function () {
  const i = srcTpl.indexOf('id="more-grid-ask"');
  if (i < 0) return '';
  const j = srcTpl.indexOf('</div>', i);
  return srcTpl.slice(i, j);
})();
const IDS = ['more-cuddle-now', 'more-ck-now', 'more-xck-now'];
const notInAsk = IDS.filter((id) => askGrid.indexOf('id="' + id + '"') < 0);
ok(askGrid.length > 0 && notInAsk.length === 0, 'S1 src：三枚按钮都挂在 #more-grid-ask（TA的提问）里', notInAsk.join(' / '));
// 面板里原有的五枚不能被顺手删掉（用户说的是「还缺少」，不是「换成」）
const KEEP = ['more-ask-now', 'more-choose-now', 'more-curious-now', 'more-roast-now', 'more-invite-now'];
const keepGone = KEEP.filter((id) => askGrid.indexOf('id="' + id + '"') < 0);
ok(keepGone.length === 0, 'S2 src：原有五枚（询问/小问题/好奇/吐槽/邀请）一个不少', keepGone.join(' / '));

// 接线：三枚各接自己那条链路
const WIRE = [
  ["bindTaNow('more-cuddle-now', () => { if (window.triggerTaCuddleNow)", '贴贴'],
  ["bindTaNow('more-ck-now', () => { if (window.triggerCkQuestion)", '查岗'],
  ["bindTaNow('more-xck-now', () => { if (window.triggerIncomingCheckinNow)", '跨桌面查岗']
];
const wireBad = WIRE.filter(([n]) => srcChat.indexOf(n) < 0);
ok(wireBad.length === 0, 'S3 src/js/chat.js：三枚按钮各接自己的触发函数（贴贴/查岗/跨桌面查岗）', wireBad.map((w) => w[1]).join(' / '));
// 贴贴口径：只认 cuddle 池（退回全类型随机＝用户点贴贴收到猜拳）
const CUDDLE_ONLY = "window.taInvitePickKind('cuddle')";
ok(srcChat.indexOf(CUDDLE_ONLY) >= 0, 'S4 src/js/chat.js：贴贴触发只从 cuddle 池抽（与「邀请」那枚的全类型随机区分开）');
const WRONG_WIRE = "bindTaNow('more-cuddle-now', () => { if (window.triggerTaInviteNow)";
ok(srcChat.indexOf(WRONG_WIRE) < 0, 'S5 src/js/chat.js：贴贴按钮没有退回全类型随机邀请（删除型，用户报障形态）');
ok(srcTi.indexOf('window.taInvitePickKind = function (kind) {') >= 0 && srcTi.indexOf('return drawFrom(enabledPool(d, [kind]));') >= 0,
  'S6 src/js/ta-invite.js：按类型抽卡出口在，且只在传入那类的启用池里抽');
ok(srcIr.indexOf('window.triggerIncomingCheckinNow = function () {') >= 0 &&
  srcIr.indexOf("num(cfgFor(c.id), 'ckq-en', 1) === 1 && !hasPending(c.id)") >= 0 &&
  srcIr.indexOf("_toast('联系人跨桌面查岗已关闭，可在 设置 里开启')") >= 0,
  'S7 src/js/incoming-requests.js：跨桌面手动触发在（候选过滤 + 全局开关守卫都在）');

// 产物同款（构建真的接进去了）
const prodMiss = [];
if (prodHtml.indexOf('id="more-cuddle-now"') < 0) prodMiss.push('index.html:more-cuddle-now');
if (prodHtml.indexOf('id="more-ck-now"') < 0) prodMiss.push('index.html:more-ck-now');
if (prodHtml.indexOf('id="more-xck-now"') < 0) prodMiss.push('index.html:more-xck-now');
if (prodChat.indexOf("bindTaNow('more-cuddle-now', () => { if (window.triggerTaCuddleNow)") < 0) prodMiss.push('js/chat.js:贴贴接线');
if (prodChat.indexOf("bindTaNow('more-ck-now', () => { if (window.triggerCkQuestion)") < 0) prodMiss.push('js/chat.js:查岗接线');
if (prodChat.indexOf("bindTaNow('more-xck-now', () => { if (window.triggerIncomingCheckinNow)") < 0) prodMiss.push('js/chat.js:跨桌面接线');
if (prodTi.indexOf('window.taInvitePickKind = function (kind) {') < 0) prodMiss.push('js/ta-invite.js:按类型抽卡');
if (prodIr.indexOf('window.triggerIncomingCheckinNow = function () {') < 0) prodMiss.push('js/incoming-requests.js:手动触发口');
ok(prodMiss.length === 0, 'S8 产物：三枚按钮 + 三处接线 + 两个新出口全部在位', prodMiss.join(' / '));

// 文案面：功能说明（用户可感知功能必须进说明）+ 功能大全可搜索 + 回复设置两处指路
const copyMiss = [];
if (prodHtml.indexOf('（询问 / 小问题 / 好奇 / 吐槽 / 邀请 / 贴贴 / 查岗 / 跨桌面查岗）') < 0) copyMiss.push('功能说明面板条目');
if (srcHub.indexOf("'#more-cuddle-now'") < 0 || srcHub.indexOf("'#more-ck-now'") < 0 || srcHub.indexOf("'#more-xck-now'") < 0) copyMiss.push('功能大全三行');
if (prodHtml.indexOf('聊天 →「更多功能 → TA的提问 → 查岗」') < 0) copyMiss.push('回复设置·查岗指路');
if (prodHtml.indexOf('聊天 →「更多功能 → TA的提问 → 跨桌面查岗」') < 0) copyMiss.push('回复设置·跨桌面查岗指路');
ok(copyMiss.length === 0, 'S9 文案面：功能说明 / 功能大全 / 回复设置两处指路都同步', copyMiss.join(' / '));

const sent = ['#1003a', '#1003b', '#1003c', '#1003d', '#1003e', '#1003f', '#1003g', '#1003h', '#1003i', '#1003j', '#1003k', '#1003l', '#1003m', '#1003n', '#1003o'];
const sentMissing = sent.filter((n) => bm.indexOf(n) < 0);
ok(sentMissing.length === 0, 'S10 build.mjs：#1003a~o 十五条哨兵在位', sentMissing.join(' / '));

// =====================================================================
// A 组：无头行为（390×844）
// =====================================================================
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function reloadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html?x=' + Date.now() });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(700);
}
await cdp('Page.navigate', { url: baseUrl + '/icon-192.png' });
await sleep(400);
// 种子：①跳过开屏问答门；②把「上次备份时间」种成现在——只是为了不让产品内建的
// 定期备份提醒弹窗（pwa.js，受保护功能、本批一字未动）在断言中途抢走 #modal-mask，
// 属于测试环境降噪，不是绕过产品逻辑。
await evalJs("(function(){try{localStorage.setItem('xy-home-v2:applock-qaskip','1');localStorage.setItem('xy-home-v2:__last-backup',String(Date.now()));}catch(e){}return true;})()");
await reloadApp();
// 关掉一切可能挡住点击的浮层 + 停在聊天页
const clearLayers = "(function(){try{['modal-mask','tc-mask','qa-mask'].forEach(function(id){var m=document.getElementById(id);if(m)m.hidden=true;});}catch(e){}return true;})()";
await evalJs(clearLayers);
await evalJs("(function(){try{if(window.enterChat)window.enterChat();}catch(e){}return true;})()");
await sleep(800);
await evalJs(clearLayers);
ok(String(await evalJs("(function(){return document.getElementById('page-chat')?!document.getElementById('page-chat').hidden:false;})()")) === 'true',
  'A0 聊天页就绪（后续断言都在真实聊天页上点面板按钮）');

// —— A1/A2 分类归属：只有切到「TA的提问」才出现 ——
await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
await sleep(400);
await evalJs("(function(){var t=document.querySelector('#more-tabs .more-tab[data-mcat=\"ask\"]');if(t)t.click();return true;})()");
await sleep(300);
const inAsk = await evalJs("(function(){var out={};['more-cuddle-now','more-ck-now','more-xck-now'].forEach(function(id){var e=document.getElementById(id);out[id]=!!e&&!e.hidden&&e.offsetParent!==null;});out.gridHidden=document.getElementById('more-grid-ask').hidden;out.funHidden=document.getElementById('more-grid-fun').hidden;return JSON.stringify(out);})()");
let ask = {};
try { ask = JSON.parse(inAsk) || {}; } catch (e) { ask = {}; }
ok(ask.gridHidden === false && ask.funHidden === true, 'A1 切到「TA的提问」＝ask 网格显示、其余网格收起', inAsk);
ok(ask['more-cuddle-now'] && ask['more-ck-now'] && ask['more-xck-now'],
  'A2 三枚新按钮在「TA的提问」面板里可见（贴贴 / 查岗 / 跨桌面查岗）', inAsk);
await evalJs("(function(){var t=document.querySelector('#more-tabs .more-tab[data-mcat=\"chat\"]');if(t)t.click();return true;})()");
await sleep(250);
const outOfAsk = await evalJs("(function(){var e=document.getElementById('more-cuddle-now');return JSON.stringify({hidden:document.getElementById('more-grid-ask').hidden,btn:!!e&&e.hidden});})()");
ok(String(outOfAsk).indexOf('"hidden":true') >= 0, 'A3 切到「互动」分类时三枚随之收起（分类归属正确，没混进别的分类）', outOfAsk);
await evalJs("(function(){var t=document.querySelector('#more-tabs .more-tab[data-mcat=\"ask\"]');if(t)t.click();return true;})()");
await sleep(250);

// —— A4~A6 贴贴：点一下必须来「贴贴」，并且走完整的同意流程 ——
// Math.random 钉 0：全类型池（rps/pong/snake/cuddle 顺序）头一张是猜拳，
// 贴贴池的头一张才是贴贴 —— 这一条把「有没有真正按类型抽」变成确定性判据。
await evalJs(clearLayers);
await evalJs("(function(){window.__mr1003=Math.random;Math.random=function(){return 0;};return true;})()");
await evalJs("(function(){document.getElementById('more-cuddle-now').click();return true;})()");
await sleep(200);
await evalJs("(function(){Math.random=window.__mr1003;return true;})()");
await sleep(400);
let lastMsg = await evalJs("(function(){try{var m=window.getChatMsgs?window.getChatMsgs():[];var x=m[m.length-1]||{};return JSON.stringify({text:String(x.text||''),special:String(x.special||''),gInv:String(x.gInv||''),n:m.length});}catch(e){return 'ERR:'+e.message;}})()");
let lm = {};
try { lm = JSON.parse(lastMsg) || {}; } catch (e) { lm = {}; }
const CUDDLE_TEXTS = ['想贴贴了，你可以过来一点吗？', '抱一下再忙别的嘛，就一下下', '手伸过来，我想牵一会儿', '靠着你坐一会儿吧，什么都不做的那种', '想把脑袋搁在你肩上，借我五分钟', '刚才好像碰到你的手了？再来一次，这次牵住不放', '隔着世界也想贴贴你，感觉到了就不要躲', '今天很想你，想到想蹭蹭你', '晚上早点休息，我来抱着你睡', '心情很好，这种时候最适合亲亲了'];
ok(lm.special === 'poke' && lm.gInv === 'cuddle',
  'A4 点「贴贴」→ 聊天里落的是一条 cuddle 类邀请（gInv=cuddle；钉随机数后若走了全类型池这里会是 rps）', lastMsg);
ok(CUDDLE_TEXTS.some((t) => lm.text.indexOf(t) >= 0), 'A5 邀请正文取自贴贴预设池（贴贴/抱抱/牵手/靠着）', lastMsg);
await sleep(1200); // sendTaInvite 内 700ms 后才弹同意/拒绝确认
const confirm = await evalJs("(function(){var m=document.getElementById('modal-mask');var t=document.getElementById('modal-title');return JSON.stringify({open:m?!m.hidden:false,title:t?t.textContent:'',static:(document.getElementById('modal-static')||{}).textContent||''});})()");
let cf = {};
try { cf = JSON.parse(confirm) || {}; } catch (e) { cf = {}; }
ok(cf.open === true && String(cf.title).indexOf('贴贴邀请') >= 0, 'A6 贴贴邀请弹的是同意/拒绝确认框（标题「<昵称> 的贴贴邀请」）', confirm);
await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
// 系统消息同步落、TA 的贴贴回应是异步打字链（addInTyped，随回复速度设置）：轮询等两条都出现，
// 别用固定 sleep 判（实测固定 1.1s 有约 1/3 概率读早了＝假红）
const CUDDLE_REPLIES = ['嗯……蹭到了。暖暖的，很喜欢。', '那我要贴很久哦，不许偷偷跑掉。', '手被握住了，就这样待一会儿。', '感觉到了，你在旁边。很安心。', '贴贴充电中……好，满格了。'];
const READ_AFTER = "(function(){try{var m=window.getChatMsgs?window.getChatMsgs():[];var sys=[],tail=[];for(var i=Math.max(0,m.length-6);i<m.length;i++){var x=m[i]||{};var t=String(x.text||'');if(t.indexOf('你接受了')>=0)sys.push(t);tail.push(t);}return JSON.stringify({sys:sys,tail:tail});}catch(e){return 'ERR:'+e.message;}})()";
let after = '', af = {};
for (let i = 0; i < 16; i++) {
  after = await evalJs(READ_AFTER);
  try { af = JSON.parse(after) || {}; } catch (e) { af = {}; }
  const hasSys = (af.sys || []).length > 0;
  const hasReply = (af.tail || []).some((t) => CUDDLE_REPLIES.some((r) => t.indexOf(r) >= 0));
  if (hasSys && hasReply) break;
  await sleep(300);
}
ok((af.sys || []).some((t) => t.indexOf('你接受了') >= 0), 'A7 同意后落了「你接受了 … 的贴贴邀请」系统消息（#510 留痕口径没被这枚新入口绕开）', after);
ok((af.tail || []).some((t) => CUDDLE_REPLIES.some((r) => t.indexOf(r) >= 0)), 'A8 同意后 TA 回了贴贴专属回应（走的是 sendTaInvite 的既有链路）', after);
await evalJs(clearLayers);
await sleep(200);

// —— A9~A10 查岗：点一下当场发一张查岗卡 ——
await evalJs("(function(){document.getElementById('more-ck-now').click();return true;})()");
await sleep(1200);
let ck = await evalJs("(function(){try{var m=window.getChatMsgs?window.getChatMsgs():[];var cards=[];for(var i=Math.max(0,m.length-6);i<m.length;i++){var x=m[i]||{};if(String(x.special||'')==='ask-card')cards.push(String(x.askQuestion||x.text||''));}return JSON.stringify({cards:cards});}catch(e){return 'ERR:'+e.message;}})()");
let ckObj = {};
try { ckObj = JSON.parse(ck) || {}; } catch (e) { ckObj = {}; }
ok((ckObj.cards || []).length > 0 && String(ckObj.cards[0]).length > 1, 'A9 点「查岗」→ 聊天里当场落一张查岗问题卡（走既有 triggerCkQuestion）', ck);
await evalJs(clearLayers);
await sleep(200);

// —— A11~A14 跨桌面查岗：挑「其他」桌面，且守住全局开关与候选过滤 ——
const c2 = await evalJs("(function(){try{return String(window.createContact('验证二号桌面')||'');}catch(e){return 'ERR:'+e.message;}})()");
ok(typeof c2 === 'string' && c2.indexOf('c') === 0, 'A11 造出第二个桌面（跨桌面前提）', String(c2));
await sleep(300);
const cur = await evalJs("(function(){return String(window.__activeCid||'default');})()");
await evalJs(clearLayers);
await evalJs("(function(){window.__xck1003=window.triggerIncomingCheckinNow;return true;})()");
const fired = await evalJs("(function(){try{return String(!!(window.triggerIncomingCheckinNow&&window.triggerIncomingCheckinNow()));}catch(e){return 'ERR:'+e.message;}})()");
await sleep(500);
const xck = await evalJs("(function(){var m=document.getElementById('modal-mask');var t=document.getElementById('modal-title');return JSON.stringify({open:m?!m.hidden:false,title:t?t.textContent:'',cur:String(window.__activeCid||'default')});})()");
let xk = {};
try { xk = JSON.parse(xck) || {}; } catch (e) { xk = {}; }
ok(fired === 'true', 'A12 triggerIncomingCheckinNow 返回值＝true（真的投出去了）', fired);
ok(xk.open === true && String(xk.title).indexOf('来查岗了') > 0, 'A13 弹出「<其他桌面联系人> 来查岗了」弹窗（走既有 deliver / openModal）', xck);
// 「挑的是其他桌面」用队列里的 cid 直接判（标题只给名字，名字判据弱且会被改名绕开）
const otherName = await evalJs("(function(){try{return String(window.contactNameFor('" + String(c2) + "')||'');}catch(e){return '';}})()");
const queued = await evalJs("(function(){try{var q=JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests')||'[]');var p=q.filter(function(x){return x&&x.status==='pending';});var last=p[p.length-1]||{};return JSON.stringify({cid:String(last.cid||''),kind:String(last.kind||'')});}catch(e){return 'ERR:'+e.message;}})()");
let qq = {};
try { qq = JSON.parse(queued) || {}; } catch (e) { qq = {}; }
ok(qq.cid === String(c2) && qq.cid !== String(cur) && qq.kind === 'checkin',
  'A14 投的是「其他桌面」（队列里 pending 的 cid＝第二个桌面，当前桌面 ' + cur + ' 不参与自我打扰）',
  queued + ' / 其他桌面名=' + otherName);
ok(String(otherName).length > 0 && String(xk.title).indexOf(String(otherName)) === 0,
  'A14b 弹窗标题以那个其他桌面的名字开头（用户一眼知道是谁来查岗）', xck);
await evalJs(clearLayers);
await sleep(300);
// 全局开关关着 → 只提示、不触发（不违背用户显式设定）
const offRes = await evalJs("(function(){try{window.setDeskCheckinEn(false);var r=String(!!window.triggerIncomingCheckinNow());var m=document.getElementById('modal-mask');return JSON.stringify({r:r,modal:m?!m.hidden:false,toast:String((document.getElementById('cc-toast')||{}).textContent||'')});}catch(e){return 'ERR:'+e.message;}})()");
let off = {};
try { off = JSON.parse(offRes) || {}; } catch (e) { off = {}; }
ok(off.r === 'false' && off.modal === false, 'A15 全局「联系人跨桌面查岗」关着时点这枚＝不触发、不弹窗', offRes);
await sleep(400);
const offToast = await evalJs("(function(){try{return String((document.getElementById('cc-toast')||{}).textContent||'');}catch(e){return '';}})()");
ok(String(offToast).indexOf('已关闭') >= 0, 'A16 关着时给了明确提示（用户知道去哪开，而不是「点了没反应」）', String(offToast));
await evalJs("(function(){try{window.setDeskCheckinEn(true);}catch(e){}return true;})()");
// 其他桌面自己关了 TA 主动查岗 → 候选池过滤（#1003l），不许硬投
const only2 = await evalJs("(function(){try{window.storeFor('" + String(c2) + "').set('reply-ckq-en','0');return true;}catch(e){return 'ERR:'+e.message;}})()");
await sleep(200);
const noCand = await evalJs("(function(){try{return String(!!window.triggerIncomingCheckinNow());}catch(e){return 'ERR:'+e.message;}})()");
await sleep(400);
const noCandToast = await evalJs("(function(){try{return String((document.getElementById('cc-toast')||{}).textContent||'');}catch(e){return '';}})()");
ok(noCand === 'false' && String(noCandToast).indexOf('主动查岗') >= 0,
  'A17 其他桌面都关了「TA 主动查岗」时＝不硬投，并提示去 回复设置 → 查岗 开（候选过滤生效）', noCand + ' / ' + noCandToast);

const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
let errList = [];
try { errList = JSON.parse(errs) || []; } catch (e) {}
ok(!Array.isArray(errList) || errList.length === 0, 'Z1 全程零 JS 异常', Array.isArray(errList) ? JSON.stringify(errList.slice(0, 2)) : String(errs));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
console.log('\nverify-1003-ta-checkin-cuddle-now：' + (pass + fail) + ' 断言，' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
