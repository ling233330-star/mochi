// ===== 功能：聊天统计页 / 小互动页 / 今日备忘·心情 =====
// 音乐：音乐库、播放列表、播放历史
// 聊天统计：相处天数、消息数、表情包/拍一拍/情绪统计
// 小互动：拍一拍 TA / 送一句情话
// v3.5.27：今日备忘/今天的心情历史双写 IndexedDB——导入备份覆盖 localStorage 后记录可从 IDB 回填
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  // 备忘/心情历史：localStorage + IndexedDB 双写；启动时从 IDB 回填缺失键（导入/清空后不丢记录）
  function pushHist(key, text) {
    try {
      const list = JSON.parse(store.get(key) || '[]');
      list.unshift({ text: text, ts: Date.now() });
      if (list.length > 200) list.length = 200;
      store.set(key, JSON.stringify(list));
      try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + key, JSON.stringify(list)); } catch (e) {}
    } catch (e) {}
  }
  function restoreHist(key) {
    try {
      if (window.idbGet && !store.get(key)) {
        const myPrefix = window.activePrefix();
        window.idbGet(myPrefix + ':' + key).then(v => {
          if (window.activePrefix() !== myPrefix) return;
          if (!v) return;
          try { store.set(key, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {}
        });
      }
    } catch (e) {}
  }
  restoreHist('memo-history');
  restoreHist('mood-history');
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // v3.7.x：本周日常点击其他日期查看当日内容用——按日期生成键
  function dayStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // 轻提示（全局唯一，与其它模块一致）
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

  // ================= 聊天统计页 =================
  const statsApp = document.querySelector('.app[data-app="stats"]');
  const statsPage = document.getElementById('page-stats');
  if (statsApp && statsPage) {
    statsApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      statsPage.hidden = false;
      renderStats();
    });
  }
  const statsBack = document.getElementById('stats-back');
  if (statsBack) {
    statsBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-phone');
      if (home) home.hidden = false;
    });
  }
  // ================= 聊天统计（完整版：相处记录 / 聊天记录 / 情绪表达） =================
  function statsInfoCard(icon, label, value) {
    return '<div class="stats-row"><span class="stats-label">' + icon + ' ' + label + '</span><span class="stats-num" style="font-size:15px">' + value + '</span></div>';
  }
  function fmtDTFull(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function calcStreak(dateSet) {
    const dates = Array.from(dateSet).sort();
    if (!dates.length) return 0;
    let max = 1, cur = 1;
    for (let i = 1; i < dates.length; i++) {
      const diff = (new Date(dates[i]) - new Date(dates[i - 1])) / 864e5;
      if (diff === 1) { cur++; max = Math.max(max, cur); } else cur = 1;
    }
      return max;
  }
  // v3.15.x：聊天记录 tab 新增「联系人发红包 / 申请心意币」流水区块（rows: {main, sub}）
  // #993：不再默认全量铺开——这一族是「流水」，行数随使用无上限累计（申请卡每触发一次一条、
  //   小游戏每局一条），攒几个月就是几十上百行，默认全展把「聊天记录」tab 拉得很长（用户实报）。
  //   开关态收在模块级 map：进统计页每次都重设 innerHTML，挂在 DOM 上的折叠态活不过一次渲染。
  const statsFoldOpen = { askcoin: false, games: false };
  function statsFoldSection(icon, title, unit, rows, emptyText, key) {
    const n = rows.length;
    const open = n > 0 && !!statsFoldOpen[key];
    let html = '<div class="stats-sec stats-fold' + (open ? ' open' : '') + '"' +
      (n ? ' data-stats-fold="' + key + '"' : '') + '>' +
      '<div class="stats-sec-head stats-fold-head"' + (n ? ' role="button" tabindex="0"' : '') +
      ' aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="stats-sec-title">' + icon + title + '</span>' +
      '<span class="stats-fold-right"><span class="stats-sec-count">' + n + ' ' + unit + '</span>' +
      (n ? '<span class="stats-fold-caret">▾</span>' : '') + '</span></div>' +
      '<div class="stats-fold-body">';
    if (!n) {
      html += '<div class="ta-empty">' + emptyText + '</div>';
    } else {
      html += '<div class="stats-list">';
      for (let i = n - 1; i >= 0; i--) {
        const r = rows[i];
        html += '<div class="stats-item">' +
          '<span class="stats-item-name">' + r.main + '</span>' +
          '<span class="stats-item-num dt">' + r.sub + '</span></div>';
      }
      html += '</div>';
    }
    return html + '</div></div>';
  }
  // #993：折叠开关——点区块头整行（caret 也在头内），键盘 Enter/Space 同效。事件委托只注册一次，
  //   重渲染出来的新区块自动生效；只在头内命中才切换，展开后点列表行不会把它误收回去。
  function statsFoldToggle(sec) {
    if (!sec) return;
    const key = sec.getAttribute('data-stats-fold');
    const head = sec.querySelector('.stats-fold-head');
    const open = !statsFoldOpen[key];
    statsFoldOpen[key] = open;
    sec.classList.toggle('open', open);
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  document.addEventListener('click', function (e) {
    const sec = e.target && e.target.closest ? e.target.closest('.stats-sec[data-stats-fold]') : null;
    if (!sec) return;
    const head = sec.querySelector('.stats-fold-head');
    if (!head || !head.contains(e.target)) return;
    statsFoldToggle(sec);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const head = e.target && e.target.closest ? e.target.closest('.stats-fold-head') : null;
    if (!head) return;
    e.preventDefault();
    statsFoldToggle(head.parentNode);
  });
  function fmtMDHM(ts) {
    if (!ts) return '';
    const t = new Date(ts);
    return String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') + ' ' +
      String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  }
  const escH = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function statsBarSection(icon, title, countMap, topLabel, emptyText) {
    const entries = [];
    for (const k in countMap) if (countMap.hasOwnProperty(k)) entries.push({ name: k, count: countMap[k] });
    entries.sort((a, b) => b.count - a.count);
    let html = '<div class="stats-sec">' +
      '<div class="stats-sec-head"><span class="stats-sec-title">' + icon + title + '</span>' +
      '<span class="stats-sec-count">' + entries.length + ' 种</span></div>';
    if (!entries.length) {
      html += '<div class="ta-empty">' + emptyText + '</div>';
    } else {
      const top = entries[0].name;
      const topCount = entries[0].count;
      html += '<div class="stats-top">' +
        '<div class="stats-top-tag">' + topLabel + '</div>' +
        '<div class="stats-top-name">「' + String(top).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '」</div>' +
        '<div class="stats-top-num">' + topCount + ' 次</div></div>';
      html += '<div class="stats-list">';
      entries.slice(0, 5).forEach(e => {
        html += '<div class="stats-item">' +
          '<span class="stats-item-name">' + String(e.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</span>' +
          '<span class="stats-item-num">' + e.count + '</span></div>';
      });
      html += '</div>';
    }
    return html + '</div>';
  }
  // v3.24.x：文字字卡统计——只统计自定义字卡（公用 + 专属）里的内容，按「我发 / TA发」分开。
  // 记录侧用「分类 + 分组 + 卡原文」识别（历史消息未存卡 id，只能按内容匹配）：
  // ① 取当前桌面的 公用字卡(cc-groups-public) + 专属字卡(cc-groups) 合并，只取 text 分类的文字卡；
  // ② 遍历聊天消息，只统计在字卡库里真实存在的卡（同一内容反复发也算多次）；
  // ③ 侧边按 side 分：out = 我发的，in = 联系人发的（含自动回复池抽取的自定义文字卡）。
  function ccCardSet() {
    const set = {};
    try {
      const rawOwn = (window.storeFor && window.storeFor(window.__activeCid || 'default') || store).get('cc-groups');
      const rawPub = (window.xyStore ? window.xyStore('xy-home-v2').get('cc-groups-public') : null);
      [rawOwn, rawPub].forEach(raw => {
        if (!raw) return;
        const g = JSON.parse(raw);
        if (!g || !g.text) return;
        (g.text || []).forEach(([gname, arr]) => (arr || []).forEach(c => {
          // FIX 2026-09-13 #394 令牌卡不入统计卡集；FIX 2026-09-17 #648 补嵌套令牌（indexOf 口径，
          // 全串锚定测不出混排）与 #533 裸图链——否则榜上直出令牌串/整段 URL
          if (typeof c === 'string' && c.indexOf('|||') < 0 && c.indexOf('data:') !== 0 && c.indexOf('@@m:') < 0 && !/^https?:\/\//i.test(c) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(c))) set[c] = 1;
        }));
      });
    } catch (e) {}
    return set;
  }
  function ccTextRankSection(icon, title, countMap, topLabel, emptyText, max, dataKey) {
    const entries = [];
    for (const k in countMap) if (countMap.hasOwnProperty(k)) entries.push({ name: k, count: countMap[k] });
    entries.sort((a, b) => b.count - a.count);
    let html = '<div class="stats-sec">' +
      '<div class="stats-sec-head"><span class="stats-sec-title">' + icon + title + '</span>' +
      '<span class="stats-sec-count">' + entries.length + ' 种</span></div>';
    if (!entries.length) {
      html += '<div class="ta-empty">' + emptyText + '</div>';
    } else {
      const top = entries[0].name;
      const topCount = entries[0].count;
      html += '<div class="stats-top">' +
        '<div class="stats-top-tag">' + topLabel + '</div>' +
        '<div class="stats-top-name">「' + String(top).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '」</div>' +
        '<div class="stats-top-num">' + topCount + ' 次</div></div>';
      html += '<div class="stats-list">';
      const shown = Math.min(max || 5, entries.length);
      for (let i = 0; i < shown; i++) {
        const e = entries[i];
        html += '<div class="stats-item">' +
          '<span class="stats-item-name">' + String(e.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</span>' +
          '<span class="stats-item-num">' + e.count + ' 次</span></div>';
      }
      html += '</div>';
      if (entries.length > shown) {
        html += '<div class="stats-more" data-cc-more="' + title + '" data-cc-key="' + dataKey + '">查看更多 ' + entries.length + ' 种字卡 ▾</div>';
      }
    }
    return html + '</div>';
  }
  // v3.24.x：自定义字卡（公用+专属）文字卡 Top100 全量弹层——内容只来自合并字卡库，
  // 上榜的都是字卡库里存在的卡，点「查看更多」弹出完整排名（上限 100）。
  function openCcTopModal(title, entries, emptyText) {
    if (!entries || !entries.length) { toast(emptyText || '暂无使用记录'); return; }
    const sorted = entries.slice().sort((a, b) => b.count - a.count);
    const top = sorted.slice(0, 100);
    let txt = '共 ' + sorted.length + ' 张自定义字卡使用过，按次数从高到低\n\n';
    top.forEach((e, i) => {
      txt += (i + 1) + '. ' + String(e.name) + '  ×' + e.count + '\n';
    });
    if (sorted.length > 100) txt += '\n… 仅显示前 100 名';
    if (window.openModal) window.openModal(title, '', function () {}, { staticText: txt, noInput: true, okText: '知道了' });
  }
  // v3.24.x：渲染「文字字卡」tab——自定义字卡（公用+专属）使用统计，我发 / TA发 分开
  function renderCcStats() {
    const ccEl = document.getElementById('st-cc-content');
    if (!ccEl) return;
    let msgs2 = [];
    try { msgs2 = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    if (!msgs2.length || !msgs2.some(m => m && m.side && m.text)) {
      ccEl.innerHTML = '<div class="ta-empty">暂无聊天记录</div>';
      return;
    }
    const cardSet = ccCardSet();
    const mineCount = {}, taCount = {};
    const name = store.get('lbl-partner') || 'TA';
    const myName = store.get('lbl-user') || '我';
    const EXPR_CORE_RE = /[^0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g;
    msgs2.forEach(m => {
      if (!m || typeof m.text !== 'string' || !m.side) return;
      if (m.special || m.retracted) return;
      if (m.text.indexOf('data:') === 0 || m.text.indexOf('http') === 0) return;
      if (m.text.indexOf('@@m:') >= 0) return; // FIX 2026-09-17 #648 混排令牌的消息也不入「常用文字字卡」榜（榜面文本会直出令牌串）
      if (window.mochiMediaIsToken && window.mochiMediaIsToken(m.text)) return; // FIX 2026-09-13 #394 存量乱码消息不入「常用文字字卡」榜
      const core = m.text.replace(EXPR_CORE_RE, '');
      if (!core) return;
      if (!(m.text in cardSet)) return;
      if (m.side === 'out') mineCount[m.text] = (mineCount[m.text] || 0) + 1;
      else taCount[m.text] = (taCount[m.text] || 0) + 1;
    });
    const mineN = Object.keys(mineCount).length, taN = Object.keys(taCount).length;
    ccEl.innerHTML =
      '<div style="margin-bottom:16px"><div style="font-size:13px;font-weight:700;color:#555;margin-bottom:8px">自定义字卡（公用 + 专属）使用统计</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="font-size:12px;color:var(--muted);width:28px">' + escH(myName) + '</div>' +
      '<div style="flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:4px;overflow:hidden"><div style="height:100%;background:var(--ink);width:' + ((mineN + taN) ? Math.round(mineN / (mineN + taN) * 100) : 0) + '%;border-radius:4px"></div></div>' +
      '<div style="font-size:12px;color:var(--ink);width:auto;text-align:right;white-space:nowrap">' + mineN + ' 种</div></div>' +
      '<div style="display:flex;align-items:center;gap:8px"><div style="font-size:12px;color:var(--muted);width:28px">' + escH(name) + '</div>' +
      '<div style="flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:4px;overflow:hidden"><div style="height:100%;background:#999;width:' + ((mineN + taN) ? Math.round(taN / (mineN + taN) * 100) : 0) + '%;border-radius:4px"></div></div>' +
      '<div style="font-size:12px;color:var(--ink);width:auto;text-align:right;white-space:nowrap">' + taN + ' 种</div></div></div>' +
      ccTextRankSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>', escH(myName) + ' 发的文字字卡', mineCount, '常用文字', '你还用过自定义字卡里的文字卡', 5, 'mine') +
      ccTextRankSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>', escH(name) + ' 发的文字字卡', taCount, '常用文字', '联系人还没用过自定义字卡里的文字卡', 5, 'ta');
    // 供「查看更多」弹层读取完整数据
    ccEl.__ccMine = []; for (const k in mineCount) if (mineCount.hasOwnProperty(k)) ccEl.__ccMine.push({ name: k, count: mineCount[k] });
    ccEl.__ccTa = []; for (const k in taCount) if (taCount.hasOwnProperty(k)) ccEl.__ccTa.push({ name: k, count: taCount[k] });
  }
  function renderStats() {
    renderCcStats();
    let msgs = [];
    try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    const real = msgs.filter(m => m && m.side && m.text);
    const firstTs = real.length ? (real[0].ts || Date.now()) : 0;
    const lastTs = real.length ? (real[real.length - 1].ts || firstTs) : 0;
    // v3.5.81：相处天数 = 恋爱纪念日（love-start）起算；未设置则用第一条聊天记录时间；
    //   聊天记录被清空/新装时不再显示 0（用纪念日兜底）
    let daysStart = firstTs;
    try {
      const loveStart = store.get('love-start');
      if (loveStart) {
        const ls = new Date(loveStart + 'T00:00:00').getTime();
        if (!isNaN(ls)) daysStart = ls;
      }
    } catch (e) {}
    const days = daysStart ? Math.max(0, Math.floor((Date.now() - daysStart) / 864e5)) : 0;
    // ---- 相处记录 ----
    const recordEl = document.getElementById('st-record-cards');
    if (recordEl) {
      let mine = 0, ta = 0, textChars = 0;
      real.forEach(m => {
        if (m.side === 'out') mine++; else ta++;
        if (typeof m.text === 'string' && m.text.indexOf('data:') !== 0) textChars += m.text.length;
      });
      let favsCount = 0;
      try { favsCount = (JSON.parse(store.get('fav-msgs') || '[]') || []).length; } catch (e) {}
      recordEl.innerHTML =
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>', '第一次聊天', fmtDTFull(firstTs) || '暂无记录') +
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/></svg>', '最近聊天', fmtDTFull(lastTs) || '暂无记录') +
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>', '聊天消息', (mine + ta) + ' 条') +
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 13l2 2 4-4"/></svg>', '文字数量', textChars + ' 字') +
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/></svg>', '收藏记录', favsCount + ' 条');
    }
    // ---- 聊天记录 ----
    const chatEl = document.getElementById('st-chat-content');
    if (chatEl) {
      if (!real.length) { chatEl.innerHTML = '<div class="ta-empty">暂无聊天记录</div>'; }
      else {
        let userCount = 0, taCount = 0;
        const hourCount = {}, dayCount = {}, dateCount = {};
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        real.forEach(m => {
          if (m.side === 'out') userCount++; else taCount++;
          const t = new Date(m.ts || Date.now());
          hourCount[t.getHours()] = (hourCount[t.getHours()] || 0) + 1;
          dayCount[t.getDay()] = (dayCount[t.getDay()] || 0) + 1;
          const ds = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
          dateCount[ds] = (dateCount[ds] || 0) + 1;
        });
        const total = userCount + taCount;
        const userPct = total ? Math.round(userCount / total * 100) : 0;
        const taPct = total ? Math.round(taCount / total * 100) : 0;
        let peakHour = 0, peakHourVal = 0;
        for (const h in hourCount) if (hourCount[h] > peakHourVal) { peakHourVal = hourCount[h]; peakHour = Number(h); }
        let peakDay = 0, peakDayVal = 0;
        for (const d in dayCount) if (dayCount[d] > peakDayVal) { peakDayVal = dayCount[d]; peakDay = Number(d); }
        const totalDays = Math.max(1, Math.floor((Date.now() - firstTs) / 864e5));
        let maxSingle = 0;
        for (const d in dateCount) maxSingle = Math.max(maxSingle, dateCount[d]);
        const name = store.get('lbl-partner') || 'TA';
        chatEl.innerHTML =
          '<div style="margin-bottom:16px"><div style="font-size:13px;font-weight:700;color:#555;margin-bottom:8px">消息比例</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="font-size:12px;color:var(--muted);width:28px">我</div>' +
          '<div style="flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:4px;overflow:hidden"><div style="height:100%;background:var(--ink);width:' + userPct + '%;border-radius:4px"></div></div>' +
          '<div style="font-size:12px;color:var(--ink);width:76px;text-align:right">' + userCount + ' 条 ' + userPct + '%</div></div>' +
          '<div style="display:flex;align-items:center;gap:8px"><div style="font-size:12px;color:var(--muted);width:28px">' + name + '</div>' +
          '<div style="flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:4px;overflow:hidden"><div style="height:100%;background:#999;width:' + taPct + '%;border-radius:4px"></div></div>' +
          '<div style="font-size:12px;color:var(--ink);width:76px;text-align:right">' + taCount + ' 条 ' + taPct + '%</div></div></div>' +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>', '最常聊天时间', peakHour + ':00 - ' + ((peakHour + 1) % 24) + ':00') +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>', '最常聊天日期', '星期' + dayNames[peakDay]) +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="18" y1="20" x2="18" y2="11"/></svg>', '平均每日消息', Math.round(total / totalDays) + ' 条') +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-3 4-3 7a3 3 0 006 0c0-1-.3-2-.8-3 1.8 1 3 3 3 5a6 6 0 11-12 0c0-4 3-6 4.5-8.5z"/></svg>', '最长连续聊天', calcStreak(Object.keys(dateCount)) + ' 天') +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>', '单日最高消息', maxSingle + ' 条') +
          // v3.16.x：红包记录——双向摘要（我发 + 联系人发，红包即心意币；累计金额 + 次数，明细已移至主页「心意币红包记录」）
          (function () {
            const myName = store.get('lbl-user') || '我';
            function rpSec(title, list, emptyTxt) {
              let sum = 0; list.forEach(m => { sum += Number(m.rpAmount || 0); });
              return '<div class="stats-sec"><div class="stats-sec-head"><span class="stats-sec-title">🧧 ' + title + '</span>' +
                '<span class="stats-sec-count">' + list.length + ' 笔</span></div>' +
                (list.length ? '<div class="stats-top"><div class="stats-top-tag">累计心意币</div><div class="stats-top-name">¥' + sum.toFixed(2) + '</div><div class="stats-top-num">共 ' + list.length + ' 次</div></div>'
                  : '<div class="ta-empty">' + emptyTxt + '</div>') +
                '</div>';
            }
            return rpSec(myName + ' 发红包', msgs.filter(m => m && m.special === 'redpacket' && m.side === 'out'), '我还没有发过红包（红包也是心意币，去发一个试试）') +
              rpSec(escH(name) + ' 发红包', msgs.filter(m => m && m.special === 'redpacket' && m.side === 'in'), '还没有 ' + escH(name) + ' 发的红包');
          })() +
          // v3.15.x：联系人申请心意币记录（askcoin 卡片）；#993 与下方小游戏记录共用折叠渲染件
          statsFoldSection('🪙', name + '申请心意币记录', '笔',
            msgs.filter(m => m && m.special === 'askcoin').map(m => ({
              main: '+¥' + (Number(m.askFen || 0) / 100).toFixed(2),
              sub: fmtMDHM(m.askTs || m.ts)
            })),
            escH(name) + ' 还没有向 Mochi 申请过', 'askcoin') +
          // v3.16.x：小游戏记录（更多功能→小游戏 7 款对局 + 联系人主动邀请玩游戏，全部汇总）
          (function () {
            const GAME_SPECIAL = { brick: '双人打砖块', pong: '乒乓', snake: '贪吃蛇', memory: '记忆翻牌', rps: '猜拳', c4: '四子棋', ms: '合作扫雷' };
            const GAME_KIND = { rps: '猜拳', pong: 'Pong', snake: '双人贪吃蛇', gomoku: '五子棋', linkup: '连连看', match3: '消消乐', auction: '心意币拍卖会' };   // TA 主动邀请（cuddle 贴贴不算游戏）
            const GAME_NAME_RE = /^(四子棋|合作扫雷|记忆翻牌|双人打砖块|Pong)/;
            const rows = [];
            const push = (m, mainTxt, ico) => {
              if (!m) return;
              rows.push({ main: (ico || '🎮') + ' ' + escH(mainTxt), sub: fmtMDHM(m.ts || m.rpTs), ts: m.ts || m.rpTs || 0 });
            };
            msgs.forEach(m => {
              if (!m) return;
              if (m.special && GAME_SPECIAL[m.special]) push(m, GAME_SPECIAL[m.special] + ' · ' + (m.text || ''), '🎮');
              // 联系人主动邀请玩游戏（sendTaInvite 写入的 gInv 字段）
              else if (m.gInv && GAME_KIND[m.gInv]) push(m, name + ' 邀请玩 ' + GAME_KIND[m.gInv], '📩');
            });
            // 兜底：无 special 的老记录按文本前缀识别（四子棋/扫雷 v3.16.x 前未带标记）
            msgs.forEach(m => {
              if (!m || !m.text || !GAME_NAME_RE.test(m.text)) return;
              if (m.special && GAME_SPECIAL[m.special]) return;
              if (m.gInv) return;
              push(m, m.text, '🎮');
            });
            // 去重 + 时间正序（statsFoldSection 从尾渲染＝最新在上），与申请心意币记录同一渲染件
            const seen = new Set();
            const uniq = rows.filter(r => { const k = r.main + '|' + r.sub; if (seen.has(k)) return false; seen.add(k); return true; });
            uniq.sort((a, b) => (a.ts || 0) - (b.ts || 0));
            return statsFoldSection('🎮', '小游戏记录', '条', uniq, '还没有小游戏记录（更多功能 → 小游戏，和 TA 玩一局试试）', 'games');
          })();
        }
    }
    // ---- 情绪表达 ----
    const exprEl = document.getElementById('st-expr-content');
    if (exprEl) {
      if (!real.length) { exprEl.innerHTML = '<div class="ta-empty">暂无聊天记录</div>'; }
      else {
        const emotion = {}, heart = {}, intent = {};
        real.forEach(m => {
          (m.mood || []).forEach(md => {
            // v3.6.x：脏数据防御——mood 条目非对象（导入/损坏数据）时跳过，避免统计页中断
            if (!md || typeof md !== 'object') return;
            // v3.15.x：来源 chip 型 mood（tagNoDup）无正文 label，跳过避免统计出空名条目
            if (!md.label) return;
            if (md.tag === '交流意图') intent[md.label] = (intent[md.label] || 0) + 1;
            else if (md.tag === '心意') heart[md.label] = (heart[md.label] || 0) + 1;
            else emotion[md.label] = (emotion[md.label] || 0) + 1;
          });
        });
        exprEl.innerHTML =
          statsBarSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9.5l.01.01M15 9.5l.01.01"/></svg>', '情绪字卡', emotion, '常见情绪', '暂无使用记录') +
          statsBarSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S4.5 15.2 4.5 9.9A4.9 4.9 0 0112 7.1a4.9 4.9 0 017.5 2.8c0 5.3-7.5 10.6-7.5 10.6z"/><path d="M19 3.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/></svg>', '心意字卡', heart, '常传递心意', '暂无使用记录') +
          statsBarSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8.5 8.5 0 01-12.6 7.4L4 21l1.5-4.4A8.5 8.5 0 1121 12z"/><path d="M8.5 10h7M8.5 13h4.5"/></svg>', '交流意图', intent, '常用交流', '暂无使用记录');
      }
    }
    const daysEl = document.getElementById('st-days');
    if (daysEl) daysEl.textContent = days;
  }
  // 统计 tab 切换
  document.querySelectorAll('#page-stats .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#page-stats .fav-tab').forEach(x => x.classList.toggle('sel', x === tab));
      const k = tab.dataset.stab;
      document.querySelectorAll('#page-stats .cal-card').forEach(c => {
        c.hidden = c.dataset.stpanel !== k;
      });
      // v3.24.x：文字字卡 tab 每次进入时重算（字卡库/聊天可能刚变）
      if (k === 'cc') renderCcStats();
    });
  });
  // v3.24.x：「查看更多」→ 弹出 Top100 完整排名
  document.addEventListener('click', function (e) {
    const more = e.target.closest('[data-cc-more]');
    if (!more) return;
    const title = more.getAttribute('data-cc-more');
    const key = more.getAttribute('data-cc-key');
    if (!title || !key) return;
    const ccEl = document.getElementById('st-cc-content');
    if (!ccEl) return;
    const prop = key === 'mine' ? '__ccMine' : '__ccTa';
    const entries = ccEl[prop] || [];
    if (entries.length) {
      openCcTopModal(title, entries, '暂无使用记录');
    }
  });

  // ================= 提问记录页（原小互动页） =================
  const interactApp = document.querySelector('.app[data-app="interact"]');
  const interactPage = document.getElementById('page-interact');
  if (interactApp && interactPage) {
    interactApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      if (window.renderAskRecords) window.renderAskRecords();
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      interactPage.hidden = false;
    });
  }
  const interactBack = document.getElementById('interact-back');
  if (interactBack) {
    interactBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-phone');
      if (home) home.hidden = false;
    });
  }

// ================= 寻踪（TA 的日常）=================
const DEF_PLACES = ['在家', '在公司', '在咖啡店', '在公园', '在图书馆', '在路上', '在朋友家', '在健身房', '在超市', '在电影院', '在便利店', '在书店', '在地铁上', '在阳台', '在河边', '在小区楼下', '在面包店', '在车站', '在自习室'];
const DEF_ACTIONS = ['刷手机', '看书', '发呆', '听歌', '写东西', '吃零食', '喝奶茶', '散步', '玩游戏', '想你', '看电影', '追剧', '刷视频', '等快递', '收拾房间', '洗衣服', '做饭', '泡茶', '吃水果', '拍照'];
const DEF_CHECK_MSGS = ['想你了', '记得按时吃饭', '今天也很喜欢你', '早点休息', '有空给我回消息', '别太累', '喝水了吗', '今天开心吗', '我今天有点累', '我今天很开心', '我今天有点想你', '我今天有点无聊', '今天过得怎么样', '记得多穿点', '路上注意安全', '晚安'];
// 寻踪日常字卡（可自定义，localStorage 持久化；空则用默认）
// v3.6.x：是否使用系统预设字卡（默认开启；关闭后寻踪只从用户添加的字卡里抽）
const CK_DEF_KEY = 'checkin-cards-default';
function getCkDefault() {
  const v = store.get(CK_DEF_KEY);
  return v === null ? true : v === '1';
}
function ckList(k, def) {
  try {
    const v = JSON.parse(store.get('checkin-cards-' + k) || 'null');
    if (Array.isArray(v) && v.length) return v;
  } catch (e) {}
  return def.slice();
}
  function ckSaveList(k, list) { store.set('checkin-cards-' + k, JSON.stringify(list)); }
  // v3.6.x：纯自定义库读取（不 fallback 到默认）——批量添加/我的添加列表用这个，
  //   避免原 ckList() 在无自定义时返回默认库导致系统预设被"转正"存进自定义库
  function ckCustomList(k) {
    try {
      const v = JSON.parse(store.get('checkin-cards-' + k) || 'null');
      if (Array.isArray(v)) return v;
    } catch (e) {}
    return [];
  }
  // v3.7.x：寻踪字卡统一返回对象数组 [{t, grp}]（旧字符串数据自动转对象）——管理页/批量添加用
  function ckItems(k) {
    try {
      const v = JSON.parse(store.get('checkin-cards-' + k) || 'null');
      if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? { t: x } : (x && typeof x === 'object' && x.t != null ? x : null)).filter(Boolean);
    } catch (e) {}
    return [];
  }
  // v3.7.x：寻踪字卡保存（统一对象数组）
  function ckSaveItems(k, items) { store.set('checkin-cards-' + k, JSON.stringify(items)); }
  // v3.7.x：寻踪自定义分组（按 地点/在做什么/说的话 分类各自独立）——只用于管理页整理，抽取不分组
  function ckGroups(k) {
    try {
      const v = JSON.parse(store.get('checkin-cards-groups-' + k) || 'null');
      if (Array.isArray(v)) return v;
    } catch (e) {}
    return [];
  }
  function ckSaveGroups(k, groups) { store.set('checkin-cards-groups-' + k, JSON.stringify(groups)); }
