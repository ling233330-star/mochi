// ===== 功能：朋友圈（仿星言简约版【星言朋友圈】，矢量图简约风格） =====
// 朋友圈形态：封面 + 我的头像；TA 自动发动态；我可发布；
// 每条动态：发布者头像/昵称/时间/内容 + 点赞列表 + 评论区（可回复）
// TA 会点赞/评论我的动态；我点赞/评论后 TA 有概率回应
(function () {
  const uid = 'xy-home-v2';
  const store = window.xyStore(uid);
  // v3.13.x：根键滞留回收——contacts.js EXCLUDE 生效前，migrateLegacy 曾把 feed-* 根键
  // 当旧顶层业务键迁进 default: 并删根键（首次迁移；其后 default 已有副本时每次刷新
  // 连迁移都不做直接删根键）→ 朋友圈通知列表/未读角标/双方朋友圈昵称头像/封面每次
  // 刷新全丢（用户反馈：联系人回复我朋友圈评论没有提示）。这里把仍滞留在 default: 的
  // 副本一次性搬回根命名空间（根键已有值不覆盖，搬完删副本），幂等；等 restore-done
  // 后跑（大键已从 IDB 回填再搬，避免读到空）。EXCLUDE 已补，此后不会再产生新滞留。
  (function feedRootRescue() {
    // v3.25.x：feed-last/feed-next/feed-day-count 不在此列——它们是【按联系人桌面】
    // 独立存取的 TA 发帖调度状态（见 deskSchedRescue 与 maybeAutoPostFor），不是全局共享键
    // #232：身份/封面六键（cover-bg/ta-cover/ta-name/ta-avatar/user-name/user-avatar）同样
    // 不在此列了——v3.8.x 朋友圈好友列表起它们已改【按联系人桌面】独立存取（所有读取方
    // per-cid 优先、根键只是旧版全局回退），default 命名空间里的值是现行数据而非滞留残留。
    // 旧逻辑「根键有值就删 default 副本」把用户编辑后的朋友圈头像/昵称/封面在每次启动时
    // 删回旧全局值（红米 Note12 Turbo Chrome 报「保存后刷新恢复初始」，多机型同发），且
    // 首次刷新还会把 per-cid 值搬上根键，从此每次编辑都活不过下一次刷新。六键改走下方
    // DESK_KEYS 收养式回收：per-cid 有值一律不动；per-cid 为空且根键还有旧全局值时才收养
    // 进 default（收养前向 IDB 三态确认 per-cid 真的没有值——>200KB 大值只存 IDB，
    // def.get 看不到 ≠ 不存在，贸然收养会用旧全局值盖掉它），根键保留作回退，幂等。
    const KEYS = ['feed-notices', 'feed-app-unread'];
    const DESK_KEYS = ['feed-cover-bg', 'feed-ta-cover', 'feed-ta-name', 'feed-ta-avatar', 'feed-user-name', 'feed-user-avatar'];
    function run() {
      try {
        const root = window.xyStore('xy-home-v2');
        const def = window.xyStore('xy-home-v2:default');
        KEYS.forEach(function (k) {
          let rv = null;
          try { rv = root.get(k); } catch (e) {}
          if (rv !== null && rv !== undefined && rv !== '') { try { def.remove(k); } catch (e) {} return; }
          let dv = null;
          try { dv = def.get(k); } catch (e) {}
          if (dv !== null && dv !== undefined && dv !== '') {
            try { root.set(k, dv); } catch (e) {}
            try { def.remove(k); } catch (e) {}
          }
        });
        DESK_KEYS.forEach(function (k) {
          let dv = null;
          try { dv = def.get(k); } catch (e) {}
          if (dv !== null && dv !== undefined && dv !== '') return; // per-cid 现行值：绝不动更不删（#232 根因）
          let rv = null;
          try { rv = root.get(k); } catch (e) {}
          if (rv === null || rv === undefined || rv === '') return;
          // 收养旧全局值前先向 IDB 确认 default 桌面确实没有该键（三态：false=没有才收养；
          // true=大值在 IDB 只是 def.get 看不到 / null=探测失败，都保守跳过，下次刷新再试）
          try {
            window.idbHasKey('xy-home-v2:default:' + k).then(function (has) {
              if (has === false) { try { def.set(k, rv); } catch (e) {} }
            }).catch(function () {});
          } catch (e) {}
        });
        // v3.25.x：TA 发帖调度键反向归位（修复用户反馈「回复设置里设了联系人每天最多发
        // N 条朋友圈，联系人照样无限发」）——上面 KEYS 的回收逻辑曾把 default 桌面命名
        // 空间里的这三个键当滞留旧键搬去根键并删本地副本（根键已有值时更是直接删副本），
        // 而它们自 v3.7.x 起只按 storeFor(cid) 存取、根命名空间没有任何读取方 →
        // 主联系人的「今日已发条数 + 上次发帖时间 + 下次间隔」每次刷新清零，日上限和
        // 发帖间隔对 default 桌面完全失效（其他联系人桌面正常，表现为「只有默认桌面的
        // TA 无限发」）。改为一次性归位：default 缺值时把根键历史值搬回 default，随后
        // 删根键（无读取方，留着只会被反复回收），幂等。
        (function deskSchedRescue() {
          const today = feedToday();
          ['feed-last', 'feed-next', 'feed-day-count'].forEach(function (k) {
            let rv = null, dv = null;
            try { rv = root.get(k); } catch (e) {}
            if (rv === null || rv === undefined || rv === '') return;
            try { dv = def.get(k); } catch (e) {}
            if (dv === null || dv === undefined || dv === '') {
              try { def.set(k, rv); } catch (e) {}
            } else if (k === 'feed-day-count') {
              // 两边都有值 = 归位前 default 已被本轮调度写过一条——保守取「今天已发条数」
              // 较大者（宁多少发，不可无限重发）；非今天的陈旧根键值直接丢弃
              try {
                const ro = JSON.parse(rv), dfo = JSON.parse(dv);
                const rn = ro && ro.t === today ? (ro.n || 0) : -1;
                const dn = dfo && dfo.t === today ? (dfo.n || 0) : -1;
                if (rn > dn) def.set(k, rv);
              } catch (e) {}
            } else if (k === 'feed-last') {
              // 上次发帖时间取更近的一次（feed-next 与该时间配对，保留 default 现用值）
              try { if (parseFloat(rv) > parseFloat(dv)) def.set(k, rv); } catch (e) {}
            }
            try { root.remove(k); } catch (e) {}
          });
        })();
        try { renderNoticeBadge(); } catch (e) {}
      } catch (e) {}
    }
    if (window.__mochiDataReady) { run(); return; }
    try {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        run();
      });
    } catch (e) {}
  })();
  const KEY = 'feed-posts';
  // v3.7.x：LS 剥图快照兜底——主键 >200KB（含图片 dataURL）时 xyStore 只进
  // IndexedDB + 内存缓存（LS 5MB 配额保护），Edge 等浏览器杀后台/强制关闭会丢
  // IndexedDB 数据（WORKLOG 有 vivo S16 Edge 实录），届时动态只剩聊天里的系统
  // 消息、朋友圈空空如也。与聊天记录 writeLsSnapshot 同策略：剥掉图片/头像
  // dataURL 只保文本，写一份 ≤200KB 的 LS 快照（必须 ≤200KB——超过会被 idb.js
  // 的大键迁移搬进 IDB 删 LS，本处直接读 LS 就读不到了；快照是全局数据，放
  // default 命名空间防 contacts.js migrateLegacy 迁移成 default:default:* 垃圾键）。
  const SNAP_KEY = 'feed-posts-snap';
  const LS_BIG_LIMIT = 200 * 1024;
  function maxPostTs(arr) { return (Array.isArray(arr) ? arr : []).reduce((m, p) => (p && p.ts > m ? p.ts : m), 0); }
  function loadSnap() {
    try {
      const v = localStorage.getItem('xy-home-v2:default:' + SNAP_KEY);
      if (v) { const a = JSON.parse(v); if (Array.isArray(a)) return a; }
    } catch (e) {}
    return [];
  }
  // FIX 2026-09-17 #667 快照只剥「大体积」的图片本体（dataURL），保留媒体池令牌 @@m:hash：
  //   令牌只有 44 字符、不占快照预算，却能随时从池里解回真图。旧实现连令牌一起换成
  //   「[图片]」文字——一旦权威键读不到（大键只在 IDB、Edge 杀后台/IDB 挂起、LS 被清），
  //   这份剥图快照就成了渲染与写回的来源，评论区 TA 的表情包/图片就永久退化成「[图片]」
  //   两个字（多机型反复报障：聊天里正常、朋友圈评论只剩图字）。渲染端 inlineBody 与
  //   媒体池观察器本就认令牌（#386），保留它不引入新形态。
  const SNAP_MEDIA_RE = /data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+/g;
  function stripMediaBody(s) { return String(s == null ? '' : s).replace(SNAP_MEDIA_RE, '[图片]'); }
  // 剥图：动态/评论/回复里的图片 dataURL 换占位文本，头像清空（快照只保文本历史）
  function stripPostImg(p) {
    if (!p || typeof p !== 'object') return p;
    const c = Object.assign({}, p);
    if (Array.isArray(c.imgs)) c.imgs = [];
    c.authorAv = '';
    c.taAv = '';
    if (typeof c.content === 'string') {
      c.content = stripMediaBody(c.content);
      if (c.content.length > 8192) c.content = c.content.slice(0, 8192) + '…';
    }
    if (Array.isArray(c.comments)) {
      c.comments = c.comments.map(co => {
        if (!co || typeof co !== 'object') return co;
        const cc = Object.assign({}, co);
        if (typeof cc.content === 'string') {
          cc.content = stripMediaBody(cc.content);
          if (cc.content.length > 8192) cc.content = cc.content.slice(0, 8192) + '…';
        }
        if (Array.isArray(cc.replies)) {
          cc.replies = cc.replies.map(r => {
            if (!r || typeof r !== 'object') return r;
            const rr = Object.assign({}, r);
            if (typeof rr.content === 'string') {
              rr.content = stripMediaBody(rr.content);
              if (rr.content.length > 8192) rr.content = rr.content.slice(0, 8192) + '…';
            }
            return rr;
          });
        }
        return cc;
      });
    }
    return c;
  }
  // v3.7.x：多桌面修正——昵称/头像一律读当前联系人桌面（activeStore），
  // 原实现读模块顶部缓存的顶层 store（xy-home-v2 旧键），迁移后旧键已清 → 全空/旧值
  function partnerName() { return window.activeStore().get('lbl-partner') || 'TA'; }
  function partnerAv() { return window.activeStore().get('avatar-partner') || ''; }
  function myName() { return window.activeStore().get('lbl-user') || '我'; }
  function myAv() { return window.activeStore().get('avatar-user') || ''; }
  // v3.7.x：跨桌面——TA 身份按「动态所属桌面(owner)」取头像/昵称快照回退，
  // 朋友圈全局共享后，联系人2的动态在联系人1桌面必须显示联系人2的头像
  // v3.7.x 修复（用户反馈"朋友圈统一显示 TA"）：原实现 owner==='default' 时 s=null，
  //   回退 partnerAv()/partnerName()（当前激活桌面）——从 default 桌面打开朋友圈时
  //   所有动态都显示 default 桌面的 TA 头像/昵称，而非各动态所属桌面的。改为始终
  //   按 owner 桌面取（含 default），owner 桌面没设过才回退 'TA'/''，绝不串到当前桌面。
  function taAvFor(owner) {
    try {
      const o = owner || 'default';
      const s = window.storeFor(o);
      // v3.20.x：与 taFeedAv()/feedAllStore 渲染保持一致——default 联系人的朋友圈 TA
      // 头像历史标准归属是根命名空间 store，storeFor('default') 读「default 桌面」会取不到，
      // 导致「联系人发送朋友圈」的通知弹窗右侧不显示发布者头像（用户反馈）。未取到且为
      // default 时补根键回退；非 default 联系人仍只读各自桌面，不串头像。
      // v3.27.x：补读聊天专用键 cs-avatar-partner（v3.12.x 起换头像只写该键，桌面
      // avatar-partner 独立不再跟随）——否则发布者如只在聊天里换过头像，此处分取不到，
      // 后台通知会回退成当前桌面联系人头像（用户反馈：通知头像显示成当前桌面的 TA）。
      let v = s.get('feed-ta-avatar') || s.get('avatar-partner') || s.get('cs-avatar-partner') || '';
      if (!v && o === 'default') v = store.get('feed-ta-avatar') || store.get('avatar-partner') || store.get('cs-avatar-partner') || '';
      if (v && typeof v === 'string' && v.length > 500 * 1024) return '';
      return v || '';
    } catch (e) { return ''; }
  }
  // v3.7.x：跨桌面——TA 昵称同样按动态所属桌面取（旧数据缺 authorName/taName 快照时的回退）
  function taFeedNameFor(owner) {
    try {
      const o = owner || 'default';
      const s = window.storeFor(o);
      // v3.20.x：与 taFeedName() 一致补根键回退（default 联系人昵称历史在根命名空间）
      let v = s.get('feed-ta-name') || s.get('lbl-partner') || '';
      if (!v && o === 'default') v = store.get('feed-ta-name') || store.get('lbl-partner') || '';
      if (v) return v;
      // 回退：该联系人的注册名（联系人管理里设的名字），避免 lbl-partner 空时显示"TA"
      if (window.getContacts) {
        const c = window.getContacts().find(x => x.id === o);
        if (c && c.name) return c.name;
      }
      return 'TA';
    } catch (e) { return 'TA'; }
  }
  // ===== 多联系人：发布者身份快照（owner=联系人cid，role=me/ta） =====
  function activeMe() {
    const s = window.activeStore();
    // v3.8.x：发布动态的身份 = 朋友圈独立身份（feed-user-name/feed-user-avatar），回退聊天身份
    return { role: 'me', owner: window.__activeCid || 'default', authorName: s.get('feed-user-name') || s.get('lbl-user') || '我', authorAv: s.get('feed-user-avatar') || s.get('avatar-user') || '' };
  }
  function taAuthorOf(p) {
    // v3.7.x：旧数据缺 taName 快照时，回退按动态所属桌面取 TA 昵称/头像
    return { role: 'ta', owner: p.owner || 'default', authorName: p.taName || taFeedNameFor(p.owner || 'default'), authorAv: p.taAv || taAvFor(p.owner || 'default') };
  }
  // v3.7.x：按「指定联系人桌面」取 TA 身份——用户发布动态后所有桌面的 TA 都可能
  // 评论/回复，评论作者身份必须用评论者自己的桌面（不是动态所属桌面）
  function taAuthorOfCid(cid) {
    const o = cid || 'default';
    return { role: 'ta', owner: o, authorName: taFeedNameFor(o), authorAv: taAvFor(o) };
  }
  // v3.10.x：评论/回复不存 authorAv（头像 dataURL）——与 publish() 同策略。
  //   commentsHtmlFor 只用 authorName+content 渲染，authorAv 从不被读取；
  //   存了会把主键撑到 >200KB → 只进 IDB 不进 LS → Edge 丢 IDB 后评论丢失
  //   （OPPO Edge 修改头像/背景后评论发不显示的根因）。
  function stampAuthor(obj, a) { obj.role = a.role; obj.owner = a.owner; obj.authorName = a.authorName; obj.authorAv = ''; return obj; }
  // v3.8.x：我在朋友圈的独立身份（可独立于聊天设置），按桌面独立存储，回退聊天身份
  // feed-user-name / feed-user-avatar：朋友圈昵称/头像，未设置时回退该桌面聊天昵称/头像
  function feedUserAvFor(owner) {
    try {
      const o = owner || 'default';
      const st = window.storeFor(o);
      let v = st.get('feed-user-avatar') || st.get('avatar-user') || '';
      if (v && typeof v === 'string' && v.length > 500 * 1024) return '';
      return v || '';
    } catch (e) { return ''; }
  }
  function feedUserNameFor(owner) {
    try {
      const o = owner || 'default';
      const st = window.storeFor(o);
      return st.get('feed-user-name') || st.get('lbl-user') || '我';
    } catch (e) { return '我'; }
  }
  function feedUserName() { return window.activeStore().get('feed-user-name') || store.get('feed-user-name') || myName(); }
  function feedUserAv() {
    const s = window.activeStore();
    let v = s.get('feed-user-avatar') || store.get('feed-user-avatar') || myAv();
    if (v && typeof v === 'string' && v.length > 500 * 1024) return '';
    return v || '';
  }
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  function fmtDT(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function normPost(p) {
    if (p.by && !p.role) { p.role = p.by; if (!p.owner) p.owner = 'default'; }
    // v3.20.x：评论/回复去重——历史数据（iOS 键盘/重复触发等）可能把同一内容重复入库，
    //   load() 若不合并，评论区每条评论就会显示成两条（两端重复）。按 ts+身份+作者+内容
    //   精确去重，仅折叠完全相同的重复副本；不同评论不受影响。merge 路径已有 deeperList，
    //   这里补上常规 load/render 路径，任何来源的重复都被消除。
    const dedupArrBy = (arr, keyFn) => {
      if (!Array.isArray(arr)) return arr;
      const seen = {}, out = [];
      for (let i = 0; i < arr.length; i++) {
        const o = arr[i];
        if (!o || typeof o !== 'object') { out.push(o); continue; }
        const k = keyFn(o);
        if (k != null && seen[k]) continue;
        if (k != null) seen[k] = 1;
        out.push(o);
      }
      return out;
    };
    if (Array.isArray(p.comments)) {
      p.comments = dedupArrBy(p.comments, c => (c && c.ts ? c.ts : 0) + '|' + (c.role || c.by || '') + '|' + (c.authorName || '') + '|' + (c.content || ''));
      for (let i = 0; i < p.comments.length; i++) {
        const c = p.comments[i];
        if (c && Array.isArray(c.replies)) {
          c.replies = dedupArrBy(c.replies, r => (r && r.ts ? r.ts : 0) + '|' + (r.role || r.by || '') + '|' + (r.authorName || '') + '|' + (r.content || ''));
        }
      }
    }
    return p;
  }
  // v3.7.x：feedDbReady 门槛——对齐 mail.js mailDbReady。Edge/OPPO 上 IndexedDB 打开/
  //   读取慢或挂起时，启动早期 store.get(KEY) 返回 null（大键不在 LS、memoryCache 未回填）、
  //   快照也缺失 → load() 返回 []。此时任何 save（maybeAutoPost 定时器/用户发布/点赞）都会
  //   用空或单条覆盖 IDB 里的全部旧动态 → 「关掉 Edge 重开就丢」。门槛：权威未从 IDB 读回前，
  //   save 只暂存内存（feedPending），绝不落盘；load 合并暂存，弹窗提示过的动态都可见。
  let feedDbReady = false;
  let feedPending = null;
  // #496 内存真相层：save() 时同步持有最新已解析列表，load() 直接取用——
  //   原实现每次评论/点赞/发布都 load() 整包 JSON.parse（兆级主键＝点击帧长任务），
  //   与 save 的整包 stringify 同帧叠加成一对长任务。feedMem 只在本会话内存，
  //   持久层语义不变（flush 时仍整包写 LS/IDB 三路同拍）；feedMergeFromIdb 合并写回时同步刷新。
  let feedMem = null;
  // #187 权威键守卫——iPad QQ浏览器/WKWebView 系（iOS 挂后台杀 IDB 连接家族）首发
  //   idbGet 4s+4s 超时返回 undefined，与「键不存在」不可分；此时 feed-posts >200KB
  //   只进 IDB（LS 无副本、回填未到）→ load() 手上只有剥图快照。旧代码三条写回路径
  //  （feedMergeFromIdb 合并写回 / save 非空直写 / 15s 保险丝 load 写回）都会把这个
  //   无图版本整包写进权威键：图片从数据层永久消失，之后 IDB 恢复也救不回（用户实报
  //   iPad QQ浏览器朋友圈只剩文字不显示图片，页内无任何 img 加载错误＝img 没渲染出来）。
  //   守则：本会话读到过权威数据（feedAuthSeen，含清空后的 '[]'）或 LS/内存缓存里已有
  //   权威副本（store.get(KEY) 非空＝回填已完成）→ 照常写；否则 idbHasKey 探测——
  //   确认存在＝绝不写回（本次增量留内存 pending + 剥图快照文本兜底，10s 后重读权威），
  //   确认不存在（全新安装/丢库重建）＝放心写（保住原「并集保数据」行为）；探测失败
  //  （null＝存储繁忙）按存在处理：宁丢本次增量，不毁权威历史。
  let feedAuthSeen = false;
  let feedAuthWritable = null;   // null=未探测；true=确认可写（权威键确实不存在）；false=权威仍在
  let feedAuthRetried = 0;       // 守卫拒写后的权威重读次数上限 2（间隔 10s，防病理存储下无限循环）
  function feedGuardWrite(raw) {
    if (feedAuthSeen || store.get(KEY) !== null) {
      try { store.set(KEY, raw); } catch (e) {}
      return Promise.resolve(true);
    }
    if (!window.idbHasKey) { try { store.set(KEY, raw); } catch (e) {} return Promise.resolve(true); }
    if (feedAuthWritable === null) feedAuthWritable = window.idbHasKey(uid + ':' + KEY).then(ok => ok === false);
    return feedAuthWritable.then(writable => {
      if (writable) { try { store.set(KEY, raw); } catch (e) {} }
      return writable;
    });
  }
  // v3.10.x 修复「评论聊了多个回合次日只剩一条」：同 id 动态深度合并。
  //   原实现 post 级后者整条覆盖——启动权威回读 feedMergeFromIdb 里本地副本（LS 主键/
  //   剥图快照）优先级高于 IDB，而本地副本可能陈旧：主键 >200KB 时只进 IDB 不进 LS，
  //   剥图快照超 200KB 会静默停写冻结在旧时刻，iOS 还可能在存储压力下清 LS 键——
  //   陈旧本地版本整条盖掉 IDB 里带全部后续评论的新版本并随即写回 IDB，旧评论永久丢失。
  //   改为字段择优 + 评论/回复/点赞按内容并集，任一侧的新数据都不再被整条挤掉。
  // v3.26.x：剥图回填——itemKey 不含 content。朋友圈数据超 200KB 时 LS 快照会把评论/回复
  //   里的图片 dataURL 剥成 [图片]（stripPostImg），而 IDB 里是完整版；原 key 含 content
  //   导致【同一条】被当成两条合并并存（一条缩略图、一条 [图片] 文字），用户反馈
  //   「回复有时是表情包缩略图、有时只剩 图片 两个字」。改为按 ts+作者 收敛为同一条，
  //   并入时优先保留含真实 data:image 的那版（删掉剥图占位）。
  function itemKey(o) { return (o && o.ts ? o.ts : 0) + '|' + (o.role || o.by || '') + '|' + (o.authorName || ''); }
  // FIX 2026-09-17 #667 媒体身份判定（合并择优用）：dataURL 或媒体池令牌。令牌要在「整串」
  //   与「图文混排」两种形态下都认得出——旧实现用整串令牌判定（mochiMediaIsToken），
  //   「好可爱 @@m:hash」这种混排评论被判成「没有图」，剥图快照那版（内容是 [图片] 文字）
  //   就被当成并列版本留下，图永远回不来（纯图评论那条路 v3.26.x 已修，混排是漏网口；
  //   字卡库经 #554 令牌化后，混排已是朋友圈评论的常态形态）。
  function hasMediaBody(s) {
    const t = String(s == null ? '' : s);
    return /data:image\//.test(t) || /@@m:[0-9a-f]{32}/.test(t);
  }
  function deeperList(a, b) {
    const byKey = {};
    const put = (o) => {
      if (!o || typeof o !== 'object') return;
      const k = itemKey(o);
      const prev = byKey[k];
      if (!prev) { byKey[k] = Object.assign({}, o); return; }
      if (Array.isArray(o.replies) && o.replies.length) prev.replies = deeperList(prev.replies || [], o.replies);
      else if (!Array.isArray(prev.replies) && Array.isArray(o.replies)) prev.replies = o.replies;
      const prevImg = hasMediaBody(prev.content);
      const oImg = hasMediaBody(o.content);
      if (!prevImg && oImg) prev.content = o.content;
    };
    (a || []).forEach(put);
    (b || []).forEach(put);
    return Object.keys(byKey).map(k => byKey[k]).sort((x, y) => (x.ts || 0) - (y.ts || 0));
  }
  function unionStrArr(a, b) {
    const out = [], seen = {};
    (a || []).concat(b || []).forEach(s => { if (typeof s === 'string' && !seen[s]) { seen[s] = 1; out.push(s); } });
    return out;
  }
  function deepMergePost(a, b) {
    const newer = (b.ts || 0) >= (a.ts || 0) ? b : a;
    const older = newer === a ? b : a;
    const out = Object.assign({}, older, newer);
    // 剥图快照侧 content 内联图被换成 [图片]、imgs/头像被清空——取未剥图的完整版
    // FIX 2026-09-17 #667 与评论/回复同款择优：含媒体的那一版优先（两侧同为有图/同为无图
    //   时退回原「长度更长」口径），避免剥图版把正文里的图换成「[图片]」文字后被留下。
    const oMedia = hasMediaBody(older.content), nMedia = hasMediaBody(newer.content);
    if (oMedia !== nMedia ? oMedia : (older.content || '').length > (newer.content || '').length) out.content = older.content;
    out.imgs = (newer.imgs && newer.imgs.length) ? newer.imgs : (older.imgs || []);
    if (!out.authorAv && older.authorAv) out.authorAv = older.authorAv;
    if (!out.taAv && older.taAv) out.taAv = older.taAv;
    out.likes = unionStrArr(older.likes, newer.likes);
    out.comments = deeperList(older.comments, newer.comments);
    return out;
  }
  // 按 id 合并两个动态列表（同 id 深度合并，见 deepMergePost），按 ts 倒序
  function mergePosts(a, b) {
    const map = {};
    const put = p => { if (p && p.id) map[p.id] = map[p.id] ? deepMergePost(map[p.id], p) : p; };
    (a || []).forEach(put);
    (b || []).forEach(put);
    return Object.keys(map).map(k => map[k]).sort((x, y) => (y.ts || 0) - (x.ts || 0));
  }
  function load() {
    // #496：本会话已有内存真相（save 持有/feedMergeFromIdb 刷新）→ 直接取用，
    //   不再每次整包 JSON.parse（兆级主键的点击帧长任务）；首次进入仍读持久层。
    let list = [];
    if (feedMem) {
      list = feedMem;
    } else {
    // 主键存在（含清空后的 '[]'）→ 直接用它；键缺失（null）才走剥图快照兜底——
    // 原写法 `store.get(KEY) || '[]'` 在键缺失时返回空数组提前 return，快照兜底永不生效
    const raw = store.get(KEY);
    if (raw !== null) {
      try {
        const a = JSON.parse(raw);
        if (Array.isArray(a)) list = a.map(normPost);
      } catch (e) {}
    }
    // v3.7.x：LS 主键缺失兜底——大列表只进 IDB（Edge 丢 IDB / LS 被清）时读剥图快照，
    // 文本+作者+时间保留；IDB 存活时模块底部 idbGet 会随后用完整数据重渲染
    if (!list.length) {
      try {
        const v = loadSnap();
        if (v.length) list = v.map(normPost);
      } catch (e) {}
    }
    }
    // v3.7.x：权威读取（feedDbReady=false）期间收到的动态只暂存在 feedPending，原 load()
    //   只读持久层 → 弹窗/通知提示了新动态、朋友圈列表却是空白（OPPO Edge IDB 慢时复现）；
    //   这里把暂存动态按 id 合并在持久层之上，提示过的一切动态都可见可赞可评。
    //   #187：去掉 !feedDbReady 前置——守卫拒写（权威键仍在、本次只是读超时）时暂存不落盘，
    //   就绪后也必须继续合并渲染（mergePosts 按 id 去重，不会重复显示）。
    if (feedPending && feedPending.length) {
      list = mergePosts(list, feedPending);
    }
    return list;
  }
  // v3.8.x：写剥图快照（原实现仅主键 >200KB 时写）——Edge 丢 IDB 后，主键若也写 LS
  //   失败（配额满/被清），剥图快照（更小，剥掉图片/头像 dataURL 只保文本）是最后兜底。
  //   快照限制 ≤200KB，防被 idb.js 大键迁移搬走（迁移只认 LS 键不认命名空间）。
  //   抽成独立函数：预就绪落盘时也复用，保证评论/动态在任何阶段都有持久兜底。
  function persistSnap(arr) {
    try {
      const items = arr.map(stripPostImg);
      // v3.10.x：只做一次全量序列化——原实现先 stringify 探大小、结尾再 stringify 一次
      //   （超限裁剪时循环里还逐条 stringify），每次评论/点赞都多付 1~2 次兆级序列化
      let snap = JSON.stringify(items);
      // v3.10.x：剥图后仍超 200KB 时按新→旧裁剪动态数——原实现直接静默跳过，
      //   快照从此冻结在旧时刻不再更新，之后每次重启权威合并都用它盖掉 IDB 新评论
      //   （丢评论根因之一）；裁剪保证快照始终可写、始终含最新动态
      if (snap.length > LS_BIG_LIMIT) {
        const sorted = items.slice().sort((x, y) => (y.ts || 0) - (x.ts || 0));
        let budget = LS_BIG_LIMIT - 2;
        const keep = [];
        for (let i = 0; i < sorted.length; i++) {
          const cost = JSON.stringify(sorted[i]).length + 1;
          if (budget - cost < 0) break;
          budget -= cost;
          keep.push(sorted[i]);
        }
        snap = JSON.stringify(keep);
      }
      if (snap.length <= LS_BIG_LIMIT) localStorage.setItem('xy-home-v2:default:' + SNAP_KEY, snap);
    } catch (e) {}
  }
  // v3.42.x 点赞卡顿：persistSnap 每次全量 stringify 兆级动态（剥图版），与 save 主键的
  //   全量 stringify 同帧叠加＝点赞/评论一次两个长任务（手机端数百 ms，整页跟着卡）。
  //   快照只是 IDB/LS 丢失后的兜底，改 800ms 尾随合并落盘：连续点赞/评论只付一次；
  //   pagehide/切后台强制刷盘保兜底时效；主键 feedGuardWrite 仍即时写，不受影响。
  let snapTimer = null, snapPending = null;
  function flushSnap() {
    if (!snapTimer) return;
    clearTimeout(snapTimer); snapTimer = null;
    if (snapPending) { try { persistSnap(snapPending); } catch (e) {} snapPending = null; }
  }
  function scheduleSnap(arr) {
    snapPending = arr;
    if (snapTimer) return;
    // FIX 2026-09-17 #667 去抖回调不再先清 snapTimer：flushSnap 头部以 snapTimer 判活
    //   （`if (!snapTimer) return;`），旧写法回调里先置空＝进 flushSnap 立即空返回，
    //   800ms 尾随落盘整条失效——快照只在切后台/离页（pagehide/visibilitychange）才更新，
    //   常年停在旧时刻。而这份陈旧的剥图快照正是「[图片]」占位的载体（#667 主因），
    //   越晚刷新越久地遮住完整内容。flushSnap 自己会 clearTimeout + 置空，重复无害。
    snapTimer = setTimeout(() => { flushSnap(); }, 800);
  }
  try {
    window.addEventListener('pagehide', function () { flushFeedWrite(); flushSnap(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushFeedWrite(); flushSnap(); } });
  } catch (e) {}
  // #496 评论/点赞卡顿止血（对齐 chat.js v3.26.x 已验证模式）：主键落盘改「合并 + 低频 +
  //   空闲窗口」——原实现点击帧同步付整包 JSON.stringify + store.set（LS 同步写/IDB 事务）
  //   ＝发评论/点赞一次数百 ms~秒级长任务（v3.42 只摘掉了快照那一次，主键仍即时写）。
  //   数据语义不变（仍写整包最新；feedMem 保 load() 即时可见），pagehide/切后台强制兜底。
  const FEED_WRITE_MIN_GAP = 2500;   // 两次实际落盘的最小间隔（ms）
  let feedWriteTimer = null;         // 排队中标记（rIdle/timeout）
  let feedWritePending = null;       // 待落盘的最新整包（尾随合并，只留最新）
  let lastFeedWriteAt = 0;           // 上次实际落盘时间（performance.now()）
  function runFeedWrite() {
    feedWriteTimer = null;
    const arr = feedWritePending;
    if (!arr) return;
    const wait = FEED_WRITE_MIN_GAP - (performance.now() - lastFeedWriteAt);
    // FIX 2026-09-19 #845e 节流等待分支不得提前清槽：旧写法开头就把 feedWritePending 置空，
    //   命中等待时只重排了定时器——手里这一整包没人写、重排到点的那一轮读到空槽直接 return，
    //   这次落盘静默丢失（pagehide 兜底读的也是这个空槽，救不回）。表现为「刚贴的贴纸/刚点的
    //   赞刷新就没了」（与 chat.js #828e 同形状）。等待期间槽位保持原值，由重排那一轮写掉。
    if (wait > 0) { feedWriteTimer = setTimeout(runFeedWrite, wait); return; }
    feedWritePending = null;
    try { feedGuardWrite(JSON.stringify(arr)); scheduleSnap(arr); lastFeedWriteAt = performance.now(); } catch (e) {}
  }
  function scheduleFeedWrite(arr) {
    feedWritePending = arr;
    if (feedWriteTimer) return;
    if (window.requestIdleCallback) feedWriteTimer = window.requestIdleCallback(runFeedWrite, { timeout: 4000 });
    else feedWriteTimer = setTimeout(runFeedWrite, 2500);
  }
  // 强制兜底（pagehide/切后台/清空）：立即落盘待写整包（迟到的 runFeedWrite 见空即退）
  function flushFeedWrite() {
    const arr = feedWritePending;
    feedWritePending = null;
    feedWriteTimer = null;
    if (arr) { try { feedGuardWrite(JSON.stringify(arr)); scheduleSnap(arr); lastFeedWriteAt = performance.now(); } catch (e) {} }
  }
  function save(list) {
    const arr = list || [];
    // #496：内存真相立即生效（load() 不再重读持久层），落盘延后到空闲窗口
    feedMem = arr;
    // v3.10.x：清理存量评论/回复的 authorAv（旧数据存了头像 dataURL，撑大主键 >200KB
    //   → 只进 IDB 不进 LS → Edge 丢 IDB 后评论丢失）。新评论经 stampAuthor 已不存。
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p || !Array.isArray(p.comments)) continue;
      for (let j = 0; j < p.comments.length; j++) {
        const c = p.comments[j];
        if (c && c.authorAv) c.authorAv = '';
        if (c && Array.isArray(c.replies)) for (let k = 0; k < c.replies.length; k++) { if (c.replies[k] && c.replies[k].authorAv) c.replies[k].authorAv = ''; }
      }
    }
    // v3.7.x：门槛——权威未从 IDB 读回前只暂存内存，绝不落盘（防 save([]) 覆盖 IDB 旧动态）
    if (!feedDbReady) {
      try { feedPending = arr.slice(); } catch (e) {}
      // v3.8.x：权威未就绪（iOS/Edge 上 IndexedDB 打开读取慢或挂起时该窗口可达 15s）
      //   刚发的评论/动态若只暂存内存 feedPending，一旦本应稍后落盘的异步合并或
      //   保险丝失败，或用户在期间刷新页面/被系统回收，评论就永久丢了（用户反馈：
      //   评论先显示后消失、刷新后也回不来）。这里对【非空】数据也立即走 store.set(LS/
      //   IDB 大键分流 + 内存) 与快照落盘。只写非空，不会重演旧的「save([]) 用空值
      //   覆盖 IDB 旧动态」问题；IDB 合并是并集，稍后回填也不会丢。
      if (arr.length) {
        feedGuardWrite(JSON.stringify(arr));
        persistSnap(arr);
      }
      return;
    }
    // 清空时同步清掉旧快照（防清空后又被陈旧快照"恢复"出已删除的动态）——即时写，不走延后
    if (!arr.length) {
      feedWritePending = null;
      feedGuardWrite('[]');
      try { localStorage.removeItem('xy-home-v2:default:' + SNAP_KEY); } catch (e) {}
      if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; snapPending = null; }
      return;
    }
    scheduleFeedWrite(arr);
    scheduleSnap(arr);
  }
  function avHtml(data, cls) {
    const c = cls || 'feed-av';
    return data
      ? '<div class="' + c + '"><img src="' + attrEsc(data) + '" alt=""></div>'
      : '<div class="' + c + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg></div>';
  }
  const TA_COMMENT_POOL = ['收到啦~', '我看到了！', '这条动态好可爱', '记住啦', '我也是这么想的', '嗯嗯，说得对'];

  // ---- TA 内容素材池：调用聊天字卡库（主字卡/颜文字/emoji/表情包/图片），缺省用内置池 ----
  function cardPool(cid) {
    const cards = cid ? (window.getCustomCardsFor ? window.getCustomCardsFor(cid) : []) : ((window.getCustomCards && window.getCustomCards()) || []);
    const pokeSet = (function () {
      const pk = cid ? (window.getPokeCardsFor ? window.getPokeCardsFor(cid) : []) : ((window.getPokeCards && window.getPokeCards()) || []);
      return pk.length ? new Set(pk) : null;
    })();
    const text = [], kaomoji = [], emoji = [];
    // v3.11.x：只收 dataURL 媒体——朋友圈配图会把图片拼进正文文本（data:image 正则
    // 识别内联），链接导入的 http(s) 字卡进来只会显示成一段 URL 文字，先过滤掉
    // FIX 2026-09-13 #386 媒体池令牌卡也是媒体载荷（渲染端 inlineBody/图片网格已认 @@m:hash）
    const onlyData = (arr) => (arr || []).filter(s => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))));
    const mediaSticker = onlyData(cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'sticker') : []) : ((window.getMediaCards && window.getMediaCards('sticker')) || []));
    const mediaImage = onlyData(cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'image') : []) : ((window.getMediaCards && window.getMediaCards('image')) || []));
    cards.forEach(c => {
      if (pokeSet && pokeSet.has(c)) return;
      if (typeof c === 'string' && c.indexOf('data:') === 0) return; // dataURL 已按媒体分类
      // v3.6.x：语音字卡（文件名|||audio;base64）不以 data: 开头，需单独丢弃——
      //   否则整段音频 base64 会被当文字拼进朋友圈正文/评论
      if (typeof c === 'string' && c.indexOf('|||') >= 0) return;
      // FIX 2026-09-13 #386 裸 @@m:hash 令牌卡不进文字池（与 chat.js getPool #383 同款第三道守卫）
      if (c && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return;
      // FIX 2026-09-15 #533 同款第四道守卫：链接导入的媒体字卡（裸 http(s) 图链）是图片
      // 载荷不是文字，进池会被拼进朋友圈动态/评论正文（与 chat.js getPool / mail.js 同批修复）
      if (/^https?:\/\//i.test(c)) return; // 图链卡不进朋友圈文字池
      if (/[\uD800-\uDBFF]/.test(c) || /^[😀-🙏🌀-🫿]/u.test(c)) emoji.push(c);
      else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) kaomoji.push(c);
      else text.push(c);
    });
    // v3.7.x：默认字卡补池——TA 发动态/评论素材不足时用系统默认字卡补，
    //   受「朋友圈使用」场景开关控制（聊天默认字卡-设置页可关闭）
    // v3.8.x：分类开关——已关闭的默认字卡分类不参与补池
    // v3.12.x：三处对齐聊天页语义——
    //   ① 开关按【该联系人桌面】读（defaultCardApiFor(storeFor(cid))）：某联系人桌面
    //      关「朋友圈使用」→ 只有这个联系人的动态/评论不用默认字卡；
    //   ② main 去掉「自定义为空才补」门——加了公用/专属字卡后 text 永远非空，
    //      4621 张默认字卡从此不参与（用户反馈：朋友圈只会用自定义字卡）。
    //      开启即始终混入（同 chat.js getPool / 群聊 gcPool）；
    //   ③ 补上单卡开关过滤（此前朋友圈漏过滤 dc-off-*）+ 总开关 dc-enabled 检查
    try {
      const st = (cid && window.storeFor) ? window.storeFor(cid) : null;
      const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
      const useFeed = a ? a.use('feed') : (window.defaultCardUse ? window.defaultCardUse('feed') : true);
      const en = a ? a.enabled() : ((window.defaultCardCfg && window.defaultCardCfg().enabled) !== false);
      // v3.28.x：朋友圈使用概率——读 dc-overall-feed（未设置=100，维持「始终混入」历史行为；
      //   用户可在默认字卡设置页单独调低朋友圈默认字卡占比）
      let feedOverall = 100;
      try { const fv = st ? st.get('dc-overall-feed') : null; if (fv !== null) feedOverall = Math.max(0, Math.min(100, Number(fv))); } catch (e) {}
      if (en && useFeed && Math.random() * 100 < feedOverall && window.getDefaultCardGroups) {
        const gd = window.getDefaultCardGroups;
        const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
        const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
        if (catOn('main')) (gd('main') || []).forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('main', c)) return; if (typeof c === 'string' && c) text.push(c); }));
        if (catOn('kaomoji') && !kaomoji.length) (gd('kaomoji') || []).forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('kaomoji', c)) return; if (typeof c === 'string' && c) kaomoji.push(c); }));
        if (catOn('emoji') && !emoji.length) (gd('emoji') || []).forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('emoji', c)) return; if (typeof c === 'string' && c) emoji.push(c); }));
      }
    } catch (e) {}
    // v3.36.x：词典朋友圈混入——词典独立页「朋友圈使用」开启时，按「朋友圈使用概率」
    //   把一条词典语录并进动态/评论文案池（dictQuoteOne 自带分类/单卡开关过滤；
    //   池空或场景关=不混，默认概率 30%）。独立于默认字卡的 dc-enabled 总闸。
    try {
      if (window.dictUse && window.dictUse('feed') && window.dictQuoteOne
          && Math.random() * 100 < (window.dictOverall ? window.dictOverall('feed') : 30)) {
        const dq = window.dictQuoteOne();
        if (dq) text.push(dq);
      }
    } catch (eDictFeed) {}
    // FIX 2026-09-15 #534 朋友圈内容类型总开关（设置→回复设置→朋友圈「内容类型开关」）：
    //   关闭的类型在这里【整体清池】——生成器全是「池非空才抽」的写法，清池即该类型在
    //   朋友圈彻底消失，不可能被任何一条路径绕过。修前只有「TA 发布内容类型」概率管得住
    //   TA 发动态；TA 评论/回复走 pickReplyContent 把颜文字/emoji 写死 15%、表情包/图片走
    //   「使用表情包概率」，用户在朋友圈把颜文字与表情包关掉后评论里照样出现（多机型同报）。
    //   开关按【该联系人桌面】读（与 feedCfgFor 同口径：各联系人朋友圈设置独立），
    //   缺省（键不存在）＝开，存量用户行为不变。零机型分支＝纯设置读取。
    if (!feedTypeOn(cid, 'kaomoji')) kaomoji.length = 0;
    if (!feedTypeOn(cid, 'emoji')) emoji.length = 0;
    if (!feedTypeOn(cid, 'sticker')) mediaSticker.length = 0;
    if (!feedTypeOn(cid, 'image')) mediaImage.length = 0;
    return { text: text, kaomoji: kaomoji, emoji: emoji, sticker: mediaSticker, image: mediaImage };
  }
  // #534：朋友圈某内容类型是否启用（读该联系人桌面的 reply-fd-<kind>-en；缺失＝开）。
  //   kind ∈ kaomoji | emoji | sticker | image。与 chat.js/mail.js 的场景开关同读法：
  //   存储键统一 reply- 前缀 + 当前桌面命名空间，避免「设置页关了、生成端读别处」。
  function feedTypeOn(cid, kind) {
    try {
      const s = window.storeFor ? window.storeFor(cid || 'default') : null;
      if (!s) return true;
      const v = s.get('reply-fd-' + kind + '-en');
      return v === null || v === undefined || v === '' ? true : Number(v) !== 0;
    } catch (e) { return true; }
  }
  // v3.6.x：完整 HTML 转义（昵称/评论/点赞列表/分组名是用户输入，直拼 innerHTML 可注入）
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function attrEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // 图文混排正文渲染（与聊天一致）：data:image 段 → 内联图片，其余文字保留空格
  // v3.x.x：称呼跟随——文字段按动态所属联系人(owner cid)在显示层替换 TA/他
  // v3.26.x：独立附图识别——表情包/图片既支持 base64 dataURL，也支持 svg 类非 base64
  //   的 dataURL 与带 sticker:/image: 前缀的外链图（与聊天附件同批字卡这里也按缩略图
  //   渲染，解决「聊天正常、朋友圈/评论表情包只显示图片文字」）。无附图前缀的 http
  //   链接仍当普通文本（避免把正文里的网址误当图片）。用 replace 一次成稿，避免
  //   大量 dataURL 逐段 exec 的重复解码。
  function inlineBody(s, cid) {
    const str = String(s || '');
    const fitSeg = (seg) => {
      seg = String(seg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return (cid && window.taFit) ? window.taFit(seg, cid) : seg;
    };
    const RE = /((?:sticker|image):)?(https?:\/\/[^\s"'<>]+|@@m:[0-9a-f]{32}|data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+)/g;
    return str.replace(RE, function (all, pre, src) {
      if (src.indexOf('http') === 0 && pre !== 'sticker:' && pre !== 'image:') {
        return fitSeg(all); // 普通网址（无附图前缀）按文本保留
      }
      return '<img class="feed-inline-img" src="' + attrEsc(src) + '" alt="表情">';
    });
  }
  // 无重复抽取器：同一轮生成内不重复抽同一张卡（池子抽完一轮后重新洗牌再继续），
  // 修复小字卡池下同一条动态/评论连续重复同一张卡（如「爱你爱你爱你…」）
  function makePicker(arr) {
    const a = arr.slice();
    let i = a.length;
    return function () {
      if (i >= a.length) {
        for (let j = a.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          const t = a[j]; a[j] = a[k]; a[k] = t;
        }
        i = 0;
      }
      return a[i++];
    };
  }
  function uniqArr(arr) {
    const seen = new Set(); const out = [];
    arr.forEach(x => { if (!seen.has(x)) { seen.add(x); out.push(x); } });
    return out;
  }
  // 图文混排生成器：主字卡/颜文字/emoji/表情包/图片 全 5 类，每张卡是一块内容（图片/表情包即 1 个字卡）
  // opts: { kaoP, emoP, stP, imP, imgP } —— 各类别每卡出现概率（0~100，直接取回复设置数值）；
  //       imgP 为表情包+图片合并概率（评论/回复用「使用表情包概率」fd-image-prob）
  // v3.6.x：cid 指定用该联系人桌面的字卡（朋友圈 TA 评论/回复/动态都用所属桌面字卡）
  // v3.6.x：各分类字卡去重 + 无重复抽取（同轮不抽同一张卡），修复小池内容大量重复
  function genMixedCards(cfg, minN, maxN, opts, cid) {
    const o = opts || {};
    const pool = cardPool(cid);
    const fb = uniqArr(TA_COMMENT_POOL.concat(TA_REPLY_POOL));
    const pick = {
      image: makePicker(uniqArr(pool.image)),
      sticker: makePicker(uniqArr(pool.sticker)),
      si: makePicker(uniqArr(pool.sticker.concat(pool.image))),
      emoji: makePicker(uniqArr(pool.emoji)),
      kaomoji: makePicker(uniqArr(pool.kaomoji)),
      text: makePicker(uniqArr(pool.text)),
      fb: makePicker(fb)
    };
    const n = minN + Math.floor(Math.random() * Math.max(1, maxN - minN + 1));
    const parts = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 100;
      let pushed = false;
      if (o.imP > 0 && pool.image.length && r < o.imP) { parts.push(pick.image()); pushed = true; }
      if (!pushed && o.stP > 0 && pool.sticker.length && r < o.stP) { parts.push(pick.sticker()); pushed = true; }
      if (!pushed && o.imgP > 0 && (pool.sticker.length || pool.image.length) && r < o.imgP) { parts.push(pick.si()); pushed = true; }
      if (!pushed && o.emoP > 0 && pool.emoji.length && r < o.emoP) { parts.push(pick.emoji()); pushed = true; }
      if (!pushed && o.kaoP > 0 && pool.kaomoji.length && r < o.kaoP) { parts.push(pick.kaomoji()); pushed = true; }
      if (!pushed) parts.push(pool.text.length ? pick.text() : pick.fb());
    }
    return parts.join(' ');
  }
  // v3.5.94：TA 发布动态专用生成器——文字（主字卡/颜文字/emoji）与图片（表情包/图片）
  // 分离：图片进 imgs 数组独立展示（与我的发布一致），不再混插在文字中间
  // v3.5.95：每类独立抽随机数——各概率设置（fd-post-kaomoji/emoji/sticker/image）独立生效
  // v3.6.x：各分类字卡去重 + 无重复抽取（同轮不抽同一张卡），修复小池内容大量重复
  function genPostContent(cfg, cid) {
    const pool = cardPool(cid);
    const fb = uniqArr(TA_COMMENT_POOL.concat(TA_REPLY_POOL));
    const pick = {
      image: makePicker(uniqArr(pool.image)),
      sticker: makePicker(uniqArr(pool.sticker)),
      emoji: makePicker(uniqArr(pool.emoji)),
      kaomoji: makePicker(uniqArr(pool.kaomoji)),
      text: makePicker(uniqArr(pool.text)),
      fb: makePicker(fb)
    };
    const n = cfg.minCardsPost + Math.floor(Math.random() * Math.max(1, cfg.maxCardsPost - cfg.minCardsPost + 1));
    const textParts = [];
    const imgs = [];
    for (let i = 0; i < n; i++) {
      let pushed = false;
      if (cfg.postImage > 0 && pool.image.length && Math.random() * 100 < cfg.postImage) { imgs.push(pick.image()); pushed = true; }
      if (!pushed && cfg.postSticker > 0 && pool.sticker.length && Math.random() * 100 < cfg.postSticker) { imgs.push(pick.sticker()); pushed = true; }
      if (!pushed && cfg.postEmoji > 0 && pool.emoji.length && Math.random() * 100 < cfg.postEmoji) { textParts.push(pick.emoji()); pushed = true; }
      if (!pushed && cfg.postKaomoji > 0 && pool.kaomoji.length && Math.random() * 100 < cfg.postKaomoji) { textParts.push(pick.kaomoji()); pushed = true; }
      if (!pushed) textParts.push(pool.text.length ? pick.text() : pick.fb());
    }
    return { content: textParts.join(' '), imgs: imgs };
  }
  // 动态正文 HTML：文字混排 + 独立图片区（九宫格）
  // v3.5.95：兼容旧数据 p.img 字段
  // v3.6.x：老数据兼容——旧版动态把图片/表情包 dataURL 直接拼进正文（含 sticker:/image:
  // 前缀与无前缀两种），与我的发布/新 TA 动态的 imgs 网格显示不一致；这里渲染时把它们
  // 抽出来并入图片网格，保证「联系人发布的图片/表情包 与 我发布的 大小一致」。
  function contentHtmlFor(p) {
    let content = String(p.content || '');
    const imgs = (p.imgs && p.imgs.length) ? p.imgs.slice() : (p.img ? [p.img] : []);
    // 前缀与 dataURL 必须整体作为一个可选分组（冒号在分组内）——若写成 (?:sticker|image):?
    // 引擎会在 'data:image' 中间误匹配 'image'，导致后面 (data:image…) 整体匹配失败
    // （mail.js renderBody 同款已生效模式）
    // v3.26.x：对齐 inlineBody——base64、svg 类非 base64 dataURL 与带前缀外链图都并入图片网格
    content = content.replace(/((?:sticker|image):)?(https?:\/\/[^\s"'<>]+|@@m:[0-9a-f]{32}|data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+)/g, (m, pre, u) => { if (u.indexOf('http') === 0 && pre !== 'sticker:' && pre !== 'image:') return m; imgs.push(u); return ' '; });
    let html = inlineBody(content, (p.role || p.by) === 'me' ? '' : p.owner);
    // #845：配图区不再只跟配图走——纯文字动态贴过贴纸时也要画一张空白底纸（.feed-imgs-blank），
    // 否则贴纸存进了数据却没有任何承载层可显示（「那一行没有贴纸按钮」的连带缺陷）。
    const hasStickers = Array.isArray(p.stickers) && p.stickers.length > 0;
    if (imgs.length || hasStickers) {
      // #302：贴纸回复——贴纸绝对定位叠在配图区上（x/y 为区块百分比），随卡片一起局部刷新
      html += '<div class="feed-imgs' + (imgs.length ? '' : ' feed-imgs-blank') + '">' + imgs.map(u => '<img src="' + attrEsc(u) + '" alt="图片" loading="lazy">').join('') + feedStickersHtml(p) + '</div>';
    }
    return html;
  }
  // #302 贴纸回复：配图上的贴纸层（仅贴过才有输出）；我贴的可点撤回
  function feedStickersHtml(p) {
    const list = Array.isArray(p.stickers) ? p.stickers : [];
    if (!list.length) return '';
    return list.map((s, i) => {
      const who = s.authorName || ((s.role || s.owner) === 'me' ? feedUserName() : 'TA');
      const inner = s.src
        ? '<img src="' + attrEsc(s.src) + '" alt="贴纸">'
        : '<span class="feed-sticker-emoji">' + esc(s.emoji || '❤️') + '</span>';
      const del = (s.role || s.owner) === 'me' ? ' data-sticker-del="' + esc(p.id) + '|' + i + '"' : '';
      return '<span class="feed-sticker"' + del + ' style="left:' + Number(s.x || 0) + '%;top:' + Number(s.y || 0) + '%" title="' + esc(who) + ' 贴的贴纸">' + inner + '</span>';
    }).join('');
  }
  // 评论区 HTML（v3.5.95：提升到模块作用域，主列表 + 全部朋友圈共用）
  // v3.14.x：回复目标按对话轮次解析——不再一律指向原评论作者（旧版 TA 回应我的回复
  //   会显示成「联系人 回复 联系人」）。每条新回复写入 to=被回复人昵称快照；旧数据无 to
  //   时按「本楼最近一位与我不同名的发言者」推断。回复行可点 → 定向回复该条作者。
  function commentsHtmlFor(p, name) {
    if (!p.comments || !p.comments.length) return '';
    return '<div class="feed-comments">' + p.comments.map((c, ci) => {
      const cNameRaw = c.authorName || ((c.role || c.by) === 'me' ? feedUserName() : (name || taFeedName()));
      const cName = esc(cNameRaw);
      const cBody = inlineBody(c.content, (c.role || c.by) === 'me' ? '' : p.owner);
      let repliesHtml = '';
      if (c.replies && c.replies.length) {
        // v3.11.x：回复加 data-ri——通知点击可直接定位闪烁到具体这条回复
        // v3.14.x：data-ci/data-ri 供点行定向回复；to 缺失按发言轮次推断（存量数据兼容）
        const speakers = [cNameRaw];
        repliesHtml = '<div class="feed-replies">' + c.replies.map((r, ri) => {
          const rNameRaw = r.authorName || ((r.role || r.by) === 'me' ? feedUserName() : (name || taFeedName()));
          let toRaw = (typeof r.to === 'string' && r.to) ? r.to : '';
          if (!toRaw) {
            for (let i = speakers.length - 1; i >= 0; i--) { if (speakers[i] !== rNameRaw) { toRaw = speakers[i]; break; } }
            if (!toRaw) toRaw = cNameRaw !== rNameRaw ? cNameRaw : feedUserName();
          }
          speakers.push(rNameRaw);
          const rBody = inlineBody(r.content, (r.role || r.by) === 'me' ? '' : p.owner);
          return '<div class="feed-reply" data-ci="' + ci + '" data-ri="' + ri + '"><b>' + esc(rNameRaw) + '</b><span class="fd-r-sep">回复</span><b>' + esc(toRaw) + '</b>：' + rBody + '</div>';
        }).join('') + '</div>';
      }
      return '<div class="feed-comment" data-c="' + p.id + '" data-ci="' + ci + '">' +
        '<div class="feed-c-line"><b>' + cName + '</b>：' + cBody + '</div>' +
        repliesHtml + '</div>';
    }).join('') + '</div>';
  }
  // 生成一条评论/回复内容（应用回复内容设置：多字卡概率/最多字卡数/使用表情包概率；主字卡/颜文字/emoji/表情包/图片全类别混排）
  // v3.6.x：cid 指定用该联系人桌面的字卡（TA 评论/回复用动态所属桌面的字卡）
  function pickReplyContent(cfg, cid) {
    const c = cfg || feedCfg();
    const maxN = Math.random() * 100 < c.cardProb ? Math.max(1, c.maxCards) : 1;
    // 「使用表情包概率」fd-image-prob：每张卡出现表情包/图片的概率；颜文字/emoji 固定 15%
    return genMixedCards(c, 1, maxN, { imgP: c.imageProb, kaoP: 15, emoP: 15 }, cid);
  }
  // v3.5.57：TA 回应我的回复的回复池
  const TA_REPLY_POOL = ['哈哈，好呀', '那你呢？', '嗯嗯，说得对', '我记住啦', '跟你分享过的', '被你发现了', '那很好呀', '我也这么觉得'];

  // 渲染封面（含可设置的背景图）
  // v3.6.x：多桌面——封面背景/头像/昵称按当前桌面独立存储（activeStore），
  // 读取时回退全局旧键（老数据：迁移前存在 xy-home-v2:feed-cover-bg 顶层）
  // v3.6.x：存量大图渲染防护——旧版本封面压缩失败时回退存过原图（48MP 级 dataURL），
  // 渲染 backgroundImage 会让 iOS Safari 解码卡死（打开页面卡顿点不动）；封面正常
  // 压缩产物（800px JPEG）<200KB，>500KB 判定为异常存量，清除回默认（LS+IDB 双清）
  function safeBg(v, key, s) {
    if (v && typeof v === 'string' && v.length > 500 * 1024) {
      try { s.remove(key); } catch (e) {}
      return '';
    }
    return v || '';
  }
  function coverBg() {
    const s = window.activeStore();
    const v = s.get('feed-cover-bg');
    if (v) return safeBg(v, 'feed-cover-bg', s);
    return safeBg(store.get('feed-cover-bg'), 'feed-cover-bg', store);
  }
  function renderCover() {
    const myAvEl = document.getElementById('feed-my-av');
    const myNameEl = document.getElementById('feed-my-name');
    // v3.8.x：封面显示我在朋友圈的独立身份（feed-user-*），回退聊天身份
    const myAvStr = feedUserAv();
    const myNameStr = feedUserName();
    if (myAvEl) {
      myAvEl.innerHTML = myAvStr ? '<img src="' + attrEsc(myAvStr) + '" alt="">' : '';
      // FIX 2026-09-18 #739：innerHTML 重建会把 label 激活层冲掉，渲染后补挂（幂等）
      try { if (window.mochiFilePickLabel) window.mochiFilePickLabel(myAvEl, feedAvPickInput); } catch (e) {}
      // FIX 2026-09-21 #1002：同一处补挂「真·可点 input 层」（layers 是按钮的子节点，innerHTML 重建一并冲掉）
      try { if (window.mochiFilePickSurface) window.mochiFilePickSurface(myAvEl, { id: 'feed-myav-tap', accept: 'image/*', owner: feedAvPickInput }); } catch (e) {}
    }
    if (myNameEl) myNameEl.textContent = myNameStr;
    const cover = document.getElementById('feed-cover');
    if (cover) {
      const bg = coverBg();
      if (bg) {
        cover.style.backgroundImage = 'url("' + bg + '")';
        cover.classList.add('has-bg');
      } else {
        cover.style.backgroundImage = '';
        cover.classList.remove('has-bg');
      }
    }
  }
  // 压缩图片（最长边 800px，JPEG 0.82，避免撑爆 localStorage 配额）
  function compressImage(file, cb) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const max = 800;
        let w = img.width, h = img.height;
        if (Math.max(w, h) > max) {
          const r = max / Math.max(w, h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { toast('图片读取失败'); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
  // v3.5.63：联系人在朋友圈展示的昵称/头像/背景（可独立于聊天修改）
  // v3.6.x：多桌面——按当前桌面独立存储，回退全局旧键（老数据兼容）
  function taFeedName() { return window.activeStore().get('feed-ta-name') || store.get('feed-ta-name') || partnerName(); }
  function taFeedAv() { return window.activeStore().get('feed-ta-avatar') || store.get('feed-ta-avatar') || partnerAv(); }
  function taFeedCover() {
    const s = window.activeStore();
    const v = s.get('feed-ta-cover');
    if (v) return safeBg(v, 'feed-ta-cover', s);
    return safeBg(store.get('feed-ta-cover'), 'feed-ta-cover', store);
  }
  // 该动态是否已收藏到桌面收藏夹（我的收藏-朋友圈），用于收藏按钮高亮
  function favFeedHas(p) {
    try {
      const fav = JSON.parse(window.activeStore().get('fav-msgs') || '[]');
      return Array.isArray(fav) && fav.some(f => (f.kind || '') === 'feed' && f.by !== 'ta' && f.ts === (p.ts || 0));
    } catch (e) { return false; }
  }
  // v3.10.x：单张动态卡片 HTML（主列表模板）——render 全量渲染与评论/点赞后的
  //   局部刷新（refreshPostCard）共用同一模板，避免两处 markup 漂移
  function postCardHtml(p, name) {
    const isMine = (p.role || p.by) === 'me';
    // v3.7.x：旧数据缺 authorName 快照时，昵称回退按动态所属桌面取
    // v3.8.x：'me' 动态作者/头像也读朋友圈独立身份（按动态所属桌面）
    const author = p.authorName || (isMine ? feedUserNameFor(p.owner || 'default') : taFeedNameFor(p.owner || 'default'));
    // v3.7.x：跨桌面——TA 动态头像按动态所属桌面取，不再显示当前桌面的 TA 头像
    const av = p.authorAv || (isMine ? feedUserAvFor(p.owner || 'default') : taAvFor(p.owner || 'default'));
    // 头像可点击 → 打开该联系人的全部朋友圈
    // #811：头像带作者角色——我的动态进「我的朋友圈」，TA 动态进 TA 的个人页（原都按 owner 桌面进同一页＝点我的头像显示成联系人的朋友圈）
    const avWrap = '<div class="feed-head-av" data-owner="' + esc(p.owner || '') + '" data-role="' + (isMine ? 'me' : 'ta') + '" title="查看' + esc(author) + '的全部朋友圈">' + avHtml(av) + '</div>';
    // 点赞列表：显示"XX、XX 觉得很赞"
    const likes = p.likes && p.likes.length
      ? '<div class="feed-likes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:-2px;margin-right:5px"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>' + esc(p.likes.join('、')) + ' 觉得很赞</div>'
      : '';
    const liked = p.likes && p.likes.some(l => l === feedUserName());
    const faved = favFeedHas(p);
    return '<div class="feed-post" id="feed-post-' + p.id + '"><div class="feed-head">' + avWrap +
      '<div class="feed-who"><div class="feed-name">' + esc(author) + '</div><div class="feed-time">' + fmtDT(p.ts) + '</div></div>' +
      '<button class="feed-del" data-id="' + p.id + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/></svg></button>' + '</div>' +
      '<div class="feed-content">' + contentHtmlFor(p) + '</div>' +
      '<div class="feed-actions">' +
      '<button class="feed-act' + (liked ? ' liked' : '') + '" data-like="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>赞</button>' +
      '<button class="feed-act" data-comment="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8z"/><circle cx="8.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/></svg>评论</button>' +
      // #302 贴纸回复 / #845：按钮常驻——纯文字动态也画（点开由空白底纸承接落位），不再「有配图才有这个功能」
      '<button class="feed-act" data-sticker="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 007 0"/><circle cx="9" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1" fill="currentColor" stroke="none"/></svg>贴纸</button>' +
      '<button class="feed-act feed-fav' + (faved ? ' faved' : '') + '" data-fav="' + p.id + '"><svg viewBox="0 0 24 24" fill="' + (faved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/></svg>收藏</button>' +
      '</div>' + likes + commentsHtmlFor(p, name) + '</div>';
  }
  // 渲染动态列表
  // v3.12.x：列表窗口化渲染——TA 自动发帖每天累积、动态含 dataURL 配图，原实现每次进页把
  // 全部动态一次性 innerHTML 进列表（挂机数月可达数百上千条），整页 <img> 位图解码的内存
  // 峰值是安卓 Chrome「网页崩溃」（渲染进程 OOM）的主要触发点。改为只渲染最新 FEED_RENDER_MAX
  // 条，更早的经底部「查看更早」按 FEED_LOAD_STEP 增量插入；存储不裁剪、历史零丢失。
  // 初始窗口取 200 兼容既有回归（verify-feed-comment-perf 种子 151 条需全量可见）。
  const FEED_RENDER_MAX = 200, FEED_LOAD_STEP = 100;
  let feedShownMain = 0, feedShownAll = 0;
  // FIX 2026-09-17 #669 打开朋友圈卡顿（用户报障，红米K80 Chrome，明说多机型同现）：
  //   列表是「动态正文 + 评论 + 内联 dataURL 配图」拼成的整数 MB 字符串（实测 200 条动态
  //   ＝4.0MB 标记），而桌面图标每次点击都走 openFeedPage → render() 整包重建：CPU 节流 4×
  //   实测冷开 281ms、紧接着再开 368ms，Profiler 里 set innerHTML 占绝对多数（同串重新赋值
  //   就要 327ms）。这里给渲染结果算一份轻量签名（桌面 + 窗口条数 + 显示身份 + 记忆卡 +
  //   窗口内每条动态的身份/赞/评论/贴纸/配图数），完全一致且列表里已有节点时跳过重建——
  //   反复进出朋友圈不再白付一次解析；数据一变签名就变（点赞换人、来新评论、发新动态、
  //   切联系人、点掉回忆卡都会变），绝不会拿旧 DOM 当新数据。
  let feedRenderSig = '';
  function feedRenderSignature(posts, shown, name, memId) {
    // #785：签名并入加载闸门位——回填中/回填完两次的空列表必须算两次不同渲染，
    // 否则 sig 早退会把「还在读取」占位一直留在屏上（真就绪后也不改口）。
    const parts = [window.activePrefix(), window.mochiDataPending ? (window.mochiDataPending() ? 'L' : 'F') : 'F', shown, name, memId, posts.length];
    for (let i = 0; i < shown; i++) {
      const p = posts[i];
      if (!p) { parts.push('-'); continue; }
      parts.push(p.id, p.ts, (p.content || '').length, (p.likes || []).join('/'),
        (p.comments || []).length, (p.stickers || []).length,
        ((p.imgs && p.imgs.length) || (p.img ? 1 : 0)));
    }
    return parts.join('|');
  }
  function feedMoreBtnHtml(remaining) {
    return '<button class="feed-more-btn" type="button">查看更早的动态（还有 ' + remaining + ' 条）</button>';
  }
  // 「查看更早」点击：插入下一批卡片后给新按钮重新挂监听（按钮每次重建，必须重绑）
  function feedBindMoreBtn(listEl) {
    const moreBtn = listEl.querySelector('.feed-more-btn');
    if (!moreBtn) return;
    moreBtn.addEventListener('click', () => {
      const isAll = listEl.id === 'feed-all-list';
      let posts = feedSortedAll();
      if (isAll) posts = posts.filter(p => (p.owner || 'default') === feedAllCid);
      const shown = isAll ? feedShownAll : feedShownMain;
      const end = Math.min(posts.length, shown + FEED_LOAD_STEP);
      if (end <= shown) { moreBtn.remove(); return; }
      const htmlFn = isAll ? postCardHtmlAll : (p => postCardHtml(p, partnerName()));
      moreBtn.remove();
      const tmp = document.createElement('div');
      tmp.innerHTML = posts.slice(shown, end).map(htmlFn).join('');
      // 先取静态数组再逐张搬移——tmp.children 是活 HTMLCollection，边 appendChild（节点
      // 随即离开 tmp）边迭代会「隔一跳一」只搬一半，曾致加载更多少插一半卡片
      const cards = Array.prototype.slice.call(tmp.children);
      cards.forEach(function (card) {
        listEl.appendChild(card);
        try { bindEvents(card); } catch (e) {}
      });
      const left = posts.length - end;
      if (left > 0) {
        listEl.insertAdjacentHTML('beforeend', feedMoreBtnHtml(left));
        feedBindMoreBtn(listEl); // 新按钮重新挂监听
      }
      if (isAll) feedShownAll = end; else feedShownMain = end;
    });
  }
  function feedSortedAll() { return load().slice().sort((a, b) => b.ts - a.ts); }
  function render() {
    renderCover();
    const listEl = document.getElementById('feed-list');
    if (!listEl) return;
    const posts = feedSortedAll();
    feedShownMain = Math.min(posts.length, FEED_RENDER_MAX);
    const name = partnerName();
    // #302：回忆闪回——那年今天的动态以记忆卡形式置顶（今日点 ✕ 后当天不再出现）
    const memPost = feedMemoryPost();
    const memShown = !!(memPost && !feedMemDismissed());
    const memHtml = memShown ? feedMemBannerHtml(memPost) : '';
    // FIX 2026-09-17 #669 内容与上次渲染完全一致时跳过整包重建（见 feedRenderSignature 注释；
    //   反复点桌面图标进朋友圈是主要受益路径，避免每次都重新解析数 MB 标记）
    const sig = feedRenderSignature(posts, feedShownMain, name, memShown ? memPost.id : '');
    if (sig === feedRenderSig && listEl.firstChild) return;
    listEl.innerHTML = memHtml + (posts.length
      ? posts.slice(0, feedShownMain).map(p => postCardHtml(p, name)).join('') +
        (posts.length > feedShownMain ? feedMoreBtnHtml(posts.length - feedShownMain) : '')
      : ((window.mochiDataPending && window.mochiDataPending())
        ? window.mochiLoadingHtml('朋友圈内容')
        : '<div class="ta-empty">还没有动态，TA 会不定期分享生活<br><button class="memo-send-btn" id="feed-empty-pub" style="margin-top:8px">我来发第一条</button></div>'));
    feedRenderSig = sig;
    const clearBtn = document.getElementById('feed-head-clear');
    if (clearBtn) clearBtn.hidden = !posts.length;
    bindEvents(listEl);
  }
  // #785：回填真完成后补渲一次——跨就绪边界的改口由签名里的闸门位保证（见 feedRenderSignature）
  if (window.mochiOnDataReady) window.mochiOnDataReady(function () {
    try { render(); } catch (e) {}
    if (feedAllCid) { try { renderFeedAll(); } catch (e) {} }
  });
  // v3.5.95：朋友圈图片点击放大（复用聊天大图查看器）
  // v3.6.x：抽成独立函数，主列表与「全部朋友圈」共用（原先全部朋友圈页图片点不动）
  function bindFeedImageClicks(listEl) {
    listEl.querySelectorAll('.feed-imgs img, .feed-inline-img').forEach(img => img.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.viewChatImage) window.viewChatImage(img.src);
    }));
  }
  // v3.6.x：删除单条动态（主列表 + 全部朋友圈共用），删除后按当前可见页面重渲染
  function deletePostConfirm(pid) {
    if (!window.openModal) return;
    window.openModal('删除这条动态？', '', () => {
      save(load().filter(x => x.id !== pid));
      // v3.5.130：删除的是评论条正在编辑的动态 → 同步关闭评论条（防悬空状态）
      if (comPid === pid) hideCommentBar();
      const fa = document.getElementById('page-feed-all');
      if (fa && !fa.hidden) openFeedAll(feedAllCid, feedAllWho); else render();
    }, { noInput: true });
  }
  // v3.7.x：按当前可见页面渲染——主列表（#feed-list）或「全部朋友圈」页（#feed-all-list）
  function renderVisible() {
    const fa = document.getElementById('page-feed-all');
    if (fa && !fa.hidden) { try { renderFeedAll(); } catch (e) {} } else { render(); }
  }
  // ===== #302 贴纸回复 =====
  // 贴纸来源：TA 的表情包 + 我的表情包（复用评论条同一来源，只收 dataURL）
  // FIX 2026-09-17 #669 用户报障（红米K80 Chrome，明说多机型同现）两件：
  //   ①「贴纸面板里不能像表情包面板一样打开分类」——原实现是一块「选个贴纸贴到照片上」的平铺
  //     网格（feedAllStickers 把 TA/我的分组拍平），既没有分组可点、也不显示分组名。改为与评论
  //     表情面板同源、同交互：分组胶囊栏（默认「全部」＝原有平铺，保持既有回归按第一格点击的
  //     行为），点胶囊切分组。
  //   ②「里面没有联系人用的 emoji 贴纸」——TA 回贴时 30% 会贴一个 emoji（feedTaPickSticker 里
  //     那组硬编码 emoji），而面板只列图片贴纸，用户选不到 TA 会贴的那类。这里把 emoji 抽成
  //     常量 FEED_STICKER_EMOJI，TA 回贴与面板共用，并作为「emoji 贴纸」分组列出。
  const FEED_STICKER_EMOJI = ['\u2764\ufe0f', '\ud83d\ude18', '\ud83e\udd70', '\ud83d\udc4d', '\ud83d\ude02', '\ud83c\udf08', '\u2728', '\ud83c\udf80', '\ud83d\ude3b', '\ud83e\udd17'];
  // FIX 2026-09-19 #798 用户报「【emoji贴纸】里贴纸不全，没有联系人默认可以使用的全部 emoji 贴纸」：
  //   #669 把这组兜底常量当成了面板与 TA 回贴的唯一 emoji 来源（10 个），而联系人在聊天/朋友圈里贴的
  //   emoji 出自「emoji 字卡」池——有自建就用自建，没有则用系统预设 emoji 分类（7 组）。改为与回复池
  //   同源，常量只在两池皆空时兜底（预设字卡被总闸/分类闸关掉、二级锁、库缺失）；TA 回贴走同一函数，
  //   维持 #669 的不变式「面板里能选到的＝TA 真的会贴的」。闸门口径照抄本文件朋友圈补池那一段
  //  （按当前联系人桌面读开关＋单卡停用过滤），关掉「朋友圈使用」时面板不再越权列出预设 emoji。
  // FIX 2026-09-20 #931 渲染用分组缓存：原来一次交互要「全库拍平」4~5 遍（分组条 1 遍 +
  //   网格 items 1 遍，而那 1 遍内部又对每个分组各调一次本函数＝TA/我的两库各重复扫描
  //   groups.length 次）。本函数每次都要过两作用域分组、必要时还整包 parse 预设字卡，
  //   emoji 字卡池是数百条量级——慢机型上这就是点一下卡一下的同步大头之一。
  //   口径＝「同一轮只算一次，轮末作废」（不是长期缓存）：一轮内的重复调用复用结果，
  //   下一次点按必然重算，因此不存在「对方刚更新的表情包看不到」的新问题；库序号（聊天
  //   字卡池令牌化代数／我的表情包数组身份）变了也立即作废。零机型分支。
  const stkPoolCache = new Map();
  function cachedStkPool(key, compute) {
    const rev = feedStickerLibRev();
    let cid = 'x';
    try { cid = (window.__activeCid || 'default') + ''; } catch (e) {}
    const k = key + '@' + cid + '@' + rev;
    if (stkPoolCache.has(k)) return stkPoolCache.get(k);
    const v = compute();
    if (!stkPoolCache.size) {
      // 缓存非空时不再排第二班作废微任务（同一轮内微任务不会先跑）
      Promise.resolve().then(function () { stkPoolCache.clear(); stkItemsCache.clear(); });
    }
    stkPoolCache.set(k, v);
    return v;
  }
  const stkItemsCache = new Map();
  function feedStickerLibRev() {
    // 库变→序号变（取不到聊天侧序号时恒 0＝退化为「每事件轮一次」，仍零长期缓存风险）
    try { if (window.feedStickerLibRev) return window.feedStickerLibRev(); } catch (e) {}
    return 0;
  }
  function feedStickerEmojiPoolBuild() {
    const out = [], seen = new Set();
    const add = (v) => { if (typeof v === 'string' && v && !seen.has(v)) { seen.add(v); out.push(v); } };
    try {
      ['public', 'own'].forEach(sc => {
        ((window.getScopedGroups && window.getScopedGroups('emoji', sc)) || []).forEach(g => (g[1] || []).forEach(add));
      });
    } catch (e) {}
    if (!out.length) {
      try {
        const st = window.storeFor ? window.storeFor(window.__activeCid || 'default') : null;
        const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
        const useFeed = a ? a.use('feed') : (window.defaultCardUse ? window.defaultCardUse('feed') : true);
        const en = a ? a.enabled() : ((window.defaultCardCfg && window.defaultCardCfg().enabled) !== false);
        if (en && useFeed && window.getDefaultCardGroups) {
          const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
          const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
          if (catOn('emoji')) (window.getDefaultCardGroups('emoji') || []).forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('emoji', c)) return; add(c); }));
        }
      } catch (e) {}
    }
    if (!out.length) FEED_STICKER_EMOJI.forEach(add);
    return out;
  }
  function feedStickerEmojiPool() {
    return cachedStkPool('emojiPool', feedStickerEmojiPoolBuild);
  }
  function feedStickerGroups() {
    return cachedStkPool('groups', feedStickerGroupsBuild);
  }
  function feedStickerGroupsBuild() {
    const savedTab = comStickerTab;
    let ta = [], mine = [];
    try { comStickerTab = 'ta'; ta = comStickerGroups(); } catch (e) { ta = []; }
    try { comStickerTab = 'mine'; mine = comStickerGroups(); } catch (e) { mine = []; }
    comStickerTab = savedTab;
    const out = [];
    (ta || []).forEach((g, i) => { if (g && g[1] && g[1].length) out.push({ key: 'ta' + i, label: String(g[0]), kind: 'img', items: g[1] }); });
    (mine || []).forEach((g, i) => { if (g && g[1] && g[1].length) out.push({ key: 'mn' + i, label: '\u6211\u7684\u00b7' + String(g[0]), kind: 'img', items: g[1] }); });
    out.push({ key: 'em', label: 'emoji \u8d34\u7eb8', kind: 'emoji', items: feedStickerEmojiPool() });
    return out;
  }
  let feedStickerCard = null;
  let feedStickerCur = '';
  // 当前分组的条目（''＝全部：分组顺序在前、emoji 收尾，与旧版平铺一致）
  // FIX 2026-09-20 #931 同一轮内分组条与网格各要一次这份列表：「全部」视图要新建上百个
  //   包装对象，按 当前分组＋桌面＋库序号 缓存，命中直接复用（返回形态与旧实现一致）。
  function feedStickerItems() {
    let cid = 'x';
    try { cid = (window.__activeCid || 'default') + ''; } catch (e) {}
    const ck = (feedStickerCur || '') + '@' + cid + '@' + feedStickerLibRev();
    if (stkItemsCache.has(ck)) return stkItemsCache.get(ck);
    const groups = feedStickerGroups();
    let out;
    if (!feedStickerCur) {
      out = [];
      groups.forEach(g => g.items.forEach(v => out.push({ kind: g.kind, v: v })));
    } else {
      const g = groups.find(x => x.key === feedStickerCur);
      out = g ? g.items.map(v => ({ kind: g.kind, v: v })) : [];
    }
    stkItemsCache.set(ck, out);
    return out;
  }
  function feedRenderStickerBar() {
    const bar = document.getElementById('feed-sticker-groups');
    if (!bar) return;
    bar.innerHTML = '';
    const groups = feedStickerGroups();
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const chips = [['', '\u5168\u90e8' + total]].concat(groups.map(g => [g.key, g.label + g.items.length]));
    chips.forEach(pair => {
      const key = pair[0], label = pair[1];
      const c = document.createElement('span');
      c.className = 'emoji-g-chip' + ((feedStickerCur || '') === key ? ' sel' : '');
      c.textContent = label;
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        feedStickerCur = (feedStickerCur === key ? '' : key);
        feedRenderStickerBar();
        feedRenderStickerList();
      });
      bar.appendChild(c);
    });
    bar.hidden = groups.length <= 1;   // 只有 emoji 一组时不显示胶囊栏
  }
  // FIX 2026-09-20 #931 贴纸面板「点开非常卡顿」根治：本面板的图改用聊天表情面板那套已实证
  //   机制（#435 进视口才补 src + decoding=async、#662 同身份节点回收复用、#435 令牌批量预热），
  //   零机型分支。原实现＝当前视图全部贴纸一次性 img.src=dataURL/令牌 同步挂进 DOM：实测 150 张
  //   库里 150/150 立刻带 src、0 张 async 解码（每张 20~68KB 的 dataURL 赋值就是 200ms+ 量级的
  //   同步活），CPU 4x 节流下最坏帧 183ms、两条 longtask，同库的聊天表情面板 0 掉帧；关掉再开
  //   还 0 个节点被复用＝每次都从零重解码。聊天侧机制取不到时退化为旧「即时 src」路径，行为不减。
  const feedStickerImgPool = new Map();   // 稳定身份 -> [img 节点]（重写前收、重建时取，跨渲染存活）
  const FS_IMG_POOL_MAX = 160, FS_IMG_POOL_PER_KEY = 8;
  function feedStickerPoolKey(src) {
    try { if (window.ccMediaCardIdent) return window.ccMediaCardIdent(src); } catch (e) {}
    return typeof src === 'string' ? src : String(src);
  }
  function feedStickerTrim() {
    // 只按「节点总数」裁剪（Map 保序：先丢最早收进来的＝用户已滚远、最不可能马上回看的）
    // ——身份数不参与上限判定，否则大库里「每身份 1 节点」会被误删到只剩零头。
    let total = 0;
    feedStickerImgPool.forEach(list => { total += list.length; });
    if (total <= FS_IMG_POOL_MAX) return;
    feedStickerImgPool.forEach((list, k) => { if (total > FS_IMG_POOL_MAX) { total -= list.length; feedStickerImgPool.delete(k); } });
  }
  function feedStickerHarvest(list) {
    if (!list) return;
    try {
      const imgs = list.querySelectorAll('img');
      for (let i = 0; i < imgs.length; i++) {
        const im = imgs[i];
        const k = (im.dataset && im.dataset.emojiKey) || '';
        if (!k || im.__pooled) continue;
        im.__pooled = true;
        let arr = feedStickerImgPool.get(k);
        if (!arr) { arr = []; feedStickerImgPool.set(k, arr); }
        if (arr.length < FS_IMG_POOL_PER_KEY) arr.push(im);
      }
      feedStickerTrim();
    } catch (e) {}
  }
  function feedStickerNewImg() {
    // 不预置 data-src：本面板图源不进 DOM 属性（见 feedStickerAttach），只挂在节点上
    const img = document.createElement('img');
    img.alt = '\u8d34\u7eb8';
    img.decoding = 'async';   // #435 口径：大 dataURL 解码不占主线程渲染帧
    return img;
  }
  function feedStickerImg(src) {
    const k = feedStickerPoolKey(src);
    let img = null;
    // ① 本面板上一轮收进去的节点优先（已解码的原样复活、还没补 src 的保住未挂状态）
    const arr = feedStickerImgPool.get(k);
    if (arr && arr.length) {
      img = arr.pop();
      if (!arr.length) feedStickerImgPool.delete(k);
      img.__pooled = false;
    }
    // ② 聊天表情面板回收池里有同身份节点就捡过来（两面板共用一批图时零重解码）
    if (!img && window.mochiEmojiLazyAdopt) {
      try {
        const got = window.mochiEmojiLazyAdopt(src);
        if (got && got.dataset && got.dataset.emojiKey === k) img = got; // 身份不符＝聊天侧新建的，不要
      } catch (e) {}
    }
    if (!img) img = feedStickerNewImg();
    try {
      img.dataset.emojiKey = k;
      // #931 复用/捡漏回来的节点可能还挂着未补 src 的 data-src：本面板是大 dataURL 图库，
      // 整格 150 张时那份字符串复制进属性＝面板 innerHTML 实测 1MB（属性写+序列化都是同步活），
      // 一律挪进 JS 引用，补 src 时由泵从 __emojiLazySrc 取。
      if (img.dataset && img.dataset.src) {
        img.__emojiLazySrc = img.dataset.src;
        img.removeAttribute('data-src');
      }
    } catch (e) {}
    return img;
  }
  // 本容器自己的可见性观察器（参数与聊天面板同款：rootMargin 120px，小容器够预读半屏）；
  // 命中的图交给聊天侧同一条分批泵（全局每 50ms 只补 4 张 src），两面板同时开也不叠加解码并发。
  let feedStickerObserver = null;
  let feedStickerObserverOk = false;
  function feedStickerEnsureObserver(root) {
    if (feedStickerObserverOk) return feedStickerObserver;
    feedStickerObserverOk = true;
    if (!root || !('IntersectionObserver' in window)) { feedStickerObserver = null; return null; }
    try {
      feedStickerObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          const en = entries[i];
          if (!en.isIntersecting) continue;
          feedStickerLoad(en.target);
        }
      }, { root, rootMargin: '120px 0px' });
    } catch (e) { feedStickerObserver = null; }
    return feedStickerObserver;
  }
  function feedStickerLoad(img) {
    if (!img) return;
    const src = img.__fsSrc;
    // 不另设「已排队」标记：节点会被回收池复活，带旧标记早退＝第二次再也补不上 src（实测 3s
    // 后 50 张只解出 2 张）。幂等交给泵本身——聊天侧队列按节点去重，且 src 已在的属性不重写。
    if (!src || img.getAttribute('src')) return;
    if (window.mochiEmojiLazyEnqueue) {
      try { window.mochiEmojiLazyEnqueue(img, src); return; } catch (e) {}
    }
    try { img.src = src; } catch (e) {}   // 无聊天侧机制：即时补 src 兜底（行为不减）
  }
  function feedStickerAttach(img, root, src) {
    if (!img || img.getAttribute('src')) return;
    img.__fsSrc = src;
    const ob = feedStickerEnsureObserver(root);
    if (ob) { try { ob.observe(img); return; } catch (e) {} }
    feedStickerLoad(img);   // 无 IO 的浏览器：即时补 src 兜底（与聊天面板同口径）
  }
  function feedStickerWarmTokens(items) {
    if (!window.mochiEmojiWarmGroupTokens) return;
    const arr = [];
    for (let i = 0; i < items.length; i++) { if (items[i].kind !== 'emoji') arr.push(items[i].v); }
    try { window.mochiEmojiWarmGroupTokens(arr); } catch (e) {}
  }
  function feedStickerSigTarget(items) {
    // #457 同口径指纹：只取「条数＋身份串长度和＋首尾身份」，身份串本身是 O(1) 片段
    //（ccMediaCardIdent 用 length+中间 40 字符），不对 20KB dataURL 整串哈希。
    let cid = 'x';
    try { cid = (window.__activeCid || 'default') + ''; } catch (e) {}
    let sig = cid + '|' + (feedStickerCur || '') + '|' + items.length;
    const ident = (typeof window.ccMediaCardIdent === 'function') ? window.ccMediaCardIdent : null;
    let tot = 0, mix = 0;
    for (let i = 0; i < items.length; i++) {
      const v = items[i].v;
      const k = ident ? ident(typeof v === 'string' ? v : String(v)) : String(v);
      tot += k.length;
      mix = (mix * 31 + k.charCodeAt(0) + k.charCodeAt(k.length - 1)) | 0;   // 逐身份 O(1) 混合：中间某张被换成等长身份也撞不开签名
    }
    sig += '|' + tot + '|' + mix;
    if (items.length) {
      const f = items[0].v, l = items[items.length - 1].v;
      sig += '|' + (ident ? ident(String(f)) : String(f)) + '|' + (ident ? ident(String(l)) : String(l));
    }
    return sig;
  }
  let feedStickerRenderSig = '';
  function feedRenderStickerList() {
    const list = document.getElementById('feed-sticker-list');
    if (!list) return;
    const items = feedStickerItems();
    // #931 内容未变且网格仍在＝整块重建零收益（重建＝上百节点回收＋上百次 observe＋样式重排，
    // 实测重复打开同步 65.9ms，而聊天面板走同款短路只要 8~10ms）。节点原样留着，可见图已解码
    // 的直接显示，未进视口的仍挂在旧观察器上（观察器不因复用而丢）。
    const sig = feedStickerSigTarget(items);
    const grid0 = list.firstElementChild;
    let imgN = 0;
    for (let i = 0; i < items.length; i++) { if (items[i].kind !== 'emoji') imgN++; }
    if (sig && sig === feedStickerRenderSig && grid0 && grid0.classList.contains('emoji-grid') &&
        grid0.childElementCount === items.length && grid0.querySelectorAll('img').length === imgN) {
      return;
    }
    feedStickerHarvest(list);   // #931 整格重写前先把旧 img 收进回收池（同身份节点下一轮直接取回）
    list.innerHTML = '';
    if (!items.length) {
      feedStickerRenderSig = '';
      list.innerHTML = '<div class="ta-empty">\u6682\u65e0\u8d34\u7eb8\uff0c\u8bf7\u5230\u81ea\u5b9a\u4e49\u5b57\u5361 \u2192 \u8868\u60c5\u5305 \u4e0a\u4f20</div>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'emoji-grid';
    items.forEach((it, idx) => {
      const d = document.createElement('div');
      d.className = 'emoji-item';
      // #931 点击不再逐格挂监听（原来一次渲染上百个闭包+上百条监听器）：整张网格一条委托，
      // 格子上只落下标——大 dataURL 不写进 DOM 属性，落位时再从本轮 items 取源。
      d.dataset.stkKind = it.kind;
      d.dataset.stkIdx = String(idx);
      grid.appendChild(d);
      if (it.kind === 'emoji') {
        // emoji 贴纸：与照片上已贴的 emoji 同一样式（.feed-sticker-emoji，样式复用零新增）
        const sp = document.createElement('span');
        sp.className = 'feed-sticker-emoji';
        sp.textContent = it.v;
        d.appendChild(sp);
      } else {
        const img = feedStickerImg(it.v);
        d.appendChild(img);
        feedStickerAttach(img, list, it.v);
      }
    });
    grid.addEventListener('click', (e) => {
      const d = e.target && e.target.closest ? e.target.closest('.emoji-item') : null;
      if (!d || !grid.contains(d)) return;
      e.stopPropagation();
      const pid = feedStickerCard ? feedStickerCard.dataset.pid : '';
      const it = items[Number(d.dataset.stkIdx)];
      if (!it) return;
      if (it.kind === 'emoji') feedPickStickerPos(pid, '', it.v);
      else feedPickStickerPos(pid, it.v);
    });
    list.appendChild(grid);
    feedStickerRenderSig = sig;   // #931 只记「确实按本轮 items 建完」的那一次
    feedStickerWarmTokens(items);   // #931 令牌交给媒体池批量预热（不等逐图排队单读）
  }
  function openFeedStickerPanel(pid) {
    if (!feedStickerCard) {
      feedStickerCard = document.createElement('div');
      feedStickerCard.id = 'feed-sticker-card';
      feedStickerCard.className = 'poke-card emoji-card';
      feedStickerCard.style.position = 'fixed';
      feedStickerCard.style.left = '8px';
      feedStickerCard.style.right = '8px';
      feedStickerCard.style.bottom = '10px';
      feedStickerCard.style.maxHeight = '46vh';
      feedStickerCard.style.zIndex = '3000';
      feedStickerCard.hidden = true;
      feedStickerCard.innerHTML =
        '<div class="emoji-head">' +
          '<div class="emoji-tabs"><span class="emoji-tab sel">选个贴纸贴上去</span></div>' +
          '<button class="poke-card-close" data-fsc="1">\u2715</button>' +
        '</div>' +
        '<div class="emoji-groups" id="feed-sticker-groups"></div>' +
        '<div class="poke-card-scroll" style="min-height:100px;max-height:36vh" id="feed-sticker-list"></div>';
      document.body.appendChild(feedStickerCard);
      feedStickerCard.querySelector('[data-fsc]').addEventListener('click', () => { feedStickerCard.hidden = true; });
      feedStickerCard.addEventListener('click', (e) => { if (e.target === feedStickerCard) feedStickerCard.hidden = true; });
    }
    feedStickerCard.dataset.pid = pid;
    feedStickerCard.hidden = false;
    feedStickerCur = '';           // 每次打开回「全部」
    feedRenderStickerBar();
    feedRenderStickerList();
  }
  function feedRandStickerPos() {
    return { x: Math.round(6 + Math.random() * 74), y: Math.round(6 + Math.random() * 70) };
  }
  // v3.36.x：我贴的贴纸位置可自定义——选完贴纸进入「点照片选位置」模式，点哪里贴哪里；
  // 找不到配图（数据被并发删掉等）时退回随机落位；TA 回贴仍走 feedRandStickerPos
  // FIX 2026-09-16 #593：提示条一律不压照片——改成配图区前面独立一行（文档流内，照片上没有任何覆盖层）。
  //   旧实现把提示条绝对定位钉在照片顶部：照片高约 104px 时它占掉 33px（≈顶部 1/3），
  //   点那一带全被提示条接走＝被当成「取消」（一张都贴不上、模式还退出了），
  //   系统字号越大压得越多——「其他设备型号也有」即此（零机型分支，只与提示条高度有关）。
  let feedPickCtx = null;
  function feedCancelPickSticker() {
    if (!feedPickCtx) return;
    const ctx = feedPickCtx;
    feedPickCtx = null;
    if (ctx.timer) clearInterval(ctx.timer);
    ctx.box.removeEventListener('click', ctx.onPick, true);
    ctx.box.classList.remove('feed-sticker-picking');
    // #845：纯文字动态的那张底纸是本次选位临时铺的，取消即收回（真配图区不动）
    if (ctx.blank && ctx.box.parentNode) ctx.box.parentNode.removeChild(ctx.box);
    if (ctx.hint && ctx.hint.parentNode) ctx.hint.parentNode.removeChild(ctx.hint);
  }
  // #845：给没有配图的动态就地铺一张空白底纸（与 contentHtmlFor 的 hasStickers 分支同款类名），
  //   让纯文字动态也能走「点哪里贴哪里」，而不是退回随机落位
  function feedEnsureStickerBox(post) {
    const got = post.querySelector('.feed-imgs');
    if (got) return { box: got, blank: false };
    const box = document.createElement('div');
    box.className = 'feed-imgs feed-imgs-blank';
    const content = post.querySelector('.feed-content');
    if (content && content.parentNode) content.parentNode.insertBefore(box, content.nextSibling);
    else post.appendChild(box);
    return { box: box, blank: true };
  }
  // FIX 2026-09-17 #669 emoji 参数：贴纸面板的「emoji 贴纸」分组（图片贴纸走 src，emoji 走 emoji）
  function feedPickStickerPos(pid, src, emoji) {
    feedCancelPickSticker();
    const post = feedPostEl(pid);
    const made = post ? feedEnsureStickerBox(post) : null;
    const box = made ? made.box : null;
    if (!box) { addFeedSticker(pid, { src: src, emoji: emoji }); return; }
    feedStickerCard.hidden = true;
    box.classList.add('feed-sticker-picking');
    const hint = document.createElement('div');
    hint.className = 'feed-pick-hint';
    hint.innerHTML = '<span>📍 点击照片选贴纸位置</span><button type="button">取消</button>';
    hint.querySelector('button').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); feedCancelPickSticker(); });
    // 提示条插在配图区「之前」：自己占一行、不覆盖照片，照片任意位置（含最顶部）点下去都按落点贴
    box.parentNode.insertBefore(hint, box);
    const onPick = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!box.isConnected) { feedCancelPickSticker(); return; }
      const r = box.getBoundingClientRect();
      const x = Math.round(Math.min(90, Math.max(4, ((e.clientX - r.left) / Math.max(1, r.width)) * 100)));
      const y = Math.round(Math.min(90, Math.max(6, ((e.clientY - r.top) / Math.max(1, r.height)) * 100)));
      feedCancelPickSticker();
      addFeedSticker(pid, { src: src, emoji: emoji, x: x, y: y });
    };
    box.addEventListener('click', onPick, true);
    // FIX 2026-09-16 #593：选位期间卡片被局部/全量重渲染（评论/点赞/TA 回贴/换列表都是换节点）会让监听器跟着旧节点作废，
    //   原实现只在「用户再点一下」时才发现，提示条会一直挂在页面上；4 次/秒的轻量看门狗主动收尾，
    //   任何机型都不会卡在选位态（改成不用看门狗时，verify-feed-sticker-pos 的 E4 会红）
    const timer = setInterval(() => { if (!box.isConnected) feedCancelPickSticker(); }, 250);
    feedPickCtx = { box, onPick, hint, timer, blank: made.blank };
  }
  // 我贴一张：每条动态上限 5 张；贴完 TA 有概率（评论回应概率同源）回贴一张并进通知
  function addFeedSticker(pid, st) {
    const list = load();
    const p = list.find(x => x.id === pid);
    if (!p) { toast('这条动态不存在了'); return; }
    p.stickers = Array.isArray(p.stickers) ? p.stickers : [];
    if (p.stickers.length >= 5) { toast('这条动态上贴纸够多啦（最多 5 张）'); return; }
    // v3.36.x：位置自定义——st 带 x/y（点照片选位置的落点）就用它，否则随机
    const pos = (st && Number.isFinite(Number(st.x)) && Number.isFinite(Number(st.y)))
      ? { x: Math.min(92, Math.max(0, Math.round(Number(st.x)))), y: Math.min(92, Math.max(0, Math.round(Number(st.y)))) }
      : feedRandStickerPos();
    p.stickers.push({ src: st.src || '', emoji: st.emoji || '', x: pos.x, y: pos.y, ts: Date.now(), role: 'me', owner: 'me', authorName: feedUserName() });
    save(list);
    refreshPostCard(pid);
    const cid = p.owner || 'default';
    const cfg = feedCfgFor(cid);
    if (Math.random() * 100 < cfg.commentProb) {
      setTimeout(() => {
        const l2 = load();
        const p2 = l2.find(x => x.id === pid);
        if (!p2) return;
        p2.stickers = Array.isArray(p2.stickers) ? p2.stickers : [];
        if (p2.stickers.length >= 5) return;
        const taSt = feedTaPickSticker();
        const pos2 = feedRandStickerPos();
        const nm = p2.taName || taFeedNameFor(cid);
        p2.stickers.push({ src: taSt.src || '', emoji: taSt.emoji || '', x: pos2.x, y: pos2.y, ts: Date.now(), role: 'ta', owner: cid, authorName: nm });
        save(l2);
        refreshPostCard(pid);
        addNotice('comment', pid, nm + ' 在配图上贴了一张贴纸', cid);
      }, (cfg.commentSpeedMin + Math.random() * Math.max(1, cfg.commentSpeedMax - cfg.commentSpeedMin)) * 1000);
    }
  }
  function feedTaPickSticker() {
    const saved = comStickerTab;
    comStickerTab = 'ta';
    const g = comStickerGroups();
    comStickerTab = saved;
    const srcs = [];
    g.forEach(x => (x[1] || []).forEach(s => srcs.push(s)));
    if (srcs.length && Math.random() < 0.7) return { src: srcs[Math.floor(Math.random() * srcs.length)] };
    // FIX 2026-09-19 #798 改走与面板同源的 emoji 池（池空时该函数自己回落到 FEED_STICKER_EMOJI）
    const em = feedStickerEmojiPool();
    return { emoji: em[Math.floor(Math.random() * em.length)] };
  }
  function removeFeedSticker(pid, i) {
    if (!window.openModal) return;
    window.openModal('撤回这张贴纸？', '', () => {
      const list = load();
      const p = list.find(x => x.id === pid);
      if (!p || !p.stickers || !p.stickers[i]) return;
      p.stickers.splice(i, 1);
      save(list);
      refreshPostCard(pid);
    }, { noInput: true });
  }
  // ===== #302 回忆闪回（那年今天）=====
  function feedMemoryPost() {
    const now = new Date();
    const mmdd = (now.getMonth() + 1) + '-' + now.getDate();
    let best = null;
    feedSortedAll().forEach(p => {
      const d = new Date(p.ts);
      if (d.getFullYear() >= now.getFullYear()) return;
      if ((d.getMonth() + 1) + '-' + d.getDate() !== mmdd) return;
      if (!best || p.ts > best.ts) best = p;
    });
    return best;
  }
  function feedMemDismissed() {
    try { return store.get('feed-mem-dismiss') === new Date().toDateString(); } catch (e) { return false; }
  }
  function feedMemBannerHtml(p) {
    const y = new Date(p.ts).getFullYear();
    const txt = String(p.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const th = (p.imgs && p.imgs[0]) || p.img || '';
    return '<div class="feed-mem-card glass" id="feed-mem-card" data-pid="' + esc(p.id) + '">' +
      '<div class="feed-mem-label">📅 回忆闪回 · ' + y + ' 年的今天</div>' +
      '<div class="feed-mem-body">' + (th ? '<img src="' + attrEsc(th) + '" alt="">' : '') + '<span>' + esc(txt || '（图片动态）') + '</span></div>' +
      '<button class="feed-mem-dismiss" type="button">✕</button></div>';
  }
  // 点击回忆卡：定位到那条动态并高亮；「查看更早」窗口没渲染到就扩窗重渲染后再定位
  function revealFeedPost(pid) {
    const posts = feedSortedAll();
    const idx = posts.findIndex(p => p.id === pid);
    if (idx < 0) return;
    if (idx >= feedShownMain) {
      feedShownMain = Math.min(posts.length, idx + 20);
      render();
    }
    const el = document.getElementById('feed-post-' + pid);
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    el.classList.add('feed-hl');
    setTimeout(() => el.classList.remove('feed-hl'), 2400);
  }
  // v3.10.x：单卡局部刷新——评论/回复/点赞只改动一条动态，原实现走 renderVisible()
  //   全量重渲染整个列表：所有卡片 HTML 字符串重建 + 全部 dataURL 配图重新解码 +
  //   全部事件重绑，重度图片数据下发一条评论就卡顿数百 ms~秒级（手机端明显）。
  //   改为只替换该动态的卡片节点，其余卡片 DOM 原地不动（不解码图片、不重绑事件）；
  //   卡片不在当前列表（刚发布/已删除/空态）时回退全量渲染兜底。
  // FIX 2026-09-19 #847：主列表与个人页两套模板都输出 id="feed-post-<pid>"，两页同时在场时同一个 pid
  //   有两份同 id 卡片，getElementById 只按文档序拿到第一份＝藏在隐藏页里的那份——个人页「评论发出去
  //   屏上这条动态不刷新」「贴贴纸时底纸铺在看不见的卡上」。单卡定位一律走这里，按当前可见那页取。
  function feedPostEl(pid) {
    const all = document.getElementById('page-feed-all');
    const scope = all && !all.hidden ? document.getElementById('feed-all-list') : document;
    // 属性选择器（非 #id）：不依赖 pid 是否以数字开头，也不引入 CSS.escape 依赖
    return scope ? scope.querySelector('[id="feed-post-' + pid + '"]') : null;
  }
  function refreshPostCard(pid, preload) {
    const el = feedPostEl(pid);
    if (!el) { renderVisible(); return; }
    // v3.42.x 点赞卡顿：调用方（点赞/回赞）刚 load() 过就传 preload，省一次兆级全量 parse
    const p = (preload && preload.id === pid) ? preload : load().find(x => x.id === pid);
    if (!p) { renderVisible(); return; }
    // 「全部朋友圈」页卡片模板与主列表略有差异（点赞行样式/作者取 feedAllCid），按所在列表选模板
    const html = el.closest('#feed-all-list') ? postCardHtmlAll(p) : postCardHtml(p, partnerName());
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const fresh = wrap.firstElementChild;
    if (!fresh || fresh.id !== 'feed-post-' + pid) { renderVisible(); return; }
    el.replaceWith(fresh);
    bindEvents(fresh);
  }
  function bindEvents(listEl) {
    // v3.12.x：「查看更早」增量加载——只插入新卡片并逐卡绑定（refreshPostCard 同款单卡
    // bindEvents 复用），旧卡片 DOM 原地不动：不重新解码已显示的 dataURL 配图、不重复绑定
    feedBindMoreBtn(listEl);
    // v3.5.63：动态头像点击 → 打开该人的全部朋友圈
    listEl.querySelectorAll('.feed-head-av').forEach(av => av.addEventListener('click', (e) => {
      e.stopPropagation();
      // #811：按作者角色进页（me=我的朋友圈 / ta=该联系人的个人页）
      openFeedAll(av.dataset.owner, av.dataset.role === 'me' ? 'me' : 'ta');
    }));
    bindFeedImageClicks(listEl);
    listEl.querySelectorAll('.feed-del').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePostConfirm(b.dataset.id);
    }));
    // 点赞：我点赞后 TA 有概率回赞
    listEl.querySelectorAll('.feed-act[data-like]').forEach(b => b.addEventListener('click', () => {
      const list = load();
      const p = list.find(x => x.id === b.dataset.like);
      if (!p) return;
      p.likes = p.likes || [];
      // 我的点赞存我的昵称（"我的昵称 觉得很赞"），TA 的点赞存 TA 昵称
      // v3.8.x：用朋友圈独立昵称
      const nm = feedUserName();
      const i = p.likes.indexOf(nm);
      const wasMe = i >= 0;
      if (wasMe) p.likes.splice(i, 1); else p.likes.push(nm);
      save(list);
      refreshPostCard(b.dataset.like, p);
      if (!wasMe && (p.role || p.by) === 'me' && Math.random() * 100 < feedCfgFor(p.owner || 'default').likeback) {
        // v3.7.x：回赞的是动态所属桌面 TA，用该桌面设置
        const cfg = feedCfgFor(p.owner || 'default');
        setTimeout(() => {
          const list2 = load();
          const p2 = list2.find(x => x.id === p.id);
          if (!p2) return;
          p2.likes = p2.likes || [];
          if (p2.likes.indexOf(p2.taName || taFeedNameFor(p2.owner || 'default')) < 0) p2.likes.push(p2.taName || taFeedNameFor(p2.owner || 'default'));
          save(list2);
          refreshPostCard(p.id, p2);
          addNotice('like', p2.id, (p2.taName || taFeedNameFor(p2.owner || 'default')) + ' 赞了你的动态', p2.owner || 'default');
        }, (cfg.likeSpeedMin + Math.random() * Math.max(1, cfg.likeSpeedMax - cfg.likeSpeedMin)) * 1000);
      }
    }));

    listEl.querySelectorAll('.feed-act[data-comment]').forEach(b => b.addEventListener('click', () => {
      showCommentBar(b.dataset.comment);
    }));
    // #302：贴纸回复——打开选贴纸面板 / 点击我贴的贴纸撤回
    listEl.querySelectorAll('.feed-act[data-sticker]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openFeedStickerPanel(b.dataset.sticker);
    }));
    listEl.querySelectorAll('.feed-sticker[data-sticker-del]').forEach(el2 => el2.addEventListener('click', (e) => {
      e.stopPropagation();
      const parts = String(el2.dataset.stickerDel).split('|');
      removeFeedSticker(parts[0], parseInt(parts[1], 10));
    }));
    // #302：回忆闪回卡——点击定位到那年今天的动态，✕ 今日不再显示
    const memCard = listEl.querySelector('.feed-mem-card');
    if (memCard) {
      memCard.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('.feed-mem-dismiss')) return;
        revealFeedPost(memCard.dataset.pid);
      });
      const dis = memCard.querySelector('.feed-mem-dismiss');
      if (dis) dis.addEventListener('click', (e) => {
        e.stopPropagation();
        try { store.set('feed-mem-dismiss', new Date().toDateString()); } catch (err) {}
        memCard.remove();
      });
    }
    // 收藏：收藏到桌面收藏夹（我的收藏-朋友圈），按动态 ts 去重
    listEl.querySelectorAll('.feed-act[data-fav]').forEach(b => b.addEventListener('click', () => {
      const pid = b.dataset.fav;
      const list = load();
      const p = list.find(x => x.id === pid);
      // v3.26.x：addMyFavItem 未就绪时不再静默 return（否则点击毫无反应），给明确反馈
      if (!window.addMyFavItem) { toast('收藏功能暂不可用'); return; }
      if (!p) { toast('未找到这条动态'); return; }
      const isMine = (p.role || p.by) === 'me';
      const ok = window.addMyFavItem({
        kind: 'feed',
        text: p.content || '',
        imgs: (p.imgs || []).slice(),
        ts: p.ts || Date.now(),
        side: isMine ? 'out' : 'in'
      });
      toast(ok ? '已收藏这条动态' : '这条动态已收藏过');
      refreshPostCard(pid); // 刷新收藏按钮高亮态
    }));
    // 点击评论 → 回复（TA 的评论可回复）：复用页面内评论条（v3.5.58 不再用独立弹窗）
    listEl.querySelectorAll('.feed-comment').forEach(c => c.addEventListener('click', () => {
      const pid = c.dataset.c;
      const ci = Number(c.dataset.ci);
      const list = load();
      const p = list.find(x => x.id === pid);
      if (!p || !p.comments || !p.comments[ci] || (p.comments[ci].role || p.comments[ci].by) === 'me') return;
      showCommentBar(pid, { pid: pid, ci: ci });
    }));
    // v3.14.x：点楼内某条回复 → 定向回复该条作者（不再只能对着原评论回，TA 的最新
    // 回复也能继续聊）；自己的回复不可自回；stopPropagation 防冒泡触发整条评论的回复
    listEl.querySelectorAll('.feed-reply').forEach(rEl => rEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = rEl.closest('.feed-comment');
      if (!wrap) return;
      const pid = wrap.dataset.c;
      const ci = Number(rEl.dataset.ci);
      const ri = Number(rEl.dataset.ri);
      const list = load();
      const p = list.find(x => x.id === pid);
      const tc = p && p.comments && p.comments[ci];
      const tr = tc && tc.replies && tc.replies[ri];
      if (!tr || (tr.role || tr.by) === 'me') return;
      showCommentBar(pid, { pid: pid, ci: ci, ri: ri });
    }));
  }
  // ================= 评论条（固定元素只绑定一次，v3.5.64 修复重复弹窗） =================
