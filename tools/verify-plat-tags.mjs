// ===== 设置页「本机能不能用」标记验证（#964 立项 → #978 口径重写）=====
// 沿革：用户 2026-09-21 先问「设置有很多 iOS 和安卓的专属功能，需要给两个平台分开专门加一个
//   分类吗？」→ 结论：不分类，改行级标记（#964：静态平台胶囊 + 非本机平台给替代入口）。随后
//   用户连点两处：「后台通知行右的『仅安卓』有误导性」「仅 ios 也是误导标识」。
// #978 实测结论：那三条胶囊的真实前提没有一条是「手机系统」——
//   后台通知     = Chromium 内核 + https + 通知权限（电脑版 Chrome / Edge 同样可用；而小米 /
//                  vivo / OPPO 自带、UC、夸克、Via 这些安卓壳本机没有 Notification 对象）
//   离线消息提醒 = Chromium 内核（PeriodicSyncManager）+ 添加到主屏幕（电脑版 Chrome 也可）
//   顶部避让修正 = 添加到主屏幕的独立应用形态 + 用户自己声明形态（执行器 forceCover 的 standalone
//                  就是 ios-pwa-standalone 类，只在 iOS 独立应用形态加；iPhone 用 Safari 直接
//                  打开时这个开关是空的）
//   静态标平台两个方向都错：桌面 Chromium 用户被「仅安卓」劝退（其实能用），iPhone 浏览器形态
//   用户被「仅 iPhone」叫去开一个空开关。
// #978 改法：撤掉全部静态胶囊，改为按本机实测条件标记——不满足条件才变灰 + 给替代入口（提示插在
//   该行紧后面，不再被六百字说明压在底下），满足条件不加任何标记；只变灰、绝不 disabled 开关。
// 断言：S 静态锚 / B1~B4 iPhone UA / B5~B8 安卓 UA / B9~B11 桌面（关键：一行都不许标）/
//   B12~B13 无通知能力内核（注入删掉 Notification）/ B14 功能说明胶囊未被挡 / B15 搜索别名 /
//   Z1 零异常。
// 用法：node tools/verify-plat-tags.mjs
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

const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; OPPO K13x) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ===== 静态：src =====
const tpl = readSrc('template.html');
const css = readSrc('css/setting.css');
const pers = readSrc('js/personalize.js');
const shelp = readSrc('js/settings-help.js');
const bgk = readSrc('js/bg-keep.js');

