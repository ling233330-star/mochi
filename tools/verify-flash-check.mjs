// ===== 专项验证：闪屏自测（设置→工具 一行，真机出客观数字的只读探针）（v3.26.x #946） =====
// 需求（用户直派「在红米 K80 真机验证闪屏修复」）：#938 的闪屏根因只能在无头环境拿参数代理做 A/B，
//   测不到用户手上那一台，而「还在闪」这种回报无法量化。本探针把同一把尺子放进真机：用户在
//   聊天设置 → 美化 → 边看边调 点 4 下（第 2 下重复点同一档＝值没变那一下），当场出
//   「全站样式翻动几次／同值白写几条／掉帧几帧」＋一句结论。
// 探针三件要害（本脚本逐条把住，缺一即哑）：
//   ① 实例级 setProperty/removeProperty 钩子：documentElement.style 上 mobile-adapt 已装过实例包装，
//      只钩原型抓不到 :root 的写入（实测 0 命中＝「零白写」假绿）；
//   ② 以「用户的点击」分段，不以写入事件分段：修好之后值没变那一下是彻底零写入的，靠写入事件开段
//      就永远不留记录，报告会假称「没采到」＝探针不可用；
//   ③ 整页 MutationObserver 只证「属性真被改过」，同值写入与「值没变」的判别必须靠 ① 的钩子。
// 用例组：
//   S1~S2 接线锚（jsFiles 登记 / 设置页入口行）｜S3~S7 五处探针逻辑锚各自唯一（与 #946a~f 哨兵同源）
//   S8 全局根键 EXCLUDE｜S9 只读性（源码里只写 LAST_KEY 一个键）
//   B0 前置：抽屉真打开｜B1 未开测零开销零包装｜B2 入口行弹说明（文案如实讲只读）｜B3 点开始＝装探针＋浮条
//   B4 探针自证（防哑）：同值重写／必要写／空删变量／空摘 cs-* 类／cs-* 样式表拆建 逐项计得到
//   B5 真点四下＝核心判别面：值没变那一下全站零翻动零白写（--red 还原 #938 修前形态后必然红在这里），
//      且真换档照常写入并生效（防修过头）｜B6 报告弹窗＋浮条回显＋落盘键｜B7 【结束】零残留
//   B8 全程只读：改动的存储键只允许「抽屉档位本身」与 flash-check-last
//   W（#1015 长窗口「边用边测」）：W1 窗口态在位｜W2 无操作翻动判得出（静置 >400ms 的自己动手＝1 次，
//      紧接着操作的翻动不算）｜W3 到点自动出报告并摘净探针｜W4 报告含长窗口段与结论｜W5 长窗口轮不再
//      训「你没点档位」｜W6 只读边界不变｜Z 零 JS 异常
// 用法：
//   node tools/verify-flash-check.mjs            # 当前源码（GREEN）
//   node tools/verify-flash-check.mjs --red      # 把 chat-settings.js 的 setVar/delVar 还原成 #938 修前
//                                                # 的无条件写入形态＝复现「值没变也白写全站样式」，本脚本必红
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const RED = process.argv.includes('--red');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// 红基线副本（纯 HEAD）里没有这个文件：按空串处理，让 S 组锚点断言与浏览器里的 B 组断言照常逐条报红，
// 而不是脚本自己 ENOENT 退出（那等于没跑）。
const readOr = (p) => { try { return readFileSync(p, 'utf8'); } catch (e) { return ''; } };
const srcFc = readOr(join(root, 'src/js/flash-check.js'));
const srcCs = readFileSync(join(root, 'src/js/chat-settings.js'), 'utf8');
const srcGc = readOr(join(root, 'src/js/group-chat.js'));
const srcTpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const srcContacts = readFileSync(join(root, 'src/js/contacts.js'), 'utf8');
let csText = srcCs;
if (RED) {
  // 修前形态：值变不变都照写一遍（#938 根因），一字不改地复现「同值白写」
  const GREEN_SET = "const setVar = (el, name, value) => { if (!el) return; const v = String(value); if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };";
  const GREEN_DEL = "const delVar = (el, name) => { if (el && el.style.getPropertyValue(name) !== '') el.style.removeProperty(name); };";
  if (csText.split(GREEN_SET).length - 1 !== 1 || csText.split(GREEN_DEL).length - 1 !== 1) { console.error('RED：找不到 setVar/delVar 守卫行'); process.exit(1); }
  csText = csText.replace(GREEN_SET, 'const setVar = (el, name, value) => { if (el) el.style.setProperty(name, String(value)); };')
    .replace(GREEN_DEL, 'const delVar = (el, name) => { if (el) el.style.removeProperty(name); };');
}
// #966：--red-gc 把 group-chat.js 的 gcSetVar 还原成「值变不变都照写一遍」（群聊侧 #938 根因形态），
// 用来证明 G2 有判别力——群聊抽屉里重复点同一档必然翻动+白写，G2 必红。
const REDGC = process.argv.includes('--red-gc');
let gcText = srcGc;
if (REDGC) {
  const GREEN_GCSET = "const gcSetVar = (el, name, value) => { if (!el) return; const v = String(value); if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };";
  if (gcText.split(GREEN_GCSET).length - 1 !== 1) { console.error('RED-GC：找不到 gcSetVar 守卫行'); process.exit(1); }
  gcText = gcText.replace(GREEN_GCSET, "const gcSetVar = (el, name, value) => { if (el) el.style.setProperty(name, String(value)); };");
}
// #966：--red-probe 把探针的抽屉/宿主收回到「只认单聊那一套」（红米实报的形态），
// 用来证明 G 组有判别力——群聊抽屉里的点按与写入必然全漏，G1/G2/G4/G5 必红。
const REDPROBE = process.argv.includes('--red-probe');
let fcText = srcFc;
if (REDPROBE) {
  fcText = fcText.replace("var DRAWERS = ['chat-beauty-drawer', 'gc-beauty-drawer'];", "var DRAWERS = ['chat-beauty-drawer'];")
    .replace("var HOSTS = ['page-chat', 'page-group-chat'];", "var HOSTS = ['page-chat'];");
  if (fcText === srcFc) { console.error('RED-PROBE：找不到抽屉/宿主族行'); process.exit(1); }
}
const overrides = { 'chat-settings.js': csText, 'group-chat.js': gcText, 'flash-check.js': fcText };
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  const src = overrides[f] !== undefined ? overrides[f] : readFileSync(join(root, 'src/js', f), 'utf8');
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-flash-check' + (RED ? '-red' : '')).split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-fc-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-fc-prof-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__seed') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end('<!doctype html><title>seed</title>'); return; }
    let p = normalize(join(tmpRoot, rel));
    let hit = false; try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
    await sleep(150);
  }
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
const cnt = (text, s) => text.split(s).length - 1;
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(4000); }

