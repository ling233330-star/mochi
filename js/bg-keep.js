(function () { try {
(function () {
const uid = window.activePrefix();
const store = window.activeStore();
const GNS = 'xy-home-v2';
function gGet(k) {
try { const v = window.xyStore ? window.xyStore(GNS).get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
try { return store.get(k); } catch (e) { return null; }
}
function gSet(k, v) {
try { if (window.xyStore) window.xyStore(GNS).set(k, v); } catch (e) {}
}
function toast(msg, dur) {
let t = document.getElementById('cc-toast');
if (!t) {
t = document.createElement('div');
t.id = 'cc-toast';
document.body.appendChild(t);
}
t.textContent = msg;
t.style.animationDuration = (dur || 2600) + 'ms';
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, (dur || 2600) + 250);
}
let kaCustomAudio = null;
let kaCustomAudioName = '';
function kaCustomOn() { try { return gGet('__ka-audio-on') === '1'; } catch (e) { return false; } }
function kaAudioLabel() { return (kaCustomAudio || kaCustomOn()) ? '自定义音频' : '默认静音音频'; }
function kaApplyCustomAudio() {
if (!kaCustomAudio || !keepAudio || !keepAudio.el) return;
try {
if (keepAudio.el.src !== kaCustomAudio) {
keepAudio.el.src = kaCustomAudio;
if (!musicNowPlaying()) {
const p = keepAudio.el.play();
if (p && p.catch) p.catch(function () {});
}
}
} catch (e) {}
}
function kaLoadCustomAudio() {
if (!kaCustomOn() || kaCustomAudio) return;
try {
if (!window.idbGet) return;
window.idbGet(GNS + ':__ka-audio').then(function (v) {
if (v && typeof v === 'string' && v.length > 10) {
kaCustomAudio = v;
try { kaCustomAudioName = gGet('__ka-audio-name') || ''; } catch (e) {}
kaApplyCustomAudio();
syncKaAudioUI();
}
}).catch(function () {});
} catch (e) {}
}
function kaSetDefaultAudio() {
kaCustomAudio = null;
kaCustomAudioName = '';
try {
window.xyStore(GNS).remove('__ka-audio');
window.xyStore(GNS).remove('__ka-audio-on');
window.xyStore(GNS).remove('__ka-audio-name');
} catch (e) {}
if (keepEnabled && keepAudio && keepAudio.el) {
try {
keepAudio.el.src = ensureKeepAudioDataUrl();
keepAudio.el.volume = KA_VOL_BASE; // #724：与启动档同源（原硬编码 0.05）
if (!musicNowPlaying()) { const p = keepAudio.el.play(); if (p && p.catch) p.catch(function () {}); }
} catch (e) {}
}
syncKaAudioUI();
toast('已恢复默认静音音频');
}
function kaPickCustomAudio() {
window.mochiFilePick({
id: 'mochi-ka-audio-pick', accept: 'audio/*',
onFiles: function (files) {
const f = files && files[0];
if (!f) { toast('没有取到音频，请再选一次'); return; }
if (f.size > 3 * 1024 * 1024) toast('音频较大（>3MB），可能占用较多存储空间');
toast('正在读取音频…');
const r = new FileReader();
r.onload = function () {
kaCustomAudio = String(r.result || '');
kaCustomAudioName = f.name || '自定义音频';
try {
window.xyStore(GNS).set('__ka-audio', kaCustomAudio);
window.xyStore(GNS).set('__ka-audio-on', '1');
window.xyStore(GNS).set('__ka-audio-name', kaCustomAudioName);
} catch (e) {}
if (keepEnabled && keepAudio && keepAudio.el) {
try { keepAudio.el.volume = 1; } catch (e) {}
kaApplyCustomAudio();
}
syncKaAudioUI();
toast('已设为自定义保活音频（按原音量循环播放）');
};
r.onerror = function () { toast('音频读取失败'); };
r.readAsDataURL(f);
}
});
}
function openKaAudioPicker() {
if (!window.openModal) return;
const pills = [
{ label: '默认静音音频', value: 'default' },
{ label: '上传自定义音频', value: 'upload' }
];
if (kaCustomAudio || kaCustomOn()) pills.push({ label: '清除自定义', value: 'clear' });
const hasCustom = !!(kaCustomAudio || kaCustomOn());
const cur = kaAudioLabel() + (hasCustom && kaCustomAudioName ? '（' + kaCustomAudioName + '）' : '');
const txt = '后台保活需要在后台持续播放一段音频来让页面保持运行。\n\n· 默认静音音频：内置生成、近乎无声，推荐。\n· 自定义音频：上传自己的音频（白噪音 / 助眠声，或更彻底的静音文件），按原音量循环播放。\n\n注意：任何持续播放的音频都会占用手机音频通道，可能影响其他 App 的声音（详见「后台保活」功能说明）。\n当前：' + cur;
window.openModal('【保活音频】', '', function (v) {
if (v === 'default' || v === 'clear') kaSetDefaultAudio();
else if (v === 'upload') kaPickCustomAudio();
}, { noInput: true, pillSubmit: true, staticText: txt, pills: pills });
}
let keepAudio = null;
let keepInterval = null;
let keepEnabled = false;
let keepUserTouched = false; // v3.26.x #88：本会话用户手动动过保活开关 → 回填后不重读覆盖
let wakeSentinel = null; // v3.5.131：模块级，供 stopKeepAlive 释放
let kaTimer = null;     // 排中的退避补播定时器
let kaDelay = 0;        // 下一次补播间隔 ms；0=不在退避轨道
let kaPauseStreak = 0;  // 连续被打断次数（稳定播放一段时间后清零）
let kaLastPlayAt = 0;   // 最近一次 play() 被接受的时间（音频跑起来后刷新）
let kaPlayFailStreak = 0; // 连续 play() 被拒次数（补播一直失败时翻倍退避，不无限撞墙）
function kaCfg() {
let base = 5000, max = 60000;
try { if (typeof window.__kaRetryBaseMs === 'number') base = Math.max(1, window.__kaRetryBaseMs); } catch (e) {}
try { if (typeof window.__kaRetryMaxMs === 'number') max = Math.max(1, window.__kaRetryMaxMs); } catch (e) {}
return { base: base, max: Math.max(base, max) };
}
function kaStableMs() {
try { if (typeof window.__kaStableMs === 'number') return Math.max(1, window.__kaStableMs); } catch (e) {}
return 90000;
}
function kaSchedule(delayMs) {
if (!keepEnabled || kaTimer) return;
const cfg = kaCfg();
if (!delayMs) {
kaPauseStreak++;
delayMs = Math.min(cfg.base * Math.pow(2, Math.min(kaPauseStreak - 1, 10)), cfg.max);
}
if (document.visibilityState === 'hidden' && delayMs > 20000) delayMs = 20000;
kaDelay = delayMs;
window.__kaNextDelayMs = delayMs; // 回归探针
kaTimer = setTimeout(function () {
kaTimer = null;
if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) { kaDelay = 0; return; }
if (!keepAudio.el.paused) { kaDelay = 0; return; }
const p = keepAudio.el.play();
const after = function () {
if (keepEnabled && keepAudio && keepAudio.el && keepAudio.el.paused && !musicNowPlaying()) {
const c2 = kaCfg();
kaSchedule(Math.min((kaDelay || c2.base) * 2, c2.max));
}
};
if (p && p.then) p.then(after, after); else after();
}, kaDelay);
}
function kaStopTimer() { if (kaTimer) { clearTimeout(kaTimer); kaTimer = null; } kaDelay = 0; }
function kaResetBackoff() { kaStopTimer(); kaPauseStreak = 0; kaPlayFailStreak = 0; }
function kaMarkPlayed() { kaLastPlayAt = Date.now(); }
function musicNowPlaying() {
try { if (!window.__musicPlaying) return false; } catch (e) { return false; }
try {
const m = window.__mochiMusic;
if (m && m.el && m.el.paused === false) return true;
if (m && m.el && m.el.paused === true) return false;
} catch (e) {}
return true;
}
function syncKeepForMusic() {
if (!keepAudio || !keepAudio.el) return;
try {
if (musicNowPlaying()) {
if (!keepAudio.el.paused) keepAudio.el.pause(); // 让位：音乐在播，保活音频暂停
} else if (keepEnabled && keepAudio.el.paused) {
if (kaTimer || kaDelay) return;
try {
const m = window.__mochiMusic;
if (window.__musicPlaying && m && m.el && m.el.paused && m.want && m.want()) m.el.unpause();
} catch (e) {}
const p = keepAudio.el.play();
if (p && p.catch) p.catch(function () {});
setKeepMediaSession();
}
} catch (e) {}
}
(function installMusicPlayingWatcher() {
try {
let v = !!window.__musicPlaying;
Object.defineProperty(window, '__musicPlaying', {
configurable: true,
get: function () { return v; },
set: function (nv) {
nv = !!nv;
if (nv === v) return;
v = nv;
setTimeout(syncKeepForMusic, 0);
}
});
} catch (e) {}
})();
const KA_VOL_BASE = 0.2, KA_VOL_MAX = 0.35;
let KEEP_AUDIO_DATAURL = '';
function kaIsIOS() {
try { return !!(window.mochiDevice || {}).isIOS; } catch (e) {}
return false;
}
function kaYieldStealFocus() {
return kaIsIOS() && document.visibilityState === 'hidden';
}
function ensureKeepAudioDataUrl() {
if (KEEP_AUDIO_DATAURL) return KEEP_AUDIO_DATAURL;
try {
const sr = 44100, sec = 1, n = sr * sec;
const amp = kaIsIOS() ? 0.002 : 0.02;
const freq = 18000;
const buf = new ArrayBuffer(44 + n * 2);
const dv = new DataView(buf);
const ws = function (o, s) { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
ws(36, 'data'); dv.setUint32(40, n * 2, true);
for (let i = 0; i < n; i++) {
const v = Math.sin(2 * Math.PI * freq * (i / sr)) * amp;
dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
}
const bytes = new Uint8Array(buf);
let bin = '';
for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
KEEP_AUDIO_DATAURL = 'data:audio/wav;base64,' + btoa(bin);
} catch (e) { KEEP_AUDIO_DATAURL = ''; }
return KEEP_AUDIO_DATAURL;
}
function musicIntentPlaying() { try { return !!window.__musicWantPlay; } catch (e) { return false; } }
function setKeepMediaSession() {
try {
if (!('mediaSession' in navigator) || !navigator.mediaSession || !window.MediaMetadata) return;
if (window.__musicPlaying) return; // 音乐在播，保留音乐的媒体条
if (musicIntentPlaying()) return; // 音乐还想播（瞬断暂停中），不覆盖歌曲媒体条
navigator.mediaSession.metadata = new window.MediaMetadata({
title: 'Mochi 后台保活',
artist: 'mochi',
album: '后台消息提醒运行中'
});
try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
try {
navigator.mediaSession.setActionHandler('play', function () {});
navigator.mediaSession.setActionHandler('pause', function () {});
} catch (e) {}
} catch (e) {}
}
let kaPc1 = null, kaPc2 = null, kaWebrtcTimer = null;
let kaCand1 = [], kaCand2 = [];
let kaWebrtcBootTimer = null;   // 启动延迟建锚定时器
let kaWebrtcDiscTimer = null;   // disconnected 自愈观察窗定时器
let kaWebrtcRebuildDelay = 0;   // 下次重建间隔 ms（指数退避轨道）；0=不在轨道
let kaWebrtcOkAt = 0;           // 最近一次进入 connected 的时刻（稳定判定用）
function kaWebrtcDeferredStart(delayMs) {
if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
kaWebrtcBootTimer = setTimeout(function () {
kaWebrtcBootTimer = null;
if (!keepEnabled || kaPc1 || kaPc2) return;
if (document.hidden) return;
kaWebrtcStart();
}, delayMs);
}
function kaWebrtcScheduleRebuild() {
if (kaWebrtcOkAt && Date.now() - kaWebrtcOkAt > 300000) kaWebrtcRebuildDelay = 0;
kaWebrtcRebuildDelay = kaWebrtcRebuildDelay ? Math.min(kaWebrtcRebuildDelay * 2, 900000) : 30000;
if (keepEnabled && !kaWebrtcTimer) kaWebrtcTimer = setTimeout(function () {
kaWebrtcTimer = null;
if (!keepEnabled || document.hidden) return;
kaWebrtcStart();
}, kaWebrtcRebuildDelay);
}
function kaWebrtcStart() {
if (kaPc1 || kaPc2) return;
if (kaWebrtcTimer) { clearTimeout(kaWebrtcTimer); kaWebrtcTimer = null; }
if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
if (typeof RTCPeerConnection === 'undefined') return;
try {
const p1 = new RTCPeerConnection(), p2 = new RTCPeerConnection();
p1.onicecandidate = function (e) { if (e.candidate) kaCand1.push(e.candidate); };
p2.onicecandidate = function (e) { if (e.candidate) kaCand2.push(e.candidate); };
p1.createDataChannel('mochi-ka');
const wire = function (a, b) {
return a.createOffer()
.then(function (o) { return a.setLocalDescription(o); })
.then(function () { return b.setRemoteDescription(a.localDescription); })
.then(function () { return b.createAnswer(); })
.then(function (ans) { return b.setLocalDescription(ans); })
.then(function () { return a.setRemoteDescription(b.localDescription); });
};
const gathered = function (pc) {
return new Promise(function (res) {
let done = false;
const fin = function () { if (!done) { done = true; res(); } };
try { if (pc.iceGatheringState === 'complete') { fin(); return; } } catch (e) { fin(); return; }
try {
pc.addEventListener('icegatheringstatechange', function () {
try { if (pc.iceGatheringState === 'complete') fin(); } catch (e) { fin(); }
});
} catch (e) { fin(); }
setTimeout(fin, 3000);
});
};
const flush = function () {
try { for (let i = 0; i < kaCand2.length; i++) p1.addIceCandidate(kaCand2[i]); } catch (e) {}
try { for (let i = 0; i < kaCand1.length; i++) p2.addIceCandidate(kaCand1[i]); } catch (e) {}
};
wire(p1, p2)
.then(function () { return Promise.all([gathered(p1), gathered(p2)]); })
.then(flush)
.catch(function () { kaWebrtcStop(); kaWebrtcScheduleRebuild(); });
p1.onconnectionstatechange = function () {
const st = p1.connectionState;
if (st === 'connected') {
kaWebrtcOkAt = Date.now();
if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
return;
}
if (st === 'disconnected') {
if (kaWebrtcDiscTimer) return;
kaWebrtcDiscTimer = setTimeout(function () {
kaWebrtcDiscTimer = null;
if (!kaPc1) return;
const s2 = kaPc1.connectionState;
if (s2 === 'connected') { kaWebrtcOkAt = Date.now(); return; }
kaWebrtcStop();
kaWebrtcScheduleRebuild();
}, 8000);
return;
}
if (st === 'failed' || st === 'closed') {
kaWebrtcStop();
kaWebrtcScheduleRebuild();
}
};
kaPc1 = p1; kaPc2 = p2;
} catch (e) {}
}
function kaWebrtcStop() {
if (kaWebrtcTimer) { clearTimeout(kaWebrtcTimer); kaWebrtcTimer = null; }
if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
try { if (kaPc1) kaPc1.close(); } catch (e) {}
try { if (kaPc2) kaPc2.close(); } catch (e) {}
kaPc1 = kaPc2 = null;
kaCand1 = []; kaCand2 = [];
}
const KA_HB_KEY = 'xy-home-v2:__ka-hb';
let kaHbTimer = null;
let kaHb = null;
function kaHbTick() {
if (!kaHb) return;
kaHb.n++;
kaHb.ts = Date.now();
try { kaHb.trail.push(kaHb.ts); if (kaHb.trail.length > 8) kaHb.trail.shift(); } catch (e) {}
try { if (window.idbSet) window.idbSet(KA_HB_KEY, kaHb); } catch (e) {}
}
function kaHbStart() {
if (kaHbTimer) return;
kaHb = { n: 0, hid: Date.now(), ts: Date.now(), resumed: 0, trail: [] };
kaHbTick();
kaHbTimer = setInterval(kaHbTick, 30000);
}
function kaHbStop() {
if (kaHbTimer) { clearInterval(kaHbTimer); kaHbTimer = null; }
}
let kaEv = { stall: 0, died: 0, diedAt: [] };
try {
const _evSaved = gGet('__ka-ev');
if (_evSaved && String(_evSaved).charAt(0) === '{') {
const _ev = JSON.parse(_evSaved);
if (_ev && typeof _ev === 'object') kaEv = Object.assign(kaEv, _ev);
}
} catch (e) {}
function kaEvSave() { try { gSet('__ka-ev', JSON.stringify(kaEv)); } catch (e) {} }
const SESS_KEY = '__sess-alive';
function sessMark(closed) { try { gSet(SESS_KEY, JSON.stringify({ t: Date.now(), closed: !!closed })); } catch (e) {} }
function sessBootCheck() {
try {
const prev = JSON.parse(gGet(SESS_KEY) || 'null');
if (prev && typeof prev.t === 'number' && !prev.closed && (Date.now() - prev.t) < 30 * 60 * 1000) {
kaEv.died++;
kaEv.diedAt = kaEv.diedAt || [];
kaEv.diedAt.push(Date.now());
if (kaEv.diedAt.length > 10) kaEv.diedAt.shift();
kaEvSave();
kaDiedNotice = true;
}
} catch (e) {}
sessMark(false);
}
try { window.addEventListener('pagehide', function () { sessMark(true); }); } catch (e) {}
try { document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') sessMark(false); }); } catch (e) {}
document.addEventListener('visibilitychange', function () {
if (document.visibilityState === 'hidden') {
if (!keepEnabled) return;
kaHbStart();
} else {
if (kaHb) {
kaHb.resumed = Date.now();
if (kaHb.ts && kaHb.resumed - kaHb.ts > 90000) {
kaEv.stall++; kaEvSave();
try { if (keepAudio && keepAudio.el && !kaCustomAudio) keepAudio.el.volume = KA_VOL_MAX; } catch (e) {}
if (kaHb.hid && kaHb.resumed - kaHb.hid >= 600000) {
toast('⚠ 挂后台太久，保活被系统冻结截断过\n这段时间的后台消息/后台弹窗可能失效（回本页已自动恢复）\n经常失效：彻底关闭网页重新打开，再把「后台保活」「后台弹窗」开关重新打开', 6000);
}
}
try { if (window.idbSet) window.idbSet(KA_HB_KEY, kaHb); } catch (e) {}
}
kaHbStop();
}
});
try {
sessBootCheck(); // #961：通用存活标记启动判定（含正常收尾标记，与保活开关无关）
if (window.idbGet) window.idbGet(KA_HB_KEY).then(function (old) {
if (old && old.n > 0 && !old.resumed && !old.bye) {
kaEv.died++; kaEvSave();
kaDiedNotice = true;
tryShowKaDiedNotice();
}
}).catch(function () {});
} catch (e) {}
window.addEventListener('pagehide', function () {
if (!kaHb) return;
kaHb.bye = 1;
try { if (window.idbSet) window.idbSet(KA_HB_KEY, kaHb); } catch (e) {}
});
let kaDiedNotice = false;
let kaPermNoticeArmed = false;
function kaLivenessOn() {
try { return !!keepEnabled || !!notifyEnabled; } catch (e) { return false; }
}
function kaNoticeCool(key, ms) {
try { const t = Number(gGet(key)) || 0; return t > 0 && (Date.now() - t) < ms; } catch (e) { return false; }
}
function kaNoticeStamp(key) { try { gSet(key, String(Date.now())); } catch (e) {} }
function kaNoticeAfterSplash(fn) {
try {
if (chanSplashGone()) { fn(); return; }
const s = document.getElementById('splash');
if (!s) { fn(); return; }
let done = false;
let mo = null, moBody = null, tmr = null;
const cleanup = function () {
done = true;
try { if (mo) mo.disconnect(); } catch (e) {}
try { if (moBody) moBody.disconnect(); } catch (e) {}
try { if (tmr) clearTimeout(tmr); } catch (e) {}
};
const fire = function () { if (done) return; cleanup(); try { fn(); } catch (e) {} };
if (typeof MutationObserver === 'function') {
mo = new MutationObserver(function () { if (chanSplashGone()) fire(); });
try { mo.observe(s, { attributes: true, attributeFilter: ['class', 'hidden'] }); } catch (e) {}
moBody = new MutationObserver(function () { if (!s.isConnected) fire(); });
try { moBody.observe(document.body, { childList: true }); } catch (e) {}
}
tmr = setTimeout(cleanup, 90000);
} catch (e) { try { fn(); } catch (e2) {} }
}
function showMemWarnBar(total, recent) {
try {
if (document.getElementById('mem-warn-bar')) return;
const b = document.createElement('div');
b.className = 'ver-update-bar';
b.id = 'mem-warn-bar';
b.style.cursor = 'pointer';
b.innerHTML = '<span class="vub-txt"></span><b>去看怎么清</b>';
b.querySelector('.vub-txt').textContent = '手机内存不够，系统已把本站关掉重载 ' + total + ' 次（近两天 ' + recent + ' 次）——白屏/重开就因为这个，不是网站坏了';
b.addEventListener('click', function () {
try {
const t = document.querySelector('.tabbar .tab[data-page="page-setting"]');
if (t) t.click();
setTimeout(function () {
try {
const tg = document.querySelector('#set-tabs .them-tab[data-sec="tools"]');
if (tg) tg.click();
} catch (e) {}
setTimeout(function () {
try { const r = document.getElementById('row-storage-view'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'center' }); } catch (e) {}
}, 300);
}, 350);
} catch (e) {}
});
(document.body || document.documentElement).appendChild(b);
setTimeout(function () { try { b.hidden = true; } catch (e) {} }, 60000); // 60s 自动收起，不常驻
} catch (e) {}
}
function tryShowKaDiedNotice() {
if (!kaDiedNotice) return;
try { if (document.visibilityState !== 'visible') return; } catch (e) { return; }
const total = kaEv.died || 0;
const recent = (kaEv.diedAt || []).filter(function (t) { return Date.now() - t < 48 * 3600 * 1000; }).length;
if (recent >= 3 || total >= 10) {
if (kaNoticeCool('__ka-mem-note-at', 24 * 3600 * 1000)) { kaDiedNotice = false; return; }
kaDiedNotice = false;
kaNoticeStamp('__ka-mem-note-at');
kaNoticeAfterSplash(function () { showMemWarnBar(total, recent); });
return;
}
if (kaNoticeCool('__ka-died-note-at', 12 * 3600 * 1000)) { kaDiedNotice = false; return; }
kaDiedNotice = false;
kaNoticeStamp('__ka-died-note-at');
toast('⚠ 系统刚把本站整个关掉过一次（手机内存不够时 iOS 会这样做）——所以切回来会白一下、重新加载。这不是网站坏了，也不会丢数据。想少发生：①设置→系统 关掉「后台保活」②设置→工具→「查看存储」清掉最占地方的一项。');
}
function nbPermPendingNotice() {
try { if (!notifyEnabled) return; } catch (e) { return; }
try { if (nbPermState() !== 'default') return; } catch (e) { return; }  // 已授权/已拒绝都不提示
if (kaNoticeCool('__nb-perm-note-at', 12 * 3600 * 1000)) return;
try { if (document.visibilityState !== 'visible') return; } catch (e) { return; }
kaNoticeStamp('__nb-perm-note-at');
toast('⚠「后台通知」开关开着，但浏览器还没给通知权限\n地址栏左侧图标 → 网站设置 → 通知 → 允许（没允许之前，后台消息不会弹窗）\n这是权限限制，不是开关坏了', 7000);
}
try {
if (kaDiedNotice) kaNoticeAfterSplash(tryShowKaDiedNotice);
setTimeout(function () { kaPermNoticeArmed = true; kaNoticeAfterSplash(nbPermPendingNotice); }, 20000);
} catch (e) {}
window.__kaProbe = function () {
let audio = null, ms = null;
try { audio = keepAudio && keepAudio.el ? { paused: !!keepAudio.el.paused, volume: keepAudio.el.volume, loop: !!keepAudio.el.loop } : null; } catch (e) {}
try { ms = ('mediaSession' in navigator && navigator.mediaSession) ? { metadata: !!navigator.mediaSession.metadata, state: navigator.mediaSession.playbackState } : null; } catch (e) {}
let music = null;
try {
const m = window.__mochiMusic;
music = {
flag: !!window.__musicPlaying,
paused: m && m.el ? !!m.el.paused : null,
want: m && m.want ? !!m.want() : null,
strict: musicNowPlaying()
};
} catch (e) {}
return {
keep: keepEnabled,
notify: notifyEnabled,
perm: ('Notification' in window) ? Notification.permission : 'unsupported',
audio: audio,
ms: ms,
music: music,
pc: kaPc1 ? (kaPc1.connectionState || 'new') : 'off',
pcGathering: kaPc1 ? (function () { try { return kaPc1.iceGatheringState || '?'; } catch (e) { return '?'; } })() : 'off',
pcCand: (kaCand1.length + kaCand2.length) | 0,
pcNext: kaWebrtcTimer ? kaWebrtcRebuildDelay : 0,
hb: kaHb ? { n: kaHb.n, hid: kaHb.hid, ts: kaHb.ts, resumed: kaHb.resumed, trail: (kaHb.trail || []).slice() } : null,
ev: { stall: kaEv.stall, died: kaEv.died }
};
};
function startKeepAlive(showToast) {
if (keepAudio) return;
try {
const src = kaCustomAudio || ensureKeepAudioDataUrl();
if (!src) { if (showToast) toast('后台保活启动失败（无法生成保活音频）'); return; }
const keepEl = document.createElement('audio');
keepEl.loop = true;
keepEl.volume = kaCustomAudio ? 1 : KA_VOL_BASE;
keepEl.src = src;
keepEl.setAttribute('playsinline', '');
keepEl.addEventListener('play', function () { kaMarkPlayed(); });
keepEl.addEventListener('pause', function () {
if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) return;
if (kaTimer) return; // 已在退避轨道
if (kaYieldStealFocus()) return;
kaSchedule(); // 连击计数由 kaSchedule 内部递增
});
const playIt = function () {
if (musicNowPlaying()) return; // v3.10.x：音乐在播，让位不抢音频（由 syncKeepForMusic 收回）
const p = keepEl.play();
if (p && p.catch) p.catch(function () {});
};
playIt();
keepAudio = { el: keepEl };
setKeepMediaSession();
kaWebrtcDeferredStart(10000);
const resumeOnInteraction = function () {
if (musicNowPlaying()) return; // v3.10.x：音乐在播，让位
if (keepAudio && keepAudio.el && keepAudio.el.paused) {
const p = keepAudio.el.play();
if (p && p.catch) p.catch(function () {});
}
};
document.addEventListener('click', resumeOnInteraction, { once: true });
document.addEventListener('touchstart', resumeOnInteraction, { once: true });
document.addEventListener('keydown', resumeOnInteraction, { once: true });
keepInterval = setInterval(function () {
try { if (window.__mochiPhase) window.__mochiPhase('ka-tick'); } catch (e0) {}
if (keepAudio && keepAudio.el) {
try {
if (musicNowPlaying()) {
if (!keepAudio.el.paused) keepAudio.el.pause();
return;
}
if (!keepAudio.el.paused) {
let hold = true;
try {
if (document.visibilityState === 'hidden') {
const md = navigator.mediaSession && navigator.mediaSession.metadata;
hold = !!(md && String(md.title) === 'Mochi 后台保活');
}
} catch (e) { hold = true; }
if (hold) {
try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
}
if (kaPauseStreak && Date.now() - kaLastPlayAt > kaStableMs()) kaPauseStreak = 0;
return;
}
if (!kaTimer && !kaYieldStealFocus()) kaSchedule();
} catch (e) {}
}
}, 5000);
const requestWakeLock = function () {
if (navigator.wakeLock && document.visibilityState === 'visible') {
navigator.wakeLock.request('screen').then(function (sentinel) {
wakeSentinel = sentinel;
if (wakeSentinel) {
wakeSentinel.addEventListener('release', function () {
setTimeout(function () { if (keepEnabled) requestWakeLock(); }, 1000);
});
}
}).catch(function () {});
}
};
requestWakeLock();
if (showToast) {
if (!('Notification' in window)) {
toast('后台保活已启动（注意：本环境不支持系统通知，需 HTTPS 访问）');
} else if (Notification.permission !== 'granted') {
toast('后台保活已启动（通知未授权：去设置→后台通知→开启并允许权限）');
} else {
showSysNotification('后台保活已启动', { body: '正在播放静音音频以保持后台活跃，请勿关闭此页面' }).then(function (ok) {
toast(ok
? '后台保活已启动 · 通知栏应弹出提示条，若没有请到系统设置→通知→Chrome→允许通知'
: '后台保活已启动（通知发送未受理，请检查系统通知权限）');
});
}
}
} catch (e) {}
}
function stopKeepAlive(showToast) {
try { if (keepAudio && keepAudio.el) { keepAudio.el.pause(); keepAudio.el.removeAttribute('src'); try { keepAudio.el.load(); } catch (e2) {} } } catch (e) {}
if (!window.__musicPlaying) {
try {
if ('mediaSession' in navigator && navigator.mediaSession) {
try { navigator.mediaSession.playbackState = 'paused'; } catch (e2) {}
navigator.mediaSession.metadata = null;
try { navigator.mediaSession.setActionHandler('play', null); } catch (e) {}
try { navigator.mediaSession.setActionHandler('pause', null); } catch (e) {}
}
} catch (e) {}
}
try { if (wakeSentinel) { wakeSentinel.release(); } } catch (e) {}
wakeSentinel = null;
kaStopTimer();
kaPauseStreak = 0;
kaPlayFailStreak = 0;
kaWebrtcStop();
clearInterval(keepInterval);
keepAudio = null;
keepInterval = null;
if (showToast) toast('后台保活已关闭');
}
function healKeepAlive() {
if (!keepEnabled) return;
kaResetBackoff();
if (!kaPc1 && !kaWebrtcTimer && !kaWebrtcBootTimer) kaWebrtcDeferredStart(3000);
if (!musicNowPlaying() && keepAudio && keepAudio.el && keepAudio.el.paused) {
const p = keepAudio.el.play();
if (p && p.catch) p.catch(function () {});
}
[0, 600, 1800].forEach(function (d) {
setTimeout(function () {
if (!keepEnabled || musicNowPlaying()) return; // v3.10.x：音乐在播，让位
if (keepAudio && keepAudio.el && keepAudio.el.paused) {
const p = keepAudio.el.play();
if (p && p.catch) p.catch(function () {});
}
}, d);
});
setKeepMediaSession();
try {
if (navigator.wakeLock && document.visibilityState === 'visible') {
navigator.wakeLock.request('screen').then(function (sentinel) {
wakeSentinel = sentinel;
if (wakeSentinel) {
wakeSentinel.addEventListener('release', function () {
setTimeout(function () { if (keepEnabled) requestWakeLockTop(); }, 1000);
});
}
}).catch(function () {});
}
} catch (e) {}
}
let _fgResumeAt = 0;
let _fgFromHiddenFor = 0;
function _onFgVisible() {
const now = Date.now();
if (now - _fgResumeAt < 1000) return;
_fgResumeAt = now;
try { _fgFromHiddenFor = lastHiddenAt > 0 ? now - lastHiddenAt : 0; } catch (e) { _fgFromHiddenFor = 0; }
healKeepAlive();
try { document.dispatchEvent(new Event('mochi-fg-resume')); } catch (e) {}
}
document.addEventListener('visibilitychange', function () {
if (document.visibilityState === 'visible') _onFgVisible();
});
document.addEventListener('focus', function () {
if (document.visibilityState === 'visible') _onFgVisible();
});
window.addEventListener('pageshow', function (e) {
if (e.persisted || document.visibilityState === 'visible') _onFgVisible();
});
document.addEventListener('visibilitychange', function () {
if (document.visibilityState !== 'hidden') return;
if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) return;
if (!keepAudio.el.paused) return;
if (kaYieldStealFocus()) return;
kaResetBackoff();
const p = keepAudio.el.play();
if (p && p.catch) p.catch(function () {});
kaSchedule();
});
function requestWakeLockTop() {
try {
if (navigator.wakeLock && document.visibilityState === 'visible' && keepEnabled) {
navigator.wakeLock.request('screen').then(function (sentinel) {
wakeSentinel = sentinel;
}).catch(function () {});
}
} catch (e) {}
}
document.addEventListener('music-media-release', function () {
if (keepEnabled) { setKeepMediaSession(); syncKeepForMusic(); }
});
function kaOpenEnableHints() {
try {
if (typeof window.openModal !== 'function') return;
window.openModal('后台保活已开启 · 三条必知', '', function () {}, {
noInput: true, pillSubmit: true,
pills: [{ label: '知道了', value: 'ok' }],
staticText: '保活＝页面在后台持续播放一段近无声音频，让系统不冻结本页。有两条硬限制（手机/浏览器限制，不是网站故障）：\n\n① 别的 App 会把保活截断：刷视频、听歌等会占用手机音频通道，保活音频被暂停＝保活失效，回到本页才自动恢复；被截断期间后台消息收不到、后台弹窗不弹。\n\n② 后台挂久了会失效：系统省电/内存策略会把挂久的页面冻结甚至丢弃重载（Edge「睡眠标签页」/Chrome「内存节省程序」约 30 分钟就会丢）。失效后请彻底关闭网页重新打开，再把「后台保活」「后台弹窗」开关重新打开。\n\n③ 开着它时页面不会在后台自动换新版（换版要重载页面、会把后台运行打断）：顶部出现「检测到新版本」条时，你自己挑时间点「刷新使用新版」即可；不点也不影响使用，下次彻底关闭网页重开会自然换到新版。'
});
} catch (e) {}
}
const kaBtn = document.getElementById('bg-keepalive');
function syncKeepUI() { if (kaBtn) kaBtn.checked = keepEnabled; }
let kaInputAt = 0;
try {
const kaMarkInput = function (e) {
try { if (e && e.isTrusted === false) return; } catch (er) {}
kaInputAt = Date.now();
};
['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown'].forEach(function (t) {
try { document.addEventListener(t, kaMarkInput, { passive: true, capture: true }); } catch (err) {}
});
} catch (e) {}
function kaUserGesture(e) {
try {
if (e && e.isTrusted === false) return false;
if (Date.now() - kaInputAt <= 1200) return true;
if (navigator.userActivation && navigator.userActivation.hasBeenActive === false) return false;
} catch (er) {}
return true;
}
if (kaBtn) {
kaBtn.addEventListener('change', function (e) {
if (!kaUserGesture(e)) { syncKeepUI(); try { kaBtn.checked = keepEnabled; } catch (er) {} return; }
keepUserTouched = true; // #88：手动动过 → 回填后不再重读覆盖
keepEnabled = kaBtn.checked;
gSet('bg-keepalive', keepEnabled ? '1' : '0');
gSet('__ka-user-off', keepEnabled ? '0' : '1');
if (keepEnabled) { startKeepAlive(true); kaOpenEnableHints(); }
else stopKeepAlive(true);
});
}
(function () {
let saved = gGet('bg-keepalive');
if (saved === null) {
const old = store.get('bg-keepalive');
if (old !== null) { gSet('bg-keepalive', old); saved = old; }
}
keepEnabled = saved === null ? false : saved === '1';
if (gGet('__ka-user-off') === '1') {
keepEnabled = false;
if (saved === '1') gSet('bg-keepalive', '0');
}
syncKeepUI();
if (keepEnabled) startKeepAlive(false);
})();
const kaAudioBtn = document.getElementById('bg-keep-audio-btn');
function syncKaAudioUI() { if (kaAudioBtn) kaAudioBtn.textContent = kaAudioLabel(); }
if (kaAudioBtn) kaAudioBtn.addEventListener('click', function (e) {
e.preventDefault();
e.stopPropagation();
openKaAudioPicker();
});
kaLoadCustomAudio();
syncKaAudioUI();
try { document.addEventListener('mochi-restore-done', function () { kaLoadCustomAudio(); syncKaAudioUI(); }); } catch (e) {}
let notifyEnabled = false;
let notifyUserTouched = false; // v3.26.x #88：本会话用户手动动过通知开关 → 回填后不重读覆盖
const NOTIFY_ICON = (function () {
try { return new URL('./icon-512.png', location.href).href; } catch (e) { return ''; }
})();
let BADGE_DATAURL = '';
let badgeReady = false;
let badgeQueue = null;
function getBadgeUrl(cb) {
cb = cb || function () {};
if (badgeReady) { cb(BADGE_DATAURL); return; }
if (badgeQueue) { badgeQueue.push(cb); return; }
badgeQueue = [cb];
if (!NOTIFY_ICON) { badgeReady = true; BADGE_DATAURL = ''; const q = badgeQueue; badgeQueue = null; for (let i = 0; i < q.length; i++) q[i](''); return; }
const img = new Image();
img.onload = function () {
try {
const s = 96;
const c = document.createElement('canvas');
c.width = s; c.height = s;
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0, s, s);
const d = ctx.getImageData(0, 0, s, s);
const px = d.data;
for (let i = 0; i < px.length; i += 4) {
const r = px[i], g = px[i + 1], b = px[i + 2];
if (r > 248 && g > 248 && b > 248) px[i + 3] = 0;   // 白底 → 透明
else { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255; } // 内容 → 白色不透明
}
ctx.putImageData(d, 0, 0);
BADGE_DATAURL = c.toDataURL('image/png');
} catch (e) { BADGE_DATAURL = ''; }
badgeReady = true;
const q = badgeQueue; badgeQueue = null;
for (let i = 0; i < q.length; i++) { try { q[i](BADGE_DATAURL); } catch (e2) {} }
};
img.onerror = function () { badgeReady = true; BADGE_DATAURL = ''; const q = badgeQueue; badgeQueue = null; for (let i = 0; i < q.length; i++) { try { q[i](''); } catch (e) {} } };
img.src = NOTIFY_ICON;
}
function dataUrlToBlob(dataUrl, cb) {
try {
fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (b) {
cb(b && b.size ? b : null);
}, function () { cb(null); });
} catch (e) { cb(null); }
}
function prepMediaBlobs(target, done) {
const keys = ['icon', 'badge', 'image'];
let pending = 0;
const finish = function () { if (!pending && done) { const d = done; done = null; d(); } };
keys.forEach(function (k) {
const v = target[k];
if (typeof v === 'string' && v.indexOf('data:') === 0) {
pending++;
dataUrlToBlob(v, function (b) {
if (b) {
try { target[k] = URL.createObjectURL(b); } catch (e) { delete target[k]; }
} else {
delete target[k];
}
if (--pending === 0) finish();
});
}
});
finish();
}
function kaWithTimeout(p, ms) {
return new Promise(function (resolve, reject) {
let done = false;
const t = setTimeout(function () { if (!done) { done = true; reject(new Error('ka-timeout')); } }, ms);
try {
const pr = (typeof p === 'function') ? p() : p;
Promise.resolve(pr).then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
} catch (e) { if (!done) { done = true; clearTimeout(t); reject(e); } }
});
}
function kaSWReady() {
if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return Promise.resolve(null);
const start = function () {
return navigator.serviceWorker.getRegistration().then(function (reg) {
return (reg && reg.active) ? reg : null;
}).catch(function () { return null; }).then(function (reg) {
if (reg) return reg;
try { navigator.serviceWorker.register('./sw.js').catch(function () {}); } catch (e) {}
return kaWithTimeout(navigator.serviceWorker.ready, 4000).then(function (r2) {
return r2 || null;
}).catch(function () { return null; });
});
};
return kaWithTimeout(start(), 5000).catch(function () { return null; });
}
let lastNotifyChannel = '';   // 'sw' | 'page' | 'none'：最近一次实际通道
window.bgNotifyLastChannel = function () { return lastNotifyChannel; };
let swLaterQueue = [];        // FIX 2026-09-20 #921：待补发队列——原单发闸在等待窗内只收第一条，
let swLaterTimer = null;      // 「就绪即补发」等待窗（同时只挂一个定时器，到点统一 flush）
function swNotifyNote(ch, chanOut) {
lastNotifyChannel = ch;
if (typeof chanOut === 'function') { try { chanOut(ch); } catch (e) {} }
}
function swLaterFlush(reg) {
if (!swLaterTimer) return; // 已 flush 过（ready 与 60s 到点谁先到都只跑一次）
clearTimeout(swLaterTimer); swLaterTimer = null;
const q = swLaterQueue; swLaterQueue = [];
if (!reg) {
for (let i = 0; i < q.length; i++) swNotifyNote('none', q[i].chanOut);
chanDownPending += q.length;
tryShowNotifyHealBar();
return;
}
chanDownPending = 0;
try { const hb = document.getElementById('notify-heal-bar'); if (hb) hb.hidden = true; } catch (e) {}
for (let i = 0; i < q.length; i++) {
const o = Object.assign({}, q[i].opts);
delete o.image; delete o.icon; delete o.badge;
if (!o.urgency) o.urgency = 'high';
try { reg.showNotification(q[i].title, o); swNotifyNote('sw', q[i].chanOut); } catch (e) { swNotifyNote('none', q[i].chanOut); }
}
}
function swNotifyLater(title, opts, chanOut) {
if (!('serviceWorker' in navigator) || !navigator.serviceWorker) { swNotifyNote('none', chanOut); return; }
swLaterQueue.push({ title: title, opts: opts, chanOut: chanOut });
if (swLaterTimer) return;
swLaterTimer = setTimeout(function () { swLaterFlush(null); }, 60000);
kaWithTimeout(navigator.serviceWorker.ready, 60000).then(swLaterFlush, function () { swLaterFlush(null); });
}
let chanDownPending = 0;
let chanDownShown = 0;
let chanDownDismissAt = 0;
function chanSplashGone() {
const s = document.getElementById('splash');
return !s || !s.isConnected || s.classList.contains('hide');
}
function tryShowNotifyHealBar() {
if (!chanDownPending) return;
if (document.visibilityState !== 'visible' || !chanSplashGone()) return;
const n = chanDownPending; chanDownPending = 0;
if (chanDownShown >= 2 || Date.now() - chanDownDismissAt < 12 * 3600 * 1000) return;
chanDownShown++;
const bar = document.getElementById('notify-heal-bar');
if (!bar) return;
const txt = document.getElementById('notify-heal-txt');
if (txt) txt.textContent = '⚠ 后台通知通道未就绪：刚才有 ' + n + ' 条消息没能弹出。点「立即刷新」恢复；无效请彻底关闭浏览器后重开';
bar.hidden = false;
const act = document.getElementById('notify-heal-refresh');
if (act) act.onclick = function () { try { location.reload(); } catch (e) {} };
const close = document.getElementById('notify-heal-close');
if (close) close.onclick = function () { chanDownDismissAt = Date.now(); bar.hidden = true; };
}
document.addEventListener('visibilitychange', function () {
if (document.visibilityState !== 'visible') return;
setTimeout(tryShowNotifyHealBar, 800); // 回前台补出条（隐藏期间发生的丢失也提示）；错开回前台渲染高峰
});
function showSysNotification(title, opts, chanOut) {
opts = opts || {};
const note = function (ch) {
lastNotifyChannel = ch;
if (typeof chanOut === 'function') { try { chanOut(ch); } catch (e) {} }
};
return new Promise(function (resolve) {
try {
if (!('Notification' in window) || Notification.permission !== 'granted') { note('none'); resolve(false); return; }
const hidden = document.visibilityState === 'hidden';
const pageFallback = function () {
const noMedia = Object.assign({}, opts);
delete noMedia.image;
delete noMedia.icon;
delete noMedia.badge;
note('page');
try {
new Notification(title, noMedia);
resolve(!hidden);
} catch (e) { note('none'); resolve(false); }
};
if ('serviceWorker' in navigator && navigator.serviceWorker) {
const swOpts = Object.assign({}, opts);
if (!swOpts.urgency) swOpts.urgency = 'high';
if (!swOpts.badge) swOpts.badge = BADGE_DATAURL || NOTIFY_ICON || undefined;
kaSWReady().then(function (reg) {
if (!reg) { if (hidden) swNotifyLater(title, opts, chanOut); pageFallback(); return; }
const STRIP_LADDER = [[], ['image'], ['image', 'badge'], ['image', 'badge', 'icon']];
let ladderIdx = 0;
const tryNext = function () {
if (ladderIdx >= STRIP_LADDER.length) { note('none'); resolve(false); return; }
const attempt = Object.assign({}, swOpts);
STRIP_LADDER[ladderIdx++].forEach(function (k) { delete attempt[k]; });
prepMediaBlobs(attempt, function () {
kaWithTimeout(function () { return reg.showNotification(title, attempt); }, 4000)
.then(function () { note('sw'); resolve(true); }, tryNext);
});
};
tryNext();
}).catch(pageFallback);
} else {
pageFallback();
}
} catch (e) { note('none'); resolve(false); }
});
}
function requestNotifyPermission(cb, failCb, opts) {
const quiet = !!(opts && opts.quiet);
const say = function (m) { if (!quiet) toast(m); };
const fail = function (why) { if (failCb) failCb(why); };
if (!('Notification' in window)) {
const _isIOS = !!(window.mochiDevice || {}).isIOS;
say(_isIOS
? 'iPhone / iPad 的网页拿不到系统通知\n（添加到主屏幕也不保证）请用「桌面消息弹窗」'
: '当前浏览器不支持系统通知\n请改用 Chrome/Edge 打开本站（安卓或电脑都行）');
fail('unsupported');
return;
}
if (Notification.permission === 'granted') { if (cb) cb(); return; }
if (Notification.permission !== 'default') {
say('通知权限被拒绝，请在浏览器设置中允许通知');
fail('denied');
return;
}
try {
let settled = false;
const once = function (p) {
if (settled) return;
settled = true;
if (p === 'granted') { if (cb) cb(); return; }
if (p === 'denied') { say('通知权限被拒绝，请在浏览器设置中允许通知'); fail('denied'); return; }
say('还没拿到通知权限：请在浏览器弹窗里点「允许」（地址栏左侧图标 → 网站设置 → 通知）');
fail('pending');
};
const ret = Notification.requestPermission(once);
if (ret && typeof ret.then === 'function') {
ret.then(function (p) { once(p); }, function () { once('error'); });
}
} catch (e) { fail('error'); }
}
const nbBtn = document.getElementById('bg-notify');
function syncNotifyUI() { if (nbBtn) nbBtn.checked = notifyEnabled; }
function nbPermState() {
try { return ('Notification' in window) ? Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; }
}
const NB_SETTLE_MS = 12000; // 待决等待上限：覆盖「系统弹窗弹着、用户过几秒才点允许」的正常窗口
let nbAttempt = 0;          // 每轮「用户动开关」的代号：回调/轮询只认自己那一轮，过期即弃
let nbSettleTimer = null;
let nbSettlePoke = null;    // 待决轮询的「探一脚」入口（回前台/重新聚焦时立刻补查）
let nbAppliedFor = 0;       // 已落地的轮次（granted 可能从回调与轮询两边同时到）
function nbAttemptNext() {
nbAttempt++;
if (nbSettleTimer) { clearTimeout(nbSettleTimer); nbSettleTimer = null; }
nbSettlePoke = null;
return nbAttempt;
}
function nbRevertOff() { notifyEnabled = false; gSet('bg-notify', '0'); syncNotifyUI(); }
function nbApplyOn(my) {
if (my !== nbAttempt || nbAppliedFor === my) return;
nbAppliedFor = my;
notifyEnabled = true;
gSet('bg-notify', '1');
syncNotifyUI();
nbSyncPermWarn();   // #1014：权限已到位，撤掉行下那条标红说明（否则权限好了还挂着「还挡着」）
showSysNotification('通知已开启', { body: '后台消息提醒将正常弹窗' });
if (kaIsIOS()) setTimeout(function () { toast('iPhone 提示：受系统限制，后台弹窗不保证弹出；消息不会丢，回来自动补看'); }, 1600);
setTimeout(function () {
const keep = document.getElementById('bg-keepalive');
const keepOn = keepEnabled;
const userWantsKeepOff = gGet('bg-keepalive') === '0' || gGet('__ka-user-off') === '1';
if (!keepOn && userWantsKeepOff) {
toast('你已手动关闭「后台保活」，保持你的设置；但后台消息可能收不到通知，需要时请手动开启');
} else if (!keepOn) {
if (keep) keep.checked = true;
keepEnabled = true;
gSet('bg-keepalive', '1');
gSet('__ka-user-off', '0');
startKeepAlive(false);
syncKeepUI();
toast('已自动开启后台保活（后台消息必需）');
}
if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
toast('提醒：需 HTTPS 访问，浏览器才允许通知');
}
}, 400);
}
function nbNoticeOnce(key, msg) {
try { if (kaNoticeCool(key, 60 * 1000)) return; kaNoticeStamp(key); } catch (e) {}
toast(msg, 7000);
}
function nbPermWarnText() {
const p = nbPermState();
if (p === 'unsupported') {
return (window.mochiDevice || {}).isIOS
? '⚠ 本机拿不到系统通知（iPhone / iPad 平台限制，添加到主屏幕也不保证）：请用「桌面消息弹窗」的应用内横幅'
: '⚠ 本机浏览器没有通知能力（小米 / vivo / OPPO 自带浏览器、UC、夸克、Via 常见如此）：请改用 Chrome / Edge 打开本站';
}
if (!notifyEnabled) return '';
if (p === 'denied') return '⚠ 浏览器还挡着本站的通知权限：地址栏左侧图标 → 网站设置 → 通知 → 允许（开关已记住你的选择，允许后自动生效，不用再点一次开关）';
if (p === 'default') return '⚠ 还没给本站通知权限：地址栏左侧图标 → 网站设置 → 通知 → 允许（开关已记住你的选择，允许后自动生效）';
return '';
}
function nbSyncPermWarn() {
try {
const el = document.getElementById('bg-notify-perm-warn');
if (!el) return;
const t = nbPermWarnText();
el.textContent = t;
el.hidden = !t;
} catch (e) {}
}
let nbWaitingGrant = false;   // 意图在、权限没到位＝正等一个授权（等到了自动生效）
let nbWatchTimer = null;
let nbWatchFor = -1;          // 等待窗属于哪一轮（同轮不重挂，见 nbArmWatch）
function nbArmWatch(my) {
const p0 = nbPermState();
const want = !!notifyEnabled && (p0 === 'denied' || p0 === 'default');
if (nbWatchTimer && nbWaitingGrant && nbWatchFor === my && want) return;
if (nbWatchTimer) { clearTimeout(nbWatchTimer); nbWatchTimer = null; }
nbWaitingGrant = want;
nbWatchFor = my;
if (!nbWaitingGrant) return;
let ticks = 0;
const tick = function () {
nbWatchTimer = null;
if (my !== nbAttempt || !notifyEnabled) { nbWaitingGrant = false; return; }
const p = nbPermState();
try { nbSyncPermWarn(); } catch (e) {}   // #1014：读数为 default/unsupported 时标红说明也要跟着变
if (p === 'granted') { nbWaitingGrant = false; nbApplyOn(my); return; }
if (p === 'unsupported' || ++ticks >= 24) { nbWaitingGrant = false; return; }  // 2 分钟封顶，不做永动机
nbWatchTimer = setTimeout(tick, 5000);
};
nbWatchTimer = setTimeout(tick, 5000);
}
function nbHoldOn(my, why) {
if (my !== nbAttempt) return;
notifyEnabled = true;
gSet('bg-notify', '1');
syncNotifyUI();
nbSyncPermWarn();
nbArmWatch(my);
if (why === 'denied') {
nbNoticeOnce('__nb-denied-note-at',
'⚠ 浏览器这次没放行通知权限（可能没弹授权框就直接挡了）\n地址栏左侧图标 → 网站设置 → 通知 → 允许\n开关已记住你的选择：允许后自动生效，不用再点一次开关');
}
nbArmRetry(my);
}
function nbSettleStart(my, quiet) {
const start = Date.now();
const tick = function () {
if (my !== nbAttempt) return;
if (nbSettleTimer) { clearTimeout(nbSettleTimer); nbSettleTimer = null; }
const p = nbPermState();
if (p === 'granted') { nbSettlePoke = null; nbApplyOn(my); return; }
if (p === 'denied') {
nbSettlePoke = null;
nbHoldOn(my, 'denied');
return;
}
if (Date.now() - start < NB_SETTLE_MS) {
nbSettleTimer = setTimeout(tick, (Date.now() - start) < 3000 ? 600 : 2000);
return;
}
nbSettlePoke = null;
if (!quiet) toast('通知权限还没定下来：地址栏左侧图标 → 网站设置 → 通知 → 允许；开关已为你保持开启，允许后自动生效');
nbArmRetry(my);
};
nbSettlePoke = tick;
nbSettleTimer = setTimeout(tick, 600);
}
function nbArmRetry(my) {
const onTap = function () {
document.removeEventListener('pointerdown', onTap, true);
document.removeEventListener('keydown', onTap, true);
if (my !== nbAttempt) return;
const p = nbPermState();
if (p === 'granted') { nbApplyOn(my); return; }
if (p === 'denied') { nbHoldOn(my, 'denied'); return; }   // FIX #1014：同上，不回弹
requestNotifyPermission(null, function () {}, { quiet: true });
nbSettleStart(my, true);
};
document.addEventListener('pointerdown', onTap, true);
document.addEventListener('keydown', onTap, true);
}
function nbPermRecheck() {
try { if (nbSettlePoke) nbSettlePoke(); } catch (e) {}
try { if (nbWaitingGrant && notifyEnabled && nbPermState() === 'granted') { nbWaitingGrant = false; nbApplyOn(nbAttempt); } } catch (e) {}
try { nbSyncPermWarn(); } catch (e) {}
}
try { window.addEventListener('focus', nbPermRecheck); } catch (e) {}
if (nbBtn) {
nbBtn.addEventListener('change', function (e) {
if (!kaUserGesture(e)) { syncNotifyUI(); try { nbBtn.checked = notifyEnabled; } catch (er) {} return; }
notifyUserTouched = true; // #88：手动动过 → 回填后不再重读覆盖
const my = nbAttemptNext();
if (nbBtn.checked) {
const p0 = nbPermState();
notifyEnabled = true;
gSet('bg-notify', '1');
syncNotifyUI();
nbSyncPermWarn();
if (p0 === 'unsupported') {
requestNotifyPermission(null, function () {
if (my !== nbAttempt) return;
nbAttemptNext(); nbRevertOff();
});
return;
}
requestNotifyPermission(function () {
if (my !== nbAttempt) return;
nbApplyOn(my);
}, function (why) {
nbHoldOn(my, why);
});
if (p0 === 'default') nbSettleStart(my, false);
return;
}
notifyEnabled = false;
gSet('bg-notify', '0');
nbWaitingGrant = false;
if (nbWatchTimer) { clearTimeout(nbWatchTimer); nbWatchTimer = null; }
nbAttemptNext();
syncNotifyUI();
nbSyncPermWarn();
});
}
(function () {
let saved = gGet('bg-notify');
if (saved === null) {
const old = store.get('bg-notify');
if (old !== null) { gSet('bg-notify', old); saved = old; }
}
notifyEnabled = saved === '1';
if ('Notification' in window && Notification.permission === 'granted') { getBadgeUrl(function () {}); }
syncNotifyUI();
nbSyncPermWarn();
if (notifyEnabled) nbArmWatch(nbAttempt);
})();
function reheatBgSwitches() {
if (!keepUserTouched) {
const wantKeep = gGet('bg-keepalive') === '1' && gGet('__ka-user-off') !== '1';
if (wantKeep !== keepEnabled) {
keepEnabled = wantKeep;
syncKeepUI();
if (wantKeep) startKeepAlive(false);
else stopKeepAlive(false);
try { console.info('[mochi] #88 回填后重读后台保活：' + (wantKeep ? '开' : '关')); } catch (e) {}
}
}
if (!notifyUserTouched) {
const wantNotify = gGet('bg-notify') === '1';
if (wantNotify !== notifyEnabled) {
notifyEnabled = wantNotify;
syncNotifyUI();
if (wantNotify) getBadgeUrl(function () {}); // 预热 badge 单色图（同初始化）
try { console.info('[mochi] #88 回填后重读后台通知：' + (wantNotify ? '开' : '关')); } catch (e) {}
}
try { nbSyncPermWarn(); } catch (e) {}
try { nbArmWatch(nbAttempt); } catch (e) {}
}
}
try {
if (window.__mochiDataReady) setTimeout(reheatBgSwitches, 0);
else document.addEventListener('mochi-restore-done', function () { reheatBgSwitches(); });
document.addEventListener('mochi-wrj-heal', function () { reheatBgSwitches(); });
setTimeout(reheatBgSwitches, 16000); // 回填整体挂起设备的兜底
} catch (e) {}
const testBtn = document.getElementById('bg-notify-test');
if (testBtn) {
let testSeq = 0;          // 每轮点按的代号：迟到的异步结论只认自己那一轮
let env = [];             // 结果行（第一段写满即出，后续证据原地追加）
let resultShown = false;  // 结果单飞闸（发送/超时/队列回读三路只出一次，之后只改内容）
let verStale = false;     // 旧包（#761）——排查步骤据此把「先升级」排在第一位
const showResult = function () {
if (!env.length) return;
resultShown = true;
toast('测试结果：\n' + env.join('\n'), 6000);
};
const pushLine = function (line) {
if (env.indexOf(line) >= 0) return;
env.push(line);
if (resultShown) showResult();   // 已出过结果：原地重写同一条 toast（不重开一条，不动驻留窗口语义）
};
const envCheck = function () {
env = [];
resultShown = false;
verStale = false;
env.push(notifyEnabled
? '✓ 后台通知开关：已开启'
: '✗ 后台通知开关：未开启——后台消息不会弹通知（点本行开关把它打开）');
const p = nbPermState();
if (p === 'granted') env.push('✓ 通知权限：已允许');
else if (p === 'default') env.push('✗ 通知权限：还没允许——地址栏左侧图标 → 网站设置 → 通知 → 允许');
else if (p === 'denied') env.push('✗ 通知权限：被浏览器挡着——地址栏左侧图标 → 网站设置 → 通知 → 允许（允许后自动生效）');
else env.push('✗ 通知权限：本机浏览器没有通知能力——请改用 Chrome / Edge（安卓或电脑都行）');
let kp = null;
try { kp = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null; } catch (e) {}
if (!kp || !kp.keep) env.push('✗ 后台保活：未开启（后台不产生消息，通知无从弹起）');
else {
env.push((kp.audio && !kp.audio.paused) ? '✓ 后台保活：音频播放中' : '! 后台保活：音频已暂停（回本页自动恢复；后台消息可能到不了）');
const anchor = [];
if (kp.ms && kp.ms.metadata) anchor.push('媒体会话');
if (kp.pc && kp.pc !== 'off') anchor.push('连接保活');
if (kp.hb && kp.hb.n) anchor.push('心跳 ' + kp.hb.n + ' 拍');
if (anchor.length) env.push('· 保活锚点：' + anchor.join(' / '));
if (kp.ev && (kp.ev.stall || kp.ev.died)) env.push('! 历史取证：断流 ' + kp.ev.stall + ' 次 / 后台终止 ' + kp.ev.died + ' 次（被系统冻结或丢弃过——恢复口径见本行「功能说明」）');
}
try {
kaSWReady().then(function (reg) {
pushLine(reg
? '✓ 后台服务：已就绪（Service Worker 通道，切后台 / 关屏也能弹）'
: '! 后台服务：未就绪——只会走页面通道，切后台就不弹了（刷新页面后重测）');
});
} catch (e) {}
};
const queueProbe = function (wasHidden) {
kaSWReady().then(function (reg) {
if (!reg || !reg.getNotifications) return null;
return new Promise(function (res) {
setTimeout(function () {
try { reg.getNotifications().then(res, function () { res(null); }); } catch (e) { res(null); }
}, 500);
});
}).then(function (list) {
const found = !!(list && list.some && list.some(function (n) { return n && n.title === '后台通知测试'; }));
pushLine(found
? '✓ 已确认进入系统通知队列——手机上没看到＝系统层拦截（通知总开关/悬浮横幅/省电限制），见本行「功能说明」排查'
: '! 已提交但未进系统通知队列＝多半被系统拦截，见本行「功能说明」排查');
if (found && wasHidden) {
pushLine('✓ 发送时页面在后台——屏幕上方应有横幅；没看见＝系统层拦截（通知总开关/悬浮横幅/省电限制）见本行「功能说明」');
} else if (found) {
pushLine('! 前台发送不弹顶层横幅——要验「屏幕上方弹出」请用下方第二段：按 Home 切后台（或锁屏）再发一条');
}
}).catch(function () {});
};
const verProbe = function () {
try {
const sv = document.getElementById('splash-ver');
const localTs = Number(sv && sv.getAttribute('data-build-ts')) || 0;
kaWithTimeout(function () { return fetch('./version.json?v=' + Date.now()); }, 4000)
.then(function (r) { return r && r.json ? r.json() : null; })
.then(function (d) {
const ts = Number(d && d.ts) || 0;
if (!localTs || !ts) pushLine('! 版本：没问到线上版本（网络受限，不影响本测试）');
else if (ts > localTs) {
verStale = true;
pushLine('✗ 旧包正在运行：本页 ' + new Date(localTs).toLocaleString() + ' · 线上最新 ' + new Date(ts).toLocaleString() + '——「什么都没改弹窗突然全没」的常见原因，彻底关闭浏览器重开（升级新版本）后再测');
} else pushLine('✓ 版本已最新：' + new Date(ts).toLocaleString());
}, function () { pushLine('! 版本：没拉到 version.json（网络受限，不影响本测试）'); });
} catch (e) {}
};
const askSeen = function (phase2) {
if (typeof window.openModal !== 'function') return;
window.openModal('自检确认', '', function (choice) {
if (choice === 'seen') {
toast(phase2 ? '✓ 后台弹窗链路全通：切后台（锁屏）也能弹横幅' : '✓ 弹窗链路全通：以后后台消息没弹时，先回来点这个测试', 4000);
return;
}
if (choice !== 'miss') return;
const MARKS = ['①', '②', '③', '④'];
const steps = [];
const push = function (s) { steps.push(MARKS[steps.length] + ' ' + s); };
if (verStale) push('先升级：本页是旧版本包——彻底关闭浏览器再重开（或点顶部「刷新使用新版」），旧包＝「没改任何东西弹窗突然全没」的头号原因');
push('重置浏览器通知权限：浏览器设置 → 网站设置 → 通知 → 把本站「关闭」再「允许」，然后强杀浏览器重开（「权限明明开着、通知却消失好几天」多数被这一步救活——JS 读到的一直是 granted，坏的是浏览器内部那条通道）');
push('系统通知设置：系统设置 → 通知管理 → 本浏览器 → 总开关打开、「允许横幅通知/在屏幕上方显示」打开、通知重要性选「提醒」；国产 ROM（vivo/OPPO/小米/华为）每项可能各自独立');
push('省电限制：允许本浏览器后台运行/关闭对它的省电优化（否则挂后台时整页被冻结，消息与通知都无从产生）；Edge 的「睡眠标签页」/Chrome 的「内存节省程序」默认把挂后台约 30 分钟的页面丢弃重载（表现＝回来时页面自动刷新、保活/通知可能被重置）——浏览器设置里把本站加入「永不睡眠/始终保持活动」名单');
steps.push('每做完一步就按 Home 键把页面切到后台、让 TA 发一条消息验证；全部走完仍不弹 → 用「信息诊断」里的反馈入口一键上报');
window.openModal('没弹出 → 按顺序排查（实效从高到低）', '', function () {}, {
noInput: true, big: true,
staticText: steps.join('\n')
});
}, {
noInput: true, lock: true,
staticText: (phase2
? '刚才按 Home 把页面切到后台（或锁屏）之后，屏幕上方弹出「后台通知测试（后台阶段）」这条横幅了吗？\n（通知栏里有小图标 ≠ 屏幕上方弹出；锁屏界面上的通知算弹出）'
: '刚才屏幕上方弹出「后台通知测试」横幅了吗？\n（通知栏里有小图标 ≠ 屏幕上方弹出；前台发送通常只进通知栏，要验横幅请用第二段：按 Home 切后台后再测一次）'),
pills: [{ label: '看到了，顶部弹出', value: 'seen' }, { label: '没看到', value: 'miss' }],
pillSubmit: true
});
};
const bgT2 = { armed: false, sent: false, ok: false, chan: '', reported: false, hideT: null, disarmT: null };
const bgT2Arm = function () {
if (bgT2.armed && !bgT2.sent) return;
bgT2.armed = true; bgT2.sent = false; bgT2.ok = false; bgT2.chan = ''; bgT2.reported = false;
toast('第二段已就绪：按 Home 把页面切到后台（可锁屏），5 秒后自动发一条；回到本页看结论', 7000);
if (bgT2.disarmT) clearTimeout(bgT2.disarmT);
bgT2.disarmT = setTimeout(function () { if (!bgT2.sent) bgT2.armed = false; }, 180000); // 3 分钟没切后台就作废
};
const bgT2Report = function () {
if (!bgT2.armed || !bgT2.sent || bgT2.reported) return;
if (document.visibilityState === 'hidden') return;   // 后台弹的 toast 用户看不见，等回前台再说
bgT2.reported = true;
bgT2.armed = false;
if (bgT2.disarmT) { clearTimeout(bgT2.disarmT); bgT2.disarmT = null; }
const chTxt = bgT2.chan === 'sw' ? 'Service Worker 通道' : (bgT2.chan === 'page' ? '页面通道（后台会被系统抑制）' : '通道未就绪');
const sayIt = function () { toast('第二段（后台阶段）结果：\n'
+ (bgT2.ok
? '✓ 页面切到后台后发出的通知已提交系统（' + chTxt + '）\n（通知栏里有小图标 ≠ 屏幕上方弹出，下面请如实回答）'
: '✗ 页面切到后台后没能发出通知（' + chTxt + '）——后台弹窗这一半不通，见本行「功能说明」排查'), 8000); };
setTimeout(sayIt, 700);
if (bgT2.ok) setTimeout(function () { askSeen(true); }, 1800);
};
const offerPhase2 = function () {
if (typeof window.openModal !== 'function') return;
window.openModal('后台弹窗自测 · 第二段', '', function (choice) {
if (choice === 'go') { bgT2Arm(); return; }
if (choice === 'no') askSeen(false);
}, {
noInput: true,
staticText: '第一段测的是「现在能不能发出通知」。第二段测你真正关心的那一半：按 Home 把页面切到后台（可锁屏）之后还会不会弹。\n\n点「现在测（切后台）」后：按 Home → 页面在后台 5 秒后自动发一条 → 回到本页即出结论并问你看没看到。\n（第一段前台发的那条通常只进通知栏，屏幕上方横幅只能这样验）\n点「不用了」＝只测第一段，会照旧问你一句「刚才那条看到了吗」。',
pills: [{ label: '现在测（切后台）', value: 'go' }, { label: '不用了', value: 'no' }],
pillSubmit: true
});
};
document.addEventListener('visibilitychange', function () {
if (!bgT2.armed) return;
if (document.visibilityState === 'hidden') {
if (bgT2.sent || bgT2.hideT) return;
bgT2.hideT = setTimeout(function () {
bgT2.hideT = null;
if (!bgT2.armed || bgT2.sent || document.visibilityState !== 'hidden') return;
bgT2.sent = true;
try {
const nm = store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
showSysNotification('后台通知测试（后台阶段）', { body: '这条是在页面切到后台之后发出的 · 来自 ' + nm }, function (ch) { bgT2.chan = ch; })
.then(function (ok) { bgT2.ok = !!ok; bgT2Report(); });
} catch (e) { bgT2.ok = false; bgT2Report(); }
}, 5000);
return;
}
if (bgT2.hideT) { clearTimeout(bgT2.hideT); bgT2.hideT = null; }
bgT2Report();
});
const runTest = function (my) {
const testWasHidden = document.hidden;   // 发送那一刻在不在后台（决定「屏幕上方横幅」怎么解释）
let testChan = '';
let settled = false;
const settle = function () {
if (my !== testSeq || settled) return;
settled = true;
showResult();
if (testChan === 'sw') offerPhase2();
};
try {
const name = store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
showSysNotification('后台通知测试', { body: '来自 ' + name + ' · 如果能看到这条，后台通知就通了' }, function (ch) { testChan = ch; }).then(function (ok) {
if (my !== testSeq) return;
if (testChan === 'sw' && ok) {
pushLine('✓ 测试通知已发送并真正提交系统显示（Service Worker 通道：后台关屏也能弹）');
} else if (testChan === 'page') {
pushLine(ok
? '✓ 测试通知已发送（页面通道：仅本页前台可见）'
: '! 未真正送达：后台服务未就绪，页面通道在后台会被系统抑制（已挂自动补发，或刷新页面重试）');
} else {
pushLine('✗ 测试通知提交失败：被浏览器/系统拒绝——见本行「功能说明」排查（权限已允许仍被拒＝查系统设置里本浏览器的通知总开关）');
}
settle();
if (testChan === 'sw' && ok) queueProbe(testWasHidden);
verProbe();
});
} catch (e) {
pushLine('✗ 测试执行异常：' + (e && e.message ? e.message : e));
settle();
return;
}
setTimeout(function () {
if (my !== testSeq || settled) return;
settled = true;
pushLine('✗ 测试超时：通知发送链 8 秒未落定（应用内故障，非权限/系统问题）——请用「诊断信息」一键反馈');
showResult();
}, 8000);
};
testBtn.addEventListener('click', function () {
const my = ++testSeq;
toast('正在检查通知环境…');
envCheck();
if (!('Notification' in window)) {
if (!window.isSecureContext) {
pushLine('✗ 当前浏览器不支持 Notification API');
pushLine('原因：' + location.protocol + '//' + location.host + ' 不是安全上下文，浏览器不开放通知能力');
pushLine('解决：用 https:// 部署访问（GitHub Pages 即是 HTTPS）');
} else if (kaIsIOS()) {
pushLine('✗ 当前浏览器不支持 Notification API');
pushLine('原因：iPhone / iPad 的网页拿不到系统通知（添加到主屏幕也不保证）');
pushLine('解决：改用 设置 → 系统 →「桌面消息弹窗」的应用内横幅');
} else {
pushLine('✗ 当前浏览器不支持 Notification API');
pushLine('原因：本机浏览器没有通知能力（小米 / vivo / OPPO 等自带浏览器、UC、夸克、Via 常见如此）');
pushLine('解决：改用 Chrome / Edge 打开本站（安卓或电脑都行）');
}
showResult();
return;
}
if (Notification.permission === 'default') {
Notification.requestPermission().then(function (p) {
if (my !== testSeq) return;
if (p === 'granted') { envCheck(); runTest(my); return; }
pushLine('✗ 通知权限：这次没能拿到' + (p === 'denied' ? '（浏览器没放行——可能没弹授权框就直接挡了）' : '（还没在弹窗里做选择）'));
pushLine('解决：地址栏左侧图标 → 网站设置 → 通知 → 允许（开关已记住你的选择，允许后自动生效）');
showResult();
}).catch(function () {
if (my !== testSeq) return;
pushLine('✗ 请求通知权限失败（浏览器没给授权框）——地址栏左侧图标 → 网站设置 → 通知 → 允许');
showResult();
});
return;
}
runTest(my);
});
}
let hiddenSentCount = 0;
let hiddenSentName = '';
document.addEventListener('visibilitychange', function () {
const vis = document.visibilityState;
if (vis === 'hidden') {
hiddenSentCount = 0;
hiddenSentName = '';
return;
}
if (vis !== 'visible') return;
nbPermRecheck();
try { kaNoticeAfterSplash(tryShowKaDiedNotice); } catch (e) {}
try { if (kaPermNoticeArmed) kaNoticeAfterSplash(nbPermPendingNotice); } catch (e) {}
const saved = gGet('bg-notify');
if (saved === '1') {
const keepOn = keepEnabled;
if (!keepOn) {
toast('提醒：后台保活已关闭，后台消息到不了，通知不会弹（设置里开启）');
}
}
try {
const chatPage = document.getElementById('page-chat');
const inChat = chatPage && !chatPage.hidden;
const n = hiddenSentCount;
const who = hiddenSentName || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
hiddenSentCount = 0;
hiddenSentName = '';
if (!inChat && n > 0 && window.showDeskPopup) {
window.showDeskPopup({ name: who, text: '你不在的时候收到 ' + n + ' 条新消息', isHidden: false });
const now = Date.now();
if (saved === '1' && 'Notification' in window && Notification.permission === 'granted' &&
(!lastResumeNotifyAt || now - lastResumeNotifyAt > 30000)) {
lastResumeNotifyAt = now;
const notiIcon = (store.get('cs-avatar-partner') || store.get('avatar-partner') || '');
const sendNoti = function (iconVal) {
const o = { body: '你不在的时候收到 ' + n + ' 条新消息' };
if (iconVal) o.icon = iconVal;
showSysNotification(who, o);
};
if (notiIcon && (notiIcon.indexOf('data:') === 0 || /^https?:\/\//i.test(notiIcon))) {
makeAvatarThumb(notiIcon, function (u) { sendNoti(u || notiIcon); });
} else {
sendNoti('');
}
}
}
} catch (e) {}
});
let lastResumeNotifyAt = 0; // v3.5.154：回前台汇总通知去重
let lastVisibleAt = Date.now();
let lastHiddenAt = 0; // v3.16.x：最近一次切后台时刻（修复过渡期闸门失效）
(function () {
const markVisible = function () {
if (document.visibilityState === 'visible') {
lastVisibleAt = Date.now();
lastHiddenAt = 0;
} else if (document.visibilityState === 'hidden') {
lastHiddenAt = Date.now();
}
};
document.addEventListener('visibilitychange', markVisible);
window.addEventListener('pageshow', markVisible);
window.addEventListener('focus', markVisible);
})();
const NOTIFY_HIDDEN_MIN_MS = 15000;
const NOTIFY_CHAT_DUP_MS = 5 * 60000;  // v3.20.x：历史聊天查重 15→5 分钟
const NOTIFY_SENT_DUP_MS = 2 * 60000;  // v3.20.x：已发通知查重 6→2 分钟
const NOTIFY_SEEN_DUP_MS = 3 * 60000;  // v3.20.x：前台看过记忆 15→3 分钟
const NOTIFY_FRESH_CHAT_DUP_MS = 30 * 60000;
function normNotifyKey(raw) {
let s = String(raw || '');
if (s.length > 1024) s = s.slice(0, 1024); // 先截断再正则，避免超长 base64 全文替换开销
s = s.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]')
.replace(/@@m:[0-9a-f]{32}/g, '[附件]') // FIX 2026-09-13 #401 令牌串入指纹同口径
.replace(/\|\|\|.*$/, '')
.replace(/<[^>]*>/g, '');
return s.replace(/\s+/g, '').slice(0, 100);
}
function sampleDataUrl(dataUrl) {
try {
if (!dataUrl || typeof dataUrl !== 'string') return '';
const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
const b64 = m ? dataUrl.slice(m[0].length) : dataUrl;
const h = function (shift) {
let x = 0;
for (let i = shift; i < b64.length; i += 7) x = (x * 31 + b64.charCodeAt(i)) & 0x7fffffff;
return x.toString(36);
};
return '|' + (m ? m[1] : '?') + ':' + b64.length + ':' + h(0) + ':' + h(1) + ':' + h(2);
} catch (e) { return ''; }
}
function msgFingerprint(text, img) {
let t = String(text || '');
const isPh = /^\[(图片|表情包|语音|附件)\]$/.test(t.trim());
const imgOnly = isPh || !t.trim() || t.indexOf('data:') === 0;
let k = normNotifyKey(imgOnly && img ? '[附件]' : t);
const a = sampleDataUrl(img);
if (a) k += a;
return k;
}
function recentChatDup(key, refTs, windowMs) {
if (!key) return false;
try {
const arr = window.getChatMsgs ? window.getChatMsgs() : null;
if (!arr || !arr.length) return false;
const cutoff = Date.now() - (windowMs || NOTIFY_CHAT_DUP_MS);
for (let i = arr.length - 1, n = 0; i >= 0 && n < 150; i--, n++) {
const m = arr[i];
if (!m) continue;
const mts = m.ts || 0;
if (mts && mts < cutoff) break; // 追加有序，更早的不可能落在窗口内
if (refTs && (mts >= refTs - 2500 || (!mts && i === arr.length - 1) || Date.now() - mts < 2500)) continue;
if (m.side !== 'in') continue;
let t = m.text || '';
let img = '';
if ((!t || t.indexOf('data:') === 0) && m.parts && m.parts.length) {
const texts = [], images = [];
for (let p = 0; p < m.parts.length; p++) {
const part = m.parts[p];
if (!part || !part.k) continue;
if (part.k === 'text') texts.push(part.v);
else if (part.k === 'image' || part.k === 'sticker' || part.k === 'voice') images.push(part.v);
}
t = texts.join(' ');
img = images[0] || '';
} else if (t.indexOf('data:') === 0) {
img = t; // 无 parts 的旧式纯图消息：dataURL 即正文
t = '';
} else if (t.indexOf('|||') >= 0) {
t = t.split('|||')[0];
}
const mf = msgFingerprint(t, img);
if (mf === key) return true;
if (mf.length >= 6 && key.length > mf.length && key.length >= mf.length * 1.6 && key.indexOf(mf) >= 0) return true;
if (key.length >= 6 && mf.length > key.length && mf.length >= key.length * 1.6 && mf.indexOf(key) >= 0) return true;
}
} catch (e) {}
return false;
}
const notifiedRecently = new Map();
function notifiedDup(key) {
if (!key) return false;
const last = notifiedRecently.get(key);
return !!(last && Date.now() - last < NOTIFY_SENT_DUP_MS);
}
function markNotified(key) {
if (!key) return;
notifiedRecently.set(key, Date.now());
if (notifiedRecently.size > 60) { // 上限防膨胀：删最早的（Map 保持插入序）
notifiedRecently.delete(notifiedRecently.keys().next().value);
}
}
const seenRecently = new Map();
function markSeen(key) {
if (!key) return;
seenRecently.set(key, Date.now());
if (seenRecently.size > 80) { // 上限防膨胀：删最早的（Map 保持插入序）
seenRecently.delete(seenRecently.keys().next().value);
}
}
function seenDup(key) {
if (!key) return false;
const last = seenRecently.get(key);
return !!(last && Date.now() - last < NOTIFY_SEEN_DUP_MS);
}
let gateStats = { total: 0, tooFresh: 0, dup: 0, replay: 0, sent: 0 };
window.bgNotifyGateStats = function () { return Object.assign({}, gateStats); };
window.bgNotifyGateInfo = function (text, img, refTs) {
const nkey = msgFingerprint(text, img);
const transitionBlocks = lastHiddenAt > 0 && Date.now() - lastHiddenAt < NOTIFY_HIDDEN_MIN_MS &&
recentChatDup(nkey, refTs, NOTIFY_FRESH_CHAT_DUP_MS);
return {
hiddenForMs: Date.now() - lastVisibleAt,
tooFreshHidden: lastHiddenAt > 0 && Date.now() - lastHiddenAt < NOTIFY_HIDDEN_MIN_MS,
transitionBlocks: transitionBlocks,
dupNotified: notifiedDup(nkey),
dupSeen: seenDup(nkey),
dupInChat: recentChatDup(nkey, refTs),
identityBlocked: (function () {
try {
const d = window.__mochiMsgDelivered ? window.__mochiMsgDelivered(refTs, 'in') : null;
return !!(d && (d.vis || d.nAt));
} catch (e) { return false; }
})(),
nkey: nkey
};
};
window.bgLateCatchup = function (minHiddenMs, winMs) {
return Date.now() - _fgResumeAt < (winMs || 8000) && _fgFromHiddenFor >= (minHiddenMs || 60000);
};
window.bgNotifyCheck = function (text, ts, extra) {
if (!notifyEnabled) return;
extra = extra || {};
const nkey = msgFingerprint(text, extra.img);
if (document.visibilityState === 'visible') { if (!extra.late) { markSeen(nkey); return; } }
if (!('Notification' in window) || Notification.permission !== 'granted') return;
if (!extra.force && extra.msgTs) {
try {
const d = window.__mochiMsgDelivered ? window.__mochiMsgDelivered(extra.msgTs, 'in') : null;
if (d && (d.vis || d.nAt)) { gateStats.replay++; return; }
} catch (e) {}
}
gateStats.total++;
const force = !!extra.force;
if (!force && lastHiddenAt > 0 && Date.now() - lastHiddenAt < NOTIFY_HIDDEN_MIN_MS &&
recentChatDup(nkey, ts, NOTIFY_FRESH_CHAT_DUP_MS)) { gateStats.tooFresh++; return; }
if (!force && (notifiedDup(nkey) || seenDup(nkey))) { gateStats.dup++; return; }
if (!force && recentChatDup(nkey, ts)) { gateStats.dup++; return; }
gateStats.sent++; markNotified(nkey);
hiddenSentCount++;
hiddenSentName = extra.name || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
const name = extra.name || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
let t = '';
if (ts) {
const d = new Date(ts);
t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}
const body = String(text || '收到一条新消息')
.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]')
.replace(/@@m:[0-9a-f]{32}/g, '[图片]')
.replace(/\|\|\|.*$/, '');
const bodyFitted = window.taFit ? window.taFit(body) : body;
const opts = { body: (t ? t + '  ' : '') + (bodyFitted && bodyFitted.length > 40 ? bodyFitted.slice(0, 40) + '…' : bodyFitted) };
let bigIcon = '';   // 右侧大图标：联系人头像；无头像时兜底 mochi 字母图标（见下）
let previewImg = ''; // 展开大图：消息图片
const avatar = extra.avFixed
? (extra.av || '')
: (extra.av || store.get('cs-avatar-partner') || store.get('avatar-partner') || '');
if (avatar && (avatar.indexOf('data:') === 0 || /^https?:\/\//i.test(avatar))) bigIcon = avatar;
if (!bigIcon) bigIcon = NOTIFY_ICON;
if (extra.img && (extra.img.indexOf('data:') === 0 || /^https?:\/\//i.test(extra.img))) previewImg = extra.img;
const cropAvatarToSquare = makeAvatarThumb;
const sendFinal = function (iconVal) {
if (iconVal) opts.icon = iconVal;
if (previewImg) opts.image = previewImg;
showSysNotification(name, opts).then(function (ok) {
if (ok) {
try { if (extra.msgTs && window.__mochiMsgNotified) window.__mochiMsgNotified(extra.msgTs, 'in'); } catch (e) {}
} else {
notifiedRecently.delete(nkey); // #800：发送失败回滚决定点早记账，保留「失败可重试」
}
});
};
if (bigIcon) {
const cropFired = { v: false };
const cropTimer = setTimeout(function () { if (!cropFired.v) { cropFired.v = true; sendFinal(''); } }, 1200);
cropAvatarToSquare(bigIcon, function (u) {
clearTimeout(cropTimer);
if (cropFired.v) return;
cropFired.v = true;
sendFinal(u || bigIcon);
});
} else {
sendFinal(bigIcon);
}
};
function makeAvatarThumb(dataUrl, cb) {
try {
const img = new Image();
if (/^https?:\/\//i.test(dataUrl)) { img.crossOrigin = 'anonymous'; }
img.onload = function () {
try {
if (!img.width || !img.height) { cb(''); return; }
const maxSide = 96;
const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
const w = Math.max(1, Math.round(img.width * scale));
const h = Math.max(1, Math.round(img.height * scale));
const c = document.createElement('canvas');
c.width = w; c.height = h;
const ctx = c.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, w, h);
ctx.drawImage(img, 0, 0, w, h);
cb(c.toDataURL('image/jpeg', 0.85));
} catch (e) { cb(''); }
};
img.onerror = function () { cb(''); };
img.src = dataUrl;
} catch (e) { cb(''); }
}
const PSYNC_TAG = 'mochi-ta-msg';
const PSYNC_SNAP_KEY = 'xy-home-v2:psync-snap';
const PSYNC_QUEUE_KEY = 'xy-home-v2:psync-queue';
const PSYNC_SNAP_TTL = 7 * 24 * 60 * 60 * 1000;
const PSYNC_BUILTIN = [
'刚看到一句话，想起你了。',
'你在忙吗？我这边刚刚想到你。',
'没什么事，就是想跟你说句话。',
'今天也要好好吃饭呀。',
'突然很想你，就说一声。',
'记得喝水，别总忘了。',
'晚安前跟你说一声，我在。',
'有空的时候理理我呀。'
];
function psyncSupported() {
try { return 'serviceWorker' in navigator && 'PeriodicSyncManager' in window; } catch (e) { return false; }
}
function psyncStandalone() {
try { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches); } catch (e) { return false; }
}
function psyncEnabled() { return gGet('psync-en') === '1'; }
function psyncPlainCard(s) {
if (typeof s !== 'string') return false;
const t = s.trim();
if (!t || t.length > 60) return false;
if (t.indexOf('|||') >= 0) return false;               // 语音卡
if (t.indexOf('data:') === 0) return false;            // 图片/表情包
if (window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false;
if (t.indexOf('http:') === 0 || t.indexOf('https:') === 0) return false;
return true;
}
function psyncShuffle(a) {
const r = a.slice();
for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = r[i]; r[i] = r[j]; r[j] = t; }
return r;
}
function psyncBuildSnapshot() {
let cc = [];
try { cc = ((window.getCustomCards ? window.getCustomCards() : []) || []).filter(psyncPlainCard).slice(0, 40); } catch (e) { cc = []; }
const picks = [];
psyncShuffle(cc).forEach(function (t) { picks.push({ t: t.trim(), k: 'cc' }); });
psyncShuffle(PSYNC_BUILTIN).slice(0, 4).forEach(function (t) { picks.push({ t: t, k: 'bl' }); });
const snap = {
v: 1,
ts: Date.now(),
cid: window.__activeCid || 'default',
name: (function () { try { return store.get('lbl-partner') || 'TA'; } catch (e) { return 'TA'; } })(),
texts: psyncShuffle(picks).slice(0, 12)
};
window.__psyncSnapCount = snap.texts.length;
try { if (window.idbSet) window.idbSet(PSYNC_SNAP_KEY, snap); } catch (e) {}
return Promise.resolve(snap);
}
window.__psyncBuildSnapshot = function () { return psyncBuildSnapshot(); };
async function psyncApply() {
if (!psyncSupported() || !psyncEnabled()) { psyncSyncStatus(); return; }
try {
await navigator.serviceWorker.ready;
const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
if (st && st.state === 'denied') { psyncSyncStatus('denied'); return; }
await navigator.periodicSync.register(PSYNC_TAG, { minInterval: 6 * 60 * 60 * 1000 });
await psyncBuildSnapshot();
} catch (e) {}
psyncSyncStatus();
}
async function psyncTeardown() {
try { if (psyncSupported() && navigator.periodicSync.getTags) {
const tags = await navigator.periodicSync.getTags();
if (tags.indexOf(PSYNC_TAG) >= 0) await navigator.periodicSync.unregister(PSYNC_TAG);
} } catch (e) {}
psyncSyncStatus();
}
async function drainPsyncQueue(force) {
if (!window.idbGet || !window.idbSet || !window.chatAddIn) return 0;
try { if (!force && performance.now() < 10000) return 0; } catch (e) {} // 开屏 10s 内不动，等聊天权威数据就绪
let arr = null;
try { arr = await window.idbGet(PSYNC_QUEUE_KEY); } catch (e) { return 0; }
if (!Array.isArray(arr) || !arr.length) return 0;
const cur = window.__activeCid || 'default';
const remain = [];
let delivered = 0;
for (let i = 0; i < arr.length; i++) {
const it = arr[i];
if (!it || typeof it.t !== 'string' || !it.t.trim()) continue;
if (!it.ts || Date.now() - it.ts > PSYNC_SNAP_TTL) continue;   // 过期丢弃
if ((it.cid || 'default') !== cur) { remain.push(it); continue; } // 别的桌面的留着
let dup = false;                                               // 防重复：最近 10 条同文本 30 分钟内视为已投递
try {
const msgs = window.getChatMsgs ? window.getChatMsgs() : null;
if (Array.isArray(msgs)) {
for (let j = Math.max(0, msgs.length - 10); j < msgs.length; j++) {
const m = msgs[j];
if (m && m.side === 'in' && m.text === it.t && Math.abs((m.ts || 0) - it.ts) < 30 * 60000) { dup = true; break; }
}
}
} catch (e) {}
if (!dup) { try { window.chatAddIn(it.t, { initiative: 1, silent: true }); delivered++; } catch (e) {} }
}
try { await window.idbSet(PSYNC_QUEUE_KEY, remain); } catch (e) {}
return delivered;
}
window.__psyncDrain = function (force) { return drainPsyncQueue(force === true); };
function psyncSyncStatus(state) {
const el = document.getElementById('psync-status');
if (!el) return;
const isIOS = !!(window.mochiDevice || {}).isIOS;
if (!psyncSupported()) {
el.textContent = isIOS
? '此浏览器不支持离线提醒（iPhone / iPad 拿不到；请靠「后台保活」+「桌面消息弹窗」的应用内横幅）'
: '此浏览器不支持离线提醒（需要 Chromium 内核：安卓或电脑上的 Chrome / Edge，并把应用添加到主屏幕后重开此开关）';
return;
}
if (!psyncEnabled()) { el.textContent = '已关闭 · 页面全关后不再收到 TA 的消息提醒'; return; }
if (!psyncStandalone()) { el.textContent = '需先添加到主屏生效：浏览器菜单「添加到主屏幕」，再从桌面图标打开本应用，然后重新打开此开关'; return; }
if (state === 'denied') { el.textContent = '已开启 · 但后台调度被系统/浏览器拒绝：多半是通知权限被关了。请 ①在本应用网址栏左侧打开「网站设置」→通知→允许；②手机 系统设置→应用→Edge/Chrome→通知→允许；③该应用开启「不受限制/省电」；再回来关闭并重新打开此开关'; return; }
if ('Notification' in window && Notification.permission !== 'granted') {
el.textContent = '已开启 · 还需允许系统通知（会弹授权，点「允许」才能收到提醒弹窗）';
return;
}
let n = (typeof window.__psyncSnapCount === 'number') ? window.__psyncSnapCount : 0;
el.textContent = '已开启 · 待发文案 ' + n + ' 条 · 后台频率由系统定（约数小时一次）；收不到请检查：系统设置允许本浏览器通知，且不限制其后台运行/省电';
}
const psHelp = document.getElementById('psync-help');
if (psHelp) {
const openPsyncHelp = function (e) {
if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (er) {} }
const txt = [
'离线消息提醒（零后端）\n',
'🌟 有什么用',
'页面全部关闭后，TA 也会在后台「留话」提醒你，营造陪伴感。系统每隔几小时唤醒一次，随机抽一条你准备（或内置）的想念字卡，以 TA 的名义弹出系统通知；回来后这条消息也会补进聊天记录。\n',
'🔗 它和「后台弹窗」无关',
'两者是完全独立的功能，互不影响。后台弹窗要的是「页面还在后台时」TA 发消息、靠后台保活+通知权限弹横幅。不开离线消息提醒，后台弹窗照常工作；反之亦然。想收到后台弹窗时，只需：后台保活+桌面消息弹窗开关开着+系统通知允许。\n',
'🔓 怎么开（安卓）',
'1. 用 Chrome 或 Edge（安卓）打开本应用；',
'2. 浏览器菜单 →「添加到主屏幕」，再从桌面图标打开；',
'3. 打开本开关，系统弹通知授权时点「允许」；',
'4. 到手机 系统设置→应用→浏览器，确认「通知」允许、且未限制后台/省电。\n',
'⚠️ 为什么有人开不了',
'· iPhone：iOS 不支持此技术，只能靠系统通知/保活；',
'· 非 Chrome/Edge 的安卓浏览器：不支持，请换用；',
'· 没添加到主屏：需先从桌面图标打开才能调度；',
'· 开了却收不到：多半是系统关了通知，或浏览器被省电/后台清理。\n',
'📌 注意',
'它不是真推送，频率由系统决定（约数小时一次）、只随机抽一条；也不代表对方真实在线。'
].join('\n');
const ctl = window.openModal('离线消息提醒 · 功能说明', '', function () {}, {
noInput: true,
staticText: txt
});
if (ctl && ctl.okText) ctl.okText('知道了');
};
psHelp.addEventListener('click', openPsyncHelp);
psHelp.addEventListener('keydown', function (e) {
if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPsyncHelp(); }
});
}
const psBtn = document.getElementById('psync-en');
function syncPsyncUI() { if (psBtn) psBtn.checked = psyncEnabled(); }
if (psBtn) {
psBtn.addEventListener('change', function () {
const on = psBtn.checked;
gSet('psync-en', on ? '1' : '0');
psyncSyncStatus();
if (on) {
const go = function () { psyncApply(); };
if ('Notification' in window && Notification.permission === 'default' && typeof requestNotifyPermission === 'function') requestNotifyPermission(go);
else go();
toast(on ? '离线消息提醒已开启' : '离线消息提醒已关闭');
} else psyncTeardown();
});
}
setTimeout(function () { psyncApply(); }, 8000);
[12000, 27000, 47000].forEach(function (ms) { setTimeout(function () { try { drainPsyncQueue(false); } catch (e) {} }, ms); });
try {
document.addEventListener('visibilitychange', function () {
if (document.visibilityState !== 'visible') return;
try { drainPsyncQueue(false); } catch (e) {}
try {
if (psyncEnabled() && psyncSupported()) {
const last = window.__psyncLastSnapAt || 0;
if (Date.now() - last > 300000) { window.__psyncLastSnapAt = Date.now(); psyncApply(); }
}
} catch (e) {}
});
} catch (e) {}
try {
document.addEventListener('contact-switched', function () {
setTimeout(function () {
try { drainPsyncQueue(false); } catch (e) {}
if (psyncEnabled() && psyncSupported()) psyncBuildSnapshot();
}, 3000);
});
} catch (e) {}
try {
if ('serviceWorker' in navigator && navigator.serviceWorker) {
navigator.serviceWorker.addEventListener('message', function (e) {
if (!e || !e.data || e.data.type !== 'MOCHI_NOTIFY_CLICK') return;
try { if (typeof window.enterChat === 'function') window.enterChat(); } catch (x) {}
});
}
} catch (e) {}
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("bg-keep.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("bg-keep.js"); try { console.error("[JS] bg-keep.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[bg-keep.js] " + String(__e && __e.message || __e)); } })();