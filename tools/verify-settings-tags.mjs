// #525→#805→#927 设置页 tag 分类行为验证（无头 Chrome，测构建产物 index.html）
// 立项：用户反馈「清除本地数据的功能应该也放在设置的【工具】tag 里啊，设置的 tag 分类有问题，不正常」
//   → #525 把 #row-reset 自「关于」段移入「工具」段末项。
// #805（2026-09-19 用户直派）：「导入全量数据和导出全量数据、清除本地数据应该放在通用的分类里，
//   其他分类太靠后，不方便用户知道还有这个功能」→ 三件套（row-export / row-import / row-reset）
//   自「工具」段移入「通用」段：导出/导入成组置联系人组之后，清除本地数据独立成组置段末。
//   （#805 曾被并行旧缓冲打回工作树，2026-09-20 随 #927 重放——本脚本 S2/S3b/S5/S6 即那批的守卫。）
// #927（2026-09-20 用户直派）：「设置里的全屏模式也要放在最前面一个独立显的地方，并且小字说明
//   手机端切后台会自动退出全屏，这个是设备限制不是 bug」＋「聊天设置那份全屏开关保留、提到顶部」
//   → ①#sf-fullscreen 自「系统」段提到「通用」段首位独立成组，行下 #sf-fullscreen-sub 首条写设备限制；
//      ②聊天设置「功能」页的全屏组提到页顶、不带 data-tag 故不参与二级标签过滤（三个二级标签下都常显）。
// 判别器：①src 静态——row-reset / row-export / row-import / sf-fullscreen-row 都在 basic 段内、
//   不在 tools/about/system 段；聊天设置全屏组不带 data-tag；
//   ②产物行为——点「通用」tag 后各行可见、清除可点开确认弹窗；点「关于」tag 后该行隐藏；
//   ③五个 tag 互斥切换且任一时刻只有一个 them-sec 可见；
//   ④结构回归兜底——#page-setting 仍正确闭合（tabbar 未被吞）。
// 用法：node build.mjs && node tools/verify-settings-tags.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-settings-tags.mjs
//   该目录需含 index.html 与 src/template.html；静态与行为断言都读该根，可用来实证本脚本的判别力。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

// ===== 静态：src/template.html 的 tag 归属 =====
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const iBasic = tpl.indexOf('data-sec="basic"');
const iChat = tpl.indexOf('data-sec="chat"');
const iSystem = tpl.indexOf('data-sec="system"');
const iTools = tpl.indexOf('data-sec="tools"');
const iDiagRaw = tpl.indexOf('data-sec="diag"');
const iAbout = tpl.indexOf('data-sec="about"');
// #961 新增 diag 段后 tools 段边界收到 diag 之前；纯 HEAD 无 diag 时回退 about（红基线仍可跑）
const iDiag = iDiagRaw > 0 ? iDiagRaw : iAbout;
const iVer = tpl.indexOf('<div class="ver">');
const basicSrc = tpl.slice(iBasic, iChat);
const systemSrc = tpl.slice(iSystem, iTools);
const toolsSrc = tpl.slice(iTools, iDiag);
const diagSrc = tpl.slice(iDiag, iAbout);
const aboutSrc = tpl.slice(iAbout, iVer);
ok(iBasic > 0 && iChat > iBasic && iTools > iChat && iAbout > iTools, 'S1 basic/chat/tools/about 四段存在且顺序正确');
ok(basicSrc.includes('id="row-reset"'), 'S2 清除本地数据(#row-reset) 落在 basic（通用）段内');
ok(!aboutSrc.includes('id="row-reset"'), 'S3 清除本地数据不在 about 段内');
ok(!toolsSrc.includes('id="row-reset"'), 'S3b 清除本地数据不在 tools 段内（#805 已移通用）');
ok(basicSrc.includes('id="row-export"') && basicSrc.includes('id="row-import"'), 'S5 导出数据/导入数据两行也落在 basic（通用）段内（#805）');
ok(!toolsSrc.includes('id="row-export"') && !toolsSrc.includes('id="row-import"'), 'S6 导出/导入不在 tools 段内（#805 已移通用）');

