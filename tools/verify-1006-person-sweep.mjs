// ===== 回归验证 #1006：全站互动文案人称排查后的修正（用户直派「你全部帮我检查」，承接 #999） =====
// 用户原话（2026-09-21）：「你全部帮我检查。」
// 排查面：六路并行审校——①ta-ask 四库（询问/小问题/好奇/吐槽）＋回应池；②查岗单选＋互动动作卡；
//   ③邀请/情绪/来电；④字卡与回应卡池；⑤朋友圈/日历/信箱/礼物/桌面小功能；⑥聊天/群聊/抉择/模板提示。
// 本批落地（都是「说话人指错人」且不必重写大段文案的）：
//   小问题 cs5 选项「猜你下一张字卡」；cd17「我/你」两条主句归位；cd6「好，那我先说」；cd14「那你看着我」；
//   cw6 转述「笑我？」；好奇 cw6 快答「跟着我走」＋迁移表；查岗回应字卡按方向归位（11 张被查方口吻卡片移到
//   「联系人申请我对联系人查岗」组，方向1 补 4 张查岗方新卡）；心意币碎碎念「你的心意币变多了」；
//   摸鱼小结信改 TA 口吻；市集标语「送给 TA」；喝水播报「你今天喝了」；存钱罐回话与「问 TA」改走用户发送侧。
// 未并入本批：互动动作卡 accept/reject 池（需新写约 20 句 TA 口径文案 ＋ 按联系人迁移，见 WORKLOG）。
// 断言：S 组＝源码/产物静态（各处新文案在位、旧文案清零、查岗两组方向结构、哨兵在位）；
//   A 组＝无头行为（好奇库旧快答与历史答案被迁移；查岗回应池两个方向各取各的口径）；Z 组＝零 JS 异常。
// 用法：node build.mjs && node tools/verify-1006-person-sweep.mjs
//       隔离副本：MOCHI_ROOT=<副本目录> node tools/verify-1006-person-sweep.mjs
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-p1005-' + Date.now()),
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
// S 组：源码 / 产物静态
// =====================================================================
const srcAsk = readFileSync(join(root, 'src/js/ta-ask.js'), 'utf8');
const prodAsk = readFileSync(join(root, 'js/ta-ask.js'), 'utf8');
const srcDcd = readFileSync(join(root, 'src/js/default-cards-data.js'), 'utf8');
const prodDcd = readFileSync(join(root, 'js/default-cards-data.js'), 'utf8');
const srcP2 = readFileSync(join(root, 'src/js/p2-features.js'), 'utf8');
const srcMail = readFileSync(join(root, 'src/js/mail.js'), 'utf8');
const srcGift = readFileSync(join(root, 'src/js/gift-shop.js'), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');

const NEED = [
  ['{ t: "悬疑——猜你下一张字卡", reply: ["你猜中的次数，其实不多"', 'S1a 小问题 cs5 选项＝用户自答口径（猜 TA 下一张字卡）', prodAsk],
  ['{ t: "我", reply: ["那你看着我睡","你先醒？那看我睡"', 'S1b 小问题 cd17「我」＝用户先醒（TA 说「那你看着我睡」）', prodAsk],
  ['{ t: "你", reply: ["那我看着你睡","我先醒？那看你睡"', 'S1c 小问题 cd17「你」＝TA 先醒（TA 说「那我看着你睡」）', prodAsk],
  ['{ t: "你", reply: ["好，那我先说","我先说？那我定个闹钟"', 'S1d 小问题 cd6 选项「你」＝TA 先说晚安', prodAsk],
  ['"看着也行，那你看着我"', 'S1e 小问题 cd14 选项「你做饭我看着」＝用户看 TA 做饭', prodAsk],
  ['"笑我？那我不客气了"', 'S1f 小问题 cw6 转述换人称（用户笑的是 TA）', prodAsk],
  ["quick: ['床头', '书桌边', '窗边', '跟着我走']", 'S1g 好奇库 cw6 快答「跟着我走」（TA 跟着用户）', prodAsk]
];
NEED.forEach(([n, name, txt]) => ok(txt.indexOf(n) >= 0, name));
const OLD_NEED = [
  ['{ t: "悬疑——猜我下一张字卡"', 'S2a 旧选项「猜我下一张字卡」清零'],
  ['{ t: "我", reply: ["那我看着你睡","你先醒？那看我睡"', 'S2b 旧「我」主句清零'],
  ['{ t: "你", reply: ["好，我等你先说"', 'S2c 旧「好，我等你先说」清零'],
  ['"看着也行，那我看你"', 'S2d 旧「那我看你」清零'],
  ['"笑你？那我不客气了"', 'S2e 旧「笑你？」清零'],
  ["quick: ['床头', '书桌边', '窗边', '跟着你走']", 'S2f 旧快答「跟着你走」清零']
];
OLD_NEED.forEach(([n, name]) => ok(prodAsk.indexOf(n) < 0, name));
ok(prodAsk.indexOf("cw6: { '跟着你走': '跟着我走' },") >= 0 &&
  prodAsk.indexOf("else if (h && h.my === '跟着你走') h.my = '跟着我走';") >= 0,
  'S3 好奇库「快捷项人称修正」迁移表＋历史答案同步都带上这条（删＝已装用户拿不到修正）');

// 查岗两组方向结构（结构化：被查方口吻的卡片必须在方向2 组里，方向1 组只剩查岗方口吻）
const MOVED = ['你来查岗，我正好也想你了', '被抓到了，我正在想你呀', '在呀在呀，一直在等你', '被你发现了，我确实有点想你',
  '老实交代，我刚刚在想你', '报告，我正在想你，请你查收', '查吧查吧，我的心都是你的', '被你查到心坎里了',
  '你查我，我当然条条秒回', '那你继续查，我全都交代', '被你惦记着，我很安心'];
const NEW_CARDS = ['问到你了，我就安心了', '原来你在这儿，那我不找了', '好，那我放心去忙了，晚点再来找你', '问这一句，其实只是想你了'];
const KEPT = ['查岗成功，奖励你一个亲亲', '你一来，我就有空了', '这么想我呀，那我过去找你', '收到你的关心，心里暖暖的'];
function groupBody(txt, header) {
  const i = txt.indexOf('"' + header + '", [');
  if (i < 0) return null;
  const j = txt.indexOf(']],', i);
  return txt.slice(i, j < 0 ? i + 4000 : j);
}
const g1 = groupBody(prodDcd, '联系人对我查岗') || '';
const g2 = groupBody(prodDcd, '联系人申请我对联系人查岗') || '';
ok(MOVED.every((c) => g1.indexOf('"' + c + '"') < 0), 'S4a 方向1 组（TA 来查我）不再有「被查的我」口吻卡片',
  MOVED.filter((c) => g1.indexOf('"' + c + '"') >= 0).join(' / '));
ok(MOVED.every((c) => g2.indexOf('"' + c + '"') >= 0), 'S4b 这 11 张卡片都在方向2 组（TA 被查，正合它们的说话人）',
  MOVED.filter((c) => g2.indexOf('"' + c + '"') < 0).join(' / '));
ok(KEPT.every((c) => g1.indexOf('"' + c + '"') >= 0) && NEW_CARDS.every((c) => g1.indexOf('"' + c + '"') >= 0),
  'S4c 方向1 组保留 4 张查岗方卡片并补 4 张新卡（组不空）',
  KEPT.concat(NEW_CARDS).filter((c) => g1.indexOf('"' + c + '"') < 0).join(' / '));

const P2 = [
  ["const COIN_TA_NOTES = ['偷偷塞了一把心意币', '你的心意币变多了'", 'S5a 心意币碎碎念回到 TA 第一人称'],
  ["const base = '你今天喝了 '", 'S5b 喝水播报改 TA 口吻（「你今天喝了」）'],
  ['if (t && window.chatSendMsg) { try { window.chatSendMsg(t); } catch (e) {} toast(\'已回复\'); }', 'S5c 存钱罐「回一句给TA」走用户发送侧'],
  ['if (window.chatSendMsg) { try { window.chatSendMsg(msg); }', 'S5d 吃什么「问 TA」走用户发送侧']
];
P2.forEach(([n, name]) => ok(srcP2.indexOf(n) >= 0, name));
ok(srcMail.indexOf("'你和我一共摸鱼 ' + totalFish + ' 点（你 +' + fm + ' · 我 +' + ft + '）。'") >= 0 &&
  srcMail.indexOf("'工作值也一起攒了 ' + (wm + wt) + ' 点（你 +' + wm + ' · 我 +' + wt + '）。'") >= 0,
  'S6 摸鱼小结信改 TA 口吻（你和我…你 +x · 我 +y）');
ok(srcMail.indexOf("'你俩一共摸鱼 '") < 0, 'S6b 旧旁白口径「你俩一共摸鱼」清零');
ok(srcGift.indexOf('挑一份心意，跨越两个世界送给 TA') >= 0, 'S7 市集标语＝我挑礼物送给 TA（收礼人是 TA）');
const sent = ['#1006a', '#1006b', '#1006c', '#1006d', '#1006e', '#1006f', '#1006g', '#1006h', '#1006i', '#1006j', '#1006k', '#1006l', '#1006m', '#1006n', '#1006o'];
ok(sent.every((x) => bm.indexOf(x) >= 0), 'S8 build.mjs #1006a~o 十五条哨兵在位', sent.filter((x) => bm.indexOf(x) < 0).join(' '));

// =====================================================================
// A 组：无头行为
// =====================================================================
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const KEY3 = 'xy-home-v2:default:ta-curious';
const STALE = {
  settings: { enabled: true, prob: 5, useDefault: true },
  questions: [
    { id: 'cw6', cat: 'world', text: '你看不见我的时候，希望我待在你附近的哪里？', isPreset: true, enabled: true,
      quick: ['床头', '书桌边', '窗边', '跟着你走'], replies: ['好，那我就守在那', '你回头感觉一下，风动就是我', '嗯，位置记住了', '跟着你走也不累，我很轻'] }
  ],
  mergedIds: ['cw6'],
  history: [{ q: '你看不见我的时候，希望我待在你附近的哪里？', my: '跟着你走', reply: '好，那我就守在那', cat: 'world', ts: 1 }]
};
await cdp('Page.navigate', { url: baseUrl + '/icon-192.png' });
await sleep(500);
await evalJs("(function(){try{localStorage.setItem('xy-home-v2:applock-qaskip','1');localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.setItem('" + KEY3 + "'," + JSON.stringify(JSON.stringify(STALE)) + ");}catch(e){}return true;})()");
await cdp('Page.navigate', { url: baseUrl + '/index.html?x=' + Date.now() });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(600);
// 触发一次好奇卡（走 tcuLoad＝迁移+落盘）
await evalJs('window.triggerTaCuriousNow && window.triggerTaCuriousNow()');
await sleep(900);
const bank = await evalJs("(function(){try{return window.activeStore().get('ta-curious');}catch(e){return 'ERR:'+e.message;}})()");
let d = null;
try { d = JSON.parse(bank); } catch (e) {}
const q = d && (d.questions || []).filter((x) => x && x.id === 'cw6')[0];
ok(!!q && Array.isArray(q.quick) && q.quick[3] === '跟着我走', 'A1 已装用户的固化快答被迁移成「跟着我走」', q ? JSON.stringify(q.quick) : String(bank).slice(0, 80));
const h = d && (d.history || []).filter((x) => x && x.my === '跟着我走')[0];
ok(!!h, 'A2 历史答案里的旧文案一并同步（「跟着你走」→「跟着我走」）');
// 查岗回应池：两个方向各取各的口径
const poolToMe = await evalJs("(function(){try{return JSON.stringify(window.getDeskCheckPool('toMe'));}catch(e){return 'ERR:'+e.message;}})()");
const poolMeToTa = await evalJs("(function(){try{return JSON.stringify(window.getDeskCheckPool('meToTa'));}catch(e){return 'ERR:'+e.message;}})()");
let p1 = [], p2 = [];
try { p1 = JSON.parse(poolToMe) || []; } catch (e) {}
try { p2 = JSON.parse(poolMeToTa) || []; } catch (e) {}
ok(p1.length > 0 && MOVED.every((c) => p1.indexOf(c) < 0), 'A3 「TA 来查我」方向取到的池里没有「被查的我」口吻卡片', '池 ' + p1.length + ' 张，命中 ' + MOVED.filter((c) => p1.indexOf(c) >= 0).length + ' 张');
ok(p1.some((c) => NEW_CARDS.indexOf(c) >= 0), 'A4 该方向取到新补的查岗方卡片');
ok(p2.length > 0 && MOVED.every((c) => p2.indexOf(c) >= 0), 'A5 「我查 TA」方向取到的池含这 11 张被查方口吻卡片', '池 ' + p2.length + ' 张');
const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
let errList = [];
try { errList = JSON.parse(errs) || []; } catch (e) {}
ok(!Array.isArray(errList) || errList.length === 0, 'Z1 全程零 JS 异常', Array.isArray(errList) ? JSON.stringify(errList.slice(0, 2)) : String(errs));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
console.log('\nverify-1006-person-sweep：' + (pass + fail) + ' 断言，' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
