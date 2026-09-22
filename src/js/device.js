// ===== 功能：统一设备判定（v3.16.x） =====
// 背景：isMobile / isTablet / isIOS / isAndroid / isVia 此前在 mobile-adapt.js /
// fullscreen.js / pwa.js / bg-keep.js 各算一遍，规则略有出入——同一台设备可能被
// 两个模块判成不同形态，行为互相打架（如 mobile-adapt 判手机、pwa 判桌面）。
// 这里收敛为唯一判定源 window.mochiDevice，各模块统一读取；以后新增浏览器 /
// 新伪装手段时只改本文件。判定逻辑 = mobile-adapt.js 完整版（含桌面伪装兜底：
// viewport 改写 / force-mobile / .tablet 类），仅此一处执行副作用。
(function () {
  // build.mjs 把每个功能文件各自包进 try/catch，兜底写的是
  // `if (window.__jsErrors) window.__jsErrors.push(...)`——数组不存在时启动异常被
  // 静默丢弃（此前全项目只有 chat.js 某个 catch 里惰性创建，实测产物里恒为
  // undefined）。device.js 是 jsFiles 第一个文件，初始化放最前面，后面所有文件的
  // 启动异常才有地方落，诊断信息的「启动文件异常」一节才有数据。
  try { window.__jsErrors = window.__jsErrors || []; } catch (e0) {}
  // ===== 全局轻提示 window.toast（v3.27.x）=====
  // 用户反馈：「设置里好多开启/关闭开关，点了没有任何提示，不知道到底切没切」。
  // 根因：全项目 20+ 个文件（incoming-requests / ta-ask / ta-mood / reply-settings /
  //   quote-cards / feed / mail / period …）的开关反馈都写成
  //   `if (typeof window.toast === 'function') window.toast('…已开启')`，
  //   但从来没有一处给 window.toast 赋过值——全站唯一的提示通道是死的，只有少数
  //   模块自己另画一份（device.js 诊断、page-coach、chat-settings 群聊开关才有兜底），
  //   其余开关点了屏幕上零变化（device.js 下方与 page-coach.js 各自记录过这条死通道）。
  // 这里补上唯一实现：复用全站既有的 #cc-toast 元素 + .cc-toast.show 类（样式与
  //   2.6s 自动淡出动画在 chat-pages.css），与既有自绘兜底同一元素、同一观感，
  //   不会出现两个提示叠在一起。__lastToastAt 供设置页统一开关反馈去重
  //   （settings-help.js：模块已给专属文案时不再补通用文案）。
  try {
    window.toast = function (msg) {
      try {
        const text = (msg === undefined || msg === null) ? '' : String(msg);
        if (!text) return;
        window.__lastToastAt = Date.now();
        const show = function () {
          let t = document.getElementById('cc-toast');
          if (!t) {
            t = document.createElement('div');
            t.id = 'cc-toast';
            if (!document.body) { setTimeout(show, 0); return; }
            document.body.appendChild(t);
          }
          t.textContent = text;
          // 先摘 .show 再挂回：重放 CSS 自动淡出动画（重开时旧动画不互相干扰）
          t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
          clearTimeout(t._timer);
          t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2600);
        };
        show();
      } catch (e) {}
    };
  } catch (e) {}
  // 只在真实手机窄屏启用（桌面模拟器外壳不受影响）
  // v3.5.137：900px——Moto G100 等 2400px 物理屏 / DPR 2.75-3 的 CSS 视口约 800-873px，
  // 原 768px 上限会误判为桌面（显示 390px 小手机框 + 两侧灰底）
  let isMobile = false;
  try { isMobile = window.matchMedia && window.matchMedia('(max-width: 900px)').matches; } catch (e) {}
  let mobileRule = isMobile ? 'viewport<=900' : '';
  const ua = String(navigator.userAgent || '');

  // ===== v3.26.x：手动布局偏好（识别失手时用户自救）=====
  // 「桌面版网站」模式会把 UA / screen / 触摸能力 / layout viewport 整套仿真成桌面，
  // 纯指纹识别必有漏网。留一条不依赖判定的通道：设置页「手机布局（强制）」开关，
  // 或地址栏 ?mobile=1（强制手机）/ ?pc=1（强制桌面外壳），落 localStorage 长期生效。
  // 空值 = 跟随自动判定。
  const LAYOUT_KEY = 'xy-home-v2:__layout-pref';
  let layoutPref = '';
  try { layoutPref = localStorage.getItem(LAYOUT_KEY) || ''; } catch (e) {}
  try {
    const pq = /[?&](mobile|pc)=(\d)/.exec(location.search || '');
    if (pq) {
      const want = pq[2] === '1' ? pq[1] : '';
      if (want !== layoutPref) {
        layoutPref = want;
        try {
          if (want) localStorage.setItem(LAYOUT_KEY, want);
          else localStorage.removeItem(LAYOUT_KEY);
        } catch (e2) {}
      }
    }
  } catch (e) {}

  // v3.7.x：iPad/平板检测——iPad 竖屏（768-834px CSS 视口）命中 isMobile 走手机全屏
  // 布局，内容被整屏拉宽（桌面图标间距巨大、气泡过宽）；iPad 横屏（≥1024px）走
  // 桌面模拟器外壳（390px 小框 + 两侧灰底）。两者都不适合平板。
  // 命中给 <html> 加 .tablet 类（base.css 平板布局：全高 + 内容限宽居中 +
  // 无模拟器外壳，竖屏/横屏观感一致）。
  // iPadOS 13+ 的 UA 伪装成 Macintosh（桌面 macOS UA + 触摸屏 maxTouchPoints>1），
  // 老系统 UA 带 iPad 关键字，两种都覆盖。
  // FIX 2026-09-17 #707：Macintosh 伪装分支补「screen 短边 ≥600 CSS px」——iPhone 的
  // Safari/Via 开「请求桌面网站」后 UA 同样变成 Macintosh（iPhone15ProMax 实测
  // platform=MacIntel + maxTouchPoints=5 + screen=430×932，诊断「html 类:tablet、
  // 判定依据:tablet」），原分支把这类手机整体判成平板走 .tablet 布局（全局
  // touch-action 改写等一整套非主流路径）。真 iPad 伪装时 screen 短边最小 744
  // （iPad mini）≥600 照常平板；触摸屏 Mac 短边 ≥982 不受影响；iPhone 全系
  // （短边 ≤440）回到手机布局。注意 isIOS 的同款伪装分支不动——iPhone 本就是 iOS，
  // 键盘/安全区/standalone 适配必须照走。
  let isTablet = false;
  try {
    const plat = String(navigator.platform || '');
    // v3.7.x：/iPad/ 分支加 Android 排除——UA 伪装成 iPad 的安卓窄屏机（OPPO/Via 等）
    //   会被误判为平板走手机全屏布局，内容整屏拉宽。真 iPad 不含 Android 关键字，安全
    const _mScreen = Math.min((screen && screen.width) || 0, (screen && screen.height) || 0);
    isTablet = (/iPad/i.test(ua) || plat === 'iPad') && !/android/i.test(ua) ||
      ((plat === 'MacIntel' || /Macintosh/i.test(ua)) && navigator.maxTouchPoints > 1 && 'ontouchstart' in window && _mScreen >= 600);
    // #555：安卓平板判定——此前只认 iPad/Macintosh 触摸屏，安卓平板（荣耀平板/EC-PAD01
    // 等用户真实设备）竖屏被当手机全屏拉宽、横屏掉进桌面 390px 外壳。UA 特征：安卓平板
    // 无 Mobile 关键字（安卓手机 UA 恒带 Mobile），再加短边 ≥600 CSS px 双保险，防个别
    // 手机 UA 缺 Mobile 或平板直出小窗口时误判。
    const _tw = (screen && screen.width) || 0, _th = (screen && screen.height) || 0;
    if (!isTablet && /Android/i.test(ua) && !/Mobile/i.test(ua) && Math.min(_tw, _th) >= 600) isTablet = true;
  } catch (e) {}

  // ===== 伪装桌面兜底判定（v3.9.x 起逐轮补强；v3.26.x 收进规则表）=====
  // 场景：Edge/Via 等浏览器「桌面版网站」模式把 UA 改成 Windows 桌面、layout
  // viewport 拉到 980px → 上面 matchMedia('(max-width:900px)') 误判为桌面，手机
  // 显示成「390px 小框 + 两侧灰底」的 PC 外壳，且连带全屏判定失效。
  // v3.26.x 的关键修正：前三条规则都要求触摸信号为真（maxTouchPoints>0 或
  // ontouchstart），而 Edge 安卓桌面模式会把触摸能力一并仿真掉 → 四条全落空。
  // 现补一组不依赖触摸的规则（下列 4~8），并保留原规则不动。
  const sig = {
    sw: 0, sh: 0, touch: false, uaDesk: false, uaMobile: false, oriApi: false,
    coarse: false, hoverNone: false, vvW: 0, uchMobile: false, uchAndroid: false
  };
  try {
    sig.sw = screen.width || screen.availWidth || 0;
    sig.sh = screen.height || screen.availHeight || 0;
    sig.touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    sig.uaDesk = /Windows NT|Macintosh|X11|CrOS/i.test(ua);
    sig.uaMobile = /Android|iPhone|iPod|Mobile/i.test(ua);
    sig.oriApi = typeof window.orientation !== 'undefined';
    if (window.matchMedia) {
      sig.coarse = !!window.matchMedia('(pointer: coarse)').matches;
      sig.hoverNone = !!window.matchMedia('(hover: none)').matches;
    }
    sig.vvW = (window.visualViewport && window.visualViewport.width) || 0;
    // UA-CH（Chromium 系 client hints）：桌面模式改的多是 UA 字符串本身，
    // 低熵值 platform/mobile 常与真实内核保持一致，作为附加信号（不做唯一依据）
    const uch = navigator.userAgentData;
    if (uch) {
      sig.uchMobile = uch.mobile === true;
      sig.uchAndroid = /android/i.test(String(uch.platform || ''));
    }
  } catch (e) {}
  // screen.width<900：设备物理 CSS 宽，桌面显示器 ≥1024，不随窗口缩放
  const narrowScreen = sig.sw > 0 && sig.sw < 900;
  // 竖屏手机外形：窄 + 明显高过宽。真桌面即便窄也横向居多
  const phoneShaped = narrowScreen && sig.sh >= sig.sw * 1.25;
  // 移动端内核/手指输入特征（这两条媒体查询反映硬件，桌面模式改不掉）
  const mobileInput = sig.coarse && sig.hoverNone;
  const RULES = [
    ['narrow-screen+touch', sig.touch && narrowScreen],
    ['vv<=900+touch', sig.touch && sig.vvW > 0 && sig.vvW <= 900],
    ['desktop-ua+touch', sig.touch && sig.uaDesk && (sig.oriApi || mobileInput)],
    ['mobile-ua+narrow-screen', sig.uaMobile && narrowScreen],
    ['desktop-ua+phone-screen', sig.uaDesk && phoneShaped],
    ['desktop-ua+coarse-pointer', sig.uaDesk && mobileInput],
    ['desktop-ua+mobile-uch', sig.uaDesk && (sig.uchMobile || sig.uchAndroid)],
    ['desktop-ua+vv<=900+mobile-input', sig.uaDesk && sig.vvW > 0 && sig.vvW <= 900 && (sig.oriApi || mobileInput)]
  ];
  let viewportFixed = false;
  // FIX 2026-09-18 #718：meta 内容统一出口——两处改写（device-width／显式像素）只差宽度段，
  // interactive-widget 按平台选：iOS=resizes-content（mobile-adapt.js 同款；resizes-visual 下
  // iOS 键盘收缩 .phone 异常）、安卓=resizes-visual。原两处写死 resizes-visual，iOS 桌面伪装
  // ＋内核不认 viewport 改写时，本函数 rAF 晚跑会把 mobile-adapt 已改的 resizes-content
  // 盖回去＝键盘适配退回异常形态。
  function viewportMetaContent(widthPart) {
    return widthPart + ', initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=' + (isIOSUa() ? 'resizes-content' : 'resizes-visual');
  }
  // 把 layout viewport 拉回设备宽度：改 viewport meta → 不奏效再改显式像素宽度 →
  // 仍不奏效才加 html.force-mobile 类作 CSS 保底（base.css 复刻手机端关键规则）。
  function applyViewportFix() {
    if (viewportFixed) return;
    // v3.26.x #714：用户手动选了桌面外壳（?pc=1 / 设置「桌面布局（强制）」）时整条不执行——
    // 本函数在 RULES 命中时同步调用、而手动偏好是其后才覆盖 isMobile；异步 rAF 链
    // （meta 改写→两帧后加 force-mobile 类）不看最终判定，会把手选 pc 的用户强改成
    // 满屏手机布局（触屏/小屏 PC + 强制 pc 可复现的混合态：JS 认为桌面、CSS 却满屏）。
    if (layoutPref === 'pc') return;
    viewportFixed = true;
    // 改 viewport meta 把 layout viewport 拉回设备宽度——让 CSS
    // @media(max-width:900px) 自然命中，所有手机端规则生效。桌面站点
    // 模式浏览器可能忽略 meta，下方加 force-mobile 类作 CSS 保底。
    try {
      document.querySelectorAll('meta[name="viewport"]').forEach(function (m) {
        m.setAttribute('content', viewportMetaContent('width=device-width'));
      });
    } catch (e) {}
    // 等一帧看媒体查询是否命中；未命中说明该内核「桌面站点」模式下连
    // device-width 都被仿真成桌面大屏（980）→ 改写 viewport 为【显式像素
    // 宽度】再试：真实设备 CSS 宽用 visualViewport 反推（vv.width×vv.scale
    // ≈ 物理 CSS 宽，桌面模式初始缩小显示时 scale<1、两者乘积恒为真宽）。
    // 数字宽度不依赖 device-width 仿真，多数内核会直接采纳 → 媒体查询全量
    // 生效（force-mobile 类只复刻关键规则，覆盖不了各功能页的手机端样式）。
    // 再等两帧复查，仍未命中才加 force-mobile 类作最终保底。
    try {
      requestAnimationFrame(function () {
        try {
          if (!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches)) {
            var vw = 0;
            try {
              var vv = window.visualViewport;
              // v3.13.x：优先采信 vv.width（桌面站点模式下 = 真机 CSS 宽 ~360-412，
              // 不会被 980 伪装）；vv.width×vv.scale 在桌面模式会算出伪装的 980
              // 而被下方区间过滤掉 → viewport 改写静默失败只能退 force-mobile，
              // 故仅在 vv.width 缺失时才用乘积兜底。
              var est = vv && vv.width > 0 ? Math.round(vv.width)
                : (vv && vv.scale > 0 && vv.width > 0 ? Math.round(vv.width * vv.scale) : 0);
              // 合理区间过滤：缩放中/异常值不采信（手机 CSS 宽 200-899）
              if (est >= 200 && est < 900) vw = est;
            } catch (e2) {}
            if (vw) {
              document.querySelectorAll('meta[name="viewport"]').forEach(function (m) {
                m.setAttribute('content', viewportMetaContent('width=' + vw));
              });
            }
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                try {
                  if (!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches)) {
                    document.documentElement.classList.add('force-mobile');
                  }
                } catch (e3) {}
              });
            });
          }
        } catch (e) {}
      });
    } catch (e) {}
  }
  if (!isMobile && !isTablet) {
    for (let ri = 0; ri < RULES.length; ri++) {
      if (RULES[ri][1]) {
        isMobile = true;
        mobileRule = RULES[ri][0];
        break;
      }
    }
    if (isMobile) applyViewportFix();
  } else if (isTablet) {
    mobileRule = 'tablet';
  }

  // 手动偏好最后覆盖（识别失手也不至于把用户锁死在错误形态里）
  if (layoutPref === 'mobile') {
    isMobile = true; isTablet = false; mobileRule = 'pref:mobile';
    applyViewportFix();
  } else if (layoutPref === 'pc') {
    isMobile = false; isTablet = false; mobileRule = 'pref:pc';
  }
  if (isTablet) { try { document.documentElement.classList.add('tablet'); } catch (e) {} }

  // 历史沿革：v3.9.x 触摸屏+窄 screen → v3.11.x orientation/pointer 输入特征 →
  // v3.13.x visualViewport.width → 均在 vivo Y35 + Edge「桌面版网站」模式前失手，
  // 根因是这组规则都要求触摸信号为真。已统一收进上方 RULES + applyViewportFix。

  // 平台判定（含 UA 伪装排除——OPPO/Via/夸克等浏览器可把 UA 伪装成 iPhone）
  // v3.7.x：/iphone|ipad|ipod/ 分支加 Android 排除（多数 UA 切换不彻底会保留
  // Android 标识）；!window.MSStream 排除 Windows Phone 的 IE/Spartan
  // v3.26.x #144：iPadOS 13+ Safari 把 UA 伪装成 Macintosh（桌面 Mac UA + 触摸屏），
  // 原判定全部落空 → iOS=false：iPad Air 7 + Safari 主屏幕实测「点全屏模式无反应」
  // （fullscreen.js isIOS=false 走错分支，iPad 又无 Fullscreen API → 开关被拒绝），
  // 且 ios-pwa-standalone 类不加、#114/#129 安全区补偿在 iPad 全部失效。补 Macintosh
  // 伪装分支——与上方 isTablet 第二分支同信号（真桌面 Mac maxTouchPoints=0 不会误判，
  // iPadOS 触摸屏 maxTouchPoints≥5）。
  // FIX 2026-09-18 #718：iOS 判定收成具名函数——applyViewportFix 的同步 meta 改写段在其
  // 调用点（本 const 初始化之前执行）就要按平台选 interactive-widget 关键字，直接引用
  // const 会 TDZ；函数声明提升后两处共享同一判定，防口径漂移。
  function isIOSUa() {
    return (/iphone|ipad|ipod/i.test(ua) && !/android/i.test(ua) && !window.MSStream) ||
      ((navigator.platform === 'MacIntel' || /Macintosh/i.test(ua)) && navigator.maxTouchPoints > 1 && 'ontouchstart' in window);
  }
  const isIOS = isIOSUa();
  const isAndroid = /android/i.test(ua);
  // v3.6.x：Via 浏览器（UA 特征）——实测其 WebView 禁用了方向锁（lock 无效），
  // 网页全屏必转横屏，fullscreen.js 需据此走 CSS 兜底
  const isVia = /via/i.test(ua);

  // 唯一判定源：全模块统一从这里读
  // mobileRule = 本次判定依据（诊断信息/设置页文案用），signals = 参与判定的原始信号
  function setLayoutPref(v) {
    layoutPref = v || '';
    try {
      if (layoutPref) localStorage.setItem(LAYOUT_KEY, layoutPref);
      else localStorage.removeItem(LAYOUT_KEY);
    } catch (e) {}
    return layoutPref;
  }
  // ===== v3.26.x 收口第二批：环境能力层 env（UA 嗅探唯一处）=====
  // 背景：chat.js 语音 WebView 大正则 / data-backup.js 分享面板黑名单 /
  // music-player.js 两处音乐 API 拦截提示 / bg-keep.js 小米通知提示，此前各拼
  // 一套 UA 正则（同一批浏览器名单在 4 个文件里各写一遍，改漏一处=修一半）。
  // 收口到这里，业务文件只消费布尔标记、不再碰 UA；以后新增浏览器/壳特征只改
  // 本文件。保守语义与原各处一致：拿不到 UA 时按「最坏情况」处理（见各字段）。
  const _envUa = String((function () { try { return navigator.userAgent || ''; } catch (e) { return ''; } })());
  const env = {
    // 安卓 WebView/内嵌壳（语音走 mp4/aac 优先——webm/opus 能录不能播）。
    // 拿不到 UA 保守按 WebView 处理（只影响音质不影响可用，同 chat.js 原语义）
    isAndroidWebView: (function () {
      try {
        if (!_envUa) return true;
        return /wv\b|MicroMessenger|MicroApp|VivoBrowser|OPBrowser|MQQBrowser|QQBrowser|baiduboxapp|UCBrowser|XiaoMi|MiuiBrowser|HuaweiBrowser|Quark|SogouMobileBrowser|SamsungBrowser|MetaSr|OBABROWSER|dingtalk/i.test(_envUa);
      } catch (e) { return true; }
    })(),
    // navigator.share({files}) 会假成功（canShare true 但调用即抛）的壳——备份导出
    // 跳过分享面板直接走「确定后下载」（华为 Mate20 默认浏览器/夸克，v3.9.x）
    // FIX 2026-09-19 #854：OPPO/一加/真我 ColorOS 自带浏览器（HeyTapBrowser 内核）的
    // 分享面板会直接把浏览器整个搞崩——OPPO A96 实报「任何需要导出数据的地方都无法导出，
    // 还会闪退」，而主链路第一步必经 navigator.share({files}) 弹系统分享面板＝每次导出都崩。
    // 与 v3.31 记录的「OPPO Find X9 分享 50MB+ 把标签页搞崩」同族（那个已用 shareMax 限流），
    // 本条是面板级故障、与体积无关，有实报证据才进名单。
    brokenFileShare: /huaweibrowser|quark|heytapbrowser/i.test(_envUa),
    // #854：分享面板是「进程闪退」级故障（弹一次崩一次、真用户手势也一样崩）的内核——
    // 除主链路跳分享面板（brokenFileShare）外，导出后的「换一种方式」换路按钮
    // （data-backup.js altSaveFile）也不许再碰 navigator.share，否则用户点一下崩一次。
    // 与 brokenFileShare 分开登记：夸克/华为在真手势下分享面板可用（#758 唯一可靠通道），不回退。
    shareSheetCrash: /heytapbrowser/i.test(_envUa),
    // FIX 2026-09-19 #815：blob: 下载可能被静默丢弃、需要在「确定后下载」之后追问
    // 「文件保存成功了吗」的环境（追问弹窗/换路按钮在 data-backup.js afterDownloadAttempt）。
    // #758 只点名夸克/华为，#603 同期已实证小米 MIUI 同样静默丢——按内核点名追问永远
    // 追不完（用户原话「其他设备型号也有」），改三类并集的结构性判定：
    // ①壳家族 UA（自带下载管理器会丢 blob: 的壳；三星 Chrome 系下载可靠不在列＝免添噪音）；
    // ②安卓能力缺口兜底（不能 navigator.share 文件、也没有系统保存框＝裸 blob: 下载是
    //   唯一路＝壳浏览器长尾，未来新壳不改本名单自动覆盖；Firefox 下载可靠显式排除）；
    // ③iOS 主屏独立容器（无下载管理器，a[download] 静默无反应——#172 结论）。
    // 只影响下载后的追问一步，不改三级降级链任何顺序；桌面端恒 false（下载可靠零噪音）。
    downloadAsk: (function () {
      try {
        if (/huaweibrowser|quark|miuibrowser|vivobrowser|heytapbrowser|opbrowser|mqqbrowser|qqbrowser|ucbrowser|baiduboxapp|baidubrowser|sogoumobilebrowser|micromessenger|microapp|obabrowser|dingtalk/i.test(_envUa)) return true;
        if (isIOS) return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
        if (!isAndroid) return false;
        if (/firefox/i.test(_envUa)) return false;
        if (window.showSaveFilePicker) return false;
        return !(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));
      } catch (e) { return false; }
    })(),
    // 音乐 API 被壳拦截、可提示用户换 Safari 的环境（QQ 浏览器/夸克，文案提示共用）
    apiBlockedHint: /QQBrowser|Quark/i.test(_envUa),
    // 系统级通知可能拦截（API 不报错但通知不显示）的安卓环境（红米/小米等 MIUI 系）
    notifyQuirk: /miui|xiaomi|redmi|hyperos/i.test(_envUa) || /android/i.test(_envUa)
  };

  // ===== #907 冻结归因探针 =====
  // 背景：iPhone 17PM 实报「设置页不动也每 1.7 秒卡一次、最长卡死 3.42 秒」（300 秒自检：
  // 平均 13.3fps／掉帧 96%／前台冻结 175 次），而 iOS WebKit 没有 longtask 观测，「长任务：无」
  // 完全不可信——只能靠相位标记把「冻结前最后在做什么」记下来。各重活入口（大键写 IDB、
  // 小键写日志、聊天落盘、表情包落盘…）调 window.__mochiPhase('tag')，卡顿自检在 >250ms
  // 前台冻结时回查冻结起点前的最近标记并在报告点名。环形 30 条、字符串极短、零常驻开销。
  try {
    if (!window.__mochiPhase) {
      window.__mochiPhaseLog = window.__mochiPhaseLog || [];
      window.__mochiPhase = function (tag) {
        try {
          var l = window.__mochiPhaseLog;
          if (l.length >= 30) l.shift();
          l.push({ t: Date.now(), tag: String(tag) });
        } catch (e) {}
      };
    }
  } catch (e) {}

  window.mochiDevice = {
    isMobile: !!isMobile,
    isTablet: !!isTablet,
    isIOS: !!isIOS,
    isAndroid: !!isAndroid,
    isVia: !!isVia,
    mobileRule: mobileRule,
    layoutPref: layoutPref,
    signals: sig,
    env: env,
    setLayoutPref: setLayoutPref
  };

  // ===== v3.26.x：视口 / 键盘 / 全屏现场探针（只读）window.mochiVvDiag() =====
  // iOS 三项报障（输入栏下空一块、页面突然上移点不动、全屏开关没反应）在无头
  // Chrome 里都拿不到 WebKit 的真实几何，只能把现场数据随诊断文本一起回收。
  // 组合两路：本函数从 DOM/计算样式实测 + mobile-adapt.js 的键盘内部状态
  // （iOS window.__mochiIosKb / 安卓 window.__mochiAndroidKb，字段名一致）——
  // 后者才知道棘轮基线/文档锁/推定停靠到底残留没有。
  window.mochiVvDiag = function () {
    try {
      const d = document.documentElement;
      const cs = window.getComputedStyle(d);
      const vv = window.visualViewport || null;
      const phone = document.querySelector('.phone');
      const ps = phone ? window.getComputedStyle(phone) : null;
      const pr = phone ? phone.getBoundingClientRect() : null;
      let fsMode = '关闭';
      if (document.fullscreenElement || document.webkitFullscreenElement) fsMode = '原生全屏';
      else if (d.classList.contains('fs-css-active')) fsMode = 'CSS兜底全屏';
      else if (d.classList.contains('ios-fs-active')) fsMode = 'iOS隐藏模拟状态栏';
      else if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) fsMode = '系统级全屏(display_override)';
      const out = {
        innerH: window.innerHeight || 0,
        innerW: window.innerWidth || 0,
        vvH: vv ? Math.round(vv.height) : null,
        vvW: vv ? Math.round(vv.width) : null,
        vvOffsetTop: vv ? Math.round(vv.offsetTop || 0) : null,
        vvScale: vv ? vv.scale : null,
        screenH: (window.screen && screen.height) || 0,
        docScrollY: Math.round(window.scrollY || window.pageYOffset || 0),
        safeBottom: cs.getPropertyValue('--mochi-safe-bottom').trim() || '(未设→env)',
        iosH: cs.getPropertyValue('--mochi-ios-h').trim() || '(未设)',
        phoneH: ps ? Math.round(parseFloat(ps.height) || 0) : 0,
        phoneTop: pr ? Math.round(pr.top) : null,
        phoneBottom: pr ? Math.round(pr.bottom) : null,
        phoneInlineH: phone && phone.style.height ? phone.style.height : '',
        phoneAlignSelf: phone && phone.style.alignSelf ? phone.style.alignSelf : '',
        htmlInlineOverflow: d.style.overflow || '',
        bodyScrollLock: !!(document.body && document.body.classList.contains('scroll-lock')),
        vvFit: d.classList.contains('ios-vv-fit'),
        standalone: d.classList.contains('ios-pwa-standalone'),
      force: (function () { try { return localStorage.getItem('xy-home-v2:__safe-top-force') === '1'; } catch (e) { return false; } })(),
        fsMode: fsMode,
        kb: null
      };
      // 底部空隙实测：可视区底边到 .phone 底边的差（>8px 即用户说的「下面空一块」）
      if (pr && vv) out.gapBottom = Math.round(vv.height - pr.bottom);
      // FIX 2026-09-10 #267：聚焦输入框此刻到底可不可见——「点开键盘输入栏不见了」这类
      // 报障，等用户点开诊断时现场早已被自愈洗掉（.phone 复原、焦点已丢），事后静态采集
      // 永远看不到。报错瞬间直接量「焦点框底边 vs 可视带底边」，配合 kbActive/prov/innerH
      // 三个字段可把三种机理一次分开：① cov=1 且 vv=基线＝键盘纯遮挡（该内核不缩 vv，只能
      // 靠实测平移量停靠）；② cov=1 且 vv 已缩＝收缩信号到了却没接管（漏 resize/轮询停表）；
      // ③ cov=0 而 gap 很大＝停靠过头（缩多了的那「一片空白」）。判据与 _aPinPan 同口径。
      try {
        const ae = document.activeElement;
        const isTxt = ae && ((ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')
          ? (ae.type !== 'checkbox' && ae.type !== 'range' && ae.type !== 'file' && ae.type !== 'color' && !ae.readOnly)
          : ae.isContentEditable === true);
        out.focusCovered = null;
        out.focusBottom = null;
        if (isTxt && vv && ae.getBoundingClientRect) {
          const ar = ae.getBoundingClientRect();
          out.focusBottom = Math.round(ar.bottom);
          out.focusCovered = ar.bottom > (vv.offsetTop || 0) + vv.height + 2 ? 1 : 0;
        }
      } catch (e5) {}
      try { if (typeof window.__mochiIosKb === 'function') out.kb = window.__mochiIosKb(); } catch (e2) {}
      // v3.26.x：安卓分支同样导出键盘内部状态（mobile-adapt.js __mochiAndroidKb，
      // 字段名与 iOS 对齐）。此前只有 iOS 探针，安卓下 out.kb 恒 null →
      // 诊断文本「键盘/锁残留」整批 n/a，键盘类报障拿不到现场。
      try { if (!out.kb && typeof window.__mochiAndroidKb === 'function') out.kb = window.__mochiAndroidKb(); } catch (e4) {}
      try { if (typeof window.scrollLockInfo === 'function') out.lock = window.scrollLockInfo(); } catch (e3) {}
      return out;
    } catch (e) { return null; }
  };
})();