// v3.6.x：寻踪系统预设字卡单卡开关——逐张开启/关闭（关闭后寻踪不再抽取该条）
function isCkCardOff(k, x) { return store.get('ck-off-' + k + ':' + x) === '1'; }
function setCkCardOff(k, x, off) { store.set('ck-off-' + k + ':' + x, off ? '1' : '0'); }
// v3.27.x #823：寻踪总开关（per-cid 键 checkin-en，从未写过＝默认开启）。关闭＝全静：
// 不自动生成日常、不往聊天推任何寻踪消息、不落新记录，桌面【寻踪】图标／聊天「更多功能」
// 寻踪／点 TA 头像的寻踪半框三个入口一并收起；已有日常与寻踪记录原样保留，重新开启即恢复。
// 与「寻踪日常发送到聊天」概率（dcf-checkin）是两层东西：概率调 0% 只停聊天推送，
// 寻踪页与记录照旧生成；本开关是连生成带入口一起停用。
const CK_EN_KEY = 'checkin-en';
function ckEn() {
  try {
    const v = store.get(CK_EN_KEY);
    return v === null ? true : v === '1';
  } catch (e) { return true; }
}
window.checkinEnabled = ckEn;
// personalize.js 的 applyHiddenIcons 会把「不在隐藏名单里的图标」display 复位成 ''，
// 它按这个口径判定寻踪图标是否该收起（否则用户从装修里恢复图标/切桌面就把入口放回来了）。
window.checkinDeskOff = function () { return !ckEn(); };
// #855：「使用系统预设」开启＝系统预设＋我的添加合并抽取（预设在前、按原文去重，同名自定义
// 不重复计概率）。原写法预设只在自定义库为空时兜底，用户加过一张自定义字卡后整库地点/动作/
// 话术预设全部退场＝各设备必现、与机型无关。单卡开关（ck-off-*）按原文记键，合并后照常生效。
function ckMergeDef(custom, def) {
  const seen = {};
  return def.map(function (t) { return { t: t }; }).concat(custom).filter(function (x) {
    if (x && x.t != null && !seen[x.t]) { seen[x.t] = 1; return true; }
    return false;
  });
}
function genCheckin() {
  const useDefault = getCkDefault();
  // v3.7.x：字卡可为 {t, grp} 对象——统一用 ckItems 取 .t
  let places = ckItems('place');
  let actions = ckItems('action');
  let msgs = ckItems('msg');
  // v3.7.x 修复：ckItems 只读自定义字卡（管理页要显示真实自定义，不 fallback），
  // 但 genCheckin 抽取时必须有字卡——自定义空时补系统预设（转 {t} 对象格式），
  // 否则 out.place/action/msg 全 undefined → 寻踪页空白/记录不显示/聊天不发消息
  if (!places.length) places = DEF_PLACES.map(t => ({ t }));
  if (!actions.length) actions = DEF_ACTIONS.map(t => ({ t }));
  if (!msgs.length) msgs = DEF_CHECK_MSGS.map(t => ({ t }));
  // #855：开关开启时合并系统预设（自定义空时上面已补预设，合并去重后不重复；关闭开关不走此支＝口径不变）
  if (useDefault) {
    places = ckMergeDef(places, DEF_PLACES);
    actions = ckMergeDef(actions, DEF_ACTIONS);
    msgs = ckMergeDef(msgs, DEF_CHECK_MSGS);
  }
  const out = {};
  // 关闭「使用系统预设」时：只从用户添加的字卡里抽；某分类没有用户自定义则跳过该字段
  // v3.6.x：单卡开关过滤——用户关闭的字卡（ck-off-*）不参与抽取
  let place = useDefault ? places.filter(p => !isCkCardOff('place', p.t)) : places.filter(p => DEF_PLACES.indexOf(p.t) < 0 && !isCkCardOff('place', p.t));
  let action = useDefault ? actions.filter(a => !isCkCardOff('action', a.t)) : actions.filter(a => DEF_ACTIONS.indexOf(a.t) < 0 && !isCkCardOff('action', a.t));
  let msg = useDefault ? msgs.filter(m => !isCkCardOff('msg', m.t)) : msgs.filter(m => DEF_CHECK_MSGS.indexOf(m.t) < 0 && !isCkCardOff('msg', m.t));
  // 兜底：关闭预设且完全没有用户自定义时回退使用系统预设（避免寻踪空白/undefined）
  if (!place.length && !action.length && !msg.length) {
    place = places; action = actions; msg = msgs;
  }
  if (place.length) out.place = place[Math.floor(Math.random() * place.length)].t;
  if (action.length) out.action = action[Math.floor(Math.random() * action.length)].t;
  if (msg.length) out.msg = msg[Math.floor(Math.random() * msg.length)].t;
  return out;
}
function renderCheckinHistory() {
  const histEl = document.getElementById('ck-history');
    if (!histEl) return;
    try {
      let h = [];
      try { h = JSON.parse(store.get('checkin-history') || '[]'); } catch (e) { h = []; }
      // 过滤无有效内容的记录（不渲染 "-- · -- · --" 占位），只显示实际存在的字段
      const valid = (Array.isArray(h) ? h : []).filter(x => x && (x.place || x.action));
      histEl.innerHTML = valid.length
        ? valid.slice().reverse().map(x => {
            const parts = [x.t, x.place, x.action].filter(Boolean);
            return '<div class="ck-location"><div class="ck-value" style="font-size:13px">' + parts.join(' · ') + '</div><div class="ck-label">' + (x.msg || '') + '</div></div>';
          }).join('')
        : '<div class="div-result-empty">暂无寻踪记录</div>';
    } catch (e) {}
  }
  // 初始化：从 IndexedDB 恢复全部寻踪记录
  (function () {
    if (window.idbGet) {
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':checkin-history').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (!v) return;
        try {
          const data = typeof v === 'string' ? JSON.parse(v) : v;
          if (Array.isArray(data) && data.length && !store.get('checkin-history')) {
            store.set('checkin-history', JSON.stringify(data));
          }
        } catch (e) {}
      });
    }
  })();
  const checkinApp = document.querySelector('.app[data-app="checkin"]');
  const checkinPage = document.getElementById('page-checkin');
  // ---- #823 总开关：入口显隐收口 + 两处开关 UI（设置→工具 / 字卡库→寻踪日常字卡页）----
  // 桌面图标走 display 收起（与 personalize.js applyHiddenIcons 同一条轴：那个函数会把
  // 「不在隐藏名单里」的图标 display 复位成 ''，故它内部按 window.checkinDeskOff() 一并判定；
  // 否则用户切桌面／装修里恢复图标／恢复隐藏图标弹窗一跑，入口就自己回来了）。
  function applyCkDeskIcon() {
    try {
      if (!checkinApp) return;
      // 与装修里「隐藏图标」名单取并集：只认总开关会在关闭再开启后，把用户原本手动隐藏的
      // 寻踪图标顺手放回桌面（hidden-icons 存的是 dataset.app 值 'checkin'）
      let man = false;
      try { man = (JSON.parse(store.get('hidden-icons') || '[]')).indexOf('checkin') >= 0; } catch (e) {}
      checkinApp.style.display = (ckEn() && !man) ? '' : 'none';
    } catch (e) {}
  }
  function syncCkSwitchUI() {
    const on = ckEn();
    const a = document.getElementById('sf-checkin-en');
    if (a && a.checked !== on) a.checked = on;
    const b = document.getElementById('ck-fe-en');
    if (b && b.checked !== on) b.checked = on;
    const sub = document.getElementById('sf-checkin-sub');
    if (sub) sub.textContent = on ? 'TA 的日常随机刷新，桌面/聊天里都能寻踪' : '已关闭：入口已收起、不再自动更新（已有记录保留，重新开启即恢复）';
  }
  function ckToast(on) {
    if (typeof window.toast !== 'function') return;
    window.toast(on ? '寻踪已开启：桌面与聊天入口恢复、日常继续更新' : '寻踪已关闭：入口全部收起、不再自动更新，已有记录保留');
  }
  window.setCheckinEnabled = function (on) {
    try { store.set(CK_EN_KEY, on ? '1' : '0'); } catch (e) {}
    syncCkSwitchUI();
    applyCkDeskIcon();
  };
  function bindCkSwitch(input) {
    input.checked = ckEn();
    input.addEventListener('change', function () {
      window.setCheckinEnabled(input.checked);
      ckToast(input.checked);
    });
  }
  // 设置 → 工具：开关行插在「占卜」入口行之前（样式复用 .set-row/.toggle，不改动 template.html；
  // 行名的「功能说明」胶囊与设置页搜索素材由 settings-help.js 按 #sf-checkin-row 登记注入）
  (function () {
    if (document.getElementById('sf-checkin-row')) return;
    const anchor = document.getElementById('row-open-divination');
    if (!anchor || !anchor.parentNode) return;
    const row = document.createElement('div');
    row.className = 'set-row';
    row.id = 'sf-checkin-row';
    row.innerHTML =
      '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v3.4l2.4 1.4"/></svg></div>' +
      '<div class="txt">寻踪（TA 的日常）<span class="sub" id="sf-checkin-sub"></span></div>' +
      '<label class="toggle"><input type="checkbox" id="sf-checkin-en"><span class="tk"></span></label>';
    anchor.parentNode.insertBefore(row, anchor);
    bindCkSwitch(row.querySelector('#sf-checkin-en'));
  })();
  // 字卡库 → 寻踪日常字卡页：概率框上方同一开关（同一个键 checkin-en，两处实时同步）——
  // 用户改寻踪内容时就想顺手关掉它，不必绕去设置页
  (function () {
    if (document.getElementById('ck-fe-en')) return;
    const box = document.getElementById('ck-prob-box');
    if (!box || !box.parentNode) return;
    const grp = document.createElement('div');
    grp.className = 'set-group glass';
    grp.setAttribute('style', 'margin:10px 12px 0');
    grp.innerHTML =
      '<div class="gs-row"><span>启用寻踪（TA 的日常）</span><label class="toggle"><input type="checkbox" id="ck-fe-en"><span class="tk"></span></label></div>' +
      '<div class="gs-sub">关闭后桌面【寻踪】图标、聊天「更多功能」里的寻踪、点 TA 头像的寻踪半框一并收起，日常也不再自动更新与推送（下面那个「发送到聊天」概率与已有寻踪记录都不受影响，重新开启即恢复）。设置 → 工具 里有同一个开关。</div>';
    box.parentNode.insertBefore(grp, box);
    bindCkSwitch(document.getElementById('ck-fe-en'));
  })();
  applyCkDeskIcon();
  syncCkSwitchUI();
  document.addEventListener('contact-switched', function () { applyCkDeskIcon(); syncCkSwitchUI(); });
  // checkin-en 是小键、正常同步写 localStorage；但存储被系统清理后该键可能只在 IndexedDB，
  // 回填完成前读到空＝按默认开启算，故回填后再重算一次（与 applyGroupChatMode 同口径）
  if (window.__mochiDataReady) { applyCkDeskIcon(); syncCkSwitchUI(); }
  else document.addEventListener('mochi-restore-done', function () { applyCkDeskIcon(); syncCkSwitchUI(); });
  document.addEventListener('decor-exited', applyCkDeskIcon);
  // ---- 星言顶部栏字卡/随机换头像同款刷新机制 ----
  // 上次/下次更新时间戳持久化：首次启动立即生成一条，之后每 1-8 小时更新一次；
  // 每 60 秒轮询检查，刷新页面周期不重置
  function ckLast() { const v = parseInt(store.get('checkin-last'), 10); return isNaN(v) ? 0 : v; }
  function ckNext() { const v = parseFloat(store.get('checkin-next')); return isNaN(v) ? 0 : v; }
  function renderCheckinUI(ck) {
    const place = document.getElementById('ck-place');
    const action = document.getElementById('ck-action');
    const msg = document.getElementById('ck-msg');
    const status = document.getElementById('ck-status');
    const name = store.get('lbl-partner') || 'TA';
    // v3.6.x：关闭系统预设且某分类无自定义字卡时该字段为空——显示空串而非字面量 "undefined"
    if (place) place.textContent = ck.place || '';
    if (action) action.textContent = ck.action || '';
    if (msg) msg.textContent = ck.msg || '';
    if (status) status.textContent = name + ' 的日常';
  }
  function recordCheckin(ck) {
    // v3.6.x：undefined 字段不写入记录（JSON.stringify 自动丢弃 undefined 键）
    const entry = { t: fmtTime(Date.now()), place: ck.place, action: ck.action, msg: ck.msg, ts: Date.now() };
    try {
      const h = JSON.parse(store.get('checkin-history') || '[]');
      h.push(entry);
      store.set('checkin-history', JSON.stringify(h));
      if (window.idbSet) window.idbSet(window.activePrefix() + ':checkin-history', JSON.stringify(h));
    } catch (e) {}
    renderCheckinHistory();
  }
  // 生成新日常：渲染 + 推聊天消息（更新提示 + 概率提醒）+ 记录 + 重置计时
  function doCheckin() {
    // #823 总开关关闭＝整条链一步都不做：不生成、不推聊天、不落记录、不重置计时
    //（唯一收口点——手动刷新 / 半框 / 寻踪页 / 自动轮询全部经由本函数）
    if (!ckEn()) return; // #823a 关闭即全静默：生成/推送/记录/重置计时一并停
    const ck = genCheckin();
    store.set('checkin-current', JSON.stringify(ck));
    renderCheckinUI(ck);
    const name = store.get('lbl-partner') || 'TA';
    // v3.42.x #422：寻踪「日常」是否推到聊天统一走「其他互动功能字卡」里的寻踪日常概率
    // （dcf-checkin，默认 100%＝每次都推，0%＝彻底不进聊天；随联系人桌面隔离）。关闭后
    // 寻踪页与记录照常生成，只是不再在聊天里推「更新了一条日常 / 日常内容 / 提醒你来寻踪」
    // 三条消息。原 #421 的 reply-ck-chat-en 开关已并入此行，见 WORKLOG。
    let ckChatOn = true;
    try { ckChatOn = Math.random() * 100 < (window.dcfGet ? window.dcfGet('checkin') : 100); } catch (e) {}
    if (ckChatOn) {
      // 更新提示系统消息：先发「联系人 更新了一条日常」（v3.7.x 调整顺序——
      // 原先是字卡文字消息先发、系统提示后发，与用户预期相反）
      if (window.chatAddSystem) {
        window.chatAddSystem(name + ' 更新了一条日常');
      }
      // 再发日常更新内容消息（普通气泡消息，持久化）
      // v3.6.x：只拼接存在的字段，避免 "在咖啡店 · undefined" 写进聊天记录
      if (window.chatAddIn) {
        const line = [ck.place, ck.action, ck.msg].filter(Boolean).join(' · ');
        if (line) window.chatAddIn(line);
      }
      // 概率触发「提醒你来寻踪」
      if (Math.random() * 100 < 30) {
        window.chatAddIn(name + ' 提醒你来寻踪.查岗');
      }
    }
    recordCheckin(ck);
    store.set('checkin-last', String(Date.now()));
    store.set('checkin-next', String(1 + Math.random() * 7));
    // 同步聊天里打开的寻踪半框
    const p = document.getElementById('ck-p-place');
    const a = document.getElementById('ck-p-action');
    const m = document.getElementById('ck-p-msg');
    if (p) p.textContent = ck.place || '';
    if (a) a.textContent = ck.action || '';
    if (m) m.textContent = ck.msg || '';
  }
  // 供聊天页「点联系人头像打开寻踪半框」使用
  window.openCkPanel = function () {
    if (!ckEn()) return; // #823b 关闭后点顶部 TA 头像不再弹寻踪半框（toggleCkPanel 同源）
    // 关闭其他底部半框（拍一拍/表情包/头像互动）
    const pc = document.getElementById('poke-card');
    if (pc) pc.hidden = true;
    const ep = document.getElementById('emoji-panel');
    if (ep) ep.hidden = true;
    if (window.closeAvlib) window.closeAvlib();
    const panel = document.getElementById('ck-panel');
    const nameEl = document.getElementById('ck-panel-name');
    const name = store.get('lbl-partner') || 'TA';
    if (nameEl) nameEl.textContent = name;
    // 显示当前日常；从未生成过则立即生成一条
    let cur = null;
    try { cur = JSON.parse(store.get('checkin-current') || 'null'); } catch (e) {}
    if (cur && cur.place) {
      const p = document.getElementById('ck-p-place');
      const a = document.getElementById('ck-p-action');
      const m = document.getElementById('ck-p-msg');
      if (p) p.textContent = cur.place || '';
      if (a) a.textContent = cur.action || '';
      if (m) m.textContent = cur.msg || '';
    } else {
      doCheckin();
    }
    // 更新时间：日常更新时记录的时间戳
    const upd = document.getElementById('ck-p-updated');
    if (upd) {
      const last = parseInt(store.get('checkin-last'), 10);
      upd.textContent = last ? '更新于 ' + fmtTime(last) : '';
    }
    if (panel) panel.hidden = false;
  };
  // FIX 2026-09-15 #529 寻踪半框（点聊天顶部头像打开）加「关闭/开关 + 点外关闭」——
  // 用户报「再次点顶部栏头像或点击屏幕其他地方，无法关闭」。根因两条、与机型无关：
  //   ① #ck-panel 自建立起就没有 document 层点外关闭（拍一拍 #poke-card / 表情包 #emoji-panel /
  //      更多功能 #chat-more-panel / 消息菜单 #msg-actions 都各有各的 document 关闭器），
  //      「点屏幕其他地方」根本没有关闭路径；
  //   ② 头像入口 chat.js 恒调 openCkPanel()，而此函数恒 `panel.hidden = false`，
  //      再次点顶部头像＝又开一次，面板纹丝不动。
  // 修复＝补 closeCkPanel/toggleCkPanel（开关）+ 与兄弟面板同款的 document 点外关闭；
  // chat.js 头像入口改走 toggleCkPanel。头像自身 stopPropagation，点外关闭器收不到它。
  function closeCkPanel() {
    const p = document.getElementById('ck-panel');
    if (p) p.hidden = true;
  }
  window.closeCkPanel = closeCkPanel;
  window.toggleCkPanel = function () {
    const p = document.getElementById('ck-panel');
    if (!p) return;
    if (!p.hidden) { closeCkPanel(); return; }
    window.openCkPanel();
  };
  document.addEventListener('click', (e) => {
    const p = document.getElementById('ck-panel');
    if (!p || p.hidden) return;
    if (p.contains(e.target)) return; // 面板内部点击不关闭（含 ✕ / 「TA在身边」入口）
    // 打开它的入口（聊天顶部头像）不当作「面板外」——头像自身已 stopPropagation，
    // 此处再兜一层，防将来某条路径漏 stop 变成「刚开即关」
    const av = document.getElementById('chat-partner-av');
    if (av && (e.target === av || av.contains(e.target))) return;
    closeCkPanel();
  });
  const ckPanelClose = document.getElementById('ck-panel-close');
  if (ckPanelClose) ckPanelClose.addEventListener('click', () => { closeCkPanel(); });
  // 自动轮询：启动立即 + 每 60 秒检查（首次 last=0 立即生成）
  // v3.5.118：首次检查延迟到 IndexedDB 回填完成后（mochi-restore-done）——
  // 否则启动瞬间 doCheckin→chatAddIn 会在聊天记录权威数据（导入后只在 IDB）
  // 读回前写入新消息，触发 saveMsgs 用 1 条覆盖 IDB 里的全部历史（导入后聊天记录丢失）
  let ckBootDone = false;
  // v3.5.128：回前台冷静期——后台切回时多个模块（发动态/来电/来信/询问/寻踪）
  // 会同时判定，错峰 90 秒避免连环弹窗+连发消息
  let ckWakeAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ckWakeAt = Date.now() + 90000;
  });
  function checkAutoCheckin() {
    if (document.hidden) return; // v3.5.127：后台不自动寻踪
    if (Date.now() < ckWakeAt) return; // 回前台冷静期
    if (!ckBootDone) return; // 首次：等数据就绪标志
    try {
      const now = Date.now();
      let last = ckLast(), next = ckNext();
      if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
      if ((now - last) / 36e5 < next) return;
      doCheckin();
    } catch (e) {}
  }
  setInterval(function () { try { if (window.__mochiPhase) window.__mochiPhase('fish-tick'); } catch (e0) {} checkAutoCheckin(); }, 60000);
  function bootCheckin() {
    // v3.5.129：数据未就绪不启动——3s 兜底在慢设备（分批恢复 >3s）上会
    // 绕过门控提前生成日常，导致导入后首启多出一条"日常更新"且寻踪节奏被重置
    if (!window.__mochiDataReady) { setTimeout(bootCheckin, 500); return; }
    ckBootDone = true;
    checkAutoCheckin();
  }
  // 数据就绪（IDB 回填完成）后启动；无事件兜底 3 秒（空数据场景 idbRestore 也会派发）
  document.addEventListener('mochi-restore-done', bootCheckin);
  setTimeout(bootCheckin, 3000);
  // 全屏打开寻踪页：渲染当前日常（或生成一条）+ 记录；供桌面/聊天「更多功能」共用
  window.openCheckinPage = function () {
    if (!checkinPage) return;
    if (!ckEn()) { // #823c 关闭后寻踪页不再打开（桌面图标/更多功能入口已收起，剩功能大全这类程序化跳转）
      if (typeof window.toast === 'function') window.toast('寻踪已关闭：设置 → 工具 → 寻踪 可重新开启');
      return;
    }
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    checkinPage.hidden = false;
    // 显示当前日常；从未生成过则立即生成一条
    let cur = null;
    try { cur = JSON.parse(store.get('checkin-current') || 'null'); } catch (e) {}
    if (cur && cur.place) renderCheckinUI(cur);
    else doCheckin();
    renderCheckinHistory();
  };
  if (checkinApp && checkinPage) {
    checkinApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      // 桌面进入：返回时回桌面（避免残留聊天来源）
      window.__ckFrom = '';
      window.openCheckinPage();
    });
  }
  const checkinBack = document.getElementById('checkin-back');
  if (checkinBack) {
    checkinBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      // 聊天「更多功能」进入则返回聊天，否则返回桌面
      if (window.__ckFrom === 'chat') {
        const chatPage = document.getElementById('page-chat');
        if (chatPage) chatPage.hidden = false;
      } else {
        const home = document.getElementById('page-phone');
        if (home) home.hidden = false;
      }
      window.__ckFrom = '';
    });
  }
const ckRefresh = document.getElementById('ck-refresh');
if (ckRefresh) {
  // v3.5.132：5 秒最小间隔——连点会在聊天里刷出多条"更新日常"消息
  let ckLastRefresh = 0;
  ckRefresh.addEventListener('click', () => {
    const now = Date.now();
    if (now - ckLastRefresh < 5000) { toast('刷新太频繁，稍后再试'); return; }
    ckLastRefresh = now;
    doCheckin();
  });
}

  // ================= 寻踪日常字卡（管理页 + 字卡库入口） =================
  const CK_DEFS = [
    ['place', DEF_PLACES],
    ['action', DEF_ACTIONS],
    ['msg', DEF_CHECK_MSGS]
  ];
  const CK_LABEL = { place: '地点', action: '在做什么', msg: '说的话' };
  // v3.15.x：存量清洗——更早版本的管理页在删除/编辑时会把「默认地点/在做什么/说的话」
  // 整库回写进自定义键（ckList 空 fallback 的"转正"问题，v3.6.x 已堵住新产生但没清存量），
  // 导致【查岗日常·我的添加】里错误显示系统预设字卡、库入口计数虚高。
  // 按文本匹配一次性剔除（幂等标记防重跑；ckSaveItems→store.set 三写
  // memoryCache/LS/IDB，idbRestore 的 memoryCache 守卫保证回填不会复活已清洗的旧值）。
  // 按桌面各清一次（标记存联系人命名空间）；与全站「按文本认预设」的模型一致。
  (function cleanLegacyPresetInCk() {
    try {
      const MK = 'ck-mine-clean-v1';
      if (store.get(MK) === '1') return;
      const defMap = { place: DEF_PLACES, action: DEF_ACTIONS, msg: DEF_CHECK_MSGS };
      Object.keys(defMap).forEach(k => {
        let raw = null;
        try { raw = JSON.parse(store.get('checkin-cards-' + k) || 'null'); } catch (e) { raw = null; }
        if (!Array.isArray(raw)) return;
        const cleaned = raw.filter(x => {
          const t = x && typeof x === 'object' ? x.t : x;
          return !(t != null && defMap[k].indexOf(String(t)) >= 0);
        });
        if (cleaned.length !== raw.length) ckSaveItems(k, cleaned);
      });
      store.set(MK, '1');
    } catch (e) {}
  })();
  let ckTab = 'place';
  // v3.6.x：是否有用户自定义的寻踪列表（有则默认项按内容匹配标【系统】；无则整库为系统预设）
  function ckHasCustom(k) {
    try {
      const v = JSON.parse(store.get('checkin-cards-' + k) || 'null');
      return Array.isArray(v) && v.length > 0;
    } catch (e) { return false; }
  }
  let ckTab2 = 'sys';
  function escCk(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function renderCkSysList() {
    const listEl = document.getElementById('cck-sys-list');
    const titleEl = document.getElementById('cck-sys-title');
    if (titleEl) titleEl.textContent = CK_LABEL[ckTab] || '';
    if (!listEl) return;
    const useDefault = getCkDefault();
    const def = { place: DEF_PLACES, action: DEF_ACTIONS, msg: DEF_CHECK_MSGS }[ckTab];
    listEl.innerHTML = '';
    if (!useDefault) {
      const tip = document.createElement('div');
      tip.className = 'ta-empty';
      tip.textContent = '系统预设字卡已关闭（寻踪只从「我的添加」里抽取）。开启上方开关即可恢复使用。';
      listEl.appendChild(tip);
      return;
    }
    def.forEach(x => {
      const off = isCkCardOff(ckTab, x);
      const row = document.createElement('div');
      row.className = 'tc-qrow' + (off ? ' off' : '');
      row.innerHTML = '<div class="tc-qmain"><div class="tc-qtext">' + escCk(x) + ' <span class="tc-known">系统</span></div></div>';
      const lab = document.createElement('label');
      lab.className = 'toggle ccard-toggle';
      lab.innerHTML = '<input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span>';
      lab.querySelector('input').addEventListener('change', () => {
        const nowOff = !lab.querySelector('input').checked;
        setCkCardOff(ckTab, x, nowOff);
        renderCkSysList();
        updateCkCount();
        toast((nowOff ? '已关闭：' : '已开启：') + (x.length > 18 ? x.slice(0, 18) + '…' : x));
      });
      row.appendChild(lab);
      listEl.appendChild(row);
    });
  }
  function renderCkMineList() {
    const listEl = document.getElementById('cck-mine-list');
    const titleEl = document.getElementById('cck-mine-title');
    if (titleEl) titleEl.textContent = CK_LABEL[ckTab] || '';
    if (!listEl) return;
    const custom = ckItems(ckTab);
    const groups = ckGroups(ckTab);
    let html = '';
    html += '<div class="mg-grp-row"><button class="cc-tool mg-grp-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>新建分组</button></div>';
    if (!custom.length && !groups.length) {
      listEl.innerHTML = html + '<div class="ta-empty">暂未添加自定义字卡，可在上方批量输入（每行一个）。</div>';
      bindCkGroupOps();
      return;
    }
    // 自定义分组区块（置顶，与系统预设隔开）
    groups.forEach(g => {
      const arr = custom.filter(x => x.grp === g.id);
      html += '<div class="cal-card glass mg-block" data-gid="' + escCk(g.id) + '">' +
        '<div class="cal-card-title mg-title"><button class="mg-handle" data-gid="' + escCk(g.id) + '" title="拖动排序"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button>' +
        '<span class="mg-name">' + escCk(g.name) + '</span><span class="mg-cnt">(' + arr.length + ')</span>' +
        '<span class="mg-ops"><button class="mg-op" data-g="' + escCk(g.id) + '" data-op="rn" title="重命名">✎</button><button class="mg-op" data-g="' + escCk(g.id) + '" data-op="rm" title="删除分组">✕</button></span></div>' +
        (arr.length ? arr.map(x => ckMineItemHtml(x, custom.indexOf(x))).join('') : '<div class="ta-empty">这个分组还没有内容</div>') +
        '</div>';
    });
    const ungrouped = custom.filter(x => !x.grp);
    html += '<div class="cal-card glass mg-block mg-ungrouped"><div class="cal-card-title mg-title"><span class="mg-name">未分组</span><span class="mg-cnt">(' + ungrouped.length + ')</span></div>';
    if (!ungrouped.length) html += '<div class="ta-empty">暂无未分组字卡，可在上方批量输入</div>';
    html += ungrouped.map(x => ckMineItemHtml(x, custom.indexOf(x))).join('');
    html += '</div>';
    listEl.innerHTML = html;
    listEl.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const l = ckItems(ckTab);
        l.splice(Number(b.dataset.idx), 1);
        ckSaveItems(ckTab, l);
        renderCkMineList();
        updateCkCount();
        toast('已删除');
      });
    });
    // v3.7.x：点击字卡内容编辑
    listEl.querySelectorAll('.tc-qtext[data-edit]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.edit);
        const l = ckItems(ckTab);
        const item = l[idx];
        if (!item || !window.openModal) return;
        window.openModal('编辑字卡', item.t, (v) => {
          const val = String(v == null ? '' : v).trim();
          if (!val) { toast('内容不能为空'); return; }
          if (val === item.t) return;
          if (l.some((x, xi) => xi !== idx && x.t === val)) { toast('已有相同内容'); return; }
          l[idx].t = val;
          ckSaveItems(ckTab, l);
          renderCkMineList();
          toast('已更新');
        });
      });
    });
    // v3.7.x：移动字卡到其他分组
    listEl.querySelectorAll('.ta-mv').forEach(b => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.idx);
        const l = ckItems(ckTab);
        const item = l[idx];
        if (!item || !window.openModal) return;
        const groups = ckGroups(ckTab);
        const opts = [{ label: '未分组', value: '' }].concat(groups.map(g => ({ label: g.name, value: g.id })));
        window.openModal('移动到分组', '', (v) => {
          if (v == null) return;
          l[idx].grp = v || '';
          ckSaveItems(ckTab, l);
          renderCkMineList();
          const tgt = v ? (groups.find(g => g.id === v) || {}).name : '未分组';
          toast('已移动到「' + tgt + '」');
        }, { pills: opts, pill: item.grp || '', noInput: true });
      });
    });
    bindCkGroupOps();
  }
  function ckMineItemHtml(x, idx) {
    return '<div class="tc-qrow"><div class="tc-qmain"><div class="tc-qtext" data-edit="' + idx + '">' + escCk(x.t) + '</div></div>' +
      '<button class="ta-mv" data-idx="' + idx + '" title="移动分组"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M3 7h13a4 4 0 014 4v0a4 4 0 01-4 4H7"/><path d="M7 11l-4 4 4 4"/></svg></button>' +
      '<button class="ta-del" data-idx="' + idx + '">✕</button></div>';
  }
  // 寻踪 分组管理事件（新建 / 重命名 / 删除，按当前分类独立）
  function bindCkGroupOps() {
    const wrap = document.getElementById('cck-mine-list');
    if (!wrap) return;
    wrap.querySelectorAll('.mg-grp-add').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('click', () => {
        const groups = ckGroups(ckTab);
        window.cardGroups.addFlow(groups, g => {
          if (!g) return;
          ckSaveGroups(ckTab, groups);
          refreshCkGrpSelect();
          renderCkMineList();
          toast('已新建分组「' + g.name + '」');
        });
      });
    });
    wrap.querySelectorAll('.mg-op').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('click', () => {
        const groups = ckGroups(ckTab);
        const gid = b.dataset.g;
        const g = groups.find(x => x.id === gid);
        if (!g) return;
        if (b.dataset.op === 'rn') {
          window.cardGroups.renameFlow(g, groups, name => {
            if (!name) return;
            ckSaveGroups(ckTab, groups);
            refreshCkGrpSelect();
            renderCkMineList();
            toast('分组已重命名');
          });
        } else if (b.dataset.op === 'rm') {
          window.cardGroups.removeFlow(g.name, ok => {
            if (!ok) return;
            const l = ckItems(ckTab);
            l.forEach(x => { if (x.grp === gid) x.grp = ''; });
            ckSaveItems(ckTab, l);
            ckSaveGroups(ckTab, groups.filter(x => x.id !== gid));
            refreshCkGrpSelect();
            renderCkMineList();
            toast('已删除分组「' + g.name + '」');
          });
        }
      });
    });
    // v3.7.x：分组拖动排序（手柄 ≡ 触发，克隆标题行跟随手指 + 蓝色指示线）
    wrap.querySelectorAll('.mg-handle').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const gid = b.dataset.gid;
        const blocks0 = Array.from(wrap.querySelectorAll('.mg-block:not(.mg-ungrouped)'));
        const block = blocks0.find(bl => bl.dataset.gid === gid);
        if (!block) return;
        const title = block.querySelector('.mg-title');
        const rect = title.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const clone = title.cloneNode(true);
        clone.classList.add('mg-drag-clone');
        clone.style.position = 'fixed';
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.margin = '0';
        clone.style.zIndex = '1000';
        clone.style.pointerEvents = 'none';
        document.body.appendChild(clone);
        block.classList.add('mg-dragging');
        let dropIdx = blocks0.indexOf(block);
        const onMove = (ev) => {
          ev.preventDefault();
          clone.style.top = (ev.clientY - offsetY) + 'px';
          const blocks2 = Array.from(wrap.querySelectorAll('.mg-block:not(.mg-ungrouped)'));
          dropIdx = blocks2.length;
          for (let i = 0; i < blocks2.length; i++) {
            if (blocks2[i] === block) continue;
            const r = blocks2[i].getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) { dropIdx = i; break; }
          }
          wrap.querySelectorAll('.mg-drop-line').forEach(el => el.remove());
          const line = document.createElement('div');
          line.className = 'mg-drop-line';
          if (dropIdx >= blocks2.length) {
            const last = blocks2[blocks2.length - 1];
            if (last && last.nextSibling) wrap.insertBefore(line, last.nextSibling);
            else wrap.appendChild(line);
          } else {
            wrap.insertBefore(line, blocks2[dropIdx]);
          }
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          clone.remove();
          block.classList.remove('mg-dragging');
          wrap.querySelectorAll('.mg-drop-line').forEach(el => el.remove());
          const blocks2 = Array.from(wrap.querySelectorAll('.mg-block:not(.mg-ungrouped)'));
          const curIdx = blocks2.findIndex(bl => bl.dataset.gid === gid);
          if (curIdx < 0 || dropIdx === curIdx || dropIdx === curIdx + 1) return;
          const groups = ckGroups(ckTab);
          let target = dropIdx < curIdx ? dropIdx : dropIdx - 1;
          if (target < 0) target = 0;
          if (target > groups.length - 1) target = groups.length - 1;
          if (target === curIdx) return;
          const [moved] = groups.splice(curIdx, 1);
          groups.splice(target, 0, moved);
          ckSaveGroups(ckTab, groups);
          renderCkMineList();
          toast('分组已移动');
        };
        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        e.preventDefault();
      });
    });
  }
  // 刷新批量输入的分组下拉（按当前分类）
  function refreshCkGrpSelect() {
    const grpSel = document.getElementById('cck-batch-grp');
    if (!grpSel) return;
    const groups = ckGroups(ckTab);
    grpSel.innerHTML = window.cardGroups.grpOnlyOptsHtml(groups, grpSel.value);
    window.cardGroups.bindNewGrp(grpSel, groups, function () { ckSaveGroups(ckTab, groups); });
  }
  function updateCkCount() {
    const useDefault = getCkDefault();
    let sysTotal = 0, mineTotal = 0;
    CK_DEFS.forEach(([k, def]) => {
      mineTotal += ckCustomList(k).length;
      if (useDefault) sysTotal += def.filter(x => !isCkCardOff(k, x)).length;
    });
    const cnt = document.getElementById('cc-checkin-count');
    if (cnt) cnt.textContent = sysTotal;
    const cntM = document.getElementById('cc-checkin-count-mine');
    if (cntM) cntM.textContent = mineTotal;
  }
  // v3.34.x：暴露给字卡库「自定义字卡·全量导入」刷新列表页角标（我的添加计数）
  window.ckCardsRefreshCounts = updateCkCount;
  function switchCkTab2(tab) {
    ckTab2 = tab;
    const tabsWrap = document.getElementById('ck-tabs');
    if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
    const sysPanel = document.getElementById('ck-sys-panel');
    const minePanel = document.getElementById('ck-mine-panel');
    if (sysPanel) sysPanel.hidden = tab !== 'sys';
    if (minePanel) minePanel.hidden = tab !== 'mine';
    if (tab === 'sys') renderCkSysList(); else renderCkMineList();
  }
  function renderCheckinCards() {
    // 顶部分类 tab
    document.querySelectorAll('#page-checkin-cards .fav-tab').forEach(tab => {
      tab.classList.toggle('sel', tab.dataset.cktab === ckTab);
    });
    const useDefault = getCkDefault();
    const defEl = document.getElementById('ck-default');
    if (defEl) defEl.checked = useDefault;
    refreshCkGrpSelect(); // v3.7.x：切换分类时刷新该分类的分组下拉
    switchCkTab2(ckTab2);
    updateCkCount();
  }
  // v3.6.x：使用系统预设字卡开关（默认开启；关闭后寻踪只从用户添加的字卡里抽）
  const ckDefaultEl = document.getElementById('ck-default');
  if (ckDefaultEl) {
    ckDefaultEl.addEventListener('change', () => {
      store.set(CK_DEF_KEY, ckDefaultEl.checked ? '1' : '0');
      renderCheckinCards();
      toast(ckDefaultEl.checked ? '系统预设字卡已开启' : '系统预设字卡已关闭（仅用你添加的字卡）');
    });
  }
  // 分类 tab 切换
  document.querySelectorAll('#page-checkin-cards .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      ckTab = tab.dataset.cktab;
      renderCheckinCards();
    });
  });
  // 系统预设/我的添加 双 tab 切换
  const ckTabsWrap = document.getElementById('ck-tabs');
  if (ckTabsWrap) {
    ckTabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
      tab.addEventListener('click', () => { ckTab2 = tab.dataset.tab; switchCkTab2(ckTab2); });
    });
  }
  // 批量输入：每行一个，添加到当前分类（只追加到用户自定义库，不污染系统预设；v3.7.x 可选归入自定义分组）
  const batchAdd = document.getElementById('cck-batch-add');
  if (batchAdd) {
    refreshCkGrpSelect();
    batchAdd.addEventListener('click', () => {
      const ta = document.getElementById('cck-batch');
      const raw = ta ? ta.value : '';
      const items = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (!items.length) { toast('请输入内容，每行一个'); return; }
      const grpSel = document.getElementById('cck-batch-grp');
      const parsed = window.cardGroups.parseCatVal(grpSel ? grpSel.value : '');
      if (!parsed) { toast('请先选择分组'); return; }
      const list = ckItems(ckTab);
      items.forEach(it => {
        const x = { t: it };
        if (parsed.grp) x.grp = parsed.grp;
        list.push(x);
      });
      ckSaveItems(ckTab, list);
      if (ta) ta.value = '';
      renderCkMineList();
      updateCkCount();
      toast('已添加 ' + items.length + ' 条到「' + (CK_LABEL[ckTab] || ckTab) + '」');
    });
  }
  // v3.7.x：「＋分组」按钮（批量输入卡片标题行）
  const ckNewGrp = document.getElementById('ck-new-grp');
  if (ckNewGrp) {
    ckNewGrp.addEventListener('click', () => {
      const groups = ckGroups(ckTab);
      window.cardGroups.addFlow(groups, g => {
        if (!g) return;
        ckSaveGroups(ckTab, groups);
        refreshCkGrpSelect();
        if (ckTab2 === 'mine') renderCkMineList();
        toast('已新建分组「' + g.name + '」');
      });
    });
  }
  // 入口：字卡库「寻踪日常字卡」→ 管理页
  const liCK = document.getElementById('li-checkin-cards');
  const ckCardsPage = document.getElementById('page-checkin-cards');
  if (liCK && ckCardsPage) {
    liCK.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      ckCardsPage.hidden = false;
      ckTab2 = 'sys';
      const tw = document.getElementById('ck-tabs'); if (tw) tw.style.display = 'none';
      renderCheckinCards();
    });
  }
  // v3.9.x：「寻踪日常·我的添加」入口——只看自定义
  const liCKMine = document.getElementById('li-checkin-cards-mine');
  if (liCKMine && ckCardsPage) {
    liCKMine.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      ckCardsPage.hidden = false;
      ckTab2 = 'mine';
      const tw = document.getElementById('ck-tabs'); if (tw) tw.style.display = 'none';
      renderCheckinCards();
    });
  }
  const ckCardsBack = document.getElementById('checkin-cards-back');
  if (ckCardsBack) {
    ckCardsBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  renderCheckinCards();
  // v3.9.x：注册寻踪日常字卡跨分类搜索
  window.__cardSearchFns = window.__cardSearchFns || [];
  window.__cardSearchFns.push({ name: '寻踪日常字卡', fn: function (kw) {
    const out = [];
    try {
      CK_DEFS.forEach(function (pair) {
        const k = pair[0]; const def = pair[1]; const label = CK_LABEL[k] || k;
        (def || []).forEach(function (x) { if (x && String(x).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(x), cat: label + '·系统' }); });
        (ckCustomList(k) || []).forEach(function (item) { const txt = item && item.t ? item.t : ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: label + '·我的' }); });
      });
    } catch (e) {}
    return out;
  } });

  // ================= 桌面第二页补充：今日备忘 / 今天的心情 / 本周日常 =================
  // 备忘/心情保存时写入历史（主页展示全部记录）
  // v3.7.x：备忘/心情按「天」显示——读当日快照（memo-YYYY-MM-DD / today-mood-YYYY-MM-DD），
  // 当天没写过就显示占位，第二天自动重新开始（前一天内容留在历史里，可点本周日常查看）。
  // 兼容：老版本只存固定键 memo/today-mood，无当日快照时视为「今天还没写」，不再把旧内容
  // 一直挂在桌面上（这正是"备忘/心情不每天刷新"的根因）。
  function todayMemoText() { return store.get('memo-' + dayStr(new Date())) || legacyToday('memo', 'memo-history'); }
  function todayMoodText() { return store.get('today-mood-' + dayStr(new Date())) || legacyToday('today-mood', 'mood-history'); }
  // v3.7.x 兼容升级：老版本把备忘/心情存在固定键（无日期）。当天历史第一条记录是今天写的
  // → 把固定键内容迁移成今日快照（老内容留在桌面、不丢），否则视为「今天还没写」。
  // 只迁移一次（迁移后已有快照，直接返回），无副作用。
  function legacyToday(curKey, histKey) {
    try {
      const list = JSON.parse(store.get(histKey) || '[]');
      if (list.length && list[0].ts &&
          new Date(list[0].ts).toDateString() === new Date().toDateString()) {
        const legacy = store.get(curKey);
        if (legacy) {
          const ds = dayStr(new Date());
          store.set(curKey + '-' + ds, legacy);
          try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + curKey + '-' + ds, legacy); } catch (e) {}
          return legacy;
        }
      }
    } catch (e) {}
    return '';
  }
  const memoEl = document.getElementById('memo-text');
  if (memoEl) {
    memoEl.textContent = todayMemoText() || '点这里记一句话';
    memoEl.addEventListener('click', () => {
      if (window.openModal) {
        window.openModal('今日备忘', memoEl.textContent === '点这里记一句话' ? '' : memoEl.textContent, (v) => {
          const val = (v || '').trim();
          if (val) {
            memoEl.textContent = val; store.set('memo', val); pushHist('memo-history', val);
            try { if (window.idbSet) window.idbSet(window.activePrefix() + ':memo', val); } catch (e) {}
            // v3.7.x：补写按日期快照，供本周日常点击其他日期查看当日备忘（桌面显示也读它）
            const ds = dayStr(new Date());
            store.set('memo-' + ds, val);
            try { if (window.idbSet) window.idbSet(window.activePrefix() + ':memo-' + ds, val); } catch (e) {}
          }
        });
      }
    });
  }
  const moodEl = document.getElementById('today-mood-text');
  if (moodEl) {
    moodEl.textContent = todayMoodText() || '点一下选心情';
    moodEl.addEventListener('click', () => {
      if (window.openModal) {
        const moods = ['开心', '平静', '想你', '忙碌', '困', '充实', '温柔'];
        window.openModal('今天的心情', '', (v) => {
          const val = (v || '').trim();
          if (val) {
            moodEl.textContent = val; store.set('today-mood', val); pushHist('mood-history', val);
            try { if (window.idbSet) window.idbSet(window.activePrefix() + ':today-mood', val); } catch (e) {}
            // v3.7.x：补写按日期快照，供本周日常点击其他日期查看当日心情（桌面显示也读它）
            const ds = dayStr(new Date());
            store.set('today-mood-' + ds, val);
            try { if (window.idbSet) window.idbSet(window.activePrefix() + ':today-mood-' + ds, val); } catch (e) {}
          }
        }, { pills: moods.map(m => ({ label: m, value: m })), pill: todayMoodText() || '' });
      }
    });
  }
  const weekEl = document.getElementById('week-days');
  if (weekEl) {
    // v3.5.37：统一布局——第一行周（日一二三四五六，今天显示「今」），第二行本周对应日期数字
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    const now = new Date();
    const todayIdx = now.getDay();
    // 本周起始 = 本周日（getDay() 0 即周日，周一~周六往前推）
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - todayIdx);
    weekEl.innerHTML = names.map((n, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const ds = dayStr(d);
      return '<div class="week-day' + (i === todayIdx ? ' today' : '') + '" data-date="' + ds + '"' + (i === todayIdx ? '' : ' role="button"') + '><b>' + (i === todayIdx ? '今' : n) + '</b>' + d.getDate() + '</div>';
    }).join('');
    // v3.7.x：点击其他日期查看当日备忘与我们的心情（今天保持原状，数据已在桌面展示；
    // TA 的当日内容/留言归日历页查看，本周日常只保留属于我们自己的备忘与心情）
    weekEl.addEventListener('click', (ev) => {
      const cell = ev.target.closest('.week-day');
      if (!cell || cell.classList.contains('today')) return;
      // 装修模式下不触发查看（避免与卡片拖拽/编辑冲突）
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      const ds = cell.getAttribute('data-date');
      if (!ds || !window.openModal) return;
      const parts = ds.split('-');
      const dd = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      const wdNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const dateLabel = (+parts[1]) + ' 月 ' + (+parts[2]) + ' 日（' + wdNames[dd.getDay()] + '）';
      // v3.7.x bugfix：未来日期不生成不读取内容，只显示空态提示，避免"超前显示"
      const n2 = new Date();
      const isFuture = dd > new Date(n2.getFullYear(), n2.getMonth(), n2.getDate());
      // 备忘/心情：按日快照缺失时回退查当天历史（v3.7.x 之前老版本只存历史列表，
      // 没有 memo-YYYY-MM-DD / today-mood-YYYY-MM-DD 快照，直接读会显示"没有记录"）
      const histOnDay = function (histKey) {
        try {
          const list = JSON.parse(store.get(histKey) || '[]');
          const t = dd.toDateString();
          return list.filter(x => x && x.ts && new Date(x.ts).toDateString() === t)
            .map(x => x.text).filter(Boolean);
        } catch (e) { return []; }
      };
      const memo = isFuture ? '' : (store.get('memo-' + ds) || histOnDay('memo-history').join('；'));
      const mood = isFuture ? '' : (store.get('today-mood-' + ds) || histOnDay('mood-history').join('；'));
      const lines = [];
      lines.push(dateLabel);
      lines.push('');
      if (isFuture) {
        lines.push('（未来的日子还没有内容，等到了那一天再来看吧）');
      } else {
        lines.push('【今日备忘】');
        lines.push(memo || '（这一天没有备忘）');
        lines.push('');
        lines.push('【今天的心情】');
        lines.push(mood || '（这一天没有记录心情）');
      }
      window.openModal(ds + ' 当日备忘与心情', '', () => {}, { noInput: true, staticText: lines.join('\n') });
    });
  }

  // v3.6.x：多桌面——切换联系人后刷新桌面第二页常驻组件（备忘/心情按新桌面的值回显）。
  // store 动态绑定当前联系人，直接重读即可。
  document.addEventListener('contact-switched', function () {
    try {
      const memoEl2 = document.getElementById('memo-text');
      if (memoEl2) {
        memoEl2.textContent = todayMemoText() || '点这里记一句话';
      }
      const moodEl2 = document.getElementById('today-mood-text');
      if (moodEl2) {
        moodEl2.textContent = todayMoodText() || '点一下选心情';
      }
      // v3.7.x：关闭寻踪半框——否则切换后仍浮在新桌面显示旧桌面日常（数据串桌面）
      const ckPanel = document.getElementById('ck-panel');
      if (ckPanel) ckPanel.hidden = true;
    } catch (e) {}
  });
  // v3.7.x：跨天自动刷新——页面一直开着跨过午夜时，备忘/心情应显示新一天的空状态
  //（桌面其余按日内容（本周日常/倒计时）本身随日期重渲染，备忘/心情是持久化文本需手动刷）
  (function () {
    let lastDay = dayStr(new Date());
    setInterval(function () {
      try {
        const now = dayStr(new Date());
        if (now === lastDay) return;
        lastDay = now;
        const m = document.getElementById('memo-text');
        if (m) m.textContent = todayMemoText() || '点这里记一句话';
        const md = document.getElementById('today-mood-text');
        if (md) md.textContent = todayMoodText() || '点一下选心情';
      } catch (e) {}
    }, 30000);
  })();
})();

