// ===== 功能：聊天设置 =====
// 聊天壁纸、双方气泡颜色/文字颜色、字体大小、气泡框大小（localStorage 持久化）
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  const root = document.documentElement;
  const body = document.getElementById('chat-body');
  if (!body) return;
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  // 壁纸铺满整个聊天页（含顶部栏/输入栏）
  const chatPage = document.getElementById('page-chat');
  // FIX 2026-09-20 #938（红米 K80 Chrome 用户直派「边看边调切换气泡框大小的模式会闪屏」，用户明说多机型同现、
  // 勿机型分支）：实测＝抽屉里一切控件（框大小/字号/透明度/圆角/颜色/发送按钮/壁纸档位）都汇进 applySettings，
  // 而它每次都把 :root 的 16 条内联变量与 #page-chat 的 9 条**原样重写一遍**（CSSOM 钩子逐次比对旧值＝同值白写），
  // 外加对没挂上的类跑 remove。同值写入照样脏化内联 style/class 属性：:root 自定义属性被全站继承＝整篇文档样式
  // 作用域重新解析，#page-chat 又是壁纸层 + 数百条气泡的共同祖先＝一起重算重绘，手机 GPU 重合成期多出一帧空白
  // ＝用户所见的「闪一下」（无头同档重复点击量到 RecalcStyle 3.9ms/次、加样式表拆建后 20ms/次；真机放大数倍）。
  // 修法＝写入前先比对现值，值真变了才写——与本仓库 v3.6.x/#762 壁纸「图没变不重写 backgroundImage」、
  // #923 家族同一口径；值确实变了的路径一字不动，不碰任何机型/内核判断。
  const setVar = (el, name, value) => { if (!el) return; const v = String(value); if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };
  const delVar = (el, name) => { if (el && el.style.getPropertyValue(name) !== '') el.style.removeProperty(name); };
  // FIX 2026-09-18 #762：聊天壁纸「铺满方式」四档全废、连默认档都不再铺满（用户实报），
  // 根治＝把壁纸从「画在 #page-chat 自己身上」改成「画在它的一个常驻子层上」。
  //
  // 为什么必须换掉 #750/#751 那条路：#750 为了「安卓键盘压矮盒子时壁纸不跟着缩」，把
  // background-size 从 CSS 关键字改成**按某个冻结盒折算出的显式像素**（锚盒 + 折算 + 量原图
  // 三件套），#751 又给锚盒加了「键盘闸门 + 双读 settle」。
  // 但那个盒只能靠运行期读数得到，而读数窗口里全是脏值——用本仓库脚本对着 HEAD 产物复跑即实录
  // （MOCHI_ROOT=<HEAD 构建目录> node tools/verify-chat-bg-fill.mjs）：
  //   进聊天即 painted=379x718 而盒是 390x844 ⇒ 上下各露一条页面底色（＝「没有正常铺满」）；
  //   视口涨一次再回落，painted 永久停在 445x844（棘轮残留＝「莫名其妙放大」）；
  //   平铺档折算出 auto ⇒ 2160x4096 的原图在 390 宽屏幕上只露中间一小块（＝「平铺没反应」）。
  // 显式像素只保证盖住「锚定那一刻的盒」，真实盒一大就露底 ⇒ 这不是参数没调好，是这条路本身
  // 要一个「一直变、又必须提前知道」的盒。改法＝让壁纸的盒与页面盒脱钩，尺寸交回浏览器算：
  //   这一层 height:100%，手机端「铺满裁剪」档另加 `min-height:100lvh` 下限（见 chat-main.css）。
  //   lvh 是设备常量（浏览器 UI 全隐时的大视口），键盘弹出（mobile-adapt 把 .phone 内联高压到
  //   visualViewport.height）和地址栏自动收起（dvh 涨落）都改不动它 ⇒ cover 的缩放比恒定：
  //   打字时不缩（#750 的目标）、不会「莫名其妙放大」（#751 的目标）、也不可能露底（本批的目标）；
  //   超出页面盒的那一截由 #page-chat 的 overflow:hidden 裁掉，层顶边固定在页面顶 ⇒ 打字期间
  //   看到的壁纸与打字前逐像素相同。原图尺寸/盒尺寸/键盘探针一律不再需要，相关代码全部删除。
  // 层叠零风险：.page 本身就是 `position:relative; z-index:2`（base.css）＝独立层叠上下文，
  // 子层 z-index:-1 恰好落在「#page-chat 自己的底色之上、气泡与栏位等所有内容之下」，
  // 不需要给任何内容元素补 z-index（补了反而会把 .chat-body 变成新的层叠上下文、
  // 困住内部那些指望与页面外元素比大小的浮层）。
  function csBgLayer() {
    if (!chatPage) return null;
    let l = document.getElementById('cs-bg-layer');
    if (!l) {
      l = document.createElement('div');
      l.id = 'cs-bg-layer';
      // 内联兜底写四长手 + 宽高，不能只靠 CSS 文件的 inset 简写——老内核（Chromium<87 /
      // Safari<14.1）把不认识的属性整条丢弃，空 div 缺 top/left 会塌成 0x0（同 #690a 桌面壁纸层）。
      l.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:none;';
      chatPage.insertBefore(l, chatPage.firstChild);
    }
    return l;
  }
  // 四档 UI 值 → 合法 CSS（#750b 的成果保留：'fill' 不是合法 background-size，当年原样写进
  // style 被内核整条丢弃、计算值回退 auto，是「壁纸只露中间一小块」的第一半根因）。
  function csBgFitCss(fit) {
    if (fit === 'stretch') return '100% 100%';
    // 平铺必须给一个「看得见重复」的尺寸：压缩壁纸通常是 2160x4096 级别，按原图像素平铺
    // （background-size:auto）一屏只露中间一小块，观感与「放大」无异＝用户报的「平铺没反应」。
    // 改按层宽 1/3 起铺、高度保持比例 ⇒ 任何尺寸的图都恒定三列重复。
    if (fit === 'tile') return '33.333% auto';
    if (fit === 'contain') return 'contain';
    return 'cover'; // 'fill' / 未知值 ⇒ 铺满裁剪（#731 设计原意）
  }

  // v3.27.x 聊天壁纸图库的存储小助手（必须放 applySettings 首次调用之前——
  // applySettings 回显图库张数会读 csBgList，放后面会 TDZ 报错）
  const CS_BG_GLIST = 'cs-bg-glist';
  const CS_BG_MAX = 12; // 图库容量上限（每张压缩后可达 MB 级，防无上限堆爆 IDB）
  const csBgList = () => {
    try { const v = JSON.parse(store.get(CS_BG_GLIST) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  };
  const csBgSaveList = (arr) => store.set(CS_BG_GLIST, JSON.stringify(arr));
  // v3.27.x 优化①：active-id——记录图库里哪张是当前生效壁纸，面板高亮/删除判断只看 id，
  // 不再为对比把每张 MB 级全图读进内存（打开 12 张的面板从几十 MB 堆占用降到只解码缩略图）
  const CS_BG_ACTIVE = 'cs-bg-active-id';
  const csBgActiveId = () => store.get(CS_BG_ACTIVE) || '';
  // 对账：cs-bg 有值但 active-id 缺失/失配（升级首次、美化方案直写 cs-bg、清除壁纸）时
  // 读一轮全图找回匹配项；稳态只做 1 次内存读 + 1 次字符串比对（memoryCache 返引用，零拷贝）
  function csBgReconcileActive() {
    const list = csBgList();
    const cur = store.get('cs-bg');
    if (!cur) { if (csBgActiveId()) store.remove(CS_BG_ACTIVE); return ''; }
    const aid = csBgActiveId();
    if (aid && list.indexOf(aid) >= 0 && store.get('cs-bg-item-' + aid) === cur) return aid;
    for (let i = 0; i < list.length; i++) {
      if (store.get('cs-bg-item-' + list[i]) === cur) { store.set(CS_BG_ACTIVE, list[i]); return list[i]; }
    }
    return '';
  }

  const FONT_SIZES = [
    { label: '小', value: '13px' },
    { label: '标准', value: '14px' },
    { label: '大', value: '16px' },
    { label: '特大', value: '18px' }
  ];
  const BUBBLE_SIZES = [
    { label: '紧凑', value: '8px 10px' },
    { label: '标准', value: '11px 14px' },
    { label: '宽松', value: '14px 18px' }
  ];
  // #835：字号与气泡框大小改「滑块＋预设」并禁掉自由输入（openModal 默认带文本框，
  //   这两处历史上没传 noInput＝任意文字直落 cs-font-size / cs-bubble-size，浏览器按
  //   非法 CSS 静默忽略，用户看到「改了没反应」且设置行右侧挂着那串乱码，还会被美化方案带走）。
  //   读数一律走下面两个钳制：脏值（老数据/导入方案里的非法串）回落默认，不再原样写进 CSS 变量。
  const FONT_SIZE_MIN = 11, FONT_SIZE_MAX = 30, FONT_SIZE_DEFAULT = 14;
  function clampFontSize(raw) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, n)) : FONT_SIZE_DEFAULT;
  }
  // 滑块档位＝左右内边距，上下按 0.78 配比跟随（14→11 / 10→8 / 18→14 恰为三档预设值）
  const BUBBLE_LR_MIN = 6, BUBBLE_LR_MAX = 24, BUBBLE_LR_DEFAULT = 14, BUBBLE_PAD_RATIO = 0.78;
  const BUBBLE_PAD_DEFAULT = '11px 14px';
  function normBubblePad(raw) {
    const nums = String(raw === null || raw === undefined ? '' : raw).match(/\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 2) return BUBBLE_PAD_DEFAULT;
    const px = (v) => Math.max(0, Math.min(30, Math.round(Number(v)))) + 'px';
    return px(nums[0]) + ' ' + px(nums[1]);
  }
  function clampBubbleLr(raw) {
    const nums = String(raw === null || raw === undefined ? '' : raw).match(/\d+(?:\.\d+)?/g);
    const n = parseInt(nums && nums.length >= 2 ? nums[1] : raw, 10);
    return Number.isFinite(n) ? Math.max(BUBBLE_LR_MIN, Math.min(BUBBLE_LR_MAX, n)) : BUBBLE_LR_DEFAULT;
  }
  function bubblePadFromLr(lr) { return Math.round(clampBubbleLr(lr) * BUBBLE_PAD_RATIO) + 'px ' + clampBubbleLr(lr) + 'px'; }
  // v3.25.x：聊天气泡边缘（四角圆角大小）
  const BUBBLE_RADII = [
    { label: '小圆角', value: '6px' },
    { label: '标准', value: '12px' },
    { label: '大圆角', value: '18px' },
    { label: '特圆', value: '28px' }
  ];
  const BUBBLE_RADIUS_DEFAULT = '18px';
  // v3.9.x：时间轴样式（默认头像下方，与原实现一致）
  // under-av=头像下方  under-bubble=气泡下方  bubble=时间气泡  float=气泡外侧悬浮
  // center=消息上方居中  divider=时间分隔线（微信式，消息间隔大时插居中胶囊）  hidden=隐藏
  const TIME_STYLES = [
    { label: '头像下方', value: 'under-av' },
    { label: '气泡下方', value: 'under-bubble' },
    { label: '时间气泡', value: 'bubble' },
    { label: '气泡外侧悬浮', value: 'float' },
    { label: '消息上方居中', value: 'center' },
    { label: '时间分隔线', value: 'divider' },
    { label: '隐藏', value: 'hidden' }
  ];

  // v3.11.x：未自定义的配色默认值跟随深浅主题。此前默认色写死浅色（白气泡/黑时间字），
  // 且以 root 内联样式写入——内联优先级高于 dark.css 的 [data-theme] 覆盖，导致
  // 深色模式下联系人气泡纯白、时间戳纯黑看不见。用户自定义过（store 有值）仍优先。
  function themeDefaults() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark
      ? { inBg: '#2a2a2a', inInk: '#f0f0f0', outBg: '#3a3a3a', outInk: '#ffffff', timeInk: '#8a8a8a', sendBg: '#f0f0f0', sendInk: '#111111' }
      : { inBg: '#ffffff', inInk: '#111111', outBg: '#111111', outInk: '#ffffff', timeInk: '#111111', sendBg: '#111111', sendInk: '#ffffff' };
  }
  // v3.26.x：单聊气泡对比度自愈——出站/入站文字色与背景色同色或极低对比（用户误设/导入美化方案）
  // 时注入高优先级覆盖样式强制文字可见。
  // FIX 2026-09-15 #536：自愈只覆盖单聊页（#page-chat）与收藏页（#page-fav）。此前选择器是全局的
  // `.msg-out .msg-bubble.msg-bubble`——群聊页（#page-group-chat）复用同一套 .msg-out/.msg-in/
  // .msg-bubble 类名却有自己的气泡变量，于是单聊配色触发自愈时，群聊「我的气泡」被强制写成
  // 单聊底色的高对比字色：单聊把气泡改成浅色（如 #ffffff）而文字色仍是默认白 → 自愈注入
  // color:#111111，落到群聊默认黑气泡上就是黑字黑底＝「群聊里我发消息整个框变黑看不到字」
  //（用户明说「没有修改过气泡和文字颜色」——他改的是气泡底色，文字色从未动过，故自愈被触发）。
  // 注：群聊曾有的 GC_MIN_CONTRAST 保护已按 #223 用户裁决撤销（群聊所见即所得、不做配色干预），
  // 所以这条全局选择器在群聊侧没有任何兜底，必须靠作用域隔离。
  function _csHexRgb(h) {
    if (!h || typeof h !== 'string') return null;
    var s = h.trim(); if (s.charAt(0) === '#') s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length !== 6) return null;
    var n = parseInt(s, 16); if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function _csRelLum(rgb) {
    if (!rgb) return 0;
    function ch(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
  }
  function _csContrast(c1, c2) {
    var l1 = _csRelLum(_csHexRgb(c1)), l2 = _csRelLum(_csHexRgb(c2));
    if (l1 === 0 && l2 === 0) return 0;
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function _csHiInk(bg) {
    var rgb = _csHexRgb(bg); return (rgb && _csRelLum(rgb) < 0.5) ? '#ffffff' : '#111111';
  }
  function _ensureBubbleContrast() {
    var fix = document.getElementById('cs-contrast-fix'), rules = [];
    var ob = root.style.getPropertyValue('--msg-out-bg') || '#111111';
    var oi = root.style.getPropertyValue('--msg-out-ink') || '#ffffff';
    if (_csContrast(oi, ob) < 1.5) rules.push('#page-chat .msg-out .msg-bubble.msg-bubble,#page-fav .msg-out .msg-bubble.msg-bubble{color:' + _csHiInk(ob) + '!important}');
    var ib = root.style.getPropertyValue('--msg-in-bg') || '#ffffff';
    var ii = root.style.getPropertyValue('--msg-in-ink') || '#111111';
    if (_csContrast(ii, ib) < 1.5) rules.push('#page-chat .msg-in .msg-bubble.msg-bubble,#page-fav .msg-in .msg-bubble.msg-bubble{color:' + _csHiInk(ib) + '!important}');
    if (rules.length) {
      if (!fix) { fix = document.createElement('style'); fix.id = 'cs-contrast-fix'; document.head.appendChild(fix); }
      // #938 同族第三处：这是 head 里的真样式表，同值重写＝全文档样式失效，先比对再写
      const css = rules.join('\n');
      if (fix.textContent !== css) fix.textContent = css;
    } else if (fix) fix.remove();
  }
  const CHAT_SURFACE_SETTINGS = [
    { key: 'cs-head-opacity', label: '顶部栏不透明度', def: 92, max: 100, unit: '%' },
    { key: 'cs-input-opacity', label: '底部输入栏不透明度', def: 92, max: 100, unit: '%' },
    { key: 'cs-bubble-opacity', label: '气泡底色不透明度', def: 100, max: 100, unit: '%' },
    // #708：位置微调改双向——正值保持原方向（顶栏下移/底栏上移），负值反向
    //（顶栏上移/底栏下移）；存值语义不变，旧数据 0~80 的含义原样兼容。
    { key: 'cs-head-inset', label: '顶部栏上下移动', def: 0, max: 80, min: -80, unit: 'px', posHint: '正值下移、负值上移' },
    { key: 'cs-input-inset', label: '底部栏上下移动', def: 0, max: 80, min: -80, unit: 'px', posHint: '正值上移、负值下移' }
  ];
  // #708：统一钳制（位置两项 min=-80 双向；其余项无 min 按 0 起单向上限）
  // #731 聊天壁纸「铺满方式」：把写死的 cover 变成用户可选的一档。
  // 默认档（'fill'）与历史行为逐字一致（background-size:cover + position:center），
  // 未写盘设备零视觉变化；'tile' 是唯一改 background-repeat 的档。
  const CS_BG_FITS = [
    { label: '铺满裁剪', value: 'fill' },
    { label: '完整显示', value: 'contain' },
    { label: '平铺', value: 'tile' },
    { label: '拉伸填满', value: 'stretch' }
  ];
  const CS_BG_FIT_DEFAULT = 'fill';
  const csBgFit = () => {
    const v = store.get('cs-bg-fit');
    return CS_BG_FITS.some(f => f.value === v) ? v : CS_BG_FIT_DEFAULT;
  };
  // #782：壁纸「水平/垂直位置 + 缩放」——与桌面壁纸「壁纸定位与缩放」同一套口径与同一组
  // 语义（位置 0~100% 走 background-position 百分比、50 = 居中；缩放 100 = 交给铺满方式，
  // >100 走 background-size 单值＝按层宽放大）。三个键缺省时逐像素与改造前一致。
  const CS_BG_ADJ = { x: 50, y: 50, s: 100 };
  const CS_BG_ADJ_KEYS = ['cs-bg-pos-x', 'cs-bg-pos-y', 'cs-bg-size'];
  const csBgAdjNum = (raw, def, min, max) => {
    if (raw === null || raw === undefined || raw === '') return def;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
  };
  function csBgAdj() {
    const s = store.get('cs-bg-size');
    return {
      x: csBgAdjNum(store.get('cs-bg-pos-x'), CS_BG_ADJ.x, 0, 100),
      y: csBgAdjNum(store.get('cs-bg-pos-y'), CS_BG_ADJ.y, 0, 100),
      s: (s && s !== 'cover') ? csBgAdjNum(s, CS_BG_ADJ.s, 100, 300) : CS_BG_ADJ.s
    };
  }
  // FIX 2026-09-18 #781：打字时壁纸换一个比例（用户实报「不输入与输入是两个比例」，且明说
  // 全部手机都这样）。#762 的下限是 `min-height:100lvh`——把「壁纸的盒」交给一个视口单位。
  // 但视口单位只在「键盘不动布局视口」的内核里是常量：iOS 添加到桌面后的 standalone、以及
  // 走 resizes-content 的内核会把布局视口整个压矮，于是 vh/lvh/dvh/svh 四者一起缩
  // （真 WebKit 实测：视口 844→470 时四个单位全部读到 470）⇒ 下限跟着塌，壁纸换比例。
  // 同一实测还证明第二半：下限当初只挂在 .cs-bg-fill 上，「完整显示」档在键盘期整图从
  // 390x740 缩到 245x464——用户看到的就是这个。
  // 改法＝不再指望视口单位，自己记住「确实没有键盘时」的页面高，写成 --cs-bg-h 供 CSS 取
  // max（见 chat-main.css 的 #781 块）。零机型分支：判据全是可观测状态（mobile-adapt 有没有
  // 给 .phone 写内联高、有没有文本框在聚焦），不按 UA/内核分叉。
  // 判据＝「键盘余温期内只涨不跌，其余时候跟随当前页面盒」。之所以不是无脑只涨不跌：
  // 实测（verify-chat-bg-fill B5b/B6）视口先长后缩时，永不回落的下限会把壁纸留在放大档
  // （445x844 → 475x900），正是 #751「莫名其妙放大」的老症状。余温期只覆盖键盘那一下：
  // 键盘收起是异步的，focusout 后 320ms 那次采样可能仍读到被压矮的中间态，此时不回落。
  // 宽度一变（旋转 / 改窗口）整桶作废重记，否则横屏会留着竖屏的大下限把图糊成放大。
  const csBgStable = { w: 0, h: 0, kbUntil: 0 };
  const csBgKbWarm = () => { csBgStable.kbUntil = Date.now() + 700; };
  function csBgStableSample() {
    if (!chatPage) return;
    const phoneEl = document.querySelector('.phone');
    if (phoneEl && phoneEl.style.height) { csBgKbWarm(); return; } // mobile-adapt 键盘期内联高＝盒是被压矮的假值
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) { csBgKbWarm(); return; }
    const w = chatPage.clientWidth, h = chatPage.clientHeight;
    if (!w || !h) return; // 聊天页 hidden（display:none）时读到的 0 不算数
    if (window.innerHeight && h > window.innerHeight + 2) return; // 页面盒不可能高于视口＝瞬时脏读数
    if (w !== csBgStable.w) { csBgStable.w = w; csBgStable.h = h; }
    else if (h < csBgStable.h && Date.now() < csBgStable.kbUntil) { /* 余温期：这次不回落 */ }
    else csBgStable.h = h;
    const px = csBgStable.h + 'px';
    if (chatPage.style.getPropertyValue('--cs-bg-h') !== px) chatPage.style.setProperty('--cs-bg-h', px);
  }
  let csBgStableTimer = 0;
  let csBgStableBound = false;
  function csBgStableOnBlur() { csBgKbWarm(); csBgStableLater(); }
  function csBgStableLater() {
    // 事件绑定推迟到首次采样时（而不是模块顶层）：tools/verify-chat-surfaces.mjs 会把本文件
    // 这一段截出来在 node vm 里跑，那里没有 window/document.addEventListener。
    if (!csBgStableBound) {
      csBgStableBound = true;
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
      // 采样时机＝视口会变的几个节点（键盘开/合各触发一次 vv resize）与文本框失焦之后。
      // 刻意不监听 visualViewport 的 scroll：聊天里高频事件，为省一次 clientHeight 读数
      // 把重排拉进滚动路径不值（同 #765 的口径），而滚动本身不改页面盒高。
      window.addEventListener('resize', csBgStableLater);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', csBgStableLater);
      document.addEventListener('focusout', csBgStableOnBlur);
    }
    clearTimeout(csBgStableTimer);
    // 320ms：键盘收起后 mobile-adapt 要清内联高 + 重排，早读会取到中间态
    csBgStableTimer = setTimeout(csBgStableSample, 320);
  }
  // #731 壁纸延伸到顶栏/输入栏：壁纸画在 #page-chat 的边框盒上（含栏位 padding 区），
  // 一直就在栏位底下；看不见是因为栏位自己画了半透明底色（--cs-*-opacity，默认 92%）。
  // 打开＝给两个栏位底色挂上「0 不透明度」的内联变量把底色让开，壁纸自然透上来，
  // 但存量 --cs-head/input-opacity 的自定义值原样保留（关掉即恢复，零数据改动）。
  // 0 是经用户裁决的默认值——本开关默认关。
  function applyChatBarInk() {
    if (!chatPage) return;
    const on = store.get('cs-bg-fullbars') === '1';
    const bars = [['--cs-head-opacity', '--cs-head-opacity-ink'], ['--cs-input-opacity', '--cs-input-opacity-ink']];
    bars.forEach(function (pair) {
      // #938：改走「值变才写」——原来每次 applySettings 都无脑 set/remove 这两条，同值也脏化 #page-chat 的 style
      if (on) setVar(chatPage, pair[1], '0');
      else delVar(chatPage, pair[1]);
    });
  }
  const surfaceClamp = (item, n) => Math.max(item.min != null ? item.min : 0, Math.min(item.max, Math.round(n)));
  // #728：标识 / 时间轴位置偏移的统一钳制 + 解析（±40px 双向，越界/非法一律回 0）
  const OFFSET_MIN = -40, OFFSET_MAX = 40;
  function clampOffset(raw) {
    const n = Number(raw);
    if (raw === null || raw === undefined || String(raw).trim() === '' || !Number.isFinite(n)) return 0;
    return Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, Math.round(n)));
  }
  function surfaceValue(item) {
    const raw = store.get(item.key);
    const n = raw === null || raw === undefined || String(raw).trim() === '' ? item.def : Number(raw);
    return Number.isFinite(n) ? surfaceClamp(item, n) : item.def;
  }
  // #708：带方向箭头的值显示（正负各一箭头，0 显示「0」）
  function surfaceArrow(v, posArrow, negArrow) {
    return v > 0 ? posArrow + v : v < 0 ? negArrow + (-v) : '0';
  }
  // 生效值：让开壁纸时栏位底色为 0，否则取用户存的 --cs-*-opacity（默认 92）
  function barOpacityInk(index) {
    if (store.get('cs-bg-fullbars') === '1') return 0;
    return surfaceValue(CHAT_SURFACE_SETTINGS[index]);
  }
  function applyChatSurfaces(inBg, outBg) {
    if (!chatPage) return;
    const values = CHAT_SURFACE_SETTINGS.map(surfaceValue);
    CHAT_SURFACE_SETTINGS.forEach((item, i) => {
      // #731：栏位不透明度在本元素上真正生效的是「让开壁纸」变量（未开时它就是原值），
      // 逐项变量照旧写出（设置页滑杆与回显共用），只把栏位两项的写入值换成生效值。
      const v = item.key === 'cs-head-opacity' ? barOpacityInk(0)
        : item.key === 'cs-input-opacity' ? barOpacityInk(1) : values[i];
      setVar(chatPage, '--' + item.key, item.unit === '%' ? v / 100 : v + 'px');
    });
    // Keep opaque colors intact for the existing contrast guard; alpha affects only bubble paint.
    [['in', inBg], ['out', outBg]].forEach(([side, color]) => {
      const rgb = _csHexRgb(color);
      setVar(chatPage, '--cs-' + side + '-surface', rgb ? 'rgba(' + rgb.join(',') + ',' + values[2] / 100 + ')' : color);
    });
    const labels = {
      'cs-bar-op-val': '顶 ' + values[0] + '% / 底 ' + values[1] + '%',
      'cs-bubble-op-val': values[2] + '% 不透明',
      'cs-bar-pos-val': '顶 ' + surfaceArrow(values[3], '↓', '↑') + ' / 底 ' + surfaceArrow(values[4], '↑', '↓') + 'px',
      'cs-typing-ink-val': store.get('cs-typing-ink') || '#8a8a8a'
    };
    Object.keys(labels).forEach(id => { const el = document.getElementById(id); if (el && el.textContent !== labels[id]) el.textContent = labels[id]; });
  }
  function applySettings() {
    // 设置页值写入（定义在最前，避免暂时性死区）
    // #938：同值也走一遍「先比对」——textContent 赋值会换掉文本节点，抽屉里点一下要为十来个回显标签
    // 各拆建一次子树；值没变就一个字节都不碰。
    const set = (id, v) => { const el = document.getElementById(id); const s = String(v); if (el && el.textContent !== s) el.textContent = s; };
    const DEF = themeDefaults();
    const inBg = store.get('cs-in-bg') || DEF.inBg;
    const inInk = store.get('cs-in-ink') || DEF.inInk;
    const outBg = store.get('cs-out-bg') || DEF.outBg;
    const outInk = store.get('cs-out-ink') || DEF.outInk;
    const fs = clampFontSize(store.get('cs-font-size')) + 'px';
    const pad = normBubblePad(store.get('cs-bubble-size'));
    setVar(root, '--msg-in-bg', inBg);
    setVar(root, '--msg-in-ink', inInk);
    setVar(root, '--msg-out-bg', outBg);
    setVar(root, '--msg-out-ink', outInk);
    setVar(root, '--chat-font-size', fs);
    setVar(root, '--chat-bubble-pad', pad);
    // 聊天气泡边缘（四角圆角大小）
    const rad = store.get('cs-bubble-radius') || BUBBLE_RADIUS_DEFAULT;
    setVar(root, '--chat-bubble-radius', rad);
    // 时间轴颜色（默认黑/深色模式灰）
    const timeInk = store.get('cs-time-ink') || DEF.timeInk;
    setVar(root, '--msg-time-ink', timeInk);
    // #728：标识 / 时间轴位置微调（自定义气泡 CSS 改了 padding 后硬编码偏移会失真）。
    // 存 raw 数字串，未设置＝写 0px（与「未设置」视觉同值，且 calc 里能直接相加）。
    const markDX = clampOffset(store.get('cs-mark-x'));
    const markDY = clampOffset(store.get('cs-mark-y'));
    setVar(root, '--msg-mark-x', markDX + 'px');
    setVar(root, '--msg-mark-y', markDY + 'px');
    const timeDX = clampOffset(store.get('cs-time-x'));
    const timeDY = clampOffset(store.get('cs-time-y'));
    setVar(root, '--msg-time-dx', timeDX + 'px');
    setVar(root, '--msg-time-dy', timeDY + 'px');
    // 正在输入中颜色（默认灰）
    const typingInk = store.get('cs-typing-ink') || '#8a8a8a';
    setVar(root, '--typing-ink', typingInk);
    // 发送按钮颜色（默认黑/深色模式白）
    const sendBg = store.get('cs-send-bg') || DEF.sendBg;
    setVar(root, '--send-bg', sendBg);
    // 发送按钮文字颜色（默认白/深色模式黑）
    const sendInk = store.get('cs-send-ink') || DEF.sendInk;
    setVar(root, '--send-ink', sendInk);
    // 发送按钮显示/隐藏（默认显示；隐藏后仍可按 Enter 发送）
    const sendShow = store.get('cs-send-show') || 'show';
    const sendBtn = document.getElementById('chat-send');
    if (sendBtn) { const wantDisp = sendShow === 'hide' ? 'none' : ''; if (sendBtn.style.display !== wantDisp) sendBtn.style.display = wantDisp; }
    set('cs-send-bg-val', sendBg === DEF.sendBg ? '默认 ' + DEF.sendBg : sendBg);
    set('cs-send-ink-val', sendInk === DEF.sendInk ? '默认 ' + DEF.sendInk : sendInk);
    // 双方气泡颜色/文字颜色当前值回显（默认值显示「默认 #色值」，让用户知道默认颜色）
    set('cs-out-bg-val', outBg === DEF.outBg ? '默认 ' + DEF.outBg : outBg);
    set('cs-out-ink-val', outInk === DEF.outInk ? '默认 ' + DEF.outInk : outInk);
    set('cs-in-bg-val', inBg === DEF.inBg ? '默认 ' + DEF.inBg : inBg);
    set('cs-in-ink-val', inInk === DEF.inInk ? '默认 ' + DEF.inInk : inInk);
    // 聊天头像形状（circle 圆形 / square 方形）
    const avShape = store.get('cs-av-shape') || 'circle';
    setVar(root, '--msg-av-radius', avShape === 'square' ? '10px' : '50%');
    set('cs-av-shape-val', avShape === 'square' ? '方形' : '圆形');
    // 时间轴样式：body 上挂 cs-time-* 类（CSS 控制布局，消息结构不变），
    // 移除旧类后挂新类——覆盖收藏页（#page-fav 是 body 后代），收藏项无需改动
    const ts = store.get('cs-time-style') || 'under-av';
    const tsLabel = (TIME_STYLES.find(s => s.value === ts) || {}).label || '头像下方';
    // FIX 2026-09-20 #938（红米 K80 Chrome 用户直派「边看边调切换气泡框大小的模式会闪屏，其他设备型号也有出现」；零机型分支）：
    // 原实现每次 applySettings 都无条件对 body 跑 7 次 classList.remove + 1 次 add；无头实测（MutationObserver）
    // 证实哪怕目标类本来就没挂（默认档），点击瞬间 body 的 class 属性仍会落下真实变更记录＝全文档样式失效——
    // 壁纸大层 + 数百条气泡一起重算重绘，手机 GPU 重合成期间多出一帧空白＝用户所见的「闪一下」。
    // 抽屉里气泡框大小/字号/透明度/圆角/颜色/发送按钮/壁纸档位等一切控件都汇进 applySettings，这一记
    // 全局翻动就是整个「边看边调」共同的闪屏根因。修法＝先比对现状与目标（纯 contains 读操作，不弄脏属性），
    // 相等就整段跳过；真换时间轴样式时行为与原实现逐字节相同。
    const wantTimeCls = ts === 'under-av' ? '' : 'cs-time-' + ts;
    let curTimeCls = '';
    for (let ti = 0; ti < TIME_STYLES.length; ti++) {
      const tc = 'cs-time-' + TIME_STYLES[ti].value;
      if (document.body.classList.contains(tc)) { curTimeCls = tc; break; }
    }
    if (curTimeCls !== wantTimeCls) {
      TIME_STYLES.forEach(s => document.body.classList.remove('cs-time-' + s.value));
      if (wantTimeCls) document.body.classList.add(wantTimeCls);
    }
    set('cs-time-style-val', tsLabel);
    // #728：标识 / 时间轴位置微调回显（全 0 显示「默认」）
    const fmtOff = (x, y) => (x === 0 && y === 0) ? '默认' : '左右 ' + x + ' / 上下 ' + y + 'px';
    set('cs-mark-pos-val', fmtOff(markDX, markDY));
    set('cs-time-pos-val', fmtOff(timeDX, timeDY));
    // 聊天壁纸：铺满整个聊天页
    // v3.6.x：值没变时不重写 style——applySettings 在每次进入聊天页时调用，
    // 反复重设 background-image（大图 dataURL）会让浏览器重新解码、触发重绘
    // v3.5.126：去掉 background-attachment:fixed——手机上 fixed 背景相对视口定位，
    // 全屏/输入法/安全区变化时与元素尺寸不一致 → 比例错位、露白；且移动端
    // 对 fixed 背景降采样 → 发糊。聊天页本身 overflow:hidden 不滚动（只有
    // .chat-body 内部滚动），默认 scroll 模式下背景相对 page 本来就是固定的，
    // fixed 纯属多余并引入视口耦合。
    // v3.6.x：存量大图渲染防护——旧版本聊天壁纸压缩失败时回退存过原图（48MP/ProRAW
    // 级别十几 MB），渲染 backgroundImage 会让 iOS Safari 解码卡死（打开页面卡顿点不动）。
    // 正常压缩产物（2160-4096px JPEG 0.85）≤6MB，>6MB 判定为异常存量，清除回默认
    let bg = store.get('cs-bg');
    if (bg && typeof bg === 'string' && bg.length > 6 * 1024 * 1024) {
      try { store.remove('cs-bg'); } catch (e) {}
      bg = null;
    }
    // #731：铺满方式由 cs-bg-fit 决定；#762：写在常驻图层 #cs-bg-layer 上，尺寸交回 CSS 关键字。
    // 改档位时图没变但 size/repeat 必须重写，故只有 backgroundImage 走「值变才写」守卫
    //（大图 dataURL 反复重写会让 iOS Safari 重新解码，同 #147 政策）。
    const bgLayer = csBgLayer();
    if (bg && bgLayer) {
      const fit = csBgFit();
      const adj = csBgAdj();
      const url = 'url("' + bg + '")';
      if (bgLayer.style.backgroundImage !== url) bgLayer.style.backgroundImage = url;
      // #782：缩放 100% ＝「按铺满方式」（CSS 关键字，#762 的口径不变）；拉大后换成单值
      // 百分比（宽按层的 N%、高保比例）＝桌面壁纸同款语义。位置两轴走百分比。
      const szWanted = adj.s === 100 ? csBgFitCss(fit) : adj.s + '%';
      const psWanted = adj.x + '% ' + adj.y + '%';
      if (bgLayer.style.backgroundSize !== szWanted) bgLayer.style.backgroundSize = szWanted;
      const rpWanted = fit === 'tile' ? 'repeat' : 'no-repeat';
      if (bgLayer.style.backgroundRepeat !== rpWanted) bgLayer.style.backgroundRepeat = rpWanted;
      if (bgLayer.style.backgroundPosition !== psWanted) bgLayer.style.backgroundPosition = psWanted;
      if (bgLayer.style.display !== 'block') bgLayer.style.display = 'block';
      // #781：四档共用的下限靠这个类挂（.cs-bg-fill 那条是 #762 的，特异性相同、写在后面才赢）
      chatPage.classList.toggle('cs-bg-on', true);
      // 两条下限分工：下面这条 .cs-bg-fill 是 #762 的（纯视口单位，只有铺满档享受）；
      // #781 的 .cs-bg-on 那条才是四档共用、且取 max(视口单位, --cs-bg-h)（规则都在 chat-main.css）。
      chatPage.classList.toggle('cs-bg-fill', fit === 'fill');
      csBgStableLater();
    } else {
      // #938：本分支每次 applySettings 都跑（＝无壁纸设备点一下抽屉控件也会跑到），原实现的
      // display/backgroundImage 同值重写 + 两记空 remove 每次共脏化 #page-chat 4 个属性＝壁纸层与
      // 数百条气泡的共同祖先整棵重算。全部改成「先比对、真变了才动」。
      if (bgLayer) {
        if (bgLayer.style.display !== 'none') bgLayer.style.display = 'none';
        if (bgLayer.style.backgroundImage) bgLayer.style.backgroundImage = '';
      }
      if (chatPage) {
        if (chatPage.classList.contains('cs-bg-fill')) chatPage.classList.remove('cs-bg-fill');
        if (chatPage.classList.contains('cs-bg-on')) chatPage.classList.remove('cs-bg-on');
        // 清壁纸时把铺满方式残影一并抹掉（含 #750~#756 期间直接写在页面身上的内联样式）
        if (chatPage.style.backgroundImage) {
          chatPage.style.backgroundImage = '';
          chatPage.style.backgroundSize = '';
          chatPage.style.backgroundRepeat = '';
          chatPage.style.backgroundPosition = '';
        }
      }
    }
    set('cs-font-size-val', fs);
    const pn = BUBBLE_SIZES.find(p => p.value === pad);
    set('cs-bubble-size-val', pn ? pn.label : pad);
    const rn = BUBBLE_RADII.find(p => p.value === rad);
    set('cs-bubble-radius-val', rn ? rn.label : (rad === '0px' ? '方形' : rad));
    set('cs-bg-val', bg ? '已设置' : '');
    // v3.27.x：回显带上图库张数（提示图库里有存货，点行可切换）
    try { const gl = csBgList(); if (gl.length) set('cs-bg-val', '已设置 · 库 ' + gl.length + ' 张'); } catch (e) {}
    // #731：铺满方式回显（没壁纸时给「先上传壁纸」的提示，避免用户改了个看不见的档位）
    const fitItem = CS_BG_FITS.filter(f => f.value === csBgFit())[0] || CS_BG_FITS[0];
    set('cs-bg-fit-val', bg ? fitItem.label : '上传壁纸后生效');
    // #782：位置/缩放回显（未动过 = 居中 · 默认）
    {
      const a = csBgAdj();
      set('cs-bg-adjust-val', (a.x === 50 && a.y === 50 && a.s === 100) ? '居中 · 默认'
        : '水平 ' + a.x + '% · 垂直 ' + a.y + '% · 缩放 ' + a.s + '%');
    }
    set('cs-bg-fullbars-val', store.get('cs-bg-fullbars') === '1' ? '开 · 栏位透明' : '关 · 栏位盖住');
    const rm = document.getElementById('cs-bg-remove');
    if (rm) rm.hidden = !bg;
    _ensureBubbleContrast();
    applyChatBarInk();
    applyChatSurfaces(inBg, outBg);
    // #732：滑块值变化时同步刷新「气泡 CSS 强制生效层」——挂在这里是因为所有入口
    // （设置页滑块 / 边看边调抽屉 / 导入美化方案）最终都走 applySettings()，
    // 挂一处即全覆盖，不会漏入口。函数定义在下方 applyCss 段（函数声明提升，此处可调用）。
    try { applyCssEnforce(); } catch (e) {}
  }
  window.applyChatSettings = applySettings;
  window.applyCsCssEnforce = applyCssEnforce; // #732：供抽屉侧滑块即时刷新
  // #762：这里原有的 resize 重跑（#750 为「按新盒高重算冻结尺寸」而加）整块删除——壁纸尺寸
  // 不再由 JS 折算，resize 期重跑 applySettings 只是白白在每次键盘/旋转时重写一遍样式。
  applySettings();
  // v3.11.x：深色/浅色切换时重算默认配色（personalize.js 切换 html data-theme，
  // 这里监听属性变化即时重写内联变量，不用跨模块调用）
  try {
    new MutationObserver(() => { try { applySettings(); } catch (e) {} })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) {}

  // 各设置行
  const row = (id) => document.getElementById(id);
  // ================= 聊天壁纸图库（多张保存 + 点击切换） =================
  // v3.27.x：此前 cs-bg 只有一张，换图必须重新上传旧图即丢。现在图库存多张：
  //   cs-bg-glist = JSON 数组（图库条目 id 列表，小键）；cs-bg-item-<id> = 全图（大键走
  //   idb.js >200KB 只进 IDB 的既有通道）；cs-bg-item-thb-<id> = 240px 缩略图（面板渲染
  //   只解码小图，避免一次打开面板解码 N 张 4MB 原图把低端机拖卡）。当前生效壁纸仍是
  //   cs-bg（聊天页 applySettings / 美化方案导出 / 渲染防护等既有链路零改动）。
  //   旧数据自动迁移：cs-bg 有值而图库为空时，首次打开面板把 cs-bg 收为第 1 张。
  // 240px JPEG 缩略图：面板网格渲染专用（与全图分开存，抽屉/面板只碰小图）
  function csBgMakeThumb(dataUrl, maxSide) {
    return new Promise((resolve) => {
      if (typeof dataUrl !== 'string' || dataUrl.length > 50 * 1024 * 1024) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.8));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  // 压缩：v3.5.126 按设备物理像素定上限——之前固定 900px，
  // 在 2-3x 高分屏（物理宽 1080-1440）铺满时被放大发糊
  function csBgCompress(dataUrl) {
    return new Promise((resolve) => {
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
          resolve(c.toDataURL('image/jpeg', 0.85));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  // 入库一张并设为当前壁纸（上传/迁移共用）；返回 null 表示压缩失败
  async function csBgAdd(dataRaw) {
    const data = await csBgCompress(dataRaw);
    if (!data) return null;
    const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const list = csBgList();
    if (list.length >= CS_BG_MAX) { toast('图库已满（' + CS_BG_MAX + ' 张），请先在列表里删除几张'); return null; }
    list.push(id);
    csBgSaveList(list);
    store.set('cs-bg-item-' + id, data);
    // 缩略图失败不阻塞入库（面板渲染时兜底现生成）
    csBgMakeThumb(data, 240).then(th => { if (th) store.set('cs-bg-item-thb-' + id, th); });
    store.set('cs-bg', data);
    store.set(CS_BG_ACTIVE, id);
    applySettings();
    return id;
  }
  // 持久化多选 input：一次可加多张，逐张按序入库（压缩本身异步，串行防内存叠加）
  // FIX 2026-09-18 #755：由自建 input（offscreen+opacity:0）收编进统一入口 window.mochiFilePick
  // （device.js 常驻 sr-only clip）——opacity:0 的不可见 input 在部分国产内核同样拒绝激活，
  // 与 display:none 同族。回调逻辑（逐张串行入库/面板刷新）一字未动。
  function csBgPickFiles() {
    window.mochiFilePick({
      id: 'dev-cs-bg-pick',
      accept: 'image/*',
      multiple: true,
      onFiles: (fs) => {
        if (!fs.length) return;
        let ok = 0;
        toast('正在处理 ' + fs.length + ' 张图片…');
        let chain = Promise.resolve();
        fs.forEach((f) => {
          chain = chain.then(() => new Promise((res) => {
            const reader = new FileReader();
            reader.onload = () => {
              csBgAdd(reader.result).then((id) => { if (id) ok++; res(); });
            };
            reader.onerror = () => res();
            reader.readAsDataURL(f);
          }));
        });
        chain.then(() => {
          if (ok) { toast('已加入 ' + ok + ' 张壁纸'); }
          if (document.getElementById('cs-bg-panel') && document.getElementById('cs-bg-panel').style.display === 'flex') openCsBgPanel();
        });
      }
    });
  }
  // 壁纸图库面板：缩略图网格（点图切换 / × 删除 + 5 秒内可撤销）+ 多选上传 + 同步到全部联系人
  // 优化①：高亮只看 active-id，渲染不读全图（缩略图缺失时才读对应一张现生成）
  // 优化⑤：删除改为单击即删 + 底部「撤销」条（5 秒后作废），比两击确认更不怕手滑
  function openCsBgPanel() {
    let m = document.getElementById('cs-bg-panel');
    if (!m) {
      m = document.createElement('div'); m.id = 'cs-bg-panel';
      m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
    }
    m.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(90vw,400px);max-height:82vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    const hd = document.createElement('div');
    hd.innerHTML = '<div style="font-size:16px;font-weight:600">聊天壁纸</div><div style="font-size:12px;color:var(--muted,#888);margin-top:4px">可存多张，点缩略图即切换；误删 5 秒内可撤销</div>';
    box.appendChild(hd);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0';
    const cur = store.get('cs-bg') || '';
    const aid = csBgReconcileActive();
    const list = csBgList();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'grid-column:1/-1;font-size:13px;color:var(--muted,#999);text-align:center;padding:24px 0';
      empty.textContent = '图库还是空的，点下方「上传新图」加入';
      grid.appendChild(empty);
    }
    list.forEach((id) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;border:2px solid transparent;cursor:pointer;aspect-ratio:9/16;background:var(--bg-b,#f2f2f2)';
      const thb = store.get('cs-bg-item-thb-' + id);
      const isActive = id === aid;
      if (isActive) cell.style.borderColor = 'var(--btn-bg,#111)';
      const im = document.createElement('img');
      im.alt = '';
      im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      if (thb) { im.src = thb; }
      else {
        // 缩略图缺失（旧迁移/上次生成被打断）：读这一张全图现生成再回填，本次先用小占位
        const full = store.get('cs-bg-item-' + id);
        im.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
        cell.style.background = 'var(--muted,#888)';
        if (full) csBgMakeThumb(full, 240).then((th) => { if (th) { store.set('cs-bg-item-thb-' + id, th); im.src = th; cell.style.background = ''; } });
      }
      cell.appendChild(im);
      cell.addEventListener('click', () => {
        // 只在此刻读被点中的那一张全图（active-id 判断已由对账保证一致）
        const full = store.get('cs-bg-item-' + id);
        if (full) { store.set('cs-bg', full); store.set(CS_BG_ACTIVE, id); applySettings(); toast('已切换壁纸'); m.style.display = 'none'; }
      });
      const del = document.createElement('div');
      del.textContent = '×';
      del.style.cssText = 'position:absolute;top:2px;right:2px;width:20px;height:20px;line-height:18px;text-align:center;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:14px';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const full = store.get('cs-bg-item-' + id);
        const thb2 = store.get('cs-bg-item-thb-' + id);
        const wasActive = id === aid;
        csBgSaveList(csBgList().filter(x => x !== id));
        store.remove('cs-bg-item-' + id);
        store.remove('cs-bg-item-thb-' + id);
        if (wasActive) { store.remove('cs-bg'); applySettings(); }
        // 优化⑤：留底 5 秒，面板底部出「撤销」条；每次删除覆盖上一条留底（只保最近一张）
        if (full) {
          m.__undoItem = { id, full, thb: thb2, wasActive };
          if (m.__undoTimer) clearTimeout(m.__undoTimer);
          m.__undoTimer = setTimeout(() => { m.__undoItem = null; if (m.style.display === 'flex') openCsBgPanel(); }, 5000);
        }
        toast('已删除，5 秒内可撤销');
        openCsBgPanel();
      });
      cell.appendChild(del);
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    // 优化⑤：撤销条——恢复刚删除的那张（含它是否当时正被使用）
    if (m.__undoItem) {
      const strip = document.createElement('div');
      strip.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:var(--bg-b,#f6f6f6);margin-bottom:8px';
      const st = document.createElement('span'); st.style.cssText = 'flex:1;font-size:12px;color:var(--muted,#888)'; st.textContent = '刚删除了 1 张壁纸，可撤销'; strip.appendChild(st);
      const ub = document.createElement('button'); ub.textContent = '撤销'; ub.style.cssText = 'padding:5px 14px;border:none;border-radius:8px;background:var(--ink,#111);color:#fff;font-size:12px;font-weight:600';
      ub.addEventListener('click', () => {
        const u = m.__undoItem;
        m.__undoItem = null;
        if (m.__undoTimer) { clearTimeout(m.__undoTimer); m.__undoTimer = null; }
        if (u && u.full) {
          csBgSaveList(csBgList().concat([u.id]));
          store.set('cs-bg-item-' + u.id, u.full);
          if (u.thb) store.set('cs-bg-item-thb-' + u.id, u.thb);
          if (u.wasActive) { store.set('cs-bg', u.full); store.set(CS_BG_ACTIVE, u.id); applySettings(); }
          toast('已撤销删除');
        }
        openCsBgPanel();
      });
      strip.appendChild(ub);
      box.appendChild(strip);
    }
    const upBtn = document.createElement('button');
    upBtn.textContent = '＋ 上传新图（可多选）';
    upBtn.style.cssText = 'width:100%;padding:11px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600;margin-bottom:8px';
    upBtn.addEventListener('click', () => { try { csBgPickFiles(); } catch (e) { toast('无法打开相册，请重试'); } });
    // FIX 2026-09-21 #1002（第九波续）：聊天壁纸「上传新图」铺「真·可点 input」层——手指物理落在真 input 上，
    // 选择器由浏览器原生默认动作弹出，不再依赖 label 转发 / JS 合成 click / showPicker 任何一条腿。
    // owner 写统一入口那个 input 的 id（点按时才建），选完文件转交它并派发 change ⇒ 逐张入库/面板刷新管线一字未改。
    // 面板每次打开都是新节点，故本处按渲染即铺（幂等，重复调用只补挂）。
    if (window.mochiFilePickSurface) window.mochiFilePickSurface(upBtn, { id: 'cs-bg-up-tap', accept: 'image/*', multiple: true, owner: 'dev-cs-bg-pick' });
    box.appendChild(upBtn);
    if (cur) {
      const rmBtn = document.createElement('button');
      rmBtn.textContent = '清除当前壁纸（图库保留）';
      rmBtn.style.cssText = 'width:100%;padding:10px;border:1px solid rgba(163,45,45,.35);border-radius:10px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d);font-size:13px;margin-bottom:8px';
      rmBtn.addEventListener('click', () => { store.remove('cs-bg'); store.remove(CS_BG_ACTIVE); applySettings(); toast('已清除，图库里的图还在'); openCsBgPanel(); });
      box.appendChild(rmBtn);
    }
    // 优化②：聊天壁纸/图库是 per-联系人独立的——一键同步到其他联系人桌面，
    // 换聊天对象不用逐个重新设壁纸。会覆盖对方现有聊天壁纸，openModal 二次确认。
    if (list.length && window.getContacts && window.xyStore && window.openModal) {
      const syncBtn = document.createElement('button');
      syncBtn.textContent = '把壁纸和图库同步到全部联系人';
      syncBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;margin-bottom:8px';
      syncBtn.addEventListener('click', () => {
        const me = window.getActiveContact ? window.getActiveContact() : 'default';
        const others = window.getContacts().filter(c => c.id && c.id !== me);
        if (!others.length) { toast('现在只有这一个联系人，无需同步'); return; }
        window.openModal('同步到全部联系人', '', (v) => {
          if (v !== '__yes__') return;
          const fullNow = store.get('cs-bg');
          const glist = csBgList();
          const aidNow = csBgActiveId();
          let n = 0;
          others.forEach((c) => {
            try {
              const st = window.xyStore('xy-home-v2:' + c.id);
              glist.forEach((gid) => {
                const f = store.get('cs-bg-item-' + gid); if (f) st.set('cs-bg-item-' + gid, f);
                const t = store.get('cs-bg-item-thb-' + gid); if (t) st.set('cs-bg-item-thb-' + gid, t);
              });
              st.set('cs-bg-glist', JSON.stringify(glist));
              if (aidNow) st.set('cs-bg-active-id', aidNow); else st.remove('cs-bg-active-id');
              if (fullNow) st.set('cs-bg', fullNow); else st.remove('cs-bg');
              n++;
            } catch (e) {}
          });
          toast('已同步到 ' + n + ' 个联系人（切到对应桌面即可看到）');
        }, { noInput: true, pills: [{ label: '确认同步（覆盖对方的聊天壁纸）', value: '__yes__' }, { label: '取消', value: '__no__' }] });
      });
      box.appendChild(syncBtn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555);font-size:13px';
    closeBtn.addEventListener('click', () => { m.style.display = 'none'; });
    box.appendChild(closeBtn);
    m.appendChild(box);
    m.style.display = 'flex';
  }
  // #783：设置页那一行与「边看边调」抽屉里的图库按钮共用同一入口（迁移 + 开面板），两处不分叉
  function csBgOpenGallery() {
    // 旧数据自动迁移：已有单张壁纸但图库为空 → 收进图库成为第 1 张（异步，不挡面板打开）
    if (store.get('cs-bg') && !csBgList().length) {
      const seed = store.get('cs-bg');
      const id = 'g' + Date.now().toString(36);
      csBgSaveList([id]);
      store.set('cs-bg-item-' + id, seed);
      store.set(CS_BG_ACTIVE, id);
      csBgMakeThumb(seed, 240).then(th => { if (th) store.set('cs-bg-item-thb-' + id, th); });
    }
    openCsBgPanel();
  }
  const csBg = row('cs-bg-upload');
  if (csBg) {
    // v3.9.x：红米/真我等 Android Edge 对「点击时动态创建 + 立即 click()」的 file input
    // 会静默忽略（不弹系统选择器）。改为持久化 input（初始化时创建一次、永久挂 body、
    // 移出屏幕、每次复用），与 avatar-lib.js bindPoolUpload 已验证可用套路一致。
    // v3.27.x：入口改为壁纸图库面板（多张保存+点击切换）；上传逻辑挪进面板
    // （#755 起改走统一入口 window.mochiFilePick，常驻 sr-only clip，不再自建 input）。
    csBg.addEventListener('click', csBgOpenGallery);
  }
  const csBgRm = row('cs-bg-remove');
  if (csBgRm) {
    csBgRm.addEventListener('click', () => {
      store.remove('cs-bg');
      try { store.remove(CS_BG_ACTIVE); } catch (e) {}
      applySettings();
    });
  }
  // #731：壁纸铺满方式（四档）
  const csBgFitRow = row('cs-bg-fit');
  if (csBgFitRow) {
    csBgFitRow.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('壁纸铺满方式', '', v => {
        if (!CS_BG_FITS.some(f => f.value === v)) return;
        try { store.set('cs-bg-fit', v); } catch (e) {}
        applySettings();
        if (!store.get('cs-bg')) toast('已记住：上传壁纸后就会按这个方式显示');
      }, {
        noInput: true,
        pill: csBgFit(),
        pills: CS_BG_FITS.map(f => ({ label: f.label, value: f.value }))
      });
    });
  }
  // #782：聊天壁纸「水平/垂直位置 + 缩放」——与桌面壁纸「壁纸定位与缩放」同款三个滑杆。
  // 行由 JS 注入在「壁纸铺满方式」之后（template.html 常有多会话在途，沿用 #636/#691 做法）。
  const setCsBgAdj = (patch) => {
    const cur = csBgAdj();
    const next = {
      x: patch.x == null ? cur.x : csBgAdjNum(patch.x, CS_BG_ADJ.x, 0, 100),
      y: patch.y == null ? cur.y : csBgAdjNum(patch.y, CS_BG_ADJ.y, 0, 100),
      s: patch.s == null ? cur.s : csBgAdjNum(patch.s, CS_BG_ADJ.s, 100, 300)
    };
    try {
      // 默认值一律不写盘（删键）——「没动过」与「动回默认」在数据上同形，方案/备份不留噪音
      if (next.x === CS_BG_ADJ.x) store.remove('cs-bg-pos-x'); else store.set('cs-bg-pos-x', String(next.x));
      if (next.y === CS_BG_ADJ.y) store.remove('cs-bg-pos-y'); else store.set('cs-bg-pos-y', String(next.y));
      if (next.s === CS_BG_ADJ.s) store.remove('cs-bg-size'); else store.set('cs-bg-size', String(next.s));
    } catch (e) {}
    applySettings();
    return next;
  };
  const openCsBgAdjPanel = () => {
    if (!store.get('cs-bg')) { toast('先上传聊天壁纸，再调它的位置与缩放'); return; }
    let m = document.getElementById('cs-bg-adj-panel');
    if (!m) {
      m = document.createElement('div');
      m.id = 'cs-bg-adj-panel';
      m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
      m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
      document.body.appendChild(m);
    }
    const a = csBgAdj();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:min(86vw,360px);background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
    const hd = document.createElement('div');
    hd.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:12px';
    hd.textContent = '壁纸位置与缩放';
    wrap.appendChild(hd);
    const mkAdjSlider = (label, val, min, max, step, on) => {
      const r = document.createElement('div');
      r.style.cssText = 'margin-bottom:12px';
      const lb = document.createElement('div');
      lb.style.cssText = 'font-size:12px;color:var(--muted,#888);margin-bottom:4px';
      lb.textContent = label;
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;align-items:center';
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step || 1; inp.value = val;
      inp.style.cssText = 'flex:1;min-width:0';
      const vv = document.createElement('span');
      vv.style.cssText = 'font-size:11px;color:var(--muted,#999);margin-left:6px;flex:none;width:44px;text-align:right';
      vv.textContent = val + '%';
      inp.addEventListener('input', () => { vv.textContent = inp.value + '%'; on(parseInt(inp.value, 10)); });
      line.appendChild(inp); line.appendChild(vv);
      r.appendChild(lb); r.appendChild(line);
      return r;
    };
    wrap.appendChild(mkAdjSlider('水平位置', a.x, 0, 100, 1, (v) => setCsBgAdj({ x: v })));
    wrap.appendChild(mkAdjSlider('垂直位置', a.y, 0, 100, 1, (v) => setCsBgAdj({ y: v })));
    wrap.appendChild(mkAdjSlider('缩放', a.s, 100, 300, 5, (v) => setCsBgAdj({ s: v })));
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11.5px;color:var(--muted,#888);line-height:1.5;margin:2px 0 10px';
    note.textContent = '值越大＝看图片越靠右/越靠下的一段；缩放 100% 就是上面的「铺满方式」，拉大后再拖位置。想边看边调：在聊天页拉开美化抽屉的「栏位」区。';
    wrap.appendChild(note);
    const act = document.createElement('div');
    act.style.cssText = 'display:flex;gap:8px';
    const reset = document.createElement('button');
    reset.textContent = '重置';
    reset.style.cssText = 'flex:1;padding:9px;border:1px solid var(--card-border,#eee);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)';
    reset.addEventListener('click', () => {
      try { CS_BG_ADJ_KEYS.forEach((k) => store.remove(k)); } catch (e) {}
      applySettings();
      m.style.display = 'none';
      toast('已重置为居中铺满');
    });
    const okBtn = document.createElement('button');
    okBtn.textContent = '完成';
    okBtn.style.cssText = 'flex:1;padding:9px;border:none;border-radius:9px;background:var(--ink,#111);color:#fff';
    okBtn.addEventListener('click', () => { m.style.display = 'none'; toast('已应用'); });
    act.appendChild(reset); act.appendChild(okBtn);
    wrap.appendChild(act);
    m.innerHTML = '';
    m.appendChild(wrap);
    m.style.display = 'flex';
  };
  {
    const fitRow = row('cs-bg-fit');
    if (fitRow && fitRow.parentNode && !document.getElementById('cs-bg-adjust')) {
      const adjRow = document.createElement('div');
      adjRow.className = 'set-row';
      adjRow.id = 'cs-bg-adjust';
      adjRow.innerHTML = '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18" opacity=".55"/><circle cx="12" cy="12" r="3"/></svg></div>'
        + '<div class="txt">壁纸位置与缩放<span class="sub">水平 / 垂直位置（50 = 居中）与缩放比例，仅对上传的壁纸生效</span></div>'
        + '<div class="val" id="cs-bg-adjust-val">居中 · 默认</div>';
      adjRow.addEventListener('click', openCsBgAdjPanel);
      fitRow.parentNode.insertBefore(adjRow, fitRow.nextSibling);
    }
  }
  // #731：壁纸延伸到顶栏/输入栏（默认关——0 是用户裁决的默认值）
  const csBgFullbarsRow = row('cs-bg-fullbars');
  if (csBgFullbarsRow) {
    csBgFullbarsRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const on = store.get('cs-bg-fullbars') === '1';
      window.openModal('壁纸延伸到顶栏 / 输入栏', '', v => {
        if (v !== 'on' && v !== 'off') return;
        try { store.set('cs-bg-fullbars', v === 'on' ? '1' : '0'); } catch (e) {}
        applySettings();
        toast(v === 'on' ? '已让开栏位底色：壁纸一直铺到屏幕上下边缘' : '已恢复：顶栏与输入栏照旧盖住壁纸');
      }, {
        noInput: true,
        pill: on ? 'on' : 'off',
        pills: [{ label: '开 · 让开栏位底色', value: 'on' }, { label: '关 · 保持默认', value: 'off' }]
      });
    });
  }

  const csAvShape = row('cs-av-shape');
  if (csAvShape) {
    csAvShape.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('聊天头像形状', '', (v) => { store.set('cs-av-shape', v); applySettings(); }, {
        pills: [
          { label: '圆形', value: 'circle' },
          { label: '方形', value: 'square' }
        ],
        pill: store.get('cs-av-shape') || 'circle',
        noInput: true
      });
    });
  }
  // v3.9.x：时间轴样式（胶囊选择，即时生效——body 上的类驱动布局，无消息重渲染）
  const csTimeStyle = row('cs-time-style');
  if (csTimeStyle) {
    csTimeStyle.addEventListener('click', () => {
      if (!window.openModal) return;
      const cur = store.get('cs-time-style') || 'under-av';
      window.openModal('时间轴样式', '', (v) => {
        store.set('cs-time-style', v);
        applySettings();
        // v3.9.x：divider（时间分隔线）需要重渲染补插分隔条，其余样式纯 CSS 即时生效
        //（divider 有 DOM 插入逻辑，不能像其它样式那样只切 body 类；聊天页已渲染时立即重渲染）
        if (v === 'divider' && window.chatReRenderTime) { try { window.chatReRenderTime(); } catch (e) {} }
      }, {
        pills: TIME_STYLES,
        pill: cur,
        noInput: true
      });
    });
  }
  // #728：标识 / 时间轴位置微调（两行共用一套弹窗逻辑：左右 + 上下两个方向）
  // 与顶栏/底栏位置同理，只是这两个是「气泡 CSS 改了尺寸后的补偿偏移」。
  // 弹窗用 noInput 的 pills 无法表达连续值，这里走 openModal + 两步输入：
  // 先用 pills 选方向组，再用手输数值——但两步弹窗体验差，改为**点行直接开「边看边调」抽屉的微调分区**
  // （可拖着看效果），同时保持「数值可精确输入」：抽屉里 4 个滑块旁的数值可读，
  // 精确输入走长按/双击行时的 openModal（下面实现）。
  const csPosRow = (rowId, valId, label, xKey, yKey) => {
    const el = row(rowId);
    if (!el) return;
    el.addEventListener('click', () => {
      if (!window.openModal) return;
      const curX = clampOffset(store.get(xKey)), curY = clampOffset(store.get(yKey));
      const show = () => (curX === 0 && curY === 0) ? '默认（0, 0）' : '左右 ' + curX + 'px / 上下 ' + curY + 'px';
      window.openModal(label + '（' + show() + '）', '', (v) => {
        // 支持「8,4」「8 4」两种写法：第一个数左右、第二个数上下；只填一个＝只改左右
        const parts = String(v == null ? '' : v).split(/[\s,，/]+/).filter(s => s !== '');
        if (!parts.length) return;
        const nx = clampOffset(parts[0]);
        const ny = parts.length > 1 ? clampOffset(parts[1]) : clampOffset(store.get(yKey));
        try { store.set(xKey, String(nx)); store.set(yKey, String(ny)); } catch (e) {}
        applySettings();
        toast(label + '已保存：左右 ' + nx + 'px / 上下 ' + ny + 'px');
      }, { placeholder: '左右,上下  例：8,-4（0 = 默认位置）' });
    });
  };
  csPosRow('cs-mark-pos', 'cs-mark-pos-val', '主动发送标识位置', 'cs-mark-x', 'cs-mark-y');
  csPosRow('cs-time-pos', 'cs-time-pos-val', '时间轴位置', 'cs-time-x', 'cs-time-y');
  // ================= 聊天专用昵称/头像（与桌面独立） =================
  // v3.8.x：聊天设置里编辑的昵称/头像只存 cs-lbl-*/cs-avatar-* 键，聊天页只读这套键；
  // 桌面 deco-widget 的 lbl-*/avatar-* 完全独立。未设时聊天页显示默认占位（TA/我 + 人形图标）。
  // v3.9.x：聊天昵称/头像未单独设置时**跟随桌面**（聊天页回退读桌面键）——设置后聊天域
  // 全部显示聊天专用值；设置页未设时右侧提示「跟随桌面（xx）」，明确当前生效来源。
  // 头像压缩与桌面 bindAvatar 一致（256px JPEG 0.85），内联实现避免依赖 personalize.js 导出。
  function compressHead(dataUrl, maxSide) {
    return new Promise((resolve) => {
      // v3.26.x：放宽 dataURL 上限 8MB→50MB、移除原图总像素上限（原 2600万像素把
      // 4800/5000 万像素手机主摄原图误拒 → 头像选完不生效，而同文件聊天背景上传无此
      // 限制能传）。drawImage 缩放到 maxSide 小 canvas 不会 OOM，try-catch + onerror 兜底。
      if (typeof dataUrl === 'string' && dataUrl.length > 50 * 1024 * 1024) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        try {
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
    });
  }
  // v3.9.x：红米/真我等 Android Edge 对「点击时动态创建 + 立即 click()」的 file input
  // 会静默忽略（不弹系统选择器）。改为持久化 input：初始化时创建一次、永久挂 body、
  // 移出屏幕、每次复用（先清 value 再 click）——与 avatar-lib.js bindPoolUpload
  // 已验证可用套路一致。两个头像按钮（联系人/我的）共用这一个 input，靠回调区分。
  let headCb = null;
  const headInput = document.createElement('input');
  headInput.type = 'file'; headInput.accept = 'image/*';
  headInput.id = 'cs-head-pick';
  // FIX 2026-09-18 #738：offscreen+opacity:0 换标准 sr-only clip 写法；原生 label 兜底
  // 见 device.js mochiFilePickLabel（小米浏览器对 JS 合成 click 静默不弹选择器，#717 后小米17 Pro 实报）。
  headInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
  document.body.appendChild(headInput);
  // v8.29 #991（第九波）：选图后的处理抽成公共函数——sr-only input（老路径）与铺在两行头像上的
  // 真 input（surface，新路径）共用同一条压缩/武装回调管线，两条来源不会各自走偏。
  function headPickFile(f) {
    if (!f) return;
    const cb = headCb; headCb = null;
    const reader = new FileReader();
    reader.onload = () => {
      compressHead(reader.result, 256).then(data => {
        if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
        if (cb) cb(data);
      });
    };
    reader.readAsDataURL(f);
  }
  headInput.onchange = () => {
    const f = headInput.files && headInput.files[0];
    headInput.value = ''; // 允许重选同一文件
    headPickFile(f);
  };
  // FIX 2026-09-19 #813（iPhone 16 Pro + Safari 实报「头像上传无反应，一直是默认头像」，用户明说
  // 其他设备型号也有）：**武装回调与激活选择器必须拆成两步，且武装在前**。原实现把
  // `pickHead(cb)`（＝arm + click）整个塞进 mochiFilePickGuard 的 onMiss 兜底里，而 onMiss 只在
  // 「窗口期内没观察到选择器弹出」时才执行——label 原生转发成功的内核（WebKit/Blink＝iOS Safari、
  // Chrome、Edge、安卓 Chrome 系，即绝大多数设备）会派发 input click ⇒ guard 判定「已弹出」
  // ⇒ onMiss 不跑 ⇒ headCb 恒为 null ⇒ 相册开了、图也选了，change 里 `if (cb) cb(data)`
  // 静默什么都不做＝用户看到的「上传无反应」。只有在国产内核（label 不转发）上兜底才跑、才「恰好能用」，
  // 这正是本族「按机型时好时坏、反复回归」的形状（#756 在 personalize.js 桌面头像同一处已治过，
  // 这两个入口当时漏了）。零机型分支：两条激活路径都保留，只是「状态武装」不再挂在其中任何一条上。
  function armHead(cb) { headCb = cb; }
  function headActivate() {
    // FIX 2026-09-20 #877（小米14 Edge 实报「更换联系人头像/我的头像点击无反应」，用户明说其他
    // 设备型号也有；#677/#717/#738/#753/#755/#756/#813 同族第七波）：兜底腿从「裸 click()」
    // 升级为「showPicker() → click() → 可诊断 toast」三级。根因：激活链一直只有两条腿——
    // ①原生 label 转发（多数内核走这条）；②JS 合成 click() 兜底。#738 已实锤小米系对 JS 合成
    // click 静默不弹（不报错、不弹窗）；一旦某内核两条腿同时失效（label 不转发＋click 被无视），
    // 就彻底无声——tools/probe-877-thirdleg.mjs 在 HEAD 上已复现：chooser=0、零异常、零提示，
    // 兜底确实执行（jsClickNoop 计数）但被内核吞掉＝用户看到的「点击无反应」。
    // showPicker() 是标准 API（Chromium 99+/Edge 99+/Safari 16.3+），在用户手势窗口内直接弹
    // 系统选择器，既不依赖 label 转发、也不走 legacy click 的合成事件路径——第三条腿补上后，
    // 无声只剩「连 showPicker 都拒」一种内核形态，此时 toast 给出可反馈的现场（不再无声）。
    // 零机型分支：三条腿对所有内核统一按序尝试；guard 信号窗（focus/click/change 任一即落定）
    // 保证 label 转发正常的内核绝不会走到兜底＝不双开；showPicker 与 click **顺序都走**——规范里
    // 两条路汇入同一「show the picker」算法（选择器已开即空操作）＝不双开，且避开「showPicker
    // 调用成功但内核不给可观测 chooser/信号」的形态把 legacy click 短路掉（Playwright WebKit 实测）。
    var _fb = function () {
      var opened = false;
      try { headInput.showPicker(); opened = true; } catch (e) {}
      try { headInput.click(); opened = true; } catch (e) {}
      if (!opened) { headCb = null; toast('相册没能打开：请换系统浏览器或 Chrome 打开再试，仍不行请截图本提示反馈（头像#877）'); }
    };
    if (window.mochiFilePickGuard) window.mochiFilePickGuard(headInput, _fb);
    else _fb();
  }
  function applyProfile() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    // v3.26.x：聊天昵称与桌面解耦（用户要求不再跟随桌面）——未设置时显示默认占位提示，
    // 不再显示「跟随桌面（xx）」，也不回退读桌面 lbl-partner/lbl-user
    const lp = store.get('cs-lbl-partner');
    // FIX 2026-09-18 #775h：未单独设置聊天昵称时，聊天里实际显示的是「联系人名片名」（顶栏
    // 一直在用这条链），提示文案照旧写死「默认 TA」会让用户以为设置行和顶栏不是同一个名字
    set('cs-lbl-partner-val', lp || ('未设置（当前显示「' + (window.chatPartnerName ? window.chatPartnerName() : 'TA') + '」）'));
    const lu = store.get('cs-lbl-user');
    set('cs-lbl-user-val', lu || '未设置（默认 我）');
    const ap = store.get('cs-avatar-partner');
    set('cs-avatar-partner-val', ap ? '已设置' : '');
    const ar = document.getElementById('cs-avatar-partner-remove');
    if (ar) ar.hidden = !ap;
    const au = store.get('cs-avatar-user');
    set('cs-avatar-user-val', au ? '已设置' : '');
    const aur = document.getElementById('cs-avatar-user-remove');
    if (aur) aur.hidden = !au;
  }
  applyProfile();
  const csLp = row('cs-lbl-partner');
  if (csLp) {
    csLp.addEventListener('click', () => {
      if (!window.openModal) return;
      const cur = store.get('cs-lbl-partner') || '';
      window.openModal('联系人昵称', cur, (v) => {
        const val = (v || '').trim();
        // v3.25.x：有效昵称变化时触发系统消息昵称清扫（chat.js），历史系统消息称呼跟随
        // v3.26.x：与桌面解耦后有效昵称基线只看 cs-lbl-partner（默认 TA），不再掺入桌面键
        // FIX 2026-09-18 #775e：基线改用聊天里实际显示的旧名（chatPartnerName 现含
        // 「联系人名片名」回退环）——只按 cs-lbl-partner 取旧名时，「从未设过聊天昵称、
        // 只在联系人管理里改过名」的用户屏上旧名是名片名，清扫却拿 'TA' 去扫＝旧名扫不掉。
        const oldEff = window.chatPartnerName ? window.chatPartnerName() : (store.get('cs-lbl-partner') || 'TA');
        if (val) store.set('cs-lbl-partner', val); else store.remove('cs-lbl-partner');
        if (oldEff !== (window.chatPartnerName ? window.chatPartnerName() : (val || 'TA'))) {
          try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff); } catch (e) {}
        }
        applyProfile();
        try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
      }, { maxlength: 30 });
    });
  }
  const csLu = row('cs-lbl-user');
  if (csLu) {
    csLu.addEventListener('click', () => {
      if (!window.openModal) return;
      const cur = store.get('cs-lbl-user') || '';
      window.openModal('我的昵称', cur, (v) => {
        const val = (v || '').trim();
        // FIX 2026-09-18 #775c：此前这条只写键、不走改名钩子——「我的昵称」在聊天设置里
        // 改了，聊天里已发出的拍一拍仍是旧名（联系人那一行有 chatSysNickChanged，这一行
        // 没有对应的 {me} 侧），与用户报障「给我和联系人都换了昵称，拍一拍没变」同病。
        const oldEff = store.get('cs-lbl-user') || '我';
        if (val) store.set('cs-lbl-user', val); else store.remove('cs-lbl-user');
        if (oldEff !== (val || '我')) {
          try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff, 'me'); } catch (e) {}
        }
        applyProfile();
      }, { maxlength: 30 });
    });
  }
  const csAp = row('cs-avatar-partner');
  if (csAp) {
    if (window.mochiFilePickLabel) window.mochiFilePickLabel(csAp, headInput);
    // FIX 2026-09-21 #991（第九波）：在这一行上铺一层真·可点 file input——手指物理落在 input 上，
    // 浏览器按原生默认动作弹相册，不再依赖 label 转发 / JS 合成 click / showPicker 任何一条腿。
    // 点击仍会冒泡到本行的 click 处理器（先 armHead 武装回调，再由 guard 探测到 surface 点按而让路，
    // 不会在两个 input 上各弹一次）。压缩/回显管线（headPickFile → store.set → applyProfile）原样复用。
    if (window.mochiFilePickSurface) {
      window.mochiFilePickSurface(csAp, {
        id: 'cs-avatar-partner-tap', accept: 'image/*',
        onFiles: (files) => { headPickFile(files && files[0]); }
      });
    }
    csAp.addEventListener('click', () => {
      // FIX 2026-09-19 #813：先武装回调、再激活（原 _fb 内才 arm＝label 转发成功的内核永远拿不到回调）
      armHead((data) => {
        store.set('cs-avatar-partner', data);
        applyProfile();
        try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
      });
      headActivate();
    });
  }
  const csApRm = row('cs-avatar-partner-remove');
  if (csApRm) {
    csApRm.addEventListener('click', () => {
      store.remove('cs-avatar-partner');
      applyProfile();
      try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
    });
  }
  const csAu = row('cs-avatar-user');
  if (csAu) {
    if (window.mochiFilePickLabel) window.mochiFilePickLabel(csAu, headInput);
    // FIX 2026-09-21 #991（第九波）：同 csAp——本行铺「真·可点 input」surface 层
    if (window.mochiFilePickSurface) {
      window.mochiFilePickSurface(csAu, {
        id: 'cs-avatar-user-tap', accept: 'image/*',
        onFiles: (files) => { headPickFile(files && files[0]); }
      });
    }
    csAu.addEventListener('click', () => {
      // FIX 2026-09-19 #813：同 csAp——先武装再激活
      armHead((data) => {
        store.set('cs-avatar-user', data);
        applyProfile();
        try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
      });
      headActivate();
    });
  }
  const csAuRm = row('cs-avatar-user-remove');
  if (csAuRm) {
    csAuRm.addEventListener('click', () => {
      store.remove('cs-avatar-user');
      applyProfile();
      try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
    });
  }
  // ================= 双方气泡颜色 / 文字颜色 =================
  // 色板：气泡底色与文字色（v3.6.x：新增颜色设置入口，走 openModal 色板）
  const BUBBLE_BG_COLORS = [
    { color: '#111111', label: '默认黑' },
    { color: '#ffffff', label: '白色' },
    { color: '#3a3a3a', label: '炭灰' },
    { color: '#ffd6e0', label: '樱花粉' },
    { color: '#d6e4ff', label: '雾霭蓝' },
    { color: '#d8f5e0', label: '薄荷绿' },
    { color: '#fff3d6', label: '奶油黄' },
    { color: '#e8dcff', label: '淡紫' },
    { color: '#ffdcc0', label: '暖橘' }
  ];
  const BUBBLE_INK_COLORS = [
    { color: '#111111', label: '默认黑' },
    { color: '#ffffff', label: '白色' },
    { color: '#444444', label: '深灰' },
    { color: '#d6336c', label: '玫红' },
    { color: '#1a56db', label: '蓝' },
    { color: '#1e8e5a', label: '绿' },
    { color: '#9a6b00', label: '黄褐' },
    { color: '#7048e8', label: '紫' },
    { color: '#b3540a', label: '橘' }
  ];
  // 发送按钮背景色板（含微信绿/红包红等鲜艳色，适配按钮场景）
  const SEND_BG_COLORS = [
    { color: '#111111', label: '默认黑' },
    { color: '#07c160', label: '微信绿' },
    { color: '#fa5151', label: '红包红' },
    { color: '#3a8ee6', label: '天空蓝' },
    { color: '#ff9500', label: '活力橙' },
    { color: '#9254de', label: '优雅紫' },
    { color: '#ffffff', label: '白色' },
    { color: '#3a3a3a', label: '炭灰' }
  ];
  // 气泡颜色行统一处理：openModal 色板 → 存 cs-* 键 → applySettings 生效
  function bindBubbleColorRow(rowId, key, def, title, swatches) {
    const el = row(rowId);
    if (!el) return;
    el.addEventListener('click', () => {
      if (!window.openModal) return;
      const cur = store.get(key) || def;
      window.openModal(title, '', (v) => {
        // v 可能是色板下标（number）或自定义色值（#hex 字符串）
        const color = (typeof v === 'number' && swatches[v]) ? swatches[v].color : v;
        if (!color) return;
        store.set(key, color);
        applySettings();
        const val = document.getElementById(rowId + '-val');
        if (val) val.textContent = color === def ? '默认 ' + color : color;
      }, {
        colorPicker: true,
        color: cur,
        swatches: swatches
      });
    });
  }
  function editChatSurface(index) {
    if (!window.openModal) return;
    const item = CHAT_SURFACE_SETTINGS[index];
    const cid = window.activePrefix();
    window.openModal(item.label, '', v => {
      if (window.activePrefix() !== cid) return;
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      store.set(item.key, String(surfaceClamp(item, n)));
      applySettings();
    }, {
      noInput: true,
      slider: { min: item.min != null ? item.min : 0, max: item.max, step: 1, value: surfaceValue(item), unit: item.unit,
        label: item.unit === '%' ? '0% 全透明 · 100% 不透明；确认后生效' : '0px 为默认位置；' + (item.posHint || '调整位置') + '；保留安全区，确认后生效' },
      pills: [{ label: '恢复默认', value: item.def }]
    });
  }
  function bindChatSurfaceGroup(id, title, indices) {
    const el = row(id);
    if (!el) return;
    el.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal(title, '', v => {
        const index = Number(v);
        if (indices.indexOf(index) >= 0) setTimeout(() => editChatSurface(index), 0);
      }, { noInput: true, pill: indices[0], pills: indices.map(index => ({ label: CHAT_SURFACE_SETTINGS[index].label, value: index })) });
    });
  }
  bindChatSurfaceGroup('cs-bar-op', '选择要调整的栏背景', [0, 1]);
  bindChatSurfaceGroup('cs-bar-pos', '选择要微调的位置（仅当前桌面）', [3, 4]);
  const bubbleOpacityRow = row('cs-bubble-op');
  if (bubbleOpacityRow) bubbleOpacityRow.addEventListener('click', () => editChatSurface(2));
  bindBubbleColorRow('cs-typing-ink', 'cs-typing-ink', '#8a8a8a', '对方正在输入文字颜色', [{ color: '#8a8a8a', label: '默认灰' }].concat(BUBBLE_INK_COLORS));
  // 我的气泡（out 深色系）/ 联系人气泡（in 浅色系）与各自文字色
  bindBubbleColorRow('cs-out-bg', 'cs-out-bg', '#111111', '我的气泡颜色', BUBBLE_BG_COLORS);
  bindBubbleColorRow('cs-out-ink', 'cs-out-ink', '#ffffff', '我的消息文字颜色', BUBBLE_INK_COLORS);
  bindBubbleColorRow('cs-in-bg', 'cs-in-bg', '#ffffff', '联系人气泡颜色', BUBBLE_BG_COLORS);
  bindBubbleColorRow('cs-in-ink', 'cs-in-ink', '#111111', '联系人消息文字颜色', BUBBLE_INK_COLORS);
  // 发送按钮颜色 / 发送文字颜色
  bindBubbleColorRow('cs-send-bg', 'cs-send-bg', '#111111', '发送按钮颜色', SEND_BG_COLORS);
  bindBubbleColorRow('cs-send-ink', 'cs-send-ink', '#ffffff', '发送文字颜色', BUBBLE_INK_COLORS);
  // 发送按钮显示/隐藏（勾选=隐藏，默认显示；隐藏后仍可按回车键发送）。每联系人独立。
  const csSendShow = document.getElementById('cs-send-show');
  if (csSendShow) {
    const showGet = () => { try { return store.get('cs-send-show') === 'hide'; } catch (e) { return false; } };
    const showSet = (hide) => { try { store.set('cs-send-show', hide ? 'hide' : 'show'); } catch (e) {} };
    const syncCsSendShow = () => { const v = showGet(); if (v !== csSendShow.checked) csSendShow.checked = v; };
    syncCsSendShow();
    csSendShow.addEventListener('change', () => {
      if (csSendShow.checked === showGet()) return;
      showSet(csSendShow.checked);
      applySettings();
      toast(csSendShow.checked ? '发送按钮已隐藏：仍可按回车键发送消息' : '发送按钮已显示');
    });
    document.addEventListener('contact-switched', syncCsSendShow);
  }
  // 回车键发送开关（默认开；关闭后按回车不发送，改为换行/不动作）。每联系人独立。
  const csEnterSend = document.getElementById('cs-enter-send');
  if (csEnterSend) {
    const enterGet = () => { try { return store.get('cs-enter-send') !== 'off'; } catch (e) { return true; } };
    const enterSet = (on) => { try { store.set('cs-enter-send', on ? 'on' : 'off'); } catch (e) {} };
    const syncCsEnterSend = () => { const v = enterGet(); if (v !== csEnterSend.checked) csEnterSend.checked = v; };
    syncCsEnterSend();
    csEnterSend.addEventListener('change', () => {
      if (csEnterSend.checked === enterGet()) return;
      enterSet(csEnterSend.checked);
      toast(csEnterSend.checked ? '回车键发送已开启' : '回车键发送已关闭：按回车键改为换行');
    });
    document.addEventListener('contact-switched', syncCsEnterSend);
  }

  const csFont = row('cs-font-size');
  if (csFont) {
    csFont.addEventListener('click', () => {
      if (!window.openModal) return;
      const curFs = clampFontSize(store.get('cs-font-size'));
      window.openModal('聊天气泡字体大小', '', (v) => {
        store.set('cs-font-size', clampFontSize(v) + 'px');
        applySettings();
      }, {
        noInput: true,
        slider: { min: FONT_SIZE_MIN, max: FONT_SIZE_MAX, step: 1, value: curFs, label: '拖动调整气泡字号', unit: 'px',
          onChange: (val) => { root.style.setProperty('--chat-font-size', clampFontSize(val) + 'px'); } },
        pills: FONT_SIZES,
        pill: curFs + 'px'
      });
    });
  }
  const csPad = row('cs-bubble-size');
  if (csPad) {
    csPad.addEventListener('click', () => {
      if (!window.openModal) return;
      const curPad = normBubblePad(store.get('cs-bubble-size'));
      const curLr = clampBubbleLr(curPad);
      window.openModal('聊天气泡框大小', '', (v) => {
        store.set('cs-bubble-size', typeof v === 'number' ? bubblePadFromLr(v) : normBubblePad(v));
        applySettings();
      }, {
        noInput: true,
        slider: { min: BUBBLE_LR_MIN, max: BUBBLE_LR_MAX, step: 1, value: curLr, label: '拖动调整气泡胖瘦（上下内边距按比例跟随）', unit: 'px',
          onChange: (val) => { root.style.setProperty('--chat-bubble-pad', bubblePadFromLr(val)); } },
        pills: BUBBLE_SIZES,
        pill: curPad
      });
    });
  }
  // v3.25.x：聊天气泡边缘（四角圆角大小）——滑块自由调节 + 预设胶囊，实时预览
  const csRadius = row('cs-bubble-radius');
  if (csRadius) {
    csRadius.addEventListener('click', () => {
      if (!window.openModal) return;
      const curStr = store.get('cs-bubble-radius') || BUBBLE_RADIUS_DEFAULT;
      const curNum = (parseInt(curStr, 10) || 0);
      window.openModal('聊天气泡边缘圆角', '', (v) => {
        const px = typeof v === 'number' ? v : (parseInt(v, 10) || 0);
        store.set('cs-bubble-radius', px + 'px');
        applySettings();
      }, {
        noInput: true,
        slider: {
          min: 0, max: 40, step: 1, value: Math.max(0, Math.min(40, curNum)),
          label: '拖动调整气泡圆角', unit: 'px', preview: true,
          onChange: (val) => { root.style.setProperty('--chat-bubble-radius', val + 'px'); }
        },
        pills: BUBBLE_RADII,
        pill: curStr
      });
    });
  }

  // ================= 全局字体（上传本地字体 / 输入字体名或链接，v3.5.34 起全局应用） =================
  const csFontRow = row('cs-font');
  // v3.26.x #628：字体仍按桌面各存各的（键 cs-font，per-cid，与壁纸/气泡/字号等同桌面美化一致，
  //   每个联系人桌面可以各自排版）。用户报的「上传字体，无法应用到全部桌面」缺的是「一键推给
  //   其它桌面」这一步 —— 面板里新增「同步到全部桌面」按钮（syncFontAllDesks，两个入口都有）。
  //   ⚠️ default 桌面的 activeStore() 是 contacts.js 的 defaultStore：它的 get 会回退读根键、
  //   set/remove 会连带处理同名根键——写入统一走下面三个函数，便于 demoteFontGlobal 处理中间版残留。
  const FONT_KEY = 'cs-font';
  function fontVal() { return store.get(FONT_KEY) || ''; }
  function fontSet(v) { store.set(FONT_KEY, v); }
  function fontRemove() { store.remove(FONT_KEY); }
  // #642 字体去重：上传型字体（几 MB 的 dataURL）按内容哈希存【全局唯一一份】
  //   xy-home-v2:font-blob-<hash>，各桌面 cs-font 只存轻量引用 '@@font:<hash>' ——
  //   3 个桌面用同一个字体只占 1 份存储（此前「同步到全部桌面」会整份复制 N 份）。
  //   哈希只做「同内容合并」用途（djb2 + 长度），碰撞概率对人工上传场景可忽略。
  function fontHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36) + '-' + s.length.toString(36);
  }
  function fontBlobPut(hash, dataURL) { try { window.xyStore('xy-home-v2').set('font-blob-' + hash, dataURL); } catch (e) {} }
  // FIX 2026-09-18 #787：上传字体「莫名失效」根治（用户实报，多设备型号复现；零机型分支——
  //   判据全部取存储状态/时序，不碰 UA/内核）。两条根因都在 #642「全局唯一份+轻量引用」链路上：
  //   ①写丢：blob 是 MB 级大键，只进 IDB+memoryCache；写入走 xyStore.set 内部 fire-and-forget 的
  //   idbSet，挂起内核（真我/荣耀/小米 Edge）/iOS 切后台杀 IDB/配额 abort 时静默失败 →
  //   「字体已应用」toast 照弹、持久层却没写进 → 重启后引用展开为空＝字体消失。
  //   ②读烧：引用展开的异步补读「一次烧毁」（失败也不复位），弱内核撞上一次 4s+4s 挂起，
  //   整场会话不再补读，数据明明在 IDB 字体却不应用＝「有时好有时坏」。
  function fontSetDataFor(s, dataURL, silent) {
    const h = fontHash(dataURL);
    delete _fontBlobGone[h]; // 同内容重新上传＝blob 重新写入，清「丢失」标记
    fontBlobPut(h, dataURL);
    try { s.set(FONT_KEY, '@@font:' + h); } catch (e) {}
    // ①写丢根治：补一发带回执的 idbSet（同键同值，双写幂等），确认落盘才保留引用；
    //   写不进则回退直存 dataURL——小字体（<200KB）落 LS 照样耐用，大字体至少本会话可用并如实提示。
    //   过期守卫：回执到达前用户又换了/清了字体，则不动现值。
    try {
      if (window.idbSet) window.idbSet('xy-home-v2:font-blob-' + h, dataURL).then((ok) => {
        if (ok) return;
        try {
          if (s.get(FONT_KEY) !== '@@font:' + h) return;
          s.set(FONT_KEY, dataURL);
          applyFont();
          csFontChanged();
          if (!silent) toast('本机存储写入失败，已改用兼容方式保存；重启后若字体丢失请重新上传');
        } catch (e) {}
      }).catch(() => {});
    } catch (e) {}
  }
  function fontSetData(dataURL) { fontSetDataFor(store, dataURL); }
  // #787 ②读烧根治：_fontHydrating 只当「在飞」标记防并发重复读；_fontHydrateTries 限整场会话
  //   每 hash 至多 5 发；_fontBlobGone 只在 idbGet 给出「真没有」（非 ambiguous，见 #665a 歧义
  //   标记）时置位停止重试——挂起/超时/读异常都按「没读到」退避后再来，不再一次失败全场报废。
  let _fontHydrating = {};
  let _fontHydrateTries = {};
  let _fontBlobGone = {};
  // 引用展开：'@@font:<hash>' → 全局唯一下载的 dataURL；同步读不到（大键只进 IDB /
  //   被 OOM 预算 defer）时异步 idbGet 补读并重应用，补读落地前按「未设字体」渲染。
  function fontResolved() {
    const v = fontVal();
    if (v.indexOf('@@font:') !== 0) return v;
    const hash = v.slice(7);
    const g = window.xyStore('xy-home-v2');
    const blob = g.get('font-blob-' + hash);
    if (blob) return blob;
    if (_fontBlobGone[hash]) return '';
    const tries = _fontHydrateTries[hash] || 0;
    if (window.idbGet && !_fontHydrating[hash] && tries < 5) {
      _fontHydrating[hash] = true;
      _fontHydrateTries[hash] = tries + 1;
      const info = {};
      window.idbGet('xy-home-v2:font-blob-' + hash, info).then((b) => {
        delete _fontHydrating[hash];
        if (b && typeof b === 'string' && b.length > 2) {
          delete _fontHydrateTries[hash];
          delete _fontBlobGone[hash];
          fontBlobPut(hash, b);
          applyFont();
          csFontChanged();
          return;
        }
        if (info && info.ambiguous) {
          // 读失败不是没有：退避后补读下一发（applyFont 会重走 fontResolved）
          setTimeout(() => { applyFont(); }, 2500 * (tries + 1));
        } else {
          _fontBlobGone[hash] = true; // IDB 里真没有＝blob 丢失（多半是当年写入静默失败）
          applyFont(); // 只为把设置行文案刷成「丢失」；fontResolved 见 gone 不再发读
          csFontChanged(); // #894：丢失是终局，广播让美化页入口同步清除（读取中不广播，防误清）
        }
      }).catch(() => {
        delete _fontHydrating[hash];
        setTimeout(() => { applyFont(); }, 2500 * (tries + 1));
      });
    }
    return '';
  }
  // 全部桌面 id（default + 各联系人）
  function deskFontCids() {
    const ids = ['default'];
    try { (window.getContacts() || []).forEach(c => { if (c && c.id && ids.indexOf(c.id) < 0) ids.push(c.id); }); } catch (e) {}
    return ids;
  }
  // 字体变更广播：桌面美化页「全局字体」行（personalize.js）与这里是同键同功能，
  // 任一边改动后另一边即时回显（apply* 内不广播，防两边互相触发成环）
  function csFontChanged() { try { document.dispatchEvent(new Event('cs-font-changed')); } catch (e) {} }
  // v3.26.x #628：反向兼容——本号初版（中间版本）曾把字体改存【根键】xy-home-v2:cs-font
  //   （所有桌面共用一个值）。现改回「每个桌面各存各的」+同步按钮，故把那版残留的根键值回填给
  //   每个【还没设字体】的桌面（不覆盖各桌面已有的字体），再删掉根键——否则那版用户只有
  //   default 桌面看得到字体。根值是上传型 dataURL 时得等 idbRestore 回填才读得到，故 restore-done 再补一次。
  function demoteFontGlobal() {
    try {
      if (!window.storeFor) return;
      let root = '';
      try { root = window.xyStore('xy-home-v2').get(FONT_KEY) || ''; } catch (e) {}
      if (!root) return;
      deskFontCids().forEach(id => {
        try { const s = window.storeFor(id); if (!s.get(FONT_KEY)) s.set(FONT_KEY, root); } catch (e) {}
      });
      try { window.xyStore('xy-home-v2').remove(FONT_KEY); } catch (e) {}
      applyFont();
      csFontChanged();
    } catch (e) {}
  }
  // 「同步到全部桌面」：把当前桌面的字体推给其它所有桌面（含还没设字体的），二次确认后一次写齐。
  // 与聊天壁纸的「把壁纸和图库同步到全部联系人」同款交互（会覆盖对方桌面现有的字体，故要确认）。
  function syncFontAllDesks() {
    const v = fontVal();
    if (!v) { toast('当前桌面还没有自定义字体：先上传字体或输入字体名，点「应用」'); return; }
    const me = (window.getActiveContact && window.getActiveContact()) || 'default';
    const others = deskFontCids().filter(id => id !== me);
    if (!others.length) { toast('现在只有这一个桌面，无需同步'); return; }
    if (!window.openModal || !window.storeFor) return;
    window.openModal('同步字体到全部桌面', '', (r) => {
      if (r !== '__yes__') return;
      let n = 0;
      others.forEach((id) => { try { window.storeFor(id).set(FONT_KEY, v); n++; } catch (e) {} });
      csFontChanged();
      toast('已同步到 ' + n + ' 个桌面（切到对应桌面即可看到）');
    }, { noInput: true, pills: [{ label: '确认同步（覆盖其它桌面的字体）', value: '__yes__' }, { label: '取消', value: '__no__' }] });
  }
  // 桌面美化页入口（personalize.js）的「同步到全部桌面」按钮复用同一份实现，避免两处漂移
  window.csFontSyncAllDesks = syncFontAllDesks;
  // #642：美化页上传/下载字体也走「全局唯一份 + 轻量引用」（实现只有这一份）
  window.csFontStoreData = fontSetData;
  // #642：存量迁移——把各桌面 cs-font 里的整份 dataURL 收敛为「全局唯一份 + 轻量引用」；
  //   幂等（已是引用的跳过），同内容多桌面自动合并到同一 blob。启动一次 + restore-done
  //   再补一次（上传型大键要等 IDB 回填才读得到）。
  function migrateFontBlobs() {
    try {
      if (!window.storeFor) return;
      deskFontCids().forEach((id) => {
        try {
          const s = window.storeFor(id);
          const v = s.get(FONT_KEY);
          if (v && v.indexOf('data:') === 0) fontSetDataFor(s, v, true); // silent：启动迁移不弹 toast（#787）
        } catch (e) {}
      });
    } catch (e) {}
  }
  window.migrateFontBlobs = migrateFontBlobs;
  function applyFont() {
    const v = fontResolved();
    // #787：引用未展开时不再显示生引用串/误报「默认」——区分「读取中」与「字体文件丢失」，
    //   用户看得出状态，不再「莫名其妙」
    const rawVal = fontVal();
    const setVal = document.getElementById('cs-font-val');
    if (setVal) {
      if (v) setVal.textContent = v.indexOf('data:') === 0 ? '已上传' : v;
      else if (rawVal.indexOf('@@font:') === 0) setVal.textContent = _fontBlobGone[rawVal.slice(7)] ? '字体文件丢失，请重新上传' : '已上传（读取中…）';
      else setVal.textContent = '默认';
    }
    // #894：引用未展开（blob 只在 IDB/补读在飞，且未判丢失）时【保留已注入的字体不清除】——
    //   弱内核 IDB 挂起期间切桌面/回填兜底走到这里，旧逻辑按空值把 @font-face 拆掉、内联
    //   font-family 清空＝用户报「切换桌面联系人后已上传的字体应用消失」；挂起拖过 5 发补读
    //   预算后整场会话不再补读＝永不恢复。补读落地后 applyFont 按真实值校正；新桌面真没设
    //   字体时 rawVal 不是引用形态，照常清除（#628 按桌面独立语义不变）。
    if (!v && rawVal.indexOf('@@font:') === 0 && !_fontBlobGone[rawVal.slice(7)]) return;
    // 同一个值已在位就不再重注入——dataURL 字体可达 MB 级，而切桌面/回填兜底都会调到这里
    const old = document.getElementById('cs-font-style');
    if (old && old.__fontVal === v) return;
    // 移除旧的字体样式
    if (old) old.remove();
    if (!v) {
      if (document.body.style.fontFamily || document.documentElement.style.fontFamily) {
        document.body.style.fontFamily = '';
        document.documentElement.style.fontFamily = '';
      }
      return;
    }
    // dataURL → @font-face 注入 + 全局应用（body/html 继承到全部页面，不只聊天）
    if (v.indexOf('data:') === 0) {
      const st = document.createElement('style');
      st.id = 'cs-font-style';
      st.__fontVal = v;
      st.textContent = '@font-face{font-family:"cs-custom-font";src:url("' + v + '");font-display:swap;}' +
        'body,html{font-family:"cs-custom-font",sans-serif !important;}';
      document.head.appendChild(st);
      document.body.style.fontFamily = '';
      document.documentElement.style.fontFamily = '';
      return;
    }
    // 字体名直接应用（全局）
    document.body.style.fontFamily = '"' + v + '",sans-serif';
    document.documentElement.style.fontFamily = '"' + v + '",sans-serif';
  }
  if (csFontRow) {
    csFontRow.addEventListener('click', () => {
      if (!window.openTCPanel) return;
      window.openTCPanel('全局字体', '' +
        '<div class="sm-fld"><label>上传本地字体（ttf / otf / woff / woff2），应用后本桌面全部页面生效</label>' +
        // v3.6.x：字体名做 HTML 转义——原逻辑直接拼接 value 属性，字体名含 " 或 < 会破坏弹层结构
        '<input class="tc-input" id="cs-font-name" placeholder="也可直接输入字体名或链接，如 Microsoft YaHei"' + (fontResolved() && fontResolved().indexOf('data:') !== 0 && fontResolved().indexOf('http') !== 0 ? ' value="' + String(fontResolved()).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"' : '') + '></div>' +
        '<div class="mail-actions"><button class="cc-tool" id="cs-font-upload">上传字体</button><button class="cc-tool" id="cs-font-clear">恢复默认</button><button class="cc-tool" id="cs-font-ok">应用</button></div>' +
        // #628：字体按桌面独立（每个联系人可各自排版）——其它桌面也要用同一个字体时点这颗同步，
        // 不必逐个桌面重新上传（上传型字体可达几 MB，重传很麻烦）
        '<div class="sm-fld" style="margin-top:10px"><label>其它桌面也要用这个字体？</label>' +
        '<button id="cs-font-sync" style="width:100%;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px">同步到全部桌面</button></div>');
      document.getElementById('cs-font-upload').addEventListener('click', () => {
        // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
        window.mochiFilePick({
          id: 'mochi-cs-font-pick', accept: '.ttf,.otf,.woff,.woff2',
          onFiles: (files) => {
            const f = files && files[0];
            if (!f) { toast('没有取到字体文件，请再选一次'); return; }
            toast('正在读取字体文件…');
            const reader = new FileReader();
            reader.onload = () => {
              fontSetData(reader.result); // #642：存全局唯一份 + 轻量引用（同内容跨桌面只存一份）
              document.getElementById('tc-mask').hidden = true;
              applyFont();
              csFontChanged();
              toast('字体已应用到本桌面');
            };
            reader.onerror = () => { toast('字体文件读取失败，请重试'); };
            reader.readAsDataURL(f);
          }
        });
      });
      document.getElementById('cs-font-clear').addEventListener('click', () => {
        fontRemove();
        document.getElementById('tc-mask').hidden = true;
        applyFont();
        csFontChanged();
        toast('已恢复默认字体');
      });
      document.getElementById('cs-font-ok').addEventListener('click', () => {
        const name = (document.getElementById('cs-font-name').value || '').trim();
        if (!name) { toast('请输入字体名或链接'); return; }
        // 链接：尝试下载并转 dataURL（失败则按字体名应用）；下载期间先提示，避免"没反应"
        if (/^https?:\/\/.+\.(ttf|otf|woff|woff2)$/i.test(name)) {
          toast('正在下载字体，请稍候…');
          fetch(name, { mode: 'cors' }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
          }).then(blob => {
            const rd = new FileReader();
            rd.onload = () => {
              fontSetData(rd.result); // #642：全局唯一份 + 引用
              document.getElementById('tc-mask').hidden = true;
              applyFont();
              csFontChanged();
              toast('字体下载并应用成功');
            };
            rd.onerror = () => {
              fontSet(name);
              document.getElementById('tc-mask').hidden = true;
              applyFont();
              csFontChanged();
              toast('字体读取失败，已按字体名应用');
            };
            rd.readAsDataURL(blob);
          }).catch(() => {
            fontSet(name);
            document.getElementById('tc-mask').hidden = true;
            applyFont();
            csFontChanged();
            toast('链接下载失败，已按字体名应用');
          });
          return;
        }
        fontSet(name);
        document.getElementById('tc-mask').hidden = true;
        applyFont();
        csFontChanged();
        toast('字体已应用到本桌面');
      });
      // #628：一键把本桌面字体推给其它桌面（实现见 syncFontAllDesks，桌面美化入口复用同一份）
      document.getElementById('cs-font-sync').addEventListener('click', () => { syncFontAllDesks(); });
    });
  }
  // 中间版「全局字体」残留的根键回填到各桌面（一次性、幂等；大键等 restore-done 再补）
  demoteFontGlobal();
  // #642：存量整份字体收敛为全局唯一下载（幂等；大键等 restore-done 再补一次）
  migrateFontBlobs();
  // #787：回填完成清补读计数（预算重置）再补应用一次——restore 可能刚把 blob 带回可读状态
  try { document.addEventListener('mochi-restore-done', () => { _fontHydrateTries = {}; migrateFontBlobs(); applyFont(); }); } catch (e) {}
  applyFont();

  // ================= 气泡 CSS（自定义样式，极简黑白灰） =================
  const csCss = row('cs-css');
  const CSS_KEY = 'cs-bubble-css';
  // v3.14.x：安卓 ce-box 转换后 .value 代理在个别内核读空（mail.js/music-player.js/
  // period.js 同款先例）——代理读空但 ce-box 里仍有可见内容时直接从盒子取值兜底，
  // 防「点应用存了空串」→ 重进后退回默认气泡；用户真清空时盒子也是空的，语义不变
  function cssReadVal(el) {
    if (!el) return '';
    let v = '';
    try { v = el.value || ''; } catch (e) {}
    if (String(v).trim()) return String(v);
    try {
      const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
      if (box) {
        const t = box.innerText || box.textContent || '';
        if (String(t).trim()) return String(t);
      }
    } catch (e) {}
    return v;
  }
  // ===== #732：滑块「强制生效层」 =====
  // 为什么需要它：气泡透明度/圆角滑块只写 --cs-in-surface / --chat-bubble-radius 变量，
  // 而用户自传的气泡 CSS 经 mochiMapBubbleCss 有三条注入路径全都压过这两个变量——
  //   ① 纯声明（无 {}）→ wrap() 输出带 !important；② 认不出类名 → 整包兜底同样带 !important；
  //   ③ 认得出类名 → 映射分支不带 !important，但 <style> 挂在 head 末尾、同特异性后胜。
  // 用户报「我滑动了，但没有任何区别」就是这个原因（#725 只加了红字说明，未真正解决）。
  // 策略（零回归关键）：只在用户「真的动过滑块」（当前值 ≠ 默认值）时才追加强制层，
  // 没碰过滑块的人视觉完全不变；一旦动过就以滑块为准，压过上述三条路径。
  // 选择器用 #page-chat + 双类 .msg-bubble.msg-bubble 提特异性，作用域钉在单聊，
  // 不泄漏群聊（与 #536 同口径）。
  function applyCssEnforce() {
    const old = document.getElementById('cs-bubble-enforce');
    const rules = [];
    try {
      const opItem = CHAT_SURFACE_SETTINGS.filter(s => s.key === 'cs-bubble-opacity')[0];
      const op = opItem ? surfaceValue(opItem) : 100;
      if (opItem && op !== opItem.def) {
        rules.push('#page-chat .msg-in .msg-bubble.msg-bubble{background:var(--cs-in-surface)!important}');
        rules.push('#page-chat .msg-out .msg-bubble.msg-bubble{background:var(--cs-out-surface)!important}');
      }
      const rad = store.get('cs-bubble-radius');
      if (rad != null && String(rad).trim() !== '' && String(rad) !== BUBBLE_RADIUS_DEFAULT) {
        rules.push('#page-chat .msg-bubble.msg-bubble{border-radius:var(--chat-bubble-radius,18px)!important}');
      }
    } catch (e) {}
    // #938：原实现先 old.remove() 再重建——凡设过非默认气泡透明度/圆角的设备，抽屉里每一次控件点击
    // （任何键都汇进 applySettings）都要拆建一次 head 里的 STYLE 元素；与 body class 那记同族，
    // 属「值没变也全局翻动」。改法＝按生成的规则文本比对：没变一个 DOM 字节都不碰，变了就地写
    // textContent（同元素原地换文本，不经历「样式表短暂缺席」的下一帧）。
    const text = rules.join('');
    if (!text) { if (old) old.remove(); return; }
    if (old) { if (old.textContent !== text) old.textContent = text; return; }
    const st = document.createElement('style');
    st.id = 'cs-bubble-enforce';
    st.textContent = text;
    document.head.appendChild(st);
  }
  function applyCss() {
    const old = document.getElementById('cs-bubble-style');
    if (old) old.remove();
    const css = store.get(CSS_KEY) || '';
    const setVal = document.getElementById('cs-css-val');
    if (setVal) setVal.textContent = css ? '已设置' : '默认';
    if (!css) return null;
    let out, hint = null;
    // v3.26.x #181：统一走 chat.js 的 mochiMapBubbleCss（别名扩充 + 未认出气泡类名时整包声明兜底，
    // 修「上传网页模板气泡 CSS 后界面零变化」多机型反复问题；兜底触发时给出 toast 说明）
    // FIX 2026-09-15 #536：单聊气泡样式必须钉在 #page-chat 作用域内。此前 scope 传空串，
    // 产出的 `.msg-out .msg-bubble{…}` 是全局选择器——群聊页（#page-group-chat）复用同一套
    // .msg-out/.msg-in/.msg-bubble 类名，用户只在单聊设置的气泡背景/文字色会连带套进群聊，
    // 正是「群聊里我发消息整个框变黑看不到字」的另一条泄漏路径（与 _ensureBubbleContrast 同族）。
    if (window.mochiMapBubbleCss) {
      const res = window.mochiMapBubbleCss(css, '#page-chat ');
      out = res.out;
      hint = res.hint;
    } else if (css.indexOf('{') < 0) {
      out = '#page-chat .msg-out .msg-bubble{' + css + '!important;}' +
            '#page-chat .msg-in .msg-bubble{' + css + '!important;}';
    } else {
      out = css;
    }
    const st = document.createElement('style');
    st.id = 'cs-bubble-style';
    st.textContent = out;
    document.head.appendChild(st);
    return hint;
  }
  if (csCss) {
    csCss.addEventListener('click', () => {
      if (!window.openTCPanel) return;
      window.openTCPanel('气泡 CSS', '' +
        '<div class="sm-fld-hint" style="margin-bottom:8px">输入自定义样式，支持两种写法：<br>· 直接写声明，如 <code>border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.1)</code>（自动应用到双方气泡）<br>· 或写选择器，如 <code>.msg-out .msg-bubble{...}</code>；网页气泡模板常见的 <code>.me/.friend/.message-me/.bubble{...}</code> 等类名也会自动识别</div>' +
        '<textarea id="cs-css-input" class="tc-input" rows="6" placeholder="border-radius: 20px;' + '&#10;box-shadow: 0 2px 8px rgba(0,0,0,.12);"></textarea>' +
        '<div class="mail-actions"><button class="cc-tool" id="cs-css-clear">清空</button><button class="cc-tool" id="cs-css-ok">应用</button></div>');
      const ta = document.getElementById('cs-css-input');
      if (ta) ta.value = store.get(CSS_KEY) || '';
      document.getElementById('cs-css-clear').addEventListener('click', () => {
        store.remove(CSS_KEY);
        document.getElementById('tc-mask').hidden = true;
        applyCss();
        toast('已清空气泡样式');
      });
      document.getElementById('cs-css-ok').addEventListener('click', () => {
        const v = cssReadVal(document.getElementById('cs-css-input')).trim();
        store.set(CSS_KEY, v);
        document.getElementById('tc-mask').hidden = true;
        const hint = applyCss();
        toast(hint || '气泡样式已应用');
      });
    });
  }
  applyCss();

  // ================= v3.18.x：聊天美化方案（全局保存，所有联系人桌面通用） =================
  // 用户需求：聊天设置里也能像手机桌面美化一样，把气泡颜色/CSS、壁纸、字体、时间轴等
  // 全部美化保存成方案；保存后切换联系人/桌面依然可见，可一键应用（读当前桌面的 activeStore）。
  const gStoreChat = window.xyStore('xy-home-v2');
  const CHAT_SCHEMES_KEY = 'chat-beauty-schemes';
  const CHAT_BEAUTY_KEYS = [
    'cs-bg', 'cs-bubble-css', 'cs-font', 'cs-font-size', 'cs-bubble-size',
    'cs-bubble-radius', 'cs-av-shape', 'cs-time-style', 'cs-time-ink', 'cs-typing-ink',
    'cs-out-bg', 'cs-out-ink', 'cs-in-bg', 'cs-in-ink',
    'cs-send-bg', 'cs-send-ink', 'cs-send-show',
    'cs-head-opacity', 'cs-input-opacity', 'cs-bubble-opacity', 'cs-head-inset', 'cs-input-inset',
    // #731：壁纸铺满方式 + 壁纸延伸到栏位（同一份美化方案应记住这两个观感开关）
    // #782：壁纸位置与缩放三键（方案/备份/导入必须一起走，否则换桌面图就跳位）
    'cs-bg-fit', 'cs-bg-fullbars', 'cs-bg-pos-x', 'cs-bg-pos-y', 'cs-bg-size'
  ];
  const getChatSchemes = () => {
    try { const a = JSON.parse(gStoreChat.get(CHAT_SCHEMES_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  };
  const saveChatSchemesList = (arr) => { try { gStoreChat.set(CHAT_SCHEMES_KEY, JSON.stringify(arr)); } catch (e) {} };
  // FIX 2026-09-15 #527：聊天美化的用途标记 + 命中计数（与桌面美化同族，见 personalize.js #527）。
  // 旧行为：导入无用途校验、无「识别到几项」反馈，把桌面美化 JSON 粘进聊天导入框照样提示成功。
  const CHAT_BEAUTY_KIND = 'mochi-chat-beauty';
  const chatBeautyKindMismatch = (data) => {
    const k = data && data['__kind__'];
    return !!k && k !== CHAT_BEAUTY_KIND;
  };
  const recognizeChatBeauty = (data) => {
    if (!data || typeof data !== 'object') return 0;
    let n = 0;
    CHAT_BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined) n++; });
    return n;
  };
  const collectChatBeauty = () => {
    const data = {};
    CHAT_BEAUTY_KEYS.forEach(k => { const v = store.get(k); if (v !== null && v !== undefined && v !== '') data[k] = v; });
    data['__kind__'] = CHAT_BEAUTY_KIND;
    return data;
  };
  const applyChatBeautyData = (data) => {
    let n = 0;
    CHAT_BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined) { store.set(k, data[k]); n++; } });
    try { applySettings(); applyCss(); applyFont(); } catch (e) {}
    try { csFontChanged(); } catch (e) {}
    return n;
  };
  // FIX #527：聊天美化导入的兑底备份——此前 chatSchemeImport 直接覆盖、无「导入前备份」、
  // 无撤销压栈（注释写「与桌面美化导入一致」但备份那一半没跟上）。现与桌面版同口径：
  // 导入前把当前聊天美化存成「导入前备份」方案，只留最近 5 份，用户自己命名的方案不动。
  const chatBackupBeforeImport = () => {
    try {
      const cur = collectChatBeauty();
      const realKeys = Object.keys(cur).filter(k => k !== '__kind__');
      if (!realKeys.length) return '';
      const d = new Date();
      const p = (n) => (n < 10 ? '0' : '') + n;
      const name = '导入前备份 ' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      let list = getChatSchemes();
      const autos = list.filter(s => s && typeof s.name === 'string' && s.name.indexOf('导入前备份') === 0);
      if (autos.length >= 5) {
        const drop = new Set(autos.slice(0, autos.length - 4).map(s => s.time));
        list = list.filter(s => !(s && drop.has(s.time) && typeof s.name === 'string' && s.name.indexOf('导入前备份') === 0));
      }
      list.push({ name, time: Date.now(), data: cur });
      saveChatSchemesList(list);
      const back = getChatSchemes();
      return back.some(s => s && s.name === name) ? name : '';
    } catch (e) { return ''; }
  };
  // v3.27.x：暴露给 personalize.js 的完整外观方案合并使用（跨域，仅暴露不改动逻辑）
  window.collectChatBeauty = collectChatBeauty;
  window.applyChatBeautyData = applyChatBeautyData;
  function chatSchemeModalEl() {
    let m = document.getElementById('chat-beauty-scheme-manager');
    if (!m) {
      m = document.createElement('div'); m.id = 'chat-beauty-scheme-manager'; m.hidden = true;
      m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
    }
    return m;
  }
  function hideChatSchemeModal(m) { if (m) { m.style.display = 'none'; m.hidden = true; } }
  function applyChatScheme(idx, m) {
    const s = getChatSchemes()[idx];
    if (!s || !window.openModal) return;
    // v3.26.x：预选中唯一「应用」pill——noInput 弹窗只点底部「确定」时 fire() 传
    // pillVal=null → v!=='ok' 静默不应用（与桌面「应用方案/恢复默认桌面」同因同修）
    const ctl = window.openModal('应用方案「' + s.name + '」？', '', (v) => {
      if (v !== 'ok') return;
      applyChatBeautyData(s.data || {});
      hideChatSchemeModal(m);
      toast('已应用「' + s.name + '」，当前聊天立即生效');
    }, { noInput: true, staticText: '将覆盖当前联系人桌面的聊天美化设置，立即生效', pills: [{ label: '应用', value: 'ok' }] });
    if (ctl && ctl.pills) ctl.pills([{ label: '应用', value: 'ok' }], 'ok');
  }
  function deleteChatScheme(idx, m) {
    const s = getChatSchemes()[idx];
    if (!s || !window.openModal) return;
    // v3.26.x：预选中唯一「删除」pill——否则用户只点底部「确定」时传 null → 静默不删除（反馈"没反应"）
    const ctl = window.openModal('删除方案「' + s.name + '」？', '', (v) => {
      if (v !== 'ok') return;
      const list = getChatSchemes();
      list.splice(idx, 1);
      saveChatSchemesList(list);
      toast('已删除方案');
      window.openChatBeautySchemes();
    }, { noInput: true, staticText: '删除后不可恢复', pills: [{ label: '删除', value: 'ok' }] });
    if (ctl && ctl.pills) ctl.pills([{ label: '删除', value: 'ok' }], 'ok');
  }
  // 小按钮构造器
  function mkBtn(label, css, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = css;
    b.addEventListener('click', fn);
    return b;
  }
  // v3.26.x：聊天美化方案导出——先选「当前设置 / 某个已保存方案」，再走文件/文字（与桌面美化导出一致）
  function chatSchemeExport() {
    const schemes = getChatSchemes();
    const doExport = (data) => {
      const json = JSON.stringify(data);
      if (!window.openModal) { toast('导出失败'); return; }
      // v3.26.x #172：文件名用本地日期（原 toISOString 是 UTC，凌晨导出文件名会是前一天）
      const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n;
      const fname = 'mochi聊天美化方案-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.json';
      window.openModal('导出聊天美化方案', '', (v) => {
        if (v === 'file') {
          // v3.26.x #172：走统一三级降级导出链（系统分享面板→系统保存框→确认后下载，
          // window.mochiExportFile 由 data-backup.js 暴露）——原裸 a[download] 在 iPhone
          // 主屏安装（standalone 无下载管理器）与部分壳浏览器静默无反应=方案无法导出
          if (window.mochiExportFile) { window.mochiExportFile(json, fname, 'mochi聊天美化方案'); return; }
          try {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fname;
            document.body.appendChild(a); a.click();
            setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 1000);
            toast('已导出聊天美化方案文件');
          } catch (e) { toast('导出文件失败'); }
        } else if (v === 'text') {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).then(() => toast('已复制到剪贴板，发给对方粘贴导入')).catch(() => toast('复制失败，请改用导出文件'));
          } else { toast('剪贴板不可用，请改用导出文件'); }
        }
      }, {
        noInput: true,
        staticText: '选择导出方式：\n· 导出文件：自动弹分享/保存框（iPhone 主屏安装时用这个），不支持时确认后下载，可保存或发送\n· 复制文字：复制配置文本，发给对方粘贴导入',
        pills: [
          { label: '导出文件', value: 'file' },
          { label: '复制文字', value: 'text' },
        ],
      });
    };
    // 无已保存方案时直接导出当前设置
    if (!schemes.length || !window.openModal) { doExport(collectChatBeauty()); return; }
    const pills = [{ label: '当前设置', value: 'current' }]
      .concat(schemes.map((s, i) => ({ label: s.name || ('方案' + (i + 1)), value: 'sch_' + i })));
    window.openModal('导出聊天美化方案', '', (v) => {
      let data;
      if (v && v.indexOf('sch_') === 0) {
        const i = parseInt(String(v).slice(4), 10);
        const s = schemes[i];
        if (!s) { toast('未找到该方案'); return; }
        data = s.data || {};
      } else {
        data = collectChatBeauty();
      }
      doExport(data);
    }, {
      noInput: true,
      staticText: '选择要导出的聊天美化方案：\n· 当前设置：导出当前正在使用的聊天美化\n· 已保存方案：导出对应方案（含气泡/壁纸/字体）',
      pills: pills,
    });
  }
  // v3.26.x：聊天美化方案导入——粘贴文本/选文件 → 校验 → 应用到当前聊天（与桌面美化导入一致）
  function chatSchemeImport() {
    if (!window.openModal) return;
    window.openModal('导入聊天美化方案', '', (v) => {
      // #408：原「空文本静默 return」＝安卓 ce-box 读到空时导入「无反应」——补提示
      if (!v || !v.trim()) { toast('请先粘贴方案文本，或点「从文件导入」选择 .json 文件'); return; }
      try {
        // #408：粘贴/文件导入统一走自救解析（安卓各机型浏览器粘贴链路会弄脏 JSON，实现见 personalize.js）
        const data = window.mochiParsePastedJSON(v);
        // FIX 2026-09-15 #527：用途校验 + 命中项数如实反馈（原实现无条件报「已导入」）
        if (chatBeautyKindMismatch(data)) {
          toast('这份方案不是聊天美化方案（' + data.__kind__ + '），请到对应页面导入');
          return;
        }
        const hit = recognizeChatBeauty(data);
        if (!hit) {
          toast('这份数据里没有识别到聊天美化项，请确认是聊天美化方案');
          return;
        }
        const bk = chatBackupBeforeImport();
        const n = applyChatBeautyData(data);
        toast('已导入 ' + n + ' 项，当前聊天立即生效' + (bk ? '（原美化已存为「' + bk + '」）' : ''));
        window.openChatBeautySchemes();
      } catch (e) {
        // #408：带出真实原因 + 失败现场写诊断（跨域改动，同族修复见 personalize.js）
        const _sv = String(v || '');
        try { if (window.__jsErrors) window.__jsErrors.push('[聊天美化导入] ' + ((e && e.message) || e) + ' | 收到长度=' + _sv.length + ' | 开头: ' + _sv.replace(/[\uFEFF\u200B-\u200F]/g, '').slice(0, 100)); } catch (e1) {}
        toast('解析失败：' + ((e && e.message) || '请检查文本'));
      }
    }, { textarea: true, textareaPlaceholder: '粘贴对方导出的聊天美化方案文本，或点下方「从文件导入」选择 .json 文件', txtImport: true });
  }
  // v3.25.x：方案缩略图——按方案数据渲染迷你聊天气泡预览
  function chatSchemeThumb(data) {
    data = data || {};
    const inBg = data['cs-in-bg'] || '#ffffff';
    const inInk = data['cs-in-ink'] || '#111111';
    const outBg = data['cs-out-bg'] || '#111111';
    const outInk = data['cs-out-ink'] || '#ffffff';
    const r = (parseInt(data['cs-bubble-radius'] || '18px', 10) || 18) / 2;
    const tl = Math.max(0, Math.min(9, Math.round(r)));
    const bg = data['cs-bg'] || '';
    const hasCss = !!data['cs-bubble-css'];
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
  // v3.25.x：当前聊天美化的文字摘要 chips（气泡色/圆角/字号/CSS/壁纸/头像形状/时间轴）
  function chatBeautySummary(data) {
    data = data || {};
    const out = [];
    const inBg = data['cs-in-bg'], outBg = data['cs-out-bg'];
    if (inBg || outBg) out.push('气泡色 ' + (inBg || '默认') + ' / ' + (outBg || '默认'));
    const rad = data['cs-bubble-radius'] || '18px';
    const rn = BUBBLE_RADII.find(p => p.value === rad);
    out.push('圆角 ' + (rn ? rn.label : rad));
    const fs = data['cs-font-size'] || '14px';
    const fnl = FONT_SIZES.find(p => p.value === fs);
    out.push('字号 ' + (fnl ? fnl.label : fs));
    if (data['cs-bubble-css']) out.push('自定义CSS');
    if (data['cs-bg']) out.push('壁纸');
    const av = data['cs-av-shape'];
    if (av) out.push('头像 ' + ({ circle: '圆形', round: '圆角', square: '方形' }[av] || av));
    return out;
  }
  // 保存方案的确认弹窗：实时预览 + 当前设置摘要 + 命名（可视可确认再存）
  function chatSaveModalEl() {
    let m = document.getElementById('chat-beauty-save-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'chat-beauty-save-modal'; m.hidden = true;
      m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
    }
    return m;
  }
  window.saveChatBeautyScheme = function () {
    const x = chatSaveModalEl();
    x.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'box-sizing:border-box;width:min(84vw,340px);max-height:84vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
    const hd = document.createElement('div');
    hd.style.cssText = 'font-size:15px;font-weight:700;text-align:center;margin-bottom:12px';
    hd.textContent = '保存当前为聊天美化方案';
    const data = collectChatBeauty();
    const pv = document.createElement('div');
    pv.innerHTML = chatSchemeThumb(data);
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10.5px;color:var(--muted,#999);margin:8px 0 6px';
    sub.textContent = '正在保存的当前设置：';
    const sum = document.createElement('div');
    sum.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px';
    const chips = chatBeautySummary(data);
    if (!chips.length) { const e = document.createElement('span'); e.textContent = '以上传壁纸/气泡等设置为主'; e.style.cssText = 'font-size:10.5px;color:var(--muted,#999)'; sum.appendChild(e); }
    else chips.forEach(c => { const el = document.createElement('span'); el.textContent = c; el.style.cssText = 'font-size:10.5px;color:var(--muted,#666);background:var(--card-soft,#f2f3f5);border:1px solid var(--card-border,#eee);padding:2px 8px;border-radius:999px'; sum.appendChild(el); });
    const inp = document.createElement('input');
    inp.placeholder = '例如：简约白、情侣粉气泡…'; inp.maxLength = 20;
    inp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)';
    const act = document.createElement('div');
    act.style.cssText = 'display:flex;gap:8px;margin-top:13px;justify-content:flex-end';
    const cancel = mkBtn('取消', 'font-size:12.5px;padding:7px 14px;border:1px solid var(--card-border,#eee);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => { x.style.display = 'none'; x.hidden = true; });
    const ok = mkBtn('保存方案', 'font-size:12.5px;padding:7px 14px;border:none;border-radius:9px;background:var(--ink,#111);color:#fff', () => {
      const name = (inp.value || '').trim();
      if (!name) { inp.style.borderColor = '#e05a5a'; return; }
      const list = getChatSchemes();
      list.push({ name, time: Date.now(), data });
      saveChatSchemesList(list);
      x.style.display = 'none'; x.hidden = true;
      toast('已保存方案「' + name + '」，所有桌面通用');
      const m = document.getElementById('chat-beauty-scheme-manager');
      if (m && !m.hidden) window.openChatBeautySchemes();
    });
    act.appendChild(cancel); act.appendChild(ok);
    wrap.appendChild(hd); wrap.appendChild(pv); wrap.appendChild(sub); wrap.appendChild(sum); wrap.appendChild(inp); wrap.appendChild(act);
    x.appendChild(wrap);
    x.style.display = 'flex'; x.hidden = false;
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
  };
  // v3.25.x：聊天方案预览——暂存当前聊天美化 → 应用所选方案（即时生效，可还原）
  let chatPreviewBackup = null;
  function chatPreviewBarEl() {
    let bar = document.getElementById('chat-beauty-preview-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'chat-beauty-preview-bar';
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:96;margin:12px;padding:12px 14px;background:var(--card-bg,#fff);color:var(--ink,#111);border:1px solid var(--card-border,#eee);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;align-items:center;gap:10px';
      document.body.appendChild(bar);
    }
    return bar;
  }
  function chatStartPreview(s, m) {
    if (!s) return;
    chatPreviewBackup = collectChatBeauty();
    hideChatSchemeModal(m);
    applyChatBeautyData(s.data || {});
    const bar = chatPreviewBarEl();
    bar.innerHTML = '';
    const tx = document.createElement('div'); tx.style.flex = '1'; tx.style.fontSize = '13px';
    tx.innerHTML = '正在预览「<b>' + s.name + '</b>」<div style="font-size:11px;color:var(--muted,#999)">去聊天页查看效果，点「使用」保存 / 「还原」恢复</div>';
    const re = mkBtn('还原', 'font-size:12px;padding:6px 12px;border:1px solid var(--card-border,#eee);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => {
      if (chatPreviewBackup) applyChatBeautyData(chatPreviewBackup);
      chatPreviewBackup = null; bar.style.display = 'none'; toast('已还原');
    });
    const keep = mkBtn('使用这个方案', 'font-size:12px;padding:6px 12px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => {
      chatPreviewBackup = null; bar.style.display = 'none'; toast('已应用「' + s.name + '」');
    });
    bar.appendChild(tx); bar.appendChild(re); bar.appendChild(keep);
    bar.style.display = 'flex';
  }
  // v3.25.x：重命名聊天方案
  function renameChatScheme(idx, m) {
    const list = getChatSchemes();
    const s = list[idx];
    if (!s || !window.openModal) return;
    const ctl = window.openModal('编辑方案名称', s.name, (name) => {
      name = (name || '').trim();
      if (!name) { ctl.hint('名称不能为空'); ctl.stay(); return; }
      s.name = name; saveChatSchemesList(list); toast('已重命名');
      window.openChatBeautySchemes();
    }, { maxlength: 20, placeholder: '输入方案名称' });
  }
  window.openChatBeautySchemes = function () {
    const m = chatSchemeModalEl();
    m.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    const head = document.createElement('div');
    head.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:4px">聊天美化方案</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">方案在所有联系人桌面通用（含气泡颜色/CSS、背景图、字体、时间轴等），点「应用」一键切换当前聊天外观</div>';
    box.appendChild(head);
    const list = document.createElement('div'); list.className = 'cm-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0';
    const schemes = getChatSchemes();
    if (!schemes.length) {
      const empty = document.createElement('div');
      empty.innerHTML = '<div style="font-size:13px;color:var(--muted,#999);text-align:center;padding:20px 0">还没有保存的聊天美化方案<br>先点下方「保存当前为方案」</div>';
      list.appendChild(empty);
    }
    schemes.forEach((s, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px';
      const th = document.createElement('div');
      th.innerHTML = chatSchemeThumb(s.data || {});
      row.appendChild(th);
      const nm = document.createElement('div');
      const t = new Date(s.time || Date.now());
      const ds = (t.getMonth() + 1) + '-' + t.getDate();
      nm.innerHTML = '<div style="font-size:14px;font-weight:600;word-break:break-all">' + s.name + '</div><div style="font-size:11px;color:var(--muted,#999)">保存于 ' + ds + '</div>';
      row.appendChild(nm);
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap';
      btns.appendChild(mkBtn('预览', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => chatStartPreview(s, m)));
      btns.appendChild(mkBtn('应用', 'font-size:12px;padding:4px 10px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => applyChatScheme(i, m)));
      btns.appendChild(mkBtn('改名', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => renameChatScheme(i, m)));
      btns.appendChild(mkBtn('删除', 'font-size:12px;padding:4px 10px;border:1px solid rgba(163,45,45,.35);border-radius:8px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d)', () => deleteChatScheme(i, m)));
      row.appendChild(btns);
      list.appendChild(row);
    });
    box.appendChild(list);
    // v3.26.x：导出/导入聊天美化方案
    const opera = document.createElement('div');
    opera.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
    const exBtn = mkBtn('导出方案', 'flex:1;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;font-weight:600', () => chatSchemeExport());
    const imBtn = mkBtn('导入方案', 'flex:1;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;font-weight:600', () => chatSchemeImport());
    opera.appendChild(exBtn); opera.appendChild(imBtn);
    box.appendChild(opera);
    const save = document.createElement('button');
    save.textContent = '+ 保存当前为方案';
    save.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600';
    save.addEventListener('click', () => { window.saveChatBeautyScheme(); });
    box.appendChild(save);
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
    close.addEventListener('click', () => hideChatSchemeModal(m));
    box.appendChild(close);
    m.appendChild(box);
    m.style.display = 'flex'; m.hidden = false;
  };
  const chatBeautySaveRow = document.getElementById('row-chat-beauty-save');
  if (chatBeautySaveRow) chatBeautySaveRow.addEventListener('click', () => window.saveChatBeautyScheme());
  const chatBeautySchemesRow = document.getElementById('row-chat-beauty-schemes');
  if (chatBeautySchemesRow) chatBeautySchemesRow.addEventListener('click', () => window.openChatBeautySchemes());

  // 聊天设置页：顶部标签切换（美化 / 功能 / 数据），复用 .them-tabs/.them-sec 结构互斥显示
  (function initChatSettingsTabs() {
    const tabsEl = document.getElementById('cs-tabs');
    const page = document.getElementById('page-chat-settings');
    if (!tabsEl || !page) return;
    const tabs = tabsEl.querySelectorAll('.them-tab');
    const secs = page.querySelectorAll('.them-sec');
    function show(name) {
      secs.forEach(s => { s.hidden = (s.dataset.sec !== name); });
      tabs.forEach(t => { t.classList.toggle('active', t.dataset.tab === name); });
    }
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    show(tabs[0] ? tabs[0].dataset.tab : 'beautify');
  })();

  // v3.29.x：功能页二级 tag 分类——点击 tag 只显示对应分组（gs-title/set-group 成对 data-tag）。
  // v3.34.x：去掉「全部」tab 后，进页即按默认选中项过滤（不再默认全显）；过滤抽成 applyFilter，
  // 初始化与点击共用。既有 verify 运行时锚（按 id/文本定位）不受影响——被隐藏的分组仍可 querySelector 到。
  (function initCsFuncTags() {
    const tagsEl = document.getElementById('cs-func-tags');
    const page = document.getElementById('page-chat-settings');
    if (!tagsEl || !page) return;
    const sec = page.querySelector('.them-sec[data-sec="function"]');
    if (!sec) return;
    const pairs = Array.from(sec.querySelectorAll('.gs-title[data-tag], .set-group[data-tag]'));
    function applyFilter(ft) {
      pairs.forEach(el => { el.hidden = (ft !== 'all' && el.dataset.tag !== ft); });
    }
    tagsEl.addEventListener('click', (e) => {
      const t = e.target.closest('.them-tab');
      if (!t) return;
      tagsEl.querySelectorAll('.them-tab').forEach(x => x.classList.toggle('active', x === t));
      applyFilter(t.dataset.ft || 'all');
    });
    const def = tagsEl.querySelector('.them-tab.active');
    applyFilter(def ? (def.dataset.ft || 'all') : 'all');
  })();

  // ================= 导出 / 导入聊天记录（数据，与清空同组） =================
  // 导出：打包为独立 JSON 下载（聊天记录可能含图片 dataURL，体积大也直接下载，不走 localStorage）
  const csExport = row('cs-export-msgs');
  if (csExport) {
    csExport.addEventListener('click', () => {
      if (!window.chatExportMsgs && !window.getChatMsgs) { toast('聊天记录暂不可用'); return; }
      toast('正在导出，请稍候…');
      try {
        if (window.chatFlushSave) window.chatFlushSave();
        // v3.26.x：getChatMsgs 取引用免 slice 复制 950MB（slice 会使堆翻倍 OOM）
        const arr = window.getChatMsgs ? window.getChatMsgs() : window.chatExportMsgs();
        const n = Array.isArray(arr) ? arr.length : 0;
        if (!n) { toast('没有聊天记录可导出'); return; }
        // v3.26.x：流式构建 JSON——每条消息单独 stringify 放进 Blob 数组拼接，
        // 避免单次 JSON.stringify 整包超 V8 字符串长度上限（~512MB）报 Invalid string length
        const parts = ['{"app":"mochi-zika-chat","version":"1.0","exportTime":"' + new Date().toISOString() + '","msgs":['];
        for (let i = 0; i < n; i++) {
          if (i) parts.push(',');
          parts.push(JSON.stringify(arr[i]));
        }
        parts.push(']}');
        const blob = new Blob(parts, { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '聊天记录_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('已导出 ' + n + ' 条聊天记录');
      } catch (e) {
        toast('导出失败：' + (e && e.message || '未知错误'));
      }
    });
  }
  // 导入：读取 JSON → 校验 → 预览摘要二次确认 → 覆盖当前记录
  const csImport = row('cs-import-msgs');
  if (csImport) {
    csImport.addEventListener('click', () => {
      // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
      window.mochiFilePick({
        id: 'mochi-cs-import-pick', accept: '.json,application/json',
        onFiles: (files) => {
        const f = files && files[0];
        if (!f) { toast('没有取到文件，请再选一次'); return; }
        // FileReader 全兼容（旧 iOS File.text() 不支持）
        const reader = new FileReader();
        reader.onload = () => {
          let data;
          try { data = JSON.parse(String(reader.result || '')); } catch (e) { toast('无效的聊天记录文件'); return; }
          if (!data || typeof data !== 'object') { toast('无效的聊天记录文件'); return; }
          // 兼容三种结构：本功能导出的 {app,msgs} / 裸数组 / 整份 mochi 备份（取其中聊天记录）
          let arr = Array.isArray(data) ? data : null;
          if (!arr && data.msgs && Array.isArray(data.msgs)) arr = data.msgs;
          if (!arr && data.ls && typeof data.ls === 'object') {
            const raw = (data.idb && data.idb['xy-home-v2:chat-msgs']) || data.ls['xy-home-v2:chat-msgs'];
            try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { arr = null; }
          }
          if (!Array.isArray(arr) || !arr.length) { toast('文件里没有聊天记录数据'); return; }
          const n = arr.length;
          const fmt = (t) => t ? new Date(t).toLocaleString() : '未知';
          const lines = ['文件包含 ' + n + ' 条消息：',
            '· 最早：' + fmt(arr[0] && arr[0].ts),
            '· 最新：' + fmt(arr[n - 1] && arr[n - 1].ts),
            '导入将覆盖当前全部聊天记录（不可恢复）。'];
          if (!window.openModal) return;
          window.openModal('确认导入聊天记录？', '', () => {
            if (window.chatImportMsgs && window.chatImportMsgs(arr)) toast('已导入 ' + n + ' 条聊天记录');
            else toast('导入失败');
          }, { noInput: true, staticText: lines.join('\n') });
        };
        reader.onerror = () => { toast('文件读取失败，请重试'); };
        reader.readAsText(f, 'utf-8');
        }
      });
    });
  }

  // v3.36.x：#471 设置页「导出/导入全部桌面聊天记录」——导出与顶部备份提醒条「备份聊天」
  // 同入口（runChatAllExport 复用 doExport('chat')，CHAT_KEY_RE 匹配全部桌面命名空间）；
  // 导入支持标准 mochi 备份文件（按桌面 key 分路写回各桌面）与单桌 {app,msgs} 文件
  //（归入当前桌面），由 data-backup.js 的 runChatAllImport 负责读文件+预览+确认+写回。
  const csExportAll = row('cs-export-all');
  if (csExportAll) {
    csExportAll.addEventListener('click', () => {
      if (!window.runChatAllExport) { toast('导出功能暂不可用'); return; }
      window.runChatAllExport();
    });
  }
  const csImportAll = row('cs-import-all');
  if (csImportAll) {
    csImportAll.addEventListener('click', () => {
      if (!window.runChatAllImport) { toast('导入功能暂不可用'); return; }
      window.runChatAllImport();
    });
  }

  // ================= 删除全部聊天记录（危险操作，二次确认） =================
  const csClear = row('cs-clear-msgs');
  if (csClear) {
    csClear.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('确认删除全部聊天记录？（双方所有消息将被清空，且不可恢复）', '', () => {
        if (window.clearChatHistory) window.clearChatHistory();
        toast('聊天记录已清空');
      }, { noInput: true });
    });
  }

  // v3.5.93：聊天壁纸/上传字体等大键可能只存在 IndexedDB（导入兜底写入/大键只进 IDB）——
  // 启动时从 IDB 补读后重新应用
  try {
    if (window.idbGet) {
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':cs-bg').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !store.get('cs-bg')) {
          store.set('cs-bg', v);
          applySettings();
        }
      });
      window.idbGet(myPrefix + ':' + FONT_KEY).then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !fontVal()) {
          fontSet(v);
          applyFont();
          csFontChanged();
        }
      });
      // v3.14.x：气泡 CSS 同款兜底——LS 写失败（配额满）或被浏览器清理后值只剩 IDB 副本，
      // boot 时 applyCss 跑在回填前读空 → 重进后退回默认气泡（荣耀200Pro Edge 实测）。
      // 启动补读 + 重应用（applyCss 幂等）
      window.idbGet(myPrefix + ':' + CSS_KEY).then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 0 && !store.get(CSS_KEY)) {
          store.set(CSS_KEY, v);
          applyCss();
        }
      });
    }
  } catch (e) {}
  // v3.7.x 修复：上传字体 dataURL 属大键（>200KB）只进 IDB+memoryCache、localStorage 被删，
  //   刷新后 memoryCache 清空。本文件初始化时同步调用的 applyFont() 已跑过（当时无数据），
  //   上方 idbGet 补读又被 !store.get() 条件跳过（idbRestore 先回填 memoryCache 时）→
  //   字体刷新后不应用。数据就绪后兜底再应用一次（applyFont 幂等，重复调用安全）
  document.addEventListener('mochi-restore-done', function () {
    // #628：上传的字体是 dataURL 大键（只进 IDB+memoryCache），回填完成才读得到——中间版
    // 「全局字体」残留根键的回填在此补一次（小值在上面初始化时已处理）
    try { demoteFontGlobal(); } catch (e) {}
    try { applyFont(); } catch (e) {}
    try { applyProfile(); } catch (e) {}
    // v3.14.x：气泡 CSS 补应用——boot 时 applyCss 跑在 IDB 回填完成前（值只在 IDB 时
    // 读空不注入），字体/头像此前有本兜底而气泡 CSS 漏了 → 重进后回退默认气泡。
    // applyCss 幂等：会话内已写入时 memoryCache 值更新，重应用无副作用
    try { applyCss(); } catch (e) {}
  });
  // v3.6.x：多桌面——切换联系人后重新应用聊天美化（壁纸/气泡颜色/字号/形状/字体均按新桌面）
  // v3.9.x 修复：气泡 CSS / 全局字体也是按联系人存储（cs-bubble-css / cs-font），但注入的
  // <style>（cs-bubble-style / cs-font-style）是全局标签，切换联系人后必须一并重应用/清除，
  // 否则 A 桌面的自定义气泡样式/字体会一直盖在 B 桌面上（改一个联系人所有联系人的气泡都跟着变）。
  // #628：字体加了「同值不重复注入」守卫，切到字体相同的桌面时不会重建 MB 级 @font-face。
  document.addEventListener('contact-switched', function () {
    try { applySettings(); } catch (e) {}
    try { applyProfile(); } catch (e) {}
    try { applyCss(); } catch (e) {}
    try { applyFont(); } catch (e) {}
  });

  // ===== v3.26.x：镜像开关轮询合并为单一 ticker（iOS 卡顿收口）=====
  // 下方六处「聊天设置页 ⇄ 设置页/存储」镜像开关各写了一个 setInterval(sync,500)，
  // 且句柄全部丢弃（永不可清）——boot 起常驻 6 个定时器，每秒 12 次读 checkbox /
  // localStorage，不管用户在不在这一页。合并成一个共享 ticker：
  //   · 仅在 #page-chat-settings 未 hidden 且文档 visible 时运行，离页/切后台即停；
  //   · 进页当帧先跑一次（不等 500ms，避免开关显示滞后）；
  //   · contact-switched（按桌面存的值会变）立即补跑一次。
  const _csTicker = { fns: [], timer: 0 };
  function csAddSync(fn) { _csTicker.fns.push(fn); }
  function _csRun() {
    for (let i = 0; i < _csTicker.fns.length; i++) { try { _csTicker.fns[i](); } catch (e) {} }
  }
  function _csTickOn() {
    if (_csTicker.timer) return;
    _csRun();
    _csTicker.timer = setInterval(_csRun, 500);
  }
  function _csTickOff() {
    if (_csTicker.timer) { clearInterval(_csTicker.timer); _csTicker.timer = 0; }
  }
  (function () {
    const page = document.getElementById('page-chat-settings');
    if (!page) return;
    const want = () => {
      if (!page.hidden && document.visibilityState === 'visible') _csTickOn();
      else _csTickOff();
    };
    try { new MutationObserver(want).observe(page, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
    document.addEventListener('visibilitychange', want);
    document.addEventListener('contact-switched', function () { if (_csTicker.timer) _csRun(); });
    want();
  })();

  // v3.7.x：聊天设置顶部的「全屏模式」开关——镜像设置页 #sf-fullscreen（同一状态）。
  // 本页切换 → 代理到设置页开关并派发 change（走 fullscreen.js 全流程：原生全屏/CSS
  // 兜底/iOS 分支/失败回滚）；设置页或系统（fullscreenchange/切后台恢复/失败回滚）
  // 更新 sf-fullscreen 后，轮询把状态同步回本页开关。fullscreen.js 程序化赋值只改
  // property 不产生 attribute mutation，故用 500ms 轮询而非 MutationObserver。
  const csFs = document.getElementById('cs-fullscreen');
  const sfFs = document.getElementById('sf-fullscreen');
  if (csFs && sfFs) {
    const syncCsFs = () => { if (sfFs.checked !== csFs.checked) csFs.checked = sfFs.checked; };
    syncCsFs();
    csFs.addEventListener('change', () => {
      if (csFs.checked === sfFs.checked) return;
      sfFs.checked = csFs.checked;
      sfFs.dispatchEvent(new Event('change', { bubbles: true }));
    });
    csAddSync(syncCsFs);
  }

  // v3.9.x：聊天设置「全屏边缘防误触」开关——镜像设置页 #sf-edge-guard（同一状态双向同步）。
  // 仿 cs-fullscreen 模式：本页切换代理到设置页开关并派发 change（走 fullscreen.js
  // 边缘拦截层启停流程）；设置页变化 500ms 轮询同步回本页。
  const csEg = document.getElementById('cs-edge-guard');
  const sfEg = document.getElementById('sf-edge-guard');
  if (csEg && sfEg) {
    const syncCsEg = () => { if (sfEg.checked !== csEg.checked) csEg.checked = sfEg.checked; };
    syncCsEg();
    csEg.addEventListener('change', () => {
      if (csEg.checked === sfEg.checked) return;
      sfEg.checked = csEg.checked;
      sfEg.dispatchEvent(new Event('change', { bubbles: true }));
    });
    csAddSync(syncCsEg);
  }

  // v3.7.x：聊天设置「隐藏音乐悬浮小窗」开关——与音乐页 #music-float-en / 音乐设置
  // #sm-set-float 同源（music-global.floatEn，每桌面独立）。本开关语义反转：勾选=隐藏，
  // 与「隐藏通话小框」一致（音乐页/音乐设置里仍是勾选=开启）。本文件先于 music-player.js
  // 加载，故优先走 window.musicFloatGet/Set 钩子（完整走保存+悬浮框渲染流程）；
  // 钩子未就绪时退化为直读写 store（切换桌面/初始态兜底，浮框由音乐模块下次渲染兜住）。
  const csMf = document.getElementById('cs-music-float');
  if (csMf) {
    const mfGet = () => { // 返回「隐藏中」= !floatEn；floatEn 默认开 → 默认不隐藏
      if (window.musicFloatGet) return !window.musicFloatGet();
      try {
        const s = JSON.parse(store.get('music-global') || '{}');
        return s.floatEn !== undefined ? !s.floatEn : false;
      } catch (e) { return false; }
    };
    const mfSet = (hide) => {
      if (window.musicFloatSet) { window.musicFloatSet(!hide); return; }
      try {
        const s = JSON.parse(store.get('music-global') || '{}');
        s.floatEn = !hide;
        store.set('music-global', JSON.stringify(s));
      } catch (e) {}
    };
    const syncCsMf = () => { const v = mfGet(); if (v !== csMf.checked) csMf.checked = v; };
    syncCsMf();
    csMf.addEventListener('change', () => {
      if (csMf.checked === mfGet()) return;
      mfSet(csMf.checked);
      toast(csMf.checked ? '音乐悬浮小窗已隐藏：播放时不再显示右上角悬浮小框' : '音乐悬浮小窗已恢复显示：播放时右上角出现悬浮小框');
    });
    // 音乐页/音乐设置/桌面部件改动或切桌面后 500ms 内同步回本页开关
    csAddSync(syncCsMf);
    document.addEventListener('contact-switched', syncCsMf);
  }

  // v3.7.x：聊天设置「隐藏通话小框」开关——与通话半框/通话模块同源
  // （call-mini-enabled，每桌面独立，默认显示小框）。本开关语义反转：勾选=隐藏。
  // 优先走 window.getCallMiniEnabled/setCallMiniEnabled 钩子（call.js 暴露）；
  // 钩子未就绪时退化为直读写 store（call-mini-enabled !== '0' 即显示）。
  const csCmh = document.getElementById('cs-call-mini-hide');
  if (csCmh) {
    const cmhGet = () => {
      if (window.getCallMiniEnabled) return !window.getCallMiniEnabled();
      try { return store.get('call-mini-enabled') === '0'; } catch (e) { return false; }
    };
    const cmhSet = (hide) => {
      if (window.setCallMiniEnabled) { window.setCallMiniEnabled(!hide); return; }
      try { store.set('call-mini-enabled', hide ? '0' : '1'); } catch (e) {}
    };
    const syncCsCmh = () => { const v = cmhGet(); if (v !== csCmh.checked) csCmh.checked = v; };
    syncCsCmh();
    csCmh.addEventListener('change', () => {
      if (csCmh.checked === cmhGet()) return;
      cmhSet(csCmh.checked);
      toast(csCmh.checked ? '通话小框已隐藏：接通后保持通话面板，不弹出悬浮小框' : '通话小框已开启：接通后自动最小化为悬浮小框');
    });
    csAddSync(syncCsCmh);
    document.addEventListener('contact-switched', syncCsCmh);
  }

  // v3.8.x：主设置页「开启群聊」开关——每桌面独立（group-chat-enabled，默认关闭）。
  // 开启后桌面聊天按钮右侧显示「群聊」按钮、占卜按钮隐藏（移到隐藏池，可在装修模式添加到其他页）；
  // 关闭恢复原样。写回后广播 group-chat-mode-changed 事件，personalize.js 响应调整桌面图标。
  const sfGc = document.getElementById('sf-group-chat');
  if (sfGc) {
    // v3.10.x：群聊是全局功能（消息/形象/回复设置均全局存根命名空间），开关也改为
    // 全局存储——原按每桌面隔离（activeStore），切换到新桌面读不到该键→群聊按钮自己
    // 消失（用户反馈"开启群聊后切换桌面没保存"）。读时回退旧版每桌面值完成迁移。
    const GNS = 'xy-home-v2';
    const gcGet = () => {
      try { const v = window.xyStore ? window.xyStore(GNS).get('group-chat-enabled') : null; if (v !== null && v !== undefined) return v === '1'; } catch (e) {}
      try { return store.get('group-chat-enabled') === '1'; } catch (e) { return false; }
    };
    const gcSet = (en) => { try { if (window.xyStore) window.xyStore(GNS).set('group-chat-enabled', en ? '1' : '0'); } catch (e) {} };
    const syncGc = () => { const v = gcGet(); if (v !== sfGc.checked) sfGc.checked = v; };
    syncGc();
    sfGc.addEventListener('change', () => {
      if (sfGc.checked === gcGet()) return;
      gcSet(sfGc.checked);
      try { document.dispatchEvent(new Event('group-chat-mode-changed')); } catch (e) {}
      toast(sfGc.checked ? '群聊已开启：桌面新增群聊按钮，占卜按钮已隐藏（可在美化装修模式添加到其他页面）' : '群聊已关闭，占卜按钮已恢复');
    });
    csAddSync(syncGc);
    document.addEventListener('contact-switched', syncGc);
  }

  // v3.10.x：「允许删除联系人消息」开关——默认关闭，每联系人独立。开启后点击 TA 消息
  // 弹出的操作菜单里多出「删除」按钮，可永久移除该条 TA 消息（真删除，不可恢复）。
  const csDtm = document.getElementById('cs-del-ta-msg');
  if (csDtm) {
    const dtmGet = () => { try { return store.get('cs-del-ta-msg') === '1'; } catch (e) { return false; } };
    const dtmSet = (en) => { try { store.set('cs-del-ta-msg', en ? '1' : '0'); } catch (e) {} };
    const syncDtm = () => { const v = dtmGet(); if (v !== csDtm.checked) csDtm.checked = v; };
    syncDtm();
    csDtm.addEventListener('change', () => {
      if (csDtm.checked === dtmGet()) return;
      dtmSet(csDtm.checked);
      toast(csDtm.checked ? '已开启：点击联系人消息可在操作菜单里删除该条消息' : '已关闭删除联系人消息功能');
    });
    document.addEventListener('contact-switched', syncDtm);
  }

  // v3.11.x：「批量发送消息」开关——默认关闭，每联系人独立。开启后聊天输入栏右侧显示
  // 「批量发送」按钮：可插入表情包/图片/文字，每个项目一条消息，多条按顺序批量发送。
  // 存 cs-batch-send，chat.js 读同一键控制按钮显隐。
  const csBs = document.getElementById('cs-batch-send');
  if (csBs) {
    const bsGet = () => { try { return store.get('cs-batch-send') === '1'; } catch (e) { return false; } };
    const bsSet = (en) => { try { store.set('cs-batch-send', en ? '1' : '0'); } catch (e) {} };
    const syncBs = () => { const v = bsGet(); if (v !== csBs.checked) csBs.checked = v; };
    syncBs();
    csBs.addEventListener('change', () => {
      if (csBs.checked === bsGet()) return;
      bsSet(csBs.checked);
      // 通知聊天页即时刷新「批量发送」按钮显隐（不依赖切联系人）
      try { document.dispatchEvent(new Event('batch-send-changed')); } catch (e) {}
      toast(csBs.checked ? '已开启：聊天输入栏右侧显示「批量发送」按钮，可插入表情包/图片/文字批量发送' : '已关闭：聊天输入栏「批量发送」按钮已隐藏');
    });
    document.addEventListener('contact-switched', syncBs);
  }

  // v3.16.x：「我可发送语音」开关——默认关闭，每联系人独立。开启后聊天输入栏左侧显示
  // 「麦克风」按钮：点击打开录音半框，录完可试听并作为语音消息发送进聊天。
  // 存 cs-voice-send，chat.js 读同一键控制按钮显隐与录音逻辑。
  const csVs = document.getElementById('cs-voice-send');
  if (csVs) {
    const vsGet = () => { try { return store.get('cs-voice-send') === '1'; } catch (e) { return false; } };
    const vsSet = (en) => { try { store.set('cs-voice-send', en ? '1' : '0'); } catch (e) {} };
    const syncVs = () => { const v = vsGet(); if (v !== csVs.checked) csVs.checked = v; };
    syncVs();
    csVs.addEventListener('change', () => {
      // v3.26.x：去掉「与存储值相同则静默早退」守卫——idbRestore 异步回填 memoryCache
      // 晚于本模块初始化时，存储值可能是回填进来的旧值而开关 UI 未重同步（荣耀/Edge 杀
      // 进程回滚 LS 场景，见 idb.js 小键写日志），第一次点按会被守卫静默吃掉，表现为
      // 「点一次没反应，点第二次才生效」。change 只由用户点按触发，直接按 UI 状态写入。
      vsSet(csVs.checked);
      // 通知聊天页即时刷新「麦克风」按钮显隐（不依赖切联系人）
      try { document.dispatchEvent(new Event('voice-send-changed')); } catch (e) {}
      toast(csVs.checked ? '已开启：聊天输入栏左侧显示「麦克风」按钮，点击可录音并发送语音' : '已关闭：聊天输入栏「麦克风」按钮已隐藏');
    });
    document.addEventListener('contact-switched', syncVs);
    // v3.26.x：启动回填/写日志合并把存储值修正后，重同步开关 UI（含已打开的设置页）
    document.addEventListener('mochi-wrj-heal', syncVs);
  }

  // v3.27.x #660：输入栏按钮位置（统一管理）——底部输入栏这一排按钮（含「开关型」的
  // 麦克风/继续说/批量发送与输入框本身）的左右顺序，点行进排序面板。顺序存 cs-input-order
  // （每联系人独立，与 cs-voice-send/cs-batch-send 同域），chat.js 用 flex order 应用到聊天页
  // 与群聊两处输入栏（读 window.mochiInputOrder）。
  // 与三个开关的关系：本项只管「排在哪里」，开关只管「显不显示」，互不覆盖——关着的按钮
  // 仍在排序列表里（标「开关未开启」），开关打开后自动出现在这里保存的位置。
  // 「发送」是固定收尾的动作按钮，不参与排序（列表底部只作展示）。
  const IO_META = {
    mic: { label: '录音（语音消息）', sub: '开关：聊天设置 →「我可发送语音」' },
    continue: { label: '继续说', sub: '开关：回复设置 →「聊天栏继续说按钮」' },
    more: { label: '更多功能' },
    emoji: { label: '表情包' },
    input: { label: '输入框', sub: '位置可调、不可移除；把按钮挪到它前面／后面即换到另一侧' },
    img: { label: '插入图片' },
    batch: { label: '批量发送', sub: '开关：聊天设置 →「批量发送消息」' }
  };
  const IO_SWITCHED = { mic: 1, continue: 1, batch: 1 }; // 带独立开关的项：未开时列表标「开关未开启」
  const IO_BTN_STYLE = 'width:34px;height:34px;flex-shrink:0;border:1px solid var(--card-border,#e0e0e0);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:15px;line-height:1;font-family:inherit;cursor:pointer';
  const inputOrderRead = () => (window.mochiInputOrder ? window.mochiInputOrder.read() : []);
  function inputOrderPanelOpen() {
    const m = document.getElementById('cs-input-order-panel');
    return !!(m && m.style.display === 'flex');
  }
  function inputOrderSync() {
    const el = document.getElementById('cs-input-order-val');
    if (el) el.textContent = (window.mochiInputOrder && !window.mochiInputOrder.isDefault()) ? '已自定义' : '默认排列';
  }
  // 取一排里某个令牌的实时图标：直接借用聊天页输入栏上那个真按钮里的 SVG——
  // 面板不维护第二份图标，按钮换图这里自然跟着换。输入框是 div，没有图标。
  function inputOrderIcon(token) {
    if (token === 'input') return '';
    const src = document.querySelector('#page-chat .chat-input-row [data-io="' + token + '"]');
    return src ? src.innerHTML : '';
  }
  // 该按钮现在是否被开关藏起来了（只看聊天页那排的实时显示态——它就是 chat.js 按开关写的）
  function inputOrderHidden(token) {
    if (!IO_SWITCHED[token]) return false;
    const src = document.querySelector('#page-chat .chat-input-row [data-io="' + token + '"]');
    return !!(src && src.style.display === 'none');
  }
  function inputOrderMove(token, dir) {
    if (!window.mochiInputOrder) return;
    const order = inputOrderRead().slice();
    const i = order.indexOf(token), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    order[i] = order[j];
    order[j] = token;
    window.mochiInputOrder.write(order);
    inputOrderSync();
    renderInputOrderPanel();
  }
  function renderInputOrderPanel() {
    const m = document.getElementById('cs-input-order-panel');
    const box = m && m.firstChild;
    if (!box) return;
    const order = inputOrderRead();
    box.innerHTML = '';
    const hd = document.createElement('div');
    hd.innerHTML = '<div style="font-size:16px;font-weight:600">输入栏按钮位置</div>'
      + '<div style="font-size:12px;color:var(--muted,#888);margin-top:5px;line-height:1.5">'
      + '点 ← → 调整左右顺序（列表自上而下＝从最左到最右）；「发送」按钮固定在最右端，不参与排序。'
      + '此项只影响排列位置，不影响各按钮的开关与显隐。</div>';
    box.appendChild(hd);
    // 预览条：按当前顺序把这一排画出来（含输入框与固定的发送按钮）
    const prev = document.createElement('div');
    prev.style.cssText = 'display:flex;align-items:center;gap:6px;padding:10px;margin:10px 0 12px;border-radius:12px;background:var(--bg-b,#f5f5f5);overflow-x:auto';;
    order.forEach((t) => {
      if (t === 'input') {
        const iw = document.createElement('div');
        iw.textContent = '说点什么…';
        iw.style.cssText = 'flex:1;min-width:46px;font-size:11px;color:var(--hint-ink,#b5b5b5);padding:5px 9px;border-radius:99px;background:var(--card-bg,#fff);border:1px solid rgba(0,0,0,.08);white-space:nowrap;overflow:hidden';
        prev.appendChild(iw);
        return;
      }
      const ic = document.createElement('div');
      ic.innerHTML = inputOrderIcon(t);
      ic.style.cssText = 'width:26px;height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--card-bg,#fff);border:1px solid rgba(0,0,0,.08);color:var(--ink,#111);'
        + (inputOrderHidden(t) ? 'opacity:.35' : '');
      const svg = ic.querySelector('svg');
      if (svg) { svg.style.width = '16px'; svg.style.height = '16px'; }
      prev.appendChild(ic);
    });
    const sendChip = document.createElement('div');
    sendChip.textContent = '发送';
    sendChip.style.cssText = 'flex-shrink:0;font-size:11px;font-weight:600;color:#fff;background:var(--ink,#111);border-radius:99px;padding:5px 12px';
    prev.appendChild(sendChip);
    box.appendChild(prev);
    // 排序列表：每行一个按钮 ＋ ←／→（到两端时对应方向置灰）
    order.forEach((t, idx) => {
      const meta = IO_META[t] || { label: t };
      const rowEl = document.createElement('div');
      rowEl.setAttribute('data-io-row', t); // 稳定钩子：回归脚本按令牌定位「某按钮的左/右移」
      rowEl.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid rgba(0,0,0,.07);border-radius:11px;margin-bottom:8px';
      const ic = document.createElement('div');
      ic.innerHTML = inputOrderIcon(t);
      ic.style.cssText = 'width:22px;height:22px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--ink,#111)';
      const svg = ic.querySelector('svg');
      if (svg) { svg.style.width = '19px'; svg.style.height = '19px'; }
      rowEl.appendChild(ic);
      const txt = document.createElement('div');
      txt.style.cssText = 'flex:1;min-width:0;font-size:13.5px;line-height:1.4';
      const nm = document.createElement('div');
      nm.textContent = meta.label;
      txt.appendChild(nm);
      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:var(--muted,#888);margin-top:1px';
      note.textContent = '第 ' + (idx + 1) + ' 位'
        + (inputOrderHidden(t) ? ' · 开关未开启（打开后按此位置显示）' : (meta.sub ? ' · ' + meta.sub : ''));
      txt.appendChild(note);
      rowEl.appendChild(txt);
      [-1, 1].forEach((dir) => {
        const atEnd = dir < 0 ? idx === 0 : idx === order.length - 1;
        const mv = document.createElement('button');
        mv.type = 'button';
        mv.textContent = dir < 0 ? '←' : '→';
        mv.title = dir < 0 ? '向左移' : '向右移';
        mv.disabled = atEnd;
        mv.setAttribute('data-io-move', String(dir)); // 稳定钩子：-1=向左移，1=向右移
        mv.style.cssText = IO_BTN_STYLE + (atEnd ? ';opacity:.3' : '');
        mv.addEventListener('click', (e) => { e.stopPropagation(); inputOrderMove(t, dir); });
        rowEl.appendChild(mv);
      });
      box.appendChild(rowEl);
    });
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = '恢复默认排列';
    resetBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;margin-bottom:8px;font-family:inherit;cursor:pointer';
    resetBtn.addEventListener('click', () => {
      if (!window.mochiInputOrder) return;
      window.mochiInputOrder.reset();
      inputOrderSync();
      renderInputOrderPanel();
      toast('已恢复默认排列');
    });
    box.appendChild(resetBtn);
    // 顺序是 per-联系人键——一键同步到其他桌面，换聊天对象不用重排一遍（对齐壁纸图库的同步入口）
    if (window.getContacts && window.xyStore && window.openModal) {
      const syncBtn = document.createElement('button');
      syncBtn.type = 'button';
      syncBtn.textContent = '同步到全部联系人';
      syncBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;margin-bottom:8px;font-family:inherit;cursor:pointer';
      syncBtn.addEventListener('click', () => {
        const me = window.getActiveContact ? window.getActiveContact() : 'default';
        const others = window.getContacts().filter(c => c.id && c.id !== me);
        if (!others.length) { toast('现在只有这一个联系人，无需同步'); return; }
        window.openModal('同步到全部联系人', '', (v) => {
          if (v !== '__yes__') return;
          const order = inputOrderRead();
          let n = 0;
          others.forEach((c) => {
            try {
              window.xyStore('xy-home-v2:' + c.id).set('cs-input-order', JSON.stringify(order));
              n++;
            } catch (e) {}
          });
          toast('已同步到 ' + n + ' 个联系人（切到对应桌面即可看到）');
        }, { noInput: true, pills: [{ label: '确认同步（覆盖对方的输入栏顺序）', value: '__yes__' }, { label: '取消', value: '__no__' }] });
      });
      box.appendChild(syncBtn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555);font-size:13px;font-family:inherit;cursor:pointer';
    closeBtn.addEventListener('click', closeInputOrderPanel);
    box.appendChild(closeBtn);
  }
  // 开合同时改 hidden 属性与 display：mobile-adapt 的浮层滚动锁只监听 hidden
  //（attributeFilter:['hidden']），只改 display 的话要等它 1s 看门狗才补挂锁——那 1 秒里
  // 面板开着、底层设置页还能被滑动。hidden 一起改＝插入时即命中锁，无空窗。
  function closeInputOrderPanel() {
    const m = document.getElementById('cs-input-order-panel');
    if (!m) return;
    m.hidden = true;
    m.style.display = 'none';
  }
  function openInputOrderPanel() {
    let m = document.getElementById('cs-input-order-panel');
    if (!m) {
      m = document.createElement('div');
      m.id = 'cs-input-order-panel';
      m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) closeInputOrderPanel(); });
      const box = document.createElement('div');
      box.style.cssText = 'width:min(90vw,400px);max-height:82vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
      m.appendChild(box);
    }
    renderInputOrderPanel();
    m.hidden = false;
    m.style.display = 'flex';
  }
  const csIo = row('cs-input-order');
  if (csIo) {
    inputOrderSync();
    csIo.addEventListener('click', openInputOrderPanel);
    document.addEventListener('contact-switched', () => {
      inputOrderSync();
      // 面板是挂在 body 上的固定浮层（不在 .page 里，切页面不会跟着隐藏）：切了联系人还留着
      // 就是「盖在桌面上、内容是上一个联系人」的僵尸层，直接收掉，回来再点开即是新桌面的顺序
      closeInputOrderPanel();
    });
    document.addEventListener('chat-input-order-changed', inputOrderSync);
    // 面板开着时开关被改（本页下方就有「批量发送消息」「我可发送语音」两行）→ 重画一遍，
    // 让「开关未开启」标记跟着变，不必关掉面板重开
    document.addEventListener('batch-send-changed', () => { if (inputOrderPanelOpen()) renderInputOrderPanel(); });
    document.addEventListener('voice-send-changed', () => { if (inputOrderPanelOpen()) renderInputOrderPanel(); });
  }
  // 群聊设置里那行（group-chat.js「通用」段）打开的是同一个面板：顺序本就两页共用
  // （chat.js applyInputBtnOrder 给两处 .chat-input-row 的同名 data-io 设 flex order），
  // 面板只有一份、浮在 body 上，所以对外只暴露开合与文案，不复制第二套排序 UI。
  window.mochiInputOrderPanel = {
    open: openInputOrderPanel,
    close: closeInputOrderPanel,
    valueText: () => (window.mochiInputOrder && !window.mochiInputOrder.isDefault() ? '已自定义' : '默认排列')
  };

  // 红包：TA 自动主动发红包概率（每联系人独立，默认 4%，0-100%）。点击弹输入框设百分比；
  // 存 cs-rp-auto-prob，chat.js trySystemAutoSend 读同一键控制 TA 主动发红包的概率门。
  const csRpProb = row('cs-rp-auto-prob');
  if (csRpProb) {
    const rpProbGet = () => {
      let v = null; try { v = parseFloat(store.get('cs-rp-auto-prob')); } catch (e) {}
      return (v !== null && isFinite(v)) ? Math.max(0, Math.min(100, Math.round(v))) : 4;
    };
    const rpProbSync = () => { const el = document.getElementById('cs-rp-auto-prob-val'); if (el) el.textContent = rpProbGet() + '%'; };
    rpProbSync();
    csRpProb.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('TA 自动发红包概率（0-100%·每联系人独立）', String(rpProbGet()), (v) => {
        const t = String(v || '').trim();
        let n = parseFloat(t);
        if (!isFinite(n)) n = 4;
        n = Math.max(0, Math.min(100, Math.round(n)));
        store.set('cs-rp-auto-prob', String(n));
        rpProbSync();
        toast('已设置：TA 自动发红包概率为 ' + n + '%');
      }, { maxlength: 3 });
    });
    document.addEventListener('contact-switched', rpProbSync);
    // v3.29.x：红包设置已移入聊天页红包半框（#chat-rp-panel「设置」按钮），聊天设置页
    // ticker 不再同步；改由 chat.js openRpPanel() 调用 window.csRpSettingsSync 主动同步。
    if (typeof window !== 'undefined') window.csRpSyncProb = rpProbSync;
  }

  // v3.28.x：TA 每日发红包上限次数（每联系人独立，默认 5，0=不限）。存 cs-rp-daily-max，
  // chat.js trySystemAutoSend 读同一键做当日自动发红包次数闸门。
  const csRpDailyMax = row('cs-rp-daily-max');
  if (csRpDailyMax) {
    const rpMaxGet = () => {
      let v = null; try { v = parseInt(store.get('cs-rp-daily-max'), 10); } catch (e) {}
      return (v !== null && isFinite(v) && v >= 0) ? v : 5;
    };
    const rpMaxSync = () => { const el = document.getElementById('cs-rp-daily-max-val'); if (el) el.textContent = rpMaxGet() === 0 ? '不限' : rpMaxGet() + ' 次'; };
    rpMaxSync();
    csRpDailyMax.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('TA 每日发红包上限（0-99 次·0=不限）', String(rpMaxGet()), (v) => {
        let n = parseInt(String(v || '').trim(), 10);
        if (!isFinite(n)) n = 5;
        n = Math.max(0, Math.min(99, n));
        store.set('cs-rp-daily-max', String(n));
        rpMaxSync();
        toast(n === 0 ? '已设置：TA 每日发红包不限次数' : '已设置：TA 每天最多发 ' + n + ' 个红包');
      }, { maxlength: 2 });
    });
    document.addEventListener('contact-switched', rpMaxSync);
    // v3.29.x：组合同步入口统一在下方申请两行之后定义（一次刷新四行），此处只挂各自入口。
    if (typeof window !== 'undefined') window.csRpSyncMax = rpMaxSync;
  }

  // v3.29.x：TA 申请心意币的概率 / 每日上限——原来藏在存钱罐「心意币存钱」右上角设置的全局两项，
  // 移到红包半框「设置」里按联系人单独设（与自动发红包两行同入口）。显示值复用 chat.js 挂出的
  // window.rpAskProbRate / window.rpAskDailyMax（内含「本联系人没单独设过 → 回退旧存钱罐全局根键」
  // 的默认口径），本文件只负责写入当前联系人命名空间，消费方是 chat.js trySystemAskMochi。
  const csRpAskProb = row('cs-rp-ask-prob');
  if (csRpAskProb) {
    const rpAskProbGet = () => {
      let r = 0.04; try { if (window.rpAskProbRate) r = window.rpAskProbRate(); } catch (e) {}
      return Math.max(0, Math.min(100, Math.round(r * 100)));
    };
    const rpAskProbSync = () => { const el = document.getElementById('cs-rp-ask-prob-val'); if (el) el.textContent = rpAskProbGet() + '%'; };
    rpAskProbSync();
    csRpAskProb.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('TA 申请心意币概率（0-100%·每联系人独立）', String(rpAskProbGet()), (v) => {
        let n = parseFloat(String(v || '').trim());
        if (!isFinite(n)) n = 4;
        n = Math.max(0, Math.min(100, Math.round(n)));
        store.set('cs-rp-ask-prob', String(n));
        rpAskProbSync();
        toast('已设置：TA 申请心意币概率为 ' + n + '%');
      }, { maxlength: 3 });
    });
    document.addEventListener('contact-switched', rpAskProbSync);
    if (typeof window !== 'undefined') window.csRpSyncAskProb = rpAskProbSync;
  }

  const csRpAskMax = row('cs-rp-ask-daily-max');
  if (csRpAskMax) {
    const rpAskMaxGet = () => {
      let v = 0; try { if (window.rpAskDailyMax) v = window.rpAskDailyMax(); } catch (e) {}
      return (isFinite(v) && v >= 0) ? v : 0;
    };
    const rpAskMaxSync = () => { const el = document.getElementById('cs-rp-ask-daily-max-val'); if (el) el.textContent = rpAskMaxGet() === 0 ? '不限' : rpAskMaxGet() + ' 次'; };
    rpAskMaxSync();
    csRpAskMax.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('TA 每日申请心意币上限（0-99 次·0=不限）', String(rpAskMaxGet()), (v) => {
        let n = parseInt(String(v || '').trim(), 10);
        if (!isFinite(n)) n = 0;
        n = Math.max(0, Math.min(99, n));
        store.set('cs-rp-ask-daily-max', String(n));
        rpAskMaxSync();
        toast(n === 0 ? '已设置：TA 申请心意币不限次数' : '已设置：TA 每天最多申请 ' + n + ' 次');
      }, { maxlength: 2 });
    });
    document.addEventListener('contact-switched', rpAskMaxSync);
    if (typeof window !== 'undefined') window.csRpSyncAskMax = rpAskMaxSync;
  }

  // v3.29.x #807/#848：红包领后捎一句话——红包半框「设置」里直接可调（原来本区只有一行只读
  // 说明、真控件藏在 设置→回复设置→红包互动，用户实报「红包设置里找不到这个功能」）。
  // 三行读写 rp-thx-en / rp-thx-prob / rp-thx-mode（reply-settings 的每联系人键，经
  // window.replyCfg / window.saveReplyCfg），与回复设置那份同源，任一处改动即时同步。
  // 模板在途（并行会话占用 template.html），照 #791 的 JS 注入口态插进 #rp-settings「完成」按钮前。
  if (!document.getElementById('cs-rp-thx-box')) {
    const rpSetBox = document.getElementById('rp-settings');
    const rpDoneBtn = rpSetBox ? rpSetBox.querySelector('.rp-settings-done') : null;
    if (rpSetBox && rpDoneBtn) {
      const rpThxBox = document.createElement('div');
      rpThxBox.id = 'cs-rp-thx-box';
      rpThxBox.innerHTML = '<div class="rp-settings-title">红包领后捎一句话</div>' +
        '<div class="set-row" id="cs-rp-thx-en"><div class="txt">领后捎一句话<span class="sub">红包被领取后（我领 TA 的 / TA 领我的）TA 有概率主动捎一句，固定一条、不受「回复条数」限制；每个联系人单独设置</span></div><div class="val" id="cs-rp-thx-en-val">开</div></div>' +
        '<div class="set-row" id="cs-rp-thx-prob"><div class="txt">捎话概率<span class="sub">开关命中后再按这个概率决定这次说不说</span></div><div class="val" id="cs-rp-thx-prob-val">60%</div></div>' +
        '<div class="set-row" id="cs-rp-thx-mode"><div class="txt">捎话内容<span class="sub">系统预设话术随机一句 / 和正常聊天一样回复 / 混合</span></div><div class="val" id="cs-rp-thx-mode-val">混合</div></div>';
      rpSetBox.insertBefore(rpThxBox, rpDoneBtn);
    }
  }
  if (document.getElementById('cs-rp-thx-box')) {
    const rpThxGet = () => {
      const out = { en: 1, prob: 60, mode: 2 };
      try {
        const c = (window.replyCfg && window.replyCfg()) || {};
        out.en = Number(c['rp-thx-en']) === 0 ? 0 : 1;
        const p = Number(c['rp-thx-prob']);
        out.prob = isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 60;
        const m = Number(c['rp-thx-mode']);
        out.mode = (m === 0 || m === 1 || m === 2) ? m : 2;
      } catch (e) {}
      return out;
    };
    const rpThxLabel = (v) => {
      const list = window.rpThxModeList || [{ label: '系统预设话术', value: 0 }, { label: '像正常聊天一样回复', value: 1 }, { label: '混合', value: 2 }];
      for (let i = 0; i < list.length; i++) { if (Number(list[i].value) === Number(v)) return list[i].label; }
      return '混合';
    };
    const rpThxSync = () => {
      const cur = rpThxGet();
      const setVal = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
      setVal('cs-rp-thx-en-val', cur.en ? '开' : '已关闭');
      setVal('cs-rp-thx-prob-val', cur.prob + '%');
      setVal('cs-rp-thx-mode-val', rpThxLabel(cur.mode));
      // 回复设置页那份控件的刷新：模式胶囊走 rpThxModeSync，开关/stepper 由回复设置页
      // 自身 syncUI（进页即同步）负责，两处不会串值
      try { if (window.rpThxModeSync) window.rpThxModeSync(); } catch (e) {}
    };
    rpThxSync();
    const rpThxAsk = (id, title, value, cb, opts) => {
      const el = document.getElementById(id);
      if (!el || !window.openModal) return;
      const evalv = (x) => (typeof x === 'function' ? x() : x);
      el.addEventListener('click', () => {
        const v = evalv(value);
        window.openModal(evalv(title), v == null ? '' : String(v), cb, evalv(opts));
      });
    };
    rpThxAsk('cs-rp-thx-en', '红包领后捎一句话', null, (v) => {
      const on = v === 'on' ? 1 : 0;
      window.saveReplyCfg('rp-thx-en', on);
      rpThxSync();
      toast(on === 1 ? '已开启：红包被领取后 TA 有概率捎一句话' : '已关闭：领红包后不再捎话');
    }, () => ({ noInput: true, pill: rpThxGet().en ? 'on' : 'off', pills: [{ label: '开', value: 'on' }, { label: '关', value: 'off' }] }));
    rpThxAsk('cs-rp-thx-prob', '捎话概率（0-100%·每联系人独立）', () => rpThxGet().prob, (v) => {
      let n = parseFloat(String(v || '').trim());
      if (!isFinite(n)) { toast('请填 0~100 的数字'); return; }
      n = Math.max(0, Math.min(100, Math.round(n)));
      window.saveReplyCfg('rp-thx-prob', n);
      rpThxSync();
      toast('已设置：捎话概率 ' + n + '%');
    }, { maxlength: 3 });
    rpThxAsk('cs-rp-thx-mode', '捎话内容', null, (v) => {
      const n = Number(v);
      if (n !== 0 && n !== 1 && n !== 2) return;
      window.saveReplyCfg('rp-thx-mode', n);
      rpThxSync();
      toast('已设置：捎话内容＝' + rpThxLabel(n));
    }, () => ({ noInput: true, pill: String(rpThxGet().mode), pills: [{ label: '系统预设话术', value: '0' }, { label: '像正常聊天一样回复', value: '1' }, { label: '混合', value: '2' }] }));
    document.addEventListener('contact-switched', rpThxSync);
    if (typeof window !== 'undefined') window.csRpSyncThx = rpThxSync;
  }

  // 红包半框打开时一次刷新五行显示值（chat.js openRpSettings 调用 window.csRpSettingsSync）
  if (typeof window !== 'undefined') {
    window.csRpSettingsSync = function () {
      try { if (window.csRpSyncProb) window.csRpSyncProb(); } catch (e) {}
      try { if (window.csRpSyncMax) window.csRpSyncMax(); } catch (e) {}
      try { if (window.csRpSyncAskProb) window.csRpSyncAskProb(); } catch (e) {}
      try { if (window.csRpSyncAskMax) window.csRpSyncAskMax(); } catch (e) {}
      try { if (window.csRpSyncThx) window.csRpSyncThx(); } catch (e) {}
    };
  }

  // v3.12.x：「隐藏联系人的表情包」开关——默认关闭，全局生效（存根命名空间，与
  // my-emoji-groups 全局化同口径：聊天/朋友圈表情包面板是跨桌面共用 UI，不随桌面切换）。
  // 开启后聊天与朋友圈的表情包面板只显示「我的表情包」，不再显示 TA 的/公用表情包。
  // 写回后广播 hide-ta-sticker-changed 事件，chat.js 即时重渲染面板；feed.js 每次打开时读键。
  const csHts = document.getElementById('cs-hide-ta-sticker');
  if (csHts) {
    const GNS = 'xy-home-v2';
    const KEY = 'hide-ta-sticker';
    const htsGet = () => {
      try { if (window.xyStore) return window.xyStore(GNS).get(KEY) === '1'; } catch (e) {}
      try { return store.get(KEY) === '1'; } catch (e) { return false; }
    };
    const htsSet = (en) => { try { if (window.xyStore) window.xyStore(GNS).set(KEY, en ? '1' : '0'); } catch (e) {} };
    const syncHts = () => { const v = htsGet(); if (v !== csHts.checked) csHts.checked = v; };
    syncHts();
    csHts.addEventListener('change', () => {
      if (csHts.checked === htsGet()) return;
      htsSet(csHts.checked);
      try { document.dispatchEvent(new Event('hide-ta-sticker-changed')); } catch (e) {}
      toast(csHts.checked ? '已隐藏：聊天和朋友圈的表情包面板只显示「我的表情包」' : '已恢复显示 TA 的和公用表情包');
    });
    csAddSync(syncHts);
    document.addEventListener('contact-switched', syncHts);
  }

  // v3.26.x #636：「隐藏颜文字 / 隐藏emoji」两开关——与上方「隐藏联系人的表情包」同款口径：
  //   全局根键 xy-home-v2:hide-tab-*（contacts.js EXCLUDE 排除迁移，聊天/群聊/写信共用同一面板），
  //   默认关＝分类显示；写回广播 hide-tab-changed，chat.js 即时重渲面板。行本身由 JS 注入到
  //   「表情包」分组（锚 cs-hide-ta-sticker-row），template.html 不动（该文件常有多会话在途）。
  const htsRow = document.getElementById('cs-hide-ta-sticker-row');
  if (htsRow && htsRow.parentNode) {
    const GNS2 = 'xy-home-v2';
    const HIDE_CATS = [
      ['hide-tab-kaomoji', '隐藏颜文字', '隐藏后，表情包面板不再显示【颜文字】分类（字卡库数据不受影响）'],
      ['hide-tab-emoji', '隐藏emoji', '隐藏后，表情包面板不再显示【emoji】分类（字卡库数据不受影响）']
    ];
    let prevRow = htsRow;
    HIDE_CATS.forEach(([key, label, sub]) => {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.id = 'cs-' + key + '-row';
      row.innerHTML =
        '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01"/><path d="M8.5 14a4.5 4.5 0 007 0"/></svg></div>' +
        '<div class="txt">' + label + '<span class="sub">' + sub + '</span></div>' +
        '<label class="toggle"><input type="checkbox"><span class="tk"></span></label>';
      const box = row.querySelector('input');
      const catGet = () => { try { return window.xyStore(GNS2).get(key) === '1'; } catch (e) { return false; } };
      const catSet = (en) => { try { window.xyStore(GNS2).set(key, en ? '1' : '0'); } catch (e) {} };
      const syncCat = () => { const v = catGet(); if (v !== box.checked) box.checked = v; };
      syncCat();
      box.addEventListener('change', () => {
        if (box.checked === catGet()) return;
        catSet(box.checked);
        try { document.dispatchEvent(new Event('hide-tab-changed')); } catch (e) {}
        toast(box.checked ? '已隐藏：表情包面板不再显示【' + label.replace('隐藏', '') + '】' : '已恢复显示【' + label.replace('隐藏', '') + '】');
      });
      csAddSync(syncCat);
      document.addEventListener('contact-switched', syncCat);
      prevRow.parentNode.insertBefore(row, prevRow.nextSibling);
      prevRow = row;
    });

    // v3.26.x #691：颜文字/emoji 点击行为模式（用户直派：「点击后输入聊天输入栏，我自己选择发」
    //   或「直接点击就发送」，在聊天设置里切换）。与上方 hide-tab-* 同口径——全局根键
    //   chat-textcard-direct（contacts.js EXCLUDE 排除迁移，聊天/群聊共用同一面板），
    //   '1'=点击直接发送、其余/缺省=点击填入输入栏（默认）。模式在 chat.js 点击时现读，
    //   无需广播；改完即时生效（面板下次点击就走新模式）。
    const tcRow = document.createElement('div');
    tcRow.className = 'set-row';
    tcRow.id = 'cs-chat-textcard-direct-row';
    tcRow.innerHTML =
      '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/><path d="M8 10h8M8 13.5h5"/></svg></div>' +
      '<div class="txt">颜文字/emoji 点击直接发送<span class="sub">关（默认）：点击后只填进聊天输入栏，可连点多条，发不发由你点「发送」决定；开：点一下立刻发出。只对【颜文字】【emoji】两个分类生效，表情包图片不受影响。</span></div>' +
      '<label class="toggle"><input type="checkbox"><span class="tk"></span></label>';
    const tcBox = tcRow.querySelector('input');
    const tcGet = () => { try { return window.xyStore(GNS2).get('chat-textcard-direct') === '1'; } catch (e) { return false; } };
    const tcSet = (en) => { try { window.xyStore(GNS2).set('chat-textcard-direct', en ? '1' : '0'); } catch (e) {} };
    const tcSync = () => { const v = tcGet(); if (v !== tcBox.checked) tcBox.checked = v; };
    tcSync();
    tcBox.addEventListener('change', () => {
      if (tcBox.checked === tcGet()) return;
      tcSet(tcBox.checked);
      toast(tcBox.checked
        ? '已设置：点【颜文字】【emoji】直接发送'
        : '已设置：点【颜文字】【emoji】先填入输入栏，由你决定何时发送');
    });
    csAddSync(tcSync);
    document.addEventListener('contact-switched', tcSync);
    prevRow.parentNode.insertBefore(tcRow, prevRow.nextSibling);

    // v3.26.x #907：「打开面板前提前加载图片」开关（用户直派：「怎么样可以在进入桌面前可选择
    //   进入一个提前加载」——表情包面板/头像互动半框每次打开图片闪一下重新加载的收尾拼图）。
    //   与上方同口径：全局根键 chat-panel-prewarm（contacts.js EXCLUDE 排除迁移，面板跨桌面共用），
    //   默认开；chat.js 空闲预热调度与 avatar-lib 预热现读该键，改完下一次调度即按新值走。
    const pwRow = document.createElement('div');
    pwRow.className = 'set-row';
    pwRow.id = 'cs-chat-panel-prewarm-row';
    pwRow.innerHTML =
      '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z"/></svg></div>' +
      '<div class="txt">打开面板前提前加载图片<span class="sub">开（默认）：进桌面后在空闲时提前加载表情包面板和头像互动的首屏图片，点开不再闪一下重新加载（省流的懒加载不受影响）。关：退回「点开才加载」，点开瞬间可能闪一下。建议保持开启。</span></div>' +
      '<label class="toggle"><input type="checkbox"><span class="tk"></span></label>';
    const pwBox = pwRow.querySelector('input');
    const pwGet = () => { try { return window.xyStore(GNS2).get('chat-panel-prewarm') !== '0'; } catch (e) { return true; } };
    const pwSet = (en) => { try { window.xyStore(GNS2).set('chat-panel-prewarm', en ? '1' : '0'); } catch (e) {} };
    const pwSync = () => { const v = pwGet(); if (v !== pwBox.checked) pwBox.checked = v; };
    pwSync();
    pwBox.addEventListener('change', () => {
      if (pwBox.checked === pwGet()) return;
      pwSet(pwBox.checked);
      toast(pwBox.checked
        ? '已开启：进桌面后会提前加载表情包/头像图片'
        : '已关闭：表情包/头像图片改为点开面板时才加载');
    });
    csAddSync(pwSync);
    document.addEventListener('contact-switched', pwSync);
    tcRow.parentNode.insertBefore(pwRow, tcRow.nextSibling);
  }

  // ================= v3.34.x #673：聊天美化「边看边调」（对齐桌面美化 #527/#562/#579） =================
  // 用户原话：「聊天设置里的美化也能像桌面美化一样做边看边调的功能吗？」
  // 桌面那套的形态是「打开调色条：桌面在上、控件在下，改哪看哪、即时生效」（personalize.js
  // openBeautyDrawer）。聊天美化此前只有居中弹窗逐个设置——弹窗把聊天页整个盖住，调的时候看不到
  // 效果（用户先反馈的「顶栏/底栏与气泡透明、聊天气泡透明度、气泡 CSS、全局字体…都不能预览」
  // 就是这个根因：不是数值没生效，而是生效结果被弹窗挡着）。本批补齐同一套交互，控件换成聊天
  // 气泡域的键，语义与桌面抽屉一致：
  //   ① 入口 #cs-live-adjust——注入在聊天设置→美化 段最上方。JS 注入而非改 template.html：与本文件
  //      上方「隐藏颜文字/隐藏emoji」两行同款做法（template.html 常有多会话在途，不抢文件）；
  //   ② 点开＝切到聊天页（消息已在 DOM 里，零重渲染）＋底部抽屉（40vh 上限、半透明、可收起）；
  //   ③ 控件即时写存储 + applySettings()/applyCss()/applyFont()——与桌面抽屉同语义：没有「确定/
  //      取消」，✕ 只关抽屉并回聊天设置页，不与设置行弹窗的「确认后生效」语义打架；
  //   ④ 三个分区互斥显示（气泡 / 栏位 / 字体·其他）：控件全堆一起内容会超高、盖掉大半屏，
  //      这是桌面抽屉 #527b 踩过的坑。
  function csDrawerEl() {
    let d = document.getElementById('chat-beauty-drawer');
    if (!d) { d = document.createElement('div'); d.id = 'chat-beauty-drawer'; document.body.appendChild(d); }
    return d;
  }
  // #783 ①：抽屉开着时给浮层让位（层级自救）。抽屉是 z-index:95 的固定层，而它自己点开的
  // 浮层全在它下面——openModal 的 #modal-mask 是 90、壁纸图库 #cs-bg-panel 89、#cs-bg-adj-panel
  // 90（base.css:1076 注释已写明「.phone 无 z-index 不产生堆叠上下文」，故这些层级在同一层叠
  // 上下文里直接比大小）。结果＝从抽屉里点「上传/图库/手输色值」，弹层藏在抽屉背后，用户看到的
  // 是「点了没反应」。不改那几个全局层级（动 base.css 的 90/89 会牵全站），改由抽屉临时让位：
  // 有浮层可见时把抽屉压到「最低那个浮层再减一」，浮层全部收起则回到抽屉自己的层级
  // （csDrawerBaseZ：开抽屉时从元素读回，唯一事实源仍是 cssText 里那条 z-index:95——
  //  写死 '95' 或置空都会漂移：置空＝'auto'，比同级后置元素还低）。
  let csDrawerBaseZ = '';
  const CS_DRAWER_OVERLAYS = ['.modal-mask', '#cs-bg-panel', '#cs-bg-adj-panel', '#qa-mask', '#tc-mask', '#chat-ask-panel'];
  function csDrawerLayerTick() {
    const d = document.getElementById('chat-beauty-drawer');
    if (!d || d.style.display === 'none') return;
    // 抽屉是挂在 body 上的固定层（z-index 95 / 最高 40vh），离开聊天页时它自己不会收——
    // 实测切到桌面页后抽屉仍占 508~846，而底部导航在 740~804、z-index 只有 2＝整条导航被盖住。
    // 这里只就地收起、不回聊天设置页（用户是自己走开的，csDrawerClose 那套导航会把人拽回去）。
    const chat = document.getElementById('page-chat');
    if (chat && chat.hidden) {
      clearInterval(csDrawerWatchTimer); csDrawerWatchTimer = 0;
      d.style.display = 'none';
      try { csDemoBubbles(false); } catch (e) {}
      return;
    }
    let low = 0;
    CS_DRAWER_OVERLAYS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        // 先用零成本属性判掉收起的（.modal-mask 靠 [hidden]、各面板靠内联 display:none）：
        // getComputedStyle 会强制样式重算，而这个闸门是 240ms 常驻轮询（iOS 性能批 #765d 口径），
        // 绝大多数轮次「一个浮层都没有」＝零次 computed 读取才成立。
        if (el.hidden || el.style.display === 'none') return;
        if (!el.isConnected) return;
        const cs = getComputedStyle(el);
        // 「可见」要判得彻底：splash 未退时整棵 .phone 是 visibility:hidden（base.css:95），
        // 那张开屏公告遮罩的 display 却仍是 flex——此刻抽屉自己也看不见，让它压着抽屉没有意义，
        // 还会把抽屉一直钉在 89。零尺寸同理（收着的面板留个 0×0 的壳）。
        if (cs.display === 'none' || cs.visibility !== 'visible') return;
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const z = parseInt(cs.zIndex, 10) || 0;
        if (z && (!low || z < low)) low = z;
      });
    });
    const want = low ? String(Math.max(1, low - 1)) : csDrawerBaseZ;
    if (d.style.zIndex !== want) d.style.zIndex = want;
  }
  // #783 ②：壁纸身份（有没有图 + 当前用图库里哪张）变了就重渲染当前分区——抽屉里刚上传/刚
  // 换图，那三条「壁纸 水平/垂直/缩放」滑杆（挂在「有壁纸」条件下）当场出现，不用关开抽屉。
  let csDrawerWatchTimer = 0;
  const csDrawerBgSig = () => {
    try { return (store.get('cs-bg') ? '1' : '0') + '|' + String(store.get(CS_BG_ACTIVE) || ''); } catch (e) { return ''; }
  };
  // 关闭抽屉 → 回「聊天设置」页的美化段（导航口径对齐桌面抽屉的 showThemePage：
  // 只对当前未隐藏的页写 hidden，避免 44 页观察器被同值写全部唤醒——见 chat.js #336 注释）
  function csDrawerClose() {
    clearInterval(csDrawerWatchTimer); csDrawerWatchTimer = 0;
    try { csDemoBubbles(false); } catch (e) {}
    try {
      const d = document.getElementById('chat-beauty-drawer');
      if (d) d.style.display = 'none';
      document.querySelectorAll('.page').forEach(pg => { if (!pg.hidden) pg.hidden = true; });
      const pg = document.getElementById('page-chat-settings');
      if (pg) pg.hidden = false;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      const st = document.querySelector('.tab[data-page="page-setting"]');
      if (st) st.classList.add('active');
      const tabs = document.getElementById('cs-tabs');
      if (tabs) { const b = tabs.querySelector('.them-tab[data-tab="beautify"]'); if (b) b.click(); }
    } catch (e) {}
  }
  // ===== #760（2026-09-18）：抽屉遮挡自救三件套（拖动落位 / 键盘抬升 / 打开滚底+示例气泡） =====
  // ① 拖动：桌面 #562 只留下 beautyDockTop 的声明、实现从未落地（grip 一直是纯装饰的误导
  //    affordance），聊天版把同一口径补齐：会话内记忆、不落盘（纯 UI 位置，不碰数据层）。
  // ② 键盘：抽屉是 fixed 层，安卓 resizes-visual 下键盘弹起时仍锚布局视口底＝「全局字体 /
  //    气泡 CSS」两个输入框缩到键盘后面（桌面抽屉没有文本输入，此坑聊天版独有；桌面抽屉的
  //    键盘停靠走 FLOAT_PANEL_SELECTORS absolute 锚 .phone，但那是贴底布局面板的专属，
  //    抽屉可拖动后不再贴底，所以这里用 visualViewport 自算抬升）。
  //    公式 innerHeight - vv.height - vv.offsetTop 对 iOS 的整页 pan 同样成立：已上移的
  //    部分体现在 offsetTop 里，抵消后 lift 恰为剩余遮挡高度。
  let csBeautyDockBot = null; // null=贴底；否则＝距屏幕底边 px（会话内）
  let csKbLiftBound = false;
  function csDrawerApplyBottom() {
    const d = document.getElementById('chat-beauty-drawer');
    if (!d || d.style.display === 'none') return;
    const vv = window.visualViewport;
    const lift = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    d.style.bottom = Math.max(lift, csBeautyDockBot || 0) + 'px';
    const vh = vv ? vv.height : window.innerHeight;
    d.style.maxHeight = lift ? Math.max(150, Math.round(vh * 0.45)) + 'px' : '40vh';
  }
  function csDrawerBindKbLift() {
    if (csKbLiftBound || !window.visualViewport) return;
    csKbLiftBound = true;
    const f = () => { try { csDrawerApplyBottom(); } catch (e) {} };
    try {
      window.visualViewport.addEventListener('resize', f);
      window.visualViewport.addEventListener('scroll', f);
    } catch (e) {}
  }
  // ③ 空对话示例气泡：新联系人/清空过记录时聊天页一片空白，「改哪看哪」无从看起。
  //    注入一对（入站带标识+时间、出站短文本），只进 DOM——零 store.set、零 msgs 写入，
  //    开/关抽屉都会清掉，绝不残留进正常聊天。
  function csDemoBubbles(on) {
    const body = document.getElementById('chat-body');
    if (!body) return;
    Array.prototype.forEach.call(body.querySelectorAll('.msg[data-cs-demo]'), n => n.remove());
    if (!on) return;
    const mk = (out, text) => {
      const m = document.createElement('div');
      m.className = 'msg ' + (out ? 'msg-out' : 'msg-in');
      m.dataset.csDemo = '1';
      const side = '<div class="msg-side"><div class="msg-av"></div><span class="msg-time">13:14</span></div>';
      m.innerHTML = out
        ? '<div class="msg-bubble">' + text + '</div>' + side
        : side + '<div class="msg-bubble"><span class="msg-hi-mark">*~*</span>' + text + '</div>';
      // 示例气泡没有 data-idx，chat.js 各点按链路都有 idx undefined 守卫，这里再 stopPropagation 一道
      ['click', 'dblclick', 'contextmenu', 'touchend'].forEach(ev => m.addEventListener(ev, e => { e.stopPropagation(); }));
      try { if (window.fillAvatar) { window.fillAvatar(m.querySelector('.msg-av'), out ? 'cs-avatar-user' : 'cs-avatar-partner'); } } catch (e) {}
      return m;
    };
    body.appendChild(mk(false, '这是一条示例气泡（仅供预览，不会发送也不会保存）——改气泡颜色、透明度、圆角、字号就在这看效果'));
    body.appendChild(mk(true, '我的气泡也长这样～'));
  }
  let csDrawerSec = 'bubble';
  function openChatBeautyDrawer() {
    // 1) 切到聊天页——消息已在 DOM 里，直接看真效果（与桌面抽屉同款导航口径）
    try {
      document.querySelectorAll('.page').forEach(pg => { if (!pg.hidden) pg.hidden = true; });
      const chat = document.getElementById('page-chat');
      if (chat) chat.hidden = false;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      const ct = document.querySelector('.tab[data-page="page-chat"]');
      if (ct) ct.classList.add('active');
    } catch (e) {}
    const d = csDrawerEl();
    // 观感与桌面抽屉逐字同款：贴底、40vh 上限、半透明底（不透明会把聊天页挡死，
    // #562 用户原话「又不是半透明的页面，还是会遮挡其他东西我看不见」）；刻意不加
    // backdrop-filter——AGENTS.md 的 iOS 卡顿红线。
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:95;max-height:40vh;transition:bottom .16s ease;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);color:var(--ink,#111);box-shadow:0 -6px 24px rgba(0,0,0,.18);border-radius:16px 16px 0 0;overflow-y:auto;overflow-x:hidden;padding:0 12px calc(10px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)));box-sizing:border-box;display:flex;flex-direction:column;gap:8px';
    d.innerHTML = '';
    // #783：读回抽屉自身层级作为让位后的回正值（cssText 是唯一事实源，这里不复制数字）
    const csBaseZ = parseInt(getComputedStyle(d).zIndex, 10);
    csDrawerBaseZ = csBaseZ > 0 ? String(csBaseZ) : '';
    const grip = document.createElement('div');
    grip.style.cssText = 'width:36px;height:4px;border-radius:2px;background:var(--card-border,#ddd);margin:7px auto 0;flex:none';
    d.appendChild(grip);
    const mkMini = (label, fn, cssExtra) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'flex:none;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;border-radius:8px;padding:6px 11px;cursor:pointer' + (cssExtra || '');
      b.addEventListener('click', fn);
      return b;
    };
    const hd = document.createElement('div');
    hd.style.cssText = 'display:flex;align-items:center;gap:8px;flex:none';
    const hdTxt = document.createElement('span');
    hdTxt.textContent = '边看边调（即时生效）';
    hdTxt.style.cssText = 'font-size:13px;font-weight:700;flex:none';
    // v8.29 #1008（用户直派「托标题行可上移移动功能位置，也需要写清楚，用户并不知道有这个功能」）：
    // 拖动是 #760 就实现了的，但界面上一个字都没提——这里把提示固定挂在标题行里（点「收起」
    // 折叠正文区后仍然看得见），并同步进设置页「功能说明」。
    const hdHint = document.createElement('span');
    hdHint.textContent = '按住标题行上下拖 · 让开看聊天';
    hdHint.style.cssText = 'font-size:11px;color:var(--muted,#888);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    // #760：grip 小横条与标题行可竖向拖动（此前 grip 是纯装饰）。用 pointer 事件 +
    // setPointerCapture：桌面版 #660 的教训——不夺回控制权触摸序列会被内核抢成滚动，
    // 表现为「抖一下拖不动」。header 里的按钮不参与拖动（pointerdown 让行，否则点不动）。
    const bindDockDrag = (el) => {
      el.style.touchAction = 'none';
      let sy = 0, sb = 0, drag = false;
      el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        drag = true; sy = e.clientY; sb = csBeautyDockBot || 0;
        d.style.transition = 'none'; // #1008：拖动期间关掉 bottom 过渡，保证跟手
        try { el.setPointerCapture(e.pointerId); } catch (er) {}
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        csBeautyDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));
        csDrawerApplyBottom();
        e.preventDefault();
      });
      const up = () => {
        if (!drag) return;
        drag = false;
        d.style.transition = 'bottom .16s ease'; // #1008：松手恢复过渡（吸附回贴底也是动画）
        if ((csBeautyDockBot || 0) < 24) csBeautyDockBot = null; // 接近底部＝吸附回贴底
        csDrawerApplyBottom();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.style.cursor = 'grab';
    };
    bindDockDrag(grip);
    const panelBody = document.createElement('div');
    panelBody.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:none';
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:none';
    const foldBtn = mkMini('收起', () => {
      const willFold = panelBody.style.display !== 'none';
      panelBody.style.display = willFold ? 'none' : 'flex';
      foldBtn.textContent = willFold ? '展开' : '收起';
    });
    const closeBtn = mkMini('\u2715', () => { csDrawerClose(); }, ';padding:6px 10px');
    hd.appendChild(hdTxt); hd.appendChild(hdHint); hd.appendChild(foldBtn); hd.appendChild(closeBtn);
    d.appendChild(hd);
    bindDockDrag(hd); // grip 只有 4px 高，标题行才是主拖拽把手
    const chipsRow = document.createElement('div');
    chipsRow.style.cssText = 'display:flex;gap:6px;flex:none';
    panelBody.appendChild(chipsRow);
    panelBody.appendChild(body);
    d.appendChild(panelBody);
    // 单行滑杆（标签固定宽 + 滑杆 + 数值），行高与桌面抽屉一致
    // #760：多传一个 def 即获得「双击滑杆恢复默认」（拖动中看数值变化已够，复位不必回设置页）
    const mkSlider = (label, get, set, min, max, step, unit, def) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px';
      const lb = document.createElement('span');
      lb.textContent = label;
      lb.style.cssText = 'font-size:11.5px;color:var(--muted,#888);flex:none;width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step || 1;
      inp.value = String(get());
      inp.style.cssText = 'flex:1;min-width:0';
      const vv = document.createElement('span');
      vv.style.cssText = 'font-size:11px;color:var(--muted,#999);flex:none;width:46px;text-align:right';
      vv.textContent = inp.value + unit;
      inp.addEventListener('input', () => {
        vv.textContent = inp.value + unit;
        set(Number(inp.value));
      });
      if (def !== undefined) {
        inp.title = '双击恢复默认';
        inp.addEventListener('dblclick', () => {
          inp.value = String(def);
          vv.textContent = def + unit;
          set(Number(def));
        });
      }
      row.appendChild(lb); row.appendChild(inp); row.appendChild(vv);
      return row;
    };
    // 胶囊单选行（字号 / 气泡框大小 / 头像形状 / 时间轴样式）
    const mkPills = (label, items, get, set) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px';
      const lb = document.createElement('span');
      lb.textContent = label;
      lb.style.cssText = 'font-size:11.5px;color:var(--muted,#888)';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      const cur = get();
      const paint = (onBtn) => Array.prototype.forEach.call(row.children, c => {
        const on = c === onBtn;
        c.style.background = on ? 'var(--ink,#111)' : 'var(--btn-cancel-bg,#fafafa)';
        c.style.color = on ? 'var(--bg-b,#fff)' : 'var(--ink,#111)';
        c.style.borderColor = on ? 'var(--ink,#111)' : 'var(--card-border,#ddd)';
      });
      items.forEach(it => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = it.label;
        b.style.cssText = 'font-size:11.5px;padding:5px 9px;border-radius:8px;cursor:pointer;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)';
        b.addEventListener('click', () => { set(it.value); paint(b); });
        row.appendChild(b);
        // paint 遍历的是 row.children，必须在 append 之后调用，否则初态描色落空＝
        // 抽屉每行胶囊打开时看不出当前选的是哪个（#856 顺带根治）
        if (it.value === cur) paint(b);
      });
      wrap.appendChild(lb); wrap.appendChild(row);
      return wrap;
    };
    // 颜色项：2 列网格里的可点小块，点它就在下方就地展开调色盘（即时生效）。
    // 不用原生 <input type=color>——真机上会被渲染成一大块（桌面抽屉 #527b 的坑）。
    let colorItems = [];
    let paletteHost = null;
    const mkColorItem = (label, key, def, swatchList) => {
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;align-items:center;gap:7px;padding:6px 8px;border:1px solid var(--card-border,#ddd);border-radius:9px;cursor:pointer;min-width:0';
      const sw = document.createElement('span');
      sw.style.cssText = 'width:18px;height:18px;border-radius:5px;border:1px solid var(--card-border,#ddd);flex:none;background:' + def;
      const tx = document.createElement('span');
      tx.textContent = label;
      tx.style.cssText = 'font-size:11.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const curGet = () => { try { return store.get(key) || def; } catch (e) { return def; } };
      const paint = () => { sw.style.background = curGet(); };
      const curSet = (v) => {
        try { if (v === null) store.remove(key); else store.set(key, v); } catch (e) {}
        applySettings(); paint();
      };
      el.appendChild(sw); el.appendChild(tx); paint();
      el.addEventListener('click', () => {
        colorItems.forEach(it => { it.el.style.borderColor = 'var(--card-border,#ddd)'; });
        el.style.borderColor = 'var(--ink,#111)';
        renderCsPalette({ el, label, curGet, curSet, swatchList });
      });
      colorItems.push({ el, paint });
      return el;
    };
    const renderCsPalette = (item) => {
      if (!paletteHost) return;
      paletteHost.innerHTML = '';
      const strip = document.createElement('div');
      strip.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
      const cur = String(item.curGet() || '').toLowerCase();
      (item.swatchList || []).forEach(swItem => {
        const dot = document.createElement('span');
        const c = swItem.color;
        dot.style.cssText = 'width:23px;height:23px;border-radius:7px;border:1px solid ' + (String(c).toLowerCase() === cur ? 'var(--ink,#111)' : 'var(--card-border,#ddd)') + ';cursor:pointer;flex:none;background:' + c;
        dot.title = swItem.label || c;
        dot.addEventListener('click', () => { item.curSet(c); renderCsPalette(item); });
        strip.appendChild(dot);
      });
      const defBtn = document.createElement('button');
      defBtn.type = 'button'; defBtn.textContent = '默认';
      defBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
      defBtn.addEventListener('click', () => { item.curSet(null); renderCsPalette(item); });
      strip.appendChild(defBtn);
      const hexBtn = document.createElement('button');
      hexBtn.type = 'button'; hexBtn.textContent = '手输色值';
      hexBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
      hexBtn.addEventListener('click', () => {
        if (!window.openModal) return;
        window.openModal('输入' + item.label + '色值', String(item.curGet() || '#111111'), (v) => {
          const c = String(v || '').trim();
          if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) { toast('请输入 # 开头的色值，如 #ffd6e0'); return; }
          item.curSet(c); renderCsPalette(item);
        }, { placeholder: '#ffd6e0' });
      });
      strip.appendChild(hexBtn);
      // #760：调色盘选完色就占着两行高——给个就地收起口（再点色块可再展开）
      const hideBtn = document.createElement('button');
      hideBtn.type = 'button'; hideBtn.textContent = '收起';
      hideBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
      hideBtn.addEventListener('click', () => {
        paletteHost.innerHTML = '';
        colorItems.forEach(it => { it.el.style.borderColor = 'var(--card-border,#ddd)'; });
      });
      strip.appendChild(hideBtn);
      paletteHost.appendChild(strip);
      const tip = document.createElement('div');
      tip.style.cssText = 'font-size:10.5px;color:var(--muted,#999);margin-top:5px';
      tip.textContent = '正在调「' + item.label + '」，点色块即时生效';
      paletteHost.appendChild(tip);
    };
    const mkGrid = (items) => {
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
      items.forEach(el => grid.appendChild(el));
      return grid;
    };
    const mkNote = (txt) => {
      const n = document.createElement('div');
      n.style.cssText = 'font-size:10.5px;color:var(--muted,#999);line-height:1.5';
      n.textContent = txt;
      return n;
    };
    const mkAct = (label, fn, bold) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'padding:8px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;cursor:pointer' + (bold ? ';font-weight:600' : '');
      b.addEventListener('click', fn);
      return b;
    };
    // FIX 2026-09-21 #1002：抽屉里的「上传」按钮＝mkAct + 铺一层真·可点 file input（本文件新增上传入口
    // 一律走它：按钮是单用途的、点击处理留在原处，surface 只负责「让手指点到真 input」）。
    const mkActSurface = (label, fn, surfOpts) => {
      const b = mkAct(label, fn);
      try { if (window.mochiFilePickSurface) window.mochiFilePickSurface(b, surfOpts || {}); } catch (e) {}
      return b;
    };
    const DEF = themeDefaults();
    const setSurface = (i, v) => { try { store.set(CHAT_SURFACE_SETTINGS[i].key, String(v)); } catch (e) {} applySettings(); };
    const SECS = [
      { key: 'bubble', label: '气泡', build: () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
        wrap.appendChild(mkGrid([
          mkColorItem('我的气泡色', 'cs-out-bg', DEF.outBg, BUBBLE_BG_COLORS),
          mkColorItem('我的文字色', 'cs-out-ink', DEF.outInk, BUBBLE_INK_COLORS),
          mkColorItem('联系人气泡色', 'cs-in-bg', DEF.inBg, BUBBLE_BG_COLORS),
          mkColorItem('联系人文字色', 'cs-in-ink', DEF.inInk, BUBBLE_INK_COLORS)
        ]));
        paletteHost = document.createElement('div');
        wrap.appendChild(paletteHost);
        wrap.appendChild(mkSlider('气泡透明度', () => surfaceValue(CHAT_SURFACE_SETTINGS[2]), v => setSurface(2, v), 0, 100, 1, '%', CHAT_SURFACE_SETTINGS[2].def));
        wrap.appendChild(mkSlider('气泡圆角', () => (parseInt(store.get('cs-bubble-radius') || BUBBLE_RADIUS_DEFAULT, 10) || 0), v => { try { store.set('cs-bubble-radius', v + 'px'); } catch (e) {} applySettings(); }, 0, 40, 1, 'px', parseInt(BUBBLE_RADIUS_DEFAULT, 10)));
        // #732：气泡 CSS 冲突说明（原 #725 是红字「暂不生效」，方案已改）。现在两个滑块
        // 强制生效（applyCssEnforce 用 ID 级特异性 + !important 回写），所以这里只说清
        // 「谁赢」以及哪些声明会因此失效——不再是让用户自己去删 CSS 的坏消息。
        try {
          const cssTxt = String(store.get('cs-bubble-css') || '');
          const hitBg = /(^|[^-\w])background(-color|-image)?\s*:/i.test(cssTxt);
          const hitRa = /(^|[^-\w])border(-(top|bottom|left|right)){0,2}-radius\s*:/i.test(cssTxt);
          if (hitBg || hitRa) {
            const bits = [hitBg && '底色', hitRa && '圆角'].filter(Boolean).join('、');
            const warn = mkNote('气泡 CSS 里写了' + bits + '声明，这两个滑块会覆盖它（其余声明如阴影、边框照常生效）；想完全按 CSS 来，就把对应声明删掉。');
            warn.style.color = 'var(--muted,#999)';
            wrap.appendChild(warn);
          }
        } catch (e) {}
        wrap.appendChild(mkPills('气泡字号', FONT_SIZES, () => store.get('cs-font-size') || '14px', v => { try { store.set('cs-font-size', v); } catch (e) {} applySettings(); }));
        wrap.appendChild(mkPills('气泡框大小', BUBBLE_SIZES, () => store.get('cs-bubble-size') || '11px 14px', v => { try { store.set('cs-bubble-size', v); } catch (e) {} applySettings(); }));
        wrap.appendChild(mkNote('气泡透明度只调底色，文字始终清晰；自定义气泡 CSS 写了 background 时，滑块值优先（动过滑块即覆盖 CSS）。'));
        return wrap;
      } },
      { key: 'bar', label: '栏位', build: () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
        wrap.appendChild(mkSlider('顶栏不透明度', () => surfaceValue(CHAT_SURFACE_SETTINGS[0]), v => setSurface(0, v), 0, 100, 1, '%', CHAT_SURFACE_SETTINGS[0].def));
        wrap.appendChild(mkSlider('底栏不透明度', () => surfaceValue(CHAT_SURFACE_SETTINGS[1]), v => setSurface(1, v), 0, 100, 1, '%', CHAT_SURFACE_SETTINGS[1].def));
        wrap.appendChild(mkSlider('顶栏位置', () => surfaceValue(CHAT_SURFACE_SETTINGS[3]), v => setSurface(3, v), CHAT_SURFACE_SETTINGS[3].min, CHAT_SURFACE_SETTINGS[3].max, 1, 'px', CHAT_SURFACE_SETTINGS[3].def));
        wrap.appendChild(mkSlider('底栏位置', () => surfaceValue(CHAT_SURFACE_SETTINGS[4]), v => setSurface(4, v), CHAT_SURFACE_SETTINGS[4].min, CHAT_SURFACE_SETTINGS[4].max, 1, 'px', CHAT_SURFACE_SETTINGS[4].def));
        // #889（用户 2026-09-20：「边看边调没有小字提示其实可以滑动栏位的位置，按需调整」）：
        // 这两条滑杆此前零说明，用户不知道顶栏/输入栏能整体上下挪。
        wrap.appendChild(mkNote('这两条位置滑杆拖着就能把顶栏/输入栏上下挪位，按需微调（顶栏正值下移、负值上移；底栏正值上移、负值下移）；双击滑杆回默认位置。'));
        // #760：补「发送按钮显示/隐藏」——设置页有这行（cs-send-show），抽屉此前漏了，
        // 而它恰好要在聊天页面上看效果，是最该进抽屉的一项。
        wrap.appendChild(mkPills('发送按钮', [{ label: '显示', value: 'show' }, { label: '隐藏（回车发送）', value: 'hide' }],
          () => store.get('cs-send-show') || 'show', v => {
            try { store.set('cs-send-show', v); } catch (e) {}
            applySettings();
          }));
        // #731：壁纸铺满方式 + 壁纸延伸到栏位（都在「栏位」区，改哪看哪）
        // #783（用户 2026-09-18：「边看边调里不能上传背景图片啊」）：抽屉里此前只有档位/位置/
        // 缩放，换图入口却留在聊天设置页（抽屉开着时那一页是隐藏的）＝能调不能换。这两按钮
        // 复用设置页同一对函数（csBgPickFiles 走统一文件选择入口＋压缩入库，csBgOpenGallery＝
        // 设置页那行的入口函数：旧数据迁移 + 图库面板，切换/删除/同步照旧），不另写一条上传链。
        {
          const glN = (function () { try { return csBgList().length; } catch (e) { return 0; } })();
          // 两枚按钮走抽屉现成的两列网格（mkAct 不认 flex，裸 flex 行会按内容宽＝一长一短）
          wrap.appendChild(mkGrid([
            mkActSurface('上传壁纸（可多选）', () => {
              try { csBgPickFiles(); } catch (e) { toast('无法打开相册，请重试'); }
            }, { id: 'cs-bg-drawer-tap', accept: 'image/*', multiple: true, owner: 'dev-cs-bg-pick' }),
            mkAct('图库 · 换一张' + (glN ? '（' + glN + '）' : ''), () => {
              try { csBgOpenGallery(); } catch (e) { toast('图库打不开，请重试'); }
            })
          ]));
          if (!store.get('cs-bg')) wrap.appendChild(mkNote('还没设置壁纸：先上传一张或从图库选一张，下面的铺满方式/位置/缩放才有得调。'));
        }
        wrap.appendChild(mkPills('壁纸铺满方式', CS_BG_FITS, csBgFit, v => {
          try { store.set('cs-bg-fit', v); } catch (e) {}
          applySettings();
          if (!store.get('cs-bg')) toast('已记住：上传壁纸后就会按这个方式显示');
        }));
        wrap.appendChild(mkPills('壁纸延伸到栏位', [{ label: '开', value: 'on' }, { label: '关', value: 'off' }],
          () => (store.get('cs-bg-fullbars') === '1' ? 'on' : 'off'), v => {
            try { store.set('cs-bg-fullbars', v === 'on' ? '1' : '0'); } catch (e) {}
            applySettings();
          }));
        // #782：壁纸位置/缩放——抽屉里这三条能边看边调（设置页那行面板里是同一组键、同一个
        // 写入点 setCsBgAdj）。缩放 100% 时尺寸仍由上面「壁纸铺满方式」决定，拉大才接管。
        if (store.get('cs-bg')) {
          wrap.appendChild(mkSlider('壁纸 水平位置', () => csBgAdj().x, v => setCsBgAdj({ x: v }), 0, 100, 1, '%', CS_BG_ADJ.x));
          wrap.appendChild(mkSlider('壁纸 垂直位置', () => csBgAdj().y, v => setCsBgAdj({ y: v }), 0, 100, 1, '%', CS_BG_ADJ.y));
          wrap.appendChild(mkSlider('壁纸 缩放', () => csBgAdj().s, v => setCsBgAdj({ s: v }), 100, 300, 5, '%', CS_BG_ADJ.s));
          wrap.appendChild(mkNote('图被裁掉的部分靠这两条位置滑杆找回来（值越大＝看越靠右/靠下的一段）；缩放 100% 就是按铺满方式，双击滑杆回默认。'));
        }
        wrap.appendChild(mkGrid([
          mkColorItem('发送按钮色', 'cs-send-bg', DEF.sendBg, SEND_BG_COLORS),
          mkColorItem('发送文字色', 'cs-send-ink', DEF.sendInk, BUBBLE_INK_COLORS),
          mkColorItem('正在输入颜色', 'cs-typing-ink', '#8a8a8a', BUBBLE_INK_COLORS)
        ]));
        paletteHost = document.createElement('div');
        wrap.appendChild(paletteHost);
        wrap.appendChild(mkNote('不透明度 0% 全透明、100% 不透明，文字按钮不变淡；位置 0 为默认（顶栏正=下移/负=上移，底栏正=上移/负=下移），只作用于本桌面。'));
        return wrap;
      } },
      { key: 'type', label: '字体 · 其他', build: () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
        // 全局字体：输入即生效（不是「打完再点应用」），上传按钮复用设置行同一套存储链路
        const finp = document.createElement('input');
        finp.type = 'text'; finp.className = 'tc-input';
        finp.placeholder = '字体名，如 Microsoft YaHei（清空＝恢复默认）';
        const fr = fontResolved();
        if (fr && fr.indexOf('data:') !== 0 && fr.indexOf('http') !== 0) finp.value = fr;
        finp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)';
        finp.addEventListener('input', () => {
          const v = (finp.value || '').trim();
          try { if (!v) fontRemove(); else fontSet(v); } catch (e) {}
          applyFont(); csFontChanged();
        });
        wrap.appendChild(mkNote('全局字体（边打边看，清空输入框即恢复默认）'));
        wrap.appendChild(finp);
        wrap.appendChild(mkAct('上传字体文件（ttf / otf / woff / woff2）', () => {
          // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
          window.mochiFilePick({
            id: 'mochi-cs-drawer-font-pick', accept: '.ttf,.otf,.woff,.woff2',
            onFiles: (files) => {
            const f = files && files[0];
            if (!f) { toast('没有取到字体文件，请再选一次'); return; }
            toast('正在读取字体文件…');
            const reader = new FileReader();
            reader.onload = () => { fontSetData(reader.result); applyFont(); csFontChanged(); toast('字体已应用到本桌面'); };
            reader.onerror = () => { toast('字体文件读取失败，请重试'); };
            reader.readAsDataURL(f);
            }
          });
        }));
        // 气泡 CSS：输入即套用（160ms 防抖），边写边看气泡变化
        const ta = document.createElement('textarea');
        ta.id = 'cs-drawer-css'; ta.className = 'tc-input'; ta.rows = 3;
        ta.placeholder = '气泡 CSS，如 border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.12)';
        ta.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:12.5px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111);resize:vertical';
        try { ta.value = store.get(CSS_KEY) || ''; } catch (e) {}
        let cssTimer = null;
        ta.addEventListener('input', () => {
          clearTimeout(cssTimer);
          cssTimer = setTimeout(() => {
            const v = cssReadVal(ta).trim();
            try { if (v) store.set(CSS_KEY, v); else store.remove(CSS_KEY); } catch (e) {}
            applyCss();
          }, 160);
        });
        wrap.appendChild(mkNote('气泡 CSS（边写边套用；写 background / border-radius 时，上方两个滑块动过则以滑块为准）'));
        wrap.appendChild(ta);
        wrap.appendChild(mkAct('清空气泡 CSS', () => {
          try { store.remove(CSS_KEY); } catch (e) {}
          ta.value = '';
          applyCss();
          toast('已清空气泡样式');
        }));
        wrap.appendChild(mkPills('头像形状', [{ label: '圆形', value: 'circle' }, { label: '方形', value: 'square' }], () => store.get('cs-av-shape') || 'circle', v => { try { store.set('cs-av-shape', v); } catch (e) {} applySettings(); }));
        wrap.appendChild(mkPills('时间轴样式', TIME_STYLES, () => store.get('cs-time-style') || 'under-av', v => {
          try { store.set('cs-time-style', v); } catch (e) {}
          applySettings();
          // divider（时间分隔线）要补插 DOM，其余样式纯 CSS 即时生效（同 #cs-time-style 行）
          if (v === 'divider' && window.chatReRenderTime) { try { window.chatReRenderTime(); } catch (e) {} }
        }));
        // #760：补「时间轴文字色」——设置页有这行（cs-time-ink），调时间轴样式/位置时
        // 正需要当场看颜色效果，放这里与时间轴样式相邻。
        wrap.appendChild(mkGrid([
          mkColorItem('时间轴文字色', 'cs-time-ink', DEF.timeInk, BUBBLE_INK_COLORS)
        ]));
        paletteHost = document.createElement('div');
        wrap.appendChild(paletteHost);
        // #783：换壁纸入口已搬进「栏位」分区（与铺满方式/位置/缩放同区，改哪看哪），
        // 这里这条「先关抽屉、再程序点隐藏的设置页行」的旧路子删掉——同一抽屉两套入口、行为还不一样。
        wrap.appendChild(mkNote('想逐项精调（含「同步到全部桌面」「恢复默认」等）回聊天设置→美化，点对应一行即可。'));
        return wrap;
      } },
      // #728：标识 / 时间轴位置微调——用户上传自定义气泡 CSS 后气泡的 padding/尺寸变了，
      // 标识（气泡左上角）与时间轴（气泡下方/外侧等）的硬编码偏移就跟着偏，甚至被气泡
      // 边缘裁掉或压住文字。这里给四个偏移量（横向/纵向各一对），即拖即见。
      // 默认全 0＝与改造前完全一致（CSS 侧是 calc(基准 + var(...))，var 未定义回退 0）。
      { key: 'tune', label: '微调', build: () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
        const setOff = (key, v) => { try { store.set(key, String(clampOffset(v))); } catch (e) {} applySettings(); };
        // #856（用户直派「微调功能里缺少更换联系人主动发消息的标识图案」）：标识图案就地换。
        // 池的数据、默认值与自定义校验只有一份，在 reply-settings.js #727 段（window.asBadgeItems /
        // asBadgeToggle / asBadgeAdd / asBadgeWrite）——这里只画视图，不另写一套池逻辑。
        // 生效链路：写盘 → asBadgeRefreshMarks 只替换屏上已有的那枚标识节点（不整窗重建＝不闪屏，
        // #846 同族口径）→ renderSec('tune') 重画本区（点亮态、「抽取方式」行的出现条件都跟着变）。
        const bdTouch = () => { try { if (window.asBadgeRefreshMarks) window.asBadgeRefreshMarks(); } catch (e) {} try { renderSec('tune'); } catch (e) {} };
        const bdWrap = document.createElement('div');
        bdWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px';
        const bdLb = document.createElement('span');
        bdLb.textContent = '标识图案（点亮即入池）';
        bdLb.style.cssText = 'font-size:11.5px;color:var(--muted,#888)';
        const bdRow = document.createElement('div');
        bdRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        const bdItems = (window.asBadgeItems ? window.asBadgeItems() : []) || [];
        bdItems.forEach(it => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = it.s;
          b.title = it.builtin ? (it.label + '（再点一次取消点亮）') : '自定义标识（再点一次取消点亮）';
          b.style.cssText = 'min-width:34px;font-size:13px;line-height:1.4;padding:5px 9px;border-radius:8px;cursor:pointer;border:1px solid ' + (it.on ? 'var(--ink,#111)' : 'var(--card-border,#ddd)') + ';background:' + (it.on ? 'var(--ink,#111)' : 'var(--btn-cancel-bg,#fafafa)') + ';color:' + (it.on ? 'var(--bg-b,#fff)' : 'var(--ink,#111)');
          b.addEventListener('click', () => {
            const nm = window.asBadgeToggle ? window.asBadgeToggle(it) : '';
            if (!nm) { toast('这枚标识已不在列表里，重开抽屉看看'); return; }
            toast((it.on ? '已取消' : '已点亮') + ' ' + nm);
            bdTouch();
          });
          bdRow.appendChild(b);
        });
        const bdAdd = document.createElement('button');
        bdAdd.type = 'button';
        bdAdd.textContent = '＋';
        bdAdd.title = '添加自定义标识（最长 4 个字符）';
        bdAdd.style.cssText = 'font-size:13px;line-height:1.4;padding:5px 10px;border-radius:8px;cursor:pointer;border:1px dashed var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)';
        bdAdd.addEventListener('click', () => {
          if (!window.openModal || !window.asBadgeAdd) { toast('这版暂不支持在这里添加'); return; }
          window.openModal('添加主动发送标识', '', (v) => {
            const r = window.asBadgeAdd(v) || { ok: 0, msg: '添加失败' };
            if (!r.ok) { toast(r.msg); return; }
            toast('已添加标识 ' + r.msg);
            bdTouch();
          }, { maxlength: 4, placeholder: '输入标识，如 🌙 / ❀ / 喵' });
        });
        bdRow.appendChild(bdAdd);
        bdWrap.appendChild(bdLb); bdWrap.appendChild(bdRow);
        wrap.appendChild(bdWrap);
        wrap.appendChild(mkPills('显示标识', [{ label: '显示', value: 1 }, { label: '不显示', value: 0 }], () => {
          try { return (window.replyCfg ? window.replyCfg() : {})['as-badge'] === 0 ? 0 : 1; } catch (e) { return 1; }
        }, (v) => {
          if (!window.asBadgeWrite) { toast('这版暂不支持在这里开关'); return; }
          window.asBadgeWrite('as-badge', v);
          toast(v ? '已显示主动发送标识' : '已隐藏主动发送标识');
          bdTouch();
        }));
        if (bdItems.filter(it => it.on).length >= 2) {
          wrap.appendChild(mkPills('多枚标识怎么抽取', [{ label: '每次随机', value: 1 }, { label: '按顺序轮换', value: 0 }], () => {
            try { return (window.replyCfg ? window.replyCfg() : {})['as-badge-rand'] === 0 ? 0 : 1; } catch (e) { return 1; }
          }, (v) => {
            window.asBadgeWrite('as-badge-rand', v);
            toast(v ? '多枚标识：每次随机' : '多枚标识：按顺序轮换');
            bdTouch();
          }));
        }
        wrap.appendChild(mkNote('自定义标识在这里点亮/取消，要删除回 设置→回复设置→聊天→主动发送→标识。'));
        wrap.appendChild(mkNote('气泡 CSS 改了气泡大小/内边距后，标识和时间轴的位置可能跟着偏——这里手动校准。0 = 默认位置'));
        wrap.appendChild(mkSlider('标识 左右', () => clampOffset(store.get('cs-mark-x')), v => setOff('cs-mark-x', v), OFFSET_MIN, OFFSET_MAX, 1, 'px', 0));
        wrap.appendChild(mkSlider('标识 上下', () => clampOffset(store.get('cs-mark-y')), v => setOff('cs-mark-y', v), OFFSET_MIN, OFFSET_MAX, 1, 'px', 0));
        wrap.appendChild(mkSlider('时间轴 左右', () => clampOffset(store.get('cs-time-x')), v => setOff('cs-time-x', v), OFFSET_MIN, OFFSET_MAX, 1, 'px', 0));
        wrap.appendChild(mkSlider('时间轴 上下', () => clampOffset(store.get('cs-time-y')), v => setOff('cs-time-y', v), OFFSET_MIN, OFFSET_MAX, 1, 'px', 0));
        wrap.appendChild(mkAct('位置全部恢复默认', () => {
          ['cs-mark-x', 'cs-mark-y', 'cs-time-x', 'cs-time-y'].forEach(k => { try { store.remove(k); } catch (e) {} });
          applySettings();
          renderSec('tune');
          toast('标识与时间轴位置已恢复默认');
        }));
        wrap.appendChild(mkNote('左右：正值往右、负值往左；上下：正值往下、负值往上。时间轴要先在「字体 · 其他」里选好样式再调。'));
        return wrap;
      } }
    ];
    const paintCsChips = (key) => {
      Array.prototype.forEach.call(chipsRow.children, c => {
        const on = c.dataset.sec === key;
        const bg = on ? 'var(--ink,#111)' : 'var(--btn-cancel-bg,#fafafa)';
        if (c.style.background !== bg) c.style.background = bg;
        const fg = on ? 'var(--bg-b,#fff)' : 'var(--ink,#111)';
        if (c.style.color !== fg) c.style.color = fg;
        const bd = on ? 'var(--ink,#111)' : 'var(--card-border,#ddd)';
        if (c.style.borderColor !== bd) c.style.borderColor = bd;
      });
    };
    const renderSec = (key) => {
      // v8.29 #1008：点亮态只在真变化时写（口径同 #938：先比对，相等就别写）——原实现每次
      // renderSec 都无条件写 3×N 个 style（实测重复点同一分区白写 24~30 次）。重建控件区的
      // 行为刻意保留：点当前分区胶囊＝重画本区视图是既有刷新链路（verify-badge-tune D3 依赖）。
      csDrawerSec = key;
      paintCsChips(key);
      body.innerHTML = '';
      paletteHost = null;
      colorItems = [];
      const sec = SECS.filter(s => s.key === key)[0];
      if (sec) body.appendChild(sec.build());
    };
    SECS.forEach(s => {
      const c = document.createElement('button');
      c.type = 'button'; c.textContent = s.label; c.dataset.sec = s.key;
      c.style.cssText = 'flex:1;font-size:11.5px;padding:7px 0;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
      c.addEventListener('click', () => renderSec(s.key));
      chipsRow.appendChild(c);
    });
    renderSec(csDrawerSec);
    d.style.display = 'flex';
    // #783：层级让位 + 壁纸身份变化重渲染。抽屉内点「上传/图库」会开浮层（见 csDrawerLayerTick
    // 注释的层级表），240ms 轮询足够覆盖「点开即让位、关掉即回正」的感知，且常驻监听只在抽屉
    // 开着时挂（csDrawerClose 负责拆）。
    clearInterval(csDrawerWatchTimer);
    let csLastBgSig = csDrawerBgSig();
    csDrawerLayerTick();
    csDrawerWatchTimer = setInterval(() => {
      csDrawerLayerTick();
      const s = csDrawerBgSig();
      if (s !== csLastBgSig) { csLastBgSig = s; try { renderSec(csDrawerSec); } catch (e) {} }
    }, 240);
    // #760：恢复会话内拖动位置 + 键盘抬升监听；打开即滚到最新一条（用户此前停在半屏
    // 中间时只能看到时间轴碎片）；空对话注入示例气泡，保证「改哪看哪」永远有得看。
    try {
      csDemoBubbles(false);
      csDrawerApplyBottom();
      csDrawerBindKbLift();
      const cb = document.getElementById('chat-body');
      if (cb) {
        if (!cb.querySelector('.msg')) csDemoBubbles(true);
        // #856：示例气泡的标识是占位串（*~*），打开抽屉先按当前标识池换成真图案，
        // 免得在「微调」里换标识前看到的是一枚不存在的花符号
        try { if (window.asBadgeRefreshMarks) window.asBadgeRefreshMarks(cb); } catch (e) {}
        cb.scrollTop = cb.scrollHeight;
      }
    } catch (e) {}
  }
  // 入口按钮：注入聊天设置→美化 段最上方（JS 注入，不动 template.html——同文件上方两开关的做法）
  (function injectCsLiveAdjust() {
    const sec = document.querySelector('#page-chat-settings .them-sec[data-sec="beautify"]');
    if (!sec || document.getElementById('cs-live-adjust')) return;
    const b = document.createElement('button');
    b.id = 'cs-live-adjust';
    b.type = 'button';
    b.style.cssText = 'display:flex;align-items:center;gap:10px;width:calc(100% - 24px);margin:10px 12px 0;padding:11px 14px;border:1px solid var(--card-border,#ddd);border:1px solid color-mix(in srgb, var(--btn-bg,#111) 40%, var(--card-bg,#fff));border-radius:12px;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--btn-bg,#111) 10%, var(--card-bg,#fff));color:var(--btn-bg,#111);text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;flex-shrink:0';
    b.innerHTML = '<span style="flex:1;min-width:0">' +
      '<span style="display:block;font-size:15px;font-weight:700;line-height:1.25">边看边调</span>' +
      '<span style="display:block;font-size:11.5px;font-weight:400;opacity:.85;margin-top:2px">打开调色条：聊天在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位</span>' +
      '</span><span style="flex:none;font-size:12px;font-weight:700;padding:7px 10px;border:1px solid var(--btn-bg,#111);border-radius:999px;background:var(--btn-bg,#111);color:var(--btn-ink,#fff);white-space:nowrap">点击开启 ›</span>';
    b.addEventListener('click', openChatBeautyDrawer);
    const first = sec.querySelector('.gs-title');
    if (first) sec.insertBefore(b, first); else sec.appendChild(b);
  })();
})();