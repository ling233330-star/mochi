(function () { try {
(function () {
const store = window.activeStore();
const KEY = 'mail-letters';
const SNAP_KEY = 'mail-letters-snap';
const LS_BIG_LIMIT = 200 * 1024;
const TITLES = ['好久不见', '最近还好吗', '想你了', '给你写了封信', '深夜随想', '一些想说的话'];
let mtab = 'in';
let viewLetter = null;
function partnerName() { return store.get('lbl-partner') || 'TA'; }
function fmtDT(ts) {
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
function csFor(cid) { return cid ? window.storeFor(cid) : store; }
function prefixFor(cid) { return cid ? ('xy-home-v2:' + cid) : window.activePrefix(); }
function snapKey(cid) { return prefixFor(cid) + ':' + SNAP_KEY; }
const _loadCache = new Map();
function cachedParse(k, raw) {
let list;
const hit = _loadCache.get(k);
if (hit && hit.raw === raw) {
list = hit.list;
} else {
try { list = JSON.parse(raw); } catch (e) { list = null; }
if (!Array.isArray(list)) return [];
if (_loadCache.size > 8) _loadCache.delete(_loadCache.keys().next().value);
_loadCache.set(k, { raw, list });
}
return list.map(x => (x && typeof x === 'object') ? Object.assign({}, x) : x);
}
function loadSnap(cid) {
try {
const k = snapKey(cid);
const v = localStorage.getItem(k);
if (v) return cachedParse(k, v);
} catch (e) {}
return [];
}
function stripLetterImg(l) {
if (!l || typeof l !== 'object') return l;
const c = Object.assign({}, l);
const strip = (s) => { if (typeof s !== 'string') return s; let t = s.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[图片]'); t = mailCleanDisplay(t); if (t.length > 8192) t = t.slice(0, 8192) + '…'; return t; };
c.content = strip(c.content);
if (c.myReply) { c.myReply = Object.assign({}, c.myReply); c.myReply.content = strip(c.myReply.content); }
if (c.partnerReply) { c.partnerReply = Object.assign({}, c.partnerReply); c.partnerReply.content = strip(c.partnerReply.content); }
return c;
}
function writeSnap(list, cid) {
if (!list || !list.length) { try { localStorage.removeItem(snapKey(cid)); } catch (e) {} return; }
try { const snap = JSON.stringify(list.map(stripLetterImg)); if (snap.length <= LS_BIG_LIMIT) localStorage.setItem(snapKey(cid), snap); } catch (e) {}
}
function load(cid) {
const cs = csFor(cid);
let list = [];
const raw = cs.get(KEY);
if (raw !== null) list = cachedParse(prefixFor(cid) + ':' + KEY, raw);
if (!list.length) { try { const v = loadSnap(cid); if (v.length) list = v; } catch (e) {} }
if (!cid && !mailDbReady && mailPending && mailPending.length) {
const map = {};
list.forEach(x => { if (x && x.id) map[x.id] = x; });
mailPending.forEach(x => { if (x && x.id) map[x.id] = x; });
list = Object.keys(map).map(k => map[k]).sort((a, b) => (b.tm || 0) - (a.tm || 0));
}
return list;
}
function letterLen(o) {
let n = 0;
const a = o && typeof o.content === 'string' ? o.content : '';
const b = o && o.myReply && typeof o.myReply.content === 'string' ? o.myReply.content : '';
const c = o && o.partnerReply && typeof o.partnerReply.content === 'string' ? o.partnerReply.content : '';
return a.length + b.length + c.length;
}
function hasRealImg(o) {
const s = [o && o.content, o && o.myReply && o.myReply.content, o && o.partnerReply && o.partnerReply.content].join(' ');
return /data:image\//.test(s || '') || (!!window.mochiMediaIsToken && s.split(' ').some(window.mochiMediaIsToken));
}
function mergeLists(a, b) {
const map = {};
const longer = (x, y) => (String(x || '').length >= String(y || '').length) ? x : y;
const put = (x) => {
if (!x || !x.id) return;
const prev = map[x.id];
if (!prev) { map[x.id] = x; return; }
const merged = Object.assign({}, prev);
const xImg = hasRealImg(x), pImg = hasRealImg(prev);
if (xImg && !pImg) merged.content = x.content;
else if (!xImg && pImg) merged.content = prev.content;
else merged.content = longer(x.content, prev.content);
if (x.myReply && !prev.myReply) merged.myReply = x.myReply;
else if (prev.myReply && !x.myReply) merged.myReply = prev.myReply;
else if (x.myReply && prev.myReply) {
merged.myReply = Object.assign({}, longer(String(x.myReply.content||'').length >= String(prev.myReply.content||'').length ? x.myReply : prev.myReply));
}
if (x.partnerReply && !prev.partnerReply) merged.partnerReply = x.partnerReply;
else if (prev.partnerReply && !x.partnerReply) merged.partnerReply = prev.partnerReply;
else if (x.partnerReply && prev.partnerReply) {
merged.partnerReply = Object.assign({}, longer(String(x.partnerReply.content||'').length >= String(prev.partnerReply.content||'').length ? x.partnerReply : prev.partnerReply));
}
if (x.read || prev.read) merged.read = true;
map[x.id] = merged;
};
(a || []).forEach(put);
(b || []).forEach(put);
return Object.keys(map).map(k => map[k]).sort((x, y) => (y.tm || 0) - (x.tm || 0));
}
let mailDbReady = false;
let mailPending = null;
function save(list, cid) {
if (!cid && !mailDbReady) { try { mailPending = (list || []).slice(); } catch (e) {} writeSnap(list, cid); return; }
csFor(cid).set(KEY, JSON.stringify(list));
writeSnap(list, cid);
}
function updateBadge() {
const badge = document.getElementById('mail-badge');
if (!badge && !window.setDeskBadge) return;
try {
const unread = load().filter(l => l.type === 'received' && !l.read && !l.myReply).length;
if (window.setDeskBadge) { window.setDeskBadge('mail', unread); return; }
if (!badge) return;
if (unread > 0) {
badge.textContent = unread > 99 ? '99+' : String(unread);
badge.hidden = false;
} else {
badge.hidden = true;
}
} catch (e) {}
}
function mailPageVisible() {
return ['page-mail', 'page-mail-write', 'page-mail-reply'].some(id => {
const el = document.getElementById(id);
return el && !el.hidden;
});
}
function openMailPage() {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const mp = document.getElementById('page-mail');
if (mp) mp.hidden = false;
try { checkPendingReply(); } catch (e) {}
render();
updateBadge();
}
window.openMailPage = openMailPage;
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function renderBody(content, fit) {
const s = mailCleanDisplay(String(content || ''));
const seg = (t) => {
t = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
return (fit && window.taFit) ? window.taFit(t) : t;
};
const RE = /((?:sticker|image):)?(https?:\/\/[^\s"'<>]+|data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+|@@m:[0-9a-f]{32})/g;
return s.replace(RE, function (all, pre, src) {
if (src.indexOf('http') === 0 && pre !== 'sticker:' && pre !== 'image:') {
return seg(all); // 普通网址（无附图前缀）按文本保留
}
const attrs = String(src).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
return '<img class="mail-body-img" decoding="async" src="' + attrs + '" alt="表情"> ';
});
}
function shortDesc(s, fit) {
const str = mailCleanDisplay(String(s || ''));
const cleaned = str
.replace(/(?:sticker|image):data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '')
.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '')
.replace(/@@m:[0-9a-f]{32}/g, '')
.replace(/\s+/g, ' ').trim();
let out = escHtml((cleaned || '（图片）').slice(0, 30));
if (fit && window.taFit) out = window.taFit(out);
return out;
}
function letterPaper(title, content, date, author, fit) {
return '<div class="mail-paper">' +
'<div class="mail-paper-head"><span class="mail-paper-author">' + escHtml(author) + '</span><span class="mail-paper-date">' + date + '</span></div>' +
(title ? '<div class="mail-paper-title">' + escHtml(title) + '</div>' : '') +
'<div class="mail-paper-body">' + renderBody(content, fit) + '</div>' +
'</div>';
}
function bindLetterImgClicks(root) {
if (!root) return;
root.querySelectorAll('.mail-body-img').forEach(im => {
im.addEventListener('click', (e) => {
e.stopPropagation();
if (window.viewChatImage) window.viewChatImage(im.src);
});
});
}
function openLetter(l) {
try {
if (l && l.id) {
const fresh = load().find(x => x.id === l.id);
if (fresh && fresh.id) l = fresh;
}
} catch (e) {}
viewLetter = l;
if (l && l.type === 'received' && !l.read) {
try {
l.read = true;
const list = load();
const idx = list.findIndex(x => x.id === l.id);
if (idx >= 0) { list[idx].read = true; save(list); }
} catch (e) {}
}
updateBadge();
const name = partnerName();
const myName = store.get('lbl-user') || '我';
let html = '';
if (l.type === 'received' || l.fromMe) {
html += letterPaper(l.tt || '来信', l.content, fmtDT(l.tm), l.fromMe ? myName : name, !l.fromMe);
} else if (l.type === 'sent') {
html += letterPaper(l.tt || '寄出的信', l.content, fmtDT(l.tm), myName, false);
}
if (l.myReply && l.type !== 'sent') html += letterPaper('我的回信', l.myReply.content, fmtDT(l.myReply.tm), myName, false);
if (l.partnerReply) html += letterPaper('对方的回信', l.partnerReply.content, fmtDT(l.partnerReply.tm), name, true);
const canFav = l.type === 'received';
let favAlready = false;
if (canFav) {
try {
const favArr = JSON.parse(store.get('fav-msgs') || '[]');
favAlready = favArr.some(x => (x.kind || 'msg') === 'mail' && x.mailType === 'received' && (x.text || '') === (l.content || '') && x.ts === l.tm);
} catch (e) {}
}
let footer = '';
if (canFav && !l.myReply) {
footer = '<div class="mail-actions"><button class="cc-tool" id="mail-fav-btn">' + (favAlready ? '已收藏' : '收藏来信') + '</button><button class="cc-tool" id="mail-reply-btn">提笔回信</button><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
} else if (canFav) {
footer = '<div class="mail-actions"><button class="cc-tool" id="mail-fav-btn">' + (favAlready ? '已收藏' : '收藏来信') + '</button><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
} else {
footer = '<div class="mail-actions"><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
}
let panelOpened = false;
try {
if (window.openTCPanel) {
window.openTCPanel('信件', html + footer);
const mk = document.getElementById('tc-mask');
panelOpened = !!(mk && !mk.hidden);
const tcb = document.getElementById('tc-body');
if (panelOpened && tcb && !tcb.querySelector('.mail-paper')) {
tcb.innerHTML = html + footer;
}
}
} catch (e) {}
if (!panelOpened && window.openModal) {
const stripImg = (s) => String(s == null ? '' : s).replace(/(?:sticker|image:)?data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '［图片］');
let txt = (l.tt ? '【' + l.tt + '】\n' : '') + stripImg(l.content);
if (l.myReply && l.type !== 'sent') txt += '\n\n—— 我的回信 ——\n' + stripImg(l.myReply.content);
if (l.partnerReply) txt += '\n\n—— 对方的回信 ——\n' + stripImg(l.partnerReply.content);
window.openModal(l.fromMe ? '寄出的信' : '信件', '', () => {}, { noInput: true, staticText: txt });
}
bindLetterImgClicks(document.getElementById('tc-body'));
const close2 = document.getElementById('mail-close2');
if (close2) close2.addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; viewLetter = null; });
const replyBtn = document.getElementById('mail-reply-btn');
if (replyBtn) replyBtn.addEventListener('click', () => openReply(l));
const delBtn = document.getElementById('mail-del-btn');
if (delBtn) delBtn.addEventListener('click', () => deleteLetter(l));
const favBtn = document.getElementById('mail-fav-btn');
if (favBtn) favBtn.addEventListener('click', () => {
if (window.addMyFavItem) {
const ok = window.addMyFavItem({ kind: 'mail', mailType: 'received', title: l.tt || '', text: l.content || '', ts: l.tm || Date.now() });
toast(ok ? '已收藏到我的收藏' : '这封来信已收藏过');
if (ok) favBtn.textContent = '已收藏';
}
});
}
function showPage(id) {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const el = document.getElementById(id);
if (el) el.hidden = false;
}
function openReply(l) {
try {
if (l && l.id) {
const fresh = load().find(x => x.id === l.id);
if (fresh && fresh.id) l = fresh;
}
} catch (e) {}
viewLetter = l;
const name = partnerName();
const origEl = document.getElementById('mail-reply-original');
if (origEl) {
origEl.innerHTML = letterPaper(l.tt || '来信', l.content, fmtDT(l.tm), name, true);
bindLetterImgClicks(origEl);
}
const toEl = document.getElementById('mail-reply-to');
if (toEl) toEl.textContent = name;
const input = document.getElementById('mail-reply-input');
if (input) input.value = '';
document.getElementById('tc-mask').hidden = true;
showPage('page-mail-reply');
}
function submitReply() {
const l = viewLetter;
if (!l) return;
const val = readMailVal(document.getElementById('mail-reply-input')).trim();
if (!val) { toast('回信内容不能为空'); return; }
const name = partnerName();
const list = load();
const idx = list.findIndex(x => x.id === l.id);
if (idx >= 0 && !list[idx].myReply) {
list[idx].myReply = { content: val, tm: Date.now() };
const cfg = mailCfg();
if (Math.random() * 100 < cfg.replyProb) {
const replyMsg = taLetterContent(cfg);
const delayMs = (cfg.replyMin + Math.random() * Math.max(1, cfg.replyMax - cfg.replyMin)) * 60000;
const pending = replyPendingLoad();
pending.push({ id: l.id, due: Date.now() + delayMs, content: replyMsg });
replyPendingSave(pending);
}
save(list);
viewLetter = null;
showPage('page-mail');
selectMailTab('in');
render();
updateBadge();
if (window.chatAddSystem) window.chatAddSystem('你给 ' + name + ' 回了一封信', { mailNotice: true });
toast('回信已寄出');
if (Math.random() * 100 < (window.favCfg ? window.favCfg().taMail : 30) && window.addTaFavItem) {
window.addTaFavItem({ kind: 'mail', title: l.tt || '', text: val, ts: Date.now() });
setTimeout(() => toast(window.taFit ? window.taFit('TA 收藏了你的回信') : 'TA 收藏了你的回信'), 1200);
}
}
}
const REPLY_PENDING_KEY = 'mail-reply-pending';
function replyPendingLoad(cid) {
try { const v = JSON.parse(csFor(cid).get(REPLY_PENDING_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function replyPendingSave(arr, cid) { try { csFor(cid).set(REPLY_PENDING_KEY, JSON.stringify(arr)); } catch (e) {} }
function notifyMailToChat(cid, text, opts) {
const cur = window.__activeCid || 'default';
if (cid === cur) {
if (window.chatAddSystem) window.chatAddSystem(text, { mailNotice: !!(opts && opts.mailNotice) });
return;
}
if (window.chatAppendToDeskMsg) { window.chatAppendToDeskMsg(cid, text, { mailNotice: !!(opts && opts.mailNotice) }); }
}
function partnerNameFor(cid) {
try {
const cs = csFor(cid);
const v = cs.get('lbl-partner');
if (v) return v;
if (window.getContacts) {
const c = window.getContacts().find(x => x.id === cid);
if (c && c.name) return c.name;
}
} catch (e) {}
return 'TA';
}
function checkPendingReplyFor(cid) {
try {
if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
const now = Date.now();
const pending = replyPendingLoad(cid);
if (!pending.length) return;
const name = partnerNameFor(cid);
const rest = [];
let changed = false;
const list = load(cid);
let landed = false;
pending.forEach(p => {
if (!p || !p.id) { changed = true; return; }
const idx = list.findIndex(x => x.id === p.id);
if (idx < 0) { changed = true; return; }          // 信件已不存在 → 丢弃计划
if (list[idx].partnerReply) { changed = true; return; } // 已有 TA 回信 → 丢弃计划
if (p.due > now) { rest.push(p); return; }        // 未到期 → 保留
list[idx].partnerReply = { content: p.content, tm: now };
landed = true;
notifyMailToChat(cid, name + ' 给你回了信', { mailNotice: true });
if (cid === (window.__activeCid || 'default') && window.showDeskPopup && !mailPageVisible()) {
window.showDeskPopup({ name: '信箱', text: '给你回了一封信：' + String(p.content || '').replace(/@@m:[0-9a-f]{32}/g, '[图片]').replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]'), onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
}
changed = true;
});
if (landed) save(list, cid);
if (changed) replyPendingSave(rest, cid);
if (cid === (window.__activeCid || 'default')) { render(); updateBadge(); }
} catch (e) {}
}
function checkPendingReply() {
const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
list.forEach(c => checkPendingReplyFor(c.id));
}
function mailItemHtml(l, dir, name) {
const tag = dir === 'in'
? (l.myReply ? ' <span class="mail-tag">已回信</span>' : (l.read ? '' : ' <span class="mail-tag new">新来信</span>'))
: (l.partnerReply ? ' <span class="mail-tag">对方已回信</span>' : '');
return '<div class="mail-item" data-id="' + escHtml(l.id) + '">' +
'<div class="mail-item-av"><svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></div>' +
'<div class="mail-item-body"><div class="mail-item-title">' + (dir === 'in' ? '来自 ' : '寄给 ') + name + tag + '</div>' +
'<div class="mail-item-desc">' + shortDesc(l.content, dir === 'in') + '</div></div>' +
'<div class="mail-item-time">' + fmtDT(l.tm) + '</div></div>';
}
function render() {
const mpEl = document.getElementById('page-mail');
if (mpEl && mpEl.hidden) return;
const list = load().slice().sort((a, b) => b.tm - a.tm);
const name = partnerName();
const inEl = document.getElementById('mail-in-list');
const outEl = document.getElementById('mail-out-list');
const inList = list.filter(l => l.type === 'received');
if (inEl) {
const inHtml = inList.map(l => mailItemHtml(l, 'in', name)).join('');
inEl.innerHTML = inHtml || ((window.mochiDataPending && window.mochiDataPending())
? window.mochiLoadingHtml('收到的信')
: '<div class="ta-empty">' + (window.taFit ? window.taFit('还没有收到信，等等 TA 吧') : '还没有收到信，等等 TA 吧') + '</div>');
if (inList.length && inEl.querySelectorAll('.mail-item').length < inList.length) inEl.innerHTML = inHtml;
}
const outList = list.filter(l => l.type === 'sent');
if (outEl) {
const outHtml = outList.map(l => mailItemHtml(l, 'out', name)).join('');
outEl.innerHTML = outHtml || ((window.mochiDataPending && window.mochiDataPending())
? window.mochiLoadingHtml('寄出的信')
: '<div class="ta-empty">还没有寄出任何信，提笔写一封吧</div>');
if (outList.length && outEl.querySelectorAll('.mail-item').length < outList.length) outEl.innerHTML = outHtml;
}
}
if (window.mochiOnDataReady) window.mochiOnDataReady(function () { try { render(); } catch (e) {} });
function mailListItemClick(e) {
const it = e.target && e.target.closest ? e.target.closest('.mail-item') : null;
if (!it) return;
const l = load().find(x => x.id === it.dataset.id);
if (l) openLetter(l);
}
['mail-in-list', 'mail-out-list'].forEach((lid) => {
const el = document.getElementById(lid);
if (el) el.addEventListener('click', mailListItemClick);
});
function sendLetter() {
const input = document.getElementById('mail-input');
const content = input ? readMailVal(input).trim() : '';
if (!content) { toast('信件内容不能为空'); return; }
const name = partnerName();
const title = TITLES[Math.floor(Math.random() * TITLES.length)];
const letter = { id: 'l_' + Date.now(), type: 'sent', tt: title, content: content, tm: Date.now(), myReply: { content: content, tm: Date.now() } };
const list = load();
list.unshift(letter);
save(list);
const cfg = mailCfg();
if (Math.random() * 100 < cfg.replyProb) {
const replyMsg = taLetterContent(cfg);
const delayMs = (cfg.replyMin + Math.random() * Math.max(1, cfg.replyMax - cfg.replyMin)) * 60000;
const pending = replyPendingLoad();
pending.push({ id: letter.id, due: Date.now() + delayMs, content: replyMsg });
replyPendingSave(pending);
}
if (input) input.value = '';
if (input && input.__ceBox) input.__ceBox.textContent = '';
if (window.chatAddSystem) window.chatAddSystem('你给 ' + name + ' 写了一封信', { mailNotice: true });
toast('信件已寄出');
render();
showPage('page-mail');
selectMailTab('out');
render();
}
const TA_LETTERS = [
'最近总是想起我们以前聊的那些话。时间过得真快，但有些东西一直没变。给我回信吧。',
'今天路过一个地方，突然很想你。最近过得还好吗？想听听你的消息。',
'忽然想给你写封信。有些话，用字卡说不完，写下来好像更踏实。',
'晚安前突然想起你。最近有没有好好休息？有空给我回封信吧。',
'今天看到一片很好看的云，第一反应是想拍给你看。想你了。'
];
function mailCfg() {
const c = (window.replyCfg && window.replyCfg()) || {};
const prob = (k, def) => {
const v = c[k];
return v !== undefined && v !== '' && Number(v) > 0 ? Number(v) : def;
};
return {
minCards: c['ml-min-cards'] !== undefined ? Number(c['ml-min-cards']) : 20,
maxCards: c['ml-max-cards'] !== undefined ? c['ml-max-cards'] : 50,
writeEn: c['ml-write-en'] !== undefined ? Number(c['ml-write-en']) : 1,
fishWeekEn: c['ml-fish-week-en'] !== undefined ? Number(c['ml-fish-week-en']) : 1,
writeProb: prob('ml-write-prob', 30),
writeMin: c['ml-write-min'] !== undefined ? c['ml-write-min'] : 1,
writeMax: c['ml-write-max'] !== undefined ? c['ml-write-max'] : 120,
dailyMax: c['ml-write-daily-max'] !== undefined ? Number(c['ml-write-daily-max']) : 3,
replyProb: prob('ml-reply-prob', 80),
replyMin: c['ml-reply-min'] !== undefined ? c['ml-reply-min'] : 1,
replyMax: c['ml-reply-max'] !== undefined ? c['ml-reply-max'] : 120,
kaomojiEn: c['ml-kaomoji-en'] !== undefined ? c['ml-kaomoji-en'] : 1,
emojiEn: c['ml-emoji-en'] !== undefined ? c['ml-emoji-en'] : 1,
stickerEn: c['ml-sticker-en'] !== undefined ? c['ml-sticker-en'] : 1
};
}
function mailCfgFor(cid) {
const cfg = mailCfg();
if (!cid || cid === (window.__activeCid || 'default')) return cfg;
try {
const s = window.storeFor(cid);
[['ml-min-cards', 'minCards'], ['ml-max-cards', 'maxCards'],
['ml-write-en', 'writeEn'], ['ml-fish-week-en', 'fishWeekEn'],
['ml-write-prob', 'writeProb'], ['ml-write-min', 'writeMin'], ['ml-write-max', 'writeMax'],
['ml-write-daily-max', 'dailyMax'], ['ml-reply-prob', 'replyProb'],
['ml-reply-min', 'replyMin'], ['ml-reply-max', 'replyMax'],
['ml-kaomoji-en', 'kaomojiEn'], ['ml-emoji-en', 'emojiEn'], ['ml-sticker-en', 'stickerEn']
].forEach(pair => {
try {
const v = s.get('reply-' + pair[0]);
if (v === null || v === undefined || v === '') return;
const n = Number(v);
if (isNaN(n)) return;
if ((pair[0] === 'ml-write-prob' || pair[0] === 'ml-reply-prob') && n <= 0) return;
cfg[pair[1]] = n;
} catch (e) {}
});
} catch (e) {}
return cfg;
}
window.mailCfgForProbe = function (cid) {
try { const c = mailCfgFor(cid); return JSON.parse(JSON.stringify(c)); } catch (e) { return null; }
};
function mailTextOnly(c) {
if (typeof c !== 'string' || !c) return false;
if (c.indexOf('data:') === 0) return false;
if (c.indexOf('|||') >= 0) return false;
if (c.indexOf('@@m:') >= 0) return false;
if (/^https?:\/\//i.test(c)) return false;
return true;
}
function mailCleanDisplay(s) {
if (typeof s !== 'string') return s;
return s.replace(/[^\s|]{0,40}\|\|\|/g, '')
.replace(/(data:)?audio\/?[a-zA-Z0-9.+-]*;base64,[A-Za-z0-9+/=]+/g, '[附件]')
.replace(/data:(?!image\/)[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]');
}
function mailCardPool(cid) {
const custom = cid ? (window.getCustomCardsFor ? window.getCustomCardsFor(cid) : []) : ((window.getCustomCards && window.getCustomCards()) || []);
const pokeSet = (function () {
const pk = cid ? (window.getPokeCardsFor ? window.getPokeCardsFor(cid) : []) : ((window.getPokeCards && window.getPokeCards()) || []);
return pk.length ? new Set(pk) : null;
})();
const text = [], kaomoji = [], emoji = [];
const defText = [], defKaomoji = [], defEmoji = [];
const pushDefault = () => {
try {
const st = (cid && window.storeFor) ? window.storeFor(cid) : null;
const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
if (a ? !a.use('mail') : (window.defaultCardUse && !window.defaultCardUse('mail'))) return;
const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
if (catOn('main') && !defText.length) {
const dg = (window.getDefaultCardGroups && window.getDefaultCardGroups('main')) || [];
dg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('main', c)) return; if (!mailTextOnly(c)) return; defText.push(c); }));
}
if (catOn('kaomoji') && !defKaomoji.length) {
const kg = (window.getDefaultCardGroups && window.getDefaultCardGroups('kaomoji')) || [];
kg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('kaomoji', c)) return; if (!mailTextOnly(c)) return; defKaomoji.push(c); }));
}
if (catOn('emoji') && !defEmoji.length) {
const eg = (window.getDefaultCardGroups && window.getDefaultCardGroups('emoji')) || [];
eg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('emoji', c)) return; if (!mailTextOnly(c)) return; defEmoji.push(c); }));
}
} catch (e) {}
};
custom.forEach(s => {
if (!s || typeof s !== 'string') return;
if (pokeSet && pokeSet.has(s)) return;
if (/^data:/.test(s)) return;
if (s.indexOf('|||') >= 0) return;
if (!mailTextOnly(s)) return;
let isEmoji = false;
for (const ch of s) {
const c = ch.codePointAt(0);
if ((c >= 0x1F000 && c <= 0x1FAFF) || (c >= 0x2600 && c <= 0x27BF)) { isEmoji = true; break; }
}
if (isEmoji) { emoji.push(s); return; }
if (/[\(（｡◕(◕)(づ｡(¬)]/.test(s) && /[\)）】)]/.test(s)) { kaomoji.push(s); return; }
if (!/[A-Za-z0-9\u4e00-\u9fff\u3041-\u3096\u30a1-\u30fa]/.test(s) && /[｡◕‿・▽´｀￣﹏◠◡≧≦ω＾￢¬^•˙˘๑٩۶ฅヽノ]/.test(s)) { kaomoji.push(s); return; }
text.push(s);
});
pushDefault();
const sticker = cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'sticker') : []) : ((window.getMediaCards && window.getMediaCards('sticker')) || []);
const image = cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'image') : []) : ((window.getMediaCards && window.getMediaCards('image')) || []);
const tcfg = mailCfgFor(cid);
if (!tcfg.kaomojiEn) { kaomoji.length = 0; defKaomoji.length = 0; }
if (!tcfg.emojiEn) { emoji.length = 0; defEmoji.length = 0; }
if (!tcfg.stickerEn) { sticker.length = 0; image.length = 0; }
return {
text: text,
kaomoji: kaomoji,
emoji: emoji,
defText: defText,
defKaomoji: defKaomoji,
defEmoji: defEmoji,
sticker: sticker,
image: image
};
}
function pickDefaultMailCard(pool, cid) {
try {
const st = (cid && window.storeFor) ? window.storeFor(cid) : null;
const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
const dcfg = a ? a.cfg() : ((window.defaultCardCfg && window.defaultCardCfg()) || {});
if (dcfg.enabled === false) return '';
const overall = (dcfg.overallFor ? dcfg.overallFor('mail') : ((dcfg.overall === undefined || dcfg.overall === null) ? 30 : dcfg.overall));
if (Math.random() * 100 >= overall) return '';
const keys = ['main', 'kaomoji', 'emoji'];
const pools = { main: pool.defText, kaomoji: pool.defKaomoji, emoji: pool.defEmoji };
const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
const mcfg = mailCfgFor(cid);
const weights = keys.map(k => {
if (k === 'kaomoji' && !mcfg.kaomojiEn) return 0;
if (k === 'emoji' && !mcfg.emojiEn) return 0;
return catOn(k) ? Math.max(0, (dcfg.probs && dcfg.probs[k]) || 0) : 0;
});
const total = weights.reduce((a, b) => a + b, 0);
if (total <= 0) return '';
let roll = Math.random() * total;
for (let i = 0; i < keys.length; i++) {
roll -= weights[i];
if (roll < 0) {
const p = pools[keys[i]] || [];
if (p.length) return p[Math.floor(Math.random() * p.length)];
return '';
}
}
} catch (e) {}
return '';
}
window.mailPoolFor = function (cid) {
try {
const p = mailCardPool(cid);
return {
textN: p.text.length, defTextN: p.defText.length, defKaoN: p.defKaomoji.length, defEmojiN: p.defEmoji.length,
kaoN: p.kaomoji.length, emojiN: p.emoji.length,
stickerN: (p.sticker || []).length, imageN: (p.image || []).length
};
} catch (e) { return null; }
};
function taLetterContent(cfg, cid) {
const pool = mailCardPool(cid);
const hasCustom = pool.text.some(s => typeof s === 'string' && /[A-Za-z0-9\u4e00-\u9fff\u3041-\u3096\u30a1-\u30fa]/.test(s));
const words = hasCustom ? pool.text : (pool.defText.length ? pool.defText : TA_LETTERS);
const maxN = Math.max(1, words.length);
const wantMin = Math.min(Math.max(1, cfg.minCards || 1), maxN);
const wantMax = Math.min(Math.max(wantMin, cfg.maxCards || wantMin), maxN);
const n = wantMin + Math.floor(Math.random() * (wantMax - wantMin + 1));
const parts = [];
for (let i = 0; i < n; i++) {
if (hasCustom) {
const d = pickDefaultMailCard(pool, cid);
if (d) { parts.push(d); continue; }
}
parts.push(words[Math.floor(Math.random() * words.length)]);
}
try {
if (window.dictUse && window.dictUse('mail') && window.dictQuoteOne
&& Math.random() * 100 < (window.dictOverall ? window.dictOverall('mail') : 30)) {
const dq = window.dictQuoteOne();
if (dq) parts.push(dq);
}
} catch (eDQ) {}
let t = parts.join(' ');
const kp = pool.kaomoji.length ? pool.kaomoji : pool.defKaomoji;
const ep = pool.emoji.length ? pool.emoji : pool.defEmoji;
if (cfg.kaomojiEn && kp.length && Math.random() * 100 < 30) t += ' ' + kp[Math.floor(Math.random() * kp.length)];
if (cfg.emojiEn && ep.length && Math.random() * 100 < 15) t += ' ' + ep[Math.floor(Math.random() * ep.length)];
const st = pool.sticker.concat(pool.image).filter(s => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))));
if (cfg.stickerEn && st.length && Math.random() * 100 < 20) {
const orig = st[Math.floor(Math.random() * st.length)];
const small = (window._shrunkStickerCache && window._shrunkStickerCache[orig]) || orig;
t += ' ' + small;
}
return t;
}
function letterLast(cid) { const v = parseInt(csFor(cid).get('mail-letter-last'), 10); return isNaN(v) ? 0 : v; }
function letterNext(cid) { const v = parseFloat(csFor(cid).get('mail-letter-next')); return isNaN(v) ? 0 : v; }
function letterDayKey() {
const d = new Date();
return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function letterDayCount(cid) {
try {
const r = JSON.parse(csFor(cid).get('mail-letter-day') || 'null');
return r && r.d === letterDayKey() ? Number(r.n) || 0 : 0;
} catch (e) { return 0; }
}
function letterDayAdd(cid) {
const n = letterDayCount(cid) + 1;
try { csFor(cid).set('mail-letter-day', JSON.stringify({ d: letterDayKey(), n: n })); } catch (e) {}
return n;
}
function maybeIncomingLetterFor(cid) {
try {
if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
const cs = csFor(cid);
const now = Date.now();
const cfg = mailCfgFor(cid);
if (!cfg.writeEn) return;
let last = letterLast(cid), next = letterNext(cid);
if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
if ((now - last) / 60000 < next) return;
const dailyMax = cfg.dailyMax > 0 ? cfg.dailyMax : 3;
if (letterDayCount(cid) >= dailyMax) {
cs.set('mail-letter-last', String(now));
cs.set('mail-letter-next', String(30));
return;
}
if (Math.random() * 100 >= cfg.writeProb) return;
const name = partnerNameFor(cid);
const content = taLetterContent(cfg, cid);
const letter = { id: 'l_' + Date.now() + '_' + cid, type: 'received', tt: TITLES[Math.floor(Math.random() * TITLES.length)], content: content, tm: Date.now() };
const list = load(cid);
list.unshift(letter);
save(list, cid);
cs.set('mail-letter-last', String(now));
cs.set('mail-letter-next', String(cfg.writeMin + Math.random() * Math.max(1, cfg.writeMax - cfg.writeMin)));
letterDayAdd(cid);
notifyMailToChat(cid, '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' + name + ' 给你寄来了一封信', { mailNotice: true });
if (cid === (window.__activeCid || 'default')) {
updateBadge();
render();
if (window.showDeskPopup && !mailPageVisible()) {
window.showDeskPopup({ name: '信箱', text: '给你寄来了一封信：' + String(content || '').replace(/@@m:[0-9a-f]{32}/g, '[图片]').replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]'), onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
}
}
} catch (e) {}
}
function maybeIncomingLetter() {
const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
list.forEach(c => maybeIncomingLetterFor(c.id));
}
function fishWeekReportFor(cid) {
if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
if (!mailCfgFor(cid).fishWeekEn) return;
const cs = csFor(cid);
const now = window.__fishWeekNowOverride ? window.__fishWeekNowOverride() : new Date(); // 测试钩子：生产为 null
const day = now.getDay(); // 0=日
const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let sun; // 小结所属周的周日（周一~周日算一周）
if (day === 0 && now.getHours() >= 18) {
sun = cur;
} else {
const back = ((day + 6) % 7) + 1; // 距上一个周日 1~7 天（周一=2 … 周六=7）
if (back < 2 || back > 4) return; // 只补最近一周：周一~周三内补发
sun = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - back);
}
const markKey = 'fish-week-report:' + (sun.getMonth() + 1) + '-' + sun.getDate();
if (cs.get(markKey)) return;
cs.set(markKey, '1');
const start = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() - 6);
const startTs = start.getTime();
const endTs = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 1).getTime();
const parseDay = (s) => {
const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
if (!m) return NaN;
return Date.parse(m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) + 'T00:00:00');
};
let fm = 0, ft = 0, wm = 0, wt = 0;
const wdSum = [0, 0, 0, 0, 0, 0, 0]; // 周一..周日 各日双方摸鱼合计
try {
JSON.parse(cs.get('fish-day-add') || '[]').forEach(x => {
const ts = parseDay(x && x.date);
if (isNaN(ts) || ts < startTs || ts >= endTs) return;
const m2 = x.mine || 0, t2 = x.ta || 0;
fm += m2; ft += t2;
wdSum[(new Date(ts).getDay() + 6) % 7] += m2 + t2;
});
} catch (e) {}
try {
JSON.parse(cs.get('work-day-add') || '[]').forEach(x => {
const ts = parseDay(x && x.date);
if (isNaN(ts) || ts < startTs || ts >= endTs) return;
wm += x.mine || 0; wt += x.ta || 0;
});
} catch (e) {}
const name = partnerNameFor(cid);
let bestIdx = 0;
for (let i = 1; i < 7; i++) if (wdSum[i] > wdSum[bestIdx]) bestIdx = i;
const wdNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const totalFish = fm + ft;
const lines = [
'本周（' + (start.getMonth() + 1) + '月' + start.getDate() + '日 - ' + (sun.getMonth() + 1) + '月' + sun.getDate() + '日）小结',
'',
'你和我一共摸鱼 ' + totalFish + ' 点（你 +' + fm + ' · 我 +' + ft + '）。',
totalFish > 0 ? '最会摸的一天是' + wdNames[bestIdx] + '，加了 ' + wdSum[bestIdx] + ' 点。' : '这一周还没怎么摸鱼呀，都在认真打工吗？',
'工作值也一起攒了 ' + (wm + wt) + ' 点（你 +' + wm + ' · 我 +' + wt + '）。',
'',
'下周也偷偷一起加油呀。'
];
const letter = { id: 'l_' + Date.now() + '_' + cid + '_wk', type: 'received', tt: '本周摸鱼小结', content: lines.join('\n'), tm: Date.now() };
const list = load(cid);
list.unshift(letter);
save(list, cid);
notifyMailToChat(cid, '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' + name + ' 寄来一份本周摸鱼小结', { mailNotice: true });
if (cid === (window.__activeCid || 'default')) {
updateBadge();
render();
if (window.showDeskPopup && !mailPageVisible()) {
window.showDeskPopup({ name: '信箱', text: '寄来了一份本周摸鱼小结', onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
}
}
}
function fishWeekTick() {
const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
list.forEach(c => { try { fishWeekReportFor(c.id); } catch (e) {} });
}
window.fishWeekTick = fishWeekTick; // v3.13.x：暴露给专项验证脚本（生产内部定时器同样调它）
checkPendingReply(); // 启动立即补查（当前桌面未就绪由内部守卫跳过，就绪后回调再补）
setTimeout(() => {
setInterval(() => {
if (document.visibilityState === 'hidden' && !window.bgNotifyCheck) return;
maybeIncomingLetter(); checkPendingReply(); fishWeekTick();
}, 60000);
maybeIncomingLetter();
fishWeekTick();
}, (20 + Math.random() * 40) * 1000);
let lastEagerCheck = 0;
function eagerCheck() {
const now = Date.now();
if (now - lastEagerCheck < 5000) return;
lastEagerCheck = now;
maybeIncomingLetter();
checkPendingReply();
fishWeekTick();
}
document.addEventListener('visibilitychange', function () {
if (document.visibilityState === 'visible') eagerCheck();
});
window.addEventListener('pageshow', function (e) { if (e.persisted) eagerCheck(); });
window.addEventListener('focus', eagerCheck);
function readMailVal(el) {
if (!el) return '';
let v;
try { v = el.value; } catch (e) {}
if (v !== undefined && v !== null && String(v).trim()) return String(v);
try {
const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
if (box) return (box.innerText !== undefined ? box.innerText : box.textContent) || '';
} catch (e) {}
return v === undefined || v === null ? '' : String(v);
}
const mailApp = document.querySelector('.app[data-app="mail"]');
const mailPage = document.getElementById('page-mail');
if (mailApp && mailPage) {
mailApp.addEventListener('click', () => {
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) return;
openMailPage();
});
}
const mailBack = document.getElementById('mail-back');
if (mailBack) mailBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const phone = document.getElementById('page-phone');
if (phone) phone.hidden = false;
});
const openWriteBtn = document.getElementById('mail-open-write');
if (openWriteBtn) {
openWriteBtn.addEventListener('click', () => {
const toEl = document.getElementById('mail-write-to');
if (toEl) toEl.textContent = partnerName();
showPage('page-mail-write');
});
}
const mailWriteBack = document.getElementById('mail-write-back');
if (mailWriteBack) mailWriteBack.addEventListener('click', () => { if (window.closeEmojiPanel) window.closeEmojiPanel(); showPage('page-mail'); render(); });
const mailSend = document.getElementById('mail-send');
if (mailSend) mailSend.addEventListener('click', sendLetter);
const mailReplyBack = document.getElementById('mail-reply-back');
if (mailReplyBack) mailReplyBack.addEventListener('click', () => { if (window.closeEmojiPanel) window.closeEmojiPanel(); viewLetter = null; showPage('page-mail'); render(); });
const mailReplySend = document.getElementById('mail-reply-send');
if (mailReplySend) mailReplySend.addEventListener('click', submitReply);
function selectMailTab(name) {
mtab = name;
document.querySelectorAll('#page-mail .fav-tab').forEach(x => x.classList.toggle('sel', x.dataset.mtab === name));
document.querySelectorAll('#page-mail .cal-card').forEach(c => { c.hidden = c.dataset.mpanel !== name; });
}
document.querySelectorAll('#page-mail .fav-tab').forEach(tab => {
tab.addEventListener('click', () => selectMailTab(tab.dataset.mtab));
});
function mailInsertInto(textarea, s) {
if (!textarea) return;
if (textarea.__ceBox) {
try {
const box = textarea.__ceBox;
box.focus();
const sel = window.getSelection();
let node = box;
let offset = 0;
if (sel && sel.rangeCount && box.contains(sel.anchorNode)) {
offset = sel.anchorOffset;
node = sel.anchorNode;
}
const range = document.createRange();
range.setStart(node, offset);
range.collapse(true);
const img = document.createElement('img');
img.src = String(s).replace(/^(?:sticker|image):/, '');
img.style.cssText = 'max-width:120px;max-height:120px;border-radius:8px;vertical-align:middle;margin:2px;display:inline-block;';
img.contentEditable = 'false';
const span = document.createElement('span');
span.className = 'mail-media-mark';
span.style.display = 'none';
span.textContent = s;
span.contentEditable = 'false';
const frag = document.createDocumentFragment();
frag.appendChild(img);
frag.appendChild(span);
frag.appendChild(document.createTextNode(' '));
range.insertNode(frag);
range.setStartAfter(span);
range.collapse(true);
sel.removeAllRanges();
sel.addRange(range);
try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
return;
} catch (e) {
}
}
try {
let start = textarea.selectionStart;
if (typeof start !== 'number' || isNaN(start)) start = textarea.value.length;
const end = start;
textarea.value = textarea.value.slice(0, start) + s + textarea.value.slice(end);
textarea.focus();
const pos = start + s.length;
textarea.setSelectionRange(pos, pos);
} catch (e) {
textarea.value += s;
}
}
function mailUploadImage(textarea) {
window.mochiFilePick({
id: 'mochi-mail-img-pick', accept: 'image/*', multiple: true,
onFiles: (files) => {
if (!files.length) { toast('没有取到图片，请再选一次'); return; }
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
mailInsertInto(textarea, 'image:' + c.toDataURL('image/png'));
} catch (err) {
mailInsertInto(textarea, 'image:' + reader.result);
}
};
img.onerror = () => toast('图片读取失败');
img.src = reader.result;
};
reader.onerror = () => toast('图片读取失败');
reader.readAsDataURL(f);
});
}
});
}
function bindMailToolbar(scope, textareaId) {
const root = document.querySelector(scope);
const textarea = document.getElementById(textareaId);
if (!root || !textarea) return;
const stickerBtn = root.querySelector('.mail-tb-sticker');
if (stickerBtn) stickerBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (window.openEmojiPanelForInsert) window.openEmojiPanelForInsert((src, kind) => {
if (kind === 'text') { mailInsertInto(textarea, src); return; }
try { if (window.shrinkMediaUrl) { window.shrinkMediaUrl(src, (small) => { mailInsertInto(textarea, 'sticker:' + (small || src)); }); return; } } catch (e) {}
mailInsertInto(textarea, 'sticker:' + src);
}, { allowUrl: true });
});
const upImg = root.querySelector('.mail-tb-image');
if (upImg) upImg.addEventListener('click', () => mailUploadImage(textarea));
}
bindMailToolbar('#page-mail-write', 'mail-input');
bindMailToolbar('#page-mail-reply', 'mail-reply-input');
function mailExportData() {
const list = load();
const json = JSON.stringify({ version: '1.0', app: 'mochi-mail', exportTime: new Date().toISOString(), letters: list }, null, 2);
try {
const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = '信箱数据_' + new Date().toISOString().slice(0, 10) + '.json';
document.body.appendChild(a);
a.click();
setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
toast('已导出 ' + list.length + ' 封信');
} catch (e) { toast('导出失败'); }
}
function mailReadFileText(file) {
return new Promise((resolve) => {
if (typeof file.text === 'function') {
file.text().then(resolve).catch(() => readViaReader());
} else readViaReader();
function readViaReader() {
const r = new FileReader();
r.onload = () => resolve(String(r.result || ''));
r.onerror = () => resolve('');
r.readAsText(file, 'utf-8');
}
});
}
function mailImportFile(file) {
mailReadFileText(file).then((text) => {
let arr = null;
try {
const data = JSON.parse(text || 'null');
if (Array.isArray(data)) arr = data;
else if (data && Array.isArray(data.letters)) arr = data.letters;
} catch (e) {}
if (!arr || !arr.length) { toast('无效的信箱数据文件'); return; }
const valid = arr.filter(x => x && typeof x === 'object' && x.id);
if (!valid.length) { toast('文件中没有有效的信件数据'); return; }
const cur = load();
const map = {};
cur.forEach(l => { if (l && l.id) map[l.id] = l; });
valid.forEach(l => { map[l.id] = l; });
const merged = Object.keys(map).map(k => map[k]);
if (window.openModal) {
window.openModal('导入 ' + valid.length + ' 封信？', '', () => {
save(merged);
viewLetter = null;
render();
updateBadge();
toast('已导入 ' + valid.length + ' 封信（共 ' + merged.length + ' 封）');
}, { noInput: true, staticText: '将合并进现有信箱（当前 ' + cur.length + ' 封）：\n· 导入 ' + valid.length + ' 封，其中 ' + (valid.length - (merged.length - cur.length)) + ' 封覆盖同 id 旧信\n· 同 id 以导入内容为准，其余保留\n导入后共 ' + merged.length + ' 封。' });
}
});
}
function mailClearAll() {
const n = load().length;
if (window.openModal) {
window.openModal('清空所有信件？', '', () => {
save([]);
replyPendingSave([]); // 同时清掉未到期的 TA 回信计划
viewLetter = null;
render();
updateBadge();
toast('信箱已清空');
}, { noInput: true, staticText: '将删除全部 ' + n + ' 封信（收信/寄信/回信），且无法恢复。' });
}
}
function deleteLetter(l) {
if (!l || !l.id) return;
if (window.openModal) {
window.openModal('删除这封信？', '', () => {
const list = load();
save(list.filter(x => x.id !== l.id));
const pending = replyPendingLoad().filter(p => !p || p.id !== l.id);
replyPendingSave(pending);
viewLetter = null;
render();
updateBadge();
const mask = document.getElementById('tc-mask');
if (mask) mask.hidden = true;
toast('信件已删除');
}, { noInput: true, staticText: '删除后将无法恢复。' });
}
}
const mailExportBtn = document.getElementById('mail-export');
if (mailExportBtn) mailExportBtn.addEventListener('click', mailExportData);
const mailImportBtn = document.getElementById('mail-import');
if (mailImportBtn) {
mailImportBtn.addEventListener('click', () => {
window.mochiFilePick({
id: 'mochi-mail-import-pick', accept: '.json,application/json',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到文件，请再选一次'); return; }
mailImportFile(f);
}
});
});
}
const mailClearBtn = document.getElementById('mail-clear');
if (mailClearBtn) mailClearBtn.addEventListener('click', mailClearAll);
render();
updateBadge();
function mailMergeFromIdb(v, cid) {
try {
const pending = mailPending || [];
mailPending = null;
let base = [];
if (v && typeof v === 'string' && v.length > 2) {
const idbArr = JSON.parse(v);
if (Array.isArray(idbArr)) base = idbArr;
}
let cur = [];
try { cur = JSON.parse(csFor(cid).get(KEY) || '[]'); } catch (e) { cur = []; }
if (!cur.length) { try { cur = loadSnap(cid); } catch (e) {} }
const merged = mergeLists(base, mergeLists(cur, pending));
if (merged.length) { csFor(cid).set(KEY, JSON.stringify(merged)); writeSnap(merged, cid); }
} catch (e) { /* 解析失败：仍置就绪，避免下次启动重复合并 */ }
}
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':' + KEY).then(v => {
if (window.activePrefix() !== myPrefix) return;
mailMergeFromIdb(v);
mailDbReady = true;
checkPendingReply(); // v3.9.x：权威就绪立即补查到期回信（启动即到的回信不再等 20~60s）
render();
updateBadge();
});
} else {
mailDbReady = true;
}
} catch (e) { mailDbReady = true; }
setTimeout(function () {
if (mailDbReady) return;
try {
const all = load();
if (all.length) store.set(KEY, JSON.stringify(all));
} catch (e) {}
mailDbReady = true;
checkPendingReply(); // v3.9.x：保险丝就绪同样补查（权威加载挂起场景）
render();
updateBadge();
}, 15000);
document.addEventListener('contact-switched', function () {
try {
const switchedCid = window.__activeCid || 'default';
mailDbReady = false;
mailPending = null;
let fuseFired = false;
const fuse = setTimeout(function () {
if (fuseFired || mailDbReady) return;
if ((window.__activeCid || 'default') !== switchedCid) return; // 已切走：本保险丝作废
fuseFired = true;
try {
const all = load(switchedCid);
if (all.length) csFor(switchedCid).set(KEY, JSON.stringify(all));
} catch (e) {}
mailDbReady = true;
checkPendingReply(); // v3.9.x：切桌面权威就绪补查（新桌面到期的回信立即落地）
render();
updateBadge();
}, 15000);
if (window.idbGet) {
window.idbGet(window.activePrefix() + ':' + KEY).then(v => {
if (fuseFired) return; // 保险丝已先就绪，idbGet 迟到则跳过（load 已含暂存）
if ((window.__activeCid || 'default') !== switchedCid) return; // 已切走：作废，不合并不置就绪
clearTimeout(fuse);
mailMergeFromIdb(v, switchedCid);
mailDbReady = true;
checkPendingReply(); // v3.9.x：切桌面权威就绪补查
render();
updateBadge();
}).catch(() => {
if (fuseFired) return;
if ((window.__activeCid || 'default') !== switchedCid) return;
clearTimeout(fuse);
mailDbReady = true; render(); updateBadge();
});
} else {
clearTimeout(fuse);
mailDbReady = true;
render();
updateBadge();
}
} catch (e) { mailDbReady = true; }
});
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("mail.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("mail.js"); try { console.error("[JS] mail.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[mail.js] " + String(__e && __e.message || __e)); } })();