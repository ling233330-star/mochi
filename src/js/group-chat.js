// ===== 功能：群聊页（所有桌面成员在一个窗口里聊天） =====
// 桌面点「群聊」进入；成员来自 window.getContacts()（所有联系人/桌面成员）；
// 用户发消息后随机 1-2 个成员回复，@昵称则被@的成员回复；
// 消息全局存储（xy-home-v2:group-chat-msgs），不随联系人切换变。
// 依赖：contacts.js（getContacts/storeFor/activeStore）、idb.js（idbGet/idbSet）、sfx.js（playSfx）
(function () {
  const body = document.getElementById('gc-body');
  if (!body) return;
  const G = 'xy-home-v2';
  const MSG_KEY = G + ':group-chat-msgs';
  const page = document.getElementById('page-group-chat');
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
  // v3.11.x：输入栏与普通聊天页统一——更多功能/表情包/插入图片按钮 + 待发送图片草稿条
  // v3.16.x：群聊「更多功能」直接打开共享面板 #chat-more-panel（与聊天页同一套分类+功能按钮），
  // @群成员 收进共享面板分类 tabs 行最右（仅群聊打开时显示）
  const gcMoreBtn = document.getElementById('gc-input-more-btn');
  const gcMorePanel = document.getElementById('chat-more-panel');   // 共享浮层（.phone 级，聊天页也用它）
  const gcMoreAt = document.getElementById('gc-more-at');
  const gcEmojiBtn = document.getElementById('gc-emoji-btn');
  const gcImgBtn = document.getElementById('gc-img-btn');
  // v3.16.x：输入栏与聊天页对齐——语音「麦克风」/「继续说」/「批量发送」三个按钮
  // （显隐跟随当前桌面的聊天设置，与聊天页 cs-voice-send/cs-trigger-bar/cs-batch-send 一致）
  const gcMicBtn = document.getElementById('gc-mic-btn');
  const gcContinueBtn = document.getElementById('gc-continue-btn');
  const gcBatchBtn = document.getElementById('gc-batch-btn');
  const gcDraftBar = document.getElementById('gc-draft');
  const gcDraftItems = document.getElementById('gc-draft-items');
  // v3.26.x：多群聊分组——群聊列表 / 成员选择 两个面板（复用群成员面板样式，DOM 在 template）
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

  // ---- 多群聊分组（v3.26.x：可新建多个群聊、按分组切换、增删成员） ----
  // 群聊分组全局存储（xy-home-v2:gc-groups，不随桌面隔离）：
  //   [{ id, name, members: [cid...] | null, ts }]
  //   id='default' 为内置群聊（members:null = 全部现有联系人，动态跟随，不可删除）；
  //   自定义群聊 members 为选中的联系人 id 数组。
  // 消息按群分键：default 沿用旧键 xy-home-v2:group-chat-msgs（老数据无缝保留），
  //   自定义群聊用 xy-home-v2:gc-msgs-<gid>。
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

  // ---- 群聊形象设置（v3.9.x，全局 xy-home-v2:gc-profiles，不随桌面隔离） ----
  // { me: {name, avatar}, <cid>: {name, avatar} }——设置了群聊昵称/头像的成员/我，
  // 在群聊页统一显示群聊形象；未设的字段回退该联系人桌面昵称/头像（lbl-*/avatar-*）。
  // 群聊是全局功能（消息/回复设置均全局），成员形象也全局存储，切换桌面不丢。
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
  // name/avatar 传空串或 undefined = 清除该字段；两个都空则删除整条记录
  function gcProfileSet(key, name, avatar) {
    const p = gcProfiles[key] || (gcProfiles[key] = {});
    if (name === undefined) delete p.name; else if (name) p.name = name; else delete p.name;
    if (avatar === undefined) delete p.avatar; else if (avatar) p.avatar = avatar; else delete p.avatar;
    if (!p.name && !p.avatar) delete gcProfiles[key];
    gcProfileSave();
    refreshGroupViews();
  }
  // 群聊形象/成员变动后统一刷新（消息、成员面板、@面板、设置面板、标题）
  function refreshGroupViews() {
    try { renderAll(); } catch (e) {}
    try { if (membersPanel && !membersPanel.hidden) renderMembersPanel(); } catch (e) {}
    try { if (atPanel && !atPanel.hidden) renderAtPanel(); } catch (e) {}
    try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
    try { updateGroupName(); } catch (e) {}
  }
  gcProfileLoad();

  // ---- 群聊美化设置（v3.9.x，全局 xy-home-v2:gc-beauty，独立于聊天美化） ----
  // 只作用于群聊页 #page-group-chat：CSS 变量在 page 元素上局部覆盖（不串到聊天页，
  // 聊天页读的是 documentElement 上的同名变量）；壁纸/字体/自定义 CSS 也作用域到
  // 群聊页。存储只写非默认值；键名与聊天设置 cs-* 一一对应。
  const GC_BEAUTY_DEFAULTS = {
    'out-bg': '#111111', 'out-ink': '#ffffff', 'in-bg': '#ffffff', 'in-ink': '#111111',
    'send-bg': '#111111', 'send-ink': '#ffffff', 'send-show': 'show',
    'font-size': '14px', 'bubble-size': '11px 14px',
    // v3.28.x：对齐聊天美化——气泡边缘圆角 / 时间轴颜色 / 正在输入颜色
    'bubble-radius': '18px', 'time-ink': '#111111', 'typing-ink': '#8a8a8a',
    'av-shape': 'circle', 'time-style': 'under-av',
    'bg': '', 'font': '', 'css': '',
    // v3.16.x：成员群聊昵称显示开关（on = 成员消息头像上方显示昵称，默认不显示）
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
  // v3.28.x：聊天气泡边缘（四角圆角大小）——与聊天美化对齐
  const GC_BUBBLE_RADII = [
    { label: '小圆角', value: '6px' },
    { label: '标准', value: '12px' },
    { label: '大圆角', value: '18px' },
    { label: '特圆', value: '28px' }
  ];
  const GC_BUBBLE_RADIUS_DEFAULT = '18px';
  // 色板与聊天设置一致（气泡底色 / 文字色 / 发送按钮底）
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
  // v3.11.x：深色模式下未自定义配色键的默认值（浅色默认白气泡/黑字在内联变量上
  // 压过 dark.css 覆盖，是深色模式群聊白块+黑字的根源）；用户自定义过仍优先
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
  // 设置（空值/默认值 → 删除键）；应用 + 刷新设置面板回显
  function gcBeautySet(k, v) {
    const def = GC_BEAUTY_DEFAULTS[k];
    if (v === undefined || v === null || v === '' || (def !== undefined && v === def)) delete gcBeautyStored[k];
    else gcBeautyStored[k] = v;
    gcBeautySave();
    applyGcBeauty();
    // v3.16.x：昵称显示开关变化需整页重渲（昵称在 renderMsg 里按开关生成）
    if (k === 'show-name') { try { renderAll(); } catch (e) {} }
    try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
  }
  // 群聊页局部字体（不污染全局 body/html）
  function applyGcFont() {
    const page = document.getElementById('page-group-chat');
    const old = document.getElementById('gc-font-style');
    if (old) old.remove();
    if (page) page.style.fontFamily = '';
    const v = gcBeautyGet('font');
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
  // 群聊页局部自定义气泡 CSS（选择器自动加 #page-group-chat 作用域）
  function applyGcCss() {
    const old = document.getElementById('gc-bubble-style');
    if (old) old.remove();
    const css = gcBeautyGet('css');
    if (!css) return;
    let out = css, hint = null;
    // v3.26.x #181：统一走 chat.js 的 mochiMapBubbleCss（别名扩充 + 未认出气泡类名时整包声明
    // 兜底，修「上传网页模板气泡 CSS 后界面零变化」多机型反复问题；同单聊 applyCss）
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
  // 应用群聊美化（CSS 变量在 #page-group-chat 上局部覆盖；默认值与聊天页默认一致）
  function applyGcBeauty() {
    const page = document.getElementById('page-group-chat');
    if (!page) return;
    const g = gcBeautyGet;
    page.style.setProperty('--msg-in-bg', g('in-bg'));
    page.style.setProperty('--msg-in-ink', g('in-ink'));
    page.style.setProperty('--msg-out-bg', g('out-bg'));
    page.style.setProperty('--msg-out-ink', g('out-ink'));
    page.style.setProperty('--chat-font-size', g('font-size'));
    page.style.setProperty('--chat-bubble-pad', g('bubble-size'));
    // v3.28.x：对齐聊天美化——气泡边缘圆角 / 时间轴颜色 / 正在输入颜色
    page.style.setProperty('--chat-bubble-radius', g('bubble-radius'));
    page.style.setProperty('--msg-time-ink', g('time-ink'));
    page.style.setProperty('--typing-ink', g('typing-ink'));
    page.style.setProperty('--send-bg', g('send-bg'));
    page.style.setProperty('--send-ink', g('send-ink'));
    page.style.setProperty('--msg-av-radius', g('av-shape') === 'square' ? '10px' : '50%');
    const sendBtn = document.getElementById('gc-send');
    if (sendBtn) sendBtn.style.display = g('send-show') === 'hide' ? 'none' : '';
    // 时间轴样式：page 级类（始终挂类，含默认 under-av 的还原规则，隔离聊天页 body 级类）
    GC_BEAUTY_STYLES.forEach(s => page.classList.remove('cs-time-' + s.value));
    page.classList.add('cs-time-' + g('time-style'));
    // 壁纸（>6MB 异常存量清掉回默认，同聊天页防护）
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
  // v3.14.x：IDB 回填完成后重载+重应用——gc-beauty 若只存于 IndexedDB（LS 写失败/被清理），
  // boot 时 load 读空走默认 → 重进后退回默认美化（与 chat-settings 气泡 CSS 同款兜底）
  document.addEventListener('mochi-restore-done', function () {
    try { gcBeautyLoad(); } catch (e) {}
    try { applyGcBeauty(); } catch (e) {}
  });
  // v3.11.x：深色/浅色切换时重算默认配色（html data-theme 属性变化即重写 page 级内联变量）
  try {
    new MutationObserver(() => { try { applyGcBeauty(); } catch (e) {} })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) {}

  // ---- 成员信息 ----
  function getMembers() {
    // v3.26.x：多群聊分组——当前群聊的成员（default 群 = 全部联系人，自定义群 = 选中的联系人）
    return groupMemberList(currentGroup());
  }
  function memberName(cid) {
    // v3.9.x：群聊昵称覆盖优先，未设置回退该联系人桌面昵称（lbl-partner）
    try { const p = gcProfileGet(cid); if (p.name) return p.name; } catch (e) {}
    try { const lbl = window.storeFor(cid).get('lbl-partner'); if (lbl) return lbl; } catch (e) {}
    const m = getMembers().find(x => x.id === cid);
    return m ? m.name : '成员';
  }
  function memberAvatar(cid) {
    try { const p = gcProfileGet(cid); if (p.avatar) return p.avatar; } catch (e) {}
    // v3.12.x：与聊天页一致——联系人换聊天头像只写聊天专用键 cs-avatar-partner（桌面独立），
    // 未设回退该联系人桌面 avatar-partner
    try { const cs = window.storeFor(cid).get('cs-avatar-partner'); if (cs) return cs; } catch (e) {}
    try { return window.storeFor(cid).get('avatar-partner') || ''; } catch (e) { return ''; }
  }
  function myName() {
    // v3.9.x：我的群聊昵称覆盖优先（群聊里"我"不再随切换桌面变化），未设置回退当前桌面
    try { const p = gcProfileGet('me'); if (p.name) return p.name; } catch (e) {}
    try { const v = window.activeStore().get('lbl-user'); if (v) return v; } catch (e) {}
    return '我';
  }
  function myAvatar() {
    try { const p = gcProfileGet('me'); if (p.avatar) return p.avatar; } catch (e) {}
    // v3.10.x：与聊天页一致——TA 换我头像只写聊天专用键 cs-avatar-user，未设回退桌面 avatar-user
    try { const cs = window.activeStore().get('cs-avatar-user'); if (cs) return cs; } catch (e) {}
    try { return window.activeStore().get('avatar-user') || ''; } catch (e) { return ''; }
  }
  // 桌面原本昵称（设置面板里"原昵称"区分用；我的取当前桌面）
  function deskPartnerName(cid) {
    try { const lbl = window.storeFor(cid).get('lbl-partner'); if (lbl) return lbl; } catch (e) {}
    const m = getMembers().find(x => x.id === cid);
    return m ? m.name : '';
  }
  function deskMeName() {
    try { return window.activeStore().get('lbl-user') || ''; } catch (e) { return ''; }
  }

  // ---- 头像渲染 ----
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

  // ---- 消息存储（v3.26.x 止血：合并+低频+空闲落盘，避免大群聊每次消息同步全量写卡主线程） ----
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
    const run = gPersistRun;
    gPersistRun = null;
    gPersistTimer = null;
    if (run) { try { Promise.resolve(run()).catch(function () {}); gLastPersistAt = performance.now(); } catch (e) {} }
  }
  // v3.34.x #245 群聊媒体令牌化（对齐单聊 #142）：落盘前把消息里的 data:image 载荷
  // 统一换成媒体池令牌 @@m:hash（内容寻址去重；渲染由 media-pool 文档级观察器解图，
  // 池 GC 引用扫描已含群聊键 #186）。此前群聊每条表情/图片整段 base64 内联进消息数组，
  // 消息无上限+每次落盘全量重写，数组一次比一次大，LS 配额超限后被静默吞掉只剩
  // IDB 异步写。语音（data:audio）池暂不收、保持内联。令牌化失败/不支持环境回退原值。
  async function gcNormalizeMedia() {
    if (!window.mochiMediaTokenize) return;
    const seen = new Map();
    const collect = (v) => { if (typeof v === 'string' && v.indexOf('data:image/') === 0 && v.length >= 1024 && !seen.has(v)) seen.set(v, null); };
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
  // quick=true（离页/切群保写）：跳过令牌化与池 flush 直接同步落盘——令牌化是真实异步
  //（sha256+IDB 查池），unload 窗口内可能完不成导致丢写；池有独立的 hidden flush 兜底
  async function gcWriteMsgs(quick) {
    if (!quick) {
      try { await gcNormalizeMedia(); } catch (e) {}
      try { if (window.mochiMediaFlush) await window.mochiMediaFlush(); } catch (e) {} // #142：池先落盘，引用后落盘
    }
    const data = JSON.stringify(msgs);
    const key = groupMsgKey(curGid);
    try { localStorage.setItem(key, data); } catch (e) {}
    try { if (window.idbSet) window.idbSet(key, data); } catch (e) {}
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
    try { msgs = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { msgs = []; }
    if (!Array.isArray(msgs)) msgs = [];
    try {
      if (window.idbGet) {
        window.idbGet(key).then(v => {
          // FIX 串群 #243：idbGet 异步回来时可能已切群/重进（本回调还挂在旧 key 上）——
          // key 不再是当前群的键就整包丢弃；否则旧群数据会覆盖当前群 msgs 并被下次
          // 保存回写进新群的存储键（A 群历史灌进 B 群）
          if (key !== groupMsgKey(curGid)) return;
          if (v === undefined || v === null) return;
          try { const a = JSON.parse(v); if (Array.isArray(a) && a.length >= msgs.length) { msgs = a; renderAll(); } } catch (e) {}
        }).catch(() => {});
      }
    } catch (e) {}
  }

  // ---- 渲染 ----
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // v3.8.x：与 chat.js 的 escTxt/escTxtBr 对齐——全量转义 + 换行转 <br>。
  // 群聊气泡渲染与普通聊天页完全一致（此前用 textContent 设纯文本，多行消息不换行、
  // 且与普通聊天页的 span 包裹方式有差异）。
  function escTxt(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escTxtBr(s) { return escTxt(s).replace(/\n/g, '<br>'); }
  function attrEsc(s) { return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // 引用块（复用聊天页 .msg-quote 样式；图片/表情包引用只显示缩略图）
  // v3.16.x：支持 { t, imgs } 对象格式（气泡点「引用」后发送的组合引用，与聊天页 quoteValue 同构）
  // v3.26.x：与聊天页 quoteTextSafe 对齐的清理——历史/导入数据里语音引用存的是原始
  //   「名称|||data:audio;base64…」字符串（群聊早期版本成员回复引用直接存 userText 原文），
  //   直出会整串 base64 铺满屏幕。渲染前统一还原成可读标签，新数据本已是标签、原样通过。
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
  // 群聊语音播放（聊天页 playVoiceInChat 在 chat.js 闭包内不暴露，群聊独立一份）
  let gcVoiceAudio = null;
  let gcVoiceBtn = null;
  function gcPlayVoice(btn, src) {
    if (!src) return;
    // 令牌 resilient：池令牌（现仅图片，语音日后若入池）内存命中即展开为真实地址
    try { const ex = window.mochiMediaExpand && window.mochiMediaExpand(src); if (ex) src = ex; } catch (e) {}
    if (gcVoiceBtn === btn) { try { gcVoiceAudio.pause(); } catch (e) {} try { if (gcVoiceAudio && gcVoiceAudio.parentNode) gcVoiceAudio.parentNode.removeChild(gcVoiceAudio); } catch (e) {} gcVoiceAudio = null; if (gcVoiceBtn) gcVoiceBtn.classList.remove('playing'); gcVoiceBtn = null; return; }
    if (gcVoiceBtn) { try { gcVoiceAudio.pause(); } catch (e) {} try { if (gcVoiceAudio && gcVoiceAudio.parentNode) gcVoiceAudio.parentNode.removeChild(gcVoiceAudio); } catch (e) {} gcVoiceBtn.classList.remove('playing'); }
    const a = new Audio(src);
    // FIX 2026-09-12 #359 群聊语音无声：把 Audio 挂到 DOM 再播——部分安卓内核（Edge/雨见等
    // Chromium 系）对未挂载的 Audio 静默空放，与字卡库/聊天气泡同根因，同款加固；停播即卸。
    a.style.display = 'none';
    document.body.appendChild(a);
    gcVoiceAudio = a; gcVoiceBtn = btn;
    btn.classList.add('playing');
    // v3.12.x：播完/出错即卸掉 src——data: 音频的解码缓冲随元素存活，显式释放
    // 不等 GC（长时间群聊里每条语音一个 Audio，软滞留会在低内存安卓上累积）
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
  // 放置一条消息 DOM——beforeEl 传锚点时插到其前（#246「查看更早」向顶部补历史），否则追加
  function gcPlaceMsg(m, beforeEl) {
    if (beforeEl && beforeEl.parentNode === body) body.insertBefore(m, beforeEl);
    else body.appendChild(m);
    pruneGcDom();
  }
  function renderMsg(rec, idx, beforeEl) {
    const m = document.createElement('div');
    m.className = 'msg ' + (rec.side === 'out' ? 'msg-out' : 'msg-in');
    if (idx === undefined) idx = msgs.length - 1;
    m.dataset.gcIdx = idx;
    const timeHtml = rec.ts ? '<span class="msg-time">' + fmtTime(rec.ts) + '</span>' : '';
    if (rec.side === 'out') {
      m.innerHTML = '<div class="msg-bubble"></div><div class="msg-side"><div class="msg-av"></div>' + timeHtml + '</div>';
    } else {
      // v3.16.x：可选显示成员群聊昵称（群聊设置→成员昵称显示，默认关）——
      // 昵称插在 .msg-side 首位（列向布局天然在头像上方），与聊天页无名字的旧表现兼容
      const nmHtml = gcBeautyGet('show-name') === 'on'
        ? '<span class="gc-from-name">' + escapeHtml(memberName(rec.cid)) + '</span>'
        : '';
      m.innerHTML = '<div class="msg-side">' + nmHtml + '<div class="msg-av"></div>' + timeHtml + '</div><div class="msg-bubble"></div>';
    }
    const av = m.querySelector('.msg-av');
    const b = m.querySelector('.msg-bubble');
    if (rec.side === 'out') fillAv(av, myAvatar());
    else fillAv(av, memberAvatar(rec.cid));
    // #287：点成员头像拍 TA（对齐聊天页点头像「对 TA 拍一拍」）——面板/发送见下方 gc-poke 区
    if (rec.side === 'in' && rec.cid) {
      av.style.cursor = 'pointer';
      av.title = '拍一拍 ' + memberName(rec.cid);
      av.addEventListener('click', (e) => { e.stopPropagation(); gcOpenPokeCard(rec.cid); });
    }
    // 拍一拍：居中系统样式
    if (rec.special === 'poke') {
      m.className = 'msg-poke';
      m.innerHTML = '<span>' + escTxt(rec.text || '') + '</span>';
      gcPlaceMsg(m, beforeEl);
      return m;
    }
    // v3.26.x：决定结果系统消息（群聊里使用【帮我决定】/【多人决定】的结果，居中系统样式，同拍一拍）
    if (rec.special === 'system') {
      m.className = 'msg-poke';
      m.innerHTML = '<span>' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(rec.text || '') : escTxtBr(rec.text || '')) + '</span>'; // FIX 2026-09-13 #394 群聊文本气泡内嵌令牌转图
      gcPlaceMsg(m, beforeEl);
      return m;
    }
    const quoteStr = rec.quote ? gcQuoteHtml(rec.quote) : '';
    // v3.9.x：按消息类型渲染（与聊天页 renderMsg 对齐：表情包小图/图片大图/语音可播放）
    if (rec.retracted) {
      // v3.10.x：补齐点击查看原消息（与聊天页 bindToggle 一致）——原仅显示提示文本，
      // 无 cursor:pointer 且未绑 onclick，用户反馈"群聊无法点击查看撤回的消息"。
      // FIX 撤回查看 #244：原 `rec.orig || rec.text` 在点击时 innerHTML 直出原始文本——
      // 多行丢换行、图片/表情/语音点开整屏 base64、字卡含 HTML 会被当标签执行（注入）。
      // 对齐单聊 chat.js retractMsg（撤回时存渲染快照 rec.orig）；无快照走安全回退。
      // 撤回图片可看 #248：媒体记录即时从 rec.text/rec.parts 重拼缩略图视图（优先于
      // 存量占位快照 rec.orig——老数据撤回时只存了 [图片] 占位也能看图）
      b.dataset.orig = gcRetractMediaHtml(rec) || rec.orig || gcRetractFallbackHtml(rec);
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
    } else if (rec.type === 'sticker' || rec.type === 'image' || (rec.type !== 'voice' && window.mochiMediaIsToken && window.mochiMediaIsToken(rec.text))) {
      // FIX 2026-09-12 #383 存量乱码自愈：修复前令牌卡曾以 type:text 入群聊库（气泡直出
      // @@m:hash 串），渲染补认裸令牌走图片分支（<img src> 令牌照常被 media-pool 观察器解图）
      if (rec.type !== 'sticker' && rec.type !== 'image') rec.type = 'image';
      b.style.padding = '6px';
      b.style.background = '';
      b.style.border = '';
      b.style.boxShadow = '';
      b.innerHTML = quoteStr + (rec.type === 'image'
        ? '<img class="msg-img msg-img-big" src="' + attrEsc(rec.text) + '" alt="图片" loading="lazy" decoding="async">'
        : '<img class="msg-img msg-img-sm" src="' + attrEsc(rec.text) + '" alt="表情" loading="lazy" decoding="async">');
    } else if (rec.type === 'voice' || (String(rec.text || '').indexOf('|||') >= 0 && /@@m:[0-9a-f]{32}$/.test(String(rec.text || '')))) {
      // FIX 2026-09-13 #395 群聊补认「名称|||@@m:hash」令牌语音（与单聊同口径，存量消息不再直出令牌串）
      b.style.padding = '8px 10px';
      b.style.background = '';
      b.style.border = '';
      b.style.boxShadow = '';
      // FIX 2026-09-13 #395 防御：裸令牌/令牌当名字不得显成名称（同 chat.js voicePartsOf）
      const _vraw = String(rec.text || '');
      const _vbare = !!(window.mochiMediaIsToken && window.mochiMediaIsToken(_vraw));
      const vparts = _vbare ? [_vraw] : _vraw.split('|||');
      let vname = (vparts[0] || '语音消息').replace(/\.[^.]+$/, '');
      if (!_vbare && window.mochiMediaIsToken && window.mochiMediaIsToken(vname)) vname = '语音消息';
      const vsrc = _vbare ? _vraw : (vparts[1] || '');
      b.innerHTML = quoteStr + '<div class="msg-voice" data-src="' + attrEsc(vsrc) + '">' +
        '<button class="msg-voice-play" title="播放">' +
        // 播放/暂停双图标：playing 时 CSS 切换显示（与 chat.js 聊天页语音气泡同款互动态）
        '<svg class="voice-ico-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
        '<svg class="voice-ico-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' +
        '</button>' +
        '<div class="msg-voice-wave"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<span class="msg-voice-name">' + escTxt(vname) + '</span>' +
        '</div>';
      b.querySelector('.msg-voice-play').addEventListener('click', function (e) {
        e.stopPropagation();
        gcPlayVoice(this, vsrc);
      });
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
      // v3.8.x：与 chat.js 一致——span 包裹 + 全量转义 + 换行转 <br>
      // #385：文本内嵌媒体池令牌 @@m:hash 交给 window.mochiInlineTextHtml 行内转 <img>，
      // 防令牌串被当文字直出（群聊多字卡回复拼接同单聊，公用库共享多机型全现）
      b.innerHTML = quoteStr + '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(rec.text || '') : escTxtBr(rec.text || '')) + '</span>';
    }
    // v3.16.x：心意字卡（情绪/心意/交流意图）渲染——与聊天页 renderMsg 同构，
    // label 与气泡正文完全相同时只留标签胶囊（与聊天页 dupBody 去重规则一致）
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
  // v3.34.x #246 历史分页：进群只渲最近 RENDER_MAX 条（gcRenderStart=渲染窗口起点），
  // 更早的历史点「查看更早的消息」按块向顶部补渲——此前 RENDER_MAX 只上不下，老消息
  // 存了但界面永远看不到。插入按 scrollHeight 差值回补 scrollTop 保持视口不跳；
  // 贴底跟随与 DOM 窗口裁剪逻辑不变（裁剪跳过分页按钮）
  let gcRenderStart = 0;
  const GC_EARLIER_CHUNK = 150;
  function renderAll() {
    body.innerHTML = '';
    const n = msgs.length;
    gcRenderStart = Math.max(0, n - RENDER_MAX);
    if (gcRenderStart > 0) body.appendChild(gcEarlierBtn());
    for (let i = gcRenderStart; i < n; i++) renderMsg(msgs[i], i);
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
  // v3.16.x：新消息自动跟底——收发消息后调用；用户正回看历史（离底 >150px）时不打扰，
  // 贴底状态下始终跟随（此前只有 renderAll 进页时滚一次，停留页内收发都要手动下滑）
  function nearGcBottom() {
    try { return body.scrollHeight - body.scrollTop - body.clientHeight < 150; } catch (e) { return true; }
  }
  // FIX 群聊跟底 #370（红米 K80 Chrome 等多机型报「联系人发消息不自动滚到最新」）：
  // 单聊 #162 同根因——移动内核可能丢弃一次性 scrollTop 写入，或被迟到的布局变更
  // （头像/图片异步解码撑高）顶开，只写一次=视口停在新消息上方。对齐单聊三连写口径：
  // 即时写 + rAF + 150ms 复写；复写用 gcUserGcScrollTouched（触摸/滚轮置位）判断用户
  // 是否已手动接管滚动，未接管才补写（内核丢弃写入时视口离底 >150px，nearGcBottom
  // 会误判为「在看历史」，所以复写不能只看 nearGcBottom）；用户已滚动则不抢滚动权。
  let gcUserGcScrollTouched = false;
  let gcUnpinTsY = 0;
  // FIX #378：解钉只认「真实滚动意图」——轻点（位移<10px）且仍贴底时解除接管；
  // 拖动/惯性滚动保持接管，滚回贴底由 scroll 监听解除
  body.addEventListener('touchstart', (e) => {
    try { gcUnpinTsY = e.touches[0].clientY; } catch (err) { gcUnpinTsY = 0; }
    gcUserGcScrollTouched = true;
    // FIX 2026-09-13 #396：#316 只给单聊解钉开回了 Chromium 原生滚动锚定，gc-body 共享
    // .chat-body 的 overflow-anchor:none 却从未挂回 scroll-anchor-auto＝图多的群聊历史
    // 上翻时视口上方图片异步解码撑高无人补偿，看的内容被一次次推走＝「滑动屏幕会弹」
    // （红米 K80 Chrome 报障形态，与单聊 #316 同根因）。触摸/滚轮接管期挂类开回锚定，
    // 回钉贴底（followGcBottom/滚回贴底/轻点回跟）摘除——#199 防对打语义不变。
    try { body.classList.add('scroll-anchor-auto'); } catch (err) {}
  }, { passive: true });
  body.addEventListener('touchend', (e) => {
    try {
      const dy = Math.abs(e.changedTouches[0].clientY - gcUnpinTsY);
      if (dy < 10 && nearGcBottom()) { gcUserGcScrollTouched = false; try { body.classList.remove('scroll-anchor-auto'); } catch (err) {} } // FIX #396 轻点回跟=回钉态摘锚定
    } catch (err) {}
  }, { passive: true });
  body.addEventListener('wheel', () => { gcUserGcScrollTouched = true; try { body.classList.add('scroll-anchor-auto'); } catch (err) {} }, { passive: true });
  function followGcBottom(force) {
    try {
      // FIX #378：跟底闸只看「用户是否手动接管滚动」——内核丢弃首写/迟到解码顶开后
      // 视口离底>150px，旧 nearGcBottom 闸会把后续每条来消息都误判成在看历史永不跟底
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
  // FIX #378：用户手动滚回贴底＝解除接管，自动跟底恢复（旧口径解钉后无法恢复）
  body.addEventListener('scroll', () => {
    if (gcUserGcScrollTouched && nearGcBottom()) { gcUserGcScrollTouched = false; try { body.classList.remove('scroll-anchor-auto'); } catch (err) {} } // FIX #396 滚回贴底=回钉态摘锚定
  }, { passive: true });
  // v3.12.x：停留页内实时追加的 DOM 窗口上限——renderAll 只在进页时收窄到 RENDER_MAX，
  // 之后每条收发都走 renderMsg 直接 append，长时间泡在群里 DOM（含每条一个 dataURL 头像
  // img 的位图）无界增长 → 安卓 Chrome 渲染进程 OOM「网页崩溃」。超过窗口硬上限时从最早端
  // 裁剪：仅当用户贴近底部（正在看最新消息）才执行——回看历史时不动视口；贴底状态下浏览器
  // 会把 scrollTop 钳制到新的最大值，视觉仍停在最新一条。重新进群聊页 renderAll 会重渲。
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

  // ---- 发送 ----
  // v3.11.x：待发送图片（插入图片按钮多选 → 压缩 → 草稿条预览，随文字合并为一条组合消息）
  let gcDraftImgs = [];
  // v3.16.x：待引用内容（点气泡→引用 后暂存，随下一条发出的消息带上；{ text, imgs, idx }）
  let gcLastQuote = null;
  // 引用预览条（与聊天页 #chat-draft-quote 同款交互，元素在 template 的输入栏上方）
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
    t.textContent = (thumb && raw.indexOf('data:') === 0) ? '' : (raw || '图片');
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
  // 组合消息：文字 + 插入图片（与聊天页 buildParts 同构；renderMsg 已支持 parts 渲染）
  function buildGcParts(t) {
    const parts = [];
    if (t) parts.push({ k: 'text', v: t });
    gcDraftImgs.forEach(src => parts.push({ k: 'img', v: src, sub: 'image' }));
    return parts;
  }
  // 取走待引用内容（与聊天页 quoteValue 同构：带图 → {t,imgs} 对象，纯文本 → 字符串）
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
    if (window.playSfx) window.playSfx('out');
    if (input) input.textContent = '';
    gcDraftImgs = [];
    renderGcDraft();
    scheduleReply(t);
  }
  // v3.26.x：群聊里使用【帮我决定】/【多人决定】时，结果作为系统消息发到群聊
  // （decision.js / group-decision.js 先判 gcIsVisible()，是群聊上下文就走这里；聊天页上下文仍走 chatAddIn）
  function gcSendDecisionText(text) {
    const t = (text || '').trim();
    if (!t) return;
    const rec = { side: 'in', cid: 'system', name: '系统', text: t, ts: Date.now(), special: 'system' };
    msgs.push(rec);
    saveMsgs();
    renderMsg(rec);
    followGcBottom(true);
    if (window.playSfx) window.playSfx('in');
  }
  function gcIsVisible() {
    const p = document.getElementById('page-group-chat');
    return !!(p && !p.hidden);
  }
  window.gcSendDecisionText = gcSendDecisionText;
  window.gcIsVisible = gcIsVisible;
  // 表情包直接发送（复用聊天页表情包面板的插入模式回调，见下方 gc-emoji-btn）
  function sendGcSticker(src) {
    if (!src) return;
    const rec = { side: 'out', type: 'sticker', text: src, ts: Date.now() };
    const qv = gcTakeQuoteValue();
    if (qv) rec.quote = qv;
    msgs.push(rec);
    saveMsgs();
    renderMsg(rec);
    followGcBottom(true);
    if (window.playSfx) window.playSfx('out');
    // 表情不带文字，无 @提及，成员按概率随机回复
    scheduleReply('');
  }

  // ---- 回复内容生成（从该成员字卡池随机选，兜底数组） ----
  // v3.9.x：群聊回复全部走群聊回复设置（reply-settings.js 的 gc-* 键，全局生效）：
  // 每个联系人回复概率/回复速度/条数/拍一拍/表情包/emoji/图片/语音/颜文字/引用/撤回/多字卡
  function gcCfg() {
    const d = {
      'gc-prob': 60, 'gc-rs-min': 1, 'gc-rs-max': 40,
      'gc-reply-min': 1, 'gc-reply-max': 2,
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
  // v3.28.x：群聊成员回复前取回其字卡池的防卡死封装——hydrateLibForCid 内部串行
  // 取回 公用键 + 该成员专属键，最坏各 14s（idbHydrateKey 6s+8s）共 28s；慢 IDB
  // 手机上群回复被拖住十几秒像卡死。这里最多等 2.5s：取回完成就继续，超时也放行
  //（gcPool 的 For 系列 getter 下次回复仍会再触发取回，配合后台自愈最终用上自定义字卡）。
  function gcHydrateWait(cid) {
    try {
      if (!window.hydrateLibForCid) return Promise.resolve();
      return Promise.race([
        new Promise(function (res) { window.hydrateLibForCid(cid, res); }),
        new Promise(function (res) { setTimeout(res, 2500); })
      ]);
    } catch (e) { return Promise.resolve(); }
  }
  // 该成员的字卡池（按分类）：公用字卡 + 该成员桌面专属字卡 + 默认字卡兜底
  function gcPool(cid) {
    const text = [], kaomoji = [], emoji = [], sticker = [], image = [], voice = [];
    try {
      // 媒体字卡（表情包/图片/语音）——getMediaCardsFor 已合并 公用+该成员桌面专属
      const mediaSticker = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'sticker')) || [];
      const mediaImage = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'image')) || [];
      const mediaVoice = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'voice')) || [];
      sticker.push.apply(sticker, mediaSticker);
      image.push.apply(image, mediaImage);
      voice.push.apply(voice, mediaVoice);
      // v3.12.x：文字/emoji/颜文字改走 For 系列合并视图（公用+专属）。旧实现按
      // {key:{cards:[{type,text}]}} 解析 cc-groups，与实际存储 {类型:[[分组,[卡]]]}
      // 结构不符——专属文字/emoji/颜文字从未真正进过群聊回复池（静默失效）
      const pokeSet = (function () {
        const pk = (window.getPokeCardsFor && window.getPokeCardsFor(cid)) || [];
        return pk.length ? new Set(pk) : null;
      })();
      const cards = (window.getCustomCardsFor && window.getCustomCardsFor(cid)) || [];
      cards.forEach(c => {
        if (typeof c !== 'string' || !c) return;
        if (pokeSet && pokeSet.has(c)) return; // 拍一拍字卡只走拍一拍模式，不进普通回复池
        if (c.indexOf('data:') === 0) return; // 图片已按媒体分类取
        if (c.indexOf('|||') >= 0) return; // 语音已按媒体分类取
        // FIX 2026-09-12 #383 群聊同款：#377 令牌化后裸 @@m:hash 卡体无 |||、非 data:，
        // 旧两道守卫漏过＝令牌卡入群聊文字池被当文字直出（与 chat.js getPool 同批修复）
        if (c && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return;
        if (/[\uD800-\uDBFF]/.test(c) || /^[😀-🙏🌀-🫿]/u.test(c)) emoji.push(c);
        else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) kaomoji.push(c);
        else text.push(c);
      });
    } catch (e) {}
    // 默认字卡兜底——v3.12.x：开关全部按【该成员所在桌面】读（defaultCardApiFor）：
    // 该成员桌面关闭【聊天使用】/总开关/某分类 → 聊天和群聊里这个成员都不用默认字卡；
    // main 混入门对齐聊天页 getPool（开启即始终混入，颜文字/emoji 分类为空才补）
    try {
      const a = (window.defaultCardApiFor && window.storeFor) ? window.defaultCardApiFor(window.storeFor(cid)) : null;
      const dcfg = a ? a.cfg() : (window.defaultCardCfg && window.defaultCardCfg()) || {};
      const useChat = a ? a.use('chat') : (window.defaultCardUse ? window.defaultCardUse('chat') : true);
      const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
      const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
      if (dcfg.enabled !== false && useChat) {
        // v3.26.x #157：主字卡兜底语义对齐聊天页 getPool——只在自定义 text 池为空时并入，
        // 概率混入交给 getDefaultCardsFor（dc-overall）；否则 4600+ 默认卡淹没自定义池
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
  // 生成一条成员回复（多字卡/表情包/emoji/图片/语音/颜文字，同聊天页 genOneReply 语义）
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
// v3.26.x #163：文本回复按成员所在桌面混入默认字卡（同聊天页 genOneReply 的
// getDefaultCards 覆盖语义，dc-overall-chat 概率+分类占比+各开关内部同源生效）——
// 原群聊只有拍一拍走 getDefaultCardsFor，文本回复从不混默认字卡，成员桌面把
// 默认概率调多高都只影响拍一拍
if (type === 'text') {
try {
const st = window.storeFor ? window.storeFor(cid) : null;
const defs = (st && window.getDefaultCardsFor) ? window.getDefaultCardsFor(st) : ((window.getDefaultCards && window.getDefaultCards()) || null);
if (defs && defs.type === 'text' && defs.text) t = defs.text;
} catch (e) {}
}
    // 组合消息：文字 + 表情包/图片 附加到同一条（同聊天页 genOneReply）
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
  // 成员拍一拍文本（该成员视角：成员名 + 字卡，含"你/我"按聊天页规则替换成我的称呼）
  function gcPokeText(cid) {
    const name = memberName(cid);
    let action = '';
    // v3.12.x：默认字卡按【该成员所在桌面】抽（含 聊天使用/总开关/拍一拍分类/单卡开关
    // 与整体概率 roll）——成员桌面关闭聊天使用 → 群聊里这个成员不用默认拍一拍
    try {
      const st = window.storeFor ? window.storeFor(cid) : null;
      const d = (st && window.getDefaultCardsFor) ? window.getDefaultCardsFor(st) : ((window.getDefaultCards && window.getDefaultCards()) || null);
      if (d && d.type === 'poke') action = d.text;
    } catch (e) {}
    if (!action) {
      // 自定义拍一拍：公用 + 该成员桌面专属 合并视图（getPokeCardsFor）
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
  // ---- FIX 串群 #242：成员回复/撤回绑定来源群 ----
  // 定时器在调度时捕获 curGid，落库一律写来源群；来源群仍是当前群才做 DOM 渲染/
  // 音效/打字指示，否则静默写入该群存储（切回可见）。此前 msgs.push/saveMsgs 都在
  // 定时器执行时刻读当前 curGid——发消息后切群，回复会写进新群（串群）且原群永久
  // 丢回复；群已删除则丢弃（同删除群聊「消息一并删除」语义）。
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
  // 投递一条回复到指定群：同群走原路径（渲染+音效），跨群只落存储。返回该消息在
  // 来源群数组中的下标（供撤回定时器定位），失败返回 -1
  function gcDeliverReply(gid, rec, sfx) {
    if (!gcGroupAlive(gid)) return -1;
    if (gid === curGid) {
      msgs.push(rec);
      saveMsgs();
      renderMsg(rec, msgs.length - 1);
      followGcBottom();
      if (sfx && window.playSfx) window.playSfx(sfx);
      return msgs.length - 1;
    }
    try {
      const arr = gcReadGroupKey(gid);
      arr.push(rec);
      gcWriteGroupKey(gid, arr);
      return arr.length - 1;
    } catch (e) { return -1; }
  }
  // FIX 撤回查看 #244：无渲染快照时的安全回退（存量撤回记录/跨群撤回）——
  // 媒体给占位、文本走转义，绝不 innerHTML 直出原始 rec.text
  function gcRetractFallbackHtml(rec) {
    const ph = (t) => '<span style="opacity:.6;font-size:12px">' + t + '</span>';
    if (rec.type === 'image') return ph('[图片]');
    if (rec.type === 'sticker') return ph('[表情包]');
    if (rec.type === 'voice') return ph('[语音]');
    if (rec.parts && rec.parts.length) {
      const imgs = rec.parts.filter(p => p.k === 'img').length;
      const txt = rec.parts.filter(p => p.k === 'text').map(p => p.v).join(' ');
      return (imgs ? ph('[图片]') : '') +
        // FIX 2026-09-13 #394 群聊撤回段文本走内嵌令牌助手（同 #385 单聊撤回段口径）
        (txt ? '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(txt) : escTxtBr(txt)) + '</span>' : '');
    }
    return '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(rec.text || '') : escTxtBr(rec.text || '')) + '</span>';
  }
  // 撤回图片可看 #248：媒体消息的「点击查看」视图即时从记录数据生成缩略图——
  // 图片/表情/含图组合的 src 本就持久化在 rec.text / rec.parts 里，渲染时重拼 img
  // 即可（data: 直显、@@m: 令牌由 media-pool 文档级观察器重写），不需要也不往
  // rec.orig 快照塞 base64（防臃肿语义不变）。无图数据返回空串走快照/占位回退。
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
        // FIX 2026-09-13 #394 群聊撤回媒体段文本内嵌令牌转图
        (txt ? '<span style="opacity:.85;word-break:break-word">' + (window.mochiInlineTextHtml ? window.mochiInlineTextHtml(txt) : escTxtBr(txt)) + '</span>' : '');
    }
    return '';
  }
  // v3.9.x：单条成员消息撤回（标记 + 局部重渲染）
  // FIX 串群 #242：带来源群 gid——不是当前群时落到该群存储，绝不写错群；
  // FIX 撤回查看 #244：撤回前先存渲染快照 rec.orig（同单聊 chat.js retractMsg 语义），
  // 点击查看用快照，不再回退直出原始文本
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
    // 撤回快照防臃肿：媒体类记录（表情/图片/语音/含图组合）与超大快照（引用缩略图
    // 已被观察器展开成 data:）不存 DOM 快照，走 gcRetractFallbackHtml 占位——
    // 否则令牌化省下的空间被快照里的整段 base64 又吃回去
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
  // v3.9.x：成员回复——按群聊回复设置：回复速度/条数/拍一拍/表情包/emoji/图片/语音/
  // 颜文字/引用/撤回（含撤回补发），与聊天页被动回复语义一致
  function memberReply(cid, quoteText, gid) {
    if (gid === undefined) gid = curGid; // FIX 串群 #242：未传时兜底当前群
    const c = gcCfg();
    const name = memberName(cid);
    const rsMin = Math.max(1, Number(c['gc-rs-min']) || 1);
    const rsMax = Math.max(rsMin, Number(c['gc-rs-max']) || rsMin);
    const delay = (rsMin + Math.random() * Math.max(1, rsMax - rsMin)) * 1000;
    if (gid === curGid) showTyping(name);
    setTimeout(() => {
      if (gid === curGid) hideTyping();
      // 拍一拍分支（同聊天页：命中则不回文字，直接拍）
      if (hit(c['gc-touch-prob'])) {
        const rec = { side: 'in', cid: cid, name: name, text: gcPokeText(cid), special: 'poke', ts: Date.now() };
        gcDeliverReply(gid, rec, 'in'); // FIX 串群 #242：落回来源群
        return;
      }
      // 回复条数（min/max 调反时兜底至少 1 条）
      const rpMin = Math.max(1, Number(c['gc-reply-min']) || 1);
      const rpMax = Math.max(rpMin, Number(c['gc-reply-max']) || 2);
      // #167 同单聊：gc-py-en 是总开关，关闭时每个成员每条只回一条
      const count = (c['gc-py-en'] === 1) ? randInt(rpMin, rpMax) : 1;
      // 本轮整体掷一次引用（只给第一条带引用，防多条连续引用同一句）
      const wantQuote = hit(c['gc-quote-prob']) && !!quoteText;
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          if (gid === curGid) hideTyping();
          (async () => {
          // v3.27.x：生成前先确保该成员字卡池就绪——成员桌面大键可能被启动回填
          // 挂起，同步读池是空库会让成员一直发 FALLBACK_REPLIES 兜底（上限 2.5s）
          try { await gcHydrateWait(cid); } catch (e) {}
          const rep = gcGenReply(cid, c);
          const q = (wantQuote && i === 0) ? quoteText : null;
          const rec = { side: 'in', cid: cid, name: name, text: rep.text, type: rep.type, parts: rep.parts, ts: Date.now() };
          if (q) rec.quote = q;
          // v3.16.x：心意字卡链（情绪→心意→交流意图）——与聊天页 replyOnce 同源同链
          //（triggerEmotionChain 内部自带总开关/单卡开关/概率与冷却），文本/表情/图片消息可挂
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
          // 撤回 + 撤回补发
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
            }, 900);
          }
          })();
        }, i * randInt(1200, 2800));
      }
    }, delay);
  }
  // v3.9.x：@ 的成员必定回复；其余成员按「每个联系人回复概率」独立掷骰，命中才回
  function scheduleReply(userText) {
    const gid = curGid; // FIX 串群 #242：捕获调度时的群，回复/撤回一律落回发起群
    const members = getMembers();
    if (!members.length) return;
    const c = gcCfg();
    // 检测 @提及
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
    // 各成员独立排期回复（成员间错开更自然）
    targets.forEach((cid, i) => {
      setTimeout(() => memberReply(cid, userText, gid), i * (1200 + Math.random() * 1600));
    });
  }

  // ---- 进入/退出 ----
  function updateGroupName() {
    const g = currentGroup();
    const n = getMembers().length;
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
    renderAll();
    gcSwitchDirty = false; // FIX #249：进群即全量重建（loadMsgs+renderAll），切桌挂起的脏标记就地清账
    hideTyping(); // FIX 串群 #242 家族：打字指示器全局共享，进群清掉其他群残留
    syncGcInputBtns(); // 进入群聊时按当前桌面设置刷新语音/继续说/批量按钮显隐
  }
  if (backBtn) backBtn.addEventListener('click', () => {
    saveNow();
    document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #338 同值写也发 mutation（Blink 实测同值 3 连写=3 条记录），44 页全扫=唤醒全部页面观察器
    const home = document.getElementById('page-phone'); if (home) home.hidden = false;
  });

  // ---- 群聊按钮点击 ----
  const gcApp = document.querySelector('.app[data-app="group-chat"]');
  if (gcApp) gcApp.addEventListener('click', enterGroupChat);

  // ---- 发送按钮 ----
  // v3.30.x：点发送不收输入法（同单聊 chat.js，FIX-REGRESSION #127）——mousedown preventDefault 防焦点被按钮抢走
  if (sendBtn) {
    sendBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    sendBtn.addEventListener('click', () => { addMsg(input.innerText); try { input.focus(); } catch (e) {} });
  }
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      // 对齐聊天设置「回车键发送消息」开关（cs-enter-send：'off' = 回车换行不发送，
      // 与 chat.js 同一语义同一键）；contenteditable 换行由浏览器默认行为完成
      try { if (window.activeStore().get('cs-enter-send') === 'off') return; } catch (err) {}
      e.preventDefault();
      addMsg(input.innerText);
    }
  });

  // ---- 成员列表面板 ----
  function renderMembersPanel() {
    if (!membersBody) return;
    membersBody.innerHTML = '';
    // v3.26.x：自定义群可移除成员 / 添加成员；default 群成员动态跟随全部联系人，不提供
    const isCustom = curGid !== 'default';
    const meRow = document.createElement('div');
    meRow.className = 'gc-mp-item';
    // v3.9.x：显示群聊昵称（主）+ 桌面原昵称（副，区分用）
    const meDesk = deskMeName();
    meRow.innerHTML = '<div class="gc-mp-av"></div><span class="gc-mp-name">' + escapeHtml(myName()) +
      '<span class="gc-mp-sub">' + (meDesk ? '桌面昵称：' + escapeHtml(meDesk) : '') + '</span></span><span class="gc-mp-tag">我</span>';
    fillAv(meRow.querySelector('.gc-mp-av'), myAvatar());
    membersBody.appendChild(meRow);
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
      membersBody.appendChild(row);
    });
    if (isCustom) {
      const addRow = document.createElement('div');
      addRow.className = 'gc-mp-add';
      addRow.innerHTML = '<button class="gc-set-btn">＋ 添加成员</button>';
      addRow.querySelector('button').addEventListener('click', () => { openMemberPicker('add'); });
      membersBody.appendChild(addRow);
    }
  }
  // 移除成员（自定义群）：确认后从该群 members 剔除，成员不再参与本群回复/@
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
  // 点击群名标题 → 打开群聊列表面板（切换 / 新建 / 删除群聊；群成员入口在三点菜单）
  if (nameEl) nameEl.addEventListener('click', () => { renderGroupsPanel(); if (groupsPanel) groupsPanel.hidden = false; });
  if (membersClose) membersClose.addEventListener('click', () => { if (membersPanel) membersPanel.hidden = true; });

  // ---- 群聊列表面板（v3.26.x：切换 / 新建 / 删除群聊） ----
  function renderGroupsPanel() {
    if (!gpBody) return;
    gpBody.innerHTML = '';
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
          '<span class="gc-mp-sub">成员 ' + n + ' 人' + (g.id === 'default' ? ' · 全部联系人' : '') + '</span></span>' +
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
      gpBody.appendChild(row);
    });
    // 新建群聊
    const newRow = document.createElement('div');
    newRow.className = 'gc-mp-item gc-gp-new';
    newRow.innerHTML = '<div class="gc-mp-av gc-gp-ico add">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      '</div><span class="gc-mp-name">新建群聊</span>';
    newRow.addEventListener('click', startCreateGroup);
    gpBody.appendChild(newRow);
  }
  // 切换群聊：落盘当前群 → 换群 id → 载入该群消息并重渲染
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
  // 删除群聊：先确认，再删分组 + 该群消息键；若删的是当前群则回退 default
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
  // 新建群聊第一步：输入群名（可留空，自动命名），再选成员
  function startCreateGroup() {
    if (!window.openModal) return;
    window.openModal('群聊名称', '', (v) => {
      const name = String(v || '').trim() || ('群聊 ' + groups.length);
      openMemberPicker('create', name);
    }, { placeholder: '群聊名称（可留空）', maxlength: 20 });
  }

  // ---- 成员选择面板（新建群聊 / 给当前群加人 复用） ----
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
    // 新建群聊：列全部联系人；添加成员：列未在【当前群】内的联系人
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
  // 成员选择确认：新建群聊（至少 1 人）或 添加成员到当前群
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

  // ---- 右上角三点菜单（v3.9.x：群成员 + 群聊设置） ----
  const moreBtn = document.getElementById('gc-more-btn');
  const moreMenu = document.getElementById('gc-more-menu');
  function showMoreMenu(v) { if (moreMenu) moreMenu.hidden = !v; }
  if (moreBtn) moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showMoreMenu(moreMenu.hidden);
  });
  document.addEventListener('click', () => showMoreMenu(false));
  const moreMembers = document.getElementById('gc-more-members');
  if (moreMembers) moreMembers.addEventListener('click', () => {
    showMoreMenu(false);
    renderMembersPanel();
    if (membersPanel) membersPanel.hidden = false;
  });
  const moreSettings = document.getElementById('gc-more-settings');
  if (moreSettings) moreSettings.addEventListener('click', () => {
    showMoreMenu(false);
    renderSettingsPanel();
    if (settingsPanel) settingsPanel.hidden = false;
  });
  // v3.26.x：三点菜单「切换群聊」→ 打开群聊列表面板（新建 / 切换 / 删除）
  const moreGroups = document.getElementById('gc-more-groups');
  if (moreGroups) moreGroups.addEventListener('click', () => {
    showMoreMenu(false);
    renderGroupsPanel();
    if (groupsPanel) groupsPanel.hidden = false;
  });

  // ---- 群聊设置面板（v3.9.x：我的群聊形象 + 成员群聊形象） ----
  const settingsPanel = document.getElementById('gc-settings-panel');
  const settingsBody = document.getElementById('gc-set-body');
  const settingsClose = document.getElementById('gc-set-close');
  // 轻提示（与全站一致）
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
  // 头像压缩（与聊天设置一致：最长边 256、JPEG 0.85）
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
  function pickAvatarFile(cb) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        compressHead(reader.result, 256).then(data => {
          if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
          cb(data);
        });
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }
  // 渲染设置面板：主视图（我的群聊 + 成员群聊形象 + 美化入口） / 美化视图（同聊天设置的美化行）
  let gcBeautyView = false;
  function setPanelTitle(t) {
    try {
      const h = settingsPanel && settingsPanel.querySelector('.gc-set-head span');
      if (h) h.textContent = t || '群聊设置';
    } catch (e) {}
  }
  function renderSettingsPanel() {
    if (!settingsBody) return;
    // 美化视图铺满整屏（用户反馈半屏弹层不够看）；返回主视图还原底部弹层形态
    if (settingsPanel) settingsPanel.classList.toggle('gc-set-fs', gcBeautyView);
    settingsBody.innerHTML = '';
    if (gcBeautyView) { setPanelTitle('美化聊天'); renderBeautyView(); return; }
    setPanelTitle('群聊设置');
    renderMainSettingsView();
  }
  function renderMainSettingsView() {
    const esc = escapeHtml;
    // v3.28.x：群聊回复 stepper（读/写 reply-settings.js 的 gc-* 全局键，生效于全部联系人）
    // 复用全站 .stepper/.stp-* 样式与交互语义（与回复设置页一致），作用于群聊设置面板内
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
      // 预览：群聊当前生效头像（覆盖优先，回退桌面头像）
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
    // —— 我的群聊 ——
    const t1 = document.createElement('div');
    t1.className = 'gc-set-title';
    t1.textContent = '我的群聊';
    settingsBody.appendChild(t1);
    const meP = gcProfileGet('me');
    settingsBody.appendChild(item('me', meP.name || '', meP.avatar || '', deskMeName()));
    // —— 成员群聊形象 ——
    const t2 = document.createElement('div');
    t2.className = 'gc-set-title';
    t2.textContent = '成员群聊形象';
    settingsBody.appendChild(t2);
    getMembers().forEach(m => {
      const p = gcProfileGet(m.id);
      settingsBody.appendChild(item(m.id, p.name || '', p.avatar || '', deskPartnerName(m.id)));
    });
    // —— 成员昵称显示（v3.16.x：是否在消息头像上方显示群聊昵称） ——
    const nmRow = beautyRow('成员昵称显示', gcBeautyGet('show-name') === 'on' ? '头像上方显示' : '不显示', () => {
      pickGcPills('show-name', '成员昵称显示', [
        { label: '头像上方显示', value: 'on' }, { label: '不显示', value: 'off' }
      ], 'off');
    });
    settingsBody.appendChild(nmRow);
    // —— 群聊回复（v3.28.x：全局生效于全部联系人，与回复设置页） ——
    const tR = document.createElement('div');
    tR.className = 'gc-set-title';
    tR.textContent = '群聊回复';
    settingsBody.appendChild(tR);
    settingsBody.appendChild(gcStepperRow('每个联系人回复概率 %', 'gc-prob', 0, 100, 5));
    settingsBody.appendChild(gcStepperRow('回复速度最短（秒）', 'gc-rs-min', 1, 60, 1));
    settingsBody.appendChild(gcStepperRow('回复速度最长（秒）', 'gc-rs-max', 2, Infinity, 1));
    const rNote = document.createElement('div');
    rNote.className = 'gc-set-note';
    rNote.textContent = '这里的回复概率与速度对所有群聊成员统一生效（全局）；完整的每项概率/条数/开关在「设置 → 回复设置 → 群聊被动回复」里调整。';
    settingsBody.appendChild(rNote);
    // —— 输入与消息（对齐聊天设置「功能」页镜像开关：群聊页内可直接改这些状态） ——
    const tIn = document.createElement('div');
    tIn.className = 'gc-set-title';
    tIn.textContent = '输入与消息';
    settingsBody.appendChild(tIn);
    // 开关行（label + toggle，复用全站 .toggle 样式；存全局根命名空间键）
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
    // 回车键发送消息（与 chat.js 同一键 cs-enter-send，'off'=不发送；默认开）
    settingsBody.appendChild(gcToggleRow('回车键发送消息', '关闭后按回车键换行，不再直接发送', 'cs-enter-send', null));
    // 批量发送消息（群聊输入栏右侧「批量发送」按钮显隐即读 cs-batch-send）
    settingsBody.appendChild(gcToggleRow('批量发送消息', '输入栏右侧显示「批量发送」按钮，可插入表情包/图片/文字批量发送', 'cs-batch-send',
      () => syncGcInputBtns()));
    // 我可发送语音（群聊输入栏左侧「麦克风」按钮显隐即读 cs-voice-send）
    settingsBody.appendChild(gcToggleRow('我可发送语音', '输入栏左侧显示「麦克风」按钮，可录音并发送语音', 'cs-voice-send',
      () => syncGcInputBtns()));
    // 隐藏联系人的表情包（全局键 hide-ta-sticker，表情包面板每次打开时读）
    settingsBody.appendChild(gcToggleRow('隐藏联系人的表情包', '表情包面板只显示「我的表情包」', 'hide-ta-sticker',
      (en) => { try { document.dispatchEvent(new Event('hide-ta-sticker-changed')); } catch (e) {} toast(en ? '已隐藏：表情包面板只显示「我的表情包」' : '已恢复显示 TA 的和公用表情包'); }));
    // 允许删除成员消息（气泡操作菜单出现「删除」，真删除不可恢复）
    settingsBody.appendChild(gcToggleRow('允许删除成员消息', '点击成员消息气泡可在操作菜单里删除该条消息', 'cs-del-ta-msg',
      (en) => toast(en ? '已开启：点击成员消息可在操作菜单里删除该条消息' : '已关闭删除成员消息功能')));
    // —— 群聊数据（对齐聊天设置「数据」页：导出/导入/清空当前群记录） ——
    const tD = document.createElement('div');
    tD.className = 'gc-set-title';
    tD.textContent = '数据';
    settingsBody.appendChild(tD);
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
    // 导出：与单聊同格式 JSON（流式构建防超长），文件名带群名
    settingsBody.appendChild(gcDataLink('导出聊天记录', '当前群聊全部消息导出为 JSON 文件', false, () => {
      try {
        gFlushPersistNow();
        const n = msgs.length;
        if (!n) { toast('没有聊天记录可导出'); return; }
        toast('正在导出，请稍候…');
        // FIX 2026-09-12 #375 导出前展开媒体池令牌：#245 令牌化后消息里图片/表情存的是
        // @@m:hash，原样导出＝JSON 只有令牌没有图，导入到他机或清数据后的本机全部坏图。
        // 深扫 text/parts/quote 收集令牌 → 异步取回 dataURL → 按原位替换后流式写出
        //（保留原分段流式构建防超长；取不回的令牌原样保留不阻塞导出，8s 兜底放行）
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
          // FIX 2026-09-12 #375 文件名两处修正：群名清洗非法字符（\/:*?"<>| → _，防下载
          // 失败/被系统改名）；日期改本地时区（toISOString 是 UTC，凌晨导出文件名日期
          // 会是前一天——同 chat-settings #172 已修的同族问题，这里补齐）
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
    // 导入：读取 JSON → 预览确认 → 覆盖当前群记录（兼容单聊导出/裸数组/整份备份）
    settingsBody.appendChild(gcDataLink('导入聊天记录', '从 JSON 文件导入并覆盖当前群聊记录', false, () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          let data;
          try { data = JSON.parse(String(reader.result || '')); } catch (e) { toast('无效的聊天记录文件'); return; }
          if (!data || typeof data !== 'object') { toast('无效的聊天记录文件'); return; }
          // 兼容：群聊/单聊导出 {app,msgs} / 裸数组 / 整份 mochi 备份（聊天记录或默认群键）
          let arr = Array.isArray(data) ? data : null;
          if (!arr && data.msgs && Array.isArray(data.msgs)) arr = data.msgs;
          if (!arr && data.ls && typeof data.ls === 'object') {
            // FIX 2026-09-12 #374 整份备份兜底先取当前群自己的消息键：原实现只认默认群键
            //（xy-home-v2:group-chat-msgs），在自定义群里导入整份备份＝把默认群消息灌进
            // 自定义群并覆盖其原记录（串群）；自定义群消息键为 gc-msgs-<gid>。
            // 优先级＝同键跨段先比完（IDB 权威值优先 LS，与备份路由一致：≤20KB 小键进
            // ls 段、大键进 idb 段），当前群键两个段都没有再回落默认群键
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
      };
      inp.click();
    }));
    // 清空当前群记录（危险操作二次确认；自定义群连消息键一并清）
    settingsBody.appendChild(gcDataLink('删除全部聊天记录', '清空「' + curGroupName + '」的全部消息（不可恢复）', true, () => {
      if (!window.openModal) return;
      window.openModal('确认删除「' + curGroupName + '」的全部聊天记录？（不可恢复）', '', () => {
        msgs = [];
        saveNow();
        renderAll();
        toast('聊天记录已清空');
      }, { noInput: true });
    }));
    // —— 美化聊天入口（v3.9.x） ——
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
    bRow.addEventListener('click', () => { gcBeautyView = true; renderSettingsPanel(); });
    settingsBody.appendChild(bRow);
    // —— 底部说明 ——
    const note = document.createElement('div');
    note.className = 'gc-set-note';
    note.textContent = '成员回复内容来自：公用字卡 + 该成员桌面专属字卡 + 系统默认字卡；某成员桌面关闭【聊天使用】，聊天和群聊里这个成员都不再使用系统默认字卡。';
    settingsBody.appendChild(note);
  }

  // 主设置视图行（成员昵称显示等）：纯文字行，与美化视图的 set-row 图标行分开
  function beautyRow(label, val, fn) {
    const row = document.createElement('div');
    row.className = 'gc-set-row';
    row.innerHTML = '<span class="txt">' + escapeHtml(label) + '</span><span class="val">' + escapeHtml(val) + '</span><span class="chev">›</span>';
    row.addEventListener('click', fn);
    return row;
  }
  // ================= 美化视图（#288 重设计：对齐聊天设置页观感——gs-title 分组标题 +
  // set-group.glass 玻璃卡片 + set-row 图标行，样式类全站通用/暗色随变量适配；
  // 行类保留 gc-set-row、.txt 仅放行名，供 verify-gc-color / verify-gc-settings 按文本点行） =================
  function renderBeautyView() {
    const g = gcBeautyGet;
    // 返回主设置
    const back = document.createElement('div');
    back.className = 'gc-set-back';
    back.innerHTML = '<span class="arr">‹</span> 返回群聊设置';
    back.addEventListener('click', () => { gcBeautyView = false; renderSettingsPanel(); });
    settingsBody.appendChild(back);
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
      settingsBody.appendChild(ttl);
      curGroup = document.createElement('div');
      curGroup.className = 'set-group glass';
      settingsBody.appendChild(curGroup);
    };
    const add = (label, val, fn, ico) => {
      const row = document.createElement('div');
      row.className = 'set-row gc-set-row';
      row.innerHTML = '<div class="ico">' + (ico || '') + '</div><span class="txt">' + escapeHtml(label) + '</span><span class="val">' + escapeHtml(val) + '</span>';
      row.addEventListener('click', fn);
      (curGroup || settingsBody).appendChild(row);
      return row;
    };
    const bgLabel = (v, def) => v === def ? '默认 ' + def : v;
    // —— 壁纸 ——
    gtitle('壁纸');
    add('聊天壁纸', g('bg') ? '已设置' : '未设置', () => pickGcWallpaper(), ICO.bg);
    if (g('bg')) add('清空群聊壁纸', '', () => { gcBeautySet('bg', ''); toast('已恢复默认壁纸'); }, ICO.trash);
    // —— 气泡与文字 ——
    gtitle('气泡与文字');
    add('我的气泡颜色', bgLabel(g('out-bg'), '#111111'), () => pickGcColor('out-bg', '我的气泡颜色', GC_BUBBLE_BG), ICO.palette);
    add('我的消息文字颜色', bgLabel(g('out-ink'), '#ffffff'), () => pickGcColor('out-ink', '我的消息文字颜色', gcInkSwatches()), ICO.ink);
    add('联系人气泡颜色', bgLabel(g('in-bg'), '#ffffff'), () => pickGcColor('in-bg', '联系人气泡颜色', GC_BUBBLE_BG), ICO.palette);
    add('联系人消息文字颜色', bgLabel(g('in-ink'), '#111111'), () => pickGcColor('in-ink', '联系人消息文字颜色', gcInkSwatches()), ICO.ink);
    // —— 发送按钮 ——
    gtitle('发送按钮');
    add('发送按钮显示/隐藏', g('send-show') === 'hide' ? '隐藏' : '显示', () => pickGcPills('send-show', '显示发送按钮', [
      { label: '显示', value: 'show' }, { label: '隐藏', value: 'hide' }
    ], 'show'), ICO.eye);
    add('发送按钮颜色', bgLabel(g('send-bg'), '#111111'), () => pickGcColor('send-bg', '发送按钮颜色', GC_SEND_BG), ICO.sendbar);
    add('发送文字颜色', bgLabel(g('send-ink'), '#ffffff'), () => pickGcColor('send-ink', '发送文字颜色', GC_INK_COLORS), ICO.ink);
    // —— 气泡外观 ——
    gtitle('气泡外观');
    add('聊天气泡字体大小', (GC_FONT_SIZES.find(p => p.value === g('font-size')) || {}).label || g('font-size'), () => pickGcPills('font-size', '聊天气泡字体大小', GC_FONT_SIZES, '14px'), ICO.fontsize);
    add('聊天气泡框大小', (GC_BUBBLE_SIZES.find(p => p.value === g('bubble-size')) || { label: '自定义' }).label, () => pickGcBubbleSize(), ICO.bubble);
    add('聊天头像形状', g('av-shape') === 'square' ? '方形' : '圆形', () => pickGcPills('av-shape', '聊天头像形状', [
      { label: '圆形', value: 'circle' }, { label: '方形', value: 'square' }
    ], 'circle'), ICO.avatar);
    add('时间轴样式', (GC_BEAUTY_STYLES.find(s => s.value === g('time-style')) || {}).label || '头像下方', () => pickGcPills('time-style', '时间轴样式', GC_BEAUTY_STYLES, 'under-av'), ICO.clock);
    // v3.28.x：对齐聊天美化——气泡边缘圆角 / 时间轴颜色 / 正在输入颜色
    add('气泡边缘圆角', (GC_BUBBLE_RADII.find(p => p.value === g('bubble-radius')) || {}).label || (g('bubble-radius') === '0px' ? '方形' : g('bubble-radius')), () => pickGcBubbleRadius(), ICO.radius);
    add('时间轴颜色', '默认 ' + g('time-ink'), () => pickGcColor('time-ink', '时间轴颜色', GC_INK_COLORS), ICO.drop);
    add('正在输入颜色', '默认 ' + g('typing-ink'), () => pickGcColor('typing-ink', '正在输入颜色', GC_INK_COLORS), ICO.typing);
    // —— 字体与样式 ——
    gtitle('字体与样式');
    add('群聊字体', g('font') ? (g('font').indexOf('data:') === 0 ? '已上传' : g('font')) : '默认', () => pickGcFont(), ICO.font);
    add('气泡 CSS', g('css') ? '已设置' : '默认', () => pickGcCss(), ICO.css);
    // —— 美化方案（v3.28.x：对齐聊天美化的保存/应用/导出/导入） ——
    gtitle('美化方案');
    add('保存当前为美化方案', '', () => window.saveGcBeautyScheme(), ICO.save);
    add('美化方案管理', '(保存/应用/改名/删除/导出/导入)', () => window.openGcBeautySchemes(), ICO.list);
  }
  // 文字颜色色板里「默认黑」易被误认为默认选项（文字色默认其实是白色），
  // 在群聊美化里把第一格改标「黑色」，避免用户选成黑字黑底看不见
  function gcInkSwatches() {
    return GC_INK_COLORS.map(s => s.color === '#111111' ? { color: '#111111', label: '黑色' } : s);
  }
  function pickGcColor(key, title, swatches) {
    if (!window.openModal) return;
    const cur = gcBeautyGet(key);
    window.openModal(title, '', (v) => {
      const color = (typeof v === 'number' && swatches[v]) ? swatches[v].color : v;
      if (!color) return;
      // FIX 2026-09-07 #223 群聊颜色一改就恢复：原对比度保护在选色后立即回滚——粉/浅色
      // 气泡配默认白字、深色文字配默认黑底，全部对比度 < 2.2 被拒，用户怎么选都会弹回
      // 旧色（多机型用户报障，与机型无关）。2026-09-11 用户要求彻底去掉对比度干预：
      // 不回滚、不警告、不自愈强制换色，所选颜色即最终生效。
      gcBeautySet(key, color);
    }, { colorPicker: true, color: cur, swatches: swatches });
  }
  function pickGcPills(key, title, pills, def) {
    if (!window.openModal) return;
    window.openModal(title, '', (v) => { if (v) gcBeautySet(key, v); }, {
      pills: pills, pill: gcBeautyGet(key) || def, noInput: true
    });
  }
  // 群聊壁纸上传（同聊天设置：按物理像素上限压缩）
  function pickGcWallpaper() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
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
      reader.readAsDataURL(f);
    };
    input.click();
  }
  // 气泡框大小（openTCPanel 预设 + 自定义，同聊天设置）
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
      // 规范化：数字+px 或 纯数字（默认px），已带 px 的 token 不动
      v = String(v).split(/[,\s]+/).filter(Boolean).map(function (tok) {
        return /^-?\d+(?:\.\d+)?px$/.test(tok) ? tok : tok.replace(/^(-?\d+(?:\.\d+)?)$/, '$1px');
      }).join(' ');
      gcBeautySet('bubble-size', v);
      document.getElementById('tc-mask').hidden = true;
      toast('气泡框大小已应用');
    });
  }
  // v3.28.x：聊天气泡边缘（四角圆角大小）——滑块自由调节 + 预设胶囊，实时预览（对齐聊天美化）
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
  // 群聊字体（上传 / 名字，作用域仅群聊页）
  function pickGcFont() {
    if (!window.openTCPanel) return;
    const cur = gcBeautyGet('font');
    window.openTCPanel('群聊字体', '' +
      '<div class="sm-fld"><label>上传本地字体（ttf / otf / woff / woff2），只对群聊页生效</label>' +
      '<input class="tc-input" id="gc-font-name" placeholder="也可直接输入字体名，如 Microsoft YaHei"' + (cur && cur.indexOf('data:') !== 0 && cur.indexOf('http') !== 0 ? ' value="' + String(cur).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"' : '') + '></div>' +
      '<div class="mail-actions"><button class="cc-tool" id="gc-font-upload">上传字体</button><button class="cc-tool" id="gc-font-clear">恢复默认</button><button class="cc-tool" id="gc-font-ok">应用</button></div>');
    document.getElementById('gc-font-upload').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.ttf,.otf,.woff,.woff2';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        toast('正在读取字体文件…');
        const reader = new FileReader();
        reader.onload = () => {
          gcBeautySet('font', reader.result);
          document.getElementById('tc-mask').hidden = true;
          toast('字体已应用（群聊页）');
        };
        reader.onerror = () => { toast('字体文件读取失败，请重试'); };
        reader.readAsDataURL(f);
      };
      inp.click();
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
  // 气泡 CSS（openTCPanel 文本框，作用域自动加 #page-group-chat）
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
      // v3.14.x：安卓 ce-box 读空兜底（同 chat-settings cssReadVal，防存空串丢样式）
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

  // ================= 群聊美化方案（v3.28.x：保存/应用/改名/删除/导出/导入） =================
  // 与聊天美化方案同语义，键为 gc-beauty 的各子键，存储于全局命名空间（所有桌面通用）
  const GC_SCHEMES_KEY = 'gc-beauty-schemes';
  const GC_BEAUTY_KEYS = [
    'bg', 'css', 'font', 'font-size', 'bubble-size', 'bubble-radius',
    'av-shape', 'time-style', 'time-ink', 'typing-ink',
    'out-bg', 'out-ink', 'in-bg', 'in-ink', 'send-bg', 'send-ink', 'send-show'
  ];
  const gcSchemesStore = () => { try { return gcProfileStore(); } catch (e) { return null; } };
  const getGcSchemes = () => {
    try { const s = gcSchemesStore(); const a = JSON.parse((s && s.get(GC_SCHEMES_KEY)) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  };
  const saveGcSchemesList = (arr) => { try { const s = gcSchemesStore(); if (s) s.set(GC_SCHEMES_KEY, JSON.stringify(arr)); } catch (e) {} };
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
      // FIX 2026-09-12 #373 应用方案改为真覆盖：方案数据里没有的键（壁纸/字体/CSS 等
      // 默认空值键）先清回默认再应用——原实现只合并不清理，旧壁纸/旧字体残留，
      // 与弹窗「将覆盖全部联系人桌面的群聊美化设置」的承诺不符
      GC_BEAUTY_KEYS.forEach(k => { if (!(s.data && s.data[k] !== undefined)) { try { gcBeautySet(k, ''); } catch (e) {} } });
      applyGcBeautyData(s.data || {});
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
  // 方案缩略图（与聊天美化同款迷你气泡预览）
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
      list.push({ name, time: Date.now(), data });
      saveGcSchemesList(list);
      x.style.display = 'none'; x.hidden = true;
      toast('已保存方案「' + name + '」，所有桌面通用');
      const m = document.getElementById('gc-beauty-scheme-manager');
      if (m && !m.hidden) window.openGcBeautySchemes();
    });
    act.appendChild(cancel); act.appendChild(ok);
    wrap.appendChild(hd); wrap.appendChild(pv); wrap.appendChild(sub); wrap.appendChild(sum); wrap.appendChild(inp); wrap.appendChild(act);
    x.appendChild(wrap);
    x.style.display = 'flex'; x.hidden = false;
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
  };
  // 群聊方案预览——暂存当前群聊美化 → 应用所选方案（即时生效，可还原）
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
    // FIX 2026-09-12 #373 预览备份改全量快照（未设键存 ''）：collectGcBeauty 会漏掉
    // 当前为空值的 bg/font/css——预览带壁纸/字体/CSS 的方案后点「还原」，这三类残留
    // 不退（还原只覆盖备份里存在的键）。全量快照 + applyGcBeautyData（'' 值=删键回
    // 默认）可精确还原到预览前原状；存原始存储值（非主题回显值），深浅主题下都对
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
    head.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:4px">群聊美化方案</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">方案在所有联系人桌面通用（含气泡颜色/CSS、背景图、字体、圆角、时间轴等），点「应用」一键切换群聊外观</div>';
    box.appendChild(head);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;flex:1;min-height:0';
    const schemes = getGcSchemes();
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
  // FIX 2026-09-12 #376 关闭面板时复位美化子视图：在「美化聊天」子视图里关掉面板后
  // 重开，原实现直接落在美化视图而非群聊设置主页（gcBeautyView 残留未复位）
  if (settingsClose) settingsClose.addEventListener('click', () => { gcBeautyView = false; if (settingsPanel) settingsPanel.hidden = true; });
  if (settingsPanel) settingsPanel.addEventListener('click', (e) => { if (e.target === settingsPanel) { gcBeautyView = false; settingsPanel.hidden = true; } });

  // ---- @提及面板 ----
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

  // ---- v3.16.x：输入栏与聊天页对齐的左侧/右侧功能按钮 ----
  // 显隐跟随当前桌面聊天设置（与聊天页 syncMicBtn/syncBatchBtn/applyContinueSayUI 同源）
  function gcSettingOn(key) {
    try { return window.activeStore().get(key) === '1'; } catch (e) { return false; }
  }
  // 群聊设置面板「输入与消息」开关组读写：
  // · hide-ta-sticker 是全局根命名空间键（xy-home-v2:hide-ta-sticker，聊天/朋友圈共用，
  //   contacts.js EXCLUDE 排除迁移）——必须走 xyStore(G)；
  // · cs-enter-send / cs-batch-send / cs-voice-send / cs-del-ta-msg 是每联系人键，
  //   群聊页/表情包面板与聊天页共享这些状态源——走当前桌面命名空间（与
  //   syncGcInputBtns、chat.js 读取同一处），切桌面后重开面板即显示该桌面值。
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
    if (gcContinueBtn) gcContinueBtn.style.display = gcSettingOn('cs-trigger-bar') ? '' : 'none';
    if (gcBatchBtn) gcBatchBtn.style.display = gcSettingOn('cs-batch-send') ? '' : 'none';
  }
  // 「继续说」：和聊天页 continueChat 同语义——强制让成员回复（无 @ 时随机 1-2 个，不按回复概率过滤）
  function gcContinueSay() {
    const gid = curGid; // FIX 串群 #242：同 scheduleReply 绑定来源群
    const members = getMembers();
    if (!members.length) return;
    const mentioned = [];
    if (input) {
      const t = (input.innerText || '').trim();
      members.forEach(m => { if (t.indexOf('@' + memberName(m.id)) >= 0) mentioned.push(m.id); });
    }
    const chosen = mentioned.length
      ? mentioned.slice()
      : members.slice(0, Math.max(1, Math.min(2, members.length))).map(m => m.id);
    chosen.forEach((cid, i) => {
      setTimeout(() => memberReply(cid, '', gid), i * (1200 + Math.random() * 1600));
    });
    if (window.playSfx) window.playSfx('in');
  }
  // 语音：复用聊天页录音半框，录完发到群聊
  function gcSendVoice(dataUrl, durSec) {
    const name = '语音 ' + durSec + '″';
    const rec = { side: 'out', text: name + '|||' + dataUrl, type: 'voice', ts: Date.now() };
    msgs.push(rec);
    saveMsgs();
    renderMsg(rec, msgs.length - 1);
    followGcBottom(true);
    if (window.playSfx) window.playSfx('out');
    scheduleReply('');
  }
  // 批量发送：复用聊天页批量面板，条目发到群聊（文字/图片/表情各成一条）
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
    if (window.playSfx) window.playSfx('out');
    scheduleReply('');
  }
  // #152：与聊天页 chat-continue-btn 同款防吞——安卓键盘收起叠着手势时输入栏位移，
  // 合成 click 二次命中测试落错元素（无报错无回复）；触摸 pointerdown 按下即触发 +
  // 1.2s 防重入挡合成 click 双触发；鼠标仍走 click。stopPropagation 语义保持原样
  //（点按钮不让 document 级外点关闭逻辑收面板）。
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
  // 切换桌面后（群聊成员/设置可能变化）刷新按钮显隐
  document.addEventListener('contact-switched', syncGcInputBtns);

  // ---- 输入栏「更多功能」面板：群聊打开共享面板 #chat-more-panel（与聊天页同款交互）----
  // @群成员 顶部栏仅在群聊打开面板时显示；面板里的功能按钮是聊天页的（handler 在 chat.js），
  // 群聊里点击任功能按钮 → 自动切到聊天页并打开对应功能（双人互动功能在聊天页使用）
  function gcSetMoreTopbar(show) {
    if (gcMoreAt) gcMoreAt.hidden = !show;
  }
  if (gcMoreBtn && gcMorePanel) {
    gcMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止冒泡到 document（chat.js 有面板外关闭监听，避免 toggle 冲突）
      if (gcMorePanel.hidden) {
        // 收起输入法，面板不被键盘遮挡（与聊天页 moreBtn 行为一致）
        try { if (window.closeIme) window.closeIme(); } catch (err) {}
        try { input.blur(); } catch (err) {}
        gcSetMoreTopbar(true);
        // v3.26.x：群聊打开更多面板 → 进入「群聊模式」：只保留【工具】分类，且只留 帮我决定/多人决定/搜索记录/占卜，
        // 禁止使用【小游戏】【TA的提问】【互动】功能（其余分类 tab 与功能按钮在群聊模式中被隐藏）。
        if (window.setMoreGroupMode) window.setMoreGroupMode(true);
        else if (window.applyMoreCat) window.applyMoreCat('tool');
      }
      gcMorePanel.hidden = !gcMorePanel.hidden;
      if (gcMorePanel.hidden) gcSetMoreTopbar(false);
    });
    // 群聊里点面板内的功能按钮（.more-item）→ 切到聊天页打开功能
    // 用捕获阶段：功能按钮的 handler（chat.js）里都有 e.stopPropagation()，冒泡阶段监听不到；
    // 捕获阶段先切页，随后按钮 handler 在聊天页上下文执行（打开半框）。
    gcMorePanel.addEventListener('click', (e) => {
      const item = e.target.closest('.more-item');
      if (!item) return;
      // @群成员 不走切换，保留群聊内打开
      if (gcMoreAt && (item === gcMoreAt || item.contains(gcMoreAt))) return;
      // v3.26.x：帮我决定/多人决定 面板已移到 .phone 级，群聊里可直接在本页使用（不切聊天页），
      // 结果发送到群聊（decision.js/group-decision.js 通过 gcIsVisible 判断群聊上下文）
      const keepInGroup = (item.id === 'more-decide' || item.id === 'more-gdecide');
      gcMorePanel.hidden = true;
      gcSetMoreTopbar(false);
      if (keepInGroup) return;
      // 切到聊天页（面板功能按钮的 handler 都在聊天页上下文；半框也在聊天页内）
      const chatPage = document.getElementById('page-chat');
      if (chatPage && chatPage.hidden) {
        document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #338 同值写也发 mutation（Blink 实测同值 3 连写=3 条记录），44 页全扫=唤醒全部页面观察器
        chatPage.hidden = false;
      }
    }, true);
  }
  // @群成员：从共享面板顶部栏打开成员选择（仅群聊有）
  if (gcMoreAt) gcMoreAt.addEventListener('click', (e) => {
    e.stopPropagation();
    if (gcMorePanel) gcMorePanel.hidden = true;
    gcSetMoreTopbar(false);
    renderAtPanel();
    if (atPanel) atPanel.hidden = false;
  });

  // ---- 表情包按钮：复用聊天页同一个表情包面板（写信/回信同款插入模式回调）----
  if (gcEmojiBtn) gcEmojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!window.openEmojiPanelForInsert) return;
    // #145：再次点击=关闭（按钮切换开关；先于 openEmojiPanelForInsert 判断，防「重开+外点关闭互相覆盖」）
    const epEl = document.getElementById('emoji-panel');
    if (epEl && !epEl.hidden) { window.closeEmojiPanelForInsert && window.closeEmojiPanelForInsert(); return; }
    // allowUrl：链接保存的表情在群聊里直接发送（仅信纸插入才限 data:）
    window.openEmojiPanelForInsert((src) => sendGcSticker(src), { allowUrl: true });
    // mail-emoji-mode 会把面板压低到 bottom:64px（写信页布局），群聊页与聊天页一致用默认 96px
    document.body.classList.remove('mail-emoji-mode');
  });

  // ---- 插入图片按钮：多选图片 → 压缩 → 草稿条预览，随发送合并为组合消息（同聊天页）----
  if (gcImgBtn) gcImgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true;
    fi.onchange = () => {
      const files = Array.prototype.slice.call(fi.files || []);
      if (!files.length) return;
      files.forEach(f => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            try {
              const c = document.createElement('canvas');
              const scale = Math.min(1, 720 / Math.max(img.width, img.height));
              c.width = Math.max(1, Math.round(img.width * scale));
              c.height = Math.max(1, Math.round(img.height * scale));
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              gcDraftImgs.push(c.toDataURL('image/jpeg', 0.85));
            } catch (err) {
              gcDraftImgs.push(reader.result);
            }
            renderGcDraft();
          };
          // 解码失败（HEIC/损坏图）按原图兜底，不静默丢失
          img.onerror = () => {
            gcDraftImgs.push(reader.result);
            renderGcDraft();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      });
    };
    fi.click();
  });

  // 点击面板背景关闭
  if (atPanel) atPanel.addEventListener('click', (e) => { if (e.target === atPanel) atPanel.hidden = true; });

  // ---- 消息气泡操作菜单（v3.16.x：点气泡弹出「引用」，与聊天页 #msg-actions 同款交互）----
  const gcMsgActions = document.getElementById('gc-msg-actions');
  let gcActiveMsgEl = null;
  function closeGcMsgActions() {
    if (gcMsgActions) gcMsgActions.hidden = true;
    gcActiveMsgEl = null;
  }
  // 消息快照 → 待引用内容（与聊天页 quote 分支同构：语音/表情/图片转占位文案）
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
    // v3.26.x：群聊消息操作菜单（引用）同样支持「长按 + 轻点」双手势，与聊天页保持一致
    function gcOpenMsgActions(item, bk) {
      gcActiveMsgEl = item;
      // 对齐聊天页：删除按钮按「允许删除联系人消息」开关（cs-del-ta-msg）显隐，
      // 仅成员消息可删；开关默认关，在群聊设置→输入与消息 里开启
      const delBtn = gcMsgActions.querySelector('.ma-del-gc');
      if (delBtn) {
        let delEn = false;
        try { delEn = window.activeStore().get('cs-del-ta-msg') === '1'; } catch (e) {}
        const side = item.classList.contains('msg-out') ? 'out' : 'in';
        delBtn.hidden = !(delEn && side === 'in');
      }
      gcMsgActions.hidden = false;
      // 定位：气泡上方居中，放不下换下方；clamp 在视口内（与聊天页同款算法）
      try {
        const bRect = bk.getBoundingClientRect();
        const aw = gcMsgActions.offsetWidth || 120;
        const ah = gcMsgActions.offsetHeight || 50;
        const vv = window.visualViewport;
        const vw = vv ? vv.width : window.innerWidth;
        const vh = vv ? vv.height : window.innerHeight;
        let x = bRect.left + bRect.width / 2 - aw / 2;
        x = Math.max(10, Math.min(vw - aw - 10, x));
        let y = bRect.top - ah - 8;
        const below = bRect.bottom + 8;
        const aboveFits = y >= 50;
        const belowFits = below + ah <= vh - 8;
        y = aboveFits || !belowFits ? y : below;
        gcMsgActions.style.left = x + 'px';
        gcMsgActions.style.top = y + 'px';
      } catch (err) {}
    }
    let gcHoldTimer = null;
    let gcHoldEl = null;
    let gcSuppressClickUntil = 0;
    body.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.msg-bubble') && !e.target.closest('.msg-quote')) e.preventDefault();
    });
    body.addEventListener('touchstart', (e) => {
      const bk = e.target.closest('.msg-bubble');
      if (!bk) return;
      if (e.target.closest('.msg-quote')) return;               // 引用块点击留给后续跳原消息
      const item = bk.closest('.msg');
      if (!item || item.classList.contains('msg-poke')) return; // 拍一拍居中条不弹
      if ((bk.textContent || '').indexOf('撤回了一条消息') >= 0) return; // 撤回提示有专属点击
      gcHoldEl = item;
      gcHoldTimer = setTimeout(() => {
        gcHoldTimer = null;
        gcSuppressClickUntil = Date.now() + 800; // 松开后抑制随之而来的轻点，防菜单被刚弹即关
        if (window.getSelection) { try { const s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (err) {} }
        gcOpenMsgActions(gcHoldEl, bk);
      }, 500);
    }, { passive: true });
    function endGcHold() { if (gcHoldTimer) { clearTimeout(gcHoldTimer); gcHoldTimer = null; } }
    body.addEventListener('touchmove', endGcHold, { passive: true }); // 手指滑动=滚动，取消长按
    body.addEventListener('touchend', endGcHold);
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
    gcMsgActions.addEventListener('click', (e) => {
      const btn = e.target.closest('.ma-btn');
      if (!btn) return;
      if (btn.dataset.act === 'quote' && gcActiveMsgEl) {
        const idx = Number(gcActiveMsgEl.dataset.gcIdx);
        const rec = (idx >= 0 && msgs[idx]) ? msgs[idx] : null;
        if (rec) {
          gcLastQuote = gcQuoteSnapOf(rec);
          renderGcDraft();
          try { if (input) input.focus(); } catch (err) {}
        }
      } else if (btn.dataset.act === 'del' && gcActiveMsgEl) {
        // 对齐聊天设置「允许删除联系人消息」（cs-del-ta-msg 开关，gcOpenMsgActions
        // 显隐同口径）——真删除该条成员消息，不可恢复
        const idx = Number(gcActiveMsgEl.dataset.gcIdx);
        if (idx >= 0 && msgs[idx] && msgs[idx].side === 'in') {
          msgs.splice(idx, 1);
          saveMsgs();
          renderAll();
          toast('已删除该消息');
        }
      }
      closeGcMsgActions();
    });
  }

  // ---- #287 拍一拍：点成员头像拍 TA（对齐聊天页点头像「对 TA 拍一拍」） ----
  // 面板复用聊天页 .poke-card 壳样式（DOM 锚点 #gc-poke-card 在 template 群聊页内）；
  // 字卡来源与聊天页拍一拍面板同源：预设 + 公用拍一拍字卡（getPokeCards）+ 当前桌面
  // 「我的拍一拍」自定义分组（poke-groups-mine / 存量 poke-user-mine，键走 activeStore）。
  const gcPokeCard = document.getElementById('gc-poke-card');
  const gcPokeList = document.getElementById('gc-poke-list');
  const gcPokeNameEl = document.getElementById('gc-poke-name');
  const gcPokeCloseBtn = document.getElementById('gc-poke-close');
  let gcPokeCid = null;
  const GC_POKE_PRESETS = ['拍了拍你', '戳了戳你的脸蛋', '弹了一下你的额头', '揉了揉你的头发', '捏了捏你的脸颊', '拍了拍你的肩膀'];
  function gcPokeActions() {
    const out = GC_POKE_PRESETS.slice();
    try { (window.getPokeCards() || []).forEach(x => { if (typeof x === 'string' && x && out.indexOf(x) < 0) out.push(x); }); } catch (e) {}
    [['poke-groups-mine', false], ['poke-user-mine', true]].forEach(([k, flat]) => {
      try {
        const v = JSON.parse(window.activeStore().get(k) || 'null');
        if (flat && Array.isArray(v)) {
          v.forEach(x => { if (typeof x === 'string' && x.trim() && out.indexOf(x) < 0) out.push(x); });
        } else if (Array.isArray(v)) {
          v.forEach(g => { if (Array.isArray(g) && Array.isArray(g[1])) g[1].forEach(x => { if (typeof x === 'string' && x.trim() && out.indexOf(x) < 0) out.push(x); }); });
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
  // 人称映射与聊天页 sendPoke 同构：你→成员名、句中我→成员名、句首我去掉并改为我的名字开头
  //（句首我+句中有你 的整句形态保留原句，仅替换你，不重复加速度词前缀——同 sendPoke 分支）；
  // 群聊拍一拍落库即定稿文本（成员拍我 gcPokeText 同口径，渲染期不做占位符回填）
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
    if (window.playSfx) window.playSfx('out');
    // 被拍成员按既有成员回复链反应（拍回来/回消息，概率走群聊回复设置）——
    // 对齐聊天页拍一拍后 TA 会已读/拍回/回复的语义
    setTimeout(() => { try { memberReply(cid, rec.text, curGid); } catch (err) {} }, 1200 + Math.random() * 1600);
  }

  // ---- 切联系人：当前群消息不变，刷新群名 + 重渲染（"我"头像/成员名可能变） ----
  // FIX 2026-09-07 #249 切桌面卡死：群聊数据全局共用（消息/分组/形象均不随桌面变），
  // 切桌面瞬间群聊页必是隐藏态（setActiveContact 强制回手机主页）——原监听无条件
  // renderAll() 整窗重渲最近 200 条消息纯属浪费，重度群设备每次切换白耗一段主线程。
  // 改为仅当群聊页正显示时才整窗重渲；隐藏态把"脏"标记挂起，下次 enterGroupChat
  // 本就 loadMsgs+renderAll 全量重建（成员名/头像/群名随之刷新），标记只是双保险。
  // 群名同步改走轻量的 memberName 脏检查（updateGroupName 内部开销极小，保留无条件调用）。
  let gcSwitchDirty = false;
  document.addEventListener('contact-switched', function () {
    try { hideTyping(); } catch (e) {}
    const pageVisible = page && !page.hidden;
    if (pageVisible) {
      updateGroupName();
      renderAll();
      try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
      // v3.26.x：联系人变动（新增/删除/改名）会改变成员名单，群列表开着时同步刷新
      try { if (groupsPanel && !groupsPanel.hidden) renderGroupsPanel(); } catch (e) {}
      gcSwitchDirty = false;
    } else {
      gcSwitchDirty = true; // 隐藏态挂起：enterGroupChat 全量重建兜底（防未来入口绕过）
    }
  });

  // 暴露（供数据备份/回归测试用）
  window.groupChatGetMsgs = function () { return msgs.slice(); };
  window.groupChatClear = function () { msgs = []; saveNow(); renderAll(); };
  // v3.26.x：只读探针——当前群聊分组列表（默认群恒在首位，返回纯数据副本）
  window.groupChatGetGroups = function () {
    try { return JSON.parse(JSON.stringify(groups)); } catch (e) { return []; }
  };
  window.groupChatGetCurGroup = function () {
    try { const g = currentGroup(); return g ? JSON.parse(JSON.stringify(g)) : null; } catch (e) { return null; }
  };
  window.groupChatProfileGet = function (key) { try { return JSON.parse(JSON.stringify(gcProfileGet(key))); } catch (e) { return {}; } };
  // name/avatar：传 undefined 保持不变，传空串清除该字段
  window.groupChatProfileSet = function (key, name, avatar) { gcProfileSet(key, name, avatar); };
  window.groupChatBeautyGet = function (k) { return gcBeautyGet(k); };
  // 设置群聊美化（空值/默认值 = 恢复默认）
  window.groupChatBeautySet = function (k, v) { gcBeautySet(k, v); };
  // v3.12.x：只读探针——某成员当前回复字卡池（公用+专属+按其桌面开关的默认字卡），
  // 供回归测试/作用域问题诊断（不暴露内部引用，返回纯数据副本）
  window.groupChatPoolFor = function (cid) {
    try { return JSON.parse(JSON.stringify(gcPool(cid))); } catch (e) { return null; }
  };
  // v3.26.x(#122)：注册群聊内置兜底回复池跨分类搜索（字卡库列表页搜索同源可查，不再搜不到）
  window.__cardSearchFns = window.__cardSearchFns || [];
  window.__cardSearchFns.push({ name: '群聊系统回应', fn: function (kw) {
    const out = [];
    try { FALLBACK_REPLIES.forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: '兜底回复' }); }); } catch (e) {}
    return out;
  } });
})();