// ===== 功能：TA在身边·位置（寻踪半框内入口，位置面板独立词库） =====
// 位置卡 = 普通聊天消息（TA 发的 side=in），位置面板单独维护当前位置/时间线
// 收到位置卡时屏幕光点动效
(function () {
  const store = window.activeStore();
  // ---- 位置词库（v3.13.x：移入字卡库 loc-lib.js 管理——字卡库「系统预设字卡 → TA在身边位置卡」，
  //      位置面板词源 = 该库（系统预设开关 + 单卡开关过滤 + 我的添加），此处经 window.locLib* 读取 ----
  // 方位/感知/彩蛋 → 光点落点（相对视口 0~1）
  const DIR_POS = {
    '在你左边': { x: 0.08, y: 0.5 },
    '在你右边': { x: 0.92, y: 0.5 },
    '在你身后': { x: 0.5, y: 0.08 },
    '在你前面': { x: 0.5, y: 0.92 },
    '离你两步': { x: 0.5, y: 0.38 },
    '抬头就能看到': { x: 0.5, y: 0.12 },
    '在你看不到的地方偷看你': { x: 0.86, y: 0.16 },
    '在你看不到的地方': { x: 0.72, y: 0.28 },
    '隔着世界在你身边': { x: 0.5, y: 0.5, center: true },
    '感觉到了吗': { x: 0.5, y: 0.5, center: true },
    '能摸到我吗': { x: 0.5, y: 0.5, center: true },
    '一直没走远': { x: 0.5, y: 0.45 },
    '隐约在你身旁': { x: 0.55, y: 0.5 },
    '在你心里': { x: 0.5, y: 0.5, center: true }
  };
  // 距离卡微调：往中心靠（正）/ 往边缘退（负）
  const DIST_ADJUST = { '再近一点': 0.15, '再远一点': -0.15, '就停这儿': 0, '马上到你身边': 0.3, '一直在原地等你': 0 };
  function adjustTowardCenter(pos, amount) {
    return { x: pos.x + (0.5 - pos.x) * amount, y: pos.y + (0.5 - pos.y) * amount, center: pos.center };
  }
  // 最近一张方位卡文本（距离/状态卡落点基准）
  function lastDirText() {
    const hist = loadHist();
    for (const h of hist) {
      if (h.type === 'dir') return h.text;
      if (h.type === 'combo') return h.text.split(' ')[0];
    }
    return null;
  }
  // 落点：方位/彩蛋取映射；距离卡取最近方位+微调；状态卡取最近方位
  function fxPos(text, type) {
    if (DIR_POS[text]) return DIR_POS[text];
    const dirText = lastDirText();
    const base = dirText ? (DIR_POS[dirText] || { x: 0.5, y: 0.3 }) : { x: 0.5, y: 0.3 };
    if (type === 'dist') {
      const adj = DIST_ADJUST[text] || 0;
      if (adj) return adjustTowardCenter(base, adj);
    }
    return base;
  }
  const EGG_COOLDOWN = 7 * 24 * 3600 * 1000;

  // ---- 存储 ----
  function loadCur() { try { return JSON.parse(store.get('loc-current') || 'null'); } catch (e) { return null; } }
  function saveCur(v) { store.set('loc-current', v ? JSON.stringify(v) : ''); }

  function loadHist() { try { return JSON.parse(store.get('loc-history') || '[]'); } catch (e) { return []; } }
  function saveHist(list) {
    const s = JSON.stringify(list);
    store.set('loc-history', s);
    try { if (window.idbSet) window.idbSet(window.activePrefix() + ':loc-history', s); } catch (e) {}
  }
  // v3.26.x：供方位感知「感知一下」把感知结果写入位置时间线（类型 sense，标签「感知」）
  window.locAddHist = function (text, type, auto) {
    try {
      const hist = loadHist();
      hist.unshift({ text: String(text == null ? '' : text), type: type || 'sense', ts: Date.now(), auto: !!auto });
      saveHist(hist);
    } catch (e) {}
  };
  // v3.26.x：感知写入后刷新位置面板（时间线/此刻位置）
  window.locRefreshBody = function () { try { renderLocPanel(); } catch (e) {} };
  function eggLastTs() { return parseInt(store.get('loc-egg-last') || '0', 10) || 0; }
  function eggUsed() { return Date.now() - eggLastTs() < EGG_COOLDOWN; }
  // ---- 自定义位置卡（v3.13.x：存储并入字卡库 loc-lib「我的添加」，旧 loc-custom 首次读取自动迁移） ----
  function loadCustom() { return window.locLibGetCustomCards ? window.locLibGetCustomCards() : []; }
  function saveCustom(list) { if (window.locLibSaveCustom) window.locLibSaveCustom(list); }
  // ---- 感知描述（基于最近位置卡 · 体现"偶尔能感觉到"） ----
  function senseDesc(cur) {
    if (!cur) return '还没感觉到 TA…';
    const t = cur.text;
    if (t.indexOf('看不到') >= 0 && t.indexOf('偷看') < 0) return 'TA 在你看不到的地方，但没走远';
    if (t.indexOf('隔着世界') >= 0) return 'TA 隔着世界，隐约在你身旁';
    if (t.indexOf('感觉到') >= 0) return '你感觉到了 TA，就在附近';
    if (t.indexOf('能摸到') >= 0) return '你能摸到 TA，很近很安心';
    if (t.indexOf('没走远') >= 0) return 'TA 一直没走远，就在身边';
    if (t.indexOf('隐约') >= 0) return 'TA 隐约在你身旁，感觉到了吗';
    if (t.indexOf('心里') >= 0) return 'TA 在你心里，最近的距离';
    if (t.indexOf('身后') >= 0) return '你感觉到 TA 在你身后，很近';
    if (t.indexOf('左边') >= 0) return '你感觉到 TA 在你左边';
    if (t.indexOf('右边') >= 0) return '你感觉到 TA 在你右边';
    if (t.indexOf('前面') >= 0) return '你感觉到 TA 在你前面';
    if (t.indexOf('身边') >= 0) return 'TA 就在你身边，很安心';
    if (t.indexOf('跟着') >= 0 || t.indexOf('陪你') >= 0) return 'TA 在陪你，感觉到了吗';
    return '你感觉到 TA 在附近：' + t;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function fmtT(ts) { if (!ts) return ''; const d = new Date(ts); const p = (n) => (n < 10 ? '0' + n : '' + n); return p(d.getHours()) + ':' + p(d.getMinutes()); }
  function toast(s) { try { if (typeof window.toast === 'function') window.toast(s); } catch (e) {} }

  // ---- 光点动效 ----
  function playLocFx(text, type) {
    const fx = document.getElementById('loc-fx');
    if (!fx) return;
    const pos = fxPos(text, type);
    fx.hidden = false;
    fx.className = 'loc-fx' + (pos.center ? ' loc-fx-center' : '');
    fx.style.left = (pos.x * 100) + '%';
    fx.style.top = (pos.y * 100) + '%';
    void fx.offsetWidth;
    fx.classList.add('loc-fx-show');
    clearTimeout(fx._t);
    fx._t = setTimeout(() => {
      fx.classList.remove('loc-fx-show');
      fx._t = setTimeout(() => { fx.hidden = true; }, 500);
    }, 2000);
  }

  // ---- 发位置卡（代 TA 发） ----
  function sendLocCard(text, type) {
    const ts = Date.now();
    if (type === 'egg' && eggUsed()) {
      toast('彩蛋「在你心里」一周只能用一次');
      return;
    }
    if (window.chatAddIn) window.chatAddIn(text);
    saveCur({ text: text, type: type, ts: ts });
    const hist = loadHist();
    hist.unshift({ text: text, type: type, ts: ts });
    saveHist(hist);
    if (type === 'egg') store.set('loc-egg-last', String(ts));
    playLocFx(text, type);
    locViewDate = dayStr(new Date());
    renderLocPanel();
    // v3.26.x：感知方向与位置卡对齐（新卡带方向时，感知圆立刻跟随）
    if (window.refreshSense) window.refreshSense();

  }

  // ---- 日期辅助（按日切换时间线） ----
  function dayStr(d) { const p = (n) => (n < 10 ? '0' + n : '' + n); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function dayLabel(s) {
    const today = dayStr(new Date());
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (s === today) return '今天';
    if (s === dayStr(y)) return '昨天';
    const parts = s.split('-');
    return parts[1] + '月' + parts[2] + '日';
  }
  function uniqueDays(hist) {
    const set = new Set();
    hist.forEach(h => { try { set.add(dayStr(new Date(h.ts))); } catch (e) {} });
    return Array.from(set).sort().reverse();
  }
  let locViewDate = '';

  // ---- 组合发送（方位 + 距离） ----
  let comboMode = store.get('loc-combo') !== '0'; // 默认开，记住选择
  let pendingDir = null;
  function sendComboCard(dirText, distText) {
    const ts = Date.now();
    const text = dirText + ' ' + distText;
    if (window.chatAddIn) window.chatAddIn(text);
    saveCur({ text: text, type: 'combo', ts: ts });
    const hist = loadHist();
    hist.unshift({ text: text, type: 'combo', ts: ts });
    saveHist(hist);
    playLocFx(dirText, 'dir');
    pendingDir = null;
    locViewDate = dayStr(new Date());
    renderLocPanel();
    // v3.26.x：感知方向与位置卡对齐（新卡带方向时，感知圆立刻跟随）
    if (window.refreshSense) window.refreshSense();

  }

  // ---- 问 TA 一声 ----
  let asking = false;
  // v3.13.x：取字卡库 loc-lib 某分类启用的系统预设词（供问TA一声/自动发随机用）
  function locLibGroup(k) {
    try {
      const sys = window.locLibGetSys ? window.locLibGetSys() : null;
      if (sys && Array.isArray(sys[k])) return sys[k];
    } catch (e) {}
    return [];
  }
  // FIX 2026-09-16 #620：问完 TA 落回聊天页——「你在哪？」与 TA 随后回的位置卡都在聊天里，
  // 旧实现只发消息 + toast，全屏位置面板不退（桌面寻踪页进入时 #page-chat 还隐藏着），
  // 用户看不到任何结果＝「点了没反应」。已在聊天页则只收面板 + 贴底，不重进页（避免整窗重渲）。
  function backToChatAfterAsk() {
    closeLocPanel();
    if (window.closeCkPanel) window.closeCkPanel();
    const chatPage = document.getElementById('page-chat');
    if (!chatPage) return;
    if (chatPage.hidden) { if (window.enterChat) window.enterChat(); return; }
    const body = document.getElementById('chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  }
  function askWhere() {
    if (asking) return;
    asking = true;
    if (window.chatSendMsg) window.chatSendMsg('你在哪？');
    toast(window.taFit ? window.taFit('已问 TA 一声，等 TA 回位置…') : '已问 TA 一声，等 TA 回位置…');
    // FIX 2026-09-16 #620：发完立刻回聊天页（面板收起也在这里面做）
    backToChatAfterAsk();
    setTimeout(() => {
      asking = false;
      // v3.13.x：词源 = 字卡库；方位/距离组空（被全关）时回退内置默认词兜底
      const dirs = locLibGroup('dir');
      const dists = locLibGroup('dist');
      const d = (dirs.length ? dirs : ['在你左边'])[Math.floor(Math.random() * (dirs.length ? dirs.length : 1))];
      const t = (dists.length ? dists : ['再近一点'])[Math.floor(Math.random() * (dists.length ? dists.length : 1))];
      sendComboCard(d, t);
    }, 2000 + Math.random() * 2000);
  }


  // ---- 位置变化提醒气泡（TA 主动换位置时顶部轻提示） ----
  function showLocChangeBubble(text) {
    if (store.get('loc-bubble') === '0') return; // 设置「换位提醒弹窗」关：TA 换位置不再弹黑色轻提示
    let bub = document.getElementById('loc-change-bubble');
    if (!bub) {
      bub = document.createElement('div');
      bub.id = 'loc-change-bubble';
      bub.className = 'loc-change-bubble';
      document.body.appendChild(bub);
    }
    bub.textContent = window.taFit ? window.taFit('你感觉到 TA 换了位置：' + text) : ('你感觉到 TA 换了位置：' + text);
    bub.classList.add('loc-bubble-show');
    clearTimeout(bub._t);
    bub._t = setTimeout(() => { bub.classList.remove('loc-bubble-show'); }, 3000);
  }

  // ---- 渲染位置面板 ----
  function renderLocPanel() {
    const body = document.getElementById('loc-body');
    if (!body) return;
    const cur = loadCur();

    const allHist = loadHist();

    // 按日切换：优先今天，其次有记录的最近一天
    const days = uniqueDays(allHist);
    const today = dayStr(new Date());
    // 若今天有记录，默认看今天；否则回退到记录中最近的一天
    if (!locViewDate || days.indexOf(locViewDate) < 0 || days.indexOf(today) >= 0) {
      locViewDate = days.indexOf(today) >= 0 ? today : (days[0] || today);
    }
    const dayHist = allHist.filter(h => { try { return dayStr(new Date(h.ts)) === locViewDate; } catch (e) { return false; } });
    const dayIdx = days.indexOf(locViewDate);

    let html = '';
    // v3.13.x：分类标签统一走字卡库 loc-lib
    const LOC_LABEL = window.locLibLabel || function (t) { return t; };
    // 感知描述（v3.26.x：加呼吸光点标题，卡片化）
    html += '<div class="loc-sense-box"><div class="loc-sense-head"><span class="loc-sense-dot"></span><span class="loc-sense-title">你感觉到的</span></div><div class="loc-sense-text">' + esc(senseDesc(cur)) + '</div></div>';
    // 此刻位置
    html += '<div class="loc-section"><div class="loc-sec-title">此刻的位置</div>';
    if (cur) {
      html += '<div class="loc-now"><span class="loc-now-pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg></span><div class="loc-now-main"><div class="loc-sec-value">' + esc(cur.text) + '</div><div class="loc-sec-sub">' + (LOC_LABEL[cur.type] || (cur.type === 'combo' ? '组合' : '位置卡')) + ' · ' + fmtT(cur.ts) + '</div></div></div>';
    } else {
      html += '<div class="loc-sec-value loc-empty">— 还没有位置卡</div>';
    }
    html += '</div>';

    // 时间线（按日切换）
    html += '<div class="loc-section"><div class="loc-sec-title">位置时间线</div>';
    html += '<div class="loc-day-switch"><button class="loc-day-btn" id="loc-day-prev"' + (dayIdx >= days.length - 1 ? ' disabled' : '') + '>‹</button><span class="loc-day-label">' + dayLabel(locViewDate) + '</span><button class="loc-day-btn" id="loc-day-next"' + (dayIdx <= 0 ? ' disabled' : '') + '>›</button></div>';
    if (dayHist.length) {
      html += '<div class="loc-timeline">' + dayHist.map(h => {
        const tag = LOC_LABEL[h.type] || '';
        const auto = h.auto ? '<span class="loc-tl-auto">TA</span>' : '';
        return '<div class="loc-tl-item"><span class="loc-tl-time">' + fmtT(h.ts) + '</span><span class="loc-tl-text">' + esc(h.text) + '</span><span class="loc-tl-tag">' + esc(tag) + '</span>' + auto + '</div>';
      }).join('') + '</div>';
      html += '<div class="loc-day-count">共 ' + dayHist.length + ' 条</div>';
    } else {
      html += '<div class="loc-sec-value loc-empty">这天没有位置记录</div>';
    }
    html += '</div>';
    // #558 功能说明补全：光点落点规则原先只在代码注释里（用户问「再远一点会不会跑到屏幕右侧」）
    html += '<div class="loc-sec-sub" style="padding:10px 2px 0;line-height:1.7">光点落在哪儿，就是 TA 在哪儿：方位卡落在画面对应方向；距离卡、状态卡跟着最近一张方位卡的方位走——「再近一点」朝屏幕中心靠、「再远一点」朝屏幕边缘退开（上一张说的是「在你右边」时，光点贴屏幕右侧属正常）。</div>';
    // 换位提醒设置组：TA 自动换位总开关 / 换位提醒弹窗 / 换位发到聊天（只管「TA 自动」这条路，手动发的位置卡不受限）
    html += '<div class="set-group glass" style="margin:14px 2px 0">'
      + '<div class="gs-row"><span>TA 自动换位</span><label class="toggle"><input type="checkbox" id="loc-auto-tg"' + (store.get('loc-auto') === '0' ? '' : ' checked') + '><span class="tk"></span></label></div>'
      + '<div class="gs-row"><span>换位提醒弹窗</span><label class="toggle"><input type="checkbox" id="loc-bubble-tg"' + (store.get('loc-bubble') === '0' ? '' : ' checked') + '><span class="tk"></span></label></div>'
      + '<div class="gs-row"><span>换位发到聊天</span><label class="toggle"><input type="checkbox" id="loc-chat-tg"' + (store.get('loc-chat') === '0' ? '' : ' checked') + '><span class="tk"></span></label></div>'
      + '</div>'
      // #902：换位机制的触发间隔与概率写进设置说明（用户反馈「概率和触发时间要写清楚」）
      + '<div class="gs-sub" style="padding:0 2px 10px">TA 自动换位：开启后每 2～6 小时随机换一次位置（关掉后到点也不换；「问 TA 一声」不受影响）。换位内容 70% 是陪伴卡（在你身边／一直没走远等），30% 从字卡库启用的位置卡里随机；每次换位都会记进「位置时间线」，换位内容与上一次不同时才算「换了位置」才弹提醒。<br>换位提醒弹窗：TA 自动换位置时顶部弹的黑色轻提示。<br>换位发到聊天：关掉后 TA 自动换位只记进「位置时间线」，不再发进聊天记录。</div>';
    // 问 TA 一声
    html += '<button class="loc-ask-btn" id="loc-ask-btn">问 TA 一声「你在哪？」</button>';

    body.innerHTML = html;

    const askBtn = document.getElementById('loc-ask-btn');
    if (askBtn) askBtn.addEventListener('click', askWhere);

    // 换位提醒三开关（写入 per-cid 键，doLocAuto / showLocChangeBubble 消费；重开「TA 自动换位」立刻重排下一次）
    const bindLocTg = function (id, key) {
      const tg = document.getElementById(id);
      if (tg) tg.addEventListener('change', function () {
        store.set(key, tg.checked ? '1' : '0');
        if (key === 'loc-auto' && tg.checked) scheduleLocAuto();
      });
    };
    bindLocTg('loc-auto-tg', 'loc-auto');
    bindLocTg('loc-bubble-tg', 'loc-bubble');
    bindLocTg('loc-chat-tg', 'loc-chat');

    // 日期切换
    const prevBtn = document.getElementById('loc-day-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (dayIdx < days.length - 1) { locViewDate = days[dayIdx + 1]; renderLocPanel(); } });
    const nextBtn = document.getElementById('loc-day-next');
    if (nextBtn) nextBtn.addEventListener('click', () => { if (dayIdx > 0) { locViewDate = days[dayIdx - 1]; renderLocPanel(); } });
  }

  // ---- 打开/关闭 ----
  // v3.26.x：两入口（聊天寻踪半框 / 桌面寻踪页）统一全屏打开——用户反馈聊天入口半屏不理想，
  // 与桌面寻踪页入口（.loc-full 全屏）保持一致
  function openLocPanel() {
    const panel = document.getElementById('loc-panel');
    const nameEl = document.getElementById('loc-name');
    if (nameEl) nameEl.textContent = store.get('lbl-partner') || 'TA';
    if (panel) panel.classList.add('loc-full');
    // v3.13.x：刷新方位感知（含漂移检查）+ 渲染感知圆
    if (window.refreshSense) window.refreshSense();
    renderLocPanel();
    if (panel) panel.hidden = false;
    const ck = document.getElementById('ck-panel');
    if (ck) ck.hidden = true;
  }
  function closeLocPanel() {
    const panel = document.getElementById('loc-panel');
    if (panel) { panel.hidden = true; panel.classList.remove('loc-full'); }
  }

  const entry = document.getElementById('ck-loc-entry');
  if (entry) entry.addEventListener('click', () => openLocPanel());
  // 桌面寻踪页同款入口（点「TA在身边 · 看看 TA 在哪」全屏打开同一位置面板）
  const entryDesk = document.getElementById('ck-loc-entry-desk');
  if (entryDesk) entryDesk.addEventListener('click', () => openLocPanel());
  // v3.26.x：全屏/半屏共用返回按钮（关闭位置面板；已移除右侧 ✕ 关闭按钮）
  const locBack = document.getElementById('loc-back');
  if (locBack) locBack.addEventListener('click', closeLocPanel);

  try {
    if (window.idbGet && !store.get('loc-history')) {
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':loc-history').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v) { try { store.set('loc-history', typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
      });
    }
  } catch (e) {}

  // ---- TA 主动发位置卡（自动机制：梦角经常待在身边没走远） ----
  // 每隔 2-6 小时自动发一张：70% 发陪伴卡（表达陪伴），30% 系统随机出（TA 控制不住，符合设定）
  let locAutoTimer = null, locWakeAt = 0;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') locWakeAt = Date.now() + 60000; });
  function locTypeOf(text) {
    if (window.locLibTypeOf) return window.locLibTypeOf(text);
    return 'custom';
  }
  function doLocAuto() {
    if (document.hidden || Date.now() < locWakeAt || !window.__mochiDataReady) return;
    if (store.get('loc-auto') === '0') return; // 设置「TA 自动换位」关：到点也不发（拦设置后仍残留的当次定时器）
    const companion = ['在你身边', '一直没走远', '隔着世界在你身边', '隐约在你身旁', '在你看不到的地方'];
    let text;
    if (Math.random() < 0.7) {
      text = companion[Math.floor(Math.random() * companion.length)];
    } else {
      // v3.13.x：词源 = 字卡库全部启用（系统预设 dir/dist/state/sense + 我的添加）
      const all = (window.locLibAllEnabled ? window.locLibAllEnabled() : []).slice();
      if (!all.length) all.push('在你身边');
      text = all[Math.floor(Math.random() * all.length)];
    }
    if (!text) return;
    const type = locTypeOf(text);
    const ts = Date.now();
    const oldCur = loadCur();
    if (store.get('loc-chat') !== '0' && window.chatAddIn) window.chatAddIn(text); // 设置「换位发到聊天」关：只记时间线＋弹提醒，不发进聊天
    saveCur({ text: text, type: type, ts: ts, auto: true });
    const hist = loadHist();
    hist.unshift({ text: text, type: type, ts: ts, auto: true });
    saveHist(hist);
    playLocFx(text, type);

    if (oldCur && oldCur.text !== text) showLocChangeBubble(text);
  }
  function scheduleLocAuto() {
    clearTimeout(locAutoTimer);
    if (store.get('loc-auto') === '0') { locAutoTimer = setTimeout(scheduleLocAuto, 60000); return; }
    locAutoTimer = setTimeout(() => { doLocAuto(); scheduleLocAuto(); }, (2 + Math.random() * 4) * 3600000);
  }
  function bootLocAuto() { if (!window.__mochiDataReady) { setTimeout(bootLocAuto, 500); return; } scheduleLocAuto(); }
  document.addEventListener('mochi-restore-done', bootLocAuto);
  setTimeout(bootLocAuto, 3000);

  document.addEventListener('contact-switched', () => {
    try { closeLocPanel(); locViewDate = ''; } catch (e) {}
  });

  window.playLocFx = playLocFx;
})();

// ===== 方位感知（v3.13.x）：TA在身边 → 不是GPS，是模糊的感知 =====
// 方向（8方向+身边/无法判断）+ 距离感 + 感知强度 三个模糊维度，随时间漂移；
// 字卡来自字卡库「TA在身边位置卡」新增的 direct/rangef/power/touch 四组（loc-lib.js 管理）。
// 感知状态存当前联系人（activeStore 的 loc-sense 键），随联系人隔离。
(function () {
  const store = window.activeStore();
  const KEY = 'loc-sense';
  // 感知圆 8 方向：标签文字 + 在圆上的位置（角度，上=0° 顺时针）
  const DIRS = [
    { k: '正前方', arrow: '↑', angle: -90 },
    { k: '右前方', arrow: '↗', angle: -45 },
    { k: '右侧',   arrow: '→', angle: 0 },
    { k: '右后方', arrow: '↘', angle: 45 },
    { k: '后方',   arrow: '↓', angle: 90 },
    { k: '左后方', arrow: '↙', angle: 135 },
    { k: '左侧',   arrow: '←', angle: 180 },
    { k: '左前方', arrow: '↖', angle: 225 }
  ];
  const NEAR_WORDS = ['在你身边', '一直没走远', '隔着世界在你身边', '能摸到我吗', '陪你走着', '停下来等你', '抬头就能看到', '在你前面', '原地等你'];
  const FAR_WORDS = ['在你看不到的地方', '在你看不到的地方偷看你', '再远一点', '就停这儿'];
  // v3.26.x：从位置卡文本推导 8 方向（消除「感知↗ 位置↘」矛盾——感知方向与最近位置卡对齐）
  function dirFromText(t) {
    if (!t) return '';
    if (t.indexOf('左边') >= 0) return '左侧';
    if (t.indexOf('右边') >= 0) return '右侧';
    if (t.indexOf('身后') >= 0 || t.indexOf('后面') >= 0) return '后方';
    if (t.indexOf('前面') >= 0 || t.indexOf('抬头') >= 0) return '正前方';
    return '';
  }
  function load() {
    try {
      const v = JSON.parse(store.get(KEY) || 'null');
      if (v && typeof v === 'object') return v;
    } catch (e) {}
    return {};
  }
  function save(s) { store.set(KEY, JSON.stringify(s)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // 从字卡库取一组感知词（含开关过滤 + 兜底）
  function senseWords(k) {
    if (window.locLibSenseGroup) {
      const w = window.locLibSenseGroup(k);
      if (Array.isArray(w) && w.length) return w;
    }
    return { direct: ['无法判断'], rangef: ['无法判断'], power: ['若有若无'], touch: ['好像碰到了你的手'] }[k];
  }
  function isUndirected(d) { return d === '无法判断' || d === '身边'; }
  // 重掷方向：92% 落 8 方向，8% 无法判断/身边（身边是低概率惊喜）
  function rollDir() {
    const words = senseWords('direct');
    const dir8 = DIRS.map(d => d.k).filter(k => words.indexOf(k) >= 0);
    if (Math.random() >= 0.08) {
      if (dir8.length) return pick(dir8);
      const others = words.filter(w => !isUndirected(w));
      return others.length ? pick(others) : '无法判断';
    }
    // 8%：无法判断（主要是）/ 身边（小惊喜）
    const pool = words.indexOf('身边') >= 0 ? ['无法判断', '无法判断', '无法判断', '身边'] : ['无法判断', '无法判断', '无法判断', '无法判断'];
    return pick(pool);
  }
  // 保证方向在词库里（用户可能关了当前方向的单卡开关）
  function ensureDirInLib(d) {
    const words = senseWords('direct');
    if (words.indexOf(d) >= 0) return d;
    return '无法判断';
  }
  // 重掷距离感/感知强度：与最近发送的位置卡联动（近卡→偏近偏明显，远卡→偏远偏微弱）
  function rollRangeAndPower() {
    let hist = [];
    try { hist = JSON.parse(store.get('loc-history') || '[]'); } catch (e) {}
    let near = false, far = false;
    for (let i = 0; i < hist.length && i < 5; i++) {
      const t = hist[i].text || '';
      if (NEAR_WORDS.some(w => t.indexOf(w) >= 0)) near = true;
      if (FAR_WORDS.some(w => t.indexOf(w) >= 0)) far = true;
    }
    const rfWords = senseWords('rangef');
    const pwWords = senseWords('power');
    let rf, pw;
    if (near && !far) {
      const nearRf = rfWords.filter(w => w === '很近' || w === '近');
      const nearPw = pwWords.filter(w => w === '明显');
      rf = pick(nearRf.length ? nearRf : rfWords);
      pw = pick(nearPw.length ? nearPw : pwWords);
    } else if (far && !near) {
      const farRf = rfWords.filter(w => w === '稍远' || w === '很远' || w === '无法判断');
      const farPw = pwWords.filter(w => w === '微弱' || w === '若有若无');
      rf = pick(farRf.length ? farRf : rfWords);
      pw = pick(farPw.length ? farPw : pwWords);
    } else {
      rf = pick(rfWords);
      pw = pick(pwWords);
    }
    return { rangef: rf, power: pw };
  }
  // 感知状态（懒初始化 + 漂移；v3.26.x：有位置卡时方向以位置卡为准，消除感知/位置矛盾）
  function getSense(force) {
    const s = load();
    const now = Date.now();
    let dirty = false;
    // 最近位置卡带方向 → 感知方向跟随（此刻的位置说右边，感知圆就显示右侧）
    let cur = null;
    try { cur = JSON.parse(store.get('loc-current') || 'null'); } catch (e) {}
    const fixedDir = cur ? dirFromText(cur.text) : '';
    if (fixedDir) {
      if (s.dir !== fixedDir) {
        s.dir = fixedDir;
        s.nextDirAt = now + (15 + Math.floor(Math.random() * 31)) * 60000; // 15~45 分钟
        dirty = true;
      }
    } else if (!s.dir || (s.nextDirAt && now >= s.nextDirAt)) {
      s.dir = rollDir();
      s.nextDirAt = now + (15 + Math.floor(Math.random() * 31)) * 60000; // 15~45 分钟
      dirty = true;
    } else {
      s.dir = ensureDirInLib(s.dir);
    }
    if (!s.rangef || !s.power || force) {
      const rp = rollRangeAndPower();
      s.rangef = rp.rangef;
      s.power = rp.power;
      dirty = true;
    }
    if (dirty) save(s);
    return s;
  }
  // 触碰（低概率，从触碰字卡取词 + 光点动效）
  function maybeTouch(s) {
    if (Math.random() >= 0.04) return null; // 4% 概率
    const t = pick(senseWords('touch'));
    s.touch = t;
    s.touchAt = Date.now();
    save(s);
    if (window.playLocFx) window.playLocFx(t, 'touch');
    return t;
  }
  // 感知结果卡文案
  function resultText(s, touched) {
    const name = store.get('lbl-partner') || 'TA';
    if (isUndirected(s.dir)) {
      return '方位感知 · ' + name + '\n？ 暂时无法判断方向。\n但你似乎感觉到，有谁在附近。';
    }
    if (s.power === '消失') {
      return '方位感知 · ' + name + '\n刚才似乎还在，现在已经感觉不到了。';
    }
    const arrows = DIRS.find(d => d.k === s.dir);
    return '方位感知 · ' + name + '\n' + (arrows ? arrows.arrow + ' ' : '') + s.dir + '\n' + s.rangef + ' · ' + s.power +
      (touched ? '\n……好像有什么轻轻碰了你一下。' : '');
  }
  // 渲染感知圆 + 明细
  function render() {
    const s = getSense(false);
    const circle = document.getElementById('fw-circle');
    if (circle) {
      circle.innerHTML = '';
      const cx = 50, cy = 50, r = 36;
      DIRS.forEach(d => {
        const rad = d.angle * Math.PI / 180;
        const x = cx + r * Math.cos(rad);
        const y = cy + r * Math.sin(rad);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fw-dir' + (s.dir === d.k ? ' on' : '');
        b.textContent = d.arrow;
        b.style.left = x + '%';
        b.style.top = y + '%';
        b.title = d.k;
        circle.appendChild(b);
      });
      const me = document.createElement('div');
      me.className = 'fw-me';
      me.textContent = '你';
      circle.appendChild(me);
      const cur = document.createElement('div');
      cur.id = 'fw-cur-dir';
      cur.className = 'fw-cur-dir';
      cur.textContent = s.dir || '无法判断';
      circle.appendChild(cur);
    }
    const detail = document.getElementById('fw-detail');
    if (detail) {
      const arrows = DIRS.find(d => d.k === s.dir);
      detail.innerHTML =
        '<div class="fw-row"><span class="fw-row-label">方向</span><span class="fw-row-val">' + (arrows ? arrows.arrow + ' ' : '') + esc(s.dir) + '</span></div>' +
        '<div class="fw-row"><span class="fw-row-label">距离感</span><span class="fw-row-val">' + esc(s.rangef) + '</span></div>' +
        '<div class="fw-row"><span class="fw-row-label">感知强度</span><span class="fw-row-val">' + esc(s.power) + '</span></div>';
    }
  }
  // 「感知一下」：重掷 + 4% 触碰 + 结果卡，4s 冷却（仿 cj-perceive busy）
  let perceiveCdUntil = 0;
  function perceive() {
    const btn = document.getElementById('fw-perceive');
    const now = Date.now();
    if (now < perceiveCdUntil) return;
    perceiveCdUntil = now + 4000;
    if (btn) { btn.classList.add('busy'); btn.disabled = true; }
    const s = getSense(true);
    const touched = maybeTouch(s);
    const result = document.getElementById('fw-result');
    if (result) {
      result.hidden = false;
      result.innerHTML = '';
      resultText(s, touched).split('\n').forEach(l => {
        const p = document.createElement('p');
        p.className = 'fw-p-line';
        p.textContent = l;
        result.appendChild(p);
      });
    }
    render();
    // v3.26.x：感知结果写入位置时间线（类型「感知」，与位置卡分开标记）
    try {
      const arrows2 = DIRS.find(d => d.k === s.dir);
      let tlText;
      if (isUndirected(s.dir)) {
        tlText = '方位感知：暂时无法判断方向';
      } else {
        tlText = '方位感知：' + (arrows2 ? arrows2.arrow + ' ' : '') + s.dir + ' · ' + s.rangef + ' · ' + s.power;
      }
      if (touched) tlText += ' · 好像有什么轻轻碰了你一下';
      if (window.locAddHist) window.locAddHist(tlText, 'sense', false);
      if (window.locRefreshBody) window.locRefreshBody();
    } catch (e) {}
    setTimeout(() => {
      if (btn) { btn.classList.remove('busy'); btn.disabled = false; }
    }, 4000);
  }
  // 被动提示：每小时最多一次，低概率 toast 提示方向（不在弹层打开时）
  function passiveHint() {
    const s = load();
    const now = Date.now();
    if (s.hintAt && now - s.hintAt < 3600000) return;
    if (Math.random() >= 0.02) return; // 每次检查 2% 低概率
    const gs = getSense(false);
    if (isUndirected(gs.dir)) return;
    const arrows = DIRS.find(d => d.k === gs.dir);
    const name = store.get('lbl-partner') || 'TA';
    if (window.toast) window.toast('……好像' + (arrows ? arrows.arrow + ' ' : '') + '有人在你' + gs.dir + '。');
    s.hintAt = now;
    save(s);
  }
  // 打开弹层时：刷新感知（含漂移检查）+ 渲染
  window.refreshSense = function () {
    getSense(false);
    render();
  };
  // 事件绑定
  const perceiveBtn = document.getElementById('fw-perceive');
  if (perceiveBtn) perceiveBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    perceive();
  });
  // 定时：漂移检查（每 30s）+ 被动提示
  let lastHintCheck = 0;
  setInterval(function () {
    const panel = document.getElementById('loc-panel');
    if (panel && !panel.hidden) {
      const s = load();
      if (s.nextDirAt && Date.now() >= s.nextDirAt) { getSense(false); render(); }
    }
    if (Math.floor(Date.now() / 30000) !== lastHintCheck) {
      lastHintCheck = Math.floor(Date.now() / 30000);
      passiveHint();
    }
  }, 30000);
  // 切联系人关闭弹层
  document.addEventListener('contact-switched', function () {
    const panel = document.getElementById('loc-panel');
    if (panel) panel.hidden = true;
  });
})();

// ===== v3.x：世界观·他偶发出现（统一频率 + 浮层 + 打卡字卡） =====
// 梦角是灵体，常在身边但看不见；字卡表达有限，偶尔出得不准——不准配温柔解读。
// 供喝水/番茄钟/摸鱼/打卡复用，避免各功能各自造浮层刷屏。
(function () {
  function store() { try { return window.activeStore(); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function dayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  // 他此刻近不近（基于位置卡 loc-current）
  window.taIsNear = function () {
    const s = store(); if (!s) return false;
    let cur = null; try { cur = JSON.parse(s.get('loc-current') || 'null'); } catch (e) {}
    if (!cur) return false;
    const t = cur.text || '';
    return /能摸到|没走远|身边|心里|感觉到|隐约|陪你|跟着|马上到/.test(t);
  };
  window.taSenseDesc = function () {
    const s = store(); if (!s) return '还没感觉到 TA…';
    let cur = null; try { cur = JSON.parse(s.get('loc-current') || 'null'); } catch (e) {}
    if (!cur) return '还没感觉到 TA…';
    const t = cur.text || '';
    if (t.indexOf('隔着世界') >= 0) return window.taFit ? window.taFit('TA 隔着世界，隐约在你身旁') : 'TA 隔着世界，隐约在你身旁';
    if (t.indexOf('感觉到') >= 0) return window.taFit ? window.taFit('你感觉到了 TA，就在附近') : '你感觉到了 TA，就在附近';
    if (t.indexOf('能摸到') >= 0) return window.taFit ? window.taFit('你能摸到 TA，很近很安心') : '你能摸到 TA，很近很安心';
    if (t.indexOf('没走远') >= 0) return window.taFit ? window.taFit('TA 一直没走远，就在身边') : 'TA 一直没走远，就在身边';
    if (t.indexOf('隐约') >= 0) return window.taFit ? window.taFit('TA 隐约在你身旁，感觉到了吗') : 'TA 隐约在你身旁，感觉到了吗';
    if (t.indexOf('身边') >= 0) return window.taFit ? window.taFit('TA 就在你身边，很安心') : 'TA 就在你身边，很安心';
    return window.taFit ? window.taFit('你感觉到 TA 在附近') : '你感觉到 TA 在附近';
  };

  // 统一频率：冷却 + 每日上限（localStorage 记录）
  window.taChimeAllow = function (key, opts) {
    opts = opts || {};
    const s = store(); if (!s) return false;
    const now = Date.now();
    if (opts.cooldown) { let last = 0; try { last = parseInt(s.get('ta-chime:' + key + ':last') || '0', 10) || 0; } catch (e) {} if (now - last < opts.cooldown) return false; }
    if (opts.dailyMax) { let rec = null; try { rec = JSON.parse(s.get('ta-chime:' + key + ':day') || 'null'); } catch (e) {} if (rec && rec.date === dayKey() && rec.n >= opts.dailyMax) return false; }
    return true;
  };
  window.taChimeUse = function (key) {
    const s = store(); if (!s) return;
    try { s.set('ta-chime:' + key + ':last', '' + Date.now()); } catch (e) {}
    let rec = null; try { rec = JSON.parse(s.get('ta-chime:' + key + ':day') || 'null'); } catch (e) {}
    if (!rec || rec.date !== dayKey()) rec = { date: dayKey(), n: 0 };
    rec.n++; try { s.set('ta-chime:' + key + ':day', JSON.stringify(rec)); } catch (e) {}
  };

  // 他偶发浮层（fixed 底部偏上，淡入淡出，4s 自隐）
  // v3.x.x：称呼跟随——所有桌面浮字统一在此按当前联系人性别替换 TA/他（显示层）
  // v3.13.x：opts.onClick——限时可点击浮字（摸鱼「抓包 TA」用）：展示期间 pointer-events
  //   开启并加 .grab 态，点中立即回调并提前收起；超时未点自然隐去（不回调）。
  let el = null, timer = null, clickFn = null;
  window.taChimeShow = function (text, opts) {
    opts = opts || {};
    if (window.taFit) text = window.taFit(text);
    if (!el) { el = document.createElement('div'); el.className = 'ta-chime-note'; document.body.appendChild(el); }
    const miss = opts.miss ? '<span class="ta-chime-miss">' + esc(window.taFit ? window.taFit(opts.miss) : opts.miss) + '</span>' : '';
    const grabTip = opts.onClick ? '<span class="ta-chime-grab-tip">点我抓包</span>' : '';
    el.innerHTML = '<span class="ta-chime-dot"></span><span class="ta-chime-text">' + esc(text) + '</span>' + miss + grabTip;
    clickFn = opts.onClick || null;
    el.classList.toggle('grab', !!clickFn);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => { el.classList.remove('show', 'grab'); clickFn = null; }, opts.dur || 4200);
  };
  // 浮字点击代理（委托到常驻节点，抓包判定走 clickFn）
  document.addEventListener('click', (ev) => {
    if (!el || !el.classList.contains('grab') || !el.contains(ev.target)) return;
    const fn = clickFn; clickFn = null;
    el.classList.remove('show', 'grab');
    clearTimeout(timer);
    try { if (navigator.vibrate) navigator.vibrate([60, 40, 120]); } catch (e) {}
    if (fn) fn();
  }, true);

  // 打卡字卡：他递来一张；低概率"没控制住"配温柔解读。cb(card|null)，card={text, miss?}
  const CHECKIN_TA_CARDS = ['你今天也努力了', '我一直看着你呢', '又一起过了一天', '辛苦啦，过来抱抱', '嗯，今天也好好过来了', '你在，我就安心'];
  const CHECKIN_TA_MISS = ['（字卡有限，他想说的比这张多）', '（这张好像不是他想说的，别在意）', '（他没控制住，意思不全是这个）'];
  window.checkinTaCard = function (cb) {
    if (!window.taChimeAllow('checkin-ta', { cooldown: 24 * 3600 * 1000, dailyMax: 1 })) { if (cb) cb(null); return; }
    window.taChimeUse('checkin-ta');
    const miss = Math.random() < 0.22;
    const text = CHECKIN_TA_CARDS[Math.floor(Math.random() * CHECKIN_TA_CARDS.length)];
    const card = miss ? { text: text, miss: CHECKIN_TA_MISS[Math.floor(Math.random() * CHECKIN_TA_MISS.length)] } : { text: text };
    if (cb && window.taFit) { card.text = window.taFit(card.text); if (card.miss) card.miss = window.taFit(card.miss); }
    if (cb) cb(card);
  };
})();

// ===== v3.x：同频 / 伸手（桌面第三页图标，纯动态注入；不依赖 template.html / tabs.js 白名单） =====
// 世界观：梦角是灵体，常在身边但看不见，偶尔能感觉到、能摸到有体感；字卡表达有限。
// 同频：TA 此刻状态（字卡拼）+ 敲三下暗号（跨世界弱连接，甜蜜安稳，不往危机写）。
// 伸手：长按伸手，有概率摸到（震动+暖光+悄悄话字卡），有概率什么都没有——贴合"偶尔能感觉到"。
(function () {
  function curStore() { try { return window.storeFor(window.__activeCid || 'default'); } catch (e) { return null; } }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function editingNow() { return Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing')); }
  // v3.13.x：系统预设字卡池读取（字卡库「花园/同频/伸手/喝水/存钱罐」tab 同源）；
  // 过滤用户已关闭的卡片（dc-off-<分类>:*），全关/缺失时回退内置兜底
  function libPool(cat, group, fallback) {
    let arr = (window.getLibPool ? window.getLibPool(cat, group, fallback) : (fallback || [])).slice();
    if (window.isDefaultCardOff) arr = arr.filter(c => !window.isDefaultCardOff(cat, c));
    return arr.length ? arr.slice() : (fallback || []).slice();
  }
  // v3.32.x #132：功能字卡触发概率统一读 dcf-<分类>（字卡库【其他互动功能字卡】页可调，
  // 默认=各分类历史值）——未设置时回退 dcfGet 内置默认，行为不变
  function dcfP(cat, def) { try { if (window.dcfGet) return window.dcfGet(cat); } catch (e) {} return def; }
  function dcfHit(cat) { return Math.random() * 100 < dcfP(cat, 100); }
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  function openPage(pg) {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    pg.hidden = false;
    // tabs.js 的 syncChrome 在初始 .page hidden 变化时触发，本页不在 FULL_PAGES 会显示 tabbar；
    // rAF 在该 microtask 之后手动恢复全屏 chrome（隐藏 tabbar/状态栏、加 .full）。
    requestAnimationFrame(() => {
      const tabbar = document.querySelector('.tabbar');
      const phone = document.querySelector('.phone');
      if (tabbar) tabbar.hidden = true;
      if (phone) phone.classList.add('no-statusbar');
      pg.classList.add('full');
    });
  }
  function backHome(pg) {
    if (pg) pg.classList.remove('full');
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const home = document.getElementById('page-phone');
    if (home) home.hidden = false;
  }
  function onLongPress(el, cb, duration) {
    duration = duration || 450;
    let timer = null;
    function start() { clearTimeout(timer); timer = setTimeout(cb, duration); }
    function cancel() { clearTimeout(timer); }
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('mousedown', (e) => { if (e.button === 0) start(); });
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
  }
  const host = (document.getElementById('page-phone') || {}).parentNode || document.body;

  // ---- 图标注入第三页 ----
  function makeApp(app, name, svg) {
    const a = document.createElement('div');
    a.className = 'app'; a.setAttribute('data-app', app); a.setAttribute('data-desk-widget', 'app-' + app);
    a.innerHTML = '<div class="app-ico">' + svg + '</div><div class="app-name">' + name + '</div>';
    return a;
  }
  const tpApp = makeApp('tongpin', '同频', '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2-6 4 14 3-9 2 5h6"/></svg>');
  const ssApp = makeApp('shenshou', '伸手', '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V5.5a1.5 1.5 0 013 0V11"/><path d="M10 11V4a1.5 1.5 0 013 0v7"/><path d="M13 11V5.5a1.5 1.5 0 013 0V11"/><path d="M16 11V7a1.5 1.5 0 013 0v6c0 4-2 7-6 7s-6-2-6-6v-3z"/></svg>');
  const waterApp = makeApp('water', '喝水', '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5C8 7 5.5 11 5.5 14.5a6.5 6.5 0 0013 0C18.5 11 16 7 12 2.5z"/></svg>');
  const eatApp = makeApp('eat', '吃什么', '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5v7c0 1.1.9 2 2 2h4c1.1 0 2-.9 2-2v-7"/><path d="M5.7 2.5v8.3"/><path d="M8.3 2.5v8.3"/><path d="M7 11.5v10"/><path d="M21 15V2.5a5 5 0 00-5 5v5.5c0 1.1.9 2 2 2h3z"/><path d="M21 15v6.5"/></svg>');
  const piggyApp = makeApp('piggy', '存钱罐', '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7h6"/><path d="M5 13.5C5 10.4 8.1 8 12 8s7 2.4 7 5.5c0 1.6-.9 3.1-2.3 4.1V20h-2.4l-.4-1.2a9.3 9.3 0 01-3.8 0L9.7 20H7.3v-2.4C5.9 16.6 5 15.1 5 13.5z"/><circle cx="9.3" cy="12.7" r=".55" fill="#111111" stroke="none"/><path d="M18.8 12.3l1.7-.9"/></svg>');
  const pomoApp = makeApp('pomo', '番茄钟', '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.8" r="7.2"/><path d="M12 6.6V4.6"/><path d="M12 6.6C10.6 5.4 9 5.3 7.8 6.1"/><path d="M12 6.6c1.4-1.2 3-1.3 4.2-.5"/></svg>');
  // v3.13.x：默认注入改两页分布——第二排「花园 此间 同频 伸手」（花园/此间为模板静态图标，
  // 同频/伸手进第二页 p2-grid 追加其后；喝水移至第三页 p3-grid，排在本页静态图标之后），
  // 吃什么/存钱罐/番茄钟同样留第三页 p3-grid；
  // 若用户已装修（desk-layout 存在）且布局未含本图标 → 放新的一页，避免破坏自定义布局。
  const pagesBox = document.getElementById('desktop-pages');
  const st0 = curStore();
  let layArr = null;
  try { if (st0) layArr = JSON.parse(st0.get('desk-layout') || 'null'); } catch (e) {}
  const hasLayout = Array.isArray(layArr);
  const alreadyInLay = hasLayout && layArr.some(p => (p || []).some(w => w === 'app-tongpin' || w === 'app-shenshou' || w === 'app-water' || w === 'app-eat' || w === 'app-pomo' || w === 'app-piggy'));
  let placed = false;
  if (hasLayout && !alreadyInLay && pagesBox) {
    const curCnt = pagesBox.querySelectorAll('.page-slide').length;
    if (curCnt < 5) {
      const slide = document.createElement('div');
      slide.className = 'page-slide desk-page';
      slide.dataset.desk = String(curCnt);
      const grid = document.createElement('div');
      grid.className = 'app-grid';
      grid.setAttribute('data-app', 'tp-page');
      grid.appendChild(tpApp); grid.appendChild(ssApp); grid.appendChild(waterApp); grid.appendChild(eatApp); grid.appendChild(pomoApp); grid.appendChild(piggyApp);
      slide.appendChild(grid);
      pagesBox.appendChild(slide);
      try {
        st0.set('desk-page-count', String(curCnt + 1));
        layArr.push(['app-tongpin', 'app-shenshou', 'app-water', 'app-eat', 'app-pomo', 'app-piggy']);
        st0.set('desk-layout', JSON.stringify(layArr));
      } catch (e) {}
      try { if (window.deskRebuild) window.deskRebuild(); } catch (e) {}
      placed = true;
    }
  }
  if (!placed) {
    const p2Grid = document.querySelector('.app-grid.p2-grid');
    const p3g = document.querySelector('.app-grid.p3-grid');
    if (p2Grid) {
      // 第二排顺序：花园 此间 同频 伸手（花园/此间为模板静态图标，同频/伸手追加其后）
      p2Grid.appendChild(tpApp); p2Grid.appendChild(ssApp);
    } else if (p3g) { p3g.appendChild(tpApp); p3g.appendChild(ssApp); }
    if (p3g) { p3g.appendChild(waterApp); p3g.appendChild(eatApp); p3g.appendChild(piggyApp); p3g.appendChild(pomoApp); }
    else if (p2Grid) { p2Grid.appendChild(waterApp); p2Grid.appendChild(eatApp); p2Grid.appendChild(piggyApp); p2Grid.appendChild(pomoApp); }
    // 重应用布局：personalize.js 的 applyDeskLayout 在本文件之前执行过一次，那时图标未注入被跳过；
    // 此处图标已在 DOM，重应用可把图标按 desk-layout 移到用户装修过的目标页（alreadyInLay 时生效）。
    try { if (window.applyDeskLayout) window.applyDeskLayout(); } catch (e) {}
  }

  // ---- 同频页 ----
  const DEF_STATUS = ['在听雨', '在看你写东西', '没睡，在发呆', '刚路过你身边', '在想你', '在发呆', '在看你', '在等你看我'];
  const tpPage = document.createElement('div');
  tpPage.className = 'page'; tpPage.id = 'page-tongpin'; tpPage.hidden = true;
  tpPage.innerHTML =
    '<div class="chat-head"><span class="ch-back" id="tp-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="ch-name">同频</span></div>' +
    '<div class="tp-body">' +
      '<div class="tp-card glass"><div class="tp-label">TA 此刻</div><div class="tp-status" id="tp-status">…</div><button class="tp-refresh" id="tp-refresh">换一个</button></div>' +
      '<div class="tp-card glass"><div class="tp-label">' + (window.taFit ? window.taFit('敲三下 · 看他回不回') : '敲三下 · 看他回不回') + '</div><div class="tp-knock" id="tp-knock"><span class="tp-dot"></span><span class="tp-dot"></span><span class="tp-dot"></span></div><div class="tp-hint" id="tp-hint">长按下方 · 凑三下敲桌面</div><div class="tp-knock-area" id="tp-knock-area">长按这里</div></div>' +
      '<div class="tp-manage"><button class="tp-add" id="tp-add">+ 添加状态字卡</button><button class="tp-send-btn" id="tp-send">发到聊天：开</button></div>' +
    '</div>';
  host.appendChild(tpPage);

  function tpCards() { const s = curStore(); if (!s) return DEF_STATUS.slice(); try { const a = JSON.parse(s.get('tongpin-status') || '[]'); return a.length ? a : DEF_STATUS.slice(); } catch (e) { return DEF_STATUS.slice(); } }
  function tpSave(a) { const s = curStore(); if (s) try { s.set('tongpin-status', JSON.stringify(a)); } catch (e) {} }
  // 状态池：用户自定义 + TA 日常 action 字卡（在做什么）合并去重，接入字卡库
  function tpPool() {
    const s = curStore(); let pool = libPool('sync', 'TA 此刻', DEF_STATUS);
    try { const a = JSON.parse((s && s.get('tongpin-status')) || '[]'); if (Array.isArray(a) && a.length) pool = a.slice(); } catch (e) {}
    try { const a = JSON.parse((s && s.get('checkin-cards-action')) || '[]'); if (Array.isArray(a)) a.forEach(x => { const t = typeof x === 'string' ? x : (x && x.t); if (t && pool.indexOf(t) < 0) pool.push(t); }); } catch (e) {}
    return pool.length ? pool : DEF_STATUS.slice();
  }
  function tpPick() { const a = tpPool(); const el = document.getElementById('tp-status'); if (el) el.textContent = a[Math.floor(Math.random() * a.length)]; }
  let knock = 0, knockTimer = null;
  function tpResetKnock() { knock = 0; document.querySelectorAll('#tp-knock .tp-dot').forEach(d => d.classList.remove('on')); }
  function tpKnock() {
    if (editingNow()) return;
    const dots = document.querySelectorAll('#tp-knock .tp-dot');
    if (knock < dots.length) dots[knock].classList.add('on');
    knock++;
    clearTimeout(knockTimer);
    const hint = document.getElementById('tp-hint');
    if (knock < 3) { if (hint) hint.textContent = '再敲 ' + (3 - knock) + ' 下'; knockTimer = setTimeout(tpResetKnock, 5000); return; }
    const area = document.getElementById('tp-knock-area');
    const pool = tpPool();
    // v3.32.x #132：同频字卡概率接 dcf-sync（默认 60%=原值，单值替换非叠加）
    if (Math.random() * 100 < dcfP('sync', 60)) {
      vibrate([40, 60, 40, 60, 40]);
      if (area) area.classList.add('flash');
      setTimeout(() => { if (area) area.classList.remove('flash'); }, 700);
      const r = pool[Math.floor(Math.random() * pool.length)];
      if (hint) hint.textContent = window.taFit ? window.taFit('他回你了 · ' + r) : ('他回你了 · ' + r);
      if (tpSendOn() && window.chatAddIn) { try { window.chatAddIn(r); } catch (e) {} }
    } else {
      if (Math.random() < 0.4) {
        const miss = libPool('sync', '没接住回应', ['…没听到', '没接住', '好像走开了']);
        if (hint) hint.textContent = miss[Math.floor(Math.random() * miss.length)];
      } else {
        if (hint) hint.textContent = '没接住 · 过会儿再敲';
      }
    }
    knockTimer = setTimeout(tpResetKnock, 1400);
  }
  if (tpApp) tpApp.addEventListener('click', () => { if (editingNow()) return; openPage(tpPage); });
  document.getElementById('tp-back').addEventListener('click', () => backHome(tpPage));
  // 状态自动流动：页面可见时每 20-40s 淡入淡出换一句；离开停
  let tpFlowTimer = null;
  function tpPickFade() { const el = document.getElementById('tp-status'); if (!el) { tpPick(); return; } el.classList.add('fade'); setTimeout(() => { tpPick(); el.classList.remove('fade'); }, 400); }
  function tpStartFlow() { clearTimeout(tpFlowTimer); const tick = () => { tpPickFade(); tpFlowTimer = setTimeout(tick, 20000 + Math.random() * 20000); }; tpFlowTimer = setTimeout(tick, 20000 + Math.random() * 20000); }
  function tpStopFlow() { clearTimeout(tpFlowTimer); tpFlowTimer = null; }
  new MutationObserver(() => { if (tpPage.hidden) tpStopFlow(); else { tpPick(); tpStartFlow(); } }).observe(tpPage, { attributes: true, attributeFilter: ['hidden'] });
  document.getElementById('tp-refresh').addEventListener('click', () => { if (editingNow()) return; tpPick(); });
  onLongPress(document.getElementById('tp-knock-area'), tpKnock, 350);
  document.getElementById('tp-add').addEventListener('click', () => { if (!window.openModal) return; window.openModal('添加状态字卡', '', (v) => { if (v) { const a = tpCards(); a.push(v); tpSave(a); toast('已添加'); } }); });
  function tpSendOn() { const s = curStore(); try { return s.get('tongpin-send-chat') !== '0'; } catch (e) { return true; } }
  const tpSendBtn = document.getElementById('tp-send');
  if (tpSendBtn) { tpSendBtn.textContent = '发到聊天：' + (tpSendOn() ? '开' : '关'); tpSendBtn.addEventListener('click', () => { const s = curStore(); const on = !tpSendOn(); if (s) try { s.set('tongpin-send-chat', on ? '1' : '0'); } catch (e) {} tpSendBtn.textContent = '发到聊天：' + (on ? '开' : '关'); }); }

  // ---- 伸手页 ----
  const DEF_WHISPER = ['被你抓到了', '嗯，在', '刚路过你', '我在', '摸到了吧', '没走远'];
  const ssPage = document.createElement('div');
  ssPage.className = 'page'; ssPage.id = 'page-shenshou'; ssPage.hidden = true;
  ssPage.innerHTML =
    '<div class="chat-head"><span class="ch-back" id="ss-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="ch-name">伸手</span></div>' +
    '<div class="ss-body">' +
      '<div class="ss-area" id="ss-area"><div class="ss-glow" id="ss-glow"></div><div class="ss-hint" id="ss-hint">长按 · 伸手去摸身边</div></div>' +
      '<div class="ss-result" id="ss-result"></div>' +
      '<div class="ss-count" id="ss-count">摸到 0 次</div>' +
      '<button class="ss-add" id="ss-add">+ 添加悄悄话字卡</button><button class="ss-send-btn" id="ss-send">发到聊天：开</button>' +
    '</div>';
  host.appendChild(ssPage);

  function ssCards() { const s = curStore(); if (!s) return libPool('reach', '悄悄话', DEF_WHISPER); try { const a = JSON.parse(s.get('shenshou-cards') || '[]'); return a.length ? a : libPool('reach', '悄悄话', DEF_WHISPER); } catch (e) { return libPool('reach', '悄悄话', DEF_WHISPER); } }
  function ssSave(a) { const s = curStore(); if (s) try { s.set('shenshou-cards', JSON.stringify(a)); } catch (e) {} }
  function ssCount() { const s = curStore(); if (!s) return 0; try { return parseInt(s.get('shenshou-count') || '0', 10) || 0; } catch (e) { return 0; } }
  function ssSetCount(n) { const s = curStore(); if (s) try { s.set('shenshou-count', '' + n); } catch (e) {} }
  function ssRenderCount() { const el = document.getElementById('ss-count'); if (el) el.textContent = '摸到 ' + ssCount() + ' 次'; }
  const SS_FEEL = [
    { label: '温热', vib: [80], cls: 'hot', cards: ['好暖', '嗯，在', '靠着你', '体温'] },
    { label: '微凉', vib: [30], cls: 'cold', cards: ['有点凉', '刚吹过风', '指尖凉'] },
    { label: '发丝', vib: [10, 20, 10], cls: 'soft', cards: ['痒痒的', '发丝擦过', '轻轻的'] }
  ];
  function ssSendOn() { const s = curStore(); try { return s.get('shenshou-send-chat') !== '0'; } catch (e) { return true; } }
  function ssTry() {
    if (editingNow()) return;
    const hint = document.getElementById('ss-hint'); if (hint) hint.textContent = '正在伸手…';
    const glow = document.getElementById('ss-glow'); if (glow) glow.classList.add('reach');
    setTimeout(() => {
      if (glow) glow.classList.remove('reach');
      // v3.32.x #132：伸手字卡概率接 dcf-reach（默认 55%=原值，单值替换非叠加）
      if (Math.random() * 100 < dcfP('reach', 55)) {
        const feel = SS_FEEL[Math.floor(Math.random() * SS_FEEL.length)];
        const cards = libPool('reach', '触感·' + feel.label, feel.cards).concat(ssCards());
        const txt = cards[Math.floor(Math.random() * cards.length)];
        vibrate(feel.vib);
        if (glow) { glow.classList.add('on'); glow.classList.add(feel.cls); }
        if (hint) hint.textContent = '摸到了 · ' + feel.label;
        const res = document.getElementById('ss-result'); if (res) { res.textContent = feel.label + ' · \u201c' + txt + '\u201d'; res.className = 'ss-result reach'; }
        ssSetCount(ssCount() + 1); ssRenderCount();
        if (ssSendOn() && window.chatAddIn) { try { window.chatAddIn(txt); } catch (e) {} }
        setTimeout(() => { if (glow) { glow.classList.remove('on'); glow.classList.remove(feel.cls); } }, 1400);
      } else {
        if (glow) glow.classList.add('dim');
        if (hint) hint.textContent = '什么都没有';
        const res = document.getElementById('ss-result'); if (res) { res.textContent = '…'; res.className = 'ss-result miss'; }
        setTimeout(() => { if (glow) glow.classList.remove('dim'); }, 1200);
      }
    }, 700);
  }
  // 他主动碰你：进页面时按概率 / 久未进去后高概率，留一道光痕 + 一句悄悄话
  function ssMaybePassive() {
    const s = curStore(); if (!s) return;
    let last = 0; try { last = parseInt(s.get('shenshou-last-visit') || '0', 10) || 0; } catch (e) {}
    const gap = Date.now() - last;
    try { s.set('shenshou-last-visit', '' + Date.now()); } catch (e) {}
    const prob = gap > 6 * 3600000 ? 0.7 : 0.25;
    if (Math.random() >= prob) return;
    const cards = ssCards();
    const txt = cards[Math.floor(Math.random() * cards.length)];
    vibrate(30);
    const area = document.getElementById('ss-area');
    if (area) { const tr = document.createElement('div'); tr.className = 'ss-trace'; area.appendChild(tr); setTimeout(() => { try { tr.remove(); } catch (e) {} }, 1600); }
    const hint = document.getElementById('ss-hint'); if (hint) hint.textContent = window.taFit ? window.taFit('他刚才碰了你一下') : '他刚才碰了你一下';
    const res = document.getElementById('ss-result'); if (res) { res.textContent = '\u201c' + txt + '\u201d'; res.className = 'ss-result reach'; }
  }
  if (ssApp) ssApp.addEventListener('click', () => { if (editingNow()) return; openPage(ssPage); ssRenderCount(); ssMaybePassive(); });
  document.getElementById('ss-back').addEventListener('click', () => backHome(ssPage));
  onLongPress(document.getElementById('ss-area'), ssTry, 500);
  document.getElementById('ss-add').addEventListener('click', () => { if (!window.openModal) return; window.openModal('添加悄悄话字卡', '', (v) => { if (v) { const a = ssCards(); a.push(v); ssSave(a); toast('已添加'); } }); });
  const ssSendBtn = document.getElementById('ss-send');
  if (ssSendBtn) { ssSendBtn.textContent = '发到聊天：' + (ssSendOn() ? '开' : '关'); ssSendBtn.addEventListener('click', () => { const s = curStore(); const on = !ssSendOn(); if (s) try { s.set('shenshou-send-chat', on ? '1' : '0'); } catch (e) {} ssSendBtn.textContent = '发到聊天：' + (on ? '开' : '关'); }); }

  // ---- 喝水页 ----
  const DEF_WATER_MSGS = ['该喝水了', '别忘了喝水', '喝口水吧', '你今天水喝够了吗'];
  const DEF_WATER_PRAISE = ['今天喝够啦', '真棒', '完成了', '好乖'];
  const DEF_WATER_ENCOURAGE = ['再来一杯', '继续', '嗯', '快了'];
  const DEF_WATER_TA = ['TA 说：{m}', 'TA 让我提醒你：{m}', 'TA 念着：{m}', 'TA 托我带句话：{m}'];
  // 世界观：他视角提醒（灵体在身边，字卡语态）；偶尔出得不准配温柔解读
  const DEF_WATER_TA_GENTLE = ['水凉了，喝一口？', '你忘了吧，喝一口', '我在呢，先喝口水', '嗯，去喝一口好不好', '别忙忘了喝水'];
  // v3.14.x：梦角催喝水兜底池（同 default-cards-data.js「梦角催喝水」分组，
  // 正常走 libPool('water','梦角催喝水') 同源+逐张开关，数据缺失才用这里）
  const DEF_WATER_CHAT_REMIND = ['该喝水啦，我看着你呢', '去喝口水吧，我在这儿等你回来', '半天没听见你倒水的声音了', '杯子是不是空了很久了？', '别光顾着忙，润润嗓子好不好', '水就放在手边，伸伸手就够到了'];
  const waterPage = document.createElement('div');
  waterPage.className = 'page'; waterPage.id = 'page-water'; waterPage.hidden = true;
  waterPage.innerHTML =
    '<div class="chat-head"><span class="ch-back" id="water-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="ch-name">喝水</span></div>' +
    '<div class="water-body">' +
      '<div class="water-card glass">' +
        '<div class="water-num" id="water-num">0</div>' +
        '<div class="water-unit" id="water-unit">0 杯 · 0 ml / <span id="water-goal-text">8</span> 杯</div>' +
        '<div class="water-bar"><div class="water-fill" id="water-fill"></div></div>' +
        '<div class="water-cups" id="water-cups"></div>' +
      '</div>' +
      '<div class="water-week" id="water-week"></div>' +
      '<div class="water-streak" id="water-streak"></div>' +
      '<div class="water-btns"><button class="water-minus" id="water-minus">−1</button><button class="water-plus" id="water-plus">+1</button></div>' +
      '<div class="water-msg glass" id="water-msg">点 +1 记一杯</div>' +
      '<div class="water-actions">' +
        '<button class="water-send" id="water-send">发到聊天</button>' +
        '<button class="water-ta" id="water-ta">' + (window.taFit ? window.taFit('TA 提醒') : 'TA 提醒') + '</button>' +
      '</div>' +
      '<div class="water-manage"><button class="water-set-goal" id="water-set-goal">设目标</button><button class="water-set-size" id="water-set-size">单次量</button><button class="water-add-msg" id="water-add-msg">+ 提醒字卡</button></div>' +
    '</div>';
  host.appendChild(waterPage);

  function waterDayStr(offset) { const d = new Date(); if (offset) d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function waterToday() { const s = curStore(); if (!s) return { date: '', count: 0 }; try { const o = JSON.parse(s.get('water-today') || '{}'); const today = waterDayStr(0); if (o.date !== today) return { date: today, count: 0 }; return { date: today, count: o.count || 0 }; } catch (e) { return { date: '', count: 0 }; } }
  function waterHistory() { const s = curStore(); if (!s) return {}; try { return JSON.parse(s.get('water-history') || '{}') || {}; } catch (e) { return {}; } }
  function waterSave(count) {
    const s = curStore(); if (!s) return;
    const today = waterDayStr(0);
    try { s.set('water-today', JSON.stringify({ date: today, count: count })); } catch (e) {}
    try {
      const h = waterHistory(); h[today] = count;
      const keys = Object.keys(h).sort();
      while (keys.length > 15) { delete h[keys.shift()]; }
      s.set('water-history', JSON.stringify(h));
    } catch (e) {}
    try {
      const g = waterGoal();
      let st = null; try { st = JSON.parse(s.get('water-streak') || 'null'); } catch (e) {}
      const y = waterDayStr(-1);
      if (count >= g) {
        if (st && st.date === y) st = { date: today, n: (st.n || 0) + 1 };
        else if (st && st.date === today) { /* 今日已记 */ }
        else st = { date: today, n: 1 };
        s.set('water-streak', JSON.stringify(st));
      } else if (st && st.date === today) {
        s.set('water-streak', JSON.stringify({ date: y, n: Math.max(0, (st.n || 1) - 1) }));
      }
    } catch (e) {}
  }
  function waterGoal() { const s = curStore(); try { return parseInt(s.get('water-goal') || '8', 10) || 8; } catch (e) { return 8; } }
  function waterSetGoal(n) { const s = curStore(); if (s) try { s.set('water-goal', '' + n); } catch (e) {} }
  function waterSize() { const s = curStore(); try { return parseInt(s.get('water-size') || '250', 10) || 250; } catch (e) { return 250; } }
  function waterSetSize(n) { const s = curStore(); if (s) try { s.set('water-size', '' + n); } catch (e) {} }
  function waterMsgs() { const s = curStore(); if (!s) return libPool('water', '提醒模板', DEF_WATER_MSGS); try { const a = JSON.parse(s.get('water-msgs') || '[]'); return a.length ? a : libPool('water', '提醒模板', DEF_WATER_MSGS); } catch (e) { return libPool('water', '提醒模板', DEF_WATER_MSGS); } }
  function waterSaveMsgs(a) { const s = curStore(); if (s) try { s.set('water-msgs', JSON.stringify(a)); } catch (e) {} }
  function waterRender() {
    const t = waterToday(); const g = waterGoal(); const sz = waterSize();
    const el = document.getElementById('water-num'); if (el) el.textContent = t.count;
    const gt = document.getElementById('water-goal-text'); if (gt) gt.textContent = g;
    const unit = document.getElementById('water-unit'); if (unit) unit.textContent = t.count + ' 杯 · ' + (t.count * sz) + ' ml / ' + g + ' 杯 · ' + (g * sz) + ' ml';
    const fill = document.getElementById('water-fill'); if (fill) fill.style.width = Math.min(100, t.count / g * 100) + '%';
    waterRenderCups(t.count, g);
    waterRenderWeek();
    waterRenderStreak();
    waterSave(t.count);
  }
  function waterRenderCups(count, goal) {
    const box = document.getElementById('water-cups'); if (!box) return;
    const max = Math.max(1, Math.min(goal, 8));
    let html = '';
    for (let i = 0; i < max; i++) html += '<i class="water-cup' + (i < count ? ' on' : '') + '"></i>';
    box.innerHTML = html;
  }
  function waterRenderWeek() {
    const box = document.getElementById('water-week'); if (!box) return;
    const h = waterHistory(); const g = waterGoal(); const today = waterDayStr(0);
    let html = '';
    for (let i = 6; i >= 0; i--) {
      const ds = waterDayStr(-i);
      const c = h[ds] || 0;
      const pct = g ? Math.min(100, Math.round(c / g * 100)) : 0;
      const todayCls = ds === today ? ' today' : '';
      const hitCls = c > 0 ? (c >= g ? ' hit' : ' ok') : ' miss';
      const taMark = (function () { const ss = curStore(); return ss && ss.get('water-ta-mark:' + ds) === '1'; })();
      const taCls = taMark ? ' ta' : '';
      html += '<div class="water-col' + todayCls + hitCls + taCls + '"><i style="height:' + pct + '%"></i><b>' + (c || '') + '</b><em>' + ds.slice(8) + '</em></div>';
    }
    box.innerHTML = '<div class="water-week-title">近 7 天</div><div class="water-week-bars">' + html + '</div>';
  }
  function waterStreak() { const s = curStore(); if (!s) return null; try { return JSON.parse(s.get('water-streak') || 'null'); } catch (e) { return null; } }
  function waterRenderStreak() {
    const el = document.getElementById('water-streak'); if (!el) return;
    const st = waterStreak();
    if (!st || st.date !== waterDayStr(0) || !st.n) { el.textContent = ''; return; }
    el.textContent = '🔥 连续达标 ' + st.n + ' 天';
  }
  function waterShowMsg(txt) { const el = document.getElementById('water-msg'); if (el) { el.classList.add('fade'); setTimeout(() => { el.textContent = '\u201c' + txt + '\u201d'; el.classList.remove('fade'); }, 200); } }
  // v3.14.x：梦角催喝水——从「梦角催喝水」预设池抽一张字卡直接发进聊天
  //（chatAddIn 自带未读数 +1 与桌面横幅/后台系统通知联动，不在聊天页也能被提醒）。
  // v2（按用户反馈）：不再强绑打卡进度——懒得打卡也照常来催；
  //   进度尾巴只在「今天记过杯数且确实没喝够」时才附（count>0 且 count<goal），
  //   一口没记时不妄下判断；已打卡达标则改发喝够夸奖、概率降到 1/4 不打扰。
  //   「梦角催喝水」整组逐张关光 = 明确不想被打扰，直接不发（不回退兜底池）。
  function waterChatDone() { const g = waterGoal(); const t = waterToday(); return !!g && t.count >= g; }
  function waterChatGroupAllOff() {
    try {
      const grp = ((window.DEFAULT_CARD_DATA && window.DEFAULT_CARD_DATA.water) || []).find(g => g[0] === '梦角催喝水');
      if (!grp || !Array.isArray(grp[1]) || !grp[1].length || !window.isDefaultCardOff) return false;
      return grp[1].every(c => window.isDefaultCardOff('water', c));
    } catch (e) { return false; }
  }
  function waterTaChatSend() {
    if (waterChatGroupAllOff()) return false;
    const t = waterToday(); const g = waterGoal();
    const done = waterChatDone();
    const pool = libPool('water', done ? '喝够夸奖' : '梦角催喝水', done ? DEF_WATER_PRAISE : DEF_WATER_CHAT_REMIND);
    const m = pool[Math.floor(Math.random() * pool.length)];
    const tail = (!done && g && t.count > 0 && t.count < g) ? '（还差 ' + (g - t.count) + ' 杯）' : '';
    const text = window.taFit ? window.taFit(m + tail) : (m + tail);
    // v3.14.x：带「喝水提醒」标签 chip（addIn opts.tag），来源可辨识
    try { if (window.chatAddIn) { window.chatAddIn(text, { tag: '喝水提醒' }); return true; } } catch (e) {}
    return false;
  }
  // 概率触发入口——应用在前台期间每 8 分钟掷一次骰子：
  // 页面可见 + 频率控制（冷却 50 分钟 / 每日最多 4 次，taChime 统一管）
  // + 基础 22% 概率（清晨 6-9 点 15%、其余白天 22%；23:00-06:00 静默期直接不发，深更半夜不吵人）；
  // 已打卡达标只按 1/4 概率改发夸奖（偶尔来夸一句不打扰）。实际节奏≈活跃
  // 半小时内第一催、之后至少隔 50 分钟一条、一天最多 4 条。
  // 打开喝水页时 waterMaybeRemind 里还有一次独立判定。
  // 暴露 window.waterChimeTick 供专项验证手动驱动。
  window.waterChimeTick = function () {
    if (document.hidden || editingNow()) return;
    const h = new Date().getHours();
    if (h >= 23 || h < 6) return; // v3.26.x：23:00-06:00 静默期整天休息，不催喝水
    const base = h < 6 ? 0.08 : (h < 9 ? 0.15 : 0.22);
    const p = waterChatDone() ? base * 0.25 : base;
    if (Math.random() >= p) return;
    // v3.32.x #132：定时催水字卡概率接 dcf-water（默认 100=原节奏，0 即彻底不来聊天催水）
    if (!dcfHit('water')) return;
    if (!(window.taChimeAllow && window.taChimeAllow('water-chat', { cooldown: 50 * 60 * 1000, dailyMax: 4 }))) return;
    window.taChimeUse('water-chat');
    waterTaChatSend();
  };
  setInterval(window.waterChimeTick, 8 * 60 * 1000);
  function waterMaybeRemind() {
    const h = new Date().getHours(); if (h >= 23 || h < 6) return; // v3.26.x：23:00-06:00 静默期，进页面也不催
    const s = curStore(); if (!s) return;
    let last = 0; try { last = parseInt(s.get('water-last-visit') || '0', 10) || 0; } catch (e) {}
    try { s.set('water-last-visit', '' + Date.now()); } catch (e) {}
    const t = waterToday(); const g = waterGoal();
    if (t.count < g && Date.now() - last > 2 * 3600000) {
      // 世界观：偶尔他视角浮层（灵体在身边提醒），否则原系统语态
      // v3.32.x #132：喝水字卡概率接 dcf-water（默认 100=原节奏乘法门控，0 即不来）
      if (window.taChimeAllow && window.taChimeAllow('water-ta', { cooldown: 30 * 60 * 1000, dailyMax: 3 }) && dcfHit('water') && Math.random() < 0.5) {
        window.taChimeUse('water-ta');
        const gentle = libPool('water', 'ta视角温柔提醒', DEF_WATER_TA_GENTLE);
        const m = gentle[Math.floor(Math.random() * gentle.length)];
        const miss = Math.random() < 0.2 ? '（字卡有限，他想说的比这张多）' : null;
        if (window.taChimeShow) window.taChimeShow(m, { miss: miss });
      }
      const msgs = waterMsgs(); waterShowMsg(msgs[Math.floor(Math.random() * msgs.length)]);
    }
    // v3.14.x v2：进入页面距上次 >2 小时时独立判定一次聊天催水（独立频率键
    // water-chat，与前台定时掷骰共用冷却/每日上限，同一时段不会连发两条）——
    // 不再要求「未打卡达标」（懒得打卡也照常来催）；已达标降为约 1/4 概率改发夸奖
    if (Date.now() - last > 2 * 3600000) {
      const wp = waterChatDone() ? 0.09 : 0.35;
      // v3.32.x #132：聊天催水字卡概率接 dcf-water（默认 100=原节奏乘法门控，0 即不来）
      if (!waterChatGroupAllOff() && dcfHit('water') && window.taChimeAllow && window.taChimeAllow('water-chat', { cooldown: 50 * 60 * 1000, dailyMax: 4 }) && Math.random() < wp) {
        window.taChimeUse('water-chat');
        waterTaChatSend();
      }
    }
    // 世界观：他替你记的那杯——每天低概率生成一个标记，柱状图上叠半透明格
    waterMaybeTaMark();
  }
  function waterMaybeTaMark() {
    if (!window.taChimeAllow || !window.taChimeAllow('water-ta-mark', { cooldown: 24 * 3600 * 1000, dailyMax: 1 })) return;
    if (Math.random() > 0.4) return;
    window.taChimeUse('water-ta-mark');
    const s = curStore(); if (!s) return;
    try { s.set('water-ta-mark:' + waterDayStr(0), '1'); } catch (e) {}
  }
  // 暴露给 calendar.js：该日期是否有喝水记录（日历打点）
  window.waterDayHas = function (ds) { try { const h = waterHistory(); return (h[ds] || 0) > 0; } catch (e) { return false; } };
  if (waterApp) waterApp.addEventListener('click', () => { if (editingNow()) return; openPage(waterPage); waterRender(); waterMaybeRemind(); });
  document.getElementById('water-back').addEventListener('click', () => backHome(waterPage));
  document.getElementById('water-plus').addEventListener('click', () => {
    if (editingNow()) return;
    const t = waterToday(); const g = waterGoal(); const n = t.count + 1;
    const justDone = t.count < g && n >= g;
    waterSave(n); waterRender();
    if (justDone) {
      vibrate([60, 40, 60]);
      const card = document.querySelector('#page-water .water-card');
      if (card) { card.classList.add('done'); setTimeout(() => card.classList.remove('done'), 900); }
      const p = libPool('water', '喝够夸奖', DEF_WATER_PRAISE); waterShowMsg(p[Math.floor(Math.random() * p.length)]);
    }
    else if (Math.random() < 0.2) { const e = libPool('water', '继续鼓励', DEF_WATER_ENCOURAGE); waterShowMsg(e[Math.floor(Math.random() * e.length)]); }
  });
  document.getElementById('water-minus').addEventListener('click', () => {
    if (editingNow()) return;
    const t = waterToday(); if (t.count <= 0) return; waterSave(t.count - 1); waterRender();
  });
  document.getElementById('water-send').addEventListener('click', () => {
    if (editingNow()) return;
    const t = waterToday(); const g = waterGoal(); const sz = waterSize();
    const done = t.count >= g;
    const base = '你今天喝了 ' + t.count + ' / ' + g + ' 杯（' + (t.count * sz) + 'ml）';
    const praise = libPool('water', '喝够夸奖', DEF_WATER_PRAISE);
    const tail = done ? '，' + praise[Math.floor(Math.random() * praise.length)] : '，还差 ' + (g - t.count) + ' 杯';
    if (window.chatAddIn) { try { window.chatAddIn(base + tail); } catch (e) {} }
    toast('已发送');
  });
  document.getElementById('water-ta').addEventListener('click', () => {
    if (editingNow()) return;
    const t = waterToday(); const g = waterGoal();
    const m = waterMsgs()[Math.floor(Math.random() * waterMsgs().length)];
    const taFmt = libPool('water', 'TA 提醒句式', DEF_WATER_TA);
    const fmt = taFmt[Math.floor(Math.random() * taFmt.length)].replace('{m}', m);
    const tail = t.count < g ? '（还差 ' + (g - t.count) + ' 杯）' : '（今天喝够啦）';
    const shown = window.taFit ? window.taFit(fmt + tail) : (fmt + tail);
    waterShowMsg(shown);
    // v3.14.x：手动「让TA提醒」同样带标签 chip
    if (window.chatAddIn) { try { window.chatAddIn(fmt + tail, { tag: '喝水提醒' }); } catch (e) {} }
  });
  document.getElementById('water-set-goal').addEventListener('click', () => { if (!window.openModal) return; window.openModal('设目标（杯）', String(waterGoal()), (v) => { if (v) { const n = parseInt(v, 10); if (n > 0 && n < 100) { waterSetGoal(n); waterRender(); toast('已设置'); } } }); });
  document.getElementById('water-set-size').addEventListener('click', () => { if (!window.openModal) return; window.openModal('单次容量（ml）', String(waterSize()), (v) => { if (v) { const n = parseInt(v, 10); if (n > 0 && n < 2000) { waterSetSize(n); waterRender(); toast('已设置'); } } }); });
  document.getElementById('water-add-msg').addEventListener('click', () => { if (!window.openModal) return; window.openModal('添加提醒字卡', '', (v) => { if (v) { const a = waterMsgs(); a.push(v); waterSaveMsgs(a); toast('已添加'); } }); });

  // ---- 吃什么页 ----
  const DEF_EAT_DISHES = ['番茄炒蛋', '红烧肉', '清蒸鱼', '麻婆豆腐', '宫保鸡丁', '酸辣土豆丝', '蛋炒饭', '牛肉面', '饺子', '馄饨', '皮蛋瘦肉粥', '可乐鸡翅', '糖醋排骨', '清炒时蔬', '蛋花汤', '凉拌黄瓜', '回锅肉', '水煮肉片', '鱼香肉丝', '葱油拌面'];
  const DEF_EAT_COMMENTS = ['就吃这个吧', '听起来不错', '我想吃这个', '可以', '这个好吃', '嗯，就这个', '想吃'];
  const EAT_ASK_MSGS = ['今晚吃 {0} 怎么样？', '{0}，想吃吗？', '要不要吃 {0}？', '今天吃 {0} 好不好？'];
  const eatPage = document.createElement('div');
  eatPage.className = 'page'; eatPage.id = 'page-eat'; eatPage.hidden = true;
  eatPage.innerHTML =
    '<div class="chat-head"><span class="ch-back" id="eat-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="ch-name">吃什么</span></div>' +
    '<div class="eat-body">' +
      '<div class="eat-cur-bar"><span class="eat-cur-label">当前菜单</span><span class="eat-cur-name" id="eat-cur-name">…</span><button class="eat-switch-menu" id="eat-switch-menu">切换菜单</button></div>' +
      '<div class="eat-wheel-wrap"><canvas class="eat-wheel" id="eat-wheel"></canvas><div class="eat-pointer" id="eat-pointer"><svg viewBox="0 0 20 20" width="20" height="20"><polygon points="10,18 3,2 17,2" fill="#e8533d"/></svg></div></div>' +
      '<div class="eat-card glass"><div class="eat-label">今天吃</div><div class="eat-dish" id="eat-dish">…</div><div class="eat-comment" id="eat-comment">…</div></div>' +
      '<div class="eat-btns"><button class="eat-change" id="eat-change">换一个</button><button class="eat-send" id="eat-send">发到聊天</button></div>' +
      '<div class="eat-btns"><button class="eat-spin" id="eat-spin">转盘抽取</button><button class="eat-askta" id="eat-askta">问 TA</button></div>' +
      '<div class="eat-history" id="eat-history"></div>' +
      '<div class="eat-mgr"><button class="eat-add" id="eat-add">+ 添加菜名</button><button class="eat-menu-btn" id="eat-menu-btn">编辑菜单</button></div>' +
      '<div class="eat-mgr"><button class="eat-menu-btn" id="eat-remind-toggle">TA 提醒：开</button><button class="eat-menu-btn" id="eat-remind-prob">触发概率 2%</button></div>' +
      '<div class="eat-menu-panel" id="eat-menu-panel" hidden>' +
        '<div class="eat-menu-chips" id="eat-menu-chips"></div>' +
        '<div class="eat-menu-ops"><button class="eat-menu-op" id="eat-menu-new">+ 新建</button><button class="eat-menu-op" id="eat-menu-rename">重命名</button><button class="eat-menu-op" id="eat-menu-del">删除</button></div>' +
        '<textarea class="eat-menu-ta" id="eat-menu-ta" rows="8" placeholder="一行一个菜名，至少 2 道"></textarea>' +
        '<div class="eat-menu-acts"><button class="eat-menu-save" id="eat-menu-save">保存菜单</button><button class="eat-menu-reset" id="eat-menu-reset">填入默认菜品</button></div>' +
      '</div>' +
      '<div class="eat-switch-overlay" id="eat-switch-overlay" hidden>' +
        '<div class="eat-switch-card glass">' +
          '<div class="eat-switch-title">切换菜单</div>' +
          '<div class="eat-switch-chips" id="eat-switch-chips"></div>' +
          '<div class="eat-switch-or">或转盘随机选</div>' +
          '<div class="eat-wheel-wrap eat-wheel-wrap-sm"><canvas class="eat-wheel" id="eat-switch-wheel"></canvas><div class="eat-pointer" id="eat-switch-pointer"><svg viewBox="0 0 20 20" width="20" height="20"><polygon points="10,18 3,2 17,2" fill="#e8533d"/></svg></div></div>' +
          '<div class="eat-switch-name" id="eat-switch-name">点下方按钮开始转</div>' +
          '<div class="eat-switch-acts"><button class="eat-switch-cancel" id="eat-switch-cancel">取消</button><button class="eat-switch-go" id="eat-switch-go">开始转</button></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  host.appendChild(eatPage);

  function eatMenu() { const s = curStore(); try { const a = JSON.parse((s && s.get('eat-menu')) || '[]'); if (Array.isArray(a) && a.length) return a.filter(d => d); } catch (e) {} return null; }
  function eatSaveMenu(a) { const s = curStore(); if (s) try { s.set('eat-menu', JSON.stringify(a)); } catch (e) {} }
  function eatHistory() { const s = curStore(); try { const a = JSON.parse((s && s.get('eat-history')) || '[]'); return Array.isArray(a) ? a.slice(-3) : []; } catch (e) {} return []; }
  function eatPushHistory(dish) { const h = eatHistory(); h.push({ d: dish, t: Date.now() }); const s = curStore(); if (s) try { s.set('eat-history', JSON.stringify(h.slice(-10))); } catch (e) {} eatRenderHistory(); }
  function eatRenderHistory() { const h = eatHistory(); const el = document.getElementById('eat-history'); if (!el) return; if (!h.length) { el.innerHTML = ''; return; } el.innerHTML = '最近吃了：' + h.map(x => '<span class="eh-tag">' + x.d + '</span>').join(''); }
  function eatSaveMenus(a) { const s = curStore(); if (s) try { s.set('eat-menus', JSON.stringify(a)); } catch (e) {} }
  function eatMenus() {
    const s = curStore();
    try { const a = JSON.parse((s && s.get('eat-menus')) || '[]'); if (Array.isArray(a) && a.length) { const out = a.filter(m => m && m.name && Array.isArray(m.dishes)).map(m => ({ name: String(m.name), dishes: m.dishes.filter(d => d) })); if (out.length) return out; } } catch (e) {}
    const oldMenu = eatMenu();
    if (oldMenu) { const migrated = [{ name: '我的菜单', dishes: oldMenu }]; eatSaveMenus(migrated); if (s) try { s.set('eat-menu', '[]'); } catch (e) {} return migrated; }
    let oldCards = []; try { const a = JSON.parse((s && s.get('eat-cards')) || '[]'); if (Array.isArray(a)) oldCards = a.filter(d => d); } catch (e) {}
    if (oldCards.length) { const pool = DEF_EAT_DISHES.slice(); oldCards.forEach(d => { if (pool.indexOf(d) < 0) pool.push(d); }); const migrated = [{ name: '我的菜单', dishes: pool }]; eatSaveMenus(migrated); if (s) try { s.set('eat-cards', '[]'); } catch (e) {} return migrated; }
    return [{ name: '默认菜单', dishes: DEF_EAT_DISHES.slice() }];
  }
  function eatCurMenuIdx() { const s = curStore(); try { const i = parseInt(s && s.get('eat-cur-idx'), 10); if (!isNaN(i) && i >= 0) return i; } catch (e) {} return 0; }
  function eatSaveCurMenuIdx(i) { const s = curStore(); if (s) try { s.set('eat-cur-idx', String(i)); } catch (e) {} }
  function eatCurMenu() { const menus = eatMenus(); let idx = eatCurMenuIdx(); if (idx >= menus.length) idx = 0; return { menus: menus, idx: idx, menu: menus[idx] }; }
  function eatDishes() { return eatCurMenu().menu.dishes.slice(); }
  function eatRenderCurName() { const el = document.getElementById('eat-cur-name'); if (el) el.textContent = eatCurMenu().menu.name; }
  let eatSpinAngle = 0; let eatSpinTimer = null; let eatSpinning = false; let eatHlIdx = -1; let eatHlTimer = null;
  const EAT_BTN_IDS = ['eat-change', 'eat-send', 'eat-spin', 'eat-askta'];
  function eatSetBtns(dis) { EAT_BTN_IDS.forEach(id => { const b = document.getElementById(id); if (b) { if (dis) b.setAttribute('disabled', ''); else b.removeAttribute('disabled'); } }); }
  function eatClearSpin() { if (eatSpinTimer) { cancelAnimationFrame(eatSpinTimer); eatSpinTimer = null; } eatSpinning = false; eatSetBtns(false); eatHlIdx = -1; if (eatHlTimer) { clearTimeout(eatHlTimer); eatHlTimer = null; } }
  function eatInitCanvas() { const c = document.getElementById('eat-wheel'); if (!c) return; const dpr = window.devicePixelRatio || 1; const size = 240; c.width = size * dpr; c.height = size * dpr; c.style.width = size + 'px'; c.style.height = size + 'px'; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
  function eatDrawWheelCore(canvas, dishes, hlIdx, angle) {
    const ctx = canvas.getContext('2d'); const dpr = window.devicePixelRatio || 1; const W = canvas.width / dpr; const cx = W / 2; const cy = W / 2; const r = cx - 4;
    const n = dishes.length; if (!n) return; const slice = (2 * Math.PI) / n;
    const colors = ['#ff6b6b','#ffa94d','#69db7c','#4dabf7','#f06595','#ffd43b','#a9e34b','#74c0fc','#e599f7','#ff922b'];
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, i * slice, (i + 1) * slice);
      const isHl = (hlIdx != null && hlIdx >= 0 && i === hlIdx);
      ctx.fillStyle = isHl ? '#fff' : colors[i % colors.length]; ctx.fill();
      ctx.strokeStyle = isHl ? colors[i % colors.length] : '#fff'; ctx.lineWidth = isHl ? 3 : 2; ctx.stroke();
      ctx.save(); ctx.rotate(i * slice + slice / 2);
      ctx.fillStyle = isHl ? colors[i % colors.length] : '#fff';
      ctx.font = 'bold 11px "PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif'; ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const maxW = r - 14; let txt = dishes[i]; let w = ctx.measureText(txt).width;
      while (w > maxW && txt.length > 2) { txt = txt.slice(0, -1); w = ctx.measureText(txt + '..').width; }
      if (txt !== dishes[i]) txt += '..';
      ctx.fillText(txt, r - 8, 0); ctx.restore();
    }
    ctx.restore(); ctx.restore();
  }
  function eatDrawWheel(dishes, hlIdx) { const c = document.getElementById('eat-wheel'); if (!c) return; eatDrawWheelCore(c, dishes, hlIdx, eatSpinAngle); }
  // #876 转盘指针在正上方（.eat-pointer top:-12px，svg 尖(10,18)朝下）＝屏幕 12 点方向＝画布角 3π/2；
  // 转过 normalized 后指针压住的扇区＝画布角 (3π/2 - normalized) 所在片。旧公式按指针在右侧 0 角
  // （2π - normalized）算，中奖片恒不在指针下＝高亮片与「今天吃」菜名和指针错开约 1/4 圈。
  function eatIdxUnderPtr(normalized, n, slice) { return Math.floor((((3 * Math.PI / 2 - normalized) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)) / slice) % n; }
  function eatSpinWheel(dishes, cb) {
    if (eatSpinning) return;
    if (!dishes.length) { toast('当前菜单是空的，先添加菜名'); return; }
    eatSpinning = true; eatSetBtns(true);
    const totalAngle = eatSpinAngle + (3 + Math.random() * 4) * Math.PI * 2 + Math.random() * Math.PI * 2;
    const startAngle = eatSpinAngle; const duration = 3200; const startTime = Date.now();
    const de = document.getElementById('eat-dish'); const flashDishes = dishes.slice();
    let flashIdx = 0; let flashTimer;
    function flashTick(t) {
      const interval = Math.max(40, Math.round(50 + t * 400));
      flashTimer = setTimeout(() => {
        if (!eatSpinning) return;
        flashIdx = (flashIdx + 1) % flashDishes.length;
        if (de) { de.classList.add('fade'); setTimeout(() => { de.textContent = flashDishes[flashIdx]; de.classList.remove('fade'); }, 80); }
        if (eatSpinning) flashTick(Math.min((Date.now() - startTime) / duration, 1));
      }, interval);
    }
    flashTick(0);
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function tick() {
      const elapsed = Date.now() - startTime; const t = Math.min(elapsed / duration, 1);
      eatSpinAngle = startAngle + (totalAngle - startAngle) * easeOutCubic(t);
      eatDrawWheel(dishes);
      if (t < 1) { eatSpinTimer = requestAnimationFrame(tick); return; }
      eatSpinTimer = null; clearTimeout(flashTimer);
      const n = dishes.length; const slice = 2 * Math.PI / n;
      const normalized = (totalAngle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const idx = eatIdxUnderPtr(normalized, dishes.length, slice);
      var ptr = document.getElementById('eat-pointer'); if (ptr) { ptr.classList.add('pop'); setTimeout(function () { ptr.classList.remove('pop'); }, 500); }
      eatHlIdx = idx; eatDrawWheel(dishes, idx); vibrate([10, 40, 10]);
      eatHlTimer = setTimeout(function () { eatHlIdx = -1; eatDrawWheel(dishes); eatHlTimer = null; eatSpinning = false; eatSetBtns(false); }, 1200);
      if (cb) cb(dishes[idx]);
    }
    eatSpinTimer = requestAnimationFrame(tick);
  }
  // ---- 切换菜单转盘（独立状态，不与主页转盘共享） ----
  let eatSwAngle = 0, eatSwTimer = null, eatSwSpinning = false, eatSwHlIdx = -1, eatSwHlTimer = null;
  function eatSwitchInitCanvas() { const c = document.getElementById('eat-switch-wheel'); if (!c) return; const dpr = window.devicePixelRatio || 1; const size = 200; c.width = size * dpr; c.height = size * dpr; c.style.width = size + 'px'; c.style.height = size + 'px'; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
  function eatSwitchDraw(names, hlIdx) { const c = document.getElementById('eat-switch-wheel'); if (!c) return; eatDrawWheelCore(c, names, hlIdx, eatSwAngle); }
  function eatSwitchClear() { if (eatSwTimer) { cancelAnimationFrame(eatSwTimer); eatSwTimer = null; } if (eatSwHlTimer) { clearTimeout(eatSwHlTimer); eatSwHlTimer = null; } eatSwSpinning = false; eatSwHlIdx = -1; }
  function eatSwitchOpen() {
    const ov = document.getElementById('eat-switch-overlay'); if (!ov) return;
    const menus = eatMenus();
    if (menus.length < 2) { toast('只有 1 个菜单，先在「编辑菜单」里新建更多菜单吧'); return; }
    eatSwitchClear(); eatSwitchInitCanvas(); ov.hidden = false; eatSwAngle = 0;
    eatSwitchDraw(menus.map(m => m.name));
    eatSwitchRenderChips();
    const nameEl = document.getElementById('eat-switch-name'); if (nameEl) nameEl.textContent = '点下方按钮开始转';
    const goBtn = document.getElementById('eat-switch-go'); if (goBtn) { goBtn.disabled = false; goBtn.textContent = '开始转'; }
  }
  // 切换浮层·直接选菜单：点 chip 立即切到指定菜单（不用转盘随机）
  function eatSwitchRenderChips() {
    const box = document.getElementById('eat-switch-chips'); if (!box) return;
    const menus = eatMenus(); const cur = eatCurMenuIdx();
    box.innerHTML = menus.map((m, i) => '<span class="eat-chip' + (i === cur ? ' on' : '') + '" data-i="' + i + '">' + eatEsc(m.name) + '</span>').join('');
  }
  function eatSwitchTo(i) {
    const menus = eatMenus(); if (i < 0 || i >= menus.length) return;
    if (i === eatCurMenuIdx()) { eatSwitchClose(); return; }
    const name = menus[i].name;
    eatSwitchClose();
    eatSaveCurMenuIdx(i); eatClearSpin();
    eatRenderCurName(); eatLastPick = eatPick(); eatRenderHistory();
    toast('已切换到「' + name + '」');
  }
  document.getElementById('eat-switch-chips').addEventListener('click', (e) => {
    const t = e.target.closest('.eat-chip'); if (!t) return;
    const i = parseInt(t.getAttribute('data-i'), 10); if (isNaN(i)) return;
    eatSwitchTo(i);
  });
  function eatSwitchClose() { eatSwitchClear(); const ov = document.getElementById('eat-switch-overlay'); if (ov) ov.hidden = true; }
  function eatSwitchSpin() {
    if (eatSwSpinning) return;
    const menus = eatMenus(); const names = menus.map(m => m.name);
    if (names.length < 2) return;
    eatSwSpinning = true;
    const goBtn = document.getElementById('eat-switch-go'); if (goBtn) goBtn.disabled = true;
    const totalAngle = eatSwAngle + (3 + Math.random() * 4) * Math.PI * 2 + Math.random() * Math.PI * 2;
    const startAngle = eatSwAngle; const duration = 3200; const startTime = Date.now();
    const nameEl = document.getElementById('eat-switch-name');
    let flashIdx = 0, flashTimer;
    function flashTick(t) {
      const interval = Math.max(40, Math.round(50 + t * 400));
      flashTimer = setTimeout(() => {
        if (!eatSwSpinning) return;
        flashIdx = (flashIdx + 1) % names.length;
        if (nameEl) { nameEl.classList.add('fade'); setTimeout(() => { nameEl.textContent = names[flashIdx]; nameEl.classList.remove('fade'); }, 80); }
        if (eatSwSpinning) flashTick(Math.min((Date.now() - startTime) / duration, 1));
      }, interval);
    }
    flashTick(0);
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function tick() {
      const elapsed = Date.now() - startTime; const t = Math.min(elapsed / duration, 1);
      eatSwAngle = startAngle + (totalAngle - startAngle) * easeOutCubic(t);
      eatSwitchDraw(names);
      if (t < 1) { eatSwTimer = requestAnimationFrame(tick); return; }
      eatSwTimer = null; clearTimeout(flashTimer);
      const n = names.length; const slice = 2 * Math.PI / n;
      const normalized = (totalAngle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const idx = eatIdxUnderPtr(normalized, names.length, slice);
      const ptr = document.getElementById('eat-switch-pointer'); if (ptr) { ptr.classList.add('pop'); setTimeout(() => ptr.classList.remove('pop'), 500); }
      eatSwHlIdx = idx; eatSwitchDraw(names, idx); vibrate([10, 40, 10]);
      if (nameEl) { nameEl.classList.add('fade'); setTimeout(() => { nameEl.textContent = names[idx]; nameEl.classList.remove('fade'); }, 200); }
      eatSwHlTimer = setTimeout(() => {
        eatSwHlIdx = -1; eatSwSpinning = false; eatSwHlTimer = null;
        eatSaveCurMenuIdx(idx); eatClearSpin();
        eatRenderCurName(); eatLastPick = eatPick(); eatRenderHistory();
        eatSwitchClose(); toast('已切换到「' + names[idx] + '」');
      }, 1200);
    }
    eatSwTimer = requestAnimationFrame(tick);
  }
  // #877 指针永远指着显示的菜：把显示菜扇区的中线转到顶部指针下（打开/「换一个」/改菜单重抽都走 eatPick
  // → 自动对齐；「转盘抽取」本身停在扇区内不需再对齐）。居中放置＝指针两侧各留半格余量，视觉最稳。
  function eatAlignWheelToDish(dish) {
    const dishes = eatDishes(); const i = dishes.indexOf(dish);
    if (i < 0) return;
    const slice = 2 * Math.PI / dishes.length;
    eatSpinAngle = ((3 * Math.PI / 2 - (i + 0.5) * slice) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    eatDrawWheel(dishes);
  }
  function eatPick() {
    const dishes = eatDishes();
    if (!dishes.length) {
      const de2 = document.getElementById('eat-dish'); const ce2 = document.getElementById('eat-comment');
      if (de2) { de2.classList.add('fade'); setTimeout(() => { de2.textContent = '空菜单，先添加菜名'; de2.classList.remove('fade'); }, 200); }
      if (ce2) { ce2.classList.add('fade'); setTimeout(() => { ce2.textContent = ''; ce2.classList.remove('fade'); }, 200); }
      return '';
    }
    const dish = dishes[Math.floor(Math.random() * dishes.length)];
    const comments = DEF_EAT_COMMENTS; const comment = comments[Math.floor(Math.random() * comments.length)];
    const de = document.getElementById('eat-dish'); const ce = document.getElementById('eat-comment');
    if (de) { de.classList.add('fade'); setTimeout(() => { de.textContent = dish; de.classList.remove('fade'); }, 200); }
    if (ce) { ce.classList.add('fade'); setTimeout(() => { ce.textContent = '\u201c' + comment + '\u201d'; ce.classList.remove('fade'); }, 200); }
    eatAlignWheelToDish(dish);
    return dish + ' · ' + comment;
  }
  let eatLastPick = '';
  if (eatApp) eatApp.addEventListener('click', () => { if (editingNow()) return; eatClearSpin(); eatInitCanvas(); openPage(eatPage); eatRenderCurName(); eatLastPick = eatPick(); eatRenderHistory(); eatRenderRemind(); eatRemindSweep(); });
  document.getElementById('eat-back').addEventListener('click', () => { eatClearSpin(); backHome(eatPage); });
  (function () {
    var de = document.getElementById('eat-dish'); if (!de) return;
    var pressTimer = null;
    de.addEventListener('touchstart', function (e) { if (e.touches.length > 1) return; pressTimer = setTimeout(function () { rmDish(); }, 600); }, { passive: true });
    de.addEventListener('touchend', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    de.addEventListener('touchmove', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true }); // #721 同上，被动化
    de.addEventListener('mousedown', function () { pressTimer = setTimeout(function () { rmDish(); }, 600); });
    de.addEventListener('mouseup', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    de.addEventListener('mouseleave', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    function rmDish() {
      pressTimer = null; if (eatSpinning) return;
      var de2 = document.getElementById('eat-dish'); var curDish = de2 ? de2.textContent : '';
      if (!curDish || curDish === '…') return;
      if (!window.openModal) return;
      window.openModal('删除菜名', '', function (v) {
        if (!v) return;
        const cur = eatCurMenu(); const i = cur.menu.dishes.indexOf(curDish);
        if (i < 0) { toast('当前菜单里没有「' + curDish + '」'); return; }
        if (cur.menu.dishes.length <= 1) { toast('菜单至少留 1 道菜，未删除'); return; }
        cur.menu.dishes.splice(i, 1); cur.menus[cur.idx] = cur.menu; eatSaveMenus(cur.menus);
        eatDrawWheel(eatDishes()); eatLastPick = eatPick(); eatRenderHistory(); toast('已移除');
      }, { noInput: true, staticText: '要从当前菜单移除「' + curDish + '」吗？' });
    }
  })();
  document.getElementById('eat-change').addEventListener('click', () => { if (editingNow() || eatSpinning) return; eatLastPick = eatPick(); eatDrawWheel(eatDishes()); });
  document.getElementById('eat-send').addEventListener('click', () => { if (editingNow() || eatSpinning) return; if (eatLastPick && window.chatAddIn) { try { window.chatAddIn(eatLastPick); } catch (e) {} toast('已发送'); } });
  document.getElementById('eat-add').addEventListener('click', () => { if (!window.openModal) return; window.openModal('添加菜名', '', (v) => { if (!v) return; const cur = eatCurMenu(); if (cur.menu.dishes.indexOf(v) >= 0) { toast('当前菜单已有「' + v + '」'); return; } cur.menu.dishes.push(v); cur.menus[cur.idx] = cur.menu; eatSaveMenus(cur.menus); eatDrawWheel(eatDishes()); toast('已添加到「' + cur.menu.name + '」'); }); });
  document.getElementById('eat-spin').addEventListener('click', () => { if (editingNow() || eatSpinning) return; const dishes = eatDishes(); eatSpinWheel(dishes, (dish) => { const de = document.getElementById('eat-dish'); if (de) { de.classList.add('fade'); setTimeout(() => { de.textContent = dish; de.classList.remove('fade'); }, 200); } const ce = document.getElementById('eat-comment'); const comments = DEF_EAT_COMMENTS; const comment = comments[Math.floor(Math.random() * comments.length)]; if (ce) { ce.classList.add('fade'); setTimeout(() => { ce.textContent = '\u201c' + comment + '\u201d'; ce.classList.remove('fade'); }, 200); } eatLastPick = dish + ' · ' + comment; eatPushHistory(dish); }); });
  document.getElementById('eat-askta').addEventListener('click', () => { if (editingNow() || eatSpinning) return; if (!eatLastPick) { eatLastPick = eatPick(); } if (!eatLastPick) { toast('当前菜单是空的，先添加菜名'); return; } const m = eatLastPick.match(/^(.+?) ·/); const dish = m ? m[1] : eatLastPick; const msg = EAT_ASK_MSGS[Math.floor(Math.random() * EAT_ASK_MSGS.length)].replace('{0}', dish); if (window.chatSendMsg) { try { window.chatSendMsg(msg); } catch (e) {} toast('已发送'); } });
  let eatEditIdx = 0;
  function eatEsc(s) { return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
  function eatRenderMenuChips() {
    const box = document.getElementById('eat-menu-chips'); if (!box) return;
    const menus = eatMenus();
    box.innerHTML = menus.map((m, i) => '<span class="eat-chip' + (i === eatEditIdx ? ' on' : '') + '" data-i="' + i + '">' + eatEsc(m.name) + '</span>').join('');
  }
  function eatEditFill() {
    const menus = eatMenus(); if (eatEditIdx >= menus.length) eatEditIdx = 0;
    const ta = document.getElementById('eat-menu-ta'); if (ta) ta.value = menus[eatEditIdx].dishes.join('\n');
    eatRenderMenuChips();
  }
  document.getElementById('eat-menu-btn').addEventListener('click', () => {
    const panel = document.getElementById('eat-menu-panel');
    if (panel.hidden) { eatEditIdx = eatCurMenuIdx(); eatEditFill(); panel.hidden = false; } else { panel.hidden = true; }
  });
  document.getElementById('eat-menu-save').addEventListener('click', () => {
    const ta = document.getElementById('eat-menu-ta'); const lines = ta.value.split('\n').map(s => s.trim()).filter(s => s);
    if (lines.length < 1) { toast('至少输入 1 个菜名'); return; }
    const menus = eatMenus(); if (eatEditIdx >= menus.length) eatEditIdx = 0;
    menus[eatEditIdx].dishes = lines; eatSaveMenus(menus);
    if (eatEditIdx === eatCurMenuIdx()) { eatDrawWheel(eatDishes()); eatLastPick = eatPick(); }
    toast('「' + menus[eatEditIdx].name + '」已保存（' + lines.length + ' 道）');
  });
  document.getElementById('eat-menu-reset').addEventListener('click', () => {
    const ta = document.getElementById('eat-menu-ta'); if (ta) ta.value = DEF_EAT_DISHES.join('\n');
    toast('已填入默认 ' + DEF_EAT_DISHES.length + ' 道菜，点「保存菜单」生效');
  });
  document.getElementById('eat-menu-chips').addEventListener('click', (e) => {
    const t = e.target.closest('.eat-chip'); if (!t) return;
    eatEditIdx = parseInt(t.getAttribute('data-i'), 10) || 0; eatEditFill();
  });
  document.getElementById('eat-menu-new').addEventListener('click', () => {
    if (!window.openModal) return;
    window.openModal('新建菜单', '', (v) => {
      if (!v) return; const menus = eatMenus();
      if (menus.some(m => m.name === v)) { toast('已有同名菜单'); return; }
      menus.push({ name: v, dishes: [] }); eatSaveMenus(menus);
      eatEditIdx = menus.length - 1; eatEditFill(); toast('已新建「' + v + '」（空菜单，可在下方添加菜名）');
    }, { placeholder: '如：家常菜 / 外卖 / 夜宵' });
  });
  document.getElementById('eat-menu-rename').addEventListener('click', () => {
    if (!window.openModal) return; const menus = eatMenus(); if (eatEditIdx >= menus.length) eatEditIdx = 0;
    const oldName = menus[eatEditIdx].name;
    window.openModal('重命名菜单', oldName, (v) => {
      if (!v || v === oldName) return;
      if (menus.some((m, i) => i !== eatEditIdx && m.name === v)) { toast('已有同名菜单'); return; }
      menus[eatEditIdx].name = v; eatSaveMenus(menus); eatEditFill();
      if (eatEditIdx === eatCurMenuIdx()) eatRenderCurName();
      toast('已重命名为「' + v + '」');
    });
  });
  document.getElementById('eat-menu-del').addEventListener('click', () => {
    const menus = eatMenus(); if (menus.length <= 1) { toast('至少保留 1 个菜单'); return; }
    if (eatEditIdx >= menus.length) eatEditIdx = 0;
    const name = menus[eatEditIdx].name;
    if (!window.openModal) return;
    window.openModal('删除菜单', '', (v) => {
      if (!v) return;
      const wasCur = eatEditIdx === eatCurMenuIdx();
      menus.splice(eatEditIdx, 1); eatSaveMenus(menus);
      if (wasCur) { eatSaveCurMenuIdx(0); } else if (eatEditIdx < eatCurMenuIdx()) { eatSaveCurMenuIdx(eatCurMenuIdx() - 1); }
      if (eatEditIdx >= menus.length) eatEditIdx = menus.length - 1;
      eatEditFill(); eatRenderCurName(); eatDrawWheel(eatDishes()); eatLastPick = eatPick();
      toast('已删除「' + name + '」');
    }, { noInput: true, staticText: '要删除菜单「' + name + '」吗？此操作不可撤销。' });
  });
  document.getElementById('eat-switch-menu').addEventListener('click', () => { if (editingNow() || eatSpinning) return; eatSwitchOpen(); });
  document.getElementById('eat-switch-cancel').addEventListener('click', () => { eatSwitchClose(); });
  document.getElementById('eat-switch-go').addEventListener('click', () => { eatSwitchSpin(); });
  // #877 切桌面复位：编辑菜单面板/切换菜单浮层是页内常驻节点（.page 整页隐藏时看不见，但重进会带着上一
  // 桌面的面板状态——编辑面板开着、第一次点「编辑菜单」变关闭）。切桌面时停转＋关浮层＋收面板。
  document.addEventListener('contact-switched', function () { eatClearSpin(); eatSwitchClose(); const mp = document.getElementById('eat-menu-panel'); if (mp) mp.hidden = true; });

  // ---- TA 饭点提醒（v3.14.x）：概率触发梦角发字卡到聊天提醒吃饭 ----
  // 世界观同喝水「他视角温柔提醒」：梦角是灵体，饭点偶尔冒出来催你吃饭。
  // 话术池与字卡库【系统预设字卡 → 吃什么】tab 同源（DEFAULT_CARD_DATA.eat，
  // 分组「提醒吃饭/追问关心」），逐张开关（dc-off-eat:*）经 libPool 过滤后参与抽取。
  const DEF_EAT_REMIND = ['到饭点啦，去吃饭吧', '该吃饭了哦，别饿着', '今天吃 {d} 怎么样？就它了', '{d} 挺好的，去吃这个吧', '记得吃热乎的，别随便对付一口', '去吃饭吧，吃完跟我说说吃了什么', '别忙忘了吃饭，胃是自己的', '我看着呢，快去吃饭', '放下手里的事，先吃饭好不好', '饭要按时吃，我才会放心', '好好吃饭的人，运气不会太差哦', '饿了就去做点吃的，别硬撑'];
  const DEF_EAT_REMIND_CARE = ['吃了什么呀？说给我听听', '吃饱了吗？没饱再去添一点', '吃得合胃口吗？', '慢慢吃，不着急', '记得配点汤汤水水', '吃完了就休息一会儿吧'];
  // v3.26.x：夜宵窗口（21:30–23:30）专属话术——与字卡库【吃什么】tab「夜宵提醒/夜宵关心」
  // 分组同源（default-cards-data.js），深夜不再复用「按时吃饭」文案；仍可逐张开关（dc-off-eat:*）
  const DEF_EAT_REMIND_NIGHT = ['夜深了，饿不饿？想吃点夜宵吗', '这个点还没睡呀，要不要来点夜宵', '饿着肚子睡觉可不好，去弄点吃的吧', '夜宵别吃太撑，留点肚子给梦', '偷偷问一句，今晚想吃夜宵吗', '去煮碗热乎的面吧，我陪你吃', '深夜的胃，也该被好好对待', '别只啃饼干，夜宵也要认真吃', '吃夜宵的人，今晚会做甜甜的梦', '要不要我给你留一盏灯，你去觅食'];
  const DEF_EAT_REMIND_NIGHT_CARE = ['夜宵吃的什么呀？说给我听听', '吃饱了就快去睡，别熬太晚', '吃完夜宵记得刷个牙再睡哦', '太晚就别吃太辣的，伤胃', '夜宵吃完了就躺下吧，我守着'];
  // 饭点窗口（分钟）：早 06:30–09:30 / 午 11:00–13:30 / 晚 17:00–19:30 / 夜宵 21:30–23:30
  const EAT_REMIND_WINDOWS = [['breakfast', 390, 570], ['lunch', 660, 810], ['dinner', 1020, 1170], ['nightcap', 1290, 1410]];
  function eatDayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function eatRemindEn() { const s = curStore(); const v = s && s.get('eat-remind-en'); return v === null ? true : v === '1'; }
  function eatRemindSetEn(on) { const s = curStore(); if (s) try { s.set('eat-remind-en', on ? '1' : '0'); } catch (e) {} }
  function eatRemindProb() { const s = curStore(); try { const n = parseInt(s && s.get('eat-remind-prob'), 10); if (!isNaN(n)) return Math.max(0, Math.min(100, n)); } catch (e) {} return 2; }
  function eatRenderRemind() {
    const t = document.getElementById('eat-remind-toggle');
    if (t) t.textContent = 'TA 提醒：' + (eatRemindEn() ? '开' : '关');
    const p = document.getElementById('eat-remind-prob');
    if (p) p.textContent = '触发概率 ' + eatRemindProb() + '%';
  }
  function eatRemindFire(code) {
    const s = curStore(); if (!s) return;
    // 每个饭点窗口每天最多提醒一次（发出即标记）
    try { s.set('eat-remind-done:' + code + ':' + eatDayKey(), '1'); } catch (e) {}
    const dishes = eatDishes();
    const dish = dishes.length ? dishes[Math.floor(Math.random() * dishes.length)] : '';
    let text = '';
    // v3.26.x：夜宵窗口用专属话术池，其余窗口用通用「提醒吃饭」池（夜宵不再是"按时吃饭"语境）
    const isNight = code === 'nightcap';
    const pool = isNight ? libPool('eat', '夜宵提醒', DEF_EAT_REMIND_NIGHT) : libPool('eat', '提醒吃饭', DEF_EAT_REMIND);
    if (pool.length) text = pool[Math.floor(Math.random() * pool.length)] || '';
    if (!text) return;
    text = text.replace(/\{d\}/g, dish || '饭');
    // 字卡进聊天记录（后台也照进）；后台系统通知由 chatAddIn 内部 addRec→showDeskMsg 统一发
    // （标题=联系人名）。v3.26.x #93：删掉此处冗余 bgNotifyCheck——它与 chatAddIn 内部背靠背
    // 各发一条、去重指纹异步登记来不及拦，导致后台弹两条通知（「TA」+「TA的吃饭提醒」）。
    // v3.14.x：带「吃饭提醒」标签 chip（addIn opts.tag），来源可辨识
    if (window.chatAddIn) { try { window.chatAddIn(text, { tag: '吃饭提醒' }); } catch (e) {} }
    try { if (navigator.vibrate) navigator.vibrate([80, 60, 80]); } catch (e) {}
    // 35% 概率隔一小会儿再补一句「追问关心」（第 2+ 条不重复响提示音，同回复链惯例）
    // v3.32.x #132：吃饭字卡概率接 dcf-eat（默认 35%=原值，单值替换非叠加）
    if (Math.random() * 100 < dcfP('eat', 35)) {
      setTimeout(() => {
        const care = isNight ? libPool('eat', '夜宵关心', DEF_EAT_REMIND_NIGHT_CARE) : libPool('eat', '追问关心', DEF_EAT_REMIND_CARE);
        if (care.length && window.chatAddIn) { try { window.chatAddIn(care[Math.floor(Math.random() * care.length)], { silent: true, tag: '吃饭提醒' }); } catch (e) {} }
      }, 1400);
    }
  }
  // #886 清扫历史「今日已提醒」标记键：每天至多 4 键、只留当天（开吃什么页＋eatRemindMaybe 每 4 分钟各扫一次；
  // 走 xyStore.remove＝内存/LS/IDB 三处同清，删除联系人同款管线）
  function eatRemindSweep() {
    try {
      const pfx = (window.activePrefix ? window.activePrefix() : 'xy-home-v2:default'); // 无尾冒号：xyStore 合键时自己补 ':'
      const scan = pfx + ':eat-remind-done:';
      const today = eatDayKey(); const dead = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(scan) === 0 && k.slice(-10) !== today) dead.push(k);
      }
      dead.forEach(function (k) { try { window.xyStore(pfx).remove(k.slice(pfx.length + 1)); } catch (e) {} });
    } catch (e) {}
  }
  function eatRemindMaybe() {
    try {
      eatRemindSweep();
      if (!window.chatAddIn) return;
      const h = new Date().getHours(); if (h >= 23 || h < 6) return; // v3.26.x：23:00-06:00 静默期，不提醒吃饭（深更半夜吃饭提醒离谱）
      if (!eatRemindEn()) return;
      const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
      const w = EAT_REMIND_WINDOWS.find(x => mins >= x[1] && mins <= x[2]);
      if (!w) return;
      const s = curStore(); if (!s) return;
      if (s.get('eat-remind-done:' + w[0] + ':' + eatDayKey()) === '1') return;
      // 窗口内每 4 分钟掷一次；未命中下轮再掷（越往后越可能），命中即发、窗口内不再重复
      if (Math.random() * 100 >= eatRemindProb()) return;
      eatRemindFire(w[0]);
    } catch (e) {}
  }
  eatRemindMaybe(); // 启动即查一次：打开应用时恰在饭点窗口内可立即触发（守卫齐备，安全）
  setTimeout(eatRemindMaybe, 60000);
  setInterval(eatRemindMaybe, 240000);
  document.getElementById('eat-remind-toggle').addEventListener('click', () => {
    if (editingNow()) return;
    const on = !eatRemindEn();
    eatRemindSetEn(on); eatRenderRemind();
    toast(on ? '已开启：TA 会偶尔在饭点发字卡提醒你吃饭' : '已关闭：TA 不再饭点提醒');
  });
  document.getElementById('eat-remind-prob').addEventListener('click', () => {
    if (!window.openModal) return;
    window.openModal('触发概率（%）', String(eatRemindProb()), (v) => {
      if (v === null || v === '') return;
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0 || n > 100) { toast('请输入 0-100 的整数'); return; }
      const s = curStore(); if (s) try { s.set('eat-remind-prob', String(n)); } catch (e) {}
      eatRenderRemind(); toast(n <= 0 ? '已设置：基本不会触发' : '已设置：每个饭点约 ' + n + '%/4分钟 概率触发');
    });
  });

  // ---- 番茄钟页 ----
  // 专注/小憩/长休三档倒计时 + 圆环进度；完成专注记一个 🍅（今日/累计），可发到聊天。
  // 计时基于 endAt 时间戳（不依赖 interval 精度），离开页面后台照走、熄屏回来时间正确。
  const DEF_POMO_PRAISE = ['专注的你最棒了', '认真的人最好看', '加油，我在陪你', '嗯嗯，我安静陪着', '专注完抱一下'];
  // 世界观：他此刻近时，专注完成用近状态语（灵体在旁边静静陪）
  const DEF_POMO_NEAR = ['你专注的时候，我就静静待在旁边', '认真完啦，过来靠靠你', '我一直在旁边看着你呢', '专注完啦，抱一下', '你在认真，我在旁边，挺好'];
  const POMO_MODES = { focus: { name: '专注', def: 25 }, short: { name: '小憩', def: 5 }, long: { name: '长休', def: 15 } };
  const POMO_RING_C = 552.92; // 2π×88 圆环周长
  const pomoPage = document.createElement('div');
  pomoPage.className = 'page'; pomoPage.id = 'page-pomodoro'; pomoPage.hidden = true;
  pomoPage.innerHTML =
    '<div class="chat-head"><span class="ch-back" id="pomo-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="ch-name">番茄钟</span></div>' +
    '<div class="pomo-body">' +
      '<div class="pomo-card glass">' +
        '<div class="pomo-tabs"><button class="pomo-tab sel" data-pmode="focus">专注</button><button class="pomo-tab" data-pmode="short">小憩</button><button class="pomo-tab" data-pmode="long">长休</button></div>' +
        '<div class="pomo-dial">' +
          '<svg class="pomo-ring" viewBox="0 0 200 200"><circle class="pomo-ring-bg" cx="100" cy="100" r="88"/><circle class="pomo-ring-fill" id="pomo-ring" cx="100" cy="100" r="88"/></svg>' +
          '<div class="pomo-center"><div class="pomo-time" id="pomo-time">25:00</div><div class="pomo-state" id="pomo-state">准备专注</div></div>' +
          '<div class="pomo-spark" id="pomo-spark"></div>' +
        '</div>' +
      '</div>' +
      '<div class="pomo-btns"><button class="pomo-start" id="pomo-start">开始</button><button class="pomo-reset" id="pomo-reset">重置</button></div>' +
      '<button class="pmp-go" id="pomo-companion">🍅 陪伴模式</button>' +
      '<div class="pomo-msg glass" id="pomo-msg">点开始，专注一会儿</div>' +
      '<div class="pomo-stats" id="pomo-stats">今日 🍅 × 0 · 累计 0 个</div>' +
      '<div class="pomo-manage"><button class="pomo-bell" id="pomo-bell">铃声：开</button><button class="pomo-set-dur" id="pomo-set-dur">设时长</button><button class="pomo-add-msg" id="pomo-add-msg">+ 夸夸字卡</button><button class="tp-send-btn pomo-send-btn" id="pomo-send">发到聊天：开</button></div>' +
    '</div>';
  host.appendChild(pomoPage);

  // 番茄钟数据全局共享（pomo-cfg 时长 / 今日·累计 🍅 / 夸夸字卡 / 发到聊天 / 铃声 / 陪伴会话 / 陪伴聊天记录
  // 与陪伴设置都存根命名空间 xy-home-v2:*，所有桌面读写同一份——陪伴模式可跨联系人继续、不随桌面切换重置）
  function pomoStore() { try { return window.xyStore('xy-home-v2'); } catch (e) { return null; } }

  function pomoCfg() {
    let c = null;
    try { c = JSON.parse((pomoStore() && pomoStore().get('pomo-cfg')) || '{}'); } catch (e) {}
    const ok = (n, d) => (n && n >= 1 && n <= 180 ? n : d);
    return {
      f: ok(c && c.f, POMO_MODES.focus.def),
      s: ok(c && c.s, POMO_MODES.short.def),
      l: ok(c && c.l, POMO_MODES.long.def)
    };
  }
  function pomoSetCfg(c) { const s = pomoStore(); if (s) try { s.set('pomo-cfg', JSON.stringify(c)); } catch (e) {} }
  function pomoModeMin(m) { const c = pomoCfg(); return m === 'focus' ? c.f : m === 'short' ? c.s : c.l; }
  function pomoTodayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function pomoToday() {
    const s = pomoStore();
    try { const o = JSON.parse((s && s.get('pomo-today')) || '{}'); if (o.date === pomoTodayKey()) return { date: o.date, count: o.count || 0 }; } catch (e) {}
    return { date: pomoTodayKey(), count: 0 };
  }
  function pomoSaveToday(t) { const s = pomoStore(); if (s) try { s.set('pomo-today', JSON.stringify(t)); } catch (e) {} }
  function pomoTotal() { const s = pomoStore(); try { return parseInt((s && s.get('pomo-total')) || '0', 10) || 0; } catch (e) { return 0; } }
  function pomoSaveTotal(n) { const s = pomoStore(); if (s) try { s.set('pomo-total', '' + n); } catch (e) {} }
  function pomoCustomMsgs() { const s = pomoStore(); try { const a = JSON.parse((s && s.get('pomo-msgs')) || '[]'); if (Array.isArray(a)) return a; } catch (e) {} return []; }
  function pomoSaveMsgs(a) { const s = pomoStore(); if (s) try { s.set('pomo-msgs', JSON.stringify(a)); } catch (e) {} }
  function pomoPool() { return DEF_POMO_PRAISE.concat(pomoCustomMsgs()); }
  function pomoSendOn() { const s = pomoStore(); try { return s.get('pomo-send-chat') !== '0'; } catch (e) { return true; } }
  // 结束铃声开关（全局共享，默认开；关了只静音、震动与本地通知保留）
  function pomoBellOn() { const s = pomoStore(); try { return s.get('pomo-bell') !== '0'; } catch (e) { return true; } }
  // 到点本地通知（period.js notifyAssist 先例）：页面在后台/熄屏时 Web Audio 会挂起、
  // iOS 又没有 navigator.vibrate——系统通知是唯一可靠的到点提醒。只看通知权限，
  // 不受「TA 消息通知」开关影响（番茄钟是用户主动启动的闹钟类功能）。
  function pomoNotify(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(function (reg) {
          try { reg.showNotification(title, { body: body, tag: 'pomo-' + Date.now() }); }
          catch (e) { try { new Notification(title, { body: body }); } catch (e2) {} }
        });
      } else {
        try { new Notification(title, { body: body }); } catch (e) {}
      }
    } catch (e) {}
  }

  let pomoMode = 'focus';
  let pomoRunning = false;
  let pomoEndAt = 0;
  let pomoRemainMs = 0;
  let pomoTickTimer = null;
  // v3.13.x：「番茄钟 ×摸鱼值 对抗」——专注计时进行中时，personalize.js 的摸鱼值
  //   自动增长暂停（双方都冻结，TA 在旁边安静陪）；完成专注后按时长结算补偿摸鱼。
  window.pomoFocusActive = function () { return !!(pomoRunning && pomoMode === 'focus'); };

  function pomoRender() {
    const totalMs = pomoModeMin(pomoMode) * 60000;
    const remain = Math.max(0, Math.min(totalMs, pomoRunning ? pomoEndAt - Date.now() : (pomoRemainMs > 0 ? pomoRemainMs : totalMs)));
    const sec = Math.ceil(remain / 1000);
    const te = document.getElementById('pomo-time');
    if (te) te.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    const ring = document.getElementById('pomo-ring');
    if (ring) ring.style.strokeDashoffset = String(POMO_RING_C * (1 - remain / totalMs));
    const st = document.getElementById('pomo-state');
    if (st) st.textContent = pomoRunning ? (pomoMode === 'focus' ? '专注中…' : '休息中…') : (remain < totalMs ? '已暂停' : '准备' + POMO_MODES[pomoMode].name);
    const sb = document.getElementById('pomo-start');
    if (sb) sb.textContent = pomoRunning ? '暂停' : (remain < totalMs ? '继续' : '开始');
    document.querySelectorAll('#page-pomodoro .pomo-tab').forEach(t2 => t2.classList.toggle('sel', t2.dataset.pmode === pomoMode));
    const t = pomoToday();
    const stats = document.getElementById('pomo-stats');
    if (stats) stats.textContent = '今日 🍅 × ' + t.count + ' · 累计 ' + pomoTotal() + ' 个';
    pmpRefreshGoBtn();
    if (pmpActive()) pmpRefreshBar();
    // 世界观：专注运行时圆环上叠一个缓慢游走的光点（他在旁边静静陪）
    const spark = document.getElementById('pomo-spark');
    if (spark) spark.classList.toggle('on', pomoRunning && pomoMode === 'focus');
  }
  function pomoStopTick() { clearInterval(pomoTickTimer); pomoTickTimer = null; pomoDisarmNotify(); }
  // 到点通知的「准点保险」：后台标签页计时器会被浏览器节流（隐藏页 250ms tick 可能
  // 被推迟到分钟级），tick 兜底之外再按 endAt 定一个 setTimeout 直接发通知——
  // 同样受节流影响但与 tick 解耦，谁先到点谁先提醒（都有防重守卫）。
  let pomoNotifyTimer = null;
  function pomoArmNotify() {
    pomoDisarmNotify();
    if (!pomoRunning) return;
    const delay = pomoEndAt - Date.now();
    if (!(delay > 0)) return;
    const mode = pomoMode;
    pomoNotifyTimer = setTimeout(() => {
      pomoNotifyTimer = null;
      if (!pomoRunning || pomoMode !== mode) return;
      if (Date.now() < pomoEndAt - 1500) return;
      if (document.visibilityState === 'visible') return; // 前台由铃声/震动负责
      pomoNotify('番茄钟 · ' + POMO_MODES[mode].name + '结束', mode === 'focus' ? '专注完成，休息一下吧 🍅' : '休息好了，来下一个番茄吧');
    }, delay + 120);
  }
  function pomoDisarmNotify() { if (pomoNotifyTimer) { clearTimeout(pomoNotifyTimer); pomoNotifyTimer = null; } }
  function pomoStartTick() {
    pomoStopTick();
    pomoTickTimer = setInterval(() => {
      if (!pomoRunning) return;
      if (Date.now() >= pomoEndAt) { pomoComplete(); return; }
      pomoRender();
    }, 250);
    pomoArmNotify();
  }
  function pomoShowMsg(txt) { const el = document.getElementById('pomo-msg'); if (el) { el.classList.add('fade'); setTimeout(() => { el.textContent = '\u201c' + txt + '\u201d'; el.classList.remove('fade'); }, 200); } }
  function pomoIdleAt(m) { if (pmpActive()) pmpDetach(); pomoRunning = false; pomoRemainMs = 0; pomoEndAt = 0; pomoStopTick(); pomoMode = m; pomoRender(); }
  function pomoComplete() {
    vibrate([120, 60, 120]);
    // 结束铃声：倒计时到点响一声内置温馨铃（Web Audio 合成、零存储；固定播不跟随联系人音效设置——
    // 番茄钟是闹钟类功能，消息音效静音时也应出声提醒）。AudioContext 已由全局手势解锁，定时器触发可播。
    // 页面设置里可关（铃声：开/关）；后台/熄屏场景由 pomoNotify 本地通知兜底提醒。
    if (pomoBellOn()) { try { if (window.playBuiltinSfx) window.playBuiltinSfx('ring-warm', false); } catch (e) {} }
    if (document.visibilityState !== 'visible') {
      pomoNotify('番茄钟 · ' + POMO_MODES[pomoMode].name + '结束', pomoMode === 'focus' ? '专注完成，休息一下吧 🍅' : '休息好了，来下一个番茄吧');
    }
    if (pomoMode === 'focus') {
      const mins = pomoModeMin('focus');
      const t = pomoToday(); t.count++; pomoSaveToday(t);
      pomoSaveTotal(pomoTotal() + 1);
      // v3.13.x：补偿摸鱼——专注期间摸鱼值被冻结，完成按时长结算（每 10 分钟 +1，至少 +1）
      let comp = 0;
      try {
        comp = Math.max(1, Math.round(mins / 10));
        if (window.addFishPts) window.addFishPts(comp, 0);
      } catch (e) { comp = 0; }
      // 世界观：他此刻近时，70% 用近状态语（灵体在旁边静静陪），否则原夸夸字卡
      const near = window.taIsNear && window.taIsNear();
      let praise;
      if (near && Math.random() < 0.7) praise = DEF_POMO_NEAR[Math.floor(Math.random() * DEF_POMO_NEAR.length)];
      else { const pool = pomoPool(); praise = pool[Math.floor(Math.random() * pool.length)]; }
      const brk = t.count % 4 === 0 ? 'long' : 'short';
      const wasPmp = pmpActive();
      if (wasPmp) {
        try { pmpCAdd('ta', PMP_DONE[Math.floor(Math.random() * PMP_DONE.length)]); } catch (e) {}
        pmpFlash('\u2705 完成 +1 🍅');
        pmpDetach();
      }
      pomoIdleAt(brk);
      pomoShowMsg(POMO_MODES[brk].name + ' ' + pomoModeMin(brk) + ' 分钟 · ' + praise + (comp ? '（补偿摸鱼 +' + comp + '）' : ''));
      // v3.42.x #422：番茄钟完成消息在自带「发到聊天」开关（pomo-send-chat）之上，
      // 追加「其他互动功能字卡」里的番茄钟概率门控（dcf-pomo，默认 100%＝原行为，0%＝不发）。
      if (!wasPmp && pomoSendOn() && Math.random() * 100 < (window.dcfGet ? window.dcfGet('pomo') : 100) && window.chatAddIn) { try { window.chatAddIn('🍅 完成了 ' + mins + ' 分钟专注，去休息一会儿' + (comp ? '（奖励补偿摸鱼 +' + comp + '）' : '')); } catch (e) {} }
    } else {
      pomoIdleAt('focus');
      pomoShowMsg('休息好了，来下一个番茄吧');
    }
  }
  if (pomoApp) pomoApp.addEventListener('click', () => { if (editingNow()) return; openPage(pomoPage); pomoRender(); });
  document.getElementById('pomo-back').addEventListener('click', () => backHome(pomoPage));
  document.getElementById('pomo-start').addEventListener('click', () => {
    if (editingNow()) return;
    if (pomoRunning) {
      pomoRemainMs = Math.max(0, pomoEndAt - Date.now());
      pomoRunning = false; pomoStopTick(); pomoRender(); pmpSyncFromEngine();
      return;
    }
    const totalMs = pomoModeMin(pomoMode) * 60000;
    const remain = pomoRemainMs > 0 && pomoRemainMs < totalMs ? pomoRemainMs : totalMs;
    pomoEndAt = Date.now() + remain;
    pomoRunning = true; pomoStartTick(); pomoRender(); pmpSyncFromEngine();
  });
  document.getElementById('pomo-reset').addEventListener('click', () => { pomoIdleAt(pomoMode); });
  pomoPage.querySelectorAll('.pomo-tab').forEach(t2 => t2.addEventListener('click', () => {
    if (t2.dataset.pmode === pomoMode) return;
    pomoIdleAt(t2.dataset.pmode);
  }));
  document.getElementById('pomo-set-dur').addEventListener('click', () => {
    if (!window.openModal) return;
    const c = pomoCfg();
    window.openModal('设时长（分钟）', c.f + ',' + c.s + ',' + c.l, (v) => {
      if (!v) return;
      const p = String(v).split(/[,,\s]+/).map(x => parseInt(x, 10));
      if (p.length < 3 || p.some(n => !(n >= 1 && n <= 180))) { toast('格式：25,5,15（各 1-180）'); return; }
      pomoSetCfg({ f: p[0], s: p[1], l: p[2] });
      pomoIdleAt(pomoMode);
      toast('已设置');
    }, { placeholder: '专注,小憩,长休 如 25,5,15' });
  });
  document.getElementById('pomo-add-msg').addEventListener('click', () => {
    if (!window.openModal) return;
    window.openModal('添加夸夸字卡', '', (v) => { if (v) { const a = pomoCustomMsgs(); a.push(v); pomoSaveMsgs(a); toast('已添加'); } });
  });
  const pomoSendBtn = document.getElementById('pomo-send');
  if (pomoSendBtn) {
    pomoSendBtn.textContent = '发到聊天：' + (pomoSendOn() ? '开' : '关');
    pomoSendBtn.addEventListener('click', () => { const s = pomoStore(); const on = !pomoSendOn(); if (s) try { s.set('pomo-send-chat', on ? '1' : '0'); } catch (e) {} pomoSendBtn.textContent = '发到聊天：' + (on ? '开' : '关'); });
  }
  // 结束铃声开关（关=只静音；震动与后台本地通知仍保留）
  const pomoBellBtn = document.getElementById('pomo-bell');
  if (pomoBellBtn) {
    pomoBellBtn.textContent = '铃声：' + (pomoBellOn() ? '开' : '关');
    pomoBellBtn.addEventListener('click', () => {
      const s = pomoStore();
      const on = !pomoBellOn();
      if (s) try { s.set('pomo-bell', on ? '1' : '0'); } catch (e) {}
      pomoBellBtn.textContent = '铃声：' + (on ? '开' : '关');
      toast(on ? '结束铃声已开启' : '结束铃声已关闭');
    });
  }

  // ---- 存钱罐页 ----
  // 世界观：两个人一起攒的小金库（所有桌面/联系人共用一份，同 period/fish-log 全局先例）；
  // TA 是灵体，久未打开时有概率「塞给你」一枚硬币——纯彩蛋提示不入账，由你决定要不要存；
  // 存钱/取钱时用碎碎念字卡回应，攒够目标会庆祝。
  const DEF_PIGGY_IN = ['叮～又攒下一点啦', '小猪替你收好了', '离目标更近了哦', '嗯嗯，我看着呢', '慢慢攒，不着急'];
  const DEF_PIGGY_OUT = ['该花的花，别太省', '买什么了呀？', '咦，少了一点点', '没关系，再攒回来'];
  const DEF_PIGGY_FULL = ['我们存够啦！！', '目标达成，真棒', '攒够了！想好怎么花了吗'];
  // 里程碑（存到目标的 25/50/75% 时各庆祝一次，标记存在心愿对象上防重复）
  const PIGGY_MS = [{ p: 25, t: '已经攒到四分之一啦' }, { p: 50, t: '过半啦，好厉害' }, { p: 75, t: '就差一点点了' }];
  // 取款后 TA 的关心追问（可回复一句）
  const PIGGY_CARE = ['花在哪了呀？', '买什么了？跟我说说嘛', '没乱花钱吧？', '钱去哪啦，说来听听'];
  const PIGGY_TA_COINS = [0.52, 5.2, 5.21, 6.66, 8.88, 9.99, 13.14];
  const PIGGY_TA_NOTES = ['偷偷塞了一点', '给你也存了一份', '嘿嘿，别问哪来的'];
  const piggyPage = document.createElement('div');
  piggyPage.className = 'page'; piggyPage.id = 'page-piggy'; piggyPage.hidden = true;
  piggyPage.innerHTML =
    '<div class="chat-head"><span class="ch-back" id="piggy-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="ch-name">存钱罐</span><span class="ch-settings" id="piggy-coin-set" title="概率设置"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span></div>' +
    '<div class="piggy-body">' +
      // 双账本 Tab：现实存钱（真实人民币，手动记账）+ 心意币存钱（从心意币账本转入/转出）
      '<div class="piggy-tabs"><button class="piggy-tab on" data-ptab="real">现实存钱</button><button class="piggy-tab" data-ptab="coin">心意币存钱</button></div>' +
      // 监督人面板两 tab 共用，提到顶层容器（不随任意一方切换而隐藏）
      '<div class="piggy-share glass" id="piggy-share" hidden><div class="piggy-reply-q" id="piggy-share-title">谁来监督这个心愿？（可多选）</div><div class="piggy-share-chips" id="piggy-share-chips"></div><div class="piggy-reply-row"><button class="piggy-reply-send" id="piggy-share-ok">保存心愿</button><button class="piggy-reply-skip" id="piggy-share-cancel">取消</button></div></div>' +
      '<div class="piggy-real">' +
        '<div class="piggy-hero glass"><div class="piggy-goal-name" id="piggy-goal-name">先设个小目标吧</div><div class="piggy-bal" id="piggy-bal"><i>¥</i>0.00</div><div class="piggy-bar"><div class="piggy-fill" id="piggy-fill"></div></div><div class="piggy-sub" id="piggy-sub">每一笔都算数</div></div>' +
        '<div class="piggy-btns"><button class="piggy-out" id="piggy-out">取一笔</button><button class="piggy-in" id="piggy-in">存一笔</button></div>' +
        '<div class="piggy-msg glass" id="piggy-msg">小猪替你保管着呢</div>' +
        '<div class="piggy-reply glass" id="piggy-reply" hidden><div class="piggy-reply-q" id="piggy-reply-q"></div><div class="piggy-reply-row"><input class="piggy-reply-in" id="piggy-reply-in" type="text" maxlength="40" placeholder="回一句给TA（可不填）"><button class="piggy-reply-send" id="piggy-reply-send">发送</button><button class="piggy-reply-skip" id="piggy-reply-skip">不用啦</button></div></div>' +
        '<div class="piggy-goals glass" id="piggy-goals"></div>' +
        '<div class="piggy-hist glass" id="piggy-hist"></div>' +
        '<div class="piggy-manage"><button class="piggy-set-goal" id="piggy-set-goal">＋ 新小心愿</button><button class="piggy-add-msg" id="piggy-add-msg">+ TA的碎碎念</button></div>' +
      '</div>' +
      // 心意币存钱：per-cid 独立罐（我和当前联系人的共用存钱罐），余额从全局心意币账本转入
      '<div class="piggy-coin" hidden>' +
        '<div class="coin-contact-bar glass"><span class="coin-contact-label" id="coin-contact-label">我和 TA 的存钱罐</span><button class="coin-contact-switch" id="coin-contact-switch">切换联系人</button></div>' +
        '<div class="coin-hero glass">' +
          '<div class="coin-bal-single" id="coin-bal-total"><i>¥</i>0.00</div>' +
          '<div class="piggy-bar"><div class="piggy-fill" id="coin-fill"></div></div>' +
          '<div class="piggy-sub" id="coin-sub">把心意币存起来，攒一个心愿</div>' +
        '</div>' +
        '<div class="piggy-btns"><button class="piggy-out" id="coin-out">取一笔</button><button class="piggy-in" id="coin-in">存一笔</button></div>' +
        '<div class="piggy-msg glass" id="coin-msg">小金币替你保管着</div>' +
        '<div class="piggy-goals glass" id="piggy-coin-goals"></div>' +
        '<div class="piggy-hist glass" id="piggy-coin-hist"></div>' +
        '<div class="piggy-manage"><button class="piggy-set-goal" id="coin-set-goal">＋ 攒币心愿</button></div>' +
      '</div>' +
    '</div>';
  host.appendChild(piggyPage);

  function piggyEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function piggyFmt(n) { try { return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (e) { return (Math.round(n * 100) / 100).toFixed(2); } }
  // 输入容错：全角数字先转半角（部分输入法默认全角），只留数字和点，两位小数，0 < n ≤ 9,999,999
  function piggyAmt(v) {
    const s = String(v == null ? '' : v).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).trim().replace(/[^\d.]/g, '');
    const n = Math.round(parseFloat(s) * 100) / 100;
    return (n > 0 && n <= 9999999) ? n : 0;
  }
  // 全局 store：根命名空间 xy-home-v2:*（所有联系人桌面读写同一份数据；xyStore.set 自动双写 IDB）
  function piggyStore() { try { return window.xyStore('xy-home-v2'); } catch (e) { return null; } }
  function piggyLog() { const s = piggyStore(); try { const a = JSON.parse(s.get('piggy-log') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function piggySaveLog(a) { const s = piggyStore(); if (s) try { s.set('piggy-log', JSON.stringify(a)); } catch (e) {} }
  function piggyBal(a) { let n = 0; (a || piggyLog()).forEach(x => { n += (x && x.type === 'out' ? -1 : 1) * ((x && x.amt) || 0); }); return Math.round(n * 100) / 100; }
  // 心愿单（多目标）：piggy-goals = [{n,a,ms:[已庆祝里程碑],done}]；余额全罐共享，
  // 每个心愿各自算进度。老单目标（piggy-goal-name/am）首次读取时自动迁移。
  function piggyGoals() {
    const s = piggyStore(); let a = null;
    try { a = JSON.parse(s.get('piggy-goals') || 'null'); } catch (e) {}
    if (!Array.isArray(a)) {
      try {
        const gn = s.get('piggy-goal-name'); const ga = parseFloat(s.get('piggy-goal-amt')) || 0;
        a = (gn && ga > 0) ? [{ n: gn, a: ga }] : [];
      } catch (e) { a = []; }
      // 迁移后立即落盘，避免旧单目标永远只活在虚拟读取里（备份/导出时缺失）
      try { s.set('piggy-goals', JSON.stringify(a)); } catch (e) {}
    }
    return a.filter(function (g) { return g && g.n && (+g.a) > 0; }).map(function (g) {
      return {
        n: String(g.n), a: Math.round((+g.a) * 100) / 100,
        ms: Array.isArray(g.ms) ? g.ms.slice() : [], done: !!g.done,
        // 监督人/可见范围：[] 或缺省=所有桌面可见；['*']=全部；否则为联系人 id 列表
        by: Array.isArray(g.by) ? g.by.filter(function (x) { return x && typeof x === 'string'; }) : []
      };
    });
  }
  function piggySaveGoals(a) { const s = piggyStore(); if (s) try { s.set('piggy-goals', JSON.stringify(a)); } catch (e) {} }
  function piggyCur() { const s = piggyStore(); try { return parseInt(s.get('piggy-goal-cur') || '0', 10) || 0; } catch (e) { return 0; } }
  function piggySetCur(i) { const s = piggyStore(); if (s) try { s.set('piggy-goal-cur', '' + i); } catch (e) {} }
  // 心愿是否在当前桌面可见（全局金库，但心愿可指定只给某些联系人看）
  function piggyGoalVisible(g) {
    if (!g.by || !g.by.length) return true;
    const cid = window.__activeCid || 'default';
    return g.by.indexOf('*') >= 0 || g.by.indexOf(cid) >= 0;
  }
  function piggyContactName(cid) {
    let l = [];
    try { l = window.getContacts ? window.getContacts() : []; } catch (e) {}
    for (let k = 0; k < l.length; k++) if (l[k] && l[k].id === cid) return l[k].name || cid;
    return cid;
  }
  // 当前桌面视角下的激活心愿：cur 游标指向全量数组下标，不可见时回退到第一个可见
  function piggyActive() {
    const all = piggyGoals();
    const vis = [];
    all.forEach(function (g, i) { if (piggyGoalVisible(g)) vis.push({ g: g, i: i }); });
    if (!vis.length) return { g: null, i: -1, all: all, vis: vis };
    const cur = piggyCur();
    let hit = null;
    for (let k = 0; k < vis.length; k++) if (vis[k].i === cur) { hit = vis[k]; break; }
    if (!hit) hit = vis[0];
    return { g: hit.g, i: hit.i, all: all, vis: vis };
  }
  function piggyUserCards() { const s = piggyStore(); try { const a = JSON.parse(s.get('piggy-cards') || '[]'); return Array.isArray(a) ? a.filter(x => x) : []; } catch (e) { return []; } }
  function piggySaveUserCards(a) { const s = piggyStore(); if (s) try { s.set('piggy-cards', JSON.stringify(a)); } catch (e) {} }
  function piggyPick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function piggyShowMsg(txt) { const el = document.getElementById('piggy-msg'); if (el) { el.classList.add('fade'); setTimeout(() => { el.textContent = '\u201c' + txt + '\u201d'; el.classList.remove('fade'); }, 200); } }
  function piggyInPool() { const u = piggyUserCards(); const d = libPool('piggy', '存入碎碎念', DEF_PIGGY_IN); return u.length ? u.concat(d) : d.slice(); }
  let piggyHistAll = false; // 记录展开状态（false=最近6条，true=全部+按月分组）
  function piggyRowHtml(x) {
    const d = new Date((x && x.t) || Date.now());
    const ds = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const out = x && x.type === 'out';
    return '<div class="piggy-row"><span class="pr-amt ' + (out ? 'out' : 'in') + '">' + (out ? '\u2212' : '+') + '¥' + piggyFmt((x && x.amt) || 0) + '</span><span class="pr-note">' + piggyEsc((x && x.note) || (out ? '取出' : '存入')) + '</span><span class="pr-date">' + ds + '</span></div>';
  }
  function piggyRender() {
    const log = piggyLog(); const bal = piggyBal(log);
    const be = document.getElementById('piggy-bal'); if (be) be.innerHTML = '<i>¥</i>' + piggyFmt(bal < 0 ? 0 : bal);
    const act = piggyActive(); const g = act.g;
    const ne = document.getElementById('piggy-goal-name');
    const fill = document.getElementById('piggy-fill');
    const sub = document.getElementById('piggy-sub');
    if (g) {
      const pct = Math.min(100, Math.max(0, Math.round(bal / g.a * 100)));
      if (ne) ne.textContent = (g.done ? '已达成 · ' : '小目标 · ') + g.n;
      if (fill) fill.style.width = pct + '%';
      if (sub) sub.textContent = g.done ? ('已存满 ' + piggyFmt(g.a) + '，换个小目标继续吧') : ('已存 ' + piggyFmt(Math.max(0, bal)) + ' / ' + piggyFmt(g.a) + '（' + pct + '%）');
    } else {
      if (ne) ne.textContent = '先设个小目标吧';
      if (fill) fill.style.width = '0';
      if (sub) sub.textContent = log.length ? ('已经攒了 ' + log.length + ' 笔啦') : '每一笔都算数';
    }
    // 心愿单（仅显示当前桌面可见的心愿）
    const glEl = document.getElementById('piggy-goals');
    if (glEl) {
      let h = '<div class="piggy-hist-top"><span class="piggy-hist-title">心愿单</span><button class="piggy-more" id="piggy-goal-add">＋ 添加</button></div>';
      if (!act.all.length) h += '<div class="piggy-empty">还没有小心愿，点右上角添加</div>';
      else if (!act.vis.length) h += '<div class="piggy-empty">这个桌面没有可见的心愿</div>';
      else act.vis.forEach(function (ent) {
        const gg = ent.g;
        const p = Math.min(100, Math.max(0, Math.round(bal / gg.a * 100)));
        const byTxt = (!gg.by || !gg.by.length) ? '监督：所有桌面' : '监督：' + piggyEsc(gg.by.map(piggyContactName).join('、'));
        h += '<div class="pg-row' + (ent.i === act.i ? ' cur' : '') + '" data-pick="' + ent.i + '">' +
          '<span class="pg-name' + (gg.done ? ' done' : '') + '"><span class="pg-nm">' + piggyEsc(gg.n) + (gg.done ? ' ✓' : '') + '</span><span class="pg-by">' + byTxt + '</span></span>' +
          '<span class="pg-amt">¥' + piggyFmt(gg.a) + '</span>' +
          '<span class="pg-bar"><i style="width:' + p + '%"></i></span><span class="pg-pct">' + p + '%</span>' +
          '<button class="pg-del" data-del="' + ent.i + '">✕</button></div>';
      });
      glEl.innerHTML = h;
    }
    // 记录（收起=最近6条倒序；全部=正序+按月分组小计）
    const hist = document.getElementById('piggy-hist');
    if (hist) {
      let body;
      if (!log.length) body = '<div class="piggy-empty">还没存过，投第一枚硬币吧</div>';
      else if (!piggyHistAll) {
        body = log.slice(-6).reverse().map(piggyRowHtml).join('');
      } else {
        const asc = log.slice().sort(function (a, b) { return (a && a.t || 0) - (b && b.t || 0); });
        const parts = []; let curKey = ''; let sum = 0;
        asc.forEach(function (x) {
          const d = new Date((x && x.t) || Date.now());
          const key = d.getFullYear() + '-' + d.getMonth();
          if (key !== curKey) {
            if (curKey !== '') parts.push('<div class="pr-sub">小结 · ' + (sum >= 0 ? '+' : '\u2212') + '¥' + piggyFmt(Math.abs(sum)) + '</div>');
            curKey = key; sum = 0;
            parts.push('<div class="pr-month">' + d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月</div>');
          }
          sum += ((x && x.type === 'out' ? -1 : 1) * ((x && x.amt) || 0));
          parts.push(piggyRowHtml(x));
        });
        parts.push('<div class="pr-sub">小结 · ' + (sum >= 0 ? '+' : '\u2212') + '¥' + piggyFmt(Math.abs(sum)) + '</div>');
        body = parts.join('');
      }
      hist.innerHTML = '<div class="piggy-hist-top"><span class="piggy-hist-title">存钱记录</span>' +
        (log.length ? '<button class="piggy-more" id="piggy-more">' + (piggyHistAll ? '只看最近' : '全部记录') + '</button>' : '') +
        '</div>' + body;
    }
  }
  function piggyAdd(type, amt, note) {
    const log = piggyLog(); log.push({ t: Date.now(), type: type, amt: amt, note: note || '' });
    piggySaveLog(log); piggyRender();
    const bal = piggyBal(log);
    const act = piggyActive(); const g = act.g;
    if (type !== 'out') {
      if (g && !g.done) {
        // 攒够当前心愿：标记达成 → 庆祝 → 自动切到下一个未完成的可见心愿
        if (bal >= g.a) {
          const gs = act.all;
          [25, 50, 75].forEach(function (m) { if (gs[act.i].ms.indexOf(m) < 0) gs[act.i].ms.push(m); });
          gs[act.i].done = true;
          piggySaveGoals(gs);
          vibrate([60, 40, 60]);
          piggyShowMsg(piggyPick(DEF_PIGGY_FULL));
          let nxt = -1;
          for (let k2 = 0; k2 < act.vis.length; k2++) { if (act.vis[k2].i !== act.i && !act.vis[k2].g.done) { nxt = act.vis[k2].i; break; } }
          if (nxt >= 0) piggySetCur(nxt);
          piggyRender();
          return;
        }
        // 里程碑 25/50/75%（各庆祝一次，取最高新达成的档）
        for (let k = PIGGY_MS.length - 1; k >= 0; k--) {
          const m = PIGGY_MS[k];
          if (bal >= g.a * m.p / 100 && g.ms.indexOf(m.p) < 0) {
            const gs = act.all; gs[act.i].ms.push(m.p); piggySaveGoals(gs);
            vibrate([40, 30, 40]);
            piggyShowMsg(m.t);
            return;
          }
        }
      }
      piggyShowMsg(piggyPick(piggyInPool()));
    } else {
      piggyShowMsg(piggyPick(libPool('piggy', '取款回应', DEF_PIGGY_OUT)));
      piggyAskCare();
    }
  }
  // 取款后 TA 关心追问：内联回复框（发送=以我的身份发到聊天；也可忽略）
  function piggyAskCare() {
    const box = document.getElementById('piggy-reply');
    if (!box) return;
    const q = document.getElementById('piggy-reply-q');
    if (q) { var care = libPool('piggy', '取款关心', PIGGY_CARE); var careTxt = 'TA：' + care[Math.floor(Math.random() * care.length)]; q.textContent = window.taFit ? window.taFit(careTxt) : careTxt; }
    const inp = document.getElementById('piggy-reply-in'); if (inp) inp.value = '';
    box.hidden = false;
  }
  function piggyCloseCare() { const b = document.getElementById('piggy-reply'); if (b) b.hidden = true; }
  // 打开时 TA 有概率「塞给你」一枚硬币：越久没来概率越高。只是心意彩蛋——
  // 不写进真实存钱账目，只提示你替 TA 存进去，由你自己决定。
  function piggyMaybeTa() {
    const s = piggyStore(); if (!s) return;
    let last = 0; try { last = parseInt(s.get('piggy-last-visit') || '0', 10) || 0; } catch (e) {}
    const gap = Date.now() - last;
    try { s.set('piggy-last-visit', '' + Date.now()); } catch (e) {}
    const prob = gap > 12 * 3600000 ? 0.45 : (gap > 3600000 ? 0.25 : 0.12);
    if (Math.random() >= prob) return;
    const amt = PIGGY_TA_COINS[Math.floor(Math.random() * PIGGY_TA_COINS.length)];
    const notes = libPool('piggy', '塞硬币悄悄话', PIGGY_TA_NOTES);
    const note = notes[Math.floor(Math.random() * notes.length)];
    vibrate([20, 60, 20]);
    setTimeout(() => { piggyShowMsg(window.taFit ? window.taFit(note + ' ¥' + piggyFmt(amt) + ' · 替TA存进去？') : (note + ' ¥' + piggyFmt(amt) + ' · 替TA存进去？')); }, 400);
  }
  // FIX 2026-09-18 #770：心意币页签若停在上次位置，重进 app 不再经过页签 click，TA 塞币/取回
  // 两条彩蛋就永远没机会跑——app 入口按页签当前状态补触发一次（页签 click 路径保持原样）。
  if (piggyApp) piggyApp.addEventListener('click', () => {
    if (editingNow()) return;
    openPage(piggyPage); piggyMaybeTa(); piggyRender();
    const coinBox = document.querySelector('.piggy-coin');
    if (coinBox && !coinBox.hidden) { piggyCoinMaybeTa(); piggyCoinMaybeTaWithdraw(); }
  });
  document.getElementById('piggy-back').addEventListener('click', () => backHome(piggyPage));
  // 右上角设置：两步（存钱=TA随机塞 / 取钱=TA余额快没取回）
  // v3.29.x：原第 3、4 步「申请概率 / 申请每日上限」已移到聊天页红包半框「设置」，按联系人单独设
  const piggyCoinSetBtn = document.getElementById('piggy-coin-set');
  if (piggyCoinSetBtn) piggyCoinSetBtn.addEventListener('click', function () {
    if (editingNow() || !window.openModal) return;
    const p = piggyCoinProbGet();
    const ks = ['deposit', 'withdraw'];
    const def = [Math.round(p.deposit * 100), Math.round(p.withdraw * 100)];
    const titles = ['设置 · 存钱概率（TA 随机塞心意币）', '设置 · 取钱概率（TA 余额快没时取回）'];
    const hints = ['0-100 %，默认 ' + def[0], '0-100 %，默认 ' + def[1]];
    let phase = 0;
    function clampU(x) { const n = parseInt(String(x == null ? '' : x).trim(), 10); return isNaN(n) ? def[phase] : Math.max(0, Math.min(100, n)); }
    const ctl = window.openModal(titles[0], String(def[0]), function (v) {
      if (phase < 1) {
        const cur = clampU(v); const nv = { deposit: p.deposit, withdraw: p.withdraw, ask: p.ask };
        nv[ks[phase]] = cur / 100; piggyCoinProbSave(nv); Object.assign(p, nv);
        phase++;
        ctl.stay(); ctl.title(titles[phase]); ctl.ph(hints[phase]); ctl.text(String(def[phase])); ctl.maxLen(3); ctl.okText('下一步'); toast('已保存 ' + cur + '%');
        return;
      }
      const cur = clampU(v); const nv = { deposit: p.deposit, withdraw: p.withdraw, ask: p.ask };
      nv[ks[phase]] = cur / 100; piggyCoinProbSave(nv);
      toast('已保存 ' + cur + '%');
    }, { maxlength: 3, inputmode: 'decimal', placeholder: hints[0], staticText: '「TA 申请心意币」的概率与每日上限已移到聊天页红包的「设置」里，可按每个联系人单独设置。' + (function () { let g = 100; try { g = window.dcfGet ? window.dcfGet('piggy') : 100; } catch (e) {} return g < 100 ? ' ⚠ 已被「其他互动功能字卡 → 存钱罐」总闸压到 ' + g + '%，低于 100% 时 TA 塞币会被按比例拦截。' : ''; })() });
    ctl.okText('下一步');
  });
  // 存入/取出/小心愿：单弹窗两阶段（ctl.stay 就地切阶段）——取代旧「60ms 再开
  // 第二层」嵌套写法，真机键盘收起/聚焦竞态不再卡住第二步（与钱包弹窗同款）。
  document.getElementById('piggy-in').addEventListener('click', () => {
    if (editingNow() || !window.openModal) return;
    let amt = 0, phase = 1;
    const ctl = window.openModal('存入金额（元）', '', (v) => {
      if (phase === 1) {
        amt = piggyAmt(v);
        if (!amt) { if (String(v || '').trim()) toast('金额没看懂，再试试'); return; }
        phase = 2;
        ctl.stay();
        ctl.title(window.taFit ? window.taFit('跟TA说一句（可不填）') : '跟TA说一句（可不填）');
        ctl.maxLen(40); ctl.ph('留言可不填，直接点【存入】'); ctl.text('');
        ctl.okText('存入');
        return;
      }
      piggyAdd('in', amt, String(v || '').trim());
    }, { maxlength: 10, inputmode: 'decimal', placeholder: '存多少' });
  });
  document.getElementById('piggy-out').addEventListener('click', () => {
    if (editingNow() || !window.openModal) return;
    const bal = piggyBal();
    if (bal <= 0) { toast('罐子还是空的哦'); return; }
    let amt = 0, phase = 1;
    const ctl = window.openModal('取出金额（元）· 可用 ' + piggyFmt(bal), '', (v) => {
      if (phase === 1) {
        amt = piggyAmt(v);
        if (!amt) { if (String(v || '').trim()) toast('金额没看懂，再试试'); return; }
        if (amt > piggyBal()) { toast('罐子里没有这么多'); return; }
        phase = 2;
        ctl.stay();
        ctl.title('用在哪啦（可不填）');
        ctl.maxLen(40); ctl.ph('用途可不填，直接点【取出】'); ctl.text('');
        ctl.okText('取出');
        return;
      }
      piggyAdd('out', amt, String(v || '').trim());
    }, { maxlength: 10, inputmode: 'decimal', placeholder: '取多少' });
  });
  document.getElementById('piggy-set-goal').addEventListener('click', () => {
    if (editingNow() || !window.openModal) return;
    let gName = '', phase = 1;
    const ctl = window.openModal('小心愿（如：一起去看海）', '', (v) => {
      if (phase === 1) {
        gName = String(v || '').trim();
        if (!gName) { toast('先写个心愿吧'); return; }
        phase = 2;
        ctl.stay();
        ctl.title('目标金额（元）');
        ctl.maxLen(9); ctl.ph('想攒多少'); ctl.text('');
        ctl.okText('下一步 · 选监督人');
        return;
      }
      const amt = piggyAmt(v);
      if (!amt) { toast('金额没看懂，再试试'); return; }
      piggyOpenShare(gName, amt);
    }, { maxlength: 16, placeholder: '心愿名' });
  });
  // 监督人选择：全局金库人人可见余额，但每个心愿可指定哪些联系人（桌面）可见/监督。
  // ['*']=全部；默认勾选当前桌面。多选 chips，点「全部桌面」互斥。
  let piggyDraft = null;
  function piggyOpenShare(n, a, kind) {
    piggyDraft = { n: n, a: a, kind: kind || 'real' };
    const chips = document.getElementById('piggy-share-chips');
    const box = document.getElementById('piggy-share');
    if (!chips || !box) { piggyCommitShare([]); return; }
    let list = [];
    try { list = (window.getContacts ? window.getContacts() : []).map(function (c) { return { id: c.id, name: c.name }; }); } catch (e) {}
    if (!list.some(function (c) { return c.id === 'default'; })) list.unshift({ id: 'default', name: '默认' });
    const me = window.__activeCid || 'default';
    let h = '<span class="pg-chip" data-cid="*">全部桌面</span>';
    list.forEach(function (c) {
      h += '<span class="pg-chip' + (c.id === me ? ' on' : '') + '" data-cid="' + piggyEsc(c.id) + '">' + piggyEsc(c.name || c.id) + '</span>';
    });
    chips.innerHTML = h;
    box.hidden = false;
  }
  function piggyCommitShare(sel) {
    if (!piggyDraft) return;
    if (sel.indexOf('*') >= 0) sel = [];
    const isCoin = piggyDraft.kind === 'coin';
    if (isCoin) {
      const gs = piggyCoinGoals();
      gs.push({ n: piggyDraft.n, a: piggyDraft.a, ms: [], done: false, by: sel });
      piggySaveCoinGoals(gs); piggySetCoinCur(gs.length - 1);
    } else {
      const gs = piggyGoals();
      gs.push({ n: piggyDraft.n, a: piggyDraft.a, ms: [], done: false, by: sel });
      piggySaveGoals(gs); piggySetCur(gs.length - 1);
    }
    piggyDraft = null;
    piggyRender();
    if (isCoin) piggyCoinRender();
    toast('已添加');
  }
  document.getElementById('piggy-share').addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.classList && t.classList.contains('pg-chip')) {
      if (t.getAttribute('data-cid') === '*') {
        document.querySelectorAll('#piggy-share-chips .pg-chip').forEach(c => c.classList.toggle('on', c === t));
      } else {
        t.classList.toggle('on');
        if (t.classList.contains('on')) {
          const star = document.querySelector('#piggy-share-chips .pg-chip[data-cid="*"]');
          if (star) star.classList.remove('on');
        }
      }
      return;
    }
    if (t.id === 'piggy-share-ok') {
      const box = document.getElementById('piggy-share');
      if (!piggyDraft) { if (box) box.hidden = true; return; }
      const sel = [];
      document.querySelectorAll('#piggy-share-chips .pg-chip.on').forEach(c => sel.push(c.getAttribute('data-cid')));
      if (!sel.length) { toast('至少选一个监督人'); return; }
      if (box) box.hidden = true;
      piggyCommitShare(sel);
      return;
    }
    if (t.id === 'piggy-share-cancel') { piggyDraft = null; const b = document.getElementById('piggy-share'); if (b) b.hidden = true; }
  });
  document.getElementById('piggy-add-msg').addEventListener('click', () => {
    if (editingNow() || !window.openModal) return;
    window.openModal(window.taFit ? window.taFit('添加TA的碎碎念（存钱时说）') : '添加TA的碎碎念（存钱时说）', '', (v) => {
      const t = String(v || '').trim(); if (!t) return;
      const a = piggyUserCards(); a.push(t); piggySaveUserCards(a); toast('已添加');
    }, { maxlength: 30 });
  });
  // 心愿单点击委托：＋添加 / 点行切换当前心愿 / ✕ 删除（确认弹窗）
  document.getElementById('piggy-goals').addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'piggy-goal-add') { piggyOpenAddGoal(); return; }
    if (t.classList && t.classList.contains('pg-del')) {
      const idx = parseInt(t.getAttribute('data-del'), 10);
      const gs = piggyGoals();
      if (!(idx >= 0 && idx < gs.length)) return;
      if (!window.openModal) return;
      window.openModal('删除心愿「' + gs[idx].n + '」？', '', () => {
        const gs2 = piggyGoals(); gs2.splice(idx, 1);
        let cur = piggyCur(); if (cur >= gs2.length) cur = 0;
        piggySaveGoals(gs2); piggySetCur(cur);
        piggyRender(); toast('已删除');
      }, { noInput: true });
      return;
    }
    const row = t.closest ? t.closest('[data-pick]') : null;
    if (row) {
      if (editingNow()) return;
      piggySetCur(parseInt(row.getAttribute('data-pick'), 10));
      piggyRender();
    }
  });
  function piggyOpenAddGoal() {
    if (editingNow() || !window.openModal) return;
    document.getElementById('piggy-set-goal').click();
  }
  // 记录展开/收起
  document.getElementById('piggy-hist').addEventListener('click', (e) => {
    if (e.target && e.target.id === 'piggy-more') { piggyHistAll = !piggyHistAll; piggyRender(); }
  });
  // 取款后回复 TA
  document.getElementById('piggy-reply-send').addEventListener('click', () => {
    if (editingNow()) return;
    const inp = document.getElementById('piggy-reply-in');
    const t = inp ? String(inp.value || '').trim() : '';
    if (t && window.chatSendMsg) { try { window.chatSendMsg(t); } catch (e) {} toast('已回复'); }
    piggyCloseCare();
  });
  document.getElementById('piggy-reply-skip').addEventListener('click', piggyCloseCare);
  document.getElementById('piggy-reply-in').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); document.getElementById('piggy-reply-send').click(); }
  });

  // ---- 心意币存钱（per-cid 独立罐，我和当前联系人的共用存钱罐）----
  // 世界观：把 app 里的「心意币」转进存钱罐真正存起来（转入从 gift-wallet 真扣、取出退回）；
  // 我和联系人共用一个余额（不分账户）；TA 不上线时偶发塞币（彩蛋，不经过 gift-wallet）。
  // v3.27.x：改 per-cid——每个联系人一份独立存钱罐，可在顶部切换查看不同联系人；数据键
  // piggy-coin2-* 走 storeFor(viewCid) 命名空间。旧全局 piggy-coin-*（含 my/ta 双账户）
  // 一次性合并迁移到 default 命名空间。
  let piggyCoinViewCid = null; // null=跟随当前桌面联系人；否则=存钱罐内查看的联系人
  function piggyCoinViewCidActive() { return piggyCoinViewCid || (window.__activeCid || 'default'); }
  function piggyCoinStore() { try { return window.storeFor(piggyCoinViewCidActive()); } catch (e) { return null; } }
  function piggyCoinViewName() {
    const cid = piggyCoinViewCidActive();
    if (cid === 'default') { try { const l = window.getContacts ? window.getContacts() : []; const d = l.find(function (c) { return c.id === 'default'; }); return (d && d.name) || '默认'; } catch (e) { return '默认'; } }
    return piggyContactName(cid);
  }
  function piggyCoinIsCurrent() { return piggyCoinViewCidActive() === (window.__activeCid || 'default'); }
  // 旧全局双账户数据一次性迁移到 default 命名空间（合并 my+ta 余额为单条记录）
  function piggyCoinMigrate() {
    const g = window.xyStore ? window.xyStore('xy-home-v2') : null; if (!g) return;
    try { if (g.get('piggy-coin2-migrated')) return; } catch (e) { return; }
    try {
      const ds = window.storeFor('default');
      const oldLog = JSON.parse(g.get('piggy-coin-log') || '[]');
      if (Array.isArray(oldLog) && oldLog.length) {
        const newLog = oldLog.filter(function (x) { return x && typeof x.amt === 'number'; }).map(function (x) {
          return { t: x.t || Date.now(), type: x.type === 'out' ? 'out' : 'in', amt: x.amt, note: x.note || (x.side === 'ta' ? 'TA 存入' : '存入') };
        });
        ds.set('piggy-coin2-log', JSON.stringify(newLog));
      }
      const oldGoals = JSON.parse(g.get('piggy-coin-goals') || 'null');
      if (Array.isArray(oldGoals) && oldGoals.length) ds.set('piggy-coin2-goals', JSON.stringify(oldGoals));
      const oldCur = g.get('piggy-coin-goal-cur'); if (oldCur) ds.set('piggy-coin2-goal-cur', oldCur);
    } catch (e) {}
    try { g.set('piggy-coin2-migrated', '1'); } catch (e) {}
  }
  const COIN_TA_COINS = [5.2, 5.21, 6.66, 8.88, 9.99, 13.14, 52, 52.1];
  const COIN_TA_NOTES = ['偷偷塞了一把心意币', '你的心意币变多了', '帮你多存了一点', '嘿嘿，攒着别乱花'];
  const COIN_IN_MSG = ['心意币存进来啦', '又攒下一点，真棒', '小金币替你看管着', '离攒币心愿更近了', '安心，都替你收好'];
  const COIN_FULL_MSG = ['攒够心意币啦！！', '目标达成，想好怎么花了吗'];
  const COIN_OUT_MSG = ['取回心意币啦', '金币不多，省着点哦'];
  function piggyCoinLog() { const s = piggyCoinStore(); if (!s) return []; try { const a = JSON.parse(s.get('piggy-coin2-log') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function piggySaveCoinLog(a) { const s = piggyCoinStore(); if (s) try { s.set('piggy-coin2-log', JSON.stringify(a)); } catch (e) {} }
  function piggyCoinBal(a) { let n = 0; (a || piggyCoinLog()).forEach(function (x) { n += ((x && x.type) === 'out' ? -1 : 1) * ((x && x.amt) || 0); }); return Math.round(n * 100) / 100; }
  function piggyCoinGoals() {
    const s = piggyCoinStore(); let a = null;
    try { a = JSON.parse(s.get('piggy-coin2-goals') || 'null'); } catch (e) {}
    if (!Array.isArray(a)) { try { s.set('piggy-coin2-goals', '[]'); } catch (e) {} a = []; }
    return a.filter(function (g) { return g && g.n && (+g.a) > 0; }).map(function (g) {
      return { n: String(g.n), a: Math.round((+g.a) * 100) / 100, ms: Array.isArray(g.ms) ? g.ms.slice() : [], done: !!g.done, by: Array.isArray(g.by) ? g.by.filter(function (x) { return x && typeof x === 'string'; }) : [] };
    });
  }
  function piggySaveCoinGoals(a) { const s = piggyCoinStore(); if (s) try { s.set('piggy-coin2-goals', JSON.stringify(a)); } catch (e) {} }
  function piggyCoinCur() { const s = piggyCoinStore(); try { return parseInt(s.get('piggy-coin2-goal-cur') || '0', 10) || 0; } catch (e) { return 0; } }
  function piggySetCoinCur(i) { const s = piggyCoinStore(); if (s) try { s.set('piggy-coin2-goal-cur', '' + i); } catch (e) {} }
  function piggyCoinActive() {
    const all = piggyCoinGoals(); const vis = [];
    all.forEach(function (g, i) { vis.push({ g: g, i: i }); });
    if (!vis.length) return { g: null, i: -1, all: all, vis: vis };
    const cur = piggyCoinCur(); let hit = null;
    for (let k = 0; k < vis.length; k++) if (vis[k].i === cur) { hit = vis[k]; break; }
    if (!hit) hit = vis[0];
    return { g: hit.g, i: hit.i, all: all, vis: vis };
  }
  // 心愿进度用共用余额（per-cid 单账户）
  function piggyCoinGoalState() {
    const act = piggyCoinActive(); const bal = piggyCoinBal();
    const pct = act.g ? Math.min(100, Math.max(0, Math.round(bal / act.g.a * 100))) : 0;
    return { act: act, bal: bal, pct: pct };
  }
  function piggyCoinShowMsg(txt) { const el = document.getElementById('coin-msg'); if (el) { el.classList.add('fade'); setTimeout(function () { el.textContent = '\u201c' + txt + '\u201d'; el.classList.remove('fade'); }, 200); } }
  function piggyCoinRowHtml(x) {
    const d = new Date((x && x.t) || Date.now());
    // 精确到秒：MM-DD HH:MM:SS
    const ds = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    const out = x && x.type === 'out';
    return '<div class="piggy-row"><span class="pr-amt ' + (out ? 'out' : 'in') + '">' + (out ? '\u2212' : '+') + '¥' + piggyFmt((x && x.amt) || 0) + '</span><span class="pr-note">' + piggyEsc((x && x.note) || (out ? '取出' : '存入')) + '</span><span class="pr-date">' + ds + '</span></div>';
  }
  let piggyCoinHistAll = false;
  function piggyCoinRender() {
    const total = piggyCoinBal();
    const lbl = document.getElementById('coin-contact-label'); if (lbl) lbl.textContent = '我和 ' + piggyCoinViewName() + ' 的存钱罐';
    const totEl = document.getElementById('coin-bal-total'); if (totEl) totEl.innerHTML = '<i>¥</i>' + piggyFmt(total < 0 ? 0 : total);
    const st = piggyCoinGoalState(); const g = st.act.g;
    const sub = document.getElementById('coin-sub'); const fill = document.getElementById('coin-fill');
    if (g) {
      if (fill) fill.style.width = st.pct + '%';
      if (sub) sub.textContent = g.done ? ('已攒满 ' + piggyFmt(g.a) + ' 心意币') : ('已存 ' + piggyFmt(Math.max(0, total)) + ' / ' + piggyFmt(g.a) + '（' + st.pct + '%）');
    } else {
      if (fill) fill.style.width = '0';
      if (sub) sub.textContent = '把心意币存起来，攒一个心愿';
    }
    const glEl = document.getElementById('piggy-coin-goals');
    if (glEl) {
      let h = '<div class="piggy-hist-top"><span class="piggy-hist-title">攒币心愿</span><button class="piggy-more" id="coin-goal-add">＋ 添加</button></div>';
      if (!st.act.all.length) h += '<div class="piggy-empty">还没有攒币心愿，点右上角添加</div>';
      else st.act.vis.forEach(function (ent) {
        const gg = ent.g; const p = Math.min(100, Math.max(0, Math.round(total / gg.a * 100)));
        h += '<div class="pg-row' + (ent.i === st.act.i ? ' cur' : '') + '" data-coinpick="' + ent.i + '">' +
          '<span class="pg-name' + (gg.done ? ' done' : '') + '"><span class="pg-nm">' + piggyEsc(gg.n) + (gg.done ? ' ✓' : '') + '</span></span>' +
          '<span class="pg-amt">¥' + piggyFmt(gg.a) + '</span>' +
          '<span class="pg-bar"><i style="width:' + p + '%"></i></span><span class="pg-pct">' + p + '%</span>' +
          '<button class="pg-del" data-coindel="' + ent.i + '">✕</button></div>';
      });
      glEl.innerHTML = h;
    }
    const log = piggyCoinLog(); const hist = document.getElementById('piggy-coin-hist');
    if (hist) {
      let body;
      if (!log.length) body = '<div class="piggy-empty">还没存过心意币，投第一枚进来吧</div>';
      else if (!piggyCoinHistAll) body = log.slice(-6).reverse().map(piggyCoinRowHtml).join('');
      else {
        const asc = log.slice().sort(function (a, b) { return (a && a.t || 0) - (b && b.t || 0); });
        const parts = []; let curKey = ''; let sum = 0;
        asc.forEach(function (x) {
          const d = new Date((x && x.t) || Date.now()); const key = d.getFullYear() + '-' + d.getMonth();
          if (key !== curKey) {
            if (curKey !== '') parts.push('<div class="pr-sub">小结 · ' + (sum >= 0 ? '+' : '\u2212') + '¥' + piggyFmt(Math.abs(sum)) + '</div>');
            curKey = key; sum = 0;
            parts.push('<div class="pr-month">' + d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月</div>');
          }
          sum += ((x && x.type === 'out' ? -1 : 1) * ((x && x.amt) || 0)); parts.push(piggyCoinRowHtml(x));
        });
        parts.push('<div class="pr-sub">小结 · ' + (sum >= 0 ? '+' : '\u2212') + '¥' + piggyFmt(Math.abs(sum)) + '</div>'); body = parts.join('');
      }
      hist.innerHTML = '<div class="piggy-hist-top"><span class="piggy-hist-title">心意币记录</span>' +
        (log.length ? '<button class="piggy-more" id="coin-more">' + (piggyCoinHistAll ? '只看最近' : '全部记录') + '</button>' : '') +
        '</div>' + body;
    }
  }
  function piggyCoinWalletCan(amt) {
    if (!window.giftWalletGet) return true;
    try { const w = window.giftWalletGet(); return w.myBalance >= Math.round(amt * 100); } catch (e) { return true; }
  }
  // 存入：从我的心意币账本真扣，记入当前查看联系人的共用存钱罐；在聊天发系统消息提醒
  function piggyCoinAdd(amt, note) {
    const fen = Math.round(amt * 100);
    try { if (window.giftWalletChange) window.giftWalletChange(-fen, 0); } catch (e) {}
    const log = piggyCoinLog(); log.push({ t: Date.now(), type: 'in', amt: amt, note: note || '' });
    piggySaveCoinLog(log); piggyCoinRender();
    if (piggyCoinIsCurrent()) { try { if (window.chatAddSystem) window.chatAddSystem('我往存钱罐存了 ¥' + piggyFmt(amt), {}); } catch (e) {} }
    const st = piggyCoinGoalState(); const bal = piggyCoinBal(log);
    if (st.act.g && !st.act.g.done) {
      if (bal >= st.act.g.a) {
        const gs = st.act.all; [25, 50, 75].forEach(function (m) { if (gs[st.act.i].ms.indexOf(m) < 0) gs[st.act.i].ms.push(m); }); gs[st.act.i].done = true;
        piggySaveCoinGoals(gs); vibrate([60, 40, 60]); piggyCoinShowMsg(piggyPick(COIN_FULL_MSG));
        let nxt = -1; for (let k = 0; k < st.act.vis.length; k++) { if (st.act.vis[k].i !== st.act.i && !st.act.vis[k].g.done) { nxt = st.act.vis[k].i; break; } }
        if (nxt >= 0) piggySetCoinCur(nxt);
        piggyCoinRender(); return;
      }
      for (let k = 0; k < PIGGY_MS.length; k++) { const m = PIGGY_MS[k]; if (bal >= st.act.g.a * m.p / 100 && st.act.g.ms.indexOf(m.p) < 0) { const gs = st.act.all; gs[st.act.i].ms.push(m.p); piggySaveCoinGoals(gs); vibrate([40, 30, 40]); piggyCoinShowMsg(m.t); return; } }
    }
    piggyCoinShowMsg(piggyPick(COIN_IN_MSG));
  }
  // 取出：退回我的心意币账本；在聊天发系统消息提醒
  function piggyCoinOutput(amt, note) {
    const fen = Math.round(amt * 100);
    try { if (window.giftWalletChange) window.giftWalletChange(fen, 0); } catch (e) {}
    const log = piggyCoinLog(); log.push({ t: Date.now(), type: 'out', amt: amt, note: note || '' });
    piggySaveCoinLog(log); piggyCoinRender();
    if (piggyCoinIsCurrent()) { try { if (window.chatAddSystem) window.chatAddSystem('我从存钱罐取了 ¥' + piggyFmt(amt), {}); } catch (e) {} }
    piggyCoinShowMsg(piggyPick(COIN_OUT_MSG));
  }
  // 心意币概率配置（root 命名空间，供 chat.js 读取申请概率）：{ deposit(塞币/存钱), withdraw(取钱), ask(申请) }，均存 0-1 小数
  function piggyCoinProbGet() {
    const s = piggyStore(); let p = null;
    if (s) { try { p = JSON.parse(s.get('piggy-coin-prob') || 'null'); } catch (e) {} }
    return {
      deposit: (p && typeof p.deposit === 'number') ? p.deposit : 0.12,
      withdraw: (p && typeof p.withdraw === 'number') ? p.withdraw : 0.25,
      ask: (p && typeof p.ask === 'number') ? p.ask : 0.04
    };
  }
  function piggyCoinProbSave(p) { const s = piggyStore(); if (s) try { s.set('piggy-coin-prob', JSON.stringify(p || {})); } catch (e) {} }
  // TA 不定期塞心意币到共用存钱罐（越久未开概率越高，彩蛋不入 gift-wallet）；只在查看当前联系人时触发
  // v3.42.x #422：塞币彩蛋接入「其他互动功能字卡」的存钱罐概率（dcf-piggy，默认 100%＝原行为，0%＝不塞币也不发系统消息）
  // FIX 2026-09-18 #770：last-visit 只在彩蛋真正触发时才刷新——旧写法「进页签先盖章再掷骰」，
  // 用户越勤快看间隔越短、概率被压回裸 12%，体感永远等不到 TA 塞币；改为未触发时 gap 继续累积
  //（上限仍封顶 0.95），「常来看」与「久没来」都能按时点概率正常出币。
  function piggyCoinMaybeTa() {
    if (!piggyCoinIsCurrent()) return;
    try { if (window.dcfGet && !(Math.random() * 100 < window.dcfGet('piggy'))) return; } catch (e) {}
    const s = piggyCoinStore(); if (!s) return;
    let last = 0; try { last = parseInt(s.get('piggy-coin2-last-visit') || '0', 10) || 0; } catch (e) {}
    const gap = Date.now() - last;
    const base = piggyCoinProbGet().deposit;
    const prob = gap > 12 * 3600000 ? Math.min(0.95, base + 0.33) : (gap > 3600000 ? Math.min(0.9, base + 0.13) : base);
    if (Math.random() >= prob) return;
    try { s.set('piggy-coin2-last-visit', '' + Date.now()); } catch (e) {}
    const amt = COIN_TA_COINS[Math.floor(Math.random() * COIN_TA_COINS.length)];
    const note = COIN_TA_NOTES[Math.floor(Math.random() * COIN_TA_NOTES.length)];
    const log = piggyCoinLog(); log.push({ t: Date.now(), type: 'in', amt: amt, note: 'TA 塞进来的' });
    piggySaveCoinLog(log); piggyCoinRender();
    vibrate([20, 40, 20]);
    try {
      const who = (window.chatPartnerName ? window.chatPartnerName() : '') || 'TA';
      if (window.chatAddSystem) window.chatAddSystem(who + ' 往存钱罐存了 ¥' + piggyFmt(amt), {});
    } catch (e) {}
    setTimeout(function () { piggyCoinShowMsg((window.taFit ? window.taFit(note) : note) + ' ¥' + piggyFmt(amt)); }, 300);
  }
  // TA 心意币余额快没时（systemBalance < ¥10），按配置概率从共用存钱罐取回，回补心意币账本
  function piggyCoinMaybeTaWithdraw() {
    if (!piggyCoinIsCurrent()) return;
    const s = piggyCoinStore(); if (!s) return;
    if (!window.giftWalletGet) return;
    const bal = piggyCoinBal();
    if (bal <= 0) return;
    let w = null; try { w = window.giftWalletGet(); } catch (e) {}
    if (!w || typeof w.systemBalance !== 'number') return;
    const LOW_FEN = 1000; // ¥10 视为「快没」
    if (w.systemBalance >= LOW_FEN) return;
    const prob = piggyCoinProbGet().withdraw;
    if (Math.random() >= prob) return;
    const fen = Math.round(bal * 100);
    try { if (window.giftWalletChange) window.giftWalletChange(0, fen); } catch (e) {}
    const log = piggyCoinLog(); log.push({ t: Date.now(), type: 'out', amt: bal, note: '心意币快花完了，TA 取回' });
    piggySaveCoinLog(log); piggyCoinRender();
    vibrate([20, 40, 20]);
    setTimeout(function () { piggyCoinShowMsg('心意币快没了，TA 取回 ¥' + piggyFmt(bal)); }, 300);
  }
  // 双 Tab 切换：现实存钱 / 心意币存钱
  const piggyTabs = document.querySelector('.piggy-tabs');
  if (piggyTabs) piggyTabs.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-ptab]') : null;
    if (!b || editingNow()) return;
    const on = b.getAttribute('data-ptab');
    document.querySelectorAll('.piggy-tabs .piggy-tab').forEach(function (x) { x.classList.toggle('on', x === b); });
    const real = document.querySelector('.piggy-real'); const coin = document.querySelector('.piggy-coin');
    if (real) real.hidden = (on !== 'real');
    if (coin) coin.hidden = (on !== 'coin');
    if (on === 'coin') { piggyCoinMigrate(); piggyCoinViewCid = null; piggyCoinRender(); piggyCoinMaybeTa(); piggyCoinMaybeTaWithdraw(); } else piggyRender();
  });
  // 心意币 存一笔：从我的心意币转入共用存钱罐
  document.getElementById('coin-in').addEventListener('click', function () {
    if (editingNow() || !window.openModal) return;
    window.openModal('存入心意币（元）', '', function (v) {
      const amt = piggyAmt(v);
      if (!amt) { if (String(v || '').trim()) toast('金额没看懂，再试试'); return; }
      if (!piggyCoinWalletCan(amt)) { toast('我的心意币不够哦'); return; }
      piggyCoinAdd(amt, '从我的心意币转入');
    }, { maxlength: 10, placeholder: '存多少' });
  });
  // 心意币 取一笔：退回我的心意币
  document.getElementById('coin-out').addEventListener('click', function () {
    if (editingNow() || !window.openModal) return;
    const bal = piggyCoinBal();
    if (bal <= 0) { toast('罐子里还没有心意币'); return; }
    window.openModal('取回心意币（元）· 可用 ' + piggyFmt(bal), '', function (v) {
      const amt = piggyAmt(v);
      if (!amt) { if (String(v || '').trim()) toast('金额没看懂，再试试'); return; }
      if (amt > bal) { toast('罐里没有这么多'); return; }
      piggyCoinOutput(amt, '退回我的心意币');
    }, { maxlength: 10, placeholder: '取回多少' });
  });
  // 心意币存钱：切换查看的联系人（不切桌面，只切存钱罐查看）
  document.getElementById('coin-contact-switch').addEventListener('click', function () {
    if (editingNow()) return;
    let list = []; try { list = window.getContacts ? window.getContacts() : []; } catch (e) {}
    if (!list.length) list = [{ id: 'default', name: '默认' }];
    let m = document.getElementById('coin-contact-picker');
    if (!m) { m = document.createElement('div'); m.id = 'coin-contact-picker'; m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4)'; document.body.appendChild(m); m.addEventListener('click', function (e) { if (e.target === m) m.style.display = 'none'; }); }
    m.style.display = 'flex'; m.hidden = false;
    const cur = piggyCoinViewCidActive();
    const box = document.createElement('div');
    box.style.cssText = 'width:min(92vw,380px);max-height:72vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    let h = '<div style="font-size:16px;font-weight:600;margin-bottom:12px">切换联系人（查看存钱罐）</div><div class="ccp-list" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1;min-height:0">';
    list.forEach(function (c) {
      const on = c.id === cur;
      h += '<div class="ccp-row" data-cid="' + piggyEsc(c.id) + '" style="display:flex;align-items:center;gap:10px;padding:11px;border:1px solid ' + (on ? '#c98a2b' : 'var(--card-border,#eee)') + ';border-radius:10px;cursor:pointer"><span style="width:8px;height:8px;border-radius:50%;background:' + (on ? '#c98a2b' : '#ccc') + '"></span><span style="flex:1;font-size:14px;font-weight:500">' + piggyEsc(c.name || c.id) + '</span>' + (on ? '<span style="font-size:11px;color:#c98a2b">当前</span>' : '') + '</div>';
    });
    h += '</div><button class="ccp-close" style="width:100%;margin-top:12px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)">关闭</button>';
    box.innerHTML = h;
    m.innerHTML = ''; m.appendChild(box);
    box.querySelector('.ccp-close').addEventListener('click', function () { m.style.display = 'none'; });
    box.querySelectorAll('.ccp-row').forEach(function (row) {
      row.addEventListener('click', function () {
        const cid = row.getAttribute('data-cid');
        piggyCoinViewCid = (cid === (window.__activeCid || 'default')) ? null : cid;
        m.style.display = 'none'; piggyCoinRender();
      });
    });
  });
  // 攒币心愿
  document.getElementById('coin-set-goal').addEventListener('click', function () {
    if (editingNow() || !window.openModal) return;
    let gName = '', phase = 1;
    const ctl = window.openModal('攒币心愿（如：一起去旅行）', '', function (v) {
      if (phase === 1) {
        gName = String(v || '').trim();
        if (!gName) { toast('先写个心愿吧'); return; }
        phase = 2; ctl.stay(); ctl.title('目标心意币（元）'); ctl.maxLen(9); ctl.ph('想攒多少'); ctl.text(''); ctl.okText('下一步 · 选监督人');
        return;
      }
      const amt = piggyAmt(v);
      if (!amt) { toast('金额没看懂，再试试'); return; }
      piggyOpenShare(gName, amt, 'coin');
    }, { maxlength: 16, placeholder: '心愿名' });
  });
  // 攒币心愿单委托：＋添加 / 点行切换 / ✕ 删除
  document.getElementById('piggy-coin-goals').addEventListener('click', function (e) {
    const t = e.target; if (!t) return;
    if (t.id === 'coin-goal-add') { document.getElementById('coin-set-goal').click(); return; }
    if (t.classList && t.classList.contains('pg-del')) {
      const idx = parseInt(t.getAttribute('data-coindel'), 10);
      const gs = piggyCoinGoals(); if (!(idx >= 0 && idx < gs.length)) return;
      if (!window.openModal) return;
      window.openModal('删除心愿「' + gs[idx].n + '」？', '', function () {
        const gs2 = piggyCoinGoals(); gs2.splice(idx, 1); let cur = piggyCoinCur(); if (cur >= gs2.length) cur = 0;
        piggySaveCoinGoals(gs2); piggySetCoinCur(cur); piggyCoinRender(); toast('已删除');
      }, { noInput: true });
      return;
    }
    const row = t.closest ? t.closest('[data-coinpick]') : null;
    if (row) { if (editingNow()) return; piggySetCoinCur(parseInt(row.getAttribute('data-coinpick'), 10)); piggyCoinRender(); }
  });
  // 心意币记录展开/收起
  document.getElementById('piggy-coin-hist').addEventListener('click', function (e) { if (e.target && e.target.id === 'coin-more') { piggyCoinHistAll = !piggyCoinHistAll; piggyCoinRender(); } });

  // ---- 番茄钟 · 陪伴模式 ----
  // 专属聊天窗（#page-pmp-chat）：陪伴期间所有对话只进独立小窗，不写普通聊天记录；
  // 普通聊天页仅保留倒计时状态条。会话持久化（endAt 时间戳，刷新/重开继续）；切联系人自动退出。
  const PMP_GREET = ['好，我陪着你', '去吧，我在这等你', '专注吧，我不吵你', '嗯，一起加油'];
  const PMP_ENC = ['在呢', '继续哦', '摸摸头', '嗯嗯，陪你', '快了快了', '我在看你专注'];
  const PMP_DONE = ['🍅 完成一个！为你骄傲', '🍅 太棒了，去休息一下吧', '🍅 收工！今天也超认真'];
  const PMP_REPLIES = ['嗯嗯，我在', '专心哦，我看着你呢', '加油，很快就完成了', '嗯，陪你', '别分心呀，专注完再聊', '好，一起加油', '我在呢，安心专注'];
  const PMP_TIRED = ['累就先歇口气，深呼吸一下', '辛苦啦，摸摸头，再坚持一小会儿', '累了就慢一点，我不催你'];
  let pmpRec = null;
  try { pmpRec = JSON.parse((pomoStore() && pomoStore().get('pomo-companion')) || 'null'); } catch (e) { pmpRec = null; }
  if (!pmpRec || typeof pmpRec !== 'object') pmpRec = null;
  const chatPageEl = document.getElementById('page-chat');
  const pmpBar = document.createElement('div');
  pmpBar.className = 'pmp-bar'; pmpBar.id = 'pmp-bar'; pmpBar.hidden = true;
  pmpBar.innerHTML =
    '<span class="pmp-bar-time" id="pmp-bar-time">25:00</span>' +
    '<span class="pmp-bar-label" id="pmp-bar-label">专注中</span>' +
    '<button class="pmp-bar-toggle" id="pmp-bar-toggle">暂停</button>' +
    '<button class="pmp-bar-more" id="pmp-bar-more">⋯</button>' +
    '<div class="pmp-progress"><div class="pmp-progress-fill" id="pmp-fill"></div></div>';
  const pmpMenu = document.createElement('div');
  pmpMenu.className = 'pmp-menu'; pmpMenu.id = 'pmp-menu'; pmpMenu.hidden = true;
  pmpMenu.innerHTML =
    '<button data-pmp="page" type="button">回番茄钟页</button>' +
    '<button data-pmp="settings" type="button">陪伴设置</button>' +
    '<button data-pmp="quit" type="button">提前结束</button>';
  if (chatPageEl) {
    const anchor = document.getElementById('chat-body');
    if (anchor) { chatPageEl.insertBefore(pmpMenu, anchor); chatPageEl.insertBefore(pmpBar, pmpMenu); }
    else chatPageEl.appendChild(pmpBar);
  }

  // —— 专属陪伴聊天窗：独立全屏页，与普通聊天完全隔离 ——
  const pmpCPage = document.createElement('div');
  pmpCPage.className = 'page'; pmpCPage.id = 'page-pmp-chat'; pmpCPage.hidden = true;
  pmpCPage.innerHTML =
    '<div class="chat-head"><span class="ch-back" id="pmpc-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="ch-name">陪伴专注</span></div>' +
    '<div class="pmp-cd" id="pmp-cd">' +
      '<div class="pmp-cd-time" id="pmp-cd-time">25:00</div>' +
      '<div class="pmp-cd-label" id="pmp-cd-label">专注中 · TA 陪着你</div>' +
      '<div class="pmp-cd-ctrls"><button class="pmp-bar-toggle" id="pmp-cd-toggle">暂停</button><button class="pmp-bar-more" id="pmp-cd-more">⋯</button></div>' +
      '<div class="pmp-cd-progress"><div class="pmp-progress-fill" id="pmp-cd-fill"></div></div>' +
    '</div>' +
    '<div class="pmp-menu" id="pmp-c-menu" hidden><button data-pmpc="page" type="button">回番茄钟页</button><button data-pmpc="settings" type="button">陪伴设置</button><button data-pmpc="quit" type="button">提前结束</button></div>' +
    '<div class="pmp-c-chat">' +
      '<div class="pmp-c-chat-title">悄悄话 · 陪着聊（辅助功能）</div>' +
      '<div class="pmp-c-list" id="pmp-c-list"></div>' +
      '<div class="pmp-c-inputbar"><input class="pmp-c-in" id="pmp-c-in" type="text" maxlength="120" placeholder="想说点什么…（TA 安静陪着）"><button class="pmp-c-send" id="pmp-c-send">发送</button></div>' +
    '</div>';
  host.appendChild(pmpCPage);

  function pmpLog() { try { const a = JSON.parse((pomoStore() && pomoStore().get('pomo-companion-log')) || '[]'); if (Array.isArray(a)) return a; } catch (e) {} return []; }
  function pmpLogSave(a) { const s = pomoStore(); if (!s) return; try { s.set('pomo-companion-log', JSON.stringify(a.slice(-300))); } catch (e) {} }
  function pmpEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pmpCRender() {
    const box = document.getElementById('pmp-c-list'); if (!box) return;
    const a = pmpLog();
    if (!a.length) {
      box.innerHTML = '<div class="pmp-c-empty">这里是陪伴模式的专属小窗<br>专注时的鼓励和悄悄话都在这里<br>不会进普通聊天记录</div>';
      return;
    }
    let h = '';
    for (let i = 0; i < a.length; i++) {
      // v3.x.x：称呼跟随——TA 的陪伴消息在渲染层替换（存储原文不动）
      const t = (a[i].w !== 'me' && window.taFit) ? window.taFit(a[i].t) : a[i].t;
      h += '<div class="pmp-c-row' + (a[i].w === 'me' ? ' me' : '') + '"><div class="pmp-c-bub">' + pmpEsc(t) + '</div></div>';
    }
    box.innerHTML = h;
    box.scrollTop = box.scrollHeight;
  }
  function pmpCAdd(who, text) {
    const a = pmpLog(); a.push({ w: who === 'me' ? 'me' : 'ta', t: String(text || ''), ts: Date.now() }); pmpLogSave(a);
    if (!pmpCPage.hidden) pmpCRender();
  }
  let pmpReplyTimer = null;
  // 陪伴设置：是否让 TA 优先用【聊天】里的字卡回复（自定义回复字卡 + 默认字卡 + 附加表情卡，取文本卡）。
  // 全局共享，所有桌面一致。默认开。
  function pmpUseChatCards() { const s = pomoStore(); try { return s.get('pomo-cmp-usecards') !== '0'; } catch (e) { return true; } }
  function pmpSetUseChatCards(on) { const s = pomoStore(); if (s) try { s.set('pomo-cmp-usecards', on ? '1' : '0'); } catch (e) {} }
  function pmpOpenSettings() {
    if (!window.openModal) return;
    const on = pmpUseChatCards();
    window.openModal('陪伴设置', '', (v) => {
      if (v !== '0' && v !== '1') return;
      pmpSetUseChatCards(v === '1');
      toast(v === '1' ? '已开启：TA 会用【聊天】字卡回复你' : '已关闭：TA 不再用【聊天】字卡回复');
    }, {
      noInput: true, lock: true, pill: on ? '1' : '0',
      pills: [{ label: '用【聊天】字卡回复（开）', value: '1' }, { label: '不用（关）', value: '0' }],
      staticText: '开启后，陪伴中的 TA 会优先用你在【聊天】里设置的字卡回复你；关闭则只用陪伴自带的常回话。'
    });
  }
  function pmpChatCardText() {
    try {
      if (!window.getPool) return '';
      const t = window.getPool().text || [];
      // 排除空串与拍一拍（getPool 已过滤拍一拍），也排除媒体 dataURL
      const arr = t.filter(s => typeof s === 'string' && s.trim() && s.indexOf('data:') !== 0 && !/^https?:\/\//i.test(s) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(s))); // FIX 2026-09-13 #394 令牌卡不进悬浮伴侣话术；FIX 2026-09-15 #533 URL 媒体卡同款排除
      return (arr.length && Math.random() < 0.7) ? arr[Math.floor(Math.random() * arr.length)] : '';
    } catch (e) { return ''; }
  }
  function pmpCReply(userText) {
    clearTimeout(pmpReplyTimer);
    const t = String(userText || '');
    let pool = PMP_REPLIES;
    if (/累|难|烦|倦|困/.test(t)) pool = PMP_TIRED;
    else if (/完成|好了|结束|收工/i.test(t)) pool = PMP_DONE;
    let txt = pool[Math.floor(Math.random() * pool.length)];
    if (pmpUseChatCards()) { const card = pmpChatCardText(); if (card) txt = card; }
    pmpReplyTimer = setTimeout(() => { try { vibrate([30]); } catch (e) {} pmpCAdd('ta', txt); }, 700 + Math.random() * 800);
  }
  function pmpCSend() {
    const inp = document.getElementById('pmp-c-in');
    const t = inp ? String(inp.value || '').trim() : '';
    if (!t) return;
    if (inp) inp.value = '';
    pmpCAdd('me', t);
    pmpCReply(t);
  }
  document.getElementById('pmpc-back').addEventListener('click', () => backHome(pmpCPage));
  document.getElementById('pmp-c-send').addEventListener('click', pmpCSend);
  document.getElementById('pmp-c-in').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); pmpCSend(); }
  });
  function pmpActive() { return !!pmpRec; }
  function pmpSave() { const s = pomoStore(); if (!s) return; try { if (pmpRec) s.set('pomo-companion', JSON.stringify(pmpRec)); else s.remove('pomo-companion'); } catch (e) {} }
  function pmpDetach() {
    clearTimeout(pmpEncTimer);
    clearTimeout(pmpReplyTimer);
    pmpRec = null; pmpSave();
    pmpMenu.hidden = true;
    const cm = document.getElementById('pmp-c-menu'); if (cm) cm.hidden = true;
    pmpSyncBar();
  }
  function pmpSyncFromEngine() {
    if (!pmpActive()) return;
    pmpRec.paused = pomoRunning ? 0 : 1;
    if (pomoRunning) { pmpRec.endAt = pomoEndAt; pmpRec.remainMs = 0; }
    else pmpRec.remainMs = pomoRemainMs;
    pmpSave();
    if (pomoRunning) pmpScheduleEnc();
    pmpRefreshBar();
  }
  function pmpRefreshBar() {
    if (!pmpActive()) return;
    const remainMs = Math.max(0, pomoRunning ? pomoEndAt - Date.now() : (pmpRec.remainMs || pmpRec.totalMs));
    const sec = Math.ceil(remainMs / 1000);
    const tmTxt = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    const lbTxt = pomoRunning ? '专注中 · TA 陪着你' : '已暂停';
    const tgTxt = pomoRunning ? '暂停' : '继续';
    [['pmp-bar-time', 'pmp-bar-label', 'pmp-bar-toggle', 'pmp-fill'], ['pmp-cd-time', 'pmp-cd-label', 'pmp-cd-toggle', 'pmp-cd-fill']].forEach((ids) => {
      const tm = document.getElementById(ids[0]);
      if (tm) tm.textContent = tmTxt;
      const lb = document.getElementById(ids[1]);
      if (lb) lb.textContent = lbTxt;
      const tg = document.getElementById(ids[2]);
      if (tg) tg.textContent = tgTxt;
      const fl = document.getElementById(ids[3]);
      if (fl && pmpRec.totalMs) fl.style.width = Math.min(100, Math.max(0, (1 - remainMs / pmpRec.totalMs) * 100)) + '%';
    });
  }
  let pmpFlashing = false;
  let pmpFlashTimer = null;
  function pmpFlash(txt) {
    pmpFlashing = true;
    [['pmp-bar-time', 'pmp-bar-toggle', 'pmp-bar-more', 'pmp-fill', 'pmp-bar-label'], ['pmp-cd-time', 'pmp-cd-toggle', 'pmp-cd-more', 'pmp-cd-fill', 'pmp-cd-label']].forEach((ids) => {
      const tm = document.getElementById(ids[0]); if (tm) tm.textContent = '00:00';
      const tg = document.getElementById(ids[1]); if (tg) tg.style.display = 'none';
      const mo = document.getElementById(ids[2]); if (mo) mo.style.display = 'none';
      const fl = document.getElementById(ids[3]); if (fl) fl.style.width = '100%';
      const lb = document.getElementById(ids[4]); if (lb) lb.textContent = txt;
    });
    if (chatPageEl) pmpBar.hidden = !!chatPageEl.hidden;
    clearTimeout(pmpFlashTimer);
    pmpFlashTimer = setTimeout(() => {
      pmpFlashing = false;
      ['pmp-bar-toggle', 'pmp-bar-more', 'pmp-cd-toggle', 'pmp-cd-more'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = ''; });
      // 会话已随完成结束：专属窗顶部倒计时条收起（普通聊天页状态条由 pmpSyncBar 自行隐藏）
      if (!pmpActive()) {
        const cd = document.getElementById('pmp-cd'); if (cd) cd.hidden = true;
        const cm2 = document.getElementById('pmp-c-menu'); if (cm2) cm2.hidden = true;
      }
      pmpSyncBar();
      if (!pmpCPage.hidden && pmpActive()) pmpRefreshBar();
    }, 2600);
  }
  function pmpSyncBar() {
    if (!chatPageEl) return;
    const show = (pmpActive() || pmpFlashing) && !chatPageEl.hidden;
    pmpBar.hidden = !show;
    if (show) { if (pmpActive()) pmpRefreshBar(); }
    else pmpMenu.hidden = true;
  }
  let pmpEncTimer = null;
  function pmpScheduleEnc() {
    clearTimeout(pmpEncTimer);
    if (!pmpActive() || pmpRec.paused || (pmpRec.enc || 0) >= 2) return;
    const now = Date.now();
    if (!pmpRec.nextEncAt || pmpRec.nextEncAt < now - 30000) {
      pmpRec.nextEncAt = now + (5 + Math.random() * 3) * 60000;
      pmpSave();
    }
    pmpEncTimer = setTimeout(pmpMaybeEnc, Math.max(1000, Math.min(60000, pmpRec.nextEncAt - now)));
  }
  function pmpMaybeEnc() {
    if (!pmpActive() || pmpRec.paused) return;
    const now = Date.now();
    if (pomoRunning && now >= pmpRec.nextEncAt && (pmpRec.enc || 0) < 2) {
      pmpRec.enc = (pmpRec.enc || 0) + 1;
      pmpRec.nextEncAt = now + (5 + Math.random() * 3) * 60000;
      pmpSave();
      try { pmpCAdd('ta', PMP_ENC[Math.floor(Math.random() * PMP_ENC.length)]); } catch (e) {}
    }
    pmpScheduleEnc();
  }
  function pmpRefreshGoBtn() {
    const gb = document.getElementById('pomo-companion');
    if (gb) gb.textContent = pmpActive() ? (pmpRec.paused ? '陪伴已暂停 · 返回陪伴' : '陪伴中 · 返回陪伴') : '🍅 陪伴模式';
  }
  // 暂停/继续（普通聊天页状态条与专属窗共用一套引擎操作）
  function pmpToggleRun() {
    if (!pmpActive()) return;
    if (pomoRunning) {
      pomoRemainMs = Math.max(0, pomoEndAt - Date.now());
      pomoRunning = false; pomoStopTick();
    } else {
      pomoEndAt = Date.now() + (pmpRec.remainMs || pmpRec.totalMs);
      pomoRunning = true; pomoStartTick();
    }
    pmpSyncFromEngine(); pomoRender();
  }
  // 提前结束确认弹窗（两个入口共用）；结束后 TA 回应进专属窗，若在专属窗内则带回番茄钟页
  function pmpQuitAsk() {
    if (!window.openModal) return;
    window.openModal('提前结束这个番茄？', '', (v) => {
      if (v !== '1') return;
      if (pomoRunning) { pomoRunning = false; pomoStopTick(); }
      pomoRemainMs = 0; pomoMode = 'focus';
      const inWin = !pmpCPage.hidden;
      try { pmpCAdd('ta', '没事，休息一下也可以'); } catch (e) {}
      pmpDetach(); pomoRender();
      if (inWin) { openPage(pomoPage); pomoRender(); }
    }, { noInput: true, lock: true, pill: '1', pills: [{ label: '结束', value: '1' }, { label: '再撑一会儿', value: '0' }], staticText: '提前结束的话，这个 🍅 就不计入今天啦' });
  }
  // 入口：番茄钟页「陪伴模式」按钮——未在跑则开一个新专注并挂上陪伴；进入/返回的都是专属聊天窗
  const pmpGoBtn = document.getElementById('pomo-companion');
  if (pmpGoBtn) pmpGoBtn.addEventListener('click', () => {
    if (editingNow()) return;
    if (pmpActive()) { openPage(pmpCPage); pmpCRender(); return; }
    if (pomoMode !== 'focus') { pomoRunning = false; pomoRemainMs = 0; pomoStopTick(); pomoMode = 'focus'; }
    if (!pomoRunning) {
      pomoRemainMs = 0;
      pomoEndAt = Date.now() + pomoModeMin('focus') * 60000;
      pomoRunning = true; pomoStartTick();
    }
    pmpRec = { mode: 'focus', totalMs: pomoModeMin('focus') * 60000, endAt: pomoEndAt, startedAt: Date.now(), paused: 0, remainMs: 0, enc: 0, nextEncAt: 0 };
    pmpSave();
    // v3.16.x：记录一次番茄陪伴时间（主页「TA的关心」展示）
    try { if (window.addCareRecord) window.addCareRecord('pomo', ''); } catch (e) {}
    const cdEl = document.getElementById('pmp-cd'); if (cdEl) cdEl.hidden = false;
    try { pmpCAdd('ta', PMP_GREET[Math.floor(Math.random() * PMP_GREET.length)]); } catch (e) {}
    pmpScheduleEnc();
    pmpSyncBar(); pomoRender();
    openPage(pmpCPage); pmpCRender();
  });
  // 倒计时条按钮：暂停/继续 与 ⋯ 菜单（普通聊天页状态条）
  const pmpToggleBtn = document.getElementById('pmp-bar-toggle');
  if (pmpToggleBtn) pmpToggleBtn.addEventListener('click', pmpToggleRun);
  const pmpMoreBtn = document.getElementById('pmp-bar-more');
  if (pmpMoreBtn) pmpMoreBtn.addEventListener('click', () => { pmpMenu.hidden = !pmpMenu.hidden; });
  pmpMenu.querySelectorAll('button[data-pmp]').forEach(b => b.addEventListener('click', () => {
    pmpMenu.hidden = true;
    if (b.dataset.pmp === 'page') { openPage(pomoPage); pomoRender(); return; }
    if (b.dataset.pmp === 'settings') { pmpOpenSettings(); return; }
    if (b.dataset.pmp !== 'quit') return;
    pmpQuitAsk();
  }));
  // 专属窗内的暂停/继续与 ⋯ 菜单
  const pmpCdToggle = document.getElementById('pmp-cd-toggle');
  if (pmpCdToggle) pmpCdToggle.addEventListener('click', pmpToggleRun);
  const pmpCdMore = document.getElementById('pmp-cd-more');
  if (pmpCdMore) pmpCdMore.addEventListener('click', () => { const m = document.getElementById('pmp-c-menu'); if (m) m.hidden = !m.hidden; });
  document.querySelectorAll('#pmp-c-menu button[data-pmpc]').forEach(b => b.addEventListener('click', () => {
    const m = document.getElementById('pmp-c-menu'); if (m) m.hidden = true;
    if (b.dataset.pmpc === 'page') { openPage(pomoPage); pomoRender(); return; }
    if (b.dataset.pmpc === 'settings') { pmpOpenSettings(); return; }
    if (b.dataset.pmpc !== 'quit') return;
    pmpQuitAsk();
  }));
  // 聊天页显隐时同步条显示
  if (chatPageEl) new MutationObserver(pmpSyncBar).observe(chatPageEl, { attributes: true, attributeFilter: ['hidden'] });
  // 陪伴会话全局共享：切换联系人不再退出陪伴（数据存根命名空间，可跨桌面继续）
  // 启动恢复：上次会话还在进行 → 引擎接续走；已在关闭期间完成 → 补记一个 🍅
  (function pmpRestore() {
    if (!pmpRec) return;
    if (pmpRec.mode !== 'focus' || !pmpRec.totalMs) { pmpDetach(); return; }
    const now = Date.now();
    pomoMode = 'focus';
    if (pmpRec.paused) {
      pomoRunning = false; pomoStopTick(); pomoRemainMs = pmpRec.remainMs || pmpRec.totalMs;
      pmpScheduleEnc();
    } else if (pmpRec.endAt > now) {
      pomoRemainMs = 0; pomoEndAt = pmpRec.endAt; pomoRunning = true; pomoStartTick();
      pmpScheduleEnc();
    } else {
      const t = pomoToday(); t.count++; pomoSaveToday(t);
      pomoSaveTotal(pomoTotal() + 1);
      // v3.13.x：关闭期间完成的专注同样结算补偿摸鱼
      try { const c2 = Math.max(1, Math.round(pomoModeMin('focus') / 10)); if (window.addFishPts) window.addFishPts(c2, 0); } catch (e) {}
      // silent:true——启动早期音频子系统未必就绪，勿因提示音阻断恢复流程
      try { pmpCAdd('ta', '🍅 你刚才完成了一个专注，回来看到啦，很棒'); } catch (e) {}
      pmpDetach();
    }
    pmpSyncBar();
  })();
  pmpRefreshGoBtn();

  // v3.26.x(#122)：注册番茄钟陪伴模式内置话术池跨分类搜索（字卡库列表页搜索同源可查，不再搜不到）
  window.__cardSearchFns = window.__cardSearchFns || [];
  window.__cardSearchFns.push({ name: '番茄钟陪伴', fn: function (kw) {
    const out = [];
    try {
      [PMP_GREET, PMP_ENC, PMP_DONE, PMP_REPLIES, PMP_TIRED].forEach(arr => (arr || []).forEach(c => { if (String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: '陪伴模式·' + (arr === PMP_GREET ? '开场' : arr === PMP_ENC ? '鼓励' : arr === PMP_DONE ? '完成' : arr === PMP_REPLIES ? '回应' : '累了') }); }));
    } catch (e) {}
    return out;
  } });

  document.addEventListener('contact-switched', () => {
    tpStopFlow();
    if (!pmpCPage.hidden) backHome(pmpCPage);
    if (!tpPage.hidden) tpPick();
    if (!ssPage.hidden) ssRenderCount();
    if (!waterPage.hidden) waterRender();
    if (!pomoPage.hidden) pomoRender();
    if (!piggyPage.hidden) piggyRender();
  });
})();

