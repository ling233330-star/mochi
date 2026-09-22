// ===== 功能：状态栏显示真实时间 =====
(function () {
  const el = document.getElementById('clock');
  if (!el) return;
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  function update() {
    const d = new Date();
    el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  update();
  setInterval(update, 15000); // 每 15 秒校准一次
})();

// ===== v3.26.x：防骗+署名禁倒卖声明「运行时回填」——删掉源码/产物里的字也没用 =====
// template.html 里放的两条置顶声明是静态兜底；这里再用 JS 常量 + 官方远程源强制回填。
// 只要元素缺失（被删）或文案被改，加载时就会重新写回「开屏顶部两条 + 设置页底部」。
// 想彻底去掉必须连这段逻辑一起删——等于改代码本身；有网时再从作者官方站点取权威文案
// 覆盖本地（二传者自己部署的副本也会向官方域名拉取），防二改者连 JS 里的字一起改。
// （本机制 f7a8b5c 首建、0965278 清理时被整块移除，现按防倒卖需求恢复并扩展双条。）
(function () {
  const OFFICIAL_NOTICE = 'https://ling233330-star.github.io/mochi/notice.json';
  const MARK_KEY = '小红书@言序（1842523578）';
  // 两条声明：tag 对应静态 DOM 的 data-anti-scam 标记；key 为 notice.json 权威字段；marks 为在位判定特征词
  // #621：防骗 + 署名禁倒卖合并为一张置顶声明卡（用户要求「并成一张」）。
  // keys = 该卡按序拼接的 notice.json 权威字段（alert + alert2）；marks = 在位判定特征词（两段特征都在才算在位）。
  const BARS = [
    { tag: '1', title: '免费 · 署名 · 防倒卖', keys: ['alert', 'alert2'],
      marks: ['免费', '诈骗', '署名', '倒卖', MARK_KEY] }
  ];
  const texts = {}; // notice 字段 -> 当前权威文案（先本地兜底，官方拉取后覆盖）
  texts['alert'] = 'Mochi字卡网站完全免费，作者只有小红书这一个账号：小红书@言序（1842523578）。如有出现任何收费情况，均为诈骗，注意防止被骗。';
  texts['alert2'] = '二传、分享本站链接必须标注作者署名：小红书 @言序（1842523578），禁止删除或修改。严禁冒为自己制作、删除篡改署名，或以任何形式收费倒卖本站链接、安装包——本站完全免费，收费即诈骗。如果你是花钱买来的链接：你被骗了，请拒付退款并举报卖家。';
  // 一张卡正文 = 各权威字段按序拼接
  function barText(bar) { return bar.keys.map(function (k) { return texts[k] || ''; }).filter(Boolean).join(' '); }
  // 判定一条置顶块文案是否仍为官方声明（标题+全部特征词在位才认为在位，避免每次重建；
  // 空白归一化——文案里「小红书 @言序」带空格而锚点串不带，空格差异不能算被篡改）
  function marked(box, bar) {
    const t = (box.textContent || '').replace(/\s+/g, '');
    const title = bar.title.replace(/\s+/g, '');
    return t.indexOf(title) > -1 && bar.marks.every(function (m) { return t.indexOf(m) > -1; });
  }
  // 开屏置顶块（#613 起：防骗卡在公告区第 1 张；署名禁倒卖卡仍在置顶声明区 = 防未成年锁卡之后）
  // v8.29 #976：7 张必读卡整组前移到 #splash-mustread（品牌卡之前）后，本回填的
  //   ①查找范围放宽到整个开屏滚动容器（卡片搬到哪个容器都能认领，不再写死 #splash-notice）；
  //   ②重建插入点＝必读卡组最顶（保持「合并声明卡在必读区最顶」这条口径）；老副本没有
  //   #splash-mustread 时回退 #splash-notice——二传副本（旧结构）照常被兜住。
  function splashHost() {
    return document.getElementById('splash-mustread') || document.getElementById('splash-notice');
  }
  function splashScope() {
    return document.getElementById('splash-box') || document;
  }
  function ensureBar(bar, refNode) {
    const host = splashHost();
    if (!host) return null;
    const scope = splashScope();
    let box = scope.querySelector('.splash-alert[data-anti-scam="' + bar.tag + '"]');
    if (!box) {
      // 兼容旧副本/标记被删：按官方标题文本认领已有置顶块
      const heads = scope.querySelectorAll('.splash-alert .splash-alert-t');
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].textContent.trim() === bar.title) { box = heads[i].parentNode; break; }
      }
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'splash-alert';
      host.insertBefore(box, refNode || host.firstChild);
    }
    box.setAttribute('data-anti-scam', bar.tag);
    if (!marked(box, bar)) { // 缺失或被改 → 重建/改写回官方文案
      box.innerHTML = '<div class="splash-alert-t"></div><p></p>';
      box.querySelector('.splash-alert-t').textContent = bar.title;
      box.querySelector('p').textContent = barText(bar);
    }
    return box;
  }
  // 设置页底部块（#page-setting 版本行下方）：防骗+署名禁倒卖 合并为一段
  function ensureSettings() {
    const page = document.getElementById('page-setting');
    if (!page) return;
    let box = page.querySelector('.set-alert');
    const st = box ? (box.textContent || '') : '';
    if (box && MARK_KEY && st.indexOf(MARK_KEY) > -1 && st.indexOf('免费') > -1 && st.indexOf('倒卖') > -1) return;
    if (!box) {
      box = document.createElement('div');
      const anchor = page.querySelector('.ver-credit') || null;
      page.insertBefore(box, anchor ? anchor.nextSibling : null);
    }
    box.className = 'set-alert';
    box.setAttribute('data-anti-scam', 's');
    box.innerHTML = '<b></b>';
    box.querySelector('b').textContent = texts['alert'];
    box.appendChild(document.createTextNode(' ' + texts['alert2']));
  }
  // 远程时效公告（可选）：官方 notice.json 下发 { bulletin: { text, until } }，until=epoch 毫秒（缺省/过期自动摘除）。
  // 用途：临时插播场景（如发现倒卖，对所有联网副本含二传远程挂横幅）；notice.json 不带 bulletin 字段 = 完全不显示，零开销。
  let bulletin = null;
  function ensureBulletin() {
    const host = splashHost(); // #976：与置顶声明卡同一宿主（必读卡组，回退公告卡）
    if (!host) return;
    const scope = splashScope();
    let box = scope.querySelector('.splash-alert[data-anti-scam="3"]');
    const active = !!(bulletin && typeof bulletin.text === 'string' && bulletin.text.trim()
      && (!bulletin.until || Date.now() < bulletin.until));
    if (!active) { if (box) box.remove(); return; }
    const want = bulletin.text.trim();
    if (!box) {
      box = document.createElement('div');
      box.className = 'splash-alert';
      const b1 = scope.querySelector('.splash-alert[data-anti-scam="1"]');
      host.insertBefore(box, b1 ? b1.nextSibling : host.firstChild);
    }
    box.setAttribute('data-anti-scam', '3');
    if (box.textContent !== '公告' + want) { // 内容变化 → 重写（标题固定「公告」）
      box.innerHTML = '<div class="splash-alert-t"></div><p></p>';
      box.querySelector('.splash-alert-t').textContent = '公告';
      box.querySelector('p').textContent = want;
    }
  }
  function run() {
    // #613/#621：合并置顶声明卡（免费 · 署名 · 防倒卖）重建锚点 = 公告区最顶——refNode 传 null，
    // ensureBar 落到 notice.firstChild；只影响「卡被删后重建插到哪」，静态顺序由 template.html 决定。
    ensureBar(BARS[0], null);
    ensureSettings();
    ensureBulletin();
    setupCardLockCard();
  }
  // ===== #319 防未成年人·系统内置字卡锁：开屏锁卡状态渲染 + 解锁/上锁交互 =====
  // 闸门本体在 card-lock.js（jsFiles 靠前加载）；这里只管开屏这张卡的 UI。
  // 解锁成功：提示后自动刷新页面，让回复池/字卡库/词典拼字按解锁态重建。
  // #998 锁定态 tip 的密码口径：答案在第一页公告的章节里（第一页顶部「目录」可逐章翻），并写明不是第二页
  //   「进入前 · 作者必读公告」上的两个日期（用户直派「时间就在开屏第一页的某个目录，不要看第二页」）。
  function setupCardLockCard() {
    const card = document.getElementById('splash-cardlock');
    if (!card || !window.cardLockOpen) return;
    const tip = document.getElementById('splash-cardlock-tip');
    const actions = document.getElementById('splash-cardlock-actions');
    if (!actions) return;
    const open = window.cardLockOpen();
    if (tip) tip.textContent = open
      ? '系统内置字卡已解锁（成年人验证已通过）。如需恢复未成年人保护，可重新上锁。'
      : '系统内置字卡已全部锁定，这是面向未成年人的保护措施，不是 bug。锁定影响：默认聊天字卡、词典（含词典拼字）、其他系统预设互动字卡全部停用；你自建的字卡与情绪 / 心意 / 意图字卡不受影响。豁免说明（#499）：聊天情绪字卡、TA 的心情、聊天回应字卡这三大互动链不受锁定影响，未解锁也照常触发与抽取。所以若发现「某功能开关都开了却没效果」，先看是不是锁定中。不输密码也能正常使用全部功能，密码只管两件事：解锁系统内置字卡、跳过开屏的 2 个问答。注意：锁定时若自定义字卡（含 mj 字卡）一张都没添加，回复会更单薄（情绪/回应字卡仍在，但少了系统预设内容），自己在自定义字卡里添加几张即可。密码一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）——不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间（那只是用来判断有没有更新到新版本）。这个密码与开屏问答页的「暗号」是同一个。解开密码请勿二传（不要告诉别人），一旦有人二传，密码就会被重新设置。';
    actions.innerHTML = '';
    const state = document.createElement('div');
    state.className = 'cardlock-state';
    if (open) {
      const relock = document.createElement('button');
      relock.className = 'cardlock-btn cardlock-btn-ghost';
      relock.type = 'button';
      relock.textContent = '重新上锁';
      relock.addEventListener('click', function () {
        window.cardLockRelock();
        state.textContent = '已重新上锁，页面即将刷新…';
        // #404 同款：等 'locked' 确认落进 IDB 再刷新（重锁丢失＝未成年人保护失效，更不能容忍）
        const goReloadAfterPersist = function () { setTimeout(function () { location.reload(); }, 300); };
        if (window.cardLockConfirmPersisted) window.cardLockConfirmPersisted('locked', goReloadAfterPersist);
        else setTimeout(function () { location.reload(); }, 900);
      });
      actions.appendChild(relock);
    } else {
      const unlock = document.createElement('button');
      unlock.className = 'cardlock-btn';
      unlock.type = 'button';
      unlock.textContent = '输入密码解锁';
      unlock.addEventListener('click', function () {
        promptCardUnlock(state);
      });
      actions.appendChild(unlock);
    }
    actions.appendChild(state);
  }
  // #XXX 二级验证·输入解锁密码：开屏锁卡与「进入后强制提醒弹窗」共用同一解锁流程（拆出来避免
  // 两处重复）。okState 可选：解锁成功时写入「验证通过」提示文本的元素（开屏锁卡用，页面随后
  // 自动刷新）。开屏仍在（splash 未隐藏）时为避免 z-index 盖住 modal，给 splash 挂 .under-modal，
  // mask [hidden] 恢复时移除；进入后开屏已隐藏则整段跳过。
  // #998 解锁弹窗 staticText 同口径（第一页章节指路＋不是第二页日期）。
  // #812：staticText 末尾补「与开屏问答页暗号同码」互指说明——两入口同码（card-lock 校验
  // mochi#990815 散列、applock QA_SKIP_CODE='990815'），此前两边只讲公式互不通气＝用户各自猜码。
  function promptCardUnlock(okState) {
    if (!window.openModal || !window.cardLockTryUnlock) return;
    const splash = document.getElementById('splash');
    const mask = document.getElementById('modal-mask');
    const splashVisible = splash && !splash.classList.contains('hide');
    if (splashVisible) splash.classList.add('under-modal');
    let mo = null;
    if (splashVisible && mask && 'MutationObserver' in window) {
      mo = new MutationObserver(function () { if (mask.hidden) { splash.classList.remove('under-modal'); } });
      mo.observe(mask, { attributes: true, attributeFilter: ['hidden'] });
    }
    // openModal 标准验证模式：失败 ctl.hint + ctl.stay 不关窗（chat-settings renameChatScheme 同款）
    const ctl = window.openModal('二级验证 · 输入解锁密码', '', function (v) {
      const r = window.cardLockTryUnlock(String(v == null ? '' : v).trim());
      if (!r.ok) { ctl.hint(r.msg || '密码不对'); ctl.stay(); return; }
      if (okState) okState.textContent = '验证通过，页面即将刷新…';
      if (mo) { try { mo.disconnect(); } catch (e) {} }
      // #961 解锁成功后先弹「字卡体量提醒」，用户点掉再刷新——提醒若排在 reload 之后会被刷新吞掉，
      //   用户在字卡库看不到。刷新条件是「解锁值确认落库」与「提醒被关掉」两件都完成（谁后到谁触发）：
      //   persisted 由 cardLockConfirmPersisted 给（内部 3s 兜底必回调），noticeClosed 由弹窗确定回调给；
      //   opts.lock=true 使弹窗只能点「知道了」关闭（取消按钮隐藏、点遮罩不关），保证回调必被触发＝
      //   刷新必达，不会停在「提示验证通过却永远不刷新」的半状态。
      let persisted = false, noticeClosed = false, reloaded = false, moNotice = null;
      const tryReload = function () {
        if (reloaded || !persisted || !noticeClosed) return;
        reloaded = true;
        if (moNotice) { try { moNotice.disconnect(); } catch (e) {} }
        setTimeout(function () { location.reload(); }, 300);
      };
      // FIX 2026-09-13 #404：等解锁值确认落进 IDB 再刷新（见 card-lock.js
      // cardLockConfirmPersisted）——夸克等内核 reload 杀进程会中止在途 IDB 事务，
      // 盲等 900ms 可能值未提交＝刷新即回锁；3s 兜底超时也照常刷新不卡 UI。
      // #961：回调体加一层「提醒也要关掉」的合流（tryReload 两条件齐备才刷新），
      //   函数名与调用形态保持 #404 哨兵锚点不变。
      const goReloadAfterPersist = function () { persisted = true; tryReload(); };
      if (window.cardLockConfirmPersisted) window.cardLockConfirmPersisted('open', goReloadAfterPersist);
      else persisted = true;
      // 提醒可能被别的弹层顶掉（openModal 全站共用一个弹层：开屏后的备份提醒等会直接换内容），
      // 那时「知道了」的回调永远等不到＝刷新被卡住、用户看着还锁着。故再挂两条兜底：
      //   ①弹层遮罩重新隐藏＝统一的「提醒已消失」信号（点知道了/点取消/被顶掉后关闭都覆盖）；
      //   ②15s 上限：无论弹层被谁占着，解锁值已落库就一定会刷新，不留半状态。
      if (mask && 'MutationObserver' in window) {
        moNotice = new MutationObserver(function () { if (mask.hidden) { noticeClosed = true; tryReload(); } });
        moNotice.observe(mask, { attributes: true, attributeFilter: ['hidden'] });
      }
      setTimeout(function () { noticeClosed = true; tryReload(); }, 15000);
      const sizeTip = window.mochiPresetSizeTip;
      if (sizeTip && window.openModal) {
        const ctl2 = window.openModal('解锁成功 · 字卡使用提醒', '', function () {
          noticeClosed = true; tryReload();
        }, { noInput: true, big: true, warn: true, lock: true, staticText: '系统内置字卡已解锁，聊天与各功能可以正常取用。\n\n' + sizeTip });
        if (ctl2 && ctl2.okText) ctl2.okText('知道了');
      } else {
        // 文案常量或弹窗组件缺失（理论不会）：退回原行为，不把用户卡在解锁页
        noticeClosed = true;
        tryReload();
        if (!window.cardLockConfirmPersisted) setTimeout(function () { location.reload(); }, 900);
      }
    }, { inputmode: 'numeric', placeholder: '输入二级验证密码', staticText: '密码一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），生日就在开屏第一页的章节目录里（点开顶部的「目录」逐章翻一下就能找到）——不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间（那只是用来判断有没有更新到新版本）。解开密码请勿二传（不要告诉别人），一旦有人二传，密码就会被重新设置。这个密码与开屏问答页的「暗号」是同一个（同一串 6 位数字）：在开屏问答页点「输暗号跳过问答」用的也是它。' });
  }
  // #XXX 强制弹窗提醒：进入应用后系统内置字卡仍锁定（未输二级密码）时，每次打开应用弹一次
  // （本加载仅一次）。可点「知道了」关闭继续用（不输密码也能正常使用全部功能），也可就地
  // 「输入密码解锁」——进入应用后开屏锁卡已不可见，此处为应用内唯一解锁入口，删除则锁定用户
  // 进入后无法再解锁、只能重进开屏。文案与开屏锁卡 tip / 字卡库锁提示同义。
  // #998 进入后提醒弹窗：用户已在应用内，口径改为「回开屏第一页的章节里找」＋不是第二页日期。
  const CARD_LOCK_REMIND = '系统字卡未解锁，请自行添加字卡使用。联系人无法使用字卡，不是bug，是系统字卡锁了。\n其实从内测开始就说明过需要自行添加字卡使用，系统内置字卡只是附带功能。\n\n系统内置字卡已全部锁定，这是面向未成年人的保护措施，不是 bug。锁定影响：默认聊天字卡、词典（含词典拼字）、其他系统预设互动字卡全部停用；你自建的字卡与情绪 / 心意 / 意图字卡不受影响。豁免说明（#499）：聊天情绪字卡、TA 的心情、聊天回应字卡这三大互动链不受锁定影响，未解锁也照常触发与抽取。所以若发现「某功能开关都开了却没效果」，先看是不是锁定中。不输密码也能正常使用全部功能，密码只管两件事：解锁系统内置字卡、跳过开屏的 2 个问答。注意：锁定时若自定义字卡（含 mj 字卡）一张都没添加，回复会更单薄（情绪/回应字卡仍在，但少了系统预设内容），自己在自定义字卡里添加几张即可。密码一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），要回开屏第一页的章节里找（第一页顶部有「目录」，点开逐章翻一下就能找到）——不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间（那只是用来判断有没有更新到新版本）。这个密码与开屏问答页的「暗号」是同一个。解开密码请勿二传（不要告诉别人），一旦有人二传，密码就会被重新设置。';
  let cardRemindShown = false;
  // 次数口径：自定义字卡总数（含日 0）=当前桌面专属库 + 公用库里用户自建的全部字卡（不含系统
  // 预设/词典），见 chatcard.js cardLockCustomCount。数据就绪前 ownPoolRaw 可能读不到字卡库
  // （IDB 回填/冷启动晚于开屏进入）→ 会误判成 0 弹错提醒；数到卡即可信，数到 0 需等
  // __mochiDataReady / mochi-restore-done 再确认（确实没加才弹），否则先不动（-1=待定）。
  function trustedCustomCount() {
    let n = 0;
    try { n = (window.cardLockCustomCount ? window.cardLockCustomCount() : 0); } catch (e) { n = 0; }
    if (n > 0) return n;
    if (window.__mochiDataReady) return n; // 已就绪且数到 0 → 可信（确实没加自定义字卡）
    return -1;                             // 未就绪且暂数不到 → 本加载稍后由 restore-done 再判
  }
  function maybeCardLockReminder() {
    if (cardRemindShown) return;
    if (!window.cardLockOpen || window.cardLockOpen()) return; // 未锁定 / 已解锁：不弹
    if (!window.openModal) return;
    const splash = document.getElementById('splash');
    if (splash && !splash.classList.contains('hide')) return; // 开屏尚未进入：不弹（开屏有解锁卡）
    const n = trustedCustomCount();
    if (n < 0) return;    // 数据未就绪：等 restore-done 触发的下一次判定
    if (n >= 500) return; // 自定义字卡已 ≥500：不缺卡，不弹
    cardRemindShown = true;   // 本加载只弹一次
    // 让开屏后的问答门 / 应用锁（applock 遮罩层级更高）先就位再弹，避免与之抢层级
    setTimeout(function () {
      const ctl = window.openModal('系统字卡未解锁', '', function (v) {
        if (v === 'unlock') promptCardUnlock(); // 就地解锁；其余（点「知道了」）直接关闭
      }, { noInput: true, big: true, staticText: CARD_LOCK_REMIND, pillSubmit: true, pills: [{ label: '输入密码解锁', value: 'unlock' }] });
      if (ctl && ctl.okText) ctl.okText('知道了');
    }, 600);
  }
  // 冷启动回填完成后重判一次（开屏进入先于数据就绪时，卡片计数可能暂为 0，靠它兜底）
  document.addEventListener('mochi-restore-done', maybeCardLockReminder);
  // 无头验证专用入口（仅 tools/verify-card-lock.mjs 使用）：fire 重置“本加载已弹”标记后触发
  // 一次强制弹窗（锁定态且自定义字卡<500 才真弹）。与 applock 的 __applockQaTest 同一类测试后门。
  window.__cardLockTest = {
    fire: function () { cardRemindShown = false; maybeCardLockReminder(); }
  };
  // 修复 2026-09-14 #470：本提醒函数定义在本 IIFE（防骗声明段）作用域内，开屏进入流程
  // （下方另一 IIFE 的 finishEnter）直呼函数名必抛 ReferenceError——线上多机型每次进入
  // 报错且提醒从未弹出。挂到 window 供 finishEnter 以守卫方式调用；其余逻辑不动。
  window.maybeCardLockReminder = maybeCardLockReminder;
  // FIX 2026-09-13 #389：解锁态可能「晚到」——card-lock.js 走 xyStore 后，杀进程回滚的
  // 解锁状态由 wrj 自愈链（mochi-wrj-heal）异步修回并补发 mochi-cardlock-open/-locked。
  // 开屏锁卡此前只在首屏渲染一次，晚到的解锁会一直显示「输入密码解锁」假象，这里监听
  // 两个状态事件整卡重渲染（setupCardLockCard 幂等，重复触发安全）。
  document.addEventListener('mochi-cardlock-open', setupCardLockCard);
  document.addEventListener('mochi-cardlock-locked', setupCardLockCard);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  // 可选官方远程源：失败（离线/被墙/CORS）不阻塞，保留本地兜底；权威文案有变才强刷
  fetch(OFFICIAL_NOTICE, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
    .then(function (d) {
      let dirty = false;
      ['alert', 'alert2'].forEach(function (k) {
        if (d && typeof d[k] === 'string' && d[k].trim() && d[k].trim() !== texts[k]) {
          texts[k] = d[k].trim();
          dirty = true;
        }
      });
      // 远程时效公告：与本地状态不同才刷（含下发/摘除）
      if (d && typeof d.bulletin === 'object' && d.bulletin) {
        const nb = { text: String(d.bulletin.text || ''), until: Number(d.bulletin.until) || 0 };
        if (nb.text && (!bulletin || bulletin.text !== nb.text || bulletin.until !== nb.until)) {
          bulletin = nb;
          dirty = true;
        } else if (!nb.text && bulletin) {
          bulletin = null;
          dirty = true;
        }
      }
      if (dirty) run(); // 强刷回写
    })
    .catch(function () { /* 保留本地兜底 */ });
})();