console.log('== S 源码／接线锚 ==');
ok('S1 flash-check.js 已登记进 build.mjs 的 jsFiles（漏＝产物里没这件，真机根本没有这个自测）', jsFiles.indexOf('flash-check.js') >= 0, { pos: jsFiles.indexOf('flash-check.js') });
ok('S2 设置页入口行在 template.html 内唯一（删＝工具里找不到这一行）', cnt(srcTpl, 'id="row-flash-check"') === 1);
const ANCHORS = [
  ['S3 同值白写判定（探针第①要害：实例钩子按值比对）', "if (getVal(s, name) === String(v)) mark('n');"],
  ['S4 空删变量判定', "if (VAR_NS.test(String(n)) && getVal(s, String(n)) === '') mark('dn');"],
  ['S5 空摘 cs-* 类判定', "if (c.indexOf('cs-') === 0 && !this.contains(c)) mark('cn');"],
  ['S6 cs-* 样式表拆建观察', "if (nd.nodeName === 'STYLE' && String(nd.id || '').indexOf('cs-') === 0) mark('ss');"],
  ['S7 以「用户的点击」分段（探针第②要害：删＝值没变那一下不留记录，报告假称没采到）', '_clicks.push({ t: t, in: hit });'],
];
ANCHORS.forEach(([label, needle]) => ok(label + '：在 flash-check.js 内唯一', cnt(srcFc, needle) === 1, { n: cnt(srcFc, needle) }));
ok('S8 报告键已登记 EXCLUDE（漏＝每次刷新被迁进 default 桌面并删根键，报障时那份报告没了）', srcContacts.includes("'flash-check-last'"));
ok('S9 只读性：全模块只写 LAST_KEY 一个键、不删不清存储', srcFc.split('localStorage.setItem(').length - 1 === 1 && srcFc.includes('localStorage.setItem(LAST_KEY,') && !/localStorage\.(removeItem|clear)/.test(srcFc));
// #966：抽屉与宿主都是一族。原 S10 只证「单聊抽屉 id 两侧同名」——群聊那一族漏在哪，探针就静默失效在哪。
ok('S10 抽屉按族识别：单聊/群聊两个「边看边调」都认，且两处 id 与各自源码一致（漂移＝点击永远判成「不在抽屉里」，探针静默失效）',
  cnt(srcFc, "var DRAWERS = ['chat-beauty-drawer', 'gc-beauty-drawer'];") === 1 && srcFc.includes("'chat-beauty-drawer'") && srcFc.includes("'gc-beauty-drawer'")
  && cnt(srcCs, "'chat-beauty-drawer'") >= 1 && cnt(srcGc, "'gc-beauty-drawer'") >= 1,
  { cs: cnt(srcCs, "'chat-beauty-drawer'"), gc: cnt(srcGc, "'gc-beauty-drawer'") });
ok('S11 宿主按族挂钩：:root + 聊天页 + 群聊页（群聊把美化变量写在 #page-group-chat 上，漏＝群聊侧写入没人看）',
  cnt(srcFc, "var HOSTS = ['page-chat', 'page-group-chat'];") === 1 && cnt(srcGc, "getElementById('page-group-chat')") >= 1);
ok('S12 群聊页 style 变更计入翻动（删＝群聊抽屉的整页样式重解析不进报告）',
  cnt(srcFc, "else if (w === 'page-group-chat') list[kk].o.flipGc++;") === 1 && cnt(srcFc, 'o.flipRoot + o.flipChat + o.flipGc') >= 1);
ok('S13 群聊美化同值不重写守卫（删＝点同一个档仍重写 ~16 个变量＝#938 那型闪屏在群聊侧回流）',
  cnt(srcGc, 'const gcSetVar = (el, name, value) =>') === 1 && cnt(srcGc, 'gcSetCls(page, wantTime, true);') === 1
  && cnt(srcGc, "gcSetVar(page, '--msg-in-ink', g('in-ink'));") === 1);

