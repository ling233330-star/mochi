// ===== 专项验证：#935 电量消耗自测 + 发烫自测（设置→工具 两行入口）+ #947 三处缺陷收口 =====
// 用户直派：「帮我在工具里新增一个电量消耗自测和发烫自测…用来检查异常」；
//         #947：「按优先级修复第 1、2、4 条缺陷」＝①电量计抖动被单边累加成虚高耗电
//         ②后台定时器被节流却归成「页面未运行、与本站无关」③挂起的报告关页重开后永不弹出。
// 覆盖：S 组产物静态锚（模块进产物 / 两行入口 / 分段归档＋充电剔除 / 断档按证据归段 /
// 净掉电封顶 / 不确定段 / boot 补弹闸 / 降频判级 / 续测守卫 / 隐藏期挂起 / EXCLUDE 登记 /
// 指引文案 / 复制导出闭环）；
// B 组无头行为十二场景（桩 BatteryManager，零机型分支只在夹具侧）：
//   ① noBattery：无电量接口＝如实告知能力边界（不弹假数据）
//   ② drain：正常掉电＝前台段计时/掉电归档 + 粗测速率行 + 跑完清 run 写 last
//   ③ chg：全程充电＝整段剔除（充电中电量不降反升，混进来会把耗电算成 0）
//   ④ seed：续测到点＝直接补出报告弹窗（三段速率 + 判级 + 复制/导出按钮 + 行小字回填）
//   ⑤ seed2：跑完页面不可见＝报告挂起，回前台补弹一次
//   ⑥ resume：中途刷新＝run 键续命、到点自动出报告
//   ⑦ heat：发烫自测跑满 10 轮 + 判级文本 + 结果落 last 键 + 确认弹窗
//   ⑧ ui：点行起测 → 再点行＝进行中弹窗「结束并出报告」→ 报告弹窗接上
//   ⑨ badrun：坏 run 记录＝早退不出假报告
//   ⑩ jitter：电量计抖（掉一格回一格、净掉电 0）＝各段速率封顶到净值、报出抖动量（#947 缺陷 1）
//   ⑪ throttle：后台心跳被内核节流＝归「不确定」段而非「与本站无关」的未运行段（#947 缺陷 2）
//   ⑫ pendlast：挂着未读报告关页重开＝开屏离场后补弹一次并清 pending（#947 缺陷 4）
// #1015（用户直派「电量消耗自测 闪屏自测 发烫自测，功能测试时间太短，并且还能怎么优化」）追加三场景：
//   ⑬ heat2：发烫档位胶囊 4 档 + 判级看整窗趋势（6 段）+ 短档照实标「快测」
//   ⑭ heat3：提前结束＝当场出报告并标明中途结束；页面不可见＝负载时钟暂停（不虚走、不后台烧电）
//   ⑮ coarse：电量 5~15 分钟的段标粗测、≥15 分钟的段仍给正式参考带（旧版只有 <5 分钟才标粗测）
// 用法：node tools/verify-energy-check.mjs（需先 node build.mjs；MOCHI_ROOT 可指仓外副本）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const target = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : root;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

// ---- S 组：产物静态锚（energy-check.js 自带上线即外置件 js/energy-check.js）----
let jsEc = '', idx = '', jsContacts = '';
try { jsEc = readFileSync(join(target, 'js', 'energy-check.js'), 'utf8'); } catch (e) {}
try { idx = readFileSync(join(target, 'index.html'), 'utf8'); } catch (e) {}
try { jsContacts = readFileSync(join(target, 'js', 'contacts.js'), 'utf8'); } catch (e) {}
if (!jsEc) jsEc = idx; // 兼容将来内联落点
ok('S1 电量/发烫自测模块进产物（删＝设置页两行点了没反应）', jsEc.includes('window.mochiEnergyCheck = {'));
ok('S2 设置页两行入口在产物（删＝工具里找不到自测入口）', idx.includes('id="row-battery-check"') && idx.includes('id="row-heat-check"'));
ok('S3 分段归档＋充电段整段剔除（改＝充电期把耗电算成 0，本批报障面复发）', jsEc.includes("if (st === 'chg') { run.chgMs += dt; }"));
ok('S4 采样断档改按证据归段（删＝停摆一律当「与本站无关」，#947 缺陷 2 复发）', jsEc.includes("var st = (dt > run.iv * 2.5) ? stalledSeg(run) : run.lastSt;"));
ok('S5 降频判级总闸（删＝发烫自测没有结论）', jsEc.includes("if (slow >= SLOW_BAD) return '明显降频';"));
ok('S6 续测恢复守卫（删＝坏 run 记录起测崩，刷新后续测失效）', jsEc.includes('if (!run || !(run.t0 > 0) || !(run.ms > 0) || !(run.iv > 0)) return;'));
ok('S7 跑完不可见＝报告挂起待补弹（删＝切去忙别的回来报告丢了，长窗口自测白跑）', jsEc.includes('last.pending = 1; last.text = rep.text;'));
ok('S8 三个新全局键已登记 EXCLUDE（漏＝刷新时被迁进 default 桌面，跨桌面污染）', jsContacts.includes("'battery-check-run', 'battery-check-last', 'heat-check-last',"));
ok('S9 发烫说明接「想量化取证」指引（删＝用户不知道有这两个自测可跑）', idx.includes('想量化取证'));
ok('S10 报告走复制/导出闭环（删＝拿到报告传不出去）', jsEc.includes('mochi-batterycheck-') && jsEc.includes('mochi-heatcheck-'));
ok('S11 有符号净掉电在记账（删＝封顶没有原料，抖动单边加成虚高耗电）', jsEc.includes('run.net += dLv;'));
ok('S12 抖动封顶总闸（删＝净掉 0 格也能报出几十 %/小时，#947 缺陷 1 复发）', jsEc.includes('if (hasNet && gross > net + 0.001) {'));
ok('S13 不确定段独立归档（删＝节流那段又并进「与本站无关」对照组）', jsEc.includes("if (st === 'unk') { run.unkMs += dt;"));
ok('S14 停摆归段只认三种证据（删＝不查证据，#947 缺陷 2 复发）', jsEc.includes("if (_freshReload || wasDiscarded() || run.lastSt === 'fg') return 'gap';"));
ok('S15 关页重开补弹闸（删＝挂起的报告永久烂在 pending，#947 缺陷 4 复发）', jsEc.includes('if (splashGone()) { popPending(); return; }') && jsEc.includes('whenModalReady(function () { restoreRun(); popPendingAtBoot(); });'));

