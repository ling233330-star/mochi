// ===== 功能：聊天（主聊天页） =====
// ⚠️ 2026-08-25 深夜磁盘满事故：本文件曾 0 字节，由 HEAD(9928715) index.html 产物段恢复（minified，原注释已失）
// 已补回当时未提交的两处改动：①桌面弹窗头像 cs-avatar-partner；②经期关心 20% 预掷门控移除（详见 WORKLOG 紧急横幅）

(function () {
const body = document.getElementById('chat-body');
if (!body) return;
const chatLoadingEl = document.getElementById('chat-loading'); // v3.26.x：聊天记录加载进度条
const uid = window.activePrefix();
const store = window.activeStore();
function closeIme() {
try {
const ae = document.activeElement;
if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) ae.blur();
} catch (e) {}
}
let msgs = [];
const sessionChangedIdx = new Set();
let chatDbReady = false;
let lastIdbLoadPrefix = null;
let lastIdbLoadAt = 0;
const IDB_RELOAD_MIN_GAP = 8000;
let pendingLocal = null; // 权威就绪前暂存的内存消息（绝不落盘，防止污染读取/覆盖 IDB）
// ===== v3.26.x 止血：聊天大包（含图片 base64）避免「每个交互同步全量写」 =====
// 根因：chat-msgs 单键可达数百 MB（图片 base64 内联），saveMsgs/saveMsgsNow 每次
// 都对整包同步 JSON.stringify + idbSet → 数百 ms~数秒长任务（发消息/来消息打断、
// 打字缓冲、收键盘卡、上滑卡、切页卡）。方案：把这个整包串化+落盘改为「合并 + 低频
// + 空闲窗口」执行——requestIdleCallback 空闲期或 ≥PERSIST_MIN_GAP 才写一次，
// 不与交互/帧率争主线程；数据语义不变（仍写整包最新，不丢数据），离页仍强制兜底。
const PERSIST_MIN_GAP = 2500;   // 两次实际落盘的最小间隔（ms）
let lastPersistAt = 0;          // 上次实际落盘时间（performance.now()）
let persistTimer = null;        // 排队中标记（rIdle/timeout）
let persistRun = null;          // 待执行落盘闭包（tail 只保留最新一次）
function runPersist() {
  persistTimer = null;
  const run = persistRun;
  persistRun = null;
  if (!run) return;
  const wait = PERSIST_MIN_GAP - (performance.now() - lastPersistAt);
  if (wait > 0) { persistTimer = setTimeout(runPersist, wait); return; }
  try { run(); lastPersistAt = performance.now(); } catch (e) {}
}
function schedulePersist(writer) {
  persistRun = writer;
  if (persistTimer) return;
  if (window.requestIdleCallback) persistTimer = window.requestIdleCallback(runPersist, { timeout: 4000 });
  else persistTimer = setTimeout(runPersist, 2500);
}
function flushPersistNow() {
  const run = persistRun;
  persistRun = null;
  persistTimer = null;
  if (run) { try { run(); lastPersistAt = performance.now(); } catch (e) {} }
}
function cancelPersist() { persistRun = null; persistTimer = null; }
document.addEventListener('contact-switched', function () {
try {
// 切走前强制落盘待写（persistRun 闭包已捕获旧命名空间前缀，切桌面后仍写对桌面）
flushPersistNow();
try { hideTyping(); } catch (e) {}
msgs = [];
pendingLocal = null;
chatDbReady = false;
sessionChangedIdx.clear();
// v3.14.x：清掉旧联系人遗留的异步状态（跨切换残留的保险丝会把新桌面误置
// 就绪；重试定时器只对旧联系人有意义；authLoadedPrefix 归位重新考核）
if (readyFuse) { clearTimeout(readyFuse); readyFuse = null; }
if (idbRetryTimer) { clearTimeout(idbRetryTimer); idbRetryTimer = null; }
idbRetryCount = 0;
authLoadedPrefix = null;
armReadyFuse();
try { lastQuote = null; } catch (e) {}
try { lastMineText = ''; } catch (e) {}
try { lastMineQuote = ''; } catch (e) {}
try { lastQuotedText = ''; } catch (e) {}
try {
draftImgs = [];
renderDraft();
} catch (e) {}
try { if (input) { input.value = ''; try { input._mLastTyped = ''; } catch (e2) {} } } catch (e) {} // #215 切桌面作废输入快照
try { updateChatPartnerName(); } catch (e) {}
try { fillAvatar('chat-user-av', 'cs-avatar-user'); fillAvatar('chat-partner-av', 'cs-avatar-partner'); } catch (e) {}
try { if (window.applyContinueSayUI) window.applyContinueSayUI(); } catch (e) {}
try { updateChatLoading(); } catch (e) {}   // 切桌面聊天页已隐藏 → 进度条同步隐藏
// v3.26.x：切桌面立即预读新桌面聊天记录——用户导航/点开聊天前读库已在跑，
//   打开聊天页时记录往往已就绪，不再等 enterChat 才开始读（省下数秒等待）
// FIX 2026-09-01 #120：大历史桌面套门控，跳过预读（进入聊天页才读），防低端机崩溃
try { chatPrefetchIfLight(function () { loadMsgs(); }); } catch (e) {}
} catch (e) {}
});
const LS_SNAP_LIMIT = 2 * 1024 * 1024;
let lsSnapTimer = null;
let lsSnapPending = null; // { arr, prefix }：窗口内最新一次请求，trailing 时写
// v3.26.x OOM：聊天大包（图片 base64 内联）浅层字节估算——只取字符串 .length 相加，
// 不拷贝/串化数据本身，用于「是否走精简快照 / 是否数组直存 IDB」的阈值判断。
function msgsBytes(arr) {
if (!Array.isArray(arr)) return 0;
let n = 0;
for (let i = 0; i < arr.length; i++) {
const m = arr[i];
if (!m || typeof m !== 'object') { n += 32; continue; }
const t = m.text; if (typeof t === 'string') n += t.length;
const im = m.img; if (typeof im === 'string') n += im.length;
const vc = m.voice; if (typeof vc === 'string') n += vc.length;
const ps = m.parts;
if (Array.isArray(ps)) { for (let j = 0; j < ps.length; j++) { const p = ps[j]; if (p && typeof p.v === 'string') n += p.v.length; } }
n += 64;
}
return n;
}
// v3.26.x OOM 核心：聊天记录 IDB 直存数组（structured clone，读写都免整包 JSON 串化/解析）。
// 旧实现单键可达数百 MB（图片 base64 内联）时：读库 JSON.parse 数百 MB（秒级阻塞+堆尖峰）、
// 每次落盘 JSON.stringify 再数百 MB（OPPO Reno10Pro+ 自带浏览器实测 JS 堆被推到 905/1078MB，
// 渲染进程被杀、页面自动重启）。小历史（估算 ≤CHAT_STR_THRESHOLD）沿用字符串路径，与旧数据
// 完全一致（loadMsgs 双形态兼容）；数组路径失败（DataCloneError/事务异常）回退字符串，绝不丢数据。
const CHAT_STR_THRESHOLD = 3 * 1024 * 1024;
function persistMsgsToIdb(key, arr) {
if (!window.idbSet) return Promise.resolve(false);
if (!arr || !arr.length || msgsBytes(arr) <= CHAT_STR_THRESHOLD) {
return window.idbSet(key, JSON.stringify(arr || []));
}
return window.idbSet(key, arr).then(ok => {
if (ok) return true;
return window.idbSet(key, JSON.stringify(arr));
});
}
// v3.26.x #90：聊天记录「条数账本」+ 缩水守卫（本会话跨桌面/读库异常路径的最后止损）。
// #88 的 authOk 闸门只挡「本会话没读到权威值」；账本再挡一种：读到了、但内存里的数组
// 明显不是库里那一份（切错桌面残留、快照污染、并发覆盖）。账本 = 本命名空间最近一次
// 权威条数，存 <prefix>:chat-meta（几百字节小键，idb.js 已把它排除出写日志，
// 不会被 LS 回滚补回过期值）。整包落盘前同步比对：新条数不足账本一半且账本 ≥300 条
// → 判定可疑缩水，IDB 与 LS 快照一律不写（LS 废机上覆盖就是永久丢），弹窗告知一次
// 并补挂 scheduleIdbRetry()：权威读回后 loadMsgs 会把内存里的新消息合并进完整历史再存。
// 守卫判定全同步（比对内存数字，零额外开销），只在可疑路径才弹窗。
const CHAT_LEDGER_MIN = 300;
const CHAT_LEDGER_STEP = 50;   // IDB 账本按步进落盘：只需量级正确，免每次存盘多发事务
const chatLedger = {};         // prefix -> 已知权威条数
let chatLedgerWarned = {};
const chatLedgerRetryAt = {};  // prefix -> 上次强制重读时间（限流，防重读风暴）
const chatLedgerBytes = {};    // prefix -> 已落盘的字节估算（FIX 2026-09-01 #120，防重复写）
// FIX 2026-09-01 #120：账本额外记 b（msgsBytes 估算，近似值即可，不用精确），供冷启动
// 「大历史懒读」门控（chatPrefetchIfLight）廉价判断当前桌面聊天包是否巨大——重启后不必
// 读 155MB 大键才知道它大。b 缺失按「未知」，门控会保守选择行为（见 chatPrefetchIfLight，不破坏旧逻辑）。
function chatLedgerSave(prefix, n, bytes) {
const prev = chatLedger[prefix];
chatLedger[prefix] = n;
const bChanged = typeof bytes === 'number' && bytes >= 0 && chatLedgerBytes[prefix] !== bytes;
if (prev === n && !bChanged) return;
if (!bChanged && typeof prev === 'number' && n > prev && n - prev < CHAT_LEDGER_STEP) return;
const obj = { n: n, t: Date.now() };
if (typeof bytes === 'number' && bytes >= 0) obj.b = bytes;
try { window.idbSet(prefix + ':chat-meta', JSON.stringify(obj)); } catch (e) {}
if (typeof bytes === 'number' && bytes >= 0) chatLedgerBytes[prefix] = bytes;
}
// 小键补读（chat-msgs 大键读失败时，恰恰只有它能回答「库里到底有多少条」）：
// 已知有值就不重复读，异步回来也不覆盖本会话更新过的内存值。
function chatLedgerLoad(prefix) {
if (!window.idbGet || chatLedger[prefix] !== undefined) return;
try {
window.idbGet(prefix + ':chat-meta').then(function (v) {
try {
if (v === undefined || v === null || chatLedger[prefix] !== undefined) return;
const o = typeof v === 'string' ? JSON.parse(v) : v;
if (o && typeof o.n === 'number' && o.n > 0) chatLedger[prefix] = o.n;
} catch (e) {}
}).catch(function () {});
} catch (e) {}
}
// FIX 2026-09-01 #120：低端安卓真机（OPPO findx9 等）开网站/进聊天崩溃——default 桌面
// 聊天大包（图片 base64 内联，实测 155MB/1656条≈94KB每条）在冷启动和切桌面时被两处预读
// （mochi-restore-done 的 loadMsgs(true)、启动 loadMsgs、contact-switched 预读）一次性
// idbGet 反序列化超大值，与启动回填叠加成堆尖峰，渲染进程被杀。这里用账本 b 判断「历史很大」
// 的桌面：冷启动跳过预读，改为进入聊天页才读（enterChat 内部会调 loadMsgs）；小历史保留
// 原预读加速（不影响大众体验）。零数据风险：读库本就异步，且 saveMsgs 的 authOk 闸门保证
// 未读到权威前新消息只进 pendingLocal、绝不整包覆盖历史。
const CHAT_LAZY_BYTES = 8 * 1024 * 1024; // 历史字节估算门槛：超此即视为大包，冷启动懒读
function chatPrefetchIfLight(load) {
  let prefix;
  try { prefix = window.activePrefix(); } catch (e) { prefix = ''; }
  if (!window.idbGet) { try { load(); } catch (e2) {} return; }
  window.idbGet(prefix + ':chat-meta').then(function (v) {
    // FIX 2026-09-01 #120：冷启动预读门控——
    //   · 账本「完全缺失」（全新/空账号：无 #90 账本=从未落盘，实为无数据）→ 照常预读；
    //   · 账本存在且 b 已知 ≤ 门槛（小历史）→ 照常预读；
    //   · 账本存在但 b 缺失或超门槛（旧格式超大历史 / 本次未写 b）→ 跳过冷启动预读，
    //     进入聊天页才读（enterChat 会 loadMsgs）。理由：老用户超大历史在账本里一定
    //     有 n（每次落盘都写），只是缺新字段 b；唯一能防低端机首启崩的就是此时不预读，
    //     首启跑过我行 loadMsgs 落盘会补写 b，之后冷启动按 b 精确判断。
    //   · 读账本失败（catch）→ 也不预读（防低端机在高峰期抢读大包）。
    let knownSmall = false;
    let noLedger = v === undefined || v === null;
    try {
      if (!noLedger) {
        const o = typeof v === 'string' ? JSON.parse(v) : v;
        if (o && typeof o.b === 'number' && o.b >= 0 && o.b <= CHAT_LAZY_BYTES) knownSmall = true;
      }
    } catch (e2) {}
    if (knownSmall || noLedger) { try { load(); } catch (e2) {} return; }
    try { window.__xyChatLazyLoad = true; } catch (e2) {} // 大包/未知大小 → 冷启动跳过预读
  }).catch(function () { /* 读账本失败：也不预读（防低端机在高峰期抢读大包） */ });
}
// 返回 true=允许整包落盘（账本已更新）；false=可疑缩水，已拒绝落盘
function chatLedgerGuard(prefix, arr) {
const n = Array.isArray(arr) ? arr.length : 0;
const base = chatLedger[prefix];
if (typeof base === 'number' && base >= CHAT_LEDGER_MIN && n * 2 < base) {
if (!chatLedgerWarned[prefix]) {
chatLedgerWarned[prefix] = 1;
try {
if (window.openModal) window.openModal('聊天记录保护', '', function () {}, {
noInput: true, okText: '知道了',
staticText: '检测到本次要保存的记录比已存的历史少了很多（' + base + ' 条 → ' + n + ' 条），' +
'已暂缓保存以防历史被覆盖。请留意稍后重进聊天页确认记录是否完整。'
});
} catch (e) {}
try { scheduleIdbRetry(); } catch (e) {}
}
// v3.26.x #90：拒绝落盘不是终点——① 暂存内存数组，权威读回后 loadMsgs 会把其中的新
// 消息合并进完整历史（切桌面时也不会随内存一起丢）；② 强制重读：scheduleIdbRetry 走的
// 普通 loadMsgs 会被 IDB_RELOAD_MIN_GAP 时间闸跳过（此刻刚读过），只有 forceIdb 才真重读。
// 按命名空间 20 秒限流，防极端情况下反复重读整包大历史。
try { if (Array.isArray(arr) && arr.length && (!pendingLocal || pendingLocal.length < arr.length)) pendingLocal = arr.slice(); } catch (e) {}
try {
const nowR = Date.now();
if (nowR - (chatLedgerRetryAt[prefix] || 0) > 20000) {
chatLedgerRetryAt[prefix] = nowR;
setTimeout(function () {
try { if (window.activePrefix() === prefix) loadMsgs(true); } catch (e) {}
}, 1500);
}
} catch (e) {}
return false;
}
chatLedgerSave(prefix, n, msgsBytes(arr));
return true;
}
// 精简快照：大历史时剥掉 img/voice/long-text 及 parts 里的图片/语音负载（保留占位与 _lsLite
// 标记，合并逻辑按原语义识别），使 localStorage 兜底快照始终 ≤2MB、且构建过程不再整包串化。
function liteSnapArray(arr) {
if (msgsBytes(arr) <= LS_SNAP_LIMIT) return arr; // 小历史：全量快照
return arr.map(m => {
if (!m || typeof m !== 'object') return m;
const hasBig = m.img || m.voice || (typeof m.text === 'string' && m.text.length > 8192) ||
(Array.isArray(m.parts) && m.parts.some(p => p && typeof p.v === 'string' && p.v.length > 512));
if (!hasBig) return m;
const c = Object.assign({}, m);
c._lsLite = 1;
if (c.img) c.img = '';
if (c.voice) c.voice = '';
if (typeof c.text === 'string' && c.text.length > 8192) c.text = '[内容已省略]';
if (Array.isArray(c.parts)) {
c.parts = c.parts.map(p => {
if (!p || typeof p !== 'object' || typeof p.v !== 'string') return p;
if (p.k === 'img' || p.k === 'voice' || p.v.length > 8192) {
const pc = Object.assign({}, p);
if (p.k === 'img' || p.k === 'voice') pc.v = '';
else pc.v = '[内容已省略]';
return pc;
}
return p;
});
}
return c;
});
}
function performLsSnapWrite(arr, prefix) {
try {
if (!Array.isArray(arr)) return;
let snapArr = liteSnapArray(arr);
let snap = JSON.stringify(snapArr);
// #180：超限不再整体放弃——原实现静默不写＝LS 兜底全空，权威读取失败窗口里聊的
// 消息没有任何副本。改为从最旧开始折半丢弃（最多 5 轮），保住最近的尾巴落 LS。
let round = 0;
while (snap.length > LS_SNAP_LIMIT && snapArr.length > 1 && round < 5) {
round++;
const keep = Math.max(1, Math.floor(snapArr.length / 2));
snapArr = liteSnapArray(arr.slice(arr.length - keep));
snap = JSON.stringify(snapArr);
}
if (snap.length <= LS_SNAP_LIMIT) {
localStorage.setItem((prefix || window.activePrefix()) + ':chat-msgs', snap);
}
} catch (e) {}
}
function writeLsSnapshot(arr, prefix, force) {
if (!Array.isArray(arr)) return;
if (force) {
if (lsSnapTimer) { clearTimeout(lsSnapTimer); lsSnapTimer = null; }
lsSnapPending = null;
performLsSnapWrite(arr, prefix);
return;
}
if (msgsBytes(arr) <= LS_SNAP_LIMIT) { performLsSnapWrite(arr, prefix); return; }
if (lsSnapTimer) { lsSnapPending = { arr: arr, prefix: prefix }; return; }
performLsSnapWrite(arr, prefix);
lsSnapTimer = setTimeout(() => {
lsSnapTimer = null;
if (lsSnapPending) {
const p = lsSnapPending;
lsSnapPending = null;
performLsSnapWrite(p.arr, p.prefix);
}
}, 4000);
}
// ===== 2026-09-05 #180 聊天尾巴日志（同步兜底，修多机型反复「刷新重开丢最近一段聊天」）=====
// 背景：整包落盘走「空闲回调+最小2.5s间隔」低频合并（v3.26.x 止血），且 16MB 级异步 IDB
// 事务在部分安卓内核（一加/OPPO/真我/荣耀/小米 Edge 等实测族）会挂起或随进程被杀回滚、
// flushSave 的离页事务也未必来得及提交——最近几条消息在这几个窗口里没有任何第二副本。
// 防线：每条新消息同步写 LS 小键 <cid>:chat-tail（纯文本轻量副本，≤60 条，大负载不进），
// localStorage 同步写必达；下次权威读库成功后按签名去重合并回放。不与 saveMsgs 链路
// （#88 权威守卫/#90 账本守卫）耦合：权威守卫拒绝落盘的窗口里日志照样在攒，恢复时一并带回。
const CHAT_TAIL_MAX = 60;
const CHAT_TAIL_TEXT_MAX = 1000;
function chatTailSig(m) {
try { return ((m && m.ts) || 0) + '|' + (m.side || '') + '|' + String((m && m.text) || '').slice(0, 120); } catch (e) { return ''; }
}
function chatTailRead() {
try {
const arr = JSON.parse(store.get('chat-tail') || '[]');
return Array.isArray(arr) ? arr : [];
} catch (e) { return []; }
}
function chatTailClear() {
try { store.remove('chat-tail'); } catch (e) {}
}
// 只收纯文本/轻消息：img/voice/大 parts 同步写 LS 会写爆，仍走整包落盘链路
// FIX 2026-09-05 #206 表情包「重复 + 乱码 → 空白方框」（Oppo A5 Pro/Via 等多机型）：
// 日志只收「能一字不差回放」的消息。sticker/image 型消息的 text 就是媒体数据本体
// （base64/远程链/@@m: 令牌），收录后回放必失真——type 被丢弃变文字气泡；且 #142 媒体
// 令牌化稍后会把该条 text 改写成 @@m:令牌，日志里留存的旧文本签名随之漂移，下次启动
// chatTailMerge 把它当「没落盘的新消息」回放＝同一表情包旁边多出一条乱码/坏图复制。
// parts 混合消息（回放丢图成半条）与超长文本（截断存储）同理。宁可不兜底，绝不回放坏数据。
function chatTailAppend(rec) {
try {
if (!rec || rec.retracted || rec.img || rec.voice) return;
if (rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice') return;
if (Array.isArray(rec.parts) && rec.parts.length) return;
if (typeof rec.text !== 'string' || rec.text.length > CHAT_TAIL_TEXT_MAX) return;
const arr = chatTailRead();
arr.push({ ts: rec.ts || Date.now(), side: rec.side || '', special: rec.special || '', text: rec.text });
while (arr.length > CHAT_TAIL_MAX) arr.shift();
store.set('chat-tail', JSON.stringify(arr));
} catch (e) {}
}
// 撤回后日志里的原文不得回放（否则刷新后已撤回内容复活）——按签名整条摘除
function chatTailDrop(rec) {
try {
if (!rec) return;
const sig = chatTailSig(rec);
const arr = chatTailRead().filter(j => chatTailSig(j) !== sig);
store.set('chat-tail', JSON.stringify(arr));
} catch (e) {}
}
// 权威读库成功后调用：日志中不在当前历史里的条目按 ts 归位合并（整包落盘仍走 saveMsgs 守卫链）
function chatTailMerge() {
try {
const arr = chatTailRead();
if (!arr.length || !Array.isArray(msgs)) return;
const have = new Set();
for (let i = 0; i < msgs.length; i++) have.add(chatTailSig(msgs[i]));
const add = [];
for (let i = 0; i < arr.length; i++) {
const j = arr[i];
if (!j || have.has(chatTailSig(j))) continue;
// FIX 2026-09-05 #206 旧版日志里的存量媒体存根不得回放：data:/@@m: 开头却无 type 的条目
// 只可能是旧版截断收录的媒体数据——回放即「乱码文字气泡 → 被 normCell 归一化按 data:image/
// 前缀误迁移成 image → 截断 base64 解码失败 = 坏图空白方框」，且与原消息并存成重复。跳过，
// 该条随日志 60 条滚动自然淘汰，不再新增（chatTailAppend 已拒收媒体型消息）。
const jt = typeof j.text === 'string' ? j.text : '';
if (jt.indexOf('data:') === 0 || jt.indexOf('@@m:') === 0) continue;
add.push({ ts: j.ts, side: j.side, special: j.special, text: jt });
}
if (!add.length) return;
msgs = msgs.concat(add).sort((a, b) => ((a && a.ts) || 0) - ((b && b.ts) || 0));
saveMsgs();
} catch (e) {}
}
// v3.14.x：防「权威读取失败被当空历史」守卫状态——idbGet 的 4s+4s 超时兜底
//（v3.9.x 防挂起）对「键存在但读取超时」也 resolve undefined，与「键不存在」不可区分；
// 真机切桌面瞬间几十模块并发抢 IDB，chat-msgs 大键读取易超时 → 若当"无权威数据"
// 处理会用内存/LS 有损快照覆盖 IDB = 聊天记录丢失。authLoadedPrefix=本会话已成功
// 读过权威的命名空间（空记录落盘守卫用）；读取失败走有界自动重试。
let authLoadedPrefix = null;
let idbRetryTimer = null;
let idbRetryCount = 0;
const IDB_RETRY_MAX = 6;
function scheduleIdbRetry() {
if (idbRetryTimer || idbRetryCount >= IDB_RETRY_MAX) return;
idbRetryCount++;
idbRetryTimer = setTimeout(function () {
idbRetryTimer = null;
try { loadMsgs(); } catch (e) {}
}, 5000);
}
let readyFuse = null;
function armReadyFuse() {
if (readyFuse || chatDbReady) return;
const fusePrefix = window.activePrefix();
readyFuse = setTimeout(function () {
readyFuse = null;
if (chatDbReady) return;
// v3.14.x：跨联系人兜底——保险丝按武装时命名空间捕获，若已切走（正常路径
// contact-switched 已清本定时器，此处防极端时序漏清）不得误置新桌面就绪
try { if (window.activePrefix() !== fusePrefix) return; } catch (e) {}
chatDbReady = true;
const fuseMsgs = (pendingLocal && pendingLocal.length) ? pendingLocal : msgs;
if (fuseMsgs && fuseMsgs.length) {
try { writeLsSnapshot(fuseMsgs, fusePrefix, true); } catch (e) {}
} else {
try {
const lsRaw = store.get('chat-msgs');
if (lsRaw) {
const lsArr = JSON.parse(lsRaw);
if (Array.isArray(lsArr) && lsArr.length) {
msgs = lsArr;
try { syncLastMineText(); } catch (e) {}
}
}
} catch (e) {}
}
try {
if (chatVisible() && msgs.length && !body.children.length) {
renderWindow(false, true);
scrollChatBottom();
}
} catch (e) {}
// v3.26.x #88：保险丝只放开「显示 + LS 有损快照」，整包落盘仍要等真读到权威
//（authLoadedPrefix 不匹配时 saveMsgs/saveMsgsNow 一律暂存）。这里顺带补挂一次有界
// 读回重试（scheduleIdbRetry 自身限 6 次/5s 间隔），否则读库超时的设备本会话再也拿不回历史。
try { scheduleIdbRetry(); } catch (e) {}
try { updateChatLoading(); } catch (e) {} // 保险丝已就绪 → 隐藏聊天记录加载进度条
}, 15000);
}
function saveMsgs() {
try { scheduleMediaPass(1500); } catch (e) {} // #142：有新消息写入即安排增量令牌化（pass 自带权威守卫与 WeakSet 去重）
// v3.26.x #88：守卫从「未就绪」收紧到「本会话没读到该桌面的权威数据」。
// chatDbReady 会被 15 秒就绪保险丝（armReadyFuse）置 true，而那时 authLoadedPrefix 仍
// 不等于当前命名空间（IDB 读库超时/挂起）。旧逻辑在这个窗口只要 msgs 非空就整包写
// IDB：用户发一条消息 → msgs=[这一条] → 整包覆盖 = 该桌面全部历史被抹成一条。
// 诊断实证（小米 14U Edge）：本机 localStorage 已废（键数 0 + 写探针 QuotaExceededError），
// writeLsSnapshot 的 LS 兜底同样写不进去，覆盖就是永久丢；配合该机启动耗时 24 秒，
// 读库必然压不过 15 秒保险丝 → 高发。
// 现在这种窗口一律只暂存 pendingLocal + 写 LS 有损快照 + 安排重试读回权威；权威读回后
// loadMsgs 会把 pendingLocal 合并进完整历史再落盘。语义：宁可晚存几条，绝不覆盖全部。
const authOk = chatDbReady && authLoadedPrefix === window.activePrefix();
if (!authOk) {
try { pendingLocal = msgs.slice(); } catch (e) {}
// v3.14.x：内存为空时不写 LS 快照——权威读取失败窗口里任何模块触发保存，
// 会把 LS 里仅存的有损备份也覆盖成 "[]"（IDB 万一后续丢失将无从恢复）
if (msgs.length) writeLsSnapshot(msgs, undefined, true);
try { scheduleIdbRetry(); } catch (e) {}
return;
}
// v3.26.x 止血：改为合并+低频+空闲落盘（见上方调度器），不再每个动作同步写整包
const myPrefix = window.activePrefix();
schedulePersist(() => {
  // v3.26.x #88：原守卫只挡空数组（防覆盖全部历史），非空时仍会整包覆盖——改为
  // 「本会话确实读到过该命名空间的权威数据」才允许整包落盘。排队到执行之间若切过
  // 桌面，contact-switched 会先 flushPersistNow() 落完再归位 authLoadedPrefix，不漏存。
  if (authLoadedPrefix !== myPrefix) return;
  // v3.26.x #90：条数缩水守卫——内存数组明显少于库内账本时整包不落（含 LS 快照）
  if (!chatLedgerGuard(myPrefix, msgs)) return;
  // v3.26.x OOM：大历史 IDB 直存数组（免整包 stringify），小历史仍字符串路径
  try { if (window.idbSet) persistMsgsToIdb(myPrefix + ':chat-msgs', msgs); } catch (e) {}
  writeLsSnapshot(msgs, myPrefix);
});
}
function flushSave() {
if (window.__resetting) return;
// v3.26.x 止血：立即落盘待写（离页/切走兜底）；#88：未读到权威则仅写 LS 有损快照
flushPersistNow();
if ((!chatDbReady || authLoadedPrefix !== window.activePrefix()) && msgs.length) writeLsSnapshot(msgs, undefined, true);
}
window.chatFlushSave = flushSave;
// ===== #142 媒体池：聊天图片内容寻址去重 =====
// 同一张表情包/图片每发一次就整份 base64 进库（诊断实证 chat-msgs 全桌面 ≈214MB，
// 重复占大头）。normalize 把消息里的 data:image 替换为池令牌 @@m:<hash>（media-pool.js
// 负责哈希/落池/渲染解析），消息体只留 44 字符引用。安全设计：
//   · 令牌化只发生在内存 msgs 上，落盘走 saveMsgs() 原路（#88 权威守卫/#90 账本守卫全保留）；
//   · 池数据落盘（mochiMediaFlush）先于 msgs 落盘——崩溃窗口最多「池多一条孤儿」，
//     不可能出现「令牌入库而池数据丢失」；
//   · WeakSet 记录已处理消息：每条消息每会话只哈希一次，pass 高频触发零重复开销；
//   · 令牌跨桌面/跨设备稳定（内容哈希），备份导出带池键即可在他机恢复；
//   · crypto.subtle 不可用（非安全上下文）时 tokenize 恒 null，一切保持旧路径。
let _mediaPassT = null, _mediaPassBusy = false;
const _mediaTokSeen = new WeakSet();
function scheduleMediaPass(delay) {
if (!window.mochiMediaTokenize) return;
clearTimeout(_mediaPassT);
_mediaPassT = setTimeout(mediaNormalizePass, delay || 1500);
}
async function mediaNormalizePass() {
if (_mediaPassBusy) { scheduleMediaPass(4000); return; }
// 与 saveMsgs 同款权威守卫：本会话没读到该桌面权威数据时绝不改写（防把半库令牌化覆盖全史）
if (!chatDbReady || authLoadedPrefix !== window.activePrefix()) return;
_mediaPassBusy = true;
try {
let changed = 0;
const _rollback = []; // FIX 2026-09-05 #186 写池失败回滚账 [{obj, prop, val, msg}]
for (let i = 0; i < msgs.length; i++) {
const m = msgs[i];
if (!m || _mediaTokSeen.has(m)) continue;
let did = false;
if (typeof m.text === 'string' && m.text.indexOf('data:image/') === 0) {
const t = await window.mochiMediaTokenize(m.text);
if (t) { _rollback.push({ o: m, p: 'text', v: m.text, msg: m }); m.text = t; changed++; did = true; }
}
if (typeof m.img === 'string' && m.img.indexOf('data:image/') === 0) {
const t = await window.mochiMediaTokenize(m.img);
if (t) { _rollback.push({ o: m, p: 'img', v: m.img, msg: m }); m.img = t; changed++; did = true; }
}
if (Array.isArray(m.parts) && m.parts.length) {
for (let j = 0; j < m.parts.length; j++) {
const p = m.parts[j];
if (p && typeof p.v === 'string' && p.v.indexOf('data:image/') === 0) {
const t = await window.mochiMediaTokenize(p.v);
if (t) { _rollback.push({ o: p, p: 'v', v: p.v, msg: m }); p.v = t; changed++; did = true; }
}
}
}
_mediaTokSeen.add(m);
if ((i & 63) === 63) {
await new Promise(r => setTimeout(r, 0));
// 中途切桌面/权威归属变化 → 立即中止（WeakSet 未标记的记录留给下次 pass）
if (authLoadedPrefix !== window.activePrefix()) break;
}
}
if (changed > 0) {
const _ok = await window.mochiMediaFlush(); // 池数据先落盘，再让引用落盘（顺序不可反）
if (_ok === false) {
// FIX 2026-09-05 #186 写池失败（idbSetAll 返回 false）绝不能带令牌落库——否则令牌入库
// 而池数据只在内存重试队列，页面被杀即永久空白气泡（vivo X200s+Edge 等大库机反复出现）。
// 回滚本次全部令牌化，WeakSet 去标记，留给下次 pass 重试。
for (let r = 0; r < _rollback.length; r++) { try { _rollback[r].o[_rollback[r].p] = _rollback[r].v; } catch (e2) {} try { _mediaTokSeen.delete(_rollback[r].msg); } catch (e3) {} }
scheduleMediaPass(8000);
console.warn('[mochi] 媒体池写盘失败，本次 ' + changed + ' 处令牌化已回滚待重试');
} else {
saveMsgs();
try { console.info('[mochi] 媒体池：' + changed + ' 处聊天图片已去重为池引用'); } catch (e) {}
}
}
} catch (e) {} finally { _mediaPassBusy = false; }
}
document.addEventListener('mochi-restore-done', function () { setTimeout(function () { scheduleMediaPass(1000); }, 18000); });
document.addEventListener('contact-switched', function () { setTimeout(function () { scheduleMediaPass(1000); }, 12000); });
window.chatMediaNormalizeNow = mediaNormalizePass; // 可测性/诊断钩子（verify-media-pool 用）
try {
window.addEventListener('beforeunload', flushSave);
document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'hidden') flushSave();
else if (deskMsgEl && !deskMsgEl.hidden) hideDeskMsg();
});
} catch (e) {}
window.getChatMsgs = function () { return msgs; };
try { window.__mochiProf = window.__mochiProf || {}; } catch (e) {}
function __prof(t) { try { window.__mochiProf[t] = performance.now(); } catch (e) {} }
// ===== v3.26.x OOM 防线：聊天大数据量分批/延迟归一化 =====
// 根因：三星 S24 等真机上，旧账号积累数万条聊天记录时，启动读库后在主线程同步
// 跑完所有「全量数组」pass（collapseRapidDups / 图表迁移 / 媒体迁移 / 转义还原 /
// ts 回填 / sysNick 清扫），主线程阻塞数秒 → 渲染进程 OOM、页面崩溃。
// 方案：IDB 解析/合并后先出首屏，把这些 pass 挪到后台按片 setTimeout 分批跑，
// 单帧只耗几毫秒；全部跑完再合并渲染 + 落盘。各 pass 均按对象引用改属性、幂等可重入。
const ICON_BELL = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v3M4.2 4.2l2.2 2.2M2 12h3M19 12h3M4.2 19.8l2.2-2.2M17.6 17.6l2.2 2.2"/><path d="M12 6a6 6 0 016 6v4h-3v-4a3 3 0 00-6 0v4H6v-4a6 6 0 016-6z"/><path d="M9 20h6"/></svg>';
const ICON_TEL = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>';
const ICON_ENV = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
const ICON_CQ_FIX = { '再等等，会遇到我': '再等等，会遇到你', '你身边': '我身边', '只给我看': '只给你看' };
const NORM_CHUNK = 2500;
let normTimer = null, normPrefix = null;
function normCell(r) {
  let c = false;
  if (!r) return false;
  try {
    if (typeof r.text === 'string' && r.text.indexOf(ICON_BELL) >= 0) { r.text = r.text.split(ICON_BELL).join(ICON_TEL); c = true; }
    if (r.special === 'poke' && typeof r.text === 'string') {
      const t = r.text.replace(/✉️\s*/g, '').replace(/✉\s*/g, '');
      if (t !== r.text) { r.text = ICON_ENV + t; c = true; }
    }
    if ((r.type === 'text' || !r.type) && typeof r.text === 'string' && r.text.indexOf('data:image/') === 0) { r.type = 'image'; c = true; }
    if (r.special === 'poke' && typeof r.text === 'string' && r.text.indexOf('&lt;svg class=&quot;st-ico&quot;') === 0) {
      const mm = r.text.match(/^(&lt;svg class=&quot;st-ico&quot;[\s\S]*?&lt;\/svg&gt;)([\s\S]*)$/);
      if (mm) { r.text = mm[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') + mm[2]; c = true; }
    }
    if (r.special === 'ask-curious' && Array.isArray(r.curiousQuick)) {
      const f = r.curiousQuick.map(o => ICON_CQ_FIX[o] || o);
      if (f.some((o, i) => o !== r.curiousQuick[i])) { r.curiousQuick = f; c = true; }
    }
    if (r.special === 'ask-curious' && typeof r.curiousAnswer === 'string' && ICON_CQ_FIX[r.curiousAnswer]) { r.curiousAnswer = ICON_CQ_FIX[r.curiousAnswer]; c = true; }
    if (!r.ts) { r.ts = Date.now(); c = true; }
  } catch (e) {}
  return c;
}
function normCollapseRange(from, to) {
  let removed = 0;
  const GAP_TEXT = 2500, GAP_MEDIA = 60000;
  try {
    const n = msgs.length;
    for (let i = Math.min(to, n) - 1; i > from; i--) {
      const a = msgs[i], b = msgs[i - 1];
      if (!a || !b || !a.side || a.side !== b.side) continue;
      if (dupSig(a) !== dupSig(b)) continue;
      const hasContent = (a.text && a.text.length) || a.img || a.voice || !!a.special || (a.parts && a.parts.length);
      if (!hasContent) continue;
      const isMedia = !!a.img || !!a.voice || !!a.special;
      const dts = (a.ts || 0) - (b.ts || 0);
      if (dts < 0 || dts > (isMedia ? GAP_MEDIA : GAP_TEXT)) continue;
      msgs.splice(i, 1); removed++;
    }
  } catch (e) {}
  return removed;
}
function scheduleDeferredNormalization() {
  if (normTimer) return;
  let pre;
  try { pre = window.activePrefix(); } catch (e) { pre = ''; }
  if (pre === normPrefix) return;
  normPrefix = pre;
  normTimer = setTimeout(runDeferredNormalization, 80);
}
function runDeferredNormalization() {
  normTimer = null;
  let myPre;
  try { myPre = window.activePrefix(); } catch (e) { myPre = ''; }
  if (myPre !== normPrefix) { normPrefix = null; return; }
  let idx = 0, changed = false;
  // v3.26.x #211：记录归一化改动的最靠后下标与结构性删除数。收尾时若改动全部落在
  // 当前渲染窗口之外（changedHi < renderStart），跳过整窗重建——renderWindow 会销毁
  // 重建整个消息区（气泡+图片全部重建重新解码=肉眼可见闪一下），是「打开聊天偶尔
  // 闪动」的第二来源（偶发＝仅当历史里存在待迁移数据时 finish 才走渲染）。屏上数据
  // 真的变了仍整窗重渲；sysNick 清扫与相邻重复删除（下标位移）按保守整窗处理。
  let changedHi = -1, removedAll = 0, sysNickChanged = false;
  const N = msgs.length;
  if (!N) { normPrefix = null; return; }
  const finish = () => {
    try { sysNickChanged = !!sysNickCatchup(); changed = changed || sysNickChanged; } catch (e) {}
    normPrefix = null;
    if (!changed) return;
    // v3.26.x #88：未读到权威时不整包写回（同 saveMsgs 守卫）。归一化是幂等的，
    // 本次跳过会在下次读库成功后重跑；拿内存里的部分数组覆盖 = 丢全部历史。
    if (authLoadedPrefix !== myPre) return;
    // v3.26.x #90：归一化会删相邻重复（条数变少）——命中缩水判定时只跳过落盘（幂等，
    // 下次读库成功后重跑），渲染照常，不影响本会话使用。
    const canPersist = chatLedgerGuard(myPre, msgs);
    if (canPersist) {
    try { if (window.idbSet) persistMsgsToIdb(myPre + ':chat-msgs', msgs); } catch (e) {}
    try { writeLsSnapshot(msgs, myPre, true); } catch (e) {}
    }
    // #211：改动全部在渲染窗口之外时跳过整窗重建（防打开聊天闪一下）；屏上有改动才重渲
    try {
    if (chatVisible() && msgs.length &&
    (sysNickChanged || removedAll > 0 || changedHi >= renderStart)) {
    renderWindow(false, true);
    scrollChatBottom();
    }
    } catch (e) {}
  };
  const tick = () => {
    let nowPre;
    try { nowPre = window.activePrefix(); } catch (e) { nowPre = ''; }
    if (nowPre !== normPrefix) { normPrefix = null; return; }
    const end = Math.min(N, idx + NORM_CHUNK);
    for (let i = idx; i < end; i++) { if (normCell(msgs[i])) { changed = true; changedHi = Math.max(changedHi, i); } }
    const _rm = normCollapseRange(idx, end + 1, msgs);
    if (_rm) { changed = true; removedAll += _rm; }
    if (end < N) { idx = end; setTimeout(tick, 0); }
    else finish();
  };
  setTimeout(tick, 0);
}
function migrateLegacyMediaMsgs() {
let migrated = false;
msgs.forEach(r => {
if (r && (r.type === 'text' || !r.type) && typeof r.text === 'string' && r.text.indexOf('data:image/') === 0) {
r.type = 'image';
migrated = true;
}
});
if (migrated) saveMsgs();
}
function dupSig(m) {
if (!m) return '';
const sp = m.special || '';
let extra = '';
try {
if (sp === 'ask-card' || sp === 'ask') extra = String(m.askQuestion || '') + '|' + JSON.stringify(m.askOptions || []) + '|' + String(m.askType || '');
else if (sp === 'ask-choose') extra = String(m.choiceQuestion || '') + '|' + JSON.stringify(m.choiceOptions || []) + '|' + String(m.choicePref || '') + '|' + String(m.choiceCat || '');
else if (sp === 'ask-curious') extra = String(m.curiousQuestion || '') + '|' + JSON.stringify(m.curiousQuick || []) + '|' + String(m.curiousCat || '');
else if (sp === 'ask-roast') extra = String(m.roastText || '') + '|' + String(m.roastCat || '');
else if (sp === 'invite') extra = String(m.inviteContent || m.text || '');
else if (sp === 'gift') extra = String(m.flName || '') + '|' + String(m.flEmoji || '') + '|' + String(m.flWish || '');
else if (sp === 'flower') extra = String(m.flName || '') + '|' + String(m.flEmoji || '') + '|' + String(m.flWish || '');
} catch (e) {}
const normT = (m.type === 'text' || !m.type) ? '' : String(m.type || '');
return JSON.stringify({ s: m.side || '', t: normT, sp: sp, x: m.text || '', im: !!m.img, vc: !!m.voice, e: extra });
}
function collapseRapidDups(arr) {
let removed = 0;
const GAP_TEXT = 2500, GAP_MEDIA = 60000;
for (let i = arr.length - 1; i > 0; i--) {
const a = arr[i], b = arr[i - 1];
if (!a || !b || !a.side || a.side !== b.side) continue;
if (dupSig(a) !== dupSig(b)) continue;
const hasContent = (a.text && a.text.length) || a.img || a.voice || !!a.special || (a.parts && a.parts.length);
if (!hasContent) continue;
const isMedia = !!a.img || !!a.voice || !!a.special;
const dts = (a.ts || 0) - (b.ts || 0);
if (dts < 0 || dts > (isMedia ? GAP_MEDIA : GAP_TEXT)) continue;
arr.splice(i, 1);
removed++;
}
return removed;
}
function answeredRec(r) {
if (!r) return false;
if (r.special === 'ask-choose' && r.choiceStatus === 'answered') return true;
if (r.special === 'ask-curious' && r.curiousStatus === 'answered') return true;
if (r.special === 'ask-roast' && r.roastStatus === 'answered') return true;
if (r.special === 'ask-card' && r.askStatus === 'answered') return true;
if (r.special === 'invite' && r.inviteStatus === 'answered') return true;
return false;
}
function loadMsgs(forceIdb) {
armReadyFuse();
if (!persistTimer && !msgs.length && !chatDbReady) {
try { msgs = JSON.parse(store.get('chat-msgs') || '[]'); } catch (e) { msgs = []; }
if (!Array.isArray(msgs)) msgs = [];
try { syncLastMineText(); } catch (e) {}
}
// v3.26.x：全量 migration/去重 pass 移到 runDeferredNormalization 后台分批跑，防大数据主线程卡死
const nowT = Date.now();
const skipRead = chatDbReady &&
lastIdbLoadPrefix === window.activePrefix() &&
nowT - lastIdbLoadAt < IDB_RELOAD_MIN_GAP &&
!forceIdb;
if (!skipRead) {
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
// v3.26.x #90：先补读条数账本（小键，几乎不会超时）。大键读取失败时它是唯一
// 能回答「库里到底有多少条」的依据，落盘守卫全靠它。
try { chatLedgerLoad(myPrefix); } catch (e) {}
window.idbGet(myPrefix + ':chat-msgs').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v === undefined || v === null) {
// v3.14.x：先区分「键确实不存在」与「读取失败/超时」——idbGet 超时兜底也
// resolve undefined，真机切桌面并发抢事务时大键读取超时并不罕见；若当"无权威"
// 会置 ready 并用内存/LS 有损快照覆盖 IDB = 全部历史被清。
// v3.26.x #90：复核改走 idb.js 的严格三态探测 idbHasKey（true 存在/false 确认没有/
// null 没读到）。原 idbGetAllKeys 在超时、挂起时 resolve 空数组，与「确认空库」
// 不可区分 → 读取失败被当成「这个桌面没有历史」，置 authLoadedPrefix 放开整包落盘
// → 发一条消息即把全部历史覆盖成一条（诊断实证：小米 14U Edge，LS 已废无第二副本）。
// 现在只有 has === false 才认「无历史」；null 与 true 一律按读取失败处理。
const idbKey = myPrefix + ':chat-msgs';
const confirmMiss = window.idbHasKey
? window.idbHasKey(idbKey).then(function (has) { return has === false; })
: (window.idbGetAllKeys
? window.idbGetAllKeys().then(function (keys) {
return !(keys || []).some(function (k) { return k === idbKey; });
}).catch(function () { return false; })
: Promise.resolve(true));
confirmMiss.then(function (isMiss) {
if (window.activePrefix() !== myPrefix) return;
if (!isMiss) { scheduleIdbRetry(); return; }
chatDbReady = true;
idbRetryCount = 0;
authLoadedPrefix = myPrefix;
try { syncLastMineText(); } catch (e) {}
const lsRaw = store.get('chat-msgs');
if (lsRaw) {
try {
const lsArr = JSON.parse(lsRaw);
if (Array.isArray(lsArr) && lsArr.length) {
if (window.idbSet) window.idbSet(myPrefix + ':chat-msgs', lsRaw);
}
} catch (e) {}
}
if (pendingLocal && pendingLocal.length) {
msgs = pendingLocal.concat(msgs.filter(m => !pendingLocal.some(p => p && p.ts === m.ts && p.text === m.text)));
pendingLocal = null;
try { if (window.idbSet) persistMsgsToIdb(myPrefix + ':chat-msgs', msgs); } catch (e) {}
writeLsSnapshot(msgs, myPrefix, true);
}
// #90：已确认库里没有 chat-msgs，账本随之对齐真实状态（过期的高账本不该再拦正常保存）
try { chatLedgerSave(myPrefix, (msgs && msgs.length) || 0, msgsBytes(msgs)); } catch (e) {}
try { chatTailMerge(); } catch (e) {} // #180：确认空库也回放尾巴日志（本会话/上次会话未落盘部分）
});
return;
}
try {
__prof('ch0_enter');
const idbArr = typeof v === 'string' ? JSON.parse(v) : v;
__prof('ch1_parsed');
if (!Array.isArray(idbArr)) { chatDbReady = true; return; }
const sigOf = (m) => { try { return JSON.stringify({ t: m && m.text, s: m && m.side, ts: m && m.ts, i: m && m.img ? (typeof m.img === 'string' ? m.img.slice(0, 32) : String(m.img.length)) : 0 }); } catch (e) { return ''; } };
const hasLocal = !!((pendingLocal && pendingLocal.length) || (msgs && msgs.length));
let merged, curArr = pendingLocal || msgs || [];
let changed = false;
// v3.26.x OOM：无本地待合并数据时跳过全量签名 Set 构建（旧大数据账号最常见的启动场景）
if (!hasLocal) {
  merged = idbArr;
} else {
  const idbSigs = new Set();
  idbArr.forEach(x => { if (x) idbSigs.add(sigOf(x)); });
  __prof('ch2_sigset');
  const idbTsSide = new Set(idbArr.map(x => (((x && x.ts) || 0) + '|' + ((x && x.side) || ''))));
  __prof('ch3_tsside');
  const liteResidue = (m) => !!(m && (m._lsLite || m.img === '' || m.voice === ''));
  const localNew = curArr.filter(m => m && !idbSigs.has(sigOf(m))).filter(m => {
    if (!liteResidue(m)) return true;
    return !idbTsSide.has((((m && m.ts) || 0)) + '|' + ((m && m.side) || ''));
  });
  localNew.forEach(m => { try { delete m._lsLite; } catch (e) {} });
  merged = idbArr.concat(localNew).sort((a, b) => ((a && a.ts || 0) - (b && b.ts || 0)));
  if (merged.length === curArr.length) {
    curArr.forEach((m, i) => {
      if (!m || i >= merged.length) return;
      if (sessionChangedIdx.has(i)) merged[i] = m;
    });
  }
  curArr.forEach((m, i) => {
    if (!m || i >= merged.length) return;
    if (!answeredRec(m) || answeredRec(merged[i])) return;
    merged[i] = m;
  });
  changed = localNew.length > 0 || merged.length !== msgs.length;
  if (!changed && merged.length === msgs.length && msgs.length) {
    changed = msgs.some(m => m && (m.img === '' || m.voice === ''));
  }
}
msgs = merged;
__prof('ch4_merged');
if (hasLocal && merged.length !== curArr.length) sessionChangedIdx.clear();
// v3.26.x：原同步全量 normalization（collapseRapidDups/migrateLegacyMediaMsgs/
// restoreEscapedPokeIcons/sysNickCatchup/图标迁移/ts 回填）移入后台分批归一化，
// 首屏即时可交互，防大数据 OOM 崩溃。此处仅本次合并产生的 changed 落盘。
try { syncLastMineText(); } catch (e) {}
__prof('ch5_passes');
pendingLocal = null;
chatDbReady = true;
// v3.14.x：本命名空间已读到权威（此后空数组落盘才被允许——内存已含全部历史）
authLoadedPrefix = myPrefix;
idbRetryCount = 0;
try { chatTailMerge(); } catch (e) {} // #180：权威就绪后回放尾巴日志（上次会话未落盘的最近消息）
// v3.26.x #90：账本基线＝刚读到的库内条数（同值不重复落盘，见 chatLedgerSave 节流）
try { chatLedgerSave(myPrefix, idbArr.length, msgsBytes(idbArr)); } catch (e) {}
try {
lastIdbLoadPrefix = window.activePrefix();
lastIdbLoadAt = Date.now();
} catch (e) {}
try { localStorage.removeItem('xy-home-v2:chat-msgs'); } catch (e) {}
if (changed) {
__prof('ch6_save');
try { if (window.idbSet) persistMsgsToIdb(myPrefix + ':chat-msgs', msgs); } catch (e) {}
try { writeLsSnapshot(msgs, myPrefix, true); } catch (e) {}
__prof('ch7_end');
if (chatVisible() && chatNearBottom()) {
renderWindow(false, true);
scrollChatBottom();
}
} else if (chatVisible() && msgs.length && !body.children.length) {
// v3.26.x：冷加载（切桌面后 msgs=[]、无本地待合并，changed=false 原路径不会重渲）——
//   读库完成后聊天页仍开着且消息区为空 → 补渲染一次（同时隐藏加载进度条）
renderWindow(false, true);
scrollChatBottom();
}
// v3.26.x OOM：旧大数据字符串存量（升级前写入的 chat-msgs 单键字符串）后台一次性
// 转数组直存——此后每次读库免整包 JSON.parse（消除数百 MB 解析尖峰与秒级主线程阻塞）。
// 放在 if(changed) 之外：无本地改动（changed=false）的常见大数据场景也要迁移。
if (typeof v === 'string' && v.length > CHAT_STR_THRESHOLD && idbArr && idbArr.length) {
setTimeout(function () {
try { if (window.activePrefix() === myPrefix && window.idbSet) persistMsgsToIdb(myPrefix + ':chat-msgs', msgs); } catch (e) {}
}, 0);
}
// v3.26.x：读库完成后调度后台分批归一化（幂等，仅对当前联系跑一次）
scheduleDeferredNormalization();
} catch (e) { /* 解析失败：不置 chatDbReady，下次进入再重试 */ }
});
}
} catch (e) {}
} // v3.13.x：时间闸跳过全量重读的关闭括号
// v3.26.x：全部全量 migration/去重已移入 runDeferredNormalization 后台分批执行
// （见本文件顶部 OOM 防线注释）。此处兜底：无权威读库（IDB 缺键/读取失败回溯）
// 场景也补一次归一化调度；scheduleDeferredNormalization 按当前联系幂等去重。
if (chatDbReady && msgs.length) scheduleDeferredNormalization();
}
function escTxt(s) {
return String(s == null ? '' : s)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escTxtBr(s) {
return escTxt(s).replace(/\n/g, '<br>');
}
function pokeIconHtml(text) {
const s = String(text == null ? '' : text);
const prefix = '<svg class="st-ico"';
if (s.indexOf(prefix) === 0) {
const end = s.indexOf('</svg>');
if (end >= 0) return s.slice(0, end + 6) + escTxt(s.slice(end + 6));
}
return escTxt(s);
}
// v3.30.x：拍一拍人称「昵称制」——聊天昵称与桌面解耦后（v3.26.x），联系人昵称是聊天里
// 唯一的人称来源。拍一拍消息里除了 {ta}/{me} 占位符外，字卡文案中写死的独立人称占位
// （TA / ta / 他 / 她，语义上均指代联系人/被拍方）也一并按「联系人昵称」回填，
// 不再跟随性别称呼（他/她/TA）——否则用户改了联系人昵称，拍一拍里仍出现 TA 很费解。
// 保护段：<svg>…</svg> 图标、data:*;base64 与合成词（其他/他们/她们/他人）不受影响；
// 不用 lookbehind（旧版 iOS Safari 不支持），占位符先掩成控制符防二次替换。
function pokePersonMap(s, taNm, meNm) {
if (s === null || s === undefined) return s;
let t = String(s);
if (typeof t !== 'string' || !t) return t;
const hasPh = t.indexOf('{ta}') >= 0 || t.indexOf('{me}') >= 0;
if (hasPh) t = t.split('{ta}').join('\u0002').split('{me}').join('\u0003');
const segs = t.split(/(<svg[\s\S]*?<\/svg>)/);
for (let i = 0; i < segs.length; i += 2) {
const parts = segs[i].split(/(data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/);
for (let j = 0; j < parts.length; j += 2) {
let p = parts[j];
p = p.split('其他').join('\u0004').split('他们').join('\u0005').split('她们').join('\u0006').split('他人').join('\u0007');
p = p.split('TA').join(taNm);
p = p.replace(/\bta\b/g, taNm);
p = p.split('他').join(taNm).split('她').join(taNm);
p = p.split('\u0004').join('其他').split('\u0005').join('他们').split('\u0006').join('她们').split('\u0007').join('他人');
parts[j] = p;
}
segs[i] = parts.join('');
}
t = segs.join('');
if (hasPh) t = t.split('\u0002').join(taNm).split('\u0003').join(meNm);
return t;
}
function attrEsc(s) {
return String(s == null ? '' : s)
.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function restoreEscapedPokeIcons() {
let escMigrated = false;
msgs.forEach(r => {
if (r && r.special === 'poke' && typeof r.text === 'string' && r.text.indexOf('&lt;svg class=&quot;st-ico&quot;') === 0) {
const mm = r.text.match(/^(&lt;svg class=&quot;st-ico&quot;[\s\S]*?&lt;\/svg&gt;)([\s\S]*)$/);
if (mm) {
r.text = mm[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') + mm[2];
escMigrated = true;
}
}
});
return escMigrated;
}
function chatLabel(ck, dk, fb) {
let v = null;
try { v = store.get(ck); } catch (e) {}
if (v) return v;
// v3.26.x：dk 传 null 表示不回退桌面键——聊天昵称与桌面彻底解耦（用户要求：聊天设置里
// 联系人/我的昵称不再跟随桌面，未设时用默认占位 TA/我，即 v3.8.x 原设计）
if (!dk) return fb;
try { v = store.get(dk); } catch (e) {}
return v || fb;
}
// v3.26.x：聊天昵称与桌面解耦——只读聊天专用键 cs-lbl-*，未设时默认 TA/我，
// 不再回退读桌面 lbl-partner/lbl-user（v3.9.x 的「跟随桌面」按用户要求取消）
function chatPartnerName() { return chatLabel('cs-lbl-partner', null, 'TA'); }
window.chatPartnerName = chatPartnerName;
function chatUserName() { return chatLabel('cs-lbl-user', null, '我'); }
// v3.25.x：系统消息昵称动态化——改名后历史系统消息称呼跟随当前昵称。
// 存储：改名时把旧昵称从系统标记记录的 text 清扫成 {ta} 占位符（白名单=renderMsg 里走
//   T(rec.text) 的分支，普通气泡 text 永不扫、永不换）；渲染：T() 把 {ta} 换回当前昵称。
// {ta} 含花括号，不可能出现在 base64 字母表/svg 文本里；但被清扫的旧名可能撞上 base64/svg
// 段（如默认名 TA），清扫按 taFit 同款分段保护。hist/swept 每桌面各存一份，loadMsgs 惰性补扫。
function sysNickCur() { return chatPartnerName(); }
function sysNickHistGet(st) {
try {
const v = JSON.parse(st.get('sysmsg-nick-hist') || '[]');
if (Array.isArray(v)) return v.filter(x => typeof x === 'string' && x);
} catch (e) {}
return [];
}
function sysNickSweepText(s, oldName) {
const segs = String(s).split(/(<svg[\s\S]*?<\/svg>)/);
for (let i = 0; i < segs.length; i += 2) {
const parts = segs[i].split(/(data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/);
for (let j = 0; j < parts.length; j += 2) {
if (parts[j].indexOf(oldName) >= 0) parts[j] = parts[j].split(oldName).join('{ta}');
}
segs[i] = parts.join('');
}
return segs.join('');
}
function sysNickSweepable(r) {
if (!r || typeof r.text !== 'string' || !r.text) return false;
if (r.mailNotice) return true;
return r.special === 'poke' || r.special === 'ask-msg' || r.special === 'call' ||
r.special === 'call-reply' || r.special === 'invite-reply' || r.special === 'pong' ||
r.special === 'brick' || r.special === 'memory';
}
function sysNickSweepMsgs(arr, oldName) {
let changed = false;
for (let i = 0; i < arr.length; i++) {
const r = arr[i];
if (!sysNickSweepable(r) || r.text.indexOf(oldName) < 0) continue;
const t = sysNickSweepText(r.text, oldName);
if (t !== r.text) { r.text = t; changed = true; }
}
return changed;
}
function sysNickCatchup() {
const cur = sysNickCur();
const hist = sysNickHistGet(store);
if (!hist.length) {
try { store.set('sysmsg-nick-hist', JSON.stringify([cur])); store.set('sysmsg-nick-swept', '1'); } catch (e) {}
return false;
}
let changed = false;
if (hist[hist.length - 1] !== cur) {
// 名字在上次会话后被改动（含绕过钩子的外部写入，如备份导入）：旧尾名清扫成 {ta}，与改名钩子同效
if (sysNickSweepMsgs(msgs, hist[hist.length - 1])) changed = true;
hist.push(cur);
try { store.set('sysmsg-nick-hist', JSON.stringify(hist)); } catch (e) {}
}
let swept = 0;
try { swept = parseInt(store.get('sysmsg-nick-swept'), 10) || 0; } catch (e) {}
if (swept < hist.length) {
for (let i = swept; i < hist.length; i++) {
if (hist[i] && hist[i] !== cur && sysNickSweepMsgs(msgs, hist[i])) changed = true;
}
try { store.set('sysmsg-nick-swept', String(hist.length)); } catch (e) {}
}
return changed;
}
let avatarBatchCache = null;
function fillAvatar(el, key) {
if (typeof el === 'string') el = document.getElementById(el);
if (!el) return;
let data;
if (avatarBatchCache && key in avatarBatchCache) {
data = avatarBatchCache[key];
} else {
data = store.get(key);
if (!data && key === 'cs-avatar-partner') data = store.get('avatar-partner');
if (!data && key === 'cs-avatar-user') data = store.get('avatar-user');
if (avatarBatchCache) avatarBatchCache[key] = data || null;
}
if (data && data.length > 500 * 1024) data = null;
if (data) {
const img = document.createElement('img');
img.src = data;
img.alt = '';
el.innerHTML = '';
el.appendChild(img);
} else {
el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#999999" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>';
}
}
window.fillAvatar = fillAvatar;
function refreshChatAvatars() {
// v3.16.x：先清批量渲染缓存——渲染窗口内某条消息 renderMsg 抛异常会跳过末尾的
// appendAvatarBatch(false)，avatarBatchCache 残留后 fillAvatar 永远读缓存旧值，
// 换头像后回前台/切桌面触发的刷新仍显示旧头像（刷新页面才恢复）。这里强制失效，
// 让本次刷新重新读存储最新值。
avatarBatchCache = null;
fillAvatar('chat-user-av', 'cs-avatar-user');
fillAvatar('chat-partner-av', 'cs-avatar-partner');
document.querySelectorAll('.msg-in .msg-av').forEach(av => fillAvatar(av, 'cs-avatar-partner'));
document.querySelectorAll('.msg-out .msg-av').forEach(av => fillAvatar(av, 'cs-avatar-user'));
}
window.refreshChatAvatars = refreshChatAvatars;
fillAvatar('chat-user-av', 'cs-avatar-user');
fillAvatar('chat-partner-av', 'cs-avatar-partner');
try {
document.addEventListener('mochi-restore-done', function () {
try {
// FIX 2026-09-01 #120：大历史桌面跳过 restore 完成时的强读（进入聊天页才读），防低端机崩溃
chatPrefetchIfLight(function () { loadMsgs(true); });
if (chatVisible() && chatNearBottom() && body && msgs.length) {
renderWindow(false, true);
scrollChatBottom();
}
fillAvatar('chat-user-av', 'cs-avatar-user');
fillAvatar('chat-partner-av', 'cs-avatar-partner');
try { updateChatPartnerName(); } catch (e) {}
} catch (e) {}
});
} catch (e) {}
const pname = document.getElementById('chat-partner-name');
function updateChatPartnerName() {
if (!pname) return;
let saved = null;
try { saved = store.get('cs-lbl-partner'); } catch (e) {}
if (saved) { pname.textContent = saved; return; }
// v3.26.x：聊天与桌面昵称解耦——不再回退读桌面 lbl-partner；未设聊天专用昵称时
// 回退联系人名片名（联系人管理里的名字，非桌面美化昵称），最后默认 TA
try {
if (window.getContacts) {
const c = window.getContacts().find(x => x.id === (window.__activeCid || 'default'));
if (c && c.name) { pname.textContent = c.name; return; }
}
} catch (e) {}
pname.textContent = window.taWord ? window.taWord() : 'TA';
}
updateChatPartnerName();
window.renderChatHeader = updateChatPartnerName;
try {
document.addEventListener('mochi-wrj-heal', function () { try { updateChatPartnerName(); } catch (e) {} });
} catch (e) {}
const typingEl = document.getElementById('chat-typing');
let typingOn = false;
function chatVisible() {
const p = document.getElementById('page-chat');
return !!(p && !p.hidden);
}
// v3.26.x：聊天记录加载进度条显隐——消息区为空且权威数据未就绪时显示「正在加载聊天记录…」，
//   读库完成（chatDbReady=true 且 msgs 非空）或离开聊天页自动隐藏
function updateChatLoading() {
if (!chatLoadingEl) return;
chatLoadingEl.hidden = !(chatVisible() && !chatDbReady && !msgs.length);
}
// FIX #162（iPad Air 7 / iPadOS 26 Safari：对方回一条消息视图就向上漂一次，不贴最新消息）
// 贴底钉住态：程序化滚到底时置真，用户手动触摸/滚轮滚动即解除；复写与图片补滚只在钉住时进行
let chatPinnedBottom = true;
function scrollChatBottom() {
const cb = document.getElementById('chat-body');
if (cb) { chatPinnedBottom = true; cb.scrollTop = cb.scrollHeight; }
}
function chatNearBottom() {
const cb = document.getElementById('chat-body');
if (!cb) return true;
return cb.scrollHeight - cb.scrollTop - cb.clientHeight < 120;
}
function maybeScrollChatBottom(side) {
if (batchRendering) {
if (side === 'out') pendingOutScroll = true;
return;
}
if (!chatVisible()) return;
const out = side === 'out';
if (!out && !chatNearBottom()) return;
scrollChatBottom();
if (out) {
requestAnimationFrame(scrollChatBottom);
setTimeout(scrollChatBottom, 120);
} else {
// FIX #162：来消息侧原本只写一次 scrollTop——iPadOS 26 Safari 内核可能丢弃/被迟到的
// 布局变更顶开；对齐 out 侧三连写口径，钉住期间才复写（用户已手动滚走则不抢滚动权）
requestAnimationFrame(() => { if (chatPinnedBottom) scrollChatBottom(); });
setTimeout(() => { if (chatVisible() && chatPinnedBottom) scrollChatBottom(); }, 150);
}
}
function showTyping() {
if (!typingEl) return;
typingOn = true;
if (chatVisible()) {
typingEl.hidden = false;
scrollChatBottom();
setTimeout(scrollChatBottom, 60);
}
}
function hideTyping() {
if (!typingEl) return;
typingOn = false;
typingEl.hidden = true;
scrollChatBottom();
}
function cfg() { return (window.replyCfg && window.replyCfg()) || {}; }
function cfgn(c, k, d) { const v = c[k]; return v === undefined ? d : v; }
function hit(p) { return Math.random() * 100 < p; }
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
function pickN(arr, n) {
const copy = arr.slice();
const out = [];
while (copy.length && out.length < n) {
out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
}
return out;
}
function getPool() {
const cards = (window.getCustomCards && window.getCustomCards()) || [];
const pokeSet = (function () {
const pk = (window.getPokeCards && window.getPokeCards()) || [];
return pk.length ? new Set(pk) : null;
})();
const text = [], kaomoji = [], emoji = [], sticker = [], image = [], voice = [], poke = [];
const mediaSticker = (window.getMediaCards && window.getMediaCards('sticker')) || [];
const mediaImage = (window.getMediaCards && window.getMediaCards('image')) || [];
const mediaVoice = (window.getMediaCards && window.getMediaCards('voice')) || [];
sticker.push.apply(sticker, mediaSticker);
image.push.apply(image, mediaImage);
voice.push.apply(voice, mediaVoice);
cards.forEach(c => {
if (pokeSet && pokeSet.has(c)) return; // 拍一拍字卡不进普通回复池
if (typeof c === 'string' && c.indexOf('data:') === 0) return; // dataURL 已按媒体分类
if (typeof c === 'string' && c.indexOf('|||') >= 0) return;
if (/[\uD800-\uDBFF]/.test(c) || /^[😀-🙏🌀-🫿]/u.test(c)) emoji.push(c);
else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) kaomoji.push(c);
else text.push(c);
});
try {
const dcfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
const isOff = window.isDefaultCardOff || null;
const useChat = window.defaultCardUse ? window.defaultCardUse('chat') : true;
const catOn = window.defaultCardCat || (() => true);
if (dcfg.enabled !== false && useChat) {
// v3.26.x #157：默认主字卡只在自定义 text 池为空时兜底并入——原实现开启即把 4600+
// 张默认主字卡无条件全量并入回复池，「整体概率」dc-overall（如 5%）只管 genOneReply
// 里 drawCards 那条混入路径，对池子本身无效：650 张自定义对 4600+ 默认均匀随机抽取，
// 体感「概率调到 5% 联系人还是基本用默认字卡」（小米15Pro+Chrome 等多机型反馈）。
// 对齐颜文字/emoji 分支的兜底语义：有自定义就用自定义，默认字卡按 dc-overall 概率混入。
if (catOn('main') && !text.length) {
const defGrps = (window.getDefaultCardGroups && window.getDefaultCardGroups('main')) || [];
defGrps.forEach(g => {
const arr = g[1] || [];
arr.forEach(c => {
if (isOff && isOff('main', c)) return;
if (typeof c !== 'string' || !c) return;
if (/[\uD800-\uDBFF]/.test(c)) emoji.push(c);
else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) kaomoji.push(c);
else text.push(c);
});
});
}
if (catOn('kaomoji') && !kaomoji.length) {
const kg = (window.getDefaultCardGroups && window.getDefaultCardGroups('kaomoji')) || [];
kg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('kaomoji', c)) return; if (typeof c === 'string' && c) kaomoji.push(c); }));
}
if (catOn('emoji') && !emoji.length) {
const eg = (window.getDefaultCardGroups && window.getDefaultCardGroups('emoji')) || [];
eg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('emoji', c)) return; if (typeof c === 'string' && c) emoji.push(c); }));
}
}
} catch (e) {}
return { text, kaomoji, emoji, sticker, image, voice, poke };
}
// v3.27.x：暴露给番茄钟陪伴模式复用——让陪伴中的 TA 使用与普通聊天一致的字卡池回复
window.getPool = getPool;
// v3.27.x：生成回复前确保字卡池就绪——冷启动挂起大键（__xyIdbDeferredKeys，见 idb.js
// v3.14.x OOM 防线）时同步读回复池是空库，此前首条回复直接落 FALLBACK_REPLY_POOL，
// 某些手机上联系人因此一直发兜底那几条系统预设字卡（用户反馈）。
// v3.28.x：修「还有手机没解决」——① 等待上限 2.5s 对慢 IDB（iOS 挂后台杀连接、
// 大图字卡库）太短，放宽到与 idbHydrateKey 自身 8s 超时对齐；② 回复池主源是当前
// 联系人的专属字卡，此前走「公用→专属」共享链，公用大键慢会拖住专属，改为专属优先
// 直取（hydrateReplyScope），就绪即放行、公用随后后台补；③ 取回失败/超时记冷却，
// 冷却期内池子仍空时不再每条回复干等，避免坏 IDB 手机每次回复都白等；④ 始终不阻塞
//（超时保留原兜底，下次回复重试；池子一旦就绪立即走自定义字卡）。
// v3.28.x（根因收口）：就绪判定以「自定义字卡是否就位」为准，不用合并池——合并池含
// 系统默认字卡，默认字卡开关开着时池子恒非空，旧判定直接放行，挂起大键里的自定义
// 字卡永不取回，联系人只发默认/兜底那几条系统预设字卡（Phase E 复现：池 4728 张
// 系统卡但自定义 MARKER 不在内）。取回完成或确认无自定义字卡（用户确实没加）即放行，
// 靠默认字卡/兜底回复，不阻塞。
function hasCustomReplyCards() {
  try {
    const cc = (window.getCustomCards && window.getCustomCards()) || [];
    return cc.length > 0;
  } catch (e) { return false; }
}
let lastHydFailAt = 0;
const HYDR_FAIL_COOLDOWN = 30000;
// v3.28.x（第三层收口）：回复池后台自愈——坏/慢 IDB 手机上单次取回可能整体失败
//（idbHydrateKey 8s 内两次尝试仍挂，事务队列被占/连接反复被断），此前每次回复只
// 干等一次、失败后进冷却不再取 → 池子整会话读空，联系人一直发兜底那几条系统预设字卡。
// 这里在「池仍空」时安排有界低频后台重试：每 5s 一次、上限 12 次，一旦自定义字卡
// 就绪立即停；只要设备 IDB 恢复/启动回填落定，池子取回后【后续所有回复】马上用上
// 自定义字卡，不再一直兜底。内存成本与现有回复路径一致（回复本来就会触发取回），
// 不会额外把大库拉进堆；每次尝试走 hydrateReplyScope（in-flight 去重 + absent 缓存）。
let _replyWatcherTimer = null;
let _replyWatcherLeft = 0;
const _REPLY_WATCHER_MAX = 12;
const _REPLY_WATCHER_INTERVAL = 5000;
function _replyWatcherStop() {
  if (_replyWatcherTimer) { clearTimeout(_replyWatcherTimer); _replyWatcherTimer = null; }
  _replyWatcherLeft = 0;
}
function _replyWatcherTick() {
  _replyWatcherTimer = null;
  if (hasCustomReplyCards()) { _replyWatcherStop(); return; }
  let done = false;
  const settle = function () {
    if (done) return; done = true;
    if (hasCustomReplyCards()) { _replyWatcherStop(); return; }
    _replyWatcherKick();
  };
  try {
    // 专属优先（回复池主源）；就绪即停，公用后台补
    window.hydrateReplyScope('own', function () {
      if (hasCustomReplyCards()) { settle(); return; }
      window.hydrateReplyScope('public', function () { settle(); });
    });
  } catch (e) { settle(); }
}
function _replyWatcherKick() {
  try {
    if (hasCustomReplyCards()) { _replyWatcherStop(); return; }
    if (!window.hydrateReplyScope || _replyWatcherTimer || _replyWatcherLeft <= 0) return;
    _replyWatcherLeft--;
    _replyWatcherTimer = setTimeout(_replyWatcherTick, _REPLY_WATCHER_INTERVAL);
  } catch (e) {}
}
function _replyWatcherStart() {
  try {
    if (hasCustomReplyCards() || _replyWatcherTimer || _replyWatcherLeft > 0) return;
    _replyWatcherLeft = _REPLY_WATCHER_MAX;
    _replyWatcherKick();
  } catch (e) {}
}
function ensureReplyCardsReady(capMs) {
  // v3.28.x：等待上限 8s→20s——专属+公用双键串行取回最坏 16s（每键对齐 idbHydrateKey
  // 内部 4s+4s 重试），8s 会切断慢 IDB 手机（真我/荣耀 Edge 事务偶发挂起、MB 级大键读取
  // 耗时长的真机）的取回完成点，回复池整会话读空落兜底卡。20s 让双键都能跑完；超时后
  // 冷却期内池子仍空时不再每条回复干等（坏 IDB 手机直接快出兜底），池子一旦就绪立即走
  // 自定义字卡（就绪判定在冷却检查之前，冷却不会挡住已就绪的池子）。
  // 取回失败/超时/完成后池仍空 → 启动后台自愈重试（_replyWatcherStart），等设备恢复。
  const cap = capMs || 20000;
  try {
    if (hasCustomReplyCards()) { lastHydFailAt = 0; _replyWatcherStop(); return Promise.resolve(true); }
    if (!window.hydrateReplyScope) return Promise.resolve(false);
    // 取回失败/超时冷却：自定义字卡仍缺且刚失败过，不再干等（直接回兜底路径，等下次回复重试）
    if (Date.now() - lastHydFailAt < HYDR_FAIL_COOLDOWN) { _replyWatcherStart(); return Promise.resolve(false); }
    return new Promise((res) => {
      let settled = false;
      const tm = setTimeout(() => { if (!settled) { settled = true; lastHydFailAt = Date.now(); _replyWatcherStart(); res(false); } }, cap);
      const finish = (ok) => { if (!settled) { settled = true; clearTimeout(tm); res(ok); } };
      // 专属字卡优先取回（回复池主源）；就绪即放行，公用字卡后台补
      window.hydrateReplyScope('own', () => {
        if (hasCustomReplyCards()) {
          try { if (window.hydrateLibScopes) window.hydrateLibScopes(['public']); } catch (e) {}
          _replyWatcherStop();
          finish(true);
          return;
        }
        // 专属取回完成仍无自定义字卡 → 再取公用；取回完成（或确认无此键）即放行，
        // 避免没加自定义字卡的用户每条回复都干等
        window.hydrateReplyScope('public', () => {
          if (!hasCustomReplyCards()) _replyWatcherStart(); // 池仍空 → 后台自愈重试
          finish(true);
        });
      });
    });
  } catch (e) { return Promise.resolve(false); }
}
window.ensureReplyCardsReady = ensureReplyCardsReady;
// v3.26.x：回复字卡池诊断——「联系人一直只发【收到～】」报障时直接定位：池子各类型数量、
// 自定义字卡总数、默认字卡三个开关，打进设置→复制诊断信息的【数据】节。省去依赖用户手数。
window.__replyPoolDiag = function () {
  try {
    const P = getPool();
    const cfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
    const customRaw = (window.getCustomCards && window.getCustomCards()) || [];
    return [
      '池text=' + P.text.length,
      'kaomoji=' + P.kaomoji.length,
      'emoji=' + P.emoji.length,
      'sticker=' + P.sticker.length,
      'image=' + P.image.length,
      'voice=' + P.voice.length,
      'poke=' + P.poke.length,
      '自定义字卡=' + customRaw.length,
      '默认总开关=' + cfg.enabled,
      '聊天使用=' + (window.defaultCardUse ? window.defaultCardUse('chat') : '?'),
      '主字卡=' + (window.defaultCardCat ? window.defaultCardCat('main') : '?'),
      // v3.26.x #163：补概率滑杆现场——「默认概率调到八九十还是总发自定义字卡」类报障
      // 直接核对 dc-overall-chat（场景概率，未设回退整体）与主字卡分类占比是否真调到位
      '默认概率chat=' + (cfg.overallFor ? cfg.overallFor('chat') : cfg.overall),
      '主卡占比=' + (cfg.probs ? cfg.probs.main : '?')
    ].join(' / ');
  } catch (e) { return '诊断出错:' + e.message; }
};
function fmtTime(ts) {
if (!ts) return '';
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function timeDividerText(ts) {
if (!ts) return '';
const d = new Date(ts);
const now = new Date();
const p = (n) => (n < 10 ? '0' + n : '' + n);
const h12 = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
const hm = (d.getHours() < 12 ? '上午 ' : '下午 ') + h12 + ':' + p(d.getMinutes());
const dayOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
const dayGap = Math.round((dayOf(now) - dayOf(d)) / 86400000);
if (dayGap <= 0) return hm;
if (dayGap === 1) return '昨天 ' + hm;
if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
let chatVoiceAudio = null;
let chatVoiceBtn = null;
function stopChatVoice() {
if (chatVoiceAudio) { try { chatVoiceAudio.pause(); } catch (e) {} chatVoiceAudio = null; }
if (chatVoiceBtn) { chatVoiceBtn.classList.remove('playing'); chatVoiceBtn = null; }
}
function playVoiceInChat(btn, src) {
if (!src) { toast('语音数据缺失'); return; }
if (chatVoiceBtn === btn) { stopChatVoice(); return; }
stopChatVoice();
const a = new Audio(src);
chatVoiceAudio = a;
chatVoiceBtn = btn;
btn.classList.add('playing');
a.addEventListener('ended', stopChatVoice);
a.addEventListener('error', () => { stopChatVoice(); toast('语音播放失败'); });
a.play().catch(() => { stopChatVoice(); toast('语音播放失败'); });
}
function voicePartsOf(text) {
const p = String(text || '').split('|||');
return { name: (p[0] || '语音消息').replace(/\.[^.]+$/, ''), src: p[1] || '' };
}
function fillVoiceBubble(b, text, prefixHtml) {
const v = voicePartsOf(text);
b.innerHTML = (prefixHtml || '') + '<div class="msg-voice" data-src="' + attrEsc(v.src) + '">' +
'<button class="msg-voice-play" title="播放">' +
// 播放/暂停双图标：playing 时 CSS 切换显示，点按三角↔双竖条有互动态（录制面板试听钮同款）
'<svg class="voice-ico-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
'<svg class="voice-ico-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' +
'</button>' +
'<div class="msg-voice-wave"><i></i><i></i><i></i><i></i><i></i></div>' +
'<span class="msg-voice-name">' + escTxt(v.name) + '</span>' +
'</div>';
const btn = b.querySelector('.msg-voice-play');
if (btn) btn.addEventListener('click', function (e) {
e.stopPropagation();
if (v.src) playVoiceInChat(btn, v.src);
else toast('语音数据缺失');
});
}
const QUOTE_PLACEHOLDER = /^(图片|表情包|\[图片\]|\[表情包\])$/;
// 旧数据兜底：修复前 TA 自动引用存的是原始 text（语音为「名称|||data:audio;base64…」），
// 直出会整串 base64 铺满屏幕。渲染前统一还原成可读标签，新数据本已是标签、原样通过。
function quoteTextSafe(s) {
let str = String(s == null ? '' : s);
// #148：媒体池令牌（@@m:hash）是图片载荷不是文本，直出会把令牌串当文字铺进引用块/引用预览条
if (window.mochiMediaIsToken && window.mochiMediaIsToken(str)) return '';
const bar = str.indexOf('|||');
if (bar >= 0) str = bar > 0 ? '[语音] ' + str.slice(0, bar) : '';
const di = str.indexOf('data:');
if (di > 0 && str.length - di > 120) str = str.slice(0, di).trim();
return str;
}
function quoteHtml(q, side) {
const __fitQ = (side !== 'out') && !!window.taFit;
const FQ = (s) => (__fitQ ? window.taFit(s) : s);
if (q && typeof q === 'object') {
// #148：图片载荷除 data: 外还有媒体池令牌 @@m:hash——令牌照常渲染成 <img src>，
// 渲染期由 media-pool 文档级观察器解析成池数据（与消息本体图片同一机制）
const isQM = (s) => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s)));
const imgs = (q.imgs || []).filter(isQM).slice(0, 3);
const t = quoteTextSafe(q.t);
const tHtml = (t && t.indexOf('data:') !== 0 && !(imgs.length && QUOTE_PLACEHOLDER.test(t))) ? escTxtBr(FQ(t)) : '';
let inner = '';
if (imgs.length) inner += '<span class="msg-quote-imgs">' + imgs.map(s => '<img class="msg-quote-img" src="' + attrEsc(s) + '" alt="图片" loading="lazy" decoding="async">').join('') + '</span>';
if (tHtml) inner += '<span class="msg-quote-text">' + tHtml + '</span>';
return '<div class="msg-quote">' + inner + '</div>';
}
if (typeof q === 'string' && (q.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(q)))) {
return '<div class="msg-quote"><img class="msg-quote-img" src="' + attrEsc(q) + '" alt="图片" loading="lazy" decoding="async"></div>';
}
const qs = quoteTextSafe(q);
return '<div class="msg-quote"><span class="msg-quote-text">' + escTxtBr(FQ(qs)) + '</span></div>';
}
let inplaceDrafts = {};
// v3.28.x：当前聚焦的互动卡片输入栏下标。联系人新消息触发整窗重渲染（renderWindow）会
// 重建输入框，若不在重建后回补 focus，安卓会收起输入法、卡片像被收起，打断用户输入。
// 用 document focusin/focusout 跟踪（contenteditable `.ce-box` 上 activeElement 常为 body，
// 单看 activeElement 不可靠；focusin 能命中 ceBox，故以此为权威）。
let inplaceFocusIdx = -1;
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (!t || t.nodeType !== 1 || !t.closest) return;
  if (!t.closest('.msg-inplace')) return;
  const item = t.closest('.msg-ask');
  inplaceFocusIdx = item && item.dataset.idx !== undefined ? Number(item.dataset.idx) : -1;
});
document.addEventListener('focusout', () => {
  const ae = document.activeElement;
  if (ae && ae.nodeType === 1 && ae.closest && ae.closest('.msg-inplace')) return;
  inplaceFocusIdx = -1;
});
function inplaceTypeOf(rec) {
if (!rec) return null;
if (rec.special === 'ask-choose') return 'choose';
if (rec.special === 'ask-curious') return 'curious';
if (rec.special === 'ask-roast') return 'roast';
if (rec.special === 'ask-card') return 'ask';
return null;
}
function collectInplaceDrafts() {
if (!body) return;
inplaceDrafts = {};
// 快照当前聚焦下标：这里是清空 body 前唯一能读到「仍在聚焦」的位置（focusout 在
// innerHTML='' 时才触发）。activeElement 命中 input 或它的 ceBox 都算聚焦，作为兜底。
try {
const ae = document.activeElement;
if (ae && ae.nodeType === 1 && ae.closest && ae.closest('.msg-inplace')) {
const fi = ae.closest('.msg-ask');
if (fi && fi.dataset.idx !== undefined) inplaceFocusIdx = Number(fi.dataset.idx);
}
} catch (e) {}
body.querySelectorAll('.msg-ask[data-idx] .msg-inplace input.ip-input').forEach(inp => {
const item = inp.closest('.msg-ask');
if (!item || item.dataset.idx === undefined) return;
const idx = Number(item.dataset.idx);
const t = inplaceTypeOf(msgs[idx]);
if (t && (inp.value || '').trim()) inplaceDrafts[idx] = { type: t, value: inp.value };
});
// 若 focusin 跟踪的下标在当前渲染里指向已作答卡片则失效；未作答的（含空输入）保留，
// 以便重渲染后重开输入栏、维持焦点不被打断
if (inplaceFocusIdx >= 0) {
const ridx = msgs[inplaceFocusIdx];
if (ridx && inplaceTypeOf(ridx) !== null && inplaceAnswered(ridx)) inplaceFocusIdx = -1;
}
}
function inplaceAnswered(rec) {
if (!rec) return true;
return (
(rec.special === 'ask-choose' && rec.choiceStatus === 'answered') ||
(rec.special === 'ask-curious' && rec.curiousStatus === 'answered') ||
(rec.special === 'ask-roast' && rec.roastStatus === 'answered') ||
(rec.special === 'ask-card' && rec.askStatus === 'answered')
);
}
function restoreInplaceDrafts() {
if (!body) return;
Object.keys(inplaceDrafts).forEach(k => {
const idx = Number(k);
const d = inplaceDrafts[k];
if (!d || !d.type || d.type === 'choose') { delete inplaceDrafts[k]; return; } // 单选无输入框，草稿无效
const item = body.querySelector('.msg-ask[data-idx="' + idx + '"]');
if (!item || item.querySelector('.msg-inplace')) return;
const rec = msgs[idx];
if (!rec || !d.value) { delete inplaceDrafts[k]; return; }
const done =
(d.type === 'curious' && rec.curiousStatus === 'answered') ||
(d.type === 'roast' && rec.roastStatus === 'answered') ||
(d.type === 'ask' && rec.askStatus === 'answered');
if (done) { delete inplaceDrafts[k]; return; }
if (!expandCardInPlace(idx, d.type)) { delete inplaceDrafts[k]; return; }
const inp = body.querySelector('.msg-ask[data-idx="' + idx + '"] .msg-inplace input.ip-input');
if (inp) {
inp.value = d.value;
try {
const r = document.createRange();
const box = inp.__ceBox || inp;
r.selectNodeContents(box);
r.collapse(false);
const s = window.getSelection();
s.removeAllRanges();
s.addRange(r);
} catch (e) {}
// v3.28.x：重建后若正是重渲染前聚焦的那张卡片，回补焦点，让输入法保持弹出、不被收起
if (inplaceFocusIdx === idx) {
setTimeout(() => { try { inp.focus(); } catch (e) {} }, 0);
}
}
});
// v3.28.x：聚焦但还没打字的输入栏不在草稿字典里，重建后补开输入栏，维持焦点不被打断
// （expandCardInPlace 内部会对输入框 refocus）
if (inplaceFocusIdx >= 0) {
const idx = inplaceFocusIdx;
const item = body.querySelector('.msg-ask[data-idx="' + idx + '"]');
if (item && !item.querySelector('.msg-inplace')) {
const rec = msgs[idx];
const type = inplaceTypeOf(rec);
if (type && !inplaceAnswered(rec)) try { expandCardInPlace(idx, type); } catch (e) {}
}
}
}
function expandCardInPlace(idx, type) {
const el = body.querySelector('.msg-ask[data-idx="' + idx + '"]');
if (!el) return false;
const rec = msgs[idx];
if (!rec) return false;
if (el.querySelector('.msg-inplace')) { el.querySelector('.msg-inplace').remove(); delete inplaceDrafts[idx]; return true; }
const done =
(type === 'choose' && rec.choiceStatus === 'answered') ||
(type === 'curious' && rec.curiousStatus === 'answered') ||
(type === 'roast' && rec.roastStatus === 'answered') ||
(type === 'ask' && rec.askStatus === 'answered');
if (done && type === 'ask' && rec.askType === 'single' && Array.isArray(rec.askOptions) && rec.askOptions.length) {
const card = el.querySelector('.msg-ask-card');
if (!card) return false;
const wrap = document.createElement('div');
wrap.className = 'msg-inplace';
const chosen = String(rec.askAnswer || '');
(rec.askOptions || []).forEach(o => {
const row = document.createElement('div');
row.className = 'ip-opt-row' + (String(o.t || '') === chosen ? ' sel' : '');
let replyTxt = '';
if (Array.isArray(o.reply) && o.reply.length) {
const arr = o.reply.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
if (arr.length === 1) replyTxt = arr[0];
else if (arr.length > 1) replyTxt = arr[0] + ' 等' + arr.length + '条';
} else if (typeof o.reply === 'string' && o.reply.trim()) {
replyTxt = o.reply.trim();
}
row.innerHTML = '<span class="ip-opt-t">' + escTxt(String(o.t || '')) + '</span>' +
(replyTxt ? '<span class="ip-opt-reply">' + escTxt(replyTxt) + '</span>' : '');
wrap.appendChild(row);
});
card.appendChild(wrap);
return true;
}
if (done) return false;
const card = el.querySelector('.msg-choose-card, .msg-ask-card');
if (!card) return false;
const wrap = document.createElement('div');
wrap.className = 'msg-inplace';
if (type === 'choose') {
const opts = rec.choiceOptions || [];
if (!opts.length) return false;
opts.forEach((o, i) => {
const b = document.createElement('button');
b.className = 'ip-opt';
b.textContent = String(o.t || '');
b.addEventListener('click', () => {
const prefIdx = typeof rec.choicePref === 'number' ? rec.choicePref : 0;
const prefTxt = opts[prefIdx] ? opts[prefIdx].t : '';
const isPref = i === prefIdx;
const isLiked = o.liked === true || o.liked === 'true';
const matchTxt = isPref ? '✦ 刚好想到了一起'
: isLiked ? '你们想得不一样，不过TA似乎很喜欢你的答案'
: '这次没有选到一起。TA心里想的是：「' + prefTxt + '」';
if (window.chatChooseReply) window.chatChooseReply(idx, String(o.t || ''), o, matchTxt);
if (window.logFish) window.logFish();
});
wrap.appendChild(b);
});
} else if (type === 'ask' && (rec.askType === 'single' || (rec.type === 'single' && Array.isArray(rec.options) && rec.options.length))) {
const opts = Array.isArray(rec.askOptions) ? rec.askOptions : (Array.isArray(rec.options) ? rec.options : []);
if (!opts.length) return false;
opts.forEach((o, i) => {
const b = document.createElement('button');
b.className = 'ip-opt';
b.textContent = String(o.t || '');
b.addEventListener('click', () => {
if (window.chatAskReply) window.chatAskReply(idx, String(o.t || ''), o.reply);
if (window.logFish) window.logFish();
});
wrap.appendChild(b);
});
} else {
const quicks = (type === 'curious' ? (rec.curiousQuick || []) : []).filter(q => typeof q === 'string' && q);
if (quicks.length) {
const chips = document.createElement('div');
chips.className = 'ip-chips';
quicks.forEach(q => {
const c = document.createElement('button');
c.className = 'ip-chip';
c.textContent = q;
c.addEventListener('click', () => { try { inp.value = q; inp.focus(); } catch (e) {} });
chips.appendChild(c);
});
wrap.appendChild(chips);
}
const row = document.createElement('div');
row.className = 'ip-row';
const inp = document.createElement('input');
inp.className = 'ip-input';
inp.type = 'text';
inp.placeholder = type === 'roast' ? (window.taFit ? window.taFit('回 TA 一句…') : '回 TA 一句…') : '输入你的回答…';
const send = document.createElement('button');
send.className = 'ip-send';
send.textContent = type === 'roast' ? (window.taFit ? window.taFit('回TA') : '回TA') : '回答';
const doSend = () => {
const v = (inp.value || '').trim();
if (!v) return;
if (type === 'curious' && window.chatCuriousReply) {
const replies = (rec.curiousReplies && rec.curiousReplies.length) ? rec.curiousReplies : ['嗯，我记住了。', '原来是这样。', '好，我记住了。'];
const reply = (window.pickAskCardReply ? window.pickAskCardReply(replies) : replies[Math.floor(Math.random() * replies.length)]);
const fw = (rec.curiousFollowup && Math.random() < 0.3) ? rec.curiousFollowup : null;
window.chatCuriousReply(idx, v, reply, fw);
} else if (type === 'roast' && window.chatRoastReply) {
const defs = ['你觉得我会信？', '少骗我。', '哼。', '好吧好吧。', '就这一次？', '行吧，放过你。', '嗯，这还差不多。'];
const pool = window.getInteractPool ? window.getInteractPool('吐槽·回应', defs) : defs;
const reply = (window.pickAskCardReply ? window.pickAskCardReply(pool) : pool[Math.floor(Math.random() * pool.length)]);
window.chatRoastReply(idx, v, reply);
} else if (type === 'ask' && window.chatAskReply) {
const defs = ['收到你的回答。', '好呀，我知道了。', '你这么说，我记住了。'];
const pool = window.getInteractPool ? window.getInteractPool('询问·回应', defs) : defs;
window.chatAskReply(idx, v, pool[Math.floor(Math.random() * pool.length)]);
}
if (window.logFish) window.logFish();
delete inplaceDrafts[idx];
};
send.addEventListener('click', doSend);
inp.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); doSend(); }
});
row.appendChild(inp);
row.appendChild(send);
wrap.appendChild(row);
const draft = inplaceDrafts[idx];
if (draft && draft.type === type && draft.value) {
inp.value = draft.value;
}
inp.addEventListener('input', () => {
inplaceDrafts[idx] = { type: type, value: inp.value || '' };
});
}
card.appendChild(wrap);
const fi = wrap.querySelector('input.ip-input');
if (fi) setTimeout(() => { try { fi.focus(); } catch (e) {} }, 60);
return true;
}
if (body) {
let rpPressTimer = null;
let rpPressSuppressClick = false;
body.addEventListener('pointerdown', (e) => {
const rpCard = e.target.closest('.msg-rp-card');
if (!rpCard) return;
const rpItem = rpCard.closest('.msg-rp');
if (!rpItem || rpItem.dataset.idx === undefined) return;
const rpRec = msgs[Number(rpItem.dataset.idx)];
if (!rpRec || rpRec.special !== 'redpacket' || rpRec.rpStatus !== 'pending' || rpRec.side !== 'in') return;
rpPressTimer = setTimeout(() => {
rpPressTimer = null;
rpPressSuppressClick = true;
if (window.openModal) {
window.openModal('退回这个红包？', '', () => {
rpRec.rpStatus = 'returned';
const w = rpWalletGet();
w.systemBalance += Math.round((rpRec.rpAmount || 0) * 100);
rpWalletSet(w);
saveMsgsNow();
renderWindow(true, true);
const amtTxt = '（心意币 ¥' + Number(rpRec.rpAmount || 0).toFixed(2) + '）';
setTimeout(() => addIn('你退回了红包' + amtTxt, { special: 'poke' }), randInt(300, 800));
}, { okText: '退回', cancelText: '取消' });
}
}, 500);
});
const rpClearPress = () => { if (rpPressTimer) { clearTimeout(rpPressTimer); rpPressTimer = null; } };
body.addEventListener('pointerup', rpClearPress);
body.addEventListener('pointerleave', rpClearPress);
body.addEventListener('pointercancel', rpClearPress);
body.addEventListener('click', (e) => {
if (!e.target.closest('.msg-ask-card, .msg-choose-card, .msg-fav-heart, .msg-inplace')) {
body.querySelectorAll('.msg-ask-card.show-fav, .msg-choose-card.show-fav').forEach(c => c.classList.remove('show-fav'));
}
const favBtn = e.target.closest('.msg-fav-heart');
if (favBtn) {
e.stopPropagation();
// v3.28.x：心形不只挂在 .msg-ask 家族（红包/送花/礼物/佳肴是 .msg-rp/.msg-flower/.msg-gift），
// 改为按最近的 data-idx 容器定位，保证所有带心形的互动卡片都能收藏
const fItem = favBtn.closest('[data-idx]');
if (fItem && fItem.dataset.idx !== undefined) window.favCardFromMsg(Number(fItem.dataset.idx));
return;
}
const rpCard = e.target.closest('.msg-rp-card');
if (rpCard) {
if (rpPressSuppressClick) { rpPressSuppressClick = false; return; }
e.stopPropagation();
const rpItem = rpCard.closest('.msg-rp');
if (!rpItem || rpItem.dataset.idx === undefined) return;
const rpIdx = Number(rpItem.dataset.idx);
const rpRec = msgs[rpIdx];
if (!rpRec || rpRec.special !== 'redpacket') return;
if (rpRec.rpStatus !== 'pending') return;
if (rpRec.side !== 'in') { toast(window.taFit ? window.taFit('等待 TA 领取') : '等待 TA 领取'); return; }
rpRec.rpStatus = 'received';
rpRec.rpOpenedAt = Date.now();
const wallet = rpWalletGet();
wallet.myBalance += Math.round((rpRec.rpAmount || 0) * 100);
rpWalletSet(wallet);
saveMsgsNow();
const amtTxt = '（心意币 ¥' + Number(rpRec.rpAmount || 0).toFixed(2) + '）';
toast('已领取' + amtTxt);
renderWindow(true, true);
setTimeout(() => addIn('你领取了红包' + amtTxt, { special: 'poke' }), randInt(400, 1000));
return;
}
if (e.target.closest('.msg-inplace')) return;
const card = e.target.closest('.msg-ask-card, .msg-choose-card');
if (!card) return;
const item = card.closest('.msg-ask');
if (!item || item.dataset.idx === undefined) return;
const idx = Number(item.dataset.idx);
const rec = msgs[idx];
if (!rec) return;
if (card.classList.contains('answered') && rec.special === 'ask' && rec.askType === 'single' && Array.isArray(rec.askOptions) && rec.askOptions.length) {
e.stopPropagation();
const hadFav = card.classList.contains('show-fav');
body.querySelectorAll('.msg-ask-card.show-fav, .msg-choose-card.show-fav').forEach(c => c.classList.remove('show-fav'));
if (!hadFav) card.classList.add('show-fav');
expandCardInPlace(idx, 'ask');
return;
}
const hadFav = card.classList.contains('show-fav');
body.querySelectorAll('.msg-ask-card.show-fav, .msg-choose-card.show-fav').forEach(c => c.classList.remove('show-fav'));
if (!hadFav) card.classList.add('show-fav');
if (card.classList.contains('answered')) { e.stopPropagation(); return; } // 已作答：只切换收藏按钮
e.stopPropagation(); // 不冒泡触发气泡操作菜单
let type = null;
if (rec.special === 'ask-choose') type = 'choose';
else if (rec.special === 'ask-curious') type = 'curious';
else if (rec.special === 'ask-roast') type = 'roast';
else if (rec.special === 'ask-card') type = 'ask';
if (!type) return;
const ok = expandCardInPlace(idx, type);
if (!ok) {
try {
if (type === 'choose' && window.openTC) window.openTC(idx);
else if (type === 'curious' && window.openCurious) window.openCurious(idx);
else if (type === 'roast' && window.openRoast) window.openRoast(idx);
else if (type === 'ask' && window.openAskReply) window.openAskReply(idx);
} catch (err) {}
}
});
}
function bindToggle(b, side) {
const who = side === 'out' ? '我' : '对方';
b.style.cursor = 'pointer';
b.onclick = function () {
if (b.dataset.showing === '1') {
b.innerHTML = '<span style="opacity:.6;font-size:12px;cursor:pointer">' + who + '撤回了一条消息</span>';
b.dataset.showing = '0';
} else {
b.innerHTML = b.dataset.orig;
b.dataset.showing = '1';
}
};
}
let batchRendering = false;
let pendingOutScroll = false;
let appendTarget = null;
function appendMsg(m) { (appendTarget || body).appendChild(m); }
function appendAvatarBatch(on) {
if (on) { if (!avatarBatchCache) avatarBatchCache = {}; }
else avatarBatchCache = null;
}
const RENDER_MAX = 200;   // 渲染窗口条数上限
const WINDOW_MAX = 400;   // v3.10.x：增量渲染窗口硬上限（含上下缓冲，防 DOM 无限膨胀）
const LOAD_STEP = 100;    // 向上滚动每次加载的条数
const TOP_THRESHOLD = 150;// scrollTop 小于此值触发向上加载（px）
const JUMP_VIEW = 30;     // 搜索跳转时目标索引上方预留的余量
let renderStart = 0;      // 渲染窗口起点（msgs 下标）；0 = 全量
let renderEnd = 0;        // v3.10.x：渲染窗口终点（msgs 下标，开区间）；增量裁剪/恢复用
const TIME_DIVIDER_GAP = 5 * 60 * 1000;
function maybeInsertDivider(idx) {
if (store.get('cs-time-style') !== 'divider') return;
if (idx < 0 || idx >= msgs.length) return;
const cur = msgs[idx];
if (!cur || !cur.ts) return;
if (idx > 0) {
const prev = msgs[idx - 1];
if (!prev || !prev.ts) return;
if (cur.ts - prev.ts < TIME_DIVIDER_GAP) return;
}
const d = document.createElement('div');
d.className = 'msg-time-divider';
d.innerHTML = '<span>' + timeDividerText(cur.ts) + '</span>';
body.appendChild(d);
}
let suppressScrollUntil = 0; // 程序化滚动后短暂忽略 scroll 事件（防渲染本身触发向上加载）
function renderWindow(keepScroll, clampTop) {
const len = msgs.length;
const prevTop = keepScroll ? body.scrollTop : 0;
const prevHeight = keepScroll ? body.scrollHeight : 0;
if (clampTop) renderStart = Math.max(0, len - RENDER_MAX);
const start = Math.min(renderStart, len);
renderEnd = len; // 整窗重建渲染到最新，窗口终点复位（裁剪状态随之清空）
collectInplaceDrafts();
body.innerHTML = '';
batchRendering = true;
const frag = document.createDocumentFragment();
appendTarget = frag;
appendAvatarBatch(true);
for (let i = start; i < len; i++) {
maybeInsertDivider(i);
const m = renderMsg(msgs[i]);
m.dataset.idx = i; // 覆盖 renderMsg 内的 msgs.length-1（批量渲染时必须为真实下标）
}
appendAvatarBatch(false);
appendTarget = null;
batchRendering = false;
body.appendChild(frag);
if (keepScroll && prevHeight > 0) {
body.scrollTop = prevTop + (body.scrollHeight - prevHeight);
}
if (pendingOutScroll) {
pendingOutScroll = false;
scrollChatBottom();
}
suppressScrollUntil = Date.now() + 200; // 本轮渲染/滚动结束后 200ms 内不响应 scroll
restoreInplaceDrafts();
updateChatLoading(); // 渲染完成（有内容或就绪）→ 隐藏加载进度条
}
window.chatReRenderTime = function () {
if (chatPage.hidden || !body.children.length) return;
renderWindow(true, false);
};
function loadOlderIncremental() {
const len = msgs.length;
if (renderStart <= 0 || renderStart >= len) return;
const newStart = Math.max(0, renderStart - LOAD_STEP);
if (newStart === renderStart) return;
const beforeTop = body.scrollTop;
const preNum = body.children.length;
const anchor = body.children[0] || null;
batchRendering = true;
const frag = document.createDocumentFragment();
appendTarget = frag;
appendAvatarBatch(true);
for (let i = newStart; i < renderStart; i++) {
maybeInsertDivider(i); // 时间分隔线：新批首条与前一条间距大时补胶囊
const m = renderMsg(msgs[i]);
m.dataset.idx = i;
}
appendAvatarBatch(false);
appendTarget = null;
batchRendering = false;
renderStart = newStart;
if (preNum > 0 && anchor) {
body.insertBefore(frag, anchor);
body.scrollTop = beforeTop + anchor.offsetTop;
} else {
body.scrollTop = body.scrollHeight; // 原窗口为空，直接滚到底
}
if (renderEnd - renderStart > WINDOW_MAX) pruneWindowBottom();
suppressScrollUntil = Date.now() + 200;
}
function loadNewerIncremental() {
const len = msgs.length;
if (renderEnd >= len) return;
const newEnd = Math.min(len, renderEnd + LOAD_STEP);
if (newEnd === renderEnd) return;
batchRendering = true;
let anchor = null;
const frag = document.createDocumentFragment();
appendTarget = frag;
appendAvatarBatch(true);
for (let i = renderEnd; i < newEnd; i++) {
if (body.querySelector('.msg[data-idx="' + i + '"]')) continue;
if (!anchor) {
for (let j = i + 1; j < len && !anchor; j++) {
anchor = body.querySelector('.msg[data-idx="' + j + '"]');
}
}
maybeInsertDivider(i);
const m = renderMsg(msgs[i]);
m.dataset.idx = i;
}
appendAvatarBatch(false);
appendTarget = null;
batchRendering = false;
renderEnd = newEnd;
if (anchor) body.insertBefore(frag, anchor);
else if (frag.childNodes.length) body.appendChild(frag);
if (newEnd - renderStart > WINDOW_MAX) pruneWindowTop();
suppressScrollUntil = Date.now() + 200;
}
function pruneWindowBottom() {
const targetEnd = renderStart + WINDOW_MAX;
if (renderEnd <= targetEnd) return;
while (body.lastChild) {
const last = body.lastChild;
const idx = last.dataset.idx;
if (idx !== undefined && parseInt(idx, 10) < targetEnd) break; // 已到应保留区
body.removeChild(last);
}
renderEnd = targetEnd;
}
function pruneWindowTop() {
const targetStart = renderEnd - WINDOW_MAX;
if (renderStart >= targetStart) return;
while (body.firstChild) {
const f = body.firstChild;
const idx = f.dataset.idx;
if (idx !== undefined && parseInt(idx, 10) >= targetStart) break; // 已到应保留区
body.removeChild(f);
}
renderStart = targetStart;
}
let bodyScrollTimer = null;
body.addEventListener('scroll', function () {
if (Date.now() < suppressScrollUntil) return;
if (bodyScrollTimer) return;
bodyScrollTimer = setTimeout(function () {
bodyScrollTimer = null;
if (!chatVisible()) return;
if (body.scrollTop < TOP_THRESHOLD) {
loadOlderIncremental();
} else if (renderEnd < msgs.length && body.scrollHeight - body.scrollTop - body.clientHeight < TOP_THRESHOLD) {
loadNewerIncremental();
}
}, 100);
}, { passive: true });
// FIX #162：用户手动触摸/滚轮滚动＝解除贴底钉住，之后的自动复写不再抢滚动权
body.addEventListener('touchstart', () => { chatPinnedBottom = false; }, { passive: true, capture: true });
body.addEventListener('wheel', () => { chatPinnedBottom = false; }, { passive: true });
// FIX #162：消息图片是 loading=lazy，加载完成晚于滚底，加载后内容长高会把视图从底部顶开
//（iPadOS 26 Safari 尤其明显＝「回一条滑一次」）——钉住期间任何消息图片 onload 后回到底部
body.addEventListener('load', (e) => {
const t = e.target;
if (!t || t.tagName !== 'IMG') return;
if (!chatPinnedBottom || batchRendering || !chatVisible()) return;
requestAnimationFrame(scrollChatBottom);
}, true);
// FIX 2026-09-06 #202 表情/图片加载失败占位：#186 只覆盖了媒体池令牌缺失，其余失败路径
// （远程 http 图断网/原图失效/混合内容拦截、dataURL 解码失败、parts 混合消息里的图）此前
// 同样渲染成无声空白气泡（iQOO12 Chrome 断网时联系人发表情空白实证）。error 后延时 1.5s
// 复核 naturalWidth 仍为 0 才把 img 换成占位——给池观察器改写 src（#186 竞态）和慢网加载
// 留窗口，不误伤正在加载或已被观察器救回的图；只替换 img 节点，不动引用块/情绪 chip。
function bindMediaFailPlaceholder(b) {
b.querySelectorAll('.msg-img').forEach(im => {
if (im.dataset.errBound) return;
im.dataset.errBound = '1';
im.addEventListener('error', () => {
setTimeout(() => {
if (!im.isConnected || !im.complete) return;
if (im.naturalWidth !== 0) return;
const s = im.getAttribute('src') || '';
const isTok = window.mochiMediaIsToken && window.mochiMediaIsToken(s);
if (isTok && window.mochiMediaExpand && window.mochiMediaExpand(s)) return; // 池有数据，观察器稍后会改写
const ph = document.createElement('span');
ph.style.cssText = 'opacity:.5;font-size:12px';
ph.textContent = isTok ? '（图片丢失：媒体数据缺失，可用数据备份重新导入恢复）' : '（表情/图片加载失败：网络不通或原图已失效）';
im.replaceWith(ph);
}, 1500);
});
// FIX 2026-09-06 #205 全透明空图检测：图片「加载成功但内容本身没有画面」（导入字卡包里的
// 全透明图/空白图——多设备共用同一批字卡库时会同时表现为空气泡，且不产生任何加载错误）
// 是加载失败之外最后一类真空白。load 后 24×24 采样 alpha，全 0 才判空（有字/有内容即放行，
// GIF 取当前帧；跨域图 canvas 污染 getImageData 会抛错，catch 放行不误伤）。
im.addEventListener('load', () => {
if (im.dataset.alphaChecked) return;
im.dataset.alphaChecked = '1';
if (!im.complete || !im.naturalWidth) return;
try {
const S = 24;
const c = document.createElement('canvas');
c.width = S; c.height = S;
const x = c.getContext('2d');
if (!x) return;
x.drawImage(im, 0, 0, S, S);
const d = x.getImageData(0, 0, S, S).data;
for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return; } // 有任一非透明像素=有画面
const ph = document.createElement('span');
ph.style.cssText = 'opacity:.5;font-size:12px';
ph.textContent = '（表情内容为空：这张字卡图本身没有画面，可长按撤回或到字卡库清理该分组）';
im.replaceWith(ph);
} catch (e) {}
});
});
}
function renderMsg(rec) {
const m = document.createElement('div');
if (!batchRendering) m.classList.add('msg-enter');
const __fit = rec.side !== 'out' && !!window.taFit;
const __taNm = chatPartnerName();
const __meNm = chatUserName();
// v3.26.x：拍一拍人称修复——taFit（称呼）期间把 {ta}/{me} 掩成控制符，先替换称呼再回填昵称，
// 昵称（含默认 TA、含「他」的名字）永不被称呼功能改写成 他/ta/她；字卡文案里的独立
// ta/TA/他（非占位符）仍按称呼替换（字卡库中性占位设计不变）
const T = (s) => {
let t = s;
if (__fit && typeof t === 'string') {
const hasPh = t.indexOf('{ta}') >= 0 || t.indexOf('{me}') >= 0;
if (hasPh) t = t.split('{ta}').join('\u0002').split('{me}').join('\u0003');
t = window.taFit(t);
if (hasPh) t = t.split('\u0002').join(__taNm).split('\u0003').join(__meNm);
return t;
}
if (typeof t === 'string' && t.indexOf('{ta}') >= 0) t = t.split('{ta}').join(__taNm);
if (typeof t === 'string' && t.indexOf('{me}') >= 0) t = t.split('{me}').join(__meNm);
return t;
};
if (rec.special === 'invite') {
m.className = 'msg-ask';
m.dataset.idx = msgs.length - 1;
const answered = rec.inviteStatus === 'answered';
m.innerHTML = '<div class="msg-ask-card' + (answered ? ' answered' : '') + '">' +
'<div class="msg-ask-q">' + T('邀请TA') + ' · ' + escTxt(rec.inviteContent || rec.text || '') + '</div>' +
(answered
? '<div class="msg-ask-a">✓ ' + escTxt(T(rec.inviteAnswer || 'TA 回应了你')) + '</div>'
: '<div class="msg-ask-tip">' + T('等待 TA 回应…') + '</div>') +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'ask') {
m.className = 'msg-ask';
m.dataset.idx = msgs.length - 1;
const answered = rec.askStatus === 'answered';
const askIsSingle = rec.askType === 'single';
m.innerHTML = '<div class="msg-ask-card' + (answered ? ' answered' : '') + '">' +
'<div class="msg-ask-q">' + T('问问TA') + ' · ' + escTxt(rec.askQuestion || '') + '</div>' +
(answered
? '<div class="msg-ask-a">✓ ' + T('TA：') + escTxt(T(rec.askAnswer || '回答了你')) + '</div>' + (rec.askReply ? '<div class="msg-choose-r">' + T('TA：') + escTxt(T(rec.askReply)) + '</div>' : '')
: '<div class="msg-ask-tip">' + (askIsSingle ? T('等待 TA 选择…') : T('等待 TA 回答…')) + '</div>') +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'call' || rec.special === 'call-reply' || rec.special === 'invite-reply') {
m.className = 'msg-center';
m.innerHTML = '<div class="msg-center-card">' + escTxt(T(rec.text)) + '</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'poke' || rec.special === 'ask-msg') {
m.className = 'msg-poke' + (rec.mailNotice ? ' mail-notice' : '');
// v3.30.x：拍一拍人称昵称制——不再走 T()（taFit 称呼替换），改用 pokePersonMap：
// {ta}/{me} 与字卡里写死的 TA/ta/他/她 一律按 我的昵称/联系人昵称 回填
m.innerHTML = '<span>' + pokeIconHtml(pokePersonMap(rec.text, __taNm, __meNm)) + '</span>' +
(rec.img ? '<img class="msg-poke-img" src="' + attrEsc(rec.img) + '" alt="新头像">' : '');
if (rec.mailNotice) {
m.addEventListener('click', () => { if (window.openMailPage) window.openMailPage(); });
}
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'rps') {
m.className = 'msg-rps';
const rpsIco = {
rock: '<svg viewBox="0 0 256 256"><path fill="currentColor" d="M200 80h-16V64a32 32 0 0 0-56-21.13a32 32 0 0 0-55.79 17.55A32 32 0 0 0 24 88v40a104 104 0 0 0 208 0v-16a32 32 0 0 0-32-32m-48-32a16 16 0 0 1 16 16v16h-32V64a16 16 0 0 1 16-16M88 64a16 16 0 0 1 32 0v40a16 16 0 0 1-32 0ZM40 88a16 16 0 0 1 32 0v16a16 16 0 0 1-32 0Zm176 40a88 88 0 0 1-175.92 3.75A31.93 31.93 0 0 0 80 125.13a31.93 31.93 0 0 0 44.58 3.35a32.2 32.2 0 0 0 11.8 11.44A47.88 47.88 0 0 0 120 176a8 8 0 0 0 16 0a32 32 0 0 1 32-32a8 8 0 0 0 0-16h-16a16 16 0 0 1-16-16V96h64a16 16 0 0 1 16 16Z"/></svg>',
scissors: '<svg viewBox="0 0 256 256"><path fill="currentColor" d="M212.24 30A28 28 0 0 0 161 36.77l-13 48.32l-12.95-48.32A28 28 0 1 0 81 51.26l9.38 35l-8.73-1.68a28 28 0 0 0-24.85 47.8a27.86 27.86 0 0 0-8.8 20.49V160a80 80 0 0 0 80 80h.61c43.78-.33 79.39-36.62 79.39-80.9v-3.34a55.88 55.88 0 0 0-11.77-34.27L215 51.26A27.8 27.8 0 0 0 212.24 30M97.61 38a12 12 0 0 1 22 2.9l14.77 55.15a28 28 0 0 0-14 4.77a2 2 0 0 0-.16-.26A27.65 27.65 0 0 0 108 90.35L96.42 47.12A11.94 11.94 0 0 1 97.61 38m-33.36 71.6a12 12 0 0 1 14.25-9.34l20.71 4a12 12 0 0 1 9.36 14.16a12 12 0 0 1-14.25 9.34l-20.75-4a12 12 0 0 1-9.32-14.15Zm0 40.72a12 12 0 0 1 14-9.37l10.11 2a12 12 0 0 1 9.36 14.15a12 12 0 0 1-14.2 9.35l-10-2a12 12 0 0 1-9.34-14.16ZM192 159.1c0 35.53-28.49 64.64-63.5 64.9a64.08 64.08 0 0 1-61.56-44.78a31 31 0 0 0 3.48.95l10 2a28.3 28.3 0 0 0 5.61.57a28 28 0 0 0 24.16-42.14c.79-.43 1.57-.89 2.32-1.4l.16.26a27.82 27.82 0 0 0 17.78 12l6.32 1.26a36 36 0 0 0 9.53 32.49A8 8 0 0 0 157.71 174a20 20 0 0 1-3.31-23.51a8 8 0 0 0-5.46-11.66l-15.34-3.07a12 12 0 0 1-9.35-14.15a12 12 0 0 1 14.18-9.35l21.41 4.28A40.1 40.1 0 0 1 192 155.76Zm7.59-112l-16.62 62a55.6 55.6 0 0 0-20-8.28l-2.5-.5l15.93-59.41a12 12 0 1 1 23.18 6.21Z"/></svg>',
paper: '<svg viewBox="0 0 256 256"><path fill="currentColor" d="M188 88a27.75 27.75 0 0 0-12 2.71V60a28 28 0 0 0-41.36-24.6A28 28 0 0 0 80 44v6.71A27.75 27.75 0 0 0 68 48a28 28 0 0 0-28 28v76a88 88 0 0 0 176 0v-36a28 28 0 0 0-28-28m12 64a72 72 0 0 1-144 0V76a12 12 0 0 1 24 0v44a8 8 0 0 0 16 0V44a12 12 0 0 1 24 0v68a8 8 0 0 0 16 0V60a12 12 0 0 1 24 0v68.67A48.08 48.08 0 0 0 120 176a8 8 0 0 0 16 0a32 32 0 0 1 32-32a8 8 0 0 0 8-8v-20a12 12 0 0 1 24 0Z"/></svg>'
};
const rpsName = { rock: '石头', scissors: '剪刀', paper: '布' };
const resTxt = rec.rpsResult > 0 ? '你赢了' : rec.rpsResult < 0 ? '你输了' : '平局';
m.innerHTML = '<div class="msg-rps-card">' +
'<div class="msg-rps-hands">' +
'<span class="msg-rps-hand"><span class="msg-rps-ico">' + (rpsIco[rec.rpsMine] || '') + '</span><span class="msg-rps-name">你 · ' + escTxt(rpsName[rec.rpsMine] || '') + '</span></span>' +
'<span class="msg-rps-vs">VS</span>' +
'<span class="msg-rps-hand"><span class="msg-rps-ico">' + (rpsIco[rec.rpsTa] || '') + '</span><span class="msg-rps-name">' + T('TA') + ' · ' + escTxt(rpsName[rec.rpsTa] || '') + '</span></span>' +
'</div>' +
'<div class="msg-rps-result">' + escTxt(resTxt) + '</div>' +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'pong') {
m.className = 'msg-pong';
m.innerHTML = '<div class="msg-pong-card">' +
'<div class="msg-pong-label">' + T('双人 Pong') + '</div>' +
'<div class="msg-pong-result">' + escTxt(T(rec.text || '')) + '</div>' +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'brick') {
m.className = 'msg-pong';
m.innerHTML = '<div class="msg-pong-card">' +
'<div class="msg-pong-label">🧱 ' + T('双人打砖块') + '</div>' +
'<div class="msg-pong-result">' + escTxt(T(rec.text || '')) + '</div>' +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
// v3.16.x：记忆翻牌结算卡片（memory-game.js endGame 调用 chatAddSystem special:'memory'）
if (rec.special === 'memory') {
m.className = 'msg-pong msg-memory';
m.innerHTML = '<div class="msg-pong-card">' +
'<div class="msg-pong-label">🧠 ' + T('记忆翻牌') + '</div>' +
'<div class="msg-pong-result">' + escTxt(T(rec.text || '')) + '</div>' +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'snake') {
m.className = 'msg-rps';
const snkResTxt = rec.snkResult === 'win' ? '你赢了' : rec.snkResult === 'lose' ? T('TA 赢了') : '平局';
const snkClr = rec.snkResult === 'win' ? '#34c759' : rec.snkResult === 'lose' ? '#ff6b6b' : '#888';
m.innerHTML = '<div class="msg-rps-card msg-snake-card">' +
'<div class="msg-snake-title">🐍 双人贪吃蛇</div>' +
'<div class="msg-snake-row"><span class="msg-snake-side">你</span><span>长度 ' + rec.snkPLen + '</span><span>食物 ' + rec.snkPFood + '</span><span>' + rec.snkPScore + '分</span></div>' +
'<div class="msg-snake-row"><span class="msg-snake-side">' + T('TA') + '</span><span>长度 ' + rec.snkOLen + '</span><span>食物 ' + rec.snkOFood + '</span><span>' + rec.snkOScore + '分</span></div>' +
'<div class="msg-rps-result" style="color:' + snkClr + '">存活 ' + rec.snkTime + 's · ' + escTxt(snkResTxt) + '</div>' +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'redpacket') {
m.className = 'msg-rp';
m.dataset.idx = msgs.length - 1;
const sideTxt = rec.side === 'out' ? '我' : chatPartnerName();
const cls = rpStatusCls(rec);
const rpIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9c3 2 6 3 9 3s6-1 9-3"/><circle cx="12" cy="9" r="1.4"/></svg>';
m.innerHTML = '<div class="msg-rp-card' + (cls ? ' ' + cls : '') + '">' +
'<div class="msg-rp-top"><span class="msg-rp-ico">' + rpIco + '</span><span class="msg-rp-label">红包 · 心意币</span></div>' +
'<div class="msg-rp-amt">¥' + escTxt(Number(rec.rpAmount || 0).toFixed(2)) + '</div>' +
'<div class="msg-rp-wish">' + escTxt(rec.rpWish || '心意') + '</div>' +
'<div class="msg-rp-foot">' +
'<span class="msg-rp-side">' + escTxt(sideTxt) + ' 发出</span>' +
'<span class="msg-rp-status">' + escTxt(rpStatusText(rec)) + '</span>' +
'</div>' +
favHeartHtml(rec) +
'</div>';
if (rec.rpCover) {
const cover = rpCoverGet(rec.side);
if (cover) {
const card = m.querySelector('.msg-rp-card');
if (card) {
card.classList.add('has-cover');
card.style.backgroundImage = 'url("' + cover + '")';
}
}
}
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
// v3.15.x：TA 向 Mochi 申请心意币的回执卡（金额与红包同款随机分布）
if (rec.special === 'askcoin') {
m.className = 'msg-poke';
m.innerHTML = '<span>🪙 ' + escTxt(chatPartnerName()) + ' 向 Mochi 申请了心意币 ¥' + (Number(rec.askFen || 0) / 100).toFixed(2) + '</span>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'flower') {
m.className = 'msg-flower';
m.dataset.idx = msgs.length - 1;
const sideTxt = rec.side === 'out' ? '我' : chatPartnerName();
m.innerHTML = '<div class="msg-flower-card">' +
'<div class="msg-flower-bar"></div>' +
'<div class="msg-flower-emoji">' + escTxt(rec.flEmoji || '\uD83C\uDF37') + '</div>' +
'<div class="msg-flower-name">' + escTxt(rec.flName || '\u82B1') + '</div>' +
'<div class="msg-flower-divider"><span></span>\u2739<span></span></div>' +
'<div class="msg-flower-wish">\u201C' + escTxt(rec.flWish || '\u9001\u7ED9\u4F60~') + '\u201D</div>' +
'<div class="msg-flower-foot"><span>' + escTxt(sideTxt) + ' \u9001\u51FA</span></div>' +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'gift') {
m.className = 'msg-gift';
m.dataset.idx = msgs.length - 1;
const sideTxt = rec.side === 'out' ? '我 送出' : (chatPartnerName() + ' 送来');
const gc = ((window.GIFT_CAT_COLOR || {})[rec.giftCat]) || '#f2f2f5';
m.innerHTML = '<div class="msg-gift-card">' +
'<div class="msg-gift-emoji" style="background:' + escTxt(gc) + '">' + (rec.giftImg ? '<img class="msg-gift-img" src="' + escTxt(rec.giftImg) + '" alt="">' : escTxt(rec.giftEmoji || '\uD83C\uDF81')) + '</div>' +
'<div class="msg-gift-name">' + escTxt(rec.giftName || '礼物') + '</div>' +
'<div class="msg-gift-divider"></div>' +
'<div class="msg-gift-wish">\u201C' + escTxt(rec.giftWish || '心意') + '\u201D</div>' +
'<div class="msg-gift-foot"><span class="mg-side">' + escTxt(sideTxt) + '</span>' +
'<span class="msg-gift-price">\u00A5' + escTxt(Number(rec.giftPrice || 0).toFixed(2)) + '</span></div>' +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'dish') {
m.className = 'msg-gift msg-dish';
m.dataset.idx = msgs.length - 1;
const sideTxt = rec.side === 'out' ? '我 烹饪送出' : (chatPartnerName() + ' 烹饪送来');
const stars = rec.dishQuality === 'perfect' ? '★★★' : rec.dishQuality === 'good' ? '★★' : '★';
m.innerHTML = '<div class="msg-gift-card msg-dish-card">' +
'<div class="msg-gift-emoji" style="background:#fff3e0">' + escTxt(rec.dishEmoji || '\uD83C\uDF7D\uFE0F') + '</div>' +
'<div class="msg-gift-name">' + escTxt(rec.dishName || '菜肴') + ' <span class="dish-stars">' + stars + '</span></div>' +
'<div class="msg-gift-divider"></div>' +
'<div class="msg-gift-wish">\u201C' + escTxt(rec.dishWish || '尝尝手艺') + '\u201D</div>' +
'<div class="msg-gift-foot"><span class="mg-side">' + escTxt(sideTxt) + '</span>' +
'<span class="msg-gift-price">\u00A5' + escTxt(Number(rec.dishPrice || 0).toFixed(2)) + '</span></div>' +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'ask-choose') {

m.className = 'msg-ask';
m.dataset.idx = msgs.length - 1;
const answered = rec.choiceStatus === 'answered';
m.innerHTML = '<div class="msg-choose-card' + (answered ? ' answered' : '') + '">' +
'<div class="msg-ask-q">' + escTxt(rec.choiceQuestion || '') + '</div>' +
(answered
? '<div class="msg-ask-a">✓ 你选择了：' + escTxt(rec.choiceAnswer) + '</div><div class="msg-choose-r">' + T('TA：') + escTxt(T(rec.choiceReply)) + '</div>'
: '<div class="msg-ask-tip">点击选择你的答案</div>') +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'ask-curious') {
m.className = 'msg-ask';
m.dataset.idx = msgs.length - 1;
const answered = rec.curiousStatus === 'answered';
m.innerHTML = '<div class="msg-choose-card' + (answered ? ' answered' : '') + '">' +
'<div class="msg-ask-q">' + escTxt(rec.curiousQuestion || '') + '</div>' +
(answered
? '<div class="msg-ask-a">✓ 你：' + escTxt(rec.curiousAnswer) + '</div><div class="msg-choose-r">' + T('TA：') + escTxt(T(rec.curiousReply)) + '</div>'
: '<div class="msg-ask-tip">' + T('点击回答 TA 的好奇') + '</div>') +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'ask-roast') {
m.className = 'msg-ask';
m.dataset.idx = msgs.length - 1;
const answered = rec.roastStatus === 'answered';
m.innerHTML = '<div class="msg-choose-card' + (answered ? ' answered' : '') + '">' +
'<div class="msg-ask-q">' + escTxt(rec.roastText || '') + '</div>' +
(answered
? '<div class="msg-ask-a">✓ 你：' + escTxt(rec.roastAnswer) + '</div><div class="msg-choose-r">' + T('TA：') + escTxt(T(rec.roastReply)) + '</div>'
: '<div class="msg-ask-tip">' + T('点击回 TA 一句') + '</div>') +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'ask-card') {
m.className = 'msg-ask';
m.dataset.idx = msgs.length - 1;
const answered = rec.askStatus === 'answered';
const isSingle = rec.askType === 'single' || (rec.type === 'single' && Array.isArray(rec.options) && rec.options.length);
m.innerHTML = '<div class="msg-ask-card' + (answered ? ' answered' : '') + '">' +
'<div class="msg-ask-q">' + escTxt(rec.askQuestion || rec.text) + '</div>' +
(answered
? '<div class="msg-ask-a">✓ 已回答：' + escTxt(rec.askAnswer) + '</div>' + (rec.askReply ? '<div class="msg-choose-r">' + T('TA：') + escTxt(T(rec.askReply)) + '</div>' : '')
: '<div class="msg-ask-tip">' + (isSingle ? '点击选择你的答案' : T('点击回答 TA 的提问')) + '</div>') +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
m.className = 'msg ' + (rec.side === 'out' ? 'msg-out' : 'msg-in');
const timeHtml = rec.ts ? '<span class="msg-time">' + fmtTime(rec.ts) + '</span>' : '';
const side = '<div class="msg-side"><div class="msg-av"></div>' + timeHtml + '</div>';
m.innerHTML = rec.side === 'out'
? '<div class="msg-bubble"></div>' + side
: side + '<div class="msg-bubble"></div>';
const av = m.querySelector('.msg-av');
const b = m.querySelector('.msg-bubble');
if (rec.special === 'read') {
b.innerHTML = '<span style="opacity:.5;font-size:12px">已读不回</span>';
} else if (rec.retracted) {
// v3.16.x：撤回分支必须先于 sticker/image/voice/parts 类型分支——
// 否则表情包/图片/语音被撤回后任何全量重渲染（renderWindow/loadMsgs/切会话）
// 都会命中类型分支，把原内容（表情包 img 等）重新渲染出来，撤回形同失效
b.dataset.orig = rec.orig || rec.text;
b.innerHTML = '<span style="opacity:.6;font-size:12px;cursor:pointer">' + (rec.side === 'out' ? '我' : '对方') + '撤回了一条消息</span>';
bindToggle(b, rec.side);
} else if (rec.type === 'sticker' || rec.type === 'image') {
b.style.padding = '6px';
b.style.background = '';
b.style.border = '';
b.style.boxShadow = '';
b.innerHTML = (rec.quote ? quoteHtml(rec.quote, rec.qside) : '') + (rec.type === 'image'
? '<img class="msg-img msg-img-big" src="' + attrEsc(rec.text) + '" alt="图片" loading="lazy" decoding="async">'
: '<img class="msg-img msg-img-sm" src="' + attrEsc(rec.text) + '" alt="表情" loading="lazy" decoding="async">');
if (rec.type === 'image') {
b.querySelector('.msg-img-big').addEventListener('click', (e) => {
e.stopPropagation();
if (window.viewChatImage) window.viewChatImage(rec.text);
});
}
// FIX 2026-09-06 #186→#202 媒体加载失败占位统一走 bindMediaFailPlaceholder：
// 令牌缺失（池数据被误删/备份未带池键）、远程图断网/失效/混合内容拦截、dataURL 解码失败
// 都不再是无声空白气泡；竞态防线（#186 E3 实证 404 抢跑观察器改写）由 1.5s 延时复核承担
bindMediaFailPlaceholder(b);
} else if (rec.type === 'voice') {
b.style.padding = '8px 10px';
b.style.background = '';
b.style.border = '';
b.style.boxShadow = '';
fillVoiceBubble(b, rec.text, rec.quote ? quoteHtml(rec.quote, rec.qside) : '');
} else if (rec.parts && rec.parts.length) {
const imgs = rec.parts.filter(p => p.k === 'img').map(p => p);
const textPart = rec.parts.filter(p => p.k === 'text').map(p => p.v).join(' ');
let inner = '';
if (imgs.length) {
inner += '<div class="msg-parts-imgs' + (imgs.length > 1 ? ' multi' : '') + '">' +
imgs.map(p => {
const isSticker = p.sub === 'sticker';
return '<img class="msg-img' + (isSticker ? ' msg-img-sm' : ' msg-img-big') + '" src="' + attrEsc(p.v) + '" alt="' + (isSticker ? '表情' : '图片') + '" loading="lazy" decoding="async">';
}).join('') + '</div>';
}
if (textPart && textPart.trim()) {
inner += '<span style="opacity:.85;word-break:break-word">' + escTxtBr(T(textPart)) + '</span>';
}
b.innerHTML = rec.quote
? quoteHtml(rec.quote, rec.qside) + inner
: inner;
// FIX 2026-09-05 #185 空白兜底：parts 只有空白文本且无图时 inner 为空串，渲染成空气泡
if (!inner) b.innerHTML = '<span style="opacity:.5;font-size:12px">（空白消息）</span>';
b.querySelectorAll('.msg-img-big').forEach(img => {
img.addEventListener('click', (e) => {
e.stopPropagation();
if (window.viewChatImage) window.viewChatImage(img.src);
});
});
bindMediaFailPlaceholder(b); // FIX 2026-09-06 #202 parts 混合消息里的图同样挂失败占位
} else if (rec.retractedSegs && rec.retractedSegs.length) {
const segs = splitCardSegs(rec.text);
const rcs = rec.retractedSegs || [];
let segHtml = '';
for (let i = 0; i < segs.length; i++) {
if (!rcs.some(r => r.idx === i)) {
if (segHtml) segHtml += ' ';
segHtml += escTxtBr(T(segs[i]));
}
}
let sub = '';
rcs.forEach(r => { sub += '<div style="padding:2px 0">（已撤回）' + escTxt(r.text || '') + '</div>'; });
b.innerHTML = (rec.quote ? quoteHtml(rec.quote, rec.qside) : '') +
'<span style="opacity:.85;word-break:break-word">' + (segHtml || '…') + '</span>' +
'<div style="margin-top:6px;text-align:left">' +
'<span class="msg-poke-seg" data-rc="1">' + (rec.side === 'out' ? '我' : '对方') + '撤回了 ' + rcs.length + ' 条字卡 ▾</span>' +
'<div class="msg-poke-seg-detail" style="display:none">' + sub + '</div>' +
'</div>';
const tip = b.querySelector('.msg-poke-seg');
if (tip) {
tip.addEventListener('click', (e) => {
e.stopPropagation();
const d = tip.nextElementSibling;
if (d) d.style.display = d.style.display === 'block' ? 'none' : 'block';
});
}
} else {
// FIX 2026-09-05 #185 渲染端空白兜底：历史数据里已存在的空文本消息（无类型/无 special）
// 旧逻辑渲染成空壳气泡；改为显示占位，已存空白记录的设备更新后也能看出消息非空壳丢失
const __rawText = typeof rec.text === 'string' ? rec.text : '';
const __blankMsg = !__rawText.trim();
const __bodyHtml = __blankMsg
? '<span style="opacity:.5;font-size:12px">（空白消息）</span>'
: '<span style="opacity:.85">' + escTxtBr(T(__rawText)) + '</span>';
b.innerHTML = rec.quote
? quoteHtml(rec.quote, rec.qside) + __bodyHtml
: __bodyHtml;
}
if (rec.mood && rec.mood.length && !rec.retracted) {
const mm = document.createElement('div');
mm.className = 'msg-moods';
const recalled = [];
rec.mood.forEach((md, mi) => {
if (rec.retractedMood && rec.retractedMood.indexOf(mi) >= 0) { recalled.push(md); return; }
      const mt = escTxt(T(md.tag)), ml = escTxt(T(md.label));
      // v3.16.x：来源标签 chip（opts.tag 生成）的 label 恒等于气泡正文，不再重复渲染右侧文案，
      // 否则「字卡一行 + 标签行同文」内容重复（摸鱼抓包等）；真实情绪字卡 label≠正文不受影响
      const dupBody = md.label != null && String(md.label) !== '' && String(md.label) === String(rec.text == null ? '' : rec.text);
      if (md.tag === '交流意图') {
        mm.innerHTML += '<div class="msg-mood msg-intent"><span class="msg-mood-tag">' + mt + '</span>' + (dupBody ? '' : '<span>' + ml + '</span>') + '</div>';
      } else {
        mm.innerHTML += '<div class="msg-mood"><span class="msg-mood-tag">' + mt + '</span>' + (dupBody ? '' : '<span>' + ml + '</span>') + '</div>';
      }
});
if (recalled.length) {
mm.innerHTML += '<div style="margin-top:2px">' +
'<span class="msg-poke-seg" data-rcm="1">' + (rec.side === 'out' ? '我' : '对方') + '撤回了 ' + recalled.length + ' 条情绪字卡 ▾</span>' +
'<div class="msg-poke-seg-detail" style="display:none">' +
recalled.map(md => '<div style="padding:2px 0">（已撤回）' + escTxt(md.tag || '') + '：' + escTxt(md.label || '') + '</div>').join('') +
'</div></div>';
}
if (mm.children.length) b.appendChild(mm);
const rctip = mm.querySelector('.msg-poke-seg[data-rcm]');
if (rctip) {
rctip.addEventListener('click', (e) => {
e.stopPropagation();
const d = rctip.nextElementSibling;
if (d) d.style.display = d.style.display === 'block' ? 'none' : 'block';
});
}
}
fillAvatar(av, rec.side === 'out' ? 'cs-avatar-user' : 'cs-avatar-partner');
if (rec.side === 'in') {
av.style.cursor = 'pointer';
av.title = T('对 TA 拍一拍');
av.addEventListener('click', (e) => {
e.stopPropagation();
openPokeCard();
});
}
if (rec.side === 'in' && rec.initiative && !rec.retracted) {
try {
const c = cfg();
if (cfgn(c, 'as-badge', 1) === 1 && !b.querySelector('.msg-hi-heart')) {
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('class', 'msg-hi-heart');
svg.setAttribute('viewBox', '0 0 24 24');
svg.setAttribute('fill', 'currentColor');
svg.setAttribute('aria-hidden', 'true');
const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
path.setAttribute('d', 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');
svg.appendChild(path);
b.insertBefore(svg, b.firstChild);
}
} catch (e) {}
}
if (rec.side === 'in' || rec.side === 'out') m.dataset.idx = msgs.length - 1;
try {
const ts = rec.ts || Date.now();
m.querySelectorAll('img').forEach(img => {
if (img.complete) return;
img.addEventListener('load', () => {
if (Date.now() - ts < 6000 && chatVisible()) maybeScrollChatBottom(rec.side);
});
});
} catch (e) {}
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
function performPoke() {
let action = '';
const dcfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
const useChat = window.defaultCardUse ? window.defaultCardUse('chat') : true;
const touchOn = window.defaultCardCat ? window.defaultCardCat('touch') : true;
if (dcfg.enabled && useChat && touchOn && dcfg.probs && (dcfg.probs.touch || 0) > 0) {
const d = (window.getDefaultCards && window.getDefaultCards()) || null;
if (d && d.type === 'poke') action = d.text;
}
if (!action) {
const cards = pokeAllCards();
action = cards.length ? pick(cards) : '拍了拍你';
}
// v3.26.x：TA 主动拍一拍同样存 {ta}/{me} 占位符（与 sendPoke 一致），昵称渲染期回填、不受称呼改写
let text;
if (action.indexOf('你') >= 0) {
if (action.charAt(0) === '你' || action.charAt(0) === '我') {
text = '{ta} ' + action.slice(1).replace(/你(?![们])/g, '{me}');
} else {
text = '{ta} ' + action.replace(/你(?![们])/g, '{me}');
}
} else if (action.charAt(0) === '我') {
text = '{ta} ' + action.slice(1);
} else {
text = '{ta} ' + action;
}
addIn(text, { special: 'poke' });
}
function chatUnread() { try { return parseInt(store.get('chat-unread'), 10) || 0; } catch (e) { return 0; } }
function incChatUnread() {
try { store.set('chat-unread', String(chatUnread() + 1)); } catch (e) {}
updateChatBadge();
}
function clearChatUnread() {
try { store.set('chat-unread', '0'); } catch (e) {}
updateChatBadge();
}
function updateChatBadge() {
const n = chatUnread();
if (window.setDeskBadge) { window.setDeskBadge('chat', n); return; }
const badge = document.getElementById('chat-badge');
if (!badge) return;
badge.hidden = n === 0;
badge.textContent = n > 99 ? '99+' : String(n);
}
window.clearChatHistory = function () {
msgs = [];
pendingLocal = null;
sessionChangedIdx.clear();
chatDbReady = true;
renderStart = 0; // v3.6.x：分页窗口起点复位（消息已清空）
cancelPersist();
// v3.26.x #90：用户主动清空＝合法归零，账本必须同步（否则缩水守卫会一直拒绝后续保存）
try { chatLedger[window.activePrefix()] = 0; } catch (e) {}
try { store.remove('chat-msgs'); } catch (e) {}
try { store.remove('chat-meta'); } catch (e) {}
chatTailClear(); // #180：清空记录＝日志一并清（否则刷新后已清内容回放复活）
if (body) body.innerHTML = '';
clearChatUnread();
};
window.chatExportMsgs = function () {
if (window.chatFlushSave) window.chatFlushSave();
return (msgs || []).slice();
};
window.chatImportMsgs = function (arr) {
if (!Array.isArray(arr)) return false;
msgs = arr.filter(m => m && typeof m === 'object');
pendingLocal = null;
sessionChangedIdx.clear();
chatDbReady = true;
renderStart = 0;
cancelPersist();
chatTailClear(); // #180：整包导入替换＝旧日志作废
try { if (window.idbSet) persistMsgsToIdb(window.activePrefix() + ':chat-msgs', msgs); } catch (e) {}
writeLsSnapshot(msgs, undefined, true);
// v3.26.x #90：主动整包替换＝合法，账本直接对齐新条数（旧的高账本不得继续拦后续保存）
try { chatLedgerSave(window.activePrefix(), msgs.length, msgsBytes(msgs)); } catch (e) {}
if (body) body.innerHTML = '';
clearChatUnread();
if (chatVisible() && msgs.length) {
renderWindow(false, true);
scrollChatBottom();
}
return true;
};
const deskMsgEl = document.getElementById('desk-msg');
const deskMsgAv = document.getElementById('desk-msg-av');
const deskMsgName = document.getElementById('desk-msg-name');
const deskMsgText = document.getElementById('desk-msg-text');
let deskMsgTimer = null;
let deskMsgAction = null; // v3.5.107：横幅点击回调（聊天进聊天页 / 信箱进信箱 / 朋友圈进朋友圈）
let deskMsgCloseAnimTimer = null; // v3.5.136：关闭滑出动画定时器（防止与新横幅竞态）
let deskMsgRevertTimer = null;    // v3.5.136：回弹动画定时器
function deskMsgEnabled() {
const v = store.get('desk-msg-en');
return v === null || v === undefined || v === '' ? true : v === '1';
}
function showDeskPopup(opts) {
opts = opts || {};
let t = String(opts.text || '');
const phOf = function () {
if (opts.type === 'voice') return '[语音]';
if (opts.imgSub === 'sticker' || opts.type === 'sticker') return '[表情包]';
return '[图片]';
};
if (!t && opts.img) t = phOf();
if (!t) return;
if (t.indexOf('data:') === 0) t = phOf();
else if (t.indexOf('data:') > 0) t = t.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]');
else if (t.indexOf('|||') >= 0) t = t.split('|||')[0].replace(/\.[^.]+$/, '').trim() || '[语音]';
else if (t.indexOf('<svg') >= 0) t = t.replace(/<[^>]*>/g, '').trim();
else if (t.length > 40) t = t.slice(0, 40) + '…';
let notifyT = t;
if (opts.img && notifyT.indexOf('[图片]') < 0 && notifyT.indexOf('[表情包]') < 0 && notifyT.indexOf('[语音]') < 0 && notifyT.indexOf('[附件]') < 0) {
notifyT = notifyT + ' ' + phOf();
}
const isHidden = opts.isHidden === true;
if (isHidden) {
if (window.bgNotifyCheck) {
window.bgNotifyCheck(notifyT, Date.now(), { name: opts.name, img: opts.img, av: opts.av, avFixed: opts.avFixed === true });
}
return;
}
if (!deskMsgEl || !deskMsgEnabled()) return;
if (deskMsgText) deskMsgText.textContent = notifyT;
if (deskMsgName) deskMsgName.textContent = opts.name || chatPartnerName();
if (deskMsgAv) {
if (opts.av && typeof opts.av === 'string' && opts.av.indexOf('data:') === 0) {
const img = document.createElement('img');
img.src = opts.av;
img.alt = '';
deskMsgAv.innerHTML = '';
deskMsgAv.appendChild(img);
} else {
fillAvatar(deskMsgAv, 'cs-avatar-partner'); 
}
}
deskMsgAction = (typeof opts.onClick === 'function') ? opts.onClick : null;
if (deskMsgCloseAnimTimer) { clearTimeout(deskMsgCloseAnimTimer); deskMsgCloseAnimTimer = null; }
if (deskMsgRevertTimer) { clearTimeout(deskMsgRevertTimer); deskMsgRevertTimer = null; }
deskMsgEl.style.transition = '';
deskMsgEl.style.transform = '';
deskMsgEl.style.opacity = '';
deskMsgEl.hidden = false;
clearTimeout(deskMsgTimer);
deskMsgTimer = setTimeout(() => { if (deskMsgEl) deskMsgEl.hidden = true; }, 6000);
}
function extractDeskMsg(rec) {
let text = rec.text || '';
// v3.26.x：拍一拍/系统消息存 {ta}/{me} 占位符，桌面弹窗预览需回填昵称
// （renderMsg 走 T() 替换，此处同义；不走 taFit 称呼改写，避免昵称被改成 他/她）
// v3.30.x：拍一拍人称昵称制——poke/ask-msg 整体走 pokePersonMap（{ta}/{me} 与字卡写死的
// TA/ta/他/她 一律按昵称回填，与聊天内渲染一致；须在回填前整体替换，防昵称含 TA/他/她 被二次改写）
if ((rec.special === 'poke' || rec.special === 'ask-msg') && typeof text === 'string') {
text = pokePersonMap(text, chatPartnerName(), chatUserName());
} else {
if (typeof text === 'string' && text.indexOf('{ta}') >= 0) text = text.split('{ta}').join(chatPartnerName());
if (typeof text === 'string' && text.indexOf('{me}') >= 0) text = text.split('{me}').join(chatUserName());
}
let img = rec.img || '';
let imgSub = '';
if (rec.parts && rec.parts.length) {
const ims = rec.parts.filter(p => p.k === 'img');
if (ims.length) {
img = ims[0].v || '';
imgSub = ims[0].sub || '';
}
const tp = rec.parts.filter(p => p.k === 'text').map(p => p.v).join(' ');
if (tp) text = tp;
} else if (text.indexOf('data:image/') === 0 ||
((rec.type === 'sticker' || rec.type === 'image') && /^https?:\/\//i.test(text))) {
img = text;
text = '';
imgSub = rec.type === 'sticker' ? 'sticker' : (rec.type === 'image' ? 'image' : '');
}
if (rec.type === 'voice') {
const vname = String(text || '').split('|||')[0] || '';
text = vname.replace(/\.[^.]+$/, '').trim() || '语音消息';
}
return { text: text, img: img, imgSub: imgSub };
}
function showDeskMsg(rec) {
const info = extractDeskMsg(rec);
const name = chatPartnerName();
const isHidden = document.visibilityState === 'hidden';
if (isHidden) {
showDeskPopup({ name: name, text: info.text, type: rec.type, img: info.img, imgSub: info.imgSub, isHidden: true });
return;
}
if (chatVisible()) return;
showDeskPopup({ name: name, text: info.text, type: rec.type, img: info.img, imgSub: info.imgSub, onClick: () => { if (!chatVisible()) enterChat(); }, isHidden: false });
}
function hideDeskMsg() {
clearTimeout(deskMsgTimer);
if (deskMsgCloseAnimTimer) { clearTimeout(deskMsgCloseAnimTimer); deskMsgCloseAnimTimer = null; }
if (deskMsgRevertTimer) { clearTimeout(deskMsgRevertTimer); deskMsgRevertTimer = null; }
deskMsgAction = null;
if (deskMsgEl) {
deskMsgEl.style.transition = '';
deskMsgEl.style.transform = '';
deskMsgEl.style.opacity = '';
deskMsgEl.hidden = true;
}
}
window.showDeskPopup = showDeskPopup;
window.hideDeskMsg = hideDeskMsg;
if (deskMsgEl) deskMsgEl.addEventListener('click', () => {
if (deskMsgSuppressClick) { deskMsgSuppressClick = false; return; }
const action = deskMsgAction;
hideDeskMsg();
if (action) action();
else if (!chatVisible()) enterChat();
});
let deskMsgSuppressClick = false;
let deskMsgSuppressTimer = null;
let dDrag = null;
function deskMsgDragStart(cx, cy) {
if (!deskMsgEl || deskMsgEl.hidden) return;
dDrag = { x: cx, y: cy, moved: false, speed: 0, lastX: cx, lastT: Date.now() };
deskMsgEl.style.transition = 'none'; // 拖拽过程中不带动画，实时跟手
}
function deskMsgDragMove(cx, cy) {
if (!dDrag) return false;
if (!deskMsgEl || deskMsgEl.hidden) { dDrag = null; return false; }
const dx = cx - dDrag.x;
const dy = cy - dDrag.y;
const now = Date.now();
if (now - dDrag.lastT >= 60) {
dDrag.speed = (cx - dDrag.lastX) / (now - dDrag.lastT);
dDrag.lastX = cx;
dDrag.lastT = now;
}
if (Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy) * 1.2) {
deskMsgEl.style.transform = 'translateX(' + dx + 'px) scale(' + Math.max(0.92, 1 - Math.abs(dx) / 500) + ')';
deskMsgEl.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / 140));
dDrag.moved = true;
return true; // 调用方据此 preventDefault，阻止浏览器手势接管
}
return false;
}
function deskMsgDragEnd(cx) {
if (!dDrag) return;
const dx = cx - dDrag.x;
const wasMoved = dDrag.moved;
const speed = dDrag.speed || 0;
dDrag = null;
if (!wasMoved || !deskMsgEl) return;
deskMsgSuppressClick = true;
clearTimeout(deskMsgSuppressTimer);
deskMsgSuppressTimer = setTimeout(() => { deskMsgSuppressClick = false; }, 350);
const shouldClose = Math.abs(dx) > 30 || Math.abs(speed) > 0.6;
if (shouldClose) {
deskMsgSuppressClick = false;
clearTimeout(deskMsgSuppressTimer);
deskMsgEl.style.transition = 'transform .18s ease, opacity .18s ease';
deskMsgEl.style.transform = 'translateX(' + (dx >= 0 ? 160 : -160) + 'px)';
deskMsgEl.style.opacity = '0';
deskMsgCloseAnimTimer = setTimeout(hideDeskMsg, 180);
} else {
deskMsgEl.style.transition = 'transform .25s cubic-bezier(.25,.8,.35,1), opacity .25s ease';
deskMsgEl.style.transform = '';
deskMsgEl.style.opacity = '';
deskMsgRevertTimer = setTimeout(() => { if (deskMsgEl) deskMsgEl.style.transition = ''; }, 260);
}
}
if (deskMsgEl) {
deskMsgEl.addEventListener('touchstart', (e) => {
const t = e.touches && e.touches[0];
if (t) deskMsgDragStart(t.clientX, t.clientY);
}, { passive: true });
window.addEventListener('touchmove', (e) => {
if (!dDrag) return;
const t = e.touches && e.touches[0];
if (t && deskMsgDragMove(t.clientX, t.clientY)) {
try { e.preventDefault(); } catch (err) {}
}
}, { passive: false });
const endTouch = (e) => {
const c = e.changedTouches && e.changedTouches[0];
deskMsgDragEnd(c ? c.clientX : (dDrag ? dDrag.x : 0));
};
window.addEventListener('touchend', endTouch);
window.addEventListener('touchcancel', endTouch);
deskMsgEl.addEventListener('mousedown', (e) => deskMsgDragStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => { if (dDrag) deskMsgDragMove(e.clientX, e.clientY); });
window.addEventListener('mouseup', (e) => deskMsgDragEnd(e.clientX));
}
const deskMsgToggle = document.getElementById('desk-msg-en');
if (deskMsgToggle) {
deskMsgToggle.checked = deskMsgEnabled();
deskMsgToggle.addEventListener('change', () => {
try { store.set('desk-msg-en', deskMsgToggle.checked ? '1' : '0'); } catch (e) {}
});
}
function addRec(rec) {
if (!rec.ts) rec.ts = Date.now();
const len = msgs.length;
for (let i = len - 1; i >= Math.max(0, len - 5); i--) {
const p = msgs[i];
if (!p || p.special || rec.special) continue;
if ((p.side || '') !== (rec.side || '')) continue;
if ((p.text || '') !== (rec.text || '')) continue;
if (!!p.img !== !!rec.img) continue;
const dts = (rec.ts || 0) - (p.ts || 0);
if (dts >= 0 && dts <= 1200) { saveMsgs(); return null; }
}
msgs.push(rec);
chatTailAppend(rec); // #180：同步尾巴日志先落 LS，再交低频整包落盘
saveMsgs();
	const notable = rec.side === 'in' && (!rec.special || rec.special === 'poke' || rec.special === 'gift');
	// v3.19.x：rec.silent（psync 跨桌面补投递）——消息进聊天+未读角标，但不触发
	// 桌面横幅/系统通知：补投递的是同步队列里其他时刻/其他桌面的旧内容，弹通知
	// 会形成"一堆看过的消息重叠弹窗 + 错误联系人名"
	if (notable && !rec.silent && (!chatVisible() || document.visibilityState === 'hidden')) {
	if (!chatVisible()) incChatUnread();
	showDeskMsg(rec);
	} else if (notable && rec.silent && !chatVisible()) {
	incChatUnread();
	}
// v3.26.x #211 聊天闪动修复：窗口超限判定从 RENDER_MAX 收紧到 WINDOW_MAX 硬上限
//（与 loadOlderIncremental→pruneWindowBottom 同一口径）。旧条件在每次钳位渲染后
//（renderStart=len−RENDER_MAX）只要再来一条消息就恒为真——历史超过 200 条的桌面
// 每收发一条消息都整窗重建 200 个气泡（img 节点全部重建重新解码＝肉眼可见闪一下，
// iQOO12 等多机型报障「打开聊天偶尔闪动+对方回复消息闪一下」；历史 ≤200 条的桌面
// renderStart=0 从不命中＝同版本却不闪，假象为机型相关）。收紧后常规收发全部走
// renderMsg 增量追加，仅当用户上翻加载旧消息使窗口真正越过 WINDOW_MAX(400) 时
// 才重钳位到最新 RENDER_MAX——与滚动加载侧的裁剪语义一致，DOM 上限不变。
if (renderStart > 0 && msgs.length - renderStart > WINDOW_MAX &&
(rec.side === 'out' || chatNearBottom())) {
renderWindow(false, true);
scrollChatBottom();
return body.lastElementChild;
}
maybeInsertDivider(msgs.length - 1);
const el = renderMsg(rec);
if (renderEnd >= msgs.length - 1) renderEnd = msgs.length;
return el;
}
function addIn(text, opts) {
opts = opts || {};
  // v3.26.x：联系人发消息音效——TA 主动消息/系统通知统一在 addIn 触发「联系人发送和回复消息」音效
  // （sfx-in）。此前只有群聊播 in 音效、单聊从未触发，所有手机单聊收 TA 消息都静音（红米 Turbo4Pro
  // + Via 反馈）。silent（小游戏互动/后台批量/静默通知）与已读回执（special:'read'）不打扰，不播放。
  if (window.playSfx && !opts.silent && opts.special !== 'read') {
    try { window.playSfx('in'); } catch (e) {}
  }
  // v3.14.x：opts.tag = 来源标注（如「经期关心/喝水提醒/吃饭提醒」）——系统功能直接发进
  // 聊天的字卡带一枚标签 chip（复用 rec.mood 渲染与持久化链路，重进聊天仍在），
  // 用户能看出这条消息是哪个功能触发的，不再是无来由的普通气泡
  // v3.15.x：opts.tagNoDup = 只留来源 chip，不把正文重复写进 mood label（摸鱼抓包回应用：
  // 正文本身就是一张完整字卡，label 再渲染一遍会上下两行内容重复）
  const _tagMood = opts.tag ? [{ tag: String(opts.tag), label: opts.tagNoDup ? '' : String(text) }] : null;
  // v3.16.x：gInv = 联系人主动邀请的游戏类型（pong/snake/rps），随消息持久化供小游戏记录识别
	return addRec({ side: 'in', text: text, initiative: opts.initiative, special: opts.special, quote: opts.quote, qidx: opts.qidx, type: opts.type, img: opts.img, parts: opts.parts, mailNotice: opts.mailNotice, gInv: opts.gInv, silent: opts.silent, askQuestion: opts.askQuestion, askStatus: opts.askStatus, askOptions: opts.askOptions, askType: opts.askType, choiceQuestion: opts.choiceQuestion, choiceOptions: opts.choiceOptions, choicePref: opts.choicePref, choiceCat: opts.choiceCat, choiceStatus: opts.choiceStatus, choiceAnswer: opts.choiceAnswer, choiceReply: opts.choiceReply, choiceMatch: opts.choiceMatch, curiousQuestion: opts.curiousQuestion, curiousQuick: opts.curiousQuick, curiousReplies: opts.curiousReplies, curiousFollowup: opts.curiousFollowup, curiousQid: opts.curiousQid, curiousCat: opts.curiousCat, curiousStatus: opts.curiousStatus, curiousAnswer: opts.curiousAnswer, curiousReply: opts.curiousReply, roastText: opts.roastText, roastCat: opts.roastCat, roastStatus: opts.roastStatus, roastAnswer: opts.roastAnswer, roastReply: opts.roastReply, rpAmount: opts.rpAmount, rpWish: opts.rpWish, rpStatus: opts.rpStatus, rpTs: opts.rpTs, rpCover: opts.rpCover, askFen: opts.askFen, askTs: opts.askTs, deskCk: opts.deskCk, deskCkDir: opts.deskCkDir, mood: opts.mood || _tagMood || undefined });
}
function addOut(text) {
return addRec({ side: 'out', text: text });
}
// v3.25.x：改名钩子（chat-settings 联系人昵称 / contacts 联系人改名同步 lbl-partner）。
// 记录 hist 并立即清扫当前桌面内存 msgs + 重渲染聊天窗；非当前桌面由 contacts 只记
// hist（chatSysNickChanged 不感知），等该桌面下次 loadMsgs 惰性补扫。
window.chatSysNickChanged = function (oldName) {
try {
if (typeof oldName !== 'string' || !oldName) return;
const cur = sysNickCur();
const hist = sysNickHistGet(store);
if (hist.indexOf(oldName) < 0) hist.push(oldName);
if (hist.indexOf(cur) < 0) hist.push(cur);
store.set('sysmsg-nick-hist', JSON.stringify(hist));
if (oldName === cur) { store.set('sysmsg-nick-swept', String(hist.length)); return; }
// 权威未就绪（开屏极早期）：只记 hist 不动 msgs、不推进 swept——否则清扫后的文本
// 与 IDB 权威里的原文本签名不同，finalize 合并会当成两条重复记录；交给补扫。
if (!chatDbReady) return;
store.set('sysmsg-nick-swept', String(hist.length));
// 改名后无论清扫是否有改动都要重渲染：系统消息显示走 {ta}→当前名替换，有改动时旧名
// 已换成 {ta}、无改动（连续改名）时旧渲染缓存的名字已过期——不重渲染 DOM 会停留在旧名
if (sysNickSweepMsgs(msgs, oldName)) saveMsgs();
try { if (chatVisible()) renderWindow(true); } catch (e) {}
} catch (e) {}
};
window.chatAddSystem = function (text, opts) {
opts = opts || {};
return addIn(text, { special: opts.special || 'poke', img: opts.img, mailNotice: opts.mailNotice, askQuestion: opts.askQuestion, askStatus: opts.askStatus, askOptions: opts.askOptions, askType: opts.askType, askTs: opts.askTs, choiceQuestion: opts.choiceQuestion, choiceOptions: opts.choiceOptions, choicePref: opts.choicePref, choiceCat: opts.choiceCat, curiousQuestion: opts.curiousQuestion, curiousQuick: opts.curiousQuick, curiousReplies: opts.curiousReplies, curiousFollowup: opts.curiousFollowup, curiousQid: opts.curiousQid, curiousCat: opts.curiousCat, roastText: opts.roastText, roastCat: opts.roastCat, deskCk: opts.deskCk, deskCkDir: opts.deskCkDir });
};
window.chatAddIn = function (text, opts) {
const r = addIn(text, opts);
if (opts && opts.enter && !chatVisible()) enterChat();
return r;
};
window.chatAddGift = function (rec) { if (!rec.ts) rec.ts = Date.now(); return addRec(rec); };
// v3.14.x：跨桌面安全追加一条系统消息到指定联系人的聊天记录——
// call.js notifyCallEnd / feed.js notifyFeedPostToChat / mail.js notifyMailToChat 共用。
// 旧实现各自「idbGet → push → idbSet 整包写回」，idbGet 超时兜底返回 undefined 时
// 会把该桌面全部历史覆盖成 [这一条]（与 loadMsgs 同款破坏面）。这里统一：
// ① 当前桌面走内存链路（实时渲染/未读角标/防抖统一落盘）；
// ② 非当前桌面先读后写，读到的 undefined 先用 idbGetAllKeys 复核是「确认无历史」
//    还是「这次读取失败」——失败则 1.5s 后重试（最多 3 次），仍失败放弃写入：
//    宁可丢一条系统提示，绝不冒覆盖整个聊天记录的风险。
window.chatAppendToDeskMsg = function (cid, text, opts) {
opts = opts || {};
const cur = window.__activeCid || 'default';
if (cid === cur) {
if (window.chatAddSystem) window.chatAddSystem(text, { special: opts.special, img: opts.img, mailNotice: opts.mailNotice });
return;
}
if (!window.idbGet || !window.idbSet) return;
const key = 'xy-home-v2:' + cid + ':chat-msgs';
let tries = 0;
const writeArr = function (arr) {
try { window.idbSet(key, JSON.stringify(arr)); } catch (e) {}
try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
// v3.26.x #90：跨桌面追加后同步条数账本（下次冷启动大键读失败时它就是守卫依据）
try { chatLedgerSave('xy-home-v2:' + cid, arr.length, msgsBytes(arr)); } catch (e) {}
};
const attempt = function () {
tries++;
window.idbGet(key).then(function (v) {
if (v !== undefined && v !== null) {
let arr = [];
let readOk = true;
try { arr = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { arr = []; readOk = false; }
if (!Array.isArray(arr)) { arr = []; readOk = false; }
// v3.26.x #90：读到有值却解析失败＝库里有历史只是读不懂，写回 [这一条] 等于删光，绝不写
if (!readOk) return;
arr.push({ side: 'in', special: opts.special || 'poke', text: text, ts: Date.now(), mailNotice: !!opts.mailNotice });
writeArr(arr);
return;
}
// undefined：复核键是否真的不存在
// v3.26.x #90：改走严格三态探测 idbHasKey，只有确认「库里没有」(false) 才允许新建只含
// 一条的数组；true（读取失败）与 null（探测本身失败）都按未知处理，安排重试。
const confirmMiss = window.idbHasKey
? window.idbHasKey(key).then(function (has) { return has === false; })
: (window.idbGetAllKeys
? window.idbGetAllKeys().then(function (keys) {
return !(keys || []).some(function (k) { return k === key; });
}).catch(function () { return false; })
: Promise.resolve(true));
confirmMiss.then(function (isMiss) {
if (isMiss) writeArr([{ side: 'in', special: opts.special || 'poke', text: text, ts: Date.now(), mailNotice: !!opts.mailNotice }]);
else if (tries < 3) setTimeout(attempt, 1500);
});
}).catch(function () { if (tries < 3) setTimeout(attempt, 1500); });
};
attempt();
};
// v3.19.x：安全的「非当前桌面」追加任意 rec（含 ask-card 互动卡）。先读后写，读到
// undefined 时用 idbGetAllKeys 复核是「确认无历史」还是「读取失败」——失败则重试
//（最多 3 次），绝不冒覆盖整个聊天记录的风险（与 chatAppendToDeskMsg 同款安全逻辑）。
// 当前桌面直接走内存链路 addRec（实时渲染 + 统一落盘）。
window.chatAppendDeskRec = function (cid, rec) {
  const cur = window.__activeCid || 'default';
  rec = rec || {};
  if (!rec.ts) rec.ts = Date.now();
  if (cid === cur) return addRec(rec);
  if (!window.idbGet || !window.idbSet) return;
  const key = 'xy-home-v2:' + cid + ':chat-msgs';
  let tries = 0;
  const writeArr = function (arr) {
    try { window.idbSet(key, JSON.stringify(arr)); } catch (e) {}
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    // v3.26.x #90：跨桌面追加后同步条数账本（下次冷启动大键读失败时它就是守卫依据）
    try { chatLedgerSave('xy-home-v2:' + cid, arr.length, msgsBytes(arr)); } catch (e) {}
  };
  const attempt = function () {
    tries++;
    window.idbGet(key).then(function (v) {
      if (v !== undefined && v !== null) {
        let arr = [];
        let readOk = true;
        try { arr = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { arr = []; readOk = false; }
        if (!Array.isArray(arr)) { arr = []; readOk = false; }
        // v3.26.x #90：读到有值却解析失败＝库里有历史只是读不懂，写回 [这一条] 等于删光，绝不写
        if (!readOk) return;
        arr.push(rec);
        writeArr(arr);
        return;
      }
      // v3.26.x #90：同 chatAppendToDeskMsg——改走严格三态探测 idbHasKey，只有确认库里
      // 没有（false）才新建只含一条的数组；true/null 一律按读取失败重试。后台通知回到
      // 浏览器瞬间 IDB 事务最容易未热，这条路径正是「记录自己消失」最像的触发点。
      const confirmMiss = window.idbHasKey
        ? window.idbHasKey(key).then(function (has) { return has === false; })
        : (window.idbGetAllKeys
          ? window.idbGetAllKeys().then(function (keys) {
              return !(keys || []).some(function (k) { return k === key; });
            }).catch(function () { return false; })
          : Promise.resolve(true));
      confirmMiss.then(function (isMiss) {
        if (isMiss) writeArr([rec]);
        else if (tries < 3) setTimeout(attempt, 1500);
      });
    }).catch(function () { if (tries < 3) setTimeout(attempt, 1500); });
  };
  attempt();
};
// v3.19.x：把一张跨桌面查岗卡（带 deskCk + deskCkDir 双方向）写入指定联系人桌面聊天。
// 后台收到查岗通知切回浏览器后，到该联系人即可看到并回答（incoming-requests 后台分支调用）。
window.chatAppendDeskCkTo = function (cid, q) {
  const field = (window.buildDeskCkCard ? window.buildDeskCkCard(q) : null)
    || { deskCkDir: 'toMe', text: '在干嘛呢？想你了。', hint: 'TA 来查岗了。', opts: null, askType: 'text' };
  window.chatAppendDeskRec(cid, {
    side: 'in', special: 'ask-card', text: field.text,
    askQuestion: field.text, askOptions: field.opts, askType: field.askType,
    deskCk: true, deskCkDir: field.deskCkDir
  });
};
// v3.19.x：把一句「求聊天」开场白写入指定联系人桌面聊天（后台命中求聊天时调用）。
window.chatAppendDeskTextTo = function (cid, text) {
  window.chatAppendDeskRec(cid, { side: 'in', special: 'poke', text: text || '想你了，来聊聊天吧。' });
};
function saveMsgsNow() {
// v3.26.x #88：与 saveMsgs 同一条守卫。调用方都是作答/回应后触发，msgs 必非空，
// 所以 v3.14.x 的「只挡空数组」在这里等于没挡——未读到权威的窗口照旧整包覆盖全部历史。
const authOk = chatDbReady && authLoadedPrefix === window.activePrefix();
if (!authOk) {
try { pendingLocal = msgs.slice(); } catch (e) {}
if (msgs.length) writeLsSnapshot(msgs, undefined, true);
try { scheduleIdbRetry(); } catch (e) {}
return;
}
// v3.26.x 止血：合并到低频空闲落盘（不再立即同步写整包），离页 flushSave 兜底
const myPrefix = window.activePrefix();
schedulePersist(() => {
  if (authLoadedPrefix !== myPrefix) return;
  // v3.26.x #90：条数缩水守卫（同 saveMsgs）
  if (!chatLedgerGuard(myPrefix, msgs)) return;
  // v3.26.x OOM：大历史 IDB 直存数组（免整包 stringify）
  try { if (window.idbSet) persistMsgsToIdb(myPrefix + ':chat-msgs', msgs); } catch (e) {}
  writeLsSnapshot(msgs, myPrefix, true);
});
}
window.chatChooseReply = function (msgIdx, answer, opt, match) {
const rec = msgs[msgIdx];
if (!rec || rec.special !== 'ask-choose' || rec.choiceStatus === 'answered') return;
const ownReplies = (function () {
if (!opt) return [];
if (Array.isArray(opt.reply) && opt.reply.length) return opt.reply.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
if (typeof opt.reply === 'string' && opt.reply.trim()) return [opt.reply.trim()];
return [];
})();
const pool = ownReplies.filter(c => !(window.isDefaultCardOff && window.isDefaultCardOff('interact', c)));
const liked = !!(opt && (opt.liked === true || opt.liked === 'true'));
const matched = typeof match === 'string' && match.indexOf('刚好想到在了一起') >= 0;
let reply;
if (matched || liked) {
reply = pool.length ? pool[Math.floor(Math.random() * pool.length)] : (window.pickAskCardReply ? window.pickAskCardReply() : '');
} else {
const preset = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
reply = preset ? (window.pickAskCardReply ? window.pickAskCardReply([preset]) : preset) : (window.pickAskCardReply ? window.pickAskCardReply() : '');
}
rec.choiceStatus = 'answered';
rec.choiceAnswer = answer;
rec.choiceReply = reply;
if (match) rec.choiceMatch = match;
saveMsgs();
saveMsgsNow();
addOut(answer);
addIn(reply || '…');
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + msgIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-choose-card answered"><div class="msg-ask-q">' + escTxt(rec.choiceQuestion || '') + '</div><div class="msg-ask-a">✓ 你选择了：' + escTxt(answer) + '</div><div class="msg-choose-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(reply || '…') : (reply || '…')) + '</div>' + favHeartHtml(rec) + '</div>';
}
};
window.chatCuriousReply = function (msgIdx, answer, reply, followup) {
const rec = msgs[msgIdx];
if (!rec || rec.special !== 'ask-curious' || rec.curiousStatus === 'answered') return;
rec.curiousStatus = 'answered';
rec.curiousAnswer = answer;
rec.curiousReply = reply || '…';
saveMsgs();
saveMsgsNow();
addOut(answer);
addIn(reply || '…');
if (followup) addIn(followup);
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + msgIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-choose-card answered"><div class="msg-ask-q">' + escTxt(rec.curiousQuestion || '') + '</div><div class="msg-ask-a">✓ 你：' + escTxt(answer) + '</div><div class="msg-choose-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(reply || '…') : (reply || '…')) + '</div>' + favHeartHtml(rec) + '</div>';
}
};
window.chatRoastReply = function (msgIdx, answer, reply) {
const rec = msgs[msgIdx];
if (!rec || rec.special !== 'ask-roast' || rec.roastStatus === 'answered') return;
rec.roastStatus = 'answered';
rec.roastAnswer = answer;
rec.roastReply = reply || '…';
saveMsgs();
saveMsgsNow();
addOut(answer);
addIn(reply || '…');
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + msgIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-choose-card answered"><div class="msg-ask-q">' + escTxt(rec.roastText || '') + '</div><div class="msg-ask-a">✓ 你：' + escTxt(answer) + '</div><div class="msg-choose-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(reply || '…') : (reply || '…')) + '</div>' + favHeartHtml(rec) + '</div>';
}
};
window.chatAskReply = function (msgIdx, answer, reply) {
const rec = msgs[msgIdx];
if (!rec || rec.special !== 'ask-card' || rec.askStatus === 'answered') return;
rec.askStatus = 'answered';
rec.askAnswer = answer;
let preset = '';
if (Array.isArray(reply) && reply.length) {
const arr = reply.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
if (arr.length) preset = arr[Math.floor(Math.random() * arr.length)];
} else if (typeof reply === 'string' && reply.trim()) {
preset = reply.trim();
}
const taReply = preset
? (window.pickAskCardReply ? window.pickAskCardReply([preset]) : preset)
: (window.pickAskCardReply ? window.pickAskCardReply() : '收到你的回答。');
// v3.17.x：桌面查岗卡（跨桌面「来消息」触发，带 deskCk 标记）回答后——
// 按概率从「桌面查岗」回应字卡池抽 1~5 张、空格分隔，作为 TA 的回应。
//（用户要求：回复后概率触发查岗我的那个联系人的回复字卡，最多 5 张、每张中间空一格；
//  字卡池用 公用字卡 + 该联系人桌面的专属字卡 合并，见 getCustomCardsFor。）
let deskReply = '';
if (rec && rec.deskCk) {
try {
// v3.19.x：按方向取池——deskCkDir 'meToTa'（联系人申请我查 TA）抽「联系人申请我
// 对联系人查岗」，否则（toMe/旧数据）抽「联系人对我查岗」；拒绝查岗时回一句固定失落话
const dir = rec.deskCkDir === 'meToTa' ? 'meToTa' : 'toMe';
const pool = (window.getDeskCheckPool ? window.getDeskCheckPool(dir) : []).concat(
  (window.getCustomCardsFor ? window.getCustomCardsFor(window.__activeCid || 'default') : []).filter(function (c) {
    return typeof c === 'string' && c.trim() && c.indexOf('data:') !== 0;
  })
);
if (dir === 'meToTa' && /不要|不用|下次|不了|算了|no/i.test(String(answer))
  && (Math.random() * 100 < 50)) {
deskReply = ['那好吧，下次想查随时来呀。', '没事，那我把自己交给你保管。', '不查也行，反正我总是会来找你。'][Math.floor(Math.random() * 3)];
} else if (pool.length && Math.random() * 100 < 50) {
const n = 1 + Math.floor(Math.random() * Math.min(5, pool.length));
const used = {};
const picked = [];
let guard = 0;
while (picked.length < n && guard++ < 50) {
const c = pool[Math.floor(Math.random() * pool.length)];
if (used[c]) continue;
used[c] = true;
picked.push(c);
}
if (picked.length) deskReply = picked.join(' ');
}
} catch (e) {}
}
const finalReply = deskReply || taReply;
rec.askReply = finalReply;
saveMsgs();
saveMsgsNow();
addOut(answer);
addIn(finalReply);
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + msgIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-ask-card answered"><div class="msg-ask-q">' + escTxt(rec.askQuestion || '') + '</div><div class="msg-ask-a">✓ 已回答：' + escTxt(answer) + '</div><div class="msg-choose-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(finalReply) : finalReply) + '</div>' + favHeartHtml(rec) + '</div>';
}
return finalReply;
};
function retractMsg(msgEl, side) {
const idx = parseInt(msgEl.dataset.idx, 10);
let target = msgEl;
if (!msgEl.isConnected && body) {
const cur = body.querySelector('.msg[data-idx="' + idx + '"]');
if (cur) target = cur; else return;
}
const b = target.querySelector('.msg-bubble');
if (!b) return;
if (!isNaN(idx) && msgs[idx]) {
msgs[idx].retracted = true;
msgs[idx].orig = b.innerHTML;
sessionChangedIdx.add(idx); // v3.6.x：标记本会话变更，防 loadMsgs 合并回滚撤回
chatTailDrop(msgs[idx]); // #180：撤回消息从尾巴日志摘除，防刷新后回放复活
saveMsgs();
if (msgs[idx].side === 'out') syncLastMineText();
}
b.dataset.orig = b.innerHTML;
b.innerHTML = '<span style="opacity:.6;font-size:12px;cursor:pointer">' + (side === 'out' ? '我' : '对方') + '撤回了一条消息</span>';
bindToggle(b, side);
}
function splitCardSegs(text) {
const str = String(text || '').trim();
if (!str) return [];
const isWord = (ch) => /[\u4e00-\u9fffA-Za-z0-9]/.test(ch);
const out = [];
let cur = '';
for (let i = 0; i < str.length; i++) {
const ch = str[i];
if ('。！？；\n!?;'.indexOf(ch) >= 0) {
cur += ch;
if (cur.trim()) out.push(cur.trim());
cur = '';
continue;
}
if (ch === ' ' || ch === '，' || ch === ',') {
const seg = cur.trim();
const nextStart = str.slice(i + 1).trimStart()[0] || '';
const segEnd = seg[seg.length - 1] || '';
const canSplit = seg.length >= 2 && isWord(segEnd) && isWord(nextStart);
if (canSplit) {
if (seg) out.push(seg);
cur = '';
} else {
cur += ch; // 并入当前段（保护颜文字/符号）
}
continue;
}
cur += ch;
}
if (cur.trim()) out.push(cur.trim());
const filtered = [];
out.forEach(s => {
if (s.length <= 1 && filtered.length) filtered[filtered.length - 1] += ' ' + s;
else filtered.push(s);
});
if (filtered.length < 2 && str.trim()) return [str.trim()];
return filtered;
}
function partialRetractMsg(msgEl, side) {
const idx = parseInt(msgEl.dataset.idx, 10);
let target = msgEl;
if (!msgEl.isConnected && body) {
const cur = body.querySelector('.msg[data-idx="' + idx + '"]');
if (cur) target = cur; else return;
}
const rec = (idx >= 0 && msgs[idx]) ? msgs[idx] : null;
if (!rec || rec.retracted || rec.parts || rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice') { retractMsg(target, side); return; }
const segs = splitCardSegs(rec.text);
if (segs.length > 1) {
rec.retractedSegs = rec.retractedSegs || [];
const remain = [];
for (let i = 0; i < segs.length; i++) {
if (!rec.retractedSegs.some(r => r.idx === i)) remain.push(i);
}
if (remain.length) {
const n = 1 + Math.floor(Math.random() * Math.min(remain.length, 3));
const k = Math.min(n, remain.length);
for (let r = 0; r < k; r++) {
const si = remain.splice(Math.floor(Math.random() * remain.length), 1)[0];
rec.retractedSegs.push({ text: segs[si], idx: si });
}
sessionChangedIdx.add(idx); // v3.6.x：标记本会话变更，防 loadMsgs 合并回滚局部撤回
chatTailDrop(rec); // #180：局部撤回后日志原文不得回放（与撤回同口径）
saveMsgs();
const m = renderMsg(rec);
m.dataset.idx = idx;
if (target.parentNode) target.parentNode.replaceChild(m, target);
return;
}
}
if (rec.mood && rec.mood.length) {
rec.retractedMood = rec.retractedMood || [];
const remain = [];
for (let i = 0; i < rec.mood.length; i++) {
if (rec.retractedMood.indexOf(i) < 0) remain.push(i);
}
if (remain.length) {
const pick = remain[Math.floor(Math.random() * remain.length)];
rec.retractedMood.push(pick);
sessionChangedIdx.add(idx); // v3.6.x：标记本会话变更，防 loadMsgs 合并回滚局部撤回
chatTailDrop(rec); // #180：局部撤回后日志原文不得回放（与撤回同口径）
saveMsgs();
const m = renderMsg(rec);
m.dataset.idx = idx;
if (target.parentNode) target.parentNode.replaceChild(m, target);
return;
}
}
retractMsg(target, side);
}
// v3.26.x：字卡池为空的最终兜底——原单条硬编码「收到～」会让联系人在没有可用
// 字卡时每条回复都一模一样（用户反馈联系人一直/重复发【收到~】）。改用一个小型
// 通用池随机抽，避免机械复读；真实的根因仍要查该联系人的字卡库是否为 & 默认字卡开关。
const FALLBACK_REPLY_POOL = ['收到～', '好呀', '好～', '嗯嗯', '知道啦', '好哒', '嗯嗯，我在听'];
// FIX 2026-09-05 #185 空白字卡防空气泡：池里可能混入空串/纯空白/零宽字符字卡（导入包/手编），
// 旧单抽 '' 有 || 兜底但 ' ' 这类 truthy 空白会直接发出；抽取时跳过空白，20 次抽不中回空串走上层兜底
function pickNonBlank(arr) {
let v = '', g = 0;
do { v = pick(arr); g++; } while (g < 20 && !(typeof v === 'string' && v.trim()));
return (typeof v === 'string' && v.trim()) ? v : '';
}
function genReplyText(c) {
const pool = getPool();
let reply = '', type = 'text';
if (pool.sticker.length && hit(c['sticker-prob'])) {
reply = pickNonBlank(pool.sticker); type = 'sticker';
} else if (pool.emoji.length && hit(c['emoji-prob'])) {
reply = pickNonBlank(pool.emoji); type = 'emoji';
} else if (pool.image.length && hit(c['image-prob'])) {
reply = pickNonBlank(pool.image); type = 'image';
} else if (pool.voice.length && hit(c['voice-prob'])) {
reply = pickNonBlank(pool.voice); type = 'voice';
} else {
reply = pickNonBlank(pool.text) || pick(FALLBACK_REPLY_POOL);
}
if (type === 'text' && pool.kaomoji.length && hit(c['kaomoji-prob'])) {
const kj = pickNonBlank(pool.kaomoji);
if (kj) reply += ' ' + kj;
}
return { text: reply, type: type };
}
function scheduleReply() {
const myCid = window.__activeCid || 'default';
const sameCid = () => (window.__activeCid || 'default') === myCid;
syncLastMineText();
const quoteSrc = lastMineQuote;
const quoteSrcIdx = lastMineIdx;
const quoteKey = quoteSrc && typeof quoteSrc === 'object' ? String(quoteSrc.t || '') + '\n' + (quoteSrc.imgs || []).join() : String(quoteSrc || '');
const c = cfg();
if (hit(c['rn-prob'])) {
setTimeout(() => { if (!sameCid()) return; addIn('', { special: 'read' }); }, randInt(1000, 4000));
return;
}
const delay = (c['rs-min'] + Math.random() * Math.max(1, c['rs-max'] - c['rs-min'])) * 1000;
showTyping();
setTimeout(() => {
if (!sameCid()) { hideTyping(); return; }
hideTyping();
if (hit(c['touch-prob'])) {
performPoke();
return;
}
const rpMin = Math.max(1, Number(c['reply-min']) || 1);
const rpMax = Math.max(rpMin, Number(c['reply-max']) || 2);
// #167 多字卡回复(py-en)是总开关：关闭时回复条数强制 1 条（关=彻底只回一条），开启才按「回复条数」拆条
const count = (c['py-en'] === 1) ? randInt(rpMin, rpMax) : 1;
try { console.log('[mochi-reply] scheduleReply count=%s rpMin=%s rpMax=%s raw reply-min=%s reply-max=%s', count, rpMin, rpMax, c['reply-min'], c['reply-max']); window.__replyDiag = (window.__replyDiag||0)+1; window.__replyOnceDiag = 0; } catch(e){}
const wantQuote = hit(c['quote-prob']) && !!quoteSrc;
for (let i = 0; i < count; i++) {
setTimeout(() => {
if (!sameCid()) return;
hideTyping();
const q = (wantQuote && i === 0 && quoteKey && quoteKey !== lastQuotedText) ? quoteSrc : null;
if (q) lastQuotedText = quoteKey;
replyOnce(c, q, i > 0, q ? quoteSrcIdx : -1);
if (i < count - 1) showTyping();
if (i === count - 1) {
setTimeout(() => { if (!sameCid()) return; if (window.maybeMusicRequest) window.maybeMusicRequest(); }, 2000);
}
}, i * randInt(1200, 2800));
}
}, delay);
}
async function replyOnce(c, quote, silent, quoteIdx) {
try { console.log('[mochi-reply] replyOnce #%s quote=%s silent=%s', (window.__replyOnceDiag=(window.__replyOnceDiag||0)+1), !!quote, !!silent); } catch(e){}
try { await ensureReplyCardsReady(); } catch (e) {}
const myCid = window.__activeCid || 'default';
const sameCid = () => (window.__activeCid || 'default') === myCid;
const rep = genOneReply(c);
if (rep && rep.type === 'text' && typeof rep.text === 'string' && window.periodWarmText) {
try { const _w = window.periodWarmText(rep.text); if (_w) rep.text = _w; } catch (e) {}
}
const m = addIn(rep.text, { quote: quote, qside: 'out', qidx: quote ? quoteIdx : undefined, type: rep.type, parts: rep.parts, silent: silent });
const _favProbMsg = (window.favCfg ? window.favCfg().taMsg : 30);
if (lastMineText && Math.random() * 100 < _favProbMsg) {
const fav = getFav();
// v3.26.x：只与 TA 自己的收藏判重——「我」收藏过同一条不应挡住 TA 的自动收藏（两个 tab 独立）
if (!fav.some(f => f.by === 'ta' && f.side === 'out' && f.text === lastMineText)) {
let favType = lastMineText.indexOf('data:') === 0 ? 'image' : 'text';
let favParts = undefined;
for (let i = msgs.length - 1; i >= 0; i--) {
const mm = msgs[i];
if (mm && mm.side === 'out' && mm.text === lastMineText) {
if (mm.type && mm.type !== 'text') favType = mm.type;
if (mm.parts && mm.parts.length) favParts = mm.parts.map(p => ({ k: p.k, v: p.v, sub: p.sub }));
break;
}
}
fav.push({ side: 'out', text: lastMineText, type: favType, ts: Date.now(), by: 'ta', parts: favParts });
saveFav(fav);
setTimeout(() => { if (!sameCid()) return; toast('TA 收藏了你的一条消息'); }, 1200);
}
}
	if (rep.type === 'text' || rep.type === 'sticker' || rep.type === 'image') {
	if (window.addChatCount) window.addChatCount();
	// v3.16.x：【TA的心情】低概率主动分享——正常回复后小概率额外追加一条
	// 独立分享（内容来自 TA 的心情字卡库，非情绪链；自带总冷却 + 同类冷却）
	try {
	const tm = (window.tryTaMoodShare && window.tryTaMoodShare()) || null;
	if (tm && tm.content) {
	setTimeout(() => {
	if (!sameCid()) return;
	addIn(tm.content, { initiative: true, tag: 'TA的心情', tagNoDup: true });
	}, randInt(1500, 3500));
	}
	} catch (e) {}
	const chain = (window.triggerEmotionChain && window.triggerEmotionChain()) || null;
if (chain && chain.length) {
const typeName = { mood: '情绪', heart: '心意', intent: '交流意图' };
setTimeout(() => {
if (!sameCid()) return;
const bm = m.querySelector('.msg-bubble');
if (bm) {
let mm = bm.querySelector('.msg-moods');
if (!mm) {
mm = document.createElement('div');
mm.className = 'msg-moods';
bm.appendChild(mm);
}
chain.forEach(it => {
const tag = typeName[it.type] || '情绪';
mm.innerHTML += '<div class="msg-mood' + (it.type === 'intent' ? ' msg-intent' : '') + '"><span class="msg-mood-tag">' + tag + '</span><span>' + it.content + '</span></div>';
});
const idx2 = Number(m.dataset.idx);
if (!isNaN(idx2) && msgs[idx2]) {
msgs[idx2].mood = msgs[idx2].mood || [];
chain.forEach(it => {
msgs[idx2].mood.push({ tag: typeName[it.type] || '情绪', label: it.content });
});
saveMsgs();
}
}
}, 500);
}
// v3.14.x：移除 20% 预掷门控——与 checkCare 内部概率叠加后第 2 天起触发率仅 ~12%，体感「只有第一天会关心」；防刷屏由其内部同日一条冷却兜底
try { window.periodCheckCare && window.periodCheckCare(); } catch (e) {}
}
if (hit(c['rc-prob'])) {
setTimeout(() => {
if (!sameCid()) return;
partialRetractMsg(m, 'in');
if (hit(c['rc-refix'])) {
showTyping();
setTimeout(() => { if (!sameCid()) return; hideTyping(); replyOnce(c, null); }, 600);
}
}, 900);
}
setTimeout(() => { if (!sameCid()) return; if (window.callMaybeTrigger) window.callMaybeTrigger(); }, 3500);
setTimeout(() => { if (!sameCid()) return; trySystemAutoSend(); trySystemAskMochi(); tryCollectPending(); if (window.maybeAutoGift) window.maybeAutoGift(); }, 2500);
}
window.continueChat = function () {
const myCid = window.__activeCid || 'default';
const sameCid = () => (window.__activeCid || 'default') === myCid;
const c = cfg();
let delay, count;
if (c['cs-normal'] === 1) {
const rsMin = Math.max(1, Number(c['rs-min']) || 1);
const rsMax = Math.max(rsMin, Number(c['rs-max']) || rsMin);
delay = (rsMin + Math.random() * (rsMax - rsMin)) * 1000;
const rpMin = Math.max(1, Number(c['reply-min']) || 1);
const rpMax = Math.max(rpMin, Number(c['reply-max']) || 2);
// #167 同 scheduleReply：py-en 总开关关闭时「让对方继续说」也只回一条
count = (c['py-en'] !== 1) ? 1 : randInt(rpMin, rpMax);
} else {
delay = randInt(300, 1000); count = 1;
}
showTyping();
setTimeout(() => {
if (!sameCid()) { hideTyping(); return; }
hideTyping();
for (let i = 0; i < count; i++) {
setTimeout(() => {
if (!sameCid()) return;
hideTyping();
replyOnce(c, null, i > 0);
if (i < count - 1) showTyping();
if (i === count - 1) setTimeout(() => { if (!sameCid()) return; if (window.maybeMusicRequest) window.maybeMusicRequest(); }, 2000);
}, i * randInt(1200, 2800));
}
}, delay);
};
if (pname) {
pname.addEventListener('click', () => {
const c = cfg();
if (c['cs-trigger-name'] === 1 && window.continueChat) window.continueChat();
});
}
const csBtn = document.getElementById('chat-continue-btn');
// #152：安卓键盘收起与点按手势重叠时（打字后立刻点「继续说」最典型），输入栏随视口
// 回弹下移，touchend 的二次命中测试落在位移后的别的元素上，合成 click 被派发到错误
// 元素——按钮监听器不触发、无报错、无回复（iQOO Neo10Pro/多安卓机型报障，无头复现实证）。
// 触摸改 pointerdown「按下即触发」：目标是真实按压元素，不经历触摸后的二次命中测试，
// 键盘怎么收都吞不掉；1.2s 防重入挡住随后补发的合成 click（干净点按双事件只回一次）。
// 鼠标仍走 click（不响应按下半程）；无 PointerEvent 的老内核 click 路径照常兜底。
let _csFiredAt = 0;
function csFireContinue() {
  const now = Date.now();
  if (now - _csFiredAt < 1200) return;
  _csFiredAt = now;
  if (window.continueChat) window.continueChat();
}
if (csBtn) {
  csBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; csFireContinue(); });
  csBtn.addEventListener('click', () => { csFireContinue(); });
}
window.applyContinueSayUI = function () {
try {
const c = cfg();
if (pname) pname.title = c['cs-trigger-name'] === 1 ? '点击让对方继续说' : '';
if (csBtn) csBtn.style.display = c['cs-trigger-bar'] === 1 ? '' : 'none';
document.dispatchEvent(new Event('continue-say-changed')); // 群聊输入栏「继续说」按钮跟随同一开关
} catch (e) {}
};
window.applyContinueSayUI();
const pAv = document.getElementById('chat-partner-av');
if (pAv) {
pAv.addEventListener('click', (e) => {
e.stopPropagation();
if (window.openCkPanel) window.openCkPanel();
});
}
const moreCk = document.getElementById('more-ck');
if (moreCk) {
moreCk.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
// 聊天「更多功能」寻踪：全屏打开寻踪页（返回时回聊天）
if (window.openCheckinPage) {
window.__ckFrom = 'chat';
window.openCheckinPage();
} else toast('寻踪加载失败');
});
}
const moreCjian = document.getElementById('more-cjian');
if (moreCjian) {
moreCjian.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
if (window.openCjian) {
window.__cjianFrom = 'chat';
try { window.openCjian(); } catch (err) {
try { if (window.__jsErrors) window.__jsErrors.push('openCjian: ' + (err && err.message || err)); } catch (e2) {}
toast('此间打开出错，请刷新页面重试');
}
} else toast('此间加载失败，请刷新页面重试');
});
}
let lastMineText = '';
let lastMineIdx = -1;
let lastMineQuote = '';
let lastQuotedText = '';
function syncLastMineText() {
for (let i = msgs.length - 1; i >= 0; i--) {
const m = msgs[i];
if (m && m.side === 'out' && !m.retracted && typeof m.text === 'string' && m.text) {
lastMineText = m.text;
lastMineQuote = quoteSnapOf(m);
lastMineIdx = i;
return;
}
}
lastMineText = '';
lastMineQuote = '';
lastMineIdx = -1;
}
function genOneReply(c) {
const pool = getPool();
let t, type = 'text';
if (c['py-en'] === 1 && hit(c['py-prob']) && pool.text.length) {
const nbTextPool = pool.text.filter(s => typeof s === 'string' && s.trim()); // FIX 2026-09-05 #185 多字卡拼接前先滤空白卡（否则 join 出纯空格空气泡）
const n = randInt(c['py-min'], c['py-max']);
t = pickN(nbTextPool.length ? nbTextPool : pool.text, n).join(' ');
} else {
const r = genReplyText(c);
t = r.text;
type = r.type;
}
if (type === 'sticker' || type === 'image' || type === 'voice') {
return { text: t, type: type };
}
const defs = (window.getDefaultCards && window.getDefaultCards()) || null;
if (defs && defs.type === 'text' && defs.text) {
t = defs.text;
}
const replyWord = (window.getReplyCard && window.getReplyCard()) || '';
if (replyWord) {
t = replyWord;
}
// FIX 2026-09-05 #185 最终非空兜底：固定回复字卡（getReplyCard）/默认主字卡（defs.text）被设成
// 空白内容时会无条件覆盖抽好的回复，必须在此拦下，否则联系人持续发空气泡
if (typeof t !== 'string' || !t.trim()) t = pick(FALLBACK_REPLY_POOL);
if (hit(c['cf-prob'])) {
const w = (window.getFollowupWord && window.getFollowupWord(t)) || '';
if (w) t += ' ' + w;
}
const parts = [{ k: 'text', v: t }];
if (hit(c['sticker-prob'] || 0)) {
const st = (window.getMediaCards && window.getMediaCards('sticker')) || [];
if (st.length) parts.push({ k: 'img', v: st[Math.floor(Math.random() * st.length)], sub: 'sticker' });
} else if (hit(c['image-prob'] || 0)) {
const im = (window.getMediaCards && window.getMediaCards('image')) || [];
if (im.length) parts.push({ k: 'img', v: im[Math.floor(Math.random() * im.length)], sub: 'image' });
}
return { text: t, type: 'text', parts: parts.length > 1 ? parts : null };
}
let autoTimer = null;
function scheduleAutoSend() {
clearTimeout(autoTimer);
const c = cfg();
if (cfgn(c, 'as-en', 1) !== 1) {
autoTimer = setTimeout(scheduleAutoSend, 30000);
return;
}
let asMin = Math.min(600, Math.max(1, Number(cfgn(c, 'as-min', 5)) || 5)) * 60;
let asMax = Math.min(600, Math.max(1, Number(cfgn(c, 'as-max', 10)) || 10)) * 60;
if (cfgn(c, 'dnd-en', 0) === 1) { asMin = 30 * 60; asMax = 180 * 60; }
if (asMax < asMin) asMax = asMin;
const delay = (asMin + Math.random() * Math.max(1, asMax - asMin)) * 1000;
autoTimer = setTimeout(() => {
tryAutoSend();
scheduleAutoSend();
}, delay);
}
window.rescheduleAutoSend = function () { try { scheduleAutoSend(); } catch (e) {} };
document.addEventListener('contact-switched', function () {
try { if (window.replyCfg) scheduleAutoSend(); } catch (e) {}
});
// FIX 2026-09-04 #158 本池是「我」拒绝 TA 邀请后自己发的婉拒话术，逐条必须是拒绝者视角；原第二条「等会儿再陪我玩好不好」是邀请者(TA)口吻（陪我玩=要对方陪），用户误以为该由联系人发送，改为「等会儿再陪你玩好不好」
const INVITE_DECLINE = ['下次吧，现在不太想玩~', '等会儿再陪你玩好不好', '先不玩啦，待会儿再说', '现在没状态，下次一定'];
// v3.14.x：贴贴邀请（cuddle）——正常情侣贴贴互动（贴/抱/牵手/靠着），没有游戏半框：
// 同意后轻震动一下（体感反馈），TA 稍后回应一句贴贴的话；婉拒用专属文案
const CUDDLE_DECLINE = ['下次再贴吧，先记着这笔~', '等会儿补给你，说话算数', '先欠着，攒到晚上一起还~', '今天想先自己待会儿，明天加倍还你'];
const CUDDLE_REPLIES = ['嗯……蹭到了。暖暖的，很喜欢。', '那我要贴很久哦，不许偷偷跑掉。', '手被握住了，就这样待一会儿。', '感觉到了，你在旁边。很安心。', '贴贴充电中……好，满格了。'];
// v3.26.x(#122)：注册聊天内置系统回应池跨分类搜索（字卡库列表页搜索同源可查，不再搜不到）
window.__cardSearchFns = window.__cardSearchFns || [];
window.__cardSearchFns.push({ name: '聊天系统回应', fn: function (kw) {
  const out = [];
  try {
    FALLBACK_REPLY_POOL.forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: '兜底回复' }); });
    INVITE_DECLINE.forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: '游戏邀请·婉拒' }); });
    CUDDLE_DECLINE.forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: '贴贴·婉拒' }); });
    CUDDLE_REPLIES.forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: '贴贴·回应' }); });
  } catch (e) {}
  return out;
} });
function openInviteConfirm(title, staticText, onAccept, declinePool) {
const mask = document.getElementById('modal-mask');
if ((mask && !mask.hidden) || !window.openModal) { onAccept(); return; }
window.openModal(title, '', (v) => {
if (v === '1') onAccept();
else addOut(pick(declinePool || INVITE_DECLINE));
}, {
noInput: true,
lock: true,
pills: [{ label: '同意', value: '1' }, { label: '拒绝', value: '0' }],
pill: '1', // v3.16.x：邀请弹窗默认选中「同意」，无需手动点选直接确定
staticText: staticText
});
}
function openInvitePanelFor(kind, name) {
if (kind === 'cuddle') {
try { if (navigator.vibrate) navigator.vibrate([30, 60, 90]); } catch (e) {}
setTimeout(() => { try { addIn(name + ' ' + pick(CUDDLE_REPLIES), {}); } catch (e) {} }, randInt(600, 1200));
return;
}
if (kind === 'rps') { if (window.openRpsPanel) window.openRpsPanel(); return; }
if (kind === 'pong') {
const ids = ['poke-card', 'emoji-panel', 'chat-ask-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel'];
ids.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
if (window.closeAvlib) window.closeAvlib();
if (window.openPongPanel) window.openPongPanel();
return;
}
if (kind === 'snake') { if (window.openSnakePanel) window.openSnakePanel(); }
}
const INVITE_KIND_META = {
rps: { title: '猜拳邀请' },
pong: { title: '游戏邀请' },
snake: { title: '游戏邀请' },
cuddle: { title: '贴贴邀请' }
};
function sendTaInvite(inv, name) {
const meta = INVITE_KIND_META[inv && inv.kind] || INVITE_KIND_META.rps;
// v3.16.x：邀请消息带 gInv 游戏类型字段（渲染仍走 poke），供聊天统计「小游戏记录」识别 TA 主动邀请
addIn(name + ' ' + (inv.text || ''), { special: 'poke', initiative: true, gInv: inv.kind });
showTyping();
setTimeout(() => {
hideTyping();
openInviteConfirm(name + ' 的' + meta.title, name + ' ' + (inv.text || ''), () => openInvitePanelFor(inv.kind, name), inv.kind === 'cuddle' ? CUDDLE_DECLINE : null);
}, randInt(700, 1400));
}
window.sendTaInvite = sendTaInvite;
function tryActiveInvite(c) {
if (!chatVisible()) return false;
const name = chatPartnerName();
let inv = null;
if (window.taInviteDraw) {
inv = window.taInviteDraw(c);
} else {
if (cfgn(c, 'ai-rps-en', 1) === 1 && hit(cfgn(c, 'ai-rps-prob', 8))) inv = { kind: 'rps', text: '想和你猜拳，来一局？' };
else if (cfgn(c, 'ai-game-en', 1) === 1 && hit(cfgn(c, 'ai-game-prob', 5))) inv = Math.random() < 0.5 ? { kind: 'pong', text: '想和你玩一局 Pong，来吗？' } : { kind: 'snake', text: '想和你玩双人贪吃蛇，来吗？' };
}
if (!inv || !inv.text) return false;
sendTaInvite(inv, name);
return true;
}
window.triggerTaInviteNow = function () {
try {
const name = chatPartnerName();
const inv = window.taInvitePickAny ? window.taInvitePickAny() : null;
if (!inv || !inv.text) { toast('TA的邀请题库没有可用内容'); return false; }
sendTaInvite(inv, name);
return true;
} catch (e) { return false; }
};
window.tryActiveInvite = tryActiveInvite;
function tryAutoSend() {
try {
const c = cfg();
// FIX 2026-09-05 #187 专属字卡串桌面：tryAutoSend 异步链（await 取回字卡可数秒+每条消息
// setTimeout 再数百~2600ms）此前无 sameCid 守卫——B 桌面触发的主动消息在用户切到 A 桌面后
// 才发出，B 池的专属字卡落进 A 桌面聊天（vivo/多机型报障，与设备无关；scheduleReply/
// replyOnce 均有守卫，唯独主动消息漏了）。入口捕获 cid，await 后与每个定时器逐层拦截。
const autoCid = window.__activeCid || 'default';
const sameAutoCid = () => (window.__activeCid || 'default') === autoCid;
try { console.log('[mochi-auto] tryAutoSend called as-en=%s as-prob=%s as-min=%s as-max=%s', cfgn(c,'as-en',1), cfgn(c,'as-prob',30), cfgn(c,'as-min',5), cfgn(c,'as-max',10)); } catch(e){}
if (cfgn(c, 'as-en', 1) !== 1) { try { console.log('[mochi-auto] as-en OFF, skip'); } catch(e){} return; }
let prob = cfgn(c, 'as-prob', 30);
if (!(prob > 0)) prob = 30;
if (cfgn(c, 'dnd-en', 0) === 1) prob = 10;
if (!hit(prob)) return;
if (hit(cfgn(c, 'touch-prob', 5))) { performPoke(); return; }
if (tryActiveInvite(c)) return;
if (window.ckQuestionTry && window.ckQuestionTry(c)) return;
// v3.27.x：主动发送前先确保字卡池就绪——冷启动挂起大键时同步读池是空库，
// 主动消息也会落「在吗？」兜底；等待取回完成再构建 pool（专属优先、上限 8s 对齐 IDB）
(async () => {
try { await ensureReplyCardsReady(); } catch (e) {}
if (!sameAutoCid()) return; // FIX #187 取回期间已切桌面：池子是旧桌面的，整条主动消息放弃
const pool = getPool();
const autoMsg = () => {
// v3.26.x #163：主动消息此前完全不走默认字卡概率——dc-overall-chat（如 85%）只管
// genOneReply 文本覆盖路径，TA 主动发的消息仍 85% 是自定义（45% 固定从仅有的几张
// 文字卡里抽+15% 固定那 1 张 emoji+25% 自家贴纸/图片），用户体感「默认概率调到
// 八九十还是总发我自己设置的字卡，反复出现」。对齐回复路径口径：先掷 getDefaultCards
// （内部按场景概率+分类占比抽，总开关/聊天使用/分类/单卡开关同源生效），命中非拍一拍
// 即用默认字卡，未掷中才落自定义池原比例。
try {
const defs = (window.getDefaultCards && window.getDefaultCards()) || null;
if (defs && defs.type !== 'poke' && defs.text) return { text: defs.text, type: 'text' };
} catch (e) {}
const r = Math.random() * 100;
if (pool.sticker.length && r < 15) return { text: pick(pool.sticker), type: 'sticker' };
if (pool.image.length && r < 25) return { text: pick(pool.image), type: 'image' };
if (pool.kaomoji.length && r < 40) return { text: pick(pool.kaomoji), type: 'text' };
if (pool.emoji.length && r < 55) return { text: pick(pool.emoji), type: 'text' };
return { text: pick(pool.text) || '在吗？', type: 'text' };
};
const acMin = Math.max(1, Number(cfgn(c, 'as-count-min', 1)) || 1);
const acMax = Math.max(acMin, Number(cfgn(c, 'as-count-max', 2)) || 2);
const count = randInt(acMin, acMax);
for (let i = 0; i < count; i++) {
setTimeout(() => {
if (!sameAutoCid()) return; // FIX #187
hideTyping();
const am = autoMsg();
const m = addIn(am.text, { type: am.type, initiative: true, silent: i > 0 });
try { console.log('[mochi-auto] 主动发送消息: type=%s initiative=true', am.type); } catch(e){}
if (hit(c['rc-prob'])) {
setTimeout(() => {
if (!sameAutoCid()) return; // FIX #187
retractMsg(m, 'in');
if (hit(c['rc-refix'])) {
showTyping();
setTimeout(() => { if (!sameAutoCid()) return; hideTyping(); addIn(pick(pool.text) || '…', { initiative: true }); }, 600);
}
}, 900);
}
if (i < count - 1) showTyping();
}, i * randInt(900, 2600));
}
setTimeout(() => { if (!sameAutoCid()) return; if (window.callMaybeTrigger) window.callMaybeTrigger(); }, count * 2600 + 3500);
setTimeout(() => { if (!sameAutoCid()) return; trySystemAutoSend(); trySystemAskMochi(); tryCollectPending(); if (window.maybeAutoGift) window.maybeAutoGift(); }, count * 2600 + 2500);
})();
} catch (e) {
try {
const errArr = (window.__jsErrors = window.__jsErrors || []);
errArr.push('autoSend:' + (e && e.message || e));
} catch (x) {}
}
}
const chatApp = document.querySelector('.app[data-app="chat"]');
const chatPage = document.getElementById('page-chat');
function scrollToBottom() {
body.scrollTop = body.scrollHeight;
}
function enterChat() {
document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
const phoneTab = document.querySelector('.tab[data-page="page-phone"]');
if (phoneTab) phoneTab.classList.add('active');
document.querySelectorAll('.page').forEach(p => p.hidden = true);
chatPage.hidden = false;
// v3.28.x：进入聊天页即按需取回字卡库（冷启动挂起大键）——专属字卡优先（回复池主源），
// 公用随后；配合 replyOnce 内的等待，避免首条/持续回复落兜底卡。
try { if (window.hydrateLibScopes) window.hydrateLibScopes(['own', 'public']); } catch (e) {}
fillAvatar('chat-user-av', 'cs-avatar-user');
fillAvatar('chat-partner-av', 'cs-avatar-partner');
if (window.applyChatSettings) window.applyChatSettings();
clearChatUnread();
loadMsgs();
updateChatLoading(); // 记录未就绪时显示「正在加载聊天记录…」进度条
renderWindow(false, true);
scrollToBottom();
if (window.requestAnimationFrame) {
requestAnimationFrame(scrollToBottom);
requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
}
setTimeout(scrollToBottom, 400);
if (typingOn && chatVisible()) {
typingEl.hidden = false;
scrollChatBottom(); // typing 行占位时保持最后一条可见
}
}
if (chatApp && chatPage) {
chatApp.addEventListener('click', () => {
const editing = Array.from(document.querySelectorAll('.app-grid'))
.some(g => g.classList.contains('editing'));
if (editing) return;
enterChat();
});
}
const back = document.getElementById('chat-back');
if (back) {
back.addEventListener('click', () => {
const phonePage = document.getElementById('page-phone');
if (phonePage) {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
phonePage.hidden = false;
}
});
}
const csOpenBtn = document.getElementById('chat-settings-btn');
const csPage = document.getElementById('page-chat-settings');
if (csOpenBtn && csPage) {
csOpenBtn.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
csPage.hidden = false;
});
}
const csBack = document.getElementById('cs-back');
if (csBack) {
csBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
chatPage.hidden = false;
});
}
const morePanel = document.getElementById('chat-more-panel');
const moreBtn = document.getElementById('chat-more-btn');
if (moreBtn && morePanel) {
const moreGridFun = document.getElementById('more-grid-fun');
const moreGridAsk = document.getElementById('more-grid-ask');
// v3.15.x：功能增多后顶部改为分类 chips（互动/小游戏/工具/TA的提问），
// 按钮元素与 ID 全部保留只做过滤显示；每个功能只归属一个分类、分类间不重复
const MORE_CATS = ['chat', 'game', 'tool', 'ask'];
// v3.26.x：群聊打开共享面板时进入「群聊模式」——只保留【工具】分类，且只留 帮我决定/多人决定/搜索记录/占卜；
// 禁止在群聊里使用【小游戏】【TA的提问】【互动】功能。聊天页打开时关闭该模式、恢复全部分类。
let moreGroupMode = false;
const GROUP_MORE_ITEM_IDS = new Set(['more-decide', 'more-gdecide', 'more-search', 'more-divine']);
function applyMoreCat(cat, group) {
if (group === true || group === false) moreGroupMode = group;
if (moreGroupMode) cat = 'tool'; // 群聊模式强制锁定「工具」分类
if (MORE_CATS.indexOf(cat) < 0) cat = 'chat';
document.querySelectorAll('#more-tabs .more-tab').forEach(t => {
const showTab = !moreGroupMode || t.dataset.mcat === 'tool'; // 群聊模式隐藏其余分类 tab
t.hidden = !showTab;
t.classList.toggle('sel', t.dataset.mcat === cat);
});
if (moreGridAsk) moreGridAsk.hidden = cat !== 'ask';
if (moreGridFun) {
moreGridFun.hidden = cat === 'ask';
moreGridFun.querySelectorAll('.more-item').forEach(it => {
if (moreGroupMode) it.hidden = !GROUP_MORE_ITEM_IDS.has(it.id); // 群聊模式只显允许的 4 项
else it.hidden = it.dataset.mcat !== cat;
});
}
if (!moreGroupMode) store.set('more-cat', cat);
}
// v3.16.x：群聊页打开共享更多面板时复用同一分类过滤
window.applyMoreCat = applyMoreCat;
// v3.26.x：群聊打开/关闭共享面板时切换群聊过滤模式
window.setMoreGroupMode = (on) => { moreGroupMode = !!on; applyMoreCat('tool', !!on); };
document.querySelectorAll('#more-tabs .more-tab').forEach(t => t.addEventListener('click', (e) => { e.stopPropagation(); applyMoreCat(t.dataset.mcat); }));
moreBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel.hidden) {
let tab = 'chat';
try {
const saved = store.get('more-cat');
if (saved && MORE_CATS.indexOf(saved) >= 0) tab = saved;
else if (store.get('more-tab') === 'ask') tab = 'ask'; // 旧两页签记忆迁移
} catch (err) {}
applyMoreCat(tab, false); // v3.26.x：聊天页打开面板关闭群聊过滤模式，恢复全部分类
closeIme(); // v3.5.116：收起输入法，面板不被键盘遮挡
// v3.16.x：聊天页打开共享更多面板时隐藏 @群成员 按钮（仅群聊打开时显示）
const tb = document.getElementById('gc-more-at');
if (tb) tb.hidden = true;
}
morePanel.hidden = !morePanel.hidden;
});
document.addEventListener('click', (e) => {
if (!morePanel.hidden && !morePanel.contains(e.target) && e.target !== moreBtn && !moreBtn.contains(e.target)) {
morePanel.hidden = true;
}
});
}
const pokeCard = document.getElementById('poke-card');
const pokeList = document.getElementById('poke-list');
const pokeClose = document.getElementById('poke-card-close');
const pokeName = document.getElementById('poke-partner-name');
const POKE_PRESETS = {
ta: ['拍了拍我', '戳了戳我的脸蛋', '弹了一下我的额头', '揉了揉我的头发', '捏了捏我的脸颊', '拍了拍我的肩膀'],
mine: ['拍了拍你', '戳了戳你的脸蛋', '弹了一下你的额头', '揉了揉你的头发', '捏了捏你的脸颊', '拍了拍你的肩膀']
};
function pokeUserGroupsKey(kind) { return window.activePrefix() + ':poke-groups-' + kind; }
function pokeUserGroupsLoad(kind) {
try {
const v = JSON.parse(store.get('poke-groups-' + kind) || 'null');
if (Array.isArray(v)) return v.filter(g => Array.isArray(g) && Array.isArray(g[1]));
} catch (e) {}
return null;
}
// 用户改过分组后置位：防止启动期 IDB 兜底恢复把会话内的修改回滚掉（如删光后又复活）
const pokeDirty = { ta: false, mine: false };
function pokeUserGroupsSave(kind) {
pokeDirty[kind] = true;
try {
const data = JSON.stringify(pokeUserGroups[kind]);
store.set('poke-groups-' + kind, data);
if (window.idbSet) window.idbSet(pokeUserGroupsKey(kind), data);
} catch (e) {}
}
// v3.26.x：初始化只读不写。手机端 LS 缺键（iOS 系统清理/quota 写失败脏键/启动回填
// 未完成）时，旧实现会用「默认空数据」同步回写 LS+IDB，把 IDB 备份覆盖掉——
// 「我的拍一拍」新增条目永久丢失，版本更新刷新重开即复现。数据落库只在用户
// 实际改动时发生（pokeUserGroupsSave），空默认不落盘。
function pokeUserGroupsInit(kind) {
const loaded = pokeUserGroupsLoad(kind);
if (loaded) return loaded;
let legacy = [];
try {
const v = JSON.parse(store.get('poke-user-' + kind) || 'null');
if (Array.isArray(v)) legacy = v.filter(x => typeof x === 'string' && x.trim());
} catch (e) {}
return [['我的新增', legacy]];
}
const pokeUserGroups = { ta: pokeUserGroupsInit('ta'), mine: pokeUserGroupsInit('mine') };
function pokeGroupsCardCount(groups) {
let n = 0;
(groups || []).forEach(g => { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; });
return n;
}
// IDB 兜底恢复：备份条目总数多于内存时采用。旧条件「分组数更多」在单分组数据下
// 永不成立，救不回 1 组 N 条的常见数据。会话内已改过（pokeDirty）则跳过防回滚。
function pokeAdoptFromIdb(kind) {
if (pokeDirty[kind] || !window.idbGet) return Promise.resolve(false);
return window.idbGet(pokeUserGroupsKey(kind)).then(v => {
if (!v || pokeDirty[kind]) return false;
let arr = null;
try { arr = JSON.parse(v); } catch (e) { return false; }
if (!Array.isArray(arr)) return false;
if (pokeGroupsCardCount(arr) > pokeGroupsCardCount(pokeUserGroups[kind])) {
pokeUserGroups[kind] = arr.filter(g => Array.isArray(g) && Array.isArray(g[1]));
return true;
}
return false;
}).catch(() => false);
}
function pokeAdoptAllRerender() {
Promise.all([pokeAdoptFromIdb('ta'), pokeAdoptFromIdb('mine')]).then(adopted => {
if ((adopted[0] || adopted[1]) && pokeCard && !pokeCard.hidden) renderPokeCard();
});
}
if (window.__mochiDataReady) pokeAdoptAllRerender();
else document.addEventListener('mochi-restore-done', pokeAdoptAllRerender);
function pokeKindOf(card) {
if (typeof card !== 'string') return 'mine';
if (card.indexOf('你') >= 0) return 'mine';
if (card.indexOf('我') >= 0) return 'ta';
return 'mine';
}
function pokeAllCards() {
const out = [];
(POKE_PRESETS.ta || []).forEach(x => out.push(x));
(POKE_PRESETS.mine || []).forEach(x => out.push(x));
['ta', 'mine'].forEach(kind => {
(pokeUserGroups[kind] || []).forEach(g => {
if (Array.isArray(g) && Array.isArray(g[1])) g[1].forEach(x => out.push(x));
});
});
try { ((window.getPokeCards && window.getPokeCards()) || []).forEach(x => out.push(x)); } catch (e) {}
return out;
}
let pokeMode = 'ta';            // 当前 tab：public=公用 / ta=联系人昵称的拍一拍 / mine=我的拍一拍
let pokeCurGroup = '__preset';  // 当前选中分组（'__preset' = 预设）
const pokeTabsRow = document.createElement('div');
pokeTabsRow.className = 'poke-tabs-row';
const pokeTabPub = document.createElement('button');
pokeTabPub.className = 'poke-tab poke-tab-pub';
pokeTabPub.type = 'button';
pokeTabPub.dataset.ptab = 'public';
const pokeTabTa = document.createElement('button');
pokeTabTa.className = 'poke-tab sel poke-tab-ta';
pokeTabTa.type = 'button';
pokeTabTa.dataset.ptab = 'ta';
const pokeTabMine = document.createElement('button');
pokeTabMine.className = 'poke-tab poke-tab-mine';
pokeTabMine.type = 'button';
pokeTabMine.dataset.ptab = 'mine';
pokeTabsRow.appendChild(pokeTabPub);
pokeTabsRow.appendChild(pokeTabTa);
pokeTabsRow.appendChild(pokeTabMine);
const pokeGroupsBar = document.createElement('div');
pokeGroupsBar.className = 'poke-groups';
const pokeInputRow = document.createElement('div');
pokeInputRow.className = 'poke-input-row';
const pokeInput = document.createElement('input');
pokeInput.className = 'poke-input';
pokeInput.type = 'text';
pokeInput.placeholder = '输入拍一拍文字，如：拍了拍你的脸蛋';
pokeInput.setAttribute('autocomplete', 'off');
pokeInput.setAttribute('autocorrect', 'off');
pokeInput.setAttribute('autocapitalize', 'off');
pokeInput.setAttribute('spellcheck', 'false');
const pokeInputSave = document.createElement('button');
pokeInputSave.className = 'poke-input-save';
pokeInputSave.type = 'button';
pokeInputSave.textContent = '存入';
pokeInputSave.title = '存到当前选中的分组';
const pokeInputGo = document.createElement('button');
pokeInputGo.className = 'poke-input-go';
pokeInputGo.type = 'button';
pokeInputGo.textContent = '发送';
// 存入：把输入的文字保存到当前选中分组（预设分组不可写，自动落到第一个用户分组）
function pokeTargetGroup() {
const groups = pokeUserGroups.mine;
let target = groups.find(g => g[0] === pokeCurGroup) || groups[0];
if (!target) { target = ['我的新增', []]; groups.push(target); }
return target;
}
function savePokeInput() {
const v = (pokeInput && pokeInput.value || '').trim();
if (!v) { toast('先输入拍一拍文字'); return; }
const target = pokeTargetGroup();
if (target[1].indexOf(v) >= 0) { toast('「' + target[0] + '」已有相同的拍一拍'); return; }
target[1].push(v);
pokeUserGroupsSave('mine');
pokeCurGroup = target[0];
savePokePref();
renderPokeCard();
if (pokeInput) pokeInput.value = '';
toast('已存入「' + target[0] + '」');
}
function doPokeInput() {
const v = (pokeInput && pokeInput.value || '').trim();
if (!v) { toast('先输入拍一拍文字'); return; }
sendPoke(v);
if (pokeInput) pokeInput.value = '';
closePokeCard();
}
pokeInputSave.addEventListener('click', (e) => {
e.stopPropagation();
savePokeInput();
});
pokeInputGo.addEventListener('click', (e) => {
e.stopPropagation();
doPokeInput();
});
pokeInput.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
e.stopPropagation();
doPokeInput();
}
});
pokeInputRow.appendChild(pokeInput);
pokeInputRow.appendChild(pokeInputSave);
pokeInputRow.appendChild(pokeInputGo);
if (pokeCard) {
pokeCard.insertBefore(pokeTabsRow, pokeList);
pokeCard.insertBefore(pokeGroupsBar, pokeList);
// 输入行放面板最底部（footer）：键盘弹起面板收缩时它是最后一行，离键盘最近、不会被盖住
pokeCard.appendChild(pokeInputRow);
}
function sendPoke(action) {
// v3.26.x：存 {me}/{ta} 占位符而非字面昵称——渲染 T() 回填「我的昵称 + TA 的昵称」
// （跟随改名），称呼功能（taFit）不再把昵称槽位改写成 他/ta/她
let text;
if (action.indexOf('你') >= 0) {
if (action.charAt(0) === '你') {
text = '{me}' + action.slice(1).replace(/我(?![们])/g, '{ta}');
} else if (action.charAt(0) === '我') {
text = action.replace(/你(?![们])/g, '{ta}');
} else {
text = '{me} ' + action.replace(/你(?![们])/g, '{ta}');
}
} else if (action.indexOf('我') >= 0) {
if (action.charAt(0) === '我') {
text = '{me} ' + action.slice(1).replace(/我(?![们])/g, '{ta}');
} else {
text = '{me} ' + action.replace(/我(?![们])/g, '{ta}');
}
} else {
text = '{me} ' + action;
}
addRec({ side: 'in', text: text, special: 'poke' });
if (window.logFish) window.logFish();
setTimeout(() => {
const c2 = cfg();
if (hit(c2['rn-prob'])) {
addIn('', { special: 'read' });
return;
}
showTyping();
setTimeout(() => {
hideTyping();
if (hit(c2['touch-prob'])) { performPoke(); return; }
const r = genOneReply(c2);
const m2 = addIn(r.text, { type: r.type });
if (hit(c2['rc-prob'])) {
setTimeout(() => { retractMsg(m2, 'in'); }, 900);
}
}, randInt(800, 2000));
}, randInt(600, 1200));
}
function savePokePref() {
try { store.set('poke-tab', pokeMode); } catch (e) {}
try { store.set('poke-group-' + pokeMode, pokeCurGroup); } catch (e) {}
}
(function () {
try {
const p = store.get('poke-tab');
if (p === 'mine' || p === 'public') pokeMode = p;
} catch (e) {}
try {
const g = store.get('poke-group-' + pokeMode);
if (typeof g === 'string' && g) pokeCurGroup = g;
} catch (e) {}
})();
function pokeTabLabel(kind) {
if (kind === 'public') return '公用拍一拍';
if (kind === 'ta') {
const n = chatPartnerName();
return n + ' 的拍一拍';
}
const n = chatUserName();
return (n === '我' ? '我的' : n + ' 的') + '拍一拍';
}
function pokeTabGroups(kind) {
const out = [];
if (kind === 'public' || kind === 'ta') {
let legacy = [];
try { legacy = (window.getScopedGroups && window.getScopedGroups('poke', kind)) || []; } catch (e) {}
legacy.forEach(g => {
if (!Array.isArray(g) || !Array.isArray(g[1]) || !g[0]) return;
out.push({ key: g[0], label: g[0], cards: g[1].slice() });
});
return out;
}
const presets = (POKE_PRESETS.mine || []).slice();
out.push({ key: '__preset', label: '预设', cards: presets });
(pokeUserGroups.mine || []).forEach(g => {
if (!Array.isArray(g) || !Array.isArray(g[1]) || !g[0]) return;
out.push({ key: g[0], label: g[0], cards: g[1].slice(), user: true });
});
return out;
}
function pokeCardEl(c, opts) {
const d = document.createElement('div');
d.className = 'cc-item glass';
d.innerHTML = '<div class="cc-txt"><div class="t">' + c + '</div></div>';
d.addEventListener('click', () => { sendPoke(c); closePokeCard(); });
if (opts && opts.editable) {
const ops = document.createElement('div');
ops.className = 'poke-card-ops';
const eb = document.createElement('button');
eb.type = 'button';
eb.className = 'poke-card-op poke-op-edit';
eb.title = '修改';
eb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
eb.addEventListener('click', (e) => {
e.stopPropagation();
pokeEditCard(opts.groupKey, opts.idx, c);
});
const db = document.createElement('button');
db.type = 'button';
db.className = 'poke-card-op poke-op-del';
db.title = '删除';
db.textContent = '✕';
db.addEventListener('click', (e) => {
e.stopPropagation();
pokeDelCard(opts.groupKey, opts.idx, c);
});
ops.appendChild(eb);
ops.appendChild(db);
d.appendChild(ops);
}
return d;
}
function pokeEditCard(groupKey, idx, old) {
const groups = pokeUserGroups.mine;
const g = groups.find(x => x[0] === groupKey);
if (!g || !Array.isArray(g[1]) || idx < 0 || idx >= g[1].length) return;
window.openModal('修改拍一拍', old, (v) => {
v = (v || '').trim();
if (!v) { toast('请输入拍一拍文字'); return; }
const g2 = groups.find(x => x[0] === groupKey);
if (!g2 || !Array.isArray(g2[1]) || idx < 0 || idx >= g2[1].length) return;
if (g2[1][idx] === v) { toast('内容未变化'); return; }
if (g2[1].indexOf(v) >= 0) { toast('该分组已有相同的拍一拍'); return; }
g2[1][idx] = v;
pokeUserGroupsSave('mine');
renderPokeCard();
toast('已修改');
});
}
function pokeDelCard(groupKey, idx, c) {
const groups = pokeUserGroups.mine;
const g = groups.find(x => x[0] === groupKey);
if (!g || !Array.isArray(g[1]) || idx < 0 || idx >= g[1].length) return;
window.openModal('删除这条拍一拍？', '', () => {
const g2 = groups.find(x => x[0] === groupKey);
if (!g2 || !Array.isArray(g2[1]) || idx < 0 || idx >= g2[1].length) return;
g2[1].splice(idx, 1);
pokeUserGroupsSave('mine');
renderPokeCard();
toast('已删除');
}, { noInput: true, staticText: '「' + c + '」\n\n删除后无法恢复。' });
}
function renderPokeGroupsBar(groups) {
if (!pokeGroupsBar) return;
pokeGroupsBar.innerHTML = '';
if (!groups.some(g => g.key === pokeCurGroup)) pokeCurGroup = groups.length ? groups[0].key : '__preset';
groups.forEach(g => {
const c = document.createElement('span');
c.className = 'emoji-g-chip' + (pokeCurGroup === g.key ? ' sel' : '');
c.textContent = g.label + g.cards.length;
c.addEventListener('click', (e) => {
e.stopPropagation();
pokeCurGroup = g.key;
savePokePref();
renderPokeCard();
});
pokeGroupsBar.appendChild(c);
});
if (pokeMode === 'mine') {
const add = document.createElement('span');
add.className = 'emoji-g-chip poke-g-add';
add.textContent = '＋ 分组';
add.title = '新建拍一拍分组';
add.addEventListener('click', (e) => {
e.stopPropagation();
pokeNewGroupAction();
});
pokeGroupsBar.appendChild(add);
}
}
function renderPokeCard() {
const name = chatPartnerName();
if (pokeName) pokeName.textContent = name;
pokeTabPub.textContent = pokeTabLabel('public');
pokeTabTa.textContent = pokeTabLabel('ta');
pokeTabMine.textContent = pokeTabLabel('mine');
pokeTabPub.classList.toggle('sel', pokeMode === 'public');
pokeTabTa.classList.toggle('sel', pokeMode === 'ta');
pokeTabMine.classList.toggle('sel', pokeMode === 'mine');
if (pokeInputRow) pokeInputRow.hidden = pokeMode !== 'mine';
pokeInput.placeholder = '输入拍一拍文字，如：拍了拍你的脸蛋';
const groups = pokeTabGroups(pokeMode);
renderPokeGroupsBar(groups);
if (!pokeList) return;
pokeList.innerHTML = '';
if (!groups.length) {
pokeList.innerHTML = pokeMode === 'public'
? '<div class="cc-empty">暂无公用拍一拍<br>请到 字卡库 → 公用字卡 → 拍一拍 添加</div>'
: pokeMode === 'ta'
? '<div class="cc-empty">暂无拍一拍字卡<br>请到 字卡库 → 专属字卡 → 拍一拍 添加</div>'
: '<div class="cc-empty">暂无拍一拍字卡<br>在下方输入文字，点「存入」添加</div>';
return;
}
const cur = groups.find(g => g.key === pokeCurGroup) || groups[0];
if (!cur.cards.length) {
pokeList.innerHTML = pokeMode === 'public'
? '<div class="cc-empty">该分组暂无公用拍一拍<br>请到 字卡库 → 公用字卡 → 拍一拍 添加</div>'
: pokeMode === 'ta'
? '<div class="cc-empty">该分组暂无拍一拍字卡<br>请到 字卡库 → 专属字卡 → 拍一拍 添加</div>'
: '<div class="cc-empty">该分组暂无拍一拍<br>在下方输入文字，点「存入」添加到该分组</div>';
return;
}
cur.cards.forEach((c, i) => {
const editable = pokeMode === 'mine' && cur.key !== '__preset' && cur.user;
pokeList.appendChild(pokeCardEl(c, editable ? { editable: true, groupKey: cur.key, idx: i } : null));
});
}
function closePokeCard() {
if (pokeCard) pokeCard.hidden = true;
}
pokeTabPub.addEventListener('click', (e) => {
e.stopPropagation();
if (pokeMode !== 'public') { pokeMode = 'public'; savePokePref(); renderPokeCard(); }
});
pokeTabTa.addEventListener('click', (e) => {
e.stopPropagation();
if (pokeMode !== 'ta') { pokeMode = 'ta'; savePokePref(); renderPokeCard(); }
});
pokeTabMine.addEventListener('click', (e) => {
e.stopPropagation();
if (pokeMode !== 'mine') { pokeMode = 'mine'; savePokePref(); renderPokeCard(); }
});
// 新建分组：入口在分组栏尾部的「＋ 分组」chip（renderPokeGroupsBar），仅我的拍一拍显示
function pokeNewGroupAction() {
window.openModal('新建拍一拍分组（当前为「' + pokeTabLabel(pokeMode) + '」）', '', (v) => {
v = (v || '').trim();
if (!v) { toast('请输入分组名'); return; }
const groups = pokeUserGroups[pokeMode];
if (groups.some(g => g[0] === v)) { toast('分组「' + v + '」已存在'); return; }
groups.push([v, []]);
pokeUserGroupsSave(pokeMode);
pokeCurGroup = v;
savePokePref();
renderPokeCard();
toast('已新建分组「' + v + '」');
});
}
document.addEventListener('contact-switched', function () {
try { pokeDirty.ta = false; pokeDirty.mine = false; pokeUserGroups.ta = pokeUserGroupsInit('ta'); pokeUserGroups.mine = pokeUserGroupsInit('mine'); pokeAdoptAllRerender(); } catch (e) {}
try { if (pokeCard) pokeCard.hidden = true; } catch (e) {}
});
const morePoke = document.getElementById('more-poke');
if (morePoke) {
morePoke.addEventListener('click', (e) => {
e.stopPropagation();
openPokeCard();
});
}
const rpsPanel = document.getElementById('chat-rps-panel');
const rpsCloseBtn = document.getElementById('chat-rps-close');
const rpsScoreEl = document.getElementById('rps-score');
const rpsHintEl = document.getElementById('rps-hint');
const rpsNameEl = document.getElementById('rps-partner-name');
function rpsReadScore() {
try { return JSON.parse(store.get('rps-score') || '{"w":0,"l":0,"d":0}'); }
catch (e) { return { w: 0, l: 0, d: 0 }; }
}
function rpsWriteScore(s) { store.set('rps-score', JSON.stringify(s)); }
function rpsRenderScore() {
if (!rpsScoreEl) return;
const s = rpsReadScore();
rpsScoreEl.textContent = '胜 ' + s.w + ' · 负 ' + s.l + ' · 平 ' + s.d;
}
function openRpsPanel() {
if (!rpsPanel) return;
const pc = document.getElementById('poke-card'); if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel'); if (ep) ep.hidden = true;
const askP = document.getElementById('chat-ask-panel'); if (askP) closeChatAskPanel();
const cs = document.getElementById('chat-search'); if (cs) cs.hidden = true;
const dv = document.getElementById('chat-divine-panel'); if (dv) dv.hidden = true;
const dp = document.getElementById('chat-decision-panel'); if (dp) dp.hidden = true;
if (window.closeAvlib) window.closeAvlib();
if (morePanel) morePanel.hidden = true;
if (rpsNameEl) rpsNameEl.textContent = chatPartnerName();
if (rpsHintEl) rpsHintEl.textContent = '选择你要出的拳';
rpsRenderScore();
rpsPanel.hidden = false;
}
function closeRpsPanel() { if (rpsPanel) rpsPanel.hidden = true; }
// v3.16.x：导出到 window——联系人猜拳邀请同意后 openInvitePanelFor 走 window.openRpsPanel，
// 此前只导出 pong/snake 忘了 rps，导致猜拳邀请同意后不开面板（历史 bug，自 v3.13.x 引入）
window.openRpsPanel = openRpsPanel;
window.closeRpsPanel = closeRpsPanel;
function rpsJudge(a, b) {
if (a === b) return 0;
if ((a === 'rock' && b === 'scissors') ||
(a === 'scissors' && b === 'paper') ||
(a === 'paper' && b === 'rock')) return 1;
return -1;
}
function sendRps(mine) {
closeRpsPanel();
const mineName = { rock: '石头', scissors: '剪刀', paper: '布' }[mine] || '';
addRec({ side: 'in', special: 'poke', text: '我出了 ' + mineName + '，等 TA 出拳…' });
showTyping();
setTimeout(() => {
hideTyping();
const ta = ['rock', 'scissors', 'paper'][Math.floor(Math.random() * 3)];
const judge = rpsJudge(mine, ta);
const s = rpsReadScore();
if (judge > 0) s.w++; else if (judge < 0) s.l++; else s.d++;
rpsWriteScore(s);
addRec({ side: 'in', special: 'rps', rpsMine: mine, rpsTa: ta, rpsResult: judge });
// v3.15.x 二调：奖励对齐红包金额体系——胜 70% ¥5.2 / 30% ¥13.14，平 ¥1.3（日封顶 ¥26）
// v3.16.x：石头剪刀布改为双方同步同额入账（不再只给赢家），记赚钱流水「石头剪刀布」
try {
const rpsWinFen = Math.random() < 0.3 ? 1314 : 520;
const real = rpGameCoinGrant('rps', judge > 0 ? rpsWinFen : judge < 0 ? 520 : 130, 2600);
if (real > 0) {
const w = rpWalletGet();
w.myBalance += real; w.systemBalance += real;
rpWalletSet(w);
try { if (window.giftCoinLedgerAdd) window.giftCoinLedgerAdd('earn', real, real, '石头剪刀布'); } catch (e2) {}
setTimeout(() => addIn('🪙 双方心意币各 +¥' + (real / 100).toFixed(2), { special: 'poke' }), randInt(800, 1600));
}
} catch (e) {}
if (window.logFish) window.logFish();
}, randInt(900, 1600));
}
const moreRps = document.getElementById('more-rps');
if (moreRps) {
moreRps.addEventListener('click', (e) => { e.stopPropagation(); openRpsPanel(); });
}
if (rpsCloseBtn) {
rpsCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeRpsPanel(); });
}
if (rpsPanel) {
rpsPanel.querySelectorAll('.rps-choice').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
const v = btn.dataset.rps;
if (v) sendRps(v);
});
});
}
const rpPanel = document.getElementById('chat-rp-panel');
const rpCloseBtn = document.getElementById('chat-rp-close');
const rpNameEl = document.getElementById('rp-partner-name');
const rpQixiTag = document.getElementById('rp-qixi-tag');
const rpQixiSection = document.getElementById('rp-qixi-section');
const rpRandVal = document.getElementById('rp-rand-val');
const rpCustomInput = document.getElementById('rp-custom');
const rpWishInput = document.getElementById('rp-wish');
const rpSendBtn = document.getElementById('rp-send-btn');
let rpSide = 'out';
let rpPickedAmt = null;
const QIXI_DATES = ['2024-08-10','2025-08-29','2026-08-19','2027-08-08','2028-08-26','2029-08-15','2030-08-04'];
function isQixiToday() {
const d = new Date();
const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
return QIXI_DATES.indexOf(k) >= 0;
}
function openRpPanel() {
if (!rpPanel) return;
const pc = document.getElementById('poke-card'); if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel'); if (ep) ep.hidden = true;
const askP = document.getElementById('chat-ask-panel'); if (askP) closeChatAskPanel();
const cs = document.getElementById('chat-search'); if (cs) cs.hidden = true;
const dv = document.getElementById('chat-divine-panel'); if (dv) dv.hidden = true;
const dp = document.getElementById('chat-decision-panel'); if (dp) dp.hidden = true;
const rpsP = document.getElementById('chat-rps-panel'); if (rpsP) rpsP.hidden = true;
if (window.closeAvlib) window.closeAvlib();
if (morePanel) morePanel.hidden = true;
if (rpNameEl) rpNameEl.textContent = chatPartnerName();
if (isQixiToday()) {
if (rpQixiTag) rpQixiTag.hidden = false;
if (rpQixiSection) { rpQixiSection.hidden = false; rpQixiSection.classList.add('qixi-today'); }
if (rpWishInput) rpWishInput.placeholder = '七夕快乐';
} else {
if (rpQixiTag) rpQixiTag.hidden = true;
if (rpQixiSection) { rpQixiSection.hidden = true; rpQixiSection.classList.remove('qixi-today'); }
if (rpWishInput) rpWishInput.placeholder = '心意';
}
rpSide = 'out';
rpPickedAmt = null;
if (rpCustomInput) rpCustomInput.value = '';
if (rpWishInput) rpWishInput.value = '';
if (rpRandVal) rpRandVal.textContent = '';
rpPanel.querySelectorAll('.rp-side').forEach(b => b.classList.toggle('sel', b.dataset.rpside === 'out'));
rpPanel.querySelectorAll('.rp-amt').forEach(b => b.classList.remove('sel'));
closeIme();
rpRenderBalance();
rpRenderCover();
rpPanel.hidden = false;
}
function closeRpPanel() { if (rpPanel) rpPanel.hidden = true; }
if (rpPanel) {
rpPanel.querySelectorAll('.rp-side').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
rpSide = btn.dataset.rpside || 'out';
rpPanel.querySelectorAll('.rp-side').forEach(b => b.classList.toggle('sel', b === btn));
rpRenderCover();
});
});
rpPanel.querySelectorAll('.rp-amt').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
const v = btn.dataset.rpamt;
if (v === 'rand') {
const r = Math.round(Math.random() * 20000 + 1) / 100;
rpPickedAmt = r;
if (rpRandVal) rpRandVal.textContent = '本次随机：¥' + r.toFixed(2);
if (rpCustomInput) rpCustomInput.value = '';
rpPanel.querySelectorAll('.rp-amt').forEach(b => b.classList.remove('sel'));
btn.classList.add('sel');
return;
}
rpPickedAmt = parseFloat(v);
if (rpRandVal) rpRandVal.textContent = '';
if (rpCustomInput) rpCustomInput.value = '';
rpPanel.querySelectorAll('.rp-amt').forEach(b => b.classList.remove('sel'));
btn.classList.add('sel');
});
});
if (rpCustomInput) {
rpCustomInput.addEventListener('input', () => {
rpPanel.querySelectorAll('.rp-amt').forEach(b => b.classList.remove('sel'));
if (rpRandVal) rpRandVal.textContent = '';
});
}
}
// v3.15.x 二轮：钱包读写委托 gift-shop 的【全局一本账】（根键 xy-home-v2:gift-wallet，跨桌面共用）；
// 本地 ns 逻辑仅作 gift-shop 未加载时的兜底。新用户默认双方各 ¥520。
const RP_WALLET_KEY = 'gift-wallet';
const RP_LEGACY_WALLET_KEY = 'rp-wallet';
const RP_WALLET_DEFAULT_FEN = 52000;
const RP_DAILY_PREFIX = 'ml2_rp_daily_';
function rpWalletGet() {
if (typeof window.giftWalletGet === 'function') return window.giftWalletGet();
try {
const w = JSON.parse(store.get(RP_WALLET_KEY) || '');
if (typeof w.myBalance === 'number' && typeof w.systemBalance === 'number') {
if (w.myBalance === 99999999 && w.systemBalance === 99999999) {
const nw = { myBalance: RP_WALLET_DEFAULT_FEN, systemBalance: RP_WALLET_DEFAULT_FEN };
store.set(RP_WALLET_KEY, JSON.stringify(nw));
return nw;
}
return w;
}
} catch (e) {}
let seed = { myBalance: RP_WALLET_DEFAULT_FEN, systemBalance: RP_WALLET_DEFAULT_FEN };
try {
const o = JSON.parse(store.get(RP_LEGACY_WALLET_KEY) || '');
if (typeof o.myBalance === 'number' && typeof o.systemBalance === 'number') seed = { myBalance: o.myBalance, systemBalance: o.systemBalance };
} catch (e) {}
store.set(RP_WALLET_KEY, JSON.stringify(seed));
return seed;
}
function rpWalletSet(w) {
if (typeof window.giftWalletSet === 'function') { window.giftWalletSet(w); return; }
store.set(RP_WALLET_KEY, JSON.stringify(w));
}
const RP_EXPIRY_MS = 24 * 60 * 60 * 1000;
const RP_SPECIAL_FEN = [520, 5200, 52000, 520000, 1314, 131400]; // 5.2/52/520/5200/13.14/1314 元
function rpDailyCount() {
const k = RP_DAILY_PREFIX + new Date().toISOString().slice(0, 10);
return Number(store.get(k)) || 0;
}
function rpDailyIncr() {
const k = RP_DAILY_PREFIX + new Date().toISOString().slice(0, 10);
store.set(k, String((Number(store.get(k)) || 0) + 1));
}
// v3.15.x：小游戏联动心意币——按日封顶发放（fen），返回实际入账分值（0=今日已到顶）
function rpGameCoinGrant(gameKey, fen, capFen) {
if (!fen || fen <= 0) return 0;
const k = 'ml2_coin_' + gameKey + '_' + new Date().toISOString().slice(0, 10);
const cur = Number(store.get(k)) || 0;
if (cur >= capFen) return 0;
const real = Math.min(fen, capFen - cur);
store.set(k, String(cur + real));
return real;
}
function rpCoinTxt(real, toTa) {
return '🪙 ' + (toTa ? chatPartnerName() + ' 的心意币' : '我的心意币') + ' +¥' + (real / 100).toFixed(2);
}
function genRpAmount(systemBalanceFen) {
let amt;
if (Math.random() < 0.4) {
amt = RP_SPECIAL_FEN[Math.floor(Math.random() * RP_SPECIAL_FEN.length)];
} else if (Math.random() < 0.8) {
const max = Math.min(5200000, systemBalanceFen); // 52000 元 = 5200000 分
amt = Math.floor(Math.random() * max) + 1;
} else {
amt = Math.floor(Math.random() * systemBalanceFen) + 1;
}
return Math.min(amt, systemBalanceFen);
}
function rpStatusText(rec) {
const st = rec.rpStatus || 'pending';
if (st === 'received') return '已领取';
if (st === 'expired') return '已过期·退回';
if (st === 'returned') return '已退回';
return rec.side === 'in' ? '待领取' : (window.taFit ? window.taFit('待TA领取') : '待TA领取');
}
function rpStatusCls(rec) {
const st = rec.rpStatus || 'pending';
if (st === 'received') return 'opened';
if (st === 'expired' || st === 'returned') return 'expired';
return '';
}
function trySystemAutoSend() {
if (rpDailyCount() >= 5) return;
const qixi = isQixiToday();
const baseRate = qixi ? 0.08 : 0.04;
if (Math.random() >= baseRate) return;
// v3.15.x：TA 自动红包不再受余额约束——余额不足也照发（可透支为负），金额上限维持原 ¥52000 档
let amtFen, wish;
if (qixi && Math.random() < 0.6) {
const qixiPool = [777, 7777, 77777];
if (qixiPool.length) {
amtFen = pick(qixiPool);
wish = pick(['七夕快乐', '七夕快乐呀', '宝宝七夕快乐', '今天七夕，给你花']);
} else {
amtFen = genRpAmount(5200000);
wish = '七夕快乐';
}
} else {
amtFen = genRpAmount(5200000);
wish = pick(['心意', '给你花', '小礼物', '辛苦啦', '开心一下']);
}
if (amtFen < 1) return;
const wallet = rpWalletGet();
wallet.systemBalance -= amtFen;
rpWalletSet(wallet);
rpDailyIncr();
const amt = amtFen / 100;
const myCid = window.__activeCid || 'default';
setTimeout(() => {
if ((window.__activeCid || 'default') !== myCid) return;
addIn('', { special: 'redpacket', rpAmount: amt, rpWish: wish, rpStatus: 'pending', rpTs: Date.now(), rpCover: rpCoverGet('in') ? 1 : 0 });
if (window.logFish) window.logFish();
}, randInt(800, 2000));
}
const ASK_DAILY_PREFIX = 'ml2_ask_daily_';
function askDailyCount() {
const k = ASK_DAILY_PREFIX + new Date().toISOString().slice(0, 10);
return Number(store.get(k)) || 0;
}
function askDailyIncr() {
const k = ASK_DAILY_PREFIX + new Date().toISOString().slice(0, 10);
store.set(k, String((Number(store.get(k)) || 0) + 1));
}
// v3.15.x：TA 也会随机「向 Mochi 申请」心意币——金额与红包同款随机分布（genRpAmount），
// 概率门读取存钱罐右上角设置的申请概率（默认 4%，不沿用红包七夕加成），无次数上限；
// 入 TA 的 systemBalance，聊天留 askcoin 卡片
function trySystemAskMochi() {
let baseRate = 0.04;
try { const p = JSON.parse((window.xyStore('xy-home-v2')).get('piggy-coin-prob') || 'null'); if (p && typeof p.ask === 'number') baseRate = p.ask; } catch (e) {}
if (Math.random() >= baseRate) return;
const amtFen = genRpAmount(5200000);
if (amtFen < 1) return;
	askDailyIncr();
	const wallet = rpWalletGet();
	wallet.systemBalance += amtFen;
	rpWalletSet(wallet);
	// v3.16.x：TA 自动申请同步记入主页申请流水
	try { if (window.giftCoinLedgerAdd) window.giftCoinLedgerAdd('ask', 0, amtFen, 'TA自动申请'); } catch (e) {}
	const myCid = window.__activeCid || 'default';
setTimeout(() => {
if ((window.__activeCid || 'default') !== myCid) return;
addRec({ side: 'in', special: 'askcoin', askFen: amtFen, askTs: Date.now() });
saveMsgsNow();
}, randInt(800, 2400));
}
// 回前台补触发（与 ta-ask 同款通道），避免后台期间错过的申请永远丢失
document.addEventListener('mochi-fg-resume', function () {
try { if (!sameCid()) return; setTimeout(function () { trySystemAskMochi(); }, randInt(2000, 6000)); } catch (e) {}
});
function rpThanksMsg() {
return pick(['谢谢亲爱的～', '收到啦❤', '嘿嘿谢谢宝宝', '爱你哟', '🥰 谢谢', '开心！谢谢～', '么么哒']);
}
function rpCollectFeedback() {
const myCid = window.__activeCid || 'default';
const r = Math.random();
if (r < 0.5) {
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; addIn(rpThanksMsg(), { silent: true }); }, randInt(600, 1800));
} else if (r < 0.8) {
setTimeout(() => {
if ((window.__activeCid || 'default') !== myCid) return;
try {
const c = cfg();
const rep = genOneReply(c);
addIn(rep.text, { type: rep.type, parts: rep.parts });
} catch (e) {}
}, randInt(800, 2000));
}
}
function handleSendResponse(msg) {
const idx = msgs.indexOf(msg);
if (idx < 0) return;
const rec = msgs[idx];
if (!rec || rec.rpStatus !== 'pending') return;
const myCid = window.__activeCid || 'default';
const r = Math.random();
const wallet = rpWalletGet();
const amtFen = Math.round((rec.rpAmount || 0) * 100);
if (r < 0.2) {
rec.rpStatus = 'returned';
wallet.myBalance += amtFen;
rpWalletSet(wallet);
saveMsgsNow();
renderWindow(false, true);
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; addIn('TA 退回了你的红包（心意币 ¥' + Number(rec.rpAmount || 0).toFixed(2) + '）', { special: 'poke' }); }, randInt(500, 1200));
} else if (r < 0.9) {
rec.rpStatus = 'received';
rec.rpOpenedAt = Date.now();
wallet.systemBalance += amtFen;
rpWalletSet(wallet);
saveMsgsNow();
renderWindow(false, true);
const amtTxt = '（心意币 ¥' + Number(rec.rpAmount || 0).toFixed(2) + '）';
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; addIn('TA 领取了你的红包' + amtTxt, { special: 'poke' }); }, randInt(400, 1000));
rpCollectFeedback();
}
}
function tryCollectPending() {
if (Math.random() >= 0.08) return;
const idx = msgs.findIndex(m => m && m.special === 'redpacket' && m.side === 'out' && m.rpStatus === 'pending');
if (idx < 0) return;
const rec = msgs[idx];
rec.rpStatus = 'received';
rec.rpOpenedAt = Date.now();
const wallet = rpWalletGet();
wallet.systemBalance += Math.round((rec.rpAmount || 0) * 100);
rpWalletSet(wallet);
saveMsgsNow();
renderWindow(false, true);
const amtTxt = '（心意币 ¥' + Number(rec.rpAmount || 0).toFixed(2) + '）';
const myCid = window.__activeCid || 'default';
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; addIn('TA 领取了你的红包' + amtTxt, { special: 'poke' }); }, randInt(400, 1000));
rpCollectFeedback();
}
function rpExpireCheck() {
const now = Date.now();
const wallet = rpWalletGet();
let changed = false;
for (let i = 0; i < msgs.length; i++) {
const rec = msgs[i];
if (rec && rec.special === 'redpacket' && rec.rpStatus === 'pending' && rec.rpTs) {
if (now - rec.rpTs > RP_EXPIRY_MS) {
rec.rpStatus = 'expired';
rec.expiredAt = now;
const amtFen = Math.round((rec.rpAmount || 0) * 100);
if (rec.side === 'out') wallet.myBalance += amtFen;
else wallet.systemBalance += amtFen;
changed = true;
}
}
}
if (changed) { rpWalletSet(wallet); saveMsgsNow(); }
}
function rpRenderBalance() {
const el = document.getElementById('rp-balance');
if (!el) return;
const w = rpWalletGet();
el.textContent = '心意币 ¥' + (w.myBalance / 100).toFixed(2) + ' · ' + chatPartnerName() + ' ¥' + (w.systemBalance / 100).toFixed(2) + ' · 向 Mochi 申请心意币';
}
// v3.15.x：余额行改为「向 Mochi 申请心意币」——不再直接改账本数值；
// 选收款方（我/TA）输入申请金额，确定即模拟 Mochi 打款并入账（累加），留空点【完成】结束
function rpEditWallet() {
if (!window.openModal) return;
const taName = window.taFit ? window.taFit('TA') : 'TA';
const LBL = { my: '我的心意币', ta: taName + '的心意币' };
let side = 'my';
let doneAny = false;
const fmtYuan = (n) => (Math.round(n * 100) / 100).toFixed(2);
const hintTxt = () => {
const w = rpWalletGet();
return '当前：心意币 ¥' + (w.myBalance / 100).toFixed(2) + ' · ' + taName + ' ¥' + (w.systemBalance / 100).toFixed(2) +
(doneAny ? '\n已到账，可继续为' + LBL[side] + '申请；留空点【完成】结束' : '\n选择收款方，输入申请金额点【申请】，Mochi 打款后自动入账；留空点【完成】结束');
};
let ctl = null;
ctl = window.openModal('向 Mochi 申请心意币', '', (arg) => {
const picked = (arg === 'my' || arg === 'ta');
const el = document.getElementById('modal-input');
const raw = String(picked ? ((el && el.value) || '') : (arg == null ? '' : arg)).trim();
const target = picked ? arg : side;
if (raw === '') return; // 留空确定 = 结束本次申请（stay 未置位，正常关闭）
const n = parseFloat(raw);
if (isNaN(n) || n <= 0) { toast('申请金额需大于 0'); return; }
const fen = Math.round(n * 100);
const w = rpWalletGet();
	if (target === 'my') w.myBalance += fen;
	else w.systemBalance += fen;
	rpWalletSet(w); rpRenderBalance();
	// v3.16.x：聊天侧申请同步记入主页申请流水
	try { if (window.giftCoinLedgerAdd) window.giftCoinLedgerAdd('ask', target === 'my' ? fen : 0, target === 'ta' ? fen : 0, '聊天申请'); } catch (e) {}
	toast('Mochi 已打款，' + LBL[target] + ' +¥' + fmtYuan(fen / 100));
doneAny = true;
side = target === 'my' ? 'ta' : 'my';
if (ctl) {
ctl.stay();
const pbs = document.querySelectorAll('#modal-pills .pill');
const flip = pbs[side === 'my' ? 0 : 1];
if (flip) flip.click(); // 同步胶囊高亮与内部选中态（下一轮确认仍走 pills 分支）
ctl.text('');
ctl.hint(hintTxt());
ctl.okText('完成');
}
}, {
staticText: hintTxt(),
pills: [{ value: 'my', label: '我的心意币' }, { value: 'ta', label: taName + ' 的心意币' }],
pill: 'my',
placeholder: '输入申请金额（元），留空结束',
inputmode: 'decimal'
});
if (ctl) ctl.okText('申请');
}
const rpBalanceEl = document.getElementById('rp-balance');
if (rpBalanceEl) rpBalanceEl.addEventListener('click', (e) => { e.stopPropagation(); rpEditWallet(); });
function rpCoverKey(side) { return 'rp-cover-' + (side || 'out'); }
function rpCoverGet(side) { return store.get(rpCoverKey(side)) || ''; }
function rpCoverSet(side, dataUrl) {
	const k = rpCoverKey(side);
	if (dataUrl) {
		store.set(k, dataUrl);
		try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + k, dataUrl); } catch (e) {}
	} else {
		try { store.remove(k); } catch (e) {}
		try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + k, ''); } catch (e) {}
	}
}
function rpCompressCover(dataUrl) {
return new Promise((resolve) => {
const img = new Image();
img.onload = () => {
try {
const scale = Math.min(1, 400 / Math.max(img.width, img.height));
const w = Math.max(1, Math.round(img.width * scale));
const h = Math.max(1, Math.round(img.height * scale));
const c = document.createElement('canvas');
c.width = w; c.height = h;
c.getContext('2d').drawImage(img, 0, 0, w, h);
resolve(c.toDataURL('image/jpeg', 0.8));
} catch (e) { resolve(null); }
};
img.onerror = () => resolve(null);
img.src = dataUrl;
});
}
const rpCoverPreview = document.getElementById('rp-cover-preview');
const rpCoverUploadBtn = document.getElementById('rp-cover-upload');
const rpCoverDelBtn = document.getElementById('rp-cover-del');
let rpCoverFileInput = null;
function rpRenderCover() {
	const side = rpSide;
	const cover = rpCoverGet(side);
	const who = side === 'out' ? '我的' : (chatPartnerName() + '的');
	if (rpCoverUploadBtn) rpCoverUploadBtn.textContent = '上传' + who + '封面';
	if (rpCoverDelBtn) rpCoverDelBtn.textContent = '删除' + who + '封面';
	if (cover) {
		if (rpCoverPreview) {
			rpCoverPreview.style.backgroundImage = 'url("' + cover + '")';
			const sp = rpCoverPreview.querySelector('span'); if (sp) sp.style.display = 'none';
		}
		if (rpCoverDelBtn) rpCoverDelBtn.hidden = false;
	} else {
		if (rpCoverPreview) {
			rpCoverPreview.style.backgroundImage = '';
			const sp = rpCoverPreview.querySelector('span'); if (sp) { sp.style.display = ''; sp.textContent = '未设置' + who + '封面'; }
		}
		if (rpCoverDelBtn) rpCoverDelBtn.hidden = true;
	}
}
if (rpCoverUploadBtn) {
rpCoverUploadBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (!rpCoverFileInput) {
rpCoverFileInput = document.createElement('input');
rpCoverFileInput.type = 'file';
rpCoverFileInput.accept = 'image/*';
rpCoverFileInput.addEventListener('change', () => {
const f = rpCoverFileInput.files[0];
if (!f) return;
const reader = new FileReader();
reader.onload = () => {
rpCompressCover(reader.result).then(data => {
if (!data) { toast('图片处理失败'); return; }
rpCoverSet(rpSide, data);
rpRenderCover();
toast('封面已设置');
});
};
reader.readAsDataURL(f);
rpCoverFileInput.value = '';
});
}
rpCoverFileInput.click();
});
}
if (rpCoverDelBtn) {
rpCoverDelBtn.addEventListener('click', (e) => {
e.stopPropagation();
rpCoverSet(rpSide, '');
rpRenderCover();
toast('已恢复默认封面');
});
}
function sendRedpacket() {
let amt = rpPickedAmt;
if (rpCustomInput && rpCustomInput.value) {
const cv = parseFloat(rpCustomInput.value);
if (!isNaN(cv) && cv >= 0) amt = Math.round(cv * 100) / 100;
}
if (amt == null || isNaN(amt) || amt < 0) { toast('先选择或输入红包金额'); return; }
const wish = (rpWishInput && rpWishInput.value || '').trim() || (isQixiToday() ? '七夕快乐' : '心意');
const amtFen = Math.round(amt * 100);
// v3.15.x：余额不足也照发——心意币直接透支为负数，不再拦截
const wallet = rpWalletGet();
if (rpSide === 'out') {
wallet.myBalance -= amtFen;
} else {
wallet.systemBalance -= amtFen;
}
rpWalletSet(wallet);
const cover = rpCoverGet(rpSide);
const rec = { side: rpSide, special: 'redpacket', rpAmount: amt, rpWish: wish, rpStatus: 'pending', rpTs: Date.now(), rpCover: cover ? 1 : 0 };
addRec(rec);
if (window.logFish) window.logFish();
if (rpSide === 'out') {
setTimeout(() => handleSendResponse(rec), randInt(3000, 8000));
}
closeRpPanel();
}
if (rpSendBtn) rpSendBtn.addEventListener('click', (e) => { e.stopPropagation(); sendRedpacket(); });
if (rpCloseBtn) rpCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeRpPanel(); });
const moreRp = document.getElementById('more-rp');
if (moreRp) {
moreRp.addEventListener('click', (e) => { e.stopPropagation(); openRpPanel(); });
}
const chatDivinePanel = document.getElementById('chat-divine-panel');
const chatDivineBody = document.getElementById('chat-divine-body');
const chatDivineClose = document.getElementById('chat-divine-close');
let chatDivineMode = 'tarot';
let chatDivineCount = 3;
function openChatDivine() {
if (!chatDivinePanel) return;
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel');
if (ep) ep.hidden = true;
const askP = document.getElementById('chat-ask-panel');
if (askP) closeChatAskPanel();
const cs = document.getElementById('chat-search');
if (cs) cs.hidden = true;
if (window.closeAvlib) window.closeAvlib();
chatDivinePanel.hidden = false;
try {
const chatAuto = document.getElementById('div-chat-auto-send');
if (chatAuto) chatAuto.checked = !!(window.divineAutoGet && window.divineAutoGet());
} catch (err) {}
try {
const histList = document.getElementById('div-chat-history');
if (histList && !histList.hidden && window.divineHistLoad) renderChatHistory();
} catch (err) {}
try { if (window.divineRenderTargets) window.divineRenderTargets('div-chat-targets'); } catch (err) {}
}
const moreDivine = document.getElementById('more-divine');
if (moreDivine) {
moreDivine.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
openChatDivine();
});
}
if (chatDivineClose) chatDivineClose.addEventListener('click', (e) => { e.stopPropagation(); chatDivinePanel.hidden = true; });
if (chatDivineBody) {
chatDivineBody.querySelectorAll('[data-chatmode]').forEach(b => {
b.addEventListener('click', (e) => {
e.stopPropagation();
chatDivineMode = b.getAttribute('data-chatmode');
chatDivineBody.querySelectorAll('[data-chatmode]').forEach(x => x.classList.toggle('sel', x === b));
if (chatDrawCancel) { try { chatDrawCancel(); } catch (err) {} chatDrawCancel = null; }
const drawBtn2 = document.getElementById('div-chat-draw');
if (drawBtn2) drawBtn2.textContent = '抽牌';
const r = document.getElementById('div-chat-result');
if (r) r.innerHTML = '<div class="div-result-empty">点击上方按钮开始抽牌</div>';
});
});
chatDivineBody.querySelectorAll('[data-chatcount]').forEach(b => {
b.addEventListener('click', (e) => {
e.stopPropagation();
chatDivineCount = Number(b.getAttribute('data-chatcount'));
chatDivineBody.querySelectorAll('[data-chatcount]').forEach(x => x.classList.toggle('sel', x === b));
if (chatDrawCancel) { try { chatDrawCancel(); } catch (err) {} chatDrawCancel = null; }
const drawBtn2 = document.getElementById('div-chat-draw');
if (drawBtn2) drawBtn2.textContent = '抽牌';
const r = document.getElementById('div-chat-result');
if (r) r.innerHTML = '<div class="div-result-empty">点击上方按钮开始抽牌</div>';
});
});
function renderChatHistory() {
const listEl = document.getElementById('div-chat-history');
if (!listEl) return;
let list = [];
try { list = (window.divineHistLoad && window.divineHistLoad()) || []; } catch (err) {}
if (!Array.isArray(list)) list = [];
if (!list.length) {
listEl.innerHTML = '<div class="div-result-empty" style="padding:14px 0">暂无占卜记录</div>';
return;
}
const fmt = (ts) => {
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
};
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
listEl.innerHTML = list.map((h, i) =>
'<div class="div-chat-hist-item">' +
'<div class="div-chat-hist-q">' + (h.mode === 'tarot' ? '塔罗' : '雷诺曼') + ' · ' + h.count + ' 张' +
(h.question ? ' · 问：' + esc(h.question) : '') + '</div>' +
'<div class="div-chat-hist-meta">' + fmt(h.ts) + ' · ' +
(Array.isArray(h.cards) ? h.cards.map(c => esc((c && c.name) || '') + (c && c.rev ? '(逆)' : '')).join('、') : '') +
'</div>' +
'<div class="div-chat-hist-acts">' +
'<button class="div-chat-hist-view" data-hi="' + i + '">查看</button>' +
'<button class="div-chat-hist-del" data-hi="' + i + '">删除</button>' +
'</div></div>').join('');
listEl.querySelectorAll('.div-chat-hist-view').forEach(b2 => b2.addEventListener('click', (e) => {
e.stopPropagation();
let cur = [];
try { cur = (window.divineHistLoad && window.divineHistLoad()) || []; } catch (err) {}
const h = cur[parseInt(b2.dataset.hi, 10)];
if (h && Array.isArray(h.cards)) {
const sr = document.getElementById('div-chat-result');
if (sr) { sr.innerHTML = chatDivineResultHtml(h.cards, h.mode, h.question, h.summary || ''); bindChatCopy(sr, h.cards, h.mode, h.question, h.summary || ''); }
}
}));
listEl.querySelectorAll('.div-chat-hist-del').forEach(b2 => b2.addEventListener('click', (e) => {
e.stopPropagation();
let cur = [];
try { cur = (window.divineHistLoad && window.divineHistLoad()) || []; } catch (err) {}
cur.splice(parseInt(b2.dataset.hi, 10), 1);
if (window.divineHistSave) { try { window.divineHistSave(cur); } catch (err) {} }
renderChatHistory();
}));
}
function chatDivineResultHtml(cards, mode, question, summary) {
const icons = mode === 'tarot' ? (window.__TAROT_ICONS__ || {}) : (window.__LENO_ICONS__ || {});
const labels = ((window.__MODE_LABELS__ || {})[mode] || {})[cards.length] || [];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let html = '<div class="div-spread">';
cards.forEach((c, i) => {
html += '<div class="div-mini">' +
(labels[i] ? '<div class="div-mini-tag">' + labels[i] + '</div>' : '') +
'<div class="div-card-face">' +
'<div class="div-card-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (icons[c.icon] || '') + '</svg></div>' +
'<div class="div-card-name">' + esc(c.name) + (c.rev ? '（逆）' : '') + '</div>' +
'</div>' +
'<div class="div-card-meaning">' + esc(c.meaning) + '</div>' +
'</div>';
});
html += '</div>';
if (summary) html += '<div class="div-summary">' + esc(summary) + '</div>';
if (question) html += '<div class="div-card-meaning" style="opacity:.6;text-align:center;margin-top:8px">问：' + esc(question) + '</div>';
html += '<div class="div-result-actions"><button class="div-copy-btn" id="div-chat-copy-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-3px;margin-right:6px"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>点击复制文字</button></div>';
return html;
}
function bindChatCopy(el, cards, mode, question, summary) {
const b = el && el.querySelector && el.querySelector('#div-chat-copy-btn');
if (!b) return;
b.addEventListener('click', (e) => {
e.stopPropagation();
if (window.divineCopyResultText && window.divineBuildResultText) {
window.divineCopyResultText(window.divineBuildResultText(mode, cards, summary, question));
}
});
}
const chatAuto = document.getElementById('div-chat-auto-send');
if (chatAuto) {
chatAuto.addEventListener('change', () => {
if (window.divineAutoSet) window.divineAutoSet(chatAuto.checked);
});
}
chatDivineBody.querySelectorAll('.dec-inp-clear').forEach(btn => {
btn.addEventListener('click', (e) => {
e.stopPropagation();
const ta = document.getElementById(btn.dataset.clear);
if (!ta) return;
const box = ta.__ceBox;
if (box) box.textContent = '';
else ta.value = '';
ta.focus();
toast('已清空');
});
});
const histToggle = document.getElementById('div-chat-hist-toggle');
if (histToggle) {
histToggle.addEventListener('click', (e) => {
e.stopPropagation();
const listEl = document.getElementById('div-chat-history');
if (!listEl) return;
const show = listEl.hidden;
listEl.hidden = !show;
histToggle.textContent = show ? '📜 占卜记录 ▴' : '📜 占卜记录 ▾';
if (show) renderChatHistory();
});
}
const histClear = document.getElementById('div-chat-hist-clear');
if (histClear) {
histClear.addEventListener('click', (e) => {
e.stopPropagation();
if (window.openModal) {
window.openModal('清空本桌面的全部占卜记录？（不可恢复）', '', () => {
if (window.divineHistSave) { try { window.divineHistSave([]); } catch (err) {} }
renderChatHistory();
toast('占卜记录已清空');
});
}
});
}
const divDraw = document.getElementById('div-chat-draw');
let chatDrawCancel = null;
if (divDraw) {
const divDrawIdleHTML = divDraw.innerHTML;
divDraw.addEventListener('click', (e) => {
e.stopPropagation();
const r = document.getElementById('div-chat-result');
if (!r) return;
if (divDraw.textContent.indexOf('重新抽牌') !== -1) {
if (chatDrawCancel) { try { chatDrawCancel(); } catch (err) {} chatDrawCancel = null; }
r.innerHTML = '<div class="div-result-empty">点击上方按钮开始抽牌</div>';
divDraw.innerHTML = divDrawIdleHTML;
return;
}
if (chatDrawCancel) { try { chatDrawCancel(); } catch (err) {} chatDrawCancel = null; }
const question = (document.getElementById('div-chat-question') || {}).value || '';
const snapMode = chatDivineMode, snapCount = chatDivineCount;
// v3.26.x：快照点击时的占卜对象——流程期间切换对象不影响本次记录归属
const snapTarget = (window.divineGetTarget && window.divineGetTarget()) || '';
const deck = snapMode === 'tarot' ? (window.__TAROT__ || []) : (window.__LENO__ || []);
if (!window.startDivineDraw || !deck.length) { r.innerHTML = '<div class="div-result-empty">占卜牌库加载中…</div>'; return; }
divDraw.textContent = '抽牌中…';
chatDrawCancel = window.startDivineDraw(r, {
deck: deck,
count: snapCount,
labels: ((window.__MODE_LABELS__ || {})[snapMode] || {})[snapCount] || [],
tarot: snapMode === 'tarot',
onDone: (cards) => {
chatDrawCancel = null;
divDraw.textContent = '重新抽牌';
const summary = (window.divineBuildSummary && window.divineBuildSummary(cards, snapMode, question)) || '';
r.innerHTML = chatDivineResultHtml(cards, snapMode, question, summary);
bindChatCopy(r, cards, snapMode, question, summary);
if (window.divineAutoGet && window.divineAutoGet() && window.divineSendResult) {
setTimeout(() => { try { window.divineSendResult(snapMode, cards, summary, question); } catch (err) {} }, 600);
}
if (window.divineHistSave && window.divineHistLoad) {
try {
const record = { ts: Date.now(), mode: snapMode, count: snapCount, question: question, cards: cards, summary: summary };
if (snapTarget && window.divineTargetName) record.target = window.divineTargetName(snapTarget);
const list = window.divineHistLoad();
if (!Array.isArray(list)) { if (window.divineHistSave) window.divineHistSave([]); }
else {
list.unshift(record);
window.divineHistSave(list);
}
// v3.26.x：选了对象（或不选）→ 同步写入该对象/当前桌面的主页「占卜记录」
if (window.divineSaveToHomeHistory) { try { window.divineSaveToHomeHistory(record, snapTarget); } catch (err2) {} }
} catch (err) {}
try { renderChatHistory(); } catch (err) {
try { if (window.__jsErrors) window.__jsErrors.push('divineHist: ' + (err && err.message)); } catch (e2) {}
}
}
}
});
});
}
}
function bindTaNow(id, fn) {
const btn = document.getElementById(id);
if (btn) {
btn.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
if (fn) fn();
});
}
}
bindTaNow('more-ask-now', () => { if (window.triggerTaAskNow) window.triggerTaAskNow(); });
bindTaNow('more-choose-now', () => { if (window.triggerTaChooseNow) window.triggerTaChooseNow(); });
bindTaNow('more-curious-now', () => { if (window.triggerTaCuriousNow) window.triggerTaCuriousNow(); });
bindTaNow('more-roast-now', () => { if (window.triggerTaRoastNow) window.triggerTaRoastNow(); });
bindTaNow('more-invite-now', () => { if (window.triggerTaInviteNow) window.triggerTaInviteNow(); });
const moreDecide = document.getElementById('more-decide');
if (moreDecide) {
moreDecide.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
if (window.openDecision) {
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel');
if (ep) ep.hidden = true;
const askP = document.getElementById('chat-ask-panel');
if (askP) closeChatAskPanel();
const cs = document.getElementById('chat-search');
if (cs) cs.hidden = true;
const dv = document.getElementById('chat-divine-panel');
if (dv) dv.hidden = true;
if (window.closeAvlib) window.closeAvlib();
window.openDecision();
} else toast('帮我决定加载失败');
});
}
const chatDecisionClose = document.getElementById('chat-decision-close');
if (chatDecisionClose) {
chatDecisionClose.addEventListener('click', (e) => {
e.stopPropagation();
const dp = document.getElementById('chat-decision-panel');
if (dp) dp.hidden = true;
});
}
function maybeFollowupAskCard() {
if (Math.random() >= 0.35) return;
const roll = Math.random();
try {
if (roll < 0.25 && window.triggerTaAskNow) { window.triggerTaAskNow(); return; }
if (roll < 0.5 && window.triggerTaChooseNow) { window.triggerTaChooseNow(); return; }
if (roll < 0.75 && window.triggerTaCuriousNow) { window.triggerTaCuriousNow(); return; }
if (window.triggerTaRoastNow) window.triggerTaRoastNow();
} catch (e) {}
}
const chatAskPanel = document.getElementById('chat-ask-panel');
const chatAskTitle = document.getElementById('chat-ask-title');
const chatAskInput = document.getElementById('chat-ask-input');
const chatAskOk = document.getElementById('chat-ask-ok');
const chatAskCancel = document.getElementById('chat-ask-cancel');
const chatAskClose = document.getElementById('chat-ask-close');
let chatAskMode = 'invite'; // invite / ask
let chatAskType = 'text'; // ask 模式回复类型：text 文字回复 / single 单选题
function ensureChatAskTypeRow() {
if (!chatAskPanel || chatAskPanel.querySelector('.chat-ask-type')) return;
const askBody = chatAskPanel.querySelector('.chat-ask-body');
if (!askBody) return;
const typeRow = document.createElement('div');
typeRow.className = 'chat-ask-type';
typeRow.hidden = true;
typeRow.innerHTML =
'<button class="chat-ask-type-btn sel" data-atype="text">文字回复</button>' +
'<button class="chat-ask-type-btn" data-atype="single">单选题</button>';
const opts = document.createElement('textarea');
opts.id = 'chat-ask-opts';
opts.className = 'chat-ask-opts';
opts.rows = 3;
opts.placeholder = '单选题选项：每行一个；可写 选项~TA回应，TA会选一个并用该回应回复';
opts.hidden = true;
const actions = askBody.querySelector('.chat-ask-actions');
if (actions) { askBody.insertBefore(typeRow, actions); askBody.insertBefore(opts, actions); }
else { askBody.appendChild(typeRow); askBody.appendChild(opts); }
const syncOptsHidden = () => {
const show = chatAskType === 'single';
opts.hidden = !show;
if (opts.__ceBox) opts.__ceBox.style.display = show ? 'block' : 'none';
else if (opts.previousElementSibling && opts.previousElementSibling.classList && opts.previousElementSibling.classList.contains('ce-box')) opts.previousElementSibling.style.display = show ? 'block' : 'none';
const obox = opts.__ceBox || (opts.previousElementSibling && opts.previousElementSibling.classList && opts.previousElementSibling.classList.contains('ce-box') ? opts.previousElementSibling : opts);
try { obox.style.transform = show ? 'translateZ(0)' : ''; } catch (e) {}
};
typeRow.querySelectorAll('.chat-ask-type-btn').forEach(btn => {
btn.addEventListener('click', () => {
chatAskType = btn.dataset.atype === 'single' ? 'single' : 'text';
typeRow.querySelectorAll('.chat-ask-type-btn').forEach(b => b.classList.toggle('sel', b === btn));
syncOptsHidden();
askBoxes().forEach(({ box }) => {
try {
box.style.transform = '';
void box.offsetHeight;
box.style.transform = 'translateZ(0)';
} catch (e) {}
});
});
});
}
function resetChatAskType() {
chatAskType = 'text';
const typeRow = chatAskPanel ? chatAskPanel.querySelector('.chat-ask-type') : null;
if (typeRow) {
typeRow.hidden = chatAskMode !== 'ask';
typeRow.querySelectorAll('.chat-ask-type-btn').forEach(b => b.classList.toggle('sel', b.dataset.atype === 'text'));
}
const opts = document.getElementById('chat-ask-opts');
if (opts) {
opts.hidden = true;
if (opts.__ceBox) opts.__ceBox.style.display = 'none';
else if (opts.previousElementSibling && opts.previousElementSibling.classList && opts.previousElementSibling.classList.contains('ce-box')) opts.previousElementSibling.style.display = 'none';
}
}
function askBoxes() {
const arr = [chatAskInput, document.getElementById('chat-ask-opts')];
return arr.filter(Boolean).map(el => ({ inp: el, box: el.__ceBox || el }));
}
function applyAskComposeLayers() {
askBoxes().forEach(({ box }) => {
try { box.style.transform = 'translateZ(0)'; box.style.willChange = 'transform'; } catch (e) {}
});
}
function clearAskComposeLayers() {
askBoxes().forEach(({ box }) => {
try { box.style.transform = ''; box.style.willChange = ''; } catch (e) {}
});
}
let askKbRefreshStop = null;
function startAskKbRefresh() {
if (askKbRefreshStop) return;
const vv = window.visualViewport;
if (!vv) return;
let t = null;
const refresh = () => {
if (t) clearTimeout(t);
t = setTimeout(() => {
t = null;
askBoxes().forEach(({ box }) => {
try {
box.style.transform = '';
void box.offsetHeight; // 强制 reflow，浏览器按新位置重建合成层
box.style.transform = 'translateZ(0)';
} catch (e) {}
});
}, 160);
};
vv.addEventListener('resize', refresh);
let phMo = null, lastPhH = null;
try {
const phEl = document.querySelector('.phone');
if (phEl && typeof MutationObserver === 'function') {
lastPhH = phEl.style.height;
phMo = new MutationObserver(() => {
const h = phEl.style.height;
if (h !== lastPhH) { lastPhH = h; refresh(); }
});
phMo.observe(phEl, { attributes: true, attributeFilter: ['style'] });
}
} catch (e) {}
askKbRefreshStop = () => {
if (t) clearTimeout(t);
if (phMo) { try { phMo.disconnect(); } catch (e) {} phMo = null; }
vv.removeEventListener('resize', refresh);
askKbRefreshStop = null;
};
}
function openChatAskPanel(mode) {
if (!chatAskPanel) return;
chatAskMode = mode || 'invite';
ensureChatAskTypeRow();
resetChatAskType();
if (chatAskTitle) chatAskTitle.textContent = chatAskMode === 'invite' ? '邀请TA' : '问问TA';
if (chatAskInput) {
chatAskInput.placeholder = chatAskMode === 'invite' ? '想邀请TA做什么？' : '你的问题？';
chatAskInput.value = '';
}
// v3.26.x：邀请TA 模式显示「我的邀请」字卡库（分组栏 + 字卡 + 存入按钮）；问问TA 模式隐藏
const invGroups = document.getElementById('invite-groups');
const invList = document.getElementById('invite-list');
const invSave = document.getElementById('chat-ask-save');
const isInvite = chatAskMode === 'invite';
if (invGroups) invGroups.hidden = !isInvite;
if (invList) invList.hidden = !isInvite;
if (invSave) invSave.hidden = !isInvite;
if (isInvite) {
myInviteAdoptFromIdb().then(() => { if (chatAskMode === 'invite') renderInviteBank(); });
}
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel');
if (ep) ep.hidden = true;
if (window.closeAvlib) window.closeAvlib();
chatAskPanel.hidden = false;
closeIme(); // v3.5.116：收起输入法，半框完整不被键盘遮挡
applyAskComposeLayers();
startAskKbRefresh();
setTimeout(() => {
if (!chatAskInput) return;
chatAskInput.focus();
}, 80);
}
function closeChatAskPanel() {
if (askKbRefreshStop) { try { askKbRefreshStop(); } catch (e) {} }
clearAskComposeLayers();
if (chatAskPanel) chatAskPanel.hidden = true;
}
function submitChatAsk() {
if (!chatAskInput) return;
const content = (chatAskInput.value || '').trim();
if (!content) { toast('请输入内容'); return; }
let askOpts = null;
if (chatAskMode === 'ask' && chatAskType === 'single') {
const optsEl = document.getElementById('chat-ask-opts');
askOpts = String(optsEl ? optsEl.value || '' : '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
const i = line.indexOf('~');
return i >= 0 ? { t: line.slice(0, i).trim(), reply: line.slice(i + 1).trim() } : { t: line, reply: '' };
});
if (!askOpts.length) { toast('单选题请填写选项，每行一个'); return; }
}
closeChatAskPanel();
if (chatAskMode === 'invite') {
sendInviteContent(content);
} else {
const isSingle = !!askOpts;
addRec({ side: 'out', text: '问：' + content, special: 'ask', askQuestion: content, askType: isSingle ? 'single' : 'text', askOptions: askOpts, askStatus: 'pending' });
const askIdx = msgs.length - 1;
if (window.logFish) window.logFish();
const recTs = Date.now();
const myCid = window.__activeCid || 'default';
const sameCid = () => (window.__activeCid || 'default') === myCid;
setTimeout(() => {
if (!sameCid()) return;
const defs = window.getInteractPool
? window.getInteractPool('问问TA·回应', ['嗯嗯', '我想想…', '应该吧', '好呀', '我陪你', '可以的', '那挺好呀', '我觉得可以', '听你的', '当然可以', '我很乐意'])
: ['嗯嗯', '我想想…', '应该吧', '好呀', '我陪你', '可以的', '那挺好呀', '我觉得可以', '听你的', '当然可以', '我很乐意'];
let text;
if (isSingle && askOpts && askOpts.length) {
const o = askOpts[Math.floor(Math.random() * askOpts.length)];
text = o.t;
} else {
text = (window.pickAskCardReply ? window.pickAskCardReply(defs) : defs[Math.floor(Math.random() * defs.length)]);
}
const rec = msgs[askIdx];
if (rec && rec.special === 'ask') {
rec.askStatus = 'answered';
rec.askAnswer = text;
saveMsgs();
const el = body.querySelector('.msg-ask[data-idx="' + askIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-ask-card answered"><div class="msg-ask-q">' + (window.taFit ? window.taFit('问问TA') : '问问TA') + ' · ' + escTxt(content) + '</div><div class="msg-ask-a">✓ ' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(text) : text) + '</div>' + favHeartHtml(rec) + '</div>';
}
}
addIn(text);
try {
const list = JSON.parse(store.get('invite-ask-history') || '[]');
list.unshift({ type: 'ask', q: content, a: text, ts: recTs });
if (list.length > 200) list.length = 200;
store.set('invite-ask-history', JSON.stringify(list));
} catch (err) {}
if (window.renderAskRecords) window.renderAskRecords();
setTimeout(() => { if (!sameCid()) return; maybeFollowupAskCard(); }, 1200);
}, 1500 + Math.random() * 2500);
}
}
// v3.26.x：邀请发送逻辑从 submitChatAsk 抽出，供「我的邀请」字卡点卡直接复用（可重复发送，
// 行为与手动输入一致：TA 接受/拒绝/未回应，随消息持久化）
function sendInviteContent(content) {
closeChatAskPanel();
addRec({ side: 'out', text: '邀请：' + content, special: 'invite', inviteContent: content, inviteStatus: 'pending' });
const inviteIdx = msgs.length - 1;
if (window.logFish) window.logFish();
const histKey = 'invite-ask-history';
const recTs = Date.now();
const myCid = window.__activeCid || 'default';
const sameCid = () => (window.__activeCid || 'default') === myCid;
setTimeout(() => {
if (!sameCid()) return;
const roll = Math.random();
const name = chatPartnerName();
let status, answer, reply = null;
if (roll < 0.6) {
status = '接受';
answer = name + ' 接受了你的邀请';
const pool = window.getInteractPool
? window.getInteractPool('邀请TA·接受', ['好，我答应你。', '可以呀。', '我陪你。', '走吧。', '嗯，陪你。'])
: ['好，我答应你。', '可以呀。', '我陪你。', '走吧。', '嗯，陪你。'];
reply = (window.pickAskCardReply ? window.pickAskCardReply(pool) : pool[Math.floor(Math.random() * pool.length)]);
setTimeout(() => { if (!sameCid()) return; addIn(reply); }, 800);
} else if (roll < 0.85) {
status = '拒绝';
answer = name + ' 拒绝了你的邀请';
const pool = window.getInteractPool
? window.getInteractPool('邀请TA·拒绝', ['这次不行。', '下次吧。', '抱歉。', '今天不方便。'])
: ['这次不行。', '下次吧。', '抱歉。', '今天不方便。'];
reply = (window.pickAskCardReply ? window.pickAskCardReply(pool) : pool[Math.floor(Math.random() * pool.length)]);
setTimeout(() => { if (!sameCid()) return; addIn(reply); }, 800);
} else {
status = '未回应';
answer = name + ' 暂时没有回应';
}
const rec = msgs[inviteIdx];
if (rec && rec.special === 'invite') {
rec.inviteStatus = 'answered';
rec.inviteAnswer = answer;
saveMsgs();
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + inviteIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-ask-card answered"><div class="msg-ask-q">' + (window.taFit ? window.taFit('邀请TA') : '邀请TA') + ' · ' + escTxt(content) + '</div><div class="msg-ask-a">✓ ' + escTxt(window.taFit ? window.taFit(answer) : answer) + '</div>' + favHeartHtml(rec) + '</div>';
}
}
try {
const list = JSON.parse(store.get(histKey) || '[]');
list.unshift({ type: 'invite', q: content, a: reply || status, ts: recTs });
if (list.length > 200) list.length = 200;
store.set(histKey, JSON.stringify(list));
} catch (err) {}
if (window.renderAskRecords) window.renderAskRecords();
setTimeout(() => { if (!sameCid()) return; maybeFollowupAskCard(); }, 1200);
}, 1500 + Math.random() * 2500);
}
// ===================== 我的邀请（邀请TA 字卡库，仿「我的拍一拍」） =====================
// v3.26.x：邀请TA 半框内置「我的邀请」——预设 + 用户分组存邀请字卡，点卡即发送（可重复），
// 输入框可「存入」当前分组；数据按当前桌面联系人命名空间隔离（activePrefix），
// 结构化写入 IndexedDB 兜底，防止 iOS 存储清理导致字卡丢失（同 pokeUserGroups 策略）。
const MY_INVITE_PRESETS = ['想和你猜拳，来一局？', '想和你玩一局 Pong，来吗？', '想和你玩双人贪吃蛇，来吗？', '想和你一起听歌'];
let myInviteDirty = false;
let myInviteCurGroup = '__preset';
let myInviteGroups = null;
function myInviteGroupsKey() { return window.activePrefix() + ':my-invite-groups'; }
function myInviteGroupsLoad() {
try {
const v = JSON.parse(store.get('my-invite-groups') || 'null');
if (Array.isArray(v)) return v.filter(g => Array.isArray(g) && Array.isArray(g[1]));
} catch (e) {}
return null;
}
function myInviteG() {
if (myInviteGroups === null) {
	myInviteGroups = myInviteGroupsLoad() || [];
	if (!myInviteGroups.some(g => g[0] === '我的新增')) myInviteGroups.push(['我的新增', []]);
	}
	// v3.28：预设分组持久化——系统内置字卡灌入 '__preset' 条目（首启自动），
	// 这样预设分组的字卡也能单独「修改/删除」，否则预设 cards 每次 view 实时重建、无持久化可写（用户反馈「无法单独编辑字卡」）
	if (!myInviteGroups.some(g => g[0] === '__preset')) {
	myInviteGroups.unshift(['__preset', MY_INVITE_PRESETS.slice()]);
	myInviteGroupsSave();
	}
	return myInviteGroups;
}
function myInviteGroupsSave() {
myInviteDirty = true;
try {
const data = JSON.stringify(myInviteGroups);
store.set('my-invite-groups', data);
if (window.idbSet) window.idbSet(myInviteGroupsKey(), data);
} catch (e) {}
}
function myInviteCount(arr) { return (arr || []).reduce((n, g) => n + (Array.isArray(g) && Array.isArray(g[1]) ? g[1].length : 0), 0); }
// IDB 兜底恢复：备份条目多于内存时采用；会话内已改过（myInviteDirty）则跳过防回滚
function myInviteAdoptFromIdb() {
if (myInviteDirty || !window.idbGet) return Promise.resolve(false);
return window.idbGet(myInviteGroupsKey()).then(v => {
if (!v || myInviteDirty) return false;
let arr = null;
try { arr = JSON.parse(v); } catch (e) { return false; }
if (!Array.isArray(arr)) return false;
if (myInviteCount(arr) > myInviteCount(myInviteG())) {
myInviteGroups = arr.filter(g => Array.isArray(g) && Array.isArray(g[1]));
return true;
}
return false;
}).catch(() => false);
}
function myInviteView() {
	const out = [];
	const pre = myInviteG().find(g => g[0] === '__preset');
	out.push({ key: '__preset', label: '预设', cards: (pre && Array.isArray(pre[1])) ? pre[1].slice() : MY_INVITE_PRESETS.slice(), preset: true });
	myInviteG().forEach(g => {
	if (g[0] === '__preset') return;
	if (!Array.isArray(g) || !Array.isArray(g[1]) || !g[0]) return;
out.push({ key: g[0], label: g[0], cards: g[1].slice(), user: true });
});
return out;
}
function myInviteCurGroupKey() {
const groups = myInviteView();
if (!groups.some(g => g.key === myInviteCurGroup)) myInviteCurGroup = groups.length ? groups[0].key : '__preset';
return myInviteCurGroup;
}
// v3.x：邀请TA ——批量管理模式态（预设为系统内置分组：仅自建分组可进批量，可重命名/删除分组）
let tiInviteBatch = false;   // 批量管理模式开关
let tiInviteSel = new Set(); // 批量勾选：当前自建分组内字卡下标集合
function renderInviteBank() {
const wrap = document.getElementById('invite-groups');
const list = document.getElementById('invite-list');
if (!wrap || !list) return;
myInviteCurGroupKey();
const groups = myInviteView();
const cur = groups.find(g => g.key === myInviteCurGroup) || groups[0] || { key: '__preset', cards: [] };
const curIsPreset = cur.key === '__preset';
// 预设为系统内置分组：切回预设时自动退出批量态
if (curIsPreset && tiInviteBatch) { tiInviteBatch = false; tiInviteSel.clear(); }
wrap.innerHTML = '';
groups.forEach(g => {
const chip = document.createElement('span');
chip.className = 'emoji-g-chip' + (myInviteCurGroup === g.key ? ' sel' : '');
if (tiInviteBatch && g.user) {
chip.innerHTML = escTxt(g.label) + g.cards.length +
'<span class="inv-g-op" data-op="rn">✎</span>' +
'<span class="inv-g-op" data-op="rm">✕</span>';
} else {
chip.textContent = g.label + g.cards.length;
}
const gkey = g.key, glabel = g.label;
chip.addEventListener('click', (e) => {
e.stopPropagation();
const op = e.target && e.target.closest ? e.target.closest('.inv-g-op') : null;
if (op) {
if (op.getAttribute('data-op') === 'rn') myInviteRenameGroup(gkey, glabel);
else if (op.getAttribute('data-op') === 'rm') myInviteRemoveGroup(gkey);
return;
}
if (myInviteCurGroup === gkey) return;
myInviteCurGroup = gkey;
tiInviteSel.clear();
renderInviteBank();
});
wrap.appendChild(chip);
});
const add = document.createElement('span');
add.className = 'emoji-g-chip poke-g-add';
add.textContent = '＋ 分组';
add.title = '新建我的邀请分组';
add.addEventListener('click', (e) => { e.stopPropagation(); myInviteNewGroup(); });
wrap.appendChild(add);
// v3.x：批量管理 chip（顶部分组栏右侧）——进入后批量勾选字卡，亦可在自建分组上 ✎重命名/✕删除
const batch = document.createElement('span');
batch.className = 'emoji-g-chip inv-g-batch' + (tiInviteBatch ? ' on' : '');
batch.textContent = tiInviteBatch ? '完成' : '批量管理';
batch.title = '批量管理：勾选字卡后可全选/删除/移动，也支持重命名/删除自建分组';
batch.addEventListener('click', (e) => { e.stopPropagation(); toggleInviteBatch(); });
wrap.appendChild(batch);
list.innerHTML = '';
if (tiInviteBatch && !curIsPreset) {
if (!cur.cards.length) {
list.innerHTML = '<div class="cc-empty">该分组暂无邀请字卡<br>在下方输入邀请内容，点「存入」添加</div>';
} else {
cur.cards.forEach((c, i) => {
const item = document.createElement('div');
item.className = 'cc-item glass invite-batch-item';
item.innerHTML = '<label class="inv-batch-cb"><input type="checkbox" class="inv-batch-cb-in" data-bidx="' + i + '"' + (tiInviteSel.has(i) ? ' checked' : '') + '></label><div class="cc-txt"><div class="t">' + escTxt(c) + '</div></div>';
const cb = item.querySelector('.inv-batch-cb-in');
if (cb) cb.addEventListener('change', () => {
if (cb.checked) tiInviteSel.add(i); else tiInviteSel.delete(i);
updateInviteBatchBarUI();
});
list.appendChild(item);
});
}
list.insertAdjacentHTML('beforeend',
'<div class="ti-batch-bar" id="inv-batch-bar">' +
'<span class="ti-batch-cnt" id="inv-batch-cnt">已选 <em>' + tiInviteSel.size + '</em> 条</span>' +
'<button class="ti-batch-btn" id="inv-batch-all">全选</button>' +
'<button class="ti-batch-btn" id="inv-batch-move"' + (tiInviteSel.size === 0 ? ' disabled' : '') + '>移动</button>' +
'<button class="ti-batch-btn ti-batch-del-btn" id="inv-batch-del"' + (tiInviteSel.size === 0 ? ' disabled' : '') + '>删除</button>' +
'<button class="ti-batch-btn" id="inv-batch-cancel">取消</button>' +
'</div>');
bindInviteBatchBar();
return;
}
if (!cur.cards.length) {
list.innerHTML = '<div class="cc-empty">暂无邀请字卡<br>在下方输入邀请内容，点「存入」添加</div>';
return;
}
cur.cards.forEach((c, i) => {
const item = document.createElement('div');
item.className = 'cc-item glass';
item.innerHTML = '<div class="cc-txt"><div class="t">' + escTxt(c) + '</div></div>';
	// v3.28：所有分组（含预设）的字卡都给「修改/删除」按钮——预设分组已持久化，myInviteEdit/myInviteDel 可直接写回（用户反馈预设字卡没法单独编辑）
	item.addEventListener('click', () => { sendInviteContent(c); });
	const ops = document.createElement('div');
ops.className = 'poke-card-ops';
const eb = document.createElement('button');
eb.type = 'button';
eb.className = 'poke-card-op poke-op-edit';
eb.title = '修改';
eb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
eb.addEventListener('click', (e) => { e.stopPropagation(); myInviteEdit(i, c); });
const db = document.createElement('button');
db.type = 'button';
db.className = 'poke-card-op poke-op-del';
db.title = '删除';
db.textContent = '✕';
db.addEventListener('click', (e) => { e.stopPropagation(); myInviteDel(i, c); });
ops.appendChild(eb);
	ops.appendChild(db);
	item.appendChild(ops);
	list.appendChild(item);
	});
}
function toggleInviteBatch() {
const groups = myInviteView();
const cur = groups.find(g => g.key === myInviteCurGroup);
if (!cur) return;
if (!tiInviteBatch && cur.key === '__preset') {
toast('预设为系统内置分组，请切换到自建分组后批量管理');
return;
}
tiInviteBatch = !tiInviteBatch;
tiInviteSel.clear();
renderInviteBank();
}
function myInviteCurGroupArr() {
const g = myInviteG().find(x => Array.isArray(x) && Array.isArray(x[1]) && x[0] === myInviteCurGroup);
return (g && Array.isArray(g[1])) ? g[1] : null;
}
function updateInviteBatchBarUI() {
const cnt = document.getElementById('inv-batch-cnt');
if (cnt) cnt.innerHTML = '已选 <em>' + tiInviteSel.size + '</em> 条';
const del = document.getElementById('inv-batch-del');
if (del) del.disabled = tiInviteSel.size === 0;
const mv = document.getElementById('inv-batch-move');
if (mv) mv.disabled = tiInviteSel.size === 0;
}
function bindInviteBatchBar() {
const curArr = myInviteCurGroupArr();
const n = curArr ? curArr.length : 0;
const all = document.getElementById('inv-batch-all');
if (all) all.addEventListener('click', () => {
if (tiInviteSel.size >= n) tiInviteSel.clear();
else for (let i = 0; i < n; i++) tiInviteSel.add(i);
renderInviteBank();
});
const cancel = document.getElementById('inv-batch-cancel');
if (cancel) cancel.addEventListener('click', () => {
tiInviteBatch = false; tiInviteSel.clear(); renderInviteBank();
});
const del = document.getElementById('inv-batch-del');
if (del) del.addEventListener('click', () => {
if (tiInviteSel.size === 0) { toast('请先勾选要删除的字卡'); return; }
const cnt = tiInviteSel.size;
window.openModal('删除选中的 ' + cnt + ' 条邀请字卡？', '', function () {
const arr = myInviteCurGroupArr();
if (!arr) return;
Array.from(tiInviteSel).sort((a, b) => b - a).forEach(i => { if (i >= 0 && i < arr.length) arr.splice(i, 1); });
myInviteGroupsSave();
tiInviteSel.clear();
tiInviteBatch = false;
myInviteCurGroupKey();
renderInviteBank();
toast('已删除 ' + cnt + ' 条');
}, { noInput: true, staticText: '此操作不可撤销。' });
});
const moveBtn = document.getElementById('inv-batch-move');
if (moveBtn) moveBtn.addEventListener('click', () => {
if (tiInviteSel.size === 0) { toast('请先勾选要移动的邀请字卡'); return; }
const groups = myInviteG().filter(g => Array.isArray(g) && Array.isArray(g[1]) && g[0] && g[0] !== myInviteCurGroup);
if (!groups.length) { toast('没有其他可移动的分组'); return; }
const opts = groups.map(g => ({ label: g[0], value: g[0] }));
const cnt = tiInviteSel.size;
window.openModal('移动到分组', '', function (v) {
const target = String(v || '');
if (!target) { toast('请选择目标分组'); return; }
const src = myInviteCurGroupArr();
if (!src) return;
let tArr = myInviteG().find(g => Array.isArray(g) && Array.isArray(g[1]) && g[0] === target);
if (!tArr) { tArr = [target, []]; myInviteG().push(tArr); }
let moved = 0;
Array.from(tiInviteSel).sort((a, b) => b - a).forEach(i => { if (i >= 0 && i < src.length) { tArr[1].push(src[i]); src.splice(i, 1); moved++; } });
myInviteGroupsSave();
tiInviteSel.clear();
tiInviteBatch = false;
myInviteCurGroupKey();
renderInviteBank();
toast('已移动 ' + moved + ' 条到「' + target + '」');
}, { pills: opts, pill: opts[0].value, noInput: true });
});
}
function myInviteRenameGroup(gk, oldLabel) {
window.openModal('重命名分组', oldLabel, function (v) {
v = (v || '').trim();
if (!v) { toast('请输入分组名'); return; }
const groups = myInviteG();
const g = groups.find(x => x[0] === gk);
if (!g) return;
if (v === gk) { toast('名称未变化'); return; }
if (groups.some(x => x[0] === v)) { toast('分组「' + v + '」已存在'); return; }
g[0] = v;
if (myInviteCurGroup === gk) myInviteCurGroup = v;
myInviteGroupsSave();
renderInviteBank();
toast('已重命名');
});
}
function myInviteRemoveGroup(gk) {
window.openModal('删除该分组？', '', function () {
const groups = myInviteG();
const g = groups.find(x => x[0] === gk);
if (!g) return;
const cnt = Array.isArray(g[1]) ? g[1].length : 0;
groups.splice(groups.indexOf(g), 1);
if (myInviteCurGroup === gk) myInviteCurGroup = null;
myInviteGroupsSave();
tiInviteSel.clear();
myInviteCurGroupKey();
renderInviteBank();
toast(cnt ? '已删除分组及 ' + cnt + ' 条字卡' : '已删除分组');
}, { noInput: true, staticText: '删除「' + gk + '」分组及其中的全部字卡？此操作不可撤销。' });
}
// end renderInviteBank
function saveInviteInput() {
const v = (chatAskInput && chatAskInput.value || '').trim();
if (!v) { toast('先输入邀请内容'); return; }
const groups = myInviteG();
let target = groups.find(g => g[0] === myInviteCurGroup);
if (!target) { target = ['我的新增', []]; groups.push(target); }
if (target[1].indexOf(v) >= 0) { toast('「' + target[0] + '」已有相同的邀请'); return; }
target[1].push(v);
myInviteGroupsSave();
myInviteCurGroup = target[0];
renderInviteBank();
if (chatAskInput) chatAskInput.value = '';
toast('已存入「' + target[0] + '」');
}
function myInviteNewGroup() {
window.openModal('新建「我的邀请」分组', '', (v) => {
v = (v || '').trim();
if (!v) { toast('请输入分组名'); return; }
const groups = myInviteG();
if (groups.some(g => g[0] === v)) { toast('分组「' + v + '」已存在'); return; }
groups.push([v, []]);
myInviteGroupsSave();
myInviteCurGroup = v;
renderInviteBank();
toast('已新建分组「' + v + '」');
});
}
function myInviteEdit(idx, old) {
const g = myInviteG().find(x => x[0] === myInviteCurGroup);
if (!g || !Array.isArray(g[1])) return;
window.openModal('修改邀请', old, (v) => {
v = (v || '').trim();
if (!v) { toast('请输入邀请内容'); return; }
const g2 = myInviteG().find(x => x[0] === myInviteCurGroup);
if (!g2 || !Array.isArray(g2[1]) || idx < 0 || idx >= g2[1].length) return;
if (g2[1][idx] === v) { toast('内容未变化'); return; }
if (g2[1].indexOf(v) >= 0) { toast('该分组已有相同的邀请'); return; }
g2[1][idx] = v;
myInviteGroupsSave();
renderInviteBank();
toast('已修改');
});
}
function myInviteDel(idx, c) {
const g = myInviteG().find(x => x[0] === myInviteCurGroup);
if (!g || !Array.isArray(g[1])) return;
window.openModal('删除这条邀请？', '', () => {
const g2 = myInviteG().find(x => x[0] === myInviteCurGroup);
if (!g2 || !Array.isArray(g2[1]) || idx < 0 || idx >= g2[1].length) return;
g2[1].splice(idx, 1);
myInviteGroupsSave();
renderInviteBank();
toast('已删除');
}, { noInput: true, staticText: '「' + c + '」\n\n删除后无法恢复。' });
}
document.addEventListener('contact-switched', function () {
myInviteDirty = false;
myInviteGroups = null;
myInviteCurGroup = '__preset';
tiInviteBatch = false;
tiInviteSel.clear();
});
const moreInvite = document.getElementById('more-invite');
if (moreInvite) {
moreInvite.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
openChatAskPanel('invite');
});
}
const moreAsk = document.getElementById('more-ask');
if (moreAsk) {
moreAsk.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
openChatAskPanel('ask');
});
}
if (chatAskOk) chatAskOk.addEventListener('click', (e) => { e.stopPropagation(); submitChatAsk(); });
if (chatAskCancel) chatAskCancel.addEventListener('click', (e) => { e.stopPropagation(); closeChatAskPanel(); });
if (chatAskClose) chatAskClose.addEventListener('click', (e) => { e.stopPropagation(); closeChatAskPanel(); });
const chatAskSaveBtn = document.getElementById('chat-ask-save');
if (chatAskSaveBtn) chatAskSaveBtn.addEventListener('click', (e) => { e.stopPropagation(); saveInviteInput(); });
if (chatAskInput) chatAskInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.stopPropagation(); submitChatAsk(); } });
const chatSearchEl = document.getElementById('chat-search');
const chatSearchInput = document.getElementById('chat-search-input');
const chatSearchGo = document.getElementById('chat-search-go');
const chatSearchResults = document.getElementById('chat-search-results');
const chatSearchNew = document.getElementById('chat-search-new');
const chatSearchDateFrom = document.getElementById('chat-search-date-from');
const chatSearchDateTo = document.getElementById('chat-search-date-to');
const chatSearchDateClear = document.getElementById('chat-search-date-clear');
function openChatSearch() {
if (!chatSearchEl) return;
loadMsgs();
chatSearchEl.hidden = false;
chatSearchInput.value = '';
if (chatSearchDateFrom) chatSearchDateFrom.value = '';
if (chatSearchDateTo) chatSearchDateTo.value = '';
chatSearchResults.innerHTML = '<div class="chat-search-empty">输入关键词，或选择日期范围搜索聊天记录</div>';
setTimeout(() => chatSearchInput.focus(), 60);
}
function closeChatSearch() {
if (chatSearchEl) chatSearchEl.hidden = true;
}
function searchDateToTs(ds, inclusiveEnd) {
if (!ds) return null;
const parts = String(ds).split('-').map(Number);
if (parts.length !== 3 || parts.some(isNaN)) return null;
const d = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
if (isNaN(d.getTime())) return null;
return d.getTime() + (inclusiveEnd ? 86400000 : 0);
}
function fmtSearchTime(ts) {
if (!ts) return '';
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function runChatSearch() {
if (!chatSearchResults) return;
const q = (chatSearchInput.value || '').trim();
const fromTs = searchDateToTs(chatSearchDateFrom ? chatSearchDateFrom.value : '', false);
const toTs = searchDateToTs(chatSearchDateTo ? chatSearchDateTo.value : '', true);
const dateLabel = fromTs != null && toTs != null ? (chatSearchDateFrom.value + ' 至 ' + chatSearchDateTo.value) :
fromTs != null ? (chatSearchDateFrom.value + ' 起') :
toTs != null ? ('截至 ' + chatSearchDateTo.value) : '';
if (!q && fromTs == null && toTs == null) {
chatSearchResults.innerHTML = '<div class="chat-search-empty">输入关键词，或选择日期范围搜索聊天记录</div>';
return;
}
loadMsgs();
const partnerName = chatPartnerName();
const myName = chatUserName();
const results = [];
msgs.forEach((m, i) => {
if (!m || m.special) return;
if (fromTs != null && (!m.ts || m.ts < fromTs)) return;
if (toTs != null && (!m.ts || m.ts >= toTs)) return;
let txt = typeof m.text === 'string' ? m.text : '';
if (m.askQuestion) txt += ' ' + m.askQuestion;
if (m.choiceQuestion) txt += ' ' + m.choiceQuestion;
if (m.curiousQuestion) txt += ' ' + m.curiousQuestion;
if (m.roastText) txt += ' ' + m.roastText;
if (q && txt.indexOf(q) < 0) return;
results.push({ i: i, m: m, txt: txt });
});
const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
if (!results.length) {
const emptyMsg = q ? ('没有找到包含「' + esc(q) + '」' + (dateLabel ? '（' + dateLabel + '）' : '') + '的消息') : (dateLabel ? dateLabel + ' 没有聊天记录' : '输入关键词，或选择日期范围搜索聊天记录');
chatSearchResults.innerHTML = '<div class="chat-search-empty">' + emptyMsg + '</div>';
return;
}
const hl = (x) => esc(x).split(q).join('<span class="chat-search-hl">' + esc(q) + '</span>');
let head = '共 ' + results.length + ' 条 · 点击结果跳转到对应消息';
if (dateLabel) head = dateLabel + ' · 共 ' + results.length + ' 条 · 点击结果跳转';
let html = '<div style="font-size:11px;color:var(--muted);margin:6px 2px 10px">' + esc(head) + '</div>';
results.slice(0, 80).forEach(r => {
const isImg = r.txt.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(r.txt)); // #148 令牌化图片消息搜索结果不直出令牌串
const label = isImg ? '[图片]' : (r.txt.length > 60 ? r.txt.slice(0, 60) + '…' : r.txt);
const who = r.m.side === 'out' ? myName : partnerName;
const time = r.m.ts ? fmtSearchTime(r.m.ts) : '';
html += '<div class="tc-listitem" data-sidx="' + r.i + '"><div class="tc-li-top"><span class="tc-li-q">' + who + '：' + (isImg ? '[图片]' : (q ? hl(label) : esc(label))) + '</span><span class="tc-li-time">' + time + '</span></div></div>';
});
if (results.length > 80) html += '<div class="ta-empty">还有 ' + (results.length - 80) + ' 条…</div>';
chatSearchResults.innerHTML = html;
chatSearchResults.querySelectorAll('.tc-listitem').forEach(el => {
el.addEventListener('click', () => {
const idx = Number(el.dataset.sidx);
closeChatSearch();
if (!jumpToMsg(idx)) body.scrollTop = body.scrollHeight;
});
});
}
const moreSearch = document.getElementById('more-search');
if (moreSearch) {
moreSearch.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
const askP = document.getElementById('chat-ask-panel');
if (askP) closeChatAskPanel();
if (window.closeAvlib) window.closeAvlib();
openChatSearch();
});
}
if (chatSearchGo) chatSearchGo.addEventListener('click', (e) => { e.stopPropagation(); runChatSearch(); });
if (chatSearchInput) chatSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.stopPropagation(); runChatSearch(); } });
if (chatSearchDateFrom) chatSearchDateFrom.addEventListener('change', (e) => { e.stopPropagation(); runChatSearch(); });
if (chatSearchDateTo) chatSearchDateTo.addEventListener('change', (e) => { e.stopPropagation(); runChatSearch(); });
if (chatSearchDateClear) chatSearchDateClear.addEventListener('click', (e) => {
e.stopPropagation();
if (chatSearchDateFrom) chatSearchDateFrom.value = '';
if (chatSearchDateTo) chatSearchDateTo.value = '';
chatSearchResults.innerHTML = '<div class="chat-search-empty">输入关键词，或选择日期范围搜索聊天记录</div>';
chatSearchInput.focus();
});
const chatSearchClose = document.getElementById('chat-search-close');
if (chatSearchClose) chatSearchClose.addEventListener('click', (e) => { e.stopPropagation(); closeChatSearch(); });
if (chatSearchNew) chatSearchNew.addEventListener('click', (e) => {
e.stopPropagation();
closeChatSearch();
scrollChatBottom();
const last = body.lastElementChild;
if (last) {
try { last.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (e2) { last.scrollIntoView(); }
}
});
const chatCallPanel = document.getElementById('chat-call-panel');
const chatCallClose = document.getElementById('chat-call-close');
const callPanelName = document.getElementById('call-panel-name');
const callPanelStatus = document.getElementById('call-panel-status');
const callPanelDial = document.getElementById('call-panel-dial');
const callPanelHang = document.getElementById('call-panel-hang');
let callPanelTimer = null;
function fmtCallDur(sec) {
if (isNaN(sec) || sec < 0) return '00:00';
const m = Math.floor(sec / 60), s = sec % 60;
return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
}
function updateCallPanel() {
if (!chatCallPanel || chatCallPanel.hidden) return;
const pName = chatPartnerName();
if (callPanelName) callPanelName.textContent = pName;
let st = null;
try { st = (window.getCallState && window.getCallState()) || null; } catch (err) { st = null; }
if (st && st.status !== 'ended') {
if (callPanelStatus) {
callPanelStatus.textContent =
st.status === 'connected' ? ('与 ' + (st.name || pName) + ' 通话中 · ' + fmtCallDur(st.durationSec)) :
st.status === 'ringing' ? ((st.name || pName) + ' 来电…') :
st.status === 'calling' ? ('正在呼叫 ' + (st.name || pName) + '…') : '通话中';
}
if (callPanelDial) callPanelDial.hidden = true;
if (callPanelHang) callPanelHang.hidden = false;
} else {
if (callPanelStatus) callPanelStatus.textContent = '空闲 · 点击拨打语音通话';
if (callPanelDial) callPanelDial.hidden = false;
if (callPanelHang) callPanelHang.hidden = true;
}
}
function openChatCall() {
if (!chatCallPanel) return;
const pc = document.getElementById('poke-card'); if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel'); if (ep) ep.hidden = true;
const askP = document.getElementById('chat-ask-panel'); if (askP) closeChatAskPanel();
const cs = document.getElementById('chat-search'); if (cs) cs.hidden = true;
const dv = document.getElementById('chat-divine-panel'); if (dv) dv.hidden = true;
const rp = document.getElementById('chat-rps-panel'); if (rp) rp.hidden = true;
if (window.closeAvlib) window.closeAvlib();
chatCallPanel.hidden = false;
closeIme();
updateCallPanel();
clearInterval(callPanelTimer);
callPanelTimer = setInterval(updateCallPanel, 1000);
}
function closeChatCall() {
if (chatCallPanel) chatCallPanel.hidden = true;
clearInterval(callPanelTimer);
callPanelTimer = null;
}
const moreCall = document.getElementById('more-call');
if (moreCall) {
moreCall.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
openChatCall();
});
}
const morePong = document.getElementById('more-pong');
if (morePong) {
morePong.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
const pc = document.getElementById('poke-card'); if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel'); if (ep) ep.hidden = true;
const askP = document.getElementById('chat-ask-panel'); if (askP) closeChatAskPanel();
const cs = document.getElementById('chat-search'); if (cs) cs.hidden = true;
const dv = document.getElementById('chat-divine-panel'); if (dv) dv.hidden = true;
const dp = document.getElementById('chat-decision-panel'); if (dp) dp.hidden = true;
const rpsP = document.getElementById('chat-rps-panel'); if (rpsP) rpsP.hidden = true;
const rpP = document.getElementById('chat-rp-panel'); if (rpP) rpP.hidden = true;
const callP = document.getElementById('chat-call-panel'); if (callP) callP.hidden = true;
if (window.closeAvlib) window.closeAvlib();
if (window.openPongPanel) window.openPongPanel();
});
}
const moreSnake = document.getElementById('more-snake');
if (moreSnake) {
moreSnake.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
if (window.openSnakePanel) window.openSnakePanel();
});
}
// v3.15.x：补接双人钓鱼入口（按钮/面板锚点早已存在，此前无绑定是死入口）
const moreFish = document.getElementById('more-fish');
if (moreFish) {
moreFish.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
if (window.openFishPanel) window.openFishPanel();
});
}
var moreBrick = document.getElementById('more-brick');
if (moreBrick) {
  moreBrick.addEventListener('click', function (e) {
    e.stopPropagation();
    if (morePanel) morePanel.hidden = true;
    var pc = document.getElementById('poke-card'); if (pc) pc.hidden = true;
    var ep = document.getElementById('emoji-panel'); if (ep) ep.hidden = true;
    var askP = document.getElementById('chat-ask-panel'); if (askP) closeChatAskPanel();
    var cs = document.getElementById('chat-search'); if (cs) cs.hidden = true;
    var dv = document.getElementById('chat-divine-panel'); if (dv) dv.hidden = true;
    var dp = document.getElementById('chat-decision-panel'); if (dp) dp.hidden = true;
    var rpsP = document.getElementById('chat-rps-panel'); if (rpsP) rpsP.hidden = true;
    var rpP = document.getElementById('chat-rp-panel'); if (rpP) rpP.hidden = true;
    var callP = document.getElementById('chat-call-panel'); if (callP) callP.hidden = true;
    var snkP = document.getElementById('chat-snake-panel'); if (snkP) snkP.hidden = true;
    if (window.closePongPanel) window.closePongPanel();
    if (window.openBrickPanel) window.openBrickPanel();
  });
}
window.sendSnakeResult = function (d) {
if (!d) return;
addRec({ side: 'in', special: 'snake', snkResult: d.result, snkPLen: d.pLen, snkOLen: d.oLen, snkPFood: d.pFood, snkOFood: d.oFood, snkPScore: d.pScore, snkOScore: d.oScore, snkTime: d.time });
// v3.15.x 二调：奖励对齐红包金额体系——胜 80% ¥13.14 / 20% ¥52，平 ¥5.2（日封顶 ¥104）
// v3.16.x：贪吃蛇改为双方同步同额入账（不再只给赢家），记赚钱流水「贪吃蛇」
try {
const snkWinFen = Math.random() < 0.2 ? 5200 : 1314;
const real = rpGameCoinGrant('snake', d.result === 'draw' ? 520 : snkWinFen, 10400);
if (real > 0) {
const w = rpWalletGet();
w.myBalance += real; w.systemBalance += real;
rpWalletSet(w);
try { if (window.giftCoinLedgerAdd) window.giftCoinLedgerAdd('earn', real, real, '贪吃蛇'); } catch (e2) {}
setTimeout(() => addIn('🪙 双方心意币各 +¥' + (real / 100).toFixed(2), { special: 'poke' }), randInt(800, 1600));
}
} catch (e) {}
if (window.logFish) window.logFish();
showTyping();
setTimeout(() => {
hideTyping();
const grp = d.result === 'win' ? '游戏失败·回应' : d.result === 'lose' ? '游戏胜利·回应' : '游戏平局·回应';
const pool = window.getInteractPool ? window.getInteractPool(grp, ['再来一局？']) : ['再来一局？'];
const say = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '再来一局？';
addRec({ side: 'in', text: say });
}, randInt(900, 1600));
};
if (chatCallClose) chatCallClose.addEventListener('click', (e) => { e.stopPropagation(); closeChatCall(); });
if (callPanelDial) callPanelDial.addEventListener('click', (e) => {
e.stopPropagation();
if (window.placeCall) window.placeCall();
else {
const name = chatPartnerName();
addRec({ side: 'out', text: '拨打 ' + name + ' 语音通话', special: 'call' });
if (window.logFish) window.logFish();
}
setTimeout(updateCallPanel, 120);
});
if (callPanelHang) callPanelHang.addEventListener('click', (e) => {
e.stopPropagation();
if (window.hangupCall) window.hangupCall();
setTimeout(updateCallPanel, 120);
});
document.addEventListener('contact-switched', function () {
try { closeChatCall(); } catch (e) {}
});
if (pokeClose) pokeClose.addEventListener('click', (e) => { e.stopPropagation(); closePokeCard(); });
// 冷启动回填预算把字卡库大键挂起在 IDB（__xyIdbDeferredKeys）时，聊天页表情包/拍一拍
// 面板会读成空库。这里在面板打开时按需取回（复用字卡库同一套 hydrateLibScopes），
// 完成后若面板仍打开则重绘——不启动自动拉取，遵守「用户正在看的场景才拉」红线。
function hydrateCcForChatPanels(done) {
try {
if (window.libScopesDeferred && window.hydrateLibScopes &&
window.libScopesDeferred(['public', 'own'])) {
try { toast('字卡较多，正在加载…'); } catch (e) {}
window.hydrateLibScopes(['public', 'own'], done);
return true;
}
} catch (e) {}
return false;
}
function openPokeCard() {
if (!pokeCard) return;
pokeAdoptAllRerender(); // 慢 IDB（iOS 挂后台杀连接）下 restore-done 兜底可能落空，开面板再补一次
const ep = document.getElementById('emoji-panel');
if (ep) ep.hidden = true;
if (window.closeAvlib) window.closeAvlib();
pokeCard.hidden = false;
if (morePanel) morePanel.hidden = true;
closeIme(); // v3.5.116：收起输入法，面板不被键盘遮挡
if (pokeInput) pokeInput.value = '';
try { const p = store.get('poke-tab'); if (p === 'mine') pokeMode = 'mine'; else if (p === 'ta') pokeMode = 'ta'; } catch (e) {}
try { const g = store.get('poke-group-' + pokeMode); if (typeof g === 'string' && g) pokeCurGroup = g; } catch (e) {}
renderPokeCard();
hydrateCcForChatPanels(() => { if (pokeCard && !pokeCard.hidden) renderPokeCard(); });
}
document.addEventListener('click', (e) => {
if (pokeCard && !pokeCard.hidden && !pokeCard.contains(e.target)) closePokeCard();
});
const msgActions = document.getElementById('msg-actions');
let activeMsgEl = null;   // 当前操作的消息 DOM
let activeSide = 'in';    // 当前操作消息方向
let lastQuote = null;     // 待引用内容
function getFav() { try { return JSON.parse(store.get('fav-msgs') || '[]'); } catch (e) { return []; } }
function saveFav(list) { store.set('fav-msgs', JSON.stringify(list)); try { scheduleFavImgPass(2500); } catch (e) {} }
// ===== v3.26.x #139：收藏图片压缩 =====
// 收藏把消息 parts / 图片 dataURL 原样整份进库，与聊天记录重复存同一批图（诊断实证
// fav-msgs 全桌面 ≈21MB）。压缩走「读-压缩-写前 CAS 比对」：压缩期间任何其他写入
// （再收藏/删除/换桌面）都会使快照失效并重排，绝不覆盖新数据，绝不丢收藏。
// 规则（宁可不压，不可压坏）：只压 data:image/*（GIF 保动画、SVG 矢量、<4KB 小图跳过）；
// 480px 上限（气泡显示宽度内）；优先 WebP（iOS canvas 不支持会回退返回 PNG，前缀检测后
// 改试 JPEG 白底）；结果必须比原图更小才采用；单张失败只影响该张，整批异常放弃本轮。
function compressFavDataUrl(src) {
return new Promise((resolve) => {
try {
if (typeof src !== 'string' || src.indexOf('data:image/') !== 0 || src.length < 4096) { resolve(null); return; }
if (/^data:image\/(gif|svg)/i.test(src)) { resolve(null); return; }
const img = new Image();
img.onload = () => {
try {
const scale = Math.min(1, 480 / Math.max(img.width, img.height));
const w = Math.max(1, Math.round(img.width * scale));
const h = Math.max(1, Math.round(img.height * scale));
const c = document.createElement('canvas');
c.width = w; c.height = h;
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0, w, h);
let out = c.toDataURL('image/webp', 0.82);
if (out.indexOf('data:image/webp') !== 0) {
ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
ctx.drawImage(img, 0, 0, w, h);
out = c.toDataURL('image/jpeg', 0.82);
}
resolve(out.length < src.length ? out : null);
} catch (e) { resolve(null); }
};
img.onerror = () => resolve(null);
img.src = src;
} catch (e) { resolve(null); }
});
}
async function compressFavListImages(list) {
let changed = false;
const out = new Array(list.length);
for (let i = 0; i < list.length; i++) {
let f = list[i];
try {
if (f && typeof f.text === 'string' && f.text.indexOf('data:image/') === 0) {
const v = await compressFavDataUrl(f.text);
if (v) { f = Object.assign({}, f, { text: v }); changed = true; }
}
if (f && Array.isArray(f.parts) && f.parts.length) {
const parts = new Array(f.parts.length);
let pChanged = false;
for (let j = 0; j < f.parts.length; j++) {
const p = f.parts[j];
let np = p;
if (p && typeof p.v === 'string' && p.v.indexOf('data:image/') === 0) {
const v = await compressFavDataUrl(p.v);
if (v) { np = Object.assign({}, p, { v: v }); pChanged = true; }
}
parts[j] = np;
}
if (pChanged) { f = Object.assign({}, f, { parts: parts }); changed = true; }
}
} catch (e) {}
out[i] = f;
}
return changed ? out : null;
}
// #142：收藏图片令牌化——压缩后把 data:image 替换为媒体池引用（与聊天记录同一池，
// 同一张图聊天/收藏只存一份）。池落盘先于收藏落盘（mochiMediaFlush）。
async function tokenizeFavList(list) {
if (!window.mochiMediaTokenize) return null;
let changed = false;
const out = new Array(list.length);
for (let i = 0; i < list.length; i++) {
let f = list[i];
try {
if (f && typeof f.text === 'string' && f.text.indexOf('data:image/') === 0) {
const t = await window.mochiMediaTokenize(f.text);
if (t) { f = Object.assign({}, f, { text: t }); changed = true; }
}
if (f && Array.isArray(f.parts) && f.parts.length) {
const parts = new Array(f.parts.length);
let pChanged = false;
for (let j = 0; j < f.parts.length; j++) {
const p = f.parts[j];
let np = p;
if (p && typeof p.v === 'string' && p.v.indexOf('data:image/') === 0) {
const t = await window.mochiMediaTokenize(p.v);
if (t) { np = Object.assign({}, p, { v: t }); pChanged = true; }
}
parts[j] = np;
}
if (pChanged) { f = Object.assign({}, f, { parts: parts }); changed = true; }
}
} catch (e) {}
out[i] = f;
}
return changed ? out : null;
}
let _favImgPassT = null, _favImgPassRetries = 0;
function scheduleFavImgPass(delay) {
clearTimeout(_favImgPassT);
_favImgPassT = setTimeout(favImgPass, delay || 3000);
}
// 返回 true=完整跑完一轮（无论是否压缩了内容）；false=期间有并发写入被 CAS 打断（已自动重排）
async function favImgPass() {
try {
const rawSnap = store.get('fav-msgs');
if (!rawSnap || rawSnap.length < 4096) return true;
let list;
try { list = JSON.parse(rawSnap); } catch (e) { return true; }
if (!Array.isArray(list)) return true;
const compressed = await compressFavListImages(list);
const tokened = await tokenizeFavList(compressed || list);
if (!compressed && !tokened) return true;
const out = tokened || compressed;
await window.mochiMediaFlush(); // #142：池数据先落盘，收藏里的令牌才有据可查
const rawNow = store.get('fav-msgs');
if (rawNow !== rawSnap) {
// 压缩期间收藏被写过——以最新数据重排（最多 5 次，防极端高频写入空转）
if (++_favImgPassRetries < 5) { scheduleFavImgPass(5000); return false; }
return true;
}
_favImgPassRetries = 0;
store.set('fav-msgs', JSON.stringify(out));
return true;
} catch (e) { return true; }
}
// 存量一次性迁移：本桌面没跑过压缩/令牌化扫描才执行（新收藏由 saveFav 钩子触发增量处理）
function favImgMigrateIfNeed() {
try { if (store.get('fav-img-cmp-v1') === '1' && store.get('fav-media-v1') === '1') return; } catch (e) {}
favImgPass().then(function (settled) {
if (settled) { try { store.set('fav-img-cmp-v1', '1'); store.set('fav-media-v1', '1'); } catch (e) {} }
});
}
window.favImgPassNow = favImgPass; // 可测性/诊断钩子（verify-media-pool 用）
document.addEventListener('mochi-restore-done', function () { setTimeout(favImgMigrateIfNeed, 12000); });
document.addEventListener('contact-switched', function () { setTimeout(favImgMigrateIfNeed, 12000); });
function syncFavMsgText(oldText, newText) {
if (oldText === newText) return;
const fav = getFav();
let changed = false;
fav.forEach(f => {
if ((f.kind || 'msg') === 'msg' && f.side === 'out' && f.text === oldText) {
f.text = newText;
f.type = 'text';
changed = true;
}
});
if (changed) saveFav(fav);
}
function favDup(list, f, by) {
// v3.26.x：按归属判重——「我的收藏」与「联系人的收藏」是两个独立 tab，
// TA 自动收藏的副本不应挡住用户收藏同一内容（反之亦然）
return list.some(x => (x.by || 'me') === by && (x.kind || 'msg') === (f.kind || 'msg') &&
(x.q || '') === (f.q || '') && (x.text || '') === (f.text || '') && x.ts === f.ts);
}
window.addMyFavItem = function (f) {
const fav = getFav();
if (favDup(fav, f, 'me')) return false;
fav.push(Object.assign({ by: 'me' }, f));
saveFav(fav);
return true;
};
window.addTaFavItem = function (f) {
const fav = getFav();
if (favDup(fav, f, 'ta')) return false;
fav.push(Object.assign({ by: 'ta' }, f));
saveFav(fav);
return true;
};
function cardSnapshot(rec) {
if (!rec) return null;
let q = '', mine = '', ta = '', special = rec.special;
if (special === 'ask-choose') { q = rec.choiceQuestion || ''; mine = rec.choiceAnswer || ''; ta = rec.choiceReply || ''; }
else if (special === 'ask-curious') { q = rec.curiousQuestion || ''; mine = rec.curiousAnswer || ''; ta = rec.curiousReply || ''; }
else if (special === 'ask-roast') { q = rec.roastText || ''; mine = rec.roastAnswer || ''; ta = rec.roastReply || ''; }
else if (special === 'ask-card') { q = rec.askQuestion || ''; mine = rec.askAnswer || ''; ta = rec.askReply || ''; }
else if (special === 'invite') { q = rec.inviteContent || ''; ta = rec.inviteAnswer || ''; }
// v3.28.x 修复：以下卡片在 renderMsg 都渲染了收藏心形（favHeartHtml），但 cardSnapshot
// 未覆盖 → 点收藏静默无效（无 toast、不进收藏夹）。补齐快照，收藏夹按通用卡渲染。
else if (special === 'ask') { q = rec.askQuestion || rec.text || ''; mine = rec.askAnswer || ''; ta = rec.askReply || ''; }
else if (special === 'redpacket') { mine = (rec.side === 'out' ? '我发出' : chatPartnerName() + '发出'); q = '红包 ¥' + Number(rec.rpAmount || 0).toFixed(2) + (rec.rpWish ? ' · ' + rec.rpWish : ''); }
else if (special === 'flower') { q = (rec.flName || '花') + (rec.flWish ? '：' + rec.flWish : ''); }
else if (special === 'gift') { q = (rec.giftName || '礼物') + (rec.giftWish ? '：“' + rec.giftWish + '”' : '') + (rec.giftPrice != null ? ' · ¥' + Number(rec.giftPrice || 0).toFixed(2) : ''); }
else if (special === 'dish') { q = (rec.dishName || '菜肴') + (rec.dishWish ? '：“' + rec.dishWish + '”' : '') + (rec.dishPrice != null ? ' · ¥' + Number(rec.dishPrice || 0).toFixed(2) : ''); }
else return null;
return { kind: 'card', special: special, q: q, mine: mine, ta: ta, ts: rec.ts || Date.now() };
}
window.favCardFromMsg = function (idx) {
const rec = msgs[idx];
if (!rec) return;
const f = cardSnapshot(rec);
if (!f) return;
if (window.addMyFavItem(f)) toast('已收藏互动卡片');
else toast('已收藏过这张卡片');
};
function favHeartHtml(rec) {
const heart = '<button class="msg-fav-heart" title="收藏整张互动卡片"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>收藏</button>';
let time = '';
if (rec && rec.ts) {
const who = rec.side === 'out' ? chatUserName() : chatPartnerName();
time = '<div class="msg-fav-time">' + escTxt(who) + ' ' + fmtTime(rec.ts) + ' 发送</div>';
}
return heart + time;
}
function taFavCard(rec) {
const _favProbCard = (window.favCfg ? window.favCfg().taCard : 30);
if (!rec || Math.random() * 100 >= _favProbCard) return;
const f = cardSnapshot(rec);
if (!f) return;
if (window.addTaFavItem(f)) setTimeout(() => toast('TA 收藏了你们的互动卡片'), 1200);
}
function closeMsgActions() {
if (msgActions) msgActions.hidden = true;
activeMsgEl = null;
}
function quoteTextOf(m) {
// #148：图片载荷判定加媒体池令牌（@@m:hash）——令牌化后的图片消息引用不出缩略图、
// 令牌串被当引用文本存进 quote，渲染端 data: 过滤再把缩略图整段丢掉
const isMedia = (s) => typeof s === 'string' && (s.indexOf('data:') === 0 || /^https?:\/\//i.test(s) || (window.mochiMediaIsToken && window.mochiMediaIsToken(s)));
const qi = (m.parts || []).filter(p => p.k === 'img').map(p => p.v).slice(0, 3);
if (!qi.length && (m.type === 'sticker' || m.type === 'image')
&& isMedia(m.text)) {
qi.push(m.text);
}
let qt = m.text;
if (m.type === 'voice') qt = '[语音] ' + String(qt || '').split('|||')[0];
else if (m.type === 'sticker') qt = '表情包';
else if (qi.length && isMedia(String(qt || ''))) qt = '图片';
// 兜底：type 仍是 text 却夹带 |||data: 载荷的记录（导入的字卡音频/历史数据）
else if (typeof qt === 'string' && qt.indexOf('|||') > 0 && qt.indexOf('data:') > 0) qt = qt.split('|||')[0];
return { text: qt, imgs: qi };
}
function quoteSnapOf(m) {
const q = quoteTextOf(m);
return q.imgs.length ? { t: q.text, imgs: q.imgs } : q.text;
}
function quoteEq(a, b) {
if (a === b) return true;
if (a && b && typeof a === 'object' && typeof b === 'object') return (a.t || '') === (b.t || '') && (a.imgs || []).join() === (b.imgs || []).join();
return false;
}
function resolveQuoteTarget(selfIdx) {
const rec = msgs[selfIdx];
if (!rec || !rec.quote) return -1;
const qs = rec.qside || 'out';
if (typeof rec.qidx === 'number' && rec.qidx >= 0 && rec.qidx < selfIdx) {
const t = msgs[rec.qidx];
if (t && !t.retracted && t.side === qs) return rec.qidx;
}
for (let i = selfIdx - 1; i >= 0; i--) {
const m = msgs[i];
if (!m || m.retracted || m.side !== qs) continue;
if (quoteEq(rec.quote, quoteSnapOf(m))) return i;
}
return -1;
}
function jumpToMsg(idx) {
let target = body.querySelector('.msg[data-idx="' + idx + '"]');
if (!target && idx < renderStart) {
renderStart = Math.max(0, idx - JUMP_VIEW);
renderWindow(true, false);
target = body.querySelector('.msg[data-idx="' + idx + '"]');
}
if (!target) return false;
try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { target.scrollIntoView(); }
target.classList.add('highlight');
setTimeout(() => target.classList.remove('highlight'), 2200);
return true;
}
if (body) {
body.addEventListener('click', (e) => {
const qb = e.target.closest('.msg-quote');
if (!qb) return;
const item = qb.closest('.msg');
if (!item || item.dataset.idx === undefined) return;
const tIdx = resolveQuoteTarget(Number(item.dataset.idx));
if (tIdx < 0 || !jumpToMsg(tIdx)) toast('未找到原消息');
});
}
if (body) {
// v3.26.x：消息操作菜单（引用/收藏/撤回/编辑/删除）支持「长按 + 轻点」双手势。
// 长按气泡弹出菜单，松开时抑制随之而来的轻点，避免菜单被立刻关闭；统一复用 openMsgActionsAt 打开逻辑。
let msgHoldTimer = null;
let msgHoldEl = null;
let msgHoldFired = false;
let msgSuppressClickUntil = 0;
function msgActionEligible(t) {
// 沿用原「点气泡弹菜单」的判定规则：可弹返回 {item, b}，不可弹返回 null（引用气泡/拍一拍/撤回/已读不回等）
const b = t.closest('.msg-bubble');
if (!b) return null;
if (t.closest('.msg-quote')) return null;
const item = b.closest('.msg');
if (!item || item.classList.contains('msg-poke')) return null;
if (t.closest('.msg-poke-seg')) return null;
const txt = b.textContent;
if (txt.indexOf('撤回了一条消息') >= 0 || txt.indexOf('已读不回') >= 0) return null;
return { item, b };
}
function openMsgActionsAt(item, b) {
activeMsgEl = item;
activeSide = item.classList.contains('msg-out') ? 'out' : 'in';
if (!msgActions) return;
msgActions.querySelectorAll('.ma-mine').forEach(b2 => b2.hidden = activeSide !== 'out');
const delBtn = msgActions.querySelector('.ma-del-ta');
if (delBtn) {
let delEn = false;
try { delEn = store.get('cs-del-ta-msg') === '1'; } catch (e) {}
delBtn.hidden = !(delEn && activeSide === 'in');
}
msgActions.hidden = false;
const bRect = b.getBoundingClientRect();
const aw = msgActions.offsetWidth || 200;
const ah = msgActions.offsetHeight || 50;
const vv = window.visualViewport;
const vw = vv ? vv.width : window.innerWidth;
const vh = vv ? vv.height : window.innerHeight;
let x = bRect.left + bRect.width / 2 - aw / 2;
x = Math.max(10, Math.min(vw - aw - 10, x));
let y = bRect.top - ah - 8;
const below = bRect.bottom + 8;
const aboveFits = y >= 50;
const belowFits = below + ah <= vh - 8;
y = aboveFits || !belowFits ? y : below;
msgActions.style.left = x + 'px';
msgActions.style.top = y + 'px';
}
body.addEventListener('contextmenu', (e) => {
// 长按/右键由应用接管：抑制系统默认菜单与文本选中，但不吞掉「引用气泡跳原消息」等其它元素自身行为
if (e.target.closest('.msg-bubble') && !e.target.closest('.msg-quote')) e.preventDefault();
});
body.addEventListener('touchstart', (e) => {
const r = msgActionEligible(e.target);
if (!r) return;
msgHoldEl = r.item;
msgHoldTimer = setTimeout(() => {
msgHoldTimer = null;
msgHoldFired = true;
msgSuppressClickUntil = Date.now() + 800; // 松开后抑制随之而来的轻点，防菜单被刚弹即关
if (window.getSelection) { try { const s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (err) {} }
openMsgActionsAt(msgHoldEl, r.b);
}, 500);
}, { passive: true });
function endMsgHold() { if (msgHoldTimer) { clearTimeout(msgHoldTimer); msgHoldTimer = null; } }
body.addEventListener('touchmove', endMsgHold, { passive: true });   // 手指滑动=滚动，取消长按
body.addEventListener('touchend', endMsgHold);
body.addEventListener('touchcancel', endMsgHold);
body.addEventListener('click', (e) => {
if (msgSuppressClickUntil && Date.now() < msgSuppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
const r = msgActionEligible(e.target);
if (!r) {
if (!e.target.closest('.msg-bubble') && !e.target.closest('.msg-quote')) closeMsgActions();
return;
}
e.stopPropagation();
openMsgActionsAt(r.item, r.b);
});
document.addEventListener('click', (e) => {
if (msgActions && !msgActions.hidden && !msgActions.contains(e.target)) closeMsgActions();
});
}
if (msgActions) {
msgActions.addEventListener('click', (e) => {
const btn = e.target.closest('.ma-btn');
if (!btn) return;
const act = btn.dataset.act;
const idx = activeMsgEl ? Number(activeMsgEl.dataset.idx) : -1;
const rec = (idx >= 0 && msgs[idx]) ? msgs[idx] : null;
if (act === 'quote') {
if (rec) {
const qsnap = quoteTextOf(rec);
lastQuote = { side: rec.side, text: qsnap.text, type: rec.type, imgs: qsnap.imgs, idx: idx };
renderDraft();
}
closeMsgActions();
} else if (act === 'fav') {
if (rec) {
const fav = getFav();
// v3.26.x 修复（iOS 反馈：收藏 5 条页面只显示 3 条、再收藏提示已收藏过却没显示）：
// 判重只限「我的」收藏（TA 自动收藏的 by:'ta' 副本在另一个 tab，不应挡住我的收藏），
// 且加 ts 比较——同文案的不同消息（时间戳不同）允许分别收藏，仅拦截同一条消息重复点收藏
if (fav.some(f => (f.by || 'me') !== 'ta' && f.side === rec.side && (f.text || '') === (rec.text || '') && (!rec.ts || f.ts === rec.ts))) {
toast('已收藏过这条消息');
} else {
fav.push({ side: rec.side, text: rec.text, type: rec.type || 'text', ts: rec.ts || Date.now(), by: 'me', mood: (rec.mood || []).slice(), parts: rec.parts && rec.parts.length ? rec.parts.map(p => ({ k: p.k, v: p.v, sub: p.sub })) : undefined });
saveFav(fav);
toast('已收藏到我的收藏');
}
}
closeMsgActions();
} else if (act === 'retract') {
if (activeMsgEl) retractMsg(activeMsgEl, 'out');
closeMsgActions();
} else if (act === 'edit') {
if (rec && window.openModal) {
const orig = rec.text;
// #142：媒体池令牌展开——图片消息 text 已令牌化（@@m:<hash>），编辑入口先解出
// 原 dataURL 判定图片消息（输入框置空）；否则令牌字符串会进输入框被当文字保存
const _origMedia = (window.mochiMediaExpand && window.mochiMediaExpand(orig)) || null;
const editEl = activeMsgEl;
window.openModal('编辑消息', (_origMedia || orig.indexOf('data:') === 0) ? '' : orig, (v) => {
const val = (v || '').trim();
if (!val) return;
rec.text = val;
rec.type = 'text';
// v3.26.x 修复（红米 K80 Chrome）：普通文字消息渲染走 rec.parts（renderMsg 的
// parts 分支优先于 rec.text）。旧逻辑只改 rec.text，发送新消息触发该气泡重渲染时，
// 老 parts 里的原文被重新渲染出来 → 编辑内容「变回编辑前」。重建 parts：保留图片段，
// 文字段替换为新值。
rec.parts = (Array.isArray(rec.parts) ? rec.parts.filter(p => p && p.k !== 'text') : []);
rec.parts.push({ k: 'text', v: val });
syncFavMsgText(orig, val); // v3.7.x：编辑后收藏夹里同一条消息快照同步更新（含 TA 收藏）
sessionChangedIdx.add(idx); // v3.6.x：标记本会话变更，防 loadMsgs 合并回滚编辑
saveMsgs();
syncLastMineText(); // v3.6.x：编辑后 TA 引用/收藏不再拿旧文本
const b = editEl && editEl.querySelector('.msg-bubble');
if (b) b.innerHTML = '<span style="opacity:.85">' + escTxt(val) + '</span>';
});
}
closeMsgActions();
} else if (act === 'del') {
if (activeMsgEl && idx >= 0 && msgs[idx] && msgs[idx].side === 'in') {
chatTailDrop(msgs[idx]); // FIX 2026-09-05 #185 删除消息同步从尾巴日志摘除，防刷新后 chatTailMerge 回放复活（与撤回同口径）
msgs.splice(idx, 1);
sessionChangedIdx.clear();
saveMsgs();
renderWindow(true);
toast('已删除该消息');
}
closeMsgActions();
}
});
}
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) {
t = document.createElement('div');
t.id = 'cc-toast';
document.body.appendChild(t);
}
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
t.style.opacity = '';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
const favPage = document.getElementById('page-fav');
const favList = document.getElementById('fav-list');
let favTab = 'mine'; // mine=我的收藏 ta=联系人的收藏
let favKind = 'all'; // 收藏分类筛选：all=全部 msg=聊天消息 card=互动卡片 mail=信件 feed=朋友圈
let favBatch = false;   // v3.31.x 批量管理模式（多选删除）
let favBatchSel = [];   // 批量模式选中的收藏对象引用（与当次渲染的数组同源，切 tab/分类后被收窄）
let favBatchArr = null; // 当次渲染使用的收藏数组引用（批量删除直接改它，避免重复 getFav 解析导致引用失效）
let favBatchVis = [];   // 当前 tab+分类筛选下可见条目（全选用）
const FAV_KINDS = [
{ k: 'all', label: '全部', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>' },
{ k: 'msg', label: '聊天', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>' },
{ k: 'card', label: '互动', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 14h4"/></svg>' },
{ k: 'mail', label: '信件', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' },
{ k: 'feed', label: '朋友圈', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9.5" r="2.2"/><path d="M14.5 19c0-2 2-3.5 4-3.5s2.5 1.5 2.5 3.5"/></svg>' }
];
// v3.31.x 批量管理：按当前勾选数同步底部操作栏（删除按钮文案/可用态 + 全选按钮文案）
function syncBatchBar() {
const delBtn = document.getElementById('fav-batch-del');
if (delBtn) {
delBtn.textContent = '删除' + (favBatchSel.length ? '(' + favBatchSel.length + ')' : '');
delBtn.disabled = !favBatchSel.length;
}
const allBtn = document.getElementById('fav-batch-all');
if (allBtn) allBtn.textContent = (favBatchVis.length && favBatchSel.length === favBatchVis.length) ? '取消全选' : '全选';
}
function renderFav() {    if (!favList) return;
const fav = getFav();
favList.innerHTML = '';
const partnerName = chatPartnerName();
const myName = chatUserName();
const myFav = fav.filter(f => f.by !== 'ta');
const taFav = fav.filter(f => f.by === 'ta');
const tabsEl = document.getElementById('fav-tabs');
if (tabsEl) {
tabsEl.querySelectorAll('.fav-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === favTab));
}
const list = favTab === 'ta' ? taFav : myFav;
const kindTabsEl = document.getElementById('fav-kind-tabs');
if (kindTabsEl) {
const counts = { all: list.length, msg: 0, card: 0, mail: 0, feed: 0 };
list.forEach(f => { const k = f.kind || 'msg'; if (k in counts) counts[k]++; });
kindTabsEl.querySelectorAll('.fav-tab').forEach(t => {
const k = t.dataset.kind;
t.classList.toggle('sel', k === favKind);
const n = counts[k] || 0;
const cnt = t.querySelector('.fav-tab-cnt');
if (cnt) cnt.textContent = n > 0 ? String(n) : '';
});
}
const list2 = favKind === 'all' ? list : list.filter(f => (f.kind || 'msg') === favKind);
list2.sort((a, b) => (b.ts || 0) - (a.ts || 0));
// v3.31.x 批量管理：记录本次渲染的数组与可见条目；勾选只保留当前筛选下仍可见的（切 tab/分类自动收窄）
favBatchArr = fav;
favBatchVis = list2;
if (favBatch) favBatchSel = favBatchSel.filter(s => list2.indexOf(s) >= 0);
const manageBtn = document.getElementById('fav-manage-btn');
if (manageBtn) manageBtn.classList.toggle('sel', favBatch);
const barEl = document.getElementById('fav-batch-bar');
if (barEl) { barEl.hidden = !favBatch; syncBatchBar(); }
const title = favTab === 'ta' ? partnerName + ' 的收藏' : myName + ' 的收藏';
let empty = favTab === 'ta' ? 'TA 还没有收藏' : '暂无收藏';
if (favKind !== 'all') {
const K_EMPTY = { msg: '聊天消息', card: '互动卡片', mail: '信件', feed: '朋友圈' };
empty = (favTab === 'ta' ? 'TA 还没有收藏' : '暂无') + K_EMPTY[favKind];
}
const h = document.createElement('div');
h.className = 'cc-group-header';
h.innerHTML = '<span class="ccg-name">' + title + '</span><span class="ccg-count">' + list2.length + '</span>';
favList.appendChild(h);
if (!list2.length) {
favList.innerHTML += '<div class="fav-empty">' + empty + '</div>';
return;
}
const FAV_KIND_LABEL = {
'ask-choose': '小问题', 'ask-curious': '好奇', 'ask-roast': '吐槽',
'ask-card': '问问TA', 'invite': '邀请TA', 'ask': '问问TA',
'redpacket': '红包', 'flower': '送花', 'gift': '礼物', 'dish': '佳肴'
};
function favTextHtml(s) {
const str = String(s || '');
let html = '';
const re = /((?:sticker|image):)?(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/g;
let last = 0, mm;
while ((mm = re.exec(str))) {
html += escTxt(str.slice(last, mm.index));
html += '<img class="fav-item-img" src="' + mm[2] + '" alt="图片" loading="lazy" decoding="async">';
last = mm.index + mm[0].length;
}
html += escTxt(str.slice(last));
return html;
}
list2.forEach(f => renderFavItem(f));
function renderFavItem(f) {
const kind = f.kind || 'msg';
const m = document.createElement('div');
m.className = 'msg ' + (f.side === 'out' ? 'msg-out' : 'msg-in');
const timeHtml = f.ts ? '<span class="msg-time">' + fmtTime(f.ts) + '</span>' : '';
const side = '<div class="msg-side"><div class="msg-av"></div>' + timeHtml + '</div>';
if (kind === 'card') {
const label = FAV_KIND_LABEL[f.special] || '互动卡片';
let html = '<div class="fav-item-card">' +
'<span class="fav-item-tag">互动卡片 · ' + label + '</span>' +
'<div class="fav-item-q">' + (f.special === 'invite' ? (window.taFit ? window.taFit('邀请TA') : '邀请TA') + ' · ' : '') + escTxt(f.q || '') + '</div>';
if (f.mine) html += '<div class="fav-item-a">✓ 我：' + escTxt(f.mine) + '</div>';
if (f.ta) html += '<div class="fav-item-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(f.ta) : f.ta) + '</div>';
if (!f.mine && !f.ta) html += '<div class="fav-item-tip">等待回应…</div>';
html += '</div>';
m.innerHTML = html + side;
fillAvatar(m.querySelector('.msg-av'), 'cs-avatar-user');
} else if (kind === 'mail') {
const tag = f.mailType === 'received' ? '信箱来信' : '信箱回信';
let html = '<div class="fav-item-card">' +
'<span class="fav-item-tag">' + tag + (f.title ? ' · 《' + escTxt(f.title) + '》' : '') + '</span>' +
'<div class="fav-item-body">' + favTextHtml(f.text) + '</div>' +
'</div>';
// v3.26.x：信件收藏不显示头像——不再复用聊天行的 .msg-av 头像槽（时间保留），纯卡片观感
m.innerHTML = html + '<div class="msg-side">' + timeHtml + '</div>';
} else if (kind === 'feed') {
let html = '<div class="fav-item-card">' +
'<span class="fav-item-tag">朋友圈动态</span>' +
(f.text ? '<div class="fav-item-body">' + favTextHtml(f.text) + '</div>' : '') +
((f.imgs && f.imgs.length) ? '<div class="fav-item-imgs">' + f.imgs.map(u => '<img src="' + attrEsc(u) + '" alt="图片" loading="lazy" decoding="async">').join('') + '</div>' : '') +
'</div>';
m.innerHTML = html + side;
fillAvatar(m.querySelector('.msg-av'), 'cs-avatar-user');
} else {
m.innerHTML = f.side === 'out'
? '<div class="msg-bubble"></div>' + side
: side + '<div class="msg-bubble"></div>';
const b = m.querySelector('.msg-bubble');
if (f.parts && f.parts.length) {
const imgs = f.parts.filter(p => p.k === 'img');
const textPart = f.parts.filter(p => p.k === 'text').map(p => p.v).join(' ');
let inner = '';
if (imgs.length) {
inner += '<div class="msg-parts-imgs' + (imgs.length > 1 ? ' multi' : '') + '">' +
imgs.map(p => {
const isSticker = p.sub === 'sticker';
return '<img class="msg-img' + (isSticker ? ' msg-img-sm' : ' msg-img-big') + '" src="' + attrEsc(p.v) + '" alt="' + (isSticker ? '表情' : '图片') + '" loading="lazy" decoding="async">';
}).join('') + '</div>';
}
if (textPart) inner += '<span style="opacity:.85;word-break:break-word">' + escTxtBr(textPart) + '</span>';
b.innerHTML = inner;
b.querySelectorAll('.msg-img-big').forEach(img => {
img.addEventListener('click', (e) => {
e.stopPropagation();
if (window.viewChatImage) window.viewChatImage(img.src);
});
});
} else {
const isVoice = f.type === 'voice' || (typeof f.text === 'string' && f.text.indexOf('|||data:audio/') > 0);
const isImg = f.type === 'sticker' || f.type === 'image' || (typeof f.text === 'string' && f.text.indexOf('data:') === 0);
if (isVoice) {
b.style.padding = '8px 10px';
fillVoiceBubble(b, f.text);
} else if (isImg) {
b.style.padding = '6px';
b.innerHTML = '<img class="msg-img" src="' + attrEsc(f.text) + '" alt="表情">';
} else {
b.innerHTML = '<span style="opacity:.85">' + escTxtBr(f.text) + '</span>';
}
}
if (f.mood && f.mood.length) {
  f.mood.forEach(md => {
    const dupFav = md.label != null && String(md.label) !== '' && String(md.label) === String(f.text == null ? '' : f.text);
    if (md.tag === '交流意图') {
      b.innerHTML += '<div class="msg-mood msg-intent"><span class="msg-mood-tag">' + md.tag + '</span>' + (dupFav ? '' : '<span>' + md.label + '</span>') + '</div>';
    } else {
      b.innerHTML += '<div class="msg-mood"><span class="msg-mood-tag">' + md.tag + '</span>' + (dupFav ? '' : '<span>' + md.label + '</span>') + '</div>';
    }
  });
}
fillAvatar(m.querySelector('.msg-av'), f.side === 'out' ? 'cs-avatar-user' : 'cs-avatar-partner');
}
if (kind === 'feed') {
m.querySelectorAll('.fav-item-imgs img').forEach(im => im.addEventListener('click', (e) => {
e.stopPropagation();
if (window.viewChatImage) window.viewChatImage(im.src);
}));
}
function matchFav(x) {
return (x.kind || 'msg') === kind &&
(x.q || '') === (f.q || '') && (x.text || '') === (f.text || '') && x.ts === f.ts;
}
// v3.31.x 批量管理：条目变多选——外侧加圆圈勾选，点击整条切换勾选；
// 用捕获阶段监听，抢先于气泡内图片的 click（查看大图）并 stopPropagation 拦下
if (favBatch) {
const ck = document.createElement('div');
ck.className = 'fav-check' + (favBatchSel.indexOf(f) >= 0 ? ' on' : '');
ck.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
if (f.side === 'out') m.appendChild(ck); else m.insertBefore(ck, m.firstChild);
m.addEventListener('click', (e) => {
e.stopPropagation();
const i = favBatchSel.indexOf(f);
if (i >= 0) favBatchSel.splice(i, 1); else favBatchSel.push(f);
ck.classList.toggle('on', favBatchSel.indexOf(f) >= 0);
syncBatchBar();
}, true);
favList.appendChild(m);
return;
}
let pressTimer = null;
m.addEventListener('touchstart', (e) => {
pressTimer = setTimeout(() => {
const fav2 = getFav();
const idx2 = fav2.findIndex(matchFav);
if (idx2 >= 0) {
if (window.openModal) {
window.openModal('删除这条收藏？', '', () => {
fav2.splice(idx2, 1);
saveFav(fav2);
renderFav();
}, { noInput: true });
}
}
}, 600);
}, { passive: true });
m.addEventListener('touchend', () => clearTimeout(pressTimer));
m.addEventListener('touchmove', () => clearTimeout(pressTimer));
m.addEventListener('contextmenu', (e) => {
e.preventDefault();
const fav2 = getFav();
const idx2 = fav2.findIndex(matchFav);
if (idx2 >= 0 && window.openModal) {
window.openModal('删除这条收藏？', '', () => {
fav2.splice(idx2, 1);
saveFav(fav2);
renderFav();
}, { noInput: true });
}
});
favList.appendChild(m);
}
}
const favTabs = document.getElementById('fav-tabs');
if (favTabs) {
favTabs.addEventListener('click', (e) => {
const tb = e.target.closest('.fav-tab');
if (!tb) return;
favTab = tb.dataset.tab;
renderFav();
});
}
const favKindTabs = document.createElement('div');
favKindTabs.className = 'fav-tabs fav-kind-row';
favKindTabs.id = 'fav-kind-tabs';
favKindTabs.innerHTML = FAV_KINDS.map(o => '<button class="fav-tab" data-kind="' + o.k + '">' + o.icon + '<span class="fav-tab-label">' + o.label + '</span><span class="fav-tab-cnt"></span></button>').join('');
if (favTabs && favTabs.parentNode) favTabs.parentNode.insertBefore(favKindTabs, favTabs.nextSibling);
favKindTabs.addEventListener('click', (e) => {
const tb = e.target.closest('.fav-tab');
if (!tb) return;
favKind = tb.dataset.kind;
renderFav();
});
// v3.31.x 批量管理：顶栏入口 / 底部操作栏（取消 / 全选 / 删除）
const favManageBtn = document.getElementById('fav-manage-btn');
if (favManageBtn) {
favManageBtn.addEventListener('click', () => {
favBatch = !favBatch;
favBatchSel = [];
renderFav();
if (favBatch) toast('点选要删除的收藏');
});
}
const favBatchCancel = document.getElementById('fav-batch-cancel');
if (favBatchCancel) {
favBatchCancel.addEventListener('click', () => {
favBatch = false;
favBatchSel = [];
renderFav();
});
}
const favBatchAll = document.getElementById('fav-batch-all');
if (favBatchAll) {
favBatchAll.addEventListener('click', () => {
if (!favBatch) return;
const all = favBatchVis.length && favBatchSel.length === favBatchVis.length;
favBatchSel = all ? [] : favBatchVis.slice();
renderFav();
});
}
const favBatchDel = document.getElementById('fav-batch-del');
if (favBatchDel) {
favBatchDel.addEventListener('click', () => {
if (!favBatch || !favBatchSel.length) return;
const n = favBatchSel.length;
if (!window.openModal) return;
window.openModal('删除选中的 ' + n + ' 条收藏？', '', () => {
favBatchSel.forEach(s => { const i = favBatchArr ? favBatchArr.indexOf(s) : -1; if (i >= 0) favBatchArr.splice(i, 1); });
if (favBatchArr) saveFav(favBatchArr);
favBatchSel = [];
renderFav();
toast('已删除 ' + n + ' 条收藏');
}, { noInput: true });
});
}
window.renderFav = renderFav;
const favApp = document.querySelector('.app[data-app="note"]');
if (favApp && favPage) {
favApp.addEventListener('click', () => {
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) return;
document.querySelectorAll('.page').forEach(p => p.hidden = true);
favPage.hidden = false;
renderFav();
});
}
const favBack = document.getElementById('fav-back');
if (favBack) {
favBack.addEventListener('click', () => {
favBatch = false; // v3.31.x 离开收藏页退出批量模式
favBatchSel = [];
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const phonePage = document.getElementById('page-phone');
if (phonePage) phonePage.hidden = false;
});
}
const emojiPanel = document.getElementById('emoji-panel');
const emojiList = document.getElementById('emoji-list');
const emojiClose = document.getElementById('emoji-close');
const emojiBtn = document.getElementById('chat-emoji-btn');
const emojiGroupsBar = document.getElementById('emoji-groups');
const emojiTools = document.getElementById('emoji-tools');
const emojiBatch = document.getElementById('emoji-batch');
const emojiBatchCount = document.getElementById('emoji-batch-count');
let emojiMode = 'ta';        // public（公用表情包）/ ta（联系人专属）/ mine（跨会话记住上次模式）
let emojiCurGroup = '';      // 联系人专属表情包分组筛选（记住上次打开的分组）
let pubCurGroup = '';        // 公用表情包分组筛选（记住上次打开的分组）
let myCurGroup = '';         // 我的表情包分组筛选（记住上次打开/上传进的分组）
let myBatchMode = false;     // 批量管理模式
let myGroups = [];           // 我的表情包 [[分组名, [dataURL...]], ...]
let mySel = new Set();       // 批量勾选：分组名\u0001索引
let emojiInsertCb = null;    // v3.6.x：写信/回信「插入模式」回调（点击表情插入信纸）
let emojiInsertAllowUrl = false;
const MYE_G_PREFIX = 'xy-home-v2';
function myEmojiStore() { return window.xyStore(MYE_G_PREFIX); }
function MYE_KEY() { return MYE_G_PREFIX + ':my-emoji-groups'; }
function taStickerHidden() {
try { if (window.xyStore) return window.xyStore(MYE_G_PREFIX).get('hide-ta-sticker') === '1'; } catch (e) {}
try { return store.get('hide-ta-sticker') === '1'; } catch (e) { return false; }
}
myGroups = myEmojiLoad();
function saveEmojiGroupPref() {
// v3.15.x：mode 一并持久化——每次打开表情包直接落在上次用的模式+分组，不用重复点
store.set('emoji-last', JSON.stringify({ mode: emojiMode, ta: emojiCurGroup, mine: myCurGroup, pub: pubCurGroup }));
}
// v3.26.x：把上次 tab/分组偏好恢复抽成函数，在模块初始化 + 每次打开面板 + 切换联系人时
// 都用 store 里的 emoji-last 重新落位——确保打开表情包永远落在「上次用的顶部分组 + 上次打开的表情包分组」，
// 不再因为 idbRestore 晚于模块初始化（回填前读空）或切换联系人后没重读而回退到默认「TA 的表情包」。
function loadEmojiPref() {
try {
const pref = JSON.parse(store.get('emoji-last') || 'null');
if (pref && typeof pref === 'object') {
if (pref.mode === 'public' || pref.mode === 'ta' || pref.mode === 'mine') emojiMode = pref.mode;
if (typeof pref.ta === 'string') emojiCurGroup = pref.ta;
if (typeof pref.mine === 'string') myCurGroup = pref.mine;
if (typeof pref.pub === 'string') pubCurGroup = pref.pub;
}
} catch (e) {}
}
loadEmojiPref();
function myEmojiLoad() {
try { const v = JSON.parse(myEmojiStore().get('my-emoji-groups') || 'null'); if (Array.isArray(v)) return v; } catch (e) {}
return [];
}
// FIX 2026-09-05 #172 我的表情包刷新必丢：超启动回填预算的大键（实例 34.93MB）每次刷新都被
// idbRestore 挂起在 __xyIdbDeferredKeys，且大键从不落 localStorage 快照——store 三路全空，
// 唯一恢复链是裸 idbGet 固定 4s+4s 超时，低端机读不完即静默放弃 → 面板永远空（用户视角=
// 每次刷新全丢）；恢复失败期间保存还会把空态写回、把 IDB 全量顶掉。修复三件套（与字卡库
// hydrateScope 同机制）：
//   ① myeApplyIdb：读到 IDB 值后的统一应用（内容更多才覆盖 + 面板开着即重绘，原 tryRestore/
//      reloadMyEmojiFromIdb 两处重复逻辑收口）；
//   ② myeHydrateFallback：idbGet 读空时走 idbHydrateKey 按需取回（6s+8s 慢读友好、成功后
//      进驻存并移出挂起名单），tryRestore 重试穷尽 / reloadMyEmojiFromIdb 共用；
//   ③ myEmojiSave 防覆盖闸门：该键仍挂起（=本会话从未成功恢复全量）时先取回 IDB 全量与
//      内存新增按分组去重合并再写，防几十 MB 表情包被小包覆盖成真丢失。
function myeApplyIdb(v) {
try {
const data = typeof v === 'string' ? JSON.parse(v) : v;
if (!Array.isArray(data)) return false;
const cnt = (g) => { let n = 0; g.forEach(x => n += (Array.isArray(x[1]) ? x[1].length : 0)); return n; };
// #172：与内存面板态（myGroups）比张数——挂起场景下 hydrate 会把全量写进 store 层，
// 与内存脱节，若以 store 快照为基准会误判「同量不覆盖」→ 恢复永不落内存（面板仍空）
const lc = Array.isArray(myGroups) ? cnt(myGroups) : -1;
if (lc < 0 || cnt(data) > lc) {
myGroups = data;
if (!emojiPanel.hidden) renderEmojiPanel();
}
return true;
} catch (e) { return false; }
}
function myeHydrateFallback() {
if (!window.idbHydrateKey) return;
window.idbHydrateKey(MYE_KEY()).then(ok => {
if (ok !== true) return;
try { const raw = myEmojiStore().get('my-emoji-groups'); if (raw) myeApplyIdb(raw); } catch (e) {}
});
}
function myEmojiSave() {
// #172 防覆盖闸门：挂起名单仍含本键 = 本会话没恢复过全量，盲写会顶掉 IDB 全量
if (window.__xyIdbDeferredKeys && window.__xyIdbDeferredKeys.indexOf(MYE_KEY()) >= 0 && window.idbHydrateKey) {
window.idbHydrateKey(MYE_KEY()).then(ok => {
// 取回失败不写回——防用小包覆盖 IDB 全量；键保持挂起，本会话内下次保存/开面板再试
if (ok === false) return;
if (ok === true) {
try {
const full = JSON.parse(myEmojiStore().get('my-emoji-groups') || 'null');
if (Array.isArray(full)) {
full.forEach(g => {
if (!g || typeof g[0] !== 'string' || !Array.isArray(g[1])) return;
let t = myGroups.find(x => x[0] === g[0]);
if (!t) { myGroups.push([g[0], g[1].slice()]); return; }
g[1].forEach(item => { if (t[1].indexOf(item) < 0) t[1].push(item); });
});
}
} catch (e) {}
}
myEmojiStore().set('my-emoji-groups', JSON.stringify(myGroups));
});
return true;
}
myEmojiStore().set('my-emoji-groups', JSON.stringify(myGroups));
return true;
}
// FIX 2026-09-04 #154 朋友圈评论「我的表情包」与聊天面板不同步——把 chat 维护的
// 最新内存副本暴露给 feed.js：本副本经启动 tryRestore / 每次打开面板
// reloadMyEmojiFromIdb 以 IDB 权威值回读自愈；而 store 层对该键可能停在旧 LS 快照
//（大键不回写 LS、启动回填受驻留预算/LS 优先规则限制），朋友圈面板旧读法只看
// store 层，读不到 IDB 新值 → 两侧不同步。
window.getMyEmojiGroups = function () { return myGroups || []; };
(function () {
if (!window.idbGet) return;
let retry = 0;
function tryRestore() {
window.idbGet(MYE_KEY()).then(v => {
// #172：重试穷尽仍读空 → idbHydrateKey 兜底（大键挂起/慢读场景裸 idbGet 永远拿不到值）
if (!v) { if (retry < 3) { retry++; setTimeout(tryRestore, 800 * retry); } else myeHydrateFallback(); return; }
myeApplyIdb(v);
});
}
tryRestore();
})();
(function () {
const gStore = myEmojiStore();
let started = false;
const cntOf = (g) => { let n = 0; (g || []).forEach(x => n += (Array.isArray(x[1]) ? x[1].length : 0)); return n; };
function parseArr(v) {
try { const d = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(d)) return d; } catch (e) {}
return null;
}
function mergeInto(merged, src) {
(src || []).forEach(g => {
if (!g || typeof g[0] !== 'string' || !Array.isArray(g[1])) return;
let t = merged.find(x => x[0] === g[0]);
if (!t) { t = [g[0], []]; merged.push(t); }
g[1].forEach(item => { if (t[1].indexOf(item) < 0) t[1].push(item); });
});
}
function finish(merged) {
try {
if (cntOf(merged)) gStore.set('my-emoji-groups', JSON.stringify(merged));
(window.getContacts ? window.getContacts() : [{ id: 'default' }]).forEach(c => {
try { window.storeFor(c.id || 'default').remove('my-emoji-groups'); } catch (e) {}
});
try { gStore.set('mye-global-migrated', '1'); } catch (e) {}
} catch (e) { try { gStore.set('mye-global-migrated', '1'); } catch (e2) {} }
if (cntOf(merged) && cntOf(merged) !== cntOf(myGroups)) {
myGroups = merged;
if (!emojiPanel.hidden) renderEmojiPanel();
}
}
function run() {
if (started) return;
started = true;
try {
if (gStore.get('mye-global-migrated') === '1') return;
const cids = ((window.getContacts && window.getContacts()) || [{ id: 'default' }]).map(c => c.id || 'default');
const cur = window.__activeCid || 'default';
const order = cids.indexOf(cur) >= 0 ? [cur].concat(cids.filter(c => c !== cur)) : cids;
const merged = [];
order.forEach(c => { try { mergeInto(merged, parseArr(window.storeFor(c).get('my-emoji-groups'))); } catch (e) {} });
mergeInto(merged, parseArr(gStore.get('my-emoji-groups'))); // 顶层旧键快照（= 全局键）
if (!window.idbGet) { finish(merged); return; }
const reads = order.map(c => MYE_G_PREFIX + ':' + c + ':my-emoji-groups');
reads.push(MYE_KEY()); // 顶层旧键 IDB 权威
Promise.all(reads.map(k => window.idbGet(k).catch(() => null))).then(vals => {
vals.forEach(v => { const d = parseArr(v); if (d) mergeInto(merged, d); });
finish(merged);
});
} catch (e) { try { gStore.set('mye-global-migrated', '1'); } catch (e2) {} }
}
if (window.__mochiDataReady) run();
else document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
run();
});
})();
function quoteValue(q) {
if (!q) return null;
if (q.imgs && q.imgs.length) return { t: q.text, imgs: q.imgs };
return q.text;
}
function sendSticker(src) {
const inputEl = document.getElementById('chat-input');
const text = (inputEl ? (inputEl.textContent || '') : '').trim();
const quote = lastQuote ? { q: quoteValue(lastQuote), s: lastQuote.side, i: lastQuote.idx } : null;
if (quote) { lastQuote = null; renderDraft(); }
if (text) {
lastMineText = text;
const rec = { side: 'out', text: text, parts: [{ k: 'text', v: text }, { k: 'img', v: src, sub: 'sticker' }] };
if (quote) { rec.quote = quote.q; rec.qside = quote.s; if (typeof quote.i === 'number' && quote.i >= 0) rec.qidx = quote.i; }
addRec(rec);
if (inputEl) inputEl.textContent = '';
renderDraft();
if (window.logFish) window.logFish();
scheduleReply();
} else {
lastMineText = src;
const rec = { side: 'out', text: src, type: 'sticker', parts: [{ k: 'img', v: src }] };
if (quote) { rec.quote = quote.q; rec.qside = quote.s; if (typeof quote.i === 'number' && quote.i >= 0) rec.qidx = quote.i; }
addRec(rec);
if (window.logFish) window.logFish();
scheduleReply();
}
closeEmojiPanel();
}
function renderEmojiGroupsBar() {
if (!emojiGroupsBar) return;
emojiGroupsBar.innerHTML = '';
let list = [];
let cur = '';
if (emojiMode === 'public') {
list = (window.getScopedGroups && window.getScopedGroups('sticker', 'public')) || [];
cur = pubCurGroup;
} else if (emojiMode === 'ta') {
list = (window.getScopedGroups && window.getScopedGroups('sticker', 'own')) || [];
cur = emojiCurGroup;
} else {
list = myGroups;
cur = myCurGroup;
}
if (cur && !list.some(g => g[0] === cur)) cur = '';
const chips = list.filter(g => emojiMode === 'mine' ? true : g[1].length).map(g => [g[0], g[0] + g[1].length]);
chips.forEach(([val, label]) => {
const c = document.createElement('span');
c.className = 'emoji-g-chip' + (cur === val ? ' sel' : '');
c.textContent = label;
c.addEventListener('click', (e) => {
e.stopPropagation();
if (emojiMode === 'public') pubCurGroup = (cur === val ? '' : val);
else if (emojiMode === 'ta') emojiCurGroup = (cur === val ? '' : val);
else myCurGroup = (cur === val ? '' : val);
saveEmojiGroupPref();
renderEmojiPanel();
});
emojiGroupsBar.appendChild(c);
});
}
function renderEmojiGroup(gname, arr, mode) {
const grid = document.createElement('div');
grid.className = 'emoji-grid';
arr.forEach((src, i) => {
const d = document.createElement('div');
d.className = 'emoji-item';
if (mode === 'mine' && myBatchMode) {
const k = gname + '\u0001' + i;
const on = mySel.has(k);
d.classList.toggle('sel', on);
const img = document.createElement('img');
img.src = src;
img.alt = '表情';
d.appendChild(img);
if (on) {
const ck = document.createElement('span');
ck.className = 'emoji-check';
ck.textContent = '✓';
d.appendChild(ck);
}
d.addEventListener('click', () => {
if (mySel.has(k)) mySel.delete(k); else mySel.add(k);
updateBatchCount();
d.classList.toggle('sel', mySel.has(k));
let ck = d.querySelector('.emoji-check');
if (mySel.has(k)) {
if (!ck) { ck = document.createElement('span'); ck.className = 'emoji-check'; ck.textContent = '✓'; d.appendChild(ck); }
} else if (ck) {
ck.remove();
}
});
} else {
const img = document.createElement('img');
img.src = src;
img.alt = '表情';
d.appendChild(img);
d.addEventListener('click', () => {
if (emojiInsertCb) {
if (!/^data:/i.test(src) && !emojiInsertAllowUrl) { toast('链接保存的表情暂不支持插入信纸，请发送消息使用'); return; }
const cb = emojiInsertCb;
emojiInsertCb = null;
emojiInsertAllowUrl = false;
cb(src);
closeEmojiPanel();
} else {
sendSticker(src);
}
});
}
grid.appendChild(d);
});
emojiList.appendChild(grid);
}
function updateBatchCount() {
if (emojiBatchCount) emojiBatchCount.textContent = '已选 ' + mySel.size + ' 张';
}
function renderEmojiPanel() {
if (!emojiList) return;
const hts = taStickerHidden();
document.querySelectorAll('#emoji-panel .emoji-tab').forEach(t => { if (t.dataset.etab !== 'mine') t.hidden = hts; });
if (hts && emojiMode !== 'mine') emojiMode = 'mine';
document.querySelectorAll('#emoji-panel .emoji-tab').forEach(t => t.classList.toggle('sel', t.dataset.etab === emojiMode));
const taTabEl = document.querySelector('#emoji-panel .emoji-tab[data-etab="ta"]');
if (taTabEl) taTabEl.textContent = chatPartnerName() + ' 的表情包';
if (emojiTools) emojiTools.hidden = emojiMode !== 'mine';
if (emojiBatch) emojiBatch.hidden = !(emojiMode === 'mine' && myBatchMode);
renderEmojiGroupsBar();
emojiList.innerHTML = '';
if (emojiMode !== 'mine') {
const isPub = emojiMode === 'public';
const groups = (window.getScopedGroups && window.getScopedGroups('sticker', isPub ? 'public' : 'own')) || [];
const emptyAll = isPub
? '<div class="emoji-empty">暂无公用表情包<br>请到 字卡库 → 公用字卡 → 表情包 上传</div>'
: '<div class="emoji-empty">暂无表情包<br>请到 字卡库 → 专属字卡 → 表情包 上传</div>';
if (!groups.length) {
emojiList.innerHTML = emptyAll;
return;
}
const curn = isPub ? pubCurGroup : emojiCurGroup;
if (!curn || !groups.some(x => x[0] === curn)) {
emojiList.innerHTML = '<div class="emoji-empty">点击上方分组查看表情包</div>';
return;
}
const g = groups.find(x => x[0] === curn);
if (!g || !g[1].length) {
emojiList.innerHTML = isPub
? '<div class="emoji-empty">该分组暂无公用表情包<br>请到 字卡库 → 公用字卡 → 表情包 上传</div>'
: '<div class="emoji-empty">该分组暂无表情包<br>请到 字卡库 → 专属字卡 → 表情包 上传</div>';
return;
}
renderEmojiGroup(g[0], g[1], 'ta');
} else {
if (!myGroups.length) {
emojiList.innerHTML = '<div class="emoji-empty">暂无我的表情包<br>点击上方「添加」上传，或「新建分组」</div>';
return;
}
if (!myCurGroup) {
emojiList.innerHTML = '<div class="emoji-empty">点击上方分组查看表情包</div>';
return;
}
const g = myGroups.find(x => x[0] === myCurGroup);
if (!g || !g[1].length) {
emojiList.innerHTML = '<div class="emoji-empty">该分组暂无表情包<br>点击「添加」上传到该分组</div>';
return;
}
renderEmojiGroup(g[0], g[1], 'mine');
updateBatchCount();
}
}
function openEmojiPanel() {
if (!emojiPanel) return;
loadEmojiPref(); // v3.26.x：打开即按上次用的顶部分组+分组落位（覆盖 idbRestore 晚到 / 切换联系人未重读的场景）
reloadMyEmojiFromIdb();
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
if (window.closeAvlib) window.closeAvlib();
document.body.classList.remove('mail-emoji-mode');
myBatchMode = false;
mySel.clear();
closeIme(); // v3.5.116：收起输入法，面板完整不被键盘遮挡
renderEmojiPanel();
emojiPanel.hidden = false;
scrollChatBottom();
if (morePanel) morePanel.hidden = true;
hydrateCcForChatPanels(() => { if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel(); });
}
function closeEmojiPanel() {
if (emojiPanel) emojiPanel.hidden = true;
emojiInsertCb = null;
emojiInsertAllowUrl = false;
}
function reloadMyEmojiFromIdb() {
if (!window.idbGet) return;
window.idbGet(MYE_KEY()).then(v => {
// #172：读空（大键挂起/事务超时）不再静默放弃 → hydrate 按需取回
if (!v) { myeHydrateFallback(); return; }
myeApplyIdb(v);
});
}
document.addEventListener('contact-switched', function () {
myGroups = myEmojiLoad();
loadEmojiPref(); // v3.26.x：切换联系人后按该桌面的上次 tab/分组偏好落位，不复用上一桌面状态
if (!emojiPanel.hidden) renderEmojiPanel();
reloadMyEmojiFromIdb();
});
document.addEventListener('hide-ta-sticker-changed', function () {
if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel();
});
window.openEmojiPanelForInsert = function (cb, opts) {
emojiInsertCb = cb || null;
emojiInsertAllowUrl = !!(opts && opts.allowUrl);
openEmojiPanel();
document.body.classList.add('mail-emoji-mode');
};
window.closeEmojiPanelForInsert = closeEmojiPanel; // #145：群聊表情按钮切换关闭复用（面板同属聊天页共享浮层）
window.closeIme = function () { try { closeIme(); } catch (e) {} };
if (emojiBtn) {
emojiBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (emojiPanel && !emojiPanel.hidden) { closeEmojiPanel(); return; } // #145：再次点击=关闭（按钮切换开关）
emojiInsertCb = null; // 聊天入口始终是发消息
emojiInsertAllowUrl = false;
openEmojiPanel();
});
}
if (emojiClose) emojiClose.addEventListener('click', (e) => { e.stopPropagation(); closeEmojiPanel(); });
document.addEventListener('click', (e) => {
if (emojiPanel && !emojiPanel.hidden && !emojiPanel.contains(e.target) && !emojiBtn.contains(e.target)) closeEmojiPanel();
});
const batchPanel = document.getElementById('batch-panel');
const batchList = document.getElementById('batch-list');
const batchCount = document.getElementById('batch-count');
const batchText = document.getElementById('batch-text');
const batchBtn = document.getElementById('chat-batch-btn');
let batchItems = []; // [{type:'text'|'img'|'sticker', text?, src?}]
let batchPicking = false; // 文件选择器打开期间忽略「点击面板外关闭」，防选图后批量面板被误关
function batchEnabled() {
try { return store.get('cs-batch-send') === '1'; } catch (e) { return false; }
}
function closeBatchPanel() {
if (batchPanel) batchPanel.hidden = true;
try { if (batchText && document.activeElement === batchText) batchText.blur(); } catch (e) {}
}
function openBatchPanel(opts) {
if (!batchPanel) return;
if (opts && typeof opts.onSend === 'function') batchSendTarget = opts.onSend; else batchSendTarget = null;
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
closeEmojiPanel();
if (window.closeAvlib) window.closeAvlib();
closeIme(); // 收起输入法，面板完整不被键盘遮挡
renderBatchList();
batchPanel.hidden = false;
scrollChatBottom();
const morePanel = document.getElementById('chat-more-panel');
if (morePanel) morePanel.hidden = true;
}
// 外部（群聊等）打开批量面板并把条目发到自己的消息列表：window.openBatchPanelFor(onSend)
window.openBatchPanelFor = function (onSend) { openBatchPanel({ onSend: onSend }); };
function renderBatchList() {
if (!batchList) return;
if (batchCount) batchCount.textContent = batchItems.length + ' 条';
batchList.innerHTML = '';
if (!batchItems.length) {
batchList.innerHTML = '<div class="batch-empty">还没有要发送的消息<br>可添加文字 / 表情包 / 图片</div>';
return;
}
batchItems.forEach((it, i) => {
const row = document.createElement('div');
row.className = 'batch-item';
const idx = document.createElement('span');
idx.className = 'batch-item-idx';
idx.textContent = i + 1;
row.appendChild(idx);
if (it.type === 'text') {
const t = document.createElement('span');
t.className = 'batch-item-text';
t.textContent = it.text;
row.appendChild(t);
} else {
const img = document.createElement('img');
img.className = 'batch-item-media';
img.src = it.src;
img.alt = it.type === 'sticker' ? '表情包' : '图片';
row.appendChild(img);
}
const ty = document.createElement('span');
ty.className = 'batch-item-type';
ty.textContent = it.type === 'text' ? '文字' : (it.type === 'sticker' ? '表情包' : '图片');
row.appendChild(ty);
const x = document.createElement('button');
x.className = 'batch-item-x';
x.textContent = '✕';
x.addEventListener('click', () => { batchItems.splice(i, 1); renderBatchList(); });
row.appendChild(x);
batchList.appendChild(row);
});
}
function batchAddText() {
if (!batchText) return;
const v = (batchText.value || '').trim();
if (!v) { toast('请输入文字'); return; }
batchItems.push({ type: 'text', text: v });
batchText.value = '';
renderBatchList();
}
function batchAddImages(files) {
files.forEach(f => {
const reader = new FileReader();
reader.onload = () => {
const img = new Image();
img.onload = () => {
try {
const c = document.createElement('canvas');
const scale = Math.min(1, 720 / Math.max(img.width, img.height));
c.width = Math.max(1, Math.round(img.width * scale));
c.height = Math.max(1, Math.round(img.height * scale));
c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
batchItems.push({ type: 'img', src: c.toDataURL('image/jpeg', 0.85) });
} catch (err) {
batchItems.push({ type: 'img', src: reader.result });
}
renderBatchList();
};
img.onerror = () => {
batchItems.push({ type: 'img', src: reader.result });
renderBatchList();
toast('部分图片无法压缩，已按原图添加');
};
img.src = reader.result;
};
reader.readAsDataURL(f);
});
}
function sendBatchItem(it) {
if (it.type === 'text') {
lastMineText = it.text;
addRec({ side: 'out', text: it.text, parts: [{ k: 'text', v: it.text }] });
} else if (it.type === 'img') {
lastMineText = it.src;
addRec({ side: 'out', text: it.src, parts: [{ k: 'img', v: it.src, sub: 'image' }] });
} else {
lastMineText = it.src;
addRec({ side: 'out', text: it.src, type: 'sticker', parts: [{ k: 'img', v: it.src }] });
}
}
let batchSendTarget = null; // 群聊等外部页面打开批量面板时设置：function(items) 负责把条目发到自己的消息列表
function sendBatchAll() {
if (!batchItems.length) { toast('还没有要发送的消息'); return; }
const items = batchItems.slice();
batchItems = [];
renderBatchList();
closeBatchPanel();
if (window.playSfx) window.playSfx('out');
if (batchSendTarget) { batchSendTarget(items); if (window.logFish) window.logFish(); toast('已批量发送 ' + items.length + ' 条消息'); return; }
items.forEach(sendBatchItem);
if (window.logFish) window.logFish();
scheduleReply();
toast('已批量发送 ' + items.length + ' 条消息');
}
function syncBatchBtn() {
if (!batchBtn) return;
batchBtn.style.display = batchEnabled() ? '' : 'none';
if (!batchEnabled()) closeBatchPanel();
}
if (batchBtn) {
batchBtn.addEventListener('click', (e) => { e.stopPropagation(); openBatchPanel(); });
}
const batchClose = document.getElementById('batch-close');
if (batchClose) batchClose.addEventListener('click', (e) => { e.stopPropagation(); closeBatchPanel(); });
const batchAdd = document.getElementById('batch-text-add');
if (batchAdd) batchAdd.addEventListener('click', (e) => { e.stopPropagation(); batchAddText(); });
if (batchText) {
batchText.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); batchAddText(); }
});
}
const batchEmoji = document.getElementById('batch-emoji');
if (batchEmoji) {
batchEmoji.addEventListener('click', (e) => {
e.stopPropagation();
closeBatchPanel();
if (window.openEmojiPanelForInsert) {
window.openEmojiPanelForInsert((src) => {
batchItems.push({ type: 'sticker', src: src });
renderBatchList();
openBatchPanel(); // 重新打开批量面板，方便继续添加 / 发送
});
} else {
toast('表情包面板暂不可用');
}
});
}
const batchImg = document.getElementById('batch-img');
if (batchImg) {
batchImg.addEventListener('click', (e) => {
e.stopPropagation();
batchPicking = true;
const fi = document.createElement('input');
fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true;
fi.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
document.body.appendChild(fi);
fi.onchange = () => {
batchPicking = false;
const files = Array.prototype.slice.call(fi.files || []);
fi.value = '';
try { fi.remove(); } catch (err2) {}
if (files.length) batchAddImages(files);
};
fi.onblur = () => {
setTimeout(() => {
batchPicking = false;
try { if (fi.parentNode) fi.remove(); } catch (err2) {}
}, 800);
};
try { fi.click(); } catch (err2) { batchPicking = false; try { fi.remove(); } catch (err3) {} }
});
}
const batchClear = document.getElementById('batch-clear');
if (batchClear) batchClear.addEventListener('click', (e) => { e.stopPropagation(); batchItems = []; renderBatchList(); });
const batchSendAll = document.getElementById('batch-send-all');
if (batchSendAll) batchSendAll.addEventListener('click', (e) => { e.stopPropagation(); sendBatchAll(); });
document.addEventListener('click', (e) => {
if (batchPicking) return;
if (batchPanel && !batchPanel.hidden && !batchPanel.contains(e.target) && batchBtn && !batchBtn.contains(e.target)) closeBatchPanel();
});
document.addEventListener('contact-switched', () => {
batchItems = [];
renderBatchList();
syncBatchBtn();
});
document.addEventListener('batch-send-changed', syncBatchBtn);
syncBatchBtn();
// ============================== v3.16.x：我可发送语音（录音 → 试听 → 发送） ==============================
// 聊天设置「我可发送语音」（cs-voice-send，每联系人独立）开启后，输入栏左侧显示「麦克风」按钮：
// 点击弹出底部录音半框——MediaRecorder 录音（最长 60 秒，到时自动停）→ 试听 → 以既有语音消息
// 格式「名称|||dataURL」(type:'voice') 入列，渲染/播放/撤回/引用/统计全部复用原语音链路。
const micBtn = document.getElementById('chat-mic-btn');
const voicePanel = document.getElementById('voice-panel');
const VOICE_MAX_MS = 60000;
let voiceStream = null, voiceRec = null, voiceChunks = [], voiceTimer = null, voiceStarting = false; // FIX 2026-09-05 #169 录音启动进行中闸门
let voiceStartTs = 0, voiceDataUrl = '', voiceDur = 0, voiceSilent = false, voicePreviewAudio = null, voiceVisHandler = null;
function voiceEnabled() {
try { return store.get('cs-voice-send') === '1'; } catch (e) { return false; }
}
function syncMicBtn() {
if (micBtn) micBtn.style.display = voiceEnabled() ? '' : 'none';
if (!voiceEnabled()) closeVoicePanel();
}
function voiceFmt(sec) {
const m = Math.floor(sec / 60), s = sec % 60;
return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
}
function voiceStopStream() {
if (voiceStream) { try { voiceStream.getTracks().forEach(t => t.stop()); } catch (e) {} voiceStream = null; }
}
function voiceStopPreview() {
if (voicePreviewAudio) { try { voicePreviewAudio.pause(); } catch (e) {} voicePreviewAudio = null; }
const pb = document.getElementById('voice-play-btn');
if (pb) pb.classList.remove('playing');
}
function renderVoiceIdle() {
if (!voicePanel) return;
voicePanel.classList.remove('recording');
const st = document.getElementById('voice-status');
if (st) st.textContent = '点下方按钮开始录音 · 最长 60 秒';
const tm = document.getElementById('voice-time');
if (tm) tm.textContent = '00:00';
const pv = document.getElementById('voice-preview');
if (pv) pv.hidden = true;
const rb = document.getElementById('voice-record-btn');
if (rb) { rb.textContent = '开始录音'; rb.classList.remove('rec'); }
const sb = document.getElementById('voice-send-btn');
if (sb) { sb.disabled = true; sb.textContent = '发送到聊天'; }
}
function closeVoicePanel() {
if (!voicePanel || voicePanel.hidden) return;
stopVoiceRec(true);
voiceStopPreview();
voiceDataUrl = ''; voiceDur = 0;
voicePanel.hidden = true;
renderVoiceIdle();
}
function openVoicePanel(opts) {
if (!voicePanel) return;
if (opts && typeof opts.onSend === 'function') voiceSendTarget = opts.onSend; else voiceSendTarget = null;
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
closeEmojiPanel();
if (window.closeAvlib) window.closeAvlib();
closeIme(); // 收起输入法，面板完整不被键盘遮挡
if (batchPanel) batchPanel.hidden = true;
const morePanel = document.getElementById('chat-more-panel');
if (morePanel) morePanel.hidden = true;
voiceDataUrl = ''; voiceDur = 0;
renderVoiceIdle();
voicePanel.hidden = false;
scrollChatBottom();
}
// 外部（群聊等）打开录音面板并把语音发到自己的消息列表：window.openVoicePanelFor(onSend)
window.openVoicePanelFor = function (onSend) { openVoicePanel({ onSend: onSend }); };
// v3.26.x：区分「标准安卓浏览器」与「iOS/安卓 WebView」——两者的录音格式与麦克风约束
// 偏好不同，荣耀 90/Edge 等标准 Chromium 对 audio/mp4(AAC) 的 MediaRecorder 路径会录出
//「滋啦滋啦」爆音（输入 48k 与 AAC 44.1k 采样率不匹配的已知内核缺陷），而其原生默认的
// audio/webm;codecs=opus 路径稳定无爆音、Chromium 也能正常播放；iOS Safari 只支持
// mp4/aac 可录可播，安卓 WebView（vivo/iQOO 的雨见、微信、QQ/UC/百度自带壳等）对
// webm/opus 能录却解不了（录出来试听/播放没声）——这两种环境仍须走 mp4/aac。
function isAndroidWebView() {
try {
  const ua = navigator.userAgent || '';
  return /wv\b|MicroMessenger|MicroApp|VivoBrowser|OPBrowser|MQQBrowser|QQBrowser|baiduboxapp|UCBrowser|XiaoMi|MiuiBrowser|HuaweiBrowser|Quark|SogouMobileBrowser|SamsungBrowser|MetaSr|OBABROWSER|dingtalk/i.test(ua);
} catch (e) { return true; } // 拿不到 UA 时保守按 WebView 处理（走 mp4/aac，只影响音质不影响可用）
}
// 标准安卓 Chromium（Chrome/Edge 等非内嵌壳）→ webm/opus 优先；iOS/安卓 WebView → mp4/aac 优先
function voiceMimePreferOpus() {
const md = (window.mochiDevice) || {};
return !!md.isAndroid && !isAndroidWebView();
}
function pickVoiceMime() {
if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
// 优先级：标准安卓浏览器把 webm/opus 放最前（Chromium 原生默认、稳且无爆音），mp4/aac 兜底；
// iOS/WebView 仍把 mp4/aac 放最前（iOS 唯一可录可播；WebView 对 webm 能录不能播）。
const list = voiceMimePreferOpus()
  ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus']
  : ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
for (let i = 0; i < list.length; i++) {
try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {}
}
return '';
}
// 获取麦克风轨道：标准安卓浏览器优先用最普通的 {audio:true}（AGC/降噪默认开，音质干净不爆音、
// 不削波），被设备拒绝再回退「关回声消除/降噪/自动增益 + 单声道」组合；iOS/安卓 WebView 仍先
// 以「关回声消除/降噪/自动增益 + 单声道」请求——这是 vivo/iQOO 等安卓机上「权限开了却录不到声/
// 录出来为空」的已知根因，若该约束组合不被设备支持（OverconstrainedError 等）再回退 {audio:true}，
// 绝不让报障机型彻底录不了。
async function acquireVoiceStream() {
const tries = voiceMimePreferOpus()
  ? [
      { audio: true },
      { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }
    ]
  : [
      { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } },
      { audio: true }
    ];
let lastErr = null;
for (let i = 0; i < tries.length; i++) {
try { return await navigator.mediaDevices.getUserMedia(tries[i]); } catch (e) { lastErr = e; }
}
throw lastErr;
}
// FIX 2026-09-05 #169（用户报障 OPPO Reno6 5G+雨见浏览器「一直提示已达最长60秒」）：防重入包装。
// startVoiceRec 在 await getUserMedia 期间（慢壳开麦可达数秒，期间按钮文案未变，用户必然连点）
// 重复进入会整体覆盖 voiceRec/voiceStartTs 并把 voiceTimer 覆盖成新 id——旧计时器永久丢失成孤儿，
// 自上次 voiceStartTs 起 60 秒后开始每 250ms 误报「已达最长 60 秒」且永不自停（面板关了仍弹，
// 只能刷新页面），同时第一路 MediaRecorder+麦克风流被覆盖泄漏。进行中的启动直接忽略重复调用。
async function startVoiceRec() {
if (voiceStarting) return;
voiceStarting = true;
try { await startVoiceRecInner(); } finally { voiceStarting = false; }
}
async function startVoiceRecInner() {
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
toast('当前浏览器不支持录音'); return;
}
let stream = null;
try {
stream = await acquireVoiceStream();
} catch (e) {
toast(e && e.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器设置里允许后重试' : '无法访问麦克风');
return;
}
voiceStopPreview();
voiceStream = stream;
voiceChunks = [];
let rec = null;
try {
const mime = pickVoiceMime();
rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
} catch (e) {}
if (!rec) { voiceStopStream(); toast('当前浏览器不支持录音'); return; }
rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) voiceChunks.push(ev.data); };
rec.onerror = (ev) => {
  try {
    if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null; }
    if (voiceVisHandler) { document.removeEventListener('visibilitychange', voiceVisHandler); voiceVisHandler = null; }
    voiceStopStream();
    voiceRec = null;
    renderVoiceIdle();
  } catch (e) {}
  toast('录音设备出错，请检查麦克风后重试');
};
rec.onstop = onVoiceRecStop;
voiceRec = rec;
voiceStartTs = Date.now();
voiceSilent = false;
try { rec.start(); } catch (e) { voiceStopStream(); voiceRec = null; toast('录音启动失败'); return; }
voicePanel.classList.add('recording');
const st = document.getElementById('voice-status');
if (st) st.textContent = '正在录音…';
const pv = document.getElementById('voice-preview');
if (pv) pv.hidden = true;
const sb = document.getElementById('voice-send-btn');
if (sb) sb.disabled = true;
const rb = document.getElementById('voice-record-btn');
if (rb) { rb.textContent = '停止录音'; rb.classList.add('rec'); }
voiceVisHandler = () => {
if (document.visibilityState === 'hidden' && voiceRec && voiceRec.state === 'recording') {
stopVoiceRec(false); toast('页面切到后台，录音已停止');
}
};
document.addEventListener('visibilitychange', voiceVisHandler);
if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null; } // FIX #169 入场先清残留计时器
const voiceTid = setInterval(() => {
// FIX 2026-09-05 #169 计时器自证：非当前录音的孤儿计时器自毁；仅确认仍处 recording 态才判 60s——
// 历史上重复进入录音后，被覆盖丢弃的旧计时器会在停止 60 秒后每 250ms 误报「已达最长 60 秒」不止不休
if (voiceTimer !== voiceTid) { clearInterval(voiceTid); return; }
if (!voiceRec || voiceRec.state !== 'recording') { clearInterval(voiceTid); voiceTimer = null; return; }
const el = Math.floor((Date.now() - voiceStartTs) / 1000);
const tm = document.getElementById('voice-time');
if (tm) tm.textContent = voiceFmt(Math.min(el, 60));
if (Date.now() - voiceStartTs >= VOICE_MAX_MS) { stopVoiceRec(false); toast('已达最长 60 秒，自动停止'); }
}, 250);
voiceTimer = voiceTid;
}
function stopVoiceRec(silent) {
if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null; }
if (voiceVisHandler) { document.removeEventListener('visibilitychange', voiceVisHandler); voiceVisHandler = null; }
if (silent) voiceSilent = true;
if (voicePanel) voicePanel.classList.remove('recording');
const rb = document.getElementById('voice-record-btn');
if (rb) rb.classList.remove('rec');
if (voiceRec && voiceRec.state === 'recording') {
try { voiceRec.stop(); } catch (e) { voiceStopStream(); }
} else {
voiceStopStream();
}
}
function onVoiceRecStop() {
voiceStopStream();
voiceRec = null;
const wasSilent = voiceSilent;
voiceSilent = false;
const durSec = Math.max(1, Math.round((Date.now() - voiceStartTs) / 1000));
const blob = new Blob(voiceChunks.length ? voiceChunks : [], { type: (voiceChunks[0] && voiceChunks[0].type) || 'audio/webm' });
voiceChunks = [];
const rb = document.getElementById('voice-record-btn');
if (rb) rb.textContent = '重新录音';
if (wasSilent || !blob.size) return; // 关闭面板打断的录音直接丢弃
  if (Date.now() - voiceStartTs < 800) { toast('录音太短，请录满 1 秒以上'); return; }
const fr = new FileReader();
fr.onload = () => {
voiceDataUrl = String(fr.result || '');
voiceDur = durSec;
if (!voiceDataUrl) { toast('录音数据读取失败'); return; }
if (!voicePanel) return;
const tm = document.getElementById('voice-time');
if (tm) tm.textContent = voiceFmt(durSec);
const st = document.getElementById('voice-status');
if (st) st.textContent = '录制完成';
const txt = document.getElementById('voice-preview-txt');
if (txt) txt.textContent = '试听 · ' + durSec + '″';
const pv = document.getElementById('voice-preview');
if (pv) pv.hidden = false;
const sb = document.getElementById('voice-send-btn');
if (sb) { sb.disabled = false; sb.textContent = '发送到聊天'; }
};
fr.onerror = () => { toast('录音数据读取失败'); };
fr.readAsDataURL(blob);
}
async function toggleVoiceRecord() {
if (voiceRec && voiceRec.state === 'recording') stopVoiceRec(false);
else await startVoiceRec();
}
function toggleVoicePlay() {
if (!voiceDataUrl) { toast('还没有录音'); return; }
if (voicePreviewAudio && !voicePreviewAudio.paused) { voiceStopPreview(); return; }
voiceStopPreview();
const a = new Audio(voiceDataUrl);
voicePreviewAudio = a;
// v3.16.x 修复：把 Audio 元素挂到 DOM 再播——部分安卓 WebView（雨见等）对未挂载的
// Audio 会静默空放（play() 走完却不出声），挂进 DOM 走标准解码管线更稳；播完/出错即卸
a.style.display = 'none';
document.body.appendChild(a);
const detached = () => { try { if (a.parentNode) a.parentNode.removeChild(a); } catch (e) {} if (voicePreviewAudio === a) voicePreviewAudio = null; };
const pb = document.getElementById('voice-play-btn');
if (pb) pb.classList.add('playing');
const cleanup = () => { detached(); voiceStopPreview(); };
a.addEventListener('ended', () => { detached(); voiceStopPreview(); });
a.addEventListener('error', () => { cleanup(); toast('语音播放失败'); });
a.play().then(() => {}).catch(() => { cleanup(); toast('语音播放失败'); });
}
let voiceSendTarget = null; // 群聊等外部页面打开语音面板时设置：function(dataUrl, durSec) 把录好的语音发到自己的消息列表
function sendVoiceMsg() {
if (!voiceDataUrl) { toast('还没有录音'); return; }
if (voiceSendTarget) {
  const dataUrl = voiceDataUrl, dur = voiceDur;
  closeVoicePanel();
  voiceSendTarget(dataUrl, dur);
  return;
}
const name = '语音 ' + voiceDur + '″';
lastMineText = '[语音]';
addRec({ side: 'out', text: name + '|||' + voiceDataUrl, type: 'voice' });
closeVoicePanel();
if (window.playSfx) window.playSfx('out');
if (window.logFish) window.logFish();
scheduleReply();
}
if (micBtn) micBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (!voicePanel) return;
if (voicePanel.hidden) openVoicePanel(); else closeVoicePanel();
});
const voiceCloseBtn = document.getElementById('voice-close');
if (voiceCloseBtn) voiceCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeVoicePanel(); });
const voiceRecordBtnEl = document.getElementById('voice-record-btn');
if (voiceRecordBtnEl) voiceRecordBtnEl.addEventListener('click', (e) => { e.stopPropagation(); toggleVoiceRecord(); });
const voicePlayBtnEl = document.getElementById('voice-play-btn');
if (voicePlayBtnEl) voicePlayBtnEl.addEventListener('click', (e) => { e.stopPropagation(); toggleVoicePlay(); });
const voiceSendBtnEl = document.getElementById('voice-send-btn');
if (voiceSendBtnEl) voiceSendBtnEl.addEventListener('click', (e) => { e.stopPropagation(); sendVoiceMsg(); });
document.addEventListener('click', (e) => {
if (voicePanel && !voicePanel.hidden && !voicePanel.contains(e.target) && micBtn && !micBtn.contains(e.target)) closeVoicePanel();
});
document.addEventListener('contact-switched', () => { closeVoicePanel(); syncMicBtn(); });
document.addEventListener('voice-send-changed', syncMicBtn);
syncMicBtn();
document.querySelectorAll('.emoji-tab').forEach(t => t.addEventListener('click', (e) => {
e.stopPropagation();
emojiMode = t.dataset.etab;
myBatchMode = false;
mySel.clear();
saveEmojiGroupPref();
renderEmojiPanel();
try { t.blur(); } catch (err) {}
}));
function compressMyEmoji(dataUrl, maxSide) {
return new Promise((resolve) => {
if (typeof dataUrl === 'string' && dataUrl.length > 8 * 1024 * 1024) {
resolve(null);
return;
}
const img = new Image();
img.onload = () => {
try {
if (img.width * img.height > 26000000) { resolve(null); return; }
const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
const w = Math.max(1, Math.round(img.width * scale));
const h = Math.max(1, Math.round(img.height * scale));
const c = document.createElement('canvas');
c.width = w; c.height = h;
c.getContext('2d').drawImage(img, 0, 0, w, h);
resolve(c.toDataURL('image/png'));
} catch (e) { resolve(null); }
};
img.onerror = () => resolve(null);
img.src = dataUrl;
});
}
const myeNew = document.getElementById('mye-new');
if (myeNew) {
myeNew.addEventListener('click', (e) => {
e.stopPropagation();
if (window.openModal) {
window.openModal('新建表情包分组', '', (v) => {
const name = (v || '').trim();
if (!name) return;
if (myGroups.some(g => g[0] === name)) { toast('分组「' + name + '」已存在'); return; }
myGroups.unshift([name, []]);
myEmojiSave();
myCurGroup = name;
saveEmojiGroupPref();
renderEmojiPanel();
});
}
});
}
const myeAdd = document.getElementById('mye-add');
if (myeAdd) {
myeAdd.addEventListener('click', (e) => {
e.stopPropagation();
const fi = document.createElement('input');
fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true;
fi.onchange = () => {
const files = Array.prototype.slice.call(fi.files || []);
if (!files.length) return;
let g = null;
if (myCurGroup) g = myGroups.find(x => x[0] === myCurGroup) || null;
if (!g && myGroups.length) g = myGroups[0];
if (!g) { g = ['默认', []]; myGroups.unshift(g); }
let done = 0, okCount = 0;
files.forEach(f => {
const reader = new FileReader();
reader.onload = () => {
const isGif = /image\/gif/i.test(f.type || '') || /\.gif$/i.test(f.name || '');
if (isGif) {
if (reader.result.length > 8 * 1024 * 1024) {
done++;
if (done === files.length) { myEmojiSave(); renderEmojiPanel(); toast('动图过大，已跳过（请用 10MB 以内的 GIF）'); }
return;
}
g[1].push(reader.result);
okCount++;
done++;
if (done === files.length) {
const ok = myEmojiSave();
myCurGroup = g[0];
saveEmojiGroupPref();
renderEmojiPanel();
if (!ok) toast('存储空间不足：表情已用备用存储，刷新后恢复。请清理不用的表情');
else toast('已添加 ' + okCount + ' 个表情');
}
return;
}
compressMyEmoji(reader.result, 260).then(data => {
if (!data) {
done++;
if (done === files.length) { myEmojiSave(); renderEmojiPanel(); toast('图片过大或格式不支持，已跳过'); }
return;
}
g[1].push(data);
okCount++;
done++;
if (done === files.length) {
const ok = myEmojiSave();
myCurGroup = g[0];
saveEmojiGroupPref();
renderEmojiPanel();
if (!ok) toast('存储空间不足：表情已用备用存储，刷新后恢复。请清理不用的表情');
else toast('已添加 ' + okCount + ' 个表情');
}
});
};
reader.onerror = () => { done++; if (done === files.length) { myEmojiSave(); renderEmojiPanel(); toast('部分图片读取失败'); } };
reader.readAsDataURL(f);
});
};
fi.click();
});
}
function splitUrlItems(raw) {
return String(raw || '').split(/\r\n|\r|\n/)
.map(l => l.trim()).filter(Boolean)
.map(line => {
const m = line.match(/^[【\[](.*?)[】\]]\s*(.*)$/);
const rest = m ? (m[2] || '') : line;
const url = rest.trim().replace(/^[<("'\u300a\u201c]+|[>)"'\u300b\u201d]+$/g, '');
return { g: m && m[1].trim() ? m[1].trim() : '', url: url };
})
.filter(x => /^https?:\/\//i.test(x.url));
}
function fetchLinkImage(url, processData) {
const once = (u) => new Promise((resolve) => {
let settled = false;
const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
const timer = setTimeout(() => finish({ st: 'url', v: u }), 12000);
fetch(u, { mode: 'cors' }).then(res => {
if (!res.ok) throw new Error('http' + (res.status || ''));
return res.blob();
}).then(blob => {
if (!/^image\//i.test(blob.type || '')) throw new Error('notimage');
const fr = new FileReader();
fr.onload = () => {
const raw = String(fr.result || '');
if (/image\/gif/i.test(blob.type)) {
finish(raw.length > 8 * 1024 * 1024 ? { st: 'url', v: u } : { st: 'data', v: raw });
return;
}
processData(raw).then(d => finish(d ? { st: 'data', v: d } : { st: 'url', v: u }));
};
fr.onerror = () => finish({ st: 'fail', v: u });
fr.readAsDataURL(blob);
}).catch(err => {
const msg = (err && err.message) || '';
finish(/^notimage|^http/.test(msg) ? { st: 'fail', v: u } : { st: 'url', v: u });
});
});
if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
return once(url.replace(/^http:\/\//i, 'https://')).then(r => r.st === 'data' ? r : once(url));
}
return once(url);
}
function runLinkPool(urls, worker) {
const out = new Array(urls.length);
let i = 0;
function next() {
if (i >= urls.length) return Promise.resolve();
const idx = i++;
return worker(urls[idx]).then((res) => { out[idx] = res; return next(); });
}
return Promise.all([0, 1, 2, 3].map(() => next())).then(() => out);
}
let myeLinkBusy = false; // 防重复提交：上一批还在抓取时不允许叠开第二批
const myeAddLink = document.getElementById('mye-add-link');
if (myeAddLink) {
myeAddLink.addEventListener('click', (e) => {
e.stopPropagation();
if (myeLinkBusy) { toast('上一批链接还在导入中，请稍等'); return; }
if (!window.openModal) return;
window.openModal('链接导入表情（一行一个链接）', '', (raw, targetGroup) => {
const items = splitUrlItems(raw);
if (!items.length) { toast('没有可导入的图片链接（需以 http(s):// 开头）'); return; }
myeLinkBusy = true;
let newGroups = 0;
const buckets = {};
const resolveBucket = (name) => {
if (!buckets[name]) {
let g = myGroups.find(x => x[0] === name);
if (!g) { g = [name, []]; myGroups.unshift(g); newGroups++; }
buckets[name] = { g: g, seen: new Set(g[1]) }; // 分组内去重：已有表情 + 本次已导入都算重复
}
return buckets[name];
};
const jobs = items.map(it => ({ url: it.url, bucket: resolveBucket(it.g || targetGroup || myCurGroup || '默认') }));
let okData = 0, okUrl = 0, dup = 0, fail = 0, httpSaved = 0;
toast('开始导入 ' + jobs.length + ' 个链接…');
runLinkPool(jobs, (job) => fetchLinkImage(job.url, (d) => compressMyEmoji(d, 260))).then(results => {
results.forEach((res, i) => {
const b = jobs[i].bucket;
if (res.st === 'fail') fail++;
else if (b.seen.has(res.v)) dup++;
else {
b.seen.add(res.v);
b.g[1].push(res.v);
if (res.st === 'data') okData++;
else {
okUrl++;
if (/^http:\/\//i.test(jobs[i].url)) httpSaved++; // 升级 https 抓取也失败才落到这里
}
}
});
const ok = myEmojiSave();
myCurGroup = jobs[0].bucket.g[0];
saveEmojiGroupPref();
renderEmojiPanel();
myeLinkBusy = false;
const got = okData + okUrl;
if (!ok && got) toast('存储空间不足：表情已用备用存储，刷新后恢复。请清理不用的表情');
else toast('已导入 ' + got + ' 个表情' +
(okUrl ? '（其中 ' + okUrl + ' 个按链接保存，需联网显示' + (httpSaved ? '；含 ' + httpSaved + ' 个 http 链接，本站可能拦截不显示' : '') + '）' : '') +
(dup ? '，跳过重复 ' + dup + ' 个' : '') +
(fail ? '，失败 ' + fail + ' 个（非图片地址）' : '') +
(newGroups ? '，新建 ' + newGroups + ' 个分组' : ''));
}, () => {
myeLinkBusy = false;
toast('导入出错，请重试');
});
}, {
textarea: true,
textareaPlaceholder: 'https://example.com/sticker.png\n一行一个链接，可粘贴多个批量导入\n可用【分组名】前缀指定分组，如：【日常】https://…\n\n提示：优先尝试转存为本地图片；图床不允许跨域时按链接保存',
groups: myGroups.map(g => g[0])
});
});
}
const myeBatch = document.getElementById('mye-batch');
if (myeBatch) {
myeBatch.addEventListener('click', (e) => {
e.stopPropagation();
myBatchMode = true;
mySel.clear();
renderEmojiPanel();
});
}
const emojiBatchAll = document.getElementById('emoji-batch-all');
if (emojiBatchAll) {
emojiBatchAll.addEventListener('click', (e) => {
e.stopPropagation();
if (!myCurGroup) { toast('请先点击上方分组'); return; }
const keys = [];
const list = myGroups.filter(g => g[0] === myCurGroup);
list.forEach(([gname, arr]) => arr.forEach((c, i) => keys.push(gname + '\u0001' + i)));
if (mySel.size === keys.length && keys.length) mySel.clear();
else keys.forEach(k => mySel.add(k));
renderEmojiPanel();
});
}
const emojiBatchDel = document.getElementById('emoji-batch-del');
if (emojiBatchDel) {
emojiBatchDel.addEventListener('click', (e) => {
e.stopPropagation();
if (!mySel.size) { toast('请先选择要删除的表情'); return; }
if (window.openModal) {
window.openModal('删除选中的 ' + mySel.size + ' 个表情？', '', () => {
myGroups.forEach(([gname, arr]) => {
for (let i = arr.length - 1; i >= 0; i--) {
if (mySel.has(gname + '\u0001' + i)) arr.splice(i, 1);
}
});
mySel.clear();
myEmojiSave();
renderEmojiPanel();
}, { noInput: true });
}
});
}
const emojiBatchExit = document.getElementById('emoji-batch-exit');
if (emojiBatchExit) {
emojiBatchExit.addEventListener('click', (e) => {
e.stopPropagation();
myBatchMode = false;
mySel.clear();
renderEmojiPanel();
});
}
let myMgMask = null;
function openMyEmojiManage() {
if (!myMgMask) {
myMgMask = document.createElement('div');
myMgMask.className = 'mg-mask';
myMgMask.innerHTML =
'<div class="mg-panel my-mg-panel">' +
'<div class="mg-head"><span>管理表情包分组</span><button class="mg-close">✕</button></div>' +
'<div class="mg-list"></div>' +
'<button class="mg-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 5v14M5 12h14"/></svg>新建分组</button>' +
'</div>';
document.body.appendChild(myMgMask);
myMgMask.querySelector('.mg-close').addEventListener('click', () => { myMgMask.hidden = true; });
myMgMask.addEventListener('click', (e) => { if (e.target === myMgMask) myMgMask.hidden = true; });
myMgMask.querySelector('.mg-add').addEventListener('click', () => {
if (window.openModal) {
window.openModal('新建表情包分组', '', (v) => {
const name = (v || '').trim();
if (!name) return;
if (myGroups.some(g => g[0] === name)) { toast('分组「' + name + '」已存在'); return; }
myGroups.unshift([name, []]);
myEmojiSave();
myCurGroup = name;
saveEmojiGroupPref();
myMgMask.hidden = true;
renderEmojiPanel();
});
}
});
}
function renderMyMgList() {
const listEl = myMgMask.querySelector('.mg-list');
if (!myGroups.length) { listEl.innerHTML = '<div class="mg-empty">暂无分组，点击下方新建</div>'; return; }
listEl.innerHTML = '';
myGroups.forEach((g, gi) => {
const row = document.createElement('div');
row.className = 'mg-row';
row.innerHTML = '<span class="mg-name">' + g[0] + '</span><span class="mg-count">' + (g[1] || []).length + ' 张</span>' +
'<button class="mg-rn">改名</button><button class="mg-del">✕</button>';
row.querySelector('.mg-rn').addEventListener('click', () => {
if (window.openModal) {
window.openModal('重命名分组', g[0], (v) => {
const name = (v || '').trim();
if (!name || name === g[0]) return;
if (myGroups.some(x => x[0] === name)) { toast('分组「' + name + '」已存在'); return; }
const oldName = g[0];
g[0] = name;
if (myCurGroup === oldName) { myCurGroup = name; saveEmojiGroupPref(); }
mySel.clear();
updateBatchCount();
myEmojiSave();
renderMyMgList();
renderEmojiPanel();
});
}
});
row.querySelector('.mg-del').addEventListener('click', () => {
if (window.openModal) {
window.openModal('删除分组「' + g[0] + '」及其全部表情？', '', () => {
myGroups.splice(gi, 1);
if (myCurGroup === g[0]) { myCurGroup = ''; saveEmojiGroupPref(); }
mySel.clear();
myEmojiSave();
renderMyMgList();
renderEmojiPanel();
}, { noInput: true });
}
});
listEl.appendChild(row);
});
}
myMgMask.hidden = false;
renderMyMgList();
}
const myeManage = document.getElementById('mye-manage');
if (myeManage) {
myeManage.addEventListener('click', (e) => {
e.stopPropagation();
openMyEmojiManage();
});
}
const input = document.getElementById('chat-input');
const send = document.getElementById('chat-send');
const draftEl = document.getElementById('chat-draft');
const draftItems = document.getElementById('chat-draft-items');
const quoteEl = document.getElementById('chat-draft-quote');
let draftImgs = []; // 待发送图片（表情包/图片 dataURL）
function renderQuoteBar() {
if (!quoteEl) return;
quoteEl.innerHTML = '';
if (!lastQuote) { quoteEl.hidden = true; return; }
quoteEl.hidden = false;
const bar = document.createElement('div');
bar.className = 'chat-draft-quote-bar';
const thumb = (lastQuote.imgs && lastQuote.imgs.length) ? lastQuote.imgs[0] : null;
if (thumb) {
const img = document.createElement('img');
img.className = 'chat-draft-quote-img';
img.src = thumb;
img.alt = '';
bar.appendChild(img);
}
const t = document.createElement('span');
t.className = 'chat-draft-quote-text';
const raw = quoteTextSafe(lastQuote.text || '');
const hidePh = !!(thumb && QUOTE_PLACEHOLDER.test(raw));
t.textContent = (raw.indexOf('data:') === 0 && raw.length > 64)
? (lastQuote.type === 'sticker' ? '表情包' : '图片')
: (hidePh ? '' : (raw || '图片'));
bar.appendChild(t);
const xBtn = document.createElement('button');
xBtn.className = 'chat-draft-x chat-draft-quote-x';
xBtn.textContent = '✕';
xBtn.addEventListener('click', () => {
lastQuote = null;
renderDraft();
});
bar.appendChild(xBtn);
quoteEl.appendChild(bar);
}
function renderDraft() {
if (!draftEl || !draftItems) return;
renderQuoteBar();
draftEl.hidden = !draftImgs.length && !lastQuote;
draftItems.innerHTML = '';
draftImgs.forEach((src, i) => {
const it = document.createElement('div');
it.className = 'chat-draft-item';
const img = document.createElement('img');
img.src = src;
img.alt = '';
const xBtn = document.createElement('button');
xBtn.className = 'chat-draft-x';
xBtn.dataset.i = i;
xBtn.textContent = '✕';
it.appendChild(img);
it.appendChild(xBtn);
xBtn.addEventListener('click', () => {
draftImgs.splice(i, 1);
renderDraft();
});
draftItems.appendChild(it);
});
}
const imgBtn = document.getElementById('chat-img-btn');
if (imgBtn) {
imgBtn.addEventListener('click', (e) => {
e.stopPropagation();
const fi = document.createElement('input');
fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true;
fi.onchange = () => {
const files = Array.prototype.slice.call(fi.files || []);
if (!files.length) return;
files.forEach(f => {
const reader = new FileReader();
reader.onload = () => {
const img = new Image();
img.onload = () => {
try {
const c = document.createElement('canvas');
const scale = Math.min(1, 720 / Math.max(img.width, img.height));
c.width = Math.max(1, Math.round(img.width * scale));
c.height = Math.max(1, Math.round(img.height * scale));
c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
draftImgs.push(c.toDataURL('image/jpeg', 0.85));
} catch (err) {
draftImgs.push(reader.result);
}
renderDraft();
};
img.onerror = () => {
draftImgs.push(reader.result);
renderDraft();
toast('部分图片无法压缩，已按原图添加');
};
img.src = reader.result;
};
reader.readAsDataURL(f);
});
};
fi.click();
});
}
function buildParts(text) {
const parts = [];
const t = (text || '').trim();
if (t) parts.push({ k: 'text', v: t });
draftImgs.forEach(src => parts.push({ k: 'img', v: src, sub: 'image' }));
return parts;
}
const SEND_GUARD_MS = 2500;
let lastSendTxt = '', lastSendTs = 0;
// v3.26.x #115：守卫必须只挡「内核迟到写回」，绝不挡用户真实编辑。
// 原缺陷：三处防复活守卫的判据都是「内容与刚发送文本完全一致」——用户重打
// 同一条短句（「好的」「在吗」「嗯」这类）时，第一次 input 事件就命中并被
// 静默 textContent='' 吞掉（红米 K60 至尊版 + Edge 报「输入栏打字不显示、
// 空白、发不出去」，实测这条路径 100% 复现吞字）。
// 两者唯一可靠的区分信号：真实编辑之前一定有用户输入活动（keydown /
// compositionstart / insert 类 beforeinput），内核的迟到写回没有。
let lastUserEditAt = 0, clearAppliedAt = 0;
function userEditedAfterClear() { return lastUserEditAt > clearAppliedAt; }
// v3.26.x #215：发送取值兜底——Edge/Chromium 部分内核在点发送的瞬间会把输入栏里
// 尚未提交的组合文本整体撕掉（composition cancel：DOM 直接清空、不派发任何
// input/beforeinput 事件），addMsg(input.innerText) 读到空串 → buildParts 为空 →
// 一条消息都不发出、用户刚打的字静默消失（华为 P50E+Edge 报「发消息气泡里没有
// 文字/文字消失了」，用户明说其他设备型号也有；无头复现：IME 提交文本→零事件
// 清空 DOM→点发送＝消息 0 条且字无踪）。#115 防复活守卫管「发送后内核迟到写回」，
// 管不了「发送瞬间撕文本」这一反向缺口。恢复依据 = 捕获阶段维护的最近输入快照
// _mLastTyped，仅在「innerText/textContent 两个口径都读空、且快照新鲜（真实编辑
// 发生在 15s 内、晚于上次清空）」时启用；正常路径与防重发/防复活守卫零改动。
function readSendText() {
try {
const t = (input.innerText || '').trim() || (input.textContent || '').trim();
if (t) return t;
} catch (e) {}
try {
const snap = (input._mLastTyped || '').trim();
if (snap && userEditedAfterClear() && Date.now() - lastUserEditAt < 15000) return snap;
} catch (e) {}
return '';
}
function clearChatInput() {
if (!input) return;
// 先挂复活守卫再清空——清空动作本身会同步派发 input 事件，守卫需已就位
input._mClearTxt = lastSendTxt || '';
// v3.26.x #215：快照随真实清空一并作废（防隔次发送/跨联系人被旧快照幻影重发）
try { input._mLastTyped = ''; } catch (e) {}
clearAppliedAt = Date.now();
const sentTxt = lastSendTxt || '';
// v3.14.x：vivo Edge 等内核实测——聚焦中的 contenteditable 直写 textContent=''
// 后，输入法会把刚提交的组合文本整体写回输入框（迟到、且常不派发 input 事件），
// 表现为「消息发出去了，聊天框还留着刚发的内容」。聚焦态改走 execCommand 编辑
// 管线删除（浏览器层面终结组合会话，写回无从发生）；非聚焦/不支持再退回直清。
try {
if (input.isContentEditable && document.activeElement === input) {
input.focus();
if (!(document.execCommand && document.execCommand('selectAll', false, null) &&
document.execCommand('delete', false, null))) {
input.textContent = '';
}
} else if (input.isContentEditable) {
input.textContent = '';
}
} catch (e) {
try { input.textContent = ''; } catch (e2) {}
}
try { input.value = ''; } catch (e) {}
// v3.14.x：迟到复活兜底——部分内核重组文本不派发 input（原守卫收不到），定时
// 复查两次；仅当内容与刚发送文本完全一致且仍在防重发窗口内才清，人工重打不受影响
if (sentTxt && input.isContentEditable) {
[200, 800].forEach((ms) => {
setTimeout(() => {
try {
if (!input || !input.isContentEditable) return;
const now = (input.innerText || '').trim();
if (now && now === sentTxt && Date.now() - lastSendTs < SEND_GUARD_MS && !userEditedAfterClear()) {
input.textContent = '';
input._mClearTxt = '';
}
} catch (e) {}
}, ms);
});
}
}
const addMsg = (text) => {
const t0 = (text || '').trim();
if (t0 && t0 === lastSendTxt && Date.now() - lastSendTs < SEND_GUARD_MS && !userEditedAfterClear()) {
clearChatInput();
draftImgs = [];
renderDraft();
return;
}
const parts = buildParts(text);
if (!parts.length) return;
const t = t0;
lastMineText = t || (draftImgs.length ? draftImgs[0] : '');
const rec = { side: 'out', text: lastMineText, parts: parts };
if (lastQuote) {
rec.quote = quoteValue(lastQuote);
rec.qside = lastQuote.side;
if (typeof lastQuote.idx === 'number' && lastQuote.idx >= 0) rec.qidx = lastQuote.idx;
lastQuote = null;
}
addRec(rec);
lastSendTxt = t;
lastSendTs = Date.now();
try { if (window.cjianNoteChat) window.cjianNoteChat(); } catch (err) {}
if (window.playSfx) window.playSfx('out');
clearChatInput();
draftImgs = [];
renderDraft();
if (window.logFish) window.logFish();
try { window.__replyOnceDiag = 0; console.log('[mochi-reply] addMsg 发送, 重置 replyOnce 计数'); } catch(e){}
scheduleReply();
};
if (send) {
// v3.30.x：点发送不收输入法——点按按钮的 mousedown 默认把焦点从输入框抢走（移动端键盘随即收起），
// preventDefault 阻止焦点转移；发送后回焦输入框兜底（部分内核 click 路径仍会失焦，见 FIX-REGRESSION #127）
send.addEventListener('mousedown', (e) => { e.preventDefault(); });
send.addEventListener('click', () => { addMsg(readSendText()); try { input.focus(); } catch (e) {} });
}
// v3.17.x：删除了此前的 pointerup 监听——它在 click 之前把 lastSendTs 刷新为当前时间，
// 使 addMsg 的防重发守卫（t0===lastSendTxt 且间隔<2.5s）对「用户重新输入相同文本后
// 再点发送」必然命中：消息被吞、输入框被清空（红米 K80 Chrome 反馈「点发送无法发送」，
// 发「嗯/好的/在吗」等重复短句必现）。双击防重仍由守卫承担：真实双击时第二次 click
// 距上次发送 <2.5s 且文本相同，同样会命中守卫，不会重复发送。
if (input) {
// v3.26.x #115：真实输入活动跟踪（守卫判据来源）——捕获阶段早于 input 事件，
// 用户敲的每一键/每一次组合开始/每一次插入式编辑都会刷新 lastUserEditAt；
// 内核的迟到写回不会（它没有对应的输入活动）。beforeinput 只认 insert* 类型，
// delete* 不算「把文本打进来」。老内核无 beforeinput 也不影响（前两类已覆盖）。
try {
input.addEventListener('keydown', () => { lastUserEditAt = Date.now(); }, true);
input.addEventListener('compositionstart', () => { lastUserEditAt = Date.now(); }, true);
input.addEventListener('beforeinput', (e) => {
if (!e || typeof e.inputType !== 'string' || e.inputType.indexOf('insert') === 0) lastUserEditAt = Date.now();
}, true);
// v3.26.x #215：最近输入快照（捕获阶段独立监听，守卫监听的 _mClearTxt 早退不影响它）——
// 每次输入事件都刷新，含手动全删（快照归空＝不可能幻影恢复）；内核撕文本不发事件，
// 撕掉前最后一次快照即恢复依据（见 readSendText）
input.addEventListener('input', function () { try { input._mLastTyped = input.innerText || ''; } catch (e) {} }, true);
} catch (e) {}
input.addEventListener('input', () => {
if (!input._mClearTxt) return;
const now = input.innerText.trim();
if (now === input._mClearTxt && Date.now() - lastSendTs < SEND_GUARD_MS) {
// 本次清空之后用户真打过字＝重发了同一条内容，放行（原实现在此静默清框，
// 用户看到的就是「输入的字不显示、空白」）；只有无输入活动的迟到写回才清。
if (userEditedAfterClear()) { input._mClearTxt = ''; return; }
input.textContent = '';
input._mClearTxt = '';
} else if (now && now !== input._mClearTxt) {
input._mClearTxt = '';
}
});
input.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
// 聊天设置「回车键发送消息」关闭时不发送：不 preventDefault，安卓 ce-box 走原事件默认行为插入换行
try { if (store.get('cs-enter-send') === 'off') return; } catch (err) {}
e.preventDefault();
addMsg(readSendText());
}
});
}
function bootAutoSend() {
if (window.replyCfg) scheduleAutoSend();
else setTimeout(bootAutoSend, 500);
}
window.enterChat = enterChat;
// v3.17.x：跨桌面「来消息」用——incoming-requests.js 切桌面后轮询等待本桌面聊天
// 加载就绪（contact-switched 会把 msgs=[]、chatDbReady=false，loadMsgs 异步读完才置 true），
// 就绪后再让 TA 发话，保证消息落进刚加载好的记录里。
// v3.17.x：跨桌面「来消息」用——本桌面聊天是否已从 IDB 加载完成。
// 只依赖 chatDbReady（contact-switched 会置 false，loadMsgs 读完/保险丝到期才置 true），
// 不再比对 lastIdbLoadPrefix：无历史桌面（新联系人）走 confirmMiss 分支只置 chatDbReady、
// 不更新 lastIdbLoadPrefix，比对会误判「未就绪」导致跨桌面发卡永远等超时。
window.__chatDbReady = function () { return chatDbReady === true; };
// v3.17.x：跨桌面「来消息」用——返回最近一次成功加载聊天记录的桌面 id
//（lastIdbLoadPrefix 是 'xy-home-v2:<cid>' 形式，这里剥成 cid 供 goReply 比对当前桌面）
window.__chatDbLoadedPrefix = function () {
  try {
    const p = lastIdbLoadPrefix || '';
    return p.indexOf('xy-home-v2:') === 0 ? p.slice('xy-home-v2:'.length) : '';
  } catch (e) { return ''; }
};
bootAutoSend();
// FIX 2026-09-01 #120：启动不再无条件预读当前桌面聊天——大历史桌面（账本 b 超门槛）
// 冷启动跳过，进入聊天页才读（enterChat 会 loadMsgs），防低端机"打开网站"即崩溃。
// 小历史/账本缺失仍按原预读行为（数据零风险，见 chatPrefetchIfLight 说明）。
try { chatPrefetchIfLight(function () { loadMsgs(); }); } catch (e) {}
setTimeout(rpExpireCheck, 2000);
setInterval(rpExpireCheck, 60 * 60 * 1000);
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':' + RP_COVER_KEY).then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2) store.set(RP_COVER_KEY, v);
});
}
} catch (e) {}
window.chatSendMsg = (text) => { if (typeof text === 'string' && text.trim()) addMsg(text.trim()); };
window.chatSendFlower = (emoji, name, wish, fromTA) => {
return addRec({ side: fromTA ? 'in' : 'out', special: 'flower', flEmoji: emoji, flName: name, flWish: wish || '' });
};
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':fav-msgs').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2) {
// v3.26.x 修复（iOS 收藏丢失）：只在本地无收藏时从 IDB 补入，不再无条件覆盖——
// idbSet 是异步 fire-and-forget，iOS 杀后台时 IDB 可能落后于 localStorage，
// 无条件覆盖会把最新收藏回滚成旧快照（收藏 5 条重开后只剩 3 条）
let cur = null;
try { cur = store.get('fav-msgs'); } catch (e) {}
if (!cur || cur.length <= 2) store.set('fav-msgs', v);
}
});
}
} catch (e) {}
updateChatBadge();
document.addEventListener('ta-word-changed', function () {
try { if (msgs.length) renderWindow(false, false); } catch (e) {}
});
// v3.26.x #181：气泡 CSS 通用映射导出（单聊 chat-settings.js / 群聊 group-chat.js 共用）。
// 旧逻辑只认固定别名表，网页下载的气泡模板类名对不上时，整份模板替换后一条规则都匹配
// 不到节点 → 「已设置但气泡零变化」（EC-PAD01 SE/vivo Edge 等多机型反复反馈；与机型无关，
// 只与上传内容有关）。现行为：①别名表扩充（bubble-left/right、msg/message/chat-left/right、
// you/sent/received 等）；②剥离注释、跳过 keyframes 帧；③映射后若没有任何规则命中气泡 →
// 兜底把模板里全部声明块（含 --var 定义）抽出整体套用到双方气泡 !important，保证上传必有
// 可见变化；④:root/body/* 等命中不了气泡的选择器不原样注入，防全局重置泄漏污染整页。
window.mochiMapBubbleCss = function (css, scope) {
  scope = scope || '';
  var wrap = function (decls) {
    return scope + '.msg-out .msg-bubble{' + decls + '!important;}' +
           scope + '.msg-in .msg-bubble{' + decls + '!important;}';
  };
  css = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!css) return { out: '', hint: null };
  // 纯声明（无大括号）→ 直接套双方气泡
  if (css.indexOf('{') < 0) return { out: wrap(css), hint: null };
  var _mapBc = function (src, names, rep) {
    var r = src;
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var re2 = new RegExp('\\.' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\-\\w])', 'g');
      r = r.replace(re2, rep);
    }
    return r;
  };
  var OUT_B = scope + '.msg-out .msg-bubble', IN_B = scope + '.msg-in .msg-bubble';
  var OUT_NAMES = [
    'message-sent', 'message-me', 'message-mine', 'chat-me', 'msg-me', 'msg-sent', 'sent',
    'mine', 'me', 'left', 'my-bubble', 'bubble-mine', 'bubble-self', 'self', 'myself', 'sender',
    'bubble-left', 'msg-left', 'message-left', 'chat-left'
  ];
  var IN_NAMES = [
    'message-received', 'received', 'message-you', 'message-friend', 'chat-you', 'chat-friend',
    'msg-you', 'msg-recv', 'msg-incoming', 'incoming', 'friend', 'other', 'right', 'you',
    'bubble-other', 'partner-bubble', 'them', 'recipient', 'guest', 'receiver',
    'bubble-right', 'msg-right', 'message-right', 'chat-right'
  ];
  var SH_NAMES = [
    'chat-bubble', 'message-bubble', 'text-bubble', 'word-bubble', 'chat-text',
    'bubble', 'message', 'msg'
  ];
  var out = '', hasMapped = false, fallbackDecls = [];
  var re = /([^{}]*)\{([^{}]*)\}/g, m;
  while ((m = re.exec(css))) {
    var sel = m[1].trim(), decls = m[2].trim();
    if (!decls) continue;
    if (!sel || /^(-?\d+\.?\d*%|from|to)$/i.test(sel)) { // 无选择器声明块 / keyframes 帧
      if (!sel) { out += wrap(decls); hasMapped = true; }
      continue;
    }
    var mapped = sel;
    mapped = _mapBc(mapped, ['msg-out'], scope + '.msg-out');
    mapped = _mapBc(mapped, ['msg-in'], scope + '.msg-in');
    mapped = _mapBc(mapped, ['mb.self'], OUT_B);
    mapped = _mapBc(mapped, ['mb.other'], IN_B);
    mapped = _mapBc(mapped, OUT_NAMES, OUT_B);
    mapped = _mapBc(mapped, IN_NAMES, IN_B);
    mapped = _mapBc(mapped, SH_NAMES, scope + '.msg-bubble');
    if (/\.msg-bubble|\.msg-out|\.msg-in/.test(mapped)) {
      out += mapped + '{' + decls + '}';
      hasMapped = true;
    } else if (fallbackDecls.indexOf(decls) < 0) {
      fallbackDecls.push(decls);
    }
  }
  // 一条都没认出气泡类名 → 整包声明兜底（含 --var，var() 引用同元素可解析）
  if (!hasMapped && fallbackDecls.length) {
    return { out: wrap(fallbackDecls.join(';')), hint: '未认出模板里的气泡类名，已把全部样式整体套用到双方气泡' };
  }
  return { out: out, hint: null };
};
})();