// #1015b：第二轮修掉的四处（翻动当刻判无操作 / 可见性变化重开帧基准 / 长窗口快照冻结 / 活动锚补拖拽滚轮）
ok('S14 无操作翻动在翻动当刻判死（改回结算时用 msSinceAct 反推＝滑一下屏就把早先有操作的翻动算成无操作）', cnt(srcFc, '_flips.push({ t: ft, w: where, idle: msSinceAct(ft) >= WIN_ACT_MS });') === 1);
ok('S15 可见性变化重开帧基准（删＝切后台回来第一帧的间隔是「离开的整段时间」，假掉帧永久占住「最慢的帧」前三）', cnt(srcFc, 'if (_visReset) { _visReset = false; last = t; requestAnimationFrame(tick); return; }') === 1);
ok('S16 长窗口快照冻结（删＝stop() 清空数组后 report() 印「翻动 0 次＋掉帧 N 帧」并下结论「探针没生效」）', cnt(srcFc, 'if (_winMs && !_winSnap) { try { _winSnap = winCompute(); } catch (e) {} }') === 1);
ok('S17 活动锚含拖拽/滚轮（删＝拖滑杆/画布时的样式改写被冤成「自己闪」）', cnt(srcFc, "'pointermove', 'touchmove', 'wheel'") === 1);
await cdpConnect();
await cdp('Runtime.enable');
await navigate('about:blank');
await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
await navigate(baseUrl + '/__seed');
await evalJs(`(function(){ localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  var msgs=[]; for (var i=0;i<120;i++){ msgs.push({ side: i%2? 'out':'in', text: '消息 '+i+' '+'哈'.repeat(4+i%30), ts: 1700000000000+i*60000 }); }
  localStorage.setItem('xy-home-v2:cta:chat-msgs', JSON.stringify(msgs));
  localStorage.setItem('xy-home-v2:group-chat-msgs', JSON.stringify(msgs));
  return true; })()`);
await navigate(baseUrl + '/index.html');
await evalJs(`(function(){ var app=document.querySelector('.app[data-app="chat"]'); if(app) app.click(); return 1; })()`);
await sleep(2500);
await evalJs(`(function(){ var b=document.getElementById('chat-settings-btn'); if(b) b.click(); return 1; })()`);
await sleep(500);
await evalJs(`(function(){ var b=document.getElementById('cs-live-adjust'); if(b) b.click(); return 1; })()`);
await sleep(800);
const bootOk = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  return { drawer: !!(d && getComputedStyle(d).display !== 'none'), msgs: document.querySelectorAll('#chat-body .msg').length }; })()`);
ok('B0 前置：120 条消息渲染 + 边看边调抽屉真的打开', !!(bootOk && bootOk.drawer && bootOk.msgs > 100), bootOk);
const jsBase = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(); })()`) || [];
if (jsBase.length) console.log('  · 启动期已有 JS 异常 ' + jsBase.length + ' 条（非本批面，Z 只查增量）：' + JSON.stringify(jsBase.slice(0, 3)));

// 抽屉锚点常量：所有点击/注入都通过「抽屉里的元素」发生，探针按此归段
const IN_DRAWER = `(function(){ var d=document.getElementById('chat-beauty-drawer');
  var b=document.createElement('button'); b.id='fc-fake'; b.type='button'; d.appendChild(b); return true; })()`;
const SEC = (key) => `(function(){ var d=document.getElementById('chat-beauty-drawer'); var c=d.querySelector('button[data-sec="${key}"]'); if(c){ c.click(); return true; } return false; })()`;
// 「标准」在 气泡字号 与 气泡框大小 两行都有（mkPills 每行一个 span 标签）＝必须按行定位，否则点错行
const PILL = (rowLabel, pillLabel) => `(function(){ var d=document.getElementById('chat-beauty-drawer');
  var wraps=[].slice.call(d.querySelectorAll('div')), pick=null;
  for (var i=0;i<wraps.length;i++){ var w=wraps[i], lb=w.firstElementChild, row=w.lastElementChild;
    if (!lb || lb.tagName !== 'SPAN' || String(lb.textContent).trim() !== ${JSON.stringify(rowLabel)} || !row) continue;
    var bs=[].slice.call(row.querySelectorAll('button'));
    for (var j=0;j<bs.length;j++){ if (String(bs[j].textContent).trim() === ${JSON.stringify(pillLabel)}) pick = bs[j]; }
  }
  if (!pick) return false; pick.click(); return true; })()`;

// 背景噪声基线：装探针之前先空等一段，把「其他模块自己懒建的键」测出来（B8 从判定里剔除，不冤枉本探针）
const kv0 = await evalJs(`(function(){ var a=[]; for (var i=0;i<localStorage.length;i++) a.push(localStorage.key(i)); return a; })()`);
await sleep(3500);
const kv1 = await evalJs(`(function(){ var a=[]; for (var i=0;i<localStorage.length;i++) a.push(localStorage.key(i)); return a; })()`);
const addedControl = (kv1 || []).filter((k) => !(kv0 || []).includes(k));
if (addedControl.length) console.log('  · 背景懒建键（其他模块自写，不算本批面）：' + JSON.stringify(addedControl));

console.log('== B1~B3 入口与开测 ==');
const pre = await evalJs(`(function(){ var s=document.documentElement.style.setProperty;
  return { chip: !!document.getElementById('fc-chip'), row: !!document.getElementById('row-flash-check'),
    running: !!(window.mochiFlashCheck && window.mochiFlashCheck.running()),
    hooked: /mark\\(/.test(String(s)), api: !!window.mochiFlashCheck }; })()`);
ok('B1 未开测＝零开销：浮条不在、探针未装（:root 的 setProperty 仍是原函数）、running()=false', !!pre && pre.chip === false && pre.hooked === false && pre.running === false && pre.api === true && pre.row === true, pre);
await evalJs(`(function(){ var r=document.getElementById('row-flash-check'); if(r) r.click(); return 1; })()`);
await sleep(400);
const mAsk = await evalJs(`(function(){ var m=document.getElementById('modal-mask'), t=document.getElementById('modal-title'),
  okB=document.getElementById('modal-ok'), st=document.getElementById('modal-static');
  return { vis: !!(m && !m.hidden), title: t?t.textContent:'', ok: okB?okB.textContent:'', staticText: (st&&!st.hidden)?st.textContent:'' }; })()`);
