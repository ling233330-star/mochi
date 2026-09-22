// verify-room-766.mjs —— #766 房间批行为断言（无头 Chrome · CDP）
// 覆盖四项：①离房/后台停步进计时器 ②亮度落盘节流（生效即时、写盘合并）③锁定家具点击有反馈
// ④每日互动点数上限提示。断言口径＝用户看得见的现象（TA 位置 / CSS 变量 / toast 文本），
// 不断言内部变量名。
// 用法：node tools/verify-room-766.mjs（需先 node build.mjs；跑基线版用另一份构建目录里的本脚本副本）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-room766-' + Date.now()),
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

async function readyPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
  return true;
}
// 种一份房间档并重新进屋（openRoom 现读 store）
async function seed(patch) {
  const tk = new Date().getFullYear() + '-' + (new Date().getMonth() + 1) + '-' + new Date().getDate();
  const d = Object.assign({
    fx: [{ i: 'a1', t: 'bed', x: 4, y: 0, r: 0 }], inv: {}, pts: 2, lv: 1,
    wall: 'cream', floor: 'wood', day: tk, lit: {}, earn: { day: tk, n: 0, ta: 0 },
    ta: { x: 0, y: 0, act: 'walk', tx: 5, ty: 0, faint: false, nextAt: Date.now() + 90000 }
  }, patch);
  await evalJs("(function(){if(window.closeRoom)window.closeRoom();var cid=window.__activeCid||'default';window.storeFor(cid).set('room-data'," + JSON.stringify(JSON.stringify(d)) + ");window.openRoom();return true;})()");
  await sleep(500);
}
const taPos = () => evalJs("(function(){var s=window.__roomState();return s.ta.x+','+s.ta.y;})()");
const toastTxt = () => evalJs("(function(){var t=document.getElementById('cc-toast');return t?t.textContent:'';})()");
const brightVar = () => evalJs("document.getElementById('room-scene').style.getPropertyValue('--room-bright')");
const storeBright = () => evalJs("(function(){try{return String(window.storeFor(window.__activeCid||'default').get('room-brightness'));}catch(e){return 'ERR';}})()");

await readyPage();

// ---- T1 离房（page.hidden）后 TA 步进计时器必须停 ----
await seed({});
await sleep(1700); // 步进 780ms/格 ⇒ 应当已经走开
const moved = await taPos();
check('T1 在场时 TA 会沿目标格步进（前提成立）', moved !== '0,0', 'pos=' + moved);
await evalJs("(function(){window.closeRoom();var p=document.getElementById('page-room');if(p)p.hidden=true;return true;})()");
await sleep(250);
const atHide = await taPos();
await sleep(2500); // 未修则 ≈3 格
const afterHide = await taPos();
check('T1b 离开房间页后步进立即停止（计时器不再白烧）', atHide === afterHide, atHide + ' → ' + afterHide);

// ---- T2 挂后台（document.hidden）同样停摆 ----
await seed({});
await sleep(1700);
check('T2 重进后 TA 重新走起来（前提成立）', (await taPos()) !== '0,0', 'pos=' + (await taPos()));
await evalJs("(function(){Object.defineProperty(document,'hidden',{get:function(){return true;},configurable:true});return true;})()");
await sleep(250);
const atBg = await taPos();
await sleep(2500);
const afterBg = await taPos();
check('T2b 切到后台后步进停止', atBg === afterBg, atBg + ' → ' + afterBg);
await evalJs("(function(){try{delete document.hidden;}catch(e){Object.defineProperty(document,'hidden',{get:function(){return false;},configurable:true});}var p=document.getElementById('page-room');if(p)p.hidden=false;if(window.openRoom)window.openRoom();return true;})()");
await sleep(300);