// ---- #961（重放 #957）「信息诊断」独立 tag：诊断/自测行归位、数据管理行留在「工具」 ----
const MOVED_IDS = ['row-diagnostics','row-screen-diag','row-func-diag','row-perf-check','row-perf-optimize','row-battery-check','row-heat-check','row-flash-check'];
ok(iDiagRaw > 0 && iDiag > iTools && iDiag < iAbout, 'S13 「信息诊断」段(data-sec=diag) 存在且排在 工具 与 关于 之间', 'iDiag=' + iDiagRaw);
ok(MOVED_IDS.every(function (id) { return diagSrc.includes('id="' + id + '"'); }), 'S14 诊断/自测行全部落在「信息诊断」段内', MOVED_IDS.filter(function (id) { return !diagSrc.includes('id="' + id + '"'); }).join(','));
ok(MOVED_IDS.every(function (id) { return !toolsSrc.includes('id="' + id + '"'); }), 'S15 这些行不再留在「工具」段（搬走＝不重复 id）', MOVED_IDS.filter(function (id) { return toolsSrc.includes('id="' + id + '"'); }).join(','));
ok(diagSrc.includes('id="safe-top-force"'), 'S16 顶部避让修正开关随诊断组搬入「信息诊断」段');
ok(toolsSrc.includes('id="row-storage-view"') && toolsSrc.includes('id="row-img-compress"'), 'S17 查看存储/压缩图片仍留「工具」段（数据管理面）');
ok(toolsSrc.includes('id="row-card-audit"') && toolsSrc.includes('id="row-screen-adj"'), 'S18 字卡自检/屏幕适配微调仍留「工具」段（#532/#764 口径不动）');
ok(diagSrc.includes('id="perf-help-sub"') && diagSrc.includes('id="heat-help-sub"'), 'S19 卡顿/发烫两条排查说明随自测行搬入「信息诊断」段');

// ---- #927 全屏模式：通用段首位独立成组 + 聊天设置功能页顶部常显 ----
ok(basicSrc.includes('id="sf-fullscreen-row"'), 'S7 全屏模式行(#sf-fullscreen-row) 落在 basic（通用）段内（#927）');
ok(basicSrc.indexOf('id="sf-fullscreen-row"') < basicSrc.indexOf('id="row-export"'), 'S7b 全屏行排在导出数据之前（用户口径「通用顶部，全屏下面是备份」）');
ok(basicSrc.includes('会自动退出全屏，这是设备限制、不是 bug'), 'S8 通用段全屏行小字写明「切后台自动退出＝设备限制、不是 bug」（#927 用户点名要写）');
ok(!systemSrc.includes('id="sf-fullscreen"') && !systemSrc.includes('id="sf-fullscreen-row"'), 'S9 系统段不再承载全屏开关（搬回＝两份开关/重复 id 复发）');
const csFuncSrc = tpl.slice(tpl.indexOf('data-sec="function"'), tpl.indexOf('id="cs-func-tags"'));
ok(csFuncSrc.includes('id="cs-fs-group"'), 'S10 聊天设置功能页顶部有全屏开关分组（提到页顶，不再埋在「显示」二级标签里）');
ok(!tpl.includes('id="cs-fs-group" data-tag'), 'S10b 该分组不带 data-tag（挂上就会被 #cs-func-tags 过滤埋回二级标签，切进去才看得见）');

const setTabsSrc = (function () {
  const i = tpl.indexOf('id="set-tabs"');
  if (i < 0) return '';
  const end = tpl.indexOf('</div>', tpl.indexOf('<div class="them-tab', i));
  return tpl.slice(i, tpl.indexOf('<!-- 通用：', i));
})();
const tabsSrc = setTabsSrc.match(/<div class="them-tab[^>]*data-tab="[^"]+"[^>]*>/g) || [];
ok(tabsSrc.length === 6, 'S4 设置页 #set-tabs 内 6 个 tag 存在', 'found=' + tabsSrc.length);

// ===== 行为：构建产物 index.html =====
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vst-' + Date.now()),
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
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);
// 进入设置页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});return true;})()");
await sleep(400);

// B1 五个 tag 文案（渲染后）
const tabs = J(await evalJs(`(function(){var out=[];document.querySelectorAll('#set-tabs .them-tab').forEach(function(t){out.push(t.dataset.tab+'='+t.textContent.trim());});return JSON.stringify(out);})()`));
const tabStr = (Array.isArray(tabs) ? tabs : []).join(',');
ok(tabStr === 'basic=通用,chat=聊天,system=系统,tools=工具,diag=信息诊断,about=关于', 'B1 六个 tag＝通用/聊天/系统/工具/信息诊断/关于', tabStr);