// ===== 复制诊断信息（设置页入口，v3.16.x；v3.25.x 扩充） =====
// 用户报障时拿数据，别靠来回猜：一键复制设备判定 / 视口 / 特性检测 / 存储配额 /
// 更新状态（远端 version.json 时间戳比对，判断「TA 手机是不是旧缓存」）/
// 最近错误（含调用栈 + 资源加载失败 + console.error）/ 环境变化（旋转/键盘/前后台）/
// 长任务卡顿记录 / 网络失败 / 存储键明细 / 交互轨迹。
// 贴进 openModal 的多行文本框，剪贴板可用时自动写入（GitHub Pages https 环境可用）。
(function () {
  // v3.27.x 修复：错误采集等诊断数据链路原本依赖设置页 #row-diagnostics 存在——
  // 该行 DOM 一旦被挪/改名，整段 IIFE 直接 return，onerror/网络/长任务/交互/输入
  // 轨迹全部静默失效，且毫无报错。现改为：采集逻辑不依赖 DOM；只有角标与点击
  // 入口在使用处按需判空（见 refreshBadge / 文件尾 click 绑定）。

  // 独立取 UA：设备判定 IIFE 里的 ua 是局部变量，这里拿不到（压缩后更名），
  // 诊断模块自己读 navigator 即可
  const ua = String(navigator.userAgent || '');

  // v3.26.x 修复：开屏版本/构建时间戳在进入应用 400ms 后被 clock.js 从 DOM 移除
  //（#splash-ver 随之消失），诊断要等用户点进设置页才执行 → 版本号永远读不到、
  // 比对永远「本机无构建时间戳」。这里在 IIFE 启动时（开屏还在）先缓存一份，
  // collectDiag 改读缓存，不再依赖仍在 DOM 里的 #splash-ver。
  let verCache = '', localTsCache = 0, verShort = '';
  try {
    const sv = document.getElementById('splash-ver');
    if (sv) {
      const vb = sv.querySelector('.sv-app b');
      const verTxt = (vb && vb.textContent ? String(vb.textContent).trim() : '') || (sv.getAttribute('data-version') || '');
      const ts = sv.getAttribute('data-build-ts');
      verCache = verTxt + (ts ? ' 构建 ts=' + ts : '');
      localTsCache = Number(ts) || 0;
      verShort = verTxt;
    }
  } catch (e) {}
  try { if (!verShort) verShort = String(window.APP_VERSION || ''); } catch (e0) {}
  // v3.27.x：启动序号（错误环条目归属用）——错误环跨刷新保留 20 条，光看本地时间戳
  // 分不清「这条错误是本次启动新出，还是几次启动前的旧残留」。每次加载随机短 id +
  // 持久计数第 N 次启动，errSnap 带上 b 字段、报告头部输出本行值，条目→启动一一对号。
  const BOOT_ID = Math.random().toString(36).slice(2, 6);
  const BOOT_N_KEY = 'xy-home-v2:__diag-boot-n';
  let BOOT_N = 0;
  try {
    BOOT_N = (parseInt(localStorage.getItem(BOOT_N_KEY), 10) || 0) + 1;
    localStorage.setItem(BOOT_N_KEY, String(BOOT_N));
  } catch (e1) { BOOT_N = 0; }

  // ===== 错误自动采集（v3.16.x） =====
  // 报障文本自带最近错误栈：window.onerror / unhandledrejection 采集最近 ERR_CAP 条
  //（含 UA + 设备判定 + 页面），存 localStorage（键 __diag-errs）。纯本地、
  // 不发送任何外部服务；诊断信息里追加「最近错误」一节，用户报障直接带出来。
  // v3.26.x #100：上限 5 → 20。5 条等于「报错连环机器上只看得到最后一瞬间」，
  // 用户从出问题到想起来复制诊断，往往已经把自己那条刷掉了（环形写满即覆盖）。
  // 单条约 1KB（msg300 + ua160 + stack400），20 条约 20KB，远在 LS/IDB 大键阈值下。
  // 但报障文本要过剪贴板（本项目实测过长会被截断），所以栈只给最近 3 条：
  // 20 条正文 + 12 行栈，比旧版 5 条各带 4 行栈（25 行）还短，线索窗口却宽 4 倍。
  const ERR_KEY = 'xy-home-v2:__diag-errs';
  const ERR_CAP = 20;
  const ERR_STACK_RECENT = 3;
  function errSnap() {
    const d = window.mochiDevice || {};
    const ent = {
      t: Date.now(),
      ua: (navigator.userAgent || '').slice(0, 160),
      dev: 'M' + (d.isMobile ? 1 : 0) + ' T' + (d.isTablet ? 1 : 0) + ' I' + (d.isIOS ? 1 : 0) + ' A' + (d.isAndroid ? 1 : 0) + ' V' + (d.isVia ? 1 : 0),
      // v3.27.x：版本 + 启动序号——错误环跨版本/跨启动残留，报障文本要能对号
      v: verShort || undefined,
      b: BOOT_ID + '#' + BOOT_N,
      page: (function () {
        var v = '';
        try {
          document.querySelectorAll('.page').forEach(function (p) {
            if (!p.hidden) { v = p.id || ''; }
          });
        } catch (e) {}
        return v;
      })(),
      href: (location.pathname || '').slice(0, 80)
    };
    // v3.27.x：案发瞬间迷你视口现场——视口类 bug 多为「事发变形、点开诊断时已被
    // 自愈复原」，事后静态采集永远看不到案发几何。报错那一刻抓 6 个关键值（~50 字符），
    // 旧条目/探针未挂时不带该字段，不阻塞入环。
    try {
      if (typeof window.mochiVvDiag === 'function') {
        const g = window.mochiVvDiag();
        if (g) {
          const FSM = { '关闭': '0', '原生全屏': 'fs', 'CSS兜底全屏': 'css', 'iOS隐藏模拟状态栏': 'ios', '系统级全屏(display_override)': 'sys' };
          ent.vp = 'fs=' + (FSM[g.fsMode] || String(g.fsMode || '?').slice(0, 4))
            + ' vv=' + (g.vvH == null ? '?' : g.vvH)
            + ' gap=' + (g.gapBottom == null ? '?' : g.gapBottom)
            + ' 平移=' + (g.vvOffsetTop == null ? '?' : g.vvOffsetTop)
            + ' s=' + (g.vvScale == null ? '?' : g.vvScale)
            + ' kb=' + (g.kb && g.kb.kbActive ? 1 : 0)
            // FIX 2026-09-10 #267：键盘类报障三个分案字段——i=innerHeight（与 vv 对照即知
            // 该内核弹键盘时到底缩不缩布局视口）、p=保底停靠是否生效、cov=此刻聚焦输入框有
            // 没有被子挡住（-=无聚焦）。缺一个就得再让用户复现一轮。
            + ' i=' + (g.innerH == null ? '?' : Math.round(g.innerH))
            + ' p=' + (g.kb && g.kb.prov ? 1 : 0)
            + ' cov=' + (g.focusCovered == null ? '-' : g.focusCovered);
        }
      }
    } catch (e2) {}
    return ent;
  }
  function pushErr(msg, stack) {
    try {
      var arr = [];
      try {
        var old = localStorage.getItem(ERR_KEY);
        if (old) { var o = JSON.parse(old); if (Array.isArray(o)) arr = o; }
      } catch (e) {}
      var ent = Object.assign({ msg: String(msg).slice(0, 300), c: 1 }, errSnap());
      var st = String(stack || '').slice(0, 400);
      if (st) ent.stack = st;
      // 30s 内同文+同页去重（v3.27.x 改）：原只比最后一条——两类漏网：
      // ① 定时器/轮询同类错误每 5s 触发一次，仍会写满环形缓冲刷掉其他线索；
      // ② 两种错误交替出现时，最后一条永远不匹配，双双反复入库。
      // 现倒查最近 5 条：同 msg + 同页面 + 30s 内 → 视为重复（累加次数 c + 更新时间戳，
      // 保持出现顺序——「同一错误刷了 N 次」本身是线索，不能被去重抹掉）
      const nowT = ent.t || Date.now();
      const dupIdx = arr.findIndex(function (it) {
        return it && it.msg === ent.msg && (it.page || '') === (ent.page || '') && (nowT - (it.t || 0)) < 30000;
      });
      if (dupIdx >= 0) {
        arr[dupIdx].t = nowT;
        arr[dupIdx].c = (arr[dupIdx].c || 1) + 1;
        try { localStorage.setItem(ERR_KEY, JSON.stringify(arr)); } catch (e2) {}
        try { if (window.idbSet) window.idbSet(ERR_KEY, JSON.stringify(arr)); } catch (e2) {}
        return;
      }
      arr.push(ent);
      if (arr.length > ERR_CAP) arr = arr.slice(arr.length - ERR_CAP);
      try { localStorage.setItem(ERR_KEY, JSON.stringify(arr)); } catch (e) {}
      // v3.26.x：错误记录同时写 IndexedDB——备份导入会清空 xy-home-v2:* 前缀的
      // localStorage 键、配额满/隐私模式也会静默丢 LS 数据，错误线索就这样"没记录"。
      // 双写后 IDB 始终有副本：启动时 idbRestore 会回填，collectDiag/refreshBadge
      // 读 LS 为空时也回退 IDB，报障错误不再凭空消失。
      try { if (window.idbSet) window.idbSet(ERR_KEY, JSON.stringify(arr)); } catch (e) {}
      try { refreshBadge(); } catch (e) {}
    } catch (e) {}
  }
  // v3.26.x：错误记录读取（LS 优先，读不到回退 IndexedDB）。
  // LS 有值直接同步返回（快路径，不触发异步）；LS 为空/解析失败才查 IDB——
  // 本地数据恢复/清空后 IDB 仍保留副本，错误记录得以找回。
  // FIX 2026-09-16 #627：跨域脚本遮罩条目识别——"Script error." 且无栈＝浏览器对非同源
  // 脚本报错的统一占位，不是本应用代码抛的；升级前已入环的历史条目同样按此清理。
  function isOpaqueScriptErr(it) {
    return !!(it && !it.stack && /^Script error\.?$/i.test(String(it.msg || '').trim()));
  }
  // 启动时清掉历史遗留的跨域遮罩条目——否则角标会为已不再采集的假错误常亮，
  // 用户点开诊断只见一条无栈「Script error.」无从判断（本函数的第一次运行即清旧记录）。
  function purgeOpaqueDiagErrs() {
    try {
      const raw = localStorage.getItem(ERR_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (!Array.isArray(o)) return;
      const kept = o.filter(function (it) { return !isOpaqueScriptErr(it); });
      if (kept.length === o.length) return;
      const s = JSON.stringify(kept);
      try { localStorage.setItem(ERR_KEY, s); } catch (e1) {}
      try { if (window.idbSet) window.idbSet(ERR_KEY, s); } catch (e2) {}
      try { refreshBadge(); } catch (e3) {}
    } catch (e) {}
  }
  function readErrs(cb) {
    let arr = [];
    try {
      const raw = localStorage.getItem(ERR_KEY);
      if (raw) { const o = JSON.parse(raw); if (Array.isArray(o)) arr = o; }
    } catch (e) {}
    arr = arr.filter(function (it) { return !isOpaqueScriptErr(it); });
    if (arr.length || !window.idbGet) { try { cb(arr); } catch (e) {} return; }
    window.idbGet(ERR_KEY).then(function (raw) {
      let o = [];
      try { if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) o = p; } } catch (e) {}
      o = o.filter(function (it) { return !isOpaqueScriptErr(it); });
      try { cb(o); } catch (e) {}
    }).catch(function () { try { cb([]); } catch (e) {} });
  }
  // FIX 2026-09-20 #917：外置功能包「首拉失败」聚合——PERF-PLAN 阶段 1b 后 35+ 个功能
  // 文件走 <script defer src="js/*">，弱网 / GitHub Pages 波动 / SW 代际过渡时可能同秒
  // 成片 onerror，随后 #802 自愈引擎（pwa.js）按波重注入多半又全部到位。此前每条都照常
  // pushErr，一次波动 18 条塞满 20 条错误环、把真错误整批顶出（vivo X200S+Edge 实报：
  // 同一秒 18 条「资源加载失败 <script> …/js/xxx.js」，健康检查 82/82 全到位＝已自愈）。
  // 现改为：首拉失败只登记不记环，20s 静默窗（#802 三波 1.5/6/15s + 4s 落定）后汇总
  // 一条——全自愈 → 一条「已自愈」如实留痕；仍有缺口 → 一条「真失败」点名文件
  //（#802 自身同时把 [ext-recovery] 写进 __jsErrors，报障双向可查）。判定口径与
  // #802 failList() 逐字一致：在 __mochiExtFail 且不在 __mochiLoaded 才算真没到位，
  // 名单外的「慢下载中」不算失败。零机型/零浏览器分支。
  function extFailNote(name) {
    try {
      var a = window.__mochiExtFailAgg;
      if (!a) a = window.__mochiExtFailAgg = { names: [], timer: 0, seen: {} };
      if (a.names.indexOf(name) < 0) a.names.push(name);
      if (!a.timer) a.timer = setTimeout(extFailFlush, 20000);
    } catch (e) {}
  }
  function extFailFlush() {
    try {
      var a = window.__mochiExtFailAgg;
      if (!a) return;
      a.timer = 0;
      var names = a.names.slice(0);
      a.names.length = 0;
      if (!names.length) return;
      var fail = window.__mochiExtFail || [], loaded = window.__mochiLoaded || [];
      var still = names.filter(function (f) { return fail.indexOf(f) >= 0 && loaded.indexOf(f) < 0; });
      // 同批文件（自愈重注入）再失败＝#802 还在重试循环里，已汇总过的不重复刷（防每 20s 一条）
      var fresh = still.filter(function (f) { return !a.seen[f]; });
      if (still.length && !fresh.length) return;
      if (still.length) {
        still.forEach(function (f) { a.seen[f] = 1; });
        pushErr('[外置包·真失败] ' + still.length + ' 个功能包未加载成功: ' + still.slice(0, 6).join('、') + (still.length > 6 ? ' 等' : '') + '（网络持续异常，#802 自愈重试三波仍未到位；可刷新页面或稍后重进）');
      } else {
        pushErr('[外置包·已自愈] ' + names.length + ' 个功能包首拉失败（网络波动），自愈重试后已全部到位，功能不受影响');
      }
    } catch (e) {}
  }
  // v3.25.x：改捕获阶段监听——资源加载失败（script/css/图片 404，白屏元凶）的
  // error 事件不冒泡，只有 capture 才抓得到；JS 异常在 window 上派发，capture
  // 同样收到，一个监听覆盖两类。JS 异常带 e.error.stack 定位到文件+行号。
  try {
    window.addEventListener('error', function (e) {
      var m = '', st = '';
      try {
        if (e && e.message) {
          m = e.message;
          try { st = (e.error && e.error.stack) ? String(e.error.stack) : ''; } catch (e3) {}
        } else if (e && e.target && e.target !== window && (e.target.src || e.target.href)) {
          var tag = String(e.target.tagName || '').toLowerCase();
          var url = String(e.target.src || e.target.href || '');
          // v3.26.x：第三方音乐外链 404 不进错误日志——music-player.js 已有三级 fallback
          //（meting 直链 → 网易云官方外链 → 内置旋律），这些 404 是外链不可达
          //（api.injahow.cn / music.163.com / m8.music.126.net），进日志只制造噪音
          //（实测诊断 13 条错误全是它），掩盖真错误。静默即可，兜底逻辑会接管播放。
          if ((tag === 'audio' || tag === 'source') && /api\.injahow\.cn|music\.163\.com|music\.126\.net/.test(url)) return;
          // FIX 2026-09-10 #275 未解析媒体池令牌 404 不进错误日志——img src 还是 @@m: 令牌
          // （池数据缺失）时，浏览器把它当相对路径打网络请求必然 404，属已处理的预期失败
          //（media-pool 观察器 + #186/#202 渲染占位已如实提示「图片丢失：媒体数据缺失」），
          // 进日志只会逐次渲染刷屏（OPPO Reno16 诊断 20 条错误全是它），掩盖真错误。判定
          // 必须用 getAttribute 原始值（.src 属性已被浏览器解析成绝对地址，匹配不上令牌正则）。
          var imTok = '';
          try { imTok = String((e.target.getAttribute && e.target.getAttribute('src')) || ''); } catch (e4) {}
          if (tag === 'img' && window.mochiMediaIsToken && window.mochiMediaIsToken(imTok)) return;
          // FIX 2026-09-20 #917：外置功能包首拉失败走聚合（extFailNote），不逐条记环——
          // 这类失败多为弱网瞬态、#802 自愈多半到位；真失败 20s 后汇总一条点名（口径见上）
          if (tag === 'script') {
            var mJs = /\/js\/([^\/?#]+\.js)(?:[?#]|$)/.exec(url);
            if (mJs && window.__mochiExtFiles && window.__mochiExtFiles.indexOf(mJs[1]) >= 0) { extFailNote(mJs[1]); return; }
          }
          m = '资源加载失败 <' + tag + '> ' + url.slice(0, 120);
        }
      } catch (e2) {}
      // FIX 2026-09-16 #627 跨域脚本异常遮罩放行：浏览器对非同源脚本报错统一给
      // "Script error."（无细节、无 stack）。本应用全内联同源，真错误必带真实
      // message+stack；此文案只会来自系统/输入法/翻译/扩展注入脚本，进错误环
      // 只制造假红点（iPhone15ProMax Safari 实测用户困惑「本来没错误为什么有红点」）。
      // 无栈时静默放行；有栈的真错误照常入环。
      if (!st && /^Script error\.?$/i.test(String(m || '').trim())) return;
      if (m) pushErr(m, st);
    }, true);
  } catch (e) {}
  try {
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      var m = '';
      try { m = (r && r.message) ? r.message : String(r); } catch (e2) {}
      // FIX 2026-09-12 #367 AbortError 类未处理 rejection 不进错误环——调用方主动
      // abort（音乐/通话流超时兜底、切页取消、fetch 包装层超时）是设计内取消，不是
      // bug；Safari 报「Fetch is aborted」、Chromium 报「signal is aborted without
      // reason」等，各机型诊断环反复刷红点（iPhone18.7/iOS26 standalone 9/7~9/10
      // 实录 ×41 条），掩盖真错误。fetch 包装层（下方）本就不把它记网络失败，此处
      // 同口径：仅按 AbortError 名/已知 abort 文案放行，其余 rejection 照常入环。
      var _isAbort = false;
      try {
        _isAbort = !!(r && r.name === 'AbortError')
          || /^(Fetch is aborted|signal is aborted without reason|The user aborted a request\.?|Aborted)$/i.test(String(m || '').trim());
      } catch (e3) {}
      if (_isAbort) return;
      if (m && String(m).indexOf('ResizeObserver') < 0) pushErr('(promise) ' + m, r && r.stack ? String(r.stack) : '');
    });
  } catch (e) {}
  // v3.25.x：console.error 也收进错误缓冲——代码里主动打的错误日志（如存储/
  // 接口失败）用户看不到，报障时一并带出来。包裹只转发不吞，原行为不变。
  try {
    var origCE = console.error;
    if (typeof origCE === 'function') {
      console.error = function () {
        try {
          var a = arguments, f = a[0], m = '', st = '';
          if (f instanceof Error) {
            m = f.message || String(f);
            try { st = f.stack ? String(f.stack) : ''; } catch (e3) {}
          } else if (a.length) {
            var parts = [];
            for (var i = 0; i < a.length; i++) {
              try { parts.push(typeof a[i] === 'object' && a[i] !== null ? JSON.stringify(a[i]) : String(a[i])); } catch (e4) {}
            }
            m = parts.join(' ');
          }
          if (m) pushErr('(console.error) ' + m.slice(0, 280), st);
        } catch (e2) {}
        return origCE.apply(console, arguments);
      };
    }
  } catch (e) {}
  // ===== 网络失败记录（v3.25.x） =====
  // 包一层 fetch（device.js 是首个脚本，先于所有业务模块执行），失败（网络错/
  // ≥400）记环形 6 条；1 分钟内同址同状态去重——pwa.js 弱网下每 15s 轮询
  // version.json 会连续失败，不去重会刷屏。AbortError（调用方主动超时）不算失败。
  function fetchFail(url, status) {
    try {
      // FIX 2026-09-20 #917：浏览器自报离线（飞行模式/断网/锁屏息网）时 status=0 的失败
      // 不记——pwa.js 每 15s 轮询 ./version.json 期间必然连续网络失败，逐条记「网络失败」
      // 只制造噪音（vivo X200S+Edge 诊断 6 条 ./version.json 全落在离线段）。有响应码的
      // 失败（404/500）照记；onLine 为真但实际不通时同样照记，不放走真网络故障。
      if (!status && navigator.onLine === false) return;
      var ent = { t: Date.now(), u: String(url || '').slice(0, 90), s: status || 0 };
      var last = null;
      try {
        var a = JSON.parse(localStorage.getItem(NET_KEY) || '[]');
        if (Array.isArray(a) && a.length) last = a[a.length - 1];
      } catch (e) {}
      if (last && last.u === ent.u && last.s === ent.s && ent.t - (last.t || 0) < 60000) return;
      ringPush(NET_KEY, ent, 6);
    } catch (e) {}
  }
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        var args = arguments;
        var url = '';
        try { url = String((args[0] && args[0].url) || args[0] || ''); } catch (e) {}
        return origFetch.apply(this, args).then(function (r) {
          try { if (r && r.status >= 400) fetchFail(url, r.status); } catch (e) {}
          return r;
        }).catch(function (err) {
          try { if (!err || err.name !== 'AbortError') fetchFail(url, 0); } catch (e) {}
          throw err;
        });
      };
    }
  } catch (e) {}
  // ===== 环境变化记录（v3.25.x） =====
  // 手机端 bug 常由「旋转 / 键盘弹起 / 切后台」触发，点开诊断那一刻的静态快照
  // 看不到。把最近 10 次环境变化（视口尺寸 / 前后台）带时间戳存 localStorage
  // （键 __diag-env），诊断信息末尾输出。resize 高度差 <100px 不记录：iOS Safari
  // 工具栏收展约 55-60px 且随滚动反复触发，全记会刷屏。
  const ENV_KEY = 'xy-home-v2:__diag-env';
  const LT_KEY = 'xy-home-v2:__diag-lt';
  const NET_KEY = 'xy-home-v2:__diag-net';
  const TAP_KEY = 'xy-home-v2:__diag-tap';
  // FIX 2026-09-07 #257：触摸轨迹（「点不动/退不出」死点击定案用）——交互轨迹只记 click，
  // 「触摸活着、点击死」（合成层/输入管线/残留态吃掉点击合成）在诊断里表现为触摸零记录，
  // 无法与「用户没摸」区分。补记 touchstart（与 TAP_KEY 同款环形 6 条），诊断并排输出：
  // 触摸有、click 无＝死点击实锤（配合 mobile-adapt #257 逃生门的 __diag-stuck 记录定案）。
  const TOUCH_KEY = 'xy-home-v2:__diag-touch';
  // 通用环形缓冲写入（环境变化/长任务/网络失败/交互轨迹共用）
  function ringPush(key, ent, cap) {
    try {
      var arr = [];
      try {
        var old = localStorage.getItem(key);
        if (old) { var o = JSON.parse(old); if (Array.isArray(o)) arr = o; }
      } catch (e) {}
      arr.push(ent);
      if (arr.length > cap) arr = arr.slice(arr.length - cap);
      try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    } catch (e) {}
  }
  function envPush(k, x) {
    var ent = { t: Date.now(), k: String(k || '').slice(0, 20) };
    if (x) ent.x = String(x).slice(0, 120);
    ringPush(ENV_KEY, ent, 10);
  }
  var lastW = window.innerWidth || 0, lastH = window.innerHeight || 0;
  try {
    var rsT = null;
    window.addEventListener('resize', function () {
      if (rsT) clearTimeout(rsT);
      rsT = setTimeout(function () {
        rsT = null;
        try {
          var w = window.innerWidth || 0, h = window.innerHeight || 0;
          if (w === lastW && Math.abs(h - lastH) < 100) return;
          var x;
          if (Math.abs(w - lastW) > 20) x = w + 'x' + h + '（宽变了 ' + (w - lastW) + '，疑似旋转/分屏）';
          else if (h < lastH) x = w + 'x' + h + '（矮了 ' + (lastH - h) + 'px，疑似键盘弹起）';
          else x = w + 'x' + h + '（高了 ' + (h - lastH) + 'px，疑似键盘收起）';
          envPush('视口', x);
          lastW = w; lastH = h;
        } catch (e) {}
      }, 300);
    });
  } catch (e) {}
  try {
    document.addEventListener('visibilitychange', function () {
      envPush('前后台', document.hidden ? '切到后台' : '回到前台');
    });
  } catch (e) {}
  // ===== 长任务监测（v3.25.x） =====
  // 帧率采样只能测「打开诊断那一刻」；长任务 Observer 常驻记录 >50ms 主线程
  // 阻塞（掉帧元凶），TA 说「刚才卡了」时无需复现。环形 8 条存 localStorage
  // 跨刷新保留（靠时间戳辨新旧）。内核不支持时 ltSupported=false，输出处注明。
  var ltSupported = false;
  try {
    if ('PerformanceObserver' in window) {
      var ltObs = new PerformanceObserver(function (list) {
        try {
          var es = list.getEntries() || [];
          for (var i = 0; i < es.length; i++) {
            if (es[i] && es[i].duration >= 50) {
              ringPush(LT_KEY, { t: Date.now(), d: Math.round(es[i].duration) }, 8);
            }
          }
        } catch (e2) {}
      });
      try { ltObs.observe({ type: 'longtask', buffered: true }); ltSupported = true; } catch (e) {}
    }
  } catch (e) {}
  // ===== 交互轨迹（v3.25.x） =====
  // 捕获级点击委托，记最近 6 次点在哪个元素（标签#id.类名，最多向上 3 层）——
  // 「异常残留态」类 bug（如上轮房间取消标卡死）靠它还原用户操作路径。
  try {
    document.addEventListener('click', function (ev) {
      try {
        var desc = '', n = ev.target;
        for (var depth = 0; n && n !== document && depth < 3; depth++, n = n.parentNode) {
          var seg = n.tagName ? String(n.tagName).toLowerCase() : '';
          if (n.id) seg += '#' + n.id;
          if (typeof n.className === 'string' && n.className) seg += '.' + n.className.split(/\s+/).slice(0, 2).join('.');
          desc = desc ? seg + '>' + desc : seg;
        }
        if (desc) ringPush(TAP_KEY, { t: Date.now(), x: desc.slice(0, 80) }, 6);
      } catch (e) {}
    }, true);
  } catch (e) {}
  // FIX 2026-09-07 #257：触摸轨迹采集——只记元素标识+所在页（绝不记坐标/内容），
  // 与交互轨迹（click）并排读：触摸有 click 无＝死点击实锤。
  try {
    document.addEventListener('touchstart', function (ev) {
      try {
        var desc = '', n = ev.target;
        for (var depth = 0; n && n !== document && depth < 2; depth++, n = n.parentNode) {
          var seg = n.tagName ? String(n.tagName).toLowerCase() : '';
          if (n.id) seg += '#' + n.id;
          if (typeof n.className === 'string' && n.className) seg += '.' + n.className.split(/\s+/).slice(0, 2).join('.');
          desc = desc ? seg + '>' + desc : seg;
        }
        if (!desc) return;
        var pc = document.getElementById('page-chat');
        var pg = document.getElementById('page-group-chat');
        var at = pc && !pc.hidden ? 'chat' : (pg && !pg.hidden ? 'gc' : '');
        ringPush(TOUCH_KEY, { t: Date.now(), x: desc.slice(0, 60), pg: at }, 6);
      } catch (e) {}
    }, { passive: true, capture: true });
  } catch (e) {}
  // ===== 输入轨迹（v3.26.x）=====
  // 「聊天输入栏打字不显示、空白」（红米 K60 至尊版 + Edge）三种成因症状完全一样，
  // 只有事件级轨迹能分案：字没提交进 DOM（内核/输入法丢提交）、提交后被清
  // （防复活守卫/重绘清空）、提交了也进了 DOM 只是没画出来（合成层陈旧）。
  // 记 focus / composition 起止 / input 最近 8 条，每条只存元素标识 + 文本长度 +
  // 元素自身滚动三值（**绝不存用户输入内容**），跨刷新靠时间戳辨新旧。
  const INP_KEY = 'xy-home-v2:__diag-inp';
  function isDiagTextEl(el) {
    if (!el) return false;
    var tn = el.tagName;
    if (tn === 'INPUT' || tn === 'TEXTAREA') {
      var ty = el.type;
      return !el.readOnly && ty !== 'checkbox' && ty !== 'radio' && ty !== 'range'
        && ty !== 'file' && ty !== 'color' && ty !== 'hidden';
    }
    return el.isContentEditable === true;
  }
  function diagTextLen(el) {
    try {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return String(el.value || '').length;
      return String(el.innerText || el.textContent || '').length;
    } catch (e) { return -1; }
  }
  function diagElTag(el) {
    var seg = el.tagName ? String(el.tagName).toLowerCase() : '';
    if (el.id) seg += '#' + el.id;
    else if (typeof el.className === 'string' && el.className) seg += '.' + el.className.split(/\s+/)[0];
    return seg.slice(0, 28);
  }
  // FIX 2026-09-15 #538 输入轨迹遥测改「内存缓冲 + 节流落盘」，不再逐字同步写 localStorage。
  // 用户报障（iPhone 17 Safari，明说其他设备型号也有）：「信件板块的输入框输入文字后…每
  // 一个字符输入都会闪字」。根因：本监听挂在全局 input/composition 上，每敲一个字符就走
  // 一次 localStorage.getItem + JSON.parse + stringify + setItem（ringPush），另加 3 个布局
  // 读取。同步存储写在 iOS WebKit 上是会阻塞主线程/合成提交的调用，恰好卡在输入法提交那
  // 一刻 → 每字一次卡顿闪烁，严重时丢字（安卓/桌面同源只是不易察觉，故不做机型分支）。
  // 这段数据是纯诊断遥测（报告里「输入轨迹」一节），不参与任何业务判定，没有理由占输入热
  // 路径。修法：事件里只入内存缓冲，≤400ms 合并落盘一次；落盘格式与 ringPush 完全一致
  //（仍是同一 key 的 8 条环形数组），读侧与诊断口径不变；诊断报告生成前先 flush，保证用户
  // 即时复制诊断也能看到最后几条；切后台/离开页面兜底 flush 防丢。
  var _inpBuf = [], _inpFlushT = null;
  function inpFlush() {
    try {
      if (_inpFlushT) { clearTimeout(_inpFlushT); _inpFlushT = null; }
      if (!_inpBuf.length) return;
      var arr = [];
      try {
        var old = localStorage.getItem(INP_KEY);
        if (old) { var o = JSON.parse(old); if (Array.isArray(o)) arr = o; }
      } catch (e) {}
      arr = arr.concat(_inpBuf);
      if (arr.length > 8) arr = arr.slice(arr.length - 8);
      _inpBuf = [];
      try { localStorage.setItem(INP_KEY, JSON.stringify(arr)); } catch (e) {}
    } catch (e) { _inpBuf = []; }
  }
  window.__diagInpFlush = inpFlush; // 诊断报告生成前同步收尾（同时供回归脚本断言）
  function inpPush(k, el) {
    try {
      if (!isDiagTextEl(el)) return;
      _inpBuf.push({
        t: Date.now(), k: k, x: diagElTag(el), n: diagTextLen(el),
        st: Math.round(el.scrollTop || 0), sh: Math.round(el.scrollHeight || 0),
        ch: Math.round(el.clientHeight || 0)
      });
      if (_inpBuf.length > 24) _inpBuf = _inpBuf.slice(_inpBuf.length - 24);
      if (!_inpFlushT) _inpFlushT = setTimeout(inpFlush, 400);
    } catch (e) {}
  }
  try {
    document.addEventListener('focusin', function (ev) { inpPush('focus', ev.target); }, true);
    document.addEventListener('compositionstart', function (ev) { inpPush('comp+', ev.target); }, true);
    document.addEventListener('compositionend', function (ev) { inpPush('comp-', ev.target); }, true);
    document.addEventListener('input', function (ev) { inpPush(ev && ev.isComposing ? 'comp' : 'input', ev.target); }, true);
    // 离开/切后台兜底落盘（缓冲未满即被冻结时不丢最后几条）
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') inpFlush(); });
    window.addEventListener('pagehide', inpFlush);
  } catch (e) {}
  function mq(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  function cssSupports(decl) {
    try {
      if (!window.CSS || !CSS.supports) return '不支持';
      return CSS.supports(decl) ? '支持' : '不支持';
    } catch (e) { return '不支持'; }
  }
  function tsStr(t) { try { return t > 0 ? new Date(t).toLocaleString() : String(t); } catch (e) { return String(t); } }
  // v3.34.x #552：版本偏离量化——原先「不一致」只说跑的是旧版，不说差多少，
  // 开发者要拿诊断文本里两个 ts 手算。补一个毫秒→人话差值（分钟/小时/天）。
  function devStr(ms) {
    if (!(ms > 0)) return '';
    var min = Math.round(ms / 60000);
    if (min < 1) return '不足 1 分钟';
    if (min < 60) return '约 ' + min + ' 分钟';
    var hr = ms / 3600000;
    if (hr < 48) return '约 ' + (Math.round(hr * 10) / 10) + ' 小时';
    return '约 ' + Math.round(hr / 24) + ' 天';
  }
  // v3.25.x：cache-bust 拉远端 version.json 与本机构建时间戳比对——GitHub Pages
  // PWA 最大类报障是「SW 缓存没更新，TA 手机跑的还是旧版」，让诊断直接给结论。
  // 与 pwa.js 轮询同口径：比 ts（构建时间戳），不比版本字符串。2s 超时兜底弱网。
  function fetchRemoteVer() {
    return new Promise(function (resolve) {
      try {
        fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
          if (!r.ok) return resolve({ ok: false });
          return r.json().then(function (j) {
            var ts = Number(j && j.ts);
            resolve({ ok: ts > 0, ts: ts > 0 ? ts : 0, info: String((j && j.info) || '') });
          }).catch(function () { resolve({ ok: false }); });
        }).catch(function () { resolve({ ok: false }); });
      } catch (e) { resolve({ ok: false }); }
      try { setTimeout(function () { resolve({ ok: false }); }, 2000); } catch (e) {}
    });
  }
  // SW 生命周期状态：waiting/installing 是「有新版没生效」的直接证据
  function swStateText() {
    return new Promise(function (resolve) {
      var out = '不支持';
      try {
        if ('serviceWorker' in navigator && navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
          navigator.serviceWorker.getRegistration().then(function (reg) {
            try {
              if (!reg) { out = '未注册'; }
              else {
                var parts = [];
                if (reg.installing) parts.push('新版本安装中');
                if (reg.waiting) parts.push('有新版待激活（关掉本页全部标签重开生效）');
                if (reg.active) parts.push(navigator.serviceWorker.controller ? '当前版已生效' : '已激活但未控制本页（刷新一次接管）');
                out = parts.join('；') || '已注册（无活动状态）';
              }
            } catch (e2) { out = '读取失败'; }
            resolve(out);
          }).catch(function () { resolve('读取失败'); });
          try { setTimeout(function () { resolve('读取超时'); }, 2000); } catch (e) {}
          return;
        }
      } catch (e) {}
      resolve(out);
    });
  }
  // v3.25.x：高熵 UA 数据——国产浏览器/桌面模式常把 UA 里的机型抹成「K」，
  // Chromium 的 getHighEntropyValues 能拿到真实机型/系统版本/完整内核列表，
  // 用于判断「是不是特定机型才有的 bug」。不支持或超时 resolve('')。
  function uaDataModel() {
    return new Promise(function (resolve) {
      try {
        navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList']).then(function (v) {
          var parts = [];
          try {
            if (v && v.model) parts.push('机型=' + v.model);
            if (v && v.platformVersion) parts.push('系统版本=' + v.platformVersion);
            if (v && Array.isArray(v.fullVersionList)) {
              var brands = [];
              v.fullVersionList.forEach(function (b) {
                if (b && b.brand && !/^not/i.test(b.brand)) brands.push(b.brand + ' ' + b.version);
              });
              if (brands.length) parts.push('内核=' + brands.join('/'));
            }
          } catch (e2) {}
          resolve(parts.join('  '));
        }).catch(function () { resolve(''); });
      } catch (e) { resolve(''); }
      try { setTimeout(function () { resolve(''); }, 2000); } catch (e) {}
    });
  }
  // v3.25.x：500ms requestAnimationFrame 计数测实际帧率（「卡顿」类报障的实测
  // 线索）；后台页 rAF 被节流/暂停 → resolve(-1)，输出时注明。
  function fpsProbe() {
    return new Promise(function (resolve) {
      var n = 0, t0 = 0, done = false;
      var fin = function (v) { if (done) return; done = true; resolve(v); };
      try {
        var tick = function (t) {
          if (!t0) t0 = t;
          n++;
          if (t - t0 >= 500) { fin(Math.round(n * 1000 / (t - t0))); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } catch (e) { fin(-1); return; }
      try { setTimeout(function () { fin(-1); }, 1200); } catch (e) {}
    });
  }
  // v3.34.x #527：模块加载体检单一实现（诊断 & tools/verify-module-load.mjs 共用）——
  // 构建期注入的 __mochiJsFiles（期望）与运行期 __mochiLoaded（每文件包内 try 末行
  // 「整段跑完」才登记）求差；返回 null＝旧产物/初始化未接入，调用方按「采集未启用」处理。
  window.mochiModuleCheck = function () {
    try {
      const exp = Array.isArray(window.__mochiJsFiles) ? window.__mochiJsFiles : null;
      const got = Array.isArray(window.__mochiLoaded) ? window.__mochiLoaded : null;
      if (!exp || !got) return null;
      const gs = {}; got.forEach(function (n) { gs[n] = 1; });
      // PERF-PLAN 阶段 1：ext 外置文件 defer 加载，弱网首访打开诊断的瞬间可能尚未执行完
      // ——extPending＝还在下载/排队的外置文件（missing 的子集），不算「整段没执行」故障。
      const extList = Array.isArray(window.__mochiExtFiles) ? window.__mochiExtFiles : [];
      return { expected: exp.slice(), loaded: got.slice(), missing: exp.filter(function (n) { return !gs[n]; }), extPending: extList.filter(function (n) { return !gs[n]; }) };
    } catch (e) { return null; }
  };
  function collectDiag() {
    // v3.16.x：整个采集为 Promise 返回。
    // v3.25.x 修复：原实现在 Promise 构造器里同步 resolve，estimate()/persisted()
    // 的异步替换永远赶不上 join——配额行恒为「读取中…」、persisted 行永不出现。
    // 现改为 jobs 收集全部异步结果，Promise.all 后再交。
    // v3.26.x：resolve 的值不再是纯文本，而是 { text, allDone, onUpdate }（见函数尾
    // 「软/硬双预算交付」）——调用方必须按 this 契约写，首屏文本可能不含慢明细。
    return new Promise(function (resolve) {
    const d = window.mochiDevice || {};
    const L = [];
    const jobs = []; // 所有异步采集（配额/persisted/远端版本/SW 状态）进这里，最后 Promise.all
    // 版本号：开屏注入（构建时 __APP_VERSION__ 替换）。不能现读 #splash-ver——
    // 进入应用后它已被 clock.js 从 DOM 移除；用 IIFE 启动时缓存的 verCache/localTsCache
    let ver = verCache || '', localTs = localTsCache || 0;
    if (!ver) { try { ver = window.APP_VERSION || ''; } catch (e) {} }
    L.push('Mochi 诊断信息（' + ver + '）');
    // v3.27.x：本行启动序号与错误条目 b 字段（id#N）对号——b 与本行不同＝旧启动残留
    L.push('时间：' + new Date().toLocaleString() + '（本次启动 ' + BOOT_ID + '#' + BOOT_N + '）');
    L.push('');
    // v3.34.x #528：结论置顶——错误/启动异常/模块未加载/入口缺失/存储/屏幕适配 ✗ 散在
    // 十几节里，用户看不出「到底坏没坏」。这里放一行聚合结论（snap 时按当前 L 重算，
    // 异步明细回填后同步刷新），正文明细保留在下方供开发者对号。
    L.push('【结论】');
    const conclBodyIdx = L.length;
    L.push('（汇总中…）');
    L.push('');
    // v3.25.x：【更新状态】放最前——「TA 手机是不是旧缓存」是远端排障第一问。
    // 注意：L 是字符串数组，job 回调里改局部变量改不了已 push 的行，必须像
    // quotaIdx 一样记下标回写 L[...]——否则这三行永远停在「获取中/读取中」。
    L.push('【更新状态】');
    const remoteIdx = L.length; L.push('远端 version.json：获取中…');
    const cmpIdx = L.length; L.push('比对结论：');
    const swIdx = L.length; L.push('SW：读取中…');
    jobs.push(fetchRemoteVer().then(function (r) {
      if (!r || !r.ok) { L[remoteIdx] = '远端 version.json：获取失败（离线或网络受限）'; L[cmpIdx] = '比对结论：无法比较'; return; }
      L[remoteIdx] = '远端 version.json：' + (r.info ? r.info + '，' : '') + 'ts=' + r.ts + '（' + tsStr(r.ts) + '）';
      if (!localTs) { L[cmpIdx] = '比对结论：无法比较（本机无构建时间戳）'; return; }
      L[cmpIdx] = '比对结论：' + (r.ts > localTs
        ? '不一致——TA 手机上跑的是旧版（落后最新版' + devStr(r.ts - localTs) + '；对方点顶部更新条刷新，或关掉全部标签页重开）'
        : (r.ts === localTs ? '一致（已是最新）' : '远端比本机还旧（差' + devStr(localTs - r.ts) + '，GitHub Pages CDN 延迟？一般可忽略）'));
    }));
    jobs.push(swStateText().then(function (t) { L[swIdx] = 'SW：' + t; }));
    L.push('');
    L.push('【设备判定】');
    L.push('手机=' + !!d.isMobile + '  平板=' + !!d.isTablet + '  iOS=' + !!d.isIOS + '  安卓=' + !!d.isAndroid + '  Via=' + !!d.isVia);
    L.push('判定依据：' + (d.mobileRule || '(未命中任何兜底规则→按桌面)') + '  手动布局设置=' + (d.layoutPref || '自动')
      + '  视口=' + Math.round(window.innerWidth || 0) + '×' + Math.round(window.innerHeight || 0));
    // v3.26.x：启动瞬间的识别信号快照（判定就是按这份下的结论）——历轮修 vivo Edge
    // 都在猜哪条指纹被「桌面版网站」模式仿真掉了，报障文本直接给出全部输入值
    const _sg = d.signals || {};
    L.push('识别信号快照：screen=' + _sg.sw + '×' + _sg.sh + '  触摸=' + _sg.touch + '  coarse=' + _sg.coarse
      + '  hoverNone=' + _sg.hoverNone + '  orientationAPI=' + _sg.oriApi
      + '  UA谎称桌面=' + _sg.uaDesk + '  UA含移动标识=' + _sg.uaMobile
      + '  visualViewport宽=' + Math.round(_sg.vvW || 0)
      + '  UA-CH(mobile=' + _sg.uchMobile + ' android=' + _sg.uchAndroid + ')');
    L.push('html 类：' + (document.documentElement.className || '(空)'));
    const vp = document.querySelector('meta[name="viewport"]');
    L.push('viewport：' + (vp ? vp.content : '(无)'));
    L.push('');
    L.push('【浏览器】');
    L.push('UA：' + ua);
    L.push('platform=' + (navigator.platform || '') + '  language=' + (navigator.language || '') + '  vendor=' + (navigator.vendor || ''));
    L.push('maxTouchPoints=' + (navigator.maxTouchPoints || 0) + '  有触摸事件=' + ('ontouchstart' in window));
    // v3.25.x：高熵 UA——UA 被抹成「K」之类时，Chromium 这里仍拿得到真实机型
    // 与内核版本（iOS 无此接口，整行不输出）
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        let uadIdx = -1;
        try { L.push('uaData：读取中…'); uadIdx = L.length - 1; } catch (e2) {}
        jobs.push(uaDataModel().then(function (s) {
          if (uadIdx >= 0) L[uadIdx] = s ? 'uaData：' + s : 'uaData：无数据';
        }));
      }
    } catch (e) {}
    L.push('');
    L.push('【视口 / 屏幕】');
    L.push('innerWidth x Height=' + window.innerWidth + ' x ' + window.innerHeight);
    L.push('screen=' + screen.width + ' x ' + screen.height + '（可用 ' + screen.availWidth + ' x ' + screen.availHeight + '） DPR=' + (window.devicePixelRatio || 1));
    let vvTxt = '不支持';
    try {
      const vv = window.visualViewport;
      if (vv) vvTxt = vv.width + ' x ' + vv.height + ' scale=' + vv.scale;
    } catch (e) {}
    L.push('visualViewport=' + vvTxt);
    L.push('orientation=' + (typeof window.orientation !== 'undefined' ? window.orientation : 'undefined'));
    L.push('matchMedia(≤900px)=' + mq('(max-width: 900px)') + '  coarse=' + mq('(pointer: coarse)') + '  hoverNone=' + mq('(hover: none)'));
    L.push('display-mode: standalone=' + mq('(display-mode: standalone)') + '  fullscreen=' + mq('(display-mode: fullscreen)'));
    L.push('iOS 主屏幕打开(standalone)=' + (navigator.standalone === true));
    // v3.26.x：视口/键盘/全屏现场（iOS 三项报障的唯一可靠证据通道）——
    // 底部空隙 = 可视区底边到 .phone 底边的差；「残留」行专门抓
    // 「页面突然上移点不动」（收缩/文档锁/基线没复原）与全屏到底走了哪条路
    try {
      const vg = (typeof window.mochiVvDiag === 'function') ? window.mochiVvDiag() : null;
      if (vg) {
        L.push('视口实测：全屏=' + vg.fsMode + '  vv高=' + vg.vvH + '  .phone高=' + vg.phoneH
          + '（顶' + vg.phoneTop + '/底' + vg.phoneBottom + '）  底部空隙=' + vg.gapBottom
          + '  --mochi-ios-h=' + vg.iosH + '  --mochi-safe-bottom=' + vg.safeBottom
          + '  vv-fit=' + vg.vvFit);
        L.push('键盘/锁残留：kbActive=' + (vg.kb ? vg.kb.kbActive : 'n/a')
          + '  推定停靠=' + (vg.kb ? vg.kb.prov : 'n/a')
          + '  基线 inner/vv=' + (vg.kb ? vg.kb.fullInner + '/' + vg.kb.fullVv : 'n/a')
          + '  文档锁=' + (vg.kb ? vg.kb.docLocked : 'n/a')
          + '  html.overflow内联=' + (vg.htmlInlineOverflow || '(空)')
          + '  body.scroll-lock=' + vg.bodyScrollLock
          + '  .phone内联高=' + (vg.phoneInlineH || '(空)') + ' align-self=' + (vg.phoneAlignSelf || '(空)')
          + '  平移 vv.offsetTop=' + vg.vvOffsetTop + ' docY=' + vg.docScrollY
          // v3.26.x #267：两个键盘分案字段。实测平移 = 本次键盘会话在被清零前量到的最大
          // vv 平移量（0 = 该内核不靠平移露焦点，只能走收缩/保底判定）；焦点框被挡 =
          // 此刻聚焦输入框是否已被视觉视口底边裁掉（1/0，-=无聚焦输入）。
          + (vg.kb && vg.kb.panSeen !== undefined ? '  本键盘会话实测平移=' + vg.kb.panSeen + '(' + vg.kb.panSeenAgo + 'ms前)' : '')
          + '  焦点框被挡=' + (vg.focusCovered === undefined || vg.focusCovered === null ? '-' : vg.focusCovered)
          + (vg.kb && vg.kb.closing !== undefined ? '  收起动画期=' + vg.kb.closing : '')
          + (vg.kb && vg.kb.vvNow !== undefined ? '  当前vv=' + vg.kb.vvNow : '')
          + (vg.kb && vg.kb.watching !== undefined ? '  轮询=' + (vg.kb.watching ? '跑' : '停') + ' 宽限剩=' + vg.kb.burstLeft + 'ms' : '')
          + (vg.kb && vg.kb.typosAgo !== undefined ? '  最近键入前=' + vg.kb.typosAgo + 'ms' : '')
          + '  聚焦元素=' + (vg.kb && vg.kb.focusTag ? vg.kb.focusTag : '(无)')
          + '  浮层开=' + (vg.lock && vg.lock.open && vg.lock.open.length ? vg.lock.open.join('|') : '无')
          + '  逃生探针=' + (function () { try { var p = window.__mochiStuckProbe && window.__mochiStuckProbe(); return p ? ('streak=' + p.streak + ' kb=' + (p.kb ? 1 : 0)) : 'n/a'; } catch (e) { return 'n/a'; } })());
      }
    } catch (e) {}
    // v3.26.x：聊天输入栏现场（红米 K60 至尊版 + Edge「打字不显示、空白」）——
    // 「框里看着空白」有三种完全不同的成因，肉眼一模一样，只有这份实测能分案：
    //   A 字没进 DOM：textLen=0（输入法/内核丢提交，或守卫提前清）
    //   B 进了 DOM 但被自身滚动推出裁剪区：textLen>0 且 scrollTop 接近 scrollHeight-clientHeight
    //   C 进了 DOM 也可见却画不出来：textLen>0、滚动正常、颜色/底色/caret 无冲突
    //     （这类＝合成层陈旧，transform 行可确认独立合成层有没有真的建立）
    try {
      let cin = document.getElementById('chat-input');
      if (cin && cin.offsetParent === null) {
        const g = document.getElementById('gc-input');
        if (g && g.offsetParent !== null) cin = g;
      }
      if (!cin) {
        L.push('聊天输入栏现场：未找到 #chat-input');
      } else {
        const cs2 = window.getComputedStyle(cin);
        const r2 = cin.getBoundingClientRect();
        const vv2 = window.visualViewport || null;
        const txt = String(cin.innerText || cin.textContent || '');
        L.push('聊天输入栏现场：元素=' + (cin.id || '?') + '.' + String(cin.className || '').trim().replace(/\s+/g, '.')
          + '  聚焦=' + (document.activeElement === cin) + '  contenteditable=' + cin.isContentEditable
          + '  文本长=' + txt.length + '  HTML长=' + String(cin.innerHTML || '').length
          + '  内部滚动=' + Math.round(cin.scrollTop) + '/' + Math.round(cin.scrollHeight) + '（可视' + Math.round(cin.clientHeight) + '）'
          + '  颜色=' + cs2.color + '  底色=' + cs2.backgroundColor + '  caret=' + cs2.caretColor
          + '  opacity=' + cs2.opacity + '  visibility=' + cs2.visibility + '  fontSize=' + cs2.fontSize
          + '  transform=' + (cs2.transform === 'none' ? '(无独立层)' : '已提升')
          + '  待清守卫=' + (cin._mClearTxt ? '有(' + String(cin._mClearTxt).length + '字)' : '无')
          + '  框top/bottom=' + Math.round(r2.top) + '/' + Math.round(r2.bottom)
          + (vv2 ? '  可视底=' + Math.round(vv2.height) + '  被键盘盖=' + (r2.bottom > vv2.height + 2 ? '是' : '否') : ''));
      }
    } catch (e) {}
    L.push('');
    L.push('【能力】');
    L.push('Fullscreen API=' + !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen));
    L.push('方向锁 API=' + !!(screen.orientation && screen.orientation.lock));
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker) {
        const swc = navigator.serviceWorker.controller;
        L.push('serviceWorker=支持' + (swc ? '（已激活，controller=' + swc.scriptURL + '）' : '（未控制本页面）'));
      } else {
        L.push('serviceWorker=不支持');
      }
    } catch (e) { L.push('serviceWorker=读取失败'); }
    L.push('storage.persist=' + !!(navigator.storage && navigator.storage.persist));
    L.push('CSS dvh=' + cssSupports('height: 1dvh') + '  svh=' + cssSupports('height: 1svh') + '  env(safe-area)=' + cssSupports('padding-top: env(safe-area-inset-top)'));
    // #690：老内核「静默丢声明」体检——inset / min() / gap(简写) 都是近年内核才有，
    // 不支持时 CSS 不报错、只是整条声明不生效（桌面壁纸层与背景遮罩层塌成 0×0、
    // 图标盒缩水、图标间距归零），用户看到的是「桌面一片灰白／排版乱」却以为功能坏了。
    // 每个降级点都有兜底，#690 之后此处应全为 ok；出现 false 说明又漏了一处兜底。
    try {
      L.push('老内核降级项：inset=' + (cssSupports('inset: 0') ? 'ok' : '不支持(已兜底)')
        + '  min()=' + (cssSupports('width: min(1px, 2vw)') ? 'ok' : '不支持(已兜底)')
        + '  gap简写=' + (cssSupports('gap: 1px') ? 'ok' : '不支持(已兜底)')
        + '  :has()=' + (cssSupports('selector(:has(a))') ? 'ok' : '不支持(未用)'));
    } catch (e) {}
    L.push('安卓输入框已转 ce-box=' + !!document.querySelector('.ce-box'));
    // #260：保活现场——「后台保活失败/收不到通知」类报障直接出证据，不再靠口述猜。
    // 心跳 = bg-keep.js 在页面隐藏期每 30s 写 IDB 的计数/时间戳轨迹：相邻拍间隔
    // >90s = 心跳断流 = 页面被冻结的实锤（保活豁免失效）；30s 连续节奏 = 后台未被冻结。
    try {
      if (typeof window.__kaProbe === 'function') {
        const kp = window.__kaProbe();
        const kpParts = ['保活=' + (kp.keep ? '开' : '关'),
          '通知=' + (kp.notify ? '开' : '关') + '/' + kp.perm];
        if (kp.audio) kpParts.push('音频=' + (kp.audio.paused ? '暂停' : '播放') + ' vol=' + kp.audio.volume);
        else kpParts.push('音频=无（保活未起）');
        if (kp.ms) kpParts.push('媒体条=' + (kp.ms.metadata ? '有' : '无') + ' ' + kp.ms.state);
        kpParts.push('WebRTC=' + kp.pc);
        // #780：WebRTC 停在 new 时把采集状态一起打出——本次真机取证就是「WebRTC=new」
        // 却看不出卡在 SDP 还是 ICE（实为候选 flush 早于 gather 完成，第二豁免恒死）。
        if (kp.pc && kp.pc !== 'connected' && kp.pc !== 'off' && kp.pcGathering) {
          kpParts.push('ICE采集=' + kp.pcGathering + '/候选' + (typeof kp.pcCand === 'number' ? kp.pcCand : '?') + '条');
        }
        // #780：在场信号自相矛盾取证——保活让位判据只看 __musicPlaying 标志，而音乐
        // 「暂停但想播」时刻意保持 playbackState='playing'；标志与元素真值背离时保活
        // 音频被误让位、主豁免当场丢失（＝后台整页冻结、消息与通知全停）。
        if (kp.music && kp.music.flag && kp.music.paused === true) {
          kpParts.push('在场信号矛盾：音乐标志说在播·元素实为暂停（保活音频被误让位，主豁免已丢）');
        }
        // #724：取证计数（bg-keep 持久化）——断流=隐藏期定时器停摆过（冻结/丢弃实锤）、
        // 后台终止=上个会话没能活着回来（标签被系统丢弃/杀掉，回来自动重载）
        if (kp.ev && (kp.ev.stall > 0 || kp.ev.died > 0)) {
          kpParts.push('历史取证：断流' + kp.ev.stall + '次/后台终止' + kp.ev.died + '次（>0＝保活曾被冻结或页面曾被系统回收）');
          // #960：终止次数高＝iOS 内存压力反复回收本页（回前台白一下/重新加载的实锤），
          // 数字升级成可行动建议——三条都不是「坏了」，是数据量/保活/标签多叠加出来的
          if (kp.ev.died >= 5) {
            kpParts.push('⚠ 本页被系统回收过 ' + kp.ev.died + ' 次（内存压力）：建议①不用时关掉后台保活（更省内存）②按 设置→查看存储 清掉最占地方的一项 ③别同开太多标签页/网页应用');
          }
        }
        if (kp.hb) {
          const tr = kp.hb.trail || [];
          let gap = 0;
          for (let i = 1; i < tr.length; i++) gap = Math.max(gap, tr[i] - tr[i - 1]);
          if (kp.hb.resumed) gap = Math.max(gap, kp.hb.resumed - kp.hb.ts);
          kpParts.push('心跳=' + kp.hb.n + '拍/最后' + Math.round((Date.now() - kp.hb.ts) / 1000) + 's前');
          if (gap > 90000) kpParts.push('冻结证据：心跳断流' + Math.round(gap / 1000) + 's（保活豁免失效，页面曾被冻结）');
          else if (kp.hb.n >= 2) kpParts.push('后台心跳连续=未被冻结');
        } else {
          kpParts.push('心跳=本会话未切过后台（无记录）');
        }
        L.push('【保活现场】' + kpParts.join(' · '));
      }
    } catch (e) {}
    L.push('');
    // v3.25.x：【性能】——「卡顿」类报障的实测线索。帧率是打开诊断那一刻的
    // 现场采样（静态设置页满帧 ≠ 无卡顿，但静态页都掉帧说明系统性问题）；
    // 高刷屏（90/120Hz）读数 >60 属正常。JS 堆仅 Chrome 系提供，iOS 无。
    let fpsIdx = -1;
    L.push('【性能】');
    try { L.push('实测帧率：采样中…'); fpsIdx = L.length - 1; } catch (e) {}
    jobs.push(fpsProbe().then(function (fps) {
      if (fpsIdx < 0) return;
      // #884：实测落在 ≈30fps 档（15~40 且 >0）＝八成是 iOS 低电量 / 安卓省电模式把整机
      // 帧率锁半（系统行为，非应用卡），点名提示关闭复测——多台 iPhone「怎么用都卡」实报都查到是它。
      const lpHint = (fps > 0 && fps >= 15 && fps <= 40) ? '；≈30fps 档＝八成开了低电量/省电模式（系统锁半帧率），关掉再测' : '';
      L[fpsIdx] = fps > 0 ? '实测帧率≈' + fps + ' fps（500ms 现场采样，高刷屏>60 正常' + lpHint + '）' : '实测帧率：rAF 未触发（页面在后台被节流）';
    }));
    // #690：桌面翻页帧耗时（用户上一次翻页时由 desktop-slider.js 现场采样）。
    // 上面那行「实测帧率」是打开诊断这一刻**静态页**的读数，翻页卡顿在它上面看不出来
    // ——用户报「滑三页灰屏/卡顿/手机发烫」时，这行才是能判定的证据：
    // 平均帧间隔 >33ms＝掉帧、>100ms＝明显卡（且与页数成正比＝图层栅格化吃满）。
    try {
      const dp = JSON.parse(localStorage.getItem('xy-home-v2:__diag-deskperf') || 'null');
      if (dp && dp.n) {
        const when = dp.t ? new Date(dp.t).toLocaleString() : '?';
        L.push('桌面翻页帧耗时（' + dp.n + ' 帧现场采样 · ' + when + ' · ' + (dp.pages || '?') + ' 页）：'
          + '平均 ' + dp.mean + 'ms / p90 ' + dp.p90 + 'ms / 最慢 ' + dp.worst + 'ms'
          // #707：采样已剔除切后台/锁屏冻结帧（否则一条 144s 的后台间隙会把均值拉成假「严重卡顿」）
          + (dp.hid ? '（已剔除后台帧 ' + dp.hid + '）' : '')
          + (dp.mean > 100 ? '（严重卡顿）' : dp.mean > 33 ? '（掉帧）' : '（流畅）'));
      } else {
        L.push('桌面翻页帧耗时：尚无记录（去桌面左右滑一次再回来即可采到）');
      }
    } catch (e) {}
    // #884：切回桌面帧耗时（从聊天/其他页返回手机桌面那一刻，由 desktop-slider.js 在
    // page-phone 取消隐藏时现场采 30 帧）——用户主诉「聊天返回主页面卡、主页面切换卡」，
    // 静态帧率看不出切页现场；这行与上面的翻页采样合起来才能把「切页类卡顿」定责。
    try {
      const sp = JSON.parse(localStorage.getItem('xy-home-v2:__diag-swperf') || 'null');
      if (sp && sp.n) {
        const when = sp.t ? new Date(sp.t).toLocaleString() : '?';
        L.push('切回桌面帧耗时（' + sp.n + ' 帧现场采样 · ' + when + '）：'
          + '平均 ' + sp.mean + 'ms / p90 ' + sp.p90 + 'ms / 最慢 ' + sp.worst + 'ms'
          + (sp.hid ? '（已剔除后台帧 ' + sp.hid + '）' : '')
          + (sp.mean > 100 ? '（严重卡顿）' : sp.mean > 33 ? '（掉帧）' : '（流畅）'));
      } else {
        L.push('切回桌面帧耗时：尚无记录（从聊天页点返回到桌面一次即可采到）');
      }
    } catch (e) {}
    let memTxt = '不支持（仅 Chrome 系）';
    try {
      const pm = performance.memory;
      if (pm && pm.usedJSHeapSize) memTxt = 'JS堆 ' + (pm.usedJSHeapSize / 1048576).toFixed(1) + ' MB / 上限 ' + Math.round(pm.jsHeapSizeLimit / 1048576) + ' MB';
    } catch (e) {}
    L.push('JS 内存：' + memTxt);
    // v3.25.x：启动耗时 + 电量——「打开转圈久」与「低电量降频伪装成卡顿」的线索
    try {
      const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
      if (nav && nav.domContentLoadedEventEnd > 0) {
        L.push('启动：首字节 ' + Math.round(nav.responseStart) + 'ms → DOM就绪 ' + Math.round(nav.domContentLoadedEventEnd) + 'ms → 加载完成 ' + (nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) + 'ms' : '未完成'));
      }
    } catch (e) {}
    try {
      const lts = JSON.parse(localStorage.getItem(LT_KEY) || '[]');
      if (Array.isArray(lts) && lts.length) {
        L.push('长任务>50ms（掉帧元凶）最近 ' + lts.length + ' 条（旧→新）：');
        lts.forEach(function (it) {
          const dt = it.t ? new Date(it.t).toLocaleTimeString() : '?';
          L.push('· ' + dt + ' 阻塞 ' + (it.d || '?') + 'ms');
        });
      } else {
        L.push('长任务>50ms：无' + (ltSupported ? '' : '（内核不支持观测）'));
      }
    } catch (e) {}
    try {
      // v3.27.x：getBattery 已废弃（较新 Chrome 移除、Safari 一直不支持）——
      // 不支持时显式输出一行，不再静默消失；仍在时正常采集并带 2s 超时兜底
      if (navigator.getBattery) {
        let batIdx = -1;
        try { L.push('电量：读取中…'); batIdx = L.length - 1; } catch (e2) {}
        jobs.push(new Promise(function (res) {
          let settled = false;
          const fin = function () { if (settled) return; settled = true; res(); };
          navigator.getBattery().then(function (b) {
            if (batIdx >= 0) L[batIdx] = '电量=' + Math.round(b.level * 100) + '%' + (b.charging ? '（充电中）' : (b.level <= 0.2 ? '（低电量，省电降频可能伪装成卡顿）' : ''));
            fin();
          }).catch(function () {
            if (batIdx >= 0) L[batIdx] = '电量：读取失败';
            fin();
          });
          try { setTimeout(fin, 2000); } catch (e) {}
        }));
      } else {
        L.push('电量：不支持（该浏览器无 getBattery 接口）');
      }
    } catch (e) { try { L.push('电量：读取失败'); } catch (e2) {} }
    L.push('');
    // #961 内存体检——iOS 不提供 JS 堆读数（本段上方「JS 内存：不支持」即此），
    // 「本页被系统回收 N 次」只能靠「谁在内存里占位」推断。本段把可测的占位项列清：
    // DOM 节点、img 元素（data:/blob:/坏图）、内存里的聊天条数、内存驻留键与近似体积。
    try {
      const nodes = document.getElementsByTagName('*').length;
      let imgs = 0, dataImgs = 0, blobImgs = 0, brokenImgs = 0;
      try {
        const list = document.images || [];
        imgs = list.length;
        for (let i = 0; i < list.length; i++) {
          const src = list[i].currentSrc || list[i].src || '';
          if (src.indexOf('data:') === 0) dataImgs++;
          else if (src.indexOf('blob:') === 0) blobImgs++;
          if (list[i].complete && list[i].naturalWidth === 0) brokenImgs++;
        }
      } catch (e) {}
      let chatN = 0;
      try { if (typeof window.getChatMsgs === 'function') chatN = (window.getChatMsgs() || []).length; } catch (e) {}
      L.push('【内存体检】DOM 节点=' + nodes + ' · img 元素=' + imgs + '（data: ' + dataImgs + ' / blob: ' + blobImgs + (brokenImgs ? ' / 坏图 ' + brokenImgs : '') + '）' + (chatN ? ' · 内存聊天条数=' + chatN : ''));
      const memo = (typeof window.idbMemoStats === 'function') ? window.idbMemoStats(6) : null;
      if (memo && memo.n) {
        L.push('· 内存驻留键 ' + memo.n + ' 个 ≈' + Math.round(memo.bytes / 1024) + 'KB（字符串按长度、数组按写入时估算；iOS 无堆读数，这是近似账）');
        if (memo.top && memo.top.length) L.push('· 驻留最大：' + memo.top.map(function (e) { return e.k.replace('xy-home-v2:', '') + ' ' + (e.len > 0 ? Math.round(e.len / 1024) + 'KB' : '体量未知'); }).join('、'));
      } else {
        L.push('· 内存驻留键：采样未启用（idbMemoStats 缺席）');
      }
      L.push('· 判读：内存三巨头＝img 位图解码（一张 720px 图解码约 1.5MB）、常驻结构（聊天数组/表情包数组/字卡池）、DOM 节点；回收次数见【保活现场】');
    } catch (e) {}
    L.push('【数据】');
    const G = 'xy-home-v2:';
    const usageStr = function (u) {
      if (u == null) return '(未知)';
      if (u >= 1048576) return (u / 1048576).toFixed(1) + ' MB';
      if (u >= 1024) return (u / 1024).toFixed(1) + ' KB';
      return u + ' B';
    };
    // v3.25.x：键明细——数据丢失类报障（键被清/写入失败/快照剥离）一眼定位：
    // 哪些键还在、各占多大。UTF-16 双字节估算，看量级够用。
    // v3.26.x #88：同一次遍历顺带统计【整个 origin】的 LS 占用（含非本项目键）。
    // 关键判据：GitHub Pages 同账号下所有项目共用一个 origin 的 localStorage 配额
    //（约 5MB，路径不隔离）。小米 14U Edge 实测「本项目 0 键 + 写探针 QuotaExceededError」
    // 只有三种可能：本项目撑爆 / 同域其他站点占满 / LS 库损坏——必须看到整域数据才能定性。
    try {
      let total = 0, n = 0;
      let allTotal = 0, allN = 0;
      const items = [];
      const otherItems = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k2 = localStorage.key(i);
        if (!k2) continue;
        allN++;
        const sz2 = (k2.length + String(localStorage.getItem(k2) || '').length) * 2;
        allTotal += sz2;
        if (k2.indexOf(G) !== 0) {
          otherItems.push({ k: k2.slice(0, 40), size: sz2 });
          continue;
        }
        n++;
        total += sz2;
        items.push({ k: k2.slice(G.length), size: sz2 });
      }
      L.push('localStorage 数据键=' + n + ' 个');
      L.push('localStorage 整域=' + allN + ' 键 ≈' + usageStr(allTotal) +
        '（非本项目 ' + otherItems.length + ' 键 ≈' + usageStr(allTotal - total) + '）');
      otherItems.sort(function (a, b) { return b.size - a.size; });
      const oth = otherItems.slice(0, 5).map(function (it) { return it.k + '=' + usageStr(it.size); }).join('、');
      if (oth) L.push('非本项目最大键：' + oth);
      // 写探针（与下方「开关持久化体检」同款）：单独成行给结论，报障时不必再人肉推断
      try {
        localStorage.setItem(G + '__ls-probe', 'p');
        const back = localStorage.getItem(G + '__ls-probe');
        localStorage.removeItem(G + '__ls-probe');
        L.push('localStorage 状态：' + (back === 'p' ? '正常（可写可读回）' : '异常：写入后读不回（落盘被拦）'));
      } catch (e) {
        L.push('localStorage 状态：写入失败(' + ((e && e.name) || '异常') + ')——配额满或库已损坏，设置/桌面需靠 IndexedDB 校正');
      }
      items.sort(function (a, b) { return b.size - a.size; });
      L.push('数据总占用≈' + usageStr(total));
      const tops = items.slice(0, 8).map(function (it) { return it.k + '=' + usageStr(it.size); }).join('、');
      if (tops) L.push('最大键：' + tops);
    } catch (e) { L.push('localStorage 不可访问'); }
    // v3.26.x：跨域名（device.js=AI-B）——回复字卡池诊断，报障「联系人只发【收到～】」直接定位
    try { if (window.__replyPoolDiag) L.push('回复字卡池：' + window.__replyPoolDiag()); } catch (e2) {}
    // v3.26.x：跨域名（device.js=AI-B）——字卡/回复/收藏 存储明细诊断（chatcard.js 挂 __ccStorageDiag）
    // 报障「该分类 583MB 是否正常」一眼定位大键/LS 残留双倍/旧各桌面 my-emoji-groups 遗留
    try {
      if (window.__ccStorageDiag) {
        const ccIdx = L.length; L.push('字卡/回复/收藏明细：读取中…');
        jobs.push(window.__ccStorageDiag().then(function (s) { L[ccIdx] = s; }).catch(function () { L[ccIdx] = '字卡/回复/收藏明细：读取失败'; }));
      }
    } catch (e3) {}
    // v3.26.x：IndexedDB 大键明细——「存储配额已用 1.x GB」类报障一眼定位哪类数据在占空间：
    // 聊天图片（chat-msgs）/ 本地音乐（music-file）/ 头像库（avatar-lib）/ 备份快照
    // （__auto-backup-snapshot：手动导出时把全部数据复制一份进 IDB，是最常见的"数据翻倍"
    // 来源）/ 跨桌面副本（各联系人命名空间下的 music-file、avatar-lib、chat-msgs）。
    // 安全策略：只读候选大键（跳过几百个设置小键）；Blob/ArrayBuffer 只取 .size/.byteLength
    // 元数据不读数据；字符串逐键读后立即弃用，峰值内存=最大单键；单键读失败/超时跳过不阻塞。
    try {
      const idbIdx = L.length; L.push('IndexedDB 大键明细：读取中…');
      jobs.push(new Promise(function (res) {
        if (!window.idbListKeys && !window.idbGetAllKeys) { L[idbIdx] = 'IndexedDB 大键明细：接口不可用'; res(); return; }
        (window.idbListKeys ? window.idbListKeys() : window.idbGetAllKeys()).then(function (keys) {
          // v3.26.x #90：null=清单没读到（挂起/超时），不再和「库里没大键」混成一谈
          if (!keys) { L[idbIdx] = 'IndexedDB 大键明细：清单读取失败（存储繁忙/超时）'; res(); return; }
          const cand = (keys || []).filter(function (k) {
            k = String(k || '');
            if (k.indexOf('xy-home-v2:') !== 0) return false;
            if (k.indexOf('music-file:') >= 0) return true;
            if (/:chat-msgs$/.test(k)) return true;
            if (/avatar-(lib|me-lib)$/.test(k)) return true;
            if (/:(phone-bg|wallpaper|chat-bg|page-bg|desk-bg|bg)$/.test(k)) return true;
            if (k.indexOf('__auto-backup-snapshot') >= 0) return true;
            return false;
          });
          if (!cand.length) { L[idbIdx] = 'IndexedDB 大键明细：无大键候选'; res(); return; }
          // v3.26.x：改 idbGetMany 单事务并行（自带 4s+4s 超时）——原逐键串行 idbGet
          // 每个最坏 8s，几十个候选最坏几百秒，用户复制诊断时常常停在"读取中…"。
          // 并行后整体最多 8s 完成；超时返回已收集的部分（未返回键 size=-1 跳过）。
          const out = [];
          const finalize = function () {
            try {
              const real = out.filter(function (it) { return it.size >= 0; });
              real.sort(function (a, b) { return b.size - a.size; });
              const total = real.reduce(function (s, it) { return s + it.size; }, 0);
              const lines = ['IndexedDB 大键明细：' + cand.length + ' 个候选，合计≈' + usageStr(total) + '（设置小键未计）'];
              real.slice(0, 10).forEach(function (it) {
                lines.push('· ' + String(it.k).slice('xy-home-v2:'.length) + '=' + (it.size >= 0 ? usageStr(it.size) : '?'));
              });
              // FIX 2026-09-13 #423：媒体池条目数——旧候选清单不含 media: 键，「图片丢失」报障
              // 无法从诊断判断池是否存在；核对/重建入口在 设置→查看存储→媒体池
              try {
                let poolN = 0;
                (keys || []).forEach(function (k) { if (/^xy-home-v2:media:[0-9a-f]{32}$/.test(String(k))) poolN++; });
                lines.push('· 媒体池条目：' + poolN + ' 条（图片丢失时先到 设置→查看存储→媒体池 核对/重建）');
              } catch (e9) {}
              L[idbIdx] = lines.join('\n');
            } catch (e) { L[idbIdx] = 'IndexedDB 大键明细：统计失败'; }
            res();
          };
          const sizeOf = function (v) {
            let sz = -1;
            try {
              if (v instanceof Blob) sz = v.size;
              else if (v instanceof ArrayBuffer) sz = v.byteLength;
              else if (typeof v === 'string') sz = v.length * 2;
              // v3.26.x OOM：聊天记录已改 IDB 直存数组——数组不再整包 JSON.stringify 量大小
              //（诊断页打开时对 150MB 级数组做 stringify 本身就是一次秒级长任务），改浅层估算
              else if (Array.isArray(v)) {
                let n = 0;
                for (let i = 0; i < v.length; i++) {
                  const m = v[i];
                  if (typeof m === 'string') { n += m.length; continue; }
                  if (!m || typeof m !== 'object') { n += 32; continue; }
                  const t = m.text; if (typeof t === 'string') n += t.length;
                  const im = m.img; if (typeof im === 'string') n += im.length;
                  const vc = m.voice; if (typeof vc === 'string') n += vc.length;
                  const ps = m.parts;
                  if (Array.isArray(ps)) { for (let j = 0; j < ps.length; j++) { const p = ps[j]; if (p && typeof p.v === 'string') n += p.v.length; } }
                  n += 64;
                }
                sz = n * 2;
              }
              else if (v !== undefined && v !== null) sz = JSON.stringify(v).length * 2;
            } catch (e) { sz = -1; }
            return sz;
          };
          if (!window.idbGetMany) {
            cand.forEach(function (k) { out.push({ k: k, size: -1 }); });
            finalize(); return;
          }
          window.idbGetMany(cand).then(function (map) {
            cand.forEach(function (k) { out.push({ k: k, size: sizeOf(map[k]) }); });
            finalize();
          }).catch(function () {
            cand.forEach(function (k) { out.push({ k: k, size: -1 }); });
            finalize();
          });
        }).catch(function () { L[idbIdx] = 'IndexedDB 大键明细：读取失败'; res(); });
      }));
    } catch (e) { try { L.push('IndexedDB 大键明细：读取失败'); } catch (e2) {} }
    // v3.26.x：开关持久化体检——荣耀 200 Pro Edge 报「系统预设字卡朋友圈/写信使用、
    // 我方发语音」关掉后退出浏览器重进变回去（Via/雨见正常）。把涉事键的
    // localStorage 原始值 / 读取接口值（内存优先）/ IndexedDB 权威值三层并列，
    // 配合 LS 写探针，一次诊断即可判断是「LS 写失败」「LS 落盘被回滚」还是「IDB 读取挂起」。
    try {
      const swIdx = L.length; L.push('开关持久化体检：读取中…');
      jobs.push(new Promise(function (res) {
        const cid = String(window.__activeCid || 'default');
        const P = G + cid + ':';
        // #234：xyStore 的前缀参数不带尾冒号（内部自拼':'，正确形态见 contacts.js
        // xyStore(GNS + ':' + cid) 家族）——本文件 G 本身已带尾冒号（'xy-home-v2:'），
        // 此前先写 G+':'+cid 再传 G+cid+':' 都拼出 xy-home-v2::<cid>::cs-xxx 双冒号键，
        // 「读取」列恒为缺失，误导持久化体检判读（小米17Pro/vivo/荣耀多机型诊断同现，
        // 装置性错误与机型无关）。正确拼法 = G + cid。
        const SP = G + cid;
        const fmt = function (v) { return v === null || v === undefined ? '缺失' : JSON.stringify(String(v)); };
        const KEYS = ['dc-enabled', 'dc-use-chat', 'dc-use-mail', 'dc-use-feed', 'dc-cat-main', 'cs-voice-send'];
        // FIX 2026-09-13 #404（米15夸克报障）：cardlock-state 是全局根键（无 per-cid 段），
        //   per-cid 探针会读成 xy-home-v2:<cid>:cardlock-state 恒缺失，二级密码解锁丢失类
        //   报障无法判读。单独走根键探针（LS/读取/IDB 三层同款）。
        const ROOT_KEYS = ['cardlock-state'];
        const lines = ['开关持久化体检（当前桌面 ' + cid + '；\'1\'=开 \'0\'=关 缺失=默认值）：'];
        let probe = 'LS 写探针：正常';
        try {
          localStorage.setItem(G + '__ls-probe', 'p');
          if (localStorage.getItem(G + '__ls-probe') !== 'p') probe = 'LS 写探针：写入后读回不一致（异常！）';
          localStorage.removeItem(G + '__ls-probe');
        } catch (e3) { probe = 'LS 写探针：写入失败(' + ((e3 && e3.name) || '异常') + ')——配额满或存储被禁'; }
        lines.push(probe);
        let pend = KEYS.length + ROOT_KEYS.length;
        const done = function () { L[swIdx] = lines.join('\n'); res(); };
        const one = function (short) {
          let lsV = null, memV = null;
          try { lsV = localStorage.getItem(P + short); } catch (e3) { lsV = '(读失败)'; }
          try { memV = window.xyStore(SP).get(short); } catch (e3) { memV = '(读失败)'; }
          const li = lines.length;
          lines.push('· ' + short + '：LS=' + fmt(lsV) + ' 读取=' + fmt(memV) + ' IDB=…');
          if (!window.idbGet) { lines[li] = lines[li].replace('IDB=…', 'IDB=(接口不可用)'); if (--pend <= 0) done(); return; }
          window.idbGet(P + short).then(function (iv) {
            lines[li] = lines[li].replace('IDB=…', 'IDB=' + (iv === undefined ? '(未写入·走默认)' : fmt(iv)));
            if (--pend <= 0) done();
          }).catch(function () { lines[li] = lines[li].replace('IDB=…', 'IDB=(读失败)'); if (--pend <= 0) done(); });
        };
        // #404：全局根键探针（前缀不带 cid 段；xyStore 前缀参数不带尾冒号）
        const oneRoot = function (short) {
          let lsV = null, memV = null;
          try { lsV = localStorage.getItem(G + short); } catch (e3) { lsV = '(读失败)'; }
          try { memV = window.xyStore(G.slice(0, -1)).get(short); } catch (e3) { memV = '(读失败)'; }
          const li = lines.length;
          lines.push('· ' + short + '（全局根键）：LS=' + fmt(lsV) + ' 读取=' + fmt(memV) + ' IDB=…');
          if (!window.idbGet) { lines[li] = lines[li].replace('IDB=…', 'IDB=(接口不可用)'); if (--pend <= 0) done(); return; }
          window.idbGet(G + short).then(function (iv) {
            lines[li] = lines[li].replace('IDB=…', 'IDB=' + (iv === undefined ? '(未写入·走默认)' : fmt(iv)));
            if (--pend <= 0) done();
          }).catch(function () { lines[li] = lines[li].replace('IDB=…', 'IDB=(读失败)'); if (--pend <= 0) done(); });
        };
        KEYS.forEach(one);
        ROOT_KEYS.forEach(oneRoot);
        if (!pend) done();
      }));
    } catch (e) { try { L.push('开关持久化体检：读取失败'); } catch (e2) {} }
    // v3.26.x #90：桌面归属体检——报「聊天记录几小时自己消失」的第一分叉：
    // 记录是被覆盖没了，还是冷启动掉回 default 桌面（历史其实还在别的命名空间）。
    // 三层并列 active-contact（xyStore 读取值 / 裸 LS 值 / IDB 权威值）+ 各桌面条数账本
    // （chat-meta 小键）+ LS 里残留的 chat-msgs 快照键名。
    // 全程只读小键：遍历 localStorage 仅用 key(i) 取键名，不取值也不 parse 任何大键。
    try {
      const dkIdx = L.length; L.push('桌面归属体检：读取中…');
      jobs.push(new Promise(function (res) {
        const fmtv = function (v) { return (v === null || v === undefined) ? '缺失' : JSON.stringify(String(v)); };
        const lines = ['桌面归属体检（当前桌面 ' + String(window.__activeCid || 'default') + '）：'];
        let acMem = null, acLs = null;
        try { if (window.xyStore) acMem = window.xyStore('xy-home-v2').get('active-contact'); } catch (e) {}
        try { acLs = localStorage.getItem(G + 'active-contact'); } catch (e) {}
        const lsChat = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(G) === 0 && /:chat-msgs$/.test(k)) lsChat.push(k.slice(G.length));
          }
        } catch (e) {}
        lines.push('· active-contact：读取=' + fmtv(acMem) + ' 裸LS=' + fmtv(acLs) + ' IDB=…');
        lines.push('· LS 内 chat-msgs 快照：' + (lsChat.length ? lsChat.join('、') : '无（LS 整库失效或记录只在数据库）'));
        lines.push('· 条数账本(chat-meta)：读取中…');
        let finished = false;
        let fuse = null;
        const finish = function () {
          if (finished) return; finished = true;
          if (fuse) clearTimeout(fuse);
          try { L[dkIdx] = lines.join('\n'); } catch (e) {}
          res();
        };
        fuse = setTimeout(finish, 9000);
        if (!window.idbGet) {
          lines[1] = lines[1].replace('IDB=…', 'IDB=(接口不可用)');
          lines[3] = '· 条数账本(chat-meta)：接口不可用';
          finish(); return;
        }
        window.idbGet(G + 'active-contact').then(function (iv) {
          lines[1] = lines[1].replace('IDB=…', 'IDB=' + (iv === undefined || iv === null ? '(库里没有)' : fmtv(iv)));
          if (!window.idbListKeys) { lines[3] = '· 条数账本(chat-meta)：清单接口不可用'; finish(); return; }
          window.idbListKeys().then(function (keys) {
            if (!keys) { lines[3] = '· 条数账本(chat-meta)：清单读取失败'; finish(); return; }
            const mk = keys.filter(function (k) { return /:chat-meta$/.test(k); });
            if (!mk.length) { lines[3] = '· 条数账本(chat-meta)：无（本版本尚未记录）'; finish(); return; }
            const load = window.idbGetMany
              ? window.idbGetMany(mk)
              : Promise.all(mk.map(function (k) { return window.idbGet(k); })).then(function (vs) {
                  const m = {}; mk.forEach(function (k, i) { m[k] = vs[i]; }); return m;
                });
            return load.then(function (map) {
              const rows = [];
              mk.forEach(function (k) {
                let n = -1;
                try { const o = typeof map[k] === 'string' ? JSON.parse(map[k]) : map[k]; if (o && typeof o.n === 'number') n = o.n; } catch (e) {}
                if (n >= 0) rows.push({ d: k.slice(G.length).replace(/:chat-meta$/, ''), n: n });
              });
              rows.sort(function (a, b) { return b.n - a.n; });
              const cur = String(window.__activeCid || 'default');
              lines[3] = '· 条数账本(chat-meta)：' + (rows.length
                ? rows.slice(0, 6).map(function (r) { return (r.d === cur ? '【当前】' : '') + r.d + '=' + r.n + '条'; }).join(' ')
                : '解析失败');
              finish();
            });
          }).catch(function () { lines[3] = '· 条数账本(chat-meta)：读取失败'; finish(); });
        }).catch(function () {
          lines[1] = lines[1].replace('IDB=…', 'IDB=(读失败)');
          finish();
        });
      }));
    } catch (e) { try { L.push('桌面归属体检：读取失败'); } catch (e2) {} }
    // FIX 2026-09-18 #776 重复体检：报障「一条变多条」时，光看条数说不出**还剩哪种重复**，每轮都要
    // 重新猜通道。这一行直接写现场：还有几份「同身份多出来的副本」，其中多少正文一致（现有判据
    // 该收掉）、多少只有出生号认得出、多少是升级前写的无号存量脏数据，同毫秒批量另算不算重复。
    // 探针缺失＝chat.js 整体没跑起来。
    try {
      const dc = window.__mochiDupCensus && window.__mochiDupCensus();
      if (!dc) L.push('重复体检(聊天)：探针缺失（chat.js 未加载）');
      else if (dc.err) L.push('重复体检(聊天)：读取失败 ' + dc.err);
      else if (dc.sus) L.push('重复体检(聊天)：⚠ 可疑副本 ' + dc.sus + ' 份（身份同 ' + dc.extra
        + ' 份／其中同毫秒批量 ' + dc.batch + ' 份不算）＝正文一致 ' + dc.same + '／出生号认得出 ' + dc.uidc
        + '／无号可认(存量) ' + dc.drift + ' · 带出生号 ' + dc.uid + '/' + dc.total
        + (dc.top ? ' · 多见：' + dc.top : '')
        + (dc.eg && dc.eg.length ? ' · 现场：' + dc.eg.join(' ∥ ') : ''));
      else L.push('重复体检(聊天)：无身份级重复（共 ' + dc.total + ' 条，带出生号 ' + dc.uid + '）');
    } catch (e) { try { L.push('重复体检(聊天)：读取失败'); } catch (e2) {} }
    // FIX 2026-09-19 #814 消息被吞体检（跨域改动登记 WORKLOG；探针在 chat.js #814d）：
    // 「消息莫名被吞」报障的反向取证——本会话每一条被防重层切掉的消息都留了笔（g814out＝发件侧
    // 800ms 短闩、g814ts＝刷新归一化同 ts 收敛，另含 #744/#776/#796 在 __mochiDupAdd 的旧账）。
    // 正常形态＝零星几笔（真双击/真副本）；某 tag 几十上百＝对应闸门在误杀合法消息或某通道狂重投，
    // 凭 tag 与最近样本直接定位到闸，不再隔空猜。
    try {
      const cut = [];
      (window.__mochiMsgCut || []).forEach(s => { s = String(s); const m = /^[0-9]+:([a-zA-Z0-9_]+):/.exec(s); cut.push({ tag: m ? m[1] : 'other', s }); });
      (window.__mochiDupAdd || []).forEach(s => { s = String(s); const m = /^(lk|id):/.exec(s); cut.push({ tag: m ? m[1] : 'obj', s }); });
      cut.sort((a, b) => a.s < b.s ? -1 : 1);
      const tally = {};
      cut.forEach(c => { tally[c.tag] = (tally[c.tag] || 0) + 1; });
      const tk = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
      L.push('消息被吞体检：本会话防重层共切 ' + cut.length + ' 笔'
        + (tk.length ? '（' + tk.map(k => k + '×' + tally[k]).join('／') + '，最近：' + cut[cut.length - 1].s.slice(-42) + '）' : '（无）'));
    } catch (e) { try { L.push('消息被吞体检：读取失败'); } catch (e2) {} }
    // v3.26.x #264：跨桌面来消息体检——「查岗/来电开了好几天一次都没触发」的第一手现场：
    // 定时器活着吗、被什么闸门挡住、各联系人还要等多久、有没有从未应答的 pending 卡住队列。
    // 探针缺失＝incoming-requests.js 整体没跑起来（另一种根因），所以这一行本身就有诊断价值。
    try {
      const ip = window.__mochiIncomingProbe && window.__mochiIncomingProbe();
      if (!ip) L.push('跨桌面来消息体检：探针缺失（incoming-requests 未加载）');
      else {
        L.push('跨桌面来消息体检：轮询 ' + ip.ticks + ' 次 闸门=' + ip.gate + ' 前台=' + (ip.hidden ? '否' : '是') +
          ' 档位=' + ip.mode + '(' + ip.prob + '%/' + ip.cool + 'min) pending=' + ip.pending + ' 活弹窗=' + ip.live);
        L.push('· 下次可掷：' + ((ip.next || []).join(' / ') || '无其他桌面'));
        if ((ip.releases || []).length) L.push('· 近期释放：' + ip.releases.join('；'));
      }
    } catch (e) { try { L.push('跨桌面来消息体检：读取失败'); } catch (e2) {} }
    // v3.16.x：存储配额/持久化/在线状态——「数据写不进去/丢失」类报障的关键字段：
    // 配额满写失败曾是本项目真实根因（localStorage setItem 静默失败）。
    // v3.25.x：改用 jobs + 占位行下标替换（原 L.indexOf 找占位串有误配风险，
    // 且 resolve 时机问题见函数头注释）。
    let quotaIdx = -1, persistedIdx = -1;
    try { L.push('存储配额：读取中…'); quotaIdx = L.length - 1; } catch (e) {}
    try { L.push('navigator.onLine=' + navigator.onLine); } catch (e) {}
    try {
      const est = navigator.storage && navigator.storage.estimate;
      if (est) {
        jobs.push(est.call(navigator.storage).then(function (r) {
          const s = r || {};
          if (quotaIdx >= 0) L[quotaIdx] = '存储配额：已用 ' + usageStr(s.usage) + ' / ' + usageStr(s.quota);
        }).catch(function () {
          if (quotaIdx >= 0) L[quotaIdx] = '存储配额：读取失败';
        }));
      } else if (quotaIdx >= 0) {
        L[quotaIdx] = '存储配额：接口不可用';
      }
    } catch (e) { if (quotaIdx >= 0) L[quotaIdx] = '存储配额：读取失败'; }
    try {
      const per = navigator.storage && navigator.storage.persisted;
      if (per) {
        try { L.push('storage.persisted=读取中…'); persistedIdx = L.length - 1; } catch (e2) {}
        jobs.push(per.call(navigator.storage).then(function (p) {
          if (persistedIdx >= 0) L[persistedIdx] = 'storage.persisted=' + p;
        }).catch(function () {
          if (persistedIdx >= 0) L[persistedIdx] = 'storage.persisted=读取失败';
        }));
      }
    } catch (e) {}
    // v3.16.x：最近错误（onerror/unhandledrejection/console.error 自动采集）
    // v3.26.x：错误记录双写 IDB，这里 LS 读不到时异步回退 IndexedDB——
    // 备份导入/恢复清空 xy-home-v2:* 键后错误线索仍能找回，不再"最近错误：无"
    try {
      const errIdx = L.length; L.push('最近错误：读取中…');
      jobs.push(new Promise(function (res) {
        readErrs(function (errs) {
          try {
            if (Array.isArray(errs) && errs.length) {
              const lines = ['最近错误 ' + errs.length + ' 条（最多留 ' + ERR_CAP + ' 条，调用栈只给最近 ' + ERR_STACK_RECENT + ' 条——报障文本过长剪贴板会截断；｛现场｝=报错那一刻视口几何）：'];
              errs.forEach(function (it, idx) {
                const dt = it.t ? new Date(it.t).toLocaleString() : '?';
                // v3.27.x：版本/启动序号/重复次数/案发视口现场——旧条目无这些字段时自然省略
                lines.push('· ' + dt + (it.v ? ' [' + it.v + ']' : '') + ' [' + (it.dev || '') + (it.b ? ' 启动' + it.b : '') + '] '
                  + (it.msg || '').slice(0, 180) + ((it.c || 1) > 1 ? ' ×' + it.c : '')
                  + (it.page ? '（页面 ' + it.page + '）' : '')
                  + (it.vp ? ' ｛' + it.vp + '｝' : ''));
                // v3.25.x：带调用栈（只取前 4 行，够定位文件+行号又不刷屏）
                // v3.26.x #100：环形放大到 20 条后，栈只跟最近 3 条（旧的 17 条各带
                // 4 行栈会把正文撑成 100 行，用户粘贴时反被截断，得不偿失）
                const st = String(it.stack || '');
                if (st && idx >= errs.length - ERR_STACK_RECENT) lines.push('    ' + st.split('\n').slice(0, 4).join('\n    '));
              });
              L[errIdx] = lines.join('\n');
            } else {
              L[errIdx] = '最近错误：无';
            }
          } catch (e) { L[errIdx] = '最近错误：读取失败'; }
          res();
        });
      }));
    } catch (e) { L.push('最近错误：读取失败'); }
    // 启动文件异常（build.mjs 每文件 try/catch 的兜底数组）——产物里每个功能文件各自
    // 包一层，单文件启动抛错不会连坐其它文件，页面照常起来，只有这份名单能说明
    // 「TA 说某功能整块没了」是哪个文件没跑完（并行会话覆盖 / 语法错 / 漏接 build.mjs）。
    try {
      const je = Array.isArray(window.__jsErrors) ? window.__jsErrors : null;
      if (!je) L.push('启动文件异常：采集未启用');
      else if (je.length) {
        L.push('启动文件异常 ' + je.length + ' 处（对应功能可能整块未加载）：');
        je.slice(0, 8).forEach(function (m) { L.push('· ' + String(m).slice(0, 160)); });
      } else L.push('启动文件异常：无（所有功能文件启动完成）');
    } catch (e) {}
    // v3.34.x #527：模块加载体检——__mochiLoaded（每文件包内 try 末行登记「整段跑完」）
    // 对比构建期注入的 __mochiJsFiles（=jsFiles 期望清单），差集＝整段没执行的文件。
    // 补「启动文件异常」的盲区：语法错误在 parse 期抛出、包内 try/catch 兜不住，
    // __jsErrors 永远看不到；且每个 500KB script 块内任一文件语法错会整块不执行
    //（整块十几个功能一起死），「启动文件异常：无」与「功能整块没了」因此可以并存。
    try {
      const mc = window.mochiModuleCheck ? window.mochiModuleCheck() : null;
      if (!mc) L.push('模块加载体检：采集未启用（旧产物或初始化未接入）');
      else if (mc.missing.length) {
        // PERF-PLAN 阶段 1：全部缺的都在 ext 排队里＝弱网首访瞬态（defer 数秒内自愈），措辞降级不吓人。
        // #860（阶段 1b）：全部功能件都走 defer 外置后，「ext 排队」覆盖面扩大到 79 件——
        // 瞬态豁免只认启动后 15s 内（__mochiBootAt 由 boot 内联段注入）；过窗仍缺＝真没加载
        // （语法错/404/整段未执行），照旧按硬故障报，防诊断把死模块说成弱网。
        const pend = mc.extPending || [];
        const transient = (Date.now() - (window.__mochiBootAt || 0)) < 15000;
        const hard = transient ? mc.missing.filter(function (n) { return pend.indexOf(n) < 0; }) : mc.missing.slice();
        if (!hard.length) L.push('模块加载体检 ' + mc.loaded.length + '/' + mc.expected.length + '：外置模块加载中 ' + pend.join(', ') + '（弱网首访瞬态，外置 js/ 数秒内自动就绪，非故障）');
        else L.push('模块加载体检 ' + mc.loaded.length + '/' + mc.expected.length + '：未加载 ' + mc.missing.join(', ') + '（' + (transient ? '非外置文件整段未执行' : '已过启动瞬态窗仍缺') + '＝语法错/启动抛错/404/漏接 jsFiles，对应功能可能整块失效）');
      }
      else L.push('模块加载体检：' + mc.expected.length + '/' + mc.expected.length + ' 全部加载完成');
    } catch (e) {}
    // v3.26.x #101：功能入口体检——用户报"帮我决定加载失败"但诊断说无启动异常，
    // 加 typeof 检查确认 openDecision 等是否赋值（decision.js 抛错但 __jsErrors 没捕获的情况）
    try {
      const fn = ['openDecision', 'openGroupDecision', 'activePrefix', 'xyStore', 'idbGet', 'idbSet'];
      const bad = fn.filter(function (n) { return typeof window[n] !== 'function'; });
      if (bad.length) L.push('功能入口缺失：' + bad.join(', ') + '（typeof != function）');
      else L.push('功能入口体检：全部就绪');
    } catch (e) {}
    // v3.25.x：环境变化记录（旋转/键盘/前后台）——手机端 bug 的触发现场
    try {
      const envs = JSON.parse(localStorage.getItem(ENV_KEY) || '[]');
      if (Array.isArray(envs) && envs.length) {
        L.push('环境变化 ' + envs.length + ' 条（旧→新）：');
        envs.forEach(function (it) {
          const dt = it.t ? new Date(it.t).toLocaleTimeString() : '?';
          L.push('· ' + dt + ' ' + (it.k || '') + '：' + (it.x || ''));
        });
      } else {
        L.push('环境变化：无');
      }
    } catch (e) { L.push('环境变化：读取失败'); }
    // v3.25.x：网络失败 + 交互轨迹
    try {
      const nets = JSON.parse(localStorage.getItem(NET_KEY) || '[]');
      if (Array.isArray(nets) && nets.length) {
        L.push('网络失败 ' + nets.length + ' 条（旧→新，1 分钟内同址去重）：');
        nets.forEach(function (it) {
          const dt = it.t ? new Date(it.t).toLocaleTimeString() : '?';
          L.push('· ' + dt + ' ' + (it.u || '?') + (it.s ? ' HTTP ' + it.s : '（网络错误/断网）'));
        });
      } else {
        L.push('网络失败：无');
      }
    } catch (e) { L.push('网络失败：读取失败'); }
    try {
      const taps = JSON.parse(localStorage.getItem(TAP_KEY) || '[]');
      if (Array.isArray(taps) && taps.length) {
        L.push('交互轨迹 ' + taps.length + ' 条（旧→新）：');
        taps.forEach(function (it) {
          const dt = it.t ? new Date(it.t).toLocaleTimeString() : '?';
          L.push('· ' + dt + ' ' + (it.x || '?'));
        });
      } else {
        L.push('交互轨迹：无');
      }
    } catch (e) { L.push('交互轨迹：读取失败'); }
    // FIX 2026-09-07 #257：触摸轨迹（与交互轨迹并排读：触摸有 click 无＝死点击实锤）
    // + 卡死逃生记录（mobile-adapt #257 逃生门落盘的 LS 现场，跨重启可读）
    try {
      const tchs = JSON.parse(localStorage.getItem(TOUCH_KEY) || '[]');
      if (Array.isArray(tchs) && tchs.length) {
        L.push('触摸轨迹 ' + tchs.length + ' 条（旧→新，[所在页]元素）：');
        tchs.forEach(function (it) {
          const dt = it.t ? new Date(it.t).toLocaleTimeString() : '?';
          L.push('· ' + dt + (it.pg ? '[' + it.pg + ']' : '') + ' ' + (it.x || '?'));
        });
      } else {
        L.push('触摸轨迹：无');
      }
    } catch (e) { L.push('触摸轨迹：读取失败'); }
    try {
      const stucks = JSON.parse(localStorage.getItem('xy-home-v2:__diag-stuck') || '[]');
      if (Array.isArray(stucks) && stucks.length) {
        L.push('卡死逃生记录 ' + stucks.length + ' 条（旧→新，#257 逃生门触发现场）：');
        stucks.forEach(function (it) {
          const dt = it.t ? new Date(it.t).toLocaleTimeString() : '?';
          L.push('· ' + dt + ' ' + (it.tag || '?') + '（' + (it.n || '?') + '击）');
        });
      } else {
        L.push('卡死逃生记录：无（未触发过）');
      }
    } catch (e) { L.push('卡死逃生记录：读取失败'); }
    // v3.26.x：输入轨迹（「打字不显示/输入栏空白」定案用）——读法：
    //   n 恒 0 ＝ 字根本没进 DOM（输入法/内核丢提交）
    //   n 涨过又掉回 0 ＝ 进来了被清（防复活守卫 / 重绘清空 / 切桌面竞态）
    //   n>0 且 st/sh/ch 正常 ＝ 进了 DOM 只是没画出来（合成层陈旧）
    //   n>0 但 st ≈ sh-ch 且 sh ≤ ch ＝ 被自身滚动推出裁剪区（#115 自愈已修）
    try {
      // #538：先把节流缓冲的输入轨迹落盘，再读——否则用户刚打完字就点诊断时看不到最后几条
      try { if (window.__diagInpFlush) window.__diagInpFlush(); } catch (eF) {}
      const inps = JSON.parse(localStorage.getItem(INP_KEY) || '[]');
      if (Array.isArray(inps) && inps.length) {
        L.push('输入轨迹 ' + inps.length + ' 条（旧→新，只记长度不记内容）：');
        inps.forEach(function (it) {
          const dt = it.t ? new Date(it.t).toLocaleTimeString() : '?';
          L.push('· ' + dt + ' ' + (it.k || '?') + ' ' + (it.x || '?') + ' n=' + it.n
            + ' st/sh/ch=' + it.st + '/' + it.sh + '/' + it.ch);
        });
      } else {
        L.push('输入轨迹：无');
      }
    } catch (e) { L.push('输入轨迹：读取失败'); }
    // ===== 软/硬双预算交付（v3.26.x）=====
    // 子任务自己的预算最长到 9s（桌面归属体检保险丝）/ 8s（idbGetMany 两段超时），
    // 而这里原本只有一个 3s 兜底：IDB 一慢，「最近错误」「开关持久化体检」「桌面归属
    // 体检」「IndexedDB 大键明细」就整批停在「读取中…」——偏偏 LS/IDB 出故障的机器
    // 只有这几行能定位根因（2026-08-30 iPhone 16 Pro 真机诊断即如此；前一晚已针对同
    // 一症状修过 IDB 侧，外层预算没人动，次日复发）。
    // 现改双预算：3.5s 先交首屏（未读到的行明确标注，不再冒充「读取中」），后续明细
    // 到达经 onUpdate 回填；进入终态（全部完成 / 12s 硬预算）才由调用方做自动复制，
    // 避免把残缺文本塞进剪贴板、让用户以为报障材料已经齐了。
    let given = false, terminal = false, terminalGiven = false, dirty = false, updateCb = null, lastTxt = null, tick = null;
    const PLACEHOLDER = /读取中…|获取中…|采样中…/;
    const PLACEHOLDER_G = /读取中…|获取中…|采样中…/g;
    // 屏幕适配 ✗ 条目（只采一次；屏幕适配是独立 IIFE，经 window.__collectScreenDiag 只读采集）
    let _conclSdBad = null;
    function conclScreenBad() {
      if (_conclSdBad) return _conclSdBad;
      try {
        const r = window.__collectScreenDiag ? window.__collectScreenDiag() : null;
        _conclSdBad = (r && r.findings) ? r.findings.filter(function (f) { return !f.ok; }).map(function (f) { return f.name; }) : [];
      } catch (e) { _conclSdBad = []; }
      return _conclSdBad;
    }
    // 结论聚合：扫描当前 L（跳过结论自身那行，防自我累积）＋屏幕适配 ✗，输出一行摘要
    function conclusionText() {
      const issues = [];
      for (let i = 0; i < L.length; i++) {
        if (i === conclBodyIdx) continue;
        const s = L[i] || '';
        let m;
        if (/^启动文件异常：采集未启用/.test(s)) issues.push('启动文件异常采集未启用');
        else if ((m = /^启动文件异常 (\d+) 处/.exec(s))) issues.push('启动文件异常 ' + m[1] + ' 处');
        else if (/^模块加载体检 .*未加载 /.test(s)) { const mm = /未加载 ([^（]+)/.exec(s); issues.push('模块未加载 ' + (mm ? mm[1].trim() : '')); }
        else if ((m = /^功能入口缺失：(.+)/.exec(s))) issues.push('功能入口缺失 ' + m[1].replace(/（[^）]*）.*$/, '').trim());
        else if ((m = /^最近错误 (\d+) 条/.exec(s))) issues.push('最近错误 ' + m[1] + ' 条');
        else if (/^localStorage 状态：/.test(s) && !/正常/.test(s)) issues.push('localStorage 状态异常');
      }
      conclScreenBad().forEach(function (n) { issues.push('屏幕适配 ' + n); });
      if (!issues.length) return '未发现明显异常；若仍有故障，请连同下方明细整段发送。';
      return '⚠ 发现 ' + issues.length + ' 项：' + issues.map(function (x, i) { return (i + 1) + '. ' + x; }).join('  ');
    }
    const snap = function () {
      // 每拍按当前 L 重算结论（异步明细回填后同步刷新）
      try { L[conclBodyIdx] = conclusionText(); } catch (e0) {}
      // 占位行任何时候都要标注清楚：终态仍停在「读取中…」等于没线索
      const note = terminal ? '未完成（本机存储无响应，稍后重开诊断再试）' : '未读到（本机存储响应慢，稍后自动补全）';
      const out = [];
      for (let i = 0; i < L.length; i++) {
        let s = L[i];
        if (PLACEHOLDER.test(s)) s = s.replace(PLACEHOLDER_G, note);
        out.push(s);
      }
      return out.join('\n');
    };
    const fire = function () {
      const txt = snap();
      // 正文没变则不打扰；但「进入终态」那次必须至少走一次——调用方靠这一步做
      // 自动复制，若迟到任务完成时正文恰好没变化，无条件 return 会导致永不复制。
      if (txt === lastTxt && (!terminal || terminalGiven)) return;
      lastTxt = txt;
      if (terminal) terminalGiven = true;
      if (updateCb) { try { updateCb(txt, terminal); } catch (e) {} return; }
      if (given) { dirty = true; return; }
      given = true;
      resolve({
        text: txt, allDone: terminal,
        onUpdate: function (cb) {
          updateCb = cb;
          if (dirty) { dirty = false; try { cb(snap(), terminal); } catch (e) {} }
        }
      });
    };
    const done = function () { if (terminal) return; terminal = true; fire(); };
    try { Promise.all(jobs).then(done).catch(done); } catch (e) { done(); }
    try { setTimeout(fire, 3500); } catch (e) {}
    try { setTimeout(done, 12000); } catch (e) {}
    // 超过硬预算才回门的迟到结果同样回填（文本没变时 fire 自行跳过）。
    // 轮询只在首屏已交付后驱动回填：未交付时它会把 3.5s 软预算抢短，
    // 交出一份更残缺的首屏；终态交付由 done() 负责，不需要轮询兜底。
    try { tick = setInterval(function () { if (given) fire(); }, 600); } catch (e) {}
    try { setTimeout(function () { if (tick) { clearInterval(tick); tick = null; } }, 30000); } catch (e) {}
    });
  }
  // v3.32.x #261：复制兜底路径共用的「当场收选区」器（三处 ta.select() 分属不同 IIFE，挂 window 共享）。
  // 隐藏 textarea 全选 → execCommand('copy') 之后，那条全选还留在文档里；节点随后被 removeChild。
  // 实测（verify-copy-selection B3a）Blink 不会留下「指向已脱离节点」的孤儿，而是把选区**重挂到
  // document.body 且仍然活着**——那种状态全局回收器按设计不敢碰（与正当的整页全选同形），
  // 所以必须在这里当场塌掉：安卓系内核的原生文字选择工具条（黑色「全选/复制」浮层）以选区为
  // 宿主，选区不收它就不退，且浮层归浏览器所有 → 永久卡在屏幕原位（荣耀畅玩40 Plus/夸克实证：
  // 桌面「今日情话」右边一个消不掉的【全选】，切后台重进仍在；多机型同族）。
  // execCommand 同步完成，收选区不动复制结果。
  window.mochiKillCopySelection = function (ta) {
    try { if (ta && ta.setSelectionRange) ta.setSelectionRange(0, 0); } catch (e) {}
    try { if (ta && document.activeElement === ta) ta.blur(); } catch (e2) {}
    try { const s = window.getSelection && window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (e3) {}
  };
  function copyText(t) {
    // v3.16.x：clipboard.writeText 在权限被拒/WebView 剪贴板不可用时可能永不 settle
    //（headless、部分 IAB 实测 Promise 悬空），会导致「复制诊断信息」弹窗永远不弹。
    // 加 1.5s 超时兜底：超时按复制失败处理，流程照常走到弹窗。
    //
    // v3.26.x：用户反馈「点【复制】没弹窗、还把网页刷了」。根因两类：
    // ① 复制结果只写回弹窗顶部提示行，且内容与打开时几乎相同 → 看不出有反馈；
    // ② 部分安卓 WebView 对 navigator.clipboard.writeText 会弹系统权限/卡死甚至
    //    整页重载。改：复制优先走原生 document.execCommand('copy')（divination.js
    //    长期在用，无权限体系、不重载），失败再回退 clipboard API；bottom toast 兜底反馈。
    return new Promise(function (resolve) {
      let done = false;
      const finish = function (ok) { if (done) return; done = true; resolve(ok); };
      // 回退 1：clipboard API（execCommand 不可用/返回 false 时）
      function fallbackClipboard() {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(function () { finish(true); }).catch(function () { finish(false); });
          } else { finish(false); }
        } catch (e) { finish(false); }
      }
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
        document.body.appendChild(ta);
        // v3.27.x：不再 focus()——隐藏 textarea 上 focus 在手机端会弹起输入法
        //（800ms 后随元素移除又收起 = 弹一下又关的灰屏观感，同 #113 修过的症状，
        //  只是从「打开自动复制」挪到了「手动点复制」）。select() + execCommand('copy')
        //  无需焦点即可复制（divination.js 同款做法已验证）；失败才回退 clipboard API。
        try { ta.select(); } catch (e) {}
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        window.mochiKillCopySelection && window.mochiKillCopySelection(ta);   // #261：全选选区当场收掉，别留给 800ms 后的 removeChild 变孤儿
        setTimeout(function () { try { document.body.removeChild(ta); } catch (e2) {} }, 800);
        if (ok) { finish(true); return; }
        fallbackClipboard();
      } catch (e) { fallbackClipboard(); }
      // 回退 2：1.5s 超时兜底（async 路径永不 settle 时）
      try { setTimeout(function () { finish(false); }, 1500); } catch (e) {}
    });
  }
  // v3.26.x：复制/导出按钮的可见反馈——bottom toast（全站统一反馈），
  // 复制结果不再只写进弹窗顶部提示行（那行内容与打开时几乎一样，用户看不出变化）。
  // v3.26.x 修复：原实现只调 window.toast，而全项目从未给 window.toast 赋过值
  //（chat.js 的 function toast 是 IIFE 局部）——实测产物里 typeof window.toast ===
  // 'undefined'，于是「复制成功/失败」的底部反馈一直是死代码，点诊断行到弹窗出来
  // 之间用户也得不到任何「正在读取」的信号（正是「点了没反应」那类反馈的观感来源）。
  // 保留 window.toast 优先（哪天真的挂上就直接用），否则自绘 #cc-toast。
  // v3.27.x：统一 #cc-toast（device.js 内 diagToast 与 LS 失效 notice 共用，防相互顶掉）
  let _ccToastTimer = null;
  function ccToast(msg) {
    try {
      let t = document.getElementById('cc-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'cc-toast';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.className = 'cc-toast';
      void t.offsetWidth;
      t.className = 'cc-toast show';
      clearTimeout(_ccToastTimer);
      _ccToastTimer = setTimeout(function () { t.className = 'cc-toast'; }, 2600);
    } catch (e) {}
  }
  function diagToast(msg) {
    try { if (typeof window.toast === 'function') { window.toast(msg); return; } } catch (e) {}
    ccToast(msg);
  }
  // ===== v3.26.x #227：导出 docx（原导出 txt，用户要求改 docx——Word/WPS 直接打开转发）=====
  // 下载成文件再经聊天 App 发送最稳的诉求不变（部分安卓 IAB/WebView 剪贴板对大文本
  // 静默截断）。docx=ZIP 容器的 OOXML：零依赖手写「存储式 ZIP（不压缩）+CRC32」打包
  // 三件套（[Content_Types].xml / _rels/.rels / word/document.xml），正文一行一段落、
  // XML 转义，等宽+雅黑字体保证报告数值对齐可读；不引第三方库，保持单文件构建。
  function crc32(bytes) {
    let table = crc32._t;
    if (!table) {
      table = crc32._t = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
      }
    }
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }
  function buildDocxBlob(text) {
    const enc = new TextEncoder();
    const esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    const paras = String(text).split(/\r\n|\r|\n/).map(function (line) {
      return '<w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/>'
        + '<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
        + '<w:t xml:space="preserve">' + esc(line) + '</w:t></w:r></w:p>';
    }).join('');
    const XMLHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const files = [
      { name: '[Content_Types].xml', data: enc.encode(XMLHead
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '</Types>') },
      { name: '_rels/.rels', data: enc.encode(XMLHead
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '</Relationships>') },
      { name: 'word/document.xml', data: enc.encode(XMLHead
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + paras
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        + '<w:pgMar w:top="1000" w:right="900" w:left="900" w:bottom="1000" w:header="720" w:footer="720" w:gutter="0"/>'
        + '</w:sectPr></w:body></w:document>') }
    ];
    // 手写 ZIP（全 STORED 不压缩）：本地文件头+数据 → 中央目录 → EOCD
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >>> 1);
    const dosDate = (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [], cdChunks = [];
    let offset = 0;
    files.forEach(function (f) {
      const nameB = enc.encode(f.name), crc = crc32(f.data), lb = f.data.length;
      const lh = new Uint8Array(30 + nameB.length);
      const v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
      v.setUint16(8, 0, true); v.setUint16(10, dosTime, true); v.setUint16(12, dosDate, true);
      v.setUint32(14, crc, true); v.setUint32(18, lb, true); v.setUint32(22, lb, true);
      v.setUint16(26, nameB.length, true);
      lh.set(nameB, 30);
      chunks.push(lh, f.data);
      const cd = new Uint8Array(46 + nameB.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, lb, true); cv.setUint32(24, lb, true);
      cv.setUint16(28, nameB.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameB, 46);
      cdChunks.push(cd);
      offset += lh.length + lb;
    });
    const cdSize = cdChunks.reduce(function (s, c) { return s + c.length; }, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob(chunks.concat(cdChunks, [eocd]),
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  function exportDocx(text, basePrefix) {
    try {
      const blob = buildDocxBlob(text);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (basePrefix || 'mochi-diag-') + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.docx';
      document.body.appendChild(a);
      a.click();
      // #887：blob URL 长命化（照搬 data-backup.js anchorDownload v3.28.x 的同族修法）——
      // 原实现 800ms 就 revokeObjectURL：慢速 iOS / 旧版下载管理器还没把文件写完，
      // 落盘的就是 0 字节空白 docx（「导出的文件是空白」实报）。改为 pagehide 释放 +
      // 300s 兜底，anchor 5s 再移除；与备份导出同一口径，零机型分支。
      try {
        setTimeout(function () {
          try { if (a.parentNode) a.removeChild(a); } catch (e2) {}
        }, 5000);
      } catch (e2) {}
      try {
        window.addEventListener('pagehide', function h() {
          window.removeEventListener('pagehide', h);
          try { URL.revokeObjectURL(url); } catch (e2) {}
        });
      } catch (e2) {}
      try {
        setTimeout(function () {
          try { URL.revokeObjectURL(url); } catch (e2) {}
        }, 300000);
      } catch (e2) {}
      return true;
    } catch (e) { return false; }
  }
  // FIX 2026-09-11 #333：诊断导出统一入口——先走数据备份同款三级降级链
  // （window.mochiExportBlob：①系统分享面板 ②系统保存框 ③确认后 a[download]），
  // 再以裸 a[download]（exportDocx）兜底。此前只裸 a[download]+blob URL：荣耀畅玩80Pro
  // 自带浏览器（多机型同族）对合成 a.click() 静默忽略，点「导出docx」毫无反应；
  // 分享面板是该类壳浏览器唯一可靠通道（同 data-backup.js #172 的结论）。
  // #382 形参收窄：failMsg=失败提示文案（字符串）、toastFn=提示函数——旧版单形参
  // failToast 同时被当「函数调用」和「文案判断」用，屏幕适配诊断调用方传 4 参
  // （第3参=文案串、第4参=sdToast 被丢弃），一旦走 legacy 分支必抛
  // 「failToast is not a function」且被按钮 try/catch 吞掉＝导出静默失败。
  function diagExportDocx(text, basePrefix, failMsg, toastFn, shareTitle) {
    const fname = (basePrefix || 'mochi-diag-') + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.docx';
    const tf = (typeof toastFn === 'function') ? toastFn : diagToast;
    // #887：空白内容守卫——报告还没生成完（采样中/异步采集未落）时 text 为空，
    // 照旧导出会产出一个「打开全空白」的 docx＝用户看到的「导出的文件是空白」另一半成因。
    // 拦下来给可行动提示，而不是让用户拿到空文件。
    if (!text || !String(text).replace(/\s/g, '')) {
      tf('报告还没生成好（内容是空的），等几秒或重新打开一次再导');
      return;
    }
    const legacy = function () {
      const okDl = exportDocx(text, basePrefix);
      tf(okDl
        ? '已开始下载 docx 文件（见浏览器下载列表）'
        : (failMsg || '当前内核不支持下载，请用【复制】复制'));
    };
    if (typeof window.mochiExportBlob !== 'function') { legacy(); return; }
    let blob = null;
    try { blob = buildDocxBlob(text); } catch (e) { blob = null; }
    // #887：zip 结构自检——正常单页报告 docx 至少数 KB；小于 64B 说明打包已坏，
    // 走 legacy 前把异常记进导出存根（__diag-export），报障时能对号是哪条路、什么内核。
    if (!blob || blob.size < 64) {
      try { localStorage.setItem('xy-home-v2:__diag-export', JSON.stringify({ t: Date.now(), path: 'blob-broken', size: blob ? blob.size : -1, ua: String(navigator.userAgent).slice(0, 60) })); } catch (e) {}
      legacy();
      return;
    }
    // #887：导出存根——记录本次走的通道与文件大小（成功也记）。空白文件类报障凭这一条
    // 就能定责：path=share 却 size 正常＝分享面板落盘问题；path=download＝下载管理器问题，
    // 避免再靠猜内核名单（#854/#758 同族教训：证据进名单，不预判）。
    try { localStorage.setItem('xy-home-v2:__diag-export', JSON.stringify({ t: Date.now(), path: 'chain', size: blob.size, ua: String(navigator.userAgent).slice(0, 60) })); } catch (e) {}
    // #746（2026-09-18）：第 5 参 shareTitle 把分享面板/保存框标题参数化——
    // 「字卡使用状态自检」导出复用本入口，标题显示「字卡使用状态自检报告」；
    // 不传保持旧值「mochi 诊断报告」，既有诊断调用方零感知。
    window.mochiExportBlob(blob, fname, shareTitle || 'mochi 诊断报告', [
      { description: 'Word 文档', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } }
    ]).then(function (res) {
      // #887：结果也记进存根（ok/cancel/fail），legacy 兜底时补一条
      try { localStorage.setItem('xy-home-v2:__diag-export', JSON.stringify({ t: Date.now(), path: 'chain:' + res, size: blob.size, ua: String(navigator.userAgent).slice(0, 60) })); } catch (e) {}
      if (res === 'fail') legacy();
    });
  }
  // #382：跨闭包导出——本 IIFE 与「屏幕适配诊断」IIFE（#209/#176 域）是两个独立闭包，
  // 那边直接写 diagExportDocx 会 ReferenceError（点【导出docx】被 openModal 按钮的
  // try/catch 吞掉＝毫无反应，多机型 Chrome/壳浏览器全现）。挂 window 供其调用。
  window.mochiDiagExportDocx = diagExportDocx;
  // ===== v3.25.x：诊断入口角标 =====
  // 报障的人不知道去哪拿诊断数据：采集到新错误后，「复制诊断信息」行上挂
  // 红色数字角标（未看过的错误数），点开诊断后归零，把报障动线推到眼前。
  // 样式内联自包含（仅此一处使用，不为此动 setting.css）；红底白字明暗主题都可读。
  const SEEN_KEY = 'xy-home-v2:__diag-errs-seen';
  function badgeEl() {
    // v3.27.x：row 在使用处按需获取；入口 DOM 不存在时角标整体跳过（不中断采集）
    const row = document.getElementById('row-diagnostics');
    if (!row) return null;
    let b = null;
    try { b = row.querySelector('.diag-err-badge'); } catch (e) {}
    if (!b) {
      b = document.createElement('span');
      b.className = 'diag-err-badge';
      b.style.cssText = 'flex-shrink:0;background:#e5484d;color:#fff;font-size:11px;line-height:16px;min-width:16px;box-sizing:border-box;text-align:center;border-radius:9px;padding:0 5px;font-weight:600;letter-spacing:.3px;';
      const arrow = row.querySelector('.arrow');
      if (arrow) { try { row.insertBefore(b, arrow); } catch (e2) { row.appendChild(b); } }
      else row.appendChild(b);
    }
    return b;
  }
  function refreshBadge() {
    try {
      readErrs(function (errs) {
        try {
          // v3.26.x 修复：原按条数比较（n > seen）。错误环形上限就是 5 条，写满且用户
          // 看过一次后 seen 恒为 5，之后新错误只轮换不改条数 → 角标永久不再出现
          //（实测「满 5 + seen=5 + 新错误 → 隐藏」），而这恰恰是错误反复发生的机器。
          // 改记「已看到的最后一条错误时间戳」并显示未读条数。旧值存的是 0~5 的条数，
          // 任何真实时间戳都比它大 → 会自行亮一次、下次点开即被覆盖成时间戳，无需迁移。
          const seen = Number(localStorage.getItem(SEEN_KEY)) || 0;
          const list = Array.isArray(errs) ? errs : [];
          let unread = 0;
          for (let i = 0; i < list.length; i++) { if (((list[i] && list[i].t) || 0) > seen) unread++; }
          const b = badgeEl();
          if (!b) return; // v3.27.x：入口 DOM 不在，角标无从挂载，跳过即可
          if (unread > 0) { b.textContent = String(unread); b.style.display = ''; }
          else b.style.display = 'none';
        } catch (e) {}
      });
    } catch (e) {}
  }
  try { purgeOpaqueDiagErrs(); } catch (e) {}
  try { refreshBadge(); } catch (e) {}
  // v3.26.x：暴露给「查看存储」页——手动清理错误诊断记录后角标同步归零
  try { window.mochiRefreshDiagBadge = refreshBadge; } catch (e) {}
  const TIP_WAIT = '正在读取本机存储明细…（读全后会自动更新）';
  const TIP_OK = '诊断信息已复制到剪贴板，直接粘贴发给开发者即可。\n（下方内容可再核对）';
  const DIAG_TITLE = '复制诊断信息';
  // 全站弹窗共用同一批 DOM（#modal-mask / #modal-textarea），诊断的回填最晚到 30s，
  // 期间用户可能已关窗去开别的弹窗——判活不过关就绝不写，防止把诊断文本灌进别人框里。
  const modalAlive = function () {
    try {
      const mask = document.getElementById('modal-mask');
      if (!mask || mask.hidden) return false;
      const ti = document.getElementById('modal-title');
      if (ti && ti.textContent !== DIAG_TITLE) return false;
      return true;
    } catch (e) { return false; }
  };
  // v3.26.x：回填正文必须直接写可见的 #modal-textarea——personalize.js 里
  // ctl.text(s) 的 setter 只写 #modal-input.value，而 textarea 模式下 input 是隐藏的
  //（getter 反过来优先读 textarea），所以此前 ctl.text(回填文本) 静默无效：
  // 弹窗正文一直停在首屏残缺内容，明细永远看不到（实测三条回填断言全败）。
  // setModalText 依赖 then 回调里的 ctl，定义在那一侧。
  // v3.27.x：点击入口在使用处按需获取；入口 DOM 不存在时仅「打开诊断」不可用，
  // 不影响上方所有采集逻辑（错误/环境/长任务/轨迹照常记录，角标由 refreshBadge 跳过）
  const row = document.getElementById('row-diagnostics');
  if (!row) return;
  row.addEventListener('click', function () {
    // 点下去就有反馈：慢机上首屏也要 3.5s，没这一步用户以为没点上
    diagToast('正在读取本机诊断数据…');
    collectDiag().then(function (r) {
      // v3.25.x：看过诊断 = 已知错误；v3.26.x 改记最后一条错误的时间戳（与角标同口径）
      readErrs(function (errsNow) {
        try {
          let mx = 0;
          if (Array.isArray(errsNow)) {
            for (let i = 0; i < errsNow.length; i++) { const t2 = (errsNow[i] && errsNow[i].t) || 0; if (t2 > mx) mx = t2; }
          }
          localStorage.setItem(SEEN_KEY, String(mx));
        } catch (e) {}
        try { refreshBadge(); } catch (e) {}
      });
      let ctl = null, closed = false, cur = r.text;
      const setModalText = function (txt) {
        try {
          const ta = document.getElementById('modal-textarea');
          if (ta && !ta.hidden) { ta.value = txt; return; }
        } catch (e) {}
        try { if (ctl && ctl.text) ctl.text(txt); } catch (e2) {}
      };
      // 点遮罩/取消只走 close()、不回调 cb → closed 会一直停在 false。
      // 所以提示必须再判一次「弹窗还在不在、还是不是我们这个」。
      const setHint = function (s) { if (closed || !modalAlive()) return; if (ctl && ctl.hint) { try { ctl.hint(s); } catch (e) {} } };
      // v3.26.x：取消自动复制。根因有二：
      // ① 手机剪贴板有字数上限，打开诊断就自动写长文本会被静默截断，白折腾；
      // ② 自动复制走 copyText()——对隐藏 textarea 调 focus() 会先弹起输入法、
      //    800ms 后随元素移除又收起，手机上表现为「弹输入法又关 + 灰屏」。
      // 取消自动复制后：打开只读文本不再碰剪贴板、不再 focus textarea，输入法不再打扰。
      // 需要发给开发者时，由用户点【复制】/【导出docx】自行触发。
      if (window.openModal) {
        ctl = window.openModal(DIAG_TITLE, cur, function () { closed = true; }, {
          noInput: true,
          textarea: true,
          textareaRows: 14,
          // v3.25.x：宽版弹窗——默认弹窗 272px 太窄、多行框 3 行装不下诊断长文，
          // 加宽加高便于核对；配合 openModal 的 opts.big / css .modal--big
          big: true,
          placeholder: '',
          staticText: TIP_WAIT,
          // v3.16.x：弹窗内「复制」按钮——需要发送诊断时手动点它复制，
          // 复制成功用 hint() 就地反馈，不用关窗重进。
          copyBtn: {
            label: '复制',
            fn: function (c) {
              const txt = c ? c.text() : cur;
              // v3.27.x：诊断文本超长时剪贴板可能静默截断（代码注释里也承认过），
              // 先提示用导出 docx 更稳，再照常复制（用户仍可选择复制）
              const TIP_LONG = '文本较长（' + Math.round(txt.length / 1000) + 'KB），手机剪贴板可能截断，建议优先【导出docx】。';
              if (c && c.hint && txt.length > 8000) c.hint(TIP_LONG);
              copyText(txt).then(function (ok2) {
                const m2 = ok2 ? TIP_OK : '复制失败，请长按选字手动复制。';
                if (c && c.hint) c.hint(m2);
                diagToast(ok2 ? '已复制到剪贴板' : '复制失败，请长按选字手动复制');
              });
            }
          },
          // #227：导出 docx（原 txt）——复制失败/截断时的兜底，下载后经聊天 App 发送；
          // Word/WPS 直接打开，数值报告不乱码不错行
          exportBtn: {
            label: '导出docx',
            fn: function (c) {
              // #333：三级降级链（分享面板→保存框→确认下载），裸下载只作兜底
              diagExportDocx(c ? c.text() : cur);
            }
          }
        });
      }
      // 首屏即终态（多数机器 1s 内）直接显示；否则等回填到终态再刷新文本。
      // v3.26.x：不再自动复制（见上方注释），只更新正文，复制由用户手动触发。
      if (r.allDone) { /* 首屏即终态，正文已是完整诊断，无需额外动作 */ }
      else if (r.onUpdate) {
        r.onUpdate(function (txt, done2) {
          cur = txt;
          if (closed) return;
          // 弹窗已被关掉或复用给别的弹窗 → 视同关闭，停止回填
          if (!modalAlive()) { closed = true; return; }
          setModalText(txt);
          if (!done2) setHint(TIP_WAIT);
        });
      }
    });
  });
})();