// ===== 开屏加载动画：页面就绪后淡出并移除 =====
(function () {
  const splash = document.getElementById('splash');
  if (!splash) return;
  // v3.5.96：开屏显示「部署版本（构建时注入）+ 实时时间」——手机端可随时验证是否最新部署
  // v3.8.y：版本块分两行（名称+版本 / 部署时间），实时秒数只写进 #splash-ver-live，不再整块重写
  const verEl = document.getElementById('splash-ver');
  const verLiveEl = document.getElementById('splash-ver-live');
  let _verIv = null;
  if (verEl && verLiveEl) {
    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
    const fill = () => {
      const d = new Date();
      verLiveEl.textContent = ' · ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    };
    fill();
    _verIv = setInterval(fill, 1000);
  }
  // v3.5.111：开屏含公告 → 点击进入才进页面（点任意处或「点击进入」按钮均可）
  // v3.5.122：开屏等待数据（IndexedDB 回填）就绪后才显示「点击进入」——
  //   就绪前只显示「正在加载数据…」，不提供"跳过加载"入口（跳过后桌面数据
  //   未加载完，正是最初"没加载完就进入"的 bug）。idbRestore 已改为分批恢复
  //   + 12 秒整体保险（idb.js），正常几秒完成；这里 20 秒保险丝兜底任何意外，
  //   确保开屏永不卡死、进入时数据已完整。
  const hide = () => {
    // v3.5.129：开屏隐藏时才停止版本时间刷新（数据恢复慢时版本时间不再提前冻结）
    if (_verIv) { clearInterval(_verIv); _verIv = null; }
    if (splash.classList.contains('hide')) return;
    splash.classList.add('hide');
    setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 400);
  };
  const ready = () => !!(window.__mochiDataReady);
  // v3.8.y：每日首次打开强制展开全文阅读；当日再次打开则保持折叠（内容短→无需滚动即可进入）
  const today = (function () {
    const d = new Date(), p = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  })();
  const seenKey = 'xy-home-v2:splash-seen:' + today;
  let seenToday = false;
  try { seenToday = localStorage.getItem(seenKey) === '1'; } catch (e) {}
  // v3.8.z2：每日首次打开强制展开全文阅读（今日未读过 → 各章节初始展开），
  //   当日已读后再次打开才保持折叠——forceExpand 供在线/离线渲染统一读取。
  window.__splashForceExpand = !seenToday;
  // v3.8.z：全折叠+必读摘要——各章节默认收起、靠目录跳转；摘要承担必读。
  //   "每日首次强读"仍然生效（首次须滑到底才可进入），但不再展开全部章节。
  //   移除首开 forceExpand 全展开逻辑（默认折叠即可）。
  const enterEl = document.getElementById('splash-enter');
  const loadingEl = document.getElementById('splash-loading');
  // #657：开屏等待较久时的「为什么慢」一行说明（默认 hidden，判据见 updateEnterState）
  const loadingSubEl = document.getElementById('splash-loading-sub');
  const hintEl = document.getElementById('splash-enter-hint');
  // #315c：一次性年龄确认闸门——勾选「已年满 18 周岁并同意全部说明」后才可进入；
  //   确认一次永久记住（xy-home-v2:age-confirmed），之后开屏自动勾上不重复打断。
  //   与「滑到底」并列为进入前置条件：未勾选时按钮置灰（updateEnterState），
  //   enter/forceEnter 双入口都拦截。checkbox 行为 label 包裹，点击文字即可勾选。
  const AGE_KEY = 'xy-home-v2:age-confirmed';
  let ageOk = false;
  try { ageOk = localStorage.getItem(AGE_KEY) === '1'; } catch (e) {}
  const ageRow = document.getElementById('splash-age-row');
  const ageCheck = document.getElementById('splash-age-check');
  if (ageRow && ageCheck) {
    ageCheck.checked = ageOk; // 已确认过的老用户自动勾上，不重复打断
    ageRow.hidden = false;
    ageCheck.addEventListener('change', function () {
      ageOk = !!ageCheck.checked;
      try { if (ageOk) localStorage.setItem(AGE_KEY, '1'); } catch (e) {}
      updateEnterState();
    });
  }
  // v3.26.x：数据加载较慢（idbRestore 12 秒保险丝触发）且未真就绪时显示的逃生口链接
  const forceEnterEl = document.getElementById('splash-force-enter');
  let slow = false;
  try { if (window.__mochiDataSlow) slow = true; } catch (e) {} // 事件先于监听派发时兜底
  // v3.26.x：进入门控补「页面加载完成」——此前只等数据就绪：GitHub Pages 冷启动
  //   资源慢时，数据先就绪或保险丝先触发，「点击进入」/「仍要进入」在浏览器还没
  //   拉完页面时就能点，用户点进去看到网页还在加载（数据不全的实况与错觉）。
  //   现在两个入口都要求页面自身加载完成（window load / readyState complete）才放行；
  //   30 秒兜底：个别资源挂起导致 load 永不触发时，到点视为已加载，避免开屏永远卡住。
  let windowLoaded = false;
  const loaded = () => windowLoaded || (typeof document !== 'undefined' && document.readyState === 'complete');
  // v3.8.y：整页一体滚动——滚动判定用 .splash-box（顶部+公告一起滚，需滚到整页底部）
  const splashBox = document.getElementById('splash-box');
  // v3.8.x：开屏即公告1页——原「开屏公告 + 进入后的报修确认层」两页合并为一页，
  //   全部说明已直接展示在开屏上，点【点击进入】即进入（点击即视为已阅读知晓），不再弹二次确认层。
  //   只允许点按钮进入（长公告需滚动阅读，避免误触整屏直接跳过）。
  // v3.8.y：必须把整页滑到底才能进入——未到底时按钮置灰不可点（无法跳过阅读）。
  // v3.26.x：点击进入后强制观看公告——每次进入都先弹 #splash-mandatory 强制公告页
  // （作者道别公告：二传二改 / 月底停更 / 二级密码），必须把该页滑到底、点
  // 【我已阅读并确认进入】（finishEnter）才真正隐藏开屏进入；未到底时按钮置灰不可点。
  const mandEl = document.getElementById('splash-mandatory');
  const mandScroll = document.getElementById('splash-mandatory-scroll');
  const mandEnter = document.getElementById('splash-mandatory-enter');
  const mandHint = document.getElementById('splash-mandatory-hint');
  let mandBottom = false;
  function updateMandState() {
    if (mandHint) mandHint.hidden = !!mandBottom;
    if (mandEnter) mandEnter.classList.toggle('is-disabled', !mandBottom);
  }
  function checkMandScrolled() {
    if (!mandScroll) return;
    const b = mandScroll.scrollHeight - mandScroll.scrollTop - mandScroll.clientHeight <= 8;
    if (b !== mandBottom) { mandBottom = b; updateMandState(); }
  }
  function showMandatory() {
    if (splash.classList.contains('hide')) return;
    if (!mandEl) { finishEnter(); return; } // 锚点缺失兜底：不卡死进入入口
    mandEl.hidden = false;
    if (mandScroll) mandScroll.scrollTop = 0;
    mandBottom = false;
    updateMandState();
    checkMandScrolled();
  }
  // #797a（2026-09-19）：强制进入（保险丝放行）后的常驻「数据仍在加载」顶条——
  //   原先只有一次性弹窗，点掉之后应用里再无任何「还在加载」指示，用户在空列表上
  //   继续点＝把「还没回填」当 bug 报。横幅复用 .ver-update-bar 固定顶条形态
  //   （零 CSS 改动、不碰 base.css）；mochi-restore-done 自动撤；120s 超限自撤
  //   （与 idb.js DATA_PENDING_CEILING_MS 同源——超限即按权威空态陈述，横幅不再挂）。
  function showDataPendingBanner() {
    if (document.getElementById('mochi-data-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'mochi-data-banner';
    bar.className = 'ver-update-bar';
    bar.innerHTML =
      '<span class="vub-txt">数据仍在后台加载，部分内容暂时看不到…</span>' +
      '<span class="vub-act vub-close" id="mochi-data-banner-close" style="background:transparent;color:#ccc;border:1px solid rgba(255,255,255,.3)">隐藏</span>';
    document.body.appendChild(bar);
    let gone = false;
    let fuse = 0;
    const off = function () {
      if (gone) return;
      gone = true;
      document.removeEventListener('mochi-restore-done', off);
      clearTimeout(fuse);
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    };
    fuse = setTimeout(off, 120000);
    document.addEventListener('mochi-restore-done', off);
    const closeBtn = document.getElementById('mochi-data-banner-close');
    if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); off(); });
  }
  // 真正进入：隐藏开屏 + （数据未真就绪时）数据不全提示 / 字卡预加载——原 enter/forceEnter 的收尾逻辑收拢于此
  function finishEnter() {
    if (splash.classList.contains('hide')) return;
    if (!seenToday) {
      try { localStorage.setItem(seenKey, '1'); seenToday = true; } catch (e) {}
    }
    hide();
    if (!ready()) {
      // v3.26.x #135：未真就绪但已硬放行（20s 保险丝）→ 弹「数据仍在加载」提示
      // （不静默进入，用户知情数据可能不全）
      // #797a：弹窗只说一次，顶条常驻到真就绪（细节见 showDataPendingBanner 注释）
      try { showDataPendingBanner(); } catch (e) {}
      try {
        if (window.openModal) {
          window.openModal('数据仍在加载', '数据较多仍在后台加载，部分内容（字卡 / 图片 / 聊天记录等）可能暂时看不见，建议稍后刷新页面。', null);
        }
      } catch (e) {}
      return;
    }
    // v3.26.x：开屏进入后预加载字卡大键——中高端机（deviceMemory>4GB 或无法判断，含所有 iOS）
    //   后台静默取回【当前桌面专属】字卡(own)，避免用户点进字卡库才看到"字卡较多，正在加载"。
    //   低端机（deviceMemory≤4GB）保持懒加载，与 idb.js v3.14.x OOM 预算 12MB 对齐防压崩。
    //   只预取 own 不预取 public：public 是跨所有桌面共享的公用字卡大键（chatcard.js 注释提到
    //   27MB 公用库真机压崩案例），老 iOS（SE2/8 等 2-3GB，deviceMemory 缺失被当 8GB）预拉它会
    //   绕过 idb.js 24MB 预算；own 是单联系人专属，通常远小于公用库，风险最低收益最高。public
    //   留懒加载（点字卡库时 MutationObserver 取回 + toast 提示）。延迟 1.5s 让开屏隐藏动画(400ms)
    //   +首屏桌面渲染先完成再取回，避免抢主线程/堆；hydrateLibScopes 自带"有数据/已确认无键跳过"
    //   +in-flight 去重，已就绪零开销，未就绪时用户再点字卡库复用同一取回链不重复。只在用户主动
    //   点击进入后跑（非 mochi-restore-done 后台事件），符合"用户正在看的场景按需拉一把"红线。
    //   Promise 兜底 catch 防 unhandledrejection。
    try {
      const dgb = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
      if (dgb > 4 && window.hydrateLibScopes) {
        setTimeout(function () {
          try { window.hydrateLibScopes(['own']).catch(function () {}); } catch (e) {}
        }, 1500);
      }
    } catch (e) {}
    // 进入完成且系统字卡仍锁定时，强制弹窗提醒（每次打开应用一次）
    // 修复 2026-09-14 #470：maybeCardLockReminder 定义于另一 IIFE 作用域，此处直呼函数名
    // 在线上必抛 ReferenceError（每次进入 uncaught、提醒永远不弹，多机型同报）；
    // 改走 window 挂载 + 守卫调用，缺失/异常都不阻断进入。
    try { if (window.maybeCardLockReminder) window.maybeCardLockReminder(); } catch (e) {}
    // #646：进入桌面入口流程——默认进入的桌面 / 打开时先进入此间（两项设置均默认关闭）。
    // 放在数据已就绪的进入收尾处；缺失或异常都不阻断进入。
    try { if (window.mochiContactEntryFlow) window.mochiContactEntryFlow(); } catch (e) {}
  }
  let scrolledBottom = false;
  function checkScrolled() {
    let bottom = true;
    if (splashBox) {
      // 内容可能由 notice.json 异步填充：未溢出/尚未渲染时视为已到底，
      // 渲染后高度变化由轮询 + 「mochi-notice-rendered」事件重新判定
      bottom = splashBox.scrollHeight - splashBox.scrollTop - splashBox.clientHeight <= 8;
    }
    if (bottom !== scrolledBottom) { scrolledBottom = bottom; updateEnterState(); }
  }
  // v3.26.x #135：20 秒硬保险丝——数据层有未知永久挂起形态（iPad 7 + Edge：
  // indexedDB.open 永不落地 → __mochiDataReady 永不置位 → updateEnterState 的
  // ready() 恒假 → 「点击进入/仍要进入」永远出不来，开屏彻底死锁）。此前只有
  // mochi-restore-slow 慢标志（仍要进入也要求 ready 门控下的显隐路径）。现 20s
  // 未就绪时 readyForced=true：进入门控按已就绪放行（仍要求滑到底），点进入走
  // forceEnter 同款「数据仍在加载」提示；数据随后真就绪时 ready() 优先、标志自动失效。
  let readyForced = false;
  function updateEnterState() {
    const r = ready() || readyForced;
    const ok = r && scrolledBottom && ageOk; // #315c：年龄确认与滑到底并列为可点条件
    if (loadingEl) {
      // 数据未就绪 → 仍在加载数据；数据已就绪但页面资源未加载完 → 提示等待页面
      loadingEl.hidden = r && loaded();
      loadingEl.textContent = (!ready() && slow) ? '数据较多，仍在加载…' : (r ? '正在加载页面…' : '正在加载数据…');
    }
    // #657：只在「等得比较久」时才就地解释原因（用户普遍把开屏慢当 bug）——两种形态：
    //   数据多尚未就绪（slow）／数据已就绪但整页 5.5MB 资源还没加载完（正在加载页面…）。
    //   正常几秒读完的冷启动不显示，避免多一行无谓文字。要求加载提示在位，防出现"有解释没提示"。
    if (loadingSubEl) {
      const loadingShown = loadingEl ? !loadingEl.hidden : false;
      loadingSubEl.hidden = !(loadingShown && ((!ready() && slow) || (r && !loaded())));
    }
    if (hintEl) hintEl.hidden = !r || !loaded() || ok;
    if (enterEl) {
      enterEl.hidden = !r || !loaded();
      enterEl.classList.toggle('is-disabled', !ok); // div 上设 disabled 属性不落 DOM，用 class 控制置灰
    }
    // 仍要进入：仅在「页面已加载完成 + 较慢且未真就绪 + 已确认年满18」时显示，真就绪后隐藏
    if (forceEnterEl) forceEnterEl.hidden = ready() || readyForced || !slow || !loaded() || !ageOk;
  }
  const enter = () => {
    if (splash.classList.contains('hide')) return;
    // v3.26.x #135：未真就绪但已硬放行（20s 保险丝）→ 进强制公告页，
    // 确认进入时（finishEnter）弹「数据仍在加载」提示（不静默进入，用户知情数据可能不全）
    if (!ready()) {
      if (readyForced) { showMandatory(); }
      return; // 数据未就绪且未硬放行：禁止进入（原有门控）
    }
    if (!scrolledBottom || !loaded() || !ageOk) return; // 未滑到底 / 页面未加载完 / 未确认年满18：禁止进入
    // 今日首次进入（本次仍强制通读）→ 记下已读，当日再次打开不再展开全文
    if (!seenToday) {
      try { localStorage.setItem(seenKey, '1'); seenToday = true; } catch (e) {}
    }
    // v3.26.x：点击进入后强制观看公告——不再直接 hide，先弹强制公告页，
    // 滑到底点【我已阅读并确认进入】（finishEnter）才真正隐藏开屏进入
    showMandatory();
  };
  // v3.26.x：数据较慢时用户主动「仍要进入」——强制公告页不区分数据快慢，
  // 任何入口进入都先读公告；确认进入后由 finishEnter 提示数据可能不全
  const forceEnter = () => {
    if (splash.classList.contains('hide')) return;
    if (!ageOk) return; // #315c：逃生口同样要求先勾选年龄确认
    if (!seenToday) {
      try { localStorage.setItem(seenKey, '1'); seenToday = true; } catch (e) {}
    }
    showMandatory();
  };
  updateEnterState();
  if (splashBox) splashBox.addEventListener('scroll', checkScrolled, { passive: true });
  if (enterEl) enterEl.addEventListener('click', (e) => { e.stopPropagation(); enter(); });
  if (forceEnterEl) forceEnterEl.addEventListener('click', (e) => { e.stopPropagation(); forceEnter(); });
  // v3.26.x：强制公告页——滑到底才可确认进入（mandBottom 未到底时按钮 is-disabled 不可点）
  if (mandEnter) mandEnter.addEventListener('click', (e) => { e.stopPropagation(); if (mandBottom) finishEnter(); });
  if (mandScroll) mandScroll.addEventListener('scroll', checkMandScrolled, { passive: true });
  // 字体缩放/旋转等导致内容高度变化时重新判定是否已到底
  window.addEventListener('resize', checkMandScrolled);
  // 页面加载完成 → 刷新进入状态（window load + readyState 轮询双保险）
  window.addEventListener('load', function () { windowLoaded = true; updateEnterState(); });
  // 30 秒兜底：页面个别资源挂起导致 load 永不触发时，到点视为已加载，避免开屏永远卡住
  setTimeout(function () { if (!windowLoaded) { windowLoaded = true; updateEnterState(); } }, 30000);
  // 数据回填完成 → 刷新状态（事件 + 轮询双保险：空数据场景只置标志不派发事件）
  document.addEventListener('mochi-restore-done', updateEnterState);
  // idbRestore 12 秒保险丝触发 → 标记较慢，显示「仍要进入」逃生口（不自动进入）
  document.addEventListener('mochi-restore-slow', function () { slow = true; updateEnterState(); });
  document.addEventListener('mochi-notice-rendered', checkScrolled);
  // 轮询：数据就绪 + 已到底后停止；期间持续校正滚动/高度变化
  const readyPoll = setInterval(() => {
    if (ready() && scrolledBottom) { clearInterval(readyPoll); return; }
    updateEnterState();
    checkScrolled();
  }, 300);
  // 20 秒硬保险丝：数据极端异常未就绪时①置 slow 显示「仍要进入」逃生口（idbRestore
  //   12s 的 mochi-restore-slow 通常已先触发，这里兜底事件丢失场景）；②置 readyForced
  //   解除 ready() 硬门控——点击进入改走 forceEnter（隐藏开屏+数据不全提示），开屏
  //   永不因数据层挂起而彻底死锁（#135 iPad 7 + Edge：open() 挂起形态）
  setTimeout(() => {
    if (!ready()) {
      slow = true;
      readyForced = true;
      updateEnterState();
    }
  }, 20000);
})();

