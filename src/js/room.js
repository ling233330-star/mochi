// ===== 房间：双人小屋（桌面第三页图标 + 聊天「更多功能」入口；独立全屏页 page-room） =====
// 定位（对齐用户设计文档第一版）：不是装修模拟器、不是任务游戏——
//   「你和 TA 共同拥有一个小屋，慢慢把它变成你们待着的地方」。
// 核心循环：进屋 → 看 TA 在哪/在做什么 → 用一用家具 / 摆一摆家具 → 得一点小屋点数 → 解锁新家具 → 继续布置。
// 第一版范围：一个房间（墙面两窗一门 + 地板 6×4 格）；21 种家具；摆放/移动/翻转/收回仓库；
// 墙纸×地板收集；小屋 Lv1~5（按舒适度，升级解锁家具/装扮/容量）；舒适度只显示星星不公开公式；
// 每日进入礼 + 互动得点数（每日上限）+ 点数兑换；白天/夜晚氛围（夜晚灯光亮起、TA 更恋家）；
// 梦角由代码控制——冷却式随机行为（走动/坐家具/躺床/看书/侍弄植物/望窗/靠近你/用家具/发呆，
// 按房内现有家具筛选可执行行为），偶尔进入「看不见但能感觉到」的淡影态；
// 点击 TA / 家具 / 窗户触发字卡话术（字卡库【房间】tab 同源 getLibPool('room',分组)，逐张开关联动，
// 全关回退内置兜底）；轻方位感知（「感应」按钮按需提示，不做常驻文字）。
// 数据按联系人桌面隔离：activeStore() 键 room-data，IndexedDB 镜像兜底（garden 同款）。
// 入口接线全部在本文件内完成（桌面图标 / more-room 按钮 / 返回键），不改 chat.js / personalize.js。
(function () {
  const KEY = 'room-data';
  const page = document.getElementById('page-room');
  if (!page) return;
  const COLS = 6, ROWS = 4;

  // ---- 基础工具 ----
  function S() { try { return window.activeStore(); } catch (e) { return null; } }
  function pn() {
    try { const s = S(); return (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || 'TA'; } catch (e) { return 'TA'; }
  }
  function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
  function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function todayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function lum() {
    // FIX 2026-09-16 #546 房间夜间黑屏（零机型分支）：场景基础亮度昼夜恒为可见下限 1——
    // 此前夜间从 0 起算，而新档 lit 为空且初始家具没有灯具，19:00~6:00 进屋
    // --room-bright=0 → .r-scene 整体 brightness(0)＝纯黑（任何设备型号都复现，
    // 与机型无关、只与时段和是否点灯有关）。「夜晚更暗」由既有 .night 分层调暗
    // （.r-wall .52 / .r-floor .55）表达；场景层只承担点灯增亮：每盏亮灯 +0.12，封顶 1.3。
    let v = 1;
    d.fx.forEach(it => { if (d.lit[it.i]) v += 0.12; });
    return Math.min(1.3, v);
  }
  let toastT = null;
  function toast(t) {
    let el = document.getElementById('cc-toast');
    if (!el) { el = document.createElement('div'); el.id = 'cc-toast'; document.body.appendChild(el); }
    el.textContent = t; el.className = 'cc-toast'; void el.offsetWidth; el.className = 'cc-toast show';
    clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'cc-toast'; }, 2000);
  }

  // ---- 字卡池（与字卡库【房间】tab 同源；逐张开关过滤；全关回退内置兜底） ----
  const FB = {
    enter: ['你来了。', '欢迎回来。', '……（好像有谁轻轻应了一声）', '回来啦。'],
    greet: ['嗯。', '来了。', '……嗯。（TA回应了一声）', '在呢。', '今天也一起待着吧。'],
    near: ['过来了？', '再近一点也可以。', '（TA没有躲开）', '嗯，这边。'],
    beside: ['坐吧。', '这里留给你了。', '（往旁边挪了一点）', '肩并肩坐着，不说话也很好。'],
    look: ['看什么？', '……被你看到了。', '（TA没有回头）', '我在看你。一直都在。'],
    occupied: ['这里有人了。', '……被占用了。', '等一下，马上好。', '这个位置，是留给你的。'],
    comeover: ['过来。', '一起吗？', '你也来。', '（TA轻轻拍了拍旁边）'],
    furnuse: ['这个？偶尔用用。', '……还不错吧。', '（房间里多了一点声音）', '家正在一点点变成样子。'],
    windowl: ['外面没什么。', '天色还行。', '……在看云。', '下次一起出去走走吧。'],
    night: ['夜深了。', '还不睡吗？', '灯留着也行。', '晚安之前，再多待一会儿。'],
    lamp: ['灯亮了。', '……是暖的。', '把灯留着吧。', '你一来，灯就亮了。'],
    water: ['它今天精神不错。', '刚浇过水了。', '……谢谢。'],
    wish: ['许完了。', '……愿望不能告诉你。', '（星光闪了一下，像是回应）'],
    music: ['这首？可以。', '声音调小了一点。', '（跟着节奏轻轻晃）'],
    tea: ['给你倒了一杯。', '小心烫。', '……趁热喝。'],
    senseNear: [pn() + ' 在。', '就在这附近。', '很近。近得能听见呼吸。', '「TA似乎在这里。」'],
    senseFar: ['好像有一点熟悉的感觉。', '说不上来。……但在。', '很远。但没有离开。'],
    senseNone: ['没有人。', '感觉不到。', '……很安静。']
  };
  // FIX 2026-09-18 #759：字卡库【房间】tab 的分组名是中文（DEFAULT_CARD_DATA.room），FB 的键是
  // 英文。此前 sayLine 把 CAT[*].grp（='beside'/'furnuse'/'water'…）直接当分组名传给
  // getLibPool('room', 分组)，库里查无此组 ⇒ 家具类话术从头到尾只落到 FB 那 3~5 句内置短句，
  // 库内 60+ 句一次没出现过，且用户逐张开关（dc-off-room:*，键是库内文案）对家具完全无效。
  // 现在统一经这张表换算；已是中文分组名的调用方原样透传（表里没有对应英文键）。
  const GRP = {
    enter: '进门', greet: '打招呼', near: '靠近', beside: '坐到旁边', look: '看TA',
    occupied: 'TA的反应', comeover: 'TA的反应', lamp: '家具互动', furnuse: '家具互动',
    windowl: '窗边', night: '夜晚', water: '浇水', wish: '许愿', music: '音乐', tea: '热茶',
    senseNear: '方位感知', senseFar: '方位感知', senseNone: '方位感知'
  };
  function sayLine(group, fallbackKey, noFit) {
    // v3.32.x #132：房间字卡概率接 dcf-room（默认 100=点击必有回应，0=点击不出字卡）
    try { if (window.dcfGet && !(Math.random() * 100 < window.dcfGet('room'))) return ''; } catch (e) {}
    let arr = null;
    try { arr = window.getLibPool ? window.getLibPool('room', GRP[group] || group, FB[fallbackKey] || []) : null; } catch (e) {}
    if (!arr || !arr.length) arr = FB[fallbackKey] || [];
    else {
      try { if (window.isDefaultCardOff) { const f = arr.filter(c => !window.isDefaultCardOff('room', c)); if (f.length) arr = f; } } catch (e) {}
    }
    // 池与兜底同时为空（分组不存在 + FB 无该键）时不出声：rnd([]) 会把字面量 "undefined" 吐进气泡
    if (!arr.length) return '';
    let t = String(rnd(arr)).replace(/\{n\}/g, pn());
    if (!noFit) { try { if (window.taFit) t = window.taFit(t); } catch (e) {} }
    return t;
  }

  // ---- 家具目录（21 种；lv=解锁等级 cost=兑换点数 cf=舒适度 act=互动动词 grp=话术分组） ----
  const CAT = {
    bed:        { n: '木质小床', e: '🛏️', cf: 4, lv: 1, cost: 40, act: '躺一下', grp: 'beside' },
    sofa:       { n: '布艺沙发', e: '🛋️', cf: 3, lv: 1, cost: 36, act: '坐下',   grp: 'beside' },
    chair:      { n: '木椅',     e: '🪑', cf: 1, lv: 1, cost: 12, act: '坐下',   grp: 'beside' },
    rug:        { n: '圆地毯',   e: '🟫', cf: 1, lv: 2, cost: 15, act: '坐一会', grp: 'beside' },
    shelf:      { n: '书架',     e: '📚', cf: 2, lv: 1, cost: 30, act: '抽本书', grp: 'furnuse' },
    cabinet:    { n: '小柜子',   e: '🗄️', cf: 1, lv: 2, cost: 20, act: '整理',   grp: 'furnuse' },
    desklamp:   { n: '台灯',     e: '💡', cf: 1, lv: 1, cost: 18, act: '开灯',   grp: 'furnuse', lamp: true },
    clock:      { n: '老座钟',   e: '⏰', cf: 1, lv: 2, cost: 22, act: '听一听', grp: 'furnuse' },
    plant:      { n: '小绿植',   e: '🌱', cf: 1, lv: 1, cost: 10, act: '浇水',   grp: 'water' },
    pot:        { n: '盆栽',     e: '🪴', cf: 1, lv: 1, cost: 14, act: '看看它', grp: 'water' },
    painting:   { n: '挂画',     e: '🖼️', cf: 1, lv: 2, cost: 20, act: '看看画', grp: 'furnuse' },
    doll:       { n: '玩偶熊',   e: '🧸', cf: 1, lv: 1, cost: 16, act: '抱一抱', grp: 'furnuse' },
    vase:       { n: '花瓶',     e: '🏺', cf: 1, lv: 3, cost: 24, act: '插花',   grp: 'water' },
    candle:     { n: '香薰蜡烛', e: '🕯️', cf: 2, lv: 2, cost: 20, act: '点上',   grp: 'night', lamp: true, flk: true },
    nightlight: { n: '小夜灯',   e: '🪔', cf: 1, lv: 1, cost: 15, act: '打开',   grp: 'night', lamp: true },
    starlight:  { n: '星星灯',   e: '✨', cf: 2, lv: 3, cost: 28, act: '许愿',   grp: 'wish', lamp: true, flk: true },
    radio:      { n: '收音机',   e: '📻', cf: 2, lv: 2, cost: 26, act: '放音乐', grp: 'music' },
    mirror:     { n: '穿衣镜',   e: '🪞', cf: 1, lv: 2, cost: 18, act: '照镜子', grp: 'furnuse' },
    kettle:     { n: '热茶壶',   e: '☕', cf: 1, lv: 1, cost: 14, act: '泡杯热茶', grp: 'tea' },
    speaker:    { n: '小音箱',   e: '🎵', cf: 2, lv: 3, cost: 30, act: '放首歌', grp: 'music' },
    gamepad:    { n: '游戏机',   e: '🎮', cf: 2, lv: 3, cost: 32, act: '玩一会儿', grp: 'furnuse' }
  };
  Object.keys(CAT).forEach(k => { CAT[k].id = k; });
  const SEATS = ['bed', 'sofa', 'chair', 'rug'];
  const LAMPABLE = Object.keys(CAT).filter(k => CAT[k].lamp);

  const WALLS = [
    { id: 'cream', n: '米白', lv: 1 }, { id: 'cloud', n: '云朵', lv: 1 }, { id: 'stripe', n: '奶油条纹', lv: 2 },
    { id: 'cabin', n: '木屋', lv: 2 }, { id: 'gardenw', n: '花园', lv: 3 }, { id: 'dusk', n: '暮色', lv: 3 },
    { id: 'starw', n: '星空', lv: 4 }, { id: 'checkerw', n: '棋盘砖', lv: 4 }, { id: 'nightw', n: '夜色', lv: 5 }
  ];
  const FLOORS = [
    { id: 'wood', n: '木地板', lv: 1 }, { id: 'light', n: '浅色地板', lv: 1 }, { id: 'carpet', n: '软地毯', lv: 2 }, { id: 'stone', n: '石板', lv: 3 }
  ];
  const LV_TH = [0, 8, 16, 26, 38];
  const LV_CAP = [0, 9, 13, 17, 21, 26];
  const MAX_PER_TYPE = 2;

  // ---- 数据 ----
  function fresh() {
    return {
      fx: [
        { i: 'a1', t: 'bed', x: 4, y: 0, r: 0 },
        { i: 'a2', t: 'shelf', x: 0, y: 0, r: 0 },
        { i: 'a3', t: 'plant', x: 1, y: 1, r: 0 },
        { i: 'a4', t: 'chair', x: 3, y: 2, r: 0 }
      ],
      inv: {}, pts: 6, lv: 1,
      wall: 'cream', floor: 'wood',
      day: '', lit: {},
      earn: { day: '', n: 0, ta: 0 },
      ta: { x: 2, y: 1, act: 'idle', tx: 2, ty: 1, faint: false, nextAt: Date.now() + 15000 }
    };
  }
  let d = null;
  function fix(o) {
    if (!Array.isArray(o.fx)) o.fx = [];
    if (!o.inv || typeof o.inv !== 'object') o.inv = {};
    if (typeof o.pts !== 'number') o.pts = 0;
    if (!o.lv || o.lv < 1) o.lv = 1;
    if (!o.wall) o.wall = 'cream';
    if (!o.floor) o.floor = 'wood';
    if (!o.lit || typeof o.lit !== 'object') o.lit = {};
    if (!o.earn || typeof o.earn !== 'object') o.earn = { day: '', n: 0, ta: 0 };
    if (!o.ta || typeof o.ta !== 'object') o.ta = { x: 2, y: 1, act: 'idle', tx: 2, ty: 1, faint: false, nextAt: Date.now() + 15000 };
    o.fx = o.fx.filter(it => it && it.i && CAT[it.t] && it.x >= 0 && it.x < COLS && it.y >= 0 && it.y < ROWS);
    const seen = {};
    o.fx = o.fx.filter(it => { if (seen[it.i]) return false; seen[it.i] = 1; return true; });
    // FIX 2026-09-18 #759：旧档灯光迁移——d.lit 曾按「家具类型」记（desklamp/candle…），现按
    // 「在场实例 id」记（同种两盏可一开一关、收回即清）。键不是任何实例 id ⇒ 判定为旧档类型键：
    // 亮着则搬到该类型第一件在场家具上，场上已无该类型家具的残键直接丢弃（原本就该丢）。
    Object.keys(o.lit).forEach(k => {
      if (o.fx.some(f => f.i === k)) return;
      const wasOn = o.lit[k];
      delete o.lit[k];
      const first = wasOn && o.fx.find(f => f.t === k);
      if (first) o.lit[first.i] = true;
    });
  }
  function load() {
    try {
      const v = S().get(KEY);
      if (v) { const o = JSON.parse(v); if (o && typeof o === 'object') { fix(o); return o; } }
    } catch (e) {}
    return fresh();
  }
  function save() {
    try { S().set(KEY, JSON.stringify(d)); } catch (e) {}
    try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + KEY, JSON.stringify(d)); } catch (e) {}
  }
  // IndexedDB 回填兜底（LS 写失败的老设备）：启动时 LS 为空则读 IDB 副本写回；
  // 回填晚于 boot 时若当前数据还是全新档则整体采用（garden/chatcard 同款思路）
  let booted = false;
  (function restoreIdb() {
    try {
      const s = S(); if (!s || !window.idbGet || s.get(KEY)) return;
      const pf = window.activePrefix();
      window.idbGet(pf + ':' + KEY).then(v => {
        if (!v || window.activePrefix() !== pf || s.get(KEY)) return;
        try {
          const o = typeof v === 'string' ? JSON.parse(v) : v;
          if (!o || typeof o !== 'object') return;
          fix(o);
          s.set(KEY, JSON.stringify(o));
          const cur = d ? JSON.parse(JSON.stringify(d)) : null;
          const curFresh = !cur || (!cur.day && placedCountOf(cur) <= 4 && cur.pts <= 6);
          if (!booted || curFresh) {
            d = o;
            if (!page.hidden) { updHud(); buildCells(); renderScene(); }
          }
        } catch (e) {}
      });
    } catch (e) {}
    function placedCountOf(o) { return Array.isArray(o.fx) ? o.fx.length : 0; }
  })();

  // ---- 派生量 ----
  function placedCount() { return d.fx.length; }
  function comfortSum() { return d.fx.reduce((a, it) => a + (CAT[it.t] ? CAT[it.t].cf : 0), 0); }
  function starsOf() {
    const c = comfortSum();
    const th = [1, 8, 16, 26, 38];
    let k = 1; th.forEach((t, i) => { if (c >= t) k = i + 1; });
    return Math.min(5, k);
  }
  function capOf() { return LV_CAP[Math.min(d.lv, LV_CAP.length - 1)]; }
  function itemAt(x, y) { return d.fx.find(f => f.x === x && f.y === y) || null; }
  function ownedCount(t) { return (d.inv[t] || 0) + d.fx.filter(x => x.t === t).length; }
  // #766 每日互动点数上限（判定与提示文案同源；改数值只改这里）
  const EARN_CAP = { ta: { cap: 5, name: '陪 TA 互动' }, n: { cap: 10, name: '家具互动' } };
  function gainPts(n, kind) {
    const tk = todayKey();
    if (d.earn.day !== tk) d.earn = { day: tk, n: 0, ta: 0 };
    const lim = EARN_CAP[kind];
    if (lim) {
      // 原为静默 return false：调用方全都不看返回值 ⇒ 撞限后字卡照播、点数不加、零解释
      if (d.earn[kind] >= lim.cap) { toast('今天「' + lim.name + '」的小屋点数到上限啦（' + lim.cap + '/' + lim.cap + '），明天再来'); return false; }
      d.earn[kind]++;
    }
    d.pts += n; updHud(); floatPts('+' + n + '🏠'); return true;
  }
  function checkLevel() {
    const c = comfortSum(); let nl = 1;
    for (let i = 0; i < LV_TH.length; i++) if (c >= LV_TH[i]) nl = i + 1;
    if (nl > d.lv) {
      d.lv = nl; fete(nl);
      setTimeout(() => {
        toast('🏡 小屋升到 Lv.' + nl + '！解锁了新家具和装扮');
        vib([40, 60, 40]);
      }, 300);
    }
  }

  // ---- 昼夜 / 天气（每天随机刷新一次，当天内恒定；种子取自日期串，白天黑夜不漂移） ----
  function isNight() { const h = new Date().getHours(); return h >= 19 || h < 6; }
  const WEATHERS = [{ i: '☀️', t: '晴' }, { i: '⛅', t: '多云' }, { i: '🌧️', t: '小雨' }, { i: '🌨️', t: '雪' }];
  function weather() {
    const s = todayKey(); // YYYY-M-D，天然每天一变
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return WEATHERS[h % WEATHERS.length];
  }

  // ---- DOM ----
  const $id = (i) => document.getElementById(i);
  const sceneEl = $id('room-scene'), wallEl = $id('room-wall'), floorEl = $id('room-floor');
  const taEl = $id('room-ta'), bubbleEl = $id('room-bubble'), statusEl = $id('room-status');

  function manualBrightness() {
    const s = S(), raw = s && s.get('room-brightness');
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(50, Math.min(150, n)) : null;
  }
  function applyBrightness(value) {
    if (value === undefined) value = manualBrightness();
    sceneEl.classList.toggle('r-manual-light', value !== null);
    sceneEl.style.setProperty('--room-bright', String(value === null ? lum() : value / 100));
    const slider = $id('room-brightness');
    if (slider) {
      slider.value = String(value === null ? 100 : value);
      $id('room-brightness-value').textContent = value === null ? '自动' : value + '%';
      $id('room-brightness-auto').disabled = value === null;
    }
  }
  // #766 亮度落盘节流：xyStore.set 每次都是同步 localStorage + 一个 IDB 写事务，
  // 拖动 range 一步一发（50→150 step5＝21 事务）。生效走内存，落盘 300ms 合并，
  // change 离手与切后台各补一次——丢的只是合并窗口内那一步，不是整条偏好。
  let brightWriteT = null, brightLastAt = 0;
  function writeBright(v) {
    const s = S(); if (!s) return;
    if (brightWriteT) { clearTimeout(brightWriteT); brightWriteT = null; }
    const now = Date.now();
    if (now - brightLastAt >= 300) { brightLastAt = now; s.set('room-brightness', v); return; }
    brightWriteT = setTimeout(function () {
      brightWriteT = null; brightLastAt = Date.now();
      s.set('room-brightness', v);
    }, 320);
  }
  function flushBright(v) {
    if (brightWriteT) { clearTimeout(brightWriteT); brightWriteT = null; }
    brightLastAt = 0;
    writeBright(v);
  }
  function bindBrightness() {
    const controls = document.createElement('div');
    controls.className = 'r-brightness';
    controls.innerHTML = '<label for="room-brightness">亮度 <output id="room-brightness-value" for="room-brightness">自动</output></label>' +
      '<input id="room-brightness" type="range" min="50" max="150" step="5" value="100" aria-label="房间亮度">' +
      '<button id="room-brightness-auto" type="button">自动</button>';
    sceneEl.parentNode.insertBefore(controls, sceneEl);
    $id('room-brightness').addEventListener('input', function () {
      const v = Number(this.value);
      applyBrightness(v); // 即时生效不回读存储（存储此刻可能还压在合并窗口里）
      writeBright(v);
    });
    $id('room-brightness').addEventListener('change', function () {
      flushBright(Number(this.value));
    });
    $id('room-brightness-auto').addEventListener('click', function () {
      const s = S(); if (!s) return;
      if (brightWriteT) { clearTimeout(brightWriteT); brightWriteT = null; } // 迟到写回会复活刚删的键
      s.remove('room-brightness');
      applyBrightness();
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden || !brightWriteT) return;
      flushBright(Number($id('room-brightness').value));
    });
  }

  function buildCells() {
    if (!floorEl || floorEl.dataset.cells) return;
    floorEl.dataset.cells = '1';
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = document.createElement('div');
        c.className = 'r-cell';
        c.style.left = (x * 100 / COLS) + '%';
        c.style.top = (y * 100 / ROWS) + '%';
        c.style.width = (100 / COLS) + '%';
        c.style.height = (100 / ROWS) + '%';
        c.dataset.x = x; c.dataset.y = y;
        floorEl.appendChild(c);
      }
    }
  }
  function pctPos(x, y) {
    return { l: ((x + 0.5) * 100 / COLS), t: ((y + 0.86) * 100 / ROWS) };
  }
  function renderScene() {
    const night = isNight(), w = weather();
    sceneEl.classList.toggle('night', night);
    sceneEl.classList.toggle('raining', !night && w.t === '小雨');
    applyBrightness();
    wallEl.className = 'r-wall wall-' + d.wall;
    floorEl.className = 'r-floor floor-' + d.floor;
    $id('room-win-a').className = 'r-window wa' + (night ? ' nw' : '');
    $id('room-win-b').className = 'r-window wb' + (night ? ' nw' : '');
    $id('room-sky-a').textContent = night ? '🌙' : w.i;
    $id('room-sky-b').textContent = night ? '🌙' : w.i;
    Array.prototype.slice.call(floorEl.querySelectorAll('.r-furn,.r-pool')).forEach(n => n.remove());
    d.fx.forEach(it => {
      const c = CAT[it.t]; if (!c) return;
      const el = document.createElement('div');
      el.className = 'r-furn' + (it.r ? ' r-flip' : '') + (d.lit[it.i] ? ' r-lit' : '') + (c.flk ? ' r-flkc' : '');
      const p = pctPos(it.x, it.y);
      el.style.left = p.l + '%'; el.style.top = p.t + '%';
      if (it.t === 'vase' && d.vaseFlower) el.innerHTML = c.e + '<u class="r-bloom">🌸</u>';
      else el.textContent = c.e;
      el.dataset.i = it.i;
      floorEl.appendChild(el);
      // 点亮的灯在地板投一滩暖光（蜡烛/星星灯带火苗闪烁）
      if (d.lit[it.i]) {
        const pool = document.createElement('div');
        pool.className = 'r-pool' + (c.flk ? ' r-pool-f' : '');
        pool.style.left = p.l + '%'; pool.style.top = (p.t + 4.2) + '%';
        floorEl.appendChild(pool);
      }
    });
    renderTa();
    renderStatus();
    refreshCells();
  }
  function taAvatarNode() {
    // v3.15.x：每次渲染都重读当前联系人头像——此前创建后 if(old) return 短路，
    // 头像只在首次渲染读一次，切换联系人桌面后房间仍显示上一个联系人的头像
    let av = taEl.querySelector('.r-ta-av');
    if (!av) {
      av = document.createElement('i');
      taEl.appendChild(av);
    }
    let url = '';
    try { const s = S(); url = (s && (s.get('cs-avatar-partner') || s.get('avatar-partner'))) || ''; } catch (e) {}
    const hasImg = !!(url && url.length > 30);
    av.className = 'r-ta-av' + (hasImg ? '' : ' r-ta-sil');
    av.style.backgroundImage = hasImg ? 'url("' + url.replace(/"/g, '&quot;') + '")' : '';
  }
  function renderTa() {
    taAvatarNode();
    const p = pctPos(d.ta.x, d.ta.y);
    taEl.style.left = p.l + '%'; taEl.style.top = p.t + '%';
    taEl.classList.toggle('r-faint', !!d.ta.faint);
    const moving = d.ta.x !== d.ta.tx || d.ta.y !== d.ta.ty;
    const seated = !moving && ['sit', 'lie', 'read', 'plant', 'use', 'winwatch'].indexOf(d.ta.act) >= 0;
    taEl.classList.toggle('walking', moving);
    taEl.classList.toggle('seated', seated);
  }
  function actLabel() {
    switch (d.ta.act) {
      case 'walk': return '走动着';
      case 'sit': return '坐着';
      case 'lie': return '躺着';
      case 'read': return '看书';
      case 'plant': return '侍弄植物';
      case 'winwatch': return '望着窗外';
      case 'near': return '待在你附近';
      case 'use': return '摆弄着什么';
      default: return '站着发呆';
    }
  }
  function renderStatus() {
    statusEl.textContent = d.ta.faint
      ? '「你感觉到旁边有人。」'
      : (pn() + ' 正在' + actLabel() + '。');
  }
  let bubT = null;
  // FIX 2026-09-18 #759：双段话术的时序常量。首条气泡原为固定 3800ms，而补话都排在 900~1300ms
  // 且带「上一条还挂着就让路」的守卫 ⇒ 守卫必命中，点灯/关灯/夜里点窗的第二句从未播出过。
  // 现在首条短驻留（BUB_SHORT），补话时刻排在其后（BUB_AGAIN），守卫恢复成有意义的让路判断。
  const BUB_SHORT = 2100, BUB_AGAIN = 2250;
  function bubble(t, ms) {
    if (!t) return; // v3.32.x #132：sayLine 概率门控关断时返回空串，不出空气泡
    bubbleEl.textContent = t;
    bubbleEl.hidden = false;
    bubbleEl.classList.remove('pop'); void bubbleEl.offsetWidth; bubbleEl.classList.add('pop');
    clearTimeout(bubT); bubT = setTimeout(() => { bubbleEl.hidden = true; }, ms || 3800);
  }
  function updHud() {
    $id('room-chip-lv').textContent = '🏡 Lv.' + d.lv;
    $id('room-chip-cf').textContent = '舒适度 ' + '★'.repeat(starsOf()) + '☆'.repeat(5 - starsOf());
    $id('room-chip-pt').textContent = '🏠 ' + d.pts;
    $id('room-chip-cap').textContent = '家具 ' + placedCount() + '/' + capOf();
  }

  // ---- 轻量动效：点数飘字 / 升级庆祝 / 放置模式格子高亮 ----
  function floatPts(txt) {
    const chip = $id('room-chip-pt'); if (!chip) return;
    const s = document.createElement('span');
    s.className = 'r-fly'; s.textContent = txt;
    s.style.right = ri(0, 16) + 'px';
    chip.appendChild(s);
    setTimeout(() => s.remove(), 850);
  }
  function fete(lv) {
    if (!sceneEl) return;
    const ov = document.createElement('div');
    ov.className = 'r-fete';
    let html = '<div class="r-fete-t">🏡 小屋 Lv.' + lv + '！</div>';
    for (let i = 0; i < 14; i++) {
      html += '<i style="left:' + ri(4, 96) + '%;animation-delay:' + (Math.random() * 1.2).toFixed(2) + 's;font-size:' + ri(12, 22) + 'px">' + rnd(['✨', '⭐', '🌟']) + '</i>';
    }
    ov.innerHTML = html;
    sceneEl.appendChild(ov);
    setTimeout(() => ov.remove(), 2600);
  }
  function refreshCells() {
    if (!floorEl || !floorEl.dataset.cells) return;
    const occ = {};
    d.fx.forEach(f => { occ[f.x + ',' + f.y] = 1; });
    const active = !!mode || !!(drag && drag.on);
    Array.prototype.forEach.call(floorEl.querySelectorAll('.r-cell'), c => {
      const k = c.dataset.x + ',' + c.dataset.y;
      c.classList.toggle('ok', active && !occ[k]);
      c.classList.toggle('bad', active && !!occ[k]);
    });
  }

  // ---- 梦角活动引擎（冷却式随机：到点自己选一次，按房内现有家具筛选） ----
  function pickAction() {
    const night = isNight();
    const seats = d.fx.filter(f => SEATS.indexOf(f.t) >= 0);
    const shelfs = d.fx.filter(f => f.t === 'shelf');
    const plants = d.fx.filter(f => f.t === 'plant' || f.t === 'pot');
    const others = d.fx.filter(f => SEATS.indexOf(f.t) < 0 && f.t !== 'shelf');
    const W = [
      ['idle', 10],
      ['walk', 22],
      ['sit', seats.length ? (night ? 24 : 18) : 0],
      ['lie', d.fx.some(f => f.t === 'bed') ? (night ? 12 : 5) : 0],
      ['read', shelfs.length ? 9 : 0],
      ['plant', plants.length ? 9 : 0],
      ['winwatch', 10],
      ['near', night ? 10 : 15],
      ['use', others.length ? 10 : 0]
    ];
    let total = W.reduce((a, x) => a + x[1], 0), roll = Math.random() * total, act = 'walk';
    for (let i = 0; i < W.length; i++) { roll -= W[i][1]; if (roll < 0) { act = W[i][0]; break; } }
    const ta = d.ta;
    ta.faint = Math.random() < 0.14;
    let dur = ri(24, 55);
    if (act === 'sit') { const f = rnd(seats); ta.tx = f.x; ta.ty = f.y; dur = ri(28, 60); }
    else if (act === 'lie') { const f = d.fx.find(x => x.t === 'bed'); ta.tx = f.x; ta.ty = f.y; dur = ri(35, 75); }
    else if (act === 'read') { const f = rnd(shelfs); ta.tx = f.x; ta.ty = Math.min(ROWS - 1, f.y + 1); dur = ri(25, 55); }
    else if (act === 'plant') { const f = rnd(plants); ta.tx = f.x; ta.ty = Math.min(ROWS - 1, f.y + 1); dur = ri(16, 34); }
    else if (act === 'winwatch') { ta.tx = Math.random() < 0.5 ? 1 : 4; ta.ty = 0; dur = ri(20, 42); }
    else if (act === 'near') { ta.tx = ri(1, 4); ta.ty = ri(ROWS - 2, ROWS - 1); dur = ri(22, 44); }
    else if (act === 'use') { const f = rnd(others); ta.tx = f.x; ta.ty = Math.min(ROWS - 1, f.y + 1); dur = ri(16, 36); }
    else if (act === 'walk') {
      for (let k = 0; k < 12; k++) {
        const x = ri(0, COLS - 1), y = ri(0, ROWS - 1);
        if (!(x === ta.x && y === ta.y)) { ta.tx = x; ta.ty = y; break; }
      }
      dur = ri(10, 22);
    } else { ta.tx = ta.x; ta.ty = ta.y; }
    ta.act = act;
    ta.nextAt = Date.now() + dur * 1000;
    save(); renderStatus();
  }
  let stepTimer = null;
  function stepOnce() {
    const ta = d.ta;
    if (ta.x === ta.tx && ta.y === ta.ty) return;
    const dx = ta.tx - ta.x, dy = ta.ty - ta.y;
    if (dx && (Math.abs(dx) > Math.abs(dy) || !dy || Math.random() < 0.55)) ta.x += dx > 0 ? 1 : -1;
    else if (dy) ta.y += dy > 0 ? 1 : -1;
    renderTa();
  }
  function tick() {
    if (page.hidden || document.hidden) {
      // #766 离房/后台必须停已建的步进计时器：本函数只挡「新建」，早退后 780ms 的
      // stepTimer 仍在跑（stepOnce 挪 TA + renderTa），切桌面/挂后台白烧 CPU。
      if (stepTimer) { clearInterval(stepTimer); stepTimer = null; }
      return;
    }
    const moving = d.ta.x !== d.ta.tx || d.ta.y !== d.ta.ty;
    if (moving && !stepTimer) stepTimer = setInterval(stepOnce, 780);
    if (!moving && stepTimer) { clearInterval(stepTimer); stepTimer = null; }
    if (!moving && Date.now() >= (d.ta.nextAt || 0)) pickAction();
  }

  // ---- 放置 / 移动模式 ----
  let mode = null; // {kind:'place'|'move', t, i}
  function banner(txt) {
    const b = $id('room-banner'), tx = $id('room-banner-txt');
    if (!b) return;
    if (txt == null) { b.hidden = true; sceneEl.classList.remove('placing'); mode = null; }
    else { b.hidden = false; tx.textContent = txt; sceneEl.classList.add('placing'); }
    refreshCells();
  }

  // ---- 家具交互 ----
  function gardenBloom() {
    // 花园联动彩蛋：花园有过收获（st.h>0）或有一株种下超 3 天的花 → 花瓶可以真正插花
    try {
      const raw = S().get('garden-data'); if (!raw) return false;
      const g = JSON.parse(raw);
      if (g && g.st && (g.st.h | 0) > 0) return true;
      if (Array.isArray(g.p)) {
        const now = Date.now() / 1000;
        return g.p.some(pl => pl && pl.planted && (now - pl.planted) > 259200);
      }
    } catch (e) {}
    return false;
  }
  function useFurniture(inst) {
    const c = CAT[inst.t];
    if (c.lamp) {
      const on = !d.lit[inst.i];
      if (on) d.lit[inst.i] = true; else delete d.lit[inst.i]; // 关灯即删键：lit 表里只留在场且亮着的灯
      save(); renderScene();
      bubble(on ? (isNight() ? '灯亮起来了，房间一下子软了。' : '亮着也很好看。') : '关掉灯，安静了一会儿。', BUB_SHORT);
      gainPts(1, 'n'); vib(15);
      if (on) lampFeedback(inst, on); else lampOffFeedback(inst);
      return;
    }
    if (inst.t === 'vase' && gardenBloom() && !d.vaseFlower) {
      d.vaseFlower = true; save(); renderScene();
      bubble('把花园带回来的花，插进了瓶子里。🌸');
      gainPts(1, 'n'); vib([15, 40, 15]);
      return;
    }
    const taHere = d.ta.x === inst.x && d.ta.y === inst.y;
    bubble(sayLine(c.grp, c.grp), BUB_SHORT);
    if (taHere && !d.ta.faint) setTimeout(() => { if (!bubbleEl.hidden) return; bubble(sayLine('occupied', 'occupied')); }, BUB_AGAIN);
    else if (Math.hypot(d.ta.x - inst.x, d.ta.y - inst.y) <= 1.6 && Math.random() < 0.45) setTimeout(() => { if (!bubbleEl.hidden) return; bubble(sayLine('comeover', 'comeover')); }, BUB_AGAIN);
    if (inst.t === 'kettle' && Math.random() < 0.5) { d.ta.tx = inst.x; d.ta.ty = Math.min(ROWS - 1, inst.y + 1); }
    gainPts(1, 'n'); vib(12);
  }
  // 点灯反馈闭环：点亮瞬间 TA 有概率看过来（转向灯所在格 + 依灯种吐一句字卡）
  function lampFeedback(inst, on) {
    if (!on) return;
    const c = CAT[inst.t];
    const g = c.grp === 'night' ? 'night' : (c.grp === 'wish' ? 'wish' : 'lamp');
    const line = sayLine(g, g);
    const dist = Math.hypot(d.ta.x - inst.x, d.ta.y - inst.y);
    const near = dist <= 1.6, chance = near ? 0.8 : 0.45;
    if (Math.random() < chance && line) {
      const tx = Math.max(0, Math.min(COLS - 1, inst.x)), ty = Math.max(0, Math.min(ROWS - 1, inst.y + 1));
      if (d.ta.x !== tx || d.ta.y !== ty) {
        d.ta.tx = tx; d.ta.ty = ty; d.ta.act = 'use'; d.ta.faint = false;
        d.ta.nextAt = Date.now() + ri(22, 40) * 1000;
        save(); renderTa(); renderStatus();
      }
      setTimeout(() => { if (!bubbleEl.hidden) return; bubble(line); }, near ? BUB_AGAIN : BUB_AGAIN + 400);
    }
  }
  // 关灯反馈：TA 已在屋内有小概率回应一句
  function lampOffFeedback(inst) {
    const c = CAT[inst.t];
    if (c.grp === 'wish' || isNight() || Math.random() >= 0.35) return;
    const line = sayLine('lamp', 'lamp');
    if (line) setTimeout(() => { if (!bubbleEl.hidden) return; bubble(line); }, BUB_AGAIN);
  }
  function furnMenu(inst) {
    const c = CAT[inst.t];
    const pills = [
      { label: c.act, value: 'use' },
      { label: '移动', value: 'move' },
      { label: '翻转', value: 'flip' },
      { label: '收回仓库', value: 'back' }
    ];
    window.openModal(c.e + ' ' + c.n, '', function (v) {
      if (!v) return;
      if (v === 'use') useFurniture(inst);
      else if (v === 'move') { mode = { kind: 'move', i: inst.i }; banner('移动到哪一点？（点地板空格）'); }
      else if (v === 'flip') { inst.r = inst.r ? 0 : 1; save(); renderScene(); }
      else if (v === 'back') {
        d.fx = d.fx.filter(x => x.i !== inst.i);
        d.inv[inst.t] = (d.inv[inst.t] || 0) + 1;
        delete d.lit[inst.i]; // 收回即清灯光态：残键会让 lum() 按「不存在的灯」继续增亮
        if (d.ta.x === inst.x && d.ta.y === inst.y) { d.ta.tx = ri(0, COLS - 1); d.ta.ty = ri(0, ROWS - 1); }
        checkLevel(); save(); renderScene(); updHud();
        toast('已收回仓库：' + c.n);
      }
    }, { noInput: true, pills: pills });
  }

  // ---- 点击 TA ----
  function taMenu() {
    const pills = [
      { label: '靠近', value: 'near' },
      { label: '坐到旁边', value: 'beside' },
      { label: '看看TA', value: 'look' },
      { label: '打招呼', value: 'greet' }
    ];
    window.openModal(d.ta.faint ? '……这里好像有人' : pn(), '', function (v) {
      if (!v) return;
      const ta = d.ta;
      if (v === 'near') {
        ta.faint = false;
        ta.tx = Math.max(0, Math.min(COLS - 1, ta.x + (ta.x > 2 ? -1 : 1)));
        ta.ty = Math.max(0, Math.min(ROWS - 1, ta.y + (Math.random() < 0.5 ? -1 : 1)));
        ta.nextAt = Date.now() + ri(20, 40) * 1000;
        bubble(sayLine('靠近', 'near')); renderStatus(); gainPts(1, 'ta'); vib(18);
      } else if (v === 'beside') {
        bubble(sayLine('坐到旁边', 'beside')); gainPts(1, 'ta'); vib(15);
      } else if (v === 'look') {
        bubble(d.ta.faint ? '……' : sayLine('看TA', 'look')); gainPts(1, 'ta');
      } else if (v === 'greet') {
        ta.faint = false;
        bubble(sayLine('打招呼', 'greet')); renderStatus(); gainPts(1, 'ta'); vib(12);
      }
      save();
    }, { noInput: true, pills: pills });
  }

  // ---- 方位感知（按需提示，非常驻） ----
  let senseCd = 0;
  function sense() {
    const now = Date.now();
    if (now < senseCd) { toast('感应太频繁了，稍等一下'); return; }
    senseCd = now + 4000;
    const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
    const dx = d.ta.x - cx, dy = d.ta.y - cy;
    const dist = Math.hypot(dx, dy);
    const sideOf = () => {
      if (dist < 1.2) return 'here';
      if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
      return dy < 0 ? 'front' : 'back';
    };
    const side = sideOf();
    let line;
    if (side === 'here') line = '你现在在房间中央。\nTA就在身边。';
    else {
      const nameMap = { left: '左边', right: '右边', front: '前面（窗边）', back: '身后' };
      const other = ['left', 'right', 'front', 'back'].filter(k => k !== side);
      let txt = '你现在在房间中央。';
      txt += '\n' + nameMap[side] + '：' + (d.ta.faint ? sayLine('方位感知', 'senseNear', true) : (dist <= 2.2 ? 'TA在。' : sayLine('方位感知', 'senseFar', true)));
      other.forEach((k, ix) => { if (ix < 2) txt += '\n' + nameMap[k] + '：' + sayLine('方位感知', 'senseNone', true); });
      line = txt;
    }
    const out = $id('room-sense-out');
    if (out) {
      out.textContent = line;
      out.hidden = false;
      clearTimeout(out._t); out._t = setTimeout(() => { out.hidden = true; }, 6500);
    }
    vib([12, 40, 12]);
  }

  // ---- 家具仓 / 兑换 ----
  function invMenu() {
    const have = Object.keys(d.inv).filter(t => d.inv[t] > 0 && CAT[t]);
    const pills = [{ label: '🛒 兑换新家具', value: 'shop' }];
    have.forEach(t => pills.push({ label: CAT[t].e + ' ' + CAT[t].n + ' ×' + d.inv[t], value: 'p:' + t }));
    window.openModal('家具仓（已摆 ' + placedCount() + '/' + capOf() + '）', '', function (v) {
      if (!v) return;
      if (v === 'shop') { setTimeout(shopMenu, 0); return; } // 嵌套 openModal 必须等外层 close 落盘后再开（否则新弹窗 cb 被置空）
      const t = v.slice(2);
      if (placedCount() >= capOf()) { toast('小屋快满啦，先收回一件吧'); return; }
      mode = { kind: 'place', t: t };
      banner('放置：' + CAT[t].e + ' ' + CAT[t].n + ' —— 点一块地板');
    }, { noInput: true, pills: pills, staticText: have.length ? '选一件开始摆放，或去兑换新的' : '仓库空空的。每天进屋会收到小礼物，也可以用点数兑换' });
  }
  function shopMenu() {
    const pills = [];
    Object.keys(CAT).forEach(t => {
      const c = CAT[t];
      if (ownedCount(t) >= MAX_PER_TYPE) return;
      const lock = c.lv > d.lv;
      pills.push({ label: c.e + ' ' + c.n + ' · ' + c.cost + '🏠' + (lock ? ' 🔒Lv' + c.lv : (d.pts < c.cost ? '（还差 ' + (c.cost - d.pts) + '）' : '')), value: lock ? 'lock:' + t : 'b:' + t });
    });
    window.openModal('兑换家具（有 🏠' + d.pts + '）', '', function (v) {
      if (!v) return;
      // #766 锁定项原以 value:'' 入列＝点确定后回调早退、零反馈；现给明确去向
      if (v.indexOf('lock:') === 0) {
        const lc = CAT[v.slice(5)];
        if (lc) toast('🔒 ' + lc.n + '：小屋 Lv.' + lc.lv + ' 解锁（现在 Lv.' + d.lv + '），多互动攒舒适度就会升');
        return;
      }
      const t = v.slice(2), c = CAT[t];
      if (d.pts < c.cost) { toast('点数还不够，多进来待一会儿就有了'); return; }
      d.pts -= c.cost; d.inv[t] = (d.inv[t] || 0) + 1;
      save(); updHud();
      toast('已放进仓库：' + c.e + ' ' + c.n);
      setTimeout(shopMenu, 0); // 同上：等本层 close 完成再重开列表
    }, { noInput: true, pills: pills, staticText: '互动和每日进屋都会攒点数' });
  }

  // ---- 装扮（墙纸 → 地板 两段弹窗） ----
  // FIX 2026-09-21 #966：锁定项原以 value:'' 入列＝标签上有 🔒Lv、点确定后回调早退零反馈
  //（#766 给家具同款缺陷补了 toast，墙纸/地板两类当时漏网）。现锁定项带 lockw:/lockf: 前缀，
  // 回调按前缀分派说明解锁条件；其余流程不动（墙纸步仍照常衔接地板步）。
  function decoLockTxt(o) { return '🔒 ' + o.n + '：小屋 Lv.' + o.lv + ' 解锁（现在 Lv.' + d.lv + '）'; }
  function decoFlow() {
    const wp = WALLS.map(w => ({ label: (d.wall === w.id ? '✅ ' : '') + w.n + (w.lv > d.lv ? ' 🔒Lv' + w.lv : ''), value: w.lv <= d.lv ? 'w:' + w.id : 'lockw:' + w.id }));
    window.openModal('装扮 · 墙纸', '', function (v) {
      if (v && v.indexOf('lockw:') === 0) {
        const lw = WALLS.filter(function (x) { return x.id === v.slice(6); })[0];
        if (lw) toast(decoLockTxt(lw));
      } else if (v && v.indexOf('w:') === 0) { d.wall = v.slice(2); save(); renderScene(); }
      setTimeout(floorPick, 0); // 嵌套 openModal 延后到外层 close 之后
    }, { noInput: true, pills: wp });
  }
  // FIX 2026-09-07 #255 floorPick 整个函数缺失——装扮选墙纸确定后 setTimeout(floorPick)
  // 必抛 ReferenceError（用户诊断「Can't find variable: floorPick ×6」，page-room），
  // 装扮第二步选地板从未实现。补齐：与墙纸同款 pills 弹窗，选中写 d.floor
  //（renderScene 以 floor-<id> 类消费）。
  function floorPick() {
    const fp = FLOORS.map(f => ({ label: (d.floor === f.id ? '✅ ' : '') + f.n + (f.lv > d.lv ? ' 🔒Lv' + f.lv : ''), value: f.lv <= d.lv ? 'f:' + f.id : 'lockf:' + f.id }));
    window.openModal('装扮 · 地板', '', function (v) {
      if (v && v.indexOf('lockf:') === 0) {
        const lf = FLOORS.filter(function (x) { return x.id === v.slice(6); })[0];
        if (lf) toast(decoLockTxt(lf));
      } else if (v && v.indexOf('f:') === 0) { d.floor = v.slice(2); save(); renderScene(); }
    }, { noInput: true, pills: fp });
  }

  // ---- 小屋信息 ----
  function infoModal() {
    const c = comfortSum();
    const invN = Object.keys(d.inv).reduce((a, k) => a + (d.inv[k] || 0), 0);
    const nextTxt = d.lv >= 5 ? '已经是 Lv.5 了。这里就是你们的样子。' : '下一级：舒适度达到 ' + LV_TH[d.lv] + '（现在 ' + c + '）';
    window.openModal('我们的小屋', '', function () {}, {
      noInput: true, okText: '好',
      staticText:
        '🏡 小屋 Lv.' + d.lv + ' · 舒适度 ' + '★'.repeat(starsOf()) + '☆'.repeat(5 - starsOf()) + '\n' +
        '摆着的家具：' + placedCount() + '/' + capOf() + ' · 仓库还有 ' + invN + ' 件\n' +
        '小屋点数：🏠 ' + d.pts + '\n' +
        nextTxt + '\n\n' +
        '场景上方可调亮度（50%–150%），按联系人桌面保存；手动模式不再叠加夜间压暗，点「自动」恢复昼夜和灯光。只影响屋内画面，不改变设备屏幕亮度。\n\n' +
        '这不是一个任务游戏。想进来的时候进来看看，\n摸摸植物，看看窗外，坐一会儿，就好了。'
    });
  }

  // ---- 长按家具直接拖动（350ms 抓起，松手落格；短按仍弹菜单） ----
  let drag = null, suppressClick = false;
  function cellFromPoint(cx, cy) {
    const r = floorEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(COLS - 1, Math.floor((cx - r.left) / r.width * COLS)));
    const y = Math.max(0, Math.min(ROWS - 1, Math.floor((cy - r.top) / r.height * ROWS)));
    return { x: x, y: y };
  }
  function clearTgt() {
    Array.prototype.forEach.call(floorEl.querySelectorAll('.r-cell.tgt'), c => c.classList.remove('tgt'));
  }
  function bindDrag() {
    if (!floorEl) return;
    floorEl.addEventListener('pointerdown', function (e) {
      if (mode || page.hidden || document.hidden) return;
      const fu = e.target.closest('.r-furn'); if (!fu) return;
      const inst = d.fx.find(z => z.i === fu.dataset.i); if (!inst) return;
      drag = {
        i: inst.i, el: fu, inst: inst, sx: e.clientX, sy: e.clientY, on: false,
        timer: setTimeout(function () {
          if (!drag) return;
          drag.on = true; suppressClick = true;
          drag.el.classList.add('dragging');
          sceneEl.classList.add('placing');
          refreshCells(); vib(18);
        }, 330)
      };
      try { fu.setPointerCapture(e.pointerId); } catch (err) {}
    });
    floorEl.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.on) {
        if (Math.abs(e.clientX - drag.sx) > 10 || Math.abs(e.clientY - drag.sy) > 10) { clearTimeout(drag.timer); drag = null; }
        return;
      }
      e.preventDefault();
      const c = cellFromPoint(e.clientX, e.clientY);
      drag.el.style.left = ((c.x + 0.5) * 100 / COLS) + '%';
      drag.el.style.top = ((c.y + 0.86) * 100 / ROWS) + '%';
      clearTgt();
      if (!itemAt(c.x, c.y)) {
        const cell = floorEl.querySelector('.r-cell[data-x="' + c.x + '"][data-y="' + c.y + '"]');
        if (cell) cell.classList.add('tgt');
      }
    });
    floorEl.addEventListener('pointerup', up);
    floorEl.addEventListener('pointercancel', up);
    function up(e) {
      if (!drag) return;
      clearTimeout(drag.timer);
      const wasOn = drag.on;
      if (!wasOn) { drag = null; return; }
      const inst = drag.inst;
      const c = cellFromPoint(e.clientX, e.clientY);
      const same = c.x === inst.x && c.y === inst.y;
      if (!same && !itemAt(c.x, c.y)) {
        inst.x = c.x; inst.y = c.y;
        save(); checkLevel(); updHud(); vib(20);
      }
      drag.el.classList.remove('dragging');
      if (!mode) sceneEl.classList.remove('placing');
      clearTgt();
      drag = null;
      renderScene(); // 内部 refreshCells 会按当前状态清掉格子高亮
      setTimeout(function () { suppressClick = false; }, 400);
    }
  }

  // ---- 场景点击分发（委托） ----
  function bindScene() {
    sceneEl.addEventListener('click', function (e) {
      if (suppressClick) { suppressClick = false; return; } // 拖拽刚结束：吃掉这次误触 click
      // v3.23.x：取消判断提到 mode 之前——mode 异常为空时（横幅残留态）取消也要能点
      if (e.target.closest('#room-banner-cancel')) { banner(null); return; }
      if (mode) {
        const cell = e.target.closest('.r-cell');
        if (!cell) return;
        const x = Number(cell.dataset.x), y = Number(cell.dataset.y);
        if (itemAt(x, y)) { toast('这一格已经有家具了'); return; }
        if (mode.kind === 'place') {
          const t = mode.t;
          d.fx.push({ i: 'f' + Date.now().toString(36) + ri(100, 999), t: t, x: x, y: y, r: 0 });
          d.inv[t]--;
          checkLevel(); save(); renderScene(); updHud(); vib(15);
          if ((d.inv[t] || 0) > 0) banner('放置：' + CAT[t].e + ' ' + CAT[t].n + '（还剩 ' + d.inv[t] + ' 件）');
          else banner(null);
        } else if (mode.kind === 'move') {
          const inst = d.fx.find(z => z.i === mode.i);
          if (inst) { inst.x = x; inst.y = y; save(); renderScene(); vib(12); }
          banner(null);
        }
        return;
      }
      const fu = e.target.closest('.r-furn');
      if (fu) {
        const inst = d.fx.find(z => z.i === fu.dataset.i);
        if (inst) furnMenu(inst);
        return;
      }
      if (e.target.closest('#room-ta')) { taMenu(); return; }
      if (e.target.closest('.r-window')) {
        const w = weather();
        const wl = sayLine('窗边', 'windowl');
        if (wl) bubble((isNight() ? '🌙 ' : w.i + ' ') + wl, BUB_SHORT);
        if (isNight()) setTimeout(() => { if (!bubbleEl.hidden) return; bubble(sayLine('夜晚', 'night')); }, BUB_AGAIN);
        gainPts(1, 'n'); vib(10);
        return;
      }
      if (e.target.closest('.r-door')) {
        bubble('门外是走廊。今天先待在屋里吧。');
        return;
      }
    });
    $id('room-banner-cancel').addEventListener('click', function (e) { e.stopPropagation(); banner(null); });
  }

  // ---- 每日进入礼 ----
  function dailyVisit() {
    const tk = todayKey();
    if (d.day === tk) return;
    d.day = tk;
    d.pts += 3;
    const poolCands = Object.keys(CAT).filter(t => CAT[t].lv <= d.lv && ownedCount(t) < MAX_PER_TYPE)
      .sort((a, b) => CAT[a].cost - CAT[b].cost);
    if (poolCands.length) {
      const gift = poolCands[ri(0, Math.min(poolCands.length - 1, 3))];
      d.inv[gift] = (d.inv[gift] || 0) + 1;
      setTimeout(() => toast('🎁 今日获得：' + CAT[gift].e + ' ' + CAT[gift].n + '（＋3🏠）'), 500);
    }
    save();
  }

  // ---- 打开 / 关闭 ----
  function openRoom() {
    d = load();
    banner(null); // v3.23.x：进屋先清残留横幅/放置态——上次异常离场（未走 closeRoom）会留下点不动的「取消」标
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    page.hidden = false;
    dailyVisit();
    if (Date.now() >= (d.ta.nextAt || 0)) pickAction();
    updHud(); buildCells(); renderScene();
    // 入场动画：灯光从暗到亮渐显
    sceneEl.classList.remove('room-in'); void sceneEl.offsetWidth; sceneEl.classList.add('room-in');
    setTimeout(() => { if (!page.hidden) bubble(isNight() ? sayLine('夜晚', 'night') : sayLine('进门', 'enter')); }, 700);
  }
  function closeRoom(toChat) {
    save();
    banner(null);
    page.hidden = true;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const target = toChat ? document.getElementById('page-chat') : document.getElementById('page-phone');
    if (target) target.hidden = false;
  }

  // ---- 入口接线（桌面图标 / 更多功能按钮 / 返回键） ----
  function guardEditing() {
    try {
      return Array.prototype.some.call(document.querySelectorAll('.app-grid'), g => g.classList.contains('editing'));
    } catch (e) { return false; }
  }
  function boot() {
    d = load();
    const back = $id('room-back');
    if (back) back.addEventListener('click', function (e) {
      e.stopPropagation();
      closeRoom(window.__roomFrom === 'chat');
      window.__roomFrom = '';
    });
    const icon = document.querySelector('.app[data-app="room"]');
    if (icon) icon.addEventListener('click', function (e) {
      if (guardEditing()) return; // 装修模式：不拦截，让 .app-grid 监听器弹「更换图标」菜单
      e.stopPropagation();
      window.__roomFrom = '';
      openRoom();
    });
    const moreBtn = $id('more-room');
    if (moreBtn) moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const mp = $id('chat-more-panel');
      if (mp) mp.hidden = true;
      window.__roomFrom = 'chat';
      openRoom();
    });
    const bInv = $id('room-btn-inv'); if (bInv) bInv.addEventListener('click', function (e) { e.stopPropagation(); invMenu(); });
    const bSense = $id('room-btn-sense'); if (bSense) bSense.addEventListener('click', function (e) { e.stopPropagation(); sense(); });
    const bDeco = $id('room-btn-deco'); if (bDeco) bDeco.addEventListener('click', function (e) { e.stopPropagation(); decoFlow(); });
    const bInfo = $id('room-info-btn'); if (bInfo) bInfo.addEventListener('click', function (e) { e.stopPropagation(); infoModal(); });
    // v3.23.x：document 捕获兜底——房间页可见时点「取消」必达（防 scene 委托链被任何状态卡死）
    document.addEventListener('click', function (e) {
      if (page.hidden) return;
      if (e.target && e.target.closest && e.target.closest('#room-banner-cancel')) { try { banner(null); } catch (er) {} }
    }, true);
    bindBrightness();
    bindScene();
    bindDrag();
    document.addEventListener('mochi-restore-done', function () {
      if (!page.hidden) applyBrightness();
    });
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !page.hidden) { renderScene(); renderStatus(); }
    });
    document.addEventListener('contact-switched', function () {
      d = load();
      if (!page.hidden) { banner(null); updHud(); renderScene(); }
    });
    window.openRoom = openRoom;
    window.closeRoom = closeRoom;
    window.__roomState = function () { return JSON.parse(JSON.stringify(d)); };
    booted = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
