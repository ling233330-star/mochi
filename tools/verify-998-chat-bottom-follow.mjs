// ===== 常驻回归脚本 #998：联系人发消息「最新消息不跟到最底部，要自己滑到底」 =====
// 用法：node build.mjs && node tools/verify-998-chat-bottom-follow.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-998-chat-bottom-follow.mjs   （红绿对照）
// 报障（红米 K80 Chrome，用户原话「为什么联系人发送消息，最新消息总是会没有跟随自动滑动到最底部，
//   需要我自己滑动到最底下」，并点名其他机型同现、要求勿致跨机型回归）：
//   钉住态（chatPinnedBottom）一丢就**永久**不回来 ⇒ 此后每条来消息都不跟底，视口停在原地、
//   新气泡整条落在消息区视口下方（无头实测：最新一条底边在消息区下方 +38.7px，连发 gap 累积 133.7px）。
//   三条根因（全部纯几何/时序判据，零机型/内核分支）：
//   ①「贴底」读方与写方不同尺——写方 scrollChatBottom 落点用 chatScrollMax()（扣掉「对方正在输入」
//     行高 T≈22px），读方 chatAtBottom 用裸 scrollHeight−clientHeight；打字行在每条来消息落地前
//     显示 0.4~1.4s（正是用户会去点/滑的那段窗口），行显示期真贴底被读成「离底 T px > 8」＝假解钉态，
//     轻点回钉与滚动落定回钉两条恢复路一起失效。
//   ②恢复路是一次性判据：滚动落定那条是「滚动事件 + 100ms 防抖」，手势期一撞 chatTouchActive 即放弃
//     且不续期；轻点那条只认 dy<10 ——「上滑翻两下→滑回最底→按住停一下再抬手」这种最常见收尾形态
//     抬手位移远大于 10px，两路一起错过 ⇒ 钉住态丢一次就永久不回来。修法＝看门狗 250ms 周期复核
//     「滚动/触摸/几何全静默 ＋ 用户此刻真贴在底部 ⇒ 恢复自动跟底」（写入交 #861/#933 落定锁）。
//     **不**在 touchend 就地回钉：抬手那一瞬惯性还没开始走（从底部往上甩时读数仍贴底），那时置钉会被
//     看门狗把用户的惯性滑行整段拽回底部＝#416/#716「往上滑被拽回最底」复发（本脚本 S3 守这条）。
//   ③来消息跟底只认可过期的钉住标记：标记被一次触摸解钉后一旦恢复路被时序错过就永久失真，而
//     「用户此刻停在最新一条上」是几何事实——两者取或（scrollChatBottom 顺带把标记复位＝自愈）。
// 断言组：
//   S 产物锚（三条新逻辑 + 两条「旧裸口径/旧闸不得回流」+ 一条「touchend 不得就地回钉」）
//   R 根因判据自检（打字行显示期真贴底时，旧裸口径必须读出「离底 >8」＝缺陷面仍在，改口径时重审）
//   A 真实链路（无头 390×844，产品真钩子 chatAddInTyped 驱动）：
//     A1 前置（可滚动 + 贴底钉住）；A2 打字行显示期轻点→该条落地跟底；A3 上滑回底按住抬手→落地跟底；
//     A4 失底不粘住（A3 之后连来两条都跟底）；
//     A5/A6/A7 防修过头（上翻阅读中轻点 / 上翻中来消息 / 手势进行中来消息 一律不得被拽回底）；
//     A8 回钉写走落定锁（回钉后滚动树对新几何重对齐：连续采样无 >25px 倒退、末态贴底）。
//   C 真实链路·卡片（用户 2026-09-21 追加报障「联系人发送卡片还是会这样——是送的礼物卡」；卡片与文本
//     共用同一条跟底闸，C 轴把这条面钉住：卡片 class 不含 'msg' token，量测必须按子元素口径）：
//     C1 礼物卡落地（产品链路 maybeAutoGift，含【领取】动作区）即贴底；C2 打字行期轻点→礼物卡仍贴底；
//     C3 上滑回底抬手→礼物卡仍贴底；C4 带图礼物卡（dataURL）即贴底；C5 卡片落地后长高（TA 收礼回话
//     贴卡 / 点【领取】）仍被补平到贴底；C6 卡片泄漏探测（8 个卡片场景 × 60ms 采样，零「在底部却
//     来件不跟底」的泄漏帧）。
//   Z1 全程零 JS 异常。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(resolve(process.env.MOCHI_ROOT)) : (process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- S 组：产物锚（#860 后 chat.js 外置，两处都读） ----------
let prod = '';
try { prod = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
try { prod += readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
check('S1 贴底判定与写方同尺（chatAtBottom ＝ chatScrollMax() − scrollTop ≤8）',
  prod.includes('return chatScrollMax() - cb.scrollTop <= 8;'));
check('S2 来消息跟底闸含几何事实（钉住标记 OR 视口此刻就在真底部）',
  prod.includes('!chatPinnedBottom && !chatAtBottom()) return;'));
check('S3 touchend 仍只认 dy<10 的轻点回钉（不得改成「抬手瞬间贴底就置钉」：抬手时惯性还没开始走，置钉会让看门狗把惯性滑行整段拽回底＝#416/#716 复发）',
  prod.includes('if (dy < 10 && chatAtBottom()) scrollChatBottom();'));
check('S4 看门狗解钉态周期复核（用户自己滚回真底部即恢复自动跟底）',
  prod.includes("chatPinnedBottom = true; cb706.classList.remove('scroll-anchor-auto'); chatScrollRealignQuiet();"));
check('S5 解钉态复核的贴底前置不得丢（丢＝无条件回钉，上翻阅读被周期拽底）',
  prod.includes('if (!chatAtBottom()) return;'));
check('S6 旧裸口径不得回流（裸 scrollHeight−clientHeight 当贴底尺子＝打字行期假解钉态复发）',
  !prod.includes('return cb.scrollHeight - cb.scrollTop - cb.clientHeight <= 8;'));
check('S7 旧跟底闸不得回流（只认钉住标记＝标记一失真就永久不跟底）',
  !prod.includes('if (!out && !userFollow && !chatPinnedBottom) return;'));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-986-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') jsErrors.push(((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 关掉自动回复的随机排程，避免与脚本自驱的来消息互相干扰（产品真链路钩子照常可用）
await ev("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(600);
for (let i = 1; i <= 40; i++) {
  await ev(`window.chatSendMsg('撑高消息 ${i}，这是一条用来撑出滚动高度的测试消息内容，稍微长一点。');`);
}
await sleep(1400);

if (typeof await ev('typeof window.chatAddInTyped') !== 'string' || (await ev('typeof window.chatAddInTyped')) !== 'function') {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  console.log('\n产物未含 chatAddInTyped 真链路钩子——请先 node build.mjs');
  process.exit(1);
}

// 采样口径：gap ＝ chatScrollMax() − scrollTop（与产品写方同尺）；over ＝ 最新一条气泡底边 − 消息区底边
// （over > 1 ＝「最新一条整条落在视口下方，用户必须自己滑到底」）＝用户报障的直接形态
const STATE = `(function(){
  var b=document.getElementById('chat-body'), t=document.getElementById('chat-typing');
  var rowH=(t&&!t.hidden)?t.offsetHeight:0;
  var max=b.scrollHeight-(b.clientHeight+rowH);
  // FIX 2026-09-21 #998 C 轴：卡片节点（msg-gift/msg-ask/msg-flower…）的 class **不含** 'msg' token，
  // 旧「找最后一个 .msg」选择器会跳过卡片、量到更早的那条文本气泡上（实测漏判整条卡片面）
  var lm=b.children.length?b.children[b.children.length-1]:null;
  var br=b.getBoundingClientRect();
  return JSON.stringify({
    anchor:b.classList.contains('scroll-anchor-auto'),
    top:Math.round(b.scrollTop*10)/10,
    max:Math.round(max*10)/10,
    gap:Math.round((max-b.scrollTop)*10)/10,
    rawGap:Math.round((b.scrollHeight-b.scrollTop-b.clientHeight)*10)/10,
    typing:!!(t&&!t.hidden),
    over:lm?Math.round((lm.getBoundingClientRect().bottom-br.bottom)*10)/10:null,
    n:b.children.length, cls:lm?(lm.className||''):''
  });
})()`;
const state = async () => JSON.parse((await ev(STATE)) || '{}');

async function reset() {
  await ev('(function(){window.enterChat&&window.enterChat();return true;})()'); // #742 进页复位钉住
  await sleep(700);
  // 归位前先收掉打字行：行显示态的「可滚最大」虚高一行高（#516），此时写 scrollTop=scrollHeight
  // 会落在行显示态最大值上＝归位本身就带上 21px 偏差（本脚本 A1 实测踩过）
  await ev("(function(){var t=document.getElementById('chat-typing');if(t)t.hidden=true;return true;})()");
  await ev('(function(){var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
  await sleep(500);
}
const TOUCH = (phase, y) => `(function(){
  var b=document.getElementById('chat-body');
  var mk=function(t){return new Touch({identifier:1,target:b,clientX:200,clientY:t,pageX:200,pageY:t});};
  var e=new TouchEvent('${phase}',{touches:${phase === 'touchend' ? '[]' : '[mk(' + y + ')]'},targetTouches:${phase === 'touchend' ? '[]' : '[mk(' + y + ')]'},changedTouches:[mk(${y})],bubbles:true,cancelable:true});
  b.dispatchEvent(e);
  return true;
})()`;
const tap = async () => { await ev(TOUCH('touchstart', 400)); await sleep(60); await ev(TOUCH('touchend', 400)); };
const scrollBy = (delta) => ev(`(function(){var b=document.getElementById('chat-body');b.scrollTop=Math.max(0,b.scrollTop+(${delta}));b.dispatchEvent(new Event('scroll'));return true;})()`);
// 「上滑翻两下 → 再滑回最底 → 按住 holdMs」＝停在「手指还没抬」那一瞬（真机最常见收尾形态的前半段）
async function dragBegin(endY, holdMs) {
  await ev(TOUCH('touchstart', 500));
  await sleep(60);
  await scrollBy(-120); await sleep(70);
  await scrollBy(0); await sleep(70);
  await scrollBy(120); await sleep(70);
  await sleep(holdMs);
}
const dragEnd = (endY) => ev(TOUCH('touchend', endY));
async function dragBackToBottom(dy, holdMs) { await dragBegin(500 + dy, holdMs); await dragEnd(500 + dy); }
// 真机「上滑看历史」：触摸解钉（#162 只认触摸/滚轮，纯程序化 scrollTop 不解钉）+ 上滑 px px 后抬手
async function dragUp(px) {
  await ev(TOUCH('touchstart', 500));
  await sleep(60);
  await scrollBy(-px);
  await sleep(80);
  await dragEnd(500 - px);
  await sleep(350);
}
const inMsg = (text, firstDelay) => ev(`window.chatAddInTyped(['${text}'], {}, ${firstDelay});`);
async function waitMsg(prevN, timeoutMs) {
  for (let i = 0; i < Math.ceil(timeoutMs / 150); i++) {
    const s = await state();
    if (typeof s.n === 'number' && s.n > prevN) return s;
    await sleep(150);
  }
  return await state();
}

// ---------- A1 前置 ----------
await reset();
const base = await state();
check('A1 前置：聊天区已撑出滚动高度且停在贴底钉住态',
  base.max > 200 && Math.abs(base.gap) <= 2 && base.anchor === false,
  'max=' + base.max + ' gap=' + base.gap + ' anchor=' + base.anchor);

// ---------- R 组：根因判据自检（不同尺这一缺陷面） ----------
// 先让产品自己的写方（out 侧必跟底）把视口停在真底部，再显示打字行——这就是钉住态的日常形态：
// 打字行可见期 scrollTop 停在「行隐藏态最大值」上，真 gap ≈0，而旧裸口径读数 ≈ 一行高 >8
await reset();
await ev("(function(){var b=document.getElementById('chat-body');b.scrollTop=b.scrollHeight-b.clientHeight;return true;})()");
await sleep(200);
await ev('(function(){var t=document.getElementById("chat-typing");if(t)t.hidden=false;return true;})()');
await sleep(150);
const rowState = await state();
check('R1 打字行显示期真贴底的读数：新旧两把尺子必须给出相反结论（根因判据仍在）',
  rowState.typing === true && Math.abs(rowState.gap) <= 2 && rowState.rawGap > 8,
  'gap=' + rowState.gap + '（真尺） rawGap=' + rowState.rawGap + '（旧尺）');
await ev('(function(){var t=document.getElementById("chat-typing");if(t)t.hidden=true;return true;})()');
await sleep(400);

// ---------- A2 打字行显示期轻点 ----------
await reset();
await inMsg('A2 来消息', 1200);          // 打字行显示 ≥1200ms，在窗口内轻点
await sleep(250);
await tap();
await sleep(400);
const afterTap = await state();
check('A2a 打字行显示期轻点＝手势结束当场回钉（旧口径此处被「离底一行高」误判为解钉态）',
  afterTap.anchor === false, 'anchor=' + afterTap.anchor + ' gap=' + afterTap.gap + ' typing=' + afterTap.typing);
const a2 = await waitMsg(base.n, 3000);
await sleep(900);
const a2s = await state();
check('A2b 该条落地跟到底（gap ≤8 且最新一条完整可见）',
  a2s.gap <= 8 && a2s.over !== null && a2s.over <= 1 && a2s.n > base.n,
  'gap=' + a2s.gap + ' over=' + a2s.over + ' n=' + a2s.n + '/' + base.n);

// ---------- A3 上滑回底、按住抬手（dy≥10） ----------
await reset();
const nBefore3 = (await state()).n;
await dragBackToBottom(120, 300);
await sleep(900); // 恢复走看门狗周期复核（滚动/触摸/几何全静默后才认）：必须等它跑一轮
const afterDrag = await state();
check('A3a 抬手后停在真底部＝钉住态被周期复核恢复（旧口径只认 dy<10 的轻点，这条手势 dy=120；红基线此处 anchor 永久为真＝此后每条来消息都不跟底）',
  afterDrag.anchor === false && Math.abs(afterDrag.gap) <= 2,
  'anchor=' + afterDrag.anchor + ' gap=' + afterDrag.gap);
await inMsg('A3 来消息', 300);
await sleep(2000);
const a3 = await state();
check('A3b 该条落地跟到底（gap ≤8 且最新一条完整可见；红基线此处 gap≈67、最新一条整条在视口下方）',
  a3.gap <= 8 && a3.over !== null && a3.over <= 1 && a3.n > nBefore3,
  'gap=' + a3.gap + ' over=' + a3.over + ' n=' + a3.n + '/' + nBefore3);

// ---------- A4 失底不粘住 ----------
const nBefore4 = a3.n;
await inMsg('A4 第二条', 300);
await sleep(2000);
const a4 = await state();
check('A4 失底不再粘住：紧接着再来一条仍跟到底',
  a4.gap <= 8 && a4.over !== null && a4.over <= 1 && a4.n > nBefore4,
  'gap=' + a4.gap + ' over=' + a4.over);

// ---------- A5/A6/A7 防修过头（#162/#416/#716 契约） ----------
// A5 上翻阅读中轻点：打字行显示期也不得回钉（贴底前置必须挡住）
await reset();
await inMsg('A5 来消息', 1200);
await sleep(200);
await scrollBy(-400);
await sleep(120);
await tap();
await sleep(500);
const a5 = await state();
check('A5 防修过头：上翻阅读中轻点不得回钉（离底 >8px 就不算贴底）',
  a5.anchor === true && a5.gap > 300, 'anchor=' + a5.anchor + ' gap=' + a5.gap);
await sleep(2600);

// A6 上翻阅读中来消息：不得被拽到底（解钉必须走真机路径＝触摸解钉，纯程序化 scrollTop 不解钉）
await reset();
await dragUp(400);
const nBefore6 = (await state()).n;
await inMsg('A6 来消息', 300);
await sleep(2000);
const a6 = await state();
check('A6 防修过头：上翻阅读中来消息不得被拽回底（#162 不打扰契约）',
  a6.gap > 300 && a6.n > nBefore6, 'gap=' + a6.gap + ' n=' + a6.n + '/' + nBefore6);

// A7 手势进行中来消息：不得拽底（#716）
await reset();
await ev(TOUCH('touchstart', 500));
await sleep(60);
await scrollBy(-300);
await sleep(120);
const nBefore7 = (await state()).n;
await inMsg('A7 来消息', 300);
await sleep(1600);
const a7 = await state();
await dragEnd(900); // 手势收尾（dy=400 → 终点非贴底，不得回钉）
await sleep(500);
const a7b = await state();
check('A7 防修过头：手指还在屏上（手势进行中）时来消息 / 抬手在历史位＝不得拽底（#716）',
  a7.gap > 200 && a7b.gap > 200 && a7.n > nBefore7, 'drag 中 gap=' + a7.gap + ' 抬手后 gap=' + a7b.gap + ' n=' + a7.n + '/' + nBefore7);

// A8 回钉写走落定锁：手势终点回钉后逐帧无大倒退、末态贴底
// 采样窗＝[抬手, 落定]——只覆盖修复自己那一枪，不含用例故意做的上滑位移（那是手势不是回钉写）
await reset();
await dragBegin(620, 300);
await ev(`(function(){var b=document.getElementById('chat-body');window.__drTrace=[];window.__drOn=true;var t0=performance.now();(function loop(){if(!window.__drOn)return;window.__drTrace.push([Math.round(performance.now()-t0),Math.round(b.scrollTop*10)/10]);requestAnimationFrame(loop);})();return true;})()`);
await dragEnd(620);
await sleep(1200);
await ev('window.__drOn=false;');
const trace = JSON.parse((await ev('JSON.stringify(window.__drTrace)')) || '[]');
let maxBack = 0;
for (let i = 1; i < trace.length; i++) maxBack = Math.max(maxBack, trace[i - 1][1] - trace[i][1]);
const a8 = await state();
check('A8 回钉后滚动位无 >25px 倒退帧且末态贴底（#871/#933「中途裸写停旧偏移」不回流）',
  trace.length > 5 && maxBack <= 25 && Math.abs(a8.gap) <= 2,
  '帧数=' + trace.length + ' 最大倒退=' + Math.round(maxBack * 10) / 10 + 'px gap=' + a8.gap + ' over=' + a8.over);

// ---------- C 轴：卡片来件（礼物卡＝用户追加报障的面） ----------
const DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAAB4CAYAAABw4pVUAAAAWklEQVR42u3XwQ3AIAwEwbT/0tMCSrxSRHZm/5a8zt7dAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAZ1wzM1VVVf3HvwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4sQviQAG3t1WxAAAAAElFTkSuQmCC';
const giftRec = (id, extra) => {
  const rec = { side: 'in', special: 'gift', giftId: id, giftName: '小夜灯', giftEmoji: '🌼', giftImg: '', giftPrice: 1200, giftWish: '晚安', giftCat: 'life', ts: Date.now() };
  return Object.assign(rec, extra || {});
};
const addGift = (id, extra) => ev('window.chatAddGift(' + JSON.stringify(giftRec(id, extra)) + ')');
// 卡片跟底判据：给 400ms 收口窗（钉住态看门狗 250ms 一枪；卡片长高也靠它补平）
const cardOk = async () => { await sleep(400); const s = await state(); return s; };

// C1 礼物卡落地即贴底（含动作区则更接近真机：走产品链路 maybeAutoGift）
await reset();
await ev("(function(){ var g=window.xyStore('xy-home-v2'); g.set('market-wl-settings', JSON.stringify({ giftInOn:1, giftInPct:100, wlOn:0, wlBuyPct:0, selfOn:0, selfPct:0, selfChatOn:1, wishChatOn:0, wishChatPct:0, giftReplyOn:0, giftReplyPct:0, giftReplyMode:1 })); return true; })()");
await ev('window.maybeAutoGift && window.maybeAutoGift()');
let giftSeen = null;
for (let i = 0; i < 24; i++) { const s = await state(); if ((s.cls || '').indexOf('msg-gift') >= 0) { giftSeen = s; break; } await sleep(300); }
const c1 = await cardOk();
check('C1 礼物卡（产品链路 maybeAutoGift，真机形态）落地即贴底',
  c1.gap <= 8 && c1.over !== null && c1.over <= 1 && (c1.cls || '').indexOf('msg-gift') >= 0 && giftSeen !== null,
  'gap=' + c1.gap + ' over=' + c1.over + ' cls=' + c1.cls);

// C2 打字行显示期轻点 → 礼物卡（红基线：卡片整条落在视口下方）
await reset();
await inMsg('C2 先说一句', 1500);
await sleep(250); await tap(); await sleep(500);
const nB2 = (await state()).n;
await addGift('c2');
const c2 = await cardOk();
check('C2 打字行显示期轻点后到达的礼物卡仍跟底（红基线此处 gap≈200、卡片整条在视口下方）',
  c2.gap <= 8 && c2.over !== null && c2.over <= 1 && c2.n >= nB2,
  'gap=' + c2.gap + ' over=' + c2.over + ' cls=' + c2.cls);

// C3 上滑回底、按住抬手 → 礼物卡
await reset();
await dragBackToBottom(120, 300);
await sleep(700);
await addGift('c3');
const c3 = await cardOk();
check('C3 上滑回底抬手后到达的礼物卡仍跟底（红基线此处 gap≈134）',
  c3.gap <= 8 && c3.over !== null && c3.over <= 1, 'gap=' + c3.gap + ' over=' + c3.over + ' cls=' + c3.cls);

// C4 带图礼物卡（dataURL 图，图片解码后卡片才定高）
await reset();
await addGift('c4', { giftImg: DATAURL, giftName: '星空灯' });
const c4 = await cardOk();
check('C4 带图礼物卡落地即贴底（图片解码撑高后仍在底部）',
  c4.gap <= 8 && c4.over !== null && c4.over <= 1, 'gap=' + c4.gap + ' over=' + c4.over);

// C5 卡片落地后长高：点【领取】（动作区就地换状态，卡片变高）
await reset();
await addGift('c5', { giftName: '领卡测试' });
await sleep(600);
const h5a = (await state());
await ev("(function(){var b=document.querySelector('.msg-gift-claim');if(b)b.click();return true;})()");
const c5 = await cardOk();
check('C5 卡片落地后长高（点【领取】/TA 收礼回话贴卡）仍被补平到贴底',
  c5.gap <= 8 && c5.over !== null && c5.over <= 1, 'gap=' + c5.gap + ' over=' + c5.over + '（长高前 sh=' + h5a.max + '）');

// C6 泄漏探测：8 个卡片场景 × 60ms 采样，任一新节点到来时「前在底部 + 后不在底部 + 无手势」即泄漏
await reset();
const scenarios = [
  ['礼物卡·基线', async () => { await addGift('k1'); }],
  ['礼物卡·打字行期轻点', async () => { await inMsg('先说', 1500); await sleep(250); await tap(); await sleep(400); await addGift('k2'); }],
  ['礼物卡·上滑回底抬手', async () => { await dragBackToBottom(120, 300); await sleep(600); await addGift('k3'); }],
  ['问卷卡', async () => { await ev("window.chatAddSystem('问卷（1 题）', { special:'ask-survey', surveyTs:Date.now(), surveyQs:[{text:'Q1',options:['a','b'],type:'single'}], surveyStatus:'sent', surveyAnswers:[] })"); }],
  ['选择卡', async () => { await ev("window.chatAddSystem('选一个？', { special:'ask-choose', choiceQuestion:'选一个？', choiceOptions:['甲','乙'], choicePref:0 })"); }],
  ['文本＋礼物卡同任务连发', async () => { await ev("window.chatAddIn('TA 先回你一句', {})"); await addGift('k4'); }],
  ['带图礼物卡', async () => { await addGift('k5', { giftImg: DATAURL }); }],
  ['礼物卡·长句回话贴卡后', async () => { await addGift('k6'); await sleep(600); }]
];
await ev(`(function(){
  var b=document.getElementById('chat-body');
  window.__lk=[]; window.__lkOn=true; window.__lkG=0;
  (function tick(){
    if(!window.__lkOn) return;
    var t=document.getElementById('chat-typing');
    var rowH=(t&&!t.hidden)?t.offsetHeight:0;
    var max=b.scrollHeight-(b.clientHeight+rowH);
    var lm=b.children.length?b.children[b.children.length-1]:null;
    window.__lk.push({n:b.children.length, gap:Math.round((max-b.scrollTop)*10)/10,
      anchor:b.classList.contains('scroll-anchor-auto')?1:0, g:window.__lkG, cls:lm?(lm.className||'').slice(0,26):'-'});
    setTimeout(tick, 60);
  })();
  return true;
})()`);
for (const [label, fn] of scenarios) {
  await reset();
  await ev('window.__lkG++; true');
  await fn();
  await sleep(1600);
}
await ev('window.__lkOn=false;');
const lk = JSON.parse((await ev('JSON.stringify(window.__lk)')) || '[]');
let leak = 0, leakInfo = '';
for (let i = 1; i < lk.length; i++) {
  const a = lk[i - 1], b = lk[i];
  if (b.n <= a.n) continue;
  const win = lk.slice(i).filter((x) => x.g === b.g).slice(0, 26);
  const after = win.length ? win[win.length - 1] : b;
  if (a.gap <= 8 && after.anchor === 1 && after.gap > 8) { leak++; if (!leakInfo) leakInfo = b.cls + ' gap ' + a.gap + '→' + after.gap; }
}
check('C6 卡片泄漏探测：' + scenarios.length + ' 个卡片场景零「在底部却来件不跟底」帧（采样 ' + lk.length + ' 帧）',
  leak === 0, leak ? leak + ' 处泄漏（' + leakInfo + '）' : '零泄漏');

check('Z1 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过' + (fails ? '（' + root + '）' : ''));
process.exit(fails ? 1 : 0);
