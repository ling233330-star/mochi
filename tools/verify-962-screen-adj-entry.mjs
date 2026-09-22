// ===== 常驻回归：#962 屏幕适配微调「只能在设置里盲调」根治（用户 2026-09-21 直派
// 「现在只能在这个设置里面调、不能在桌面的页面调，需要区分在桌面页面调和在聊天页面里调，
//   现在是盲调什么也看不见」；同批收口从未入库的 #940 面板段）=====
// 根因（无头 390×844 实测，零机型分支）：面板贴底 bottom:0 时占距底 0~338px，而底部导航占
// 距底 18~82px、聊天输入栏占距底 0~43px，连收起态也占 0~70px ⇒ 切页的唯一入口（tabbar）与
// 说话的唯一入口（输入栏）被整条盖死，用户在设置里开了面板就再也走不到桌面/聊天页，只能盲调。
// 断言：
//  S 组＝产物源锚（红侧必红）：底部导航/输入栏留白、默认落位、收起成胶囊、看桌面/看聊天直达、
//      页面名、聊天设置/桌面两处入口与接线、哨兵登记
//  B 组＝行为面（真浏览器，红侧必红）：B1 开面板不压底部导航／B2 收起＝小胶囊且不压导航／
//      B3 胶囊点开复活／B4 聊天页不压输入栏／B5「看聊天」落到聊天页／B6「看桌面」落回桌面页／
//      B7 面板开着仍能点到底部导航（命中测试）／B12 聊天「更多」面板已无屏幕适配入口／
//      B12b/B12c 聊天设置页可开 + 点「屏幕适配微调」行开面板／B13 装修栏入口接线可用／
//      B9/B10 页面名随页切换（区分桌面/聊天）
//  #982（用户 2026-09-21 直派「屏幕适配不该放在聊天的更多功能的工具里，要放在聊天的聊天设置里」）：
//      聊天侧入口由「更多 → 工具 → 屏幕适配」改为「聊天设置 → 美化 → 屏幕适配微调」，
//      S8/S10/S13/S17/S18 与 B12 系列即该批的判别面。
//  #990（用户 2026-09-21 直派「屏幕适配打开了这个功能…没有把调桌面和聊天里的屏幕的功能分开，
//      这样用户不知道点哪一个才是」「拖标题行可上移移动功能位置。没有写清楚」）：
//      ①两枚裸按钮「看桌面 / 看聊天」→ 带选中态的页签（当前页那枚反色高亮，
//        设置页两枚都不高亮时说明行直说点哪一枚）＝S19/S23/B14/B15/B20；
//      ②七轴按生效页面分三组加小标题（通用位置轴 / 只影响桌面页 / 只影响聊天页正文文字），
//        当前页那组打「你正在这一页」标记＝S20/S21/B14/B15/B16/B17；
//      ③拖动说明从被按钮挤成省略号的标题行挪到标题下（标题行只留一句完整的拖动说明）＝
//        S22/B18/B19；④旧文案「看桌面 / 看聊天」「拖标题行可上移」不得回流＝S24/S22。
//      同批实修（实测发现）：#982 的 template 入口行 + build.mjs 的 #982a~c 曾被并行批整块回退，
//      HEAD 上只剩「更多 → 工具 → 屏幕适配」空按钮（接线已随 #982 撤掉＝点了没反应的死按钮）
//      ＝用户「不知道点哪一个」的直接形态；按 #982 原文补回入口行并撤掉死按钮（S10/S17/B12c）。
//  C 组＝防修过头（两侧同过）：C1 滑杆仍落 LS（本地永久保存语义不变）／C2 全部恢复默认仍归零／
//      C3 面板仍在返回键清单内（tabs.js）／C4 二十五条哨兵 needle 各自在登记 file 内唯一
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-962-screen-adj-entry.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-957-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            const desc = (d && ((d.exception && d.exception.description) || d.text)) || 'err';
            jsExcepts.push(String(desc).split('\n').slice(0, 2).join(' | ').slice(0, 180));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