// ===== v3.x：世界观·TA 摸鱼值自动涨时桌面偶尔飘一行小字 =====
// TA 摸鱼值由 personalize.js 每 60s 60% 概率自动涨（"他在那边也偷了个懒"的来源）。
// 这里只做监听：值变化且通过频率控制（冷却 45 分钟 + 每日最多 12 次 + 35% 随机，
// 让"他一整天都可能摸鱼被看见"，又不至于刷屏）时，桌面浮一行小字。
// v3.13.x：浮字 6 秒内可点——「抓包成功」：并触发一条害羞回应进聊天；不点就只是看着 TA 涨（原行为不变）。
// #844：抓包结算改为「距上次抓包以来 TA 涨的全部」——旧实现只翻倍触发浮字那一个 60 秒窗口的涨幅
//（平均 +5），浮字有 45 分钟冷却＋35% 概率，冷却期里涨的几十点全被跳过，奖励远小于实际懒账。
(function () {
  let lastTa = null;
  let settledTa = null; // 上次抓包结算基线（fish-total-ta）；只随抓包推进，浮字未点不结算
  // v3.13.x：浮字/抓包回应改走系统预设字卡池（DEFAULT_CARD_DATA.fish，字卡库「摸鱼浮字」
  // tab 同源可查看/逐张开关）；过滤用户已关闭的卡片，池缺失时回退内置兜底
  const FISH_NOTE_FALLBACK = ['ta在那边也偷了个懒'];
  const CATCH_REPLIES = [
    '呀…被你看到了',
    '才、才没有偷懒…好吧，被抓到了',
    '被你抓包了……脸有点烫',
    '哼，下次偷偷的，不让你发现',
    '抓到就抓到……要抱一下才肯继续摸',
    '……罚我陪你十分钟行不行'
  ];
  function fishPool(name, fallback) {
    let arr = (window.getFishPool ? window.getFishPool(name, fallback) : fallback).slice();
    if (window.isDefaultCardOff) arr = arr.filter(c => !window.isDefaultCardOff('fish', c));
    return arr.length ? arr : fallback.slice();
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  // FIX 2026-09-07 #224 作用域修复：#132 在本 IIFE 的 chk 里引用了上方另一 IIFE（2083-4304）
  // 内的 dcfP，作用域不通必抛 ReferenceError（用户诊断日志每分钟 dcfP is not defined，且
  // chk 中断后 lastTa 不更新、下次继续报）。本作用域自备同语义助手（走 window.dcfGet，
  // 未设置时 dcfGet 内部已回退内置默认表）。
  function dcfPFish(def) { try { if (window.dcfGet) return window.dcfGet('fish'); } catch (e) {} return def; }
  // FIX 2026-09-16 #604：游戏面板/游戏页开着时不飘「摸鱼浮字」——这条浮字是限时可点的
  // 「点我抓包」（pointer-events:auto + fixed 居中偏下），正好盖在棋盘与方向键上抢点按，
  // 用户报「玩游戏的时候还会触发联系人摸鱼抓包弹窗，挡住我玩游戏」。
  // 判据＝任一游戏面板/游乐室页可见；hidden=false 但零渲染盒（早已切页的残留态）不算，
  // 与 mobile-adapt floatIsOpen 同口径（#427 踩过零渲染盒误判）。
  const GAME_PANEL_IDS = ['chat-snake-panel', 'chat-pong-panel', 'chat-brick-panel', 'chat-rps-panel', 'chat-c4-panel',
    'chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-memory-panel', 'chat-ms-panel',
    'chat-fish-panel', 'chat-auction-panel', 'chat-gift-panel', 'chat-arcade-panel', 'page-arcade', 'chat-rp-panel'];
  function gamePanelOpen() {
    try {
      for (let i = 0; i < GAME_PANEL_IDS.length; i++) {
        const el = document.getElementById(GAME_PANEL_IDS[i]);
        if (el && !el.hidden && el.getClientRects().length > 0) return true;
      }
    } catch (e) {}
    return false;
  }
  function chk() {
    if (document.hidden) return;
    // 放在 taChimeAllow/taChimeUse 之前：跳过时不吃 45 分钟冷却与每日 12 次额度，
    // 出游戏后这次涨值照样能飘（lastTa 不推进，delta 留着）。
    if (gamePanelOpen()) return;
    // #791 摸鱼抓包浮字开关（回复设置 →「摸鱼值 / 工作值」组「摸鱼抓包浮字」，存 reply-fish-grab-en，
    // 默认开）：关＝不飘字也不抓包。放在 taChimeAllow 之前——不吃 45 分钟冷却与每日 12 次额度
    //（与上面 gamePanelOpen 跳过同口径）；摸鱼值累计本身由 fish-en 管，这里不碰。
    try {
      const gv = window.replyCfg ? window.replyCfg()['fish-grab-en'] : undefined;
      if (gv !== undefined && gv !== 1) return;
    } catch (e) {}
    const s = window.activeStore && window.activeStore(); if (!s) return;
    let cur = 0; try { cur = parseInt(s.get('fish-total-ta') || '0', 10) || 0; } catch (e) {}
    if (lastTa === null) { lastTa = cur; settledTa = cur; return; }
    const delta = cur - lastTa;
    // v3.32.x #132：摸鱼字卡概率接 dcf-fish（默认 35%=原值，单值替换非叠加）
    if (delta > 0 && Math.random() * 100 < dcfPFish(35) && window.taChimeAllow && window.taChimeAllow('fish-ta-note', { cooldown: 45 * 60 * 1000, dailyMax: 12 })) {
      window.taChimeUse('fish-ta-note');
      if (window.taChimeShow) {
        const note = pick(fishPool('摸鱼浮字', FISH_NOTE_FALLBACK));
        window.taChimeShow(note, {
          dur: 6000,
          onClick: function () {
            try {
              // #844 抓包结算＝距上次抓包以来 TA 涨的全部（触发浮字前的展示时刻值，浮字 6 秒展示期新涨的归入下次结算）：
              // TA 补一份总账，我得同额。旧实现只补 delta（单个 60s 窗口涨幅），冷却期涨值全被吞
              const base = settledTa === null ? cur - Math.max(0, delta) : settledTa;
              const bonus = Math.max(1, cur - base);
              // 基线含 TA 收到的这份补账：抓包奖励不是 TA 摸出来的，不进下次懒账（防连抓利滚利）
              settledTa = cur + bonus;
              if (window.addFishPts) window.addFishPts(bonus, bonus);
              let rec = null;
              try { rec = JSON.parse(s.get('fish-catch-day') || 'null'); } catch (e) {}
              const dk = (function () { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
              if (!rec || rec.date !== dk) rec = { date: dk, n: 0 };
              rec.n++; s.set('fish-catch-day', JSON.stringify(rec));
              // v3.15.x：抓包事件写入主页「摸鱼抓包」记录（双向之一：我抓到 TA）
              if (window.addFishCatchRecord) {
                try { window.addFishCatchRecord('me', '抓包成功！双方摸鱼值 +' + bonus); } catch (e) {}
              }
              if (window.toast) window.toast(window.taFit ? window.taFit('抓包成功！双方摸鱼值 +' + bonus) : ('抓包成功！双方摸鱼值 +' + bonus));
              if (window.chatAddIn) {
                const r = pick(fishPool('抓包回应', CATCH_REPLIES));
                // v3.14.x：带「摸鱼抓包」标签 chip（addIn opts.tag），用户能看出这是抓包后的回应
                // v3.15.x：正文已在气泡里，chip 不再重复一遍 label——mood 自定义空 label，只留「摸鱼抓包」标签
                setTimeout(() => { try { window.chatAddIn(window.taFit ? window.taFit(r) : r, { mood: [{ tag: '摸鱼抓包', label: '' }] }); } catch (e) {} }, 900);
              }
            } catch (e) {}
          }
        });
      }
    }
    lastTa = cur;
  }
  setInterval(chk, 60 * 1000);
  setTimeout(chk, 5000);
  document.addEventListener('contact-switched', () => { lastTa = null; settledTa = null; });
})();