// B2 逐一点击 tag：恰好一个 them-sec 可见，且为该 tag 对应段
let mutexOk = true, mutexDetail = '';
for (const name of ['basic', 'chat', 'system', 'tools', 'diag', 'about']) {
  await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="${name}"]');if(t)t.click();return true;})()`);
  await sleep(160);
  const r = J(await evalJs(`(function(){var vis=[];document.querySelectorAll('#page-setting .them-sec').forEach(function(s){if(!s.hidden)vis.push(s.dataset.sec);});var act=document.querySelector('#set-tabs .them-tab.active');return JSON.stringify({vis:vis,act:act?act.dataset.tab:null});})()`));
  if (!(r.vis && r.vis.length === 1 && r.vis[0] === name && r.act === name)) { mutexOk = false; mutexDetail += name + '→' + JSON.stringify(r) + ' '; }
}
ok(mutexOk, 'B2 六个 tag 互斥切换（任一时刻仅对应段可见且高亮）', mutexDetail);

// B3 数据备份三行的 tag 归属（DOM 祖先）：#805 后都应属 basic（通用）
const anc = J(await evalJs(`(function(){function w(id){var r=document.getElementById(id);if(!r)return null;var s=r.closest('.them-sec');return s?s.dataset.sec:null;}return JSON.stringify({reset:w('row-reset'),exp:w('row-export'),imp:w('row-import')});})()`));
ok(anc.reset === 'basic', 'B3 清除本地数据祖先 data-sec=basic（#805 移通用）', JSON.stringify(anc));
ok(anc.exp === 'basic' && anc.imp === 'basic', 'B3b 导出数据/导入数据祖先 data-sec=basic（#805 移通用）', JSON.stringify(anc));
ok(anc.reset !== 'about' && anc.reset !== 'tools', 'B4 清除本地数据不再属于【关于】/【工具】段', JSON.stringify(anc));

// B5 切到「通用」：该行可见、几何非零
await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="basic"]');if(t)t.click();return true;})()`);
await sleep(220);
const geo = J(await evalJs(`(function(){var r=document.getElementById('row-reset');if(!r)return JSON.stringify({found:false});var b=r.getBoundingClientRect();return JSON.stringify({found:true,vis:(r.offsetParent!==null),h:Math.round(b.height),w:Math.round(b.width),txt:r.querySelector('.txt')?r.querySelector('.txt').textContent.trim():''});})()`));
ok(geo.found === true && geo.vis === true && geo.h > 0 && geo.w > 0, 'B5 「通用」tag 下该行可见且几何非零', JSON.stringify(geo));
const geo3 = J(await evalJs(`(function(){function v(id){var r=document.getElementById(id);return r?(r.offsetParent!==null):false;}return JSON.stringify({exp:v('row-export'),imp:v('row-import')});})()`));
ok(geo3.exp === true && geo3.imp === true, 'B5b 「通用」tag 下导出/导入两行可见', JSON.stringify(geo3));
ok((geo.txt || '').indexOf('清除本地数据') >= 0, 'B6 该行文案＝清除本地数据', geo.txt);

// B7 点击该行弹出确认弹窗（清除入口真的通了，不只是搬了个位置）
await evalJs(`(function(){var r=document.getElementById('row-reset');if(r)r.click();return true;})()`);
await sleep(400);
const mdl = J(await evalJs(`(function(){var m=document.getElementById('modal-mask');var t=document.getElementById('modal-title');return JSON.stringify({open:!!m&&!m.hidden,title:t?t.textContent.trim():''});})()`));
ok(mdl.open === true && (mdl.title || '').indexOf('清除') >= 0, 'B7 点该行弹出「确认清除所有本地数据」弹窗', JSON.stringify(mdl));
// 关掉弹窗（取消），避免残留
await evalJs(`(function(){var c=document.getElementById('modal-cancel');if(c)c.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()`);
await sleep(200);

// B8 切到「关于」：该行随 tools 段隐藏（不该在关于里再现）
await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="about"]');if(t)t.click();return true;})()`);
await sleep(220);
const aboutState = J(await evalJs(`(function(){var r=document.getElementById('row-reset');var a=document.getElementById('row-about');return JSON.stringify({resetVisible:r?r.offsetParent!==null:false,aboutVisible:a?a.offsetParent!==null:false,aboutTxt:a&&a.querySelector('.txt')?a.querySelector('.txt').textContent.trim():''});})()`));
ok(aboutState.aboutVisible === true && aboutState.resetVisible === false, 'B8 【关于】tag 只剩功能介绍、清除本地数据已不在此处', JSON.stringify(aboutState));

