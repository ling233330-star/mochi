// ===== #606 设置「关于」tag 分类验证（无头 Chrome，自组装 src，不依赖仓库产物） =====
// 立项：用户 2026-09-16 问「设置的【关于】tag 里还能写什么、和什么分类放进来」→ 采纳
//   「拆成多个分类分组入口」：关于段 = 应用信息 / 帮助与支持 / 隐私与法律 / 联系与反馈；
//   使用说明（#row-guide）与新手引导（#row-guidebook）移入「帮助与支持」；
//   新增 版本与更新 / 开源与致谢 / 隐私与数据安全 / 联系作者 四个只读入口（openModal）。
//   #792（2026-09-18 用户直派）扩：关于段顶部新增 #about-storage-note 警示条 + 首位新分组
//   「数据与存储（重要）」5 个只读行（自动清数据/存储权限/无痕模式/备份恢复/是不是bug自查，
//   弹窗文案在 personalize.js initAboutInfo，短版在 settings-help.js）——分组 5→6、行 12→17。
// 断言：①src 静态——四分类标题/四个新行 id/功能大全收录/哨兵登记；②行为——分类归属、六个入口
//   顺序、版本号注入、四个弹窗标题、使用说明进出页、功能说明胶囊。
// 用法：node tools/verify-about-cat.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

// ===== 静态：src =====
const tpl = readSrc('template.html');
const onboard = readSrc('js/onboarding.js');
const shelp = readSrc('js/settings-help.js');
const fhub = readSrc('js/feature-hub.js');
ok(tpl.includes('gs-title">数据与存储（重要）') && tpl.includes('gs-title">应用信息') && tpl.includes('gs-title">帮助与支持') && tpl.includes('gs-title">常见问题') && tpl.includes('gs-title">隐私与法律') && tpl.includes('gs-title">联系与反馈'), 'S1 关于段六个分类标题在 template.html');
ok(tpl.includes('id="row-changelog"') && tpl.includes('id="row-opensource"') && tpl.includes('id="row-privacy"') && tpl.includes('id="row-contact"'), 'S2 四个新只读行在 template.html');
ok(tpl.includes('id="row-faq-app"') && tpl.includes('id="row-faq-preset"'), 'S2b 常见问题 5 行在 template.html');
ok(['row-faq-noacct', 'row-faq-twostore', 'row-faq-notify'].every((k) => tpl.includes('id="' + k + '"')), 'S2d #961 常见问题新增三行（没有账号 / 两套存储 / 收不到通知）在 template.html');
ok(readSrc('js/personalize.js').includes("bind('row-faq-noacct'") && readSrc('js/personalize.js').includes("bind('row-faq-twostore'") && readSrc('js/personalize.js').includes("bind('row-faq-notify'"), 'S2e #961 三条 FAQ 弹窗接线在 personalize.js');
ok(tpl.includes('id="about-storage-note"') && ['lose', 'perm', 'incog', 'backup', 'bug'].every((k) => tpl.includes('id="row-faq-st-' + k + '"')), 'S2c #792 数据与存储必读：警示条 + 5 行在 template.html');
ok(onboard.includes("guideRow.closest('.set-group')"), 'S3 新手引导挂载改为含 #row-guide 的分组（onboarding.js）');
ok(shelp.includes("sel: '#row-guidebook'"), 'S4 新手引导登记了功能说明（settings-help.js）');
ok(fhub.includes("go: ['#row-changelog']") && fhub.includes("go: ['#row-privacy']"), 'S5 功能大全收录关于段新入口（feature-hub.js）');

// ===== 行为：自组装页 =====
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'settings-help.js', 'onboarding.js'];
let html = tpl;
const styles = cssFiles.map((f) => readSrc('css/' + f)).join('\n');
const scripts = jsFiles.map((f) => '(function () { try {\n' + readSrc('js/' + f) + '\n} catch (__e) {} })();').join('\n');
html = html.replace('/*__STYLES__*/', styles).replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v3.26.x-vat');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    if (req.url === '/' || req.url.split('?')[0] === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(tmpdir(), 'mochi-vat-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
let jsErr = 0;
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { jsErr++; console.log('  JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
await sleep(700);
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});var t=document.querySelector('#set-tabs .them-tab[data-tab=\"about\"]');if(t)t.click();return true;})()");
await sleep(400);

const info = J(await ev(`(function(){
  var sec=document.querySelector('.them-sec[data-sec="about"]');
  var titles=[].map.call(sec.querySelectorAll('.gs-title'),function(t){return t.textContent.trim();});
  var ids=[].map.call(sec.querySelectorAll('.set-row'),function(r){return r.id;});
  var guide=document.getElementById('row-guide'); var gb=document.getElementById('row-guidebook');
  return JSON.stringify({titles:titles,ids:ids,guidesec:guide?guide.closest('.them-sec').dataset.sec:null,gbsec:gb?gb.closest('.them-sec').dataset.sec:null,gbgrp:gb?(gb.closest('.set-group').querySelector('.gs-title')||{}).textContent:'',groups:sec.querySelectorAll('.set-group').length});
})()`));
ok(JSON.stringify(info.titles) === JSON.stringify(['数据与存储（重要）', '应用信息', '帮助与支持', '常见问题', '隐私与法律', '联系与反馈']), 'B1 关于段六个分类标题正确', JSON.stringify(info.titles));
ok(JSON.stringify(info.ids) === JSON.stringify(['row-faq-st-lose', 'row-faq-st-perm', 'row-faq-st-incog', 'row-faq-st-backup', 'row-faq-st-bug', 'row-about', 'row-changelog', 'row-opensource', 'row-guide', 'row-guidebook', 'row-faq-app', 'row-faq-app2', 'row-faq-addcard', 'row-faq-fullscreen', 'row-faq-preset', 'row-faq-noacct', 'row-faq-twostore', 'row-faq-notify', 'row-privacy', 'row-contact']), 'B2 二十个入口行顺序正确', JSON.stringify(info.ids));
ok(info.guidesec === 'about' && info.gbsec === 'about', 'B3 使用说明与新手引导都在关于段', info.guidesec + '/' + info.gbsec);
ok((info.gbgrp || '').trim() === '帮助与支持', 'B4 新手引导与使用说明同组（帮助与支持）', info.gbgrp);
ok(info.groups === 6, 'B5 关于段六个 set-group', String(info.groups));

