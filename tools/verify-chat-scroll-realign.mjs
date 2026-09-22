// ===== 回归验证：#933 iPhone 12 Pro Max Safari「聊天记录上划太用力还是会错位，跑到屏幕上半位置，
//       下半是空的，但点击屏幕即可恢复」（用户直派，点名多机型同现、勿致其他型号回归；零机型分支） =====
// 缺陷面（#871 同族，无头可造）：上划用力的抬手惯性/底部橡皮筋回弹期里，100ms 防抖的 scroll 回调
//   进入「解钉态+贴底＝回钉」分支后**当场写** scrollTop（#716 只挡「手指在屏」的手势期，惯性滑行
//   照样算解钉态）——#871 真机结论「中途写＝WebKit 滚动树停在旧偏移」；且写后 pinned 已置，#706
//   看门狗只认「离底 >8px」这一种失底（撕裂/超界时 scrollTop 读值 ≥ max 恒不成立）永不复查，
//   整页只有轻点 touchend 的 chatAtBottom()→scrollChatBottom() 写得回来＝「点屏幕即可恢复」。
// 修复：#933 回钉标记当场置（自动跟底语义零回退）、几何写入交 #861 落定锁（滚动/触摸/几何全静默
//   后只写一枪）：贴底/钉住＝scrollChatBottom 同值重落（超界同时显式钳回），翻历史＝转 #871 解钉态
//   钳回/同值重落、绝不拽底。
// 断言（428×926 DPR3 触摸仿真＋iOS UA＝按报障机型形态驱动产品真链路；写点用 scrollTop 存取器探针
//   记录，惯性用「原生 setter 连续微移＝真实 scroll 事件流」仿真，撕裂滞留用「活动中写被内核丢弃＋
//   读数偏移」故障注入仿真——全部零机型分支、纯时序/几何判据）：
//   S1~S4 静态锚：修复面四段逻辑锚在 src/js/chat.js（回钉不再当场写 / 助手在位 / 落定闸 / 贴底路由）
//   B0 前置：聊天页贴底、消息全在渲染窗口内、滚动余量充足
//   B0b 前置：拖动解钉确实生效（重试式；不生效后面断言会空转成假绿，必须报出来）
//   B1 惯性/回弹期（scroll 活动持续中）零 scrollTop 写（红：HEAD 在 ~100ms 当场写走缺陷面）
//   B2a 前置：回钉分支确实触发（解钉类被摘除；两侧同绿＝判据成立性）
//   B2 停手落定后恰好补写一枪（写在静默 ≥200ms 之后、写值≈真实 max、末行贴底）
//   B3 撕裂滞留态（读数偏移 +260px、活动中写被内核丢弃）在**无点触**下自动痊愈
//   B3b 轻点回钉通道仍能把滞留偏移拉回（实报「点屏幕即可恢复」机理复现；两侧同绿＝判据成立性）
//   B4 翻历史（解钉）落定后不被拽底（#162/#416 契约不回退）
//   B5 贴底钉住健康态 1.2s 内零多余写（不新增周期性噪音）
//   B6 惯性期回钉后自动跟底语义零回退（来向消息仍跟底＝「标记当场置」而非只拦写）
//   Z1 全程零 JS 异常
// 用法：node tools/verify-chat-scroll-realign.mjs（默认对仓库根产物；MOCHI_SERVE_ROOT=<目录> 可对
//       临时构建产物做红绿对照）。需要 Node 21+ 与本机 Chrome/Edge。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
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

