// ===== 功能：信箱（仿星言简约版【星言信箱】，矢量图简约风格） =====
// 收信（TA 主动来信）/ 寄信 / 回信；信纸样式展示；聊天里插入写信/回信/来信提示
(function () {
  const store = window.activeStore();
  const KEY = 'mail-letters';
  // v3.7.x：LS 剥图快照兜底——对齐 feed.js feed-posts-snap。信件含图片 dataURL 时主键
  //   >200KB 只进 IndexedDB（LS 5MB 配额保护），Edge 杀后台/强制关闭丢 IDB 后信件全没。
  //   与 feed.js 同策略：剥掉图片 dataURL 只保文本，写一份 ≤200KB 的 LS 快照兜底。
  const SNAP_KEY = 'mail-letters-snap';
  const LS_BIG_LIMIT = 200 * 1024;
  const TITLES = ['好久不见', '最近还好吗', '想你了', '给你写了封信', '深夜随想', '一些想说的话'];
  let mtab = 'in';
  let viewLetter = null;

  function partnerName() { return store.get('lbl-partner') || 'TA'; }
  function fmtDT(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  // v3.6.x：load() 合并暂存——权威读取（mailDbReady=false）期间收到的信只暂存在
  // mailPending，原 load() 只读持久层 → 来信弹窗已提示「给你寄来了一封信」、信箱列表
  // 却是空白（OPPO 雨见浏览器 IndexedDB 打开/读取慢或挂起时真实复现）；这里把暂存
  // 信件按 id 合并在持久层之上，弹窗提示过的一切信件都可见可回可清角标。
  // v3.7.x：快照键用【动态】activePrefix——原实现模块加载时 const uid 固定，
  // 切到其它联系人桌面后 loadSnap/writeSnap 仍读写 default 桌面的快照：
  // 非 default 桌面信箱主键为空时兜底读到 default 桌面的信 → 串桌面 +
  // 「同一封信在谁桌面就显示谁的名字」（信箱是每桌面隔离数据，快照必须按桌面分开）
  // v3.7.x 多联系人来信：cid 指定该联系人桌面（后台遍历来信用），undefined 表示当前激活桌面
  function csFor(cid) { return cid ? window.storeFor(cid) : store; }
  function prefixFor(cid) { return cid ? ('xy-home-v2:' + cid) : window.activePrefix(); }
  function snapKey(cid) { return prefixFor(cid) + ':' + SNAP_KEY; }
  // v3.27.x 性能：load()/loadSnap 解析缓存——信件含 dataURL 时主键可达数百 KB，一次交互里
  // openMailPage（render+updateBadge）、openLetter（重查最新+标已读）会反复 JSON.parse 全量
  // 列表，是手机端信箱卡顿主因。原始串未变 ⇒ 复用上次的解析结果；返回时逐封浅拷贝——调用方
  // 普遍「改了 load 结果再 save」（read=true / unshift / 赋 myReply），共享对象引用会把未
  // 落盘的中间态漏进缓存。数据一变原始串必变 ⇒ 未命中自然失效，无需手动清。
  // 顺带收紧原实现的坏数据路径：raw 解析出非数组（旧实现 list=null/'…' 等继续往下走，
  // .length/.filter 抛错）统一按空列表处理，交给快照兜底与暂存合并。
  const _loadCache = new Map();
  function cachedParse(k, raw) {
    let list;
    const hit = _loadCache.get(k);
    if (hit && hit.raw === raw) {
      list = hit.list;
    } else {
      try { list = JSON.parse(raw); } catch (e) { list = null; }
      if (!Array.isArray(list)) return [];
      if (_loadCache.size > 8) _loadCache.delete(_loadCache.keys().next().value);
      _loadCache.set(k, { raw, list });
    }
    return list.map(x => (x && typeof x === 'object') ? Object.assign({}, x) : x);
  }
  function loadSnap(cid) {
    try {
      const k = snapKey(cid);
      const v = localStorage.getItem(k);
      if (v) return cachedParse(k, v);
    } catch (e) {}
    return [];
  }
  // 剥图：信件正文/回信/对方回信里的图片 dataURL 换 [图片]，快照只保文本历史
  function stripLetterImg(l) {
    if (!l || typeof l !== 'object') return l;
    const c = Object.assign({}, l);
    // FIX 2026-09-17 #681 快照只剥 dataURL、保留媒体池令牌（原实现把 @@m:hash 也剥成 [图片]）——
    //   令牌 44 字符不占快照预算，却是「图在哪」的唯一线索：权威主键（IDB）读不到时 load() 只剩
    //   快照，令牌留住才能由 media-pool 观察器解回真图（#665 软占位/有界重读可自愈），否则图永久
    //   退化成「[图片]」文字（同 #667 朋友圈快照口径）。通知/摘要处的令牌清洗保持不变。
    const strip = (s) => { if (typeof s !== 'string') return s; let t = s.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[图片]'); t = mailCleanDisplay(t); if (t.length > 8192) t = t.slice(0, 8192) + '…'; return t; };
    c.content = strip(c.content);
    if (c.myReply) { c.myReply = Object.assign({}, c.myReply); c.myReply.content = strip(c.myReply.content); }
    if (c.partnerReply) { c.partnerReply = Object.assign({}, c.partnerReply); c.partnerReply.content = strip(c.partnerReply.content); }
    return c;
  }
  function writeSnap(list, cid) {
    if (!list || !list.length) { try { localStorage.removeItem(snapKey(cid)); } catch (e) {} return; }
    try { const snap = JSON.stringify(list.map(stripLetterImg)); if (snap.length <= LS_BIG_LIMIT) localStorage.setItem(snapKey(cid), snap); } catch (e) {}
  }
  function load(cid) {
    const cs = csFor(cid);
    let list = [];
    const raw = cs.get(KEY);
    if (raw !== null) list = cachedParse(prefixFor(cid) + ':' + KEY, raw);
    // v3.7.x：主键缺失兜底——大列表只进 IDB（Edge 丢 IDB / LS 被清）时读剥图快照，
    //   文本+标题+时间保留；IDB 存活时模块底部 idbGet 会随后用完整数据重渲染
    if (!list.length) { try { const v = loadSnap(cid); if (v.length) list = v; } catch (e) {} }
    // v3.7.x：暂存合并仅对当前桌面（cid undefined）生效——mailPending 是当前桌面
    //   contact-switched 时的暂存，后台遍历其它 cid 时不并入（避免串桌面）
    if (!cid && !mailDbReady && mailPending && mailPending.length) {
      const map = {};
      list.forEach(x => { if (x && x.id) map[x.id] = x; });
      mailPending.forEach(x => { if (x && x.id) map[x.id] = x; });
      list = Object.keys(map).map(k => map[k]).sort((a, b) => (b.tm || 0) - (a.tm || 0));
    }
    return list;
  }
  // 按 id 合并两个信件列表（后者覆盖同 id），按 tm 倒序
  // v3.26.x：剥图回填——大信件超 200KB 时 LS 只有剥图快照（正文图片 dataURL 被剥成 [图片]），
  //   IDB 里是完整版；原实现后者(b=本地快照)整体覆盖同 id 的完整版 → 联系人用表情包写信/
  //   回信，信箱只显示「图片」两个字的文字。改为同 id 时优先保留「含真实 data:image」的那版
  //   （包含图片 → 完整版），彻底去掉剥图占位；两侧都无损时才按内容长度取更完整一方。
  function letterLen(o) {
    let n = 0;
    const a = o && typeof o.content === 'string' ? o.content : '';
    const b = o && o.myReply && typeof o.myReply.content === 'string' ? o.myReply.content : '';
    const c = o && o.partnerReply && typeof o.partnerReply.content === 'string' ? o.partnerReply.content : '';
    return a.length + b.length + c.length;
  }
  function hasRealImg(o) {
    const s = [o && o.content, o && o.myReply && o.myReply.content, o && o.partnerReply && o.partnerReply.content].join(' ');
    return /data:image\//.test(s || '') || (!!window.mochiMediaIsToken && s.split(' ').some(window.mochiMediaIsToken));
  }
  function mergeLists(a, b) {
    const map = {};
    const longer = (x, y) => (String(x || '').length >= String(y || '').length) ? x : y;
    const put = (x) => {
      if (!x || !x.id) return;
      const prev = map[x.id];
      if (!prev) { map[x.id] = x; return; }
      // v3.26.x：字段级合并——同 id 信件，content/myReply/partnerReply/read 各取更完整
      // 的一方，不再整体覆盖。原实现按 letterLen 取更大一方：剥图快照版（content 空 +
      // myReply 有）与 IDB 完整版（content 有 + myReply 空）合并时，若 IDB content 长度
      // > myReply 长度则取 IDB 版丢 myReply，反之取快照版丢 content → 回信后 content 或
      // myReply 丢失，点开信件空白，直到 TA 回信（partnerReply 落地使整版 letterLen 最大
      // 胜出）才显示（红米 K80 Chrome 反馈根因）。字段级合并保证任一字段有值即保留。
      const merged = Object.assign({}, prev);
      const xImg = hasRealImg(x), pImg = hasRealImg(prev);
      if (xImg && !pImg) merged.content = x.content;
      else if (!xImg && pImg) merged.content = prev.content;
      else merged.content = longer(x.content, prev.content);
      if (x.myReply && !prev.myReply) merged.myReply = x.myReply;
      else if (prev.myReply && !x.myReply) merged.myReply = prev.myReply;
      else if (x.myReply && prev.myReply) {
        merged.myReply = Object.assign({}, longer(String(x.myReply.content||'').length >= String(prev.myReply.content||'').length ? x.myReply : prev.myReply));
      }
      if (x.partnerReply && !prev.partnerReply) merged.partnerReply = x.partnerReply;
      else if (prev.partnerReply && !x.partnerReply) merged.partnerReply = prev.partnerReply;
      else if (x.partnerReply && prev.partnerReply) {
        merged.partnerReply = Object.assign({}, longer(String(x.partnerReply.content||'').length >= String(prev.partnerReply.content||'').length ? x.partnerReply : prev.partnerReply));
      }
      if (x.read || prev.read) merged.read = true;
      map[x.id] = merged;
    };
    (a || []).forEach(put);
    (b || []).forEach(put);
    return Object.keys(map).map(k => map[k]).sort((x, y) => (y.tm || 0) - (x.tm || 0));
  }
  // v3.5.120：信箱权威加载防护——修复「刷新后信箱数据丢失」：
  // 信箱数据导入后只在 IndexedDB（备份把它归为大键），localStorage 空时
  // load() 返回 []，此时任何 save([]) 都会用空列表覆盖 IDB 里的全部信件。
  // 权威未从 IDB 读回前，save 只暂存内存、绝不落盘。
  let mailDbReady = false;
  let mailPending = null;
  function save(list, cid) {
    // v3.7.x：cid undefined = 当前桌面，走 mailDbReady 门槛（防启动早期 save([]) 覆盖 IDB）；
    //   cid 指定 = 后台遍历该联系人来信，直接写（maybeIncomingLetterFor 已确认该桌面
    //   load 非空才 unshift，不会用 [新信] 覆盖 IDB 旧信）
    // v3.7.x：未就绪时除暂存内存外立即写剥图快照（对齐 chat.js 同场景的 LS 快照兜底）——
    //   原实现只进 mailPending 内存、保险丝(15s)触发前页面被杀/重载则来信整封丢失，
    //   而聊天通知已持久化 → 用户看到「联系人来信」信箱却是空的（iQOO Neo5 SE +
    //   QQ浏览器 X5 IDB 挂起实测）。快照仅文本兜底，IDB 权威读回后 mailMergeFromIdb
    //   按 id 合并恢复完整数据（含图片），不破坏权威防护（主键 store.set 仍等就绪）。
    if (!cid && !mailDbReady) { try { mailPending = (list || []).slice(); } catch (e) {} writeSnap(list, cid); return; }
    csFor(cid).set(KEY, JSON.stringify(list));
    writeSnap(list, cid);
  }

  // v3.5.99：桌面「信箱」图标未读角标——有新来信（未读）时显示数字，进入信箱或打开信件后清除
  function updateBadge() {
    const badge = document.getElementById('mail-badge');
    if (!badge && !window.setDeskBadge) return;
    try {
      const unread = load().filter(l => l.type === 'received' && !l.read && !l.myReply).length;
      if (window.setDeskBadge) { window.setDeskBadge('mail', unread); return; }
      if (!badge) return;
      if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    } catch (e) {}
  }

  // v3.5.107：信箱前台弹窗辅助——当前是否在信箱页（在信箱页内时来信/回信不弹横幅）
  function mailPageVisible() {
    return ['page-mail', 'page-mail-write', 'page-mail-reply'].some(id => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
  }
  // 打开信箱页（渲染 + 清角标），供信箱图标点击与弹窗点击共用
  // v3.10.x：暴露给 chat.js——聊天里的信件通知（写了一封信/给你回了信等）可点击直达
  function openMailPage() {
    // v3.27.x 性能：先显示 page-mail 再补查/渲染——render() 现在只在信箱页可见时干活
    //（后台落地路径不再白建列表 DOM），进页这一刻按需渲染；红米 K80「先可见再写入」
    // 防御口径同 submitReply/sendLetter。
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const mp = document.getElementById('page-mail');
    if (mp) mp.hidden = false;
    // v3.9.x：打开信箱立即补查到期回信/来信——iOS 短会话里 60s 定时器往往没机会跑，
    // 用户「点开信箱」这一刻正是最该看到 TA 回信的时刻
    try { checkPendingReply(); } catch (e) {}
    render();
    updateBadge();
  }
  window.openMailPage = openMailPage;
  // 写信纸 HTML（简约卡片：标题 + 寄信人/时间 + 正文）
  // 正文支持字卡库图片（dataURL）直接显示；图片/表情包都是字卡，统一渲染为
  // 同尺寸缩略图（sticker:/image: 前缀仅作历史类型标记，不再区分显示大小）
  // v3.6.x：完整 HTML 转义（只转 < 可被 `&lt;…&gt;` 实体绕过注入）
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // v3.x.x：称呼跟随——TA 写的信在显示层替换 TA/他（fit 参数，我写的信保持原文）
  // v3.26.x：独立附图识别——表情包/图片支持 base64 dataURL、svg 类非 base64 dataURL
  //   与带 sticker:/image: 前缀的外链图，统一渲染为缩略图（解决聊天正常、信箱墨水/信
  //   件表情包只显示文字）。无附图前缀的 http 链接仍当普通文本（不误判正文网址）。
  function renderBody(content, fit) {
    // FIX 2026-09-13 #429 渲染端清洗：剥存量落盘信件的「名称|||」前缀残留与 audio 等非图片
    //   base64（只洗显示不改历史数据，同 #426 calCleanMsg 口径）；图片 dataURL/令牌仍走下方 RE 内联渲染
    const s = mailCleanDisplay(String(content || ''));
    const seg = (t) => {
      t = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return (fit && window.taFit) ? window.taFit(t) : t;
    };
    const RE = /((?:sticker|image):)?(https?:\/\/[^\s"'<>]+|data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+|@@m:[0-9a-f]{32})/g;
    return s.replace(RE, function (all, pre, src) {
      if (src.indexOf('http') === 0 && pre !== 'sticker:' && pre !== 'image:') {
        return seg(all); // 普通网址（无附图前缀）按文本保留
      }
      const attrs = String(src).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      // v3.27.x 性能：decoding="async"——dataURL 图默认同步解码占弹层首帧（点开带图
      // 信件时的迟滞来源），异步解码让位主线程；与桌面/聊天/朋友圈图片同款做法。
      // 不加 loading="lazy"（dataURL 无网络请求，lazy 无效）。
      return '<img class="mail-body-img" decoding="async" src="' + attrs + '" alt="表情"> ';
    });
  }
  // 信箱列表摘要：剔除图片/表情包 dataURL（含标记前缀），避免显示超长 base64 乱码
  // v3.9.x：补 HTML 转义——shortDesc 结果直接拼 innerHTML（render 列表项），未转义
  //   可被含 < > 的信件内容注入 HTML（导入恶意备份 XSS）
  function shortDesc(s, fit) {
    // FIX 2026-09-13 #429 补「名称|||」前缀残留与非图片 base64 剥除（同 renderBody 口径）
    const str = mailCleanDisplay(String(s || ''));
    const cleaned = str
      .replace(/(?:sticker|image):data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '')
      .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '')
      .replace(/@@m:[0-9a-f]{32}/g, '')
      .replace(/\s+/g, ' ').trim();
    let out = escHtml((cleaned || '（图片）').slice(0, 30));
    if (fit && window.taFit) out = window.taFit(out);
    return out;
  }
  function letterPaper(title, content, date, author, fit) {
    return '<div class="mail-paper">' +
      '<div class="mail-paper-head"><span class="mail-paper-author">' + escHtml(author) + '</span><span class="mail-paper-date">' + date + '</span></div>' +
      (title ? '<div class="mail-paper-title">' + escHtml(title) + '</div>' : '') +
      '<div class="mail-paper-body">' + renderBody(content, fit) + '</div>' +
      '</div>';
  }
  // 信纸图片可点击查看大图（复用聊天大图查看器 viewChatImage）
  // v3.6.x：信箱来信/回信里的图片与表情包一律为缩略图，点击后打开原图查看
  function bindLetterImgClicks(root) {
    if (!root) return;
    root.querySelectorAll('.mail-body-img').forEach(im => {
      im.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.viewChatImage) window.viewChatImage(im.src);
      });
    });
  }
  // 打开信详情（复用 tc-mask 弹层；v3.5.68 打开即标记已读）
  function openLetter(l) {
    // v3.26.x：重新 load() 取最新完整数据——render() 列表项 click 传的 l 来自 render 时的
    // load() 快照，若当时 mailDbReady=false（切桌面后 idbGet 未返回/启动早期），load() 降级
    // 读剥图快照，l.content/l.myReply 可能为空（红米 K80 Chrome 反馈「回信后点开空白，TA
    // 回信后才显示」——TA 回信触发 render 时 mailDbReady 已 true 读主键完整才显示）。这里
    // 用 l.id 重新 load() 拿最新数据，覆盖可能过期的 l。
    try {
      if (l && l.id) {
        const fresh = load().find(x => x.id === l.id);
        if (fresh && fresh.id) l = fresh;
      }
    } catch (e) {}
    viewLetter = l;
    // 收到的来信：打开后标记已读（「新来信」消失）
    // 2026-09-14 加固：已读落库为可选步骤，load/save 任一抛出都不允许中断开信弹层
    //（多机型反馈「点开信无反应」：已读保存途中异常会让 openLetter 在弹层出现前中断）。
    if (l && l.type === 'received' && !l.read) {
      try {
        l.read = true;
        const list = load();
        const idx = list.findIndex(x => x.id === l.id);
        if (idx >= 0) { list[idx].read = true; save(list); }
      } catch (e) {}
    }
    updateBadge();
    const name = partnerName();
    const myName = store.get('lbl-user') || '我';
    let html = '';
    // 收到的信 / 寄出的信 都完整显示（含标题）
    if (l.type === 'received' || l.fromMe) {
      html += letterPaper(l.tt || '来信', l.content, fmtDT(l.tm), l.fromMe ? myName : name, !l.fromMe);
    } else if (l.type === 'sent') {
      html += letterPaper(l.tt || '寄出的信', l.content, fmtDT(l.tm), myName, false);
    }
    // 我的回信（寄出的信内容已在上方完整展示，不再重复）
    if (l.myReply && l.type !== 'sent') html += letterPaper('我的回信', l.myReply.content, fmtDT(l.myReply.tm), myName, false);
    if (l.partnerReply) html += letterPaper('对方的回信', l.partnerReply.content, fmtDT(l.partnerReply.tm), name, true);
    // 底部按钮：收到的信且未回信 → 提笔回信（打开独立回信页）；任意信可删除
    // v3.10.x：收到的来信可收藏到【我的收藏】→ 信件分类
    const canFav = l.type === 'received';
    let favAlready = false;
    if (canFav) {
      try {
        const favArr = JSON.parse(store.get('fav-msgs') || '[]');
        favAlready = favArr.some(x => (x.kind || 'msg') === 'mail' && x.mailType === 'received' && (x.text || '') === (l.content || '') && x.ts === l.tm);
      } catch (e) {}
    }
    let footer = '';
    if (canFav && !l.myReply) {
      footer = '<div class="mail-actions"><button class="cc-tool" id="mail-fav-btn">' + (favAlready ? '已收藏' : '收藏来信') + '</button><button class="cc-tool" id="mail-reply-btn">提笔回信</button><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
    } else if (canFav) {
      footer = '<div class="mail-actions"><button class="cc-tool" id="mail-fav-btn">' + (favAlready ? '已收藏' : '收藏来信') + '</button><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
    } else {
      footer = '<div class="mail-actions"><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
    }
    // v3.10.x：详情弹层兜底——openTCPanel 定义在 ta-ask.js 模块尾部，该模块若在某设备
    // 顶层抛错（文件级 try/catch 只保证后续模块能跑，本模块剩余部分仍中断），
    // window.openTCPanel 会缺失 → 点信件静默无反应。这里检测打开失败时退回全站
    // openModal 纯文本展示（personalize.js 早于 ta-ask 加载，可用性高得多），
    // 保证信件永远有地方看。
    let panelOpened = false;
    try {
      if (window.openTCPanel) {
        window.openTCPanel('信件', html + footer);
        const mk = document.getElementById('tc-mask');
        panelOpened = !!(mk && !mk.hidden);
        // v3.26.x：防御 openTCPanel 后 tc-body 无信纸——个别内核/竞态下 body.innerHTML
        // 未生效（红米 K80 Chrome 反馈「点开信不显示内容」），重试注入保证信纸可见。
        const tcb = document.getElementById('tc-body');
        if (panelOpened && tcb && !tcb.querySelector('.mail-paper')) {
          tcb.innerHTML = html + footer;
        }
      }
    } catch (e) {}
    if (!panelOpened && window.openModal) {
      const stripImg = (s) => String(s == null ? '' : s).replace(/(?:sticker|image:)?data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '［图片］');
      let txt = (l.tt ? '【' + l.tt + '】\n' : '') + stripImg(l.content);
      if (l.myReply && l.type !== 'sent') txt += '\n\n—— 我的回信 ——\n' + stripImg(l.myReply.content);
      if (l.partnerReply) txt += '\n\n—— 对方的回信 ——\n' + stripImg(l.partnerReply.content);
      window.openModal(l.fromMe ? '寄出的信' : '信件', '', () => {}, { noInput: true, staticText: txt });
    }
    bindLetterImgClicks(document.getElementById('tc-body'));
    const close2 = document.getElementById('mail-close2');
    if (close2) close2.addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; viewLetter = null; });
    const replyBtn = document.getElementById('mail-reply-btn');
    if (replyBtn) replyBtn.addEventListener('click', () => openReply(l));
    const delBtn = document.getElementById('mail-del-btn');
    if (delBtn) delBtn.addEventListener('click', () => deleteLetter(l));
    const favBtn = document.getElementById('mail-fav-btn');
    if (favBtn) favBtn.addEventListener('click', () => {
      if (window.addMyFavItem) {
        const ok = window.addMyFavItem({ kind: 'mail', mailType: 'received', title: l.tt || '', text: l.content || '', ts: l.tm || Date.now() });
        toast(ok ? '已收藏到我的收藏' : '这封来信已收藏过');
        if (ok) favBtn.textContent = '已收藏';
      }
    });
  }
  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
  // 回信（独立全屏页，保留原信上下文）
  function openReply(l) {
    // v3.26.x：同 openLetter，重新 load() 取最新完整数据（防 render list 的 l 来自剥图快照、content 空）
    try {
      if (l && l.id) {
        const fresh = load().find(x => x.id === l.id);
        if (fresh && fresh.id) l = fresh;
      }
    } catch (e) {}
    viewLetter = l;
    const name = partnerName();
    const origEl = document.getElementById('mail-reply-original');
    if (origEl) {
      origEl.innerHTML = letterPaper(l.tt || '来信', l.content, fmtDT(l.tm), name, true);
      bindLetterImgClicks(origEl);
    }
    const toEl = document.getElementById('mail-reply-to');
    if (toEl) toEl.textContent = name;
    const input = document.getElementById('mail-reply-input');
    if (input) input.value = '';
    document.getElementById('tc-mask').hidden = true;
    showPage('page-mail-reply');
  }
  function submitReply() {
    const l = viewLetter;
    if (!l) return;
    // v3.6.x：保留 sticker:/image: 标记前缀（区分图片/表情包类型），不再剥掉
    // v3.10.x：读值走 readMailVal（安卓 ce-box 代理读空兜底）
    const val = readMailVal(document.getElementById('mail-reply-input')).trim();
    if (!val) { toast('回信内容不能为空'); return; }
    const name = partnerName();
    const list = load();
    const idx = list.findIndex(x => x.id === l.id);
    if (idx >= 0 && !list[idx].myReply) {
      list[idx].myReply = { content: val, tm: Date.now() };
      // TA 定时回信确认（概率与时间在回复设置-信箱调整）
      const cfg = mailCfg();
      if (Math.random() * 100 < cfg.replyProb) {
        const replyMsg = taLetterContent(cfg);
        const delayMs = (cfg.replyMin + Math.random() * Math.max(1, cfg.replyMax - cfg.replyMin)) * 60000;
        // v3.6.x：TA 回信计划持久化——不再用内存 setTimeout（页面刷新/重开即丢失，
        // 表现为「回了信却永远收不到回信」）；写入计划，由 checkPendingReply 到期落地
        const pending = replyPendingLoad();
        pending.push({ id: l.id, due: Date.now() + delayMs, content: replyMsg });
        replyPendingSave(pending);
      }
      save(list);
      viewLetter = null;
      // v3.26.x：回信后切到「收到的信」tab 并在 DOM 可见时渲染——原实现只 showPage 不
      // selectMailTab，回信后停在旧 tab（常是「寄出的信」），用户看不到刚回信的来信、
      // 以为回信没成功（红米 K80 Chrome 反馈「回了信不显示、重新点也看不到回信」）。
      // 同步先 showPage+selectMailTab 让 page-mail 与目标 tab 可见，再 render() 确保
      // innerHTML 在元素可见时写入（防御个别内核对 hidden 元素 innerHTML 渲染延迟）。
      showPage('page-mail');
      selectMailTab('in');
      render();
      updateBadge();
      // v3.10.x：mailNotice=true → 聊天里该系统消息可点击直达信箱
      if (window.chatAddSystem) window.chatAddSystem('你给 ' + name + ' 回了一封信', { mailNotice: true });
      toast('回信已寄出');
      // v3.6.x：TA 收藏我的回信（概率可调，与聊天消息收藏一致）
      // v3.7.x：概率由收藏设置页控制，默认 30%
      if (Math.random() * 100 < (window.favCfg ? window.favCfg().taMail : 30) && window.addTaFavItem) {
        window.addTaFavItem({ kind: 'mail', title: l.tt || '', text: val, ts: Date.now() });
        setTimeout(() => toast(window.taFit ? window.taFit('TA 收藏了你的回信') : 'TA 收藏了你的回信'), 1200);
      }
    }
  }
  // ===== TA 回信计划（持久化）：回信命中概率后，TA 的回信写入本地计划 =====
  // 到期由 checkPendingReply 落地为 partnerReply；刷新/重开页面不丢（旧逻辑用内存
  // setTimeout，刷新即丢失，回信永远收不到）。
  const REPLY_PENDING_KEY = 'mail-reply-pending';
  function replyPendingLoad(cid) {
    try { const v = JSON.parse(csFor(cid).get(REPLY_PENDING_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function replyPendingSave(arr, cid) { try { csFor(cid).set(REPLY_PENDING_KEY, JSON.stringify(arr)); } catch (e) {} }
  // v3.7.x：信件系统消息写入「信件所属桌面」的聊天——与 feed.js notifyFeedPostToChat
  //   同模式：当前桌面走内存链路（chatAddSystem 实时渲染）；非当前桌面直接写该桌面
  //   IDB 聊天记录 + LS 快照（该桌面 msgs 在 contact-switched 时重置，下次进入由 loadMsgs 读回）
  function notifyMailToChat(cid, text, opts) {
    const cur = window.__activeCid || 'default';
    if (cid === cur) {
      // v3.10.x：opts.mailNotice → 聊天通知可点击打开信箱
      if (window.chatAddSystem) window.chatAddSystem(text, { mailNotice: !!(opts && opts.mailNotice) });
      return;
    }
    // v3.14.x：改走 chat.js 统一安全追加——原「idbGet→push→整包写回」在读取
    // 超时（返回 undefined）时会把该桌面全部聊天记录覆盖成 [这一条]
    if (window.chatAppendToDeskMsg) { window.chatAppendToDeskMsg(cid, text, { mailNotice: !!(opts && opts.mailNotice) }); }
  }
  // 该联系人桌面的 TA 昵称（lbl-partner，回退 contacts.name，再回退 'TA'）
  function partnerNameFor(cid) {
    try {
      const cs = csFor(cid);
      const v = cs.get('lbl-partner');
      if (v) return v;
      if (window.getContacts) {
        const c = window.getContacts().find(x => x.id === cid);
        if (c && c.name) return c.name;
      }
    } catch (e) {}
    return 'TA';
  }
  // 检查到期回信计划并落地（启动时 + 每分钟 tick 调用）
  // v3.7.x：改为遍历各联系人——原实现单定时器用 store（当前激活桌面），回信计划
  //   读写当前桌面，用户在 A 桌面时 B 的回信计划永远不落地。改为每个联系人独立
  //   checkPendingReplyFor(cid)，用 csFor(cid) 读写各自命名空间。
  function checkPendingReplyFor(cid) {
    try {
      // v3.9.x：当前桌面权威加载（mailDbReady）完成前不落地——此时 load(cid) 可能
      // 读到剥图快照（大信件只存 IDB 时 LS 主键为空），落地写回会把带图信件覆盖成
      // [图片] 剥图版；等权威加载回调/保险丝置真后补查（那里会再调 checkPendingReply）。
      if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
      const now = Date.now();
      const pending = replyPendingLoad(cid);
      if (!pending.length) return;
      const name = partnerNameFor(cid);
      const rest = [];
      let changed = false;
      // v3.27.x 性能：load 提到循环外——原实现每条到期计划都重新 load(cid)（全列表再
      // parse+排序一遍），多条计划即多次全量读；改为读一次、全部落地后统一 save 一次
      //（少写一遍持久层，行为不变：同 id 多计划命中已回信分支同样丢弃后续）。
      const list = load(cid);
      let landed = false;
      pending.forEach(p => {
        if (!p || !p.id) { changed = true; return; }
        const idx = list.findIndex(x => x.id === p.id);
        if (idx < 0) { changed = true; return; }          // 信件已不存在 → 丢弃计划
        if (list[idx].partnerReply) { changed = true; return; } // 已有 TA 回信 → 丢弃计划
        if (p.due > now) { rest.push(p); return; }        // 未到期 → 保留
        // 到期：落地 TA 回信
        list[idx].partnerReply = { content: p.content, tm: now };
        landed = true;
        notifyMailToChat(cid, name + ' 给你回了信', { mailNotice: true });
        // v3.5.107：TA 回信且不在信箱页 → 前台桌面弹窗（仅当前激活桌面才弹，用户能看到）
        if (cid === (window.__activeCid || 'default') && window.showDeskPopup && !mailPageVisible()) {
          // FIX 2026-09-13 #403 弹窗正文剥媒体池令牌/附件（原样传信件正文＝通知横幅直出乱码）
window.showDeskPopup({ name: '信箱', text: '给你回了一封信：' + String(p.content || '').replace(/@@m:[0-9a-f]{32}/g, '[图片]').replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]'), onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
        }
        changed = true;
      });
      if (landed) save(list, cid);
      if (changed) replyPendingSave(rest, cid);
      if (cid === (window.__activeCid || 'default')) { render(); updateBadge(); }
    } catch (e) {}
  }
  function checkPendingReply() {
    const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    list.forEach(c => checkPendingReplyFor(c.id));
  }
  // 列表项 HTML（v3.27.x 渲染模板收口：原 render() 把同一份拼接写了 4 遍——
  // 收/寄 × 正常/红米重试——收敛为一处，红米重试防御的调用点与语义不变。
  // dir:'in' 收到的信 / 'out' 寄出的信）
  function mailItemHtml(l, dir, name) {
    const tag = dir === 'in'
      ? (l.myReply ? ' <span class="mail-tag">已回信</span>' : (l.read ? '' : ' <span class="mail-tag new">新来信</span>'))
      : (l.partnerReply ? ' <span class="mail-tag">对方已回信</span>' : '');
    // v3.27.x：data-id 过 escHtml——导入备份的信件 id 是外部输入，原实现裸拼进属性
    // 可逃逸引号注入 HTML；dataset 读回时属性实体自动还原，匹配逻辑不变
    return '<div class="mail-item" data-id="' + escHtml(l.id) + '">' +
      '<div class="mail-item-av"><svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></div>' +
      '<div class="mail-item-body"><div class="mail-item-title">' + (dir === 'in' ? '来自 ' : '寄给 ') + name + tag + '</div>' +
      '<div class="mail-item-desc">' + shortDesc(l.content, dir === 'in') + '</div></div>' +
      '<div class="mail-item-time">' + fmtDT(l.tm) + '</div></div>';
  }
  // 渲染列表
  function render() {
    // v3.27.x 性能：信箱页不可见 ⇒ 跳过。后台落地路径（60s 来信/回信 tick、启动 idb
    // 回调、保险丝）都会各调一次 render，原实现在用户停在桌面时也重建两份完整列表
    // HTML（每封信再跑剥 base64 正则）——全是白做的 UI 活。列表 DOM 无脏状态依赖：
    // 进页唯一入口 openMailPage 显示后才渲染，寄信/回信路径也先 showPage 再 render。
    const mpEl = document.getElementById('page-mail');
    if (mpEl && mpEl.hidden) return;
    const list = load().slice().sort((a, b) => b.tm - a.tm);
    const name = partnerName();
    const inEl = document.getElementById('mail-in-list');
    const outEl = document.getElementById('mail-out-list');
    // 收到的信：TA 来信 + 已回信
    const inList = list.filter(l => l.type === 'received');
    if (inEl) {
      const inHtml = inList.map(l => mailItemHtml(l, 'in', name)).join('');
      inEl.innerHTML = inHtml || ((window.mochiDataPending && window.mochiDataPending())
        ? window.mochiLoadingHtml('收到的信')
        : '<div class="ta-empty">' + (window.taFit ? window.taFit('还没有收到信，等等 TA 吧') : '还没有收到信，等等 TA 吧') + '</div>');
      // v3.26.x：防御 innerHTML 未生效——个别安卓内核（红米 K80 Chrome）对 hidden 元素
      // innerHTML 渲染延迟，列表项数与数据不符时重试一次（红米 K80 反馈「列表空」）。
      if (inList.length && inEl.querySelectorAll('.mail-item').length < inList.length) inEl.innerHTML = inHtml;
    }
    // 寄出的信
    const outList = list.filter(l => l.type === 'sent');
    if (outEl) {
      const outHtml = outList.map(l => mailItemHtml(l, 'out', name)).join('');
      outEl.innerHTML = outHtml || ((window.mochiDataPending && window.mochiDataPending())
        ? window.mochiLoadingHtml('寄出的信')
        : '<div class="ta-empty">还没有寄出任何信，提笔写一封吧</div>');
      if (outList.length && outEl.querySelectorAll('.mail-item').length < outList.length) outEl.innerHTML = outHtml;
    }
  }
  // #785：回填真完成后补渲一次（render 开头按 page-mail 不可见早退，隐藏时零代价）
  if (window.mochiOnDataReady) window.mochiOnDataReady(function () { try { render(); } catch (e) {} });
  // v3.27.x 性能：列表项点击改容器级事件委托（一次绑定）——原实现每次 render 给每封信
  // 重挂 click，开销随信件数线性增长；点击按 dataset id 现查信件（load 有解析缓存），
  // openLetter 内部本就会重取最新完整数据，行为不变
  function mailListItemClick(e) {
    const it = e.target && e.target.closest ? e.target.closest('.mail-item') : null;
    if (!it) return;
    const l = load().find(x => x.id === it.dataset.id);
    if (l) openLetter(l);
  }
  ['mail-in-list', 'mail-out-list'].forEach((lid) => {
    const el = document.getElementById(lid);
    if (el) el.addEventListener('click', mailListItemClick);
  });
  // 存储时保留媒体标记前缀（sticker:/image:）——渲染时靠前缀区分表情包小图/图片大图
  // v3.6.x：旧实现提交时剥掉前缀，renderBody 匹配不到 sticker: 导致表情包按大图显示；
  // 现在保留前缀存储；历史无前缀数据仍按大图显示不变
  // 寄信
  function sendLetter() {
    const input = document.getElementById('mail-input');
    // v3.6.x：保留 sticker:/image: 标记前缀（区分图片/表情包类型），不再剥掉
    // v3.10.x：读值走 readMailVal（安卓 ce-box 代理读空兜底，防「信没寄出去」）
    const content = input ? readMailVal(input).trim() : '';
    if (!content) { toast('信件内容不能为空'); return; }
    const name = partnerName();
    const title = TITLES[Math.floor(Math.random() * TITLES.length)];
    const letter = { id: 'l_' + Date.now(), type: 'sent', tt: title, content: content, tm: Date.now(), myReply: { content: content, tm: Date.now() } };
    const list = load();
    list.unshift(letter);
    save(list);
    // v3.9.x：寄出的信也可收到 TA 回信——原实现回信机制只在「提笔回信」
    //   (submitReply) 里按 ml-reply-prob 安排回信计划，寄信(sendLetter) 从不安排
    //   → 用户设了「回信概率」寄信也永远收不到回信。寄信与回信共用同一概率/
    //   时间设置（回复设置-信箱-联系人回信），命中后写入回信计划，由
    //   checkPendingReplyFor 到期落地为 partnerReply（刷新/重开不丢）。
    const cfg = mailCfg();
    if (Math.random() * 100 < cfg.replyProb) {
      const replyMsg = taLetterContent(cfg);
      const delayMs = (cfg.replyMin + Math.random() * Math.max(1, cfg.replyMax - cfg.replyMin)) * 60000;
      const pending = replyPendingLoad();
      pending.push({ id: letter.id, due: Date.now() + delayMs, content: replyMsg });
      replyPendingSave(pending);
    }
    if (input) input.value = '';
    if (input && input.__ceBox) input.__ceBox.textContent = '';
    // v3.10.x：信件通知可点击（chat.js 渲染 mail-notice 类，点击打开信箱）
    if (window.chatAddSystem) window.chatAddSystem('你给 ' + name + ' 写了一封信', { mailNotice: true });
    toast('信件已寄出');
    // v3.26.x：先 showPage+selectMailTab 让 page-mail 与「寄出的信」tab 可见，再 render()——
    // 原实现 render() 在 showPage 之前，page-mail 仍 hidden 时写入 innerHTML，个别安卓
    // 内核（红米 K80 Chrome 实测）对 hidden 元素 innerHTML 渲染延迟，寄信后列表空白。
    // 改为 DOM 可见后再渲染，并保留前一次 render() 兜底（双渲染，零副作用）。
    render();
    showPage('page-mail');
    selectMailTab('out');
    render();
  }
  // ================= TA 主动来信（定时机制，概率可在回复设置-信箱调整） =================
  const TA_LETTERS = [
    '最近总是想起我们以前聊的那些话。时间过得真快，但有些东西一直没变。给我回信吧。',
    '今天路过一个地方，突然很想你。最近过得还好吗？想听听你的消息。',
    '忽然想给你写封信。有些话，用字卡说不完，写下来好像更踏实。',
    '晚安前突然想起你。最近有没有好好休息？有空给我回封信吧。',
    '今天看到一片很好看的云，第一反应是想拍给你看。想你了。'
  ];
  function mailCfg() {
    const c = (window.replyCfg && window.replyCfg()) || {};
    // v3.5.99：概率为 0/空 时回退默认值——防止 TA 永不写信/永不回信（旧数据可能把概率存成 0）
    const prob = (k, def) => {
      const v = c[k];
      return v !== undefined && v !== '' && Number(v) > 0 ? Number(v) : def;
    };
    return {
      // v3.6.x：最少/最多字卡条数（回复设置-信箱可调；默认 20~50）
      minCards: c['ml-min-cards'] !== undefined ? Number(c['ml-min-cards']) : 20,
      maxCards: c['ml-max-cards'] !== undefined ? c['ml-max-cards'] : 50,
      // #296：写信总开关裸读（不走 prob()——prob 把 0 兜底回默认值，开关关闭=0 必须原样保留）
      writeEn: c['ml-write-en'] !== undefined ? Number(c['ml-write-en']) : 1,
      // #645：每周摸鱼小结寄信开关裸读（同 writeEn 口径——关闭=0 必须原样保留）
      fishWeekEn: c['ml-fish-week-en'] !== undefined ? Number(c['ml-fish-week-en']) : 1,
      writeProb: prob('ml-write-prob', 30),
      writeMin: c['ml-write-min'] !== undefined ? c['ml-write-min'] : 1,
      writeMax: c['ml-write-max'] !== undefined ? c['ml-write-max'] : 120,
      // v3.6.x：每天最多来信（封），默认 3（回复设置-信箱可调）
      dailyMax: c['ml-write-daily-max'] !== undefined ? Number(c['ml-write-daily-max']) : 3,
      replyProb: prob('ml-reply-prob', 80),
      replyMin: c['ml-reply-min'] !== undefined ? c['ml-reply-min'] : 1,
      replyMax: c['ml-reply-max'] !== undefined ? c['ml-reply-max'] : 120,
      kaomojiEn: c['ml-kaomoji-en'] !== undefined ? c['ml-kaomoji-en'] : 1,
      emojiEn: c['ml-emoji-en'] !== undefined ? c['ml-emoji-en'] : 1,
      stickerEn: c['ml-sticker-en'] !== undefined ? c['ml-sticker-en'] : 1
    };
  }
  // v3.12.x：按「指定联系人桌面」读信箱回复设置（ml-*）——多桌面下每个联系人 TA
  //   写信（概率/间隔/每天最多来信等）应使用各自桌面的设置值。原实现 maybeIncomingLetterFor
  //   遍历所有联系人时统一调 mailCfg()=当前激活桌面的值：用户停在 A 桌面，B 桌面设的
  //   「每天最多写信」等从不生效（与朋友圈 feedCfgFor 同款问题）。以 mailCfg() 为基底
  //   （保留默认值/坏数据兜底），再用该联系人命名空间的 reply-ml-* 覆盖；
  //   当前桌面直接复用 mailCfg() 不重复读。概率 0/负不覆盖（同 prob() 兜底口径，
  //   防 TA 永不写信的旧坏数据）。
  function mailCfgFor(cid) {
    const cfg = mailCfg();
    if (!cid || cid === (window.__activeCid || 'default')) return cfg;
    try {
      const s = window.storeFor(cid);
      [['ml-min-cards', 'minCards'], ['ml-max-cards', 'maxCards'],
       ['ml-write-en', 'writeEn'], ['ml-fish-week-en', 'fishWeekEn'],
       ['ml-write-prob', 'writeProb'], ['ml-write-min', 'writeMin'], ['ml-write-max', 'writeMax'],
       ['ml-write-daily-max', 'dailyMax'], ['ml-reply-prob', 'replyProb'],
       ['ml-reply-min', 'replyMin'], ['ml-reply-max', 'replyMax'],
       ['ml-kaomoji-en', 'kaomojiEn'], ['ml-emoji-en', 'emojiEn'], ['ml-sticker-en', 'stickerEn']
      ].forEach(pair => {
        try {
          const v = s.get('reply-' + pair[0]);
          if (v === null || v === undefined || v === '') return;
          const n = Number(v);
          if (isNaN(n)) return;
          if ((pair[0] === 'ml-write-prob' || pair[0] === 'ml-reply-prob') && n <= 0) return;
          cfg[pair[1]] = n;
        } catch (e) {}
      });
    } catch (e) {}
    return cfg;
  }
  // 只读探针：该联系人桌面的信箱触发配置（供回归测试与来源诊断）
  window.mailCfgForProbe = function (cid) {
    try { const c = mailCfgFor(cid); return JSON.parse(JSON.stringify(c)); } catch (e) { return null; }
  };
  // 字卡库分类（与聊天/朋友圈同一套规则）：文字 / 颜文字 / emoji / 表情包(图片)
  // v3.6.x：用户未添加自定义字卡时（内置预设已移除）用系统默认字卡补池——
  //   否则信件只能从 5 条固定文案里抽，内容单一且条数上限超过池子时爆重复
  // v3.7.x：补池受「信箱使用」场景开关控制（默认字卡-设置页可关闭）
  // v3.8.x：默认字卡不再只当「空池兜底」——即使有自定义字卡，写信时每张卡也会按
  //   「整体概率 + 分类占比」（聊天默认字卡-设置页）混入默认字卡，与聊天回复一致
  // v3.42.x #429 信件纯文字口径（OPPO Reno16 Via/Edge 报「信件乱码＝联系人字卡库图片令牌」，多机型同族 #426）：
  // ①选卡过滤收敛——#388 只守了自定义字卡循环且用全串锚定的 mochiMediaIsToken（令牌嵌长文本测不出），
  //   默认主字卡三循环（defText/defKaomoji/defEmoji）零过滤，贴纸/语音型默认卡（「名称|||@@m:hash」
  //   「名称|||data:…」）与裸令牌混排照样进池拼进信件持久化成乱码；统一 indexOf 口径过滤两路循环。
  // ②渲染端清洗——存量已落盘信件含「名称|||」前缀残留与 audio 等非图片 base64，renderBody/shortDesc
  //   直出乱码；只洗显示不改历史数据（同 #426 calCleanMsg 口径）。
  // 判定用 indexOf('@@m:') 而非 mochiMediaIsToken：后者全串锚定，令牌嵌在长文本里测不出。
  function mailTextOnly(c) {
    if (typeof c !== 'string' || !c) return false;
    if (c.indexOf('data:') === 0) return false;
    if (c.indexOf('|||') >= 0) return false;
    if (c.indexOf('@@m:') >= 0) return false;
    // FIX 2026-09-15 #533 链接导入的媒体字卡（图床不允许跨域时存原始 http(s) 链接，
    // 位于字卡库【表情包/图片】分类）同样是图片载荷不是文字——旧判定放行 URL，联系人
    // 写信抽中即把「http://…png」当正文句子写进信纸（用户报「一个对话框里发两个表情，
    // 另一个会变成文字 URL，信箱里也是这样」）。renderBody 本就把带 sticker:/image:
    // 前缀的外链当缩略图，这里只是不再把裸链接当句子拼进正文。
    if (/^https?:\/\//i.test(c)) return false;
    return true;
  }
  // 渲染端剥「名称|||」前缀残留 + 非图片 dataURL（语音等）成 [附件]——只洗显示
  function mailCleanDisplay(s) {
    if (typeof s !== 'string') return s;
    return s.replace(/[^\s|]{0,40}\|\|\|/g, '')
      .replace(/(data:)?audio\/?[a-zA-Z0-9.+-]*;base64,[A-Za-z0-9+/=]+/g, '[附件]')
      .replace(/data:(?!image\/)[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]');
  }
  function mailCardPool(cid) {
    const custom = cid ? (window.getCustomCardsFor ? window.getCustomCardsFor(cid) : []) : ((window.getCustomCards && window.getCustomCards()) || []);
    const pokeSet = (function () {
      const pk = cid ? (window.getPokeCardsFor ? window.getPokeCardsFor(cid) : []) : ((window.getPokeCards && window.getPokeCards()) || []);
      return pk.length ? new Set(pk) : null;
    })();
    const text = [], kaomoji = [], emoji = [];
    // 默认字卡独立子池（与自定义分开放，供按概率混入；不做合并）
    const defText = [], defKaomoji = [], defEmoji = [];
    const pushDefault = () => {
      try {
        // v3.12.x：开关按【该联系人桌面】读（同群聊/朋友圈口径）——某联系人桌面
        // 关「信箱使用」→ 只有这个联系人的来信不用默认字卡
        const st = (cid && window.storeFor) ? window.storeFor(cid) : null;
        const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
        if (a ? !a.use('mail') : (window.defaultCardUse && !window.defaultCardUse('mail'))) return;
        const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
        const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
        if (catOn('main') && !defText.length) {
          const dg = (window.getDefaultCardGroups && window.getDefaultCardGroups('main')) || [];
          dg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('main', c)) return; if (!mailTextOnly(c)) return; defText.push(c); }));
        }
        if (catOn('kaomoji') && !defKaomoji.length) {
          const kg = (window.getDefaultCardGroups && window.getDefaultCardGroups('kaomoji')) || [];
          kg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('kaomoji', c)) return; if (!mailTextOnly(c)) return; defKaomoji.push(c); }));
        }
        if (catOn('emoji') && !defEmoji.length) {
          const eg = (window.getDefaultCardGroups && window.getDefaultCardGroups('emoji')) || [];
          eg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('emoji', c)) return; if (!mailTextOnly(c)) return; defEmoji.push(c); }));
        }
      } catch (e) {}
    };
    custom.forEach(s => {
      if (!s || typeof s !== 'string') return;
      if (pokeSet && pokeSet.has(s)) return;
      if (/^data:/.test(s)) return;
      // v3.6.x：语音字卡（文件名|||audio;base64）不以 data: 开头，需单独丢弃——
      //   否则整段音频 base64 会被当文字写进信件
      if (s.indexOf('|||') >= 0) return;
      // FIX 2026-09-13 #388 媒体池令牌卡不进信件文字池（同 chat.js #383 第三道守卫）
      // FIX 2026-09-13 #429 过滤收敛到 mailTextOnly（补裸令牌混排；默认卡三循环同口径）
      if (!mailTextOnly(s)) return;
      let isEmoji = false;
      for (const ch of s) {
        const c = ch.codePointAt(0);
        if ((c >= 0x1F000 && c <= 0x1FAFF) || (c >= 0x2600 && c <= 0x27BF)) { isEmoji = true; break; }
      }
      if (isEmoji) { emoji.push(s); return; }
      if (/[\(（｡◕(◕)(づ｡(¬)]/.test(s) && /[\)）】)]/.test(s)) { kaomoji.push(s); return; }
      // FIX 2026-09-15 #531：无括号颜文字（▽・ω・▽、๑•́ ₃ •̀๑ 等）也归颜文字，别占文字池
      if (!/[A-Za-z0-9\u4e00-\u9fff\u3041-\u3096\u30a1-\u30fa]/.test(s) && /[｡◕‿・▽´｀￣﹏◠◡≧≦ω＾￢¬^•˙˘๑٩۶ฅヽノ]/.test(s)) { kaomoji.push(s); return; }
      text.push(s);
    });
    pushDefault();
    const sticker = cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'sticker') : []) : ((window.getMediaCards && window.getMediaCards('sticker')) || []);
    const image = cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'image') : []) : ((window.getMediaCards && window.getMediaCards('image')) || []);
    // FIX 2026-09-15 #534 信箱内容类型总开关在【池这一层】生效（设置→回复设置→信箱
    //   「写信内容类型」ml-kaomoji-en / ml-emoji-en / ml-sticker-en）：旧实现只在
    //   taLetterContent 的「附加」两步查 kaomojiEn/stickerEn，而正文动词
    //   pickDefaultMailCard 会按 dc-prob-* 分类权重直接注入 defKaomoji/defEmoji——
    //   用户把「来信内容使用颜文字」关掉后，系统预设补池里的颜文字仍按占比混进正文
    //   （用户报「设置了朋友圈和信箱已经把颜文字和表情包都禁了，还是会出现」；
    //   多机型同报，纯逻辑、零机型分支）。这里直接清空对应池，任何消费方都取不到，
    //   与朋友圈 feedTypeOn 清池同款口径。缺省键＝开，存量用户行为不变。
    const tcfg = mailCfgFor(cid);
    if (!tcfg.kaomojiEn) { kaomoji.length = 0; defKaomoji.length = 0; }
    if (!tcfg.emojiEn) { emoji.length = 0; defEmoji.length = 0; }
    if (!tcfg.stickerEn) { sticker.length = 0; image.length = 0; }
    return {
      text: text,
      kaomoji: kaomoji,
      emoji: emoji,
      defText: defText,
      defKaomoji: defKaomoji,
      defEmoji: defEmoji,
      sticker: sticker,
      image: image
    };
  }
  // 按「整体概率 + 分类占比」从默认字卡池抽一张（main/kaomoji/emoji；拍一拍不进信件）；
  // 未命中/池空返回 ''——与聊天 getDefaultCards 同语义，不含拍一拍分类
  function pickDefaultMailCard(pool, cid) {
    try {
      // v3.12.x：概率/占比/分类开关按【该联系人桌面】读（同 pushDefault 口径）
      const st = (cid && window.storeFor) ? window.storeFor(cid) : null;
      const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
      const dcfg = a ? a.cfg() : ((window.defaultCardCfg && window.defaultCardCfg()) || {});
      if (dcfg.enabled === false) return '';
      // v3.28.x：写信场景概率读 dc-overall-mail（未设置回退整体 dc-overall）——用户可单独调高写信默认字卡占比
      const overall = (dcfg.overallFor ? dcfg.overallFor('mail') : ((dcfg.overall === undefined || dcfg.overall === null) ? 30 : dcfg.overall));
      if (Math.random() * 100 >= overall) return '';
      const keys = ['main', 'kaomoji', 'emoji'];
      const pools = { main: pool.defText, kaomoji: pool.defKaomoji, emoji: pool.defEmoji };
      const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
      // FIX 2026-09-15 #534 写信内容类型开关也管住这条「默认字卡按分类占比混入」路径：
      //   kaomoji/emoji 被关掉时权重清零，抽签不会再落到空池导致整次注入空转（与
      //   mailCardPool 清池同批；缺省键＝开，存量行为不变）。
      const mcfg = mailCfgFor(cid);
      const weights = keys.map(k => {
        if (k === 'kaomoji' && !mcfg.kaomojiEn) return 0;
        if (k === 'emoji' && !mcfg.emojiEn) return 0;
        return catOn(k) ? Math.max(0, (dcfg.probs && dcfg.probs[k]) || 0) : 0;
      });
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return '';
      let roll = Math.random() * total;
      for (let i = 0; i < keys.length; i++) {
        roll -= weights[i];
        if (roll < 0) {
          const p = pools[keys[i]] || [];
          if (p.length) return p[Math.floor(Math.random() * p.length)];
          return '';
        }
      }
    } catch (e) {}
    return '';
  }
  // v3.12.x：只读探针——TA 写信素材池（自定义 + 按该联系人桌面开关的默认字卡子池），
  // 供回归测试与来源诊断
  window.mailPoolFor = function (cid) {
    try {
      const p = mailCardPool(cid);
      // #534：补 kaoN/emojiN/stickerN/imageN——「内容类型开关关掉后对应池确实清空」
      // 需要能直接观测，否则回归只能靠间接推断。
      return {
        textN: p.text.length, defTextN: p.defText.length, defKaoN: p.defKaomoji.length, defEmojiN: p.defEmoji.length,
        kaoN: p.kaomoji.length, emojiN: p.emoji.length,
        stickerN: (p.sticker || []).length, imageN: (p.image || []).length
      };
    } catch (e) { return null; }
  };
  // TA 写信内容：多个字卡（空格分隔）+ 概率加颜文字/emoji/表情包
  function taLetterContent(cfg, cid) {
    const pool = mailCardPool(cid);
    // FIX 2026-09-15 #531：自定义「文字」池若全是颜文字/符号（没有可读句子卡），视为没有自定义
    // 正文——退回系统预设默认字卡正文（defText）。否则信件正文只剩用户加的那几张符号，用户报
    //「信都是颜文字」。含中文/字母的自定义字卡行为不变。
    const hasCustom = pool.text.some(s => typeof s === 'string' && /[A-Za-z0-9\u4e00-\u9fff\u3041-\u3096\u30a1-\u30fa]/.test(s));
    // 有自定义字卡 → 正文主体用自定义；无自定义 → 整体回退默认字卡池（再空才用固定文案）
    const words = hasCustom ? pool.text : (pool.defText.length ? pool.defText : TA_LETTERS);
    // v3.6.x：条数在「最少/最多字卡条数」之间随机；上限不超过池子大小——
    // 移除自定义字卡内置预设后用户没添加字卡时 words 回退为固定文案，
    // 条数超过池子会从同几段里反复抽 → 内容复制粘贴很多次（已修）。
    const maxN = Math.max(1, words.length);
    const wantMin = Math.min(Math.max(1, cfg.minCards || 1), maxN);
    const wantMax = Math.min(Math.max(wantMin, cfg.maxCards || wantMin), maxN);
    const n = wantMin + Math.floor(Math.random() * (wantMax - wantMin + 1));
    const parts = [];
    for (let i = 0; i < n; i++) {
      // v3.8.x：有自定义字卡时，每张卡按 dc-overall 概率混入默认字卡（自定义+默认一起用）；
      //   无自定义时正文整体已是默认字卡池，不再重复混入
      if (hasCustom) {
        const d = pickDefaultMailCard(pool, cid);
        if (d) { parts.push(d); continue; }
      }
      parts.push(words[Math.floor(Math.random() * words.length)]);
    }
    // v3.36.x：词典写信混入——词典独立页「写信使用」开启时，按「写信使用概率」
    //   随机把一条词典语录追加进信件正文（dictQuoteOne 自带分类/单卡开关过滤；
    //   池空或场景关=不混，默认概率 30%）
    try {
      if (window.dictUse && window.dictUse('mail') && window.dictQuoteOne
          && Math.random() * 100 < (window.dictOverall ? window.dictOverall('mail') : 30)) {
        const dq = window.dictQuoteOne();
        if (dq) parts.push(dq);
      }
    } catch (eDQ) {}
    let t = parts.join(' ');
    // 颜文字/emoji 附加：自定义对应分类为空时回退默认池（保持原补池行为）
    const kp = pool.kaomoji.length ? pool.kaomoji : pool.defKaomoji;
    const ep = pool.emoji.length ? pool.emoji : pool.defEmoji;
    if (cfg.kaomojiEn && kp.length && Math.random() * 100 < 30) t += ' ' + kp[Math.floor(Math.random() * kp.length)];
    if (cfg.emojiEn && ep.length && Math.random() * 100 < 15) t += ' ' + ep[Math.floor(Math.random() * ep.length)];
    // v3.11.x：只收 dataURL 媒体——信件正文按 sticker:/data:image 正则识别内联图片，
    //   链接导入的 http(s) 字卡拼进信纸只会显示成一段 URL 文字，先过滤掉
    // FIX 2026-09-13 #386 媒体池令牌卡放行（renderBody 已认 @@m:hash 渲内联图）
    const st = pool.sticker.concat(pool.image).filter(s => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))));
    if (cfg.stickerEn && st.length && Math.random() * 100 < 20) {
      // v3.26.x：TA 自动写信/回信选中的表情包如果超大（>阈值），在这里同步换一张
      //   小图（避免几百 KB 原图拼进 content 触发信箱主键 200KB 剥图成「图片」）。
      //   仓库里的原图先经 shrinkMediaUrl 抽一张压缩版缓存到内存，退化场景才保留原图。
      const orig = st[Math.floor(Math.random() * st.length)];
      const small = (window._shrunkStickerCache && window._shrunkStickerCache[orig]) || orig;
      t += ' ' + small;
    }
    return t;
  }
  function letterLast(cid) { const v = parseInt(csFor(cid).get('mail-letter-last'), 10); return isNaN(v) ? 0 : v; }
  function letterNext(cid) { const v = parseFloat(csFor(cid).get('mail-letter-next')); return isNaN(v) ? 0 : v; }
  // v3.6.x：每日来信计数（按自然日）——mail-letter-day 存 { d:'日期', n:当天来信数 }
  function letterDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function letterDayCount(cid) {
    try {
      const r = JSON.parse(csFor(cid).get('mail-letter-day') || 'null');
      return r && r.d === letterDayKey() ? Number(r.n) || 0 : 0;
    } catch (e) { return 0; }
  }
  function letterDayAdd(cid) {
    const n = letterDayCount(cid) + 1;
    try { csFor(cid).set('mail-letter-day', JSON.stringify({ d: letterDayKey(), n: n })); } catch (e) {}
    return n;
  }
  // v3.7.x：单联系人的 TA 来信——用该联系人自己的字卡 + 写到该联系人命名空间。
  //   原实现 maybeIncomingLetter 单定时器用 store（当前激活桌面），用户在 default
  //   桌面时所有联系人的来信都写到 default 命名空间 → 串桌面（default 桌面堆所有
  //   联系人的信，切到其它桌面看不到自己的信）。改为遍历各联系人，每个独立写各自
  //   命名空间，互不串。前台弹窗仅当前激活桌面才弹（用户能看到），非当前桌面走
  //   notifyMailToChat 写该桌面聊天系统消息（下次切到该桌面可见）。
  function maybeIncomingLetterFor(cid) {
    try {
      // v3.9.x：当前桌面权威加载完成前不写来信（同 checkPendingReplyFor 的守卫——
      // load(cid) 此时可能来自剥图快照，unshift 后直接落盘会覆盖 IDB 带图信件）
      if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
      const cs = csFor(cid);
      const now = Date.now();
      // v3.12.x：按该联系人桌面读设置（每天最多写信/概率/间隔各自独立生效）
      const cfg = mailCfgFor(cid);
      // #296：联系人主动写信总开关——关闭后本桌面 TA 不再主动来信（回信/摸鱼小结不受影响）
      if (!cfg.writeEn) return;
      let last = letterLast(cid), next = letterNext(cid);
      if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
      if ((now - last) / 60000 < next) return;
      const dailyMax = cfg.dailyMax > 0 ? cfg.dailyMax : 3;
      if (letterDayCount(cid) >= dailyMax) {
        cs.set('mail-letter-last', String(now));
        cs.set('mail-letter-next', String(30));
        return;
      }
      if (Math.random() * 100 >= cfg.writeProb) return;
      const name = partnerNameFor(cid);
      const content = taLetterContent(cfg, cid);
      const letter = { id: 'l_' + Date.now() + '_' + cid, type: 'received', tt: TITLES[Math.floor(Math.random() * TITLES.length)], content: content, tm: Date.now() };
      const list = load(cid);
      list.unshift(letter);
      save(list, cid);
      cs.set('mail-letter-last', String(now));
      cs.set('mail-letter-next', String(cfg.writeMin + Math.random() * Math.max(1, cfg.writeMax - cfg.writeMin)));
      letterDayAdd(cid);
      notifyMailToChat(cid, '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' + name + ' 给你寄来了一封信', { mailNotice: true });
      // 前台弹窗 + 角标刷新仅当前激活桌面（用户能看到）；非当前桌面下次切回时 load 自然显示
      if (cid === (window.__activeCid || 'default')) {
        updateBadge();
        render();
        if (window.showDeskPopup && !mailPageVisible()) {
          window.showDeskPopup({ name: '信箱', text: '给你寄来了一封信：' + String(content || '').replace(/@@m:[0-9a-f]{32}/g, '[图片]').replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]'), onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
        }
      }
    } catch (e) {}
  }
  function maybeIncomingLetter() {
    const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    list.forEach(c => maybeIncomingLetterFor(c.id));
  }

  // ================= v3.13.x：每周摸鱼小结（周日 18 点后生成；周一~周三补上周的） =================
  // 数据源：该联系人桌面命名空间的 fish-day-add / work-day-add（每日新增记录，与日历同源）。
  // 以 TA 口吻寄一封「本周摸鱼小结」进信箱；标记键 fish-week-report:<M-D>（周日日期）防重发。
  function fishWeekReportFor(cid) {
    // 当前桌面权威加载（mailDbReady）完成前不写——同 maybeIncomingLetterFor 守卫，
    // 防止把剥图快照当全量列表写回覆盖 IDB 带图信件
    if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
    // #645：回复设置→信箱「摸鱼小结寄信」开关（ml-fish-week-en）——关闭后不再寄小结；
    // 判定放在防重发标记写入之前，关掉再开若仍在周一~周三补发窗口内会补上该周小结
    if (!mailCfgFor(cid).fishWeekEn) return;
    const cs = csFor(cid);
    const now = window.__fishWeekNowOverride ? window.__fishWeekNowOverride() : new Date(); // 测试钩子：生产为 null
    const day = now.getDay(); // 0=日
    const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let sun; // 小结所属周的周日（周一~周日算一周）
    if (day === 0 && now.getHours() >= 18) {
      sun = cur;
    } else {
      const back = ((day + 6) % 7) + 1; // 距上一个周日 1~7 天（周一=2 … 周六=7）
      if (back < 2 || back > 4) return; // 只补最近一周：周一~周三内补发
      sun = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - back);
    }
    const markKey = 'fish-week-report:' + (sun.getMonth() + 1) + '-' + sun.getDate();
    if (cs.get(markKey)) return;
    cs.set(markKey, '1');
    const start = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() - 6);
    const startTs = start.getTime();
    const endTs = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 1).getTime();
    // fishDayKey 日期格式 YYYY-M-D 不补零（iOS 解析需先补零——calendar/personalize 同款口径）
    const parseDay = (s) => {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
      if (!m) return NaN;
      return Date.parse(m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) + 'T00:00:00');
    };
    let fm = 0, ft = 0, wm = 0, wt = 0;
    const wdSum = [0, 0, 0, 0, 0, 0, 0]; // 周一..周日 各日双方摸鱼合计
    try {
      JSON.parse(cs.get('fish-day-add') || '[]').forEach(x => {
        const ts = parseDay(x && x.date);
        if (isNaN(ts) || ts < startTs || ts >= endTs) return;
        const m2 = x.mine || 0, t2 = x.ta || 0;
        fm += m2; ft += t2;
        wdSum[(new Date(ts).getDay() + 6) % 7] += m2 + t2;
      });
    } catch (e) {}
    try {
      JSON.parse(cs.get('work-day-add') || '[]').forEach(x => {
        const ts = parseDay(x && x.date);
        if (isNaN(ts) || ts < startTs || ts >= endTs) return;
        wm += x.mine || 0; wt += x.ta || 0;
      });
    } catch (e) {}
    const name = partnerNameFor(cid);
    let bestIdx = 0;
    for (let i = 1; i < 7; i++) if (wdSum[i] > wdSum[bestIdx]) bestIdx = i;
    const wdNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const totalFish = fm + ft;
    const lines = [
      '本周（' + (start.getMonth() + 1) + '月' + start.getDate() + '日 - ' + (sun.getMonth() + 1) + '月' + sun.getDate() + '日）小结',
      '',
      '你和我一共摸鱼 ' + totalFish + ' 点（你 +' + fm + ' · 我 +' + ft + '）。',
      totalFish > 0 ? '最会摸的一天是' + wdNames[bestIdx] + '，加了 ' + wdSum[bestIdx] + ' 点。' : '这一周还没怎么摸鱼呀，都在认真打工吗？',
      '工作值也一起攒了 ' + (wm + wt) + ' 点（你 +' + wm + ' · 我 +' + wt + '）。',
      '',
      '下周也偷偷一起加油呀。'
    ];
    const letter = { id: 'l_' + Date.now() + '_' + cid + '_wk', type: 'received', tt: '本周摸鱼小结', content: lines.join('\n'), tm: Date.now() };
    const list = load(cid);
    list.unshift(letter);
    save(list, cid);
    notifyMailToChat(cid, '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' + name + ' 寄来一份本周摸鱼小结', { mailNotice: true });
    if (cid === (window.__activeCid || 'default')) {
      updateBadge();
      render();
      if (window.showDeskPopup && !mailPageVisible()) {
        window.showDeskPopup({ name: '信箱', text: '寄来了一份本周摸鱼小结', onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
      }
    }
  }
  function fishWeekTick() {
    const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    list.forEach(c => { try { fishWeekReportFor(c.id); } catch (e) {} });
  }
  window.fishWeekTick = fishWeekTick; // v3.13.x：暴露给专项验证脚本（生产内部定时器同样调它）
  // v3.9.x 修复（iOS 信箱 TA 回信永不触发）：原实现 checkPendingReply 只在
  //   「启动后 20~60s 随机延迟 + 每 60s 定时器」里跑。iOS 后台/锁屏会冻结全部
  //   页面定时器、主屏独立 PWA 很快被系统回收，用户会话经常短于 20~60s 首查延迟
  //   （开 App 看一眼信箱就切走）→ 到期回信计划永远等不到落地时机，表现为
  //   「回了信/寄了信，联系人回信一直不触发」。修复：补查不再依赖唯一定时器——
  //   ① 启动立即补查；② 前台可见性恢复（visibilitychange/pageshow/focus，节流 5s）
  //   立即补查（iOS 从后台切回/解锁即落地）；③ 权威加载完成回调里补查；
  //   ④ 打开信箱页时补查。来信（maybeIncomingLetter）有 last/next 时间窗 +
  //   每日上限守卫，跟随补查只会更及时不会刷屏。
  checkPendingReply(); // 启动立即补查（当前桌面未就绪由内部守卫跳过，就绪后回调再补）
  setTimeout(() => {
    setInterval(() => {
      // v3.27.x 性能：后台空转守卫——hidden 且无后台通知通道（bgNotifyCheck 缺失）时，
      // 本轮来信/回信落地用户全都看不见（弹窗走不了、渲染已被 render 门槛跳过），
      // 回前台由 eagerCheck 立即补查，及时性不损失。
      // 有 bgNotifyCheck 时照跑＝不能跳：「人在后台仍收到来信通知」是 #673 起的
      // 产品功能（showDeskPopup isHidden→bgNotifyCheck），跳过＝负优化。
      if (document.visibilityState === 'hidden' && !window.bgNotifyCheck) return;
      maybeIncomingLetter(); checkPendingReply(); fishWeekTick();
    }, 60000);
    maybeIncomingLetter();
    fishWeekTick();
  }, (20 + Math.random() * 40) * 1000);
  // 前台恢复补查（节流 5s）：visibilitychange 覆盖 iOS 切后台/锁屏回前台；
  // pageshow(persisted) 覆盖 bfcache 恢复（期间定时器被冻结）；focus 覆盖
  // 只触发 focus 不触发 visibilitychange 的浏览器
  let lastEagerCheck = 0;
  function eagerCheck() {
    const now = Date.now();
    if (now - lastEagerCheck < 5000) return;
    lastEagerCheck = now;
    maybeIncomingLetter();
    checkPendingReply();
    fishWeekTick();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') eagerCheck();
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) eagerCheck(); });
  window.addEventListener('focus', eagerCheck);

  // ================= 入口与交互 =================
  // v3.10.x：写信/回信内容读取兜底——安卓 mobile-adapt 把输入框转成 ce-box 后值走
  // value 代理，个别内核（vivo/OPPO 系实测先例）代理读空 → sendLetter 拿到空串
  // 直接「信件内容不能为空」返回，信根本没寄出去（列表自然无信可点、也永远等不到
  // 回信）。这里对齐 period.js readInpVal / music-player readCeInput：读空再从
  // __ceBox 取 innerText 兜底。
  function readMailVal(el) {
    if (!el) return '';
    let v;
    try { v = el.value; } catch (e) {}
    if (v !== undefined && v !== null && String(v).trim()) return String(v);
    try {
      const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
      if (box) return (box.innerText !== undefined ? box.innerText : box.textContent) || '';
    } catch (e) {}
    return v === undefined || v === null ? '' : String(v);
  }
  const mailApp = document.querySelector('.app[data-app="mail"]');
  const mailPage = document.getElementById('page-mail');
  if (mailApp && mailPage) {
    mailApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      openMailPage();
    });
  }
  const mailBack = document.getElementById('mail-back');
  if (mailBack) mailBack.addEventListener('click', () => {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const phone = document.getElementById('page-phone');
    if (phone) phone.hidden = false;
  });
  // 写信：写信 tab 按钮 / 独立写信页
  const openWriteBtn = document.getElementById('mail-open-write');
  if (openWriteBtn) {
    openWriteBtn.addEventListener('click', () => {
      const toEl = document.getElementById('mail-write-to');
      if (toEl) toEl.textContent = partnerName();
      showPage('page-mail-write');
    });
  }
  const mailWriteBack = document.getElementById('mail-write-back');
  if (mailWriteBack) mailWriteBack.addEventListener('click', () => { if (window.closeEmojiPanel) window.closeEmojiPanel(); showPage('page-mail'); render(); });
  const mailSend = document.getElementById('mail-send');
  if (mailSend) mailSend.addEventListener('click', sendLetter);
  // 回信页：返回 / 寄出
  const mailReplyBack = document.getElementById('mail-reply-back');
  if (mailReplyBack) mailReplyBack.addEventListener('click', () => { if (window.closeEmojiPanel) window.closeEmojiPanel(); viewLetter = null; showPage('page-mail'); render(); });
  const mailReplySend = document.getElementById('mail-reply-send');
  if (mailReplySend) mailReplySend.addEventListener('click', submitReply);
  // tab 切换（v3.10.x 抽成函数：寄信成功后自动跳「寄出的信」复用）
  function selectMailTab(name) {
    mtab = name;
    document.querySelectorAll('#page-mail .fav-tab').forEach(x => x.classList.toggle('sel', x.dataset.mtab === name));
    document.querySelectorAll('#page-mail .cal-card').forEach(c => { c.hidden = c.dataset.mpanel !== name; });
  }
  document.querySelectorAll('#page-mail .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => selectMailTab(tab.dataset.mtab));
  });

  // ================= 写信/回信：表情包 / 图片 工具栏（v3.6.x 只留这两个按钮） =================
  // 表情包：直接复用聊天页同一个表情包面板（window.openEmojiPanelForInsert），
  // 界面/分组/数据与聊天完全一致；点击表情以 sticker:dataURL 插入信纸（渲染时显示小图）。
  // 图片：多选上传 → 压缩到 720px 后按大图（image:）插入信纸。
  // 向写信/回信输入框追加内容（插入到光标处）
  function mailInsertInto(textarea, s) {
    if (!textarea) return;
    // v3.5.135：contenteditable 转换模式（__ceBox）——插入**图片缩略图**而非纯文本，
    // 否则输入框里显示一大串 base64 字母；隐藏的 span 保留完整标记文本供 value 读取
    if (textarea.__ceBox) {
      try {
        const box = textarea.__ceBox;
        box.focus();
        const sel = window.getSelection();
        let node = box;
        let offset = 0;
        if (sel && sel.rangeCount && box.contains(sel.anchorNode)) {
          offset = sel.anchorOffset;
          node = sel.anchorNode;
        }
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        // 图片缩略图（dataURL 直接作 src；sticker 小图/图片大图都用中等缩略）
        const img = document.createElement('img');
        img.src = String(s).replace(/^(?:sticker|image):/, '');
        img.style.cssText = 'max-width:120px;max-height:120px;border-radius:8px;vertical-align:middle;margin:2px;display:inline-block;';
        img.contentEditable = 'false';
        // 隐藏文本占位（完整标记文本，供 value getter 读回存储）
        const span = document.createElement('span');
        span.className = 'mail-media-mark';
        span.style.display = 'none';
        span.textContent = s;
        span.contentEditable = 'false';
        // v3.6.x：用 DocumentFragment 一次性插入保证 DOM 顺序为 img → span → 空格。
        // 直接连续 range.insertNode 每次都插到 range 起点且起点不移动，结果是逆序
        // （span 跑到 img 前面）；mobile-adapt 的 value getter 靠「img 后紧跟标记 span」
        // 跳过 img 去重，逆序时检测失败 → 同一张图被输出两遍（信件里表情包变两个）。
        const frag = document.createDocumentFragment();
        frag.appendChild(img);
        frag.appendChild(span);
        frag.appendChild(document.createTextNode(' '));
        range.insertNode(frag);
        // 光标移到插入内容之后
        range.setStartAfter(span);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        // 触发 input 事件（业务可能监听）
        try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        return;
      } catch (e) {
        // 回退到文本插入
      }
    }
    try {
      let start = textarea.selectionStart;
      if (typeof start !== 'number' || isNaN(start)) start = textarea.value.length;
      const end = start;
      textarea.value = textarea.value.slice(0, start) + s + textarea.value.slice(end);
      textarea.focus();
      const pos = start + s.length;
      textarea.setSelectionRange(pos, pos);
    } catch (e) {
      textarea.value += s;
    }
  }
  // 上传本地图片：多选 → 压缩到 720px 后按大图（image:）插入信纸
  // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 accept 迟到＋无 label 兜底＋
  // 每次调用 new 一个 input 再 remove）
  function mailUploadImage(textarea) {
    window.mochiFilePick({
      id: 'mochi-mail-img-pick', accept: 'image/*', multiple: true,
      onFiles: (files) => {
        if (!files.length) { toast('没有取到图片，请再选一次'); return; }
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
                mailInsertInto(textarea, 'image:' + c.toDataURL('image/png'));
              } catch (err) {
                mailInsertInto(textarea, 'image:' + reader.result);
              }
            };
            img.onerror = () => toast('图片读取失败');
            img.src = reader.result;
          };
          reader.onerror = () => toast('图片读取失败');
          reader.readAsDataURL(f);
        });
      }
    });
  }
  // 绑定写信/回信工具栏（v3.6.x 只保留 表情包 / 图片 两个按钮）
  function bindMailToolbar(scope, textareaId) {
    const root = document.querySelector(scope);
    const textarea = document.getElementById(textareaId);
    if (!root || !textarea) return;
    const stickerBtn = root.querySelector('.mail-tb-sticker');
    if (stickerBtn) stickerBtn.addEventListener('click', (e) => {
      // stopPropagation：防止冒泡到 document 的「面板外点击关闭」把刚打开的面板又关掉
      e.stopPropagation();
      // 复用聊天同一个表情包面板（插入模式：点击表情插入信纸）
      // v3.26.x：贴进信纸正文前先压缩超大表情包 dataURL（见 chatcard.js shrinkMediaUrl）——
      //   否则写信/回信把几百 KB 原图拼进 content，信箱主键超 200KB 剥图成「图片」文字
      // #636：kind==='text' 是颜文字/emoji 文字卡，按纯文本插入信纸（不走 sticker: 标记）
      if (window.openEmojiPanelForInsert) window.openEmojiPanelForInsert((src, kind) => {
        if (kind === 'text') { mailInsertInto(textarea, src); return; }
        try { if (window.shrinkMediaUrl) { window.shrinkMediaUrl(src, (small) => { mailInsertInto(textarea, 'sticker:' + (small || src)); }); return; } } catch (e) {}
        mailInsertInto(textarea, 'sticker:' + src);
      }, { allowUrl: true });
    });
    const upImg = root.querySelector('.mail-tb-image');
    if (upImg) upImg.addEventListener('click', () => mailUploadImage(textarea));
  }
  bindMailToolbar('#page-mail-write', 'mail-input');
  bindMailToolbar('#page-mail-reply', 'mail-reply-input');

  // ================= 信箱数据：导出 / 导入 / 清空（v3.6.x） =================
  // 数据就是 mail-letters 数组（含收信/寄信/回信/对方回信），导出为 JSON 下载；
  // 导入按信件 id 去重合并；清空需确认，同时清掉待回信计划。
  function mailExportData() {
    const list = load();
    const json = JSON.stringify({ version: '1.0', app: 'mochi-mail', exportTime: new Date().toISOString(), letters: list }, null, 2);
    try {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '信箱数据_' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('已导出 ' + list.length + ' 封信');
    } catch (e) { toast('导出失败'); }
  }
  // 兼容旧 iOS：读取文件文本（File.text() 不支持时退回 FileReader）
  function mailReadFileText(file) {
    return new Promise((resolve) => {
      if (typeof file.text === 'function') {
        file.text().then(resolve).catch(() => readViaReader());
      } else readViaReader();
      function readViaReader() {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => resolve('');
        r.readAsText(file, 'utf-8');
      }
    });
  }
  function mailImportFile(file) {
    mailReadFileText(file).then((text) => {
      let arr = null;
      try {
        const data = JSON.parse(text || 'null');
        if (Array.isArray(data)) arr = data;
        else if (data && Array.isArray(data.letters)) arr = data.letters;
      } catch (e) {}
      if (!arr || !arr.length) { toast('无效的信箱数据文件'); return; }
      const valid = arr.filter(x => x && typeof x === 'object' && x.id);
      if (!valid.length) { toast('文件中没有有效的信件数据'); return; }
      const cur = load();
      // 按 id 去重合并：导入的信件覆盖同 id，新增的追加
      const map = {};
      cur.forEach(l => { if (l && l.id) map[l.id] = l; });
      valid.forEach(l => { map[l.id] = l; });
      const merged = Object.keys(map).map(k => map[k]);
      if (window.openModal) {
        window.openModal('导入 ' + valid.length + ' 封信？', '', () => {
          save(merged);
          viewLetter = null;
          render();
          updateBadge();
          toast('已导入 ' + valid.length + ' 封信（共 ' + merged.length + ' 封）');
        }, { noInput: true, staticText: '将合并进现有信箱（当前 ' + cur.length + ' 封）：\n· 导入 ' + valid.length + ' 封，其中 ' + (valid.length - (merged.length - cur.length)) + ' 封覆盖同 id 旧信\n· 同 id 以导入内容为准，其余保留\n导入后共 ' + merged.length + ' 封。' });
      }
    });
  }
  function mailClearAll() {
    const n = load().length;
    if (window.openModal) {
      window.openModal('清空所有信件？', '', () => {
        save([]);
        replyPendingSave([]); // 同时清掉未到期的 TA 回信计划
        viewLetter = null;
        render();
        updateBadge();
        toast('信箱已清空');
      }, { noInput: true, staticText: '将删除全部 ' + n + ' 封信（收信/寄信/回信），且无法恢复。' });
    }
  }
  // 删除单封信：确认后移除该信及其 TA 回信计划，关闭详情并刷新列表/角标
  function deleteLetter(l) {
    if (!l || !l.id) return;
    if (window.openModal) {
      window.openModal('删除这封信？', '', () => {
        const list = load();
        save(list.filter(x => x.id !== l.id));
        const pending = replyPendingLoad().filter(p => !p || p.id !== l.id);
        replyPendingSave(pending);
        viewLetter = null;
        render();
        updateBadge();
        const mask = document.getElementById('tc-mask');
        if (mask) mask.hidden = true;
        toast('信件已删除');
      }, { noInput: true, staticText: '删除后将无法恢复。' });
    }
  }
  const mailExportBtn = document.getElementById('mail-export');
  if (mailExportBtn) mailExportBtn.addEventListener('click', mailExportData);
  const mailImportBtn = document.getElementById('mail-import');
  if (mailImportBtn) {
    mailImportBtn.addEventListener('click', () => {
      // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
      window.mochiFilePick({
        id: 'mochi-mail-import-pick', accept: '.json,application/json',
        onFiles: (files) => {
          const f = files && files[0];
          if (!f) { toast('没有取到文件，请再选一次'); return; }
          mailImportFile(f);
        }
      });
    });
  }
  const mailClearBtn = document.getElementById('mail-clear');
  if (mailClearBtn) mailClearBtn.addEventListener('click', mailClearAll);

  render();
  updateBadge();

  // v3.5.94：信件含图片 dataURL，可能只存在 IndexedDB → 启动补读（信箱打开时才渲染，届时读到）
  // v3.5.120：改为权威加载——每次启动都从 IDB 读 mail-letters，并合并暂存期间
  // （mailDbReady=false）用户写入的信件/已读标记（按 id 覆盖 + 按 tm 保序），
  // 就绪后重渲染。修复「刷新后信箱数据丢失」：旧逻辑只在 localStorage 空时补读一次，
  // 补读窗口内任何 save([]) 都会先覆盖 IDB，导致补读被跳过、信件永久丢失。
  // v3.6.x：① 合并基准扩展——原实现只在「IDB 有信件」时合并 mailPending，IDB 空时
  // 暂存被静默丢弃；改为：基准 = IDB 信件（备份导入语义），否则当前 localStorage，
  // 暂存按 id 覆盖合并后落盘。② 保险丝后 IDB 迟到返回时取并集，不覆盖已落盘信件。
  // v3.8.x：mailMergeFromIdb 增加显式 cid——原实现固定用动态 store（当前激活桌面），
  // contact-switched 的 idbGet 迟到返回时若用户已切到别的桌面，会把【旧桌面的信】
  // 合并写进【当前桌面】→ 串桌面（iOS Safari IDB 慢时信箱显示全是当前角色来信，
  // 分不清谁是谁）。cid 传入后读写/快照全部绑定该桌面；cid 不传（启动路径）保持
  // 原动态行为（启动无切换，动态 = 当前桌面，等价）。
  function mailMergeFromIdb(v, cid) {
    try {
      const pending = mailPending || [];
      mailPending = null;
      let base = [];
      if (v && typeof v === 'string' && v.length > 2) {
        const idbArr = JSON.parse(v);
        if (Array.isArray(idbArr)) base = idbArr;
      }
      // v3.13.x：无论 IDB 是否有数据，始终把当前持久层（localStorage 主键/快照）合进并集——
      // 原实现仅在「权威已就绪 或 IDB 为空」时读 cur，IDB 非空且未就绪时直接跳过本地：
      // 在 vivo/OPPO/真我 Edge 等 IDB 写入失败或挂起的设备上，新信（周报小结/寄出的信/
      // 收到的信）只写进 localStorage+内存缓存没进 IDB，下次启动权威合并以【旧 IDB】为
      // 基准，新信被整体丢弃 → 弹窗提示「寄来了一份本周摸鱼小结」信箱里却看不到。
      // 与 feed.js feedMergeFromIdb 同口径：基准 = IDB，并集保留本地独有数据（按 id 覆盖，
      // 本地优先），不重演旧的「save([]) 覆盖 IDB」问题。
      let cur = [];
      try { cur = JSON.parse(csFor(cid).get(KEY) || '[]'); } catch (e) { cur = []; }
      if (!cur.length) { try { cur = loadSnap(cid); } catch (e) {} }
      const merged = mergeLists(base, mergeLists(cur, pending));
      if (merged.length) { csFor(cid).set(KEY, JSON.stringify(merged)); writeSnap(merged, cid); }
    } catch (e) { /* 解析失败：仍置就绪，避免下次启动重复合并 */ }
  }
  try {
    if (window.idbGet) {
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':' + KEY).then(v => {
        if (window.activePrefix() !== myPrefix) return;
        mailMergeFromIdb(v);
        mailDbReady = true;
        checkPendingReply(); // v3.9.x：权威就绪立即补查到期回信（启动即到的回信不再等 20~60s）
        render();
        updateBadge();
      });
    } else {
      mailDbReady = true;
    }
  } catch (e) { mailDbReady = true; }
  // v3.6.x：权威读取保险丝——IndexedDB 打开/读取在个别手机（OPPO 雨见浏览器后台
  // 挂起/存储异常）可能迟迟不返回，mailDbReady 一直为 false，来信只进内存暂存：
  // 弹窗提示了「给你寄来了一封信」信箱却空白、刷新后信件丢失。15 秒后强制就绪并
  // 把暂存信件落盘（与 idbRestore 的 12s 保险同理；正常情况 idbGet 早已返回，
  // 该保险只在病理场景触发，mailDbReady 已真时直接跳过）
  setTimeout(function () {
    if (mailDbReady) return;
    try {
      const all = load();
      if (all.length) store.set(KEY, JSON.stringify(all));
    } catch (e) {}
    mailDbReady = true;
    checkPendingReply(); // v3.9.x：保险丝就绪同样补查（权威加载挂起场景）
    render();
    updateBadge();
  }, 15000);

  // v3.6.x：多桌面——切换联系人后重置信箱状态并重新从新桌面的 IDB 权威加载。
  // 若不重置，mailDbReady/mailPending 仍属旧桌面：load() 读的是新桌面持久层，
  // 但暂存信件（mailPending）会按 id 合并进来（串桌面）；权威已就绪标志也会
  // 让 save() 直接把新桌面数据写进 store（正确），但旧桌面暂存仍残留。
  document.addEventListener('contact-switched', function () {
    try {
      // v3.8.x：绑定本次切换的桌面 id——idbGet/保险丝都是异步的，回调执行时用户
      // 可能已切到别的桌面：原实现用动态 store（当前桌面）合并写回，旧桌面的
      // idbGet 迟到时把旧桌面的信写进新桌面 → 串桌面（iOS Safari 慢 IDB 实测：
      // 信箱在哪个角色页面就显示全部是这个角色来信，分不清谁是谁）。
      // 与启动权威加载（mailMergeFromIdb 调用前的 activePrefix 校验）同模式：
      // 回调先校验归属，已切走则作废——新桌面的切换监听会重新发起权威加载。
      const switchedCid = window.__activeCid || 'default';
      mailDbReady = false;
      mailPending = null;
      // v3.7.x：补 15s 保险丝（与启动 line 798 同理）——切换联系人后 idbGet 在
      // 个别手机（华为/edge/OPPO 后台挂起）可能不返回，mailDbReady 永远 false →
      // 之后 save() 只暂存内存不落盘，新来信刷新即丢。chat.js 切换时调了
      // armReadyFuse()，mail 缺这步。到期强制就绪并把暂存信件落盘。
      // v3.8.x：保险丝绑定 switchedCid——已切走时作废（新桌面有自己的保险丝），
      // 避免旧桌面的保险丝误把新桌面的 mailDbReady 置真（新桌面权威加载还在飞）。
      let fuseFired = false;
      const fuse = setTimeout(function () {
        if (fuseFired || mailDbReady) return;
        if ((window.__activeCid || 'default') !== switchedCid) return; // 已切走：本保险丝作废
        fuseFired = true;
        try {
          const all = load(switchedCid);
          if (all.length) csFor(switchedCid).set(KEY, JSON.stringify(all));
        } catch (e) {}
        mailDbReady = true;
        checkPendingReply(); // v3.9.x：切桌面权威就绪补查（新桌面到期的回信立即落地）
        render();
        updateBadge();
      }, 15000);
      if (window.idbGet) {
        window.idbGet(window.activePrefix() + ':' + KEY).then(v => {
          if (fuseFired) return; // 保险丝已先就绪，idbGet 迟到则跳过（load 已含暂存）
          if ((window.__activeCid || 'default') !== switchedCid) return; // 已切走：作废，不合并不置就绪
          clearTimeout(fuse);
          mailMergeFromIdb(v, switchedCid);
          mailDbReady = true;
          checkPendingReply(); // v3.9.x：切桌面权威就绪补查
          render();
          updateBadge();
        }).catch(() => {
          if (fuseFired) return;
          if ((window.__activeCid || 'default') !== switchedCid) return;
          clearTimeout(fuse);
          mailDbReady = true; render(); updateBadge();
        });
      } else {
        clearTimeout(fuse);
        mailDbReady = true;
        render();
        updateBadge();
      }
    } catch (e) { mailDbReady = true; }
  });
})();