// 评论：点【评论】→ 页面内评论条（不用独立弹窗），可发文字/表情包/图片；TA 有概率回复评论
const comBar = document.getElementById('feed-comment-bar');
const comInput = document.getElementById('feed-comment-input');
const comSend = document.getElementById('feed-comment-send');
const comSticker = document.getElementById('feed-comment-sticker');
const comImg = document.getElementById('feed-comment-img');
// FIX 2026-09-21 #1002（第九波续）：朋友圈各上传入口铺「真·可点 input」层——手指物理落在真 input 上，
// 选择器由浏览器原生默认动作弹出，不再依赖 label 转发 / JS 合成 click / showPicker 任何一条腿。
// owner 写统一入口的 input id（那个 input 点按时才建，这里只登记 id、选完文件时才解析），
// 选中文件转交它并派发 change ⇒ 下面的压缩/落库管线一字未改（同一入口仍只有一条管线）。
if (comImg && window.mochiFilePickSurface) window.mochiFilePickSurface(comImg, { id: 'feed-com-tap', accept: 'image/*', owner: 'mochi-com-img-pick' });
// v3.7.x：OPPO Edge 对 ce-box(contenteditable 转换框)聚焦/输入失效——与回复设置
// stp-val 同源（见 WORKLOG 2026-08 OPPO Edge 修复记录），评论输入框保持原生
// textarea：预标记 ceDone 让 mobile-adapt.js 转换器跳过（原生仅弹自动填充条，
// 不影响输入；ce-box 在 OPPO Edge 上无法聚焦/打字，评论直接发不出去）
if (comInput) comInput.dataset.ceDone = '1';
let comPid = null;
let comReplyTarget = null; // v3.5.58：回复模式 { pid, ci }
let comImgData = []; // 评论携带的图片（dataURL），不塞进输入框文本（避免乱码）
function renderComPv() {
  const pv = document.getElementById('feed-comment-pv');
  if (!pv) return;
  pv.innerHTML = '';
  comImgData.forEach((d, i) => {
    // v3.6.x：img 用属性赋值（dataURL 含引号时拼 innerHTML 会逃逸注入 HTML）
    const span = document.createElement('span');
    span.className = 'feed-pv feed-pv-sm';
    const img = document.createElement('img');
    img.src = d;
    img.alt = '';
    const delBtn = document.createElement('button');
    delBtn.className = 'feed-preview-del';
    delBtn.dataset.i = i;
    delBtn.textContent = '✕';
    span.appendChild(img);
    span.appendChild(delBtn);
    pv.appendChild(span);
  });
  pv.hidden = comImgData.length === 0;
  pv.querySelectorAll('.feed-preview-del').forEach(b => b.addEventListener('click', () => {
    comImgData.splice(parseInt(b.dataset.i, 10), 1);
    renderComPv();
  }));
}
// #847：评论条与评论面板只长在 #page-feed 里，而「全部朋友圈」是另一个 .page（个人页里点【评论】＝
// 往隐藏的祖先内部取消隐藏，屏幕上什么都不出现）。显示前把这两个节点搬挂到当前可见的那一页——
// 全站仍是同一个实例（id 不重复、监听不重绑），换页只是换爹。
function feedCommentBarAdopt() {
  if (!comBar) return;
  const all = document.getElementById('page-feed-all');
  const host = all && !all.hidden ? all : document.getElementById('page-feed');
  if (!host || comBar.parentNode === host) return;
  host.appendChild(comBar);
  const panel = document.getElementById('feed-comment-panel');
  if (panel) host.appendChild(panel);
}
function showCommentBar(pid, replyTarget) {
  feedCommentBarAdopt();
  comPid = pid;
  comReplyTarget = replyTarget || null;
  comImgData = [];
  if (comBar) comBar.hidden = false;
  if (comInput) {
    comInput.value = '';
    // v3.7.x：回复占位显示被回复评论的作者昵称（跨桌面时不再一律显示当前桌面 TA 名）
    // v3.14.x：ri 指定楼内某条回复时，占位显示该条回复作者
    let rpName = partnerName();
    if (replyTarget) {
      try {
        const lst = load();
        const pp = lst.find(x => x.id === pid);
        const tc = pp && pp.comments && pp.comments[replyTarget.ci];
        if (tc) {
          if (tc.authorName) rpName = tc.authorName;
          const tr = replyTarget.ri != null && tc.replies ? tc.replies[replyTarget.ri] : null;
          if (tr && tr.authorName) rpName = tr.authorName;
        }
      } catch (e) {}
    }
    comInput.placeholder = replyTarget ? '回复 ' + rpName + '…' : '评论…';
    setTimeout(() => comInput.focus(), 60);
  }
  renderComPv();
  const panel = document.getElementById('feed-comment-panel');
  if (panel && !panel.hidden) panel.hidden = true;
}
function hideCommentBar() {
  if (comBar) comBar.hidden = true;
  if (comInput) { comInput.value = ''; comInput.placeholder = '评论…'; }
  comPid = null;
  comReplyTarget = null;
  comImgData = [];
  renderComPv();
  const panel = document.getElementById('feed-comment-panel');
  if (panel) panel.hidden = true;
}
// v3.5.56：评论内容支持 dataURL 图片（压缩 240px，同字卡库表情包规格）
function compressCommentImg(dataUrl, maxSide) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/png'));
      } catch (e) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