ok('B2 点入口行＝弹用法说明（讲清点哪四下、只读不改设置），按钮文案「开始」',
  !!mAsk && mAsk.vis && mAsk.title.indexOf('闪屏自测') === 0 && mAsk.ok === '开始' && mAsk.staticText.indexOf('只读采样') >= 0 && mAsk.staticText.indexOf('不改你的任何设置') >= 0, mAsk);
// #1015：入口多了时长档，默认档是「1 分钟 边用边测」。本节要测的是「点 4 下」那条路，先把胶囊切回去。
const PICK_PILL = (kw) => `(function(){ var pl=document.getElementById('modal-pills'); if(!pl) return false;
  var bs=[].slice.call(pl.children); for (var i=0;i<bs.length;i++){ if (String(bs[i].textContent).indexOf(${JSON.stringify(kw)}) === 0) { bs[i].click(); return true; } } return false; })()`;
const mPillTxt = await evalJs(`(function(){ var pl=document.getElementById('modal-pills'); if(!pl) return '';
  var on=pl.querySelector('.pill.on');
  return [].slice.call(pl.children).length + '/' + (on ? on.textContent : '') + '/' + [].slice.call(pl.children).map(function(c){return c.textContent;}).join('|'); })()`);
ok('B2b 入口胶囊＝两档（点 4 下精确对照 / 1~5 分钟长窗口），默认选中 1 分钟长窗口',
  mPillTxt === '4/1 分钟/点 4 下（精确对照）|1 分钟|3 分钟|5 分钟', mPillTxt);
await evalJs(PICK_PILL('点 4 下'));
await sleep(150);
await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
await sleep(400);
const mStart = await evalJs(`(function(){ var c=document.getElementById('fc-chip');
  var s=document.documentElement.style.setProperty;
  return { running: !!(window.mochiFlashCheck && window.mochiFlashCheck.running()), chip: !!c,
    txt: c ? (c.querySelector('#fc-chip-txt')||{}).textContent : '', view: !!document.getElementById('fc-chip-view'),
    stop: !!document.getElementById('fc-chip-stop'), hooked: /mark\\(/.test(String(s)) }; })()`);
ok('B3 点【开始】＝装探针＋浮条在位（含看结果/结束两钮＋下一步指引文案）',
  !!mStart && mStart.running && mStart.chip && mStart.view && mStart.stop && mStart.hooked && /宽松/.test(mStart.txt || ''), mStart);
ok('B3b 包装生效在实例上（第①要害：mobile-adapt 已在 :root 装过实例包装，只钩原型＝0 命中的假绿）',
  !!(await evalJs(`(function(){ var a=document.documentElement.style, b=document.getElementById('page-chat'); return !!(a && /mark\\(/.test(String(a.setProperty)) && b && b.style && /mark\\(/.test(String(b.style.setProperty))); })()`)));

console.log('== B4 探针自证（防哑）：五类事件逐项计得到 ==');
const b4 = await evalJs(`(async function(){
  ${IN_DRAWER}
  var fake=document.getElementById('fc-fake'); fake.click();
  var root=document.documentElement;
  root.style.setProperty('--msg-fc-probe','1px');          // 必要写（真变了）
  root.style.setProperty('--msg-fc-probe','1px');          // 同值白写
  root.style.removeProperty('--chat-fc-absent');           // 空删变量
  document.body.classList.remove('cs-fc-absent');          // 空摘 cs-* 类
  var st=document.createElement('style'); st.id='cs-fc-probe'; st.textContent='.x{}';
  document.head.appendChild(st); document.head.removeChild(st);   // 样式表拆建 ×2
  root.style.removeProperty('--msg-fc-probe');             // 收尾：还原 root
  await new Promise(function(r){ setTimeout(r, 900); });
  var ops=window.mochiFlashCheck.ops(); var o=ops[ops.length-1];
  var chipOn = window.mochiFlashCheck.running();
  fake.parentNode && fake.parentNode.removeChild(fake);
  return { n: ops.length, chipOn: chipOn, o: o };
})()`);
const o4 = b4 && b4.o ? b4.o : {};
ok('B4 一次抽屉点击里的五类事件全部计得到（必要写 1／同值白写 1／空删 1／空摘类 1／拆建 2）',
  !!b4 && b4.chipOn && b4.n >= 1 && o4.writes === 1 && o4.noop === 1 && o4.delNoop === 1 && o4.clsNoop === 1 && o4.swap === 2, b4);
ok('B4b 属性变更传感器在跑（真改 :root 至少落 1 记翻动，且必要写带得出变量名）',
  (o4.flipRoot || 0) >= 1 && String(o4.changed || '').indexOf('--msg-fc-probe') >= 0, { flipRoot: o4.flipRoot, changed: o4.changed });
const b4clean = await evalJs(`(function(){ var r=document.documentElement;
  return { probe: r.style.getPropertyValue('--msg-fc-probe'), st: !!document.getElementById('cs-fc-probe'), fake: !!document.getElementById('fc-fake') }; })()`);
ok('B4c 注入的探针变量与临时件已清干净（诊断件自己不许在页面上留东西）',
  !!b4clean && b4clean.probe === '' && b4clean.st === false && b4clean.fake === false, b4clean);

