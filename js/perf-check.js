(function () { try {
(function () {
'use strict';
if (window.mochiPerfCheck) return;
var LAST_KEY = 'xy-home-v2:perf-check-last';
var BG_GAP = 250;    // >250ms 间隙＋确有隐藏期＝切后台/锁屏冻结帧，剔除不计（#707 同款教训：后台 144s 间隙会被误判成超级卡顿）；#934 起「无隐藏期的 >250ms」＝亮屏下主线程被卡住＝前台冻结，照常计入
var BG_HARD = 60000; // 无隐藏期的超长间隙兜底：>60s 不可能是前台阻塞（老内核不派发 visibilitychange 时仍按后台剔除，保 #707 防线）
var MIN_JANK = 24;   // 自适应掉帧阈值下限 ms（60Hz 算出 ≈33ms≈旧 32ms；高刷屏收紧；自适应刷新率降档时靠下限不误报）
var MAX_JANK = 34;   // 自适应掉帧阈值上限 ms（持续掉帧会把实测周期抬高，上限兜住不漏判幻灯片式卡顿）
var SEVERE_MS = 100; // >100ms ＝ 严重卡顿
var KB_RATIO = 0.85; // 可视高度 < 视口高度 85% ＝ 键盘弹出期（iOS 键盘期视口变形掉帧常见）
var PAGE_CN = { main: '手机桌面', chat: '聊天', 'group-chat': '群聊', home: '桌面二页', mail: '信箱', feed: '朋友圈', calendar: '日历', memory: '纪念', divination: '占卜', note: '备忘录', p2: '功能页', music: '音乐', records: '记录', garden: '花园', room: '房间', 'drift-bottle': '漂流瓶' };
var PAGE_ID_CN = { phone: '手机桌面', chat: '聊天', 'group-chat': '群聊', home: '桌面二页', mail: '信箱', 'mail-write': '写信箱', 'mail-reply': '回信箱', feed: '朋友圈', calendar: '日历', memory: '纪念', divine: '占卜', music: '音乐', stats: '统计', interact: '互动', checkin: '打卡', 'checkin-cards': '打卡字卡', garden: '花园', room: '房间', drift: '漂流瓶', period: '经期', accounting: '记账', theme: '主题', setting: '设置', storage: '查看存储', 'card-audit': '字卡自检', chatcard: '字卡库', featurehub: '功能中心', 'feature-data': '功能数据', deskcheck: '屏幕适配诊断', guide: '功能介绍', about: '关于', 'chat-settings': '聊天设置', 'reply-settings': '回复设置', 'call-settings': '通话设置', 'sfx-settings': '音效设置', 'custom-cards': '自定义字卡', 'default-cards': '默认字卡', 'dict-cards': '词典字卡', 'fun-cards': '趣味字卡', 'quote-cards': '语录字卡', 'loc-cards': '定位字卡', 'mood-cards': '心情字卡', 'reply-cards': '回复字卡', fav: '收藏', 'fav-settings': '收藏设置' };
var _running = false;
var minD = 0; // 窗口内实测刷新周期 ≈ 反复出现的最小帧间隔（模块级：jankThr 要读；_running 保证同一时间只有一个窗口在写）
var gapHist = {}; // 帧间隔直方图（取整 ms → 出现次数）
var gapFrames = 0; // 进直方图的样本数（周期估计的分母）
function pageName(key) { return PAGE_ID_CN[key] || PAGE_CN[key] || key; }
function curPage() {
try {
var pages = document.querySelectorAll('.page:not([hidden])');
var best = null, bestZ = -1;
for (var i = 0; i < pages.length; i++) {
var z = 0;
try { z = parseInt(getComputedStyle(pages[i]).zIndex, 10) || 0; } catch (e1) {}
if (z >= bestZ) { bestZ = z; best = pages[i]; }
}
if (!best) return '?';
var id = best.id || '';
if (id === 'page-phone') return 'main';
return pageName(id.replace(/^page-/, ''));
} catch (e) { return '?'; }
}
function kbOn() {
try {
var vv = window.visualViewport;
return !!(vv && window.innerHeight && vv.height < window.innerHeight * KB_RATIO);
} catch (e) { return false; }
}
function pct(n, d) { return d > 0 ? Math.round(n / d * 1000) / 10 : 0; }
function verdictOf(jankPct, severe) {
if (jankPct >= 20 || severe >= 10) return '重度';
if (jankPct >= 8) return '中度';
if (jankPct >= 2) return '轻度';
return '流畅';
}
function concOk(r) {
if (r.janky < 3 || !r.topPage) return false;
var pf = r.pageFrames[r.topPage] || 0, pj = r.pages[r.topPage] || 0;
if (pf < 30 || pj < 3) return false;
var of = r.frames - pf, oj = r.janky - pj;
if (of < 30) return true;
return (pj / pf) >= 2 * (oj / of);
}
function jankThr() { return Math.min(Math.max(minD * 2, MIN_JANK), MAX_JANK); } // #770：阈值随实测刷新周期自适应
function periodEst() {
var anyMin = 0, repMin = 0;
for (var k in gapHist) {
var v = +k;
if (!anyMin || v < anyMin) anyMin = v;
if (gapHist[k] >= 3 && (!repMin || v < repMin)) repMin = v;
}
minD = repMin || anyMin;
}
function storageAgg() {
try {
if (!window.mochiCcSlimScan || !window.mochiPerfAgg || !window.mochiPerfLevel) return null;
var agg = window.mochiPerfAgg(window.mochiCcSlimScan());
return (agg && agg.ok) ? agg : null;
} catch (e) { return null; }
}
function start(ms, onTick) {
return new Promise(function (resolve) {
if (_running) return resolve(null);
_running = true;
ms = Math.max(3000, Math.min(300000, Number(ms) || 30000));
onTick = typeof onTick === 'function' ? onTick : function () {};
var rep = { t: Date.now(), ms: ms, frames: 0, janky: 0, severe: 0, worst: 0, hid: 0,
kbFrames: 0, kbJanky: 0, pages: {}, pageFrames: {}, jankMs: 0, period: 0, fps: 0, lt: null,
int: null, scene: [], lp: false, bgMs: 0, effMs: 0, fz: 0, fzWorst: 0, topCnt: '' };
var last = performance.now(), t0 = last, raf = 0, done = false;
var bgMs = 0, hiddenAt = -1, hidPending = 0;
function onVis() {
var now = performance.now();
if (document.hidden) { hiddenAt = now; hidPending = 1; }
else if (hiddenAt >= 0) { bgMs += now - hiddenAt; hiddenAt = -1; }
}
try { document.addEventListener('visibilitychange', onVis, { passive: true }); } catch (e) {}
var lt = { ok: false, n: 0, worst: 0, bgN: 0, top: [], agg: {} }, po = null;
try {
po = new PerformanceObserver(function (list) {
try {
var es = list.getEntries() || [];
for (var i = 0; i < es.length; i++) {
if (es[i] && es[i].duration >= 50) {
lt.n++;
var dms = Math.round(es[i].duration);
if (dms > lt.worst) lt.worst = dms;
var ltBg = document.hidden ? 1 : 0;
if (ltBg) lt.bgN++;
if (!ltBg) { var _ltP = curPage(), _ag = lt.agg[_ltP] || (lt.agg[_ltP] = { n: 0, ms: 0 }); _ag.n++; _ag.ms += dms; }
lt.top.push({ at: Math.round((es[i].startTime - t0) / 100) / 10, ms: dms, pg: curPage(), bg: ltBg, kb: kbOn() ? 1 : 0, sw: (performance.now() - swAt) <= 500 ? 1 : 0 });
lt.top.sort(function (a, b) { return b.ms - a.ms; });
if (lt.top.length > 3) lt.top.length = 3;
}
}
} catch (e2) {}
});
po.observe({ type: 'longtask' }); lt.ok = true;
} catch (e) {}
var lastDown = -1, intArr = [], intWorst = -1, intWorstPg = '';
var swAt = -1e9, lastPgSeen = '', scene = [];
var downEv = window.PointerEvent ? 'pointerdown' : 'mousedown';
function onDown() { lastDown = performance.now(); }
try { document.addEventListener(downEv, onDown, { passive: true }); } catch (e) {}
minD = 0; gapHist = {}; gapFrames = 0;
var first = true;
function finish() {
if (done) return;
done = true;
try { if (po) po.disconnect(); } catch (e) {}
try { document.removeEventListener(downEv, onDown); } catch (e) {} // #818 响应监听随窗拆除
try { document.removeEventListener('visibilitychange', onVis); } catch (e) {} // #934 可见性监听随窗拆除
if (hiddenAt >= 0) { bgMs += performance.now() - hiddenAt; hiddenAt = -1; } // 窗口在后台里结束的尾段
rep.bgMs = Math.round(bgMs);
rep.effMs = Math.max(0, rep.ms - rep.bgMs); // 前台有效时长（fps 的分母与报告展示都按它）
rep.lt = lt.ok ? lt : null;
rep.jankMs = Math.round(jankThr());
rep.period = Math.round(minD * 10) / 10;
rep.fps = rep.effMs >= 1000 ? Math.round(rep.frames * 10000 / rep.effMs) / 10 : 0;
if (intArr.length) {
var sorted = intArr.slice().sort(function (a, b) { return a - b; });
var slowN = 0;
for (var si = 0; si < intArr.length; si++) { if (intArr[si] >= 100) slowN++; }
rep.int = { n: intArr.length, med: Math.round(sorted[Math.floor(sorted.length / 2)]), worst: Math.round(intWorst), slow: slowN, worstPg: intWorstPg };
}
rep.scene = scene;
rep.lp = minD >= 28;
rep.jankPct = pct(rep.janky, rep.frames);
rep.kbPct = pct(rep.kbJanky, rep.janky);     // 掉帧里键盘期占比
rep.kbShare = pct(rep.kbFrames, rep.frames); // 全部帧里键盘期占比
var top = '', topRate = -1, cnt = '', cntN = 0, tot = 0;
for (var k in rep.pages) {
tot += rep.pages[k];
if (rep.pages[k] > cntN) { cnt = k; cntN = rep.pages[k]; }
var pkF = rep.pageFrames[k] || 0;
if (pkF >= 30) {
var pkR = rep.pages[k] / pkF;
if (pkR > topRate) { topRate = pkR; top = k; }
}
}
rep.topPage = tot > 0 ? (top || cnt) : '';
rep.topCnt = cnt;
rep.verdict = verdictOf(rep.jankPct, rep.severe);
setTimeout(function () {
var agg = storageAgg();
rep.storage = agg ? { level: window.mochiPerfLevel(agg.totalBytes, agg.bigGroups), libs: agg.libs, mb: Math.round((agg.totalBytes || 0) / 104857) / 10 } : null;
var prev = null;
try { prev = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e3) {}
rep.prev = (prev && typeof prev === 'object') ? prev : null;
rep.text = buildText(rep);
try { localStorage.setItem(LAST_KEY, JSON.stringify({ t: rep.t, verdict: rep.verdict, jankPct: rep.jankPct, ms: rep.ms, frames: rep.frames, janky: rep.janky, worst: rep.worst, fz: rep.fz, fzWorst: rep.fzWorst, fps: rep.fps, ltN: rep.lt ? rep.lt.n : undefined, ltWorst: rep.lt ? rep.lt.worst : undefined })); } catch (e2) {}
_running = false;
resolve(rep);
}, 50);
}
function frame(now) {
if (done) return;
var d = now - last, prevLast = last; last = now;
var wasBg = hidPending; hidPending = 0; // #934：自上一帧以来是否真发生过隐藏（visibilitychange 实报）
if (document.hidden) {
rep.hid++; // 帧回调落到隐藏期（兜底），不计入样本
} else if (d > BG_GAP && (wasBg || d > BG_HARD)) {
rep.hid++; // 后台/锁屏冻结段剔除：隐藏时长已由 visibilitychange 计入 bgMs，不重复累计
} else {
rep.frames++;
var pg = curPage();
rep.curPg = pg; // #906：当前所在页（进度浮条实时显示，让用户知道采样在跟着走）
rep.pageFrames[pg] = (rep.pageFrames[pg] || 0) + 1;
if (pg !== lastPgSeen) { lastPgSeen = pg; swAt = now; } // #818 切页时刻（最慢帧现场归因用）
if (lastDown >= 0) { // #818 点按→下一帧结算响应延迟（含主线程拥堵；≥2s 视为切后台噪声丢弃）
var lat = now - lastDown; lastDown = -1;
if (lat >= 0 && lat < 2000) {
intArr.push(lat);
if (lat > intWorst) { intWorst = lat; intWorstPg = pg; }
}
}
if (first) { first = false; } // 首帧间隔是启动延迟，只计样本、不进周期/掉帧判定
else {
if (d >= 4 && d <= BG_GAP) { var _g = Math.round(d); gapHist[_g] = (gapHist[_g] || 0) + 1; gapFrames++; periodEst(); }
var kb = kbOn();
if (kb) rep.kbFrames++;
if (d > jankThr()) {
var fz = d > BG_GAP ? 1 : 0;
if (fz) {
rep.fz++; if (d > rep.fzWorst) rep.fzWorst = Math.round(d);
try {
var _pl = window.__mochiPhaseLog || [], _hit = '(无标记)';
var _startWall = Date.now() - Math.round(d);
for (var _pi = _pl.length - 1; _pi >= 0; _pi--) { if (_pl[_pi].t <= _startWall) { _hit = _pl[_pi].tag; break; } }
if (!rep.fzBy) rep.fzBy = {};
rep.fzBy[_hit] = (rep.fzBy[_hit] || 0) + 1;
} catch (e7) {}
}
rep.janky++;
if (kb) rep.kbJanky++;
if (d > SEVERE_MS) rep.severe++;
if (d > rep.worst) rep.worst = Math.round(d);
rep.pages[pg] = (rep.pages[pg] || 0) + 1;
scene.push({ at: Math.round((now - t0) / 100) / 10, ms: Math.round(d), pg: pg, kb: kb ? 1 : 0, sw: (now - swAt) <= 500 ? 1 : 0, fz: fz });
scene.sort(function (a, b) { return b.ms - a.ms; });
if (scene.length > 3) scene.length = 3;
}
}
}
if (now - t0 >= ms) return finish();
raf = requestAnimationFrame(frame);
}
raf = requestAnimationFrame(frame);
var tick = setInterval(function () {
if (done) { clearInterval(tick); return; }
onTick({ left: Math.max(0, Math.ceil((ms - (performance.now() - t0)) / 1000)), frames: rep.frames, janky: rep.janky, hid: rep.hid, pg: pageName(rep.curPg || '?') });
}, 500);
});
}
function buildText(r) {
var L = [];
var concl;
if (r.verdict === '流畅') concl = r.janky > 0 ? '（掉帧率 ' + r.jankPct + '%，可忽略）' : '（本窗口未捕获掉帧）';
else concl = '（掉帧率 ' + r.jankPct + '%）';
L.push('结论：' + r.verdict + concl);
var per = r.period > 0 ? '，正常帧间隔约 ' + r.period + 'ms' : '';
var eff = r.effMs == null ? r.ms : r.effMs;
var core = eff >= 1000 ? '平均 ' + r.fps + 'fps' + per : '前台时间不足 1 秒，未计 fps';
L.push('采样 ' + Math.round(r.ms / 1000) + ' 秒 / 有效帧 ' + r.frames + '（' + core + '；前台约 ' + Math.round(eff / 1000) + ' 秒，后台/锁屏 ' + Math.round((r.bgMs || 0) / 1000) + ' 秒已剔除）');
if (r.lp) L.push('· 实测刷新周期约 ' + r.period + 'ms（≈30fps 档）：iOS 低电量模式会把帧率减半，属系统行为——开了低电量请关闭后复测对照');
if (r.prev && typeof r.prev.janky === 'number') {
var pv = r.prev, _meta = [], _cp = ['掉帧 ' + pv.janky + '→' + r.janky + ' 帧'];
if (typeof pv.t === 'number' && pv.t > 0) {
var _dg = Date.now() - pv.t;
_meta.push(_dg < 60000 ? '刚刚' : _dg < 3600000 ? '约 ' + Math.round(_dg / 60000) + ' 分钟前' : _dg < 172800000 ? '约 ' + Math.round(_dg / 3600000) + ' 小时前' : Math.round(_dg / 86400000) + ' 天前');
}
if (typeof pv.ms === 'number' && pv.ms !== r.ms) _meta.push('上次为 ' + Math.round(pv.ms / 1000) + ' 秒档，时长不同仅供粗略对照');
if (typeof pv.fps === 'number' && pv.fps > 0 && r.fps > 0) _cp.push('平均帧率 ' + pv.fps + '→' + r.fps + 'fps');
if (pv.worst > 0 || r.worst > 0) _cp.push('最慢 ' + (pv.worst || 0) + '→' + r.worst + 'ms');
if ((pv.fz || 0) > 0 || r.fz > 0) _cp.push('前台冻结 ' + (pv.fz || 0) + '→' + r.fz + ' 次');
if (typeof pv.ltN === 'number' && r.lt) _cp.push('长任务 ' + pv.ltN + '→' + r.lt.n + ' 次');
L.push('· 与上次对比' + (_meta.length ? '（' + _meta.join('；') + '）' : '') + '：' + _cp.join('、'));
}
var majors = [];
for (var pk in r.pageFrames) { if (pk !== '?' && r.pageFrames[pk] > 0) majors.push([pk, r.pageFrames[pk]]); }
majors.sort(function (a, b) { return b[1] - a[1]; });
var mtxt = majors.slice(0, 2).map(function (m) { return pageName(m[0]) + ' ' + pct(m[1], r.frames) + '%'; }).join('、');
if (mtxt) L.push('· 采样期间主要在：' + mtxt);
if (r.frames < 120) L.push('· 有效样本偏少（可能大部分时间在后台），建议亮屏状态下重测');
if (r.frames > 0 && r.bgMs > r.ms * 0.5) L.push('· 采样期间约 ' + pct(r.bgMs, r.ms) + '% 时间在后台/锁屏（已剔除、不影响判定）；想测刚才的卡，建议亮屏状态下重测');
try {
var _kp3 = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null;
var _diedN = (_kp3 && _kp3.ev) ? (_kp3.ev.died || 0) : 0;
if (_diedN >= 3) L.push('· 本页已被系统回收过 ' + _diedN + ' 次（手机内存不够时 iOS 会直接关掉页面，切回来白屏/重载就是它、不是网站坏了、不丢数据）：先做两件事——①设置→系统 关掉「后台保活」②设置→工具→「查看存储」清掉最占地方的一项（表情包大图/旧聊天记录，删前先导出备份）');
} catch (e6) {}
if (r.janky > 0) {
L.push('· 掉帧 ' + r.janky + ' 帧（间隔>' + r.jankMs + 'ms），其中严重 ' + r.severe + ' 帧（>100ms），最慢一帧 ' + r.worst + 'ms');
if (r.fz > 0) L.push('· 前台冻结 ' + r.fz + ' 次（亮屏下主线程被卡住 >' + BG_GAP + 'ms，最长 ' + r.fzWorst + 'ms）——现场见下方「最慢帧现场」的前台冻结标记');
if (r.fzBy) {
var _fk = Object.keys(r.fzBy).sort(function (a, b) { return r.fzBy[b] - r.fzBy[a]; }).slice(0, 4);
if (_fk.length && r.fzBy[_fk[0]] > 0) {
L.push('· 冻结前序操作（取证）：' + _fk.map(function (k) { return k + ' ×' + r.fzBy[k]; }).join('、'));
}
}
if (concOk(r)) {
var _of = r.frames - (r.pageFrames[r.topPage] || 0), _oj = r.janky - (r.pages[r.topPage] || 0);
L.push('· 掉帧集中：' + pageName(r.topPage) + '（掉帧 ' + r.pages[r.topPage] + '/' + (r.pageFrames[r.topPage] || 0) + ' 帧，该页 ' + pct(r.pages[r.topPage], r.pageFrames[r.topPage]) + '% ' + (_of >= 30 ? 'vs 其余页 ' + pct(_oj, _of) + '%' : '，本窗口其余页样本不足）'));
} else if (r.topCnt) {
L.push('· 掉帧分散：最多的 ' + pageName(r.topCnt) + ' 也才 ' + r.pages[r.topCnt] + '/' + (r.pageFrames[r.topCnt] || 0) + ' 帧（' + pct(r.pages[r.topCnt], r.pageFrames[r.topCnt]) + '%），没有哪一页明显高于其余页——不是某一页特有的问题，重点看长任务与下方建议');
}
try {
var ka = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null;
if (ka && ka.keep) L.push('· 「后台保活」开着：页面会在后台一直跑，更耗电、发热、掉帧更明显——不用时到 设置→系统 关掉再对照测一轮');
} catch (e4) {}
if (r.kbJanky > 0) L.push('· 其中键盘弹出期 ' + r.kbJanky + ' 帧（键盘期视口变形 iOS 上常见；收起键盘对照可分辨）');
if (r.scene && r.scene.length) {
var ss = [], _mk = {};
for (var i2 = 0; i2 < r.scene.length; i2++) {
var sc = r.scene[i2];
if (sc.fz) _mk.fz = 1;
if (sc.kb) _mk.kb = 1;
if (sc.sw) _mk.sw = 1;
ss.push('第' + sc.at + '秒 ' + pageName(sc.pg) + ' ' + sc.ms + 'ms' + (sc.fz ? '·前台冻结' : '') + (sc.kb ? '·键盘期' : '') + (sc.sw ? '·切页后' : ''));
}
var _lg = [];
if (_mk.sw) _lg.push('「切页后」＝紧跟页面切换 0.5s 内，多为打开该页的一次性渲染成本');
if (_mk.kb) _lg.push('「键盘期」＝键盘弹出期（视口被压缩的变形帧，iOS 上常见）');
if (_mk.fz) _lg.push('「前台冻结」＝亮屏下主线程真被卡住 >' + BG_GAP + 'ms');
L.push('· 最慢帧现场：' + ss.join('；') + (_lg.length ? '（' + _lg.join('；') + '）' : ''));
}
}
if (r.lt) {
if (r.lt.n > 0) {
var ltTxt = '· 长任务（>50ms 主线程阻塞）窗口内 ' + r.lt.n + ' 次' + (r.lt.bgN ? '（其中 ' + r.lt.bgN + ' 次在后台/锁屏期）' : '') + '，最长 ' + r.lt.worst + 'ms';
if (r.lt.top && r.lt.top.length) {
var t3 = [];
for (var i3 = 0; i3 < r.lt.top.length; i3++) {
var e3 = r.lt.top[i3];
t3.push('第' + e3.at + '秒 ' + pageName(e3.pg) + ' ' + e3.ms + 'ms' + (e3.bg ? '·后台期' : '') + (e3.sw ? '·切页后' : '') + (e3.kb ? '·键盘期' : ''));
}
ltTxt += '；最长的 ' + t3.length + ' 次：' + t3.join('；');
}
L.push(ltTxt);
var _ag = r.lt.agg || {}, _agList = [], _agN = 0;
for (var _ap in _ag) { if (_ag[_ap].n > 0) { _agList.push([pageName(_ap), _ag[_ap].n, _ag[_ap].ms]); _agN += _ag[_ap].n; } }
if (_agN >= 2) {
_agList.sort(function (a, b) { return b[2] - a[2]; });
var _agTxt = _agList.slice(0, 3).map(function (x) { return x[0] + ' ' + x[1] + ' 次共 ' + x[2] + 'ms'; }).join('、');
if (_agList.length > 3) _agTxt += ' 等 ' + _agList.length + ' 页';
L.push('· 长任务按页面：' + _agTxt + (r.lt.bgN ? '（前台任务归总；另有 ' + r.lt.bgN + ' 次发生在后台/锁屏期，未计入）' : ''));
}
} else {
L.push('· 长任务（>50ms）：窗口内无');
}
} else {
L.push('· 长任务：此内核不支持观测（iOS WebKit），已用帧间隔等效判定');
}
if (r.int) {
L.push('· 点按响应：采样 ' + r.int.n + ' 次，中位 ' + r.int.med + 'ms、最慢 ' + r.int.worst + 'ms（最慢在' + pageName(r.int.worstPg) + '）' + (r.int.slow > 0 ? '；' + r.int.slow + ' 次超过 100ms＝「点了隔一下才动」体感的直接来源' : ''));
}
if (r.storage) {
L.push('· 本地数据画像：字卡库 ' + r.storage.libs + ' 个作用域 约 ' + r.storage.mb + ' MB（' + (r.storage.level === '重' ? '较重' : r.storage.level === '中' ? '中度' : '轻量') + '）');
}
L.push('');
L.push('建议：');
var adv = [];
if (r.storage && r.storage.level === '重') adv.push('本地数据过大（字卡库等）是本应用最常见的间歇卡顿主因——先做旁边「卡顿自检 · 一键优化」（不删数据）');
if (r.janky === 0) adv.push('本窗口未捕获掉帧；若体感仍卡，在卡顿出现的当下立即复测，更容易抓到现场');
else if (r.verdict === '流畅') {
var _fzN = r.fz || 0, _ltN = (r.lt && r.lt.n) || 0;
if (_fzN > 0 || _ltN > 0) {
var _w = [];
if (_fzN > 0) _w.push('前台冻结 ' + _fzN + ' 次（最长 ' + r.fzWorst + 'ms）');
if (_ltN > 0) _w.push('长任务 ' + _ltN + ' 次（最长 ' + r.lt.worst + 'ms）');
adv.push('掉帧本身零星（' + r.janky + ' 帧、最慢 ' + r.worst + 'ms），但窗口内有' + _w.join('、') + '——偶发卡顿更可能来自它们，按上面的现场与归因复测一轮');
} else adv.push('仅零星掉帧（' + r.janky + ' 帧、最慢 ' + r.worst + 'ms），属正常波动，无需处理');
}
if (concOk(r)) adv.push('掉帧集中在「' + pageName(r.topPage) + '」——该页操作时最明显，可对照排查最近往该页存过的大图/长内容');
if (r.int && r.int.slow > 0) adv.push('点按响应最慢 ' + r.int.worst + 'ms（在「' + pageName(r.int.worstPg) + '」）：掉帧集中在操作瞬间，优先排查该页的大图/长列表/数据落盘时机');
if (r.lp && r.verdict === '流畅') adv.push('本机在约 30fps 档运行＝iOS 低电量模式减半帧率（系统行为），关闭低电量模式即可恢复，无需其他处理');
if (r.kbJanky > 0 && r.kbPct >= 30) adv.push('掉帧多发生在键盘弹出期（iOS 视口变形属系统行为）：收起键盘复测对照，若明显好转则无需处理');
if (r.verdict !== '流畅' && (!r.storage || r.storage.level !== '重')) adv.push('可按 设置→「手机卡顿说明」的顺序清一遍存量（先「查看存储」看哪项最大）；别用「清除本地数据」治卡顿');
if (!adv.length) adv.push('保持现状即可');
adv.forEach(function (a, i) { L.push((i + 1) + '. ' + a); });
L.push('');
L.push('（采样只在本机进行、不上传任何数据；掉帧＝帧间隔>' + r.jankMs + 'ms ≈ 2 倍实测刷新周期，后台/锁屏冻结帧已剔除）');
return L.join('\n');
}
window.mochiPerfCheck = {
start: start,
running: function () { return _running; },
LAST_KEY: LAST_KEY
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("perf-check.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("perf-check.js"); try { console.error("[JS] perf-check.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[perf-check.js] " + String(__e && __e.message || __e)); } })();