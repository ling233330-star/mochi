(function () { try {
/* ===== 功能：应用锁（隐私防护·防偷看） =====
归属：系统/全局（AI-B 域）。build.mjs jsFiles 插在 contacts.js 之后加载。
入口：设置页「应用锁」组（template.html #applock-en / #applock-sub）。
数据：全局根键 xy-home-v2:applock-en / applock-pin / applock-qa（已进 contacts.js EXCLUDE，
绝不被 migrateLegacy 当旧顶层键迁进 default 并删根键）。
解锁态：sessionStorage 'mochi-applock-ok'——数字密码锁本会话解过一次即可，刷新同一标签不重锁；
冷启动/新开标签页/新窗口需重新输密码（对应「仅打开时锁」，切后台不锁）。
开屏问答门（v3.32.x）：不吃上述会话豁免——未输暗号（applock-qaskip≠1）时每次页面加载都重答全部题目，
无取消入口，只能答对或输暗号（暗号不上屏，见 QA_SKIP_CODE）。
忘记密码：靠设密码时绑定的安全问答重设；无问答时只能清除本站数据（锁屏内已说明）。
安全边界：纯前端本地锁，挡日常偷看；懂技术者可直读本机 localStorage/IndexedDB，
无服务端不可能绝对防御。密码/答案仅存 cyrb53 摘要（防一眼读出，非加密）。
UI：#applock-mask 全屏遮罩（已注册进 mobile-adapt FLOAT_SELECTORS，背景滚动锁归它统一管）。
全部交互自绘（数字键盘/文本输入/说明屏），不依赖 openModal——openModal 取消不回调，
流程会卡死；且其层级(99999)低于本遮罩(999999)。
====================================================== */
(function () {
'use strict';
const G = 'xy-home-v2';
const K_EN = 'applock-en';
const K_PIN = 'applock-pin';
const K_QA = 'applock-qa';
const SESS = 'mochi-applock-ok';
const K_QA_EN = 'applock-qa-en';
const K_QA_SKIP = 'applock-qaskip';
const K_PIN_HINT = 'applock-pinhint';
function gGet(k) {
try { const v = window.xyStore ? window.xyStore(G).get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
try { return localStorage.getItem(G + ':' + k); } catch (e2) { return null; }
}
function gSet(k, v) {
try { if (window.xyStore) window.xyStore(G).set(k, v); else localStorage.setItem(G + ':' + k, v); }
catch (e) { try { localStorage.setItem(G + ':' + k, v); } catch (e2) {} }
}
function h53(str) {
const s = String(str);
let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
for (let i = 0; i < s.length; i++) {
const ch = s.charCodeAt(i);
h1 = Math.imul(h1 ^ ch, 2654435761);
h2 = Math.imul(h2 ^ ch, 1597334677);
}
h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}
function pinHash() { return gGet(K_PIN) || ''; }
function qaGet() {
try {
const v = gGet(K_QA);
if (v && typeof v === 'string') {
const o = JSON.parse(v);
if (o && o.q && o.h) return o;
}
} catch (e) {}
return null;
}
function enabled() { return gGet(K_EN) === '1'; }
function setEn(v) { gSet(K_EN, v ? '1' : '0'); }
function savePin(pin) { gSet(K_PIN, h53(pin)); }
function saveQa(q, h) { gSet(K_QA, JSON.stringify({ q: String(q), h: String(h) })); }
const QA_SKIP_CODE = '990815';
const DEFAULT_QA = [
{ q: 'mj 是什么意思？（提示：答案为【两个字】）', a: '梦角' },
{ q: '是否已知晓：全站为随机代码运行，不含任何 AI，请不要添加负面字卡吓唬自己？（提示：答案为【一个字】）', a: '是' }
];
function qaList() {
return DEFAULT_QA.map(function (it) { return { q: it.q, h: h53(String(it.a).trim()) }; });
}
const IS_AUTOMATION = (typeof navigator !== 'undefined') &&
(navigator.webdriver === true || /Headless/i.test(String(navigator.userAgent)));
function qaEnabled() {
const v = gGet(K_QA_EN);
if (v === '1') return true;
if (v === '0') return false;
return !IS_AUTOMATION;   // 未设置：真机默认开，无头默认关
}
function qaSetEn(v) { gSet(K_QA_EN, v ? '1' : '0'); }
function qaSkipped() { return gGet(K_QA_SKIP) === '1'; }  // 本机已输暗号 → 永久跳过问答层
function qaSkipSet(v) { gSet(K_QA_SKIP, v ? '1' : '0'); }
function pinHintThen(next) {
if (pinHash() || gGet(K_PIN_HINT) === '1') { if (next) next(); return; }
gSet(K_PIN_HINT, '1');
padOpen({
kind: 'info', title: '小提醒：应用锁', ico: ICON_SHIELD, okLabel: '知道了',
sub: '新增了【应用锁】的自定义锁屏密码功能，可用于防止被人偷看手机聊天记录。问答层只拦「不知道答案的人」，开启数字密码后每次打开还需输密码，更稳妥。可在 设置 → 应用锁 里开启。',
onPrimary: function () { if (next) next(); }
});
}
function qaAnswerOk(v, h) { return h53(String(v == null ? '' : v).trim()) === h; }
function sessOk() { try { return sessionStorage.getItem(SESS) === '1'; } catch (e) { return false; } }
function sessMark() { try { sessionStorage.setItem(SESS, '1'); } catch (e) {} }
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2200);
}
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 018 0v3"/><circle cx="12" cy="15.5" r="1.5" fill="currentColor"/><path d="M12 17v1.5"/></svg>';
const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3.5V11c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5.5z"/></svg>';
let MASK = null;
function maskEl() {
if (!MASK) {
MASK = document.createElement('div');
MASK.id = 'applock-mask';
MASK.className = 'applock-mask';   // CSS 全用 .applock-mask 类选择器，id 仅供脚本/测试定位
MASK.hidden = true;
MASK.addEventListener('click', onMaskClick);
document.body.appendChild(MASK);
}
return MASK;
}
let cur = null;   // 当前面板配置
let buf = '';     // pad 输入缓冲
function render() {
const m = maskEl();
const o = cur;
let inner = '<div class="applock-box">' +
'<div class="applock-ico">' + (o.ico || ICON_LOCK) + '</div>' +
'<div class="applock-title">' + (o.title || '') + '</div>' +
(o.sub ? '<div class="applock-sub">' + o.sub + '</div>' : '');
if (o.kind === 'text') {
inner += '<input class="applock-txt" type="text" id="applock-txt" maxlength="' + (o.maxlen || 60) + '"' +
(o.value != null ? ' value="' + String(o.value).replace(/"/g, '&quot;') + '"' : '') +
(o.placeholder ? ' placeholder="' + o.placeholder + '"' : '') + ' autocomplete="off">' +
'<div class="applock-err" id="applock-err"></div>' +
'<div class="applock-btns">' +
(o.cancel !== false ? '<button type="button" class="al-ghost" data-link="cancel">' + (o.cancelLabel || '取消') + '</button>' : '') +
'<button type="button" class="al-primary" data-submit="1">' + (o.okLabel || '确定') + '</button>' +
'</div>' +
(o.links && o.links.length ? '<div class="applock-links">' + o.links.map(function (l) {
return '<button data-link="' + l.act + '">' + l.label + '</button>';
}).join('') + '</div>' : '');
} else if (o.kind === 'info') {
inner += '<div class="applock-btns" style="margin-top:6px">' +
(o.secondary ? '<button type="button" class="al-ghost" data-link="' + o.secondary.act + '">' + o.secondary.label + '</button>' : '') +
'<button type="button" class="al-primary" data-ok="1">' + (o.okLabel || '知道了') + '</button>' +
'</div>';
} else { // pad
let dots = '';
for (let i = 0; i < o.max; i++) dots += '<i></i>';
const keyLabels = { C: 'C', b: '⌫' };
let kh = '';
['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'b'].forEach(function (k) {
kh += '<button class="applock-key' + (/^\d$/.test(k) ? '' : ' dim') + '" data-k="' + k + '">' + (keyLabels[k] || k) + '</button>';
});
inner += '<div class="applock-dots" id="applock-dots">' + dots + '</div>' +
'<div class="applock-err" id="applock-err"></div>' +
'<div class="applock-keys">' + kh + '</div>' +
'<button class="applock-ok" id="applock-ok" disabled>' + (o.confirm || '确定') + '</button>' +
(o.links && o.links.length ? '<div class="applock-links">' + o.links.map(function (l) {
return '<button data-link="' + l.act + '">' + l.label + '</button>';
}).join('') + '</div>' : '');
}
inner += '</div>';
m.innerHTML = inner;
if (o.kind === 'text') {
try {
const inp = document.getElementById('applock-txt');
if (inp) setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
} catch (e) {}
}
syncPad();
}
function box() { const m = maskEl(); return m.firstElementChild; }
function shake() {
const b = box();
if (!b) return;
b.classList.remove('applock-shake');
void b.offsetWidth;
b.classList.add('applock-shake');
}
function showErr(msg) {
const e = box() ? box().querySelector('#applock-err') : null;
if (e) e.textContent = msg || '';
if (msg) shake();
}
function syncPad() {
if (!cur || cur.kind !== 'pad') return;
const b = box();
if (!b) return;
const dots = b.querySelector('#applock-dots');
if (dots) Array.prototype.forEach.call(dots.children, function (d, i) {
d.className = i < buf.length ? 'on' : '';
});
const ok = b.querySelector('#applock-ok');
if (ok) ok.disabled = buf.length < (cur.min || 1);
}
function padAdd(d) {
showErr('');
if (buf.length >= cur.max) return;
buf += d;
syncPad();
if (buf.length >= cur.max) padTry();
}
function padTry() {
if (!cur || cur.kind !== 'pad') return;
if (buf.length < (cur.min || 1)) return;
const pin = buf;
if (cur.check && !cur.check(pin)) return; // check 失败时内部已提示+清空
const cb = cur.onOk;
cur = null; buf = '';
const m = maskEl(); m.hidden = true;
if (cb) cb(pin);
}
function close(cb) {
const oc = cur ? (cur.onCancel || null) : null;
cur = null; buf = '';
maskEl().hidden = true;
if (cb) cb(); else if (oc) oc();
}
function padOpen(o) {
cur = Object.assign({}, o);
if (o.kind !== 'text' && o.kind !== 'info') { cur.kind = 'pad'; if (!cur.max) cur.max = 6; if (cur.min == null) cur.min = 1; }
buf = '';
render();
maskEl().hidden = false;
}
function onMaskClick(e) {
const t = e.target;
if (!t || !t.closest) return;
const key = t.closest('.applock-key');
if (key) {
const k = key.getAttribute('data-k');
if (k === 'C') { buf = ''; syncPad(); return; }
if (k === 'b') { buf = buf.slice(0, -1); syncPad(); return; }
if (/^\d$/.test(k)) { padAdd(k); return; }
return;
}
if (t.closest('#applock-ok')) { padTry(); return; }
if (t.closest('[data-ok]')) {
if (!cur || cur.kind !== 'info') return;
const oc = cur.onPrimary;
cur = null; buf = '';
maskEl().hidden = true;
if (oc) oc();
return;
}
if (t.closest('[data-submit]')) {
if (!cur || cur.kind !== 'text') return;
const inp = document.getElementById('applock-txt');
const v = inp ? String(inp.value || '').trim() : '';
if (cur.onSubmit) cur.onSubmit(v);
return;
}
if (t.closest('[data-link]')) {
const act = t.closest('[data-link]').getAttribute('data-link');
if (!cur) return;
if (act === 'cancel') { const oc = cur.onCancel || null; cur = null; buf = ''; maskEl().hidden = true; if (oc) oc(); return; }
if (cur.onLink) { cur.onLink(act); return; }
}
}
function pinOk(pin) { return pinHash() !== '' && pinHash() === h53(pin); }
function flowNewPin(cfg) {
padOpen({
title: cfg.t1, sub: cfg.s1, min: 4, max: 6, confirm: '确定', ico: ICON_LOCK,
cancelLabel: '取消',
links: [{ act: 'cancel', label: '取消' }],
check: function (pin) {
if (!/^\d{4,6}$/.test(pin)) { showErr('密码需为 4-6 位数字'); buf = ''; syncPad(); return false; }
return true;
},
onOk: function (pin) {
padOpen({
title: cfg.t2, sub: cfg.s2, min: 4, max: 6, confirm: '确定', ico: ICON_LOCK,
links: [{ act: 'cancel', label: '取消' }],
check: function (p2) {
if (p2 !== pin) { showErr('两次输入不一致，请重输'); buf = ''; syncPad(); return false; }
return true;
},
onOk: function () { if (cfg.done) cfg.done(pin); },
onCancel: function () { if (cfg.cancel) cfg.cancel(); else close(); }
});
},
onCancel: function () { if (cfg.cancel) cfg.cancel(); else close(); }
});
}
function textAsk(o) {
padOpen(Object.assign({ kind: 'text' }, o));
}
function askQa(ok, cancel) {
const qa = qaGet();
if (!qa) { if (cancel) cancel(); return; }
textAsk({
title: '安全问题', sub: qa.q, placeholder: '输入答案（原样输入，区分大小写）',
maxlen: 60, cancelLabel: '取消',
onSubmit: function (v) {
if (!v) { showErr('请输入答案'); return; }
if (qa.h === h53(v)) { if (ok) ok(); }
else { const inp = document.getElementById('applock-txt'); if (inp) inp.value = ''; showErr('答案不正确，请重试'); }
},
onCancel: function () { if (cancel) cancel(); }
});
}
function askQaSetup(done) {
textAsk({
title: '设置安全问题', sub: '忘记密码时，回答正确即可重设。请输入一个问题：',
placeholder: '例如：我们第一次见面的城市？', maxlen: 40, okLabel: '下一步',
onSubmit: function (q) {
if (!q) { showErr('问题不能为空'); return; }
textAsk({
title: '设置答案', sub: '请牢记答案（原样输入，区分大小写），忘记密码时回答它即可重设：',
placeholder: '安全问题的答案', maxlen: 60, okLabel: '完成',
onSubmit: function (a) {
if (!a) { showErr('答案不能为空'); return; }
if (done) done(q, a);
cur = null; buf = '';
maskEl().hidden = true;
},
onCancel: function () { if (cur) close(); }
});
},
onCancel: function () { if (cur) close(); }
});
}
function showLock() {
padOpen({
title: '应用锁已开启', sub: '输入密码解锁本站',
min: 1, max: 6, confirm: '解锁', ico: ICON_LOCK,
links: [{ act: 'forget', label: '忘记密码？' }],
check: function (pin) {
if (pinOk(pin)) return true;
showErr('密码不正确'); buf = ''; syncPad();
return false;
},
onOk: function () { sessMark(); maskEl().hidden = true; },
onLink: function (act) {
if (act === 'forget') lockForget();
}
});
}
function ownerDisableByCode(after, onBack) {
textAsk({
title: '输暗号关闭应用锁', sub: '本机未设安全问题，无法用问答重置。机主可输入暗号直接关闭应用锁。暗号一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），生日就在开屏第一页的章节目录里（点开第一页顶部的「目录」，逐章翻一下就能找到）；不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间：',
placeholder: '暗号', maxlen: 12, okLabel: '关闭应用锁', cancelLabel: '返回',
onSubmit: function (v) {
if (String(v || '').trim() === QA_SKIP_CODE) { setEn(false); sessMark(); toast('应用锁已关闭'); maskEl().hidden = true; if (after) after(); }
else { const inp = document.getElementById('applock-txt'); if (inp) inp.value = ''; showErr('暗号不对'); }
},
onCancel: onBack
});
}
function lockForget() {
const qa = qaGet();
if (!qa) {
padOpen({
kind: 'info', title: '无法重置', ico: ICON_SHIELD, okLabel: '返回锁屏',
secondary: { act: 'owner-escape', label: '输暗号关闭应用锁' },
onPrimary: showLock,
onLink: function (act) { if (act === 'owner-escape') ownerDisableByCode(null, showLock); },
sub: '设置密码时未设置安全问题，无法通过问答找回。机主可输暗号直接关闭应用锁（关闭即解锁进入）；否则只能清除本站数据后重来（聊天记录会丢失，建议先在有数据的设备上导出备份）。'
});
return;
}
maskEl().hidden = true;   // 问答文本屏本身也是 mask 屏，无需先隐藏
askQa(function () {
flowNewPin({
t1: '重设密码', s1: '设置 4-6 位新数字密码', t2: '再输入一次确认', s2: '请再输入一次新密码',
done: function (pin) {
savePin(pin); sessMark();
toast('已重设密码并解锁');
maskEl().hidden = true;
},
cancel: function () { showLock(); }
});
}, function () { showLock(); });
}
function padVerify(opts) {
const links = [{ act: 'cancel', label: '取消' }];
if (opts.forget) links.push({ act: 'forget', label: '忘记密码？' });
padOpen({
title: opts.title || '验证密码', sub: opts.sub || '请输入当前密码',
min: 1, max: 6, confirm: '确定', ico: ICON_LOCK,
links: links,
check: function (pin) {
if (pinOk(pin)) return true;
showErr('密码不正确'); buf = ''; syncPad();
return false;
},
onOk: function (pin) {
maskEl().hidden = true;
if (opts.onOk) opts.onOk(pin);
},
onCancel: function () { if (opts.onCancel) opts.onCancel(); else close(); },
onLink: function (act) {
if (act === 'cancel') { const oc = opts.onCancel || null; maskEl().hidden = true; cur = null; buf = ''; if (oc) oc(); return; }
if (act === 'forget') verifyForget(opts);
}
});
}
function verifyForget(opts) {
const qa = qaGet();
if (!qa) {
padOpen({
kind: 'info', title: '无法用问答重置', ico: ICON_SHIELD, okLabel: '返回',
secondary: { act: 'owner-escape', label: '输暗号关闭应用锁' },
onPrimary: function () { padVerify(opts); },
onLink: function (act) { if (act === 'owner-escape') ownerDisableByCode(function () { syncUi(); syncQaUi(); }, function () { padVerify(opts); }); },
sub: '设置密码时未设置安全问题。机主可输暗号直接关闭应用锁；否则忘记密码只能清除本站数据后重来（聊天记录会丢失）。'
});
return;
}
askQa(function () {
flowNewPin({
t1: '重设密码', s1: '设置 4-6 位新数字密码', t2: '再输入一次确认', s2: '请再输入一次新密码',
done: function (pin) {
savePin(pin); sessMark();
if (opts.onForgetDone) { opts.onForgetDone(); }
else { maskEl().hidden = true; toast('密码已重设'); }
if (opts.afterReset) opts.afterReset();
},
cancel: function () { padVerify(opts); }
});
}, function () { padVerify(opts); });
}
function qaStart(afterAll) {
const items = qaList();
qaAsk(items, 0, afterAll);
}
function qaAsk(items, i, afterAll) {
if (i >= items.length) { if (afterAll) afterAll(); return; }
const it = items[i];
textAsk({
title: '开屏问答 ' + (i + 1) + '/' + items.length,
sub: it.q,
placeholder: '输入答案', okLabel: (i + 1 >= items.length ? '进入' : '下一题'), cancel: false,
links: [{ act: 'skipqa', label: '输暗号跳过问答（本机永久）' }],
onSubmit: function (v) {
if (qaAnswerOk(v, it.h)) { qaAsk(items, i + 1, afterAll); }
else {
const inp = document.getElementById('applock-txt'); if (inp) inp.value = '';
showErr('答案不对，再想想～');
}
},
onLink: function (act) { if (act === 'skipqa') qaSkipAsk(items, i, afterAll); }
});
}
function qaSkipAsk(items, i, afterAll) {
textAsk({
title: '跳过开屏问答', sub: '暗号一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数）。mochi 字卡的生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）——不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间（那只是用来判断有没有更新到新版本）。输入暗号后，这台设备以后每次打开都不再问答（不再显示问答层）。警告：一旦有人把密码二传（告诉别人），发现后密码就会被重新设置，请不要外传。不输入暗号也不影响正常使用。这个暗号与开屏公告区「防未成年人·内置字卡锁定」卡的二级验证密码是同一个（同一串 6 位数字）：在那张卡点「输入密码解锁」用的也是它。',
placeholder: '输暗号', maxlen: 12, okLabel: '确定', cancelLabel: '返回',
onSubmit: function (v) {
if (String(v || '').trim() === QA_SKIP_CODE) {
qaSkipSet(true);
toast('已跳过：本机以后不再问答');
qaAsk(items, items.length, afterAll);   // 直接进下一层（密码锁 或 解锁完成）
} else {
const inp = document.getElementById('applock-txt'); if (inp) inp.value = '';
showErr('暗号不对');
}
},
onCancel: function () { qaAsk(items, i, afterAll); }
});
}
function evalLock() {
if (MASK && !MASK.hidden) return;   // 已锁屏中
if (enabled() && !pinHash()) { selfHealChecked(); return; }
const needPin = enabled() && !!pinHash();
const needQa = qaEnabled() && !qaSkipped();
if (!needPin && !needQa) return;
if (needQa) {
qaStart(function () {
pinHintThen(function () {
if (needPin && !sessOk()) showLock();
else { sessMark(); maskEl().hidden = true; }
});
});
return;
}
if (sessOk()) return;               // 数字密码锁：本会话已解过 → 同标签刷新不重锁
showLock();
}
function selfHealChecked() {
const key = G + ':' + K_PIN;
try {
if (window.idbGet) {
window.idbGet(key).then(function (v) {
if (v) { gSet(K_PIN, v); evalLock(); }   // IDB 有密码：回填本机后重新评估锁屏
else { setEn(false); }                     // 双端都无密码：真异常态，关锁防卡死
}).catch(function () { setEn(false); });
return;
}
} catch (e) {}
setEn(false);   // 无 idbGet 兜底，按原行为自愈关闭
}
function enEl() { return document.getElementById('applock-en'); }
function subEl() { return document.getElementById('applock-sub'); }
function qaEl() { return document.getElementById('applock-qa-en'); }
function qaSubEl() { return document.getElementById('applock-qa-sub'); }
function syncUi() {
const c = enEl();
const s = subEl();
if (!c || !s) return;
const on = enabled() && !!pinHash();
c.checked = on;
let html;
if (on) {
html = '<span>已开启：每次打开本站都需要输入密码，防止别人偷看聊天记录。</span>' +
actsHtml([{ act: 'modify', label: '修改密码' }, { act: 'qa', label: '修改安全问题' }]);
} else if (pinHash()) {
html = '<span>已设过密码（当前关闭），拨动开关即可重新开启。</span>' +
actsHtml([{ act: 'modify', label: '修改密码' }, { act: 'qa', label: '修改安全问题' }]);
} else {
html = '<span>未开启。开启后每次打开本站都要输入密码；可再设一个安全问题，忘记密码时用它重置。</span>';
}
s.innerHTML = html;
Array.prototype.forEach.call(s.querySelectorAll('[data-aa]'), function (b) {
b.addEventListener('click', function () {
const act = b.getAttribute('data-aa');
if (act === 'modify') flowModify();
else if (act === 'qa') flowQaEdit();
});
});
}
function actsHtml(acts) {
if (!acts || !acts.length) return '';
return '<span class="applock-acts">' + acts.map(function (a) {
return '<button type="button" data-aa="' + a.act + '">' + a.label + '</button>';
}).join('') + '</span>';
}
function flowModify() {
if (!pinHash()) { toast('请先开启应用锁'); return; }
padVerify({
title: '修改密码', sub: '先输入当前密码', forget: true,
onOk: function () {
flowNewPin({
t1: '设置新密码', s1: '设置 4-6 位新数字密码', t2: '再输入一次确认', s2: '请再输入一次新密码',
done: function (pin) { savePin(pin); toast('密码已更新'); syncUi(); },
cancel: function () { syncUi(); }
});
},
onForgetDone: function () { toast('密码已重设'); syncUi(); },
onCancel: function () { syncUi(); }
});
}
function flowQaEdit() {
if (!pinHash()) { toast('请先开启应用锁'); return; }
padVerify({
title: '修改安全问题', sub: '先输入当前密码', forget: true,
onOk: function () {
askQaSetup(function (q, a) {
saveQa(q, h53(a)); toast('安全问题已更新'); syncUi();
});
},
onForgetDone: function () { toast('密码已重设（如需再改安全问题请再次进入）'); syncUi(); },
onCancel: function () { syncUi(); }
});
}
function qaGuard(next, cancel) {
const onCancel = function () { if (cancel) cancel(); else { syncQaUi(); syncUi(); } };
if (pinHash()) {
padVerify({
title: '验证身份', sub: '先输入当前密码', forget: true,
onOk: function () { next(); },
onForgetDone: function () { toast('密码已重设'); next(); },
onCancel: onCancel
});
return;
}
textAsk({
title: '验证身份', sub: '本机未设数字密码，请输入开屏问答的暗号继续。暗号一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），生日就在开屏第一页的章节目录里（点开第一页顶部的「目录」，逐章翻一下就能找到）；不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间：',
placeholder: '暗号', maxlen: 12, okLabel: '确定', cancelLabel: '取消',
onSubmit: function (v) {
if (String(v || '').trim() === QA_SKIP_CODE) { next(); }
else {
const inp = document.getElementById('applock-txt'); if (inp) inp.value = '';
showErr('暗号不对');
}
},
onCancel: onCancel
});
}
function syncQaUi() {
const c = qaEl();
const s = qaSubEl();
if (!c || !s) return;
const on = qaEnabled();
c.checked = on;
const n = qaList().length;
let html;
if (on) {
const acts = qaSkipped() ? [{ act: 'qa-unskip', label: '恢复本机问答' }] : [];
html = '<span>已开启：每次打开本站需先答对 <b>' + n + '</b> 道固定问答题' +
(enabled() && !!pinHash() ? '，再输入数字密码' : '') + '。' +
(qaSkipped() ? '本机已输暗号跳过问答（当前不再询问）。' : '锁屏时点「输暗号」可让本机永久跳过问答层。') +
'</span>' + actsHtml(acts);
} else {
html = '<span>未开启。开启后每次打开本站需先答对固定问答题才放行；可不设上方数字密码锁单独使用。锁屏时可输暗号让本机永久跳过问答层。</span>';
}
s.innerHTML = html;
Array.prototype.forEach.call(s.querySelectorAll('[data-aa]'), function (b) {
b.addEventListener('click', function () {
const act = b.getAttribute('data-aa');
if (act === 'qa-unskip') { qaSkipSet(false); toast('已恢复：本机再次打开会询问问答'); syncQaUi(); }
});
});
}
function bindQaSettings() {
const c = qaEl();
const s = qaSubEl();
if (!c || !s) return;
syncQaUi();
c.addEventListener('change', function () {
const wantOn = c.checked;
c.disabled = true;
const done = function () { c.disabled = false; syncQaUi(); syncUi(); };
if (wantOn) {
qaSetEn(true);
done();
toast('开屏问答已开启');
} else {
qaGuard(function () {
qaSetEn(false);
done();
toast('开屏问答已关闭');
}, function () {
c.disabled = false;
c.checked = true;    // 验证未通过 → 保持开启
syncQaUi(); syncUi();
});
}
});
}
function bindSettings() {
const c = enEl();
const s = subEl();
if (!c || !s) return;
syncUi();
c.addEventListener('change', function () {
const wantOn = c.checked;
c.disabled = true;
const done = function () { c.disabled = false; syncUi(); syncQaUi(); };
if (wantOn) {
if (pinHash()) { setEn(true); done(); toast('应用锁已开启'); return; }
flowNewPin({
t1: '设置解锁密码', s1: '设置 4-6 位数字密码', t2: '再输入一次确认', s2: '请再输入一次',
done: function (pin) {
savePin(pin);
setEn(true);
done();
toast('应用锁已开启');
if (!qaGet()) {   // 顺手引导设置安全问题（可跳过，跳过即无问答重置途径）
setTimeout(function () {
askQaSetup(function (q, a) {
saveQa(q, h53(a)); toast('安全问题已记录'); syncUi();
});
}, 300);
}
},
cancel: done
});
} else {
padVerify({
title: '关闭应用锁', sub: '输入当前密码确认关闭（防止旁人随手关掉锁）',
forget: true,
onOk: function () { setEn(false); toast('应用锁已关闭'); done(); },
onForgetDone: function () { setEn(false); toast('已重设密码并关闭应用锁'); done(); },
onCancel: function () { done(); }
});
}
});
}
function fireLock() { try { evalLock(); } catch (e) {} }
function init() {
bindSettings();
bindQaSettings();
if (IS_AUTOMATION) { fireLock(); return; }
let tries = 0;
const waitSplash = function () {
if (!document.getElementById('splash')) { fireLock(); return; }
if (++tries > 60) { fireLock(); return; }   // 最多等 ~30s，开屏异常不隐藏时兜底
setTimeout(waitSplash, 500);
};
setTimeout(waitSplash, 400);   // 让开屏先完成首帧
document.addEventListener('mochi-restore-done', function () {
if (IS_AUTOMATION) { fireLock(); return; }
if (!document.getElementById('splash')) { fireLock(); }
});
}
if (document.body) init();
else document.addEventListener('DOMContentLoaded', init);
window.__applockReady = true;
window.__applockQaTest = {
getList: function () { return qaList(); }
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("applock.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("applock.js"); try { console.error("[JS] applock.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[applock.js] " + String(__e && __e.message || __e)); } })();