// #1015b：第二轮修掉的六处（判级门槛/窗口后缀/心跳分母/重复采样状态/负载时钟/收尾暂停）——都是
// 「代码在、逻辑被改回去就复发」的逻辑锚，按 v3.27.x 铁律收成 src 里唯一的表达式。
ok('S16 电量判级门槛与粗测门槛对齐（改回 SEG_MIN_MS＝5 分钟的段又能一边标「粗测、仅供参考」一边驱动「结论：异常」）', jsEc.includes("if (run.fgMs >= SEG_COARSE_MS) cands.push({ n: '前台使用'"));
ok('S17 电量窗口后缀按用户选的档位（改回 totalMs＝含 gapMs，页面被关掉 50 分钟也照样算满 1 小时）', jsEc.includes('var winMs = run.ms || totalMs;'));
ok('S18 心跳平均间隔只摊页面活着的时间（改回含 gapMs＝一边印「页面未运行 48 分钟」一边指控内核节流）', jsEc.includes('var liveMs = run.fgMs + run.bgMs + unkMs + run.chgMs;'));
ok('S19 重复采样也要记状态（删＝「切出去 <500ms 又切回」的可见事件被吞，一整段记到后台段上）', jsEc.includes("if (dt < 500) { run.last = now; run.lastSt = ch ? 'chg' : (document.hidden ? 'bg' : 'fg'); return; }"));
ok('S20 发烫负载时钟只算真在算的时间（改回 actMs += now - actAt＝3 分钟档只压约 2.7 分钟）', jsEc.includes('actMs += dur;'));
ok('S21 发烫收尾结算后台暂停段（删＝静置/收尾期正处后台的暂停时长被整块丢掉）', jsEc.includes('if (hidAt) { rep.pauseMs += performance.now() - hidAt; hidAt = 0; }'));
// ---- B 组：无头行为 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(target, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(target)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10400 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-935-' + Date.now()),
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
  throw new Error('CDP 连接失败');
}
const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

// 夹具桩：按 URL ?scn= 决定电量接口形态（产品侧零机型分支，桩只活在无头夹具里）。
// seed/seed2 另在 boot 前写好一条「已到点」的续测记录（restoreRun 到点分支=补出报告）。
const FAKE_RUN = `{ t0: D.now - 3600000, ms: 3600000, iv: 20000, last: D.now - 1000, lastLv: 0.5, lastSt: 'fg', fgMs: 1200000, bgMs: 2400000, gapMs: 0, chgMs: 300000, fgDrop: 20, bgDrop: 4, gapDrop: 0, lv0: 0.9, lvEnd: 0.5, n: 60 }`;
const stub = `(function(){
  window.__jsErrors = window.__jsErrors || [];
  window.addEventListener('error', function(e){ try { window.__jsErrors.push(String((e && (e.message || e.error)) || 'err')); } catch (x) {} });
  var scn = '';
  try { scn = (location.search.match(/[?&]scn=([a-z0-9]+)/) || [])[1] || ''; } catch (e) {}
  try {
    if (scn === 'nobat') {
      Object.defineProperty(Navigator.prototype, 'getBattery', { value: undefined, configurable: true, writable: true });
    } else if (scn === 'drain' || scn === 'chg' || scn === 'resume' || scn === 'ui') {
      var up = (scn === 'chg');
      window.__fakeBm = { level: up ? 0.5 : 0.8, charging: up };
      Object.defineProperty(Navigator.prototype, 'getBattery', { value: function(){ return Promise.resolve(window.__fakeBm); }, configurable: true, writable: true });
      setInterval(function(){ try { if (!window.__fakeBm) return; var n = window.__fakeBm.level + (up ? 0.01 : -0.01); window.__fakeBm.level = Math.max(0, Math.min(1, Math.round(n * 100) / 100)); } catch (e) {} }, 1500);
    }
    if (scn === 'seed' || scn === 'seed2') {
      var D = { now: Date.now() };
      localStorage.setItem('xy-home-v2:battery-check-run', JSON.stringify(${FAKE_RUN}));
    }
    if (scn === 'badrun') { localStorage.setItem('xy-home-v2:battery-check-run', '{"t0":1,"ms":0}'); localStorage.removeItem('xy-home-v2:battery-check-last'); }
    // #1015：前台段 10 分钟（该标粗测）、后台段 20 分钟（该给正式参考带）——判别「5~15 分钟也标粗测」
    // #1015b：只有 5~15 分钟的段（前台 10 分钟）——该给「数据不足」而不是「异常」
    if (scn === 'coarse5') {
      var C5 = { t0: Date.now() - 1800000, ms: 1800000, iv: 20000, last: Date.now() - 1000, lastLv: 0.5, lastSt: 'fg',
        fgMs: 600000, bgMs: 0, gapMs: 1200000, unkMs: 0, chgMs: 0, fgDrop: 3, bgDrop: 0, gapDrop: 0, unkDrop: 0, net: 3, lv0: 0.53, lvEnd: 0.5, n: 30 };
      localStorage.setItem('xy-home-v2:battery-check-run', JSON.stringify(C5));
    }
    if (scn === 'coarse') {
      var C = { t0: Date.now() - 1800000, ms: 1800000, iv: 20000, last: Date.now() - 1000, lastLv: 0.5, lastSt: 'fg',
        fgMs: 600000, bgMs: 1200000, gapMs: 0, unkMs: 0, chgMs: 0, fgDrop: 5, bgDrop: 4, gapDrop: 0, unkDrop: 0, net: 9, lv0: 0.59, lvEnd: 0.5, n: 90 };
      localStorage.setItem('xy-home-v2:battery-check-run', JSON.stringify(C));
    }
    if (scn === 'seed2') Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    // #947 缺陷 1：抖动的电量计——每被读一次就在 0.79/0.80 之间翻转（产品侧每次采样正好读一遍 level）。
    // 毛和（只记下降）稳定增长、有符号净掉电恒 ≤0＝真实世界「掉一格又回一格」的形状。
    if (scn === 'jitter') {
      var jr = 0;
      window.__fakeBm = { charging: false };
      Object.defineProperty(window.__fakeBm, 'level', { get: function () { jr++; return (jr % 2) ? 0.79 : 0.80; }, configurable: true });
      Object.defineProperty(Navigator.prototype, 'getBattery', { value: function () { return Promise.resolve(window.__fakeBm); }, configurable: true, writable: true });
    }
    // #947 缺陷 2：只掐电量采样那一个间隔（产品侧 12 秒档 iv 恰为 2000ms）×4＝模拟内核把后台标签
    // 定时器节流到分钟级；同时置为不可见＝页面其实还在跑，只是心跳被限制。
    if (scn === 'throttle') {
      var origSI = window.setInterval;
      window.setInterval = function (fn, ms) { return origSI(fn, ms === 2000 ? 8000 : ms); };
      window.__fakeBm = { level: 0.8, charging: false };
      Object.defineProperty(Navigator.prototype, 'getBattery', { value: function () { return Promise.resolve(window.__fakeBm); }, configurable: true, writable: true });
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    }
    // #947 缺陷 4：上次跑完时页面不可见＝报告挂起（关页重开没有 visibilitychange，只能 boot 补弹）
    if (scn === 'pendlast') {
      localStorage.removeItem('xy-home-v2:battery-check-run');
      localStorage.setItem('xy-home-v2:battery-check-last', JSON.stringify({ t: Date.now() - 60000, verdict: '异常', rateTxt: '后台页面自身 40%/小时', text: '结论：异常（后台页面自身约 40%/小时）\\n（夹具植入的挂起报告）', pending: 1 }));
    }
  } catch (e) {}
})();`;