// ===== 功能：布局手动兜底 UI（v3.26.x，设置页「手机布局（强制）」） =====
// 设备判定纯靠指纹，而浏览器「桌面版网站」模式能把指纹整套仿真掉（vivo Y35 + Edge
// 连栽 v3.9/3.11/3.13 三轮）。这里给一条不依赖判定的自救通道：开关写 __layout-pref
// 后整页重载——布局形态在启动时就定死，运行中改类名不足以复原各模块读到的 isMobile。
// 说明弹窗同时给出浏览器侧的正解（关掉桌面模式），那才是「页面大小 + 全屏不可用」
// 两个症状共同的根因。
(function () {
  const d = window.mochiDevice;
  const box = document.getElementById('sf-force-mobile');
  if (!d || !box) return;
  const sub = document.getElementById('sf-force-mobile-sub');
  box.checked = d.layoutPref === 'mobile';
  function renderSub() {
    if (!sub) return;
    const sig = d.signals || {};
    if (d.layoutPref === 'mobile') {
      sub.textContent = '已强制手机布局。关闭本开关恢复自动判定；想在手机上改用电脑外壳，地址栏加 ?pc=1。';
    } else if (d.layoutPref === 'pc') {
      sub.textContent = '已强制电脑外壳（地址栏 ?pc=1）。打开上方开关或去掉该参数即恢复自动判定。';
    } else if (d.isMobile) {
      sub.textContent = '自动判定：手机布局（依据 ' + (d.mobileRule || 'viewport<=900') + '）。'
        + (sig.uaDesk ? '检测到浏览器正以「桌面版网站」模式伪装成电脑，本页已自动纠正为手机布局。' : '');
    } else {
      sub.textContent = '自动判定：电脑外壳（当前是电脑，或浏览器把手机伪装成了桌面）。手机上看不到满屏布局时打开上方开关。';
    }
  }
  renderSub();
  box.addEventListener('change', function () {
    d.setLayoutPref(box.checked ? 'mobile' : '');
    try { location.reload(); } catch (e) {}
  });
  const help = document.getElementById('sf-force-mobile-help');
  const openHelp = function (e) {
    if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (er) {} }
    if (!window.openModal) return;
    const sig = d.signals || {};
    const txt = [
      '为什么需要这个开关\n',
      '浏览器（Edge / Chrome / Via 等）的「桌面版网站」模式会把手机的浏览器标识、屏幕尺寸、触摸能力整套伪装成电脑。本应用因此显示成电脑上的「小手机框 + 两侧灰底」，全屏模式也连带失灵——伪装出来的宽视口会被当成横屏，开关直接被「请先转竖屏」的判断拦下。\n',
      '推荐做法：关掉浏览器桌面模式（一步解决大小 + 全屏）\n',
      '· Edge（安卓）：右上角 ⋯ 菜单 → 取消勾选「桌面版网站」；若长期开着，Edge 设置 → 浏览/内容 → 关闭「始终请求桌面版网站」；',
      '· Chrome：⋮ 菜单 → 取消勾选「电脑版网站」；',
      '· 其他浏览器：菜单里通常叫「电脑版网页 / 桌面版网站」。\n',
      '关掉后仍是电脑布局，说明本应用没认出这台手机 —— 打开本开关强制切回手机布局（长期生效，随时可关）。\n',
      '\n当前判定：' + (d.isMobile ? '手机布局' : '电脑外壳')
        + '（依据 ' + (d.mobileRule || '—') + '）',
      '浏览器伪装桌面标识：' + (sig.uaDesk ? '是' : '否')
        + '　手动设置：' + (d.layoutPref || '自动')
        + '　视口：' + Math.round(window.innerWidth || 0) + '×' + Math.round(window.innerHeight || 0)
    ].join('\n');
    window.openModal('手机布局（强制）', '', function () {}, { noInput: true, staticText: txt });
  };
  if (help) {
    help.addEventListener('click', openHelp);
    help.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') openHelp(e);
    });
  }
})();