// v3.8.y：章节渲染
// 条目支持四种：字符串=自动编号条目；{h:"子标题"}；{b:"子列表项"}；{hl:"高亮条目"}（橙色加粗显眼标出）
function renderSplashSections(container, sections, opt) {
  if (!container || !Array.isArray(sections)) return;
  const collapsible = !!(opt && opt.collapsible);
  // 首次打开强制展开：今日未读过 → 本章节初始不收起（全文可读）
  const forceExpand = !!(opt && opt.expandFirst) && !!window.__splashForceExpand;
  sections.forEach(function (sec) {
    const wrap = document.createElement('div');
    // v3.8.z：全折叠（已读后） / v3.8.z2：首次打开展开全文
    wrap.className = 'splash-sec-wrap'
      + (collapsible ? ' splash-sec-collapsible' : '')
      + (collapsible && !forceExpand ? ' is-collapsed' : '');
    let h = null;
    if (sec && sec.h) {
      h = document.createElement('p');
      h.className = 'splash-sec';
      h.textContent = String(sec.h);
      wrap.appendChild(h);
    }
    if (sec && Array.isArray(sec.p)) {
      // 折叠模式：细节内容包进 .splash-sec-content，点击标题切换显隐
      const body = collapsible ? document.createElement('div') : null;
      if (body) { body.className = 'splash-sec-content'; }
      sec.p.forEach(function (it) {
        const p = document.createElement('p');
        if (it && typeof it === 'object') {
          if (it.h !== undefined) { p.className = 'splash-sub'; p.textContent = String(it.h); }
          else if (it.b !== undefined) { p.className = 'splash-bullet'; p.textContent = String(it.b); }
          else if (it.hl !== undefined) { p.className = 'splash-item splash-hl'; p.textContent = String(it.hl); }
          else { p.className = 'splash-item'; p.textContent = String(it.t !== undefined ? it.t : ''); }
        } else {
          p.className = 'splash-item';
          p.textContent = String(it);
        }
        if (body) body.appendChild(p); else wrap.appendChild(p);
      });
      if (body) wrap.appendChild(body);
    }
    container.appendChild(wrap);
  });
}