// 表情包选择半框（v3.5.70 完全复刻聊天表情面板：双 tab「TA 的表情包/我的表情包」+ 顶部分组栏 + 4 列网格）
let comStickerPanel = null;
let comStickerTab = 'ta';   // 'ta' | 'mine'
let comStickerCur = '';     // 当前分组
function comStickerGroups() {
  // #847：评论面板补「emoji 表情」组——原面板只有图片表情包，没传过表情包的桌面打开只看到
  //   一句「暂无表情包」，与动态侧贴纸面板（有 emoji 贴纸组，#669/#845）不对等。
  //   源用已入库的常量 FEED_STICKER_EMOJI（与动态侧面板同一批，选得到＝发得出）。
  if (comStickerTab === 'em') return [['emoji \u8868\u60c5', FEED_STICKER_EMOJI]];
  // TA 的表情包：聊天字卡库 sticker 分类；我的表情包：my-emoji-groups
  // v3.11.x：只收 dataURL 表情——选中后会拼进评论/正文文本（data:image 正则识别），
  // 链接导入的 http(s) 表情拼进去只显示 URL 文字，先过滤掉
  const onlyData = (groups) => (groups || [])
    .map(([n, a]) => [n, (a || []).filter(s => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))))])
    .filter(([, a]) => a.length);
  if (comStickerTab === 'ta') return onlyData((window.getMediaGroups && window.getMediaGroups('sticker')) || []);
  // FIX 2026-09-04 #154 朋友圈评论「我的表情包」与聊天面板不同步——优先取 chat.js
  // 维护的最新内存副本（window.getMyEmojiGroups，启动/打开时已用 IDB 权威值自愈；
  // store 层对该键可能停在旧 LS 快照或大键驻留挂起，读不到新值）。chat.js 异常时
  // 保留旧 store 读路径兜底，行为不变。
  try {
    if (window.getMyEmojiGroups) {
      const g = window.getMyEmojiGroups();
      if (Array.isArray(g) && g.length) return onlyData(g);
    }
  } catch (e) {}
  try {
    const v = JSON.parse(window.xyStore('xy-home-v2').get('my-emoji-groups') || 'null');
    return Array.isArray(v) ? onlyData(v) : [];
  } catch (e) { return []; }
}
function openComStickerPanel() {
  const host = document.getElementById('feed-comment-panel');
  if (!host) return;
  // v3.5.79：父容器 #feed-comment-panel 模板默认 hidden——必须先显示，否则子面板永远看不到（点击无反应）
  host.hidden = false;
  if (!comStickerPanel) {
    comStickerPanel = document.createElement('div');
    // 内容样式复用聊天表情面板，定位改为相对 #feed-comment-panel（紧贴评论条上方）
    comStickerPanel.className = 'poke-card emoji-card';
    comStickerPanel.style.position = 'absolute';
    comStickerPanel.style.top = 'auto';
    comStickerPanel.style.bottom = '0';
    comStickerPanel.style.left = '0';
    comStickerPanel.style.right = '0';
    comStickerPanel.style.maxHeight = '46vh';
    comStickerPanel.style.padding = '12px 14px';
    comStickerPanel.innerHTML =
      '<div class="emoji-head">' +
        '<div class="emoji-tabs">' +
          '<button class="emoji-tab sel" data-cs-tab="ta">TA \u7684\u8868\u60c5\u5305</button>' +
          '<button class="emoji-tab" data-cs-tab="mine">\u6211\u7684\u8868\u60c5\u5305</button>' +
          '<button class="emoji-tab" data-cs-tab="em">emoji \u8868\u60c5</button>' +
        '</div>' +
        '<button class="poke-card-close" data-cs="1">\u2715</button>' +
      '</div>' +
      '<div class="emoji-groups" id="com-sticker-groups"></div>' +
      '<div class="poke-card-scroll" style="min-height:100px;max-height:34vh" id="com-sticker-list"></div>';
    host.appendChild(comStickerPanel);
    // v3.5.79：关闭时同时隐藏父容器（避免空面板挡住下方评论条）
    function closeComSticker() {
      comStickerPanel.hidden = true;
      host.hidden = true;
    }
    comStickerPanel.querySelector('[data-cs]').addEventListener('click', (e) => { e.stopPropagation(); closeComSticker(); });
    comStickerPanel.addEventListener('click', (e) => { if (e.target === comStickerPanel) closeComSticker(); });
    comStickerPanel.querySelectorAll('[data-cs-tab]').forEach(tb => tb.addEventListener('click', (e) => {
      e.stopPropagation();
      comStickerTab = tb.getAttribute('data-cs-tab');
      comStickerCur = '';
      comStickerPanel.querySelectorAll('[data-cs-tab]').forEach(x => x.classList.toggle('sel', x === tb));
      renderComStickerBar();
      renderComStickerList();
      // v3.12.x：点完即失焦——部分安卓浏览器对聚焦按钮画虚线框（与聊天面板同修）
      try { tb.blur(); } catch (err) {}
    }));
  }
  function renderComStickerBar() {
    const groupsBar = document.getElementById('com-sticker-groups');
    if (!groupsBar) return;
    groupsBar.innerHTML = '';
    const groups = comStickerGroups();
    if (comStickerCur && !groups.some(g => g[0] === comStickerCur)) comStickerCur = '';
    const chips = groups.filter(g => g[1].length).map(g => [g[0], g[0] + g[1].length]);
    chips.forEach(([val, label]) => {
      const c = document.createElement('span');
      c.className = 'emoji-g-chip' + (comStickerCur === val ? ' sel' : '');
      c.textContent = label;
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        comStickerCur = (comStickerCur === val ? '' : val);
        renderComStickerList();
      });
      groupsBar.appendChild(c);
    });
  }
  function renderComStickerList() {
    const list = document.getElementById('com-sticker-list');
    if (!list) return;
    list.innerHTML = '';
    const groups = comStickerGroups();
    if (!groups.length) {
      list.innerHTML = '<div class="ta-empty">\u6682\u65e0\u8868\u60c5\u5305\uff0c\u8bf7\u5230\u81ea\u5b9a\u4e49\u5b57\u5361 \u2192 \u8868\u60c5\u5305 \u4e0a\u4f20</div>';
      return;
    }
    // #847：emoji tab 只有一个内置分组（且条目是文本不是图片），不必再点一次分组条
    const isEmoji = comStickerTab === 'em';
    if (!comStickerCur && !isEmoji) {
      list.innerHTML = '<div class="emoji-empty">\u70b9\u51fb\u4e0a\u65b9\u5206\u7ec4\u67e5\u770b\u8868\u60c5\u5305</div>';
      return;
    }
    const g = isEmoji ? groups[0] : groups.find(x => x[0] === comStickerCur);
    if (!g || !g[1].length) { list.innerHTML = '<div class="ta-empty">\u8be5\u5206\u7ec4\u6682\u65e0\u8868\u60c5\u5305</div>'; return; }
    const h = document.createElement('div');
    h.className = 'cc-group-header';
    h.innerHTML = '<span class="ccg-name">' + esc(g[0]) + '</span><span class="ccg-count">' + g[1].length + '</span>';
    list.appendChild(h);
    const grid = document.createElement('div');
    grid.className = isEmoji ? 'emoji-grid emoji-grid-text emoji-grid-emoji' : 'emoji-grid'; // 复用聊天 4 列网格样式
    g[1].forEach(src => {
      const d = document.createElement('div');
      if (isEmoji) {
        // FIX 2026-09-19 #847：emoji 是文本，只能进输入框（走下面的 img 分支会把 emoji 字符串当图片 src 变成坏图）
        d.className = 'emoji-item emoji-text-item';
        d.textContent = src;
        d.addEventListener('click', (e) => {
          e.stopPropagation();
          if (comInput) comInput.value = (comInput.value || '') + src;
        });
        grid.appendChild(d);
        return;
      }
      d.className = 'emoji-item';
      // v3.6.x：img 用属性赋值（dataURL 含引号时拼 innerHTML 会逃逸注入 HTML）
      const img = document.createElement('img');
      img.src = src;
      img.alt = '表情';
      d.appendChild(img);
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        // v3.5.130：评论图片上限 9 张（与发布一致）——无限累积会撑爆存储配额
        if (comImgData.length >= 9) { toast('最多附带 9 张图片/表情'); return; }
        comImgData.push(src); // 表情包作为图片加入评论（不塞输入框文本）
        renderComPv();
        comStickerPanel.hidden = true;
        const hostEl = document.getElementById('feed-comment-panel');
        if (hostEl) hostEl.hidden = true;
        if (comInput) comInput.focus();
      });
      grid.appendChild(d);
    });
    list.appendChild(grid);
  }
  // v3.12.x：每次打开按「隐藏联系人的表情包」开关（聊天设置，全局键 hide-ta-sticker）
  // 决定默认 tab——开启时隐藏 TA 的表情包 tab、只显示我的表情包（与聊天面板同口径）
  let htsHide = false;
  try { if (window.xyStore) htsHide = window.xyStore('xy-home-v2').get('hide-ta-sticker') === '1'; } catch (e) {}
  const taTabBtn = comStickerPanel.querySelector('[data-cs-tab="ta"]');
  if (taTabBtn) taTabBtn.hidden = htsHide;
  const defTab = htsHide ? 'mine' : 'ta';
  comStickerTab = defTab;
  comStickerCur = '';
  comStickerPanel.querySelectorAll('[data-cs-tab]').forEach(x => x.classList.toggle('sel', x.getAttribute('data-cs-tab') === defTab));
  renderComStickerBar();
  renderComStickerList();
  comStickerPanel.hidden = false;
}
if (comSticker) comSticker.addEventListener('click', (e) => { e.stopPropagation(); openComStickerPanel(); });
// 评论图片：压缩后加入评论图片列表（输入框上方缩略图预览）；
// busy 锁 + preventDefault 防止移动端 file 选择器关闭后 click 二次触发（重复弹窗）
let comImgBusy = false;
if (comImg) {
  comImg.addEventListener('click', (e) => {
    // FIX 2026-09-21 #1002：这次点击若落在「真·可点 input 层」上（本入口已铺），**不能再 preventDefault**
    // ——preventDefault 会取消这次 click 的默认动作，而「弹系统选择器」正是真 input 的默认动作
    // ⇒ 内核（尤其国产）会照此静默不弹＝用户看到的「点了没反应」。只对非 surface 的点击保留原抑制
    //（原用途：防移动端选择器关闭后补发的二次 click 重复弹窗）。
    if (!(e.target && e.target.closest && e.target.closest('input[data-file-pick-surface]'))) e.preventDefault();
    e.stopPropagation();
    if (comImgBusy) return;
    comImgBusy = true;
    // FIX 2026-09-18 #755：原来用 fi.style.display='none'（#717/#738 点名要消灭的写法，部分内核
    // 对不可见 input 拒绝激活）＋无 label 兜底＋accept 迟到。统一走 window.mochiFilePick 常驻复用，
    // 不再每次点按现场 new 一个 input 再 remove，也不再用 5s 定时器猜「取消」。
    let settled = false;
    const done = () => { if (settled) return; settled = true; comImgBusy = false; };
    window.mochiFilePick({
      id: 'mochi-com-img-pick', accept: 'image/*',
      onFiles: (files) => {
        done();
        const f = files && files[0];
        if (!f) { toast('没有取到图片，请再选一次'); return; }
        const reader = new FileReader();
        reader.onload = () => {
          compressCommentImg(reader.result, 240).then(data => {
            if (!data) { toast('图片过大或格式不支持'); return; }
            comImgData.push(data);
            renderComPv();
            if (comInput) comInput.focus();
          });
        };
        reader.onerror = () => toast('图片读取失败，请换一张再试');
        reader.readAsDataURL(f);
      }
    });
  });
}
function submitComment() {
  const val = comInput ? comInput.value.trim() : '';
  // 图文混排：文字 + 携带的图片（dataURL，空格分隔，每张图即 1 个字卡）
  const content = (val + (comImgData.length ? (val ? ' ' : '') + comImgData.join(' ') : '')).trim();
  if (!content || !comPid) return;
  const pid = comPid;
  const list = load();
  const p = list.find(x => x.id === pid);
  if (!p) return;
  // v3.5.58：回复模式——写入该评论的回复区（不是新评论）；否则新增评论
  if (comReplyTarget && p.comments && p.comments[comReplyTarget.ci]) {
    const tc = p.comments[comReplyTarget.ci];
    tc.replies = tc.replies || [];
    // v3.7.x：多桌面——回应用「被回复评论作者」的桌面身份/字卡/设置（评论可能是
    // 其他桌面联系人的 TA 发的，不能再一律用动态所属桌面）
    const tcOwner = (tc && tc.owner) || p.owner || 'default';
    // v3.14.x：记录被回复人昵称快照 to——ri 指定楼内某条回复时对那位作者，否则原评论
    // 作者；渲染「A 回复 B」的 B 不再永远等于原评论作者（修复 TA 回应我的回复显示成
    // 「TA 回复 TA」），旧数据无 to 由渲染端按发言轮次推断兜底
    let toName = tc.authorName || (((tc.role || tc.by) === 'me') ? feedUserName() : taFeedNameFor(tcOwner));
    if (comReplyTarget.ri != null) {
      const tr = tc.replies[comReplyTarget.ri];
      if (tr) toName = tr.authorName || ((((tr.role || tr.by) === 'me') ? feedUserName() : taFeedNameFor(tr.owner || tcOwner)));
    }
    tc.replies.push(stampAuthor({ content: content, ts: Date.now(), to: toName }, activeMe()));
    save(list);
    // v3.5.130：调度定时器前捕获回复下标——hideCommentBar 会把 comReplyTarget 置 null，
    // 回调里再读必现 TypeError（TA 回应回复 100% 失效）
    const replyCi = comReplyTarget.ci;
    hideCommentBar();
    refreshPostCard(pid);
    // TA 有概率回应我的回复（写回复区 + 消息提醒）
    const tcfg = feedCfgFor(tcOwner);
    if (Math.random() * 100 < tcfg.replyProb) {
      const cfg = tcfg;
      setTimeout(() => {
        const list2 = load();
        const p2 = list2.find(x => x.id === pid);
        if (!p2 || !p2.comments || !p2.comments[replyCi]) return;
        p2.comments[replyCi].replies = p2.comments[replyCi].replies || [];
        const replyText = pickReplyContent(cfg, tcOwner);
        const replies = p2.comments[replyCi].replies;
        // v3.14.x：TA 回应的目标是我——to 取本楼最后一条我的回复的昵称快照，
        // 不再缺省渲染成「TA 回复 TA」（回应对象=被回复评论作者的老 bug）
        let myToName = feedUserName();
        for (let i = replies.length - 1; i >= 0; i--) {
          const x = replies[i];
          if ((x.role || x.by) === 'me') { myToName = x.authorName || myToName; break; }
        }
        replies.push(stampAuthor({ content: replyText, ts: Date.now(), to: myToName }, taAuthorOfCid(tcOwner)));
        save(list2);
        refreshPostCard(pid);
        // v3.11.x：通知带评论/回复定位（点击直接闪到这条回复）
        addNotice('comment', p2.id, taFeedNameFor(tcOwner) + ' 回复了你：' + noticeTextClean(replyText), tcOwner, { ci: replyCi, ri: replies.length - 1 });
      }, (cfg.replySpeedMin + Math.random() * Math.max(1, cfg.replySpeedMax - cfg.replySpeedMin)) * 1000);
    }
    return;
  }
  p.comments = p.comments || [];
  // v3.5.58：TA 评论回应内容按概率混入表情包（使用表情包概率）
  // v3.7.x：评论回应用「动态所属桌面」TA 的设置/字卡库（不再混当前桌面）
  const pcfg = feedCfgFor(p.owner || 'default');
  const commentText = pickReplyContent(pcfg, p.owner || 'default');
  p.comments.push(stampAuthor({ content: content, ts: Date.now(), replies: [] }, activeMe()));
  save(list);
  hideCommentBar();
  refreshPostCard(pid);
  // TA 有概率评论回应
  if (Math.random() * 100 < pcfg.commentProb) {
    const cfg = pcfg;
    setTimeout(() => {
      const list2 = load();
      const p2 = list2.find(x => x.id === pid);
      if (!p2) return;
      p2.comments = p2.comments || [];
      const taText = pickReplyContent(cfg, p2.owner || 'default');
      p2.comments.push(stampAuthor({ content: taText, ts: Date.now(), replies: [] }, taAuthorOf(p2)));
      save(list2);
      refreshPostCard(pid);
      // v3.11.x：修复「评论联系人的朋友圈，联系人回复没有提醒」——原实现只在
      // 动态是自己的（role==='me'）时才发通知，评论 TA 的动态后 TA 回你评论完全无感知。
      // 改为两种情况都通知：我的动态→「评论了你的动态」；TA 的动态→「回复了你的评论」，
      // 并带上内容预览与定位（点击通知直接闪到那条评论）。
      const taName2 = p2.taName || taFeedNameFor(p2.owner || 'default');
      const loc = { ci: p2.comments.length - 1 };
      if ((p2.role || p2.by) === 'me') addNotice('comment', p2.id, taName2 + ' 评论了你的动态：' + noticeTextClean(taText), p2.owner || 'default', loc);
      else addNotice('comment', p2.id, taName2 + ' 回复了你的评论：' + noticeTextClean(taText), p2.owner || 'default', loc);
    }, (cfg.commentSpeedMin + Math.random() * Math.max(1, cfg.commentSpeedMax - cfg.commentSpeedMin)) * 1000);
  }
}
if (comSend) comSend.addEventListener('click', submitComment);
if (comInput) comInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submitComment(); } });
  // ================= 通知提醒（TA 点赞/评论/发布动态 → 未读角标 + 列表 + 点击跳转） =================
  // v3.5.81：通知文本里的 dataURL（表情包/图片）清洗为 [表情包]，避免乱码长串；面板显示缩略图
  function noticeTextClean(s) {
    return String(s || '').replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[表情包]').replace(/@@m:[0-9a-f]{32}/g, '[表情包]');
  }
  function notices() { try { return JSON.parse(store.get('feed-notices') || '[]'); } catch (e) { return []; } }
  function saveNotices(list) { store.set('feed-notices', JSON.stringify(list)); }
  // v3.5.107：朋友圈前台弹窗辅助——当前是否在朋友圈页（在朋友圈页内时通知不弹横幅）
  function feedPageVisible() {
    return ['page-feed', 'page-feed-all'].some(id => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
  }
  // 打开朋友圈页（渲染 + 清桌面未读角标），供朋友圈图标点击与弹窗点击共用
  function openFeedPage() {
    clearFeedAppUnread();
    render();
    renderNoticeBadge();
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const fp = document.getElementById('page-feed');
    if (fp) fp.hidden = false;
  }
  // v3.7.x：owner 参数=动态所属联系人（跨桌面通知弹窗/列表头像按发布者取，
  // 不再一律显示当前桌面的 TA 头像/昵称）
  // v3.11.x：loc={ci, ri} 评论/回复定位——通知点击直接滚动闪烁到具体评论/回复，
  // 列表项按 loc 从当前动态数据实时取首图渲染缩略图（不额外存储，动态删了就不显示）
  function addNotice(type, pid, text, owner, loc) {
    const list = notices();
    const item = { type: type, pid: pid, text: text, ts: Date.now(), read: false, owner: owner || '' };
    if (loc && loc.ci != null) item.ci = loc.ci;
    if (loc && loc.ri != null) item.ri = loc.ri;
    list.unshift(item);
    if (list.length > 100) list.length = 100;
    saveNotices(list);
    // v3.5.100：通知新增 → 桌面「朋友圈」图标未读数 +1
    try { store.set('feed-app-unread', String(feedAppUnread() + 1)); } catch (e) {}
    renderNoticeBadge();
    // v3.5.107：新增朋友圈通知且不在朋友圈页 → 前台桌面弹窗（点击进朋友圈）
    if (window.showDeskPopup && !feedPageVisible()) {
      // v3.7.x：弹窗头像带发布者 TA 头像（跨桌面动态弹窗不显示当前桌面 TA 头像）
      // v3.27.x：avFixed 防误回退——发布者头像为空时不回退当前桌面头像（bgNotifyCheck
      // 无 avFixed 时 av 为空会兜底成当前桌面的 cs-avatar-partner，导致跨桌面显示错头像）
      const av = owner ? taAvFor(owner) : '';
      window.showDeskPopup({ name: '朋友圈', text: (window.taFit ? window.taFit(noticeTextClean(text), owner) : noticeTextClean(text)), av: av, avFixed: true, onClick: openFeedPage, isHidden: document.visibilityState === 'hidden' });
    } else if (feedPageVisible() && document.visibilityState !== 'hidden') {
      // v3.13.x：人在朋友圈页内时顶部横幅按设计不弹（v3.5.107，防遮挡）——但 TA
      // 评论/回复/点赞到达毫无感知（用户反馈：联系人回复我朋友圈评论没有提示，
      // 页内只有小角标太隐蔽）。补一条页内轻提示（cc-toast），文案与通知一致。
      let nt = noticeTextClean(text);
      if (nt.length > 40) nt = nt.slice(0, 40) + '…';
      toast(nt);
    }
  }
  function unreadCount() { return notices().filter(n => !n.read).length; }
  // v3.5.100：桌面「朋友圈」图标独立未读计数（进入朋友圈清零，不依赖通知面板的已读标记）
  function feedAppUnread() { try { return parseInt(store.get('feed-app-unread'), 10) || 0; } catch (e) { return 0; } }
  function clearFeedAppUnread() {
    try { store.set('feed-app-unread', '0'); } catch (e) {}
    renderNoticeBadge();
  }
  function renderNoticeBadge() {
    const b = document.getElementById('feed-badge');
    if (b) {
      const n = unreadCount();
      b.hidden = n === 0;
      b.textContent = n > 99 ? '99+' : String(n);
    }
    // v3.5.100：桌面「朋友圈」图标同步未读提醒（进入朋友圈清零见入口）
    const appN = feedAppUnread();
    if (window.setDeskBadge) { window.setDeskBadge('feed', appN); }
    else {
      const ab = document.getElementById('feed-app-badge');
      if (ab) {
        ab.hidden = appN === 0;
        ab.textContent = appN > 99 ? '99+' : String(appN);
      }
    }
  }
  function jumpToPost(pid, ci, ri) {
    const el = feedPostEl(pid);
    if (!el) return;
    // v3.11.x：带评论/回复定位——优先滚动闪烁到具体那条评论/回复（找不到回退整条动态）
    let target = el;
    if (ci != null && ci !== '') {
      const cEl = el.querySelector('.feed-comment[data-ci="' + ci + '"]');
      if (cEl) {
        const rEl = (ri != null && ri !== '') ? cEl.querySelector('.feed-reply[data-ri="' + ri + '"]') : null;
        target = rEl || cEl;
      }
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('feed-flash');
    void target.offsetWidth;
    target.classList.add('feed-flash');
  }
  // v3.11.x：通知项缩略图——按 ci/ri 从动态数据实时取内容里的首张图
  //（不落盘存储，避免撑大通知键；动态已删/无图返回空）
  // posts 由调用方传入（renderNotices 每次 render 只 load() 一次，
  // 逐条调用会把全量动态 JSON.parse 上百次）
  function noticeThumbOf(n, posts) {
    try {
      if (!n || n.type !== 'comment' || n.ci == null) return '';
      const p = (posts || []).find(x => x.id === n.pid);
      if (!p || !p.comments || !p.comments[n.ci]) return '';
      const src = (n.ri != null && Array.isArray(p.comments[n.ci].replies) && p.comments[n.ci].replies[n.ri])
        ? p.comments[n.ci].replies[n.ri].content
        : p.comments[n.ci].content;
      const m = /(?:data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+|@@m:[0-9a-f]{32})/.exec(String(src || ''));
      return m ? m[0] : '';
    } catch (e) { return ''; }
  }
  function renderNotices() {
    const listEl = document.getElementById('feed-notice-list');
    if (!listEl) return;
    const list = notices();
    // v3.11.x：整次渲染只 load() 一次，供缩略图查动态数据（防逐条全量解析）
    const postsForThumbs = load();
    // v3.5.59：每条提醒显示联系人头像
    // v3.7.x：跨桌面——通知头像按通知记录里的 owner（动态发布者）取，旧通知无 owner 回退当前桌面
    const avFor = (n) => { try { const v = n && n.owner ? taAvFor(n.owner) : partnerAv(); return v || ''; } catch (e) { return ''; } };
    const avHtml = (data) => data
      ? '<span class="fn-av"><img src="' + attrEsc(data) + '" alt=""></span>'
      : '<span class="fn-av"><svg viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg></span>';
    listEl.innerHTML = list.length
      ? list.map(n => {
          const ico = n.type === 'like'
            ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>'
            : n.type === 'comment'
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
          // v3.11.x：评论类通知带内容首图缩略图——回复的是表情包/图片时直接可见，
          // 不再只显示「[表情包]」占位字（用户反馈"回复了图片但只有两个字不知道是啥"）
          const thumb = noticeThumbOf(n, postsForThumbs);
          const thumbHtml = thumb ? '<img class="fn-thumb" src="' + attrEsc(thumb) + '" alt="">' : '';
          return '<div class="feed-notice-item' + (n.read ? '' : ' new') + '" data-pid="' + n.pid + '" data-ci="' + (n.ci != null ? n.ci : '') + '" data-ri="' + (n.ri != null ? n.ri : '') + '">' + avHtml(avFor(n)) + '<span class="fn-ico">' + ico + '</span><span class="fn-text">' + (window.taFit ? window.taFit(noticeTextClean(n.text), n.owner) : noticeTextClean(n.text)) + '</span>' + thumbHtml + '<span class="fn-time">' + fmtDT(n.ts) + '</span></div>';
        }).join('')
      : '<div class="ta-empty">暂时没有新的提醒</div>';
    listEl.querySelectorAll('.feed-notice-item').forEach(it => it.addEventListener('click', () => {
      document.getElementById('feed-notice-panel').hidden = true;
      const ci = it.dataset.ci === '' ? null : Number(it.dataset.ci);
      const ri = it.dataset.ri === '' ? null : Number(it.dataset.ri);
      jumpToPost(it.dataset.pid, ci, ri);
    }));
    // v3.11.x：点缩略图直接看大图（不触发跳转）
    listEl.querySelectorAll('.fn-thumb').forEach(t => t.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.viewChatImage) window.viewChatImage(t.src);
    }));
  }
  // 发布框：添加多张图片（每张压缩后存 dataURL，与文字混排进正文，同一张图片即 1 个字卡）
  // v3.7.x：同评论输入框——预标记 ceDone 跳过 ce-box 转换（OPPO Edge 对 ce-box 聚焦/输入失效）
  const feedInput = document.getElementById('feed-input');
  if (feedInput) feedInput.dataset.ceDone = '1';
  const pickBtn = document.getElementById('feed-pick-img');
  // FIX 2026-09-21 #1002：发布框「添加图片」铺真·可点 input 层（owner＝统一入口那个多选 input）
  if (pickBtn && window.mochiFilePickSurface) window.mochiFilePickSurface(pickBtn, { id: 'feed-pick-tap', accept: 'image/*', multiple: true, owner: 'dev-feed-pick-img' });
  const preview = document.getElementById('feed-preview');
  let pickedImgs = [];
  const MAX_PICK = 9;
  function renderPreview() {
    if (!preview) return;
    preview.innerHTML = '';
    pickedImgs.forEach((d, i) => {
      // v3.6.x：img 用属性赋值（dataURL 含引号时拼 innerHTML 会逃逸注入 HTML）
      const span = document.createElement('span');
      span.className = 'feed-pv';
      const img = document.createElement('img');
      img.src = d;
      img.alt = '';
      const delBtn = document.createElement('button');
      delBtn.className = 'feed-preview-del';
      delBtn.dataset.i = i;
      delBtn.textContent = '✕';
      span.appendChild(img);
      span.appendChild(delBtn);
      preview.appendChild(span);
    });
    preview.hidden = pickedImgs.length === 0;
    preview.querySelectorAll('.feed-preview-del').forEach(b => b.addEventListener('click', () => {
      pickedImgs.splice(parseInt(b.dataset.i, 10), 1);
      renderPreview();
    }));
  }
  if (pickBtn) {
    // FIX 2026-09-18 #755：收编进统一入口——原 #feed-pick-file 写在 template.html 里带 hidden 属性
    // （＝display:none），部分国产内核拒绝激活不可见 input＝点「添加图片」毫无反应。节点改由
    // device.js 常驻 sr-only clip 提供，本处只管回调。
    pickBtn.addEventListener('click', () => {
      window.mochiFilePick({
        id: 'dev-feed-pick-img',
        accept: 'image/*',
        multiple: true,
        onFiles: (files) => {
          if (!files.length) return;
          if (pickedImgs.length + files.length > MAX_PICK) { toast('最多发布 ' + MAX_PICK + ' 张图片'); }
          files.slice(0, MAX_PICK - pickedImgs.length).forEach(f => {
            compressImage(f, (dataUrl) => {
              pickedImgs.push(dataUrl);
              renderPreview();
            });
          });
        }
      });
    });
  }
  // ===== 朋友圈封面交互（v3.5.62：直接点击，不用相机按钮） =====
  //  - 点封面背景 → 更换背景（已有背景可更换/恢复默认）
  //  - 点封面我的头像 → 更换头像（与桌面「我」头像一致）
  //  - 点封面我的昵称 → 修改昵称（与桌面昵称一致）
  const coverEl = document.getElementById('feed-cover');
  const coverAvEl = document.getElementById('feed-my-av');
  const coverNameEl = document.getElementById('feed-my-name');
  // FIX 2026-09-18 #755：封面背景的 file input 原写在 template.html（hidden 属性＝display:none）
  // → 收编进统一入口，按需惰性创建（点封面时才有回调），不再持有模板节点。
  function pickCoverBg() {
    window.mochiFilePick({
      id: 'dev-feed-cover-bg',
      accept: 'image/*',
      onFiles: (files) => {
        const f = files && files[0];
        if (!f) return;
        compressImage(f, (dataUrl) => {
          window.activeStore().set('feed-cover-bg', dataUrl);
          renderCover();
          toast('朋友圈背景已更新');
        });
      }
    });
  }
  // 点封面背景 → 更换/恢复
  if (coverEl) {
    coverEl.addEventListener('click', (e) => {
      // 头像/昵称点击不触发换背景（它们自己有处理）
      if (e.target === coverAvEl || coverAvEl && coverAvEl.contains(e.target)) return;
      if (e.target === coverNameEl || coverNameEl && coverNameEl.contains(e.target)) return;
      if (coverBg()) {
        if (window.openModal) {
          window.openModal('已设置朋友圈背景', '', (v) => {
            if (v === '1') pickCoverBg();
            if (v === '2') { window.activeStore().set('feed-cover-bg', ''); renderCover(); toast('已恢复默认背景'); }
          }, { noInput: true, pills: [{ label: '更换背景', value: '1' }, { label: '恢复默认', value: '2' }] });
        }
      } else {
        pickCoverBg();
      }
    });
  }
  // 点头像 → 更换朋友圈头像（独立于聊天头像 v3.8.x，按当前桌面生效）
  // FIX 2026-09-18 #717：选择器改「常驻挂文档」（#677 同族）——原本点击时动态创建、未挂进
  // 文档就 click()：部分机型（红米/真我等 Android Edge 系）静默不弹选择器、iOS Safari 选完
  // 不保证派发 change＝点了没反应。压缩/落库管线（canvas 256 → feed-user-avatar）一字不动。
  const feedAvPickInput = document.createElement('input');
  feedAvPickInput.type = 'file'; feedAvPickInput.accept = 'image/*';
  feedAvPickInput.id = 'feed-av-pick';
  // FIX 2026-09-18 #738：sr-only clip 写法＋原生 label 兜底（device.js mochiFilePickLabel）
  feedAvPickInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
  document.body.appendChild(feedAvPickInput);
  feedAvPickInput.onchange = () => {
    const f = feedAvPickInput.files && feedAvPickInput.files[0];
    feedAvPickInput.value = ''; // 允许重选同一文件
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 256 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          window.activeStore().set('feed-user-avatar', c.toDataURL('image/jpeg', 0.85));
          renderCover();
          toast('朋友圈头像已更新');
        } catch (err) { toast('图片处理失败'); }
      };
      img.onerror = () => toast('图片读取失败');
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  if (coverAvEl) {
    // FIX 2026-09-18 #738：原生 label 激活兜底（小米浏览器对 JS 合成 click 静默不弹选择器）
    if (window.mochiFilePickLabel) window.mochiFilePickLabel(coverAvEl, feedAvPickInput);
    // FIX 2026-09-21 #1002：封面头像铺真·可点 input 层（owner＝上面那个 feed-av-pick 常驻 input；
    // 它的 onchange 管线一字未改，仍负责 256px 压缩 + 落库 + 重绘）
    if (window.mochiFilePickSurface) window.mochiFilePickSurface(coverAvEl, { id: 'feed-myav-tap', accept: 'image/*', owner: feedAvPickInput });
    coverAvEl.addEventListener('click', (e) => {
      e.stopPropagation();
      // FIX 2026-09-18 #756：原 fromLabel 早退在「label 存在但国产内核不转发」时连 JS 兜底
      // 一起跳过＝完全没反应；改为 guard 事后确认未弹出再补 click
      // FIX 2026-09-20 #920：兜底腿改走全站统一三腿（showPicker→click；小米系对合成 click 静默不弹）
      var _fb = () => { window.mochiFilePickFire(feedAvPickInput, { onFail: () => toast('无法打开相册，请重试') }); };
      if (window.mochiFilePickGuard) window.mochiFilePickGuard(feedAvPickInput, _fb);
      else _fb();
    });
  }
  // 点昵称 → 修改朋友圈昵称（独立于聊天昵称 v3.8.x，按当前桌面生效）
  if (coverNameEl) {
    coverNameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.openModal) {
        window.openModal('修改朋友圈昵称', window.activeStore().get('feed-user-name') || window.activeStore().get('lbl-user') || '我', (v) => {
          const val = (v || '').trim();
          if (val) {
            window.activeStore().set('feed-user-name', val);
            renderCover();
            toast('朋友圈昵称已更新');
          }
        }, { maxlength: 12 });
      }
    });
  }
  // 发布
  function publish() {
    const input = document.getElementById('feed-input');
    const content = input ? input.value.trim() : '';
    if (!content && !pickedImgs.length) { toast('写点什么再发布吧'); return; }
    // v3.5.95：图片独立存 imgs 数组（九宫格展示，与 TA 动态一致），不再混排进文字
    const list = load();
    const id = 'f_' + Date.now();
    const me = activeMe();
    const cs = window.activeStore();
    const taName = cs.get('lbl-partner') || 'TA';
    const taAv = cs.get('avatar-partner') || '';
    // v3.7.x：不存 authorAv/taAv（头像 dataURL）——render 有 p.authorAv||实时读 兜底，
    //   实时读当前头像即可。原实现把头像 base64 塞进每条动态，哪怕正文纯文字，
    //   头像稍大就把主键撑到 >200KB → 只进 IndexedDB 不进 localStorage → Edge 丢 IDB
    //   后纯文字动态也丢（OPPO Reno6 Edge 实现）。去掉后纯文字主键真的 <200KB 能写 LS。
    const post = { id: id, role: 'me', owner: me.owner, authorName: me.authorName, authorAv: '', taName: taName, taAv: '', content: content, imgs: pickedImgs.slice(), ts: Date.now(), likes: [], comments: [] };
    list.unshift(post);
    save(list);
    pickedImgs = [];
    renderPreview();
    if (input) input.value = '';
    renderVisible();
    // v3.7.x 兜底：render 后若列表没出现刚发布的动态（Edge 上 IDB 慢/门槛暂存时序异常），
    //   强制把 list 直接落盘 + 重渲染，确保发布后立刻可见。用户主动发布应立即持久化，
    //   绕过 save 门槛（门槛防的是 maybeAutoPost 等自动 save 覆盖，用户主动发布含完整 list）
    //   #187：仍走守卫——病理窗口下手上的 list 可能来自剥图快照，裸写会把无图版本盖进权威键
    if (!document.getElementById('feed-post-' + id)) {
      feedGuardWrite(JSON.stringify(list));
      renderVisible();
    }
    toast('已发布');
    // v3.5.59：发布后收起发布框
    const pubCardEl = document.getElementById('feed-publish-card');
    if (pubCardEl) pubCardEl.hidden = true;
    // v3.7.x：所有桌面联系人的 TA 都有概率回应我的动态（各自桌面设置/字卡库/身份）——
    // 原实现只掷当前桌面 TA。朋友圈是全局共享层，其他联系人也要能点赞/评论我。
    const allContacts = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    allContacts.forEach(ct => {
      const cid = ct && ct.id ? ct.id : 'default';
      const ccfg = feedCfgFor(cid);
      // 该桌面的 TA 有概率立即点赞
      if (Math.random() * 100 < ccfg.likeProb) {
        setTimeout(() => {
          const list2 = load();
          const p2 = list2.find(x => x.id === id);
          if (!p2) return;
          p2.likes = p2.likes || [];
          const nm = taFeedNameFor(cid);
          if (p2.likes.indexOf(nm) < 0) p2.likes.push(nm);
          save(list2);
          refreshPostCard(id);
          addNotice('like', p2.id, nm + ' 赞了你的动态', cid);
        }, (ccfg.likeSpeedMin + Math.random() * Math.max(1, ccfg.likeSpeedMax - ccfg.likeSpeedMin)) * 1000);
      }
      // 该桌面的 TA 有概率首次评论我的动态
      if (Math.random() * 100 < ccfg.commentProb) {
        setTimeout(() => {
          const list2 = load();
          const p2 = list2.find(x => x.id === id);
          if (!p2) return;
          p2.comments = p2.comments || [];
          p2.comments.push(stampAuthor({ content: pickReplyContent(ccfg, cid), ts: Date.now(), replies: [] }, taAuthorOfCid(cid)));
          save(list2);
          refreshPostCard(id);
          addNotice('comment', p2.id, taFeedNameFor(cid) + ' 评论了你的动态', cid);
        }, (ccfg.commentSpeedMin + Math.random() * Math.max(1, ccfg.commentSpeedMax - ccfg.commentSpeedMin)) * 1000);
      }
    });
    // v3.26.x：TA 收藏我的朋友圈动态——朋友圈数据全局互通（feed-posts 全局共享层），
    // 我【任意一条】动态（含历史）都可能被收藏，不限于刚发布的这条；遍历所有桌面
    // 联系人，各桌面 TA 按自己桌面的 taFeed 概率触发，收藏写入【该桌面自己】的
    // 收藏（by:'ta'，各桌面收藏隔离）；收藏 ts 用动态发布时间便于按动态判重。
    allContacts.forEach(ct => {
      const cid = ct && ct.id ? ct.id : 'default';
      const ccfg = feedCfgFor(cid);
      if (Math.random() * 100 < favFeedProbFor(cid)) {
        setTimeout(() => {
          const list2 = load();
          const mine = list2.filter(x => (x.role || x.by) === 'me');
          if (!mine.length) return;
          const pick = mine[Math.floor(Math.random() * mine.length)];
          const f = { kind: 'feed', text: pick.content || '', imgs: (pick.imgs || []).slice(), ts: pick.ts || Date.now() };
          const s = window.storeFor(cid);
          let fav = [];
          try { fav = JSON.parse(s.get('fav-msgs') || '[]'); } catch (e) { fav = []; }
          if (!Array.isArray(fav)) fav = [];
          if (fav.some(x => (x.by || 'me') === 'ta' && (x.kind || 'msg') === 'feed' && x.ts === f.ts)) return;
          fav.push(Object.assign({ by: 'ta' }, f));
          s.set('fav-msgs', JSON.stringify(fav));
          if (cid === (window.__activeCid || 'default')) {
            toast(window.taFit ? window.taFit('TA 收藏了你的朋友圈动态') : 'TA 收藏了你的朋友圈动态');
          }
        }, (ccfg.likeSpeedMin + Math.random() * Math.max(1, ccfg.likeSpeedMax - ccfg.likeSpeedMin)) * 1000);
      }
    });
  }
  // 暴露给外部模块发帖（period.js 月度报告分享等）
  window.feedAddPost = function (text, imgs) {
    try {
      const content = String(text || '').trim();
      if (!content && !(imgs && imgs.length)) return null;
      const list = load();
      const id = 'f_' + Date.now();
      const me = activeMe();
      const cs = window.activeStore();
      const taName = cs.get('lbl-partner') || 'TA';
      const post = { id: id, role: 'me', owner: me.owner, authorName: me.authorName, authorAv: '', taName: taName, taAv: '', content: content, imgs: (imgs || []).slice(), ts: Date.now(), likes: [], comments: [] };
      list.unshift(post);
      save(list);
      renderVisible();
      return id;
    } catch (e) { return null; }
  };
  // ================= TA 自动发布（定时机制，概率在回复设置-朋友圈调整，星言朋友圈机制） =================
  // v3.7.x：按「指定联系人桌面」读朋友圈回复设置（fd-*）——多桌面下各联系人
  // TA 用各自桌面的设置回应我的动态/回复；feedCfg() = 当前桌面
  // v3.23.x：default 也固定读 default 桌面——原实现 default 走 activeStore()，
  // 人停在别的桌面时 maybeAutoPostFor('default') 会拿【别桌】的 fd-* 设置
  // （fd-post-daily-max 日上限串台回默认 5 条，表现为「设了 2 条照样狂发」）
  function feedCfgFor(cid) {
    const s = window.storeFor(cid || 'default');
    const c = {};
    ['fd-like-prob', 'fd-like-speed-min', 'fd-like-speed-max', 'fd-comment-prob', 'fd-comment-speed-min', 'fd-comment-speed-max',
     'fd-reply-prob', 'fd-reply-speed-min', 'fd-reply-speed-max', 'fd-likeback-prob', 'fd-card-prob', 'fd-max-cards', 'fd-image-prob',
     'fd-post-prob', 'fd-post-daily-max', 'fd-post-cool', 'fd-min-interval', 'fd-max-interval', 'fd-post-en',
     'fd-min-cards-post', 'fd-max-cards-post', 'fd-post-kaomoji', 'fd-post-emoji', 'fd-post-sticker', 'fd-post-image'].forEach(k => {
      try {
        const v = s.get('reply-' + k);
        if (v !== null && v !== undefined && v !== '') { const n = Number(v); if (!isNaN(n)) c[k] = n; }
      } catch (e) {}
    });
    const num = (k, d) => c[k] !== undefined ? c[k] : d;
    return {
      likeProb: num('fd-like-prob', 60), likeSpeedMin: num('fd-like-speed-min', 1), likeSpeedMax: num('fd-like-speed-max', 60),
      commentProb: num('fd-comment-prob', 70), commentSpeedMin: num('fd-comment-speed-min', 1), commentSpeedMax: num('fd-comment-speed-max', 60),
      replyProb: num('fd-reply-prob', 60), replySpeedMin: num('fd-reply-speed-min', 1), replySpeedMax: num('fd-reply-speed-max', 60),
      likeback: num('fd-likeback-prob', 50),
      cardProb: num('fd-card-prob', 80), maxCards: num('fd-max-cards', 5),
      imageProb: num('fd-image-prob', 50),
      // #296：联系人主动发朋友圈总开关（默认开，关闭后 TA 不再自动发动态）
      postEn: num('fd-post-en', 1),
      postProb: num('fd-post-prob', 40), dailyMax: num('fd-post-daily-max', 5),
      postCool: num('fd-post-cool', 30),
      minInterval: num('fd-min-interval', 1), maxInterval: num('fd-max-interval', 720),
      minCardsPost: num('fd-min-cards-post', 4), maxCardsPost: num('fd-max-cards-post', 15),
      postKaomoji: num('fd-post-kaomoji', 10), postEmoji: num('fd-post-emoji', 10),
      postSticker: num('fd-post-sticker', 30), postImage: num('fd-post-image', 30)
    };
  }
  function feedCfg() {
    return feedCfgFor(window.__activeCid || 'default');
  }
  // v3.26.x：按指定桌面读 TA 收藏我动态的概率（fav-ta-feed，收藏设置页每桌面独立），
  // 供跨桌面遍历时各桌面的 TA 按各自设置掷概率，默认 30%
  function favFeedProbFor(cid) {
    try {
      const s = window.storeFor(cid);
      const v = s.get('fav-ta-feed');
      if (v === null || v === undefined || v === '') return 30;
      const n = Number(v);
      return isNaN(n) ? 30 : n;
    } catch (e) { return 30; }
  }
  function feedToday() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  // v3.7.x：发布朋友圈的系统消息写入「动态所属桌面」的聊天——maybeAutoPost 遍历
  // 所有联系人，原实现写进【当前激活桌面】的聊天（用户在 A 桌面却收到 B 的
  // 「发布了一条朋友圈动态」= 系统消息跨桌面串消息）。与 call.js notifyCallEnd
  // 同模式：当前桌面走内存链路（实时渲染）；非当前桌面直接写该桌面 IDB 聊天记录
  // + LS 快照（该桌面 msgs 已在 contact-switched 时重置，下次进入由 loadMsgs 读回）
  function notifyFeedPostToChat(cid, taName) {
    const cur = window.__activeCid || 'default';
    if (cid === cur) {
      if (window.chatAddSystem) window.chatAddSystem(taName + ' 发布了一条朋友圈动态');
      return;
    }
    // v3.14.x：改走 chat.js 统一安全追加——原「idbGet→push→整包写回」在读取
    // 超时（返回 undefined）时会把该桌面全部聊天记录覆盖成 [这一条]
    if (window.chatAppendToDeskMsg) { window.chatAppendToDeskMsg(cid, taName + ' 发布了一条朋友圈动态'); }
  }
  // 单个联系人的 TA 自动发动态（用该联系人自己的字卡 + TA 身份）
  function maybeAutoPostFor(cid) {
    try {
      const cs = window.storeFor(cid);
      const now = Date.now();
      // v3.7.x：各桌面的 TA 用各自桌面的朋友圈设置（原实现用当前桌面 cfg，串设置）
      const cfg = feedCfgFor(cid);
      // #296：联系人主动发朋友圈总开关——关闭后该桌面 TA 不再自动发动态（点赞/评论互动不受影响）
      if (!cfg.postEn) return;
      let last = parseInt(cs.get('feed-last'), 10); if (isNaN(last)) last = 0;
      let next = parseFloat(cs.get('feed-next')); if (isNaN(next)) next = 0;
      if (last > now || last < 0) { last = 0; next = 0; }
      if ((now - last) / 60000 < next) return;
      let dayCount = (function () { try { return JSON.parse(cs.get('feed-day-count') || '0'); } catch (e) { return 0; } })();
      const today = feedToday();
      if (dayCount.t !== today) dayCount = { t: today, n: 0 };
      if (dayCount.n >= cfg.dailyMax) { cs.set('feed-next', String(cfg.postCool)); return; }
      if (Math.random() * 100 >= cfg.postProb) {
        cs.set('feed-next', String(cfg.minInterval + Math.random() * Math.max(1, cfg.maxInterval - cfg.minInterval)));
        return;
      }
      // 内容取该联系人桌面的字卡库
      const g = genPostContent(cfg, cid);
      const taName = cs.get('lbl-partner') || 'TA';
      const taAv = cs.get('avatar-partner') || '';
      const list = load();
      const post = { id: 'f_' + Date.now() + '_' + cid, role: 'ta', owner: cid, authorName: taName, authorAv: '', taName: taName, taAv: '', content: g.content, imgs: g.imgs, ts: Date.now(), likes: [], comments: [] };
      list.unshift(post);
      save(list);
      cs.set('feed-last', String(now));
      cs.set('feed-next', String(cfg.minInterval + Math.random() * Math.max(1, cfg.maxInterval - cfg.minInterval)));
      cs.set('feed-day-count', JSON.stringify({ t: today, n: dayCount.n + 1 }));
      notifyFeedPostToChat(cid, taName);
      addNotice('post', post.id, taName + ' 发布了一条新动态', cid);
      renderVisible();
    } catch (e) {}
  }
  // 遍历所有联系人：每个联系人的 TA 都可能自动发动态（朋友圈共享）
  function maybeAutoPost() {
    const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    list.forEach(c => maybeAutoPostFor(c.id));
  }
  setTimeout(() => {
    setInterval(maybeAutoPost, 60000);
    maybeAutoPost();
  }, (120 + Math.random() * 180) * 1000);

  // ================= 全部朋友圈（v3.5.63：点头像进入，封面背景/头像/昵称可直接修改） =================
  let feedAllCid = 'default';
  // FIX 2026-09-19 #811 用户实报（vivo S9 Chrome 等，多机型同现）：多联系人下「个人朋友圈」串身份。
  //   本页原按「桌面」过滤（owner===cid，我的动态同桌也并进来）且背景优先读「我」的封面，于是：
  //   ①进 B 的个人页，B 桌面上我的动态全被并进来；②B 没设 TA 封面而设过我的朋友圈背景时，
  //   B 的个人页整页背景显示成我的背景；③点我自己动态的头像（owner=发布时所在桌面）进的还是
  //   同一个桌面页＝「进我的朋友圈显示成了 B 的」。改为按「人」两形态：who='ta' 只看该桌面 TA
  //   的动态（背景=该桌面 feed-ta-cover）；who='me' 只看我的全部动态（跨桌面，身份/背景=当前
  //   桌面 feed-user-*／feed-cover-bg，与主朋友圈封面同口径）。
  let feedAllWho = 'ta';
  // v3.6.x：多桌面——全部朋友圈页读写「该联系人桌面」的数据（storeFor(cid)），
  // 背景/头像/昵称按 cid 独立；me 身份用 avatar-user/lbl-user/feed-cover-bg，
  // ta 身份用 feed-ta-avatar/feed-ta-name/feed-ta-cover（与主朋友圈一致）。
  function feedAllStore() { return window.storeFor(feedAllCid); }
  function feedAllBg() {
    // #811 背景跟人走：TA 页只读该桌面 feed-ta-cover（根键仅旧数据回退），不再被「我的封面」
    // 顶掉（原「我的封面优先」＝B 没设 TA 封面时个人页背景显示成我的朋友圈背景）；我的页面读
    // 当前桌面 feed-cover-bg（与主朋友圈封面同口径）
    const s = feedAllStore();
    if (feedAllWho === 'me') {
      const me = s.get('feed-cover-bg');
      if (me) return safeBg(me, 'feed-cover-bg', s);
      return safeBg(store.get('feed-cover-bg'), 'feed-cover-bg', store);
    }
    const ta = s.get('feed-ta-cover');
    if (ta) return safeBg(ta, 'feed-ta-cover', s);
    // 根键旧数据回退仅限 default 桌面（对齐 taAvFor/taFeedNameFor 口径）——
    // 老全局封面是 default 桌面的历史数据，回退给非 default 联系人＝另一种跨桌串背景
    if (feedAllCid === 'default') return safeBg(store.get('feed-ta-cover'), 'feed-ta-cover', store);
    return '';
  }
  function renderFeedAllCover() {
    const cover = document.getElementById('feed-all-cover');
    const avEl = document.getElementById('feed-all-av');
    const nameEl = document.getElementById('feed-all-name');
    if (!cover) return;
    const bg = feedAllBg();
    if (bg) { cover.style.backgroundImage = 'url("' + bg + '")'; cover.classList.add('has-bg'); }
    else { cover.style.backgroundImage = ''; cover.classList.remove('has-bg'); }
    // #811 我的个人页：封面即主朋友圈「我」的身份（当前桌面 feed-user-*，回退聊天身份）
    if (feedAllWho === 'me') {
      if (avEl) { const mav = feedUserAv(); avEl.innerHTML = mav ? '<img src="' + attrEsc(mav) + '" alt="">' : ''; }
      if (nameEl) nameEl.textContent = feedUserName();
      // FIX 2026-09-21 #1002：头像节点被重写后补挂「真·可点 input 层」（幂等，见 device.js）
      try { if (avEl && window.mochiFilePickSurface) window.mochiFilePickSurface(avEl, { id: 'feed-allav-tap', accept: 'image/*', owner: 'mochi-feed-allav-pick' }); } catch (e) {}
      return;
    }
    const c = (window.getContacts && window.getContacts().find(x => x.id === feedAllCid)) || { name: feedAllCid };
    // 该联系人桌面的 TA 头像（feed-ta-avatar），回退该桌面 TA 聊天头像
    if (avEl) {
      const s = feedAllStore();
      let av = s.get('feed-ta-avatar');
      if (av) { av = safeBg(av, 'feed-ta-avatar', s); }
      if (!av) { av = store.get('feed-ta-avatar'); av = safeBg(av, 'feed-ta-avatar', store); }
      if (!av) av = s.get('avatar-partner') || '';
      avEl.innerHTML = av ? '<img src="' + attrEsc(av) + '" alt="">' : '';
    }
    if (nameEl) nameEl.textContent = c.name || feedAllCid;
    // FIX 2026-09-21 #1002：同上——重写头像节点后幂等补挂真·可点 input 层
    try { if (avEl && window.mochiFilePickSurface) window.mochiFilePickSurface(avEl, { id: 'feed-allav-tap', accept: 'image/*', owner: 'mochi-feed-allav-pick' }); } catch (e) {}
  }
  // v3.7.x：全部朋友圈页渲染（从 openFeedAll 拆出，供点赞/评论/回复后局部刷新——
  // 原实现渲染只绑删除/图片，页面上没有评论按钮、点评论也无回复绑定，用户在该页
  // 无法评论/回复（跨桌面查看联系人动态时最常见的操作路径）
  // v3.10.x：单张动态卡片 HTML（全部朋友圈页模板）——renderFeedAll 与局部刷新共用
  function postCardHtmlAll(p) {
    const isMine = (p.role || p.by) === 'me';
    // v3.8.x：'me' 动态作者/头像也读朋友圈独立身份
    // #811：身份回退按动态所属桌面取（我的页跨桌面展示时，不再全按当前页桌面取我的名字/头像）
    const author = p.authorName || (isMine ? feedUserNameFor(p.owner || feedAllCid) : taFeedNameFor(p.owner || feedAllCid));
    // v3.7.x：头像按动态所属桌面取（该页动态 owner===feedAllCid，直接取该桌面）
    const av = p.authorAv || (isMine ? feedUserAvFor(p.owner || feedAllCid) : taAvFor(p.owner || feedAllCid));
    const likes = p.likes && p.likes.length
      ? '<div class="feed-likes" style="font-size:11px;color:var(--muted);padding:6px 2px">' + esc(p.likes.join('、')) + ' 觉得很赞</div>'
      : '';
    const liked = p.likes && p.likes.some(l => l === feedUserName());
    const faved = favFeedHas(p);
    // v3.7.x：与主列表一致的点赞/评论入口（原全部朋友圈页缺这两个按钮）
    return '<div class="feed-post" id="feed-post-' + p.id + '"><div class="feed-head">' + avHtml(av) +
      '<div class="feed-who"><div class="feed-name">' + esc(author) + '</div><div class="feed-time">' + fmtDT(p.ts) + '</div></div>' +
      '<button class="feed-del" data-id="' + p.id + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/></svg></button></div>' +
      '<div class="feed-content">' + contentHtmlFor(p) + '</div>' +
      '<div class="feed-actions">' +
      '<button class="feed-act' + (liked ? ' liked' : '') + '" data-like="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>赞</button>' +
      '<button class="feed-act" data-comment="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8z"/><circle cx="8.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/></svg>评论</button>' +
      // #302 贴纸回复 / #845：按钮常驻——纯文字动态也画（点开由空白底纸承接落位），不再「有配图才有这个功能」
      '<button class="feed-act" data-sticker="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 007 0"/><circle cx="9" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1" fill="currentColor" stroke="none"/></svg>贴纸</button>' +
      '<button class="feed-act feed-fav' + (faved ? ' faved' : '') + '" data-fav="' + p.id + '"><svg viewBox="0 0 24 24" fill="' + (faved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/></svg>收藏</button>' +
      '</div>' + likes +
      commentsHtmlFor(p, author) + '</div>';
  }
  function renderFeedAll() {
    const listEl = document.getElementById('feed-all-list');
    if (!listEl) return;
    // #811 按人过滤：我的页＝我跨桌面的全部动态；TA 页＝该桌面 TA 的动态（我的动态不再并入）
    const isMePage = feedAllWho === 'me';
    const inPage = isMePage
      ? (p) => (p.role || p.by) === 'me'
      : (p) => (p.owner || 'default') === feedAllCid && (p.role || p.by) !== 'me';
    const title = document.getElementById('feed-all-title');
    if (title) {
      if (isMePage) title.textContent = '我的朋友圈';
      else {
        const c = (window.getContacts && window.getContacts().find(x => x.id === feedAllCid)) || { name: feedAllCid };
        title.textContent = (c.name || feedAllCid) + ' 的全部朋友圈';
      }
    }
    const posts = load().filter(inPage).sort((a, b) => b.ts - a.ts);
    // v3.12.x：与主列表同口径窗口化（FEED_RENDER_MAX + 查看更早），防整页全量位图解码
    feedShownAll = Math.min(posts.length, FEED_RENDER_MAX);
    listEl.innerHTML = posts.length
      ? posts.slice(0, feedShownAll).map(p => postCardHtmlAll(p)).join('') +
        (posts.length > feedShownAll ? feedMoreBtnHtml(posts.length - feedShownAll) : '')
      : ((window.mochiDataPending && window.mochiDataPending())
        ? window.mochiLoadingHtml(isMePage ? '我的动态' : '该联系人的动态')
        : '<div class="ta-empty">还没有动态</div>');
    // v3.7.x：全部朋友圈页与主列表共用事件绑定——点赞/评论/回复/删除/图片放大全可用
    //（bindEvents 里的 .feed-head-av 该页无此元素，自动跳过）
    bindEvents(listEl);
    renderFeedAllCover();
  }
  function openFeedAll(cid, who) {
    // v3.5.130：进全部朋友圈前重置评论条（否则返回后旧回复目标/草稿残留，发错位置）
    hideCommentBar();
    // #811：who='me'＝我的个人页（feedAllCid 归当前桌面，封面/编辑写「我」的键）；缺省 'ta' 保持原桌面页
    feedAllWho = who === 'me' ? 'me' : 'ta';
    feedAllCid = feedAllWho === 'me' ? (window.__activeCid || 'default') : (cid || window.__activeCid || 'default');
    renderFeedAll();
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const ap = document.getElementById('page-feed-all');
    if (ap) ap.hidden = false;
  }
  const feedAllBack = document.getElementById('feed-all-back');
  if (feedAllBack) {
    feedAllBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      feedPage.hidden = false;
      render();
    });
  }
  // 全部朋友圈封面：点背景换背景、点头像换头像、点昵称改昵称（每个联系人桌面各自独立）
  // v3.6.x：写入 storeFor(feedAllCid)（该联系人自己的命名空间）——TA 身份
  // 用 feed-ta-* 键；「我」在默认桌面的主朋友圈封面操作仍走 activeStore。
  const feedAllCover = document.getElementById('feed-all-cover');
  const feedAllAv = document.getElementById('feed-all-av');
  const feedAllName = document.getElementById('feed-all-name');
  // FIX 2026-09-21 #1002：全部朋友圈页头像铺真·可点 input 层（owner＝统一入口那个 input id；
  // 该 input 点按时才建，这里只登记 id）。注意封面容器 #feed-all-cover 内还有头像与昵称两个可点元素，
  // 不给它铺层（铺了会吞掉头像/昵称的点击）——只铺头像本身。
  if (feedAllAv && window.mochiFilePickSurface) window.mochiFilePickSurface(feedAllAv, { id: 'feed-allav-tap', accept: 'image/*', owner: 'mochi-feed-allav-pick' });
  if (feedAllCover) {
    feedAllCover.addEventListener('click', (e) => {
      if (feedAllAv && (e.target === feedAllAv || feedAllAv.contains(e.target))) return;
      if (feedAllName && (e.target === feedAllName || feedAllName.contains(e.target))) return;
      // 换背景（#811：TA 页=该桌面 TA 封面背景；我的页=当前桌面我的朋友圈背景）
      const key = feedAllWho === 'me' ? 'feed-cover-bg' : 'feed-ta-cover';
      if (feedAllStore().get(key) || store.get(key)) {
        if (window.openModal) {
          window.openModal('已设置朋友圈背景', '', (v) => {
            if (v === '1') pickCoverFile();
            if (v === '2') { feedAllStore().set(key, ''); renderFeedAllCover(); toast('已恢复默认背景'); }
          }, { noInput: true, pills: [{ label: '更换背景', value: '1' }, { label: '恢复默认', value: '2' }] });
        }
      } else {
        pickCoverFile();
      }
      // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
      function pickCoverFile() {
        window.mochiFilePick({
          id: 'mochi-feed-cover-pick', accept: 'image/*',
          onFiles: (files) => {
            const f = files && files[0];
            if (!f) { toast('没有取到图片，请再选一次'); return; }
            compressImage(f, (dataUrl) => {
              feedAllStore().set(key, dataUrl);
              renderFeedAllCover();
              toast('朋友圈背景已更新');
            });
          }
        });
      }
    });
  }
  if (feedAllAv) {
    feedAllAv.addEventListener('click', (e) => {
      e.stopPropagation();
      // #811：我的页写「我」的朋友圈头像，TA 页写该桌面 TA 的
      const key = feedAllWho === 'me' ? 'feed-user-avatar' : 'feed-ta-avatar';
      // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
      window.mochiFilePick({
        id: 'mochi-feed-allav-pick', accept: 'image/*',
        onFiles: (files) => {
          const f = files && files[0];
          if (!f) { toast('没有取到图片，请再选一次'); return; }
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              try {
                const scale = Math.min(1, 256 / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.width * scale));
                c.height = Math.max(1, Math.round(img.height * scale));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                feedAllStore().set(key, c.toDataURL('image/jpeg', 0.85));
                renderFeedAllCover();
                toast('头像已更新');
              } catch (err) { toast('图片处理失败'); }
            };
            img.onerror = () => toast('图片读取失败');
            img.src = reader.result;
          };
          reader.onerror = () => toast('图片读取失败');
          reader.readAsDataURL(f);
        }
      });
    });
  }
  if (feedAllName) {
    feedAllName.addEventListener('click', (e) => {
      e.stopPropagation();
      // #811：我的页改「我」的朋友圈昵称，TA 页改该桌面 TA 的
      const key = feedAllWho === 'me' ? 'feed-user-name' : 'feed-ta-name';
      const cur = feedAllStore().get(key) || store.get(key) || (feedAllWho === 'me'
        ? (feedAllStore().get('lbl-user') || '我')
        : (feedAllStore().get('lbl-partner') || 'TA'));
      if (window.openModal) {
        window.openModal('修改昵称', cur, (v) => {
          const val = (v || '').trim();
          if (val) {
            feedAllStore().set(key, val);
            renderFeedAllCover();
            toast('昵称已更新');
          }
        }, { maxlength: 12 });
      }
    });
  }

  // ================= 朋友圈好友列表（v3.8.x，每行设朋友圈昵称/头像，独立于聊天） =================
  function safeAvStr(v) { if (v && typeof v === 'string' && v.length > 500 * 1024) return ''; return v || ''; }
  function avatarIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0116 0"/></svg>';
  }
  // 选择并压缩头像（256），写入指定 key，成功后刷新好友列表
  // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
  function pickAvatarAndSet(st, key) {
    window.mochiFilePick({
      id: 'mochi-feed-av-pick', accept: 'image/*',
      onFiles: (files) => {
        const f = files && files[0];
        if (!f) { toast('没有取到图片，请再选一次'); return; }
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            try {
              const scale = Math.min(1, 256 / Math.max(img.width, img.height));
              const c = document.createElement('canvas');
              c.width = Math.max(1, Math.round(img.width * scale));
              c.height = Math.max(1, Math.round(img.height * scale));
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              st.set(key, c.toDataURL('image/jpeg', 0.85));
              renderFeedFriends();
              toast('朋友圈头像已更新');
            } catch (err) { toast('图片处理失败'); }
          };
          img.onerror = () => toast('图片读取失败');
          img.src = reader.result;
        };
        reader.onerror = () => toast('图片读取失败');
        reader.readAsDataURL(f);
      }
    });
  }
  // 好友列表单行：person = {id,isMe,deskName,deskAv,feedName,feedAv,nameKey,avKey}
  function ffRow(person) {
    const avHtml = person.deskAv ? '<img src="' + attrEsc(person.deskAv) + '" alt="">' : avatarIconSvg();
    const who = person.isMe ? '我（当前桌面）' : ('桌面：' + person.id);
    return '<div class="ff-row" data-id="' + esc(person.id) + '" data-is-me="' + (person.isMe ? '1' : '0') + '">' +
      '<div class="ff-row-top">' +
        '<div class="ff-desktop-av">' + avHtml + '</div>' +
        '<div class="ff-id"><div class="ff-desktop-name">' + esc(person.deskName) + '</div><div class="ff-tag">' + esc(who) + '</div></div>' +
      '</div>' +
      '<div class="ff-edit">' +
        '<button class="ff-pill" data-act="avatar" data-key="' + person.avKey + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
          '<span class="ff-cur">朋友圈头像：' + esc(person.feedAv ? '已设置' : '未设置') + '</span>' +
        '</button>' +
        '<button class="ff-pill" data-act="name" data-key="' + person.nameKey + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z"/></svg>' +
          '<span class="ff-cur">朋友圈昵称：' + esc(person.feedName || '未设置') + '</span>' +
        '</button>' +
      '</div>' +
    '</div>';
  }
  function renderFeedFriends() {
    const el = document.getElementById('feed-friends-list');
    if (!el) return;
    const contacts = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    const as = window.activeStore();
    const activeCid = window.__activeCid || 'default';
    // 我（当前桌面）
    let html = '<div class="ff-sec">我</div>' + ffRow({
      id: activeCid, isMe: true,
      deskName: as.get('lbl-user') || '我',
      deskAv: as.get('avatar-user') || '',
      feedName: as.get('feed-user-name'),
      feedAv: safeAvStr(as.get('feed-user-avatar')),
      nameKey: 'feed-user-name', avKey: 'feed-user-avatar'
    });
    // 联系人（每个联系人一个桌面，各桌面的 TA 朋友圈身份独立）
    html += '<div class="ff-sec">联系人</div>';
    contacts.forEach(ct => {
      const cid = ct && ct.id ? ct.id : 'default';
      const st = window.storeFor(cid);
      html += ffRow({
        id: cid, isMe: false,
        deskName: st.get('lbl-partner') || (ct.name || cid),
        deskAv: st.get('avatar-partner') || '',
        feedName: st.get('feed-ta-name'),
        feedAv: safeAvStr(st.get('feed-ta-avatar')),
        nameKey: 'feed-ta-name', avKey: 'feed-ta-avatar'
      });
    });
    el.innerHTML = html;
  }
  function openFeedFriends() {
    const np = document.getElementById('feed-notice-panel'); if (np) np.hidden = true;
    renderFeedFriends();
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const fp = document.getElementById('page-feed-friends');
    if (fp) fp.hidden = false;
  }
  const feedFriendsBtn = document.getElementById('feed-friends-btn');
  if (feedFriendsBtn) feedFriendsBtn.addEventListener('click', (e) => { e.stopPropagation(); openFeedFriends(); });
  const feedFriendsBack = document.getElementById('feed-friends-back');
  if (feedFriendsBack) feedFriendsBack.addEventListener('click', () => {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const pageFeed = document.getElementById('page-feed');
    if (pageFeed) pageFeed.hidden = false;
    render();
  });
  const ffList = document.getElementById('feed-friends-list');
  if (ffList) {
    ffList.addEventListener('click', (e) => {
      const pill = e.target.closest('.ff-pill');
      if (!pill) return;
      const row = pill.closest('.ff-row');
      if (!row) return;
      const cid = row.dataset.id;
      const isMe = row.dataset.isMe === '1';
      const st = isMe ? window.activeStore() : window.storeFor(cid);
      const key = pill.dataset.key;
      if (pill.dataset.act === 'avatar') {
        pickAvatarAndSet(st, key);
      } else if (window.openModal) {
        const def = isMe ? (st.get('lbl-user') || '我') : (st.get('lbl-partner') || 'TA');
        const cur = st.get(key) || def;
        window.openModal('修改朋友圈昵称', cur, (v) => {
          const val = (v || '').trim();
          if (val) {
            st.set(key, val);
            renderFeedFriends();
            toast('朋友圈昵称已更新');
          }
        }, { maxlength: 12 });
      }
    });
  }

  // ================= 入口 =================
  const feedApp = document.querySelector('.app[data-app="feed"]');
  const feedPage = document.getElementById('page-feed');
  if (feedApp && feedPage) {
    feedApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      // v3.5.100：进入朋友圈即清零桌面「朋友圈」未读提醒（微信式）
      openFeedPage();
    });
  }
  // 通知提醒面板：开关 + 打开时全部标记已读（微信式）
  const noticeBtn = document.getElementById('feed-notice-btn');
  const noticePanel = document.getElementById('feed-notice-panel');
  if (noticeBtn && noticePanel) {
    noticeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      noticePanel.hidden = !noticePanel.hidden;
      if (!noticePanel.hidden) {
        const list = notices();
        let dirty = false;
        list.forEach(n => { if (!n.read) { n.read = true; dirty = true; } });
        if (dirty) saveNotices(list);
        renderNotices();
        renderNoticeBadge();
      }
    });
    document.addEventListener('click', (e) => {
      if (!noticePanel.hidden && !noticePanel.contains(e.target) && !noticeBtn.contains(e.target)) {
        noticePanel.hidden = true;
      }
    });
  }
  const feedBack = document.getElementById('feed-back');
  if (feedBack) feedBack.addEventListener('click', () => {
    const cb = document.getElementById('feed-comment-bar');
    if (cb) cb.hidden = true;
    const np = document.getElementById('feed-notice-panel');
    if (np) np.hidden = true;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const phone = document.getElementById('page-phone');
    if (phone) phone.hidden = false;
  });
  // v3.5.59：点顶部「发布朋友圈」+ 图标 → 展开/收起发布框（不再默认显示在顶部）
  const feedPubBtn = document.getElementById('feed-publish-btn');
  const feedPubCard = document.getElementById('feed-publish-card');
  if (feedPubBtn && feedPubCard) {
    feedPubBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      feedPubCard.hidden = !feedPubCard.hidden;
      if (!feedPubCard.hidden) {
        const fi = document.getElementById('feed-input');
        if (fi) setTimeout(() => fi.focus(), 60);
        feedPubCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
  const pubBtn = document.getElementById('feed-publish');
  if (pubBtn) pubBtn.addEventListener('click', publish);
  // v3.6.x：设置页「清除所有朋友圈数据」——清空全部动态（我的与 TA 的）、评论、点赞、
  // 通知提醒与未读角标（动态/通知为全局键，跨桌面一次清空）
  const feedClearAll = document.getElementById('feed-clear-all');
  if (feedClearAll) {
    feedClearAll.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('清除所有朋友圈数据？', '', () => {
        save([]);
        saveNotices([]);
        try { store.set('feed-app-unread', '0'); } catch (e) {}
        hideCommentBar();
        renderNoticeBadge();
        render();
        const np = document.getElementById('feed-notice-panel');
        if (np && !np.hidden) renderNotices();
        toast('朋友圈数据已全部清除');
      }, { noInput: true, staticText: '将删除全部动态（我的与 TA 的）、评论、点赞和通知提醒，且无法恢复。确定继续吗？' });
    });
  }
  // v3.6.x：朋友圈页顶部「删除全部动态」——可只删我的动态 / 只删联系人的动态 / 全部删除
  // v3.27.x：入口从页底移到顶部栏（feed-head-clear），无需滑动到页底
  const feedHeadClear = document.getElementById('feed-head-clear');
  if (feedHeadClear) {
    feedHeadClear.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.openModal) return;
      window.openModal('删除朋友圈动态', '', (v) => {
        const mode = v || 'all';
        const mine = (p) => (p.role || p.by) === 'me';
        const keep = load().filter(p => mode === 'mine' ? !mine(p) : (mode === 'ta' ? mine(p) : false));
        save(keep);
        // 全部删除时同步清空通知提醒与桌面未读角标（与设置页「清除所有朋友圈数据」一致）
        if (mode === 'all') {
          saveNotices([]);
          try { store.set('feed-app-unread', '0'); } catch (e) {}
        }
        hideCommentBar();
        renderNoticeBadge();
        render();
        toast(mode === 'all' ? '朋友圈动态已全部删除' : (mode === 'mine' ? '我的动态已全部删除' : '联系人的动态已全部删除'));
      }, { noInput: true, staticText: '删除后无法恢复。', pill: 'all', pills: [
        { label: '全部删除', value: 'all' },
        { label: '仅我的动态', value: 'mine' },
        { label: '仅联系人的动态', value: 'ta' }
      ] });
    });
  }
  render();
  // v3.7.x：朋友圈权威加载——对齐 mail.js mailMergeFromIdb。原实现「有就不读」
  //   （!store.get(KEY)），本会话已写入新动态时 IDB 里的更多旧动态被忽略；且无门槛，
  //   启动早期 load()=[] 时 save 覆盖 IDB（见 save 注释）。改为从 IDB 读 feed-posts 与
  //   当前 LS/快照/暂存按 id 合并后落盘，就绪后重渲染。Edge 丢 IDB 后重建的空库不会
  //   覆盖本地较新数据（合并取并集，本地有而 IDB 没的动态保留）。
  function feedMergeFromIdb(v) {
    try {
      const pending = feedPending || [];
      let base = [];
      // v 是超长字符串＝权威读成功（'[]'≤2 字符按未读到处理，同原判定）；undefined＝
      // 超时/异常，与键不存在不可分 → feedAuthSeen 只在真读到权威数据时置位
      const authOk = !!(v && typeof v === 'string' && v.length > 2);
      if (authOk) {
        feedAuthSeen = true;
        const idbArr = JSON.parse(v);
        if (Array.isArray(idbArr)) base = idbArr.map(normPost);
      }
      let cur = [];
      let curFromSnap = false;
      const raw = store.get(KEY);
      if (raw !== null) { try { const a = JSON.parse(raw); if (Array.isArray(a)) cur = a.map(normPost); } catch (e) {} }
      if (!cur.length) { const sn = loadSnap(); if (sn.length) { curFromSnap = true; cur = sn.map(normPost); } }
      const merged = mergePosts(base, mergePosts(cur, pending));
      if (!merged.length) { if (authOk && feedPending === pending) feedPending = null; return; }
      // #496：内存真相与权威合并结果同拍刷新（此后 load() 以 merged 为准，不再重 parse）
      // FIX 2026-09-17 #667 降级兜底不得当内存真相：权威键没读到、本次靠剥图快照顶起来的
      //   merged 只够渲染应急，不能抬成会话内的最新整包。旧实现无条件 feedMem = merged：
      //   此后 load() 被这份剥图版遮蔽，用户点赞/评论触发的写回就把剥图版当「最新整包」写进
      //   权威键——#188 写守卫查的是持久层（store.get/idbHasKey），看不见写入源已被 feedMem
      //   掉包，于是图永久变「[图片]」。不设 feedMem＝load() 继续读持久层/快照，权威副本一旦
      //   可读（idbRestore 回填 / LS 恢复）下一次 load() 就恢复完整内容，与守卫同源。
      const degraded = !authOk && curFromSnap;
      if (!degraded) feedMem = merged;
      // #187：写回走守卫——权威读失败且手上可能是剥图快照时，探测确认权威键仍在就绝不写回
      feedGuardWrite(JSON.stringify(merged)).then(written => {
        if (written) {
          // 权威键已更新为 merged 才清暂存（期间新到的动态不误清）
          if (feedPending === pending) feedPending = null;
          return;
        }
        // 拒写＝权威键仍在 IDB 里（本次只是读超时）：增量留在内存继续渲染显示，
        // persistSnap 已把文本落快照兜底；10s 后重读权威（最多 2 次）恢复完整视图
        if (feedPending === null) feedPending = pending;
        else if (feedPending !== pending) feedPending = mergePosts(pending, feedPending);
        if (feedAuthRetried >= 2 || !window.idbGet) return;
        feedAuthRetried++;
        setTimeout(function () {
          window.idbGet(uid + ':' + KEY).then(v2 => {
            feedMergeFromIdb(v2);
            if (v2 && typeof v2 === 'string' && v2.length > 2) render();
          });
        }, 10000);
      });
    } catch (e) { /* 解析失败仍置就绪，避免下次启动重复合并 */ }
  }
  try {
    if (window.idbGet) {
      window.idbGet(uid + ':' + KEY).then(v => {
        feedMergeFromIdb(v);
        feedDbReady = true;
        render();
      });
      // v3.5.94：TA 朋友圈封面也可能 >200KB → 同样补读（主列表 + 全部朋友圈封面都刷新）
      // 多桌面：补读回调里 activeStore() 是动态的，切换联系人后会写到新桌面 → 捕获 prefix 校验
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':feed-ta-cover').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !window.activeStore().get('feed-ta-cover')) {
          window.activeStore().set('feed-ta-cover', v);
          renderCover();
          renderFeedAllCover();
        }
      });
      // v3.5.94：朋友圈背景图同样补读
      window.idbGet(myPrefix + ':feed-cover-bg').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !window.activeStore().get('feed-cover-bg')) {
          window.activeStore().set('feed-cover-bg', v);
          renderCover();
        }
      });
      // v3.5.95：我的头像/TA 朋友圈头像补读（压缩失败兜底可能存原始大图）
      window.idbGet(myPrefix + ':avatar-user').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !window.activeStore().get('avatar-user')) {
          window.activeStore().set('avatar-user', v);
          renderCover();
        }
      });
      window.idbGet(myPrefix + ':feed-ta-avatar').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !window.activeStore().get('feed-ta-avatar')) {
          window.activeStore().set('feed-ta-avatar', v);
          renderCover();
        }
      });
    }
  } catch (e) { feedDbReady = true; }
  // v3.7.x：权威读取保险丝——IndexedDB 打开/读取在 OPPO Edge 后台挂起/存储异常时可能
  //   迟迟不返回，feedDbReady 一直 false，save 只暂存内存不落盘 → 新动态刷新即丢、
  //   maybeAutoPost 也写不进。15 秒后强制就绪并把暂存动态落盘（与 mail.js 15s 保险同理；
  //   正常情况 idbGet 早已返回，该保险只在病理场景触发，feedDbReady 已真时直接跳过）
  setTimeout(function () {
    if (feedDbReady) return;
    // #187：保险丝写回同样走守卫——病理存储下 load() 可能只是剥图快照，直接写会把
    //   无图版本盖进权威键（永久丢图），守卫探测确认权威键不存在时才落盘
    try { const all = load(); if (all.length) feedGuardWrite(JSON.stringify(all)); } catch (e) {}
    feedDbReady = true;
    render();
  }, 15000);
  // v3.6.x：多桌面——切换联系人后刷新朋友圈封面（我/TA 的头像昵称背景按新桌面）
  document.addEventListener('contact-switched', function () {
    try { renderCover(); } catch (e) {}
    try { renderFeedAllCover(); } catch (e) {}
  });
  // v3.5.100：页面加载时恢复桌面「朋友圈」通知未读提醒
  renderNoticeBadge();
  // v3.12.x：只读探针——TA 动态/评论素材池（公用+该联系人桌面专属+按其桌面开关的
  // 默认字卡），供回归测试与素材来源诊断；hasIn 查某张卡是否在指定分类桶里
  window.feedPoolFor = function (cid) {
    try {
      const p = cardPool(cid);
      return { textN: p.text.length, kaoN: p.kaomoji.length, emojiN: p.emoji.length, stickerN: (p.sticker || []).length, imageN: (p.image || []).length };
    } catch (e) { return null; }
  };
  window.feedPoolHas = function (cid, s) {
    try {
      const p = cardPool(cid);
      return { text: p.text.indexOf(s) >= 0, kaomoji: p.kaomoji.indexOf(s) >= 0, emoji: p.emoji.indexOf(s) >= 0 };
    } catch (e) { return null; }
  };
  // v3.26.x(#122)：注册朋友圈内置互动回应池跨分类搜索（字卡库列表页搜索同源可查，不再搜不到）
  window.__cardSearchFns = window.__cardSearchFns || [];
  window.__cardSearchFns.push({ name: '朋友圈互动', fn: function (kw) {
    const out = [];
    try {
      TA_COMMENT_POOL.forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: 'TA评论' }); });
      TA_REPLY_POOL.forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: 'TA回应回复' }); });
    } catch (e) {}
    return out;
  } });
})();