const check = (d, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } else { fail++; console.log('  FAIL  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } };

// ---------- S 组：产物源锚（src + 产物双查）----------
console.log('[S] 源锚与哨兵');
const srcPers = (() => { try { return readFileSync(join(root, 'src/js/personalize.js'), 'utf8'); } catch (e) { return ''; } })();
const srcTpl = (() => { try { return readFileSync(join(root, 'src/template.html'), 'utf8'); } catch (e) { return ''; } })();
const srcTabs = (() => { try { return readFileSync(join(root, 'src/js/tabs.js'), 'utf8'); } catch (e) { return ''; } })();
const srcHelp = (() => { try { return readFileSync(join(root, 'src/js/settings-help.js'), 'utf8'); } catch (e) { return ''; } })();
const srcBuild = (() => { try { return readFileSync(join(root, 'build.mjs'), 'utf8'); } catch (e) { return ''; } })();
const sNeed = [
  ['S1 底部导航留白（删＝面板又贴底盖住切页入口）', srcPers.includes('Math.round(window.innerHeight - t.top + 8)')],
  ['S2 聊天输入栏留白（删＝聊天页开面板盖住输入栏）', srcPers.includes('return Math.max(gap, Math.round(window.innerHeight - r.top + 8))')],
  ['S3 默认落位在留白之上（删＝回到贴底 bottom:0）', srcPers.includes('(adjBottom == null ? bottomReserve() : adjBottom)')],
  ['S4 收起＝小胶囊（删＝收起态仍横贯底边）', srcPers.includes('function setMini(on) {')],
  ['S5 胶囊点一下展开（删＝收起后回不到滑杆）', srcPers.includes('if (tapToOpen && !moved) { setMini(false); return; }')],
  ['S6 「桌面 / 聊天」页签直达（删＝现场调回流；#990 起按 data-adj-goto 选择）', srcPers.includes('goPage(pair[0])') && srcPers.includes("['page-phone', '桌面'], ['chat', '聊天']")],
  ['S7 页面名「正在调：X」（删＝分不清在调哪一页）', srcPers.includes("'正在调：' + nm")],
  ['S8 聊天设置入口接线（删＝点行没反应）', srcPers.includes("getElementById('cs-screen-adj')")],
  ['S9 桌面页入口接线（删＝装修栏按钮点了没反应）', srcPers.includes("getElementById('decor-fit')")],
  ['S10 聊天设置→美化 入口行（删＝聊天里没入口）', srcTpl.includes('id="cs-screen-adj"')],
  ['S11 装修栏入口按钮（删＝桌面上没入口）', srcTpl.includes('id="decor-fit"')],
  ['S12 入口行小字随新交互更新（删＝说明与实际不符；#990 起小字写明「反色高亮那枚＝正在调的页面」）', srcTpl.includes('收起」变一枚小胶囊') && srcTpl.includes('反色高亮的那一枚＝你正在调的页面')],
  ['S13 settings-help 写明三处入口（删＝使用提示缺入口）', srcHelp.includes('桌面长按空白进装修模式') && srcHelp.includes('聊天设置」→ 美化 → 屏幕适配微调')],
  ['S17 聊天「更多 → 工具」入口已撤（回流＝用户「为什么放在更多功能的工具里」原话复发；且该按钮接线已撤＝死按钮）', !srcTpl.includes('more-screen-adj') && !srcPers.includes('more-screen-adj')],
  ['S18 聊天设置入口行也登记了功能说明（删＝那行只剩标题，说不清面板是什么）', srcHelp.includes("sel: '#cs-screen-adj'")],
  // —— #990 面（用户「没有把调桌面和聊天里的屏幕的功能分开，不知道点哪一个才是」+「拖标题行可上移…没写清楚」）——
  ['S19 页签带选中态（删＝又变成两枚分不出「我现在要调的」的裸按钮）', srcPers.includes("b.setAttribute('aria-pressed', on ? 'true' : 'false');") && srcPers.includes("pb.setAttribute('data-adj-goto', pair[0]);")],
  ['S20 轴→生效页面组表三条（删＝分组说明丢失，七轴平铺）', srcPers.includes("pos: '通用位置轴（桌面 / 聊天 / 设置都生效）'") && srcPers.includes("desk: '只影响「桌面页」',") && srcPers.includes("text: '只影响「聊天页」正文文字（气泡 / 输入框）'")],
  ['S21 分组小标题 + 当前页标记渲染（删＝看不出哪根滑杆管哪页）', srcPers.includes("gh.setAttribute('data-adj-group', ax.group);") && srcPers.includes("mine.textContent = '你正在这一页';")],
  ['S22 标题行拖动说明改写得完整可读（退回「拖标题行可上移 · 本机永久保存」＝又被按钮挤成省略号）', srcPers.includes("headHint.textContent = '按住这行标题上下拖＝把面板挪开';") && !srcPers.includes('拖标题行可上移')],
  ['S23 设置页说明行直说点哪一枚（删＝两枚都不高亮时用户又不知道点哪个）', srcPers.includes("当前不在桌面/聊天页（")],
  ['S24 旧「看桌面 / 看聊天」文案不得回流（回流＝入口语义与页签不一致，用户又要点错）', !srcPers.includes('看桌面 / 看聊天') && !srcTpl.includes('看桌面 / 看聊天') && !srcHelp.includes('看桌面 / 看聊天')],
  ['S25 使用说明/功能介绍口径与面板一致（删＝说明又写回「六轴」「− / + 步进」旧 UI，用户对不上面板）', srcTpl.includes('滑杆按「哪一页生效」分三组') && !srcTpl.includes('六轴') && !srcTpl.includes('− / + 步进') && !srcTpl.includes('五根轴')]
];
sNeed.forEach(([n, ok]) => check(n, ok));
check('S14 返回键清单仍含面板（#764h 契约不回退）', srcTabs.includes("'screen-adj-panel'];"));
const sentIds = ['#940a', '#940b', '#940c', '#940d', '#962a', '#962b', '#962c', '#962d', '#962e', '#962f', '#962g', '#962i', '#962k', '#982a', '#982b', '#982c',
  '#990a', '#990b', '#990c', '#990d', '#990e', '#990f', '#990g', '#990h', '#990i'];
const missingS = sentIds.filter((id) => srcBuild.indexOf("name: '" + id + ' ') < 0);
check('S15 二十五条哨兵（#940a~d + #962 家族 + #982a~c 入口改挂 + #990a~i 分页/分组/文案）全部登记', missingS.length === 0, missingS.join(','));
// S16 needle 在各自登记 file 内唯一（哑哨兵体检，防「删掉修复仍报绿」）
const needles = [
  ['js/personalize.js', 'z-index:96;max-height:40vh;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);'],
  ['js/personalize.js', 'adjBottom = Math.max(0, Math.min(Math.round(window.innerHeight * 0.7), Math.round(sb + sy - e.clientY)));'],
  ['js/personalize.js', 'if (adjBottom != null && adjBottom <= bottomReserve() + 6) adjBottom = null;'],
  ['js/personalize.js', "if (elBody) elBody.style.display = adjMini ? 'none' : 'flex';"],
  ['js/personalize.js', 'if (t && t.height && t.top > 0) gap = Math.max(gap, Math.round(window.innerHeight - t.top + 8));'],
  ['js/personalize.js', 'if (r && r.height) return Math.max(gap, Math.round(window.innerHeight - r.top + 8));'],
  ['js/personalize.js', 'function setMini(on) {'],
  ['js/personalize.js', 'if (tapToOpen && !moved) { setMini(false); return; }'],
  ['js/personalize.js', "ctx.textContent = '正在调：' + nm;"],
  ['js/personalize.js', "const chatSetEntry = document.getElementById('cs-screen-adj');"],
  ['js/personalize.js', "const decorEntry = document.getElementById('decor-fit');"],
  ['template.html', 'id="cs-screen-adj"'],
  ['template.html', 'id="decor-fit"'],
  // #990 面 needle（各在自己登记 file 内唯一）
  ['js/personalize.js', "b.setAttribute('aria-pressed', on ? 'true' : 'false');"],
  ['js/personalize.js', "if (mk) mk.style.display = groupIsCurrent(h.getAttribute('data-adj-group')) ? 'inline-block' : 'none';"],
  ['js/personalize.js', "desk: '只影响「桌面页」',"],
  ['js/personalize.js', "gh.setAttribute('data-adj-group', ax.group);"],
  ['js/personalize.js', "headHint.textContent = '按住这行标题上下拖＝把面板挪开';"],
  ['js/personalize.js', '想调哪一页，就点「正在调」旁边那一枚页签'],
  ['js/personalize.js', "else ch.textContent = '当前不在桌面/聊天页（' + nm + '）：点「桌面」或「聊天」切过去看现场"],
  ['template.html', '反色高亮的那一枚＝你正在调的页面'],
  ['template.html', '滑杆按「哪一页生效」分三组']
];
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };
const uniqBad = needles.filter(([f, n]) => readSrc(f).split(n).length - 1 !== 1).map(([f, n]) => f + ':' + n.slice(0, 26));
check('S16 哨兵 needle 各自在登记 file 内唯一（哑哨兵体检）', uniqBad.length === 0, uniqBad.join(' | '));

// ---------- 浏览器 ----------
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: "try{localStorage.setItem('xy-home-v2:__guide-done','1');localStorage.setItem('xy-home-v2:__onboard-done','1');}catch(e){}"
});
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}var m=document.getElementById('modal-mask');if(m)m.hidden=true;var g=document.getElementById('pc-sheet-mask');if(g)g.hidden=true;return true;})()");
await sleep(700);