// ===== 功能：localStorage 失效自检 + 当场告知（v3.26.x #88） =====
// 小米 14U Edge 实测「LS 整库写不进（QuotaExceededError）而 IDB 184MB 完好、storage.
// persisted=true」。这种设备上所有「启动同步读 localStorage」的模块一律拿到空值，
// 用户看到的就是「聊天记录几个小时自己消失」「后台通知自己关掉」——而全程没有任何提示。
// 结论挂 window.__lsStatus（诊断/查看存储可复用），并只在 IDB 回填已完成（数据确实安全）
// 时提示一次；IDB 也不行的情况由 idb.js 的「存储异常」弹窗负责，这里不抢话也不吓人。
(function () {
  const G = 'xy-home-v2:';
  const FLAG = 'mochi-ls-dead-noticed';
  function probe() {
    try {
      localStorage.setItem(G + '__ls-probe', 'p');
      const back = localStorage.getItem(G + '__ls-probe');
      localStorage.removeItem(G + '__ls-probe');
      return back === 'p' ? 'ok' : 'unwritable(写入后读不回)';
    } catch (e) {
      return 'unwritable(' + ((e && e.name) || '异常') + ')';
    }
  }
  // 自带一份 #cc-toast 渲染：不能依赖 window.toast——build.mjs 把每个 js 文件单独包进
  // IIFE，chat.js 顶层的 function toast 并不会挂到 window 上（全项目搜不到 window.toast
  // 赋值），所以这里直接复用同名元素 + .cc-toast/.show 类，样式由 chat-pages.css 全局提供。
  function notice(msg) {
    try {
      let t = document.getElementById('cc-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'cc-toast';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.className = 'cc-toast';
      void t.offsetWidth;
      t.className = 'cc-toast show';
      clearTimeout(t._mochiTimer);
      t._mochiTimer = setTimeout(function () { t.className = 'cc-toast'; }, 2600);
    } catch (e) {}
  }
  let waits = 0;
  function trySay() {
    // 开屏 z-index 999 盖住 toast（99），必须等用户点击进入后再说
    const sp = document.getElementById('splash');
    if (sp && !sp.classList.contains('hide')) {
      if (waits++ < 120) setTimeout(trySay, 500);
      return;
    }
    try { sessionStorage.setItem(FLAG, '1'); } catch (e) {}
    notice('本机浏览器本地存储受限，设置与记录已改用数据库存储，数据不会丢');
  }
  function check() {
    window.__lsStatus = probe();
    if (window.__lsStatus === 'ok') return;
    let seen = false;
    try { seen = sessionStorage.getItem(FLAG) === '1'; } catch (e) {}
    if (!seen) setTimeout(trySay, 800);
  }
  window.__lsStatus = probe();
  if (window.__lsStatus !== 'ok') {
    if (window.__mochiDataReady) setTimeout(check, 4000);
    else {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        setTimeout(check, 1000);
      });
      setTimeout(function () { if (window.__mochiDataReady) check(); }, 20000);
    }
  }
})();

