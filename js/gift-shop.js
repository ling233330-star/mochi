(function () { try {
(function () {
if (window.__giftShopInit) return;
window.__giftShopInit = true;
function store() { return window.activeStore(); }
function partnerName() { return (typeof window.chatPartnerName === 'function') ? window.chatPartnerName() : 'TA'; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
function todayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function editingNow() { try { return Array.prototype.some.call(document.querySelectorAll('.app-grid'), function (g) { return g.classList.contains('editing'); }); } catch (e) { return false; } }
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2000);
}
function closeTc() { const m = document.getElementById('tc-mask'); if (m) m.hidden = true; }
function chatOnScreen() {
try { const p = document.getElementById('page-chat'); return !!(p && !p.hidden); } catch (e) { return false; }
}
function fmtTime(tm) { const d = new Date(tm); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function fenToYuan(fen) { const y = fen / 100; if (y >= 100000) return (y / 10000).toFixed(1) + '万'; if (y >= 1000) return y.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return y.toFixed(2); }
const WALLET_KEY = 'gift-wallet';
const WALLET_MIGRATE_KEY = 'wallet-global-migrated';
const WALLET_DEFAULT_FEN = 52000;
function wstore() { return window.xyStore ? window.xyStore('xy-home-v2') : null; }
function normalizeWallet(w) {
if (!w || typeof w.myBalance !== 'number' || typeof w.systemBalance !== 'number') return null;
if (w.myBalance === 99999999 && w.systemBalance === 99999999) return { myBalance: WALLET_DEFAULT_FEN, systemBalance: WALLET_DEFAULT_FEN };
return { myBalance: w.myBalance, systemBalance: w.systemBalance };
}
function parseRaw(str) { try { return JSON.parse(str || ''); } catch (e) { return null; } }
function migrateGlobalWallet(s) {
try {
if (s.get(WALLET_MIGRATE_KEY)) return;
let chosen = normalizeWallet(parseRaw(s.get(WALLET_KEY)));
if (!chosen) {
let giftDefault = null, giftAny = null, rpDefault = null, rpAny = null;
try {
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || k.indexOf('xy-home-v2:') !== 0) continue;
let m = k.match(/^xy-home-v2:(.+):gift-wallet$/);
if (m) {
const c = normalizeWallet(parseRaw(localStorage.getItem(k)));
if (!c) continue;
if (m[1] === 'default') { if (!giftDefault) giftDefault = c; } else if (!giftAny) giftAny = c;
continue;
}
m = k.match(/^xy-home-v2:(.+):rp-wallet$/);
if (m) {
const c = normalizeWallet(parseRaw(localStorage.getItem(k)));
if (!c) continue;
if (m[1] === 'default') { if (!rpDefault) rpDefault = c; } else if (!rpAny) rpAny = c;
}
}
} catch (e) {}
chosen = giftDefault || giftAny || rpDefault || rpAny || null;
}
if (chosen) s.set(WALLET_KEY, JSON.stringify(chosen));
try {
const rm = [];
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (k && /^xy-home-v2:.+:gift-wallet$/.test(k)) rm.push(k);
}
rm.forEach(function (k) {
try { localStorage.removeItem(k); } catch (e) {}
try { if (window.idbDelete) window.idbDelete(k); } catch (e) {}
});
} catch (e) {}
s.set(WALLET_MIGRATE_KEY, '1');
} catch (e) {}
}
function walletGet() {
const s = wstore();
if (!s) return { myBalance: WALLET_DEFAULT_FEN, systemBalance: WALLET_DEFAULT_FEN };
migrateGlobalWallet(s);
const raw = parseRaw(s.get(WALLET_KEY));
const n = normalizeWallet(raw);
if (!n) {
const seed = { myBalance: WALLET_DEFAULT_FEN, systemBalance: WALLET_DEFAULT_FEN };
s.set(WALLET_KEY, JSON.stringify(seed));
return seed;
}
if (raw.myBalance !== n.myBalance || raw.systemBalance !== n.systemBalance) s.set(WALLET_KEY, JSON.stringify(n));
return n;
}
function walletSet(w) { const s = wstore(); if (s) s.set(WALLET_KEY, JSON.stringify(w)); }
window.giftWalletGet = walletGet;
window.giftWalletSet = walletSet;
function walletText() { const w = walletGet(); return '心意币 ¥' + fenToYuan(w.myBalance) + ' · ' + partnerName() + ' ¥' + fenToYuan(w.systemBalance) + ' · 向 Mochi 申请心意币'; }
function renderGiftBalances() {
['gift-balance', 'market-balance'].forEach(function (id) {
const el = document.getElementById(id);
if (el) el.textContent = walletText();
});
}
window.giftWalletChange = function (dMy, dTa, src) {
if (src) {
if (dMy < 0) dMy = 0;
if (dTa < 0) dTa = 0;
}
const w = walletGet();
if (dMy) w.myBalance += dMy;
if (dTa) w.systemBalance += dTa;
walletSet(w); renderGiftBalances();
if (src) coinLedgerAdd('earn', dMy || 0, dTa || 0, src);
return { myBalance: w.myBalance, systemBalance: w.systemBalance };
};
function coinLedgerLoad(kind) {
try {
const s = window.activeStore ? window.activeStore() : null;
if (!s) return [];
const arr = JSON.parse(s.get(kind === 'ask' ? 'records-coin-ask' : 'records-coin-earn') || '[]');
return Array.isArray(arr) ? arr : [];
} catch (e) { return []; }
}
function coinLedgerAdd(kind, myFen, taFen, src) {
try {
const s = window.activeStore ? window.activeStore() : null;
if (!s) return;
if (!myFen && !taFen) return;
const key = kind === 'ask' ? 'records-coin-ask' : 'records-coin-earn';
const list = coinLedgerLoad(kind);
list.unshift({ ts: Date.now(), myFen: myFen || 0, taFen: taFen || 0, src: src || '' });
s.set(key, JSON.stringify(list.slice(0, 100)));
try {
const hp = document.getElementById('page-home');
if (hp && !hp.hidden && window.__renderHomeCoin) window.__renderHomeCoin();
} catch (e) {}
} catch (e) {}
}
window.giftCoinLedgerAdd = coinLedgerAdd;
window.giftCoinLedgerLoad = coinLedgerLoad;
function giftEditWallet() {
if (!window.openModal) return;
var pn = partnerName();
var LBL = { my: '我的心意币', ta: pn + '的心意币' };
var side = 'my';
var doneAny = false;
function fmtYuan(n) { return (Math.round(n * 100) / 100).toFixed(2); }
function hintTxt() {
var w = walletGet();
return '当前：心意币 ¥' + fenToYuan(w.myBalance) + ' · ' + pn + ' ¥' + fenToYuan(w.systemBalance) +
(doneAny ? '\n已到账，可继续为' + LBL[side] + '申请；留空点【完成】结束' : '\n选择收款方，输入申请金额点【申请】，Mochi 打款后自动入账；留空点【完成】结束');
}
var ctl = null;
ctl = window.openModal('向 Mochi 申请心意币', '', function (arg) {
var picked = (arg === 'my' || arg === 'ta');
var el = document.getElementById('modal-input');
var raw = String(picked ? ((el && el.value) || '') : (arg == null ? '' : arg)).trim();
var target = picked ? arg : side;
if (raw === '') return; // 留空确定 = 结束本次申请
var n = parseFloat(raw);
if (isNaN(n) || n <= 0) { toast('申请金额需大于 0'); return; }
var fen = Math.round(n * 100);
var w = walletGet();
if (target === 'my') w.myBalance += fen;
else w.systemBalance += fen;
walletSet(w); renderGiftBalances();
coinLedgerAdd('ask', target === 'my' ? fen : 0, target === 'ta' ? fen : 0, '市集申请');
toast('Mochi 已打款，' + LBL[target] + ' +¥' + fmtYuan(fen / 100));
doneAny = true;
side = target === 'my' ? 'ta' : 'my';
if (ctl) {
ctl.stay();
var pbs = document.querySelectorAll('#modal-pills .pill');
var flip = pbs[side === 'my' ? 0 : 1];
if (flip) flip.click();
ctl.text('');
ctl.hint(hintTxt());
ctl.okText('完成');
}
}, {
staticText: hintTxt(),
pills: [{ value: 'my', label: '我的心意币' }, { value: 'ta', label: pn + ' 的心意币' }],
pill: 'my',
placeholder: '输入申请金额（元），留空结束',
inputmode: 'decimal'
});
if (ctl) ctl.okText('申请');
}
const CATS = ['花束', '甜品', '饮品', '美食', '饰品', '星空', '两个世界', '出行', '娱乐', '关怀', '情侣用品', '日常用品', '药品医护', '节日节令', '美妆个护'];
const CAT_ICON = { '花束': '🌸', '甜品': '🍰', '饮品': '🧋', '美食': '🍜', '饰品': '💍', '星空': '⭐', '两个世界': '🌗', '出行': '✈️', '娱乐': '🎟️', '关怀': '🤗', '情侣用品': '💑', '日常用品': '🧴', '药品医护': '💊', '节日节令': '🧧', '美妆个护': '💄' };
const CAT_COLOR = { '花束': '#fce4ec', '甜品': '#fff3e0', '饮品': '#ffe0b2', '美食': '#fff9c4', '饰品': '#f3e5f5', '星空': '#e8eaf6', '两个世界': '#e0f7fa', '出行': '#e1f5fe', '娱乐': '#e1bee7', '关怀': '#e0f2f1', '情侣用品': '#fce4ec', '日常用品': '#f1f8e9', '药品医护': '#ffebee', '节日节令': '#fff8e1', '美妆个护': '#fce4ec' };
window.GIFT_CAT_COLOR = CAT_COLOR;
const DEF_GIFTS = [
{ id: 'g_rose', name: '玫瑰', emoji: '🌹', price: 52.00, cat: '花束', wish: '送你一束玫瑰，像见你那天的风' },
{ id: 'g_sun', name: '向日葵', emoji: '🌻', price: 18.00, cat: '花束', wish: '向日葵朝着光，我朝着你' },
{ id: 'g_stars', name: '满天星', emoji: '💐', price: 36.00, cat: '花束', wish: '碎碎念念，也是岁岁年年' },
{ id: 'g_tulip', name: '郁金香', emoji: '🌷', price: 28.00, cat: '花束', wish: '郁金香不开口，但我想说' },
{ id: 'g_peach', name: '桃花', emoji: '🌸', price: 9.90, cat: '花束', wish: '路过桃花，顺手带给你' },
{ id: 'g_cake', name: '小蛋糕', emoji: '🎂', price: 38.00, cat: '甜品', wish: '今天的甜分你一半' },
{ id: 'g_choc', name: '巧克力', emoji: '🍫', price: 15.00, cat: '甜品', wish: '苦的也给你，甜的也给你' },
{ id: 'g_tea', name: '奶茶', emoji: '🧋', price: 12.00, cat: '饮品', wish: '半糖去冰，像你对我的脾气' },
{ id: 'g_candy', name: '糖果', emoji: '🍬', price: 5.20, cat: '甜品', wish: '含着糖想你，甜很久' },
{ id: 'g_berry', name: '草莓', emoji: '🍓', price: 8.80, cat: '甜品', wish: '草莓味的，和你一样' },
{ id: 'g_ring', name: '戒指', emoji: '💍', price: 520.00, cat: '饰品', wish: '圈住你，不放了' },
{ id: 'g_neck', name: '项链', emoji: '💎', price: 1314.00, cat: '饰品', wish: '贴在心口的位置' },
{ id: 'g_brace', name: '手链', emoji: '🧷', price: 88.00, cat: '饰品', wish: '系住一点点运气给你' },
{ id: 'g_bow', name: '发夹', emoji: '🎀', price: 6.60, cat: '饰品', wish: '别住你跑掉的碎发' },
{ id: 'g_star1', name: '一颗星', emoji: '⭐', price: 1.00, cat: '星空', wish: '给你一颗星，我那边多捡了一颗' },
{ id: 'g_moon', name: '月亮', emoji: '🌙', price: 131.40, cat: '星空', wish: '把月亮装好送你，今晚不用自己照路' },
{ id: 'g_cloud', name: '云朵', emoji: '☁️', price: 3.30, cat: '星空', wish: '抓了一朵云给你，软的' },
{ id: 'g_rainbow', name: '彩虹', emoji: '🌈', price: 66.60, cat: '星空', wish: '雨停了，给你留的' },
{ id: 'g_meteor', name: '流星', emoji: '🌠', price: 88.88, cat: '星空', wish: '刚许过愿，替你接住' },
{ id: 'g_galaxy', name: '星空', emoji: '🌌', price: 334.40, cat: '星空', wish: '我这边夜空很好，寄一片给你' },
{ id: 'g_hug', name: '拥抱', emoji: '🤗', price: 0.00, cat: '关怀', wish: '抱一下，隔着世界也抱得到' },
{ id: 'g_kiss', name: '亲亲', emoji: '😘', price: 0.00, cat: '关怀', wish: '亲一下，不许躲' },
{ id: 'g_night', name: '晚安', emoji: '🛌', price: 0.00, cat: '关怀', wish: '替你盖好被子了' },
{ id: 'g_soup', name: '一碗热汤', emoji: '🍲', price: 22.00, cat: '关怀', wish: '天冷，先喝口热的' },
{ id: 'g_letter', name: '一封信', emoji: '✉️', price: 0.00, cat: '关怀', wish: '话放信里了，慢慢看' },
{ id: 'g_couplecup', name: '情侣杯', emoji: '🥂', price: 39.00, cat: '情侣用品', wish: '一对杯子，早上的第一杯给你' },
{ id: 'g_couplewear', name: '情侣装', emoji: '👕', price: 188.00, cat: '情侣用品', wish: '穿一样的出门，别人就知道你是我的' },
{ id: 'g_lock', name: '同心锁', emoji: '🔒', price: 66.00, cat: '情侣用品', wish: '锁在一起，钥匙我扔了' },
{ id: 'g_couavatar', name: '情侣头像', emoji: '🖼️', price: 0.00, cat: '情侣用品', wish: '换上，让所有人都知道' },
{ id: 'g_coudiary', name: '情侣日记', emoji: '📓', price: 28.00, cat: '情侣用品', wish: '一本日记，两个人一起写' },
{ id: 'g_couframe', name: '情侣相框', emoji: '🏞️', price: 18.00, cat: '情侣用品', wish: '把我们的合照放进去' },
{ id: 'g_cousong', name: '情侣歌单', emoji: '🎵', price: 0.00, cat: '情侣用品', wish: '我们一起听的歌，都在这里' },
{ id: 'g_coucoin', name: '纪念币', emoji: '🪙', price: 88.00, cat: '情侣用品', wish: '只属于我们两个的' },
{ id: 'g_towel', name: '毛巾', emoji: '🧖', price: 25.00, cat: '日常用品', wish: '擦干头发，别着凉' },
{ id: 'g_mug', name: '马克杯', emoji: '🥤', price: 35.00, cat: '日常用品', wish: '每天用这个喝水，像我在旁边' },
{ id: 'g_umbrella', name: '雨伞', emoji: '☂️', price: 45.00, cat: '日常用品', wish: '下雨天，我替你撑' },
{ id: 'g_pillow', name: '抱枕', emoji: '🛏️', price: 68.00, cat: '日常用品', wish: '抱着它，像抱着我' },
{ id: 'g_warmer', name: '暖手宝', emoji: '🔥', price: 49.00, cat: '日常用品', wish: '手冷就捂一下' },
{ id: 'g_earphone', name: '耳机', emoji: '🎧', price: 159.00, cat: '日常用品', wish: '一人一只，听同一首歌' },
{ id: 'g_notebook', name: '笔记本', emoji: '📔', price: 22.00, cat: '日常用品', wish: '记下想跟你说的话' },
{ id: 'g_keychain', name: '钥匙扣', emoji: '🗝️', price: 12.00, cat: '日常用品', wish: '开门的时候想到我' },
{ id: 'g_lamp', name: '小夜灯', emoji: '💡', price: 89.00, cat: '日常用品', wish: '给你留一盏灯' },
{ id: 'g_candle', name: '香薰', emoji: '🕯️', price: 39.00, cat: '日常用品', wish: '闻着它，放松一下' },
{ id: 'g_hotpot', name: '小火锅', emoji: '🥘', price: 128.00, cat: '美食', wish: '围着一口锅，把冬天涮热' },
{ id: 'g_sushi', name: '寿司', emoji: '🍣', price: 66.00, cat: '美食', wish: '一口一个，都是想你的形状' },
{ id: 'g_noodle', name: '长寿面', emoji: '🍜', price: 13.14, cat: '美食', wish: '一根面到底，长长久久' },
{ id: 'g_bbq', name: '烧烤', emoji: '🍢', price: 88.00, cat: '美食', wish: '烟火气里，坐我旁边' },
{ id: 'g_bfast', name: '元气早餐', emoji: '🍳', price: 15.00, cat: '美食', wish: '煎蛋圆圆的，像我的心' },
{ id: 'g_juice', name: '果汁', emoji: '🧃', price: 9.90, cat: '饮品', wish: '维C给你，甜我尝一口就好' },
{ id: 'g_chestnut', name: '糖炒栗子', emoji: '🌰', price: 16.80, cat: '美食', wish: '剥好的，第一颗给你' },
{ id: 'g_potato', name: '烤红薯', emoji: '🍠', price: 8.80, cat: '美食', wish: '冬天手里的第一口暖' },
{ id: 'g_popcorn', name: '爆米花', emoji: '🍿', price: 12.00, cat: '美食', wish: '看电影的标配，配你更好' },
{ id: 'g_train', name: '车票', emoji: '🚄', price: 66.60, cat: '出行', wish: '下一站，去见你' },
{ id: 'g_plane', name: '机票', emoji: '✈️', price: 1314.00, cat: '出行', wish: '攒够思念，就飞过去' },
{ id: 'g_camp', name: '露营', emoji: '⛺', price: 199.00, cat: '出行', wish: '星星当被子，你当枕头' },
{ id: 'g_beach', name: '海边', emoji: '🏖️', price: 520.00, cat: '出行', wish: '浪打过来的时候，我先想到你' },
{ id: 'g_spring', name: '温泉', emoji: '♨️', price: 158.00, cat: '出行', wish: '泡走疲惫，只剩想你' },
{ id: 'g_route', name: '旅行攻略', emoji: '🗺️', price: 0.00, cat: '出行', wish: '路线排好了，你人到场就行' },
{ id: 'g_movie', name: '电影票', emoji: '🎬', price: 39.90, cat: '娱乐', wish: '靠肩膀的位置，我买好了' },
{ id: 'g_concert', name: '演唱会', emoji: '🎤', price: 1314.00, cat: '娱乐', wish: '合唱那首歌时，你要看我' },
{ id: 'g_ferris', name: '游乐园', emoji: '🎡', price: 131.40, cat: '娱乐', wish: '摩天轮到最高点，我要亲你' },
{ id: 'g_claw', name: '抓娃娃', emoji: '🕹️', price: 20.00, cat: '娱乐', wish: '抓不到你，抓个替身也行' },
{ id: 'g_ktv', name: 'K歌', emoji: '🎙️', price: 66.60, cat: '娱乐', wish: '情歌都唱给你，跑调也归你' },
{ id: 'g_icecream', name: '冰淇淋', emoji: '🍦', price: 9.90, cat: '甜品', wish: '甜筒分你一半，第一口给你' },
{ id: 'g_pudding', name: '布丁', emoji: '🍮', price: 12.90, cat: '甜品', wish: 'Duang 一下，甜到心里' },
{ id: 'g_crown', name: '王冠', emoji: '👑', price: 5200.00, cat: '饰品', wish: '你是我一个人的女王' },
{ id: 'g_snow', name: '初雪', emoji: '🌨️', price: 0.00, cat: '星空', wish: '落下的时候，第一个告诉你' },
{ id: 'g_sunset', name: '晚霞', emoji: '🌇', price: 0.00, cat: '星空', wish: '下班路上拍的，全部送你' },
{ id: 'g_breeze', name: '春风', emoji: '🍃', price: 0.00, cat: '星空', wish: '路过你窗前，替我抱抱你' },
{ id: 'g_wave', name: '海浪', emoji: '🌊', price: 6.66, cat: '星空', wish: '把海的声音装瓶寄给你' },
{ id: 'g_milk', name: '热牛奶', emoji: '🥛', price: 5.00, cat: '饮品', wish: '睡前喝掉，梦里也是暖的' },
{ id: 'g_massage', name: '揉揉肩', emoji: '💆', price: 0.00, cat: '关怀', wish: '今天辛苦了，肩膀交给我' },
{ id: 'g_wakeup', name: '叫早服务', emoji: '⏰', price: 0.00, cat: '关怀', wish: '明天七点，用声音叫你起床' },
{ id: 'g_watchtogether', name: '陪你看剧', emoji: '📺', price: 0.00, cat: '关怀', wish: '剧我追好了，就差你' },
{ id: 'g_couplewatch', name: '情侣表', emoji: '⌚', price: 999.99, cat: '情侣用品', wish: '时间对齐，分秒都在想你' },
{ id: 'g_coupleshoes', name: '情侣鞋', emoji: '👟', price: 219.00, cat: '情侣用品', wish: '走一样的步伐，别人就知道' },
{ id: 'g_scarf', name: '围巾', emoji: '🧣', price: 79.00, cat: '日常用品', wish: '绕两圈，把冬天挡在外面' },
{ id: 'g_socks', name: '袜子', emoji: '🧦', price: 19.90, cat: '日常用品', wish: '脚暖了，全身都是暖的' },
{ id: 'g_slipper', name: '棉拖鞋', emoji: '🩴', price: 29.90, cat: '日常用品', wish: '进家门第一步，像踩在云上' },
{ id: 'g_card', name: '手写字卡', emoji: '🎴', price: 1.30, cat: '两个世界', wish: '每个字都挑过了，抽中哪张都是我想说的' },
{ id: 'g_blindbox', name: '字卡盲盒', emoji: '🎰', price: 5.20, cat: '两个世界', wish: '系统乱出的也算，都是想跟你说的话' },
{ id: 'g_stickers', name: '表情包补给', emoji: '😺', price: 0.00, cat: '两个世界', wish: '图库翻到底，每张都想发给你' },
{ id: 'g_wordsbag', name: '千言锦囊', emoji: '🪅', price: 77.77, cat: '两个世界', wish: '几百句想说的话，慢慢拆给你' },
{ id: 'g_nearby', name: '身边坐标', emoji: '📍', price: 0.00, cat: '两个世界', wish: '今晚也在你左手边的位置' },
{ id: 'g_hands', name: '隔空牵手', emoji: '🤲', price: 0.00, cat: '两个世界', wish: '手伸过来，我一直都在' },
{ id: 'g_patpat', name: '摸摸头', emoji: '👋', price: 0.00, cat: '两个世界', wish: '感觉到没？刚才是我的手' },
{ id: 'g_unseen', name: '看不见的抱抱', emoji: '🫂', price: 0.00, cat: '两个世界', wish: '看不见也没关系，你抱得到我' },
{ id: 'g_heartlink', name: '心跳感应', emoji: '💗', price: 0.00, cat: '两个世界', wish: '突然扑通一下，就知道你在想我' },
{ id: 'g_amulet', name: '平安符', emoji: '🧿', price: 16.00, cat: '两个世界', wish: '我的名字在里面，替我陪着你' },
{ id: 'g_courier', name: '跨界快递', emoji: '📨', price: 8.00, cat: '两个世界', wish: '穿过两个世界，慢一点但一定到' },
{ id: 'g_dreammeet', name: '同一场梦', emoji: '💤', price: 13.14, cat: '两个世界', wish: '今晚梦里见，老地方等你' },
{ id: 'g_moonmeet', name: '同时看月亮', emoji: '🌜', price: 0.00, cat: '两个世界', wish: '九点一起抬头，就算见过面了' },
{ id: 'g_bridge', name: '世界之桥', emoji: '🌉', price: 66.00, cat: '两个世界', wish: '这座桥常开着，想来就来见你' },
{ id: 'g_daisy', name: '小雏菊', emoji: '🌼', price: 12.00, cat: '花束', wish: '不起眼的花，送最重要的人' },
{ id: 'g_cookie', name: '手工曲奇', emoji: '🍪', price: 22.00, cat: '甜品', wish: '烤得有点歪，心意很正' },
{ id: 'g_oden', name: '关东煮', emoji: '🍥', price: 18.00, cat: '美食', wish: '便利店的热气，分你一半' },
{ id: 'g_tanghulu', name: '糖葫芦', emoji: '🍡', price: 6.00, cat: '美食', wish: '酸酸甜甜，咬一口想到你' },
{ id: 'g_starear', name: '星星耳钉', emoji: '✨', price: 45.00, cat: '饰品', wish: '耳朵上有星，晃一下亮一下' },
{ id: 'g_picnic', name: '野餐垫', emoji: '🧺', price: 55.00, cat: '出行', wish: '草地、面包和你，齐了' },
{ id: 'g_nightmarket', name: '夜市漫步', emoji: '🏮', price: 30.00, cat: '出行', wish: '从头吃到尾，牵着走' },
{ id: 'g_boardgame', name: '桌游之夜', emoji: '🎲', price: 45.00, cat: '娱乐', wish: '两个人也能玩，输的洗碗' },
{ id: 'g_telescope', name: '天文馆约会', emoji: '🔭', price: 80.00, cat: '娱乐', wish: '假装星星很近，我们更近' },
{ id: 'g_walk', name: '陪你散步', emoji: '🚶', price: 0.00, cat: '关怀', wish: '饭后走一走，牵手那种' },
{ id: 'g_lullaby', name: '哄睡电台', emoji: '🎶', price: 0.00, cat: '关怀', wish: '念到你睡着为止' },
{ id: 'g_eyemask', name: '蒸汽眼罩', emoji: '😌', price: 12.90, cat: '日常用品', wish: '戴上睡个好觉，梦里我来找你' },
{ id: 'g_lipbalm', name: '润唇膏', emoji: '💄', price: 25.00, cat: '美妆个护', wish: '嘴唇干干的，怎么亲嘛' },
{ id: 'g_thermos', name: '保温杯', emoji: '🍵', price: 39.00, cat: '日常用品', wish: '装上热水，胃暖了心就稳' },
{ id: 'g_plant', name: '小绿植', emoji: '🪴', price: 32.00, cat: '日常用品', wish: '养着它，像我们养这段日子' },
{ id: 'g_handcream', name: '护手霜', emoji: '🧴', price: 29.90, cat: '美妆个护', wish: '手好好养着，牵起来才舒服' },
{ id: 'g_soap', name: '香皂', emoji: '🧼', price: 12.00, cat: '美妆个护', wish: '洗手的时候，顺便想想我' },
{ id: 'g_wipes', name: '柔软纸巾', emoji: '🧻', price: 8.80, cat: '日常用品', wish: '鼻子娇气的人，正好用得上' },
{ id: 'g_bandaid', name: '创可贴', emoji: '🩹', price: 5.00, cat: '药品医护', wish: '磕磕碰碰的，有我呢' },
{ id: 'g_mask', name: '口罩', emoji: '😷', price: 9.90, cat: '药品医护', wish: '人多的地方，戴好再出门' },
{ id: 'g_powerbank', name: '充电宝', emoji: '🔋', price: 59.00, cat: '日常用品', wish: '随时满格，不怕联系不上我' },
{ id: 'g_cable', name: '数据线', emoji: '⚡', price: 19.90, cat: '日常用品', wish: '新的给你，别再将就用旧的' },
{ id: 'g_canvasbag', name: '帆布包', emoji: '👜', price: 49.00, cat: '日常用品', wish: '能装下零食，也装下好心情' },
{ id: 'g_hat', name: '遮阳帽', emoji: '👒', price: 39.00, cat: '日常用品', wish: '太阳再大，也晒不到你' },
{ id: 'g_gloves', name: '手套', emoji: '🧤', price: 25.00, cat: '日常用品', wish: '骑车路上，别冻着手' },
{ id: 'g_calendar', name: '台历', emoji: '📅', price: 18.00, cat: '日常用品', wish: '一天撕一页，页页都是你' },
{ id: 'g_bear', name: '玩偶熊', emoji: '🧸', price: 69.00, cat: '日常用品', wish: '我不在的时候，它替我值班' },
{ id: 'g_humid', name: '加湿器', emoji: '💧', price: 99.00, cat: '日常用品', wish: '屋里润一点，嗓子舒服一点' },
{ id: 'g_lunchbox', name: '保温饭盒', emoji: '🍱', price: 79.00, cat: '日常用品', wish: '中午也要吃口热乎的' },
{ id: 'g_pill', name: '感冒药', emoji: '💊', price: 22.00, cat: '药品医护', wish: '抽屉里备着，用不上最好' },
{ id: 'g_phonestand', name: '手机支架', emoji: '📱', price: 25.00, cat: '日常用品', wish: '追剧空出来的手，用来牵我' },
{ id: 'g_thermo', name: '体温计', emoji: '🌡️', price: 12.00, cat: '药品医护', wish: '不舒服先量一量，别硬扛' },
{ id: 'g_clipper', name: '指甲刀', emoji: '✂️', price: 9.90, cat: '日常用品', wish: '指甲勤剪，细节要干净' },
{ id: 'g_storage', name: '收纳箱', emoji: '📦', price: 35.00, cat: '日常用品', wish: '杂物收整齐，房间清爽' },
{ id: 'g_luggage', name: '行李箱', emoji: '🧳', price: 199.00, cat: '日常用品', wish: '想去哪，拉上就走' },
{ id: 'g_backpack', name: '双肩包', emoji: '🎒', price: 89.00, cat: '日常用品', wish: '装上水和零食就出发' },
{ id: 'g_glasses', name: '眼镜', emoji: '👓', price: 99.00, cat: '日常用品', wish: '看得清楚，日子也清楚' },
{ id: 'g_vase', name: '花瓶', emoji: '🏺', price: 42.00, cat: '日常用品', wish: '下次送的花，就有地方放了' },
{ id: 'g_chopsticks', name: '碗筷套装', emoji: '🥢', price: 36.00, cat: '日常用品', wish: '好好吃饭，不许糊弄' },
{ id: 'g_pen', name: '中性笔', emoji: '🖊️', price: 6.60, cat: '日常用品', wish: '写字的时候，想着点我' },
{ id: 'g_stickynote', name: '便利贴', emoji: '📝', price: 8.00, cat: '日常用品', wish: '想到什么，随手写给我' },
{ id: 'g_powerstrip', name: '插线板', emoji: '🔌', price: 39.00, cat: '日常用品', wish: '插座够用，手机随时满电' },
{ id: 'g_wallet', name: '钱包', emoji: '👛', price: 79.00, cat: '日常用品', wish: '钱和卡放好，出门不慌' },
{ id: 'g_cap', name: '棒球帽', emoji: '🧢', price: 45.00, cat: '日常用品', wish: '压住乱发，也挡住太阳' },
{ id: 'g_hairtie', name: '头绳', emoji: '➰', price: 6.60, cat: '日常用品', wish: '吃饭前扎起来，乖乖的' },
{ id: 'g_fan', name: '小风扇', emoji: '🌀', price: 49.00, cat: '日常用品', wish: '夏天随身带的风' },
{ id: 'g_mousepad', name: '鼠标垫', emoji: '🖱️', price: 22.00, cat: '日常用品', wish: '手腕底下垫着，舒服一点' },
{ id: 'g_burger', name: '汉堡', emoji: '🍔', price: 16.00, cat: '美食', wish: '偶尔放纵一下，这顿我请' },
{ id: 'g_pizza', name: '披萨', emoji: '🍕', price: 49.00, cat: '美食', wish: '最中间那块，永远留给你' },
{ id: 'g_friedchicken', name: '炸鸡', emoji: '🍗', price: 33.00, cat: '美食', wish: '趁热吃，凉了就不脆了' },
{ id: 'g_riceball', name: '饭团', emoji: '🍙', price: 7.00, cat: '美食', wish: '偷偷捏成了心的形状' },
{ id: 'g_dumplings', name: '蒸饺', emoji: '🥟', price: 18.00, cat: '美食', wish: '一口一个，都是热乎的' },
{ id: 'g_crayfish', name: '小龙虾', emoji: '🦀', price: 88.00, cat: '美食', wish: '夏天的夜宵，必须有它' },
{ id: 'g_honey', name: '蜂蜜', emoji: '🍯', price: 32.00, cat: '美食', wish: '日子苦的时候，舀一勺' },
{ id: 'g_donut', name: '甜甜圈', emoji: '🍩', price: 9.90, cat: '甜品', wish: '圆圆的一个，圈住你' },
{ id: 'g_pancake', name: '松饼', emoji: '🥞', price: 22.00, cat: '甜品', wish: '叠得高高的，甜也加倍' },
{ id: 'g_layerscake', name: '千层', emoji: '🍰', price: 45.00, cat: '甜品', wish: '一层一层，全是甜' },
{ id: 'g_sunrise', name: '看日出', emoji: '🌅', price: 0.00, cat: '出行', wish: '今晚早点睡，明早我叫你' },
{ id: 'g_cycling', name: '骑行兜风', emoji: '🚲', price: 0.00, cat: '出行', wish: '后座坐好，马上出发' },
{ id: 'g_roadtrip', name: '自驾游', emoji: '🚗', price: 150.00, cat: '出行', wish: '方向盘归你，选歌权归我' },
{ id: 'g_pottery', name: '陶艺体验', emoji: '🎨', price: 99.00, cat: '娱乐', wish: '捏两个歪歪的杯子，正好一对' },
{ id: 'g_puzzle', name: '拼图', emoji: '🧩', price: 39.00, cat: '娱乐', wish: '拼好裱起来，挂我们房间' },
{ id: 'g_gamenight', name: '双人游戏夜', emoji: '🎮', price: 0.00, cat: '娱乐', wish: '输的洗碗，赢的点奶茶' },
{ id: 'g_listen', name: '听你吐槽', emoji: '👂', price: 0.00, cat: '关怀', wish: '说吧，我今天特别有空' },
{ id: 'g_photoshoot', name: '陪你拍照', emoji: '📸', price: 0.00, cat: '关怀', wish: '今天的你也好看，必须记录' },
{ id: 'g_bathbomb', name: '泡澡球', emoji: '🛁', price: 18.00, cat: '日常用品', wish: '泡二十分钟，累就化掉啦' },
{ id: 'g_icecube', name: '冰格', emoji: '🧊', price: 9.00, cat: '日常用品', wish: '可乐加冰，才叫夏天' },
{ id: 'g_flashlight', name: '小手电', emoji: '🔦', price: 15.00, cat: '日常用品', wish: '晚上找东西，不用摸黑' },
{ id: 'g_cardholder', name: '卡包', emoji: '💳', price: 29.00, cat: '日常用品', wish: '和钱包放一起，别丢三落四' },
{ id: 'g_planet', name: '土星', emoji: '🪐', price: 77.00, cat: '星空', wish: '带光环的那一颗，送你' },
{ id: 'g_comet', name: '彗星', emoji: '☄️', price: 66.60, cat: '星空', wish: '绕一大圈，还是会来找你' },
{ id: 'g_curry', name: '咖喱饭', emoji: '🍛', price: 26.00, cat: '美食', wish: '今天也要好好吃饭' },
{ id: 'g_friedshrimp', name: '炸虾', emoji: '🍤', price: 26.00, cat: '美食', wish: '金黄酥脆，第一口给你' },
{ id: 'g_sandwich', name: '三明治', emoji: '🥪', price: 14.00, cat: '美食', wish: '多睡十分钟，早餐我包了' },
{ id: 'g_fries', name: '薯条', emoji: '🍟', price: 11.00, cat: '美食', wish: '番茄酱分你一半' },
{ id: 'g_coconut', name: '椰子', emoji: '🥥', price: 15.00, cat: '饮品', wish: '插上吸管，假装在海边' },
{ id: 'g_fortune', name: '签语饼', emoji: '🥠', price: 9.00, cat: '美食', wish: '掰开，里面藏了一句想你' },
{ id: 'g_cupcake', name: '纸杯蛋糕', emoji: '🧁', price: 14.50, cat: '甜品', wish: '小小一个，甜得很具体' },
{ id: 'g_lollipop', name: '波板糖', emoji: '🍭', price: 8.00, cat: '甜品', wish: '甜得直白，不绕弯子' },
{ id: 'g_sundae', name: '圣代', emoji: '🍨', price: 13.00, cat: '甜品', wish: '第一口给你，樱桃也给你' },
{ id: 'g_cactus', name: '仙人掌', emoji: '🌵', price: 15.00, cat: '花束', wish: '好养活，像我一样赖着你' },
{ id: 'g_clover', name: '四叶草', emoji: '🍀', price: 6.60, cat: '花束', wish: '攒到的运气，全都给你' },
{ id: 'g_earth', name: '地球', emoji: '🌏', price: 1.00, cat: '星空', wish: '在同一个星球上，已经够近了' },
{ id: 'g_trainslow', name: '绿皮火车', emoji: '🚂', price: 45.00, cat: '出行', wish: '慢车慢慢开，风景慢慢看' },
{ id: 'g_island', name: '海岛度假', emoji: '🏝️', price: 520.00, cat: '出行', wish: '手机一关，世界只剩我们' },
{ id: 'g_hike', name: '登山', emoji: '⛰️', price: 0.00, cat: '出行', wish: '到山顶了，风替我抱你' },
{ id: 'g_supermarket', name: '逛超市之约', emoji: '🛒', price: 0.00, cat: '出行', wish: '零食区先逛，最后再结账' },
{ id: 'g_darts', name: '飞镖', emoji: '🎯', price: 25.00, cat: '娱乐', wish: '瞄得很准，第一眼就选中你' },
{ id: 'g_musicfestival', name: '音乐节', emoji: '🎟️', price: 199.00, cat: '娱乐', wish: '草坪、日落和音乐，都带上你' },
{ id: 'g_bowling', name: '保龄球', emoji: '🎳', price: 38.00, cat: '娱乐', wish: '打出全倒，要跟我击掌' },
{ id: 'g_cheer', name: '加油打气', emoji: '💪', price: 0.00, cat: '关怀', wish: '你可以的，我全程都在' },
{ id: 'g_nightcall', name: '睡前电话', emoji: '☎️', price: 0.00, cat: '关怀', wish: '响三声，就是我想你了' },
{ id: 'g_lovejournal', name: '情侣手账', emoji: '💌', price: 35.00, cat: '情侣用品', wish: '两个人的小事，都贴进去' },
{ id: 'g_pendant', name: '情侣挂件', emoji: '🐥', price: 26.00, cat: '情侣用品', wish: '一只挂你那，一只挂我这' },
{ id: 'g_sponge', name: '海绵擦', emoji: '🧽', price: 6.00, cat: '日常用品', wish: '碗筷洗干净，吃饭才香' },
{ id: 'g_pasta', name: '意面', emoji: '🍝', price: 38.00, cat: '美食', wish: '卷一大叉子，喂你' },
{ id: 'g_wrap', name: '卷饼', emoji: '🌯', price: 13.00, cat: '美食', wish: '料塞得满满的，管饱' },
{ id: 'g_salad', name: '沙拉', emoji: '🥗', price: 28.00, cat: '美食', wish: '吃草也要开开心心的' },
{ id: 'g_pretzel', name: '碱水结', emoji: '🥨', price: 10.00, cat: '美食', wish: '拧成结的小想念' },
{ id: 'g_mooncake', name: '月饼', emoji: '🥮', price: 12.00, cat: '节日节令', wish: '中秋那一口，提前补给你' },
{ id: 'g_beads', name: '手串', emoji: '📿', price: 39.00, cat: '饰品', wish: '一颗一颗，都数成平安' },
{ id: 'g_sunglasses', name: '太阳镜', emoji: '🕶️', price: 79.00, cat: '饰品', wish: '防晒防眩光，酷是附赠的' },
{ id: 'g_crystal', name: '水晶手链', emoji: '🔮', price: 55.00, cat: '饰品', wish: '粉水晶，招桃花的那种' },
{ id: 'g_shinystar', name: '亮星', emoji: '🌟', price: 3.00, cat: '星空', wish: '比旁边的星星更亮一点' },
{ id: 'g_partlycloudy', name: '多云转晴', emoji: '⛅', price: 0.00, cat: '星空', wish: '天会晴的，我一直在' },
{ id: 'g_rollercoaster', name: '过山车', emoji: '🎢', price: 35.00, cat: '出行', wish: '尖叫可以，手别松开' },
{ id: 'g_sailboat', name: '帆船出海', emoji: '⛵', price: 158.00, cat: '出行', wish: '风往哪吹，我们去哪' },
{ id: 'g_rowboat', name: '划船', emoji: '🛶', price: 30.00, cat: '出行', wish: '划到湖心，只准看我' },
{ id: 'g_taxi', name: '打车回家', emoji: '🚕', price: 25.00, cat: '出行', wish: '太晚就打车，车费我出' },
{ id: 'g_carousel', name: '旋转木马', emoji: '🎠', price: 20.00, cat: '娱乐', wish: '每转一圈，偷看你一眼' },
{ id: 'g_theater', name: '话剧之夜', emoji: '🎭', price: 120.00, cat: '娱乐', wish: '灯暗之前，牵好我的手' },
{ id: 'g_homecook', name: '做饭给你吃', emoji: '🧑‍🍳', price: 0.00, cat: '关怀', wish: '今天我下厨，翻车也好吃' },
{ id: 'g_windchime', name: '风铃', emoji: '🎐', price: 22.00, cat: '关怀', wish: '挂在窗边，风一响就想我' },
{ id: 'g_contract', name: '恋爱合约', emoji: '📜', price: 52.00, cat: '情侣用品', wish: '条款只有一条：互相喜欢' },
{ id: 'g_coat', name: '外套', emoji: '🧥', price: 159.00, cat: '日常用品', wish: '变天之前，先备上' },
{ id: 'g_dress', name: '连衣裙', emoji: '👗', price: 139.00, cat: '日常用品', wish: '穿上了，转个圈给我看' },
{ id: 'g_pencil', name: '铅笔套装', emoji: '✏️', price: 9.00, cat: '日常用品', wish: '写错了能擦，没关系的' },
{ id: 'g_bookmark', name: '书签', emoji: '🔖', price: 9.00, cat: '日常用品', wish: '读到哪页，就停在哪页' },
{ id: 'g_compass', name: '指南针', emoji: '🧭', price: 28.00, cat: '日常用品', wish: '迷路的话，朝我心跳方向走' },
{ id: 'g_couchblanket', name: '沙发盖毯', emoji: '🛋️', price: 79.00, cat: '日常用品', wish: '窝进沙发，也有暖和的一角' },
{ id: 'g_watermelon', name: '西瓜', emoji: '🍉', price: 22.00, cat: '美食', wish: '最中间那勺，挖好给你' },
{ id: 'g_lemon', name: '柠檬', emoji: '🍋', price: 9.00, cat: '美食', wish: '切片泡水，酸口也清爽' },
{ id: 'g_corn', name: '玉米', emoji: '🌽', price: 7.00, cat: '美食', wish: '路边摊那种，烫手的甜' },
{ id: 'g_tomato', name: '番茄', emoji: '🍅', price: 8.00, cat: '美食', wish: '糖拌的，是夏天的味道' },
{ id: 'g_peanut', name: '花生', emoji: '🥜', price: 8.00, cat: '美食', wish: '剥好一小堆，边看剧边吃' },
{ id: 'g_grape', name: '葡萄', emoji: '🍇', price: 18.00, cat: '甜品', wish: '一串里最甜的几颗，都给你' },
{ id: 'g_mango', name: '芒果', emoji: '🥭', price: 16.00, cat: '甜品', wish: '芒果味的夏天，先到为敬' },
{ id: 'g_brooch', name: '胸针', emoji: '🏵️', price: 48.00, cat: '饰品', wish: '别在胸口，离心脏最近的位置' },
{ id: 'g_rocket', name: '火箭', emoji: '🚀', price: 88.00, cat: '星空', wish: '想去多远都可以，落点是我这' },
{ id: 'g_ufo', name: '飞碟', emoji: '🛸', price: 66.00, cat: '星空', wish: '开这个来见你，比较快' },
{ id: 'g_starface', name: '星星眼', emoji: '💫', price: 5.00, cat: '星空', wish: '看到你就冒星星，是真的' },
{ id: 'g_kite', name: '风筝', emoji: '🪁', price: 25.00, cat: '出行', wish: '线在你手里，我跟着风跑' },
{ id: 'g_heli', name: '直升机观光', emoji: '🚁', price: 1314.00, cat: '出行', wish: '换个角度，看看我们住的城市' },
{ id: 'g_cruise', name: '游轮之夜', emoji: '🛳️', price: 888.88, cat: '出行', wish: '甲板的晚风，两个人分' },
{ id: 'g_pingpong', name: '乒乓球', emoji: '🏓', price: 20.00, cat: '娱乐', wish: '输一局亲一口，你稳赢' },
{ id: 'g_badminton', name: '羽毛球', emoji: '🏸', price: 25.00, cat: '娱乐', wish: '傍晚打一场，赢的选宵夜' },
{ id: 'g_fishing', name: '钓鱼', emoji: '🎣', price: 40.00, cat: '娱乐', wish: '钓不钓得到不重要，坐一下午' },
{ id: 'g_skating', name: '旱冰场', emoji: '🛼', price: 30.00, cat: '娱乐', wish: '摔了我扶着，想笑也行' },
{ id: 'g_piano', name: '电子琴', emoji: '🎹', price: 199.00, cat: '娱乐', wish: '学会第一首曲子，弹给你听' },
{ id: 'g_balloon', name: '气球', emoji: '🎈', price: 5.00, cat: '关怀', wish: '牵好了，飞了我帮你抓' },
{ id: 'g_camera', name: '相机', emoji: '📷', price: 334.40, cat: '日常用品', wish: '以后的日子，都用它记下来' },
{ id: 'g_radio', name: '收音机', emoji: '📻', price: 99.00, cat: '日常用品', wish: '老歌电台，配晚饭刚刚好' },
{ id: 'g_mirror', name: '梳妆镜', emoji: '🪞', price: 45.00, cat: '日常用品', wish: '出门前看一眼，今天也很美' },
{ id: 'g_sweater', name: '毛衣', emoji: '🧶', price: 129.00, cat: '日常用品', wish: '织得慢，但暖得很久' },
{ id: 'g_bathset', name: '洗浴套装', emoji: '🛀', price: 49.00, cat: '美妆个护', wish: '从头发到脚趾，都香香的' },
{ id: 'g_mosquito', name: '驱蚊套装', emoji: '🦟', price: 19.00, cat: '日常用品', wish: '夏天睡整觉，不被嗡嗡吵' },
{ id: 'g_keyboard', name: '机械键盘', emoji: '⌨️', price: 129.00, cat: '日常用品', wish: '打字再忙，也要记得回我' },
{ id: 'g_books', name: '一套好书', emoji: '📚', price: 89.00, cat: '日常用品', wish: '睡前读几页，我藏在故事里' },
{ id: 'g_speaker', name: '蓝牙音箱', emoji: '🔊', price: 139.00, cat: '日常用品', wish: '歌单一放，房间就不冷清了' },
{ id: 'g_oatmeal', name: '麦片早餐碗', emoji: '🥣', price: 39.00, cat: '日常用品', wish: '早上第一件事，是喂饱自己' },
{ id: 'g_cushion', name: '软坐垫', emoji: '🪑', price: 33.00, cat: '日常用品', wish: '久坐的日子，也要舒服一点' },
{ id: 'g_wallclock', name: '挂钟', emoji: '🕐', price: 69.00, cat: '日常用品', wish: '抬头看时间时，顺便想我一下' },
{ id: 'g_foodbox', name: '保鲜盒', emoji: '🥡', price: 29.00, cat: '日常用品', wish: '吃不完的留好，下一顿继续' },
{ id: 'g_bunny', name: '玩偶兔', emoji: '🐰', price: 59.00, cat: '日常用品', wish: '和玩偶熊凑一对，替我们值班' },
{ id: 'g_teapot', name: '一壶茶', emoji: '🫖', price: 88.00, cat: '饮品', wish: '周末下午，泡一壶慢慢喝' },
{ id: 'g_yogamat', name: '瑜伽垫', emoji: '🧘', price: 69.00, cat: '日常用品', wish: '铺开是健身房，卷起来是家' },
{ id: 'g_dumbbell', name: '小哑铃', emoji: '🏋️', price: 59.00, cat: '日常用品', wish: '举两下就算练过，我不笑话你' },
{ id: 'g_sewing', name: '缝补小盒', emoji: '🪡', price: 16.00, cat: '日常用品', wish: '扣子松了别将就，随时缝上' },
{ id: 'g_snackbox', name: '零食大礼包', emoji: '🎁', price: 66.00, cat: '日常用品', wish: '拆开全是小快乐' },
{ id: 'g_sachet', name: '助眠香囊', emoji: '🌾', price: 23.00, cat: '日常用品', wish: '放在枕头边，梦都会变软' },
{ id: 'g_fireworks', name: '烟花', emoji: '🎆', price: 99.99, cat: '娱乐', wish: '放给你看的那种，一整场' },
{ id: 'g_billiards', name: '台球', emoji: '🎱', price: 30.00, cat: '娱乐', wish: '我教你，赢了就算你的' },
{ id: 'g_yoyo', name: '悠悠球', emoji: '🪀', price: 15.00, cat: '娱乐', wish: '小时候没玩够，现在补上' },
{ id: 'g_watercolor', name: '水彩颜料', emoji: '🖌️', price: 45.00, cat: '娱乐', wish: '画我的时候，手下留情' },
{ id: 'g_guitar', name: '吉他', emoji: '🎸', price: 299.00, cat: '娱乐', wish: '抱着它唱情歌，跑调也甜' },
{ id: 'g_archery', name: '射箭体验', emoji: '🏹', price: 60.00, cat: '娱乐', wish: '瞄准了再放手，先射中我心' },
{ id: 'g_iceskate', name: '滑冰场', emoji: '⛸️', price: 35.00, cat: '娱乐', wish: '冬天限定，牵着手慢慢滑' },
{ id: 'g_sparkler', name: '仙女棒', emoji: '🎇', price: 15.00, cat: '星空', wish: '点一根举高，许个小小的愿' },
{ id: 'g_wishbamboo', name: '许愿竹', emoji: '🎋', price: 18.00, cat: '星空', wish: '愿望写好了，挂在最高处' },
{ id: 'g_magicwand', name: '魔法棒', emoji: '🪄', price: 33.00, cat: '星空', wish: '挥一下，烦恼统统消失' },
{ id: 'g_surf', name: '冲浪体验', emoji: '🏄', price: 120.00, cat: '出行', wish: '摔进海里，也算拥抱大海' },
{ id: 'g_snorkel', name: '浮潜体验', emoji: '🤿', price: 150.00, cat: '出行', wish: '海底世界很好，回来讲给你听' },
{ id: 'g_fridgemagnet', name: '情侣冰箱贴', emoji: '🧲', price: 19.00, cat: '情侣用品', wish: '一对吸在一起，谁也分不开' },
{ id: 'g_bellservice', name: '家庭服务铃', emoji: '🛎️', price: 20.00, cat: '日常用品', wish: '按一下，我立刻就到' },
{ id: 'g_projector', name: '投影仪', emoji: '📽️', price: 299.00, cat: '日常用品', wish: '客厅变小影院，只放我们爱看的' },
{ id: 'g_fountainpen', name: '钢笔', emoji: '🖋️', price: 88.00, cat: '日常用品', wish: '认真写字的人，最好看了' },
{ id: 'g_partypopper', name: '礼花筒', emoji: '🎉', price: 12.00, cat: '关怀', wish: '值得庆祝的日子，还有很多' },
{ id: 'g_specialdrink', name: '无酒精特调', emoji: '🍹', price: 28.00, cat: '饮品', wish: '举杯！敬今天也黏在一起' },
{ id: 'g_sourplum', name: '酸梅汤', emoji: '🍶', price: 8.00, cat: '饮品', wish: '冰镇过的，夏天就服它' },
{ id: 'g_bubbly', name: '气泡饮', emoji: '🍾', price: 45.00, cat: '饮品', wish: '碰一杯，庆祝我们今天也很甜' },
{ id: 'g_orange', name: '橘子', emoji: '🍊', price: 10.00, cat: '美食', wish: '剥好的，摆成一朵花给你' },
{ id: 'g_apple', name: '苹果', emoji: '🍎', price: 8.00, cat: '美食', wish: '挑最大的那个，当平安果' },
{ id: 'g_pear', name: '香梨', emoji: '🍐', price: 12.00, cat: '美食', wish: '秋天干燥，正好润一润' },
{ id: 'g_peachjuicy', name: '桃子', emoji: '🍑', price: 13.00, cat: '美食', wish: '软软的甜，熟透了才摘' },
{ id: 'g_kiwi', name: '猕猴桃', emoji: '🥝', price: 13.00, cat: '美食', wish: '维C小炸弹，一天一颗' },
{ id: 'g_pineapple', name: '菠萝', emoji: '🍍', price: 15.00, cat: '美食', wish: '盐水泡过了，不扎嘴' },
{ id: 'g_cherry', name: '车厘子', emoji: '🍒', price: 36.00, cat: '甜品', wish: '贵有贵的道理，整箱搬回' },
{ id: 'g_shavedice', name: '刨冰', emoji: '🍧', price: 11.00, cat: '甜品', wish: '红豆打底，炼乳多加一勺' },
{ id: 'g_coffee', name: '一杯美式', emoji: '☕', price: 15.00, cat: '饮品', wish: '苦一点没关系，醒得快' },
{ id: 'g_paotui', name: '帮你带一杯', emoji: '🛵', price: 0.00, cat: '饮品', wish: '想喝什么？备注里写' },
{ id: 'g_hotdog', name: '热狗', emoji: '🌭', price: 11.00, cat: '美食', wish: '加芥末还是番茄酱？都行' },
{ id: 'g_bread', name: '早餐面包', emoji: '🍞', price: 12.00, cat: '美食', wish: '刚出炉的，配牛奶正好' },
{ id: 'g_croissant', name: '可颂', emoji: '🥐', price: 10.00, cat: '美食', wish: '酥皮掉渣，也香得很' },
{ id: 'g_squid', name: '烤鱿鱼', emoji: '🦑', price: 15.00, cat: '美食', wish: '撒足孜然和辣椒面' },
{ id: 'g_waffle', name: '华夫饼', emoji: '🧇', price: 15.00, cat: '甜品', wish: '格子里都淋满了糖浆' },
{ id: 'g_eggtart', name: '蛋挞', emoji: '🥧', price: 8.00, cat: '甜品', wish: '一盒六个，趁热吃完' },
{ id: 'g_mangosago', name: '杨枝甘露', emoji: '🥭', price: 18.00, cat: '饮品', wish: '芒果西柚西米，一勺全有' },
{ id: 'g_matchalatte', name: '抹茶拿铁', emoji: '🍵', price: 16.00, cat: '饮品', wish: '微苦回甘，绿色的好心情' },
{ id: 'g_lemontea', name: '手打柠檬茶', emoji: '🍋', price: 12.00, cat: '饮品', wish: '暴打十下，冰块加满' },
{ id: 'g_grapetea', name: '多肉葡萄', emoji: '🍇', price: 18.00, cat: '饮品', wish: '果肉多到嚼不过来' },
{ id: 'g_peachtea', name: '蜜桃乌龙', emoji: '🍑', price: 16.00, cat: '饮品', wish: '一整颗桃子的香气' },
{ id: 'g_malatang', name: '麻辣烫', emoji: '🍲', price: 32.00, cat: '美食', wish: '自己挑的菜，全都下进去' },
{ id: 'g_spicywok', name: '麻辣香锅', emoji: '🌶️', price: 48.00, cat: '美食', wish: '辣度你定，我陪你吃' },
{ id: 'g_ricechicken', name: '黄焖鸡米饭', emoji: '🍚', price: 26.00, cat: '美食', wish: '汤汁拌饭，能干三碗' },
{ id: 'g_legquarter', name: '大鸡腿饭', emoji: '🍖', price: 22.00, cat: '美食', wish: '整只鸡腿，就盖在你饭上' },
{ id: 'g_taco', name: '塔可', emoji: '🌮', price: 16.00, cat: '美食', wish: '馅料满满，一口一个' },
{ id: 'g_baguette', name: '法棍', emoji: '🥖', price: 10.00, cat: '美食', wish: '外皮脆脆的，敲着响' },
{ id: 'g_bagel', name: '贝果', emoji: '🥯', price: 12.00, cat: '美食', wish: '嚼劲十足，配奶油更好' },
{ id: 'g_medfever', name: '退烧药', emoji: '💉', price: 18.00, cat: '药品医护', wish: '烧到难受才吃，吃完好好睡' },
{ id: 'g_medanti', name: '消炎药', emoji: '🧪', price: 26.00, cat: '药品医护', wish: '伤口发炎别硬扛，按时吃' },
{ id: 'g_medpain', name: '止痛药', emoji: '🩺', price: 20.00, cat: '药品医护', wish: '疼得睡不着就吃一片，别忍着' },
{ id: 'g_medstomach', name: '胃药', emoji: '🫙', price: 24.00, cat: '药品医护', wish: '胃不舒服冲一包，别空着肚子' },
{ id: 'g_medcough', name: '止咳糖浆', emoji: '🍯', price: 19.00, cat: '药品医护', wish: '咳得厉害喝一口，甜的润嗓子' },
{ id: 'g_medthroat', name: '润喉糖', emoji: '🍬', price: 9.90, cat: '药品医护', wish: '嗓子哑了含一颗，今天少说话' },
{ id: 'g_medeye', name: '眼药水', emoji: '💧', price: 16.00, cat: '药品医护', wish: '看久了滴一滴，眼睛也要歇' },
{ id: 'g_medfloral', name: '花露水', emoji: '🌿', price: 14.00, cat: '药品医护', wish: '夏天蚊子多，出门前喷一点' },
{ id: 'g_medvc', name: '维生素C', emoji: '🍊', price: 46.00, cat: '药品医护', wish: '一天一片，少感冒一次是一次' },
{ id: 'g_medhuoxiang', name: '藿香正气水', emoji: '🥃', price: 12.00, cat: '药品医护', wish: '中暑头晕喝一支，苦但管用' },
{ id: 'g_mediodine', name: '碘伏', emoji: '🧴', price: 12.00, cat: '药品医护', wish: '破皮先消毒，这两天别沾水' },
{ id: 'g_medswab', name: '医用棉签', emoji: '🧷', price: 6.00, cat: '药品医护', wish: '换药的时候用得着，我来' },
{ id: 'g_medgauze', name: '纱布绷带', emoji: '🩼', price: 15.00, cat: '药品医护', wish: '包好了别乱动，明天我换药' },
{ id: 'g_medliniment', name: '跌打药酒', emoji: '🍶', price: 32.00, cat: '药品医护', wish: '磕青了要揉开，手给我，我来揉' },
{ id: 'g_medice', name: '冰袋', emoji: '🧊', price: 8.00, cat: '药品医护', wish: '肿起来先冰一会儿，别急着揉' },
{ id: 'g_periodtea', name: '红糖姜茶', emoji: '🫖', price: 15.00, cat: '药品医护', wish: '疼的时候喝一口，热的' },
{ id: 'g_periodwarm', name: '暖宝宝贴', emoji: '🔥', price: 9.90, cat: '药品医护', wish: '贴在小肚子上，别硬扛' },
{ id: 'g_periodbag', name: '热水袋', emoji: '♨️', price: 26.00, cat: '药品医护', wish: '灌满热水，抱着它躺下' },
{ id: 'g_periodpad', name: '痛经贴', emoji: '💗', price: 12.90, cat: '药品医护', wish: '贴一片，疼会轻一点' },
{ id: 'g_festzongzi', name: '粽子', emoji: '🫔', price: 12.00, cat: '节日节令', wish: '端午的咸蛋黄，挑最大的给你' },
{ id: 'g_festtangyuan', name: '汤圆', emoji: '🍡', price: 13.14, cat: '节日节令', wish: '一人一半，团团圆圆' },
{ id: 'g_festniangao', name: '年糕', emoji: '🍥', price: 16.00, cat: '节日节令', wish: '年年高一点点，我们一起' },
{ id: 'g_festlaba', name: '腊八粥', emoji: '🥣', price: 10.00, cat: '节日节令', wish: '腊八这天，先把胃暖上' },
{ id: 'g_festjiaozi', name: '手工饺子', emoji: '🥟', price: 22.00, cat: '节日节令', wish: '一起包的，歪的也算数' },
{ id: 'g_festqingtuan', name: '青团', emoji: '🍃', price: 9.00, cat: '节日节令', wish: '把春天包进去，甜的那种' },
{ id: 'g_festgingerbread', name: '圣诞姜饼', emoji: '🍪', price: 18.00, cat: '节日节令', wish: '咬一口，冬天就甜了' },
{ id: 'g_beautylip', name: '口红', emoji: '💋', price: 128.00, cat: '美妆个护', wish: '涂上它，我多说两句好听的' },
{ id: 'g_beautyperfume', name: '香水', emoji: '🫧', price: 268.00, cat: '美妆个护', wish: '喷一点，走近了才闻得到' },
{ id: 'g_beautyfacial', name: '面膜', emoji: '🧖', price: 89.00, cat: '美妆个护', wish: '敷着别动，这十五分钟归我' },
{ id: 'g_beautysun', name: '防晒霜', emoji: '☀️', price: 78.00, cat: '美妆个护', wish: '太阳再大，也先护着你' },
{ id: 'g_beautybody', name: '身体乳', emoji: '💧', price: 68.00, cat: '美妆个护', wish: '洗完澡记得涂，滑滑的好抱' },
{ id: 'g_beautyhair', name: '护发精油', emoji: '🌿', price: 96.00, cat: '美妆个护', wish: '头发顺了，扎起来也好看' },
{ id: 'g_beautynail', name: '美甲套装', emoji: '💅', price: 68.00, cat: '美妆个护', wish: '指甲换个新颜色，给我看看' },
{ id: 'g_beautybrush', name: '化妆刷', emoji: '🖌️', price: 45.00, cat: '美妆个护', wish: '刷子在手里，你最好看' },
{ id: 'g_beautyshadow', name: '眼影盘', emoji: '🎨', price: 99.00, cat: '美妆个护', wish: '画个亮一点的，今天要出门' },
{ id: 'g_beautycotton', name: '化妆棉', emoji: '🧽', price: 12.00, cat: '美妆个护', wish: '卸干净再睡，别懒' },
{ id: 'g_bellyrub', name: '帮你揉肚子', emoji: '🫳', price: 0.00, cat: '关怀', wish: '手搓热了，揉到你不疼' },
{ id: 'g_liedown', name: '陪你躺一天', emoji: '🛋️', price: 0.00, cat: '关怀', wish: '什么都不干，就躺着陪你' },
{ id: 'g_lily', name: '百合', emoji: '🌺', price: 25.00, cat: '花束', wish: '百年好合，说的就是我们' },
{ id: 'g_carnation', name: '康乃馨', emoji: '🏵️', price: 15.00, cat: '花束', wish: '温柔的话，都包在这朵里' },
{ id: 'g_hydrangea', name: '绣球', emoji: '💮', price: 68.00, cat: '花束', wish: '一整球，圆圆满满给你' },
{ id: 'g_lotus', name: '荷花', emoji: '🪷', price: 26.00, cat: '花束', wish: '清清淡淡，也很好看' },
{ id: 'g_champagne', name: '香槟玫瑰', emoji: '🥂', price: 66.00, cat: '花束', wish: '颜色像香槟，看一眼就想庆祝' },
{ id: 'g_driedflower', name: '干花束', emoji: '🥀', price: 12.00, cat: '花束', wish: '干了也不扔，和心意一样耐放' },
{ id: 'g_ginkgo', name: '银杏叶', emoji: '🍁', price: 8.80, cat: '花束', wish: '秋天第一片，夹进你的书里' },
{ id: 'g_dandelion', name: '蒲公英', emoji: '🍃', price: 6.60, cat: '花束', wish: '吹散之前，愿望都归你' }
];
const DEF_IDS = {};
DEF_GIFTS.forEach(function (g) { DEF_IDS[g.id] = 1; });
const DEF_V1_IDS = { g_rose: 1, g_sun: 1, g_stars: 1, g_tulip: 1, g_peach: 1, g_cake: 1, g_choc: 1, g_tea: 1, g_candy: 1, g_berry: 1, g_ring: 1, g_neck: 1, g_brace: 1, g_bow: 1, g_star1: 1, g_moon: 1, g_cloud: 1, g_rainbow: 1, g_meteor: 1, g_galaxy: 1, g_hug: 1, g_kiss: 1, g_night: 1, g_soup: 1, g_letter: 1, g_couplecup: 1, g_couplewear: 1, g_lock: 1, g_couavatar: 1, g_coudiary: 1, g_couframe: 1, g_cousong: 1, g_coucoin: 1, g_towel: 1, g_mug: 1, g_umbrella: 1, g_pillow: 1, g_warmer: 1, g_earphone: 1, g_notebook: 1, g_keychain: 1, g_lamp: 1, g_candle: 1 };
const DEF_V2_IDS = { g_hotpot: 1, g_sushi: 1, g_noodle: 1, g_bbq: 1, g_bfast: 1, g_juice: 1, g_chestnut: 1, g_potato: 1, g_popcorn: 1, g_train: 1, g_plane: 1, g_camp: 1, g_beach: 1, g_spring: 1, g_route: 1, g_movie: 1, g_concert: 1, g_ferris: 1, g_claw: 1, g_ktv: 1, g_icecream: 1, g_pudding: 1, g_crown: 1, g_snow: 1, g_sunset: 1, g_breeze: 1, g_wave: 1, g_milk: 1, g_massage: 1, g_wakeup: 1, g_watchtogether: 1, g_couplewatch: 1, g_coupleshoes: 1, g_scarf: 1, g_socks: 1, g_slipper: 1 };
const DEF_V3_IDS = { g_card: 1, g_blindbox: 1, g_stickers: 1, g_wordsbag: 1, g_nearby: 1, g_hands: 1, g_patpat: 1, g_unseen: 1, g_heartlink: 1, g_amulet: 1, g_courier: 1, g_dreammeet: 1, g_moonmeet: 1, g_bridge: 1, g_daisy: 1, g_cookie: 1, g_oden: 1, g_tanghulu: 1, g_starear: 1, g_picnic: 1, g_nightmarket: 1, g_boardgame: 1, g_telescope: 1, g_walk: 1, g_lullaby: 1, g_eyemask: 1, g_lipbalm: 1, g_thermos: 1, g_plant: 1, g_handcream: 1, g_soap: 1, g_wipes: 1, g_bandaid: 1, g_mask: 1, g_powerbank: 1, g_cable: 1, g_canvasbag: 1, g_hat: 1, g_gloves: 1, g_calendar: 1, g_bear: 1, g_humid: 1, g_lunchbox: 1, g_pill: 1, g_phonestand: 1, g_thermo: 1, g_clipper: 1, g_storage: 1, g_luggage: 1, g_backpack: 1, g_glasses: 1, g_vase: 1, g_chopsticks: 1, g_pen: 1, g_stickynote: 1, g_powerstrip: 1, g_wallet: 1, g_cap: 1, g_hairtie: 1, g_fan: 1, g_mousepad: 1, g_burger: 1, g_pizza: 1, g_friedchicken: 1, g_riceball: 1, g_dumplings: 1, g_crayfish: 1, g_honey: 1, g_donut: 1, g_pancake: 1, g_layerscake: 1, g_sunrise: 1, g_cycling: 1, g_roadtrip: 1, g_pottery: 1, g_puzzle: 1, g_gamenight: 1, g_listen: 1, g_photoshoot: 1, g_bathbomb: 1, g_icecube: 1, g_flashlight: 1, g_cardholder: 1, g_planet: 1, g_comet: 1, g_curry: 1, g_friedshrimp: 1, g_sandwich: 1, g_fries: 1, g_coconut: 1, g_fortune: 1, g_cupcake: 1, g_lollipop: 1, g_sundae: 1, g_cactus: 1, g_clover: 1, g_earth: 1, g_trainslow: 1, g_island: 1, g_hike: 1, g_supermarket: 1, g_darts: 1, g_musicfestival: 1, g_bowling: 1, g_cheer: 1, g_nightcall: 1, g_lovejournal: 1, g_pendant: 1, g_sponge: 1, g_pasta: 1, g_wrap: 1, g_salad: 1, g_pretzel: 1, g_mooncake: 1, g_beads: 1, g_sunglasses: 1, g_crystal: 1, g_shinystar: 1, g_partlycloudy: 1, g_rollercoaster: 1, g_sailboat: 1, g_rowboat: 1, g_taxi: 1, g_carousel: 1, g_theater: 1, g_homecook: 1, g_windchime: 1, g_contract: 1, g_coat: 1, g_dress: 1, g_pencil: 1, g_bookmark: 1, g_compass: 1, g_couchblanket: 1, g_watermelon: 1, g_lemon: 1, g_corn: 1, g_tomato: 1, g_peanut: 1, g_grape: 1, g_mango: 1, g_brooch: 1, g_rocket: 1, g_ufo: 1, g_starface: 1, g_kite: 1, g_heli: 1, g_cruise: 1, g_pingpong: 1, g_badminton: 1, g_fishing: 1, g_skating: 1, g_piano: 1, g_balloon: 1, g_camera: 1, g_radio: 1, g_mirror: 1, g_sweater: 1, g_bathset: 1, g_mosquito: 1, g_keyboard: 1, g_books: 1, g_speaker: 1, g_oatmeal: 1, g_cushion: 1, g_wallclock: 1, g_foodbox: 1, g_bunny: 1, g_teapot: 1, g_yogamat: 1, g_dumbbell: 1, g_sewing: 1, g_snackbox: 1, g_sachet: 1, g_fireworks: 1, g_billiards: 1, g_yoyo: 1, g_watercolor: 1, g_guitar: 1, g_archery: 1, g_iceskate: 1, g_sparkler: 1, g_wishbamboo: 1, g_magicwand: 1, g_surf: 1, g_snorkel: 1, g_fridgemagnet: 1, g_bellservice: 1, g_projector: 1, g_fountainpen: 1, g_partypopper: 1, g_specialdrink: 1, g_sourplum: 1, g_bubbly: 1, g_orange: 1, g_apple: 1, g_pear: 1, g_peachjuicy: 1, g_kiwi: 1, g_pineapple: 1, g_cherry: 1, g_shavedice: 1, g_coffee: 1, g_paotui: 1, g_hotdog: 1, g_bread: 1, g_croissant: 1, g_squid: 1, g_waffle: 1, g_eggtart: 1, g_mangosago: 1, g_matchalatte: 1, g_lemontea: 1, g_grapetea: 1, g_peachtea: 1, g_malatang: 1, g_spicywok: 1, g_ricechicken: 1, g_legquarter: 1, g_taco: 1, g_baguette: 1, g_bagel: 1 };
const GSTORE = (function () { try { return window.xyStore('xy-home-v2'); } catch (e) { return null; } })();
const CUSTOM_KEY = 'market-custom';
const MIGRATE_KEY = 'market-migrated';
const GIFTS_KEY = 'market-gifts'; // 旧各桌面商品库键（仅迁移读取用）
function customLoad() { try { const a = JSON.parse((GSTORE && GSTORE.get(CUSTOM_KEY)) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function customSave(a) { if (GSTORE) GSTORE.set(CUSTOM_KEY, JSON.stringify(a)); }
function giftsLoad() {
const dead = {}, ov = {}, customs = [];
customLoad().forEach(function (c) {
if (!c || !c.id) return;
if (c.del) { dead[c.id] = 1; return; }
if (c.base) { ov[c.id] = c; return; }
customs.push(c);
});
const out = [];
DEF_GIFTS.forEach(function (g) {
if (dead[g.id]) return;
if (ov[g.id]) { const m = Object.assign({}, g, ov[g.id]); delete m.base; delete m.del; out.push(m); }
else out.push(g);
});
return out.concat(customs);
}
function deleteGift(id) {
const customs = customLoad();
const idx = customs.findIndex(function (x) { return x && x.id === id; });
if (DEF_IDS[id]) {
const mark = { id: id, del: 1 };
if (idx >= 0) customs[idx] = mark; else customs.push(mark);
} else {
if (idx >= 0) customs.splice(idx, 1);
}
customSave(customs);
}
const GOODS_PACK_APP = 'mochi-market-goods';
const GOODS_IMG_MAX = 1200000;   // 单件图片上限（base64 字符数，约 900KB 原图）
const GOODS_PACK_MAX = 3145728;  // 商品库总量上限（含图片）；超出的条目本次不导入，而不是撑爆本地存储
function customMine() {
return customLoad().filter(function (c) { return c && c.id && !c.del && !c.base; });
}
function goodsSig(g) {
const img = String((g && g.img) || '');
return [g && g.name, g && g.price, g && g.cat, g && g.emoji, img.length, img.slice(0, 48), img.slice(-24)].join('\u0001');
}
function freshGid(used) {
let id;
do { id = 'g_custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); } while (used[id]);
return id;
}
function cleanGoods(x) {
if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
if (x.del || x.base) return null;
const name = String(x.name == null ? '' : x.name).replace(/\s+/g, ' ').trim().slice(0, 20);
if (!name) return null;
const price = Math.round(Math.max(0, Math.min(99999999, Number(x.price) || 0)) * 100) / 100;
const cat = CATS.indexOf(String(x.cat || '')) >= 0 ? String(x.cat) : '关怀';
const emoji = String(x.emoji == null ? '' : x.emoji).trim().slice(0, 8) || '🎁';
const wish = String(x.wish == null ? '' : x.wish).trim().slice(0, 60) || '送给你';
let img = String(x.img == null ? '' : x.img);
if (!/^data:image\//i.test(img) || img.length > GOODS_IMG_MAX) img = ''; // 只收本地上传的内嵌图，外链/超大图丢弃
const id = /^g_custom_[A-Za-z0-9_]+$/.test(String(x.id || '')) ? String(x.id) : '';
return { id: id, name: name, emoji: emoji, img: img, price: price, cat: cat, wish: wish };
}
function goodsFromPack(data) {
if (!data || typeof data !== 'object') return null;
let arr = null;
if (Array.isArray(data)) arr = data;
else if (Array.isArray(data.goods)) arr = data.goods;
else if (Array.isArray(data.items)) arr = data.items;
else if (data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys)) {
const raw = data.keys['xy-home-v2:market-custom'];
if (Array.isArray(raw)) arr = raw;
else if (typeof raw === 'string') { try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch (e) {} }
}
return (arr && arr.length) ? arr : null;
}
function mergeGoods(existing, incoming) {
const list = existing.slice();
const byId = Object.create(null), bySig = Object.create(null);
list.forEach(function (c, i) {
if (!c || !c.id) return;
byId[c.id] = i;
if (!c.del && !c.base) bySig[goodsSig(c)] = i;
});
let added = 0, updated = 0, skipped = 0, bad = 0, over = 0, bytes = 0;
try { bytes = JSON.stringify(list).length; } catch (e) { bytes = 0; }
incoming.forEach(function (raw) {
const g = cleanGoods(raw);
if (!g) { bad++; return; }
const sig = goodsSig(g);
if (sig in bySig) { skipped++; return; }
const at = g.id ? byId[g.id] : undefined;
const hit = (at != null && list[at] && !list[at].del && !list[at].base && String(list[at].name) === g.name) ? at : -1;
let item = g;
if (hit < 0) {
item = Object.assign({}, g);
if (!item.id || byId[item.id] != null) item.id = freshGid(byId);
}
let size = 0;
try { size = JSON.stringify(item).length; } catch (e) { size = 0; }
if (bytes + size > GOODS_PACK_MAX) { over++; return; }
bytes += size;
if (hit < 0) { list.push(item); byId[item.id] = list.length - 1; bySig[sig] = list.length - 1; added++; }
else { list[hit] = item; bySig[sig] = hit; updated++; }
});
return { list: list, added: added, updated: updated, skipped: skipped, bad: bad, over: over };
}
function migrateMarketGlobal(setMark) {
if (!GSTORE || GSTORE.get(MIGRATE_KEY)) return;
const customs = customLoad();
const seen = {};
customs.forEach(function (c) { if (c && c.id) { seen[c.id] = 1; if (c.del) seen['del:' + c.id] = 1; } });
let changed = false;
const contacts = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
contacts.forEach(function (c) {
let raw = null;
try { raw = window.storeFor(c.id).get(GIFTS_KEY); } catch (e) {}
if (raw == null || raw === '') return;
let arr = null;
try { arr = JSON.parse(raw); } catch (e) { return; }
if (!Array.isArray(arr) || !arr.length) return;
const ids = {};
arr.forEach(function (g) { if (g && g.id) ids[g.id] = 1; });
arr.forEach(function (g) {
if (!g || !g.id || String(g.id).indexOf('g_custom_') !== 0 || seen[g.id]) return;
seen[g.id] = 1;
customs.push({ id: g.id, name: g.name, emoji: g.emoji, img: g.img || '', price: g.price, cat: g.cat, wish: g.wish });
changed = true;
});
DEF_GIFTS.forEach(function (d) {
if (!DEF_V1_IDS[d.id]) return;
if (ids[d.id] || seen['del:' + d.id]) return;
seen['del:' + d.id] = 1;
customs.push({ id: d.id, del: 1 });
changed = true;
});
});
if (changed || setMark) customSave(customs);
if (setMark) GSTORE.set(MIGRATE_KEY, '1');
}
function rescueBatch(ids, mark) {
if (!GSTORE || GSTORE.get(mark)) return;
const customs = customLoad();
let changed = false;
for (let i = customs.length - 1; i >= 0; i--) {
const c = customs[i];
if (c && c.del && ids[c.id]) { customs.splice(i, 1); changed = true; }
}
if (changed) customSave(customs);
GSTORE.set(mark, '1');
}
function rescueNewDefaults() {
rescueBatch(DEF_V2_IDS, 'market-migrated-v2');
rescueBatch(DEF_V3_IDS, 'market-migrated-v3');
}
const BOX_KEY = 'giftbox-items';
function boxLoad() { try { const s = store(); if (!s) return []; return JSON.parse(s.get(BOX_KEY) || '[]'); } catch (e) { return []; } }
function boxSave(a) { const s = store(); if (s) s.set(BOX_KEY, JSON.stringify(a)); }
let _boxMeta = null;
function boxMetaInvalidate() { _boxMeta = null; }
function boxMetaMap() {
if (_boxMeta) return _boxMeta;
const m = {};
try {
const list = boxLoad();
if (Array.isArray(list)) list.forEach(function (it) {
if (!it || !it.id) return;
m[it.id] = { claimed: it.claimed === 0 ? 0 : (it.claimed === 1 ? 1 : null), replies: Array.isArray(it.replies) ? it.replies : [] };
});
} catch (e) {}
_boxMeta = m;
return m;
}
window.giftGiftMeta = function (boxId) {
if (!boxId) return null;
try { return boxMetaMap()[boxId] || null; } catch (e) { return null; }
};
const WL_MY_KEY = 'gift-wishlist';
const WL_TA_KEY = 'gift-wishlist-ta';
const WL_SETTINGS_KEY = 'market-wl-settings';
const WL_MAX = 30;
function clampPct(v, def) { const n = Math.round(Number(v)); return (n >= 0 && n <= 100) ? n : def; }
function clampMode(v, def) { const n = Math.round(Number(v)); return (n === 0 || n === 1 || n === 2) ? n : def; }
const GIFT_REPLY_MODES = [{ label: '系统预设话术', value: 0 }, { label: '像正常聊天一样回复', value: 1 }, { label: '混合', value: 2 }];
function giftReplyModeLabel(v) {
const n = clampMode(v, 1);
for (let i = 0; i < GIFT_REPLY_MODES.length; i++) { if (GIFT_REPLY_MODES[i].value === n) return GIFT_REPLY_MODES[i].label; }
return '像正常聊天一样回复';
}
const WL_VER = 2;
function wlSettingsRaw() {
try { return JSON.parse((GSTORE && GSTORE.get(WL_SETTINGS_KEY)) || '') || null; } catch (e) { return null; }
}
function wlSettings() {
const s = wlSettingsRaw() || {};
return { wlVer: WL_VER, giftInOn: s.giftInOn === 0 ? 0 : 1, giftInPct: clampPct(s.giftInPct, 5), wlOn: s.wlOn === 0 ? 0 : 1, wlBuyPct: clampPct(s.wlBuyPct, 20), wlAddPct: clampPct(s.wlAddPct, 15), wishChatOn: s.wishChatOn === 0 ? 0 : 1, wishChatPct: clampPct(s.wishChatPct, 60), selfOn: s.selfOn === 0 ? 0 : 1, selfPct: clampPct(s.selfPct, 10), selfChatOn: s.selfChatOn === 0 ? 0 : 1, giftReplyOn: s.giftReplyOn === 0 ? 0 : 1, giftReplyPct: clampPct(s.giftReplyPct, 60), giftReplyMode: clampMode(s.giftReplyMode, 1) };
}
function wlSettingsSave(st) { if (GSTORE) GSTORE.set(WL_SETTINGS_KEY, JSON.stringify(st)); }
function wlSettingsUpgrade() {
if (!GSTORE) return false;
const raw = wlSettingsRaw();
if (!raw || raw.wlVer === WL_VER) return false;
const next = Object.assign({}, raw, { wlVer: WL_VER });
const revived = raw.giftInOn === 0;
if (revived) next.giftInOn = 1;
wlSettingsSave(next);
return revived;
}
let wlReviveNotified = false;
function wlUpgradeAndNotify() {
let revived = false;
try { revived = wlSettingsUpgrade(); } catch (e) {}
if (!revived || wlReviveNotified) return;
wlReviveNotified = true;
setTimeout(function () { try { toast('「TA 送我礼物」已重新开启（旧版设置遗留关闭），可在「心意集市设置」里调整'); } catch (e) {} }, 6000);
}
function wishSnap(g) { return { giftId: g.id, name: g.name, emoji: g.emoji, img: g.img || '', price: g.price, cat: g.cat, wish: g.wish || '送给你', tm: Date.now() }; }
function wishLoad(key) { try { const s = store(); if (!s) return []; const a = JSON.parse(s.get(key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function wishSave(key, a) { const s = store(); if (s) s.set(key, JSON.stringify(a)); if (key === WL_TA_KEY) _taWishIds = null; }
let _taWishIds = null;
let _taWishIdsFor = '';
function taWishIdsFor() {
try { return (window.activePrefix ? window.activePrefix() : '') || String(window.__activeCid || ''); } catch (e) { return ''; }
}
function taWishIds() {
const tag = taWishIdsFor();
if (!_taWishIds || _taWishIdsFor !== tag) {
const ids = new Set();
wishLoad(WL_TA_KEY).forEach(function (x) { if (x && x.giftId) ids.add(x.giftId); });
_taWishIds = ids;
_taWishIdsFor = tag;
}
return _taWishIds;
}
function wishMyHas(id) { return wishLoad(WL_MY_KEY).some(function (x) { return x.giftId === id; }); }
function wishMyAdd(g) {
const a = wishLoad(WL_MY_KEY);
if (a.some(function (x) { return x.giftId === g.id; })) return false;
a.unshift(wishSnap(g));
wishSave(WL_MY_KEY, a.slice(0, WL_MAX));
return true;
}
function wishTaRemove(id) { wishSave(WL_TA_KEY, wishLoad(WL_TA_KEY).filter(function (x) { return x.giftId !== id; })); }
const WL_TA_SEEN_KEY = 'gift-wishlist-ta-seen';
function taWishUnread() {
const list = wishLoad(WL_TA_KEY);
const newest = list.reduce(function (m, x) { return Math.max(m, Number(x && x.tm) || 0); }, 0);
try {
const s = store(); if (!s) return 0;
const raw = s.get(WL_TA_SEEN_KEY);
if (raw === null) { s.set(WL_TA_SEEN_KEY, String(newest)); return 0; }
const seen = Number(raw) || 0;
return list.filter(function (x) { return (Number(x && x.tm) || 0) > seen; }).length;
} catch (e) { return 0; }
}
function taWishMarkSeen() { try { const s = store(); if (s) s.set(WL_TA_SEEN_KEY, String(Date.now())); } catch (e) {} }
function wishChatPush(gift) {
try {
if (!gift || !gift.id || !window.chatAddGift) return false;
const wishText = '想要「' + (gift.name || '这个') + '」';
window.chatAddGift({
side: 'in', special: 'wish',
text: wishText,
wishGiftId: gift.id, wishGiftName: gift.name, wishGiftEmoji: gift.emoji,
wishGiftImg: gift.img || '', wishGiftPrice: gift.price, wishGiftCat: gift.cat,
wishGiftWish: gift.wish || '送给你', wishTs: Date.now()
});
try {
if (window.bgLateCatchup && window.bgLateCatchup() && window.bgNotifyCheck) {
const cp = document.getElementById('page-chat');
if (!(cp && !cp.hidden)) window.bgNotifyCheck(wishText, Date.now(), { name: partnerName() + '的心愿', late: true });
}
} catch (e) {}
return true;
} catch (e) { return false; }
}
window.giftTaWishHas = function (id) { try { return taWishIds().has(id); } catch (e) { return true; } };
window.giftBuyFromWishCard = function (rec, done) {
if (!rec || !rec.wishGiftId) return false;
if (!taWishIds().has(rec.wishGiftId)) { toast(partnerName() + ' 的心愿单里已经没有这件啦'); return false; }
openBuyDialog({
id: rec.wishGiftId, name: rec.wishGiftName || '礼物', emoji: rec.wishGiftEmoji || '🎁',
img: rec.wishGiftImg || '', price: Number(rec.wishGiftPrice || 0), cat: rec.wishGiftCat || '',
wish: rec.wishGiftWish || '送给你'
}, { fromTaWish: true, onDone: done });
return true;
};
function cardPool() { const pool = []; try { const d = window.DEFAULT_CARD_DATA; if (d && d.main) { d.main.forEach(function (c) { if (c && c[1]) c[1].forEach(function (x) { if (x) pool.push(x); }); }); } } catch (e) {} return pool; }
function taWish(gift) {
let wish = (gift && gift.wish) || '送给你';
const pool = cardPool();
if (pool.length && Math.random() < 0.6) {
const n = 1 + Math.floor(Math.random() * 5);
const extras = [];
for (let i = 0; i < n; i++) extras.push(pick(pool));
if (extras.length) wish += ' ' + extras.join(' ');
}
return wish;
}
function boxEntry(gift, side, wish) {
const e = { id: 'gb_' + Date.now() + '_' + Math.floor(Math.random() * 1000), giftId: gift.id, name: gift.name, emoji: gift.emoji, img: gift.img || '', price: gift.price, cat: gift.cat, wish: wish, side: side, tm: Date.now(), replies: [] };
if (side === 'in') e.claimed = 0;
return e;
}
function recordBox(gift, side, wish) {
const box = boxLoad();
const entry = boxEntry(gift, side, wish);
box.unshift(entry);
boxSave(box);
boxMetaInvalidate();
return entry;
}
window.recordGiftBox = recordBox;
function boxStoreFor(cid) {
const id = cid || 'default';
const isDefault = id === 'default';
const nsStore = window.xyStore ? window.xyStore('xy-home-v2:' + id) : null;
return {
get: function (k) {
let v = null;
try { v = nsStore.get(k); } catch (e) {}
if (v === null && isDefault && GSTORE) { try { v = GSTORE.get(k); } catch (e) {} }
return v;
},
set: function (k, v) {
try { nsStore.set(k, v); } catch (e) {}
if (isDefault && GSTORE) { try { GSTORE.remove(k); } catch (e) {} }
}
};
}
function recordBoxAt(cid, gift, side, wish) {
const s = boxStoreFor(cid);
let box = [];
try { box = JSON.parse(s.get(BOX_KEY) || '[]'); } catch (e) { box = []; }
if (!Array.isArray(box)) box = [];
const entry = boxEntry(gift, side, wish);
box.unshift(entry);
s.set(BOX_KEY, JSON.stringify(box));
boxMetaInvalidate();
return entry;
}
function boxAttachReply(cid, boxId, who, text) {
if (!boxId || !text) return false;
const s = boxStoreFor(cid);
let box = [];
try { box = JSON.parse(s.get(BOX_KEY) || '[]'); } catch (e) { box = []; }
if (!Array.isArray(box)) return false;
for (let i = 0; i < box.length; i++) {
const it = box[i];
if (it && it.id === boxId) {
if (!Array.isArray(it.replies)) it.replies = [];
it.replies.push({ who: who === 'me' ? 'me' : 'ta', text: String(text), ts: Date.now() });
try { s.set(BOX_KEY, JSON.stringify(box)); } catch (e2) {}
boxMetaInvalidate();
return true;
}
}
return false;
}
window.giftBoxAttachReply = function (boxId, who, text, cid) {
try { return boxAttachReply(cid || (window.__activeCid || 'default'), boxId, who, text); } catch (e) { return false; }
};
function boxMarkClaimed(cid, boxId) {
if (!boxId) return false;
const s = boxStoreFor(cid);
let box = [];
try { box = JSON.parse(s.get(BOX_KEY) || '[]'); } catch (e) { box = []; }
if (!Array.isArray(box)) return false;
for (let i = 0; i < box.length; i++) {
const it = box[i];
if (it && it.id === boxId) {
it.claimed = 1;
try { s.set(BOX_KEY, JSON.stringify(box)); } catch (e2) {}
boxMetaInvalidate();
return true;
}
}
return false;
}
window.giftBoxMarkClaimed = function (boxId, cid) {
try { return boxMarkClaimed(cid || (window.__activeCid || 'default'), boxId); } catch (e) { return false; }
};
window.giftBoxLiveRefresh = function () {
try { if (giftboxPage && !giftboxPage.hidden) renderBox(); } catch (e) {}
};
const GIFT_REPLY_GENERIC = ['哇，谢谢亲爱的～', '你怎么知道我想要这个！', '收到啦，超喜欢❤', '破费啦，我好好收着', '嘿嘿，被你宠到了', '这份我喜欢，收下啦', '已经摆进心意柜最上层了'];
const GIFT_REPLY_WISH = ['我的心愿被你实现啦！', '真的买下啦…说好不让你乱花钱的', '许愿时没想过真能收到，谢谢～', '心愿单少了一件，开心值满格', '你记得我的心愿，这个最戳我'];
function giftReplyFeedback(gift, chatRec) {
const st = wlSettings();
if (!st.giftReplyOn) return;
if (Math.random() * 100 >= clampPct(st.giftReplyPct, 60)) return;
let satisfied = false;
try { satisfied = taWishIds().has(gift.id); } catch (e) {}
const preset = function () { return pick(satisfied ? GIFT_REPLY_WISH : GIFT_REPLY_GENERIC); };
const mode = clampMode(st.giftReplyMode, 1);
const useChatStyle = mode === 1 || (mode === 2 && Math.random() < 0.4);
const cid = window.__activeCid || 'default';
setTimeout(function () {
try {
let txt = '';
if (useChatStyle && window.genChatStyleReply) txt = String(window.genChatStyleReply() || '').trim();
if (!txt) txt = preset();
if (!txt) return;
var boxId = chatRec && chatRec.giftBoxId;
try { if (window.chatGiftAttachReplyTo && chatRec) window.chatGiftAttachReplyTo(cid, chatRec.ts, 'ta', txt, chatRec); } catch (eRA) {}
try { if (boxId) boxAttachReply(cid, boxId, 'ta', txt); } catch (eRB) {}
try { if (boxId && (window.__activeCid || 'default') === cid && window.giftBoxLiveRefresh) window.giftBoxLiveRefresh(); } catch (eRC) {}
if ((window.__activeCid || 'default') === cid) {
if (useChatStyle && window.chatAddInTyped) window.chatAddInTyped(txt, { silent: true });
else if (window.chatAddIn) window.chatAddIn(txt, { silent: true });
} else if (window.chatAppendDeskRec) {
window.chatAppendDeskRec(cid, { side: 'in', text: txt });
}
} catch (e) {}
}, randInt(900, 2400));
}
function buyAndSend(gift, side, wish) {
const priceFen = Math.round((gift.price || 0) * 100);
const w = walletGet();
if (side === 'out') { w.myBalance -= priceFen; }
else { w.systemBalance -= priceFen; }
walletSet(w);
const rec = { side: side, special: 'gift', giftId: gift.id, giftName: gift.name, giftEmoji: gift.emoji, giftImg: gift.img || '', giftPrice: gift.price, giftWish: wish, giftCat: gift.cat, ts: Date.now() };
const entry = recordBox(gift, side, wish);
if (entry && entry.id) rec.giftBoxId = entry.id;
if (window.chatAddGift) window.chatAddGift(rec); else if (window.chatAddIn) window.chatAddIn('', { special: 'gift' });
if (window.logFish) window.logFish();
if (side === 'out') giftReplyFeedback(gift, rec);
return true;
}
const AUTO_DAILY_PREFIX = 'ml2_gift_daily_';
const SELF_DAILY_PREFIX = 'ml2_selfbuy_daily_';
function dayCount(prefix) { const s = store(); return Number(s && s.get(prefix + todayKey())) || 0; }
function dayIncr(prefix) { const s = store(); if (s) s.set(prefix + todayKey(), String(dayCount(prefix) + 1)); }
function deliverInGift(cid, gift, wish, delayMs) {
setTimeout(function () {
try {
const rec = { side: 'in', special: 'gift', giftId: gift.id, giftName: gift.name, giftEmoji: gift.emoji, giftImg: gift.img || '', giftPrice: gift.price, giftWish: wish, giftCat: gift.cat, ts: Date.now() };
if ((window.__activeCid || 'default') === cid) {
const entry = recordBox(gift, 'in', wish);
if (entry && entry.id) rec.giftBoxId = entry.id;
if (window.chatAddGift) window.chatAddGift(rec);
} else {
const entryAt = recordBoxAt(cid, gift, 'in', wish);
if (entryAt && entryAt.id) rec.giftBoxId = entryAt.id;
if (window.chatAppendDeskRec) window.chatAppendDeskRec(cid, rec);
}
if (window.logFish) window.logFish();
} catch (e) {}
}, delayMs);
}
window.maybeAutoGift = function () {
const st = wlSettings();
const myCid = window.__activeCid || 'default';
const giftCapped = dayCount(AUTO_DAILY_PREFIX) >= 3;
const selfCapped = dayCount(SELF_DAILY_PREFIX) >= 3;
const gifts = giftsLoad(); if (!gifts.length) return;
if (st.wlOn && st.giftInOn && !giftCapped) {
const myWl = wishLoad(WL_MY_KEY);
if (myWl.length && Math.random() * 100 < st.wlBuyPct) {
const item = pick(myWl);
wishSave(WL_MY_KEY, myWl.filter(function (x) { return x.giftId !== item.giftId; }));
const w1 = walletGet();
w1.systemBalance -= Math.round((item.price || 0) * 100); walletSet(w1);
dayIncr(AUTO_DAILY_PREFIX);
deliverInGift(myCid, Object.assign({}, item, { id: item.giftId }), item.wish, randInt(1500, 4000));
return;
}
}
if (st.selfOn && !selfCapped && Math.random() * 100 < st.selfPct) {
const w0 = walletGet();
const affordable0 = gifts.filter(function (g) { return Math.round((g.price || 0) * 100) <= w0.systemBalance; });
const gift0 = pick(affordable0.length ? affordable0 : gifts);
const wish0 = gift0.wish || '送给自己';
w0.systemBalance -= Math.round((gift0.price || 0) * 100); walletSet(w0);
dayIncr(SELF_DAILY_PREFIX);
setTimeout(function () {
const chatRec = { side: 'in', special: 'gift', giftId: gift0.id, giftName: gift0.name, giftEmoji: gift0.emoji, giftImg: gift0.img || '', giftPrice: gift0.price, giftWish: wish0, giftCat: gift0.cat, giftSelf: 1, ts: Date.now() };
if ((window.__activeCid || 'default') === myCid) {
const entrySelf = recordBox(gift0, 'self', wish0);
if (entrySelf && entrySelf.id) chatRec.giftBoxId = entrySelf.id; // #985：卡片与心意柜互指（同 buyAndSend）
if (st.selfChatOn && window.chatAddGift) window.chatAddGift(chatRec);
else toast(partnerName() + ' 给自己买了「' + gift0.name + '」，收进了 TA 的心意柜');
} else {
const entrySelfAt = recordBoxAt(myCid, gift0, 'self', wish0);
if (entrySelfAt && entrySelfAt.id) chatRec.giftBoxId = entrySelfAt.id;
if (st.selfChatOn && window.chatAppendDeskRec) window.chatAppendDeskRec(myCid, chatRec);
}
}, randInt(1500, 4000));
return;
}
if (st.wlOn && Math.random() * 100 < st.wlAddPct) {
const taWl = wishLoad(WL_TA_KEY);
const has = {};
taWl.forEach(function (x) { has[x.giftId] = 1; });
const poolW = gifts.filter(function (g) { return !has[g.id]; });
if (poolW.length) {
const giftW = pick(poolW);
taWl.unshift(wishSnap(giftW));
wishSave(WL_TA_KEY, taWl.slice(0, WL_MAX));
const pushed = !!(st.wishChatOn && Math.random() * 100 < st.wishChatPct && wishChatPush(giftW));
if (!pushed) toast(partnerName() + ' 把「' + giftW.name + '」加进了 TA 的心愿单\n市集下方「☆ 心愿单」可查看');
try { syncWishBadge(); } catch (e) {}
return;
}
}
if (giftCapped) return;
if (!st.giftInOn) return; // 总开关关闭＝禁止 TA 送我礼物（此开关的显式状态由 #585 wlSettingsUpgrade 迁移保证）
if (Math.random() * 100 >= st.giftInPct) return;
const w = walletGet();
const affordable = gifts.filter(function (g) { return Math.round((g.price || 0) * 100) <= w.systemBalance; });
const pool = affordable.length ? affordable : gifts;
const gift = pick(pool);
const wish = taWish(gift);
const priceFen = Math.round((gift.price || 0) * 100);
w.systemBalance -= priceFen; walletSet(w); dayIncr(AUTO_DAILY_PREFIX);
deliverInGift(myCid, gift, wish, randInt(1500, 4000));
};
function openBuyDialog(gift, opts) {
opts = opts || {};
if (!window.openTCPanel) { toast('稍后再试'); return; }
const catColor = CAT_COLOR[gift.cat] || '#f5f3fa';
const html =
'<div class="gb-preview" style="background:linear-gradient(160deg,' + catColor + ',var(--card-bg,#fff));">' +
'<div class="gb-emoji">' + giftMedia(gift, 'gb-emoji-img') + '</div>' +
'<div class="gb-name">' + esc(gift.name) + '</div>' +
'<div class="gb-price">¥' + Number(gift.price || 0).toFixed(2) + '</div>' +
'<div class="gb-desc">' + esc(gift.wish || '送给你') + '</div>' +
'</div>' +
'<div class="gb-wish-row">' +
'<div class="gb-wish-label">写给 ' + esc(partnerName()) + ' 的话</div>' +
'<textarea class="gb-wish" id="gb-wish" placeholder="写一句心意" maxlength="60">' + esc(gift.wish || '') + '</textarea>' +
'</div>' +
'<div class="gb-actions">' +
'<button class="gb-cancel" id="gb-cancel" type="button">取消</button>' +
(opts.fromTaWish ? '' : '<button class="gb-wishbtn" id="gb-wishbtn" type="button">' + (wishMyHas(gift.id) ? '✓ 已在心愿单' : '♡ 加入心愿单') + '</button>') +
'<button class="gb-ok" id="gb-ok" type="button">送给 ' + esc(partnerName()) + '</button>' +
'</div>' +
'<div class="gb-tiny">' + (
opts.fromTaWish
? '这是 ' + esc(partnerName()) + ' 心愿单里的礼物，送出后自动从 TA 的心愿单移除，礼物进 TA 的心意柜'
: (taWishIds().has(gift.id) // #588：同上，走记忆化集合
? esc(partnerName()) + ' 正许愿想要这件——买下送出即心愿兑现，自动从 TA 的心愿单移除'
: (wlSettings().giftInOn ? '加入心愿单只是许愿不花钱——' + esc(partnerName()) + ' 可能会买下它送你' : '加入心愿单只是许愿不花钱'))
) + '</div>';
window.openTCPanel(esc(gift.emoji) + ' ' + esc(gift.name), html);
const wishEl = document.getElementById('gb-wish');
const okBtn = document.getElementById('gb-ok');
const cancelBtn = document.getElementById('gb-cancel');
const wishBtn = document.getElementById('gb-wishbtn');
if (wishBtn) wishBtn.addEventListener('click', function () {
if (!wishMyAdd(gift)) { toast('已在心愿单里啦'); return; }
wishBtn.textContent = '✓ 已在心愿单';
toast('已加入我的心愿单');
});
if (okBtn) okBtn.addEventListener('click', function () {
const wish = (wishEl && wishEl.value || '').trim() || (gift.wish || '心意');
if (buyAndSend(gift, 'out', wish)) {
wishTaRemove(gift.id);
closeTc(); if (!chatOnScreen()) toast('已送出');
if (opts.onDone) { try { opts.onDone(); } catch (e) {} }
}
});
if (cancelBtn) cancelBtn.addEventListener('click', closeTc);
}
let wishTab = 'my';
function wishRowHtml(it, mode) {
const col = CAT_COLOR[it.cat] || '#f5f3fa';
const act = mode === 'my'
? '<button class="wish-act del" data-wdel="' + esc(it.giftId) + '" type="button">移除</button>'
: '<button class="wish-act" data-wbuy="' + esc(it.giftId) + '" type="button">送 TA</button>';
return '<div class="wish-item">' +
'<div class="wish-emoji" style="background:' + col + ';">' + giftMedia(it, 'wish-img') + '</div>' +
'<div class="wish-info">' +
'<div class="wish-name">' + esc(it.name) + '</div>' +
'<div class="wish-price">¥' + Number(it.price || 0).toFixed(2) + '</div>' +
'<div class="wish-wish">"' + esc(it.wish || '送给你') + '"</div>' +
'</div>' + act +
'</div>';
}
function renderWishPanel() {
if (!window.openTCPanel) { toast('稍后再试'); return; }
const my = wishLoad(WL_MY_KEY);
const ta = wishLoad(WL_TA_KEY);
const taNew = taWishUnread();
const list = wishTab === 'my' ? my : ta;
const stG = wlSettings();
const hint = wishTab === 'my'
? (taNew ? '有 ' + taNew + ' 条是 ' + esc(partnerName()) + ' 新许的愿——点上方「' + esc(partnerName()) + ' 的心愿单」这一栏看。\n' : '')
+ (stG.giftInOn
? '在市集点开商品选「加入心愿单」即可许愿（不花钱）。' + esc(partnerName()) + ' 会按概率买下送你，礼物进「心意柜-收到的」并从心愿单移除；概率在「心意集市和心意柜设置」里可调。'
: '在市集点开商品选「加入心愿单」即可许愿（不花钱）。「TA 送我礼物」总开关当前关闭，TA 不会买下心愿；想恢复去「心意集市和心意柜设置」打开。')
: '这里是 ' + esc(partnerName()) + ' 许的愿望（TA 逛市集时也会按概率把想要的加进来，并有概率把这份心愿发一张卡片到聊天提醒你）。点「送 TA」买下送出：礼物进聊天和 TA 的心意柜-收到的，并自动从心愿单移除；市集里 TA 正许愿的商品也会标出来。';
const emptyTxt = wishTab === 'my'
? '心愿单还是空的<br>去心意市集挑一件，点「加入心愿单」'
: (esc(partnerName()) + ' 还没许愿<br>TA 逛市集时会自己加进来');
const html =
'<div class="wish-tabs">' +
'<button class="wish-tab' + (wishTab === 'my' ? ' sel' : '') + '" data-wtab="my" type="button">我的心愿单 (' + my.length + ')</button>' +
'<button class="wish-tab' + (wishTab === 'ta' ? ' sel' : '') + '" data-wtab="ta" type="button">' + esc(partnerName()) + ' 的心愿单 (' + ta.length + ')' + (taNew ? '<i class="wish-badge">' + taNew + '</i>' : '') + '</button>' +
'</div>' +
'<div class="wish-hint">' + hint + '</div>' +
(list.map(function (it) { return wishRowHtml(it, wishTab); }).join('') || '<div class="gift-empty">' + emptyTxt + '</div>') +
'<div class="gs-help">【使用说明】<br>· 心愿单只是许愿，不花钱；TA 按概率买下送你后自动移除。<br>· 「TA 的心愿单」里的礼物可点「送 TA」买下送出（正常聊天送礼 + 心意柜记录）。<br>· TA 的相关行为可在「心意集市和心意柜设置」里开关与自定义概率。</div>';
window.openTCPanel('心愿单', html);
if (wishTab === 'ta') { taWishMarkSeen(); try { syncWishBadge(); } catch (e) {} }
document.querySelectorAll('#tc-body [data-wtab]').forEach(function (b) {
b.addEventListener('click', function () { wishTab = b.dataset.wtab; renderWishPanel(); });
});
document.querySelectorAll('#tc-body [data-wdel]').forEach(function (b) {
b.addEventListener('click', function () {
wishSave(WL_MY_KEY, wishLoad(WL_MY_KEY).filter(function (x) { return x.giftId !== b.dataset.wdel; }));
renderWishPanel();
});
});
document.querySelectorAll('#tc-body [data-wbuy]').forEach(function (b) {
b.addEventListener('click', function () {
const it = ta.find(function (x) { return x.giftId === b.dataset.wbuy; });
if (!it) return;
closeTc();
openBuyDialog(Object.assign({}, it, { id: it.giftId }), { fromTaWish: true });
});
});
}
function openGiftSettings() {
if (!window.openTCPanel) { toast('稍后再试'); return; }
const st = wlSettings();
const html =
'<div class="gs-row"><div class="gs-lab">TA 送我礼物<span class="gs-sub">总开关，关闭后 TA 不会买礼物送你（心愿单兑现、随机送礼都停）；默认开启</span></div><div class="gs-switch' + (st.giftInOn ? ' on' : '') + '" data-gsw="giftInOn"></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 送我礼物概率</div><div class="gs-numwrap"><input class="gs-num" data-gsn="giftInPct" type="number" min="0" max="100" inputmode="numeric" value="' + st.giftInPct + '"><span class="gs-pct">%</span></div></div>' +
'<div class="gs-row"><div class="gs-lab">心愿单功能<span class="gs-sub">TA 买我的心愿单礼物送我 / TA 把想要的加进自己的心愿单</span></div><div class="gs-switch' + (st.wlOn ? ' on' : '') + '" data-gsw="wlOn"></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 买下我的心愿单概率</div><div class="gs-numwrap"><input class="gs-num" data-gsn="wlBuyPct" type="number" min="0" max="100" inputmode="numeric" value="' + st.wlBuyPct + '"><span class="gs-pct">%</span></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 加进自己心愿单概率</div><div class="gs-numwrap"><input class="gs-num" data-gsn="wlAddPct" type="number" min="0" max="100" inputmode="numeric" value="' + st.wlAddPct + '"><span class="gs-pct">%</span></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 的心愿发到聊天<span class="gs-sub">TA 把商品加进自己心愿单时，按概率把这份心愿发一张卡片到聊天，你点【送 TA】即可买下送出；默认开启</span></div><div class="gs-switch' + (st.wishChatOn ? ' on' : '') + '" data-gsw="wishChatOn"></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 心愿发到聊天概率</div><div class="gs-numwrap"><input class="gs-num" data-gsn="wishChatPct" type="number" min="0" max="100" inputmode="numeric" value="' + st.wishChatPct + '"><span class="gs-pct">%</span></div></div>' +
'<div class="gs-row"><div class="gs-lab">我送礼后 TA 回一句<span class="gs-sub">总开关：我送出的每一份礼物（市集、心意柜、TA 心愿卡上点【送 TA】都算）都有概率换 TA 回一句；默认开启</span></div><div class="gs-switch' + (st.giftReplyOn ? ' on' : '') + '" data-gsw="giftReplyOn"></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 回一句概率</div><div class="gs-numwrap"><input class="gs-num" data-gsn="giftReplyPct" type="number" min="0" max="100" inputmode="numeric" value="' + st.giftReplyPct + '"><span class="gs-pct">%</span></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 回什么<span class="gs-sub">点一下切换</span></div><div class="gs-pick" id="gs-gift-reply-mode" data-v="' + st.giftReplyMode + '">' + giftReplyModeLabel(st.giftReplyMode) + '</div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 自己买礼物<span class="gs-sub">买给自己的礼物收进「心意柜-TA 自己买的」</span></div><div class="gs-switch' + (st.selfOn ? ' on' : '') + '" data-gsw="selfOn"></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 自买礼物发到聊天<span class="gs-sub">TA 给自己买的礼物同时发一张礼物卡到聊天，方便你查看；默认开启</span></div><div class="gs-switch' + (st.selfChatOn ? ' on' : '') + '" data-gsw="selfChatOn"></div></div>' +
'<div class="gs-row"><div class="gs-lab">TA 自己买概率</div><div class="gs-numwrap"><input class="gs-num" data-gsn="selfPct" type="number" min="0" max="100" inputmode="numeric" value="' + st.selfPct + '"><span class="gs-pct">%</span></div></div>' +
'<div class="gs-help">【使用说明】<br>· TA 送我礼物：总开关，默认开启；关闭后 TA 不会买礼物送你（心愿单兑现与随机送礼都不触发）；TA 给自己买礼物、加自己的心愿单不受影响，我送礼给 TA 也不受影响。<br>· TA 送我礼物概率：TA 每次心动时主动从市集挑一份送你的概率（进聊天 +「心意柜-收到的」），0~100 自定义。<br>· 我的心愿单：市集点开商品选「加入心愿单」许愿（不花钱）；TA 按概率直接买下送你，礼物进「心意柜-收到的」，心愿单自动移除。<br>· TA 的心愿单：TA 会把想要的加进来；点「送 TA」买下送出，礼物进 TA 的心意柜-收到的并自动移除该心愿。市集里 TA 正许愿的商品会标出「☆ TA许愿的」，从这里进也行。<br>· TA 的心愿发到聊天：TA 把商品加进自己心愿单的那一刻，按概率把这份心愿发一张卡片到聊天（默认开启、默认 60%），卡片上点【送 TA】就能买下送出，送完卡片自动变「已送出」；关掉开关或概率调 0，TA 就只默默加进心愿单、不再发卡片（聊天仍可在心意柜「看看 TA 的心愿单」里看到）。<br>· 我送礼后 TA 回一句：我送出的每一份礼物都有概率让 TA 回一句（默认开启、默认 60%），市集、心意柜、TA 心愿卡上点【送 TA】都算；这份礼物正好是 TA 心愿单里许着的，话术走「心愿兑现」那一套。「TA 回什么」三档＝只用系统预设话术 / 和正常聊天一样回复（走字卡与词典管线，带「正在输入…」）/ 混合（约六成预设、四成聊天式）；关掉开关或概率调 0，TA 就只默默收下礼物、不再回话（礼物照常进 TA 的心意柜）。<br>· TA 自己买：TA 按概率给自己买礼物，收进「心意柜-TA 自己买的」，不发聊天消息。<br>· 概率=每次触发（我发消息后）TA 采取该行动的概率，0~100 自定义；「TA 送我礼物」（心愿单兑现＋随机送礼）每天最多 3 次，「TA 自己买礼物」另有独立额度、两者互不挤占；关掉开关即完全关闭对应行为。</div>';
window.openTCPanel('心意集市和心意柜设置', html);
document.querySelectorAll('#tc-body [data-gsw]').forEach(function (sw) {
sw.addEventListener('click', function () {
const cur = wlSettings();
cur[sw.dataset.gsw] = cur[sw.dataset.gsw] ? 0 : 1;
wlSettingsSave(cur);
sw.classList.toggle('on', !!cur[sw.dataset.gsw]);
toast('已保存');
});
});
document.querySelectorAll('#tc-body [data-gsn]').forEach(function (inp) {
inp.addEventListener('change', function () {
const cur = wlSettings();
const key = inp.dataset.gsn;
const n = Math.round(Number(inp.value));
if (String(inp.value).trim() === '' || !isFinite(n) || n < 0 || n > 100) {
inp.value = String(cur[key]);
toast('请填 0~100 的整数');
return;
}
cur[key] = n;
wlSettingsSave(cur);
toast('已保存');
});
});
const modeEl = document.getElementById('gs-gift-reply-mode');
if (modeEl && window.openModal) {
modeEl.addEventListener('click', function () {
const cur = wlSettings();
window.openModal('我送礼后 TA 回什么', '', function (v) {
const n = Math.round(Number(v));
if (n !== 0 && n !== 1 && n !== 2) return;
const next = wlSettings();
next.giftReplyMode = n;
wlSettingsSave(next);
modeEl.textContent = giftReplyModeLabel(n);
modeEl.dataset.v = String(n);
toast('已保存');
}, { noInput: true, pill: String(clampMode(cur.giftReplyMode, 1)), pills: GIFT_REPLY_MODES.map(function (m) { return { label: m.label, value: String(m.value) }; }) });
});
}
}
let giftPanel = null;
let panelCat = '全部';
let searchText = '';
function renderGiftCats(containerId, mode, onPick) {
const el = document.getElementById(containerId); if (!el) return;
const cats = ['全部'].concat(CATS);
if (mode === 'icon') {
el.innerHTML = cats.map(function (c) {
const ico = c === '全部' ? '🎁' : (CAT_ICON[c] || '🎁');
const col = c === '全部' ? '#f3e5f5' : (CAT_COLOR[c] || '#f5f3fa');
return '<button class="market-cat' + (c === panelCat ? ' sel' : '') + '" data-cat="' + esc(c) + '">' +
'<div class="market-cat-ico" style="background:' + col + ';">' + ico + '</div>' +
'<div class="market-cat-name">' + esc(c) + '</div>' +
'</button>';
}).join('');
} else {
el.innerHTML = cats.map(function (c) { return '<button class="gift-cat' + (c === panelCat ? ' sel' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
}
el.querySelectorAll('[data-cat]').forEach(function (b) { b.addEventListener('click', function () { panelCat = b.dataset.cat; onPick(); }); });
}
function giftsByCat(gifts) { return (panelCat === '全部') ? gifts : gifts.filter(function (g) { return g.cat === panelCat; }); }
function normTxt(s) { return String(s == null ? '' : s).toLowerCase(); }
function filterGifts(gifts) {
const q = normTxt(searchText).trim();
if (!q) return giftsByCat(gifts);
return gifts.filter(function (g) {
return normTxt(g.name).indexOf(q) >= 0 || normTxt(g.wish).indexOf(q) >= 0 || normTxt(g.cat).indexOf(q) >= 0;
});
}
function searchRowHtml(id) {
return '<div class="market-search-row">' +
'<input class="market-search" id="' + id + '" type="text" placeholder="搜索商品" maxlength="20" autocomplete="off" enterkeyhint="search">' +
'<button class="market-search-clear" id="' + id + '-clear" type="button" hidden>✕</button>' +
'</div>';
}
function bindSearchRow(id, onRerender) {
const inp = document.getElementById(id); if (!inp) return;
const clr = document.getElementById(id + '-clear');
const sync = function () {
searchText = String(inp.value == null ? '' : inp.value);
if (clr) clr.hidden = searchText.length === 0;
onRerender();
};
inp.addEventListener('input', sync);
if (clr) clr.addEventListener('click', function () { inp.value = ''; sync(); });
}
function resetSearchInput(id) {
searchText = '';
const inp = document.getElementById(id);
if (inp && inp.value) inp.value = '';
const clr = document.getElementById(id + '-clear');
if (clr) clr.hidden = true;
}
function giftMedia(g, cls) {
if (g && g.img) return '<img class="' + cls + '" src="' + esc(g.img) + '" alt="">';
return esc((g && g.emoji) || '🎁');
}
function giftItemHtml(g, manage) {
const col = CAT_COLOR[g.cat] || '#f5f3fa';
const taWanted = taWishIds().has(g.id); // #588：走记忆化集合，不再每件一次 JSON.parse
return '<button class="gift-item' + (manage ? ' manage' : '') + (taWanted ? ' ta-wish' : '') + '" data-id="' + esc(g.id) + '" style="--cat:' + col + ';">' +
(taWanted ? '<span class="gift-item-tawish" title="' + esc(partnerName()) + '许愿的">☆ ' + esc(partnerName()) + '想要的</span>' : '') +
'<div class="gift-item-top" style="background:linear-gradient(160deg,' + col + ',var(--card-bg,#fff));">' +
'<div class="gift-item-emoji">' + giftMedia(g, 'gift-item-img') + '</div>' +
'</div>' +
'<div class="gift-item-body">' +
'<div class="gift-item-name">' + esc(g.name) + '</div>' +
'<div class="gift-item-price">¥' + Number(g.price || 0).toFixed(2) + '</div>' +
'</div>' +
(manage ? '<span class="gift-item-edit" data-edit="' + esc(g.id) + '">✎</span><span class="gift-item-del" data-del="' + esc(g.id) + '">✕</span>' : '') +
'</button>';
}
function renderGiftGrid(containerId, gifts, onPick, manage) {
const el = document.getElementById(containerId); if (!el) return;
const list = filterGifts(gifts);
const q = normTxt(searchText).trim();
if (!list.length && !q && window.mochiDataPending && window.mochiDataPending()) {
el.innerHTML = window.mochiLoadingHtml('礼物商品');
return;
}
const emptyTxt = q ? ('没找到「' + q + '」相关商品') : '还没有商品，点下方添加';
el.innerHTML = list.map(function (g) { return giftItemHtml(g, manage); }).join('') || '<div class="gift-empty">' + esc(emptyTxt) + '</div>';
el.querySelectorAll('.gift-item').forEach(function (b) {
b.addEventListener('click', function (e) {
if (manage) { const g0 = gifts.find(function (x) { return x.id === b.dataset.id; }); if (g0) openAddGiftForm(g0); return; }
const g = gifts.find(function (x) { return x.id === b.dataset.id; });
if (g) onPick(g);
});
});
if (manage) {
el.querySelectorAll('.gift-item-del').forEach(function (d) {
d.addEventListener('click', function (e) {
e.stopPropagation();
const id = d.dataset.del;
if (!window.openModal) return;
window.openModal(DEF_IDS[id] ? '删除默认商品？（可稍后恢复默认）' : '删除这个商品？', '', function () { deleteGift(id); renderMarket(); }, { noInput: true });
});
});
el.querySelectorAll('.gift-item-edit').forEach(function (d) {
d.addEventListener('click', function (e) {
e.stopPropagation();
const g = gifts.find(function (x) { return x.id === d.dataset.edit; });
if (g) openAddGiftForm(g);
});
});
}
}
function giftPanelPick(g) { closeGiftPanel(); openBuyDialog(g); }
function giftPanelRerender() {
renderGiftCats('gift-cats', 'pill', giftPanelRerender);
renderGiftGrid('gift-grid', giftsLoad(), giftPanelPick, false);
}
function openGiftPanel() {
giftPanel = document.getElementById('chat-gift-panel');
if (!giftPanel) return;
const closeOthers = ['poke-card', 'emoji-panel', 'chat-ask-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel', 'chat-rps-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'avlib-card'];
closeOthers.forEach(function (id) { const e = document.getElementById(id); if (e) e.hidden = true; });
if (window.closeAvlib) try { window.closeAvlib(); } catch (e) {}
const mp = document.getElementById('chat-more-panel'); if (mp) mp.hidden = true;
const nm = document.getElementById('gift-partner-name'); if (nm) nm.textContent = partnerName();
const gwBtn0 = document.getElementById('gift-wish-ta'); if (gwBtn0) gwBtn0.textContent = '看看 ' + partnerName() + ' 的心愿单';
const bal = document.getElementById('gift-balance'); if (bal) bal.textContent = walletText();
panelCat = '全部'; resetSearchInput('gift-search');
giftPanelRerender();
if (window.closeIme) try { window.closeIme(); } catch (e) {}
giftPanel.hidden = false;
}
function closeGiftPanel() { if (giftPanel) giftPanel.hidden = true; }
window.openGiftPanel = openGiftPanel;
if (window.mochiSheetOutsideClose) window.mochiSheetOutsideClose(document.getElementById('chat-gift-panel'), closeGiftPanel);
let marketPage = null, marketManage = false;
function renderMarket() {
syncGiftNames();
const bal = document.getElementById('market-balance'); if (bal) bal.textContent = walletText();
const addBtn = document.getElementById('market-add'); if (addBtn) addBtn.textContent = marketManage ? '完成' : '＋ 上传商品';
const mgBtn = document.getElementById('market-manage'); if (mgBtn) mgBtn.textContent = marketManage ? '完成' : '管理';
const resetBtn = document.getElementById('market-reset');
if (resetBtn) resetBtn.hidden = !(marketManage && customLoad().some(function (c) { return c && (c.del || c.base); }));
renderGiftCats('market-cats', 'icon', renderMarket);
renderGiftGrid('market-grid', giftsLoad(), function (g) { openBuyDialog(g); }, marketManage);
renderMineCard();
syncWishBadge();
}
function syncWishBadge() {
const btn = document.getElementById('market-wish');
if (!btn) return;
const n = taWishUnread();
btn.innerHTML = '☆ 心愿单' + (n ? '<i class="wish-badge">' + n + '</i>' : '');
}
if (window.mochiOnDataReady) window.mochiOnDataReady(function () {
try { boxMetaInvalidate(); } catch (e) {}   // #985：导入回填后卡片状态按新存储重读
try { const gp = document.getElementById('chat-gift-panel'); if (gp && !gp.hidden) giftPanelRerender(); } catch (e) {}
try { if (marketPage && !marketPage.hidden) renderMarket(); } catch (e) {}
});
function renderMineCard() {
const el = document.getElementById('market-mine');
if (!el) return;
const n = customMine().length;
el.innerHTML =
'<button class="market-mine-add" id="market-mine-add" type="button">' +
'<span class="market-mine-ico">＋</span>' +
'<span class="market-mine-txt">上传我的商品<em>用自己的照片当礼物，放进市集就能送</em></span>' +
'</button>' +
'<div class="market-mine-foot">' +
'<span class="market-mine-cnt" id="market-mine-cnt">' + (n ? '已上传 ' + n + ' 件自定义商品' : '还没上传过商品（默认商品不用上传）') + '</span>' +
'<button class="market-mine-mini" id="market-mine-export" type="button">导出商品数据</button>' +
'<button class="market-mine-mini" id="market-mine-import" type="button">导入商品数据</button>' +
'</div>';
}
function packBytes(s) { try { return new Blob([s]).size; } catch (e) { return String(s || '').length; } }
function packSizeText(n) {
if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
if (n > 1024) return Math.round(n / 1024) + ' KB';
return n + ' B';
}
function packDay() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function marketGoodsJson(items) {
const parts = ['{"app":"' + GOODS_PACK_APP + '","version":"1.0","kind":"market-goods","exportTime":"' + new Date().toISOString() + '","goods":['];
items.forEach(function (g, i) {
if (i) parts.push(',');
parts.push(JSON.stringify({ id: g.id, name: g.name, emoji: g.emoji, img: g.img || '', price: g.price, cat: g.cat, wish: g.wish }));
});
parts.push(']}');
return parts.join('');
}
function exportMarketGoods() {
const items = customMine();
if (!items.length) { toast('还没有自定义商品，点上面「上传我的商品」先加一件'); return; }
const json = marketGoodsJson(items);
const bytes = packBytes(json);
if (!window.openModal) return;
window.openModal('导出商品数据？', '', function () {
const fname = 'mochi心意商品_' + packDay() + '.json';
if (window.mochiExportFile) window.mochiExportFile(json, fname, '导出商品数据');
else toast('导出功能暂不可用，请稍后再试');
}, { noInput: true, staticText: [
'将把这 ' + items.length + ' 件自定义商品（含图片）导出成一个文件，约 ' + packSizeText(bytes) + '。',
'文件里只有你上传的商品：默认商品、对默认商品的修改与删除、心意币、心愿单、心意柜记录都不包含。',
'在别的手机或桌面用「导入商品数据」选这个文件即可还原；同一件商品（名字/分类/价格/图片都一样）会自动跳过，不会翻倍。'
].join('\n') });
}
function readPickText(file) {
return new Promise(function (resolve) {
if (!file) { resolve(''); return; }
if (typeof file.text === 'function') { file.text().then(resolve).catch(function () { viaReader(); }); return; }
viaReader();
function viaReader() {
try {
const r = new FileReader();
r.onload = function () { resolve(String(r.result || '')); };
r.onerror = function () { resolve(''); };
r.readAsText(file, 'utf-8');
} catch (e) { resolve(''); }
}
});
}
function importMarketGoods() {
if (!window.mochiFilePick) { toast('导入功能暂不可用，请稍后再试'); return; }
window.mochiFilePick({
id: 'market-goods-import-pick', accept: '.json,application/json',
onFiles: function (files) {
const f = files && files[0];
if (!f) { toast('没有取到文件，请再选一次'); return; }
readPickText(f).then(function (text) {
let data = null;
try { data = JSON.parse(text || 'null'); } catch (e) {}
const raw = goodsFromPack(data);
if (!raw) { toast('这个文件里没有商品数据'); return; }
const plan = mergeGoods(customLoad(), raw);
if (!plan.added && !plan.updated) {
toast(plan.skipped ? ('这 ' + plan.skipped + ' 件商品都已在你的商品库里，没有新增') : '文件里没有可导入的商品');
return;
}
const lines = ['从文件里读到 ' + raw.length + ' 件商品：新增 ' + plan.added + ' 件'
+ (plan.updated ? '、更新 ' + plan.updated + ' 件' : '')
+ (plan.skipped ? '、跳过已存在的 ' + plan.skipped + ' 件' : '') + '。'];
if (plan.bad) lines.push('另有 ' + plan.bad + ' 件格式不对（缺名字 / 不是商品数据），已忽略。');
if (plan.over) lines.push('还有 ' + plan.over + ' 件会让商品库体积过大，本次没有导入（可删掉一些旧商品再导一次）。');
lines.push('导入后你的默认商品、心意币、心愿单、心意柜记录都不受影响。');
if (!window.openModal) return;
window.openModal('导入商品数据？', '', function (v) {
const replace = (v === 'replace');
const base = replace ? customLoad().filter(function (c) { return c && (c.del || c.base); }) : customLoad();
const done = mergeGoods(base, raw);
try { customSave(done.list); } catch (e) { toast('导入失败：本地存储写入出错，先清理一些旧商品再试'); return; }
closeTc();
renderMarket();
toast(replace ? ('已替换为文件里的 ' + (done.added + done.updated) + ' 件商品') : ('已导入 ' + done.added + ' 件商品'));
}, { noInput: true, staticText: lines.join('\n'), pill: 'merge', pills: [
{ label: '合并（已有的保留，缺的补上）', value: 'merge' },
{ label: '先清空我的商品再导入', value: 'replace' }
] });
});
}
});
}
let gmImg = '';
const gmImgInput = document.createElement('input');
gmImgInput.id = 'gm-img-input';
gmImgInput.type = 'file'; gmImgInput.accept = 'image/*';
gmImgInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
try { document.body.appendChild(gmImgInput); } catch (e) {}
gmImgInput.onchange = function () {
const f = gmImgInput.files && gmImgInput.files[0];
gmImgInput.value = '';
if (!f) return;
if (!/^image\//.test(f.type || '')) { toast('请选择图片文件'); return; }
const reader = new FileReader();
reader.onload = function () {
compressGiftImg(String(reader.result || '')).then(function (data) {
if (!data) { toast('图片处理失败，换一张试试'); return; }
gmImg = data;
renderGmImgRow();
});
};
reader.onerror = function () { toast('图片读取失败'); };
reader.readAsDataURL(f);
};
function compressGiftImg(dataUrl) {
return new Promise(function (resolve) {
if (typeof dataUrl !== 'string' || dataUrl.length > 8 * 1024 * 1024) { resolve(null); return; }
const img = new Image();
img.onload = function () {
try {
if (img.width * img.height > 26000000) { resolve(null); return; }
const scale = Math.min(1, 480 / Math.max(img.width, img.height));
const w = Math.max(1, Math.round(img.width * scale));
const h = Math.max(1, Math.round(img.height * scale));
const c = document.createElement('canvas');
c.width = w; c.height = h;
const ctx = c.getContext('2d');
ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
ctx.drawImage(img, 0, 0, w, h);
resolve(c.toDataURL('image/jpeg', 0.85));
} catch (e) { resolve(null); }
};
img.onerror = function () { resolve(null); };
img.src = dataUrl;
});
}
function gmImgRowHtml() {
return '<div class="gm-img-row">' +
'<div class="gm-img-prev" id="gm-img-prev">' + (gmImg ? '<img src="' + esc(gmImg) + '" alt="">' : '🖼️') + '</div>' +
'<button class="gm-img-btn" id="gm-img-pick" type="button">' + (gmImg ? '换一张' : '上传图片') + '</button>' +
(gmImg ? '<button class="gm-img-btn gm-img-clear" id="gm-img-clear" type="button">清除</button>' : '') +
'</div>';
}
function renderGmImgRow() {
const row = document.getElementById('gm-img-row');
if (row) row.innerHTML = gmImgRowHtml();
bindGmImgRow();
}
function bindGmImgRow() {
const pick = document.getElementById('gm-img-pick');
if (pick) pick.addEventListener('click', function () { window.mochiFilePickFire(gmImgInput, { onFail: function () { toast('无法打开相册，请重试'); } }); });
const clr = document.getElementById('gm-img-clear');
if (clr) clr.addEventListener('click', function () { gmImg = ''; renderGmImgRow(); });
}
function openAddGiftForm(editGift) {
if (!window.openTCPanel) { toast('稍后再试'); return; }
const g = editGift || {};
gmImg = g.img || '';
const catOpts = CATS.map(function (c) { return '<option value="' + esc(c) + '"' + (c === g.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
const html =
'<div class="gm-form">' +
'<div class="gm-row"><label>商品图片（可选，不传用 emoji）</label><div id="gm-img-row">' + gmImgRowHtml() + '</div></div>' +
'<div class="gm-row"><label>名字</label><input class="gm-input" id="gm-name" type="text" maxlength="10" value="' + esc(g.name || '') + '" placeholder="礼物名"></div>' +
'<div class="gm-row"><label>emoji</label><input class="gm-input" id="gm-emoji" type="text" maxlength="6" value="' + esc(g.emoji || '') + '" placeholder="🎁"></div>' +
'<div class="gm-row"><label>价格</label><input class="gm-input" id="gm-price" type="number" min="0" step="0.01" value="' + (g.price != null ? g.price : '') + '" placeholder="0"></div>' +
'<div class="gm-row"><label>分类</label><select class="gm-input" id="gm-cat">' + catOpts + '</select></div>' +
'<div class="gm-row"><label>默认留言</label><textarea class="gm-input" id="gm-wish" maxlength="40" placeholder="送给你">' + esc(g.wish || '') + '</textarea></div>' +
'</div>' +
'<div class="gb-actions">' +
'<button class="gb-cancel" id="gm-cancel" type="button">取消</button>' +
'<button class="gb-ok" id="gm-ok" type="button">保存</button>' +
'</div>';
window.openTCPanel(editGift ? (DEF_IDS[g.id] ? '编辑默认商品' : '编辑商品') : '添加商品', html);
bindGmImgRow();
const okBtn = document.getElementById('gm-ok');
const cancelBtn = document.getElementById('gm-cancel');
if (okBtn) okBtn.addEventListener('click', function () {
const name = (document.getElementById('gm-name').value || '').trim();
const emoji = (document.getElementById('gm-emoji').value || '').trim() || '🎁';
const price = Math.max(0, parseFloat(document.getElementById('gm-price').value) || 0);
const cat = document.getElementById('gm-cat').value || '关怀';
const wish = (document.getElementById('gm-wish').value || '').trim() || '送给你';
if (!name) { toast('先填名字'); return; }
const item = { id: editGift ? editGift.id : ('g_custom_' + Date.now()), name: name, emoji: emoji, img: gmImg, price: price, cat: cat, wish: wish };
const customs = customLoad();
if (editGift && DEF_IDS[item.id]) {
const merged = Object.assign({}, DEF_GIFTS.find(function (x) { return x.id === item.id; }) || {}, item, { base: 1 });
const idx = customs.findIndex(function (x) { return x && x.id === item.id; });
if (idx >= 0) customs[idx] = merged; else customs.push(merged);
} else if (editGift) {
const idx = customs.findIndex(function (x) { return x && x.id === item.id; });
if (idx >= 0) customs[idx] = item; else customs.push(item);
} else {
customs.push(item);
}
customSave(customs); closeTc(); renderMarket(); toast('已保存');
});
if (cancelBtn) cancelBtn.addEventListener('click', closeTc);
}
let giftboxPage = null, boxTab = 'in';
function syncGiftNames() {
const pn = partnerName();
const boxTawish = document.getElementById('giftbox-tawish');
if (boxTawish) boxTawish.textContent = '☆ 看看 ' + pn + ' 的心愿单';
const gwBtn = document.getElementById('gift-wish-ta');
if (gwBtn) gwBtn.textContent = '看看 ' + pn + ' 的心愿单';
}
function boxReplies(it) {
if (!it || !Array.isArray(it.replies)) return [];
return it.replies.filter(function (r) { return r && typeof r.text === 'string' && r.text; });
}
function boxWhoLabel(who) { return who === 'me' ? '我' : partnerName(); }
function boxReplyRows(it) {
return boxReplies(it).map(function (r) {
return '<div class="giftbox-repl-row"><span class="giftbox-repl-who">' + esc(boxWhoLabel(r.who)) + '</span><span class="giftbox-repl-tx">' + esc(r.text) + '</span></div>';
}).join('');
}
function boxPending(it) { return !!(it && it.side === 'in' && it.claimed === 0); }
function renderBox() {
syncGiftNames();
const list = boxLoad();
const inList = list.filter(function (x) { return x.side === 'in'; });
const outList = list.filter(function (x) { return x.side === 'out'; });
const selfList = list.filter(function (x) { return x.side === 'self'; });
const statIn = document.getElementById('giftbox-stat-in');
const statOut = document.getElementById('giftbox-stat-out');
const statSelf = document.getElementById('giftbox-stat-self');
if (statIn) statIn.textContent = String(inList.length);
if (statOut) statOut.textContent = String(outList.length);
if (statSelf) statSelf.textContent = String(selfList.length);
const tabs = document.querySelectorAll('.gb-tab');
tabs.forEach(function (t) {
t.classList.toggle('sel', t.dataset.btab === boxTab);
const bt = t.dataset.btab;
t.textContent = bt === 'in' ? (partnerName() + ' 送我的') : bt === 'out' ? ('我送 ' + partnerName() + ' 的') : (partnerName() + ' 自己买的');
});
const show = (boxTab === 'in' ? inList : boxTab === 'out' ? outList : selfList).slice().sort(function (a, b) { return b.tm - a.tm; });
const el = document.getElementById('giftbox-list'); if (!el) return;
el.innerHTML = show.map(function (it) {
const from = it.side === 'in' ? esc(partnerName()) + ' 送我' : it.side === 'self' ? esc(partnerName()) + ' 自己买的' : '我 送 ' + esc(partnerName());
return '<div class="giftbox-card" data-id="' + esc(it.id) + '">' +
'<div class="giftbox-card-top">' +
'<div class="giftbox-emoji">' + giftMedia(it, 'giftbox-emoji-img') + '</div>' +
'</div>' +
'<div class="giftbox-card-body">' +
'<div class="giftbox-name">' + esc(it.name) + '</div>' +
'<div class="giftbox-price">¥' + Number(it.price || 0).toFixed(2) + '</div>' +
'<div class="giftbox-wish">"' + esc(it.wish || '心意') + '"</div>' +
(boxPending(it) ? '<div class="giftbox-pending">待领取</div>' : '') +
(boxReplies(it).length ? '<div class="giftbox-repls">' + boxReplyRows(it) + '</div>' : '') +
'<div class="giftbox-meta">' + esc(from) + ' · ' + esc(fmtTime(it.tm)) + '</div>' +
'</div>' +
'</div>';
}).join('') || '<div class="gift-empty">' + (boxTab === 'in' ? (esc(partnerName()) + ' 还没送你礼物<br>' + (window.taFit ? window.taFit('他偶尔会主动从市集挑一份给你，耐心等等') : '他偶尔会主动从市集挑一份给你，耐心等等')) : boxTab === 'self' ? (esc(partnerName()) + ' 还没给自己买过礼物<br>TA 偶尔会按概率给自己挑一件，收进自己的心意柜') : ('你还没送出礼物<br>去心意市集挑一份送给 ' + esc(partnerName()) + ' 吧')) + '</div>';
el.querySelectorAll('.giftbox-card').forEach(function (c) {
c.addEventListener('click', function () {
const it = list.find(function (x) { return x.id === c.dataset.id; });
if (!it || !window.openTCPanel) return;
const from = it.side === 'in' ? esc(partnerName()) + ' 送我' : it.side === 'self' ? esc(partnerName()) + ' 自己买的' : '我 送 ' + esc(partnerName());
const html =
'<div class="gb-detail">' +
'<div class="gb-detail-emoji">' + giftMedia(it, 'gb-detail-emoji-img') + '</div>' +
'<div class="gb-detail-name">' + esc(it.name) + '</div>' +
'<div class="gb-detail-price">¥' + Number(it.price || 0).toFixed(2) + '</div>' +
'<div class="gb-detail-wish">"' + esc(it.wish || '心意') + '"</div>' +
'<div class="gb-detail-meta">' + esc(from) + ' · ' + esc(fmtTime(it.tm)) + '</div>' +
(boxPending(it) ? '<div class="giftbox-pending gb-detail-pending">待领取</div>' : '') +
(boxReplies(it).length
? '<div class="gb-detail-repl-title">这件礼物上的回复</div><div class="gb-detail-repls">' + boxReplyRows(it) + '</div>'
: '') +
'</div>';
window.openTCPanel('心意柜', html);
});
});
}
function openPage(pg) {
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
pg.hidden = false;
requestAnimationFrame(function () {
const tabbar = document.querySelector('.tabbar'); if (tabbar) tabbar.hidden = true;
const phone = document.querySelector('.phone'); if (phone) phone.classList.add('no-statusbar');
pg.classList.add('full');
});
}
function backHome() {
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
const home = document.getElementById('page-phone'); if (home) home.hidden = false;
const tabbar = document.querySelector('.tabbar'); if (tabbar) tabbar.hidden = false;
const phone = document.querySelector('.phone'); if (phone) phone.classList.remove('no-statusbar');
}
const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const MARKET_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M6 8a6 6 0 0112 0"/><path d="M12 8v4"/></svg>';
const BOX_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18"/><path d="M12 8V5"/><path d="M9 5h6"/></svg>';
function makeApp(app, name, svg) {
const a = document.createElement('div');
a.className = 'app'; a.setAttribute('data-app', app); a.setAttribute('data-desk-widget', 'app-' + app);
a.innerHTML = '<div class="app-ico">' + svg + '</div><div class="app-name">' + name + '</div>';
return a;
}
function injectDeskApps(pairs) {
const st = store();
let layArr = null;
try { if (st) layArr = JSON.parse(st.get('desk-layout') || 'null'); } catch (e) {}
const hasLayout = Array.isArray(layArr);
const ids = pairs.map(function (p) { return p.id; });
const alreadyInLay = hasLayout && layArr.some(function (pg) { return (pg || []).some(function (w) { return ids.indexOf(w) >= 0; }); });
let placed = false;
if (hasLayout && !alreadyInLay) {
const pagesBox = document.getElementById('desktop-pages');
if (pagesBox) {
const curCnt = pagesBox.querySelectorAll('.page-slide').length;
if (curCnt < 5) {
const slide = document.createElement('div');
slide.className = 'page-slide desk-page';
slide.dataset.desk = String(curCnt);
const grid = document.createElement('div');
grid.className = 'app-grid';
pairs.forEach(function (p) { grid.appendChild(p.el); });
slide.appendChild(grid);
pagesBox.appendChild(slide);
try { st.set('desk-page-count', String(curCnt + 1)); layArr.push(ids.slice()); st.set('desk-layout', JSON.stringify(layArr)); } catch (e) {}
try { if (window.deskRebuild) window.deskRebuild(); } catch (e) {}
placed = true;
}
}
}
if (!placed) {
pairs.forEach(function (p) {
const p3 = document.querySelector('.app-grid.p3-grid');
if (p3) p3.appendChild(p.el); else { const p2 = document.querySelector('.app-grid.p2-grid'); if (p2) p2.appendChild(p.el); }
});
try { if (window.applyDeskLayout) window.applyDeskLayout(); } catch (e) {}
}
}
function buildMarketPage(host) {
marketPage = document.createElement('div');
marketPage.className = 'page'; marketPage.id = 'page-market'; marketPage.hidden = true;
marketPage.innerHTML =
'<div class="chat-head"><span class="ch-back" id="market-back">' + BACK_SVG + '</span><span class="ch-name">心意市集</span></div>' +
'<div class="market-body">' +
'<div class="market-hero">' +
'<div class="market-hero-title">心意市集</div>' +
'<div class="market-hero-sub">挑一份心意，跨越两个世界送给 TA</div>' +
'<div class="market-balance" id="market-balance"></div>' +
'</div>' +
'<div class="market-mine" id="market-mine"></div>' +
'<div class="market-cats" id="market-cats"></div>' +
searchRowHtml('market-search') +
'<div class="market-grid" id="market-grid"></div>' +
'<div class="market-foot">' +
'<button class="market-tool" id="market-wish" type="button">☆ 心愿单</button>' +
'<button class="market-tool" id="market-manage" type="button">管理</button>' +
'<button class="market-tool" id="market-add" type="button">＋ 上传商品</button>' +
'<button class="market-tool" id="market-settings" type="button">设置</button>' +
'<button class="market-tool" id="market-reset" type="button" hidden>恢复默认商品</button>' +
'</div>' +
'</div>';
host.appendChild(marketPage);
document.getElementById('market-back').addEventListener('click', backHome);
bindSearchRow('market-search', renderMarket);
const mineBox = document.getElementById('market-mine');
if (mineBox) mineBox.addEventListener('click', function (e) {
const b = e.target && e.target.closest ? e.target.closest('button') : null;
if (!b || !b.id) return;
if (b.id === 'market-mine-add') openAddGiftForm(null);
else if (b.id === 'market-mine-export') exportMarketGoods();
else if (b.id === 'market-mine-import') importMarketGoods();
});
document.getElementById('market-wish').addEventListener('click', function () { wishTab = taWishUnread() ? 'ta' : 'my'; renderWishPanel(); });
document.getElementById('market-settings').addEventListener('click', openGiftSettings);
document.getElementById('market-add').addEventListener('click', function () { if (marketManage) { marketManage = false; renderMarket(); return; } openAddGiftForm(null); });
document.getElementById('market-manage').addEventListener('click', function () { marketManage = !marketManage; renderMarket(); });
document.getElementById('market-reset').addEventListener('click', function () {
if (!window.openModal) return;
window.openModal('恢复默认商品？（清除对默认商品的修改/删除记录，自定义商品保留）', '', function () {
customSave(customLoad().filter(function (c) { return c && !c.del && !c.base; }));
renderMarket(); toast('已恢复默认');
}, { noInput: true });
});
}
function buildGiftboxPage(host) {
giftboxPage = document.createElement('div');
giftboxPage.className = 'page'; giftboxPage.id = 'page-giftbox'; giftboxPage.hidden = true;
giftboxPage.innerHTML =
'<div class="chat-head"><span class="ch-back" id="giftbox-back">' + BACK_SVG + '</span><span class="ch-name">心意柜</span></div>' +
'<div class="giftbox-hero">' +
'<div class="giftbox-hero-title">心意柜</div>' +
'<div class="giftbox-hero-sub">每一份心意，都值得被珍藏</div>' +
'<div class="giftbox-stat-cards">' +
'<div class="giftbox-stat-card"><div class="giftbox-stat-ico">🎁</div><div class="giftbox-stat-num" id="giftbox-stat-in">0</div><div class="giftbox-stat-lbl">收到</div></div>' +
'<div class="giftbox-stat-card"><div class="giftbox-stat-ico">💌</div><div class="giftbox-stat-num" id="giftbox-stat-out">0</div><div class="giftbox-stat-lbl">送出</div></div>' +
'<div class="giftbox-stat-card"><div class="giftbox-stat-ico">🛍️</div><div class="giftbox-stat-num" id="giftbox-stat-self">0</div><div class="giftbox-stat-lbl">TA自己买</div></div>' +
'</div>' +
'<div class="giftbox-set"><button id="giftbox-tawish" type="button">☆ 看看 ' + esc(partnerName()) + ' 的心愿单</button><button id="giftbox-settings" type="button">⚙ 心意集市和心意柜设置</button></div>' +
'</div>' +
'<div class="giftbox-tabs">' +
'<button class="gb-tab sel" data-btab="in" type="button">收到的</button>' +
'<button class="gb-tab" data-btab="out" type="button">送出的</button>' +
'<button class="gb-tab" data-btab="self" type="button">TA自己买的</button>' +
'</div>' +
'<div class="giftbox-scroll"><div class="giftbox-list" id="giftbox-list"></div></div>';
host.appendChild(giftboxPage);
document.getElementById('giftbox-back').addEventListener('click', function () {
const fromChat = window.__giftboxFrom === 'chat';
window.__giftboxFrom = '';
if (fromChat) {
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
const chat = document.getElementById('page-chat'); if (chat) chat.hidden = false;
const tabbar = document.querySelector('.tabbar'); if (tabbar) tabbar.hidden = false;
const phone = document.querySelector('.phone'); if (phone) phone.classList.remove('no-statusbar');
if (giftboxPage) giftboxPage.classList.remove('full');
} else {
backHome();
}
});
giftboxPage.querySelectorAll('.gb-tab').forEach(function (t) {
t.addEventListener('click', function () { boxTab = t.dataset.btab; renderBox(); });
});
const gbSettings = document.getElementById('giftbox-settings');
if (gbSettings) gbSettings.addEventListener('click', openGiftSettings);
const gbTaWish = document.getElementById('giftbox-tawish');
if (gbTaWish) gbTaWish.addEventListener('click', function () { wishTab = 'ta'; renderWishPanel(); });
}
function init() {
try { migrateMarketGlobal(false); } catch (e) {}
try { rescueNewDefaults(); } catch (e) {}
try { wlUpgradeAndNotify(); } catch (e) {}
document.addEventListener('mochi-restore-done', function () { try { migrateMarketGlobal(true); } catch (e) {} try { rescueNewDefaults(); } catch (e) {} try { wlUpgradeAndNotify(); } catch (e) {} });
const host = (document.getElementById('page-phone') || {}).parentNode || document.body;
buildMarketPage(host);
buildGiftboxPage(host);
['gift-balance', 'market-balance'].forEach(function (id) {
const el = document.getElementById(id);
if (el) el.addEventListener('click', function (e) { e.stopPropagation(); giftEditWallet(); });
});
const marketApp = makeApp('market', '心意市集', MARKET_SVG);
const giftboxApp = makeApp('giftbox', '心意柜', BOX_SVG);
injectDeskApps([{ el: marketApp, id: 'app-market' }, { el: giftboxApp, id: 'app-giftbox' }]);
if (marketApp) marketApp.addEventListener('click', function () { if (editingNow()) return; marketManage = false; panelCat = '全部'; openPage(marketPage); renderMarket(); });
if (giftboxApp) giftboxApp.addEventListener('click', function () { if (editingNow()) return; window.__giftboxFrom = ''; boxTab = 'in'; openPage(giftboxPage); renderBox(); });
document.addEventListener('contact-switched', function () {
try { boxMetaInvalidate(); } catch (e) {}   // #985：切桌面后卡片状态按新桌面重读
try { syncGiftNames(); } catch (e) {}
try { if (giftboxPage && !giftboxPage.hidden) renderBox(); } catch (e) {}
try { if (marketPage && !marketPage.hidden) renderMarket(); } catch (e) {}
});
const gp = document.getElementById('chat-gift-panel');
if (gp) {
const closeBtn = document.getElementById('chat-gift-close');
if (closeBtn) closeBtn.addEventListener('click', closeGiftPanel);
if (!document.getElementById('gift-search')) {
const catsNode = document.getElementById('gift-cats');
if (catsNode) catsNode.insertAdjacentHTML('beforebegin', searchRowHtml('gift-search'));
bindSearchRow('gift-search', giftPanelRerender);
}
if (!document.getElementById('gift-wish-entry')) {
const catsNode2 = document.getElementById('gift-cats');
if (catsNode2) catsNode2.insertAdjacentHTML('beforebegin', '<div class="gift-wish-row" id="gift-wish-entry"><button id="gift-wish-ta" type="button">☆ 看看 ' + esc(partnerName()) + ' 的心愿单</button></div>');
}
const gwBtn = document.getElementById('gift-wish-ta');
if (gwBtn) gwBtn.addEventListener('click', function () {
closeGiftPanel();
wishTab = 'ta';
renderWishPanel();
});
}
const moreGift = document.getElementById('more-gift');
if (moreGift) moreGift.addEventListener('click', function (e) { e.stopPropagation(); openGiftPanel(); });
const moreGiftbox = document.getElementById('more-giftbox');
if (moreGiftbox) moreGiftbox.addEventListener('click', function (e) {
e.stopPropagation();
const mp = document.getElementById('chat-more-panel');
if (mp) mp.hidden = true;
window.__giftboxFrom = 'chat';
boxTab = 'in';
openPage(giftboxPage);
renderBox();
});
}
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else { init(); }
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("gift-shop.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("gift-shop.js"); try { console.error("[JS] gift-shop.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[gift-shop.js] " + String(__e && __e.message || __e)); } })();