const rectOf = (sel) => evalJs(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),vis:!e.hidden&&getComputedStyle(e).display!=='none'};})()`);
const overlap = (a, b) => !!(a && b && a.vis && b.vis && a.y < b.y + b.h && a.y + a.h > b.y && a.x < b.x + b.w && a.x + a.w > b.x);
const hitInside = (sel, cls) => evalJs(`(function(){var t=document.querySelector(${JSON.stringify(sel)});if(!t)return 'no-el';var r=t.getBoundingClientRect();var el=document.elementFromPoint(Math.round(r.x+r.width/2),Math.round(r.y+r.height/2));if(!el)return 'none';return (el.closest(${JSON.stringify(cls)})?'IN':'OUT')+':'+(el.id||el.className||el.tagName);})()`);
// 命中测试前先静场：开屏/引导/弹窗等整屏遮罩会盖住底部导航，命中的是遮罩而不是「面板有没有挡」
const clearOverlays = () => evalJs("(function(){['splash','modal-mask','qa-mask','pc-sheet-mask','img-view-mask','tc-mask','avlib-card'].forEach(function(id){var e=document.getElementById(id);if(e)e.hidden=true;});return [].filter.call(document.querySelectorAll('#modal-mask,#qa-mask,#pc-sheet-mask'),function(e){return e.offsetParent!==null;}).map(function(e){return e.id;}).join(',');})()");

console.log('[B] 行为面（真浏览器 390×844）');
// 切到设置页并开面板
await evalJs("document.querySelector('.tab[data-page=\"page-setting\"]').click(); true");
await sleep(400);
await evalJs("document.getElementById('row-screen-adj').click(); true");
await sleep(500);
let panelR = await rectOf('#screen-adj-panel');
let tabR = await rectOf('.tabbar');
check('B0 面板已打开', !!(panelR && panelR.vis), panelR ? JSON.stringify(panelR) : 'null');
check('B1 开面板不压底部导航（盲调根因）', !!panelR && !!tabR && !overlap(panelR, tabR), 'panel.b=' + (panelR && panelR.y + panelR.h) + ' tab.top=' + (tabR && tabR.y));
const stillMasked = await clearOverlays();
await sleep(200);
// B2 是既有 flaky（纯 HEAD 基线 3 跑 1 红）：开屏/备份提醒弹层会在命中的那一瞬才真正收起，
// 命中到遮罩时重收一次再测（不改判据；detail 里带上盖住导航的元素身份，便于下次定位）
let b2 = String(await hitInside('.tabbar .tab', '.tabbar'));
let b2Retried = false;
if (!b2.startsWith('IN')) { b2Retried = true; await clearOverlays(); await sleep(300); b2 = String(await hitInside('.tabbar .tab', '.tabbar')); }
check('B2 面板开着仍能点到底部导航（命中测试）', b2.startsWith('IN'), '残留遮罩=' + stillMasked + '｜重试=' + b2Retried + '｜' + b2);
// 收起 → 小胶囊
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return false;var b=[].slice.call(p.querySelectorAll('button')).filter(function(x){return x.textContent==='收起';});if(!b.length)return 'no-fold';b[0].click();return true;})()");
await sleep(400);
panelR = await rectOf('#screen-adj-panel');
tabR = await rectOf('.tabbar');
check('B3 收起＝小胶囊（不再横贯底边）', !!panelR && panelR.w < 390 * 0.7 && panelR.h < 90, panelR ? ('w=' + panelR.w + ' h=' + panelR.h) : 'null');
check('B4 胶囊不压底部导航', !!panelR && !!tabR && !overlap(panelR, tabR), 'pill.b=' + (panelR && panelR.y + panelR.h) + ' tab.top=' + (tabR && tabR.y));
check('B5 胶囊上写着当前页面名（区分桌面/聊天）', String(await evalJs("(function(){var e=document.querySelector('#screen-adj-panel [data-adj-page]');return e?e.textContent:'none';})()")) === '设置');
// 点胶囊展开（红侧没有胶囊，这一条必须判红：先确认胶囊真的存在）
const miniExists = await evalJs("(function(){var m=document.querySelector('#screen-adj-panel [data-adj-mini]');return !!m;})()");
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');var m=p&&p.querySelector('[data-adj-mini]');if(!m)return false;m.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));m.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return true;})()");
await sleep(400);
panelR = await rectOf('#screen-adj-panel');
check('B6 胶囊点一下展开（没有胶囊/展不开＝红）', miniExists === true && !!panelR && panelR.h > 140, 'mini=' + miniExists + ' h=' + (panelR && panelR.h));
// 「聊天」（#990 起两枚页签＝带选中态；S6/S16/B7/B10 用 data-adj-goto 选择，不再按文案找）
await evalJs("(function(){var b=document.querySelector('#screen-adj-panel [data-adj-goto=\"chat\"]');if(!b)return 'no-btn';b.click();return true;})()");
await sleep(1200);
const chatVisible = await evalJs("!document.getElementById('page-chat').hidden");
check('B7 「聊天」页签切到聊天页（面板仍开着）', chatVisible === true && !!(await rectOf('#screen-adj-panel')));
panelR = await rectOf('#screen-adj-panel');
const rowR = await rectOf('#page-chat .chat-input-row');
check('B8 聊天页面板不压输入栏（开口就能说话）', chatVisible === true && !!panelR && !!rowR && rowR.vis && !overlap(panelR, rowR), 'panel.b=' + (panelR && panelR.y + panelR.h) + ' input.top=' + (rowR && rowR.y) + ' vis=' + (rowR && rowR.vis));
check('B9 页面名随页切到「聊天」', String(await evalJs("(function(){var e=document.querySelector('#screen-adj-panel [data-adj-page]');return e?e.textContent:'none';})()")) === '聊天');
// #990：聊天页上「聊天」那枚页签必须反色高亮、且「只影响聊天页文字」那组带「你正在这一页」
// （去掉选中态＝用户又分不清该点哪一枚＝本批要治的原话）
const segOnChat = await evalJs("(function(){var w=document.querySelector('#screen-adj-panel [data-adj-goto=\"chat\"]');var d=document.querySelector('#screen-adj-panel [data-adj-goto=\"page-phone\"]');var mn=document.querySelector('#screen-adj-panel [data-adj-group-mine]');var mine=[].slice.call(document.querySelectorAll('#screen-adj-panel [data-adj-group-mine]')).map(function(m){return m.style.display!=='none'?m.closest('[data-adj-group]').getAttribute('data-adj-group'):null;}).filter(Boolean);return {chat:w&&w.getAttribute('aria-pressed'),desk:d&&d.getAttribute('aria-pressed'),chatBg:w&&getComputedStyle(w).backgroundColor,mine:mine};})()");
check('B14 聊天页＝「聊天」页签反色高亮 + 聊天组打「你正在这一页」', segOnChat && segOnChat.chat === 'true' && segOnChat.desk === 'false' && segOnChat.chatBg === 'rgb(17, 17, 17)' && String(segOnChat.mine) === 'text', JSON.stringify(segOnChat));
// 回面板展开态看「桌面」
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');var m=p.querySelector('[data-adj-mini]');if(m&&m.style.display!=='none'){m.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));m.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));}return true;})()");
await sleep(300);
await evalJs("(function(){var b=document.querySelector('#screen-adj-panel [data-adj-goto=\"page-phone\"]');if(!b)return 'no-btn';b.click();return true;})()");
await sleep(700);
check('B10 「桌面」页签切回桌面页', (await evalJs("!document.getElementById('page-phone').hidden")) === true);
// #990：桌面页＝「桌面」页签高亮 + 桌面组打标记（与 B14 互为镜像，防「只在某一页对」）
const segOnDesk = await evalJs("(function(){var w=document.querySelector('#screen-adj-panel [data-adj-goto=\"page-phone\"]');var c=document.querySelector('#screen-adj-panel [data-adj-goto=\"chat\"]');var mine=[].slice.call(document.querySelectorAll('#screen-adj-panel [data-adj-group-mine]')).map(function(m){return m.style.display!=='none'?m.closest('[data-adj-group]').getAttribute('data-adj-group'):null;}).filter(Boolean);return {desk:w&&w.getAttribute('aria-pressed'),chat:c&&c.getAttribute('aria-pressed'),mine:mine};})()");
check('B15 桌面页＝「桌面」页签高亮 + 桌面组打标记（镜像）', segOnDesk && segOnDesk.desk === 'true' && segOnDesk.chat === 'false' && String(segOnDesk.mine) === 'desk', JSON.stringify(segOnDesk));
// 聊天侧入口（#982 起从「更多 → 工具」搬到「聊天设置 → 美化」；面板节点先外部摘掉：
// 顺带验「节点没了入口仍能重建」＝防 zombie 面板）
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(p)p.remove();return true;})()");
await sleep(200);
await evalJs("window.enterChat && window.enterChat(); true");
await sleep(1200);
const moreOpened = await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(!b)return 'no-more-btn';b.click();return !document.getElementById('chat-more-panel').hidden;})()");
check('B11 聊天「更多」可打开', moreOpened === true, String(moreOpened));
check('B12 聊天「更多」面板里已无屏幕适配入口（回流＝用户「为什么放在更多功能的工具里」原话复发）', (await evalJs("document.getElementById('more-screen-adj')===null")) === true);
await evalJs("(function(){var p=document.getElementById('chat-more-panel');if(p)p.hidden=true;var b=document.getElementById('chat-settings-btn');if(b)b.click();return true;})()");
await sleep(700);
check('B12b 聊天设置页可打开（入口挂在它里面）', (await evalJs("(function(){var pg=document.getElementById('page-chat-settings');return !!pg && !pg.hidden;})()")) === true);
const entryInChatSet = await evalJs("(function(){var e=document.getElementById('cs-screen-adj');if(!e)return 'no-entry';var vis=e.offsetParent!==null;e.click();return {panel:!!document.getElementById('screen-adj-panel'),vis:vis};})()");
check('B12c 聊天设置→美化→屏幕适配 点行开面板（行可见 + 节点被摘掉也能重建）', !!(entryInChatSet && entryInChatSet.panel && entryInChatSet.vis), JSON.stringify(entryInChatSet));
await sleep(300);
// 装修栏入口接线（按钮在装修栏里，此处直接验接线可用）
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(p)p.remove();var bar=document.getElementById('decor-bar');if(bar)bar.hidden=false;return true;})()");
await sleep(200);
const decorRes = await evalJs("(function(){var e=document.getElementById('decor-fit');if(!e)return 'no-entry';e.click();return !!document.getElementById('screen-adj-panel');})()");
check('B13 装修栏「屏幕适配」开面板', decorRes === true, String(decorRes));
// #990：面板结构（分组＝「哪根滑杆管哪一页」、拖动说明可读、七轴一根不少）
// 先在桌面页读分组顺序与轴顺序
const structDesk = await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return 'no-panel';return {groups:[].slice.call(p.querySelectorAll('[data-adj-group]')).map(function(h){return h.getAttribute('data-adj-group');}),heads:[].slice.call(p.querySelectorAll('[data-adj-group]')).map(function(h){return h.textContent.replace(/你正在这一页/,'').trim().slice(0,18);}),axes:[].slice.call(p.querySelectorAll('[data-adj-slider]')).map(function(s){return s.getAttribute('data-adj-slider');}),vals:p.querySelectorAll('[data-adj-val]').length};})()");
// 红侧面板结构不存在时 structDesk 是字符串，下列断言必须整体判红而不是抛异常（否则脚本半途死掉）
const sd = (structDesk && typeof structDesk === 'object') ? structDesk : null;
check('B16 三组滑杆齐全且顺序＝通用→桌面→聊天（防分组重排漏轴）', !!sd && String(sd.groups) === 'pos,desk,text' && String(sd.axes) === 'top,bottom,h,shift,side,desk,text' && sd.vals === 7, JSON.stringify(structDesk));
check('B17 组标题写明生效页面（只影响桌面页 / 只影响聊天页正文文字）', !!sd && sd.heads.length === 3 && sd.heads[0].indexOf('通用位置轴') === 0 && sd.heads[1] === '只影响「桌面页」' && sd.heads[2].indexOf('只影响「聊天页」正文文字') === 0, JSON.stringify(sd && sd.heads));
// 拖动说明：用户原话「拖标题行可上移…没有写清楚」——必须完整可读（不被右侧按钮挤成省略号）
const dragInfo = await evalJs("(function(){var h=document.querySelector('#screen-adj-panel [data-adj-draghint]');if(!h)return 'no-hint';return {t:h.textContent,clip:h.scrollWidth>h.clientWidth+1,w:h.clientWidth};})()");
check('B18 标题行拖动说明完整可读（不截断）', !!dragInfo && dragInfo.t === '按住这行标题上下拖＝把面板挪开' && dragInfo.clip === false, JSON.stringify(dragInfo));
const usageInfo = await evalJs("(function(){var u=document.querySelector('#screen-adj-panel [data-adj-usage]');return u?u.textContent:'none';})()");
check('B19 用法段讲清「切页」与「三组滑杆」（删＝用户又不知道点哪个）', String(usageInfo).indexOf('点「正在调」旁边那一枚页签') >= 0 && String(usageInfo).indexOf('你正在这一页') >= 0 && String(usageInfo).indexOf('双击滑杆回默认 0') >= 0, String(usageInfo).slice(0, 60));
// 设置页（最常见的开面板现场）：两枚页签都不高亮，说明行必须直说点哪一枚
await evalJs("document.querySelector('.tab[data-page=\"page-setting\"]').click(); true");
await sleep(500);
const segOnSet = await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return 'no-panel';var d=p.querySelector('[data-adj-goto=\"page-phone\"]'),c=p.querySelector('[data-adj-goto=\"chat\"]');return {ctx:(p.querySelector('[data-adj-ctx]')||{}).textContent,desk:d?d.getAttribute('aria-pressed'):'no-btn',chat:c?c.getAttribute('aria-pressed'):'no-btn',hint:(p.querySelector('[data-adj-ctxhint]')||{}).textContent,mine:[].slice.call(p.querySelectorAll('[data-adj-group-mine]')).filter(function(m){return m.style.display!=='none';}).length};})()");
check('B20 设置页：两枚页签都不高亮 + 说明行直说点哪一枚（该点哪个的兜底）', !!segOnSet && segOnSet.ctx === '正在调：设置' && segOnSet.desk === 'false' && segOnSet.chat === 'false' && segOnSet.mine === 0 && String(segOnSet.hint).indexOf('当前不在桌面/聊天页') === 0, JSON.stringify(segOnSet));

console.log('[C] 防修过头（两侧同过）');
await evalJs("document.getElementById('row-screen-adj').click(); true"); // 统一从设置入口重开面板
await sleep(500);
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return false;var s=p.querySelector('[data-adj-slider=\"top\"]');if(!s)return 'no-slider';s.value='12';s.dispatchEvent(new Event('input',{bubbles:true}));return localStorage.getItem('xy-home-v2:screen-adj-top');})()");
await sleep(200);
check('C1 滑杆仍落 LS（本地永久保存语义不变）', (await evalJs("localStorage.getItem('xy-home-v2:screen-adj-top')")) === '12');
check('C2 全部恢复默认仍归零', (await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return false;var b=[].slice.call(p.querySelectorAll('button')).filter(function(x){return x.textContent.indexOf('全部恢复默认')===0;});if(!b.length)return 'no-btn';b[0].click();return window.mochiScreenAdj.all().top===0 && !localStorage.getItem('xy-home-v2:screen-adj-top');})()")) === true);
check('C3 返回键清单仍含面板（tabs.js）', srcTabs.includes("'screen-adj-panel'];"));

check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' || '));

console.log('\n结果：' + pass + '/' + (pass + fail) + (fail ? ' 失败 ' + fail : ' 全绿'));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