// ---- S 组：静态锚（对 src/js/chat.js，覆盖在产物构建之前） ----
const src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
// 回钉分支（#716 判定行不变）之后不得再是当场写；改走 #933 落定锁排班
check('S1 #933a 回钉分支不再当场写 scrollTop（分支体改成落定锁排班）',
  src.includes('chatScrollRealignQuiet();') && !/chatAtBottom\(\)\) \{ \/\/ #716：[^\n]*\nscrollChatBottom\(\);/.test(src));
check('S2 #933b 滚动会话落定重对齐助手在位（Quiet 排班 + Step 落定写）',
  src.includes('function chatScrollRealignQuiet() {') && src.includes('function chatScrollRealignStep() {'));
check('S3 #933c 复用 #861 落定闸（滚动/触摸/几何全静默后才写一枪）',
  src.includes('if (!chatRepinQuietEnough(now)) { if (now < _rsAlignDeadline) _rsAlignT = setTimeout(chatScrollRealignStep, 120); return; }'));
check('S4 #933d 贴底/钉住＝同值重落，解钉态转 #871 钳回（绝不拽底）',
  src.includes('if (chatPinnedBottom || chatAtBottom()) { scrollChatBottom(); return; }') && src.includes("chatResyncScrollQuiet('scroll');"));

// ---- 无头浏览器（真实产品链路） ----
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9780 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-933v-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// iPhone 12 Pro Max 形态（报障设备）：428×926 @3x 触摸仿真＋iOS UA（mobile-adapt 走 iOS 分支：
// chat-body 内联 transform:none 豁免——与真机同构）
await cdp('Emulation.setDeviceMetricsOverride', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
// 关开屏与「数据备份提醒」启动弹窗（占住 #modal-mask 会吃掉点击）
await ev("(function(){var s=document.querySelector('.splash');if(s)s.classList.add('hide');var q=document.getElementById('qa-close');if(q)q.click();return true;})()");
await sleep(500);
await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}return true;})()");
await ev("(function(){var bar=document.getElementById('backup-remind-bar');if(bar)bar.remove();return true;})()");
await sleep(400);
// 关自动回复/打字行，排除随机回复干扰几何与写点断言
await ev("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(900);

// 种 60 条消息：全部落在渲染窗口内（不触发增量窗口管理/缺口补画＝几何与写点可预期）
for (let i = 1; i <= 60; i++) await ev(`window.chatAddIn('滚动落定回归第${i}条消息，用来撑出足够的滚动余量。');`);
await ev('(function(){window.__nativeTopSet=null;var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
await sleep(1400); // 平滑跟底动画（≤360ms）+ 写入自身 scroll 事件全部冷却

// ---- 页内工具：原生 setter 桥 + scrollTop 存取器探针（pass＝只记录转发；drop＝仿真「活动中写被
//      内核丢弃、读数带表现层偏移」＝#871 真机结论的无头形态，零机型分支） ----
await ev(`(function(){
  var b=document.getElementById('chat-body');
  if (window.__nativeTopSet) return 'already';
  var d=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
  window.__nativeTopSet=function(v){ d.set.call(b,v); };
  window.__nativeTopGet=function(){ return d.get.call(b); };
  window.__wlog=[]; window.__slog=[]; window.__stickExtra=0; window.__mode='off';
  b.addEventListener('scroll', function(){ window.__slog.push(Math.round(performance.now())); }, {passive:true});
  window.__topMode=function(mode){
    window.__mode=mode;
    var d2=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
    Object.defineProperty(b,'scrollTop',{ configurable:true,
      get:function(){ return d2.get.call(b) + window.__stickExtra; },
      set:function(v){
        var t=performance.now();
        var last=window.__slog.length?window.__slog[window.__slog.length-1]:-1e9;
        var active=(t-last)<200; // 与产品同口径：滚动活动 200ms 内的写＝落在惯性/回弹动画中途
        window.__wlog.push({t:Math.round(t), v:Math.round(v*10)/10, active:active});
        if (mode==='pass'){ d2.set.call(b,v); return; }
        if (!active){ window.__stickExtra=0; d2.set.call(b,v); } // 静默期写＝内核落地并清掉滞留偏移
      }
    });
    return mode;
  };
  // 惯性/回弹仿真：原生 setter 在贴底 1px 内连续微移＝真实 scroll 事件流（产品同款事件链），
  // 全程贴底（gap ≤ 2）＝正对「上划用力回弹期」那段时间窗。
  // 双档取 floor(max)−1 / floor(max)：scrollTop 真上限常带小数位（4098.67 之类），直接写
  // scrollHeight−clientHeight 会被内核钳回原值＝写不进、scroll 事件不出、仿真空转（实测坑），
  // 取整双档保证每次写都真实位移、事件必达。
  window.__sim=function(ms){
    return new Promise(function(res){
      var a=Math.max(0, Math.floor(b.scrollHeight-b.clientHeight)-1), c=a+1;
      var end=performance.now()+ms;
      (function tick(){
        if (performance.now()>=end){ window.__nativeTopSet(c); res('done'); return; }
        window.__nativeTopSet(window.__nativeTopGet()>a?a:c);
        setTimeout(tick,40);
      })();
    });
  };
  // 解钉（拖动 dy=30 ≥ 10＝真实滑动意图，不走轻点回钉）：touchstart 解钉、touchend 不写
  // 2026-09-21 #998 备注（断言语义未动，仅记录装置适用边界）：本装置**不带位移**，拖动前后视口都停在
  // 真底部——#998 起这种「停在真底部 + 静止 + 解钉」会被看门狗按 #378 既定语义（用户自己滚回贴底＝
  // 恢复自动跟底）合法回钉，故读类必须与拖动同一次 evaluate（见 ensureUnpinned），且中间不要插入真实
  // 位移（实测：给拖动补位移会让回钉提前到 __sim 的活动窗里、落定写被「活动中丢弃」吃掉，B3 在纯
  // HEAD 上也变红＝装置自身的坑，与本产品改动无关）。
  window.__unpinDrag=function(){
    var r=b.getBoundingClientRect(); var y=Math.round(r.top+r.height*0.6);
    var t1=new Touch({identifier:1,target:b,clientX:200,clientY:y});
    var t2=new Touch({identifier:1,target:b,clientX:200,clientY:y-30});
    b.dispatchEvent(new TouchEvent('touchstart',{touches:[t1],changedTouches:[t1],bubbles:true,cancelable:true}));
    b.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[t2],bubbles:true,cancelable:true}));
    return true;
  };
  window.__tap=function(){
    var r=b.getBoundingClientRect(); var y=Math.round(r.top+r.height*0.6);
    var t1=new Touch({identifier:3,target:b,clientX:200,clientY:y});
    b.dispatchEvent(new TouchEvent('touchstart',{touches:[t1],changedTouches:[t1],bubbles:true,cancelable:true}));
    b.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[t1],bubbles:true,cancelable:true}));
    return true;
  };
  return 'util';
})()`);
const gapOf = `(function(){var b=document.getElementById('chat-body');var max=b.scrollHeight-b.clientHeight;return JSON.stringify({gap:Math.round((max-b.scrollTop)*10)/10, max:Math.round(max), stick:window.__stickExtra});})()`;
const reset = async (extra) => { await ev('window.__wlog.length=0;window.__slog.length=0;' + (extra !== undefined ? 'window.__stickExtra=' + extra + ';' : '') + 'true'); };
// 解钉前置（重试式）：unpinChatAndAnchor 给 chat-body 挂 scroll-anchor-auto（#316）——类不在＝这次
// 合成拖动没生效（偶发丢失），重试；多次仍不在＝环境问题，由调用处断言报出，别让断言空转成假绿。
// 2026-09-21 #998：拖动与读类合并到**同一次 evaluate**——合成拖动是同步的、类由 touchstart 同步挂上，
// 而分两次 evaluate 会夹进几十 ms 的 CDP 往返，窗口里产品的合法回钉（#378：停在真底部 + 静止 ⇒ 恢复
// 自动跟底，由看门狗周期复核执行）可能已经把类摘掉，使本前置变成与看门狗赛跑（实测 3 跑 1 红）。
const ensureUnpinned = async () => {
  for (let i = 0; i < 5; i++) {
    const ok = await ev("(function(){ window.__unpinDrag(); return document.getElementById('chat-body').classList.contains('scroll-anchor-auto'); })()");
    if (ok) return true;
    await sleep(120);
  }
  return false;
};

// ---- B0 前置 ----
const b0 = JSON.parse(await ev(gapOf) || '{}');
check('B0 前置：聊天页贴底、60 条全在渲染窗口内、滚动余量 ≥ 600',
  b0 && Math.abs(b0.gap) <= 2 && b0.max >= 600, JSON.stringify(b0));

// ---- B1/B2：上划用力（惯性/回弹期）——修复前：~100ms 当场写（active 写）；修复后：静默后一枪 ----
await ev('window.__topMode("pass")');
const unpinned1 = await ensureUnpinned();
check('B0b 前置：拖动解钉已生效（chat-body 带 scroll-anchor-auto，解钉=回钉分支的可达前提）', unpinned1 === true, 'anchor=' + unpinned1);
await reset(0);
await ev('window.__sim(700)'); // 700ms 贴底微移＝惯性/回弹期
await sleep(1300); // 停手 + 落定窗（>1200ms 死线内该来的一枪已来）
const lg1 = JSON.parse(await ev('JSON.stringify({w:window.__wlog,s:window.__slog.length})') || '{}');
const badW = (lg1.w || []).filter((x) => x.active);
check('B1 惯性/回弹期（滚动活动持续中）零 scrollTop 写（红：HEAD 在 ~100ms 当场写）',
  badW.length === 0, 'active写=' + badW.length + (badW.length ? ' 首个@' + Math.round(badW[0].t) + 'ms v=' + badW[0].v : '') + ' 总写=' + lg1.w.length);
const rePinned = await ev("!document.getElementById('chat-body').classList.contains('scroll-anchor-auto')");
check('B2a 前置：回钉分支确实触发（解钉类已被摘除＝钉住标记已置；两侧同绿）', rePinned === true, 'repinned=' + rePinned);
const calmW = (lg1.w || []).filter((x) => !x.active);
const gg1 = JSON.parse(await ev(gapOf) || '{}');
check('B2 停手落定后恰好补写一枪（写值≈真实 max、末行贴底）',
  calmW.length >= 1 && Math.abs(calmW[calmW.length - 1].v - gg1.max) <= 2 && gg1.gap <= 2,
  '静默写=' + calmW.length + ' 写值=' + (calmW.length ? calmW[calmW.length - 1].v : '-') + ' 真实max=' + gg1.max + ' gap=' + gg1.gap);

// ---- B3：撕裂滞留态（表现层偏移 +260px＋活动中写被内核丢弃）——无点触自愈 ----
await ev('window.__topMode("drop")');
await reset(260);
await ensureUnpinned(); // 同 B0b：合成拖动偶发丢失，重试到解钉标记生效
await ev('window.__sim(600)');
await sleep(1400);
const stick3 = await ev('window.__stickExtra');
check('B3 撕裂滞留态在无点触下自动痊愈（红：HEAD 的中途写被内核丢弃、之后无人再写＝停在错位）',
  stick3 === 0, 'stickExtra=' + stick3);

// ---- B3b：轻点回钉通道（用户实报「点屏幕即可恢复」）——两侧同绿＝判据成立性 ----
await reset(260);
await sleep(300); // 静默（无滚动活动）
await ev('window.__tap()');
await sleep(500);
const stick3b = await ev('window.__stickExtra');
check('B3b 轻点回钉仍能把滞留偏移拉回（实报机理复现；两侧同绿）', stick3b === 0, 'stickExtra=' + stick3b);

// ---- B4：翻历史（解钉）落定后不被拽底（#162/#416 契约） ----
await ev('(function(){delete document.getElementById("chat-body").scrollTop;window.__stickExtra=0;return true;})()');
await ev('window.__topMode("pass")');
await reset(0);
await ev('window.__nativeTopSet(document.getElementById("chat-body").scrollHeight)');
await sleep(400);
await ev('window.__unpinDrag()');
await ev('(function(){var b=document.getElementById("chat-body");var max=b.scrollHeight-b.clientHeight;window.__nativeTopSet(Math.round(max*0.45));return true;})()');
await sleep(1800);
const b4 = JSON.parse(await ev(`(function(){var b=document.getElementById('chat-body');var max=b.scrollHeight-b.clientHeight;return JSON.stringify({gap:Math.round(max-b.scrollTop)});})()`) || '{}');
check('B4 翻历史（解钉）落定后不被拽底（gap 保持中段富余）', b4 && b4.gap > 100, 'gap=' + (b4 && b4.gap));

// ---- B5：贴底钉住健康态零多余写（不新增周期性噪音） ----
await ev('window.__nativeTopSet(document.getElementById("chat-body").scrollHeight)');
await sleep(700); // 让回钉排班/写入自身 scroll 事件全部冷却后开始计数
await reset(0);
await sleep(1200);
const w5 = JSON.parse(await ev('JSON.stringify(window.__wlog)') || '[]');
check('B5 贴底钉住健康态 1.2s 内零多余写（不新增周期性噪音）', w5.length === 0, 'writes=' + w5.length);

// ---- B6：惯性期回钉后自动跟底语义零回退（「标记当场置」而非只拦写） ----
await ev(`window.chatAddIn('跟底语义回归：这条来向消息应把视图带到最底。');`);
await sleep(700);
const b6 = JSON.parse(await ev(gapOf) || '{}');
check('B6 来向消息仍自动跟底（钉住标记当场置、自动跟底零回退）', b6 && b6.gap <= 2, 'gap=' + (b6 && b6.gap));

// ---- Z 组：零 JS 异常 ----
const errs = await ev('JSON.stringify((window.__jsErrors||[]).length)');
check('Z1 全程零 JS 异常', errs === '0', 'errors=' + errs);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const failed = results.filter(r => !r.ok).length;
console.log('\n通过 ' + (results.length - failed) + '/' + results.length + (failed ? '  ← 有断言失败' : ''));
process.exit(0);
