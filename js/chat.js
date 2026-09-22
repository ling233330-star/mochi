(function () { try {
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
let chatKnownEmpty = false;
let lastIdbLoadPrefix = null;
let lastIdbLoadAt = 0;
const IDB_RELOAD_MIN_GAP = 8000;
let chatAuthPending = false;
const CHAT_AUTH_WATCH_MS = 15000;
let authWatchT = null;
function chatAuthSettled() { return chatKnownEmpty || (chatDbReady && !chatAuthPending); }
let pendingLocal = null; // 权威就绪前暂存的内存消息（绝不落盘，防止污染读取/覆盖 IDB）
const PERSIST_MIN_GAP = 2500;   // 两次实际落盘的最小间隔（ms）
let lastPersistAt = 0;          // 上次实际落盘时间（performance.now()）
let persistTimer = null;        // 排队中标记（rIdle/timeout）
let persistRun = null;          // 待执行落盘闭包（tail 只保留最新一次）
function runPersist() {
persistTimer = null;
if (!persistRun) return;
const wait = PERSIST_MIN_GAP - (performance.now() - lastPersistAt);
if (wait > 0) { persistTimer = setTimeout(runPersist, wait); return; }
const run = persistRun;
persistRun = null;
try { if (window.__mochiPhase) window.__mochiPhase('persist(chat)'); } catch (e0) {}
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
flushPersistNow();
try { chatConsolidate(chatArchPrefix); } catch (e) {}
try { hideTyping(); } catch (e) {}
chatArchClearBaseline();
msgs = [];
pendingLocal = null;
chatDbReady = false;
chatKnownEmpty = false; // FIX 2026-09-15 #526：换桌面重新判定
chatAuthPending = false; // #967：新桌面重新判定权威未达状态
stopChatAuthWatch(); // #967：看门狗按桌面重启（旧桌面的等待不得跨桌面续命）
chatBlkResetState(); // #722：换桌面＝分块/热片/冷头状态全部复位（新桌面读自己的块或旧整包）
sessionChangedIdx.clear();
windowStale = true;
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
try { chatPrefetchIfLight(function () { loadMsgs(); }); } catch (e) {}
} catch (e) {}
});
const LS_SNAP_LIMIT = 2 * 1024 * 1024;
let lsSnapTimer = null;
let lsSnapPending = null; // { arr, prefix }：窗口内最新一次请求，trailing 时写
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
const CHAT_ARCH_KEY = 'chat-arch';
const CHAT_ARCH_MAX = 400;                 // 日志条数上限，超过即压缩
const CHAT_ARCH_BYTES = 4 * 1024 * 1024;   // 日志字节估算上限，超过即压缩
const CHAT_ARCH_MIN_CKPT = 1024 * 1024;    // 基准包 ≥1MB 才启用增量日志
const CHAT_FP_TEXT = 4096;                 // 指纹里参与字符校验的文本长度上限（超长只比长度）
let chatArchPrefix = null;                 // 基准包对应的命名空间
let chatArchRef = null;                    // 基准段消息对象引用（长度=基准条数）
let chatArchFp = null;                     // 与 chatArchRef 平行的字段指纹
let chatArchBytes = 0;                     // 基准包字节估算（决定是否启用分片）
function chatArchClearBaseline() { chatArchPrefix = null; chatArchRef = null; chatArchFp = null; chatArchBytes = 0; }
function chatMsgFp(m) {
if (!m || typeof m !== 'object') return '0';
try {
const t = typeof m.text === 'string' ? m.text : '';
const im = typeof m.img === 'string' ? m.img : '';
const vc = typeof m.voice === 'string' ? m.voice : '';
let ch = 0;
if (t.length && t.length <= CHAT_FP_TEXT) { for (let i = 0; i < t.length; i++) ch = (ch * 31 + t.charCodeAt(i)) | 0; }
const ps = m.parts;
let pn = 0;
if (Array.isArray(ps)) { for (let j = 0; j < ps.length; j++) { const p = ps[j]; if (p && typeof p === 'object') pn = (pn * 31 + String(p.k || '').length + (typeof p.v === 'string' ? p.v.length : 0)) | 0; } }
return ((typeof m.ts === 'number' ? m.ts : 0) || 0) + '|' + (m.side || '') + '|' + (m.type || '') + '|' + (m.special || '') + '|' +
(m.retracted ? 1 : 0) + '|' + (m.answered ? 1 : 0) + '|' + (m.pending ? 1 : 0) + '|' +
(m.dedupExempt ? 1 : 0) + '|' + t.length + '|' + ch + '|' + im.length + '|' + vc.length + '|' +
(Array.isArray(ps) ? ps.length : 0) + '|' + pn + '|' +
(m.choiceStatus || '') + '|' + (m.curiousStatus || '') + '|' + (m.inviteStatus || '') + '|' + (m.askStatus || '');
} catch (e) { return 'x'; }
}
function chatArchSetBaseline(prefix, arr) {
try {
chatArchPrefix = prefix;
chatArchRef = Array.isArray(arr) ? arr.slice() : [];
chatArchFp = chatArchRef.map(chatMsgFp);
chatArchBytes = msgsBytes(chatArchRef);
} catch (e) { chatArchClearBaseline(); }
}
function chatArchReusable(prefix, arr) {
if (chatArchPrefix !== prefix || !Array.isArray(chatArchRef) || !Array.isArray(arr)) return false;
const base = chatArchRef.length;
if (arr.length < base) return false;
for (let i = 0; i < base; i++) {
if (arr[i] !== chatArchRef[i]) return false;
if (chatMsgFp(arr[i]) !== chatArchFp[i]) return false;
}
return true;
}
function chatArchPurge(prefix) {
try { if (window.idbDelete) window.idbDelete(prefix + ':' + CHAT_ARCH_KEY); } catch (e) {}
try { localStorage.removeItem(prefix + ':' + CHAT_ARCH_KEY); } catch (e) {}
}
function persistChatHistory(prefix, arr, forceFull) {
try {
if (!window.idbSet) return;
if (!Array.isArray(arr)) arr = [];
if (chatBlkIdx) {
if (arr.length && chatArchBytes >= CHAT_ARCH_MIN_CKPT && chatArchReusable(prefix, arr)) {
const base = chatArchRef.length;
if (arr.length === base) { chatArchPurge(prefix); return; } // 与基准包全等，无增量
const log = arr.slice(base);
if (log.length <= CHAT_ARCH_MAX && msgsBytes(log) <= CHAT_ARCH_BYTES) {
persistMsgsToIdb(prefix + ':' + CHAT_ARCH_KEY, log);
return;
}
}
if (!chatRebased) {
chatBlkRewriteTail(prefix, arr); // 热片对齐尾部块重写（头部冷块不在内存也不需要；未 rebase 时内存绝不是全量，绝不能走整组重写=丢头部）
return;
}
chatBlkWriteFull(prefix, arr); // 内存全量（rebase 后/导入）：整组重分块
return;
}
if (!forceFull && arr.length && chatArchBytes >= CHAT_ARCH_MIN_CKPT && chatArchReusable(prefix, arr)) {
const base = chatArchRef.length;
if (arr.length === base) { chatArchPurge(prefix); return; } // 与基准包全等，无增量
const log = arr.slice(base);
if (log.length <= CHAT_ARCH_MAX && msgsBytes(log) <= CHAT_ARCH_BYTES) {
persistMsgsToIdb(prefix + ':' + CHAT_ARCH_KEY, log);
return;
}
}
if (msgsBytes(arr) > CHAT_BLK_MIN) { chatBlkWriteFull(prefix, arr); return; } // #722 大历史直接分块，不再写整包
persistMsgsToIdb(prefix + ':chat-msgs', arr);
chatArchPurge(prefix);
chatArchSetBaseline(prefix, arr);
} catch (e) {}
}
const CHAT_BLK_MIN = 4 * 1024 * 1024;
const CHAT_BLK_BYTES = 2 * 1024 * 1024;
const CHAT_BLK_HOT_N = 300;      // 热片至少覆盖的条数（不足再往前多取一块）
const CHAT_BLK_HOT_MAX = 2;      // 热片最多取的块数
let chatBlkIdx = null;           // 在位标记（null=旧整包格式）
let chatBlkTotal = 0;            // 全量条数（账本口径用，热片读时内存只有尾部）
let chatBlkWriting = false;      // 分块写单飞闸（并发请求合并，收尾取最新）
let chatBlkPending = null;       // 写期间到达的最新全量（收尾后补写）
let chatHotFrom = 0;             // 热片覆盖的块下标起点（尾部重写时保留其前的头块）
let chatColdHead = [];           // 已取回未并入 msgs 的头部消息（时间正序）
let chatColdFrom = 0;            // 尚未取回的头块下标
let chatColdDone = true;         // 头块是否已全部取回
let chatColdHydrating = false;
let chatRebased = false;         // 冷头是否已并入 msgs（此后内存=全量）
let chatHotBaseN = 0;            // 热片装载时的条数（#722 分块格式下账本守卫的比对基准）
const chatHotCache = {};
const CHAT_HOT_CACHE_TTL = 10 * 60 * 1000;
const CHAT_HOT_CACHE_MAX = 12;
function chatHotCacheGet(k) {
const e = chatHotCache[k];
if (!e || (Date.now() - e.at) > CHAT_HOT_CACHE_TTL) return undefined;
return e.v;
}
function chatHotCacheSet(k, v) {
try {
chatHotCache[k] = { v: v, at: Date.now() };
const ks = Object.keys(chatHotCache);
if (ks.length > CHAT_HOT_CACHE_MAX) {
ks.sort(function (a, b) { return chatHotCache[a].at - chatHotCache[b].at; });
for (let i = 0; i < ks.length - CHAT_HOT_CACHE_MAX; i++) delete chatHotCache[ks[i]];
}
} catch (e) {}
}
function chatHotCacheDropPrefix(prefix) {
try { Object.keys(chatHotCache).forEach(function (k) { if (k.indexOf(prefix + ':chat-blk-') === 0) delete chatHotCache[k]; }); } catch (e) {}
}
function chatHotCacheDropAll() {
try { Object.keys(chatHotCache).forEach(function (k) { delete chatHotCache[k]; }); } catch (e) {}
}
function chatHotCacheSyncLive(prefix, blocks) {
try {
const live = {}; (blocks || []).forEach(function (b) { live[b.k] = 1; });
Object.keys(chatHotCache).forEach(function (k) {
if (k.indexOf(prefix + ':chat-blk-') !== 0 || k === prefix + ':chat-blk-idx') return;
if (!live[k.slice(prefix.length + 1)]) delete chatHotCache[k]; // #954：死块缓存随写清除
});
} catch (e) {}
}
function chatBlkResetState() {
chatBlkIdx = null; chatBlkTotal = 0; chatHotFrom = 0; chatHotBaseN = 0;
chatColdHead = []; chatColdFrom = 0; chatColdDone = true; chatColdHydrating = false; chatRebased = false;
}
function chatBlkSplit(arr) {
const out = [];
let cur = [], bytes = 0;
for (let i = 0; i < arr.length; i++) {
const m = arr[i];
cur.push(m);
bytes += 96 + (m && typeof m.text === 'string' ? m.text.length : 0) + (m && typeof m.img === 'string' ? m.img.length : 0);
if (bytes >= CHAT_BLK_BYTES) { out.push(cur); cur = []; bytes = 0; }
}
if (cur.length) out.push(cur);
return out;
}
function chatBlkWriteFull(prefix, arr) {
if (chatBlkWriting) { chatBlkPending = arr.slice(); return; }
chatBlkWriting = true;
const old = chatBlkIdx;
const seq = (old && old.nextSeq) || 0;
const chunks = chatBlkSplit(arr);
const blocks = [];
let p = Promise.resolve();
let s = seq;
chunks.forEach(function (c) {
const k = 'chat-blk-' + (s++);
const a = c;
p = p.then(function () { return persistMsgsToIdb(prefix + ':' + k, a); }).then(function () {
chatHotCacheSet(prefix + ':' + k, a); // #954w 块写成功即更新缓存＝下次读永远拿到刚写的
blocks.push({ k: k, bytes: msgsBytes(a), n: a.length });
});
});
p = p.then(function () {
const idx = { v: 1, blocks: blocks, total: arr.length, nextSeq: s };
const idxStrW = JSON.stringify(idx); // #954
return window.idbSet(prefix + ':chat-blk-idx', idxStrW).then(function (ok) {
if (ok === false) throw new Error('idx-write-fail');
chatHotCacheSet(prefix + ':chat-blk-idx', idxStrW); // #954w
chatHotCacheSyncLive(prefix, blocks); // #954w 死块缓存随写清除
chatBlkIdx = idx; chatBlkTotal = arr.length;
chatHotFrom = Math.max(0, blocks.length - 1);
chatColdHead = []; chatColdFrom = 0; chatColdDone = true; chatRebased = false;
chatArchPurge(prefix);
chatArchSetBaseline(prefix, arr);
try { if (window.idbDelete) window.idbDelete(prefix + ':chat-msgs'); } catch (e) {}
try { localStorage.removeItem(prefix + ':chat-msgs'); } catch (e) {}
try {
const live = {}; blocks.forEach(function (b) { live[b.k] = 1; });
if (old && Array.isArray(old.blocks)) old.blocks.forEach(function (b) { if (!live[b.k] && window.idbDelete) window.idbDelete(prefix + ':' + b.k); });
} catch (e) {}
});
}).catch(function () { scheduleIdbRetry(); }).then(function () {
chatBlkWriting = false;
if (chatBlkPending) { const a = chatBlkPending; chatBlkPending = null; chatBlkWriteFull(prefix, a); }
});
}
function chatBlkRewriteTail(prefix, arr) {
if (chatBlkWriting) { chatBlkPending = arr.slice(); return; }
chatBlkWriting = true;
const idx = chatBlkIdx;
const head = (idx.blocks || []).slice(0, chatHotFrom);
const tailArr = arr;
const seq = idx.nextSeq || 0;
const chunks = chatBlkSplit(tailArr);
const blocks = head.slice();
let p = Promise.resolve();
let s = seq;
const newKeys = [];
chunks.forEach(function (c) {
const k = 'chat-blk-' + (s++);
const a = c;
newKeys.push(k);
p = p.then(function () { return persistMsgsToIdb(prefix + ':' + k, a); }).then(function () {
chatHotCacheSet(prefix + ':' + k, a); // #954t 尾块写成功即更新缓存
blocks.push({ k: k, bytes: msgsBytes(a), n: a.length });
});
});
p = p.then(function () {
const idx2 = { v: 1, blocks: blocks, total: arr.length, nextSeq: s };
const idxStrT = JSON.stringify(idx2); // #954
return window.idbSet(prefix + ':chat-blk-idx', idxStrT).then(function (ok) {
if (ok === false) throw new Error('idx-write-fail');
chatHotCacheSet(prefix + ':chat-blk-idx', idxStrT); // #954t
chatHotCacheSyncLive(prefix, blocks); // #954t 死块缓存随写清除
chatBlkIdx = idx2; chatBlkTotal = arr.length;
chatHotFrom = head.length;
const live = {}; blocks.forEach(function (b) { live[b.k] = 1; });
(idx.blocks || []).forEach(function (b) { if (!live[b.k] && window.idbDelete) window.idbDelete(prefix + ':' + b.k); });
chatArchPurge(prefix);
chatArchSetBaseline(prefix, arr);
});
}).catch(function () { scheduleIdbRetry(); }).then(function () {
chatBlkWriting = false;
if (chatBlkPending) { const a = chatBlkPending; chatBlkPending = null; chatBlkRewriteTail(prefix, a); }
});
}
function chatBlkPurgePrefix(prefix) {
try {
chatHotCacheDropPrefix(prefix); // #954：清空/导入＝热片缓存整前缀作废
if (chatBlkIdx && Array.isArray(chatBlkIdx.blocks) && window.idbDelete) {
chatBlkIdx.blocks.forEach(function (b) { try { window.idbDelete(prefix + ':' + b.k); } catch (e) {} });
}
if (window.idbDelete) { try { window.idbDelete(prefix + ':chat-blk-idx'); } catch (e) {} }
if (window.idbListKeys && window.idbDelete) {
window.idbListKeys().then(function (keys) {
(keys || []).forEach(function (k) {
if (typeof k === 'string' && k.indexOf(prefix + ':chat-blk-') === 0) { try { window.idbDelete(k); } catch (e) {} }
});
}).catch(function () {});
}
} catch (e) {}
}
function chatBlkHotLoad(prefix, idxRaw, noCache) {
const idx = JSON.parse(idxRaw);
if (!idx || !Array.isArray(idx.blocks) || !idx.blocks.length) return Promise.resolve(null);
chatBlkIdx = idx; chatBlkTotal = idx.total || 0;
const hotKeys = [];
let hotN = 0;
for (let b = idx.blocks.length - 1; b >= 0 && hotN < CHAT_BLK_HOT_N && hotKeys.length < CHAT_BLK_HOT_MAX; b--) {
hotKeys.unshift(idx.blocks[b].k); hotN += idx.blocks[b].n || 0;
}
chatHotFrom = idx.blocks.length - hotKeys.length;
chatHotBaseN = hotN; // #722：账本守卫基准=热片条数（内存此后=热片+新增）
const headN = Math.max(0, (idx.total || hotN) - hotN);
chatColdHead = []; chatColdFrom = 0; chatColdDone = headN === 0; chatColdHydrating = false; chatRebased = false;
let p = Promise.resolve();
const parts = [];
hotKeys.forEach(function (k, ki) {
const bytes = (chatBlkIdx && chatBlkIdx.blocks[chatHotFrom + ki] && chatBlkIdx.blocks[chatHotFrom + ki].bytes) || 1048576;
const hint = { minWaitMs: 4000 + Math.min(28000, Math.ceil((bytes || 1048576) / 1048576) * 2000) };
p = p.then(function () {
const fk = prefix + ':' + k;
if (!noCache) { const cv = chatHotCacheGet(fk); if (cv !== undefined) return cv; } // #954：热块缓存命中＝零 IDB 等待
return window.idbGet(fk, hint).then(function (v) { if (v !== undefined && v !== null) chatHotCacheSet(fk, v); return v; }); // #954：真读成功回填缓存（块值数组/字符串双形态都驻留，读侧本就双形态兼容）
}).then(function (v) { parts.push(v); });
});
return p.then(function () {
if (window.activePrefix() !== prefix) return null;
let hot = [], miss = false;
for (let pi = 0; pi < parts.length; pi++) {
let a = parts[pi];
if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = null; } }
const isLast = (pi === parts.length - 1);
if (!Array.isArray(a)) {
if (isLast) { miss = true; return; }
continue;
}
hot = hot.concat(a);
}
if (miss || !hot.length) return null; // 块读失败 → 回到旧读路径语义（=读失败重试，绝不置 ready）
return hot;
}).catch(function () { return null; });
}
function chatColdEnsureHydrated() {
if (chatColdDone || chatColdHydrating || !chatBlkIdx || chatRebased || !window.idbGet) return;
chatColdHydrating = true;
const myPrefix = window.activePrefix();
const step = function () {
if (window.activePrefix() !== myPrefix || !chatBlkIdx || chatRebased) { chatColdHydrating = false; return; }
if (chatColdFrom >= chatHotFrom) { chatColdDone = true; chatColdHydrating = false; return; }
const blk = chatBlkIdx.blocks[chatColdFrom];
window.idbGet(myPrefix + ':' + blk.k).then(function (v) {
if (window.activePrefix() !== myPrefix) { chatColdHydrating = false; return; }
if (!Array.isArray(v)) { chatColdHydrating = false; return; } // #722 读失败：下标不前移，留待下次触发重试同块
chatColdHead = v.concat(chatColdHead); // 头块按时间正序前插
chatColdFrom++;
setTimeout(step, 30);
}).catch(function () { chatColdHydrating = false; });
};
step();
}
function chatRebaseCold() {
const n = chatColdHead.length;
if (!n || chatRebased) return;
msgs = chatColdHead.concat(msgs);
chatColdHead = [];
chatRebased = true;
renderStart += n; renderEnd += n;
if (windowRenderedN) windowRenderedN += n;
if (Array.isArray(windowRenderedLite)) windowRenderedLite = windowRenderedLite.map(function (i2) { return i2 + n; });
try {
if (sessionChangedIdx && sessionChangedIdx.size) {
const s2 = Array.from(sessionChangedIdx).map(function (i2) { return i2 + n; });
sessionChangedIdx.clear(); s2.forEach(function (i2) { sessionChangedIdx.add(i2); });
}
} catch (e) {}
try { if (Array.isArray(normChangedIdxs)) normChangedIdxs = normChangedIdxs.map(function (i2) { return i2 + n; }); } catch (e) {}
try { if (typeof normOrigIdx === 'number' && normOrigIdx >= 0) normOrigIdx += n; } catch (e) {}
try {
Object.keys(inplaceDrafts).forEach(function (k) {
const v = inplaceDrafts[k]; delete inplaceDrafts[k]; inplaceDrafts[String(Number(k) + n)] = v;
});
} catch (e) {}
try { if (typeof inplaceFocusIdx === 'number' && inplaceFocusIdx >= 0) inplaceFocusIdx += n; } catch (e) {}
try { body.querySelectorAll('[data-idx]').forEach(function (el) { el.dataset.idx = String(Number(el.dataset.idx) + n); }); } catch (e) {}
try { chatArchSetBaseline(window.activePrefix(), msgs); } catch (e) {} // 基准 refs 升级为全量：此后编辑任何消息都能被指纹检出
try { syncLastMineText(); } catch (e) {} // #722 自查：lastMineIdx 是 msgs 下标，并入冷头后整体位移——直接重算（引用「我最后一条」的回复不会指错位）
}
function chatConsolidate(prefix) {
try {
if (!prefix || !window.idbSet) return;
if (chatArchPrefix !== prefix || !Array.isArray(chatArchRef)) return;
if (!Array.isArray(msgs) || !msgs.length) return;
if (!chatArchReusable(prefix, msgs)) return;
if (msgs.length <= chatArchRef.length) return;
if (!chatLedgerGuard(prefix, msgs)) return;
persistChatHistory(prefix, msgs, true);
} catch (e) {}
}
const CHAT_LEDGER_MIN = 300;
const CHAT_LEDGER_STEP = 50;   // IDB 账本按步进落盘：只需量级正确，免每次存盘多发事务
const chatLedger = {};         // prefix -> 已知权威条数
let chatLedgerWarned = {};
const chatLedgerRetryAt = {};  // prefix -> 上次强制重读时间（限流，防重读风暴）
const chatLedgerBytes = {};    // prefix -> 已落盘的字节估算（FIX 2026-09-01 #120，防重复写）
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
function chatLedgerLoad(prefix) {
if (!window.idbGet || chatLedger[prefix] !== undefined) return;
try {
window.idbGet(prefix + ':chat-meta').then(function (v) {
try {
if (v === undefined || v === null || chatLedger[prefix] !== undefined) return;
const o = typeof v === 'string' ? JSON.parse(v) : v;
if (o && typeof o.n === 'number' && o.n > 0) chatLedger[prefix] = o.n;
if (o && typeof o.b === 'number' && o.b >= 0) chatLedgerBytes[prefix] = o.b; // #716：字节账本一并回填，大键读等待窗要用
} catch (e) {}
}).catch(function () {});
} catch (e) {}
}
const CHAT_LAZY_BYTES = 8 * 1024 * 1024; // 历史字节估算门槛：超此即视为大包，冷启动懒读
function chatPrefetchIfLight(load) {
let prefix;
try { prefix = window.activePrefix(); } catch (e) { prefix = ''; }
if (!window.idbGet) { try { load(); } catch (e2) {} return; }
window.idbGet(prefix + ':chat-meta').then(function (v) {
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
function chatLedgerGuard(prefix, arr) {
const n = Array.isArray(arr) ? arr.length : 0;
let base = chatLedger[prefix];
if (chatBlkIdx && typeof chatHotBaseN === 'number' && chatHotBaseN > 0) base = chatHotBaseN;
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
function mergeLsSnapshotWith(msgsNow, prefix) {
try {
let raw = '';
try { raw = store.get('chat-msgs') || ''; } catch (e) { raw = ''; }
if (raw.length > LS_SNAP_LIMIT) { performLsSnapWrite(msgsNow, prefix); return; }
let old = [];
try { old = JSON.parse(raw || '[]'); } catch (e) { old = []; }
if (!Array.isArray(old)) old = [];
const seen = new Set(msgsNow.map(lsMergeSig));
const kinds = recKindIndex(msgsNow);
const copied = new Set();
msgsNow.forEach(x => chatRecKeysAdd(copied, x));
const merged = msgsNow.concat(old.filter(m => {
if (!m || seen.has(lsMergeSig(m)) || recKindCovers(kinds, m)) return false;
return !chatRecKeysHit(copied, m);
})).sort((a, b) => (((a && a.ts) || 0) - ((b && b.ts) || 0)));
performLsSnapWrite(merged, prefix);
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
const CHAT_TAIL_MAX = 60;
const CHAT_TAIL_TEXT_MAX = 1000;
function chatTailSig(m) {
try { return ((m && m.ts) || 0) + '|' + (m.side || '') + '|' + String((m && m.text) || '').slice(0, 120); } catch (e) { return ''; }
}
function chatTailId(m) {
try { return ((m && m.ts) || 0) + '|' + (m.side || '') + '|' + (m.special || ''); } catch (e) { return ''; }
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
function chatTailRetire(keep) {
try {
const arr = chatTailRead();
if (!Array.isArray(arr) || !arr.length) return;
const k = Array.isArray(keep) ? keep : [];
if (k.length === arr.length) return; // 一条都没覆盖，不写盘
try { store.set('chat-tail', JSON.stringify(k)); } catch (e) {}
} catch (e) {}
}
const CHAT_TAIL_INTERACT_FIELDS = ['askQuestion', 'askOptions', 'askType', 'deskCk', 'deskCkDir',
'choiceQuestion', 'choiceOptions', 'choicePref', 'choiceCat',
'curiousQuestion', 'curiousQuick', 'curiousReplies', 'curiousFollowup', 'curiousQid', 'curiousCat',
'roastText', 'roastCat', 'inviteContent', 'inviteStatus', 'inviteAnswer', 'inviteType'];
function chatTailAppend(rec) {
try {
if (!rec || rec.retracted || rec.img || rec.voice) return;
if (rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice') return;
if (Array.isArray(rec.parts) && rec.parts.length) return;
if (typeof rec.text !== 'string' || rec.text.length > CHAT_TAIL_TEXT_MAX) return;
const entry = { ts: rec.ts || Date.now(), side: rec.side || '', special: rec.special || '', text: rec.text, x: null };
for (let fi = 0; fi < CHAT_TAIL_INTERACT_FIELDS.length; fi++) {
const k = CHAT_TAIL_INTERACT_FIELDS[fi];
if (rec[k] !== undefined) { if (!entry.x) entry.x = {}; entry.x[k] = rec[k]; }
}
if (JSON.stringify(entry).length > CHAT_TAIL_TEXT_MAX * 3) return; // 超限宁可不兜底（同 #206 口径）
const arr = chatTailRead();
arr.push(entry);
while (arr.length > CHAT_TAIL_MAX) arr.shift();
store.set('chat-tail', JSON.stringify(arr));
} catch (e) {}
}
function chatTailDrop(rec) {
try {
if (!rec) return;
const sig = chatTailSig(rec);
const arr = chatTailRead().filter(j => chatTailSig(j) !== sig);
store.set('chat-tail', JSON.stringify(arr));
} catch (e) {}
}
function chatTailMerge(forPrefix) {
try {
if (forPrefix && typeof window !== 'undefined' && typeof window.activePrefix === 'function' && window.activePrefix() !== forPrefix) return 0;
const arr = chatTailRead();
if (!arr.length || !Array.isArray(msgs)) return;
const have = new Set();
const haveId = new Set();
let winFrom = Infinity;
for (let i = 0; i < msgs.length; i++) {
have.add(chatTailSig(msgs[i]));
haveId.add(chatTailId(msgs[i]));
const t0 = msgs[i] && msgs[i].ts;
if (typeof t0 === 'number' && t0 < winFrom) winFrom = t0;
}
const add = [];
const keep = []; // 本次仍须保留的日志条目（#766：命中＝已确认落盘，回收）
for (let i = 0; i < arr.length; i++) {
const j = arr[i];
if (!j) continue;
if (have.has(chatTailSig(j)) || haveId.has(chatTailId(j))) continue; // 已在这份权威历史里＝职责完成，摘除
if (winFrom !== Infinity && (j.ts || 0) < winFrom) { keep.push(j); continue; }
const jt = typeof j.text === 'string' ? j.text : '';
if (jt.indexOf('@@m:') === 0 || chatIsInlineDataSrc(jt)) { keep.push(j); continue; } // FIX #948 判据大小写/前导空白不敏感（变体存根回放＝乱码气泡）
keep.push(j);
const r = { ts: j.ts, side: j.side, special: j.special, text: jt };
if (j.x && typeof j.x === 'object') {
for (const k in j.x) { if (Object.prototype.hasOwnProperty.call(j.x, k)) r[k] = j.x[k]; }
}
add.push(r);
}
chatTailRetire(keep); // #766：已被历史覆盖的条目当场退休，日志不再长期留着重复的源头
if (!add.length) return 0;
msgs = msgs.concat(add).sort((a, b) => ((a && a.ts) || 0) - ((b && b.ts) || 0));
saveMsgs();
return add.length; // FIX 2026-09-13 #407：回放条数上抛（插入/排序=下标位移，调用方据此标记 changed 重渲）
} catch (e) {}
return 0;
}
let authLoadedPrefix = null;
let idbRetryTimer = null;
let idbRetryCount = 0;
const IDB_RETRY_MAX = 6;
function armChatAuthWatch() {
if (authWatchT) return;
authWatchT = setTimeout(function () {
authWatchT = null;
try {
if (chatAuthSettled()) return;
if (!chatVisible()) return; // 离开聊天页＝不空转（重进聊天走 enterChat 那条链并重新武装看门狗）
loadMsgs(true);
armChatAuthWatch();
} catch (e) {}
}, CHAT_AUTH_WATCH_MS);
}
function stopChatAuthWatch() { if (authWatchT) { clearTimeout(authWatchT); authWatchT = null; } }
function scheduleIdbRetry() {
if (idbRetryTimer || idbRetryCount >= IDB_RETRY_MAX) { armChatAuthWatch(); return; } // #967：快重试耗尽＝看门狗接手，绝不永久放弃读库
idbRetryCount++;
idbRetryTimer = setTimeout(function () {
idbRetryTimer = null;
try { loadMsgs(true); } catch (e) {} // #952：重试必须真读＝forceIdb 绕过读库链在飞去重闸
}, 5000);
}
let readyFuse = null;
function armReadyFuse() {
if (readyFuse || chatDbReady) return;
const fusePrefix = window.activePrefix();
readyFuse = setTimeout(function () {
readyFuse = null;
if (chatDbReady) return;
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
try { scheduleIdbRetry(); } catch (e) {}
try { updateChatLoading(); } catch (e) {} // 保险丝已就绪 → 隐藏聊天记录加载进度条
}, 15000);
}
function saveMsgs() {
try { scheduleMediaPass(1500); } catch (e) {} // #142：有新消息写入即安排增量令牌化（pass 自带权威守卫与 WeakSet 去重）
const authOk = chatDbReady && authLoadedPrefix === window.activePrefix();
if (!authOk) {
try { pendingLocal = msgs.slice(); } catch (e) {}
if (msgs.length) mergeLsSnapshotWith(msgs, undefined); // #245：合并而非覆盖，保住 LS 里的历史快照
try { scheduleIdbRetry(); } catch (e) {}
return;
}
const myPrefix = window.activePrefix();
schedulePersist(() => {
if (authLoadedPrefix !== myPrefix) return;
if (!chatLedgerGuard(myPrefix, msgs)) return;
try { if (window.idbSet) persistChatHistory(myPrefix, msgs); } catch (e) {}
writeLsSnapshot(msgs, myPrefix);
});
}
function flushSave() {
if (window.__resetting) return;
flushPersistNow();
try { chatConsolidate(chatArchPrefix); } catch (e) {}
if ((!chatDbReady || authLoadedPrefix !== window.activePrefix()) && msgs.length) writeLsSnapshot(msgs, undefined, true);
}
window.chatFlushSave = flushSave;
let _mediaPassT = null, _mediaPassBusy = false;
const _mediaTokSeen = new WeakSet();
function scheduleMediaPass(delay) {
if (!window.mochiMediaTokenize) return;
clearTimeout(_mediaPassT);
_mediaPassT = setTimeout(mediaNormalizePass, delay || 1500);
}
async function mediaNormalizePass() {
if (_mediaPassBusy) { scheduleMediaPass(4000); return; }
if (!chatDbReady || authLoadedPrefix !== window.activePrefix()) return;
_mediaPassBusy = true;
try {
let changed = 0;
let _rollback = []; // FIX 2026-09-05 #186 写池失败回滚账 [{obj, prop, val, msg}]
let _pendTok = 0; // FIX 2026-09-10 #283 迁移期分批冲池计数
for (let i = 0; i < msgs.length; i++) {
const m = msgs[i];
if (!m || _mediaTokSeen.has(m)) continue;
let did = false;
if (typeof m.text === 'string' && chatIsDataImgSrc(m.text)) {
const t = await window.mochiMediaTokenize(m.text.trim());
if (t) { _rollback.push({ o: m, p: 'text', v: m.text, msg: m }); m.text = t; changed++; did = true; }
}
if (typeof m.img === 'string' && chatIsDataImgSrc(m.img)) {
const t = await window.mochiMediaTokenize(m.img.trim());
if (t) { _rollback.push({ o: m, p: 'img', v: m.img, msg: m }); m.img = t; changed++; did = true; }
}
if (typeof m.text === 'string' && m.text.length > 1024) {
const _bar = m.text.indexOf('|||');
const _tail = _bar > 0 ? m.text.slice(_bar + 3) : '';
const _tailData = _bar > 0 && chatIsInlineDataSrc(_tail.trim()) ? _tail.trim() : '';
if (_tailData) {
const t = await window.mochiMediaTokenize(_tailData);
if (t) { _rollback.push({ o: m, p: 'text', v: m.text, msg: m }); m.text = m.text.slice(0, _bar + 3) + t; changed++; did = true; }
} else if (chatIsDataAudioSrc(m.text)) {
const t = await window.mochiMediaTokenize(m.text.trim());
if (t) { _rollback.push({ o: m, p: 'text', v: m.text, msg: m }); m.text = '|||' + t; changed++; did = true; }
}
}
if (typeof m.voice === 'string' && m.voice.length > 1024 && chatIsDataAudioSrc(m.voice)) {
const t = await window.mochiMediaTokenize(m.voice.trim());
if (t) { _rollback.push({ o: m, p: 'voice', v: m.voice, msg: m }); m.voice = t; changed++; did = true; }
}
if (Array.isArray(m.parts) && m.parts.length) {
for (let j = 0; j < m.parts.length; j++) {
const p = m.parts[j];
if (p && typeof p.v === 'string' && chatIsDataImgSrc(p.v)) {
const t = await window.mochiMediaTokenize(p.v.trim());
if (t) { _rollback.push({ o: p, p: 'v', v: p.v, msg: m }); p.v = t; changed++; did = true; }
}
}
}
_mediaTokSeen.add(m);
if (did) _pendTok++;
if ((i & 63) === 63 || _pendTok >= 32) {
if (_pendTok >= 32) {
const _okMid = await window.mochiMediaFlush();
if (_okMid === false) {
for (let r = 0; r < _rollback.length; r++) { try { _rollback[r].o[_rollback[r].p] = _rollback[r].v; } catch (e2) {} try { _mediaTokSeen.delete(_rollback[r].msg); } catch (e3) {} }
scheduleMediaPass(8000);
console.warn('[mochi] 媒体池写盘失败，本次 ' + changed + ' 处令牌化已回滚待重试');
return; // finally 复位 busy
}
_rollback = []; // 已冲批次池数据均已持久，全部除名（清空回滚账=释放原件引用）
_pendTok = 0;
}
await new Promise(r => setTimeout(r, 0));
if (authLoadedPrefix !== window.activePrefix()) break;
}
}
if (changed > 0) {
const _ok = await window.mochiMediaFlush(); // 池数据先落盘，再让引用落盘（顺序不可反）
if (_ok === false) {
for (let r = 0; r < _rollback.length; r++) { try { _rollback[r].o[_rollback[r].p] = _rollback[r].v; } catch (e2) {} try { _mediaTokSeen.delete(_rollback[r].msg); } catch (e3) {} }
scheduleMediaPass(8000);
console.warn('[mochi] 媒体池写盘失败，本次 ' + changed + ' 处令牌化已回滚待重试');
} else {
saveMsgs();
try { console.info('[mochi] 媒体池：' + changed + ' 处聊天图片/语音已去重为池引用'); } catch (e) {}
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
window.getChatMsgs = function () { return chatColdHead.length ? chatColdHead.concat(msgs) : msgs; }; // #722：冷头未并入时也返回完整历史（浅拼接，统计/导出/补投递等消费方零改动）
try { window.__mochiProf = window.__mochiProf || {}; } catch (e) {}
function __prof(t) { try { window.__mochiProf[t] = performance.now(); } catch (e) {} }
const ICON_BELL = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v3M4.2 4.2l2.2 2.2M2 12h3M19 12h3M4.2 19.8l2.2-2.2M17.6 17.6l2.2 2.2"/><path d="M12 6a6 6 0 016 6v4h-3v-4a3 3 0 00-6 0v4H6v-4a6 6 0 016-6z"/><path d="M9 20h6"/></svg>';
const ICON_TEL = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>';
const ICON_ENV = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
const ICON_CQ_FIX = { '再等等，会遇到我': '再等等，会遇到你', '你身边': '我身边', '只给我看': '只给你看' };
const NORM_CHUNK = 2500;
let normTimer = null, normPrefix = null;
function hasMultiImgParts(r) {
if (!r || !Array.isArray(r.parts)) return false;
let n = 0;
for (let i = 0; i < r.parts.length; i++) {
const p = r.parts[i];
if (p && p.k === 'img' && ++n > 1) return true;
}
return false;
}
function normCell(r) {
let c = false;
if (!r) return false;
try {
if (typeof r.text === 'string' && r.text.indexOf(ICON_BELL) >= 0) { r.text = r.text.split(ICON_BELL).join(ICON_TEL); c = true; }
if (r.special === 'poke' && typeof r.text === 'string') {
const t = r.text.replace(/✉️\s*/g, '').replace(/✉\s*/g, '');
if (t !== r.text) { r.text = ICON_ENV + t; c = true; }
}
if (typeof r.text === 'string' && r.text.indexOf('data:;base64,') >= 0) {
const __nmFixed = chatFixNoMimeImg(r.text);
if (__nmFixed) { r.text = __nmFixed; c = true; }
}
if ((r.type === 'text' || !r.type) && !hasMultiImgParts(r) && typeof r.text === 'string' && chatIsImgSrcLike(r.text)) { r.type = 'image'; c = true; }
if ((r.type === 'text' || !r.type) && typeof r.text === 'string' &&
(chatIsDataAudioSrc(r.text) || (r.text.indexOf('|||') >= 0 && /@@m:[0-9a-f]{32}$/.test(r.text)))) { r.type = 'voice'; c = true; }
if (Array.isArray(r.parts) && r.parts.length && typeof r.text === 'string' && r.text &&
!chatIsMediaPayload(r.text) &&
Array.isArray(r.mood) && r.mood.some(md => md && (md.tag === '词典' || md.tag === '词典拼字' || md.tag === '词典拼句' || md.tag === '词典拼词' || md.tag === '词典逐卡连发' || md.tag === '梦角自由造句'))) {
const __hpImgs = r.parts.filter(p => p && p.k === 'img');
const __hpTxt = r.parts.filter(p => p && p.k === 'text').map(p => p.v).join(' ');
if (__hpTxt !== r.text) {
r.parts = __hpImgs.length ? [{ k: 'text', v: r.text }].concat(__hpImgs) : null;
c = true;
}
}
if (pyChipDropIfSingle(r)) c = true;
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
const DUP_GAP_TEXT = 2500, DUP_GAP_MEDIA = 60000;
function mediaFormText(s) {
const raw = (s == null) ? '' : String(s);
if (!raw) return raw;
try {
if (window.mochiMediaIsToken && window.mochiMediaExpand) {
const bar = raw.indexOf('|||');
if (bar >= 0) {
const tail = raw.slice(bar + 3);
if (tail && window.mochiMediaIsToken(tail)) {
const ex = window.mochiMediaExpand(tail);
if (ex) return raw.slice(0, bar + 3) + ex;
}
} else if (window.mochiMediaIsToken(raw)) {
const ex = window.mochiMediaExpand(raw);
if (ex) return ex;
}
}
} catch (e) {}
return raw;
}
function mediaSigPart(v) {
if (v == null || v === '') return '';
if (typeof v !== 'string') { try { return String(v.length); } catch (e) { return ''; } }
const x = mediaFormText(v);
if (x.length <= 256) return x;
return x.length + '|' + x.slice(0, 96);
}
function mediaTxtEq(a, b) {
const x = (a == null) ? '' : String(a);
const y = (b == null) ? '' : String(b);
if (x === y) return true;
return mediaFormText(x) === mediaFormText(y);
}
function mediaKindOf(v) {
if (typeof v !== 'string' || !v) return '';
try {
if (window.mochiMediaIsToken && window.mochiMediaIsToken(v)) return 'tok';
const bar = v.indexOf('|||');
if (bar >= 0) {
const tail = v.slice(bar + 3);
if (chatIsInlineDataSrc(tail)) return 'raw'; // FIX #948
if (window.mochiMediaIsToken && window.mochiMediaIsToken(tail)) return 'tok';
return '';
}
if (chatIsInlineDataSrc(v)) return 'raw'; // FIX #948 整串任意 data: 载荷都是媒体，不是文字
} catch (e) {}
return '';
}
function recMediaKind(m) { return m ? (mediaKindOf(m.text) || mediaKindOf(m.img)) : ''; }
function recMediaKey(m) {
return ((m.ts || 0) + '|' + (m.side || '') + '|' + (m.special || '') + '|' + (m.type || ''));
}
function recKindIndex(arr) {
const idx = new Map();
try {
for (let i = 0; i < arr.length; i++) {
const m = arr[i];
if (!m) continue;
const k = recMediaKind(m);
if (!k) continue;
const key = recMediaKey(m);
let rec = idx.get(key);
if (!rec) { rec = { raw: false, tok: false }; idx.set(key, rec); }
rec[k] = true;
}
} catch (e) {}
return idx;
}
function recKindCovers(kindIndex, m) {
if (!kindIndex || !m) return false;
const k = recMediaKind(m);
if (!k) return false;
const rec = kindIndex.get(recMediaKey(m));
if (!rec) return false;
return k === 'tok' ? rec.raw : rec.tok;
}
function dupGapMs(m) {
if (!m) return DUP_GAP_TEXT;
if (m.img || m.voice || m.special) return DUP_GAP_MEDIA;
if ((m.type === 'sticker' || m.type === 'image' || m.type === 'voice') && (m.side || '') === 'in') return DUP_GAP_MEDIA;
if (m.type === 'sticker' || m.type === 'image' || m.type === 'voice') return 800;
if (Array.isArray(m.parts) && m.parts.some(p => p && p.k === 'img') && (m.side || '') === 'out') return 800;
if ((m.side || '') === 'out' && (m.type === 'text' || !m.type) && !m.img && !m.voice && !m.special) return 800;
return DUP_GAP_TEXT;
}
window.__mochiMsgCut = window.__mochiMsgCut || [];
function chatMsgCutMark(tag, m) {
try {
const a = window.__mochiMsgCut;
a.push(Date.now() + ':' + tag + ':' + ((m && m.side) || '') + ':' + String((m && m.text) != null ? m.text : ((m && m.special) || '')).slice(0, 20));
if (a.length > 40) a.shift();
} catch (e) {}
}
function normCollapseRange(from, to) {
let removed = 0;
try {
const n = msgs.length;
for (let i = Math.min(to, n) - 1; i > from; i--) {
const a = msgs[i], b = msgs[i - 1];
if (!a || !b || !a.side || a.side !== b.side) continue;
if (dupSig(a) !== dupSig(b)) continue;
if (a.dedupExempt || b.dedupExempt) continue; // FIX 2026-09-15 #544 决定答案豁免相邻合并（刷新侧与 addRec 实时侧同口径，屏上所见即刷新后所见）
const hasContent = (a.text && a.text.length) || a.img || a.voice || !!a.special || (a.parts && a.parts.length);
if (!hasContent) continue;
const dts = (a.ts || 0) - (b.ts || 0);
if (dts !== 0) continue;
chatMsgCutMark('g814ts', a); // #814d
try { if (normRemovedRecs) normRemovedRecs.push(a); } catch (e) {} // FIX #675：被删记录对象留给原位收敛
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
const idSeen = new Map(); // FIX 2026-09-18 #776：身份级重复收敛的下标登记（跨块共享，本轮归一化内有效）
let changedHi = -1, removedAll = 0, sysNickChanged = false;
normChangedIdxs = []; // FIX 2026-09-13 #402：本轮归一化改动下标清单（原位补丁用）
normChangedRecs = []; normRemovedRecs = [];
const N = msgs.length;
if (!N) { normPrefix = null; return; }
try { normOrigIdx = new Map(); for (let _oi = 0; _oi < N; _oi++) normOrigIdx.set(msgs[_oi], _oi); } catch (e) { normOrigIdx = null; }
try { normSnapTail = (document.getElementById('chat-body') || {}).lastElementChild || null; } catch (e) { normSnapTail = null; }
const finish = () => {
try { sysNickChanged = !!sysNickCatchup(); changed = changed || sysNickChanged; } catch (e) {}
normPrefix = null;
if (!changed) return;
if (authLoadedPrefix !== myPre) return;
const canPersist = chatLedgerGuard(myPre, msgs);
if (canPersist) {
try { if (window.idbSet) persistChatHistory(myPre, msgs); } catch (e) {}
try { writeLsSnapshot(msgs, myPre, true); } catch (e) {}
}
try {
if (chatVisible() && msgs.length &&
(sysNickChanged || removedAll > 0 || changedHi >= renderStart)) {
let patched = false;
if (!sysNickChanged && removedAll > 0 &&
patchNormRemovalsInPlace(normRemovedRecs)) {
const newIdxs = [];
try {
for (let _ci = 0; _ci < normChangedRecs.length; _ci++) {
const _ni = msgs.indexOf(normChangedRecs[_ci]);
if (_ni >= 0) newIdxs.push(_ni);
}
} catch (e) { newIdxs.length = 0; }
patched = patchChangedInPlace(newIdxs, renderStart);
} else if (!(sysNickChanged || removedAll > 0)) {
patched = patchChangedInPlace(normChangedIdxs, renderStart);
}
if (!patched) {
renderWindow(false, true);
scrollChatBottom();
}
} else if (changed && changedHi >= renderStart) {
windowStale = true;
try { if (!chatVisible()) scheduleChatPrewarm(myPre); } catch (e) {} // #951f 凭据既已作废，页面还藏着时当场把预渲重做一遍——否则这份作废只会在用户点开聊天那一瞬兑现成整窗重建（clear→逐块重建＝闪屏），预渲白做一次
}
} catch (e) {}
};
const tick = () => {
let nowPre;
try { nowPre = window.activePrefix(); } catch (e) { nowPre = ''; }
if (nowPre !== normPrefix) { normPrefix = null; return; }
const end = Math.min(N, idx + NORM_CHUNK);
for (let i = idx; i < end; i++) { if (normCell(msgs[i])) { changed = true; changedHi = Math.max(changedHi, i); if (normChangedIdxs.indexOf(i) < 0) normChangedIdxs.push(i); try { normChangedRecs.push(msgs[i]); } catch (e) {} } }
const _id = collapseIdentityRange(idx, end + 1, idSeen); // FIX #776 身份级重复（正文签名看不见的那一类）
if (_id) { changed = true; removedAll += _id; }
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
if (r && (r.type === 'text' || !r.type) && !hasMultiImgParts(r) && typeof r.text === 'string' && chatIsImgSrcLike(r.text)) { // FIX 2026-09-20 #948 与 normCell 同款大小写/空白不敏感判据
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
else if (sp === 'gift') extra = String(m.giftId || '') + '|' + String(m.giftName || '') + '|' + String(m.giftEmoji || '') + '|' + String(m.giftWish || '') + '|' + String(m.giftPrice == null ? '' : m.giftPrice); // FIX 2026-09-12 #379 礼物签名误用鲜花字段（flName/flEmoji/flWish 礼物记录里全 undefined）→ 任意两件礼物签名恒等，60s 窗口内第二件被当重复删＝「连续送心愿单礼物第一件之外全闪一下就消失」；改用礼物自己的字段（dish 菜肴同理），不同礼物签名必然不同
else if (sp === 'dish') extra = String(m.dishName || '') + '|' + String(m.dishEmoji || '') + '|' + String(m.dishWish || '') + '|' + String(m.dishPrice == null ? '' : m.dishPrice); // FIX #379 同上：菜肴消息字段与鲜花不同，此前也恒等签名
else if (sp === 'flower') extra = String(m.flName || '') + '|' + String(m.flEmoji || '') + '|' + String(m.flWish || '');
} catch (e) {}
const normT = (m.type === 'text' || !m.type) ? '' : String(m.type || '');
const x = mediaFormText(m.text);
return JSON.stringify({ s: m.side || '', t: normT, sp: sp, x: x, im: !!m.img, vc: !!m.voice, e: extra });
}
function lsMergeSig(m) {
if (!m) return '';
const x = mediaFormText(m.text);
return ((m.ts || 0) + '|' + (m.side || '') + '|' + (m.special || '') + '|' + (m.type || '') + '|' + x.length + '|' + x.slice(0, 96));
}
try { window.__lsMergeSig = lsMergeSig; } catch (e) {} // 回归脚本可测性出口（只读纯函数）
function collapseRapidDups(arr) {
let removed = 0;
for (let i = arr.length - 1; i > 0; i--) {
const a = arr[i], b = arr[i - 1];
if (!a || !b || !a.side || a.side !== b.side) continue;
if (dupSig(a) !== dupSig(b)) continue;
const hasContent = (a.text && a.text.length) || a.img || a.voice || !!a.special || (a.parts && a.parts.length);
if (!hasContent) continue;
const dts = (a.ts || 0) - (b.ts || 0);
if (dts < 0 || dts > dupGapMs(a)) continue;
arr.splice(i, 1);
removed++;
}
return removed;
}
function chatRecIdKey(m) {
if (!m) return '';
const t = m.ts;
if (typeof t !== 'number' || !(t > 0)) return ''; // 无 ts 的记录不参与身份判定（防「0|side」互撞误删）
return t + '|' + (m.side || '');
}
function chatRecKindKey(m) {
const k = chatRecIdKey(m);
if (!k) return '';
const normT = (m.type === 'text' || !m.type) ? '' : String(m.type || '');
return k + '|' + (m.special || '') + '|' + normT;
}
function chatRecLooseSig(m) {
if (!m) return '';
try {
const normT = (m.type === 'text' || !m.type) ? '' : String(m.type || '');
let ps = '';
if (Array.isArray(m.parts) && m.parts.length) {
ps = m.parts.map(function (p) { return (p && p.k ? p.k : '') + ':' + mediaSigPart(p && p.v).slice(0, 24); }).join(',');
}
return JSON.stringify({ s: m.side || '', t: normT, sp: m.special || '', x: mediaSigPart(m.text), ps: ps });
} catch (e) { return ''; }
}
function chatRecCopyKeys(m) {
const out = [];
const k = chatRecKindKey(m);
if (!k) return out;
const s = chatRecLooseSig(m);
if (s) out.push(k + '|' + s);
if (m && typeof m.uid === 'string' && m.uid) out.push(k + '#u' + m.uid);
return out;
}
function chatRecKeysAdd(set, m) {
const a = chatRecCopyKeys(m);
for (let i = 0; i < a.length; i++) set.add(a[i]);
return set;
}
function chatRecKeysHit(set, m) {
const a = chatRecCopyKeys(m);
for (let i = 0; i < a.length; i++) if (set.has(a[i])) return true;
return false;
}
const _recUidSalt = Math.random().toString(36).slice(2, 10);
let _recUidSeq = 0;
function chatRecStampUid(rec) {
if (!rec || typeof rec !== 'object' || rec.uid) return;
try {
const t = (typeof rec.ts === 'number' && rec.ts > 0) ? rec.ts : Date.now();
rec.uid = _recUidSalt + '-' + t.toString(36) + '-' + (++_recUidSeq).toString(36);
} catch (e) {}
}
function chatRecIdScore(m) {
if (!m) return -1;
let s = 0;
try {
if (typeof m.text === 'string') s += m.text.length;
if (typeof m.img === 'string') s += m.img.length ? 1000 + m.img.length : 0;
if (typeof m.voice === 'string') s += m.voice.length ? 1000 + m.voice.length : 0;
if (Array.isArray(m.parts) && m.parts.length) s += 2000 * m.parts.length;
if (m.special) s += 500;
if (m.askQuestion || m.choiceQuestion || m.curiousQuestion || m.roastText || m.inviteContent) s += 300;
if (m.retracted) s -= 400; // 撤回态比原文更弱：优先保留未撤回的那份
} catch (e) {}
return s;
}
function chatRecKeysShare(a, b) {
const ka = chatRecCopyKeys(a);
if (!ka.length) return false;
const kb = chatRecCopyKeys(b);
if (!kb.length) return false;
for (let i = 0; i < ka.length; i++) for (let j = 0; j < kb.length; j++) if (ka[i] === kb[j]) return true;
return false;
}
function chatRecCardExtra(m) {
if (!m) return '';
let s = '';
try {
if (m.giftId != null) s += '|G' + m.giftId;
if (m.giftName) s += '|N' + m.giftName;
if (m.rpAmount != null) s += '|A' + m.rpAmount;
if (m.rpWish) s += '|W' + m.rpWish;
if (m.flName) s += '|F' + m.flName;
if (m.flEmoji) s += '|E' + m.flEmoji;
if (m.inviteContent) s += '|I' + m.inviteContent;
if (m.askQuestion) s += '|Q' + m.askQuestion;
if (m.askFen != null) s += '|K' + m.askFen;
if (m.dishName) s += '|D' + m.dishName;
} catch (e) {}
return s;
}
function collapseIdentityRange(from, to, seen) {
let removed = 0;
try {
if (!seen || typeof seen.set !== 'function') return 0;
const n = msgs.length;
const drop = new Set();
for (let i = from; i < to && i < n; i++) {
const m = msgs[i];
if (!m || drop.has(i)) continue;
const ks = chatRecCopyKeys(m);
if (!ks.length) continue;
let j;
for (let q = 0; q < ks.length; q++) {
const v = seen.get(ks[q]);
if (v !== undefined && v !== i && !drop.has(v)) { j = v; break; }
}
if (j === undefined) { for (let q = 0; q < ks.length; q++) seen.set(ks[q], i); continue; }
const other = msgs[j];
if (!other || !chatRecKeysShare(other, m)) { // 下标漂移（本块删过东西）＝重新登记，绝不删
for (let q = 0; q < ks.length; q++) seen.set(ks[q], i);
continue;
}
const keep = chatRecIdScore(m) > chatRecIdScore(other) ? i : j;
const lose = keep === i ? j : i;
try { if (normRemovedRecs) normRemovedRecs.push(msgs[lose]); } catch (e) {}
drop.add(lose);
const kk = chatRecCopyKeys(msgs[keep]); // 幸存者的全部键指向它（第三份副本照此与它比）
for (let q = 0; q < kk.length; q++) seen.set(kk[q], keep);
removed++;
}
const idx = Array.from(drop).sort((a, b) => a - b);
for (let d = idx.length - 1; d >= 0; d--) msgs.splice(idx[d], 1);
} catch (e) {}
return removed;
}
window.__mochiDupCensus = function () {
try {
const byId = new Map();
let uidN = 0;
for (let i = 0; i < msgs.length; i++) {
const m = msgs[i];
if (!m) continue;
if (m.uid) uidN++;
const k = chatRecKindKey(m); // 裸 ts|side 不够：同一毫秒同侧投两张不同卡（ask-msg + ask-curious）是常态
if (!k) continue;
const g = byId.get(k);
if (g) g.push(m); else byId.set(k, [m]);
}
let groups = 0, extra = 0, same = 0, uidc = 0, drift = 0, batch = 0;
const eg = [];
const head = function (m) {
const t = String((m && m.text) || '').slice(0, 18);
return t || ((m && (m.special || m.type)) ? String(m.special || m.type) : '(空)');
};
const kinds = {};
byId.forEach(function (g) {
if (!g || g.length < 2) return;
groups++;
extra += g.length - 1;
for (let i = 1; i < g.length; i++) {
const a = g[0], b = g[i];
const ua = (typeof a.uid === 'string' && a.uid) ? a.uid : '';
const ub = (typeof b.uid === 'string' && b.uid) ? b.uid : '';
if (ua && ub && ua !== ub) { batch++; continue; } // 各带出生号＝同毫秒批量，不是副本
if (chatRecLooseSig(a) && chatRecLooseSig(a) === chatRecLooseSig(b)) same++;
else if (ua && ua === ub) uidc++;
else drift++;
if (eg.length < 3) eg.push((a.side || '?') + ':' + head(a) + ' ⟂ ' + head(b));
}
const kk = (g[0].special || g[0].type || 'text') + '×' + g.length;
kinds[kk] = (kinds[kk] || 0) + 1;
});
let top = '';
try {
top = Object.keys(kinds).sort(function (a, b) { return kinds[b] - kinds[a]; }).slice(0, 3)
.map(function (k) { return k + '(' + kinds[k] + '组)'; }).join(' ');
} catch (e) {}
return { total: msgs.length, groups: groups, extra: extra, same: same, uidc: uidc, drift: drift, batch: batch, sus: same + uidc + drift, uid: uidN, top: top, eg: eg };
} catch (e) { return { err: String(e) }; }
};
function answeredRec(r) {
if (!r) return false;
if (r.special === 'ask-choose' && r.choiceStatus === 'answered') return true;
if (r.special === 'ask-curious' && r.curiousStatus === 'answered') return true;
if (r.special === 'ask-roast' && r.roastStatus === 'answered') return true;
if (r.special === 'ask-card' && r.askStatus === 'answered') return true;
if (r.special === 'invite' && r.inviteStatus === 'answered') return true;
return false;
}
let _lmChainBusy = null;
let _lmChainBusyUntil = 0;
function loadMsgs(forceIdb) {
armReadyFuse();
if (!chatDbReady) {
let lsArr = [];
try { lsArr = JSON.parse(store.get('chat-msgs') || '[]'); } catch (e) { lsArr = []; }
if (!Array.isArray(lsArr)) lsArr = [];
if (lsArr.length && msgs.length) {
const seen = new Set(lsArr.map(lsMergeSig));
const lsKinds = recKindIndex(lsArr);
const extra = msgs.filter(m => m && !seen.has(lsMergeSig(m)) && !recKindCovers(lsKinds, m));
msgs = lsArr.concat(extra).sort((a, b) => (((a && a.ts) || 0) - ((b && b.ts) || 0)));
} else if (lsArr.length) {
msgs = lsArr;
}
try { syncLastMineText(); } catch (e) {}
}
const nowT = Date.now();
const skipRead = chatDbReady &&
lastIdbLoadPrefix === window.activePrefix() &&
nowT - lastIdbLoadAt < IDB_RELOAD_MIN_GAP &&
!forceIdb;
if (!skipRead) {
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
if (!forceIdb && _lmChainBusy === myPrefix && Date.now() < _lmChainBusyUntil) return;
_lmChainBusy = myPrefix;
_lmChainBusyUntil = Date.now() + 12000;
chatAuthPending = true; // #967：本条链起读＝权威未达（进度条据此保持，"数据到没到"不再由保险丝冒充）
armChatAuthWatch(); // #967：链一起就给看门狗兜底（快重试被打断/饿死时仍有慢重试）
try { chatLedgerLoad(myPrefix); } catch (e) {}
let bigReadMs = 0;
try {
const lb = chatLedgerBytes[myPrefix];
if (typeof lb === 'number' && lb > 2 * 1024 * 1024) bigReadMs = 4000 + Math.min(28000, Math.ceil(lb / 1048576) * 2000);
} catch (e0) {}
let bidxP = null;
if (!forceIdb) { const ci954 = chatHotCacheGet(myPrefix + ':chat-blk-idx'); if (typeof ci954 === 'string') bidxP = Promise.resolve(ci954); } // #954：索引缓存命中
if (!bidxP) bidxP = window.idbGet(myPrefix + ':chat-blk-idx').then(function (raw954) {
if (raw954 && typeof raw954 === 'string' && raw954.indexOf('"v"') >= 0) chatHotCacheSet(myPrefix + ':chat-blk-idx', raw954); // #954：索引真读成功回填缓存
return raw954;
});
bidxP.then(function (bidxRaw) {
if (window.activePrefix() !== myPrefix) return null;
if (bidxRaw && typeof bidxRaw === 'string' && bidxRaw.indexOf('"v"') >= 0) {
return chatBlkHotLoad(myPrefix, bidxRaw, !!forceIdb);
}
return window.idbGet(myPrefix + ':chat-msgs', bigReadMs > 4000 ? { minWaitMs: bigReadMs } : undefined);
}).then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v === undefined || v === null) {
const idbKey = myPrefix + ':chat-msgs';
const idbArchKey = myPrefix + ':chat-arch';
const confirmMiss = window.idbHasKey
? Promise.all([window.idbHasKey(idbKey), window.idbHasKey(idbArchKey)]).then(function (r) { return r[0] === false && r[1] === false; })
: (window.idbGetAllKeys
? window.idbGetAllKeys().then(function (keys) {
return !(keys || []).some(function (k) { return k === idbKey || k === idbArchKey; });
}).catch(function () { return false; })
: Promise.resolve(true));
confirmMiss.then(function (isMiss) {
if (window.activePrefix() !== myPrefix) return;
if (!isMiss) { scheduleIdbRetry(); return; }
let _ledN = 0;
try { _ledN = chatLedger[myPrefix] || 0; } catch (e) {}
if (_ledN > 0) { scheduleIdbRetry(); return; }
chatKnownEmpty = true;
try { updateChatLoading(); } catch (e) {}
setTimeout(function () {
try { if (window.activePrefix() !== myPrefix) return; } catch (e) {}
const reprobe = window.idbHasKey
? Promise.all([window.idbHasKey(idbKey), window.idbHasKey(idbArchKey)]).then(function (r) { return (r[0] === true || r[1] === true) ? true : null; })
: Promise.resolve(null);
Promise.resolve(reprobe).then(function (has2) {
try { if (window.activePrefix() !== myPrefix) return; } catch (e) {}
if (has2 === true) { scheduleIdbRetry(); return; }
window.idbGet(idbKey).then(function (v2) {
try { if (window.activePrefix() !== myPrefix) return; } catch (e) {}
if (v2 !== undefined && v2 !== null) { scheduleIdbRetry(); return; }
window.idbGet(idbArchKey).then(function (v3) {
try { if (window.activePrefix() !== myPrefix) return; } catch (e) {}
if (v3 !== undefined && v3 !== null) { scheduleIdbRetry(); return; }
enterConfirmedEmpty();
}).catch(function () { scheduleIdbRetry(); });
}).catch(function () { scheduleIdbRetry(); });
}).catch(function () { scheduleIdbRetry(); });
}, 2500);
return;
});
function enterConfirmedEmpty() {
chatDbReady = true;
chatKnownEmpty = true; // FIX 2026-09-15 #526：确认空库＝无历史可读
chatAuthPending = false; // #967：确认空库＝有结论，进度条收起是正确语义
stopChatAuthWatch(); // #967：空库＝读库有结论，看门狗下班
idbRetryCount = 0;
_lmChainBusy = null; // #952：空库确认收尾，放行后续 loadMsgs
authLoadedPrefix = myPrefix;
chatArchClearBaseline(); // FIX 2026-09-17 #127：空库无基准段
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
try { if (window.idbSet) persistChatHistory(myPrefix, msgs, true); } catch (e) {}
writeLsSnapshot(msgs, myPrefix, true);
}
try { chatLedgerSave(myPrefix, (msgs && msgs.length) || 0, msgsBytes(msgs)); } catch (e) {}
try { chatTailMerge(myPrefix); } catch (e) {} // #180：确认空库也回放尾巴日志（本会话/上次会话未落盘部分）；#766 同命名空间才回放
try { updateChatLoading(); } catch (e) {} // FIX 2026-09-15 #526：确认空库后收起进度条
try { scheduleChatPrewarm(myPrefix); } catch (e) {} // #951g 空桌面确认权威落定（无内容可画时函数内自带 msgs 守卫直接不动作）
}
return;
}
try {
__prof('ch0_enter');
let idbArr = typeof v === 'string' ? JSON.parse(v) : v;
__prof('ch1_parsed');
if (!Array.isArray(idbArr)) { // #967：读到不可用形态（脏值/异格式）＝按读失败处理——旧实现只置 ready 就 return，
chatDbReady = true; chatKnownEmpty = false; _lmChainBusy = null; // #952 收尾清在飞标记
scheduleIdbRetry(); return; }
const sigOf = (m) => { try { return JSON.stringify({ t: mediaSigPart(m && m.text), s: m && m.side, ts: m && m.ts, i: (m && m.img) ? mediaSigPart(m.img) : 0 }); } catch (e) { return ''; } };
const ckptArr = idbArr;
window.idbGet(myPrefix + ':chat-arch').then(function (av) {
if (window.activePrefix() !== myPrefix) return;
if (av === undefined || av === null) { try { av = store.get(CHAT_ARCH_KEY); } catch (e) {} } // LS 兜底（旧版/导入曾把日志键落 LS）
try {
let archArr = [];
try { archArr = typeof av === 'string' ? JSON.parse(av) : av; } catch (e) { archArr = []; }
if (!Array.isArray(archArr)) archArr = [];
if (archArr.length) {
const ckptSigs = new Set();
const ckptCopies = new Set(); // FIX 2026-09-18 #776：日志与基准包的拼接只认正文签名 sigOf ⇒ 基准包那条被剥掉媒体/换过存法时，日志里的同一条被当「正文不同的新消息」拼回来＝同一条两份（同 ts），事后任何正文判据都合不掉。副本键忽略媒体在场与存法，专治这一类
for (let ci = 0; ci < ckptArr.length; ci++) { if (ckptArr[ci]) { ckptSigs.add(sigOf(ckptArr[ci])); chatRecKeysAdd(ckptCopies, ckptArr[ci]); } }
archArr = archArr.filter(function (m) { return m && !ckptSigs.has(sigOf(m)) && !chatRecKeysHit(ckptCopies, m); });
if (archArr.length) idbArr = ckptArr.concat(archArr).sort(function (a, b) { return (((a && a.ts) || 0) - ((b && b.ts) || 0)); });
}
} catch (e) {}
const hasLocal = !!((pendingLocal && pendingLocal.length) || (msgs && msgs.length));
let merged, curArr = pendingLocal || msgs || [];
let changed = false;
if (!hasLocal) {
merged = idbArr;
} else {
const idbSigs = new Set();
idbArr.forEach(x => { if (x) idbSigs.add(sigOf(x)); });
__prof('ch2_sigset');
const idbTsSide = new Set(idbArr.map(x => (((x && x.ts) || 0) + '|' + ((x && x.side) || ''))));
const idbCopies = new Set();
idbArr.forEach(x => chatRecKeysAdd(idbCopies, x));
__prof('ch3_tsside');
const liteResidue = (m) => !!(m && (m._lsLite || m.img === '' || m.voice === ''));
const idbKinds = recKindIndex(idbArr);
__prof('ch3b_kinds');
const localNew = curArr.filter(m => m && !idbSigs.has(sigOf(m))).filter(m => {
if (recKindCovers(idbKinds, m)) return false;
if (chatRecKeysHit(idbCopies, m)) return false;
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
try { syncLastMineText(); } catch (e) {}
__prof('ch5_passes');
pendingLocal = null;
chatDbReady = true;
chatKnownEmpty = false; // FIX 2026-09-15 #526：读到权威数据（含空数组）＝不再是「已知空库」，进度条交回常规判定
chatAuthPending = false; // #967：权威到手，进度条交回常规判定
stopChatAuthWatch(); // #967：权威到手＝看门狗下班
authLoadedPrefix = myPrefix;
idbRetryCount = 0;
_lmChainBusy = null; // #952：本桌读库链成功收尾，放行后续 loadMsgs
try { if (chatTailMerge(myPrefix) > 0) changed = true; } catch (e) {} // #180：权威就绪后回放尾巴日志（上次会话未落盘的最近消息）；FIX #407 回放插入=下标位移，并入 changed 走重渲，防屏上 data-idx 陈旧串条；FIX #766 传入 myPrefix＝日志必须与这份 msgs 同命名空间才回放
try { chatLedgerSave(myPrefix, chatBlkTotal || idbArr.length, chatBlkTotal ? Math.max(msgsBytes(idbArr), chatLedgerBytes[myPrefix] || 0) : msgsBytes(idbArr)); } catch (e) {} // #722 分块格式：账本记全量条数（热片读时 idbArr 只是尾部，全量条数以 idx.total 为准，缩水守卫才不会误判）
if (!chatBlkIdx && msgsBytes(idbArr) > CHAT_BLK_MIN) {
setTimeout(function () {
try {
if (window.activePrefix() !== myPrefix || chatBlkIdx || chatBlkWriting) return;
if (Array.isArray(msgs) && msgs.length > 100) chatBlkWriteFull(myPrefix, msgs);
} catch (e) {}
}, 15000);
}
try { chatArchSetBaseline(myPrefix, ckptArr); } catch (e) {}
try {
lastIdbLoadPrefix = window.activePrefix();
lastIdbLoadAt = Date.now();
} catch (e) {}
try { localStorage.removeItem('xy-home-v2:chat-msgs'); } catch (e) {}
if (changed) {
__prof('ch6_save');
try { if (window.idbSet) persistChatHistory(myPrefix, msgs); } catch (e) {}
try { writeLsSnapshot(msgs, myPrefix, true); } catch (e) {}
__prof('ch7_end');
if (chatVisible() && chatNearBottom()) {
chatSettleHoldArm(); // #1010：权威收尾在飞（换装 + 视口媒体解码）——进度条持有到本段结束
if (!inplacePatchIfSameWindow()) {
renderWindow(false, true);
scrollChatBottom();
}
chatSettleHoldSettle();
} else if (chatVisible()) {
windowStale = true;
}
} else if (chatVisible() && msgs.length && !body.children.length) {
chatSettleHoldArm(); // #1010：冷加载首渲同样走收尾媒体窗
renderWindow(false, true);
scrollChatBottom();
chatSettleHoldSettle();
}
if (!changed) {
setTimeout(function () {
try { if (window.activePrefix() === myPrefix) writeLsSnapshot(msgs, myPrefix, true); } catch (e) {}
}, 0);
}
try { updateChatLoading(); } catch (e) {} // #703：权威就绪即收起进度条（覆盖 changed=false 且屏上已有快照内容、不走 renderWindow 的路径）
try { scheduleChatPrewarm(myPrefix); } catch (e) {} // #951e 权威落定：页面还藏着就当场把整窗重建提前做掉，点开聊天不再闪屏
if (typeof v === 'string' && v.length > CHAT_STR_THRESHOLD && idbArr && idbArr.length) {
setTimeout(function () {
try { if (window.activePrefix() === myPrefix && window.idbSet) persistChatHistory(myPrefix, msgs, true); } catch (e) {}
}, 0);
}
scheduleDeferredNormalization();
try { setTimeout(chatColdEnsureHydrated, 2500); } catch (e) {}
try { scheduleMediaPass(12000); } catch (e) {}
}); // FIX 2026-09-17 #127：增量日志读取回调收口
} catch (e) { /* 解析失败：不置 chatDbReady，下次进入再重试 */ }
});
}
} catch (e) {}
} // v3.13.x：时间闸跳过全量重读的关闭括号
if (chatDbReady && msgs.length) scheduleDeferredNormalization();
}
function escTxt(s) {
return String(s == null ? '' : s)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escTxtBr(s) {
return escTxt(s).replace(/ {2,}/g, m => '&nbsp;'.repeat(m.length)).replace(/\n/g, '<br>');
}
window.mochiInlineTextHtml = function (s) {
s = String(s == null ? '' : s);
if (s.indexOf('@@m:') < 0 && !chatHasMediaPayload(s)) return escTxtBr(s);
const _t = s.split(/(@@m:[0-9a-f]{32}|[Dd][Aa][Tt][Aa]:[a-zA-Z0-9.+-]*(?:\/[a-zA-Z0-9.+-]+)?(?:;[^,]*)?,[A-Za-z0-9+/=]*)/g), _tt = [];
for (let _i = 0; _i < _t.length; _i++) {
const _p = _t[_i];
if (/^@@m:[0-9a-f]{32}$/.test(_p)) {
_tt.push('<img class="msg-inline-tok" src="' + _p + '" alt="" loading="lazy" decoding="async">');
} else if (chatIsDataImgSrc(_p)) { _tt.push(escTxtBr('[图片]')); }
else if (chatIsDataAudioSrc(_p)) { _tt.push(escTxtBr('[语音]')); }
else if (chatIsInlineDataSrc(_p)) { _tt.push(escTxtBr('[附件]')); } // 内核给的非图非音载荷（octet-stream 等）
else { _tt.push(escTxtBr(_p)); }
}
return _tt.join('');
};
function askCardReplyClean(s) {
let t = String(s == null ? '' : s);
if (!t) return t;
const bare = t.trim();
if (chatIsImageUrlCard(bare)) return '[图片]';
if (/^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,/i.test(bare)) return '[图片]';
const bar = t.indexOf('|||');
if (bar >= 0) t = t.slice(0, bar).replace(/\.[^.]+$/, '').trim() || '[语音]';
if (t.indexOf('@@m:') >= 0) t = t.replace(/@@m:[0-9a-f]{32}/g, '[图片]');
return t;
}
window.askCardReplyClean = askCardReplyClean; // ta-ask.js 好奇结果弹窗复用
function pokeIconHtml(text) {
const s = String(text == null ? '' : text);
const prefix = '<svg class="st-ico"';
if (s.indexOf(prefix) === 0) {
const end = s.indexOf('</svg>');
if (end >= 0) return s.slice(0, end + 6) + escTxt(askCardReplyClean(s.slice(end + 6)));
}
return escTxt(askCardReplyClean(s)); // #648g 存量拍一拍/回应里的媒体卡清洗后再铺（令牌→[图片]）
}
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
if (!dk) return fb;
try { v = store.get(dk); } catch (e) {}
return v || fb;
}
function chatPartnerName() {
const v = chatLabel('cs-lbl-partner', null, '');
if (v) return v;
const cn = window.contactNameFor ? window.contactNameFor(window.__activeCid || 'default') : '';
return cn || (window.taWord ? window.taWord() : 'TA');
}
window.chatPartnerName = chatPartnerName;
function chatUserName() { return chatLabel('cs-lbl-user', null, '我'); }
const SYS_NICK_SLOTS = {
ta: { cur: chatPartnerName, token: '{ta}', histKey: 'sysmsg-nick-hist', sweptKey: 'sysmsg-nick-swept', legacy: 'TA' },
me: { cur: chatUserName, token: '{me}', histKey: 'sysmsg-user-nick-hist', sweptKey: 'sysmsg-user-nick-swept' }
};
function sysNickSlot(slot) { return SYS_NICK_SLOTS[slot === 'me' ? 'me' : 'ta']; }
function sysNickSweepSkip(oldName, token) {
if (!oldName) return true;
return token === '{me}' && (oldName === '我' || oldName === '你');
}
function sysNickHistGet(st, slot) {
const k = sysNickSlot(slot).histKey;
try {
const v = JSON.parse(st.get(k) || '[]');
if (Array.isArray(v)) return v.filter(x => typeof x === 'string' && x);
} catch (e) {}
return [];
}
function sysNickSweepText(s, oldName, token) {
const ph = token || '{ta}';
const segs = String(s).split(/(<svg[\s\S]*?<\/svg>)/);
for (let i = 0; i < segs.length; i += 2) {
const parts = segs[i].split(/(data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/);
for (let j = 0; j < parts.length; j += 2) {
if (parts[j].indexOf(oldName) >= 0) parts[j] = parts[j].split(oldName).join(ph);
}
segs[i] = parts.join('');
}
return segs.join('');
}
function sysNickSweepable(r) {
if (!r || typeof r.text !== 'string' || !r.text) return false;
if (r.nickKeep) return false;
if (r.mailNotice) return true;
return r.special === 'poke' || r.special === 'ask-msg' || r.special === 'call' ||
r.special === 'call-reply' || r.special === 'invite-reply' || r.special === 'pong' ||
r.special === 'brick' || r.special === 'memory';
}
function sysNickSweepMsgs(arr, oldName, slot) {
const token = sysNickSlot(slot).token;
if (sysNickSweepSkip(oldName, token)) return false;
let changed = false;
for (let i = 0; i < arr.length; i++) {
const r = arr[i];
if (!sysNickSweepable(r) || r.text.indexOf(oldName) < 0) continue;
const t = sysNickSweepText(r.text, oldName, token);
if (t !== r.text) { r.text = t; changed = true; }
}
return changed;
}
function chatTailSweepNick(oldName, slot) {
try {
const token = sysNickSlot(slot).token;
if (typeof oldName !== 'string' || sysNickSweepSkip(oldName, token)) return false;
const arr = chatTailRead();
if (!arr.length) return false;
let changed = false;
for (let i = 0; i < arr.length; i++) {
const j = arr[i];
if (!sysNickSweepable(j) || j.text.indexOf(oldName) < 0) continue;
const t = sysNickSweepText(j.text, oldName, token);
if (t !== j.text) { j.text = t; changed = true; }
}
if (changed) store.set('chat-tail', JSON.stringify(arr));
return changed;
} catch (e) { return false; }
}
function sysNickCatchup() {
let changed = false;
['ta', 'me'].forEach(function (slotKey) {
const S = sysNickSlot(slotKey);
const cur = S.cur();
const hist = sysNickHistGet(store, slotKey);
if (!hist.length) {
try { store.set(S.histKey, JSON.stringify([cur])); store.set(S.sweptKey, '1'); } catch (e) {}
return;
}
if (hist[hist.length - 1] !== cur) {
if (sysNickSweepMsgs(msgs, hist[hist.length - 1], slotKey)) changed = true;
try { chatTailSweepNick(hist[hist.length - 1], slotKey); } catch (e) {} // FIX 2026-09-16 #626 尾巴日志同步清扫
hist.push(cur);
try { store.set(S.histKey, JSON.stringify(hist)); } catch (e) {}
}
let swept = 0;
try { swept = parseInt(store.get(S.sweptKey), 10) || 0; } catch (e) {}
if (swept < hist.length) {
for (let i = swept; i < hist.length; i++) {
if (hist[i] && hist[i] !== cur) {
if (sysNickSweepMsgs(msgs, hist[i], slotKey)) changed = true;
try { chatTailSweepNick(hist[i], slotKey); } catch (e) {} // FIX 2026-09-16 #626 尾巴日志同步清扫
}
}
try { store.set(S.sweptKey, String(hist.length)); } catch (e) {}
}
});
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
if (el.__avApplied === (data || '')) return;
el.__avApplied = data || '';
if (data) {
const cur = el.querySelector('img');
if (cur) { cur.src = data; cur.alt = ''; }
else {
const img = document.createElement('img');
img.src = data;
img.alt = '';
el.innerHTML = '';
el.appendChild(img);
}
} else {
el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#999999" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>';
}
}
window.fillAvatar = fillAvatar;
function refreshChatAvatars() {
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
chatHotCacheDropAll(); // #954：备份恢复整库重写＝热片缓存全作废（随后 forceIdb 直读重建）
chatPrefetchIfLight(function () { loadMsgs(true); });
if (chatVisible() && chatNearBottom() && body && msgs.length) {
if (!inplacePatchIfSameWindow()) {
renderWindow(false, true);
scrollChatBottom();
}
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
pname.textContent = chatPartnerName();
}
updateChatPartnerName();
window.renderChatHeader = updateChatPartnerName;
try {
document.addEventListener('mochi-wrj-heal', function () { try { updateChatPartnerName(); } catch (e) {} });
document.addEventListener('contact-renamed', function () { try { updateChatPartnerName(); } catch (e) {} });
} catch (e) {}
const typingEl = document.getElementById('chat-typing');
let typingOn = false;
function chatVisible() {
const p = document.getElementById('page-chat');
return !!(p && !p.hidden);
}
let chatRebuilding = false; // #841：分帧整窗重建的「列表已清空、新内容未换装」空窗期——该窗口必须显示进度条，否则用户看到的是闪白/闪旧记录＝当成 bug
let chatSettleHoldUntil = 0;
let chatSettleHoldT = null;
let chatSettleHardUntil = 0;
function chatMediaPendingCount() {
try {
const list = body.querySelectorAll('img.msg-img');
if (!list.length) return 0;
const br = body.getBoundingClientRect();
const top = br.top - 40, bot = br.bottom + 40;
let pending = 0;
for (let i = 0; i < list.length; i++) {
const im = list[i];
if (im.complete && im.naturalWidth) continue;
const r = im.getBoundingClientRect();
if (r.bottom < top || r.top > bot) continue; // 视口外（懒加载未触发）不计
pending++;
}
return pending;
} catch (e) { return 0; }
}
function chatSettleHoldOn() { return chatSettleHoldUntil > 0; }
function chatSettleHoldDefer() {
chatSettleHoldUntil = Math.min(chatSettleHoldUntil + 400, chatSettleHardUntil);
if (!chatSettleHoldT) chatSettleHoldT = setTimeout(chatSettleHoldPoll, 120);
}
function chatSettleHoldPoll() {
chatSettleHoldT = null;
if (!chatSettleHoldOn()) return;
if (!chatVisible()) {
chatSettleHoldUntil = 0;
try { updateChatLoading(); } catch (e) {}
return;
}
if (batchRendering) { chatSettleHoldDefer(); return; }
if (chatMediaPendingCount() === 0 || performance.now() > chatSettleHoldUntil) {
chatSettleHoldUntil = 0;
try { updateChatLoading(); } catch (e) {}
return;
}
chatSettleHoldT = setTimeout(chatSettleHoldPoll, 120);
}
function chatSettleHoldArm() {
chatSettleHoldUntil = performance.now() + 1200;
chatSettleHardUntil = chatSettleHoldUntil + 6000;
}
function chatSettleHoldSettle() {
if (!chatSettleHoldOn()) return;
if (!chatVisible()) {
chatSettleHoldUntil = 0;
try { updateChatLoading(); } catch (e) {}
return;
}
if (batchRendering) { chatSettleHoldDefer(); return; } // 换装未落定：等 finishSwap 再判
if (chatMediaPendingCount() === 0) {
chatSettleHoldUntil = 0;
try { updateChatLoading(); } catch (e) {}
return;
}
if (!chatSettleHoldT) chatSettleHoldT = setTimeout(chatSettleHoldPoll, 120);
}
function updateChatLoading() {
if (!chatLoadingEl) return;
chatLoadingEl.hidden = !(chatVisible() && (!chatDbReady || chatRebuilding || chatAuthPending || chatSettleHoldOn()) && !chatKnownEmpty); // #703：去掉「msgs 为空」前置 · #841：重建空窗期同样显示 · #967：权威未达同样显示（保险丝置真不代表数据到了，空屏必须一直有提示）· #1010：收尾媒体解码未落地同样显示（否则「弹窗先消失、记录再闪一下」）
}
let chatPinnedBottom = true;
function chatScrollMax() {
const cb = document.getElementById('chat-body');
if (!cb) return 0;
const t = typingEl;
const typingH = (t && !t.hidden && t.offsetHeight) ? t.offsetHeight : 0;
return Math.max(0, cb.scrollHeight - (cb.clientHeight + typingH));
}
function scrollChatBottom() {
const cb = document.getElementById('chat-body');
if (cb) { if (_ccSmoothT) { cancelAnimationFrame(_ccSmoothT); _ccSmoothT = null; } chatPinnedBottom = true; cb.classList.remove('scroll-anchor-auto'); cb.scrollTop = chatScrollMax(); }
}
let _ccSmoothT = null;
function scrollChatBottomSmooth() {
const cb = document.getElementById('chat-body');
if (!cb) return;
chatPinnedBottom = true;
cb.classList.remove('scroll-anchor-auto');
const target = chatScrollMax(); // FIX 2026-09-15 #516 同 chatScrollMax：打字行显示期写入不得越过「行隐藏态最大值」（否则行一隐藏必被钳回＝下弹一行高）
const start = cb.scrollTop;
if (target <= start) { cb.scrollTop = target; return; }
const dur = Math.min(360, 180 + (target - start) * 0.35);
const t0 = performance.now();
if (_ccSmoothT) { cancelAnimationFrame(_ccSmoothT); _ccSmoothT = null; }
const step = (now) => {
const p = Math.min(1, (now - t0) / dur);
const e = 1 - Math.pow(1 - p, 3);
cb.scrollTop = start + (target - start) * e;
if (p < 1) { _ccSmoothT = requestAnimationFrame(step); }
else { _ccSmoothT = null; cb.scrollTop = target; }
};
_ccSmoothT = requestAnimationFrame(step);
}
function unpinChatAndAnchor() {
chatPinnedBottom = false;
if (_ccSmoothT) { cancelAnimationFrame(_ccSmoothT); _ccSmoothT = null; } body.classList.add('scroll-anchor-auto');
}
function chatNearBottom() {
const cb = document.getElementById('chat-body');
if (!cb) return true;
return cb.scrollHeight - cb.scrollTop - cb.clientHeight < 120;
}
function chatAtBottom() {
const cb = document.getElementById('chat-body');
if (!cb) return true;
return chatScrollMax() - cb.scrollTop <= 8;
}
let chatUserFollowScroll = false;
function maybeScrollChatBottom(side) {
if (batchRendering) {
if (side === 'out') pendingOutScroll = true;
return; // #492 follow 标记批量渲染期不消费，留待真实追加时生效
}
if (!chatVisible()) return;
const out = side === 'out';
const userFollow = !out && chatUserFollowScroll; // FIX #492 一次性消费
if (userFollow) chatUserFollowScroll = false;
if (!out && !userFollow && !chatPinnedBottom && !chatAtBottom()) return;
if (out || userFollow) {
scrollChatBottom();
requestAnimationFrame(scrollChatBottom);
setTimeout(scrollChatBottom, 120);
} else {
scrollChatBottom(); // FIX 2026-09-15 #516 插入帧内同步贴底：新气泡落地即在底部（旧实现先在视口下方渲染再平滑滑上来＝用户报的「消息飞出来」）
requestAnimationFrame(() => { if (chatPinnedBottom) scrollChatBottomSmooth(); });
setTimeout(() => { if (chatVisible() && chatPinnedBottom) scrollChatBottomSmooth(); }, 150);
}
}
function showTyping() {
if (!typingEl) return;
typingOn = true;
if (chatVisible()) {
typingEl.hidden = false; // FIX 2026-09-15 #514 只切可见性、不写 scrollTop（#334 守钉加强版：连钉住态也不抢滚动权）
}
}
function hideTyping() {
if (!typingEl) return;
typingOn = false;
typingEl.hidden = true;
if (chatPinnedBottom) scrollChatBottom(); // FIX 2026-09-11 #334 解钉态不抢滚动权；#514 起这次写只作收尾补平（行隐藏态 scrollTop 已在最大值，正常链路里等于无操作）
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
const CHAT_READABLE_RE = /[A-Za-z0-9\u4e00-\u9fff\u3041-\u3096\u30a1-\u30fa]/;
function chatLooksKaomoji(c) {
if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) return true;
return /[｡◕‿・▽´｀￣﹏◠◡≧≦ω＾￢¬^•˙˘๑٩۶ฅヽノ]/.test(c);
}
function chatIsEmojiCard(c) {
if (/[\uD800-\uDBFF]/.test(c)) return true;
if (CHAT_READABLE_RE.test(c)) return false;
if (chatLooksKaomoji(c)) return false; // 非可读但含颜文字特征（含 ✿♥✧ 等符号的颜文字）→ 交颜文字分支
for (const ch of c) {
const cp = ch.codePointAt(0);
if ((cp >= 0x1F000 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF) || (cp >= 0x2B00 && cp <= 0x2BFF)) return true;
}
return false;
}
function chatIsKaomojiCard(c) {
if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) return true;
if (CHAT_READABLE_RE.test(c)) return false;
return /[｡◕‿・▽´｀￣﹏◠◡≧≦ω＾￢¬^•˙˘๑٩۶ฅヽノ]/.test(c);
}
function chatHasReadableTextCard(arr) {
return arr.some(s => typeof s === 'string' && CHAT_READABLE_RE.test(s));
}
function chatIsImageUrlCard(s) {
if (typeof s !== 'string') return false;
return /^https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|bmp|avif|svg)(?:[?#][^\s"'<>]*)?$/i.test(s.trim());
}
const DATA_HEAD_RE = /^data:([a-z0-9.+-]+)\/([a-z0-9.+-]+)[;,]/i;
function chatMediaHead(s) {
if (typeof s !== 'string' || !s) return '';
let t = s;
for (let i = 0; i < t.length; i++) {
const ch = t.charAt(i);
if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r' && ch !== '\f') { t = t.slice(i); break; }
}
return t.length > 64 ? t.slice(0, 64) : t;
}
const DATA_NOMIME_RE = /^data:;base64,/i;
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64HeadBytes(b64, n) {
const out = [];
for (let i = 0; i + 3 < b64.length && out.length < n; i += 4) {
const a = B64_ALPHABET.indexOf(b64.charAt(i)), b = B64_ALPHABET.indexOf(b64.charAt(i + 1));
const c = B64_ALPHABET.indexOf(b64.charAt(i + 2)), d = B64_ALPHABET.indexOf(b64.charAt(i + 3));
if (a < 0 || b < 0 || c < 0 || d < 0) break;
out.push((a << 2) | (b >> 4), ((b & 15) << 4) | (c >> 2), ((c & 3) << 6) | d);
}
return out;
}
function chatB64ImgMime(s) {
const h = chatMediaHead(s);
if (!DATA_NOMIME_RE.test(h)) return '';
const comma = h.indexOf(',');
const b = b64HeadBytes(comma >= 0 ? h.slice(comma + 1) : '', 12);
if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
return '';
}
function chatFixNoMimeImg(s) {
if (typeof s !== 'string') return '';
const mime = chatB64ImgMime(s);
if (!mime) return '';
const i = s.indexOf(',');
return i >= 0 ? ('data:' + mime + ';base64,' + s.slice(i + 1)) : '';
}
function chatIsDataImgSrc(s) {
const h = chatMediaHead(s);
if (h.charCodeAt(0) !== 100 && h.charCodeAt(0) !== 68) return false; // 'd'/'D'
const m = DATA_HEAD_RE.exec(h);
return !!(m && m[1].toLowerCase() === 'image');
}
function chatIsDataAudioSrc(s) {
const h = chatMediaHead(s);
if (h.charCodeAt(0) !== 100 && h.charCodeAt(0) !== 68) return false;
const m = DATA_HEAD_RE.exec(h);
return !!(m && m[1].toLowerCase() === 'audio');
}
function chatIsInlineDataSrc(s) {
const h = chatMediaHead(s);
if (h.charCodeAt(0) !== 100 && h.charCodeAt(0) !== 68) return false;
if (DATA_NOMIME_RE.test(h)) return true; // FIX #948h 无 MIME 载荷（旧的全部前缀判定漏过＝当正文铺 base64）
return /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+[;,]/i.test(h);
}
function chatIsMediaPayload(s) {
return chatIsDataImgSrc(s) || chatIsDataAudioSrc(s) || chatIsInlineDataSrc(s) || chatIsImageUrlCard(s);
}
function chatIsDataImgLikeSrc(s) {
const h = chatMediaHead(s);
if (!h) return false;
const c0 = h.charCodeAt(0);
if (c0 !== 100 && c0 !== 68) return false;
if (DATA_NOMIME_RE.test(h)) return !!chatB64ImgMime(s); // FIX #948h 无 MIME：魔数说了算（认不出＝非图，仍按内联载荷收标注）
const m = DATA_HEAD_RE.exec(h);
if (!m) return false;
const t = m[1].toLowerCase();
return t !== 'audio' && t !== 'video';
}
function chatIsImgSrcLike(s) {
if (typeof s !== 'string' || !s) return false;
if (window.mochiMediaIsToken && window.mochiMediaIsToken(s)) return true;
return chatIsDataImgLikeSrc(s) || chatIsImageUrlCard(s);
}
function chatHasMediaPayload(s) {
if (typeof s !== 'string' || !s) return false;
if (chatIsMediaPayload(s)) return true;
if (s.indexOf('@@m:') >= 0 && /@@m:[0-9a-f]{32}/.test(s)) return true;
if (s.indexOf('|||') >= 0) return true;
if (/\sdata:;base64,/i.test(s.slice(0, 4096))) return true;
return /\sdata:[a-z0-9.+-]+\/[a-z0-9.+-]+[;,]/i.test(s.slice(0, 4096));
}
window.chatIsDataImgSrc = chatIsDataImgSrc; // 群聊等处显式 image/* 判定借用同一口径
window.chatIsImgSrcLike = chatIsImgSrcLike;
window.chatIsDataImgLikeSrc = chatIsDataImgLikeSrc; // media-pool 令牌化闸门同口径
window.chatB64ImgMime = chatB64ImgMime; // FIX #948h media-pool 本地兜底/自愈共用同一魔数判定
window.chatFixNoMimeImg = chatFixNoMimeImg; // FIX #948h 存量无 MIME 图片载荷补正 MIME（渲染前）
window.chatIsDataAudioSrc = chatIsDataAudioSrc;
window.chatIsInlineDataSrc = chatIsInlineDataSrc;
window.chatIsMediaPayload = chatIsMediaPayload;
window.chatHasMediaPayload = chatHasMediaPayload;
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
if (typeof c === 'string' && chatHasMediaPayload(c)) return;
if (chatIsEmojiCard(c)) emoji.push(c);
else if (chatIsKaomojiCard(c)) kaomoji.push(c);
else text.push(c);
});
try {
const dcfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
const isOff = window.isDefaultCardOff || null;
const useChat = window.defaultCardUse ? window.defaultCardUse('chat') : true;
const catOn = window.defaultCardCat || (() => true);
const sysLocked = !(window.cardLockOpen && window.cardLockOpen());
if (dcfg.enabled !== false && useChat && !sysLocked) {
if (catOn('main') && !chatHasReadableTextCard(text)) {
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
window.getPool = getPool;
function hasCustomReplyCards() {
try {
const cc = (window.getCustomCards && window.getCustomCards()) || [];
return cc.length > 0;
} catch (e) { return false; }
}
let lastHydFailAt = 0;
const HYDR_FAIL_COOLDOWN = 30000;
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
const cap = capMs || 20000;
try {
if (hasCustomReplyCards()) { lastHydFailAt = 0; _replyWatcherStop(); return Promise.resolve(true); }
if (!window.hydrateReplyScope) return Promise.resolve(false);
if (Date.now() - lastHydFailAt < HYDR_FAIL_COOLDOWN) { _replyWatcherStart(); return Promise.resolve(false); }
return new Promise((res) => {
let settled = false;
const tm = setTimeout(() => { if (!settled) { settled = true; lastHydFailAt = Date.now(); _replyWatcherStart(); res(false); } }, cap);
const finish = (ok) => { if (!settled) { settled = true; clearTimeout(tm); res(ok); } };
window.hydrateReplyScope('own', () => {
if (hasCustomReplyCards()) {
try { if (window.hydrateLibScopes) window.hydrateLibScopes(['public']); } catch (e) {}
_replyWatcherStop();
finish(true);
return;
}
window.hydrateReplyScope('public', () => {
if (!hasCustomReplyCards()) _replyWatcherStart(); // 池仍空 → 后台自愈重试
finish(true);
});
});
});
} catch (e) { return Promise.resolve(false); }
}
window.ensureReplyCardsReady = ensureReplyCardsReady;
window.__replyPoolDiag = function () {
try {
const P = getPool();
const cfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
const customRaw = (window.getCustomCards && window.getCustomCards()) || [];
const rc = (window.replyCfg && window.replyCfg()) || {};
const sample = (a) => a.slice(0, 3).map(s => String(s).replace(/\s+/g, ' ').slice(0, 6)).join('|') || '空';
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
'默认概率chat=' + (cfg.overallFor ? cfg.overallFor('chat') : cfg.overall),
'主卡占比=' + (cfg.probs ? cfg.probs.main : '?'),
'总档=' + (window.dcpAll ? window.dcpAll() : '?'),
'自定义占比=' + (rc['csp-cust'] !== undefined ? rc['csp-cust'] : '?'),
'媒体概率=' + ['sticker', 'emoji', 'image', 'voice', 'kaomoji'].map(k => k + ':' + (rc[k + '-prob'] !== undefined ? rc[k + '-prob'] : '?')).join(','),
'多字卡py=' + (rc['py-en'] === 1 ? (rc['py-prob'] + '%') : '关'),
'回复时间=' + (rc['rs-min'] !== undefined ? rc['rs-min'] : 1) + '~' + (rc['rs-max'] !== undefined ? rc['rs-max'] : 40) + 's',
'回复实测=' + (window.__replyLatLog && window.__replyLatLog.length ? window.__replyLatLog.map(m => (m / 1000).toFixed(1) + 's').join('|') : '无记录'),
'无回应概率rn=' + (rc['rn-prob'] !== undefined ? rc['rn-prob'] + '%' : '?'),
'text样本=' + sample(P.text),
'kaomoji样本=' + sample(P.kaomoji),
'emoji样本=' + sample(P.emoji)
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
if (chatVoiceAudio) {
try { chatVoiceAudio.pause(); } catch (e) {}
try { if (chatVoiceAudio.parentNode) chatVoiceAudio.parentNode.removeChild(chatVoiceAudio); } catch (e) {}
chatVoiceAudio = null;
}
if (chatVoiceBtn) { chatVoiceBtn.classList.remove('playing'); chatVoiceBtn = null; }
}
function playVoiceInChat(btn, src) {
if (!src) { toast('语音数据缺失'); return; }
if (chatVoiceBtn === btn) { stopChatVoice(); return; }
stopChatVoice();
const a = new Audio(src);
if (!a.parentNode) { a.style.display = 'none'; document.body.appendChild(a); }
const detachA = () => { try { if (a.parentNode) a.parentNode.removeChild(a); } catch (e) {} };
chatVoiceAudio = a;
chatVoiceBtn = btn;
btn.classList.add('playing');
a.addEventListener('ended', () => { detachA(); stopChatVoice(); });
a.addEventListener('error', () => { detachA(); stopChatVoice(); toast('语音播放失败'); });
a.play().then(() => {}).catch(() => { detachA(); stopChatVoice(); toast('语音播放失败'); });
}
function voicePartsOf(text) {
const raw = String(text || '');
if (window.mochiMediaIsToken && window.mochiMediaIsToken(raw)) return { name: '语音消息', src: raw };
if (chatIsDataAudioSrc(raw)) return { name: '语音消息', src: raw };
const p = raw.split('|||');
let name = (p[0] || '语音消息').replace(/\.[^.]+$/, '');
if (window.mochiMediaIsToken && window.mochiMediaIsToken(name)) name = '语音消息';
return { name: name, src: p[1] || '' };
}
function fillVoiceBubble(b, text, prefixHtml) {
const v = voicePartsOf(text);
b.innerHTML = (prefixHtml || '') + '<div class="msg-voice" data-src="' + attrEsc(v.src) + '">' +
'<button class="msg-voice-play" title="播放">' +
'<svg class="voice-ico-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
'<svg class="voice-ico-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' +
'</button>' +
'<div class="msg-voice-wave"><i></i><i></i><i></i><i></i><i></i></div>' +
'<span class="msg-voice-name">' + escTxt(v.name) + '</span>' +
'</div>';
const btn = b.querySelector('.msg-voice-play');
if (btn) {
let vTapGuard = 0;
const vPlayAction = function () {
if (!v.src) { toast('语音数据缺失'); return; }
if (window.mochiMediaIsToken && window.mochiMediaIsToken(v.src)) {
if (!window.mochiMediaExpandAsync || btn._vExp) return;
btn._vExp = true;
window.mochiMediaExpandAsync(v.src, function (data) {
btn._vExp = false;
if (data) playVoiceInChat(btn, data); else toast('语音数据缺失');
});
return;
}
playVoiceInChat(btn, v.src);
};
btn.addEventListener('click', function (e) {
e.stopPropagation();
if (Date.now() < vTapGuard) return; // #507 touch 直驱已播，吞补发 click 防双跑
vPlayAction();
});
btn.addEventListener('touchend', function (e) {
const mt = e.changedTouches && e.changedTouches[0];
if (!mt) return;
e.stopPropagation(); // #507 不入 body touchend＝不开消息菜单、不布吞 click 窗口
if (Date.now() < vTapGuard) return;
vTapGuard = Date.now() + 800;
vPlayAction();
});
}
}
const QUOTE_PLACEHOLDER = /^(图片|表情包|\[图片\]|\[表情包\])$/;
function quoteTextSafe(s) {
let str = String(s == null ? '' : s);
if (window.mochiMediaIsToken && window.mochiMediaIsToken(str)) return '';
const bar = str.indexOf('|||');
if (bar >= 0) str = bar > 0 ? '[语音] ' + str.slice(0, bar) : '';
const di = str.indexOf('data:');
if (di > 0 && str.length - di > 120) str = str.slice(0, di).trim();
return str;
}
function quoteDisplayFit(text, side) {
let t = String(text == null ? '' : text);
const __taNm = chatPartnerName();
const __meNm = chatUserName();
const hasPh = t.indexOf('{ta}') >= 0 || t.indexOf('{me}') >= 0;
if (side !== 'out' && window.taFit) {
if (hasPh) t = t.split('{ta}').join('\u0002').split('{me}').join('\u0003');
t = window.taFit(t);
if (hasPh) t = t.split('\u0002').join(__taNm).split('\u0003').join(__meNm);
return t;
}
if (hasPh) t = t.split('{ta}').join(__taNm).split('{me}').join(__meNm);
return t;
}
function quoteHtml(q, side) {
const __fitQ = (side !== 'out') && !!window.taFit;
const FQ = (s) => (__fitQ ? window.taFit(s) : s);
if (q && typeof q === 'object') {
const isQM = (s) => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s)));
const imgs = (q.imgs || []).filter(isQM).slice(0, 3);
const t = quoteTextSafe(q.t);
const tHtml = (t && t.indexOf('data:') !== 0 && !(imgs.length && QUOTE_PLACEHOLDER.test(t))) ? (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(FQ(t)) : escTxtBr(FQ(t))) : ''; // FIX 2026-09-13 #394 引用块内嵌令牌转图
let inner = '';
if (imgs.length) inner += '<span class="msg-quote-imgs">' + imgs.map(s => '<img class="msg-quote-img" src="' + attrEsc(s) + '" alt="图片" loading="lazy" decoding="async">').join('') + '</span>';
if (tHtml) inner += '<span class="msg-quote-text">' + tHtml + '</span>';
return '<div class="msg-quote">' + inner + '</div>';
}
if (typeof q === 'string' && (q.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(q)))) {
return '<div class="msg-quote"><img class="msg-quote-img" src="' + attrEsc(q) + '" alt="图片" loading="lazy" decoding="async"></div>';
}
const qs = quoteTextSafe(q);
return '<div class="msg-quote"><span class="msg-quote-text">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(FQ(qs)) : escTxtBr(FQ(qs))) + '</span></div>'; // FIX 2026-09-13 #394 引用块内嵌令牌转图
}
let inplaceDrafts = {};
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
if (inplaceFocusIdx === idx) {
setTimeout(() => { try { inp.focus(); } catch (e) {} }, 0);
}
}
});
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
let _cr = null;
if (window.taAskChatReplyOn && window.taAskChatReplyOn() && window.genChatStyleReply) _cr = window.genChatStyleReply();
if (_cr && window.chatAskReply) window.chatAskReply(idx, String(o.t || ''), _cr, { raw: true });
else if (window.chatAskReply) window.chatAskReply(idx, String(o.t || ''), o.reply);
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
window.chatAskReply(idx, v, (window.pickAskCardReply ? window.pickAskCardReply(pool) : pool[Math.floor(Math.random() * pool.length)]));
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
if (!rpPatchStatusInPlace(msgs.indexOf(rpRec))) renderWindow(true, true); // FIX 2026-09-07 #230 红包状态流转不整窗重建（闪屏）
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
if (!e.target.closest('.msg-ask-card, .msg-choose-card, .msg-survey-card, .msg-fav-heart, .msg-inplace')) {
body.querySelectorAll('.msg-ask-card.show-fav, .msg-choose-card.show-fav, .msg-survey-card.show-fav').forEach(c => c.classList.remove('show-fav'));
}
const favBtn = e.target.closest('.msg-fav-heart');
if (favBtn) {
e.stopPropagation();
const fItem = favBtn.closest('[data-idx]');
if (fItem && fItem.dataset.idx !== undefined) window.favCardFromMsg(Number(fItem.dataset.idx));
return;
}
const giftClaimBtn = e.target.closest('.msg-gift-claim');
if (giftClaimBtn) {
e.stopPropagation();
const gItem = giftClaimBtn.closest('[data-idx]');
const gIdx = gItem && gItem.dataset.idx !== undefined ? Number(gItem.dataset.idx) : -1;
const gRec = gIdx >= 0 ? msgs[gIdx] : null;
if (!gRec || gRec.special !== 'gift' || !giftIsIncoming(gRec)) return;
giftClaimNow(gIdx);
return;
}
const giftReplyBtn = e.target.closest('.msg-gift-reply');
if (giftReplyBtn) {
e.stopPropagation();
const grItem = giftReplyBtn.closest('[data-idx]');
const grIdx = grItem && grItem.dataset.idx !== undefined ? Number(grItem.dataset.idx) : -1;
const grRec = grIdx >= 0 ? msgs[grIdx] : null;
if (!grRec || grRec.special !== 'gift' || !giftIsIncoming(grRec)) return;
giftReplyNow(grIdx);
return;
}
const wishBuyBtn = e.target.closest('.msg-wish-buy');
if (wishBuyBtn) {
e.stopPropagation();
const wItem = wishBuyBtn.closest('.msg-wish');
const wIdx = wItem && wItem.dataset.idx !== undefined ? Number(wItem.dataset.idx) : -1;
const wRec = wIdx >= 0 ? msgs[wIdx] : null;
if (!wRec || wRec.special !== 'wish' || !window.giftBuyFromWishCard) { toast('这张卡片已经翻篇啦'); return; }
window.giftBuyFromWishCard(wRec, function () {
const acts = wItem.querySelector('.msg-wish-acts');
if (acts) acts.outerHTML = '<div class="msg-wish-done">\u2713 ' + escTxt(window.taFit ? window.taFit('已送出') : '已送出') + '</div>';
});
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
if (!rpPatchStatusInPlace(rpIdx)) renderWindow(true, true); // FIX 2026-09-07 #230 红包状态流转不整窗重建（闪屏）
setTimeout(() => addIn('你领取了红包' + amtTxt, { special: 'poke' }), randInt(400, 1000));
setTimeout(() => rpCollectFeedback('in'), randInt(1100, 2200));
return;
}
if (e.target.closest('.msg-inplace')) return;
const surveyCard = e.target.closest('.msg-survey-card');
if (surveyCard) {
e.stopPropagation(); // 不冒泡触发气泡操作菜单
const sHadFav = surveyCard.classList.contains('show-fav');
body.querySelectorAll('.msg-ask-card.show-fav, .msg-choose-card.show-fav, .msg-survey-card.show-fav').forEach(c => c.classList.remove('show-fav'));
if (!sHadFav) surveyCard.classList.add('show-fav');
const sItem = surveyCard.closest('.msg-survey');
const sIdx = sItem && sItem.dataset.idx !== undefined ? Number(sItem.dataset.idx) : -1;
const sRec = sIdx >= 0 ? msgs[sIdx] : null;
if (window.openSurveyDetail && sRec) window.openSurveyDetail(sRec);
else if (window.openAskSurvey) window.openAskSurvey();
return;
}
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
function retractSafeHtml(rec) {
const raw = String(rec && rec.text != null ? rec.text : '');
const parts = (rec && Array.isArray(rec.parts)) ? rec.parts : null;
const isImgSrc = (s) => typeof s === 'string' && !!s && chatIsImgSrcLike(s); // FIX 2026-09-20 #948 同口径收口（旧判据漏大写 MIME/前导空白/裸令牌）
let text = raw;
const imgs = [];
if (parts && parts.length) {
text = parts.filter(p => p && p.k === 'text').map(p => p.v).join(' ');
parts.forEach(p => { if (p && p.k === 'img' && p.v) imgs.push(p.v); });
}
const textIsImg = isImgSrc(text);
if (!imgs.length && textIsImg) imgs.push(text);
const isVoice = (rec && rec.type === 'voice') || raw.indexOf('|||') >= 0;
let html = '';
if (imgs.length) html += imgs.slice(0, 3).map(s => '<img class="msg-img msg-img-sm" src="' + attrEsc(s) + '" alt="撤回的图片">').join('');
if (isVoice) html += '<span style="opacity:.85">[语音] ' + escTxt(raw.split('|||')[0] || '') + '</span>';
else if (!textIsImg && text.trim()) html += '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(quoteDisplayFit(text, rec.side)) : escTxtBr(quoteDisplayFit(text, rec.side))) + '</span>'; // FIX 2026-09-17 #648 撤回无快照兜底同走内嵌令牌助手（混排令牌不再直出，与 #385 撤回段同口径）
const moods = (rec && Array.isArray(rec.mood)) ? rec.mood : [];
const liveMoods = moods.filter((md, mi) => md && String(md.tag || '').trim() && !(rec.retractedMood && rec.retractedMood.indexOf(mi) >= 0));
if (liveMoods.length) {
html += '<div class="msg-moods">' + liveMoods.map(md => {
const tg = escTxt(String(md.tag == null ? '' : md.tag));
const lb = md.label == null ? '' : String(md.label);
const dup = lb !== '' && lb === String(rec.text == null ? '' : rec.text);
const cls = (md.tag === '交流意图') ? 'msg-mood msg-intent' : 'msg-mood';
return '<div class="' + cls + '"><span class="msg-mood-tag">' + tg + '</span>' + (dup || lb === '' ? '' : '<span>' + escTxt(quoteDisplayFit(lb, rec.side)) + '</span>') + '</div>';
}).join('') + '</div>';
}
return html || '<span style="opacity:.5;font-size:12px">（这条消息没有可显示的原文）</span>';
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
chatRetractToggleAfter('toggle'); // #871：展开/收起＝滚动区内容高突变，按钉住/解钉两态做贴底或落定重落
};
}
function chatRetractToggleAfter(kind) {
if (batchRendering || !chatVisible()) return;
if (chatPinnedBottom) { scrollChatBottom(); chatRepinAfterSettle(); }
else chatResyncScrollQuiet(kind);
}
let _rsyncT = null;
let _rsyncDeadline = 0;
function chatResyncScrollQuiet(kind) {
if (_rsyncT || chatPinnedBottom) return; // 钉住态归 #861 落定锁管，不双排
_rsyncDeadline = Date.now() + 1200;
_rsyncT = setTimeout(chatResyncStep, 120);
}
function chatResyncStep() {
_rsyncT = null;
const now = Date.now();
if (!chatVisible() || chatPinnedBottom) return; // 等待期用户已回钉＝归 #861 管
if (!chatRepinQuietEnough(now)) { if (now < _rsyncDeadline) _rsyncT = setTimeout(chatResyncStep, 120); return; }
const cb = document.getElementById('chat-body');
if (!cb) return;
const realMax = cb.scrollHeight - cb.clientHeight;
cb.scrollTop = Math.min(cb.scrollTop, realMax); // 超界显式钳回；未超界＝同值重落（滚动树重对齐）
}
let batchRendering = false;
let pendingOutScroll = false;
let appendTarget = null;
let batchDefer = null;
function appendMsg(m) {
if (!batchRendering) m.classList.add('msg-enter');
if (batchDefer) {
const ix = Number(m.dataset.idx);
if (Number.isFinite(ix) && ix >= batchDefer.len) { batchDefer.q.push(m); return; }
}
(appendTarget || body).appendChild(m);
}
function appendAvatarBatch(on) {
if (on) avatarBatchCache = {};
else avatarBatchCache = null;
}
const RENDER_MAX = 200;   // 渲染窗口条数上限
const WINDOW_MAX = 400;   // v3.10.x：增量渲染窗口硬上限（含上下缓冲，防 DOM 无限膨胀）
const LOAD_STEP = 100;    // 向上滚动每次加载的条数
const TOP_THRESHOLD = 150;// scrollTop 小于此值触发向上加载（px）
const JUMP_VIEW = 30;     // 搜索跳转时目标索引上方预留的余量
let renderStart = 0;      // 渲染窗口起点（msgs 下标）；0 = 全量
let renderEnd = 0;        // v3.10.x：渲染窗口终点（msgs 下标，开区间）；增量裁剪/恢复用
let windowRenderedN = 0;
let windowRenderedPrefix = null;
let windowStale = false;
let windowRenderedNicks = '';
function chatNickSig() {
try { return chatPartnerName() + '\u0001' + chatUserName(); } catch (e) { return ''; }
}
let normChangedIdxs = null;
let normChangedRecs = [];
let normRemovedRecs = [];
let normOrigIdx = null;
let normSnapTail = null;
let windowRenderedLite = null;
let windowKeyLo = -1;
let windowKeyHi = -1;
let windowKeyLoVal = '';
let windowKeyHiVal = '';
function chatWinKey(m) {
if (!m || typeof m !== 'object') return '#';
const t = (typeof m.text === 'string') ? m.text : '';
const mediaish = !!(m.img || m.voice || m.type === 'image' || m.type === 'sticker' || m.type === 'voice' || m.special || m._lsLite || t === '' || t === '[内容已省略]');
return (m.ts || 0) + '|' + (m.side || '') + '|' + (m.type || '') + '|' + (m.special || '') + '|' + (mediaish ? 'M' : t.length + ':' + t.slice(0, 24));
}
function chatWinKeysSync() {
try {
windowKeyLo = renderStart;
windowKeyHi = renderEnd - 1;
windowKeyLoVal = (renderStart >= 0 && renderStart < msgs.length) ? chatWinKey(msgs[renderStart]) : '';
windowKeyHiVal = (windowKeyHi >= 0 && windowKeyHi < msgs.length) ? chatWinKey(msgs[windowKeyHi]) : '';
} catch (e) { windowKeyLo = -1; windowKeyHi = -1; windowKeyLoVal = ''; windowKeyHiVal = ''; }
}
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
if (batchDefer && idx >= batchDefer.len) { batchDefer.q.push(d); return; }
(appendTarget || body).appendChild(d);
}
let suppressScrollUntil = 0; // 程序化滚动后短暂忽略 scroll 事件（防渲染本身触发向上加载）
const RENDER_CHUNK = 50;
const RENDER_CHUNK_MIN = 80;
let _rwToken = 0;
function renderWindow(keepScroll, clampTop, forceSync) {
try { if (!keepScroll && window.__mochiPhase) window.__mochiPhase('chat-renderWindow'); } catch (e0) {}const len = msgs.length;
chatRebuilding = false; // #841e：新一轮渲染先复位空窗标志（被作废的旧分帧轮不得把进度条留在屏上）
const prevTop = keepScroll ? body.scrollTop : 0;
const prevHeight = keepScroll ? body.scrollHeight : 0;
if (clampTop || renderStart >= len) renderStart = Math.max(0, len - RENDER_MAX);
const start = Math.min(renderStart, len);
renderEnd = len; // 整窗重建渲染到最新，窗口终点复位（裁剪状态随之清空）
windowRenderedN = len;
windowRenderedPrefix = window.activePrefix();
windowRenderedNicks = chatNickSig(); // #775b：整窗渲染＝屏上昵称已刷新，登记当时的昵称签名
windowStale = false;
chatWinKeysSync(); // #1010：登记屏上窗口首/尾记录身份（收尾据此判前缀 / 尾部切片）
collectInplaceDrafts();
windowRenderedLite = null;
const _liteIdx = [];
body.innerHTML = '';
batchRendering = true;
const frag = document.createDocumentFragment();
appendTarget = frag;
appendAvatarBatch(true);
const myAvBatch = avatarBatchCache; // #972：本轮自己的缓存对象身份——作废时只释放「还属于本轮」那份，绝不误清新一轮的
const myDefer = batchDefer = { len: len, q: [] }; // #1004：本轮开轮时的条数快照（迟到节点判据）＋暂存队列
const skippedIdx = []; // #1004：本轮因「记录位不是对象」被 #919a 保护性跳过的下标（屏上少画一条，必须留痕）
let i = start;
const myToken = ++_rwToken;
const finishSwap = function () {
if (myToken !== _rwToken) { if (avatarBatchCache === myAvBatch) appendAvatarBatch(false); if (batchDefer === myDefer) batchDefer = null; return; }
if (_liteIdx.length) windowRenderedLite = _liteIdx;
appendAvatarBatch(false);
appendTarget = null;
batchRendering = false;
body.appendChild(frag);
if (myDefer.q.length) {
for (let q = 0; q < myDefer.q.length; q++) body.appendChild(myDefer.q[q]);
windowRenderedN = msgs.length;
renderEnd = msgs.length;
}
batchDefer = null;
if (skippedIdx.length) { windowStale = true; armWindowHoleHeal(skippedIdx); }
if (keepScroll && prevHeight > 0) {
body.scrollTop = prevTop + (body.scrollHeight - prevHeight);
}
if (pendingOutScroll) {
pendingOutScroll = false;
scrollChatBottom();
} else if (!keepScroll && chatPinnedBottom) {
scrollChatBottom(); // #718 分帧路径：调用方紧跟的 scrollToBottom 跑在换装前（空 body＝空操作），这里补真正的贴底
}
suppressScrollUntil = Date.now() + 200; // 本轮渲染/滚动结束后 200ms 内不响应 scroll
restoreInplaceDrafts();
chatRebuilding = false; // #841a：新内容已换装落定，交回常规判定
updateChatLoading(); // 渲染完成（有内容或就绪）→ 隐藏加载进度条
try { chatSettleHoldSettle(); } catch (e) {} // #1010：分帧换装落定后再判「视口媒体解码是否落地」——在飞期间上面那次 updateChatLoading 只靠 chatRebuilding 顶着，落定这一帧必须重判，否则进度条先撤、图再落地＝原症状
if (chatPinnedBottom) chatEntrySettle(); // #841b：重建换装＝一次「进页」，重开 1.2s 同帧贴底窗，视口内图片迟到解码当帧收口，不等 250ms 看门狗拽把
};
const buildChunk = function () {
if (myToken !== _rwToken) { try { restoreInplaceDrafts(); } catch (e) {} if (avatarBatchCache === myAvBatch) appendAvatarBatch(false); if (batchDefer === myDefer) batchDefer = null; return; } // #718 作废：草稿回填旧 DOM（新轮 collect 会再收），不丢草稿；#972/#1004：作废轮释放自己那轮的批量头像缓存与迟到队列
const end = Math.min(i + RENDER_CHUNK, len);
for (; i < end; i++) {
const _rm = msgs[i];
if (!_rm || typeof _rm !== 'object') { skippedIdx.push(i); continue; } // #919a 记录位空洞/坏记录跳过不画：renderMsg(undefined) 抛 TypeError 打断整轮分帧构建（setTimeout 链断＝不换装不贴底、batchRendering 卡死，屏上停在窗口最旧的几十条、退出重进才恢复；用户设备 buildChunk→renderMsg「reading 'side'」实锤）
maybeInsertDivider(i);
if (_rm && (_rm._lsLite || _rm.img === '' || _rm.voice === '' ||
(Array.isArray(_rm.parts) && _rm.parts.some(p => p && typeof p.v === 'string' && p.v === '')))) {
_liteIdx.push(i);
}
const m = renderMsg(_rm);
m.dataset.idx = i; // 覆盖 renderMsg 内的 msgs.length-1（批量渲染时必须为真实下标）
}
if (i < len) { setTimeout(buildChunk, 0); return; }
finishSwap();
};
if (!keepScroll && !forceSync && (len - start) >= RENDER_CHUNK_MIN && window.requestAnimationFrame) {
chatRebuilding = true; // #841f：分帧构建期列表是空的，进度条顶上（updateChatLoading 读该标志）
updateChatLoading(); // #841g：置位后立即置屏，不留一帧「闪白无提示」
setTimeout(buildChunk, 0); // #718 分帧构建
return;
}
for (; i < len; i++) {
const _rm = msgs[i];
if (!_rm || typeof _rm !== 'object') { skippedIdx.push(i); continue; } // #919b 同 #919a：同步整窗路径也不得被单条空记录打断（异常一路上抛，调用方紧随的贴底/收尾整段跳过）
maybeInsertDivider(i);
if (_rm && (_rm._lsLite || _rm.img === '' || _rm.voice === '' ||
(Array.isArray(_rm.parts) && _rm.parts.some(p => p && typeof p.v === 'string' && p.v === '')))) {
_liteIdx.push(i);
}
const m = renderMsg(_rm);
m.dataset.idx = i; // 覆盖 renderMsg 内的 msgs.length-1（批量渲染时必须为真实下标）
}
finishSwap();
}
let chatPrewarmTimer = null;
function scheduleChatPrewarm(prefix) {
if (chatPrewarmTimer) { clearTimeout(chatPrewarmTimer); chatPrewarmTimer = null; }
if (!prefix) return;
chatPrewarmTimer = setTimeout(function () {
chatPrewarmTimer = null;
try {
if (document.hidden || chatVisible()) return;
if (window.activePrefix() !== prefix) return;
if (!(chatDbReady && authLoadedPrefix === prefix)) return; // #951b 就绪闸只认本命名空间权威（chatDbReady 会被 15 秒保险丝假置位）
if (batchRendering || (windowRenderedPrefix === prefix && !windowStale)) return; // #951c 屏上已是本桌面且未作废＝不重复动手
if (!msgs || !msgs.length) return;
renderWindow(false, true); // #951d 隐藏态整窗预渲落地（enterChat 的同窗补丁据此命中）
} catch (e) {}
}, 600);
}
window.chatReRenderTime = function () {
if (chatPage.hidden || !body.children.length) return;
renderWindow(true, false);
};
function inplacePatchIfSameWindow() {
const len = msgs.length;
if (!len) return false;
if (batchRendering) return false; // #951h 分帧构建在飞＝屏上是空/半截列表，「同窗同貌」不成立（#951 隐藏态预渲让这条通道变成常遇：点的那一刻构建还没跑完，若判成已画好会就地收掉进度条并把在飞的换装链晾在半路＝闪白无提示；返回 false 让调用方走 renderWindow，旧链由 _rwToken 作废）
if (windowStale) return false;
try { if (windowRenderedPrefix !== window.activePrefix()) return false; } catch (e) { return false; }
if (windowRenderedNicks !== chatNickSig()) return false;
const grown = len - windowRenderedN;
if (grown < 0) return false; // 屏上比权威多＝数据被裁/回滚，整窗重建兜底
if (windowRenderedN === 0) return false; // 无屏上凭据（首渲场景）走原整窗渲染
let n = renderStart;
const pending = [];
for (let k = 0; k < body.children.length; k++) {
const el = body.children[k];
if (!el.dataset || el.dataset.idx === undefined) continue;
if (Number(el.dataset.idx) !== n) return false;
if (el.dataset.pendingRead === '1') pending.push(el);
n++;
}
if (n !== windowRenderedN) return false;
let winShift = 0;
{
const headIdx = renderStart;
const cnt = windowRenderedN - renderStart;
const tailIdx = len - cnt;
const prefixShape = (windowKeyLoVal !== '' && headIdx >= 0 && headIdx < len && chatWinKey(msgs[headIdx]) === windowKeyLoVal);
const tailShape = !prefixShape && cnt > 0 && tailIdx >= 0 && windowKeyHiVal !== '' &&
chatWinKey(msgs[tailIdx]) === windowKeyLoVal && chatWinKey(msgs[len - 1]) === windowKeyHiVal;
if (!prefixShape) {
if (!tailShape) return false; // 说不清＝整窗重建兜底（保守）
if (cnt < Math.min(len, RENDER_MAX)) return false;
winShift = tailIdx - headIdx;
if (winShift !== 0) {
for (let k = 0; k < body.children.length; k++) {
const el = body.children[k];
if (el.dataset && el.dataset.idx !== undefined) el.dataset.idx = String(Number(el.dataset.idx) + winShift);
}
renderStart += winShift;
windowRenderedN = len;
renderEnd = len;
if (Array.isArray(windowRenderedLite)) windowRenderedLite = windowRenderedLite.map(function (i2) { return i2 + winShift; });
chatWinKeysSync();
try { (window.__patch1010Log = window.__patch1010Log || []).push('tail-shift:' + winShift + '/n' + cnt); } catch (e0) {}
}
}
}
const liteUpgrade = (Array.isArray(windowRenderedLite) ? windowRenderedLite : [])
.filter(i => i >= renderStart && i < windowRenderedN);
if (liteUpgrade.length) {
collectInplaceDrafts();
const wasNearBottom = chatNearBottom();
const prevTop = body.scrollTop;
const prevH = body.scrollHeight;
const prevPendingOut = pendingOutScroll;
batchRendering = true;
for (let u = 0; u < liteUpgrade.length; u++) {
const ui = liteUpgrade[u];
const old = body.querySelector('[data-idx="' + ui + '"]');
if (!old) { batchRendering = false; return false; }
let nu = null;
try { nu = renderMsg(msgs[ui]); } catch (e) { nu = null; }
if (!nu || nu.dataset.idx === undefined) { batchRendering = false; return false; }
nu.dataset.idx = ui;
old.parentNode.replaceChild(nu, old);
}
batchRendering = false;
pendingOutScroll = prevPendingOut;
windowRenderedLite = null; // 残留已全部原位补齐
restoreInplaceDrafts();
const dH = body.scrollHeight - prevH;
if (dH) {
if (wasNearBottom) scrollChatBottom(); // 原在底部：升级后保持贴底
else body.scrollTop = prevTop + dH; // 不在底部：按高度差补偿，视口内内容不跳
}
suppressScrollUntil = Date.now() + 200;
if (chatPinnedBottom) chatEntrySettle(); // #841c：lite 占位换成真图后照样有迟到长高，重开同帧贴底窗
}
for (let k = 0; k < pending.length; k++) {
const el = pending[k];
delete el.dataset.pendingRead;
const rec = msgs[Number(el.dataset.idx)];
const b = el.querySelector('.msg-bubble');
if (rec && rec.special === 'read' && b && !rec.retracted &&
b.textContent.indexOf('已读不回') >= 0) {
b.innerHTML = '<span style="opacity:.5;font-size:12px">' + escTxt(rec.text || '已读不回') + '</span>';
}
}
if (grown > 0 && !winShift) {
for (let r = 0; r < Math.ceil(grown / LOAD_STEP) + 1 && renderEnd < len; r++) loadNewerIncremental(len);
if (renderEnd !== len) return false;
windowRenderedN = len; // 凭据随增量补齐——loadNewerIncremental 只更 renderEnd，不补此处则下次收尾 grown 错位仍整窗（自纠）
}
return true;
}
function patchChangedInPlace(changedIdxs, start) {
const __plog = function (tag) { try { (window.__patch402Log = window.__patch402Log || []).push(tag); } catch (e) {} };
if (!Array.isArray(changedIdxs) || !changedIdxs.length) { __plog('noop-empty'); return true; }
let n = start;
let hasPending = false;
for (let k = 0; k < body.children.length; k++) {
const el = body.children[k];
if (!el.dataset || el.dataset.idx === undefined) continue;
if (Number(el.dataset.idx) !== n) { __plog('fail-idx@' + k); return false; }
if (el.dataset.pendingRead === '1') hasPending = true;
n++;
}
if (n !== renderEnd - renderStart) { __plog('fail-range n=' + n + ' re=' + renderEnd + ' rs=' + renderStart); return false; }
if (n > msgs.length) { __plog('fail-len'); return false; }
if (hasPending) { __plog('fail-pending'); return false; }
const idxs = changedIdxs.filter(i => i >= start && i < n && i < msgs.length).sort((a, b) => a - b);
if (!idxs.length) { __plog('noop-outside'); return true; } // 改动都不在屏上窗口＝无需动 DOM
collectInplaceDrafts();
const wasNearBottom = chatNearBottom();
const prevTop = body.scrollTop;
const prevH = body.scrollHeight;
const prevPendingOut = pendingOutScroll;
batchRendering = true;
for (let u = 0; u < idxs.length; u++) {
const ui = idxs[u];
const old = body.querySelector('[data-idx="' + ui + '"]');
if (!old) { batchRendering = false; restoreInplaceDrafts(); __plog('fail-node@' + ui); return false; }
let nu = null;
try { nu = renderMsg(msgs[ui]); } catch (e) { nu = null; }
if (!nu || nu.dataset.idx === undefined) { batchRendering = false; restoreInplaceDrafts(); __plog('fail-render@' + ui); return false; }
nu.dataset.idx = ui;
old.parentNode.replaceChild(nu, old);
if (Array.isArray(windowRenderedLite)) windowRenderedLite = windowRenderedLite.filter(x => x !== ui);
}
__plog('ok:' + idxs.length);
batchRendering = false;
pendingOutScroll = prevPendingOut;
restoreInplaceDrafts();
const dH = body.scrollHeight - prevH;
if (dH) {
if (wasNearBottom) scrollChatBottom(); // 原在底部：升级后保持贴底
else body.scrollTop = prevTop + dH; // 不在底部：按高度差补偿，视口内内容不跳
}
suppressScrollUntil = Date.now() + 200;
if (chatPinnedBottom) chatEntrySettle(); // #841d：归一化原位换节点后同样有迟到长高，重开同帧贴底窗
return true;
}
function patchNormRemovalsInPlace(removedRecs) {
if (!removedRecs || !removedRecs.length) return true; // 无删除＝无需动 DOM
if (!normOrigIdx) return false;
const tailEl = normSnapTail;
if (!tailEl || !body.contains(tailEl)) return false;
const removedIdx = [];
for (let i = 0; i < removedRecs.length; i++) {
const oi = normOrigIdx.get(removedRecs[i]);
if (typeof oi !== 'number') return false; // 身份对不上＝保守整窗兜底
removedIdx.push(oi);
}
removedIdx.sort(function (a, b) { return a - b; });
const shiftsBefore = function (idx) {
let c = 0;
for (let i = 0; i < removedIdx.length && removedIdx[i] < idx; i++) c++;
return c;
};
const rmSet = new Set(removedIdx);
const origNodes = [], appNodes = [];
for (let k = 0; k < body.children.length; k++) {
const el = body.children[k];
if (!el.dataset || el.dataset.idx === undefined) continue;
if (el === tailEl || (el.compareDocumentPosition(tailEl) & Node.DOCUMENT_POSITION_FOLLOWING)) origNodes.push(el); // FOLLOWING＝tailEl 在 el 之后＝el 属界前原始系
else appNodes.push(el);
}
const plan = [];
let expect = renderStart - shiftsBefore(renderStart);
let hasPending = false;
for (let k = 0; k < origNodes.length; k++) {
const el = origNodes[k];
if (el.dataset.pendingRead === '1') hasPending = true;
const oi = Number(el.dataset.idx);
if (rmSet.has(oi)) { plan.push({ el: el, rm: true }); continue; }
const ni = oi - shiftsBefore(oi);
if (ni !== expect) return false;
plan.push({ el: el, rm: false, ni: ni });
expect++;
}
for (let k = 0; k < appNodes.length; k++) {
const v = Number(appNodes[k].dataset.idx);
if (v !== expect) return false; // 追加系下标与回推序衔接不上（追加后又发生过删除位移）＝整窗兜底
plan.push({ el: appNodes[k], rm: false, ni: v });
expect++;
}
if (hasPending || expect !== msgs.length) return false;
collectInplaceDrafts();
const wasNearBottom = chatNearBottom();
const prevTop = body.scrollTop;
const prevH = body.scrollHeight;
const prevPendingOut = pendingOutScroll;
batchRendering = true;
try {
for (let k = 0; k < plan.length; k++) {
const p = plan[k];
if (p.rm) { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); }
else if (p.el.dataset.idx !== String(p.ni)) p.el.dataset.idx = String(p.ni);
}
} catch (e) {
batchRendering = false; pendingOutScroll = prevPendingOut; restoreInplaceDrafts();
return false;
}
batchRendering = false;
pendingOutScroll = prevPendingOut;
try {
const kids = body.children;
for (let k = kids.length - 2; k >= 0; k--) {
if (kids[k].classList && kids[k].classList.contains('msg-time-divider') &&
kids[k + 1].classList && kids[k + 1].classList.contains('msg-time-divider')) {
kids[k].parentNode.removeChild(kids[k]);
}
}
while (body.lastChild && body.lastChild.classList && body.lastChild.classList.contains('msg-time-divider')) {
body.removeChild(body.lastChild);
}
} catch (e) {}
restoreInplaceDrafts();
renderStart -= shiftsBefore(renderStart);
renderEnd = msgs.length;
windowRenderedN = msgs.length; // 凭据同步平移（否则下次同窗补丁 grown 错位又整窗）
if (Array.isArray(windowRenderedLite)) {
windowRenderedLite = windowRenderedLite
.filter(x => !rmSet.has(x))
.map(x => x - shiftsBefore(x));
}
chatWinKeysSync(); // #1010：归一化结构删除后窗口下标平移，身份凭据同步
const dH = body.scrollHeight - prevH;
if (dH) {
if (wasNearBottom) scrollChatBottom(); // 原贴底：删除后保持贴底
else body.scrollTop = prevTop + dH; // 不在底部：按高度差平移，视口内内容不跳
}
suppressScrollUntil = Date.now() + 200;
return true;
}
function loadOlderIncremental() {
if (batchRendering) return; // #874b：构建中途重入会把 appendTarget 改道（自身 frag 在空 body 下整批丢弃）并把 renderStart 白前移＝finishSwap 首批被甩到列表尾＝底部永远是旧记录
const len = msgs.length;
if (renderStart <= 0 || renderStart >= len) {
if (renderStart <= 0 && !chatRebased) {
if (chatColdHead.length) { chatRebaseCold(); loadOlderIncremental(); return; }
if (!chatColdDone) chatColdEnsureHydrated();
}
if (renderStart <= 0 || renderStart >= len) return;
}
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
chatWinKeysSync(); // #1010：上翻增量改了窗口头，身份凭据同步
if (preNum > 0 && anchor) {
const anchorTopBefore = anchor.offsetTop;
body.insertBefore(frag, anchor);
body.scrollTop = beforeTop + (anchor.offsetTop - anchorTopBefore);
} else {
body.scrollTop = body.scrollHeight; // 原窗口为空，直接滚到底
}
if (renderEnd - renderStart > WINDOW_MAX) pruneWindowBottom();
suppressScrollUntil = Date.now() + 200;
}
function loadNewerIncremental(targetLen) {
if (batchRendering) return; // #874c：同 #874b——增量下插/追加在构建期改道 appendTarget 会踩乱换装顺序
const len = msgs.length;
const want = (typeof targetLen === 'number' && targetLen > 0) ? Math.min(targetLen, len) : len;
if (renderEnd >= want) return;
const newEnd = Math.min(want, renderEnd + LOAD_STEP);
if (newEnd === renderEnd) return;
batchRendering = true;
let anchor = null;
const frag = document.createDocumentFragment();
appendTarget = frag;
appendAvatarBatch(true);
const onScreen = new Map(); // #918a：屏上 data-idx 索引（一轮 O(DOM) 建表，替代循环内全表 querySelector）
for (const el of body.querySelectorAll('[data-idx]')) {
const k = parseInt(el.dataset.idx, 10);
if (Number.isFinite(k) && !onScreen.has(k)) onScreen.set(k, el);
}
for (let i = renderEnd; i < newEnd; i++) {
if (onScreen.has(i)) continue; // #766a：守卫口径不变（#918 把「查 DOM」换成「查上面那张表」）
if (!anchor) {
for (let j = i + 1; j < len && !anchor; j++) anchor = onScreen.get(j) || null; // #918b：锚点同批改查表（旧写法每个未命中下标都全表扫一次）
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
function nodeKeepIdx(f) {
if (!f) return undefined;
if (f.dataset && f.dataset.idx !== undefined) return parseInt(f.dataset.idx, 10);
const nx = f.nextElementSibling;
if (nx && nx.dataset && nx.dataset.idx !== undefined) return parseInt(nx.dataset.idx, 10);
return undefined;
}
let _holeHealT = null;
function armWindowHoleHeal(idxs) {
if (_holeHealT) return;
_holeHealT = setTimeout(function () {
_holeHealT = null;
if (batchRendering || !chatVisible()) return;
for (let k = 0; k < idxs.length; k++) { const m = msgs[idxs[k]]; if (!m || typeof m !== 'object') return; }
renderWindow(true, false);
}, 700);
}
function pruneWindowBottom() {
const targetEnd = renderStart + WINDOW_MAX;
if (renderEnd <= targetEnd) return;
while (body.lastChild) {
const last = body.lastChild;
const idx = nodeKeepIdx(last); // #972：分隔线按其后那条消息的归属下标判
if (idx !== undefined && idx < targetEnd) break; // 已到应保留区
body.removeChild(last);
}
renderEnd = targetEnd;
chatWinKeysSync(); // #1010：窗口尾变了，身份凭据同步
}
function pruneWindowTop() {
const targetStart = renderEnd - WINDOW_MAX;
if (renderStart >= targetStart) return;
while (body.firstChild) {
const f = body.firstChild;
const idx = nodeKeepIdx(f); // #972：同上
if (idx !== undefined && idx >= targetStart) break; // 已到应保留区
body.removeChild(f);
}
renderStart = targetStart;
chatWinKeysSync(); // #1010：窗口头变了，身份凭据同步
}
function trimWindowTopQuiet(maxN) {
const targetStart = Math.max(0, renderEnd - maxN);
if (renderStart >= targetStart) return;
const h0 = body.scrollHeight;
while (body.firstChild) {
const f = body.firstChild;
const idx = nodeKeepIdx(f); // #972：分隔线按其后那条消息的归属下标判（别削掉被保留消息头上的那枚）
if (idx !== undefined && idx >= targetStart) break; // 已到应保留区
body.removeChild(f);
}
renderStart = targetStart;
chatWinKeysSync(); // #1010：窗口头变了，身份凭据同步
const cut = h0 - body.scrollHeight;
if (cut > 0) body.scrollTop = Math.max(0, body.scrollTop - cut);
suppressScrollUntil = Date.now() + 200; // 本次程序化 scrollTop 写入不算用户滚动（否则补偿位会误触发上翻加载）
}
let bodyScrollTimer = null;
let _chatScrollActTs = 0; // #765：列表最近一次滚动时刻（手指拖动/抬手后的惯性滑行/滚轮都算），看门狗据此让路
body.addEventListener('scroll', function () {
_chatScrollActTs = Date.now(); // #765：写在抑制判定之前——程序写入与用户滑动同样需要让路
if (Date.now() < suppressScrollUntil) return;
if (bodyScrollTimer) return;
bodyScrollTimer = setTimeout(function () {
bodyScrollTimer = null;
if (!chatVisible()) return;
if (batchRendering) return; // #874a：分帧整窗重建的空窗期（body 已清空、新窗未换装）里到达的 scroll 不作数——清空旧滚动位被钳回 0 必发事件，防抖 100ms 撞上慢设备构建时长就误触发上翻加载
if (body.scrollTop < TOP_THRESHOLD) {
loadOlderIncremental();
} else if (renderEnd < msgs.length && body.scrollHeight - body.scrollTop - body.clientHeight < TOP_THRESHOLD) {
loadNewerIncremental();
}
else if (!chatPinnedBottom && !chatTouchActive && chatAtBottom()) { // #716：手势进行中不回钉（防刚离底 ≤8px 被误判「滚回贴底」拽回）
chatPinnedBottom = true; body.classList.remove('scroll-anchor-auto'); chatScrollRealignQuiet();
}
}, 100);
}, { passive: true });
let chatUnpinTsY = 0;
let chatTouchActive = false; // #716：触摸手势进行中——手势刚开始、离底还 ≤8px 时，「解钉后滚回贴底＝回钉」防抖会误判回钉，随后 #706 看门狗每 250ms 把进行中的上滑拽回底＝「反复回弹」（红米 K80 实报：刚开始滑动最明显）。手势期两个自动回钉都让路
body.addEventListener('touchstart', function (e) {
try { chatUnpinTsY = e.touches[0].clientY; } catch (err) { chatUnpinTsY = 0; }
chatTouchActive = true;
if (!batchRendering) unpinChatAndAnchor(); // #874d：空窗期屏上没有列表可翻，进度条期的一次上滑不该把贴底永久解掉（finishSwap 落底全看 pinned）
}, { passive: true, capture: true });
body.addEventListener('touchend', function (e) {
chatTouchActive = false; // #716：手势结束才恢复自动回钉资格
try {
const dy = Math.abs(e.changedTouches[0].clientY - chatUnpinTsY);
if (dy < 10 && chatAtBottom()) scrollChatBottom();
} catch (err) {}
}, { passive: true });
body.addEventListener('touchcancel', function () { chatTouchActive = false; }, { passive: true }); // #716
body.addEventListener('wheel', function () { if (!batchRendering) unpinChatAndAnchor(); }, { passive: true }); // #874e：与 #874d 同闸
function refreshKbRepin() {
chatRepinAfterSettle();
}
(function () {
const vv466 = window.visualViewport;
if (vv466) vv466.addEventListener('resize', refreshKbRepin);
})();
let _cbBoxChangeTs = 0; // 聊天盒自身最近一次变尺寸时刻（下面 #643 的 RO 里记；无 RO 的老内核恒 0＝不成为闸）
(function () {
const cb643 = document.getElementById('chat-body');
if (!cb643 || typeof ResizeObserver === 'undefined') return;
new ResizeObserver(function () {
_cbBoxChangeTs = Date.now();
chatRepinAfterSettle();
}).observe(cb643);
})();
let _vvGeomChangeTs = 0;
(function () {
const vv706 = window.visualViewport;
const mark706 = function () { _vvGeomChangeTs = Date.now(); };
if (vv706) { vv706.addEventListener('resize', mark706); vv706.addEventListener('scroll', mark706); }
window.addEventListener('resize', mark706);
})();
let _kbSettleT = null;
let _kbSettleDeadline = 0;
function chatRepinQuietEnough(now) {
return now - _vvGeomChangeTs >= 180 && now - _cbBoxChangeTs >= 180 && now - _chatScrollActTs >= 200 && !batchRendering && !_ccSmoothT && !chatTouchActive;
}
function chatRepinAfterSettle() {
if (!chatVisible() || !chatPinnedBottom || _kbSettleT) return; // 已有一枪在膛：由它负责复查，不重复排队
_kbSettleDeadline = Date.now() + 1200;
_kbSettleT = setTimeout(chatRepinStep, 120);
}
function chatRepinStep() {
_kbSettleT = null;
const now = Date.now();
if (!chatVisible() || !chatPinnedBottom) return; // #162：用户已解钉（翻历史/触摸）＝绝不拽底
if (!chatRepinQuietEnough(now)) { if (now < _kbSettleDeadline) _kbSettleT = setTimeout(chatRepinStep, 120); return; }
const cb868 = document.getElementById('chat-body');
if (cb868 && chatScrollMax() - cb868.scrollTop > 8) scrollChatBottom(); // #416：≤8px 不折腾
}
setInterval(function () {
if (!chatVisible() || batchRendering || _ccSmoothT || chatTouchActive) return; // #716：触摸手势进行中不让路=看门狗与用户上滑对打
if (Date.now() - _chatScrollActTs < 200) return; // #765：列表滚动中（含抬手后的惯性滑行）不让路，落定后再复核
if (Date.now() - _vvGeomChangeTs < 180) return; // 视口变形进行中不写，等落定
if (Date.now() - _cbBoxChangeTs < 180) return; // #871：聊天盒还在变尺寸（mobile-adapt 分步恢复中）同样不写
const cb706 = document.getElementById('chat-body');
if (!cb706) return;
if (!chatPinnedBottom) {
if (!chatAtBottom()) return;
chatPinnedBottom = true; cb706.classList.remove('scroll-anchor-auto'); chatScrollRealignQuiet();
return;
}
if (cb706.scrollTop < chatScrollMax() - 8) scrollChatBottom();
}, 250);
let _rsAlignT = null;
let _rsAlignDeadline = 0;
function chatScrollRealignQuiet() {
if (_rsAlignT) return; // 已有一枪在膛：由它负责复查，不重复排队
_rsAlignDeadline = Date.now() + 1200;
_rsAlignT = setTimeout(chatScrollRealignStep, 120);
}
function chatScrollRealignStep() {
_rsAlignT = null;
const now = Date.now();
if (!chatVisible()) return;
if (!chatRepinQuietEnough(now)) { if (now < _rsAlignDeadline) _rsAlignT = setTimeout(chatScrollRealignStep, 120); return; }
const cb = document.getElementById('chat-body');
if (!cb) return;
if (chatPinnedBottom || chatAtBottom()) { scrollChatBottom(); return; }
chatResyncScrollQuiet('scroll');
}
body.addEventListener('load', (e) => {
const t = e.target;
if (!t || t.tagName !== 'IMG') return;
if (!chatPinnedBottom || batchRendering || !chatVisible()) return;
if (Date.now() - _chatScrollActTs < 200 || chatTouchActive) { chatRepinAfterSettle(); return; }
scrollChatBottom(); requestAnimationFrame(scrollChatBottom); // FIX #504：同步写当帧即修正（load 先于新尺寸首帧绘制），rAF 留作部分内核丢弃同步写的兜底
}, true);
const EMPTY_SNIFF_MAX_B64 = 96 * 1024;
function alphaSampleEmpty(im) {
try {
const S = 24;
const c = document.createElement('canvas');
c.width = S; c.height = S;
const x = c.getContext('2d');
if (!x) return false;
x.drawImage(im, 0, 0, S, S);
const d = x.getImageData(0, 0, S, S).data;
for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return false; } // 有任一非透明像素=有画面
return true;
} catch (e) { return false; } // 跨域污染/取不到像素=不可判，按有画面放行
}
function alphaCheckable(src) {
if (typeof src !== 'string' || src.indexOf('data:image/') !== 0) return false;
const comma = src.indexOf(',');
if (comma < 0 || src.indexOf(';base64') < 0) return false;
const b64 = src.slice(comma + 1);
if (!b64.length || b64.length > EMPTY_SNIFF_MAX_B64) return false;
let bin;
try { bin = atob(b64); } catch (e) { return false; }
if (!bin || bin.length < 8) return false;
const o = (i) => bin.charCodeAt(i);
if (bin.slice(0, 3) === 'GIF') {
let n = 0, i = bin.indexOf('\x21\xF9\x04');
while (i >= 0) { n++; if (n >= 2) return false; i = bin.indexOf('\x21\xF9\x04', i + 3); }
return true;
}
if (o(0) === 137 && o(1) === 80 && o(2) === 78 && o(3) === 71) {
let p = 8;
while (p + 8 <= bin.length) {
const len = ((o(p) << 24) >>> 0) + (o(p + 1) << 16) + (o(p + 2) << 8) + o(p + 3);
const type = bin.slice(p + 4, p + 8);
if (type === 'acTL') return false;
if (type === 'IDAT' || type === 'IEND') return true;
if (!/^[A-Za-z]{4}$/.test(type) || len < 0 || p + 12 + len > bin.length) return false; // 结构异常=不判
p += 12 + len;
}
return false;
}
return false; // JPEG 无透明通道（永远采不出全 0）；webp/svg/未知格式不冒险
}
const _chatBlobCache = new Map(); // payload 头 -> objectURL（LRU，超出即 revoke）
const _chatImgFailSeen = Object.create(null); // 诊断去重：同一份载荷只写一条
const CHAT_BLOB_CACHE_MAX = 24;
function chatDataUrlParts(s) {
if (typeof s !== 'string' || s.slice(0, 5).toLowerCase() !== 'data:') return null;
const comma = s.indexOf(',');
if (comma < 0) return null;
const head = s.slice(5, comma);
return { mime: (head.split(';')[0] || '').trim(), b64: /;base64(;|$)/i.test(head) };
}
function chatBlobRetry(im, s) {
const p = chatDataUrlParts(s);
if (!p) return '';
if (typeof URL === 'undefined' || !URL.createObjectURL || typeof Blob === 'undefined') return '';
const comma = s.indexOf(',');
const key = s.slice(0, 96);
try {
let u = _chatBlobCache.get(key);
if (!u) {
let bytes;
if (p.b64) {
const bin = atob(s.slice(comma + 1));
const arr = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
bytes = arr;
} else {
bytes = decodeURIComponent(s.slice(comma + 1));
}
u = URL.createObjectURL(new Blob([bytes], { type: p.mime || 'application/octet-stream' }));
_chatBlobCache.set(key, u);
if (_chatBlobCache.size > CHAT_BLOB_CACHE_MAX) {
const k0 = _chatBlobCache.keys().next().value;
try { URL.revokeObjectURL(_chatBlobCache.get(k0)); } catch (e0) {}
_chatBlobCache.delete(k0);
}
}
im.dataset.blobTried = '1'; // 只换一次路（失败由下一轮 error 兜底，绝不成环）
im.src = u;
return u;
} catch (e) {
return '';
}
}
function chatImgFailNote(s, im) {
const p = chatDataUrlParts(s) || { mime: '?' };
const comma = s.indexOf(',');
const body = comma >= 0 ? s.slice(comma + 1) : '';
return '[图片加载失败] mime=' + p.mime + ' 字节≈' + Math.round(body.length * 3 / 4) + ' base64头=' + body.slice(0, 12) +
(im && im.naturalWidth ? ' 尺寸=' + im.naturalWidth + 'x' + im.naturalHeight : ' 未能解码');
}
function chatImgFailNoteOnce(s, im) {
const key = s.slice(0, 96);
if (_chatImgFailSeen[key]) return;
_chatImgFailSeen[key] = 1;
try { if (window.__jsErrors) window.__jsErrors.push(chatImgFailNote(s, im)); } catch (e) {}
}
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
if (isTok) {
const h = s.slice(4);
let n = 0;
const iv = setInterval(() => {
if (!im.isConnected) { clearInterval(iv); return; }
if (window.mochiMediaExpand && window.mochiMediaExpand(s)) { clearInterval(iv); return; }
if (window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(s)) {
clearInterval(iv);
const ph = document.createElement('span');
ph.style.cssText = 'opacity:.5;font-size:12px';
ph.textContent = '（图片丢失：媒体数据缺失，可到设置→查看存储→媒体池「重建媒体池」恢复，或导入含图片的完整备份）';
im.replaceWith(ph);
try { if (window.mochiMediaPhRegister) window.mochiMediaPhRegister(h, ph, im); } catch (e2) {}
return;
}
if (++n >= 8) clearInterval(iv);
}, 500);
return;
}
if (!im.dataset.blobTried && chatBlobRetry(im, s)) return;
chatImgFailNoteOnce(s, im);
const ph = document.createElement('span');
ph.style.cssText = 'opacity:.5;font-size:12px';
ph.textContent = '（表情/图片加载失败：网络不通或原图已失效）';
im.replaceWith(ph);
}, 1500);
});
im.addEventListener('load', () => {
if (im.dataset.alphaChecked) return;
if (!alphaCheckable(im.getAttribute('src') || '')) return;
im.dataset.alphaChecked = '1';
if (!im.complete || !im.naturalWidth) return;
if (!alphaSampleEmpty(im)) return;
setTimeout(() => {
if (!im.isConnected || !im.complete || !im.naturalWidth) return;
if (!alphaSampleEmpty(im)) return; // 复采有画面＝首采遇解码未就绪，撤销判定
const ph = document.createElement('span');
ph.style.cssText = 'opacity:.5;font-size:12px';
const lb = document.createElement('span');
lb.textContent = '（这张表情图没有画面：空白图/全透明图，可长按撤回；要根治请到字卡库或「我的表情包」删掉这张）';
const undo = document.createElement('span');
undo.textContent = '点此恢复显示';
undo.style.cssText = 'text-decoration:underline;margin-left:4px';
const tap = (e) => {
e.stopPropagation(); // 不吃到气泡 click（否则点恢复反而弹出操作面板）
im.dataset.alphaChecked = '1'; // 用户已判定=不再复判，误判也有永久出口
ph.replaceWith(im);
};
ph.style.cursor = 'pointer';
ph.addEventListener('click', tap);
ph.appendChild(lb);
ph.appendChild(undo);
im.replaceWith(ph);
}, 350);
});
});
}
function msgKeyOf(rec) {
if (!rec) return '';
return (rec.ts || 0) + '|' + (rec.side || '') + '|' + (rec.type || '') + '|' + String(rec.text || '').slice(0, 80);
}
function surveyCardHtml(rec) {
const qs = Array.isArray(rec.surveyQs) ? rec.surveyQs : [];
const answers = Array.isArray(rec.surveyAnswers) ? rec.surveyAnswers : [];
const done = rec.surveyStatus === 'done';
const nDone = answers.filter(a => typeof a === 'string' && a.trim()).length;
let rows = '';
qs.forEach((q, i) => {
const a = answers[i] || '';
rows += '<div class="msg-survey-item' + (a ? ' answered' : '') + '">' +
'<div class="msg-survey-q">' + (i + 1) + '. ' + escTxt(q.text || '') + '</div>' +
(Array.isArray(q.options) && q.options.length
? '<div class="msg-survey-opts">' + q.options.map(o => '<span class="msg-survey-opt' + (a && String(o) === String(a) ? ' sel' : '') + '">' + escTxt(o) + '</span>').join('') + '</div>'
: '') +
(a ? '<div class="msg-survey-a">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(a) : a) + '</div>' : '') +
'</div>';
});
return '<div class="msg-survey-card' + (done ? ' done' : '') + '">' +
'<div class="msg-survey-head">你发出的问卷 · ' + qs.length + ' 题</div>' +
'<div class="msg-survey-list">' + (rows || '<div class="msg-survey-item">（问卷内容缺失）</div>') + '</div>' +
'<div class="msg-survey-tip">' + (done ? '已交卷 · 点击查看问卷详情' : 'TA 正在作答 · 已答 ' + nDone + '/' + qs.length + '，点击查看进度') + '<span class="msg-survey-chev">\u203A</span></div>' +
favHeartHtml(rec) +
'</div>';
}
window.chatSyncSurveyCard = function (surveyTs, status, answers) {
if (!surveyTs) return;
for (let i = msgs.length - 1; i >= 0; i--) {
const r = msgs[i];
if (r && r.special === 'ask-survey' && r.surveyTs === surveyTs) {
r.surveyStatus = status;
r.surveyAnswers = Array.isArray(answers) ? answers : [];
saveMsgs();
const el = body.querySelector('.msg-survey[data-idx="' + i + '"]');
if (el) el.innerHTML = surveyCardHtml(r);
return;
}
}
};
const GAME_CHAT_CARDS = {
gomoku: { icon: '⚫', name: '五子棋' },
c4: { icon: '🔵', name: '四子棋' },
ms: { icon: '💣', name: '合作扫雷' },
linkup: { icon: '🔗', name: '连连看' },
match3: { icon: '🍬', name: '消消乐' },
auction: { icon: '🔨', name: '心意币拍卖会' }
};
function renderMsg(rec) {
const m = document.createElement('div');
m.dataset.mk = msgKeyOf(rec); // FIX 2026-09-15 #491 身份锚随渲染写入，批量渲染只覆盖 data-idx 不动它
m.dataset.idx = msgs.length - 1;
const __fit = rec.side !== 'out' && !!window.taFit;
const __taNm = chatPartnerName();
const __meNm = chatUserName();
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
? '<div class="msg-ask-a">✓ ' + escTxt(T(askCardReplyClean(rec.inviteAnswer) || 'TA 回应了你')) + '</div>'
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
? '<div class="msg-ask-a">✓ ' + T('TA：') + escTxt(T(rec.askAnswer || '回答了你')) + '</div>' + (rec.askReply ? '<div class="msg-choose-r">' + T('TA：') + escTxt(T(askCardReplyClean(rec.askReply))) + '</div>' : '')
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
m.innerHTML = '<span>' + (rec.nickKeep ? escTxt(rec.text) : pokeIconHtml(pokePersonMap(rec.text, __taNm, __meNm))) + '</span>' +
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
if (GAME_CHAT_CARDS[rec.special]) {
const gc = GAME_CHAT_CARDS[rec.special];
const gg = rec.game && typeof rec.game === 'object' ? rec.game : null;
const gRaw = String(rec.text || '');
const gCut = gRaw.indexOf(' · ');
const gRes = gg && gg.result ? String(gg.result) : (gCut > 0 ? gRaw.slice(gCut + 3) : gRaw);
const gOut = (gg && gg.outcome) || (/你赢/.test(gRes) ? 'win' : (/平/.test(gRes) ? 'draw' : (/赢/.test(gRes) ? 'lose' : 'clear')));
const gStats = gg && Array.isArray(gg.stats) ? gg.stats.filter((x) => x && String(x).trim()).slice(0, 6) : [];
m.className = 'msg-pong msg-game';
m.innerHTML = '<div class="msg-pong-card msg-game-card">' +
'<div class="msg-pong-label">' + gc.icon + ' ' + escTxt(T(gg && gg.name ? String(gg.name) : gc.name)) + '</div>' +
'<div class="msg-game-result game-' + gOut + '">' + escTxt(T(gRes)) + '</div>' +
(gStats.length ? '<div class="msg-game-stats">' + gStats.map((x) => '<div class="msg-game-stat">' + escTxt(T(String(x))) + '</div>').join('') + '</div>' : '') +
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
const sideTxt = rec.side === 'out' ? '我 送出' : (rec.giftSelf ? (chatPartnerName() + ' 自己买的') : (chatPartnerName() + ' 送来'));
const gc = ((window.GIFT_CAT_COLOR || {})[rec.giftCat]) || '#f2f2f5';
m.innerHTML = '<div class="msg-gift-card">' +
'<div class="msg-gift-emoji" style="background:' + escTxt(gc) + '">' + (rec.giftImg ? '<img class="msg-gift-img" src="' + escTxt(rec.giftImg) + '" alt="">' : escTxt(rec.giftEmoji || '\uD83C\uDF81')) + '</div>' +
'<div class="msg-gift-name">' + escTxt(rec.giftName || '礼物') + '</div>' +
'<div class="msg-gift-divider"></div>' +
'<div class="msg-gift-wish">\u201C' + escTxt(rec.giftWish || '心意') + '\u201D</div>' +
'<div class="msg-gift-foot"><span class="mg-side">' + escTxt(sideTxt) + '</span>' +
'<span class="msg-gift-price">\u00A5' + escTxt(Number(rec.giftPrice || 0).toFixed(2)) + '</span></div>' +
giftCardReplHtml(rec) +
giftCardActsHtml(rec) +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'wish') {
m.className = 'msg-gift msg-wish';
m.dataset.idx = msgs.length - 1;
const wStill = !window.giftTaWishHas || window.giftTaWishHas(rec.wishGiftId);
const wgc = ((window.GIFT_CAT_COLOR || {})[rec.wishGiftCat]) || '#f2f2f5';
m.innerHTML = '<div class="msg-gift-card msg-wish-card">' +
'<div class="msg-wish-tag">' + escTxt(T('TA 的心愿')) + '</div>' +
'<div class="msg-gift-emoji" style="background:' + escTxt(wgc) + '">' + (rec.wishGiftImg ? '<img class="msg-gift-img" src="' + escTxt(rec.wishGiftImg) + '" alt="">' : escTxt(rec.wishGiftEmoji || '\uD83C\uDF81')) + '</div>' +
'<div class="msg-gift-name">' + escTxt(rec.wishGiftName || '礼物') + '</div>' +
'<div class="msg-gift-divider"></div>' +
'<div class="msg-gift-wish">\u201C' + escTxt(T(rec.text || '想要这个')) + '\u201D</div>' +
'<div class="msg-gift-foot"><span class="mg-side">' + escTxt(chatPartnerName() + T(' 许愿')) + '</span>' +
'<span class="msg-gift-price">\u00A5' + escTxt(Number(rec.wishGiftPrice || 0).toFixed(2)) + '</span></div>' +
(wStill
? '<div class="msg-wish-acts"><button class="msg-wish-buy" type="button">' + T('送 TA') + '</button></div>'
: '<div class="msg-wish-done">\u2713 ' + T('已送出') + '</div>') +
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
'<div class="msg-ask-q">' + escTxt(rec.choiceQuestion || rec.text || '') + '</div>' +
(answered
? '<div class="msg-ask-a">✓ 你选择了：' + escTxt(rec.choiceAnswer) + '</div><div class="msg-choose-r">' + T('TA：') + escTxt(T(askCardReplyClean(rec.choiceReply))) + '</div>'
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
'<div class="msg-ask-q">' + escTxt(rec.curiousQuestion || rec.text || '') + '</div>' +
(answered
? '<div class="msg-ask-a">✓ 你：' + escTxt(rec.curiousAnswer) + '</div><div class="msg-choose-r">' + T('TA：') + escTxt(T(askCardReplyClean(rec.curiousReply))) + '</div>'
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
'<div class="msg-ask-q">' + escTxt(rec.roastText || rec.text || '') + '</div>' +
(answered
? '<div class="msg-ask-a">✓ 你：' + escTxt(rec.roastAnswer) + '</div><div class="msg-choose-r">' + T('TA：') + escTxt(T(askCardReplyClean(rec.roastReply))) + '</div>'
: '<div class="msg-ask-tip">' + T('点击回 TA 一句') + '</div>') +
favHeartHtml(rec) +
'</div>';
appendMsg(m);
maybeScrollChatBottom(rec.side);
return m;
}
if (rec.special === 'ask-survey') {
m.className = 'msg-ask msg-survey';
m.dataset.idx = msgs.length - 1;
m.innerHTML = surveyCardHtml(rec);
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
? '<div class="msg-ask-a">✓ 已回答：' + escTxt(rec.askAnswer) + '</div>' + (rec.askReply ? '<div class="msg-choose-r">' + T('TA：') + escTxt(T(askCardReplyClean(rec.askReply))) + '</div>' : '')
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
m.dataset.pendingRead = '1';
} else if (rec.retracted) {
b.dataset.orig = rec.orig || retractSafeHtml(rec); // FIX #572d：仍是「快照优先」，无快照才走安全兜底（不再裸直出 rec.text）
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
bindMediaFailPlaceholder(b);
} else if (rec.type === 'voice' || (String(rec.text || '').indexOf('|||') >= 0 && /@@m:[0-9a-f]{32}$/.test(String(rec.text || ''))) || chatIsDataAudioSrc(rec.text)) {
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
inner += '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(T(textPart)) : escTxtBr(T(textPart))) + '</span>';
}
b.innerHTML = rec.quote
? quoteHtml(rec.quote, rec.qside) + inner
: inner;
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
segHtml += window.mochiInlineTextHtml(T(segs[i]));
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
chatRetractToggleAfter('rc'); // #871：字卡明细开合同样是滚动区高度突变
});
}
} else {
const __rawText = typeof rec.text === 'string' ? rec.text : '';
const __blankMsg = !__rawText.trim();
const __imgSrc = !__blankMsg && chatIsImgSrcLike(__rawText) ? __rawText.trim() : '';
const __bodyHtml = __blankMsg
? '<span style="opacity:.5;font-size:12px">（空白消息）</span>'
: (__imgSrc
? '<img class="msg-img msg-img-big" src="' + attrEsc(__imgSrc) + '" alt="图片" loading="lazy" decoding="async">'
: '<span style="opacity:.85;word-break:break-word">' + window.mochiInlineTextHtml(T(__rawText)) + '</span>');
b.innerHTML = rec.quote
? quoteHtml(rec.quote, rec.qside) + __bodyHtml
: __bodyHtml;
if (__imgSrc) {
const __uImg = b.querySelector('.msg-img-big');
if (__uImg) __uImg.addEventListener('click', (e) => { e.stopPropagation(); if (window.viewChatImage) window.viewChatImage(__uImg.src); });
bindMediaFailPlaceholder(b); // FIX #948 内联载荷解不出图时不再空白（#202 同款占位）
}
}
if (rec.mood && rec.mood.length && !rec.retracted) {
const mm = document.createElement('div');
mm.className = 'msg-moods';
const recalled = [];
rec.mood.forEach((md, mi) => {
if (rec.retractedMood && rec.retractedMood.indexOf(mi) >= 0) { recalled.push(md); return; }
const mt = escTxt(T(md.tag)), ml = escTxt(T(md.label));
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
chatRetractToggleAfter('rcm'); // #871：情绪字卡明细开合同样是滚动区高度突变
});
}
}
fillAvatar(av, rec.side === 'out' ? 'cs-avatar-user' : 'cs-avatar-partner');
if (rec.side === 'in') {
av.style.cursor = 'pointer';
av.title = T('对 TA 拍一拍');
let pokeTapT = null;    // touch 路布点
let pokeTapP = null;    // pointer 路布点
let pokeTapGuard = 0;   // 三路共用防重入
av.addEventListener('touchstart', (e) => {
if (Date.now() < pokeTapGuard) return; // 已由其他路开过，让位
const t = e.changedTouches && e.changedTouches[0];
if (!t) return;
pokeTapT = { x: t.clientX, y: t.clientY, t: Date.now(), id: t.identifier };
}, { passive: true });
av.addEventListener('touchend', (e) => {
const t = e.changedTouches && e.changedTouches[0];
if (!pokeTapT || !t || t.identifier !== pokeTapT.id || Date.now() < pokeTapGuard) return;
const dt = Date.now() - pokeTapT.t;
const dx = t.clientX - pokeTapT.x;
const dy = t.clientY - pokeTapT.y;
pokeTapT = null;
if (dx * dx + dy * dy > 144 || dt > 450) return; // 滑动/按住不算点（与 pointer 路同口径，文本异形护哨兵唯一）
pokeTapGuard = Date.now() + 800;
openPokeCard(true); // FIX #511：手势开路 → 布点击闸，吞掉紧随的合成 click
}, { passive: true });
av.addEventListener('touchcancel', () => { pokeTapT = null; }, { passive: true });
av.addEventListener('pointerdown', (e) => {
if (e.pointerType === 'mouse' || Date.now() < pokeTapGuard) return;
pokeTapP = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
});
av.addEventListener('pointerup', (e) => {
if (!pokeTapP || e.pointerId !== pokeTapP.id || e.pointerType === 'mouse' || Date.now() < pokeTapGuard) return;
const dx = e.clientX - pokeTapP.x;
const dy = e.clientY - pokeTapP.y;
const dt = Date.now() - pokeTapP.t;
pokeTapP = null;
if (dt > 450 || dx * dx + dy * dy > 144) return; // 滑动/按住不算点，滚动照常
pokeTapGuard = Date.now() + 800;
openPokeCard(true); // FIX #511：同 touch 路——手势开路布闸，防合成 click 落进面板
});
av.addEventListener('pointercancel', () => { pokeTapP = null; });
av.addEventListener('click', (e) => {
if (Date.now() < pokeTapGuard) { e.preventDefault(); e.stopPropagation(); return; }
e.stopPropagation();
openPokeCard();
});
}
if (rec.side === 'in' && rec.initiative && !rec.retracted) {
try {
const c = cfg();
if (cfgn(c, 'as-badge', 1) === 1 && !b.querySelector('.msg-hi-heart') && !b.querySelector('.msg-hi-mark')) {
let pool = [];
try { pool = (window.asBadgePool ? window.asBadgePool(c) : []) || []; } catch (e) { pool = []; }
if (!pool.length) pool = [{ s: '♥', builtin: 1 }];
let pick = pool[0];
if (pool.length > 1) {
if (cfgn(c, 'as-badge-rand', 1) === 1) {
pick = pool[Math.floor(Math.random() * pool.length)];
} else {
const seed = Number(rec.ts) || 0;
pick = pool[Math.abs(Math.floor(seed / 1000)) % pool.length];
}
}
if (pick && pick.builtin === 1 && pick.s === '♥') {
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('class', 'msg-hi-heart');
svg.setAttribute('viewBox', '0 0 24 24');
svg.setAttribute('fill', 'currentColor');
svg.setAttribute('aria-hidden', 'true');
const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
path.setAttribute('d', 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');
svg.appendChild(path);
b.insertBefore(svg, b.firstChild);
} else if (pick && pick.s) {
const mk = document.createElement('span');
mk.className = 'msg-hi-mark';
mk.setAttribute('aria-hidden', 'true');
mk.textContent = String(pick.s);
b.insertBefore(mk, b.firstChild);
}
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
windowRenderedN = 0; windowRenderedPrefix = null; windowStale = false; windowRenderedNicks = ''; windowRenderedLite = null; normChangedIdxs = null; normChangedRecs = []; normRemovedRecs = []; normOrigIdx = null; normSnapTail = null; // FIX #402/#675 随窗复位
cancelPersist();
chatArchClearBaseline(); // FIX 2026-09-17 #127：清空＝基准段作废
try { chatLedger[window.activePrefix()] = 0; } catch (e) {}
try { store.remove('chat-msgs'); } catch (e) {}
try { store.remove('chat-arch'); } catch (e) {} // FIX 2026-09-17 #127：增量日志一并清（否则刷新后回放复活）
try { store.remove('chat-meta'); } catch (e) {}
try {
chatBlkPurgePrefix(window.activePrefix());
} catch (e) {}
chatBlkResetState(); // #722：分块状态复位（此后保存走旧格式/重新分块）
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
windowRenderedN = 0; windowRenderedPrefix = null; windowStale = false; windowRenderedNicks = ''; windowRenderedLite = null; normChangedIdxs = null; normChangedRecs = []; normRemovedRecs = []; normOrigIdx = null; normSnapTail = null; // FIX #402/#675 随窗复位
cancelPersist();
chatTailClear(); // #180：整包导入替换＝旧日志作废
chatArchClearBaseline(); // FIX 2026-09-17 #127：整包替换＝旧基准段/日志作废
try {
chatBlkPurgePrefix(window.activePrefix());
} catch (e) {}
chatBlkResetState(); // #722：导入=全新历史，块状态复位（persistChatHistory 按新数组重新分块）
try { store.remove('chat-arch'); } catch (e) {}
try { if (window.idbSet) persistChatHistory(window.activePrefix(), msgs, true); } catch (e) {}
writeLsSnapshot(msgs, undefined, true);
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
if (chatIsInlineDataSrc(t)) t = phOf();
else if (/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(t)) t = t.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[附件]');
else if (t.indexOf('|||') >= 0) t = t.split('|||')[0].replace(/\.[^.]+$/, '').trim() || '[语音]';
else if (t.indexOf('<svg') >= 0) t = t.replace(/<[^>]*>/g, '').trim();
if (t.indexOf('@@m:') >= 0) t = t.replace(/@@m:[0-9a-f]{32}/g, '[图片]');
if (t.length > 40) t = t.slice(0, 40) + '…';
let notifyT = t;
if (opts.img && notifyT.indexOf('[图片]') < 0 && notifyT.indexOf('[表情包]') < 0 && notifyT.indexOf('[语音]') < 0 && notifyT.indexOf('[附件]') < 0) {
notifyT = notifyT + ' ' + phOf();
}
const isHidden = opts.isHidden === true;
if (isHidden) {
if (window.bgNotifyCheck) {
window.bgNotifyCheck(notifyT, opts.deliveredAt || Date.now(), { name: opts.name, img: opts.img, av: opts.av, avFixed: opts.avFixed === true, deliveredAt: opts.deliveredAt || 0, msgTs: opts.msgTs || 0 });
}
return;
}
{
const _pp = document.getElementById('page-phone');
if (_pp && _pp.hidden) return;
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
deskMsgAv.__avApplied = opts.av;
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
if ((rec.special === 'poke' || rec.special === 'ask-msg') && !rec.nickKeep && typeof text === 'string') {
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
} else if (chatIsDataImgSrc(text) ||
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
showDeskPopup({ name: name, text: info.text, type: rec.type, img: info.img, imgSub: info.imgSub, msgTs: rec.ts || 0, isHidden: true });
return;
}
if (chatVisible()) return;
showDeskPopup({ name: name, text: info.text, type: rec.type, img: info.img, imgSub: info.imgSub, msgTs: rec.ts || 0, deliveredAt: rec.dAt || 0, isHidden: false });
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
(function () {
const pp = document.getElementById('page-phone');
if (!pp || typeof MutationObserver === 'undefined') return;
new MutationObserver(function () {
if (pp.hidden && deskMsgEl && !deskMsgEl.hidden) window.hideDeskMsg();
}).observe(pp, { attributes: true, attributeFilter: ['hidden'] });
})();
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
chatRecStampUid(rec); // FIX #776：出生号——同一条消息被哪条通道克隆回去，认号不认正文
const len = msgs.length;
if (len && msgs[len - 1] === rec) {
try { (window.__mochiDupAdd = window.__mochiDupAdd || []).push(Date.now() + ':' + String((rec.text != null) ? rec.text : '').slice(0, 24) + ':' + String(rec.side || '')); } catch (eD) {}
return null;
}
const _kk = chatRecKindKey(rec);
if (_kk) {
for (let i = len - 1, n = 0; i >= 0 && n < 200; i--, n++) {
const p = msgs[i];
if (!p || chatRecKindKey(p) !== _kk) continue;
if (!chatRecKeysShare(p, rec)) continue; // 同毫秒不同类型的合法批量：留着
try { (window.__mochiDupAdd = window.__mochiDupAdd || []).push('id:' + Date.now() + ':' + String((rec.text != null) ? rec.text : '').slice(0, 24) + ':' + String(rec.side || '')); } catch (eD) {}
return null;
}
}
const _lk = (rec.special && !rec.dedupExempt && ((rec.side || '') === 'out' || rec.special === 'poke')) ? (chatRecLooseSig(rec) + chatRecCardExtra(rec)) : '';
if (_lk) {
for (let i = len - 1, n = 0; i >= 0 && n < 60; i--, n++) {
const p = msgs[i];
if (!p || (p.side || '') !== (rec.side || '') || p.special !== rec.special) continue;
const _dts = (rec.ts || 0) - (p.ts || 0);
if (_dts <= 0 || _dts > 800) continue; // 同毫秒归上一层闸门；>800ms 的人为重发归用户本意
if (chatRecLooseSig(p) + chatRecCardExtra(p) !== _lk) continue;
try { (window.__mochiDupAdd = window.__mochiDupAdd || []).push('lk:' + Date.now() + ':' + rec.special + ':' + String(rec.side || '')); } catch (eD2) {}
try { if ((rec.side || '') === 'out' && !rec.silent && typeof toast === 'function') toast('同样的内容刚发送过，未重复发送'); } catch (e) {}
return null;
}
}
for (let i = len - 1; i >= Math.max(0, len - 5) && !rec.dedupExempt && (rec.side || '') === 'out'; i--) {
const p = msgs[i];
if (!p || p.special || rec.special) continue;
if ((p.side || '') !== (rec.side || '')) continue;
if (!!p.img !== !!rec.img) continue;
if (!mediaTxtEq(p.text, rec.text)) continue;
const dts = (rec.ts || 0) - (p.ts || 0);
if (dts >= 0 && dts <= dupGapMs(rec)) {
chatMsgCutMark('g814out', rec); // #814d：发件侧 800ms 短闩命中留痕（正常只应见机械双击；频出＝发守卫层有回归）
saveMsgs();
try { if ((rec.side || '') === 'out' && !rec.silent && typeof toast === 'function') toast('同样的内容刚发送过，未重复发送'); } catch (e) {}
return null;
}
}
msgs.push(rec);
try {
if ((rec.side || '') === 'in' && !rec.special && window.__replyWaitT0) {
const __ms = Date.now() - window.__replyWaitT0;
window.__replyLatLog = window.__replyLatLog || [];
window.__replyLatLog.push(__ms);
if (window.__replyLatLog.length > 6) window.__replyLatLog.shift();
window.__replyWaitT0 = null;
}
} catch (eRL) {}
chatTailAppend(rec); // #180：同步尾巴日志先落 LS，再交低频整包落盘
try {
rec.dAt = Date.now();
rec.dVis = (document.visibilityState === 'visible' && (chatVisible() || !!document.getElementById('desk-msg'))) ? 1 : 0;
} catch (eDM) {}
window.__mochiMsgDelivered = function (ts, side) {
try {
const arr = msgs;
const now = Date.now();
for (let i = arr.length - 1, n = 0; i >= 0 && n < 200; i--, n++) {
const m = arr[i];
if (!m || !m.dAt) continue;
if ((m.ts || 0) !== (ts || 0) || (m.side || '') !== (side || '')) continue;
if (now - m.dAt < 200) return null;
return { at: m.dAt, vis: m.dVis ? 1 : 0, nAt: m.nAt || 0 };
}
} catch (eP) {}
return null;
};
window.__mochiMsgNotified = function (ts, side) {
try {
const arr = msgs;
for (let i = arr.length - 1, n = 0; i >= 0 && n < 200; i--, n++) {
const m = arr[i];
if (!m || !m.dAt) continue;
if ((m.ts || 0) !== (ts || 0) || (m.side || '') !== (side || '')) continue;
m.nAt = Date.now();
return true;
}
} catch (eN) {}
return false;
};
saveMsgs();
const notable = rec.side === 'in' && (!rec.special || rec.special === 'poke' || rec.special === 'gift' || rec.special === 'wish');
if (notable && !rec.silent && (!chatVisible() || document.visibilityState === 'hidden')) {
if (!chatVisible()) incChatUnread();
showDeskMsg(rec);
} else if (notable && rec.silent && !chatVisible()) {
incChatUnread();
}
if (renderStart > 0 && msgs.length - renderStart > WINDOW_MAX &&
(rec.side === 'out' || chatNearBottom())) {
trimWindowTopQuiet(RENDER_MAX);
}
maybeInsertDivider(msgs.length - 1);
const el = renderMsg(rec);
if (renderEnd >= msgs.length - 1) renderEnd = msgs.length;
try {
if (!batchRendering && el) {
windowRenderedN = Number(el.dataset.idx) + 1;
windowStale = false;
chatWinKeysSync(); // #1010：增量追加到新尾，身份凭据同步（否则下次收尾判不出前缀）
}
} catch (e) {}
return el;
}
function addIn(text, opts) {
opts = opts || {};
if (window.playSfx && !opts.silent && opts.special !== 'read') {
try { window.playSfx('in'); } catch (e) {}
}
const _tagMood = opts.tag ? [{ tag: String(opts.tag), label: opts.tagNoDup ? '' : String(text) }] : null;
const _tagExtra = Array.isArray(opts.tagExtra) ? opts.tagExtra.filter(md => md && String(md.tag || '').trim()).map(md => ({ tag: String(md.tag), label: md.label == null ? '' : String(md.label) })) : null;
const _tagMerged = (_tagExtra && _tagExtra.length) ? (_tagMood ? _tagMood.concat(_tagExtra) : _tagExtra) : _tagMood;
return addRec({ side: 'in', text: text, initiative: opts.initiative, special: opts.special, game: opts.game, quote: opts.quote, qidx: opts.qidx, type: opts.type, img: opts.img, parts: opts.parts, mailNotice: opts.mailNotice, gInv: opts.gInv, silent: opts.silent, askQuestion: opts.askQuestion, askStatus: opts.askStatus, askOptions: opts.askOptions, askType: opts.askType, choiceQuestion: opts.choiceQuestion, choiceOptions: opts.choiceOptions, choicePref: opts.choicePref, choiceCat: opts.choiceCat, choiceStatus: opts.choiceStatus, choiceAnswer: opts.choiceAnswer, choiceReply: opts.choiceReply, choiceMatch: opts.choiceMatch, curiousQuestion: opts.curiousQuestion, curiousQuick: opts.curiousQuick, curiousReplies: opts.curiousReplies, curiousFollowup: opts.curiousFollowup, curiousQid: opts.curiousQid, curiousCat: opts.curiousCat, curiousStatus: opts.curiousStatus, curiousAnswer: opts.curiousAnswer, curiousReply: opts.curiousReply, roastText: opts.roastText, roastCat: opts.roastCat, roastStatus: opts.roastStatus, roastAnswer: opts.roastAnswer, roastReply: opts.roastReply, rpAmount: opts.rpAmount, rpWish: opts.rpWish, rpStatus: opts.rpStatus, rpTs: opts.rpTs, rpCover: opts.rpCover, askFen: opts.askFen, askTs: opts.askTs, deskCk: opts.deskCk, deskCkDir: opts.deskCkDir, surveyTs: opts.surveyTs, surveyQs: opts.surveyQs, surveyStatus: opts.surveyStatus, surveyAnswers: opts.surveyAnswers, dedupExempt: opts.dedupExempt, nickKeep: opts.nickKeep, mood: opts.mood || _tagMerged || undefined });
}
function addInTyped(items, opts, firstDelay) {
try {
const myCid = window.__activeCid || 'default';
const same = () => (window.__activeCid || 'default') === myCid;
const arr = Array.isArray(items) ? items.filter(function (s) { return typeof s === 'string' && s; }) : [items];
if (!arr.length) return;
let i = 0;
const step = () => {
if (!same()) { hideTyping(); return; }
showTyping();
setTimeout(() => {
if (!same()) { hideTyping(); return; }
hideTyping();
addIn(arr[i], opts);
i++;
if (i < arr.length) setTimeout(step, 400);
}, Math.max(400, i === 0 ? (firstDelay || randInt(800, 1400)) : randInt(700, 1300)));
};
step();
} catch (e) {}
}
window.chatAddInTyped = function (items, opts, firstDelay) { return addInTyped(items, opts, firstDelay); };
function addOut(text) {
return addRec({ side: 'out', text: text });
}
function refreshNickNodesInPlace() {
try {
const idxs = [];
const from = Math.max(0, renderStart);
for (let i = from; i < msgs.length && i < renderEnd; i++) {
if (msgs[i] && !msgs[i].nickKeep && sysNickSweepable(msgs[i])) idxs.push(i);
}
if (!idxs.length) return;
patchChangedInPlace(idxs, from);
} catch (e) {}
}
window.chatSysNickChanged = function (oldName, slot) {
try {
if (typeof oldName !== 'string' || !oldName) return;
const S = sysNickSlot(slot);
const cur = S.cur();
const hist = sysNickHistGet(store, slot);
if (hist.indexOf(oldName) < 0) hist.push(oldName);
if (hist.indexOf(cur) < 0) hist.push(cur);
store.set(S.histKey, JSON.stringify(hist));
if (oldName === cur) { store.set(S.sweptKey, String(hist.length)); return; }
if (!chatDbReady) return;
store.set(S.sweptKey, String(hist.length));
if (sysNickSweepMsgs(msgs, oldName, slot)) saveMsgs();
try { chatTailSweepNick(oldName, slot); } catch (e) {} // FIX 2026-09-16 #626 尾巴日志同步清扫（防 chatTailMerge 用旧名原文补回一条重复）
try { if (chatVisible()) renderWindow(true); else refreshNickNodesInPlace(); } catch (e) {}
if (S.legacy && oldName !== S.legacy && hist.indexOf(S.legacy) < 0) window.chatSysNickChanged(S.legacy, slot);
} catch (e) {}
};
window.chatAddSystem = function (text, opts) {
opts = opts || {};
return addIn(text, { special: opts.special || 'poke', silent: opts.silent, img: opts.img, mailNotice: opts.mailNotice, nickKeep: opts.nickKeep, game: opts.game, askQuestion: opts.askQuestion, askStatus: opts.askStatus, askOptions: opts.askOptions, askType: opts.askType, askTs: opts.askTs, choiceQuestion: opts.choiceQuestion, choiceOptions: opts.choiceOptions, choicePref: opts.choicePref, choiceCat: opts.choiceCat, choiceStatus: opts.choiceStatus, choiceAnswer: opts.choiceAnswer, choiceReply: opts.choiceReply, choiceMatch: opts.choiceMatch, curiousQuestion: opts.curiousQuestion, curiousQuick: opts.curiousQuick, curiousReplies: opts.curiousReplies, curiousFollowup: opts.curiousFollowup, curiousQid: opts.curiousQid, curiousCat: opts.curiousCat, curiousStatus: opts.curiousStatus, curiousAnswer: opts.curiousAnswer, curiousReply: opts.curiousReply, roastText: opts.roastText, roastCat: opts.roastCat, roastStatus: opts.roastStatus, roastAnswer: opts.roastAnswer, roastReply: opts.roastReply, rpAmount: opts.rpAmount, rpWish: opts.rpWish, rpStatus: opts.rpStatus, rpTs: opts.rpTs, rpCover: opts.rpCover, askFen: opts.askFen, askTs: opts.askTs, deskCk: opts.deskCk, deskCkDir: opts.deskCkDir, surveyTs: opts.surveyTs, surveyQs: opts.surveyQs, surveyStatus: opts.surveyStatus, surveyAnswers: opts.surveyAnswers });
};
window.chatAddIn = function (text, opts) {
if (opts && opts.follow) chatUserFollowScroll = true;
const r = addIn(text, opts);
if (opts && opts.enter && !chatVisible()) enterChat();
return r;
};
window.chatAddGift = function (rec) { if (!rec.ts) rec.ts = Date.now(); return addRec(rec); };
function giftMetaOf(rec) {
if (!rec || !rec.giftBoxId || !window.giftGiftMeta) return null;
try { return window.giftGiftMeta(rec.giftBoxId); } catch (e) { return null; }
}
function giftReplList(rec) {
const m = giftMetaOf(rec);
if (!m || !Array.isArray(m.replies)) return [];
return m.replies.filter(function (r) { return r && typeof r.text === 'string' && r.text; });
}
function giftWhoLabel(who) { return who === 'me' ? '我' : chatPartnerName(); }
function giftReplRows(rec) {
return giftReplList(rec).map(function (r) {
return '<div class="mg-repl-row"><span class="mg-repl-who">' + escTxt(giftWhoLabel(r.who)) + '</span><span class="mg-repl-tx">' + escTxt(r.text) + '</span></div>';
}).join('');
}
function giftIsIncoming(rec) { return !!(rec && rec.side === 'in' && !rec.giftSelf && rec.giftBoxId); }
function giftCardActsInner(rec) {
if (!giftIsIncoming(rec)) return '';
const meta = giftMetaOf(rec);
if (!meta) return '';
const claim = meta.claimed === 0
? '<button class="msg-gift-claim" type="button">领取</button>'
: (meta.claimed === 1 ? '<span class="msg-gift-got">\u2713 已领取</span>' : '');
return claim + '<button class="msg-gift-reply" type="button">回复</button>';
}
function giftCardActsHtml(rec) { return giftIsIncoming(rec) ? '<div class="msg-gift-acts">' + giftCardActsInner(rec) + '</div>' : ''; }
function giftCardReplHtml(rec) {
return '<div class="msg-gift-repl"' + (giftReplList(rec).length ? '' : ' hidden') + '>' + giftReplRows(rec) + '</div>';
}
function giftPatchCard(idx) {
const rec = msgs[idx];
if (!rec || rec.special !== 'gift' || !body) return false;
const el = body.querySelector('.msg-gift[data-idx="' + idx + '"]');
if (!el) return false;
const card = el.querySelector('.msg-gift-card');
if (!card) return false;
const anchorOf = function () { return card.querySelector('.msg-fav-heart'); };
const acts = card.querySelector('.msg-gift-acts');
const wantsActs = giftCardActsHtml(rec);
if (acts) {
if (wantsActs) acts.innerHTML = giftCardActsInner(rec);
else acts.remove();
} else if (wantsActs) {
const an = anchorOf();
if (an) an.insertAdjacentHTML('beforebegin', wantsActs); else card.insertAdjacentHTML('beforeend', wantsActs);
}
const repl = card.querySelector('.msg-gift-repl');
if (repl) { repl.innerHTML = giftReplRows(rec); repl.hidden = !giftReplList(rec).length; }
else if (giftReplList(rec).length) {
const an2 = card.querySelector('.msg-gift-acts') || anchorOf();
if (an2) an2.insertAdjacentHTML('beforebegin', giftCardReplHtml(rec)); else card.insertAdjacentHTML('beforeend', giftCardReplHtml(rec));
}
return true;
}
function giftClaimNow(idx) {
const rec = msgs[idx];
if (!giftIsIncoming(rec)) return false;
const meta = giftMetaOf(rec) || {};
if (meta.claimed === 1) return true;
if (!window.giftBoxMarkClaimed) return false;
try { window.giftBoxMarkClaimed(rec.giftBoxId); } catch (e) { return false; }
try { if (window.giftBoxLiveRefresh) window.giftBoxLiveRefresh(); } catch (e) {}
giftPatchCard(idx);
try { addIn('你收下了 ' + (rec.giftName || '礼物'), { special: 'poke' }); } catch (e2) {}
return true;
}
function giftReplyNow(idx) {
const rec = msgs[idx];
if (!giftIsIncoming(rec)) return false;
if (!window.openModal) return false;
const orig = String(rec.giftWish || '').trim();
window.openModal('回复 ' + chatPartnerName(), orig, function (v) {
const full = String(v == null ? '' : v).trim();
if (!full) return;
const added = (orig && full.indexOf(orig) === 0) ? full.slice(orig.length).trim() : full;
if (!added) return;   // 原文一字未动＝这次没追加任何内容，不产生空回复
addOut(added);                                 // ① 只把新增的这句发进聊天消息
try { if (rec.giftBoxId && window.giftBoxAttachReply) window.giftBoxAttachReply(rec.giftBoxId, 'me', added); } catch (e) {}
giftPatchCard(idx);
try { if (window.giftBoxLiveRefresh) window.giftBoxLiveRefresh(); } catch (e) {}
}, { placeholder: '接着写你的回复', staticText: '上面是这件礼物原本的文案：删掉它～就直接回一句自己的；留着它～接在后面就是「引用着原文回」。聊天里只发你新加的那句，卡片上原文与回复都在。' });
return true;
}
window.chatGiftAttachReplyTo = function (cid, giftTs, who, text, recRef) {
try {
if (!giftTs || !text) return false;
const whoNorm = who === 'me' ? 'me' : 'ta';
if ((window.__activeCid || 'default') === cid) {
let rec = null, idx = -1;
if (recRef && msgs.indexOf(recRef) >= 0) { rec = recRef; idx = msgs.indexOf(recRef); }
if (!rec) {
for (let i = msgs.length - 1; i >= 0; i--) {
const r = msgs[i];
if (r && r.special === 'gift' && r.ts === giftTs) { rec = r; idx = i; break; }
}
}
if (!rec) return false;
if (!rec.giftBoxId) return false;   // 存量卡没有心意柜指针＝没有可写的地方（不出动作区，同渲染口径）
if (window.giftBoxAttachReply) window.giftBoxAttachReply(rec.giftBoxId, whoNorm, text, cid);
giftPatchCard(idx);
return true;
}
if (!window.chatDeskCardReply) return false;
window.chatDeskCardReply(cid, 'gift', giftTs, '', function (hit) {
if (hit && hit.giftBoxId && window.giftBoxAttachReply) window.giftBoxAttachReply(hit.giftBoxId, whoNorm, text, cid);
}, null, null);
return true;
} catch (e) { return false; }
};
function deskAppendMissGuard(cid, tries, onRetry, writeOne) {
const ledKey = 'xy-home-v2:' + cid + ':chat-meta';
window.idbGet(ledKey).then(function (lv) {
let ledN = 0;
try {
const o = typeof lv === 'string' ? JSON.parse(lv) : lv;
if (o && typeof o.n === 'number') ledN = o.n;
} catch (e) {}
try { ledN = Math.max(ledN, chatLedger['xy-home-v2:' + cid] || 0); } catch (e) {}
if (ledN > 0) { if (tries < 5) setTimeout(onRetry, 2000); return; }
writeOne();
}).catch(function () { if (tries < 3) setTimeout(onRetry, 1500); });
}
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
if (!readOk) return;
arr.push({ side: 'in', special: opts.special || 'poke', text: text, ts: Date.now(), mailNotice: !!opts.mailNotice });
writeArr(arr);
return;
}
const confirmMiss = window.idbHasKey
? window.idbHasKey(key).then(function (has) { return has === false; })
: (window.idbGetAllKeys
? window.idbGetAllKeys().then(function (keys) {
return !(keys || []).some(function (k) { return k === key; });
}).catch(function () { return false; })
: Promise.resolve(true));
confirmMiss.then(function (isMiss) {
if (!isMiss) { if (tries < 3) setTimeout(attempt, 1500); return; }
deskAppendMissGuard(cid, tries, attempt, function () {
writeArr([{ side: 'in', special: opts.special || 'poke', text: text, ts: Date.now(), mailNotice: !!opts.mailNotice }]);
});
});
}).catch(function () { if (tries < 3) setTimeout(attempt, 1500); });
};
attempt();
};
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
if (!readOk) return;
arr.push(rec);
writeArr(arr);
return;
}
const confirmMiss = window.idbHasKey
? window.idbHasKey(key).then(function (has) { return has === false; })
: (window.idbGetAllKeys
? window.idbGetAllKeys().then(function (keys) {
return !(keys || []).some(function (k) { return k === key; });
}).catch(function () { return false; })
: Promise.resolve(true));
confirmMiss.then(function (isMiss) {
if (!isMiss) { if (tries < 3) setTimeout(attempt, 1500); return; }
deskAppendMissGuard(cid, tries, attempt, function () { writeArr([rec]); });
});
}).catch(function () { if (tries < 3) setTimeout(attempt, 1500); });
};
attempt();
};
window.chatDeskCardReply = function (cid, cardSpecial, cardTs, statusKey, patch, bubbles, onBack) {
if (cid === (window.__activeCid || 'default')) { if (onBack) onBack(); return; }
if (!window.idbGet || !window.idbSet || !cardTs) return;
const key = 'xy-home-v2:' + cid + ':chat-msgs';
const archKey = 'xy-home-v2:' + cid + ':chat-arch';
let tries = 0;
const writeArr = function (arr) {
try { window.idbSet(key, JSON.stringify(arr)); } catch (e) {}
try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
try { if (window.idbDelete) window.idbDelete(archKey); } catch (e) {}
try { chatLedgerSave('xy-home-v2:' + cid, arr.length, msgsBytes(arr)); } catch (e) {}
};
const attempt = function () {
tries++;
if ((window.__activeCid || 'default') === cid) { if (onBack) onBack(); return; }
const handleArr = function (arr) {
let hit = null;
for (let i = arr.length - 1; i >= 0; i--) {
const r = arr[i];
if (r && r.special === cardSpecial && r.ts === cardTs && !r.retracted) { hit = r; break; }
}
if (!hit || hit[statusKey] === 'answered') return;
if (patch) patch(hit);
(bubbles || []).forEach(function (b) { arr.push(Object.assign({ side: 'in', ts: Date.now() }, b)); });
writeArr(arr);
};
const mergeArch = function (arr, av) {
let arch = [];
try { arch = typeof av === 'string' ? JSON.parse(av) : av; } catch (e) { arch = []; }
if (Array.isArray(arch) && arch.length) {
const seen = new Set();
arr.forEach(function (m) { if (m) seen.add((m.ts || 0) + '|' + (m.side || '') + '|' + (m.special || '')); });
arch.forEach(function (m) { if (m && !seen.has((m.ts || 0) + '|' + (m.side || '') + '|' + (m.special || ''))) arr.push(m); });
arr.sort(function (a, b) { return (((a && a.ts) || 0) - ((b && b.ts) || 0)); });
}
handleArr(arr);
};
window.idbGet(key).then(function (v) {
if (v !== undefined && v !== null) {
let arr = [];
let readOk = true;
try { arr = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { arr = []; readOk = false; }
if (!Array.isArray(arr)) { arr = []; readOk = false; }
if (!readOk) return;
try { window.idbGet(archKey).then(function (av) { mergeArch(arr, av); }).catch(function () { handleArr(arr); }); }
catch (e) { handleArr(arr); }
return;
}
}).catch(function () { if (tries < 3) setTimeout(attempt, 1500); });
};
attempt();
};
window.chatDeskHistPush = function (cid, entry) {
const key = 'xy-home-v2:' + cid + ':invite-ask-history';
const write = function (list) {
list.unshift(entry);
if (list.length > 200) list.length = 200;
try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
try { window.idbSet(key, JSON.stringify(list)); } catch (e) {}
};
try {
const raw = localStorage.getItem(key);
if (raw !== null && raw !== undefined) { write(JSON.parse(raw) || []); return; }
} catch (e) {}
if (!window.idbGet) return;
window.idbGet(key).then(function (v) {
let list = [];
try { list = (typeof v === 'string' ? JSON.parse(v) : v) || []; } catch (e) { list = []; }
if (!Array.isArray(list)) list = [];
write(list);
}).catch(function () {});
};
window.chatAppendDeskCkTo = function (cid, q) {
const field = (window.buildDeskCkCard ? window.buildDeskCkCard(q) : null)
|| { deskCkDir: 'toMe', text: '在干嘛呢？想你了。', hint: 'TA 来查岗了。', opts: null, askType: 'text' };
window.chatAppendDeskRec(cid, {
side: 'in', special: 'ask-card', text: field.text,
askQuestion: field.text, askOptions: field.opts, askType: field.askType,
deskCk: true, deskCkDir: field.deskCkDir
});
};
window.chatAppendDeskTextTo = function (cid, text) {
window.chatAppendDeskRec(cid, { side: 'in', special: 'poke', text: text || '想你了，来聊聊天吧。' });
};
function saveMsgsNow() {
const authOk = chatDbReady && authLoadedPrefix === window.activePrefix();
if (!authOk) {
try { pendingLocal = msgs.slice(); } catch (e) {}
if (msgs.length) mergeLsSnapshotWith(msgs, undefined); // #245：合并而非覆盖，保住 LS 里的历史快照
try { scheduleIdbRetry(); } catch (e) {}
return;
}
const myPrefix = window.activePrefix();
schedulePersist(() => {
if (authLoadedPrefix !== myPrefix) return;
if (!chatLedgerGuard(myPrefix, msgs)) return;
try { if (window.idbSet) persistChatHistory(myPrefix, msgs); } catch (e) {}
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
addInTyped(reply || '…');
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + msgIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-choose-card answered"><div class="msg-ask-q">' + escTxt(rec.choiceQuestion || rec.text || '') + '</div><div class="msg-ask-a">✓ 你选择了：' + escTxt(answer) + '</div><div class="msg-choose-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(askCardReplyClean(reply) || '…') : (askCardReplyClean(reply) || '…')) + '</div>' + favHeartHtml(rec) + '</div>';
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
addInTyped(followup ? [reply || '…', followup] : (reply || '…'));
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + msgIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-choose-card answered"><div class="msg-ask-q">' + escTxt(rec.curiousQuestion || rec.text || '') + '</div><div class="msg-ask-a">✓ 你：' + escTxt(answer) + '</div><div class="msg-choose-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(askCardReplyClean(reply) || '…') : (askCardReplyClean(reply) || '…')) + '</div>' + favHeartHtml(rec) + '</div>';
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
addInTyped(reply || '…');
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + msgIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-choose-card answered"><div class="msg-ask-q">' + escTxt(rec.roastText || rec.text || '') + '</div><div class="msg-ask-a">✓ 你：' + escTxt(answer) + '</div><div class="msg-choose-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(askCardReplyClean(reply) || '…') : (askCardReplyClean(reply) || '…')) + '</div>' + favHeartHtml(rec) + '</div>';
}
};
window.chatAskReply = function (msgIdx, answer, reply, opts) {
let rec = msgs[msgIdx];
if (!rec || rec.special !== 'ask-card' || rec.askStatus === 'answered') {
rec = null;
for (let _i = msgs.length - 1; _i >= 0; _i--) {
const _r = msgs[_i];
if (_r && _r.special === 'ask-card' && _r.askStatus !== 'answered') { msgIdx = _i; rec = _r; break; }
}
if (!rec) return;
}
rec.askStatus = 'answered';
rec.askAnswer = answer;
let preset = '';
if (Array.isArray(reply) && reply.length) {
const arr = reply.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
if (arr.length) preset = arr[Math.floor(Math.random() * arr.length)];
} else if (typeof reply === 'string' && reply.trim()) {
preset = reply.trim();
}
let taReply;
if (opts && opts.raw && preset) {
taReply = preset;
} else {
taReply = preset
? (window.pickAskCardReply ? window.pickAskCardReply([preset]) : preset)
: (window.pickAskCardReply ? window.pickAskCardReply() : '收到你的回答。');
}
let deskReply = '';
if (rec && rec.deskCk) {
try {
const dir = rec.deskCkDir === 'meToTa' ? 'meToTa' : 'toMe';
let _dkP = 50;
try { if (window.dcfGet) _dkP = window.dcfGet('deskcheck'); } catch (e) {}
const pool = (window.getDeskCheckPool ? window.getDeskCheckPool(dir) : []).concat(
(window.getCustomCardsFor ? window.getCustomCardsFor(window.__activeCid || 'default') : []).filter(function (c) {
return typeof c === 'string' && c.trim() && c.indexOf('data:') !== 0 && !/^https?:\/\//i.test(c) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(c));
})
);
if (dir === 'meToTa' && /不要|不用|下次|不了|算了|no/i.test(String(answer))
&& (Math.random() * 100 < 50)) {
deskReply = ['那好吧，下次想查随时来呀。', '没事，那我把自己交给你保管。', '不查也行，反正我总是会来找你。'][Math.floor(Math.random() * 3)];
} else if (pool.length && Math.random() * 100 < _dkP) {
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
addInTyped(finalReply);
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + msgIdx + '"]');
if (el) {
el.innerHTML = '<div class="msg-ask-card answered"><div class="msg-ask-q">' + escTxt(rec.askQuestion || rec.text || '') + '</div><div class="msg-ask-a">✓ 已回答：' + escTxt(answer) + '</div><div class="msg-choose-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(askCardReplyClean(finalReply)) : askCardReplyClean(finalReply)) + '</div>' + favHeartHtml(rec) + '</div>';
}
return finalReply;
};
function retractDelayMs() { return 1000 + Math.floor(Math.random() * 2001); }
function retractMsg(msgEl, side, idxOverride) {
const idx = (typeof idxOverride === 'number' && idxOverride >= 0) ? idxOverride : parseInt(msgEl.dataset.idx, 10);
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
b.dataset.orig = b.innerHTML; // FIX #572d：撤回瞬间把渲染快照留住（原行为），点开就地展开这份快照
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
if (!(rec.mood[i] && String(rec.mood[i].label || '').trim())) continue;
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
const FALLBACK_REPLY_POOL = ['收到～', '好呀', '好～', '嗯嗯', '知道啦', '好哒', '嗯嗯，我在听'];
function pickNonBlank(arr) {
let v = '', g = 0;
do { v = pick(arr); g++; } while (g < 20 && !(typeof v === 'string' && v.trim()));
return (typeof v === 'string' && v.trim()) ? v : '';
}
function genReplyText(c) {
const pool = getPool();
let reply = '', type = 'text';
let replyCards = 1;
const stHit = !!(pool.sticker.length && hit(c['sticker-prob']));
const imHit = !!(pool.image.length && hit(c['image-prob']));
if (stHit && imHit) {
const _st = pickNonBlank(pool.sticker), _im = pickNonBlank(pool.image);
if (_st && _im) return { text: _st, type: 'text', parts: [
{ k: 'img', v: _st, sub: 'sticker' },
{ k: 'img', v: _im, sub: 'image' }
] };
}
if (stHit) {
reply = pickNonBlank(pool.sticker); type = 'sticker';
} else if (pool.emoji.length && hit(c['emoji-prob'])) {
reply = pickNonBlank(pool.emoji); type = 'emoji';
} else if (imHit) {
reply = pickNonBlank(pool.image); type = 'image';
} else if (pool.voice.length && hit(c['voice-prob'])) {
reply = pickNonBlank(pool.voice); type = 'voice';
} else {
reply = pickNonBlank(pool.text) || pick(FALLBACK_REPLY_POOL);
}
if (type === 'text' && pool.kaomoji.length && hit(c['kaomoji-prob'])) {
const kj = pickNonBlank(pool.kaomoji);
if (kj) { reply += ' ' + kj; replyCards = 2; } // #851 文字卡＋颜文字卡＝一条气泡两张卡
}
return { text: reply, type: type, cards: replyCards };
}
function scheduleReply() {
const myCid = window.__activeCid || 'default';
const sameCid = () => (window.__activeCid || 'default') === myCid;
syncLastMineText();
const quoteSrc = lastMineQuote;
const quoteSrcIdx = lastMineIdx;
const quoteKey = quoteSrc && typeof quoteSrc === 'object' ? String(quoteSrc.t || '') + '\n' + (quoteSrc.imgs || []).join() : String(quoteSrc || '');
const c = cfg();
try { window.__replyWaitT0 = Date.now(); } catch (eRW) {}
if (hit(c['rn-prob'])) {
setTimeout(() => { if (!sameCid()) return; addIn('', { special: 'read' }); }, randInt(1000, 4000));
return;
}
const delay = (c['rs-min'] + Math.random() * Math.max(1, c['rs-max'] - c['rs-min'])) * 1000;
try { window.__rsDrawS = Math.round(delay / 100) / 10; } catch (eRD) {} // #571 本次掷到的设定延迟（秒）
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
const count = (c['py-en'] === 1) ? randInt(rpMin, rpMax) : 1;
if (count >= 2 && window.replyGuideHint) window.replyGuideHint('py');
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
let rep = genOneReply(c);
if (rep && rep.type === 'text' && typeof rep.text === 'string' && rep.text.indexOf('data:') !== 0 && window.periodWarmText) {
try { const _w0 = rep.text, _w = window.periodWarmText(rep.text); if (_w) { rep.text = _w; if (_w !== _w0) pyMultiDrawn = true; } } catch (e) {}
}
const pyMultiHit = pyMultiDrawn;
let spellSegs = null;
let spellOne = false;
let spellImgParts = null;
function spellPartsSync(text, prevParts) {
const imgs = (prevParts || []).filter(p => p && p.k === 'img');
return imgs.length ? [{ k: 'text', v: text }].concat(imgs) : null;
}
try {
const _sp = (window.quoteSpellPick && window.quoteSpellPick(c)) || null;
if (_sp && Array.isArray(_sp.segs)) { spellSegs = _sp.segs; spellOne = !!_sp.one; }
else if (Array.isArray(_sp)) { spellSegs = _sp; }
} catch (e) {}
if (spellSegs && spellSegs.length > 1) {
const __spText = spellOne ? pyJoinCards(spellSegs, c) : spellSegs.join(''); // #650 单气泡连接符同走符号池
const __spImgs = (rep.parts || []).filter(p => p && p.k === 'img');
spellImgParts = __spImgs;
rep = { text: __spText, type: 'text', spell: spellSegs, spellOne: spellOne,
parts: __spImgs.length ? [{ k: 'text', v: __spText }].concat(__spImgs) : null };
}
let mjf = null;
if (!spellSegs) {
try { mjf = (window.dreamFreePick && window.dreamFreePick(c)) || null; } catch (e) { mjf = null; }
if (mjf && mjf.text) {
rep = { text: mjf.text, type: 'text', mjFree: true, parts: spellPartsSync(mjf.text, rep.parts) };
setTimeout(() => { try { if (window.dreamFreeSave && mjf.text) window.dreamFreeSave(mjf.text); } catch (e) {} }, 800);
}
}
let m = null;
const dictTag = (rep.spell && rep.spell.every(t => (t || '').length > 4)) ? '词典拼句' : '词典拼词';
const pyMultiExtra = (pyMultiHit || (rep.spell && rep.spellOne)) ? [{ tag: '多字卡回复', label: '' }] : null;
const willRetractR = hit(c['rc-prob']);
if (rep.spell && rep.spellOne) {
m = addIn(rep.spell.join(' '), {
quote: quote,
qside: 'out',
qidx: quote ? quoteIdx : undefined,
type: 'text',
parts: rep.parts,
silent: silent || willRetractR,
tag: dictTag,
tagExtra: pyMultiExtra,
tagNoDup: true
});
} else if (rep.spell) {
for (let si = 0; si < rep.spell.length; si++) {
if (si) {
showTyping();
await new Promise(r => setTimeout(r, randInt(900, 1800)));
if (!sameCid()) { hideTyping(); return; }
hideTyping();
}
m = addIn(rep.spell[si], {
quote: si === 0 ? quote : null,
qside: 'out',
qidx: (si === 0 && quote) ? quoteIdx : undefined,
type: 'text',
parts: si === rep.spell.length - 1 ? spellPartsSync(rep.spell[si], spellImgParts) : null,
silent: si > 0 ? true : (silent || willRetractR),
tag: '词典',
tagExtra: [{ tag: '词典逐卡连发', label: '' }],
tagNoDup: true
});
}
} else if (rep.mjFree) {
m = addIn(rep.text, {
quote: quote,
qside: 'out',
qidx: quote ? quoteIdx : undefined,
type: 'text',
parts: rep.parts,
silent: silent || willRetractR,
tag: '梦角自由造句',
tagExtra: pyMultiExtra,
tagNoDup: true
});
} else {
m = addIn(rep.text, { quote: quote, qside: 'out', qidx: quote ? quoteIdx : undefined, type: rep.type, parts: rep.parts, silent: silent || willRetractR, tag: pyMultiHit ? '多字卡回复' : undefined, tagNoDup: true });
}
const _favProbMsg = (window.favCfg ? window.favCfg().taMsg : 30);
if (lastMineText && Math.random() * 100 < _favProbMsg) {
const fav = getFav();
if (!fav.some(f => f.by === 'ta' && f.side === 'out' && f.text === lastMineText)) {
let favType = chatIsImgSrcLike(lastMineText) ? 'image' : 'text'; // FIX #948 统一判据（裸令牌/大写 MIME/前导空白不再当文字收藏）
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
try {
const tm = (window.tryTaMoodShare && window.tryTaMoodShare()) || null;
if (tm && tm.content) {
const tmTag = Math.random() * 100 < 10 ? '你的心情' : 'TA的心情';
setTimeout(() => {
if (!sameCid()) return;
addIn(tm.content, { initiative: true, tag: tmTag, tagNoDup: true });
}, randInt(1500, 3500));
}
} catch (e) {}
const chain = (window.triggerEmotionChain && window.triggerEmotionChain()) || null;
if (chain && chain.length) {
const typeName = { mood: '情绪', heart: '心意', intent: '交流意图' };
setTimeout(() => {
if (!sameCid() || !m) return;
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
try { window.periodCheckCare && window.periodCheckCare(); } catch (e) {}
}
if (willRetractR) {
setTimeout(() => {
if (!sameCid() || !m) return;
partialRetractMsg(m, 'in');
if (c['rc-en'] !== 0 && hit(c['rc-refix'])) {
showTyping();
setTimeout(() => { if (!sameCid()) return; hideTyping(); replyOnce(c, null); }, 600);
}
}, retractDelayMs());
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
document.addEventListener('mochi-restore-done', function () {
try { syncMicBtn(); } catch (e) {}
try { syncBatchBtn(); } catch (e) {}
try { if (window.applyContinueSayUI) window.applyContinueSayUI(); } catch (e) {}
});
const pAv = document.getElementById('chat-partner-av');
if (pAv) {
pAv.addEventListener('click', (e) => {
e.stopPropagation();
if (window.toggleCkPanel) window.toggleCkPanel();
else if (window.openCkPanel) window.openCkPanel();
});
}
const moreCk = document.getElementById('more-ck');
if (moreCk) {
moreCk.addEventListener('click', (e) => {
e.stopPropagation();
if (morePanel) morePanel.hidden = true;
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
function pyJoinCards(segs, c) {
if (!Array.isArray(segs) || !segs.length) return '';
if (segs.length === 1) return String(segs[0] == null ? '' : segs[0]);
let pool = null;
const pyJoinOn = !!(c && c['py-en'] === 1 && c['py-punct-en'] === 1); // #956a
if (pyJoinOn) {
pool = [];
if (c['py-punct-space'] === 1) pool.push(' ');
if (c['py-punct-dou'] === 1) pool.push('，');
if (c['py-punct-per'] === 1) pool.push('。');
if (c['py-punct-ex'] === 1) pool.push('！');
if (c['py-punct-q'] === 1) pool.push('？');
if (c['py-punct-el'] === 1) pool.push('......');
if (c['py-punct-dash'] === 1) pool.push('——'); // #712 内置「——」（默认开）
let pyc = null;
try { pyc = JSON.parse(c['py-punct-custom'] || '[]'); } catch (e) {}
if (Array.isArray(pyc)) pyc.forEach(it => { if (it && typeof it.s === 'string' && it.s && it.on === 1) pool.push(it.s); });
}
if (!pool || !pool.length) pool = [' '];
let out = String(segs[0] == null ? '' : segs[0]);
for (let i = 1; i < segs.length; i++) out += pool[Math.floor(Math.random() * pool.length)] + String(segs[i] == null ? '' : segs[i]);
return out;
}
window.pyJoinCards = pyJoinCards; // 各文件独立作用域：ta-ask.js 互动卡回应/文字题同源复用走 window
function pyChipSingleCardText(t, c) {
if (typeof t !== 'string' || !t.trim()) return true; // 空文/纯空白＝不是拼出来的多张
if (t.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(t))) return true; // 整条媒体载荷
let seps = null;
if (c && c['py-punct-en'] === 1) {
seps = [];
if (c['py-punct-space'] === 1) seps.push(' ');
if (c['py-punct-dou'] === 1) seps.push('，');
if (c['py-punct-per'] === 1) seps.push('。');
if (c['py-punct-ex'] === 1) seps.push('！');
if (c['py-punct-q'] === 1) seps.push('？');
if (c['py-punct-el'] === 1) seps.push('......');
if (c['py-punct-dash'] === 1) seps.push('——');
try { const pyc = JSON.parse(c['py-punct-custom'] || '[]'); if (Array.isArray(pyc)) pyc.forEach(it => { if (it && typeof it.s === 'string' && it.s && it.on === 1) seps.push(it.s); }); } catch (e) {}
if (!seps.length) seps = null;
}
if (!seps) seps = [' '];
else if (seps.indexOf(' ') < 0) seps.push(' ');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pieces = t.split(new RegExp(seps.map(esc).sort((a, b) => b.length - a.length).join('|')));
let n = 0;
for (let i = 0; i < pieces.length; i++) if (pieces[i].trim()) n++;
return n < 2;
}
function pyChipDropIfSingle(r) {
try {
if (!r || r.side !== 'in' || !Array.isArray(r.mood) || !r.mood.length) return false;
if (!r.mood.some(md => md && md.tag === '多字卡回复')) return false; // 先走最便宜的门禁，再读 cfg
if (!pyChipSingleCardText(r.text, cfg())) return false;
const kept = r.mood.filter(md => !(md && md.tag === '多字卡回复'));
r.mood = kept.length ? kept : undefined;
return true;
} catch (e) { return false; }
}
let pyMultiDrawn = false;
let __genLastCid = null, __genLastSig = '';
function chatGenRepSig(r) {
if (!r) return '';
let s = (r.type || '') + '|' + (typeof r.text === 'string' ? r.text : '');
try {
const ps = r.parts;
if (Array.isArray(ps)) for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (p && p.k === 'img') s += '|i:' + (p.sub || '') + ':' + (typeof p.v === 'string' ? p.v.slice(0, 96) : ''); }
} catch (e) {}
return s;
}
function genOneReply(c) {
let rep = genOneReplyDraw(c), sig = chatGenRepSig(rep);
try {
const cid = window.__activeCid || 'default';
if (sig && cid === __genLastCid && sig === __genLastSig) {
const rep2 = genOneReplyDraw(c), sig2 = chatGenRepSig(rep2);
if (sig2 && sig2 !== sig) { rep = rep2; sig = sig2; } // 池子太小仍掷不出第二张＝接受同款，不删已生成消息
}
__genLastCid = cid; __genLastSig = sig;
} catch (e) {}
return rep;
}
function genOneReplyDraw(c) {
const pool = getPool();
let t, type = 'text';
pyMultiDrawn = false;
if (c['py-en'] === 1 && hit(c['py-prob']) && pool.text.length) {
const nbTextPool = pool.text.filter(s => typeof s === 'string' && s.trim()); // FIX 2026-09-05 #185 多字卡拼接前先滤空白卡（否则 join 出纯空格空气泡）
const n = randInt(c['py-min'], c['py-max']);
const segs = pickN(nbTextPool.length ? nbTextPool : pool.text, n);
if (segs.length >= 2) pyMultiDrawn = true;
t = pyJoinCards(segs, c); // #650 中间连接符走「拼接随机标点」符号池（关＝空格，原样）
} else {
const r = genReplyText(c);
t = r.text;
type = r.type;
if (r.cards >= 2) pyMultiDrawn = true;
if (r.parts && r.parts.length) return { text: t, type: 'text', parts: r.parts };
}
if (type === 'sticker' || type === 'image' || type === 'voice') {
return { text: t, type: type };
}
const cspCust = Number(c['csp-cust'] !== undefined ? c['csp-cust'] : 50);
const keepCustomText = isFinite(cspCust) && hit(cspCust);
const defs = (window.getDefaultCards && window.getDefaultCards()) || null;
if (defs && !keepCustomText && defs.type === 'text' && defs.text) {
t = defs.text; pyMultiDrawn = false;
}
const replyWord = (window.getReplyCard && window.getReplyCard()) || '';
if (replyWord) {
t = replyWord; pyMultiDrawn = false; // FIX 2026-09-18 #773 同上：聊天回应字卡整条替换成一张
}
if (pyMultiDrawn && (typeof t !== 'string' || !t.trim())) pyMultiDrawn = false;
if (typeof t !== 'string' || !t.trim()) t = pick(FALLBACK_REPLY_POOL);
if (hit(window.dcpEff ? window.dcpEff(c['cf-prob']) : c['cf-prob'])) { // FIX 2026-09-15 #518 连接词追加套系统预设字卡总档
const w = (window.getFollowupWord && window.getFollowupWord(t)) || '';
if (w) { t += ' ' + w; pyMultiDrawn = true; }
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
window.genChatStyleReply = function () {
let rep = null;
try { rep = genOneReply(cfg()); } catch (e) {}
try {
const _sp = (window.quoteSpellPick && window.quoteSpellPick(cfg())) || null;
const segs = _sp && Array.isArray(_sp.segs) ? _sp.segs : (Array.isArray(_sp) ? _sp : null);
if (segs && segs.length) return pyJoinCards(segs, cfg()); // #650 连接符同走符号池
} catch (e) {}
const t = rep && typeof rep.text === 'string' ? rep.text.trim() : '';
const _isMediaRep = !!(rep && (rep.type === 'sticker' || rep.type === 'image' || rep.type === 'voice' ||
(rep.parts && rep.parts.length && chatIsMediaPayload(rep.text)) || chatIsMediaPayload(rep.text)));
return (t && !_isMediaRep) ? t : null;
};
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
const INVITE_DECLINE = ['下次吧，现在不太想玩~', '等会儿再陪你玩好不好', '先不玩啦，待会儿再说', '现在没状态，下次一定'];
const CUDDLE_DECLINE = ['下次再贴吧，先记着这笔~', '等会儿补给你，说话算数', '先欠着，攒到晚上一起还~', '今天想先自己待会儿，明天加倍还你'];
const CUDDLE_REPLIES = ['嗯……蹭到了。暖暖的，很喜欢。', '那我要贴很久哦，不许偷偷跑掉。', '手被握住了，就这样待一会儿。', '感觉到了，你在旁边。很安心。', '贴贴充电中……好，满格了。'];
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
function openInviteConfirm(title, staticText, onAccept, declinePool, onDecline) {
const mask = document.getElementById('modal-mask');
if ((mask && !mask.hidden) || !window.openModal) { onAccept(); return; }
window.openModal(title, '', (v) => {
if (v === '1') onAccept();
else if (typeof onDecline === 'function') onDecline();
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
try { addInTyped(name + ' ' + pick(CUDDLE_REPLIES)); } catch (e) {}
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
if (kind === 'snake') { if (window.openSnakePanel) window.openSnakePanel(); return; }
if (kind === 'gomoku') { if (window.openGomokuPanel) window.openGomokuPanel(); return; }
if (kind === 'linkup') { if (window.openLinkupPanel) window.openLinkupPanel(); return; }
if (kind === 'match3') { if (window.openMatch3Panel) window.openMatch3Panel(); return; }
if (kind === 'auction') { if (window.openAuctionPanel) window.openAuctionPanel(); return; }
}
const INVITE_KIND_META = {
rps: { title: '猜拳邀请' },
pong: { title: '游戏邀请' },
snake: { title: '游戏邀请' },
gomoku: { title: '游戏邀请' },
linkup: { title: '游戏邀请' },
match3: { title: '游戏邀请' },
auction: { title: '游戏邀请' },
cuddle: { title: '贴贴邀请' }
};
function sendTaInvite(inv, name) {
const meta = INVITE_KIND_META[inv && inv.kind] || INVITE_KIND_META.rps;
addIn(name + ' ' + (inv.text || ''), { special: 'poke', initiative: true, gInv: inv.kind });
showTyping();
setTimeout(() => {
hideTyping();
const _cuddleInv = inv.kind === 'cuddle';
openInviteConfirm(name + ' 的' + meta.title, name + ' ' + (inv.text || ''), () => {
if (_cuddleInv && window.chatAddSystem) window.chatAddSystem('你接受了 ' + name + ' 的贴贴邀请');
openInvitePanelFor(inv.kind, name);
}, _cuddleInv ? CUDDLE_DECLINE : null, _cuddleInv ? () => {
if (window.chatAddSystem) window.chatAddSystem('你拒绝了 ' + name + ' 的贴贴邀请');
addOut(pick(CUDDLE_DECLINE));
} : null);
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
else if (cfgn(c, 'ai-game-en', 1) === 1 && hit(cfgn(c, 'ai-game-prob', 5))) { // #301：邀请池扩到六款（原 pong/snake 二选一）
const GINV_POOL = [
{ kind: 'pong', text: '想和你玩一局 Pong，来吗？' },
{ kind: 'snake', text: '想和你玩双人贪吃蛇，来吗？' },
{ kind: 'gomoku', text: '想和你玩一局五子棋，来吗？' },
{ kind: 'linkup', text: '来玩连连看嘛，一起清完整张棋盘' },
{ kind: 'match3', text: '一起玩消消乐呀，冲个目标分' },
{ kind: 'auction', text: '拍卖会上新啦，来跟我抢拍品呀' }
];
inv = GINV_POOL[Math.floor(Math.random() * GINV_POOL.length)]; }
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
if (window.replyGuideHint) window.replyGuideHint('inv'); // v3.27.x #218 互动频率引导（邀请半框弹出时提醒可调）
return true;
} catch (e) { return false; }
};
window.triggerTaCuddleNow = function () {
try {
const name = chatPartnerName();
const inv = window.taInvitePickKind ? window.taInvitePickKind('cuddle') : null;
if (!inv || !inv.text) { toast('TA的邀请题库里没有可用的贴贴话术'); return false; }
sendTaInvite(inv, name);
if (window.replyGuideHint) window.replyGuideHint('inv');
return true;
} catch (e) { return false; }
};
window.tryActiveInvite = tryActiveInvite;
function tryAutoSend() {
try {
if (window.nightModeActive && window.nightModeActive()) { try { console.log('[mochi-auto] night mode, skip'); } catch(e){} return; }
const c = cfg();
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
(async () => {
try { await ensureReplyCardsReady(); } catch (e) {}
if (!sameAutoCid()) return; // FIX #187 取回期间已切桌面：池子是旧桌面的，整条主动消息放弃
const pool = getPool();
const autoMsg = () => {
try {
const defs = (window.getDefaultCards && window.getDefaultCards()) || null;
if (defs && defs.type !== 'poke' && defs.text) return { text: defs.text, type: 'text' };
} catch (e) {}
const _bands = [
[pool.sticker.length ? 15 : 0, () => ({ text: pick(pool.sticker), type: 'sticker' })],
[pool.image.length ? 10 : 0, () => ({ text: pick(pool.image), type: 'image' })],
[pool.kaomoji.length ? 15 : 0, () => ({ text: pick(pool.kaomoji), type: 'text' })],
[pool.emoji.length ? 15 : 0, () => ({ text: pick(pool.emoji), type: 'text' })],
[45, () => ({ text: pick(pool.text) || '在吗？', type: 'text' })]
];
let _bRoll = Math.random() * _bands.reduce((a, b) => a + b[0], 0);
for (let i = 0; i < _bands.length; i++) {
_bRoll -= _bands[i][0];
if (_bRoll < 0) return _bands[i][1]();
}
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
const willRetract = hit(c['rc-prob']);
const m = addIn(am.text, { type: am.type, initiative: true, silent: i > 0 || willRetract });
if (i === 0 && window.replyGuideHint) window.replyGuideHint('as'); // v3.27.x #218 互动频率引导（首条主动消息落地时提醒可调）
try { console.log('[mochi-auto] 主动发送消息: type=%s initiative=true retract=%s', am.type, willRetract); } catch(e){}
if (willRetract && m) {
setTimeout(() => {
if (!sameAutoCid()) return; // FIX #187
retractMsg(m, 'in');
if (c['rc-en'] !== 0 && hit(c['rc-refix'])) {
showTyping();
setTimeout(() => { if (!sameAutoCid()) return; hideTyping(); addIn(pick(pool.text) || '…', { initiative: true }); }, 600);
}
}, retractDelayMs());
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
let chatEntrySettleToken = 0;
function chatEntrySettle() {
if (!window.requestAnimationFrame) return;
const my = ++chatEntrySettleToken;
let lastH = body.scrollHeight;
const t0 = Date.now();
let alive = t0; // #841h：稳定窗「距最后一次长高 3s」滚动续期（真机图片解码/字体回填可拖到 2s+，固定 1.2s 必漏尾），8s 硬顶防异常空转
const tick = function () {
if (my !== chatEntrySettleToken || !chatVisible() || !chatPinnedBottom) return;
const h = body.scrollHeight;
if (h !== lastH) { lastH = h; scrollChatBottom(); alive = Date.now(); }
if (Date.now() - alive < 3000 && Date.now() - t0 < 8000) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
}
let chatHiddenAt = 0;
let chatResumeRepinT = null;
const CHAT_RESUME_FRESH_MS = 60000; // 离场超过此值＝长离场，回场视同重新进聊天
function chatResumeRepin() {
if (document.visibilityState !== 'visible' || !chatVisible()) return;
const gone = (typeof window.__chatHiddenAgeMs === 'number') ? window.__chatHiddenAgeMs : (chatHiddenAt ? Date.now() - chatHiddenAt : 0); // override 仅供 verify 脚本注入
if (gone > CHAT_RESUME_FRESH_MS) {
chatPinnedBottom = true;
body.classList.remove('scroll-anchor-auto');
}
if (!chatPinnedBottom) return;
if (chatResumeRepinT) clearTimeout(chatResumeRepinT);
chatResumeRepinT = setTimeout(function () {
chatResumeRepinT = null;
if (!chatVisible() || !chatPinnedBottom || batchRendering) return; // 回场期用户已翻页/已解钉＝不抢
chatResumeRealign(); // #978：回场贴底改「几何落定后同值重落一枪」——350ms 当场裸写正打在回场几何恢复风暴中段＝撕裂源
chatEntrySettle(); // #930 保留：迟到长高（懒加载图/字体回填）当帧回钉
}, 350);
}
let _rsResumeT = null;
let _rsResumeDeadline = 0;
function chatResumeRealign() {
if (_rsResumeT) return; // 已有一枪在膛：由它负责复查，不重复排队
_rsResumeDeadline = Date.now() + 3000;
_rsResumeT = setTimeout(chatResumeRealignStep, 120);
}
function chatResumeRealignStep() {
_rsResumeT = null;
const now = Date.now();
if (!chatVisible()) return;
if (!chatPinnedBottom) return; // #162：回场期用户已翻历史＝绝不拽底
if (!chatRepinQuietEnough(now)) { if (now < _rsResumeDeadline) _rsResumeT = setTimeout(chatResumeRealignStep, 120); return; }
if (chatPinnedBottom) scrollChatBottom(); // 同值重落：健康态重写同一个值；撕裂态＝强制内核滚动树重对齐
}
document.addEventListener('visibilitychange', function () {
if (document.visibilityState === 'hidden') { chatHiddenAt = Date.now(); if (chatResumeRepinT) { clearTimeout(chatResumeRepinT); chatResumeRepinT = null; } }
else chatResumeRepin();
});
window.addEventListener('pageshow', function (e) { if (e.persisted) chatResumeRepin(); }); // bfcache 恢复同闸（pageshow 时 visibilityState 已是 visible）
function chatEnterPaintThen(fn) {
let ran = false;
const run = function () { if (ran) return; ran = true; fn(); }; // 不吞异常：重活里抛错照旧冒到 window.onerror/__jsErrors（#939 口径），诊断链不断
if (!window.requestAnimationFrame) { setTimeout(run, 16); return; }
requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(run, 0); }); });
setTimeout(run, 120); // 保险丝：后台标签/页面不可见时 rAF 会被节流甚至不派发，重活不能因此不跑
}
function chatResumeRearmRead() {
try {
if (!chatVisible() || chatAuthSettled()) return;
stopChatAuthWatch();
loadMsgs(true);
} catch (e) {}
}
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') chatResumeRearmRead(); });
document.addEventListener('mochi-fg-resume', chatResumeRearmRead); // bg-keep 回前台统一信号（与 ta-ask/memo 同款通道）
window.addEventListener('pageshow', function (e) { if (e.persisted) chatResumeRearmRead(); });
function enterChat() {
document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
const phoneTab = document.querySelector('.tab[data-page="page-phone"]');
if (phoneTab) phoneTab.classList.add('active');
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #336 同值写也发 mutation，44 页全扫=唤醒全部页面观察器
chatPage.hidden = false;
chatPinnedBottom = true;
body.classList.remove('scroll-anchor-auto');
fillAvatar('chat-user-av', 'cs-avatar-user');
fillAvatar('chat-partner-av', 'cs-avatar-partner');
if (window.applyChatSettings) window.applyChatSettings();
clearChatUnread();
chatRebuilding = true; // #841i：进页即有一段「屏上还没有任何列表」的空窗（LS/权威异步读取、首帧未渲），进度条顶上，renderWindow 接手时由 #841e/f 交接、同步收尾就地交回
updateChatLoading(); // #703：先于 loadMsgs 置位——loadMsgs 里同步 parse LS 快照可能上百毫秒，先让进度条就位
chatEnterPaintThen(function () {
try { if (window.hydrateLibScopes) window.hydrateLibScopes(['own', 'public']); } catch (e) {}
loadMsgs();
if (inplacePatchIfSameWindow()) { chatRebuilding = false; updateChatLoading(); } // #841j：同窗补丁命中＝零重建无空窗，就地交回标志（不等 renderWindow 接手）
else renderWindow(false, true);
scrollToBottom();
if (window.requestAnimationFrame) {
requestAnimationFrame(scrollToBottom);
requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
}
chatEntrySettle();
if (typingOn && chatVisible()) {
typingEl.hidden = false; // FIX 2026-09-15 #514 进页同款：只切可见性、不写 scrollTop（上面三连已在行隐藏态贴到底）
}
schedulePanelPrewarm(2500);
}); // #1017 第二段（重活）结束
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
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #336 同值写也发 mutation，44 页全扫=唤醒全部页面观察器
phonePage.hidden = false;
}
});
}
const csOpenBtn = document.getElementById('chat-settings-btn');
const csPage = document.getElementById('page-chat-settings');
if (csOpenBtn && csPage) {
csOpenBtn.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #336 同值写也发 mutation，44 页全扫=唤醒全部页面观察器
csPage.hidden = false;
});
}
const csBack = document.getElementById('cs-back');
if (csBack) {
csBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #336 同值写也发 mutation，44 页全扫=唤醒全部页面观察器
chatPage.hidden = false;
});
}
const morePanel = document.getElementById('chat-more-panel');
const moreBtn = document.getElementById('chat-more-btn');
if (moreBtn && morePanel) {
const moreGridFun = document.getElementById('more-grid-fun');
const moreGridAsk = document.getElementById('more-grid-ask');
const MORE_CATS = ['chat', 'game', 'tool', 'ask'];
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
else it.hidden = it.dataset.mcat !== cat || (it.id === 'more-ck' && window.checkinEnabled && !window.checkinEnabled()); // #823 寻踪关闭时收起「更多功能」里的寻踪
});
}
if (!moreGroupMode) store.set('more-cat', cat);
}
window.applyMoreCat = applyMoreCat;
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
let pokeOpenClickGate = 0;
function pokeArmClickGate() { pokeOpenClickGate = performance.now() + 700; }
function pokeGateActive() { return pokeOpenClickGate > 0 && performance.now() < pokeOpenClickGate; }
function pokeDisarmClickGate() { pokeOpenClickGate = 0; }
if (pokeCard) {
pokeCard.addEventListener('click', (e) => {
if (!pokeGateActive()) return;
pokeDisarmClickGate();
e.preventDefault();
e.stopPropagation();
if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}, true);
pokeCard.addEventListener('focusin', (e) => {
if (!pokeGateActive()) return;
const t = e.target;
if (t && typeof t.blur === 'function') { try { t.blur(); } catch (err) {} }
}, true);
}
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
const pokeDirty = { ta: false, mine: false };
function pokeUserGroupsSave(kind) {
pokeDirty[kind] = true;
try {
const data = JSON.stringify(pokeUserGroups[kind]);
store.set('poke-groups-' + kind, data);
if (window.idbSet) window.idbSet(pokeUserGroupsKey(kind), data);
} catch (e) {}
}
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
function pokeTextOnly(x) {
if (typeof x !== 'string' || !x.trim()) return false;
if (x.indexOf('data:') === 0 || x.indexOf('|||') >= 0 || x.indexOf('@@m:') >= 0) return false;
if (/^https?:\/\//i.test(x)) return false;
return true;
}
function pokeAllCards() {
const out = [];
(POKE_PRESETS.ta || []).forEach(x => out.push(x));
(POKE_PRESETS.mine || []).forEach(x => out.push(x));
['ta', 'mine'].forEach(kind => {
(pokeUserGroups[kind] || []).forEach(g => {
if (Array.isArray(g) && Array.isArray(g[1])) g[1].forEach(x => { if (pokeTextOnly(x)) out.push(x); });
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
pokeCard.appendChild(pokeInputRow);
}
function sendPoke(action) {
if (!pokeTextOnly(action)) { toast('这条不是文字拍一拍，已跳过'); return; }
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
chatUserFollowScroll = true;
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
const rMulti = pyMultiDrawn;
const willRetractP = hit(c2['rc-prob']);
const m2 = addIn(r.text, { type: r.type, silent: willRetractP, tag: rMulti ? '多字卡回复' : undefined, tagNoDup: true });
if (willRetractP && m2) {
setTimeout(() => { retractMsg(m2, 'in'); }, retractDelayMs());
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
pokeList.innerHTML = ccPanelsFetching
? ccLoadRowHtml('正在加载拍一拍字卡…')
: (pokeMode === 'public'
? '<div class="cc-empty">暂无公用拍一拍<br>请到 字卡库 → 公用字卡 → 拍一拍 添加</div>'
: pokeMode === 'ta'
? '<div class="cc-empty">暂无拍一拍字卡<br>请到 字卡库 → 专属字卡 → 拍一拍 添加</div>'
: '<div class="cc-empty">暂无拍一拍字卡<br>在下方输入文字，点「存入」添加</div>');
return;
}
const cur = groups.find(g => g.key === pokeCurGroup) || groups[0];
if (!cur.cards.length) {
pokeList.innerHTML = ccPanelsFetching
? ccLoadRowHtml('正在加载该分组拍一拍…')
: (pokeMode === 'public'
? '<div class="cc-empty">该分组暂无公用拍一拍<br>请到 字卡库 → 公用字卡 → 拍一拍 添加</div>'
: pokeMode === 'ta'
? '<div class="cc-empty">该分组暂无拍一拍字卡<br>请到 字卡库 → 专属字卡 → 拍一拍 添加</div>'
: '<div class="cc-empty">该分组暂无拍一拍<br>在下方输入文字，点「存入」添加到该分组</div>');
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
const rpsFsBtn = document.getElementById('rps-fs');
let rpsIsFs = false;
function rpsToggleFs() {
if (!rpsPanel) return;
rpsIsFs = !rpsIsFs;
rpsPanel.classList.toggle('game-fs', rpsIsFs);
if (rpsFsBtn) rpsFsBtn.textContent = rpsIsFs ? '⤢' : '⛶';
}
if (rpsFsBtn) rpsFsBtn.addEventListener('click', (e) => { e.stopPropagation(); rpsToggleFs(); });
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
try { if (rpsIsFs) rpsToggleFs(); } catch (e) {}
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
const rpSettingsBtn = document.getElementById('rp-settings-btn');
const rpSettings = document.getElementById('rp-settings');
const rpSettingsDone = document.getElementById('rp-settings-done');
const rpScrollEl = rpPanel ? rpPanel.querySelector('.poke-card-scroll') : null;
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
closeRpSettings();
rpPanel.hidden = false;
}
function closeRpPanel() { if (rpPanel) rpPanel.hidden = true; closeRpSettings(); }
function openRpSettings() {
if (!rpSettings) return;
if (window.csRpSettingsSync) { try { window.csRpSettingsSync(); } catch (e) {} }
if (rpBalanceEl) rpBalanceEl.hidden = true;
if (rpScrollEl) rpScrollEl.hidden = true;
rpSettings.hidden = false;
}
function closeRpSettings() {
if (!rpSettings) return;
rpSettings.hidden = true;
if (rpBalanceEl) rpBalanceEl.hidden = false;
if (rpScrollEl) rpScrollEl.hidden = false;
}
if (rpSettingsBtn) rpSettingsBtn.addEventListener('click', (e) => { e.stopPropagation(); openRpSettings(); });
if (rpSettingsDone) rpSettingsDone.addEventListener('click', (e) => { e.stopPropagation(); closeRpSettings(); });
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
function rpLocalDay() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function rpGameCoinGrant(gameKey, fen, capFen) {
if (!fen || fen <= 0) return 0;
const k = 'ml2_coin_' + gameKey + '_' + rpLocalDay();
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
function rpPatchStatusInPlace(idx) {
const rec = msgs[idx];
if (!rec || rec.special !== 'redpacket') return false;
if (!body) return false;
const el = body.querySelector('.msg-rp[data-idx="' + idx + '"]');
if (!el) return false;
const card = el.querySelector('.msg-rp-card');
if (!card) return false;
card.classList.remove('opened', 'expired');
const cls = rpStatusCls(rec);
if (cls) card.classList.add(cls);
const st = card.querySelector('.msg-rp-status');
if (st) st.textContent = rpStatusText(rec);
return true;
}
function rpDailyMax() {
try { const v = parseInt(store.get('cs-rp-daily-max'), 10); if (isFinite(v) && v >= 0) return v; } catch (e) {}
return 5;
}
function trySystemAutoSend() {
if (rpDailyCount() >= rpDailyMax()) return;
let baseRate = 0.04;
try { const ap = window.activeStore ? window.activeStore().get('cs-rp-auto-prob') : null; const pv = parseFloat(ap); if (pv !== null && isFinite(pv)) baseRate = Math.max(0, Math.min(100, pv)) / 100; } catch (e) {}
const qixi = isQixiToday();
if (qixi) baseRate *= 2;
if (Math.random() >= baseRate) return;
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
function rpAskProbRate() {
let v = NaN;
try { v = parseFloat(store.get('cs-rp-ask-prob')); } catch (e) {}
if (isFinite(v)) return Math.max(0, Math.min(100, v)) / 100;
try { const p = JSON.parse((window.xyStore('xy-home-v2')).get('piggy-coin-prob') || 'null'); if (p && typeof p.ask === 'number') return Math.max(0, Math.min(1, p.ask)); } catch (e) {}
return 0.04;
}
function rpAskDailyMax() {
let v = NaN;
try { v = parseInt(store.get('cs-rp-ask-daily-max'), 10); } catch (e) {}
if (isFinite(v) && v >= 0) return v;
try { const g = parseInt((window.xyStore('xy-home-v2')).get('piggy-coin-ask-limit'), 10); if (isFinite(g) && g >= 0) return g; } catch (e) {}
return 0;
}
window.rpAskProbRate = rpAskProbRate;
window.rpAskDailyMax = rpAskDailyMax;
function trySystemAskMochi() {
const askMax = rpAskDailyMax();
if (askMax > 0 && askDailyCount() >= askMax) return;
if (Math.random() >= rpAskProbRate()) return;
const amtFen = genRpAmount(5200000);
if (amtFen < 1) return;
askDailyIncr();
const wallet = rpWalletGet();
wallet.systemBalance += amtFen;
rpWalletSet(wallet);
try { if (window.giftCoinLedgerAdd) window.giftCoinLedgerAdd('ask', 0, amtFen, 'TA自动申请'); } catch (e) {}
const myCid = window.__activeCid || 'default';
setTimeout(() => {
if ((window.__activeCid || 'default') !== myCid) return;
addRec({ side: 'in', special: 'askcoin', askFen: amtFen, askTs: Date.now() });
saveMsgsNow();
}, randInt(800, 2400));
}
document.addEventListener('mochi-fg-resume', function () {
try { setTimeout(function () { trySystemAskMochi(); }, randInt(2000, 6000)); } catch (e) {}
});
function rpThanksMsg() {
return pick(['谢谢亲爱的～', '收到啦❤', '嘿嘿谢谢宝宝', '爱你哟', '🥰 谢谢', '开心！谢谢～', '么么哒']);
}
function rpThxInMsg() {
return pick(['被你领走啦～', '就知道你会手快', '嘿嘿，被你抢到了', '我的红包还合口味吗', '领了我的红包，说点好听的～', '手速可以呀😉']);
}
function rpCollectFeedback(dir) {
let mode = 2;
try {
const c = cfg();
if (Number(c['rp-thx-en']) !== 1) return;
let prob = Number(c['rp-thx-prob']);
if (!isFinite(prob)) prob = 60;
if (Math.random() * 100 >= Math.max(0, Math.min(100, prob))) return;
mode = Number(c['rp-thx-mode']);
if (mode !== 0 && mode !== 1) mode = 2;
} catch (e) {}
const myCid = window.__activeCid || 'default';
if (mode === 0 || (mode === 2 && Math.random() < 0.6)) {
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; addIn(dir === 'in' ? rpThxInMsg() : rpThanksMsg(), { silent: true }); }, randInt(600, 1800));
} else {
setTimeout(() => {
if ((window.__activeCid || 'default') !== myCid) return;
try {
const c = cfg();
const rep = genOneReply(c);
addInTyped(rep.text, { type: rep.type, parts: rep.parts, tag: pyMultiDrawn ? '多字卡回复' : undefined, tagNoDup: true });
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
if (!rpPatchStatusInPlace(idx)) renderWindow(false, true); // FIX 2026-09-07 #230 红包状态流转不整窗重建（闪屏）
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; addIn('TA 退回了你的红包（心意币 ¥' + Number(rec.rpAmount || 0).toFixed(2) + '）', { special: 'poke' }); }, randInt(500, 1200));
} else if (r < 0.9) {
rec.rpStatus = 'received';
rec.rpOpenedAt = Date.now();
wallet.systemBalance += amtFen;
rpWalletSet(wallet);
saveMsgsNow();
if (!rpPatchStatusInPlace(idx)) renderWindow(false, true); // FIX 2026-09-07 #230 红包状态流转不整窗重建（闪屏）
const amtTxt = '（心意币 ¥' + Number(rec.rpAmount || 0).toFixed(2) + '）';
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; addIn('TA 领取了你的红包' + amtTxt, { special: 'poke' }); }, randInt(400, 1000));
rpCollectFeedback('out');
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
if (!rpPatchStatusInPlace(idx)) renderWindow(false, true); // FIX 2026-09-07 #230 红包状态流转不整窗重建（闪屏）
const amtTxt = '（心意币 ¥' + Number(rec.rpAmount || 0).toFixed(2) + '）';
const myCid = window.__activeCid || 'default';
setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; addIn('TA 领取了你的红包' + amtTxt, { special: 'poke' }); }, randInt(400, 1000));
rpCollectFeedback('out');
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
window.mochiFilePick({
id: 'mochi-rp-cover-pick', accept: 'image/*', btn: rpCoverUploadBtn,
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到图片，请再选一次'); return; }
const reader = new FileReader();
reader.onload = () => {
rpCompressCover(reader.result).then(data => {
if (!data) { toast('图片处理失败'); return; }
rpCoverSet(rpSide, data);
rpRenderCover();
toast('封面已设置');
});
};
reader.onerror = () => toast('图片读取失败，请换一张再试');
reader.readAsDataURL(f);
}
});
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
bindTaNow('more-cuddle-now', () => { if (window.triggerTaCuddleNow) window.triggerTaCuddleNow(); });
bindTaNow('more-ck-now', () => { if (window.triggerCkQuestion) window.triggerCkQuestion(); });
bindTaNow('more-xck-now', () => { if (window.triggerIncomingCheckinNow) window.triggerIncomingCheckinNow(); });
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
const optsWrap = document.createElement('div');
optsWrap.className = 'dec-inp-wrap chat-ask-opts-wrap';
optsWrap.hidden = true;
const opts = document.createElement('textarea');
opts.id = 'chat-ask-opts';
opts.className = 'chat-ask-opts';
opts.rows = 3;
opts.placeholder = '单选题选项：每行一个；可写 选项~TA回应，TA会选一个并用该回应回复';
opts.hidden = true;
const optsClear = document.createElement('button');
optsClear.type = 'button';
optsClear.className = 'dec-inp-clear';
optsClear.dataset.clear = 'chat-ask-opts';
optsClear.setAttribute('aria-label', '清空');
optsClear.setAttribute('title', '清空');
optsClear.textContent = '✕';
optsWrap.appendChild(opts);
optsWrap.appendChild(optsClear);
optsClear.addEventListener('click', (e) => {
if (e) e.stopPropagation();
const box = opts.__ceBox;
if (box) box.textContent = '';
else opts.value = '';
opts.focus();
toast('已清空');
});
const actions = askBody.querySelector('.chat-ask-actions');
if (actions) { askBody.insertBefore(typeRow, actions); askBody.insertBefore(optsWrap, actions); }
else { askBody.appendChild(typeRow); askBody.appendChild(optsWrap); }
const syncOptsHidden = () => {
const show = chatAskType === 'single';
optsWrap.hidden = !show;
opts.hidden = !show;
if (opts.__ceBox) opts.__ceBox.style.display = show ? 'block' : 'none';
else if (optsWrap.querySelector('.ce-box')) optsWrap.querySelector('.ce-box').style.display = show ? 'block' : 'none';
const obox = opts.__ceBox || optsWrap.querySelector('.ce-box') || opts;
try { obox.style.transform = show ? 'translateZ(0)' : ''; } catch (e) {}
};
typeRow.querySelectorAll('.chat-ask-type-btn').forEach(btn => {
btn.addEventListener('click', () => {
chatAskType = btn.dataset.atype === 'single' ? 'single' : 'text';
typeRow.querySelectorAll('.chat-ask-type-btn').forEach(b => b.classList.toggle('sel', b === btn));
syncOptsHidden();
askBoxes().forEach(({ box }) => {
if (!askBoxNeedsLayerFix(box)) return; // #538：原生输入框不进整页 reflow
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
const wrap = opts.parentElement && opts.parentElement.classList && opts.parentElement.classList.contains('chat-ask-opts-wrap') ? opts.parentElement : null;
if (wrap) wrap.hidden = true;
if (opts.__ceBox) opts.__ceBox.style.display = 'none';
else if (opts.previousElementSibling && opts.previousElementSibling.classList && opts.previousElementSibling.classList.contains('ce-box')) opts.previousElementSibling.style.display = 'none';
}
}
function askThinkSecsLoad() {
try { const n = parseInt(store.get('ask-think-secs'), 10); return (n >= 1 && n <= 10) ? n : 3; } catch (e) { return 3; }
}
function ensureChatAskThinkRow() {
if (!chatAskPanel) return;
const askBody = chatAskPanel.querySelector('.chat-ask-body');
if (!askBody) return;
let row = chatAskPanel.querySelector('.chat-ask-think-row');
if (!row) {
row = document.createElement('div');
row.className = 'gs-row chat-ask-think-row';
row.innerHTML = '<span>思考时间（秒）</span><div class="stepper" id="chat-ask-think" data-min="1" data-max="10" data-step="1"><button type="button" class="stp-min">−</button><input class="stp-val" id="chat-ask-think-val" readonly><button type="button" class="stp-max">+</button></div>';
const actions = askBody.querySelector('.chat-ask-actions');
if (actions) askBody.insertBefore(row, actions); else askBody.appendChild(row);
const val = row.querySelector('.stp-val');
const clampSave = () => {
let n = parseInt(val.value, 10);
if (!(n >= 1 && n <= 10)) n = 3;
val.value = n;
store.set('ask-think-secs', String(n));
};
row.querySelector('.stp-min').addEventListener('click', (e) => { if (e) e.stopPropagation(); val.value = (parseInt(val.value, 10) || 3) - 1; clampSave(); });
row.querySelector('.stp-max').addEventListener('click', (e) => { if (e) e.stopPropagation(); val.value = (parseInt(val.value, 10) || 3) + 1; clampSave(); });
}
row.hidden = chatAskMode !== 'ask';
row.querySelector('.stp-val').value = askThinkSecsLoad();
}
function askBoxes() {
const arr = [chatAskInput, document.getElementById('chat-ask-opts')];
return arr.filter(Boolean).map(el => ({ inp: el, box: el.__ceBox || el }));
}
function askBoxNeedsLayerFix(box) { try { return !!(box && box.__ceInp); } catch (e) { return false; } }
function applyAskComposeLayers() {
askBoxes().forEach(({ box }) => {
if (!askBoxNeedsLayerFix(box)) return;
try { box.style.transform = 'translateZ(0)'; box.style.willChange = 'transform'; } catch (e) {}
});
}
function clearAskComposeLayers() {
askBoxes().forEach(({ box }) => {
if (!askBoxNeedsLayerFix(box)) return;
try { box.style.transform = ''; box.style.willChange = ''; } catch (e) {}
});
}
let askKbRefreshStop = null;
function startAskKbRefresh() {
if (askKbRefreshStop) return;
if (!askBoxes().some(({ box }) => askBoxNeedsLayerFix(box))) return;
const vv = window.visualViewport;
if (!vv) return;
let t = null;
const refresh = () => {
if (t) clearTimeout(t);
t = setTimeout(() => {
t = null;
askBoxes().forEach(({ box }) => {
if (!askBoxNeedsLayerFix(box)) return; // #538：原生输入框不进整页 reflow
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
ensureChatAskThinkRow();
resetChatAskType();
if (chatAskTitle) chatAskTitle.textContent = chatAskMode === 'invite' ? '邀请TA' : '问问TA';
if (chatAskInput) {
chatAskInput.placeholder = chatAskMode === 'invite' ? '想邀请TA做什么？' : '你的问题？';
chatAskInput.value = '';
}
const invGroups = document.getElementById('invite-groups');
const invList = document.getElementById('invite-list');
const invSave = document.getElementById('chat-ask-save');
const isInvite = chatAskMode === 'invite';
if (invGroups) invGroups.hidden = !isInvite;
if (invList) invList.hidden = !isInvite;
if (invSave) invSave.hidden = !isInvite;
const bulkBtn = document.getElementById('chat-ask-bulk');
if (bulkBtn) bulkBtn.hidden = isInvite;
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
function askDismissIme() {
try { askBoxes().forEach(({ box }) => { try { if (box && box.blur) box.blur(); } catch (e) {} }); } catch (e) {}
closeIme(); // 兜底：面板之外仍聚焦的输入框（主聊天输入栏等）一并收起
if (window.mochiKbDismiss) { try { window.mochiKbDismiss(); } catch (e) {} }
}
function closeChatAskPanel() {
if (askKbRefreshStop) { try { askKbRefreshStop(); } catch (e) {} }
clearAskComposeLayers();
askDismissIme();
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
const askRecTs = (msgs[askIdx] && msgs[askIdx].special === 'ask') ? msgs[askIdx].ts : 0;
const locateAsk = () => {
if (askRecTs) {
for (let i = msgs.length - 1; i >= 0; i--) { const r = msgs[i]; if (r && r.special === 'ask' && r.ts === askRecTs && r.askStatus !== 'answered') return i; }
}
if (msgs[askIdx] && msgs[askIdx].special === 'ask' && msgs[askIdx].askStatus !== 'answered') return askIdx;
return -1;
};
if (window.logFish) window.logFish();
const recTs = Date.now();
const myCid = window.__activeCid || 'default';
const sameCid = () => (window.__activeCid || 'default') === myCid;
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
setTimeout(() => {
if (!sameCid()) {
window.chatDeskCardReply(myCid, 'ask', askRecTs, 'askStatus', function (rec) { rec.askStatus = 'answered'; rec.askAnswer = text; }, [{ side: 'in', text: text }], applyAskAnswer);
try { window.chatDeskHistPush(myCid, { type: 'ask', q: content, a: text, ts: recTs }); } catch (err) {}
return;
}
function applyAskAnswer() {
const i = locateAsk();
const rec = i >= 0 ? msgs[i] : null;
if (rec) {
rec.askStatus = 'answered';
rec.askAnswer = text;
saveMsgs();
saveMsgsNow(); // v3.26.x #489：回答即落盘（同 chatAskReply 先例），切桌面 flush 前不止内存一份
const el = body.querySelector('.msg-ask[data-idx="' + i + '"]');
if (el) {
el.innerHTML = '<div class="msg-ask-card answered"><div class="msg-ask-q">' + (window.taFit ? window.taFit('问问TA') : '问问TA') + ' · ' + escTxt(content) + '</div><div class="msg-ask-a">✓ ' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(text) : text) + '</div>' + favHeartHtml(rec) + '</div>';
}
}
addInTyped(text);
try {
const list = JSON.parse(store.get('invite-ask-history') || '[]');
if (!list.some(x => x && x.ts === recTs)) {
list.unshift({ type: 'ask', q: content, a: text, ts: recTs });
if (list.length > 200) list.length = 200;
store.set('invite-ask-history', JSON.stringify(list));
}
} catch (err) {}
if (window.renderAskRecords) window.renderAskRecords();
setTimeout(() => { if (!sameCid()) return; maybeFollowupAskCard(); }, 1200);
}
applyAskAnswer();
}, askThinkSecsLoad() * 1000); // #809：思考时间用户可调（1~10 秒），默认 3 秒；原 1500+rand*2500
}
}
function sendInviteContent(content) {
closeChatAskPanel();
addRec({ side: 'out', text: '邀请：' + content, special: 'invite', inviteContent: content, inviteStatus: 'pending' });
const inviteIdx = msgs.length - 1;
const inviteRecTs = (msgs[inviteIdx] && msgs[inviteIdx].special === 'invite') ? msgs[inviteIdx].ts : 0;
const locateInvite = () => {
if (inviteRecTs) {
for (let i = msgs.length - 1; i >= 0; i--) { const r = msgs[i]; if (r && r.special === 'invite' && r.ts === inviteRecTs && r.inviteStatus !== 'answered') return i; }
}
if (msgs[inviteIdx] && msgs[inviteIdx].special === 'invite' && msgs[inviteIdx].inviteStatus !== 'answered') return inviteIdx;
return -1;
};
if (window.logFish) window.logFish();
const histKey = 'invite-ask-history';
const recTs = Date.now();
const myCid = window.__activeCid || 'default';
const sameCid = () => (window.__activeCid || 'default') === myCid;
const myName = chatPartnerName();
const roll = Math.random();
let status, answer, reply = null;
if (roll < 0.6) {
status = '接受';
answer = myName + ' 接受了你的邀请';
const pool = window.getInteractPool
? window.getInteractPool('邀请TA·接受', ['好，我答应你。', '可以呀。', '我陪你。', '走吧。', '嗯，陪你。'])
: ['好，我答应你。', '可以呀。', '我陪你。', '走吧。', '嗯，陪你。'];
reply = (window.pickAskCardReply ? window.pickAskCardReply(pool) : pool[Math.floor(Math.random() * pool.length)]);
} else if (roll < 0.85) {
status = '拒绝';
answer = myName + ' 拒绝了你的邀请';
const pool = window.getInteractPool
? window.getInteractPool('邀请TA·拒绝', ['这次不行。', '下次吧。', '抱歉。', '今天不方便。'])
: ['这次不行。', '下次吧。', '抱歉。', '今天不方便。'];
reply = (window.pickAskCardReply ? window.pickAskCardReply(pool) : pool[Math.floor(Math.random() * pool.length)]);
} else {
status = '未回应';
answer = myName + ' 暂时没有回应';
}
setTimeout(() => {
if (!sameCid()) {
window.chatDeskCardReply(myCid, 'invite', inviteRecTs, 'inviteStatus', function (rec) { rec.inviteStatus = 'answered'; rec.inviteAnswer = answer; }, reply ? [{ side: 'in', text: reply }] : [], applyInviteResult);
try { window.chatDeskHistPush(myCid, { type: 'invite', q: content, a: reply || status, ts: recTs }); } catch (err) {}
return;
}
function applyInviteResult() {
const i = locateInvite();
const rec = i >= 0 ? msgs[i] : null;
if (rec) {
rec.inviteStatus = 'answered';
rec.inviteAnswer = answer;
saveMsgs();
saveMsgsNow(); // v3.26.x #489：结果即落盘，切桌面 flush 前不止内存一份
taFavCard(rec);
const el = body.querySelector('.msg-ask[data-idx="' + i + '"]');
if (el) {
el.innerHTML = '<div class="msg-ask-card answered"><div class="msg-ask-q">' + (window.taFit ? window.taFit('邀请TA') : '邀请TA') + ' · ' + escTxt(content) + '</div><div class="msg-ask-a">✓ ' + escTxt(window.taFit ? window.taFit(answer) : answer) + '</div>' + favHeartHtml(rec) + '</div>';
}
}
if (reply) addInTyped(reply, null, randInt(800, 1400));
try {
const list = JSON.parse(store.get(histKey) || '[]');
if (!list.some(x => x && x.ts === recTs)) {
list.unshift({ type: 'invite', q: content, a: reply || status, ts: recTs });
if (list.length > 200) list.length = 200;
store.set(histKey, JSON.stringify(list));
}
} catch (err) {}
if (window.renderAskRecords) window.renderAskRecords();
setTimeout(() => { if (!sameCid()) return; maybeFollowupAskCard(); }, 1200);
}
applyInviteResult();
}, 1500 + Math.random() * 2500);
}
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
window.mochiSheetOutsideClose = function (panel, close) {
if (!panel || typeof close !== 'function') return;
let openedAt = 0;
try {
if (window.MutationObserver) new MutationObserver(() => { if (!panel.hidden) openedAt = Date.now(); })
.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
} catch (e) {}
document.addEventListener('click', (e) => {
if (panel.hidden) return;
if (Date.now() - openedAt < 400) return;
const t = e.target;
if (!t || panel.contains(t)) return;
if (t.closest && t.closest('.modal-mask')) return;
close();
});
};
[['chat-divine-panel', () => { if (chatDivinePanel) chatDivinePanel.hidden = true; }],
['chat-ask-panel', () => closeChatAskPanel()],
['chat-search', () => closeChatSearch()],
['chat-rps-panel', () => closeRpsPanel()],
['chat-rp-panel', () => closeRpPanel()]].forEach((s) => {
window.mochiSheetOutsideClose(document.getElementById(s[0]), s[1]);
});
const chatAskBulkBtn = document.getElementById('chat-ask-bulk');
if (chatAskBulkBtn) chatAskBulkBtn.addEventListener('click', (e) => {
if (e) e.stopPropagation();
closeChatAskPanel();
if (window.openAskSurvey) window.openAskSurvey();
else toast('批量问卷加载失败');
});
const chatAskClearBtn = document.querySelector('#chat-ask-panel .dec-inp-clear[data-clear="chat-ask-input"]');
if (chatAskClearBtn) chatAskClearBtn.addEventListener('click', (e) => {
if (e) e.stopPropagation();
if (!chatAskInput) return;
const box = chatAskInput.__ceBox;
if (box) box.textContent = '';
else chatAskInput.value = '';
chatAskInput.focus();
toast('已清空');
});
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
const isImg = chatIsInlineDataSrc(r.txt) || (window.mochiMediaIsToken && window.mochiMediaIsToken(r.txt)); // #148 令牌化图片消息搜索结果不直出令牌串；#948 内联载荷判定收口统一口径
const isVc = typeof r.txt === 'string' && /\|\|\|(?:data:audio\/|@@m:[0-9a-f]{32})/.test(r.txt);
const label = isVc ? ('[语音] ' + r.txt.split('|||')[0]) : (isImg ? '[图片]' : (r.txt.length > 60 ? r.txt.slice(0, 60) + '…' : r.txt));
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
try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
requestAnimationFrame(() => requestAnimationFrame(() => {
if (!jumpToMsg(idx)) body.scrollTop = body.scrollHeight;
}));
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
window.openChatCallPanel = openChatCall;
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
try {
const snkWinFen = Math.random() < 0.2 ? 5200 : 1314;
const snkMult = (window.arcadeMult && window.arcadeMult('snake')) || 1;
const real = rpGameCoinGrant('snake', (d.result === 'draw' ? 520 : snkWinFen) * snkMult, 10400);
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
function hydrateCcForChatPanels(done) {
try {
if (window.libScopesDeferred && window.hydrateLibScopes &&
window.libScopesDeferred(['public', 'own'])) {
try { toast('字卡较多，正在加载…'); } catch (e) {}
ccPanelsFetching = true;
window.hydrateLibScopes(['public', 'own'], function () {
ccPanelsFetching = false;
try { if (done) done(); } catch (e) {}
});
try { if (done) done(); } catch (e) {} // 立即重渲一次：把当前空态换成加载占位
return true;
}
} catch (e) {}
return false;
}
var ccPanelsFetching = false; // var：避开「函数先于 let 执行」的 TDZ 风险（历史事故族）
var myeLoading = false;
function ccLoadRowHtml(txt) {
return '<div class="mochi-load-row"><span class="mochi-spin"></span>' + txt + '</div>';
}
function openPokeCard(fromGesture) {
if (!pokeCard) return;
pokeAdoptAllRerender(); // 慢 IDB（iOS 挂后台杀连接）下 restore-done 兜底可能落空，开面板再补一次
const ep = document.getElementById('emoji-panel');
if (ep) ep.hidden = true;
if (window.closeAvlib) window.closeAvlib();
if (fromGesture) pokeArmClickGate();
pokeCard.hidden = false;
if (morePanel) morePanel.hidden = true;
closeIme(); // v3.5.116：收起输入法，面板不被键盘遮挡
if (pokeInput) { pokeInput.value = ''; try { pokeInput.blur(); } catch (e) {} }
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
let activeMsgSnap = null; // FIX 2026-09-13 #407：菜单打开时的消息身份快照（防 msgs 重排后 data-idx 错位）
let activeSide = 'in';    // 当前操作消息方向
let lastQuote = null;     // 待引用内容
function getFav() { try { return JSON.parse(store.get('fav-msgs') || '[]'); } catch (e) { return []; } }
function saveFav(list) { store.set('fav-msgs', JSON.stringify(list)); try { scheduleFavImgPass(2500); } catch (e) {} }
function favItemKey(f) {
return (f.by || 'me') + '|' + (f.kind || 'msg') + '|' + (f.ts || 0) + '|' +
String(f.q || '').slice(0, 120) + '|' + String(f.text || '').slice(0, 120) + '|' +
(f.special || '') + '|' + (f.mailType || '') + '|' + ((f.side === 'out') ? 'o' : 'i');
}
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
if (f && typeof f.text === 'string' && f.text.length > 1024) {
const _bi = f.text.indexOf('|||');
if (_bi > 0 && f.text.indexOf('data:audio/', _bi + 3) === _bi + 3) {
const t = await window.mochiMediaTokenize(f.text.slice(_bi + 3));
if (t) { f = Object.assign({}, f, { text: f.text.slice(0, _bi + 3) + t }); changed = true; }
}
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
if (++_favImgPassRetries < 5) { scheduleFavImgPass(5000); return false; }
return true;
}
_favImgPassRetries = 0;
store.set('fav-msgs', JSON.stringify(out));
return true;
} catch (e) { return true; }
}
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
if (special === 'ask-choose') { q = rec.choiceQuestion || rec.text || ''; mine = rec.choiceAnswer || ''; ta = askCardReplyClean(rec.choiceReply || ''); }
else if (special === 'ask-curious') { q = rec.curiousQuestion || rec.text || ''; mine = rec.curiousAnswer || ''; ta = askCardReplyClean(rec.curiousReply || ''); }
else if (special === 'ask-roast') { q = rec.roastText || rec.text || ''; mine = rec.roastAnswer || ''; ta = askCardReplyClean(rec.roastReply || ''); }
else if (special === 'ask-card') { q = rec.askQuestion || rec.text || ''; mine = rec.askAnswer || ''; ta = askCardReplyClean(rec.askReply || ''); }
else if (special === 'invite') { q = rec.inviteContent || ''; ta = askCardReplyClean(rec.inviteAnswer || ''); }
else if (special === 'ask') { q = rec.askQuestion || rec.text || ''; mine = rec.askAnswer || ''; ta = askCardReplyClean(rec.askReply || ''); }
else if (special === 'redpacket') { mine = (rec.side === 'out' ? '我发出' : chatPartnerName() + '发出'); q = '红包 ¥' + Number(rec.rpAmount || 0).toFixed(2) + (rec.rpWish ? ' · ' + rec.rpWish : ''); }
else if (special === 'flower') { q = (rec.flName || '花') + (rec.flWish ? '：' + rec.flWish : ''); }
else if (special === 'gift') { q = (rec.giftName || '礼物') + (rec.giftWish ? '：“' + rec.giftWish + '”' : '') + (rec.giftPrice != null ? ' · ¥' + Number(rec.giftPrice || 0).toFixed(2) : ''); }
else if (special === 'dish') { q = (rec.dishName || '菜肴') + (rec.dishWish ? '：“' + rec.dishWish + '”' : '') + (rec.dishPrice != null ? ' · ¥' + Number(rec.dishPrice || 0).toFixed(2) : ''); }
else if (special === 'wish') { q = (rec.wishGiftName || '礼物') + '（' + chatPartnerName() + '的心愿）' + (rec.wishGiftPrice != null ? ' · ¥' + Number(rec.wishGiftPrice || 0).toFixed(2) : ''); }
else if (special === 'ask-survey') {
const sqs = Array.isArray(rec.surveyQs) ? rec.surveyQs : [];
const sans = Array.isArray(rec.surveyAnswers) ? rec.surveyAnswers : [];
const qarr = sqs.slice(0, 99).map(sq => {
const it = { t: String((sq && sq.text) || '').slice(0, 120) };
if (sq && Array.isArray(sq.options) && sq.options.length) it.o = sq.options.slice(0, 12).map(o => String(o).slice(0, 60));
return it;
});
q = '问卷 · ' + sqs.length + ' 题' + (qarr.length && qarr[0].t ? '：' + qarr[0].t : '');
return { kind: 'card', special: special, q: q, mine: '', ta: '', ts: rec.ts || Date.now(),
qarr: qarr, aarr: sans.slice(0, 99).map(a => String(a || '').slice(0, 300)) };
}
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
if (msgActions && typeof msgActions.__maFollowStop === 'function') { try { msgActions.__maFollowStop(); } catch (e) {} } // FIX 2026-09-16 #642 摘跟随监听
if (msgActions) msgActions.hidden = true;
activeMsgEl = null;
activeMsgSnap = null; // FIX 2026-09-13 #407 随菜单关闭清身份快照
}
function quoteTextOf(m) {
const isMedia = (s) => typeof s === 'string' && (chatIsInlineDataSrc(s) || /^https?:\/\//i.test(s) || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))); // FIX #948 内联载荷判定收口到统一口径（大小写/前导空白不敏感）
const qi = (m.parts || []).filter(p => p.k === 'img').map(p => p.v).slice(0, 3);
if (!qi.length && (m.type === 'sticker' || m.type === 'image')
&& isMedia(m.text)) {
qi.push(m.text);
}
let qt = m.text;
if (m.type === 'voice') qt = '[语音] ' + String(qt || '').split('|||')[0];
else if (m.type === 'sticker') qt = '表情包';
else if (qi.length && isMedia(String(qt || ''))) qt = '图片';
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
if (!target) {
if (idx < renderStart) {
renderStart = Math.max(0, idx - JUMP_VIEW);
renderWindow(true, false);
} else if (idx >= renderEnd && idx < msgs.length) {
const limit = msgs.length;
while (renderEnd <= idx && renderEnd < limit) {
loadNewerIncremental(Math.min(idx + JUMP_VIEW + 1, limit));
}
}
target = body.querySelector('.msg[data-idx="' + idx + '"]');
}
if (!target) return false;
unpinChatAndAnchor(); // FIX 2026-09-11 #334：跳转=用户定位历史浏览，与手动上翻同权解除贴底钉住——钉住态下旧区 lazy 图 onload 触发 #162 图片补滚把视图拽回底部，搜索/引用跳转表现「点了没反应」
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
let msgHoldTimer = null;
let msgHoldEl = null;
let msgHoldFired = false;
let msgSuppressClickUntil = 0;
let msgHoldX = 0, msgHoldY = 0; // FIX 2026-09-14 #G2 长按起始触点，判断是否算滑动
window.mochiFollowActionBar = function (bar, anchor, onClose) {
if (!bar) return null;
let raf = 0;
let vv = window.visualViewport;
function place() {
if (bar.hidden) return;
if (!anchor || !anchor.isConnected) { stop(); if (onClose) onClose(); return; }
const b = anchor.getBoundingClientRect();
const v = window.visualViewport || vv;
const vw = v ? v.width : window.innerWidth;
const vh = v ? v.height : window.innerHeight;
const aw = bar.offsetWidth || 200;
const ah = bar.offsetHeight || 50;
let x = b.left + b.width / 2 - aw / 2;
x = Math.max(10, Math.min(vw - aw - 10, x));
let y = b.top - ah - 8;
const belowY = b.bottom + 8;
const aboveFits = y >= 50;
const belowFits = belowY + ah <= vh - 8;
y = aboveFits || !belowFits ? y : belowY;
bar.style.left = x + 'px';
bar.style.top = y + 'px';
const m = bar.getBoundingClientRect();
const _maDx = x - m.left, _maDy = y - m.top;
if (_maDx < -1 || _maDx > 1 || _maDy < -1 || _maDy > 1) {
bar.style.left = (x + _maDx) + 'px';
bar.style.top = (y + _maDy) + 'px';
}
}
function stop() {
if (raf) { cancelAnimationFrame(raf); raf = 0; }
if (vv) { vv.removeEventListener('resize', req); vv.removeEventListener('scroll', req); }
window.removeEventListener('resize', req);
window.removeEventListener('scroll', req, true);
bar.__maFollowStop = null;
}
const req = () => {
if (bar.hidden || bar.__maFollowStop !== stop) return;
if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); });
};
if (typeof bar.__maFollowStop === 'function') { try { bar.__maFollowStop(); } catch (e) {} }
if (vv) { vv.addEventListener('resize', req); vv.addEventListener('scroll', req); }
window.addEventListener('resize', req);
window.addEventListener('scroll', req, true);
bar.__maFollowStop = stop;
return place;
};
function msgActionEligible(t) {
const b = t.closest('.msg-bubble');
if (!b) return null;
if (t.closest('.msg-voice-play')) return null;
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
let _qi = (item && item.dataset && item.dataset.idx !== undefined) ? Number(item.dataset.idx) : -1;
const _mk = (item && item.dataset && item.dataset.mk) || '';
let _qr = (_qi >= 0 && msgs[_qi]) ? msgs[_qi] : null;
if (_mk) {
const _j = msgs.findIndex(mkMsg => msgKeyOf(mkMsg) === _mk);
if (_j >= 0) { _qi = _j; _qr = msgs[_j]; }
}
activeMsgSnap = { idx: _qi, rec: _qr, mk: _mk, ts: _qr ? (_qr.ts || 0) : 0, side: _qr ? (_qr.side || '') : '', text: _qr ? String(_qr.text || '').slice(0, 80) : '' };
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
const _maPlace = window.mochiFollowActionBar(msgActions, b, closeMsgActions);
if (_maPlace) _maPlace();
}
function resolveActiveMsg() {
const idx0 = activeMsgEl && activeMsgEl.dataset && activeMsgEl.dataset.idx !== undefined ? Number(activeMsgEl.dataset.idx) : -1;
const snap = activeMsgSnap;
if (idx0 >= 0 && msgs[idx0]) {
if (!snap || msgs[idx0] === snap.rec) return { idx: idx0, rec: msgs[idx0] };
}
if (snap && snap.rec) {
const i = msgs.indexOf(snap.rec);
if (i >= 0) return { idx: i, rec: snap.rec };
}
if (snap && (snap.ts || snap.text || snap.side)) {
let hit = -1, hits = 0;
for (let i = 0; i < msgs.length; i++) {
const m = msgs[i];
if (!m || (m.ts || 0) !== snap.ts || (m.side || '') !== snap.side) continue;
if (String(m.text || '').slice(0, 80) !== snap.text) continue;
hit = i; hits++;
if (hits > 1) break;
}
if (hits === 1 && hit >= 0) return { idx: hit, rec: msgs[hit] };
}
return (idx0 >= 0 && msgs[idx0]) ? { idx: idx0, rec: msgs[idx0] } : { idx: -1, rec: null };
}
body.addEventListener('contextmenu', (e) => {
if (e.target.closest('.msg-bubble') && !e.target.closest('.msg-quote')) {
e.preventDefault();
const ctxR = msgActionEligible(e.target);
if (ctxR) {
if (msgHoldTimer) { clearTimeout(msgHoldTimer); msgHoldTimer = null; }
msgSuppressClickUntil = Date.now() + 800;
if (!msgActions || msgActions.hidden || activeMsgEl !== ctxR.item) {
msgHoldFired = true;
openMsgActionsAt(ctxR.item, ctxR.b);
}
}
}
});
let msgTapStart = null; // FIX 2026-09-14 #480 轻点布点——气泡 touch 直驱开菜单入口（click 被吞族内核唯一可靠路）
let msgAnyTap = null;   // FIX 2026-09-14 #480 全局轻点布点——点外关闭菜单的 touch 路
body.addEventListener('touchstart', (e) => {
const r = msgActionEligible(e.target);
const mt0 = e.touches && e.touches[0];
if (mt0) { msgHoldX = mt0.clientX; msgHoldY = mt0.clientY; }
msgAnyTap = { x: msgHoldX, y: msgHoldY, t: Date.now() };
if (!r) { msgTapStart = null; return; }
msgTapStart = { x: msgHoldX, y: msgHoldY, t: Date.now(), item: r.item, b: r.b };
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
body.addEventListener('touchmove', (e) => {
if (msgHoldTimer && e.touches && e.touches[0]) {
const mt = e.touches[0];
const mdx = mt.clientX - msgHoldX;
const mdy = mt.clientY - msgHoldY;
if (mdx * mdx + mdy * mdy > 144) { endMsgHold(); msgTapStart = null; msgAnyTap = null; }
}
}, { passive: true });   // 手指滑动=滚动，取消长按（超过 12px 才算滑动）
body.addEventListener('touchend', (e) => {
endMsgHold();
const mt = e.changedTouches && e.changedTouches[0];
if (!msgAnyTap || !mt) { msgTapStart = null; return; }
if (Date.now() - msgAnyTap.t > 450 || (mt.clientX - msgAnyTap.x) * (mt.clientX - msgAnyTap.x) + (mt.clientY - msgAnyTap.y) * (mt.clientY - msgAnyTap.y) > 144) { msgTapStart = null; msgAnyTap = null; return; } // 滑动/长按不算轻点
const ts = msgTapStart; msgTapStart = null; msgAnyTap = null;
if (ts) {
msgSuppressClickUntil = Date.now() + 800; // 吞引擎补发 click，防刚开即关/防重入
if (msgActions && !msgActions.hidden && activeMsgEl === ts.item) return; // 该气泡菜单已开，不重开
openMsgActionsAt(ts.item, ts.b);
return;
}
if (msgActions && !msgActions.hidden && !msgActions.contains(e.target) && !e.target.closest('.msg-bubble') && !e.target.closest('.msg-quote')) {
msgSuppressClickUntil = Date.now() + 800;
closeMsgActions();
}
});
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
let maClickGuard = 0;
function maRunAction(btn) {
const act = btn.dataset.act;
const _act = resolveActiveMsg();
const idx = _act.idx;
const rec = _act.rec;
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
if (fav.some(f => (f.by || 'me') !== 'ta' && f.side === rec.side && (f.text || '') === (rec.text || '') && (!rec.ts || f.ts === rec.ts))) {
toast('已收藏过这条消息');
} else {
fav.push({ side: rec.side, text: rec.text, type: rec.type || 'text', ts: rec.ts || Date.now(), by: 'me', mood: (rec.mood || []).slice(), parts: rec.parts && rec.parts.length ? rec.parts.map(p => ({ k: p.k, v: p.v, sub: p.sub })) : undefined });
saveFav(fav);
toast('已收藏到我的收藏');
}
}
closeMsgActions();
} else if (act === 'copy') {
if (rec) {
const qsnap = quoteTextOf(rec);
const _copyRaw = (window.mochiMediaExpand && window.mochiMediaExpand(qsnap.text)) || qsnap.text;
const _copyTxt = (_copyRaw || '').trim();
if (!_copyTxt || _copyRaw.indexOf('data:') === 0) {
toast('该消息没有可复制的文字');
} else {
try {
const ta = document.createElement('textarea');
ta.value = _copyTxt;
ta.setAttribute('readonly', '');
ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
document.body.appendChild(ta);
try { ta.select(); } catch (e) {}
let ok = false;
try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
window.mochiKillCopySelection && window.mochiKillCopySelection(ta); // 防安卓原生全选条卡屏（device.js #261 同款）
setTimeout(function () { try { document.body.removeChild(ta); } catch (e2) {} }, 800);
if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(_copyTxt).then(() => toast('已复制')).catch(() => toast('复制失败'));
} else {
toast(ok ? '已复制' : '复制失败');
}
} catch (e) { toast('复制失败'); }
}
}
closeMsgActions();
} else if (act === 'retract') {
if (activeMsgEl) retractMsg(activeMsgEl, 'out', idx);
closeMsgActions();
} else if (act === 'edit') {
if (rec && window.openModal) {
const orig = rec.text;
const _origMedia = (window.mochiMediaExpand && window.mochiMediaExpand(orig)) || null;
const editEl = activeMsgEl;
window.openModal('编辑消息', (_origMedia || orig.indexOf('data:') === 0) ? '' : orig, (v) => {
const val = (v || '').trim();
if (!val) return;
rec.text = val;
rec.type = 'text';
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
}
msgActions.addEventListener('click', (e) => {
const btn = e.target.closest('.ma-btn');
if (!btn) return;
if (Date.now() < maClickGuard) return; // #480 touchend 已直驱执行，吞补发 click 防双跑
maRunAction(btn);
});
msgActions.addEventListener('touchend', (e) => {
const btn = e.target.closest('.ma-btn');
if (!btn || btn.hidden) return;
e.preventDefault();
maClickGuard = Date.now() + 600; // 吞引擎补发 click 防双跑
maRunAction(btn); // touch 直驱执行——不依赖内核从 touch 合成 click
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
let favBatchSel = [];   // #314 批量模式选中的 favItemKey 指纹（跨重渲染稳定，不再存对象引用）
let favBatchArr = null; // 当次渲染使用的收藏数组引用（批量删除直接改它，避免重复 getFav 解析导致引用失效）
let favBatchVis = [];   // 当前 tab+分类筛选下可见条目（全选用）
const FAV_KINDS = [
{ k: 'all', label: '全部', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>' },
{ k: 'msg', label: '聊天', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>' },
{ k: 'card', label: '互动', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 14h4"/></svg>' },
{ k: 'mail', label: '信件', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' },
{ k: 'feed', label: '朋友圈', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9.5" r="2.2"/><path d="M14.5 19c0-2 2-3.5 4-3.5s2.5 1.5 2.5 3.5"/></svg>' }
];
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
favBatchArr = fav;
favBatchVis = list2;
if (favBatch) {
const visKeys = new Set(list2.map(favItemKey));
favBatchSel = favBatchSel.filter(k => visKeys.has(k));
}
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
'ask-card': '问问TA', 'invite': '邀请TA', 'ask': '问问TA', 'ask-survey': '问卷',
'redpacket': '红包', 'flower': '送花', 'gift': '礼物', 'dish': '佳肴'
};
function favTextHtml(s) {
const str = String(s || '');
let html = '';
const re = /((?:sticker|image):)?(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+|@@m:[0-9a-f]{32})/g;
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
if (f.special === 'ask-survey' && Array.isArray(f.qarr) && f.qarr.length) {
const aarr = Array.isArray(f.aarr) ? f.aarr : [];
html += '<div style="text-align:left;display:flex;flex-direction:column;gap:8px;margin-top:2px">' + f.qarr.map((x, i) => {
let r = '<div><div style="font-size:12px;font-weight:600;color:var(--ink);line-height:1.5;word-break:break-word">' + (i + 1) + '. ' + escTxt((x && x.t) || '') + '</div>';
if (x && Array.isArray(x.o) && x.o.length) r += '<div style="font-size:11px;color:var(--muted);margin-top:2px;word-break:break-word">选项：' + escTxt(x.o.join(' / ')) + '</div>';
if (aarr[i]) r += '<div class="fav-item-a" style="margin-top:2px;word-break:break-word">TA：' + escTxt(aarr[i]) + '</div>';
return r + '</div>';
}).join('') + '</div>';
} else {
if (f.mine) html += '<div class="fav-item-a">✓ 我：' + escTxt(f.mine) + '</div>';
if (f.ta) html += '<div class="fav-item-r">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escTxt(window.taFit ? window.taFit(askCardReplyClean(f.ta)) : askCardReplyClean(f.ta)) + '</div>'; // #648g 存量收藏快照的媒体卡回应同样清洗
if (!f.mine && !f.ta) html += '<div class="fav-item-tip">等待回应…</div>';
}
html += '</div>';
m.innerHTML = html + side;
fillAvatar(m.querySelector('.msg-av'), 'cs-avatar-user');
} else if (kind === 'mail') {
const tag = f.mailType === 'received' ? '信箱来信' : '信箱回信';
let html = '<div class="fav-item-card">' +
'<span class="fav-item-tag">' + tag + (f.title ? ' · 《' + escTxt(f.title) + '》' : '') + '</span>' +
'<div class="fav-item-body">' + favTextHtml(f.text) + '</div>' +
'</div>';
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
if (textPart) inner += '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(textPart) : escTxtBr(textPart)) + '</span>';
b.innerHTML = inner;
b.querySelectorAll('.msg-img-big').forEach(img => {
img.addEventListener('click', (e) => {
e.stopPropagation();
if (window.viewChatImage) window.viewChatImage(img.src);
});
});
} else {
const looksVoice = typeof f.text === 'string' &&
(f.text.indexOf('|||') >= 0 && (chatIsDataAudioSrc(f.text.split('|||')[1] || '') || /@@m:[0-9a-f]{32}$/.test(f.text))) || chatIsDataAudioSrc(f.text); // FIX #948 判据大小写/空白不敏感
const isVoice = looksVoice;
const isImg = !isVoice && (f.type === 'sticker' || f.type === 'image' || chatIsImgSrcLike(f.text)); // FIX #948 同口径
if (isVoice) {
b.style.padding = '8px 10px';
fillVoiceBubble(b, f.text);
} else if (isImg) {
b.style.padding = '6px';
b.innerHTML = '<img class="msg-img" src="' + attrEsc(f.text) + '" alt="表情">';
} else {
b.innerHTML = '<span style="opacity:.85">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(f.text) : escTxtBr(f.text)) + '</span>'; // FIX 2026-09-13 #394 收藏单条文本内嵌令牌转图
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
if (favBatch) {
const fk = favItemKey(f); // #314 勾选身份=指纹 key（对象引用跨重渲染必失配）
const ck = document.createElement('div');
ck.className = 'fav-check' + (favBatchSel.indexOf(fk) >= 0 ? ' on' : '');
ck.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
if (f.side === 'out') m.appendChild(ck); else m.insertBefore(ck, m.firstChild);
m.addEventListener('click', (e) => {
e.stopPropagation();
const i = favBatchSel.indexOf(fk);
if (i >= 0) favBatchSel.splice(i, 1); else favBatchSel.push(fk);
ck.classList.toggle('on', favBatchSel.indexOf(fk) >= 0);
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
m.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true }); // #721 处理体只清定时器，被动化免低端机列表滚动被主线程阻塞
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
favBatchSel = all ? [] : favBatchVis.map(favItemKey); // #314 存指纹 key，不存对象引用
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
const selKeys = new Set(favBatchSel);
if (favBatchArr) {
for (let i = favBatchArr.length - 1; i >= 0; i--) {
if (selKeys.has(favItemKey(favBatchArr[i]))) favBatchArr.splice(i, 1);
}
}
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
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #336 同值写也发 mutation，44 页全扫=唤醒全部页面观察器
favPage.hidden = false;
renderFav();
});
}
const favBack = document.getElementById('fav-back');
if (favBack) {
favBack.addEventListener('click', () => {
favBatch = false; // v3.31.x 离开收藏页退出批量模式
favBatchSel = [];
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #336 同值写也发 mutation，44 页全扫=唤醒全部页面观察器
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
let emojiTextModeApplies = false;
const MYE_G_PREFIX = 'xy-home-v2';
function myEmojiStore() { return window.xyStore(MYE_G_PREFIX); }
function MYE_KEY() { return MYE_G_PREFIX + ':my-emoji-groups'; }
function taStickerHidden() {
try { if (window.xyStore) return window.xyStore(MYE_G_PREFIX).get('hide-ta-sticker') === '1'; } catch (e) {}
try { return store.get('hide-ta-sticker') === '1'; } catch (e) { return false; }
}
myGroups = myEmojiLoad();
let emojiCat = 'sticker';           // 面板第一级分类
let myTextGroups = { kaomoji: [], emoji: [] }; // 我的文字库（全局键 my-text-groups，与 my-emoji-groups 同为跨桌面共用）
let myTextBatch = false;            // 文字库批量管理模式
let myTextSel = new Set();          // 文字库批量勾选：分组名\u0001索引
let myTextHydrated = false;         // 本会话是否已从 IDB 取回过 my-text-groups
let textCurGroupMap = {};           // '分类\u0001作用域' -> 当前分组名（公用/专属可能同名，按作用域分键）
let emojiCatBar = null;             // 分类行 DOM（懒建一次）
let emojiTextTools = null;          // 文字库工具行 DOM（懒建一次）
let mytBatchBtn = null;
const MYT_KEY = MYE_G_PREFIX + ':my-text-groups';
function textCatHidden(cat) {
try { return window.xyStore(MYE_G_PREFIX).get(cat === 'kaomoji' ? 'hide-tab-kaomoji' : 'hide-tab-emoji') === '1'; } catch (e) {}
return false;
}
function textCurKey() { return emojiCat + '\u0001' + emojiMode; }
function textCurGroup() { return textCurGroupMap[textCurKey()] || ''; }
function textCurSet(v) { textCurGroupMap[textCurKey()] = v || ''; }
function textCatLabel() { return emojiCat === 'kaomoji' ? '颜文字' : (emojiCat === 'emoji' ? 'emoji' : '表情包'); }
const TEXTCARD_DIRECT_KEY = 'chat-textcard-direct';
function textCardDirectMode() {
try { if (window.xyStore) return window.xyStore(MYE_G_PREFIX).get(TEXTCARD_DIRECT_KEY) === '1'; } catch (e) {}
try { return store.get(TEXTCARD_DIRECT_KEY) === '1'; } catch (e) { return false; }
}
try { window.textCardDirectMode = textCardDirectMode; } catch (e) {}
function insertTextToChatInput(t) {
const el = document.getElementById('chat-input');
if (!el || typeof t !== 'string' || !t) return;
el.textContent = (el.textContent || '') + t;
try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
}
function myTextOf() { if (!Array.isArray(myTextGroups[emojiCat])) myTextGroups[emojiCat] = []; return myTextGroups[emojiCat]; }
function myTextLoad() {
try { const v = JSON.parse(myEmojiStore().get('my-text-groups') || 'null'); if (v && typeof v === 'object') { myTextGroups.kaomoji = Array.isArray(v.kaomoji) ? v.kaomoji : []; myTextGroups.emoji = Array.isArray(v.emoji) ? v.emoji : []; } } catch (e) {}
}
function myTextSave() { try { myEmojiStore().set('my-text-groups', JSON.stringify(myTextGroups)); } catch (e) {} }
myTextLoad();
function textScopeGroups() {
if (emojiMode === 'mine') return myTextOf();
return ((window.getScopedGroups && window.getScopedGroups(emojiCat, emojiMode === 'public' ? 'public' : 'own')) || []);
}
function reloadMyTextFromIdb() {
if (myTextHydrated || !window.idbGet) return;
myTextHydrated = true;
window.idbGet(MYT_KEY).then(v => {
if (!v) return;
try {
const p = JSON.parse(v);
if (!p || typeof p !== 'object') return;
const pk = Array.isArray(p.kaomoji) ? p.kaomoji : [], pe = Array.isArray(p.emoji) ? p.emoji : [];
if (pk.length + pe.length > myTextGroups.kaomoji.length + myTextGroups.emoji.length) {
myTextGroups.kaomoji = pk; myTextGroups.emoji = pe;
try { if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel(); } catch (e) {}
}
} catch (e) {}
}).catch(() => {});
}
function ensureEmojiCatBar() {
if (emojiCatBar || !emojiPanel) return;
const head = emojiPanel.querySelector('.emoji-head');
if (!head || !head.parentNode) return;
emojiCatBar = document.createElement('div');
emojiCatBar.className = 'emoji-cats';
[['sticker', '表情包'], ['kaomoji', '颜文字'], ['emoji', 'emoji']].forEach(([cat, label]) => {
const c = document.createElement('button');
c.className = 'emoji-cat-chip';
c.type = 'button';
c.dataset.ecat = cat;
c.textContent = label;
c.addEventListener('click', (e) => {
e.stopPropagation();
if (emojiCat === cat) return;
emojiCat = cat;
myTextBatch = false;
myTextSel.clear();
saveEmojiGroupPref();
renderEmojiPanel();
try { c.blur(); } catch (err) {}
});
emojiCatBar.appendChild(c);
});
head.parentNode.insertBefore(emojiCatBar, head.nextSibling);
}
let emojiTextModeBar = null;
function setTextCardDirectMode(en) {
try { if (window.xyStore) { window.xyStore(MYE_G_PREFIX).set(TEXTCARD_DIRECT_KEY, en ? '1' : '0'); return; } } catch (e) {}
try { store.set(TEXTCARD_DIRECT_KEY, en ? '1' : '0'); } catch (e) {}
}
function ensureEmojiTextModeBar() {
if (emojiTextModeBar || !emojiCatBar || !emojiCatBar.parentNode) return;
const exist = emojiPanel && emojiPanel.querySelector('#emoji-text-mode-btn');
if (exist) { emojiTextModeBar = exist; return; }
const b = document.createElement('button');
b.id = 'emoji-text-mode-btn';
b.type = 'button';
b.className = 'emoji-text-mode';
b.addEventListener('click', (e) => {
e.stopPropagation();
const next = !textCardDirectMode();
setTextCardDirectMode(next);
renderEmojiTextModeBar();
try { toast(next ? '已切换：点颜文字/emoji 直接发出' : '已切换：点颜文字/emoji 先填进输入栏，发不发由你定'); } catch (err) {}
try { b.blur(); } catch (err) {}
});
emojiCatBar.parentNode.insertBefore(b, emojiCatBar.nextSibling);
emojiTextModeBar = b;
}
function renderEmojiTextModeBar() {
if (!emojiTextModeBar) return;
emojiTextModeBar.hidden = emojiCat === 'sticker' || !!(emojiInsertCb && !emojiTextModeApplies);
if (emojiTextModeBar.hidden) return;
const on = textCardDirectMode();
emojiTextModeBar.innerHTML =
on
? '<span class="etm-main">当前：点一下直接发送</span><span class="etm-sub">点这里切换为「先填进输入栏」，发不发由你点「发送」定</span>'
: '<span class="etm-main">当前：点一下填进输入栏</span><span class="etm-sub">可连点多条，点「发送」才发出；点这里切换为「直接发送」</span>';
}
function ensureEmojiTextTools() {
if (emojiTextTools || !emojiPanel) return;
const tools = emojiPanel.querySelector('.emoji-tools');
if (!tools || !tools.parentNode) return;
emojiTextTools = document.createElement('div');
emojiTextTools.id = 'emoji-text-tools'; // 快照/回归脚本按 id 定位
emojiTextTools.className = 'emoji-tools';
emojiTextTools.hidden = true;
const importBtn = document.createElement('button');
importBtn.className = 'emoji-tool';
importBtn.type = 'button';
importBtn.textContent = '批量导入';
mytBatchBtn = document.createElement('button');
mytBatchBtn.className = 'emoji-tool';
mytBatchBtn.type = 'button';
mytBatchBtn.textContent = '批量管理';
emojiTextTools.appendChild(importBtn);
emojiTextTools.appendChild(mytBatchBtn);
tools.parentNode.insertBefore(emojiTextTools, tools);
importBtn.addEventListener('click', (e) => { e.stopPropagation(); openMyTextImport(); });
mytBatchBtn.addEventListener('click', (e) => {
e.stopPropagation();
myTextBatch = !myTextBatch;
myTextSel.clear();
renderEmojiPanel();
});
}
function openMyTextImport() {
if (!window.openModal) return;
const catName = textCatLabel();
const fallbackGroup = textCurGroup() || '常用';
window.openModal('批量导入' + catName + '（一行一个）', '', (raw, targetGroup) => {
const lines = String(raw || '').split(/\r?\n|\u2028|\u2029|\u0085/).map(s => s.replace(/[\u200b-\u200f\ufeff]/g, '').trim()).filter(Boolean);
if (!lines.length) { toast('没有可导入的内容（一行一个）'); return; }
const groups = myTextOf();
let newGroups = 0, added = 0, dup = 0, firstBucket = '';
const buckets = {};
const resolveBucket = (name) => {
if (!buckets[name]) {
let g = groups.find(x => x[0] === name);
if (!g) { g = [name, []]; groups.unshift(g); newGroups++; }
buckets[name] = { g: g, seen: new Set(g[1]) };
if (!firstBucket) firstBucket = name;
}
return buckets[name];
};
lines.forEach(line => {
const m = /^【([^】]+)】\s*([\s\S]+)$/.exec(line);
const val = (m ? m[2] : line).trim();
if (!val) { dup++; return; }
const b = resolveBucket(m ? m[1] : (targetGroup || fallbackGroup));
if (b.seen.has(val)) { dup++; return; }
b.seen.add(val);
b.g[1].push(val);
added++;
});
myTextSave();
if (added) { textCurSet(firstBucket); saveEmojiGroupPref(); }
renderEmojiPanel();
toast(added ? '已导入 ' + added + ' 个' + catName + (dup ? '，跳过 ' + dup + ' 行（重复/空行）' : '') + (newGroups ? '，新建 ' + newGroups + ' 个分组' : '') : '没有新增（全部重复或为空）');
}, {
textarea: true,
textareaPlaceholder: '一行一个，可粘贴多个批量导入\n可用【分组名】前缀指定分组，如：【开心】(｡♥‿♥｡)\n不写前缀进「' + fallbackGroup + '」分组',
groups: myTextOf().map(g => g[0])
});
}
function saveEmojiGroupPref() {
store.set('emoji-last', JSON.stringify({ mode: emojiMode, ta: emojiCurGroup, mine: myCurGroup, pub: pubCurGroup, cat: emojiCat, tg: textCurGroupMap }));
}
function loadEmojiPref() {
try {
const pref = JSON.parse(store.get('emoji-last') || 'null');
if (pref && typeof pref === 'object') {
if (pref.mode === 'public' || pref.mode === 'ta' || pref.mode === 'mine') emojiMode = pref.mode;
if (typeof pref.ta === 'string') emojiCurGroup = pref.ta;
if (typeof pref.mine === 'string') myCurGroup = pref.mine;
if (typeof pref.pub === 'string') pubCurGroup = pref.pub;
if (pref.cat === 'sticker' || pref.cat === 'kaomoji' || pref.cat === 'emoji') emojiCat = pref.cat;
if (pref.tg && typeof pref.tg === 'object') textCurGroupMap = pref.tg;
if (emojiCat !== 'sticker' && textCatHidden(emojiCat)) emojiCat = 'sticker'; // #636：上次停在的分类已被隐藏则回表情包
}
} catch (e) {}
}
loadEmojiPref();
function myEmojiLoad() {
try {
const raw = myEmojiStore().get('my-emoji-groups');
const v = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw;
if (Array.isArray(v)) return v;
} catch (e) {}
return [];
}
function myeApplyIdb(v) {
try {
const data = typeof v === 'string' ? JSON.parse(v) : v;
if (!Array.isArray(data)) return false;
const cnt = (g) => { let n = 0; g.forEach(x => n += (Array.isArray(x[1]) ? x[1].length : 0)); return n; };
const lc = Array.isArray(myGroups) ? cnt(myGroups) : -1;
if (lc < 0 || cnt(data) > lc) {
myGroups = data;
if (!emojiPanel.hidden) renderEmojiPanel();
}
window.__myeIdbApplied = true;
return true;
} catch (e) { return false; }
}
function myeHydrateFallback() {
if (!window.idbHydrateKey) return;
myeLoading = true;
try { if (emojiPanel && !emojiPanel.hidden && emojiMode === 'mine') renderEmojiPanel(); } catch (e) {}
window.idbHydrateKey(MYE_KEY()).then(ok => {
myeLoading = false;
try { const raw = myEmojiStore().get('my-emoji-groups'); if (ok === true && raw) myeApplyIdb(raw); } catch (e) {}
try { if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel(); } catch (e) {}
});
}
function myeSaveJson() { try { return JSON.stringify(myGroups || []); } catch (e) { return '[]'; } }
const MYE_DIRECT_LIMIT = 2 * 1024 * 1024;
function myeBytesEst() {
try {
let n = 0;
(myGroups || []).forEach(g => {
if (!g || typeof g !== 'object') { n += 32; return; }
n += String(g[0] || '').length + 64;
const a = g[1];
if (Array.isArray(a)) a.forEach(s => { n += (typeof s === 'string' ? s.length : 64) + 8; });
else n += 64;
});
return n;
} catch (e) { return 0; }
}
function myePersist() {
if (myeBytesEst() > MYE_DIRECT_LIMIT && window.idbSet) {
try { window.idbSet(MYE_KEY(), myGroups || []); } catch (e) {}
try { if (window.idbMemoSet) window.idbMemoSet(MYE_KEY(), myGroups || []); } catch (e2) {}
return;
}
myEmojiStore().set('my-emoji-groups', myeSaveJson());
}
let myeDurableTimer = null;
let myeDurablePending = false;
let myeDurableWarned = false;
let myeGateRetry = 0;
function myeEnsureDurable(tries) {
if (!window.idbSet) return;
clearTimeout(myeDurableTimer);
const val = myeBytesEst() > MYE_DIRECT_LIMIT ? (myGroups || []) : myeSaveJson();
window.idbSet(MYE_KEY(), val).then(ok => {
if (ok) { myeDurablePending = false; myeDurableWarned = false; return; }
myeDurablePending = true;
if (tries < 5) { myeDurableTimer = setTimeout(function () { myeEnsureDurable(tries + 1); }, 1500 * (tries + 1)); return; }
if (!myeDurableWarned) {
myeDurableWarned = true;
try { toast('表情包暂时没能写入本机存储，稍后回到本页会自动补写；重要表情请尽快导出备份'); } catch (e0) {}
}
});
}
function myeDurableFlush() {
try { if (myeSaveTimer) { clearTimeout(myeSaveTimer); myeSaveTimer = null; myEmojiSaveNow(); } } catch (e0) {}
if (myeDurablePending) myeEnsureDurable(0);
}
(function () {
try {
document.addEventListener('visibilitychange', myeDurableFlush);
window.addEventListener('pagehide', myeDurableFlush);
} catch (e) {}
})();
var myeSaveTimer = null;
function myEmojiSave() {
if (myeSaveTimer) clearTimeout(myeSaveTimer);
myeSaveTimer = setTimeout(function () { myeSaveTimer = null; myEmojiSaveNow(); }, 600);
return true;
}
function myEmojiSaveNow() {
if (window.idbHydrateKey &&
(window.__myeIdbApplied !== true ||
(window.__xyIdbDeferredKeys && window.__xyIdbDeferredKeys.indexOf(MYE_KEY()) >= 0))) {
window.idbHydrateKey(MYE_KEY()).then(ok => {
if (ok === false) {
myeDurablePending = true;
if (!myeDurableWarned) {
myeDurableWarned = true;
try { toast('表情包正在后台补写，请稍等几秒再退出本页'); } catch (e1) {}
}
if ((myeGateRetry || 0) < 4) { myeGateRetry = (myeGateRetry || 0) + 1; setTimeout(myEmojiSave, 1500 * myeGateRetry); }
return;
}
if (ok === true) {
try {
const rawGate = myEmojiStore().get('my-emoji-groups');
const full = typeof rawGate === 'string' ? JSON.parse(rawGate || 'null') : (rawGate || null);
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
window.__myeIdbApplied = true;
myeGateRetry = 0;
try { if (window.__mochiPhase) window.__mochiPhase('emoji-groups'); } catch (e0) {}
myePersist();
myeEnsureDurable(0);
});
return true;
}
try { if (window.__mochiPhase) window.__mochiPhase('emoji-groups'); } catch (e0) {}
myePersist();
myeEnsureDurable(0);
return true;
}
window.getMyEmojiGroups = function () { return myGroups || []; };
(function () {
if (!window.idbGet) return;
let retry = 0;
function tryRestore() {
window.idbGet(MYE_KEY()).then(v => {
if (!v) { if (retry < 3) { retry++; setTimeout(tryRestore, 800 * retry); } else myeHydrateFallback(); return; }
myeApplyIdb(v);
});
}
if (window.__mochiDataReady) setTimeout(tryRestore, 4000);
else document.addEventListener('mochi-restore-done', function () { setTimeout(tryRestore, 4000); });
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
const emojiLazyQueue = [];   // 已进入触发区待补 src 的 img（FIFO）
let emojiLazyT = null;       // 泵定时器（null=未在泵）
function emojiLazyEnqueue(img, src) {
if (src) { try { img.__emojiLazySrc = src; } catch (e) {} }
if (emojiLazyQueue.indexOf(img) >= 0) return;
emojiLazyQueue.push(img);
if (!emojiLazyT) emojiLazyT = setTimeout(emojiLazyPump, 50);
}
function emojiLazyPump() {
emojiLazyT = null;
for (let n = 0; n < 4 && emojiLazyQueue.length; n++) {
const img = emojiLazyQueue.shift();
if (!img || !img.isConnected) continue; // 重渲染已丢弃的节点不再补
if ((img.__emojiLazySrc || (img.dataset && img.dataset.src)) && !img.getAttribute('src')) {
img.setAttribute('src', img.__emojiLazySrc || img.dataset.src);
if (img.dataset) img.removeAttribute('data-src');
img.__emojiLazySrc = null; // #931：节点被回收池复活时不得带着上一轮的源
}
try { emojiImgObserver.unobserve(img); } catch (e) {}
}
if (emojiLazyQueue.length && emojiImgObserver) emojiLazyT = setTimeout(emojiLazyPump, 50);
}
const emojiImgObserver = (('IntersectionObserver' in window) && emojiList)
? new IntersectionObserver((entries) => {
for (const en of entries) {
if (!en.isIntersecting) continue;
const img = en.target;
if (img && img.dataset && img.dataset.src) emojiLazyEnqueue(img);
}
}, { root: emojiList, rootMargin: '120px 0px' })
: null;
function emojiAttachLazy(img) {
if (!img) return;
if (emojiImgObserver) { try { emojiImgObserver.observe(img); } catch (e) {} }
else { img.setAttribute('src', img.dataset.src || ''); img.removeAttribute('data-src'); }
}
function emojiNewImg(src) {
const img = document.createElement('img');
img.decoding = 'async';
img.dataset.src = src; // v3.42.x 懒加载：进入视口才解码，避免整组全量解码卡主线程
img.alt = '表情';
return img;
}
const emojiImgPool = new Map();     // 身份 -> [img 节点, ...]（重写前收、重建时取，跨 render 存活）
const EMOJI_IMG_POOL_MAX = 160;     // 池上限：超大库来回滚动时不无限留节点
const EMOJI_IMG_POOL_PER_KEY = 8;   // 同一身份最多留几个（重复卡 / 多分组同图）
function emojiPoolKey(src) {
try { if (window.ccMediaCardIdent) return window.ccMediaCardIdent(src); } catch (e) {}
return typeof src === 'string' ? src : String(src);
}
function emojiPoolTrim() {
let total = 0;
emojiImgPool.forEach(list => { total += list.length; });
if (total <= EMOJI_IMG_POOL_MAX) return;
emojiImgPool.forEach((list, k) => { if (total > EMOJI_IMG_POOL_MAX) { total -= list.length; emojiImgPool.delete(k); } });
}
function emojiPoolHarvest() {
if (!emojiList) return;
emojiList.querySelectorAll('img').forEach(im => {
const k = (im.dataset && im.dataset.emojiKey) || '';
if (!k) return; // 不是本机制建的图（如加载占位行）不入池
if (im.__pooled) return; // 幂等：同一次重写里被多次回收也只入池一次（防重复取回同一节点）
im.__pooled = true;
let list = emojiImgPool.get(k);
if (!list) { list = []; emojiImgPool.set(k, list); }
if (list.length < EMOJI_IMG_POOL_PER_KEY) list.push(im);
});
emojiPoolTrim();
}
function emojiAdoptImg(src) {
const k = emojiPoolKey(src);
const list = emojiImgPool.get(k);
if (list && list.length) {
const img = list.pop();
if (!list.length) emojiImgPool.delete(k);
img.__pooled = false;
img.dataset.emojiKey = k;
return img; // 复活旧节点：src 已解好的原样保留、只带 data-src 的保住排队状态
}
const img = emojiNewImg(src);
img.dataset.emojiKey = k;
return img;
}
try {
const _emojiIH = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
Object.defineProperty(emojiList, 'innerHTML', {
get: _emojiIH.get,
set: function (v) { emojiPoolHarvest(); _emojiIH.set.call(this, v); },
configurable: true
});
} catch (e) {}
function emojiWarmGroupTokens(arr) {
if (!window.mochiMediaWarmTokens || !Array.isArray(arr)) return;
const toks = [];
for (let i = 0; i < arr.length; i++) {
const s = arr[i];
if (typeof s === 'string' && s.indexOf('@@m:') === 0) toks.push(s.slice(4));
}
if (toks.length) setTimeout(function () { try { window.mochiMediaWarmTokens(toks); } catch (e) {} }, 250);
}
let emojiRenderSig = '';
let emojiRecNow = null; // #558 最近使用：renderEmojiPanel 每次渲染先解析一份，签名函数/分组条共用（#457 哨兵锚定本函数签名，参数不扩）
function emojiRenderSigTarget(hts, pn) {
try {
var rec = emojiRecNow;
var grp = emojiMode === 'public' ? pubCurGroup : (emojiMode === 'ta' ? emojiCurGroup : myCurGroup);
var sig = emojiMode + '|' + grp + '|' + (myBatchMode ? '1' : '0') + '|' + (hts ? '1' : '0') + '|' + (pn || '') + '|';
var _ident = (typeof window.ccMediaCardIdent === 'function') ? window.ccMediaCardIdent : null;
if (grp === '__recent__') { // #558 最近使用虚拟分组：内容=按身份回查三池的解析结果
var rs = (rec && rec.srcs) ? rec.srcs : [];
if (!rs.length) return sig + 'empty';
var rl = 0;
for (var r = 0; r < rs.length; r++) rl += (_ident ? _ident(rs[r]) : rs[r]).length;
return sig + rs.length + '|' + rl + '|' + (_ident ? _ident(rs[0]) : rs[0]) + '|' + (_ident ? _ident(rs[rs.length - 1]) : rs[rs.length - 1]);
}
var arr = null;
if (emojiMode !== 'mine') {
var isPub = emojiMode === 'public';
var groups = (window.getScopedGroups && window.getScopedGroups('sticker', isPub ? 'public' : 'own')) || [];
for (var i = 0; i < groups.length; i++) { if (groups[i][0] === grp) { arr = groups[i][1]; break; } }
} else {
for (var j = 0; j < myGroups.length; j++) { if (myGroups[j][0] === grp) { arr = myGroups[j][1]; break; } }
}
if (!arr || !arr.length) return sig + 'empty';
var sumLen = 0;
for (var k = 0; k < arr.length; k++) sumLen += (_ident ? _ident(arr[k] || '') : (arr[k] || '')).length;
var _f = _ident ? _ident(arr[0] || '') : (arr[0] || '');
var _l = _ident ? _ident(arr[arr.length - 1] || '') : (arr[arr.length - 1] || '');
return sig + arr.length + '|' + sumLen + '|' + _f + '|' + _l;
} catch (e) { return ''; }
}
const EMOJI_RECENT_KEY = 'emoji-recent';
const EMOJI_RECENT_MAX = 24;
function recentIdentsAt(key) {
try {
const v = JSON.parse(myEmojiStore().get(key) || '[]');
if (Array.isArray(v)) return v.filter(x => typeof x === 'string' && x).slice(0, EMOJI_RECENT_MAX);
} catch (e) {}
return [];
}
function recentSaveAt(key, ids) {
try { myEmojiStore().set(key, JSON.stringify(ids.slice(0, EMOJI_RECENT_MAX))); } catch (e) {}
}
function emojiRecentIdents() { return recentIdentsAt(EMOJI_RECENT_KEY); }
function emojiRecentSave(ids) { recentSaveAt(EMOJI_RECENT_KEY, ids); }
function emojiRecordRecent(src) {
if (typeof src !== 'string' || !src) return;
const id = (typeof window.ccMediaCardIdent === 'function') ? window.ccMediaCardIdent(src) : src.slice(0, 120);
const ids = emojiRecentIdents().filter(x => x !== id);
ids.unshift(id);
emojiRecentSave(ids);
}
function emojiRecentResolved() {
const ids = emojiRecentIdents();
const srcs = [];
if (ids.length && typeof window.ccMediaCardIdent === 'function') {
const want = {};
ids.forEach((x, i) => { want[x] = i; });
const found = [];
const scan = (arr) => {
(arr || []).forEach(src => {
if (typeof src !== 'string' || !src) return;
const id = window.ccMediaCardIdent(src);
const oi = want[id];
if (oi !== undefined && oi >= 0) { found.push([oi, src]); want[id] = -1; }
});
};
((window.getScopedGroups && window.getScopedGroups('sticker', 'own')) || []).forEach(g => scan(g[1]));
((window.getScopedGroups && window.getScopedGroups('sticker', 'public')) || []).forEach(g => scan(g[1]));
(myGroups || []).forEach(g => scan(g[1]));
found.sort((a, b) => a[0] - b[0]);
found.forEach(x => srcs.push(x[1]));
}
return { ids: ids, srcs: srcs.slice(0, EMOJI_RECENT_MAX) };
}
function textRecentKey() { return EMOJI_RECENT_KEY + '-' + emojiCat; }
function emojiRecordRecentText(t) {
if (typeof t !== 'string' || !t) return;
const key = textRecentKey();
const ids = recentIdentsAt(key).filter(x => x !== t);
ids.unshift(t);
recentSaveAt(key, ids);
}
function textRecentResolved() {
const ids = recentIdentsAt(textRecentKey());
const srcs = [];
if (ids.length) {
const want = {};
ids.forEach((x, i) => { want[x] = i; });
const found = [];
const scan = (arr) => {
(arr || []).forEach(t => {
if (typeof t !== 'string' || !t) return;
const oi = want[t];
if (oi !== undefined && oi >= 0) { found.push([oi, t]); want[t] = -1; }
});
};
((window.getScopedGroups && window.getScopedGroups(emojiCat, 'own')) || []).forEach(g => scan(g[1]));
((window.getScopedGroups && window.getScopedGroups(emojiCat, 'public')) || []).forEach(g => scan(g[1]));
(myTextGroups[emojiCat] || []).forEach(g => scan(g[1]));
found.sort((a, b) => a[0] - b[0]);
found.forEach(x => srcs.push(x[1]));
}
return { ids: ids, srcs: srcs.slice(0, EMOJI_RECENT_MAX) };
}
function renderEmojiGroupsBar(rec) {
if (!emojiGroupsBar) return;
emojiGroupsBar.innerHTML = '';
let list = [];
let cur = '';
if (emojiCat !== 'sticker') {
list = textScopeGroups();
cur = textCurGroup();
if (cur !== '__recent__' && (!cur || !list.some(g => g[0] === cur))) { const hit = list.find(g => g[1] && g[1].length); textCurSet(hit ? hit[0] : ''); cur = textCurGroup(); }
} else if (emojiMode === 'public') {
list = (window.getScopedGroups && window.getScopedGroups('sticker', 'public')) || [];
cur = pubCurGroup;
} else if (emojiMode === 'ta') {
list = (window.getScopedGroups && window.getScopedGroups('sticker', 'own')) || [];
cur = emojiCurGroup;
} else {
list = myGroups;
cur = myCurGroup;
}
const recChipShow = !!(rec && rec.srcs.length) && !(emojiMode === 'mine' && (emojiCat === 'sticker' ? myBatchMode : myTextBatch));
if (cur === '__recent__' && !recChipShow) cur = '';
if (cur && cur !== '__recent__' && !list.some(g => g[0] === cur)) cur = '';
const chips = (recChipShow ? [['__recent__', '⏱最近使用']] : [])
.concat(list.filter(g => emojiMode === 'mine' ? true : g[1].length).map(g => [g[0], g[0] + g[1].length]));
chips.forEach(([val, label]) => {
const c = document.createElement('span');
c.className = 'emoji-g-chip' + (cur === val ? ' sel' : '');
c.textContent = label;
c.addEventListener('click', (e) => {
e.stopPropagation();
if (emojiCat !== 'sticker') textCurSet(cur === val ? '' : val);
else if (emojiMode === 'public') pubCurGroup = (cur === val ? '' : val);
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
emojiWarmGroupTokens(arr); // #435：组内令牌提前批量预热，不等逐图 miss 读排队
arr.forEach((src, i) => {
const d = document.createElement('div');
d.className = 'emoji-item';
if (mode === 'mine' && myBatchMode) {
const k = gname + '\u0001' + i;
const on = mySel.has(k);
d.classList.toggle('sel', on);
const img = emojiAdoptImg(src); // #662：优先取回回收池里同身份的旧 img（已解码的零重解码），取不到才新建；#435 统一创建（decoding=async + 懒加载）
d.appendChild(img);
emojiAttachLazy(img);
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
const img = emojiAdoptImg(src); // #662：优先取回回收池里同身份的旧 img（已解码的零重解码），取不到才新建；#435 统一创建（decoding=async + 懒加载）
d.appendChild(img);
emojiAttachLazy(img);
d.addEventListener('click', () => {
try { emojiRecordRecent(src); } catch (e0) {} // #558 最近使用：点击即记录（发送/插入都算）
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
if (emojiCat !== 'sticker') { if (emojiBatchCount) emojiBatchCount.textContent = '已选 ' + myTextSel.size + ' 个'; return; } // #636
if (emojiBatchCount) emojiBatchCount.textContent = '已选 ' + mySel.size + ' 张';
}
function renderEmojiTextPanel(rec) {
const list = textScopeGroups();
const cur = textCurGroup();
const catName = textCatLabel();
if (cur === '__recent__') { // #842 文字分类最近使用虚拟分组（能解析到内容时优先于本作用域空态）
const srcs = (rec && rec.srcs) || [];
if (!srcs.length) {
emojiList.innerHTML = '<div class="emoji-empty">最近使用的' + catName + '不在这里了<br>去分组里点一次就会出现在这里</div>';
return;
}
renderEmojiTextGroup('__recent__', srcs);
return;
}
if (!list.length) {
emojiList.innerHTML = emojiMode === 'mine'
? '<div class="emoji-empty">暂无我的' + catName + '<br>点上方「批量导入」粘贴，一行一个</div>'
: (ccPanelsFetching
? ccLoadRowHtml('正在加载' + catName + '…')
: '<div class="emoji-empty">暂无' + (emojiMode === 'public' ? '公用' : '') + catName + '<br>请到 字卡库 → ' + (emojiMode === 'public' ? '公用字卡' : '专属字卡') + ' → ' + catName + ' 添加</div>');
return;
}
if (!cur || !list.some(x => x[0] === cur)) {
emojiList.innerHTML = '<div class="emoji-empty">点击上方分组查看</div>';
return;
}
const g = list.find(x => x[0] === cur);
if (!g || !g[1].length) { emojiList.innerHTML = '<div class="emoji-empty">该分组暂无内容</div>'; return; }
renderEmojiTextGroup(g[0], g[1]);
}
function renderEmojiTextGroup(gname, arr) {
const grid = document.createElement('div');
grid.className = 'emoji-grid emoji-grid-text' + (emojiCat === 'emoji' ? ' emoji-grid-emoji' : '');
arr.forEach((t, i) => {
const d = document.createElement('div');
d.className = 'emoji-item emoji-text-item';
d.textContent = t;
if (emojiMode === 'mine' && myTextBatch) {
const k = gname + '\u0001' + i;
if (myTextSel.has(k)) { d.classList.add('sel'); const ck = document.createElement('span'); ck.className = 'emoji-check'; ck.textContent = '✓'; d.appendChild(ck); }
d.addEventListener('click', (e) => {
e.stopPropagation();
if (myTextSel.has(k)) myTextSel.delete(k); else myTextSel.add(k);
updateBatchCount();
d.classList.toggle('sel', myTextSel.has(k));
let ck = d.querySelector('.emoji-check');
if (myTextSel.has(k)) { if (!ck) { ck = document.createElement('span'); ck.className = 'emoji-check'; ck.textContent = '✓'; d.appendChild(ck); } }
else if (ck) ck.remove();
});
} else {
d.addEventListener('click', (e) => {
e.stopPropagation();
try { emojiRecordRecentText(t); } catch (e0) {} // #842 最近使用：点击即记录（填入/直发/插入都算）
if (emojiInsertCb) { // 写信/回信插入模式（回调方决定落位，含群聊输入栏，行为不变）
const cb = emojiInsertCb;
emojiInsertCb = null;
emojiInsertAllowUrl = false;
cb(t, 'text');
closeEmojiPanel();
} else if (textCardDirectMode()) {
sendTextCard(t);
} else {
insertTextToChatInput(t); // #691：填入输入栏，面板不关（可连点），发送由用户决定
}
try { d.blur(); } catch (err) {}
});
}
grid.appendChild(d);
});
emojiList.appendChild(grid);
}
function sendTextCard(t) {
if (typeof t !== 'string' || !t) return;
lastMineText = t;
const quote = lastQuote ? { q: quoteValue(lastQuote), s: lastQuote.side, i: lastQuote.idx } : null;
if (quote) { lastQuote = null; renderDraft(); }
const rec = { side: 'out', text: t, parts: [{ k: 'text', v: t }] };
if (quote) { rec.quote = quote.q; rec.qside = quote.s; if (typeof quote.i === 'number' && quote.i >= 0) rec.qidx = quote.i; }
addRec(rec);
if (window.logFish) window.logFish();
scheduleReply();
closeEmojiPanel();
}
function renderEmojiPanel() {
if (!emojiList) return;
const hts = taStickerHidden();
ensureEmojiCatBar();
ensureEmojiTextTools();
if (emojiCat !== 'sticker' && textCatHidden(emojiCat)) emojiCat = 'sticker';
if (emojiCatBar) emojiCatBar.querySelectorAll('.emoji-cat-chip').forEach(c => {
const cat = c.dataset.ecat;
c.hidden = cat !== 'sticker' && textCatHidden(cat);
c.classList.toggle('sel', cat === emojiCat);
});
ensureEmojiTextModeBar(); // #691i：文字分类的「点击行为」切换按钮（分类行正下方，与设置里那行同键）
renderEmojiTextModeBar();
if (emojiCat === 'sticker') {
document.querySelectorAll('#emoji-panel .emoji-tab').forEach(t => { if (t.dataset.etab !== 'mine') t.hidden = hts; });
if (hts && emojiMode !== 'mine') emojiMode = 'mine';
}
document.querySelectorAll('#emoji-panel .emoji-tab').forEach(t => t.classList.toggle('sel', t.dataset.etab === emojiMode));
const taTabEl = document.querySelector('#emoji-panel .emoji-tab[data-etab="ta"]');
const pubTabEl = document.querySelector('#emoji-panel .emoji-tab[data-etab="public"]');
const mineTabEl = document.querySelector('#emoji-panel .emoji-tab[data-etab="mine"]');
if (taTabEl) taTabEl.textContent = chatPartnerName() + ' 的' + textCatLabel();
if (pubTabEl) pubTabEl.textContent = '公用' + textCatLabel();
if (mineTabEl) mineTabEl.textContent = '我的' + textCatLabel();
if (emojiTools) emojiTools.hidden = !(emojiMode === 'mine' && emojiCat === 'sticker');
if (emojiTextTools) {
emojiTextTools.hidden = !(emojiMode === 'mine' && emojiCat !== 'sticker');
if (mytBatchBtn) mytBatchBtn.textContent = myTextBatch ? '退出批量' : '批量管理';
}
if (emojiBatch) emojiBatch.hidden = !(emojiMode === 'mine' && (emojiCat === 'sticker' ? myBatchMode : myTextBatch));
var rec = emojiCat === 'sticker' ? emojiRecentResolved() : textRecentResolved(); // #558：每次渲染解析一次最近使用（身份回查三池），bar 与最近分组/签名共用；#842 文字分类各解析自己那份
emojiRecNow = rec;
renderEmojiGroupsBar(rec);
if (emojiCat !== 'sticker') { // #636：颜文字/emoji 走文字网格（无图、无懒加载，不做 #457 指纹短路）
emojiList.innerHTML = '';
renderEmojiTextPanel(rec);
return;
}
var _sigTarget = emojiRenderSigTarget(hts, taTabEl ? taTabEl.textContent : '');
if (_sigTarget && _sigTarget === emojiRenderSig && emojiList.firstElementChild) return;
if (emojiImgObserver) emojiList.querySelectorAll('img[data-src]').forEach(im => { try { emojiImgObserver.unobserve(im); } catch (e) {} }); // v3.42.x
emojiLazyQueue.length = 0; // #435：重绘丢弃旧节点，待补队列与泵一并作废，防止补到游离节点
if (emojiLazyT) { clearTimeout(emojiLazyT); emojiLazyT = null; }
emojiList.innerHTML = '';
if (emojiMode !== 'mine') {
const isPub = emojiMode === 'public';
const groups = (window.getScopedGroups && window.getScopedGroups('sticker', isPub ? 'public' : 'own')) || [];
const emptyAll = isPub
? '<div class="emoji-empty">暂无公用表情包<br>请到 字卡库 → 公用字卡 → 表情包 上传</div>'
: '<div class="emoji-empty">暂无表情包<br>请到 字卡库 → 专属字卡 → 表情包 上传</div>';
if (!groups.length) {
emojiList.innerHTML = ccPanelsFetching ? ccLoadRowHtml('正在加载表情包…') : emptyAll;
if (ccPanelsFetching) { emojiRenderSig = null; return; } // 占位行在 DOM 里：作废 #457 指纹短路，防重渲被跳过
return;
}
const curn = isPub ? pubCurGroup : emojiCurGroup;
if (curn === '__recent__') { // #558 最近使用虚拟分组（渲染走 'ta' 直发路径，不进批量勾选）
if (!rec.srcs.length) {
emojiList.innerHTML = '<div class="emoji-empty">最近使用的表情不在当前桌面了<br>去分组里发一次就会出现在这里</div>';
return;
}
renderEmojiGroup('__recent__', rec.srcs, 'ta');
emojiRenderSig = _sigTarget; // #457 渲染成功保存指纹，下次同内容跳过重建
return;
}
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
emojiRenderSig = _sigTarget; // #457 渲染成功保存指纹，下次同内容跳过重建
} else {
if (myCurGroup === '__recent__' && !myBatchMode) {
if (!rec.srcs.length) {
emojiList.innerHTML = '<div class="emoji-empty">最近使用的表情不在当前桌面了<br>去分组里发一次就会出现在这里</div>';
return;
}
renderEmojiGroup('__recent__', rec.srcs, 'ta');
emojiRenderSig = _sigTarget;
return;
}
if (!myGroups.length) {
emojiList.innerHTML = myeLoading
? ccLoadRowHtml('正在加载我的表情包…')
: '<div class="emoji-empty">暂无我的表情包<br>点击上方「添加」上传，或「新建分组」</div>';
if (myeLoading) { emojiRenderSig = null; return; }
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
emojiRenderSig = _sigTarget; // #457 渲染成功保存指纹，下次同内容跳过重建
}
}
let emojiShowToken = 0; // #692：面板「解码后再显示」的世代令牌——等待期间关闭/重开即作废，防空回调把面板又弹出来
function openEmojiPanel() {
if (!emojiPanel) return;
loadEmojiPref(); // v3.26.x：打开即按上次用的顶部分组+分组落位（覆盖 idbRestore 晚到 / 切换联系人未重读的场景）
reloadMyEmojiFromIdb();
reloadMyTextFromIdb(); // #636：文字库（颜文字/emoji）首开补一次 IDB 取回
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
if (window.closeAvlib) window.closeAvlib();
document.body.classList.remove('mail-emoji-mode');
myBatchMode = false;
mySel.clear();
myTextBatch = false; // #636
myTextSel.clear();
closeIme(); // v3.5.116：收起输入法，面板完整不被键盘遮挡
renderEmojiPanel();
const myToken = ++emojiShowToken;
const showEmoji = function () {
if (myToken !== emojiShowToken) return; // 等待解码期间被关闭/重开：本次显示作废
emojiPanel.hidden = false;
scrollChatBottom();
if (morePanel) morePanel.hidden = true;
};
emojiShowWhenDecoded(showEmoji, myToken);
hydrateCcForChatPanels(() => { if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel(); });
}
const EMOJI_DECODE_AWAIT_MAX = 24;
function emojiPanelFirstScreen() {
const out = [];
if (!emojiList) return out;
let imgs; try { imgs = emojiList.querySelectorAll('img'); } catch (e) { return out; }
if (!imgs || !imgs.length) return out;
let cr = null; try { cr = emojiList.getBoundingClientRect(); } catch (e) {}
const byRect = !!(cr && cr.height > 4); // 隐藏期 keep-alive 下几何仍成立，首屏按可视区量（量不到退回前 N 张）
for (let i = 0; i < imgs.length; i++) {
if (out.length >= 48) break;
const im = imgs[i];
if (byRect) {
let r = null; try { r = im.getBoundingClientRect(); } catch (e) {}
if (r && r.top > cr.bottom + 80) break; // 视口下沿外的留给懒加载
if (!r || r.bottom < cr.top - 80) continue; // 已滚上去的（本来就已解码）不占等待名额
out.push(im);
} else if (i < EMOJI_DECODE_AWAIT_MAX) out.push(im);
}
return out;
}
function emojiKickFirstScreen(imgs) {
const toks = [];
for (let i = 0; i < imgs.length; i++) {
const im = imgs[i];
let ds = ''; try { ds = (im.dataset && im.dataset.src) || ''; } catch (e) {}
const pay = ds || im.getAttribute('src') || '';
if (!pay) continue;
const isTok = pay.indexOf('@@m:') === 0;
if (ds && !im.getAttribute('src')) {
im.setAttribute('src', ds);
try { im.removeAttribute('data-src'); } catch (e) {}
try { if (emojiImgObserver) emojiImgObserver.unobserve(im); } catch (e) {}
}
if (isTok && pay.length > 4) toks.push(pay.slice(4));
}
if (toks.length && window.mochiMediaWarmTokens) { try { window.mochiMediaWarmTokens(toks); } catch (e) {} }
}
function emojiImgReady(im) {
return new Promise(function (res) {
let done = false;
const okNow = function () { try { return !!(im.complete && im.naturalWidth > 0); } catch (e) { return false; } };
const srcNow = function () { try { return im.getAttribute('src') || ''; } catch (e) { return ''; } };
const off = function () { try { im.removeEventListener('load', settle); im.removeEventListener('error', settle); } catch (e) {} };
const settle = function () {
if (done) return;
if (okNow()) { done = true; off(); res(true); return; }
if (srcNow().indexOf('@@m:') !== 0) { done = true; off(); res(false); return; } // 真失败/无源：不挡显示
};
try { im.addEventListener('load', settle); im.addEventListener('error', settle); } catch (e) {}
settle();
setTimeout(function () { if (!done) { done = true; off(); res(okNow()); } }, 2400); // 单图上限，防个别令牌吊死
}).then(function () { try { return im.decode ? im.decode().catch(function () {}) : null; } catch (e) { return null; } });
}
function emojiShowWhenDecoded(show, token) {
let shown = false;
const fin = function () {
if (shown) return; shown = true;
if (token !== undefined && token !== emojiShowToken) return; // #692 已关闭/已重开：本次显示作废
try { show(); } catch (e) {}
};
if (!emojiList || !window.Promise) { fin(); return; }
const first = emojiPanelFirstScreen();
if (!first.length) { fin(); return; }
emojiKickFirstScreen(first);
const jobs = [];
for (let i = 0; i < first.length; i++) jobs.push(emojiImgReady(first[i]));
try {
const all = emojiList.querySelectorAll('img');
for (let i = 0; i < all.length; i++) {
const im = all[i];
if (first.indexOf(im) >= 0) continue;
if (im.dataset && im.dataset.src && !im.getAttribute('src')) continue; // 交给懒加载泵
try { if (im.decode) im.decode().catch(function () {}); } catch (e) {}
}
} catch (e) {}
Promise.all(jobs).then(fin, fin);
setTimeout(fin, 2500); // #692 兜底：decode 迟迟不结算也不把面板挂死；#716：1s→2.5s，上限仍在防挂死
}
function closeEmojiPanel() {
emojiShowToken++; // #692：作废未兑现的「解码后显示」——等图期间关掉面板不再被自动弹出
if (emojiPanel) emojiPanel.hidden = true;
emojiInsertCb = null;
emojiInsertAllowUrl = false;
}
let mochiPrewarmT = null;
function chatPanelPrewarmOn() {
try { if (window.xyStore) return window.xyStore('xy-home-v2').get('chat-panel-prewarm') !== '0'; } catch (e) {}
return true; // 键缺失/读异常＝默认开（与设置行缺省一致）
}
function mochiPrewarmEmojiPanel() {
if (!emojiPanel || !emojiPanel.hidden) return; // 开着＝#662 解码后显示自己管
const pg = document.getElementById('page-chat');
if (!pg || pg.hidden) return; // 不在聊天页＝面板无几何，图解码了也进不了视口预热位
try { renderEmojiPanel(); } catch (e) {}
if (!emojiList) return;
const imgs = emojiList.querySelectorAll('img');
let n = 0;
for (let i = 0; i < imgs.length && n < 24; i++) {
const im = imgs[i];
if (im.dataset && im.dataset.src && !im.getAttribute('src')) {
im.setAttribute('src', im.dataset.src);
im.removeAttribute('data-src');
n++;
try { if (emojiImgObserver) emojiImgObserver.unobserve(im); } catch (e) {}
}
try { if (im.decode) im.decode().catch(function () {}); } catch (e) {}
}
}
function schedulePanelPrewarm(delay) {
if (!chatPanelPrewarmOn()) return;
if (mochiPrewarmT) clearTimeout(mochiPrewarmT);
mochiPrewarmT = setTimeout(function () {
mochiPrewarmT = null;
const run = function () {
mochiPrewarmEmojiPanel();
try { if (window.mochiPrewarmAvlib) window.mochiPrewarmAvlib(); } catch (e) {}
};
try { if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 800); } catch (e) { setTimeout(run, 800); }
}, delay || 4000);
}
window.addEventListener('load', function () { schedulePanelPrewarm(4000); });
document.addEventListener('contact-switched', function () { schedulePanelPrewarm(3000); });
document.addEventListener('mochi-restore-done', function () { schedulePanelPrewarm(6000); });
window.schedulePanelPrewarm = schedulePanelPrewarm; // #907 导出：外置 js 经构建包装，顶层函数不上 window（verify 脚本/后续批也要能排班）
window.mochiEmojiLazyAdopt = emojiAdoptImg;        // 同身份取回旧节点（已解码的零重解码）
window.mochiEmojiLazyEnqueue = emojiLazyEnqueue;   // 进视口的图交给同一条分批泵（全局每 50ms 补 4 张）
window.mochiEmojiWarmGroupTokens = emojiWarmGroupTokens; // 组内令牌交给媒体池批量预热
function reloadMyEmojiFromIdb() {
if (!window.idbGet) return;
if (window.__myeIdbApplied === true && Array.isArray(myGroups) && myGroups.length) return;
if (!(Array.isArray(myGroups) && myGroups.length)) {
myeLoading = true;
try { if (emojiPanel && !emojiPanel.hidden && emojiMode === 'mine') renderEmojiPanel(); } catch (e) {}
}
window.idbGet(MYE_KEY()).then(v => {
if (!v) { myeHydrateFallback(); return; }
myeLoading = false;
myeApplyIdb(v);
try { if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel(); } catch (e) {}
}).catch(() => {
myeLoading = false;
try { if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel(); } catch (e) {}
});
}
document.addEventListener('contact-switched', function () {
loadEmojiPref(); // v3.26.x：切换联系人后按该桌面的上次 tab/分组偏好落位，不复用上一桌面状态
if (!emojiPanel.hidden) renderEmojiPanel();
});
document.addEventListener('hide-ta-sticker-changed', function () {
if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel();
});
document.addEventListener('hide-tab-changed', function () { // #636：颜文字/emoji 分类显隐开关
if (emojiPanel && !emojiPanel.hidden) renderEmojiPanel();
});
window.openEmojiPanelForInsert = function (cb, opts) {
emojiInsertCb = cb || null;
emojiInsertAllowUrl = !!(opts && opts.allowUrl);
emojiTextModeApplies = !!(opts && opts.textModeApplies); // #691i：只有行为真受模式键支配的入口才显示面板内切换按钮
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
if (batchImg && window.mochiFilePickSurface) window.mochiFilePickSurface(batchImg, { id: 'batch-img-tap', accept: 'image/*', multiple: true, owner: 'mochi-batch-img-pick' });
if (batchImg) {
batchImg.addEventListener('click', (e) => {
e.stopPropagation();
batchPicking = true;
window.mochiFilePick({
id: 'mochi-batch-img-pick', accept: 'image/*', multiple: true,
onFiles: (files) => {
batchPicking = false;
if (files.length) batchAddImages(files);
else toast('没有取到图片，请再选一次');
}
});
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
const INPUT_IO_TOKENS = ['mic', 'continue', 'more', 'emoji', 'input', 'img', 'batch'];
const INPUT_IO_DEFAULT = INPUT_IO_TOKENS.slice();
const INPUT_IO_ORDER_BASE = 10;  // [data-io] 起始序，依次 +10；发送按钮固定 999＝恒在最后
const INPUT_IO_SEND_ORDER = 999;
function inputIoNormalize(raw) {
const out = [];
(Array.isArray(raw) ? raw : []).forEach((t) => {
if (INPUT_IO_TOKENS.indexOf(t) >= 0 && out.indexOf(t) < 0) out.push(t);
});
INPUT_IO_TOKENS.forEach((t) => { if (out.indexOf(t) < 0) out.push(t); });
return out;
}
function inputIoRead() {
try { return inputIoNormalize(JSON.parse(store.get('cs-input-order') || 'null')); } catch (e) { return INPUT_IO_DEFAULT.slice(); }
}
function inputIoIsDefault() {
return inputIoRead().join(',') === INPUT_IO_DEFAULT.join(',');
}
function applyInputBtnOrder() {
const order = inputIoRead();
document.querySelectorAll('.chat-input-row').forEach((row) => {
const items = row.querySelectorAll('[data-io]');
items.forEach((el) => {
const i = order.indexOf(el.getAttribute('data-io'));
el.style.order = String(INPUT_IO_ORDER_BASE + (i < 0 ? items.length : i) * 10);
});
const send = row.querySelector('.chat-send');
if (send) send.style.order = String(INPUT_IO_SEND_ORDER);
});
}
window.mochiInputOrder = {
TOKENS: INPUT_IO_TOKENS.slice(),
DEFAULT: INPUT_IO_DEFAULT.slice(),
read: inputIoRead,
isDefault: inputIoIsDefault,
write: function (arr) {
const norm = inputIoNormalize(arr);
try { store.set('cs-input-order', JSON.stringify(norm)); } catch (e) {}
document.dispatchEvent(new Event('chat-input-order-changed'));
return norm;
},
reset: function () {
try { store.remove('cs-input-order'); } catch (e) {}
document.dispatchEvent(new Event('chat-input-order-changed'));
return INPUT_IO_DEFAULT.slice();
},
apply: applyInputBtnOrder
};
document.addEventListener('chat-input-order-changed', applyInputBtnOrder);
document.addEventListener('contact-switched', applyInputBtnOrder);
document.addEventListener('mochi-restore-done', applyInputBtnOrder);
applyInputBtnOrder();
const micBtn = document.getElementById('chat-mic-btn');
const voicePanel = document.getElementById('voice-panel');
const VOICE_MAX_MS = 60000;
let voiceStream = null, voiceRec = null, voiceChunks = [], voiceTimer = null, voiceStarting = false; // FIX 2026-09-05 #169 录音启动进行中闸门
let voiceStartTs = 0, voiceDataUrl = '', voiceDur = 0, voiceSilent = false, voicePreviewAudio = null, voiceVisHandler = null;
let voiceStopping = false, voiceStopWatchdog = null, voiceStopSettled = false, voiceMimeFallback = false;
let voiceStopTs = 0; // FIX #6xx 停止时刻钉死：慢壳 onstop 迟到/看门狗收尾时用「点停止那一刻」算时长，不再按结账瞬间 Date.now() 虚涨（报障：录 3 秒点结束卡住后变 20 秒）
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
window.openVoicePanelFor = function (onSend) { openVoicePanel({ onSend: onSend }); };
function isAndroidWebView() {
try {
return !!((window.mochiDevice || {}).env || {}).isAndroidWebView;
} catch (e) { return true; } // 拿不到判定源时保守按 WebView 处理（走 mp4/aac，只影响音质不影响可用）
}
function voiceMimePreferOpus() {
const md = (window.mochiDevice) || {};
return !!md.isAndroid && !isAndroidWebView();
}
function pickVoiceMime() {
if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
if (voiceMimeFallback) return ''; // FIX #228 上个指定容器没录到数据：这轮交浏览器自选默认容器
const list = voiceMimePreferOpus()
? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus']
: ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
for (let i = 0; i < list.length; i++) {
try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {}
}
return '';
}
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
function acquireVoiceStreamGuarded(ms) {
return new Promise((resolve, reject) => {
let settled = false;
const to = setTimeout(() => {
if (settled) return;
settled = true;
reject(Object.assign(new Error('microphone timeout'), { name: 'TimeoutError' }));
}, ms || 15000);
acquireVoiceStream().then((s) => {
if (settled) { try { s.getTracks().forEach((t) => t.stop()); } catch (e) {} return; } // 迟到的流防泄漏
settled = true; clearTimeout(to); resolve(s);
}).catch((e) => {
if (settled) return;
settled = true; clearTimeout(to); reject(e);
});
});
}
async function startVoiceRec() {
if (voiceStarting) return;
if (voiceStopping) { toast('正在停止录音，请稍候'); return; } // FIX #228 上一次停止还没结账，忽略本次启动
voiceStarting = true;
try { await startVoiceRecInner(); } finally { voiceStarting = false; }
}
async function startVoiceRecInner() {
voiceStopSettled = false; // FIX #228 新一轮录音：停止结账闩复位
voiceStopTs = 0; // FIX #6xx 新一轮录音：停止时刻清零，待 stop 时钉住
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
toast('当前浏览器不支持录音'); return;
}
let stream = null;
try {
stream = await acquireVoiceStreamGuarded(15000); // FIX #228 挂起壳 15s 无响应即报错复位，不再永久锁死 voiceStarting
} catch (e) {
toast(e && e.name === 'TimeoutError' ? '麦克风无响应，请检查录音权限或重启浏览器后重试' : (e && e.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器设置里允许后重试' : '无法访问麦克风'));
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
if (voiceStopWatchdog) { clearTimeout(voiceStopWatchdog); voiceStopWatchdog = null; } // FIX #228 出错后不会有 onstop，看门狗一并清
voiceStopping = false;
voiceStopSettled = true; // FIX #228 错误路径直接销账，不再等 onstop
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
voiceStopping = true; // FIX #228 结账前挡住重入（连点停止/立刻再开始都会偷句柄）
voiceStopTs = Date.now(); // FIX #6xx 停止时刻钉死：时长按此刻算，不按结账瞬间（慢壳 onstop 迟到会虚涨）
armVoiceStopWatchdog(); // FIX #228 慢壳 onstop 迟到/丢失兜底
const st0 = document.getElementById('voice-status');
if (st0) st0.textContent = '正在停止录音…'; // FIX #6xx 立即反馈：onstop 迟到窗口不再显示定格「正在录音…」像卡死
try { voiceRec.stop(); } catch (e) { voiceFinalizeStop(); } // stop 都抛了就没有 onstop，直接结账（空数据走可见失败）
} else {
voiceStopStream();
}
}
function armVoiceStopWatchdog() {
if (voiceStopWatchdog) clearTimeout(voiceStopWatchdog);
voiceStopWatchdog = setTimeout(() => { voiceStopWatchdog = null; voiceFinalizeStop(); }, 3000);
}
function onVoiceRecStop() { voiceFinalizeStop(); }
function voiceFinalizeStop() {
if (voiceStopSettled) return;
voiceStopSettled = true;
if (voiceStopWatchdog) { clearTimeout(voiceStopWatchdog); voiceStopWatchdog = null; }
voiceStopping = false;
voiceStopStream();
voiceRec = null;
const wasSilent = voiceSilent;
voiceSilent = false;
const stopTs = voiceStopTs || voiceStartTs;
const durSec = Math.max(1, Math.round((stopTs - voiceStartTs) / 1000));
const blob = new Blob(voiceChunks.length ? voiceChunks : [], { type: (voiceChunks[0] && voiceChunks[0].type) || 'audio/webm' });
voiceChunks = [];
const rb = document.getElementById('voice-record-btn');
if (rb) rb.textContent = '重新录音';
if (wasSilent || !blob.size) {
if (!wasSilent) {
voiceMimeFallback = true;
voiceDataUrl = ''; voiceDur = 0;
const sb0 = document.getElementById('voice-send-btn');
if (sb0) sb0.disabled = true;
const st0 = document.getElementById('voice-status');
if (st0) st0.textContent = '没录到声音数据，请重试';
if (rb) rb.textContent = '开始录音';
toast('录音失败：本浏览器没返回声音数据，请再录一次');
}
return; // 关闭面板打断的录音直接丢弃（原语义保留）
}
if (stopTs - voiceStartTs < 800) { toast('录音太短，请录满 1 秒以上'); return; }
voiceMimeFallback = false; // FIX #228 本容器录到了数据：清兜底标记，沿用当前 mime 选择策略
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
if (voiceStopping) return; // FIX #228 停止结账中（onstop 迟到窗口）忽略连点，防新录音机句柄被旧结账偷走
if (voiceRec && voiceRec.state === 'recording') stopVoiceRec(false);
else await startVoiceRec();
}
function toggleVoicePlay() {
if (!voiceDataUrl) { toast('还没有录音'); return; }
if (voicePreviewAudio && !voicePreviewAudio.paused) { voiceStopPreview(); return; }
voiceStopPreview();
const a = new Audio(voiceDataUrl);
voicePreviewAudio = a;
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
if (myeAdd && window.mochiFilePickSurface) window.mochiFilePickSurface(myeAdd, { id: 'mye-add-tap', accept: 'image/*', multiple: true, owner: 'mochi-myemoji-pick' });
if (myeAdd) {
myeAdd.addEventListener('click', (e) => {
e.stopPropagation();
window.mochiFilePick({
id: 'mochi-myemoji-pick', accept: 'image/*', multiple: true,
onFiles: (files) => {
try {
if (!files.length) { toast('没有取到图片，请再选一次'); return; }
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
} catch (err) { toast('添加表情失败，请重试'); }
}
});
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
if (emojiCat !== 'sticker') { // #636：文字库全选当前分组
if (!textCurGroup()) { toast('请先点击上方分组'); return; }
const tkeys = [];
myTextOf().forEach(([gname, arr]) => { if (gname === textCurGroup()) arr.forEach((c, i) => tkeys.push(gname + '\u0001' + i)); });
if (myTextSel.size === tkeys.length && tkeys.length) myTextSel.clear();
else tkeys.forEach(k => myTextSel.add(k));
updateBatchCount();
renderEmojiPanel();
return;
}
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
if (emojiCat !== 'sticker') { // #636：文字库删除勾选项，顺带清掉删空的分组
if (!myTextSel.size) { toast('请先选择要删除的'); return; }
if (window.openModal) {
window.openModal('删除选中的 ' + myTextSel.size + ' 个？', '', () => {
myTextOf().forEach(([gname, arr]) => {
for (let i = arr.length - 1; i >= 0; i--) { if (myTextSel.has(gname + '\u0001' + i)) arr.splice(i, 1); }
});
myTextGroups[emojiCat] = myTextOf().filter(g => g[1].length);
myTextSel.clear();
myTextSave();
renderEmojiPanel();
}, { noInput: true });
}
return;
}
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
if (emojiCat !== 'sticker') { myTextBatch = false; myTextSel.clear(); renderEmojiPanel(); return; } // #636
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
const raw = quoteDisplayFit(quoteTextSafe(lastQuote.text || ''), lastQuote.side); // FIX 2026-09-15 #490 预览条与气泡同轨显示（taFit 称呼 + 昵称占位符）
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
let chatImgInput = null;
function chatImgPicker() {
if (chatImgInput) {
try { chatImgInput.accept = 'image/*'; } catch (e) {}
return chatImgInput;
}
const fi = document.createElement('input');
fi.type = 'file';
fi.id = 'chat-img-pick';
fi.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
fi.accept = 'image/*'; fi.multiple = true;
fi.onchange = () => {
const files = Array.prototype.slice.call(fi.files || []);
fi.value = '';
if (!files.length) { toast('没有取到图片，请再选一次'); return; }
files.forEach(addDraftImg);
};
document.body.appendChild(fi);
chatImgInput = fi;
if (window.mochiFilePickLabel && imgBtn) window.mochiFilePickLabel(imgBtn, fi);
if (window.mochiFilePickSurface && imgBtn) window.mochiFilePickSurface(imgBtn, { id: 'chat-img-tap', accept: 'image/*', multiple: true, owner: fi });
return fi;
}
function chatImgSurfaceEnsure() {
try {
var fi2 = chatImgPicker();
var btn = document.getElementById('chat-img-btn');
if (window.mochiFilePickSurface && btn) window.mochiFilePickSurface(btn, { id: 'chat-img-tap', accept: 'image/*', multiple: true, owner: fi2 });
} catch (e) {}
}
function chatImgPickBridge() {
const fi = chatImgPicker();
try { if (window.mochiFilePickLabel && imgBtn) window.mochiFilePickLabel(imgBtn, fi); } catch (e) {}
return fi;
}
function addDraftImg(file) {
let settled = false;
const accept = (src, msg) => {
if (settled) return;
settled = true;
draftImgs.push(src);
renderDraft();
if (msg) toast(msg);
};
const reader = new FileReader();
reader.onerror = () => { settled = true; toast('图片读取失败，请换一张再试'); };
reader.onload = () => {
const raw = reader.result;
const img = new Image();
const settleTimer = setTimeout(() => accept(raw, '图片解码较慢，已按原图添加'), 3000);
img.onload = () => {
clearTimeout(settleTimer);
if (settled) return;
try {
const c = document.createElement('canvas');
const scale = Math.min(1, 720 / Math.max(img.width, img.height));
c.width = Math.max(1, Math.round(img.width * scale));
c.height = Math.max(1, Math.round(img.height * scale));
c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
const out = c.toDataURL('image/jpeg', 0.85);
if (out && out.indexOf('data:image/') === 0 && out.length > 128) accept(out);
else accept(raw, '图片压缩失败，已按原图添加');
} catch (err) {
accept(raw, '图片压缩失败，已按原图添加');
}
};
img.onerror = () => { clearTimeout(settleTimer); accept(raw, '部分图片无法压缩，已按原图添加'); };
img.src = raw;
};
try { reader.readAsDataURL(file); } catch (err) { settled = true; toast('图片读取失败，请换一张再试'); }
}
chatImgSurfaceEnsure();
imgBtn.addEventListener('click', (e) => {
e.stopPropagation();
chatImgSurfaceEnsure(); // #1002：点按前幂等补挂真·可点 input 层（按钮被重建过也补回来）
var _fb = () => { window.mochiFilePickFire(chatImgPickBridge(), { onFail: () => toast('无法打开图片选择器，请重试') }); };
if (window.mochiFilePickGuard) window.mochiFilePickGuard(chatImgPickBridge(), _fb);
else _fb();
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
let lastUserEditAt = 0, clearAppliedAt = 0;
function userEditedAfterClear() { return lastUserEditAt > clearAppliedAt; }
let inputFocused = false;
if (input) {
input.addEventListener('focusin', function () { inputFocused = true; });
input.addEventListener('focusout', function () { inputFocused = false; });
}
function inputStillFocused() {
try {
return document.activeElement === input || inputFocused;
} catch (e) { return false; }
}
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
input._mClearTxt = lastSendTxt || '';
try { input._mLastTyped = ''; } catch (e) {}
clearAppliedAt = Date.now();
const sentTxt = lastSendTxt || '';
try {
if (input.isContentEditable && inputStillFocused()) {
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
if (sentTxt && input.isContentEditable) {
[60, 200, 800].forEach((ms) => {
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
try { toast('同样的内容刚发送过，未重复发送'); } catch (e) {}
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
send.addEventListener('mousedown', (e) => { e.preventDefault(); });
send.addEventListener('click', () => { addMsg(readSendText()); try { input.focus(); } catch (e) {} });
}
if (input) {
try {
input.addEventListener('keydown', () => { lastUserEditAt = Date.now(); }, true);
input.addEventListener('compositionstart', () => { lastUserEditAt = Date.now(); }, true);
input.addEventListener('beforeinput', (e) => {
if (!e || typeof e.inputType !== 'string' || e.inputType.indexOf('insert') === 0) lastUserEditAt = Date.now();
}, true);
input.addEventListener('input', function () { try { input._mLastTyped = input.innerText || ''; } catch (e) {} }, true);
} catch (e) {}
input.addEventListener('input', () => {
if (!input._mClearTxt) return;
const now = input.innerText.trim();
if (now === input._mClearTxt && Date.now() - lastSendTs < SEND_GUARD_MS) {
if (userEditedAfterClear()) { input._mClearTxt = ''; return; }
input.textContent = '';
input._mClearTxt = '';
} else if (now && now !== input._mClearTxt) {
input._mClearTxt = '';
}
});
input.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
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
window.__chatDbReady = function () { return chatDbReady === true; };
window.__chatDbLoadedPrefix = function () {
try {
const p = lastIdbLoadPrefix || '';
return p.indexOf('xy-home-v2:') === 0 ? p.slice('xy-home-v2:'.length) : '';
} catch (e) { return ''; }
};
bootAutoSend();
try { chatPrefetchIfLight(function () { loadMsgs(); }); } catch (e) {}
setTimeout(rpExpireCheck, 2000);
setInterval(rpExpireCheck, 60 * 60 * 1000);
try {
if (window.idbGet) {
['out', 'in'].forEach(function (side) {
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':rp-cover-' + side).then(function (v) {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2) store.set('rp-cover-' + side, v);
});
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
window.mochiMapBubbleCss = function (css, scope) {
scope = scope || '';
var wrap = function (decls) {
return scope + '.msg-out .msg-bubble{' + decls + '!important;}' +
scope + '.msg-in .msg-bubble{' + decls + '!important;}';
};
css = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
if (!css) return { out: '', hint: null };
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
if (!hasMapped && fallbackDecls.length) {
return { out: wrap(fallbackDecls.join(';')), hint: '未认出模板里的气泡类名，已把全部样式整体套用到双方气泡' };
}
return { out: out, hint: null };
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("chat.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("chat.js"); try { console.error("[JS] chat.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[chat.js] " + String(__e && __e.message || __e)); } })();