// B9 结构兜底：#page-setting 正确闭合，tabbar 未被吞进设置页（#519/#520 同族回归）
const nest = J(await evalJs(`(function(){var tb=document.querySelector('.tabbar');var st=document.getElementById('page-setting');return JSON.stringify({tabbarInSetting:!!(tb&&st&&st.contains(tb)),tabbarParent:tb&&tb.parentElement?(tb.parentElement.className||tb.parentElement.id):null});})()`));
ok(nest.tabbarInSetting === false, 'B9 #page-setting 已正确闭合（tabbar 未被吞进设置页）', JSON.stringify(nest));

// B15 #961 「信息诊断」tag：诊断行可见、工具段数据行隐藏
await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="diag"]');if(t)t.click();return true;})()`);
await sleep(220);
const dState = J(await evalJs(`(function(){function v(id){var r=document.getElementById(id);return r?(r.offsetParent!==null):null;}function s(id){var r=document.getElementById(id);return r&&r.closest('.them-sec')?r.closest('.them-sec').dataset.sec:null;}return JSON.stringify({diagRow:v('row-diagnostics'),perfRow:v('row-perf-check'),flashRow:v('row-flash-check'),storageRow:v('row-storage-view'),imgRow:v('row-img-compress'),diagSec:s('row-diagnostics'),perfSec:s('row-perf-check')});})()`));
ok(dState.diagRow === true && dState.perfRow === true && dState.flashRow === true && dState.diagSec === 'diag' && dState.perfSec === 'diag', 'B15 点「信息诊断」tag＝诊断/自测行可见且祖先段＝diag', JSON.stringify(dState));
ok(dState.storageRow === false && dState.imgRow === false, 'B16 同 tag 下「查看存储/压缩图片」隐藏（仍在「工具」段，不在本 tag 再现）', JSON.stringify(dState));

// B17 切回「工具」tag：数据行可见、诊断行隐藏（两 tag 互斥、无重复入口）
await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="tools"]');if(t)t.click();return true;})()`);
await sleep(220);
const tState = J(await evalJs(`(function(){function v(id){var r=document.getElementById(id);return r?(r.offsetParent!==null):null;}function s(id){var r=document.getElementById(id);return r&&r.closest('.them-sec')?r.closest('.them-sec').dataset.sec:null;}return JSON.stringify({storageRow:v('row-storage-view'),imgRow:v('row-img-compress'),cardRow:v('row-card-audit'),diagRow:v('row-diagnostics'),storageSec:s('row-storage-view')});})()`));
ok(tState.storageRow === true && tState.imgRow === true && tState.cardRow === true && tState.storageSec === 'tools', 'B17 「工具」tag 仍留数据管理与自检行（查看存储/压缩图片/字卡自检）', JSON.stringify(tState));
ok(tState.diagRow === false, 'B18 「工具」tag 下诊断行已隐藏（无重复入口）', JSON.stringify(tState));

// ===== B10~B14 #927 全屏模式：通用段首位 + 聊天设置功能页顶部常显 =====
// B10 切回「通用」：全屏行可见、是通用段第一组的第一行、且排在导出数据之前
await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="basic"]');if(t)t.click();return true;})()`);
await sleep(220);
const fsRow = J(await evalJs(`(function(){
  var sec=document.querySelector('#page-setting .them-sec[data-sec="basic"]');
  var r=document.getElementById('sf-fullscreen-row');
  if(!sec||!r) return JSON.stringify({found:false});
  var b=r.getBoundingClientRect();
  var exp=document.getElementById('row-export');
  var sub=document.getElementById('sf-fullscreen-sub');
  return JSON.stringify({
    found:true, vis:(r.offsetParent!==null), h:Math.round(b.height),
    firstGroup:(sec.querySelector('.set-group')===r.closest('.set-group')),
    beforeExport:!!exp && !!(r.compareDocumentPosition(exp) & Node.DOCUMENT_POSITION_FOLLOWING),
    hasToggle:!!document.getElementById('sf-fullscreen'),
    sub:sub?sub.textContent.replace(/\\s+/g,''):'',
    secOfRow:(r.closest('.them-sec')||{}).dataset ? r.closest('.them-sec').dataset.sec : null
  });
})()`));
ok(fsRow.found === true && fsRow.vis === true && fsRow.h > 0 && fsRow.secOfRow === 'basic' && fsRow.hasToggle === true, 'B10 「通用」tag 下全屏行可见、祖先段＝basic、开关在位', JSON.stringify(fsRow));
ok(fsRow.firstGroup === true && fsRow.beforeExport === true, 'B10b 全屏行是通用段首位独立组、且排在导出数据之前（用户：最前面一个独立显的地方／全屏下面是备份）', JSON.stringify({ firstGroup: fsRow.firstGroup, beforeExport: fsRow.beforeExport }));
const subTxt = typeof fsRow.sub === 'string' ? fsRow.sub : '';
ok(subTxt.indexOf('设备限制') >= 0 && subTxt.indexOf('不是bug') >= 0 && subTxt.indexOf('自动退出全屏') >= 0, 'B11 行下小字写明「切后台自动退出全屏＝设备限制、不是 bug」（用户点名要写）', subTxt.slice(0, 60));