// v3.8.y：开屏公告「书签目录」——顶部可折叠入口（点击展开竖排章节索引，点击即展开并跳转对应章节）
// 复用 renderSplashSections 生成的 .splash-sec-wrap，在线/离线兜底两套 DOM 都生效
function buildSplashToc(list) {
  if (!list) return;
  if (list.querySelector('.splash-toc')) return; // 已注入则跳过（防重复）
  const headers = list.querySelectorAll('.splash-sec-wrap .splash-sec');
  if (!headers.length) return;
  const toc = document.createElement('div');
  toc.className = 'splash-toc';
  // 折叠入口头：显示章节数量，点击展开/收起
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'splash-toc-head';
  head.setAttribute('aria-expanded', 'false');
  const headText = document.createElement('span');
  headText.className = 'splash-toc-head-text';
  headText.textContent = '目录（' + headers.length + ' 章）';
  const chevron = document.createElement('span');
  chevron.className = 'splash-toc-chev';
  chevron.textContent = '▾';
  head.appendChild(headText);
  head.appendChild(chevron);
  head.addEventListener('click', function () {
    toc.classList.toggle('open');
    head.setAttribute('aria-expanded', String(toc.classList.contains('open')));
  });
  toc.appendChild(head);
  // 可致的正文行
  const body = document.createElement('div');
  body.className = 'splash-toc-body';
  headers.forEach(function (h) {
    const wrap = h.parentNode; // .splash-sec-wrap
    // 标签去【】取正文；竖排整行有足够宽度，仅极长标题截断
    let label = String(h.textContent).replace(/^【|】$/g, '').trim() || '章节';
    if (label.length > 18) label = label.slice(0, 18) + '…';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'splash-toc-chip';
    chip.textContent = label;
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      // 点击正文后自动收起目录，减少遮挡
      toc.classList.remove('open');
      head.setAttribute('aria-expanded', 'false');
      Array.prototype.forEach.call(body.children, function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      // 折叠章节默认收起 → 从书签跳转时展开细节
      if (wrap.classList.contains('is-collapsed')) wrap.classList.remove('is-collapsed');
      // 滚动到该章节（#splash-box 是整页滚动容器，scrollIntoView 会滚动到它）
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    body.appendChild(chip);
  });
  toc.appendChild(body);
  list.insertBefore(toc, list.firstChild);
}

// ===== 开屏公告远程化：notice.json 在线覆盖公告文案 =====
// 用法：改 src/pwa/notice.json 内容 → 构建部署，开屏公告即更新（无需改代码）。
// 字段：title / sub / tip（前置提示块，数组，元素可为字符串或 {h:块标题,p:[段落]}）
//       / sections（[{h:章节标题,p:[条目]}]，优先于旧 list）；
//       条目支持四种：字符串=自动编号条目；{h:"子标题"}；{b:"子列表项"}；{hl:"高亮条目"}（橙色加粗显眼标出）。
//       sections 为空数组 / hide:true 时隐藏整个公告区。
// 失败（离线/无网络）静默保留 template.html 写死的默认文案兜底。
(function () {
  const notice = document.getElementById('splash-notice');
  if (!notice) return;
  // #386：file:// 直开本地文件时 fetch 被浏览器 CORS 拦截（origin 'null'），
  // 跳过远程公告，直接保留 template.html 静态兜底文案。
  if (location.protocol === 'file:') return;
  fetch('./notice.json?v=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('notice fetch ' + r.status); return r.json(); })
    .then(function (data) {
      if (!data || typeof data !== 'object') return;
      const title = notice.querySelector('.splash-notice-title');
      const sub = notice.querySelector('.splash-notice-sub');
      const list = notice.querySelector('.splash-notice-list');
      if (data.title !== undefined && title) title.textContent = String(data.title);
      if (data.sub !== undefined && sub) sub.textContent = String(data.sub);
      if (Array.isArray(data.sections)) {
        if (!data.sections.length || data.hide) { notice.style.display = 'none'; return; }
        if (list) {
          list.innerHTML = '';
          // v3.8.z：必读摘要——固定展示在公告最顶部，承担"强读必读"内容，各章节折叠靠目录跳转
          if (Array.isArray(data.summary) && data.summary.length) {
            const sum = document.createElement('div');
            sum.className = 'splash-summary';
            const sumTitle = document.createElement('p');
            sumTitle.className = 'splash-summary-title';
            sumTitle.textContent = '必读摘要';
            sum.appendChild(sumTitle);
            data.summary.forEach(function (s) {
              const p = document.createElement('p');
              if (s && typeof s === 'object' && s.hl !== undefined) { p.className = 'splash-hl'; p.textContent = String(s.hl); }
              else p.textContent = String(s);
              sum.appendChild(p);
            });
            list.appendChild(sum);
          }
          // 章节：字符串=自动编号条目；{h}=子标题；{b}=子列表项
          // v3.8.y：开屏公告折叠成章节索引，点标题展开细节
          renderSplashSections(list, data.sections, { collapsible: true, expandFirst: true });
          // v3.8.y：添加「书签目录」横向可跳转（需要等 renderSplashSections 生成 DOM 后再注入）
          buildSplashToc(list);
        }
      } else if (Array.isArray(data.list)) {
        if (!data.list.length || data.hide) { notice.style.display = 'none'; return; }
        if (list) {
          list.innerHTML = '';
          data.list.forEach(function (t) {
            const p = document.createElement('p');
            p.className = 'splash-item';
            p.textContent = String(t);
            list.appendChild(p);
          });
        }
      } else if (data.hide) {
        notice.style.display = 'none';
      }
      // 公告渲染完成（或隐藏）→ 通知开屏重新判定"是否已滑到底"
      document.dispatchEvent(new Event('mochi-notice-rendered'));
    })
    .catch(function () { /* 失败：保留模板默认公告 */ });
})();
// v3.8.y：离线兜底（notice.json 加载失败时）公告用 template.html 里的静态章节，同样补一份「书签目录」。
// 在线路径已由上方 .then 内 buildSplashToc 注入（<button> 选择器会先序跳过已存在的 .splash-toc，不会重复）。
// v3.8.z：静态（离线/模板）章节原本是平铺展开，这里统一升级成「可折叠 + 默认收起」；折叠交互走
//   一次事件委托完成（在线 renderSplashSections 已带 splash-sec-collapsible 类，会跳过；点击由同委托处理，
//   两者统一，不重复绑定）。
window.addEventListener('DOMContentLoaded', function () {
  const nl = document.querySelector('.splash-notice-list');
  if (!nl) return;
  // 1) 离线平铺章节 → 折叠章节（默认收起），与在线折叠结构一致
  //    仅当渲染时序为「先 DOMContentLoaded 后 notice 异步填充」时才会动到模板静态 DOM；
  //    若 notice 已先行渲染（各节都已带 splash-sec-collapsible 类）则整体跳过。移动只允许
  //    把标题后的兄弟节点收进 content，绝不移入 content 自身/子孙，杜绝 "父节点塞进自身"。
  Array.prototype.forEach.call(nl.querySelectorAll('.splash-sec-wrap'), function (wrap) {
    if (wrap.classList.contains('splash-sec-collapsible')) return; // 在线已处理
    const head = wrap.querySelector(':scope > .splash-sec');
    if (!head) return;
    wrap.classList.add('splash-sec-collapsible');
    // 首次打开强制展开全文阅读；已读后再次打开才折叠
    if (!window.__splashForceExpand) wrap.classList.add('is-collapsed');
    let content = wrap.querySelector(':scope > .splash-sec-content');
    if (!content) {
      content = document.createElement('div');
      content.className = 'splash-sec-content';
      wrap.appendChild(content);
    }
    // 把标题之后的所有兄弟节点收进 content
    while (head.nextSibling && !content.contains(head.nextSibling)) content.appendChild(head.nextSibling);
  });
  // 2) 折叠/展开交互：事件委托，一次注册，在线/离线都生效
  nl.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== nl && !(t.classList && t.classList.contains('splash-sec'))) t = t.parentNode;
    if (!t || t === nl || !t.parentNode) return;
    const wrap = t.parentNode;
    if (wrap.classList && wrap.classList.contains('splash-sec-collapsible')) {
      wrap.classList.toggle('is-collapsed');
    }
  });
  buildSplashToc(nl);
  document.dispatchEvent(new Event('mochi-notice-rendered'));
});
