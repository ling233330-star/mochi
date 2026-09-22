(function () { try {
(function () {
const uid = window.activePrefix();
const store = window.activeStore();
const root = document.documentElement;
const body = document.getElementById('chat-body');
if (!body) return;
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
const chatPage = document.getElementById('page-chat');
const setVar = (el, name, value) => { if (!el) return; const v = String(value); if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };
const delVar = (el, name) => { if (el && el.style.getPropertyValue(name) !== '') el.style.removeProperty(name); };
function csBgLayer() {
if (!chatPage) return null;
let l = document.getElementById('cs-bg-layer');
if (!l) {
l = document.createElement('div');
l.id = 'cs-bg-layer';
l.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:none;';
chatPage.insertBefore(l, chatPage.firstChild);
}
return l;
}
function csBgFitCss(fit) {
if (fit === 'stretch') return '100% 100%';
if (fit === 'tile') return '33.333% auto';
if (fit === 'contain') return 'contain';
return 'cover'; // 'fill' / 未知值 ⇒ 铺满裁剪（#731 设计原意）
}
const CS_BG_GLIST = 'cs-bg-glist';
const CS_BG_MAX = 12; // 图库容量上限（每张压缩后可达 MB 级，防无上限堆爆 IDB）
const csBgList = () => {
try { const v = JSON.parse(store.get(CS_BG_GLIST) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
};
const csBgSaveList = (arr) => store.set(CS_BG_GLIST, JSON.stringify(arr));
const CS_BG_ACTIVE = 'cs-bg-active-id';
const csBgActiveId = () => store.get(CS_BG_ACTIVE) || '';
function csBgReconcileActive() {
const list = csBgList();
const cur = store.get('cs-bg');
if (!cur) { if (csBgActiveId()) store.remove(CS_BG_ACTIVE); return ''; }
const aid = csBgActiveId();
if (aid && list.indexOf(aid) >= 0 && store.get('cs-bg-item-' + aid) === cur) return aid;
for (let i = 0; i < list.length; i++) {
if (store.get('cs-bg-item-' + list[i]) === cur) { store.set(CS_BG_ACTIVE, list[i]); return list[i]; }
}
return '';
}
const FONT_SIZES = [
{ label: '小', value: '13px' },
{ label: '标准', value: '14px' },
{ label: '大', value: '16px' },
{ label: '特大', value: '18px' }
];
const BUBBLE_SIZES = [
{ label: '紧凑', value: '8px 10px' },
{ label: '标准', value: '11px 14px' },
{ label: '宽松', value: '14px 18px' }
];
const FONT_SIZE_MIN = 11, FONT_SIZE_MAX = 30, FONT_SIZE_DEFAULT = 14;
function clampFontSize(raw) {
const n = parseInt(raw, 10);
return Number.isFinite(n) ? Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, n)) : FONT_SIZE_DEFAULT;
}
const BUBBLE_LR_MIN = 6, BUBBLE_LR_MAX = 24, BUBBLE_LR_DEFAULT = 14, BUBBLE_PAD_RATIO = 0.78;
const BUBBLE_PAD_DEFAULT = '11px 14px';
function normBubblePad(raw) {
const nums = String(raw === null || raw === undefined ? '' : raw).match(/\d+(?:\.\d+)?/g);
if (!nums || nums.length < 2) return BUBBLE_PAD_DEFAULT;
const px = (v) => Math.max(0, Math.min(30, Math.round(Number(v)))) + 'px';
return px(nums[0]) + ' ' + px(nums[1]);
}
function clampBubbleLr(raw) {
const nums = String(raw === null || raw === undefined ? '' : raw).match(/\d+(?:\.\d+)?/g);
const n = parseInt(nums && nums.length >= 2 ? nums[1] : raw, 10);
return Number.isFinite(n) ? Math.max(BUBBLE_LR_MIN, Math.min(BUBBLE_LR_MAX, n)) : BUBBLE_LR_DEFAULT;
}
function bubblePadFromLr(lr) { return Math.round(clampBubbleLr(lr) * BUBBLE_PAD_RATIO) + 'px ' + clampBubbleLr(lr) + 'px'; }
const BUBBLE_RADII = [
{ label: '小圆角', value: '6px' },
{ label: '标准', value: '12px' },
{ label: '大圆角', value: '18px' },
{ label: '特圆', value: '28px' }
];
const BUBBLE_RADIUS_DEFAULT = '18px';
const TIME_STYLES = [
{ label: '头像下方', value: 'under-av' },
{ label: '气泡下方', value: 'under-bubble' },
{ label: '时间气泡', value: 'bubble' },
{ label: '气泡外侧悬浮', value: 'float' },
{ label: '消息上方居中', value: 'center' },
{ label: '时间分隔线', value: 'divider' },
{ label: '隐藏', value: 'hidden' }
];
function themeDefaults() {
const dark = document.documentElement.getAttribute('data-theme') === 'dark';
return dark
? { inBg: '#2a2a2a', inInk: '#f0f0f0', outBg: '#3a3a3a', outInk: '#ffffff', timeInk: '#8a8a8a', sendBg: '#f0f0f0', sendInk: '#111111' }
: { inBg: '#ffffff', inInk: '#111111', outBg: '#111111', outInk: '#ffffff', timeInk: '#111111', sendBg: '#111111', sendInk: '#ffffff' };
}
function _csHexRgb(h) {
if (!h || typeof h !== 'string') return null;
var s = h.trim(); if (s.charAt(0) === '#') s = s.slice(1);
if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
if (s.length !== 6) return null;
var n = parseInt(s, 16); if (isNaN(n)) return null;
return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _csRelLum(rgb) {
if (!rgb) return 0;
function ch(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
}
function _csContrast(c1, c2) {
var l1 = _csRelLum(_csHexRgb(c1)), l2 = _csRelLum(_csHexRgb(c2));
if (l1 === 0 && l2 === 0) return 0;
return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function _csHiInk(bg) {
var rgb = _csHexRgb(bg); return (rgb && _csRelLum(rgb) < 0.5) ? '#ffffff' : '#111111';
}
function _ensureBubbleContrast() {
var fix = document.getElementById('cs-contrast-fix'), rules = [];
var ob = root.style.getPropertyValue('--msg-out-bg') || '#111111';
var oi = root.style.getPropertyValue('--msg-out-ink') || '#ffffff';
if (_csContrast(oi, ob) < 1.5) rules.push('#page-chat .msg-out .msg-bubble.msg-bubble,#page-fav .msg-out .msg-bubble.msg-bubble{color:' + _csHiInk(ob) + '!important}');
var ib = root.style.getPropertyValue('--msg-in-bg') || '#ffffff';
var ii = root.style.getPropertyValue('--msg-in-ink') || '#111111';
if (_csContrast(ii, ib) < 1.5) rules.push('#page-chat .msg-in .msg-bubble.msg-bubble,#page-fav .msg-in .msg-bubble.msg-bubble{color:' + _csHiInk(ib) + '!important}');
if (rules.length) {
if (!fix) { fix = document.createElement('style'); fix.id = 'cs-contrast-fix'; document.head.appendChild(fix); }
const css = rules.join('\n');
if (fix.textContent !== css) fix.textContent = css;
} else if (fix) fix.remove();
}
const CHAT_SURFACE_SETTINGS = [
{ key: 'cs-head-opacity', label: '顶部栏不透明度', def: 92, max: 100, unit: '%' },
{ key: 'cs-input-opacity', label: '底部输入栏不透明度', def: 92, max: 100, unit: '%' },
{ key: 'cs-bubble-opacity', label: '气泡底色不透明度', def: 100, max: 100, unit: '%' },
{ key: 'cs-head-inset', label: '顶部栏上下移动', def: 0, max: 80, min: -80, unit: 'px', posHint: '正值下移、负值上移' },
{ key: 'cs-input-inset', label: '底部栏上下移动', def: 0, max: 80, min: -80, unit: 'px', posHint: '正值上移、负值下移' }
];
const CS_BG_FITS = [
{ label: '铺满裁剪', value: 'fill' },
{ label: '完整显示', value: 'contain' },
{ label: '平铺', value: 'tile' },
{ label: '拉伸填满', value: 'stretch' }
];
const CS_BG_FIT_DEFAULT = 'fill';
const csBgFit = () => {
const v = store.get('cs-bg-fit');
return CS_BG_FITS.some(f => f.value === v) ? v : CS_BG_FIT_DEFAULT;
};
const CS_BG_ADJ = { x: 50, y: 50, s: 100 };
const CS_BG_ADJ_KEYS = ['cs-bg-pos-x', 'cs-bg-pos-y', 'cs-bg-size'];
const csBgAdjNum = (raw, def, min, max) => {
if (raw === null || raw === undefined || raw === '') return def;
const n = Number(raw);
return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
};
function csBgAdj() {
const s = store.get('cs-bg-size');
return {
x: csBgAdjNum(store.get('cs-bg-pos-x'), CS_BG_ADJ.x, 0, 100),
y: csBgAdjNum(store.get('cs-bg-pos-y'), CS_BG_ADJ.y, 0, 100),
s: (s && s !== 'cover') ? csBgAdjNum(s, CS_BG_ADJ.s, 100, 300) : CS_BG_ADJ.s
};
}
const csBgStable = { w: 0, h: 0, kbUntil: 0 };
const csBgKbWarm = () => { csBgStable.kbUntil = Date.now() + 700; };
function csBgStableSample() {
if (!chatPage) return;
const phoneEl = document.querySelector('.phone');
if (phoneEl && phoneEl.style.height) { csBgKbWarm(); return; } // mobile-adapt 键盘期内联高＝盒是被压矮的假值
const ae = document.activeElement;
if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) { csBgKbWarm(); return; }
const w = chatPage.clientWidth, h = chatPage.clientHeight;
if (!w || !h) return; // 聊天页 hidden（display:none）时读到的 0 不算数
if (window.innerHeight && h > window.innerHeight + 2) return; // 页面盒不可能高于视口＝瞬时脏读数
if (w !== csBgStable.w) { csBgStable.w = w; csBgStable.h = h; }
else if (h < csBgStable.h && Date.now() < csBgStable.kbUntil) { /* 余温期：这次不回落 */ }
else csBgStable.h = h;
const px = csBgStable.h + 'px';
if (chatPage.style.getPropertyValue('--cs-bg-h') !== px) chatPage.style.setProperty('--cs-bg-h', px);
}
let csBgStableTimer = 0;
let csBgStableBound = false;
function csBgStableOnBlur() { csBgKbWarm(); csBgStableLater(); }
function csBgStableLater() {
if (!csBgStableBound) {
csBgStableBound = true;
if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
window.addEventListener('resize', csBgStableLater);
if (window.visualViewport) window.visualViewport.addEventListener('resize', csBgStableLater);
document.addEventListener('focusout', csBgStableOnBlur);
}
clearTimeout(csBgStableTimer);
csBgStableTimer = setTimeout(csBgStableSample, 320);
}
function applyChatBarInk() {
if (!chatPage) return;
const on = store.get('cs-bg-fullbars') === '1';
const bars = [['--cs-head-opacity', '--cs-head-opacity-ink'], ['--cs-input-opacity', '--cs-input-opacity-ink']];
bars.forEach(function (pair) {
if (on) setVar(chatPage, pair[1], '0');
else delVar(chatPage, pair[1]);
});
}
const surfaceClamp = (item, n) => Math.max(item.min != null ? item.min : 0, Math.min(item.max, Math.round(n)));
const OFFSET_MIN = -40, OFFSET_MAX = 40;
function clampOffset(raw) {
const n = Number(raw);
if (raw === null || raw === undefined || String(raw).trim() === '' || !Number.isFinite(n)) return 0;
return Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, Math.round(n)));
}
function surfaceValue(item) {
const raw = store.get(item.key);
const n = raw === null || raw === undefined || String(raw).trim() === '' ? item.def : Number(raw);
return Number.isFinite(n) ? surfaceClamp(item, n) : item.def;
}
function surfaceArrow(v, posArrow, negArrow) {
return v > 0 ? posArrow + v : v < 0 ? negArrow + (-v) : '0';
}
function barOpacityInk(index) {
if (store.get('cs-bg-fullbars') === '1') return 0;
return surfaceValue(CHAT_SURFACE_SETTINGS[index]);
}
function applyChatSurfaces(inBg, outBg) {
if (!chatPage) return;
const values = CHAT_SURFACE_SETTINGS.map(surfaceValue);
CHAT_SURFACE_SETTINGS.forEach((item, i) => {
const v = item.key === 'cs-head-opacity' ? barOpacityInk(0)
: item.key === 'cs-input-opacity' ? barOpacityInk(1) : values[i];
setVar(chatPage, '--' + item.key, item.unit === '%' ? v / 100 : v + 'px');
});
[['in', inBg], ['out', outBg]].forEach(([side, color]) => {
const rgb = _csHexRgb(color);
setVar(chatPage, '--cs-' + side + '-surface', rgb ? 'rgba(' + rgb.join(',') + ',' + values[2] / 100 + ')' : color);
});
const labels = {
'cs-bar-op-val': '顶 ' + values[0] + '% / 底 ' + values[1] + '%',
'cs-bubble-op-val': values[2] + '% 不透明',
'cs-bar-pos-val': '顶 ' + surfaceArrow(values[3], '↓', '↑') + ' / 底 ' + surfaceArrow(values[4], '↑', '↓') + 'px',
'cs-typing-ink-val': store.get('cs-typing-ink') || '#8a8a8a'
};
Object.keys(labels).forEach(id => { const el = document.getElementById(id); if (el && el.textContent !== labels[id]) el.textContent = labels[id]; });
}
function applySettings() {
const set = (id, v) => { const el = document.getElementById(id); const s = String(v); if (el && el.textContent !== s) el.textContent = s; };
const DEF = themeDefaults();
const inBg = store.get('cs-in-bg') || DEF.inBg;
const inInk = store.get('cs-in-ink') || DEF.inInk;
const outBg = store.get('cs-out-bg') || DEF.outBg;
const outInk = store.get('cs-out-ink') || DEF.outInk;
const fs = clampFontSize(store.get('cs-font-size')) + 'px';
const pad = normBubblePad(store.get('cs-bubble-size'));
setVar(root, '--msg-in-bg', inBg);
setVar(root, '--msg-in-ink', inInk);
setVar(root, '--msg-out-bg', outBg);
setVar(root, '--msg-out-ink', outInk);
setVar(root, '--chat-font-size', fs);
setVar(root, '--chat-bubble-pad', pad);
const rad = store.get('cs-bubble-radius') || BUBBLE_RADIUS_DEFAULT;
setVar(root, '--chat-bubble-radius', rad);
const timeInk = store.get('cs-time-ink') || DEF.timeInk;
setVar(root, '--msg-time-ink', timeInk);
const markDX = clampOffset(store.get('cs-mark-x'));
const markDY = clampOffset(store.get('cs-mark-y'));
setVar(root, '--msg-mark-x', markDX + 'px');
setVar(root, '--msg-mark-y', markDY + 'px');
const timeDX = clampOffset(store.get('cs-time-x'));
const timeDY = clampOffset(store.get('cs-time-y'));
setVar(root, '--msg-time-dx', timeDX + 'px');
setVar(root, '--msg-time-dy', timeDY + 'px');
const typingInk = store.get('cs-typing-ink') || '#8a8a8a';
setVar(root, '--typing-ink', typingInk);
const sendBg = store.get('cs-send-bg') || DEF.sendBg;
setVar(root, '--send-bg', sendBg);
const sendInk = store.get('cs-send-ink') || DEF.sendInk;
setVar(root, '--send-ink', sendInk);
const sendShow = store.get('cs-send-show') || 'show';
const sendBtn = document.getElementById('chat-send');
if (sendBtn) { const wantDisp = sendShow === 'hide' ? 'none' : ''; if (sendBtn.style.display !== wantDisp) sendBtn.style.display = wantDisp; }
set('cs-send-bg-val', sendBg === DEF.sendBg ? '默认 ' + DEF.sendBg : sendBg);
set('cs-send-ink-val', sendInk === DEF.sendInk ? '默认 ' + DEF.sendInk : sendInk);
set('cs-out-bg-val', outBg === DEF.outBg ? '默认 ' + DEF.outBg : outBg);
set('cs-out-ink-val', outInk === DEF.outInk ? '默认 ' + DEF.outInk : outInk);
set('cs-in-bg-val', inBg === DEF.inBg ? '默认 ' + DEF.inBg : inBg);
set('cs-in-ink-val', inInk === DEF.inInk ? '默认 ' + DEF.inInk : inInk);
const avShape = store.get('cs-av-shape') || 'circle';
setVar(root, '--msg-av-radius', avShape === 'square' ? '10px' : '50%');
set('cs-av-shape-val', avShape === 'square' ? '方形' : '圆形');
const ts = store.get('cs-time-style') || 'under-av';
const tsLabel = (TIME_STYLES.find(s => s.value === ts) || {}).label || '头像下方';
const wantTimeCls = ts === 'under-av' ? '' : 'cs-time-' + ts;
let curTimeCls = '';
for (let ti = 0; ti < TIME_STYLES.length; ti++) {
const tc = 'cs-time-' + TIME_STYLES[ti].value;
if (document.body.classList.contains(tc)) { curTimeCls = tc; break; }
}
if (curTimeCls !== wantTimeCls) {
TIME_STYLES.forEach(s => document.body.classList.remove('cs-time-' + s.value));
if (wantTimeCls) document.body.classList.add(wantTimeCls);
}
set('cs-time-style-val', tsLabel);
const fmtOff = (x, y) => (x === 0 && y === 0) ? '默认' : '左右 ' + x + ' / 上下 ' + y + 'px';
set('cs-mark-pos-val', fmtOff(markDX, markDY));
set('cs-time-pos-val', fmtOff(timeDX, timeDY));
let bg = store.get('cs-bg');
if (bg && typeof bg === 'string' && bg.length > 6 * 1024 * 1024) {
try { store.remove('cs-bg'); } catch (e) {}
bg = null;
}
const bgLayer = csBgLayer();
if (bg && bgLayer) {
const fit = csBgFit();
const adj = csBgAdj();
const url = 'url("' + bg + '")';
if (bgLayer.style.backgroundImage !== url) bgLayer.style.backgroundImage = url;
const szWanted = adj.s === 100 ? csBgFitCss(fit) : adj.s + '%';
const psWanted = adj.x + '% ' + adj.y + '%';
if (bgLayer.style.backgroundSize !== szWanted) bgLayer.style.backgroundSize = szWanted;
const rpWanted = fit === 'tile' ? 'repeat' : 'no-repeat';
if (bgLayer.style.backgroundRepeat !== rpWanted) bgLayer.style.backgroundRepeat = rpWanted;
if (bgLayer.style.backgroundPosition !== psWanted) bgLayer.style.backgroundPosition = psWanted;
if (bgLayer.style.display !== 'block') bgLayer.style.display = 'block';
chatPage.classList.toggle('cs-bg-on', true);
chatPage.classList.toggle('cs-bg-fill', fit === 'fill');
csBgStableLater();
} else {
if (bgLayer) {
if (bgLayer.style.display !== 'none') bgLayer.style.display = 'none';
if (bgLayer.style.backgroundImage) bgLayer.style.backgroundImage = '';
}
if (chatPage) {
if (chatPage.classList.contains('cs-bg-fill')) chatPage.classList.remove('cs-bg-fill');
if (chatPage.classList.contains('cs-bg-on')) chatPage.classList.remove('cs-bg-on');
if (chatPage.style.backgroundImage) {
chatPage.style.backgroundImage = '';
chatPage.style.backgroundSize = '';
chatPage.style.backgroundRepeat = '';
chatPage.style.backgroundPosition = '';
}
}
}
set('cs-font-size-val', fs);
const pn = BUBBLE_SIZES.find(p => p.value === pad);
set('cs-bubble-size-val', pn ? pn.label : pad);
const rn = BUBBLE_RADII.find(p => p.value === rad);
set('cs-bubble-radius-val', rn ? rn.label : (rad === '0px' ? '方形' : rad));
set('cs-bg-val', bg ? '已设置' : '');
try { const gl = csBgList(); if (gl.length) set('cs-bg-val', '已设置 · 库 ' + gl.length + ' 张'); } catch (e) {}
const fitItem = CS_BG_FITS.filter(f => f.value === csBgFit())[0] || CS_BG_FITS[0];
set('cs-bg-fit-val', bg ? fitItem.label : '上传壁纸后生效');
{
const a = csBgAdj();
set('cs-bg-adjust-val', (a.x === 50 && a.y === 50 && a.s === 100) ? '居中 · 默认'
: '水平 ' + a.x + '% · 垂直 ' + a.y + '% · 缩放 ' + a.s + '%');
}
set('cs-bg-fullbars-val', store.get('cs-bg-fullbars') === '1' ? '开 · 栏位透明' : '关 · 栏位盖住');
const rm = document.getElementById('cs-bg-remove');
if (rm) rm.hidden = !bg;
_ensureBubbleContrast();
applyChatBarInk();
applyChatSurfaces(inBg, outBg);
try { applyCssEnforce(); } catch (e) {}
}
window.applyChatSettings = applySettings;
window.applyCsCssEnforce = applyCssEnforce; // #732：供抽屉侧滑块即时刷新
applySettings();
try {
new MutationObserver(() => { try { applySettings(); } catch (e) {} })
.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
} catch (e) {}
const row = (id) => document.getElementById(id);
function csBgMakeThumb(dataUrl, maxSide) {
return new Promise((resolve) => {
if (typeof dataUrl !== 'string' || dataUrl.length > 50 * 1024 * 1024) { resolve(null); return; }
const img = new Image();
img.onload = () => {
try {
const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
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
function csBgCompress(dataUrl) {
return new Promise((resolve) => {
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
resolve(c.toDataURL('image/jpeg', 0.85));
} catch (e) { resolve(null); }
};
img.onerror = () => resolve(null);
img.src = dataUrl;
});
}
async function csBgAdd(dataRaw) {
const data = await csBgCompress(dataRaw);
if (!data) return null;
const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const list = csBgList();
if (list.length >= CS_BG_MAX) { toast('图库已满（' + CS_BG_MAX + ' 张），请先在列表里删除几张'); return null; }
list.push(id);
csBgSaveList(list);
store.set('cs-bg-item-' + id, data);
csBgMakeThumb(data, 240).then(th => { if (th) store.set('cs-bg-item-thb-' + id, th); });
store.set('cs-bg', data);
store.set(CS_BG_ACTIVE, id);
applySettings();
return id;
}
function csBgPickFiles() {
window.mochiFilePick({
id: 'dev-cs-bg-pick',
accept: 'image/*',
multiple: true,
onFiles: (fs) => {
if (!fs.length) return;
let ok = 0;
toast('正在处理 ' + fs.length + ' 张图片…');
let chain = Promise.resolve();
fs.forEach((f) => {
chain = chain.then(() => new Promise((res) => {
const reader = new FileReader();
reader.onload = () => {
csBgAdd(reader.result).then((id) => { if (id) ok++; res(); });
};
reader.onerror = () => res();
reader.readAsDataURL(f);
}));
});
chain.then(() => {
if (ok) { toast('已加入 ' + ok + ' 张壁纸'); }
if (document.getElementById('cs-bg-panel') && document.getElementById('cs-bg-panel').style.display === 'flex') openCsBgPanel();
});
}
});
}
function openCsBgPanel() {
let m = document.getElementById('cs-bg-panel');
if (!m) {
m = document.createElement('div'); m.id = 'cs-bg-panel';
m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
document.body.appendChild(m);
m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
}
m.innerHTML = '';
const box = document.createElement('div');
box.style.cssText = 'width:min(90vw,400px);max-height:82vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
const hd = document.createElement('div');
hd.innerHTML = '<div style="font-size:16px;font-weight:600">聊天壁纸</div><div style="font-size:12px;color:var(--muted,#888);margin-top:4px">可存多张，点缩略图即切换；误删 5 秒内可撤销</div>';
box.appendChild(hd);
const grid = document.createElement('div');
grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0';
const cur = store.get('cs-bg') || '';
const aid = csBgReconcileActive();
const list = csBgList();
if (!list.length) {
const empty = document.createElement('div');
empty.style.cssText = 'grid-column:1/-1;font-size:13px;color:var(--muted,#999);text-align:center;padding:24px 0';
empty.textContent = '图库还是空的，点下方「上传新图」加入';
grid.appendChild(empty);
}
list.forEach((id) => {
const cell = document.createElement('div');
cell.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;border:2px solid transparent;cursor:pointer;aspect-ratio:9/16;background:var(--bg-b,#f2f2f2)';
const thb = store.get('cs-bg-item-thb-' + id);
const isActive = id === aid;
if (isActive) cell.style.borderColor = 'var(--btn-bg,#111)';
const im = document.createElement('img');
im.alt = '';
im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
if (thb) { im.src = thb; }
else {
const full = store.get('cs-bg-item-' + id);
im.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
cell.style.background = 'var(--muted,#888)';
if (full) csBgMakeThumb(full, 240).then((th) => { if (th) { store.set('cs-bg-item-thb-' + id, th); im.src = th; cell.style.background = ''; } });
}
cell.appendChild(im);
cell.addEventListener('click', () => {
const full = store.get('cs-bg-item-' + id);
if (full) { store.set('cs-bg', full); store.set(CS_BG_ACTIVE, id); applySettings(); toast('已切换壁纸'); m.style.display = 'none'; }
});
const del = document.createElement('div');
del.textContent = '×';
del.style.cssText = 'position:absolute;top:2px;right:2px;width:20px;height:20px;line-height:18px;text-align:center;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:14px';
del.addEventListener('click', (e) => {
e.stopPropagation();
const full = store.get('cs-bg-item-' + id);
const thb2 = store.get('cs-bg-item-thb-' + id);
const wasActive = id === aid;
csBgSaveList(csBgList().filter(x => x !== id));
store.remove('cs-bg-item-' + id);
store.remove('cs-bg-item-thb-' + id);
if (wasActive) { store.remove('cs-bg'); applySettings(); }
if (full) {
m.__undoItem = { id, full, thb: thb2, wasActive };
if (m.__undoTimer) clearTimeout(m.__undoTimer);
m.__undoTimer = setTimeout(() => { m.__undoItem = null; if (m.style.display === 'flex') openCsBgPanel(); }, 5000);
}
toast('已删除，5 秒内可撤销');
openCsBgPanel();
});
cell.appendChild(del);
grid.appendChild(cell);
});
box.appendChild(grid);
if (m.__undoItem) {
const strip = document.createElement('div');
strip.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:var(--bg-b,#f6f6f6);margin-bottom:8px';
const st = document.createElement('span'); st.style.cssText = 'flex:1;font-size:12px;color:var(--muted,#888)'; st.textContent = '刚删除了 1 张壁纸，可撤销'; strip.appendChild(st);
const ub = document.createElement('button'); ub.textContent = '撤销'; ub.style.cssText = 'padding:5px 14px;border:none;border-radius:8px;background:var(--ink,#111);color:#fff;font-size:12px;font-weight:600';
ub.addEventListener('click', () => {
const u = m.__undoItem;
m.__undoItem = null;
if (m.__undoTimer) { clearTimeout(m.__undoTimer); m.__undoTimer = null; }
if (u && u.full) {
csBgSaveList(csBgList().concat([u.id]));
store.set('cs-bg-item-' + u.id, u.full);
if (u.thb) store.set('cs-bg-item-thb-' + u.id, u.thb);
if (u.wasActive) { store.set('cs-bg', u.full); store.set(CS_BG_ACTIVE, u.id); applySettings(); }
toast('已撤销删除');
}
openCsBgPanel();
});
strip.appendChild(ub);
box.appendChild(strip);
}
const upBtn = document.createElement('button');
upBtn.textContent = '＋ 上传新图（可多选）';
upBtn.style.cssText = 'width:100%;padding:11px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600;margin-bottom:8px';
upBtn.addEventListener('click', () => { try { csBgPickFiles(); } catch (e) { toast('无法打开相册，请重试'); } });
if (window.mochiFilePickSurface) window.mochiFilePickSurface(upBtn, { id: 'cs-bg-up-tap', accept: 'image/*', multiple: true, owner: 'dev-cs-bg-pick' });
box.appendChild(upBtn);
if (cur) {
const rmBtn = document.createElement('button');
rmBtn.textContent = '清除当前壁纸（图库保留）';
rmBtn.style.cssText = 'width:100%;padding:10px;border:1px solid rgba(163,45,45,.35);border-radius:10px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d);font-size:13px;margin-bottom:8px';
rmBtn.addEventListener('click', () => { store.remove('cs-bg'); store.remove(CS_BG_ACTIVE); applySettings(); toast('已清除，图库里的图还在'); openCsBgPanel(); });
box.appendChild(rmBtn);
}
if (list.length && window.getContacts && window.xyStore && window.openModal) {
const syncBtn = document.createElement('button');
syncBtn.textContent = '把壁纸和图库同步到全部联系人';
syncBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;margin-bottom:8px';
syncBtn.addEventListener('click', () => {
const me = window.getActiveContact ? window.getActiveContact() : 'default';
const others = window.getContacts().filter(c => c.id && c.id !== me);
if (!others.length) { toast('现在只有这一个联系人，无需同步'); return; }
window.openModal('同步到全部联系人', '', (v) => {
if (v !== '__yes__') return;
const fullNow = store.get('cs-bg');
const glist = csBgList();
const aidNow = csBgActiveId();
let n = 0;
others.forEach((c) => {
try {
const st = window.xyStore('xy-home-v2:' + c.id);
glist.forEach((gid) => {
const f = store.get('cs-bg-item-' + gid); if (f) st.set('cs-bg-item-' + gid, f);
const t = store.get('cs-bg-item-thb-' + gid); if (t) st.set('cs-bg-item-thb-' + gid, t);
});
st.set('cs-bg-glist', JSON.stringify(glist));
if (aidNow) st.set('cs-bg-active-id', aidNow); else st.remove('cs-bg-active-id');
if (fullNow) st.set('cs-bg', fullNow); else st.remove('cs-bg');
n++;
} catch (e) {}
});
toast('已同步到 ' + n + ' 个联系人（切到对应桌面即可看到）');
}, { noInput: true, pills: [{ label: '确认同步（覆盖对方的聊天壁纸）', value: '__yes__' }, { label: '取消', value: '__no__' }] });
});
box.appendChild(syncBtn);
}
const closeBtn = document.createElement('button');
closeBtn.textContent = '关闭';
closeBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555);font-size:13px';
closeBtn.addEventListener('click', () => { m.style.display = 'none'; });
box.appendChild(closeBtn);
m.appendChild(box);
m.style.display = 'flex';
}
function csBgOpenGallery() {
if (store.get('cs-bg') && !csBgList().length) {
const seed = store.get('cs-bg');
const id = 'g' + Date.now().toString(36);
csBgSaveList([id]);
store.set('cs-bg-item-' + id, seed);
store.set(CS_BG_ACTIVE, id);
csBgMakeThumb(seed, 240).then(th => { if (th) store.set('cs-bg-item-thb-' + id, th); });
}
openCsBgPanel();
}
const csBg = row('cs-bg-upload');
if (csBg) {
csBg.addEventListener('click', csBgOpenGallery);
}
const csBgRm = row('cs-bg-remove');
if (csBgRm) {
csBgRm.addEventListener('click', () => {
store.remove('cs-bg');
try { store.remove(CS_BG_ACTIVE); } catch (e) {}
applySettings();
});
}
const csBgFitRow = row('cs-bg-fit');
if (csBgFitRow) {
csBgFitRow.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('壁纸铺满方式', '', v => {
if (!CS_BG_FITS.some(f => f.value === v)) return;
try { store.set('cs-bg-fit', v); } catch (e) {}
applySettings();
if (!store.get('cs-bg')) toast('已记住：上传壁纸后就会按这个方式显示');
}, {
noInput: true,
pill: csBgFit(),
pills: CS_BG_FITS.map(f => ({ label: f.label, value: f.value }))
});
});
}
const setCsBgAdj = (patch) => {
const cur = csBgAdj();
const next = {
x: patch.x == null ? cur.x : csBgAdjNum(patch.x, CS_BG_ADJ.x, 0, 100),
y: patch.y == null ? cur.y : csBgAdjNum(patch.y, CS_BG_ADJ.y, 0, 100),
s: patch.s == null ? cur.s : csBgAdjNum(patch.s, CS_BG_ADJ.s, 100, 300)
};
try {
if (next.x === CS_BG_ADJ.x) store.remove('cs-bg-pos-x'); else store.set('cs-bg-pos-x', String(next.x));
if (next.y === CS_BG_ADJ.y) store.remove('cs-bg-pos-y'); else store.set('cs-bg-pos-y', String(next.y));
if (next.s === CS_BG_ADJ.s) store.remove('cs-bg-size'); else store.set('cs-bg-size', String(next.s));
} catch (e) {}
applySettings();
return next;
};
const openCsBgAdjPanel = () => {
if (!store.get('cs-bg')) { toast('先上传聊天壁纸，再调它的位置与缩放'); return; }
let m = document.getElementById('cs-bg-adj-panel');
if (!m) {
m = document.createElement('div');
m.id = 'cs-bg-adj-panel';
m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
document.body.appendChild(m);
}
const a = csBgAdj();
const wrap = document.createElement('div');
wrap.style.cssText = 'width:min(86vw,360px);background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
const hd = document.createElement('div');
hd.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:12px';
hd.textContent = '壁纸位置与缩放';
wrap.appendChild(hd);
const mkAdjSlider = (label, val, min, max, step, on) => {
const r = document.createElement('div');
r.style.cssText = 'margin-bottom:12px';
const lb = document.createElement('div');
lb.style.cssText = 'font-size:12px;color:var(--muted,#888);margin-bottom:4px';
lb.textContent = label;
const line = document.createElement('div');
line.style.cssText = 'display:flex;align-items:center';
const inp = document.createElement('input');
inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step || 1; inp.value = val;
inp.style.cssText = 'flex:1;min-width:0';
const vv = document.createElement('span');
vv.style.cssText = 'font-size:11px;color:var(--muted,#999);margin-left:6px;flex:none;width:44px;text-align:right';
vv.textContent = val + '%';
inp.addEventListener('input', () => { vv.textContent = inp.value + '%'; on(parseInt(inp.value, 10)); });
line.appendChild(inp); line.appendChild(vv);
r.appendChild(lb); r.appendChild(line);
return r;
};
wrap.appendChild(mkAdjSlider('水平位置', a.x, 0, 100, 1, (v) => setCsBgAdj({ x: v })));
wrap.appendChild(mkAdjSlider('垂直位置', a.y, 0, 100, 1, (v) => setCsBgAdj({ y: v })));
wrap.appendChild(mkAdjSlider('缩放', a.s, 100, 300, 5, (v) => setCsBgAdj({ s: v })));
const note = document.createElement('div');
note.style.cssText = 'font-size:11.5px;color:var(--muted,#888);line-height:1.5;margin:2px 0 10px';
note.textContent = '值越大＝看图片越靠右/越靠下的一段；缩放 100% 就是上面的「铺满方式」，拉大后再拖位置。想边看边调：在聊天页拉开美化抽屉的「栏位」区。';
wrap.appendChild(note);
const act = document.createElement('div');
act.style.cssText = 'display:flex;gap:8px';
const reset = document.createElement('button');
reset.textContent = '重置';
reset.style.cssText = 'flex:1;padding:9px;border:1px solid var(--card-border,#eee);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)';
reset.addEventListener('click', () => {
try { CS_BG_ADJ_KEYS.forEach((k) => store.remove(k)); } catch (e) {}
applySettings();
m.style.display = 'none';
toast('已重置为居中铺满');
});
const okBtn = document.createElement('button');
okBtn.textContent = '完成';
okBtn.style.cssText = 'flex:1;padding:9px;border:none;border-radius:9px;background:var(--ink,#111);color:#fff';
okBtn.addEventListener('click', () => { m.style.display = 'none'; toast('已应用'); });
act.appendChild(reset); act.appendChild(okBtn);
wrap.appendChild(act);
m.innerHTML = '';
m.appendChild(wrap);
m.style.display = 'flex';
};
{
const fitRow = row('cs-bg-fit');
if (fitRow && fitRow.parentNode && !document.getElementById('cs-bg-adjust')) {
const adjRow = document.createElement('div');
adjRow.className = 'set-row';
adjRow.id = 'cs-bg-adjust';
adjRow.innerHTML = '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18" opacity=".55"/><circle cx="12" cy="12" r="3"/></svg></div>'
+ '<div class="txt">壁纸位置与缩放<span class="sub">水平 / 垂直位置（50 = 居中）与缩放比例，仅对上传的壁纸生效</span></div>'
+ '<div class="val" id="cs-bg-adjust-val">居中 · 默认</div>';
adjRow.addEventListener('click', openCsBgAdjPanel);
fitRow.parentNode.insertBefore(adjRow, fitRow.nextSibling);
}
}
const csBgFullbarsRow = row('cs-bg-fullbars');
if (csBgFullbarsRow) {
csBgFullbarsRow.addEventListener('click', () => {
if (!window.openModal) return;
const on = store.get('cs-bg-fullbars') === '1';
window.openModal('壁纸延伸到顶栏 / 输入栏', '', v => {
if (v !== 'on' && v !== 'off') return;
try { store.set('cs-bg-fullbars', v === 'on' ? '1' : '0'); } catch (e) {}
applySettings();
toast(v === 'on' ? '已让开栏位底色：壁纸一直铺到屏幕上下边缘' : '已恢复：顶栏与输入栏照旧盖住壁纸');
}, {
noInput: true,
pill: on ? 'on' : 'off',
pills: [{ label: '开 · 让开栏位底色', value: 'on' }, { label: '关 · 保持默认', value: 'off' }]
});
});
}
const csAvShape = row('cs-av-shape');
if (csAvShape) {
csAvShape.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('聊天头像形状', '', (v) => { store.set('cs-av-shape', v); applySettings(); }, {
pills: [
{ label: '圆形', value: 'circle' },
{ label: '方形', value: 'square' }
],
pill: store.get('cs-av-shape') || 'circle',
noInput: true
});
});
}
const csTimeStyle = row('cs-time-style');
if (csTimeStyle) {
csTimeStyle.addEventListener('click', () => {
if (!window.openModal) return;
const cur = store.get('cs-time-style') || 'under-av';
window.openModal('时间轴样式', '', (v) => {
store.set('cs-time-style', v);
applySettings();
if (v === 'divider' && window.chatReRenderTime) { try { window.chatReRenderTime(); } catch (e) {} }
}, {
pills: TIME_STYLES,
pill: cur,
noInput: true
});
});
}
const csPosRow = (rowId, valId, label, xKey, yKey) => {
const el = row(rowId);
if (!el) return;
el.addEventListener('click', () => {
if (!window.openModal) return;
const curX = clampOffset(store.get(xKey)), curY = clampOffset(store.get(yKey));
const show = () => (curX === 0 && curY === 0) ? '默认（0, 0）' : '左右 ' + curX + 'px / 上下 ' + curY + 'px';
window.openModal(label + '（' + show() + '）', '', (v) => {
const parts = String(v == null ? '' : v).split(/[\s,，/]+/).filter(s => s !== '');
if (!parts.length) return;
const nx = clampOffset(parts[0]);
const ny = parts.length > 1 ? clampOffset(parts[1]) : clampOffset(store.get(yKey));
try { store.set(xKey, String(nx)); store.set(yKey, String(ny)); } catch (e) {}
applySettings();
toast(label + '已保存：左右 ' + nx + 'px / 上下 ' + ny + 'px');
}, { placeholder: '左右,上下  例：8,-4（0 = 默认位置）' });
});
};
csPosRow('cs-mark-pos', 'cs-mark-pos-val', '主动发送标识位置', 'cs-mark-x', 'cs-mark-y');
csPosRow('cs-time-pos', 'cs-time-pos-val', '时间轴位置', 'cs-time-x', 'cs-time-y');
function compressHead(dataUrl, maxSide) {
return new Promise((resolve) => {
if (typeof dataUrl === 'string' && dataUrl.length > 50 * 1024 * 1024) { resolve(null); return; }
const img = new Image();
img.onload = () => {
try {
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
});
}
let headCb = null;
const headInput = document.createElement('input');
headInput.type = 'file'; headInput.accept = 'image/*';
headInput.id = 'cs-head-pick';
headInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
document.body.appendChild(headInput);
function headPickFile(f) {
if (!f) return;
const cb = headCb; headCb = null;
const reader = new FileReader();
reader.onload = () => {
compressHead(reader.result, 256).then(data => {
if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
if (cb) cb(data);
});
};
reader.readAsDataURL(f);
}
headInput.onchange = () => {
const f = headInput.files && headInput.files[0];
headInput.value = ''; // 允许重选同一文件
headPickFile(f);
};
function armHead(cb) { headCb = cb; }
function headActivate() {
var _fb = function () {
var opened = false;
try { headInput.showPicker(); opened = true; } catch (e) {}
try { headInput.click(); opened = true; } catch (e) {}
if (!opened) { headCb = null; toast('相册没能打开：请换系统浏览器或 Chrome 打开再试，仍不行请截图本提示反馈（头像#877）'); }
};
if (window.mochiFilePickGuard) window.mochiFilePickGuard(headInput, _fb);
else _fb();
}
function applyProfile() {
const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
const lp = store.get('cs-lbl-partner');
set('cs-lbl-partner-val', lp || ('未设置（当前显示「' + (window.chatPartnerName ? window.chatPartnerName() : 'TA') + '」）'));
const lu = store.get('cs-lbl-user');
set('cs-lbl-user-val', lu || '未设置（默认 我）');
const ap = store.get('cs-avatar-partner');
set('cs-avatar-partner-val', ap ? '已设置' : '');
const ar = document.getElementById('cs-avatar-partner-remove');
if (ar) ar.hidden = !ap;
const au = store.get('cs-avatar-user');
set('cs-avatar-user-val', au ? '已设置' : '');
const aur = document.getElementById('cs-avatar-user-remove');
if (aur) aur.hidden = !au;
}
applyProfile();
const csLp = row('cs-lbl-partner');
if (csLp) {
csLp.addEventListener('click', () => {
if (!window.openModal) return;
const cur = store.get('cs-lbl-partner') || '';
window.openModal('联系人昵称', cur, (v) => {
const val = (v || '').trim();
const oldEff = window.chatPartnerName ? window.chatPartnerName() : (store.get('cs-lbl-partner') || 'TA');
if (val) store.set('cs-lbl-partner', val); else store.remove('cs-lbl-partner');
if (oldEff !== (window.chatPartnerName ? window.chatPartnerName() : (val || 'TA'))) {
try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff); } catch (e) {}
}
applyProfile();
try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
}, { maxlength: 30 });
});
}
const csLu = row('cs-lbl-user');
if (csLu) {
csLu.addEventListener('click', () => {
if (!window.openModal) return;
const cur = store.get('cs-lbl-user') || '';
window.openModal('我的昵称', cur, (v) => {
const val = (v || '').trim();
const oldEff = store.get('cs-lbl-user') || '我';
if (val) store.set('cs-lbl-user', val); else store.remove('cs-lbl-user');
if (oldEff !== (val || '我')) {
try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff, 'me'); } catch (e) {}
}
applyProfile();
}, { maxlength: 30 });
});
}
const csAp = row('cs-avatar-partner');
if (csAp) {
if (window.mochiFilePickLabel) window.mochiFilePickLabel(csAp, headInput);
if (window.mochiFilePickSurface) {
window.mochiFilePickSurface(csAp, {
id: 'cs-avatar-partner-tap', accept: 'image/*',
onFiles: (files) => { headPickFile(files && files[0]); }
});
}
csAp.addEventListener('click', () => {
armHead((data) => {
store.set('cs-avatar-partner', data);
applyProfile();
try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
});
headActivate();
});
}
const csApRm = row('cs-avatar-partner-remove');
if (csApRm) {
csApRm.addEventListener('click', () => {
store.remove('cs-avatar-partner');
applyProfile();
try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
});
}
const csAu = row('cs-avatar-user');
if (csAu) {
if (window.mochiFilePickLabel) window.mochiFilePickLabel(csAu, headInput);
if (window.mochiFilePickSurface) {
window.mochiFilePickSurface(csAu, {
id: 'cs-avatar-user-tap', accept: 'image/*',
onFiles: (files) => { headPickFile(files && files[0]); }
});
}
csAu.addEventListener('click', () => {
armHead((data) => {
store.set('cs-avatar-user', data);
applyProfile();
try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
});
headActivate();
});
}
const csAuRm = row('cs-avatar-user-remove');
if (csAuRm) {
csAuRm.addEventListener('click', () => {
store.remove('cs-avatar-user');
applyProfile();
try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
});
}
const BUBBLE_BG_COLORS = [
{ color: '#111111', label: '默认黑' },
{ color: '#ffffff', label: '白色' },
{ color: '#3a3a3a', label: '炭灰' },
{ color: '#ffd6e0', label: '樱花粉' },
{ color: '#d6e4ff', label: '雾霭蓝' },
{ color: '#d8f5e0', label: '薄荷绿' },
{ color: '#fff3d6', label: '奶油黄' },
{ color: '#e8dcff', label: '淡紫' },
{ color: '#ffdcc0', label: '暖橘' }
];
const BUBBLE_INK_COLORS = [
{ color: '#111111', label: '默认黑' },
{ color: '#ffffff', label: '白色' },
{ color: '#444444', label: '深灰' },
{ color: '#d6336c', label: '玫红' },
{ color: '#1a56db', label: '蓝' },
{ color: '#1e8e5a', label: '绿' },
{ color: '#9a6b00', label: '黄褐' },
{ color: '#7048e8', label: '紫' },
{ color: '#b3540a', label: '橘' }
];
const SEND_BG_COLORS = [
{ color: '#111111', label: '默认黑' },
{ color: '#07c160', label: '微信绿' },
{ color: '#fa5151', label: '红包红' },
{ color: '#3a8ee6', label: '天空蓝' },
{ color: '#ff9500', label: '活力橙' },
{ color: '#9254de', label: '优雅紫' },
{ color: '#ffffff', label: '白色' },
{ color: '#3a3a3a', label: '炭灰' }
];
function bindBubbleColorRow(rowId, key, def, title, swatches) {
const el = row(rowId);
if (!el) return;
el.addEventListener('click', () => {
if (!window.openModal) return;
const cur = store.get(key) || def;
window.openModal(title, '', (v) => {
const color = (typeof v === 'number' && swatches[v]) ? swatches[v].color : v;
if (!color) return;
store.set(key, color);
applySettings();
const val = document.getElementById(rowId + '-val');
if (val) val.textContent = color === def ? '默认 ' + color : color;
}, {
colorPicker: true,
color: cur,
swatches: swatches
});
});
}
function editChatSurface(index) {
if (!window.openModal) return;
const item = CHAT_SURFACE_SETTINGS[index];
const cid = window.activePrefix();
window.openModal(item.label, '', v => {
if (window.activePrefix() !== cid) return;
const n = Number(v);
if (!Number.isFinite(n)) return;
store.set(item.key, String(surfaceClamp(item, n)));
applySettings();
}, {
noInput: true,
slider: { min: item.min != null ? item.min : 0, max: item.max, step: 1, value: surfaceValue(item), unit: item.unit,
label: item.unit === '%' ? '0% 全透明 · 100% 不透明；确认后生效' : '0px 为默认位置；' + (item.posHint || '调整位置') + '；保留安全区，确认后生效' },
pills: [{ label: '恢复默认', value: item.def }]
});
}
function bindChatSurfaceGroup(id, title, indices) {
const el = row(id);
if (!el) return;
el.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal(title, '', v => {
const index = Number(v);
if (indices.indexOf(index) >= 0) setTimeout(() => editChatSurface(index), 0);
}, { noInput: true, pill: indices[0], pills: indices.map(index => ({ label: CHAT_SURFACE_SETTINGS[index].label, value: index })) });
});
}
bindChatSurfaceGroup('cs-bar-op', '选择要调整的栏背景', [0, 1]);
bindChatSurfaceGroup('cs-bar-pos', '选择要微调的位置（仅当前桌面）', [3, 4]);
const bubbleOpacityRow = row('cs-bubble-op');
if (bubbleOpacityRow) bubbleOpacityRow.addEventListener('click', () => editChatSurface(2));
bindBubbleColorRow('cs-typing-ink', 'cs-typing-ink', '#8a8a8a', '对方正在输入文字颜色', [{ color: '#8a8a8a', label: '默认灰' }].concat(BUBBLE_INK_COLORS));
bindBubbleColorRow('cs-out-bg', 'cs-out-bg', '#111111', '我的气泡颜色', BUBBLE_BG_COLORS);
bindBubbleColorRow('cs-out-ink', 'cs-out-ink', '#ffffff', '我的消息文字颜色', BUBBLE_INK_COLORS);
bindBubbleColorRow('cs-in-bg', 'cs-in-bg', '#ffffff', '联系人气泡颜色', BUBBLE_BG_COLORS);
bindBubbleColorRow('cs-in-ink', 'cs-in-ink', '#111111', '联系人消息文字颜色', BUBBLE_INK_COLORS);
bindBubbleColorRow('cs-send-bg', 'cs-send-bg', '#111111', '发送按钮颜色', SEND_BG_COLORS);
bindBubbleColorRow('cs-send-ink', 'cs-send-ink', '#ffffff', '发送文字颜色', BUBBLE_INK_COLORS);
const csSendShow = document.getElementById('cs-send-show');
if (csSendShow) {
const showGet = () => { try { return store.get('cs-send-show') === 'hide'; } catch (e) { return false; } };
const showSet = (hide) => { try { store.set('cs-send-show', hide ? 'hide' : 'show'); } catch (e) {} };
const syncCsSendShow = () => { const v = showGet(); if (v !== csSendShow.checked) csSendShow.checked = v; };
syncCsSendShow();
csSendShow.addEventListener('change', () => {
if (csSendShow.checked === showGet()) return;
showSet(csSendShow.checked);
applySettings();
toast(csSendShow.checked ? '发送按钮已隐藏：仍可按回车键发送消息' : '发送按钮已显示');
});
document.addEventListener('contact-switched', syncCsSendShow);
}
const csEnterSend = document.getElementById('cs-enter-send');
if (csEnterSend) {
const enterGet = () => { try { return store.get('cs-enter-send') !== 'off'; } catch (e) { return true; } };
const enterSet = (on) => { try { store.set('cs-enter-send', on ? 'on' : 'off'); } catch (e) {} };
const syncCsEnterSend = () => { const v = enterGet(); if (v !== csEnterSend.checked) csEnterSend.checked = v; };
syncCsEnterSend();
csEnterSend.addEventListener('change', () => {
if (csEnterSend.checked === enterGet()) return;
enterSet(csEnterSend.checked);
toast(csEnterSend.checked ? '回车键发送已开启' : '回车键发送已关闭：按回车键改为换行');
});
document.addEventListener('contact-switched', syncCsEnterSend);
}
const csFont = row('cs-font-size');
if (csFont) {
csFont.addEventListener('click', () => {
if (!window.openModal) return;
const curFs = clampFontSize(store.get('cs-font-size'));
window.openModal('聊天气泡字体大小', '', (v) => {
store.set('cs-font-size', clampFontSize(v) + 'px');
applySettings();
}, {
noInput: true,
slider: { min: FONT_SIZE_MIN, max: FONT_SIZE_MAX, step: 1, value: curFs, label: '拖动调整气泡字号', unit: 'px',
onChange: (val) => { root.style.setProperty('--chat-font-size', clampFontSize(val) + 'px'); } },
pills: FONT_SIZES,
pill: curFs + 'px'
});
});
}
const csPad = row('cs-bubble-size');
if (csPad) {
csPad.addEventListener('click', () => {
if (!window.openModal) return;
const curPad = normBubblePad(store.get('cs-bubble-size'));
const curLr = clampBubbleLr(curPad);
window.openModal('聊天气泡框大小', '', (v) => {
store.set('cs-bubble-size', typeof v === 'number' ? bubblePadFromLr(v) : normBubblePad(v));
applySettings();
}, {
noInput: true,
slider: { min: BUBBLE_LR_MIN, max: BUBBLE_LR_MAX, step: 1, value: curLr, label: '拖动调整气泡胖瘦（上下内边距按比例跟随）', unit: 'px',
onChange: (val) => { root.style.setProperty('--chat-bubble-pad', bubblePadFromLr(val)); } },
pills: BUBBLE_SIZES,
pill: curPad
});
});
}
const csRadius = row('cs-bubble-radius');
if (csRadius) {
csRadius.addEventListener('click', () => {
if (!window.openModal) return;
const curStr = store.get('cs-bubble-radius') || BUBBLE_RADIUS_DEFAULT;
const curNum = (parseInt(curStr, 10) || 0);
window.openModal('聊天气泡边缘圆角', '', (v) => {
const px = typeof v === 'number' ? v : (parseInt(v, 10) || 0);
store.set('cs-bubble-radius', px + 'px');
applySettings();
}, {
noInput: true,
slider: {
min: 0, max: 40, step: 1, value: Math.max(0, Math.min(40, curNum)),
label: '拖动调整气泡圆角', unit: 'px', preview: true,
onChange: (val) => { root.style.setProperty('--chat-bubble-radius', val + 'px'); }
},
pills: BUBBLE_RADII,
pill: curStr
});
});
}
const csFontRow = row('cs-font');
const FONT_KEY = 'cs-font';
function fontVal() { return store.get(FONT_KEY) || ''; }
function fontSet(v) { store.set(FONT_KEY, v); }
function fontRemove() { store.remove(FONT_KEY); }
function fontHash(s) {
let h = 5381;
for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
return (h >>> 0).toString(36) + '-' + s.length.toString(36);
}
function fontBlobPut(hash, dataURL) { try { window.xyStore('xy-home-v2').set('font-blob-' + hash, dataURL); } catch (e) {} }
function fontSetDataFor(s, dataURL, silent) {
const h = fontHash(dataURL);
delete _fontBlobGone[h]; // 同内容重新上传＝blob 重新写入，清「丢失」标记
fontBlobPut(h, dataURL);
try { s.set(FONT_KEY, '@@font:' + h); } catch (e) {}
try {
if (window.idbSet) window.idbSet('xy-home-v2:font-blob-' + h, dataURL).then((ok) => {
if (ok) return;
try {
if (s.get(FONT_KEY) !== '@@font:' + h) return;
s.set(FONT_KEY, dataURL);
applyFont();
csFontChanged();
if (!silent) toast('本机存储写入失败，已改用兼容方式保存；重启后若字体丢失请重新上传');
} catch (e) {}
}).catch(() => {});
} catch (e) {}
}
function fontSetData(dataURL) { fontSetDataFor(store, dataURL); }
let _fontHydrating = {};
let _fontHydrateTries = {};
let _fontBlobGone = {};
function fontResolved() {
const v = fontVal();
if (v.indexOf('@@font:') !== 0) return v;
const hash = v.slice(7);
const g = window.xyStore('xy-home-v2');
const blob = g.get('font-blob-' + hash);
if (blob) return blob;
if (_fontBlobGone[hash]) return '';
const tries = _fontHydrateTries[hash] || 0;
if (window.idbGet && !_fontHydrating[hash] && tries < 5) {
_fontHydrating[hash] = true;
_fontHydrateTries[hash] = tries + 1;
const info = {};
window.idbGet('xy-home-v2:font-blob-' + hash, info).then((b) => {
delete _fontHydrating[hash];
if (b && typeof b === 'string' && b.length > 2) {
delete _fontHydrateTries[hash];
delete _fontBlobGone[hash];
fontBlobPut(hash, b);
applyFont();
csFontChanged();
return;
}
if (info && info.ambiguous) {
setTimeout(() => { applyFont(); }, 2500 * (tries + 1));
} else {
_fontBlobGone[hash] = true; // IDB 里真没有＝blob 丢失（多半是当年写入静默失败）
applyFont(); // 只为把设置行文案刷成「丢失」；fontResolved 见 gone 不再发读
csFontChanged(); // #894：丢失是终局，广播让美化页入口同步清除（读取中不广播，防误清）
}
}).catch(() => {
delete _fontHydrating[hash];
setTimeout(() => { applyFont(); }, 2500 * (tries + 1));
});
}
return '';
}
function deskFontCids() {
const ids = ['default'];
try { (window.getContacts() || []).forEach(c => { if (c && c.id && ids.indexOf(c.id) < 0) ids.push(c.id); }); } catch (e) {}
return ids;
}
function csFontChanged() { try { document.dispatchEvent(new Event('cs-font-changed')); } catch (e) {} }
function demoteFontGlobal() {
try {
if (!window.storeFor) return;
let root = '';
try { root = window.xyStore('xy-home-v2').get(FONT_KEY) || ''; } catch (e) {}
if (!root) return;
deskFontCids().forEach(id => {
try { const s = window.storeFor(id); if (!s.get(FONT_KEY)) s.set(FONT_KEY, root); } catch (e) {}
});
try { window.xyStore('xy-home-v2').remove(FONT_KEY); } catch (e) {}
applyFont();
csFontChanged();
} catch (e) {}
}
function syncFontAllDesks() {
const v = fontVal();
if (!v) { toast('当前桌面还没有自定义字体：先上传字体或输入字体名，点「应用」'); return; }
const me = (window.getActiveContact && window.getActiveContact()) || 'default';
const others = deskFontCids().filter(id => id !== me);
if (!others.length) { toast('现在只有这一个桌面，无需同步'); return; }
if (!window.openModal || !window.storeFor) return;
window.openModal('同步字体到全部桌面', '', (r) => {
if (r !== '__yes__') return;
let n = 0;
others.forEach((id) => { try { window.storeFor(id).set(FONT_KEY, v); n++; } catch (e) {} });
csFontChanged();
toast('已同步到 ' + n + ' 个桌面（切到对应桌面即可看到）');
}, { noInput: true, pills: [{ label: '确认同步（覆盖其它桌面的字体）', value: '__yes__' }, { label: '取消', value: '__no__' }] });
}
window.csFontSyncAllDesks = syncFontAllDesks;
window.csFontStoreData = fontSetData;
function migrateFontBlobs() {
try {
if (!window.storeFor) return;
deskFontCids().forEach((id) => {
try {
const s = window.storeFor(id);
const v = s.get(FONT_KEY);
if (v && v.indexOf('data:') === 0) fontSetDataFor(s, v, true); // silent：启动迁移不弹 toast（#787）
} catch (e) {}
});
} catch (e) {}
}
window.migrateFontBlobs = migrateFontBlobs;
function applyFont() {
const v = fontResolved();
const rawVal = fontVal();
const setVal = document.getElementById('cs-font-val');
if (setVal) {
if (v) setVal.textContent = v.indexOf('data:') === 0 ? '已上传' : v;
else if (rawVal.indexOf('@@font:') === 0) setVal.textContent = _fontBlobGone[rawVal.slice(7)] ? '字体文件丢失，请重新上传' : '已上传（读取中…）';
else setVal.textContent = '默认';
}
if (!v && rawVal.indexOf('@@font:') === 0 && !_fontBlobGone[rawVal.slice(7)]) return;
const old = document.getElementById('cs-font-style');
if (old && old.__fontVal === v) return;
if (old) old.remove();
if (!v) {
if (document.body.style.fontFamily || document.documentElement.style.fontFamily) {
document.body.style.fontFamily = '';
document.documentElement.style.fontFamily = '';
}
return;
}
if (v.indexOf('data:') === 0) {
const st = document.createElement('style');
st.id = 'cs-font-style';
st.__fontVal = v;
st.textContent = '@font-face{font-family:"cs-custom-font";src:url("' + v + '");font-display:swap;}' +
'body,html{font-family:"cs-custom-font",sans-serif !important;}';
document.head.appendChild(st);
document.body.style.fontFamily = '';
document.documentElement.style.fontFamily = '';
return;
}
document.body.style.fontFamily = '"' + v + '",sans-serif';
document.documentElement.style.fontFamily = '"' + v + '",sans-serif';
}
if (csFontRow) {
csFontRow.addEventListener('click', () => {
if (!window.openTCPanel) return;
window.openTCPanel('全局字体', '' +
'<div class="sm-fld"><label>上传本地字体（ttf / otf / woff / woff2），应用后本桌面全部页面生效</label>' +
'<input class="tc-input" id="cs-font-name" placeholder="也可直接输入字体名或链接，如 Microsoft YaHei"' + (fontResolved() && fontResolved().indexOf('data:') !== 0 && fontResolved().indexOf('http') !== 0 ? ' value="' + String(fontResolved()).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"' : '') + '></div>' +
'<div class="mail-actions"><button class="cc-tool" id="cs-font-upload">上传字体</button><button class="cc-tool" id="cs-font-clear">恢复默认</button><button class="cc-tool" id="cs-font-ok">应用</button></div>' +
'<div class="sm-fld" style="margin-top:10px"><label>其它桌面也要用这个字体？</label>' +
'<button id="cs-font-sync" style="width:100%;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px">同步到全部桌面</button></div>');
document.getElementById('cs-font-upload').addEventListener('click', () => {
window.mochiFilePick({
id: 'mochi-cs-font-pick', accept: '.ttf,.otf,.woff,.woff2',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到字体文件，请再选一次'); return; }
toast('正在读取字体文件…');
const reader = new FileReader();
reader.onload = () => {
fontSetData(reader.result); // #642：存全局唯一份 + 轻量引用（同内容跨桌面只存一份）
document.getElementById('tc-mask').hidden = true;
applyFont();
csFontChanged();
toast('字体已应用到本桌面');
};
reader.onerror = () => { toast('字体文件读取失败，请重试'); };
reader.readAsDataURL(f);
}
});
});
document.getElementById('cs-font-clear').addEventListener('click', () => {
fontRemove();
document.getElementById('tc-mask').hidden = true;
applyFont();
csFontChanged();
toast('已恢复默认字体');
});
document.getElementById('cs-font-ok').addEventListener('click', () => {
const name = (document.getElementById('cs-font-name').value || '').trim();
if (!name) { toast('请输入字体名或链接'); return; }
if (/^https?:\/\/.+\.(ttf|otf|woff|woff2)$/i.test(name)) {
toast('正在下载字体，请稍候…');
fetch(name, { mode: 'cors' }).then(r => {
if (!r.ok) throw new Error('HTTP ' + r.status);
return r.blob();
}).then(blob => {
const rd = new FileReader();
rd.onload = () => {
fontSetData(rd.result); // #642：全局唯一份 + 引用
document.getElementById('tc-mask').hidden = true;
applyFont();
csFontChanged();
toast('字体下载并应用成功');
};
rd.onerror = () => {
fontSet(name);
document.getElementById('tc-mask').hidden = true;
applyFont();
csFontChanged();
toast('字体读取失败，已按字体名应用');
};
rd.readAsDataURL(blob);
}).catch(() => {
fontSet(name);
document.getElementById('tc-mask').hidden = true;
applyFont();
csFontChanged();
toast('链接下载失败，已按字体名应用');
});
return;
}
fontSet(name);
document.getElementById('tc-mask').hidden = true;
applyFont();
csFontChanged();
toast('字体已应用到本桌面');
});
document.getElementById('cs-font-sync').addEventListener('click', () => { syncFontAllDesks(); });
});
}
demoteFontGlobal();
migrateFontBlobs();
try { document.addEventListener('mochi-restore-done', () => { _fontHydrateTries = {}; migrateFontBlobs(); applyFont(); }); } catch (e) {}
applyFont();
const csCss = row('cs-css');
const CSS_KEY = 'cs-bubble-css';
function cssReadVal(el) {
if (!el) return '';
let v = '';
try { v = el.value || ''; } catch (e) {}
if (String(v).trim()) return String(v);
try {
const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
if (box) {
const t = box.innerText || box.textContent || '';
if (String(t).trim()) return String(t);
}
} catch (e) {}
return v;
}
function applyCssEnforce() {
const old = document.getElementById('cs-bubble-enforce');
const rules = [];
try {
const opItem = CHAT_SURFACE_SETTINGS.filter(s => s.key === 'cs-bubble-opacity')[0];
const op = opItem ? surfaceValue(opItem) : 100;
if (opItem && op !== opItem.def) {
rules.push('#page-chat .msg-in .msg-bubble.msg-bubble{background:var(--cs-in-surface)!important}');
rules.push('#page-chat .msg-out .msg-bubble.msg-bubble{background:var(--cs-out-surface)!important}');
}
const rad = store.get('cs-bubble-radius');
if (rad != null && String(rad).trim() !== '' && String(rad) !== BUBBLE_RADIUS_DEFAULT) {
rules.push('#page-chat .msg-bubble.msg-bubble{border-radius:var(--chat-bubble-radius,18px)!important}');
}
} catch (e) {}
const text = rules.join('');
if (!text) { if (old) old.remove(); return; }
if (old) { if (old.textContent !== text) old.textContent = text; return; }
const st = document.createElement('style');
st.id = 'cs-bubble-enforce';
st.textContent = text;
document.head.appendChild(st);
}
function applyCss() {
const old = document.getElementById('cs-bubble-style');
if (old) old.remove();
const css = store.get(CSS_KEY) || '';
const setVal = document.getElementById('cs-css-val');
if (setVal) setVal.textContent = css ? '已设置' : '默认';
if (!css) return null;
let out, hint = null;
if (window.mochiMapBubbleCss) {
const res = window.mochiMapBubbleCss(css, '#page-chat ');
out = res.out;
hint = res.hint;
} else if (css.indexOf('{') < 0) {
out = '#page-chat .msg-out .msg-bubble{' + css + '!important;}' +
'#page-chat .msg-in .msg-bubble{' + css + '!important;}';
} else {
out = css;
}
const st = document.createElement('style');
st.id = 'cs-bubble-style';
st.textContent = out;
document.head.appendChild(st);
return hint;
}
if (csCss) {
csCss.addEventListener('click', () => {
if (!window.openTCPanel) return;
window.openTCPanel('气泡 CSS', '' +
'<div class="sm-fld-hint" style="margin-bottom:8px">输入自定义样式，支持两种写法：<br>· 直接写声明，如 <code>border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.1)</code>（自动应用到双方气泡）<br>· 或写选择器，如 <code>.msg-out .msg-bubble{...}</code>；网页气泡模板常见的 <code>.me/.friend/.message-me/.bubble{...}</code> 等类名也会自动识别</div>' +
'<textarea id="cs-css-input" class="tc-input" rows="6" placeholder="border-radius: 20px;' + '&#10;box-shadow: 0 2px 8px rgba(0,0,0,.12);"></textarea>' +
'<div class="mail-actions"><button class="cc-tool" id="cs-css-clear">清空</button><button class="cc-tool" id="cs-css-ok">应用</button></div>');
const ta = document.getElementById('cs-css-input');
if (ta) ta.value = store.get(CSS_KEY) || '';
document.getElementById('cs-css-clear').addEventListener('click', () => {
store.remove(CSS_KEY);
document.getElementById('tc-mask').hidden = true;
applyCss();
toast('已清空气泡样式');
});
document.getElementById('cs-css-ok').addEventListener('click', () => {
const v = cssReadVal(document.getElementById('cs-css-input')).trim();
store.set(CSS_KEY, v);
document.getElementById('tc-mask').hidden = true;
const hint = applyCss();
toast(hint || '气泡样式已应用');
});
});
}
applyCss();
const gStoreChat = window.xyStore('xy-home-v2');
const CHAT_SCHEMES_KEY = 'chat-beauty-schemes';
const CHAT_BEAUTY_KEYS = [
'cs-bg', 'cs-bubble-css', 'cs-font', 'cs-font-size', 'cs-bubble-size',
'cs-bubble-radius', 'cs-av-shape', 'cs-time-style', 'cs-time-ink', 'cs-typing-ink',
'cs-out-bg', 'cs-out-ink', 'cs-in-bg', 'cs-in-ink',
'cs-send-bg', 'cs-send-ink', 'cs-send-show',
'cs-head-opacity', 'cs-input-opacity', 'cs-bubble-opacity', 'cs-head-inset', 'cs-input-inset',
'cs-bg-fit', 'cs-bg-fullbars', 'cs-bg-pos-x', 'cs-bg-pos-y', 'cs-bg-size'
];
const getChatSchemes = () => {
try { const a = JSON.parse(gStoreChat.get(CHAT_SCHEMES_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
};
const saveChatSchemesList = (arr) => { try { gStoreChat.set(CHAT_SCHEMES_KEY, JSON.stringify(arr)); } catch (e) {} };
const CHAT_BEAUTY_KIND = 'mochi-chat-beauty';
const chatBeautyKindMismatch = (data) => {
const k = data && data['__kind__'];
return !!k && k !== CHAT_BEAUTY_KIND;
};
const recognizeChatBeauty = (data) => {
if (!data || typeof data !== 'object') return 0;
let n = 0;
CHAT_BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined) n++; });
return n;
};
const collectChatBeauty = () => {
const data = {};
CHAT_BEAUTY_KEYS.forEach(k => { const v = store.get(k); if (v !== null && v !== undefined && v !== '') data[k] = v; });
data['__kind__'] = CHAT_BEAUTY_KIND;
return data;
};
const applyChatBeautyData = (data) => {
let n = 0;
CHAT_BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined) { store.set(k, data[k]); n++; } });
try { applySettings(); applyCss(); applyFont(); } catch (e) {}
try { csFontChanged(); } catch (e) {}
return n;
};
const chatBackupBeforeImport = () => {
try {
const cur = collectChatBeauty();
const realKeys = Object.keys(cur).filter(k => k !== '__kind__');
if (!realKeys.length) return '';
const d = new Date();
const p = (n) => (n < 10 ? '0' : '') + n;
const name = '导入前备份 ' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
let list = getChatSchemes();
const autos = list.filter(s => s && typeof s.name === 'string' && s.name.indexOf('导入前备份') === 0);
if (autos.length >= 5) {
const drop = new Set(autos.slice(0, autos.length - 4).map(s => s.time));
list = list.filter(s => !(s && drop.has(s.time) && typeof s.name === 'string' && s.name.indexOf('导入前备份') === 0));
}
list.push({ name, time: Date.now(), data: cur });
saveChatSchemesList(list);
const back = getChatSchemes();
return back.some(s => s && s.name === name) ? name : '';
} catch (e) { return ''; }
};
window.collectChatBeauty = collectChatBeauty;
window.applyChatBeautyData = applyChatBeautyData;
function chatSchemeModalEl() {
let m = document.getElementById('chat-beauty-scheme-manager');
if (!m) {
m = document.createElement('div'); m.id = 'chat-beauty-scheme-manager'; m.hidden = true;
m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
document.body.appendChild(m);
m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
}
return m;
}
function hideChatSchemeModal(m) { if (m) { m.style.display = 'none'; m.hidden = true; } }
function applyChatScheme(idx, m) {
const s = getChatSchemes()[idx];
if (!s || !window.openModal) return;
const ctl = window.openModal('应用方案「' + s.name + '」？', '', (v) => {
if (v !== 'ok') return;
applyChatBeautyData(s.data || {});
hideChatSchemeModal(m);
toast('已应用「' + s.name + '」，当前聊天立即生效');
}, { noInput: true, staticText: '将覆盖当前联系人桌面的聊天美化设置，立即生效', pills: [{ label: '应用', value: 'ok' }] });
if (ctl && ctl.pills) ctl.pills([{ label: '应用', value: 'ok' }], 'ok');
}
function deleteChatScheme(idx, m) {
const s = getChatSchemes()[idx];
if (!s || !window.openModal) return;
const ctl = window.openModal('删除方案「' + s.name + '」？', '', (v) => {
if (v !== 'ok') return;
const list = getChatSchemes();
list.splice(idx, 1);
saveChatSchemesList(list);
toast('已删除方案');
window.openChatBeautySchemes();
}, { noInput: true, staticText: '删除后不可恢复', pills: [{ label: '删除', value: 'ok' }] });
if (ctl && ctl.pills) ctl.pills([{ label: '删除', value: 'ok' }], 'ok');
}
function mkBtn(label, css, fn) {
const b = document.createElement('button');
b.textContent = label;
b.style.cssText = css;
b.addEventListener('click', fn);
return b;
}
function chatSchemeExport() {
const schemes = getChatSchemes();
const doExport = (data) => {
const json = JSON.stringify(data);
if (!window.openModal) { toast('导出失败'); return; }
const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n;
const fname = 'mochi聊天美化方案-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.json';
window.openModal('导出聊天美化方案', '', (v) => {
if (v === 'file') {
if (window.mochiExportFile) { window.mochiExportFile(json, fname, 'mochi聊天美化方案'); return; }
try {
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = fname;
document.body.appendChild(a); a.click();
setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 1000);
toast('已导出聊天美化方案文件');
} catch (e) { toast('导出文件失败'); }
} else if (v === 'text') {
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(json).then(() => toast('已复制到剪贴板，发给对方粘贴导入')).catch(() => toast('复制失败，请改用导出文件'));
} else { toast('剪贴板不可用，请改用导出文件'); }
}
}, {
noInput: true,
staticText: '选择导出方式：\n· 导出文件：自动弹分享/保存框（iPhone 主屏安装时用这个），不支持时确认后下载，可保存或发送\n· 复制文字：复制配置文本，发给对方粘贴导入',
pills: [
{ label: '导出文件', value: 'file' },
{ label: '复制文字', value: 'text' },
],
});
};
if (!schemes.length || !window.openModal) { doExport(collectChatBeauty()); return; }
const pills = [{ label: '当前设置', value: 'current' }]
.concat(schemes.map((s, i) => ({ label: s.name || ('方案' + (i + 1)), value: 'sch_' + i })));
window.openModal('导出聊天美化方案', '', (v) => {
let data;
if (v && v.indexOf('sch_') === 0) {
const i = parseInt(String(v).slice(4), 10);
const s = schemes[i];
if (!s) { toast('未找到该方案'); return; }
data = s.data || {};
} else {
data = collectChatBeauty();
}
doExport(data);
}, {
noInput: true,
staticText: '选择要导出的聊天美化方案：\n· 当前设置：导出当前正在使用的聊天美化\n· 已保存方案：导出对应方案（含气泡/壁纸/字体）',
pills: pills,
});
}
function chatSchemeImport() {
if (!window.openModal) return;
window.openModal('导入聊天美化方案', '', (v) => {
if (!v || !v.trim()) { toast('请先粘贴方案文本，或点「从文件导入」选择 .json 文件'); return; }
try {
const data = window.mochiParsePastedJSON(v);
if (chatBeautyKindMismatch(data)) {
toast('这份方案不是聊天美化方案（' + data.__kind__ + '），请到对应页面导入');
return;
}
const hit = recognizeChatBeauty(data);
if (!hit) {
toast('这份数据里没有识别到聊天美化项，请确认是聊天美化方案');
return;
}
const bk = chatBackupBeforeImport();
const n = applyChatBeautyData(data);
toast('已导入 ' + n + ' 项，当前聊天立即生效' + (bk ? '（原美化已存为「' + bk + '」）' : ''));
window.openChatBeautySchemes();
} catch (e) {
const _sv = String(v || '');
try { if (window.__jsErrors) window.__jsErrors.push('[聊天美化导入] ' + ((e && e.message) || e) + ' | 收到长度=' + _sv.length + ' | 开头: ' + _sv.replace(/[\uFEFF\u200B-\u200F]/g, '').slice(0, 100)); } catch (e1) {}
toast('解析失败：' + ((e && e.message) || '请检查文本'));
}
}, { textarea: true, textareaPlaceholder: '粘贴对方导出的聊天美化方案文本，或点下方「从文件导入」选择 .json 文件', txtImport: true });
}
function chatSchemeThumb(data) {
data = data || {};
const inBg = data['cs-in-bg'] || '#ffffff';
const inInk = data['cs-in-ink'] || '#111111';
const outBg = data['cs-out-bg'] || '#111111';
const outInk = data['cs-out-ink'] || '#ffffff';
const r = (parseInt(data['cs-bubble-radius'] || '18px', 10) || 18) / 2;
const tl = Math.max(0, Math.min(9, Math.round(r)));
const bg = data['cs-bg'] || '';
const hasCss = !!data['cs-bubble-css'];
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
function chatBeautySummary(data) {
data = data || {};
const out = [];
const inBg = data['cs-in-bg'], outBg = data['cs-out-bg'];
if (inBg || outBg) out.push('气泡色 ' + (inBg || '默认') + ' / ' + (outBg || '默认'));
const rad = data['cs-bubble-radius'] || '18px';
const rn = BUBBLE_RADII.find(p => p.value === rad);
out.push('圆角 ' + (rn ? rn.label : rad));
const fs = data['cs-font-size'] || '14px';
const fnl = FONT_SIZES.find(p => p.value === fs);
out.push('字号 ' + (fnl ? fnl.label : fs));
if (data['cs-bubble-css']) out.push('自定义CSS');
if (data['cs-bg']) out.push('壁纸');
const av = data['cs-av-shape'];
if (av) out.push('头像 ' + ({ circle: '圆形', round: '圆角', square: '方形' }[av] || av));
return out;
}
function chatSaveModalEl() {
let m = document.getElementById('chat-beauty-save-modal');
if (!m) {
m = document.createElement('div'); m.id = 'chat-beauty-save-modal'; m.hidden = true;
m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
document.body.appendChild(m);
m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
}
return m;
}
window.saveChatBeautyScheme = function () {
const x = chatSaveModalEl();
x.innerHTML = '';
const wrap = document.createElement('div');
wrap.style.cssText = 'box-sizing:border-box;width:min(84vw,340px);max-height:84vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
const hd = document.createElement('div');
hd.style.cssText = 'font-size:15px;font-weight:700;text-align:center;margin-bottom:12px';
hd.textContent = '保存当前为聊天美化方案';
const data = collectChatBeauty();
const pv = document.createElement('div');
pv.innerHTML = chatSchemeThumb(data);
const sub = document.createElement('div');
sub.style.cssText = 'font-size:10.5px;color:var(--muted,#999);margin:8px 0 6px';
sub.textContent = '正在保存的当前设置：';
const sum = document.createElement('div');
sum.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px';
const chips = chatBeautySummary(data);
if (!chips.length) { const e = document.createElement('span'); e.textContent = '以上传壁纸/气泡等设置为主'; e.style.cssText = 'font-size:10.5px;color:var(--muted,#999)'; sum.appendChild(e); }
else chips.forEach(c => { const el = document.createElement('span'); el.textContent = c; el.style.cssText = 'font-size:10.5px;color:var(--muted,#666);background:var(--card-soft,#f2f3f5);border:1px solid var(--card-border,#eee);padding:2px 8px;border-radius:999px'; sum.appendChild(el); });
const inp = document.createElement('input');
inp.placeholder = '例如：简约白、情侣粉气泡…'; inp.maxLength = 20;
inp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)';
const act = document.createElement('div');
act.style.cssText = 'display:flex;gap:8px;margin-top:13px;justify-content:flex-end';
const cancel = mkBtn('取消', 'font-size:12.5px;padding:7px 14px;border:1px solid var(--card-border,#eee);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => { x.style.display = 'none'; x.hidden = true; });
const ok = mkBtn('保存方案', 'font-size:12.5px;padding:7px 14px;border:none;border-radius:9px;background:var(--ink,#111);color:#fff', () => {
const name = (inp.value || '').trim();
if (!name) { inp.style.borderColor = '#e05a5a'; return; }
const list = getChatSchemes();
list.push({ name, time: Date.now(), data });
saveChatSchemesList(list);
x.style.display = 'none'; x.hidden = true;
toast('已保存方案「' + name + '」，所有桌面通用');
const m = document.getElementById('chat-beauty-scheme-manager');
if (m && !m.hidden) window.openChatBeautySchemes();
});
act.appendChild(cancel); act.appendChild(ok);
wrap.appendChild(hd); wrap.appendChild(pv); wrap.appendChild(sub); wrap.appendChild(sum); wrap.appendChild(inp); wrap.appendChild(act);
x.appendChild(wrap);
x.style.display = 'flex'; x.hidden = false;
setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
};
let chatPreviewBackup = null;
function chatPreviewBarEl() {
let bar = document.getElementById('chat-beauty-preview-bar');
if (!bar) {
bar = document.createElement('div'); bar.id = 'chat-beauty-preview-bar';
bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:96;margin:12px;padding:12px 14px;background:var(--card-bg,#fff);color:var(--ink,#111);border:1px solid var(--card-border,#eee);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;align-items:center;gap:10px';
document.body.appendChild(bar);
}
return bar;
}
function chatStartPreview(s, m) {
if (!s) return;
chatPreviewBackup = collectChatBeauty();
hideChatSchemeModal(m);
applyChatBeautyData(s.data || {});
const bar = chatPreviewBarEl();
bar.innerHTML = '';
const tx = document.createElement('div'); tx.style.flex = '1'; tx.style.fontSize = '13px';
tx.innerHTML = '正在预览「<b>' + s.name + '</b>」<div style="font-size:11px;color:var(--muted,#999)">去聊天页查看效果，点「使用」保存 / 「还原」恢复</div>';
const re = mkBtn('还原', 'font-size:12px;padding:6px 12px;border:1px solid var(--card-border,#eee);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => {
if (chatPreviewBackup) applyChatBeautyData(chatPreviewBackup);
chatPreviewBackup = null; bar.style.display = 'none'; toast('已还原');
});
const keep = mkBtn('使用这个方案', 'font-size:12px;padding:6px 12px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => {
chatPreviewBackup = null; bar.style.display = 'none'; toast('已应用「' + s.name + '」');
});
bar.appendChild(tx); bar.appendChild(re); bar.appendChild(keep);
bar.style.display = 'flex';
}
function renameChatScheme(idx, m) {
const list = getChatSchemes();
const s = list[idx];
if (!s || !window.openModal) return;
const ctl = window.openModal('编辑方案名称', s.name, (name) => {
name = (name || '').trim();
if (!name) { ctl.hint('名称不能为空'); ctl.stay(); return; }
s.name = name; saveChatSchemesList(list); toast('已重命名');
window.openChatBeautySchemes();
}, { maxlength: 20, placeholder: '输入方案名称' });
}
window.openChatBeautySchemes = function () {
const m = chatSchemeModalEl();
m.innerHTML = '';
const box = document.createElement('div');
box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
const head = document.createElement('div');
head.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:4px">聊天美化方案</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">方案在所有联系人桌面通用（含气泡颜色/CSS、背景图、字体、时间轴等），点「应用」一键切换当前聊天外观</div>';
box.appendChild(head);
const list = document.createElement('div'); list.className = 'cm-list';
list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0';
const schemes = getChatSchemes();
if (!schemes.length) {
const empty = document.createElement('div');
empty.innerHTML = '<div style="font-size:13px;color:var(--muted,#999);text-align:center;padding:20px 0">还没有保存的聊天美化方案<br>先点下方「保存当前为方案」</div>';
list.appendChild(empty);
}
schemes.forEach((s, i) => {
const row = document.createElement('div');
row.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px';
const th = document.createElement('div');
th.innerHTML = chatSchemeThumb(s.data || {});
row.appendChild(th);
const nm = document.createElement('div');
const t = new Date(s.time || Date.now());
const ds = (t.getMonth() + 1) + '-' + t.getDate();
nm.innerHTML = '<div style="font-size:14px;font-weight:600;word-break:break-all">' + s.name + '</div><div style="font-size:11px;color:var(--muted,#999)">保存于 ' + ds + '</div>';
row.appendChild(nm);
const btns = document.createElement('div');
btns.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap';
btns.appendChild(mkBtn('预览', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => chatStartPreview(s, m)));
btns.appendChild(mkBtn('应用', 'font-size:12px;padding:4px 10px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => applyChatScheme(i, m)));
btns.appendChild(mkBtn('改名', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => renameChatScheme(i, m)));
btns.appendChild(mkBtn('删除', 'font-size:12px;padding:4px 10px;border:1px solid rgba(163,45,45,.35);border-radius:8px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d)', () => deleteChatScheme(i, m)));
row.appendChild(btns);
list.appendChild(row);
});
box.appendChild(list);
const opera = document.createElement('div');
opera.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
const exBtn = mkBtn('导出方案', 'flex:1;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;font-weight:600', () => chatSchemeExport());
const imBtn = mkBtn('导入方案', 'flex:1;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;font-weight:600', () => chatSchemeImport());
opera.appendChild(exBtn); opera.appendChild(imBtn);
box.appendChild(opera);
const save = document.createElement('button');
save.textContent = '+ 保存当前为方案';
save.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600';
save.addEventListener('click', () => { window.saveChatBeautyScheme(); });
box.appendChild(save);
const close = document.createElement('button');
close.textContent = '关闭';
close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
close.addEventListener('click', () => hideChatSchemeModal(m));
box.appendChild(close);
m.appendChild(box);
m.style.display = 'flex'; m.hidden = false;
};
const chatBeautySaveRow = document.getElementById('row-chat-beauty-save');
if (chatBeautySaveRow) chatBeautySaveRow.addEventListener('click', () => window.saveChatBeautyScheme());
const chatBeautySchemesRow = document.getElementById('row-chat-beauty-schemes');
if (chatBeautySchemesRow) chatBeautySchemesRow.addEventListener('click', () => window.openChatBeautySchemes());
(function initChatSettingsTabs() {
const tabsEl = document.getElementById('cs-tabs');
const page = document.getElementById('page-chat-settings');
if (!tabsEl || !page) return;
const tabs = tabsEl.querySelectorAll('.them-tab');
const secs = page.querySelectorAll('.them-sec');
function show(name) {
secs.forEach(s => { s.hidden = (s.dataset.sec !== name); });
tabs.forEach(t => { t.classList.toggle('active', t.dataset.tab === name); });
}
tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
show(tabs[0] ? tabs[0].dataset.tab : 'beautify');
})();
(function initCsFuncTags() {
const tagsEl = document.getElementById('cs-func-tags');
const page = document.getElementById('page-chat-settings');
if (!tagsEl || !page) return;
const sec = page.querySelector('.them-sec[data-sec="function"]');
if (!sec) return;
const pairs = Array.from(sec.querySelectorAll('.gs-title[data-tag], .set-group[data-tag]'));
function applyFilter(ft) {
pairs.forEach(el => { el.hidden = (ft !== 'all' && el.dataset.tag !== ft); });
}
tagsEl.addEventListener('click', (e) => {
const t = e.target.closest('.them-tab');
if (!t) return;
tagsEl.querySelectorAll('.them-tab').forEach(x => x.classList.toggle('active', x === t));
applyFilter(t.dataset.ft || 'all');
});
const def = tagsEl.querySelector('.them-tab.active');
applyFilter(def ? (def.dataset.ft || 'all') : 'all');
})();
const csExport = row('cs-export-msgs');
if (csExport) {
csExport.addEventListener('click', () => {
if (!window.chatExportMsgs && !window.getChatMsgs) { toast('聊天记录暂不可用'); return; }
toast('正在导出，请稍候…');
try {
if (window.chatFlushSave) window.chatFlushSave();
const arr = window.getChatMsgs ? window.getChatMsgs() : window.chatExportMsgs();
const n = Array.isArray(arr) ? arr.length : 0;
if (!n) { toast('没有聊天记录可导出'); return; }
const parts = ['{"app":"mochi-zika-chat","version":"1.0","exportTime":"' + new Date().toISOString() + '","msgs":['];
for (let i = 0; i < n; i++) {
if (i) parts.push(',');
parts.push(JSON.stringify(arr[i]));
}
parts.push(']}');
const blob = new Blob(parts, { type: 'application/json;charset=utf-8' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = '聊天记录_' + new Date().toISOString().slice(0, 10) + '.json';
document.body.appendChild(a);
a.click();
setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
toast('已导出 ' + n + ' 条聊天记录');
} catch (e) {
toast('导出失败：' + (e && e.message || '未知错误'));
}
});
}
const csImport = row('cs-import-msgs');
if (csImport) {
csImport.addEventListener('click', () => {
window.mochiFilePick({
id: 'mochi-cs-import-pick', accept: '.json,application/json',
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
const raw = (data.idb && data.idb['xy-home-v2:chat-msgs']) || data.ls['xy-home-v2:chat-msgs'];
try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { arr = null; }
}
if (!Array.isArray(arr) || !arr.length) { toast('文件里没有聊天记录数据'); return; }
const n = arr.length;
const fmt = (t) => t ? new Date(t).toLocaleString() : '未知';
const lines = ['文件包含 ' + n + ' 条消息：',
'· 最早：' + fmt(arr[0] && arr[0].ts),
'· 最新：' + fmt(arr[n - 1] && arr[n - 1].ts),
'导入将覆盖当前全部聊天记录（不可恢复）。'];
if (!window.openModal) return;
window.openModal('确认导入聊天记录？', '', () => {
if (window.chatImportMsgs && window.chatImportMsgs(arr)) toast('已导入 ' + n + ' 条聊天记录');
else toast('导入失败');
}, { noInput: true, staticText: lines.join('\n') });
};
reader.onerror = () => { toast('文件读取失败，请重试'); };
reader.readAsText(f, 'utf-8');
}
});
});
}
const csExportAll = row('cs-export-all');
if (csExportAll) {
csExportAll.addEventListener('click', () => {
if (!window.runChatAllExport) { toast('导出功能暂不可用'); return; }
window.runChatAllExport();
});
}
const csImportAll = row('cs-import-all');
if (csImportAll) {
csImportAll.addEventListener('click', () => {
if (!window.runChatAllImport) { toast('导入功能暂不可用'); return; }
window.runChatAllImport();
});
}
const csClear = row('cs-clear-msgs');
if (csClear) {
csClear.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('确认删除全部聊天记录？（双方所有消息将被清空，且不可恢复）', '', () => {
if (window.clearChatHistory) window.clearChatHistory();
toast('聊天记录已清空');
}, { noInput: true });
});
}
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':cs-bg').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2 && !store.get('cs-bg')) {
store.set('cs-bg', v);
applySettings();
}
});
window.idbGet(myPrefix + ':' + FONT_KEY).then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2 && !fontVal()) {
fontSet(v);
applyFont();
csFontChanged();
}
});
window.idbGet(myPrefix + ':' + CSS_KEY).then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 0 && !store.get(CSS_KEY)) {
store.set(CSS_KEY, v);
applyCss();
}
});
}
} catch (e) {}
document.addEventListener('mochi-restore-done', function () {
try { demoteFontGlobal(); } catch (e) {}
try { applyFont(); } catch (e) {}
try { applyProfile(); } catch (e) {}
try { applyCss(); } catch (e) {}
});
document.addEventListener('contact-switched', function () {
try { applySettings(); } catch (e) {}
try { applyProfile(); } catch (e) {}
try { applyCss(); } catch (e) {}
try { applyFont(); } catch (e) {}
});
const _csTicker = { fns: [], timer: 0 };
function csAddSync(fn) { _csTicker.fns.push(fn); }
function _csRun() {
for (let i = 0; i < _csTicker.fns.length; i++) { try { _csTicker.fns[i](); } catch (e) {} }
}
function _csTickOn() {
if (_csTicker.timer) return;
_csRun();
_csTicker.timer = setInterval(_csRun, 500);
}
function _csTickOff() {
if (_csTicker.timer) { clearInterval(_csTicker.timer); _csTicker.timer = 0; }
}
(function () {
const page = document.getElementById('page-chat-settings');
if (!page) return;
const want = () => {
if (!page.hidden && document.visibilityState === 'visible') _csTickOn();
else _csTickOff();
};
try { new MutationObserver(want).observe(page, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
document.addEventListener('visibilitychange', want);
document.addEventListener('contact-switched', function () { if (_csTicker.timer) _csRun(); });
want();
})();
const csFs = document.getElementById('cs-fullscreen');
const sfFs = document.getElementById('sf-fullscreen');
if (csFs && sfFs) {
const syncCsFs = () => { if (sfFs.checked !== csFs.checked) csFs.checked = sfFs.checked; };
syncCsFs();
csFs.addEventListener('change', () => {
if (csFs.checked === sfFs.checked) return;
sfFs.checked = csFs.checked;
sfFs.dispatchEvent(new Event('change', { bubbles: true }));
});
csAddSync(syncCsFs);
}
const csEg = document.getElementById('cs-edge-guard');
const sfEg = document.getElementById('sf-edge-guard');
if (csEg && sfEg) {
const syncCsEg = () => { if (sfEg.checked !== csEg.checked) csEg.checked = sfEg.checked; };
syncCsEg();
csEg.addEventListener('change', () => {
if (csEg.checked === sfEg.checked) return;
sfEg.checked = csEg.checked;
sfEg.dispatchEvent(new Event('change', { bubbles: true }));
});
csAddSync(syncCsEg);
}
const csMf = document.getElementById('cs-music-float');
if (csMf) {
const mfGet = () => { // 返回「隐藏中」= !floatEn；floatEn 默认开 → 默认不隐藏
if (window.musicFloatGet) return !window.musicFloatGet();
try {
const s = JSON.parse(store.get('music-global') || '{}');
return s.floatEn !== undefined ? !s.floatEn : false;
} catch (e) { return false; }
};
const mfSet = (hide) => {
if (window.musicFloatSet) { window.musicFloatSet(!hide); return; }
try {
const s = JSON.parse(store.get('music-global') || '{}');
s.floatEn = !hide;
store.set('music-global', JSON.stringify(s));
} catch (e) {}
};
const syncCsMf = () => { const v = mfGet(); if (v !== csMf.checked) csMf.checked = v; };
syncCsMf();
csMf.addEventListener('change', () => {
if (csMf.checked === mfGet()) return;
mfSet(csMf.checked);
toast(csMf.checked ? '音乐悬浮小窗已隐藏：播放时不再显示右上角悬浮小框' : '音乐悬浮小窗已恢复显示：播放时右上角出现悬浮小框');
});
csAddSync(syncCsMf);
document.addEventListener('contact-switched', syncCsMf);
}
const csCmh = document.getElementById('cs-call-mini-hide');
if (csCmh) {
const cmhGet = () => {
if (window.getCallMiniEnabled) return !window.getCallMiniEnabled();
try { return store.get('call-mini-enabled') === '0'; } catch (e) { return false; }
};
const cmhSet = (hide) => {
if (window.setCallMiniEnabled) { window.setCallMiniEnabled(!hide); return; }
try { store.set('call-mini-enabled', hide ? '0' : '1'); } catch (e) {}
};
const syncCsCmh = () => { const v = cmhGet(); if (v !== csCmh.checked) csCmh.checked = v; };
syncCsCmh();
csCmh.addEventListener('change', () => {
if (csCmh.checked === cmhGet()) return;
cmhSet(csCmh.checked);
toast(csCmh.checked ? '通话小框已隐藏：接通后保持通话面板，不弹出悬浮小框' : '通话小框已开启：接通后自动最小化为悬浮小框');
});
csAddSync(syncCsCmh);
document.addEventListener('contact-switched', syncCsCmh);
}
const sfGc = document.getElementById('sf-group-chat');
if (sfGc) {
const GNS = 'xy-home-v2';
const gcGet = () => {
try { const v = window.xyStore ? window.xyStore(GNS).get('group-chat-enabled') : null; if (v !== null && v !== undefined) return v === '1'; } catch (e) {}
try { return store.get('group-chat-enabled') === '1'; } catch (e) { return false; }
};
const gcSet = (en) => { try { if (window.xyStore) window.xyStore(GNS).set('group-chat-enabled', en ? '1' : '0'); } catch (e) {} };
const syncGc = () => { const v = gcGet(); if (v !== sfGc.checked) sfGc.checked = v; };
syncGc();
sfGc.addEventListener('change', () => {
if (sfGc.checked === gcGet()) return;
gcSet(sfGc.checked);
try { document.dispatchEvent(new Event('group-chat-mode-changed')); } catch (e) {}
toast(sfGc.checked ? '群聊已开启：桌面新增群聊按钮，占卜按钮已隐藏（可在美化装修模式添加到其他页面）' : '群聊已关闭，占卜按钮已恢复');
});
csAddSync(syncGc);
document.addEventListener('contact-switched', syncGc);
}
const csDtm = document.getElementById('cs-del-ta-msg');
if (csDtm) {
const dtmGet = () => { try { return store.get('cs-del-ta-msg') === '1'; } catch (e) { return false; } };
const dtmSet = (en) => { try { store.set('cs-del-ta-msg', en ? '1' : '0'); } catch (e) {} };
const syncDtm = () => { const v = dtmGet(); if (v !== csDtm.checked) csDtm.checked = v; };
syncDtm();
csDtm.addEventListener('change', () => {
if (csDtm.checked === dtmGet()) return;
dtmSet(csDtm.checked);
toast(csDtm.checked ? '已开启：点击联系人消息可在操作菜单里删除该条消息' : '已关闭删除联系人消息功能');
});
document.addEventListener('contact-switched', syncDtm);
}
const csBs = document.getElementById('cs-batch-send');
if (csBs) {
const bsGet = () => { try { return store.get('cs-batch-send') === '1'; } catch (e) { return false; } };
const bsSet = (en) => { try { store.set('cs-batch-send', en ? '1' : '0'); } catch (e) {} };
const syncBs = () => { const v = bsGet(); if (v !== csBs.checked) csBs.checked = v; };
syncBs();
csBs.addEventListener('change', () => {
if (csBs.checked === bsGet()) return;
bsSet(csBs.checked);
try { document.dispatchEvent(new Event('batch-send-changed')); } catch (e) {}
toast(csBs.checked ? '已开启：聊天输入栏右侧显示「批量发送」按钮，可插入表情包/图片/文字批量发送' : '已关闭：聊天输入栏「批量发送」按钮已隐藏');
});
document.addEventListener('contact-switched', syncBs);
}
const csVs = document.getElementById('cs-voice-send');
if (csVs) {
const vsGet = () => { try { return store.get('cs-voice-send') === '1'; } catch (e) { return false; } };
const vsSet = (en) => { try { store.set('cs-voice-send', en ? '1' : '0'); } catch (e) {} };
const syncVs = () => { const v = vsGet(); if (v !== csVs.checked) csVs.checked = v; };
syncVs();
csVs.addEventListener('change', () => {
vsSet(csVs.checked);
try { document.dispatchEvent(new Event('voice-send-changed')); } catch (e) {}
toast(csVs.checked ? '已开启：聊天输入栏左侧显示「麦克风」按钮，点击可录音并发送语音' : '已关闭：聊天输入栏「麦克风」按钮已隐藏');
});
document.addEventListener('contact-switched', syncVs);
document.addEventListener('mochi-wrj-heal', syncVs);
}
const IO_META = {
mic: { label: '录音（语音消息）', sub: '开关：聊天设置 →「我可发送语音」' },
continue: { label: '继续说', sub: '开关：回复设置 →「聊天栏继续说按钮」' },
more: { label: '更多功能' },
emoji: { label: '表情包' },
input: { label: '输入框', sub: '位置可调、不可移除；把按钮挪到它前面／后面即换到另一侧' },
img: { label: '插入图片' },
batch: { label: '批量发送', sub: '开关：聊天设置 →「批量发送消息」' }
};
const IO_SWITCHED = { mic: 1, continue: 1, batch: 1 }; // 带独立开关的项：未开时列表标「开关未开启」
const IO_BTN_STYLE = 'width:34px;height:34px;flex-shrink:0;border:1px solid var(--card-border,#e0e0e0);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:15px;line-height:1;font-family:inherit;cursor:pointer';
const inputOrderRead = () => (window.mochiInputOrder ? window.mochiInputOrder.read() : []);
function inputOrderPanelOpen() {
const m = document.getElementById('cs-input-order-panel');
return !!(m && m.style.display === 'flex');
}
function inputOrderSync() {
const el = document.getElementById('cs-input-order-val');
if (el) el.textContent = (window.mochiInputOrder && !window.mochiInputOrder.isDefault()) ? '已自定义' : '默认排列';
}
function inputOrderIcon(token) {
if (token === 'input') return '';
const src = document.querySelector('#page-chat .chat-input-row [data-io="' + token + '"]');
return src ? src.innerHTML : '';
}
function inputOrderHidden(token) {
if (!IO_SWITCHED[token]) return false;
const src = document.querySelector('#page-chat .chat-input-row [data-io="' + token + '"]');
return !!(src && src.style.display === 'none');
}
function inputOrderMove(token, dir) {
if (!window.mochiInputOrder) return;
const order = inputOrderRead().slice();
const i = order.indexOf(token), j = i + dir;
if (i < 0 || j < 0 || j >= order.length) return;
order[i] = order[j];
order[j] = token;
window.mochiInputOrder.write(order);
inputOrderSync();
renderInputOrderPanel();
}
function renderInputOrderPanel() {
const m = document.getElementById('cs-input-order-panel');
const box = m && m.firstChild;
if (!box) return;
const order = inputOrderRead();
box.innerHTML = '';
const hd = document.createElement('div');
hd.innerHTML = '<div style="font-size:16px;font-weight:600">输入栏按钮位置</div>'
+ '<div style="font-size:12px;color:var(--muted,#888);margin-top:5px;line-height:1.5">'
+ '点 ← → 调整左右顺序（列表自上而下＝从最左到最右）；「发送」按钮固定在最右端，不参与排序。'
+ '此项只影响排列位置，不影响各按钮的开关与显隐。</div>';
box.appendChild(hd);
const prev = document.createElement('div');
prev.style.cssText = 'display:flex;align-items:center;gap:6px;padding:10px;margin:10px 0 12px;border-radius:12px;background:var(--bg-b,#f5f5f5);overflow-x:auto';;
order.forEach((t) => {
if (t === 'input') {
const iw = document.createElement('div');
iw.textContent = '说点什么…';
iw.style.cssText = 'flex:1;min-width:46px;font-size:11px;color:var(--hint-ink,#b5b5b5);padding:5px 9px;border-radius:99px;background:var(--card-bg,#fff);border:1px solid rgba(0,0,0,.08);white-space:nowrap;overflow:hidden';
prev.appendChild(iw);
return;
}
const ic = document.createElement('div');
ic.innerHTML = inputOrderIcon(t);
ic.style.cssText = 'width:26px;height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--card-bg,#fff);border:1px solid rgba(0,0,0,.08);color:var(--ink,#111);'
+ (inputOrderHidden(t) ? 'opacity:.35' : '');
const svg = ic.querySelector('svg');
if (svg) { svg.style.width = '16px'; svg.style.height = '16px'; }
prev.appendChild(ic);
});
const sendChip = document.createElement('div');
sendChip.textContent = '发送';
sendChip.style.cssText = 'flex-shrink:0;font-size:11px;font-weight:600;color:#fff;background:var(--ink,#111);border-radius:99px;padding:5px 12px';
prev.appendChild(sendChip);
box.appendChild(prev);
order.forEach((t, idx) => {
const meta = IO_META[t] || { label: t };
const rowEl = document.createElement('div');
rowEl.setAttribute('data-io-row', t); // 稳定钩子：回归脚本按令牌定位「某按钮的左/右移」
rowEl.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid rgba(0,0,0,.07);border-radius:11px;margin-bottom:8px';
const ic = document.createElement('div');
ic.innerHTML = inputOrderIcon(t);
ic.style.cssText = 'width:22px;height:22px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--ink,#111)';
const svg = ic.querySelector('svg');
if (svg) { svg.style.width = '19px'; svg.style.height = '19px'; }
rowEl.appendChild(ic);
const txt = document.createElement('div');
txt.style.cssText = 'flex:1;min-width:0;font-size:13.5px;line-height:1.4';
const nm = document.createElement('div');
nm.textContent = meta.label;
txt.appendChild(nm);
const note = document.createElement('div');
note.style.cssText = 'font-size:11px;color:var(--muted,#888);margin-top:1px';
note.textContent = '第 ' + (idx + 1) + ' 位'
+ (inputOrderHidden(t) ? ' · 开关未开启（打开后按此位置显示）' : (meta.sub ? ' · ' + meta.sub : ''));
txt.appendChild(note);
rowEl.appendChild(txt);
[-1, 1].forEach((dir) => {
const atEnd = dir < 0 ? idx === 0 : idx === order.length - 1;
const mv = document.createElement('button');
mv.type = 'button';
mv.textContent = dir < 0 ? '←' : '→';
mv.title = dir < 0 ? '向左移' : '向右移';
mv.disabled = atEnd;
mv.setAttribute('data-io-move', String(dir)); // 稳定钩子：-1=向左移，1=向右移
mv.style.cssText = IO_BTN_STYLE + (atEnd ? ';opacity:.3' : '');
mv.addEventListener('click', (e) => { e.stopPropagation(); inputOrderMove(t, dir); });
rowEl.appendChild(mv);
});
box.appendChild(rowEl);
});
const resetBtn = document.createElement('button');
resetBtn.type = 'button';
resetBtn.textContent = '恢复默认排列';
resetBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;margin-bottom:8px;font-family:inherit;cursor:pointer';
resetBtn.addEventListener('click', () => {
if (!window.mochiInputOrder) return;
window.mochiInputOrder.reset();
inputOrderSync();
renderInputOrderPanel();
toast('已恢复默认排列');
});
box.appendChild(resetBtn);
if (window.getContacts && window.xyStore && window.openModal) {
const syncBtn = document.createElement('button');
syncBtn.type = 'button';
syncBtn.textContent = '同步到全部联系人';
syncBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;margin-bottom:8px;font-family:inherit;cursor:pointer';
syncBtn.addEventListener('click', () => {
const me = window.getActiveContact ? window.getActiveContact() : 'default';
const others = window.getContacts().filter(c => c.id && c.id !== me);
if (!others.length) { toast('现在只有这一个联系人，无需同步'); return; }
window.openModal('同步到全部联系人', '', (v) => {
if (v !== '__yes__') return;
const order = inputOrderRead();
let n = 0;
others.forEach((c) => {
try {
window.xyStore('xy-home-v2:' + c.id).set('cs-input-order', JSON.stringify(order));
n++;
} catch (e) {}
});
toast('已同步到 ' + n + ' 个联系人（切到对应桌面即可看到）');
}, { noInput: true, pills: [{ label: '确认同步（覆盖对方的输入栏顺序）', value: '__yes__' }, { label: '取消', value: '__no__' }] });
});
box.appendChild(syncBtn);
}
const closeBtn = document.createElement('button');
closeBtn.type = 'button';
closeBtn.textContent = '关闭';
closeBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555);font-size:13px;font-family:inherit;cursor:pointer';
closeBtn.addEventListener('click', closeInputOrderPanel);
box.appendChild(closeBtn);
}
function closeInputOrderPanel() {
const m = document.getElementById('cs-input-order-panel');
if (!m) return;
m.hidden = true;
m.style.display = 'none';
}
function openInputOrderPanel() {
let m = document.getElementById('cs-input-order-panel');
if (!m) {
m = document.createElement('div');
m.id = 'cs-input-order-panel';
m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
document.body.appendChild(m);
m.addEventListener('click', (e) => { if (e.target === m) closeInputOrderPanel(); });
const box = document.createElement('div');
box.style.cssText = 'width:min(90vw,400px);max-height:82vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
m.appendChild(box);
}
renderInputOrderPanel();
m.hidden = false;
m.style.display = 'flex';
}
const csIo = row('cs-input-order');
if (csIo) {
inputOrderSync();
csIo.addEventListener('click', openInputOrderPanel);
document.addEventListener('contact-switched', () => {
inputOrderSync();
closeInputOrderPanel();
});
document.addEventListener('chat-input-order-changed', inputOrderSync);
document.addEventListener('batch-send-changed', () => { if (inputOrderPanelOpen()) renderInputOrderPanel(); });
document.addEventListener('voice-send-changed', () => { if (inputOrderPanelOpen()) renderInputOrderPanel(); });
}
window.mochiInputOrderPanel = {
open: openInputOrderPanel,
close: closeInputOrderPanel,
valueText: () => (window.mochiInputOrder && !window.mochiInputOrder.isDefault() ? '已自定义' : '默认排列')
};
const csRpProb = row('cs-rp-auto-prob');
if (csRpProb) {
const rpProbGet = () => {
let v = null; try { v = parseFloat(store.get('cs-rp-auto-prob')); } catch (e) {}
return (v !== null && isFinite(v)) ? Math.max(0, Math.min(100, Math.round(v))) : 4;
};
const rpProbSync = () => { const el = document.getElementById('cs-rp-auto-prob-val'); if (el) el.textContent = rpProbGet() + '%'; };
rpProbSync();
csRpProb.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('TA 自动发红包概率（0-100%·每联系人独立）', String(rpProbGet()), (v) => {
const t = String(v || '').trim();
let n = parseFloat(t);
if (!isFinite(n)) n = 4;
n = Math.max(0, Math.min(100, Math.round(n)));
store.set('cs-rp-auto-prob', String(n));
rpProbSync();
toast('已设置：TA 自动发红包概率为 ' + n + '%');
}, { maxlength: 3 });
});
document.addEventListener('contact-switched', rpProbSync);
if (typeof window !== 'undefined') window.csRpSyncProb = rpProbSync;
}
const csRpDailyMax = row('cs-rp-daily-max');
if (csRpDailyMax) {
const rpMaxGet = () => {
let v = null; try { v = parseInt(store.get('cs-rp-daily-max'), 10); } catch (e) {}
return (v !== null && isFinite(v) && v >= 0) ? v : 5;
};
const rpMaxSync = () => { const el = document.getElementById('cs-rp-daily-max-val'); if (el) el.textContent = rpMaxGet() === 0 ? '不限' : rpMaxGet() + ' 次'; };
rpMaxSync();
csRpDailyMax.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('TA 每日发红包上限（0-99 次·0=不限）', String(rpMaxGet()), (v) => {
let n = parseInt(String(v || '').trim(), 10);
if (!isFinite(n)) n = 5;
n = Math.max(0, Math.min(99, n));
store.set('cs-rp-daily-max', String(n));
rpMaxSync();
toast(n === 0 ? '已设置：TA 每日发红包不限次数' : '已设置：TA 每天最多发 ' + n + ' 个红包');
}, { maxlength: 2 });
});
document.addEventListener('contact-switched', rpMaxSync);
if (typeof window !== 'undefined') window.csRpSyncMax = rpMaxSync;
}
const csRpAskProb = row('cs-rp-ask-prob');
if (csRpAskProb) {
const rpAskProbGet = () => {
let r = 0.04; try { if (window.rpAskProbRate) r = window.rpAskProbRate(); } catch (e) {}
return Math.max(0, Math.min(100, Math.round(r * 100)));
};
const rpAskProbSync = () => { const el = document.getElementById('cs-rp-ask-prob-val'); if (el) el.textContent = rpAskProbGet() + '%'; };
rpAskProbSync();
csRpAskProb.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('TA 申请心意币概率（0-100%·每联系人独立）', String(rpAskProbGet()), (v) => {
let n = parseFloat(String(v || '').trim());
if (!isFinite(n)) n = 4;
n = Math.max(0, Math.min(100, Math.round(n)));
store.set('cs-rp-ask-prob', String(n));
rpAskProbSync();
toast('已设置：TA 申请心意币概率为 ' + n + '%');
}, { maxlength: 3 });
});
document.addEventListener('contact-switched', rpAskProbSync);
if (typeof window !== 'undefined') window.csRpSyncAskProb = rpAskProbSync;
}
const csRpAskMax = row('cs-rp-ask-daily-max');
if (csRpAskMax) {
const rpAskMaxGet = () => {
let v = 0; try { if (window.rpAskDailyMax) v = window.rpAskDailyMax(); } catch (e) {}
return (isFinite(v) && v >= 0) ? v : 0;
};
const rpAskMaxSync = () => { const el = document.getElementById('cs-rp-ask-daily-max-val'); if (el) el.textContent = rpAskMaxGet() === 0 ? '不限' : rpAskMaxGet() + ' 次'; };
rpAskMaxSync();
csRpAskMax.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('TA 每日申请心意币上限（0-99 次·0=不限）', String(rpAskMaxGet()), (v) => {
let n = parseInt(String(v || '').trim(), 10);
if (!isFinite(n)) n = 0;
n = Math.max(0, Math.min(99, n));
store.set('cs-rp-ask-daily-max', String(n));
rpAskMaxSync();
toast(n === 0 ? '已设置：TA 申请心意币不限次数' : '已设置：TA 每天最多申请 ' + n + ' 次');
}, { maxlength: 2 });
});
document.addEventListener('contact-switched', rpAskMaxSync);
if (typeof window !== 'undefined') window.csRpSyncAskMax = rpAskMaxSync;
}
if (!document.getElementById('cs-rp-thx-box')) {
const rpSetBox = document.getElementById('rp-settings');
const rpDoneBtn = rpSetBox ? rpSetBox.querySelector('.rp-settings-done') : null;
if (rpSetBox && rpDoneBtn) {
const rpThxBox = document.createElement('div');
rpThxBox.id = 'cs-rp-thx-box';
rpThxBox.innerHTML = '<div class="rp-settings-title">红包领后捎一句话</div>' +
'<div class="set-row" id="cs-rp-thx-en"><div class="txt">领后捎一句话<span class="sub">红包被领取后（我领 TA 的 / TA 领我的）TA 有概率主动捎一句，固定一条、不受「回复条数」限制；每个联系人单独设置</span></div><div class="val" id="cs-rp-thx-en-val">开</div></div>' +
'<div class="set-row" id="cs-rp-thx-prob"><div class="txt">捎话概率<span class="sub">开关命中后再按这个概率决定这次说不说</span></div><div class="val" id="cs-rp-thx-prob-val">60%</div></div>' +
'<div class="set-row" id="cs-rp-thx-mode"><div class="txt">捎话内容<span class="sub">系统预设话术随机一句 / 和正常聊天一样回复 / 混合</span></div><div class="val" id="cs-rp-thx-mode-val">混合</div></div>';
rpSetBox.insertBefore(rpThxBox, rpDoneBtn);
}
}
if (document.getElementById('cs-rp-thx-box')) {
const rpThxGet = () => {
const out = { en: 1, prob: 60, mode: 2 };
try {
const c = (window.replyCfg && window.replyCfg()) || {};
out.en = Number(c['rp-thx-en']) === 0 ? 0 : 1;
const p = Number(c['rp-thx-prob']);
out.prob = isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 60;
const m = Number(c['rp-thx-mode']);
out.mode = (m === 0 || m === 1 || m === 2) ? m : 2;
} catch (e) {}
return out;
};
const rpThxLabel = (v) => {
const list = window.rpThxModeList || [{ label: '系统预设话术', value: 0 }, { label: '像正常聊天一样回复', value: 1 }, { label: '混合', value: 2 }];
for (let i = 0; i < list.length; i++) { if (Number(list[i].value) === Number(v)) return list[i].label; }
return '混合';
};
const rpThxSync = () => {
const cur = rpThxGet();
const setVal = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
setVal('cs-rp-thx-en-val', cur.en ? '开' : '已关闭');
setVal('cs-rp-thx-prob-val', cur.prob + '%');
setVal('cs-rp-thx-mode-val', rpThxLabel(cur.mode));
try { if (window.rpThxModeSync) window.rpThxModeSync(); } catch (e) {}
};
rpThxSync();
const rpThxAsk = (id, title, value, cb, opts) => {
const el = document.getElementById(id);
if (!el || !window.openModal) return;
const evalv = (x) => (typeof x === 'function' ? x() : x);
el.addEventListener('click', () => {
const v = evalv(value);
window.openModal(evalv(title), v == null ? '' : String(v), cb, evalv(opts));
});
};
rpThxAsk('cs-rp-thx-en', '红包领后捎一句话', null, (v) => {
const on = v === 'on' ? 1 : 0;
window.saveReplyCfg('rp-thx-en', on);
rpThxSync();
toast(on === 1 ? '已开启：红包被领取后 TA 有概率捎一句话' : '已关闭：领红包后不再捎话');
}, () => ({ noInput: true, pill: rpThxGet().en ? 'on' : 'off', pills: [{ label: '开', value: 'on' }, { label: '关', value: 'off' }] }));
rpThxAsk('cs-rp-thx-prob', '捎话概率（0-100%·每联系人独立）', () => rpThxGet().prob, (v) => {
let n = parseFloat(String(v || '').trim());
if (!isFinite(n)) { toast('请填 0~100 的数字'); return; }
n = Math.max(0, Math.min(100, Math.round(n)));
window.saveReplyCfg('rp-thx-prob', n);
rpThxSync();
toast('已设置：捎话概率 ' + n + '%');
}, { maxlength: 3 });
rpThxAsk('cs-rp-thx-mode', '捎话内容', null, (v) => {
const n = Number(v);
if (n !== 0 && n !== 1 && n !== 2) return;
window.saveReplyCfg('rp-thx-mode', n);
rpThxSync();
toast('已设置：捎话内容＝' + rpThxLabel(n));
}, () => ({ noInput: true, pill: String(rpThxGet().mode), pills: [{ label: '系统预设话术', value: '0' }, { label: '像正常聊天一样回复', value: '1' }, { label: '混合', value: '2' }] }));
document.addEventListener('contact-switched', rpThxSync);
if (typeof window !== 'undefined') window.csRpSyncThx = rpThxSync;
}
if (typeof window !== 'undefined') {
window.csRpSettingsSync = function () {
try { if (window.csRpSyncProb) window.csRpSyncProb(); } catch (e) {}
try { if (window.csRpSyncMax) window.csRpSyncMax(); } catch (e) {}
try { if (window.csRpSyncAskProb) window.csRpSyncAskProb(); } catch (e) {}
try { if (window.csRpSyncAskMax) window.csRpSyncAskMax(); } catch (e) {}
try { if (window.csRpSyncThx) window.csRpSyncThx(); } catch (e) {}
};
}
const csHts = document.getElementById('cs-hide-ta-sticker');
if (csHts) {
const GNS = 'xy-home-v2';
const KEY = 'hide-ta-sticker';
const htsGet = () => {
try { if (window.xyStore) return window.xyStore(GNS).get(KEY) === '1'; } catch (e) {}
try { return store.get(KEY) === '1'; } catch (e) { return false; }
};
const htsSet = (en) => { try { if (window.xyStore) window.xyStore(GNS).set(KEY, en ? '1' : '0'); } catch (e) {} };
const syncHts = () => { const v = htsGet(); if (v !== csHts.checked) csHts.checked = v; };
syncHts();
csHts.addEventListener('change', () => {
if (csHts.checked === htsGet()) return;
htsSet(csHts.checked);
try { document.dispatchEvent(new Event('hide-ta-sticker-changed')); } catch (e) {}
toast(csHts.checked ? '已隐藏：聊天和朋友圈的表情包面板只显示「我的表情包」' : '已恢复显示 TA 的和公用表情包');
});
csAddSync(syncHts);
document.addEventListener('contact-switched', syncHts);
}
const htsRow = document.getElementById('cs-hide-ta-sticker-row');
if (htsRow && htsRow.parentNode) {
const GNS2 = 'xy-home-v2';
const HIDE_CATS = [
['hide-tab-kaomoji', '隐藏颜文字', '隐藏后，表情包面板不再显示【颜文字】分类（字卡库数据不受影响）'],
['hide-tab-emoji', '隐藏emoji', '隐藏后，表情包面板不再显示【emoji】分类（字卡库数据不受影响）']
];
let prevRow = htsRow;
HIDE_CATS.forEach(([key, label, sub]) => {
const row = document.createElement('div');
row.className = 'set-row';
row.id = 'cs-' + key + '-row';
row.innerHTML =
'<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01"/><path d="M8.5 14a4.5 4.5 0 007 0"/></svg></div>' +
'<div class="txt">' + label + '<span class="sub">' + sub + '</span></div>' +
'<label class="toggle"><input type="checkbox"><span class="tk"></span></label>';
const box = row.querySelector('input');
const catGet = () => { try { return window.xyStore(GNS2).get(key) === '1'; } catch (e) { return false; } };
const catSet = (en) => { try { window.xyStore(GNS2).set(key, en ? '1' : '0'); } catch (e) {} };
const syncCat = () => { const v = catGet(); if (v !== box.checked) box.checked = v; };
syncCat();
box.addEventListener('change', () => {
if (box.checked === catGet()) return;
catSet(box.checked);
try { document.dispatchEvent(new Event('hide-tab-changed')); } catch (e) {}
toast(box.checked ? '已隐藏：表情包面板不再显示【' + label.replace('隐藏', '') + '】' : '已恢复显示【' + label.replace('隐藏', '') + '】');
});
csAddSync(syncCat);
document.addEventListener('contact-switched', syncCat);
prevRow.parentNode.insertBefore(row, prevRow.nextSibling);
prevRow = row;
});
const tcRow = document.createElement('div');
tcRow.className = 'set-row';
tcRow.id = 'cs-chat-textcard-direct-row';
tcRow.innerHTML =
'<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/><path d="M8 10h8M8 13.5h5"/></svg></div>' +
'<div class="txt">颜文字/emoji 点击直接发送<span class="sub">关（默认）：点击后只填进聊天输入栏，可连点多条，发不发由你点「发送」决定；开：点一下立刻发出。只对【颜文字】【emoji】两个分类生效，表情包图片不受影响。</span></div>' +
'<label class="toggle"><input type="checkbox"><span class="tk"></span></label>';
const tcBox = tcRow.querySelector('input');
const tcGet = () => { try { return window.xyStore(GNS2).get('chat-textcard-direct') === '1'; } catch (e) { return false; } };
const tcSet = (en) => { try { window.xyStore(GNS2).set('chat-textcard-direct', en ? '1' : '0'); } catch (e) {} };
const tcSync = () => { const v = tcGet(); if (v !== tcBox.checked) tcBox.checked = v; };
tcSync();
tcBox.addEventListener('change', () => {
if (tcBox.checked === tcGet()) return;
tcSet(tcBox.checked);
toast(tcBox.checked
? '已设置：点【颜文字】【emoji】直接发送'
: '已设置：点【颜文字】【emoji】先填入输入栏，由你决定何时发送');
});
csAddSync(tcSync);
document.addEventListener('contact-switched', tcSync);
prevRow.parentNode.insertBefore(tcRow, prevRow.nextSibling);
const pwRow = document.createElement('div');
pwRow.className = 'set-row';
pwRow.id = 'cs-chat-panel-prewarm-row';
pwRow.innerHTML =
'<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z"/></svg></div>' +
'<div class="txt">打开面板前提前加载图片<span class="sub">开（默认）：进桌面后在空闲时提前加载表情包面板和头像互动的首屏图片，点开不再闪一下重新加载（省流的懒加载不受影响）。关：退回「点开才加载」，点开瞬间可能闪一下。建议保持开启。</span></div>' +
'<label class="toggle"><input type="checkbox"><span class="tk"></span></label>';
const pwBox = pwRow.querySelector('input');
const pwGet = () => { try { return window.xyStore(GNS2).get('chat-panel-prewarm') !== '0'; } catch (e) { return true; } };
const pwSet = (en) => { try { window.xyStore(GNS2).set('chat-panel-prewarm', en ? '1' : '0'); } catch (e) {} };
const pwSync = () => { const v = pwGet(); if (v !== pwBox.checked) pwBox.checked = v; };
pwSync();
pwBox.addEventListener('change', () => {
if (pwBox.checked === pwGet()) return;
pwSet(pwBox.checked);
toast(pwBox.checked
? '已开启：进桌面后会提前加载表情包/头像图片'
: '已关闭：表情包/头像图片改为点开面板时才加载');
});
csAddSync(pwSync);
document.addEventListener('contact-switched', pwSync);
tcRow.parentNode.insertBefore(pwRow, tcRow.nextSibling);
}
function csDrawerEl() {
let d = document.getElementById('chat-beauty-drawer');
if (!d) { d = document.createElement('div'); d.id = 'chat-beauty-drawer'; document.body.appendChild(d); }
return d;
}
let csDrawerBaseZ = '';
const CS_DRAWER_OVERLAYS = ['.modal-mask', '#cs-bg-panel', '#cs-bg-adj-panel', '#qa-mask', '#tc-mask', '#chat-ask-panel'];
function csDrawerLayerTick() {
const d = document.getElementById('chat-beauty-drawer');
if (!d || d.style.display === 'none') return;
const chat = document.getElementById('page-chat');
if (chat && chat.hidden) {
clearInterval(csDrawerWatchTimer); csDrawerWatchTimer = 0;
d.style.display = 'none';
try { csDemoBubbles(false); } catch (e) {}
return;
}
let low = 0;
CS_DRAWER_OVERLAYS.forEach((sel) => {
document.querySelectorAll(sel).forEach((el) => {
if (el.hidden || el.style.display === 'none') return;
if (!el.isConnected) return;
const cs = getComputedStyle(el);
if (cs.display === 'none' || cs.visibility !== 'visible') return;
const box = el.getBoundingClientRect();
if (!box.width || !box.height) return;
const z = parseInt(cs.zIndex, 10) || 0;
if (z && (!low || z < low)) low = z;
});
});
const want = low ? String(Math.max(1, low - 1)) : csDrawerBaseZ;
if (d.style.zIndex !== want) d.style.zIndex = want;
}
let csDrawerWatchTimer = 0;
const csDrawerBgSig = () => {
try { return (store.get('cs-bg') ? '1' : '0') + '|' + String(store.get(CS_BG_ACTIVE) || ''); } catch (e) { return ''; }
};
function csDrawerClose() {
clearInterval(csDrawerWatchTimer); csDrawerWatchTimer = 0;
try { csDemoBubbles(false); } catch (e) {}
try {
const d = document.getElementById('chat-beauty-drawer');
if (d) d.style.display = 'none';
document.querySelectorAll('.page').forEach(pg => { if (!pg.hidden) pg.hidden = true; });
const pg = document.getElementById('page-chat-settings');
if (pg) pg.hidden = false;
document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
const st = document.querySelector('.tab[data-page="page-setting"]');
if (st) st.classList.add('active');
const tabs = document.getElementById('cs-tabs');
if (tabs) { const b = tabs.querySelector('.them-tab[data-tab="beautify"]'); if (b) b.click(); }
} catch (e) {}
}
let csBeautyDockBot = null; // null=贴底；否则＝距屏幕底边 px（会话内）
let csKbLiftBound = false;
function csDrawerApplyBottom() {
const d = document.getElementById('chat-beauty-drawer');
if (!d || d.style.display === 'none') return;
const vv = window.visualViewport;
const lift = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
d.style.bottom = Math.max(lift, csBeautyDockBot || 0) + 'px';
const vh = vv ? vv.height : window.innerHeight;
d.style.maxHeight = lift ? Math.max(150, Math.round(vh * 0.45)) + 'px' : '40vh';
}
function csDrawerBindKbLift() {
if (csKbLiftBound || !window.visualViewport) return;
csKbLiftBound = true;
const f = () => { try { csDrawerApplyBottom(); } catch (e) {} };
try {
window.visualViewport.addEventListener('resize', f);
window.visualViewport.addEventListener('scroll', f);
} catch (e) {}
}
function csDemoBubbles(on) {
const body = document.getElementById('chat-body');
if (!body) return;
Array.prototype.forEach.call(body.querySelectorAll('.msg[data-cs-demo]'), n => n.remove());
if (!on) return;
const mk = (out, text) => {
const m = document.createElement('div');
m.className = 'msg ' + (out ? 'msg-out' : 'msg-in');
m.dataset.csDemo = '1';
const side = '<div class="msg-side"><div class="msg-av"></div><span class="msg-time">13:14</span></div>';
m.innerHTML = out
? '<div class="msg-bubble">' + text + '</div>' + side
: side + '<div class="msg-bubble"><span class="msg-hi-mark">*~*</span>' + text + '</div>';
['click', 'dblclick', 'contextmenu', 'touchend'].forEach(ev => m.addEventListener(ev, e => { e.stopPropagation(); }));
try { if (window.fillAvatar) { window.fillAvatar(m.querySelector('.msg-av'), out ? 'cs-avatar-user' : 'cs-avatar-partner'); } } catch (e) {}
return m;
};
body.appendChild(mk(false, '这是一条示例气泡（仅供预览，不会发送也不会保存）——改气泡颜色、透明度、圆角、字号就在这看效果'));
body.appendChild(mk(true, '我的气泡也长这样～'));
}
let csDrawerSec = 'bubble';
function openChatBeautyDrawer() {
try {
document.querySelectorAll('.page').forEach(pg => { if (!pg.hidden) pg.hidden = true; });
const chat = document.getElementById('page-chat');
if (chat) chat.hidden = false;
document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
const ct = document.querySelector('.tab[data-page="page-chat"]');
if (ct) ct.classList.add('active');
} catch (e) {}
const d = csDrawerEl();
d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:95;max-height:40vh;transition:bottom .16s ease;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);color:var(--ink,#111);box-shadow:0 -6px 24px rgba(0,0,0,.18);border-radius:16px 16px 0 0;overflow-y:auto;overflow-x:hidden;padding:0 12px calc(10px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)));box-sizing:border-box;display:flex;flex-direction:column;gap:8px';
d.innerHTML = '';
const csBaseZ = parseInt(getComputedStyle(d).zIndex, 10);
csDrawerBaseZ = csBaseZ > 0 ? String(csBaseZ) : '';
const grip = document.createElement('div');
grip.style.cssText = 'width:36px;height:4px;border-radius:2px;background:var(--card-border,#ddd);margin:7px auto 0;flex:none';
d.appendChild(grip);
const mkMini = (label, fn, cssExtra) => {
const b = document.createElement('button');
b.type = 'button';
b.textContent = label;
b.style.cssText = 'flex:none;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;border-radius:8px;padding:6px 11px;cursor:pointer' + (cssExtra || '');
b.addEventListener('click', fn);
return b;
};
const hd = document.createElement('div');
hd.style.cssText = 'display:flex;align-items:center;gap:8px;flex:none';
const hdTxt = document.createElement('span');
hdTxt.textContent = '边看边调（即时生效）';
hdTxt.style.cssText = 'font-size:13px;font-weight:700;flex:none';
const hdHint = document.createElement('span');
hdHint.textContent = '按住标题行上下拖 · 让开看聊天';
hdHint.style.cssText = 'font-size:11px;color:var(--muted,#888);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
const bindDockDrag = (el) => {
el.style.touchAction = 'none';
let sy = 0, sb = 0, drag = false;
el.addEventListener('pointerdown', (e) => {
if (e.target.closest('button')) return;
if (e.pointerType === 'mouse' && e.button !== 0) return;
drag = true; sy = e.clientY; sb = csBeautyDockBot || 0;
d.style.transition = 'none'; // #1008：拖动期间关掉 bottom 过渡，保证跟手
try { el.setPointerCapture(e.pointerId); } catch (er) {}
e.preventDefault();
});
el.addEventListener('pointermove', (e) => {
if (!drag) return;
csBeautyDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));
csDrawerApplyBottom();
e.preventDefault();
});
const up = () => {
if (!drag) return;
drag = false;
d.style.transition = 'bottom .16s ease'; // #1008：松手恢复过渡（吸附回贴底也是动画）
if ((csBeautyDockBot || 0) < 24) csBeautyDockBot = null; // 接近底部＝吸附回贴底
csDrawerApplyBottom();
};
el.addEventListener('pointerup', up);
el.addEventListener('pointercancel', up);
el.style.cursor = 'grab';
};
bindDockDrag(grip);
const panelBody = document.createElement('div');
panelBody.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:none';
const body = document.createElement('div');
body.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:none';
const foldBtn = mkMini('收起', () => {
const willFold = panelBody.style.display !== 'none';
panelBody.style.display = willFold ? 'none' : 'flex';
foldBtn.textContent = willFold ? '展开' : '收起';
});
const closeBtn = mkMini('\u2715', () => { csDrawerClose(); }, ';padding:6px 10px');
hd.appendChild(hdTxt); hd.appendChild(hdHint); hd.appendChild(foldBtn); hd.appendChild(closeBtn);
d.appendChild(hd);
bindDockDrag(hd); // grip 只有 4px 高，标题行才是主拖拽把手
const chipsRow = document.createElement('div');
chipsRow.style.cssText = 'display:flex;gap:6px;flex:none';
panelBody.appendChild(chipsRow);
panelBody.appendChild(body);
d.appendChild(panelBody);
const mkSlider = (label, get, set, min, max, step, unit, def) => {
const row = document.createElement('div');
row.style.cssText = 'display:flex;align-items:center;gap:8px';
const lb = document.createElement('span');
lb.textContent = label;
lb.style.cssText = 'font-size:11.5px;color:var(--muted,#888);flex:none;width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
const inp = document.createElement('input');
inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step || 1;
inp.value = String(get());
inp.style.cssText = 'flex:1;min-width:0';
const vv = document.createElement('span');
vv.style.cssText = 'font-size:11px;color:var(--muted,#999);flex:none;width:46px;text-align:right';
vv.textContent = inp.value + unit;
inp.addEventListener('input', () => {
vv.textContent = inp.value + unit;
set(Number(inp.value));
});
if (def !== undefined) {
inp.title = '双击恢复默认';
inp.addEventListener('dblclick', () => {
inp.value = String(def);
vv.textContent = def + unit;
set(Number(def));
});
}
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
b.addEventListener('click', () => { set(it.value); paint(b); });
row.appendChild(b);
if (it.value === cur) paint(b);
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
sw.style.cssText = 'width:18px;height:18px;border-radius:5px;border:1px solid var(--card-border,#ddd);flex:none;background:' + def;
const tx = document.createElement('span');
tx.textContent = label;
tx.style.cssText = 'font-size:11.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
const curGet = () => { try { return store.get(key) || def; } catch (e) { return def; } };
const paint = () => { sw.style.background = curGet(); };
const curSet = (v) => {
try { if (v === null) store.remove(key); else store.set(key, v); } catch (e) {}
applySettings(); paint();
};
el.appendChild(sw); el.appendChild(tx); paint();
el.addEventListener('click', () => {
colorItems.forEach(it => { it.el.style.borderColor = 'var(--card-border,#ddd)'; });
el.style.borderColor = 'var(--ink,#111)';
renderCsPalette({ el, label, curGet, curSet, swatchList });
});
colorItems.push({ el, paint });
return el;
};
const renderCsPalette = (item) => {
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
dot.addEventListener('click', () => { item.curSet(c); renderCsPalette(item); });
strip.appendChild(dot);
});
const defBtn = document.createElement('button');
defBtn.type = 'button'; defBtn.textContent = '默认';
defBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
defBtn.addEventListener('click', () => { item.curSet(null); renderCsPalette(item); });
strip.appendChild(defBtn);
const hexBtn = document.createElement('button');
hexBtn.type = 'button'; hexBtn.textContent = '手输色值';
hexBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
hexBtn.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('输入' + item.label + '色值', String(item.curGet() || '#111111'), (v) => {
const c = String(v || '').trim();
if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) { toast('请输入 # 开头的色值，如 #ffd6e0'); return; }
item.curSet(c); renderCsPalette(item);
}, { placeholder: '#ffd6e0' });
});
strip.appendChild(hexBtn);
const hideBtn = document.createElement('button');
hideBtn.type = 'button'; hideBtn.textContent = '收起';
hideBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
hideBtn.addEventListener('click', () => {
paletteHost.innerHTML = '';
colorItems.forEach(it => { it.el.style.borderColor = 'var(--card-border,#ddd)'; });
});
strip.appendChild(hideBtn);
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
const mkAct = (label, fn, bold) => {
const b = document.createElement('button');
b.type = 'button'; b.textContent = label;
b.style.cssText = 'padding:8px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;cursor:pointer' + (bold ? ';font-weight:600' : '');
b.addEventListener('click', fn);
return b;
};
const mkActSurface = (label, fn, surfOpts) => {
const b = mkAct(label, fn);
try { if (window.mochiFilePickSurface) window.mochiFilePickSurface(b, surfOpts || {}); } catch (e) {}
return b;
};
const DEF = themeDefaults();
const setSurface = (i, v) => { try { store.set(CHAT_SURFACE_SETTINGS[i].key, String(v)); } catch (e) {} applySettings(); };
const SECS = [
{ key: 'bubble', label: '气泡', build: () => {
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
wrap.appendChild(mkGrid([
mkColorItem('我的气泡色', 'cs-out-bg', DEF.outBg, BUBBLE_BG_COLORS),
mkColorItem('我的文字色', 'cs-out-ink', DEF.outInk, BUBBLE_INK_COLORS),
mkColorItem('联系人气泡色', 'cs-in-bg', DEF.inBg, BUBBLE_BG_COLORS),
mkColorItem('联系人文字色', 'cs-in-ink', DEF.inInk, BUBBLE_INK_COLORS)
]));
paletteHost = document.createElement('div');
wrap.appendChild(paletteHost);
wrap.appendChild(mkSlider('气泡透明度', () => surfaceValue(CHAT_SURFACE_SETTINGS[2]), v => setSurface(2, v), 0, 100, 1, '%', CHAT_SURFACE_SETTINGS[2].def));
wrap.appendChild(mkSlider('气泡圆角', () => (parseInt(store.get('cs-bubble-radius') || BUBBLE_RADIUS_DEFAULT, 10) || 0), v => { try { store.set('cs-bubble-radius', v + 'px'); } catch (e) {} applySettings(); }, 0, 40, 1, 'px', parseInt(BUBBLE_RADIUS_DEFAULT, 10)));
try {
const cssTxt = String(store.get('cs-bubble-css') || '');
const hitBg = /(^|[^-\w])background(-color|-image)?\s*:/i.test(cssTxt);
const hitRa = /(^|[^-\w])border(-(top|bottom|left|right)){0,2}-radius\s*:/i.test(cssTxt);
if (hitBg || hitRa) {
const bits = [hitBg && '底色', hitRa && '圆角'].filter(Boolean).join('、');
const warn = mkNote('气泡 CSS 里写了' + bits + '声明，这两个滑块会覆盖它（其余声明如阴影、边框照常生效）；想完全按 CSS 来，就把对应声明删掉。');
warn.style.color = 'var(--muted,#999)';
wrap.appendChild(warn);
}
} catch (e) {}
wrap.appendChild(mkPills('气泡字号', FONT_SIZES, () => store.get('cs-font-size') || '14px', v => { try { store.set('cs-font-size', v); } catch (e) {} applySettings(); }));
wrap.appendChild(mkPills('气泡框大小', BUBBLE_SIZES, () => store.get('cs-bubble-size') || '11px 14px', v => { try { store.set('cs-bubble-size', v); } catch (e) {} applySettings(); }));
wrap.appendChild(mkNote('气泡透明度只调底色，文字始终清晰；自定义气泡 CSS 写了 background 时，滑块值优先（动过滑块即覆盖 CSS）。'));
return wrap;
} },
{ key: 'bar', label: '栏位', build: () => {
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
wrap.appendChild(mkSlider('顶栏不透明度', () => surfaceValue(CHAT_SURFACE_SETTINGS[0]), v => setSurface(0, v), 0, 100, 1, '%', CHAT_SURFACE_SETTINGS[0].def));
wrap.appendChild(mkSlider('底栏不透明度', () => surfaceValue(CHAT_SURFACE_SETTINGS[1]), v => setSurface(1, v), 0, 100, 1, '%', CHAT_SURFACE_SETTINGS[1].def));
wrap.appendChild(mkSlider('顶栏位置', () => surfaceValue(CHAT_SURFACE_SETTINGS[3]), v => setSurface(3, v), CHAT_SURFACE_SETTINGS[3].min, CHAT_SURFACE_SETTINGS[3].max, 1, 'px', CHAT_SURFACE_SETTINGS[3].def));
wrap.appendChild(mkSlider('底栏位置', () => surfaceValue(CHAT_SURFACE_SETTINGS[4]), v => setSurface(4, v), CHAT_SURFACE_SETTINGS[4].min, CHAT_SURFACE_SETTINGS[4].max, 1, 'px', CHAT_SURFACE_SETTINGS[4].def));
wrap.appendChild(mkNote('这两条位置滑杆拖着就能把顶栏/输入栏上下挪位，按需微调（顶栏正值下移、负值上移；底栏正值上移、负值下移）；双击滑杆回默认位置。'));
wrap.appendChild(mkPills('发送按钮', [{ label: '显示', value: 'show' }, { label: '隐藏（回车发送）', value: 'hide' }],
() => store.get('cs-send-show') || 'show', v => {
try { store.set('cs-send-show', v); } catch (e) {}
applySettings();
}));
{
const glN = (function () { try { return csBgList().length; } catch (e) { return 0; } })();
wrap.appendChild(mkGrid([
mkActSurface('上传壁纸（可多选）', () => {
try { csBgPickFiles(); } catch (e) { toast('无法打开相册，请重试'); }
}, { id: 'cs-bg-drawer-tap', accept: 'image/*', multiple: true, owner: 'dev-cs-bg-pick' }),
mkAct('图库 · 换一张' + (glN ? '（' + glN + '）' : ''), () => {
try { csBgOpenGallery(); } catch (e) { toast('图库打不开，请重试'); }
})
]));
if (!store.get('cs-bg')) wrap.appendChild(mkNote('还没设置壁纸：先上传一张或从图库选一张，下面的铺满方式/位置/缩放才有得调。'));
}
wrap.appendChild(mkPills('壁纸铺满方式', CS_BG_FITS, csBgFit, v => {
try { store.set('cs-bg-fit', v); } catch (e) {}
applySettings();
if (!store.get('cs-bg')) toast('已记住：上传壁纸后就会按这个方式显示');
}));
wrap.appendChild(mkPills('壁纸延伸到栏位', [{ label: '开', value: 'on' }, { label: '关', value: 'off' }],
() => (store.get('cs-bg-fullbars') === '1' ? 'on' : 'off'), v => {
try { store.set('cs-bg-fullbars', v === 'on' ? '1' : '0'); } catch (e) {}
applySettings();
}));
if (store.get('cs-bg')) {
wrap.appendChild(mkSlider('壁纸 水平位置', () => csBgAdj().x, v => setCsBgAdj({ x: v }), 0, 100, 1, '%', CS_BG_ADJ.x));
wrap.appendChild(mkSlider('壁纸 垂直位置', () => csBgAdj().y, v => setCsBgAdj({ y: v }), 0, 100, 1, '%', CS_BG_ADJ.y));
wrap.appendChild(mkSlider('壁纸 缩放', () => csBgAdj().s, v => setCsBgAdj({ s: v }), 100, 300, 5, '%', CS_BG_ADJ.s));
wrap.appendChild(mkNote('图被裁掉的部分靠这两条位置滑杆找回来（值越大＝看越靠右/靠下的一段）；缩放 100% 就是按铺满方式，双击滑杆回默认。'));
}
wrap.appendChild(mkGrid([
mkColorItem('发送按钮色', 'cs-send-bg', DEF.sendBg, SEND_BG_COLORS),
mkColorItem('发送文字色', 'cs-send-ink', DEF.sendInk, BUBBLE_INK_COLORS),
mkColorItem('正在输入颜色', 'cs-typing-ink', '#8a8a8a', BUBBLE_INK_COLORS)
]));
paletteHost = document.createElement('div');
wrap.appendChild(paletteHost);
wrap.appendChild(mkNote('不透明度 0% 全透明、100% 不透明，文字按钮不变淡；位置 0 为默认（顶栏正=下移/负=上移，底栏正=上移/负=下移），只作用于本桌面。'));
return wrap;
} },
{ key: 'type', label: '字体 · 其他', build: () => {
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
const finp = document.createElement('input');
finp.type = 'text'; finp.className = 'tc-input';
finp.placeholder = '字体名，如 Microsoft YaHei（清空＝恢复默认）';
const fr = fontResolved();
if (fr && fr.indexOf('data:') !== 0 && fr.indexOf('http') !== 0) finp.value = fr;
finp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)';
finp.addEventListener('input', () => {
const v = (finp.value || '').trim();
try { if (!v) fontRemove(); else fontSet(v); } catch (e) {}
applyFont(); csFontChanged();
});
wrap.appendChild(mkNote('全局字体（边打边看，清空输入框即恢复默认）'));
wrap.appendChild(finp);
wrap.appendChild(mkAct('上传字体文件（ttf / otf / woff / woff2）', () => {
window.mochiFilePick({
id: 'mochi-cs-drawer-font-pick', accept: '.ttf,.otf,.woff,.woff2',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到字体文件，请再选一次'); return; }
toast('正在读取字体文件…');
const reader = new FileReader();
reader.onload = () => { fontSetData(reader.result); applyFont(); csFontChanged(); toast('字体已应用到本桌面'); };
reader.onerror = () => { toast('字体文件读取失败，请重试'); };
reader.readAsDataURL(f);
}
});
}));
const ta = document.createElement('textarea');
ta.id = 'cs-drawer-css'; ta.className = 'tc-input'; ta.rows = 3;
ta.placeholder = '气泡 CSS，如 border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.12)';
ta.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:12.5px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111);resize:vertical';
try { ta.value = store.get(CSS_KEY) || ''; } catch (e) {}
let cssTimer = null;
ta.addEventListener('input', () => {
clearTimeout(cssTimer);
cssTimer = setTimeout(() => {
const v = cssReadVal(ta).trim();
try { if (v) store.set(CSS_KEY, v); else store.remove(CSS_KEY); } catch (e) {}
applyCss();
}, 160);
});
wrap.appendChild(mkNote('气泡 CSS（边写边套用；写 background / border-radius 时，上方两个滑块动过则以滑块为准）'));
wrap.appendChild(ta);
wrap.appendChild(mkAct('清空气泡 CSS', () => {
try { store.remove(CSS_KEY); } catch (e) {}
ta.value = '';
applyCss();
toast('已清空气泡样式');
}));
wrap.appendChild(mkPills('头像形状', [{ label: '圆形', value: 'circle' }, { label: '方形', value: 'square' }], () => store.get('cs-av-shape') || 'circle', v => { try { store.set('cs-av-shape', v); } catch (e) {} applySettings(); }));
wrap.appendChild(mkPills('时间轴样式', TIME_STYLES, () => store.get('cs-time-style') || 'under-av', v => {
try { store.set('cs-time-style', v); } catch (e) {}
applySettings();
if (v === 'divider' && window.chatReRenderTime) { try { window.chatReRenderTime(); } catch (e) {} }
}));
wrap.appendChild(mkGrid([
mkColorItem('时间轴文字色', 'cs-time-ink', DEF.timeInk, BUBBLE_INK_COLORS)
]));
paletteHost = document.createElement('div');
wrap.appendChild(paletteHost);
wrap.appendChild(mkNote('想逐项精调（含「同步到全部桌面」「恢复默认」等）回聊天设置→美化，点对应一行即可。'));
return wrap;
} },
{ key: 'tune', label: '微调', build: () => {
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
const setOff = (key, v) => { try { store.set(key, String(clampOffset(v))); } catch (e) {} applySettings(); };
const bdTouch = () => { try { if (window.asBadgeRefreshMarks) window.asBadgeRefreshMarks(); } catch (e) {} try { renderSec('tune'); } catch (e) {} };
const bdWrap = document.createElement('div');
bdWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px';
const bdLb = document.createElement('span');
bdLb.textContent = '标识图案（点亮即入池）';
bdLb.style.cssText = 'font-size:11.5px;color:var(--muted,#888)';
const bdRow = document.createElement('div');
bdRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
const bdItems = (window.asBadgeItems ? window.asBadgeItems() : []) || [];
bdItems.forEach(it => {
const b = document.createElement('button');
b.type = 'button';
b.textContent = it.s;
b.title = it.builtin ? (it.label + '（再点一次取消点亮）') : '自定义标识（再点一次取消点亮）';
b.style.cssText = 'min-width:34px;font-size:13px;line-height:1.4;padding:5px 9px;border-radius:8px;cursor:pointer;border:1px solid ' + (it.on ? 'var(--ink,#111)' : 'var(--card-border,#ddd)') + ';background:' + (it.on ? 'var(--ink,#111)' : 'var(--btn-cancel-bg,#fafafa)') + ';color:' + (it.on ? 'var(--bg-b,#fff)' : 'var(--ink,#111)');
b.addEventListener('click', () => {
const nm = window.asBadgeToggle ? window.asBadgeToggle(it) : '';
if (!nm) { toast('这枚标识已不在列表里，重开抽屉看看'); return; }
toast((it.on ? '已取消' : '已点亮') + ' ' + nm);
bdTouch();
});
bdRow.appendChild(b);
});
const bdAdd = document.createElement('button');
bdAdd.type = 'button';
bdAdd.textContent = '＋';
bdAdd.title = '添加自定义标识（最长 4 个字符）';
bdAdd.style.cssText = 'font-size:13px;line-height:1.4;padding:5px 10px;border-radius:8px;cursor:pointer;border:1px dashed var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)';
bdAdd.addEventListener('click', () => {
if (!window.openModal || !window.asBadgeAdd) { toast('这版暂不支持在这里添加'); return; }
window.openModal('添加主动发送标识', '', (v) => {
const r = window.asBadgeAdd(v) || { ok: 0, msg: '添加失败' };
if (!r.ok) { toast(r.msg); return; }
toast('已添加标识 ' + r.msg);
bdTouch();
}, { maxlength: 4, placeholder: '输入标识，如 🌙 / ❀ / 喵' });
});
bdRow.appendChild(bdAdd);
bdWrap.appendChild(bdLb); bdWrap.appendChild(bdRow);
wrap.appendChild(bdWrap);
wrap.appendChild(mkPills('显示标识', [{ label: '显示', value: 1 }, { label: '不显示', value: 0 }], () => {
try { return (window.replyCfg ? window.replyCfg() : {})['as-badge'] === 0 ? 0 : 1; } catch (e) { return 1; }
}, (v) => {
if (!window.asBadgeWrite) { toast('这版暂不支持在这里开关'); return; }
window.asBadgeWrite('as-badge', v);
toast(v ? '已显示主动发送标识' : '已隐藏主动发送标识');
bdTouch();
}));
if (bdItems.filter(it => it.on).length >= 2) {
wrap.appendChild(mkPills('多枚标识怎么抽取', [{ label: '每次随机', value: 1 }, { label: '按顺序轮换', value: 0 }], () => {
try { return (window.replyCfg ? window.replyCfg() : {})['as-badge-rand'] === 0 ? 0 : 1; } catch (e) { return 1; }
}, (v) => {
window.asBadgeWrite('as-badge-rand', v);
toast(v ? '多枚标识：每次随机' : '多枚标识：按顺序轮换');
bdTouch();
}));
}
wrap.appendChild(mkNote('自定义标识在这里点亮/取消，要删除回 设置→回复设置→聊天→主动发送→标识。'));
wrap.appendChild(mkNote('气泡 CSS 改了气泡大小/内边距后，标识和时间轴的位置可能跟着偏——这里手动校准。0 = 默认位置'));
wrap.appendChild(mkSlider('标识 左右', () => clampOffset(store.get('cs-mark-x')), v => setOff('cs-mark-x', v), OFFSET_MIN, OFFSET_MAX, 1, 'px', 0));
wrap.appendChild(mkSlider('标识 上下', () => clampOffset(store.get('cs-mark-y')), v => setOff('cs-mark-y', v), OFFSET_MIN, OFFSET_MAX, 1, 'px', 0));
wrap.appendChild(mkSlider('时间轴 左右', () => clampOffset(store.get('cs-time-x')), v => setOff('cs-time-x', v), OFFSET_MIN, OFFSET_MAX, 1, 'px', 0));
wrap.appendChild(mkSlider('时间轴 上下', () => clampOffset(store.get('cs-time-y')), v => setOff('cs-time-y', v), OFFSET_MIN, OFFSET_MAX, 1, 'px', 0));
wrap.appendChild(mkAct('位置全部恢复默认', () => {
['cs-mark-x', 'cs-mark-y', 'cs-time-x', 'cs-time-y'].forEach(k => { try { store.remove(k); } catch (e) {} });
applySettings();
renderSec('tune');
toast('标识与时间轴位置已恢复默认');
}));
wrap.appendChild(mkNote('左右：正值往右、负值往左；上下：正值往下、负值往上。时间轴要先在「字体 · 其他」里选好样式再调。'));
return wrap;
} }
];
const paintCsChips = (key) => {
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
csDrawerSec = key;
paintCsChips(key);
body.innerHTML = '';
paletteHost = null;
colorItems = [];
const sec = SECS.filter(s => s.key === key)[0];
if (sec) body.appendChild(sec.build());
};
SECS.forEach(s => {
const c = document.createElement('button');
c.type = 'button'; c.textContent = s.label; c.dataset.sec = s.key;
c.style.cssText = 'flex:1;font-size:11.5px;padding:7px 0;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
c.addEventListener('click', () => renderSec(s.key));
chipsRow.appendChild(c);
});
renderSec(csDrawerSec);
d.style.display = 'flex';
clearInterval(csDrawerWatchTimer);
let csLastBgSig = csDrawerBgSig();
csDrawerLayerTick();
csDrawerWatchTimer = setInterval(() => {
csDrawerLayerTick();
const s = csDrawerBgSig();
if (s !== csLastBgSig) { csLastBgSig = s; try { renderSec(csDrawerSec); } catch (e) {} }
}, 240);
try {
csDemoBubbles(false);
csDrawerApplyBottom();
csDrawerBindKbLift();
const cb = document.getElementById('chat-body');
if (cb) {
if (!cb.querySelector('.msg')) csDemoBubbles(true);
try { if (window.asBadgeRefreshMarks) window.asBadgeRefreshMarks(cb); } catch (e) {}
cb.scrollTop = cb.scrollHeight;
}
} catch (e) {}
}
(function injectCsLiveAdjust() {
const sec = document.querySelector('#page-chat-settings .them-sec[data-sec="beautify"]');
if (!sec || document.getElementById('cs-live-adjust')) return;
const b = document.createElement('button');
b.id = 'cs-live-adjust';
b.type = 'button';
b.style.cssText = 'display:flex;align-items:center;gap:10px;width:calc(100% - 24px);margin:10px 12px 0;padding:11px 14px;border:1px solid var(--card-border,#ddd);border:1px solid color-mix(in srgb, var(--btn-bg,#111) 40%, var(--card-bg,#fff));border-radius:12px;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--btn-bg,#111) 10%, var(--card-bg,#fff));color:var(--btn-bg,#111);text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;flex-shrink:0';
b.innerHTML = '<span style="flex:1;min-width:0">' +
'<span style="display:block;font-size:15px;font-weight:700;line-height:1.25">边看边调</span>' +
'<span style="display:block;font-size:11.5px;font-weight:400;opacity:.85;margin-top:2px">打开调色条：聊天在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位</span>' +
'</span><span style="flex:none;font-size:12px;font-weight:700;padding:7px 10px;border:1px solid var(--btn-bg,#111);border-radius:999px;background:var(--btn-bg,#111);color:var(--btn-ink,#fff);white-space:nowrap">点击开启 ›</span>';
b.addEventListener('click', openChatBeautyDrawer);
const first = sec.querySelector('.gs-title');
if (first) sec.insertBefore(b, first); else sec.appendChild(b);
})();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("chat-settings.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("chat-settings.js"); try { console.error("[JS] chat-settings.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[chat-settings.js] " + String(__e && __e.message || __e)); } })();