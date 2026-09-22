// ===== 功能：头像和昵称互动（联系人头像池 + 我的头像池 + 联系人昵称池 + 我的昵称池） =====
// 聊天页内底部半框：两级切换——上排选「换什么」（头像 / 昵称），下排页签选「换谁的」（TA / 我的）。
// 四个池子各自支持添加多条 + 删除单条 + 清空 + 开关。
// 头像池（v3.6.x 起）：上传多张图片，定时随机更换联系人聊天头像（1-8 小时）；
// 更换时聊天显示"昵称 更换了头像"。
// 我的头像池：联系人也会定时（1-8 小时）主动给我换头像——有概率直接换，
// 有概率弹窗邀请我同意/拒绝（机制与联系人随机换头像一致，计时独立）。
// 昵称池（2026-09-16 新增）：存的是文字，点击即换聊天昵称（联系人 cs-lbl-partner /
// 我 cs-lbl-user）；随机更换、邀请回应、弹窗邀请、计时与头像池逐条对齐，计时相互独立。
// 上传/清空有成功/失败提示（toast）
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  const page = document.getElementById('page-chat-settings');
  if (!page) return;

  // 轻提示（全局唯一，带动画显示/隐藏）
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

  // 换头像邀请的回应概率（手动点击切换时触发）
  const INVITE_PROB = 50; // 触发"邀请/直接换"的概率 %（我换 TA 的：触发同意/拒绝回应；TA 换我的：触发弹窗邀请）
  const AGREE_PROB = 70;  // 触发回应时同意的概率 %（拒绝 = 100 - AGREE_PROB）

  // 联系人头像池
  function getLib() { try { return JSON.parse(store.get('avatar-lib') || '[]'); } catch (e) { return []; } }
  function saveLib(list) { store.set('avatar-lib', JSON.stringify(list)); }
  function getEnabled() { const v = store.get('avatar-lib-enabled'); return v === null ? true : v === '1'; }
  // #876 夜间静默：换头像/换昵称定时器夜间不触发（此前这四个 60s 轮询完全不受夜间模式约束，
  // 是用户报「开了夜间模式挂后台睡觉还在发」的最大来源）。守卫放在周期推进（写 last/next）
  // 之前：被拦的当次不推进周期，7:00 后下一个 60 秒轮询照常补发，不丢不堆积。
  // 主路径读 window.nightModeActive（incoming-requests.js 定义，单一事实源）；兜底直读全局
  // 根键——启动「立即检查」时该文件尚未加载（jsFiles 里排在本文件之后），且本文件 store 是
  // per-cid 命名空间，夜间开关是全局根键，不能用 store 读。
  function avNightQuiet() {
    if (window.nightModeActive) return !!window.nightModeActive();
    try { if (window.xyStore('xy-home-v2').get('night-mode-en') !== '1') return false; } catch (e) { return false; }
    try { const h = new Date().getHours(); return h >= 22 || h < 7; } catch (e) { return false; }
  }
  // 我的头像池
  function getMeLib() { try { return JSON.parse(store.get('avatar-me-lib') || '[]'); } catch (e) { return []; } }
  function saveMeLib(list) { store.set('avatar-me-lib', JSON.stringify(list)); }
  function getMeEnabled() { const v = store.get('avatar-me-lib-enabled'); return v === null ? true : v === '1'; }
  // 昵称清洗（FIX 2026-09-16 #616：用户报「我同意了 TA 的换昵称邀请，我的昵称换成了「」」——
  // 引号里是空的）。根因：**只由零宽字符组成的昵称能穿过 trim()**——U+200B 零宽空格等既不是
  // JS 的 WhiteSpace 也不可见，`'   '.trim()` 会清空但 `'\u200B'.trim()` 原样保留，
  // 于是「看着是空的名字」进了池子，写进 cs-lbl-* 后顶栏也是空白、消息引号里也是空白。
  // 从粘贴来源（网页/聊天记录）带进这类字符很常见，所以按「入库前剥掉」处理：
  // 零宽/方向控制/BOM/软连字符一律去掉，再去首尾空白；剥完为空＝这条不是昵称，丢弃。
  const INVIS_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u180E]/g;
  function cleanNick(s) {
    return String(s == null ? '' : s).replace(INVIS_RE, '').trim().slice(0, 30);
  }
  // 昵称池（2026-09-16）：结构是字符串数组，键位与头像池一一对应（nick-lib ↔ avatar-lib）。
  // 读入时清洗 + 过滤——历史脏值（导入损坏、手工改存储、上面那种零宽条目）不该把
  // 「看着是空的名字」写进 cs-lbl-*，也不该让池子里留一条点不到的空白胶囊。
  function loadStrList(key) {
    try {
      const v = JSON.parse(store.get(key) || '[]');
      return Array.isArray(v) ? v.map(cleanNick).filter(Boolean) : [];
    } catch (e) { return []; }
  }
  function getNickLib() { return loadStrList('nick-lib'); }
  function saveNickLib(list) { store.set('nick-lib', JSON.stringify(list)); }
  function getNickEnabled() { const v = store.get('nick-lib-enabled'); return v === null ? true : v === '1'; }
  function getMeNickLib() { return loadStrList('nick-me-lib'); }
  function saveMeNickLib(list) { store.set('nick-me-lib', JSON.stringify(list)); }
  function getMeNickEnabled() { const v = store.get('nick-me-lib-enabled'); return v === null ? true : v === '1'; }
  // 昵称池高亮/随机去重当前生效值口径与头像池一致：聊天专用键优先、回退桌面键
  function curPartnerNick() { return store.get('cs-lbl-partner') || store.get('lbl-partner') || ''; }
  function curMyNick() { return store.get('cs-lbl-user') || store.get('lbl-user') || ''; }

  // v3.9.x：头像库半框是聊天页内功能（聊天域）——昵称优先读聊天专用键 cs-lbl-*，
  // 未设置回退桌面键 lbl-*。
  // v3.12.x：联系人/我的头像换头像都只写聊天专用键（cs-avatar-partner/cs-avatar-user），
  // 桌面 deco-widget 的 avatar-partner/avatar-user 完全独立、不被头像互动改动
  //（未设聊天键时聊天页回退显示桌面键，但换头像不再反向同步到桌面）。
  function chatName(chatKey, deskKey, fb) {
    let v = null;
    try { v = store.get(chatKey); } catch (e) {}
    if (v) return v;
    try { v = store.get(deskKey); } catch (e) {}
    return v || fb;
  }
  function cPartnerName() { return chatName('cs-lbl-partner', 'lbl-partner', 'TA'); }
  function cUserName() { return chatName('cs-lbl-user', 'lbl-user', '我'); }

  // v3.14.x：字符串哈希（djb2）——压缩落盘后聊天键与池内原图字节不同，
  // 用小哈希记录「上次已换入的是哪张池图」，防止同一张图反复触发更换
  function strHash(s) {
    let h = 5381;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return String(h);
  }

  // v3.14.x：写入聊天头像键（cs-avatar-partner/cs-avatar-user）前统一压缩到 <200KB。
  // 根因：xyStore.set 对 >200KB 的值会移出 localStorage 只存 IndexedDB（异步），
  // 下次启动要等 idbRestore 回填才能读到——慢 IDB 设备（OPPO/vivo Chrome 等）窗口可达
  // 数秒~分钟，窗口内聊天顶栏/消息气泡读空回退旧桌面头像，用户看到「TA 换了头像但
  // 没生效」。备份导入的旧头像池可含未压缩原图（绕过上传时的 bindPoolUpload 压缩），
  // TA 随机选中即触发。压缩后小键同步落 localStorage，所有读路径立即可用，
  // 也顺带消除 fillAvatar 500KB 渲染上限的不对称。
  // ≤180KB 原样通过（同步回调，保持既有调用方行为）；非 data:image 或解码失败也原样放行。
  const AV_TARGET = 180 * 1024;
  function normalizeAvSize(data, cb) {
    if (!data || typeof data !== 'string' || data.indexOf('data:image') !== 0 || data.length <= AV_TARGET) { cb(data); return; }
    try {
      const img = new Image();
      img.onload = function () {
        try {
          const iw = img.width || 256, ih = img.height || 256;
          const scale = Math.min(1, 256 / Math.max(iw, ih));
          let w = Math.max(1, Math.round(iw * scale));
          let h = Math.max(1, Math.round(ih * scale));
          let q = 0.85, out = '';
          for (let tries = 0; tries < 4; tries++) {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            out = c.toDataURL('image/jpeg', q);
            if (out.length <= AV_TARGET) break;
            w = Math.max(48, Math.round(w * 0.8));
            h = Math.max(48, Math.round(h * 0.8));
            q = Math.max(0.5, q - 0.1);
          }
          cb(out && out.length < data.length ? out : data);
        } catch (e) { cb(data); }
      };
      img.onerror = function () { cb(data); };
      img.src = data;
    } catch (e) { cb(data); }
  }

  // ===== v3.14.x：聊天头像显示收敛兜底 =====
  // 「存储已是新头像、界面还停在旧头像」的残留场景统一兜底：
  // ① 历史大图换入后 cs 键只在 IDB、慢设备启动早期读空回退旧桌面头像，idbRestore
  //    迟到回填后需要有人重刷界面（mochi-restore-done 只刷顶栏且要求聊天页可见才重渲消息）；
  // ② 后台定时器被深度节流/冻结期间浏览器合并 DOM 变更等环境因素；
  // ③ 同一浏览器双开上下文（PWA + 浏览器标签）另一侧换了头像（storage 事件跨上下文同步）。
  // 触发时机：回前台 / 页面重新可见 / storage 事件。带哈希基线对比——值没变化不重刷
  // （refreshChatAvatars 会重建已渲染消息的 img，200 条消息级别有成本，不能每次都跑）。
  let appliedPh = null, appliedUh = null;
  function convergeAvatars() {
    try {
      const ph = strHash(store.get('cs-avatar-partner') || store.get('avatar-partner') || '');
      const uh = strHash(store.get('cs-avatar-user') || store.get('avatar-user') || '');
      if (appliedPh !== null && ph === appliedPh && uh === appliedUh) return;
      appliedPh = ph; appliedUh = uh;
      if (window.refreshChatAvatars) window.refreshChatAvatars();
    } catch (e) {}
  }
  // 本模块自己写入了新值：applyAvatarImg 已即时生效，这里只需对齐基线防 converge 重刷
  function noteApplied(kind, val) {
    try {
      const h = strHash(val || '');
      if (kind === 'partner') appliedPh = h; else appliedUh = h;
    } catch (e) {}
  }
  // 基线初始化取当前存储值（启动时 chat.js 已按同口径填过一次头像）
  try { appliedPh = strHash(store.get('cs-avatar-partner') || store.get('avatar-partner') || ''); } catch (e) {}
  try { appliedUh = strHash(store.get('cs-avatar-user') || store.get('avatar-user') || ''); } catch (e) {}
  // v3.42.x #425：基线初始化本身可能拿到空值——cs-avatar-* 是大图键，常驻 IDB-only 区，
  //   本模块加载早于 idbRestore 回填，启动读空 → 基线被污染成「空=已应用」；回填完成后
  //   personalize/chat 的 mochi-restore-done 只刷桌面圈和聊天顶栏（气泡还要求聊天页可见+贴底），
  //   convergeAvatars 又因基线相等误判「没变化」跳过 → 「刚进网站头像时不时加载不出来」，
  //   停在同一页面就一直空（多机型报障：华为畅享70Pro/红米K80 等）。回填完成时清基线强制
  //   收敛一次：refreshChatAvatars 重建气泡 img + 顶栏，哈希基线随即对齐，重复事件零成本跳过。
  document.addEventListener('mochi-restore-done', function () {
    appliedPh = null; appliedUh = null;
    setTimeout(convergeAvatars, 0);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') convergeAvatars();
  });
  document.addEventListener('mochi-fg-resume', convergeAvatars);
  document.addEventListener('contact-switched', function () { setTimeout(convergeAvatars, 0); });
  window.addEventListener('storage', function (e) {
    try {
      if (e.key && /:cs-avatar-(partner|user)$/.test(e.key)) convergeAvatars();
    } catch (err) {}
  });

  // ===== 功能：头像互动（原联系人头像库，改为聊天页内底部半框） =====
  // 半框展示头像池：上传多张 + 删除单张 + 清空 + 开关 + 点击切换（半框露出聊天消息，方便边看边玩）
  // 定时随机更换联系人聊天头像（1-8 小时）；更换时聊天显示"昵称 更换了头像"
  // 上传/清空有成功/失败提示（toast）
  const avPage = document.getElementById('avlib-card');
  const avGrid = document.getElementById('avlib-grid');
  const avCount = document.getElementById('avlib-count');
  const avEmpty = document.getElementById('avlib-empty');
  const avEnabled = document.getElementById('avlib-enabled');
  const avUpload = document.getElementById('avlib-upload');
  const avClear = document.getElementById('avlib-clear');
  const avName = document.getElementById('avlib-name');
  const avPoolName = document.getElementById('avlib-pool-name');
  const avMeGrid = document.getElementById('avlib-me-grid');
  const avMeCount = document.getElementById('avlib-me-count');
  const avMeEmpty = document.getElementById('avlib-me-empty');
  const avMeEnabled = document.getElementById('avlib-me-enabled');
  const avMeUpload = document.getElementById('avlib-me-upload');
  const avMeClear = document.getElementById('avlib-me-clear');
  const avTabA = document.getElementById('avlib-tab-a');
  const avTabB = document.getElementById('avlib-tab-b');
  const avPaneA = document.getElementById('avlib-pane-a');
  const avPaneB = document.getElementById('avlib-pane-b');
  const avMeTabName = document.getElementById('avlib-me-tab-name');
  // 昵称池（2026-09-16）
  const avKindAvatar = document.getElementById('avlib-kind-avatar');
  const avKindName = document.getElementById('avlib-kind-name');
  const avPaneC = document.getElementById('avlib-pane-c');
  const avPaneD = document.getElementById('avlib-pane-d');
  const avNickList = document.getElementById('avlib-nick-list');
  const avNickEmpty = document.getElementById('avlib-nick-empty');
  const avNickEnabled = document.getElementById('avlib-nick-enabled');
  const avNickAdd = document.getElementById('avlib-nick-add');
  const avNickClear = document.getElementById('avlib-nick-clear');
  const avMeNickList = document.getElementById('avlib-me-nick-list');
  const avMeNickEmpty = document.getElementById('avlib-me-nick-empty');
  const avMeNickEnabled = document.getElementById('avlib-me-nick-enabled');
  const avMeNickAdd = document.getElementById('avlib-me-nick-add');
  const avMeNickClear = document.getElementById('avlib-me-nick-clear');

  // 半框两级状态：avKind=换什么（头像/昵称），avOwner=换谁的（0=TA，1=我的）
  let avKind = 'avatar', avOwner = 0;
  function kindIsName() { return avKind === 'name'; }
  // 页签计数跟随当前大类——同一排页签在两种大类下要显示各自的池子条数
  function syncCounts() {
    if (avCount) avCount.textContent = (kindIsName() ? getNickLib() : getLib()).length;
    if (avMeCount) avMeCount.textContent = (kindIsName() ? getMeNickLib() : getMeLib()).length;
  }
  function syncVal() {
    if (avEnabled) avEnabled.checked = getEnabled();
    if (avMeEnabled) avMeEnabled.checked = getMeEnabled();
    if (avNickEnabled) avNickEnabled.checked = getNickEnabled();
    if (avMeNickEnabled) avMeNickEnabled.checked = getMeNickEnabled();
    const myName = cUserName();
    if (avName) avName.textContent = cPartnerName();
    // 页签文案跟随大类与当前昵称（改了昵称后「XX 的昵称库」要跟着变）
    if (avPoolName) avPoolName.textContent = cPartnerName() + (kindIsName() ? ' 的昵称库' : ' 的头像库');
    if (avMeTabName) {
      if (kindIsName()) avMeTabName.textContent = myName ? myName + ' 的昵称库' : '我的昵称库';
      else avMeTabName.textContent = myName ? myName + ' 的头像库' : '我的头像库';
    }
    syncCounts();
  }
  // 四个 pane 的显隐由两级状态共同决定（pane-a/b=头像TA/头像我，pane-c/d=昵称TA/昵称我）
  function syncAvPane() {
    const me = avOwner === 1, nameKind = kindIsName();
    if (avTabA) avTabA.classList.toggle('active', !me);
    if (avTabB) avTabB.classList.toggle('active', me);
    if (avKindAvatar) avKindAvatar.classList.toggle('active', !nameKind);
    if (avKindName) avKindName.classList.toggle('active', nameKind);
    if (avPaneA) avPaneA.hidden = !(!nameKind && !me);
    if (avPaneB) avPaneB.hidden = !(!nameKind && me);
    if (avPaneC) avPaneC.hidden = !(nameKind && !me);
    if (avPaneD) avPaneD.hidden = !(nameKind && me);
    syncVal();
  }
  // 页签切换：TA 的池 / 我的池（点页签直接切换，两级状态不变）
  function switchAvTab(me) { avOwner = me ? 1 : 0; syncAvPane(); try { avKickFirstScreen(avGrid); avKickFirstScreen(avMeGrid); } catch (e) {} }
  // 大类切换：头像 / 昵称
  function switchAvKind(name) { avKind = name ? 'name' : 'avatar'; syncAvPane(); try { avKickFirstScreen(avGrid); avKickFirstScreen(avMeGrid); } catch (e) {} }
  // v3.42.x 头像互动图片懒加载——与表情面板/字卡库同一机制（data-src + IntersectionObserver）：
  // 头像池多张全尺寸图一次全量解码 = 中端机型主线程卡死、头像显示不出（跨机型报障同族）。
  // 只给进入视口的图补 src；无 IntersectionObserver 的浏览器回退即时补 src（行为不变）。
  const avImgObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const img = en.target;
        if (img && img.dataset && img.dataset.src && !img.getAttribute('src')) {
          img.setAttribute('src', img.dataset.src);
          img.removeAttribute('data-src');
        }
        try { avImgObserver.unobserve(img); } catch (e) {}
      }
    }, { root: null, rootMargin: '300px 0px' })
    : null;
  function avAttachLazy(img) {
    if (!img) return;
    if (avImgObserver) { try { avImgObserver.observe(img); } catch (e) {} }
    else { img.setAttribute('src', img.dataset.src || ''); img.removeAttribute('data-src'); }
  }
  // FIX #508（红米 K80 Chrome 等多机型报「头像互动点选换头像，图片闪一下重新加载」）：
  // 换头像后库内容没变，唯一变化是「当前生效」那张的高亮——旧路径 renderGrid()/renderMeGrid()
  // 整格 innerHTML='' 重建全部 cell，img 全部新建＋懒加载重新赋 src＝已解码图全部重新解码
  // （无头 390×844 节点身份实证：点一次 8/8 个 img 全部被替换＝闪+重载）。改为只按库内容
  // 同步 .avlib-now 高亮类，img 节点原样保留＝零重解码；库内容真正变化（上传/删除/清空）
  // 仍走整格重建。零机型分支、零视觉改动。
  // FIX 2026-09-15 #509（红米 K80 Chrome 等多机型报「头像互动点开图片就闪一下重新加载」，
  // 用户明说「其他设备型号也有出现」）：#508 只收口了「点选换头像」路径，**打开半框**这条
  // 路径仍在 openAvlib 里直接 renderGrid()/renderMeGrid() 整格重建（无头 390×844 实证：
  // 打开→关闭→再打开，8/8 个 img 节点全部被替换＝已解码图全部重新解码＝用户看到的闪）。
  // 收口：复用判定改成返回值（true=库内容与 DOM 逐个一致，只同步高亮；false=需整格重建），
  // 打开路径先试复用；库真变了（上传/删除/清空/换桌面）照旧整格重建。
  // 顺带修 #508 遗留：原实现用 forEach + `return`（只退出当次回调）触发重建，遇到多个不一致
  // 项会连续重建多次——改 for 循环，首处不一致即返回。
  // FIX 2026-09-16 #616（昵称池落地时顺带发现的既有缺陷，头像/昵称四个池同族）：
  // 「库没变就不重建」的判定只看格子数与内容——空库时 cells.length(0)===lib.length(0)，
  // 循环不跑、直接 return true，于是 renderXxx() 永不执行，**空态提示条（#avlib-empty 等）
  // 永远停在模板初始的 hidden 上**：新用户头像池/昵称池为空时看不到「还没有…点击下方按钮添加」，
  // 只有上传过再清空才会出现（那次走的是直接 render）。判定里补上空态提示的显隐比对。
  function emptyHintMismatch(el, lib) { return !!el && el.hidden !== (lib.length > 0); }
  function updateGridNow() {
    if (!avGrid) return false;
    const lib = getLib();
    const current = store.get('cs-avatar-partner') || store.get('avatar-partner');
    if (emptyHintMismatch(avEmpty, lib)) return false;
    const cells = avGrid.querySelectorAll('.avlib-cell');
    if (cells.length !== lib.length) return false;
    for (let i = 0; i < lib.length; i++) {
      const im = cells[i].querySelector('img');
      // 懒加载补 src 后 data-src 被移除，已加载的图比对 src
      if (!im || (im.dataset.src || im.getAttribute('src')) !== lib[i]) return false;
    }
    lib.forEach((src, idx) => { cells[idx].classList.toggle('avlib-now', src === current); });
    return true;
  }
  function updateMeGridNow() {
    if (!avMeGrid) return false;
    const lib = getMeLib();
    const current = store.get('cs-avatar-user') || store.get('avatar-user');
    if (emptyHintMismatch(avMeEmpty, lib)) return false;
    const cells = avMeGrid.querySelectorAll('.avlib-cell');
    if (cells.length !== lib.length) return false;
    for (let i = 0; i < lib.length; i++) {
      const im = cells[i].querySelector('img');
      if (!im || (im.dataset.src || im.getAttribute('src')) !== lib[i]) return false;
    }
    lib.forEach((src, idx) => { cells[idx].classList.toggle('avlib-now', src === current); });
    return true;
  }
  // 统一入口：库内容没变＝零重建（只同步高亮），变了才整格重建
  function renderGridSmart() { if (!updateGridNow()) renderGrid(); }
  function renderMeGridSmart() { if (!updateMeGridNow()) renderMeGrid(); }
  // FIX #509：IDB 迟到回填（慢 IDB 设备启动读空→回填）后若半框正开着，同样走「内容没变不重建」
  // 口径——原路径没有这步，用户要么看不到回填的新图，要么在别处触发整格重建再闪一次
  function refreshAvGrids() {
    if (!avPage || avPage.hidden) return;
    renderGridSmart();
    renderMeGridSmart();
    renderNickGridSmart();
    renderMeNickGridSmart();
  }
  function renderGrid() {
    if (!avGrid) return;
    const lib = getLib();
    // v3.12.x：高亮当前生效的聊天头像（cs-avatar-partner 未设时回退桌面头像，与我的头像网格同口径）
    const current = store.get('cs-avatar-partner') || store.get('avatar-partner');
    if (avImgObserver) avGrid.querySelectorAll('img[data-src]').forEach(im => { try { avImgObserver.unobserve(im); } catch (e) {} }); // v3.42.x
    avGrid.innerHTML = '';
    syncCounts(); // 计数归 syncCounts 管（同一排页签在头像/昵称两种大类下要显示各自条数）
    if (avEmpty) avEmpty.hidden = lib.length > 0;
    lib.forEach((src, idx) => {
      const d = document.createElement('div');
      d.className = 'avlib-cell' + (src === current ? ' avlib-now' : '');
      // v3.6.x：img src 用属性赋值（dataURL 里含引号时拼 innerHTML 会逃逸注入 HTML）
      const img = document.createElement('img');
      img.dataset.src = src; // v3.42.x 懒加载：进入视口才解码
      img.alt = '头像';
      avAttachLazy(img);
      const delBtn = document.createElement('button');
      delBtn.className = 'avlib-del';
      delBtn.textContent = '✕';
      d.appendChild(img);
      d.appendChild(delBtn);
      // 点击图片：直接切换联系人头像（可能触发同意/拒绝回应）
      img.addEventListener('click', () => {
        switchAvatarFromLib(src);
      });
      delBtn.addEventListener('click', () => {
        const l = getLib();
        l.splice(idx, 1);
        saveLib(l);
        renderGrid();
        syncVal();
      });
      avGrid.appendChild(d);
    });
  }
  // 我的头像池网格：点击图片直接换成我的头像（也记入主页记录 + 聊天系统消息）；
  // 另支持删除单张
  function renderMeGrid() {
    if (!avMeGrid) return;
    const lib = getMeLib();
    // v3.9.x：高亮当前生效的聊天头像（cs-avatar-user 未设时回退桌面头像 avatar-user）
    const current = store.get('cs-avatar-user') || store.get('avatar-user');
    if (avImgObserver) avMeGrid.querySelectorAll('img[data-src]').forEach(im => { try { avImgObserver.unobserve(im); } catch (e) {} }); // v3.42.x
    avMeGrid.innerHTML = '';
    syncCounts(); // 同上
    if (avMeEmpty) avMeEmpty.hidden = lib.length > 0;
    lib.forEach((src, idx) => {
      const d = document.createElement('div');
      d.className = 'avlib-cell' + (src === current ? ' avlib-now' : '');
      const img = document.createElement('img');
      img.dataset.src = src; // v3.42.x 懒加载：进入视口才解码
      img.alt = '头像';
      avAttachLazy(img);
      const delBtn = document.createElement('button');
      delBtn.className = 'avlib-del';
      delBtn.textContent = '✕';
      d.appendChild(img);
      d.appendChild(delBtn);
      // 点击图片：直接换成我的头像（我的头像池可手动切换）
      img.addEventListener('click', () => {
        switchMyAvatarFromLib(src);
      });
      delBtn.addEventListener('click', () => {
        const l = getMeLib();
        l.splice(idx, 1);
        saveMeLib(l);
        renderMeGrid();
      });
      avMeGrid.appendChild(d);
    });
  }

  // ===== 昵称池渲染（2026-09-16）=====
  // 与头像网格同一套「内容没变就不重建」口径：点一条换昵称只改 .avlib-now 高亮，
  // 不重建节点（重建会丢掉正在滚动的视口位置，也让长按选中态闪掉）。文字没有解码成本，
  // 复用这一口径纯粹是为了与头像侧行为一致、便于同一批回归脚本覆盖。
  function updateNickGridNow() {
    if (!avNickList) return false;
    const lib = getNickLib();
    const current = curPartnerNick();
    if (emptyHintMismatch(avNickEmpty, lib)) return false; // 同 updateGridNow 的空态提示修复
    const cells = avNickList.querySelectorAll('.avlib-name-cell');
    if (cells.length !== lib.length) return false;
    for (let i = 0; i < lib.length; i++) {
      const tx = cells[i].querySelector('.avlib-name-txt');
      if (!tx || tx.textContent !== lib[i]) return false;
    }
    lib.forEach((name, idx) => { cells[idx].classList.toggle('avlib-now', name === current); });
    return true;
  }
  function updateMeNickGridNow() {
    if (!avMeNickList) return false;
    const lib = getMeNickLib();
    const current = curMyNick();
    if (emptyHintMismatch(avMeNickEmpty, lib)) return false; // 同上
    const cells = avMeNickList.querySelectorAll('.avlib-name-cell');
    if (cells.length !== lib.length) return false;
    for (let i = 0; i < lib.length; i++) {
      const tx = cells[i].querySelector('.avlib-name-txt');
      if (!tx || tx.textContent !== lib[i]) return false;
    }
    lib.forEach((name, idx) => { cells[idx].classList.toggle('avlib-now', name === current); });
    return true;
  }
  function renderNickGridSmart() { if (!updateNickGridNow()) renderNickGrid(); }
  function renderMeNickGridSmart() { if (!updateMeNickGridNow()) renderMeNickGrid(); }
  // 一条昵称 = 一个胶囊：点文字换昵称，点右侧 ✕ 删除这一条。
  // 删除按值定位（不是按下标）——昵称池允许重复值被上层的查重挡掉，但历史数据/导入可能带重复，
  // 按下标删会删错那一条。
  function buildNickCell(name, libFn, saveFn, rerender, onPick) {
    const d = document.createElement('div');
    d.className = 'avlib-name-cell';
    const txt = document.createElement('span');
    txt.className = 'avlib-name-txt';
    txt.textContent = name;
    txt.title = name;
    const delBtn = document.createElement('button');
    delBtn.className = 'avlib-name-del';
    delBtn.textContent = '✕';
    d.appendChild(txt);
    d.appendChild(delBtn);
    txt.addEventListener('click', () => onPick(name));
    delBtn.addEventListener('click', () => {
      const l = libFn();
      const i = l.indexOf(name);
      if (i < 0) return;
      l.splice(i, 1);
      saveFn(l);
      rerender();
      syncVal();
    });
    return d;
  }
  function renderNickGrid() {
    if (!avNickList) return;
    const lib = getNickLib();
    const current = curPartnerNick();
    avNickList.innerHTML = '';
    syncCounts();
    if (avNickEmpty) avNickEmpty.hidden = lib.length > 0;
    lib.forEach(name => {
      const d = buildNickCell(name, getNickLib, saveNickLib, renderNickGrid, switchNickFromLib);
      if (name === current) d.classList.add('avlib-now');
      avNickList.appendChild(d);
    });
  }
  function renderMeNickGrid() {
    if (!avMeNickList) return;
    const lib = getMeNickLib();
    const current = curMyNick();
    avMeNickList.innerHTML = '';
    syncCounts();
    if (avMeNickEmpty) avMeNickEmpty.hidden = lib.length > 0;
    lib.forEach(name => {
      const d = buildNickCell(name, getMeNickLib, saveMeNickLib, renderMeNickGrid, switchMyNickFromLib);
      if (name === current) d.classList.add('avlib-now');
      avMeNickList.appendChild(d);
    });
  }

  // 打开/关闭半框
  function openAvlib() {
    if (!avPage) return;
    // v3.9.x：打开前补读新桌面 IDB 权威数据（头像池大键切桌面后可能只在 IDB，
    // 慢 IDB 下 memoryCache 未回填 → store.get 读空显示「暂无头像」）
    try { restoreLib('avatar-lib'); restoreLib('avatar-me-lib'); restoreLib('nick-lib'); restoreLib('nick-me-lib'); } catch (e) {}
    // 关闭其他底部半框（拍一拍/表情包）
    const pc = document.getElementById('poke-card');
    if (pc) pc.hidden = true;
    const ep = document.getElementById('emoji-panel');
    if (ep) ep.hidden = true;
    renderGridSmart();   // FIX #509：打开时不整格重建——库没变只同步高亮（旧路径每次打开都重建=图片闪）
    renderMeGridSmart(); // FIX #509 同上
    renderNickGridSmart();
    renderMeNickGridSmart();
    syncAvPane(); // 两个大类 + 四个 pane 的显隐/文案/计数一次性同步（内含 syncVal）
    // FIX 2026-09-17 #662 头像互动「图片闪一下重新加载」（红米 K80 Chrome 等多机型，用户明说其他
    //   设备型号也有）：与聊天表情包面板同族、同一条机制——半框平时是 display:none 挂着的，
    //   图在隐藏期间浏览器可以回收已解码位图（中端/低内存机型更积极，正对应「其他设备型号也有」），
    //   再打开时整格重新解码＝每次打开都闪一下。**这条节点身份测不出**（#508/#509/#617 的断言
    //   都只看节点有没有被替换，节点一直没换、照样闪），所以在显示前主动 decode 一次：位图还在
    //   时 decode 立即兑现（不可感知），被回收过时先解码完再显示＝不再出现空帧 / 逐格冒出。
    //   #692：不再 120ms 强行显示——与表情包面板同一处缺口（解码没完就显示＝空帧/逐格冒出，
    //   且等待期间关闭会被回调重新弹出）。改为解码结算后再显示，世代令牌防串场，兜底 1s。
    const myToken = ++avShowToken;
    avShowWhenDecoded(function () { avPage.hidden = false; }, myToken);
  }
  let avShowToken = 0; // #692：头像互动半框「解码后再显示」世代令牌（关闭/重开作废，防空回调弹出）
  // FIX 2026-09-22 #1011 头像互动半框「打开就闪一下重新加载」残留根因（表情面板同族、同一条机制）：
  //   #716 的等待只对「此刻已经有 src 的图」await decode()，而首开这一拍图只有 data-src
  //   （懒加载的 src 要等 IntersectionObserver 回调，回调要到下一帧才回来）⇒ jobs 为空、等待当场
  //   放行，半框先显示、图随后才一张张落地＝用户看到的闪一下再重新加载。判据改成「首屏每张图都
  //   拿到载荷且解码完成」：首屏当场补 src（不等 IO 回调）、未就绪的等自己的 load，兜底 2.5s 不变。
  //   零机型分支、零视觉改动。
  const AV_DECODE_AWAIT_MAX = 24; // #716 首屏口径（#1011 起提到模块作用域：首屏判定函数也要用）
  function avFirstScreen(grid) {
    const out = [];
    if (!grid) return out;
    let imgs; try { imgs = grid.querySelectorAll('img'); } catch (e) { return out; }
    if (!imgs || !imgs.length) return out;
    let cr = null; try { cr = (avPage || grid).getBoundingClientRect(); } catch (e) {}
    const byRect = !!(cr && cr.height > 4); // 没量到几何（非活动 pane 等）时退回前 N 张旧口径
    for (let i = 0; i < imgs.length; i++) {
      if (out.length >= AV_DECODE_AWAIT_MAX) break;
      const im = imgs[i];
      if (byRect) {
        let r = null; try { r = im.getBoundingClientRect(); } catch (e) {}
        if (r && r.top > cr.bottom + 80) break; // 半框下沿外的留给懒加载
        if (!r || r.bottom < cr.top - 80) continue; // 已滚上去/非活动 pane（无几何）不占等待名额
        out.push(im);
      } else out.push(im);
    }
    return out;
  }
  function avKickFirstScreen(grid) {
    const imgs = avFirstScreen(grid);
    for (let i = 0; i < imgs.length; i++) {
      const im = imgs[i];
      let ds = ''; try { ds = (im.dataset && im.dataset.src) || ''; } catch (e) {}
      if (ds && !im.getAttribute('src')) {
        im.setAttribute('src', ds); // 当场补：不等 IO 回调（令牌载荷同路径，池会按 src 重写真载荷）
        try { im.removeAttribute('data-src'); } catch (e) {}
        try { if (avImgObserver) avImgObserver.unobserve(im); } catch (e) {}
      }
    }
    return imgs;
  }
  function avImgReady(im) {
    return new Promise(function (res) {
      let done = false;
      const okNow = function () { try { return !!(im.complete && im.naturalWidth > 0); } catch (e) { return false; } };
      const srcNow = function () { try { return im.getAttribute('src') || ''; } catch (e) { return ''; } };
      const off = function () { try { im.removeEventListener('load', settle); im.removeEventListener('error', settle); } catch (e) {} };
      const settle = function () {
        if (done) return;
        if (okNow()) { done = true; off(); res(true); return; }
        if (srcNow().indexOf('@@m:') !== 0) { done = true; off(); res(false); return; } // 真失败/无源：不挡显示
        // 令牌未解析：池重写 src 后会再触发 load，继续等
      };
      try { im.addEventListener('load', settle); im.addEventListener('error', settle); } catch (e) {}
      settle();
      setTimeout(function () { if (!done) { done = true; off(); res(okNow()); } }, 2400);
    }).then(function () { try { return im.decode ? im.decode().catch(function () {}) : null; } catch (e) { return null; } });
  }
  // #662：把头像库网格里已赋 src 的图 decode 完再执行 show（openAvlib 用）
  function avShowWhenDecoded(show, token) {
    let shown = false;
    const fin = function () {
      if (shown) return; shown = true;
      if (token !== undefined && token !== avShowToken) return; // #692 已关闭/已重开：本次显示作废
      try { show(); } catch (e) {}
    };
    if (!window.Promise) { fin(); return; }
    // #716：只等「首屏范围」的解码，不再等全部——旧实现对两个网格全部 img[src] await decode，
    // 大头像库在低内存机型隐藏期位图被回收，总解码超兜底＝半途放行、首屏逐格冒出＝用户看到的
    // 「换头像打开页面图片闪烁重载」（#704 表情面板同族收口，红米 K80 实报）。前 24 张
    // （≈半框首屏两三行）await 后即显示；其余 fire-and-forget 预热不挡显示。
    const grids = [avGrid, avMeGrid];
    const jobs = [];
    for (let g = 0; g < grids.length; g++) {
      const grid = grids[g];
      if (!grid) continue;
      const first = avKickFirstScreen(grid); // #1011：先把首屏载荷补进 src（不等 IO 回调）
      for (let i = 0; i < first.length; i++) jobs.push(avImgReady(first[i]));
      const imgs = grid.querySelectorAll('img[src]');
      for (let i = 0; i < imgs.length; i++) {
        if (first.indexOf(imgs[i]) >= 0) continue;
        try { if (imgs[i].decode) imgs[i].decode().catch(function () {}); } catch (e) {} // #716：首屏外只预热不等待
      }
    }
    if (!jobs.length) { fin(); return; }
    Promise.all(jobs).then(fin, fin);
    setTimeout(fin, 2500); // #716：1s→2.5s——首屏解码慢的机型半途放行＝可见「闪烁重载」；上限仍在防挂死
  }
  // v3.9.x：切桌面后同样补读新桌面头像池（restoreLib 内部校验桌面归属 + 内容更多才覆盖）
  document.addEventListener('contact-switched', function () {
    try { restoreLib('avatar-lib'); restoreLib('avatar-me-lib'); restoreLib('nick-lib'); restoreLib('nick-me-lib'); } catch (e) {}
  });
  function closeAvlib() {
    avShowToken++; // #692：作废未兑现的「解码后显示」
    if (avPage) avPage.hidden = true;
  }
  window.openAvlib = openAvlib;
  // FIX #907「进桌面前提前加载」（用户直派：与表情包面板同一开关 chat-panel-prewarm，chat.js
  //   统一调度）：半框还没打开时就把四个池渲染出来＋首屏图补 src/预解码——配合 chat-main.css
  //   的 keep-alive（#avlib-card[hidden] 不再 display:none），位图落地后一直驻留，用户点开
  //   头像互动时 updateXxxNow 指纹短路命中＋decode() 立即兑现＝零闪。面板开着/聊天页不在时
  //   不做任何事（开着有 #662 解码后显示管，聊天页不在则半框无几何，图反正进不了视口）。
  window.mochiPrewarmAvlib = function () {
    if (!avPage || !avPage.hidden) return;
    if (typeof document !== 'undefined') {
      const cp = document.getElementById('page-chat');
      if (cp && cp.hidden) return;
    }
    try { renderGridSmart(); renderMeGridSmart(); renderNickGridSmart(); renderMeNickGridSmart(); } catch (e) {}
    const grids = [avGrid, avMeGrid];
    for (let g = 0; g < grids.length; g++) {
      const grid = grids[g];
      if (!grid) continue;
      const imgs = grid.querySelectorAll('img');
      let n = 0;
      for (let i = 0; i < imgs.length && n < 24; i++) {
        const im = imgs[i];
        if (im.dataset && im.dataset.src && !im.getAttribute('src')) {
          im.setAttribute('src', im.dataset.src);
          im.removeAttribute('data-src');
          n++;
        }
        try { if (im.decode) im.decode().catch(function () {}); } catch (e) {}
      }
    }
  };
  // v3.6.x：closeAvlib 也导出到 window——chat.js 等模块用 window.closeAvlib()
  // 关闭头像互动半框（打开拍一拍/表情包/查岗时互斥），此前漏导出导致调用无效、
  // 面板关不掉（有 if 守卫所以不报错，但功能失效）
  window.closeAvlib = closeAvlib;
  const avClose = document.getElementById('avlib-close');
  if (avClose) avClose.addEventListener('click', closeAvlib);
  // FIX 2026-09-20 #906：点面板外关闭（同族底半框缺口核查所得，与帮我决定/多人决定同批）；判据见 chat.js mochiSheetOutsideClose
  if (window.mochiSheetOutsideClose) window.mochiSheetOutsideClose(document.getElementById('avlib-card'), closeAvlib);
  // 顶部页签点击切换（换谁的：TA / 我的）
  if (avTabA) avTabA.addEventListener('click', () => switchAvTab(false));
  if (avTabB) avTabB.addEventListener('click', () => switchAvTab(true));
  // 大类切换（换什么：头像 / 昵称）
  if (avKindAvatar) avKindAvatar.addEventListener('click', () => switchAvKind(false));
  if (avKindName) avKindName.addEventListener('click', () => switchAvKind(true));
  // 聊天页更多功能 → 头像互动
  const moreAvatar = document.getElementById('more-avatar');
  if (moreAvatar) {
    moreAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      const morePanel = document.getElementById('chat-more-panel');
      if (morePanel) morePanel.hidden = true;
      openAvlib();
    });
  }
  // 开关
  if (avEnabled) {
    avEnabled.addEventListener('change', () => {
      store.set('avatar-lib-enabled', avEnabled.checked ? '1' : '0');
      syncVal();
    });
  }
  if (avMeEnabled) {
    avMeEnabled.addEventListener('change', () => {
      store.set('avatar-me-lib-enabled', avMeEnabled.checked ? '1' : '0');
      syncVal();
    });
  }
  // 昵称池开关（与头像池各自独立，语义一一对应）
  if (avNickEnabled) {
    avNickEnabled.addEventListener('change', () => {
      store.set('nick-lib-enabled', avNickEnabled.checked ? '1' : '0');
      syncVal();
    });
  }
  if (avMeNickEnabled) {
    avMeNickEnabled.addEventListener('change', () => {
      store.set('nick-me-lib-enabled', avMeNickEnabled.checked ? '1' : '0');
      syncVal();
    });
  }
  // 上传多张（两个头像池共用）：读取失败的文件会跳过，全部成功/部分失败都有提示
  function bindPoolUpload(btn, listFn, saveFn, rerender) {
    if (!btn) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.id = (btn.id || 'avlib') + '-file-pick'; // FIX 2026-09-18 #717：常驻池选择器身份（诊断/测试句柄，按按钮唯一）
    // FIX 2026-09-18 #717：display:none 换成「移出屏幕仍可见」——部分机型/老 WebView 对
    // display:none 的 file input 程序化 click() 可能静默不弹选择器（点了没反应），与
    // chat-settings.js headInput 同款 offscreen 样式。input 仍常驻挂 body、onchange 里清
    // value，行为面不变。
    input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;'; // FIX 2026-09-18 #738：sr-only clip 写法（原 offscreen+opacity:0），原生 label 兜底见下
    document.body.appendChild(input);
    input.onchange = () => {
      const files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (!files.length) return;
      const list = listFn();
      let done = 0, okCount = 0, failCount = 0;
      files.forEach(f => {
        const reader = new FileReader();
        reader.onerror = () => { done++; failCount++; if (done === files.length) finish(); };
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            try {
              const c = document.createElement('canvas');
              const scale = Math.min(1, 256 / Math.max(img.width, img.height));
              c.width = Math.max(1, Math.round(img.width * scale));
              c.height = Math.max(1, Math.round(img.height * scale));
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              list.push(c.toDataURL('image/jpeg', 0.85));
              okCount++;
            } catch (e) {
              list.push(reader.result);
              okCount++;
            }
            done++;
            if (done === files.length) finish();
          };
          img.onerror = () => { done++; failCount++; if (done === files.length) finish(); };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      });
      function finish() {
        saveFn(list);
        rerender();
        if (okCount > 0 && failCount === 0) {
          toast('成功添加 ' + okCount + ' 张头像');
        } else if (okCount > 0 && failCount > 0) {
          toast('添加成功 ' + okCount + ' 张，失败 ' + failCount + ' 张');
        } else {
          toast('添加失败，请选择有效的图片文件');
        }
      }
    };
    // FIX 2026-09-18 #717：click 失败不再静默——部分机型上 click() 被策略拦截/抛错时给可见提示
    // FIX 2026-09-18 #738：原生 label 激活兜底——小米 MiuiBrowser 等对 JS 合成 click() 仍静默
    // 不弹选择器（#717 修复后小米17 Pro 实报）；透明 label 铺满按钮、内核原生转发激活 input
    if (window.mochiFilePickLabel) window.mochiFilePickLabel(btn, input);
    // FIX 2026-09-21 #1002（第九波续）：本按钮同时铺「真·可点 input」层——手指物理落在 input 上，
    // 选择器由浏览器原生默认动作弹出，不再依赖 label 转发 / JS 合成 click / showPicker 任何一条腿。
    // owner 指向本按钮自己的池选择器：surface 选完文件后转交它并派发 change，上面的压缩/落库管线
    // （listFn/saveFn/rerender/多张计数提示）一字未改照常跑。
    if (window.mochiFilePickSurface) {
      window.mochiFilePickSurface(btn, { id: input.id + '-tap', accept: 'image/*', multiple: true, owner: input });
    }
    btn.addEventListener('click', (e) => {
      // FIX 2026-09-18 #756：原 `if (fromLabel(e)) return;` 在「label 存在但国产内核不转发」
      // 时连 JS 兜底一并跳过＝用户报的「点了一点反应都没有」；改由 guard 事后确认真没弹出再补
      // FIX 2026-09-20 #920：兜底腿改走全站统一三腿（showPicker→click；小米系对合成 click 静默不弹）
      var _fb = () => { window.mochiFilePickFire(input, { onFail: () => toast('无法打开相册，请重试') }); };
      if (window.mochiFilePickGuard) window.mochiFilePickGuard(input, _fb);
      else _fb();
    });
  }
  bindPoolUpload(avUpload, getLib, saveLib, () => { renderGrid(); syncVal(); });
  bindPoolUpload(avMeUpload, getMeLib, saveMeLib, () => { renderMeGrid(); syncVal(); });
  // 添加昵称：**多行批量**，一行一个（用户反馈「添加昵称不能批量添加」）。
  // 走全站唯一弹窗方案的多行框——不用 prompt（安卓 IAB 无 prompt），也不自造弹层。
  // 安卓上这个 textarea 会被 mobile-adapt 转成 contenteditable 的 .ce-box，取值靠
  // personalize.js readModalVal 的多行兜底（按 DOM 结构还原换行），所以这里拿到的一定是
  // 带真实换行的整段文本；拆行对 \r\n / \r / \n 三种都兼容（粘贴来源可能是 Windows 记事本）。
  // 单条上限 30 字与聊天设置里改昵称的口径一致（那边靠 input maxlength 拦，多行框没有
  // 逐行 maxlength，所以这里按行截断，避免整行被无声丢弃）。
  // 查重：同名只留一条——昵称池的高亮/随机去重都按值比较，重复项会让「当前生效」
  // 高亮到两条、随机也更容易抽到同一个名字反复触发；同一批里的重复也一并挡下。
  function bindNickAdd(btn, listFn, saveFn, rerender) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('添加昵称', '', (v) => {
        // 拆行除 \r\n / \r / \n 外还要认 U+2028/U+2029（从网页、聊天记录整段复制常见）
        // 与 U+0085——只认 \n 的话这种粘贴会粘成「一条超长昵称」被截到 30 字。
        const raw = String(v || '').split(/\r\n|\r|\n|\u2028|\u2029|\u0085/);
        const lines = raw.map(cleanNick).filter(Boolean);
        // 剥掉零宽字符后为空的那些行如实计入「跳过」，不让用户看着粘了 5 行却只进了 3 条还找不到原因
        const blank = raw.length - lines.length;
        if (!lines.length) { toast('没有可添加的昵称（都是空行或只有不可见字符）'); return; }
        const list = listFn();
        let dup = 0;
        lines.forEach(n => { if (list.indexOf(n) >= 0) { dup++; return; } list.push(n); });
        const added = lines.length - dup;
        if (!added) { toast(dup > 1 ? '这 ' + dup + ' 个昵称都已经在池子里了' : '这个昵称已经在池子里了'); return; }
        saveFn(list);
        rerender();
        const tail = (dup ? '，' + dup + ' 个已存在' : '') + (blank ? '，跳过 ' + blank + ' 个空行' : '');
        if (dup || blank) toast('已添加 ' + added + ' 个昵称' + tail);
        else toast(added > 1 ? '已添加 ' + added + ' 个昵称' : '已添加昵称「' + lines[0] + '」');
      }, {
        textarea: true, textareaRows: 6,
        textareaPlaceholder: '一行一个昵称，可一次粘贴多个（每个最多 30 字）',
        staticText: '一行一个，空行会自动跳过；池子里已有的不会重复添加。'
      });
    });
  }
  bindNickAdd(avNickAdd, getNickLib, saveNickLib, renderNickGrid);
  bindNickAdd(avMeNickAdd, getMeNickLib, saveMeNickLib, renderMeNickGrid);
  // 清空（两个头像池共用）
  function bindPoolClear(btn, saveFn, rerender, title, okText) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (window.openModal) {
        window.openModal(title, '', () => {
          saveFn([]);
          rerender();
          toast(okText);
        }, { noInput: true });
      }
    });
  }
  bindPoolClear(avClear, saveLib, () => { renderGrid(); syncVal(); }, '清空头像池？', '已清空头像池');
  bindPoolClear(avMeClear, saveMeLib, () => { renderMeGrid(); syncVal(); }, '清空我的头像池？', '已清空我的头像池');
  bindPoolClear(avNickClear, saveNickLib, () => { renderNickGrid(); syncVal(); }, '清空昵称池？', '已清空昵称池');
  bindPoolClear(avMeNickClear, saveMeNickLib, () => { renderMeNickGrid(); syncVal(); }, '清空我的昵称池？', '已清空我的昵称池');

  // v3.12.x：联系人头像换头像不再写桌面键——setAvatarBoth/removeAvatarBoth 已随「桌面与聊天
  // 头像解耦」移除，所有路径只写聊天专用键 cs-avatar-partner（与我的头像 cs-avatar-user 同规则）。

  // 头像实时生效：聊天页顶部头像 + 桌面纪念日卡头像 + 已渲染的消息气泡头像
  // out=false 换联系人头像（.msg-in .msg-av 是"对方消息"旁的头像）；
  // out=true 换我的头像（.msg-out .msg-av 是我的消息旁的头像）
  // data 为空时恢复默认人物图标
  // v3.6.x：img 用属性赋值（dataURL 含引号时拼 innerHTML 会逃逸注入 HTML）
  function applyAvatarImg(data, out, chatOnly) {
    // FIX 2026-09-17 #662：新头像先离屏 decode 一次再落到整列节点——换一次头像会同时改
    //   顶栏 + 8~16 个气泡头像的 src（实测 15 次 src 赋值），不带预热时各节点各自等解码，
    //   低端机上是「整列头像一个个换/闪一下」；这里只预热位图缓存，不改 src、不新建节点、
    //   不阻塞本次赋值（fire-and-forget），失败也不影响任何行为。
    if (data) {
      try {
        const _warm = new Image();
        _warm.decoding = 'async';
        _warm.src = data;
        if (_warm.decode) { const _p = _warm.decode(); if (_p && _p.catch) _p.catch(function () {}); }
      } catch (e) {}
    }
    const chatAv = document.getElementById(out ? 'chat-user-av' : 'chat-partner-av');
    // v3.9.x：chatOnly=true 时只更新聊天域（顶部栏 + 消息气泡），不动桌面 deco-widget 头像——
    // TA 主动给我换头像 / 我在头像互动半框手动换"我的头像"都属聊天域，桌面头像独立
    const deskRing = chatOnly ? null : document.querySelector(out ? '#avatar-user .ring' : '#avatar-partner .ring');
    const applyTo = (el) => {
      if (!el) return;
      // FIX 2026-09-16 #617 头像「闪一下重新加载」（红米 K80 Chrome 等多机型，用户明说其他设备
      //   型号也有）：原实现无条件 el.innerHTML='' + 新建 img + 赋 src，于是「换一张头像」会把
      //   整列已渲染气泡头像（下方 forEach 的 .msg-in/.msg-out .msg-av）连同顶栏一起拆掉重建——
      //   旧节点先被清空（该位置空一帧）＋新节点从零解码 ⇒ 用户看到的「图片会闪和重新加载」。
      //   实测（无头 390×844，头像互动点第 3 张）：16 个 .msg-av 节点被替换、17 次 load。
      //   收口：值没变＝DOM 一律不碰（__avApplied 记录已落地的值）；值变了也只改现有 img 的 src，
      //   不拆节点——浏览器继续画旧图直到新图解好，不出现空帧。零机型分支、零视觉改动。
      const want = data || '';
      if (el.__avApplied === want) return;
      el.__avApplied = want;
      if (data) {
        const cur = el.querySelector('img');
        if (cur) { cur.src = data; cur.alt = ''; }
        else {
          const img = document.createElement('img');
          img.src = data;
          img.alt = '';
          el.innerHTML = '';
          el.appendChild(img);
        }
      } else {
        el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#999999" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>';
      }
    };
    applyTo(chatAv);
    applyTo(deskRing);
    document.querySelectorAll((out ? '.msg-out' : '.msg-in') + ' .msg-av').forEach(av => { applyTo(av); });
  }
  // 聊天里显示系统消息（chatAddSystem 会持久化，下次进聊天也能看到）
  // img：可选，消息里附带换的头像图片
  // keep（#616）：昵称类消息传 true —— 正文里带引号的昵称是**当时发生的事实**，
  // 要豁免 chat.js 的改名清扫（否则第二次改名后旧记录会被改写成「换成了当前名」，
  // 两条记录长得一模一样，用户报的「看不出换了什么昵称」会更严重）。
  function chatSystem(text, img, keep) {
    if (window.chatAddSystem) window.chatAddSystem(text, { img: img, nickKeep: !!keep });
    // 记录：换头像事件（写入主页「换头像记录」，含事件文案 + 头像缩略图）。
    // records.js 在 avatar-lib 之后加载，启动即触发的换头像可能赶不上
    // addAvatarRecord 定义 → 延迟到下一轮 tick 再补写
    if (window.addAvatarRecord) {
      window.addAvatarRecord(img, text);
    } else {
      setTimeout(function () {
        try { if (window.addAvatarRecord) window.addAvatarRecord(img, text); } catch (e) {}
      }, 600);
    }
  }
  // 聊天消息 + 黑色小字通知：换头像邀请的回应（消息带换的头像图片）
  // v3.6.x：不再弹白底可输入的 modal 弹窗——与头像互动其它通知一致，
  // 用 toast（黑色小字、发完自动关闭）
  function replyInvite(accepted, img) {
    const name = cPartnerName();
    const myName = cUserName();
    const text = accepted
      ? name + ' 同意了' + myName + '的换头像邀请'
      : name + ' 拒绝了' + myName + '的换头像邀请';
    chatSystem(text, img);
    toast(text);
  }
  // 手动点击头像库的图片：立即切换联系人的聊天头像
  // 有概率触发 TA 的回应（同意保持 / 拒绝换回），并重置随机更换计时
  // v3.12.x：只写聊天专用键 cs-avatar-partner，桌面 deco-widget 头像独立不变
  function switchAvatarFromLib(data) {
    const lib = getLib();
    if (!data || lib.indexOf(data) === -1) return;
    // 换回基准也取聊天键：原本没自定义过聊天头像（cs 为空）被拒绝时移除 cs 即回退桌面头像
    const before = store.get('cs-avatar-partner');
    // 邀请回应/计时随机数先同步按原顺序掷完（保持与旧实现相同的 Math.random 序列，
    // 回归工具会钉死序列），压缩回调里按预掷结果走分支
    const nextHours = String(1 + Math.random() * 7);
    const inviteHit = Math.random() * 100 < INVITE_PROB;
    const agreeHit = Math.random() * 100 < AGREE_PROB;
    // v3.14.x：写入前压缩（见 normalizeAvSize 注释），大图不再把 cs 键挤进 IDB-only 区
    normalizeAvSize(data, function (fit) {
      store.set('cs-avatar-partner', fit);
      applyAvatarImg(fit, false, true);
      noteApplied('partner', fit);
      // 手动更换后重置随机计时：1-8 小时后才可能再随机换（与星言一致）
      store.set('avatar-lib-last', String(Date.now()));
      store.set('avatar-lib-next', nextHours);
      store.set('avatar-lib-cur-hash', strHash(data));
      updateGridNow(); // FIX #508：库没变只换高亮，不整格重建（重渲=图片全部重新解码闪烁）
      if (inviteHit) {
        if (agreeHit) {
          replyInvite(true, fit); // 同意：头像保持新换的，消息带新头像图
        } else {
          // 拒绝：聊天头像换回原来那张（原本没自定义过聊天头像则恢复默认/桌面回退）
          if (before) { store.set('cs-avatar-partner', before); store.set('avatar-lib-cur-hash', strHash(before)); }
          else { store.remove('cs-avatar-partner'); store.remove('avatar-lib-cur-hash'); }
          applyAvatarImg(before || null, false, true);
          updateGridNow(); // FIX #508 同上
          noteApplied('partner', before || '');
          // 消息带的是「申请换的那张」头像图（联系人当前已换回原头像，但消息应展示申请换的那张）
          replyInvite(false, fit);
        }
      } else {
        // 直接切换成功：轻提示 + 聊天里显示"我的昵称 更换了 联系人昵称 的头像"+ 新头像图片
        toast('头像已切换');
        const name = cPartnerName();
        const myName = cUserName();
        chatSystem(myName + ' 更换了 ' + name + ' 的头像', fit);
      }
    });
  }

  // 手动点击我的头像库的图片：立即换成我的聊天头像（聊天系统消息 + 主页记录）
  // v3.9.x：头像互动半框是聊天域功能，只换聊天专用头像 cs-avatar-user，桌面 deco-widget 头像不变
  function switchMyAvatarFromLib(data) {
    const lib = getMeLib();
    if (!data || lib.indexOf(data) === -1) return;
    // v3.14.x：写入前压缩（见 normalizeAvSize 注释）
    normalizeAvSize(data, function (fit) {
      store.set('cs-avatar-user', fit);
      applyAvatarImg(fit, true, true);
      store.set('avatar-me-lib-cur-hash', strHash(data));
      updateMeGridNow(); // FIX #508：库没变只换高亮，不整格重建
      noteApplied('user', fit);
      toast('头像已更换');
      const myName = cUserName();
      chatSystem(myName + ' 更换了头像', fit);
    });
  }

  // TA 主动给我换头像：邀请回应文案（聊天消息 + toast）
  function replyMeInvite(accepted, data) {
    const name = cPartnerName();
    const myName = cUserName();
    const text = accepted
      ? myName + ' 同意了' + name + '的换头像邀请'
      : myName + ' 拒绝了' + name + '的换头像邀请';
    chatSystem(text, accepted ? data : null);
    toast(text);
  }
  // 弹窗邀请：带新头像预览，我同意则直接换上 / 拒绝则保持原样
  function showMeAvatarInvite(data) {
    const name = cPartnerName();
    window.openModal(name + ' 的换头像邀请', '', (v) => {
      if (v === '1') {
        // v3.9.x：TA 给我换头像只换聊天专用头像 cs-avatar-user，桌面头像不变
        // v3.14.x：写入前压缩（见 normalizeAvSize 注释）
        normalizeAvSize(data, function (fit) {
          store.set('cs-avatar-user', fit);
          applyAvatarImg(fit, true, true);
          store.set('avatar-me-lib-cur-hash', strHash(data));
          updateMeGridNow(); // FIX #508 同上
          noteApplied('user', fit);
          replyMeInvite(true, fit);
        });
      } else {
        replyMeInvite(false, null);
      }
    }, {
      noInput: true,
      // v3.6.x：锁定弹窗——点遮罩/取消都不关闭，必须点同意/拒绝
      lock: true,
      pills: [{ label: '同意', value: '1' }, { label: '拒绝', value: '0' }],
      pill: '1',
      staticText: name + ' 邀请你换上这张头像'
    });
    // 弹窗里附上新头像预览（openModal 只支持文字，预览图追加进 static 区）
    const se = document.getElementById('modal-static');
    if (se) {
      const img = document.createElement('img');
      img.src = data;
      img.alt = '';
      img.style.cssText = 'width:96px;height:96px;border-radius:50%;object-fit:cover;display:block;margin:10px auto;';
      se.appendChild(img);
    }
  }

  // ===== 周期认领复核（防「同一次到点被投递两遍」）=====
  // 四个 60 秒轮询的计时器键存在 localStorage，但每个上下文还各有一份 memoryCache（xyStore.get
  // 优先读它）＋各自独立的 setInterval。同一浏览器双开（PWA + 浏览器标签，本文件 convergeAvatars
  // 注释里点名的场景）时两侧在同一分钟都判「到点了」，各自往自己的 msgs 里加一条一模一样的系统
  // 消息再合并落盘＝用户实报的「联系人给我换头像，同时间触发了两次一模一样、两条挨在一起」。
  // chat.js #796 的 800ms 短闩只扫本侧 msgs，跨上下文拦不住；#776 的身份闸门按 ts 认亲，两侧
  // ts 不同＝判不出。
  // 认领判据＝推进周期之后裸读一次 localStorage（绕开本会话 memoryCache）复核：盘上不是自己刚
  // 写的那个值＝本周期已被另一个上下文先认领，调用方静默退出（不发消息、不换头像）。
  // 单上下文里 setItem 同步可读到自己的写入，故除双开竞态外零行为变化；LS 整体不可用
  // （隐私模式/配额满，值只进 memoryCache）时读回 null＝无从判定，按认领成功放行，不比改前更差。
  function avClaimCycle(key, now) {
    try {
      const p = window.activePrefix ? window.activePrefix() : uid;
      const raw = localStorage.getItem(p + ':' + key);
      return raw === null || raw === String(now);
    } catch (e) { return true; }
  }

  // 我的头像池定时换头像（触发概率/刷新机制与联系人主动换头像一致，计时独立）：
  // 每 60 秒轮询检查一次 + 启动时立即检查；
  // 上次/下次更换时间戳持久化（avatar-me-lib-last=0 / avatar-me-lib-next=0 初始值 → 首次加载立即触发），
  // 触发后 next = 1 + random*7 小时；刷新页面周期不重置；异常时间戳归零重试。
  // 触发时掷 INVITE_PROB：弹窗邀请我同意/拒绝，否则直接换上我的新头像
  function getMeAvatarLast() { const v = parseInt(store.get('avatar-me-lib-last'), 10); return isNaN(v) ? 0 : v; }
  function getMeAvatarNext() { const v = parseFloat(store.get('avatar-me-lib-next')); return isNaN(v) ? 0 : v; }
  function checkMeAvatarRefresh() {
    try {
      // v3.6.x：去掉 document.hidden return——后台时也检查换头像周期，
      // 到时间就换 + 写聊天消息 + 发后台通知（用户在后台也能收到系统通知）
      if (!getMeEnabled()) return;
      // #876 夜间静默：夜间到点不换、不推进周期，早上补发（见 avNightQuiet 注释）
      if (avNightQuiet()) return;
      const now = Date.now();
      let last = getMeAvatarLast();
      let next = getMeAvatarNext();
      // 异常时间戳 → 归零，下次检查立即触发
      if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
      if ((now - last) / 36e5 < next) return;
      const lib = getMeLib();
      if (!lib.length) return;
      const idx = Math.floor(Math.random() * lib.length);
      const data = lib[idx];
      if (!data) return;
      // 随机到当前头像：跳过不换，也不推进计时（60 秒后再随机一次）
      // v3.9.x：当前生效的是聊天专用头像 cs-avatar-user（未设时回退桌面头像 avatar-user）
      if (data === (store.get('cs-avatar-user') || store.get('avatar-user'))) return;
      // v3.14.x：同联系人池——比对上次已换入池图的哈希，防同一张大图重复触发
      const curMeHash = store.get('avatar-me-lib-cur-hash');
      if (curMeHash && strHash(data) === curMeHash) return;
      const invite = Math.random() * 100 < INVITE_PROB;
      if (invite) {
        // 已有其他弹窗打开时本次跳过（不推进计时，60 秒后再触发）
        const mask = document.getElementById('modal-mask');
        if (mask && !mask.hidden) return;
      }
      // 推进周期：下次 1-8 小时
      store.set('avatar-me-lib-last', String(now));
      store.set('avatar-me-lib-next', String(1 + Math.random() * 7));
      if (!avClaimCycle('avatar-me-lib-last', now)) return;
      if (invite) {
        showMeAvatarInvite(data);
        // v3.6.x：后台时弹窗不可见，发系统通知让用户知道有换头像邀请
        if (document.visibilityState === 'hidden' && window.bgNotifyCheck) {
          const iname = store.get('lbl-partner') || 'TA';
          window.bgNotifyCheck(iname + ' 想给你换头像', Date.now(), { name: iname, img: data });
        }
      } else {
        // 直接换：换上 + 聊天显示"昵称 更换了你的头像" + 新头像图片
        // v3.9.x：TA 给我换头像只换聊天专用头像 cs-avatar-user，桌面 deco-widget 头像不变
        // FIX #882：随机直换也要在**推进周期的同一同步点**记下「本次换入的是哪张池图」。旧实现
        // 只有「手动点图」（switchMyAvatarFromLib）与「邀请同意」两处写 cur-hash，最常走的直换路径
        // 漏写；而上方「随机到当前头像就跳过」的判据比的是**池内原图字节**，头像经 normalizeAvSize
        // 压缩落盘后再也不等于池内那条＝判据永久失效。于是同一张池图在后续周期被重新抽中时会被当
        // 新头像再换一次、再发一条一模一样的「更换了你的头像」。
        const trigHash = strHash(data);
        store.set('avatar-me-lib-cur-hash', trigHash);
        // v3.14.x：写入前压缩（见 normalizeAvSize 注释），保证 cs 键同步落 localStorage
        normalizeAvSize(data, function (fit) {
          store.set('cs-avatar-user', fit);
          applyAvatarImg(fit, true, true);
          updateMeGridNow(); // FIX #508 同上
          noteApplied('user', fit);
          const name = cPartnerName();
          const text = name + ' 更换了你的头像';
          chatSystem(text, fit);
          toast(text);
        });
      }
    } catch (e) {}
  }

  // 定时随机更换（与星言简约版机制一致）：
  // 每 60 秒轮询检查一次 + 启动时立即检查；
  // 上次/下次更换时间戳持久化（lastChange=0 / nextChange=0 初始值 → 首次加载立即换一次），
  // 换完后 nextChange = 1 + random*7 小时；刷新页面周期不重置；
  // 异常时间戳（未来/负数/NaN）归零，下次检查立即重试
  function getAvatarLast() { const v = parseInt(store.get('avatar-lib-last'), 10); return isNaN(v) ? 0 : v; }
  function getAvatarNext() { const v = parseFloat(store.get('avatar-lib-next')); return isNaN(v) ? 0 : v; }
  function checkAvatarLibRefresh() {
    try {
      // v3.6.x：去掉 document.hidden return——后台时也检查换头像周期，
      // 到时间就换 + 写聊天消息 + 发后台通知（时间未到时在 getLib 前 return，不解析头像池）
      if (!getEnabled()) return;
      // #876 夜间静默：夜间到点不换、不推进周期，早上补发（见 avNightQuiet 注释）
      if (avNightQuiet()) return;
      const now = Date.now();
      let last = getAvatarLast();
      let next = getAvatarNext();
      // 异常时间戳 → 归零，下次检查立即触发
      if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
      // v3.5.127：时间未到就先不解析头像池（原先每 60s 无条件 getLib() 全量解析）
      if ((now - last) / 36e5 < next) return;
      const lib = getLib();
      if (!lib.length) return;
      const idx = Math.floor(Math.random() * lib.length);
      const data = lib[idx];
      if (!data) return;
      // 随机到当前生效的聊天头像：跳过不换，也不推进计时（60 秒后再随机一次，与星言一致）
      // v3.12.x：当前生效的是聊天专用头像 cs-avatar-partner（未设时回退桌面头像 avatar-partner）
      if (data === (store.get('cs-avatar-partner') || store.get('avatar-partner'))) return;
      // v3.14.x：当前值可能已被压缩落盘（与池内原图字节不同）——再比对上次已换入池图的哈希，
      // 防止同一张大图被反复选中时重复发「更换了头像」系统消息
      const curHash = store.get('avatar-lib-cur-hash');
      if (curHash && strHash(data) === curHash) return;
      // v3.14.x：先推进周期再异步压缩——压缩要等 Image 解码（异步），若等回调再推进，
      // 60 秒轮询可能在窗口期重复触发换头像
      store.set('avatar-lib-last', String(now));
      store.set('avatar-lib-next', String(1 + Math.random() * 7));
      // FIX #882：认领复核（双开上下文各发一条一模一样的消息）＋触发点记 cur-hash。
      // 旧实现 cur-hash 只在「手动点图/邀请回滚」两处写，随机直换漏写，而上方「随机到当前
      // 头像就跳过」比的是池内原图字节，压缩落盘后再也不等＝同一张池图后续周期被重抽中时
      // 原样再换一次、再发一条一模一样的「更换了头像」。
      if (!avClaimCycle('avatar-lib-last', now)) return;
      const trigHash = strHash(data);
      store.set('avatar-lib-cur-hash', trigHash);
      // v3.12.x：随机换头像只写聊天专用键 cs-avatar-partner，桌面 deco-widget 头像独立不变
      // v3.14.x：写入前压缩（见 normalizeAvSize 注释），保证 cs 键同步落 localStorage
      normalizeAvSize(data, function (fit) {
        store.set('cs-avatar-partner', fit);
        applyAvatarImg(fit, false, true);
        updateGridNow(); // FIX #508：定时随机换同样只换高亮（半框开着时不再整格闪烁）
        noteApplied('partner', fit);
        // 聊天里显示"昵称 更换了头像" + 新头像图片
        chatSystem(cPartnerName() + ' 更换了头像', fit);
        // v3.5.153：换头像后补发后台通知——确保后台收到的通知右侧是新头像
        //（v3.12.x 头像不再写桌面键 avatar-partner，通知右侧头像用 extra.av 显式传新聊天头像；
        //  这里显式触发一条，避免只有聊天系统消息、后台用户没感知到换头像）
        try {
          if (window.bgNotifyCheck) {
            window.bgNotifyCheck((store.get('lbl-partner') || 'TA') + ' 更换了头像', Date.now(), { name: store.get('lbl-partner') || 'TA', av: fit });
          }
        } catch (e) {}
      });
    } catch (e) {}
  }
  // 每 60 秒轮询一次 + 启动立即检查（首次加载立即换一次）
  try { setInterval(checkAvatarLibRefresh, 60000); } catch (e) {}
  checkAvatarLibRefresh();
  try { setInterval(checkMeAvatarRefresh, 60000); } catch (e) {}
  checkMeAvatarRefresh();

  // ===== 昵称池业务逻辑（2026-09-16）=====
  // 与头像池逐条对齐：点击即换 + 有概率触发 TA 回应（同意/拒绝）+ 定时随机更换 +
  // TA 主动给我换（直接换或弹窗邀请）。四个池子的概率/周期常量复用同一组，仅存储键独立。
  //
  // 关键差异（为什么昵称不能照抄头像的写入路径）：换头像只改 cs-avatar-*，不牵动任何文案；
  // 换昵称改的是全站到处在引用的显示名，必须额外走 chat.js 的改名钩子
  //（chatSysNickChanged：把历史系统消息里的旧昵称清扫成 {ta} 占位符，渲染时替换成当前昵称），
  // 否则改完名聊天记录里旧消息还叫旧名字（与聊天设置里改昵称的行为保持一致）。
  function applyPartnerNick(name) {
    // FIX 2026-09-18 #775e：旧名取「聊天里实际显示的值」（chatPartnerName 现含名片名回退），
    // 只看 cs-lbl-partner 会拿 'TA' 去扫、屏上旧名片名扫不掉
    const oldEff = window.chatPartnerName ? window.chatPartnerName() : (store.get('cs-lbl-partner') || 'TA');
    if (name) store.set('cs-lbl-partner', name); else store.remove('cs-lbl-partner');
    const newEff = window.chatPartnerName ? window.chatPartnerName() : (store.get('cs-lbl-partner') || 'TA');
    if (oldEff !== newEff) {
      try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff); } catch (e) {}
    }
    try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
    syncVal();
  }
  // 我的昵称：#775c 起 chat.js 已有 {me} 侧清扫（chatSysNickChanged(old, 'me')），
  // 与联系人侧同规格——历史里字面写死的旧「我的」昵称扫成 {me} 占位符，渲染时取新名
  function applyMyNick(name) {
    const oldEff = store.get('cs-lbl-user') || '我';
    if (name) store.set('cs-lbl-user', name); else store.remove('cs-lbl-user');
    const newEff = store.get('cs-lbl-user') || '我';
    if (oldEff !== newEff) {
      try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff, 'me'); } catch (e) {}
    }
    try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
    syncVal();
  }
  // 系统消息文案统一口径（#616 用户反馈「系统消息没有显示联系人更换了什么昵称」）：
  // 每条都必须写清「谁把谁的昵称换成了什么」——只写「XX 更换了昵称」时，主语本身是换后的
  // 新昵称，用户既看不出换成了什么，也分不清这条说的是联系人还是自己（「我的昵称库」那条
  // 尤其容易被读成「联系人改名了」，而顶栏显示的是联系人的名字、当然不会变）。
  // 引号里的昵称走 keep=true 豁免改名清扫，历史记录保持当时的事实。
  // 注：这类消息仍按普通系统消息渲染（special='poke'），正文里的「TA」会被 renderMsg 的
  // pokePersonMap 回填成当前昵称（所以写"TA 把…"读起来就是"{当前名} 把…"）；被引号包住的
  // 昵称若恰好含 TA/ta/他/她 这几个 token 仍会被该回填改写——与全站其它系统消息同一口径
  // （现有通话/红包/寻踪等消息都如此），本次不收窄，避免为病态昵称扩大 chat.js 改动面。
  function nickMsgPartner(to) { return 'TA 把聊天昵称换成了「' + to + '」'; }
  function nickMsgMeSet(to) { return '我把 TA 的聊天昵称换成了「' + to + '」'; }
  function nickMsgMeSelf(to) { return '我把自己的聊天昵称换成了「' + to + '」'; }
  function nickMsgTaSetMine(to) { return 'TA 把我的聊天昵称换成了「' + to + '」'; }

  // 换昵称的回应文案（对齐头像池 replyInvite：聊天消息 + 黑色小字 toast）
  // 「换成了「X」」里的 X 取**实际生效值**（先参数、参数无效则回落到键里已写入的值），
  // 二者都取不到时整句去掉引号从句——绝不让空引号「」出现在用户面前（#616 用户报障）。
  function replyNickInvite(accepted, name) {
    const to = String(name || store.get('cs-lbl-partner') || '');
    const text = accepted
      ? (to ? 'TA 同意了我的换昵称邀请，昵称换成了「' + to + '」' : 'TA 同意了我的换昵称邀请')
      : 'TA 拒绝了我的换昵称邀请，昵称保持不变';
    chatSystem(text, null, true);
    toast(text);
  }
  // 用户要求（2026-09-16）：「我同意了 TA 的换昵称邀请…」这条**不再弹黑色小字**——
  // 同意/拒绝是用户自己刚在弹窗里点的，聊天里又已落了记录，再弹一次只是噪音。
  // （另一条 replyNickInvite 保留 toast：那是 TA 对我点选昵称的随机回应，是我没预期到的信息）
  function replyMeNickInvite(accepted, name) {
    const to = String(name || store.get('cs-lbl-user') || '');
    const text = accepted
      ? (to ? '我同意了 TA 的换昵称邀请，我的昵称换成了「' + to + '」' : '我同意了 TA 的换昵称邀请')
      : '我拒绝了 TA 的换昵称邀请，昵称保持不变';
    chatSystem(text, null, true);
  }
  // 手动点击 TA 的昵称池：立即换聊天昵称（cs-lbl-partner）
  // 有概率触发 TA 的回应（同意保持 / 拒绝保持原样），并重置随机更换计时
  function switchNickFromLib(name) {
    const lib = getNickLib();
    if (!name || lib.indexOf(name) === -1) return;
    const before = store.get('cs-lbl-partner');
    // 邀请回应/计时随机数先同步按原顺序掷完（与头像池同序，回归脚本可钉死序列）
    const nextHours = String(1 + Math.random() * 7);
    const inviteHit = Math.random() * 100 < INVITE_PROB;
    const agreeHit = Math.random() * 100 < AGREE_PROB;
    // 手动更换后重置随机计时：1-8 小时后才可能再随机换
    store.set('nick-lib-last', String(Date.now()));
    store.set('nick-lib-next', nextHours);
    if (inviteHit && !agreeHit) {
      // 拒绝：昵称保持原样。与头像池「先写再回滚」等价——不写就没有回滚，少一次多余的重渲染。
      // cur-hash 记回当前实际生效值，避免随机计时立刻把同一条再抽一次。
      store.set('nick-lib-cur-hash', strHash(before || ''));
      updateNickGridNow();
      replyNickInvite(false);
      return;
    }
    applyPartnerNick(name);
    store.set('nick-lib-cur-hash', strHash(name));
    updateNickGridNow();
    if (inviteHit) replyNickInvite(true, name);
    else { toast('昵称已切换'); chatSystem(nickMsgMeSet(name), null, true); }
  }
  // 手动点击我的昵称池：立即把我的聊天昵称换成这条（cs-lbl-user）
  function switchMyNickFromLib(name) {
    const lib = getMeNickLib();
    if (!name || lib.indexOf(name) === -1) return;
    applyMyNick(name);
    store.set('nick-me-lib-cur-hash', strHash(name));
    updateMeNickGridNow();
    toast('昵称已更换');
    chatSystem(nickMsgMeSelf(name), null, true);
  }
  // TA 主动给我换昵称：弹窗邀请（带新昵称预览，我同意则换上 / 拒绝则保持原样）
  function showMeNickInvite(name) {
    if (!window.openModal) return;
    // 空昵称不发邀请：脏数据（历史遗留的零宽条目）不该弹出一个「邀请你换上这个昵称」却
    // 什么都不显示的锁定弹窗——那是个点不掉又没内容的死局
    name = cleanNick(name);
    if (!name) return;
    const ta = cPartnerName();
    window.openModal(ta + ' 的换昵称邀请', '', (v) => {
      if (v === '1') {
        applyMyNick(name);
        store.set('nick-me-lib-cur-hash', strHash(name));
        updateMeNickGridNow();
        replyMeNickInvite(true, name);
      } else {
        replyMeNickInvite(false);
      }
    }, {
      noInput: true,
      // 与换头像邀请同款锁定弹窗——点遮罩/取消都不关闭，必须点同意/拒绝
      lock: true,
      pills: [{ label: '同意', value: '1' }, { label: '拒绝', value: '0' }],
      pill: '1',
      staticText: ta + ' 邀请你换上这个昵称'
    });
    // 弹窗里附上新昵称预览（openModal 只支持文字，预览追加进 static 区）
    const se = document.getElementById('modal-static');
    if (se) {
      const p = document.createElement('div');
      p.textContent = name;
      p.style.cssText = 'font-size:20px;font-weight:700;text-align:center;margin:10px 0 2px;word-break:break-all;';
      se.appendChild(p);
    }
  }
  // 我的昵称池定时更换（机制/概率与联系人随机换昵称一致，计时独立）
  function getMeNickLast() { const v = parseInt(store.get('nick-me-lib-last'), 10); return isNaN(v) ? 0 : v; }
  function getMeNickNext() { const v = parseFloat(store.get('nick-me-lib-next')); return isNaN(v) ? 0 : v; }
  function checkMeNickRefresh() {
    try {
      // 与头像池一致：不判断 document.hidden——后台也照常检查，到点就换 + 写聊天消息 +
      // 发后台通知（前台时 bgNotifyCheck 自己会跳过发送）
      if (!getMeNickEnabled()) return;
      // #876 夜间静默：夜间到点不换、不推进周期，早上补发（见 avNightQuiet 注释）
      if (avNightQuiet()) return;
      const now = Date.now();
      let last = getMeNickLast();
      let next = getMeNickNext();
      // 异常时间戳 → 归零，下次检查立即触发
      if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
      if ((now - last) / 36e5 < next) return;
      const lib = getMeNickLib();
      if (!lib.length) return;
      const name = lib[Math.floor(Math.random() * lib.length)];
      if (!name) return;
      // 随机到当前昵称：跳过不换，也不推进计时（60 秒后再随机一次）
      if (name === curMyNick()) return;
      const curHash = store.get('nick-me-lib-cur-hash');
      if (curHash && strHash(name) === curHash) return;
      const invite = Math.random() * 100 < INVITE_PROB;
      if (invite) {
        // 已有其他弹窗打开时本次跳过（不推进计时，60 秒后再触发）
        const mask = document.getElementById('modal-mask');
        if (mask && !mask.hidden) return;
      }
      // 推进周期：下次 1-8 小时
      store.set('nick-me-lib-last', String(now));
      store.set('nick-me-lib-next', String(1 + Math.random() * 7));
      if (!avClaimCycle('nick-me-lib-last', now)) return; // FIX #882：同头像池口径，双开上下文只留先认领的一方
      if (invite) {
        showMeNickInvite(name);
        // 后台时弹窗不可见，发系统通知让用户知道有换昵称邀请
        if (document.visibilityState === 'hidden' && window.bgNotifyCheck) {
          const iname = store.get('lbl-partner') || 'TA';
          window.bgNotifyCheck(iname + ' 想给你换昵称', Date.now(), { name: iname });
        }
      } else {
        applyMyNick(name);
        store.set('nick-me-lib-cur-hash', strHash(name));
        updateMeNickGridNow();
        const text = nickMsgTaSetMine(name);
        chatSystem(text, null, true);
        toast(text);
      }
    } catch (e) {}
  }
  // 联系人昵称池定时随机更换：每 60 秒轮询 + 启动立即检查；
  // 上次/下次时间戳持久化（last=0 / next=0 初始值 → 首次加载立即换一次），
  // 换完后 next = 1 + random*7 小时；刷新页面周期不重置；异常时间戳归零重试。
  function getNickLast() { const v = parseInt(store.get('nick-lib-last'), 10); return isNaN(v) ? 0 : v; }
  function getNickNext() { const v = parseFloat(store.get('nick-lib-next')); return isNaN(v) ? 0 : v; }
  function checkNickLibRefresh() {
    try {
      if (!getNickEnabled()) return;
      // #876 夜间静默：夜间到点不换、不推进周期，早上补发（见 avNightQuiet 注释）
      if (avNightQuiet()) return;
      const now = Date.now();
      let last = getNickLast();
      let next = getNickNext();
      if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
      // 时间未到就先不解析昵称池
      if ((now - last) / 36e5 < next) return;
      const lib = getNickLib();
      if (!lib.length) return;
      const name = lib[Math.floor(Math.random() * lib.length)];
      if (!name) return;
      // 随机到当前生效的聊天昵称：跳过不换，也不推进计时
      if (name === curPartnerNick()) return;
      // 与头像池同口径：再比对上次已换入池条目的哈希，防同一条被反复选中时重复发系统消息
      const curHash = store.get('nick-lib-cur-hash');
      if (curHash && strHash(name) === curHash) return;
      store.set('nick-lib-last', String(now));
      store.set('nick-lib-next', String(1 + Math.random() * 7));
      if (!avClaimCycle('nick-lib-last', now)) return; // FIX #882：同头像池口径，双开上下文只留先认领的一方
      applyPartnerNick(name);
      store.set('nick-lib-cur-hash', strHash(name));
      updateNickGridNow();
      // 聊天里写明「TA 把聊天昵称换成了「XXX」」+ 补发后台通知（发送者名取换后的新昵称）
      const text = nickMsgPartner(name);
      chatSystem(text, null, true);
      try {
        if (window.bgNotifyCheck) window.bgNotifyCheck(text, Date.now(), { name: cPartnerName() });
      } catch (e) {}
    } catch (e) {}
  }
  try { setInterval(checkNickLibRefresh, 60000); } catch (e) {}
  checkNickLibRefresh();
  try { setInterval(checkMeNickRefresh, 60000); } catch (e) {}
  checkMeNickRefresh();

  syncAvPane();
  // v3.5.93：头像池大键（图片 dataURL）可能只存在 IndexedDB（导入兜底写入/运行时大键策略），
  // localStorage 读不到 → 启动时从 IDB 补读进内存缓存；半框是打开时才渲染的，届时自然读到
  // v3.9.x：① 发起时捕获 myPrefix，回调校验桌面归属——否则慢 IDB（OPPO Chrome）迟到回调
  // 会用动态 store 把旧桌面头像池写进新桌面（同 mail.js 3c6196a 串桌面修复）；
  // ② 仅当本地缺失或 IDB 内容更多才覆盖——否则用户刚上传的新头像会被启动时读到的
  // 旧 IDB 值覆盖，表现为「头像互动里上传的头像丢失」；
  // ③ 慢 IDB 首次读到空值延迟重试（防头像池整组消失）。
  function restoreLib(key) {
    if (!window.idbGet) return;
    const myPrefix = window.activePrefix();
    let retry = 0;
    function tryOnce() {
      window.idbGet(myPrefix + ':' + key).then(v => {
        if (window.activePrefix() !== myPrefix) return; // 已切桌面，作废
        if (!v || typeof v !== 'string' || v.length <= 2) {
          if (retry < 3) { retry++; setTimeout(tryOnce, 800 * retry); }
          return;
        }
        try {
          const idbArr = JSON.parse(v);
          let localArr = null;
          try { localArr = JSON.parse(store.get(key) || 'null'); } catch (e) {}
          const localLen = Array.isArray(localArr) ? localArr.length : -1;
          if (localLen < 0 || (Array.isArray(idbArr) && idbArr.length > localLen)) {
            store.set(key, v);
            refreshAvGrids(); // FIX #509：回填后用「库没变不重建」口径刷新，避免整格重建再闪一次
          }
        } catch (e) { store.set(key, v); refreshAvGrids(); }
      });
    }
    tryOnce();
  }
  try { restoreLib('avatar-lib'); } catch (e) {}
  try { restoreLib('avatar-me-lib'); } catch (e) {}
  try { restoreLib('nick-lib'); } catch (e) {}
  try { restoreLib('nick-me-lib'); } catch (e) {}
})();
