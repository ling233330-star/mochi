// ===== 功能：手机端适配（v3.5.105，安卓 / iOS） =====
// CSS 已处理：输入框字号 16px 防 iOS 聚焦缩放、safe-area 底部留白、overscroll 防回弹
// 这里补 JS 层：iOS 手势/双击缩放兜底 + 文本输入框 contenteditable 化（防 Chrome 自动填充条）
//              + 输入法适配（v3.6.x 最小干预，不再锁 .phone 高度）+ 弹层滚动穿透锁
//   v3.12.x：纯悬浮键盘内核（X5/旧夸克等 vv 不反映键盘）加「推定停靠」二线兜底——
//              手势聚焦文本框后宽限期两视口仍不动 → 按基准 58% 保底收缩 .phone
(function () {
  // v3.16.x：设备判定统一收口到 device.js（window.mochiDevice）——此前 isMobile /
  // isTablet / isIOS 在此与 fullscreen/pwa/bg-keep 各算一遍、规则略有出入，同一台
  // 设备可能被两个模块判成不同形态互相打架。判定副作用（viewport 改写 /
  // force-mobile / .tablet 类）随判定逻辑移入 device.js，此处只读取结果。
  // 兜底：device.js 缺失时 isMobile/isTablet 为 false → 本文件不启用任何适配，
  // 至少保证不出现「判错导致的错乱布局」（判定逻辑全部保留在 device.js）。
  let isMobile = false, isTablet = false, isIOS = false;
  try {
    const d = window.mochiDevice;
    if (d) { isMobile = !!d.isMobile; isTablet = !!d.isTablet; isIOS = !!d.isIOS; }
  } catch (e) {}
  // 兼容守卫：device.js 判平板时会给 <html> 加 .tablet 类（base.css 平板布局），
  // 若加载顺序异常导致此处读不到 mochiDevice，仍按类恢复 isTablet。
  if (!isTablet) { try { if (document.documentElement.classList.contains('tablet')) isTablet = true; } catch (e) {} }
  // 手机窄屏或平板都启用本文件适配（桌面模拟器外壳不受影响）
  if (!isMobile && !isTablet) return;

  // v3.15.x：键盘弹起时需要停靠到可视区底部的悬浮面板（聊天「更多功能」里的
  // 小功能半框 + 更多面板自身 + 表情包等）。它们都是 absolute 锚定 .phone 底部
  // （bottom:96px），键盘弹出 .phone 收缩后底部锚点退出视口——必须 fixed 停靠。
  // 仅 .phone 内部、无内部滚动体（fixed 停靠后滚动区 height 仍由面板自身收缩，
  // 内部 scroll 正常）的底半框才需要；全屏遮罩（#call-mask 等 fixed/inset 或
  // 自带滚动）不在列。
  // #297：补四款小游戏半框（五子棋/连连看/消消乐/心意币拍卖会，与 #chat-c4-panel 同族底半框，跨域一词登记请知悉）
  // #301：补游乐室半框（同族登记）
  const FLOAT_PANEL_SELECTORS = ['#chat-more-panel', '#chat-decision-panel', '#chat-gdecision-panel', '#chat-divine-panel', '#chat-ask-panel', '#poke-card', '#gc-poke-card', '#emoji-panel', '#chat-rp-panel', '#chat-rps-panel', '#chat-pong-panel', '#chat-snake-panel', '#chat-brick-panel', '#chat-c4-panel', '#chat-ms-panel', '#chat-fish-panel', '#chat-memory-panel', '#chat-gift-panel', '#chat-gomoku-panel', '#chat-linkup-panel', '#chat-match3-panel', '#chat-auction-panel', '#chat-arcade-panel', '#ck-panel', '#chat-search', '#gc-more-panel', '#voice-panel'];

  // v3.10.x：iOS 用 interactive-widget=resizes-content，安卓用 resizes-visual。
  // template.html 默认 resizes-visual（安卓：visualViewport 收缩可检测键盘 + layout
  // viewport 不变无白闪）。但 iOS Safari 在 resizes-visual 下 syncIosKb 收缩 .phone
  // 异常（挤压不见），而 resizes-content 下 layout viewport 自动收缩、.phone 100dvh
  // 跟着收缩、输入栏天然停靠键盘上方（0ab2c49 之前一直正常）。iOS Safari 收键盘
  // 无安卓红米 K80 那种白闪，resizes-content 安全。此处 iOS 改写 viewport meta。
  if (isIOS) {
    try {
      document.querySelectorAll('meta[name="viewport"]').forEach(function (m) {
        m.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content');
      });
    } catch (e) {}
  }

  // iOS Safari：禁止双指/捏合手势缩放（配合 viewport 锁定，双保险）
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  // 禁止双击放大页面（双击选中文本不在此列，长按选词不受影响）
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });

  // v3.32.x #261：全局「死选区」回收——修安卓桌面「今日情话」右边卡着一个消不掉的黑色
  // 【全选】按钮（荣耀畅玩40 Plus/夸克报障，多机型同族）。原生文字选择工具条（黑色圆角
  // 浮层「全选 / 复制」）以**文档选区**为宿主：选区不清它就不退，而浮层归浏览器所有、
  // 不随页面数据销毁，所以切后台再回来仍在（＝用户「退出重进」试过无效）。桌面侧的来源是
  // 部分内核无视 home.css 的 #page-phone user-select:none 照样自造选区。
  // removeAllRanges() 走 Blink FrameSelection::ClearSelection，正是内核用来终结工具条的
  // 那条路，所以清掉死选区即可让已卡住的浮层当场消失（用户不必重进）。
  // ⚠ 复制兜底路径那条残留**不归本回收器管**（实测见 verify-copy-selection B3a）：Blink 在
  //   选区宿主被移除时不是留下「指向已脱离文档节点」的孤儿，而是把选区重挂到
  //   document.body 且仍然活着——那种状态谁都不该清（用户正当的整页全选长得一模一样），
  //   所以复制站点必须自己当场塌选区（device.js mochiKillCopySelection＝#261 主防线）。
  // 这里只收两类必然非法的选区：
  //   ① 宿主节点已脱离文档（正常交互不可能选中不存在的节点，编辑区内的孤儿选区同样收；
  //      Blink 不会走到这形态，留给其它内核/老版本）；
  //   ② 落在桌面 #page-phone 内且不在编辑控件里（桌面 CSS 本就全站禁选，见 home.css v3.14.x）。
  // 页面其它区域的活选区一律不碰：弹窗「手动全选复制」退路、聊天文本选中、输入框改字
  // 全靠它，按下即清会把光标和选中态打没＝制造新 bug（且这是机型相关的行为差异）。
  const SELECTION_EDITABLE_SEL = 'input,textarea,select,[contenteditable],.ce-box';
  function reapDeadSelection() {
    let s = null;
    try { s = window.getSelection && window.getSelection(); } catch (e) { return false; }
    if (!s || !s.rangeCount) return false;
    let host = null;
    try {
      const node = s.getRangeAt(0).commonAncestorContainer;
      host = node && node.nodeType === 3 ? node.parentElement : node;
    } catch (e) { return false; }
    const alive = !!(host && document.documentElement.contains(host));
    if (alive) {
      const editable = !!(host.closest && host.closest(SELECTION_EDITABLE_SEL));
      const desk = document.getElementById('page-phone');
      if (editable || !desk || !desk.contains(host)) return false;
    }
    try { s.removeAllRanges(); } catch (e) { return false; }
    return true;
  }
  window.__mochiReapSelection = reapDeadSelection;   // 只读探针（诊断/verify 断言入口）
  function reapSoon() { try { reapDeadSelection(); } catch (e) {} }
  document.addEventListener('pointerdown', reapSoon, true);
  document.addEventListener('touchstart', reapSoon, true);
  document.addEventListener('selectionchange', reapSoon);
  // 从后台切回前台时补收一次——「退出重进」正是用户试过而没消掉的路径
  document.addEventListener('visibilitychange', reapSoon);

  // v3.5.128：contenteditable 输入框转换器（手机端统一启用）——
  // Chrome 移动端对 <input>/<textarea> 聚焦必弹「自动填充」条（该版本无视
  // autocomplete=off / readonly / 关闭浏览器设置），聊天输入框已验证
  // contenteditable 方案可彻底规避。这里把站点所有文本输入框统一转换：
  // 原 input 退场为数据锚点（ghost），显示/输入由 contenteditable div 接管，
  // 通过 JS 定义 value/focus/blur/事件 实现与原代码全兼容，零改动其他模块。
  // v3.6.x：iOS Safari 不启用转换——该方案本为安卓 Chrome 的「自动填充条」而生，
  // iOS 上无此问题；而 contenteditable 在 iOS Safari 上已知会引发：聚焦键盘不弹、
  // :empty::before 占位符异常、派发 focus 干扰原生输入（页面卡住、无法输入文字）。
  // iOS 保留原生 input/textarea（聚焦弹键盘正常）。聊天输入框是模板原生
  // contenteditable div，不受此转换器影响，iOS Safari 原生支持 contenteditable。
  var ceInited = false;
  // v3.9.x：多行 ce-box 取值兜底——按 DOM 结构还原换行的纯文本提取器。
  // 背景：ce-box 是 white-space:pre-wrap 的 contenteditable，安卓标准内核按 Enter
  // 插入的是「字面 \n 文本节点」（渲染上可见分行），innerText 能还原；但夸克等
  // 内核的 innerText 实现会丢掉文本节点里的字面 \n（屏幕上明明分了行，读回却是
  // 一行）——批量导入「一行一个」全部并成 1 张卡的直接根因（华为 Mate 60 Pro
  // 夸克浏览器用户实测反馈）。这里不依赖内核 innerText 实现：
  //   · text 节点 → 原样保留（含字面 \n）
  //   · <br> → 一次换行
  //   · 块级元素（div/p/li/pre/blockquote）→ 前后补换行（粘贴富文本常见结构）
  function ceMultiText(box) {
    var out = '';
    function endNl() { return out.slice(-1) === '\n'; }
    function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType === 3) { out += n.nodeValue || ''; continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName;
        if (tag === 'BR') { out += '\n'; continue; }
        var block = tag === 'DIV' || tag === 'P' || tag === 'LI' || tag === 'PRE' || tag === 'BLOCKQUOTE';
        if (block) {
          if (out && !endNl()) out += '\n';
          walk(n);
          if (out && !endNl()) out += '\n';
        } else {
          walk(n);
        }
      }
    }
    walk(box);
    return out;
  }
  function initCeAll() {
    // 全量扫描可重复执行（ceConvert 内 dataset.ceDone 保证幂等），
    // 供 MutationObserver 处理动态新增的输入框（弹层/半框）
    // v3.5.133：补 input:not([type])——未写 type 的 input 默认 text 但不匹配 [type="text"]，
    // 漏转换的输入框（聊天搜索/字体名等）仍会弹 Chrome 自动填充条
    var list = document.querySelectorAll('input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea');
    list.forEach(ceConvert);
    ceInited = true;
  }
  function ceConvert(inp) {
    if (!inp || inp.dataset.ceDone || inp.readOnly) return;
    var t = inp.type;
    // v3.6.x：原生选择器类型（date/time/datetime-local/…）不转换——转成 contenteditable
    // 后失去原生选择面板，且 contenteditable 不会派发 change 事件，恋爱纪念日这类
    // 依赖原生 picker 的输入会彻底失效（安卓 Chrome/Edge 上无法设置、桌面组件不更新）
    if (t === 'checkbox' || t === 'range' || t === 'file' || t === 'color' || t === 'hidden' ||
        t === 'date' || t === 'time' || t === 'datetime-local' || t === 'month' || t === 'week') return;
    inp.dataset.ceDone = '1';
    // v3.26.x #118：先抓原始 className 再加 ce-ghost——避免可见的 ce-box div 继承到
    // ce-ghost 类别名（CSS 当前只对 input/textarea 生效未致视觉异常，但逻辑 bug：
    // 未来加 div.ce-ghost 规则会误伤；box 只需继承原始边框/背景等视觉类）
    var origClass = inp.className || '';
    inp.classList.add('ce-ghost');
    inp.setAttribute('aria-hidden', 'true');
    // 创建接管输入的 contenteditable div（插到 input 后面）
    var box = document.createElement('div');
    // 继承原输入框样式类（边框/背景/圆角等视觉不变）+ ce-box 基础排版
    box.className = 'ce-box ' + origClass;
    box.setAttribute('contenteditable', 'true');
    box.setAttribute('spellcheck', 'false');
    box.dataset.for = inp.id || '';
    // v3.5.138：复制 inputmode——数字输入框（回复设置 stepper 等设了 inputmode=decimal）
    // 转成 ce-box 后仍弹数字键盘，否则手机弹全键盘
    var inpMode = inp.getAttribute('inputmode');
    if (inpMode) box.setAttribute('inputmode', inpMode);
    var ph = inp.getAttribute('placeholder') || '';
    if (ph) box.setAttribute('data-ph', ph);
    // 高度：textarea 按行数估算，input 用原高度/默认
    if (inp.tagName === 'TEXTAREA') {
      var rows = parseInt(inp.getAttribute('rows'), 10) || 3;
      box.style.minHeight = Math.max(48, Math.round(rows * 1.5 * 16)) + 'px';
      box.style.resize = 'none';
    } else {
      box.style.minHeight = '24px';
    }
    box.style.display = 'block';
    box.style.boxSizing = 'border-box';
    // v3.5.133：复制原 inline style（margin 等元素选择器样式转换后丢失——
    // 如 #div-chat-question 的 margin:8px 0）；跳过 box 已设置的关键属性
    if (inp.getAttribute('style')) {
      var skip = ['display', 'min-height', 'box-sizing'];
      try {
        var st = inp.style;
        for (var si = 0; si < st.length; si++) {
          var pn = st[si];
          if (skip.indexOf(pn) >= 0) continue;
          var pv = st.getPropertyValue(pn);
          if (pv) box.style.setProperty(pn, pv);
        }
      } catch (e) {}
    }
    // v3.6.x：hidden 同步——原 input/textarea 可能被业务逻辑按需隐藏
    // （如通用弹层单行模式隐藏 textarea、编辑弹窗切输入/多行），contenteditable
    // box 必须跟随隐藏，否则会多出一个可见的占位框（昵称弹窗出现"多行内容"）。
    // 用内联 display 控制（hidden 属性会被 box.style.display='block' 覆盖，不生效）
    function syncCeHidden() {
      box.style.display = inp.hidden ? 'none' : 'block';
    }
    syncCeHidden();
    try {
      var hmo = new MutationObserver(syncCeHidden);
      hmo.observe(inp, { attributes: true, attributeFilter: ['hidden'] });
    } catch (e) {}
    // maxlength 支持（contenteditable 不原生生效，手动截断）
    // v3.5.131：动态读取——maxLength 可能是弹窗打开后才设置的（openModal 设 input.maxLength），
    // 转换时固化会得到 0（安卓上昵称/备忘长度限制失效）
    var isMulti = inp.tagName === 'TEXTAREA';
    box.addEventListener('input', function () {
      var maxLen = parseInt(inp.getAttribute('maxlength'), 10) || inp.maxLength || 0;
      if (maxLen > 0 && box.textContent.length > maxLen) {
        // v3.5.133：按码点截断——UTF-16 slice 会切开 emoji 代理对产生乱码入库
        box.textContent = Array.from(box.textContent).slice(0, maxLen).join('');
        // 光标移到末尾
        try {
          var r = document.createRange();
          r.selectNodeContents(box);
          r.collapse(false);
          var s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        } catch (e) {}
      }
    });
    // v3.5.133：输入法组合结束补截一次（组合中被跳过的超长内容）
    box.addEventListener('compositionend', function () {
      var maxLen = parseInt(inp.getAttribute('maxlength'), 10) || inp.maxLength || 0;
      if (maxLen > 0 && box.textContent.length > maxLen) {
        box.textContent = Array.from(box.textContent).slice(0, maxLen).join('');
        try {
          var r = document.createRange();
          r.selectNodeContents(box);
          r.collapse(false);
          var s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        } catch (e) {}
      }
    });
    // 单行输入框：Enter 不插入换行（原 input 行为一致）
    if (!isMulti) {
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') e.preventDefault();
      });
    }
    // 注入数据锚点：input 的 value 读写、focus/blur、事件转发都由 box 代理
    inp.__ceBox = box;
    box.__ceInp = inp;
    // v3.5.128：box 必须插入 DOM（插到 input 前，ghost 只占 1px 不可见）——
    // 此前漏了插入，input 变 ghost 后用户看不到也输不了输入框
    try { inp.parentNode.insertBefore(box, inp); } catch (e) {}
    // 兼容原代码：input.value / input.focus / input.blur / input.addEventListener
    Object.defineProperty(inp, 'value', {
      get: function () {
        // v3.6.x：多行输入框（textarea）必须还原换行——contenteditable 里按 Enter
        // 产生的是块级 <div> 结构或字面 \n 文本，textContent 不保留块级换行（返回
        // 「选项1选项2」），依赖换行分割的业务（帮我决定选项、批量导入等按行读取）
        // 会拿到 1 行。v3.9.x：innerText 在夸克等内核会丢字面 \n，见下方 isMulti
        // 分支与 ceMultiText——多行取值 = innerText 与 DOM 遍历版取换行更多者。
        // v3.5.135：邮件媒体标记（隐藏 span.mail-media-mark 存 sticker:/image: 文本）
        // display:none 时 innerText 读不到——按 DOM 顺序重组保证图片与文字顺序一致；
        // 仅对含标记的 box 生效（其他输入框保持原 innerText/textContent 逻辑不变）
        try {
          if (box.querySelector('span.mail-media-mark') || box.querySelector('img[src*="data:image"]')) {
            let out = '';
            let lastWasMedia = false; // 上一段是媒体标记 → 后续文字补空格，防止 base64 与文字粘连
            // v3.23.x：改递归提取——Chrome 安卓按回车会把后续文字包进顶层 <div>（嵌套亦常见），
            // 旧实现顶层扁平遍历遇 DIV 只补 \n 不取字，第二行起全部丢失：插入表情包/图片后
            // 再写的信件内容在【发送取值那一刻】就被截掉，重开只剩第一行（真机实测 bug）。
            // 递归版：DIV/P 视为块级换行并取其内文字与媒体；块级之后的顶层文字/内联另起一行。
            var walkMedia = function (node) {
              let afterBlock = false; // 上一个兄弟是块级 → 之后的顶层文字/内联是新的一行
              node.childNodes.forEach(function (n) {
                if (n.nodeType === 3) {
                  const t = n.textContent || '';
                  if (!t) return;
                  if (afterBlock) { if (out && !out.endsWith('\n')) out += '\n'; afterBlock = false; }
                  else if (lastWasMedia && out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
                  out += t;
                  lastWasMedia = false;
                  return;
                }
                if (n.nodeType !== 1) return;
                if (n.classList && n.classList.contains('mail-media-mark')) {
                  if (afterBlock) { if (out && !out.endsWith('\n')) out += '\n'; afterBlock = false; }
                  else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
                  out += n.textContent;
                  lastWasMedia = true;
                  return;
                }
                if (n.tagName === 'IMG' && n.src && n.src.indexOf('data:image') === 0) {
                  // v3.5.137：mailInsertInto 插入图片时 <img> 后面紧跟隐藏标记 span，
                  // 完整标记文本已由 span 提供，这里跳过 img，避免同一张图被输出两遍
                  // （安卓写信/回信插入表情包/图片后，信件里同一张图出现两次的 bug）
                  // v3.6.x：兼容「用户在图片后点光标输入文字」（文本被插到 img 与
                  // span 之间，紧邻判断失效）——改为整框查找包含该 src 的隐藏标记
                  let covered = false;
                  try {
                    box.querySelectorAll('span.mail-media-mark').forEach(function (sp) {
                      if (!covered && sp.textContent && sp.textContent.indexOf(n.src) >= 0) covered = true;
                    });
                  } catch (e) {}
                  if (!covered) {
                    // img 的标记 span 被用户退格删掉时，从 src 重建标记——
                    // 否则该图片在保存时丢失（数据丢失风险）
                    if (afterBlock) { if (out && !out.endsWith('\n')) out += '\n'; afterBlock = false; }
                    else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
                    out += 'image:' + n.src;
                    lastWasMedia = true;
                  }
                  return;
                }
                if (n.tagName === 'BR') { out += '\n'; lastWasMedia = false; return; }
                if (n.tagName === 'DIV' || n.tagName === 'P') {
                  if (out && !out.endsWith('\n')) out += '\n';
                  walkMedia(n);
                  afterBlock = true;
                  lastWasMedia = false;
                  return;
                }
                // v3.9.x：粘贴富文本产生的 <span>/<b>/<i> 等内联元素——补充其文字，
                // 否则插入过图片后粘贴带格式文本，这些文字在保存时会静默丢失
                const inner = n.textContent || '';
                if (inner) {
                  if (afterBlock) { if (out && !out.endsWith('\n')) out += '\n'; afterBlock = false; }
                  else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
                  out += inner;
                  lastWasMedia = false;
                }
              });
            };
            walkMedia(box);
            return out;
          }
        } catch (e) {}
        if (isMulti) {
          // v3.9.x：多行取值内核兜底——innerText 与 DOM 遍历版（ceMultiText）都算，
          // 取换行更多的那个。标准内核两者一致；夸克等 innerText 丢字面 \n 的内核
          // 走遍历版（屏幕上分了 N 行就能读回 N 行，所见即所得）；遍历版也漏掉
          // 的极端结构（罕见块级标签）仍保底 innerText
          try {
            var itTxt = '';
            try { itTxt = box.innerText || ''; } catch (e2) {}
            var walkTxt = ceMultiText(box);
            var itN = (itTxt.match(/\n/g) || []).length;
            var wkN = (walkTxt.match(/\n/g) || []).length;
            if (wkN > itN) return walkTxt;
            return itTxt || walkTxt || box.textContent || '';
          } catch (e) {}
        }
        return box.textContent || '';
      },
      set: function (v) {
        const s = (v == null ? '' : String(v));
        if (isMulti) {
          // v3.9.x：回填改 textContent 直写——ce-box 是 pre-wrap，字面 \n 即换行显示，
          // 全内核行为一致；innerText setter 的 \n→<br> 转换在部分内核（夸克等）
          // 不可靠，可能把多行回填写成一行
          try { box.textContent = s; return; } catch (e) {}
        }
        box.textContent = s;
      },
      configurable: true
    });
    Object.defineProperty(inp, 'placeholder', {
      get: function () { return box.getAttribute('data-ph') || ''; },
      set: function (v) { if (v) box.setAttribute('data-ph', v); else box.removeAttribute('data-ph'); },
      configurable: true
    });
    // v3.10.x：box 也挂 value 代理——历史代码大量存在 querySelector('.cls') 按 class
    // 选输入框的写法，转换后首个匹配是继承同名的 ce-box div（插在原 input 前），
    // DIV 无 value 属性 → 读回 undefined：轻则 parseFloat/parseInt 得 NaN 静默存错值，
    // 重则 .trim()/.length 抛 TypeError 中断整个保存回调（vivo Edge 经期「记录今天」
    // 点保存不保存即此根因，OPPO 存钱罐/Via 读空同族）。box.value 双向转发到
    // inp.value（完整复用其多行换行还原/媒体标记逻辑，无递归——inp 的 getter 直读
    // box DOM 不经 box.value），旧写法零改动即在所有内核恢复正确。
    try {
      Object.defineProperty(box, 'value', {
        get: function () { return inp.value; },
        set: function (v) { inp.value = v; },
        configurable: true
      });
    } catch (e) {}
    var origFocus = inp.focus, origBlur = inp.blur;
    inp.focus = function () { try { box.focus(); } catch (e) {} };
    inp.blur = function () { try { box.blur(); } catch (e) {} };
    // 事件转发：input/change/keydown/keyup/click 从 box 代理到 inp
    //（keydown 需复制 key/keyCode/isComposing——原代码用它判断 Enter/中文输入）
    // v3.5.133：cancelable:true——业务 e.preventDefault()（如 feed 评论 Enter）才能生效
    ['input', 'change', 'keydown', 'keyup', 'click', 'compositionstart', 'compositionend'].forEach(function (ev) {
      box.addEventListener(ev, function (e) {
        var clone = new Event(ev, { bubbles: true, cancelable: true });
        if (e.data !== undefined) clone.data = e.data;
        if (ev === 'keydown' || ev === 'keyup') {
          clone.key = e.key; clone.keyCode = e.keyCode; clone.isComposing = e.isComposing;
        }
        if (ev === 'input' && e.inputType !== undefined) clone.inputType = e.inputType;
        try { inp.dispatchEvent(clone); } catch (err) {}
      });
    });
    // 触摸/点击聚焦：contenteditable 天然可聚焦，无需额外处理
    box.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
    // focus/blur 不冒泡，单独转发到 inp（原代码可能监听 inp 的 blur/focus）
    // v3.26.x #197：contenteditable 不会自发派发 change（见上方 v3.9.x 注释）——上面的
    // 转发只在 box 自己发出 change 时才生效，而 box 永远不会发。业务把保存挂在原
    // input 的 change（gift-shop 心愿单概率、全站数字/日期设置项）时安卓上永不等触发，
    // 值「改了但没存」退出即回默认（小米15Pro Chrome 实测；所有安卓机型通病）。
    // 修法：blur 时若内容相对聚焦时已变化，补派一次 change（走上方既有转发链到 inp），
    // 语义与原生 input 的 change 一致；iOS 不做转换不受影响。
    var ceChangeVal = null;
    box.addEventListener('focus', function () { ceChangeVal = box.textContent || ''; });
    box.addEventListener('blur', function () {
      try {
        if (ceChangeVal !== null && (box.textContent || '') !== ceChangeVal) {
          box.dispatchEvent(new Event('change', { bubbles: true }));
        }
        ceChangeVal = null;
      } catch (e) {}
    });
    box.addEventListener('focus', function () { try { inp.dispatchEvent(new Event('focus', { bubbles: true })); } catch (e) {} });
    box.addEventListener('blur', function () { try { inp.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} });
    // 初始文本：input 若已有 value（如编辑回填），同步进 box
    // v3.5.130：textarea 的 value 是 JS 属性（无 value attribute）——getAttribute 取不到，
    // 导致打开面板后回显为空、点"应用"即清空内容；回退读 .value
    var initV = inp.getAttribute('value');
    if (initV === null && inp.value !== undefined) initV = inp.value;
    if (initV) box.textContent = initV;
  }
  // 启动转换：页面现有文本输入框 + 动态创建（MutationObserver 兜底）
  // v3.6.x：仅非 iOS 启用（iOS Safari 保留原生输入框，见上方说明）
  try { if (!isIOS) initCeAll(); } catch (e) {}
  try {
    if (!isIOS) {
      // v3.26.x 性能修复（prof-mobile-lag 实测归因）：旧实现任何 body childList 变动
      // （聊天每插一条消息/每开一个面板都会触发）都全文档重扫一遍 input 选择器——
      // 大 DOM（1 万+节点）上单次 3~10ms，切 4 次桌面累计 550ms+ 长任务，是安卓
      // 「点击迟钝/切桌面卡」的实测主因。改为只扫本批新增节点的子树：
      // ceConvert 幂等（dataset.ceDone），新节点里没有输入框时子树查询近零开销。
      // 启动全量已由上方 initCeAll 覆盖，观察器只补动态新增，语义不变。
      var CE_SCAN_SEL = 'input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea';
      var ceMo = new MutationObserver(function (muts) {
        for (var mi = 0; mi < muts.length; mi++) {
          var added = muts[mi].addedNodes;
          for (var ai = 0; ai < added.length; ai++) {
            var n = added[ai];
            if (!n || n.nodeType !== 1) continue;
            try {
              if (n.matches(CE_SCAN_SEL)) ceConvert(n);
              var sub = n.querySelectorAll(CE_SCAN_SEL);
              for (var si = 0; si < sub.length; si++) ceConvert(sub[si]);
            } catch (e) {}
          }
        }
      });
      ceMo.observe(document.body, { childList: true, subtree: true });
    }
  } catch (e) {}

  // v3.5.139：聚焦瞬间兜底转换（捕获阶段）——修复动态输入框的时序竞态：
  // 弹层输入框（如问问TA回答框 qa-input）是动态插入的，面板打开时代码可能
  // 立即 focus()；MutationObserver 的转换是异步微任务，来不及接管时 Chrome
  // 已对「原生 input 聚焦」瞬间弹出「自动填充」条（用户实测：问问TA顶部
  // 问题输入栏仍弹条）。这里在 focusin 捕获阶段同步转换并把焦点移交 ce-box，
  // 原生 input 随即失焦，Chrome 收回弹条；已转换的（有 __ceBox）直接跳过。
  if (!isIOS) {
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') return;
      if (t.dataset.ceDone || t.__ceBox) return;
      var ty = t.type;
      if (ty === 'checkbox' || ty === 'range' || ty === 'file' || ty === 'color' || ty === 'hidden' ||
          ty === 'date' || ty === 'time' || ty === 'datetime-local' || ty === 'month' || ty === 'week') return;
      ceConvert(t);
      if (t.__ceBox) { try { t.__ceBox.focus(); } catch (err) {} }
    }, true);
  }

  // v3.5.140：focus 原型层拦截——竞态根治（focusin 兜底是事后补救，
  // Chrome 对原生 input 聚焦的瞬间就可能已弹出「自动填充」条，弹条后再
  // 移交焦点个别版本不收回）。这里在 focus 调用发生「之前」拦截：
  // 未转换的文本输入框被 focus() 时先同步转换、再聚焦 ce-box——
  // 任何代码路径（弹窗打开即聚焦等）都无法让原生 input 真正持焦，
  // Chrome 从头到尾看不到「聚焦的表单字段」，弹条无从触发。
  // 已转换（__ceBox）走实例代理；ceDone 标记的（OPPO 等兼容名单）与
  // checkbox/date 等类型直接放行原生 focus，行为不变。
  if (!isIOS) {
    function ceNeedsConv(t) {
      if (!t || t.dataset.ceDone || t.__ceBox) return false;
      var ty = t.type;
      return !(ty === 'checkbox' || ty === 'range' || ty === 'file' || ty === 'color' || ty === 'hidden' ||
        ty === 'date' || ty === 'time' || ty === 'datetime-local' || ty === 'month' || ty === 'week');
    }
    var _origInpFocus = HTMLInputElement.prototype.focus;
    HTMLInputElement.prototype.focus = function () {
      if (this.__ceBox) { try { this.__ceBox.focus(); } catch (e) {} return; }
      if (ceNeedsConv(this)) {
        ceConvert(this);
        if (this.__ceBox) { try { this.__ceBox.focus(); } catch (e) {} return; }
      }
      return _origInpFocus.apply(this, arguments);
    };
    var _origTAFocus = HTMLTextAreaElement.prototype.focus;
    HTMLTextAreaElement.prototype.focus = function () {
      if (this.__ceBox) { try { this.__ceBox.focus(); } catch (e) {} return; }
      if (ceNeedsConv(this)) {
        ceConvert(this);
        if (this.__ceBox) { try { this.__ceBox.focus(); } catch (e) {} return; }
      }
      return _origTAFocus.apply(this, arguments);
    };
  }

  // v3.16.x：ce-box 合成层通用刷新（AI-B 域，通用化 ta-ask.js 的 .ta-add 局部缓解，
  // 合入 AI-A 留言：见 WORKLOG 2026-08-23 问 TA 管理页「文字与输入框边框分离」）。
  // ceConvert 把文本输入框转成 contenteditable .ce-box，输入文字渲染在独立合成层；
  // 安卓键盘弹起致 .phone 平移（_aPanComp position:relative+top）/高度收缩、或半框
  // 面板被 kbDockPanels 改成 fixed 停靠时，该合成层停在旧位不跟随布局 → 表现=
  // 「输入的文字飞出输入框 / 文字与框分离」（问问TA 半框、占卜、page-ta-ask 通用）。
  // 与 ta-ask.js 同法：对可见 .ce-box 强制 reflow + toggle transform:translateZ(0)
  // 触发合成层重新提交到当前位置，随即还原（不带位移动，不改变布局）。仅安卓启用。
  function _aRefreshCe() {
    // v3.28.x：键盘收起动画期跳过——此时每帧 resize 已驱动 .phone height 跟随，
    // ce-box 作为正常流元素位置随 layout 自动更新合成层，无需 toggle transform
    // 强制 reflow；收起期高频 reflow 是"收起键盘卡顿"主因。复原后自然恢复。
    try { if (_aClosing) return; } catch (e) {}
    // 摩托罗拉G100/雨见：用户刚敲了键、正在输入时，禁止对其它/自身 ce-box
    // toggle transform。正在被输入的元素在 WebKit 内核里被强制重排/重建合成层，
    // 会丢掉当前键入/组合的第一段输入（症状：打完字框里没字，重打一遍才好）。
    try { if (Date.now() - _aUserTypos < 500) return; } catch (e) {}
    try {
      var list = document.querySelectorAll('.ce-box');
      if (!list || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (b.offsetParent === null) continue; // display:none/隐藏祖先 跳过
        var prev = b.style.transform;
        b.style.transform = 'translateZ(0)';
        void b.offsetHeight;
        b.style.transform = prev;
      }
    } catch (e) {}
  }
  var _aCeT = null;
  function _aSchedCe() {
    if (isIOS) return;
    clearTimeout(_aCeT);
    _aCeT = setTimeout(_aRefreshCe, 60);
  }

  // 摩托罗拉G100/雨见「首次键入丢失」：记录用户最近一次真实按键时间戳——
  // 键盘会话内任意按键（含中文输入法 229 组合键、英文直接键入）都会刷新它，
  // 供 _aRefreshCe 在用户正在敲键时跳过「toggle 输入元素 transform」的合成层刷新
  // （该 toggle 在部分 WebKit 内核上会丢掉当前键入/组合的第一段输入）。
  var _aUserTypos = Date.now();
  // v3.28.x：安卓键盘收起动画进行中标记——此期间 _aRefreshCe 跳过 ce-box 强制 reflow
  //（收起期每帧 resize 叠加 reflow 是"收起键盘卡顿"的主因之一）。仅安卓分支置位/清理。
  var _aClosing = false;
  try {
    document.addEventListener('keydown', function () { _aUserTypos = Date.now(); }, true);
  } catch (e) {}

  // v3.5.128：readonly 起手方案已删除——它会被本转换器完全替代：
  // 文本输入框已统一变为 contenteditable div（Chrome 不对其弹自动填充条），
  // 原 input 退场为幽灵锚点不可交互，readonly 不再有任何作用且会干扰动态转换。

  // v3.6.x：输入法（IME）弹出适配改为「最小干预」——
  // 此前用 visualViewport 把 .phone 锁定成 position:fixed + 键盘高度 + --ime-h 补偿，
  // 在部分安卓机上实测引发：输入法弹窗被截断、页面持续闪屏、输入法弹不出来。
  // 根因：聚焦时 window.scrollTo(0,0) 与浏览器原生滚动打架，地址栏显隐使 visualViewport
  // 高度抖动被误判为「键盘弹出」→ 反复锁高/解锁形成闪烁死循环；锁高又把 .phone 压成
  // 错误高度，键盘像被「截断」。通话中来电 blur + --ime-h 补偿与之叠加更明显。
  // 现在不锁 .phone、不写 --ime-h、不加 ime-open：
  //   · viewport meta 已带 interactive-widget=resizes-content——安卓 Chrome/Edge 会把
  //     布局视口收缩到键盘上方，.phone 的 100dvh 随之重算，输入栏天然停靠键盘上方；
  //   · 其余浏览器由系统原生把聚焦输入框滚到键盘上方，无需 JS 干预。
  // 这里只保留一个轻量兜底：聚焦后把输入框所在的滚动容器（聊天消息区等）滚到可见，
  // 不滚 window、不重复执行——仅给个别浏览器原生滚动不到位时补位。
  function isTextEl(el) {
    return el && ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      ? (el.type !== 'checkbox' && el.type !== 'range' && el.type !== 'file' && el.type !== 'color' && !el.readOnly)
      : el.isContentEditable === true);
  }
  var nudgeTimer = null;
  // v3.26.x：聚焦可编辑框「内部滚动残留」自愈——修红米 K60 至尊版 + Edge 报障
  // 「聊天输入栏打字不显示、一片空白、消息发不出去」。
  // 机理：.chat-input 是 overflow-y:auto + max-height:96px 的 contenteditable，
  // 安卓内核为露出光标会把它自身的 scrollTop 顶上去；文字被删短/一次重排后
  // scrollHeight 已 ≤ clientHeight，scrollTop 却不回零 → 框内其实有字，只是被
  // 自己的滚动推出了可见裁剪区：看着就是「输了但空白」，而数据是对的（所以
  // 有的用户能盲发出去）。只在内容不超高时归零，多行真滚动绝不干预。
  function healEditableScroll(el) {
    try {
      if (!el || !(el.scrollTop > 0)) return;
      if (el.scrollHeight <= el.clientHeight + 1) el.scrollTop = 0;
    } catch (e) {}
  }
  // 删字/清空/输入法提交后立刻复检（input 是唯一可靠时机，此时 scrollHeight
  // 已按新内容重算）；焦点仍在同一元素上，归零不会打断光标。
  try {
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!isTextEl(t)) return;
      healEditableScroll(t);
    }, true);
  } catch (e) {}
  // #538：补位涉及的滚动容器清单（nudgeInputVisible 用它定位「聚焦输入框所在的滚动区」）。
  var NUDGE_SCROLLER_SEL = '.chat-body, .card-list, .gs-scroll, .tc-body, .mem-scroll, .cal-scroll, .div-scroll, .fav-list, .mail-list, .qa-body, .modal, .chat-ask-body, .poke-card-scroll, .chat-decision-body';
  function nudgeInputVisible() {
    var active = document.activeElement;
    if (!isTextEl(active) || !active.getBoundingClientRect) return;
    healEditableScroll(active);
    var r = active.getBoundingClientRect();
    try {
      var scroller = active.closest(NUDGE_SCROLLER_SEL);
      if (!scroller) return;
      var sr = scroller.getBoundingClientRect();
      // FIX 2026-09-15 #491 信箱回信页「下滑被拉回、无法正常滑动」（vivo S20 Edge 等多机型）
      // 根因：本函数被键盘看门狗（startKbWatch/startAWatch 聚焦期间每 250ms）反复调用，
      // 只要聚焦输入框底边低于滚动容器下缘就 scrollTop 拉回——聊天输入栏在滚动区外
      // （closest 找不到容器＝免疫），而回信页输入框（.mail-compose-input 的 ce-box）
      // 在 .cal-scroll 内部＝用户下滑读原信，≤250ms 内必被拽回「输入框可见」位，
      // 每滑一次弹一次（无头 scrollTop setter 陷阱实锤：唯一写手就是本函数）。
      // 修法＝几何记忆：滚动容器下缘/宽度与输入框高度都没变（＝现状只可能出自用户
      // 手动滚动）时不补位；键盘开合/布局变化（几何变）仍照旧补位一次，防「输入法
      // 挡住输入栏」的原始职责不变。零机型分支，iOS/安卓两条轮询同时收敛。
      // FIX 2026-09-15 #538 记忆键与抖动阈值都不得被「可视视口噪声」击穿（用户报「输入框一直
      // 上弹，无法拉到顶部停留」，iPhone Safari）：
      // 原键含容器底边 sr.bottom —— iOS 输入法候选条逐字显隐 / 键盘动画 / 工具条伸缩都会改
      // 可视高 → 容器底边变 → 键每次不同 → 几何记忆恒失效 → 看门狗每 250ms tick 照着旧几何
      // 重写 scrollTop，把用户（或内核让 caret 可见时的系统滚动）拉回「输入框可见」位＝打一个
      // 字弹一下。候选条本来就是一个字显一次，所以看起来是「每个字符都上弹」。
      // 修法两层，判据全是「容器几何/视口变化量」，不含任何机型分支：
      //   ① 键只留「与可视视口无关的容器内容几何」= 宽度 + 内容高（键盘推顶 .phone 时二者不变）；
      //   ② 视口高变化量要够「真键盘量级」（≥90px）才重做一次补位——候选条显隐（iOS 中文输入法
      //      逐字换候选条≈44px）、浏览器工具条伸缩这类小抖动一律忽略；真键盘开合（≈200~300px）
      //      仍照旧补位一次，防「输入法挡住输入栏」的原始职责完整保留。
      var geomKey = Math.round(sr.width) + 'x' + Math.round(scroller.scrollHeight);
      var vhNow = Math.round(sr.height);
      if (scroller.__nudgeGeom === geomKey && Math.abs(vhNow - (scroller.__nudgeVH || vhNow)) < 90) return;
      scroller.__nudgeGeom = geomKey;
      scroller.__nudgeVH = vhNow;
      if (r.bottom > sr.bottom - 8) {
        // FIX 2026-09-18 #743（HUAWEI Mate 40 Pro + Edge 等跨机型报「写信/回信打字看不见第一行、
        // 页面疯狂上下抖动」，用户要求勿致其他机型回归）：旧实现一律把输入框底边拖进可视——
        // 多行长文写信/回信（.mail-compose-input rows=10~12）在键盘收缩后的可视区内比容器还高，
        // 拖底边入视必然把首行顶出可视上沿（==「第一行看不见」），且每次键入·内容长高全量拖一遍
        // == 上下乱抖。改为：输入框比可视容器还高 或 首行已被卷出可视时，只回卷到顶部保住第一行，
        // 绝不往下拖；普通短输入框（聊天/问问TA/占卜等，比可视区矮）走原拖底逻辑，行为逐字节不变。
        var ovf = r.bottom - (sr.bottom - 8);
        var _elH = (active && active.offsetHeight) || 0;
        var _topHidden = sr.top - r.top; // >0 ＝ 输入框顶部已卷到可视上沿之上
        if ((_topHidden > 0) || (_elH > (sr.height - 8))) {
          if (_topHidden > 0) scroller.scrollTop = Math.max(0, scroller.scrollTop - _topHidden - 8);
        } else {
          scroller.scrollTop = Math.max(0, scroller.scrollTop + ovf + 16);
        }
      }
    } catch (e) {}
  }
  // 聚焦兜底：单次延迟补位（输入法弹出有时间差），不重复触发
  document.addEventListener('focusin', function () {
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(nudgeInputVisible, 300);
  });
  // 输入法收起（失焦）无需任何处理：.phone 高度从未被 JS 改动

  // ===== v3.12.x：键盘保底停靠的公共信号（下方 iOS / 安卓两分支共用） =====
  // 背景（用户反馈「首次点击聊天输入栏打字，输入法把输入栏一行完全挡住」）：
  // 上面的键盘适配全靠 visualViewport.height 收缩来检测键盘；腾讯 X5、旧版夸克、
  // 部分国产 ROM 浏览器是「纯悬浮键盘」——interactive-widget 不生效、vv 高度也不变，
  // 检测信号永远不来 → .phone 永不收缩 → 输入栏被盖住且不自愈。两分支各加一条
  // 二线兜底（_iProvCheck / _aProvCheck），这里先备好两个公共判定信号：
  var kbLastTouchAt = 0;
  var kbLastTouchTarget = null;
  // 「最近一次触摸」时间戳 + 触摸目标——软键盘弹出必然源于用户【直接点按输入框】；
  // 而程序化 .focus()（邀请TA/问问TA 等半框打开即自动聚焦）在安卓上通常【不】弹键盘。
  // v3.13.x：只记时间戳不够——点【问问TA】按钮后 80ms 面板程序化聚焦问题输入框，
  // 时间窗（<1.5s）照样命中 → 无键盘却把 .phone 假收缩到 58%（面板被压扁变形、
  // ce-box 合成层文字停在旧位置=「字出界出现在框下面」，小米15Pro Chrome 实测复现）。
  // 补触摸目标校验 kbTouchArmed()：聚焦元素与触摸目标无包含关系不武装。
  try {
    document.addEventListener('touchstart', function (e) { kbLastTouchAt = Date.now(); kbLastTouchTarget = e.target; }, { passive: true, capture: true });
  } catch (e) {}
  // 保底武装校验：聚焦元素 = 触摸目标本身（或互为包含，兼容 label 包 input、
  // 输入框内点击子节点等结构）。X5 等纯悬浮键盘真场景手指点的就是输入框，必过。
  function kbTouchArmed(tgt) {
    if (!tgt || !kbLastTouchTarget) return false;
    try {
      return tgt === kbLastTouchTarget || tgt.contains(kbLastTouchTarget) || kbLastTouchTarget.contains(tgt);
    } catch (e) { return false; }
  }
  var kbHardKeyUntil = 0;
  // 「物理/外接键盘」抑制信号——真实按键（keyCode 229 是中文输入法组合标记，
  // 软键盘多数内核不派发 keydown 或恒为 229，不会误伤）。外接键盘打字场景
  // 软键盘不弹，30s 内不再做保底收缩。
  try {
    document.addEventListener('keydown', function (e) {
      try { if (e.keyCode !== 229) kbHardKeyUntil = Date.now() + 30000; } catch (err) {}
    }, true);
  } catch (e) {}

  // ================= iOS 专用：键盘（IME）弹出适配（v3.6.x） =================
  // iOS Safari 键盘是 overlay 模式——弹出时【不收缩布局视口】，.phone 的 100dvh
  // 不会重算，输入栏会被键盘盖住，看起来像"键盘没弹/无法输入"（安卓 Chrome/Edge
  // 靠 viewport 的 interactive-widget=resizes-content 自动收缩，无需此处理）。
  // 这里仅对 iOS 启用 visualViewport 锁高：键盘弹出时把 .phone 收缩到可视高度，
  // 输入栏天然停靠键盘上方；收起时恢复。安卓不受影响（isIOS 分支）。
  // .chat-body 的 translateZ(0)（防安卓白屏）在 iOS 上也会引发滚动异常——
  // 一并在此用内联 transform:none 豁免（JS 判断 iOS 比 CSS @supports 可靠）。
  // v3.6.x：不用 position:fixed 锁高——iOS Safari 已知问题：contenteditable
  // （聊天输入框就是模板原生 contenteditable div）位于 fixed 祖先内、键盘弹起时
  // 无法输入（caret 与 visualViewport 冲突，表现：点了输入框、键盘弹出、打不进字）。
  // 改用 flex 顶对齐 + 高度收缩：body 是 flex 容器（align-items:center），
  // 给 .phone 设 align-self:flex-start 顶对齐后高度=可视高度，底部恰好停在键盘
  // 上沿，效果与 fixed 一致；但 .phone 保持普通流定位（水平居中由 body 的
  // justify-content:center 负责，宽屏手机内容限宽也无需额外 hack），
  // contenteditable 正常输入。高度写入只在值变化时执行——键盘动画期间
  // visualViewport 高频 resize 事件不再每次触发整页 reflow（几千条消息时
  // 反复重排 = 打字卡顿）。
  if (isIOS) {
    try {
      var _phone = document.querySelector('.phone');
      var _cb = document.getElementById('chat-body');
      if (_cb) _cb.style.transform = 'none'; // iOS 豁免合成层，避免滚动卡顿
      var _vv = window.visualViewport;
      var _kbActive = false;
      var _pinUntil = 0; // v3.7.x：键盘开合动画窗口，窗口内才 pinScrollTop
      // ===== v3.26.x：键盘检测改「实测基线」，废除只涨不落的 _noKbH 棘轮 =====
      // 旧实现：_noKbH 在模块加载时取 vv.height，之后只允许向上更新
      //（`: if (!_kbActive && _h > _noKbH) _noKbH = _h;`），键盘开启判定是
      //  vv.height < _noKbH-60。Edge iOS 底部工具条显隐会让真实可视高度反复变化，
      //  一旦被瞬时大值抬上去就永不回落 → 之后【没有键盘】时聚焦任意输入框，
      //  _kbStill 恒真 → 走「键盘开启」全链路：收缩 .phone + align-self:flex-start +
      //  lockDocScroll(内联 html{overflow:hidden}) + 每 250ms pinScrollTop(vv.scrollTo(0,0))
      //  → 用户报修「页面突然上移、什么都点不动」「输入栏下面空一大块」。
      // 新实现：两条基线在【没有任何文本框聚焦】期间双向跟随（可涨可落），
      //  键盘开启 = 相对基线明显收缩，两者都不成立即判「无键盘」并复原。
      //  同时兼容两种键盘模型（iOS 版本/内核行为不一致，不靠猜）：
      //   · overlay 模型（WebKit 传统行为，忽略 interactive-widget）：布局视口不变、
      //     只有 visualViewport 收缩 → 需要我们手动把 .phone 收到 vv.height。
      //   · resizes-content 模型（本文件 :39-45 给 iOS 改写的 viewport meta，新版
      //     WebKit 已认）：布局视口自身收缩、.phone 的 100dvh 自动跟随 → 此时
      //     【绝不能再收一次】，否则就是双重收缩（输入栏下方凭空多一块空白）。
      var _fullInner = window.innerHeight || 0;
      var _fullVv = _vv ? Math.round(_vv.height) : _fullInner;
      function _syncFullBase() {
        // 仅在无文本框聚焦时调用：跟随当前真实视口（允许变小）
        var ih = window.innerHeight || 0;
        var vh = _vv ? Math.round(_vv.height) : ih;
        if (ih > 0) _fullInner = ih;
        if (vh > 0) _fullVv = vh;
      }
      // .phone 高度唯一写入口（syncIosKb / _ensureInputDocked / _iProvDock 三处
      // 原来各自直写内联 height，互相改写→反复重排）。迟滞 ≥6px 才提交，
      // null 表示清回样式表值（100dvh / standalone 的 100vh）。
      function _setPhoneH(px, reason) {
        try {
          if (px === null || px === undefined) {
            if (_phone.style.height !== '') _phone.style.height = '';
            return;
          }
          var floor = Math.round(_fullInner * 0.4); // 输入法最多占屏 60%，再小必是异常读数
          var nh = Math.max(floor, Math.round(px));
          var cur = parseFloat(_phone.style.height);
          if (_phone.style.height && Math.abs((isNaN(cur) ? nh + 99 : cur) - nh) < 6) return;
          if (_phone.style.height !== nh + 'px') _phone.style.height = nh + 'px';
        } catch (e) {}
      }
      // v3.10.x：当前聚焦的文本元素（focusin/focusout 可靠上报）。iOS Safari 在
      // contenteditable（聊天输入栏就是 contenteditable div）聚焦/编辑时常返回
      // document.activeElement === <body>，isTextEl 判不出来 → 下方 _open 恒为 false
      // → .phone 永不收缩 → 键盘盖住输入栏完全无法输入。focusin 事件聚焦上报可靠，
      // 用它记录目标元素；用 activeElement 复合判断兜底。
      var _textFocused = null;
      // v3.26.x #208：最近一次文本失焦时刻（focusin 归零）——键盘收起视口未还原自愈的计时基准
      var _focLostAt = 0;
      // v3.12.x：悬浮键盘保底停靠状态（见下方 _iProvCheck 注释）
      var _iFocusAt = 0, _iProv = false, _iIH = window.innerHeight;
      // v3.6.x：键盘弹出期间把页面滚动钉在顶部——iOS Safari 键盘弹出时会自动把页面
      // 滚动到聚焦的输入框（聊天输入栏在 .phone 底部），而 .phone 已按 visualViewport
      // 收缩到键盘上沿，此时 window 再滚动会把 .phone 整体上移，其下方露出 body 灰色
      // 背景——表现就是「键盘上方出现一条横贯全屏的灰色栏，把所有页面都遮盖」。
      // 收缩状态下任何滚动都只会露出灰底（页面内容已全部在 .phone 内），直接归零。
      function pinScrollTop() {
        try {
          if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
          }
          // v3.13.x：iOS Edge 视口平移归零——Edge iOS 聚焦 contenteditable 后通过
          // visualViewport offset 平移让焦点可见（window.scrollY 恒为 0、
          // documentElement.overflow:hidden 也挡不住该平移），.phone 整体被推上移 →
          // 输入栏贴屏幕顶部、其下到键盘全露 body 灰底（用户报修「整页被挤压」）。
          // 归零 vv 偏移才能根治。仅在 offset>1 时调用（无偏移 no-op），try 容错
          // 不支持 scrollTo 的旧内核。pinScrollTop 只在键盘开合动画窗口/大偏移自愈
          // 时被调，稳态打字期不触发，不会与 caret 微滚打架闪屏。
          if (_vv && _vv.scrollTo && (_vv.offsetTop > 1 || _vv.offsetLeft > 1)) {
            try { _vv.scrollTo(0, 0); } catch (e2) {}
          }
        } catch (e) {}
      }
      // FIX 2026-09-07 #255：iOS 键盘期弹窗顶对齐——键盘开合动画与输入法候选条显隐让
      // .phone 高度变化，弹窗在 mask 里 flex 居中每次重新取中 = 输入框跟着「往上滑」
      //（iPhone16P/iOS26 Safari 批量导入弹窗打字上滑报障，居中容器通病其他机型同现）。
      // 键盘会话（_kbActive/推定停靠 _iProv）期间给 #modal-mask 挂 modal-kb-dock 顶对齐
      //（CSS 规则在 base.css，含安全区上边距），弹窗位置锚定顶部不再随高度变化移动；
      // 收键盘摘除复原，安卓/桌面不进此分支零影响。
      function syncModalKbDock() {
        try {
          var mk = document.getElementById('modal-mask');
          if (mk) mk.classList.toggle('modal-kb-dock', !!(_kbActive || _iProv));
        } catch (e) {}
      }
      // v3.13.x：键盘期「文档大偏移滚动」自愈（iOS Edge 报修修复）——
      // Edge iOS（同 WebKit 内核）聚焦输入框后，除了键盘弹出还会把【文档】滚一段
      // 距离让焦点可见；该原生滚动可能晚于 _pinUntil 钉顶窗口（>500ms）才发生，
      // 甚至打字期间反复发生。此时 .phone 已收缩停靠在键盘上沿，文档再被滚走
      // S px → 屏幕上只剩 .phone 的底部切片：输入栏贴屏幕顶部、其下到键盘之间
      // 全是 body 灰底，观感即用户报修的「整个聊天页被挤压/中间全是灰色」。
      // 稳态期刻意不 pin（防 Safari caret 微滚↔归零打架闪屏），所以补一条
      // 「大偏移才治」的自愈：文档滚动超过阈值才归零（caret 微滚一般 <60px，
      // 手机布局下 window 正常恒为 0，不会误伤）。
      var KB_SCROLL_HEAL = 80;
      function winScrollY() {
        try { return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0; } catch (e) { return 0; }
      }
      // v3.13.x：键盘期禁文档根滚动（iOS Edge 聚焦「滚一段让焦点可见」根治）。
      // 背景：上一版只靠 winScrollY() 判泥祖师，但真实 iOS Edge 的「滚动到焦点可见」
      // 走的是 visualViewport 平移、window.scrollY 恒为 0 → 自愈永不触发，挤压照旧。
      // 本应用页面内容逐屏、滚动都在 .phone 内层容器（.page/.chat-body 等）完成，
      // html/body 根本不需要滚动——键盘弹出时直接把根 overflow 锁死，iOS 无法再
      // 平移动画文档，输入栏自然停靠键盘上沿，灰底一条不可能再露出来。
      // 用内联 style 而非 body.scroll-lock（那套由 applyLock 看门狗每 1s 对账、会把
      // 无浮层时的手动锁摘掉），且只在 isIOS 分支生效，桌面/安卓不受影响。
      var _docLocked = false, _docPrevOverflow = '';
      function lockDocScroll() {
        try {
          if (_docLocked) return;
          _docLocked = true;
          _docPrevOverflow = document.documentElement.style.overflow;
          document.documentElement.style.overflow = 'hidden';
        } catch (e) {}
      }
      function unlockDocScroll() {
        try {
          _docLocked = false;
          // v3.26.x：按「实际内联值」对账，不再只看 _docLocked——本模块是 html{overflow}
          // 的唯一写者（已全库 grep 确认），键盘会话外残留的 hidden 一定是漏解锁，
          // 也就是用户报的「页面突然上移、什么都点不动」。旧实现 if(!_docLocked) return
          // 一旦标志与样式失步（异常路径），残留就永远清不掉。
          var d = document.documentElement;
          if (d.style.overflow) d.style.overflow = _docPrevOverflow;
        } catch (e) {}
      }
      function healKbScroll() {
        try {
          if (!_kbActive) return;
          // 主信号：文档滚动超阈值（caret 微滚一般 <60px，不误伤）。
          // 补充信号：不管 window.scrollY 读到多少，只要 .phone 被整体平移出位
          //（顶被推出屏幕 → 上方露灰；底越过可视区下沿挡键盘 → 输入栏跑到顶上）
          // 就归零。真实 iOS Edge 的 visualViewport 平移只体现在 getBoundingClientRect，
          // window.scrollY 不变（0）也能被此信号捕获。
          // v3.15.x：位移阈值修正（iOS Safari 打字全程闪跳修复）——原判定
          // pr.top<-2 || pr.bottom>可视高-24 在键盘开启、.phone 正常停靠（top≈0、
          // bottom==vv.height）时【恒真】：每次 250ms 轮询和每次 vv scroll 都判
          // 「已位移」并 pinScrollTop 强行归零。而 iOS Safari 打字时会微移视口让
          // caret 可见（一般 <60px），刚移就被归零 → 系统再移 → 再归零，全程打架：
          // 表现即「打字时屏幕一直一闪一闪/一跳一跳」，回跳瞬间输入栏还会被带回
          // 键盘下方（用户报修：iOS Safari 打字闪烁 + 键盘遮挡输入栏无法使用）。
          // 这正是 v3.7.x 移除稳态钉顶修过的「每打一个字屏幕闪一下」打架闪屏，
          // v3.13.x 的自愈把它带了回来。收紧为只治「大位移出视口」（Edge 整页挤压
          // 是数百 px 级）：顶移出超 KB_SCROLL_HEAL、或底边越出可视下沿 24px 以上
          // 才算位移；caret 微移恢复 no-op，不再与系统滚动打架。
          var _vh = _vv ? _vv.height : window.innerHeight;
          var shifted = winScrollY() > KB_SCROLL_HEAL;
          if (!shifted) {
            var pr = _phone.getBoundingClientRect();
            if (pr.top < -KB_SCROLL_HEAL || pr.bottom > _vh + 24) shifted = true;
          }
          if (shifted) pinScrollTop();
        } catch (e) {}
      }
      // v3.15.x：「停靠结果」验收自愈（iPhone 主屏幕 standalone 键盘盖输入栏修复的
      // 兜底层）——以上机制全部基于「收缩 .phone 就能把输入栏顶到可视区内」这一假设，
      // 真机上任何一环出偏差（样式表 min-height/height 钳制、内核不按预期收缩等），
      // 表现都是同一个：聚焦的输入栏仍停在可视区下沿之下被键盘盖住。这里不再猜原因、
      // 直接验收结果：键盘开启且聚焦期间，若聚焦元素的 getBoundingClientRect().bottom
      // 仍在 vv.height 之下（= 被键盘遮挡），按超出量对 .phone 追加收缩（下限 45%
      // 基准防压瘪；收缩同时压掉内联 min-height）。由 250ms 轮询调用；输入框已在
      // 可视区时零写入 no-op，稳态打字无开销。
      function _ensureInputDocked() {
        try {
          if (!_kbActive || !_vv || !_phone) return;
          if (Date.now() < _pinUntil) return; // 开合动画窗口内不干预，交给 syncIosKb
          var tgt = (isTextEl(_textFocused) ? _textFocused : null) ||
            (isTextEl(document.activeElement) ? document.activeElement : null);
          if (!tgt || !tgt.getBoundingClientRect) return;
          var r = tgt.getBoundingClientRect();
          var vh = _vv.height;
          // +2px 容差：正常停靠时输入栏底边恰好贴可视下沿（bottom==vh）属达标，
          // 不收紧、零写入——防止与 syncIosKb 的稳态收缩互相改写高度造成打字重排
          if (r.bottom <= vh + 2) return; // 已停在键盘上方，达标
          var pr = _phone.getBoundingClientRect();
          var cut = Math.ceil(r.bottom - vh) + 12; // 超出量 + 12px 余量
          try { _phone.style.minHeight = '0'; } catch (e2) {}
          _setPhoneH(Math.round(pr.height - cut), 'ensure'); // 下限保护交给 _setPhoneH
        } catch (e) {}
      }
      // v3.6.x：恢复 .phone 到自然高度（键盘收起）。统一入口——避免多处重复；
      // 恢复后若键盘又弹出，syncIosKb 会重新收缩
      function restoreKb() {
        if (!_kbActive) return;
        _kbActive = false;
        _setPhoneH(null, 'restore');
        try { _phone.style.minHeight = ''; } catch (e) {} // v3.15.x：还原键盘期压掉的 min-height
        _phone.style.alignSelf = '';
        kbUndockPanels();
        syncModalKbDock(); // #255：摘除键盘期顶对齐类，弹窗回居中
        unlockDocScroll();
        pinScrollTop();
        stopKbWatch();
        _syncFullBase(); // v3.26.x：此刻没有键盘，当前视口即新的无键盘基线
        syncSafeBottom();
      }
      function syncIosKb() {
        if (!_vv || !_phone) return;
        // activeElement + focusin 记录的 _textFocused 复合判断——iOS contenteditable
        // 聚焦时 activeElement 常是 <body>，只看它会把键盘误判为「未聚焦」→ 不收缩
        var _focused = isTextEl(_textFocused) || isTextEl(document.activeElement);
        var _h = _vv.height;
        var _ih = window.innerHeight || _h;
        // v3.26.x：基线吸收窗口——没有聚焦输入框、也没在停靠（含推定停靠）时，
        // 当前视口就是「无键盘真实高度」，双向写回基线（可涨可落）。旧实现只允许
        // 向上更新，Edge 工具条显隐留下的大基线永不回落 → 无键盘也误判键盘开启。
        if (!_focused && !_kbActive && !_iProv) { _fullInner = _ih; _fullVv = Math.round(_h); }
        // v3.26.x：键盘是否开启——两条独立实测信号任一成立即算开启：
        //   · 视觉视口相对「无键盘基线」收缩（overlay 模型：布局视口不动）
        //   · 布局视口自身收缩（resizes-content 模型：本文件给 iOS 改的 viewport meta
        //     被新版 WebKit 采信时走这条，此时 vv.height 与 innerHeight 一起缩）
        // 都不成立 = 没有键盘。旧实现用加载时快照、且只涨不落的 _noKbH 做唯一基准，
        // 基线被工具条瞬时高度抬大后「无键盘」也会误判成键盘开启（详见文件头注释）。
        var _kbNow = _h < _fullVv - 60 || _ih < _fullInner - 60;
        // 高度直接取 vv.height：两种模型下它都等于真实可视高，写同一个值不会双重收缩。
        // 只做一道异常读数保护（键盘最多占屏 60%，再小按下限兜），不再乘旧基线比例。
        var _safeH = (_h >= _fullInner * 0.4) ? _h : Math.round(_fullInner * 0.55);
        // 键盘真的收了（不看焦点，防点击字卡/按钮误 restore 闪屏）→ 复原
        if (_kbActive && !_kbNow) { restoreKb(); return; }
        // 稳态早退：键盘已开 + 仍在输入框 + 已过开合动画窗口 → height 已设对，
        //   不做开合判定/pin。打字时 vv resize 偶发触发，早退防任何 reflow 闪屏
        if (_kbActive && _focused && Date.now() > _pinUntil) {
          _setPhoneH(_safeH, 'steady');
          return;
        }
        if (_focused && _kbNow && !_kbActive) {
          _kbActive = true;
          lockDocScroll(); // 禁文档根滚动：iOS 无法再把页面滚走露灰底（Edge 关键）
          // v3.15.x：清内联 min-height——任何样式表来源的 min-height（如 iOS PWA
          // standalone 的全屏规则）都会把下面的内联 height 钳在更高值，.phone 永不
          // 收缩 → 键盘盖住输入栏。键盘期压到 0，restoreKb 时还原
          try { _phone.style.minHeight = '0'; } catch (e5) {}
          // 顶对齐（替代 position:fixed）——避免 iOS contenteditable 在 fixed
          // 容器内无法输入的已知问题；水平居中交给 body flex 原有规则
          _phone.style.alignSelf = 'flex-start';
          kbDockPanels(); // 底部半框停靠可视区底部=输入栏上方（防面板被挤出视口）
          syncModalKbDock(); // #255：弹窗切顶对齐（防键盘期居中重取中=输入框上滑）
          // 键盘弹出瞬间浏览器可能已滚动页面，立即归零，防止灰底露出
          pinScrollTop();
          syncSafeBottom(); // #556：键盘开启即归零（收起 restoreKb 摘除回落 env）
          // v3.7.x：键盘弹出动画期（约 500ms）内持续钉顶防灰底露出；
          //   之后稳态打字不再 pinScrollTop——iOS Safari 在 contenteditable 里
          //   打字时系统会微滚布局视口让 caret 可见，每次强制归零会与系统滚动
          //   打架，表现就是「每打一个字屏幕闪一下」（iPhone 14 Safari 复现）
          _pinUntil = Date.now() + 500;
          startKbWatch();
        }
        if (_kbActive) {
          _setPhoneH(_safeH, 'open');
          // 仅在键盘开合动画窗口内钉顶；稳态打字期不 pin，避免 caret 微滚↔归零闪屏
          if (Date.now() < _pinUntil) pinScrollTop();
        }
      }
      // v3.6.x：键盘状态自愈——iOS Safari 键盘收起时**偶发不派发 visualViewport
      // resize**（程序化 blur / 键盘下滑收起 / 完成键收起等路径，聊天发送时
      // input.textContent='' 清空聚焦的 contenteditable 最易触发）。此时 .phone
      // 会卡在收缩高度：页面下方露出 body 灰色背景、页面位置与比例错乱，只有
      // 下一次完整键盘开合（如改昵称弹窗）才复位。
      // v3.10.x：升级为「聚焦期间主动轮询」——不再只做"恢复"。iOS 键盘弹出时
      // visualViewport resize 存在漏触发（尤其 contenteditable / 全屏聊天页），
      // focusin 的 250/450ms 一次性补偿也可能与键盘动画错开 → .phone 不收缩 →
      // 输入栏被键盘彻底盖住（用户反复反馈的"输入法挡住输入栏"）。改成：只要
      // 聚焦了文本输入框（或键盘仍开着），每 250ms 复审一次，调用 syncIosKb
      // 让它按可视高度主动收缩；未聚焦且键盘已收则停表。syncIosKb 稳态期
      // 高度值不变不写 DOM（字符串比对早退），打字时不重排、无闪屏。
      var _kbWatch = null;
      function startKbWatch() {
        if (_kbWatch) return;
        _kbWatch = setInterval(function () {
          try {
            var _foc = isTextEl(_textFocused) || isTextEl(document.activeElement);
            if (_foc) {
              // 聚焦中：主动按可视高度收缩 .phone（防 iOS vv resize 漏触发盖住输入栏）
              syncIosKb();
              // 收缩后内层滚动容器里的输入框（问问ta 问题栏等）高度随之变化，
              // 补一次可见性对齐，确保它停在键盘上方
              nudgeInputVisible();
              syncModalKbDock(); // #255：键盘已在而弹窗后开（如聊天键盘开着又点开弹窗）时补挂顶对齐类
              // v3.13.x：Edge iOS 延迟文档滚动自愈——vv scroll 事件漏触发时
              // 由 250ms 轮询兜底把超阈值滚动归零
              healKbScroll();
              // v3.12.x：悬浮键盘推定停靠复查（vv 不反映键盘的内核走这里兜底）
              _iProvCheck();
              // v3.15.x：停靠结果验收自愈（输入栏仍被键盘盖住时按超出量追加收缩）
              _ensureInputDocked();
            } else if (_kbActive) {
              // 失焦但键盘仍开着（含收起动画窗口 / vv resize 漏触发的收起）：
              // 只做「键盘真的收了吗」复原，不调 syncIosKb——它会在键盘收起动画
              // 期间每 250ms 反复写 .phone 高度（跟随 vv 爬升）+ 重排，
              // 每个键盘收起都闪屏（用户反馈），改回一次性复原判断
              if (_vv && _vv.height >= _fullVv - 60) restoreKb();
            } else {
              // v3.12.x：停表前做一次兜底清理（保底停靠残留时复原 .phone）
              _iProvCheck();
              stopKbWatch();
            }
          } catch (e) {}
        }, 250);
      }
      function stopKbWatch() {
        if (_kbWatch) { clearInterval(_kbWatch); _kbWatch = null; }
      }
      // ===== v3.12.x：二线兜底「悬浮键盘推定停靠」（iOS 分支） =====
      // 旧版 iOS Safari / 国产 iOS 内核浏览器键盘纯悬浮且 visualViewport.height
      // 不更新时，syncIosKb 判 _kbStill=false 永不收缩 → 输入栏被完全盖住。
      // 这类内核没有任何可读信号，只能在全部保守条件命中时【推定】键盘已弹出：
      //   · 用户手势聚焦文本框（touchstart 后 1.5s 内的 focusin 才武装——程序化
      //     自动聚焦不弹软键盘，不能算数）
      //   · 聚焦已持续 >900ms（正常内核几百 ms 内 vv 必收缩走原路径，绝不进这里）
      //   · 期间 visualViewport.height 与 window.innerHeight 都纹丝不动（≤2px）
      //   · 近 30s 无硬件键盘真实按键（kbHardKeyUntil）
      // 命中后按无键盘基准的 58% 保底收缩（主流输入法连工具栏约占屏 35%~45%，
      // 58% 可视区必在其上方）；失焦 / 出现真实 resize 即由原机制接管恢复。
      function _iProvDock() {
        var base = Math.min(_fullInner, _iIH);
        // v3.13.x：矮视口保护——原 Math.max(240, base*0.58) 在 base<414 时绝对值
        // 240 会占掉近六成以上屏高加重挤压；改纯比例 + 基准 62% 封顶（最多压四成）
        var ph = Math.min(Math.max(Math.round(base * 0.58), 240), Math.round(base * 0.62));
        _iProv = true;
        lockDocScroll();
        try { _phone.style.minHeight = '0'; } catch (e) {} // v3.15.x：同 syncIosKb，防 min-height 钳制
        _phone.style.alignSelf = 'flex-start';
        _setPhoneH(ph, 'prov'); // v3.26.x：改走唯一写入口
        kbDockPanels();
        syncModalKbDock(); // #255：同 syncIosKb，弹窗切顶对齐
        pinScrollTop();
        syncSafeBottom(); // #556：推定停靠同属键盘在场，归零同上
      }
      function _iProvClear() {
        if (!_iProv) return;
        _iProv = false;
        if (_kbActive) return; // 正常机制已接管 .phone 高度，交回原逻辑管理
        unlockDocScroll();
        _setPhoneH(null, 'prov-clear'); // v3.26.x：还原样式表高度
        try { _phone.style.minHeight = ''; } catch (e) {} // v3.15.x：还原
        _phone.style.alignSelf = '';
        kbUndockPanels();
        syncModalKbDock(); // #255：摘除顶对齐
        pinScrollTop();
        _syncFullBase(); // v3.26.x：复原时刻即无键盘真实视口
        syncSafeBottom();
      }
      function _iProvCheck() {
        try {
          if (!_vv || !_phone) return;
          var tgt = (isTextEl(_textFocused) ? _textFocused : null) ||
            (isTextEl(document.activeElement) ? document.activeElement : null);
          var ih = window.innerHeight;
          if (!tgt) {
            // 无键盘态基线跟随（地址栏显隐等整体变化不误判；键盘开着时不更新）
            if (!_kbActive && !_iProv) _iIH = ih;
            if (_iProv && _vv.height >= _fullVv - 60) _iProvClear();
            return;
          }
          // FIX 2026-09-13 #387：与安卓分支同闸——「实测被盖」才允许保底停靠。
          // 读数判据只证「视口没动」不证「键盘在场」：无软键盘环境（电脑浏览器
          // /移动模拟/外接键盘）视口永远不动，点输入栏即盲推停靠＝UI 乱+闪屏。
          // 键盘在场必然盖住底部输入栏（元素可见则无需停靠），零机型回归。
          var _iCovered = false;
          try {
            var _rI = tgt.getBoundingClientRect ? tgt.getBoundingClientRect() : null;
            _iCovered = !!(_rI && _rI.height > 0 && _rI.bottom > ((_vv.offsetTop || 0) + _vv.height) + 12);
          } catch (eCovI) {}
          if (!_kbActive && !_iProv &&
              Date.now() - _iFocusAt > 900 &&
              Date.now() - kbLastTouchAt < 1500 &&
              kbTouchArmed(tgt) &&
              Date.now() > kbHardKeyUntil &&
              Math.abs(_vv.height - _fullVv) <= 2 &&
              Math.abs(ih - _iIH) <= 2 &&
              _iCovered) {
            _iProvDock();
          }
        } catch (e) {}
      }
      // ===== v3.26.x：可视区实测变量（iOS 专属）=====
      // --mochi-ios-h：.phone 静止态高度直接取实测 visualViewport.height。
      //   样式表的 100dvh 在个别 iOS 版本/第三方浏览器下并不等于真实可视高，
      //   差出来的那一条正落在聊天输入栏下面（用户报修「下面空着一大块」，
      //   且那段空白没有可点内容）。键盘期仍由内联 height 覆盖（内联赢选择器）。
      // --mochi-safe-bottom：底部被浏览器工具条占据时归零。见下方 CSS 侧
      //   var(--mochi-safe-bottom, env(safe-area-inset-bottom, 0px)) 的 27 处替换。
      var _vvFitOn = false;
      var _envTopCache = -1; // #148：env(safe-area-inset-top) 探针缓存（-1=未测）；旋转/#277 矛盾自愈时失效
      var _envTopCacheAt = 0; // #277：缓存写入时刻（矛盾重探 5s 节流，防 1s 自愈循环频繁建探针 DOM）
      var _zoomFixCnt = 0, _zoomFixAt = 0; // #174：缩放异常自愈计数（每会话 ≤3 次，间隔 4s）
      function syncVvFit() {
        try {
          var d = document.documentElement;
          // ===== v3.26.x #148：iOS standalone 顶部安全区改用 env() 实测探针 =====
          // 原差值法（screen.height - 可视高）在 iOS 26.x「系统不把网页垫到状态栏
          // 下方」的形态上失真：该形态系统已把网页起点放在状态栏下方（innerHeight
          // = screen - 状态栏高），差值却还是量出状态栏高度并写进 --mochi-safe-top
          // → .phone padding-top 与系统避让双重叠加，Mochi 行上方 ~76px 空白、
          // 整页下坠（iPhone 16 Pro + Safari 26.1 主屏幕全屏实测）。
          // env(safe-area-inset-top) 语义恰好区分两种形态：「内容已避让」时返回 0
          // （系统已处理，页面不再加），「内容覆盖到状态栏下」时返回真实高度。
          // 探针结果按横竖屏缓存（env 只随旋转变化），避免每次 vv 事件都建 DOM。
          var _ih2 = window.innerHeight || 0;
          var _sh2 = (window.screen && window.screen.height) || 0;
          var _vh2 = _vv ? Math.round(_vv.height * ((_vv.scale && _vv.scale > 0.5) ? _vv.scale : 1)) : _ih2;
          // v3.26.x #209：形态判定收敛到共享判定器 window.mochiViewportForm（device.js
          // 定义，与 screenDiagJudge 单一事实源；此前执行器/诊断各抄一份判式已现漂移
          // ——#186 的 force 分支两处就不同步）。此处只负责：读信号 → env 探针（按
          // 横竖屏缓存，#148）→ 按判定输出写 --mochi-safe-top / mochi-cover-top / 高度。
          // #199 判据：无浏览器 chrome（screen−inner≤2）才可能是沉浸式覆盖形态；
          // 带地址栏的常规浏览器 screen>inner，系统已垫页面，探针不跑、行为不变。
          var _sig0 = {
            standalone: d.classList.contains('ios-pwa-standalone'),
            envTop: _envTopCache >= 0 ? _envTopCache : 0,
            innerH: _ih2, screenH: _sh2, iosMajor: 0, safeTopForce: false
          };
          try {
            var _osM = /OS (\d+)_/.exec(navigator.userAgent || '');
            var _vM = /Version\/(\d+)\./.exec(navigator.userAgent || '');
            _sig0.iosMajor = Math.max(_osM ? +_osM[1] : 0, _vM ? +_vM[1] : 0);
            _sig0.safMajor = _vM ? +_vM[1] : 0; // #235：Safari 主版本（26.x 起覆盖形态，保留判定加门）
          } catch (e9) {}
          try { _sig0.safeTopForce = localStorage.getItem('xy-home-v2:__safe-top-force') === '1'; } catch (eF0) {}
          // FIX 2026-09-10 #277：env 缓存矛盾自愈——缓存此前只在旋转时失效，但独立应用
          // 切后台/回前台 WebKit 会改写顶部安全区形态：冷启动早帧探针探到 0（standalone
          // 覆盖布局尚未稳定）后被永久缓存，稳定后实为覆盖形态 env=62（iPhone17 +
          // WebKit26.6 standalone 实证，错误环 9/8~9/10 反复采集同一签名「--mochi-ios-h、
          // 底部导航栏悬空、底部少填｜env=62 var=0 diff=62 inner=894 phone底=894」）。
          // stale envTop=0 令 expBase 少算 env 段 → --mochi-ios-h 卡 894、.phone 底部
          // 62px 白带/tabbar 悬空；且 1s 常驻自愈每次按同值「确认」坏态，永不自愈。
          // 判据零机型分支：「布局视口顶部确实缺了一段（screen−inner≥20）而缓存却说
          // 没有顶部 inset（=0），或缓存值与缺口对不上（差>8）」＝矛盾信号，节流 5s
          // 重探一次。真「已避让」形态（env 实为 0）探回同值、缓存不变＝零行为变化；
          // 旋转失效路径（orientationchange 监听）不变。
          try {
            var _diff0 = _sh2 - _ih2;
            if (_sig0.standalone && _diff0 >= 20 && _envTopCache >= 0
                && (_envTopCache === 0 || Math.abs(_envTopCache - _diff0) > 8)
                && Date.now() - _envTopCacheAt > 5000) {
              _envTopCache = -1; _envTopCacheAt = Date.now();
            }
          } catch (eE5) {}
          var _f0 = window.mochiViewportForm(_sig0);
          if (_f0.needEnvProbe && _envTopCache < 0 && _sh2 > 0 && _vh2 > 0) {
            try {
              var _probe = document.createElement('div');
              _probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
              document.body.appendChild(_probe);
              _envTopCache = parseFloat(getComputedStyle(_probe).paddingTop) || 0;
              document.body.removeChild(_probe);
            } catch (e4) { _envTopCache = 0; }
            _envTopCacheAt = Date.now(); // #277：探回值连同时刻一起入账（重探节流基准）
            _sig0.envTop = _envTopCache;
          }
          var _f = window.mochiViewportForm(_sig0);
          var _safeTop = _f.safeTop;
          // _f.resStand（#200 iOS≥18 系统保留形态）→ _safeTop=0 且下面显式写 '0px'
          //（摘除属性会回落 env() 反而双重避让）；_f.forceCover（#185/#186 用户声明
          // 覆盖形态）→ safeTop=env 优先、env=0 用 diff 兜底。判式细节见判定器。
          var _resStand = _f.resStand;
          var _topPx = _safeTop ? _safeTop + 'px' : (_resStand ? '0px' : '');
          if (d.style.getPropertyValue('--mochi-safe-top') !== _topPx) {
            if (_topPx) d.style.setProperty('--mochi-safe-top', _topPx);
            else d.style.removeProperty('--mochi-safe-top');
          }
          // v3.26.x #199：浏览器覆盖形态同步挂/摘 mochi-cover-top 类——base.css 里
          // .statusbar{padding:4px 4px 12px}（同特异性后加载）常年压死窄屏 @media
          // 的 env() 避让规则（#114 根因），CSS 侧无法用「var 已设」表达条件，由 JS
          // 挂类提特异性只在该形态抬状态栏。iOS standalone 不挂（其避让由
          // .phone padding-top / ios-fs-active 既有链承担，挂了会双倍避让）。
          // 注意高度侧刻意不扩 #179 的 envTop+inner 公式：浏览器形态布局视口=inner，
          // .phone 超出可视区会造出 35px 文档滚动量，键盘/消息变更时被看门狗
          // pinScrollTop 拽动=「屏幕往上移」；正确做法是 .phone 仍贴 inner、内容
          // 在状态栏下方收缩避让。
          var _wantCover = !!_safeTop && !d.classList.contains('ios-pwa-standalone');
          if (_wantCover !== d.classList.contains('mochi-cover-top')) {
            d.classList.toggle('mochi-cover-top', _wantCover);
          }
          // v3.26.x #537：iOS 独立应用覆盖形态（判定器 iosCover，单一事实源；与上面浏览器
          // 形态互斥）同款挂类——该形态 .phone 铺满整块物理屏、模拟状态栏须自身抬升到系统
          // 状态栏下方（base.css html.ios-cover-top 规则消费；此前普通态无人避让，Mochi 行
          // 常驻钻系统状态栏=诊断 ✗顶部重叠）。保留/已避让/iPad 形态判定器一律不给
          // iosCover → 不挂类、零变化。全屏态恒不挂——那形态已有 .phone padding-top +
          // .statusbar{padding-top:14px} 整条避让链，再叠一次=双倍白带。
          var _fsState = function () {
            try {
              return d.classList.contains('fs-active') || d.classList.contains('fs-css-active')
                || d.classList.contains('ios-fs-active') || d.classList.contains('ios-native-fs');
            } catch (e) { return false; }
          };
          var _wantIosCover = !!_f.iosCover && !_fsState();
          if (_wantIosCover !== d.classList.contains('ios-cover-top')) {
            d.classList.toggle('ios-cover-top', _wantIosCover);
          }
          // v3.26.x #148：全屏态（原生 fs-active / CSS 兜底 fs-css-active / iOS 兜底
          // ios-fs-active / iOS 原生 ios-native-fs）改为「健康态写 --mochi-ios-h」——
          // 原实现摘除属性回落 100vh，但 iOS 26.x 独立应用 100vh = 整块物理屏
          // （874），可视高只有 812 → .phone 底部 tabbar 被裁出屏幕外（同一台设备
          // 实测 .phone高=874 底部空隙=-62）。--mochi-ios-h = visualViewport 实测
          // 可视高（812），两种形态都贴合；键盘/推定态仍摘除（上方分支），全屏过渡
          // 期短暂波动由常驻自愈 rAF 连续校正。真机状态以诊断「.phone高/底部空隙」复核。
          if (_fsState()) {
            // v3.26.x #179/#209：高度=判定器期望底边 expBase——覆盖形态（内容垫到状态
            // 栏下，env=59）=envTop+inner=整块物理屏 852，单用 vv(793) 会在底部留出
            // 60px 白带；已避让（env=0，16 Pro 26.1）=inner 812；保留/iPad/force 各按
            // 判定器例外。min 屏高防异常超界（含在 expBase 内）。
            var _nPxFs = (_vh2 >= 300) ? Math.round(_f.expBase) : 0;
            var _curFs = parseFloat(d.style.getPropertyValue('--mochi-ios-h'));
            if (_nPxFs >= 300) {
              // FIX 2026-09-05 #189：写入加 ≥6px 迟滞（同 _setPhoneH 政策）——全屏过渡/
              // fs-css-active 下浏览器工具条显隐期间 vv/innerHeight 逐帧抖动，原实现
              // 每次都 setProperty=整页重排连发，滚动观感即「全屏下滑动一直闪烁」；
              // ±6px 内抖动不写 DOM。0px/异常小值不落盘（原实现 innerHeight=0 会写 0px）。
              if (isNaN(_curFs) || Math.abs(_nPxFs - _curFs) >= 6) d.style.setProperty('--mochi-ios-h', _nPxFs + 'px');
            } else if (d.style.getPropertyValue('--mochi-ios-h')) {
              d.style.removeProperty('--mochi-ios-h');
            }
            return;
          }
          // 键盘会话期间不写（摘除属性）：那段时间 .phone 高度由 _setPhoneH 内联值
          // 负责，两套写高度会互相改写
          if (_kbActive || _iProv || _kbNowLike()) {
            if (d.style.getPropertyValue('--mochi-ios-h')) d.style.removeProperty('--mochi-ios-h');
            return;
          }
          var ih = window.innerHeight || 0;
          var vh = _vv ? Math.round(_vv.height * ((_vv.scale && _vv.scale > 0.5) ? _vv.scale : 1)) : ih;
          // v3.26.x #179：非全屏 standalone 同样用 envTop+inner（覆盖形态可视=整屏，
          // 单用 vv 会在底部留出状态栏高度的空白；已避让形态 env=0 数值不变）
          if (d.classList.contains('ios-pwa-standalone') && _safeTop > 0 && _ih2 > 0) {
            vh = _f.expBase; // #209：判定器期望底边（=safeTop+inner min 屏高，#179 语义）
          }
          if (!vh) return;
          if (!_vvFitOn) { _vvFitOn = true; d.classList.add('ios-vv-fit'); }
          // FIX 2026-09-05 #189：写入加 ≥6px 迟滞——iPad/iPhone 滚动期 vv.height 有
          // ±1~3px 逐帧抖动（滚动指示条/弹性回弹），原实现每次变化都 setProperty
          // =整页 reflow 连发，观感即「滑动时一直闪烁」。真实施显隐/键盘开合都是
          // 数十~数百 px 级变化，迟滞不影响跟随。
          var _curN = parseFloat(d.style.getPropertyValue('--mochi-ios-h'));
          if (isNaN(_curN) || Math.abs(vh - _curN) >= 6) d.style.setProperty('--mochi-ios-h', vh + 'px');
        } catch (e) {}
      }
      function syncSafeBottom() {
        try {
          var d = document.documentElement;
          var ih = window.innerHeight || 0;
          var sh = (window.screen && window.screen.height) || 0;
          // 屏幕高 - 布局视口高 > 60 → 浏览器自身 UI（顶部状态条 + 底部工具条）占了
          // 一段，底部那段空间根本不在可视区内，env() 再叠一次就是死带；
          // 铺满物理屏（standalone / 真全屏 / 桌面 F11）→ 摘除属性让 CSS 回落 env()
          // v3.26.x：值未变不写 DOM——1s 常驻自愈轮询期间避免每秒 setProperty
          //   同值触发无谓样式失效（与 syncVvFit 同款先比后写）
          // v3.27.x #129：iOS PWA standalone 下不归零——standalone 没有浏览器工具条，
          //   screen-innerHeight 是系统状态栏/Home 指示条（非工具条），且 viewport-fit=cover
          //   下 Home 指示条在可视区内，归零会让 tabbar/底部组件不避让被遮（iPhone 主屏幕
          //   打开报障"桌面组件显示不全"）。standalone 下摘除属性让 CSS 回落 env() 正确避让。
          var cur = d.style.getPropertyValue('--mochi-safe-bottom');
          // FIX 2026-09-16 #556：iOS 键盘期底部安全区归零（安卓同症状 #530 的 iOS 镜像）。
          // 现象（iPhone 16 Pro / iOS 18.7 主屏幕 standalone，用户明说多机型同现；设置里
          //   的全屏模式同样出现）：聊天输入栏与输入法之间露一块白/底色。
          // 根因：iOS 键盘是覆盖式，键盘在场时 env(safe-area-inset-bottom) 仍报 Home
          //   指示条高度（iPhone 16 Pro=34px），而聊天输入栏底内边距是
          //   calc(10px + var(--mochi-safe-bottom, env(safe-area-inset-bottom,0px)))——
          //   standalone 下本函数原设计摘除变量回落 env()（无键盘时正确避让 Home 指示条，
          //   #129），键盘期同样回落 = 输入栏被 34px 死带垫高，其与键盘之间露一段不受
          //   页面控制的空白（白带）。全屏模式不摘该带（viewport-fit=cover 下 Home 条
          //   仍在可视区），故两种形态都中招。
          // 修法（与安卓 #530 syncSafeBottomA 同款、零机型分支）：键盘在场（_kbActive /
          //   _iProv 推定停靠 / _kbNowLike 实测收缩，判据与 syncVvFit 摘 --mochi-ios-h
          //   完全一致）期间把变量钉 0px——键盘已盖住 Home 指示条，避让无对象；收起后
          //   走下方原有分支摘除变量回落 env()，避让行为原样恢复。env() 本就报 0 的设备
          //   /形态两值相等 = 零视觉变化，不引入跨机型回归。
          if (_kbActive || _iProv || _kbNowLike()) { // #556 键盘在场判据（与 syncVvFit 摘 --mochi-ios-h 同源）
            if (cur !== '0px') d.style.setProperty('--mochi-safe-bottom', '0px'); // #556 键盘期钉 0
            return;
          }
          if (sh && ih && sh - ih > 60 && !d.classList.contains('ios-pwa-standalone')) {
            if (cur !== '0px') d.style.setProperty('--mochi-safe-bottom', '0px');
          } else if (cur) {
            d.style.removeProperty('--mochi-safe-bottom');
          }
        } catch (e) {}
      }
      // 键盘是否仍有实测证据（供常驻自愈复用，判据与 syncIosKb 一致）
      function _kbNowLike() {
        try {
          if (!_vv) return false;
          return _vv.height < _fullVv - 60 || (window.innerHeight || 0) < _fullInner - 60;
        } catch (e) { return false; }
      }
      // ===== v3.26.x：常驻视口自愈（rAF 合并，不新增定时器）=====
      // 旧实现把自愈挂在 `_kbActive` 上（且只在 250ms 轮询的 if(_foc) 分支里跑）：
      // Edge iOS 在【失焦之后】才发生的视口平移无人处理；而键盘期写入的内联
      // html{overflow:hidden} 只要有一次异常没走到 unlock，用户连自己滚回来都做不到
      // ——就是报修的「页面突然上移，什么都点不动」。改为事件驱动 + 每帧一次读布局。
      var _healRaf = 0;
      function scheduleHeal() {
        if (_healRaf) return;
        _healRaf = requestAnimationFrame(function () {
          _healRaf = 0;
          healViewport();
        });
      }
      // FIX 2026-09-05 #189：全屏形态判定（原生/CSS 兜底/iOS standalone 隐藏状态栏/iOS 原生全屏）
      // ——稳态自愈在这四种类下放宽 .phone 底边容差并跳过 vv offset 归零（见 healViewport）。
      // iOS 全屏下 offsetTop≠0 多为弹性回弹手势、底边天然超出 vv 一个顶部安全区（#179 公式），
      // 二者按「位移残留」治疗都会与用户手势打架（=滑动闪烁）。
      function _fsLike() {
        var dd = document.documentElement;
        return dd.classList.contains('fs-active') || dd.classList.contains('fs-css-active')
          || dd.classList.contains('ios-fs-active') || dd.classList.contains('ios-native-fs');
      }
      function healViewport() {
        try {
          // FIX 2026-09-05 #189：补 documentElement 声明——v3.26.x 重写时漏写，下方
          // d.classList 裸引用解析到 window.d=undefined → TypeError 被 try 吞掉，
          // 自愈从「缩放自愈」这行起【每次调用都中断】：稳态残留清理/大平移归零/
          // #174 缩放自愈/基线刷新整层静默失效（只跑了最前面两个 sync）。
          var d = document.documentElement; // FIX 2026-09-05 #189
          syncVvFit();
          syncSafeBottom();
          // v3.26.x #174：独立应用缩放异常自愈——iOS 26.x 个别更新在主屏幕形态会把
          // 页面缩到 scale≈0.85（iPhone 15 Pro 实测 visualViewport 462×932@0.85，
          // 物理可见只剩 393×792，盖不满 852 高的屏幕 → 顶部状态栏区域露出白底、
          // UI 整体缩小），maximum-scale=1 也拦不住。苹果没有 API 直接设置缩放，
          // 重写 viewport meta（content 变化强制 Safari 重新解析并按 initial-scale
          // 吸附）是唯一恢复手段；meta 已含 minimum-scale=1（#174）锁定缩放下限，
          // 重写后缩放吸附回 1。每会话最多 3 次 + 间隔 4s 防循环。
          if (d.classList.contains('ios-pwa-standalone') && _vv && _vv.scale && _vv.scale < 0.95) {
            var _now = Date.now();
            if (_zoomFixCnt < 3 && _now - _zoomFixAt > 4000) {
              _zoomFixCnt++; _zoomFixAt = _now;
              document.querySelectorAll('meta[name="viewport"]').forEach(function (m) {
                m.setAttribute('content', 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content');
              });
            }
          }
          // v3.26.x #212：force 声明形态的自愈看门狗——用户开启【顶部避让修正】后
          // （覆盖声明），发消息的键盘开合周期里 WebKit 偶发把内联高度/滚动位置打回
          // 预声明前状态（.phone 回 793/文档被拽上移 59）→ 底部白带+页面上移，只能
          // 重退再进。此处稳态（无键盘无聚焦）下实测验收：.phone 底边应达屏底，
          // 短缺 >8px 直接重写判定器期望值（var 值 + 内联高度 + scrollTop 校正），
          // 1s 内自愈，不再依赖用户重进。
          try {
            if (d.classList.contains('ios-pwa-standalone') && _fsLike() && _phone && !_kbActive && !_kbNowLike()
                && window.mochiViewportForm && _sh2 > 0 && _ih2 > 0
                && localStorage.getItem('xy-home-v2:__safe-top-force') === '1') {
              var _sigW = { standalone: true, envTop: _envTopCache >= 0 ? _envTopCache : 0, innerH: _ih2, screenH: _sh2, iosMajor: 0, safeTopForce: true };
              try {
                var _osW = /OS (\d+)_/.exec(navigator.userAgent || '');
                var _vW = /Version\/(\d+)\./.exec(navigator.userAgent || '');
                _sigW.iosMajor = Math.max(_osW ? +_osW[1] : 0, _vW ? +_vW[1] : 0);
                _sigW.safMajor = _vW ? +_vW[1] : 0; // #235：Safari 主版本同门（force 路径虽不走 resStand，信号保持同源）
              } catch (eW1) {}
              var _fw = window.mochiViewportForm(_sigW);
              if (_fw.forceCover) {
                var _pb = _phone.getBoundingClientRect().bottom;
                var _short = Math.round(_sh2 - _pb);
                if (_short > 8) {
                  if (d.style.getPropertyValue('--mochi-safe-top') !== (_fw.safeTop + 'px')) d.style.setProperty('--mochi-safe-top', _fw.safeTop + 'px');
                  if (d.style.getPropertyValue('--mochi-ios-h') !== (_fw.expBase + 'px')) d.style.setProperty('--mochi-ios-h', _fw.expBase + 'px');
                  if (_phone.style.height) _phone.style.height = ''; // 清键盘期内联高度，回落 var 期望值
                  try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (eS2) {}
                }
              }
            }
          } catch (eW0) {}
          var foc = isTextEl(_textFocused) || isTextEl(document.activeElement);
          if (!foc && !_kbNowLike()) {
            // 键盘会话其实已经结束，却还残留收缩/顶对齐/文档锁/推定停靠 → 无条件复原
            if (_kbActive) restoreKb();
            else {
              // FIX 2026-09-05 #189：归零滚动改条件式——先记账这次到底清了哪些键盘期
              // 残留，只有真清了残留、或窗口仍处大偏移（Edge iOS 失焦平移）时才 pin。
              // 纯稳态下无条件 pin 会与用户滚动打架：#179 后全屏覆盖形态 .phone/html
              // 高 = envTop+inner，比布局视口高出一个顶部安全区（iPhone 覆盖 59px /
              // iPad 状态栏 24px），文档天然可滚该余量，用户每滑一次就被 1s 看门狗/
              // vv 事件拽回顶部——即报修的「全屏模式下滑动一直闪烁」。
              var _cleanedResidue = false;
              if (_iProv) { _iProvClear(); _cleanedResidue = true; } // 内部已 pin
              if (_docLocked) { unlockDocScroll(); _cleanedResidue = true; }
              else unlockDocScroll(); // v3.26.x 看门狗语义保留：残留 overflow:hidden 必清
              if (_phone && _phone.style.height) { _setPhoneH(null, 'heal'); _cleanedResidue = true; }
              if (_phone && _phone.style.alignSelf) { _phone.style.alignSelf = ''; _cleanedResidue = true; }
              if (_cleanedResidue || winScrollY() > KB_SCROLL_HEAL) pinScrollTop(); // FIX 2026-09-05 #189
            }
            // v3.26.x：无键盘稳态也刷新「无键盘基线」——1s 轮询/工具条显隐若始终
            // 收不到 vv 事件，_fullVv/_fullInner 会滞留旧值（键盘判定与 _safeH 都依赖
            // 它），下次键盘开合可能误判或收缩值偏斜。此时无焦点无键盘，当前视口
            // 就是真实无键盘高度，直接吸收（与 syncIosKb 的基线吸收同条件同语义；
            // restoreKb 内部已吸过一次，重复调用幂等无害）
            _syncFullBase();
          } else if (_kbActive) {
            // 键盘会话内：沿用原阈值逻辑（动画窗口钉顶 / 稳态只治大位移）
            if (Date.now() < _pinUntil) pinScrollTop();
            else healKbScroll();
            // v3.26.x #208：键盘收起后视口未还原的自愈兜底——iOS standalone 键盘
            // 收起时 WebKit 偶发不把可视/布局视口还原到基线（差 >60px），restoreKb
            // 的「确已还原」门槛 `_vv.height >= _fullVv - 60` 从此永不满足 →
            // _kbActive 卡真、.phone 卡在收缩高：聊天输入栏整体上移、下方露一条
            // body 底色白带（多机型反复报障）。失焦持续 >4s 且视口仍 < 基线−60
            // = 物理上不可能还有键盘在等输入（要打字必有焦点），判定收起事件
            // 丢失：强制复原（restoreKb 内部 _syncFullBase 重吸基线 + pinScrollTop
            // 触发重排；之后 1s 看门狗 syncVvFit 按实测重写 --mochi-ios-h）。
            // 「点按钮失焦但键盘还开着」的合法停靠场景 4s 内必有再聚焦或收起，
            // 不受影响；安卓分支（isIOS 互斥）不经过此路径。
            if (!foc && _focLostAt && Date.now() - _focLostAt > 4000 && _vv && _vv.height < _fullVv - 60) {
              restoreKb();
            }
          } else if (!foc) {
            // 键盘会话外的大平移（Edge iOS 失焦后补做的「让焦点可见」平移）→ 归零
            var shifted = winScrollY() > KB_SCROLL_HEAL;
            if (!shifted && _phone) {
              var pr = _phone.getBoundingClientRect();
              // FIX 2026-09-05 #189：底边容差计入已应用的 --mochi-safe-top——#179 后
              // 全屏覆盖形态 .phone 底边天然超出 vv.height 一个顶部安全区（59/24px），
              // 旧 +24 容差把健康态误判成位移，每次 vv 事件/每秒都 pin 归零=滑动闪烁
              var _stT = parseFloat(d.style.getPropertyValue('--mochi-safe-top')) || 0;
              shifted = pr.top < -KB_SCROLL_HEAL || pr.bottom > (_vv ? _vv.height : window.innerHeight) + _stT + 24;
            }
            // FIX 2026-09-05 #189：全屏态跳过 vv offset 判定——全屏下 offsetTop≠0 多为
            // iOS 弹性回弹手势（iPad 大屏一甩就超 80px），归零=把手势掐断与用户对打；
            // 真实平移残留仍有 winScrollY/底边两条兜底，非全屏（Edge iOS 病灶）不受影响
            // FIX 2026-09-15 #视口平移残留：非全屏稳态残差改用更严阈值——#189/#179 为放行
            // iPad 全屏弹性回弹把判定阈值收到 KB_SCROLL_HEAL(80)，导致非全屏 iPhone 浏览器
            // 键盘收起后遗留的约 42px 平移（诊断「✗ 视口平移残留」）过不了 80 门槛、pinScrollTop
            // 永不触发 → 输入栏错位、聊天内容被顶出、打字看不到内容、每次需手调。全屏已被
            // 上方 _fsLike() 排除，非全屏无 safe-top 溢出余量，>4px 残差即为病态，应收零。
            if (!shifted && !_fsLike() && _vv && (Math.abs(_vv.offsetTop) > 4 || Math.abs(_vv.offsetLeft) > 4)) shifted = true;
            if (shifted) pinScrollTop();
          }
        } catch (e) {}
      }
      function onIosVvEvent() { scheduleHeal(); }
      if (_vv) {
        _vv.addEventListener('resize', syncIosKb);
        // v3.26.x：scroll 不再直连 syncIosKb/healKbScroll，改进常驻 rAF 自愈入口
        //（原 onIosKbScroll 只在 _kbActive 时动作，失焦后的平移漏治）
        _vv.addEventListener('scroll', onIosVvEvent);
        _vv.addEventListener('resize', onIosVvEvent);
      }
      // v3.26.x：事件盲区兜底（iPhone 17 / Edge iOS 报修补强）——自愈原本只挂在
      //  vv 的 resize/scroll 上，但 Edge iOS 底部工具条随页面上下滚动收起/展开
      //  会改变真实可视高度，个别时机不派发 vv 事件（iOS 内核事件漏触发是惯性，
      //  本文件多处注释都在兜它）→ --mochi-ios-h 停在旧值：输入栏下方空一大块、
      //  工具条收起后页面高度不跟上；键盘期残留平移也无人归位。
      //  补 window 级触发 + 失焦态低频轮询，全部并进 scheduleHeal（rAF 合并、
      //  静止态命中「无需处理」分支即返回，每秒一次布局读可忽略）。
      //  后台标签不跑（visibilityState 守卫），回前台 pageshow/visibilitychange
      //  会立刻补一次，覆盖切后台回来视口已变的场景。
      window.addEventListener('resize', onIosVvEvent);
      window.addEventListener('orientationchange', onIosVvEvent);
      // v3.26.x #148：旋转后 env(safe-area-inset-top) 可能变化，失效探针缓存重测
      window.addEventListener('orientationchange', function () { try { _envTopCache = -1; } catch (e) {} });
      // v3.26.x #213：视口时间线环形缓冲（每秒 1 拍，保留 60 条≈1 分钟）——
      // 键盘开合/工具条伸缩/白带出现等瞬态过程回放用：屏幕适配诊断报告尾部
      // dump 时间线，「出问题前发生了什么」直接可读（键盘 +350 / 突发 -59 等）。
      var _vvLog = [];
      function vvLogPush() {
        try {
          if (document.visibilityState !== 'visible') return;
          var ih2 = window.innerHeight || 0;
          var prev = _vvLog.length ? _vvLog[_vvLog.length - 1].ih : ih2;
          _vvLog.push({ t: Date.now(), iw: window.innerWidth || 0, ih: ih2,
            vh: _vv ? Math.round(_vv.height) : 0, sc: _vv ? +(+_vv.scale).toFixed(2) : 1,
            kb: _kbActive ? 1 : 0, fs: _fsLike() ? 1 : 0 });
          if (_vvLog.length > 60) _vvLog.shift();
        } catch (e) {}
      }
      setInterval(vvLogPush, 1000);
      window.__mochiVvTimeline = function () {
        try {
          if (!_vvLog.length) return '（暂无记录）';
          return _vvLog.map(function (e, i) {
            const d = new Date(e.t);
            const hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
            const dl = i > 0 ? (e.ih - _vvLog[i - 1].ih) : 0;
            return hm + ' inner:' + e.iw + '×' + e.ih + ' vv:' + e.vh + ' sc:' + e.sc + ' kb:' + e.kb + ' fs:' + e.fs + (i > 0 && dl !== 0 ? ' Δ' + (dl > 0 ? '+' : '') + dl : '');
          }).join(' | ');
        } catch (e) { return '(时间线采集失败)'; }
      };
      window.addEventListener('pageshow', onIosVvEvent);
      document.addEventListener('visibilitychange', onIosVvEvent);
      // #969：原来是「每秒无条件重校视口」——healViewport 要读 .phone/visualViewport 几何并写样式，
      // 在 1.6 万节点页面上等于每秒一次强制布局＋样式失效，是 iOS 常驻卡顿的稳定来源之一。
      // 改为指纹闸：视口指纹（inner/可视高/缩放/平移）没变就跳过，省掉整条重校链；
      // 每第 10 拍仍无条件深查一次（防「指纹没变但内联样式被外部改坏」这类需要自愈的情况）。
      let _vvFp = '', _vvTick = 0;
      setInterval(function () {
        if (document.visibilityState !== 'visible') return;
        try {
          _vvTick++;
          const _v = window.visualViewport;
          const fp = [window.innerWidth, window.innerHeight, _v ? Math.round(_v.height) : 0,
            _v ? +(+_v.scale).toFixed(2) : 1, _v ? Math.round(_v.offsetTop || 0) : 0].join('|');
          if (fp === _vvFp && (_vvTick % 10) !== 0) return; // 未变且非深查拍 → 本秒不重校
          _vvFp = fp;
        } catch (e0) {}
        onIosVvEvent();
      }, 1000);
      try { syncVvFit(); syncSafeBottom(); } catch (e) {}
      // v3.26.x：只读现场探针（device.js window.mochiVvDiag() 合并进诊断文本）。
      // 「页面突然上移点不动」的元凶是内部状态残留（收缩 + 文档锁 + 基线），
      // 光看 DOM 判断不了，必须把这份状态随报障一起回收。
      window.__mochiIosKb = function () {
        return {
          kbActive: !!_kbActive,
          prov: !!_iProv,
          docLocked: !!_docLocked,
          fullInner: _fullInner,
          fullVv: _fullVv,
          pinLeft: Math.max(0, _pinUntil - Date.now()),
          focusTag: _textFocused ? String(_textFocused.tagName || '').toLowerCase() : ''
        };
      };
      document.addEventListener('focusin', function (e) {
        try { if (isTextEl(e.target)) { _textFocused = e.target; _iFocusAt = Date.now(); _focLostAt = 0; } } catch (e2) {}
        // v3.10.x：立即同步一次——键盘弹出动画期间 vv.height 开始明显收缩，
        // 尽早收缩 .phone，避免头 300ms 输入栏还在键盘下面（视觉"被盖住"）
        try { syncIosKb(); } catch (e3) {}
        setTimeout(syncIosKb, 250);
        setTimeout(syncIosKb, 450);
        // v3.12.x：悬浮键盘推定停靠复查——950ms（宽限期刚过）与 1700ms 各一次，
        // 即使轮询表因失焦竞态提前停掉，这里也能独立完成保底停靠/清理
        setTimeout(_iProvCheck, 950);
        setTimeout(_iProvCheck, 1700);
        // v3.10.x：聚焦文本输入框即启动主动轮询兜底——即使 vv resize 漏触发，
        // 250ms 内也会按可视高度收缩 .phone，输入栏不会被键盘盖住
        if (isTextEl(e.target)) { try { startKbWatch(); } catch (e4) {} }
      });
      document.addEventListener('focusout', function (e) {
        try { if (e.target === _textFocused) { _textFocused = null; _focLostAt = Date.now(); } } catch (e2) {}
        setTimeout(syncIosKb, 250);
        setTimeout(syncIosKb, 450);
        // v3.12.x：失焦后复查保底停靠——键盘已收/无聚焦即复原 .phone
        setTimeout(_iProvCheck, 250);
        setTimeout(_iProvCheck, 900);
        // 输入框失焦即键盘收起：不依赖 vv resize（iOS 程序化失焦/滑动收起常漏事件），
        // 400ms 后若可视高度已回升（键盘真的收了）才恢复——不靠焦点判断，
        //   防点击字卡/按钮时焦点短暂离开但键盘未收就误 restore→reflow 闪屏
        setTimeout(function () {
          if (_kbActive && _vv && _vv.height >= _fullVv - 60) restoreKb();
        }, 400);
        // v3.13.x：快速开合键盘时 Edge iOS 的焦点滚动可能残留（_kbActive 从未
        // 置位、无人归零）——失焦稳定后复查一次。
        // v3.26.x：改走常驻自愈入口，除归零滚动外还会清掉残留的内联 height /
        // html{overflow:hidden} / 推定停靠（旧版只治滚动，锁定残留时用户点不动）
        setTimeout(healViewport, 650);
      });
    } catch (e) {}
  }

  // ================= 安卓专用：键盘（IME）适配（v3.10.x） =================
  // 背景：安卓 Chrome/Edge 收键盘时「整屏白一下」——根因是 viewport 用了
  // interactive-widget=resizes-content：收键盘时布局视口被系统撑回全高，.phone
  // 的 100dvh 跟着整屏重算重绘，露底色的那帧就是白闪（红米 K80 复现，每次都这样）。
  // 修法：改走 interactive-widget=resizes-visual（W3C 默认值）——键盘只收缩
  // visualViewport、不收缩 layout viewport（initial viewport），.phone 的 100dvh
  // 基于 layout viewport 不重算 → 无 dvh 重绘白闪；同时 visualViewport.height 随
  // 键盘收缩，syncAndroidKb 据此把 .phone 收到可视高度，输入栏停靠键盘上方。
  // ⚠️ 曾试 overlays-content：键盘不收缩任何 viewport → visualViewport.height 不变
  //    → syncAndroidKb 检测不到键盘 → .phone 永不收缩 → 输入栏被键盘完全盖住
  //    （红米 K80 Chrome 复现）。resizes-visual 是唯一兼顾「无白闪 + 可检测键盘」的值。
  // 约定：与 iOS 分支互斥（iOS Safari 忽略 interactive-widget，保持原机制）。
  if (!isIOS) {
    try {
      var _aPhone = document.querySelector('.phone');
      var _aVV = window.visualViewport;
      if (_aVV && _aPhone) {
        var _aH = _aVV.height; // 无键盘基准（跟随地址栏显隐更新）
        var _aKb = false;
        // FIX 2026-09-07 #236：键盘会话计时/vv 残留闩——HeyTapBrowser（OPPO K13 Turbo
        // Pro 实报「屏幕下方大片空白」）收键盘后 vv.height 恒停在 inner−底栏高不回基准，
        // open=h<_aH-60 恒真 → _aKb 卡真、.phone 内联高锁死残留值。_aKbAt=会话开启
        // 时刻、_aVvChgAt=vv 最近变化时刻（避开收起动画）、_aVvStale=残留读数闩。
        var _aKbAt = 0, _aVvChgAt = Date.now(), _aVvStale = false;
        // FIX 2026-09-17 #657：键盘收缩「读数静音闩」——几何反证判过键盘不在场后（见下方
        // touchstart 反证路），残留读数还会让 250ms 轮询每拍重新收缩（抽动）；本闩只在读数
        // 真的变化或回基准时解除（_aBump 的触摸/按键续期不解，否则同一次滑动就把闩解掉）。
        var _aKbMute = false;
        // v3.10.x：当前聚焦的文本元素（focusin 可靠上报，部分安卓浏览器
        // activeElement 在 contenteditable 上返回 <body>，单看它会漏判聚焦）
        var _aTextFocused = null;
        // v3.12.x：悬浮键盘保底停靠状态（见下方 _aProvCheck 注释）
        var _aFocusAt = 0, _aProv = false, _aIH = window.innerHeight;
        // #337：本会话 vv 是否出现过真实收缩——漂移/悬浮内核恒 false＝「vv 高」不构成键盘已收证据
        var _aVvShrunkSeen = false;
        // v3.13.x：推定停靠自愈的活动基线——浮悬键盘收回后输入框仍保持聚焦时，
        // focusout/vv.resize 都可能不来（摩托罗拉 G100 / 雨见 实测），58% 推顶
        // 会残留到用户下次交互才复位（表现为「输入框停留几秒才回底」）。用
        // 最近一次用户交互（触摸/按键/聚焦）时间戳，长时间无活动即视键盘已收。
        var _aLastAct = Date.now();
        // v3.14.x：上一次轮询的 vv.height——检测"vv 从小变大=键盘收回动画"。
        // 摩托罗拉G100/雨见 focusout/vv.resize 漏触发，但轮询读 vv.height 能读到
        // 回升，据此立即清除推顶，不用等 2200ms 无活动（用户感知"输入框停留几秒才回底"）
        var _aLastVVH = 0;
        // v3.29.x（#141）：上一帧 vv.height——syncAndroidKb 顶部「高度上升=正在收起」
        // 探测的基准（返回键/手势收键盘时焦点保留、focusout 不来，#89 的 _aClosing
        // 闸门挂不上，收起动画每帧仍跑强制布局读取致灰块几秒才收，见 syncAndroidKb）
        var _aPrevH = 0;
        // FIX 2026-09-10 #267：浏览器「平移/滚动露焦点」量的实测值。荣耀 X50 自带浏览器
        //（HonorBrowser/Chrome116，多机型同族）键盘弹出时把视觉视口【平移】让焦点露出，
        // 而 visualViewport.height 不缩（同一会话诊断现场 664 与 254 两种读数交替出现）→
        // 按收缩判定的主链路检测不到键盘 → 只剩 58% 盲猜保底停靠。该机 IME 实占约 62%
        //（664→254），停靠到 58%=385 后输入栏整行仍在键盘下方＝看不见、打不出；IME 偏小时
        // 58% 又多缩出一大片空白。浏览器只会平移到「焦点刚好露出键盘上沿」，这个量就是键盘
        // 高度的直接证据：记下最大值给 _aProvDock 当尺子，有实测按实测停靠、无实测才回退
        // 58% 猜（纯悬浮又不平移的 X5/旧夸克内核走原 58% 路径，零行为变化）。
        var _aPanSeen = 0, _aPanSeenAt = 0;
        // v3.16.x：focusin 后短时高频补偿宽限期——此期间 _aPinPan 即使 _aKb/_aProv 都
        // false 也执行，归零浏览器为露焦点提前平移的视口残留（红米 K80 Chrome 首次
        // 点击输入栏键盘弹出动画期间 vv.offsetTop 先起、vv.height 后缩，_aKb 未置位时
        // 平移已残留 → 输入栏错位+灰条）。850ms 后交回稳态条件。
        var _aBurstUntil = 0;
        // FIX 2026-09-12 #369：会话级「全屏布局基线」——VivoBrowser（iQOO Z9/V2361A
        // 实报「聊天聊到一半屏幕突然变成一半」「听歌闪几下加载中然后变成一半」，多机型
        // 同族）收键盘后 innerHeight 与 vv 一起停在键盘态不回基准（现场 800 物理屏
        // inner=vv=373），且 _aProvCheck 无聚焦分支会把 _aIH 重锚到残留值 → #236/#209
        // 各判据（均含 inner≥基线−12）全部失明，.phone 被污染的 100dvh 撑成半屏且无
        // 内联高可清＝四条复原路全断。_aFullIH 只涨不跌（换屏幕尺寸键=旋转时重置），
        // _aScrKey 记当前屏幕尺寸键，_aVpPin=布局残留钉高在位。
        var _aFullIH = Math.max(window.innerHeight || 0, Math.round(_aVV.height || 0));
        var _aScrKey = (screen.width || 0) + 'x' + (screen.height || 0);
        var _aVpPin = false;
        // FIX 2026-09-14 #479：深缩发生时的焦点语境——真键盘只能在文本聚焦期弹出
        //（focusin 先于 vv 收缩）。true=打字期深缩（键盘形，#369 残留自愈的证据位，
        // VivoBrowser 残留族原语义）；false=无聚焦深缩（窗口被改小：Edge/Chrome 自由
        // 小窗、分屏、桌面缩放窗口——基线全体重锚跟随、绝不进 #369 钉高）。
        var _aShrinkHadFoc = false;
        // #479：#369 钉高时刻——「钉高前提失败阀」用（钉后 10s 内核仍不回全屏高且
        // 用户在深缩态有新交互＝在用这个窗口尺寸，放弃钉高、基线重锚到现实）。
        var _aVpPinAt = 0;
        // FIX 2026-09-20 #916：稳态高度对账状态——_aFitPend=上一拍实测的期望底边（两拍
        // 同值才动手＝避开工具条显隐动画中途）；_aFitPin=对账内联钉高在位。
        var _aFitPend = null;
        var _aFitPin = false;
        // FIX 2026-09-05 #209：稳态停靠残留清扫（安卓侧唯一视口看门狗——iOS 侧
        // healViewport 在 isIOS 分支，安卓不经过；device.js 监视只读不修）。
        // 场景：安卓返回键/手势收键盘不派 blur（activeElement 保留），#197 族
        // focusout 丢失时 _aTextFocused 同样滞留 → 收键盘的复原路径（focusout 分支/
        // vv 收起分支/250ms 轮询表停摆后）都可能被跳过：.phone 留着键盘期内联收缩
        // 高度/顶对齐 → 聊天输入栏悬空、下方露一条 body 底色灰带（红米 K70+Edge
        // 实报「输入框和网站底部有断截面（灰边，不贴合）」，#141 同族多机型复发）。
        // 判据是纯视口证据、完全不看焦点（天然免疫 focusout 丢失）：
        //   · 不在键盘会话（_aKb/_aProv 均假——收起动画期 _aKb 仍真，h 回到基准
        //     ≤12px 才复位，故本判据天然避开动画中途）；
        //   · vv.height 与 innerHeight 都距无键盘基准 ≤12px（与 _a 机器「收起动画
        //     完成」同阈值）＝键盘肉眼已不在场；
        //   · 此时 .phone 内联 height/alignSelf 的唯一写入方就是键盘停靠链
        //    （全文件 grep 佐证），必为残留 → 清空 + _aPanComp/kbUndockPanels 复原。
        // 1s 节拍 + visibilityState 守卫（与 iOS 1s 看门狗同口径）。
        setInterval(function () {
          try {
            if (document.visibilityState !== 'visible') return;
            // FIX 2026-09-17 #657 之二：平移补偿「成孤儿」自愈——纯算术恒等式，零机型分支。
            // _aPanComp 的补偿量恒等于当时读到的残留平移（.phone 内联 top = vv.offsetTop）；
            // 读数已归零而 .phone 仍带内联 top ⇒ 补偿失去依据（浏览器自行清了平移却未派事件、
            // 或焦点滞留使各路复原都进不去）＝整壳被按旧偏移推下：顶部露 body 底色、下半截出屏，
            // 即用户所见「整页飞出去、只显示手机上半屏」。此处按恒等式清掉；读数非零时
            // _aPanComp 刚写的就是同值，判定不成立——健康设备零命中，键盘会话期不参与
            //（会话内由 _aPanComp/_aPinPan 逐拍维护，含收起动画期的零强制读契约）。
            if (!_aKb && !_aProv && !_aClosing && _aPhone.style.top
                && Math.abs(Math.round(_aVV.offsetTop || 0)) <= 4) _aPhone.style.removeProperty('top');
            try { syncSafeBottomA(); } catch (eSB1) {} // FIX 2026-09-15 #530：键盘期底部安全区归零，1s 对账（漏 vv 事件也能收口）
            // FIX 2026-09-10 #267：键盘态卡死自愈（焦点侧证据，与下面 #236/#209 的视口侧
            // 证据互补）。安卓软键盘必然依附一个聚焦的可编辑元素，而本模块的触摸/按键/
            // focusin 全都会续期 _aLastAct——「活焦点不在文本框 + 静默 >2.2s + vv 读数已稳
            // 1.2s（避开收起动画中途）」= 键盘必已不在场，此时 .phone 的任何内联收缩高
            // 都只能是停靠残留（用户报「点开输入框会出现一部分空白」）。
            // 覆盖 _aKb 与 _aProv 两个旗标：① focusout 漏派时 _aTextFocused 必然滞留、
            // 轮询继续跑，_aProvCheck 的 !tgt 清理进不去；② vv 读数停在收缩值（荣耀 X50
            // 现场 664↔254 交替）时主链路 `!open && _aKb && h>=_aH-12` 复原同样进不去，
            // 而 #209 清扫被 `if (_aKb || _aProv) return` 挡在门外——四条复原路全断。
            // 闸门只看 document.activeElement（活焦点），不看滞留的 _aTextFocused：拿它
            // 当闸门等于把修复挡在门外。真在打字时焦点在框内且 _aBump 持续续期，双保险。
            if ((_aKb || _aProv) && !_aIsText(document.activeElement) && Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200) {
              var _vvStillSaysKb = _aVV && _aVV.height > 0 && _aVV.height < _aH - 60;
              _aKb = false; _aClosing = false; _aProvClear();
              // 读数自身仍称有键盘＝壳残留读数：置 #236 闩抑制纯 vv 再触发，防 254↔664
              // 抖动把 .phone 来回抽；触摸/聚焦（_aBump）或 vv 回基准即解除。
              if (_vvStillSaysKb) _aVvStale = true;
              _aPhone.style.height = '';
              _aPhone.style.alignSelf = '';
              _aPanComp();
              kbUndockPanels();
              return;
            }
            // FIX 2026-09-07 #236：键盘会话卡死自愈。该壳收键盘后 vv.height 恒停在
            // 652=inner(720)−底栏(68)：open=h<_aH-60 恒真 → _aKb 卡真（含无聚焦被纯
            // vv 读数置位的会话），.phone 内联高锁死 652=底部 108px 空白+tabbar 悬空；
            // #209 清扫因 _aKb 真被跳过、focusout 400ms 复原因 652<_aH-60 不达——
            // 四条复原路全被这一个残留读数堵死。真键盘证据=vv 缩幅≥键盘下限
            //（min(_aIH,_aH)×22%，真键盘缩幅均 >200px，几十 px 的只可能是残留）或
            // innerHeight 同缩（resizes-content）。都不成立而缩幅落在残留带（13~22%）+
            // 会话已超 1.5s+vv 读数已稳 1.2s（收起动画每帧变化，凭此避开动画中途误清），
            // 判 vv 为壳残留：清键盘态复原 + 置 _aVvStale 闩抑制纯 vv 再触发（vv 回
            // 基准/触摸/聚焦时解除），防 652↔720 抖动把 .phone 来回抽。
            if (_aKb && !_aProv) {
              var _vN = Math.round(_aVV.height || 0);
              var _iN = window.innerHeight || 0;
              var _dK = _aH - _vN;
              var _kbFloor = Math.round(Math.min(_aIH || _aH, _aH || _aIH) * 0.22);
              // FIX 2026-09-10 #267：卡死停靠的第二种卡法（与 #236 那种「缩幅落在残留带」
              // 互斥、且更常见）——_aKb 真而 vv 与 innerHeight 都已【回到无键盘基准】：
              // 缩幅 _dK≤12 不满足 #236 的 `_dK >= 13` 判定，而本分支判完就 return、
              // 下面的 #209 清扫又被 `_aKb` 挡在门外，四条复原路全断 → .phone 内联收缩高
              // 永久停在键盘期数值 = 输入栏下方一整块空白（用户报「点开输入框会出现一部分
              // 空白」，诊断现场签名 kb=1 / vv=664=基线 / gap=274 即此态）。成因：这类内核
              // 收起键盘不再派 visualViewport.resize（荣耀自带浏览器/部分国产内核），焦点也
              // 丢了 → 250ms 轮询停表，收缩态没人再复检。判据与主链路同口径（syncAndroidKb
              // 的 `!open && _aKb && h >= _aH-12` 复原分支就认定 vv 回基准＝无键盘）。在用量
              // 闸门只看活焦点 document.activeElement：真键盘在用焦点必在输入框里；而
              // _aTextFocused 在 focusout 漏派的内核上必然滞留＝本 bug 的成因本身，拿它当
              // 闸门等于把修复挡在门外（与 #209「完全不看焦点」同口径，这里比它多一条活焦点保险）。
              if (_vN > 0 && _vN >= _aH - 12 && _iN >= _aIH - 12 && !_aIsText(document.activeElement)) {
                _aKb = false; _aClosing = false; _aVvStale = false;
                _aPhone.style.height = '';
                _aPhone.style.alignSelf = '';
                _aPanComp();
                kbUndockPanels();
              } else if (_vN > 0 && _dK >= 13 && _dK < _kbFloor && _iN >= _aIH - 12
                  && Date.now() - _aKbAt > 1500 && Date.now() - _aVvChgAt > 1200) {
                _aKb = false; _aClosing = false; _aVvStale = true;
                _aPhone.style.height = '';
                _aPhone.style.alignSelf = '';
                _aPanComp();
                kbUndockPanels();
              }
              return;
            }
            if (_aKb || _aProv) return;
            // FIX 2026-09-12 #369：布局视口残留深缩自愈（#236 同族第三形态：inner 与
            // vv 一起停在键盘态）。判据纯视口证据、零机型分支：无键盘会话 + 无文本聚焦
            // + 静默>2.2s + vv 读数已稳>1.2s（避开动画中途）+ 屏幕尺寸键未变（排除旋转）
            // + pointer:coarse（桌面缩放窗口不误伤）+ 本会话出现过真实键盘收缩（_aVvShrunkSeen
            // /实测平移）+ innerHeight 距 _aFullIH 深缩≥键盘下限（22%；地址栏显隐只有几十
            // px 不及）+ vv≈inner（同缩＝布局视口被内核收走的残留世界）。动作：scrollTo(0,0)
            // 试探内核自愈，再把 .phone 钉回 _aFullIH px（dvh 已被残留读数污染，只能 px 钉）；
            // 内核真恢复（inner 回基线）同拍解除。健康设备凑不齐这套条件，行为零变化。
            var _ihNow = window.innerHeight || 0;
            var _skNow = (screen.width || 0) + 'x' + (screen.height || 0);
            if (_skNow !== _aScrKey) {
              _aScrKey = _skNow;
              _aFullIH = Math.max(_ihNow, Math.round(_aVV.height || 0));
              if (_aVpPin) { _aVpPin = false; _aPhone.style.height = ''; _aPhone.style.alignSelf = ''; }
              return;
            }
            if (_ihNow > _aFullIH) _aFullIH = _ihNow;
            if (_aVpPin && _ihNow >= _aFullIH - 12) {
              _aVpPin = false;
              _aPhone.style.height = '';
              _aPhone.style.alignSelf = '';
              return;
            }
            var _coarse = false;
            try { _coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches; } catch (eC) {}
            // FIX 2026-09-14 #479：窗口级改尺寸看门狗兜底重锚（事件侧 syncAndroidKb 漏拍
            // 时——部分壳改窗口只发 window.resize 不发 vv.resize、或 250ms 轮询已停表——
            // 由本 1s 节拍兜住）。与 #369 残留自愈同一视口签名（inner≈vv 同深缩、无聚焦、
            // 静默），按「深缩发生时有无文本聚焦」分流：无聚焦（_aShrinkHadFoc=false，
            // 窗口被改小）→ 基线全体重锚跟随当前窗口、#369 钉高前提（inner 迟早回全屏高）
            // 不成立，绝不进入下方钉高分支；打字期深缩（_aShrinkHadFoc=true，VivoBrowser
            // 键盘残留族）保持 #369 原语义。健康设备凑不齐条件集，行为零变化。
            var _vvN = Math.round(_aVV.height || 0);
            if (!_aVpPin && !_aShrinkHadFoc && _ihNow > 0 && _vvN > 0 && _coarse
                && !_aIsText(document.activeElement) && !_aIsText(_aTextFocused)
                && Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200
                && Math.abs(_ihNow - _vvN) <= 12
                && (_ihNow < _aFullIH - 60 || _vvN < _aH - 60)) {
              _aShrinkHadFoc = false;
              _aH = _vvN; _aIH = _ihNow;
              if (_ihNow < _aFullIH) _aFullIH = _ihNow;
              return;
            }
            var _ihFloor = Math.round(Math.min(_aFullIH, _aH || _aFullIH) * 0.22);
            if (!_aVpPin && _coarse && (_aVvShrunkSeen || _aPanSeen >= 80) && _aShrinkHadFoc
                && !_aIsText(document.activeElement) && !_aIsText(_aTextFocused)
                && Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200
                && _ihNow > 0 && _ihNow < _aFullIH - 60 && (_aFullIH - _ihNow) >= _ihFloor
                && Math.abs(_ihNow - _vvN) <= 12) {
              try { window.scrollTo(0, 0); } catch (eS) {}
              _aVpPin = true;
              _aVpPinAt = Date.now();
              if (_aPhone.style.height !== _aFullIH + 'px') _aPhone.style.height = _aFullIH + 'px';
              _aPanComp();
              kbUndockPanels();
              return;
            }
            // #479：钉高前提失败阀——钉高在位 10s 后内核仍未回全屏高，且用户在深缩态
            // 有新交互（在用这个窗口尺寸，不是在等自愈；VivoBrowser 正常路径 scrollTo
            // 试探后内核回基线，走上面「inner≥基线−12」正常解除，到不了这里）→ 判钉高
            // 前提失败：放弃钉高、基线重锚到现实。覆盖「深缩发生在焦点滞留期、
            // _aShrinkHadFoc 带了键盘语境」的窄路径误钉（Edge 小窗打字中拖入小窗族）。
            if (_aVpPin && _aVpPinAt > 0 && Date.now() - _aVpPinAt > 10000 && _ihNow > 0
                && _ihNow < _aFullIH - 60 && Date.now() - _aLastAct < 2200) {
              _aVpPin = false; _aVpPinAt = 0;
              _aShrinkHadFoc = false;
              _aH = Math.min(_aH, _vvN); _aIH = _ihNow;
              if (_ihNow < _aFullIH) _aFullIH = _ihNow;
              _aPhone.style.height = '';
              _aPhone.style.alignSelf = '';
              return;
            }
            // #916：原「无内联高即早退」改为包一层——稳态高度对账（下方 #916 块）必须
            // 每拍都能跑到（发病态恰恰是【没有】内联高而 dvh 滞留）；键盘残留清扫语义
            // 原样保留（有内联高且视口回基线才清）。
            var _aInlineHad = !!(_aPhone.style.height || _aPhone.style.alignSelf);
            if (_aInlineHad) {
              var _hNow = Math.round(_aVV.height || 0);
              if (_hNow > 0 && _hNow >= _aH - 12 && (window.innerHeight || 0) >= _aIH - 12) {
                _aPhone.style.height = '';
                _aPhone.style.alignSelf = '';
                _aPanComp();
                kbUndockPanels();
              }
            }
            // FIX 2026-09-20 #916：安卓浏览器稳态高度对账（「顶部白条/显示不全、聊天页
            // 闪动、刷新才恢复」根治——OPPO Find X8s + Edge 实报，用户明说多机型同现）。
            // 现场签名（错误环多日反复）：inner=725 不动而 .phone 底边=699（少填 26px 白带）
            // 或 =751（超出 26px、tabbar 被裁）——26px=Edge 底部工具条高。根因：工具条
            // 显隐切换布局视口高度时，该内核的 100dvh 读数滞后/滞留旧值（CSS 唯一高度
            // 来源），而本模块的实测写高链路（syncVvFit/--mochi-ios-h）在 isIOS 分支，
            // 安卓稳态无人重写 → 白带/跳动持续到用户手动刷新。修法（零机型分支、纯结果
            // 量）：本 1s 看门狗稳态期（无键盘会话/无推定停靠/无 #369 钉高、无文本聚焦、
            // vv≈inner±12 排除键盘与动画中途、vv 读数已稳 1.2s、非 standalone PWA——
            // standalone 的 dvh 语义不同走既有形态链）实测 .phone 底边 vs innerHeight，
            // 偏差 >8px 连续两拍同值才把 .phone 内联钉高到实测期望值（内联赢选择器，
            // dvh 滞留不再生效）；偏差回 ≤8px（dvh 自行恢复/旋转/窗口变化后）摘除钉高
            // 回落 CSS。上方清扫块每拍先清内联再落到这里＝钉高态每拍「清→实测→复钉」
            // 单拍内完成，渲染帧始终是钉正后的形态，无来回抖动。健康设备偏差恒 ≤8px、
            // 零写入零重排，行为零变化。
            try {
              var _aExpB = window.innerHeight || 0;
              var _aVvQ = Math.round(_aVV.height || 0);
              var _aFitGo = _aExpB > 0 && _aVvQ > 0 && _coarse && !_aVpPin && !_aKb && !_aProv
                && Math.abs(_ihNow - _aVvQ) <= 12
                && !_aIsText(document.activeElement) && !_aIsText(_aTextFocused)
                && Date.now() - _aVvChgAt > 1200
                && !(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
              if (_aFitGo) {
                var _aPbNow = Math.round(_aPhone.getBoundingClientRect().bottom);
                var _aDev = (_aPbNow > 0) ? (_aPbNow - _aExpB) : 0;
                if (_aDev > 8 || _aDev < -8) {
                  if (_aFitPend === _aExpB) {
                    if (_aPhone.style.height !== _aExpB + 'px') _aPhone.style.height = _aExpB + 'px';
                    _aFitPin = true;
                    _aPanComp();
                  } else {
                    _aFitPend = _aExpB; // 首见只记账，下一拍（≥1s 后）同值才动手
                  }
                } else {
                  _aFitPend = null;
                  if (_aFitPin) { _aPhone.style.height = ''; _aFitPin = false; _aPanComp(); }
                }
              } else {
                // 守卫不满足（键盘/聚焦/动画期/standalone）→ 摘对账钉高让既有链接管
                _aFitPend = null;
                if (_aFitPin) { _aPhone.style.height = ''; _aFitPin = false; }
              }
            } catch (eFit) {}
          } catch (e) {}
        }, 1000);
        // v3.26.x：安卓键盘内部状态只读探针（与 iOS __mochiIosKb 同字段名，供
        // device.js window.mochiVvDiag() 合并）。此前诊断文本「键盘/锁残留：
        // kbActive=… 推定停靠=… 基线 inner/vv=…」几行只读 iOS 探针，安卓下永远
        // 输出 n/a —— 安卓键盘类报障（输入栏空白/被盖/飞顶）拿不到一点现场证据。
        // docLocked 恒 false：安卓分支不做 html{overflow:hidden} 文档锁。
        window.__mochiAndroidKb = function () {
          return {
            kbActive: !!_aKb,
            prov: !!_aProv,
            closing: !!_aClosing,
            staleVv: !!_aVvStale, // #236：vv 残留读数闩在位（诊断现场用）
            shrinkHadFoc: !!_aShrinkHadFoc, // #479：最近深缩的焦点语境（true=键盘形/#369 语义；false=窗口改尺寸已重锚）
            vpPin: !!_aVpPin, // #369：布局视口残留钉高在位（诊断现场用）
            docLocked: false,
            fullInner: Math.round(_aIH),
            fullVv: Math.round(_aH),
            vvNow: Math.round(_aVV.height),
            offsetTop: Math.round(_aVV.offsetTop || 0),
            panSeen: Math.round(_aPanSeen), // #267：本会话实测到的浏览器最大平移量＝保底停靠的尺子
            panSeenAgo: _aPanSeenAt ? Date.now() - _aPanSeenAt : -1, // 该读数距今多久（>1500ms 不再采信）
            vkOn: !!_aVkOn, // #337：VirtualKeyboard 实测尺是否已拉起
            vkH: (function () { try { var b = navigator.virtualKeyboard && navigator.virtualKeyboard.boundingRect; return b ? Math.round(b.height) : -1; } catch (eK) { return -1; } })(),
            burstLeft: Math.max(0, _aBurstUntil - Date.now()),
            focusTag: _aTextFocused ? String(_aTextFocused.tagName || '').toLowerCase() : '',
            watching: !!_aWatch,
            lastActAgo: Date.now() - _aLastAct,
            typosAgo: Date.now() - _aUserTypos
          };
        };
        // v3.15.x：键盘期「页面平移归零」自愈（红米 K80 Chrome 报修：更多功能里的小功能
        // 页面键盘一弹整页飞走、下方全灰；帮我决定打字输入框不弹到屏幕上方）。机理与
        // iOS Edge 当年同款：聚焦底部半框内输入框时，浏览器为让焦点可见先把【视觉视口
        // 往下平移】（vv.offsetTop>0，部分内核还伴随文档滚动），随后本模块才把 .phone
        // 收缩到可视高度——平移残留不归零：.phone（普通流）整体被推出屏幕上方，其下露出
        // body 底色=大面积灰。iOS 分支 pinScrollTop/healKbScroll 已修同症状，这里对齐安卓：
        //   · 仅键盘开启期（_aKb 或推定停靠 _aProv）干预，平时绝不碰；
        //   · 偏移 ≤8px 忽略——caret 微滚不误伤，防「每打一个字闪一下」；
        //   · 焦点已完整落在可视区内＝平移纯属残留 → 归零；或偏移 >160px（必然露灰）也归零。
        function _aWinY() {
          try { return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0; } catch (e) { return 0; }
        }
        // v3.16.x（第五轮）：视觉视口平移的「正向补偿」——红米 K80 Chrome 键盘弹出时
        // 为露焦点把视觉视口往下平移（vv.offsetTop>0），整页被推上移：输入栏飞顶、其下到
        // 键盘之间露 body 灰底。前几轮全靠 vv.scrollTo(0,0) 归零，但部分安卓内核 read-only
        // 又不可归零（或归零后被重新置位），平移残留 → 症状反复出现。
        // 改成不依赖归零能否生效的硬兜底：键盘开启期内，把 .phone 用 position:relative
        // 按残余偏移 offT 正向平移（top=offT）。此时 .phone 恰好填满整个可视区
        //（布局 [offT, offT+vv.height] = 可视区 [offT, offT+vv.height]），输入栏停在
        // .phone 底部 = 键盘上沿，灰条被 .phone 内容盖死、不飞顶。
        // 用 position:relative+top 而非 transform：transform 会变成 position:fixed
        // 悬浮面板（emoji-panel/poke-card/更多功能等均位于 .phone 内）的包含块、打断
        // 键盘期 fixed 停靠；relative+top 不构成包含块，停靠不受影响。
        // 归零（vv.scrollTo）仍然保留：能归零的内核 offsetTop→0、comp=0 自然不偏移。
        function _aPanComp() {
          try {
            var o = Math.round(_aVV.offsetTop || 0);
            // 1) .phone（主内容）补偿：relative 平移，恰好填满可视区
            if (o > 0) {
              if (_aPhone.style.position !== 'relative') _aPhone.style.position = 'relative';
              if (_aPhone.style.top !== o + 'px') _aPhone.style.top = o + 'px';
            } else {
              if (_aPhone.style.top) _aPhone.style.removeProperty('top');
              // 保留 position:relative——.phone 需作为「停靠态 absolute 面板」（见
              // kbDockPanels）的包含块，配合平移补偿让面板跟随主内容一起下移；
              // 该 position 由键盘关闭路径（kbUndockPanels）统一清理。
            }
            // 不再对面板使用 transform 补偿：translateY 会让面板生成新合成层，
            // 触发 .ce-box（contenteditable 输入框）文字渲染停在旧位置=输入的文字
            // 飞出输入框外的已知问题。改为 kbDockPanels 把 .phone 内面板锚定为
            // absolute，自动继承 .phone 的平移补偿（见下），此处无需再处理面板。
            // v3.16.x：无论如何 .phone（及面板内的 ce-box）被布局移动后，其文字
            // 合成层需刷新跟随（见 _aRefreshCe 注释）。统一防抖调度一次。
            _aSchedCe();
          } catch (e) {}
        }
        function _aPinPan() {
          try {
            // 1) 先尝试把视觉视口平移 / 文档滚动归零（能归零的内核 offsetTop 会归 0）
            var offT = _aVV.offsetTop || 0;
            var winY = _aWinY();
            // FIX 2026-09-10 #267：先把「浏览器为露焦点平移了多少」记下来再归零——本函数在
            // 每次键盘会话都被调（focusin burst / 250ms 轮询 / vv.resize），是唯一稳定读得到
            // 这个量的位置，而归零（下面 vv.scrollTo/window.scrollTo）会当场把它抹掉，不留档
            // 就永远量不到键盘高度。仅在 _aKb/_aProv 都还没接管几何时记账＝那时平移是键盘
            // 遮挡的直接证据；已接管时的平移纯属残留（v3.15/v3.16 归零语义不变）。
            if (!_aKb && !_aProv) {
              var _panPx = offT > winY ? offT : winY;
              if (_panPx > 8) {
                if (_panPx > _aPanSeen) _aPanSeen = _panPx;
                _aPanSeenAt = Date.now();
              }
            }
            if (offT > 0 && _aVV.scrollTo) { try { _aVV.scrollTo(0, 0); } catch (e4) {} }
            if (winY > 0) {
              try { window.scrollTo(0, 0); } catch (e2) {}
              try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e3) {}
            }
            // 2) 归零后再读一次真实偏移，判定「必然露灰」量级（不依赖键盘状态）兜底
            var offT2 = _aVV.offsetTop || 0;
            var winY2 = _aWinY();
            if (offT2 > 160 || winY2 > 160) {
              if (winY2) {
                try { window.scrollTo(0, 0); } catch (e2) {}
                try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e3) {}
              }
              if (offT2 && _aVV.scrollTo) { try { _aVV.scrollTo(0, 0); } catch (e4) {} }
            }
            // 3) 键盘开启期内无条件做正向补偿（不管归零成功与否，硬把 .phone 填满可视区）
            if (_aKb || _aProv) {
              _aPanComp();
            }
            // 4) 原有守卫：非键盘期不干预；键盘内小偏移(<8) 且输入已可见不误伤
            if (!_aKb && !_aProv && Date.now() > _aBurstUntil) return;
            if (offT2 <= 8 && winY2 <= 8) return;
            var need = offT2 > 160 || winY2 > 160;
            if (!need) {
              var tgt = (_aIsText(_aTextFocused) ? _aTextFocused : null) ||
                (_aIsText(document.activeElement) ? document.activeElement : null);
              if (tgt && tgt.getBoundingClientRect) {
                var r = tgt.getBoundingClientRect(); // 布局坐标；可视区=[offT, offT+vv.height]
                if (r.top >= offT2 - 8 && r.bottom <= offT2 + _aVV.height - 8) need = true;
              } else {
                need = true;
              }
            }
            if (!need) return;
            if (winY2) {
              try { window.scrollTo(0, 0); } catch (e2) {}
              try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e3) {}
            }
            if (offT2 && _aVV.scrollTo) { try { _aVV.scrollTo(0, 0); } catch (e4) {} }
          } catch (e) {}
        }
        function _aBump() { _aLastAct = Date.now(); _aVvStale = false; } // #236：真实交互解除 vv 残留闩
        function _aIsText(el) {
          return el && ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
            ? (el.type !== 'checkbox' && el.type !== 'range' && el.type !== 'file' && el.type !== 'color' && !el.readOnly)
            : el.isContentEditable === true);
        }
        // ===== FIX 2026-09-15 #530：安卓键盘期底部安全区归零 =====
        // 现象（vivo S20 Edge 浏览器态·非全屏，用户明说多机型同现、勿覆盖式乱改）：
        //   点聊天输入栏弹出输入法后，聊天输入栏与输入法之间露出一大块底色（暗色主题下
        //   即「大块黑」）；同一台机全屏模式下无此问题。
        // 根因（Chromium 已知缺陷，issues 406935609 / 457682720）：安卓 IME 弹出时
        //   env(safe-area-inset-bottom) 仍报「手势条 / 浏览器底栏」的高度（规范要求键盘
        //   在场时该 inset 应为 0，且应由页面自行清零），而聊天输入栏底内边距用的是
        //   calc(10px + var(--mochi-safe-bottom, env(safe-area-inset-bottom,0px)))——
        //   --mochi-safe-bottom 此前只在 iOS 分支（syncSafeBottom）维护，安卓从不写该变量
        //   → 键盘期回落读到一个不该在场的 env() 值，输入栏整段被垫高，其与键盘之间那段
        //   空白不受页面控制。全屏（沉浸式）下 env() 为 0，故「全屏模式正常」。
        // 修法（零机型分支、纯结果量）：键盘在场期间把变量钉 0px，键盘收起摘除属性回落 env()。
        //   键盘判据与主链路一致（vv 相对无键盘基线收缩 ≥60px），并并入 _aProv 推定停靠态；
        //   不并入 _aKb——_aKb 无论从哪条路置位都伴随 vv 收缩（判据已覆盖），收起瞬间 _aKb 尚真
        //   而 vv 已回基准时并入会让变量多留一拍，故以视口为唯一依据、1s 看门狗兜底。
        //   对 env() 本为 0 的设备，0px 与回落值相同 = 零视觉变化（不引入跨机型回归）。
        var _aSafeB = null;
        function syncSafeBottomA() {
          try {
            var d = document.documentElement;
            var _kbOn = !!(_aProv || (_aVV && _aH > 0 && _aVV.height > 0 && _aVV.height < _aH - 60));
            // FIX 2026-09-18 #719：e2e 浏览器（Edge/Android 15+，页面顶进系统状态栏/
            // 手势条而 env()=0）键盘收起回落不摘属性——改落判定器 e2e 底部避让估式
            // （手势条 16/z），否则 tabbar/输入栏退回 0 避让＝被手势条盖住（#530 同位
            // 维护点、零机型分支：非 e2e 形态 e2eBrowser 恒 false，回落 '' 摘除原样）。
            // env 读 _aCoverEnvCache（跨层 var——typeof 守卫防不同嵌套层 ReferenceError；
            // 未初始化按 0 传：e2e 形态本就要求 env<20，_aSyncCoverTop 探针稍后自会补齐口径）。
            var _fcB = null;
            try {
              _fcB = window.mochiViewportForm({ standalone: false, envTop: (typeof _aCoverEnvCache !== 'undefined' && _aCoverEnvCache >= 0) ? _aCoverEnvCache : 0, innerH: window.innerHeight || 0, screenH: (window.screen && window.screen.height) || 0, innerW: window.innerWidth || 0, screenW: (window.screen && window.screen.width) || 0, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false, e2eLatch: !!window.__mochiE2eLatch });
            } catch (eF2) {}
            if (_fcB && _fcB.e2eBrowser && !window.__mochiE2eLatch) window.__mochiE2eLatch = true;
            var _next = _kbOn ? '0px' : ((_fcB && _fcB.e2eBrowser && _fcB.safeBottom) ? _fcB.safeBottom + 'px' : '');
            if (_next === _aSafeB) return;
            _aSafeB = _next;
            if (_next) d.style.setProperty('--mochi-safe-bottom', _next);
            else d.style.removeProperty('--mochi-safe-bottom');
          } catch (e) {}
        }
        // FIX 2026-09-19 #810：键盘弹出「整个页面被缩小、两边和底部大面积露底色」自愈的状态。
        // 华为 nova 10 SE 华为系统自带浏览器实报「点输入框弹键盘：页面被顶上去+画面缩小+
        // 两侧和底部大面积留白+严重卡顿」，用户明说其他机型也有、要求勿致跨机型回归。
        // 这类内核键盘弹出时不只缩 vv.height，还会把可视视口【缩放】拉到 <1（zoom-out 让出
        // 键盘+焦点）：页面整体变小、文档外区域露 body 底色＝两侧/底部留白；叠加键盘期的
        // 逐帧 .phone 高度跟随＝resize 风暴级卡顿。A/B 两串等价仅 scale 写法（1.0↔1）不同＝
        // 交替写保证 setAttribute 每次都是真实变更、强制内核重新解析。
        var _aZoomFixCnt = 0, _aZoomFixAt = 0;
        var _aZoomMetaA = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-visual';
        var _aZoomMetaB = _aZoomMetaA.replace('initial-scale=1.0', 'initial-scale=1').replace('minimum-scale=1.0', 'minimum-scale=1').replace('maximum-scale=1.0', 'maximum-scale=1');
        function syncAndroidKb() {
          if (!_aVV || !_aPhone) return;
          try { syncSafeBottomA(); } catch (eSB) {}
          var h = _aVV.height;
          // #810 主判据：键盘/聚焦会话内 vv.scale<0.95＝内核把页面整体缩小了。判据全是内核
          // 可观测信号（正常内核键盘只缩 height、scale 恒 1，永不触发；缩放只在文本聚焦期
          // 出现，用户闲时手动捏合缩放不在聚焦态＝不误伤）。处置＝#174 iOS 同款「重写
          // viewport meta 按 initial-scale=1 吸附回原大」，每会话 ≤3 次、间隔 4s 防循环；
          // 重写串严格保持 resizes-visual（绝不在键盘会话中途换键盘模型）。
          if (_aVV.scale && _aVV.scale < 0.95 && (_aKb || _aProv || _aIsText(_aTextFocused) || _aIsText(document.activeElement))) {
            var _zn = Date.now();
            if (_aZoomFixCnt < 3 && _zn - _aZoomFixAt > 4000) {
              _aZoomFixCnt++; _aZoomFixAt = _zn;
              try {
                document.querySelectorAll('meta[name="viewport"]').forEach(function (m) {
                  m.setAttribute('content', (_aZoomFixCnt % 2) ? _aZoomMetaB : _aZoomMetaA);
                });
              } catch (eZM) {}
              window.__mochiKbZoomFix = { n: _aZoomFixCnt, at: _zn, scale: +_aVV.scale.toFixed(2) };
            }
          }
          // FIX 2026-09-07 #236：vv 回基准=读数健康，解除残留闩；高度变化刷新稳定
          // 时刻（收起动画每帧都变，1s 看门狗凭「vv 已稳 1.2s」避开动画中途误清）
          if (h >= _aH - 60) _aVvStale = false; // #236：vv 回基准=读数诚实，解除残留闩
          // FIX 2026-09-17 #657：读数回基准、或读数又动了（＝新的真实键盘信号）都解除静音闩；
          // 静音期读数纹丝不动，故这里解不掉（输入法字条显隐、真键盘再弹出都会改 h）。
          if (h !== _aPrevH || h >= _aH - 60) _aKbMute = false;
          if (h !== _aPrevH) _aVvChgAt = Date.now();
          // FIX 2026-09-14 #479：窗口级改尺寸甄别与基线重锚。Edge/Chrome 自由小窗、分屏、
          // 桌面缩放窗口把【布局视口】inner 与 vv 一起永久改小，视口签名与键盘弹出全同
          //（vv 深缩）；基线 _aH/_aIH/_aFullIH 只涨不跌 → 旧判据无聚焦也置位 _aKb 幽灵
          // 会话（面板停靠/alignSelf 残留），#369 残留自愈更把 .phone 钉回旧全屏高且
          // 永不释放（释放条件 inner≥基线在小窗不成立）＝顶部名称栏与输入栏一起被推出
          // 窗外（用户实测 OPPO Ace3 + Edge 小窗，多机型同报；诊断签名「.phone、底部
          // 超出 phone底=668 inner=584」）。程序可分的唯一硬证据=焦点语境：真键盘必然
          // 在文本聚焦期弹出，「inner≈vv 一起深缩 + 无文本聚焦」=窗口被改小 → 三条基线
          // 全体重锚到当前窗口（_aFullIH 一并下移＝#369 触发条件 _ihNow<_aFullIH-60 恒
          // 假，双保险）；打字期深缩反之记 _aShrinkHadFoc=true＝#369 原语义证据位。
          // 键盘会话中（_aKb/_aProv）不重锚——停靠几何由主路径管理。
          var _ihN = window.innerHeight || 0;
          var _focNow = _aIsText(_aTextFocused) || _aIsText(document.activeElement);
          if (!_focNow && !_aKb && !_aProv && _ihN > 0 && h > 0
              && Math.abs(_ihN - h) <= 12
              && (h < _aH - 60 || _ihN < _aIH - 60)) {
            _aShrinkHadFoc = false;
            _aH = h; _aIH = _ihN;
            if (_ihN < _aFullIH) _aFullIH = _ihN;
            if (_aVpPin) { _aVpPin = false; _aPhone.style.height = ''; _aPhone.style.alignSelf = ''; }
          } else if (_focNow && (h < _aH - 60 || _ihN < _aIH - 60)) {
            _aShrinkHadFoc = true;
          }
          // v3.29.x（#141）：高度【上升】且键盘开着=收起动画进行中——不依赖 focusout
          //（安卓返回键/手势收键盘焦点保留，focusout 不触发，#89 的 _aClosing 闸门挂
          // 不上；此前每帧 resize 仍跑 _aPinPan/nudgeInputVisible 的强制布局读取，
          // 重聊天页（数千条消息）单帧 reflow ~100ms 积压 → 输入栏下方灰块几秒才收）。
          // 门控只要求「相对上一帧在涨」+ 键盘仍在开启态（_aKb 置位本身就代表
          // h < _aH-60 的收缩世界），动画早期帧（h 仍 < _aH-60）也能第一时间置位；
          // 与 #89 失焦路径汇合进入「动画期只写 height 跟随」分支，收起期彻底零
          // 强制布局读取；复原走 _aPanComp 兜底，v3.27.x 输入行不飞语义不变。
          if (_aKb && h > _aPrevH && _aPrevH > 0) {
            _aClosing = true;
          }
          _aPrevH = h;
          // #479：键盘弹出判定加焦点闸——无聚焦深缩已在上方按窗口改尺寸重锚基线
          //（_aH 已=当前窗口高，此判据自然为假）；焦点闸另兜住纯 vv 缩、无聚焦的
          // 窗口形态（地址栏/工具条显隐：inner 不动、只 vv 缩 → 不满足重锚条件，
          // 旧版这里会幽灵停靠），防幽灵键盘会话。
          // #657：_aKbMute=已被几何反证判「键盘不在场」的残留读数，不得再据它收缩（读数真的
          // 变化/回基准即解除，见函数头）。
          var open = (!_aVvStale && !_aKbMute && h < _aH - 60 && _focNow); // 可视高度明显变小 = 键盘弹出（#236：残留读数闩抑制纯 vv 信号；真键盘不受影响——inner 同缩走原判/交互与回基准解锁；#479：必然伴随文本聚焦）
          if (!open && h > _aH) _aH = h; // 无键盘时更新基准，地址栏变化不误判
          if (open && !_aKb) { _aClosing = false; _aKb = true; _aVvShrunkSeen = true; _aKbAt = Date.now(); _aPhone.style.alignSelf = 'flex-start'; kbDockPanels(); _aProvClear(); }
          if (!open && _aKb) {
            // v3.27.x：键盘收起——动画期 visualViewport 还没回到无键盘基准（_aH）时，
            // 不要提前把 .phone 撑回全高 + 面板摘停靠。否则键盘收起动画中途就恢复：
            // 底部半框/输入行会骤然下沉一整帧（用户报障「关闭输入法时我的拍一拍
            // 底部输入行整行飞」）。改为动画期持续跟随 vv 平滑上浮、面板保持停靠，
            // 等 vv 回到基准附近（≤12px 误差）才真正恢复，杜绝中途下沉跳变。
            if (h < _aH - 12) {
              // v3.28.x：收起动画期只写 height 跟随 vv，不再调 _aPinPan——_aPinPan 读
              // _aVV.offsetTop/scrollY 会强制同步 reflow，每帧 resize 叠加致主线程拥堵
              //（用户报"手动收起键盘那一刻卡顿"，红米/小米 Chrome 复现）。收起期 offsetTop
              // 通常 ~0（键盘往下收、视口不平移），平移无需逐帧归零；复原时 _aPanComp 统一兜底。
              _aClosing = true;
              if (_aPhone.style.height !== h + 'px') _aPhone.style.height = h + 'px';
              return;
            }
            _aKb = false;
            _aClosing = false;
            _aPhone.style.height = '';
            _aPhone.style.alignSelf = '';
            // v3.29.x（#141）：收起瞬间把基准钳回布局视口全高——键盘期 _aH 可能被
            // 内核/地址栏瞬态值抬错，若停留低位，h < _aH-60 恒真 → 下一帧误判
            // 「键盘又弹出」把 .phone 锁死在中间高度 = 输入栏下方灰块几秒不收。
            // innerHeight 即布局视口高（resizes-visual 下不随键盘收缩），恒可靠。
            if (_aH < window.innerHeight - 12) _aH = window.innerHeight;
            _aPanComp();
            kbUndockPanels();
            return;
          }
          if (_aKb) {
            var hs = h + 'px';
            // 值不变不写 DOM（字符串比对早退），打字/滚动时不重排
            if (_aPhone.style.height !== hs) _aPhone.style.height = hs;
            // v3.15.x：收缩后浏览器为露焦点做的视口平移已无必要，残留会整页飞走露灰
            // v3.28.x：收起动画期（_aClosing）跳过 _aPinPan——其读 offsetTop/scrollY 强制
            // 同步 reflow，每帧 resize 叠加致"收起键盘卡顿"。弹起期仍需归零平移残留。
            if (!_aClosing) _aPinPan();
          }
        }
        // v3.10.x：聚焦期间主动轮询兜底——安卓 visualViewport.resize 在键盘弹出时
        // 偶发漏触发（尤其 contenteditable / 全屏聊天页 / 部分国产 ROM），focusin 的
        // 120ms 一次性补偿也可能早于键盘动画完成（h 还没降）→ syncAndroidKb 判 open=false
        // 不收缩 → .phone 永不收缩 → 输入栏被键盘完全盖住。改成：只要聚焦文本输入框
        // （或键盘仍开着），每 250ms 复审一次调 syncAndroidKb 按可视高度主动收缩；
        // 未聚焦且键盘已收则停表。syncAndroidKb 稳态期高度值不变不写 DOM（字符串比对
        // 早退），打字时不重排、无白闪。
        var _aWatch = null;
        function startAWatch() {
          if (_aWatch) return;
          _aWatch = setInterval(function () {
            try {
              var foc = _aIsText(_aTextFocused) || _aIsText(document.activeElement);
              if (foc) {
                // v3.16.x（第四轮）：聚焦期间持续续期 _aBurstUntil——键盘会话内
                // _aPinPan 恒活跃，任何时刻的 vv 平移残留都会被归零。此前只在
                // focusin 设一次 850ms 宽限，K80 Chrome 键盘动画慢/平移晚到时
                // 宽限已过 → 平移不归零（输入栏飞走露灰）。250ms 轮询不断续期，
                // 每次顺延 850ms；打字（caret 微滚 <160px）不会触发归零，无闪烁。
                _aBurstUntil = Date.now() + 850;
                syncAndroidKb();
                nudgeInputVisible();
                // v3.12.x：悬浮键盘推定停靠复查（vv 不反映键盘的内核走这里兜底）
                _aProvCheck();
                // #337：保底停靠后仍被盖（vv 诚实内核）→ 欠深自纠逐拍收紧
                _aProvDeepen();
                // v3.15.x：平移残留归零
                _aPinPan();
                // v3.14.x：vv 从小变大=键盘收回动画（摩托罗拉G100/雨见 focusout/
                // vv.resize 漏触发，但轮询能读到 vv.height 回升）→ 立即清除推顶，
                // 不等 2200ms。悬浮键盘 vv 恒接近 _aH，_aLastVVH 不会小于 _aH-60，不误清除
                var _hNow = _aVV.height;
                // v3.29.x（#141）：返回键/手势收键盘时 focusout 不来，_aClosing 的
                // 失焦置位路径失效——这里按「vv 从小变大=收起动画」补置（与
                // syncAndroidKb 顶部探测同判据），收起动画期照常跳过强制布局读取
                if (_aKb && !_aClosing && _aLastVVH && _aLastVVH < _hNow) {
                  _aClosing = true;
                }
                if (_aProv && _aLastVVH && _aLastVVH < _aH - 60 && _hNow >= _aH - 60) {
                  _aProvClear();
                }
                _aLastVVH = _hNow;
                // v3.13.x：推定停靠自愈——vv 已到无键盘基准（键盘肉眼已收）但
                // _aProv 仍顶住 58%、输入框保持聚焦干等 focusout 时，用户长时间
                // 无任何交互即视为键盘已收，立即清除推顶，输入框马上回底
                if (_aProv && _aVvShrunkSeen && _aVV.height >= _aH - 60 && Date.now() - _aLastAct > 2200) {
                  // FIX 2026-09-11 #337：本会话 vv 从未真实收缩过（漂移/悬浮内核）时，
                  // 「vv 回基准」不构成键盘已收的证据（读数本来就没动过）——不做此自愈，
                  // 否则保底停靠被 2.2s 空闲自愈反复撤掉＝盖↔露抽风（无头 F1 实证：
                  // 1400ms 停靠 490、2500ms 被撤回 844＝畅玩80Pro「完全盖住」的另一半
                  // 成因）。真收键盘仍由失焦/真实 vv 变化/输入确认/切后台四条复原路接管；
                  // vv 收缩过的正常内核（_aVvShrunkSeen=true）原自愈语义不变
                  //（摩托罗拉G100「键盘已收焦点滞留」场景）。
                  _aProvClear();
                }
              } else if (_aKb) {
                // v3.27.x：收起也等 vv 回到基准附近（≤12px）再复原，避免动画期
                // 提前把 .phone 撑回全高导致面板/输入行下沉跳变（与 syncAndroidKb 同判据）
                if (_aVV.height >= _aH - 12) {
                  _aKb = false;
                  _aClosing = false;
                  _aPhone.style.height = '';
                  _aPhone.style.alignSelf = '';
                  _aPanComp();
                  kbUndockPanels();
                }
              } else {
                // v3.12.x：停表前做一次兜底清理（保底停靠残留时复原 .phone）
                _aProvCheck();
                stopAWatch();
              }
            } catch (e) {}
          }, 250);
        }
        function stopAWatch() {
          if (_aWatch) { clearInterval(_aWatch); _aWatch = null; }
        }
        // ===== v3.12.x：二线兜底「悬浮键盘推定停靠」（安卓分支） =====
        // 纯悬浮键盘内核（腾讯 X5、旧版夸克、部分国产 ROM）：键盘弹出时
        // visualViewport.height 与 window.innerHeight 【都】不变（interactive-widget
        // 也不生效），上面按 vv 判定 open 永远 false → .phone 永不收缩 → 输入栏
        // 被输入法整个盖住且不自愈。这类内核没有任何可读信号，只能在全部保守
        // 条件命中时【推定】键盘已弹出：
        //   · 用户手势聚焦文本框（touchstart 后 1.5s 内的 focusin 才武装——程序化
        //     自动聚焦在安卓上通常不弹软键盘，不能算数）
        //   · 聚焦已持续 >900ms（正常内核几百 ms 内 vv 必收缩走原路径，绝不进这里）
        //   · 期间两个视口高度都纹丝不动（差值 ≤2px）
        //   · 近 30s 无硬件键盘真实按键（kbHardKeyUntil）
        // 命中后按无键盘基准的 58% 保底收缩（主流中文输入法连工具栏约占屏
        // 35%~45%，58% 可视区必在其上方）；失焦 / 出现真实 resize 即由原机制
        // 接管恢复，正常设备永远不会触发本兜底。
        function _aProvDock() {
          var base = Math.min(_aH, _aIH);
          // FIX 2026-09-10 #267：有实测平移量时按实测停靠，不再猜 58%——浏览器把视觉视口
          // 平移 P 像素只为让焦点露出键盘上沿，故键盘上沿就在 base−P 处，.phone 停到这里
          // 输入栏正好压在键盘上方。一次改动同时修掉两个方向的老毛病：① IME 高过 42%
          //（荣耀 X50 自带浏览器实测 IME 占约 62%，58% 停靠后整行仍在键盘下面＝看不见、
          // 打不出、发不了）；② IME 矮于 42% 时 58% 多缩，输入栏下方露出一大片空白。
          // 门槛：平移量 ≥80px 且 1.5s 内新鲜（几十 px 多为 caret 微滚/地址栏抖动，不足以
          // 当尺子）；结果钳在 [240, base−40]。无实测（纯悬浮且不平移的 X5/旧夸克内核）
          // 仍走原 58% 保底，那批机型行为零变化。
          var ph = Math.max(240, Math.round(base * 0.58));
          if (_aPanSeen >= 80 && Date.now() - _aPanSeenAt < 1500) {
            var _meas = Math.round(base - _aPanSeen);
            if (_meas >= 240 && _meas <= base - 40) ph = _meas;
          }
          _aProv = true;
          try { syncSafeBottomA(); } catch (eSBP) {} // FIX 2026-09-15 #530：推定停靠同样按键盘在场归零
          _aPhone.style.alignSelf = 'flex-start';
          if (_aPhone.style.height !== ph + 'px') _aPhone.style.height = ph + 'px';
          kbDockPanels();
          try { window.scrollTo(0, 0); } catch (e) {}
          _aPinPan(); // v3.15.x：推顶后残留的 vv 平移同样归零（K80 同症状）
          _aProvVkRuler(base); // #337：Chromium 悬浮键盘改用 VirtualKeyboard 实测几何精停
        }
        // FIX 2026-09-11 #337：悬浮键盘实测尺（VirtualKeyboard API，Chromium 94+）——
        // 畅玩80Pro 族无平移无读数变化，58% 盲猜对高占比输入法（实测 50~62%）停靠不足，
        // 输入栏仍整行在键盘下。overlaysContent=true 后浏览器把键盘改纯悬浮并经
        // geometrychange 实测上报几何，按 base−kbH 精确停靠。特性探测：不支持该 API 的
        // 内核零影响；只在保底停靠已成立时启用（正常内核主路径 _aKb 停靠从不进保底，
        // 行为零变化）；_aProvClear 复原时关回 overlaysContent 还原内核默认行为。
        var _aVkOn = false;
        function _aProvVkRuler(base) {
          try {
            var vk = navigator.virtualKeyboard;
            if (!vk) return;
            if (!_aVkOn) {
              _aVkOn = true;
              vk.overlaysContent = true;
              vk.addEventListener('geometrychange', function () {
                try {
                  if (!_aProv || _aKb || !_aPhone) return;
                  var kbH = Math.round((vk.boundingRect && vk.boundingRect.height) || 0);
                  if (kbH < 80) return;
                  var b2 = Math.min(_aH, _aIH);
                  var ph2 = Math.max(240, Math.min(b2 - Math.max(kbH, 40), b2 - 40));
                  if (_aPhone.style.height !== ph2 + 'px') _aPhone.style.height = ph2 + 'px';
                } catch (eG) {}
              });
            }
          } catch (eVk) {}
        }
        // FIX 2026-09-11 #337：欠深自纠——保底停靠后聚焦输入框仍被盖（可视性实测，
        // 只在 vv 读数诚实的内核可判）⇒ 轮询每拍再收 8% 基准，直至露出或触底 34%。
        // 只在 _aProv 态跑：主路径 _aKb 停靠高度=vv.height，元素天然可见永不进这里。
        // #337：被盖实测取「元素 ∪ 其输入行容器」的最大底边——聊天输入行有底部内边距，
        // 只测输入元素本身会漏掉「行内边距被盖」的欠深状态（无头 F2 实证：元素底 800=可视
        // 底 800 判露出，行底 820 实际仍在键盘下）。
        function _aCoverBottom(el) {
          try {
            var b = el.getBoundingClientRect().bottom;
            var row = el.closest ? el.closest('.chat-input-row') : null;
            if (row) b = Math.max(b, row.getBoundingClientRect().bottom);
            return b;
          } catch (eCB) { return el.getBoundingClientRect().bottom; }
        }
        function _aProvDeepen() {
          try {
            if (!_aProv || _aKb) return;
            var tgt = (_aIsText(_aTextFocused) ? _aTextFocused : null) ||
              (_aIsText(document.activeElement) ? document.activeElement : null);
            if (!tgt || !tgt.getBoundingClientRect) return;
            var visBottom = (_aVV.offsetTop || 0) + _aVV.height;
            var r = tgt.getBoundingClientRect();
            if (!(r.height > 0 && _aCoverBottom(tgt) > visBottom + 12)) return; // 已露出
            var base = Math.min(_aH, _aIH);
            var cur = parseInt(_aPhone.style.height, 10) || Math.round(base * 0.58);
            var ph = Math.max(Math.round(base * 0.34), cur - Math.round(base * 0.08));
            if (ph < cur && _aPhone.style.height !== ph + 'px') _aPhone.style.height = ph + 'px';
          } catch (eD) {}
        }
        // v3.29.x（#141）：推定收口——悬浮键盘内核收回键盘（focusout 不可靠、
        // vv 不变化时原 _aProvCheck 自愈最迟要等 2200ms 无活动），用户输入
        // 中的真实编辑立即放行：.phone 马上撑回全高，输入栏下方灰块不再残留。
        // 编辑信号用本模块自有 _aUserTypos（文档级 keydown 捕获，AI-B 自有），
        // 不耦合 chat.js 内部守卫函数（跨域状态随时可能被对方重构改名）。
        function _aProvUserConfirm() {
          try {
            if (!_aProv || _aKb) return;
            var tgt = (_aIsText(_aTextFocused) ? _aTextFocused : null) ||
              (_aIsText(document.activeElement) ? document.activeElement : null);
            if (!tgt || Date.now() - _aUserTypos > 1200) return;
            _aProvClear();
            startAWatch();
          } catch (e) {}
        }
        try {
          document.addEventListener('input', function () { _aProvUserConfirm(); }, true);
          document.addEventListener('compositionstart', function () { _aUserTypos = Date.now(); _aProvUserConfirm(); }, true);
        } catch (eProvUser) {}
        function _aProvClear() {
          if (!_aProv) return;
          _aProv = false;
          try { syncSafeBottomA(); } catch (eSBC) {} // FIX 2026-09-15 #530：退出推定停靠时重算（_aKb 仍真则不摘）
          // #337：保底停靠结束＝把键盘行为还给内核默认（vv 收缩模型），正常内核
          // 下次聚焦仍走主路径；不支持该 API 的内核此行无效，零影响。
          // _aVkOn 一并复位：下次保底停靠重新拉起实测尺（否则第二轮键盘会话没尺子）。
          try { if (_aVkOn && navigator.virtualKeyboard) { navigator.virtualKeyboard.overlaysContent = false; _aVkOn = false; } } catch (eVkOff) {}
          if (_aKb) return; // 正常机制已接管 .phone 高度，交回原逻辑管理
          _aPhone.style.height = '';
          _aPhone.style.alignSelf = '';
          _aPanComp();
          kbUndockPanels();
        }
        function _aProvCheck() {
          try {
            if (!_aVV || !_aPhone) return;
            var tgt = (_aIsText(_aTextFocused) ? _aTextFocused : null) ||
              (_aIsText(document.activeElement) ? document.activeElement : null);
            var ih = window.innerHeight;
            if (!tgt) {
              // 无聚焦：无键盘态基线跟随 + 保底停靠残留清理（可视高度回基准=键盘已收）
              // FIX 2026-09-12 #369：基准重锚加浅漂移闸——原样 `if(!_aKb&&!_aProv) _aIH=ih`
              // 会把无键盘基准吞成内核残留值（VivoBrowser 收键盘后 inner 恒停 373），
              // #236/#209 所有「inner≥基线−12」判据从此恒真＝全数失明。改为仅浅漂移
              //（降幅 <22% 键盘下限，地址栏显隐量级）才跟随，深缩一律不吞。
              if (!_aKb && !_aProv && (ih >= _aIH - 12 || _aIH - ih < Math.round(Math.min(_aIH || ih, _aH || ih) * 0.22))) _aIH = ih;
              if (_aProv && _aVV.height >= _aH - 60) _aProvClear();
              return;
            }
            // FIX 2026-09-13 #387：两处保底停靠统一加「实测被盖」闸——
            // 读数判据（|vv−基线|≤2 且 |inner−基线|≤2）只证明「视口没动」，
            // 不证明「键盘在场」：无软键盘环境（电脑浏览器/DevTools 移动模拟/
            // 连实体键盘的机型）视口永远不动，点输入栏即盲推 58% 停靠＝
            // 输入栏顶到屏中、下方大片空白（UI 乱），自愈清除后反复点击又
            // 缩回＝闪屏（桌面 Chrome 移动模拟实测复现）。与 #337 第二判据
            // 同一把尺：聚焦元素∪输入行底边低于可视区底边才算键盘在场的
            // 直接证据——悬浮键盘真场景键盘必然盖住输入栏，照常停靠零回归；
            // 元素看得见就无需停靠，只可能少停不可能多停。
            var _kbCovered = false;
            try {
              var _rC = tgt.getBoundingClientRect ? tgt.getBoundingClientRect() : null;
              var _visBottomC = (_aVV.offsetTop || 0) + _aVV.height;
              _kbCovered = !!(_rC && _rC.height > 0 && _aCoverBottom(tgt) > _visBottomC + 12);
            } catch (eCov) {}
            if (!_aKb && !_aProv && !_aKbMute &&
                Date.now() - _aFocusAt > 900 &&
                Date.now() - kbLastTouchAt < 1500 &&
                kbTouchArmed(tgt) &&
                Date.now() > kbHardKeyUntil &&
                Math.abs(_aVV.height - _aH) <= 2 &&
                Math.abs(ih - _aIH) <= 2 && _kbCovered) {
              _aProvDock();
            } else if (!_aKb && !_aProv && !_aKbMute &&
                Date.now() - _aFocusAt > 900 &&
                kbTouchArmed(tgt) &&
                Date.now() > kbHardKeyUntil) {
              // FIX 2026-09-11 #337：可见性触发停靠（第二判据：实测被盖才动作）——
              // 荣耀畅玩80Pro 自带浏览器（X50 同族多机型）：键盘弹出时 vv 读数漂移/不缩
              //（|vv−基线|≤2 恒不成立）→ 上面的读数判据永远不命中，输入栏整行留在键盘下。
              // 改以「聚焦输入框实际底边低于可视区底边」为尺：被盖＝键盘在场的直接证据，
              // 与内核读数无关。常规内核主路径几百 ms 内已 _aKb 停靠不进这里；程序化聚焦
              // 无键盘（元素可见）也不进——零误触发面。高度仍由 _aProvDock 的尺子定。
              if (_kbCovered) _aProvDock();
            }
          } catch (e) {}
        }
        // 任何真实交互（触摸/按键/聚焦）都续期活动基线——打字停顿、点键盘键、
        // 点击输入框都不会被上面的自愈误判为「键盘已收」误清除推顶
        try {
          document.addEventListener('touchstart', _aBump, { passive: true, capture: true });
        } catch (e) {}
        // FIX 2026-09-17 #657：键盘期收缩高「第五条复原路」——几何反证（零机型分支）。
        // 用户实报（vivo X200S + Edge，明说其他机型也有）：信箱→打开写信页面，滑动屏幕时
        // 整页飞出去、只显示手机上半屏。根因：软键盘收缩靠可视视口读数，而安卓收键盘/滑动
        // 不 blur——焦点仍留在输入框（写信页 ce-box）上时，四条兄弟复原路全被挡住：
        // #209/#236 视口闸（读数滞留小值时 _dK 落在深缩带 ≥22%、绕开 #236 的残留带判定）、
        // #267 活焦点闸、#542 焦点闸，都要「焦点已离开」或「读数回基准」才动 ⇒ .phone 内联
        // 收缩高永久停在键盘期数值＝只显示上半屏，用户往下滑（滑的是半屏下方的空白区）也不
        // 回来（无头实测复现：vv 滞留 414/740、滑动后 2.6s 仍是 414px）。
        // 本条证据与焦点、读数都无关，只认几何反证：可视视口底边以下那块区域若真被软键盘
        // 占据，浏览器不会把触摸派发给页面——页面收到落在视口底边以下的真实触摸点 ⇒ 键盘必
        // 不在场。命中即按 #209/#236/#542 同款动作复原，并置 _aKbMute 闩防残留读数每 250ms
        // 把 .phone 抽回去。健康设备恒不命中（键盘真在场时该区域触摸归键盘）；只作用于
        // vv 收缩的真键盘会话，悬浮/推定停靠（_aProv）族行为零变化。
        var _aProofT = null;
        try {
          document.addEventListener('touchstart', function (e) {
            try {
              if (!_aKb || _aProv || _aClosing) return;       // 只管 vv 收缩的键盘会话
              if (Date.now() - _aKbAt < 1200) return;         // 会话刚开始（弹起/首帧定位）不判
              if (Date.now() - _aVvChgAt < 400) return;       // 读数刚变＝动画中途，不判
              var t = e.touches && e.touches[0];
              if (!t || _aIsText(e.target)) return;           // 触摸落在输入框上＝用户去点输入框，不判
              if (!(t.clientY > Math.round((_aVV.offsetTop || 0) + _aVV.height) + 24)) return;
              clearTimeout(_aProofT);
              _aProofT = setTimeout(function () {
                try {
                  if (!_aKb || _aProv || _aClosing) return;
                  if (Date.now() - _aVvChgAt < 400) return;
                  _aKbMute = true; _aVvStale = true;
                  _aKb = false; _aClosing = false;
                  _aPhone.style.height = '';
                  _aPhone.style.alignSelf = '';
                  _aPanComp();
                  kbUndockPanels();
                } catch (e2) {}
              }, 60);
            } catch (e1) {}
          }, { passive: true, capture: true });
        } catch (ePT) {}
        try {
          // keydown 用捕获，输入法组合（keyCode 229）也持续刷新，保证长时间打字不误清除
          document.addEventListener('keydown', _aBump, true);
        } catch (e) {}
        _aVV.addEventListener('resize', syncAndroidKb);
        // FIX 2026-09-14 #479：window.resize 同步桥——窗口级改尺寸（自由小窗/分屏/桌面缩放）
        // 在合规内核走 vv.resize 已覆盖，但存在只发 window.resize 不发 vv.resize 的壳
        // （#479 看门狗兜底注释同款品类）；基线重锚/键盘判定依赖 syncAndroidKb 跑到，
        // 漏拍即退化为 1s 看门狗兜底。resizes-visual 真键盘不缩布局视口=本桥不触发；
        // resizes-content 内核与 vv.resize 双跑到=幂等早退，零行为差异。
        try { window.addEventListener('resize', function () { try { syncAndroidKb(); } catch (eWR) {} }); } catch (eWR2) {}
        // v3.16.x：键盘弹起/收起（vv 高度变化）即重排 .phone 与面板 → 其中的 ce-box
        // 合成层需刷新跟随（见 _aRefreshCe）。与 syncAndroidKb 并行防抖监听，覆盖
        // 半框（问问TA/占卜/page-ta-ask）在键盘会话内重排但 _aPanComp/kbDockPanels
        // 未同步触发的补齐。
        _aVV.addEventListener('resize', _aSchedCe);
        window.addEventListener('resize', _aSchedCe);
        // 首次聚焦兜底：键盘弹出的 resize 偶发前置/漏触发，紧跟一次判定
        document.addEventListener('focusin', function (e) {
          try {
            _aClosing = false; _aVvStale = false; // v3.28.x：聚焦=弹键盘（或保持），退出收起态；#236 解除 vv 残留闩
            if (_aIsText(e.target)) { _aTextFocused = e.target; _aFocusAt = Date.now(); _aBump(); _aPanSeen = 0; } // #267：新键盘会话重新量平移
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
              try { syncAndroidKb(); } catch (e3) {}
              setTimeout(syncAndroidKb, 120);
              setTimeout(syncAndroidKb, 350);
              // v3.16.x：红米 K80 Chrome 首次点击输入栏键盘弹出动画（~300-500ms）期间，
              // vv.resize 在动画早期触发使 .phone 收缩到中间值高度 + _aPinPan 平移归零
              // 跟不上动画帧 → 输入栏行按钮错位、输入栏与键盘间露 body 底色（灰条）。
              // 再点一次时 vv.height 已稳定故正常。此处 focusin 后启动 80ms 高频补偿
              // 持续 ~800ms，每帧 syncAndroidKb+_aPinPan+nudge 跟随动画收敛；850ms 宽限期
              // 内 _aPinPan 即使 _aKb/_aProv 未置位也归零提前平移的视口残留。
              _aBurstUntil = Date.now() + 850;
              var _burstCnt = 0;
              function _burstTick() {
                try { syncAndroidKb(); _aPinPan(); nudgeInputVisible(); } catch (ee) {}
                if (++_burstCnt < 10) setTimeout(_burstTick, 80);
              }
              setTimeout(_burstTick, 40);
              // v3.12.x：悬浮键盘推定停靠复查——950ms（宽限期刚过）与 1700ms 各一次，
              // 即使轮询表因失焦竞态提前停掉，这里也能独立完成保底停靠/清理
              setTimeout(_aProvCheck, 950);
              setTimeout(_aProvCheck, 1700);
              try { startAWatch(); } catch (e4) {}
            }
          } catch (e2) {}
        });
        // 失焦兜底：键盘收起偶发漏 resize，稍作延迟按可视高度复原
        document.addEventListener('focusout', function (e) {
          var _lostText = false;
          try {
            _lostText = _aIsText(e.target);
            if (e.target === _aTextFocused) _aTextFocused = null;
          } catch (e2) {}
          if (_aKb) _aClosing = true; // v3.28.x：键盘开着时失焦=正在收起，标记以跳过逐帧 _aPinPan
          setTimeout(syncAndroidKb, 120);
          setTimeout(syncAndroidKb, 350);
          // v3.12.x：失焦后复查保底停靠——键盘已收/无聚焦即复原 .phone
          setTimeout(_aProvCheck, 250);
          setTimeout(_aProvCheck, 900);
          // 失焦即键盘收起：不依赖 resize（安卓程序化失焦/滑动收起常漏事件），
          // 400ms 后若可视高度已回升（键盘真的收了）才恢复
          setTimeout(function () {
            if (!_aKb) return;
            if (_aVV.height >= _aH - 60) {
              _aKb = false;
              _aClosing = false;
              _aPhone.style.height = '';
              _aPhone.style.alignSelf = '';
              _aPanComp();
              kbUndockPanels();
              return;
            }
            // FIX 2026-09-15 #542：失焦后 vv 读数仍停在键盘态（一批内核收键盘不派
            // visualViewport.resize，只报开启不报关闭）——主链四条复原路都要「vv 回基准」、
            // #267 看门狗又要「2.2s 无任何活动」，用户看到的即「收键盘后回弹很慢、下方
            // 大片灰底」，接着点/滑则更久（红米 K80 Chrome 等多机型，用户明说其他型号也有）。
            // 这里补一条有界快速复原：失焦确来自文本框（_lostText）+ 此刻没有任何文本元素
            // 持活焦点（软键盘必依附聚焦可编辑，无焦点即键盘必已不在场）+ vv 读数已稳
            // ≥350ms（避开收起动画中途误清）→ 判「键盘已收」按 #209/#236 同款动作复原，
            // 并置 _aVvStale 闩抑制残留读数把 .phone 再抽回（下次触摸/聚焦/回基准即解除）。
            // 零机型分支、纯焦点+视口证据；健康内核此刻 vv 已回基准走上面 return，不进这里。
            if (!_lostText) return;
            if (_aIsText(document.activeElement)) return;
            if (!_aVV.height || Date.now() - _aVvChgAt < 350) return;
            _aVvStale = true;
            _aKb = false;
            _aClosing = false;
            _aPhone.style.height = '';
            _aPhone.style.alignSelf = '';
            _aPanComp();
            kbUndockPanels();
          }, 400);
        });
        // v3.14.x：切后台立即清除推顶 + 复位 .phone——键盘必然收了，setInterval 在
        // 后台被节流，切回来才自愈会残留几秒（摩托罗拉G100/雨见切后台再切回来复现）
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState !== 'visible') {
            try {
              _aProvClear();
              if (_aKb) {
                _aKb = false;
                _aClosing = false;
                _aPhone.style.height = '';
                _aPhone.style.alignSelf = '';
                _aPanComp();
                kbUndockPanels();
              }
              _aLastVVH = 0;
            } catch (e2) {}
          }
        });
        // ===== FIX 2026-09-15 #512：程序化「收键盘」请求（外部显式收输入法后的有界兜底） =====
        // 场景（用户报，红米 K80 Chrome，明说其他机型也有）：聊天【问问TA】发送卡片后面板关闭、
        // 输入框失焦，但「输入法位置那半边灰屏一直露着」——即 .phone 内联收缩高停在键盘期数值。
        // 通路：外部（chat.js askDismissIme）先显式 blur 再隐藏面板，blur 会派 focusout，主链路本
        // 应正常复原；但部分内核/输入法在「聚焦元素被隐藏带走」这类收键盘方式下**不派
        // visualViewport.resize**（或迟很多才派），而本分支四条复原路都要「vv 回基准」作证据
        // （syncAndroidKb 的 !open && h≥_aH-12 / focusout 400ms 复查 / 250ms 轮询 /
        // #209/#236 看门狗里那条也要 vv 回基准或缩幅落残留带），全缩幅的真键盘残留只由
        // 「2.2s 无任何活动」那条兜底——用户接着点/滑就一直不满足＝「一直看到半边灰屏」。
        // 本兜底只在【外部主动请求过收键盘】时武装：请求起 800ms 后判定，条件不成立最多再复查 6 次
        //（每次 400ms），整个窗口 3s 到点即彻底放弃＝有界、零常驻成本（没有请求时一个计时器都不挂）：
        //   ① .phone 仍带内联收缩高＝确实还卡着（已清＝主链路复原过，收工）；
        //   ② 此刻没有任何文本元素持有活焦点＝真键盘不可能还在场（软键盘必然依附聚焦可编辑）；
        //   ③ 请求之后没有新的文本聚焦（_aFocusAt 未刷新）＝用户没在别的输入框接着打字；
        //   ④ vv 读数最近 500ms 没变化＝不在收起动画中途（动画每帧都变）。
        // 命中即按「键盘已收」复原（动作与 #209/#236/#267 清扫完全一致），并在读数仍称有键盘时
        // 置 #236 同款 _aVvStale 闩，防残留读数把 .phone 再抽回去；下次触摸/聚焦/回基准即解除。
        // ⚠️ 计时器必须按【每次请求】起：首稿把判定挂在模块初始化的 setTimeout(…, 800) 上，
        // 模块加载时 _aDismissAt 恒为 0 → 800ms 那一拍直接 return，此后永不再进＝整段是死代码
        //（用户报障场景下一点作用都没有）。tools/verify-ask-kb-dismiss.mjs 的 F 组即为此设：
        // 把本函数临时换成空实现时灰底必现（RED）、真实现下 3s 内必复原（GREEN）。
        var _aDismissAt = 0, _aDismissTimer = 0, _aDismissTries = 0;
        function _aDismissCheck() {
          try {
            _aDismissTimer = 0;
            if (!_aDismissAt) return;                                            // 无在途请求
            var _dAge = Date.now() - _aDismissAt;
            if (_dAge < 750) return;                                             // 更晚的请求会另起计时
            if (_dAge > 3000) { _aDismissAt = 0; _aDismissTries = 0; return; }    // 有界窗口到点＝交回正常链路
            var _dRetry = function () {
              _aDismissTries++;
              if (_aDismissTries <= 6 && !_aDismissTimer) _aDismissTimer = setTimeout(_aDismissCheck, 400);
            };
            if (!_aPhone.style.height) { _aDismissAt = 0; _aDismissTries = 0; return; } // 主链路已复原＝收工
            if (_aIsText(document.activeElement)) return _dRetry();              // 有活焦点＝键盘可能真在场
            if (Date.now() - _aFocusAt < 750) return _dRetry();                  // 请求后又有文本聚焦
            if (_aVV && _aVV.height > 0 && _aVV.height < _aH - 60 && Date.now() - _aVvChgAt < 500) return _dRetry(); // 读数仍在变＝动画中
            var _dStillSaysKb = !!(_aVV && _aVV.height > 0 && _aVV.height < _aH - 60);
            _aKb = false; _aClosing = false; _aProvClear();
            if (_dStillSaysKb) _aVvStale = true;
            _aPhone.style.height = '';
            _aPhone.style.alignSelf = '';
            _aPanComp();
            kbUndockPanels();
            window.__mochiKbDismissHealAt = Date.now(); // 诊断留痕（device.js 读）
            _aDismissAt = 0; _aDismissTries = 0;
          } catch (eD) {}
        }
        window.mochiKbDismiss = function () {
          try {
            _aDismissAt = Date.now();
            _aDismissTries = 0;
            if (_aDismissTimer) clearTimeout(_aDismissTimer);
            _aDismissTimer = setTimeout(_aDismissCheck, 800);
          } catch (e) {}
        };
      }
      // ===== FIX 2026-09-07 #236：安卓「浏览器覆盖形态」执行器 =====
      // 此前 covered 形态的执行侧（写 --mochi-safe-top / 挂 mochi-cover-top）整体在
      // isIOS 分支（syncVvFit），安卓永远没人执行：HeyTapBrowser（OPPO K13 Turbo Pro
      // 实报）等安卓壳 viewport-fit=cover 生效、页面画进系统状态栏下方
      //（env(safe-area-inset-top)=40），base.css 后加载的 .statusbar{padding:4px} 压死
      // @media 的 env() 避让（#114 同根因安卓版）→ 桌面状态栏顶位 0 钻进系统状态栏区。
      // 判定器 mochiViewportForm 早已支持（#199 coverBrowser + #236 安扩展 sig.andr），
      // 这里补执行侧：env 探针（按横竖屏缓存，旋转失效）→ 共享判定器 → safeTop>0 写
      // 变量+挂类（base.css html.mochi-cover-top .phone .statusbar 抬升状态栏），否则
      // 摘除。常规安卓浏览器 env=0 → safeTop=0 → 摘除属性，与旧版行为一致；其余消费方
      //（chat-head 等）fallback 本就是 env()，写入同值=零视觉变化。高度侧刻意不动：
      // 浏览器形态布局视口=inner，.phone 贴 inner 不造文档滚动量（#199 同款语义）。
      // #719：e2e 浏览器形态闩——Edge/Android 15+ 页面顶进系统状态栏而 env()=0，
      // 判定器靠「inner 超出整屏 + 缩放渲染」几何签名识别（e2e-browser）；Edge 底部
      // 工具条隐匿瞬间 inner 变大逸出判定带，闩住该形态不掉避让（页面此时仍在系统
      // 状态栏下）。挂 window（__mochiE2eLatch）：_aSyncCoverTop 与 syncSafeBottomA
      // 分处安卓段不同嵌套层，不依赖跨层闭包可见性；置位后仅 orientationchange
      // 重探时自清（旋转几何全变需重新进门）。诊断/verify 可只读探针。
      var _aCoverEnvCache = -1;
      function _aSyncCoverTop() {
        try {
          var _d = document.documentElement;
          var _ih = window.innerHeight || 0;
          var _sh = (window.screen && window.screen.height) || 0;
          if (!_ih || !_sh) return;
          if (_aCoverEnvCache < 0) {
            try {
              var _p = document.createElement('div');
              _p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);';
              document.body.appendChild(_p);
              _aCoverEnvCache = parseFloat(getComputedStyle(_p).paddingTop) || 0;
              document.body.removeChild(_p);
            } catch (e4) { _aCoverEnvCache = 0; }
          }
          // #719：sig 补 innerW/screenW（缩放渲染证据）+ e2eLatch（工具条隐匿不掉避让）；
          // safeTop>0 的写变量+挂类路径复用 #236 原样（base.css html.mochi-cover-top 消费）
          var _fc = window.mochiViewportForm({ standalone: false, envTop: _aCoverEnvCache, innerH: _ih, screenH: _sh, innerW: window.innerWidth || 0, screenW: (window.screen && window.screen.width) || 0, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false, e2eLatch: !!window.__mochiE2eLatch });
          if (_fc.e2eBrowser && !window.__mochiE2eLatch) window.__mochiE2eLatch = true;
          var _st = _fc.safeTop || 0;
          var _px = _st ? _st + 'px' : '';
          if (_d.style.getPropertyValue('--mochi-safe-top') !== _px) {
            if (_px) _d.style.setProperty('--mochi-safe-top', _px);
            else _d.style.removeProperty('--mochi-safe-top');
          }
          if (!!_st !== _d.classList.contains('mochi-cover-top')) _d.classList.toggle('mochi-cover-top', !!_st);
        } catch (e) {}
      }
      try { _aSyncCoverTop(); } catch (e) {}
      try {
        window.addEventListener('resize', _aSyncCoverTop);
        window.addEventListener('orientationchange', function () { _aCoverEnvCache = -1; window.__mochiE2eLatch = false; _aSyncCoverTop(); });
      } catch (e) {}
    } catch (e) {}
  }

  // v3.5.107：滚动穿透锁——全屏/半屏浮层打开时禁止背景滚动（手机端典型问题：
  // 在弹层里滑动，背景页面跟着滚；安卓/iOS 都常见）
  // v3.5.116：补上更多功能面板/搜索/帮我决定/占卜/头像互动/查岗半框；
  // 管理分组弹层（.mg-mask）是动态创建的，用类选择器 + body 观察兜底
  // v3.5.123：补 #modal-mask（通用弹窗）/ #msg-actions（气泡操作菜单）
  // v3.6.x：去掉 #desk-msg——新消息横幅只是顶部 fixed 小提示条（6 秒自动隐藏，
  //   不遮挡滚动区域），把它当浮层锁滚动会让整个页面在横幅弹出的 6 秒内滑不动，
  //   用户感知为「页面卡住/滑动失效」（iPad 夸克反馈）。横幅自身交互由 chat.js 处理。
  // v3.12.x：补三个漏登记浮层（AI-A 全仓浮层清点发现，跨域改动请知悉）——
  //   #img-view-mask 聊天/字卡大图查看全屏遮罩（chatcard.js 动态创建，打开时背景聊天页可继续滚动）；
  //   #chat-rp-panel 红包底部半框、#batch-panel 消息批量操作面板（与 poke-card/emoji-panel 同族底半框）
  // v3.14.x：补 #chat-gdecision-panel 多人决定底部半框（group-decision.js，与帮我决定同族）
  // v3.16.x：补 #gc-msg-actions 群聊气泡操作菜单（与聊天页 #msg-actions 同族，跨域一词登记请知悉）
  // v3.16.x：补 #voice-panel 语音录制半框（聊天设置「我可发送语音」的麦克风按钮打开，跨域一词登记请知悉）
  // #287：补 #gc-poke-card 群聊拍一拍面板（点成员头像拍 TA，与聊天页 #poke-card 同族底半框，跨域一词登记请知悉）
  // #297：补四款小游戏半框（五子棋/连连看/消消乐/心意币拍卖会，同族登记）
  // v3.27.x 壁纸图库批：#cs-bg-panel（聊天壁纸图库）+ #phone-bg-gallery-panel（桌面壁纸图库）
  const FLOAT_SELECTORS = ['#tc-mask', '#cc-export-mask', '#cc-scope-mask', '#call-mask', '#feed-notice-panel', '#feed-comment-panel', '#poke-card', '#gc-poke-card', '#emoji-panel', '#chat-ask-panel', '#qa-mask', '#chat-more-panel', '#gc-more-panel', '#chat-search', '#chat-decision-panel', '#chat-gdecision-panel', '#chat-divine-panel', '#chat-rps-panel', '#chat-call-panel', '#chat-pong-panel', '#chat-snake-panel', '#chat-brick-panel', '#chat-c4-panel', '#chat-ms-panel', '#chat-fish-panel', '#chat-memory-panel', '#chat-gift-panel', '#chat-gomoku-panel', '#chat-linkup-panel', '#chat-match3-panel', '#chat-auction-panel', '#chat-arcade-panel', '#avlib-card', '#ck-panel', '#loc-panel', '.mg-mask', '#modal-mask', '#dl-picker-mask', '#msg-actions', '#gc-msg-actions', '#desk-image-viewer', '.desk-lib', '#gc-members-panel', '#gc-at-panel', '#gc-settings-panel', '#img-view-mask', '#chat-rp-panel', '#batch-panel', '#eat-switch-overlay', '#voice-panel', '#applock-mask', '#cs-bg-panel', '#phone-bg-gallery-panel', '#feed-sticker-card',
    // FIX 2026-09-16 #640：设置 → 工具 →「使用提示」面板（page-coach.js 动态创建的底部半框）——
    // 与 .mg-mask / #beauty-drawer 同族；未登记＝面板打开后底层设置页仍可被滑动，关掉也可能残留滚动锁
    '#pc-sheet-mask',
    // FIX 2026-09-15 #527：边看边调底部抽屉——盖在桌面上的固定层，打开时同样要锁背景滚动
    //（此前未登记，抽屉打开后底层桌面仍可被滑动）
    // FIX 2026-09-17 #660：聊天设置「输入栏按钮位置」排序面板同族（chat-settings.js
    //   openInputOrderPanel 建的整屏遮罩，#cs-bg-panel 同款结构）——未登记＝面板开着时
    //   底层设置页仍可被滑动。单独占一行登记：末行 '  #beauty-drawer', '#icon-fit-panel'];'
    //   整段是 #581f 哨兵的 needle 原文，直接往那行追加会改掉它、把别人的锚点弄哑。
    '#cs-input-order-panel',
    // FIX 2026-09-16 #581：图标图片位置调整面板同族（personalize.js openIconFitPanel 建的固定底半框）
    // FIX 2026-09-18 #707：屏幕位置设置面板（personalize.js 建的底部半框）——同族登记防滚动穿透；
    //   本行插在 #581f 锚点行之前（那行原文一个字都不能动）
    '#screen-adj-panel',
    // FIX 2026-09-18 #760：聊天美化「边看边调」抽屉（chat-settings.js openChatBeautyDrawer）——
    //   与 #beauty-drawer 同族固定底半框（未登记＝抽屉开着底层聊天页整页仍可被滑）。
    //   消息区 #chat-body 自带独立 overflow 滚动 + overscroll-behavior:contain，不受
    //   .page overflow:hidden 影响，锁了仍可滚消息核对效果；键盘抬升走 visualViewport
    //   （见 chat-settings.js #760），故不入 FLOAT_PANEL_SELECTORS（那套 absolute 锚 .phone
    //   贴底，抽屉可拖动后不再是贴底布局元素）。插在 #581f 哨兵原文行之前，末行不动。
    '#chat-beauty-drawer',
    '#beauty-drawer', '#icon-fit-panel'];
  // v3.15.x：键盘弹起时把锚定在 .phone 底部的悬浮面板（更多功能/帮我决定/占卜/
  // 问问TA/红包/拍一拍等）重新锚定到可视区底部=输入栏上方。关键前提：键盘开启时
  // syncAndroidKb / syncIosKb（及各自的推定停靠 _aProvDock / _iProvDock）先把 .phone
  // 收缩到可视高度并顶对齐（alignSelf:flex-start）+ position:relative（_aPanComp），
  // 于是 absolute 锚 .phone 底部（bottom:96px）的面板必然停在输入栏上方、双端通用。
  // v3.18.x 前这里把面板改为 position:fixed（锚可视区底=输入栏上方）；但 K80 Chrome
  // 等内核 fixed 恒锚【布局视口】底——.phone 虽已收缩、fixed 面板却仍停在全页底部
  // =输入法后方，肉眼即「面板被输入法窗口挤压/飞动」。本来的自检（kbDockEnsureVisible）
  // 会把这类面板摘回 absolute，但自检在 250ms 轮询里才有延迟，导致【每次点击输入上
  // 去键盘弹出时面板都先飞再归位】。现直接 absolute 锚收缩后的 .phone，一步到位。
  let kbPanelDocked = false;
  function kbDockPanels() {
    if (kbPanelDocked) return;
    kbPanelDocked = true;
    try {
      document.querySelectorAll(FLOAT_PANEL_SELECTORS.join(',')).forEach(function (el) {
        if (el.hidden || el.getClientRects().length === 0) return;
        if (el.style.position !== 'absolute') el.dataset.kbPrevPos = el.style.position || '';
        el.style.position = 'absolute';
        el.style.left = '18px'; el.style.right = '18px';
        el.style.top = 'auto';
        el.style.bottom = 'calc(96px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)))';
        // v3.25.x：键盘期面板高度上限=「输入栏以上全部空间」（.phone 已收缩为可视高度，
        // 100% 即可视高）。此前面板沿用各自 CSS 的 max-height（如 .poke-card 48%），键盘
        // 弹起后 48% 跟着收缩后的包含块缩水，面板固定行（我的拍一拍 tab 的 tabs+分组+输入
        // footer）比上限还高 → 内容溢出面板底边、输入框被顶到键盘后面 → 浏览器为露焦点
        // 平移视口与 _aPinPan 打架=整页飞（用户报障）。96px 底部锚点 + 8px 顶部缝隙=104。
        el.style.maxHeight = 'calc(100% - 104px)';
      });
      _aSchedCe(); // v3.16.x：面板被 absolute 停靠后，内部 ce-box 合成层需刷新跟随
    } catch (e) {}
  }
  function kbUndockPanels() {
    if (!kbPanelDocked) return;
    kbPanelDocked = false;
    try {
      document.querySelectorAll(FLOAT_PANEL_SELECTORS.join(',')).forEach(function (el) {
        if (el.dataset.kbPrevPos !== undefined) {
          if (el.dataset.kbPrevPos) el.style.position = el.dataset.kbPrevPos;
          else el.style.removeProperty('position');
          delete el.dataset.kbPrevPos;
        }
        // 面板关闭期间恢复：inline bottom/left/right 一并清掉，回到 CSS 锚定
        el.style.removeProperty('bottom');
        el.style.removeProperty('left');
        el.style.removeProperty('right');
        el.style.removeProperty('top');
        el.style.removeProperty('max-height');
      });
    } catch (e) {}
  }
  // 键盘期间「新打开的面板」也会自动停靠（kbDockPanels 只锚定当时可见的面板）
  try {
    document.addEventListener('transitionstart', function () { if (kbPanelDocked) kbDockPanels(); }, true);
  } catch (e) {}
  let locked = false;
  // v3.13.x：手动锁浮层（period.js 弹层动态 append/remove、不走 hidden 属性）——
  // 存在于 DOM 即视为开着，纳入统一判定，防其他浮层变动时误摘经期弹层的锁
  const MANUAL_LOCK_IDS = ['period-day-pop', 'period-care-pop', 'period-report-pop', 'period-settings-pop', 'period-notify-pop'];
  // v3.13.x：浮层「真开着」= 非 hidden 且视觉上有渲染盒子（AI-A 修字卡库全局滑不动）。
  // 只判 hidden 属性会死锁：在聊天页打开更多面板/表情包/拍一拍等底半框后不关闭直接
  // 离开聊天页（返回键/切字卡库都会整页隐藏），面板 hidden=false 但祖先 display:none
  // → 零渲染盒却被当成「开着」→ body.scroll-lock 永久残留，且每次触摸兜底都重新确认
  // 锁 → 所有 .page 页面滑不动（用户感知：字卡库无法滑动、卡顿），只能杀进程。
  function floatIsOpen(el) {
    try {
      if (!el || el.hidden) return false;
      return el.getClientRects().length > 0;
    } catch (e) { return false; }
  }
  function applyLock() {
    let anyOpen = false;
    try {
      anyOpen = FLOAT_SELECTORS.some(function (sel) { return floatIsOpen(document.querySelector(sel)); }) ||
        MANUAL_LOCK_IDS.some(function (id) { return !!document.getElementById(id); });
    } catch (e) { anyOpen = false; }
    if (anyOpen && !locked) {
      document.body.classList.add('scroll-lock');
      locked = true;
    } else if (!anyOpen && locked) {
      document.body.classList.remove('scroll-lock');
      locked = false;
    }
  }
  try {
    const mo = new MutationObserver(applyLock);
    FLOAT_SELECTORS.forEach(function (sel) {
      try {
        const el = document.querySelector(sel);
        if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
      } catch (e) {}
    });
    // 动态创建的 .mg-mask（管理分组弹层）：插入 body 时补观察 hidden + 立即应用锁；
    // v3.12.x：清单内 id 的动态层（如 #img-view-mask 大图遮罩，chatcard.js 首次查看时才创建）
    // 启动时 querySelector 拿不到、观察不到 → 插入 body 时按 id 补观察
    const bodyMo = new MutationObserver(function (muts) {
      let changed = false;
      muts.forEach(function (m) {
        if (!m.addedNodes) return;
        m.addedNodes.forEach(function (n) {
          if (!n || n.nodeType !== 1 || !n.classList) return;
          const isMg = n.classList.contains('mg-mask');
          const inList = !isMg && n.id && FLOAT_SELECTORS.indexOf('#' + n.id) >= 0;
          if (isMg || inList) {
            try { mo.observe(n, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
            changed = true;
          }
        });
      });
      if (changed) applyLock();
    });
    bodyMo.observe(document.body, { childList: true });
  } catch (e) {}
  applyLock();
  // v3.6.x：滚动锁触摸兜底——极端情况下浮层已关闭但锁未解除（iOS Safari 上会
  // 表现为整个页面无法滚动/点击无响应、像"卡死"）。每次触摸时复查一次：
  // 若实际没有任何浮层打开就立即解锁，避免锁残留。
  // v3.26.x：仅「已上锁」时才复查——本兜底的职责是清残留锁；未锁时 applyLock
  // 只可能补挂锁，而补挂有 MutationObserver + 1s 看门狗覆盖。applyLock 要扫
  // 43 个选择器并逐个 getClientRects（强制布局），此前每次 touchstart 全量跑
  // 一遍是 iOS 滑动/打字卡顿的直接来源之一。
  document.addEventListener('touchstart', function () {
    if (!locked) return;
    try { applyLock(); } catch (e) {}
  }, { passive: true });
  // v3.13.x：滚动锁自愈看门狗——触摸兜底之外每秒对账一次（覆盖无触摸场景与
  // 「漏跑关闭路径后再也没有相关 mutation 事件」的残留锁；有浮层视觉可见时同样补挂）
  // v3.26.x：页面不可见（切后台）时跳过——隐藏期没有任何用户可见症状，白跑全量扫描
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    try { applyLock(); } catch (e) {}
  }, 1000);
  // v3.13.x：只读探针（诊断「滑不动」时看哪个浮层挂着锁）window.scrollLockInfo()
  window.scrollLockInfo = function () {
    try {
      const open = [];
      FLOAT_SELECTORS.forEach(function (sel) {
        const el = document.querySelector(sel);
        if (floatIsOpen(el)) open.push(sel);
      });
      MANUAL_LOCK_IDS.forEach(function (id) { if (document.getElementById(id)) open.push('#' + id); });
      return { lock: document.body.classList.contains('scroll-lock'), open: open };
    } catch (e) { return null; }
  };
  // ===== FIX 2026-09-07 #257：整页「点不动」死点击逃生门（行为证据门控，非机型分支） =====
  // 用户报障（小米 MIX 4 / Edge 151「点进聊天页面什么按钮都点不了、退也退不出来」，多机型
  // 同族；#148「页面突然上移什么都点不动」为其一）。用户诊断交互轨迹实锤关键签名：
  // 卡死时段用户疯狂触摸但 click 轨迹整段空白＝「触摸事件活着、点击事件死」。成因族
  // （残留 scroll-lock / 键盘会话 .phone 内联残留 / 焦点被劫持等）在用户重启后取诊断时
  // 现场已洗掉，单根因无法实锤——本门不猜机型不猜成因，只认行为证据：同一位置 3 次
  // 快速轻点（1.6s 窗口、相邻 <650ms、单击 <350ms、位移 <12px）均无任何 click 跟随
  // （点得动的页面点击必然同步派发）＝判「死点击」→ 按证据逐层复位（残留滚动锁 /
  // .phone 键盘期内联 height/alignSelf/top / 失焦）+ toast 播报 + LS 落现场
  // （device.js 诊断读取「卡死逃生记录」，下次报障自带根因证据）。浮层打开期（正在
  // 操作弹层）、键盘会话期（打字/候选）、长按（气泡菜单路径）、滚动手势一律不计数；
  // 能正常点动的设备永不满足全部条件＝零行为变化，iOS/安卓通用。
  var _escState = { streak: 0, key: '', firstAt: 0, lastAt: 0 };
  var _escLastClickAt = 0;
  var _escTap = null;
  var _escHealing = false;
  function _escKbOpen() {
    try {
      if (isIOS) { var f = window.__mochiIosKb && window.__mochiIosKb(); return !!(f && f.kbActive); }
      var a = window.__mochiAndroidKb && window.__mochiAndroidKb();
      return !!(a && (a.kbActive || a.prov));
    } catch (e) { return false; }
  }
  function _escAnyFloatOpen() {
    try {
      for (var i = 0; i < FLOAT_SELECTORS.length; i++) {
        if (floatIsOpen(document.querySelector(FLOAT_SELECTORS[i]))) return true;
      }
      for (var j = 0; j < MANUAL_LOCK_IDS.length; j++) {
        if (document.getElementById(MANUAL_LOCK_IDS[j])) return true;
      }
    } catch (e) {}
    return false;
  }
  function _escTouchDesc(el) {
    try {
      var seg = el && el.tagName ? String(el.tagName).toLowerCase() : '?';
      if (el && el.id) seg += '#' + el.id;
      else if (el && typeof el.className === 'string' && el.className) seg += '.' + el.className.split(/\s+/)[0];
      return seg.slice(0, 40);
    } catch (e) { return '?'; }
  }
  function _escHeal() {
    var tag = [];
    try {
      if (locked || document.body.classList.contains('scroll-lock')) {
        locked = false;
        document.body.classList.remove('scroll-lock');
        tag.push('scroll-lock');
      }
      // .phone 键盘期内联残留（安卓分支状态；iOS 由 healViewport 自治）——只清内联，
      // 不碰 _aKb 等内部态：值交回后安卓 1s 看门狗（#209/#236）按视口证据完成全量复原
      if (!isIOS) {
        var ph = document.querySelector('.phone');
        if (ph) {
          if (ph.style.height) { ph.style.height = ''; tag.push('phone.height'); }
          if (ph.style.alignSelf) { ph.style.alignSelf = ''; tag.push('phone.alignSelf'); }
          if (ph.style.top) { ph.style.removeProperty('top'); tag.push('phone.top'); }
        }
      }
      var ae = document.activeElement;
      if (ae && ae !== document.body && ae.blur) { try { ae.blur(); tag.push('blur'); } catch (e) {} }
    } catch (e) {}
    try { applyLock(); } catch (e) {}
    return tag;
  }
  function _escRecord(streak, tag) {
    try {
      var arr = [];
      try { arr = JSON.parse(localStorage.getItem('xy-home-v2:__diag-stuck') || '[]') || []; } catch (e) { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      arr.push({ t: Date.now(), n: streak, tag: tag.length ? tag.join('+') : '(无残留可清=指向合成层/输入管线)' });
      if (arr.length > 3) arr = arr.slice(-3);
      localStorage.setItem('xy-home-v2:__diag-stuck', JSON.stringify(arr));
    } catch (e) {}
  }
  function _escToast(msg) {
    // 与 device.js 同款 #cc-toast 通道（每个 js 单独 IIFE，拿不到 chat.js 顶层 toast）
    try {
      var t = document.getElementById('cc-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'cc-toast';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.className = 'cc-toast';
      void t.offsetWidth;
      t.className = 'cc-toast show';
      clearTimeout(t._escT);
      t._escT = setTimeout(function () { t.className = 'cc-toast'; }, 3200);
    } catch (e) {}
  }
  function _escJudge(streak, deadline, tapEndAt) {
    if (streak < 3) return;
    setTimeout(function () {
      try {
        if (_escLastClickAt >= tapEndAt) { _escState.streak = 0; return; } // 点击活着=误报退出
        if (_escState.streak < 3 || _escHealing) return;
        _escHealing = true;
        var tag = _escHeal();
        _escState.streak = 0;
        _escRecord(3, tag);
        setTimeout(function () {
          _escToast('检测到页面触控异常，已尝试恢复（' + (tag.length ? tag.join('+') : '无残留') + '）；若仍点不动请重启后在设置-诊断反馈');
          _escHealing = false;
        }, 60);
      } catch (e) {}
    }, Math.max(10, deadline - Date.now()));
  }
  document.addEventListener('touchstart', function (e) {
    try {
      var t = e.touches && e.touches[0];
      if (!t) return;
      _escTap = { x: t.clientX, y: t.clientY, t0: Date.now(), el: e.target };
    } catch (e) {}
  }, { passive: true, capture: true });
  document.addEventListener('touchend', function (e) {
    try {
      if (document.visibilityState !== 'visible') { _escState.streak = 0; return; }
      var tap = _escTap; _escTap = null;
      if (!tap) return;
      var te = e.changedTouches && e.changedTouches[0];
      if (!te) return;
      if (Date.now() - tap.t0 >= 350) return; // 长按（≥350ms=气泡菜单路径）不算轻点
      var dx = te.clientX - tap.x, dy = te.clientY - tap.y;
      if (dx * dx + dy * dy > 144) return;    // 位移 >12px=滚动手势不算
      if (_escAnyFloatOpen()) { _escState.streak = 0; return; } // 弹层操作期不计数
      if (_escKbOpen()) { _escState.streak = 0; return; }       // 键盘会话期不计数
      var now = Date.now();
      var key = _escTouchDesc(tap.el) + '@' + Math.round(te.clientX / 24) + ',' + Math.round(te.clientY / 24);
      if (key !== _escState.key || now - _escState.lastAt > 650) {
        _escState = { streak: 1, key: key, firstAt: now, lastAt: now };
        _escJudge(1, now + 700, now);
        return;
      }
      _escState.streak++;
      _escState.lastAt = now;
      _escJudge(_escState.streak, now + 700, now);
    } catch (e) {}
  }, { passive: true, capture: true });
  document.addEventListener('click', function () {
    _escLastClickAt = Date.now();
    if (_escState.streak > 0) _escState.streak = 0; // 点击正常派发=页面活着，重新计数
  }, { capture: true });
  // 只读探针：诊断/现场采集用（当前命中状态 + 逃生门历史）
  window.__mochiStuckProbe = function () {
    try {
      var open = [];
      FLOAT_SELECTORS.forEach(function (sel) {
        if (floatIsOpen(document.querySelector(sel))) open.push(sel);
      });
      var his = null;
      try { his = JSON.parse(localStorage.getItem('xy-home-v2:__diag-stuck') || 'null'); } catch (e) {}
      return {
        streak: _escState.streak,
        lock: document.body.classList.contains('scroll-lock'),
        openFloats: open,
        kb: _escKbOpen(),
        lastHeal: his
      };
    } catch (e) { return null; }
  };
})();

