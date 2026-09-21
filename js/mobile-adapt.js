(function () { try {
(function () {
let isMobile = false, isTablet = false, isIOS = false;
try {
const d = window.mochiDevice;
if (d) { isMobile = !!d.isMobile; isTablet = !!d.isTablet; isIOS = !!d.isIOS; }
} catch (e) {}
if (!isTablet) { try { if (document.documentElement.classList.contains('tablet')) isTablet = true; } catch (e) {} }
if (!isMobile && !isTablet) return;
const FLOAT_PANEL_SELECTORS = ['#chat-more-panel', '#chat-decision-panel', '#chat-gdecision-panel', '#chat-divine-panel', '#chat-ask-panel', '#poke-card', '#gc-poke-card', '#emoji-panel', '#chat-rp-panel', '#chat-rps-panel', '#chat-pong-panel', '#chat-snake-panel', '#chat-brick-panel', '#chat-c4-panel', '#chat-ms-panel', '#chat-fish-panel', '#chat-memory-panel', '#chat-gift-panel', '#chat-gomoku-panel', '#chat-linkup-panel', '#chat-match3-panel', '#chat-auction-panel', '#chat-arcade-panel', '#ck-panel', '#chat-search', '#gc-more-panel', '#voice-panel'];
if (isIOS) {
try {
document.querySelectorAll('meta[name="viewport"]').forEach(function (m) {
m.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content');
});
} catch (e) {}
}
document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
document.addEventListener('dblclick', function (e) { e.preventDefault(); });
const SELECTION_EDITABLE_SEL = 'input,textarea,select,[contenteditable],.ce-box';
function reapDeadSelection() {
let s = null;
try { s = window.getSelection && window.getSelection(); } catch (e) { return false; }
if (!s || !s.rangeCount) return false;
let host = null;
try {
const node = s.getRangeAt(0).commonAncestorContainer;
host = node && node.nodeType === 3 ? node.parentElement : node;
} catch (e) { return false; }
const alive = !!(host && document.documentElement.contains(host));
if (alive) {
const editable = !!(host.closest && host.closest(SELECTION_EDITABLE_SEL));
const desk = document.getElementById('page-phone');
if (editable || !desk || !desk.contains(host)) return false;
}
try { s.removeAllRanges(); } catch (e) { return false; }
return true;
}
window.__mochiReapSelection = reapDeadSelection;   // 只读探针（诊断/verify 断言入口）
function reapSoon() { try { reapDeadSelection(); } catch (e) {} }
document.addEventListener('pointerdown', reapSoon, true);
document.addEventListener('touchstart', reapSoon, true);
document.addEventListener('selectionchange', reapSoon);
document.addEventListener('visibilitychange', reapSoon);
var ceInited = false;
function ceMultiText(box) {
var out = '';
function endNl() { return out.slice(-1) === '\n'; }
function walk(node) {
for (var i = 0; i < node.childNodes.length; i++) {
var n = node.childNodes[i];
if (n.nodeType === 3) { out += n.nodeValue || ''; continue; }
if (n.nodeType !== 1) continue;
var tag = n.tagName;
if (tag === 'BR') { out += '\n'; continue; }
var block = tag === 'DIV' || tag === 'P' || tag === 'LI' || tag === 'PRE' || tag === 'BLOCKQUOTE';
if (block) {
if (out && !endNl()) out += '\n';
walk(n);
if (out && !endNl()) out += '\n';
} else {
walk(n);
}
}
}
walk(box);
return out;
}
function initCeAll() {
var list = document.querySelectorAll('input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea');
list.forEach(ceConvert);
ceInited = true;
}
function ceConvert(inp) {
if (!inp || inp.dataset.ceDone || inp.readOnly) return;
var t = inp.type;
if (t === 'checkbox' || t === 'range' || t === 'file' || t === 'color' || t === 'hidden' ||
t === 'date' || t === 'time' || t === 'datetime-local' || t === 'month' || t === 'week') return;
inp.dataset.ceDone = '1';
var origClass = inp.className || '';
inp.classList.add('ce-ghost');
inp.setAttribute('aria-hidden', 'true');
var box = document.createElement('div');
box.className = 'ce-box ' + origClass;
box.setAttribute('contenteditable', 'true');
box.setAttribute('spellcheck', 'false');
box.dataset.for = inp.id || '';
var inpMode = inp.getAttribute('inputmode');
if (inpMode) box.setAttribute('inputmode', inpMode);
var ph = inp.getAttribute('placeholder') || '';
if (ph) box.setAttribute('data-ph', ph);
if (inp.tagName === 'TEXTAREA') {
var rows = parseInt(inp.getAttribute('rows'), 10) || 3;
box.style.minHeight = Math.max(48, Math.round(rows * 1.5 * 16)) + 'px';
box.style.resize = 'none';
} else {
box.style.minHeight = '24px';
}
box.style.display = 'block';
box.style.boxSizing = 'border-box';
if (inp.getAttribute('style')) {
var skip = ['display', 'min-height', 'box-sizing'];
try {
var st = inp.style;
for (var si = 0; si < st.length; si++) {
var pn = st[si];
if (skip.indexOf(pn) >= 0) continue;
var pv = st.getPropertyValue(pn);
if (pv) box.style.setProperty(pn, pv);
}
} catch (e) {}
}
function syncCeHidden() {
box.style.display = inp.hidden ? 'none' : 'block';
}
syncCeHidden();
try {
var hmo = new MutationObserver(syncCeHidden);
hmo.observe(inp, { attributes: true, attributeFilter: ['hidden'] });
} catch (e) {}
var isMulti = inp.tagName === 'TEXTAREA';
box.addEventListener('input', function () {
var maxLen = parseInt(inp.getAttribute('maxlength'), 10) || inp.maxLength || 0;
if (maxLen > 0 && box.textContent.length > maxLen) {
box.textContent = Array.from(box.textContent).slice(0, maxLen).join('');
try {
var r = document.createRange();
r.selectNodeContents(box);
r.collapse(false);
var s = window.getSelection();
s.removeAllRanges();
s.addRange(r);
} catch (e) {}
}
});
box.addEventListener('compositionend', function () {
var maxLen = parseInt(inp.getAttribute('maxlength'), 10) || inp.maxLength || 0;
if (maxLen > 0 && box.textContent.length > maxLen) {
box.textContent = Array.from(box.textContent).slice(0, maxLen).join('');
try {
var r = document.createRange();
r.selectNodeContents(box);
r.collapse(false);
var s = window.getSelection();
s.removeAllRanges();
s.addRange(r);
} catch (e) {}
}
});
if (!isMulti) {
box.addEventListener('keydown', function (e) {
if (e.key === 'Enter') e.preventDefault();
});
}
inp.__ceBox = box;
box.__ceInp = inp;
try { inp.parentNode.insertBefore(box, inp); } catch (e) {}
Object.defineProperty(inp, 'value', {
get: function () {
try {
if (box.querySelector('span.mail-media-mark') || box.querySelector('img[src*="data:image"]')) {
let out = '';
let lastWasMedia = false; // 上一段是媒体标记 → 后续文字补空格，防止 base64 与文字粘连
var walkMedia = function (node) {
let afterBlock = false; // 上一个兄弟是块级 → 之后的顶层文字/内联是新的一行
node.childNodes.forEach(function (n) {
if (n.nodeType === 3) {
const t = n.textContent || '';
if (!t) return;
if (afterBlock) { if (out && !out.endsWith('\n')) out += '\n'; afterBlock = false; }
else if (lastWasMedia && out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
out += t;
lastWasMedia = false;
return;
}
if (n.nodeType !== 1) return;
if (n.classList && n.classList.contains('mail-media-mark')) {
if (afterBlock) { if (out && !out.endsWith('\n')) out += '\n'; afterBlock = false; }
else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
out += n.textContent;
lastWasMedia = true;
return;
}
if (n.tagName === 'IMG' && n.src && n.src.indexOf('data:image') === 0) {
let covered = false;
try {
box.querySelectorAll('span.mail-media-mark').forEach(function (sp) {
if (!covered && sp.textContent && sp.textContent.indexOf(n.src) >= 0) covered = true;
});
} catch (e) {}
if (!covered) {
if (afterBlock) { if (out && !out.endsWith('\n')) out += '\n'; afterBlock = false; }
else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
out += 'image:' + n.src;
lastWasMedia = true;
}
return;
}
if (n.tagName === 'BR') { out += '\n'; lastWasMedia = false; return; }
if (n.tagName === 'DIV' || n.tagName === 'P') {
if (out && !out.endsWith('\n')) out += '\n';
walkMedia(n);
afterBlock = true;
lastWasMedia = false;
return;
}
const inner = n.textContent || '';
if (inner) {
if (afterBlock) { if (out && !out.endsWith('\n')) out += '\n'; afterBlock = false; }
else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
out += inner;
lastWasMedia = false;
}
});
};
walkMedia(box);
return out;
}
} catch (e) {}
if (isMulti) {
try {
var itTxt = '';
try { itTxt = box.innerText || ''; } catch (e2) {}
var walkTxt = ceMultiText(box);
var itN = (itTxt.match(/\n/g) || []).length;
var wkN = (walkTxt.match(/\n/g) || []).length;
if (wkN > itN) return walkTxt;
return itTxt || walkTxt || box.textContent || '';
} catch (e) {}
}
return box.textContent || '';
},
set: function (v) {
const s = (v == null ? '' : String(v));
if (isMulti) {
try { box.textContent = s; return; } catch (e) {}
}
box.textContent = s;
},
configurable: true
});
Object.defineProperty(inp, 'placeholder', {
get: function () { return box.getAttribute('data-ph') || ''; },
set: function (v) { if (v) box.setAttribute('data-ph', v); else box.removeAttribute('data-ph'); },
configurable: true
});
try {
Object.defineProperty(box, 'value', {
get: function () { return inp.value; },
set: function (v) { inp.value = v; },
configurable: true
});
} catch (e) {}
var origFocus = inp.focus, origBlur = inp.blur;
inp.focus = function () { try { box.focus(); } catch (e) {} };
inp.blur = function () { try { box.blur(); } catch (e) {} };
['input', 'change', 'keydown', 'keyup', 'click', 'compositionstart', 'compositionend'].forEach(function (ev) {
box.addEventListener(ev, function (e) {
var clone = new Event(ev, { bubbles: true, cancelable: true });
if (e.data !== undefined) clone.data = e.data;
if (ev === 'keydown' || ev === 'keyup') {
clone.key = e.key; clone.keyCode = e.keyCode; clone.isComposing = e.isComposing;
}
if (ev === 'input' && e.inputType !== undefined) clone.inputType = e.inputType;
try { inp.dispatchEvent(clone); } catch (err) {}
});
});
box.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
var ceChangeVal = null;
box.addEventListener('focus', function () { ceChangeVal = box.textContent || ''; });
box.addEventListener('blur', function () {
try {
if (ceChangeVal !== null && (box.textContent || '') !== ceChangeVal) {
box.dispatchEvent(new Event('change', { bubbles: true }));
}
ceChangeVal = null;
} catch (e) {}
});
box.addEventListener('focus', function () { try { inp.dispatchEvent(new Event('focus', { bubbles: true })); } catch (e) {} });
box.addEventListener('blur', function () { try { inp.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} });
var initV = inp.getAttribute('value');
if (initV === null && inp.value !== undefined) initV = inp.value;
if (initV) box.textContent = initV;
}
try { if (!isIOS) initCeAll(); } catch (e) {}
try {
if (!isIOS) {
var CE_SCAN_SEL = 'input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea';
var ceMo = new MutationObserver(function (muts) {
for (var mi = 0; mi < muts.length; mi++) {
var added = muts[mi].addedNodes;
for (var ai = 0; ai < added.length; ai++) {
var n = added[ai];
if (!n || n.nodeType !== 1) continue;
try {
if (n.matches(CE_SCAN_SEL)) ceConvert(n);
var sub = n.querySelectorAll(CE_SCAN_SEL);
for (var si = 0; si < sub.length; si++) ceConvert(sub[si]);
} catch (e) {}
}
}
});
ceMo.observe(document.body, { childList: true, subtree: true });
}
} catch (e) {}
if (!isIOS) {
document.addEventListener('focusin', function (e) {
var t = e.target;
if (!t || t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') return;
if (t.dataset.ceDone || t.__ceBox) return;
var ty = t.type;
if (ty === 'checkbox' || ty === 'range' || ty === 'file' || ty === 'color' || ty === 'hidden' ||
ty === 'date' || ty === 'time' || ty === 'datetime-local' || ty === 'month' || ty === 'week') return;
ceConvert(t);
if (t.__ceBox) { try { t.__ceBox.focus(); } catch (err) {} }
}, true);
}
if (!isIOS) {
function ceNeedsConv(t) {
if (!t || t.dataset.ceDone || t.__ceBox) return false;
var ty = t.type;
return !(ty === 'checkbox' || ty === 'range' || ty === 'file' || ty === 'color' || ty === 'hidden' ||
ty === 'date' || ty === 'time' || ty === 'datetime-local' || ty === 'month' || ty === 'week');
}
var _origInpFocus = HTMLInputElement.prototype.focus;
HTMLInputElement.prototype.focus = function () {
if (this.__ceBox) { try { this.__ceBox.focus(); } catch (e) {} return; }
if (ceNeedsConv(this)) {
ceConvert(this);
if (this.__ceBox) { try { this.__ceBox.focus(); } catch (e) {} return; }
}
return _origInpFocus.apply(this, arguments);
};
var _origTAFocus = HTMLTextAreaElement.prototype.focus;
HTMLTextAreaElement.prototype.focus = function () {
if (this.__ceBox) { try { this.__ceBox.focus(); } catch (e) {} return; }
if (ceNeedsConv(this)) {
ceConvert(this);
if (this.__ceBox) { try { this.__ceBox.focus(); } catch (e) {} return; }
}
return _origTAFocus.apply(this, arguments);
};
}
function _aRefreshCe() {
try { if (_aClosing) return; } catch (e) {}
try { if (Date.now() - _aUserTypos < 500) return; } catch (e) {}
try {
var list = document.querySelectorAll('.ce-box');
if (!list || !list.length) return;
for (var i = 0; i < list.length; i++) {
var b = list[i];
if (b.offsetParent === null) continue; // display:none/隐藏祖先 跳过
var prev = b.style.transform;
b.style.transform = 'translateZ(0)';
void b.offsetHeight;
b.style.transform = prev;
}
} catch (e) {}
}
var _aCeT = null;
function _aSchedCe() {
if (isIOS) return;
clearTimeout(_aCeT);
_aCeT = setTimeout(_aRefreshCe, 60);
}
var _aUserTypos = Date.now();
var _aClosing = false;
try {
document.addEventListener('keydown', function () { _aUserTypos = Date.now(); }, true);
} catch (e) {}
function isTextEl(el) {
return el && ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
? (el.type !== 'checkbox' && el.type !== 'range' && el.type !== 'file' && el.type !== 'color' && !el.readOnly)
: el.isContentEditable === true);
}
var nudgeTimer = null;
function healEditableScroll(el) {
try {
if (!el || !(el.scrollTop > 0)) return;
if (el.scrollHeight <= el.clientHeight + 1) el.scrollTop = 0;
} catch (e) {}
}
try {
document.addEventListener('input', function (e) {
var t = e.target;
if (!isTextEl(t)) return;
healEditableScroll(t);
}, true);
} catch (e) {}
var NUDGE_SCROLLER_SEL = '.chat-body, .card-list, .gs-scroll, .tc-body, .mem-scroll, .cal-scroll, .div-scroll, .fav-list, .mail-list, .qa-body, .modal, .chat-ask-body, .poke-card-scroll, .chat-decision-body';
function nudgeInputVisible() {
var active = document.activeElement;
if (!isTextEl(active) || !active.getBoundingClientRect) return;
healEditableScroll(active);
var r = active.getBoundingClientRect();
try {
var scroller = active.closest(NUDGE_SCROLLER_SEL);
if (!scroller) return;
var sr = scroller.getBoundingClientRect();
var geomKey = Math.round(sr.width) + 'x' + Math.round(scroller.scrollHeight);
var vhNow = Math.round(sr.height);
if (scroller.__nudgeGeom === geomKey && Math.abs(vhNow - (scroller.__nudgeVH || vhNow)) < 90) return;
scroller.__nudgeGeom = geomKey;
scroller.__nudgeVH = vhNow;
if (r.bottom > sr.bottom - 8) {
var ovf = r.bottom - (sr.bottom - 8);
var _elH = (active && active.offsetHeight) || 0;
var _topHidden = sr.top - r.top; // >0 ＝ 输入框顶部已卷到可视上沿之上
if ((_topHidden > 0) || (_elH > (sr.height - 8))) {
if (_topHidden > 0) scroller.scrollTop = Math.max(0, scroller.scrollTop - _topHidden - 8);
} else {
scroller.scrollTop = Math.max(0, scroller.scrollTop + ovf + 16);
}
}
} catch (e) {}
}
document.addEventListener('focusin', function () {
clearTimeout(nudgeTimer);
nudgeTimer = setTimeout(nudgeInputVisible, 300);
});
var kbLastTouchAt = 0;
var kbLastTouchTarget = null;
try {
document.addEventListener('touchstart', function (e) { kbLastTouchAt = Date.now(); kbLastTouchTarget = e.target; }, { passive: true, capture: true });
} catch (e) {}
function kbTouchArmed(tgt) {
if (!tgt || !kbLastTouchTarget) return false;
try {
return tgt === kbLastTouchTarget || tgt.contains(kbLastTouchTarget) || kbLastTouchTarget.contains(tgt);
} catch (e) { return false; }
}
var kbHardKeyUntil = 0;
try {
document.addEventListener('keydown', function (e) {
try { if (e.keyCode !== 229) kbHardKeyUntil = Date.now() + 30000; } catch (err) {}
}, true);
} catch (e) {}
if (isIOS) {
try {
var _phone = document.querySelector('.phone');
var _cb = document.getElementById('chat-body');
if (_cb) _cb.style.transform = 'none'; // iOS 豁免合成层，避免滚动卡顿
var _vv = window.visualViewport;
var _kbActive = false;
var _pinUntil = 0; // v3.7.x：键盘开合动画窗口，窗口内才 pinScrollTop
var _fullInner = window.innerHeight || 0;
var _fullVv = _vv ? Math.round(_vv.height) : _fullInner;
function _syncFullBase() {
var ih = window.innerHeight || 0;
var vh = _vv ? Math.round(_vv.height) : ih;
if (ih > 0) _fullInner = ih;
if (vh > 0) _fullVv = vh;
}
function _setPhoneH(px, reason) {
try {
if (px === null || px === undefined) {
if (_phone.style.height !== '') _phone.style.height = '';
return;
}
var floor = Math.round(_fullInner * 0.4); // 输入法最多占屏 60%，再小必是异常读数
var nh = Math.max(floor, Math.round(px));
var cur = parseFloat(_phone.style.height);
if (_phone.style.height && Math.abs((isNaN(cur) ? nh + 99 : cur) - nh) < 6) return;
if (_phone.style.height !== nh + 'px') _phone.style.height = nh + 'px';
} catch (e) {}
}
var _textFocused = null;
var _focLostAt = 0;
var _iFocusAt = 0, _iProv = false, _iIH = window.innerHeight;
function pinScrollTop() {
try {
if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
window.scrollTo(0, 0);
document.documentElement.scrollTop = 0;
document.body.scrollTop = 0;
}
if (_vv && _vv.scrollTo && (_vv.offsetTop > 1 || _vv.offsetLeft > 1)) {
try { _vv.scrollTo(0, 0); } catch (e2) {}
}
} catch (e) {}
}
function syncModalKbDock() {
try {
var mk = document.getElementById('modal-mask');
if (mk) mk.classList.toggle('modal-kb-dock', !!(_kbActive || _iProv));
} catch (e) {}
}
var KB_SCROLL_HEAL = 80;
function winScrollY() {
try { return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0; } catch (e) { return 0; }
}
var _docLocked = false, _docPrevOverflow = '';
function lockDocScroll() {
try {
if (_docLocked) return;
_docLocked = true;
_docPrevOverflow = document.documentElement.style.overflow;
document.documentElement.style.overflow = 'hidden';
} catch (e) {}
}
function unlockDocScroll() {
try {
_docLocked = false;
var d = document.documentElement;
if (d.style.overflow) d.style.overflow = _docPrevOverflow;
} catch (e) {}
}
function healKbScroll() {
try {
if (!_kbActive) return;
var _vh = _vv ? _vv.height : window.innerHeight;
var shifted = winScrollY() > KB_SCROLL_HEAL;
if (!shifted) {
var pr = _phone.getBoundingClientRect();
if (pr.top < -KB_SCROLL_HEAL || pr.bottom > _vh + 24) shifted = true;
}
if (shifted) pinScrollTop();
} catch (e) {}
}
function _ensureInputDocked() {
try {
if (!_kbActive || !_vv || !_phone) return;
if (Date.now() < _pinUntil) return; // 开合动画窗口内不干预，交给 syncIosKb
var tgt = (isTextEl(_textFocused) ? _textFocused : null) ||
(isTextEl(document.activeElement) ? document.activeElement : null);
if (!tgt || !tgt.getBoundingClientRect) return;
var r = tgt.getBoundingClientRect();
var vh = _vv.height;
if (r.bottom <= vh + 2) return; // 已停在键盘上方，达标
var pr = _phone.getBoundingClientRect();
var cut = Math.ceil(r.bottom - vh) + 12; // 超出量 + 12px 余量
try { _phone.style.minHeight = '0'; } catch (e2) {}
_setPhoneH(Math.round(pr.height - cut), 'ensure'); // 下限保护交给 _setPhoneH
} catch (e) {}
}
function restoreKb() {
if (!_kbActive) return;
_kbActive = false;
_setPhoneH(null, 'restore');
try { _phone.style.minHeight = ''; } catch (e) {} // v3.15.x：还原键盘期压掉的 min-height
_phone.style.alignSelf = '';
kbUndockPanels();
syncModalKbDock(); // #255：摘除键盘期顶对齐类，弹窗回居中
unlockDocScroll();
pinScrollTop();
stopKbWatch();
_syncFullBase(); // v3.26.x：此刻没有键盘，当前视口即新的无键盘基线
syncSafeBottom();
}
function syncIosKb() {
if (!_vv || !_phone) return;
var _focused = isTextEl(_textFocused) || isTextEl(document.activeElement);
var _h = _vv.height;
var _ih = window.innerHeight || _h;
if (!_focused && !_kbActive && !_iProv) { _fullInner = _ih; _fullVv = Math.round(_h); }
var _kbNow = _h < _fullVv - 60 || _ih < _fullInner - 60;
var _safeH = (_h >= _fullInner * 0.4) ? _h : Math.round(_fullInner * 0.55);
if (_kbActive && !_kbNow) { restoreKb(); return; }
if (_kbActive && _focused && Date.now() > _pinUntil) {
_setPhoneH(_safeH, 'steady');
return;
}
if (_focused && _kbNow && !_kbActive) {
_kbActive = true;
lockDocScroll(); // 禁文档根滚动：iOS 无法再把页面滚走露灰底（Edge 关键）
try { _phone.style.minHeight = '0'; } catch (e5) {}
_phone.style.alignSelf = 'flex-start';
kbDockPanels(); // 底部半框停靠可视区底部=输入栏上方（防面板被挤出视口）
syncModalKbDock(); // #255：弹窗切顶对齐（防键盘期居中重取中=输入框上滑）
pinScrollTop();
syncSafeBottom(); // #556：键盘开启即归零（收起 restoreKb 摘除回落 env）
_pinUntil = Date.now() + 500;
startKbWatch();
}
if (_kbActive) {
_setPhoneH(_safeH, 'open');
if (Date.now() < _pinUntil) pinScrollTop();
}
}
var _kbWatch = null;
function startKbWatch() {
if (_kbWatch) return;
_kbWatch = setInterval(function () {
try {
var _foc = isTextEl(_textFocused) || isTextEl(document.activeElement);
if (_foc) {
syncIosKb();
nudgeInputVisible();
syncModalKbDock(); // #255：键盘已在而弹窗后开（如聊天键盘开着又点开弹窗）时补挂顶对齐类
healKbScroll();
_iProvCheck();
_ensureInputDocked();
} else if (_kbActive) {
if (_vv && _vv.height >= _fullVv - 60) restoreKb();
} else {
_iProvCheck();
stopKbWatch();
}
} catch (e) {}
}, 250);
}
function stopKbWatch() {
if (_kbWatch) { clearInterval(_kbWatch); _kbWatch = null; }
}
function _iProvDock() {
var base = Math.min(_fullInner, _iIH);
var ph = Math.min(Math.max(Math.round(base * 0.58), 240), Math.round(base * 0.62));
_iProv = true;
lockDocScroll();
try { _phone.style.minHeight = '0'; } catch (e) {} // v3.15.x：同 syncIosKb，防 min-height 钳制
_phone.style.alignSelf = 'flex-start';
_setPhoneH(ph, 'prov'); // v3.26.x：改走唯一写入口
kbDockPanels();
syncModalKbDock(); // #255：同 syncIosKb，弹窗切顶对齐
pinScrollTop();
syncSafeBottom(); // #556：推定停靠同属键盘在场，归零同上
}
function _iProvClear() {
if (!_iProv) return;
_iProv = false;
if (_kbActive) return; // 正常机制已接管 .phone 高度，交回原逻辑管理
unlockDocScroll();
_setPhoneH(null, 'prov-clear'); // v3.26.x：还原样式表高度
try { _phone.style.minHeight = ''; } catch (e) {} // v3.15.x：还原
_phone.style.alignSelf = '';
kbUndockPanels();
syncModalKbDock(); // #255：摘除顶对齐
pinScrollTop();
_syncFullBase(); // v3.26.x：复原时刻即无键盘真实视口
syncSafeBottom();
}
function _iProvCheck() {
try {
if (!_vv || !_phone) return;
var tgt = (isTextEl(_textFocused) ? _textFocused : null) ||
(isTextEl(document.activeElement) ? document.activeElement : null);
var ih = window.innerHeight;
if (!tgt) {
if (!_kbActive && !_iProv) _iIH = ih;
if (_iProv && _vv.height >= _fullVv - 60) _iProvClear();
return;
}
var _iCovered = false;
try {
var _rI = tgt.getBoundingClientRect ? tgt.getBoundingClientRect() : null;
_iCovered = !!(_rI && _rI.height > 0 && _rI.bottom > ((_vv.offsetTop || 0) + _vv.height) + 12);
} catch (eCovI) {}
if (!_kbActive && !_iProv &&
Date.now() - _iFocusAt > 900 &&
Date.now() - kbLastTouchAt < 1500 &&
kbTouchArmed(tgt) &&
Date.now() > kbHardKeyUntil &&
Math.abs(_vv.height - _fullVv) <= 2 &&
Math.abs(ih - _iIH) <= 2 &&
_iCovered) {
_iProvDock();
}
} catch (e) {}
}
var _vvFitOn = false;
var _envTopCache = -1; // #148：env(safe-area-inset-top) 探针缓存（-1=未测）；旋转/#277 矛盾自愈时失效
var _envTopCacheAt = 0; // #277：缓存写入时刻（矛盾重探 5s 节流，防 1s 自愈循环频繁建探针 DOM）
var _zoomFixCnt = 0, _zoomFixAt = 0; // #174：缩放异常自愈计数（每会话 ≤3 次，间隔 4s）
function syncVvFit() {
try {
var d = document.documentElement;
var _ih2 = window.innerHeight || 0;
var _sh2 = (window.screen && window.screen.height) || 0;
var _vh2 = _vv ? Math.round(_vv.height * ((_vv.scale && _vv.scale > 0.5) ? _vv.scale : 1)) : _ih2;
var _sig0 = {
standalone: d.classList.contains('ios-pwa-standalone'),
envTop: _envTopCache >= 0 ? _envTopCache : 0,
innerH: _ih2, screenH: _sh2, iosMajor: 0, safeTopForce: false
};
try {
var _osM = /OS (\d+)_/.exec(navigator.userAgent || '');
var _vM = /Version\/(\d+)\./.exec(navigator.userAgent || '');
_sig0.iosMajor = Math.max(_osM ? +_osM[1] : 0, _vM ? +_vM[1] : 0);
_sig0.safMajor = _vM ? +_vM[1] : 0; // #235：Safari 主版本（26.x 起覆盖形态，保留判定加门）
} catch (e9) {}
try { _sig0.safeTopForce = localStorage.getItem('xy-home-v2:__safe-top-force') === '1'; } catch (eF0) {}
try {
var _diff0 = _sh2 - _ih2;
if (_sig0.standalone && _diff0 >= 20 && _envTopCache >= 0
&& (_envTopCache === 0 || Math.abs(_envTopCache - _diff0) > 8)
&& Date.now() - _envTopCacheAt > 5000) {
_envTopCache = -1; _envTopCacheAt = Date.now();
}
} catch (eE5) {}
var _f0 = window.mochiViewportForm(_sig0);
if (_f0.needEnvProbe && _envTopCache < 0 && _sh2 > 0 && _vh2 > 0) {
try {
var _probe = document.createElement('div');
_probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
document.body.appendChild(_probe);
_envTopCache = parseFloat(getComputedStyle(_probe).paddingTop) || 0;
document.body.removeChild(_probe);
} catch (e4) { _envTopCache = 0; }
_envTopCacheAt = Date.now(); // #277：探回值连同时刻一起入账（重探节流基准）
_sig0.envTop = _envTopCache;
}
var _f = window.mochiViewportForm(_sig0);
var _safeTop = _f.safeTop;
var _resStand = _f.resStand;
var _topPx = _safeTop ? _safeTop + 'px' : (_resStand ? '0px' : '');
if (d.style.getPropertyValue('--mochi-safe-top') !== _topPx) {
if (_topPx) d.style.setProperty('--mochi-safe-top', _topPx);
else d.style.removeProperty('--mochi-safe-top');
}
var _wantCover = !!_safeTop && !d.classList.contains('ios-pwa-standalone');
if (_wantCover !== d.classList.contains('mochi-cover-top')) {
d.classList.toggle('mochi-cover-top', _wantCover);
}
var _fsState = function () {
try {
return d.classList.contains('fs-active') || d.classList.contains('fs-css-active')
|| d.classList.contains('ios-fs-active') || d.classList.contains('ios-native-fs');
} catch (e) { return false; }
};
var _wantIosCover = !!_f.iosCover && !_fsState();
if (_wantIosCover !== d.classList.contains('ios-cover-top')) {
d.classList.toggle('ios-cover-top', _wantIosCover);
}
if (_fsState()) {
var _nPxFs = (_vh2 >= 300) ? Math.round(_f.expBase) : 0;
var _curFs = parseFloat(d.style.getPropertyValue('--mochi-ios-h'));
if (_nPxFs >= 300) {
if (isNaN(_curFs) || Math.abs(_nPxFs - _curFs) >= 6) d.style.setProperty('--mochi-ios-h', _nPxFs + 'px');
} else if (d.style.getPropertyValue('--mochi-ios-h')) {
d.style.removeProperty('--mochi-ios-h');
}
return;
}
if (_kbActive || _iProv || _kbNowLike()) {
if (d.style.getPropertyValue('--mochi-ios-h')) d.style.removeProperty('--mochi-ios-h');
return;
}
var ih = window.innerHeight || 0;
var vh = _vv ? Math.round(_vv.height * ((_vv.scale && _vv.scale > 0.5) ? _vv.scale : 1)) : ih;
if (d.classList.contains('ios-pwa-standalone') && _safeTop > 0 && _ih2 > 0) {
vh = _f.expBase; // #209：判定器期望底边（=safeTop+inner min 屏高，#179 语义）
}
if (!vh) return;
if (!_vvFitOn) { _vvFitOn = true; d.classList.add('ios-vv-fit'); }
var _curN = parseFloat(d.style.getPropertyValue('--mochi-ios-h'));
if (isNaN(_curN) || Math.abs(vh - _curN) >= 6) d.style.setProperty('--mochi-ios-h', vh + 'px');
} catch (e) {}
}
function syncSafeBottom() {
try {
var d = document.documentElement;
var ih = window.innerHeight || 0;
var sh = (window.screen && window.screen.height) || 0;
var cur = d.style.getPropertyValue('--mochi-safe-bottom');
if (_kbActive || _iProv || _kbNowLike()) { // #556 键盘在场判据（与 syncVvFit 摘 --mochi-ios-h 同源）
if (cur !== '0px') d.style.setProperty('--mochi-safe-bottom', '0px'); // #556 键盘期钉 0
return;
}
if (sh && ih && sh - ih > 60 && !d.classList.contains('ios-pwa-standalone')) {
if (cur !== '0px') d.style.setProperty('--mochi-safe-bottom', '0px');
} else if (cur) {
d.style.removeProperty('--mochi-safe-bottom');
}
} catch (e) {}
}
function _kbNowLike() {
try {
if (!_vv) return false;
return _vv.height < _fullVv - 60 || (window.innerHeight || 0) < _fullInner - 60;
} catch (e) { return false; }
}
var _healRaf = 0;
function scheduleHeal() {
if (_healRaf) return;
_healRaf = requestAnimationFrame(function () {
_healRaf = 0;
healViewport();
});
}
function _fsLike() {
var dd = document.documentElement;
return dd.classList.contains('fs-active') || dd.classList.contains('fs-css-active')
|| dd.classList.contains('ios-fs-active') || dd.classList.contains('ios-native-fs');
}
function healViewport() {
try {
var d = document.documentElement; // FIX 2026-09-05 #189
syncVvFit();
syncSafeBottom();
if (d.classList.contains('ios-pwa-standalone') && _vv && _vv.scale && _vv.scale < 0.95) {
var _now = Date.now();
if (_zoomFixCnt < 3 && _now - _zoomFixAt > 4000) {
_zoomFixCnt++; _zoomFixAt = _now;
document.querySelectorAll('meta[name="viewport"]').forEach(function (m) {
m.setAttribute('content', 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content');
});
}
}
try {
if (d.classList.contains('ios-pwa-standalone') && _fsLike() && _phone && !_kbActive && !_kbNowLike()
&& window.mochiViewportForm && _sh2 > 0 && _ih2 > 0
&& localStorage.getItem('xy-home-v2:__safe-top-force') === '1') {
var _sigW = { standalone: true, envTop: _envTopCache >= 0 ? _envTopCache : 0, innerH: _ih2, screenH: _sh2, iosMajor: 0, safeTopForce: true };
try {
var _osW = /OS (\d+)_/.exec(navigator.userAgent || '');
var _vW = /Version\/(\d+)\./.exec(navigator.userAgent || '');
_sigW.iosMajor = Math.max(_osW ? +_osW[1] : 0, _vW ? +_vW[1] : 0);
_sigW.safMajor = _vW ? +_vW[1] : 0; // #235：Safari 主版本同门（force 路径虽不走 resStand，信号保持同源）
} catch (eW1) {}
var _fw = window.mochiViewportForm(_sigW);
if (_fw.forceCover) {
var _pb = _phone.getBoundingClientRect().bottom;
var _short = Math.round(_sh2 - _pb);
if (_short > 8) {
if (d.style.getPropertyValue('--mochi-safe-top') !== (_fw.safeTop + 'px')) d.style.setProperty('--mochi-safe-top', _fw.safeTop + 'px');
if (d.style.getPropertyValue('--mochi-ios-h') !== (_fw.expBase + 'px')) d.style.setProperty('--mochi-ios-h', _fw.expBase + 'px');
if (_phone.style.height) _phone.style.height = ''; // 清键盘期内联高度，回落 var 期望值
try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (eS2) {}
}
}
}
} catch (eW0) {}
var foc = isTextEl(_textFocused) || isTextEl(document.activeElement);
if (!foc && !_kbNowLike()) {
if (_kbActive) restoreKb();
else {
var _cleanedResidue = false;
if (_iProv) { _iProvClear(); _cleanedResidue = true; } // 内部已 pin
if (_docLocked) { unlockDocScroll(); _cleanedResidue = true; }
else unlockDocScroll(); // v3.26.x 看门狗语义保留：残留 overflow:hidden 必清
if (_phone && _phone.style.height) { _setPhoneH(null, 'heal'); _cleanedResidue = true; }
if (_phone && _phone.style.alignSelf) { _phone.style.alignSelf = ''; _cleanedResidue = true; }
if (_cleanedResidue || winScrollY() > KB_SCROLL_HEAL) pinScrollTop(); // FIX 2026-09-05 #189
}
_syncFullBase();
} else if (_kbActive) {
if (Date.now() < _pinUntil) pinScrollTop();
else healKbScroll();
if (!foc && _focLostAt && Date.now() - _focLostAt > 4000 && _vv && _vv.height < _fullVv - 60) {
restoreKb();
}
} else if (!foc) {
var shifted = winScrollY() > KB_SCROLL_HEAL;
if (!shifted && _phone) {
var pr = _phone.getBoundingClientRect();
var _stT = parseFloat(d.style.getPropertyValue('--mochi-safe-top')) || 0;
shifted = pr.top < -KB_SCROLL_HEAL || pr.bottom > (_vv ? _vv.height : window.innerHeight) + _stT + 24;
}
if (!shifted && !_fsLike() && _vv && (Math.abs(_vv.offsetTop) > 4 || Math.abs(_vv.offsetLeft) > 4)) shifted = true;
if (shifted) pinScrollTop();
}
} catch (e) {}
}
function onIosVvEvent() { scheduleHeal(); }
if (_vv) {
_vv.addEventListener('resize', syncIosKb);
_vv.addEventListener('scroll', onIosVvEvent);
_vv.addEventListener('resize', onIosVvEvent);
}
window.addEventListener('resize', onIosVvEvent);
window.addEventListener('orientationchange', onIosVvEvent);
window.addEventListener('orientationchange', function () { try { _envTopCache = -1; } catch (e) {} });
var _vvLog = [];
function vvLogPush() {
try {
if (document.visibilityState !== 'visible') return;
var ih2 = window.innerHeight || 0;
var prev = _vvLog.length ? _vvLog[_vvLog.length - 1].ih : ih2;
_vvLog.push({ t: Date.now(), iw: window.innerWidth || 0, ih: ih2,
vh: _vv ? Math.round(_vv.height) : 0, sc: _vv ? +(+_vv.scale).toFixed(2) : 1,
kb: _kbActive ? 1 : 0, fs: _fsLike() ? 1 : 0 });
if (_vvLog.length > 60) _vvLog.shift();
} catch (e) {}
}
setInterval(vvLogPush, 1000);
window.__mochiVvTimeline = function () {
try {
if (!_vvLog.length) return '（暂无记录）';
return _vvLog.map(function (e, i) {
const d = new Date(e.t);
const hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
const dl = i > 0 ? (e.ih - _vvLog[i - 1].ih) : 0;
return hm + ' inner:' + e.iw + '×' + e.ih + ' vv:' + e.vh + ' sc:' + e.sc + ' kb:' + e.kb + ' fs:' + e.fs + (i > 0 && dl !== 0 ? ' Δ' + (dl > 0 ? '+' : '') + dl : '');
}).join(' | ');
} catch (e) { return '(时间线采集失败)'; }
};
window.addEventListener('pageshow', onIosVvEvent);
document.addEventListener('visibilitychange', onIosVvEvent);
let _vvFp = '', _vvTick = 0;
setInterval(function () {
if (document.visibilityState !== 'visible') return;
try {
_vvTick++;
const _v = window.visualViewport;
const fp = [window.innerWidth, window.innerHeight, _v ? Math.round(_v.height) : 0,
_v ? +(+_v.scale).toFixed(2) : 1, _v ? Math.round(_v.offsetTop || 0) : 0].join('|');
if (fp === _vvFp && (_vvTick % 10) !== 0) return; // 未变且非深查拍 → 本秒不重校
_vvFp = fp;
} catch (e0) {}
onIosVvEvent();
}, 1000);
try { syncVvFit(); syncSafeBottom(); } catch (e) {}
window.__mochiIosKb = function () {
return {
kbActive: !!_kbActive,
prov: !!_iProv,
docLocked: !!_docLocked,
fullInner: _fullInner,
fullVv: _fullVv,
pinLeft: Math.max(0, _pinUntil - Date.now()),
focusTag: _textFocused ? String(_textFocused.tagName || '').toLowerCase() : ''
};
};
document.addEventListener('focusin', function (e) {
try { if (isTextEl(e.target)) { _textFocused = e.target; _iFocusAt = Date.now(); _focLostAt = 0; } } catch (e2) {}
try { syncIosKb(); } catch (e3) {}
setTimeout(syncIosKb, 250);
setTimeout(syncIosKb, 450);
setTimeout(_iProvCheck, 950);
setTimeout(_iProvCheck, 1700);
if (isTextEl(e.target)) { try { startKbWatch(); } catch (e4) {} }
});
document.addEventListener('focusout', function (e) {
try { if (e.target === _textFocused) { _textFocused = null; _focLostAt = Date.now(); } } catch (e2) {}
setTimeout(syncIosKb, 250);
setTimeout(syncIosKb, 450);
setTimeout(_iProvCheck, 250);
setTimeout(_iProvCheck, 900);
setTimeout(function () {
if (_kbActive && _vv && _vv.height >= _fullVv - 60) restoreKb();
}, 400);
setTimeout(healViewport, 650);
});
} catch (e) {}
}
if (!isIOS) {
try {
var _aPhone = document.querySelector('.phone');
var _aVV = window.visualViewport;
if (_aVV && _aPhone) {
var _aH = _aVV.height; // 无键盘基准（跟随地址栏显隐更新）
var _aKb = false;
var _aKbAt = 0, _aVvChgAt = Date.now(), _aVvStale = false;
var _aKbMute = false;
var _aTextFocused = null;
var _aFocusAt = 0, _aProv = false, _aIH = window.innerHeight;
var _aVvShrunkSeen = false;
var _aLastAct = Date.now();
var _aLastVVH = 0;
var _aPrevH = 0;
var _aPanSeen = 0, _aPanSeenAt = 0;
var _aBurstUntil = 0;
var _aFullIH = Math.max(window.innerHeight || 0, Math.round(_aVV.height || 0));
var _aScrKey = (screen.width || 0) + 'x' + (screen.height || 0);
var _aVpPin = false;
var _aShrinkHadFoc = false;
var _aVpPinAt = 0;
var _aFitPend = null;
var _aFitPin = false;
setInterval(function () {
try {
if (document.visibilityState !== 'visible') return;
if (!_aKb && !_aProv && !_aClosing && _aPhone.style.top
&& Math.abs(Math.round(_aVV.offsetTop || 0)) <= 4) _aPhone.style.removeProperty('top');
try { syncSafeBottomA(); } catch (eSB1) {} // FIX 2026-09-15 #530：键盘期底部安全区归零，1s 对账（漏 vv 事件也能收口）
if ((_aKb || _aProv) && !_aIsText(document.activeElement) && Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200) {
var _vvStillSaysKb = _aVV && _aVV.height > 0 && _aVV.height < _aH - 60;
_aKb = false; _aClosing = false; _aProvClear();
if (_vvStillSaysKb) _aVvStale = true;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
return;
}
if (_aKb && !_aProv) {
var _vN = Math.round(_aVV.height || 0);
var _iN = window.innerHeight || 0;
var _dK = _aH - _vN;
var _kbFloor = Math.round(Math.min(_aIH || _aH, _aH || _aIH) * 0.22);
if (_vN > 0 && _vN >= _aH - 12 && _iN >= _aIH - 12 && !_aIsText(document.activeElement)) {
_aKb = false; _aClosing = false; _aVvStale = false;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
} else if (_vN > 0 && _dK >= 13 && _dK < _kbFloor && _iN >= _aIH - 12
&& Date.now() - _aKbAt > 1500 && Date.now() - _aVvChgAt > 1200) {
_aKb = false; _aClosing = false; _aVvStale = true;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
}
return;
}
if (_aKb || _aProv) return;
var _ihNow = window.innerHeight || 0;
var _skNow = (screen.width || 0) + 'x' + (screen.height || 0);
if (_skNow !== _aScrKey) {
_aScrKey = _skNow;
_aFullIH = Math.max(_ihNow, Math.round(_aVV.height || 0));
if (_aVpPin) { _aVpPin = false; _aPhone.style.height = ''; _aPhone.style.alignSelf = ''; }
return;
}
if (_ihNow > _aFullIH) _aFullIH = _ihNow;
if (_aVpPin && _ihNow >= _aFullIH - 12) {
_aVpPin = false;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
return;
}
var _coarse = false;
try { _coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches; } catch (eC) {}
var _vvN = Math.round(_aVV.height || 0);
if (!_aVpPin && !_aShrinkHadFoc && _ihNow > 0 && _vvN > 0 && _coarse
&& !_aIsText(document.activeElement) && !_aIsText(_aTextFocused)
&& Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200
&& Math.abs(_ihNow - _vvN) <= 12
&& (_ihNow < _aFullIH - 60 || _vvN < _aH - 60)) {
_aShrinkHadFoc = false;
_aH = _vvN; _aIH = _ihNow;
if (_ihNow < _aFullIH) _aFullIH = _ihNow;
return;
}
var _ihFloor = Math.round(Math.min(_aFullIH, _aH || _aFullIH) * 0.22);
if (!_aVpPin && _coarse && (_aVvShrunkSeen || _aPanSeen >= 80) && _aShrinkHadFoc
&& !_aIsText(document.activeElement) && !_aIsText(_aTextFocused)
&& Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200
&& _ihNow > 0 && _ihNow < _aFullIH - 60 && (_aFullIH - _ihNow) >= _ihFloor
&& Math.abs(_ihNow - _vvN) <= 12) {
try { window.scrollTo(0, 0); } catch (eS) {}
_aVpPin = true;
_aVpPinAt = Date.now();
if (_aPhone.style.height !== _aFullIH + 'px') _aPhone.style.height = _aFullIH + 'px';
_aPanComp();
kbUndockPanels();
return;
}
if (_aVpPin && _aVpPinAt > 0 && Date.now() - _aVpPinAt > 10000 && _ihNow > 0
&& _ihNow < _aFullIH - 60 && Date.now() - _aLastAct < 2200) {
_aVpPin = false; _aVpPinAt = 0;
_aShrinkHadFoc = false;
_aH = Math.min(_aH, _vvN); _aIH = _ihNow;
if (_ihNow < _aFullIH) _aFullIH = _ihNow;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
return;
}
var _aInlineHad = !!(_aPhone.style.height || _aPhone.style.alignSelf);
if (_aInlineHad) {
var _hNow = Math.round(_aVV.height || 0);
if (_hNow > 0 && _hNow >= _aH - 12 && (window.innerHeight || 0) >= _aIH - 12) {
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
}
}
try {
var _aExpB = window.innerHeight || 0;
var _aVvQ = Math.round(_aVV.height || 0);
var _aFitGo = _aExpB > 0 && _aVvQ > 0 && _coarse && !_aVpPin && !_aKb && !_aProv
&& Math.abs(_ihNow - _aVvQ) <= 12
&& !_aIsText(document.activeElement) && !_aIsText(_aTextFocused)
&& Date.now() - _aVvChgAt > 1200
&& !(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
if (_aFitGo) {
var _aPbNow = Math.round(_aPhone.getBoundingClientRect().bottom);
var _aDev = (_aPbNow > 0) ? (_aPbNow - _aExpB) : 0;
if (_aDev > 8 || _aDev < -8) {
if (_aFitPend === _aExpB) {
if (_aPhone.style.height !== _aExpB + 'px') _aPhone.style.height = _aExpB + 'px';
_aFitPin = true;
_aPanComp();
} else {
_aFitPend = _aExpB; // 首见只记账，下一拍（≥1s 后）同值才动手
}
} else {
_aFitPend = null;
if (_aFitPin) { _aPhone.style.height = ''; _aFitPin = false; _aPanComp(); }
}
} else {
_aFitPend = null;
if (_aFitPin) { _aPhone.style.height = ''; _aFitPin = false; }
}
} catch (eFit) {}
} catch (e) {}
}, 1000);
window.__mochiAndroidKb = function () {
return {
kbActive: !!_aKb,
prov: !!_aProv,
closing: !!_aClosing,
staleVv: !!_aVvStale, // #236：vv 残留读数闩在位（诊断现场用）
shrinkHadFoc: !!_aShrinkHadFoc, // #479：最近深缩的焦点语境（true=键盘形/#369 语义；false=窗口改尺寸已重锚）
vpPin: !!_aVpPin, // #369：布局视口残留钉高在位（诊断现场用）
docLocked: false,
fullInner: Math.round(_aIH),
fullVv: Math.round(_aH),
vvNow: Math.round(_aVV.height),
offsetTop: Math.round(_aVV.offsetTop || 0),
panSeen: Math.round(_aPanSeen), // #267：本会话实测到的浏览器最大平移量＝保底停靠的尺子
panSeenAgo: _aPanSeenAt ? Date.now() - _aPanSeenAt : -1, // 该读数距今多久（>1500ms 不再采信）
vkOn: !!_aVkOn, // #337：VirtualKeyboard 实测尺是否已拉起
vkH: (function () { try { var b = navigator.virtualKeyboard && navigator.virtualKeyboard.boundingRect; return b ? Math.round(b.height) : -1; } catch (eK) { return -1; } })(),
burstLeft: Math.max(0, _aBurstUntil - Date.now()),
focusTag: _aTextFocused ? String(_aTextFocused.tagName || '').toLowerCase() : '',
watching: !!_aWatch,
lastActAgo: Date.now() - _aLastAct,
typosAgo: Date.now() - _aUserTypos
};
};
function _aWinY() {
try { return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0; } catch (e) { return 0; }
}
function _aPanComp() {
try {
var o = Math.round(_aVV.offsetTop || 0);
if (o > 0) {
if (_aPhone.style.position !== 'relative') _aPhone.style.position = 'relative';
if (_aPhone.style.top !== o + 'px') _aPhone.style.top = o + 'px';
} else {
if (_aPhone.style.top) _aPhone.style.removeProperty('top');
}
_aSchedCe();
} catch (e) {}
}
function _aPinPan() {
try {
var offT = _aVV.offsetTop || 0;
var winY = _aWinY();
if (!_aKb && !_aProv) {
var _panPx = offT > winY ? offT : winY;
if (_panPx > 8) {
if (_panPx > _aPanSeen) _aPanSeen = _panPx;
_aPanSeenAt = Date.now();
}
}
if (offT > 0 && _aVV.scrollTo) { try { _aVV.scrollTo(0, 0); } catch (e4) {} }
if (winY > 0) {
try { window.scrollTo(0, 0); } catch (e2) {}
try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e3) {}
}
var offT2 = _aVV.offsetTop || 0;
var winY2 = _aWinY();
if (offT2 > 160 || winY2 > 160) {
if (winY2) {
try { window.scrollTo(0, 0); } catch (e2) {}
try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e3) {}
}
if (offT2 && _aVV.scrollTo) { try { _aVV.scrollTo(0, 0); } catch (e4) {} }
}
if (_aKb || _aProv) {
_aPanComp();
}
if (!_aKb && !_aProv && Date.now() > _aBurstUntil) return;
if (offT2 <= 8 && winY2 <= 8) return;
var need = offT2 > 160 || winY2 > 160;
if (!need) {
var tgt = (_aIsText(_aTextFocused) ? _aTextFocused : null) ||
(_aIsText(document.activeElement) ? document.activeElement : null);
if (tgt && tgt.getBoundingClientRect) {
var r = tgt.getBoundingClientRect(); // 布局坐标；可视区=[offT, offT+vv.height]
if (r.top >= offT2 - 8 && r.bottom <= offT2 + _aVV.height - 8) need = true;
} else {
need = true;
}
}
if (!need) return;
if (winY2) {
try { window.scrollTo(0, 0); } catch (e2) {}
try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e3) {}
}
if (offT2 && _aVV.scrollTo) { try { _aVV.scrollTo(0, 0); } catch (e4) {} }
} catch (e) {}
}
function _aBump() { _aLastAct = Date.now(); _aVvStale = false; } // #236：真实交互解除 vv 残留闩
function _aIsText(el) {
return el && ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
? (el.type !== 'checkbox' && el.type !== 'range' && el.type !== 'file' && el.type !== 'color' && !el.readOnly)
: el.isContentEditable === true);
}
var _aSafeB = null;
function syncSafeBottomA() {
try {
var d = document.documentElement;
var _kbOn = !!(_aProv || (_aVV && _aH > 0 && _aVV.height > 0 && _aVV.height < _aH - 60));
var _fcB = null;
try {
_fcB = window.mochiViewportForm({ standalone: false, envTop: (typeof _aCoverEnvCache !== 'undefined' && _aCoverEnvCache >= 0) ? _aCoverEnvCache : 0, innerH: window.innerHeight || 0, screenH: (window.screen && window.screen.height) || 0, innerW: window.innerWidth || 0, screenW: (window.screen && window.screen.width) || 0, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false, e2eLatch: !!window.__mochiE2eLatch });
} catch (eF2) {}
if (_fcB && _fcB.e2eBrowser && !window.__mochiE2eLatch) window.__mochiE2eLatch = true;
var _next = _kbOn ? '0px' : ((_fcB && _fcB.e2eBrowser && _fcB.safeBottom) ? _fcB.safeBottom + 'px' : '');
if (_next === _aSafeB) return;
_aSafeB = _next;
if (_next) d.style.setProperty('--mochi-safe-bottom', _next);
else d.style.removeProperty('--mochi-safe-bottom');
} catch (e) {}
}
var _aZoomFixCnt = 0, _aZoomFixAt = 0;
var _aZoomMetaA = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-visual';
var _aZoomMetaB = _aZoomMetaA.replace('initial-scale=1.0', 'initial-scale=1').replace('minimum-scale=1.0', 'minimum-scale=1').replace('maximum-scale=1.0', 'maximum-scale=1');
function syncAndroidKb() {
if (!_aVV || !_aPhone) return;
try { syncSafeBottomA(); } catch (eSB) {}
var h = _aVV.height;
if (_aVV.scale && _aVV.scale < 0.95 && (_aKb || _aProv || _aIsText(_aTextFocused) || _aIsText(document.activeElement))) {
var _zn = Date.now();
if (_aZoomFixCnt < 3 && _zn - _aZoomFixAt > 4000) {
_aZoomFixCnt++; _aZoomFixAt = _zn;
try {
document.querySelectorAll('meta[name="viewport"]').forEach(function (m) {
m.setAttribute('content', (_aZoomFixCnt % 2) ? _aZoomMetaB : _aZoomMetaA);
});
} catch (eZM) {}
window.__mochiKbZoomFix = { n: _aZoomFixCnt, at: _zn, scale: +_aVV.scale.toFixed(2) };
}
}
if (h >= _aH - 60) _aVvStale = false; // #236：vv 回基准=读数诚实，解除残留闩
if (h !== _aPrevH || h >= _aH - 60) _aKbMute = false;
if (h !== _aPrevH) _aVvChgAt = Date.now();
var _ihN = window.innerHeight || 0;
var _focNow = _aIsText(_aTextFocused) || _aIsText(document.activeElement);
if (!_focNow && !_aKb && !_aProv && _ihN > 0 && h > 0
&& Math.abs(_ihN - h) <= 12
&& (h < _aH - 60 || _ihN < _aIH - 60)) {
_aShrinkHadFoc = false;
_aH = h; _aIH = _ihN;
if (_ihN < _aFullIH) _aFullIH = _ihN;
if (_aVpPin) { _aVpPin = false; _aPhone.style.height = ''; _aPhone.style.alignSelf = ''; }
} else if (_focNow && (h < _aH - 60 || _ihN < _aIH - 60)) {
_aShrinkHadFoc = true;
}
if (_aKb && h > _aPrevH && _aPrevH > 0) {
_aClosing = true;
}
_aPrevH = h;
var open = (!_aVvStale && !_aKbMute && h < _aH - 60 && _focNow); // 可视高度明显变小 = 键盘弹出（#236：残留读数闩抑制纯 vv 信号；真键盘不受影响——inner 同缩走原判/交互与回基准解锁；#479：必然伴随文本聚焦）
if (!open && h > _aH) _aH = h; // 无键盘时更新基准，地址栏变化不误判
if (open && !_aKb) { _aClosing = false; _aKb = true; _aVvShrunkSeen = true; _aKbAt = Date.now(); _aPhone.style.alignSelf = 'flex-start'; kbDockPanels(); _aProvClear(); }
if (!open && _aKb) {
if (h < _aH - 12) {
_aClosing = true;
if (_aPhone.style.height !== h + 'px') _aPhone.style.height = h + 'px';
return;
}
_aKb = false;
_aClosing = false;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
if (_aH < window.innerHeight - 12) _aH = window.innerHeight;
_aPanComp();
kbUndockPanels();
return;
}
if (_aKb) {
var hs = h + 'px';
if (_aPhone.style.height !== hs) _aPhone.style.height = hs;
if (!_aClosing) _aPinPan();
}
}
var _aWatch = null;
function startAWatch() {
if (_aWatch) return;
_aWatch = setInterval(function () {
try {
var foc = _aIsText(_aTextFocused) || _aIsText(document.activeElement);
if (foc) {
_aBurstUntil = Date.now() + 850;
syncAndroidKb();
nudgeInputVisible();
_aProvCheck();
_aProvDeepen();
_aPinPan();
var _hNow = _aVV.height;
if (_aKb && !_aClosing && _aLastVVH && _aLastVVH < _hNow) {
_aClosing = true;
}
if (_aProv && _aLastVVH && _aLastVVH < _aH - 60 && _hNow >= _aH - 60) {
_aProvClear();
}
_aLastVVH = _hNow;
if (_aProv && _aVvShrunkSeen && _aVV.height >= _aH - 60 && Date.now() - _aLastAct > 2200) {
_aProvClear();
}
} else if (_aKb) {
if (_aVV.height >= _aH - 12) {
_aKb = false;
_aClosing = false;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
}
} else {
_aProvCheck();
stopAWatch();
}
} catch (e) {}
}, 250);
}
function stopAWatch() {
if (_aWatch) { clearInterval(_aWatch); _aWatch = null; }
}
function _aProvDock() {
var base = Math.min(_aH, _aIH);
var ph = Math.max(240, Math.round(base * 0.58));
if (_aPanSeen >= 80 && Date.now() - _aPanSeenAt < 1500) {
var _meas = Math.round(base - _aPanSeen);
if (_meas >= 240 && _meas <= base - 40) ph = _meas;
}
_aProv = true;
try { syncSafeBottomA(); } catch (eSBP) {} // FIX 2026-09-15 #530：推定停靠同样按键盘在场归零
_aPhone.style.alignSelf = 'flex-start';
if (_aPhone.style.height !== ph + 'px') _aPhone.style.height = ph + 'px';
kbDockPanels();
try { window.scrollTo(0, 0); } catch (e) {}
_aPinPan(); // v3.15.x：推顶后残留的 vv 平移同样归零（K80 同症状）
_aProvVkRuler(base); // #337：Chromium 悬浮键盘改用 VirtualKeyboard 实测几何精停
}
var _aVkOn = false;
function _aProvVkRuler(base) {
try {
var vk = navigator.virtualKeyboard;
if (!vk) return;
if (!_aVkOn) {
_aVkOn = true;
vk.overlaysContent = true;
vk.addEventListener('geometrychange', function () {
try {
if (!_aProv || _aKb || !_aPhone) return;
var kbH = Math.round((vk.boundingRect && vk.boundingRect.height) || 0);
if (kbH < 80) return;
var b2 = Math.min(_aH, _aIH);
var ph2 = Math.max(240, Math.min(b2 - Math.max(kbH, 40), b2 - 40));
if (_aPhone.style.height !== ph2 + 'px') _aPhone.style.height = ph2 + 'px';
} catch (eG) {}
});
}
} catch (eVk) {}
}
function _aCoverBottom(el) {
try {
var b = el.getBoundingClientRect().bottom;
var row = el.closest ? el.closest('.chat-input-row') : null;
if (row) b = Math.max(b, row.getBoundingClientRect().bottom);
return b;
} catch (eCB) { return el.getBoundingClientRect().bottom; }
}
function _aProvDeepen() {
try {
if (!_aProv || _aKb) return;
var tgt = (_aIsText(_aTextFocused) ? _aTextFocused : null) ||
(_aIsText(document.activeElement) ? document.activeElement : null);
if (!tgt || !tgt.getBoundingClientRect) return;
var visBottom = (_aVV.offsetTop || 0) + _aVV.height;
var r = tgt.getBoundingClientRect();
if (!(r.height > 0 && _aCoverBottom(tgt) > visBottom + 12)) return; // 已露出
var base = Math.min(_aH, _aIH);
var cur = parseInt(_aPhone.style.height, 10) || Math.round(base * 0.58);
var ph = Math.max(Math.round(base * 0.34), cur - Math.round(base * 0.08));
if (ph < cur && _aPhone.style.height !== ph + 'px') _aPhone.style.height = ph + 'px';
} catch (eD) {}
}
function _aProvUserConfirm() {
try {
if (!_aProv || _aKb) return;
var tgt = (_aIsText(_aTextFocused) ? _aTextFocused : null) ||
(_aIsText(document.activeElement) ? document.activeElement : null);
if (!tgt || Date.now() - _aUserTypos > 1200) return;
_aProvClear();
startAWatch();
} catch (e) {}
}
try {
document.addEventListener('input', function () { _aProvUserConfirm(); }, true);
document.addEventListener('compositionstart', function () { _aUserTypos = Date.now(); _aProvUserConfirm(); }, true);
} catch (eProvUser) {}
function _aProvClear() {
if (!_aProv) return;
_aProv = false;
try { syncSafeBottomA(); } catch (eSBC) {} // FIX 2026-09-15 #530：退出推定停靠时重算（_aKb 仍真则不摘）
try { if (_aVkOn && navigator.virtualKeyboard) { navigator.virtualKeyboard.overlaysContent = false; _aVkOn = false; } } catch (eVkOff) {}
if (_aKb) return; // 正常机制已接管 .phone 高度，交回原逻辑管理
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
}
function _aProvCheck() {
try {
if (!_aVV || !_aPhone) return;
var tgt = (_aIsText(_aTextFocused) ? _aTextFocused : null) ||
(_aIsText(document.activeElement) ? document.activeElement : null);
var ih = window.innerHeight;
if (!tgt) {
if (!_aKb && !_aProv && (ih >= _aIH - 12 || _aIH - ih < Math.round(Math.min(_aIH || ih, _aH || ih) * 0.22))) _aIH = ih;
if (_aProv && _aVV.height >= _aH - 60) _aProvClear();
return;
}
var _kbCovered = false;
try {
var _rC = tgt.getBoundingClientRect ? tgt.getBoundingClientRect() : null;
var _visBottomC = (_aVV.offsetTop || 0) + _aVV.height;
_kbCovered = !!(_rC && _rC.height > 0 && _aCoverBottom(tgt) > _visBottomC + 12);
} catch (eCov) {}
if (!_aKb && !_aProv && !_aKbMute &&
Date.now() - _aFocusAt > 900 &&
Date.now() - kbLastTouchAt < 1500 &&
kbTouchArmed(tgt) &&
Date.now() > kbHardKeyUntil &&
Math.abs(_aVV.height - _aH) <= 2 &&
Math.abs(ih - _aIH) <= 2 && _kbCovered) {
_aProvDock();
} else if (!_aKb && !_aProv && !_aKbMute &&
Date.now() - _aFocusAt > 900 &&
kbTouchArmed(tgt) &&
Date.now() > kbHardKeyUntil) {
if (_kbCovered) _aProvDock();
}
} catch (e) {}
}
try {
document.addEventListener('touchstart', _aBump, { passive: true, capture: true });
} catch (e) {}
var _aProofT = null;
try {
document.addEventListener('touchstart', function (e) {
try {
if (!_aKb || _aProv || _aClosing) return;       // 只管 vv 收缩的键盘会话
if (Date.now() - _aKbAt < 1200) return;         // 会话刚开始（弹起/首帧定位）不判
if (Date.now() - _aVvChgAt < 400) return;       // 读数刚变＝动画中途，不判
var t = e.touches && e.touches[0];
if (!t || _aIsText(e.target)) return;           // 触摸落在输入框上＝用户去点输入框，不判
if (!(t.clientY > Math.round((_aVV.offsetTop || 0) + _aVV.height) + 24)) return;
clearTimeout(_aProofT);
_aProofT = setTimeout(function () {
try {
if (!_aKb || _aProv || _aClosing) return;
if (Date.now() - _aVvChgAt < 400) return;
_aKbMute = true; _aVvStale = true;
_aKb = false; _aClosing = false;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
} catch (e2) {}
}, 60);
} catch (e1) {}
}, { passive: true, capture: true });
} catch (ePT) {}
try {
document.addEventListener('keydown', _aBump, true);
} catch (e) {}
_aVV.addEventListener('resize', syncAndroidKb);
try { window.addEventListener('resize', function () { try { syncAndroidKb(); } catch (eWR) {} }); } catch (eWR2) {}
_aVV.addEventListener('resize', _aSchedCe);
window.addEventListener('resize', _aSchedCe);
document.addEventListener('focusin', function (e) {
try {
_aClosing = false; _aVvStale = false; // v3.28.x：聚焦=弹键盘（或保持），退出收起态；#236 解除 vv 残留闩
if (_aIsText(e.target)) { _aTextFocused = e.target; _aFocusAt = Date.now(); _aBump(); _aPanSeen = 0; } // #267：新键盘会话重新量平移
if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
try { syncAndroidKb(); } catch (e3) {}
setTimeout(syncAndroidKb, 120);
setTimeout(syncAndroidKb, 350);
_aBurstUntil = Date.now() + 850;
var _burstCnt = 0;
function _burstTick() {
try { syncAndroidKb(); _aPinPan(); nudgeInputVisible(); } catch (ee) {}
if (++_burstCnt < 10) setTimeout(_burstTick, 80);
}
setTimeout(_burstTick, 40);
setTimeout(_aProvCheck, 950);
setTimeout(_aProvCheck, 1700);
try { startAWatch(); } catch (e4) {}
}
} catch (e2) {}
});
document.addEventListener('focusout', function (e) {
var _lostText = false;
try {
_lostText = _aIsText(e.target);
if (e.target === _aTextFocused) _aTextFocused = null;
} catch (e2) {}
if (_aKb) _aClosing = true; // v3.28.x：键盘开着时失焦=正在收起，标记以跳过逐帧 _aPinPan
setTimeout(syncAndroidKb, 120);
setTimeout(syncAndroidKb, 350);
setTimeout(_aProvCheck, 250);
setTimeout(_aProvCheck, 900);
setTimeout(function () {
if (!_aKb) return;
if (_aVV.height >= _aH - 60) {
_aKb = false;
_aClosing = false;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
return;
}
if (!_lostText) return;
if (_aIsText(document.activeElement)) return;
if (!_aVV.height || Date.now() - _aVvChgAt < 350) return;
_aVvStale = true;
_aKb = false;
_aClosing = false;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
}, 400);
});
document.addEventListener('visibilitychange', function () {
if (document.visibilityState !== 'visible') {
try {
_aProvClear();
if (_aKb) {
_aKb = false;
_aClosing = false;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
}
_aLastVVH = 0;
} catch (e2) {}
}
});
var _aDismissAt = 0, _aDismissTimer = 0, _aDismissTries = 0;
function _aDismissCheck() {
try {
_aDismissTimer = 0;
if (!_aDismissAt) return;                                            // 无在途请求
var _dAge = Date.now() - _aDismissAt;
if (_dAge < 750) return;                                             // 更晚的请求会另起计时
if (_dAge > 3000) { _aDismissAt = 0; _aDismissTries = 0; return; }    // 有界窗口到点＝交回正常链路
var _dRetry = function () {
_aDismissTries++;
if (_aDismissTries <= 6 && !_aDismissTimer) _aDismissTimer = setTimeout(_aDismissCheck, 400);
};
if (!_aPhone.style.height) { _aDismissAt = 0; _aDismissTries = 0; return; } // 主链路已复原＝收工
if (_aIsText(document.activeElement)) return _dRetry();              // 有活焦点＝键盘可能真在场
if (Date.now() - _aFocusAt < 750) return _dRetry();                  // 请求后又有文本聚焦
if (_aVV && _aVV.height > 0 && _aVV.height < _aH - 60 && Date.now() - _aVvChgAt < 500) return _dRetry(); // 读数仍在变＝动画中
var _dStillSaysKb = !!(_aVV && _aVV.height > 0 && _aVV.height < _aH - 60);
_aKb = false; _aClosing = false; _aProvClear();
if (_dStillSaysKb) _aVvStale = true;
_aPhone.style.height = '';
_aPhone.style.alignSelf = '';
_aPanComp();
kbUndockPanels();
window.__mochiKbDismissHealAt = Date.now(); // 诊断留痕（device.js 读）
_aDismissAt = 0; _aDismissTries = 0;
} catch (eD) {}
}
window.mochiKbDismiss = function () {
try {
_aDismissAt = Date.now();
_aDismissTries = 0;
if (_aDismissTimer) clearTimeout(_aDismissTimer);
_aDismissTimer = setTimeout(_aDismissCheck, 800);
} catch (e) {}
};
}
var _aCoverEnvCache = -1;
function _aSyncCoverTop() {
try {
var _d = document.documentElement;
var _ih = window.innerHeight || 0;
var _sh = (window.screen && window.screen.height) || 0;
if (!_ih || !_sh) return;
if (_aCoverEnvCache < 0) {
try {
var _p = document.createElement('div');
_p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);';
document.body.appendChild(_p);
_aCoverEnvCache = parseFloat(getComputedStyle(_p).paddingTop) || 0;
document.body.removeChild(_p);
} catch (e4) { _aCoverEnvCache = 0; }
}
var _fc = window.mochiViewportForm({ standalone: false, envTop: _aCoverEnvCache, innerH: _ih, screenH: _sh, innerW: window.innerWidth || 0, screenW: (window.screen && window.screen.width) || 0, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false, e2eLatch: !!window.__mochiE2eLatch });
if (_fc.e2eBrowser && !window.__mochiE2eLatch) window.__mochiE2eLatch = true;
var _st = _fc.safeTop || 0;
var _px = _st ? _st + 'px' : '';
if (_d.style.getPropertyValue('--mochi-safe-top') !== _px) {
if (_px) _d.style.setProperty('--mochi-safe-top', _px);
else _d.style.removeProperty('--mochi-safe-top');
}
if (!!_st !== _d.classList.contains('mochi-cover-top')) _d.classList.toggle('mochi-cover-top', !!_st);
} catch (e) {}
}
try { _aSyncCoverTop(); } catch (e) {}
try {
window.addEventListener('resize', _aSyncCoverTop);
window.addEventListener('orientationchange', function () { _aCoverEnvCache = -1; window.__mochiE2eLatch = false; _aSyncCoverTop(); });
} catch (e) {}
} catch (e) {}
}
const FLOAT_SELECTORS = ['#tc-mask', '#cc-export-mask', '#cc-scope-mask', '#call-mask', '#feed-notice-panel', '#feed-comment-panel', '#poke-card', '#gc-poke-card', '#emoji-panel', '#chat-ask-panel', '#qa-mask', '#chat-more-panel', '#gc-more-panel', '#chat-search', '#chat-decision-panel', '#chat-gdecision-panel', '#chat-divine-panel', '#chat-rps-panel', '#chat-call-panel', '#chat-pong-panel', '#chat-snake-panel', '#chat-brick-panel', '#chat-c4-panel', '#chat-ms-panel', '#chat-fish-panel', '#chat-memory-panel', '#chat-gift-panel', '#chat-gomoku-panel', '#chat-linkup-panel', '#chat-match3-panel', '#chat-auction-panel', '#chat-arcade-panel', '#avlib-card', '#ck-panel', '#loc-panel', '.mg-mask', '#modal-mask', '#dl-picker-mask', '#msg-actions', '#gc-msg-actions', '#desk-image-viewer', '.desk-lib', '#gc-members-panel', '#gc-at-panel', '#gc-settings-panel', '#img-view-mask', '#chat-rp-panel', '#batch-panel', '#eat-switch-overlay', '#voice-panel', '#applock-mask', '#cs-bg-panel', '#phone-bg-gallery-panel', '#feed-sticker-card',
'#pc-sheet-mask',
'#cs-input-order-panel',
'#screen-adj-panel',
'#chat-beauty-drawer',
'#beauty-drawer', '#icon-fit-panel'];
let kbPanelDocked = false;
function kbDockPanels() {
if (kbPanelDocked) return;
kbPanelDocked = true;
try {
document.querySelectorAll(FLOAT_PANEL_SELECTORS.join(',')).forEach(function (el) {
if (el.hidden || el.getClientRects().length === 0) return;
if (el.style.position !== 'absolute') el.dataset.kbPrevPos = el.style.position || '';
el.style.position = 'absolute';
el.style.left = '18px'; el.style.right = '18px';
el.style.top = 'auto';
el.style.bottom = 'calc(96px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)))';
el.style.maxHeight = 'calc(100% - 104px)';
});
_aSchedCe(); // v3.16.x：面板被 absolute 停靠后，内部 ce-box 合成层需刷新跟随
} catch (e) {}
}
function kbUndockPanels() {
if (!kbPanelDocked) return;
kbPanelDocked = false;
try {
document.querySelectorAll(FLOAT_PANEL_SELECTORS.join(',')).forEach(function (el) {
if (el.dataset.kbPrevPos !== undefined) {
if (el.dataset.kbPrevPos) el.style.position = el.dataset.kbPrevPos;
else el.style.removeProperty('position');
delete el.dataset.kbPrevPos;
}
el.style.removeProperty('bottom');
el.style.removeProperty('left');
el.style.removeProperty('right');
el.style.removeProperty('top');
el.style.removeProperty('max-height');
});
} catch (e) {}
}
try {
document.addEventListener('transitionstart', function () { if (kbPanelDocked) kbDockPanels(); }, true);
} catch (e) {}
let locked = false;
const MANUAL_LOCK_IDS = ['period-day-pop', 'period-care-pop', 'period-report-pop', 'period-settings-pop', 'period-notify-pop'];
function floatIsOpen(el) {
try {
if (!el || el.hidden) return false;
return el.getClientRects().length > 0;
} catch (e) { return false; }
}
function applyLock() {
let anyOpen = false;
try {
anyOpen = FLOAT_SELECTORS.some(function (sel) { return floatIsOpen(document.querySelector(sel)); }) ||
MANUAL_LOCK_IDS.some(function (id) { return !!document.getElementById(id); });
} catch (e) { anyOpen = false; }
if (anyOpen && !locked) {
document.body.classList.add('scroll-lock');
locked = true;
} else if (!anyOpen && locked) {
document.body.classList.remove('scroll-lock');
locked = false;
}
}
try {
const mo = new MutationObserver(applyLock);
FLOAT_SELECTORS.forEach(function (sel) {
try {
const el = document.querySelector(sel);
if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
} catch (e) {}
});
const bodyMo = new MutationObserver(function (muts) {
let changed = false;
muts.forEach(function (m) {
if (!m.addedNodes) return;
m.addedNodes.forEach(function (n) {
if (!n || n.nodeType !== 1 || !n.classList) return;
const isMg = n.classList.contains('mg-mask');
const inList = !isMg && n.id && FLOAT_SELECTORS.indexOf('#' + n.id) >= 0;
if (isMg || inList) {
try { mo.observe(n, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
changed = true;
}
});
});
if (changed) applyLock();
});
bodyMo.observe(document.body, { childList: true });
} catch (e) {}
applyLock();
document.addEventListener('touchstart', function () {
if (!locked) return;
try { applyLock(); } catch (e) {}
}, { passive: true });
setInterval(function () {
if (document.visibilityState !== 'visible') return;
try { applyLock(); } catch (e) {}
}, 1000);
window.scrollLockInfo = function () {
try {
const open = [];
FLOAT_SELECTORS.forEach(function (sel) {
const el = document.querySelector(sel);
if (floatIsOpen(el)) open.push(sel);
});
MANUAL_LOCK_IDS.forEach(function (id) { if (document.getElementById(id)) open.push('#' + id); });
return { lock: document.body.classList.contains('scroll-lock'), open: open };
} catch (e) { return null; }
};
var _escState = { streak: 0, key: '', firstAt: 0, lastAt: 0 };
var _escLastClickAt = 0;
var _escTap = null;
var _escHealing = false;
function _escKbOpen() {
try {
if (isIOS) { var f = window.__mochiIosKb && window.__mochiIosKb(); return !!(f && f.kbActive); }
var a = window.__mochiAndroidKb && window.__mochiAndroidKb();
return !!(a && (a.kbActive || a.prov));
} catch (e) { return false; }
}
function _escAnyFloatOpen() {
try {
for (var i = 0; i < FLOAT_SELECTORS.length; i++) {
if (floatIsOpen(document.querySelector(FLOAT_SELECTORS[i]))) return true;
}
for (var j = 0; j < MANUAL_LOCK_IDS.length; j++) {
if (document.getElementById(MANUAL_LOCK_IDS[j])) return true;
}
} catch (e) {}
return false;
}
function _escTouchDesc(el) {
try {
var seg = el && el.tagName ? String(el.tagName).toLowerCase() : '?';
if (el && el.id) seg += '#' + el.id;
else if (el && typeof el.className === 'string' && el.className) seg += '.' + el.className.split(/\s+/)[0];
return seg.slice(0, 40);
} catch (e) { return '?'; }
}
function _escHeal() {
var tag = [];
try {
if (locked || document.body.classList.contains('scroll-lock')) {
locked = false;
document.body.classList.remove('scroll-lock');
tag.push('scroll-lock');
}
if (!isIOS) {
var ph = document.querySelector('.phone');
if (ph) {
if (ph.style.height) { ph.style.height = ''; tag.push('phone.height'); }
if (ph.style.alignSelf) { ph.style.alignSelf = ''; tag.push('phone.alignSelf'); }
if (ph.style.top) { ph.style.removeProperty('top'); tag.push('phone.top'); }
}
}
var ae = document.activeElement;
if (ae && ae !== document.body && ae.blur) { try { ae.blur(); tag.push('blur'); } catch (e) {} }
} catch (e) {}
try { applyLock(); } catch (e) {}
return tag;
}
function _escRecord(streak, tag) {
try {
var arr = [];
try { arr = JSON.parse(localStorage.getItem('xy-home-v2:__diag-stuck') || '[]') || []; } catch (e) { arr = []; }
if (!Array.isArray(arr)) arr = [];
arr.push({ t: Date.now(), n: streak, tag: tag.length ? tag.join('+') : '(无残留可清=指向合成层/输入管线)' });
if (arr.length > 3) arr = arr.slice(-3);
localStorage.setItem('xy-home-v2:__diag-stuck', JSON.stringify(arr));
} catch (e) {}
}
function _escToast(msg) {
try {
var t = document.getElementById('cc-toast');
if (!t) {
t = document.createElement('div');
t.id = 'cc-toast';
document.body.appendChild(t);
}
t.textContent = msg;
t.className = 'cc-toast';
void t.offsetWidth;
t.className = 'cc-toast show';
clearTimeout(t._escT);
t._escT = setTimeout(function () { t.className = 'cc-toast'; }, 3200);
} catch (e) {}
}
function _escJudge(streak, deadline, tapEndAt) {
if (streak < 3) return;
setTimeout(function () {
try {
if (_escLastClickAt >= tapEndAt) { _escState.streak = 0; return; } // 点击活着=误报退出
if (_escState.streak < 3 || _escHealing) return;
_escHealing = true;
var tag = _escHeal();
_escState.streak = 0;
_escRecord(3, tag);
setTimeout(function () {
_escToast('检测到页面触控异常，已尝试恢复（' + (tag.length ? tag.join('+') : '无残留') + '）；若仍点不动请重启后在设置-诊断反馈');
_escHealing = false;
}, 60);
} catch (e) {}
}, Math.max(10, deadline - Date.now()));
}
document.addEventListener('touchstart', function (e) {
try {
var t = e.touches && e.touches[0];
if (!t) return;
_escTap = { x: t.clientX, y: t.clientY, t0: Date.now(), el: e.target };
} catch (e) {}
}, { passive: true, capture: true });
document.addEventListener('touchend', function (e) {
try {
if (document.visibilityState !== 'visible') { _escState.streak = 0; return; }
var tap = _escTap; _escTap = null;
if (!tap) return;
var te = e.changedTouches && e.changedTouches[0];
if (!te) return;
if (Date.now() - tap.t0 >= 350) return; // 长按（≥350ms=气泡菜单路径）不算轻点
var dx = te.clientX - tap.x, dy = te.clientY - tap.y;
if (dx * dx + dy * dy > 144) return;    // 位移 >12px=滚动手势不算
if (_escAnyFloatOpen()) { _escState.streak = 0; return; } // 弹层操作期不计数
if (_escKbOpen()) { _escState.streak = 0; return; }       // 键盘会话期不计数
var now = Date.now();
var key = _escTouchDesc(tap.el) + '@' + Math.round(te.clientX / 24) + ',' + Math.round(te.clientY / 24);
if (key !== _escState.key || now - _escState.lastAt > 650) {
_escState = { streak: 1, key: key, firstAt: now, lastAt: now };
_escJudge(1, now + 700, now);
return;
}
_escState.streak++;
_escState.lastAt = now;
_escJudge(_escState.streak, now + 700, now);
} catch (e) {}
}, { passive: true, capture: true });
document.addEventListener('click', function () {
_escLastClickAt = Date.now();
if (_escState.streak > 0) _escState.streak = 0; // 点击正常派发=页面活着，重新计数
}, { capture: true });
window.__mochiStuckProbe = function () {
try {
var open = [];
FLOAT_SELECTORS.forEach(function (sel) {
if (floatIsOpen(document.querySelector(sel))) open.push(sel);
});
var his = null;
try { his = JSON.parse(localStorage.getItem('xy-home-v2:__diag-stuck') || 'null'); } catch (e) {}
return {
streak: _escState.streak,
lock: document.body.classList.contains('scroll-lock'),
openFloats: open,
kb: _escKbOpen(),
lastHeal: his
};
} catch (e) { return null; }
};
})();
(function () {
var PFX = 'xy-home-v2:';
var KEYS = { top: 'screen-adj-top', bottom: 'screen-adj-bottom', h: 'screen-adj-h', desk: 'screen-adj-desk', shift: 'screen-adj-shift', text: 'screen-adj-text', side: 'screen-adj-side' };
var RANGE = { top: [-80, 80], bottom: [-80, 80], h: [-80, 80], desk: [-60, 60], shift: [-60, 60], text: [0, 12], side: [0, 12] };
function loadAdj(k) {
try { var v = parseInt(localStorage.getItem(PFX + KEYS[k]), 10); var rg = RANGE[k] || [-80, 80];
return (!isNaN(v) && v >= rg[0] && v <= rg[1]) ? v : 0; } catch (e) { return 0; }
}
var adj = { top: loadAdj('top'), bottom: loadAdj('bottom'), h: loadAdj('h'), desk: loadAdj('desk'), shift: loadAdj('shift'), text: loadAdj('text'), side: loadAdj('side') };
var el = document.documentElement;
var st = el.style;
var NAMES = { '--mochi-safe-top': 'top', '--mochi-ios-h': 'h' };
var base = {};           // var 名 -> 系统基准 px（包装层缓存）
var origSet = st.setProperty.bind(st);
var origRemove = st.removeProperty.bind(st);
var origGet = st.getPropertyValue.bind(st);
function lsSet(k, v) { try { if (v) localStorage.setItem(PFX + KEYS[k], String(v)); else localStorage.removeItem(PFX + KEYS[k]); } catch (e) {} }
function applyBottom() {
try {
const want = adj.bottom ? ('calc(env(safe-area-inset-bottom, 0px) + ' + adj.bottom + 'px)') : '';
const cur = origGet('--mochi-safe-bottom') || '';
if (want) { if (cur !== want) origSet('--mochi-safe-bottom', want); }
else if (cur.indexOf('calc(env(') === 0) origRemove('--mochi-safe-bottom');
} catch (e) {}
}
function applyDesk() {
try {
if (adj.desk) origSet('--mochi-desk-adj', adj.desk + 'px');
else if (origGet('--mochi-desk-adj')) origRemove('--mochi-desk-adj');
} catch (e) {}
}
function applyShift() {
try {
if (adj.shift) origSet('--mochi-shift-adj', adj.shift + 'px');
else if (origGet('--mochi-shift-adj')) origRemove('--mochi-shift-adj');
} catch (e) {}
}
function applyText() {
try {
if (adj.text) origSet('--mochi-text-adj', adj.text + 'px');
else if (origGet('--mochi-text-adj')) origRemove('--mochi-text-adj');
} catch (e) {}
}
function applySide() {
try {
if (adj.side) origSet('--mochi-side-adj', adj.side + 'px');
else if (origGet('--mochi-side-adj')) origRemove('--mochi-side-adj');
} catch (e) {}
}
function applyCached() {
for (var n in base) {
try { origSet(n, (base[n] + adj[NAMES[n]]) + 'px'); } catch (e) {}
}
applyBottom();
applyDesk();
applyShift();
applyText();
applySide();
}
st.setProperty = function (n, v) {
n = String(n).toLowerCase();
if (NAMES[n] !== undefined) {
var b = parseFloat(v); if (isNaN(b)) b = 0;
base[n] = b;
v = (b + adj[NAMES[n]]) + 'px';
}
return origSet(n, v);
};
st.removeProperty = function (n) {
n = String(n).toLowerCase();
if (NAMES[n] !== undefined) delete base[n];
return origRemove(n);
};
st.getPropertyValue = function (n) {
n = String(n).toLowerCase();
if (NAMES[n] !== undefined && base[n] !== undefined) return (base[n] + adj[NAMES[n]]) + 'px';
return origGet(n);
};
setInterval(applyBottom, 1000);
applyCached();
window.mochiScreenAdj = {
all: function () { return { top: adj.top, bottom: adj.bottom, h: adj.h, desk: adj.desk, shift: adj.shift, text: adj.text, side: adj.side }; },
set: function (k, v) {
if (!(k in adj)) return false;
v = parseInt(v, 10);
var rg = RANGE[k] || [-80, 80];
if (isNaN(v) || v < rg[0] || v > rg[1]) return false;
adj[k] = v;
lsSet(k, v || '');
applyCached();
return true;
}
};
})();
/* FIX 2026-09-20 #913 手机发烫收口①：页面切后台（document.hidden）全局暂停 CSS 动画——「后台保活」
用户把页面挂在后台/锁屏过夜时，进行中的无限动画（花园摇曳、房间流星/雨、漂流瓶波浪、音频可视化
条等）仍按合成器节奏推进＝后台发热/耗电的纯浪费源；音频播放、定时器、保活锚点都不是 CSS 动画，
不受影响；回前台移除类名即刻恢复，前台观感零变化。CSS 落点在 base.css（body.mochi-bg-pause）。 */
(function () {
var apply = function () {
if (!document.body) return;
document.body.classList.toggle('mochi-bg-pause', !!document.hidden); // #911
};
document.addEventListener("visibilitychange", apply);
if (document.body) apply(); else document.addEventListener("DOMContentLoaded", apply);
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("mobile-adapt.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("mobile-adapt.js"); try { console.error("[JS] mobile-adapt.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[mobile-adapt.js] " + String(__e && __e.message || __e)); } })();