const jsErrors = [];
let ctxOk = true;
async function nav(scn) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html?scn=' + scn });
  for (let i = 0; i < 60; i++) {
    const r = await evalJs("(function(){ return document.readyState + '|' + (typeof window.mochiEnergyCheck); })()");
    if (r === 'complete|object') return true;
    await sleep(150);
  }
  return false;
}
// 本轮导航的页内异常（每次导航前先清空 window.__jsErrors 由桩重建；这里直接累计）
async function collectErrs() {
  const t = await evalJs("JSON.stringify((window.__jsErrors || []).slice(-5))");
  try { (JSON.parse(t) || []).forEach((e) => jsErrors.push(e)); } catch (e) {}
}
const modalState = () => evalJs(`(function(){
  var m = document.getElementById('modal-mask'), t = document.getElementById('modal-title'),
      tx = document.getElementById('modal-textarea'), okB = document.getElementById('modal-ok'),
      pl = document.getElementById('modal-pills'), cp = document.getElementById('modal-copy'),
      ex = document.getElementById('modal-export'), st = document.getElementById('modal-static');
  return { vis: !!(m && !m.hidden), title: t ? t.textContent : '', ok: okB ? okB.textContent : '',
           text: (tx && !tx.hidden) ? tx.value : '', pillsVis: !!(pl && !pl.hidden),
           pills: pl ? Array.prototype.map.call(pl.children, function(c){ return c.textContent; }) : [],
           copyVis: !!(cp && !cp.hidden), expVis: !!(ex && !ex.hidden),
           staticText: (st && !st.hidden) ? st.textContent : '' };
})()`);
const clickId = (id) => evalJs(`(function(){ var b = document.getElementById('${id}'); if (!b) return false; b.click(); return true; })()`);