ok(!/class="plat-tag"/.test(tpl) && !/data-plat=/.test(tpl), 'S1 静态平台胶囊已全部撤除（template.html 里再无 plat-tag / data-plat）');
ok(!css.includes('.plat-tag'), 'S2 胶囊样式退役（setting.css 里再无 .plat-tag）');
ok(css.includes('.set-row.plat-off .txt, .gs-row.plat-off > span { opacity:.6; }'), 'S3 变灰样式仍在（只变灰不 disabled）');
ok(pers.includes('function initUseMark()') && !pers.includes('initPlatTags'), 'S4 标记逻辑改为 initUseMark（按本机条件，不按平台）');
ok(pers.includes("if (!hasNotify()) return {") && pers.includes("'Notification' in window"), 'S4b 后台通知按「本机有没有通知能力」判定（不是按安卓）');
ok(pers.includes('if (isIosStandalone()) return null;') && pers.includes("contains('ios-pwa-standalone')"), 'S4c 顶部避让修正按「独立应用形态」判定（与执行器同一个类）');
ok(!/\.disabled\s*=\s*true/.test(pers.slice(pers.indexOf('function initUseMark()'), pers.indexOf('function initUseMark()') + 4200)), 'S4d 弱化不 disabled 开关（判定失手仍可用）');
ok(pers.includes('row.parentNode.insertBefore(hint, row.nextSibling);'), 'S4e 替代提示插在该行紧后面（不再被长说明压在底下）');
ok(pers.includes("'离线消息提醒': '通知 推送 通知提醒 新消息 安卓 电脑 主屏幕 iPhone Chrome Edge'"), 'S4f 撤胶囊后搜索别名补上（搜「安卓 / 电脑」仍能找到离线消息提醒行）');
ok(pers.includes('本机是 iPhone / iPad：网页拿不到系统通知'), 'S4g 替代文案不再写「本机是 iPhone」（iPad 也算 isIOS）');
// 测试按钮误诊修复（bg-keep.js 不参与本脚本的页面组装，按源文件断言）
ok(bgk.includes('if (!window.isSecureContext) {'), 'S5 测试按钮改为三分支：非安全上下文才说 HTTPS');
ok(!bgk.includes('原因：安卓 Chrome 必须 HTTPS 访问才有通知'), 'S5b 旧误诊文案「原因：安卓 Chrome 必须 HTTPS 访问才有通知」已撤除');
ok(bgk.includes('原因：本机浏览器没有通知能力'), 'S5c 安卓壳 / iPhone 走「本机浏览器没有通知能力」分支');
ok(!bgk.includes('iPhone 只能靠系统通知'), 'S6 离线提醒状态行不再对 iPhone 说「只能靠系统通知」（与同段口径矛盾）');
ok(!bgk.includes('请安装到主屏幕后由系统接管'), 'S6b 通知授权失败文案不再暗示「装到主屏幕就能拿到」');
ok(!shelp.includes('iOS 专用修正') && shelp.includes('独立应用（添加到主屏幕）形态专用修正'), 'S7 顶部避让修正胶囊口径＝独立应用形态（不再写 iOS 专用）');
ok(!tpl.includes('仅安卓 Chrome / Edge') && tpl.includes('仅安卓 / 电脑上的 Chrome、Edge'), 'S8 使用说明口径＝Chromium 内核（安卓 / 电脑），不再写「仅安卓」');
ok(tpl.includes('安卓或电脑上的 Chrome / Edge（Chromium 内核）且 https 打开'), 'S8b 后台弹窗行下必备项①已补「或电脑」');
ok(shelp.includes('【开启步骤（安卓 / 电脑）】'), 'S8c 后台通知胶囊开启步骤标题已改「安卓 / 电脑」');

// ===== 行为：自组装页 =====
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'settings-help.js', 'onboarding.js'];
let html = tpl;
const styles = cssFiles.map((f) => readSrc('css/' + f)).join('\n');
const scripts = jsFiles.map((f) => '(function () { try {\n' + readSrc('js/' + f) + '\n} catch (__e) {} })();').join('\n');
html = html.replace('/*__STYLES__*/', styles).replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v8.29-vpt');

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 9));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(tmpdir(), 'mochi-vpt-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

// 以指定 UA 重新加载 → 关开屏 → 打开设置页（每次都是干净现场）
let nav = 0;
async function bootAs(ua) {
  await cdp('Emulation.setUserAgentOverride', { userAgent: ua });
  nav++;
  await cdp('Page.navigate', { url: baseUrl + '/index.html?u=' + nav });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await ev("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
  await sleep(600);
  await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});var t=document.querySelector('#set-tabs .them-tab[data-tab=\"system\"]');if(t)t.click();return true;})()");
  await sleep(400);
  return J(await ev("(function(){var d=window.mochiDevice||{};return JSON.stringify({ios:!!d.isIOS,android:!!d.isAndroid,mobile:!!d.isMobile,notif:('Notification' in window)});})()"));
}

