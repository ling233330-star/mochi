(function () { try {
(function () {
const body = document.getElementById('gc-body');
if (!body) return;
const G = 'xy-home-v2';
const MSG_KEY = G + ':group-chat-msgs';
const page = document.getElementById('page-group-chat');
const gcLoadingEl = document.getElementById('gc-loading');
let gcAuthPending = false; // 权威读库是否在途（切群/重进由 gcLoadSeq 作废旧等待）
let gcLoadSeq = 0;
function updateGcLoading() {
if (!gcLoadingEl) return;
gcLoadingEl.hidden = !(page && !page.hidden && gcAuthPending);
}
function gcLoadSettle(seq) {
if (seq !== gcLoadSeq) return; // 已切群/重进：本次等待作废，由新一次 loadMsgs 管理
gcAuthPending = false;
updateGcLoading();
}
const input = document.getElementById('gc-input');
const sendBtn = document.getElementById('gc-send');
const backBtn = document.getElementById('gc-back');
const nameEl = document.getElementById('gc-name');
const typingEl = document.getElementById('gc-typing');
const membersBtn = document.getElementById('gc-members-btn');
const membersPanel = document.getElementById('gc-members-panel');
const membersClose = document.getElementById('gc-mp-close');
const membersBody = document.getElementById('gc-mp-body');
const atPanel = document.getElementById('gc-at-panel');
const atBody = document.getElementById('gc-at-body');
const gcMoreBtn = document.getElementById('gc-input-more-btn');
const gcMorePanel = document.getElementById('chat-more-panel');   // 共享浮层（.phone 级，聊天页也用它）
const gcMoreAt = document.getElementById('gc-more-at');
const gcEmojiBtn = document.getElementById('gc-emoji-btn');
const gcImgBtn = document.getElementById('gc-img-btn');
const gcMicBtn = document.getElementById('gc-mic-btn');
const gcContinueBtn = document.getElementById('gc-continue-btn');
const gcBatchBtn = document.getElementById('gc-batch-btn');
const gcDraftBar = document.getElementById('gc-draft');
const gcDraftItems = document.getElementById('gc-draft-items');
const groupsPanel = document.getElementById('gc-groups-panel');
const gpBody = document.getElementById('gc-gp-body');
const gpClose = document.getElementById('gc-gp-close');
const gpickPanel = document.getElementById('gc-gpick-panel');
const gpickTitle = document.getElementById('gc-gpick-title');
const gpickBody = document.getElementById('gc-gpick-body');
const gpickCancel = document.getElementById('gc-gpick-cancel');
const gpickOkBtn = document.getElementById('gc-gpick-ok');
const gpickClose = document.getElementById('gc-gpick-close');
const FALLBACK_REPLIES = ['好的～', '嗯嗯', '收到', '哈哈', '在的', '我知道啦', '是吗', '然后呢', '有意思', '同意', '哈哈哈', '对的', '没错', '我也觉得', '确实', '哇'];
let msgs = [];
const RENDER_MAX = 200;
let groups = [];
let curGid = 'default';
function gcGroupsStore() { return window.xyStore(G); }
function loadGroups() {
const def = { id: 'default', name: '群聊', members: null, ts: 0 };
groups = [def];
try {
const v = gcGroupsStore().get('gc-groups');
if (v) {
const a = JSON.parse(v);
if (Array.isArray(a)) a.forEach(g => { if (g && g.id && g.id !== 'default') groups.push(g); });
}
} catch (e) {}
try {
const c = gcGroupsStore().get('gc-cur-gid');
if (c && groups.some(g => g.id === c)) curGid = c;
} catch (e) {}
}
function saveGroups() { try { gcGroupsStore().set('gc-groups', JSON.stringify(groups)); } catch (e) {} }
function saveCurGid() { try { gcGroupsStore().set('gc-cur-gid', curGid); } catch (e) {} }
function currentGroup() { return groups.find(g => g.id === curGid) || groups[0]; }
function groupMsgKey(gid) { return gid === 'default' ? MSG_KEY : G + ':gc-msgs-' + gid; }
function groupMemberList(g) {
let all = [];
try { all = window.getContacts() || []; } catch (e) {}
if (!g || !g.members) return all; // default 群：全部现有联系人（动态跟随）
const set = {}; g.members.forEach(id => { set[id] = 1; });
return all.filter(c => set[c.id]);
}
loadGroups();
const gcProfiles = {};
function gcProfileStore() { try { return window.xyStore(G); } catch (e) { return null; } }
function gcProfileLoad() {
try {
const v = gcProfileStore().get('gc-profiles');
if (v) {
const o = JSON.parse(v);
if (o && typeof o === 'object') Object.keys(o).forEach(k => { gcProfiles[k] = o[k]; });
}
} catch (e) {}
}
function gcProfileSave() {
try { gcProfileStore().set('gc-profiles', JSON.stringify(gcProfiles)); } catch (e) {}
}
function gcProfileGet(key) { return gcProfiles[key] || {}; }
function gcProfileSet(key, name, avatar) {
const p = gcProfiles[key] || (gcProfiles[key] = {});
if (name === undefined) delete p.name; else if (name) p.name = name; else delete p.name;
if (avatar === undefined) delete p.avatar; else if (avatar) p.avatar = avatar; else delete p.avatar;
if (!p.name && !p.avatar) delete gcProfiles[key];
gcProfileSave();
refreshGroupViews();
}
function refreshGroupViews() {
try { renderAll(); } catch (e) {}
try { if (membersPanel && !membersPanel.hidden) renderMembersPanel(); } catch (e) {}
try { if (atPanel && !atPanel.hidden) renderAtPanel(); } catch (e) {}
try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
try { updateGroupName(); } catch (e) {}
}
gcProfileLoad();
const GC_BEAUTY_DEFAULTS = {
'out-bg': '#111111', 'out-ink': '#ffffff', 'in-bg': '#ffffff', 'in-ink': '#111111',
'send-bg': '#111111', 'send-ink': '#ffffff', 'send-show': 'show',
'font-size': '14px', 'bubble-size': '11px 14px',
'bubble-radius': '18px', 'time-ink': '#111111', 'typing-ink': '#8a8a8a',
'av-shape': 'circle', 'time-style': 'under-av',
'bubble-op': 100, 'head-op': 92, 'input-op': 92, 'head-inset': 0, 'input-inset': 0,
'bg': '', 'font': '', 'css': '',
'show-name': 'off'
};
const GC_BEAUTY_STYLES = [
{ label: '头像下方', value: 'under-av' },
{ label: '气泡下方', value: 'under-bubble' },
{ label: '时间气泡', value: 'bubble' },
{ label: '气泡外侧悬浮', value: 'float' },
{ label: '消息上方居中', value: 'center' },
{ label: '隐藏', value: 'hidden' }
];
const GC_FONT_SIZES = [
{ label: '小', value: '13px' },
{ label: '标准', value: '14px' },
{ label: '大', value: '16px' },
{ label: '特大', value: '18px' }
];
const GC_BUBBLE_SIZES = [
{ label: '紧凑', value: '8px 10px' },
{ label: '标准', value: '11px 14px' },
{ label: '宽松', value: '14px 18px' }
];
const GC_BUBBLE_RADII = [
{ label: '小圆角', value: '6px' },
{ label: '标准', value: '12px' },
{ label: '大圆角', value: '18px' },
{ label: '特圆', value: '28px' }
];
const GC_BUBBLE_RADIUS_DEFAULT = '18px';
const GC_BUBBLE_BG = [
{ color: '#111111', label: '默认黑' }, { color: '#ffffff', label: '白色' }, { color: '#3a3a3a', label: '炭灰' },
{ color: '#ffd6e0', label: '樱花粉' }, { color: '#d6e4ff', label: '雾霭蓝' }, { color: '#d8f5e0', label: '薄荷绿' },
{ color: '#fff3d6', label: '奶油黄' }, { color: '#e8dcff', label: '淡紫' }, { color: '#ffdcc0', label: '暖橘' }
];
const GC_INK_COLORS = [
{ color: '#111111', label: '默认黑' }, { color: '#ffffff', label: '白色' }, { color: '#444444', label: '深灰' },
{ color: '#d6336c', label: '玫红' }, { color: '#1a56db', label: '蓝' }, { color: '#1e8e5a', label: '绿' },
{ color: '#9a6b00', label: '黄褐' }, { color: '#7048e8', label: '紫' }, { color: '#b3540a', label: '橘' }
];
const GC_SEND_BG = [
{ color: '#111111', label: '默认黑' }, { color: '#07c160', label: '微信绿' }, { color: '#fa5151', label: '红包红' },
{ color: '#3a8ee6', label: '天空蓝' }, { color: '#ff9500', label: '活力橙' }, { color: '#9254de', label: '优雅紫' },
{ color: '#ffffff', label: '白色' }, { color: '#3a3a3a', label: '炭灰' }
];
const gcBeautyStored = {};
const GC_DARK_DEFAULTS = { 'out-bg': '#3a3a3a', 'in-bg': '#2a2a2a', 'in-ink': '#f0f0f0', 'send-bg': '#f0f0f0', 'send-ink': '#111111', 'time-ink': '#8a8a8a' };
function gcBeautyStore() { return gcProfileStore(); }
function gcBeautyLoad() {
try {
const v = gcBeautyStore().get('gc-beauty');
if (v) { const o = JSON.parse(v); if (o && typeof o === 'object') Object.keys(o).forEach(k => { gcBeautyStored[k] = o[k]; }); }
} catch (e) {}
}
function gcBeautyGet(k) {
if (gcBeautyStored[k] !== undefined) return gcBeautyStored[k];
if (document.documentElement.getAttribute('data-theme') === 'dark' && GC_DARK_DEFAULTS[k] !== undefined) return GC_DARK_DEFAULTS[k];
return GC_BEAUTY_DEFAULTS[k];
}
function gcBeautySave() { try { gcBeautyStore().set('gc-beauty', JSON.stringify(gcBeautyStored)); } catch (e) {} }
function gcHexRgb(c) {
const s = String(c === undefined || c === null ? '' : c).trim();
let m = /^#([0-9a-f]{3})$/i.exec(s);
if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
m = /^#([0-9a-f]{6})$/i.exec(s);
if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
return null;
}
function gcClampNum(v, min, max, def) {
const n = Number(v);
if (!Number.isFinite(n)) return def;
return Math.max(min, Math.min(max, Math.round(n)));
}
function gcApplyBubbleSurfaceWith(op) {
const page = document.getElementById('page-group-chat');
if (!page) return;
const o = gcClampNum(op, 0, 100, 100);
const surf = (color) => {
if (o >= 100) return color;
const rgb = gcHexRgb(color);
return rgb ? 'rgba(' + rgb.join(',') + ',' + (o / 100) + ')' : color;
};
gcSetVar(page, '--msg-in-bg', surf(gcBeautyGet('in-bg')));
gcSetVar(page, '--msg-out-bg', surf(gcBeautyGet('out-bg')));
}
function gcApplyBubbleSurface() {
gcApplyBubbleSurfaceWith(gcBeautyGet('bubble-op'));
}
function gcBeautySet(k, v) {
const def = GC_BEAUTY_DEFAULTS[k];
if (v === undefined || v === null || v === '' || (def !== undefined && v === def)) delete gcBeautyStored[k];
else gcBeautyStored[k] = v;
gcBeautySave();
applyGcBeauty();
if (k === 'show-name') { try { renderAll(); } catch (e) {} }
try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
}
let gcFontApplied = null;
function applyGcFont() {
const page = document.getElementById('page-group-chat');
const v = gcBeautyGet('font');
if (v === gcFontApplied && (!v || document.getElementById('gc-font-style'))) return;
gcFontApplied = v;
const old = document.getElementById('gc-font-style');
if (old) old.remove();
if (page) page.style.fontFamily = '';
if (!v) return;
if (v.indexOf('data:') === 0) {
const st = document.createElement('style');
st.id = 'gc-font-style';
st.textContent = '@font-face{font-family:"gc-custom-font";src:url("' + String(v).replace(/<\/style/gi, '') + '");font-display:swap;}' +
'#page-group-chat{font-family:"gc-custom-font",sans-serif !important;}';
document.head.appendChild(st);
} else {
page.style.fontFamily = '"' + v.replace(/"/g, "'") + '",sans-serif';
}
}
function applyGcCss() {
const old = document.getElementById('gc-bubble-style');
if (old) old.remove();
const css = gcBeautyGet('css');
if (!css) return;
let out = css, hint = null;
if (window.mochiMapBubbleCss) {
const res = window.mochiMapBubbleCss(css, '#page-group-chat ');
out = res.out;
hint = res.hint;
} else if (css.indexOf('{') < 0) {
out = '#page-group-chat .msg-out .msg-bubble{' + css + '!important;}' +
'#page-group-chat .msg-in .msg-bubble{' + css + '!important;}';
}
const st = document.createElement('style');
st.id = 'gc-bubble-style';
st.textContent = out;
document.head.appendChild(st);
if (hint) setTimeout(() => { try { toast(hint); } catch (e) {} }, 50);
}
const gcSetVar = (el, name, value) => { if (!el) return; const v = String(value); if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };
const gcDelVar = (el, name) => { if (el && el.style.getPropertyValue(name) !== '') el.style.removeProperty(name); };
const gcSetCls = (el, cls, on) => { if (!el) return; if (on) { if (!el.classList.contains(cls)) el.classList.add(cls); } else if (el.classList.contains(cls)) el.classList.remove(cls); };
function applyGcBeauty() {
const page = document.getElementById('page-group-chat');
if (!page) return;
const g = gcBeautyGet;
gcSetVar(page, '--msg-in-ink', g('in-ink'));
gcSetVar(page, '--msg-out-ink', g('out-ink'));
gcApplyBubbleSurface();
gcSetVar(page, '--chat-font-size', g('font-size'));
gcSetVar(page, '--chat-bubble-pad', g('bubble-size'));
gcSetVar(page, '--chat-bubble-radius', g('bubble-radius'));
gcSetVar(page, '--msg-time-ink', g('time-ink'));
gcSetVar(page, '--typing-ink', g('typing-ink'));
gcSetVar(page, '--send-bg', g('send-bg'));
gcSetVar(page, '--send-ink', g('send-ink'));
gcSetVar(page, '--msg-av-radius', g('av-shape') === 'square' ? '10px' : '50%');
gcSetVar(page, '--cs-head-opacity', String(gcClampNum(g('head-op'), 0, 100, 92) / 100));
gcSetVar(page, '--cs-input-opacity', String(gcClampNum(g('input-op'), 0, 100, 92) / 100));
gcSetVar(page, '--cs-head-inset', gcClampNum(g('head-inset'), 0, 80, 0) + 'px');
gcSetVar(page, '--cs-input-inset', gcClampNum(g('input-inset'), 0, 80, 0) + 'px');
const sendBtn = document.getElementById('gc-send');
if (sendBtn) { if (g('send-show') === 'hide') gcSetVar(sendBtn, 'display', 'none'); else gcDelVar(sendBtn, 'display'); }
const wantTime = 'cs-time-' + g('time-style');
GC_BEAUTY_STYLES.forEach(s => { const c = 'cs-time-' + s.value; if (c !== wantTime) gcSetCls(page, c, false); });
gcSetCls(page, wantTime, true);
let bg = g('bg');
if (bg && typeof bg === 'string' && bg.length > 6 * 1024 * 1024) {
try { gcBeautySet('bg', ''); } catch (e) {}
bg = '';
}
const want = bg ? 'url("' + bg + '")' : '';
if (page.style.backgroundImage !== want) {
page.style.backgroundImage = want;
if (bg) { page.style.backgroundSize = 'cover'; page.style.backgroundPosition = 'center'; }
}
applyGcFont();
applyGcCss();
}
gcBeautyLoad();
applyGcBeauty();
document.addEventListener('mochi-restore-done', function () {
try { gcBeautyLoad(); } catch (e) {}
try { applyGcBeauty(); } catch (e) {}
});
try {
new MutationObserver(() => { try { applyGcBeauty(); } catch (e) {} })
.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
} catch (e) {}
function getMembers() {
return groupMemberList(currentGroup());
}
function memberName(cid) {
try { const p = gcProfileGet(cid); if (p.name) return p.name; } catch (e) {}
try { const lbl = window.storeFor(cid).get('lbl-partner'); if (lbl) return lbl; } catch (e) {}
const m = getMembers().find(x => x.id === cid);
return m ? m.name : '成员';
}
function memberAvatar(cid) {
try { const p = gcProfileGet(cid); if (p.avatar) return p.avatar; } catch (e) {}
try { const cs = window.storeFor(cid).get('cs-avatar-partner'); if (cs) return cs; } catch (e) {}
try { return window.storeFor(cid).get('avatar-partner') || ''; } catch (e) { return ''; }
}
function myName() {
try { const p = gcProfileGet('me'); if (p.name) return p.name; } catch (e) {}
try { const v = window.activeStore().get('lbl-user'); if (v) return v; } catch (e) {}
return '我';
}
function myAvatar() {
try { const p = gcProfileGet('me'); if (p.avatar) return p.avatar; } catch (e) {}
try { const cs = window.activeStore().get('cs-avatar-user'); if (cs) return cs; } catch (e) {}
try { return window.activeStore().get('avatar-user') || ''; } catch (e) { return ''; }
}
function deskPartnerName(cid) {
try { const lbl = window.storeFor(cid).get('lbl-partner'); if (lbl) return lbl; } catch (e) {}
const m = getMembers().find(x => x.id === cid);
return m ? m.name : '';
}
function deskMeName() {
try { return window.activeStore().get('lbl-user') || ''; } catch (e) { return ''; }
}
function fillAv(el, dataUrl) {
if (!el) return;
el.innerHTML = '';
if (dataUrl && dataUrl.length > 10 && dataUrl.length < 500 * 1024) {
const img = document.createElement('img');
img.src = dataUrl; img.alt = '';
el.appendChild(img);
} else {
el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>';
}
}
const G_PERSIST_MIN_GAP = 2500;   // 两次实际落盘最小间隔（ms）
let gLastPersistAt = 0;           // 上次实际落盘（performance.now()）
let gPersistTimer = null;         // 排队中标记（rIdle/timeout）
let gPersistRun = null;           // 待执行落盘闭包（tail 只保留最新一次）
function gRunPersist() {
gPersistTimer = null;
const run = gPersistRun;
gPersistRun = null;
if (!run) return;
const wait = G_PERSIST_MIN_GAP - (performance.now() - gLastPersistAt);
if (wait > 0) { gPersistTimer = setTimeout(gRunPersist, wait); return; }
try { Promise.resolve(run()).catch(function () {}); gLastPersistAt = performance.now(); } catch (e) {}
}
function gSchedulePersist(writer) {
gPersistRun = writer;
if (gPersistTimer) return;
if (window.requestIdleCallback) gPersistTimer = window.requestIdleCallback(gRunPersist, { timeout: 4000 });
else gPersistTimer = setTimeout(gRunPersist, 2500);
}
function gFlushPersistNow() {
if (window.__resetting) return;
const run = gPersistRun;
gPersistRun = null;
gPersistTimer = null;
if (run) { try { Promise.resolve(run()).catch(function () {}); gLastPersistAt = performance.now(); } catch (e) {} }
}
async function gcNormalizeMedia() {
if (!window.mochiMediaTokenize) return;
const seen = new Map();
const isImgPayload = window.chatIsDataImgLikeSrc || window.chatIsDataImgSrc; // FIX #948 与单聊/池闸门同口径（octet-stream 图候选也进池，不再整段内联）
const collect = (v) => { if (typeof v === 'string' && isImgPayload && isImgPayload(v) && v.length >= 1024 && !seen.has(v)) seen.set(v, null); };
for (let i = 0; i < msgs.length; i++) {
const r = msgs[i];
if (!r) continue;
if (r.type === 'sticker' || r.type === 'image') collect(r.text);
if (r.parts && r.parts.length) r.parts.forEach(p => { if (p && p.k === 'img') collect(p.v); });
if (r.quote) {
if (typeof r.quote === 'string') collect(r.quote);
else if (r.quote.imgs && r.quote.imgs.length) r.quote.imgs.forEach(collect);
}
}
if (!seen.size) return;
await Promise.all(Array.from(seen.keys()).map(v =>
Promise.resolve(window.mochiMediaTokenize(v)).then(t => { seen.set(v, t || v); }).catch(() => {})
));
const apply = (v) => { const t = seen.get(v); return (t && t !== v) ? t : v; };
for (let i = 0; i < msgs.length; i++) {
const r = msgs[i];
if (!r) continue;
if (r.type === 'sticker' || r.type === 'image') r.text = apply(r.text);
if (r.parts && r.parts.length) r.parts.forEach(p => { if (p && p.k === 'img') p.v = apply(p.v); });
if (r.quote) {
if (typeof r.quote === 'string') { if (seen.has(r.quote)) r.quote = apply(r.quote); }
else if (r.quote.imgs && r.quote.imgs.length) r.quote.imgs = r.quote.imgs.map(apply);
}
}
}
const GC_STR_THRESHOLD = 3 * 1024 * 1024;
const GC_SNAP_LIMIT = 2 * 1024 * 1024;
function gcMsgsBytes(arr) {
if (!Array.isArray(arr)) return 0;
let n = 0;
for (let i = 0; i < arr.length; i++) {
const m = arr[i];
if (!m || typeof m !== 'object') { n += 32; continue; }
if (typeof m.text === 'string') n += m.text.length;
if (Array.isArray(m.parts)) { for (let j = 0; j < m.parts.length; j++) { const p = m.parts[j]; if (p && typeof p.v === 'string') n += p.v.length; } }
if (m.quote && typeof m.quote === 'object' && Array.isArray(m.quote.imgs)) { for (let j = 0; j < m.quote.imgs.length; j++) { if (typeof m.quote.imgs[j] === 'string') n += m.quote.imgs[j].length; } }
n += 64;
}
return n;
}
function gcLiteSnapArray(arr) {
if (gcMsgsBytes(arr) <= GC_SNAP_LIMIT) return arr; // 小记录：全量快照
return arr.map(m => {
if (!m || typeof m !== 'object') return m;
const bigText = typeof m.text === 'string' && m.text.length > 8192;
const bigParts = Array.isArray(m.parts) && m.parts.some(p => p && typeof p.v === 'string' && (p.k === 'img' || p.k === 'voice' || p.v.length > 8192));
const bigQuote = !!(m.quote && typeof m.quote === 'object' && Array.isArray(m.quote.imgs) && m.quote.imgs.some(v => typeof v === 'string' && v.length > 8192));
if (!bigText && !bigParts && !bigQuote) return m;
const c = Object.assign({}, m);
c._lsLite = 1;
if (bigText) c.text = '[内容已省略]';
if (bigParts) {
c.parts = m.parts.map(p => {
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
if (bigQuote) c.quote = Object.assign({}, m.quote, { imgs: m.quote.imgs.map(v => (typeof v === 'string' && v.length > 8192) ? '' : v) });
return c;
});
}
function gcWriteLsSnapshot(key) {
try {
let snapArr = gcLiteSnapArray(msgs);
let snap = JSON.stringify(snapArr);
let round = 0;
while (snap.length > GC_SNAP_LIMIT && snapArr.length > 1 && round < 5) {
round++;
const keep = Math.max(1, Math.floor(snapArr.length / 2));
snapArr = gcLiteSnapArray(msgs.slice(msgs.length - keep));
snap = JSON.stringify(snapArr);
}
if (snap.length <= GC_SNAP_LIMIT) localStorage.setItem(key, snap);
} catch (e) {}
}
async function gcWriteMsgs(quick) {
if (!quick) {
try { await gcNormalizeMedia(); } catch (e) {}
try { if (window.mochiMediaFlush) await window.mochiMediaFlush(); } catch (e) {} // #142：池先落盘，引用后落盘
}
const key = groupMsgKey(curGid);
gcWriteLsSnapshot(key);
if (!msgs.length || gcMsgsBytes(msgs) <= GC_STR_THRESHOLD) {
const data = JSON.stringify(msgs || []);
try { if (window.idbSet) window.idbSet(key, data); } catch (e) {}
return;
}
try {
const ok = window.idbSet ? await window.idbSet(key, msgs) : false;
if (!ok) await window.idbSet(key, JSON.stringify(msgs));
} catch (e) { try { if (window.idbSet) window.idbSet(key, JSON.stringify(msgs)); } catch (e2) {} }
}
function saveMsgs() {
gSchedulePersist(gcWriteMsgs);
}
function saveNow() {
gFlushPersistNow();
gcWriteMsgs(true);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') gFlushPersistNow(); });
window.addEventListener('beforeunload', () => gFlushPersistNow());
function loadMsgs() {
const key = groupMsgKey(curGid);
gcAuthPending = true;
const seq = ++gcLoadSeq;
updateGcLoading();
setTimeout(function () { gcLoadSettle(seq); }, 12000); // 兜底：idbGet 迟迟不落定也不把进度条挂死
try { msgs = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { msgs = []; }
if (!Array.isArray(msgs)) msgs = [];
try {
if (window.idbGet) {
window.idbGet(key).then(v => {
if (key !== groupMsgKey(curGid)) return;
if (v === undefined || v === null) { gcLoadSettle(seq); return; }
let a = null;
if (Array.isArray(v)) a = v;
else { try { const p = JSON.parse(v); if (Array.isArray(p)) a = p; } catch (e2) {} }
if (a && a.length >= msgs.length) {
let snapLite = false;
for (let i = 0; i < msgs.length; i++) { if (msgs[i] && msgs[i]._lsLite) { snapLite = true; break; } }
const sameAsRendered = a.length === msgs.length && !snapLite;
msgs = a;
if (!sameAsRendered) renderAll();
}
gcLoadSettle(seq); // #710：权威落定（合入或放弃）即收起进度条
}).catch(() => { gcLoadSettle(seq); });
} else { gcLoadSettle(seq); }
} catch (e) { gcLoadSettle(seq); }
}
function fmtTime(ts) {
const d = new Date(ts);
return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}
function escapeHtml(s) {
return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escTxt(s) {
return String(s == null ? '' : s)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escTxtBr(s) { return escTxt(s).replace(/\n/g, '<br>'); }
function attrEsc(s) { return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function gcQuoteTextSafe(s) {
let str = String(s == null ? '' : s);
const bar = str.indexOf('|||');
if (bar >= 0) str = bar > 0 ? '[语音] ' + str.slice(0, bar) : '';
const di = str.indexOf('data:');
if (di > 0 && str.length - di > 120) str = str.slice(0, di).trim();
return str;
}
function gcQuoteHtml(q) {
if (q && typeof q === 'object' && Array.isArray(q.imgs) && q.imgs.length) {
const tRaw = gcQuoteTextSafe(q.t);
const tOk = typeof tRaw === 'string' && tRaw && tRaw.indexOf('data:') !== 0;
return '<div class="msg-quote"><span class="msg-quote-imgs">' +
q.imgs.map(s => '<img class="msg-quote-img" src="' + attrEsc(s) + '" alt="图片">').join('') +
'</span>' + (tOk ? '<span class="msg-quote-text">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(tRaw) : escTxtBr(tRaw)) + '</span>' : '') + '</div>'; // FIX 2026-09-13 #394 群聊引用内嵌令牌转图
}
if (q && typeof q === 'string') {
const qs = gcQuoteTextSafe(q);
if (qs.indexOf('data:') === 0) {
return '<div class="msg-quote"><img class="msg-quote-img" src="' + attrEsc(qs) + '" alt="图片"></div>';
}
return '<div class="msg-quote"><span class="msg-quote-text">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(qs) : escTxtBr(qs)) + '</span></div>'; // FIX 2026-09-13 #394 群聊引用内嵌令牌转图
}
return '';
}
let gcVoiceAudio = null;
let gcVoiceBtn = null;
function gcPlayVoice(btn, src) {
if (!src) return;
try { const ex = window.mochiMediaExpand && window.mochiMediaExpand(src); if (ex) src = ex; } catch (e) {}
if (gcVoiceBtn === btn) { try { gcVoiceAudio.pause(); } catch (e) {} try { if (gcVoiceAudio && gcVoiceAudio.parentNode) gcVoiceAudio.parentNode.removeChild(gcVoiceAudio); } catch (e) {} gcVoiceAudio = null; if (gcVoiceBtn) gcVoiceBtn.classList.remove('playing'); gcVoiceBtn = null; return; }
if (gcVoiceBtn) { try { gcVoiceAudio.pause(); } catch (e) {} try { if (gcVoiceAudio && gcVoiceAudio.parentNode) gcVoiceAudio.parentNode.removeChild(gcVoiceAudio); } catch (e) {} gcVoiceBtn.classList.remove('playing'); }
const a = new Audio(src);
a.style.display = 'none';
document.body.appendChild(a);
gcVoiceAudio = a; gcVoiceBtn = btn;
btn.classList.add('playing');
const stop = () => {
try { a.removeAttribute('src'); a.load(); } catch (e) {}
try { if (a.parentNode) a.parentNode.removeChild(a); } catch (e) {}
if (gcVoiceBtn) gcVoiceBtn.classList.remove('playing');
gcVoiceBtn = null; gcVoiceAudio = null;
};
a.addEventListener('ended', stop);
a.addEventListener('error', stop);
a.play().catch(stop);
}
function gcPlaceMsg(m, beforeEl) {
if (beforeEl && beforeEl.parentNode === body) body.insertBefore(m, beforeEl);
else body.appendChild(m);
pruneGcDom();
}
function gcMsgKeyOf(rec) {
if (!rec) return '';
return (rec.ts || 0) + '|' + (rec.side || '') + '|' + (rec.type || '') + '|' + String(rec.text || '').slice(0, 80);
}
function renderMsg(rec, idx, beforeEl) {
const m = document.createElement('div');
m.className = 'msg ' + (rec.side === 'out' ? 'msg-out' : 'msg-in');
if (idx === undefined) idx = msgs.length - 1;
m.dataset.gcIdx = idx;
m.dataset.mk = gcMsgKeyOf(rec); // FIX 2026-09-15 #491 身份锚随渲染写入
const timeHtml = rec.ts ? '<span class="msg-time">' + fmtTime(rec.ts) + '</span>' : '';
if (rec.side === 'out') {
m.innerHTML = '<div class="msg-bubble"></div><div class="msg-side"><div class="msg-av"></div>' + timeHtml + '</div>';
} else {
const nmHtml = gcBeautyGet('show-name') === 'on'
? '<span class="gc-from-name">' + escapeHtml(memberName(rec.cid)) + '</span>'
: '';
m.innerHTML = '<div class="msg-side">' + nmHtml + '<div class="msg-av"></div>' + timeHtml + '</div><div class="msg-bubble"></div>';
}
const av = m.querySelector('.msg-av');
const b = m.querySelector('.msg-bubble');
if (rec.side === 'out') fillAv(av, myAvatar());
else fillAv(av, memberAvatar(rec.cid));
if (rec.side === 'in' && rec.cid) {
av.style.cursor = 'pointer';
av.title = '拍一拍 ' + memberName(rec.cid);
av.addEventListener('click', (e) => { e.stopPropagation(); gcOpenPokeCard(rec.cid); });
}
if (rec.special === 'poke') {
m.className = 'msg-poke';
m.innerHTML = '<span>' + escTxt(rec.text || '') + '</span>';
gcPlaceMsg(m, beforeEl);
return m;
}
if (rec.special === 'system') {
m.className = 'msg-poke';
m.innerHTML = '<span>' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(rec.text || '') : escTxtBr(rec.text || '')) + '</span>'; // FIX 2026-09-13 #394 群聊文本气泡内嵌令牌转图
gcPlaceMsg(m, beforeEl);
return m;
}
const quoteStr = rec.quote ? gcQuoteHtml(rec.quote) : '';
if (rec.retracted) {
b.dataset.orig = gcRetractMediaHtml(rec) || rec.orig || gcRetractFallbackHtml(rec);
if (b.dataset.orig.indexOf('msg-moods') < 0) b.dataset.orig += gcRetractMoodHtml(rec);
const who = rec.side === 'out' ? '我' : memberName(rec.cid);
b.innerHTML = '<span style="opacity:.6;font-size:12px;cursor:pointer">' + who + '撤回了一条消息</span>';
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
} else if (rec.type === 'sticker' || rec.type === 'image' || (rec.type !== 'voice' && window.chatIsImgSrcLike && window.chatIsImgSrcLike(rec.text))) {
if (rec.type !== 'sticker' && rec.type !== 'image') rec.type = 'image';
b.style.padding = '6px';
b.style.background = '';
b.style.border = '';
b.style.boxShadow = '';
b.innerHTML = quoteStr + (rec.type === 'image'
? '<img class="msg-img msg-img-big" src="' + attrEsc(rec.text) + '" alt="图片" loading="lazy" decoding="async">'
: '<img class="msg-img msg-img-sm" src="' + attrEsc(rec.text) + '" alt="表情" loading="lazy" decoding="async">');
} else if (rec.type === 'voice' || (String(rec.text || '').indexOf('|||') >= 0 && /@@m:[0-9a-f]{32}$/.test(String(rec.text || ''))) || (window.chatIsDataAudioSrc && window.chatIsDataAudioSrc(rec.text))) {
b.style.padding = '8px 10px';
b.style.background = '';
b.style.border = '';
b.style.boxShadow = '';
const _vraw = String(rec.text || '');
const _vbare = !!(window.mochiMediaIsToken && window.mochiMediaIsToken(_vraw));
const vparts = _vbare ? [_vraw] : _vraw.split('|||');
let vname = (vparts[0] || '语音消息').replace(/\.[^.]+$/, '');
if (!_vbare && window.mochiMediaIsToken && window.mochiMediaIsToken(vname)) vname = '语音消息';
const vsrc = _vbare ? _vraw : (vparts[1] || '');
b.innerHTML = quoteStr + '<div class="msg-voice" data-src="' + attrEsc(vsrc) + '">' +
'<button class="msg-voice-play" title="播放">' +
'<svg class="voice-ico-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
'<svg class="voice-ico-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' +
'</button>' +
'<div class="msg-voice-wave"><i></i><i></i><i></i><i></i><i></i></div>' +
'<span class="msg-voice-name">' + escTxt(vname) + '</span>' +
'</div>';
const gvBtn = b.querySelector('.msg-voice-play');
if (gvBtn) {
let gvTapGuard = 0;
const gvPlayAction = function () { gcPlayVoice(gvBtn, vsrc); };
gvBtn.addEventListener('click', function (e) {
e.stopPropagation();
if (Date.now() < gvTapGuard) return; // #507 touch 直驱已播，吞补发 click 防双跑
gvPlayAction();
});
gvBtn.addEventListener('touchend', function (e) {
const mt = e.changedTouches && e.changedTouches[0];
if (!mt) return;
e.stopPropagation(); // #507 不入 body touchend＝不开成员菜单、不布吞 click 窗口
if (Date.now() < gvTapGuard) return;
gvTapGuard = Date.now() + 800;
gvPlayAction();
});
}
} else if (rec.parts && rec.parts.length) {
const imgs = rec.parts.filter(p => p.k === 'img');
const textPart = rec.parts.filter(p => p.k === 'text').map(p => p.v).join(' ');
let inner = '';
if (imgs.length) {
inner += '<div class="msg-parts-imgs' + (imgs.length > 1 ? ' multi' : '') + '">' +
imgs.map(p => {
const isSticker = p.sub === 'sticker';
return '<img class="msg-img' + (isSticker ? ' msg-img-sm' : ' msg-img-big') + '" src="' + attrEsc(p.v) + '" alt="' + (isSticker ? '表情' : '图片') + '" loading="lazy" decoding="async">';
}).join('') + '</div>';
}
if (textPart) inner += '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(textPart) : escTxtBr(textPart)) + '</span>'; // FIX 2026-09-13 #394 群聊 parts 文本内嵌令牌转图
b.innerHTML = quoteStr + inner;
} else {
b.innerHTML = quoteStr + '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(rec.text || '') : escTxtBr(rec.text || '')) + '</span>';
}
if (rec.mood && rec.mood.length) {
let mm = b.querySelector('.msg-moods');
if (!mm) {
mm = document.createElement('div');
mm.className = 'msg-moods';
b.appendChild(mm);
}
rec.mood.forEach(md => {
if (!md) return;
const tag = md.tag || '情绪';
const label = md.label == null ? '' : String(md.label);
mm.innerHTML += '<div class="msg-mood' + (md.tag === '交流意图' ? ' msg-intent' : '') + '"><span class="msg-mood-tag">' + escTxt(tag) + '</span>' +
(label && label !== (rec.text || '') ? '<span>' + escTxt(label) + '</span>' : '') + '</div>';
});
}
gcPlaceMsg(m, beforeEl); // #246：收发追加/历史前插统一走放置器
return m;
}
let gcRenderStart = 0;
const GC_EARLIER_CHUNK = 150;
let gcRenderedFp = '__none__';
function gcMembersFp() {
try {
const ms = getMembers();
let s = '';
for (let i = 0; i < ms.length; i++) {
const av = String(memberAvatar(ms[i].id) || '');
s += ms[i].id + ':' + memberName(ms[i].id) + ':' + av.length + ':' + av.slice(-24) + ';';
}
const mav = String(myAvatar() || '');
return s + '|me:' + myName() + ':' + mav.length + ':' + mav.slice(-24) + '|sn:' + (gcBeautyGet('show-name') || '');
} catch (e) { return 'fp_err:' + Date.now(); } // 读不到指纹＝签名必不匹配＝保守重建
}
function gcEntrySig() {
const n = msgs.length;
const last = n ? msgs[n - 1] : null;
return curGid + '|' + n + '|' + (n ? msgs[0].ts : '') + '|' +
(last ? [last.ts, last.side || '', String(last.text || '').length, last.img !== undefined ? 'i' : '', last.voice !== undefined ? 'v' : ''].join(':') : '') +
'|' + gcMembersFp();
}
function renderAll() {
body.innerHTML = '';
const n = msgs.length;
gcRenderStart = Math.max(0, n - RENDER_MAX);
if (gcRenderStart > 0) body.appendChild(gcEarlierBtn());
for (let i = gcRenderStart; i < n; i++) renderMsg(msgs[i], i);
gcRenderedFp = gcEntrySig(); // #893：登记「屏上窗口指纹」，进群同窗跳过的比较基准
followGcBottom(true); // #371：进页滚底同走三连写（内核可能丢弃单次 scrollTop 写入）
}
function gcEarlierBtn() {
const d = document.createElement('div');
d.className = 'gc-earlier';
d.textContent = '查看更早的消息（还有 ' + gcRenderStart + ' 条）';
d.addEventListener('click', loadEarlier);
return d;
}
function gcSyncEarlierBtn() {
const btn = body.querySelector('.gc-earlier');
if (gcRenderStart <= 0) { if (btn) btn.remove(); return; }
if (btn) btn.textContent = '查看更早的消息（还有 ' + gcRenderStart + ' 条）';
else body.insertBefore(gcEarlierBtn(), body.firstElementChild);
}
function loadEarlier() {
if (gcRenderStart <= 0) return;
const newStart = Math.max(0, gcRenderStart - GC_EARLIER_CHUNK);
const anchor = body.querySelector('.gc-earlier') || body.firstElementChild;
const prevH = body.scrollHeight;
for (let i = newStart; i < gcRenderStart; i++) renderMsg(msgs[i], i, anchor);
gcRenderStart = newStart;
try { body.scrollTop += body.scrollHeight - prevH; } catch (e) {}
gcSyncEarlierBtn();
}
function scrollToBottom() { try { body.scrollTop = body.scrollHeight; } catch (e) {} }
function gcAtBottom() {
try { return body.scrollHeight - body.scrollTop - body.clientHeight <= 8; } catch (e) { return true; }
}
let gcUserGcScrollTouched = false;
let gcUnpinTsY = 0;
body.addEventListener('touchstart', (e) => {
try { gcUnpinTsY = e.touches[0].clientY; } catch (err) { gcUnpinTsY = 0; }
gcUserGcScrollTouched = true;
try { body.classList.add('scroll-anchor-auto'); } catch (err) {}
}, { passive: true });
body.addEventListener('touchend', (e) => {
try {
const dy = Math.abs(e.changedTouches[0].clientY - gcUnpinTsY);
if (dy < 10 && gcAtBottom()) { gcUserGcScrollTouched = false; try { body.classList.remove('scroll-anchor-auto'); } catch (err) {} } // FIX #396 轻点回跟=回钉态摘锚定；#416 轻点回跟只认真的贴到底（旧 150px 容差让上翻读最新时一点气泡就恢复跟底被拽回）
} catch (err) {}
}, { passive: true });
body.addEventListener('wheel', () => { gcUserGcScrollTouched = true; try { body.classList.add('scroll-anchor-auto'); } catch (err) {} }, { passive: true });
function followGcBottom(force) {
try {
if (!force && gcUserGcScrollTouched) return;
try { body.classList.remove('scroll-anchor-auto'); } catch (err) {} // FIX #396 回钉贴底关回锚定（#316 单聊同口径，防与 JS 显式滚动对打）
scrollToBottom();
const rewrite = () => {
try { if (!gcUserGcScrollTouched) scrollToBottom(); } catch (e) {}
};
if (window.requestAnimationFrame) requestAnimationFrame(rewrite);
setTimeout(rewrite, 150);
gcUserGcScrollTouched = false;
} catch (e) {}
}
let gcScrollTimer = null;
body.addEventListener('scroll', () => {
if (!gcUserGcScrollTouched) return;
if (gcScrollTimer) return;
gcScrollTimer = setTimeout(() => {
gcScrollTimer = null;
if (gcUserGcScrollTouched && gcAtBottom()) {
gcUserGcScrollTouched = false;
try { body.classList.remove('scroll-anchor-auto'); } catch (err) {} // FIX #396 滚回贴底=回钉态摘锚定
}
}, 120);
}, { passive: true });
const GC_DOM_WINDOW = 400, GC_DOM_CUT = 320;
function pruneGcDom() {
try {
if (body.children.length <= GC_DOM_WINDOW) return;
if (body.scrollHeight - body.scrollTop - body.clientHeight > 400) return; // 远离底部：在看历史
let excess = body.children.length - GC_DOM_CUT;
while (excess-- > 0) {
let el = body.firstElementChild;
if (!el) break;
if (el.classList && el.classList.contains('gc-earlier')) el = el.nextElementSibling; // 分页按钮不裁
if (!el) break;
el.remove();
}
} catch (e) {}
}
let gcDraftImgs = [];
let gcLastQuote = null;
function renderGcQuoteBar() {
const qEl = document.getElementById('gc-quote-bar');
if (!qEl) return;
qEl.innerHTML = '';
if (!gcLastQuote) { qEl.hidden = true; return; }
qEl.hidden = false;
const bar = document.createElement('div');
bar.className = 'chat-draft-quote-bar';
const thumb = (gcLastQuote.imgs && gcLastQuote.imgs.length) ? gcLastQuote.imgs[0] : null;
if (thumb) {
const img = document.createElement('img');
img.className = 'chat-draft-quote-img';
img.src = thumb;
img.alt = '';
bar.appendChild(img);
}
const t = document.createElement('span');
t.className = 'chat-draft-quote-text';
const raw = String(gcLastQuote.text || '');
t.textContent = (thumb && (window.chatIsInlineDataSrc ? window.chatIsInlineDataSrc(raw) : raw.indexOf('data:') === 0)) ? '' : (raw || '图片'); // FIX #948 内联载荷判据统一口径（变体形态不再把 base64 写进预览条）
bar.appendChild(t);
const xBtn = document.createElement('button');
xBtn.className = 'chat-draft-x chat-draft-quote-x';
xBtn.textContent = '✕';
xBtn.addEventListener('click', () => { gcLastQuote = null; renderGcDraft(); });
bar.appendChild(xBtn);
qEl.appendChild(bar);
}
function renderGcDraft() {
if (!gcDraftBar || !gcDraftItems) return;
renderGcQuoteBar();
gcDraftItems.innerHTML = '';
if (!gcDraftImgs.length && !gcLastQuote) { gcDraftBar.hidden = true; return; }
gcDraftImgs.forEach((src, i) => {
const it = document.createElement('div');
it.className = 'chat-draft-item';
const img = document.createElement('img');
img.src = src; img.alt = '';
const x = document.createElement('button');
x.className = 'chat-draft-x';
x.textContent = '✕';
x.addEventListener('click', () => { gcDraftImgs.splice(i, 1); renderGcDraft(); });
it.appendChild(img);
it.appendChild(x);
gcDraftItems.appendChild(it);
});
gcDraftBar.hidden = false;
}
function buildGcParts(t) {
const parts = [];
if (t) parts.push({ k: 'text', v: t });
gcDraftImgs.forEach(src => parts.push({ k: 'img', v: src, sub: 'image' }));
return parts;
}
function gcTakeQuoteValue() {
if (!gcLastQuote) return null;
const q = (gcLastQuote.imgs && gcLastQuote.imgs.length)
? { t: gcLastQuote.text, imgs: gcLastQuote.imgs }
: (gcLastQuote.text || null);
gcLastQuote = null;
return q;
}
function addMsg(text) {
const t = (text || '').trim();
const parts = buildGcParts(t);
if (!parts.length) return;
const rec = { side: 'out', text: t, ts: Date.now() };
if (gcDraftImgs.length) rec.parts = parts;
const qv = gcTakeQuoteValue();
if (qv) rec.quote = qv;
msgs.push(rec);
saveMsgs();
renderMsg(rec);
followGcBottom(true);
if (window.playSfxGc) window.playSfxGc('out'); // #698d：走群聊专属音效（未设置回退单聊）
if (input) { input.textContent = ''; try { input._gcLastTyped = ''; } catch (e2) {} } // #401 清空同步作废快照（程序化清空不派发 input 事件，防幻影重发）
gcDraftImgs = [];
renderGcDraft();
scheduleReply(t);
}
function gcSendDecisionText(text) {
const t = (text || '').trim();
if (!t) return;
const rec = { side: 'in', cid: 'system', name: '系统', text: t, ts: Date.now(), special: 'system' };
msgs.push(rec);
saveMsgs();
renderMsg(rec);
followGcBottom(true);
if (window.playSfxGc) window.playSfxGc('in'); // #698d：走群聊专属音效（未设置回退单聊）
}
function gcIsVisible() {
const p = document.getElementById('page-group-chat');
return !!(p && !p.hidden);
}
window.gcSendDecisionText = gcSendDecisionText;
window.gcIsVisible = gcIsVisible;
window.gcWriteGroupMsgs = function (gid, arr) {
try {
if (!Array.isArray(arr)) return false;
const g = gid || 'default';
const key = groupMsgKey(g);
try {
const snap = JSON.stringify(gcLiteSnapArray(arr));
if (snap.length <= GC_SNAP_LIMIT) localStorage.setItem(key, snap);
else localStorage.removeItem(key);
} catch (e) { try { localStorage.removeItem(key); } catch (e2) {} }
if (g === curGid) {
gFlushPersistNow();
msgs = arr.filter(m => m && typeof m === 'object');
saveNow();
renderAll();
return true;
}
if (window.idbSet) return window.idbSet(key, arr);
return true;
} catch (e) { return false; }
};
function sendGcSticker(src) {
if (!src) return;
const rec = { side: 'out', type: 'sticker', text: src, ts: Date.now() };
const qv = gcTakeQuoteValue();
if (qv) rec.quote = qv;
msgs.push(rec);
saveMsgs();
renderMsg(rec);
followGcBottom(true);
if (window.playSfxGc) window.playSfxGc('out'); // #698d：走群聊专属音效（未设置回退单聊）
scheduleReply('');
}
function sendGcText(t) {
if (!t) return;
const rec = { side: 'out', text: t, ts: Date.now() };
const qv = gcTakeQuoteValue();
if (qv) rec.quote = qv;
msgs.push(rec);
saveMsgs();
renderMsg(rec);
followGcBottom(true);
if (window.playSfxGc) window.playSfxGc('out'); // #698d：走群聊专属音效（未设置回退单聊）
scheduleReply('');
}
function gcInsertTextToInput(t) {
if (!input || typeof t !== 'string' || !t) return;
input.textContent = (input.textContent || '') + t;
try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
}
function gcCfg() {
const d = {
'gc-prob': 60, 'gc-rs-min': 1, 'gc-rs-max': 40,
'gc-reply-min': 1, 'gc-reply-max': 2,
'gc-cs-normal': 0, 'gc-cs-trigger-name': 1, 'gc-cs-trigger-bar': 0,
'gc-touch-prob': 5, 'gc-sticker-prob': 10, 'gc-emoji-prob': 5, 'gc-image-prob': 5, 'gc-voice-prob': 10,
'gc-kaomoji-prob': 5, 'gc-quote-prob': 30, 'gc-rc-prob': 25, 'gc-rc-refix': 35,
'gc-py-en': 1, 'gc-py-prob': 50, 'gc-py-min': 2, 'gc-py-max': 5
};
try {
const c = (window.groupChatCfg && window.groupChatCfg()) || {};
Object.keys(d).forEach(k => { if (c[k] === undefined) c[k] = d[k]; });
return c;
} catch (e) { return d; }
}
function hit(p) { return Math.random() * 100 < p; }
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
function pickN(arr, n) {
const copy = arr.slice();
const out = [];
while (copy.length && out.length < n) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
return out;
}
function gcHydrateWait(cid) {
try {
if (!window.hydrateLibForCid) return Promise.resolve();
return Promise.race([
new Promise(function (res) { window.hydrateLibForCid(cid, res); }),
new Promise(function (res) { setTimeout(res, 2500); })
]);
} catch (e) { return Promise.resolve(); }
}
function gcPool(cid) {
const text = [], kaomoji = [], emoji = [], sticker = [], image = [], voice = [];
try {
const mediaSticker = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'sticker')) || [];
const mediaImage = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'image')) || [];
const mediaVoice = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'voice')) || [];
sticker.push.apply(sticker, mediaSticker);
image.push.apply(image, mediaImage);
voice.push.apply(voice, mediaVoice);
const pokeSet = (function () {
const pk = (window.getPokeCardsFor && window.getPokeCardsFor(cid)) || [];
return pk.length ? new Set(pk) : null;
})();
const cards = (window.getCustomCardsFor && window.getCustomCardsFor(cid)) || [];
cards.forEach(c => {
if (typeof c !== 'string' || !c) return;
if (pokeSet && pokeSet.has(c)) return; // 拍一拍字卡只走拍一拍模式，不进普通回复池
if (window.chatHasMediaPayload ? window.chatHasMediaPayload(c)
: (c.indexOf('data:') === 0 || c.indexOf('|||') >= 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(c)))) return;
if (/^https?:\/\//i.test(c)) return; // 图链卡不进群聊文字池
if (/[\uD800-\uDBFF]/.test(c) || /^[😀-🙏🌀-🫿]/u.test(c)) emoji.push(c);
else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) kaomoji.push(c);
else text.push(c);
});
} catch (e) {}
try {
const a = (window.defaultCardApiFor && window.storeFor) ? window.defaultCardApiFor(window.storeFor(cid)) : null;
const dcfg = a ? a.cfg() : (window.defaultCardCfg && window.defaultCardCfg()) || {};
const useChat = a ? a.use('chat') : (window.defaultCardUse ? window.defaultCardUse('chat') : true);
const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
if (dcfg.enabled !== false && useChat) {
if (catOn('main') && text.length === 0) {
const defGrps = (window.getDefaultCardGroups && window.getDefaultCardGroups('main')) || [];
defGrps.forEach(g => {
(g[1] || []).forEach(card => {
if (isOff && isOff('main', card)) return;
if (typeof card !== 'string' || !card) return;
if (/[\uD800-\uDBFF]/.test(card)) emoji.push(card);
else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(card) && /[\)）】)]/.test(card)) kaomoji.push(card);
else text.push(card);
});
});
}
if (catOn('kaomoji') && !kaomoji.length) {
const kg = (window.getDefaultCardGroups && window.getDefaultCardGroups('kaomoji')) || [];
kg.forEach(g => (g[1] || []).forEach(card => { if (isOff && isOff('kaomoji', card)) return; if (typeof card === 'string' && card) kaomoji.push(card); }));
}
if (catOn('emoji') && !emoji.length) {
const eg = (window.getDefaultCardGroups && window.getDefaultCardGroups('emoji')) || [];
eg.forEach(g => (g[1] || []).forEach(card => { if (isOff && isOff('emoji', card)) return; if (typeof card === 'string' && card) emoji.push(card); }));
}
}
} catch (e) {}
return { text, kaomoji, emoji, sticker, image, voice };
}
function gcGenReply(cid, c) {
const pool = gcPool(cid);
let t, type = 'text';
if (c['gc-py-en'] === 1 && hit(c['gc-py-prob']) && pool.text.length) {
const n = randInt(c['gc-py-min'], c['gc-py-max']);
t = pickN(pool.text, n).join(' ');
} else {
if (pool.sticker.length && hit(c['gc-sticker-prob'])) {
t = pick(pool.sticker); type = 'sticker';
} else if (pool.emoji.length && hit(c['gc-emoji-prob'])) {
t = pick(pool.emoji);
} else if (pool.image.length && hit(c['gc-image-prob'])) {
t = pick(pool.image); type = 'image';
} else if (pool.voice.length && hit(c['gc-voice-prob'])) {
t = pick(pool.voice); type = 'voice';
} else {
t = pick(pool.text) || FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
}
}
if (type === 'text' && pool.kaomoji.length && hit(c['gc-kaomoji-prob'])) {
t += ' ' + pick(pool.kaomoji);
}
if (type === 'text') {
try {
const st = window.storeFor ? window.storeFor(cid) : null;
const defs = (st && window.getDefaultCardsFor) ? window.getDefaultCardsFor(st) : ((window.getDefaultCards && window.getDefaultCards()) || null);
if (defs && defs.type === 'text' && defs.text) t = defs.text;
} catch (e) {}
}
let parts = null;
if (type === 'text') {
if (hit(c['gc-sticker-prob'] || 0) && pool.sticker.length) {
parts = [{ k: 'text', v: t }, { k: 'img', v: pick(pool.sticker), sub: 'sticker' }];
} else if (hit(c['gc-image-prob'] || 0) && pool.image.length) {
parts = [{ k: 'text', v: t }, { k: 'img', v: pick(pool.image), sub: 'image' }];
}
}
return { text: t, type: type, parts: parts };
}
function gcPokeText(cid) {
const name = memberName(cid);
let action = '';
try {
const st = window.storeFor ? window.storeFor(cid) : null;
const d = (st && window.getDefaultCardsFor) ? window.getDefaultCardsFor(st) : ((window.getDefaultCards && window.getDefaultCards()) || null);
if (d && d.type === 'poke') action = d.text;
} catch (e) {}
if (!action) {
const poke = (window.getPokeCardsFor && window.getPokeCardsFor(cid)) || [];
action = poke.length ? pick(poke) : '拍了拍我';
}
let text;
if (action.indexOf('你') >= 0) {
if (action.charAt(0) === '你' || action.charAt(0) === '我') {
text = name + ' ' + action.slice(1).replace(/你(?![们])/g, myName());
} else {
text = name + ' ' + action.replace(/你(?![们])/g, myName());
}
} else if (action.charAt(0) === '我') {
text = name + ' ' + action.slice(1);
} else {
text = name + ' ' + action;
}
return text;
}
function showTyping(name) { if (typingEl) { typingEl.textContent = (name || '成员') + ' 正在输入…'; typingEl.hidden = false; } }
function hideTyping() { if (typingEl) typingEl.hidden = true; }
function gcGroupAlive(gid) { return groups.some(g => g.id === gid); }
function gcReadGroupKey(gid) {
let arr = [];
try { arr = JSON.parse(localStorage.getItem(groupMsgKey(gid)) || '[]'); } catch (e) {}
return Array.isArray(arr) ? arr : [];
}
function gcWriteGroupKey(gid, arr) {
const data = JSON.stringify(arr);
localStorage.setItem(groupMsgKey(gid), data);
try { if (window.idbSet) window.idbSet(groupMsgKey(gid), data); } catch (e) {}
}
function gcDeliverReply(gid, rec, sfx) {
if (!gcGroupAlive(gid)) return -1;
if (gid === curGid) {
msgs.push(rec);
saveMsgs();
renderMsg(rec, msgs.length - 1);
followGcBottom();
if (sfx && window.playSfxGc) window.playSfxGc(sfx);
return msgs.length - 1;
}
try {
const arr = gcReadGroupKey(gid);
arr.push(rec);
gcWriteGroupKey(gid, arr);
return arr.length - 1;
} catch (e) { return -1; }
}
function gcRetractFallbackHtml(rec) {
const ph = (t) => '<span style="opacity:.6;font-size:12px">' + t + '</span>';
let html = '';
if (rec.type === 'image') html = ph('[图片]');
else if (rec.type === 'sticker') html = ph('[表情包]');
else if (rec.type === 'voice') html = ph('[语音]');
else if (rec.parts && rec.parts.length) {
const imgs = rec.parts.filter(p => p.k === 'img').length;
const txt = rec.parts.filter(p => p.k === 'text').map(p => p.v).join(' ');
html = (imgs ? ph('[图片]') : '') +
(txt ? '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(txt) : escTxtBr(txt)) + '</span>' : '');
} else {
html = '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(rec.text || '') : escTxtBr(rec.text || '')) + '</span>';
}
return html + gcRetractMoodHtml(rec);
}
function gcRetractMoodHtml(rec) {
try {
const moods = (rec && Array.isArray(rec.mood)) ? rec.mood : [];
const live = moods.filter((md, mi) => md && String(md.tag || '').trim() && !(rec.retractedMood && rec.retractedMood.indexOf(mi) >= 0));
if (!live.length) return '';
return '<div class="msg-moods">' + live.map(md => {
const tag = md.tag || '情绪';
const label = md.label == null ? '' : String(md.label);
const dup = label !== '' && label === String(rec.text == null ? '' : rec.text);
return '<div class="msg-mood' + (md.tag === '交流意图' ? ' msg-intent' : '') + '"><span class="msg-mood-tag">' + escTxt(tag) + '</span>' +
(dup || label === '' ? '' : '<span>' + escTxt(label) + '</span>') + '</div>';
}).join('') + '</div>';
} catch (e) { return ''; }
}
function gcRetractMediaHtml(rec) {
if (rec.type === 'image' && rec.text) {
return '<img class="msg-img msg-img-big" src="' + attrEsc(rec.text) + '" alt="图片" loading="lazy" decoding="async">';
}
if (rec.type === 'sticker' && rec.text) {
return '<img class="msg-img msg-img-sm" src="' + attrEsc(rec.text) + '" alt="表情" loading="lazy" decoding="async">';
}
if (rec.parts && rec.parts.length) {
const imgs = rec.parts.filter(p => p && p.k === 'img');
if (!imgs.length) return '';
const txt = rec.parts.filter(p => p && p.k === 'text').map(p => p.v).join(' ');
return '<div class="msg-parts-imgs' + (imgs.length > 1 ? ' multi' : '') + '">' +
imgs.map(p => {
const isSticker = p.sub === 'sticker';
return '<img class="msg-img' + (isSticker ? ' msg-img-sm' : ' msg-img-big') + '" src="' + attrEsc(p.v) + '" alt="' + (isSticker ? '表情' : '图片') + '" loading="lazy" decoding="async">';
}).join('') + '</div>' +
(txt ? '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(txt) : escTxtBr(txt)) + '</span>' : '');
}
return '';
}
function retractGcMsg(idx, gid) {
if (gid !== undefined && gid !== curGid) {
try {
const arr = gcReadGroupKey(gid);
if (arr[idx] && !arr[idx].retracted) {
arr[idx].orig = gcRetractFallbackHtml(arr[idx]);
arr[idx].retracted = true;
gcWriteGroupKey(gid, arr);
}
} catch (e) {}
return;
}
if (idx < 0 || idx >= msgs.length) return;
const rec = msgs[idx];
if (!rec || rec.retracted) return;
const mediaish = rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice' ||
(!!(rec.parts && rec.parts.length) && rec.parts.some(p => p && p.k === 'img'));
const el = mediaish ? null : body.querySelector('.msg[data-gc-idx="' + idx + '"] .msg-bubble');
rec.orig = (el && el.innerHTML.length <= 20000) ? el.innerHTML : gcRetractFallbackHtml(rec);
rec.retracted = true;
saveMsgs();
const target = body.querySelector('.msg[data-gc-idx="' + idx + '"]');
if (target && target.parentNode) {
const m = renderMsg(rec, idx);
target.parentNode.replaceChild(m, target);
}
}
function memberReply(cid, quoteText, gid, continuation) {
if (gid === undefined) gid = curGid; // FIX 串群 #242：未传时兜底当前群
const c = gcCfg();
const immediate = continuation && c['gc-cs-normal'] !== 1;
const name = memberName(cid);
const rsMin = Math.max(1, Number(c['gc-rs-min']) || 1);
const rsMax = Math.max(rsMin, Number(c['gc-rs-max']) || rsMin);
const delay = immediate ? 0 : (rsMin + Math.random() * Math.max(1, rsMax - rsMin)) * 1000;
if (gid === curGid) showTyping(name);
setTimeout(() => {
if (gid === curGid) hideTyping();
if (hit(c['gc-touch-prob'])) {
const rec = { side: 'in', cid: cid, name: name, text: gcPokeText(cid), special: 'poke', ts: Date.now() };
gcDeliverReply(gid, rec, 'in'); // FIX 串群 #242：落回来源群
return;
}
const rpMin = Math.max(1, Number(c['gc-reply-min']) || 1);
const rpMax = Math.max(rpMin, Number(c['gc-reply-max']) || 2);
const count = (c['gc-py-en'] === 1) ? randInt(rpMin, rpMax) : 1;
const wantQuote = hit(c['gc-quote-prob']) && !!quoteText;
for (let i = 0; i < count; i++) {
setTimeout(() => {
if (gid === curGid) hideTyping();
(async () => {
try { await gcHydrateWait(cid); } catch (e) {}
const rep = gcGenReply(cid, c);
const q = (wantQuote && i === 0) ? quoteText : null;
const rec = { side: 'in', cid: cid, name: name, text: rep.text, type: rep.type, parts: rep.parts, ts: Date.now() };
if (q) rec.quote = q;
if (rep.type === 'text' || rep.type === 'sticker' || rep.type === 'image') {
try {
const chain = (window.triggerEmotionChain && window.triggerEmotionChain()) || null;
if (chain && chain.length) {
const typeName = { mood: '情绪', heart: '心意', intent: '交流意图' };
rec.mood = chain.map(it => ({ tag: typeName[it.type] || '情绪', label: it.content }));
}
if (window.addChatCount) window.addChatCount();
} catch (e) {}
}
const myIdx = gcDeliverReply(gid, rec, 'in'); // FIX 串群 #242：落回来源群
if (i < count - 1 && gid === curGid) showTyping(name);
if (hit(c['gc-rc-prob'])) {
setTimeout(() => {
retractGcMsg(myIdx, gid); // FIX 串群 #242：撤回落回来源群
if (hit(c['gc-rc-refix'])) {
if (gid === curGid) showTyping(name);
setTimeout(() => {
if (gid === curGid) hideTyping();
(async () => {
try { await gcHydrateWait(cid); } catch (e) {}
const rep2 = gcGenReply(cid, c);
const rec2 = { side: 'in', cid: cid, name: name, text: rep2.text, type: rep2.type, parts: rep2.parts, ts: Date.now() };
if (rep2.type === 'text' || rep2.type === 'sticker' || rep2.type === 'image') {
try {
const chain2 = (window.triggerEmotionChain && window.triggerEmotionChain()) || null;
if (chain2 && chain2.length) {
const typeName2 = { mood: '情绪', heart: '心意', intent: '交流意图' };
rec2.mood = chain2.map(it => ({ tag: typeName2[it.type] || '情绪', label: it.content }));
}
} catch (e) {}
}
gcDeliverReply(gid, rec2, 'in'); // FIX 串群 #242：补发落回来源群
})();
}, 700);
}
}, randInt(1000, 3000)); // #890：撤回延迟 1~3 秒随机（与单聊 retractDelayMs 同口径），不再固定 900ms 秒撤
}
})();
}, i * randInt(1200, 2800));
}
}, delay);
}
function scheduleReply(userText) {
const gid = curGid; // FIX 串群 #242：捕获调度时的群，回复/撤回一律落回发起群
const members = getMembers();
if (!members.length) return;
const c = gcCfg();
const mentioned = [];
members.forEach(m => {
const n = memberName(m.id);
if (userText.indexOf('@' + n) >= 0) mentioned.push(m.id);
});
let targets;
if (mentioned.length) {
targets = mentioned.slice();
} else {
targets = members.filter(() => hit(c['gc-prob'])).map(m => m.id);
}
if (!targets.length) return;
targets.forEach((cid, i) => {
setTimeout(() => memberReply(cid, userText, gid), i * (1200 + Math.random() * 1600));
});
}
function updateGroupName() {
const g = currentGroup();
const n = getMembers().length + 1;
const nm = (g && g.name) ? g.name : '群聊';
if (nameEl) nameEl.textContent = nm + '(' + n + ')';
}
function enterGroupChat() {
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) return;
loadGroups(); // 进群前先取回群聊分组（可能在其他会话新建/删除过）
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #338 同值写也发 mutation（Blink 实测同值 3 连写=3 条记录），44 页全扫=唤醒全部页面观察器
if (page) page.hidden = false;
updateGroupName();
loadMsgs();
if (!gcSwitchDirty && body.children.length && gcEntrySig() === gcRenderedFp) {
followGcBottom(true); // #371 同窗跳过：回底同走三连写
} else {
renderAll();
}
gcSwitchDirty = false; // FIX #249：进群即全量重建（loadMsgs+renderAll），切桌挂起的脏标记就地清账
hideTyping(); // FIX 串群 #242 家族：打字指示器全局共享，进群清掉其他群残留
syncGcInputBtns(); // 进入群聊时按当前桌面设置刷新语音/继续说/批量按钮显隐
}
if (backBtn) backBtn.addEventListener('click', () => {
saveNow();
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #338 同值写也发 mutation（Blink 实测同值 3 连写=3 条记录），44 页全扫=唤醒全部页面观察器
const home = document.getElementById('page-phone'); if (home) home.hidden = false;
});
const gcApp = document.querySelector('.app[data-app="group-chat"]');
if (gcApp) gcApp.addEventListener('click', enterGroupChat);
let gcLastUserEditAt = 0;
function gcReadSendText() {
try {
const t = (input.innerText || '').trim() || (input.textContent || '').trim();
if (t) return t;
} catch (e) {}
try {
const snap = (input._gcLastTyped || '').trim();
if (snap && Date.now() - gcLastUserEditAt < 15000) return snap;
} catch (e) {}
return '';
}
if (input) {
try {
input.addEventListener('keydown', () => { gcLastUserEditAt = Date.now(); }, true);
input.addEventListener('compositionstart', () => { gcLastUserEditAt = Date.now(); }, true);
input.addEventListener('beforeinput', (e) => { if (!e || typeof e.inputType !== 'string' || e.inputType.indexOf('insert') === 0) gcLastUserEditAt = Date.now(); }, true);
input.addEventListener('input', function () { try { input._gcLastTyped = input.innerText || ''; } catch (e) {} }, true);
} catch (e) {}
}
if (sendBtn) {
sendBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
sendBtn.addEventListener('click', () => { addMsg(gcReadSendText()); try { input.focus(); } catch (e) {} });
}
if (input) input.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
try { if (window.activeStore().get('cs-enter-send') === 'off') return; } catch (err) {}
e.preventDefault();
addMsg(gcReadSendText());
}
});
function fillMembersList(el) {
const isCustom = curGid !== 'default';
const meRow = document.createElement('div');
meRow.className = 'gc-mp-item';
const meDesk = deskMeName();
meRow.innerHTML = '<div class="gc-mp-av"></div><span class="gc-mp-name">' + escapeHtml(myName()) +
'<span class="gc-mp-sub">' + (meDesk ? '桌面昵称：' + escapeHtml(meDesk) : '') + '</span></span><span class="gc-mp-tag">我</span>';
fillAv(meRow.querySelector('.gc-mp-av'), myAvatar());
el.appendChild(meRow);
getMembers().forEach(m => {
const row = document.createElement('div');
row.className = 'gc-mp-item';
const desk = deskPartnerName(m.id);
row.innerHTML = '<div class="gc-mp-av"></div><span class="gc-mp-name">' + escapeHtml(memberName(m.id)) +
'<span class="gc-mp-sub">' + (desk ? '桌面昵称：' + escapeHtml(desk) : '') + '</span></span>' +
(isCustom ? '<button class="gc-set-btn ghost gc-mp-rm">移除</button>' : '');
fillAv(row.querySelector('.gc-mp-av'), memberAvatar(m.id));
const rmBtn = row.querySelector('.gc-mp-rm');
if (rmBtn) rmBtn.addEventListener('click', (e) => {
e.stopPropagation();
removeMemberFromGroup(m.id);
});
el.appendChild(row);
});
if (isCustom) {
const addRow = document.createElement('div');
addRow.className = 'gc-mp-add';
addRow.innerHTML = '<button class="gc-set-btn">＋ 添加成员</button>';
addRow.querySelector('button').addEventListener('click', () => { openMemberPicker('add'); });
el.appendChild(addRow);
}
}
function renderMembersPanel() {
if (membersBody) { membersBody.innerHTML = ''; fillMembersList(membersBody); }
const emb = document.querySelector('#gc-set-body .gc-set-members-list');
if (emb) { emb.innerHTML = ''; fillMembersList(emb); }
}
function removeMemberFromGroup(cid) {
const g = currentGroup();
if (!g || !g.members) return;
const name = memberName(cid);
if (!window.openModal) { removeFromGroupNow(cid); return; }
window.openModal('移除成员「' + name + '」？', '', () => { removeFromGroupNow(cid); },
{ noInput: true, staticText: '该成员将不再参与本群聊的回复与 @ 提及（其桌面数据不受影响）' });
}
function removeFromGroupNow(cid) {
const g = currentGroup();
if (!g || !g.members) return;
const i = g.members.indexOf(cid);
if (i < 0) return;
g.members.splice(i, 1);
saveGroups();
renderMembersPanel();
refreshGroupViews();
toast('已移除成员');
}
if (nameEl) nameEl.addEventListener('click', () => {
if (gcCfg()['gc-cs-trigger-name'] === 1) gcCsFireContinue();
});
const interPanel = document.getElementById('gc-inter-panel');
const interBody = document.getElementById('gc-inter-body');
const interTitle = document.getElementById('gc-inter-title');
const interClose = document.getElementById('gc-inter-close');
let interMode = 'av';   // 'av' 头像池 | 'nick' 昵称池
let interTarget = 'me'; // 'me' | <cid>
const INTER_KEYS = { av: 'gc-avpool', nick: 'gc-nickpool' };
function interPoolLoad() {
try {
const v = JSON.parse(gcProfileStore().get(INTER_KEYS[interMode]) || '{}');
return (v && typeof v === 'object') ? v : {};
} catch (e) { return {}; }
}
function interPoolSave(map) {
try { gcProfileStore().set(INTER_KEYS[interMode], JSON.stringify(map)); } catch (e) {}
}
function interTargets() { return ['me'].concat(getMembers().map(m => m.id)); }
function interCurVal(key) {
const p = gcProfileGet(key);
return interMode === 'av' ? (p.avatar || '') : (p.name || '');
}
function gcInterSys(text) {
try {
const rec = { side: 'in', cid: 'system', name: '系统', text: text, ts: Date.now(), special: 'system' };
msgs.push(rec); saveMsgs(); renderMsg(rec); followGcBottom(true);
} catch (e) {}
}
function interApply(data) {
if (!data) return;
if (interMode === 'av') gcProfileSet(interTarget, undefined, data);
else gcProfileSet(interTarget, data, undefined);
const who = interTarget === 'me' ? myName() : memberName(interTarget);
gcInterSys(who + (interMode === 'av' ? ' 更换了头像' : ' 更换了昵称'));
renderInterPanel();
}
function renderInterPanel() {
if (!interBody) return;
if (interTitle) interTitle.textContent = interMode === 'av' ? '头像互动' : '昵称互动';
interBody.innerHTML = '';
const pills = document.createElement('div');
pills.className = 'gc-inter-pills';
interTargets().forEach(key => {
const b = document.createElement('button');
b.className = 'gc-inter-pill' + (key === interTarget ? ' on' : '');
b.textContent = key === 'me' ? myName() : memberName(key);
b.addEventListener('click', () => { interTarget = key; renderInterPanel(); });
pills.appendChild(b);
});
interBody.appendChild(pills);
const hint = document.createElement('div');
hint.className = 'gc-inter-hint';
hint.textContent = interMode === 'av'
? '点一张头像＝立即换成 TA 的群聊头像；先选上方目标再点。'
: '点一个昵称＝立即换成 TA 的群聊昵称；先选上方目标再点。';
interBody.appendChild(hint);
const map = interPoolLoad();
const list = Array.isArray(map[interTarget]) ? map[interTarget] : [];
const curVal = interCurVal(interTarget);
const grid = document.createElement('div');
grid.className = interMode === 'av' ? 'gc-inter-grid' : 'gc-inter-grid nick';
list.forEach((data, i) => {
const cell = document.createElement('div');
cell.className = 'gc-inter-cell' + (data === curVal ? ' cur' : '');
if (interMode === 'av') {
const av = document.createElement('div');
av.className = 'gc-inter-av';
fillAv(av, data);
cell.appendChild(av);
} else {
const nm = document.createElement('span');
nm.className = 'gc-inter-nick';
nm.textContent = data;
cell.appendChild(nm);
}
const del = document.createElement('button');
del.className = 'gc-inter-del';
del.textContent = '✕';
del.title = '从池子里删除';
del.addEventListener('click', (e) => {
e.stopPropagation();
list.splice(i, 1);
if (!list.length) delete map[interTarget]; else map[interTarget] = list;
interPoolSave(map);
renderInterPanel();
});
cell.appendChild(del);
cell.addEventListener('click', () => interApply(data));
grid.appendChild(cell);
});
if (!list.length) {
const empty = document.createElement('div');
empty.className = 'gc-inter-hint';
empty.textContent = interMode === 'av' ? '池子还是空的，先「上传头像」加几张。' : '池子还是空的，先「添加昵称」加几个。';
grid.appendChild(empty);
}
interBody.appendChild(grid);
const ops = document.createElement('div');
ops.className = 'gc-inter-ops';
const addBtn = document.createElement('button');
addBtn.className = 'gc-set-btn';
addBtn.textContent = interMode === 'av' ? '上传头像' : '添加昵称';
if (interMode === 'av' && window.mochiFilePickLabel) window.mochiFilePickLabel(addBtn, gcAvatarPickInput);
addBtn.addEventListener('click', (e) => {
if (interMode === 'av') {
var _fb = () => { window.mochiFilePickFire(gcAvatarPickInput, { onFail: () => toast('无法打开相册，请重试') }); };
if (window.mochiFilePickGuard) window.mochiFilePickGuard(gcAvatarPickInput, _fb);
else _fb();
pickAvatarFile((data) => {
if (!data) return;
const m2 = interPoolLoad();
const l2 = Array.isArray(m2[interTarget]) ? m2[interTarget] : [];
if (l2.indexOf(data) >= 0) { toast('这张头像已在池子里'); return; }
l2.push(data);
m2[interTarget] = l2;
interPoolSave(m2);
renderInterPanel();
toast('已加入头像池');
});
} else {
if (!window.openModal) return;
window.openModal('添加昵称', '', (v) => {
const t = (v == null ? '' : String(v)).replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u180E]/g, '').trim().slice(0, 30);
if (!t) { toast('昵称不能为空'); return; }
const m2 = interPoolLoad();
const l2 = Array.isArray(m2[interTarget]) ? m2[interTarget] : [];
if (l2.indexOf(t) >= 0) { toast('这个昵称已在池子里'); return; }
l2.push(t);
m2[interTarget] = l2;
interPoolSave(m2);
renderInterPanel();
}, { maxlength: 30 });
}
});
const randBtn = document.createElement('button');
randBtn.className = 'gc-set-btn';
randBtn.textContent = '随机换一个';
randBtn.addEventListener('click', () => {
const l2 = (Array.isArray(map[interTarget]) ? map[interTarget] : []).filter(x => x !== curVal);
if (!l2.length) { toast('池子里没有别的可换了'); return; }
interApply(l2[Math.floor(Math.random() * l2.length)]);
});
ops.appendChild(addBtn);
ops.appendChild(randBtn);
interBody.appendChild(ops);
}
function openInterPanel(mode) {
interMode = mode || interMode;
if (interTargets().indexOf(interTarget) < 0) interTarget = 'me';
renderInterPanel();
if (interPanel) interPanel.hidden = false;
}
if (interClose) interClose.addEventListener('click', () => { if (interPanel) interPanel.hidden = true; });
if (membersClose) membersClose.addEventListener('click', () => { if (membersPanel) membersPanel.hidden = true; });
function fillGroupsList(el) {
groups.forEach(g => {
const row = document.createElement('div');
row.className = 'gc-mp-item gc-gp-item' + (g.id === curGid ? ' cur' : '');
const n = groupMemberList(g).length;
row.innerHTML =
'<div class="gc-mp-av gc-gp-ico">' +
(g.id === 'default'
? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>'
: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3z"/></svg>') +
'</div>' +
'<span class="gc-mp-name">' + escapeHtml(g.name) +
'<span class="gc-mp-sub">成员 ' + (n + 1) + ' 人' + (g.id === 'default' ? ' · 全部联系人' : '') + '</span></span>' +
(g.id === curGid ? '<span class="gc-mp-tag gc-gp-cur">当前</span>' : '') +
(g.id !== 'default' ? '<button class="gc-set-btn ghost gc-gp-del">删除</button>' : '');
const delBtn = row.querySelector('.gc-gp-del');
if (delBtn) delBtn.addEventListener('click', (e) => {
e.stopPropagation();
deleteGroup(g.id);
});
row.addEventListener('click', () => {
switchGroup(g.id);
if (groupsPanel) groupsPanel.hidden = true;
});
el.appendChild(row);
});
const newRow = document.createElement('div');
newRow.className = 'gc-mp-item gc-gp-new';
newRow.innerHTML = '<div class="gc-mp-av gc-gp-ico add">' +
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
'</div><span class="gc-mp-name">新建群聊</span>';
newRow.addEventListener('click', startCreateGroup);
el.appendChild(newRow);
}
function renderGroupsPanel() {
if (gpBody) { gpBody.innerHTML = ''; fillGroupsList(gpBody); }
const emb = document.querySelector('#gc-set-body .gc-set-groups-list');
if (emb) { emb.innerHTML = ''; fillGroupsList(emb); }
}
function switchGroup(gid) {
if (!groups.some(g => g.id === gid)) return;
if (gid === curGid) { try { if (groupsPanel) groupsPanel.hidden = true; } catch (e) {} return; }
saveNow();
curGid = gid;
saveCurGid();
msgs = [];
loadMsgs();
hideTyping(); // FIX 串群 #242 家族：切群清掉上一群打字指示残留
refreshGroupViews();
try { renderGroupsPanel(); } catch (e) {}
}
function deleteGroup(gid) {
if (gid === 'default') return;
const g = groups.find(x => x.id === gid);
if (!g) return;
if (!window.openModal) { deleteGroupNow(gid); return; }
window.openModal('删除群聊「' + g.name + '」？', '', () => { deleteGroupNow(gid); },
{ noInput: true, staticText: '群聊与其中全部消息将被删除，不可恢复' });
}
function deleteGroupNow(gid) {
if (gid === 'default') return;
groups = groups.filter(x => x.id !== gid);
saveGroups();
try { window.xyStore(G).remove('gc-msgs-' + gid); } catch (e) {} // 内存+LS+IDB 三处清
if (curGid === gid) {
curGid = 'default';
saveCurGid();
msgs = [];
loadMsgs();
}
refreshGroupViews();
renderGroupsPanel();
toast('群聊已删除');
}
function startCreateGroup() {
if (!window.openModal) return;
window.openModal('群聊名称', '', (v) => {
const name = String(v || '').trim() || ('群聊 ' + groups.length);
openMemberPicker('create', name);
}, { placeholder: '群聊名称（可留空）', maxlength: 20 });
}
let gpickMode = 'create';   // 'create' 新建群聊（列全部联系人）| 'add' 添加成员（列未在群内的联系人）
let gpickGroupName = '';
function openMemberPicker(mode, groupName) {
gpickMode = mode;
gpickGroupName = groupName || '';
renderMemberPicker();
if (gpickPanel) gpickPanel.hidden = false;
}
function renderMemberPicker() {
if (!gpickBody) return;
if (gpickTitle) gpickTitle.textContent = gpickMode === 'create' ? '新建群聊' : '添加成员';
let all = [];
try { all = window.getContacts() || []; } catch (e) {}
let opts = all;
if (gpickMode === 'add') {
const g = currentGroup();
const inGroup = {};
if (g && g.members) g.members.forEach(id => { inGroup[id] = 1; });
opts = all.filter(c => !inGroup[c.id]);
}
gpickBody.innerHTML = '';
if (!opts.length) {
const empty = document.createElement('div');
empty.className = 'gc-gpick-empty';
empty.textContent = gpickMode === 'create' ? '还没有可选的桌面联系人' : '所有联系人都已在本群';
gpickBody.appendChild(empty);
}
opts.forEach(c => {
const row = document.createElement('label');
row.className = 'gc-mp-item gc-gpick-item';
row.dataset.cid = c.id;
const cb = document.createElement('input');
cb.type = 'checkbox';
const av = document.createElement('div');
av.className = 'gc-mp-av';
fillAv(av, memberAvatar(c.id));
const name = document.createElement('span');
name.className = 'gc-mp-name';
name.innerHTML = escapeHtml(memberName(c.id)) +
'<span class="gc-mp-sub">' + escapeHtml(c.name || '') + '</span>';
row.appendChild(cb); row.appendChild(av); row.appendChild(name);
gpickBody.appendChild(row);
});
}
function gpickConfirm() {
const checked = [];
gpickBody.querySelectorAll('.gc-gpick-item input[type="checkbox"]:checked').forEach(cb => {
const row = cb.closest('.gc-gpick-item');
if (row && row.dataset.cid) checked.push(row.dataset.cid);
});
if (!checked.length) { toast(gpickMode === 'create' ? '请至少选择一名成员' : '请勾选要添加的成员'); return; }
if (gpickMode === 'create') {
const g = {
id: 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
name: gpickGroupName || ('群聊 ' + groups.length),
members: checked,
ts: Date.now()
};
groups.push(g);
saveGroups();
if (gpickPanel) gpickPanel.hidden = true;
switchGroup(g.id);
toast('群聊已创建');
} else {
const g = currentGroup();
if (!g || !g.members) return;
checked.forEach(id => { if (g.members.indexOf(id) < 0) g.members.push(id); });
saveGroups();
if (gpickPanel) gpickPanel.hidden = true;
renderMembersPanel();
refreshGroupViews();
toast('已添加 ' + checked.length + ' 名成员');
}
}
if (gpickCancel) gpickCancel.addEventListener('click', () => { if (gpickPanel) gpickPanel.hidden = true; });
if (gpickClose) gpickClose.addEventListener('click', () => { if (gpickPanel) gpickPanel.hidden = true; });
if (gpickOkBtn) gpickOkBtn.addEventListener('click', gpickConfirm);
if (gpClose) gpClose.addEventListener('click', () => { if (groupsPanel) groupsPanel.hidden = true; });
if (groupsPanel) groupsPanel.addEventListener('click', (e) => { if (e.target === groupsPanel) groupsPanel.hidden = true; });
if (gpickPanel) gpickPanel.addEventListener('click', (e) => { if (e.target === gpickPanel) gpickPanel.hidden = true; });
const moreBtn = document.getElementById('gc-more-btn');
const moreMenu = document.getElementById('gc-more-menu');
function showMoreMenu(v) { if (moreMenu) moreMenu.hidden = !v; }
if (moreBtn) moreBtn.addEventListener('click', (e) => {
e.stopPropagation();
showMoreMenu(moreMenu.hidden);
});
document.addEventListener('click', () => showMoreMenu(false));
const moreSettings = document.getElementById('gc-more-settings');
if (moreSettings) moreSettings.addEventListener('click', () => {
showMoreMenu(false);
renderSettingsPanel();
if (settingsPanel) settingsPanel.hidden = false;
});
const moreMembers = document.getElementById('gc-more-members');
const moreGroups = document.getElementById('gc-more-groups');
if (moreMembers) moreMembers.remove();
if (moreGroups) moreGroups.remove();
const settingsPanel = document.getElementById('gc-settings-panel');
const settingsBody = document.getElementById('gc-set-body');
const settingsClose = document.getElementById('gc-set-close');
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
function compressHead(dataUrl, maxSide) {
return new Promise((resolve) => {
try {
if (typeof dataUrl !== 'string' || !dataUrl || dataUrl.length > 8 * 1024 * 1024) { resolve(null); return; }
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
resolve(c.toDataURL('image/jpeg', 0.85));
} catch (e) { resolve(null); }
};
img.onerror = () => resolve(null);
img.src = dataUrl;
} catch (e) { resolve(null); }
});
}
let gcAvatarPickCb = null;
const gcAvatarPickInput = document.createElement('input');
gcAvatarPickInput.type = 'file'; gcAvatarPickInput.accept = 'image/*';
gcAvatarPickInput.id = 'gc-avatar-pick';
gcAvatarPickInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
document.body.appendChild(gcAvatarPickInput);
gcAvatarPickInput.onchange = () => {
const f = gcAvatarPickInput.files && gcAvatarPickInput.files[0];
gcAvatarPickInput.value = ''; // 允许重选同一文件
if (!f) return;
const cb = gcAvatarPickCb; gcAvatarPickCb = null;
const reader = new FileReader();
reader.onload = () => {
compressHead(reader.result, 256).then(data => {
if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
if (cb) cb(data);
});
};
reader.readAsDataURL(f);
};
function pickAvatarFile(cb) {
gcAvatarPickCb = cb;
window.mochiFilePickFire(gcAvatarPickInput, { onFail: () => { gcAvatarPickCb = null; toast('无法打开相册，请重试'); } });
}
let gcSetTab = 'profile';
function setPanelTitle(t) {
try {
const h = settingsPanel && settingsPanel.querySelector('.gc-set-head span');
if (h) h.textContent = t || '群聊设置';
} catch (e) {}
}
function renderSettingsPanel() {
if (!settingsBody) return;
settingsBody.innerHTML = '';
const gName = String((currentGroup() && currentGroup().name) || '').trim();
setPanelTitle(curGid !== 'default' && gName ? '群聊设置 · ' + gName : '群聊设置');
renderMainSettingsView();
}
function renderMainSettingsView() {
const esc = escapeHtml;
const tabsRow = document.createElement('div');
tabsRow.className = 'them-tabs gc-set-tabs';
const GTABS = [['profile', '形象'], ['members', '成员'], ['group', '群聊'], ['reply', '回复'], ['beauty', '美化'], ['general', '通用'], ['data', '数据']];
if (!GTABS.some(t => t[0] === gcSetTab)) gcSetTab = 'profile';
tabsRow.innerHTML = GTABS.map(t =>
'<div class="them-tab' + (t[0] === gcSetTab ? ' active' : '') + '" data-gt="' + t[0] + '">' + t[1] + '</div>').join('');
settingsBody.appendChild(tabsRow);
const secs = {};
GTABS.forEach(t => {
const s = document.createElement('div');
s.className = 'gc-set-sec';
s.dataset.gt = t[0];
if (t[0] !== gcSetTab) s.hidden = true;
settingsBody.appendChild(s);
secs[t[0]] = s;
});
tabsRow.addEventListener('click', (e) => {
const tab = e.target.closest('.them-tab');
if (!tab) return;
gcSetTab = tab.dataset.gt;
tabsRow.querySelectorAll('.them-tab').forEach(x => x.classList.toggle('active', x === tab));
GTABS.forEach(t => { secs[t[0]].hidden = (t[0] !== tab.dataset.gt); });
if (gcSetTab === 'beauty' && !secs.beauty.innerHTML) renderBeautyView(secs.beauty);
});
let curSec = null;
const sec = (name) => { curSec = secs[name]; };
sec('profile');
const gcStepperRow = (label, k, min, max, step) => {
const gcfg = (window.groupChatCfg ? window.groupChatCfg() : {}) || {};
const row = document.createElement('div');
row.className = 'gc-set-stepper';
row.innerHTML =
'<span class="txt">' + escapeHtml(label) + '</span>' +
'<div class="stepper" data-k="' + k + '" data-min="' + min + '" data-max="' + (Number.isFinite(max) ? max : '') + '" data-step="' + step + '">' +
'<button class="stp-min">−</button>' +
'<input class="stp-val" inputmode="decimal" value="' + (gcfg[k] !== undefined ? gcfg[k] : (min || 0)) + '">' +
'<button class="stp-max">+</button>' +
'</div>';
const st = row.querySelector('.stepper');
const val = st.querySelector('.stp-val');
const mn = Number.isFinite(min) ? min : 0;
const mx = Number.isFinite(max) ? max : Infinity;
const sp = Number(step) || 1;
const fmt = (v) => sp < 1 ? Number(v).toFixed(2) : String(Math.round(Number(v)));
const save = (v) => { try { if (window.saveReplyCfg) window.saveReplyCfg(k, v); } catch (e) {} };
const bump = (dir) => {
let v = parseFloat(val.value); if (!isFinite(v)) v = mn;
v = dir > 0 ? Math.min(mx, v + sp) : Math.max(mn, v - sp);
val.value = fmt(v); save(val.value);
};
st.querySelector('.stp-min').addEventListener('click', () => bump(-1));
st.querySelector('.stp-max').addEventListener('click', () => bump(1));
val.addEventListener('change', () => {
let v = parseFloat(val.value); if (!isFinite(v)) v = mn;
v = Math.max(mn, Math.min(mx, v));
v = Math.round(v / sp) * sp; // 就近归整到步长（prob=5 时 42→40，与回复设置页 stepper 一致）
val.value = fmt(v); save(val.value);
});
val.addEventListener('blur', () => {
const v = parseFloat(val.value); if (!isFinite(v)) { val.value = fmt(mn); save(val.value); }
});
return row;
};
const item = (key, curName, curAv, deskName) => {
const row = document.createElement('div');
row.className = 'gc-set-item';
const hasOverride = !!(curName || curAv);
row.innerHTML =
'<div class="gc-set-av"></div>' +
'<div class="gc-set-info">' +
'<div class="gc-set-name">' + esc(curName || '跟随桌面') + (key === 'me' ? '<span class="gc-set-tag">我</span>' : '') + '</div>' +
'<div class="gc-set-desk">' + (deskName ? '桌面昵称：' + esc(deskName) : '') + '</div>' +
'</div>' +
'<div class="gc-set-ops">' +
'<button class="gc-set-btn" data-op="av">' + (curAv ? '换头像' : '设头像') + '</button>' +
'<button class="gc-set-btn" data-op="name">' + (curName ? '改昵称' : '设昵称') + '</button>' +
(hasOverride ? '<button class="gc-set-btn ghost" data-op="reset">重置</button>' : '') +
'</div>';
let effAv = curAv;
if (!effAv) { try { effAv = key === 'me' ? myAvatar() : memberAvatar(key); } catch (e) {} }
fillAv(row.querySelector('.gc-set-av'), effAv || '');
row.querySelector('[data-op="av"]').addEventListener('click', () => {
pickAvatarFile(data => gcProfileSet(key, undefined, data));
});
row.querySelector('[data-op="name"]').addEventListener('click', () => {
if (!window.openModal) return;
window.openModal(key === 'me' ? '我的群聊昵称' : '成员群聊昵称', curName, (v) => {
gcProfileSet(key, (v || '').trim(), undefined);
}, { maxlength: 30 });
});
if (hasOverride) {
row.querySelector('[data-op="reset"]').addEventListener('click', () => {
gcProfileSet(key, '', '');
});
}
return row;
};
const t1 = document.createElement('div');
t1.className = 'gc-set-title';
t1.textContent = '我的群聊';
(curSec||settingsBody).appendChild(t1);
const meP = gcProfileGet('me');
(curSec||settingsBody).appendChild(item('me', meP.name || '', meP.avatar || '', deskMeName()));
const t2 = document.createElement('div');
t2.className = 'gc-set-title';
t2.textContent = '成员群聊形象';
(curSec||settingsBody).appendChild(t2);
getMembers().forEach(m => {
const p = gcProfileGet(m.id);
(curSec||settingsBody).appendChild(item(m.id, p.name || '', p.avatar || '', deskPartnerName(m.id)));
});
const interRow = document.createElement('div');
interRow.className = 'gc-set-ops';
interRow.innerHTML = '<button class="gc-set-btn" data-inter="av">头像互动</button>' +
'<button class="gc-set-btn" data-inter="nick">昵称互动</button>';
interRow.querySelector('[data-inter="av"]').addEventListener('click', () => openInterPanel('av'));
interRow.querySelector('[data-inter="nick"]').addEventListener('click', () => openInterPanel('nick'));
(curSec||settingsBody).appendChild(interRow);
const nmRow = beautyRow('成员昵称显示', gcBeautyGet('show-name') === 'on' ? '头像上方显示' : '不显示', () => {
pickGcPills('show-name', '成员昵称显示', [
{ label: '头像上方显示', value: 'on' }, { label: '不显示', value: 'off' }
], 'off');
});
(curSec||settingsBody).appendChild(nmRow);
sec('members');
const tM = document.createElement('div');
tM.className = 'gc-set-title';
tM.textContent = '群成员';
(curSec||settingsBody).appendChild(tM);
const memList = document.createElement('div');
memList.className = 'gc-set-members-list';
(curSec||settingsBody).appendChild(memList);
fillMembersList(memList);
if (curGid === 'default') {
const mNote = document.createElement('div');
mNote.className = 'gc-set-note';
mNote.textContent = '默认群聊的成员跟随全部联系人，不能单独增删；要自选成员请用「群聊」tag 新建群聊。';
(curSec||settingsBody).appendChild(mNote);
}
sec('group');
const tG = document.createElement('div');
tG.className = 'gc-set-title';
tG.textContent = '切换 / 新建群聊';
(curSec||settingsBody).appendChild(tG);
const gpList = document.createElement('div');
gpList.className = 'gc-set-groups-list';
(curSec||settingsBody).appendChild(gpList);
fillGroupsList(gpList);
sec('reply');
const tR = document.createElement('div');
tR.className = 'gc-set-title';
tR.textContent = '群聊回复';
(curSec||settingsBody).appendChild(tR);
(curSec||settingsBody).appendChild(gcStepperRow('每个联系人回复概率 %', 'gc-prob', 0, 100, 5));
(curSec||settingsBody).appendChild(gcStepperRow('回复速度最短（秒）', 'gc-rs-min', 1, 60, 1));
(curSec||settingsBody).appendChild(gcStepperRow('回复速度最长（秒）', 'gc-rs-max', 2, Infinity, 1));
const rNote = document.createElement('div');
rNote.className = 'gc-set-note';
rNote.textContent = '这里与「设置 → 回复设置 → 群聊被动回复」是同一份设置：对所有群聊成员统一生效（全局、不随桌面隔离），两边修改即时同步。';
(curSec||settingsBody).appendChild(rNote);
const rTitle = (t) => {
const el = document.createElement('div');
el.className = 'gc-set-title';
el.textContent = t;
(curSec||settingsBody).appendChild(el);
};
const rStep = (label, k, min, max, step) => { (curSec||settingsBody).appendChild(gcStepperRow(label, k, min, max, step)); };
rTitle('回复条数');
rStep('回复条数最少', 'gc-reply-min', 1, 10, 1);
rStep('回复条数最多', 'gc-reply-max', 1, 20, 1);
const cntNote = document.createElement('div');
cntNote.className = 'gc-set-note';
cntNote.textContent = '这两项＝你每发 1 条消息，群里每个回你的成员就各回你几条（在最少~最多之间随机，默认 1~2 条）。注意：这是「每条消息、每个成员」的条数，不是 TA 一天最多发几条，不建议调大——成员是各算各的（调到 5、3 个人同时回你＝一屏 15 条），你连着发的每句话还各触发一批。嫌刷屏就把这两项都调成 1；关掉下方「多字卡回复」总开关也能锁死一条（关闭后设几条都只回 1 条）。撤回后的补发不占本上限，所以实际收到的可能比这里设的条数多。';
(curSec||settingsBody).appendChild(cntNote);
rTitle('内容概率');
rStep('拍一拍概率', 'gc-touch-prob', 0, 100, 5);
rStep('表情包概率', 'gc-sticker-prob', 0, 100, 5);
rStep('emoji 概率', 'gc-emoji-prob', 0, 100, 5);
rStep('图片概率', 'gc-image-prob', 0, 100, 5);
rStep('语音概率', 'gc-voice-prob', 0, 100, 5);
rStep('颜文字附加概率', 'gc-kaomoji-prob', 0, 100, 5);
rStep('引用概率', 'gc-quote-prob', 0, 100, 5);
rStep('撤回概率', 'gc-rc-prob', 0, 100, 5);
rStep('撤回补发概率', 'gc-rc-refix', 0, 100, 5);
const gcReplyToggleRow = (label, sub, key) => {
const row = document.createElement('div');
row.className = 'gc-set-item gc-set-toggle';
row.innerHTML =
'<div class="gc-set-info"><div class="gc-set-name">' + esc(label) +
(sub ? '<span class="gc-set-sub">' + esc(sub) + '</span>' : '') + '</div></div>' +
'<label class="toggle"><input type="checkbox"><span class="tk"></span></label>';
const cb = row.querySelector('input');
let on = false;
try { const c = (window.replyCfg ? window.replyCfg() : gcCfg()) || {}; on = Number(c[key]) === 1; } catch (e) {}
cb.checked = on;
cb.addEventListener('change', () => { try { if (window.saveReplyCfg) window.saveReplyCfg(key, cb.checked ? 1 : 0); } catch (e) {} });
return row;
};
rTitle('多字卡回复');
(curSec||settingsBody).appendChild(gcReplyToggleRow('多字卡回复', '总开关：关闭后每个成员每条消息只回一条、只用一张字卡', 'gc-py-en'));
rStep('触发概率', 'gc-py-prob', 0, 100, 5);
rStep('最少条数', 'gc-py-min', 1, 10, 1);
rStep('最多条数', 'gc-py-max', 2, 10, 1);
rTitle('让对方继续说');
(curSec||settingsBody).appendChild(gcReplyToggleRow('按正常回复时间', '未开启时，点击后联系人立即回复', 'gc-cs-normal'));
(curSec||settingsBody).appendChild(gcReplyToggleRow('点顶部昵称触发', '', 'gc-cs-trigger-name'));
(curSec||settingsBody).appendChild(gcReplyToggleRow('底部聊天栏按钮触发', '', 'gc-cs-trigger-bar'));
const csNote = document.createElement('div');
csNote.className = 'gc-set-note';
csNote.textContent = '点顶部昵称（群名）/底部按钮会触发新一轮回复，条数仍按上面设置抽取，会叠在正常回复之外；顶部那枚常驻继续说按钮已收进底部输入栏这一排（与单聊同位置）。这枚开关同时决定单聊与群聊输入栏上「继续说」按钮的显隐，两页各开各的也行（单聊那份开关在本联系人桌面的回复设置里）。开启昵称触发后，切换群聊请用本面板「群聊」tag。';
(curSec||settingsBody).appendChild(csNote);
const note = document.createElement('div');
note.className = 'gc-set-note';
note.textContent = '成员回复内容来自：公用字卡 + 该成员桌面专属字卡 + 系统默认字卡；某成员桌面关闭【聊天使用】，聊天和群聊里这个成员都不再使用系统默认字卡。';
(curSec||settingsBody).appendChild(note);
sec('general');
const tIn = document.createElement('div');
tIn.className = 'gc-set-title';
tIn.textContent = '输入与消息';
(curSec||settingsBody).appendChild(tIn);
const gcToggleRow = (label, sub, key, onchange) => {
const row = document.createElement('div');
row.className = 'gc-set-item gc-set-toggle';
row.innerHTML =
'<div class="gc-set-info"><div class="gc-set-name">' + esc(label) +
(sub ? '<span class="gc-set-sub">' + esc(sub) + '</span>' : '') + '</div></div>' +
'<label class="toggle"><input type="checkbox"><span class="tk"></span></label>';
const cb = row.querySelector('input');
cb.checked = gcGlobalOn(key);
cb.addEventListener('change', () => { gcGlobalSet(key, cb.checked); if (onchange) onchange(cb.checked); });
return row;
};
(curSec||settingsBody).appendChild(gcToggleRow('回车键发送消息', '关闭后按回车键换行，不再直接发送', 'cs-enter-send', null));
(curSec||settingsBody).appendChild(gcToggleRow('批量发送消息', '输入栏右侧显示「批量发送」按钮，可插入表情包/图片/文字批量发送', 'cs-batch-send',
() => syncGcInputBtns()));
(curSec||settingsBody).appendChild(gcToggleRow('我可发送语音', '输入栏左侧显示「麦克风」按钮，可录音并发送语音', 'cs-voice-send',
() => syncGcInputBtns()));
(curSec||settingsBody).appendChild(gcToggleRow('隐藏联系人的表情包', '表情包面板只显示「我的表情包」', 'hide-ta-sticker',
(en) => { try { document.dispatchEvent(new Event('hide-ta-sticker-changed')); } catch (e) {} toast(en ? '已隐藏：表情包面板只显示「我的表情包」' : '已恢复显示 TA 的和公用表情包'); }));
(curSec||settingsBody).appendChild(gcToggleRow('允许删除成员消息', '点击成员消息气泡可在操作菜单里删除该条消息', 'cs-del-ta-msg',
(en) => toast(en ? '已开启：点击成员消息可在操作菜单里删除该条消息' : '已关闭删除成员消息功能')));
const ioRow = document.createElement('div');
ioRow.className = 'gc-set-item gc-set-link';
ioRow.id = 'gc-input-order-row';
ioRow.innerHTML =
'<div class="gc-set-av">' +
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h11M4 16h11"/><path d="M18 6l3 2-3 2M18 14l3 2-3 2"/></svg>' +
'</div>' +
'<div class="gc-set-info"><div class="gc-set-name">输入栏按钮位置<span class="gc-set-sub">自定义底部输入栏这一排图标的左右顺序（录音 / 继续说 / 更多 / 表情 / 输入框 / 图片 / 批量发送），「发送」固定在最右端；与单聊共用同一份顺序，只管位置、不改各按钮的开关</span></div></div>' +
'<span class="gc-set-chev">›</span>';
ioRow.addEventListener('click', () => {
if (!window.mochiInputOrderPanel) { toast('排序面板还没就绪，请稍后再试'); return; }
window.mochiInputOrderPanel.open();
});
(curSec||settingsBody).appendChild(ioRow);
const ioSync = () => {
const v = ioRow.querySelector('.gc-set-desk');
const txt = window.mochiInputOrderPanel ? window.mochiInputOrderPanel.valueText() : '';
if (v) v.textContent = txt;
};
const ioVal = document.createElement('div');
ioVal.className = 'gc-set-desk';
ioRow.querySelector('.gc-set-info').appendChild(ioVal);
document.addEventListener('chat-input-order-changed', ioSync);
ioSync();
sec('data');
const tD = document.createElement('div');
tD.className = 'gc-set-title';
tD.textContent = '数据';
(curSec||settingsBody).appendChild(tD);
const gcDataLink = (label, sub, danger, fn) => {
const row = document.createElement('div');
row.className = 'gc-set-item gc-set-link' + (danger ? ' gc-set-danger' : '');
row.innerHTML =
'<div class="gc-set-av">' +
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5-5 5 5"/><path d="M12 5v12"/></svg>' +
'</div>' +
'<div class="gc-set-info"><div class="gc-set-name">' + esc(label) + '</div>' +
(sub ? '<div class="gc-set-desk">' + esc(sub) + '</div>' : '') + '</div>' +
'<span class="gc-set-chev">›</span>';
row.addEventListener('click', fn);
return row;
};
const curGroupName = currentGroup().name || '群聊';
(curSec||settingsBody).appendChild(gcDataLink('导出聊天记录', '当前群聊全部消息导出为 JSON 文件', false, () => {
try {
gFlushPersistNow();
const n = msgs.length;
if (!n) { toast('没有聊天记录可导出'); return; }
toast('正在导出，请稍候…');
const expMap = {};
const toks = {};
const isTok = (s) => typeof s === 'string' && window.mochiMediaIsToken && window.mochiMediaIsToken(s);
const scanStr = (s) => {
if (typeof s !== 'string') return;
if (isTok(s)) toks[s] = 1;
else if (s.indexOf('|||') >= 0) s.split('|||').forEach(p => { if (isTok(p)) toks[p] = 1; });
};
msgs.forEach(r => {
if (!r || typeof r !== 'object') return;
scanStr(r.text);
(r.parts || []).forEach(p => { if (p && p.k === 'img') scanStr(p.v); });
if (r.quote) {
if (typeof r.quote === 'string') scanStr(r.quote);
else if (Array.isArray(r.quote.imgs)) r.quote.imgs.forEach(scanStr);
}
});
const repStr = (s) => {
if (typeof s !== 'string') return s;
if (expMap[s]) return expMap[s];
if (s.indexOf('|||') < 0) return s; // 语音「名称|||音频」令牌段替换
let ch = false;
const ps = s.split('|||').map(p => { const e2 = expMap[p]; if (e2) { ch = true; return e2; } return p; });
return ch ? ps.join('|||') : s;
};
const head = '{"app":"mochi-zika-group-chat","version":"1.0","gid":"' + attrEsc(curGid) + '","exportTime":"' + new Date().toISOString() + '","msgs":[';
const writeOut = () => {
const hasExp = Object.keys(expMap).length > 0;
const parts = [head];
for (let i = 0; i < n; i++) {
if (i) parts.push(',');
let r = msgs[i];
if (hasExp) {
try {
r = JSON.parse(JSON.stringify(r));
if (r && typeof r === 'object') {
if (typeof r.text === 'string') r.text = repStr(r.text);
if (Array.isArray(r.parts)) r.parts = r.parts.map(p => (p && p.k === 'img') ? { k: 'img', v: repStr(p.v), sub: p.sub } : p);
if (typeof r.quote === 'string') r.quote = repStr(r.quote);
else if (r.quote && Array.isArray(r.quote.imgs)) r.quote = Object.assign({}, r.quote, { imgs: r.quote.imgs.map(repStr) });
}
} catch (e) { r = msgs[i]; }
}
parts.push(JSON.stringify(r));
}
parts.push(']}');
const blob = new Blob(parts, { type: 'application/json;charset=utf-8' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
const d = new Date(); const p2 = (x) => (x < 10 ? '0' : '') + x;
const safeName = String(curGroupName).replace(/[\\/:*?"<>|]/g, '_').trim() || '群聊';
a.download = safeName + '_聊天记录_' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.json';
document.body.appendChild(a);
a.click();
setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
toast('已导出 ' + n + ' 条聊天记录');
};
const tk = Object.keys(toks);
if (!tk.length) { writeOut(); return; }
let left = tk.length, fin = false;
const done = () => { if (fin) return; fin = true; writeOut(); };
setTimeout(done, 8000);
tk.forEach(k => {
try {
window.mochiMediaExpandAsync(k, (d) => { if (d) expMap[k] = d; if (--left === 0) done(); });
} catch (e) { if (--left === 0) done(); }
});
} catch (e) { toast('导出失败：' + (e && e.message || '未知错误')); }
}));
(curSec||settingsBody).appendChild(gcDataLink('导入聊天记录', '从 JSON 文件导入并覆盖当前群聊记录', false, () => {
window.mochiFilePick({
id: 'mochi-gc-import-pick', accept: '.json,application/json',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到文件，请再选一次'); return; }
const reader = new FileReader();
reader.onload = () => {
let data;
try { data = JSON.parse(String(reader.result || '')); } catch (e) { toast('无效的聊天记录文件'); return; }
if (!data || typeof data !== 'object') { toast('无效的聊天记录文件'); return; }
let arr = Array.isArray(data) ? data : null;
if (!arr && data.msgs && Array.isArray(data.msgs)) arr = data.msgs;
if (!arr && data.ls && typeof data.ls === 'object') {
const ck = groupMsgKey(curGid);
const raw = (data.idb && data.idb[ck]) || data.ls[ck] || (data.idb && data.idb[MSG_KEY]) || data.ls[MSG_KEY];
try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { arr = null; }
}
if (!Array.isArray(arr) || !arr.length) { toast('文件里没有聊天记录数据'); return; }
const total = arr.length;
const fmt = (t) => t ? new Date(t).toLocaleString() : '未知';
const lines = ['文件包含 ' + total + ' 条消息：',
'· 最早：' + fmt(arr[0] && arr[0].ts),
'· 最新：' + fmt(arr[total - 1] && arr[total - 1].ts),
'导入将覆盖当前群聊的全部聊天记录（不可恢复）。'];
if (!window.openModal) return;
window.openModal('确认导入聊天记录？', '', () => {
arr = arr.filter(m => m && typeof m === 'object');
gFlushPersistNow();
msgs = arr;
saveNow();
renderAll();
toast('已导入 ' + arr.length + ' 条聊天记录');
}, { noInput: true, staticText: lines.join('\n') });
};
reader.onerror = () => { toast('文件读取失败，请重试'); };
reader.readAsText(f, 'utf-8');
}
});
}));
(curSec||settingsBody).appendChild(gcDataLink('删除全部聊天记录', '清空「' + curGroupName + '」的全部消息（不可恢复）', true, () => {
if (!window.openModal) return;
window.openModal('确认删除「' + curGroupName + '」的全部聊天记录？（不可恢复）', '', () => {
msgs = [];
saveNow();
renderAll();
toast('聊天记录已清空');
}, { noInput: true });
}));
sec('general');
const bRow = document.createElement('div');
bRow.className = 'gc-set-item gc-set-link';
bRow.innerHTML =
'<div class="gc-set-av">' +
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>' +
'</div>' +
'<div class="gc-set-info">' +
'<div class="gc-set-name">美化聊天</div>' +
'<div class="gc-set-desk">气泡颜色、壁纸、字体、时间轴样式等</div>' +
'</div>' +
'<span class="gc-set-chev">›</span>';
bRow.addEventListener('click', () => { gcSetTab = 'beauty'; renderSettingsPanel(); });
(curSec||settingsBody).appendChild(bRow);
if (gcSetTab === 'beauty') renderBeautyView(secs.beauty);
}
function beautyRow(label, val, fn) {
const row = document.createElement('div');
row.className = 'gc-set-row';
row.innerHTML = '<span class="txt">' + escapeHtml(label) + '</span><span class="val">' + escapeHtml(val) + '</span><span class="chev">›</span>';
row.addEventListener('click', fn);
return row;
}
function renderBeautyView(host) {
const g = gcBeautyGet;
const rootEl = host || settingsBody;
const svgIco = (p) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
const ICO = {
bg: svgIco('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5-9 9"/>'),
trash: svgIco('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>'),
palette: svgIco('<path d="M12 21a9 9 0 110-18"/><path d="M12 3a9 9 0 019 9"/><path d="M21 12a9 9 0 01-9 9"/><circle cx="12" cy="12" r="2"/>'),
ink: svgIco('<path d="M5 20L10 6h4l5 14"/><path d="M7.5 14.5h9"/>'),
eye: svgIco('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
sendbar: svgIco('<rect x="3" y="9" width="18" height="6" rx="3"/>'),
fontsize: svgIco('<path d="M4 7h16M4 12h16M4 17h10"/>'),
bubble: svgIco('<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M10 10h.01M13 10h.01"/>'),
radius: svgIco('<rect x="3" y="4" width="18" height="16" rx="8"/>'),
avatar: svgIco('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/>'),
clock: svgIco('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
drop: svgIco('<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>'),
typing: svgIco('<path d="M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>'),
font: svgIco('<path d="M6 4h12M12 4v16M9 20h6"/>'),
css: svgIco('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>'),
save: svgIco('<path d="M12 17V9M9 11l3-3 3 3"/><path d="M5 4h11l3 3v13a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z"/>'),
list: svgIco('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>')
};
let curGroup = null;
const gtitle = (t) => {
const ttl = document.createElement('div');
ttl.className = 'gs-title';
ttl.textContent = t;
rootEl.appendChild(ttl);
curGroup = document.createElement('div');
curGroup.className = 'set-group glass';
rootEl.appendChild(curGroup);
};
const add = (label, val, fn, ico) => {
const row = document.createElement('div');
row.className = 'set-row gc-set-row';
row.innerHTML = '<div class="ico">' + (ico || '') + '</div><span class="txt">' + escapeHtml(label) + '</span><span class="val">' + escapeHtml(val) + '</span>';
row.addEventListener('click', fn);
(curGroup || rootEl).appendChild(row);
return row;
};
const bgLabel = (v, def) => v === def ? '默认 ' + def : v;
const liveBtn = document.createElement('button');
liveBtn.type = 'button';
liveBtn.id = 'gc-live-adjust';
liveBtn.style.cssText = 'display:flex;align-items:center;gap:10px;width:calc(100% - 24px);margin:10px 12px 0;padding:11px 14px;border:1px solid var(--btn-bg,#111);border-radius:12px;background:color-mix(in srgb, var(--btn-bg,#111) 10%, transparent);color:var(--ink,#111);text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;flex-shrink:0';
liveBtn.innerHTML = '<span style="flex:1;min-width:0">' +
'<span style="display:block;font-size:15px;font-weight:700;line-height:1.25">边看边调</span>' +
'<span style="display:block;font-size:11.5px;font-weight:400;opacity:.85;margin-top:2px">打开调色条：群聊在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位</span>' +
'</span><span style="flex:none;font-size:12px;font-weight:700;padding:7px 10px;border:1px solid var(--btn-bg,#111);border-radius:999px;background:var(--btn-bg,#111);color:var(--btn-ink,#fff);white-space:nowrap">点击开启 ›</span>';
liveBtn.addEventListener('click', openGcBeautyDrawer);
rootEl.insertBefore(liveBtn, rootEl.firstChild);
gtitle('壁纸');
add('聊天壁纸', g('bg') ? '已设置' : '未设置', () => pickGcWallpaper(), ICO.bg);
if (g('bg')) add('清空群聊壁纸', '', () => { gcBeautySet('bg', ''); toast('已恢复默认壁纸'); }, ICO.trash);
gtitle('气泡与文字');
add('我的气泡颜色', bgLabel(g('out-bg'), '#111111'), () => pickGcColor('out-bg', '我的气泡颜色', GC_BUBBLE_BG), ICO.palette);
add('我的消息文字颜色', bgLabel(g('out-ink'), '#ffffff'), () => pickGcColor('out-ink', '我的消息文字颜色', gcInkSwatches()), ICO.ink);
add('联系人气泡颜色', bgLabel(g('in-bg'), '#ffffff'), () => pickGcColor('in-bg', '联系人气泡颜色', GC_BUBBLE_BG), ICO.palette);
add('联系人消息文字颜色', bgLabel(g('in-ink'), '#111111'), () => pickGcColor('in-ink', '联系人消息文字颜色', gcInkSwatches()), ICO.ink);
add('气泡透明度', gcClampNum(g('bubble-op'), 0, 100, 100) + '%', () => pickGcSlider('bubble-op', '聊天气泡透明度', '只调气泡底色，文字始终清晰', 0, 100, '%'), ICO.eye);
gtitle('顶栏 / 底栏');
add('顶栏不透明度', gcClampNum(g('head-op'), 0, 100, 92) + '%', () => pickGcSlider('head-op', '顶栏不透明度', '0% 全透明、100% 不透明，文字按钮不变淡', 0, 100, '%', '--cs-head-opacity'), ICO.sendbar);
add('底栏不透明度', gcClampNum(g('input-op'), 0, 100, 92) + '%', () => pickGcSlider('input-op', '输入栏不透明度', '0% 全透明、100% 不透明，文字按钮不变淡', 0, 100, '%', '--cs-input-opacity'), ICO.sendbar);
add('顶栏下移', gcClampNum(g('head-inset'), 0, 80, 0) + 'px', () => pickGcSlider('head-inset', '顶栏向下移动', '留白参与布局，消息区随之缩短', 0, 80, 'px', '--cs-head-inset'), ICO.clock);
add('底栏上移', gcClampNum(g('input-inset'), 0, 80, 0) + 'px', () => pickGcSlider('input-inset', '底栏向上移动', '留白参与布局，消息区随之缩短', 0, 80, 'px', '--cs-input-inset'), ICO.clock);
gtitle('发送按钮');
add('发送按钮显示/隐藏', g('send-show') === 'hide' ? '隐藏' : '显示', () => pickGcPills('send-show', '显示发送按钮', [
{ label: '显示', value: 'show' }, { label: '隐藏', value: 'hide' }
], 'show'), ICO.eye);
add('发送按钮颜色', bgLabel(g('send-bg'), '#111111'), () => pickGcColor('send-bg', '发送按钮颜色', GC_SEND_BG), ICO.sendbar);
add('发送文字颜色', bgLabel(g('send-ink'), '#ffffff'), () => pickGcColor('send-ink', '发送文字颜色', GC_INK_COLORS), ICO.ink);
gtitle('气泡外观');
add('聊天气泡字体大小', (GC_FONT_SIZES.find(p => p.value === g('font-size')) || {}).label || g('font-size'), () => pickGcPills('font-size', '聊天气泡字体大小', GC_FONT_SIZES, '14px'), ICO.fontsize);
add('聊天气泡框大小', (GC_BUBBLE_SIZES.find(p => p.value === g('bubble-size')) || { label: '自定义' }).label, () => pickGcBubbleSize(), ICO.bubble);
add('聊天头像形状', g('av-shape') === 'square' ? '方形' : '圆形', () => pickGcPills('av-shape', '聊天头像形状', [
{ label: '圆形', value: 'circle' }, { label: '方形', value: 'square' }
], 'circle'), ICO.avatar);
add('时间轴样式', (GC_BEAUTY_STYLES.find(s => s.value === g('time-style')) || {}).label || '头像下方', () => pickGcPills('time-style', '时间轴样式', GC_BEAUTY_STYLES, 'under-av'), ICO.clock);
add('气泡边缘圆角', (GC_BUBBLE_RADII.find(p => p.value === g('bubble-radius')) || {}).label || (g('bubble-radius') === '0px' ? '方形' : g('bubble-radius')), () => pickGcBubbleRadius(), ICO.radius);
add('时间轴颜色', '默认 ' + g('time-ink'), () => pickGcColor('time-ink', '时间轴颜色', GC_INK_COLORS), ICO.drop);
add('正在输入颜色', '默认 ' + g('typing-ink'), () => pickGcColor('typing-ink', '正在输入颜色', GC_INK_COLORS), ICO.typing);
gtitle('字体与样式');
add('群聊字体', g('font') ? (g('font').indexOf('data:') === 0 ? '已上传' : g('font')) : '默认', () => pickGcFont(), ICO.font);
add('气泡 CSS', g('css') ? '已设置' : '默认', () => pickGcCss(), ICO.css);
gtitle('美化方案');
add('保存当前为美化方案', '', () => window.saveGcBeautyScheme(), ICO.save);
add('美化方案管理', '(保存/应用/改名/删除/导出/导入)', () => window.openGcBeautySchemes(), ICO.list);
}
function gcInkSwatches() {
return GC_INK_COLORS.map(s => s.color === '#111111' ? { color: '#111111', label: '黑色' } : s);
}
function pickGcColor(key, title, swatches) {
if (!window.openModal) return;
const cur = gcBeautyGet(key);
window.openModal(title, '', (v) => {
const color = (typeof v === 'number' && swatches[v]) ? swatches[v].color : v;
if (!color) return;
gcBeautySet(key, color);
}, { colorPicker: true, color: cur, swatches: swatches });
}
function pickGcPills(key, title, pills, def) {
if (!window.openModal) return;
window.openModal(title, '', (v) => { if (v) gcBeautySet(key, v); }, {
pills: pills, pill: gcBeautyGet(key) || def, noInput: true
});
}
function pickGcSlider(key, title, label, min, max, unit, cssVar) {
if (!window.openModal) return;
const page = document.getElementById('page-group-chat');
const def = GC_BEAUTY_DEFAULTS[key];
const cur = gcClampNum(gcBeautyGet(key), min, max, gcClampNum(def, min, max, min));
const preview = (n) => {
if (!page) return;
if (key === 'bubble-op') { gcApplyBubbleSurfaceWith(n); return; }
if (!cssVar) return;
page.style.setProperty(cssVar, unit === '%' ? String(n / 100) : n + 'px');
};
window.openModal(title, '', (v) => {
gcBeautySet(key, gcClampNum(v, min, max, cur));
}, {
noInput: true,
slider: {
min: min, max: max, step: 1, value: cur,
label: label, unit: unit, preview: true,
onChange: (val) => preview(gcClampNum(val, min, max, cur))
}
});
}
function pickGcWallpaper() {
window.mochiFilePick({
id: 'mochi-gc-wallpaper-pick', accept: 'image/*',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到图片，请再选一次'); return; }
const reader = new FileReader();
reader.onload = () => {
const img = new Image();
img.onload = () => {
try {
const dpr = Math.max(1, window.devicePixelRatio || 1);
const screenH = (window.screen && window.screen.height) || 1920;
const maxSide = Math.min(4096, Math.max(2160, Math.round(screenH * dpr)));
const c = document.createElement('canvas');
const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
c.width = Math.max(1, Math.round(img.width * scale));
c.height = Math.max(1, Math.round(img.height * scale));
c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
gcBeautySet('bg', c.toDataURL('image/jpeg', 0.85));
toast('群聊壁纸已应用');
} catch (e) { toast('壁纸处理失败，请换一张'); }
};
img.onerror = () => { toast('图片读取失败，请换一张'); };
img.src = reader.result;
};
reader.onerror = () => { toast('图片读取失败，请换一张'); };
reader.readAsDataURL(f);
}
});
}
function pickGcBubbleSize() {
if (!window.openTCPanel) return;
const cur = gcBeautyGet('bubble-size');
window.openTCPanel('聊天气泡框大小', '' +
'<div class="sm-fld"><label>预设大小</label><select class="tc-input" id="gc-pad-preset">' +
'<option value="">自定义</option>' +
GC_BUBBLE_SIZES.map(p => '<option value="' + p.value + '"' + (p.value === cur ? ' selected' : '') + '>' + p.label + '</option>').join('') +
'</select></div>' +
'<div class="sm-fld"><label>自定义（格式：上下 左右，如 <code>8px 10px</code>）</label>' +
'<input class="tc-input" id="gc-pad-input" value="' + String(cur).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></div>' +
'<div class="sm-set-hint">示例：紧凑 8px 10px · 标准 11px 14px · 宽松 14px 18px</div>' +
'<div class="mail-actions"><button class="cc-tool" id="gc-pad-cancel">取消</button><button class="cc-tool" id="gc-pad-ok">应用</button></div>');
document.getElementById('gc-pad-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
document.getElementById('gc-pad-preset').addEventListener('change', () => {
const v = document.getElementById('gc-pad-preset').value;
if (v) document.getElementById('gc-pad-input').value = v;
});
document.getElementById('gc-pad-ok').addEventListener('click', () => {
let v = (document.getElementById('gc-pad-input').value || '').trim();
if (!v) { toast('请输入气泡框大小'); return; }
v = String(v).split(/[,\s]+/).filter(Boolean).map(function (tok) {
return /^-?\d+(?:\.\d+)?px$/.test(tok) ? tok : tok.replace(/^(-?\d+(?:\.\d+)?)$/, '$1px');
}).join(' ');
gcBeautySet('bubble-size', v);
document.getElementById('tc-mask').hidden = true;
toast('气泡框大小已应用');
});
}
function pickGcBubbleRadius() {
if (!window.openModal) return;
const page = document.getElementById('page-group-chat');
const curStr = gcBeautyGet('bubble-radius') || GC_BUBBLE_RADIUS_DEFAULT;
const curNum = (parseInt(curStr, 10) || 0);
window.openModal('聊天气泡边缘圆角', '', (v) => {
const px = typeof v === 'number' ? v : (parseInt(v, 10) || 0);
gcBeautySet('bubble-radius', px + 'px');
}, {
noInput: true,
slider: {
min: 0, max: 40, step: 1, value: Math.max(0, Math.min(40, curNum)),
label: '拖动调整气泡圆角', unit: 'px', preview: true,
onChange: (val) => { if (page) page.style.setProperty('--chat-bubble-radius', val + 'px'); }
},
pills: GC_BUBBLE_RADII,
pill: curStr
});
}
function pickGcFont() {
if (!window.openTCPanel) return;
const cur = gcBeautyGet('font');
window.openTCPanel('群聊字体', '' +
'<div class="sm-fld"><label>上传本地字体（ttf / otf / woff / woff2），只对群聊页生效</label>' +
'<input class="tc-input" id="gc-font-name" placeholder="也可直接输入字体名，如 Microsoft YaHei"' + (cur && cur.indexOf('data:') !== 0 && cur.indexOf('http') !== 0 ? ' value="' + String(cur).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"' : '') + '></div>' +
'<div class="mail-actions"><button class="cc-tool" id="gc-font-upload">上传字体</button><button class="cc-tool" id="gc-font-clear">恢复默认</button><button class="cc-tool" id="gc-font-ok">应用</button></div>');
document.getElementById('gc-font-upload').addEventListener('click', () => {
window.mochiFilePick({
id: 'mochi-gc-fontdlg-pick', accept: '.ttf,.otf,.woff,.woff2',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到字体文件，请再选一次'); return; }
toast('正在读取字体文件…');
const reader = new FileReader();
reader.onload = () => {
gcBeautySet('font', reader.result);
document.getElementById('tc-mask').hidden = true;
toast('字体已应用（群聊页）');
};
reader.onerror = () => { toast('字体文件读取失败，请重试'); };
reader.readAsDataURL(f);
}
});
});
document.getElementById('gc-font-clear').addEventListener('click', () => {
gcBeautySet('font', '');
document.getElementById('tc-mask').hidden = true;
toast('已恢复默认字体');
});
document.getElementById('gc-font-ok').addEventListener('click', () => {
const name = (document.getElementById('gc-font-name').value || '').trim();
if (!name) { toast('请输入字体名'); return; }
gcBeautySet('font', name);
document.getElementById('tc-mask').hidden = true;
toast('字体已应用（群聊页）');
});
}
function pickGcCss() {
if (!window.openTCPanel) return;
window.openTCPanel('气泡 CSS', '' +
'<div class="sm-fld-hint" style="margin-bottom:8px">输入自定义样式，只对群聊页生效，支持两种写法：<br>· 直接写声明，如 <code>border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.1)</code>（自动应用到双方气泡）<br>· 或写选择器，如 <code>.msg-out .msg-bubble{...}</code></div>' +
'<textarea id="gc-css-input" class="tc-input" rows="6" placeholder="border-radius: 20px;' + '&#10;box-shadow: 0 2px 8px rgba(0,0,0,.12);"></textarea>' +
'<div class="mail-actions"><button class="cc-tool" id="gc-css-clear">清空</button><button class="cc-tool" id="gc-css-ok">应用</button></div>');
const ta = document.getElementById('gc-css-input');
if (ta) ta.value = gcBeautyGet('css');
document.getElementById('gc-css-clear').addEventListener('click', () => {
gcBeautySet('css', '');
document.getElementById('tc-mask').hidden = true;
toast('已清空气泡样式');
});
document.getElementById('gc-css-ok').addEventListener('click', () => {
const el = document.getElementById('gc-css-input');
let v = '';
try { v = el ? (el.value || '') : ''; } catch (e) {}
if (!String(v).trim() && el) {
try {
const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
const t = box ? (box.innerText || box.textContent || '') : '';
if (String(t).trim()) v = String(t);
} catch (e) {}
}
gcBeautySet('css', String(v).trim());
document.getElementById('tc-mask').hidden = true;
toast('气泡样式已应用');
});
}
function gcDrawerEl() {
let d = document.getElementById('gc-beauty-drawer');
if (!d) {
d = document.createElement('div');
d.id = 'gc-beauty-drawer';
document.body.appendChild(d);
d.addEventListener('click', (e) => e.stopPropagation());
}
return d;
}
function hideGcBeautyDrawer() {
const d = document.getElementById('gc-beauty-drawer');
if (d) d.style.display = 'none';
}
document.addEventListener('click', (e) => {
const t = e.target;
if (!t || !t.closest) return;
if (t.closest('.tab') || t.closest('#gc-back') || t.closest('.app[data-app]')) hideGcBeautyDrawer();
}, true);
let gcDrawerSec = 'bubble';
let gcDockBot = null;
function gcDrawerApplyBottom() {
const d = document.getElementById('gc-beauty-drawer');
if (!d) return;
d.style.bottom = (gcDockBot || 0) + 'px';
}
function openGcBeautyDrawer() {
try { if (settingsPanel) settingsPanel.hidden = true; } catch (e) {}
const d = gcDrawerEl();
d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:95;max-height:40vh;transition:bottom .16s ease;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);color:var(--ink,#111);box-shadow:0 -6px 24px rgba(0,0,0,.18);border-radius:16px 16px 0 0;overflow-y:auto;overflow-x:hidden;padding:0 12px calc(10px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)));box-sizing:border-box;display:flex;flex-direction:column;gap:8px';
d.innerHTML = '';
const grip = document.createElement('div');
grip.style.cssText = 'width:36px;height:4px;border-radius:2px;background:var(--card-border,#ddd);margin:7px auto 0;flex:none';
d.appendChild(grip);
const mkMini = (label, fn, cssExtra) => {
const b = document.createElement('button');
b.type = 'button';
b.textContent = label;
b.style.cssText = 'flex:none;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;border-radius:8px;padding:4px 9px;cursor:pointer' + (cssExtra || '');
b.addEventListener('click', fn);
return b;
};
const bindGcDockDrag = (el) => {
el.style.touchAction = 'none';
el.style.cursor = 'grab';
let sy = 0, sb = 0, drag = false;
el.addEventListener('pointerdown', (e) => {
if (e.target.closest('button')) return;
if (e.pointerType === 'mouse' && e.button !== 0) return;
drag = true; sy = e.clientY; sb = gcDockBot || 0;
d.style.transition = 'none'; // 拖动期间关掉 bottom 过渡，保证跟手
try { el.setPointerCapture(e.pointerId); } catch (er) {}
e.preventDefault();
});
el.addEventListener('pointermove', (e) => {
if (!drag) return;
gcDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));
gcDrawerApplyBottom();
e.preventDefault();
});
const up = () => {
if (!drag) return;
drag = false;
d.style.transition = 'bottom .16s ease';
if ((gcDockBot || 0) < 24) gcDockBot = null; // 接近底部＝吸附回贴底
gcDrawerApplyBottom();
};
el.addEventListener('pointerup', up);
el.addEventListener('pointercancel', up);
};
bindGcDockDrag(grip);
const hd = document.createElement('div');
hd.style.cssText = 'display:flex;align-items:center;gap:8px;flex:none';
const hdTxt = document.createElement('span');
hdTxt.textContent = '边看边调（即时生效）';
hdTxt.style.cssText = 'font-size:13px;font-weight:700;flex:none';
const hdHint = document.createElement('span');
hdHint.textContent = '按住标题行上下拖 · 让开看群聊';
hdHint.style.cssText = 'font-size:11px;color:var(--muted,#888);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
const panelBody = document.createElement('div');
panelBody.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:none';
const body = document.createElement('div');
body.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:none';
const foldBtn = mkMini('收起', () => {
const willFold = panelBody.style.display !== 'none';
panelBody.style.display = willFold ? 'none' : 'flex';
foldBtn.textContent = willFold ? '展开' : '收起';
});
const closeBtn = mkMini('\u2715', () => {
hideGcBeautyDrawer();
try { gcSetTab = 'beauty'; renderSettingsPanel(); if (settingsPanel) settingsPanel.hidden = false; } catch (e) {}
}, ';padding:4px 8px');
hd.appendChild(hdTxt); hd.appendChild(hdHint); hd.appendChild(foldBtn); hd.appendChild(closeBtn);
d.appendChild(hd);
bindGcDockDrag(hd); // grip 只有 4px 高，标题行才是主拖拽把手
const chipsRow = document.createElement('div');
chipsRow.style.cssText = 'display:flex;gap:6px;flex:none';
panelBody.appendChild(chipsRow);
panelBody.appendChild(body);
d.appendChild(panelBody);
const mkSlider = (label, get, set, min, max, step, unit, preview) => {
const row = document.createElement('div');
row.style.cssText = 'display:flex;align-items:center;gap:8px';
const lb = document.createElement('span');
lb.textContent = label;
lb.style.cssText = 'font-size:11.5px;color:var(--muted,#888);flex:none;width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
const inp = document.createElement('input');
inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step || 1;
const cur = gcClampNum(get(), min, max, min);
inp.value = String(cur);
inp.style.cssText = 'flex:1;min-width:0';
const vv = document.createElement('span');
vv.style.cssText = 'font-size:11px;color:var(--muted,#999);flex:none;width:46px;text-align:right';
vv.textContent = cur + unit;
inp.addEventListener('input', () => {
const n = gcClampNum(inp.value, min, max, cur);
vv.textContent = n + unit;
if (preview) preview(n);
set(n);
});
row.appendChild(lb); row.appendChild(inp); row.appendChild(vv);
return row;
};
const mkPills = (label, items, get, set) => {
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px';
const lb = document.createElement('span');
lb.textContent = label;
lb.style.cssText = 'font-size:11.5px;color:var(--muted,#888)';
const row = document.createElement('div');
row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
const cur = get();
const paint = (onBtn) => Array.prototype.forEach.call(row.children, c => {
const on = c === onBtn;
c.style.background = on ? 'var(--ink,#111)' : 'var(--btn-cancel-bg,#fafafa)';
c.style.color = on ? 'var(--bg-b,#fff)' : 'var(--ink,#111)';
c.style.borderColor = on ? 'var(--ink,#111)' : 'var(--card-border,#ddd)';
});
items.forEach(it => {
const b = document.createElement('button');
b.type = 'button'; b.textContent = it.label;
b.style.cssText = 'font-size:11.5px;padding:5px 9px;border-radius:8px;cursor:pointer;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)';
if (it.value === cur) paint(b);
b.addEventListener('click', () => { set(it.value); paint(b); });
row.appendChild(b);
});
wrap.appendChild(lb); wrap.appendChild(row);
return wrap;
};
let colorItems = [];
let paletteHost = null;
const mkColorItem = (label, key, def, swatchList) => {
const el = document.createElement('div');
el.style.cssText = 'display:flex;align-items:center;gap:7px;padding:6px 8px;border:1px solid var(--card-border,#ddd);border-radius:9px;cursor:pointer;min-width:0';
const sw = document.createElement('span');
const curGet = () => { try { return gcBeautyGet(key) || def; } catch (e) { return def; } };
sw.style.cssText = 'width:18px;height:18px;border-radius:5px;border:1px solid var(--card-border,#ddd);flex:none;background:' + curGet();
const tx = document.createElement('span');
tx.textContent = label;
tx.style.cssText = 'font-size:11.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
const paint = () => { sw.style.background = curGet(); };
const curSet = (v) => {
try { gcBeautySet(key, v === null ? '' : v); } catch (e) {}
paint();
};
el.appendChild(sw); el.appendChild(tx); paint();
el.addEventListener('click', () => {
colorItems.forEach(it => { it.el.style.borderColor = 'var(--card-border,#ddd)'; });
el.style.borderColor = 'var(--ink,#111)';
renderGcPalette({ el, label, curGet, curSet, swatchList });
});
colorItems.push({ el, paint });
return el;
};
const renderGcPalette = (item) => {
if (!paletteHost) return;
paletteHost.innerHTML = '';
const strip = document.createElement('div');
strip.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
const cur = String(item.curGet() || '').toLowerCase();
(item.swatchList || []).forEach(swItem => {
const dot = document.createElement('span');
const c = swItem.color;
dot.style.cssText = 'width:23px;height:23px;border-radius:7px;border:1px solid ' + (String(c).toLowerCase() === cur ? 'var(--ink,#111)' : 'var(--card-border,#ddd)') + ';cursor:pointer;flex:none;background:' + c;
dot.title = swItem.label || c;
dot.addEventListener('click', () => { item.curSet(c); renderGcPalette(item); });
strip.appendChild(dot);
});
const defBtn = document.createElement('button');
defBtn.type = 'button'; defBtn.textContent = '默认';
defBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
defBtn.addEventListener('click', () => { item.curSet(null); renderGcPalette(item); });
strip.appendChild(defBtn);
const hexBtn = document.createElement('button');
hexBtn.type = 'button'; hexBtn.textContent = '手输色值';
hexBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
hexBtn.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('输入' + item.label + '色值', String(item.curGet() || '#111111'), (v) => {
const c = String(v || '').trim();
if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) { toast('请输入 # 开头的色值，如 #ffd6e0'); return; }
item.curSet(c); renderGcPalette(item);
}, { placeholder: '#ffd6e0' });
});
strip.appendChild(hexBtn);
paletteHost.appendChild(strip);
const tip = document.createElement('div');
tip.style.cssText = 'font-size:10.5px;color:var(--muted,#999);margin-top:5px';
tip.textContent = '正在调「' + item.label + '」，点色块即时生效';
paletteHost.appendChild(tip);
};
const mkGrid = (items) => {
const grid = document.createElement('div');
grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
items.forEach(el => grid.appendChild(el));
return grid;
};
const mkNote = (txt) => {
const n = document.createElement('div');
n.style.cssText = 'font-size:10.5px;color:var(--muted,#999);line-height:1.5';
n.textContent = txt;
return n;
};
const mkAct = (label, fn) => {
const b = document.createElement('button');
b.type = 'button'; b.textContent = label;
b.style.cssText = 'padding:8px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;cursor:pointer';
b.addEventListener('click', fn);
return b;
};
const page = document.getElementById('page-group-chat');
const SECS = [
{ key: 'bubble', label: '气泡', build: () => {
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
wrap.appendChild(mkGrid([
mkColorItem('我的气泡色', 'out-bg', '#111111', GC_BUBBLE_BG),
mkColorItem('我的文字色', 'out-ink', '#ffffff', gcInkSwatches()),
mkColorItem('联系人气泡色', 'in-bg', '#ffffff', GC_BUBBLE_BG),
mkColorItem('联系人文字色', 'in-ink', '#111111', gcInkSwatches())
]));
paletteHost = document.createElement('div');
wrap.appendChild(paletteHost);
wrap.appendChild(mkSlider('气泡透明度', () => gcBeautyGet('bubble-op'), v => gcBeautySet('bubble-op', v), 0, 100, 1, '%', (n) => gcApplyBubbleSurfaceWith(n)));
wrap.appendChild(mkSlider('气泡圆角', () => parseInt(gcBeautyGet('bubble-radius'), 10) || 0, v => gcBeautySet('bubble-radius', v + 'px'), 0, 40, 1, 'px', (n) => { if (page) page.style.setProperty('--chat-bubble-radius', n + 'px'); }));
wrap.appendChild(mkPills('气泡字号', GC_FONT_SIZES, () => gcBeautyGet('font-size'), v => gcBeautySet('font-size', v)));
wrap.appendChild(mkPills('气泡框大小', GC_BUBBLE_SIZES, () => gcBeautyGet('bubble-size'), v => gcBeautySet('bubble-size', v)));
wrap.appendChild(mkPills('头像形状', [{ label: '圆形', value: 'circle' }, { label: '方形', value: 'square' }], () => gcBeautyGet('av-shape'), v => gcBeautySet('av-shape', v)));
wrap.appendChild(mkPills('时间轴样式', GC_BEAUTY_STYLES, () => gcBeautyGet('time-style'), v => gcBeautySet('time-style', v)));
return wrap;
} },
{ key: 'bar', label: '栏位', build: () => {
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
wrap.appendChild(mkSlider('顶栏不透明度', () => gcBeautyGet('head-op'), v => gcBeautySet('head-op', v), 0, 100, 1, '%', (n) => { if (page) page.style.setProperty('--cs-head-opacity', String(n / 100)); }));
wrap.appendChild(mkSlider('底栏不透明度', () => gcBeautyGet('input-op'), v => gcBeautySet('input-op', v), 0, 100, 1, '%', (n) => { if (page) page.style.setProperty('--cs-input-opacity', String(n / 100)); }));
wrap.appendChild(mkSlider('顶栏下移', () => gcBeautyGet('head-inset'), v => gcBeautySet('head-inset', v), 0, 80, 1, 'px', (n) => { if (page) page.style.setProperty('--cs-head-inset', n + 'px'); }));
wrap.appendChild(mkSlider('底栏上移', () => gcBeautyGet('input-inset'), v => gcBeautySet('input-inset', v), 0, 80, 1, 'px', (n) => { if (page) page.style.setProperty('--cs-input-inset', n + 'px'); }));
wrap.appendChild(mkGrid([
mkColorItem('发送按钮色', 'send-bg', '#111111', GC_SEND_BG),
mkColorItem('发送文字色', 'send-ink', '#ffffff', GC_INK_COLORS),
mkColorItem('正在输入颜色', 'typing-ink', '#8a8a8a', GC_INK_COLORS),
mkColorItem('时间轴颜色', 'time-ink', '#111111', GC_INK_COLORS)
]));
paletteHost = null;
wrap.appendChild(mkNote('不透明度 0% 全透明、100% 不透明，文字按钮不变淡；「顶栏下移/底栏上移」拖着就能把栏位上下挪位，按需微调（双击滑杆回默认），只作用于群聊页。'));
return wrap;
} },
{ key: 'type', label: '字体 · 其他', build: () => {
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
const finp = document.createElement('input');
finp.type = 'text'; finp.className = 'tc-input';
finp.placeholder = '字体名，如 Microsoft YaHei（清空＝恢复默认）';
const fv = gcBeautyGet('font');
if (fv && fv.indexOf('data:') !== 0 && fv.indexOf('http') !== 0) finp.value = fv;
finp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)';
finp.addEventListener('input', () => { gcBeautySet('font', (finp.value || '').trim()); });
wrap.appendChild(mkNote('群聊字体（边打边看，清空输入框即恢复默认）'));
wrap.appendChild(finp);
wrap.appendChild(mkAct('上传字体文件（ttf / otf / woff / woff2）', () => {
window.mochiFilePick({
id: 'mochi-gc-font-pick', accept: '.ttf,.otf,.woff,.woff2',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到字体文件，请再选一次'); return; }
toast('正在读取字体文件…');
const reader = new FileReader();
reader.onload = () => { gcBeautySet('font', reader.result); toast('字体已应用到群聊页'); };
reader.onerror = () => { toast('字体文件读取失败，请重试'); };
reader.readAsDataURL(f);
}
});
}));
const ta = document.createElement('textarea');
ta.className = 'tc-input'; ta.rows = 3;
ta.placeholder = '气泡 CSS，如 border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.12)';
ta.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:12.5px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111);resize:vertical';
try { ta.value = gcBeautyGet('css') || ''; } catch (e) {}
let cssTimer = null;
ta.addEventListener('input', () => {
clearTimeout(cssTimer);
cssTimer = setTimeout(() => {
const el = ta;
let v = '';
try { v = el.value || ''; } catch (e) {}
if (!String(v).trim()) {
try {
const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box'));
const t = box ? (box.innerText || box.textContent || '') : '';
if (String(t).trim()) v = String(t);
} catch (e) {}
}
gcBeautySet('css', String(v).trim());
}, 160);
});
wrap.appendChild(mkNote('气泡 CSS（边写边套用，只对群聊页生效）'));
wrap.appendChild(ta);
wrap.appendChild(mkAct('换群聊壁纸 / 清空壁纸', () => {
hideGcBeautyDrawer();
setTimeout(() => {
if (gcBeautyGet('bg')) { gcBeautySet('bg', ''); toast('已恢复默认壁纸'); }
else pickGcWallpaper();
}, 0);
}));
wrap.appendChild(mkNote('想逐项精调（含美化方案保存/导出等）回群聊设置→美化，点对应一行即可。'));
return wrap;
} }
];
const paintGcChips = (key) => {
Array.prototype.forEach.call(chipsRow.children, c => {
const on = c.dataset.sec === key;
const bg = on ? 'var(--ink,#111)' : 'var(--btn-cancel-bg,#fafafa)';
if (c.style.background !== bg) c.style.background = bg;
const fg = on ? 'var(--bg-b,#fff)' : 'var(--ink,#111)';
if (c.style.color !== fg) c.style.color = fg;
const bd = on ? 'var(--ink,#111)' : 'var(--card-border,#ddd)';
if (c.style.borderColor !== bd) c.style.borderColor = bd;
});
};
const renderSec = (key) => {
gcDrawerSec = key;
paintGcChips(key);
body.innerHTML = '';
paletteHost = null;
colorItems = [];
const sec = SECS.filter(s => s.key === key)[0];
if (sec) body.appendChild(sec.build());
};
SECS.forEach(s => {
const c = document.createElement('button');
c.type = 'button'; c.textContent = s.label; c.dataset.sec = s.key;
c.style.cssText = 'flex:1;font-size:11.5px;padding:5px 0;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
c.addEventListener('click', () => renderSec(s.key));
chipsRow.appendChild(c);
});
renderSec(gcDrawerSec);
gcDrawerApplyBottom();
d.style.display = 'flex';
}
const GC_SCHEMES_KEY = 'gc-beauty-schemes';
const GC_BEAUTY_KEYS = [
'bg', 'css', 'font', 'font-size', 'bubble-size', 'bubble-radius',
'av-shape', 'time-style', 'time-ink', 'typing-ink',
'bubble-op', 'head-op', 'input-op', 'head-inset', 'input-inset',
'out-bg', 'out-ink', 'in-bg', 'in-ink', 'send-bg', 'send-ink', 'send-show'
];
const gcSchemesStore = () => { try { return gcProfileStore(); } catch (e) { return null; } };
const getGcSchemes = () => {
try { const s = gcSchemesStore(); const a = JSON.parse((s && s.get(GC_SCHEMES_KEY)) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
};
const saveGcSchemesList = (arr) => { try { const s = gcSchemesStore(); if (s) s.set(GC_SCHEMES_KEY, JSON.stringify(arr)); } catch (e) {} };
const GC_SCHEME_WARN_LEN = 2 * 1024 * 1024; // 方案总占用 ≥2MB 提醒清理
const GC_SCHEME_WARN_CNT = 10;              // 方案个数 ≥10 提醒清理
const gcPrettyKb = (len) => {
const kb = (len || 0) * 3 / 4 / 1024;
return kb >= 1024 ? (Math.round(kb / 102.4) / 10) + ' MB' : Math.max(1, Math.round(kb)) + ' KB';
};
const collectGcBeauty = () => {
const data = {};
GC_BEAUTY_KEYS.forEach(k => { const v = gcBeautyGet(k); if (v !== '' && v !== null && v !== undefined) data[k] = v; });
return data;
};
const applyGcBeautyData = (data) => {
GC_BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined) try { gcBeautySet(k, data[k]); } catch (e) {} });
};
window.collectGcBeauty = collectGcBeauty;
window.applyGcBeautyData = applyGcBeautyData;
function gcSchemeModalEl() {
let m = document.getElementById('gc-beauty-scheme-manager');
if (!m) {
m = document.createElement('div'); m.id = 'gc-beauty-scheme-manager'; m.hidden = true;
m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
document.body.appendChild(m);
m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
}
return m;
}
function hideGcSchemeModal(m) { if (m) { m.style.display = 'none'; m.hidden = true; } }
function applyGcScheme(idx, m) {
const s = getGcSchemes()[idx];
if (!s || !window.openModal) return;
const ctl = window.openModal('应用方案「' + s.name + '」？', '', (v) => {
if (v !== 'ok') return;
GC_BEAUTY_KEYS.forEach(k => { if (!(s.data && s.data[k] !== undefined)) { try { gcBeautySet(k, ''); } catch (e) {} } });
applyGcBeautyData(s.data || {});
try {
gcPreviewBackup = null;
const pb = document.getElementById('gc-beauty-preview-bar');
if (pb) pb.style.display = 'none';
} catch (e) {}
hideGcSchemeModal(m);
toast('已应用「' + s.name + '」，群聊立即生效');
}, { noInput: true, staticText: '将覆盖全部联系人桌面的群聊美化设置，立即生效', pills: [{ label: '应用', value: 'ok' }] });
if (ctl && ctl.pills) ctl.pills([{ label: '应用', value: 'ok' }], 'ok');
}
function deleteGcScheme(idx, m) {
const s = getGcSchemes()[idx];
if (!s || !window.openModal) return;
const ctl = window.openModal('删除方案「' + s.name + '」？', '', (v) => {
if (v !== 'ok') return;
const list = getGcSchemes();
list.splice(idx, 1);
saveGcSchemesList(list);
toast('已删除方案');
window.openGcBeautySchemes();
}, { noInput: true, staticText: '删除后不可恢复', pills: [{ label: '删除', value: 'ok' }] });
if (ctl && ctl.pills) ctl.pills([{ label: '删除', value: 'ok' }], 'ok');
}
const gcMkBtn = (label, css, fn) => {
const b = document.createElement('button');
b.textContent = label;
b.style.cssText = css;
b.addEventListener('click', fn);
return b;
};
function gcSchemeThumb(data) {
data = data || {};
const inBg = data['in-bg'] || '#ffffff';
const inInk = data['in-ink'] || '#111111';
const outBg = data['out-bg'] || '#111111';
const outInk = data['out-ink'] || '#ffffff';
const r = (parseInt(data['bubble-radius'] || '18px', 10) || 18) / 2;
const tl = Math.max(0, Math.min(9, Math.round(r)));
const bg = data['bg'] || '';
const hasCss = !!data['css'];
const wall = bg
? '<div style="position:absolute;inset:0;background-image:url(&quot;' + bg + '&quot;);background-size:cover;background-position:center;opacity:.4"></div>'
: '';
const cssChip = hasCss
? '<div style="position:absolute;left:5px;bottom:4px;font-size:9px;color:#fff;background:rgba(0,0,0,.5);padding:1px 5px;border-radius:5px">CSS</div>'
: '';
return '' +
'<div style="position:relative;width:100%;height:64px;border-radius:9px;overflow:hidden;background:#e6e9ee;display:flex;align-items:center;padding:8px 10px;box-sizing:border-box;gap:5px">' +
wall +
'<div style="position:relative;align-self:flex-end;padding:4px 8px;border-radius:' + tl + 'px;font-size:10px;line-height:1.2;color:' + inInk + ';background:' + inBg + ';box-shadow:0 1px 2px rgba(0,0,0,.08);max-width:56%">对方</div>' +
'<div style="margin-left:auto;position:relative;align-self:flex-start;padding:4px 8px;border-radius:' + tl + 'px;font-size:10px;line-height:1.2;color:' + outInk + ';background:' + outBg + ';box-shadow:0 1px 2px rgba(0,0,0,.08);max-width:56%">我的</div>' +
cssChip +
'</div>';
}
function gcBeautySummary(data) {
data = data || {};
const out = [];
const inBg = data['in-bg'], outBg = data['out-bg'];
if (inBg || outBg) out.push('气泡色 ' + (inBg || '默认') + ' / ' + (outBg || '默认'));
const rad = data['bubble-radius'] || '18px';
const rn = GC_BUBBLE_RADII.find(p => p.value === rad);
out.push('圆角 ' + (rn ? rn.label : rad));
const fs = data['font-size'] || '14px';
const fnl = GC_FONT_SIZES.find(p => p.value === fs);
out.push('字号 ' + (fnl ? fnl.label : fs));
if (data['css']) out.push('自定义CSS');
if (data['bg']) out.push('壁纸');
const av = data['av-shape'];
if (av) out.push('头像 ' + (av === 'square' ? '方形' : '圆形'));
return out;
}
function gcSaveModalEl() {
let m = document.getElementById('gc-beauty-save-modal');
if (!m) {
m = document.createElement('div'); m.id = 'gc-beauty-save-modal'; m.hidden = true;
m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
document.body.appendChild(m);
m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
}
return m;
}
window.saveGcBeautyScheme = function () {
const x = gcSaveModalEl();
x.innerHTML = '';
const wrap = document.createElement('div');
wrap.style.cssText = 'box-sizing:border-box;width:min(84vw,340px);max-height:84vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
const hd = document.createElement('div');
hd.style.cssText = 'font-size:15px;font-weight:700;text-align:center;margin-bottom:12px';
hd.textContent = '保存当前为群聊美化方案';
const data = collectGcBeauty();
const pv = document.createElement('div');
pv.innerHTML = gcSchemeThumb(data);
const sub = document.createElement('div');
sub.style.cssText = 'font-size:10.5px;color:var(--muted,#999);margin:8px 0 6px';
sub.textContent = '正在保存的当前设置：';
const sum = document.createElement('div');
sum.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px';
const chips = gcBeautySummary(data);
if (!chips.length) { const e = document.createElement('span'); e.textContent = '以上传壁纸/气泡等设置为主'; e.style.cssText = 'font-size:10.5px;color:var(--muted,#999)'; sum.appendChild(e); }
else chips.forEach(c => { const el = document.createElement('span'); el.textContent = c; el.style.cssText = 'font-size:10.5px;color:var(--muted,#666);background:var(--card-soft,#f2f3f5);border:1px solid var(--card-border,#eee);padding:2px 8px;border-radius:999px'; sum.appendChild(el); });
const warn = data.bg ? document.createElement('div') : null;
if (warn) {
warn.style.cssText = 'font-size:10.5px;line-height:1.55;color:var(--danger-ink,#a32d2d);background:var(--danger-soft,#fff5f5);border:1px solid rgba(163,45,45,.25);border-radius:8px;padding:7px 9px;margin:-6px 0 10px';
warn.textContent = '⚠ 此方案将包含当前壁纸（约 ' + gcPrettyKb(String(data.bg).length) + '）。壁纸最占存储，带壁纸的方案别存太多，否则本地存储和备份文件会被撑爆，建议只留常用的 1～2 个。';
}
const inp = document.createElement('input');
inp.placeholder = '例如：简约白、情侣粉气泡…'; inp.maxLength = 20;
inp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)';
const act = document.createElement('div');
act.style.cssText = 'display:flex;gap:8px;margin-top:13px;justify-content:flex-end';
const cancel = gcMkBtn('取消', 'font-size:12.5px;padding:7px 14px;border:1px solid var(--card-border,#eee);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => { x.style.display = 'none'; x.hidden = true; });
const ok = gcMkBtn('保存方案', 'font-size:12.5px;padding:7px 14px;border:none;border-radius:9px;background:var(--ink,#111);color:#fff', () => {
const name = (inp.value || '').trim();
if (!name) { inp.style.borderColor = '#e05a5a'; return; }
const list = getGcSchemes();
const snap = JSON.stringify(data);
const dup = list.find(it => JSON.stringify(it.data || {}) === snap);
if (dup) { toast('已有内容完全相同的方案「' + dup.name + '」，不用重复保存'); return; }
list.push({ name, time: Date.now(), data });
saveGcSchemesList(list);
x.style.display = 'none'; x.hidden = true;
toast('已保存方案「' + name + '」，所有桌面通用');
const m = document.getElementById('gc-beauty-scheme-manager');
if (m && !m.hidden) window.openGcBeautySchemes();
});
act.appendChild(cancel); act.appendChild(ok);
wrap.appendChild(hd); wrap.appendChild(pv); wrap.appendChild(sub); wrap.appendChild(sum); if (warn) wrap.appendChild(warn); wrap.appendChild(inp); wrap.appendChild(act);
x.appendChild(wrap);
x.style.display = 'flex'; x.hidden = false;
setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
};
let gcPreviewBackup = null;
function gcPreviewBarEl() {
let bar = document.getElementById('gc-beauty-preview-bar');
if (!bar) {
bar = document.createElement('div'); bar.id = 'gc-beauty-preview-bar';
bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:96;margin:12px;padding:12px 14px;background:var(--card-bg,#fff);color:var(--ink,#111);border:1px solid var(--card-border,#eee);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;align-items:center;gap:10px';
document.body.appendChild(bar);
}
return bar;
}
function gcStartPreview(s, m) {
if (!s) return;
gcPreviewBackup = {};
GC_BEAUTY_KEYS.forEach(k => { gcPreviewBackup[k] = gcBeautyStored[k] !== undefined ? gcBeautyStored[k] : ''; });
hideGcSchemeModal(m);
applyGcBeautyData(s.data || {});
const bar = gcPreviewBarEl();
bar.innerHTML = '';
const tx = document.createElement('div'); tx.style.flex = '1'; tx.style.fontSize = '13px';
tx.innerHTML = '正在预览「<b>' + s.name + '</b>」<div style="font-size:11px;color:var(--muted,#999)">去群聊页查看效果，点「使用」保存 / 「还原」恢复</div>';
const re = gcMkBtn('还原', 'font-size:12px;padding:6px 12px;border:1px solid var(--card-border,#eee);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => {
if (gcPreviewBackup) applyGcBeautyData(gcPreviewBackup);
gcPreviewBackup = null; bar.style.display = 'none'; toast('已还原');
});
const keep = gcMkBtn('使用这个方案', 'font-size:12px;padding:6px 12px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => {
gcPreviewBackup = null; bar.style.display = 'none'; toast('已应用「' + s.name + '」');
});
bar.appendChild(tx); bar.appendChild(re); bar.appendChild(keep);
bar.style.display = 'flex';
}
function renameGcScheme(idx, m) {
const list = getGcSchemes();
const s = list[idx];
if (!s || !window.openModal) return;
const ctl = window.openModal('编辑方案名称', s.name, (name) => {
name = (name || '').trim();
if (!name) { ctl.hint('名称不能为空'); ctl.stay(); return; }
s.name = name; saveGcSchemesList(list); toast('已重命名');
window.openGcBeautySchemes();
}, { maxlength: 20, placeholder: '输入方案名称' });
}
function gcSchemeExport() {
const schemes = getGcSchemes();
const doExport = (data) => {
const json = JSON.stringify(data);
if (!window.openModal) { toast('导出失败'); return; }
const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n;
const fname = 'mochi群聊美化方案-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.json';
window.openModal('导出群聊美化方案', '', (v) => {
if (v === 'file') {
if (window.mochiExportFile) { window.mochiExportFile(json, fname, 'mochi群聊美化方案'); return; }
try {
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; a.download = fname;
document.body.appendChild(a); a.click();
setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 1000);
toast('已导出群聊美化方案文件');
} catch (e) { toast('导出文件失败'); }
} else if (v === 'text') {
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(json).then(() => toast('已复制到剪贴板，发给对方粘贴导入')).catch(() => toast('复制失败，请改用导出文件'));
} else { toast('剪贴板不可用，请改用导出文件'); }
}
}, {
noInput: true,
staticText: '选择导出方式：\n· 导出文件：自动弹分享/保存框（iPhone 主屏安装时用这个），不支持时确认后下载\n· 复制文字：复制配置文本，发给对方粘贴导入',
pills: [
{ label: '导出文件', value: 'file' },
{ label: '复制文字', value: 'text' },
],
});
};
if (!schemes.length || !window.openModal) { doExport(collectGcBeauty()); return; }
const pills = [{ label: '当前设置', value: 'current' }]
.concat(schemes.map((s, i) => ({ label: s.name || ('方案' + (i + 1)), value: 'sch_' + i })));
window.openModal('导出群聊美化方案', '', (v) => {
let data;
if (v && v.indexOf('sch_') === 0) {
const i = parseInt(String(v).slice(4), 10);
const s = getGcSchemes()[i];
if (!s) { toast('未找到该方案'); return; }
data = s.data || {};
} else {
data = collectGcBeauty();
}
doExport(data);
}, { noInput: true, staticText: '选择要导出的群聊美化方案：\n· 当前设置：导出当前正在使用的群聊美化\n· 已保存方案：导出对应方案（含气泡/壁纸/字体）', pills: pills });
}
function gcSchemeImport() {
if (!window.openModal) return;
window.openModal('导入群聊美化方案', '', (v) => {
if (!v || !v.trim()) return;
try {
const data = JSON.parse(v.trim());
if (typeof data !== 'object' || Array.isArray(data)) { toast('格式错误'); return; }
applyGcBeautyData(data);
toast('已导入，群聊立即生效');
window.openGcBeautySchemes();
} catch (e) { toast('解析失败，请检查文本'); }
}, { textarea: true, textareaPlaceholder: '粘贴对方导出的群聊美化方案文本，或点下方「从文件导入」选择 .json 文件', txtImport: true });
}
window.openGcBeautySchemes = function () {
const m = gcSchemeModalEl();
m.innerHTML = '';
const box = document.createElement('div');
box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
const head = document.createElement('div');
head.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:4px">群聊美化方案</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">方案在所有联系人桌面通用（含气泡颜色/CSS、背景图、字体、圆角、时间轴等），点「应用」一键切换群聊外观；壁纸最占存储，带壁纸的方案别存太多</div>';
box.appendChild(head);
const list = document.createElement('div');
list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0';
const schemes = getGcSchemes();
let totalLen = 0, wallCnt = 0;
schemes.forEach(s => { totalLen += JSON.stringify(s.data || {}).length; if (s.data && s.data.bg) wallCnt++; });
const stat = document.createElement('div');
stat.style.cssText = 'font-size:11px;color:var(--muted,#999);margin:-6px 0 10px';
stat.textContent = '已存 ' + schemes.length + ' 个方案 · 约占 ' + gcPrettyKb(totalLen) + (wallCnt ? ' · 其中 ' + wallCnt + ' 个含壁纸' : '');
box.appendChild(stat);
if (totalLen >= GC_SCHEME_WARN_LEN || schemes.length >= GC_SCHEME_WARN_CNT) {
const big = document.createElement('div');
big.style.cssText = 'font-size:11.5px;line-height:1.55;color:var(--danger-ink,#a32d2d);background:var(--danger-soft,#fff5f5);border:1px solid rgba(163,45,45,.25);border-radius:8px;padding:7px 10px;margin:-4px 0 10px';
big.textContent = '⚠ 方案偏多或偏大（已约 ' + gcPrettyKb(totalLen) + '），会把本地存储和备份导出文件撑爆。建议删掉不用的方案，或只保留不带壁纸的方案。';
box.appendChild(big);
}
if (!schemes.length) {
const empty = document.createElement('div');
empty.innerHTML = '<div style="font-size:13px;color:var(--muted,#999);text-align:center;padding:20px 0">还没有保存的群聊美化方案<br>先点下方「保存当前为方案」</div>';
list.appendChild(empty);
}
schemes.forEach((s, i) => {
const row = document.createElement('div');
row.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px';
const th = document.createElement('div');
th.innerHTML = gcSchemeThumb(s.data || {});
row.appendChild(th);
const nm = document.createElement('div');
const t = new Date(s.time || Date.now());
const ds = (t.getMonth() + 1) + '-' + t.getDate();
nm.innerHTML = '<div style="font-size:14px;font-weight:600;word-break:break-all">' + s.name + '</div><div style="font-size:11px;color:var(--muted,#999)">保存于 ' + ds + '</div>';
row.appendChild(nm);
const btns = document.createElement('div');
btns.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap';
btns.appendChild(gcMkBtn('预览', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => gcStartPreview(s, m)));
btns.appendChild(gcMkBtn('应用', 'font-size:12px;padding:4px 10px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => applyGcScheme(i, m)));
btns.appendChild(gcMkBtn('改名', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => renameGcScheme(i, m)));
btns.appendChild(gcMkBtn('删除', 'font-size:12px;padding:4px 10px;border:1px solid rgba(163,45,45,.35);border-radius:8px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d)', () => deleteGcScheme(i, m)));
row.appendChild(btns);
list.appendChild(row);
});
box.appendChild(list);
const opera = document.createElement('div');
opera.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
const exBtn = gcMkBtn('导出方案', 'flex:1;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;font-weight:600', () => gcSchemeExport());
const imBtn = gcMkBtn('导入方案', 'flex:1;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;font-weight:600', () => gcSchemeImport());
opera.appendChild(exBtn); opera.appendChild(imBtn);
box.appendChild(opera);
const save = document.createElement('button');
save.textContent = '+ 保存当前为方案';
save.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600';
save.addEventListener('click', () => { window.saveGcBeautyScheme(); });
box.appendChild(save);
const close = document.createElement('button');
close.textContent = '关闭';
close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
close.addEventListener('click', () => hideGcSchemeModal(m));
box.appendChild(close);
m.appendChild(box);
m.style.display = 'flex'; m.hidden = false;
}
if (settingsClose) settingsClose.addEventListener('click', () => { gcSetTab = 'profile'; if (settingsPanel) settingsPanel.hidden = true; });
if (settingsPanel) settingsPanel.addEventListener('click', (e) => { if (e.target === settingsPanel) { gcSetTab = 'profile'; settingsPanel.hidden = true; } });
function renderAtPanel() {
if (!atBody) return;
atBody.innerHTML = '';
getMembers().forEach(m => {
const row = document.createElement('div');
row.className = 'gc-at-item';
const n = memberName(m.id);
row.innerHTML = '<div class="gc-at-av"></div><span>' + escapeHtml(n) + '</span>';
fillAv(row.querySelector('.gc-at-av'), memberAvatar(m.id));
row.addEventListener('click', () => {
if (input) {
const cur = input.innerText;
input.innerText = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + '@' + n + ' ';
input.focus();
try { const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
}
if (atPanel) atPanel.hidden = true;
});
atBody.appendChild(row);
});
}
function gcSettingOn(key) {
try { return window.activeStore().get(key) === '1'; } catch (e) { return false; }
}
function gcGlobalOn(key) {
if (key === 'hide-ta-sticker') {
try { return window.xyStore(G).get(key) === '1'; } catch (e) { return false; }
}
if (key === 'cs-enter-send') { // 回车发送默认开：仅显式 'off' 视为关（与 chat.js 语义一致）
try { return window.activeStore().get(key) !== 'off'; } catch (e) { return true; }
}
try { return window.activeStore().get(key) === '1'; } catch (e) { return false; }
}
function gcGlobalSet(key, en) {
try {
if (key === 'hide-ta-sticker') { window.xyStore(G).set(key, en ? '1' : '0'); return; }
window.activeStore().set(key, key === 'cs-enter-send' ? (en ? 'on' : 'off') : (en ? '1' : '0'));
} catch (e) {}
}
function syncGcInputBtns() {
if (gcMicBtn) gcMicBtn.style.display = gcSettingOn('cs-voice-send') ? '' : 'none';
if (gcContinueBtn) gcContinueBtn.style.display = (gcSettingOn('cs-trigger-bar') || gcCfg()['gc-cs-trigger-bar'] === 1) ? '' : 'none';
if (gcBatchBtn) gcBatchBtn.style.display = gcSettingOn('cs-batch-send') ? '' : 'none';
}
function gcContinueSay() {
const gid = curGid; // FIX 串群 #242：同 scheduleReply 绑定来源群
const members = getMembers();
if (!members.length) return;
const c = gcCfg();
const mentioned = [];
if (input) {
const t = (input.innerText || '').trim();
members.forEach(m => { if (t.indexOf('@' + memberName(m.id)) >= 0) mentioned.push(m.id); });
}
const chosen = mentioned.length
? mentioned.slice()
: members.slice(0, Math.max(1, Math.min(2, members.length))).map(m => m.id);
chosen.forEach((cid, i) => {
const gap = c['gc-cs-normal'] === 1 ? i * (1200 + Math.random() * 1600) : i * 400;
setTimeout(() => memberReply(cid, '', gid, true), gap);
});
if (window.playSfxGc) window.playSfxGc('in'); // #698d：走群聊专属音效（未设置回退单聊）
}
function gcSendVoice(dataUrl, durSec) {
const name = '语音 ' + durSec + '″';
const rec = { side: 'out', text: name + '|||' + dataUrl, type: 'voice', ts: Date.now() };
msgs.push(rec);
saveMsgs();
renderMsg(rec, msgs.length - 1);
followGcBottom(true);
if (window.playSfxGc) window.playSfxGc('out'); // #698d：走群聊专属音效（未设置回退单聊）
scheduleReply('');
}
function gcSendBatch(items) {
(items || []).forEach(it => {
if (!it) return;
if (it.type === 'text') {
const t = (it.text || '').trim();
if (!t) return;
const rec = { side: 'out', text: t, ts: Date.now() };
msgs.push(rec);
saveMsgs();
renderMsg(rec, msgs.length - 1);
} else if (it.type === 'img') {
const rec = { side: 'out', text: it.src, parts: [{ k: 'img', v: it.src, sub: 'image' }], ts: Date.now() };
msgs.push(rec);
saveMsgs();
renderMsg(rec, msgs.length - 1);
} else if (it.type === 'sticker') {
const rec = { side: 'out', type: 'sticker', text: it.src, ts: Date.now() };
msgs.push(rec);
saveMsgs();
renderMsg(rec, msgs.length - 1);
}
});
followGcBottom(true);
if (window.playSfxGc) window.playSfxGc('out'); // #698d：走群聊专属音效（未设置回退单聊）
scheduleReply('');
}
let _gcCsFiredAt = 0;
function gcCsFireContinue() {
const now = Date.now();
if (now - _gcCsFiredAt < 1200) return;
_gcCsFiredAt = now;
gcContinueSay();
}
if (gcContinueBtn) {
gcContinueBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; gcCsFireContinue(); });
gcContinueBtn.addEventListener('click', (e) => { e.stopPropagation(); gcCsFireContinue(); });
}
if (gcMicBtn) gcMicBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (!window.openVoicePanelFor) return;
if (gcMorePanel) { gcMorePanel.hidden = true; gcSetMoreTopbar(false); }
window.openVoicePanelFor(gcSendVoice);
});
if (gcBatchBtn) gcBatchBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (!window.openBatchPanelFor) return;
if (gcMorePanel) { gcMorePanel.hidden = true; gcSetMoreTopbar(false); }
window.openBatchPanelFor(gcSendBatch);
});
syncGcInputBtns();
document.addEventListener('voice-send-changed', syncGcInputBtns);
document.addEventListener('batch-send-changed', syncGcInputBtns);
document.addEventListener('continue-say-changed', syncGcInputBtns);
document.addEventListener('gc-continue-say-changed', syncGcInputBtns);
document.addEventListener('contact-switched', syncGcInputBtns);
function gcSetMoreTopbar(show) {
if (gcMoreAt) gcMoreAt.hidden = !show;
}
if (gcMoreBtn && gcMorePanel) {
gcMoreBtn.addEventListener('click', (e) => {
e.stopPropagation(); // 阻止冒泡到 document（chat.js 有面板外关闭监听，避免 toggle 冲突）
if (gcMorePanel.hidden) {
try { if (window.closeIme) window.closeIme(); } catch (err) {}
try { input.blur(); } catch (err) {}
gcSetMoreTopbar(true);
if (window.setMoreGroupMode) window.setMoreGroupMode(true);
else if (window.applyMoreCat) window.applyMoreCat('tool');
}
gcMorePanel.hidden = !gcMorePanel.hidden;
if (gcMorePanel.hidden) gcSetMoreTopbar(false);
});
gcMorePanel.addEventListener('click', (e) => {
const item = e.target.closest('.more-item');
if (!item) return;
if (gcMoreAt && (item === gcMoreAt || item.contains(gcMoreAt))) return;
const keepInGroup = (item.id === 'more-decide' || item.id === 'more-gdecide');
gcMorePanel.hidden = true;
gcSetMoreTopbar(false);
if (keepInGroup) return;
const chatPage = document.getElementById('page-chat');
if (chatPage && chatPage.hidden) {
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #338 同值写也发 mutation（Blink 实测同值 3 连写=3 条记录），44 页全扫=唤醒全部页面观察器
chatPage.hidden = false;
}
}, true);
}
if (gcMoreAt) gcMoreAt.addEventListener('click', (e) => {
e.stopPropagation();
if (gcMorePanel) gcMorePanel.hidden = true;
gcSetMoreTopbar(false);
renderAtPanel();
if (atPanel) atPanel.hidden = false;
});
if (gcEmojiBtn) gcEmojiBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (!window.openEmojiPanelForInsert) return;
const epEl = document.getElementById('emoji-panel');
if (epEl && !epEl.hidden) { window.closeEmojiPanelForInsert && window.closeEmojiPanelForInsert(); return; }
window.openEmojiPanelForInsert((src, kind) => {
if (kind !== 'text') { sendGcSticker(src); return; }
if (window.textCardDirectMode && window.textCardDirectMode()) { sendGcText(src); return; }
gcInsertTextToInput(src);
}, { allowUrl: true, textModeApplies: true }); // #691i：群聊点卡片行为受模式键支配，面板内保留模式切换按钮
document.body.classList.remove('mail-emoji-mode');
});
let gcImgInput = null;
function gcImgPicker() {
if (gcImgInput) {
try { gcImgInput.accept = 'image/*'; } catch (e) {}
return gcImgInput;
}
const fi = document.createElement('input');
fi.type = 'file';
fi.id = 'gc-img-pick'; // 常驻身份（诊断/测试句柄）
fi.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
fi.accept = 'image/*'; fi.multiple = true;
fi.onchange = () => {
const files = Array.prototype.slice.call(fi.files || []);
fi.value = ''; // 允许重选同一张
if (!files.length) { toast('没有取到图片，请再选一次'); return; }
files.forEach(f => {
const reader = new FileReader();
reader.onerror = () => { toast('图片读取失败，请换一张再试'); };
reader.onload = () => {
const img = new Image();
img.onload = () => {
try {
const c = document.createElement('canvas');
const scale = Math.min(1, 720 / Math.max(img.width, img.height));
c.width = Math.max(1, Math.round(img.width * scale));
c.height = Math.max(1, Math.round(img.height * scale));
c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
const out = c.toDataURL('image/jpeg', 0.85);
if (out && out.indexOf('data:image/') === 0 && out.length > 128) gcDraftImgs.push(out);
else gcDraftImgs.push(reader.result);
} catch (err) {
gcDraftImgs.push(reader.result);
}
renderGcDraft();
};
img.onerror = () => {
gcDraftImgs.push(reader.result);
renderGcDraft();
};
img.src = reader.result;
};
reader.readAsDataURL(f);
});
};
document.body.appendChild(fi);
gcImgInput = fi;
if (window.mochiFilePickLabel && gcImgBtn) window.mochiFilePickLabel(gcImgBtn, fi);
if (window.mochiFilePickSurface && gcImgBtn) window.mochiFilePickSurface(gcImgBtn, { id: 'gc-img-tap', accept: 'image/*', multiple: true, owner: fi });
return fi;
}
try { if (window.mochiFilePickSurface && gcImgBtn) window.mochiFilePickSurface(gcImgBtn, { id: 'gc-img-tap', accept: 'image/*', multiple: true, owner: gcImgPicker() }); } catch (err) {}
if (gcImgBtn) gcImgBtn.addEventListener('click', (e) => {
e.stopPropagation();
const fi = gcImgPicker();
try { if (window.mochiFilePickLabel) window.mochiFilePickLabel(gcImgBtn, fi); } catch (err) {}
try { if (window.mochiFilePickSurface) window.mochiFilePickSurface(gcImgBtn, { id: 'gc-img-tap', accept: 'image/*', multiple: true, owner: fi }); } catch (err) {}
var _fb = () => { window.mochiFilePickFire(fi, { onFail: () => toast('无法打开图片选择器，请重试') }); };
if (window.mochiFilePickGuard) window.mochiFilePickGuard(fi, _fb);
else _fb();
});
if (atPanel) atPanel.addEventListener('click', (e) => { if (e.target === atPanel) atPanel.hidden = true; });
const gcMsgActions = document.getElementById('gc-msg-actions');
let gcActiveMsgEl = null;
let gcActiveMsgSnap = null; // FIX 2026-09-13 #407：菜单打开时的消息身份快照（防 msgs 重排后 gcIdx 错位，对齐聊天页）
function closeGcMsgActions() {
if (gcMsgActions && typeof gcMsgActions.__maFollowStop === 'function') { try { gcMsgActions.__maFollowStop(); } catch (e) {} } // FIX 2026-09-16 #642 摘跟随监听
if (gcMsgActions) gcMsgActions.hidden = true;
gcActiveMsgEl = null;
gcActiveMsgSnap = null;
}
function gcQuoteSnapOf(rec) {
let qimgs = (rec.parts || []).filter(p => p.k === 'img').map(p => p.v).slice(0, 3);
if (!qimgs.length && (rec.type === 'sticker' || rec.type === 'image')
&& typeof rec.text === 'string' && rec.text.indexOf('data:') === 0) qimgs.push(rec.text);
let qtext = rec.text;
if (rec.type === 'voice') qtext = '[语音] ' + String(qtext || '').split('|||')[0];
else if (rec.type === 'sticker') qtext = '表情包';
else if (qimgs.length && String(qtext || '').indexOf('data:') === 0) qtext = '图片';
return { text: qtext, imgs: qimgs, idx: msgs.indexOf(rec) };
}
if (body && gcMsgActions) {
function gcOpenMsgActions(item, bk) {
gcActiveMsgEl = item;
const _gi = (item && item.dataset && item.dataset.gcIdx !== undefined) ? Number(item.dataset.gcIdx) : -1;
const _gmk = (item && item.dataset && item.dataset.mk) || '';
let _gr = (_gi >= 0 && msgs[_gi]) ? msgs[_gi] : null;
let _gj = _gi;
if (_gmk) {
_gj = msgs.findIndex(gmkMsg => gcMsgKeyOf(gmkMsg) === _gmk);
if (_gj >= 0) _gr = msgs[_gj]; else _gj = _gi;
}
gcActiveMsgSnap = { idx: _gj, rec: _gr, mk: _gmk, ts: _gr ? (_gr.ts || 0) : 0, side: _gr ? (_gr.side || '') : '', text: _gr ? String(_gr.text || '').slice(0, 80) : '' };
const delBtn = gcMsgActions.querySelector('.ma-del-gc');
if (delBtn) {
let delEn = false;
try { delEn = window.activeStore().get('cs-del-ta-msg') === '1'; } catch (e) {}
const side = item.classList.contains('msg-out') ? 'out' : 'in';
delBtn.hidden = !(delEn && side === 'in');
}
gcMsgActions.hidden = false;
try {
const _gPlace = window.mochiFollowActionBar && window.mochiFollowActionBar(gcMsgActions, bk, closeGcMsgActions);
if (_gPlace) _gPlace();
} catch (err) {}
}
let gcHoldTimer = null;
let gcHoldEl = null;
let gcSuppressClickUntil = 0;
function gcResolveActiveMsg() {
const idx0 = gcActiveMsgEl && gcActiveMsgEl.dataset && gcActiveMsgEl.dataset.gcIdx !== undefined ? Number(gcActiveMsgEl.dataset.gcIdx) : -1;
const snap = gcActiveMsgSnap;
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
function gcActionEligible(t) {
const bk = t.closest('.msg-bubble');
if (!bk) return null;
if (t.closest('.msg-voice-play')) return null;
if (t.closest('.msg-quote')) return null;                 // 引用块点击留给后续跳原消息
const item = bk.closest('.msg');
if (!item || item.classList.contains('msg-poke')) return null; // 拍一拍居中条不弹
if ((bk.textContent || '').indexOf('撤回了一条消息') >= 0) return null; // 撤回提示有专属点击
return { item, bk };
}
let gcHoldX = 0, gcHoldY = 0;   // #480 长按/轻点起始触点
let gcTapStart = null;          // #480 轻点布点（touch 直驱开菜单入口）
body.addEventListener('contextmenu', (e) => {
if (!e.target.closest('.msg-bubble') || e.target.closest('.msg-quote')) return;
e.preventDefault();
const r = gcActionEligible(e.target);
if (!r) return;
gcSuppressClickUntil = Date.now() + 800;
if (gcMsgActions.hidden || gcActiveMsgEl !== r.item) gcOpenMsgActions(r.item, r.bk);
});
body.addEventListener('touchstart', (e) => {
const mt0 = e.touches && e.touches[0];
if (mt0) { gcHoldX = mt0.clientX; gcHoldY = mt0.clientY; }
const r = gcActionEligible(e.target);
if (!r) { gcTapStart = null; return; }
gcTapStart = { x: gcHoldX, y: gcHoldY, t: Date.now(), item: r.item, bk: r.bk };
gcHoldEl = r.item;
gcHoldTimer = setTimeout(() => {
gcHoldTimer = null;
gcSuppressClickUntil = Date.now() + 800; // 松开后抑制随之而来的轻点，防菜单被刚弹即关
if (window.getSelection) { try { const s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (err) {} }
gcOpenMsgActions(gcHoldEl, r.bk);
}, 500);
}, { passive: true });
function endGcHold() { if (gcHoldTimer) { clearTimeout(gcHoldTimer); gcHoldTimer = null; } }
body.addEventListener('touchmove', (e) => {
if ((gcHoldTimer || gcTapStart) && e.touches && e.touches[0]) {
const mt = e.touches[0];
const gmdx = mt.clientX - gcHoldX, gmdy = mt.clientY - gcHoldY;
if (gmdx * gmdx + gmdy * gmdy > 144) { endGcHold(); gcTapStart = null; }
}
}, { passive: true });
body.addEventListener('touchend', (e) => {
endGcHold();
const mt = e.changedTouches && e.changedTouches[0];
if (!gcTapStart || !mt) { gcTapStart = null; return; }
if (Date.now() - gcTapStart.t > 450 || (mt.clientX - gcTapStart.x) * (mt.clientX - gcTapStart.x) + (mt.clientY - gcTapStart.y) * (mt.clientY - gcTapStart.y) > 144) { gcTapStart = null; return; } // 滑动/长按不算轻点
const ts = gcTapStart; gcTapStart = null;
gcSuppressClickUntil = Date.now() + 800; // 吞引擎补发 click，防刚开即关/防重入
if (!gcMsgActions.hidden && gcActiveMsgEl === ts.item) return; // 该气泡菜单已开，不重开
gcOpenMsgActions(ts.item, ts.bk);
});
body.addEventListener('touchcancel', endGcHold);
body.addEventListener('click', (e) => {
if (gcSuppressClickUntil && Date.now() < gcSuppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
const bk = e.target.closest('.msg-bubble');
if (!bk) return;
const item = bk.closest('.msg');
if (!item) return;
if (item.classList.contains('msg-poke')) return;          // 拍一拍居中条不弹
if (e.target.closest('.msg-quote')) return;               // 引用块点击留给后续跳原消息
if ((bk.textContent || '').indexOf('撤回了一条消息') >= 0) return; // 撤回提示有专属点击（查看原文）
e.stopPropagation();
gcOpenMsgActions(item, bk);
});
document.addEventListener('click', (e) => {
if (!gcMsgActions.hidden && !gcMsgActions.contains(e.target)) closeGcMsgActions();
});
let gcMaClickGuard = 0;
function gcRunAction(btn) {
const act = btn.dataset.act;
if (act === 'quote' && gcActiveMsgEl) {
const _ra = gcResolveActiveMsg();
const idx = _ra.idx;
const rec = _ra.rec;
if (rec) {
gcLastQuote = gcQuoteSnapOf(rec);
renderGcDraft();
try { if (input) input.focus(); } catch (err) {}
}
} else if (btn.dataset.act === 'del' && gcActiveMsgEl) {
const _rd = gcResolveActiveMsg(); // FIX 2026-09-13 #407：按身份快照重定位
const idx = _rd.idx;
if (idx >= 0 && msgs[idx] && msgs[idx].side === 'in') {
msgs.splice(idx, 1);
saveMsgs();
renderAll();
toast('已删除该消息');
}
}
closeGcMsgActions();
}
gcMsgActions.addEventListener('click', (e) => {
const btn = e.target.closest('.ma-btn');
if (!btn) return;
if (Date.now() < gcMaClickGuard) return; // #480 touchend 已直驱执行，吞补发 click 防双跑
gcRunAction(btn);
});
gcMsgActions.addEventListener('touchend', (e) => {
const btn = e.target.closest('.ma-btn');
if (!btn || btn.hidden) return;
gcMaClickGuard = Date.now() + 600; // 吞引擎补发 click 防双跑
gcRunAction(btn); // touch 直驱执行——不依赖内核从 touch 合成 click
});
}
const gcPokeCard = document.getElementById('gc-poke-card');
const gcPokeList = document.getElementById('gc-poke-list');
const gcPokeNameEl = document.getElementById('gc-poke-name');
const gcPokeCloseBtn = document.getElementById('gc-poke-close');
let gcPokeCid = null;
const GC_POKE_PRESETS = ['拍了拍你', '戳了戳你的脸蛋', '弹了一下你的额头', '揉了揉你的头发', '捏了捏你的脸颊', '拍了拍你的肩膀'];
function gcPokeActions() {
const out = GC_POKE_PRESETS.slice();
const _pkOk = function (x) {
if (typeof x !== 'string' || !x.trim()) return false;
if (x.indexOf('data:') === 0 || x.indexOf('|||') >= 0 || x.indexOf('@@m:') >= 0) return false;
if (/^https?:\/\//i.test(x)) return false;
return true;
};
try { (window.getPokeCards() || []).forEach(x => { if (_pkOk(x) && out.indexOf(x) < 0) out.push(x); }); } catch (e) {}
[['poke-groups-mine', false], ['poke-user-mine', true]].forEach(([k, flat]) => {
try {
const v = JSON.parse(window.activeStore().get(k) || 'null');
if (flat && Array.isArray(v)) {
v.forEach(x => { if (_pkOk(x) && out.indexOf(x) < 0) out.push(x); });
} else if (Array.isArray(v)) {
v.forEach(g => { if (Array.isArray(g) && Array.isArray(g[1])) g[1].forEach(x => { if (_pkOk(x) && out.indexOf(x) < 0) out.push(x); }); });
}
} catch (e) {}
});
return out;
}
function gcClosePokeCard() { if (gcPokeCard) gcPokeCard.hidden = true; gcPokeCid = null; }
function renderGcPokeList() {
if (!gcPokeList) return;
gcPokeList.innerHTML = '';
const acts = gcPokeActions();
if (!acts.length) { gcPokeList.innerHTML = '<div class="cc-empty">暂无拍一拍文字</div>'; return; }
acts.forEach((a) => {
const d = document.createElement('div');
d.className = 'cc-item glass';
d.innerHTML = '<div class="cc-txt"><div class="t">' + escapeHtml(a) + '</div></div>';
d.addEventListener('click', () => { const cid = gcPokeCid; gcClosePokeCard(); if (cid) gcSendPoke(cid, a); });
gcPokeList.appendChild(d);
});
}
function gcOpenPokeCard(cid) {
if (!gcPokeCard || !gcPokeList) return;
closeGcMsgActions(); // 菜单开着时先收，防双浮层叠着（stopPropagation 会跳过 document 收菜单那条路）
gcPokeCid = cid;
if (gcPokeNameEl) gcPokeNameEl.textContent = memberName(cid);
renderGcPokeList();
gcPokeCard.hidden = false;
try { if (input) input.blur(); } catch (err) {} // 收起键盘，面板不被输入法遮挡（同聊天页 openPokeCard 的 closeIme）
}
if (gcPokeCloseBtn) gcPokeCloseBtn.addEventListener('click', gcClosePokeCard);
document.addEventListener('click', (e) => {
if (gcPokeCard && !gcPokeCard.hidden && !gcPokeCard.contains(e.target)) gcClosePokeCard();
});
function gcPokeTextOf(action, name) {
const me = myName();
if (action.indexOf('你') >= 0) {
if (action.charAt(0) === '你') return me + action.slice(1).replace(/我(?![们])/g, name);
if (action.charAt(0) === '我') return action.replace(/你(?![们])/g, name);
return me + ' ' + action.replace(/你(?![们])/g, name);
}
if (action.indexOf('我') >= 0) {
if (action.charAt(0) === '我') return me + ' ' + action.slice(1).replace(/我(?![们])/g, name);
return me + ' ' + action.replace(/我(?![们])/g, name);
}
return me + ' ' + action;
}
function gcSendPoke(cid, action) {
const name = memberName(cid);
const rec = { side: 'out', text: gcPokeTextOf(action, name), special: 'poke', ts: Date.now() };
msgs.push(rec);
saveMsgs();
renderMsg(rec);
followGcBottom(true);
if (window.playSfxGc) window.playSfxGc('out'); // #698d：走群聊专属音效（未设置回退单聊）
setTimeout(() => { try { memberReply(cid, rec.text, curGid); } catch (err) {} }, 1200 + Math.random() * 1600);
}
let gcSwitchDirty = false;
document.addEventListener('contact-switched', function () {
try { hideTyping(); } catch (e) {}
const pageVisible = page && !page.hidden;
if (pageVisible) {
updateGroupName();
renderAll();
try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
try { if (groupsPanel && !groupsPanel.hidden) renderGroupsPanel(); } catch (e) {}
gcSwitchDirty = false;
} else {
gcSwitchDirty = true; // 隐藏态挂起：enterGroupChat 全量重建兜底（防未来入口绕过）
}
});
window.groupChatGetMsgs = function () { return msgs.slice(); };
window.groupChatClear = function () { msgs = []; saveNow(); renderAll(); };
window.groupChatGetGroups = function () {
try { return JSON.parse(JSON.stringify(groups)); } catch (e) { return []; }
};
window.groupChatGetCurGroup = function () {
try { const g = currentGroup(); return g ? JSON.parse(JSON.stringify(g)) : null; } catch (e) { return null; }
};
window.groupChatProfileGet = function (key) { try { return JSON.parse(JSON.stringify(gcProfileGet(key))); } catch (e) { return {}; } };
window.groupChatProfileSet = function (key, name, avatar) { gcProfileSet(key, name, avatar); };
window.groupChatBeautyGet = function (k) { return gcBeautyGet(k); };
window.groupChatBeautySet = function (k, v) { gcBeautySet(k, v); };
window.groupChatPoolFor = function (cid) {
try { return JSON.parse(JSON.stringify(gcPool(cid))); } catch (e) { return null; }
};
window.__cardSearchFns = window.__cardSearchFns || [];
window.__cardSearchFns.push({ name: '群聊系统回应', fn: function (kw) {
const out = [];
try { FALLBACK_REPLIES.forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: '兜底回复' }); }); } catch (e) {}
return out;
} });
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("group-chat.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("group-chat.js"); try { console.error("[JS] group-chat.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[group-chat.js] " + String(__e && __e.message || __e)); } })();