// ===== 功能：文档完整性自检 + 自愈重载（v3.26.x #134） =====
// iPhone X (iOS 16.7 Safari 主屏幕) 等机型反复报「桌面图标/小组件缺失、功能整块没了」
// （#87 同族，iOS 各机型均可发生）。根因：产物 index.html 约 3.6MB，弱网下响应被中途
// 截断——尾部脚本块（决策/全屏/移动适配/pwa 更新器）整体丢失，HTML 解析不报错
// （诊断「启动文件异常：无」），且旧 SW 把截断体当成功缓存 → 之后每次都残缺，反复发作。
// 本自检（device.js 是第一个文件，恒在执行）在 load 后查唯一截断信号：
//   template.html 尾部锚点 #mochi-html-eof（位于 body 最末、所有脚本块之后）。
//   锚点在 = 文档完整解析到底（所有脚本块都已包含）；锚点缺 = 尾部被截断（块6/7 丢失实锤）。
//   注意不能用 openDecision 等「函数入口」当信号——verify 脚本按子集组装页面时这些
//   函数本来就不在，会误报截断把测试页打断（实测 verify-diag-report 103s 长跑被 60s
//   误 reload）。
// 缺失 = 文档截断实锤 → 发 PURGE_INDEX 让 SW 删掉所有缓存里的 index.html（残缺体），
// 收到 PURGE_DONE 回执（或 1.2s 超时）后 reload 一次。sessionStorage 限 1 次防循环重载；
// 60s 延迟避开开屏/键盘/通话等关键交互，不打断正常使用中的会话。
(function () {
  const FLAG = 'mochi-trunc-reloaded';
  function checkDoc() {
    try {
      var tailMissing = !document.getElementById('mochi-html-eof');
      if (!tailMissing) return;
      var seen = false;
      try { seen = sessionStorage.getItem(FLAG) === '1'; } catch (e) {}
      if (seen) return; // 本会话已自愈过一次，不再重载（防 SW 异常导致无限刷新）
      try { sessionStorage.setItem(FLAG, '1'); } catch (e2) {}
      var done = false;
      var reload = function () {
        if (done) return;
        done = true;
        try { location.reload(); } catch (e3) {}
      };
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.addEventListener('message', function h(ev) {
            if (ev.data && ev.data.type === 'PURGE_DONE') {
              navigator.serviceWorker.removeEventListener('message', h);
              setTimeout(reload, 150);
            }
          });
          navigator.serviceWorker.controller.postMessage({ type: 'PURGE_INDEX' });
          setTimeout(reload, 1200); // SW 无响应也重载（浏览器 HTTP 缓存可能已修复）
        } else reload();
      } catch (e4) { reload(); }
    } catch (e) {}
  }
  if (document.readyState === 'complete') setTimeout(checkDoc, 60000);
  else window.addEventListener('load', function () { setTimeout(checkDoc, 60000); });
})();

// ===== v3.26.x #209：视口形态判定器（单一事实源）=====
// iOS 屏幕适配 bug 反复以不同「形态」出现（#148 已避让 / #179+#185 覆盖 / #199
// 浏览器沉浸壳 / #200 iOS18 系统保留 / #184 iPad）。此前形态判别在执行器
//（mobile-adapt.js syncVvFit）与诊断判定器（screenDiagJudge）各写一份，每加一个
// 新形态要两处手抄同段判式，必然漂移——#186 即两处现例：①真实采集路径没把
// safe-top-force 传进判定器，「用户已声明覆盖形态」分支永不命中；②force 时期望
// 底边写成 innerH 与注释「屏高」矛盾，forced 设备自检必误报底部超出/顶部双倍。
// 本函数=唯一分类器：输入只读实测信号，输出形态布尔 + 生效 safeTop + 期望底边/
// 期望顶位；执行器按输出写样式，诊断按输出出 ✗/✓。新增形态只改这里。纯函数
//（无 DOM/存储），tools/verify-viewport-form.mjs 按真机台账直接单测。
window.mochiViewportForm = function (sig) {
  const envTop = sig.envTop || 0;
  const innerH = sig.innerH || 0;
  const screenH = sig.screenH || 0;
  const iosMajor = sig.iosMajor || 0;
  // #235：Safari 主版本（Version/x.y）——26.x 起独立应用状态栏行为变为「覆盖」
  // （env 报真实值且内容垫到状态栏下），18.x 老内核才是「系统保留」。同信号反处理
  // 的分水岭就是这个版本线（14Pro/26.6=覆盖实证、15Pro/18.3=保留实证）。
  const safMajor = sig.safMajor || (function () { try { var m = /Version\/(\d+)\./.exec(String(navigator.userAgent || '')); return m ? +m[1] : 0; } catch (e) { return 0; } })();
  const standalone = !!sig.standalone;
  const diff = (screenH > 0 && innerH > 0) ? (screenH - innerH) : 0;
  // v3.26.x #719：e2e 浏览器几何信号——布局视口超出整屏的量（e2eOverH）与页面被
  // 缩放渲染的证据（e2eZ=screenW/innerW<1，devicePixelRatio≈z×系统密度）。物理上
  // 页面不可能比整屏还高，超出的那段必被系统栏覆盖；宽度超出＋DPR 缩小＝缩放渲染
  // 实锤而非 screen 坏值（#278 家族两轴同时坏值极罕见，带内上限再挡一层）。
  const e2eOverH = (screenH > 0 && innerH > 0) ? (innerH - screenH) : 0;
  const e2eZ = (sig.screenW > 0 && sig.innerW > 0 && sig.innerW > sig.screenW) ? (sig.screenW / sig.innerW) : 0;
  // env 探针门槛：standalone 或疑似沉浸式壳（screen≈inner）才值得建探针 DOM
  const needEnvProbe = ((screenH > 0 && innerH > 0 && diff <= 2) || standalone);
  // #236：安卓浏览器覆盖形态扩展——HeyTapBrowser（OPPO K13 Turbo Pro 实报）等安卓壳
  // viewport-fit=cover 生效（env≥20）且带底部工具条（diff>2），页面同样画进系统状态栏
  // 下方，与 #199 沉浸壳同需「状态栏自身抬升 + .phone 贴 inner」。sig.andr 只由安卓
  // 执行器/采集器传入，iOS（不传/false）维持 #199 原判式零回归
  const coverBrowser = !standalone && envTop >= 20 && (diff <= 2 || !!sig.andr);
  // v3.26.x #719：Edge/Android 15+「edge-to-edge 浏览器」形态（OPPO Find X9 Pro +
  // Edge 实报，用户明说多机型同现）：viewport-fit=cover 生效的系统上页面画进系统
  // 状态栏/手势条区，但 env(safe-area-inset-*) 恒报 0——#236 HeyTapBrowser 的姊妹
  // 形态（那款报 env≥40 走 coverBrowser，本形态 env=0 只能靠几何签名识别）：布局
  // 视口比整屏还高＋布局宽比 screen 宽（Find X9 Pro 现场 inner=400×810 / screen=
  // 360×785 / DPR 2.699≈0.9×3.0，810×0.9=729=785−Edge 底部工具条 56 全数对账＝
  // 页面顶到物理屏顶、系统状态栏悬浮其上）。修正＝顶部按状态栏高、底部按手势条高
  // 自动避让（估式 28/z、16/z；仍偏可经 屏幕位置设置 五轴本机精调）。带内 [3,64]：
  // 下限滤 DPR 取整噪声；上限既排除 #278 screen 坏值家族（畅享70Pro screen<inner
  // 达 535，该家族铺满 inner 即正确、不避让），也排除更高缩放档的非 e2e 浏览器
  // （chrome≥100 时 80% 缩放 overH≈71 会闯入 64~96 段，故上限收 64 不放宽）。
  // Edge 工具条隐匿瞬间 overH≈87 逸出带＝调用方用 sig.e2eLatch 闩住不掉避让
  //（见 mobile-adapt _aSyncCoverTop / syncSafeBottomA；旋转重探时自清）。
  const e2eBase = !standalone && !!sig.andr && envTop < 20
    && e2eOverH >= 3 && e2eZ > 0.5 && e2eZ <= 1;
  const e2eBrowser = e2eBase && (e2eOverH <= 64 || !!sig.e2eLatch);
  // #185/#186：用户在设置页声明本机属「覆盖形态」（与保留/已避让信号相同无法程序
  // 区分，用户自服）：顶部避让 env 探针优先、env=0 用 diff（=保留的状态栏高）兜底。
  // 声明优先级最高（执行器原语义：force 先判并置 _resStand=false——漏掉这步 forced
  // 设备会照保留形态算 expBase/expTop，正是 B 段台账抓出来的回归）
  const forceCover = standalone && !!sig.safeTopForce;
  // #235：保留判定加 Safari<26 门——26.x 内核（16Pro/17Pro 等）同信号实为覆盖形态，
  // 误判保留会漏加顶部避让（顶栏融进灵动岛）且高度少算 env 段（底部白带）
  const resStand = standalone && !forceCover && envTop >= 20 && envTop <= 160 && diff >= envTop - 8 && iosMajor >= 18 && safMajor > 0 && safMajor < 26;
  // #184：iPad 形态（inner=屏高已含整屏，diff≈0，env 仍报状态栏高）
  const ipadForm = standalone && envTop >= 20 && diff <= 2 && screenH > 0 && innerH >= screenH - 2;
  let safeTop;
  if (forceCover) safeTop = (envTop >= 20) ? envTop : ((diff >= 20 && diff <= 160) ? diff : 0);
  else if (resStand) safeTop = 0;
  // #719：e2e 浏览器顶部避让估式——系统状态栏高按缩放折算成页面 px（28/z），
  // 钳 [20,40]；估不准的部分留给 屏幕位置设置·顶部轴 本机精调（#707 双层包装照常叠加）。
  else safeTop = ((standalone || coverBrowser) && envTop >= 20 && envTop <= 160) ? envTop
    : (e2eBrowser ? Math.min(40, Math.max(20, Math.round(e2eZ > 0 ? 28 / e2eZ : 28))) : 0);
  // 期望 .phone 底边 / 全屏期望屏高：保留/iPad/浏览器壳贴 inner（超 inner=文档
  // 滚动量=与自愈 pin 对打）；#186 force 声明=屏高（safeTop+inner 补满屏底，修
  // 18.3 底部白边的正确期望，原实现误写 innerH）；覆盖形态=envTop+inner、min 屏高
  // 防异常超界（#184 起 min 为三形态统一式）。
  // FIX 2026-09-10 #278：min 钳制加 screenH≥innerH 门——部分安卓机 Chrome 的
  // screen.height 报数不可靠、比实际可视区还小（华为畅享70Pro/Chrome150 实测
  // screen=796 < inner=1331，OPPO 等多机型同报「底部超出 diff≈-535」错误环），
  // 物理上屏幕不可能小于视口，此时 screenH 必为坏值：min(796, 1331) 取到 796 →
  // .phone（贴 inner 铺满、布局本身正常）被误判「底部超出 535px」+「底部导航栏被裁」
  // 自动采集刷错误环。坏值弃用回退 envTop+innerH（执行器 vh 同源，行为=维持现状
  // 铺满可视区零变化）；screenH 正常（≥inner）的机型 min 钳制语义不变零回归。
  // #719：e2e 浏览器同保留/浏览器壳——贴 inner（页面本就铺到布局视口底，底部遮挡
  // 由 --mochi-safe-bottom 消费方自身避让，不靠撑高 .phone）。
  const expBase = (coverBrowser || resStand || ipadForm || e2eBrowser) ? innerH
    : (forceCover ? ((screenH >= innerH ? screenH : 0) || (safeTop + innerH))
      : Math.min((screenH >= innerH ? screenH : 0) || (envTop + innerH), envTop + innerH));
  // 期望状态栏顶位（诊断 ③）：保留形态系统已避让=12 兜底；其余=max(env,12)。
  // force 时 resStand=false → forced 设备（如 14 Pro/26.6 sbTop≈73）不再被
  // expect=12+60 误判「顶部双倍避让」；#719 e2e=自动避让估式自身。
  const expTop = resStand ? 12 : (e2eBrowser ? safeTop : Math.max(envTop, 12));
  // #537：iOS 独立应用·覆盖形态（非保留/非 iPad/非 force 的 standalone + env∈[20,160]；
  // 16Pro/26.1、17/26.6 等实测均落此支）= 执行器要让模拟状态栏自身抬升到系统状态栏下方
  // （base.css html.ios-cover-top 规则消费）+ 非全屏高度须含顶部安全区（expBase=整屏）。
  // 此前该形态在 CSS 侧完全无人避让——浏览器覆盖壳有 #199/#236 的 mochi-cover-top、
  // 全屏态有 ios-fs-active 链，唯独「普通态 standalone 覆盖」缺一条，Mochi 行常驻钻进
  // 系统状态栏（用户报「整页上移」时诊断同步 ✗顶部重叠）。保留/已避让/IPad/force
  // 各形态恒 false（各自避让链已在），非 standalone 恒 false（浏览器壳走 coverBrowser）。
  const iosCover = standalone && !forceCover && !resStand && !ipadForm && envTop >= 20 && envTop <= 160;
  const form = forceCover ? 'force-cover' : resStand ? 'reserved' : ipadForm ? 'ipad'
    : coverBrowser ? 'cover-browser' : e2eBrowser ? 'e2e-browser'
    : (envTop >= 20 ? 'covered' : (diff >= 20 ? 'avoided' : 'plain'));
  return { form: form, resStand: resStand, ipadForm: ipadForm, coverBrowser: coverBrowser,
    forceCover: forceCover, iosCover: iosCover, needEnvProbe: needEnvProbe, safeTop: safeTop,
    // #719：e2e 底部避让估式（手势条高 16/z，钳 [12,28]）——安卓执行器
    // syncSafeBottomA 键盘收起回落时消费；非 e2e 恒 0（零回归）。
    safeBottom: e2eBrowser ? Math.min(28, Math.max(12, Math.round(e2eZ > 0 ? 16 / e2eZ : 16))) : 0,
    e2eBrowser: e2eBrowser,
    expBase: expBase, expTop: expTop, envTop: envTop, diff: diff,
    standalone: standalone, iosMajor: iosMajor };
};

