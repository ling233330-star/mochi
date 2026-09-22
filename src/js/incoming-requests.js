// ===== 功能：跨桌面「来消息」弹窗（其他桌面联系人来查岗 / 求聊天） v3.17.x =====
// 你在 A 桌面时，B / C 桌面的 TA 可能按各自桌面的设置主动来查岗、求聊天。
// 触发 → 弹全局弹窗（openModal）：「<B 昵称> 来查岗了：xxx」[ 现在回TA / 稍后 ]。
// 点「现在回TA」→ 切到对应桌面 + 进聊天，等该桌面聊天加载就绪后，TA 当场发出
// 查岗卡（可回答）或一句开场白——对话是切过去之后自然产生的。
//
// 设计要点：
// ① 申请消息只存全局根键 xy-home-v2:incoming-requests，绝不写任何桌面的 chat-msgs，
//    聊天记录零污染（与 feed/call 的"系统消息直写他桌面聊天"不同）。
// ② 调度仿 feed.js maybeAutoPost：定时轮询遍历所有联系人，非激活桌面按各自配置
//    掷概率（查岗读回复设置 ckq-*、求聊天读 as-*），激活桌面不做跨桌面打扰。
// ③ 每联系人独立冷却 + 未处理 pending 不重复触发；页面在后台时走 bgNotifyCheck
//    系统通知，不弹页面窗。
// ④ v3.17.x：全局开关「桌面查岗」默认开启、可在设置页关闭——键 xy-home-v2:desk-checkin-en
//    存根命名空间（全桌面通，不随联系人隔离）；关闭后不再触发任何跨桌面查岗/求聊天。
//    设置页开关行由本文件动态插入（不动 template.html，避免跨域改 AI-B 文件）。
// ⑤ v3.17.x：跨桌面通话——非激活桌面的联系人按各自 call-incoming 概率来电（kind:'call'），
//    弹窗「接听/稍后」，接听切过去触发 triggerIncomingCall（通话归属该桌面，记录/系统消息正确）；
//    全局开关 xy-home-v2:desk-call-en 默认关闭、需在设置手动开启（#448；开启后可再关闭）。
// 归属：AI-A（业务功能）。依赖 idb.js/contacts.js/personalize.js(openModal)/chat.js/call.js。
(function () {
  if (!window.activeStore || !window.getContacts) return;
  const ROOT = 'xy-home-v2';
  const KEY = 'incoming-requests';
  const EN_KEY = 'desk-checkin-en';
  const CALL_EN_KEY = 'desk-call-en';
  const MAX = 20;                       // 队列上限，防膨胀
  const CHECK_MS = 60 * 1000;           // 轮询间隔
  const chatCoolMs = 3 * 60 * 60 * 1000; // 求聊天冷却（3 小时，比查岗久）
  const seenKeepMs = 24 * 60 * 60 * 1000; // seen 记录保留 24h 后清理
  const POKE_MSGS = ['在干嘛呢？', '忙完了吗？', '想我了没有？', '我来看看你。'];
  // v3.26.x #264：本页面会话标识 + 跨会话 pending 存活上限。
  // 队列存 localStorage（跨刷新存活），而前台弹窗只活在当前页面会话里：刷新/返回键/被别的
  // 弹窗顶掉/逃生门复位都会让 openModal 回调永不触发 → 该 cid 的 pending 永远留在队列 →
  // hasPending 从此挡掉这个联系人的一切跨桌面触发（用户视角＝"开了好几天一次都没有"）。
  const SESSION_ID = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const PENDING_TTL_MS = 10 * 60 * 1000;
  const BUSY_ESCAPE = 3;                // 软互斥最多让路 3 轮（3 分钟），之后照投——防别的弹窗长期占屏变成新的永不触发

  // ---- 全局开关（全桌面通，默认开启） ----
  function deskCheckinEn() {
    try {
      const v = window.xyStore(ROOT).get(EN_KEY);
      if (v === null || v === undefined || v === '') return true; // 默认开
      return v === '1';
    } catch (e) { return true; }
  }
  window.setDeskCheckinEn = function (en) {
    try { window.xyStore(ROOT).set(EN_KEY, en ? '1' : '0'); } catch (e) {}
  };
  function deskCallEn() {
    try {
      const v = window.xyStore(ROOT).get(CALL_EN_KEY);
      // #448：跨桌面来电改默认关闭、需手动开启（用户点名）。已显式存过 '1'/'0' 的存量
      // 用户不受影响（原样保留），只有从未碰过该开关的设备从此不再自动来电。
      if (v === null || v === undefined || v === '') return false; // 默认关
      return v === '1';
    } catch (e) { return false; }
  }
  window.setDeskCallEn = function (en) {
    try { window.xyStore(ROOT).set(CALL_EN_KEY, en ? '1' : '0'); } catch (e) {}
  };

  // ---- 跨桌面查岗/来电频率模式（全局统一，全桌面通） v3.26.x ----
  // 原逻辑：每个桌面读各自 reply 设置的 ckq-prob / ckq-cool / desk-call-prob（默认 2%+30min）。
  // 这三档模式是权威值：无论各桌面回复设置里概率/冷却怎么改，跨桌面查岗与来电都按当前模式算；
  // 只作用于「跨桌面」查岗/来电，不影响桌面上 TA 主动查岗（ck-question.js 仍读各自 ckq-prob/ckq-cool）。
  const DMODE_KEY = 'desk-freq-mode';
  const DMODES = {
    freq:  { label: '频繁', prob: 6,  cool: 15 },   // 概率 6% · 冷却 15 分钟
    std:   { label: '标准', prob: 2,  cool: 30 },   // 概率 2% · 冷却 30 分钟
    quiet: { label: '安静', prob: 1,  cool: 180 }   // 概率 1% · 冷却 3 小时（默认，最低打扰）
  };
  function deskFreqMode() {
    try {
      const v = window.xyStore(ROOT).get(DMODE_KEY);
      if (v && DMODES[v]) return v;
    } catch (e) {}
    return 'quiet';
  }
  window.setDeskFreqMode = function (m) {
    try { window.xyStore(ROOT).set(DMODE_KEY, DMODES[m] ? m : 'quiet'); } catch (e) {}
  };
  function deskDMode() {
    try { return DMODES[deskFreqMode()]; } catch (e) {}
    return DMODES.quiet;
  }

  // ---- 夜间模式（全局根键，全桌面通；默认关闭） ----
  // 开启后，仅在 22:00–07:00 时段内生效：联系人不再主动发消息 / 主动打电话，
  // 其他桌面也不再跨桌面查岗 / 跨桌面来电。时段外行为完全不变。
  const NIGHT_KEY = 'night-mode-en';
  const NIGHT_FROM = 22;   // 含 22:00
  const NIGHT_TO = 7;      // 不含 07:00
  function nightModeEn() {
    try { return window.xyStore(ROOT).get(NIGHT_KEY) === '1'; } catch (e) { return false; }
  }
  function isNightHours() {
    try { const h = new Date().getHours(); return h >= NIGHT_FROM || h < NIGHT_TO; } catch (e) { return false; }
  }
  // 供 chat.js / call.js 判定「当前是否处于夜间静默」——开关开且落在时段内
  window.nightModeActive = function () { return nightModeEn() && isNightHours(); };
  window.setNightModeEn = function (en) {
    try { window.xyStore(ROOT).set(NIGHT_KEY, en ? '1' : '0'); } catch (e) {}
  };

  // 设置页开关行（动态插入「开启群聊」行之后；样式复用 .set-row/.toggle/.txt .sub）
  // 全桌面通：根键不随联系人隔离，切桌面/回填后只需同步一次勾选态。
  function addSettingToggle(conf) {
    try {
      if (document.getElementById(conf.id + '-row')) return;
      const anchor = document.getElementById('sf-group-chat-row');
      if (!anchor) return;
      const row = document.createElement('div');
      row.className = 'set-row';
      row.id = conf.id + '-row';
      const subHtml = conf.subTag
        ? '<span class="tag" id="' + conf.id + '-tag" role="button" tabindex="0" aria-haspopup="dialog">' + conf.subTag + '</span>'
        : (conf.sub ? '<span class="sub">' + conf.sub + '</span>' : '');
      row.innerHTML =
        '<div class="ico">' + conf.ico + '</div>' +
        '<div class="txt">' + conf.title + subHtml + '</div>' +
        '<label class="toggle"><input type="checkbox" id="' + conf.id + '"><span class="tk"></span></label>';
      // v3.20.x：conf.subTag+conf.detail —— 长解释收进可点击标签，点开弹窗看详情
      if (conf.subTag && conf.detail && typeof window.openModal === 'function') {
        const tagEl = row.querySelector('#' + conf.id + '-tag');
        if (tagEl) {
          const showDetail = function (e) {
            if (e) { e.stopPropagation(); e.preventDefault(); }
            window.openModal(conf.tagTitle || '功能说明', '', function () {}, { noInput: true, staticText: conf.detail });
          };
          tagEl.addEventListener('click', showDetail);
          tagEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(); }
          });
        }
      }
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
      const input = row.querySelector('input');
      const sync = function () { const v = conf.get(); if (v !== input.checked) input.checked = v; };
      sync();
      input.addEventListener('change', function () {
        if (input.checked === conf.get()) return;
        conf.set(input.checked);
        if (typeof window.toast === 'function') window.toast(conf.toast(input.checked));
      });
      document.addEventListener('contact-switched', sync);
      document.addEventListener('mochi-restore-done', sync);
      return row;
    } catch (e) { return null; }
  }
  (function () {
    addSettingToggle({
      id: 'sf-desk-checkin',
      ico: '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="14" r="6.5"/><path d="M10 10.8v3.2l2.2 1.3"/><rect x="16.2" y="2" width="5.8" height="8.2" rx="1.7"/></svg>',
      title: '联系人跨桌面查岗',
      subTag: '功能说明',
      tagTitle: '联系人跨桌面查岗',
      detail: '其他桌面的联系人是各自独立触发、互不影响：TA 每 60 秒「探测」一次你是否还醒着，触发频率按「跨桌面查岗频率」三档模式全局统一控制（频繁/标准/安静，下方可选，含来电）；同一联系人触发后有冷却、不重复打扰。你回复后 TA 会现场回应。关闭后其他桌面的 TA 不再来查岗、也不再找你聊天。想立刻来一次：聊天 →「更多功能 → TA的提问 → 跨桌面查岗」（不看概率与冷却；本开关关着时只提示、不触发）。',
      get: deskCheckinEn,
      set: window.setDeskCheckinEn,
      toast: function (en) { return en ? '已开启：其他桌面的TA会来查岗、找你聊天' : '已关闭：其他桌面的TA不再来查岗打扰'; }
    });
    addSettingToggle({
      id: 'sf-desk-call',
      ico: '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><rect x="16.2" y="2" width="5.8" height="8.2" rx="1.7"/></svg>',
      title: '联系人跨桌面打电话',
      subTag: '功能说明',
      tagTitle: '联系人跨桌面打电话',
      detail: '开启后，其他桌面的联系人会主动给你打语音电话（本开关默认关闭，需要用请在下方手动打开；#448）；概率与冷却由下方「跨桌面查岗频率」三档全局统一生效（频繁 6%/15min、标准 2%/30min、安静 1%/3h，对所有桌面联系人同时生效），不再逐个联系人在回复设置里单独调。来电弹出后点「接听」，会先自动跳到来电联系人的桌面再响铃——这是刻意的设计：通话、聊天系统消息和主页通话记录都归属 TA 自己的桌面，方便按联系人分账，切回原桌面不会留下这条记录；若正在通话中，接听会自动挂断当前通话再转接。点「稍后」或弹窗未接，也会在 TA 的桌面留一条未接来电记录。关闭后不再有跨桌面来电。',
      get: deskCallEn,
      set: window.setDeskCallEn,
      toast: function (en) { return en ? '已开启：其他桌面的TA会主动给你打电话' : '已关闭：其他桌面的TA不再主动来电'; }
    });
    // 跨桌面查岗/来电频率模式（三档全局预设，插在跨桌面开关之后）
    addFreqModeRow();
    // 夜间模式总开关（插在频率行之后，作用于本页开关之外的联系人主动消息/来电）
    addNightModeRow();
  })();

  // 夜间模式开关行：开启后 22:00–7:00 静默联系人主动消息/来电 + 跨桌面查岗/来电。
  // 副标题实时回显「是否落在夜间时段」，每分钟刷新一次。
  function nightStatusText() {
    if (!nightModeEn()) return '关闭 · 开启后 22:00–7:00 生效';
    return isNightHours() ? '开启 · 当前生效中（22:00–7:00）' : '开启 · 当前不在夜间时段（22:00–7:00）';
  }
  function addNightModeRow() {
    try {
      if (document.getElementById('sf-night-mode-row')) return;
      const anchor = document.getElementById('sf-desk-freq') || document.getElementById('sf-group-chat-row');
      if (!anchor) return;
      const row = document.createElement('div');
      row.className = 'set-row';
      row.id = 'sf-night-mode-row';
      // #659：行内挂「功能说明」胶囊（与上方查岗/来电/频率三行同款）——文案统一登记在
      // settings-help.js 的 #sf-night-mode-row，点击由该文件全局委托打开弹窗（本处不再重复一份文案）；
      // data-setdesc 同时把说明并进设置页搜索素材（#573），搜「勿扰/静默」也能找到本行。
      row.innerHTML =
        '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/><path d="M17 4v3M15.5 5.5h3"/></svg></div>' +
        '<div class="txt">夜间模式<span class="tag" id="sf-night-mode-tag" data-setdesc="#sf-night-mode-row" role="button" tabindex="0" aria-haspopup="dialog">功能说明</span><span class="sub" id="sf-night-mode-sub"></span></div>' +
        '<label class="toggle"><input type="checkbox" id="sf-night-mode"><span class="tk"></span></label>';
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
      const input = row.querySelector('input');
      const sub = row.querySelector('#sf-night-mode-sub');
      const sync = function () {
        const v = nightModeEn();
        if (v !== input.checked) input.checked = v;
        if (sub) sub.textContent = nightStatusText();
      };
      sync();
      input.addEventListener('change', function () {
        if (input.checked === nightModeEn()) return;
        window.setNightModeEn(input.checked);
        sync();
        if (typeof window.toast === 'function') {
          window.toast(input.checked ? '夜间模式已开启：22:00–7:00 联系人不再主动打扰' : '夜间模式已关闭：恢复联系人主动消息/来电');
        }
      });
      document.addEventListener('contact-switched', sync);
      document.addEventListener('mochi-restore-done', sync);
      try { setInterval(sync, 60000); } catch (e) {} // 状态文案随时段变化刷新
      return row;
    } catch (e) { return null; }
  }

  // 频率模式选择行：三档 pill（频繁/标准/安静），全局统一生效；点击即切换并存根键。
  // 复用 .set-row + .pill/.pill.on（base.css/setting.css 既有样式），不新增全局 CSS。
  var freqDetail = '「跨桌面查岗 / 来电」的频率按全局档位统一生效（对所有桌面联系人同时生效）：' +
    '\n· 频繁：概率 6%、冷却 15 分钟；' +
    '\n· 标准：概率 2%、冷却 30 分钟；' +
    '\n· 安静：概率 1%、冷却 3 小时（默认）。' +
    '\n\n选档后立即对所有桌面的联系人生效，改一次全绿。只影响「联系人跨桌面查岗 / 来电」的触发频率，不影响桌面上 TA 主动查岗（主动查岗仍按回复设置里各自的概率/冷却）。';
  function syncFreqPills() {
    try {
      const cur = deskFreqMode();
      const wrap = document.getElementById('sf-desk-freq');
      if (!wrap) return;
      wrap.querySelectorAll('.pill').forEach(function (b) {
        const on = b.dataset.m === cur;
        b.classList.toggle('on', on);
        // 修复 base.css `.pill.on` 在浅色主题下白底白字（--card-bg 白 + --btn-ink 白）→ 选中态文字变白框。
        // base.css 已全局改为 color:var(--ink)（浅色深字/暗色浅字）；此处内联覆盖作防御冗余，
        // 防止个别主题/旧产物仍白底白字。非选中时清空内联色恢复 --soft-ink。
        b.style.color = on ? 'var(--ink)' : '';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    } catch (e) {}
  }
  function addFreqModeRow() {
    try {
      if (document.getElementById('sf-desk-freq')) return;
      const anchor = document.getElementById('sf-desk-call-row') ||
        document.getElementById('sf-desk-checkin-row') ||
        document.getElementById('sf-group-chat-row');
      if (!anchor) return;
      const row = document.createElement('div');
      row.className = 'set-row';
      row.id = 'sf-desk-freq';
      // 两行式布局避免窄屏换行：第一行标题+功能说明，第二行三个档位按钮横排铺满
      row.style.cssText = 'flex-direction:column;align-items:stretch;gap:10px;';
      row.innerHTML =
        '<div class="freq-head" style="display:flex;align-items:center;gap:12px;min-width:0;">' +
        '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>' +
        '<div class="txt">跨桌面查岗频率<span class="tag" id="sf-desk-freq-tag" role="button" tabindex="0" aria-haspopup="dialog">功能说明</span></div>' +
        '</div>' +
        '<div class="freq-pills" style="display:flex;gap:8px;flex-wrap:nowrap;padding-left:34px;"></div>';
      const wrap = row.querySelector('.freq-pills');
      ['freq', 'std', 'quiet'].forEach(function (m) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pill';
        b.dataset.m = m;
        b.setAttribute('aria-pressed', 'false');
        b.style.cssText = 'flex:1;padding:8px 0;text-align:center;min-width:0;';
        b.textContent = DMODES[m].label;
        b.addEventListener('click', function () {
          window.setDeskFreqMode(m);
          syncFreqPills();
          try { if (typeof window.openModal === 'function') window.openModal('跨桌面查岗频率', '', function () {}, { noInput: true, staticText: '已切换为「' + DMODES[m].label + '」频率：概率 ' + DMODES[m].prob + '%、冷却 ' + (DMODES[m].cool < 60 ? DMODES[m].cool + ' 分钟' : (DMODES[m].cool / 60) + ' 小时') + '。已对所有桌面联系人生效。' }); } catch (e) {}
        });
        wrap.appendChild(b);
      });
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
      // 显式固定这三行的顺序：查岗 → 打电话 → 频率（频率最下）。
      // 不能依赖 addSettingToggle 的 insertBefore 顺序（anchor 固定为 group-chat 行时，
      // 第二次插入会被插到第一次前面 → 打电话/查岗顺序颠倒），这里用 appendChild 按期望顺序统一重排。
      try {
        const setGroup = row.parentNode;
        ['sf-desk-checkin-row', 'sf-desk-call-row', 'sf-desk-freq'].forEach(function (id) {
          const el = setGroup.querySelector('#' + id);
          if (el) setGroup.appendChild(el);
        });
      } catch (e) {}
      // 长解释收进「功能说明」标签弹窗（与跨桌面查岗/来电开关同款交互）
      const tagEl = row.querySelector('#sf-desk-freq-tag');
      if (tagEl && typeof window.openModal === 'function') {
        const showDetail = function (e) {
          if (e) { e.stopPropagation(); e.preventDefault(); }
          window.openModal('跨桌面查岗频率', '', function () {}, { noInput: true, staticText: freqDetail });
        };
        tagEl.addEventListener('click', showDetail);
        tagEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(); }
        });
      }
      syncFreqPills();
      document.addEventListener('contact-switched', syncFreqPills);
      document.addEventListener('mochi-restore-done', syncFreqPills);
    } catch (e) {}
  }

  function rootGet(k) { try { return window.xyStore(ROOT).get(k); } catch (e) { return null; } }
  function rootSet(k, v) { try { window.xyStore(ROOT).set(k, v); } catch (e) {} }

  // ---- v3.26.x #264 调度可观测性 + 弹窗互斥（跨机型同一条路径，无设备分支） ----
  var ticks = 0;                         // 本会话轮询次数（诊断：定时器活着吗）
  var busyTicks = 0;                     // 连续让路轮数（软互斥逃逸计数）
  var releaseLog = [];                   // 最近释放事件（环形 3 条，供诊断回看）
  var liveModals = {};                   // 本会话已投出的前台弹窗：cid -> 当时的弹窗标题
  function noteRelease(msg) {
    releaseLog.push(msg + '@' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    if (releaseLog.length > 3) releaseLog.shift();
  }
  // 全站弹窗共用同一批 DOM（openModal 只有一个 #modal-mask），已有浮层时投递 = 互相顶掉：
  // 被顶掉那一侧的回调永不触发，pending 就成了孤儿。与 ta-ask.js / ck-question.js 的
  // cardPopupBusy 同款互斥，另外多挡通话面板。
  // #264：应用锁/问答门（#applock-mask，z-index 高于一切弹窗且盖满全屏）属硬互斥——
  // 投进去只会落在锁屏底下，用户解完锁才发现（或永远发现不了），锁着期间整轮不掷。
  function hardLocked() {
    const el = document.getElementById('applock-mask');
    return !!(el && !el.hidden);
  }
  function layerBusy() {
    return ['modal-mask', 'tc-mask', 'qa-mask', 'call-mask'].some(function (id) {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
  }
  // 正在打字时不弹（跨桌面弹窗会抢焦点：IME 组合中的文字直接丢失，同 ta-ask 那批报障）
  function typingBusy() {
    const ae = document.activeElement;
    if (!ae || ae === document.body) return false;
    const ci = document.getElementById('chat-input');
    if (ci && ae === ci) return true;
    return ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable === true;
  }
  // 本会话投出的弹窗若已不在屏幕上（被别的弹窗顶掉/返回键关闭/死点击逃生门复位），
  // 回调永远不会再执行 → 当场释放 pending，别让这条记录把该联系人卡死到永远。
  function reconcileLiveModals() {
    const mask = document.getElementById('modal-mask');
    const titleEl = document.getElementById('modal-title');
    Object.keys(liveModals).forEach(function (cid) {
      const ours = !!(mask && !mask.hidden && titleEl && titleEl.textContent === liveModals[cid]);
      if (ours) return;
      delete liveModals[cid];
      // #441：被顶掉/关闭未应答的跨桌面来电补记「未接听」（与「稍后」同口径——
      // setStatus 命中才记，幂等不双写；归属联系人桌面）
      var wasCall = queue().some(function (x) { return x.cid === cid && x.status === 'pending' && x.kind === 'call'; });
      if (setStatus(cid, 'seen')) {
        noteRelease('弹窗消失未应答，释放 ' + cName(cid));
        if (wasCall && window.callRecordMissed) window.callRecordMissed(cid, cName(cid));
      }
    });
  }

  function queue() {
    let q = [];
    try { const v = rootGet(KEY); if (v) { const a = JSON.parse(v); if (Array.isArray(a)) q = a; } } catch (e) {}
    // 清理 seen 过久的（保留 pending）
    const now = Date.now();
    // v3.26.x #264：跨会话孤儿 pending 自愈。弹窗只活在投出它的那个页面会话里，而队列存
    // localStorage 会跨刷新存活：刷新/返回键/无应答留下的 pending 超过存活上限一律释放，
    // 否则 hasPending 会永久挡掉该联系人的一切跨桌面查岗/来电（用户视角＝开了很久一次没有）。
    let healed = 0;
    q.forEach(function (x) {
      if (x.status === 'pending' && x.sid !== SESSION_ID && now - (x.ts || 0) > PENDING_TTL_MS) {
        x.status = 'seen'; x.ts = now; healed++;
        // #441：跨会话孤儿的来电同样补记未接——弹窗随上个会话一起消失＝这通电话用户永远
        // 无从得知，与「稍后/被顶」同口径落归属桌面记录+系统消息（healed 只走一次，幂等）
        if (x.kind === 'call' && window.callRecordMissed) { try { window.callRecordMissed(x.cid, cName(x.cid)); } catch (e) {} }
      }
    });
    const filtered = q.filter(x => x.status !== 'seen' || now - (x.ts || 0) < seenKeepMs);
    if (healed || filtered.length !== q.length) { rootSet(KEY, JSON.stringify(filtered)); q = filtered; }
    if (healed) noteRelease('跨会话孤儿 pending 释放 ' + healed + ' 条');
    return q;
  }
  function saveQ(q) { rootSet(KEY, JSON.stringify(q.slice(-MAX))); }

  function cName(cid) {
    try {
      const c = (window.getContacts() || []).find(x => x.id === cid);
      if (c && c.name) return c.name;
    } catch (e) {}
    return cid === 'default' ? 'TA' : 'TA';
  }
  // 该桌面联系人自己的 partner 头像（聊天头像 cs-avatar-partner 优先，回退该桌面
  // 的身份图标 feed-ta-avatar，再回退桌面装饰 avatar-partner）——
  // 跨桌面查岗/求聊天/来电通知必须用它，否则 bg-keep 会回退当前桌面头像导致头像错。
  // 非 default 联系人的身份图标存在各自桌面命名空间 feed-ta-avatar；default 的联系人
  // 身份图存在根键，额外回退一次（与 feed.js taAvFor 同口径）。
  function cAvatar(cid) {
    try {
      const s = (cid && window.storeFor) ? window.storeFor(cid) : window.activeStore;
      let a = s.get('cs-avatar-partner') || s.get('feed-ta-avatar') || s.get('avatar-partner') || '';
      if (!a && cid === 'default' && window.xyStore) {
        a = window.xyStore('xy-home-v2').get('feed-ta-avatar') || '';
      }
      return (a && (a.indexOf('data:') === 0 || /^https?:\/\//i.test(a))) ? a : '';
    } catch (e) { return ''; }
  }
  // 该联系人桌面聊天里，最近是否已出现过这一道查岗题——跨桌面后台通知去重依据。
  // 卡写入的是「触发联系人自己桌面」的聊天（xy-home-v2:<cid>:chat-msgs），而 bg-keep 的
  // recentChatDup 只扫当前桌面聊天，看不到这张卡 → 同一道题再次被抽中时会重复弹系统通知
  //（用户反馈：刚在聊天里看过又重弹）。这里同步读该桌面的聊天记录（本地存储，同步可用），
  // 命中同文则说明用户已看过/答过这道题 → 后台不再重复追问、也不再重复弹通知。
  function deskQSeenRecently(cid, text) {
    if (!text) return false;
    try {
      const raw = localStorage.getItem('xy-home-v2:' + cid + ':chat-msgs');
      if (!raw) return false;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return false;
      const cutoff = Date.now() - 60 * 60000; // 1 小时窗口（超出则视为新的正常查岗）
      const norm = String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '');
      if (norm.length < 2) return false;
      for (let i = arr.length - 1, n = 0; i >= 0 && n < 150; i--, n++) {
        const m = arr[i];
        if (!m) continue;
        const mts = m.ts || 0;
        if (mts && mts < cutoff) break;
        let t = String(m.text || '');
        if (t.indexOf('|||') >= 0) t = t.split('|||')[0];
        t = t.replace(/\|[^|]*$/, '').replace(/<[^>]*>/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '');
        if (!t) continue;
        if (t.length >= 6 && norm.length >= 6 && (t.indexOf(norm) >= 0 || norm.indexOf(t) >= 0)) return true;
        if (norm === t) return true;
      }
    } catch (e) {}
    return false;
  }
  // 各桌面专属设置：回复设置随联系人隔离（replyCfg(cid) 读取 storeFor(cid) 的 rc-*），
  // 这里用与 chat.js cfgn 同款读取，避免依赖未暴露的内部结构
  function cfgFor(cid) {
    try {
      if (window.replyCfgFor) return window.replyCfgFor(cid);
    } catch (e) {}
    return {};
  }
  function num(c, k, def) { const v = c && c[k]; if (typeof v === 'number' && v >= 0) return v; return def; }
  function lastKey(cid, kind) { return 'incoming-last:' + kind + ':' + cid; }
  function lastAt(cid, kind) { try { const v = rootGet(lastKey(cid, kind)); return parseInt(v, 10) || 0; } catch (e) { return 0; } }
  function markLast(cid, kind) { try { rootSet(lastKey(cid, kind), String(Date.now())); } catch (e) {} }
  function hasPending(cid) { return queue().some(x => x.cid === cid && x.status === 'pending'); }
  function setStatus(cid, status) {
    const q = queue();
    let hit = false;
    q.forEach(x => { if (x.cid === cid && x.status === 'pending') { x.status = status; x.ts = Date.now(); hit = true; } });
    if (hit) saveQ(q);
    return hit;
  }

  // 入队 + 表现：前台弹窗 / 后台系统通知
  // force＝让路已达上限或用户手动触发时照投（顶掉当前浮层，被顶掉那侧的 pending 由
  // reconcileLiveModals 下一轮对账释放）——否则软互斥会变成新的「永久不触发」。
  function deliver(req, force) {
    const q = queue();
    if (q.some(x => x.cid === req.cid && x.status === 'pending')) return false; // 未处理不重复
    // v3.26.x #678：通话中一律不投「来电」——前台弹窗会压在通话画面上，后台路径还会发
    //   「快回来接听」通知并挂起一条来电（回前台重响），用户视角全是「通话中还被打电话」；
    //   弹窗里的「接听」更会把当前通话直接挂断（#441 设计）。这里是最后一道闸：拒绝即不入队、
    //   不写冷却（markLast 在后面），挂断后下一轮照样能正常触发。
    //   放在 force 之前＝用户手动触发（设置里的测试入口）同样受闸，通话中不制造第二种通话。
    if (req.kind === 'call' && window.callInProgress && window.callInProgress()) return false;
    if (!document.hidden && (hardLocked() || typingBusy())) return false;
    // v3.26.x #264：浮层占用时默认不投——#modal-mask 是全站唯一 DOM，同一轮里后一个
    // 联系人的投递会把前一个刚投出的弹窗顶掉，被顶掉那侧回调永不触发＝孤儿 pending。
    // 拒绝即不入队、不写冷却，该联系人下一轮照样有机会；force 时才顶（对账会善后）。
    if (!force && !document.hidden && layerBusy()) return false;
    req.sid = SESSION_ID;   // v3.26.x #264：弹窗只活在本页面会话，标记归属才能识别跨会话孤儿
    q.push(req);
    saveQ(q);
    markLast(req.cid, req.kind);
    const name = cName(req.cid);
    const title = req.kind === 'chat' ? name + ' 想找你聊天' : (req.kind === 'call' ? name + ' 来电了' : name + ' 来查岗了');
    if (document.hidden) {
      // v3.19.x：后台命中时不再只是通知——查岗/求聊天直接把卡写入对应联系人桌面聊天，
      // 切回前台到该联系人即可看到并回答；来电无法后台接听，只保留系统通知。
      try {
        // avFixed：明示大头像由本页面的 cAvatar(req.cid) 权威决定（该联系人自己桌面的头像）。
        // 若不传，bg-keep 会在 av 为空时回退当前桌面头像 → 把「当前桌面的联系人头像」错当成
        // 跨桌面联系人头像显示。传了 avFixed 后空值走中立 mochi 图标，绝不再借用当前桌面。
        const av = cAvatar(req.cid);
        if (req.kind === 'call') {
          // #204：改走 call.js 响铃挂起（原 #159 只发通知即标记 seen 丢弃——切回应用
          // 没有来电 UI、超时也不补未接记录，通知纯告知）。holdIncomingCall 同口径：
          // 发「快回来接听」通知 + 写 call-hold（含归属 cid），3 分钟内回到应用重响
          // 可接听，超时由 resumeHeldCall 补写未接（跨桌面自动落归属桌面）。
          // av 传归属联系人头像（cAvatar），不让挂起通知借用当前桌面头像。
          if (window.callHoldIncoming) window.callHoldIncoming(name, req.cid, av);
          else if (window.bgNotifyCheck) window.bgNotifyCheck(title, Date.now(), { name: name + '来电', av: av, avFixed: true, force: true });
        } else if (req.kind === 'checkin') {
          // 同一道题最近已在该联系人桌面聊天里出现过（用户看过/答过）→ 后台不再重复
          // 追问、也不再重复弹系统通知（仅释放 pending 防占用队列）。
          if (!deskQSeenRecently(req.cid, req.text)) {
            if (window.chatAppendDeskCkTo) window.chatAppendDeskCkTo(req.cid, req.q);
            // v3.25.x：后台落卡同样要写主页关心记录——此前只有前台「现在回TA」路径
            // （fire()）写 records-care，后台触发的跨桌面查岗在主页「桌面查岗」区块消失。
            try { if (window.addCareRecordFor) window.addCareRecordFor(req.cid, 'desk-checkin', req.text, Date.now()); } catch (e) {}
            if (window.bgNotifyCheck) window.bgNotifyCheck(title + '：' + (req.text || ''), Date.now(), { name: name + '查岗', av: av, avFixed: true });
          }
        } else { // chat 求聊天
          if (window.chatAppendDeskTextTo) window.chatAppendDeskTextTo(req.cid, req.text || '想你了，来聊聊天吧。');
          if (window.bgNotifyCheck) window.bgNotifyCheck(title + '：来陪我聊聊天吧', Date.now(), { name: name + '来聊天', av: av, avFixed: true });
        }
      } catch (e) {}
      // 卡已入库聊天，释放 pending（避免占用队列挡住下一次正常弹窗查岗）
      setStatus(req.cid, 'seen');
      return true;
    }
    if (!window.openModal) return true;
    const okText = req.kind === 'chat' ? '同意' : (req.kind === 'call' ? '接听' : '现在回TA');
    const staticText = req.kind === 'call'
      ? '想听听你的声音，接一下好吗？'
      : (req.kind === 'chat' ? '想和你聊聊天，忙完记得过来。' : '想看看你在做什么，来陪陪我呀。') + '\n' + (req.text || '');
    // 两段式确认：点胶囊只选中（不高亮即执行），点底部【确认】才切桌面/来电。
    // v3.20.x 曾用 pillSubmit「点选即提交」，用户反馈「还没点确认就跳转桌面」——
    // 点「现在回TA」胶囊瞬间就执行了，缺明确确认步骤。改回：选项 + 底部确认按钮。
    // 未选任何选项就点【确认】→ 保持弹窗并提示先选（pillVal 为 null，绝不误跳转）。
    // FIX 2026-09-16 #623：同意侧默认选中（查岗「现在回TA」/ 求聊天「同意」）——用户报
    //「桌面查岗互动卡片没有默认在【同意】，每次都要多点几遍」（此前必须先点胶囊再点【确认】）。
    // 来电「接听」不预设：误触【确认】会先挂断进行中的通话再转接（见 goReply），
    // 代价太高，保持必须显式选择；确认按钮仍在，误点不会执行。
    let modalCtl = null;
    modalCtl = window.openModal(title, '', function (v) {
      if (v === null || v === undefined) {
        // 没点选项就点确定：不执行、不跳转，保持弹窗提示先选
        try { if (modalCtl && modalCtl.stay) modalCtl.stay(); } catch (e) {}
        try { if (typeof window.toast === 'function') window.toast('请先选择「' + okText + '」或「稍后」'); } catch (e) {}
        return;
      }
      delete liveModals[req.cid]; // 已应答（无论选哪边）→ 不再需要对账
      if (v === 'later') {
        // v3.25.x：查岗点「稍后」不再凭空消失——与后台路径同口径，把卡落到该联系人
        // 桌面聊天（稍后进聊天仍可作答）并写主页「桌面查岗」关心记录，事件留痕。
        if (req.kind === 'checkin' && !deskQSeenRecently(req.cid, req.text)) {
          try { if (window.chatAppendDeskCkTo) window.chatAppendDeskCkTo(req.cid, req.q); } catch (e) {}
          try { if (window.addCareRecordFor) window.addCareRecordFor(req.cid, 'desk-checkin', req.text, Date.now()); } catch (e) {}
        }
        // #441：跨桌面来电点「稍后」不再无声消失——补记「未接听」到该联系人桌面
        //（与桌内来电拒绝/超时有记录同口径；记录/系统消息归属 TA 自己的桌面）
        if (req.kind === 'call' && window.callRecordMissed) window.callRecordMissed(req.cid, cName(req.cid));
        setStatus(req.cid, 'seen');
        return;
      }
      // 现在回 / 同意 / 接听 → 切桌面并当场发话/来电
      goReply(req);
    }, {
      noInput: true,
      lock: true,
      staticText: staticText,
      pills: [{ label: '稍后', value: 'later' }, { label: okText, value: 'reply' }],
      // FIX 2026-09-16 #623：默认选中同意侧（见上注释）；来电不预设
      pill: req.kind === 'call' ? undefined : 'reply'
    });
    try { if (modalCtl && modalCtl.okText) modalCtl.okText('确认'); } catch (e) {}
    liveModals[req.cid] = title; // v3.26.x #264：登记活弹窗，弹窗被顶掉/关闭时对账释放 pending
    return true;
  }

  // 切换 + （查岗/聊天）进聊天 + 等加载就绪后 TA 当场发话；来电只切桌面不等聊天
  function goReply(req) {
    const cid = req.cid;
    try {
      if (window.setActiveContact && cid !== (window.__activeCid || 'default')) window.setActiveContact(cid);
    } catch (e) {}
    setStatus(cid, 'accepted');
    if (req.kind === 'call') {
      // #441：接听跨桌面来电时若已有通话进行中（另一桌面的小框挂着）先挂断它
      //（挂断记录按该通话归属桌面正常落账）——功能说明承诺的「接听会自动挂断当前通话」
      // 此前从未实现：currentCall 占用时 incomingCall 直接 return，点接听毫无反应
      try { if (window.getCallState && window.getCallState() && window.hangupCall) window.hangupCall(); } catch (e) {}
      // 来电：切桌面后直接触发来电（通话归属该桌面，call.js 用当前 store 读昵称/头像/冷却）
      setTimeout(function () { fire(req); }, 300);
      return;
    }
    try {
      if (window.enterChat) window.enterChat();
    } catch (e) {}
    const once = { done: false };
    const tries = { n: 0 };
    const poll = function () {
      tries.n++;
      // 就绪判定：本桌面聊天已从 IDB 加载完成。chat.js 的 chatDbReady 会在
      // contact-switched 时置 false、loadMsgs 读完（或 12s 保险丝到期）后置 true，
      // 所以只需它即可防旧桌面残留——不要再比对 lastIdbLoadPrefix（无历史桌面
      // 走 confirmMiss 分支不更新该值，比对了会永远等超时）。
      const ready = !!(window.__chatDbReady && window.__chatDbReady());
      if (ready || tries.n > 120) {
        if (once.done) return;
        once.done = true;
        fire(req);
        return;
      }
      setTimeout(poll, 250);
    };
    setTimeout(poll, 300);
  }

  // v3.17.x：切到目标桌面后，确保该桌面 TA 昵称有值（contacts 注册表 name 兜底）——
  // 跨桌面来电/查岗面板读 lbl-partner，新建联系人桌面未设置时显示 TA 而非联系人名
  function ensureTaName(cid) {
    try {
      const s = (cid && window.storeFor) ? window.storeFor(cid) : null;
      if (!s) return;
      const cur = s.get('lbl-partner');
      if (cur) return;
      const c = (window.getContacts() || []).find(x => x.id === cid);
      if (c && c.name) s.set('lbl-partner', c.name);
    } catch (e) {}
  }

  function fire(req) {
    try {
      if (req.kind === 'call') {
        // 跨桌面来电：已切到目标桌面，先兜底 TA 昵称，再触发来电（call.js incomingCall
        // 用当前 store，通话归属/昵称/头像/记录都正确）
        ensureTaName(req.cid);
        if (window.triggerIncomingCall) window.triggerIncomingCall();
        return;
      }
      if (req.kind === 'checkin') {
        ensureTaName(req.cid);
        // v3.17.x：桌面查岗——切过来当场发卡前，先把这次查岗记进【该联系人自己桌面】的
        // records-care（主页「TA的关心」→「桌面查岗」区块按联系人聚合展示，见 records.js）
        if (window.addCareRecordFor) {
          try { window.addCareRecordFor(req.cid, 'desk-checkin', req.text, Date.now()); } catch (e) {}
        }
        // 用弹窗时抽好的题（req.q 入队时随申请保存）发卡——弹窗显示哪题、切过去就发哪题，
        // 保证用户看到的问题与回答时一致；题库被关/题被删时回退重抽。
        let q = (req.q && req.q.text) ? req.q : (window.ckQuestionPickFor ? window.ckQuestionPickFor(req.cid) : null);
        if (!q || !q.text) q = window.ckQuestionPickFor ? window.ckQuestionPickFor(req.cid) : null;
        if (q && q.text) {
          if (window.ckQuestionFire) window.ckQuestionFire(q, cfgFor(req.cid));
          else if (window.triggerCkQuestion) window.triggerCkQuestion();
          return;
        }
      }
      // 求聊天 / 查岗题库空 → 发一句开场白（TA 主动）
      const text = req.kind === 'chat'
        ? (req.text || '想你了，来聊聊天吧。')
        : '我来找你了。';
      if (window.chatAddIn) {
        window.chatAddIn(text, { initiative: true });
        if (window.showTyping) { try { window.showTyping(); } catch (e) {} }
      }
    } catch (e) {}
  }

  // 调度：遍历所有联系人，非激活桌面按各自配置掷概率（查岗/聊天/来电各自受开关控制）
  function maybeIncoming() {
    try {
      // #960：跨桌面来消息轮询相位（本仓诊断里轮询次数可达数百次/会话，是周期重活嫌疑之一）
      try { if (window.__mochiPhase) window.__mochiPhase('xd-poll'); } catch (e0) {}
      ticks++;
      reconcileLiveModals();
      // 夜间模式：整个时段内暂停一切跨桌面打扰（查岗/求聊天/来电），时段外行为不变
      if (window.nightModeActive && window.nightModeActive()) return;
      // v3.26.x #264：锁屏期整轮不掷（弹窗会压在锁底下）；打字期不掷也不计数（IME 组合
      // 中的文字会被抢焦点丢掉）；已有浮层先让路，最多让 BUSY_ESCAPE 轮后照投。
      // 跳过的那些轮不消耗冷却（markLast 只在投递时写），所以让路结束后当轮就能正常触发，
      // 不会像旧版那样把触发窗口整体吃掉。
      if (hardLocked()) return;
      var escape = false; // 本轮一次性额度：只授权顶掉一次屏幕，投成功即收回
      if (typingBusy()) return;
      if (layerBusy()) {
        busyTicks++;
        if (busyTicks <= BUSY_ESCAPE) return;
        busyTicks = 0; escape = true; // 照投后重新计票，避免长期占屏时每一轮都去顶它
      } else busyTicks = 0;
      const cur = window.__activeCid || 'default';
      const list = window.getContacts() || [];
      if (list.length < 2) return; // 只有当前桌面：无需跨桌面打扰
      list.forEach(function (c) {
        const cid = c.id;
        if (cid === cur) return; // 激活桌面不跨桌面打扰（由原 tryAutoSend 正常触发）
        if (hasPending(cid)) return; // 已有未处理申请，不重复
        const cfg = cfgFor(cid);
        // v3.20.x：跨桌面来电——与跨桌面查岗对齐：触发概率 + 每人独立冷却。
        // 概率/冷却 v3.26.x 起改读「跨桌面查岗频率」全局模式（deskDMode），不再读各桌面
        // 回复设置的 desk-call-prob/ckq-cool；冷却仍用独立键 incoming-last:call:<cid>。
        // #159：去掉 !document.hidden 前台门控——后台命中时 deliver() 的 hidden 分支
        // 会发「XX来电」系统通知并释放 pending，原门控让该分支对 call 永远走不到
        // （跨桌面联系人挂后台从不来电，与 #150 同桌面口径不一致＝报障根因）
        // v3.26.x #678：通话占用中整轮不掷来电——用户报「明明一直通话中联系人还是会打电话过来」
        //（OPPO Reno6 5G + 雨见，多机型）。不掷＝连随机数都不消耗、冷却不动，挂断后下一轮照常可触发。
        if (deskCallEn() && !(window.callInProgress && window.callInProgress())) {
          const dm = deskDMode();
          const callCool = dm.cool;
          const callProb = dm.prob;
          if (Date.now() - lastAt(cid, 'call') >= callCool * 60000 && Math.random() * 100 < callProb) {
            if (deliver({ cid: cid, kind: 'call', text: '', ts: Date.now(), status: 'pending' }, escape)) escape = false;
            return;
          }
        }
        // 查岗：开关 + 概率 + 冷却（v3.26.x 起概率/冷却读全局频率模式 deskDMode，
        //        各桌面 ckq-prob/ckq-cool 改为只影响桌面上 TA 主动查岗）
        if (deskCheckinEn() && num(cfg, 'ckq-en', 0) === 1) {
          const dm = deskDMode();
          const cool = dm.cool;
          const prob = dm.prob;
          if (Date.now() - lastAt(cid, 'checkin') >= cool * 60000 && Math.random() * 100 < prob) {
            const q = window.ckQuestionPickFor ? window.ckQuestionPickFor(cid) : null;
            if (q && q.text) {
              // v3.18.x：互动动作弹窗显示方向文案（比动作名更自然），切过去后当场发卡再随机方向
              const showText = q.type === 'action' ? (q.taToMe || q.text) : q.text;
              if (deliver({ cid: cid, kind: 'checkin', text: showText, q: q, ts: Date.now(), status: 'pending' }, escape)) escape = false;
              return;
            }
          }
        }
        // 求聊天：开关 + 概率 + 冷却（as-*）
        if (deskCheckinEn() && num(cfg, 'as-en', 0) === 1) {
          const prob = num(cfg, 'as-prob', 30);
          if (Date.now() - lastAt(cid, 'chat') >= chatCoolMs && Math.random() * 100 < prob) {
            if (deliver({ cid: cid, kind: 'chat', text: '想和你聊聊天，你有空吗？', ts: Date.now(), status: 'pending' }, escape)) escape = false;
          }
        }
      });
    } catch (e) {}
  }

  // 手动触发（测试 / 诊断用）：触发指定桌面一次查岗
  window.triggerIncomingCheckin = function (cid) {
    if (!deskCheckinEn()) { try { if (window.toast) window.toast('联系人跨桌面查岗已关闭（可在设置里开启）'); } catch (e) {} return false; }
    const q = window.ckQuestionPickFor ? window.ckQuestionPickFor(cid || 'default') : null;
    if (!q || !q.text) return false;
    return deliver({ cid: cid || 'default', kind: 'checkin', text: q.text, q: q, ts: Date.now(), status: 'pending' }, true);
  };
  // v8.29 #1003：手动触发一次跨桌面查岗（聊天「更多功能 → TA的提问 → 跨桌面查岗」）。
  // 与自动链路（maybeIncoming）的差别：不掷概率、不看该桌面冷却、不过软互斥的让路
  // ——用户当场点名要一次，这几道闸都没有意义；但保留全局开关
  //（设置 →「开启 联系人跨桌面查岗」）：关着时只提示怎么开，绝不绕过用户的显式设定偷偷触发。
  // 候选人＝除当前桌面外、开着 TA 主动查岗（该桌面回复设置 ckq-en，默认开）且没有未处理申请
  // 的联系人；有多个时随机挑一个（与自动链路一致，不固定只打扰同一个桌面）。
  // 注意 hasPending：deliver 对已有 pending 的 cid 会静默返回 false，不在这里排掉就会「点了没反应」。
  window.triggerIncomingCheckinNow = function () {
    try {
      const _toast = function (t) { try { if (typeof window.toast === 'function') window.toast(t); } catch (e) {} };
      if (!deskCheckinEn()) { _toast('联系人跨桌面查岗已关闭，可在 设置 里开启'); return false; }
      const cur = window.__activeCid || 'default';
      const others = (window.getContacts() || []).filter(function (c) { return c && c.id !== cur; });
      if (!others.length) { _toast('只有当前桌面，没有其他桌面的联系人'); return false; }
      const pool = others.filter(function (c) { return num(cfgFor(c.id), 'ckq-en', 1) === 1 && !hasPending(c.id); });
      if (!pool.length) { _toast('其他桌面的联系人都关了「TA 主动查岗」，可在 回复设置 → 查岗 里开启'); return false; }
      const who = pool[Math.floor(Math.random() * pool.length)];
      const fired = window.triggerIncomingCheckin(who.id);
      if (!fired) _toast('这个桌面的查岗题库是空的，可在 字卡库 →「TA的查岗」里添加或开启');
      return fired;
    } catch (e) { return false; }
  };
  // 手动触发（测试 / 诊断用）：触发指定桌面一次来电
  window.triggerIncomingCallReq = function (cid) {
    if (!deskCallEn()) { try { if (window.toast) window.toast('联系人跨桌面打电话已关闭（可在设置里开启）'); } catch (e) {} return false; }
    return deliver({ cid: cid || 'default', kind: 'call', text: '', ts: Date.now(), status: 'pending' }, true);
  };

  // 只读探针：供设置→诊断信息打印跨桌面来消息现场（报障时不再靠猜「为什么没触发」）
  window.__mochiIncomingProbe = function () {
    try {
      const dm = deskDMode();
      const cur = window.__activeCid || 'default';
      const now = Date.now();
      const q = queue();
      const next = (window.getContacts() || []).filter(c => c.id !== cur).slice(0, 6).map(function (c) {
        const wCall = dm.cool * 60000 - (now - lastAt(c.id, 'call'));
        const wCk = dm.cool * 60000 - (now - lastAt(c.id, 'checkin'));
        return c.name + ' 来电' + (wCall > 0 ? Math.ceil(wCall / 60000) + 'min' : '可掷') +
          '·查岗' + (wCk > 0 ? Math.ceil(wCk / 60000) + 'min' : '可掷');
      });
      return {
        ticks: ticks,
        mode: deskFreqMode(), prob: dm.prob, cool: dm.cool,
        pending: q.filter(function (x) { return x.status === 'pending'; }).length,
        live: Object.keys(liveModals).length,
        gate: hardLocked() ? '锁屏中' : (typingBusy() ? '输入中暂停' : (layerBusy() ? ('浮层占用让路' + busyTicks + '/' + BUSY_ESCAPE) : '空闲')),
        hidden: !!document.hidden,
        next: next,
        releases: releaseLog.slice(-2)
      };
    } catch (e) { return null; }
  };

  // v3.26.x #264：首查从 30~90s 提前到 12s（手机上「开一下看一眼就走」的短会话此前
  // 一次都掷不到）；回前台 3s 后补一次——iOS Safari 后台会冻结定时器，切回来若只等
  // 60s 轮询，每次都要白等一整分钟。
  var started = false;
  function startIncomingTick() {
    if (started) return;
    started = true;
    maybeIncoming();
    setInterval(maybeIncoming, CHECK_MS);
  }
  setTimeout(startIncomingTick, 12000);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !started) return;
    reconcileLiveModals();
    setTimeout(maybeIncoming, 3000);
  });
})();
