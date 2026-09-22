(function () { try {
(function () {
const el = document.getElementById('clock');
if (!el) return;
const pad = (n) => (n < 10 ? '0' + n : '' + n);
function update() {
const d = new Date();
el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
}
update();
setInterval(update, 15000); // 每 15 秒校准一次
})();
(function () {
const OFFICIAL_NOTICE = 'https://ling233330-star.github.io/mochi/notice.json';
const MARK_KEY = '小红书@言序（1842523578）';
const BARS = [
{ tag: '1', title: '免费 · 署名 · 防倒卖', keys: ['alert', 'alert2'],
marks: ['免费', '诈骗', '署名', '倒卖', MARK_KEY] }
];
const texts = {}; // notice 字段 -> 当前权威文案（先本地兜底，官方拉取后覆盖）
texts['alert'] = 'Mochi字卡网站完全免费，作者只有小红书这一个账号：小红书@言序（1842523578）。如有出现任何收费情况，均为诈骗，注意防止被骗。';
texts['alert2'] = '二传、分享本站链接必须标注作者署名：小红书 @言序（1842523578），禁止删除或修改。严禁冒为自己制作、删除篡改署名，或以任何形式收费倒卖本站链接、安装包——本站完全免费，收费即诈骗。如果你是花钱买来的链接：你被骗了，请拒付退款并举报卖家。';
function barText(bar) { return bar.keys.map(function (k) { return texts[k] || ''; }).filter(Boolean).join(' '); }
function marked(box, bar) {
const t = (box.textContent || '').replace(/\s+/g, '');
const title = bar.title.replace(/\s+/g, '');
return t.indexOf(title) > -1 && bar.marks.every(function (m) { return t.indexOf(m) > -1; });
}
function splashHost() {
return document.getElementById('splash-mustread') || document.getElementById('splash-notice');
}
function splashScope() {
return document.getElementById('splash-box') || document;
}
function ensureBar(bar, refNode) {
const host = splashHost();
if (!host) return null;
const scope = splashScope();
let box = scope.querySelector('.splash-alert[data-anti-scam="' + bar.tag + '"]');
if (!box) {
const heads = scope.querySelectorAll('.splash-alert .splash-alert-t');
for (let i = 0; i < heads.length; i++) {
if (heads[i].textContent.trim() === bar.title) { box = heads[i].parentNode; break; }
}
}
if (!box) {
box = document.createElement('div');
box.className = 'splash-alert';
host.insertBefore(box, refNode || host.firstChild);
}
box.setAttribute('data-anti-scam', bar.tag);
if (!marked(box, bar)) { // 缺失或被改 → 重建/改写回官方文案
box.innerHTML = '<div class="splash-alert-t"></div><p></p>';
box.querySelector('.splash-alert-t').textContent = bar.title;
box.querySelector('p').textContent = barText(bar);
}
return box;
}
function ensureSettings() {
const page = document.getElementById('page-setting');
if (!page) return;
let box = page.querySelector('.set-alert');
const st = box ? (box.textContent || '') : '';
if (box && MARK_KEY && st.indexOf(MARK_KEY) > -1 && st.indexOf('免费') > -1 && st.indexOf('倒卖') > -1) return;
if (!box) {
box = document.createElement('div');
const anchor = page.querySelector('.ver-credit') || null;
page.insertBefore(box, anchor ? anchor.nextSibling : null);
}
box.className = 'set-alert';
box.setAttribute('data-anti-scam', 's');
box.innerHTML = '<b></b>';
box.querySelector('b').textContent = texts['alert'];
box.appendChild(document.createTextNode(' ' + texts['alert2']));
}
let bulletin = null;
function ensureBulletin() {
const host = splashHost(); // #976：与置顶声明卡同一宿主（必读卡组，回退公告卡）
if (!host) return;
const scope = splashScope();
let box = scope.querySelector('.splash-alert[data-anti-scam="3"]');
const active = !!(bulletin && typeof bulletin.text === 'string' && bulletin.text.trim()
&& (!bulletin.until || Date.now() < bulletin.until));
if (!active) { if (box) box.remove(); return; }
const want = bulletin.text.trim();
if (!box) {
box = document.createElement('div');
box.className = 'splash-alert';
const b1 = scope.querySelector('.splash-alert[data-anti-scam="1"]');
host.insertBefore(box, b1 ? b1.nextSibling : host.firstChild);
}
box.setAttribute('data-anti-scam', '3');
if (box.textContent !== '公告' + want) { // 内容变化 → 重写（标题固定「公告」）
box.innerHTML = '<div class="splash-alert-t"></div><p></p>';
box.querySelector('.splash-alert-t').textContent = '公告';
box.querySelector('p').textContent = want;
}
}
function run() {
ensureBar(BARS[0], null);
ensureSettings();
ensureBulletin();
setupCardLockCard();
}
function setupCardLockCard() {
const card = document.getElementById('splash-cardlock');
if (!card || !window.cardLockOpen) return;
const tip = document.getElementById('splash-cardlock-tip');
const actions = document.getElementById('splash-cardlock-actions');
if (!actions) return;
const open = window.cardLockOpen();
if (tip) tip.textContent = open
? '系统内置字卡已解锁（成年人验证已通过）。如需恢复未成年人保护，可重新上锁。'
: '系统内置字卡已全部锁定，这是面向未成年人的保护措施，不是 bug。锁定影响：默认聊天字卡、词典（含词典拼字）、其他系统预设互动字卡全部停用；你自建的字卡与情绪 / 心意 / 意图字卡不受影响。豁免说明（#499）：聊天情绪字卡、TA 的心情、聊天回应字卡这三大互动链不受锁定影响，未解锁也照常触发与抽取。所以若发现「某功能开关都开了却没效果」，先看是不是锁定中。不输密码也能正常使用全部功能，密码只管两件事：解锁系统内置字卡、跳过开屏的 2 个问答。注意：锁定时若自定义字卡（含 mj 字卡）一张都没添加，回复会更单薄（情绪/回应字卡仍在，但少了系统预设内容），自己在自定义字卡里添加几张即可。密码一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）——不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间（那只是用来判断有没有更新到新版本）。这个密码与开屏问答页的「暗号」是同一个。解开密码请勿二传（不要告诉别人），一旦有人二传，密码就会被重新设置。';
actions.innerHTML = '';
const state = document.createElement('div');
state.className = 'cardlock-state';
if (open) {
const relock = document.createElement('button');
relock.className = 'cardlock-btn cardlock-btn-ghost';
relock.type = 'button';
relock.textContent = '重新上锁';
relock.addEventListener('click', function () {
window.cardLockRelock();
state.textContent = '已重新上锁，页面即将刷新…';
const goReloadAfterPersist = function () { setTimeout(function () { location.reload(); }, 300); };
if (window.cardLockConfirmPersisted) window.cardLockConfirmPersisted('locked', goReloadAfterPersist);
else setTimeout(function () { location.reload(); }, 900);
});
actions.appendChild(relock);
} else {
const unlock = document.createElement('button');
unlock.className = 'cardlock-btn';
unlock.type = 'button';
unlock.textContent = '输入密码解锁';
unlock.addEventListener('click', function () {
promptCardUnlock(state);
});
actions.appendChild(unlock);
}
actions.appendChild(state);
}
function promptCardUnlock(okState) {
if (!window.openModal || !window.cardLockTryUnlock) return;
const splash = document.getElementById('splash');
const mask = document.getElementById('modal-mask');
const splashVisible = splash && !splash.classList.contains('hide');
if (splashVisible) splash.classList.add('under-modal');
let mo = null;
if (splashVisible && mask && 'MutationObserver' in window) {
mo = new MutationObserver(function () { if (mask.hidden) { splash.classList.remove('under-modal'); } });
mo.observe(mask, { attributes: true, attributeFilter: ['hidden'] });
}
const ctl = window.openModal('二级验证 · 输入解锁密码', '', function (v) {
const r = window.cardLockTryUnlock(String(v == null ? '' : v).trim());
if (!r.ok) { ctl.hint(r.msg || '密码不对'); ctl.stay(); return; }
if (okState) okState.textContent = '验证通过，页面即将刷新…';
if (mo) { try { mo.disconnect(); } catch (e) {} }
let persisted = false, noticeClosed = false, reloaded = false, moNotice = null;
const tryReload = function () {
if (reloaded || !persisted || !noticeClosed) return;
reloaded = true;
if (moNotice) { try { moNotice.disconnect(); } catch (e) {} }
setTimeout(function () { location.reload(); }, 300);
};
const goReloadAfterPersist = function () { persisted = true; tryReload(); };
if (window.cardLockConfirmPersisted) window.cardLockConfirmPersisted('open', goReloadAfterPersist);
else persisted = true;
if (mask && 'MutationObserver' in window) {
moNotice = new MutationObserver(function () { if (mask.hidden) { noticeClosed = true; tryReload(); } });
moNotice.observe(mask, { attributes: true, attributeFilter: ['hidden'] });
}
setTimeout(function () { noticeClosed = true; tryReload(); }, 15000);
const sizeTip = window.mochiPresetSizeTip;
if (sizeTip && window.openModal) {
const ctl2 = window.openModal('解锁成功 · 字卡使用提醒', '', function () {
noticeClosed = true; tryReload();
}, { noInput: true, big: true, warn: true, lock: true, staticText: '系统内置字卡已解锁，聊天与各功能可以正常取用。\n\n' + sizeTip });
if (ctl2 && ctl2.okText) ctl2.okText('知道了');
} else {
noticeClosed = true;
tryReload();
if (!window.cardLockConfirmPersisted) setTimeout(function () { location.reload(); }, 900);
}
}, { inputmode: 'numeric', placeholder: '输入二级验证密码', staticText: '密码一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），生日就在开屏第一页的章节目录里（点开顶部的「目录」逐章翻一下就能找到）——不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间（那只是用来判断有没有更新到新版本）。解开密码请勿二传（不要告诉别人），一旦有人二传，密码就会被重新设置。这个密码与开屏问答页的「暗号」是同一个（同一串 6 位数字）：在开屏问答页点「输暗号跳过问答」用的也是它。' });
}
const CARD_LOCK_REMIND = '系统字卡未解锁，请自行添加字卡使用。联系人无法使用字卡，不是bug，是系统字卡锁了。\n其实从内测开始就说明过需要自行添加字卡使用，系统内置字卡只是附带功能。\n\n系统内置字卡已全部锁定，这是面向未成年人的保护措施，不是 bug。锁定影响：默认聊天字卡、词典（含词典拼字）、其他系统预设互动字卡全部停用；你自建的字卡与情绪 / 心意 / 意图字卡不受影响。豁免说明（#499）：聊天情绪字卡、TA 的心情、聊天回应字卡这三大互动链不受锁定影响，未解锁也照常触发与抽取。所以若发现「某功能开关都开了却没效果」，先看是不是锁定中。不输密码也能正常使用全部功能，密码只管两件事：解锁系统内置字卡、跳过开屏的 2 个问答。注意：锁定时若自定义字卡（含 mj 字卡）一张都没添加，回复会更单薄（情绪/回应字卡仍在，但少了系统预设内容），自己在自定义字卡里添加几张即可。密码一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），要回开屏第一页的章节里找（第一页顶部有「目录」，点开逐章翻一下就能找到）——不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间（那只是用来判断有没有更新到新版本）。这个密码与开屏问答页的「暗号」是同一个。解开密码请勿二传（不要告诉别人），一旦有人二传，密码就会被重新设置。';
let cardRemindShown = false;
function trustedCustomCount() {
let n = 0;
try { n = (window.cardLockCustomCount ? window.cardLockCustomCount() : 0); } catch (e) { n = 0; }
if (n > 0) return n;
if (window.__mochiDataReady) return n; // 已就绪且数到 0 → 可信（确实没加自定义字卡）
return -1;                             // 未就绪且暂数不到 → 本加载稍后由 restore-done 再判
}
function maybeCardLockReminder() {
if (cardRemindShown) return;
if (!window.cardLockOpen || window.cardLockOpen()) return; // 未锁定 / 已解锁：不弹
if (!window.openModal) return;
const splash = document.getElementById('splash');
if (splash && !splash.classList.contains('hide')) return; // 开屏尚未进入：不弹（开屏有解锁卡）
const n = trustedCustomCount();
if (n < 0) return;    // 数据未就绪：等 restore-done 触发的下一次判定
if (n >= 500) return; // 自定义字卡已 ≥500：不缺卡，不弹
cardRemindShown = true;   // 本加载只弹一次
setTimeout(function () {
const ctl = window.openModal('系统字卡未解锁', '', function (v) {
if (v === 'unlock') promptCardUnlock(); // 就地解锁；其余（点「知道了」）直接关闭
}, { noInput: true, big: true, staticText: CARD_LOCK_REMIND, pillSubmit: true, pills: [{ label: '输入密码解锁', value: 'unlock' }] });
if (ctl && ctl.okText) ctl.okText('知道了');
}, 600);
}
document.addEventListener('mochi-restore-done', maybeCardLockReminder);
window.__cardLockTest = {
fire: function () { cardRemindShown = false; maybeCardLockReminder(); }
};
window.maybeCardLockReminder = maybeCardLockReminder;
document.addEventListener('mochi-cardlock-open', setupCardLockCard);
document.addEventListener('mochi-cardlock-locked', setupCardLockCard);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
else run();
fetch(OFFICIAL_NOTICE, { cache: 'no-store' })
.then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
.then(function (d) {
let dirty = false;
['alert', 'alert2'].forEach(function (k) {
if (d && typeof d[k] === 'string' && d[k].trim() && d[k].trim() !== texts[k]) {
texts[k] = d[k].trim();
dirty = true;
}
});
if (d && typeof d.bulletin === 'object' && d.bulletin) {
const nb = { text: String(d.bulletin.text || ''), until: Number(d.bulletin.until) || 0 };
if (nb.text && (!bulletin || bulletin.text !== nb.text || bulletin.until !== nb.until)) {
bulletin = nb;
dirty = true;
} else if (!nb.text && bulletin) {
bulletin = null;
dirty = true;
}
}
if (dirty) run(); // 强刷回写
})
.catch(function () { /* 保留本地兜底 */ });
})();
(function () {
const splash = document.getElementById('splash');
if (!splash) return;
const verEl = document.getElementById('splash-ver');
const verLiveEl = document.getElementById('splash-ver-live');
let _verIv = null;
if (verEl && verLiveEl) {
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const fill = () => {
const d = new Date();
verLiveEl.textContent = ' · ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
};
fill();
_verIv = setInterval(fill, 1000);
}
const hide = () => {
if (_verIv) { clearInterval(_verIv); _verIv = null; }
if (splash.classList.contains('hide')) return;
splash.classList.add('hide');
setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 400);
};
const ready = () => !!(window.__mochiDataReady);
const today = (function () {
const d = new Date(), p = (n) => (n < 10 ? '0' + n : '' + n);
return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
})();
const seenKey = 'xy-home-v2:splash-seen:' + today;
let seenToday = false;
try { seenToday = localStorage.getItem(seenKey) === '1'; } catch (e) {}
window.__splashForceExpand = !seenToday;
const enterEl = document.getElementById('splash-enter');
const loadingEl = document.getElementById('splash-loading');
const loadingSubEl = document.getElementById('splash-loading-sub');
const hintEl = document.getElementById('splash-enter-hint');
const AGE_KEY = 'xy-home-v2:age-confirmed';
let ageOk = false;
try { ageOk = localStorage.getItem(AGE_KEY) === '1'; } catch (e) {}
const ageRow = document.getElementById('splash-age-row');
const ageCheck = document.getElementById('splash-age-check');
if (ageRow && ageCheck) {
ageCheck.checked = ageOk; // 已确认过的老用户自动勾上，不重复打断
ageRow.hidden = false;
ageCheck.addEventListener('change', function () {
ageOk = !!ageCheck.checked;
try { if (ageOk) localStorage.setItem(AGE_KEY, '1'); } catch (e) {}
updateEnterState();
});
}
const forceEnterEl = document.getElementById('splash-force-enter');
let slow = false;
try { if (window.__mochiDataSlow) slow = true; } catch (e) {} // 事件先于监听派发时兜底
let windowLoaded = false;
const loaded = () => windowLoaded || (typeof document !== 'undefined' && document.readyState === 'complete');
const splashBox = document.getElementById('splash-box');
const mandEl = document.getElementById('splash-mandatory');
const mandScroll = document.getElementById('splash-mandatory-scroll');
const mandEnter = document.getElementById('splash-mandatory-enter');
const mandHint = document.getElementById('splash-mandatory-hint');
let mandBottom = false;
function updateMandState() {
if (mandHint) mandHint.hidden = !!mandBottom;
if (mandEnter) mandEnter.classList.toggle('is-disabled', !mandBottom);
}
function checkMandScrolled() {
if (!mandScroll) return;
const b = mandScroll.scrollHeight - mandScroll.scrollTop - mandScroll.clientHeight <= 8;
if (b !== mandBottom) { mandBottom = b; updateMandState(); }
}
function showMandatory() {
if (splash.classList.contains('hide')) return;
if (!mandEl) { finishEnter(); return; } // 锚点缺失兜底：不卡死进入入口
mandEl.hidden = false;
if (mandScroll) mandScroll.scrollTop = 0;
mandBottom = false;
updateMandState();
checkMandScrolled();
}
function showDataPendingBanner() {
if (document.getElementById('mochi-data-banner')) return;
const bar = document.createElement('div');
bar.id = 'mochi-data-banner';
bar.className = 'ver-update-bar';
bar.innerHTML =
'<span class="vub-txt">数据仍在后台加载，部分内容暂时看不到…</span>' +
'<span class="vub-act vub-close" id="mochi-data-banner-close" style="background:transparent;color:#ccc;border:1px solid rgba(255,255,255,.3)">隐藏</span>';
document.body.appendChild(bar);
let gone = false;
let fuse = 0;
const off = function () {
if (gone) return;
gone = true;
document.removeEventListener('mochi-restore-done', off);
clearTimeout(fuse);
if (bar.parentNode) bar.parentNode.removeChild(bar);
};
fuse = setTimeout(off, 120000);
document.addEventListener('mochi-restore-done', off);
const closeBtn = document.getElementById('mochi-data-banner-close');
if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); off(); });
}
function finishEnter() {
if (splash.classList.contains('hide')) return;
if (!seenToday) {
try { localStorage.setItem(seenKey, '1'); seenToday = true; } catch (e) {}
}
hide();
if (!ready()) {
try { showDataPendingBanner(); } catch (e) {}
try {
if (window.openModal) {
window.openModal('数据仍在加载', '数据较多仍在后台加载，部分内容（字卡 / 图片 / 聊天记录等）可能暂时看不见，建议稍后刷新页面。', null);
}
} catch (e) {}
return;
}
try {
const dgb = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
if (dgb > 4 && window.hydrateLibScopes) {
setTimeout(function () {
try { window.hydrateLibScopes(['own']).catch(function () {}); } catch (e) {}
}, 1500);
}
} catch (e) {}
try { if (window.maybeCardLockReminder) window.maybeCardLockReminder(); } catch (e) {}
try { if (window.mochiContactEntryFlow) window.mochiContactEntryFlow(); } catch (e) {}
}
let scrolledBottom = false;
function checkScrolled() {
let bottom = true;
if (splashBox) {
bottom = splashBox.scrollHeight - splashBox.scrollTop - splashBox.clientHeight <= 8;
}
if (bottom !== scrolledBottom) { scrolledBottom = bottom; updateEnterState(); }
}
let readyForced = false;
function updateEnterState() {
const r = ready() || readyForced;
const ok = r && scrolledBottom && ageOk; // #315c：年龄确认与滑到底并列为可点条件
if (loadingEl) {
loadingEl.hidden = r && loaded();
loadingEl.textContent = (!ready() && slow) ? '数据较多，仍在加载…' : (r ? '正在加载页面…' : '正在加载数据…');
}
if (loadingSubEl) {
const loadingShown = loadingEl ? !loadingEl.hidden : false;
loadingSubEl.hidden = !(loadingShown && ((!ready() && slow) || (r && !loaded())));
}
if (hintEl) hintEl.hidden = !r || !loaded() || ok;
if (enterEl) {
enterEl.hidden = !r || !loaded();
enterEl.classList.toggle('is-disabled', !ok); // div 上设 disabled 属性不落 DOM，用 class 控制置灰
}
if (forceEnterEl) forceEnterEl.hidden = ready() || readyForced || !slow || !loaded() || !ageOk;
}
const enter = () => {
if (splash.classList.contains('hide')) return;
if (!ready()) {
if (readyForced) { showMandatory(); }
return; // 数据未就绪且未硬放行：禁止进入（原有门控）
}
if (!scrolledBottom || !loaded() || !ageOk) return; // 未滑到底 / 页面未加载完 / 未确认年满18：禁止进入
if (!seenToday) {
try { localStorage.setItem(seenKey, '1'); seenToday = true; } catch (e) {}
}
showMandatory();
};
const forceEnter = () => {
if (splash.classList.contains('hide')) return;
if (!ageOk) return; // #315c：逃生口同样要求先勾选年龄确认
if (!seenToday) {
try { localStorage.setItem(seenKey, '1'); seenToday = true; } catch (e) {}
}
showMandatory();
};
updateEnterState();
if (splashBox) splashBox.addEventListener('scroll', checkScrolled, { passive: true });
if (enterEl) enterEl.addEventListener('click', (e) => { e.stopPropagation(); enter(); });
if (forceEnterEl) forceEnterEl.addEventListener('click', (e) => { e.stopPropagation(); forceEnter(); });
if (mandEnter) mandEnter.addEventListener('click', (e) => { e.stopPropagation(); if (mandBottom) finishEnter(); });
if (mandScroll) mandScroll.addEventListener('scroll', checkMandScrolled, { passive: true });
window.addEventListener('resize', checkMandScrolled);
window.addEventListener('load', function () { windowLoaded = true; updateEnterState(); });
setTimeout(function () { if (!windowLoaded) { windowLoaded = true; updateEnterState(); } }, 30000);
document.addEventListener('mochi-restore-done', updateEnterState);
document.addEventListener('mochi-restore-slow', function () { slow = true; updateEnterState(); });
document.addEventListener('mochi-notice-rendered', checkScrolled);
const readyPoll = setInterval(() => {
if (ready() && scrolledBottom) { clearInterval(readyPoll); return; }
updateEnterState();
checkScrolled();
}, 300);
setTimeout(() => {
if (!ready()) {
slow = true;
readyForced = true;
updateEnterState();
}
}, 20000);
})();
function renderSplashSections(container, sections, opt) {
if (!container || !Array.isArray(sections)) return;
const collapsible = !!(opt && opt.collapsible);
const forceExpand = !!(opt && opt.expandFirst) && !!window.__splashForceExpand;
sections.forEach(function (sec) {
const wrap = document.createElement('div');
wrap.className = 'splash-sec-wrap'
+ (collapsible ? ' splash-sec-collapsible' : '')
+ (collapsible && !forceExpand ? ' is-collapsed' : '');
let h = null;
if (sec && sec.h) {
h = document.createElement('p');
h.className = 'splash-sec';
h.textContent = String(sec.h);
wrap.appendChild(h);
}
if (sec && Array.isArray(sec.p)) {
const body = collapsible ? document.createElement('div') : null;
if (body) { body.className = 'splash-sec-content'; }
sec.p.forEach(function (it) {
const p = document.createElement('p');
if (it && typeof it === 'object') {
if (it.h !== undefined) { p.className = 'splash-sub'; p.textContent = String(it.h); }
else if (it.b !== undefined) { p.className = 'splash-bullet'; p.textContent = String(it.b); }
else if (it.hl !== undefined) { p.className = 'splash-item splash-hl'; p.textContent = String(it.hl); }
else { p.className = 'splash-item'; p.textContent = String(it.t !== undefined ? it.t : ''); }
} else {
p.className = 'splash-item';
p.textContent = String(it);
}
if (body) body.appendChild(p); else wrap.appendChild(p);
});
if (body) wrap.appendChild(body);
}
container.appendChild(wrap);
});
}
function buildSplashToc(list) {
if (!list) return;
if (list.querySelector('.splash-toc')) return; // 已注入则跳过（防重复）
const headers = list.querySelectorAll('.splash-sec-wrap .splash-sec');
if (!headers.length) return;
const toc = document.createElement('div');
toc.className = 'splash-toc';
const head = document.createElement('button');
head.type = 'button';
head.className = 'splash-toc-head';
head.setAttribute('aria-expanded', 'false');
const headText = document.createElement('span');
headText.className = 'splash-toc-head-text';
headText.textContent = '目录（' + headers.length + ' 章）';
const chevron = document.createElement('span');
chevron.className = 'splash-toc-chev';
chevron.textContent = '▾';
head.appendChild(headText);
head.appendChild(chevron);
head.addEventListener('click', function () {
toc.classList.toggle('open');
head.setAttribute('aria-expanded', String(toc.classList.contains('open')));
});
toc.appendChild(head);
const body = document.createElement('div');
body.className = 'splash-toc-body';
headers.forEach(function (h) {
const wrap = h.parentNode; // .splash-sec-wrap
let label = String(h.textContent).replace(/^【|】$/g, '').trim() || '章节';
if (label.length > 18) label = label.slice(0, 18) + '…';
const chip = document.createElement('button');
chip.type = 'button';
chip.className = 'splash-toc-chip';
chip.textContent = label;
chip.addEventListener('click', function (e) {
e.stopPropagation();
toc.classList.remove('open');
head.setAttribute('aria-expanded', 'false');
Array.prototype.forEach.call(body.children, function (c) { c.classList.remove('active'); });
chip.classList.add('active');
if (wrap.classList.contains('is-collapsed')) wrap.classList.remove('is-collapsed');
wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
body.appendChild(chip);
});
toc.appendChild(body);
list.insertBefore(toc, list.firstChild);
}
(function () {
const notice = document.getElementById('splash-notice');
if (!notice) return;
if (location.protocol === 'file:') return;
fetch('./notice.json?v=' + Date.now(), { cache: 'no-store' })
.then(function (r) { if (!r.ok) throw new Error('notice fetch ' + r.status); return r.json(); })
.then(function (data) {
if (!data || typeof data !== 'object') return;
const title = notice.querySelector('.splash-notice-title');
const sub = notice.querySelector('.splash-notice-sub');
const list = notice.querySelector('.splash-notice-list');
if (data.title !== undefined && title) title.textContent = String(data.title);
if (data.sub !== undefined && sub) sub.textContent = String(data.sub);
if (Array.isArray(data.sections)) {
if (!data.sections.length || data.hide) { notice.style.display = 'none'; return; }
if (list) {
list.innerHTML = '';
if (Array.isArray(data.summary) && data.summary.length) {
const sum = document.createElement('div');
sum.className = 'splash-summary';
const sumTitle = document.createElement('p');
sumTitle.className = 'splash-summary-title';
sumTitle.textContent = '必读摘要';
sum.appendChild(sumTitle);
data.summary.forEach(function (s) {
const p = document.createElement('p');
if (s && typeof s === 'object' && s.hl !== undefined) { p.className = 'splash-hl'; p.textContent = String(s.hl); }
else p.textContent = String(s);
sum.appendChild(p);
});
list.appendChild(sum);
}
renderSplashSections(list, data.sections, { collapsible: true, expandFirst: true });
buildSplashToc(list);
}
} else if (Array.isArray(data.list)) {
if (!data.list.length || data.hide) { notice.style.display = 'none'; return; }
if (list) {
list.innerHTML = '';
data.list.forEach(function (t) {
const p = document.createElement('p');
p.className = 'splash-item';
p.textContent = String(t);
list.appendChild(p);
});
}
} else if (data.hide) {
notice.style.display = 'none';
}
document.dispatchEvent(new Event('mochi-notice-rendered'));
})
.catch(function () { /* 失败：保留模板默认公告 */ });
})();
window.addEventListener('DOMContentLoaded', function () {
const nl = document.querySelector('.splash-notice-list');
if (!nl) return;
Array.prototype.forEach.call(nl.querySelectorAll('.splash-sec-wrap'), function (wrap) {
if (wrap.classList.contains('splash-sec-collapsible')) return; // 在线已处理
const head = wrap.querySelector(':scope > .splash-sec');
if (!head) return;
wrap.classList.add('splash-sec-collapsible');
if (!window.__splashForceExpand) wrap.classList.add('is-collapsed');
let content = wrap.querySelector(':scope > .splash-sec-content');
if (!content) {
content = document.createElement('div');
content.className = 'splash-sec-content';
wrap.appendChild(content);
}
while (head.nextSibling && !content.contains(head.nextSibling)) content.appendChild(head.nextSibling);
});
nl.addEventListener('click', function (e) {
var t = e.target;
while (t && t !== nl && !(t.classList && t.classList.contains('splash-sec'))) t = t.parentNode;
if (!t || t === nl || !t.parentNode) return;
const wrap = t.parentNode;
if (wrap.classList && wrap.classList.contains('splash-sec-collapsible')) {
wrap.classList.toggle('is-collapsed');
}
});
buildSplashToc(nl);
document.dispatchEvent(new Event('mochi-notice-rendered'));
});
if (window.__mochiLoaded) window.__mochiLoaded.push("clock.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("clock.js"); try { console.error("[JS] clock.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[clock.js] " + String(__e && __e.message || __e)); } })();