// ===== 功能：屏幕适配诊断（v3.26.x #175，与【信息诊断】分开） =====
// 跨设备 iOS 屏幕适配问题（#114 顶部重叠 / #148 双倍避让+底部裁切 / #174 缩放异常）
// 反复以不同形态出现，靠用户口述+通用诊断很难精准定位。本工具专项采集屏幕适配的
// 实测数据并自动判定，每条结论带 ✗/✓ 与对应修复条目号，发给开发者即可精准对号。
// 采集全部走只读探测（不写任何状态），判定器 screenDiagJudge 为纯函数可单测。
(function () {
  // 开屏版本缓存（IIFE 执行时 splash-ver 仍在 DOM；verCache 在诊断模块作用域拿不到）
  let sdVerCache = '';
  try {
    const _sv = document.getElementById('splash-ver');
    if (_sv) {
      const _vb = _sv.querySelector('.sv-app b');
      const _vt = (_vb && _vb.textContent ? String(_vb.textContent).trim() : '') || (_sv.getAttribute('data-version') || '');
      const _ts2 = _sv.getAttribute('data-build-ts');
      sdVerCache = _vt + (_ts2 ? ' 构建 ts=' + _ts2 : '');
    }
  } catch (e0) {}
  // 模块内自含 toast/复制（diagToast/copyText 在诊断模块作用域，跨 IIFE 不可见）
  function sdToast(msg) {
    try {
      let el = document.getElementById('cc-toast');
      if (!el) { el = document.createElement('div'); el.id = 'cc-toast'; document.body.appendChild(el); }
      el.textContent = msg;
      el.className = 'cc-toast'; void el.offsetWidth; el.className = 'cc-toast show';
      clearTimeout(sdToast._t);
      sdToast._t = setTimeout(function () { el.className = 'cc-toast'; }, 2600);
    } catch (e) {}
  }
  function sdCopy(text) {
    return new Promise(function (resolve) {
      let done = false;
      const fin = function (ok) { if (!done) { done = true; resolve(ok); } };
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
        document.body.appendChild(ta);
        try { ta.select(); } catch (e1) {}
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        window.mochiKillCopySelection && window.mochiKillCopySelection(ta);   // #261：见 copyText 同款说明（防孤儿选区卡住原生全选条）
        setTimeout(function () { try { document.body.removeChild(ta); } catch (e3) {} }, 800);
        if (ok) { fin(true); return; }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { fin(true); }).catch(function () { fin(false); });
          } else fin(false);
        } catch (e4) { fin(false); }
        setTimeout(function () { fin(false); }, 1500);
      } catch (e5) { fin(false); }
    });
  }
  // 纯判定器：input 为采集好的实测值，返回 findings 数组（{ok,name,detail}）
  function screenDiagJudge(inp) {
    const F = [];
    const add = (ok, name, detail) => F.push({ ok: !!ok, name: name, detail: detail || '' });
    // ① 页面缩放：scale<0.95 = 页面被整体缩小（#174，顶部露白/UI 变小）
    add(inp.scale >= 0.95 || !inp.scale, '页面缩放 scale=' + (inp.scale || 1).toFixed(2),
      (inp.scale && inp.scale < 0.95) ? '✗ 页面被缩小（#174：meta minimum-scale=1 + 自愈应已恢复；若仍<0.95 请连本条反馈）' : '✓ 正常');
    // ② 顶部安全区三源 → 形态判定走共享判定器（#209 单一事实源，执行器 syncVvFit
    // 同源，新形态只改判定器一处）。force 现场由 collectFitInp 传入——#186 曾漏传，
    // 「用户已声明覆盖形态」分支在真实采集路径永不命中（死分支）
    const envTop = inp.envTop || 0;
    const varTop = inp.varTop || 0;
    const diff = inp.diff || 0;
    const Fm = window.mochiViewportForm({ standalone: !!inp.standalone, envTop: envTop, innerH: inp.innerH || 0, screenH: inp.screenH || 0, innerW: inp.innerW || 0, screenW: inp.screenW || 0, iosMajor: inp.iosMajor || 0, safMajor: inp.safMajor || 0, andr: !!inp.andr, safeTopForce: !!inp.force });
    // FIX 2026-09-20 #917：本机手调轴（设置·屏幕位置设置）——用户手动微调过的轴，
    // 几何本就【刻意】偏离自动期望，判定器必须同口径处理，否则每 5s 采集把「用户
    // 亲手调的值」当布局缺陷刷错误环（vivo X200S+Edge 实报：未调设备无此类条目，
    // 4 条 phone底=714/766 = inner∓26 恰为轴值，观感正常却报少填/超出/导航栏被裁）：
    // · shift（整体位移轴，.phone 相对 top 纯平移）→ 折算进底边期望；
    // · h（页面高度轴）→ 底边两项与全屏 ios-h 项跳过（各形态 CSS 的 min 钳制方向不同，
    //   正向可被钳成无效、负向才是实改高度，硬折算必有一头错）；
    // · top（顶部避让轴，其用途就是给用户加顶部留白）→ 不判「顶部双倍避让」。
    // 轴全 0（绝大多数用户，含所有真故障现场）时下述判式与修前逐字一致＝零回归。
    // 手调值与跳过原因都写进报告/快照/错误环（见 sdAdjStr），让下份报障能一眼分清
    // 「用户手调」与「真布局错」，不再靠反推。
    const adj = inp.adj || {};
    const adjShift = +adj.shift || 0;
    const adjH = +adj.h || 0;
    const adjTop = +adj.top || 0;
    let mode;
    if (Fm.forceCover) mode = '覆盖形态（用户已在设置声明：顶部避让修正开启，#186）';
    else if (Fm.resStand) mode = '系统保留形态（iOS 18.x standalone：系统已把网页起点放在状态栏下方，env 仍报真实高度；页面不再避让、高度贴 inner，#200）';
    else if (Fm.ipadForm) mode = 'iPad 形态（inner=屏高已含整屏，diff=0：状态栏悬浮、页面 padding 避让，高度贴 inner/屏高，#184）';
    else if (Fm.e2eBrowser) mode = 'edge-to-edge 浏览器形态（Android 15+：页面顶进系统状态栏/底入手势条而 env() 未报值，#719——已自动顶部避让 ' + Fm.safeTop + 'px/底部 ' + (Fm.safeBottom || 0) + 'px；仍偏请用 屏幕位置设置 五轴精调）';
    else if (envTop >= 20) mode = '覆盖形态（页面顶到屏幕最顶，系统栏悬浮其上）' + (Fm.coverBrowser ? '，浏览器覆盖壳（#199/#236：状态栏自身抬升、.phone 贴 inner）' : (Fm.iosCover ? '，独立应用覆盖（#537：.phone 铺满物理屏、状态栏自身抬升到系统栏下方、html/body 同高顶对齐）' : ''));
    else if (diff >= 20) mode = '已避让形态（系统已把网页起点放在状态栏下方，页面不应再加顶部 padding）';
    else mode = '无安全区/常规视口';
    add(true, '顶部形态判定：' + mode, 'env=' + envTop + 'px  var(--mochi-safe-top)=' + varTop + 'px  diff(screen−inner)=' + diff + 'px  判定器=' + Fm.form + '/safeTop=' + Fm.safeTop + '/期望底=' + Fm.expBase + (Fm.iosCover ? '/独立覆盖=1' : ''));
    // #210：保留/覆盖两形态 JS 信号相同（env≈diff>0）程序不可分——歧义形态时
    // 报告必须主动引导用户用【顶部避让修正】开关自服（否则全 ✓ 假象掩盖真症状：
    // iPhone 17 Pro 实测顶栏与灵动岛融合点不动/输入栏悬空，报告却全 ✓）
    if (Fm.resStand && !Fm.forceCover) add(true, '歧义形态提示：若顶部 Mochi 行与灵动岛/时间重叠或点不动 → 开启上方【顶部避让修正】开关（自动刷新即修）；若底部白带则保持关闭');
    // ③ 顶部双重叠加：statusbar 实测顶位显著超过「安全区顶部+余量」
    if (inp.sbTop == null) add(true, '状态栏隐藏（聊天等全屏页），跳过顶位判定');
    if (inp.sbTop != null) {
      const expect = Fm.expTop;
      // #236：浏览器覆盖形态 .statusbar 元素顶恒贴 .phone 顶（避让由状态栏自身
      // padding 承担、.phone 无 padding 兜底链），有效顶位=元素顶+实测 padding-top；
      // 其余形态沿用元素顶口径（含 .phone padding）零变化
      // #537：iOS 独立应用覆盖形态同款——.phone 铺满整块物理屏（顶=屏幕 0），避让
      // 改由 html.ios-cover-top 规则抬 .statusbar 自身 padding；仍按「元素顶」判会
      // 恒报 ✗顶部重叠（修好也红），故与浏览器壳一并取有效顶位；#719 e2e 同理
      // （mochi-cover-top 类已挂、避让在状态栏自身 padding）。
      const sbEffTop = (Fm.coverBrowser || Fm.iosCover || Fm.e2eBrowser) ? inp.sbTop + (parseFloat(inp.sbPadTop) || 0) : inp.sbTop;
      // #917：顶部避让轴非 0＝用户手动加过顶部留白（该轴唯一用途），有效顶位偏大是
      // 用户所求，不再判「双倍避让」；顶部重叠（顶位偏小）与手调方向相反，照常判。
      if (adjTop && sbEffTop > expect + 60) add(true, '顶部避让·已手动微调 top=' + adjTop + 'px', '跳过「顶部双倍避让」判定（该轴即用于手动加顶部留白；实测有效顶位 ' + sbEffTop + 'px / 自动期望 ' + expect + 'px，如需恢复自动判定请在 屏幕位置设置 里把「顶部避让」归零）');
      else if (sbEffTop > expect + 60) add(false, '顶部双倍避让', '✗ 状态栏实测顶位 ' + sbEffTop + 'px，明显超过安全区顶部 ' + expect + 'px（#148 修复的双倍白带形态复发，连本条反馈）');
      // v3.26.x #208：加 diff ≥ envTop−8 守卫——顶部重叠只在「覆盖形态」信号
      // （inner=screen−envTop）下才有意义；iPhone17 等保留形态设备在切后台回来
      // 瞬间 innerHeight 会被短暂报成整屏（diff=0），此瞬态 sbTop=12<57 会误报
      // 顶部重叠刷错误环（21:32 实采）；iPad 全屏态模拟状态栏 display:none
      // （sbTop=0）同理不再误报。真覆盖设备 diff≈envTop 守卫恒过，#114 检出不变。
      else if (!Fm.resStand && envTop >= 20 && diff >= envTop - 8 && sbEffTop < envTop - 5) add(false, '顶部重叠', '✗ 状态栏顶位 ' + sbEffTop + 'px 钻进系统状态栏区（应 ≥ ' + envTop + 'px，#114 形态）');
      else add(true, '状态栏顶位 ' + sbEffTop + 'px（安全区 ' + expect + 'px）');
    }
    // ④ 底部：期望底边 = envTop + innerH（覆盖形态=整屏 852；已避让形态=inner 812）
    // v3.26.x #199：浏览器覆盖形态（雨见/Via 等沉浸式安卓壳，standalone=false 且
    // diff(screen−inner)=0）例外——布局视口=inner，.phone 刻意只铺到 inner、内容在
    // 状态栏下方收缩避让（超出会造出文档滚动量=页面跳动），期望底边=inner。
    // 期望底边=共享判定器 expBase（#209）：保留/iPad/浏览器壳贴 inner（超 inner=
    // 文档滚动量=与自愈 pin 对打）；#186 force 声明=屏高（页面垫到状态栏下+高度补
    // 满，env=0 的 18.3 系统也按此渲染——原实现误写 innerH 与本注释矛盾，forced
    // 设备自检必误报底部超出）；覆盖形态=envTop+inner、min 屏高防异常超界（#184 起）
    const expBase = Fm.expBase;
    // FIX 2026-09-10 #282：安卓键盘停靠豁免（荣耀90GT+Edge150 诊断 v3.26.529 实报
    // 「底部少填 277px｜env=0 diff=181 inner=633 phone底=356」错误环多机型复发）。
    // resizes-visual 下键盘只缩可视视口（vv 633→356）、布局视口 inner 不动，.phone
    // 按设计停靠到键盘上沿=356——布局本身正确；但 ④/⑤b 只对照 inner 期望底，一采集
    // 就误报「少填/悬空」。sdTick 的输入焦点守卫只在打字期挡得住：Edge 收键盘后 vv
    // 读数残留（#236 同族）扩大失焦窗口，错误环照样入环。豁免判据沿用 #236 已验证
    // 的键盘下限：vv 缩幅 ≥ inner×22%（真键盘缩幅均 >200px，几十 px 只可能是壳残留
    // 带）＝键盘停靠期，④/⑤b 不判底（残留自愈由 syncAndroidKb #236/#267/#209 看门狗
    // 负责，诊断侧不再刷瞬态假错误）；#236 场景缩幅落在残留带（<22%）仍照常上报，
    // 不掩盖真残留。iOS 键盘 .phone 内联接管由 sdTick 焦点守卫挡，不经此门。
    const _kbShrink = inp.vvH > 0 ? inp.innerH - inp.vvH : 0;
    const _kbDocking = _kbShrink >= Math.round(inp.innerH * 0.22);
    // #528：桌面模拟器外壳豁免——宽屏（>900px 且未加 force-mobile）下 .phone 是「居中手机
    // 壳」：base.css 定高 min(844px, calc(100dvh - 48px))，body 上下 padding 各 24px 属既定
    // 设计；而 expBase 取 innerH，恒报「底部少填 ~24px 白带」（PC 用户每次自动采集刷错误环）。
    // 严格等 false（undefined 的旧调用/桩不受影响）；真机 mobile.isMobile 恒 true 不豁免。
    if (_kbDocking) add(true, '键盘停靠期，跳过底部判定（vv 缩 ' + _kbShrink + 'px，#282）');
    else if (inp.isMobileDev === false) add(true, '桌面模拟器外壳：.phone 居中手机壳（body 上下留白 24px 属设计），跳过底部贴合判定');
    // #917：页面高度轴非 0＝用户手动改过 .phone 高度（该轴唯一用途），底边本就随之
    // 平移；各形态 CSS 的 min(…,视口高) 钳制方向不同（安卓 ios-vv-fit 正向被钳成
    // 无效、iOS 独立应用正向实缩，iOS -26 走 min 钳不掉手调值），硬折算必有一头错，
    // 故跳过并把实测/期望/轴值一起如实写出，交由人工核对。
    else if (adjH) add(true, '底部·已手动微调 h=' + adjH + 'px，跳过贴合判定', '手调页面高度轴改变了 .phone 高（实测底 ' + inp.phoneBottom + 'px / 自动期望 ' + Math.round(expBase + adjShift) + 'px，差 ' + Math.round((inp.phoneBottom || 0) - expBase - adjShift) + 'px）；如需恢复自动判定请在 屏幕位置设置 里把「页面高度」归零');
    else if (inp.phoneBottom != null && inp.innerH) {
      const expB = expBase + adjShift;
      const under = Math.round(expB - inp.phoneBottom);
      const over = Math.round(inp.phoneBottom - expB);
      if (over > 2) add(false, '底部超出 ' + over + 'px', '✗ .phone 底边超出期望屏底（高度公式异常）' + (adjShift ? '（期望已按手动整体位移 shift=' + adjShift + 'px 折算）' : ''));
      else if (under > 2) add(false, '底部少填 ' + under + 'px 白带', '✗ ' + (Fm.coverBrowser ? '浏览器覆盖形态（#199/#236：避让由状态栏抬升与内容收缩承担，.phone 应铺到可视区底 ' + expB + 'px' : '覆盖形态（env-top=' + inp.envTop + '）下 .phone 应铺到 ' + expB + 'px（#179：高度须含顶部安全区 envTop+inner）') + '，实测只到 ' + inp.phoneBottom + 'px' + (adjShift ? '（期望已按手动整体位移 shift=' + adjShift + 'px 折算）' : ''));
      else add(true, '底部贴合（.phone 底=' + Math.round(inp.phoneBottom) + ' / 期望 ' + expB + (adjShift ? '，含手动 shift=' + adjShift + 'px' : '') + '）');
    }
    // ⑤ --mochi-ios-h 与可视高一致性（全屏态）
    if (inp.fsActive && adjH) {
      // #917：手调页面高度轴后该属性本就【刻意】偏离自动期望（属性值=基准+手调偏移），
      // 照旧判必报「与期望屏高不符」假错误——跳过并如实写出轴值与实测差。
      add(true, '--mochi-ios-h·已手动微调 h=' + adjH + 'px，跳过一致性判定', '手调页面高度轴会改变全屏页高度（实测 ios-h=' + (inp.iosH || '(未设)') + 'px / 自动期望 ' + Fm.expBase + 'px）；如需恢复自动判定请在 屏幕位置设置 里把「页面高度」归零');
    } else if (inp.fsActive) {
      const expH = Fm.expBase;
      if (inp.iosH && Math.abs(inp.iosH - expH) > 2) add(false, '--mochi-ios-h 与期望屏高不符', '⚠ ios-h=' + inp.iosH + 'px ≠ envTop+inner=' + expH + 'px（#179 公式：覆盖形态=整屏/已避让=inner）');
      else add(true, '--mochi-ios-h=' + (inp.iosH || '(未设→回落)') + ' 与期望屏高一致');
    }
    // ⑤b 底部导航栏裁切：tabbar 底边超出可视区（#282：键盘停靠期同 ④ 豁免；#528 桌面外壳同豁免）
    if (!_kbDocking && inp.isMobileDev !== false && adjH) {
      // #917：手调页面高度轴整块改变了 .phone 高，tabbar 随之整体抬升/压低——
      // 同 ④ 的取舍：跳过判定并写出轴值与实测（悬空/被裁由用户手调值决定）。
      add(true, '底部导航栏·已手动微调 h=' + adjH + 'px，跳过判定', '手调页面高度轴会整体抬升/压低 tabbar（实测底边 ' + inp.tabBottom + 'px / 自动期望 ' + Math.round(expBase - (inp.envBottom || 0) + adjShift) + 'px）');
    } else if (!_kbDocking && inp.isMobileDev !== false && inp.tabBottom != null && inp.innerH) {
      const expTB = expBase - (inp.envBottom || 0) + adjShift; // 期望底边=屏底−Home横条避让（#199：浏览器覆盖形态=可视区底）；#917：手调整体位移轴为纯平移，同口径折算
      const overB = Math.round(inp.tabBottom - expTB);
      if (overB > 2) add(false, '底部导航栏被裁 ' + overB + 'px', '✗ tabbar 底边 ' + inp.tabBottom + 'px 超出期望 ' + expTB + 'px（#148 同族）' + (adjShift ? '（期望已按手动整体位移 shift=' + adjShift + 'px 折算）' : ''));
      else if (overB < -60) add(false, '底部导航栏悬空 ' + (-overB) + 'px', '⚠ tabbar 底边比期望高 ' + (-overB) + 'px（底部空白过大）');
      else add(true, '底部导航栏完整（底边 ' + inp.tabBottom + ' / 期望 ' + expTB + '）');
    }
    // ⑤c 页面平移残留：vv offset 非 0 = 视口被顶偏（键盘/平移残留）
    if ((inp.vvOffTop || 0) > 2 || (Math.abs(inp.vvOffLeft || 0)) > 2) {
      add(false, '视口平移残留', '⚠ vv.offsetTop=' + inp.vvOffTop + ' offsetLeft=' + inp.vvOffLeft + '（页面被顶偏未归位，#109 形态）');
    }
    // ⑤d v3.26.x #208：布局视口未贴底（键盘收起未还原形态）——系统保留形态下
    // screen−inner 应≈envTop（网页起点垫在状态栏下方、布局视口直达物理屏底）。
    // diff 比 envTop 大出一截 = 布局视口还卡在收缩高度：iOS standalone 键盘收起
    // 后 WebKit 偶发不还原视口（多机型复发），.phone/聊天输入栏贴收缩值布局，
    // 底部露一条体底色白带、输入栏整体上移——此时④按 inner 判「底部贴合」会
    // 全绿漏报，故单列一条。键盘会话中（kbActive=true）布局视口本就收缩，属
    // 正常停靠，跳过。
    if (Fm.resStand && envTop >= 20 && diff > envTop + 24 && !(inp.kb && inp.kb.kbActive)) {
      add(false, '布局视口未贴底 ' + (diff - envTop) + 'px',
        '✗ screen−inner=' + diff + 'px 应≈状态栏高度 ' + envTop + 'px（#208：键盘收起后布局视口未还原，输入栏整体上移+底部白带；收起键盘或重开应用可临时恢复，复发请整段反馈）');
    }
    // ⑤e v3.27.x：.phone 停靠残留（#209 同族的对号条目——键盘停靠已结束而内联
    // height/alignSelf 未清=输入栏上移/下方灰边形态）。双端键盘探针均非活动、可视高
    // 也无收缩证据才判；安卓悬浮键盘推定停靠（prov）期间内联合法，计为键盘证据。
    // #209 看门狗 1s 内会自动清扫，5s 监视/手动诊断仍见即清理链断裂或看门狗未生效。
    if ((inp.phoneInlineH || inp.phoneAlignSelf) && inp.innerH) {
      const kbAnyAct = !!(inp.kb && inp.kb.kbActive) || !!(inp.kbAnd && (inp.kbAnd.kbActive || inp.kbAnd.prov));
      const vvShrunk = inp.vvH > 0 ? (inp.innerH - inp.vvH > 60) : false;
      if (!kbAnyAct && !vvShrunk) {
        add(false, '.phone 停靠残留',
          '✗ 内联 height=' + (inp.phoneInlineH || '(无)') + ' alignSelf=' + (inp.phoneAlignSelf || '(无)') + '，但键盘已非活动且可视高无收缩（#209：停靠残留=输入栏上移/下方灰边；正常 1s 内被看门狗清扫，持续存在请整段反馈）');
      }
    }
    // ⑤f v3.27.x：横向贴合（宽度轴此前零判定，#185 平板左右露白同族的对号条目）——
    // .phone 宽应铺满 min(inner,vv)，留 8px 缝差容忍；#187 起平板默认也全宽铺满
    // （无限宽豁免）。桌面 .phone 是居中手机壳属既定设计，非移动判定跳过。
    if (inp.phoneW != null && inp.isMobileDev && inp.innerW) {
      const expW = Math.min(inp.innerW, inp.vvW > 0 ? inp.vvW : inp.innerW);
      const underW = Math.round(expW - inp.phoneW);
      const overW = Math.round(inp.phoneW - expW);
      if (underW > 8) add(false, '左右露白 ' + underW + 'px', '✗ .phone 宽 ' + inp.phoneW + 'px < 期望 ' + expW + 'px（横向未铺满；#187 起平板也应全宽，旧版限宽居中请更新）');
      else if (overW > 8) add(false, '横向超出 ' + overW + 'px', '✗ .phone 宽 ' + inp.phoneW + 'px > 期望 ' + expW + 'px（横向溢出）');
      else add(true, '横向贴合（.phone 宽=' + inp.phoneW + ' / 期望 ' + expW + '）');
    }
    // ⑥ 关键类
    add(true, 'standalone=' + !!inp.standalone, inp.standalone ? '独立应用形态' : '浏览器形态（ios-pwa-standalone 不加为正常）');
    add(true, 'html 类：' + (inp.htmlClass || '(空)'));
    // ⑦ v3.26.x #212：全屏「页外 letterbox」盲区提示——挖孔屏安卓 Chromium 的
    // Fullscreen 默认 navigationUI:'auto' 不把全屏面铺到挖孔区，页面外系统层
    // letterbox 露一条空白，而页面坐标系内一切测量全 ✓（iQOO12 实证：诊断全绿
    // 但用户见顶带）。页内判定结构性测不到页外空白，只能引导：空白在挖孔/摄像
    // 头区（截图同样含）→ 关一次再开「全屏模式」重新申请（#212 已修 enterFs 带
    // navigationUI:'hide'，旧版更新后需重开一次生效）。仅全屏态且无其他 ✗ 时输
    // 出——已有 ✗ 时以 ✗ 条目为准，避免噪声。
    // v3.27.x：加 isAndroid 门控——该现象是安卓 Chromium 系统层行为，iOS 无原生
    // 全屏 API（走 .ios-fs-active 模拟），提示行对 iOS 用户纯噪声。
    if (inp.fsActive && inp.andr && !F.some(function (f) { return !f.ok; })) {
      add(true, '※ 全屏态·页外留白提示', '若用户仍见顶端/边缘空白条，且空白位于手机挖孔/摄像头区（页面内容之外、截图同样含），属系统 letterbox：请关一次再开「全屏模式」重新申请全屏（#212：更新到新版后需重开一次生效）；此空白在页面坐标系之外，本诊断结构性无法检测。');
    }
    return F;
  }
  let _sdEnvCache = -1, _sdEnvOri = ''; // #176：env 探针缓存（按横竖屏失效）
  function envTopProbe() {
    const ori = (window.innerWidth || 0) > (window.innerHeight || 0) ? 'h' : 'v';
    if (_sdEnvCache >= 0 && _sdEnvOri === ori) return _sdEnvCache;
    try {
      const p = document.createElement('div');
      p.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
      document.body.appendChild(p);
      const v = parseFloat(getComputedStyle(p).paddingTop) || 0;
      document.body.removeChild(p);
      _sdEnvCache = Math.round(v); _sdEnvOri = ori;
      return _sdEnvCache;
    } catch (e) { return 0; }
  }
  function envBottomProbe() {
    try {
      const p = document.createElement('div');
      p.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;';
      document.body.appendChild(p);
      const v = parseFloat(getComputedStyle(p).paddingBottom) || 0;
      document.body.removeChild(p);
      return Math.round(v);
    } catch (e) { return 0; }
  }
  function collectFitInp() {
    const d = document.documentElement;
    const ph = document.querySelector('.phone');
    const sb = document.querySelector('.statusbar');
    const vv = window.visualViewport;
    const cs = ph ? getComputedStyle(ph) : null;
    const pr = ph ? ph.getBoundingClientRect() : null;
    const pr2 = pr; // .phone rect（状态栏位置改为相对 .phone 测量，文档滚动不影响）
    const sbHidden = (function () { try { return !sb || sb.getBoundingClientRect().width === 0; } catch (e) { return true; } })();
    const sr = (!sbHidden && pr) ? sb.getBoundingClientRect() : null;
    const sbCs = sb ? getComputedStyle(sb) : null;
    const inp = {
      scale: vv ? +vv.scale.toFixed(2) : 1,
      innerW: window.innerWidth || 0,
      innerH: window.innerHeight || 0,
      screenW: (window.screen && window.screen.width) || 0,
      screenH: (window.screen && window.screen.height) || 0,
      vvW: vv ? Math.round(vv.width) : 0,
      vvH: vv ? Math.round(vv.height) : 0,
      dpr: window.devicePixelRatio || 0,
      envTop: envTopProbe(),
      varTop: parseInt(d.style.getPropertyValue('--mochi-safe-top')) || 0,
      iosH: parseInt(d.style.getPropertyValue('--mochi-ios-h')) || 0,
      standalone: d.classList.contains('ios-pwa-standalone'),
      fsActive: d.classList.contains('ios-fs-active') || d.classList.contains('fs-active') || d.classList.contains('fs-css-active'),
      htmlClass: d.className || '(空)',
      phoneH: cs ? parseInt(cs.height) || 0 : 0,
      phonePadTop: cs ? cs.paddingTop : '?',
      phoneBottom: pr ? Math.round(pr.bottom) : null,
      sbTop: (sr && pr) ? Math.round(sr.top - pr.top) : null, // 相对 .phone 顶（=padding 实测），滚动免疫
      sbPadTop: sbCs ? sbCs.paddingTop : '?',
      orientation: (window.innerWidth || 0) > (window.innerHeight || 0) ? '横屏' : '竖屏',
      envBottom: envBottomProbe(),
      vvOffTop: vv ? Math.round(vv.offsetTop) : 0,
      vvOffLeft: vv ? Math.round(vv.offsetLeft) : 0,
      // v3.27.x：⑤f 横向贴合 + ⑤e 停靠残留判定的信号——宽度轴此前零判定（#185
      // 平板左右露白族无对号条目），停靠残留此前只有执行器侧看门狗在修、诊断无条目
      phoneW: pr ? Math.round(pr.width) : null,
      phoneInlineH: ph ? (ph.style.height || '') : '',
      phoneAlignSelf: ph ? (ph.style.alignSelf || '') : '',
      tablet: d.classList.contains('tablet'),
      isMobileDev: (function () { try { return !!(window.mochiDevice && window.mochiDevice.isMobile); } catch (e) { return false; } })(),
      andr: (function () { try { return !!(window.mochiDevice && window.mochiDevice.isAndroid); } catch (e) { return false; } })(),
      kbAnd: (function () { try { var k2 = window.__mochiAndroidKb ? window.__mochiAndroidKb() : null; return k2 ? { kbActive: !!k2.kbActive, prov: !!k2.prov } : null; } catch (e) { return null; } })(),
      // v3.26.x #208：全屏页（聊天/朋友圈等 .page.full）打开时 tabs.js 给 .tabbar
      // 挂 hidden（display:none）——矩形全 0，原样返回会判「底部导航栏悬空
      // 860px」：用户在聊天页期间每 5s 自动采集刷一条假错误进错误环（实测
      // 21:32~21:37 连环五条误报）。hidden/零矩形 → null，判定器 ⑤b 跳过。
      tabBottom: (function () { var tb = document.querySelector('.tabbar'); if (!tb || tb.hidden) return null; var r = tb.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return null; return Math.round(r.bottom); })(),
      kb: (function () { try { return window.__mochiIosKb ? window.__mochiIosKb() : null; } catch (e) { return null; } })()
    };
    inp.diff = inp.screenH && inp.innerH ? inp.screenH - inp.innerH : 0;
    // #214：页面专项采集（聊天/主页——问题集中地，用户点名）
    try {
      var _chatPg = document.getElementById('page-chat');
      var _cBody = document.getElementById('chat-body');
      var _cRow = document.querySelector('#page-chat .chat-input-row');
      var _cRowR = _cRow ? _cRow.getBoundingClientRect() : null;
      inp.chat = { visible: !!(_chatPg && !_chatPg.hidden),
        msgs: _cBody ? _cBody.children.length : -1,
        bodySH: _cBody ? _cBody.scrollHeight : 0, bodyCH: _cBody ? _cBody.clientHeight : 0,
        inputBottom: _cRowR ? Math.round(_cRowR.bottom) : null,
        inputW: _cRowR ? Math.round(_cRowR.width) : 0 };
      // #216：键盘期专项——键盘高度(基线−vv)与输入栏底边，是「聊天界面上移/输入栏
      // 被盖」的直接定位数据；键盘收起时 kbActive=false 不采集
      var _kbSt = null;
      try { _kbSt = window.__mochiIosKb ? window.__mochiIosKb() : null; } catch (eK0) {}
      inp.chat.kbActive = !!( _kbSt && _kbSt.kbActive);
      inp.chat.kbH = _kbSt && _kbSt.kbActive ? Math.max(0, (_kbSt.fullInner || window.innerHeight || 0) - (inp.vvH || 0)) : 0;
      inp.chat.inputBottomKb = (_cRowR && inp.chat.kbActive) ? Math.round(_cRowR.bottom) : null;
    } catch (eC1) {}
    try {
      var _pool = document.getElementById('desk-widget-pool');
      var _poolNodes = _pool ? _pool.querySelectorAll('[data-desk-widget]') : [];
      var _tabR = document.querySelector('.tabbar');
      var _tabRR = _tabR ? _tabR.getBoundingClientRect() : null;
      inp.home = { visible: !!(document.getElementById('page-phone') && !document.getElementById('page-phone').hidden),
        slides: document.querySelectorAll('#desktop-pages .page-slide').length,
        apps: document.querySelectorAll('#desktop-pages .app').length,
        poolN: _poolNodes.length,
        poolNames: (function () { var a = []; _poolNodes.forEach(function (n) { a.push(n.getAttribute('data-desk-widget')); }); return a.join(','); })(),
        tabBottom: _tabRR ? Math.round(_tabRR.bottom) : null };
    } catch (eC2) {}
    inp.iosMajor = (function () { try { var a = /OS (\d+)_/.exec(navigator.userAgent || ''); var b = /Version\/(\d+)\./.exec(navigator.userAgent || ''); return Math.max(a ? +a[1] : 0, b ? +b[1] : 0); } catch (e) { return 0; } })();
    inp.safMajor = (function () { try { var m = /Version\/(\d+)\./.exec(navigator.userAgent || ''); return m ? +m[1] : 0; } catch (e) { return 0; } })();
    inp.osLine = (function () { try { var m1 = /iPhone OS (\d+_\d+(?:_\d+)?) like/.exec(navigator.userAgent || ''); var m2 = /Version\/(\d+\.\d+)/.exec(navigator.userAgent || ''); return 'iOS ' + (m1 ? m1[1].replace(/_/g, '.') : '?') + ' / Safari ' + (m2 ? m2[1] : '?'); } catch (e) { return '未知'; } })();
    // #209：用户「顶部避让修正」声明（#186：声明=覆盖形态）——此前漏传，判定器
    // force 分支在真实采集路径永不命中
    inp.force = (function () { try { return localStorage.getItem('xy-home-v2:__safe-top-force') === '1'; } catch (e) { return false; } })();
    // FIX 2026-09-20 #917：本机手调轴实测（设置·屏幕位置设置，mobile-adapt.js
    // mochiScreenAdj）——七轴都是「用户亲手把几何调离自动期望」的量，判定器必须
    // 同口径折算/豁免，否则每 5s 自动采集把用户自己调的值当布局缺陷刷错误环
    //（vivo X200S+Edge 实报 4 条：phone底=714/766 = inner∓26 恰为手调值）。
    // 只读探测，mochiScreenAdj 缺位（旧产物/未接入）全 0＝判定器行为与修前逐字一致。
    inp.adj = (function () {
      try {
        const a = window.mochiScreenAdj && window.mochiScreenAdj.all();
        if (!a) return null;
        return { top: +a.top || 0, bottom: +a.bottom || 0, h: +a.h || 0, desk: +a.desk || 0,
          shift: +a.shift || 0, text: +a.text || 0, side: +a.side || 0 };
      } catch (e) { return null; }
    })();

    // #215：历史对比键别名（快照存 ori/fs，采集器字段是 orientation/fsActive）
    inp.ori = inp.orientation;
    inp.fs = inp.fsActive;
    return inp;
  }
  function collectScreenDiag(remoteTs) {
    const inp = collectFitInp();
    const F = screenDiagJudge(inp);
    const L = [];
    L.push('【屏幕适配诊断】' + (sdVerCache || '(版本未采集)'));
    L.push('时间：' + new Date().toLocaleString());
    // v3.27.x：版本链路比对（仅手动诊断传入 remoteTs 时输出；自动监视 undefined
    // 跳过不拉网络）——#215 实锤「存量旧版未送达修复」是症状大半来源，先更新再测
    if (remoteTs !== undefined) {
      const lm = /ts=(\d+)/.exec(sdVerCache || '');
      const lts = lm ? +lm[1] : 0;
      if (remoteTs && lts && remoteTs > lts + 60000) L.push('⚠ 版本链路：远端比本机新（远端 ts=' + remoteTs + ' / 本机 ts=' + lts + '）——建议先更新再测，症状可能已在新版修复');
      else if (remoteTs && lts) L.push('版本链路：本机已是最新（ts=' + lts + '）');
      else L.push('版本链路：无法比对（远端获取失败或本机 ts 未采集）');
    }
    L.push('');
    L.push('== 基础 ==');
    L.push('屏幕=' + inp.screenW + '×' + inp.screenH + '  DPR=' + inp.dpr);
    L.push('布局视口(inner)=' + inp.innerW + '×' + inp.innerH + '  可视(vv)=' + inp.vvW + '×' + inp.vvH + ' @scale=' + inp.scale.toFixed(2));
    L.push('standalone=' + !!inp.standalone + '  全屏模式=' + (inp.fsActive ? '开' : '关') + '  方向=' + (inp.orientation || '?') + '（旋转后建议再测一次）');
    L.push('html类：' + inp.htmlClass);
    L.push('系统=' + (inp.osLine || '未知') + '（形态判定依赖系统版本，#184/#200）');
    L.push('env(safe-area-inset-bottom)=' + inp.envBottom + 'px  视口平移=offTop:' + (inp.vvOffTop || 0) + '/offLeft:' + (inp.vvOffLeft || 0));
    // FIX 2026-09-20 #917：本机手调轴（屏幕位置设置）如实写出——判定器对非 0 轴折算/跳过，
    // 报告必须自证「哪条判定为何跳过、跳过的量与手调值什么关系」，否则下一份报障又得反推
    //（本次 vivo 报障就是吃了这个亏：phone底=inner∓26 到底是手调还是真故障，无从判断）。
    L.push('本机手调（屏幕位置设置）：' + (sdAdjStr(inp.adj) || '无（七轴全 0，判定器全自动口径）'));
    L.push('键盘残留=' + (inp.kb ? ('kbActive=' + !!inp.kb.kbActive + ' 锁=' + !!inp.kb.docLocked + ' 基线 inner/vv=' + inp.kb.fullInner + '/' + inp.kb.fullVv) : 'n/a')
      + '  --mochi-safe-bottom=' + (function () { try { var _v = getComputedStyle(document.documentElement).getPropertyValue('--mochi-safe-bottom').trim(); return _v ? _v + 'px' : '(未设/回落 ' + inp.envBottom + 'px)'; } catch (e) { return '?'; } })());
    L.push('');
    L.push('== 顶部安全区 ==');
    L.push('env(safe-area-inset-top)=' + inp.envTop + 'px  --mochi-safe-top=' + inp.varTop + 'px  diff(screen−inner)=' + inp.diff + 'px');
    L.push('');
    L.push('== 实测 ==');
    L.push('.phone：计算高=' + inp.phoneH + 'px  padding-top=' + inp.phonePadTop + '  底边=' + inp.phoneBottom + 'px');
    L.push('.statusbar：padding-top=' + inp.sbPadTop + '  顶位=' + inp.sbTop + 'px');
    L.push('.tabbar：底边=' + (inp.tabBottom != null ? inp.tabBottom + 'px' : 'n/a') + '（可视 ' + inp.innerH + '）');
    // v3.26.x #214：页面专项（用户点名聊天/主页两处问题集中地）
    try {
      const c = inp.chat || {};
      L.push('');
      L.push('== 聊天页 ==');
      L.push('可见=' + (c.visible ? '是' : '否（当前不在聊天页，下列为容器实测）') + '  消息节点=' + c.msgs + '  内容高/可视=' + c.bodySH + '/' + c.bodyCH);
      L.push('输入栏：底边=' + (c.inputBottom != null ? c.inputBottom + 'px' : 'n/a') + ' / 宽=' + c.inputW + 'px（可视底 ' + inp.innerH + 'px）');
      if (c.kbActive) L.push('键盘期：键盘高度≈' + c.kbH + 'px  输入栏底边=' + (c.inputBottomKb != null ? c.inputBottomKb + 'px' : '?') + '（应 ≤ 键盘上沿）');
      if (c.visible && c.inputBottom != null && !c.kbActive) {
        const gapB = inp.innerH - c.inputBottom;
        if (gapB > 4) L.push('⚠ 聊天输入栏未贴底：底边距可视区底 ' + gapB + 'px（键盘已收；反复出现请整段反馈）');
        else if (gapB < -4) L.push('⚠ 聊天输入栏超出可视区 ' + (-gapB) + 'px');
        else L.push('输入栏贴底 ✓');
      }
      // v3.30 定位增强：安卓端 __mochiIosKb 恒空 → kbActive 恒假，上面「键盘期/gapB」两条
      // 对安卓全 n/a，键盘弹起的「输入栏悬空」拿不到现场（用户 vivo iQOO15+Edge 实报）。
      // 此处不看内部键盘标志，直接以可视底(vv)对照实际输入栏：vv 显著小于 inner（键盘在
      // 场的可视证据）且输入栏底离 vv 底过大 → 精确报悬空量 + safe-bottom 现值。纯诊断
      // 输出，不涉检测/布局，零机型分支（跨安卓/iOS 统一语义）。
      if (c.inputBottom != null && inp.vvH > 0 && inp.innerH - inp.vvH >= 24) {
        const _gapV = inp.vvH - c.inputBottom;
        L.push('键盘可视态：vv 较布局内缩 ' + (inp.innerH - inp.vvH) + 'px  输入栏底距可视底=' + _gapV + 'px（阈值 ≤24px）');
        if (_gapV > 24) L.push('  ✗ 输入栏悬空 ' + _gapV + 'px：未贴键盘（#282/#236 族：键盘检测未置位或 --mochi-safe-bottom/.phone 收缩未归零——请整段反馈即可对号修）');
        else L.push('  贴可视底 ✓（≤24px）');
      }
    } catch (eR1) {}
    try {
      const h = inp.home || {};
      L.push('');
      L.push('== 主页 ==');
      L.push('页数=' + h.slides + '  桌面图标=' + h.apps + '  池内组件=' + h.poolN + (h.poolN > 0 ? '（' + h.poolNames + '——桌面缺组件即在此处，装修模式可加回）' : ''));
      L.push('tabbar：底边=' + (h.tabBottom != null ? h.tabBottom + 'px' : 'n/a'));
    } catch (eR2) {}
    L.push('');
    L.push('== 自动判定 ==');
    F.forEach(f => L.push((f.ok ? '✓ ' : '✗ ') + f.name + (f.detail ? '\n    ' + f.detail : '')));
    // v3.27.x：机读签名行——用户整段复制，开发者可脚本解析对号/录 verify 台账；
    // 键序固定勿动（下游脚本按名取值）
    let sigForm = '';
    try { sigForm = (window.mochiViewportForm({ standalone: !!inp.standalone, envTop: inp.envTop, innerH: inp.innerH, screenH: inp.screenH, innerW: inp.innerW || 0, screenW: inp.screenW || 0, iosMajor: inp.iosMajor, safMajor: inp.safMajor || 0, andr: !!inp.andr, safeTopForce: !!inp.force }) || {}).form || ''; } catch (eS) {}
    const sig = { v: sdVerCache, form: sigForm, scale: inp.scale, env: inp.envTop, varTop: inp.varTop, diff: inp.diff, innerW: inp.innerW, innerH: inp.innerH, vvH: inp.vvH, screenH: inp.screenH, phoneW: inp.phoneW, phoneH: inp.phoneH, phoneBottom: inp.phoneBottom, sb: inp.sbTop, tab: inp.tabBottom, iosH: inp.iosH, dpr: inp.dpr, standalone: !!inp.standalone, fs: !!inp.fsActive, andr: !!inp.andr, tablet: !!inp.tablet, ori: inp.orientation, bad: F.filter(function (f) { return !f.ok; }).map(function (f) { return f.name; }) };
    L.push('SIG ' + JSON.stringify(sig));
    L.push('');
    L.push('※ 发给开发者时请整段复制（含 ✗ 条目），可精准对号修复。');
    try {
      if (window.__mochiVvTimeline) {
        L.push('');
        L.push('== 近 60 秒视口时间线（键盘开合/缩放/白带瞬态回放）==');
        L.push(window.__mochiVvTimeline());
      }
    } catch (eT) {}
    return { text: L.join('\n'), findings: F, inp: inp };
  }
  function bindScreenDiag() {
    const row = document.getElementById('row-screen-diag');
    if (!row) return;
    // v3.27.x：手动诊断前先拉一次远端 version.json（2.5s 超时，失败不阻塞采集），
    // 供「先更新再测」版本链路比对
    function sdRemoteTs() {
      return new Promise(function (res) {
        let done = false;
        const fin = function (v) { if (!done) { done = true; res(v); } };
        try {
          fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r2) {
            if (!r2 || !r2.ok) return fin(null);
            return r2.json().then(function (j) { var t = Number(j && j.ts); fin(t > 0 ? t : null); }).catch(function () { fin(null); });
          }).catch(function () { fin(null); });
        } catch (e1) { fin(null); }
        try { setTimeout(function () { fin(null); }, 2500); } catch (e2) {}
      });
    }
    row.addEventListener('click', function () {
      sdToast('正在采集屏幕适配数据…');
      const t0 = Date.now();
      sdRemoteTs().then(function (remoteTs) {
        setTimeout(function () {
          let r = null;
          try { r = collectScreenDiag(remoteTs); } catch (e) { r = null; }
          if (!r) { sdToast('采集失败'); return; }
          // #176：本次快照存档（trig=manual），报告末尾附与上次的历史对比
          // #209：附全部历史快照时间线（✗ 事件带信号数值）——用户报障常在事发后很久，
          // 自动监视存下的「出问题那一刻」直接随报告带出，不用复现
          r.text += '\n== 历史对比 ==\n' + sdHistCompare(r.inp);
          r.text += '\n' + sdHistTimeline();
          sdArchive(r, 'manual');
          if (window.openModal) {
            // #227：补「导出docx」按钮——此前本弹窗只有自动复制，报告长时手机剪贴板
            // 可能截断，走文件转发最稳（docx 用 Word/WPS 打开不乱码）
            // #794：诊断→修正闭环——报告弹窗带「一键修正」（有可修项才显示），
            // 点了直接写入对应轴，用户不用再拿着报告去微调面板逐根对滑杆
            const sdFix = screenFixCalc(r.inp);
            window.openModal('屏幕适配诊断', r.text, null, {
              noInput: true, textarea: true, textareaRows: 16, big: true,
              extraBtn: sdFix.length ? {
                label: '一键修正',
                fn: function () {
                  let n = 0;
                  sdFix.forEach(function (s) { try { if (window.mochiScreenAdj && window.mochiScreenAdj.set(s.axis, s.delta)) n++; } catch (e3) {} });
                  sdToast(n ? ('已按诊断应用 ' + n + ' 项修正（个别项需刷新一次生效）') : '没有可应用的修正（对应轴已手动调过）');
                }
              } : null,
              exportBtn: {
                label: '导出docx',
                fn: function (c) {
                  // #333：三级降级链（分享面板→保存框→确认下载），裸下载只作兜底。
                  // #382：diagExportDocx 在主诊断闭包里、本闭包不可见，跨闭包必须走 window 挂载；
                  // 此前直接引用恒 ReferenceError 被吞＝点导出毫无反应（多机型必现）。
                  (window.mochiDiagExportDocx || function () {})(c ? c.text() : r.text, 'mochi-screen-diag-',
                    '当前内核不支持下载，请长按报告手动复制。', sdToast);
                }
              }
            });
          }
          sdCopy(r.text).then(function (ok) { sdToast(ok ? '报告已复制到剪贴板，可直接发给开发者' : '报告已弹出，请手动全选复制'); });
        }, Math.max(0, 60 - (Date.now() - t0)));
      });
    });
  }
  // ===== v3.27.x #794：诊断→修正闭环 =====
  // 把判定器 ✗ 条目折算成 mochiScreenAdj 轴值建议（与 screenDiagJudge 同阈值同豁免：
  // 键盘停靠期/桌面外壳不判底、resStand 不判顶、已手动调过的轴跳过）。只读计算，
  // 应用与否交给调用方——诊断报告「一键修正」按钮、屏幕适配微调面板顶部的建议行。
  function screenFixCalc(inp) {
    const out = [];
    try {
      const Fm = window.mochiViewportForm({ standalone: !!inp.standalone, envTop: inp.envTop, innerH: inp.innerH, screenH: inp.screenH, innerW: inp.innerW || 0, screenW: inp.screenW || 0, iosMajor: inp.iosMajor || 0, safMajor: inp.safMajor || 0, andr: !!inp.andr, safeTopForce: !!inp.force }) || {};
      const cur = (window.mochiScreenAdj && window.mochiScreenAdj.all()) || {};
      // 顶部：状态栏有效顶位（浏览器壳/独立覆盖/e2e 形态含状态栏自身 padding，与判定器 ③ 同口径）
      const sbEffTop = (Fm.coverBrowser || Fm.iosCover || Fm.e2eBrowser) ? inp.sbTop + (parseFloat(inp.sbPadTop) || 0) : inp.sbTop;
      if (inp.sbTop != null && cur.top === 0) {
        if (!Fm.resStand && inp.envTop >= 20 && inp.diff >= inp.envTop - 8 && sbEffTop < inp.envTop - 5) {
          out.push({ axis: 'top', delta: Math.min(80, Math.round(inp.envTop - sbEffTop)), why: '顶部重叠 ' + Math.round(inp.envTop - sbEffTop) + 'px' });
        } else if (sbEffTop > Fm.expTop + 60) {
          out.push({ axis: 'top', delta: Math.max(-80, -Math.round(sbEffTop - Fm.expTop)), why: '顶部双倍避让 ' + Math.round(sbEffTop - Fm.expTop) + 'px' });
        }
      }
      // 底部：键盘停靠期（#282）/桌面模拟器外壳（#528）豁免，与判定器 ④/⑤b 同口径
      const kbShrink = inp.vvH > 0 ? inp.innerH - inp.vvH : 0;
      const kbDocking = kbShrink >= Math.round(inp.innerH * 0.22);
      if (!kbDocking && inp.isMobileDev !== false) {
        if (inp.phoneBottom != null && inp.innerH && cur.h === 0) {
          const under = Math.round(Fm.expBase - inp.phoneBottom);
          if (under > 2) out.push({ axis: 'h', delta: Math.min(80, under), why: '底部少填 ' + under + 'px 白带' });
          else if (under < -2) out.push({ axis: 'h', delta: Math.max(-80, under), why: '底部超出 ' + (-under) + 'px' });
        }
        if (inp.tabBottom != null && inp.innerH && cur.bottom === 0) {
          const overB = Math.round(inp.tabBottom - (Fm.expBase - (inp.envBottom || 0)));
          if (overB > 2) out.push({ axis: 'bottom', delta: Math.min(80, overB), why: '底部导航栏被裁 ' + overB + 'px' });
          else if (overB < -60) out.push({ axis: 'bottom', delta: Math.max(-80, overB), why: '底部导航栏悬空 ' + (-overB) + 'px' });
        }
      }
    } catch (e) {}
    return out;
  }
  // 跨闭包暴露：personalize.js 屏幕适配微调面板打开时现场探测一次（只读，毫秒级）
  window.mochiScreenFixSuggest = function () {
    try { return screenFixCalc(collectFitInp()); } catch (e) { return []; }
  };
  // ===== #176：快照存档 + 常驻监视 + 异常形态自动上报 =====
  // 历史快照：手动诊断/监视捕获各存一份（上限 8 份），报告末尾自动与上一次对比，
  // 哪项数值变了直接列出——『正常时 vs 异常时』不用再靠记忆。
  // #185：顶部避让修正开关（读存 xy-home-v2:__safe-top-force；改后刷新生效）
  function bindSafeTopForce() {
    const el = document.getElementById('safe-top-force');
    if (!el) return;
    try { el.checked = localStorage.getItem('xy-home-v2:__safe-top-force') === '1'; } catch (e) {}
    el.addEventListener('change', function () {
      try {
        if (el.checked) localStorage.setItem('xy-home-v2:__safe-top-force', '1');
        else localStorage.removeItem('xy-home-v2:__safe-top-force');
      } catch (e1) {}
      setTimeout(function () { try { location.reload(); } catch (e2) {} }, 300);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindSafeTopForce);
  else bindSafeTopForce();
  // 常驻监视：每 5s 轻量采集一次（仅可见时），判定出现 ✗ 且形态签名与上次不同
  // （状态变化沿）才存档 + 静默写错误环形缓冲（信息诊断『最近错误』可直读），
  // 持续坏不刷屏、用户不用手发。
  const SD_HIST_KEY = 'xy-home-v2:screen-diag-hist';
  const SD_ERR_KEY = 'xy-home-v2:__diag-errs'; // 与诊断模块错误环同键同格式
  const SD_HIST_CAP = 8;
  function sdHistLoad() {
    try { const a = JSON.parse(localStorage.getItem(SD_HIST_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function sdHistSave(list) {
    try {
      // v3.27.x：分级保留——坏快照（有 ✗）稀少且珍贵，纯 FIFO 会被后续好快照顶没
      //（#209 K70：坏现场就一份）；坏/好各保底留最近 4 条，按时间排序落盘
      const bads = list.filter(function (s) { return s.bad && s.bad.length; }).slice(-4);
      const goods = list.filter(function (s) { return !(s.bad && s.bad.length); }).slice(-4);
      localStorage.setItem(SD_HIST_KEY, JSON.stringify(bads.concat(goods).sort(function (a, b) { return a.t - b.t; })));
    } catch (e) {}
  }
  // #917：手调轴串（快照/错误环/报告共用）——轴全 0 返回空串，调用处据此不显示
  function sdAdjStr(a) {
    if (!a) return '';
    const ks = ['top', 'bottom', 'h', 'desk', 'shift', 'text', 'side'], out = [];
    for (let i = 0; i < ks.length; i++) { const v = +a[ks[i]] || 0; if (v) out.push(ks[i] + (v > 0 ? '+' : '') + v); }
    return out.join(' ');
  }
  function sdSnapOf(r, trig) {
    const i = r.inp;
    return { t: Date.now(), trig: trig,
      bad: r.findings.filter(function (f) { return !f.ok; }).map(function (f) { return f.name.split(' ')[0]; }),
      adj: sdAdjStr(i.adj),
      scale: i.scale, envTop: i.envTop, varTop: i.varTop, diff: i.diff,
      screenH: i.screenH, vvH: i.vvH, standalone: !!i.standalone, force: !!i.force,
      innerW: i.innerW, innerH: i.innerH, phoneH: i.phoneH, phonePadTop: i.phonePadTop,
      phoneW: i.phoneW, inlineH: i.phoneInlineH, aself: i.phoneAlignSelf,
      phoneBottom: i.phoneBottom, sbTop: i.sbTop, tabBottom: i.tabBottom, iosH: i.iosH,
      ori: i.orientation, fs: !!i.fsActive };
  }
  function sdArchive(r, trig) {
    try { const list = sdHistLoad(); list.push(sdSnapOf(r, trig)); sdHistSave(list); } catch (e) {}
  }
  function sdHistCompare(cur) {
    const list = sdHistLoad();
    if (!list.length) return '（无历史快照，本次已存档 baseline）';
    const prev = list[list.length - 1];
    // 快照键 → 采集键映射（ori/fs 在采集器里叫 orientation/fsActive，名字不同）
    const PAIRS = [['scale','scale'],['envTop','envTop'],['varTop','varTop'],['diff','diff'],['innerW','innerW'],['innerH','innerH'],['phoneW','phoneW'],['phoneH','phoneH'],['phonePadTop','phonePadTop'],['phoneBottom','phoneBottom'],['sbTop','sbTop'],['tabBottom','tabBottom'],['iosH','iosH'],['ori','orientation'],['fs','fsActive']];
    const ch = [];
    PAIRS.forEach(function (p) {
      const a = prev[p[0]], b = cur[p[1]];
      if (String(a) !== String(b)) ch.push(p[0] + ': ' + a + ' → ' + b);
    });
    // #917：手调轴变化单列（快照存串、采集存对象，不走 PAIRS 的 String 直比）
    if (sdAdjStr(cur.adj) !== String(prev.adj || '')) ch.push('手调轴: ' + (prev.adj || '无') + ' → ' + (sdAdjStr(cur.adj) || '无'));
    const when = new Date(prev.t).toLocaleString();
    return ch.length ? ('与上次（' + when + ' ' + prev.trig + '）对比，变化项：' + ch.join('；')) : ('与上次（' + when + ' ' + prev.trig + '）各项一致');
  }
  function sdRingPush(names, snap) {
    // 静默写诊断模块的错误环形缓冲（同键同格式，信息诊断『最近错误』直读）
    try {
      var arr = [];
      try { var old = localStorage.getItem(SD_ERR_KEY); if (old) { var o = JSON.parse(old); if (Array.isArray(o)) arr = o; } } catch (e0) {}
      // #209：错误环条目带事发现场数值——「最近错误」里直接能看出是哪种形态，
      // 不用再翻 screen-diag-hist 对照
      // FIX 2026-09-20 #916b：同签名 24h 去重——[屏幕适配] 条目按会话自动采集，同一台
      // 设备同一形态（如 Edge 工具条显隐族「底部少填 26px」）几乎每个会话都重现一次，
      // 原实现每次 push 新条目：环形缓冲被同文填满、信息诊断红点数随每次刷新只增不减
      // （用户报障「设备兼容诊断处每次刷新红点数量会增加」，多机型同现）。改为倒查 24h
      // 内有无同「[屏幕适配] <形态名>」前缀条目，有则 c+1 并更新时间戳（出现次数与最新
      // 时间仍保留＝线索不丢），不再新增条目——红点数稳定为「出现过几种形态」而非
      // 「重现场几次」。签名取 '｜' 之前段（几何数值段每会话可能不同，不参与比较）。
      var _sdSig = '[屏幕适配] ' + String(names).split('｜')[0];
      var _sdDup = -1;
      for (var iSd2 = arr.length - 1; iSd2 >= 0; iSd2--) {
        if (arr[iSd2] && typeof arr[iSd2].msg === 'string'
            && String(arr[iSd2].msg).split('｜')[0] === _sdSig
            && Date.now() - (arr[iSd2].t || 0) < 86400000) { _sdDup = iSd2; break; }
      }
      if (_sdDup >= 0) {
        arr[_sdDup].t = Date.now();
        arr[_sdDup].c = (arr[_sdDup].c || 1) + 1;
      } else {
      arr.push({ t: Date.now(), msg: '[屏幕适配] ' + String(names).slice(0, 120)
        + '｜env=' + (snap ? snap.envTop : '?') + ' var=' + (snap ? snap.varTop : '?')
        + ' diff=' + (snap ? snap.diff : '?') + ' inner=' + (snap ? snap.innerH : '?')
        + ' phone底=' + (snap ? snap.phoneBottom : '?') + ' sb=' + (snap ? snap.sbTop : '?')
        + ' scale=' + (snap ? snap.scale : '?') + (snap && snap.adj ? ' 手调' + snap.adj : '') + (snap && snap.fs ? ' 全屏' : '')
        + '（' + (snap && snap.trig === 'manual' ? '手动' : '自动') + '采集）',
        ua: (navigator.userAgent || '').slice(0, 160),
        dev: (function () { var dd = window.mochiDevice || {}; return 'M' + (dd.isMobile?1:0) + ' T' + (dd.isTablet?1:0) + ' I' + (dd.isIOS?1:0) + ' A' + (dd.isAndroid?1:0) + ' V' + (dd.isVia?1:0); })(),
        page: 'page-phone' });
      } // #916b else（同签名 24h 内已入环：c+1 复用原条目，不新增）
      // v3.27.x：上限 20→30，满时先逐出最旧的 [屏幕适配] 条目——本类条目与 JS
      // onerror 同队列，此前纯 FIFO 会让屏幕适配爆发把真 JS 错误顶出环外。信息诊断
      // pushErr 侧仍 slice(-20)：JS 错误到达时环自然收到 20，属正常 FIFO 不受影响。
      while (arr.length > 30) {
        var iSD = -1;
        for (var i3 = 0; i3 < arr.length; i3++) { if (arr[i3] && /^\[屏幕适配\]/.test(arr[i3].msg || '')) { iSD = i3; break; } }
        if (iSD < 0) arr.shift(); else arr.splice(iSD, 1);
      }
      localStorage.setItem(SD_ERR_KEY, JSON.stringify(arr));
    } catch (e1) {}
  }
  // 常驻监视：仅 iOS 主屏幕/全屏形态才有意义？不只——浏览器形态同样适用（缩放/底裁）。
  // 每 5s 一次轻量采集；✗ 形态签名变化（出现/消失/换形态）才算一次事件。
  let _sdLastBad = '', _sdPend = null;
  function sdTick() {
    try {
      if (document.visibilityState !== 'visible') return;
      if (!window.__collectScreenDiag) return;
      // #418：开屏未进入 / 数据未就绪期跳过自动采集——该阶段 .phone 高度由
      // --mochi-ios-h 写入时序主导、布局未稳，每秒/每 5s 的全量几何采集必刷
      // 假阳性「底部少填/顶部重叠」（iPhone13 Safari 实测 inner=797 瞬态，
      // 844 稳定后自愈），既污染错误环（顶掉真 JS 错误）又添无谓强制重排。
      // 纯状态守卫、零机型分支：Splash 已隐藏（=用户已进入）且数据就绪才采。
      try {
        var _splash = document.getElementById('splash');
        if (_splash && !_splash.classList.contains('hide')) return;
        if (!window.__mochiDataReady) return;
      } catch (eG) {}
      // #179：键盘会话/输入聚焦期是瞬态（.phone 被内联高接管、状态栏位移），
      // 监视跳过——否则会误报「顶部重叠/平移残留」刷屏错误环（14 Pro 实测）
      try { var _ae = document.activeElement; if (_ae && (_ae.tagName === 'INPUT' || _ae.tagName === 'TEXTAREA' || _ae.isContentEditable)) return; } catch (eF) {}
      try { var _kst = window.__mochiIosKb ? window.__mochiIosKb() : null; if (_kst && _kst.kbActive) return; } catch (eK) {}
      const r = window.__collectScreenDiag();
      const badNames = r.findings.filter(function (f) { return !f.ok; }).map(function (f) { return f.name.split(' ')[0]; }).sort();
      const bad = badNames.join('|');
      // v3.27.x：二次确认降噪——首见坏签名只存档（瞬态证据不丢，#208 iPad 切后台
      // 单采样瞬态类）；同一签名连续两 tick（≥5s 持续）才入错误环。持续假态不受
      // 影响（每 tick 都在等确认的那次已入环），只是入环推迟 5s。
      if (!bad) { _sdLastBad = ''; _sdPend = null; return; }
      if (bad === _sdLastBad) {
        if (_sdPend && _sdPend.sig === bad) { sdRingPush(_sdPend.names, _sdPend.snap); _sdPend = null; }
        return;
      }
      _sdLastBad = bad;
      sdArchive(r, 'auto');
      _sdPend = { sig: bad, names: badNames.join('、'), snap: sdSnapOf(r, 'auto') };
    } catch (e2) {}
  }
  setInterval(sdTick, 5000);
  // #209：事件沿捕获——5s 轮询会漏瞬态（切后台回来 innerHeight 短报整屏、旋转中
  // 态等，#208 守卫注释里的 21:32 瞬态即轮询空窗撞上的），resize/vv resize/旋转/
  // 回前台各补一次 1.2s 去抖采集，与轮询走同一套键盘守卫+签名去重
  let _sdEdgeT = null;
  function sdEdge() { clearTimeout(_sdEdgeT); _sdEdgeT = setTimeout(sdTick, 1200); }
  try { window.addEventListener('resize', sdEdge); } catch (e3) {}
  try { if (window.visualViewport) window.visualViewport.addEventListener('resize', sdEdge); } catch (e4) {}
  try { window.addEventListener('orientationchange', sdEdge); } catch (e5) {}
  // FIX 2026-09-20 #917：切后台即断二次确认配对——_sdLastBad/_sdPend 跨后台存活时，
  // 回前台首个 tick 会拿「后台前那次坏签名」直接确认入环，入的是过期快照数值（长时间
  // 后台后尤其失真）。清零后回前台需两次连续 tick（≥5s、均为回前台后的真实几何）才
  // 入环——真故障只晚报 5s，跨后台拼出来的假确认不再出现。
  function sdPendBreak() { _sdLastBad = ''; _sdPend = null; }
  try { document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { sdEdge(); return; }
    sdPendBreak();
    window.__mochiLeaveSnap('hide');
  }); } catch (e6) {}
  try { window.addEventListener('pagehide', function () { window.__mochiLeaveSnap('hide'); }); } catch (e7) {}
  // v3.27.x：离开抢拍——#209 K70 实锤「停靠残留只存在于切页前最后一帧」（切页
  // syncChrome blur 即自愈），5s 轮询与事件沿都采不到。tabs.js 在把页面 hidden 之前、
  // 以及上方 hidden/pagehide 时刻同步调本钩子：坏形态当场存档（trig=switch/hide），
  // 好形态不存（切页高频，与监视同策略不刷档）；限频 3s。键盘会话/输入聚焦跳过
  // （停靠中内联高合法，采了必误报，与 sdTick 同守卫）。
  let _sdLeaveT = 0;
  window.__mochiLeaveSnap = function (trig) {
    try {
      const now = Date.now();
      if (now - _sdLeaveT < 3000) return;
      if (!window.__collectScreenDiag) return;
      // #418：与 sdTick 同守卫——开屏未进入/数据未就绪时跳过离页抢拍。
      // 开屏加载期切后台正是「inner=797 底部少填」假阳性的高频来源（iPhone13
      // Safari 实测），该阶段布局未稳，抢拍必误报且增加无谓重排。
      try {
        var _sp = document.getElementById('splash');
        if (_sp && !_sp.classList.contains('hide')) return;
        if (!window.__mochiDataReady) return;
      } catch (eS) {}
      // 只看双端键盘探针，不看 activeElement——#197 族「收键盘不派 blur」时
      // activeElement 仍留在输入框，那正是要抓的残留现场，按焦点守卫必漏
      try { var _k2 = window.__mochiIosKb ? window.__mochiIosKb() : null; if (_k2 && _k2.kbActive) return; } catch (eK3) {}
      try { var _ka2 = window.__mochiAndroidKb ? window.__mochiAndroidKb() : null; if (_ka2 && (_ka2.kbActive || _ka2.prov)) return; } catch (eK4) {}
      const r = window.__collectScreenDiag();
      _sdLeaveT = now;
      if (!r.findings.some(function (f) { return !f.ok; })) return;
      sdArchive(r, trig === 'hide' ? 'hide' : 'switch');
    } catch (e8) {}
  };
  // 微任务级兜底：本观察器随 device.js 注册（jsFiles 里最先），早于 tabs.js
  // syncChrome 的观察器——同一 hidden 变更的微任务检查点里先执行＝blur 自愈前
  // 现场；覆盖不经 tabs.js 的 JS 直切页（各模块 openXxx/返回）。与上面钩子共用
  // 3s 限频，先到先采。
  try {
    const sdPgMo = new MutationObserver(function () { window.__mochiLeaveSnap('switch'); });
    document.querySelectorAll('.page').forEach(function (p) { sdPgMo.observe(p, { attributes: true, attributeFilter: ['hidden'] }); });
  } catch (e9) {}
  // #209：历史快照时间线文本（屏幕适配报告末尾附），新→旧
  function sdHistTimeline() {
    const list = sdHistLoad();
    if (!list.length) return '== 历史快照 ==\n（暂无，本次诊断后开始积累）';
    const T = ['== 历史快照（自动监视/历次诊断，新→旧最多 ' + SD_HIST_CAP + ' 条）=='];
    for (let i2 = list.length - 1; i2 >= 0; i2--) {
      const h = list[i2];
      T.push('· ' + new Date(h.t).toLocaleString() + ' [' + (h.trig || '?') + ']'
        + (h.bad && h.bad.length ? ' ✗' + h.bad.join('/') : ' ✓')
        + '  env=' + h.envTop + ' var=' + h.varTop + ' diff=' + h.diff + ' inner=' + h.innerH
        + ' phone=' + h.phoneH + '(底' + h.phoneBottom + ' 宽' + (h.phoneW == null ? '?' : h.phoneW) + ')'
        + ((h.inlineH || h.aself) ? ' ⚠内联残留' : '') + ' sb=' + h.sbTop + ' tab=' + h.tabBottom
        + ' scale=' + h.scale + (h.adj ? ' 手调' + h.adj : '') + (h.fs ? ' 全屏' : ''));
    }
    return T.join('\n');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindScreenDiag);
  else bindScreenDiag();
  window.__screenDiagJudge = screenDiagJudge;
  window.__collectScreenDiag = collectScreenDiag;
})();

// ===== 功能：功能诊断（v3.26.x #177，与信息诊断/屏幕适配诊断分开） =====
// 用户诉求：「诊断测试全部功能哪些功能正常，哪些是否有异常」。逐项三级测试：
//   T1 入口函数存在（window.openXxx）  T2 页面容器/桌面图标节点存在
//   T3 真实打开测试（点桌面图标 → 目标页可见 → 点返回 → 回桌面，计耗时）
// 安全子集才做 T3（纯页面查看器）；面板类/开关门控类只做 T1+T2 并注明原因。
// 全程 try/catch 隔离，测试后强制恢复桌面页 + 关浮层 + 复位 tab 高亮。
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const FUNC_ITEMS = [
    { n: '聊天', app: 'chat', page: 'page-chat', open: true },
    { n: '主页/情侣空间', app: 'home', page: 'page-home', open: true },
    { n: '信箱', app: 'mail', page: 'page-mail', open: true },
    { n: '朋友圈', app: 'feed', page: 'page-feed', open: true },
    { n: '日历', app: 'calendar', page: 'page-calendar', open: true },
    { n: '纪念', app: 'memory', page: 'page-memory', open: true },
    { n: '收藏', app: 'note', page: 'page-fav', open: true },
    { n: '统计', app: 'stats', page: 'page-stats', open: true },
    { n: '提问记录', app: 'interact', page: 'page-interact', open: true },
    { n: '寻踪打卡', app: 'checkin', page: 'page-ta-checkin', open: true, gated: '可能需先绑定 TA/授权定位，会先弹引导' },
    { n: '占卜', app: 'divination', page: 'page-divine', open: true },
    { n: '花园', app: 'garden', page: 'page-garden', open: true },
    { n: '此间', app: 'cjian', page: 'page-cjian', open: true },
    { n: '房间', app: 'room', page: 'page-room', open: true },
    { n: '经期记录', app: 'period', page: 'page-period', open: true },
    { n: '记账', app: 'accounting', page: 'page-accounting', open: true },
    { n: '梦角档案', app: 'memo-arc', page: 'page-memo-arc', open: true },
    { n: '我的档案', app: 'my-arc', page: 'page-my-arc', open: true },
    { n: '音乐', app: 'music', page: 'page-music', open: true },
    { n: '群聊', app: 'group-chat', page: 'page-group-chat', open: true, gated: '可能未开启群聊' },
    { n: '帮我决定', fn: 'openDecision' },
    { n: '多人决定', fn: 'openGroupDecision' },
    { n: 'TA 询问', fn: 'openAskReply' },
    { n: 'TA 心情', fn: 'openCurious' },
    { n: 'TA 吐槽', fn: 'openRoast' }
  ];
  function fToast(msg) {
    try {
      let el = document.getElementById('cc-toast');
      if (!el) { el = document.createElement('div'); el.id = 'cc-toast'; document.body.appendChild(el); }
      el.textContent = msg; el.className = 'cc-toast'; void el.offsetWidth; el.className = 'cc-toast show';
      clearTimeout(fToast._t); fToast._t = setTimeout(function () { el.className = 'cc-toast'; }, 2600);
    } catch (e) {}
  }
  function fCopy(text) {
    return new Promise(function (resolve) {
      let done = false;
      const fin = function (ok) { if (!done) { done = true; resolve(ok); } };
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
        document.body.appendChild(ta);
        try { ta.select(); } catch (e1) {}
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        window.mochiKillCopySelection && window.mochiKillCopySelection(ta);   // #261：见 copyText 同款说明（防孤儿选区卡住原生全选条）
        setTimeout(function () { try { document.body.removeChild(ta); } catch (e3) {} }, 800);
        if (ok) { fin(true); return; }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { fin(true); }, function () { fin(false); });
          else fin(false);
        } catch (e4) { fin(false); }
        setTimeout(function () { fin(false); }, 1500);
      } catch (e5) { fin(false); }
    });
  }
  function closeFloats() {
    ['#modal-mask', '#poke-card', '#emoji-panel', '#chat-ask-panel', '#chat-search', '#chat-divine-panel', '#chat-rps-panel', '#chat-call-panel', '#chat-more-panel', '#tc-mask'].forEach(function (sel) {
      try { var el = document.querySelector(sel); if (el && !el.hidden) el.hidden = true; } catch (e) {}
    });
  }
  function restoreDesk() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = p.id !== 'page-phone'; });
      closeFloats();
      document.querySelectorAll('.tab').forEach(function (tb) { if (tb.dataset) tb.classList.toggle('active', tb.dataset.page === 'page-phone'); });
    } catch (e) {}
  }
  function pageVisible(id) { var p = document.getElementById(id); return !!(p && !p.hidden); }
  async function collectFuncDiag() {
    const L = [];
    const rows = [];
    let okN = 0, badN = 0, warnN = 0, skipN = 0;
    const boot = {
      data: !!window.__mochiDataReady,
      ls: (function () { try { return window.__lsStatus || 'n/a'; } catch (e) { return 'n/a'; } })(),
      sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      online: navigator.onLine
    };
    for (let i = 0; i < FUNC_ITEMS.length; i++) {
      const it = FUNC_ITEMS[i];
      fToast('功能诊断 ' + (i + 1) + '/' + FUNC_ITEMS.length + '：' + it.n);
      const det = [];
      let ok = true, warn = false, skip = false;
      if (it.fn) {
        const has = typeof window[it.fn] === 'function';
        det.push(has ? '入口✓' : '✗ 入口缺失');
        if (!has) ok = false;
      }
      if (it.page) {
        const pg = document.getElementById(it.page);
        det.push(pg ? '页面✓' : '✗ 页面容器缺失');
        if (!pg) ok = false;
      }
      if (it.app) {
        const ic = document.querySelector('.app[data-app="' + it.app + '"], [data-desk-widget="app-' + it.app + '"]');
        det.push(ic ? '图标✓' : '⚠ 图标不在桌面（可能被移除/收进组件库）');
        if (!ic) warn = true;
      }
      if (it.open && it.page && document.getElementById(it.page)) {
        try {
          const icon = document.querySelector('.app[data-app="' + it.app + '"], [data-desk-widget="app-' + it.app + '"]');
          const t0 = Date.now();
          if (icon) icon.click();
          await sleep(450);
          const opened = pageVisible(it.page);
          if (opened) {
            const back = document.getElementById(it.page).querySelector('.ch-back');
            if (back) back.click();
            await sleep(230);
            const closedOk = !pageVisible(it.page);
            det.push('打开✓ ' + (Date.now() - t0) + 'ms，关闭' + (closedOk ? '✓' : '⚠'));
            restoreDesk();
          } else if (it.gated) {
            warn = true; skip = true;
            det.push('打开未生效（' + it.gated + '）');
            restoreDesk();
          } else {
            ok = false;
            det.push('✗ 点击图标后页面未打开（' + (Date.now() - t0) + 'ms）');
            restoreDesk();
          }
        } catch (e6) {
          ok = false;
          det.push('✗ 打开测试异常：' + String(e6 && e6.message || e6).slice(0, 80));
          restoreDesk();
        }
      }
      if (!ok) badN++; else if (warn) warnN++; else okN++;
      if (skip) skipN++;
      rows.push((!ok ? '✗ ' : warn ? '⚠ ' : '✓ ') + it.n + '：' + det.join('，'));
      await sleep(60);
    }
    const L2 = [];
    L2.push('【功能诊断】' + (window.__sdVer || ''));
    L2.push('时间：' + new Date().toLocaleString());
    L2.push('');
    L2.push('== 基础 ==');
    L2.push('数据就绪=' + (boot.data ? '✓' : '✗') + '  LS=' + boot.ls + '  SW=' + (boot.sw ? '✓' : '✗') + '  在线=' + (boot.online ? '✓' : '✗'));
    L2.push('');
    L2.push('== 功能逐项（共 ' + FUNC_ITEMS.length + ' 项）==');
    rows.forEach(function (r) { L2.push(r); L2.push(''); });
    L2.push('== 汇总 ==');
    L2.push('正常 ' + okN + ' / 需注意 ' + warnN + ' / 异常 ' + badN + ' / 打开跳过 ' + skipN);
    const bads = rows.filter(function (r) { return r.indexOf('✗') === 0; });
    if (bads.length) { L2.push(''); L2.push('✗ 异常清单（发给开发者）：'); bads.forEach(function (r) { L2.push('  ' + r); }); }
    return { text: L2.join('\n'), rows: rows, okN: okN, badN: badN, warnN: warnN, skipN: skipN };
  }
  function bindFuncDiag() {
    const row = document.getElementById('row-func-diag');
    if (!row) return;
    row.addEventListener('click', function () {
      fToast('功能诊断开始：将逐个打开各功能页面（约 15 秒）…');
      setTimeout(async function () {
        try {
          const r = await collectFuncDiag();
          if (window.openModal) window.openModal('功能诊断', r.text, null, { noInput: true, textarea: true, textareaRows: 16, big: true });
          fCopy(r.text).then(function (ok) { fToast(ok ? '报告已复制到剪贴板' : '报告已弹出，请手动全选复制'); });
        } catch (e) {
          fToast('功能诊断失败：' + String(e && e.message || e).slice(0, 60));
        }
      }, 80);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindFuncDiag);
  else bindFuncDiag();
  window.__collectFuncDiag = collectFuncDiag;
})();