const toolsHas = await ev("(function(){var s=document.querySelector('.them-sec[data-sec=\\'tools\\']');return !!(s&&(s.querySelector('#row-guide')||s.querySelector('#row-guidebook')));})()");
ok(toolsHas === false, 'B6 工具段已无使用说明 / 新手引导');

const ver = await ev("(function(){var e=document.getElementById('about-ver-val');return e?e.textContent.trim():null;})()");
ok(ver === 'v3.26.x-vat', 'B7 版本行显示构建版本', String(ver));

for (const [id, expect, label] of [['row-faq-st-lose', '数据为什么会自己没', '数据为什么会自己没'], ['row-faq-st-perm', '存储权限', '存储权限'], ['row-faq-st-incog', '无痕模式', '无痕模式'], ['row-faq-st-backup', '备份', '备份与恢复'], ['row-faq-st-bug', '怎么判断是不是 bug', '是不是bug'], ['row-changelog', '版本与更新', '版本与更新'], ['row-privacy', '隐私与数据安全', '隐私与数据安全'], ['row-contact', '联系作者', '联系作者'], ['row-faq-app', '会不会做成 App', '会不会做成App'], ['row-faq-app2', '自己转 App', '自己转App'], ['row-faq-addcard', '怎么添加字卡', '怎么添加字卡'], ['row-faq-fullscreen', '全屏模式失效', '全屏模式失效'], ['row-faq-preset', '系统预设字卡与功能设置', '系统预设字卡与功能设置'], ['row-faq-noacct', '没有账号', '没有账号不同步'], ['row-faq-twostore', '两份数据', '两套存储'], ['row-faq-notify', '收不到消息', '收不到通知']]) {
  await ev(`(function(){var r=document.getElementById('${id}');if(r)r.click();return true;})()`);
  await sleep(250);
  const m = J(await ev("(function(){var m=document.getElementById('modal-mask');var t=document.getElementById('modal-title');return JSON.stringify({open:!!m&&!m.hidden,title:t?t.textContent.trim():''});})()"));
  ok(m.open === true && (m.title || '').indexOf(expect) >= 0, 'B8 ' + id + ' 弹出「' + label + '」弹窗', JSON.stringify(m));
  await ev("(function(){var c=document.getElementById('modal-cancel');if(c)c.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(150);
}

// #620 后 row-opensource 不再弹窗，改为直接打开功能介绍页（#page-about 单一出处）——按导航行为断言
//（原 B8 仍按弹窗断言＝存量红，与本批 #792 无关，2026-09-18 改指）
await ev("(function(){var r=document.getElementById('row-opensource');if(r)r.click();return true;})()");
await sleep(300);
ok((await ev("(function(){var p=document.getElementById('page-about');return p?!p.hidden:false;})()")) === true, 'B8b row-opensource 打开功能介绍页（#620 后为导航非弹窗）');
await ev("(function(){var b=document.getElementById('about-back');if(b)b.click();return true;})()");
await sleep(250);

await ev("(function(){var r=document.getElementById('row-guide');if(r)r.click();return true;})()");
await sleep(300);
ok((await ev("(function(){var p=document.getElementById('page-guide');return p?!p.hidden:false;})()")) === true, 'B9 使用说明行打开说明页');
await ev("(function(){var b=document.getElementById('guide-back');if(b)b.click();return true;})()");
await sleep(250);
ok((await ev("(function(){var p=document.getElementById('page-setting');return p?!p.hidden:false;})()")) === true, 'B10 使用说明返回设置页');

// 新手引导行点击可唤起引导层
await ev("(function(){var r=document.getElementById('row-guidebook');if(r)r.click();return true;})()");
await sleep(400);
ok((await ev("(function(){var m=document.querySelector('.mg-guide-mask');return m?!m.hidden:false;})()")) === true, 'B11 新手引导点击唤起引导层');
await ev("(function(){var m=document.querySelector('.mg-guide-mask');if(m){m.hidden=true;m.style.display='none';}return true;})()");

const tags = J(await ev(`(function(){var out={};['row-faq-st-lose','row-changelog','row-opensource','row-privacy','row-contact','row-guidebook','row-faq-app','row-faq-preset'].forEach(function(id){var r=document.getElementById(id);out[id]=!!(r&&r.querySelector('[data-setdesc]'));});return JSON.stringify(out);})()`));
ok(tags['row-changelog'] && tags['row-opensource'] && tags['row-privacy'] && tags['row-contact'] && tags['row-guidebook'] && tags['row-faq-app'] && tags['row-faq-preset'] && tags['row-faq-st-lose'], 'B12 各处（含新手引导 / 常见问题 / 数据与存储）都注入「功能说明」胶囊', JSON.stringify(tags));

ok(jsErr === 0, 'B13 全程无 JS 异常', 'jsErr=' + jsErr);

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #606/#611 关于分类验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