// 现场快照：两行的变灰 / 替代提示 / 开关可用性 / 功能说明胶囊 / 是否还有静态胶囊
const SNAP = `(function(){
  function rowOf(id){var e=document.getElementById(id);return e?(e.closest('.set-row,.gs-row')||e):null;}
  function hintOf(row){var n=row.nextElementSibling;return (n&&n.classList&&n.classList.contains('plat-hint'))?n:null;}
  function one(id){var r=rowOf(id);if(!r)return null;var h=hintOf(r);
    return {off:r.classList.contains('plat-off'),hint:h?h.textContent.trim():'',go:!!(h&&h.querySelector&&h.querySelector('.plat-go')),
      disabled:!!(r.querySelector('input[type=checkbox]')||{}).disabled,help:!!r.querySelector('[data-setdesc],#psync-help'),
      badge:(r.querySelector('.plat-tag')||{}).textContent||''};}
  return JSON.stringify({bg:one('bg-notify'),ps:one('psync-en'),st:one('safe-top-force'),
    badges:document.querySelectorAll('#page-setting .plat-tag').length,
    offRows:document.querySelectorAll('#page-setting .set-row.plat-off, #page-setting .gs-row.plat-off').length,
    hints:document.querySelectorAll('#page-setting .plat-hint').length});
})()`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== iPhone =====
console.log('— iPhone UA —');
const envIOS = await bootAs(UA_IOS);
ok(envIOS.ios === true && envIOS.android === false, 'B0 iPhone UA 被识别为 iOS', JSON.stringify(envIOS));
let s = J(await ev(SNAP));
ok(s.badges === 0, 'B1 设置页里已无任何静态平台胶囊', JSON.stringify(s.badges));
ok(s.bg && s.bg.off === true && s.ps && s.ps.off === false, 'B2 iPhone 上只把「后台通知」变灰（离线消息提醒的状态行本来就自述，不再重复标记）');
ok(s.st && s.st.off === true, 'B2b iPhone 浏览器形态下「顶部避让修正」也变灰（它只在独立应用形态生效）');
ok(s.bg && s.bg.go === true && /桌面消息弹窗/.test(s.bg.hint), 'B3a 后台通知行给出「桌面消息弹窗」替代指引 + 跳转', s.bg && s.bg.hint);
ok(s.st && s.st.go === true && /添加到主屏幕/.test(s.st.hint), 'B3b 顶部避让修正行给出「添加到主屏幕」真实前提 + 跳转', s.st && s.st.hint);
ok(s.bg && s.bg.disabled === false && s.st && s.st.disabled === false, 'B5 开关都没被 disabled（判定失手仍可用）');
ok(s.bg && s.bg.help === true && s.ps && s.ps.help === true && s.st && s.st.help === true, 'B6 三行的「功能说明」胶囊都还在', JSON.stringify([s.bg && s.bg.help, s.ps && s.ps.help, s.st && s.st.help]));

// 点「去开启」→ 落到「桌面消息弹窗」行并高亮
await ev("(function(){var h=document.querySelector('.plat-hint .plat-go');if(h)h.click();return true;})()");
await sleep(400);
const j1 = J(await ev("(function(){var r=document.getElementById('desk-msg-en');var rw=r?(r.closest('.set-row,.gs-row')||r):null;return JSON.stringify({flash:!!(rw&&rw.classList.contains('plat-flash')),vis:!!(rw&&!rw.closest('.them-sec').hidden)});})()"));
ok(j1.flash === true && j1.vis === true, 'B4 「去开启」跳到「桌面消息弹窗」行并高亮', JSON.stringify(j1));

// 替代提示必须紧跟在行后面（#978：原实现被六百字行下说明压在底下）
const adj = await ev("(function(){var r=document.getElementById('bg-notify').closest('.gs-row');var n=r.nextElementSibling;return !!(n&&n.classList&&n.classList.contains('plat-hint'));})()");
ok(adj === true, 'B7 替代提示紧跟在「后台通知」行之后（不再排在整段行下说明之后）');

// 撤掉胶囊后搜索别名兜住（搜「安卓」仍能命中离线消息提醒行）
const searched = await ev("(function(){var i=document.getElementById('set-search-input');i.value='安卓';i.dispatchEvent(new Event('input'));var r=document.getElementById('psync-en');var row=r.closest('.set-row');return row.style.display!=='none';})()");
ok(searched === true, 'B8 搜「安卓」仍能命中离线消息提醒行（KW 别名兜住，胶囊撤除不丢可搜性）');
await ev("(function(){var i=document.getElementById('set-search-input');i.value='';i.dispatchEvent(new Event('input'));return true;})()");
await sleep(250);

