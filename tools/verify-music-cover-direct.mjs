// ===== #216 音乐封面直链化端到端验证 + #214 manifest theme_color =====
// 用法：node build.mjs && node tools/verify-music-cover-direct.mjs
// 覆盖（一加Ace3+Edge 报障「音乐封面丢失（新加的也是这样）」修复链路）：
//   1) 存量代理封面迁移：库里/歌单/历史/TA收藏快照里 meting 图片代理 URL → 解析 302
//      → 网易 CDN 直链写回（本地桩服务器模拟 injahow 302 → CDN）；
//   2) 新加歌封面：meting type=song 的 pic（代理 URL）入库前解析成直链；
//   3) meting 主源挂（500）→ fetchNeteaseInfo 多代理链兜底取 album.picUrl，
//      且 normNeteaseCoverUrl 烘焙 ?param=300y300；
//   4) 防误伤：dataURI 封面与 meting type=url 播放代理 URL 不迁移；
//   5) #214：src/pwa/manifest.json 与产物 manifest.json theme_color=#e9e9e9。
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const PROXY_PIC = 'https://api.injahow.cn/meting/?server=netease&type=pic&id=777888';
const PROXY_PIC2 = 'https://api.injahow.cn/meting/?type=pic&id=777889';
const PLAY_PROXY_URL = 'https://api.injahow.cn/meting/?type=url&id=555555'; // 播放直链代理——绝不能被当封面迁移
const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ACAO = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  try {
    const u = req.url || '/';
    // —— meting type=song 桩：id=91001 正常返回（pic=代理URL）；id=91002 500（触发第二封面源）——
    if (u.startsWith('/stub-meting/song')) {
      const id = (u.match(/id=([0-9]+)/) || [])[1] || '0';
      if (id === '91002') { res.writeHead(500, ACAO); res.end('boom'); return; }
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, ACAO));
      res.end(JSON.stringify([{ name: '桩歌' + id, artist: 'Verify', url: '', lrc: '', pic: PROXY_PIC }]));
      return;
    }
    // —— meting 图片代理桩：302 → 本地「网易 CDN」（带 ?param=90y90，验证 r.url 跟随）——
    if (u.startsWith('/stub-meting/pic')) {
      res.writeHead(302, Object.assign({ Location: '/stub-cdn/cover.jpg?param=90y90' }, ACAO));
      res.end();
      return;
    }
    if (u.startsWith('/stub-cdn/')) {
      res.writeHead(200, Object.assign({ 'Content-Type': 'image/jpeg' }, ACAO));
      res.end(TINY_PNG);
      return;
    }
    // —— fetchNeteaseInfo 代理链桩：标题页故意给不匹配的 title（逼它走到第 3 个源）——
    if (u.startsWith('/stub-info/title')) {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, ACAO));
      res.end('<html><head><title>网易云音乐</title></head><body></body></html>');
      return;
    }
    if (u.startsWith('/stub-info/detail')) {
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, ACAO));
      res.end(JSON.stringify({ songs: [{ name: '详情歌', artists: [{ name: '详情歌手' }], album: { picUrl: 'http://p2.music.126.net/fakeenc==/777.jpg' } }] }));
      return;
    }
    if (u.startsWith('/stub-500')) { res.writeHead(500, ACAO); res.end('no'); return; }
    let p = normalize(join(root, decodeURIComponent(u.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const STUB_FINAL = baseUrl + '/stub-cdn/cover.jpg?param=90y90';

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-covdir-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};

// 每次导航前注入：把外网封面依赖映射到本地桩（真实 fetch 跟随 302，r.url 才有终值）
const INIT_SCRIPT = `
window.__fetchLog = [];
(function () {
  var of = window.fetch.bind(window);
  var M = '${baseUrl}';
  window.fetch = function (input, init) {
    var u = String(typeof input === 'string' ? input : (input && input.url) || '');
    var m = u, tag = '';
    if (u.indexOf('api.injahow.cn/meting/?type=song&id=') >= 0) {
      var mm = u.match(/id=([0-9]+)/); tag = 'meting-song:' + (mm ? mm[1] : '?');
      m = M + '/stub-meting/song?id=' + (mm ? mm[1] : '0');
    } else if (u.indexOf('injahow') >= 0 && u.indexOf('type=pic') >= 0) {
      tag = 'meting-pic'; m = M + '/stub-meting/pic';
    } else if (u.indexOf('proxy.cors.sh/') >= 0) { tag = 'cors-sh'; m = M + '/stub-500'; }
    else if (u.indexOf('api.allorigins.win/raw') >= 0 && u.indexOf('song%2Fdetail') >= 0) { tag = 'info-detail'; m = M + '/stub-info/detail'; }
    else if (u.indexOf('api.allorigins.win/raw') >= 0) { tag = 'info-title'; m = M + '/stub-500'; }
    if (tag) window.__fetchLog.push(tag);
    return of(m, init);
  };
})();`;

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

try {
  // ---- #214：manifest theme_color（src 与构建产物都要浅色）----
  try {
    const srcMan = JSON.parse(readFileSync(join(root, 'src', 'pwa', 'manifest.json'), 'utf8'));
    check('#214 src/pwa/manifest.json theme_color=浅色', (srcMan.theme_color || '').toLowerCase() === '#e9e9e9', String(srcMan.theme_color));
    let artMan = null;
    try { artMan = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')); } catch (e) {}
    check('#214 产物 manifest.json theme_color=浅色', !!artMan && (artMan.theme_color || '').toLowerCase() === '#e9e9e9', artMan ? String(artMan.theme_color) : '产物不存在(先 node build.mjs)');
  } catch (e) { check('#214 src/pwa/manifest.json 可读', false, String(e.message)); }

  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SCRIPT });

  // ---- 第 1 次加载：种子数据（A=存量代理封面+快照；B=新加缺封面；C=主源会挂缺封面；D=dataURI 不动；E=播放代理URL 不动；+歌单）----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(800);
  const seed = await evalJs(`(function(){
    try {
      var P1 = ${JSON.stringify(PROXY_PIC)}, P2 = ${JSON.stringify(PROXY_PIC2)};
      var lib = [
        { id:'sm_cv_a', neteaseId:'91000', name:'迁移歌A', artist:'Verify', cover:P1, url:'', source:'url', duration:180, playlistId:'default', addedAt:Date.now() },
        { id:'sm_cv_b', neteaseId:'91001', name:'新加歌B', artist:'Verify', cover:'', url:'', source:'url', duration:181, playlistId:'default', addedAt:Date.now() },
        { id:'sm_cv_c', neteaseId:'91002', name:'兜底歌C', artist:'Verify', cover:'', url:'', source:'url', duration:182, playlistId:'default', addedAt:Date.now() },
        { id:'sm_cv_d', neteaseId:'91003', name:'本地图D', artist:'Verify', cover:${JSON.stringify(DATA_URI)}, url:'', source:'local', duration:183, playlistId:'default', addedAt:Date.now() },
        { id:'sm_cv_e', neteaseId:'91004', name:'播放代理E', artist:'Verify', cover:'', url:${JSON.stringify(PLAY_PROXY_URL)}, source:'url', duration:184, playlistId:'default', addedAt:Date.now() },
        { id:'sm_cv_f', neteaseId:'91005', name:'坏封面F', artist:'Verify', cover:${JSON.stringify(PLAY_PROXY_URL)}, url:'', source:'url', duration:185, playlistId:'default', addedAt:Date.now() }
      ];
      window.storeFor('default').set('music-library', JSON.stringify(lib));
      window.storeFor('default').set('music-playlists', JSON.stringify([
        { id:'spl_v1', name:'迁移歌单', cover:P2, createdAt:Date.now() }
      ]));
      window.storeFor('default').set('music-history', JSON.stringify([
        { id:'smh_v1', trackId:'sm_cv_a', trackName:'迁移歌A', cover:P1, triggerType:'ta', ts:Date.now() }
      ]));
      window.storeFor('default').set('music-my-history', JSON.stringify([
        { id:'smymh_v1', trackId:'sm_cv_a', trackName:'迁移歌A', cover:P1, ts:Date.now() }
      ]));
      window.storeFor('default').set('music-favs-ta', JSON.stringify([
        { id:'sm_cv_a', name:'迁移歌A', artist:'Verify', neteaseId:'91000', url:'', cover:P1, duration:180, favAt:Date.now() }
      ]));
      return true;
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  check('种子数据入库（歌库/歌单/历史/TA收藏）', seed === true, String(seed));

  // ---- 第 2 次加载：打开音乐页触发 ensureMissingCovers / ensureSongCover / 迁移 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(800);
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);

  // ---- 轮询等迁移/补全写回（saveLibrarySoon 1.5s 合并 + 串行队列）----
  let lib = null;
  for (let i = 0; i < 80; i++) {
    lib = await evalJs(`(function(){
      try { return JSON.parse(window.storeFor('default').get('music-library') || '[]'); } catch (e) { return null; }
    })()`);
    if (lib) {
      const a = lib.find(x => x.id === 'sm_cv_a'), b = lib.find(x => x.id === 'sm_cv_b'), c = lib.find(x => x.id === 'sm_cv_c');
      if (a && b && c && a.cover && !a.cover.includes('injahow') && b.cover && c.cover) break;
    }
    await sleep(250);
  }
  const byId = (id) => (lib || []).find(x => x.id === id) || {};
  const A = byId('sm_cv_a'), B = byId('sm_cv_b'), C = byId('sm_cv_c'), D = byId('sm_cv_d'), E = byId('sm_cv_e'), F = byId('sm_cv_f');
  check('#216 存量代理封面迁移成直链（歌A）', A.cover === STUB_FINAL, String(A.cover).slice(0, 90));
  check('#216 新加歌封面经 meting 解析直链（歌B）', B.cover === STUB_FINAL, String(B.cover).slice(0, 90));
  check('#216 meting 挂走第二封面源+param 归一（歌C）', C.cover === 'https://p2.music.126.net/fakeenc==/777.jpg?param=300y300', String(C.cover).slice(0, 90));
  check('#216 dataURI 封面不被误迁移（歌D）', D.cover === DATA_URI, String(D.cover).slice(0, 40));
  // E：m.url 的 type=url 播放代理不得被动，同时缺封面会正常经 meting 补齐（非迁移路径）
  check('#216 播放代理 URL 不动且封面正常补齐（歌E）', E.url === PLAY_PROXY_URL && E.cover === STUB_FINAL, 'url=' + String(E.url).slice(0, 50) + ' cover=' + String(E.cover || '').slice(0, 60));
  // F：cover 字段被人存成 type=url 播放代理（脏数据）——COVER_PROXY_RE 必须不认它
  check('#216 type=url 播放代理不被当封面迁移（歌F 负例）', F.cover === PLAY_PROXY_URL, String(F.cover).slice(0, 60));

  // ---- 快照同步：历史/我的历史/TA收藏里歌A的代理封面一起换直链 ----
  const snaps = await evalJs(`(function(){
    try {
      var g = function (k) { try { return JSON.parse(window.storeFor('default').get(k) || '[]'); } catch (e) { return []; } };
      return {
        h: g('music-history'), mh: g('music-my-history'), ta: g('music-favs-ta'),
        pl: g('music-playlists')
      };
    } catch (e) { return null; }
  })()`);
  const covOf = (arr, idKey, idVal) => { const x = (arr || []).find(y => y && y[idKey] === idVal) || {}; return x.cover || ''; };
  check('#216 听歌记录快照同步直链', covOf(snaps && snaps.h, 'trackId', 'sm_cv_a') === STUB_FINAL, String(covOf(snaps && snaps.h, 'trackId', 'sm_cv_a')).slice(0, 90));
  check('#216 我的历史快照同步直链', covOf(snaps && snaps.mh, 'trackId', 'sm_cv_a') === STUB_FINAL, String(covOf(snaps && snaps.mh, 'trackId', 'sm_cv_a')).slice(0, 90));
  check('#216 TA收藏快照同步直链', covOf(snaps && snaps.ta, 'id', 'sm_cv_a') === STUB_FINAL, String(covOf(snaps && snaps.ta, 'id', 'sm_cv_a')).slice(0, 90));
  check('#216 歌单代理封面迁移直链', covOf(snaps && snaps.pl, 'id', 'spl_v1') === STUB_FINAL, String(covOf(snaps && snaps.pl, 'id', 'spl_v1')).slice(0, 90));

  // ---- fetchLog：确认真实走到 meting 主源（B/C）与 detail 兜底（C）----
  const flog = await evalJs('JSON.stringify(window.__fetchLog || [])');
  let lg = []; try { lg = JSON.parse(flog || '[]'); } catch (e) {}
  check('#216 主源请求发生（meting type=song ×2）', lg.filter(t => t.indexOf('meting-song:') === 0).length >= 2, lg.join(',').slice(0, 80));
  check('#216 兜底请求发生（song/detail 代理）', lg.indexOf('info-detail') >= 0, lg.join(',').slice(0, 80));

  // ---- UI：列表里歌A图标已带直链封面 ----
  const ui = await evalJs(`(function(){
    var row = document.querySelector('#music-lib-list .sm-song[data-id="sm_cv_a"] .sm-song-ico');
    if (!row) return 'norow';
    return (row.className || '') + '|' + (row.style.backgroundImage || '');
  })()`);
  check('#216 列表图标显示直链封面', String(ui).indexOf('has-cov') >= 0 && String(ui).indexOf('/stub-cdn/cover.jpg') >= 0, String(ui).slice(0, 90));

  // ---- 断网等异常不产生未处理 rejection 噪音（resolveCoverDirect 落地路径全 catch）----
  const jsErr = await evalJs('(window.__jsErrors || []).length');
  check('无新增未捕获 JS 错误', jsErr === 0, 'errors=' + jsErr);
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log(fail ? '\\n❌ ' + fail + ' 项失败' : '\\n✅ ' + pass + '/' + (pass + fail) + ' 全过');
process.exit(fail ? 1 : 0);