// ===== 全站公共搜索工具（FIX 2026-09-16 #573）：设置页搜索（personalize.js）/ 字卡库搜索
//（chatcard.js）/ 功能大全搜索（feature-hub.js）共用同一套匹配语义，防多处实现漂移。
// 纯字符串运算、按键触发一次：无定时器、无合成层、无常驻大对象，安卓/iOS 零卡顿面。
(function () {
  var PUNCT = /[\s。！？!?.,，、;；:：·~～「」『』（）()【】\[\]“”‘’"'—_\-]+/g;
  window.mochiSearch = {
    // 查询分词：小写 + 空格切多词（空串剔除）
    terms: function (q) { return String(q || '').trim().toLowerCase().split(/\s+/).filter(function (w) { return w; }); },
    // 查询侧标点归一：标点当空格（「晚安。」＝「晚安」），再交给 terms
    qnorm: function (q) { return String(q || '').replace(PUNCT, ' ').trim(); },
    // 文本侧归一：小写 + 去标点（精确判等用）
    norm: function (s) { return String(s || '').toLowerCase().replace(PUNCT, ''); },
    // 最长词作锚（注册方只认整串子串时，用锚词取候选最省）
    anchor: function (terms) { return terms.reduce(function (a, b) { return b.length > a.length ? b : a; }, terms[0] || ''); },
    // 匹配质量分级：0=精确（标点归一后整段相等）1=开头 2=包含
    rank: function (text, q) {
      var t = this.norm(text); var nq = this.norm(q);
      if (!nq) return 2;
      if (t === nq) return 0;
      return t.indexOf(nq) === 0 ? 1 : 2;
    },
    // 多词 AND：每个词都须在小写素材里出现
    and: function (hayLower, terms) { return terms.every(function (w) { return hayLower.indexOf(w) >= 0; }); }
  };
})();

// ===== 文件选择器原生 label 激活（FIX 2026-09-18 #738）——小米 MiuiBrowser 等分叉内核对
// 「常驻挂文档 input + 程序化 input.click()」仍可能静默不弹系统选择器（#717 修复后小米17 Pro
// 实报三个头像入口全灭；#677/#717 同族第三波）。业界对这类顽固兼容问题的最稳解＝不再依赖
// JS 合成 click：把透明 <label for=inputId> 铺满触发按钮内部，用户手指物理点在 label 上，
// 由内核按 HTML 原生行为转发激活 file input（label→input 转发是核心规范行为，所有浏览器
// 分叉实现一致——中文移动网「sr-only input + label 当按钮」通吃全平台的通用上传写法）。
//
// ⚠️ FIX 2026-09-18 #756（本族第六波，用户二次报障「其他手机型号也这样」）：
// 上面那条「label 转发是所有分叉实现一致的核心行为」的假设**在国产内核上是错的**。
// 实测（vivo X200s + 百度 SP-engine/T7，症状与用户实报逐条吻合）：label 被正确铺满、
// htmlFor 也指对了 input，但内核**既不转发激活、也不报错、也不派发任何可用于判断的事件**
// ——点击就这样被无声吞掉。而 #738 的配套写法 `if (fromLabel(e)) return;`（见各入口）
// 本意是「label 已原生开过选择器，别再 JS click 一次免得双开」，实际效果却是：
//   label 存在 ⇒ 一律认作「原生激活已成功」⇒ 永远跳过 JS 兜底 ⇒ 全站入口全灭、零反馈。
// 于是 #738 把「小米系上 JS click 不灵」修成了「国产内核上两条路都不走」——这正是用户说的
// 「反复出现」：每轮都在赌「哪条激活路径在这台机器上通」，赌错就整族复发。
//
// 根治口径（不再赌）：**两条路都留着，但让它们互为兜底、且以「是否真的弹了选择器」为准**。
// 具体＝label 只当作「加速路径」而非「唯一路径」：点击后起一个极短计时器，若在窗口期内
// 没有观察到「选择器已开」的信号（input 取得焦点／change 事件／click 落到 input 上），
// 就补一次 JS click()。信号一旦出现即撤销兜底，双开不可能发生。
// 判断依据全部是**可观测事实**，不含任何机型/UA 分支——这是本族不再复发的关键。
window.__mochiPickArmed = window.__mochiPickArmed || { seq: 0, opened: 0 };
// 入口侧调用：告知「本次手势已由 label 走过原生激活」，只做记录，不阻断 JS 兜底
window.mochiFilePickFromLabel = function (e) {
  try {
    var hit = !!(e && e.target && e.target.closest && e.target.closest('label[data-file-pick-for]'));
    if (hit) window.__mochiPickArmed.opened++;
    return hit;
  } catch (err) { return false; }
};
// 入口侧统一调用（替代原 `if (fromLabel(e)) return;` 的早退写法）：
// onMiss 在「窗口期内确实没弹出选择器」时执行，用于补 JS click() 兜底。
// 返回 true＝判定已开（调用方无需再做任何事）。
window.mochiFilePickGuard = function (input, onMiss) {
  var token = ++window.__mochiPickArmed.seq;
  var openedAt = window.__mochiPickArmed.opened;
  var settled = false;
  var finish = function (ok) {
    if (settled) return;
    settled = true;
    if (!ok && typeof onMiss === 'function') { try { onMiss(); } catch (e) {} }
  };
  // 信号一：input 获得焦点（安卓/桌面 Chromium 弹选择器时的共同表现）
  var onFocus = function () { cleanup(); finish(true); };
  // 信号二：input 的 click 事件（原生转发会派发）
  var onClick = function () { cleanup(); finish(true); };
  // 信号三：用户真的选了文件（change 必然晚于选择器打开）
  var onChange = function () { cleanup(); finish(true); };
  function cleanup() {
    try { input.removeEventListener('focus', onFocus); } catch (e) {}
    try { input.removeEventListener('click', onClick); } catch (e) {}
    try { input.removeEventListener('change', onChange); } catch (e) {}
  }
  try { input.addEventListener('focus', onFocus); } catch (e) {}
  try { input.addEventListener('click', onClick); } catch (e) {}
  try { input.addEventListener('change', onChange); } catch (e) {}
  // 窗口期：国产内核「转发激活」即使发生也在同一帧内落地，60ms 足够区分；
  // 但焦点/change 可能晚到，故超时后只做「补一次 click」，不做任何状态重置。
  setTimeout(function () {
    if (settled) return;
    if (window.__mochiPickArmed.opened !== openedAt) { cleanup(); settled = true; return; } // label 路径已生效
    // FIX 2026-09-21 #991（第九波）：本次手势若是「手指物理点按铺在入口上的真 input」（surface 层，
    // 见 mochiFilePickSurface），浏览器已按原生默认动作弹了选择器——此时再补 JS 腿会在另一个
    // input 上二次激活（双开），故判定「已弹出」直接让路。判据＝同一手势的时间戳，零机型分支。
    if (window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) { cleanup(); settled = true; return; }
    cleanup();
    finish(false); // 没等到任何信号 → 判定「这次没弹出」，走兜底
  }, 60);
  return { done: function () { cleanup(); settled = true; }, token: token };
};
window.mochiFilePickLabel = function (btn, input) {
  try {
    if (!btn || !input || !btn.appendChild) return;
    if (!input.id) input.id = 'mochi-file-pick-' + Date.now().toString(36);
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    var mark = 'data-file-pick-for';
    var label = btn.querySelector('label[' + mark + '="' + input.id + '"]');
    if (!label) {
      label = document.createElement('label');
      label.setAttribute(mark, input.id);
      label.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer;';
      // FIX 2026-09-21 #1002：本按钮若已铺「真·可点 input 层」（#991/#1002），label 必须**插在它前面**
      // ——两者都是 absolute 覆盖层，画序由 DOM 顺序决定；后插的 label 会盖在 surface 上，手指点中的
      // 就成了 label（国产内核里 label 转发被静默吞掉＝回到「点了没反应」）。插在 surface 之前＝
      // label 退回原来的兜底角色（surface 才是主路径）；surface 与入口内可点元素（如 .lbl）的相对
      // 层级不变（#821 仍成立）。
      var surf = btn.querySelector('input[data-file-pick-surface]');
      if (surf) btn.insertBefore(label, surf); else btn.appendChild(label);
    }
    label.htmlFor = input.id;
  } catch (e) { /* 兼容助手绝不能成为错误源 */ }
};

// ===== 第九波 #991：把「真·可点 file input」铺在入口上（物理点按＝浏览器原生行为，零转发、零合成事件）=====
// 立项（用户 2026-09-21 红米 Note 9 Pro + 手机自带浏览器 MiuiBrowser 20.23 / Android12 / Chrome135 内核
// 实报「导入图片点不了、一直换不了头像」，并明说其他设备型号也有出现、要求不要覆盖式修补）：
// 前八波（#677 input 要挂文档 → #717 去掉 display:none → #738 加原生 label → #753 accept 前置 →
// #755 统一入口 → #756 label 早退把两条路一起掐掉 → #813 回调武装时机 → #877 showPicker 第三腿 →
// #920 三腿单点）修的一直是「怎么把那个 1px、看不见的 sr-only input 激活起来」，三条腿都得指望内核
// 配合执行我们的代码：①label 转发（#756 实测 vivo SP-engine 既不转发也不报错）；②JS 合成 click()
// （#738 实测小米系静默无视）；③showPicker()（小米系仍可能不弹）。三条腿全被无视时＝点了彻底没反应
// （不报错、不弹窗、不提示），这正是用户反复看到的形状。
// 本波换掉问题本身：**不再让代码去「激活」一个看不见的 input**，而是在入口节点内铺一层有真实尺寸、
// 手指能直接落在上面的 file input（透明但占位，不是 sr-only clip）——手指物理点按 input 本身，选择器
// 由浏览器的**原生默认动作**弹出，不经过 label 转发、也不经过任何 JS 合成事件。这是本族唯一不依赖
// 「内核乐意执行我们的 JS」的路径（中文移动端「透明 input 覆盖按钮」的通吃写法）。
// 零机型分支：所有内核都是同一个元素、同一条原生路径，无任何 UA/机型判断。
// 与既有三腿并存互不干扰：三腿在 mochiFilePickGuard / mochiFilePickFire 里会探测「本次手势正是
// surface 点按」并主动让路（见上方 #991 判定），因此绝不会两个 input 各弹一次＝不双开。
// 调用口径：只在**单一用途的常驻入口**（该元素内没有别的按钮）上铺一次，长期有效；不要在点击时临时创建。
//   opts.id       该 input 的稳定 id（同一 id 复用，绝不随点按堆积节点）
//   opts.accept   默认 'image/*'（必须在任何激活之前生效，#753 判据；此处是常驻设置，天然先于点按）
//   opts.multiple 多选（与宿主入口一致）
//   opts.owner    宿主 input（老路径那个 sr-only input）——选完文件后把 FileList 转交它并派发 change，
//                 于是**入口自己的压缩/落库管线一字不用改**（同一入口只有一条管线＝不会两边走偏）
//   opts.onFiles  可选：直接回调（不给 owner 时用；tap 时由 mochiFilePick 登记最新回调，见下）
// #1002：owner 转发是「一行接入」的关键——各入口的 mochiFilePick({btn,onFiles}) 点击路径与
// 自建 input 的 onchange 管线都保持原样，surface 只负责「让手指点到真 input」。
window.mochiFilePickSurface = function (btn, opts) {
  try {
    var o = opts || {};
    if (!btn || !btn.appendChild) return null;
    var id = o.id || ('mochi-pick-surface-' + Date.now().toString(36));
    var input = document.getElementById(id);
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = id;
      input.className = 'mochi-pick-surface';
      input.setAttribute('data-file-pick-surface', '1');
      // 元素本身**可见**（opacity:1、有真实尺寸、可命中），只是没有可见外观：原生 file input 的
      // 大小/内边距/边框/前景色全清掉、字号 0、外观交给 CSS 里的 ::file-selector-button 规则藏按钮。
      // 这样既不落进「不可见 input 被内核拒绝激活」那族启发式（#717/#738 的 display:none/opacity:0），
      // 又能让手指物理落在 input 上——本路径要的正是「浏览器原生默认动作」，不靠任何 JS 激活。
      // z-index:0 ＝ 入口内自己的可点元素（如桌面昵称 .lbl 的 z-index:1，见 #821）仍在其上，
      // 点昵称＝改昵称、点圆圈/其余区域＝换头像，两条路径各归各。
      input.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;outline:none;background:transparent;color:transparent;font-size:0;appearance:none;-webkit-appearance:none;cursor:pointer;z-index:0;';
      // 入口必须是定位祖先，否则这层 100%×100% 的覆盖层会以**初始包含块**（＝整屏）为基准
      // ⇒ 变成一张全屏透明 input 把页面所有点击都吃掉（实测：页面背景行是先在游离态创建、
      // 之后才挂进文档的，此时 getComputedStyle().position 拿到的是空串而不是 'static'，
      // 只判 === 'static' 会漏掉这一形态）。故这里改成「非绝对/非固定/非相对/非粘性就补 relative」，
      // 游离节点与已挂载节点一视同仁。
      var _pos = '';
      try { _pos = getComputedStyle(btn).position || ''; } catch (e3) {}
      if (_pos !== 'absolute' && _pos !== 'fixed' && _pos !== 'relative' && _pos !== 'sticky') btn.style.position = 'relative';
      btn.appendChild(input);
      // 记「本次手势点到了 surface」——供 guard/Fire 让路（同一手势内的时间戳判定，非机型分支）
      input.addEventListener('click', function () {
        window.__mochiSurfaceTapAt = Date.now();
        // #1002：再校一次入口定位——若入口在「装层之后」被 cssText 整体覆盖过 inline 样式
        //（position:relative 被抹掉），这一层会退回以初始包含块（＝整屏）为基准的形态。
        // 点击这一刻节点必然已挂进文档，这里能拿到真实计算值；补回定位＝下一次点按仍然命中这层。
        try {
          var bp = getComputedStyle(btn).position;
          if (bp === 'static' || bp === '') btn.style.position = 'relative';
        } catch (e4) {}
      }, true);
      input.__mochiSurface = { owner: null, onFiles: null };
    }
    try { input.accept = o.accept || 'image/*'; } catch (e) {}
    input.multiple = !!o.multiple;
    var rec = input.__mochiSurface = input.__mochiSurface || { owner: null, onFiles: null };
    if (o.owner) rec.owner = o.owner;
    if (typeof o.onFiles === 'function') rec.onFiles = o.onFiles;
    input.onchange = function () {
      var files = Array.prototype.slice.call(input.files || []);
      try { input.value = ''; } catch (e) {} // 允许重选同一文件
      if (!files.length) return;
      // ① 直接回调（入口自建管线的入口 / tap 时由 mochiFilePick 登记的最新回调）
      if (typeof rec.onFiles === 'function') { try { rec.onFiles(files); } catch (e) {} return; }
      // ② 转交宿主 input：沿用入口原有 onchange 管线（零改动接入）。
      //    owner 允许写成 id 字符串 —— 统一入口（mochiFilePick）的 input 是点按时才建的，
      //    接入侧在绑定/渲染时只能知道它的 id，故到这里再解析（选完文件时它必然已存在）。
      var owner = rec.owner;
      if (typeof owner === 'string') { try { owner = document.getElementById(owner); } catch (e2) { owner = null; } }
      if (!owner) return;
      try {
        var dt = new DataTransfer();
        for (var i = 0; i < files.length; i++) dt.items.add(files[i]);
        owner.files = dt.files;
        owner.dispatchEvent(new Event('change'));
      } catch (e) {
        if (window.toast) { try { toast('浏览器不支持这种方式选择图片，请改用 Chrome 或 Edge 打开'); } catch (x) {} }
      }
    };
    return input;
  } catch (e) { return null; }
};
// 供 guard/Fire 判定「本次手势是一次 surface 点按」：一次性消费（读到即清），窗口 400ms＝同一手势，
// 避免上一次点按的残留把下一次点按的补腿误吞。
window.mochiFilePickSurfaceTap = function () {
  var at = window.__mochiSurfaceTapAt || 0;
  window.__mochiSurfaceTapAt = 0;
  return (Date.now() - at) < 400;
};
// #1002：按宿主 input 找它已经铺好的所有 surface（同一宿主可能对应多个触发按钮，例如
// 聊天壁纸在「设置页面板」和「边看边调抽屉」各一个按钮）——mochiFilePick 在点击路径里用它把
// 本次的 onFiles 接到全部同宿主的层上，任一按钮被点都能拿到正确的回调。
window.mochiFilePickSurfaceAll = function (input) {
  var out = [];
  try {
    var all = document.querySelectorAll('input[data-file-pick-surface]');
    for (var i = 0; i < all.length; i++) {
      var rec = all[i].__mochiSurface;
      if (rec && (rec.owner === input || (typeof rec.owner === 'string' && rec.owner === input.id))) out.push(all[i]);
    }
  } catch (e) {}
  return out;
};

