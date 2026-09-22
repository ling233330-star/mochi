(function () { try {
(function () {
const uid = window.activePrefix();
const store = window.activeStore();
const page = document.getElementById('page-chat-settings');
if (!page) return;
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) {
t = document.createElement('div');
t.id = 'cc-toast';
document.body.appendChild(t);
}
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
const INVITE_PROB = 50; // 触发"邀请/直接换"的概率 %（我换 TA 的：触发同意/拒绝回应；TA 换我的：触发弹窗邀请）
const AGREE_PROB = 70;  // 触发回应时同意的概率 %（拒绝 = 100 - AGREE_PROB）
function getLib() { try { return JSON.parse(store.get('avatar-lib') || '[]'); } catch (e) { return []; } }
function saveLib(list) { store.set('avatar-lib', JSON.stringify(list)); }
function getEnabled() { const v = store.get('avatar-lib-enabled'); return v === null ? true : v === '1'; }
function avNightQuiet() {
if (window.nightModeActive) return !!window.nightModeActive();
try { if (window.xyStore('xy-home-v2').get('night-mode-en') !== '1') return false; } catch (e) { return false; }
try { const h = new Date().getHours(); return h >= 22 || h < 7; } catch (e) { return false; }
}
function getMeLib() { try { return JSON.parse(store.get('avatar-me-lib') || '[]'); } catch (e) { return []; } }
function saveMeLib(list) { store.set('avatar-me-lib', JSON.stringify(list)); }
function getMeEnabled() { const v = store.get('avatar-me-lib-enabled'); return v === null ? true : v === '1'; }
const INVIS_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u180E]/g;
function cleanNick(s) {
return String(s == null ? '' : s).replace(INVIS_RE, '').trim().slice(0, 30);
}
function loadStrList(key) {
try {
const v = JSON.parse(store.get(key) || '[]');
return Array.isArray(v) ? v.map(cleanNick).filter(Boolean) : [];
} catch (e) { return []; }
}
function getNickLib() { return loadStrList('nick-lib'); }
function saveNickLib(list) { store.set('nick-lib', JSON.stringify(list)); }
function getNickEnabled() { const v = store.get('nick-lib-enabled'); return v === null ? true : v === '1'; }
function getMeNickLib() { return loadStrList('nick-me-lib'); }
function saveMeNickLib(list) { store.set('nick-me-lib', JSON.stringify(list)); }
function getMeNickEnabled() { const v = store.get('nick-me-lib-enabled'); return v === null ? true : v === '1'; }
function curPartnerNick() { return store.get('cs-lbl-partner') || store.get('lbl-partner') || ''; }
function curMyNick() { return store.get('cs-lbl-user') || store.get('lbl-user') || ''; }
function chatName(chatKey, deskKey, fb) {
let v = null;
try { v = store.get(chatKey); } catch (e) {}
if (v) return v;
try { v = store.get(deskKey); } catch (e) {}
return v || fb;
}
function cPartnerName() { return chatName('cs-lbl-partner', 'lbl-partner', 'TA'); }
function cUserName() { return chatName('cs-lbl-user', 'lbl-user', '我'); }
function strHash(s) {
let h = 5381;
s = String(s || '');
for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
return String(h);
}
const AV_TARGET = 180 * 1024;
function normalizeAvSize(data, cb) {
if (!data || typeof data !== 'string' || data.indexOf('data:image') !== 0 || data.length <= AV_TARGET) { cb(data); return; }
try {
const img = new Image();
img.onload = function () {
try {
const iw = img.width || 256, ih = img.height || 256;
const scale = Math.min(1, 256 / Math.max(iw, ih));
let w = Math.max(1, Math.round(iw * scale));
let h = Math.max(1, Math.round(ih * scale));
let q = 0.85, out = '';
for (let tries = 0; tries < 4; tries++) {
const c = document.createElement('canvas');
c.width = w; c.height = h;
c.getContext('2d').drawImage(img, 0, 0, w, h);
out = c.toDataURL('image/jpeg', q);
if (out.length <= AV_TARGET) break;
w = Math.max(48, Math.round(w * 0.8));
h = Math.max(48, Math.round(h * 0.8));
q = Math.max(0.5, q - 0.1);
}
cb(out && out.length < data.length ? out : data);
} catch (e) { cb(data); }
};
img.onerror = function () { cb(data); };
img.src = data;
} catch (e) { cb(data); }
}
let appliedPh = null, appliedUh = null;
function convergeAvatars() {
try {
const ph = strHash(store.get('cs-avatar-partner') || store.get('avatar-partner') || '');
const uh = strHash(store.get('cs-avatar-user') || store.get('avatar-user') || '');
if (appliedPh !== null && ph === appliedPh && uh === appliedUh) return;
appliedPh = ph; appliedUh = uh;
if (window.refreshChatAvatars) window.refreshChatAvatars();
} catch (e) {}
}
function noteApplied(kind, val) {
try {
const h = strHash(val || '');
if (kind === 'partner') appliedPh = h; else appliedUh = h;
} catch (e) {}
}
try { appliedPh = strHash(store.get('cs-avatar-partner') || store.get('avatar-partner') || ''); } catch (e) {}
try { appliedUh = strHash(store.get('cs-avatar-user') || store.get('avatar-user') || ''); } catch (e) {}
document.addEventListener('mochi-restore-done', function () {
appliedPh = null; appliedUh = null;
setTimeout(convergeAvatars, 0);
});
document.addEventListener('visibilitychange', function () {
if (document.visibilityState === 'visible') convergeAvatars();
});
document.addEventListener('mochi-fg-resume', convergeAvatars);
document.addEventListener('contact-switched', function () { setTimeout(convergeAvatars, 0); });
window.addEventListener('storage', function (e) {
try {
if (e.key && /:cs-avatar-(partner|user)$/.test(e.key)) convergeAvatars();
} catch (err) {}
});
const avPage = document.getElementById('avlib-card');
const avGrid = document.getElementById('avlib-grid');
const avCount = document.getElementById('avlib-count');
const avEmpty = document.getElementById('avlib-empty');
const avEnabled = document.getElementById('avlib-enabled');
const avUpload = document.getElementById('avlib-upload');
const avClear = document.getElementById('avlib-clear');
const avName = document.getElementById('avlib-name');
const avPoolName = document.getElementById('avlib-pool-name');
const avMeGrid = document.getElementById('avlib-me-grid');
const avMeCount = document.getElementById('avlib-me-count');
const avMeEmpty = document.getElementById('avlib-me-empty');
const avMeEnabled = document.getElementById('avlib-me-enabled');
const avMeUpload = document.getElementById('avlib-me-upload');
const avMeClear = document.getElementById('avlib-me-clear');
const avTabA = document.getElementById('avlib-tab-a');
const avTabB = document.getElementById('avlib-tab-b');
const avPaneA = document.getElementById('avlib-pane-a');
const avPaneB = document.getElementById('avlib-pane-b');
const avMeTabName = document.getElementById('avlib-me-tab-name');
const avKindAvatar = document.getElementById('avlib-kind-avatar');
const avKindName = document.getElementById('avlib-kind-name');
const avPaneC = document.getElementById('avlib-pane-c');
const avPaneD = document.getElementById('avlib-pane-d');
const avNickList = document.getElementById('avlib-nick-list');
const avNickEmpty = document.getElementById('avlib-nick-empty');
const avNickEnabled = document.getElementById('avlib-nick-enabled');
const avNickAdd = document.getElementById('avlib-nick-add');
const avNickClear = document.getElementById('avlib-nick-clear');
const avMeNickList = document.getElementById('avlib-me-nick-list');
const avMeNickEmpty = document.getElementById('avlib-me-nick-empty');
const avMeNickEnabled = document.getElementById('avlib-me-nick-enabled');
const avMeNickAdd = document.getElementById('avlib-me-nick-add');
const avMeNickClear = document.getElementById('avlib-me-nick-clear');
let avKind = 'avatar', avOwner = 0;
function kindIsName() { return avKind === 'name'; }
function syncCounts() {
if (avCount) avCount.textContent = (kindIsName() ? getNickLib() : getLib()).length;
if (avMeCount) avMeCount.textContent = (kindIsName() ? getMeNickLib() : getMeLib()).length;
}
function syncVal() {
if (avEnabled) avEnabled.checked = getEnabled();
if (avMeEnabled) avMeEnabled.checked = getMeEnabled();
if (avNickEnabled) avNickEnabled.checked = getNickEnabled();
if (avMeNickEnabled) avMeNickEnabled.checked = getMeNickEnabled();
const myName = cUserName();
if (avName) avName.textContent = cPartnerName();
if (avPoolName) avPoolName.textContent = cPartnerName() + (kindIsName() ? ' 的昵称库' : ' 的头像库');
if (avMeTabName) {
if (kindIsName()) avMeTabName.textContent = myName ? myName + ' 的昵称库' : '我的昵称库';
else avMeTabName.textContent = myName ? myName + ' 的头像库' : '我的头像库';
}
syncCounts();
}
function syncAvPane() {
const me = avOwner === 1, nameKind = kindIsName();
if (avTabA) avTabA.classList.toggle('active', !me);
if (avTabB) avTabB.classList.toggle('active', me);
if (avKindAvatar) avKindAvatar.classList.toggle('active', !nameKind);
if (avKindName) avKindName.classList.toggle('active', nameKind);
if (avPaneA) avPaneA.hidden = !(!nameKind && !me);
if (avPaneB) avPaneB.hidden = !(!nameKind && me);
if (avPaneC) avPaneC.hidden = !(nameKind && !me);
if (avPaneD) avPaneD.hidden = !(nameKind && me);
syncVal();
}
function switchAvTab(me) { avOwner = me ? 1 : 0; syncAvPane(); try { avKickFirstScreen(avGrid); avKickFirstScreen(avMeGrid); } catch (e) {} }
function switchAvKind(name) { avKind = name ? 'name' : 'avatar'; syncAvPane(); try { avKickFirstScreen(avGrid); avKickFirstScreen(avMeGrid); } catch (e) {} }
const avImgObserver = ('IntersectionObserver' in window)
? new IntersectionObserver((entries) => {
for (const en of entries) {
if (!en.isIntersecting) continue;
const img = en.target;
if (img && img.dataset && img.dataset.src && !img.getAttribute('src')) {
img.setAttribute('src', img.dataset.src);
img.removeAttribute('data-src');
}
try { avImgObserver.unobserve(img); } catch (e) {}
}
}, { root: null, rootMargin: '300px 0px' })
: null;
function avAttachLazy(img) {
if (!img) return;
if (avImgObserver) { try { avImgObserver.observe(img); } catch (e) {} }
else { img.setAttribute('src', img.dataset.src || ''); img.removeAttribute('data-src'); }
}
function emptyHintMismatch(el, lib) { return !!el && el.hidden !== (lib.length > 0); }
function updateGridNow() {
if (!avGrid) return false;
const lib = getLib();
const current = store.get('cs-avatar-partner') || store.get('avatar-partner');
if (emptyHintMismatch(avEmpty, lib)) return false;
const cells = avGrid.querySelectorAll('.avlib-cell');
if (cells.length !== lib.length) return false;
for (let i = 0; i < lib.length; i++) {
const im = cells[i].querySelector('img');
if (!im || (im.dataset.src || im.getAttribute('src')) !== lib[i]) return false;
}
lib.forEach((src, idx) => { cells[idx].classList.toggle('avlib-now', src === current); });
return true;
}
function updateMeGridNow() {
if (!avMeGrid) return false;
const lib = getMeLib();
const current = store.get('cs-avatar-user') || store.get('avatar-user');
if (emptyHintMismatch(avMeEmpty, lib)) return false;
const cells = avMeGrid.querySelectorAll('.avlib-cell');
if (cells.length !== lib.length) return false;
for (let i = 0; i < lib.length; i++) {
const im = cells[i].querySelector('img');
if (!im || (im.dataset.src || im.getAttribute('src')) !== lib[i]) return false;
}
lib.forEach((src, idx) => { cells[idx].classList.toggle('avlib-now', src === current); });
return true;
}
function renderGridSmart() { if (!updateGridNow()) renderGrid(); }
function renderMeGridSmart() { if (!updateMeGridNow()) renderMeGrid(); }
function refreshAvGrids() {
if (!avPage || avPage.hidden) return;
renderGridSmart();
renderMeGridSmart();
renderNickGridSmart();
renderMeNickGridSmart();
}
function renderGrid() {
if (!avGrid) return;
const lib = getLib();
const current = store.get('cs-avatar-partner') || store.get('avatar-partner');
if (avImgObserver) avGrid.querySelectorAll('img[data-src]').forEach(im => { try { avImgObserver.unobserve(im); } catch (e) {} }); // v3.42.x
avGrid.innerHTML = '';
syncCounts(); // 计数归 syncCounts 管（同一排页签在头像/昵称两种大类下要显示各自条数）
if (avEmpty) avEmpty.hidden = lib.length > 0;
lib.forEach((src, idx) => {
const d = document.createElement('div');
d.className = 'avlib-cell' + (src === current ? ' avlib-now' : '');
const img = document.createElement('img');
img.dataset.src = src; // v3.42.x 懒加载：进入视口才解码
img.alt = '头像';
avAttachLazy(img);
const delBtn = document.createElement('button');
delBtn.className = 'avlib-del';
delBtn.textContent = '✕';
d.appendChild(img);
d.appendChild(delBtn);
img.addEventListener('click', () => {
switchAvatarFromLib(src);
});
delBtn.addEventListener('click', () => {
const l = getLib();
l.splice(idx, 1);
saveLib(l);
renderGrid();
syncVal();
});
avGrid.appendChild(d);
});
}
function renderMeGrid() {
if (!avMeGrid) return;
const lib = getMeLib();
const current = store.get('cs-avatar-user') || store.get('avatar-user');
if (avImgObserver) avMeGrid.querySelectorAll('img[data-src]').forEach(im => { try { avImgObserver.unobserve(im); } catch (e) {} }); // v3.42.x
avMeGrid.innerHTML = '';
syncCounts(); // 同上
if (avMeEmpty) avMeEmpty.hidden = lib.length > 0;
lib.forEach((src, idx) => {
const d = document.createElement('div');
d.className = 'avlib-cell' + (src === current ? ' avlib-now' : '');
const img = document.createElement('img');
img.dataset.src = src; // v3.42.x 懒加载：进入视口才解码
img.alt = '头像';
avAttachLazy(img);
const delBtn = document.createElement('button');
delBtn.className = 'avlib-del';
delBtn.textContent = '✕';
d.appendChild(img);
d.appendChild(delBtn);
img.addEventListener('click', () => {
switchMyAvatarFromLib(src);
});
delBtn.addEventListener('click', () => {
const l = getMeLib();
l.splice(idx, 1);
saveMeLib(l);
renderMeGrid();
});
avMeGrid.appendChild(d);
});
}
function updateNickGridNow() {
if (!avNickList) return false;
const lib = getNickLib();
const current = curPartnerNick();
if (emptyHintMismatch(avNickEmpty, lib)) return false; // 同 updateGridNow 的空态提示修复
const cells = avNickList.querySelectorAll('.avlib-name-cell');
if (cells.length !== lib.length) return false;
for (let i = 0; i < lib.length; i++) {
const tx = cells[i].querySelector('.avlib-name-txt');
if (!tx || tx.textContent !== lib[i]) return false;
}
lib.forEach((name, idx) => { cells[idx].classList.toggle('avlib-now', name === current); });
return true;
}
function updateMeNickGridNow() {
if (!avMeNickList) return false;
const lib = getMeNickLib();
const current = curMyNick();
if (emptyHintMismatch(avMeNickEmpty, lib)) return false; // 同上
const cells = avMeNickList.querySelectorAll('.avlib-name-cell');
if (cells.length !== lib.length) return false;
for (let i = 0; i < lib.length; i++) {
const tx = cells[i].querySelector('.avlib-name-txt');
if (!tx || tx.textContent !== lib[i]) return false;
}
lib.forEach((name, idx) => { cells[idx].classList.toggle('avlib-now', name === current); });
return true;
}
function renderNickGridSmart() { if (!updateNickGridNow()) renderNickGrid(); }
function renderMeNickGridSmart() { if (!updateMeNickGridNow()) renderMeNickGrid(); }
function buildNickCell(name, libFn, saveFn, rerender, onPick) {
const d = document.createElement('div');
d.className = 'avlib-name-cell';
const txt = document.createElement('span');
txt.className = 'avlib-name-txt';
txt.textContent = name;
txt.title = name;
const delBtn = document.createElement('button');
delBtn.className = 'avlib-name-del';
delBtn.textContent = '✕';
d.appendChild(txt);
d.appendChild(delBtn);
txt.addEventListener('click', () => onPick(name));
delBtn.addEventListener('click', () => {
const l = libFn();
const i = l.indexOf(name);
if (i < 0) return;
l.splice(i, 1);
saveFn(l);
rerender();
syncVal();
});
return d;
}
function renderNickGrid() {
if (!avNickList) return;
const lib = getNickLib();
const current = curPartnerNick();
avNickList.innerHTML = '';
syncCounts();
if (avNickEmpty) avNickEmpty.hidden = lib.length > 0;
lib.forEach(name => {
const d = buildNickCell(name, getNickLib, saveNickLib, renderNickGrid, switchNickFromLib);
if (name === current) d.classList.add('avlib-now');
avNickList.appendChild(d);
});
}
function renderMeNickGrid() {
if (!avMeNickList) return;
const lib = getMeNickLib();
const current = curMyNick();
avMeNickList.innerHTML = '';
syncCounts();
if (avMeNickEmpty) avMeNickEmpty.hidden = lib.length > 0;
lib.forEach(name => {
const d = buildNickCell(name, getMeNickLib, saveMeNickLib, renderMeNickGrid, switchMyNickFromLib);
if (name === current) d.classList.add('avlib-now');
avMeNickList.appendChild(d);
});
}
function openAvlib() {
if (!avPage) return;
try { restoreLib('avatar-lib'); restoreLib('avatar-me-lib'); restoreLib('nick-lib'); restoreLib('nick-me-lib'); } catch (e) {}
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel');
if (ep) ep.hidden = true;
renderGridSmart();   // FIX #509：打开时不整格重建——库没变只同步高亮（旧路径每次打开都重建=图片闪）
renderMeGridSmart(); // FIX #509 同上
renderNickGridSmart();
renderMeNickGridSmart();
syncAvPane(); // 两个大类 + 四个 pane 的显隐/文案/计数一次性同步（内含 syncVal）
const myToken = ++avShowToken;
avShowWhenDecoded(function () { avPage.hidden = false; }, myToken);
}
let avShowToken = 0; // #692：头像互动半框「解码后再显示」世代令牌（关闭/重开作废，防空回调弹出）
const AV_DECODE_AWAIT_MAX = 24; // #716 首屏口径（#1011 起提到模块作用域：首屏判定函数也要用）
function avFirstScreen(grid) {
const out = [];
if (!grid) return out;
let imgs; try { imgs = grid.querySelectorAll('img'); } catch (e) { return out; }
if (!imgs || !imgs.length) return out;
let cr = null; try { cr = (avPage || grid).getBoundingClientRect(); } catch (e) {}
const byRect = !!(cr && cr.height > 4); // 没量到几何（非活动 pane 等）时退回前 N 张旧口径
for (let i = 0; i < imgs.length; i++) {
if (out.length >= AV_DECODE_AWAIT_MAX) break;
const im = imgs[i];
if (byRect) {
let r = null; try { r = im.getBoundingClientRect(); } catch (e) {}
if (r && r.top > cr.bottom + 80) break; // 半框下沿外的留给懒加载
if (!r || r.bottom < cr.top - 80) continue; // 已滚上去/非活动 pane（无几何）不占等待名额
out.push(im);
} else out.push(im);
}
return out;
}
function avKickFirstScreen(grid) {
const imgs = avFirstScreen(grid);
for (let i = 0; i < imgs.length; i++) {
const im = imgs[i];
let ds = ''; try { ds = (im.dataset && im.dataset.src) || ''; } catch (e) {}
if (ds && !im.getAttribute('src')) {
im.setAttribute('src', ds); // 当场补：不等 IO 回调（令牌载荷同路径，池会按 src 重写真载荷）
try { im.removeAttribute('data-src'); } catch (e) {}
try { if (avImgObserver) avImgObserver.unobserve(im); } catch (e) {}
}
}
return imgs;
}
function avImgReady(im) {
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
setTimeout(function () { if (!done) { done = true; off(); res(okNow()); } }, 2400);
}).then(function () { try { return im.decode ? im.decode().catch(function () {}) : null; } catch (e) { return null; } });
}
function avShowWhenDecoded(show, token) {
let shown = false;
const fin = function () {
if (shown) return; shown = true;
if (token !== undefined && token !== avShowToken) return; // #692 已关闭/已重开：本次显示作废
try { show(); } catch (e) {}
};
if (!window.Promise) { fin(); return; }
const grids = [avGrid, avMeGrid];
const jobs = [];
for (let g = 0; g < grids.length; g++) {
const grid = grids[g];
if (!grid) continue;
const first = avKickFirstScreen(grid); // #1011：先把首屏载荷补进 src（不等 IO 回调）
for (let i = 0; i < first.length; i++) jobs.push(avImgReady(first[i]));
const imgs = grid.querySelectorAll('img[src]');
for (let i = 0; i < imgs.length; i++) {
if (first.indexOf(imgs[i]) >= 0) continue;
try { if (imgs[i].decode) imgs[i].decode().catch(function () {}); } catch (e) {} // #716：首屏外只预热不等待
}
}
if (!jobs.length) { fin(); return; }
Promise.all(jobs).then(fin, fin);
setTimeout(fin, 2500); // #716：1s→2.5s——首屏解码慢的机型半途放行＝可见「闪烁重载」；上限仍在防挂死
}
document.addEventListener('contact-switched', function () {
try { restoreLib('avatar-lib'); restoreLib('avatar-me-lib'); restoreLib('nick-lib'); restoreLib('nick-me-lib'); } catch (e) {}
});
function closeAvlib() {
avShowToken++; // #692：作废未兑现的「解码后显示」
if (avPage) avPage.hidden = true;
}
window.openAvlib = openAvlib;
window.mochiPrewarmAvlib = function () {
if (!avPage || !avPage.hidden) return;
if (typeof document !== 'undefined') {
const cp = document.getElementById('page-chat');
if (cp && cp.hidden) return;
}
try { renderGridSmart(); renderMeGridSmart(); renderNickGridSmart(); renderMeNickGridSmart(); } catch (e) {}
const grids = [avGrid, avMeGrid];
for (let g = 0; g < grids.length; g++) {
const grid = grids[g];
if (!grid) continue;
const imgs = grid.querySelectorAll('img');
let n = 0;
for (let i = 0; i < imgs.length && n < 24; i++) {
const im = imgs[i];
if (im.dataset && im.dataset.src && !im.getAttribute('src')) {
im.setAttribute('src', im.dataset.src);
im.removeAttribute('data-src');
n++;
}
try { if (im.decode) im.decode().catch(function () {}); } catch (e) {}
}
}
};
window.closeAvlib = closeAvlib;
const avClose = document.getElementById('avlib-close');
if (avClose) avClose.addEventListener('click', closeAvlib);
if (window.mochiSheetOutsideClose) window.mochiSheetOutsideClose(document.getElementById('avlib-card'), closeAvlib);
if (avTabA) avTabA.addEventListener('click', () => switchAvTab(false));
if (avTabB) avTabB.addEventListener('click', () => switchAvTab(true));
if (avKindAvatar) avKindAvatar.addEventListener('click', () => switchAvKind(false));
if (avKindName) avKindName.addEventListener('click', () => switchAvKind(true));
const moreAvatar = document.getElementById('more-avatar');
if (moreAvatar) {
moreAvatar.addEventListener('click', (e) => {
e.stopPropagation();
const morePanel = document.getElementById('chat-more-panel');
if (morePanel) morePanel.hidden = true;
openAvlib();
});
}
if (avEnabled) {
avEnabled.addEventListener('change', () => {
store.set('avatar-lib-enabled', avEnabled.checked ? '1' : '0');
syncVal();
});
}
if (avMeEnabled) {
avMeEnabled.addEventListener('change', () => {
store.set('avatar-me-lib-enabled', avMeEnabled.checked ? '1' : '0');
syncVal();
});
}
if (avNickEnabled) {
avNickEnabled.addEventListener('change', () => {
store.set('nick-lib-enabled', avNickEnabled.checked ? '1' : '0');
syncVal();
});
}
if (avMeNickEnabled) {
avMeNickEnabled.addEventListener('change', () => {
store.set('nick-me-lib-enabled', avMeNickEnabled.checked ? '1' : '0');
syncVal();
});
}
function bindPoolUpload(btn, listFn, saveFn, rerender) {
if (!btn) return;
const input = document.createElement('input');
input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
input.id = (btn.id || 'avlib') + '-file-pick'; // FIX 2026-09-18 #717：常驻池选择器身份（诊断/测试句柄，按按钮唯一）
input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;'; // FIX 2026-09-18 #738：sr-only clip 写法（原 offscreen+opacity:0），原生 label 兜底见下
document.body.appendChild(input);
input.onchange = () => {
const files = Array.prototype.slice.call(input.files || []);
input.value = '';
if (!files.length) return;
const list = listFn();
let done = 0, okCount = 0, failCount = 0;
files.forEach(f => {
const reader = new FileReader();
reader.onerror = () => { done++; failCount++; if (done === files.length) finish(); };
reader.onload = () => {
const img = new Image();
img.onload = () => {
try {
const c = document.createElement('canvas');
const scale = Math.min(1, 256 / Math.max(img.width, img.height));
c.width = Math.max(1, Math.round(img.width * scale));
c.height = Math.max(1, Math.round(img.height * scale));
c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
list.push(c.toDataURL('image/jpeg', 0.85));
okCount++;
} catch (e) {
list.push(reader.result);
okCount++;
}
done++;
if (done === files.length) finish();
};
img.onerror = () => { done++; failCount++; if (done === files.length) finish(); };
img.src = reader.result;
};
reader.readAsDataURL(f);
});
function finish() {
saveFn(list);
rerender();
if (okCount > 0 && failCount === 0) {
toast('成功添加 ' + okCount + ' 张头像');
} else if (okCount > 0 && failCount > 0) {
toast('添加成功 ' + okCount + ' 张，失败 ' + failCount + ' 张');
} else {
toast('添加失败，请选择有效的图片文件');
}
}
};
if (window.mochiFilePickLabel) window.mochiFilePickLabel(btn, input);
if (window.mochiFilePickSurface) {
window.mochiFilePickSurface(btn, { id: input.id + '-tap', accept: 'image/*', multiple: true, owner: input });
}
btn.addEventListener('click', (e) => {
var _fb = () => { window.mochiFilePickFire(input, { onFail: () => toast('无法打开相册，请重试') }); };
if (window.mochiFilePickGuard) window.mochiFilePickGuard(input, _fb);
else _fb();
});
}
bindPoolUpload(avUpload, getLib, saveLib, () => { renderGrid(); syncVal(); });
bindPoolUpload(avMeUpload, getMeLib, saveMeLib, () => { renderMeGrid(); syncVal(); });
function bindNickAdd(btn, listFn, saveFn, rerender) {
if (!btn) return;
btn.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('添加昵称', '', (v) => {
const raw = String(v || '').split(/\r\n|\r|\n|\u2028|\u2029|\u0085/);
const lines = raw.map(cleanNick).filter(Boolean);
const blank = raw.length - lines.length;
if (!lines.length) { toast('没有可添加的昵称（都是空行或只有不可见字符）'); return; }
const list = listFn();
let dup = 0;
lines.forEach(n => { if (list.indexOf(n) >= 0) { dup++; return; } list.push(n); });
const added = lines.length - dup;
if (!added) { toast(dup > 1 ? '这 ' + dup + ' 个昵称都已经在池子里了' : '这个昵称已经在池子里了'); return; }
saveFn(list);
rerender();
const tail = (dup ? '，' + dup + ' 个已存在' : '') + (blank ? '，跳过 ' + blank + ' 个空行' : '');
if (dup || blank) toast('已添加 ' + added + ' 个昵称' + tail);
else toast(added > 1 ? '已添加 ' + added + ' 个昵称' : '已添加昵称「' + lines[0] + '」');
}, {
textarea: true, textareaRows: 6,
textareaPlaceholder: '一行一个昵称，可一次粘贴多个（每个最多 30 字）',
staticText: '一行一个，空行会自动跳过；池子里已有的不会重复添加。'
});
});
}
bindNickAdd(avNickAdd, getNickLib, saveNickLib, renderNickGrid);
bindNickAdd(avMeNickAdd, getMeNickLib, saveMeNickLib, renderMeNickGrid);
function bindPoolClear(btn, saveFn, rerender, title, okText) {
if (!btn) return;
btn.addEventListener('click', () => {
if (window.openModal) {
window.openModal(title, '', () => {
saveFn([]);
rerender();
toast(okText);
}, { noInput: true });
}
});
}
bindPoolClear(avClear, saveLib, () => { renderGrid(); syncVal(); }, '清空头像池？', '已清空头像池');
bindPoolClear(avMeClear, saveMeLib, () => { renderMeGrid(); syncVal(); }, '清空我的头像池？', '已清空我的头像池');
bindPoolClear(avNickClear, saveNickLib, () => { renderNickGrid(); syncVal(); }, '清空昵称池？', '已清空昵称池');
bindPoolClear(avMeNickClear, saveMeNickLib, () => { renderMeNickGrid(); syncVal(); }, '清空我的昵称池？', '已清空我的昵称池');
function applyAvatarImg(data, out, chatOnly) {
if (data) {
try {
const _warm = new Image();
_warm.decoding = 'async';
_warm.src = data;
if (_warm.decode) { const _p = _warm.decode(); if (_p && _p.catch) _p.catch(function () {}); }
} catch (e) {}
}
const chatAv = document.getElementById(out ? 'chat-user-av' : 'chat-partner-av');
const deskRing = chatOnly ? null : document.querySelector(out ? '#avatar-user .ring' : '#avatar-partner .ring');
const applyTo = (el) => {
if (!el) return;
const want = data || '';
if (el.__avApplied === want) return;
el.__avApplied = want;
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
};
applyTo(chatAv);
applyTo(deskRing);
document.querySelectorAll((out ? '.msg-out' : '.msg-in') + ' .msg-av').forEach(av => { applyTo(av); });
}
function chatSystem(text, img, keep) {
if (window.chatAddSystem) window.chatAddSystem(text, { img: img, nickKeep: !!keep });
if (window.addAvatarRecord) {
window.addAvatarRecord(img, text);
} else {
setTimeout(function () {
try { if (window.addAvatarRecord) window.addAvatarRecord(img, text); } catch (e) {}
}, 600);
}
}
function replyInvite(accepted, img) {
const name = cPartnerName();
const myName = cUserName();
const text = accepted
? name + ' 同意了' + myName + '的换头像邀请'
: name + ' 拒绝了' + myName + '的换头像邀请';
chatSystem(text, img);
toast(text);
}
function switchAvatarFromLib(data) {
const lib = getLib();
if (!data || lib.indexOf(data) === -1) return;
const before = store.get('cs-avatar-partner');
const nextHours = String(1 + Math.random() * 7);
const inviteHit = Math.random() * 100 < INVITE_PROB;
const agreeHit = Math.random() * 100 < AGREE_PROB;
normalizeAvSize(data, function (fit) {
store.set('cs-avatar-partner', fit);
applyAvatarImg(fit, false, true);
noteApplied('partner', fit);
store.set('avatar-lib-last', String(Date.now()));
store.set('avatar-lib-next', nextHours);
store.set('avatar-lib-cur-hash', strHash(data));
updateGridNow(); // FIX #508：库没变只换高亮，不整格重建（重渲=图片全部重新解码闪烁）
if (inviteHit) {
if (agreeHit) {
replyInvite(true, fit); // 同意：头像保持新换的，消息带新头像图
} else {
if (before) { store.set('cs-avatar-partner', before); store.set('avatar-lib-cur-hash', strHash(before)); }
else { store.remove('cs-avatar-partner'); store.remove('avatar-lib-cur-hash'); }
applyAvatarImg(before || null, false, true);
updateGridNow(); // FIX #508 同上
noteApplied('partner', before || '');
replyInvite(false, fit);
}
} else {
toast('头像已切换');
const name = cPartnerName();
const myName = cUserName();
chatSystem(myName + ' 更换了 ' + name + ' 的头像', fit);
}
});
}
function switchMyAvatarFromLib(data) {
const lib = getMeLib();
if (!data || lib.indexOf(data) === -1) return;
normalizeAvSize(data, function (fit) {
store.set('cs-avatar-user', fit);
applyAvatarImg(fit, true, true);
store.set('avatar-me-lib-cur-hash', strHash(data));
updateMeGridNow(); // FIX #508：库没变只换高亮，不整格重建
noteApplied('user', fit);
toast('头像已更换');
const myName = cUserName();
chatSystem(myName + ' 更换了头像', fit);
});
}
function replyMeInvite(accepted, data) {
const name = cPartnerName();
const myName = cUserName();
const text = accepted
? myName + ' 同意了' + name + '的换头像邀请'
: myName + ' 拒绝了' + name + '的换头像邀请';
chatSystem(text, accepted ? data : null);
toast(text);
}
function showMeAvatarInvite(data) {
const name = cPartnerName();
window.openModal(name + ' 的换头像邀请', '', (v) => {
if (v === '1') {
normalizeAvSize(data, function (fit) {
store.set('cs-avatar-user', fit);
applyAvatarImg(fit, true, true);
store.set('avatar-me-lib-cur-hash', strHash(data));
updateMeGridNow(); // FIX #508 同上
noteApplied('user', fit);
replyMeInvite(true, fit);
});
} else {
replyMeInvite(false, null);
}
}, {
noInput: true,
lock: true,
pills: [{ label: '同意', value: '1' }, { label: '拒绝', value: '0' }],
pill: '1',
staticText: name + ' 邀请你换上这张头像'
});
const se = document.getElementById('modal-static');
if (se) {
const img = document.createElement('img');
img.src = data;
img.alt = '';
img.style.cssText = 'width:96px;height:96px;border-radius:50%;object-fit:cover;display:block;margin:10px auto;';
se.appendChild(img);
}
}
function avClaimCycle(key, now) {
try {
const p = window.activePrefix ? window.activePrefix() : uid;
const raw = localStorage.getItem(p + ':' + key);
return raw === null || raw === String(now);
} catch (e) { return true; }
}
function getMeAvatarLast() { const v = parseInt(store.get('avatar-me-lib-last'), 10); return isNaN(v) ? 0 : v; }
function getMeAvatarNext() { const v = parseFloat(store.get('avatar-me-lib-next')); return isNaN(v) ? 0 : v; }
function checkMeAvatarRefresh() {
try {
if (!getMeEnabled()) return;
if (avNightQuiet()) return;
const now = Date.now();
let last = getMeAvatarLast();
let next = getMeAvatarNext();
if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
if ((now - last) / 36e5 < next) return;
const lib = getMeLib();
if (!lib.length) return;
const idx = Math.floor(Math.random() * lib.length);
const data = lib[idx];
if (!data) return;
if (data === (store.get('cs-avatar-user') || store.get('avatar-user'))) return;
const curMeHash = store.get('avatar-me-lib-cur-hash');
if (curMeHash && strHash(data) === curMeHash) return;
const invite = Math.random() * 100 < INVITE_PROB;
if (invite) {
const mask = document.getElementById('modal-mask');
if (mask && !mask.hidden) return;
}
store.set('avatar-me-lib-last', String(now));
store.set('avatar-me-lib-next', String(1 + Math.random() * 7));
if (!avClaimCycle('avatar-me-lib-last', now)) return;
if (invite) {
showMeAvatarInvite(data);
if (document.visibilityState === 'hidden' && window.bgNotifyCheck) {
const iname = store.get('lbl-partner') || 'TA';
window.bgNotifyCheck(iname + ' 想给你换头像', Date.now(), { name: iname, img: data });
}
} else {
const trigHash = strHash(data);
store.set('avatar-me-lib-cur-hash', trigHash);
normalizeAvSize(data, function (fit) {
store.set('cs-avatar-user', fit);
applyAvatarImg(fit, true, true);
updateMeGridNow(); // FIX #508 同上
noteApplied('user', fit);
const name = cPartnerName();
const text = name + ' 更换了你的头像';
chatSystem(text, fit);
toast(text);
});
}
} catch (e) {}
}
function getAvatarLast() { const v = parseInt(store.get('avatar-lib-last'), 10); return isNaN(v) ? 0 : v; }
function getAvatarNext() { const v = parseFloat(store.get('avatar-lib-next')); return isNaN(v) ? 0 : v; }
function checkAvatarLibRefresh() {
try {
if (!getEnabled()) return;
if (avNightQuiet()) return;
const now = Date.now();
let last = getAvatarLast();
let next = getAvatarNext();
if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
if ((now - last) / 36e5 < next) return;
const lib = getLib();
if (!lib.length) return;
const idx = Math.floor(Math.random() * lib.length);
const data = lib[idx];
if (!data) return;
if (data === (store.get('cs-avatar-partner') || store.get('avatar-partner'))) return;
const curHash = store.get('avatar-lib-cur-hash');
if (curHash && strHash(data) === curHash) return;
store.set('avatar-lib-last', String(now));
store.set('avatar-lib-next', String(1 + Math.random() * 7));
if (!avClaimCycle('avatar-lib-last', now)) return;
const trigHash = strHash(data);
store.set('avatar-lib-cur-hash', trigHash);
normalizeAvSize(data, function (fit) {
store.set('cs-avatar-partner', fit);
applyAvatarImg(fit, false, true);
updateGridNow(); // FIX #508：定时随机换同样只换高亮（半框开着时不再整格闪烁）
noteApplied('partner', fit);
chatSystem(cPartnerName() + ' 更换了头像', fit);
try {
if (window.bgNotifyCheck) {
window.bgNotifyCheck((store.get('lbl-partner') || 'TA') + ' 更换了头像', Date.now(), { name: store.get('lbl-partner') || 'TA', av: fit });
}
} catch (e) {}
});
} catch (e) {}
}
try { setInterval(checkAvatarLibRefresh, 60000); } catch (e) {}
checkAvatarLibRefresh();
try { setInterval(checkMeAvatarRefresh, 60000); } catch (e) {}
checkMeAvatarRefresh();
function applyPartnerNick(name) {
const oldEff = window.chatPartnerName ? window.chatPartnerName() : (store.get('cs-lbl-partner') || 'TA');
if (name) store.set('cs-lbl-partner', name); else store.remove('cs-lbl-partner');
const newEff = window.chatPartnerName ? window.chatPartnerName() : (store.get('cs-lbl-partner') || 'TA');
if (oldEff !== newEff) {
try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff); } catch (e) {}
}
try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
syncVal();
}
function applyMyNick(name) {
const oldEff = store.get('cs-lbl-user') || '我';
if (name) store.set('cs-lbl-user', name); else store.remove('cs-lbl-user');
const newEff = store.get('cs-lbl-user') || '我';
if (oldEff !== newEff) {
try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff, 'me'); } catch (e) {}
}
try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
syncVal();
}
function nickMsgPartner(to) { return 'TA 把聊天昵称换成了「' + to + '」'; }
function nickMsgMeSet(to) { return '我把 TA 的聊天昵称换成了「' + to + '」'; }
function nickMsgMeSelf(to) { return '我把自己的聊天昵称换成了「' + to + '」'; }
function nickMsgTaSetMine(to) { return 'TA 把我的聊天昵称换成了「' + to + '」'; }
function replyNickInvite(accepted, name) {
const to = String(name || store.get('cs-lbl-partner') || '');
const text = accepted
? (to ? 'TA 同意了我的换昵称邀请，昵称换成了「' + to + '」' : 'TA 同意了我的换昵称邀请')
: 'TA 拒绝了我的换昵称邀请，昵称保持不变';
chatSystem(text, null, true);
toast(text);
}
function replyMeNickInvite(accepted, name) {
const to = String(name || store.get('cs-lbl-user') || '');
const text = accepted
? (to ? '我同意了 TA 的换昵称邀请，我的昵称换成了「' + to + '」' : '我同意了 TA 的换昵称邀请')
: '我拒绝了 TA 的换昵称邀请，昵称保持不变';
chatSystem(text, null, true);
}
function switchNickFromLib(name) {
const lib = getNickLib();
if (!name || lib.indexOf(name) === -1) return;
const before = store.get('cs-lbl-partner');
const nextHours = String(1 + Math.random() * 7);
const inviteHit = Math.random() * 100 < INVITE_PROB;
const agreeHit = Math.random() * 100 < AGREE_PROB;
store.set('nick-lib-last', String(Date.now()));
store.set('nick-lib-next', nextHours);
if (inviteHit && !agreeHit) {
store.set('nick-lib-cur-hash', strHash(before || ''));
updateNickGridNow();
replyNickInvite(false);
return;
}
applyPartnerNick(name);
store.set('nick-lib-cur-hash', strHash(name));
updateNickGridNow();
if (inviteHit) replyNickInvite(true, name);
else { toast('昵称已切换'); chatSystem(nickMsgMeSet(name), null, true); }
}
function switchMyNickFromLib(name) {
const lib = getMeNickLib();
if (!name || lib.indexOf(name) === -1) return;
applyMyNick(name);
store.set('nick-me-lib-cur-hash', strHash(name));
updateMeNickGridNow();
toast('昵称已更换');
chatSystem(nickMsgMeSelf(name), null, true);
}
function showMeNickInvite(name) {
if (!window.openModal) return;
name = cleanNick(name);
if (!name) return;
const ta = cPartnerName();
window.openModal(ta + ' 的换昵称邀请', '', (v) => {
if (v === '1') {
applyMyNick(name);
store.set('nick-me-lib-cur-hash', strHash(name));
updateMeNickGridNow();
replyMeNickInvite(true, name);
} else {
replyMeNickInvite(false);
}
}, {
noInput: true,
lock: true,
pills: [{ label: '同意', value: '1' }, { label: '拒绝', value: '0' }],
pill: '1',
staticText: ta + ' 邀请你换上这个昵称'
});
const se = document.getElementById('modal-static');
if (se) {
const p = document.createElement('div');
p.textContent = name;
p.style.cssText = 'font-size:20px;font-weight:700;text-align:center;margin:10px 0 2px;word-break:break-all;';
se.appendChild(p);
}
}
function getMeNickLast() { const v = parseInt(store.get('nick-me-lib-last'), 10); return isNaN(v) ? 0 : v; }
function getMeNickNext() { const v = parseFloat(store.get('nick-me-lib-next')); return isNaN(v) ? 0 : v; }
function checkMeNickRefresh() {
try {
if (!getMeNickEnabled()) return;
if (avNightQuiet()) return;
const now = Date.now();
let last = getMeNickLast();
let next = getMeNickNext();
if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
if ((now - last) / 36e5 < next) return;
const lib = getMeNickLib();
if (!lib.length) return;
const name = lib[Math.floor(Math.random() * lib.length)];
if (!name) return;
if (name === curMyNick()) return;
const curHash = store.get('nick-me-lib-cur-hash');
if (curHash && strHash(name) === curHash) return;
const invite = Math.random() * 100 < INVITE_PROB;
if (invite) {
const mask = document.getElementById('modal-mask');
if (mask && !mask.hidden) return;
}
store.set('nick-me-lib-last', String(now));
store.set('nick-me-lib-next', String(1 + Math.random() * 7));
if (!avClaimCycle('nick-me-lib-last', now)) return; // FIX #882：同头像池口径，双开上下文只留先认领的一方
if (invite) {
showMeNickInvite(name);
if (document.visibilityState === 'hidden' && window.bgNotifyCheck) {
const iname = store.get('lbl-partner') || 'TA';
window.bgNotifyCheck(iname + ' 想给你换昵称', Date.now(), { name: iname });
}
} else {
applyMyNick(name);
store.set('nick-me-lib-cur-hash', strHash(name));
updateMeNickGridNow();
const text = nickMsgTaSetMine(name);
chatSystem(text, null, true);
toast(text);
}
} catch (e) {}
}
function getNickLast() { const v = parseInt(store.get('nick-lib-last'), 10); return isNaN(v) ? 0 : v; }
function getNickNext() { const v = parseFloat(store.get('nick-lib-next')); return isNaN(v) ? 0 : v; }
function checkNickLibRefresh() {
try {
if (!getNickEnabled()) return;
if (avNightQuiet()) return;
const now = Date.now();
let last = getNickLast();
let next = getNickNext();
if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
if ((now - last) / 36e5 < next) return;
const lib = getNickLib();
if (!lib.length) return;
const name = lib[Math.floor(Math.random() * lib.length)];
if (!name) return;
if (name === curPartnerNick()) return;
const curHash = store.get('nick-lib-cur-hash');
if (curHash && strHash(name) === curHash) return;
store.set('nick-lib-last', String(now));
store.set('nick-lib-next', String(1 + Math.random() * 7));
if (!avClaimCycle('nick-lib-last', now)) return; // FIX #882：同头像池口径，双开上下文只留先认领的一方
applyPartnerNick(name);
store.set('nick-lib-cur-hash', strHash(name));
updateNickGridNow();
const text = nickMsgPartner(name);
chatSystem(text, null, true);
try {
if (window.bgNotifyCheck) window.bgNotifyCheck(text, Date.now(), { name: cPartnerName() });
} catch (e) {}
} catch (e) {}
}
try { setInterval(checkNickLibRefresh, 60000); } catch (e) {}
checkNickLibRefresh();
try { setInterval(checkMeNickRefresh, 60000); } catch (e) {}
checkMeNickRefresh();
syncAvPane();
function restoreLib(key) {
if (!window.idbGet) return;
const myPrefix = window.activePrefix();
let retry = 0;
function tryOnce() {
window.idbGet(myPrefix + ':' + key).then(v => {
if (window.activePrefix() !== myPrefix) return; // 已切桌面，作废
if (!v || typeof v !== 'string' || v.length <= 2) {
if (retry < 3) { retry++; setTimeout(tryOnce, 800 * retry); }
return;
}
try {
const idbArr = JSON.parse(v);
let localArr = null;
try { localArr = JSON.parse(store.get(key) || 'null'); } catch (e) {}
const localLen = Array.isArray(localArr) ? localArr.length : -1;
if (localLen < 0 || (Array.isArray(idbArr) && idbArr.length > localLen)) {
store.set(key, v);
refreshAvGrids(); // FIX #509：回填后用「库没变不重建」口径刷新，避免整格重建再闪一次
}
} catch (e) { store.set(key, v); refreshAvGrids(); }
});
}
tryOnce();
}
try { restoreLib('avatar-lib'); } catch (e) {}
try { restoreLib('avatar-me-lib'); } catch (e) {}
try { restoreLib('nick-lib'); } catch (e) {}
try { restoreLib('nick-me-lib'); } catch (e) {}
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("avatar-lib.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("avatar-lib.js"); try { console.error("[JS] avatar-lib.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[avatar-lib.js] " + String(__e && __e.message || __e)); } })();