try {
  await cdpConnect();
  await cdp('Page.enable', {});
  await cdp('Runtime.enable', {});
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: stub });

  // ① noBattery：无电量接口＝如实告知（不弹假数据、给替代路径）
  try {
    if (!(await nav('nobat'))) throw new Error('页面 boot 超时');
    const has = await evalJs("(function(){ return { rows: !!document.getElementById('row-battery-check'), rows2: !!document.getElementById('row-heat-check'), nb: typeof navigator.getBattery }; })()");
    ok('B1 两行入口渲染在设置页（删＝工具里没有自测入口）', !!(has && has.rows && has.rows2));
    ok('B2 夹具桩生效：电量接口按「不支持」形态（桩失败则本场景无意义）', !!(has && has.nb === 'undefined'));
    await clickId('row-battery-check');
    await sleep(300);
    const m1 = await modalState();
    ok('B3 点电量行＝弹时长选择（标题对＋5 个档位胶囊）', !!(m1 && m1.vis && m1.title === '电量消耗自测' && m1.pillsVis && m1.pills.length === 5));
    ok('B4 确定按钮文案被覆盖为「开始测」（ctl.okText 生效；写 opts.okText 无效）', !!(m1 && m1.ok === '开始测'));
    // #1015：默认档从 30 分钟提到 1 小时（工具自己的报告就写着「1 小时以上才有参考价值」）
    const bPill = await evalJs("(function(){ var p=document.querySelector('#modal-pills .pill.on'); return p ? p.textContent : ''; })()");
    ok('B4b 电量默认档＝1 小时、短档标「粗测」、弹窗点明短档只能看趋势（删＝默认值给不出可用数字，用户选了短档再拿到一句「数据不足」）',
      !!(bPill === '1 小时' && m1.pills.join('|').indexOf('粗测') >= 0 && m1.staticText.indexOf('只能看趋势') >= 0), { on: bPill, pills: m1 && m1.pills });
    await clickId('modal-cancel');
    await sleep(200);
    const run0 = await evalJs("localStorage.getItem('xy-home-v2:battery-check-run')");
    ok('B5 取消＝不起测零副作用（删＝点取消也开跑）', run0 === null);
    const repU = await evalJs('window.mochiEnergyCheck.startBattery(10000)');
    ok('B6 无接口＝如实告知「测不了」（不假装测出数字）', !!(repU && repU.verdict === '测不了' && repU.text.indexOf('不提供电量接口') >= 0));
    ok('B7 告知含替代路径（iPhone 系统电池统计 + 先测发烫自测）', !!(repU && repU.text.indexOf('系统设置 → 电池') >= 0 && repU.text.indexOf('发烫自测') >= 0));
    const subB = await evalJs("(function(){ var e = document.querySelector('#row-battery-check .sub'); return e ? e.textContent : ''; })()");
    ok('B8 行小字回填上次结论（删＝用户看不到测过什么）', subB.indexOf('测不了') >= 0);
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景① noBattery 执行失败: ' + e.message); }

  // ② drain：正常掉电（前台段计时/掉电归档 + 粗测速率）
  try {
    if (!(await nav('drain'))) throw new Error('页面 boot 超时');
    const san = await evalJs("(function(){ return !!window.__fakeBm; })()");
    ok('B9 夹具桩生效：可控电量对象在位（桩失败则本场景无意义）', san === true);
    const rep = await evalJs('window.mochiEnergyCheck.startBattery(12000)');
    const m = await modalState();
    ok('B10 前台段计时成立（12 秒窗口前台段 ≥9 秒、充电段为 0）', !!(rep && rep.run && rep.run.fgMs >= 9000 && rep.run.chgMs === 0));
    const mRate = (rep && rep.text) ? rep.text.match(/前台使用（屏幕亮着用本站）：约 ([0-9.]+)%\/小时/) : null;
    ok('B11 掉电被归进前台段（粗测速率 >0%/小时，不是只计时不记账）', !!(mRate && Number(mRate[1]) > 0));
    ok('B12 短窗口给「粗测」速率行（不足 5 分钟不给正式判级、不误导）', !!(rep && rep.text.indexOf('前台使用（屏幕亮着用本站）') >= 0 && rep.text.indexOf('粗测') >= 0));
    ok('B12b 短窗口结论行标明「窗口不足 1 小时，属粗测」（删＝12 秒窗口的数字被当成结论）',
      !!(rep && rep.text.indexOf('结论：数据不足') === 0 && rep.text.indexOf('· 窗口不足 1 小时，属粗测') >= 0));
    const after = await evalJs("(function(){ return { run: localStorage.getItem('xy-home-v2:battery-check-run'), last: localStorage.getItem('xy-home-v2:battery-check-last') }; })()");
    let lastJ = null; try { lastJ = JSON.parse(after.last); } catch (e) {}
    ok('B13 跑完清 run 键、写 last 键（仍留 run＝下次开页误续测）', after.run === null && !!(lastJ && lastJ.text && lastJ.text.indexOf('结论：') === 0));
    ok('B14 API 直调路径不自行弹窗（交付归调用方，防双弹）', m && m.vis === false);
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景② drain 执行失败: ' + e.message); }

  // ③ chg：全程充电＝整段剔除
  try {
    if (!(await nav('chg'))) throw new Error('页面 boot 超时');
    const rep = await evalJs('window.mochiEnergyCheck.startBattery(12000)');
    ok('B15 充电段整段剔除（12 秒窗口充电计时 ≥9 秒、前台段 ≤2 秒）', !!(rep && rep.run && rep.run.chgMs >= 9000 && rep.run.fgMs <= 2000));
    ok('B16 报告点明剔除原因（删＝用户以为测出了 0 耗电）', !!(rep && rep.text.indexOf('整段剔除不计') >= 0 && rep.text.indexOf('充电中') >= 0));
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景③ chg 执行失败: ' + e.message); }

  // ④ seed：续测到点＝补出报告弹窗（三段速率 + 判级 + 复制/导出 + 行小字）
  try {
    if (!(await nav('seed'))) throw new Error('页面 boot 超时');
    await sleep(400);
    const m = await modalState();
    ok('B17 到点续测＝自动补出报告弹窗（删＝中途刷新后报告再也出不来）', !!(m && m.vis && m.title === '电量消耗自测报告'));
    ok('B18 三段速率与判级在报告里（前台 60%/小时＝异常；后台 6%/小时偏高）', !!(m && m.text.indexOf('结论：异常') >= 0 && m.text.indexOf('前台使用') >= 0 && m.text.indexOf('后台页面自身') >= 0));
    ok('B19 报告里点名充电段剔除（5 分钟）', !!(m && m.text.indexOf('充电中 5 分钟') >= 0));
    ok('B20 报告弹窗带复制/导出按钮（删＝报告传不出去）', !!(m && m.copyVis && m.expVis));
    ok('B21 确定按钮覆盖为「再测一次」（一键复测闭环）', !!(m && m.ok === '再测一次'));
    const subS = await evalJs("(function(){ var e = document.querySelector('#row-battery-check .sub'); return e ? e.textContent : ''; })()");
    ok('B22 行小字回填上次结论与速率（删＝用户不知道上次结果）', subS.indexOf('异常') >= 0 && subS.indexOf('前台使用') >= 0);
    const runKey = await evalJs("localStorage.getItem('xy-home-v2:battery-check-run')");
    ok('B23 补出报告后 run 键已清（防重复交付）', runKey === null);
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景④ seed 执行失败: ' + e.message); }

  // ⑤ seed2：跑完页面不可见＝挂起，回前台补弹一次
  try {
    if (!(await nav('seed2'))) throw new Error('页面 boot 超时');
    await sleep(400);
    const m = await modalState();
    const lk = await evalJs("localStorage.getItem('xy-home-v2:battery-check-last')");
    let lj = null; try { lj = JSON.parse(lk); } catch (e) {}
    ok('B24 不可见期跑完＝不弹窗、报告挂起到 pending（删＝切去忙别的回来报告丢）', !!(m && m.vis === false && lj && lj.pending === 1 && lj.text));
    await evalJs("(function(){ Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); return 1; })()");
    await sleep(400);
    const m2 = await modalState();
    const lk2 = await evalJs("localStorage.getItem('xy-home-v2:battery-check-last')");
    let lj2 = null; try { lj2 = JSON.parse(lk2); } catch (e) {}
    ok('B25 回前台补弹一次并清 pending（删＝挂起的报告永远不露面）', !!(m2 && m2.vis && m2.title === '电量消耗自测报告' && lj2 && lj2.pending === 0));
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑤ seed2 执行失败: ' + e.message); }

  // ⑥ resume：中途刷新＝续测，到点自动出报告
  try {
    if (!(await nav('resume'))) throw new Error('页面 boot 超时');
    await evalJs('(function(){ window.mochiEnergyCheck.startBattery(15000); return 1; })()');
    await sleep(4000);
    const r1 = await evalJs("(function(){ var v = localStorage.getItem('xy-home-v2:battery-check-run'); var o = v ? JSON.parse(v) : null; return { ms: o ? o.ms : 0, n: o ? o.n : -1, has: !!o }; })()");
    ok('B26 起测后 run 记录持久化（删＝刷新/被杀进程后续测全丢）', !!(r1 && r1.has && r1.ms === 15000));
    await cdp('Page.reload', { ignoreCache: true });
    await sleep(2500);
    const r2 = await evalJs("(function(){ return { has: !!localStorage.getItem('xy-home-v2:battery-check-run'), run: window.mochiEnergyCheck.batteryRunning() }; })()");
    ok('B27 刷新后未到点＝续测接着跑（删＝刷新＝自测作废）', !!(r2 && r2.has === true && r2.run === true));
    let m3 = null;
    for (let i = 0; i < 60; i++) { m3 = await modalState(); if (m3 && m3.vis && m3.title) break; await sleep(500); }
    ok('B28 到点自动出报告（不点任何东西）', !!(m3 && m3.vis && m3.title === '电量消耗自测报告' && m3.text.indexOf('结论：') >= 0));
    const r3 = await evalJs("localStorage.getItem('xy-home-v2:battery-check-run')");
    ok('B29 续测出报告后 run 键已清', r3 === null);
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑥ resume 执行失败: ' + e.message); }

  // ⑦ heat：发烫自测跑满 + 判级 + 落键 + 确认弹窗
  try {
    if (!(await nav('heat'))) throw new Error('页面 boot 超时');
    await clickId('row-heat-check');
    await sleep(300);
    const mh = await modalState();
    ok('B30 点发烫行＝确认弹窗（讲清「读不到温度、测的是降频后果」）', !!(mh && mh.vis && mh.title === '发烫自测' && mh.staticText.indexOf('读不到手机温度') >= 0));
    // #1015：时长不再写死，改成 4 档胶囊（10 秒·快测 / 1 分钟 / 3 分钟 / 5 分钟），默认 3 分钟
    const hPill = await evalJs("(function(){ var p=document.querySelector('#modal-pills .pill.on'); return p ? p.textContent : ''; })()");
    ok('B31 发烫档位胶囊 4 档、默认 3 分钟（删档位＝又回到写死的 10 秒，用户报的「测试时间太短」复发）',
      !!(mh && mh.pills.length === 4 && mh.ok.indexOf('开始') >= 0 && hPill === '3 分钟'), { pills: mh && mh.pills, on: hPill, ok: mh && mh.ok });
    await clickId('modal-cancel');
    await sleep(200);
    const hr0 = await evalJs("localStorage.getItem('xy-home-v2:heat-check-last')");
    ok('B32 取消＝不发车（删＝点取消也跑满负载，白耗电）', hr0 === null);
    const hrep = await evalJs('window.mochiEnergyCheck.startHeat()');
    // #1015：负载改 60ms 切片（原 10 轮 ×700ms 同步阻塞，时长一拉长页面就无响应）
    ok('B33 固定负载按 60ms 切片跑满整档且按本机速度现场校准（10 秒档 ≥100 片、workN ≥ 500）',
      !!(hrep && hrep.slices && hrep.slices.length >= 100 && hrep.workN >= 500 && hrep.loadMs >= 9000), { n: hrep && hrep.slices && hrep.slices.length, loadMs: hrep && hrep.loadMs, n2: hrep && hrep.workN });
    const hExp = hrep ? (hrep.slow >= 0.25 ? '明显降频' : (hrep.slow >= 0.10 ? '轻度降频' : '未见降频')) : '';
    ok('B34 判级与实测数字一致（首尾 10% 中位 + 6 段趋势；改档/写死＝结论与数字对不上）',
      !!(hrep && hrep.text.indexOf('结论：' + hExp) === 0 && hrep.text.indexOf('负载耗时趋势（整窗按时间分成 6 段的中位）') >= 0 && typeof hrep.slow === 'number' && hrep.bins && hrep.bins.length === 6), { bins: hrep && hrep.bins });
    ok('B34b 短档照实标「快测」（10 秒档热不起来，报告要点明「只说明此刻有没有被限速」）',
      !!(hrep && hrep.short === true && hrep.text.indexOf('秒快测：只说明') >= 0));
    ok('B35 说明如实（读不到温度＝测的是后果，全平台口径）', !!(hrep && hrep.text.indexOf('浏览器读不到手机温度') >= 0 && hrep.text.indexOf('固定负载') >= 0));
    const hl = await evalJs("(function(){ var v = localStorage.getItem('xy-home-v2:heat-check-last'); var o = v ? JSON.parse(v) : null; return { v: o ? o.verdict : '', t: o ? o.text : '', p: o ? o.pending : -1 }; })()");
    ok('B36 结果落 last 键（行小字/翻查用；pending=0 表示已交付）', !!(hl && hl.v && hl.t && hl.p === 0));
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑦ heat 执行失败: ' + e.message); }

  // ⑧ ui：点行起测 → 进行中再点行＝结束并出报告 → 报告弹窗接上
  try {
    if (!(await nav('ui'))) throw new Error('页面 boot 超时');
    await clickId('row-battery-check');
    await sleep(300);
    await clickId('modal-ok');
    await sleep(600);
    const started = await evalJs("(function(){ var v = localStorage.getItem('xy-home-v2:battery-check-run'); return !!(v && window.mochiEnergyCheck.batteryRunning()); })()");
    ok('B37 弹窗点「开始测」＝真起测（run 落盘 + 计时在跑）', started === true);
    await clickId('row-battery-check');
    await sleep(300);
    const mR = await modalState();
    ok('B38 进行中再点行＝给「结束并出报告」出口（不是没反应）', !!(mR && mR.vis && mR.title === '电量消耗自测进行中' && mR.ok === '结束并出报告'));
    await clickId('modal-ok');
    await sleep(900);
    const mFin = await modalState();
    ok('B39 结束＝报告弹窗紧接着出（嵌套弹窗不互相吞）', !!(mFin && mFin.vis && mFin.title === '电量消耗自测报告' && mFin.text.indexOf('结论：') >= 0));
    const uEnd = await evalJs("localStorage.getItem('xy-home-v2:battery-check-run')");
    ok('B40 结束后 run 键已清（防重复出报告）', uEnd === null);
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑧ ui 执行失败: ' + e.message); }

  // ⑨ badrun：坏 run 记录（旧版本残留/半截 JSON 等价形态）＝早退不出假报告
  try {
    if (!(await nav('badrun'))) throw new Error('页面 boot 超时');
    await sleep(500);
    const mB = await modalState();
    const lkB = await evalJs("localStorage.getItem('xy-home-v2:battery-check-last')");
    let ljB = null; try { ljB = JSON.parse(lkB); } catch (e) {}
    ok('B41 坏 run 记录不弹假报告（删守卫＝拿垃圾记录算出 NaN 报告，用户以为真测过）', !!(mB && mB.vis === false && !(ljB && ljB.text)));
    const okStart = await evalJs('(function(){ return typeof window.mochiEnergyCheck.startBattery === "function" && window.mochiEnergyCheck.batteryRunning() === false; })()');
    ok('B42 坏记录之后自测仍可用（不卡死在恢复分支）', okStart === true);
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑨ badrun 执行失败: ' + e.message); }

  // ⑩ jitter：电量计抖动（掉一格回一格、净掉电 0）＝各段速率封顶到实测净值（#947 缺陷 1）
  try {
    if (!(await nav('jitter'))) throw new Error('页面 boot 超时');
    const rep = await evalJs('window.mochiEnergyCheck.startBattery(12000)');
    ok('B43 夹具前提：抖动电量计被真读到多次采样（桩失败则本场景无意义）', !!(rep && rep.run && rep.run.n >= 3));
    ok('B44 夹具形状正确：有符号净掉电恒 ≤0（毛和只记下降才会涨，净值不涨＝抖动不是耗电）', !!(rep && rep.run && rep.run.net <= 0));
    ok('B45 抖动被抓出来并写进报告（删封顶＝单边毛和直接当掉电，#947 缺陷 1 复发）', !!(rep && rep.run && rep.run.jitter >= 1 && rep.text.indexOf('电量计抖动') >= 0));
    ok('B46 各段速率被折算到 0%/小时（虚高的几十 %/小时不再出现在报告里）', !!(rep && rep.text.indexOf('前台使用（屏幕亮着用本站）：约 0%/小时') >= 0 && !/：约 [1-9][0-9.]*%\/小时/.test(rep.text)));
    ok('B47 封顶不顺手改口径：短窗口照旧标「粗测」', !!(rep && rep.text.indexOf('粗测') >= 0));
    ok('B48 抖动窗不判异常（净掉电为 0 时给「数据不足」，不给用户看虚高结论）', !!(rep && rep.verdict === '数据不足'));
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑩ jitter 执行失败: ' + e.message); }

  // ⑪ throttle：后台心跳被内核节流＝那段归「不确定」，不再塞进「与本站无关」的未运行段（#947 缺陷 2）
  try {
    if (!(await nav('throttle'))) throw new Error('页面 boot 超时');
    const rep = await evalJs('window.mochiEnergyCheck.startBattery(12000)');
    ok('B49 节流那段进了不确定段（旧实现一律归未运行＝#947 缺陷 2 复发）', !!(rep && rep.run && rep.run.unkMs >= 6000));
    ok('B50 那段没被算进「与本站无关」的对照组（删＝给本站开脱、报告成了一张假清白）', !!(rep && rep.run && rep.run.gapMs === 0));
    ok('B51 报告点名不确定段并写明不计入结论（两种归因方向相反，不替系统猜）', !!(rep && rep.text.indexOf('不确定（心跳停了') >= 0 && rep.text.indexOf('不计入结论') >= 0));
    ok('B52 报告给出心跳被限制的实测证据（设计间隔 vs 实测平均）', !!(rep && rep.text.indexOf('心跳被限制') >= 0 && rep.text.indexOf('实测平均每') >= 0));
    ok('B53 防修过头：不确定段不参与判级（节流窗不给异常结论，也不给正常背书）', !!(rep && rep.verdict === '数据不足'));
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑪ throttle 执行失败: ' + e.message); }

  // ⑫ pendlast：挂着未读报告关页重开＝开屏离场后补弹一次（#947 缺陷 4）
  try {
    if (!(await nav('pendlast'))) throw new Error('页面 boot 超时');
    await sleep(900);
    const splashUp = await evalJs("(function(){ var s = document.getElementById('splash'); return !!(s && !s.classList.contains('hide')); })()");
    const m0 = await modalState();
    const l0 = await evalJs("(function(){ var o = null; try { o = JSON.parse(localStorage.getItem('xy-home-v2:battery-check-last')); } catch (e) {} return { p: o && typeof o.pending === 'number' ? o.pending : -1 }; })()");
    ok('B54 夹具前提：开屏强读页仍在场（不在场则测不到补弹闸）', splashUp === true);
    ok('B55 开屏没离场＝报告不抢着弹（删闸＝报告压在公告上，用户只能关掉＝等于又丢一次）', !!(m0 && !(m0.vis && m0.title === '电量消耗自测报告')) && l0.p === 1);
    const subP0 = await evalJs("(function(){ var e = document.querySelector('#row-battery-check .sub'); return e ? e.textContent : ''; })()");
    ok('B56 行小字标出「有未读报告」（删＝用户不知道有一条全文没看过）', subP0.indexOf('未读') >= 0);
    await evalJs("(function(){ var s = document.getElementById('splash'); if (s) s.classList.add('hide'); return 1; })()");
    let m1 = null;
    for (let i = 0; i < 24; i++) { m1 = await modalState(); if (m1 && m1.vis && m1.title === '电量消耗自测报告') break; await sleep(400); }
    ok('B57 开屏离场＝补弹一次（重开页面这条路径以前永不弹）', !!(m1 && m1.vis && m1.title === '电量消耗自测报告' && m1.text.indexOf('夹具植入的挂起报告') >= 0));
    const l1 = await evalJs("(function(){ var o = null; try { o = JSON.parse(localStorage.getItem('xy-home-v2:battery-check-last')); } catch (e) {} return { p: o && typeof o.pending === 'number' ? o.pending : -1 }; })()");
    ok('B58 补弹后 pending 已清（不清＝每次重开都重弹一遍）', l1.p === 0);
    const subP1 = await evalJs("(function(){ var e = document.querySelector('#row-battery-check .sub'); return e ? e.textContent : ''; })()");
    ok('B59 已读后行小字撤掉未读标记', subP1.indexOf('未读') < 0);
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑫ pendlast 执行失败: ' + e.message); }

  // ⑬ #1015 heat2：档位 + 整窗趋势 + 快测口径（发烫自测时长放开后的判级形态）
  try {
    if (!(await nav('heat'))) throw new Error('页面 boot 超时');
    await clickId('row-heat-check');
    await sleep(300);
    const mh2 = await modalState();
    const hOn = await evalJs("(function(){ var p=document.querySelector('#modal-pills .pill.on'); return p ? p.textContent : ''; })()");
    ok('C1 发烫弹窗默认选中 3 分钟档（默认值必须真能测出「越跑越慢」——手机从冷到热要 1 分钟以上）',
      !!(mh2 && mh2.pills.length === 4 && hOn === '3 分钟' && mh2.staticText.indexOf('10 秒档只能答') >= 0), { on: hOn, static: (mh2 && mh2.staticText || '').slice(0, 40) });
    await clickId('modal-cancel');
    await sleep(200);
    const h2 = await evalJs('window.mochiEnergyCheck.startHeat(null, 10000)');
    ok('C2 报告给出 6 段趋势线（删＝又只剩开头/末尾两个点，热降频的中途回升看不见）',
      !!(h2 && h2.bins && h2.bins.length === 6 && h2.text.indexOf('负载耗时趋势（整窗按时间分成 6 段的中位）') >= 0));
    ok('C3 判级只取首尾 10% 中位且阈值口径不变（<10% 未见 / 10~25% 轻度 / ≥25% 明显）',
      !!(h2 && h2.text.indexOf('开头 10% 中位') >= 0 && h2.text.indexOf('最后 10% 中位') >= 0 && h2.text.indexOf('判级：<10% 未见降频') >= 0));
    ok('C4 说明段写明「短档只答此刻、要看趋势用 3 分钟档」（删＝用户以为 10 秒能测发烫）',
      !!(h2 && h2.text.indexOf('短档只答') >= 0 && h2.text.indexOf('3 分钟档') >= 0));
    ok('C5 帧率口径如实：负载前/负载后各一段，负载期掉帧标明「属预期」（自己占满 CPU 不是缺陷）',
      !!(h2 && h2.text.indexOf('负载前静置约') >= 0 && h2.text.indexOf('负载后静置约') >= 0 && h2.text.indexOf('属预期') >= 0));
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑬ heat2 执行失败: ' + e.message); }

  // ⑭ #1015 heat3：提前结束出口 + 页面不可见暂停（长窗口的两条生命线）
  try {
    if (!(await nav('heat'))) throw new Error('页面 boot 超时');
    const h3 = await evalJs(`(async function(){
      var p = window.mochiEnergyCheck.startHeat(null, 60000);
      await new Promise(function(r){ setTimeout(r, 1200); });
      var wasRunning = window.mochiEnergyCheck.heatRunning();
      window.mochiEnergyCheck.stopHeat();
      var rep = await p;
      return { running: wasRunning, stopped: rep ? rep.stopped : -1, text: rep ? rep.text : '', n: rep ? rep.slices.length : 0 };
    })()`);
    ok('C6 进行中有提前结束出口（stopHeat 生效；删＝3 分钟档点下去出不来，用户只能干等或杀页面）',
      !!(h3 && h3.running === true && h3.stopped === 1 && h3.text.indexOf('本次提前结束') >= 0), { running: h3 && h3.running, n: h3 && h3.n });
    // 出口要连 UI 一起测：走弹窗起一轮（默认 3 分钟档）不等它跑完，再点本行拿「提前结束并出报告」
    await clickId('row-heat-check');
    await sleep(300);
    await clickId('modal-ok');
    await sleep(1500);
    const runOn = await evalJs("window.mochiEnergyCheck.heatRunning()");
    await clickId('row-heat-check');
    await sleep(300);
    const mRun = await modalState();
    ok('C7 进行中再点本行＝「提前结束并出报告」弹窗（不是没反应）',
      !!(runOn === true && mRun && mRun.vis && mRun.title === '发烫自测进行中' && mRun.ok === '提前结束并出报告'), { run: runOn, t: mRun && mRun.title });
    await clickId('modal-ok');
    await sleep(1600);
    const mAfter = await modalState();
    ok('C8 点「提前结束并出报告」＝报告紧接着出（嵌套弹窗不互相吞）', !!(mAfter && mAfter.vis && mAfter.title === '发烫自测报告'), { t: mAfter && mAfter.title });
    await clickId('modal-cancel');
    await sleep(200);
    const h4 = await evalJs(`(async function(){
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      var p = window.mochiEnergyCheck.startHeat(null, 10000);
      await new Promise(function(r){ setTimeout(r, 5000); });
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.mochiEnergyCheck.stopHeat();
      var rep = await p;
      return { pauseMs: rep ? rep.pauseMs : -1, loadMs: rep ? rep.loadMs : -1, n: rep ? rep.slices.length : -1, text: rep ? rep.text : '' };
    })()`);
    ok('C9 页面不可见＝负载暂停（不可见的那几秒不被算成负载、也不在后台白烧电）',
      !!(h4 && h4.pauseMs >= 1500 && h4.loadMs < 3000 && h4.n < 40), { pauseMs: h4 && h4.pauseMs, loadMs: h4 && h4.loadMs, n: h4 && h4.n });
    ok('C10 暂停时长在报告里如实标出（删＝用户看到「负载没跑满」却不知道是切后台了）',
      !!(h4 && h4.text.indexOf('中途页面不可见') >= 0));
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑭ heat3 执行失败: ' + e.message); }

  // ⑮ #1015 coarse：电量分段粗测口径（5~15 分钟不再长得像 1 小时的段）
  try {
    if (!(await nav('coarse'))) throw new Error('页面 boot 超时');
    await sleep(500);
    const mc = await modalState();
    const tc = (mc && mc.text) || '';
    await clickId('modal-cancel');
    ok('C11 5~15 分钟的段也标粗测（10 分钟的前台段；旧版只有 <5 分钟才标，用户会拿它当结论）',
      tc.indexOf('前台使用（屏幕亮着用本站）：约') >= 0 && tc.indexOf('不足 15 分钟，粗测') >= 0, { seg: (tc.match(/· 前台使用[^\n]*/) || [''])[0] });
    ok('C12 ≥15 分钟的段照旧给正式参考带（防一刀切把长窗口的结论也标成粗测）',
      tc.indexOf('后台页面自身（切出去了、页面还在跑，多与「后台保活」相关）：约') >= 0 && tc.indexOf('参考：≤3 正常 / 3~8 偏高 / >8 异常') >= 0, { seg: (tc.match(/· 后台页面自身[^\n]*/) || [''])[0] });
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑮ coarse 执行失败: ' + e.message); }

  // ⑯ #1015b coarse5：5~15 分钟的段不得驱动判级（1% 颗粒度下 5 分钟一段＝±12%/小时，比整条参考带还宽）
  try {
    if (!(await nav('coarse5'))) throw new Error('页面 boot 超时');
    await sleep(500);
    const m5 = await modalState();
    const t5 = (m5 && m5.text) || '';
    await clickId('modal-cancel');
    ok('C13 只有 5~15 分钟的段时不判级（旧版：10 分钟的前台段直接给出「结论：异常」＋「关掉后台保活」的建议，而同一份报告的明细行写着「粗测、仅供参考」）',
      t5.indexOf('结论：数据不足') === 0 && t5.indexOf('各段样本都不足 15 分钟') >= 0 && t5.indexOf('结论：异常') < 0, { head: t5.slice(0, 90) });
    ok('C14 窗口后缀按用户选的档位判（30 分钟档＝属粗测；旧版按 totalMs 算，页面被系统关掉的那段也算进窗口）',
      t5.indexOf('· 窗口不足 1 小时，属粗测') >= 0);
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑯ coarse5 执行失败: ' + e.message); }

  // ⑰ #1015b heat4：负载时钟只算真在算的时间 + 静置/收尾的边界口径
  try {
    if (!(await nav('heat'))) throw new Error('页面 boot 超时');
    const h5 = await evalJs('window.mochiEnergyCheck.startHeat(null, 10000)');
    const sum = h5 && h5.slices ? h5.slices.reduce(function (a, b) { return a + b; }, 0) : -1;
    const ratio = h5 && h5.loadMs > 0 ? sum / h5.loadMs : -1;
    ok('C15 负载时钟只累计「真在算」的时间（sum(每片) / loadMs ≈ 1；旧写法把片间 setTimeout 往返也算进去，比值恒约 0.88＝3 分钟档只压 2.7 分钟）',
      !!(ratio > 0.95 && ratio <= 1.0001), { ratio: ratio, sum: sum, loadMs: h5 && h5.loadMs });
    ok('C16 报告印实测每片中位（不再把设计目标 60ms 说成实情）',
      !!(h5 && h5.text.indexOf('每片实测算') >= 0 && h5.text.indexOf('片 × 约 60ms') < 0));
    ok('C17 帧率行不印 0fps（测不到就说「未测到」；0fps 会被读成卡死，而真相是那段页面不可见）',
      !!(h5 && h5.text.indexOf('约 0fps') < 0 && (h5.text.indexOf('负载前静置约') >= 0 || h5.text.indexOf('负载前静置：未测到') >= 0)));
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑰ heat4 执行失败: ' + e.message); }

  // ⑱ #1015b heat5：收尾期（负载已跑完、正在静置）切后台，暂停时长仍要进报告
  try {
    if (!(await nav('heat'))) throw new Error('页面 boot 超时');
    const h6 = await evalJs(`(async function(){
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      var p = window.mochiEnergyCheck.startHeat(null, 10000);
      await new Promise(function(r){ setTimeout(r, 14000); });          // 静置 3s + 负载 10s → 此刻在收尾静置里
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(function(r){ setTimeout(r, 1500); });
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      var rep = await p;
      return { pauseMs: rep ? rep.pauseMs : -1, text: rep ? rep.text : '' };
    })()`);
    ok('C18 收尾期被切后台＝暂停时长照样进报告（旧版只让 slice() 结算，静置/收尾期的暂停被整块丢掉，报告只字不提）',
      !!(h6 && h6.pauseMs >= 1200 && h6.text.indexOf('中途页面不可见') >= 0), { pauseMs: h6 && h6.pauseMs });
    await collectErrs();
  } catch (e) { fail++; console.error('❌ 场景⑱ heat5 执行失败: ' + e.message); }

  ok('Z 零 JS 异常（十八场景全程）', jsErrors.length === 0);
  if (jsErrors.length) console.log('   异常抽样: ' + jsErrors.slice(0, 3).join(' | '));
} catch (e) {
  fail++; ctxOk = false; console.error('❌ B 组执行失败: ' + e.message);
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}

console.log('\n#935 结果: 通过 ' + pass + ' / 失败 ' + fail + (ctxOk ? '' : '（上下文异常）'));
process.exit(fail ? 1 : 0);