// ---- T3/T4 亮度：生效即时 + 写盘合并 + 离手落最终值 ----
await evalJs("(function(){window.__bw=[];var o=localStorage.setItem.bind(localStorage);localStorage.setItem=function(k,v){if(k.indexOf('room-brightness')>=0)window.__bw.push(v);return o(k,v);};return true;})()");
await evalJs("(function(){var s=document.getElementById('room-brightness');var out=[];for(var v=50;v<=110;v+=5){s.value=String(v);s.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()");
const liveVar = await brightVar();
const liveLabel = await evalJs("document.getElementById('room-brightness-value').textContent");
check('T3 拖动中亮度即时生效（CSS 变量＝最后一次值/100）', liveVar === '1.1' && liveLabel === '110%', 'var=' + liveVar + ' label=' + liveLabel);
await sleep(150);
const writeN = await evalJs("window.__bw.length");
check('T4 13 次拖动合并落盘（写盘次数远小于事件数）', Number(writeN) > 0 && Number(writeN) <= 2, 'writes=' + writeN);
await evalJs("(function(){var s=document.getElementById('room-brightness');s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
await sleep(200);
check('T4b 离手必落最终值', (await storeBright()) === '110', 'stored=' + (await storeBright()));

// ---- T5 「自动」不能被迟到的合并写回复活 ----
await evalJs("(function(){var s=document.getElementById('room-brightness');for(var v=60;v<=80;v+=5){s.value=String(v);s.dispatchEvent(new Event('input',{bubbles:true}));}document.getElementById('room-brightness-auto').click();return true;})()");
await sleep(800);
const afterAuto = await storeBright();
check('T5 拖完立刻点「自动」⇒ 键保持删除（迟到写回不复活）', afterAuto === 'null', 'stored=' + afterAuto);
const autoLabel = await evalJs("document.getElementById('room-brightness-value').textContent");
check('T5b 点「自动」后读数回「自动」', autoLabel === '自动', autoLabel);

// ---- T6 锁定家具：点确定必须有解释（原为 value:'' ⇒ 静默关闭）----
await seed({ pts: 2, lv: 1 });
await evalJs("(function(){document.getElementById('room-btn-inv').click();return true;})()");
await sleep(400);
await evalJs("(function(){var p=document.querySelector('#modal-pills .pill');if(p)p.click();document.getElementById('modal-ok').click();return true;})()");
await sleep(500);
const shopPills = await evalJs("(function(){return Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'),function(b){return b.textContent;}).join(' | ');})()");
check('T6 兑换列表打开且含锁定项', shopPills.indexOf('🔒') >= 0, shopPills.slice(0, 90));
check('T6b 买不起的项标出还差多少点数', shopPills.indexOf('还差') >= 0, shopPills.slice(0, 120));
await evalJs("(function(){var ps=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));var t=ps.find(function(b){return b.textContent.indexOf('🔒')>=0;});if(!t)return 'nopill';t.click();document.getElementById('modal-ok').click();return 'ok';})()");
await sleep(400);
const lockToast = await toastTxt();
check('T7 点锁定项 + 确定 ⇒ toast 说明要 Lv.几', /Lv\./.test(lockToast) && lockToast.length > 4, lockToast);
const ptsAfterLock = await evalJs("(function(){return window.__roomState().pts;})()");
check('T7b 点锁定项不扣点数', String(ptsAfterLock) === '2', 'pts=' + ptsAfterLock);

// ---- T8 每日互动上限到点要有提示（原为静默不加点数）----
const tk = new Date().getFullYear() + '-' + (new Date().getMonth() + 1) + '-' + new Date().getDate();
await seed({ pts: 100, earn: { day: tk, n: 0, ta: 5 }, ta: { x: 2, y: 1, act: 'idle', tx: 2, ty: 1, faint: false, nextAt: Date.now() + 90000 } });
await evalJs("(function(){document.getElementById('room-ta').click();return true;})()");
await sleep(450);
await evalJs("(function(){var ps=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));var t=ps.find(function(b){return b.textContent.indexOf('打招呼')>=0;});if(!t)return 'nopill';t.click();document.getElementById('modal-ok').click();return 'ok';})()");
await sleep(500);
const capToast = await toastTxt();
check('T8 陪 TA 互动撞每日上限 ⇒ 有明确提示（原为静默）', capToast.indexOf('到上限') >= 0 && capToast.indexOf('5/5') >= 0, capToast);
const ptsAfterCap = await evalJs("(function(){return window.__roomState().pts;})()");
check('T8b 撞上限不加点数', String(ptsAfterCap) === '100', 'pts=' + ptsAfterCap);

// ---- T9 未撞限时照常加分（节流/提示没把正路挡掉）----
await seed({ pts: 100, earn: { day: tk, n: 0, ta: 0 }, ta: { x: 2, y: 1, act: 'idle', tx: 2, ty: 1, faint: false, nextAt: Date.now() + 90000 } });
await evalJs("(function(){document.getElementById('room-ta').click();return true;})()");
await sleep(450);
await evalJs("(function(){var ps=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));var t=ps.find(function(b){return b.textContent.indexOf('打招呼')>=0;});if(!t)return 'nopill';t.click();document.getElementById('modal-ok').click();return 'ok';})()");
await sleep(600);
const ptsNormal = await evalJs("(function(){return window.__roomState().pts;})()");
const earnNormal = await evalJs("(function(){return JSON.stringify(window.__roomState().earn);})()");
check('T9 未撞限时正常 +1🏠 且计数累加', String(ptsNormal) === '101' && /"ta":1/.test(earnNormal), 'pts=' + ptsNormal + ' earn=' + earnNormal);

// ---- T10/T11/T12 #966 装扮（墙纸/地板）锁定项点确定要有反馈，且不误写 ----
const wallBefore = await evalJs("(function(){return String(window.__roomState().wall);})()");
await evalJs("(function(){document.getElementById('room-btn-deco').click();return true;})()");
await sleep(400);
const decoPills = await evalJs("(function(){return Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'),function(b){return b.textContent;}).join(' | ');})()");
check('T10a 装扮墙纸列表打开且含锁定项（前提成立）', decoPills.indexOf('🔒') >= 0, decoPills.slice(0, 90));
await evalJs("(function(){var ps=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));var t=ps.find(function(b){return b.textContent.indexOf('🔒')>=0;});if(!t)return 'nopill';t.click();document.getElementById('modal-ok').click();return 'ok';})()");
await sleep(400);
const wallLockToast = await toastTxt();
check('T10b 点锁定墙纸 + 确定 ⇒ toast 说明要 Lv.几（原为静默）', /🔒/.test(wallLockToast) && /Lv\./.test(wallLockToast) && wallLockToast.indexOf('解锁') >= 0, wallLockToast);
const wallAfterLock = await evalJs("(function(){return String(window.__roomState().wall);})()");
check('T10c 点锁定墙纸不改写当前墙纸', wallAfterLock === wallBefore, wallBefore + ' → ' + wallAfterLock);

// 墙纸步锁定后仍照常衔接地板步（既有流程零变化）；在地板步里选未锁定项 ⇒ 真的写入 d.floor
await sleep(400);
const floorPills = await evalJs("(function(){return Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'),function(b){return b.textContent;}).join(' | ');})()");
check('T11a 锁定墙纸后仍进到地板步且含锁定项', floorPills.indexOf('🔒') >= 0 && floorPills.length > 4, floorPills.slice(0, 90));
const floorLockToastProbe = await evalJs("(function(){var ps=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));var t=ps.find(function(b){return b.textContent.indexOf('🔒')>=0;});if(!t)return 'nopill';t.click();document.getElementById('modal-ok').click();return 'ok';})()");
await sleep(400);
const floorLockToast = await toastTxt();
check('T11b 点锁定地板 + 确定 ⇒ toast 说明要 Lv.几（原为静默）', /🔒/.test(floorLockToast) && /Lv\./.test(floorLockToast) && floorLockToast.indexOf('解锁') >= 0, floorLockToastProbe + ' / ' + floorLockToast);

// ---- T12 正常路径不被新 value 形态挡掉：未锁定墙纸真的切换 ----
await seed({ pts: 20 });
await sleep(300);
await evalJs("(function(){document.getElementById('room-btn-deco').click();return true;})()");
await sleep(400);
await evalJs("(function(){var ps=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));var t=ps.find(function(b){return b.textContent.indexOf('云朵')>=0;});if(!t)return 'nopill';t.click();document.getElementById('modal-ok').click();return 'ok';})()");
await sleep(500);
const wallAfterPick = await evalJs("(function(){return String(window.__roomState().wall);})()");
check('T12 选未锁定墙纸 ⇒ d.wall 真的写成 cloud', wallAfterPick === 'cloud', 'wall=' + wallAfterPick);
await evalJs("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return true;})()");

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log('\n===== verify-room-766: ' + pass + '/' + results.length + ' passed =====' + (fail ? ' ' + fail + ' FAILED' : ' ALL GREEN'));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
