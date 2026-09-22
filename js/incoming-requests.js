(function () { try {
(function () {
if (!window.activeStore || !window.getContacts) return;
const ROOT = 'xy-home-v2';
const KEY = 'incoming-requests';
const EN_KEY = 'desk-checkin-en';
const CALL_EN_KEY = 'desk-call-en';
const MAX = 20;                       // 队列上限，防膨胀
const CHECK_MS = 60 * 1000;           // 轮询间隔
const chatCoolMs = 3 * 60 * 60 * 1000; // 求聊天冷却（3 小时，比查岗久）
const seenKeepMs = 24 * 60 * 60 * 1000; // seen 记录保留 24h 后清理
const POKE_MSGS = ['在干嘛呢？', '忙完了吗？', '想我了没有？', '我来看看你。'];
const SESSION_ID = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
const PENDING_TTL_MS = 10 * 60 * 1000;
const BUSY_ESCAPE = 3;                // 软互斥最多让路 3 轮（3 分钟），之后照投——防别的弹窗长期占屏变成新的永不触发
function deskCheckinEn() {
try {
const v = window.xyStore(ROOT).get(EN_KEY);
if (v === null || v === undefined || v === '') return true; // 默认开
return v === '1';
} catch (e) { return true; }
}
window.setDeskCheckinEn = function (en) {
try { window.xyStore(ROOT).set(EN_KEY, en ? '1' : '0'); } catch (e) {}
};
function deskCallEn() {
try {
const v = window.xyStore(ROOT).get(CALL_EN_KEY);
if (v === null || v === undefined || v === '') return false; // 默认关
return v === '1';
} catch (e) { return false; }
}
window.setDeskCallEn = function (en) {
try { window.xyStore(ROOT).set(CALL_EN_KEY, en ? '1' : '0'); } catch (e) {}
};
const DMODE_KEY = 'desk-freq-mode';
const DMODES = {
freq:  { label: '频繁', prob: 6,  cool: 15 },   // 概率 6% · 冷却 15 分钟
std:   { label: '标准', prob: 2,  cool: 30 },   // 概率 2% · 冷却 30 分钟
quiet: { label: '安静', prob: 1,  cool: 180 }   // 概率 1% · 冷却 3 小时（默认，最低打扰）
};
function deskFreqMode() {
try {
const v = window.xyStore(ROOT).get(DMODE_KEY);
if (v && DMODES[v]) return v;
} catch (e) {}
return 'quiet';
}
window.setDeskFreqMode = function (m) {
try { window.xyStore(ROOT).set(DMODE_KEY, DMODES[m] ? m : 'quiet'); } catch (e) {}
};
function deskDMode() {
try { return DMODES[deskFreqMode()]; } catch (e) {}
return DMODES.quiet;
}
const NIGHT_KEY = 'night-mode-en';
const NIGHT_FROM = 22;   // 含 22:00
const NIGHT_TO = 7;      // 不含 07:00
function nightModeEn() {
try { return window.xyStore(ROOT).get(NIGHT_KEY) === '1'; } catch (e) { return false; }
}
function isNightHours() {
try { const h = new Date().getHours(); return h >= NIGHT_FROM || h < NIGHT_TO; } catch (e) { return false; }
}
window.nightModeActive = function () { return nightModeEn() && isNightHours(); };
window.setNightModeEn = function (en) {
try { window.xyStore(ROOT).set(NIGHT_KEY, en ? '1' : '0'); } catch (e) {}
};
function addSettingToggle(conf) {
try {
if (document.getElementById(conf.id + '-row')) return;
const anchor = document.getElementById('sf-group-chat-row');
if (!anchor) return;
const row = document.createElement('div');
row.className = 'set-row';
row.id = conf.id + '-row';
const subHtml = conf.subTag
? '<span class="tag" id="' + conf.id + '-tag" role="button" tabindex="0" aria-haspopup="dialog">' + conf.subTag + '</span>'
: (conf.sub ? '<span class="sub">' + conf.sub + '</span>' : '');
row.innerHTML =
'<div class="ico">' + conf.ico + '</div>' +
'<div class="txt">' + conf.title + subHtml + '</div>' +
'<label class="toggle"><input type="checkbox" id="' + conf.id + '"><span class="tk"></span></label>';
if (conf.subTag && conf.detail && typeof window.openModal === 'function') {
const tagEl = row.querySelector('#' + conf.id + '-tag');
if (tagEl) {
const showDetail = function (e) {
if (e) { e.stopPropagation(); e.preventDefault(); }
window.openModal(conf.tagTitle || '功能说明', '', function () {}, { noInput: true, staticText: conf.detail });
};
tagEl.addEventListener('click', showDetail);
tagEl.addEventListener('keydown', function (e) {
if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(); }
});
}
}
anchor.parentNode.insertBefore(row, anchor.nextSibling);
const input = row.querySelector('input');
const sync = function () { const v = conf.get(); if (v !== input.checked) input.checked = v; };
sync();
input.addEventListener('change', function () {
if (input.checked === conf.get()) return;
conf.set(input.checked);
if (typeof window.toast === 'function') window.toast(conf.toast(input.checked));
});
document.addEventListener('contact-switched', sync);
document.addEventListener('mochi-restore-done', sync);
return row;
} catch (e) { return null; }
}
(function () {
addSettingToggle({
id: 'sf-desk-checkin',
ico: '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="14" r="6.5"/><path d="M10 10.8v3.2l2.2 1.3"/><rect x="16.2" y="2" width="5.8" height="8.2" rx="1.7"/></svg>',
title: '联系人跨桌面查岗',
subTag: '功能说明',
tagTitle: '联系人跨桌面查岗',
detail: '其他桌面的联系人是各自独立触发、互不影响：TA 每 60 秒「探测」一次你是否还醒着，触发频率按「跨桌面查岗频率」三档模式全局统一控制（频繁/标准/安静，下方可选，含来电）；同一联系人触发后有冷却、不重复打扰。你回复后 TA 会现场回应。关闭后其他桌面的 TA 不再来查岗、也不再找你聊天。想立刻来一次：聊天 →「更多功能 → TA的提问 → 跨桌面查岗」（不看概率与冷却；本开关关着时只提示、不触发）。',
get: deskCheckinEn,
set: window.setDeskCheckinEn,
toast: function (en) { return en ? '已开启：其他桌面的TA会来查岗、找你聊天' : '已关闭：其他桌面的TA不再来查岗打扰'; }
});
addSettingToggle({
id: 'sf-desk-call',
ico: '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><rect x="16.2" y="2" width="5.8" height="8.2" rx="1.7"/></svg>',
title: '联系人跨桌面打电话',
subTag: '功能说明',
tagTitle: '联系人跨桌面打电话',
detail: '开启后，其他桌面的联系人会主动给你打语音电话（本开关默认关闭，需要用请在下方手动打开；#448）；概率与冷却由下方「跨桌面查岗频率」三档全局统一生效（频繁 6%/15min、标准 2%/30min、安静 1%/3h，对所有桌面联系人同时生效），不再逐个联系人在回复设置里单独调。来电弹出后点「接听」，会先自动跳到来电联系人的桌面再响铃——这是刻意的设计：通话、聊天系统消息和主页通话记录都归属 TA 自己的桌面，方便按联系人分账，切回原桌面不会留下这条记录；若正在通话中，接听会自动挂断当前通话再转接。点「稍后」或弹窗未接，也会在 TA 的桌面留一条未接来电记录。关闭后不再有跨桌面来电。',
get: deskCallEn,
set: window.setDeskCallEn,
toast: function (en) { return en ? '已开启：其他桌面的TA会主动给你打电话' : '已关闭：其他桌面的TA不再主动来电'; }
});
addFreqModeRow();
addNightModeRow();
})();
function nightStatusText() {
if (!nightModeEn()) return '关闭 · 开启后 22:00–7:00 生效';
return isNightHours() ? '开启 · 当前生效中（22:00–7:00）' : '开启 · 当前不在夜间时段（22:00–7:00）';
}
function addNightModeRow() {
try {
if (document.getElementById('sf-night-mode-row')) return;
const anchor = document.getElementById('sf-desk-freq') || document.getElementById('sf-group-chat-row');
if (!anchor) return;
const row = document.createElement('div');
row.className = 'set-row';
row.id = 'sf-night-mode-row';
row.innerHTML =
'<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/><path d="M17 4v3M15.5 5.5h3"/></svg></div>' +
'<div class="txt">夜间模式<span class="tag" id="sf-night-mode-tag" data-setdesc="#sf-night-mode-row" role="button" tabindex="0" aria-haspopup="dialog">功能说明</span><span class="sub" id="sf-night-mode-sub"></span></div>' +
'<label class="toggle"><input type="checkbox" id="sf-night-mode"><span class="tk"></span></label>';
anchor.parentNode.insertBefore(row, anchor.nextSibling);
const input = row.querySelector('input');
const sub = row.querySelector('#sf-night-mode-sub');
const sync = function () {
const v = nightModeEn();
if (v !== input.checked) input.checked = v;
if (sub) sub.textContent = nightStatusText();
};
sync();
input.addEventListener('change', function () {
if (input.checked === nightModeEn()) return;
window.setNightModeEn(input.checked);
sync();
if (typeof window.toast === 'function') {
window.toast(input.checked ? '夜间模式已开启：22:00–7:00 联系人不再主动打扰' : '夜间模式已关闭：恢复联系人主动消息/来电');
}
});
document.addEventListener('contact-switched', sync);
document.addEventListener('mochi-restore-done', sync);
try { setInterval(sync, 60000); } catch (e) {} // 状态文案随时段变化刷新
return row;
} catch (e) { return null; }
}
var freqDetail = '「跨桌面查岗 / 来电」的频率按全局档位统一生效（对所有桌面联系人同时生效）：' +
'\n· 频繁：概率 6%、冷却 15 分钟；' +
'\n· 标准：概率 2%、冷却 30 分钟；' +
'\n· 安静：概率 1%、冷却 3 小时（默认）。' +
'\n\n选档后立即对所有桌面的联系人生效，改一次全绿。只影响「联系人跨桌面查岗 / 来电」的触发频率，不影响桌面上 TA 主动查岗（主动查岗仍按回复设置里各自的概率/冷却）。';
function syncFreqPills() {
try {
const cur = deskFreqMode();
const wrap = document.getElementById('sf-desk-freq');
if (!wrap) return;
wrap.querySelectorAll('.pill').forEach(function (b) {
const on = b.dataset.m === cur;
b.classList.toggle('on', on);
b.style.color = on ? 'var(--ink)' : '';
b.setAttribute('aria-pressed', on ? 'true' : 'false');
});
} catch (e) {}
}
function addFreqModeRow() {
try {
if (document.getElementById('sf-desk-freq')) return;
const anchor = document.getElementById('sf-desk-call-row') ||
document.getElementById('sf-desk-checkin-row') ||
document.getElementById('sf-group-chat-row');
if (!anchor) return;
const row = document.createElement('div');
row.className = 'set-row';
row.id = 'sf-desk-freq';
row.style.cssText = 'flex-direction:column;align-items:stretch;gap:10px;';
row.innerHTML =
'<div class="freq-head" style="display:flex;align-items:center;gap:12px;min-width:0;">' +
'<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>' +
'<div class="txt">跨桌面查岗频率<span class="tag" id="sf-desk-freq-tag" role="button" tabindex="0" aria-haspopup="dialog">功能说明</span></div>' +
'</div>' +
'<div class="freq-pills" style="display:flex;gap:8px;flex-wrap:nowrap;padding-left:34px;"></div>';
const wrap = row.querySelector('.freq-pills');
['freq', 'std', 'quiet'].forEach(function (m) {
const b = document.createElement('button');
b.type = 'button';
b.className = 'pill';
b.dataset.m = m;
b.setAttribute('aria-pressed', 'false');
b.style.cssText = 'flex:1;padding:8px 0;text-align:center;min-width:0;';
b.textContent = DMODES[m].label;
b.addEventListener('click', function () {
window.setDeskFreqMode(m);
syncFreqPills();
try { if (typeof window.openModal === 'function') window.openModal('跨桌面查岗频率', '', function () {}, { noInput: true, staticText: '已切换为「' + DMODES[m].label + '」频率：概率 ' + DMODES[m].prob + '%、冷却 ' + (DMODES[m].cool < 60 ? DMODES[m].cool + ' 分钟' : (DMODES[m].cool / 60) + ' 小时') + '。已对所有桌面联系人生效。' }); } catch (e) {}
});
wrap.appendChild(b);
});
anchor.parentNode.insertBefore(row, anchor.nextSibling);
try {
const setGroup = row.parentNode;
['sf-desk-checkin-row', 'sf-desk-call-row', 'sf-desk-freq'].forEach(function (id) {
const el = setGroup.querySelector('#' + id);
if (el) setGroup.appendChild(el);
});
} catch (e) {}
const tagEl = row.querySelector('#sf-desk-freq-tag');
if (tagEl && typeof window.openModal === 'function') {
const showDetail = function (e) {
if (e) { e.stopPropagation(); e.preventDefault(); }
window.openModal('跨桌面查岗频率', '', function () {}, { noInput: true, staticText: freqDetail });
};
tagEl.addEventListener('click', showDetail);
tagEl.addEventListener('keydown', function (e) {
if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(); }
});
}
syncFreqPills();
document.addEventListener('contact-switched', syncFreqPills);
document.addEventListener('mochi-restore-done', syncFreqPills);
} catch (e) {}
}
function rootGet(k) { try { return window.xyStore(ROOT).get(k); } catch (e) { return null; } }
function rootSet(k, v) { try { window.xyStore(ROOT).set(k, v); } catch (e) {} }
var ticks = 0;                         // 本会话轮询次数（诊断：定时器活着吗）
var busyTicks = 0;                     // 连续让路轮数（软互斥逃逸计数）
var releaseLog = [];                   // 最近释放事件（环形 3 条，供诊断回看）
var liveModals = {};                   // 本会话已投出的前台弹窗：cid -> 当时的弹窗标题
function noteRelease(msg) {
releaseLog.push(msg + '@' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
if (releaseLog.length > 3) releaseLog.shift();
}
function hardLocked() {
const el = document.getElementById('applock-mask');
return !!(el && !el.hidden);
}
function layerBusy() {
return ['modal-mask', 'tc-mask', 'qa-mask', 'call-mask'].some(function (id) {
const el = document.getElementById(id);
return el && !el.hidden;
});
}
function typingBusy() {
const ae = document.activeElement;
if (!ae || ae === document.body) return false;
const ci = document.getElementById('chat-input');
if (ci && ae === ci) return true;
return ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable === true;
}
function reconcileLiveModals() {
const mask = document.getElementById('modal-mask');
const titleEl = document.getElementById('modal-title');
Object.keys(liveModals).forEach(function (cid) {
const ours = !!(mask && !mask.hidden && titleEl && titleEl.textContent === liveModals[cid]);
if (ours) return;
delete liveModals[cid];
var wasCall = queue().some(function (x) { return x.cid === cid && x.status === 'pending' && x.kind === 'call'; });
if (setStatus(cid, 'seen')) {
noteRelease('弹窗消失未应答，释放 ' + cName(cid));
if (wasCall && window.callRecordMissed) window.callRecordMissed(cid, cName(cid));
}
});
}
function queue() {
let q = [];
try { const v = rootGet(KEY); if (v) { const a = JSON.parse(v); if (Array.isArray(a)) q = a; } } catch (e) {}
const now = Date.now();
let healed = 0;
q.forEach(function (x) {
if (x.status === 'pending' && x.sid !== SESSION_ID && now - (x.ts || 0) > PENDING_TTL_MS) {
x.status = 'seen'; x.ts = now; healed++;
if (x.kind === 'call' && window.callRecordMissed) { try { window.callRecordMissed(x.cid, cName(x.cid)); } catch (e) {} }
}
});
const filtered = q.filter(x => x.status !== 'seen' || now - (x.ts || 0) < seenKeepMs);
if (healed || filtered.length !== q.length) { rootSet(KEY, JSON.stringify(filtered)); q = filtered; }
if (healed) noteRelease('跨会话孤儿 pending 释放 ' + healed + ' 条');
return q;
}
function saveQ(q) { rootSet(KEY, JSON.stringify(q.slice(-MAX))); }
function cName(cid) {
try {
const c = (window.getContacts() || []).find(x => x.id === cid);
if (c && c.name) return c.name;
} catch (e) {}
return cid === 'default' ? 'TA' : 'TA';
}
function cAvatar(cid) {
try {
const s = (cid && window.storeFor) ? window.storeFor(cid) : window.activeStore;
let a = s.get('cs-avatar-partner') || s.get('feed-ta-avatar') || s.get('avatar-partner') || '';
if (!a && cid === 'default' && window.xyStore) {
a = window.xyStore('xy-home-v2').get('feed-ta-avatar') || '';
}
return (a && (a.indexOf('data:') === 0 || /^https?:\/\//i.test(a))) ? a : '';
} catch (e) { return ''; }
}
function deskQSeenRecently(cid, text) {
if (!text) return false;
try {
const raw = localStorage.getItem('xy-home-v2:' + cid + ':chat-msgs');
if (!raw) return false;
const arr = JSON.parse(raw);
if (!Array.isArray(arr)) return false;
const cutoff = Date.now() - 60 * 60000; // 1 小时窗口（超出则视为新的正常查岗）
const norm = String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '');
if (norm.length < 2) return false;
for (let i = arr.length - 1, n = 0; i >= 0 && n < 150; i--, n++) {
const m = arr[i];
if (!m) continue;
const mts = m.ts || 0;
if (mts && mts < cutoff) break;
let t = String(m.text || '');
if (t.indexOf('|||') >= 0) t = t.split('|||')[0];
t = t.replace(/\|[^|]*$/, '').replace(/<[^>]*>/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '');
if (!t) continue;
if (t.length >= 6 && norm.length >= 6 && (t.indexOf(norm) >= 0 || norm.indexOf(t) >= 0)) return true;
if (norm === t) return true;
}
} catch (e) {}
return false;
}
function cfgFor(cid) {
try {
if (window.replyCfgFor) return window.replyCfgFor(cid);
} catch (e) {}
return {};
}
function num(c, k, def) { const v = c && c[k]; if (typeof v === 'number' && v >= 0) return v; return def; }
function lastKey(cid, kind) { return 'incoming-last:' + kind + ':' + cid; }
function lastAt(cid, kind) { try { const v = rootGet(lastKey(cid, kind)); return parseInt(v, 10) || 0; } catch (e) { return 0; } }
function markLast(cid, kind) { try { rootSet(lastKey(cid, kind), String(Date.now())); } catch (e) {} }
function hasPending(cid) { return queue().some(x => x.cid === cid && x.status === 'pending'); }
function setStatus(cid, status) {
const q = queue();
let hit = false;
q.forEach(x => { if (x.cid === cid && x.status === 'pending') { x.status = status; x.ts = Date.now(); hit = true; } });
if (hit) saveQ(q);
return hit;
}
function deliver(req, force) {
const q = queue();
if (q.some(x => x.cid === req.cid && x.status === 'pending')) return false; // 未处理不重复
if (req.kind === 'call' && window.callInProgress && window.callInProgress()) return false;
if (!document.hidden && (hardLocked() || typingBusy())) return false;
if (!force && !document.hidden && layerBusy()) return false;
req.sid = SESSION_ID;   // v3.26.x #264：弹窗只活在本页面会话，标记归属才能识别跨会话孤儿
q.push(req);
saveQ(q);
markLast(req.cid, req.kind);
const name = cName(req.cid);
const title = req.kind === 'chat' ? name + ' 想找你聊天' : (req.kind === 'call' ? name + ' 来电了' : name + ' 来查岗了');
if (document.hidden) {
try {
const av = cAvatar(req.cid);
if (req.kind === 'call') {
if (window.callHoldIncoming) window.callHoldIncoming(name, req.cid, av);
else if (window.bgNotifyCheck) window.bgNotifyCheck(title, Date.now(), { name: name + '来电', av: av, avFixed: true, force: true });
} else if (req.kind === 'checkin') {
if (!deskQSeenRecently(req.cid, req.text)) {
if (window.chatAppendDeskCkTo) window.chatAppendDeskCkTo(req.cid, req.q);
try { if (window.addCareRecordFor) window.addCareRecordFor(req.cid, 'desk-checkin', req.text, Date.now()); } catch (e) {}
if (window.bgNotifyCheck) window.bgNotifyCheck(title + '：' + (req.text || ''), Date.now(), { name: name + '查岗', av: av, avFixed: true });
}
} else { // chat 求聊天
if (window.chatAppendDeskTextTo) window.chatAppendDeskTextTo(req.cid, req.text || '想你了，来聊聊天吧。');
if (window.bgNotifyCheck) window.bgNotifyCheck(title + '：来陪我聊聊天吧', Date.now(), { name: name + '来聊天', av: av, avFixed: true });
}
} catch (e) {}
setStatus(req.cid, 'seen');
return true;
}
if (!window.openModal) return true;
const okText = req.kind === 'chat' ? '同意' : (req.kind === 'call' ? '接听' : '现在回TA');
const staticText = req.kind === 'call'
? '想听听你的声音，接一下好吗？'
: (req.kind === 'chat' ? '想和你聊聊天，忙完记得过来。' : '想看看你在做什么，来陪陪我呀。') + '\n' + (req.text || '');
let modalCtl = null;
modalCtl = window.openModal(title, '', function (v) {
if (v === null || v === undefined) {
try { if (modalCtl && modalCtl.stay) modalCtl.stay(); } catch (e) {}
try { if (typeof window.toast === 'function') window.toast('请先选择「' + okText + '」或「稍后」'); } catch (e) {}
return;
}
delete liveModals[req.cid]; // 已应答（无论选哪边）→ 不再需要对账
if (v === 'later') {
if (req.kind === 'checkin' && !deskQSeenRecently(req.cid, req.text)) {
try { if (window.chatAppendDeskCkTo) window.chatAppendDeskCkTo(req.cid, req.q); } catch (e) {}
try { if (window.addCareRecordFor) window.addCareRecordFor(req.cid, 'desk-checkin', req.text, Date.now()); } catch (e) {}
}
if (req.kind === 'call' && window.callRecordMissed) window.callRecordMissed(req.cid, cName(req.cid));
setStatus(req.cid, 'seen');
return;
}
goReply(req);
}, {
noInput: true,
lock: true,
staticText: staticText,
pills: [{ label: '稍后', value: 'later' }, { label: okText, value: 'reply' }],
pill: req.kind === 'call' ? undefined : 'reply'
});
try { if (modalCtl && modalCtl.okText) modalCtl.okText('确认'); } catch (e) {}
liveModals[req.cid] = title; // v3.26.x #264：登记活弹窗，弹窗被顶掉/关闭时对账释放 pending
return true;
}
function goReply(req) {
const cid = req.cid;
try {
if (window.setActiveContact && cid !== (window.__activeCid || 'default')) window.setActiveContact(cid);
} catch (e) {}
setStatus(cid, 'accepted');
if (req.kind === 'call') {
try { if (window.getCallState && window.getCallState() && window.hangupCall) window.hangupCall(); } catch (e) {}
setTimeout(function () { fire(req); }, 300);
return;
}
try {
if (window.enterChat) window.enterChat();
} catch (e) {}
const once = { done: false };
const tries = { n: 0 };
const poll = function () {
tries.n++;
const ready = !!(window.__chatDbReady && window.__chatDbReady());
if (ready || tries.n > 120) {
if (once.done) return;
once.done = true;
fire(req);
return;
}
setTimeout(poll, 250);
};
setTimeout(poll, 300);
}
function ensureTaName(cid) {
try {
const s = (cid && window.storeFor) ? window.storeFor(cid) : null;
if (!s) return;
const cur = s.get('lbl-partner');
if (cur) return;
const c = (window.getContacts() || []).find(x => x.id === cid);
if (c && c.name) s.set('lbl-partner', c.name);
} catch (e) {}
}
function fire(req) {
try {
if (req.kind === 'call') {
ensureTaName(req.cid);
if (window.triggerIncomingCall) window.triggerIncomingCall();
return;
}
if (req.kind === 'checkin') {
ensureTaName(req.cid);
if (window.addCareRecordFor) {
try { window.addCareRecordFor(req.cid, 'desk-checkin', req.text, Date.now()); } catch (e) {}
}
let q = (req.q && req.q.text) ? req.q : (window.ckQuestionPickFor ? window.ckQuestionPickFor(req.cid) : null);
if (!q || !q.text) q = window.ckQuestionPickFor ? window.ckQuestionPickFor(req.cid) : null;
if (q && q.text) {
if (window.ckQuestionFire) window.ckQuestionFire(q, cfgFor(req.cid));
else if (window.triggerCkQuestion) window.triggerCkQuestion();
return;
}
}
const text = req.kind === 'chat'
? (req.text || '想你了，来聊聊天吧。')
: '我来找你了。';
if (window.chatAddIn) {
window.chatAddIn(text, { initiative: true });
if (window.showTyping) { try { window.showTyping(); } catch (e) {} }
}
} catch (e) {}
}
function maybeIncoming() {
try {
try { if (window.__mochiPhase) window.__mochiPhase('xd-poll'); } catch (e0) {}
ticks++;
reconcileLiveModals();
if (window.nightModeActive && window.nightModeActive()) return;
if (hardLocked()) return;
var escape = false; // 本轮一次性额度：只授权顶掉一次屏幕，投成功即收回
if (typingBusy()) return;
if (layerBusy()) {
busyTicks++;
if (busyTicks <= BUSY_ESCAPE) return;
busyTicks = 0; escape = true; // 照投后重新计票，避免长期占屏时每一轮都去顶它
} else busyTicks = 0;
const cur = window.__activeCid || 'default';
const list = window.getContacts() || [];
if (list.length < 2) return; // 只有当前桌面：无需跨桌面打扰
list.forEach(function (c) {
const cid = c.id;
if (cid === cur) return; // 激活桌面不跨桌面打扰（由原 tryAutoSend 正常触发）
if (hasPending(cid)) return; // 已有未处理申请，不重复
const cfg = cfgFor(cid);
if (deskCallEn() && !(window.callInProgress && window.callInProgress())) {
const dm = deskDMode();
const callCool = dm.cool;
const callProb = dm.prob;
if (Date.now() - lastAt(cid, 'call') >= callCool * 60000 && Math.random() * 100 < callProb) {
if (deliver({ cid: cid, kind: 'call', text: '', ts: Date.now(), status: 'pending' }, escape)) escape = false;
return;
}
}
if (deskCheckinEn() && num(cfg, 'ckq-en', 0) === 1) {
const dm = deskDMode();
const cool = dm.cool;
const prob = dm.prob;
if (Date.now() - lastAt(cid, 'checkin') >= cool * 60000 && Math.random() * 100 < prob) {
const q = window.ckQuestionPickFor ? window.ckQuestionPickFor(cid) : null;
if (q && q.text) {
const showText = q.type === 'action' ? (q.taToMe || q.text) : q.text;
if (deliver({ cid: cid, kind: 'checkin', text: showText, q: q, ts: Date.now(), status: 'pending' }, escape)) escape = false;
return;
}
}
}
if (deskCheckinEn() && num(cfg, 'as-en', 0) === 1) {
const prob = num(cfg, 'as-prob', 30);
if (Date.now() - lastAt(cid, 'chat') >= chatCoolMs && Math.random() * 100 < prob) {
if (deliver({ cid: cid, kind: 'chat', text: '想和你聊聊天，你有空吗？', ts: Date.now(), status: 'pending' }, escape)) escape = false;
}
}
});
} catch (e) {}
}
window.triggerIncomingCheckin = function (cid) {
if (!deskCheckinEn()) { try { if (window.toast) window.toast('联系人跨桌面查岗已关闭（可在设置里开启）'); } catch (e) {} return false; }
const q = window.ckQuestionPickFor ? window.ckQuestionPickFor(cid || 'default') : null;
if (!q || !q.text) return false;
return deliver({ cid: cid || 'default', kind: 'checkin', text: q.text, q: q, ts: Date.now(), status: 'pending' }, true);
};
window.triggerIncomingCheckinNow = function () {
try {
const _toast = function (t) { try { if (typeof window.toast === 'function') window.toast(t); } catch (e) {} };
if (!deskCheckinEn()) { _toast('联系人跨桌面查岗已关闭，可在 设置 里开启'); return false; }
const cur = window.__activeCid || 'default';
const others = (window.getContacts() || []).filter(function (c) { return c && c.id !== cur; });
if (!others.length) { _toast('只有当前桌面，没有其他桌面的联系人'); return false; }
const pool = others.filter(function (c) { return num(cfgFor(c.id), 'ckq-en', 1) === 1 && !hasPending(c.id); });
if (!pool.length) { _toast('其他桌面的联系人都关了「TA 主动查岗」，可在 回复设置 → 查岗 里开启'); return false; }
const who = pool[Math.floor(Math.random() * pool.length)];
const fired = window.triggerIncomingCheckin(who.id);
if (!fired) _toast('这个桌面的查岗题库是空的，可在 字卡库 →「TA的查岗」里添加或开启');
return fired;
} catch (e) { return false; }
};
window.triggerIncomingCallReq = function (cid) {
if (!deskCallEn()) { try { if (window.toast) window.toast('联系人跨桌面打电话已关闭（可在设置里开启）'); } catch (e) {} return false; }
return deliver({ cid: cid || 'default', kind: 'call', text: '', ts: Date.now(), status: 'pending' }, true);
};
window.__mochiIncomingProbe = function () {
try {
const dm = deskDMode();
const cur = window.__activeCid || 'default';
const now = Date.now();
const q = queue();
const next = (window.getContacts() || []).filter(c => c.id !== cur).slice(0, 6).map(function (c) {
const wCall = dm.cool * 60000 - (now - lastAt(c.id, 'call'));
const wCk = dm.cool * 60000 - (now - lastAt(c.id, 'checkin'));
return c.name + ' 来电' + (wCall > 0 ? Math.ceil(wCall / 60000) + 'min' : '可掷') +
'·查岗' + (wCk > 0 ? Math.ceil(wCk / 60000) + 'min' : '可掷');
});
return {
ticks: ticks,
mode: deskFreqMode(), prob: dm.prob, cool: dm.cool,
pending: q.filter(function (x) { return x.status === 'pending'; }).length,
live: Object.keys(liveModals).length,
gate: hardLocked() ? '锁屏中' : (typingBusy() ? '输入中暂停' : (layerBusy() ? ('浮层占用让路' + busyTicks + '/' + BUSY_ESCAPE) : '空闲')),
hidden: !!document.hidden,
next: next,
releases: releaseLog.slice(-2)
};
} catch (e) { return null; }
};
var started = false;
function startIncomingTick() {
if (started) return;
started = true;
maybeIncoming();
setInterval(maybeIncoming, CHECK_MS);
}
setTimeout(startIncomingTick, 12000);
document.addEventListener('visibilitychange', function () {
if (document.hidden || !started) return;
reconcileLiveModals();
setTimeout(maybeIncoming, 3000);
});
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("incoming-requests.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("incoming-requests.js"); try { console.error("[JS] incoming-requests.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[incoming-requests.js] " + String(__e && __e.message || __e)); } })();