// B12 切到「系统」tag：全屏行随 basic 段隐藏（系统段不再有第二份开关）
await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="system"]');if(t)t.click();return true;})()`);
await sleep(220);
const sysState = J(await evalJs(`(function(){var r=document.getElementById('sf-fullscreen-row');var sec=document.getElementById('page-setting').querySelector('.them-sec[data-sec="system"]');return JSON.stringify({rowVisible:r?r.offsetParent!==null:null,rowInSystemSec:!!(sec&&r&&sec.contains(r)),sysHasFullscreenInput:!!(sec&&sec.querySelector('#sf-fullscreen'))});})()`));
ok(sysState.rowVisible === false && sysState.rowInSystemSec === false && sysState.sysHasFullscreenInput === false, 'B12 【系统】tag 下不再有全屏开关（已搬走、不留第二份，重复 id 即两页状态打架）', JSON.stringify(sysState));

// B13 聊天设置「功能」页：三个二级标签下顶部全屏行一律可见（原埋在「显示」里，切到形象/消息就找不到）
await evalJs(`(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat-settings');});var t=document.querySelector('#cs-tabs .them-tab[data-tab="function"]');if(t)t.click();return true;})()`);
await sleep(320);
let csVisOk = true, csVisDetail = '';
for (const ft of ['profile', 'msg', 'ui']) {
  await evalJs(`(function(){var t=document.querySelector('#cs-func-tags .them-tab[data-ft="${ft}"]');if(t)t.click();return true;})()`);
  await sleep(180);
  const r = J(await evalJs(`(function(){var row=document.getElementById('cs-fullscreen-row');var g=document.getElementById('cs-fs-group');if(!row)return JSON.stringify({found:false});var b=row.getBoundingClientRect();return JSON.stringify({found:true,vis:(row.offsetParent!==null),h:Math.round(b.height),grpHidden:(g?!!g.hidden:null),secOf:(row.closest('.them-sec')||{}).dataset?row.closest('.them-sec').dataset.sec:null});})()`));
  if (!(r.found === true && r.vis === true && r.h > 0 && r.grpHidden === false && r.secOf === 'function')) { csVisOk = false; csVisDetail += ft + '→' + JSON.stringify(r) + ' '; }
}
ok(csVisOk, 'B13 聊天设置功能页顶部全屏行在「形象/消息/显示」三个二级标签下都常显（不被分组过滤埋掉）', csVisDetail);
// 复位二级标签到默认（形象），避免影响后续
await evalJs(`(function(){var t=document.querySelector('#cs-func-tags .them-tab[data-ft="profile"]');if(t)t.click();return true;})()`);
await sleep(150);

// B14 两份开关＝同一状态（聊天设置那份只是镜像；搬位置后仍成立）
const mir = J(await evalJs(`(function(){
  var cs=document.getElementById('cs-fullscreen'), sf=document.getElementById('sf-fullscreen');
  if(!cs||!sf) return JSON.stringify({found:false});
  var orig=sf.checked;
  cs.checked=!orig; cs.dispatchEvent(new Event('change',{bubbles:true}));
  var flipped=(sf.checked===cs.checked);
  cs.checked=orig; cs.dispatchEvent(new Event('change',{bubbles:true}));
  return JSON.stringify({found:true, flipped:flipped, restored:(sf.checked===orig), same:(sf.checked===cs.checked)});
})()`));
await sleep(800);
ok(mir.found === true && mir.flipped === true && mir.restored === true && mir.same === true, 'B14 聊天设置全屏开关仍镜像设置页通用段那份（同一状态、切回原值无副作用）', JSON.stringify(mir));

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 设置页 tag 分类验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
