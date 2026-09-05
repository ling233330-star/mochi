// ===== 功能：底部 tab 页面切换 + 独立全屏页导航隐藏 + 状态栏隐藏 =====
(function () {
  const tabs = document.querySelectorAll('.tab');
  const pages = document.querySelectorAll('.page');
  // v3.27.x：切页前抢拍钩子（device.js 屏幕适配监视注册 __mochiLeaveSnap）——
  // syncChrome 的 blur 会在切页瞬间触发键盘残留自愈（#209 K70 实锤：停靠残留只
  // 存在于切页前最后一帧），必须在 pages hidden 之前同步采集，晚了就是自愈后
  const sdLeaveSnap = () => { try { if (window.__mochiLeaveSnap) window.__mochiLeaveSnap('switch'); } catch (e) {} };
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sdLeaveSnap();
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      pages.forEach(p => p.hidden = true);
      document.getElementById(tab.dataset.page).hidden = false;
    });
  });

  // 独立全屏页：隐藏底部导航栏 + 状态栏（Mochi/时间），页面自身补偿内边距
  const FULL_PAGES = ['page-chat', 'page-group-chat', 'page-chat-settings', 'page-custom-cards', 'page-default-cards', 'page-fun-cards', 'page-mood-cards', 'page-reply-cards', 'page-theme', 'page-fav', 'page-fav-settings', 'page-memory', 'page-calendar', 'page-period', 'page-accounting', 'page-garden', 'page-divine', 'page-music', 'page-stats', 'page-interact', 'page-checkin', 'page-ta-ask', 'page-ta-choose', 'page-ta-curious', 'page-ta-roast', 'page-ta-checkin', 'page-ta-invite', 'page-checkin-cards', 'page-quote-cards', 'page-home', 'page-mail', 'page-mail-write', 'page-mail-reply', 'page-feed', 'page-feed-all', 'page-feed-friends', 'page-license', 'page-about', 'page-reply-settings', 'page-call-settings', 'page-sfx-settings', 'page-memo-arc', 'page-cjian', 'page-room', 'page-drift', 'page-my-arc'];
  function syncChrome() {
    const phone = document.querySelector('.phone');
    const tabbar = document.querySelector('.tabbar');
    const visible = Array.from(document.querySelectorAll('.page')).find(p => !p.hidden);
    const isFull = visible ? FULL_PAGES.indexOf(visible.id) >= 0 : false;
    if (tabbar) tabbar.hidden = isFull;
    if (phone) phone.classList.toggle('no-statusbar', isFull);
    if (visible) visible.classList.toggle('full', isFull);
    // v3.5.116：页面切换时收起输入法——输入框若仍聚焦，键盘会盖住新页面，
    // 全屏/手机端表现为「按钮位置错误、页面被键盘挡一半」（切回桌面/聊天设置等）
    // v3.5.127：contenteditable 输入框（聊天输入栏 div 版）同样需 blur 收起输入法
    try {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) ae.blur();
    } catch (e) {}
  }
  // 监听所有页面 hidden 变化（任何页面切换都会触发）
  document.querySelectorAll('.page').forEach(p => {
    const mo = new MutationObserver(syncChrome);
    mo.observe(p, { attributes: true, attributeFilter: ['hidden'] });
  });
  syncChrome();

  // 外观与主题：设置页点击进入独立页面，返回回设置页
  const appearanceRow = document.getElementById('row-appearance');
  const themePage = document.getElementById('page-theme');
  const themeBack = document.getElementById('theme-back');
  if (appearanceRow && themePage) {
    appearanceRow.addEventListener('click', () => {
      sdLeaveSnap();
      pages.forEach(p => p.hidden = true);
      themePage.hidden = false;
    });
  }
  if (themeBack) {
    themeBack.addEventListener('click', () => {
      sdLeaveSnap();
      pages.forEach(p => p.hidden = true);
      const setPage = document.getElementById('page-setting');
      if (setPage) setPage.hidden = false;
    });
  }
})();

// ===== 全屏 PWA 安卓返回键（v3.5.96）：先关弹层 → 回上一页 → 最后退出应用 =====
// 全屏模式下没有浏览器返回栏，安卓返回手势/按键默认直接退出应用；
// 改为与微信一致：弹层优先关闭，其次页面回退（页面切换入栈），栈空才退出
(function () {
  // 仅 PWA 安装模式（standalone/fullscreen）启用返回键拦截；浏览器标签页模式交给浏览器自带返回
  const inPwa = window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (!inPwa) return;
  const PAGES = Array.from(document.querySelectorAll('.page'));
  function visiblePage() { return PAGES.find(p => !p.hidden); }
  const first = visiblePage();
  if (first) history.replaceState({ page: first.id }, '');
  let stack = [];
  // v3.5.132：初始页入栈——否则从桌面直接进入任何页面（第一跳只 push 1 个条目），
  // 返回键判定 stack.length<=1 直接放行，无法回到桌面
  if (first) stack.push(first.id);
  const mo = new MutationObserver(() => {
    const v = visiblePage();
    if (!v) return;
    const last = stack.length ? stack[stack.length - 1] : null;
    if (last !== v.id) {
      stack.push(v.id);
      history.pushState({ page: v.id }, '');
    }
  });
  PAGES.forEach(p => mo.observe(p, { attributes: true, attributeFilter: ['hidden'] }));
  window.addEventListener('popstate', () => {
    // 1) 弹层优先关闭（不改变页面栈）——与 mobile-adapt.js 的滚动穿透锁同一组浮层，
    //    微信式交互：按返回先关面板（表情/更多/拍一拍/搜索/半框等），再退页面
    const layers = ['img-view-mask', 'modal-mask', 'qa-mask', 'tc-mask', 'poke-card', 'emoji-panel',
      'chat-more-panel', 'chat-search', 'chat-decision-panel', 'chat-divine-panel', 'chat-snake-panel',
      'avlib-card', 'ck-panel', 'feed-notice-panel', 'desk-msg', 'chat-ask-panel', 'msg-actions'];
    for (const id of layers) {
      const el = document.getElementById(id);
      if (el && !el.hidden) { el.hidden = true; return; }
    }
    const mg = document.querySelector('.mg-mask:not([hidden])');
    if (mg) { mg.hidden = true; return; }
    // 2) 来电中 → 走完整拒绝逻辑；通话中 → 挂断
    const callMask = document.getElementById('call-mask');
    if (callMask && !callMask.hidden) {
      const reject = document.getElementById('call-reject-btn');
      if (reject && !reject.hidden) { reject.click(); return; }
      const hang = document.getElementById('call-hang-btn');
      if (hang && !hang.hidden) { hang.click(); return; }
      callMask.hidden = true;
      return;
    }
    // 3) 回上一页；已在初始页 → 不拦截，浏览器/系统退出应用
    if (stack.length <= 1) return;
    stack.pop();
    const target = stack[stack.length - 1];
    // v3.27.x：返回键回退也是切页，hidden 前同样抢拍（本 IIFE 无 sdLeaveSnap 引用，直调钩子）
    try { if (window.__mochiLeaveSnap) window.__mochiLeaveSnap('switch'); } catch (e) {}
    PAGES.forEach(p => { p.hidden = p.id !== target; });
    // v3.5.131：返回键回退页面时同步退出桌面装修模式（否则 editing 类残留，
    // 之后点 app 图标被 `if (editing) return` 静默吞掉，表现为"点了没反应"）
    try {
      if (window.exitDecor) window.exitDecor();
    } catch (e) {}
    // 补回一个 history 条目，防止浏览器误判直接退出
    history.pushState({ page: target }, '');
  });
})();