console.log('== B5 真点四下＝核心判别面 ==');
// 先固定在「气泡」分区（切分区那一下也算抽屉点击），再重开一轮＝本轮窗口里只有那四下档位点击
await evalJs(SEC('bubble'));
await sleep(400);
await evalJs(`(function(){ window.mochiFlashCheck.stop(); window.mochiFlashCheck.start(); return 1; })()`);
await sleep(300);
const SNAP0 = await evalJs(`(function(){ var a=[]; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); a.push(k+'='+localStorage.getItem(k)); } return a; })()`);
const clickSeq = ['宽松', '宽松', '紧凑', '标准'];
const seqRes = [];
for (const lb of clickSeq) {
  const r = await evalJs(PILL('气泡框大小', lb));
  seqRes.push({ lb: lb, clicked: r });
  await sleep(650);
}
const padAfter = await evalJs(`document.documentElement.style.getPropertyValue('--chat-bubble-pad')`);
const nOpsPre = await evalJs(`(function(){ var ops=window.mochiFlashCheck.ops(); return ops.length; })()`);
const rep = await evalJs(`(function(){ var r=window.mochiFlashCheck.report(); return { text:r.text, n:r.ops.length, noop:r.noopOps, waste:r.wasteAll, flip:r.flipAll, jank:r.jankAll, worst:r.worstGap, ops:r.ops }; })()`);
ok('B5 四下全部点到、报告里恰好四段（一次点击一段，值没变那一下也留了记录＝探针第②要害）',
  seqRes.every(function (x) { return x.clicked === true; }) && !!rep && rep.n === 4 && nOpsPre === 4, { seqRes, n: rep && rep.n, nOpsPre });
const o5 = rep && rep.ops ? rep.ops : [];
const noopList = o5.filter(function (o) { return !o.writes; });
ok('B5b 第 2 下（重复点同一档）被判为「值没变」，且只有它进结论（真换档的必要写不算缺陷＝防修过头）',
  noopList.length === 1 && o5[1] && !o5[1].writes && o5[0].writes > 0 && o5[2].writes > 0, { counts: o5.map(function (o) { return o.writes; }) });
ok('B5c 值没变那一下：全站样式翻动 0 次、同值白写 0 条（红米实报的闪屏根因面；--red 还原修前形态必红在此）',
  !!rep && noopList.length === 1 && noopList[0].flipRoot === 0 && noopList[0].flipChat === 0 && noopList[0].noop === 0 && noopList[0].delNoop === 0 && noopList[0].clsNoop === 0 && noopList[0].swap === 0,
  noopList[0]);
ok('B5d 结论行如实：无缺陷＝「未见闪屏来源」；白写回来（--red）＝「根因仍在」，两种都不是空口',
  !!rep && (RED ? /根因仍在/.test(rep.text) : /未见闪屏来源/.test(rep.text)), { text: rep ? rep.text.slice(-160) : null });
ok('B5e 真换档照常生效（末档「标准」＝11px 14px 落位，守卫没把功能闸死）', padAfter === '11px 14px', { padAfter });
ok('B5f 每一段都带帧指标（rAF 在跑：帧数>0 且最慢帧已量出）', o5.length === 4 && o5.every(function (o) { return o.frames > 0 && o.maxGap >= 0; }), o5.map(function (o) { return o.frames + '/' + o.maxGap; }));

console.log('== B6~B8 报告 / 残留 / 只读 ==');
await evalJs(`(function(){ window.mochiFlashCheck.showReport(); return 1; })()`);
await sleep(500);
const mRep = await evalJs(`(function(){ var m=document.getElementById('modal-mask'), t=document.getElementById('modal-title'),
  tx=document.getElementById('modal-textarea'), cp=document.getElementById('modal-copy'), okB=document.getElementById('modal-ok');
  var c=document.getElementById('fc-chip');
  return { vis: !!(m && !m.hidden), title: t?t.textContent:'', text: tx?tx.value:'', copy: !!(cp && !cp.hidden),
    ok: okB?okB.textContent:'', chipTxt: c?(c.querySelector('#fc-chip-txt')||{}).textContent:'' }; })()`);
ok('B6 【看结果】＝弹结果框（多行只读报告＋复制钮＋「知道了」），标题与内容齐', !!mRep && mRep.vis && mRep.title === '闪屏自测结果' && mRep.copy && mRep.ok === '知道了' && mRep.text.indexOf('操作 1') >= 0 && mRep.text.indexOf('值没变') >= 0, { title: mRep && mRep.title });
ok('B6b 浮条回显值没变那一下的三个数（用户不点开弹窗也看得见结论）', !!mRep && /值没变那一下：翻动 \d+／白写 \d+／掉帧 \d+/.test(mRep.chipTxt || ''), mRep && mRep.chipTxt);
const saved = await evalJs(`(function(){ var s=localStorage.getItem('xy-home-v2:flash-check-last'); if(!s) return null; try { var o=JSON.parse(s); return { keys: Object.keys(o).sort().join(','), flip: o.flipAll, waste: o.wasteAll }; } catch(e){ return {bad:1}; } })()`);
ok('B6c 报告落盘（ts/ver/text/三计数），数值与弹窗里的报告一致（供报障回看）', !!saved && saved.keys === 'flipAll,jankAll,text,ts,ver,wasteAll' && saved.flip === (rep ? rep.flip : null) && saved.waste === (rep ? rep.waste : null), saved);
await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
const after = await evalJs(`(function(){ window.mochiFlashCheck.stop();
  var s=document.documentElement.style, chat=document.getElementById('page-chat');
  var rm=DOMTokenList.prototype.remove;
  return { chip: !!document.getElementById('fc-chip'), running: window.mochiFlashCheck.running(),
    rootHooked: /mark\\(/.test(String(s.setProperty)), rootDelHooked: /mark\\(/.test(String(s.removeProperty)),
    chatHooked: !!(chat && /mark\\(/.test(String(chat.style.setProperty))),
    clsHooked: /mark\\(/.test(String(rm)) }; })()`);
ok('B7 【结束】＝浮条摘除、探针全部还原（实例钩子与 DOMTokenList.remove 都回到原函数、running()=false）',
  !!after && after.chip === false && after.running === false && after.rootHooked === false && after.rootDelHooked === false && after.chatHooked === false && after.clsHooked === false, after);