// ===== 激活腿统一实现（FIX 2026-09-20 #920 第八波）——showPicker → click → 可反馈提示 =====
// 用户（小米14 自带浏览器 MiuiBrowser 20.27 / Android16 / Chrome135 内核实报「照片、壁纸上传不了，
// 所有上传图片的地方上传无反应」，明说其他机型也有；#677→#717→#738→#753→#755→#756→#813→#877 同族
// 第八波）：第七波 #877 只把聊天设置两行头像的兜底腿升级成三条，其余入口（41 处统一入口调用 ＋
// 9 处 guard/手写兜底，其中多数入口压根没接 label）仍是「label 转发 ＋ 裸 click()」两条腿；而 #738
// 已实锤小米系对 JS 合成 click 静默不弹（不报错、不弹窗、不抛异常）⇒ 在「label 不转发或没接 label」
// 的内核上整族无声＝用户报的「所有上传图片的地方都没反应」。本波不逐入口手抄（本族历史已证手抄必
// 漏＝反复复发的结构性原因），把第三条腿收进本函数单点实现、全站入口统一调用。
// showPicker()（标准 API：Chromium/Edge 99+、Safari 16.3+）在用户手势窗口内直接弹系统选择器，
// 既不依赖 label 转发、也不走 legacy click 的合成事件路径。与 #877 同口径：
// ①showPicker 与 click **顺序都走**（规范里两条路汇入同一「show the picker」算法，选择器已开即
//   空操作＝不双开），也避开「showPicker 成功但内核不给可观测信号」形态把 click 短路掉；
// ②只有两条腿都抛异常才触发 onFail（给三条腿全失效的内核一个可反馈现场，不再无声）。
// 零机型分支：所有内核同一顺序尝试三条腿，判据全是可观测事实（无机型/UA 判断）。
window.mochiFilePickFire = function (input, opts) {
  var o = opts || {};
  // FIX 2026-09-21 #991（第九波）：本次手势若是「手指物理点按入口上铺的真 input」（surface 层），
  // 那台选择器已由浏览器原生默认动作弹出——这里只登记、不再补腿（补＝另一个 input 再弹一次＝双开）。
  if (window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) return true;
  var fired = false;
  if (input && typeof input.showPicker === 'function') {
    try { input.showPicker(); fired = true; } catch (e) {}
  }
  try { input.click(); fired = true; } catch (e) {}
  if (!fired) { if (typeof o.onFail === 'function') { try { o.onFail(); } catch (e) {} } }
  return fired;
};

// ===== 统一文件选择入口（FIX 2026-09-18 #755）——同族第五波根治 =====
// 用户（vivo X200s + 百度浏览器，SP-engine/T7 内核）实报「任何图片，上传无反应；上传头像点了相册
// 点了图片，但是没有任何反应」，明说其他机型也有、要求不要覆盖式修补。第五波复盘：#677（input 要
// 挂文档）→ #717（去 display:none）→ #738（加原生 label）→ #753（聊天两入口 + accept 前置）四轮
// 修的都是「同一个模具的另一个入口」，而**全站仍有十余个入口在点击时现场 new 一个 input、从不挂
// 文档、无 label 兜底、accept 也常迟到**——每修一处，下次用户就在另一处报同一个症状，这正是
// 「反复出现」的结构性原因。本轮不再逐个入口手抄模具（手抄必然漏），改成**单一实现 + 全站调用**：
// 一个常驻 sr-only clip input 挂 body（给稳定 id）+ 先设 accept/multiple 与样式 + 接原生 label 激活层
// + 最后才 click()，顺序固定在一个函数里，调用方无法写错顺序。
//   opts.id       常驻 input 的稳定 id（诊断/验证句柄）
//   opts.accept   ∈ 'image/*' | 'audio/*' | '.json,...' | '.ttf,...' 等（**必须在 click 前生效**，
//                 否则 iOS/部分内核首次激活会退回通用文档选择器——#753 的核心判据）
//   opts.multiple 是否多选
//   opts.btn      触发按钮（可选）：给了就接 mochiFilePickLabel 原生激活层兜底
//   opts.onFiles  (files: File[]) => void，读取完成回调（空 FileList 也会回调，调用方自行提示）
//   opts.noClick  true＝只登记/复用 input 与回调、不立刻激活（供「多个按钮共用一个选择器、
//                 想先挂好 label 再在各自 click 里激活」的场景；默认 false 即刻激活）
// 返回常驻 input（同一 id 复用，绝不随点按堆积节点）。
window.mochiFilePick = function (opts) {
  var o = opts || {};
  var id = o.id || 'mochi-file-pick';
  var input = null; // 常驻单例：同一 id 复用，绝不随点按堆积节点 mochi-755-single
  try { input = document.getElementById(id); } catch (e) {}
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = id;
    // sr-only clip：不可用 display:none（#717/#738 已证部分内核对不可见 input 拒绝激活），
    // 也不能 detached（#677：iOS 对未挂载 file input 不保证派发 change／不保证带上 files）
    input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    document.body.appendChild(input);
  }
  // ★ 属性顺序：accept/multiple 必须落在任何 click() 之前（#753 判据）
  try { input.accept = o.accept || ''; } catch (e) {}
  input.multiple = !!o.multiple;
  // 读取回调每次重设（闭包随调用方变，常驻 input 不能留旧回调）
  input.onchange = function () {
    var files = Array.prototype.slice.call(input.files || []);
    try { input.value = ''; } catch (e) {} // 允许重选同一文件
    if (o.onFiles) { try { o.onFiles(files); } catch (e) {} }
  };
  // 原生 label 激活层（部分分叉内核忽略 JS 合成 click；注意 #756 实测：label 在国产内核上
  // 也可能既不转发也不报错，故它只是「加速路径」，真正的兜底见下方 activate()）
  if (o.btn && window.mochiFilePickLabel) window.mochiFilePickLabel(o.btn, input);
  // FIX 2026-09-21 #1002：若这个入口已经铺过 surface（真·可点 input 层），把**本次点击路径产出的
  // onFiles 回调登记到那层上**——surface 收到文件时直接调它，于是入口侧「点击时才算出来的管线」
  // （列表/索引/时长等闭包变量）与 surface 选中的文件严丝合缝，接入侧仍只需在绑定/渲染处铺一行。
  if (o.btn && window.mochiFilePickSurfaceAll && typeof o.onFiles === 'function') {
    try {
      var surfs = window.mochiFilePickSurfaceAll(input);
      for (var si = 0; si < surfs.length; si++) { surfs[si].__mochiSurface.onFiles = o.onFiles; }
    } catch (e) {}
  }
  // ★ 激活：不再「有 label 就跳过 JS click」（那是 #738~#755 整族复发的根源，见上方 #756 说明）。
  // 统一走 mochiFilePickGuard —— 先给原生转发一个窗口期，只有确认「没弹出选择器」才补 JS click。
  // FIX 2026-09-20 #920：兜底腿由「裸 click()」换成全站统一的 mochiFilePickFire（showPicker→click
  // →提示 三腿，见上方定义）——本入口是 41 处调用的公共路径，改这一处即全体升级。
  var activate = function () {
    window.mochiFilePickFire(input, { onFail: function () { if (o.onError) { try { o.onError(); } catch (x) {} } } });
  };
  // #1002：本次手势若正是点在这层 surface 上（入口已铺），远端已由浏览器原生弹出选择器——
  // 不再补腿，避免与 surface 各弹一次。判据同上（同一手势时间戳，一次性消费）。
  if (!o.noClick && window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) {
    if (window.mochiFilePickGuard) window.mochiFilePickGuard(input, function () {}); // 仍登记一次武装（诊断口径 seq 不变）
    return input;
  }
  if (!o.noClick) {
    if (o.btn && window.mochiFilePickGuard) window.mochiFilePickGuard(input, activate);
    else activate();
  }
  return input;
};

// ===== 统一文件选择入口（FIX 2026-09-18 #755）——同族第五波根治 =====