// ===== v3.26.x #707：屏幕位置微调（设置 → 信息诊断 → 三行手动偏移，用户自调）=====
// 背景（用户直派）：跨设备屏幕适配问题修不完（各内核对 innerHeight/visualViewport/安全区
// 的口径不同且随系统版本漂移，iOS 26 键盘行为即是例证），与其全靠代码猜每台设备，
// 不如给用户一个本机永久的手动微调入口。三轴：顶部避让偏移（--mochi-safe-top）、
// 底部安全区偏移（--mochi-safe-bottom）、页面高度偏移（--mochi-ios-h）。
// 实现：**双层值包装**——包装 documentElement.style 的 set/remove/get，写入方（syncVvFit/
// _aSyncCoverTop 等）照常写「系统基准值」，包装层落 DOM 的恒为「基准+偏移」；写入方的
// getPropertyValue 比较拿到的也是偏移后值，虽然会因基准≠所见而多调一次 setProperty，
// 但 DOM 值不变＝零重排零抖动（setProperty 同值写入对样式无效）。用户改偏移时只重放
// 已缓存基准，立即生效、无需刷新。底部独立处理：iOS 侧没人写 --mochi-safe-bottom
// （回落 env()），偏移≠0 时直接写 calc(env()+偏移)，安卓键盘期「钉 0」路径照旧直写
// （键盘期偏移让位），收键盘后由 1s 复述循环补回。范围 ±80px，存根命名空间 LS
// （跨桌面共用——屏幕是设备属性，不随联系人走）。
(function () {
  var PFX = 'xy-home-v2:';
  var KEYS = { top: 'screen-adj-top', bottom: 'screen-adj-bottom', h: 'screen-adj-h', desk: 'screen-adj-desk', shift: 'screen-adj-shift', text: 'screen-adj-text', side: 'screen-adj-side' };
  // #764 文字大小轴：只叠加在「文字组」字号上（display-tune.css 逐条 calc），范围 0~12px；其余偏移轴维持 ±80
  // #794 左右安全边轴：曲面/瀑布屏内容贴边时两侧同时内收，单向 0~12px（在 .phone 既有 18px 横向内边距上叠加）
  var RANGE = { top: [-80, 80], bottom: [-80, 80], h: [-80, 80], desk: [-60, 60], shift: [-60, 60], text: [0, 12], side: [0, 12] };
  function loadAdj(k) {
    try { var v = parseInt(localStorage.getItem(PFX + KEYS[k]), 10); var rg = RANGE[k] || [-80, 80];
      return (!isNaN(v) && v >= rg[0] && v <= rg[1]) ? v : 0; } catch (e) { return 0; }
  }
  var adj = { top: loadAdj('top'), bottom: loadAdj('bottom'), h: loadAdj('h'), desk: loadAdj('desk'), shift: loadAdj('shift'), text: loadAdj('text'), side: loadAdj('side') };
  var el = document.documentElement;
  var st = el.style;
  var NAMES = { '--mochi-safe-top': 'top', '--mochi-ios-h': 'h' };
  var base = {};           // var 名 -> 系统基准 px（包装层缓存）
  var origSet = st.setProperty.bind(st);
  var origRemove = st.removeProperty.bind(st);
  var origGet = st.getPropertyValue.bind(st);
  function lsSet(k, v) { try { if (v) localStorage.setItem(PFX + KEYS[k], String(v)); else localStorage.removeItem(PFX + KEYS[k]); } catch (e) {} }
  function applyBottom() {
    try {
      // #969：底部补偿的 1s 轮询原为「每秒无条件重写一次 CSS 变量」——写自定义属性会让整棵
      // 样式失效并触发重算/重绘，在长页面上是稳定的每秒开销。改为「当前值已是目标值就不写」
      // （读仍在，保留「被外部 removeProperty 掉后 1s 内补回」的自愈职责不变）。
      const want = adj.bottom ? ('calc(env(safe-area-inset-bottom, 0px) + ' + adj.bottom + 'px)') : '';
      const cur = origGet('--mochi-safe-bottom') || '';
      if (want) { if (cur !== want) origSet('--mochi-safe-bottom', want); }
      else if (cur.indexOf('calc(env(') === 0) origRemove('--mochi-safe-bottom');
    } catch (e) {}
  }
  // #707 桌面图标区轴：独立写 --mochi-desk-adj（home.css 的 #desktop-pages padding-top 消费）——
  // 全屏/全屏页隐藏状态栏后桌面内容整体偏上，用户用该轴自由拉回；无人写基准，直接写偏移值
  function applyDesk() {
    try {
      if (adj.desk) origSet('--mochi-desk-adj', adj.desk + 'px');
      else if (origGet('--mochi-desk-adj')) origRemove('--mochi-desk-adj');
    } catch (e) {}
  }
  // #707 整体位移轴：.phone 相对定位 top 偏移（base.css 消费）——整页上/下移，治「整体位置
  // 偏了导致顶部或底部被遮挡」；正=下移、负=上移。relative 不改文档流、不产生 transform
  // 包含块（技术红线只禁 zoom/scale，位移不缩放无卡顿面）
  function applyShift() {
    try {
      if (adj.shift) origSet('--mochi-shift-adj', adj.shift + 'px');
      else if (origGet('--mochi-shift-adj')) origRemove('--mochi-shift-adj');
    } catch (e) {}
  }
  // #764 文字大小轴：独立写 --mochi-text-adj（display-tune.css 的文字组规则逐条 calc 消费）——
  // 只在气泡/输入框/设置行等可读文案的原字号上叠加 px，不动任何容器尺寸、零 zoom/scale
  function applyText() {
    try {
      if (adj.text) origSet('--mochi-text-adj', adj.text + 'px');
      else if (origGet('--mochi-text-adj')) origRemove('--mochi-text-adj');
    } catch (e) {}
  }
  // #794 左右安全边轴：独立写 --mochi-side-adj（base.css 的 .phone 五个形态块 padding 消费，
  // 叠加在既有 18px 横向内边距上）；无人写基准，直接写偏移值，0=不写（回落默认 18px）
  function applySide() {
    try {
      if (adj.side) origSet('--mochi-side-adj', adj.side + 'px');
      else if (origGet('--mochi-side-adj')) origRemove('--mochi-side-adj');
    } catch (e) {}
  }
  function applyCached() {
    for (var n in base) {
      try { origSet(n, (base[n] + adj[NAMES[n]]) + 'px'); } catch (e) {}
    }
    applyBottom();
    applyDesk();
    applyShift();
    applyText();
    applySide();
  }
  st.setProperty = function (n, v) {
    n = String(n).toLowerCase();
    if (NAMES[n] !== undefined) {
      var b = parseFloat(v); if (isNaN(b)) b = 0;
      base[n] = b;
      v = (b + adj[NAMES[n]]) + 'px';
    }
    return origSet(n, v);
  };
  st.removeProperty = function (n) {
    n = String(n).toLowerCase();
    if (NAMES[n] !== undefined) delete base[n];
    return origRemove(n);
  };
  st.getPropertyValue = function (n) {
    n = String(n).toLowerCase();
    if (NAMES[n] !== undefined && base[n] !== undefined) return (base[n] + adj[NAMES[n]]) + 'px';
    return origGet(n);
  };
  // 底部复述循环：安卓收键盘会 removeProperty 掉我们的 calc 写入，1s 内补回（iOS 侧无人写，幂等）
  setInterval(applyBottom, 1000);
  applyCached();
  // 设置页接线 API（personalize.js 面板用）：读当前偏移 / 设置并立即生效
  window.mochiScreenAdj = {
    all: function () { return { top: adj.top, bottom: adj.bottom, h: adj.h, desk: adj.desk, shift: adj.shift, text: adj.text, side: adj.side }; },
    set: function (k, v) {
      if (!(k in adj)) return false;
      v = parseInt(v, 10);
      var rg = RANGE[k] || [-80, 80];
      if (isNaN(v) || v < rg[0] || v > rg[1]) return false;
      adj[k] = v;
      lsSet(k, v || '');
      applyCached();
      return true;
    }
  };
})();

/* FIX 2026-09-20 #913 手机发烫收口①：页面切后台（document.hidden）全局暂停 CSS 动画——「后台保活」
   用户把页面挂在后台/锁屏过夜时，进行中的无限动画（花园摇曳、房间流星/雨、漂流瓶波浪、音频可视化
   条等）仍按合成器节奏推进＝后台发热/耗电的纯浪费源；音频播放、定时器、保活锚点都不是 CSS 动画，
   不受影响；回前台移除类名即刻恢复，前台观感零变化。CSS 落点在 base.css（body.mochi-bg-pause）。 */
(function () {
  var apply = function () {
    if (!document.body) return;
    document.body.classList.toggle('mochi-bg-pause', !!document.hidden); // #911
  };
  document.addEventListener("visibilitychange", apply);
  if (document.body) apply(); else document.addEventListener("DOMContentLoaded", apply);
})();