const rep2 = await evalJs(`(function(){ var r=window.mochiFlashCheck.report(); return { n: r.ops.length, text: r.text.slice(0,40) }; })()`);
ok('B7b 结束后再取报告＝干净空集（不留上一次残影），且再点胶囊零异常', !!rep2 && rep2.n === 0 && !!(await evalJs(PILL('气泡框大小', '标准'))), rep2);
const SNAP1 = await evalJs(`(function(){ var a=[]; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); a.push(k+'='+localStorage.getItem(k)); } return a; })()`);
const kv = (arr) => new Map((arr || []).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
const m0 = kv(SNAP0), m1 = kv(SNAP1);
const added = [...m1.keys()].filter((k) => !m0.has(k) && !addedControl.includes(k));
const removed = [...m0.keys()].filter((k) => !m1.has(k) && !addedControl.includes(k));
ok('B8 新增的存储键只允许「抽屉档位本身 + flash-check-last」（探针不改业务数据；背景懒建键已由前置基线剔除）',
  added.every((k) => /(^|:)cs-/.test(k) || k === 'xy-home-v2:flash-check-last') && added.includes('xy-home-v2:flash-check-last'), { added, addedControl });
const bizSame = ['xy-home-v2:cta:chat-msgs', 'xy-home-v2:contacts', 'xy-home-v2:active-contact']
  .filter((k) => m0.get(k) !== m1.get(k));
ok('B8b 没有任何存储键被删或清空（只读自测最硬的一条边界）', removed.length === 0, { removed });
ok('B8c 业务数据逐字未动：聊天记录 / 联系人表 / 当前桌面 三个键全程零变化', bizSame.length === 0, { bizSame });
console.log('== G 群聊「边看边调」抽屉（#966 红米 K80 实报「没有采到抽屉里的点击」）==');
// 探针原先只认单聊抽屉 #chat-beauty-drawer，且只挂 :root/#page-chat——群聊那一族（#gc-beauty-drawer，
// 变量写在 #page-group-chat 上）的点按与写入全漏，报告静默变成「没采到」。G 组就是把这条腿走一遍。
const G_PILL = (rowLabel, pillLabel) => `(function(){ var d=document.getElementById('gc-beauty-drawer');
  var wraps=[].slice.call(d.querySelectorAll('div')), pick=null;
  for (var i=0;i<wraps.length;i++){ var w=wraps[i], lb=w.firstElementChild, row=w.lastElementChild;
    if (!lb || lb.tagName !== 'SPAN' || String(lb.textContent).trim() !== ${JSON.stringify(rowLabel)} || !row) continue;
    var bs=[].slice.call(row.querySelectorAll('button'));
    for (var j=0;j<bs.length;j++){ if (String(bs[j].textContent).trim() === ${JSON.stringify(pillLabel)}) pick = bs[j]; }
  }
  if (!pick) return false; pick.click(); return true; })()`;
await evalJs(`(function(){ var a=document.querySelector('.app[data-app="group-chat"]'); if(a) a.click(); return 1; })()`);
await sleep(1800);
await evalJs(`(function(){ var b=document.getElementById('gc-more-btn'); if(b) b.click(); return 1; })()`);
await sleep(300);
await evalJs(`(function(){ var b=document.getElementById('gc-more-settings'); if(b) b.click(); return 1; })()`);
await sleep(500);
await evalJs(`(function(){ var t=document.querySelector('#gc-settings-panel [data-gt="beauty"]'); if(t) t.click(); return 1; })()`);
await sleep(500);
await evalJs(`(function(){ var b=document.getElementById('gc-live-adjust'); if(b) b.click(); return 1; })()`);
await sleep(700);
const gOpen = await evalJs(`(function(){ var d=document.getElementById('gc-beauty-drawer');
  return { drawer: !!(d && getComputedStyle(d).display !== 'none'), pills: d ? d.querySelectorAll('button').length : 0 }; })()`);
ok('G0 前置：群聊美化抽屉真的打开（群聊设置 → 美化 → 边看边调）', !!(gOpen && gOpen.drawer && gOpen.pills > 5), gOpen);
await evalJs(`(function(){ var r=document.getElementById('row-flash-check'); if(r) r.click(); return 1; })()`);
await sleep(300);
await evalJs(PICK_PILL('点 4 下'));
await sleep(150);
await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
await sleep(400);
// 固定到「气泡」分区（切分区那一下也算抽屉点击），再重开一轮＝窗口里只有那四下档位点击
await evalJs(`(function(){ var d=document.getElementById('gc-beauty-drawer'); var c=d.querySelector('button[data-sec="bubble"]'); if(c) c.click(); return 1; })()`);
await sleep(400);
await evalJs(`(function(){ window.mochiFlashCheck.stop(); window.mochiFlashCheck.start(); return 1; })()`);
await sleep(300);
const gSeq = [];
for (const lb of ['宽松', '宽松', '紧凑', '标准']) {
  gSeq.push({ lb: lb, clicked: await evalJs(G_PILL('气泡框大小', lb)) });
  await sleep(650);
}
const padGc = await evalJs(`(function(){ var p=document.getElementById('page-group-chat'); return p ? p.style.getPropertyValue('--chat-bubble-pad') : null; })()`);
const grep2 = await evalJs(`(function(){ var r=window.mochiFlashCheck.report(); return { text:r.text, n:r.ops.length, ops:r.ops, flip:r.flipAll, waste:r.wasteAll }; })()`);
const go = grep2 && grep2.ops ? grep2.ops : [];
ok('G1 群聊抽屉里的四下全部采到、报告恰四段且逐段标「群聊」（删＝群聊点按全漏，报告假称「没采到」＝红米实报症状）',
  gSeq.every(function (x) { return x.clicked === true; }) && !!grep2 && grep2.n === 4 && go.every(function (o) { return o.drawer === '群聊'; }),
  { seq: gSeq, n: grep2 && grep2.n, drawers: go.map(function (o) { return o.drawer; }) });
ok('G2 群聊里「值没变」那一下同样是零翻动零白写（群聊 applyGcBeauty 原无条件重写 ~16 个变量＋白摘 5 个类＝#938 那型闪屏；本批补守卫）',
  go.length === 4 && !go[1].writes && go[1].flipRoot === 0 && go[1].flipChat === 0 && go[1].flipGc === 0 && go[1].noop === 0 && go[1].delNoop === 0 && go[1].clsNoop === 0 && go[1].swap === 0 && go[0].writes > 0,
  go[1]);
ok('G3 群聊里真换档照常生效（末档「标准」＝--chat-bubble-pad 11px 14px 落位，守卫没把群聊功能闸死）', padGc === '11px 14px', { padGc });
ok('G4 群聊这一轮结论行如实（不再落进「没采到」）', !!grep2 && /未见闪屏来源/.test(grep2.text), { tail: grep2 ? grep2.text.slice(-140) : null });
// G5：「点了但不在抽屉里」要能和「压根没点」区分开（#966 拆句）——点群聊消息区（抽屉外）验证
await evalJs(`(function(){ window.mochiFlashCheck.stop(); window.mochiFlashCheck.start(); return 1; })()`);
await sleep(300);
await evalJs(`(function(){ var b=document.getElementById('gc-body'); if(b) b.click(); return 1; })()`);
await sleep(400);
const gDiag = await evalJs(`(function(){ return window.mochiFlashCheck.report().text; })()`);
ok('G5 点错地方时如实说是「点了但不在抽屉里」（删＝两种情形同一句话，用户与开发者都无从下手）',
  /没有采到「抽屉里」的点击：这段时间共采到 \d+ 次屏幕点击/.test(gDiag || ''), { head: (gDiag || '').slice(0, 200) });
await evalJs(`(function(){ window.mochiFlashCheck.stop(); return 1; })()`);

console.log('== W 长窗口「边用边测」（#1015）==');
// 4 秒窗口（产品档位是 1/3/5 分钟，这里按 ms 直调同一函数，窗口机制与档位无关）
const wStart = await evalJs(`(function(){ window.mochiFlashCheck.start(4000);
  var s = window.mochiFlashCheck.winStats();
  return { on: window.mochiFlashCheck.running(), win: !!s, ms: s ? s.ms : 0,
    chip: (document.getElementById('fc-chip-txt')||{}).textContent || '' }; })()`);
ok('W1 长窗口起测＝探针在位、窗口态成立（ms=4000），逐秒浮条已切到「边用边测」口径',
  !!wStart && wStart.on === true && wStart.win === true && wStart.ms === 4000 && /边用边测中/.test(wStart.chip || ''), wStart);
// 判据自证：①静置 >400ms 之后自己动手改 :root ＝「无操作翻动」；②紧接着用户操作的翻动不算
const wInject = await evalJs(`(async function(){
  await new Promise(function(r){ setTimeout(r, 900); });
  var root = document.documentElement;
  root.style.setProperty('--msg-fc-idle', '1px');                   // 无操作翻动（前面 900ms 里没人动手）
  await new Promise(function(r){ setTimeout(r, 150); });
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));  // 用户动手
  root.style.setProperty('--msg-fc-act', '1px');                    // 紧接着的翻动＝有操作凭据，不算
  return true; })()`);
const wMid = await evalJs(`(function(){ var s = window.mochiFlashCheck.winStats();
  return s ? { flips: s.flips, idle: s.idle, waste: s.waste } : null; })()`);
ok('W2 无操作翻动判得出：静置期自己动手那一下计 1 次，紧接着操作的翻动不计（删判据＝最可疑的闪源失去口径）',
  !!wInject && !!wMid && wMid.idle === 1 && wMid.flips >= 2, wMid);
await sleep(3600);   // 等窗口自然到点（到点应自动出报告并摘净探针）
const wEnd = await evalJs(`(function(){ var m=document.getElementById('modal-mask'), t=document.getElementById('modal-title'),
  tx=document.getElementById('modal-textarea');
  return { vis: !!(m && !m.hidden), title: t?t.textContent:'', text: tx?tx.value:'',
    running: window.mochiFlashCheck.running(), chip: !!document.getElementById('fc-chip') }; })()`);
ok('W3 到点自动出报告并摘净探针（删＝时间到了不出报告，用户不知道还得去点浮条）',
  !!wEnd && wEnd.vis === true && wEnd.title === '闪屏自测结果' && wEnd.running === false && wEnd.chip === false, { t: wEnd && wEnd.title, run: wEnd && wEnd.running });
const wTxt = (wEnd && wEnd.text) || '';
ok('W4 报告含长窗口段（翻动/白写/掉帧 + 无操作翻动时刻 + 长窗口结论）',
  /—— 长窗口观测（4 秒）——/.test(wTxt) && /无操作翻动 1 次/.test(wTxt) && /第 \d+ 秒 · /.test(wTxt) && /结论（长窗口）：抓到 1 次/.test(wTxt), { text: wTxt });
ok('W5 长窗口轮不再训「你没点档位」（删＝用户在长窗口轮被报「没有采到任何屏幕点击」，等于白测）',
  wTxt.indexOf('没有采到任何屏幕点击') < 0 && wTxt.indexOf('没有采到「抽屉里」的点击') < 0);
const wKv = await evalJs(`(function(){ var a=[]; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if (k.indexOf('flash-check') >= 0) a.push(k); } return a; })()`);
ok('W6 长窗口报告照旧只落 flash-check-last 一个键（只读边界不变）',
  Array.isArray(wKv) && wKv.length === 1 && wKv[0] === 'xy-home-v2:flash-check-last', wKv);

console.log('== W2 #1015b 第二轮修复的判别面 ==');
// W7 无操作翻动必须在翻动当刻判死：先有操作、再滑一大堆（把 _acts 挤爆），该翻动仍不得算无操作
const w7pre = await evalJs(`(function(){ window.mochiFlashCheck.start(8000); return 1; })()`);
await sleep(500);
const w7 = await evalJs(`(async function(){
  await new Promise(function(r){ setTimeout(r, 500); });
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));   // 真·用户操作
  await new Promise(function(r){ setTimeout(r, 50); });
  document.documentElement.style.setProperty('--msg-fc-w7', '1px');                  // 紧接着的翻动＝有操作凭据
  await new Promise(function(r){ setTimeout(r, 600); });
  for (var i = 0; i < 800; i++) {                                                    // 模拟长按滑动：把活动记录挤爆
    document.dispatchEvent(new Event('scroll', { bubbles: false }));
  }
  var s = window.mochiFlashCheck.winStats();
  return s ? { flips: s.flips, idle: s.idle } : null;
})()`);
ok('W7 滑屏把活动记录挤爆后，早先「有操作」的翻动仍不得被算成无操作翻动（旧版 msSinceAct 找不到更早的活动就返回 Infinity＝凭空给应用加闪屏嫌疑）',
  !!w7 && w7.flips >= 1 && w7.idle === 0, w7);
await sleep(1200);
await evalJs(`(function(){ window.mochiFlashCheck.stop(); document.documentElement.style.removeProperty('--msg-fc-w7'); return 1; })()`);

// W9 【结束】之后取报告：长窗口段的数字必须还在（旧版 stop() 清了 _flips/_ev 却留着窗口态＝印出「翻动 0 次＋掉帧 N 帧」并下结论「探针没生效」）
const w9 = await evalJs(`(async function(){
  window.mochiFlashCheck.start(6000);
  await new Promise(function(r){ setTimeout(r, 700); });
  document.documentElement.style.setProperty('--msg-fc-w9', '1px');
  await new Promise(function(r){ setTimeout(r, 400); });
  window.mochiFlashCheck.stop();
  var r = window.mochiFlashCheck.report();
  document.documentElement.style.removeProperty('--msg-fc-w9');
  return { flips: r.win ? r.win.flips : -1, text: r.text };
})()`);
ok('W9【结束】之后 report() 仍拿得到长窗口数字（删快照＝数组已清空但窗口还在，报告自相矛盾：翻动 0 次＋掉帧 N 帧＋「探针没生效」）',
  !!w9 && w9.flips >= 1 && w9.text.indexOf('探针没生效') < 0, { flips: w9 && w9.flips });

// W10 长窗口轮不逐条印「操作 N」（帧数组 6000 截断会让早期点击印出「帧 0 个｜最慢帧 0ms」＝读起来像没掉帧）
const w10 = await evalJs(`(async function(){
  window.mochiFlashCheck.start(4000);
  await new Promise(function(r){ setTimeout(r, 400); });
  var d = document.getElementById('chat-beauty-drawer');
  if (d) { var c = d.querySelector('button[data-sec="bubble"]'); if (c) c.click(); }
  await new Promise(function(r){ setTimeout(r, 600); });
  var r = window.mochiFlashCheck.report();
  return { text: r.text, n: r.ops.length };
})()`);
ok('W10 长窗口轮的报告里没有「操作 N」逐条行（长窗口里点档位只是正常使用，且帧数组截断会让旧点击印出假数字）',
  !!w10 && w10.text.indexOf('操作 1') < 0 && w10.text.indexOf('—— 长窗口观测（4 秒）——') >= 0, { n: w10 && w10.n });

// W11 点【结束】＝直接出报告（长窗口轮复现完就会点它；旧版只摘浮条、一个数字都不给）
const w11 = await evalJs(`(async function(){
  window.mochiFlashCheck.start(30000);
  await new Promise(function(r){ setTimeout(r, 600); });
  var b = document.getElementById('fc-chip-stop');
  if (b) b.click();
  await new Promise(function(r){ setTimeout(r, 500); });
  var m = document.getElementById('modal-mask'), t = document.getElementById('modal-title');
  return { vis: !!(m && !m.hidden), title: t ? t.textContent : '', running: window.mochiFlashCheck.running() };
})()`);
ok('W11 长窗口轮点【结束】＝当场弹结果（旧版只把浮条摘掉，要看结果得先知道还有【看结果】这一手）',
  !!w11 && w11.vis === true && w11.title === '闪屏自测结果' && w11.running === false, w11);
await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
await sleep(200);

// W12 「0 次无操作翻动」要带边界说明（本页自己触发的滚动也算有操作，不能说成绝对没自闪）
const w12 = await evalJs(`(async function(){
  window.mochiFlashCheck.start(4000);
  await new Promise(function(r){ setTimeout(r, 4200); });
  var r = window.mochiFlashCheck.report();
  return { text: r.text, idle: r.win ? r.win.idle : -1 };
})()`);
ok('W12 无操作翻动 0 次时补一句边界（网页自己触发的滚动也算有操作），不把「0 次」说成绝对没有自闪',
  !!w12 && w12.idle === 0 && w12.text.indexOf('本网页自己触发的滚动') >= 0, { idle: w12 && w12.idle });
await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
await sleep(200);

await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
await sleep(200);
const zAll = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(); })()`) || [];
const z1 = zAll.slice(jsBase.length);
ok('Z 自测全程零 JS 异常', Array.isArray(z1) && z1.length === 0, z1);

console.log('\n' + (RED ? '[RED 基线] ' : '') + '通过 ' + pass + ' / 失败 ' + fail + (fails.length ? '：' + fails.join('；') : ''));
try { chrome.kill(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