// ===== 安卓（Chromium）=====
console.log('— 安卓 UA（Chromium）—');
const envAnd = await bootAs(UA_ANDROID);
ok(envAnd.android === true && envAnd.ios === false && envAnd.notif === true, 'B0b 安卓 UA 被识别为 Android 且本机有通知能力', JSON.stringify(envAnd));
s = J(await ev(SNAP));
ok(s.bg && s.bg.off === false && s.bg.hint === '', 'B9 安卓 Chromium 上「后台通知」一行都不标（本机可用＝不加标记，这正是「仅安卓」胶囊的假阳性来源）');
ok(s.st && s.st.off === true, 'B10 安卓上「顶部避让修正」变灰');
ok(s.st && s.st.go === true && /屏幕适配微调/.test(s.st.hint), 'B10b 给出「屏幕适配微调」替代指引 + 跳转', s.st && s.st.hint);
ok(s.offRows === 1 && s.hints === 1, 'B10c 只标记了这一行（不误伤）', JSON.stringify({ off: s.offRows, hints: s.hints }));

// 点「去调整」→ 跨 tag 切到「工具」并落到「屏幕适配微调」行
await ev("(function(){var h=document.querySelector('.plat-hint .plat-go');if(h)h.click();return true;})()");
await sleep(500);
const j2 = J(await ev("(function(){var r=document.getElementById('row-screen-adj');var sec=document.querySelector('.them-sec[data-sec=\\'tools\\']');var tab=document.querySelector('#set-tabs .them-tab[data-tab=\\'tools\\']');return JSON.stringify({flash:!!(r&&r.classList.contains('plat-flash')),secVis:!!(sec&&!sec.hidden),tabActive:!!(tab&&tab.classList.contains('active'))});})()"));
ok(j2.flash === true && j2.secVis === true && j2.tabActive === true, 'B11 「去调整」跨 tag 切到工具段并高亮目标行', JSON.stringify(j2));

// ===== 桌面 / 判定不明（#978 关键面）=====
console.log('— 桌面 UA（关键：一行都不许标）—');
const envDesk = await bootAs(UA_DESKTOP);
ok(envDesk.ios === false && envDesk.android === false, 'B0c 桌面 UA 两个平台都不成立', JSON.stringify(envDesk));
s = J(await ev(SNAP));
ok(s.bg && s.bg.off === false && s.bg.badge === '', 'B12 桌面 Chromium 上「后台通知」不再被标成「仅安卓」（它本来就可用）', JSON.stringify(s.bg));
ok(s.offRows === 1 && s.hints === 1, 'B12b 桌面只标记「顶部避让修正」一行（形态不满足），后台通知不标', JSON.stringify({ off: s.offRows, hints: s.hints }));
ok(s.badges === 0, 'B12c 桌面也不显示任何静态平台胶囊');

// ===== 无通知能力的内核（注入删掉 Notification：模拟小米 / vivo / OPPO 自带、UC、夸克、Via）=====
console.log('— 安卓 UA + 无通知能力内核 —');
const inj = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'try{delete window.Notification;}catch(e){}try{delete window.PeriodicSyncManager;}catch(e2){}' });
const envNoN = await bootAs(UA_ANDROID);
s = J(await ev(SNAP));
ok(envNoN.notif === false, 'B13 注入生效：本机看不到 Notification（' + JSON.stringify(envNoN.notif) + '）');
ok(s.bg && s.bg.off === true, 'B13b 无通知能力内核上「后台通知」变灰（旧版这里给的是「仅安卓」＝假阳性）');
ok(s.bg && /Chrome \/ Edge/.test(s.bg.hint) && s.bg.go === false, 'B13c 提示改用 Chrome / Edge（本行没有可跳转的替代项，不给按钮）', s.bg && s.bg.hint);
if (inj && inj.identifier) await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier });

ok(jsErr === 0, 'Z1 全程无 JS 异常', 'jsErr=' + jsErr);

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 设置页「本机能不能用」标记验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
