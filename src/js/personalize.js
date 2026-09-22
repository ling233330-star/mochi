// ===== 功能：情侣空间个性化 =====
// 头像上传、签名、纪念日照片、手机背景、自定义图标、恋爱纪念日、每日打卡（localStorage 持久化）
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  const gStore = window.xyStore('xy-home-v2'); // v3.9.x：fish-log 全局累计（跨所有联系人按自然日去重）
  // v3.6.x：桌面图片组件尺寸档位（宽度百分比：小/中/大）——const 声明必须放顶部，
  // renderDeskImages 在启动阶段（声明位置之前）就会被调用，放下面会触发 TDZ 报错
  const DESK_IMG_SIZES = { s: 40, m: 70, l: 100 };
  // v3.6.x：桌面图片查看器关闭监听幂等守卫——setupDeskImageViewerClose 启动时就会被调用，
  // let 声明同样必须放顶部，否则 TDZ 报错（会把 personalize 整个 IIFE 中断）
  let viewerBound = false;
  // v3.6.x：空白页提示显隐——有组件/图片的页内联隐藏（盖掉装修态 CSS 的 display:block），
  // 空页恢复为空（由 CSS 决定：仅装修模式显示，退出装修后空白页保持干净）。
  // 启动阶段 renderDeskImages/applyDeskLayout 就会调用它，声明必须放顶部（TDZ）
  const syncPageHint = (slide) => {
    if (!slide) return;
    const hint = slide.querySelector('.desk-page-hint');
    if (!hint) return;
    // FIX 2026-09-12 #351：空图标网格不算内容——新页自带 .app-grid（pg* 网格）后，
    // 空 grid 也带 data-desk-widget，按旧判法新页提示永远不显示
    const hasContent = Array.prototype.slice.call(slide.querySelectorAll('[data-desk-widget]')).some(n => !(n.classList.contains('app-grid') && !n.querySelector('.app'))) ||
      !!slide.querySelector('[data-desk-image]');
    hint.style.display = hasContent ? 'none' : '';
  };

  // 图片压缩后再存储：大幅缩小体积，本地存储容量更宽松（头像/图标 256px，背景/照片 1000px）
  // v3.6.x：失败/超大图不再回退存原图——iOS Safari 对超大 dataURL（48MP/ProRAW 级别）
  // 的 img 解码会占数百 MB 位图内存，直接把渲染进程拖崩（表现：画面正常但所有按钮
  // 点击无响应，且刷新后 idbRestore 恢复该 dataURL 再次渲染又崩，「刷新后依然失效」）。
  // 解码前按 base64 长度、解码后按像素双重拦截，失败返回 null 由调用方提示换图。
  function compressImage(dataUrl, maxSide) {
    return new Promise((resolve) => {
      // 解码前拦截：>8MB base64（≈6MB 原图，48MP/ProRAW 级别）不解码不存储；
      // 1200 万像素普通照片（2-6MB base64）不受影响
      if (typeof dataUrl === 'string' && dataUrl.length > 8 * 1024 * 1024) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          // 解码后像素拦截：高压缩格式小文件也可能是超大图（48MP HEIC 约 5-8MB）
          if (img.width * img.height > 26000000) { resolve(null); return; }
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          // 压缩失败不再回退存原图（原图可能超大，存进去会让后续每次渲染重新崩溃）
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  // v3.10.x：压缩并保证产物体积达标——细节丰富的照片压到目标边长后 JPEG 仍可能超过
  // 渲染防护阈值（如卡片背景 1000px 可 >500KB），旧流程照常入库后，启动渲染时会被
  // sanitizeBg 判为超大值，表现为「设置成功、退出重进后变回默认白板，每次都要重新设置」。
  // 这里在上传端按 0.75 倍率逐级降边长重压（始终从原图压，避免二次 JPEG 糊化），
  // 确保产物 <= limit 才入库；压到 320px 仍超限的极端图返回最小一版由调用方提示。
  function compressImageFit(dataUrl, maxSide, limit) {
    let side = maxSide;
    const step = (data) => {
      if (!data) return Promise.resolve(null);
      if (data.length <= limit || side < 320) return Promise.resolve(data);
      side = Math.round(side * 0.75);
      return compressImage(dataUrl, side).then(step);
    };
    return compressImage(dataUrl, side).then(step);
  }
  // v3.5.107：手机壁纸清晰度——按设备物理像素计算压缩上限。
  // 之前固定压到最长边 1000px，在 2-3x 高分屏（物理宽 1080-1440）上会被放大发糊；
  // 这里用「屏幕物理最高边 × DPR」计算，保证壁纸铺满时不吃放大，同时不超 4096 防止体积过大
  // v3.5.117：上限 4096 → 2880——4096px 壁纸 base64 动辄 3-6MB，回填/解码明显拖慢
  //   启动（桌面图片慢加载的主因之一）；2880px 在 3x 屏依然清晰，体积约减半
  function phoneBgMaxSide() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const h = (window.screen && window.screen.height) || 1920;
    return Math.min(2880, Math.max(2160, Math.round(h * dpr)));
  }

  // v3.6.x：存量大图渲染防护——旧版本压缩失败时回退存过原图（48MP/ProRAW 级别
  // dataURL 十几 MB），渲染成 backgroundImage 会让 iOS Safari 解码占用数百 MB 位图
  // 内存、渲染进程卡死（表现：打开页面卡顿、什么也点不了，刷新重开依旧）。
  // 渲染前发现异常大值即清除（LS+IDB 双清）回默认，保证存量坏数据刷新后自动恢复。
  // 阈值：壁纸类正常压缩产物 ≤5MB（2880px JPEG 0.85），>6MB 判定为旧版回退原图；
  // 小图类（头像/卡片背景等 1000px 内压缩 <200KB）沿用 500KB（与 applyAvatar 一致）
  const BG_SAFE_LIMIT = 6 * 1024 * 1024;
  const IMG_SAFE_LIMIT = 500 * 1024;
  // v3.10.x：硬上限——仅旧版本绕过压缩存进去的原级别大图（渲染会拖垮 iOS Safari）
  // 才清除自愈；正常压缩产物偶尔超阈值时绝不再删数据
  const BG_HARD_LIMIT = 12 * 1024 * 1024;
  const sanitizeBg = (key, limit) => {
    const v = store.get(key);
    if (v && typeof v === 'string' && v.length > limit) {
      // v3.10.x：超限只跳过本次渲染，不再删除数据——旧实现 store.remove 会把
      // localStorage + IndexedDB 三处的图一起删掉，正常照片（如卡片背景压缩产物
      // 略超 500KB）表现为「设置成功、重启后被清掉回默认白板，每次都要重新设置」。
      // 配合上传端 compressImageFit 保证新设置的图都达标，存量略超标图保留在
      // 存储里（导出备份仍含），仅不渲染。
      if (v.length > BG_HARD_LIMIT) { try { store.remove(key); } catch (e) {} }
      return null;
    }
    return v;
  };

  // 头像（位于桌面纪念日卡片内，点击不触发卡片背景上传）
  function applyAvatar(id, key) {
    const box = document.getElementById(id);
    if (!box) return;
    const ring = box.querySelector('.ring');
    let saved = store.get(key);
    // v3.6.x：渲染前防护——256px 头像压缩后正常 <50KB；旧版本压缩失败时回退存过
    // 原图（可能十几 MB），直接渲染 img.src 会让 iOS Safari 解码崩溃（画面正常但
    // 点击无响应，且刷新后恢复数据再次崩溃）。发现超大值即清除（LS+IDB 双清），
    // 回到默认头像——保证存量坏数据在用户刷新后不再复现。
    if (saved && saved.length > 500 * 1024) {
      // v3.10.x：同 sanitizeBg——只跳过本次渲染，不再删数据（256px 正常头像远小于
      // 该阈值，触发即旧版原图残留；仅超硬上限的毒数据仍清除自愈）
      try { if (saved.length > 12 * 1024 * 1024) store.remove(key); } catch (e) {}
      saved = null;
    }
    // v3.6.x：img 用属性赋值（dataURL 含引号时拼 innerHTML 会逃逸注入 HTML）
    if (saved && ring) {
      ring.innerHTML = '';
      const img = document.createElement('img');
      img.src = saved;
      img.alt = '';
      ring.appendChild(img);
    } else if (ring) {
      // v3.6.x：当前联系人未设置头像（或数据异常被清）→ 清掉残留的上一联系人头像，
      // 否则多桌面切换后旧桌面的头像 img 会一直留在 DOM 里（切到无头像桌面仍显示旧头像）。
      // v3.6.x 修复：恢复模板默认人形矢量图（此前 innerHTML='' 把 template.html 里
      // 的默认 SVG 也一并清掉，无头像时桌面圆圈变空白，与聊天页默认头像不一致）
      ring.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>';
    }
  }
  // FIX 2026-09-18 #717（小米8 等多机型报「换头像，点导入图片没反应」，#677 同族）：此处原本
  // 点击时动态创建 input、**未挂进文档**就 click()——红米/真我等 Android Edge 系对这种用法会
  // 静默忽略（不弹系统选择器＝点了没反应），iOS Safari 对未挂载 input 不保证派发 change。
  // 改与 chat-settings.js headInput / chatcard.js pickFiles 已验证套路一致：常驻单个 input
  // 永久挂 body、移出屏幕可见（不用 display:none）、复用前清 value、click 包 try/catch 失败
  // 给可见提示。压缩/落库管线（compressImage 256 / store.set）一字不动。
  let avatarPickCb = null;
  const avatarPickInput = document.createElement('input');
  avatarPickInput.type = 'file'; avatarPickInput.accept = 'image/*';
  avatarPickInput.id = 'mochi-avatar-pick';
  // FIX 2026-09-18 #738：offscreen+opacity:0 换标准 sr-only clip 写法——小米浏览器对不可见
  // input 的激活更苛刻；clip 后命中区为零、不挡任何点击。原生 label 兜底见 device.js mochiFilePickLabel。
  avatarPickInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
  document.body.appendChild(avatarPickInput);
  // v8.29 #991（第九波）：选图后的处理抽成公共函数——sr-only input（老路径）与
  // 铺在头像盒上的真 input（surface，新路径）两条来源共用同一条压缩/落库管线，防止两处走偏。
  function avatarPickFile(f, cb) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      compressImage(reader.result, 256).then(data => {
        // v3.6.x：压缩失败/图片过大返回 null——不再存原图（防 iOS 解码崩溃），提示换图
        if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
        if (cb) cb(data);
      });
    };
    reader.readAsDataURL(f);
  }
  avatarPickInput.onchange = () => {
    const f = avatarPickInput.files && avatarPickInput.files[0];
    avatarPickInput.value = ''; // 允许重选同一文件
    if (!f) return;
    const cb = avatarPickCb; avatarPickCb = null;
    avatarPickFile(f, cb);
  };
  function bindAvatar(id, key) {
    const box = document.getElementById(id);
    if (!box) return;
    applyAvatar(id, key);
    // FIX 2026-09-18 #738：原生 label 激活兜底（小米浏览器对 JS 合成 click 静默不弹选择器）
    if (window.mochiFilePickLabel) window.mochiFilePickLabel(box, avatarPickInput);
    // 把图落到界面 + 存储（两条来源共用：点击兜底腿、以及手指点 surface input）
    const applyData = (data) => {
      const ring = box.querySelector('.ring');
      // v3.6.x：img 用属性赋值（dataURL 含引号时拼 innerHTML 会逃逸注入 HTML）
      if (ring) {
        ring.innerHTML = '';
        const img = document.createElement('img');
        img.src = data;
        img.alt = '';
        ring.appendChild(img);
      }
      store.set(key, data);
    };
    // FIX 2026-09-21 #991（第九波）：在头像盒内铺一层真·可点 file input——手指物理落在 input 上，
    // 浏览器按原生默认动作弹相册，不再依赖 label 转发 / JS 合成 click / showPicker 任何一条腿
    //（用户 2026-09-21 红米 Note 9 Pro + 自带浏览器报的正是「三条腿都在、点了仍没反应」那一类内核）。
    // 昵称 .lbl 的 z-index:1（#821）仍在它之上：点昵称＝改昵称、点圆圈/其余区域＝换头像。
    if (window.mochiFilePickSurface) {
      window.mochiFilePickSurface(box, {
        id: 'mochi-avatar-tap-' + id,
        accept: 'image/*',
        onFiles: (files) => { avatarPickFile(files && files[0], applyData); }
      });
    }
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      // ★ 先把回调武装好，再激活选择器（#756：兜底 click 会延后 60ms 触发，
      //   若回调在激活之后才赋值，用户秒选文件时会拿到 null 回调＝存不上）
      avatarPickCb = applyData;
      // FIX 2026-09-18 #756：原 `if (fromLabel(e)) return;` 会在「label 存在但内核不转发」时
      // 连 JS 兜底一起跳过＝彻底没反应（国产内核实况）。改为：label 只作加速路径，
      // 由 mochiFilePickGuard 确认「确实没弹出」后补 JS click。
      // FIX 2026-09-20 #920：兜底腿改走全站统一三腿（showPicker→click；小米系对合成 click 静默不弹）
      var _fallback = () => { window.mochiFilePickFire(avatarPickInput, { onFail: () => { avatarPickCb = null; toast('无法打开相册，请重试'); } }); };
      if (window.mochiFilePickGuard) window.mochiFilePickGuard(avatarPickInput, _fallback);
      else _fallback();
    });
  }
  bindAvatar('avatar-user', 'avatar-user');
  bindAvatar('avatar-partner', 'avatar-partner');

  // v3.5.113：IndexedDB 回填完成后（mochi-restore-done 事件）轻量重绘——
  // 头像/摸鱼值/聊天统计等只在启动时渲染一次的界面，导入/配额异常恢复后
  // 不会自动更新；这里统一重绘，不再整页 reload（v3.5.112 的回归修复）
  window.applyAvatars = function () {
    applyAvatar('avatar-user', 'avatar-user');
    applyAvatar('avatar-partner', 'avatar-partner');
    // 聊天页头像（chat.js 暴露的 fillAvatar）
    try {
      if (window.fillAvatar) {
        window.fillAvatar('chat-user-av', 'cs-avatar-user');
        window.fillAvatar('chat-partner-av', 'cs-avatar-partner');
      }
    } catch (e) {}
  };
try {
      document.addEventListener('mochi-restore-done', function () {
        window.applyAvatars();
        try { syncFishUI(); } catch (e) {}
        try { if (!gStore.get('fish-log-global-migrated')) migrateFishLogGlobal(true); } catch (e) {}
        try { updateFishDays(); } catch (e) {}
        // v3.5.116：回填完成后一并重绘桌面图标 + 壁纸——
        //   自定义图标/壁纸大键可能只存 IDB，回填完成前桌面显示的是默认/空白
        try { restoreAppIcons(); } catch (e) {}
        // #769：底部栏按钮图片同为大键只存 IDB——回填完成后一并重绘
        try { restoreTabbarIcons(); } catch (e) {} // #769h1 回填后重绘底部栏
        // FIX 2026-09-10 #265：图标【顺序】同款——app-icon-order-* 的 LS 副本与写日志都可能
        //   读不到（配额清理 / 日志 40 条预算把该键挤掉），脚本加载期那次同步应用只能拿到空值，
        //   回填把值送进存储层后却没人再排一次 → 用户装修的图标顺序整会话不生效（看起来就是
        //   「布局还原成初始」）。重排幂等（节点移动不重建），多跑一次无副作用。
        try { restoreAppIconOrder(); } catch (e) {}
        try { applyBgVisibility(); } catch (e) {}
        // v3.10.x：修复「退出重进后桌面卡片背景/页面背景/头像丢失变白板」——
        //   卡片背景(card-bg-*)、页面背景(page-bg-*)、图片组件(desk-image-src-*)都是
        //   大图键只存 IndexedDB，启动渲染时回填未完成读到空；旧重绘清单里没有它们，
        //   回填完成后界面一直停留在空白。现在补齐 + 直读兜底 + 延迟二次刷新。
        try { refreshDeskVisuals(); } catch (e) {}
        try { rescueDeskVisuals(); } catch (e) {}
        setTimeout(function () {
          try { refreshDeskVisuals(); } catch (e) {}
        }, 1800);
      });
    } catch (e) {}

  // ===== v3.26.x #408：粘贴导入 JSON 跨机型自救解析（IQOO Neo10 vivo 浏览器报障「美化导入解析失败」同族，多机型通用） =====
  // 安卓各浏览器 ce-box（contenteditable）粘贴链路与聊天 App 转发链路会把方案 JSON 弄脏：
  // BOM/零宽/双向控制字符、nbsp 空格、前后包裹说明文字、中文引号/全角标点（输入法/转发改写）、
  // 尾逗号——JSON.parse 直接抛「解析失败」。统一自救：原文 → 清洗隐形字符 → 裁剪首{到末}
  // → 字符串外全角标点归一；只在候选真正解析成功且为顶层对象时才采用（任何清洗不回写原文、
  // 不污染字符串内的中文标点）；全部失败抛最后一次真实报错（诊断现场可自证机型链路）。
  window.mochiParsePastedJSON = function (raw) {
    const t0 = String(raw == null ? '' : raw);
    let lastErr = null;
    const ok = (s) => {
      try {
        const d = JSON.parse(s);
        if (d && typeof d === 'object' && !Array.isArray(d)) return d;
        lastErr = new Error('内容不是方案对象');
      } catch (e) { lastErr = e; }
      return null;
    };
    let d = ok(t0); if (d) return d;
    // ① 隐形字符清洗：BOM/零宽/双向控制删除 + nbsp 转普通空格（contenteditable 粘贴常见）
    const t1 = t0.replace(/[\uFEFF\u200B-\u200F\u2060\u202A-\u202E]/g, '').replace(/\u00A0/g, ' ').trim();
    d = ok(t1); if (d) return d;
    // ② 前后被说明文字/引号包裹（转发/复制带出）：裁剪首个 { 到末个 } 再试
    const a = t1.indexOf('{'), b = t1.lastIndexOf('}');
    if (a >= 0 && b > a) { d = ok(t1.slice(a, b + 1)); if (d) return d; }
    // ③ 全角标点自救：只把「字符串外」的 ，、：｛｝［］ 换半角并丢弃 }]/] 前尾逗号——
    //    逐字符扫描跳过字符串内部，中文值里的全角标点原样保留；没有半角引号时先归一中文引号
    const scanNorm = (s) => {
      let out = '', inStr = false, esc = false;
      for (let i = 0; i < s.length; i++) {
        let c = s[i];
        if (inStr) {
          out += c;
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
        } else {
          if (c === '"') { inStr = true; out += c; continue; }
          if (c === '，' || c === '、') c = ',';
          else if (c === '：') c = ':';
          else if (c === '｛') c = '{';
          else if (c === '｝') c = '}';
          else if (c === '［') c = '[';
          else if (c === '］') c = ']';
          if (c === ',') {
            let j = i + 1;
            while (j < s.length && /\s/.test(s[j])) j++;
            if (j < s.length && (s[j] === '}' || s[j] === ']' || s[j] === '｝' || s[j] === '］')) continue;
          }
          out += c;
        }
      }
      return out;
    };
    const hasDq = t1.indexOf('"') >= 0;
    const variants = hasDq ? [t1] : [t1.replace(/[“”＂‟〝〞]/g, '"'), t1];
    for (let k = 0; k < variants.length; k++) {
      d = ok(scanNorm(variants[k])); if (d) return d;
      const a2 = variants[k].indexOf('{'), b2 = variants[k].lastIndexOf('}');
      if (a2 >= 0 && b2 > a2) { d = ok(scanNorm(variants[k].slice(a2, b2 + 1))); if (d) return d; }
    }
    // ④ #879 整份网页自救：美化方案经分享/售卖链路常被打包成网页文件（收到 .html → 打开全选复制，
    //    或选文件时直接选了 .html），方案 JSON 被标签/属性打断，①~③ 全失效 → 天书 JSON error
    //    （苹果11 Safari 实报「美化文件导入用不了」，收 9916 字符开头 <!DOCTYPE html>，多机型同现、
    //    纯数据链路与机型无关）。分两层：先取 <textarea>/<pre>/<script type="application/json">
    //    容器内文（HTML 实体还原）；再对全文做字符串感知的花括号配平扫描取 {...} 候选、按长度降序
    //    （方案对象几乎总是页面里最大的 JSON）。每个候选走与顶层相同的清洗梯子（隐形字符/裁剪/
    //    全角归一/实体还原），只在真正解析成顶层对象时才采用——提不出/提错都照旧抛错，由导入方的
    //    用途校验兜底（识别不到美化项会如实提示，不会误导入）。
    const htmlLike = /<!doctype\s*html|<html[\s>]|<body[\s>]|<textarea[\s>]/i.test(t1);
    if (htmlLike) {
      const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&amp;/g, '&');
      const ladder = (s) => {
        if (!s || s.indexOf('{') < 0) return null;
        let x = ok(s); if (x) return x;
        const c1 = ent(s.replace(/[\uFEFF\u200B-\u200F\u2060\u202A-\u202E]/g, '').replace(/\u00A0/g, ' ').trim());
        x = ok(c1); if (x) return x;
        const a3 = c1.indexOf('{'), b3 = c1.lastIndexOf('}');
        if (a3 >= 0 && b3 > a3) { x = ok(c1.slice(a3, b3 + 1)); if (x) return x; }
        const v2 = c1.indexOf('"') >= 0 ? [c1] : [c1.replace(/[“”＂‟〝〞]/g, '"'), c1];
        for (let k2 = 0; k2 < v2.length; k2++) {
          x = ok(scanNorm(v2[k2])); if (x) return x;
          const a4 = v2[k2].indexOf('{'), b4 = v2[k2].lastIndexOf('}');
          if (a4 >= 0 && b4 > a4) { x = ok(scanNorm(v2[k2].slice(a4, b4 + 1))); if (x) return x; }
        }
        return null;
      };
      try {
        const re = /<(textarea|pre|script)([^>]*)>([\s\S]*?)<\/\1>/gi;
        let mm, bags = [];
        while ((mm = re.exec(t1)) !== null) {
          if (/^(textarea|pre)$/.test(mm[1].toLowerCase()) || /application\/json/i.test(mm[2])) bags.push(ent(mm[3]));
        }
        for (let bi = 0; bi < bags.length; bi++) { d = ladder(bags[bi]); if (d) return d; }
      } catch (e) {}
      try {
        const spans = [];
        let inStr = false, esc = false, depth = 0, st = -1;
        for (let i = 0; i < t1.length; i++) {
          const c = t1[i];
          if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
          if (c === '"') { inStr = true; continue; }
          if (c === '{') { if (depth === 0) st = i; depth++; }
          else if (c === '}') { if (depth > 0) { depth--; if (depth === 0 && st >= 0) { if (i - st >= 40) spans.push(t1.slice(st, i + 1)); st = -1; } } }
        }
        if (spans.length > 1) spans.sort((p, q) => q.length - p.length);
        const cap = Math.min(spans.length, 60);
        for (let pi = 0; pi < cap; pi++) { d = ladder(spans[pi]); if (d) return d; }
      } catch (e) {}
      // 提取失败给可行动报错（替代天书；失败现场仍由调用方写诊断）
      lastErr = new Error('粘贴的是网页不是方案文本：没能从中提取出方案代码。请打开原文件，只复制 { 开头、} 结尾的方案代码（或让对方重新导出 .json 文件）再粘贴');
    }
    throw (lastErr || new Error('不是有效的方案 JSON'));
  };

  // 通用弹层：IAB 不支持 prompt/confirm，用页面内模态框替代；支持输入 / 色板
  (function () {
    const mask = document.getElementById('modal-mask');
    // v3.27.x：opts 是 window.openModal 的函数参数（函数体在 return ctl 处结束），
    // IIFE 作用域里的 change 监听器（txtImportAuto 自动提交）直接引用 opts 会抛
    // ReferenceError → 文件导入静默失败（"导入美化方案选完文件没反应"）。
    // 每次打开时把 opts 存到 IIFE 级变量供监听器读取。
    let _modalOpts = null;
    const modalBox = mask ? mask.querySelector('.modal') : null;
    const title = document.getElementById('modal-title');
    const staticEl = document.getElementById('modal-static');
    const input = document.getElementById('modal-input');
    const textarea = document.getElementById('modal-textarea');
    const swatches = document.getElementById('modal-swatches');
    const pillsEl = document.getElementById('modal-pills');
    const sliderRow = document.getElementById('modal-slider');
    const sliderLabel = document.getElementById('modal-slider-label');
    const sliderVal = document.getElementById('modal-slider-val');
    const sliderRange = document.getElementById('modal-slider-range');
    const sliderPreview = document.getElementById('modal-slider-preview');
    const sliderPreviewIco = document.getElementById('modal-slider-preview-ico');
    const colorInput = document.getElementById('modal-color');
    const customBtn = document.getElementById('modal-custom');
    const selectEl = document.getElementById('modal-select');
    const groupChipsEl = document.getElementById('modal-group-chips');
    const fileBtn = document.getElementById('modal-file');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');
    const copyBtn = document.getElementById('modal-copy');
    const exportBtn = document.getElementById('modal-export');
    if (!mask || !input) return;
    // v3.10.x：vivo/OPPO Edge 等安卓内核对 ce-box（mobile-adapt 输入转换器）的
    // value 代理支持不完整——弹窗里明明打完字，点确定读 input.value 却是空，
    // 所有走通用弹窗的保存（昵称/金额/存钱罐小心愿…）静默失败。
    // 读值兜底：代理读到空时直接找接管输入的 .ce-box 取文本（同 music-player 方案）；
    // 聚焦兜底：有 ce-box 时直接聚焦它（focus 可能没被代理到，键盘不弹）。
    function ceBoxOf(el) {
      try {
        if (el.__ceBox) return el.__ceBox;
        if (el.parentNode) return el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]');
      } catch (e) {}
      return null;
    }
    function readModalVal(el) {
      try { const v = el.value; if (v != null && String(v).length) return String(v); } catch (e) {}
      const box = ceBoxOf(el);
      if (box) { try { const t = (box.innerText !== undefined ? box.innerText : box.textContent) || ''; if (t.length) return t; } catch (e) {} }
      try { return el.value || ''; } catch (e) { return ''; }
    }
    let cb = null;
    // v3.13.x：胶囊构建抽出共用——openModal 打开时与控制器 ctl.pills() 阶段切换
    // 都走这一份（选中态/点击翻转/pillClicked 语义不变）
    function buildPills(list, initVal) {
      pillClicked = false;
      pillVal = initVal !== undefined ? initVal : null;
      pillsEl.hidden = !(list && list.length);
      pillsEl.innerHTML = '';
      if (list && list.length) {
        list.forEach(p => {
          const b = document.createElement('button');
          b.className = 'pill' + (p.value === pillVal ? ' on' : '');
          b.textContent = p.label;
          b.addEventListener('click', () => {
            Array.prototype.forEach.call(pillsEl.children, c => c.classList.remove('on'));
            b.classList.add('on');
            pillVal = p.value;
            pillClicked = true;
            // v3.20.x：pillSubmit——点选即提交（单坎作答等纯单选弹窗），
            // 用定时器让选中态先渲染一帧再走 fire()/close()（与 okBtn 同一回调路径）
            // v3.27.x：嵌套弹窗守卫同 okBtn——fire 内开了新弹窗则不 close
            if (pillSubmit) {
              const _s = _openSeq;
              setTimeout(function () { try { fire(); } finally { if (_openSeq === _s) close(); } }, 0);
            }
          });
          pillsEl.appendChild(b);
        });
      }
    }
    let pillsOnOk = null;
    // v3.20.x：pillSubmit——纯单选胶囊弹窗（查岗作答等）点选即提交，无需再点底部
    // 确定按钮。此前点胶囊又得再点确认，配合确认按钮曾残留错误文案，用户以为
    // 点选项即选上，实际未提交 → 作答完全不落地（卡片不更新、无回答气泡）。
    let pillSubmit = false;
    let noInput = false;
    let picked = -1;
    let customVal = null;
    let pillVal = null;
    let selectedGroup = null;
    let lock = false;
    // v3.13.x：「本次确定后保持打开」标记——cb 里调 ctl.stay() 置位，紧随其后的
    // close()（okBtn/Enter 的 finally）只跳过这一次。供同一弹窗内做多阶段表单
    // （钱包两侧连填/存钱罐金额→留言/记账分类管理），取代旧「60ms 后开第二层」
    // 的嵌套写法——真机键盘收起/再聚焦竞态会让第二层弹窗无法输入。
    let stayOnce = false;
    let sliderCfg = null;
    let sliderInitPill = null;
    // v3.27.x：弹窗打开序号——okBtn/Enter 的 finally close() 只在自己「本次打开」
    // 未变化时才关闭（fire() 的 cb 若同步打开了新弹窗，_openSeq 已递增 → 跳过关闭，
    // 新弹窗保留）。修「导出美化方案」等嵌套弹窗：外层确定把刚打开的下一层弹窗
    // 立即关掉（stayOnce 会被内层 openModal 重置，扛不住跨弹窗嵌套）。
    let _openSeq = 0;
    // FIX 2026-09-15 #522 弹窗打开时刻——供遮罩 click 判定「本次点击是否为刚打开它的那次触摸
    // 补发的合成 click」。touch 直驱（如聊天消息菜单【编辑】touchend→openModal）打开弹窗后，
    // 健康内核补发的 click 会按新布局命中 #modal-mask 触发 close，弹窗刚开即关（改 src 侧已用
    // preventDefault 溯源抑制；这里是弹层通用兜底，任何未来的直驱开弹窗都受保护）。
    let _openedAt = 0;
    // v3.6.x：用户是否真的点过 pill——区分「opts.pill 预设值」与「用户主动选择」。
    // 修复：今天的心情/字体大小等「pills + 输入框 + pill 预设」弹窗里，用户输入文字点确定时，
    // fire() 的 pills 分支误把预设的旧 pillVal 传回回调，输入的文本被丢弃（卡片不更新）。
    let pillClicked = false;
    window.openModal = function (t, v, fn, opts) {
      opts = opts || {};
      _modalOpts = opts;
      _openSeq++;
      _openedAt = Date.now();
      // v3.25.x：opts.big——宽版弹窗（诊断信息等长文只读展示），配合 CSS
      // .modal.modal--big 加宽 + 放大输入框；每次开弹窗按 opts.big 重设类，天然复位。
      if (modalBox) modalBox.classList.toggle('modal--big', !!opts.big);
      // v3.3x.x：opts.warn——警示形态（红描边/红标题/红底说明，样式见 base.css .modal--warn）。
      // 备份提醒用它：「数据会被设备自动清空」这条必须一眼被看见。同 big 一样每次开弹窗重设类。
      if (modalBox) modalBox.classList.toggle('modal--warn', !!opts.warn);
      // v3.20.x：每次打开弹窗重置底部确认按钮文案为默认「确定」——此前只在调用方显式
      // ctl.okText() 时才会写，若某次弹窗（如心意币「申请」）设过、下一个弹窗
      // （如跨桌面通话/查岗的 pill 弹窗）没设，按钮就残留显示上一个弹窗文案。
      // 需要定制文案的调用方在 openModal 返回后调 ctl.okText() 覆盖即可。
      if (okBtn) okBtn.textContent = '确定';
      stayOnce = false;
      pillsOnOk = opts.pillsOnOk || null;
      pillSubmit = !!(opts.pillSubmit);
      noInput = !!(opts.noInput);
      pillClicked = false;
      // v3.6.x：opts.lock——锁定弹窗（换头像邀请等必须做出选择）：
      // 点遮罩不关闭、隐藏取消按钮，只能走确定（含 pills/输入）路径
      lock = !!(opts.lock);
      if (cancelBtn) cancelBtn.hidden = lock;
      title.textContent = t;
      if (staticEl) {
        staticEl.hidden = !opts.staticText;
        // opts.staticEmph：文案里 **…** 圈出的重点单独上色（.modal-static-key），其余仍是普通说明色。
        // 只走 createTextNode/createElement + textContent，调用方传的文本永不被当 HTML 解析。
        if (opts.staticEmph) {
          const segs = String(opts.staticText || '').split('**');
          staticEl.textContent = '';
          for (let i = 0; i < segs.length; i++) {
            if (!segs[i]) continue;
            if (i % 2) {
              const key = document.createElement('b');
              key.className = 'modal-static-key';
              key.textContent = segs[i];
              staticEl.appendChild(key);
            } else staticEl.appendChild(document.createTextNode(segs[i]));
          }
        } else staticEl.textContent = opts.staticText || '';
      }
      input.hidden = noInput || !!opts.textarea;
      input.value = v || '';
      // v3.5.130：maxlength 由调用方控制——模板不再写死 12（编辑消息/备忘会被截断）；
      // 昵称类短输入传 opts.maxlength，编辑消息等不传
      if (opts.maxlength) input.maxLength = opts.maxlength;
      else input.removeAttribute('maxlength');
      // v3.13.x：opts.placeholder——单行输入占位符（此前调用方传了也被静默忽略，
      // 如 pomo 设时长/单选题选项；ce-box 转换后 placeholder 走代理 setter 同步
      // 到 box 的 data-ph，原生输入框与安卓转换框两端一致生效）
      if ('placeholder' in opts) { try { input.placeholder = opts.placeholder || ''; } catch (e) {} }
      // v3.13.x：opts.inputmode——金额等数字弹窗弹数字键盘；ghost 与已生成的
      // ce-box 都要写（转换器只在转换瞬间复制一次该属性）
      // v3.26.x：必须无条件归一化——#modal-input 是全站共用的同一个元素，某次金额弹窗
      // 设了 inputmode=decimal 后，下一次普通文字弹窗（梦角档案/我的档案等）若不重置，
      // 残留的 decimal 会让手机（含安卓 ce-box）弹数字键盘。传了按传的写、没传一律清除。
      var _im = ('inputmode' in opts) ? (opts.inputmode || '') : '';
      try { if (_im) input.setAttribute('inputmode', _im); else input.removeAttribute('inputmode'); } catch (e) {}
      try { const _b = ceBoxOf(input); if (_b) { if (_im) _b.setAttribute('inputmode', _im); else _b.removeAttribute('inputmode'); } } catch (e) {}
      if (textarea) {
        textarea.hidden = !opts.textarea;
        if (opts.textarea) {
          textarea.value = v || '';
          textarea.placeholder = opts.textareaPlaceholder || '多行内容';
          // v3.25.x：opts.textareaRows——指定多行框行数（诊断信息等长文只读展示，
          // 默认模板 rows="3" 装不下 14 行诊断内容，iOS 原生框不随内容增高会显得很小）
          if (opts.textareaRows) { try { textarea.rows = opts.textareaRows; } catch (e) {} }
        }
      }
      // 目标分组下拉
      if (selectEl) selectEl.hidden = true;
      // v3.28.x：目标分组改自定义胶囊选择（替代原生 <select>——用户反馈批量导入弹窗
      // 里「导入到现有分组」弹的是浏览器自带下拉框，需改为网站内样式）。用可点选的
      // 胶囊行（可横滑），默认「导入到新分组（按【组名】识别）」，点选即高亮并记录。
      selectedGroup = null;
      if (groupChipsEl) {
        groupChipsEl.hidden = !(opts.groups && opts.groups.length);
        groupChipsEl.innerHTML = '';
        if (opts.groups && opts.groups.length) {
          const mk = (value, label) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pill' + (value === selectedGroup ? ' on' : '');
            b.textContent = label;
            b.addEventListener('click', () => {
              Array.prototype.forEach.call(groupChipsEl.children, c => c.classList.remove('on'));
              b.classList.add('on');
              selectedGroup = value;
            });
            return b;
          };
          groupChipsEl.appendChild(mk(null, '导入到新分组（按【组名】识别）'));
          opts.groups.forEach(g => groupChipsEl.appendChild(mk(g, g)));
        }
      }
      // txt 文件导入
      // FIX 2026-09-18 #755：原 #modal-file-input 写在 template.html 里带 style="display:none"
      // （部分国产内核拒绝激活不可见 input）→ 收编进统一入口 window.mochiFilePick。
      if (fileBtn) {
        fileBtn.hidden = !opts.txtImport;
        fileBtn.onclick = () => {
          window.mochiFilePick({
            id: 'dev-modal-file-pick',
            accept: '.txt,.json,text/plain,application/json',
            onFiles: (files) => readTxtInto(files && files[0])
          });
        };
      }
      // 色板
      swatches.hidden = !(opts.swatches && opts.swatches.length);
      swatches.innerHTML = '';
      picked = -1;
      customVal = null;
      if (opts.swatches && opts.swatches.length) {
        opts.swatches.forEach((label, i) => {
          const s = document.createElement('span');
          s.className = 'sw' + (i === opts.pick ? ' on' : '');
          s.style.background = label.color;
          s.title = label.label;
          s.addEventListener('click', () => {
            Array.prototype.forEach.call(swatches.children, c => c.classList.remove('on'));
            s.classList.add('on');
            picked = i;
            customBtn.classList.remove('on');
          });
          swatches.appendChild(s);
        });
      }
      // 选项胶囊（pills）——构建逻辑抽到 buildPills（ctl.pills 阶段切换共用）
      buildPills(opts.pills, opts.pill);
      // 自定义取色（简约按钮）
      customBtn.hidden = !opts.colorPicker;
      customBtn.classList.remove('on');
      if (opts.colorPicker && opts.pick === -2) customBtn.classList.add('on');
      if (opts.color) colorInput.value = opts.color;
      // v3.6.x：滑块（数值调整，如图标圆角）——opts.slider = { min, max, step, value, label, unit, preview, onChange }
      sliderCfg = (opts.slider && typeof opts.slider === 'object') ? opts.slider : null;
      sliderInitPill = pillVal;
      if (sliderRow) {
        sliderRow.hidden = !sliderCfg;
        if (sliderCfg) {
          const min = sliderCfg.min != null ? sliderCfg.min : 0;
          const max = sliderCfg.max != null ? sliderCfg.max : 100;
          const step = sliderCfg.step != null ? sliderCfg.step : 1;
          const val = sliderCfg.value != null ? sliderCfg.value : min;
          sliderRange.min = min; sliderRange.max = max; sliderRange.step = step;
          sliderRange.value = val;
          if (sliderLabel) sliderLabel.textContent = sliderCfg.label || '';
          if (sliderVal) sliderVal.textContent = val + (sliderCfg.unit || '');
          if (sliderPreview) {
            sliderPreview.hidden = !sliderCfg.preview;
            if (sliderCfg.preview && sliderPreviewIco) sliderPreviewIco.style.borderRadius = val + 'px';
          }
          if (sliderCfg.onChange) { try { sliderCfg.onChange(val); } catch (e) {} }
        }
      }
      cb = fn;
      mask.hidden = false;
      // v3.5.133：多行模式聚焦 textarea（原只 focus 单行 input——多行模式下 input 隐藏、
      // focus 打在 display:none 元素上，键盘不弹，批量导入用户首触必失败一次）
      setTimeout(() => {
        if (noInput) return;
        const target = (opts.textarea && textarea) ? textarea : input;
        if (!target) return;
        const box = ceBoxOf(target);
        try { if (box) { box.focus(); return; } } catch (e) {}
        try { target.focus(); } catch (e) {}
      }, 60);
      // v3.13.x：弹窗控制器——openModal 现在返回 ctl（旧调用方忽略返回值，零影响）。
      // 回调里用 ctl.stay() 让「本次确定」不关窗，再配合下列方法就地切换到下一阶段，
      // 实现单弹窗多阶段表单（钱包两侧连填/存钱罐/记账分类管理），消除嵌套竞态。
      const ctl = {
        stay: function () { stayOnce = true; },
        title: function (s) { title.textContent = String(s == null ? '' : s); },
        hint: function (s) { if (staticEl) { staticEl.hidden = !s; staticEl.textContent = s || ''; } },
        text: function (s) {
          // v3.26.x：无参时作为 getter 返回当前文本——诊断信息等只读弹窗的
          // 「复制/导出」按钮用 ctl.text() 拿最新内容（此前只有 setter 语义，
          // 传空参返回 undefined，导致复制出「undefined」）。有参时维持 setter。
          if (arguments.length === 0) {
            try {
              if (textarea && !textarea.hidden) return textarea.value;
              if (!input.hidden) return input.value;
            } catch (e) {}
            return '';
          }
          try { input.value = s || ''; } catch (e) {}
        },
        maxLen: function (n) { try { if (n) input.maxLength = n; else input.removeAttribute('maxlength'); } catch (e) {} },
        ph: function (s) { try { input.placeholder = s || ''; } catch (e) {} },
        okText: function (s) { if (okBtn) okBtn.textContent = s || '确定'; },
        focus: function () {
          setTimeout(function () {
            if (noInput) return;
            const b3 = ceBoxOf(input);
            try { if (b3) { b3.focus(); return; } } catch (e) {}
            try { input.focus(); } catch (e) {}
          }, 60);
        },
        // 显示/隐藏输入框（安卓 ce-box 的显隐由转换器 MutationObserver 自动跟随）
        input: function (show) {
          noInput = !show;
          input.hidden = !show;
          if (show) ctl.focus();
        },
        // 重建胶囊组；传空数组/null 隐藏。initVal 设初始选中项
        pills: function (list, initVal) { buildPills(list, initVal); },
        // #576：ctl.close()——调用方主动关窗（存储异常弹窗「去导出备份/查看存储」直达
        // 按钮跳转成功后关闭）。走与取消/遮罩同一个 close()（含 stayOnce/关键盘语义），
        // 不另开直接摘 mask 的口子；失败静默（弹窗留在原地，调用方有手动路径兜底）。
        close: function () { try { close(); } catch (e) {} }
      };
      // v3.16.x：opts.copyBtn——弹窗底部「复制」按钮（诊断信息等只读展示场景）。
      // 传 { label, fn }，fn(ctl) 在点击时调用，可用 ctl.hint() 就地反馈复制结果；
      // 不传则按钮保持隐藏，对既有弹窗零影响。
      if (copyBtn) {
        const cfg = opts.copyBtn || null;
        copyBtn.hidden = !cfg;
        copyBtn.onclick = null;
        if (cfg) {
          if (cfg.label) copyBtn.textContent = cfg.label;
          if (typeof cfg.fn === 'function') {
            copyBtn.onclick = function () { try { cfg.fn(ctl); } catch (e) {} };
          }
        }
      }
      // v3.25.x：opts.exportBtn——与 copyBtn 同机制的第二个自定义按钮（诊断信息
      // 「导出txt」等：大文本剪贴板可能截断，下载文件兜底）。不传则隐藏，零影响。
      if (exportBtn) {
        const cfg2 = opts.exportBtn || null;
        exportBtn.hidden = !cfg2;
        exportBtn.onclick = null;
        if (cfg2) {
          if (cfg2.label) exportBtn.textContent = cfg2.label;
          if (typeof cfg2.fn === 'function') {
            exportBtn.onclick = function () { try { cfg2.fn(ctl); } catch (e) {} };
          }
        }
      }
      // v3.27.x #794：opts.extraBtn——第三个自定义按钮位（#modal-extra，诊断报告
      // 「一键修正」这类"看完就地行动"场景；copy/export 是"带走"，extra 是"修"）。
      // 每次打开按 opts 重置显隐与文案，不传保持隐藏，对既有弹窗零影响。
      const extraBtnEl = document.getElementById('modal-extra');
      if (extraBtnEl) {
        const cfg3 = opts.extraBtn || null;
        extraBtnEl.hidden = !cfg3;
        extraBtnEl.onclick = null;
        if (cfg3) {
          if (cfg3.label) extraBtnEl.textContent = cfg3.label;
          if (typeof cfg3.fn === 'function') {
            extraBtnEl.onclick = function () { try { cfg3.fn(ctl); } catch (e) {} };
          }
        }
      }
      return ctl;
    };
    // iOS Safari：<input type="color"> 处于 display:none（hidden）时 .click() 不会弹取色器，
    // 点击【自定义颜色】前先临时取消隐藏并改成离屏（不占布局不挡触摸），
    // 再在本帧内点击触发原生取色器；取完色/取消后恢复隐藏。
    customBtn.addEventListener('click', function () {
      if (!colorInput) return;
      colorInput.hidden = false;
      colorInput.style.cssText = 'position:fixed;left:-9999px;top:0;width:40px;height:30px;opacity:0;pointer-events:none;z-index:-1;';
      void colorInput.offsetWidth; // 强制回流，确保 iOS 判定该元素已渲染
      try { colorInput.click(); } catch (e) { try { colorInput.hidden = true; colorInput.style.cssText = ''; } catch (e2) {} }
    });
    // v3.6.x：滑块拖动——实时更新值/预览块/onChange（图标圆角所见即所得）
    if (sliderRange) {
      sliderRange.addEventListener('input', () => {
        if (!sliderCfg) return;
        const val = parseInt(sliderRange.value, 10);
        if (sliderVal) sliderVal.textContent = val + (sliderCfg.unit || '');
        if (sliderPreviewIco) sliderPreviewIco.style.borderRadius = val + 'px';
        if (sliderCfg.onChange) { try { sliderCfg.onChange(val); } catch (e) {} }
      });
    }
    colorInput.addEventListener('change', () => {
      customVal = colorInput.value;
      Array.prototype.forEach.call(swatches.children, c => c.classList.remove('on'));
      customBtn.classList.add('on');
      picked = -2;
      // 取完色后把离屏状态恢复隐藏（值已进 customVal，不影响后续）
      try { colorInput.hidden = true; colorInput.style.cssText = ''; } catch (e) {}
    });
    function close() {
      if (stayOnce) { stayOnce = false; return; } // ctl.stay()：本次确定不关闭，cb 已就地切到下一阶段
      // FIX 2026-09-15 #542：关弹窗前先显式收起输入法（同 #512 问问TA 半框）。用户报（红米 K80
      // Chrome，明说其他机型也有）：「桌面弹出输入文字的弹窗，点输入框后用输入法收起，回弹很慢、
      // 看到大片灰底」。根因：关闭弹窗时弹窗内输入框（安卓已转 .ce-box）正持有焦点，直接 hidden
      // ＝把「聚焦中的可编辑元素」从布局摘掉——一批内核/输入法不为这种移除派 focusout、也不派
      // visualViewport.resize，移动适配层的收键盘链拿不到证据 → .phone 内联收缩高停在键盘期数值，
      // 键盘位置一直露 body 灰底，要等看门狗「2.2s 无活动」才复原（继续点/滑就更久）。
      // 修法：先 blur 走标准失焦链（focusout 必派发、有界快速复原当场生效），再向移动层报备一次
      // 有界兜底（连 focusout 都不派的内核）。零机型分支：无聚焦时 blur 与报备均为空操作，
      // iOS/桌面不受影响。
      try {
        var _ae = document.activeElement;
        if (_ae && (_ae.tagName === 'INPUT' || _ae.tagName === 'TEXTAREA' || _ae.isContentEditable)
            && mask.contains(_ae)) {
          try { _ae.blur(); } catch (eB) {}
        }
        if (window.mochiKbDismiss) { try { window.mochiKbDismiss(); } catch (eD) {} }
      } catch (eC0) {}
      mask.hidden = true; cb = null;
    }
    function fire() {
      if (!cb) return;
      // 色板/自定义取色优先于 pills（v3.6.x：widget 颜色等弹窗同时带 pills 和色板时，
      // 点色板确定被 pills 分支拦截传 null → 设置不生效）
      if (swatches && !swatches.hidden && (picked === -2 || picked >= 0)) {
        if (picked === -2 && customVal) { cb(customVal); return; }
        if (picked >= 0) { cb(picked); return; }
      }
      // v3.6.x：滑块弹窗——先于 pills 判断（滑块弹窗可能带「恢复默认」pill）：
      // 用户点过 pill（值变化）→ 走 pills（如恢复默认）；否则提交滑块当前值
      if (sliderRow && !sliderRow.hidden && sliderCfg) {
        if (pillsEl && !pillsEl.hidden && pillVal !== sliderInitPill) {
          if (pillsOnOk) pillsOnOk(pillVal);
          cb(pillVal);
          return;
        }
        cb(parseInt(sliderRange.value, 10));
        return;
      }
      // v3.6.x：pills 分支只在「用户点过 pill」或「纯 pill 弹窗（noInput）」时走——
      // 用 pillClicked 判断（之前用 pillVal !== null 会被 opts.pill 预设值干扰，
      // 导致「今天的心情」等弹窗输入文字点确定时旧 pill 值覆盖输入）
      if (pillsEl && !pillsEl.hidden && (pillClicked || noInput)) {
        if (pillsOnOk) pillsOnOk(pillVal);
        cb(pillVal);
        return;
      }
      if (textarea && !textarea.hidden) { cb(readModalVal(textarea), selectedGroup); return; }
      if (swatches.hidden) cb(noInput ? 'ok' : readModalVal(input));
      else if (picked === -2 && customVal) cb(customVal);
      else if (picked >= 0) cb(picked);
    }
    // 分组下拉变化
    if (selectEl) {
      selectEl.addEventListener('change', () => { selectedGroup = selectEl.value || null; });
    }
    // txt 文件读取
    // FIX 2026-09-18 #755：原监听挂在模板 input 上；收编后改由 readTxtInto(f) 承接，
    // 编码探测/自动提交逻辑一字未动（仅入口从 change 事件换成 onFiles 回调）。
    function readTxtInto(f) {
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        // v3.18.x：修复 txt 乱码——readAsText 默认按 UTF-8 解码，中文 txt 常为
        // GBK/GB2312（ANSI）编码（Windows 记事本等保存），会被解成乱码。
        // 改为读 ArrayBuffer 探测编码：能按 UTF-8 严格解（合法序列+自动去 BOM）就用 UTF-8，
        // 解不了说明是 GBK 系，回退用 gb18030（GBK 超集）解码。
        let txt = '';
        try {
          const buf = reader.result;
          if (buf) {
            try {
              txt = new TextDecoder('utf-8', { fatal: true }).decode(buf);
            } catch (e) {
              try {
                txt = new TextDecoder('gb18030').decode(buf);
              } catch (e2) {
                txt = new TextDecoder('utf-8').decode(buf); // 兜底
              }
            }
          }
        } catch (e) { txt = String(reader.result || ''); }
        if (textarea) textarea.value = txt;
        // v3.27.x：文件导入直接生效——否则选完文件还需再点一次「确定」，
        // 手机上用户以为选了文件就导入、没点确定，导致「导入了却没应用」。
        // 仅 opts.txtImportAuto 的弹窗开启自动提交（opts 经 _modalOpts 引用，
        // 直接引用函数参数 opts 会 ReferenceError，见 IIFE 顶部注释）。
        // 直接 cb(txt) 而非 fire()：导入弹窗为 noInput（无输入框/textarea），
        // fire() 的 noInput 分支会传 'ok' 导致 JSON 解析失败。
        if (_modalOpts && _modalOpts.txtImportAuto) {
          try { if (cb) cb(txt); } catch (e) {}
          try { close(); } catch (e) {}
        }
      };
      reader.onerror = () => { try { window.toast && window.toast('文件读取失败'); } catch (e) {} };
      reader.readAsArrayBuffer(f);
    }
    okBtn.addEventListener('click', () => {
      // v3.5.130：回调抛异常（如存储配额满）也必须关闭弹窗，防止残留卡死
      // v3.27.x：期间打开过新弹窗（_openSeq 变化）则不关——嵌套弹窗由 fire 内 openModal 接管
      const _s = _openSeq;
      try { fire(); } finally { if (_openSeq === _s) close(); }
    });
    cancelBtn.addEventListener('click', close);
    mask.addEventListener('click', (e) => {
      if (e.target !== mask || lock) return;
      // FIX 2026-09-15 #522 忽略触发本次打开的那次触摸补发的合成 click（见 _openedAt 注释）。
      // 350ms 远大于内核补发 click 的延迟（通常同帧~百毫秒内），正常点遮罩关闭不受影响。
      if (Date.now() - _openedAt < 350) return;
      close();
    });
    input.addEventListener('keydown', (e) => {
      // v3.6.x：与 OK 按钮一致用 try/finally——回调抛异常（如存储配额满）时也必须
      // 关闭弹窗，否则残留卡死、后续再点 OK 每次都抛
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        const _s = _openSeq;
        try { fire(); } finally { if (_openSeq === _s) close(); }
      }
    });
  })();

  // 昵称（点击「我」/「TA」下方文字，弹层修改）
  function bindLabel(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    const saved = store.get(key);
    if (saved) el.textContent = saved;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.openModal) {
        window.openModal('修改昵称', el.textContent, (v) => {
          const val = (v || '').trim();
          if (val) {
            // v3.26.x：改前先记有效昵称（聊天独立昵称 cs-lbl-partner 优先）——变化时接入
            // 系统消息昵称清扫，与 chat-settings / contacts 改名路径行为一致
            let oldEff = '';
            if (key === 'lbl-partner') oldEff = store.get('cs-lbl-partner') || store.get('lbl-partner') || 'TA';
            el.textContent = val;
            store.set(key, val);
            // 同步聊天页顶部标题——必须走 renderChatHeader（按 cs-lbl-partner 优先解析）：
            // 直写 textContent 会把已设置的「聊天独立昵称」顶掉（反馈：设置了独立仍显示桌面名）
            if (key === 'lbl-partner') {
              if (window.renderChatHeader) { try { window.renderChatHeader(); } catch (e) {} }
              else { const pname = document.getElementById('chat-partner-name'); if (pname) pname.textContent = val; }
              const newEff = store.get('cs-lbl-partner') || store.get('lbl-partner') || 'TA';
              if (newEff !== oldEff) { try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff); } catch (e) {} }
            }
          }
        }, { maxlength: 12 });
      }
    });
  }
  bindLabel('lbl-user', 'lbl-user');
  bindLabel('lbl-partner', 'lbl-partner');

  // 上传手机背景图片：设为 .phone 全屏背景铺满整个手机屏幕，仅桌面显示；localStorage 持久化
  const phoneEl = document.querySelector('.phone');
  const bgRow = document.getElementById('row-bg-upload');
  const bgVal = document.getElementById('bg-val');
  const bgRemove = document.getElementById('row-bg-remove');
  const bgHome = document.getElementById('page-phone');
  // v3.5.139：壁纸同时铺到 body——电脑桌面下 .phone 只是 390px 模拟器框，
  // 只设 .phone 的话两侧灰底还是默认背景，视觉上"壁纸没铺满页面"。
  // body 背景铺满整个窗口（桌面含两侧灰底；手机端 body 即全屏，与 .phone 同图无缝）。
  // v3.10.x：手机端不再把壁纸铺到 body——窄屏下 .phone 已撑满整个视口，
  // body 份被完全遮挡看不见，但 iOS Safari 仍会解码一份完整位图，壁纸内存翻倍，
  // 正是"进入后卡顿 / 用一会儿灰屏回开屏"（WebContent 内存被杀重载）的主要诱因。
  // 该 body 副本只对桌面模拟器窄框（.phone 只是 390px 小框、两侧露出褐色底）有意义，
  // 与 base.css 的 @media (max-width:900px) 全屏切换保持一致：宽屏才铺 body。
  const isDesktopFrame = () => !!(window.matchMedia && window.matchMedia('(min-width: 901px)').matches);
  const applyBodyBg = (data) => {
    try {
      const b = document.body;
      if (!isDesktopFrame()) { b.style.backgroundImage = ''; return; }
      if (data) {
        b.style.backgroundImage = 'url("' + data + '")';
        b.style.backgroundSize = 'cover';
        b.style.backgroundPosition = 'center';
        b.style.backgroundAttachment = 'scroll';
      } else {
        b.style.backgroundImage = '';
        b.style.backgroundSize = '';
        b.style.backgroundPosition = '';
        b.style.backgroundAttachment = '';
      }
    } catch (e) {}
  };
  // v3.27.x：壁纸定位/缩放可调（phone-bg-pos-x/y/size），默认 cover+center，旧数据无键时完全兼容
  const bgPosOf = () => ({ x: store.get('phone-bg-pos-x') || '50', y: store.get('phone-bg-pos-y') || '50', s: store.get('phone-bg-size') || 'cover' });
  // ===== v3.26.x #147：壁纸常驻图层（修 iPhone16 Pro「退聊天回桌面巨卡」）=====
  // 此前壁纸直写 .phone，applyBgVisibility 在每次进出桌面时清空/重设 backgroundImage：
  // 2MB 级 dataURL 壁纸在 iOS 上每次重设都要主线程重新解码整张大图；且 chat-back 直挂
  // 监听 + page-phone MutationObserver 双触发 = 一次返回解码两次 → 用户实测「退出聊天
  // 回桌面巨卡、之后每次切换页面都卡」。改为：壁纸只赋给 .phone 内常驻图层（值变才重
  // 赋，同值写 style 也会触发样式失效），页面切换只切图层 opacity——透明度 0 的图层纹
  // 理在合成器中保持存活，不再反复解码。图层 z-index:1 低于 .page/.tabbar/.statusbar 的
  // z-index:2，桌面透明页透出壁纸、其他页面遮挡，与原「清空/重设」视觉语义一致。
  let bgLayer = null;
  const ensureBgLayer = () => {
    if (bgLayer || !phoneEl) return bgLayer;
    bgLayer = document.createElement('div');
    bgLayer.id = 'phone-bg-layer';
    // FIX 2026-09-17 #690（老内核兜底，零机型分支）：只写 inset:0 时，不认识 inset
    // 简写的内核（Safari 14.1 / Chromium 87 之前——含 iOS 11、vivo 系等老内核，见
    // chat-pages.css 的 .game-fs 同款注释）会整条丢弃该声明 → 本图层没有
    // top/left/right/bottom，空 div 收缩成 0×0（无头实测：老内核解析结果 0×0，
    // 现代内核 390×844）→ 桌面壁纸整层不显示、「换壁纸」点了没反应，桌面只剩
    // .phone 底色＝一片灰白（用户报「三页灰屏」）。四条长手 + 宽高与 inset 同义，
    // 同时给出＝谁认用谁。
    bgLayer.style.cssText = 'position:absolute;inset:0;top:0;right:0;bottom:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;opacity:0;';
    phoneEl.insertBefore(bgLayer, phoneEl.firstChild);
    return bgLayer;
  };
  const setBgLayerImage = (data) => {
    const l = ensureBgLayer(); if (!l) return;
    const want = data ? 'url("' + data + '")' : '';
    // FIX 2026-09-04 #151 backgroundImage 仍「值变才写」（#147 防 iOS 重复解码语义不变），
    // 但 backgroundSize/Position 必须每次刷新（各自值变才写、不盲写）：原实现把尺寸/定位
    // 也锁进「图变才写」守卫——壁纸定位/缩放（phone-bg-pos-*）改键后图层不重应用（滑杆
    // 实时预览失效）、两桌面同图不同 pos 时互相串用 → 「背景图片没有按正常比例铺满」。
    if (l.style.backgroundImage !== want) l.style.backgroundImage = want;
    if (!data) return;
    const pos = bgPosOf();
    const szWanted = (pos.s === 'cover' || !pos.s) ? 'cover' : (pos.s + '%');
    const psWanted = pos.x + '% ' + pos.y + '%';
    if (l.style.backgroundSize !== szWanted) l.style.backgroundSize = szWanted;
    if (l.style.backgroundPosition !== psWanted) l.style.backgroundPosition = psWanted;
  };
  const setBgLayerPreset = (css) => {
    const l = ensureBgLayer(); if (!l) return;
    if (l.style.backgroundImage !== css) {
      l.style.backgroundImage = css;
      l.style.backgroundSize = 'cover';
      l.style.backgroundPosition = 'center';
    }
  };
  const setBgLayerVisible = (on) => {
    const l = ensureBgLayer(); if (!l) return;
    const v = on ? '1' : '0';
    if (l.style.opacity !== v) l.style.opacity = v;
  };
  const applyPhoneBg = (data) => {
    if (!phoneEl) return;
    setBgLayerImage(data);
    applyBodyBg(data);
    if (bgHome) {
      bgHome.classList.add('has-bg');
      bgHome.style.backgroundImage = 'none';
    }
  };
  const syncBgUI = () => {
    const has = !!store.get('phone-bg');
    if (bgVal) bgVal.textContent = has ? '已设置' : '';
    // v3.27.x：回显带上图库张数（pbgList 声明在本函数之后，早期调用会 TDZ——try/catch 兜过）
    try { const gl = pbgList(); if (bgVal && gl.length) bgVal.textContent = has ? '已设置 · 库 ' + gl.length + ' 张' : '库 ' + gl.length + ' 张'; } catch (e) {}
    if (bgRemove) bgRemove.hidden = !has;
  };
  const clearPhoneBg = () => {
    setBgLayerImage(null);
    setBgLayerVisible(false);
    if (phoneEl) phoneEl.style.backgroundImage = ''; // 旧会话残留清理
    applyBodyBg(null);
    if (bgHome) {
      bgHome.classList.remove('has-bg');
      bgHome.style.backgroundImage = '';
    }
    store.remove('phone-bg');
    store.remove('phone-bg-preset');
    store.remove('phone-bg-solid');
    store.remove('phone-bg-pos-x');
    store.remove('phone-bg-pos-y');
    store.remove('phone-bg-size');
    // v3.27.x 优化①：壁纸被清/切预设后图库 active-id 失效，同步清掉（面板对账也会兜）
    try { store.remove(PBG_ACTIVE); } catch (e) {}
    syncBgUI();
    const pv = document.getElementById('bg-preset-val'); if (pv) pv.textContent = '默认';
  };
  // v3.6.x：内置壁纸预设（CSS 渐变）
  const BG_PRESETS = [
    { name: '晨曦', css: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' },
    { name: '暮色', css: 'linear-gradient(135deg, #2c3e50 0%, #4a67a4 100%)' },
    { name: '森林', css: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)' },
    { name: '暖阳', css: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
    { name: '极简', css: 'linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%)' },
    { name: '星空', css: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
    { name: '樱花', css: 'linear-gradient(135deg, #ffdde1 0%, #ee9ca7 100%)' },
    { name: '海洋', css: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)' },
  ];
  const bgPresetRow = document.getElementById('row-bg-preset');
  const bgPresetVal = document.getElementById('bg-preset-val');
  const applyPhoneBgPreset = (css) => {
    if (!phoneEl) return;
    // v3.26.x #147：改写常驻图层（原直写 .phone，进出桌面反复清设致 iOS 重复解码）
    setBgLayerPreset(css);
    // v3.10.x：body 仅桌面窄框需要（铺两侧底色）；手机端 .phone 已全屏，body 版被遮挡，
    // 跳过避免 iOS 冗余解码/存留
    if (isDesktopFrame()) {
      document.body.style.backgroundImage = css;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
    }
    if (bgHome) { bgHome.classList.add('has-bg'); bgHome.style.backgroundImage = 'none'; }
  };
  const getBgPresetName = () => store.get('phone-bg-preset') || '';
  const syncBgPresetUI = () => { if (bgPresetVal) bgPresetVal.textContent = getBgPresetName() || '默认'; };
  { const savedPreset = getBgPresetName(); if (savedPreset) { const p = BG_PRESETS.find(b => b.name === savedPreset); if (p) applyPhoneBgPreset(p.css); } syncBgPresetUI(); }
  // v3.27.x：壁纸选择面板（项3）——缩略图色卡网格 + 纯色 + 取色器，真实 UI 非文字 pill
  const openBgPanel = () => {
    let m = document.getElementById('bg-preset-panel');
    if (!m) { m = document.createElement('div'); m.id = 'bg-preset-panel'; m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; }); }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:min(88vw,380px);max-height:84vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
    const hd = document.createElement('div'); hd.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:12px'; hd.textContent = '壁纸选择'; wrap.appendChild(hd);
    const curPreset = getBgPresetName();
    const curSolid = store.get('phone-bg-solid') || '';
    const sec1 = document.createElement('div'); sec1.style.cssText = 'font-size:12px;color:var(--muted,#888);margin-bottom:6px'; sec1.textContent = '渐变预设'; wrap.appendChild(sec1);
    const grid1 = document.createElement('div'); grid1.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px';
    BG_PRESETS.forEach((p) => {
      const card = document.createElement('button');
      card.style.cssText = 'height:54px;border-radius:10px;border:2px solid ' + (curPreset === p.name ? 'var(--ink,#111)' : 'rgba(0,0,0,.08)') + ';background:' + p.css + ';background-size:cover;cursor:pointer;padding:0;position:relative;overflow:hidden';
      const lb = document.createElement('span'); lb.style.cssText = 'position:absolute;bottom:3px;left:0;right:0;font-size:10px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7);text-align:center'; lb.textContent = p.name; card.appendChild(lb);
      card.addEventListener('click', () => { clearPhoneBg(); store.set('phone-bg-preset', p.name); applyPhoneBgPreset(p.css); syncBgPresetUI(); toast('已切换为「' + p.name + '」壁纸'); m.style.display = 'none'; });
      grid1.appendChild(card);
    });
    wrap.appendChild(grid1);
    const sec2 = document.createElement('div'); sec2.style.cssText = 'font-size:12px;color:var(--muted,#888);margin-bottom:6px'; sec2.textContent = '纯色壁纸'; wrap.appendChild(sec2);
    const solidColors = ['#ffffff','#f5f5f5','#e8e8e8','#1c1c1e','#111111','#e05555','#3a7bd5','#4a9d5e'];
    const grid2 = document.createElement('div'); grid2.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px';
    solidColors.forEach((c) => {
      const card = document.createElement('button');
      card.style.cssText = 'height:40px;border-radius:10px;border:2px solid ' + (curSolid === c ? 'var(--ink,#111)' : 'rgba(0,0,0,.08)') + ';background:' + c + ';cursor:pointer;padding:0';
      card.addEventListener('click', () => { clearPhoneBg(); store.set('phone-bg-solid', c); applyPhoneBgPreset(c); syncBgPresetUI(); toast('已切换为纯色壁纸'); m.style.display = 'none'; });
      grid2.appendChild(card);
    });
    wrap.appendChild(grid2);
    const pickerRow = document.createElement('div'); pickerRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:14px';
    const pickerLabel = document.createElement('span'); pickerLabel.style.cssText = 'font-size:12px;color:var(--muted,#888)'; pickerLabel.textContent = '自定义纯色：'; pickerRow.appendChild(pickerLabel);
    const picker = document.createElement('input'); picker.type = 'color'; picker.value = curSolid || '#ffffff'; picker.style.cssText = 'width:40px;height:32px;border:1px solid var(--card-border,#ddd);border-radius:8px;cursor:pointer;background:none';
    picker.addEventListener('input', () => { clearPhoneBg(); store.set('phone-bg-solid', picker.value); applyPhoneBgPreset(picker.value); syncBgPresetUI(); });

    pickerRow.appendChild(picker);
    // v3.27.x：手输色值兜底——取色器打不开的手机（内置浏览器/WebView）从这填 #RRGGBB
    const pickerHex = document.createElement('button'); pickerHex.textContent = '手输色值'; pickerHex.style.cssText = 'font-size:12px;padding:5px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)';
    pickerHex.addEventListener('click', () => {
      openHexColorModal('输入纯色色值', (store.get('phone-bg-solid') || '#ffffff'), (c) => {
        clearPhoneBg(); store.set('phone-bg-solid', c); applyPhoneBgPreset(c); syncBgPresetUI();
        try { picker.value = c; } catch (e) {}
        toast('已应用纯色 ' + c.toUpperCase());
      });
    });
    pickerRow.appendChild(pickerHex);
    const pickerOk = document.createElement('button'); pickerOk.textContent = '应用'; pickerOk.style.cssText = 'font-size:12px;padding:5px 12px;border:none;border-radius:8px;background:var(--ink,#111);color:#fff';
    pickerOk.addEventListener('click', () => { toast('已应用自定义纯色'); m.style.display = 'none'; });
    pickerRow.appendChild(pickerOk);
    wrap.appendChild(pickerRow);
    const clearBtn = document.createElement('button'); clearBtn.textContent = '清除壁纸'; clearBtn.style.cssText = 'width:100%;padding:10px;border:1px solid rgba(163,45,45,.35);border-radius:10px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d);font-size:13px';
    clearBtn.addEventListener('click', () => { clearPhoneBg(); m.style.display = 'none'; toast('已清除壁纸'); });
    wrap.appendChild(clearBtn);
    m.innerHTML = ''; m.appendChild(wrap); m.style.display = 'flex';
  };
  if (bgPresetRow) {
    bgPresetRow.addEventListener('click', openBgPanel);
  }
  // ================= v3.27.x：壁纸图库（多张保存 + 点击切换） =================
  // 此前 phone-bg 只有一张，换图即丢旧图。图库结构与聊天壁纸图库同构：
  //   phone-bg-glist = JSON 数组（条目 id）；phone-bg-item-<id> = 全图（大键走 IDB）；
  //   phone-bg-item-thb-<id> = 240px 缩略图（面板只解码小图，防 N 张 4MB 原图同时解码卡顿）。
  // 当前生效壁纸仍是 phone-bg（常驻图层/定位缩放/预设互斥/方案导入等既有链路零改动）。
  // 旧数据自动迁移：phone-bg 有值而图库为空时，首次打开面板把当前壁纸收为第 1 张。
  const PBG_GLIST = 'phone-bg-glist';
  const PBG_MAX = 12; // 图库容量上限
  const pbgList = () => {
    try { const v = JSON.parse(store.get(PBG_GLIST) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  };
  const pbgSaveList = (arr) => store.set(PBG_GLIST, JSON.stringify(arr));
  // v3.27.x 优化①：active-id——记录图库里哪张是当前生效壁纸，面板高亮/删除判断只看 id，
  // 不再为对比把每张 MB 级全图读进内存；对账失配（升级首次/方案导入直写 phone-bg/预设覆盖）时
  // 读一轮全图找回，稳态只做 1 次内存读 + 1 次字符串比对（memoryCache 返引用，零拷贝）
  const PBG_ACTIVE = 'phone-bg-active-id';
  const pbgActiveId = () => store.get(PBG_ACTIVE) || '';
  function pbgReconcileActive() {
    const list = pbgList();
    const cur = store.get('phone-bg');
    if (!cur) { if (pbgActiveId()) store.remove(PBG_ACTIVE); return ''; }
    const aid = pbgActiveId();
    if (aid && list.indexOf(aid) >= 0 && store.get('phone-bg-item-' + aid) === cur) return aid;
    for (let i = 0; i < list.length; i++) {
      if (store.get('phone-bg-item-' + list[i]) === cur) { store.set(PBG_ACTIVE, list[i]); return list[i]; }
    }
    return '';
  }
  const pbgEnsureSeed = () => {
    if (store.get('phone-bg') && !pbgList().length) {
      const seed = store.get('phone-bg');
      const id = 'g' + Date.now().toString(36);
      pbgSaveList([id]);
      store.set('phone-bg-item-' + id, seed);
      store.set(PBG_ACTIVE, id);
      compressImage(seed, 240).then(th => { if (th) store.set('phone-bg-item-thb-' + id, th); });
    }
  };
  // 入库一张并设为当前壁纸（面板上传用）；返回 null = 压缩失败/图库已满
  const pbgAdd = (dataRaw) => compressImageFit(dataRaw, phoneBgMaxSide(), 4.5 * 1024 * 1024).then((data) => {
    if (!data) return null;
    if (pbgList().length >= PBG_MAX) { toast('图库已满（' + PBG_MAX + ' 张），请先删除几张'); return null; }
    const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const list = pbgList();
    list.push(id);
    pbgSaveList(list);
    store.set('phone-bg-item-' + id, data);
    compressImage(data, 240).then(th => { if (th) store.set('phone-bg-item-thb-' + id, th); });
    applyPhoneBg(data);
    store.set('phone-bg', data);
    store.set(PBG_ACTIVE, id);
    store.remove('phone-bg-preset');
    syncBgUI();
    syncBgPresetUI();
    // v3.5.111：上传后立即同步一次桌面可见性，确保回桌面时壁纸已应用
    //（配合内存缓存修复：大壁纸不写 localStorage，靠内存缓存当前会话内读回）
    applyBgVisibility();
    return id;
  });
  // 壁纸图库面板：缩略图网格（点图切换 / × 删除两击确认）+ 多选上传 + 清除当前
  // 壁纸图库面板：缩略图网格（点图切换 / × 删除 + 5 秒内可撤销）+ 多选上传 + 同步到全部联系人
  // 优化①：高亮只看 active-id（pbgReconcileActive 对账），渲染不读全图
  // 优化⑤：删除单击即删 + 底部「撤销」条（5 秒后作废）
  const openPhoneBgPanel = () => {
    pbgEnsureSeed();
    let m = document.getElementById('phone-bg-gallery-panel');
    if (!m) { m = document.createElement('div'); m.id = 'phone-bg-gallery-panel'; m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; }); }
    m.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:min(90vw,400px);max-height:84vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
    const hd = document.createElement('div');
    hd.innerHTML = '<div style="font-size:15px;font-weight:700">我的壁纸图库</div><div style="font-size:12px;color:var(--muted,#888);margin-top:4px">可存多张壁纸，点缩略图即切换；误删 5 秒内可撤销</div>';
    wrap.appendChild(hd);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0';
    const cur = store.get('phone-bg') || '';
    const aid = pbgReconcileActive();
    const list = pbgList();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'grid-column:1/-1;font-size:13px;color:var(--muted,#999);text-align:center;padding:24px 0';
      empty.textContent = '图库还是空的，点下方「上传新图」加入';
      grid.appendChild(empty);
    }
    list.forEach((id) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;border:2px solid transparent;cursor:pointer;aspect-ratio:9/19;background:var(--bg-b,#f2f2f2)';
      const thb = store.get('phone-bg-item-thb-' + id);
      if (id === aid) cell.style.borderColor = 'var(--btn-bg,#111)';
      const im = document.createElement('img');
      im.alt = '';
      im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      if (thb) { im.src = thb; }
      else {
        const full = store.get('phone-bg-item-' + id);
        im.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
        cell.style.background = 'var(--muted,#888)';
        if (full) compressImage(full, 240).then((th) => { if (th) { store.set('phone-bg-item-thb-' + id, th); im.src = th; cell.style.background = ''; } });
      }
      cell.appendChild(im);
      cell.addEventListener('click', () => {
        // 只读被点中的这一张全图（active-id 对账保证高亮一致）
        const full = store.get('phone-bg-item-' + id);
        if (!full) return;
        applyPhoneBg(full);
        store.set('phone-bg', full);
        store.set(PBG_ACTIVE, id);
        store.remove('phone-bg-preset');
        syncBgUI();
        syncBgPresetUI();
        applyBgVisibility();
        toast('已切换壁纸');
        m.style.display = 'none';
      });
      const del = document.createElement('div');
      del.textContent = '×';
      del.style.cssText = 'position:absolute;top:2px;right:2px;width:20px;height:20px;line-height:18px;text-align:center;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:14px';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const full = store.get('phone-bg-item-' + id);
        const thb2 = store.get('phone-bg-item-thb-' + id);
        const wasActive = id === aid;
        pbgSaveList(pbgList().filter(x => x !== id));
        store.remove('phone-bg-item-' + id);
        store.remove('phone-bg-item-thb-' + id);
        if (wasActive) { clearPhoneBg(); store.remove('phone-bg-pos-x'); store.remove('phone-bg-pos-y'); store.remove('phone-bg-size'); }
        // 优化⑤：留底 5 秒，面板底部出「撤销」条；每次删除覆盖上一条留底（只保最近一张）
        if (full) {
          m.__undoItem = { id, full, thb: thb2, wasActive };
          if (m.__undoTimer) clearTimeout(m.__undoTimer);
          m.__undoTimer = setTimeout(() => { m.__undoItem = null; if (m.style.display === 'flex') openPhoneBgPanel(); }, 5000);
        }
        toast('已删除，5 秒内可撤销');
        openPhoneBgPanel();
      });
      cell.appendChild(del);
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
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
          pbgSaveList(pbgList().concat([u.id]));
          store.set('phone-bg-item-' + u.id, u.full);
          if (u.thb) store.set('phone-bg-item-thb-' + u.id, u.thb);
          if (u.wasActive) {
            applyPhoneBg(u.full);
            store.set('phone-bg', u.full);
            store.set(PBG_ACTIVE, u.id);
            store.remove('phone-bg-preset');
            syncBgUI(); syncBgPresetUI(); applyBgVisibility();
          }
          toast('已撤销删除');
        }
        openPhoneBgPanel();
      });
      strip.appendChild(ub);
      wrap.appendChild(strip);
    }
    const upBtn = document.createElement('button');
    upBtn.textContent = '＋ 上传新图（可多选）';
    upBtn.style.cssText = 'width:100%;padding:11px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600;margin-bottom:8px';
    // FIX 2026-09-21 #1002：手机壁纸「＋ 上传新图（可多选）」铺真·可点 input 层（owner＝统一入口那个
    // 多选 input 的 id；面板每次打开都是新按钮，故渲染即铺，幂等）
    if (window.mochiFilePickSurface) window.mochiFilePickSurface(upBtn, { id: 'phone-bg-up-tap', accept: 'image/*', multiple: true, owner: 'mochi-phonebg-gallery-pick' });
    upBtn.addEventListener('click', () => {
      // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现虽挂 body，但 accept 迟到、无 label
      // 原生激活兜底、每次点按 new 一个再 remove；vivo X200s/百度浏览器报「上传无反应」的同族面）
      window.mochiFilePick({
        id: 'mochi-phonebg-gallery-pick', accept: 'image/*', multiple: true, btn: upBtn,
        onFiles: (fs) => {
          if (!fs.length) { toast('没有取到图片，请再选一次'); return; }
          let ok = 0;
          toast('正在处理 ' + fs.length + ' 张图片…');
          let chain = Promise.resolve();
          fs.forEach((f) => {
            chain = chain.then(() => new Promise((res) => {
              const reader = new FileReader();
              reader.onload = () => { pbgAdd(reader.result).then((id) => { if (id) ok++; res(); }); };
              reader.onerror = () => res();
              reader.readAsDataURL(f);
            }));
          });
          chain.then(() => {
            if (ok) toast('已加入 ' + ok + ' 张壁纸');
            if (document.getElementById('phone-bg-gallery-panel') && document.getElementById('phone-bg-gallery-panel').style.display === 'flex') openPhoneBgPanel();
          });
        }
      });
    });
    wrap.appendChild(upBtn);
    // #997：多选能力由浏览器选择器决定（本站只是网页，没有相册权限），只能选一张 / 点了没反应时给就地指引
    const bgHint = document.createElement('div');
    bgHint.id = 'phonebg-upload-hint';
    bgHint.style.cssText = 'font-size:11px;line-height:1.6;color:var(--muted);margin:2px 0 8px';
    bgHint.textContent = '选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）';
    wrap.appendChild(bgHint);
    if (cur) {
      const rmBtn = document.createElement('button');
      rmBtn.textContent = '清除当前壁纸（图库保留）';
      rmBtn.style.cssText = 'width:100%;padding:10px;border:1px solid rgba(163,45,45,.35);border-radius:10px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d);font-size:13px;margin-bottom:8px';
      rmBtn.addEventListener('click', () => { clearPhoneBg(); store.remove('phone-bg-pos-x'); store.remove('phone-bg-pos-y'); store.remove('phone-bg-size'); toast('已清除，图库里的图还在'); openPhoneBgPanel(); });
      wrap.appendChild(rmBtn);
    }
    // 优化②：壁纸同样是 per-联系人独立的——一键把壁纸和图库同步到其他联系人桌面
    //（含定位/缩放参数；目标端清掉预设/纯色键，保证显示的是同步过去的这张图）
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
          const fullNow = store.get('phone-bg');
          const glist = pbgList();
          const aidNow = pbgActiveId();
          const pos = { x: store.get('phone-bg-pos-x'), y: store.get('phone-bg-pos-y'), s: store.get('phone-bg-size') };
          let n = 0;
          others.forEach((c) => {
            try {
              const st = window.xyStore('xy-home-v2:' + c.id);
              glist.forEach((gid) => {
                const f = store.get('phone-bg-item-' + gid); if (f) st.set('phone-bg-item-' + gid, f);
                const t = store.get('phone-bg-item-thb-' + gid); if (t) st.set('phone-bg-item-thb-' + gid, t);
              });
              st.set('phone-bg-glist', JSON.stringify(glist));
              if (aidNow) st.set('phone-bg-active-id', aidNow); else st.remove('phone-bg-active-id');
              if (fullNow) {
                st.set('phone-bg', fullNow);
                st.remove('phone-bg-preset');
                st.remove('phone-bg-solid');
                if (pos.x) st.set('phone-bg-pos-x', pos.x); else st.remove('phone-bg-pos-x');
                if (pos.y) st.set('phone-bg-pos-y', pos.y); else st.remove('phone-bg-pos-y');
                if (pos.s) st.set('phone-bg-size', pos.s); else st.remove('phone-bg-size');
              } else st.remove('phone-bg');
              n++;
            } catch (e) {}
          });
          toast('已同步到 ' + n + ' 个联系人（切到对应桌面即可看到）');
        }, { noInput: true, pills: [{ label: '确认同步（覆盖对方的桌面壁纸）', value: '__yes__' }, { label: '取消', value: '__no__' }] });
      });
      wrap.appendChild(syncBtn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555);font-size:13px';
    closeBtn.addEventListener('click', () => { m.style.display = 'none'; });
    wrap.appendChild(closeBtn);
    m.innerHTML = ''; m.appendChild(wrap); m.style.display = 'flex';
  };
  if (bgRow) {
    // 启动渲染防护 + 恢复已存壁纸（原逻辑保留：坏大值自动清除回默认）
    const savedBg = sanitizeBg('phone-bg', BG_SAFE_LIMIT);
    if (savedBg) applyPhoneBg(savedBg);
    syncBgUI();
    // v3.27.x：入口改为壁纸图库面板（多张保存+点击切换）；原「点了直接选一张」的
    // 单图上传挪进面板（pbgAdd 沿用 compressImageFit + phoneBgMaxSide 既有压缩链）
    bgRow.addEventListener('click', openPhoneBgPanel);
  }
  if (bgRemove) {
    bgRemove.addEventListener('click', () => clearPhoneBg());
  }
  // v3.27.x：壁纸定位/缩放调整（仅对自定义图生效）——三滑块实时预览
  const bgAdjustRow = document.getElementById('row-bg-adjust');
  if (bgAdjustRow) {
    bgAdjustRow.addEventListener('click', () => {
      // v3.27.x：没有当前壁纸时不再干巴巴提示——图库有存货直接打开图库选一张
      if (!store.get('phone-bg')) {
        try { if (pbgList().length) { toast('请先在图库里选一张壁纸'); openPhoneBgPanel(); return; } } catch (e) {}
        toast('请先上传背景图片');
        return;
      }
      let m = document.getElementById('bg-adjust-panel');
      if (!m) { m = document.createElement('div'); m.id = 'bg-adjust-panel'; m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; } }); }
      const pos = bgPosOf();
      const sx = parseInt(pos.x, 10), sy = parseInt(pos.y, 10), ss = pos.s === 'cover' ? 100 : parseInt(pos.s, 10);
      const wrap = document.createElement('div');
      wrap.style.cssText = 'width:min(86vw,360px);background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
      const hd = document.createElement('div'); hd.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:12px'; hd.textContent = '壁纸定位与缩放'; wrap.appendChild(hd);
      const mkSlider = (label, val, min, max, on) => {
        const r = document.createElement('div'); r.style.cssText = 'margin-bottom:12px';
        const lb = document.createElement('div'); lb.style.cssText = 'font-size:12px;color:var(--muted,#888);margin-bottom:4px'; lb.textContent = label; r.appendChild(lb);
        const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val; inp.style.cssText = 'width:100%';
        const vv = document.createElement('span'); vv.style.cssText = 'font-size:11px;color:var(--muted,#999);margin-left:6px'; vv.textContent = val + (label.indexOf('缩放') >= 0 ? '%' : '%');
        inp.addEventListener('input', () => { vv.textContent = inp.value + '%'; on(parseInt(inp.value, 10)); });
        const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center'; row.appendChild(inp); row.appendChild(vv);
        r.appendChild(row); return r;
      };
      const applyBgPos = (x, y, sz) => { store.set('phone-bg-pos-x', String(x)); store.set('phone-bg-pos-y', String(y)); store.set('phone-bg-size', sz === 100 ? 'cover' : String(sz)); const d = bgData(); if (d) applyPhoneBg(d); };
      let cx = sx, cy = sy, cs = ss;
      wrap.appendChild(mkSlider('水平位置', sx, 0, 100, (v) => { cx = v; applyBgPos(cx, cy, cs); }));
      wrap.appendChild(mkSlider('垂直位置', sy, 0, 100, (v) => { cy = v; applyBgPos(cx, cy, cs); }));
      wrap.appendChild(mkSlider('缩放', ss, 100, 300, (v) => { cs = v; applyBgPos(cx, cy, cs); }));
      const act = document.createElement('div'); act.style.cssText = 'display:flex;gap:8px;margin-top:8px';
      const reset = document.createElement('button'); reset.textContent = '重置'; reset.style.cssText = 'flex:1;padding:9px;border:1px solid var(--card-border,#eee);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)';
      reset.addEventListener('click', () => { store.remove('phone-bg-pos-x'); store.remove('phone-bg-pos-y'); store.remove('phone-bg-size'); const d = bgData(); if (d) applyPhoneBg(d); m.style.display = 'none'; toast('已重置为居中铺满'); });
      const ok = document.createElement('button'); ok.textContent = '完成'; ok.style.cssText = 'flex:1;padding:9px;border:none;border-radius:9px;background:var(--ink,#111);color:#fff';
      ok.addEventListener('click', () => { m.style.display = 'none'; toast('已应用'); });
      act.appendChild(reset); act.appendChild(ok); wrap.appendChild(act);
      m.innerHTML = ''; m.appendChild(wrap); m.style.display = 'flex';
    });
  }

  // 壁纸只在桌面显示：桌面时铺满全屏，切到字卡库/设置/聊天时隐藏（数据保留）
  const bgData = () => sanitizeBg('phone-bg', BG_SAFE_LIMIT);
  const bgPresetCss = () => {
    const n = getBgPresetName();
    if (!n) return '';
    const p = BG_PRESETS.find(b => b.name === n);
    return p ? p.css : '';
  };
  const applyBgVisibility = () => {
    if (!phoneEl) return;
    const home = document.getElementById('page-phone');
    const show = home && !home.hidden;
    // v3.26.x #147：页面切换只切图层 opacity（原实现清空/重设 .phone backgroundImage，
    // 2MB 壁纸在 iOS 上每次切换都主线程重新解码，用户实测退聊天回桌面巨卡）。
    // 退出桌面不清图，回桌面时命中「值变才写」短路，零解码开销。
    if (!show) {
      setBgLayerVisible(false);
      applyBodyBg(null);
      return;
    }
    // v3.26.x：修复「内置壁纸预设没应用到桌面」——此前只判断自定义 phone-bg，
    // 预设（phone-bg-preset）只靠加载时 applyPhoneBgPreset 一次性铺上，任何
    // tab 切换触发 applyBgVisibility 都会因 bgData() 为空把预设壁纸清掉。
    // 现在自定义图优先、其次内置预设，都没有才清空。
    const customBg = bgData();
    const solidCss = store.get('phone-bg-solid') || '';
    const presetCss = bgPresetCss();
    if (customBg) applyPhoneBg(customBg);
    else if (solidCss && /^#[0-9a-fA-F]{6}$/.test(solidCss)) applyPhoneBgPreset(solidCss);
    else if (presetCss) applyPhoneBgPreset(presetCss);
    else setBgLayerImage(null);
    setBgLayerVisible(!!(customBg || (solidCss && /^#[0-9a-fA-F]{6}$/.test(solidCss)) || presetCss));
    if (!customBg && !(solidCss && /^#[0-9a-fA-F]{6}$/.test(solidCss)) && !presetCss) applyBodyBg(null);
  };
  // 页面切换时同步壁纸显示
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', applyBgVisibility));
  document.querySelectorAll('.app[data-app="chat"]').forEach(a => a.addEventListener('click', applyBgVisibility));
  document.getElementById('chat-back') && document.getElementById('chat-back').addEventListener('click', applyBgVisibility);
  // 监听桌面容器 hidden 变化（兜底）
  const homePage = document.getElementById('page-phone');
  if (homePage) {
    const mo = new MutationObserver(applyBgVisibility);
    mo.observe(homePage, { attributes: true, attributeFilter: ['hidden'] });
  }
  applyBgVisibility();
  // v3.5.93：桌面壁纸大键可能只存在 IndexedDB（导入兜底写入/大键只进 IDB）——
  // 启动时从 IDB 补读后重新应用
  try {
    if (window.idbGet) {
      window.idbGet(window.activePrefix() + ':phone-bg').then(v => {
        if (v && typeof v === 'string' && v.length > 2 && !store.get('phone-bg')) {
          store.set('phone-bg', v);
          applyBgVisibility();
        }
      });
    }
  } catch (e) {}

  // 自定义手机桌面图标：点击设置项切到手机页进入编辑模式，再点击目标 app 上传替换
  // 注意：桌面分页后可能存在多个 .app-grid，全部绑定
  // v3.5.87：装修模式下点击已有自定义图的图标 → 弹「更换 / 清除」；清除恢复默认图标
  const grids = document.querySelectorAll('.app-grid');
  // FIX 2026-09-12 #351：图标【模板默认页】快照——脚本加载期 DOM 尚是 template 原状，
  // 记下每个图标 data-app → 所在网格 dataset.app。跨页拖动后多个网格的顺序数组都可能
  // 残留同一图标（旧版只写目标页不清理源页），启动归位时用它裁决「用户真实意图」：
  // 非默认页的认领胜出（图标被搬离默认页），只有默认页自己认领时才回默认页。
  const ICON_HOME_GRID = {};
  document.querySelectorAll('.app-grid').forEach(g => {
    const gid = g.dataset.app;
    if (!gid) return;
    g.querySelectorAll('.app').forEach(a => { if (a.dataset.app) ICON_HOME_GRID[a.dataset.app] = gid; });
  });
  // 给每个图标存一份原始 SVG，清除时还原
  document.querySelectorAll('.app .app-ico').forEach(ico => {
    if (!ico.dataset.orig) ico.dataset.orig = ico.innerHTML;
  });
  // v3.27.x：自定义图标图片透明度——仅对上传的 <img> 生效（默认 SVG 图标不受影响），
  // 与小组件透明度同款 0~100 百分比，存 app-icon-opacity-<key>（per-cid），100 不存
  const applyAppIconOpacity = (app, pct) => {
    const img = app.querySelector('.app-ico img');
    if (!img) return;
    const op = Math.max(0, Math.min(100, pct)) / 100;
    img.style.opacity = String(op);
  };
  // FIX 2026-09-16 #581 图标图片可单独调「缩放 + 位置」（用户反馈：「上传了图标按钮图片后，
  // 需要可以只移动按钮里图片的位置，不用重新上传」）。此前上传的图只有 object-fit:cover 居中
  // 裁切，想让图标里露出照片的某个部位只能重新裁一张再传。现在每个图标三个键（per-cid，与
  // app-icon-opacity-<key> 同族）：
  //   app-icon-zoom-<key>     100~300（%），100/缺省 = 原样铺满（不写键）
  //   app-icon-pos-x/-y-<key> 0~100，50 = 居中（缺省 = 50）
  // 渲染分两支，两支都保证「图片边缘永远不会离开图标框」（不露底色）：
  //   ① 未放大：位移交给 object-position——原图被 cover 裁掉才有位移空间（竖图/横图最常见），
  //      正方形原图 + 正方形图标时无空间，此时提示用户先放大；
  //   ② 放大后：位移交给 translate，上限 ±(z-100)/2 × 图标宽＝缩放多出来的余量的正好一半，
  //      缩放到边界时图片边缘恰好贴住图标边缘，因此任意组合都不会露底色。
  //      放大同时需要 .app-ico 裁边（overflow:hidden）——图标圆角本来就在 .app-ico 上。
  // 注：这里的 transform:scale 只作用在图标里这张小图上，与 AGENTS「禁止整页缩放」红线无关。
  const applyAppIconFit = (app) => {
    const ico = app.querySelector('.app-ico');
    if (!ico) return;
    const img = ico.querySelector('img');
    if (!img) { ico.style.overflow = ''; return; }
    const key = app.dataset.app;
    const clamp100 = (v, d) => {
      if (v === null || v === undefined || v === '') return d;
      const n = parseInt(v, 10);
      return isNaN(n) ? d : Math.max(0, Math.min(100, n));
    };
    const zRaw = parseInt(store.get('app-icon-zoom-' + key) || '100', 10);
    const z = (isNaN(zRaw) || zRaw < 100) ? 100 : Math.min(300, zRaw);
    const x = clamp100(store.get('app-icon-pos-x-' + key), 50);
    const y = clamp100(store.get('app-icon-pos-y-' + key), 50);
    const zoomed = z > 100;
    ico.style.overflow = (zoomed || x !== 50 || y !== 50) ? 'hidden' : '';
    if (zoomed) {
      // translate 的百分比相对图片自身尺寸（= 图标框）计算，故 ±(z-1)/2 就是可用的全部余量。
      // 方向与「壁纸定位/object-position」同一口径：值越大＝看图片越靠右/越靠下的一段，
      // 所以图片要往「反方向」平移（负号）——两支方向必须一致，否则放大前后同一根滑杆
      // 会把画面推向相反的一侧。
      const tx = -Math.round(((x - 50) / 50) * ((z - 100) / 2) * 100) / 100;
      const ty = -Math.round(((y - 50) / 50) * ((z - 100) / 2) * 100) / 100;
      if (img.style.objectPosition) img.style.objectPosition = '';
      img.style.transform = 'translate(' + tx + '%, ' + ty + '%) scale(' + (z / 100) + ')';
    } else {
      if (img.style.transform) img.style.transform = '';
      img.style.objectPosition = (x === 50 && y === 50) ? '' : (x + '% ' + y + '%');
    }
  };
  // 一次把「透明度 + 缩放/位置」都刷到图标上（新增图片的每个入口都要调，漏一处＝该入口
  // 上传后位置设置不生效）
  const applyAppIconLook = (app) => {
    const op = store.get('app-icon-opacity-' + app.dataset.app);
    if (op) applyAppIconOpacity(app, parseInt(op, 10));
    applyAppIconFit(app);
  };
  const restoreAppIcons = () => {
    document.querySelectorAll('.app').forEach(app => {
      let saved = store.get('app-icon-' + app.dataset.app);
      const ico = app.querySelector('.app-ico');
      // v3.6.x：与头像同款防护——旧版本压缩失败存过超大原图，渲染会触发 iOS 解码崩溃
      // v3.10.x：只跳过本次渲染不删数据（仅超硬上限仍清除）
      if (saved && saved.length > 500 * 1024) {
        try { if (saved.length > 12 * 1024 * 1024) store.remove('app-icon-' + app.dataset.app); } catch (e) {}
        saved = null;
      }
      if (saved) {
        // FIX 2026-09-07 #249 切桌面卡死：恒等跳过——图标没换不重建 img。切换联系人
        // 扇出的多条监听器（综合监听 + restore-done 回填监听）每次切换对全部图标
        // innerHTML=''+重建 img，MB 级 dataURL 真机重新解码。已有同源 img 且 src 相同
        // 时只补透明度，不重建节点。
        if (ico) {
          const cur = ico.querySelector('img');
          if (cur && cur.src === saved) {
            // #581：同源 img 不重建，但缩放/位置也要补刷（方案导入/撤销后走这条）
            applyAppIconLook(app);
            return;
          }
          ico.innerHTML = '';
          const img = document.createElement('img');
          img.src = saved;
          img.alt = '';
          ico.appendChild(img);
          // v3.27.x：恢复自定义图标透明度；#581：同时恢复缩放/位置
          applyAppIconLook(app);
        }
      } else if (ico && ico.dataset.orig) {
        if (ico.innerHTML === ico.dataset.orig) return;
        ico.innerHTML = ico.dataset.orig;
        // #581：还原默认图标时清掉自定义图留下的裁边/位移
        applyAppIconFit(app);
      }
    });
  };
  restoreAppIcons();
  // ===== v3.26.x #769：底部导航栏美化（三按钮可上传图标图片 + 栏样式）=====
  // 键族（per-cid store，与 app-icon-* 同族，随美化方案导入/导出/撤销走，见 collectBeauty）：
  //   tab-icon-<page>    按钮图片（compressImage 256 后的 dataURL），<page>=data-page 稳定身份
  //   tab-icon-opacity   图片透明度 0~100（只作用上传的 img，默认 SVG 不受影响——
  //                      applyAppIconOpacity 同口径；三按钮共用一根滑杆，widget-opacity 同款）
  //   tabbar-bg-op / tabbar-whole-op / tabbar-bg-color / tabbar-radius / tabbar-blur / tabbar-icon-size
  // 整栏透明度双保险（防「栏透明到消失、找不回」的设计缺陷）：
  //   ① 图标层 12% 下限——背景可全透，图标永远留一丝影（Math.max(wholeOp, 12) 是唯一锚点）；
  //   ② 触摸显形——任一透明度 <50% 挂 tabbar-faint，按压瞬间描边+图标全可见（tabbar.css）。
  const TABBAR_PAGES = ['page-phone', 'page-chatcard', 'page-setting'];
  const TABBAR_PAGE_NAMES = { 'page-phone': '首页', 'page-chatcard': '字卡', 'page-setting': '设置' };
  const tabbarNum = (key, def, min, max) => {
    const n = parseInt(store.get(key), 10);
    return isNaN(n) ? def : Math.max(min, Math.min(max, n));
  };
  const applyTabbarStyle = () => {
    const bar = document.querySelector('.tabbar');
    const rs = document.documentElement.style;
    const bgOp = tabbarNum('tabbar-bg-op', 100, 0, 100);
    const wholeOp = tabbarNum('tabbar-whole-op', 100, 0, 100);
    const bgA = Math.round(bgOp * wholeOp) / 10000; // 背景＝两根滑杆叠乘
    const icoA = Math.max(wholeOp, 12) / 100;       // 图标层整栏透明度 12% 下限
    ['--tabbar-bg-a', '--tabbar-ico-a', '--tabbar-bg-color', '--tabbar-radius', '--tabbar-blur', '--tabbar-ico-size'].forEach(p => rs.removeProperty(p));
    if (bgA < 1) rs.setProperty('--tabbar-bg-a', String(bgA));
    if (icoA < 1) rs.setProperty('--tabbar-ico-a', String(icoA));
    const bgc = store.get('tabbar-bg-color');
    if (bgc) rs.setProperty('--tabbar-bg-color', bgc);
    const rad = tabbarNum('tabbar-radius', 22, 0, 30);
    if (rad !== 22) rs.setProperty('--tabbar-radius', rad + 'px');
    const blur = tabbarNum('tabbar-blur', 0, 0, 20);
    if (blur > 0) rs.setProperty('--tabbar-blur', blur + 'px');
    const isz = tabbarNum('tabbar-icon-size', 23, 18, 34);
    if (isz !== 23) rs.setProperty('--tabbar-ico-size', isz + 'px');
    if (!bar) return;
    bar.classList.toggle('tabbar-blur-on', blur > 0);
    bar.classList.toggle('tabbar-faint', bgOp < 50 || wholeOp < 50);
  };
  const applyTabIconLook = (tab) => {
    const img = tab.querySelector('img');
    if (!img) return;
    img.style.opacity = String(tabbarNum('tab-icon-opacity', 100, 0, 100) / 100);
  };
  // 图片与默认 SVG 共存切换（svg 只隐藏不删除＝#467/#477 模板结构锚依赖 .tab 内部形态，
  // 且恢复默认无需任何备份键）
  const paintTabIcon = (tab, data) => {
    const svg = tab.querySelector('svg');
    if (svg) svg.style.display = data ? 'none' : '';
    let img = tab.querySelector('img');
    if (data) {
      if (!img) { img = document.createElement('img'); img.alt = ''; tab.appendChild(img); }
      else if (img.src === data) { applyTabIconLook(tab); return; } // #249 恒等跳过：同源不重解码
      img.src = data;
    } else if (img) img.remove();
    applyTabIconLook(tab);
  };
  const restoreTabbarIcons = () => {
    document.querySelectorAll('.tabbar .tab').forEach(tab => {
      const key = tab.dataset.page;
      if (!key) return;
      let saved = store.get('tab-icon-' + key);
      // 与 app-icon 同款大图防护（v3.6.x 起）：超 500KB 本次跳过渲染，超 12MB 清除——
      // 旧版压缩失败存过超大原图，真机解码会崩溃/卡死
      if (saved && saved.length > 500 * 1024) {
        try { if (saved.length > 12 * 1024 * 1024) store.remove('tab-icon-' + key); } catch (e) {}
        saved = null;
      }
      paintTabIcon(tab, saved);
    });
    applyTabbarStyle();
  };
  // 上传/更换/移除（边看边调「底部栏」分区与设置页共用；已自定义时先问做哪个，不直接进相册）
  const tabIconMenu = (pageKey) => {
    const name = TABBAR_PAGE_NAMES[pageKey] || pageKey;
    const tabOf = () => document.querySelector('.tabbar .tab[data-page="' + pageKey + '"]');
    const pick = () => {
      window.mochiFilePick({
        id: 'mochi-tabicon-pick', accept: 'image/*',
        onFiles: (files) => {
          const f = files && files[0];
          if (!f) { toast('没有取到图片，请再选一次'); return; }
          const reader = new FileReader();
          reader.onload = () => {
            toast('正在处理图片…');
            setTimeout(() => { // 让出当前帧使 toast 先渲染（app-icon 上传同口径，防主线程同步压缩假死）
              compressImage(reader.result, 256).then((data) => {
                if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
                store.set('tab-icon-' + pageKey, data);
                const tab = tabOf();
                if (tab) paintTabIcon(tab, data);
                toast('「' + name + '」按钮图标已更新');
              });
            }, 80);
          };
          reader.onerror = () => toast('读取图片失败，请重试');
          reader.readAsDataURL(f);
        }
      });
    };
    if (store.get('tab-icon-' + pageKey)) {
      window.openModal('「' + name + '」按钮图标', '', (v) => {
        if (v === 'clear') {
          store.remove('tab-icon-' + pageKey);
          const tab = tabOf();
          if (tab) paintTabIcon(tab, null);
          toast('「' + name + '」按钮已恢复默认图标');
        } else if (v === 'pick') pick();
      }, {
        noInput: true, staticText: '该按钮正在使用自定义图片：',
        pills: [{ label: '更换图片', value: 'pick' }, { label: '移除恢复默认', value: 'clear' }]
      });
    } else pick();
  };
  // 「恢复底部栏默认」：清空整族键 + 清变量 + 重绘（抽屉与将来入口共用）
  const resetTabbarBeauty = () => {
    TABBAR_PAGES.forEach(pk => store.remove('tab-icon-' + pk));
    ['tab-icon-opacity', 'tabbar-bg-op', 'tabbar-whole-op', 'tabbar-bg-color', 'tabbar-radius', 'tabbar-blur', 'tabbar-icon-size'].forEach(k => store.remove(k));
    restoreTabbarIcons();
  };
  restoreTabbarIcons();
  // v3.6.x：恢复图标网格内自定义顺序（app-icon-order-<grid.app> 存 data-app 数组）
  // FIX 2026-09-12 #351：跨页图标归位——旧实现只在「节点已在本网格」时重排，而模板
  // 每次启动都把图标放回默认网格，跨页拖动（只存目标页顺序）永远无法还原 = 「退出重进
  // 图标回原位」。现在：①动态查询全部网格（含新页 pg* 网格）；②按顺序数组跨网格认领
  // 图标（搬入认领网格再插到记录位）；③同一图标被多个网格残留认领时（旧版不清理源页的
  // 脏数据），非【模板默认页】的认领胜出（见 ICON_HOME_GRID），并当场把输家数组里的
  // 脏条目清掉落盘——首启自愈，之后数组一致不再有歧义。DOM 里查不到的键（动态注入
  // 图标尚未生成）保留不动，等 mochi-restore-done / contact-switched 的下一轮归位。
  const restoreAppIconOrder = () => {
    const allGrids = Array.prototype.slice.call(document.querySelectorAll('.app-grid'));
    const byKey = {};
    allGrids.forEach(g => {
      g.querySelectorAll('.app').forEach(a => { if (a.dataset.app) byKey[a.dataset.app] = a; });
    });
    const arrays = {};
    allGrids.forEach(grid => {
      const gid = grid.dataset.app;
      if (!gid) return;
      try { const v = store.get('app-icon-order-' + gid); if (v) { const p = JSON.parse(v); if (Array.isArray(p)) arrays[gid] = p; } } catch (e) {}
    });
    const owner = {};
    allGrids.forEach(grid => {
      const gid = grid.dataset.app;
      const arr = arrays[gid];
      if (!arr) return;
      arr.forEach(k => {
        if (!byKey[k]) return;
        if (!owner[k] || (owner[k] === ICON_HOME_GRID[k] && gid !== ICON_HOME_GRID[k])) owner[k] = gid;
      });
    });
    allGrids.forEach(grid => {
      const gid = grid.dataset.app;
      const order = arrays[gid];
      if (!order || !order.length) return;
      order.forEach((k, i) => {
        if (owner[k] !== gid) return;
        const node = byKey[k];
        if (!node) return;
        if (node.parentNode !== grid) grid.appendChild(node); // 跨网格认领：先搬入再定位
        // 插入到当前第 i 个位置前（移动节点不重建，事件绑定保留）
        const ref = grid.children[i];
        if (ref && ref !== node) grid.insertBefore(node, ref);
      });
      // 脏条目清理：DOM 可见但归属别处的键从本网格数组剔除并落盘（幂等，无变化不写）
      const cleaned = order.filter(k => !byKey[k] || owner[k] === gid);
      if (cleaned.length !== order.length) {
        try { store.set('app-icon-order-' + gid, JSON.stringify(cleaned)); } catch (e) {}
      }
    });
  };
  restoreAppIconOrder();
  // v3.6.x：图标隐藏/恢复——装修模式下可隐藏图标，清空桌面后自定义布局
  const getHiddenIcons = () => {
    try { return JSON.parse(store.get('hidden-icons') || '[]'); } catch (e) { return []; }
  };
  const setHiddenIcons = (arr) => {
    store.set('hidden-icons', JSON.stringify(arr));
  };
  const applyHiddenIcons = () => {
    const hidden = getHiddenIcons();
    // #823：寻踪总开关关闭时桌面【寻踪】图标与手动隐藏图标同轴收起——本函数会把「名单外」
    // 图标的 display 复位成 ''（切桌面、恢复隐藏图标弹窗都会跑它），不认这个口径入口会自己回来。
    const ckOff = typeof window.checkinDeskOff === 'function' && window.checkinDeskOff();
    document.querySelectorAll('.app').forEach(app => {
      const key = app.dataset.app;
      if (hidden.indexOf(key) >= 0 || (ckOff && key === 'checkin')) app.style.display = 'none';
      else app.style.display = '';
    });
  };
  applyHiddenIcons();
  // v3.5.95：自定义图标大键可能只存在 IndexedDB（压缩失败兜底会存原始大图）→ 补读后重新恢复图标
  // v3.26.x：串行逐键读取（上一键 resolve 才读下一键）把回填耗时放大成 N×单键——大键多或
  // 慢 IDB 机器（更新后首启网络/主线程忙时更甚）窗口拉长到数秒以上，用户看到「上传的桌面
  // 图标图片消失，刷新才回来」。改为 Promise.all 并行一次读完，全部写回后统一重绘一次；
  // 单键失败只跳过该键不影响其余（原串行链一键 reject 会中断后续所有键且不再重绘）。
  // FIX 2026-09-10 #265（小米13+Edge「手动改完桌面布局，退出浏览器后还原初始布局」，
  // 多机型同症状）：本块原实现对 IDB 里所有 app-icon-* 键【无条件】store.set 回写，把
  // idb.js 的优先级规则反过来——idbSet 是异步 fire-and-forget，Edge/真我/荣耀杀进程或事务
  // 挂起时 IDB 落后于 localStorage（retainValue 判据同源）。用户在装修模式排好新顺序后
  // 关浏览器，若那一次 IDB 写丢了，下次启动本块就把「陈旧 IDB 顺序」写进内存缓存 + LS，
  // 覆盖掉刚保存的新值；本会话 DOM 早已按新值排好（当场看不出问题），再下次启动屏幕就
  // 回到旧排布 = 用户看到的「退出浏览器后还原初始布局」。这里改成【只补空、不覆盖】：
  // 现有值（LS/内存缓存，即最新一次成功写入）一律不动，新鲜度裁决交回 idbRestore 的
  // retainValue + 写日志（#40/#226/#229）那条既有链路。前缀同样只取一次，防 #88 启动校正
  // 在 filter 与 slice 之间换桌面，把别人的图标值写进当前桌面。
  try {
    if (window.idbGetAllKeys) {
      const iconPfx = window.activePrefix() + ':';
      window.idbGetAllKeys().then(keys => {
        const iconKeys = (keys || []).filter(k => k.indexOf(iconPfx + 'app-icon-') === 0);
        if (!iconKeys.length) return;
        return Promise.all(iconKeys.map(k =>
          window.idbGet(k).then(v => {
            const rel = k.slice(iconPfx.length);
            // 只填「现在读不到」的键（大图键 >200KB 不进 LS 属正常补读场景）
            if (store.get(rel) !== null) return;
            if (v && typeof v === 'string' && v.length > 2) store.set(rel, v);
          }).catch(function () {})
        )).then(() => { restoreAppIcons(); restoreAppIconOrder(); });
      }).catch(function () {});
    }
  } catch (e) {}

  // v3.14.x：换图标菜单提取为全局函数——图标可能被 applyGroupChatMode/applyDeskLayout
  // 移出 .app-grid（如群聊开启时占卜移到隐藏池，或用户拖到其他页），grid click 监听器
  // 不触发；暴露 window.openIconMenu 供各图标自身监听器兜底调用
  window.openIconMenu = function (app) {
    // FIX 2026-09-16 #581：调整图片位置优先——①面板开着时再点图标＝换目标；②「调整图标图片位置」
    // 入口置了 __iconAdjustPick，点哪个图标就调哪个（不用先认出菜单里的同名项）
    if (window.__iconFitPanelOpen) { openIconFitPanel(app); return; }
    if (window.__iconAdjustPick) {
      // FIX 2026-09-17 #696：这个标记必须先消费掉、再判走哪条分支。此前直接转给
      // openIconFitPanel：点到的图标「没有自定义图片」时它早退、标记原样留着，于是之后
      // 每一次点图标都被劫持——有图的弹位置面板、没图的只弹一句提示，图标菜单不再出现
      // ＝用户报的「装修模式点桌面图标上传图片失效」，而且整会话不自愈（要刷新页面）。
      window.__iconAdjustPick = false;
      if (app && app.dataset.app && store.get('app-icon-' + app.dataset.app)) { openIconFitPanel(app); return; }
      // 没传过图的图标：不吞这次点击，直接落到下面的图标菜单——用户当场选「上传图片」
      toast('这个图标还没有自定义图片，先上传一张');
    }
    // v3.27.x：批量换图队列——「批量上传图标图片」载入多张后，依次点桌面图标按顺序
    // 换上（每点一个消耗一张），队列清空自动恢复正常图标菜单。绕过弹窗直接换图，
    // 是批量场景的专用快路径；透明度沿用该图标已存设置。
    if (window.__iconBatchQ && window.__iconBatchQ.length) {
      const bData = window.__iconBatchQ.shift();
      const bKey = app.dataset.app;
      // 优化④：换图前留底旧图标（prev=null 表示原本是默认 SVG），供「撤销上次批量换图」
      ;(window.__iconBatchUndo = window.__iconBatchUndo || []).push({ key: bKey, prev: store.get('app-icon-' + bKey) || null });
      const bIcon = app.querySelector('.app-ico');
      if (bIcon) {
        bIcon.innerHTML = '';
        const bImg = document.createElement('img');
        bImg.src = bData; bImg.alt = '';
        bIcon.appendChild(bImg);
      }
      store.set('app-icon-' + bKey, bData);
      // #581：批量换上的图同样吃该图标已存的缩放/位置（换图不重置构图）
      applyAppIconLook(app);
      const bLeft = window.__iconBatchQ.length;
      if (bLeft) toast('已换上，还剩 ' + bLeft + ' 张——继续点下一个图标');
      else { toast('批量换图完成，共 ' + (window.__iconBatchTotal || '?') + ' 张'); window.__iconBatchQ = null; }
      return;
    }
    const grid = app.closest('.app-grid');
    const key = app.dataset.app;
    const ico = app.querySelector('.app-ico');
    const hasCustom = !!store.get('app-icon-' + key);
    const pickFile = () => {
      // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现虽挂 body，但 accept 迟到、无 label
      // 原生激活兜底、每次点按 new 一个再 remove——注意历史注释点名的「vivo Edge」正是本族机型）
      window.mochiFilePick({
        id: 'mochi-appicon-pick', accept: 'image/*',
        onFiles: (files) => {
        const f = files && files[0];
        if (!f) { toast('没有取到图片，请再选一次'); return; }
        const reader = new FileReader();
        // v3.2x.x：上传图片卡顿很久——解码全分辨率位图 + 压到 256px 在
        // 主线程同步执行，原图大时界面会卡死数秒且毫无反馈看起来像假死。
        // 现在选完图先弹「正在处理图片…」，并让出当前帧（setTimeout）让
        // toast 先渲染出来，再做耗时的压缩，处理完再提示结果；超出 8MB
        // base64 / 26MP 的图 decode 前就被 compressImage 拦截（不会有卡顿）。
        reader.onload = () => {
          toast('正在处理图片…');
          setTimeout(() => {
            compressImage(reader.result, 256).then(data => {
              if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
              if (ico) {
                ico.innerHTML = '';
                const img = document.createElement('img');
                img.src = data;
                img.alt = '';
                ico.appendChild(img);
              }
              store.set('app-icon-' + key, data);
              // v3.27.x：换图保持已设透明度；#581：一并保持缩放/位置（换图不用重调构图）
              applyAppIconLook(app);
              toast('图标已更新');
            });
          }, 80);
        };
        reader.readAsDataURL(f);
        }
      });
    };
    const moveApp = (dir) => {
      if (!grid) return;
      const apps = Array.prototype.slice.call(grid.querySelectorAll('.app'));
      const idx = apps.indexOf(app);
      if (dir === 'up' && idx > 0) grid.insertBefore(app, apps[idx - 1]);
      else if (dir === 'down' && idx < apps.length - 1) grid.insertBefore(apps[idx + 1], app);
      const order = Array.prototype.slice.call(grid.querySelectorAll('.app')).map(a => a.dataset.app);
      store.set('app-icon-order-' + grid.dataset.app, JSON.stringify(order));
      toast(dir === 'up' ? '已上移' : '已下移');
    };
    const pills = [];
    pills.push({ label: hasCustom ? '更换图片' : '上传图片', value: '1' });
    if (hasCustom) pills.push({ label: '清除图片', value: '2' });
    // FIX 2026-09-16 #581：单张图的「缩放 + 位置」——只移动图片在图标里的位置，不用重新上传
    if (hasCustom) pills.push({ label: '调整图片位置', value: 'fit' });
    // 优化④：统一图标风格——把当前这张图应用到桌面全部图标（每个图标保留各自的透明度设置）
    if (hasCustom) pills.push({ label: '同图应用到全部图标', value: 'all' });
    if (hasCustom) pills.push({ label: '图标透明度', value: 'opacity' });
    if (grid) { pills.push({ label: '上移', value: 'up' }); pills.push({ label: '下移', value: 'down' }); }
    pills.push({ label: '隐藏图标', value: 'hide' });
    if (window.openModal) {
      window.openModal('图标设置', '', (v) => {
        if (v === '1') pickFile();
        else if (v === 'fit' && hasCustom) openIconFitPanel(app);
        else if (v === '2' && hasCustom) {
          store.remove('app-icon-' + key);
          if (ico && ico.dataset.orig) ico.innerHTML = ico.dataset.orig;
          // #581：清除图片后位置/缩放一并撤掉（图片没了，构图设置留着只会误导）
          store.remove('app-icon-zoom-' + key);
          store.remove('app-icon-pos-x-' + key);
          store.remove('app-icon-pos-y-' + key);
          applyAppIconFit(app);
          toast('已恢复默认图标');
        } else if (v === 'all' && hasCustom) {
          // 优化④：同图应用到全部图标——喜欢单色图标套装的一次到位。
          // 每个图标自己的透明度设置（app-icon-opacity-<key>）保留不变。
          const srcData = store.get('app-icon-' + key);
          if (!srcData) { toast('读取图标失败，请重试'); return; }
          let n = 0;
          document.querySelectorAll('.app').forEach((a2) => {
            const k2 = a2.dataset.app;
            if (!k2) return;
            store.set('app-icon-' + k2, srcData);
            const ico2 = a2.querySelector('.app-ico');
            if (ico2) {
              ico2.innerHTML = '';
              const im2 = document.createElement('img');
              im2.src = srcData; im2.alt = '';
              ico2.appendChild(im2);
            }
            const op2 = store.get('app-icon-opacity-' + k2);
            if (op2) applyAppIconOpacity(a2, parseInt(op2, 10));
            // #581：每个图标保留各自的缩放/位置（同透明度口径），换图后构图不串
            applyAppIconFit(a2);
            n++;
          });
          toast('已把同图应用到 ' + n + ' 个图标（可在装修模式逐个改回）');
        } else if (v === 'opacity' && hasCustom) {
          // v3.27.x：自定义图标图片透明度——slider 实时预览 + 预设 pills
          const curOp = parseInt(store.get('app-icon-opacity-' + key) || '100', 10);
          window.openModal('图标透明度', '', (vv) => {
            const pct = parseInt(vv, 10);
            if (isNaN(pct) || pct < 0 || pct > 100) { toast('请输入 0-100 的数字'); return; }
            if (pct === 100) store.remove('app-icon-opacity-' + key);
            else store.set('app-icon-opacity-' + key, String(pct));
            applyAppIconOpacity(app, pct);
          }, {
            noInput: true,
            slider: {
              min: 0, max: 100, step: 1, value: curOp, label: '拖动调整图标透明度', unit: '%',
              onChange: (val) => { applyAppIconOpacity(app, val); },
            },
            pills: [
              { label: '100%', value: '100' },
              { label: '80%', value: '80' },
              { label: '60%', value: '60' },
              { label: '40%', value: '40' },
              { label: '20%', value: '20' },
            ],
          });
        } else if (v === 'up') moveApp('up');
        else if (v === 'down') moveApp('down');
        else if (v === 'hide') {
          const hidden = getHiddenIcons();
          if (hidden.indexOf(key) < 0) hidden.push(key);
          setHiddenIcons(hidden);
          app.style.display = 'none';
          toast('已隐藏，可在装修栏恢复');
        }
      }, { noInput: true, pills: pills });
    } else {
      pickFile();
    }
  };
  // FIX 2026-09-16 #581：图标图片「缩放 + 位置」调整面板（底部浮层，桌面上半屏边看边调）。
  // 两个入口共用：①装修模式点图标 →「调整图片位置」；②边看边调抽屉/设置页「调整图标图片位置」
  // → 置 __iconAdjustPick，点哪个图标就调哪个。面板开着再点别的图标＝换目标（不重开面板）。
  // 只改键 + 即时重绘该图标，不碰图片本体（正是用户要的「不用重新上传」）。
  // 独立小滑杆（抽屉那套 mkSlider 在 openBeautyDrawer 闭包里，此处复刻同款观感与行高）。
  const iconFitSlider = (label, min, max, step, val, unit, onInput) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px';
    const lb = document.createElement('span');
    lb.textContent = label;
    lb.style.cssText = 'font-size:11.5px;color:var(--muted,#888);flex:none;width:74px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step || 1;
    inp.value = String(val);
    inp.style.cssText = 'flex:1;min-width:0';
    const vv = document.createElement('span');
    vv.style.cssText = 'font-size:11px;color:var(--muted,#999);flex:none;width:40px;text-align:right';
    vv.textContent = inp.value + unit;
    inp.addEventListener('input', () => { vv.textContent = inp.value + unit; onInput(inp.value); });
    row.appendChild(lb); row.appendChild(inp); row.appendChild(vv);
    row.__input = inp; row.__val = vv; row.__unit = unit;
    return row;
  };
  const iconFitVals = (key) => {
    const zRaw = parseInt(store.get('app-icon-zoom-' + key) || '100', 10);
    const g = (k, d) => { const v = store.get(k); if (v === null || v === undefined || v === '') return d; const n = parseInt(v, 10); return isNaN(n) ? d : n; };
    return {
      z: (isNaN(zRaw) || zRaw < 100) ? 100 : Math.min(300, zRaw),
      x: g('app-icon-pos-x-' + key, 50),
      y: g('app-icon-pos-y-' + key, 50),
    };
  };
  // 目标图标高亮（装修模式下图标本就有描边，这里再加一圈底影＝「现在调的是这个」）
  let iconFitHi = null;
  const iconFitHighlight = (app) => {
    if (iconFitHi && iconFitHi !== app) { try { iconFitHi.style.boxShadow = ''; } catch (e) {} }
    iconFitHi = app || null;
    if (iconFitHi) { try { iconFitHi.style.boxShadow = '0 0 0 3px rgba(47,111,208,.85)'; } catch (e) {} }
  };
  const openIconFitPanel = (app) => {
    // FIX 2026-09-17 #696：早退分支也要消费掉「等待点图标」标记——否则标记悬空会把后面每次
    // 点图标都送进这里（无图只弹提示、连图标菜单都出不来）。见 openIconMenu 同条注释。
    window.__iconAdjustPick = false;
    if (!app || !app.dataset.app || !store.get('app-icon-' + app.dataset.app)) {
      toast('这个图标还没有自定义图片，先上传一张');
      return;
    }
    const key = app.dataset.app;
    let p = document.getElementById('icon-fit-panel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'icon-fit-panel';
      // 与边看边调抽屉同款半透明底，避免整块挡住桌面（#562 口径）
      p.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:96;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 82%, transparent);color:var(--ink,#111);box-shadow:0 -6px 24px rgba(0,0,0,.18);border-radius:16px 16px 0 0;overflow-y:auto;overflow-x:hidden;padding:0 12px calc(10px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)));box-sizing:border-box;display:none;flex-direction:column;gap:8px';
      document.body.appendChild(p);
    }
    const nameEl = app.querySelector('.app-name');
    const name = (nameEl && nameEl.textContent.trim()) || key;
    const cur = iconFitVals(key);
    p.innerHTML = '';
    const grip = document.createElement('div');
    grip.style.cssText = 'width:36px;height:4px;border-radius:2px;background:var(--card-border,#ddd);margin:7px auto 0;flex:none';
    p.appendChild(grip);
    const hd = document.createElement('div');
    hd.style.cssText = 'display:flex;align-items:center;gap:8px;flex:none';
    const hdTxt = document.createElement('span');
    hdTxt.textContent = '调整「' + name + '」的图片位置';
    hdTxt.style.cssText = 'font-size:13px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const mkMini = (label, fn, cssExtra) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'flex:none;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;border-radius:8px;padding:4px 9px;cursor:pointer' + (cssExtra || '');
      b.addEventListener('click', fn);
      return b;
    };
    const closePanel = () => { p.style.display = 'none'; window.__iconFitPanelOpen = false; iconFitHighlight(null); };
    const closeBtn = mkMini('\u2715', closePanel, ';padding:4px 8px');
    hd.appendChild(hdTxt); hd.appendChild(closeBtn);
    p.appendChild(hd);
    const setFit = (patch) => {
      const next = Object.assign({}, iconFitVals(key), patch);
      if (next.z === 100) store.remove('app-icon-zoom-' + key); else store.set('app-icon-zoom-' + key, String(next.z));
      if (next.x === 50) store.remove('app-icon-pos-x-' + key); else store.set('app-icon-pos-x-' + key, String(next.x));
      if (next.y === 50) store.remove('app-icon-pos-y-' + key); else store.set('app-icon-pos-y-' + key, String(next.y));
      applyAppIconFit(app);
      hint.textContent = next.z === 100
        ? '先放大一点，再拖「水平/垂直位置」——不放大时只有原图被裁掉的部分能移动'
        : '图片即时生效：放大后可水平/垂直移动到任意部位';
    };
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10.5px;color:var(--muted,#999);line-height:1.5;flex:none';
    // 标签与「壁纸定位与缩放」面板同款（水平位置/垂直位置/缩放），用户不必学两套说法
    const zRow = iconFitSlider('缩放', 100, 300, 5, cur.z, '%', (v) => setFit({ z: parseInt(v, 10) }));
    const xRow = iconFitSlider('水平位置', 0, 100, 1, cur.x, '%', (v) => setFit({ x: parseInt(v, 10) }));
    const yRow = iconFitSlider('垂直位置', 0, 100, 1, cur.y, '%', (v) => setFit({ y: parseInt(v, 10) }));
    p.appendChild(zRow); p.appendChild(xRow); p.appendChild(yRow);
    p.appendChild(hint);
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;flex:none;padding-bottom:2px';
    const resetBtn = mkMini('重置为默认', () => {
      store.remove('app-icon-zoom-' + key);
      store.remove('app-icon-pos-x-' + key);
      store.remove('app-icon-pos-y-' + key);
      applyAppIconFit(app);
      const v0 = iconFitVals(key);
      zRow.__input.value = String(v0.z); zRow.__val.textContent = v0.z + zRow.__unit;
      xRow.__input.value = String(v0.x); xRow.__val.textContent = v0.x + xRow.__unit;
      yRow.__input.value = String(v0.y); yRow.__val.textContent = v0.y + yRow.__unit;
      hint.textContent = '已重置：图片按默认居中铺满';
      toast('已重置图片位置');
    }, ';flex:1;padding:7px;font-size:12px');
    const doneBtn = mkMini('完成', () => {
      closePanel();
      toast('图标图片已保存，刷新后仍是这个位置');
    }, ';flex:1;padding:7px;font-size:12px;font-weight:700');
    btns.appendChild(resetBtn); btns.appendChild(doneBtn);
    p.appendChild(btns);
    hint.textContent = cur.z === 100
      ? '先放大一点，再拖「水平/垂直位置」——不放大时只有原图被裁掉的部分能移动'
      : '图片即时生效：放大后可水平/垂直移动到任意部位';
    iconFitHighlight(app);
    p.style.display = 'flex';
    window.__iconFitPanelOpen = true;
  };
  window.mochiIconFitPanel = openIconFitPanel;
  grids.forEach(grid => {
    grid.addEventListener('click', (e) => {
      if (!grid.classList.contains('editing')) return;
      const app = e.target.closest('.app');
      if (!app) return;
      e.stopPropagation();
      window.openIconMenu(app);
    });
  });
  // FIX 2026-09-12 #351：运行时创建的新页网格（pg*）收不到上面的 per-grid 绑定——
  // 委托到 document 兜底：编辑态网格内的图标点击统一弹图标菜单。静态网格路径已在
  // 自身监听里 stopPropagation，不会走到这里重复弹。
  document.addEventListener('click', (e) => {
    const grid = e.target.closest ? e.target.closest('.app-grid') : null;
    if (!grid || !grid.classList.contains('editing')) return;
    const app = e.target.closest('.app');
    if (!app) return;
    window.openIconMenu(app);
  });
  // v3.15.x：装修模式点「独立组件图标」换图兜底——被移出 .app-grid 的单个功能图标
  //（装修库「添加到此页」/拖拽换页后的 app-* 图标，第2/3页装修用户常见）不在任何
  // 网格内，上面的网格监听器不触发；而这类图标自身 handler 在 editing 时按约定
  // 直接 return 等网格兜底 → 谁都不处理，表现为「装修模式点图标没反应、换不了图」
  // （vivo Edge 真机反馈）。在 #page-phone 上委托：decor-on 且 .app 不在编辑态
  // 网格内时直接开图标菜单；网格内路径已 stopPropagation 冒泡不到这里，不会重复弹。
  const phoneDecorEl = document.getElementById('page-phone');
  if (phoneDecorEl) {
    phoneDecorEl.addEventListener('click', (e) => {
      if (!phoneDecorEl.classList.contains('decor-on')) return;
      if (e.target.closest('.desk-lib') || e.target.closest('.decor-bar') || e.target.closest('.desk-page-add')) return;
      const app = e.target.closest('.app');
      if (!app) return;
      const grid = app.closest('.app-grid');
      if (grid && grid.classList.contains('editing')) return;
      e.stopPropagation();
      window.openIconMenu(app);
    });
  }

  const iconRow = document.getElementById('row-custom-icon');
  // v3.6.x：进入装修模式的公共逻辑（自定义桌面图标 / 卡片背景两个入口共用）：
  // 切到桌面 + 图标网格进入 editing（点图标换图）+ 开启 decor-on（点卡片设背景）+ 显示装饰条
  const enterDecor = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const phoneTab = document.querySelector('.tab[data-page="page-phone"]');
    if (phoneTab) phoneTab.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const phonePage = document.getElementById('page-phone');
    if (phonePage) phonePage.hidden = false;
    // FIX 2026-09-12 #351：动态查询——新页 pg* 网格是运行时创建的，静态 grids 列表
    // 不含它们；编辑态类漏挂 = 装修模式点新页图标走功能入口而不是图标菜单
    document.querySelectorAll('.app-grid').forEach(g => g.classList.add('editing'));
    const phone = document.getElementById('page-phone');
    if (phone) phone.classList.add('decor-on');
    const bar = document.getElementById('decor-bar');
    if (bar) bar.hidden = false;
  };
  if (iconRow) {
    iconRow.addEventListener('click', enterDecor);
  }
  // v3.27.x：批量上传图标图片——一次选多张（按相册顺序），载入后切到桌面装修模式，
  // 用户按顺序点图标、每点一个换上一张（消费逻辑在 openIconMenu 队列分支）。
  // 队列挂 window（__iconBatchQ）而非闭包：openIconMenu 已提取为全局函数，
  // 图标可能在任意网格/独立组件被点击，队列必须跨作用域可见。
  const iconBatchRow = document.getElementById('row-icon-batch');
  if (iconBatchRow) {
    iconBatchRow.addEventListener('click', () => {
      // 批量进行中再点 = 取消
      if (window.__iconBatchQ && window.__iconBatchQ.length) { window.__iconBatchQ = null; toast('已取消批量换图'); return; }
      // 优化④：撤销上次批量换图——按留底栈把每个图标恢复成换图前的样子
      //（prev 为 null 表示原本是默认 SVG，删键后 restoreAppIcons 会还原原始 innerHTML）
      const doBatchUndo = () => {
        const stack = window.__iconBatchUndo || [];
        if (!stack.length) { toast('没有可撤销的批量换图'); return; }
        stack.forEach((it) => {
          if (it.prev) store.set('app-icon-' + it.key, it.prev);
          else store.remove('app-icon-' + it.key);
        });
        window.__iconBatchUndo = [];
        try { restoreAppIcons(); } catch (e) {}
        toast('已撤销，' + stack.length + ' 个图标恢复原样');
      };
      // 上次批量留下的撤销栈还在 → 先问清楚是开新批量还是撤销
      if ((window.__iconBatchUndo || []).length && window.openModal) {
        window.openModal('批量上传图标', '', (v) => {
          if (v === 'undo') doBatchUndo();
          else if (v === 'new') startPick();
        }, { noInput: true, pills: [{ label: '选择图片，开始新批量', value: 'new' }, { label: '撤销上次批量换图', value: 'undo' }] });
        return;
      }
      function startPick() {
        // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 accept 迟到＋无 label 兜底＋
        // 每次点按 new 一个 input 再 remove；本族机型包括 vivo Edge）
        window.mochiFilePick({
          id: 'mochi-icon-batch-pick', accept: 'image/*', multiple: true,
          onFiles: (fs) => {
          if (!fs.length) { toast('没有取到图片，请再选一次'); return; }
          toast('正在处理 ' + fs.length + ' 张图片…');
          const imgs = [];
          let chain = Promise.resolve();
          fs.forEach((f) => {
            chain = chain.then(() => new Promise((res) => {
              const r = new FileReader();
              r.onload = () => {
                // 串行压缩（256px，与单个图标上传同规格），防多张原图同时解码卡顿
                compressImage(r.result, 256).then((d) => { if (d) imgs.push(d); res(); });
              };
              r.onerror = () => res();
              r.readAsDataURL(f);
            }));
          });
          chain.then(() => {
            if (!imgs.length) { toast('图片过大或格式不支持，请换小图'); return; }
            window.__iconBatchQ = imgs;
            window.__iconBatchTotal = imgs.length;
            window.__iconBatchUndo = []; // 撤销栈只保最近一次批量
            enterDecor();
            toast('已载入 ' + imgs.length + ' 张——到桌面按顺序点图标，每点一个换一张');
          });
          }
        });
      }
      startPick();
    });
  }
  // FIX 2026-09-16 #581：设置页「调整图标图片位置」行——与装修模式点图标同一套面板，
  // 这里先切到桌面装修模式并置标记，用户点哪个图标就调哪个（三个入口：设置页 / 抽屉 / 图标菜单）
  const iconFitRow = document.getElementById('row-icon-fit');
  if (iconFitRow) {
    iconFitRow.addEventListener('click', () => {
      try { enterDecor(); } catch (e) {}
      window.__iconAdjustPick = true;
      toast('点桌面上要调整的图标，就能调它的图片位置');
    });
  }
  // FIX v3.26.x #769：设置页「底部导航栏」两个入口——样式行直接唤起边看边调并停在
  // 「底部栏」分区（改哪看哪）；上传行走 tabIconMenu（与抽屉同一实现，不重复）
  const tabbarStyleRow = document.getElementById('row-tabbar-beauty');
  if (tabbarStyleRow) {
    tabbarStyleRow.addEventListener('click', () => openBeautyDrawer('tabbar'));
  }
  const tabbarIconRow = document.getElementById('row-tabbar-icons');
  if (tabbarIconRow) {
    tabbarIconRow.addEventListener('click', () => {
      window.openModal('上传底部栏按钮图片', '', (v) => { if (v) tabIconMenu(v); }, {
        noInput: true, staticText: '要换哪个按钮？（屏幕底部一行，从左到右）',
        pills: TABBAR_PAGES.map(pk => ({ label: TABBAR_PAGE_NAMES[pk], value: pk }))
      });
    });
  }
  // v3.27.x：快捷面板（项5）——美化页常用项直达，避免进多层菜单
  // #602：「深色模式」快捷按钮移除（设置页已有入口，这里重复）
  (function bindQuickPanel() {
    const bind = (id, targetId) => { const b = document.getElementById(id); const t = document.getElementById(targetId); if (b && t) b.addEventListener('click', () => t.click()); };
    bind('dq-accent', 'row-accent-color');
    bind('dq-bg', 'row-bg-preset');
    bind('dq-radius', 'row-desk-card-radius');
    bind('dq-tabbar', 'row-tabbar-beauty'); // #769：底部栏直达
    // v3.27.x #146：dq-random（随机美化快捷入口）已随「一键随机美化」功能一并删除
  })();
  // FIX 2026-09-15 #527：边看边调改为「底部抽屉」。
  // 原实现是 `position:fixed;right:0;width:min(70vw,300px)` 的右侧浮层：手机屏宽约 390px
  // 时它挡住 70% 宽度，而桌面内容是居中的 → 用户调的时候几乎看不到效果，这正是用户报
  // 「不能边看边调」的根因（桌面浏览器上 .phone 居中、抽屉贴浏览器最右缘，反而正常，
  // 所以这个坑只在真机暴露）。现改为底部抽屉：桌面完整留在上半屏，抽屉占下半屏、可折叠。
  // 同时按「颜色/尺寸/背景」分区补齐控件（原来只有 5 项：主题色/组件背景/边框/圆角/透明度，
  // 按钮色、按钮文字色、爱心色、图标圆角、字号、卡片大小、壁纸/模糊/遮罩全都没有）。
  // FIX 2026-09-16 #562 / v8.29 #1008：边看边调面板可拖动/吸附（用户「还是会遮挡其他东西我看不见」）——
  // 会话内记住拖到的纵向位置；null＝自动位（停在底部导航之上，同 #962 屏幕适配面板口径）。
  // 放模块作用域不落盘：纯 UI 位置，避免与 contacts.js 的根键迁移/EXCLUDE 清单打交道。
  // v8.29 #1008（用户直派「桌面美化的边看边调不能托标题行可上移」）：#562 当年只留下了
  // beautyDockTop 这个声明、拖动实现从未落地（grip 一直是纯装饰的误导 affordance，聊天侧
  // #760 的注释里已记过这笔）；本轮按聊天侧同一口径把三处抽屉补齐。同时默认位从贴底
  // （bottom:0）改为「停在底部导航之上」——贴底时抽屉 z-index:95 压住 z-index:2 的底部导航，
  // 开着它根本切不了页，而「边看边调」的全部意义就是带着去别的页面看现场。
  let beautyDockBot = null;
  function beautyDrawerReserve() {
    try {
      const tb = document.querySelector('.tabbar');
      const t = tb && tb.getBoundingClientRect();
      if (t && t.height && t.top > 0) return Math.max(14, Math.round(window.innerHeight - t.top + 8));
    } catch (e) {}
    return 14;
  }
  function beautyDrawerApplyBottom() {
    const d = document.getElementById('beauty-drawer');
    if (!d) return;
    d.style.bottom = (beautyDockBot == null ? beautyDrawerReserve() : beautyDockBot) + 'px';
  }
  // v8.29 #1008：自动位要按「切页完成后的底部导航」量。openBeautyDrawer 会先切到桌面页，
  // 而底部导航的显示是 tabs.js 的 syncChrome 在页面 hidden 观察器里补的——本函数在那一刻
  // 量到的 tabbar 还是 hidden（0 高）⇒ 会把抽屉错放到贴底 14px（实测 verify-beauty-cta-first
  // B2 当场红：clearsNav=false）。只读观察页面 hidden，切页落定后再量一次；rAF 兜首帧。
  let beautyDockObs = null;
  function watchBeautyDockPages() {
    if (beautyDockObs || !('MutationObserver' in window)) return;
    try {
      beautyDockObs = new MutationObserver(function () { if (beautyDockBot == null) beautyDrawerApplyBottom(); });
      document.querySelectorAll('.page').forEach(function (p) { beautyDockObs.observe(p, { attributes: true, attributeFilter: ['hidden'] }); });
    } catch (e) { beautyDockObs = null; }
  }
  // #769：可选 secKey＝直接打开指定分区（设置页「底部栏美化」行直达「底部栏」）；省略=停留上次分区
  const openBeautyDrawer = (secKey) => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const phoneTab = document.querySelector('.tab[data-page="page-phone"]');
    if (phoneTab) phoneTab.classList.add('active');
    document.querySelectorAll('.page').forEach(pg => pg.hidden = true);
    const phonePage = document.getElementById('page-phone');
    if (phonePage) phonePage.hidden = false;
    let d = document.getElementById('beauty-drawer');
    if (!d) {
      d = document.createElement('div');
      d.id = 'beauty-drawer';
      document.body.appendChild(d);
    }
      // FIX 2026-09-15 #527b 边看边调：紧凑底部条（真机反馈「还是没用，把全部基本遮挡完了」）。
      // 初版做成 56vh 抽屉 + 每行一个原生 <input type=color>：真机实测原生取色器被渲染成
      // 一大块（每行约 100px），6 个颜色行 + 5 个滑杆 + 2 个背景滑杆总内容上千 px，
      // 高度又被 56vh 卡住 → 只露几个控件却盖掉大半个桌面。现改为：
      //   ① 高度上限 44vh，内容紧凑（颜色项 2 列网格，单行约 32px）；
      //   ② 三个分区胶囊互斥，一次只渲染一组控件（原来三段全堆一起 = 内容超高的主因）；
      //   ③ 颜色改为「点色块 → 就地展开调色盘」即时生效，不用原生取色器、不弹全屏弹窗；
      //   ④ 「收起」把控件区整体折叠，只剩标题行，随时看整屏效果。
      // FIX 2026-09-16 #562：面板改半透明（用户报「又不是半透明的页面，还是会遮挡其他东西我看不见」）——
      // 底色 72% 不透明 + 不透明度更高时保留原观感（color-mix 不支持的老内核回落上一句纯色，行为不变）；
      // 同时高度上限 44vh→40vh，给桌面留更多可视区。刻意不加 backdrop-filter：AGENTS 的 iOS 卡顿红线。
      // v8.29 #1008：加 transition:bottom——切页时自动位会在「底部导航留白」与「无导航 14px」
      // 之间跳（实测设置页 90px → 聊天设置页 14px 一跳，旧实现 transition all 0s 硬切＝用户
      // 看到的「瞬移/闪」）。拖动期间由 bindDrawerDrag 临时置 none，不影响跟手。
      d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:95;max-height:40vh;transition:bottom .16s ease;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);color:var(--ink,#111);box-shadow:0 -6px 24px rgba(0,0,0,.18);border-radius:16px 16px 0 0;overflow-y:auto;overflow-x:hidden;padding:0 12px calc(10px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)));box-sizing:border-box;display:flex;flex-direction:column;gap:8px';
      d.innerHTML = '';
      const grip = document.createElement('div');
      grip.style.cssText = 'width:36px;height:4px;border-radius:2px;background:var(--card-border,#ddd);margin:7px auto 0;flex:none';
      d.appendChild(grip);
      const mkMini = (label, fn, cssExtra) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'flex:none;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;border-radius:8px;padding:4px 9px;cursor:pointer' + (cssExtra || '');
        b.addEventListener('click', fn);
        return b;
      };
      const hd = document.createElement('div');
      hd.style.cssText = 'display:flex;align-items:center;gap:8px;flex:none';
      const hdTxt = document.createElement('span');
      hdTxt.textContent = '边看边调（即时生效）';
      hdTxt.style.cssText = 'font-size:13px;font-weight:700;flex:none';
      // v8.29 #1008：标题行可拖动这件事此前三处抽屉都没有任何文字提示（用户原话「用户并不知道
      // 有这个功能」）——提示固定挂在标题行里，点「收起」折叠正文区后仍然看得见。
      const hdHint = document.createElement('span');
      hdHint.textContent = '按住标题行上下拖 · 让开看桌面';
      hdHint.style.cssText = 'font-size:11px;color:var(--muted,#888);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const panelBody = document.createElement('div');
      panelBody.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:none';
      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:none';
      const foldBtn = mkMini('收起', () => {
        const willFold = panelBody.style.display !== 'none';
        panelBody.style.display = willFold ? 'none' : 'flex';
        foldBtn.textContent = willFold ? '展开' : '收起';
      });
      const closeBtn = mkMini('\u2715', () => { d.style.display = 'none'; showThemePage(); }, ';padding:4px 8px');
      hd.appendChild(hdTxt); hd.appendChild(hdHint); hd.appendChild(foldBtn); hd.appendChild(closeBtn);
      d.appendChild(hd);
      // v8.29 #1008：grip 与标题行都可竖向拖动（用户「不能托标题行可上移」）。口径与聊天侧 #760
      // 完全一致：pointer 事件 + setPointerCapture——不夺回控制权时触摸序列会被内核抢成滚动，
      // 表现为「抖一下拖不动」；标题行里的按钮让行（否则点不动）；拖动期间关掉 bottom 过渡，
      // 松手回自动位附近则吸附复位（null＝回「底部导航之上」）。
      const bindDrawerDrag = (el) => {
        el.style.touchAction = 'none';
        el.style.cursor = 'grab';
        let sy = 0, sb = 0, drag = false;
        el.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button')) return;
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          drag = true; sy = e.clientY;
          sb = beautyDockBot == null ? beautyDrawerReserve() : beautyDockBot;
          d.style.transition = 'none';
          try { el.setPointerCapture(e.pointerId); } catch (er) {}
          e.preventDefault();
        });
        el.addEventListener('pointermove', (e) => {
          if (!drag) return;
          beautyDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));
          beautyDrawerApplyBottom();
          e.preventDefault();
        });
        const up = () => {
          if (!drag) return;
          drag = false;
          d.style.transition = 'bottom .16s ease';
          if ((beautyDockBot || 0) <= beautyDrawerReserve() + 6) beautyDockBot = null; // 拖回自动位＝吸附复位
          beautyDrawerApplyBottom();
        };
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      };
      bindDrawerDrag(grip);
      bindDrawerDrag(hd); // grip 只有 4px 高，标题行才是主拖拽把手
      const chipsRow = document.createElement('div');
      chipsRow.style.cssText = 'display:flex;gap:6px;flex:none';
      panelBody.appendChild(chipsRow);
      panelBody.appendChild(body);
      d.appendChild(panelBody);
      // FIX #边看边调：一次会话内首次真正改动时快照一次，让「边看边调」也纳入撤销栈
      // （此前只有设置页各行 pushBeautyUndo，抽屉里乱调无从撤销）。arm 后不再重复压栈。
      let undoArmed = false;
      const armUndo = () => { if (undoArmed) return; undoArmed = true; try { pushBeautyUndo(); } catch (e) {} };
      // 单行滑杆：标签 74px + 滑杆 + 数值 40px（比原「标签另起一行的竖排」省一半高度）
      // apply(v)=纯视觉即时应用（不写库），persist(v)=落库；两者分离到 input/change 两个事件：
      // 拖动过程每帧只跑廉价的 setProperty，localStorage 同步写只在松手（change）触发一次，
      // 消除拖动掉帧（旧实现每个 input 事件都同步 store.set，一次拖动能数百次）。
      const mkSlider = (label, key, varName, min, max, step, unit, defVal, apply, persist) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px';
        const lb = document.createElement('span');
        lb.textContent = label;
        lb.style.cssText = 'font-size:11.5px;color:var(--muted,#888);flex:none;width:74px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step || 1;
        const cur = store.get(key);
        inp.value = (cur !== null && cur !== undefined && cur !== '') ? cur : String(defVal != null ? defVal : Math.round((min + max) / 2));
        inp.style.cssText = 'flex:1;min-width:0';
        const vv = document.createElement('span');
        vv.style.cssText = 'font-size:11px;color:var(--muted,#999);flex:none;width:40px;text-align:right';
        vv.textContent = inp.value + unit;
        const doApply = apply || ((v) => { document.documentElement.style.setProperty(varName, v + unit); });
        const doPersist = persist || ((v) => store.set(key, v));
        inp.addEventListener('input', () => { vv.textContent = inp.value + unit; armUndo(); doApply(inp.value); });
        inp.addEventListener('change', () => { doPersist(inp.value); });
        row.appendChild(lb); row.appendChild(inp); row.appendChild(vv);
        return row;
      };
      const PALETTE = ['#111111', '#ffffff', '#e05555', '#ff8800', '#ffd54f', '#4a9d5e', '#3a7bd5', '#8e5bd5', '#e055a0', '#8a8a8a'];
      let colorItems = [];
      let paletteHost = null;
      // 颜色项：2 列网格里一个可点小块。点它在下方面板就地展开调色盘（即时生效），
      // 不再用原生取色器（真机上它会被渲染成一大块，正是抽屉超高的直接原因）。
      const mkColorItem = (label, key, varName, isGlobal, onSet) => {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;align-items:center;gap:7px;padding:6px 8px;border:1px solid var(--card-border,#ddd);border-radius:9px;cursor:pointer;min-width:0';
        const sw = document.createElement('span');
        sw.style.cssText = 'width:18px;height:18px;border-radius:5px;border:1px solid var(--card-border,#ddd);flex:none;background:#fff';
        const tx = document.createElement('span');
        tx.textContent = label;
        tx.style.cssText = 'font-size:11.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        el.appendChild(sw); el.appendChild(tx);
        const curGet = () => { try { return (isGlobal ? localStorage.getItem(key) : store.get(key)) || ''; } catch (e) { return ''; } };
        // 未显式设置时回落到该 CSS 变量的实际计算值——否则「主题色」默认是黑却被画成白块，
        // 用户会误判当前颜色（同 #527 可读性口径：色块必须反映真实观感）
        const paint = () => {
          let c = curGet();
          if (!c) { try { c = String(getComputedStyle(document.documentElement).getPropertyValue(varName) || '').trim(); } catch (e) {} }
          sw.style.background = c || '#ffffff';
        };
        const curSet = (v) => {
          armUndo();
          // FIX 2026-09-16 #562：可选 onSet——「主题色」走与设置页同一套 applier（同时写
          // --btn-bg/--btn-ink 与键），修「边看边调点主题色只有 --btn-bg 变、--btn-ink 不跟随」。
          if (onSet) { try { onSet(v); } catch (e) {} paint(); return; }
          if (v === null) {
            try { if (isGlobal) localStorage.removeItem(key); else store.remove(key); } catch (e) {}
            document.documentElement.style.removeProperty(varName);
          } else {
            document.documentElement.style.setProperty(varName, v);
            if (isGlobal) { try { localStorage.setItem(key, v); } catch (e) {} } else store.set(key, v);
          }
          paint();
        };
        const item = { el, label, curGet, curSet, paint };
        el.addEventListener('click', () => {
          colorItems.forEach(it => { it.el.style.borderColor = 'var(--card-border,#ddd)'; });
          el.style.borderColor = 'var(--ink,#111)';
          renderPalette(item);
        });
        paint();
        colorItems.push(item);
        return el;
      };
      const renderPalette = (item) => {
        if (!paletteHost) return;
        paletteHost.innerHTML = '';
        const strip = document.createElement('div');
        strip.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
        const cur = item.curGet();
        PALETTE.forEach(c => {
          const dot = document.createElement('span');
          dot.style.cssText = 'width:23px;height:23px;border-radius:7px;border:1px solid var(--card-border,#ddd);cursor:pointer;flex:none;background:' + c;
          if (cur && String(cur).toLowerCase() === c.toLowerCase()) dot.style.borderColor = 'var(--ink,#111)';
          dot.addEventListener('click', () => item.curSet(c));
          strip.appendChild(dot);
        });
        const def = document.createElement('button');
        def.textContent = '默认';
        def.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
        def.addEventListener('click', () => item.curSet(null));
        strip.appendChild(def);
        paletteHost.appendChild(strip);
        const tip = document.createElement('div');
        tip.style.cssText = 'font-size:10.5px;color:var(--muted,#999);margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap';
        const tipTx = document.createElement('span');
        tipTx.textContent = '正在调「' + item.label + '」，点色块即时生效';
        const hexBtn = document.createElement('button');
        hexBtn.textContent = '手输色值';
        hexBtn.style.cssText = 'font-size:11px;padding:3px 8px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
        hexBtn.addEventListener('click', () => {
          openHexColorModal('输入' + item.label + '色值', item.curGet() || '#111111', (c) => { item.curSet(c); toast(item.label + '已设为 ' + String(c).toUpperCase()); });
        });
        tip.appendChild(tipTx); tip.appendChild(hexBtn);
        paletteHost.appendChild(tip);
      };
      const zoomWorks = !(window.matchMedia && window.matchMedia('(max-width: 900px)').matches) && !document.documentElement.classList.contains('force-mobile');
      const SECS = [
        { key: 'color', label: '颜色', build: () => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
          const grid = document.createElement('div');
          grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
          grid.appendChild(mkColorItem('主题色', 'xy-home-v2:accent-color', '--btn-bg', true, (v) => {
            // FIX 2026-09-16 #562：与设置页「主题色」同一 applier（同时写 --btn-bg/--btn-ink 与键），
            // 顺带让桌面小组件按钮默认跟随主题色（home.css --widget-btn:var(--btn-bg)）。
            try { if (v) localStorage.setItem(ACCENT_KEY, v); else localStorage.removeItem(ACCENT_KEY); } catch (e) {}
            try { applyAccentColor(v || ''); } catch (e) {}
          }));
          grid.appendChild(mkColorItem('组件背景', 'widget-bg-color', '--widget-bg', false));
          grid.appendChild(mkColorItem('边框', 'widget-border-color', '--widget-border', false));
          grid.appendChild(mkColorItem('按钮', 'widget-btn-color', '--widget-btn', false));
          grid.appendChild(mkColorItem('按钮文字', 'widget-btn-text-color', '--widget-btn-text', false));
          grid.appendChild(mkColorItem('爱心外框', 'widget-heart-color', '--widget-heart', false));
          paletteHost = document.createElement('div');
          wrap.appendChild(grid);
          wrap.appendChild(paletteHost);
          // 桌面「文字部位颜色」入口（装修模式点卡片/文字选部位）——原抽屉有此项，
          // #527b 重写紧凑版时保留，不静默丢功能
          const txBtn = document.createElement('button');
          txBtn.textContent = '改桌面文字颜色（进装修模式点文字）';
          txBtn.style.cssText = 'padding:7px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;cursor:pointer';
          txBtn.addEventListener('click', () => { d.style.display = 'none'; try { enterDecor(); } catch (e) {} });
          wrap.appendChild(txBtn);
          wrap.appendChild(mkSlider('透明度', 'widget-opacity', '--widget-opacity', 40, 100, 5, '%', 100, (v) => {
            applyWidgetOpacity(parseInt(v, 10)); // 复用设置页 applier：写 --widget-opacity + 同步标签
          }));
          return wrap;
        } },
        { key: 'size', label: '尺寸', build: () => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
          wrap.appendChild(mkSlider('组件圆角', 'desk-card-radius', '--desk-card-radius', 0, 30, 1, 'px', 20, (v) => {
            applyCardRadius(parseInt(v, 10)); // 复用设置页 applier（写 var + 「默认」文案）
          }, (v) => { const n = parseInt(v, 10); if (n === 20) store.remove('desk-card-radius'); else store.set('desk-card-radius', String(n)); }));
          wrap.appendChild(mkSlider('图标圆角', 'ico-radius', '--app-ico-radius', 0, 30, 1, 'px', 18, (v) => {
            applyIcoRadius(parseInt(v, 10));
          }));
          if (zoomWorks) {
            wrap.appendChild(mkSlider('桌面字号', 'desk-font-size', '--desk-font-scale', 85, 120, 1, '%', 100, (v) => {
              document.documentElement.style.setProperty('--desk-font-scale', String(parseInt(v, 10) / 100));
              syncDeskZoomClass(); // #707：值≠1 才挂缩放类（见 applyDeskFontPct 同编号注释）
            }));
            wrap.appendChild(mkSlider('卡片大小', 'desk-card-scale', '--desk-card-scale', 80, 120, 1, '%', 100, (v) => {
              document.documentElement.style.setProperty('--desk-card-scale', String(parseInt(v, 10) / 100));
              syncDeskZoomClass(); // #707
            }));
          } else {
            const nt = document.createElement('div');
            nt.style.cssText = 'font-size:10.5px;color:var(--muted,#999);line-height:1.5';
            nt.textContent = '桌面字号 / 卡片大小仅电脑端（大屏）生效，手机端为性能保持默认。';
            wrap.appendChild(nt);
          }
          return wrap;
        } },
        { key: 'bg', label: '背景', build: () => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
          wrap.appendChild(mkSlider('背景模糊', 'bg-blur', '--desk-bg-blur', 0, 20, 1, 'px', 0, (v) => {
            applyBgBlur(parseInt(v, 10)); // 写 --desk-bg-blur + toggle .desk-blur-on（旧代码写死变量名 --bg-blur 无人消费＝调了没反应）
          }, (v) => { const n = parseInt(v, 10); if (n > 0) store.set('bg-blur', String(n)); else store.remove('bg-blur'); }));
          wrap.appendChild(mkSlider('背景遮罩', 'bg-mask-op', '--desk-bg-mask-op', 0, 80, 5, '%', 0, (v) => {
            applyBgMaskOp(parseInt(v, 10)); // 写 --desk-bg-mask-op（旧代码写死 --bg-mask-op 无人消费）
          }, (v) => { const n = parseInt(v, 10); if (n > 0) store.set('bg-mask-op', String(n)); else store.remove('bg-mask-op'); }));
          const bgBtn = document.createElement('button');
          bgBtn.textContent = '更换壁纸 / 内置预设 / 上传图片';
          bgBtn.style.cssText = 'padding:8px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;cursor:pointer';
          bgBtn.addEventListener('click', () => {
            d.style.display = 'none'; showThemePage();
            const row = document.getElementById('row-bg-preset');
            if (row) row.click();
          });
          wrap.appendChild(bgBtn);
          return wrap;
        } },
        // FIX 2026-09-16 #581：新增「图标」分区（用户：「【边看边调】功能里缺少批量上传桌面图标按钮」＋
        // 「上传了图标按钮图片后，需要可以只移动按钮里图片的位置，不用重新上传」）。
        // 两个按钮都复用既有链路，不重复实现：批量上传＝点设置页 #row-icon-batch（载入后自动进装修模式）；
        // 调整位置＝进装修模式 + 置 __iconAdjustPick，点哪个图标就调哪个（openIconMenu 认这个标记）。
        { key: 'icon', label: '图标', build: () => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
          const mkAct = (label, fn) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'padding:8px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;cursor:pointer';
            b.addEventListener('click', fn);
            return b;
          };
          // FIX 2026-09-17 #696：补「只换一个图标」的入口（用户原话「边看边调功能不能上传单个
          // 图标的图片」——原来这里只有批量多选和调整位置，想换一个图标得先按批量流程）。
          // 只负责「进装修模式、等用户点图标」，换图仍走装修模式的图标菜单（上传图片→选图），
          // 与批量入口一样不重复实现；进之前清掉位置标记，否则点图标弹的是位置面板。
          wrap.appendChild(mkAct('上传单个图标图片（点图标）', () => {
            d.style.display = 'none';
            try { enterDecor(); } catch (e) {}
            window.__iconAdjustPick = false;
            toast('点桌面上要换图的图标，选「上传图片」');
          }));
          wrap.appendChild(mkAct('批量上传桌面图标图片（可多选）', () => {
            d.style.display = 'none';
            const row = document.getElementById('row-icon-batch');
            if (row) row.click(); else toast('入口暂不可达，请到设置 → 手机桌面美化 → 批量上传图标图片');
          }));
          const fitBtn = mkAct('调整图标图片位置（点图标）', () => {
            d.style.display = 'none';
            try { enterDecor(); } catch (e) {}
            window.__iconAdjustPick = true;
            toast('点桌面上要调整的图标，就能调它的图片位置');
          });
          fitBtn.style.fontWeight = '600';
          wrap.appendChild(fitBtn);
          const note = document.createElement('div');
          note.style.cssText = 'font-size:10.5px;color:var(--muted,#999);line-height:1.5';
          note.textContent = '换单个图标＝点「上传单个图标图片」后点桌面图标选「上传图片」；换一批用批量上传。上传过的图片可单独调「缩放 / 水平位置 / 垂直位置」，即时生效、不用重新上传。';
          wrap.appendChild(note);
          return wrap;
        } },
        // FIX v3.26.x #769：底部导航栏美化分区（用户「底部导航栏的三个图标按钮，也可以上传图标
        // 图片。然后也可以调整透明度。调整这一行的透明度和这一行的样式」）。全部控件走
        // #769 模块同一套键与 applier（tabIconMenu / applyTabbarStyle / resetTabbarBeauty），
        // 与设置页入口零重复实现。
        { key: 'tabbar', label: '底部栏', build: () => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';
          const upRow = document.createElement('div');
          upRow.style.cssText = 'display:flex;gap:6px';
          TABBAR_PAGES.forEach(pk => {
            const b = document.createElement('button');
            b.textContent = TABBAR_PAGE_NAMES[pk] + '按钮图片';
            b.style.cssText = 'flex:1;font-size:11.5px;padding:7px 0;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
            b.addEventListener('click', () => tabIconMenu(pk));
            upRow.appendChild(b);
          });
          wrap.appendChild(upRow);
          const setBarVar = (name, v) => { if (v === null || v === undefined || v === '') document.documentElement.style.removeProperty(name); else document.documentElement.style.setProperty(name, v); };
          wrap.appendChild(mkSlider('图片透明度', 'tab-icon-opacity', '', 20, 100, 5, '%', 100, (v) => {
            // 只作用上传的图片（默认 SVG 不受影响），三按钮同值——applyAppIconOpacity 同口径
            document.querySelectorAll('.tabbar .tab img').forEach(im => { im.style.opacity = String(parseInt(v, 10) / 100); });
          }, (v) => { const n = parseInt(v, 10); if (n >= 100) store.remove('tab-icon-opacity'); else store.set('tab-icon-opacity', String(n)); }));
          wrap.appendChild(mkSlider('背景透明度', 'tabbar-bg-op', '', 0, 100, 5, '%', 100, (v) => {
            // 拖动过程即时预览＝只重算背景叠乘（图标层由「整栏透明度」决定，互不干扰）
            const w = tabbarNum('tabbar-whole-op', 100, 0, 100);
            setBarVar('--tabbar-bg-a', (parseInt(v, 10) * w) >= 10000 ? null : String(Math.round(parseInt(v, 10) * w) / 10000));
          }, (v) => { const n = parseInt(v, 10); if (n >= 100) store.remove('tabbar-bg-op'); else store.set('tabbar-bg-op', String(n)); applyTabbarStyle(); }));
          wrap.appendChild(mkSlider('整栏透明度', 'tabbar-whole-op', '', 0, 100, 5, '%', 100, (v) => {
            const n = parseInt(v, 10);
            const bg = tabbarNum('tabbar-bg-op', 100, 0, 100);
            setBarVar('--tabbar-bg-a', (n * bg) >= 10000 ? null : String(Math.round(n * bg) / 10000));
            setBarVar('--tabbar-ico-a', String(Math.max(n, 12) / 100)); // 12% 图标下限：背景可全透，图标永远留一丝影
            const bar = document.querySelector('.tabbar');
            if (bar) bar.classList.toggle('tabbar-faint', bg < 50 || n < 50);
          }, (v) => { const n = parseInt(v, 10); if (n >= 100) store.remove('tabbar-whole-op'); else store.set('tabbar-whole-op', String(n)); applyTabbarStyle(); }));
          wrap.appendChild(mkSlider('栏圆角', 'tabbar-radius', '--tabbar-radius', 0, 30, 1, 'px', 22, null, (v) => { const n = parseInt(v, 10); if (n === 22) store.remove('tabbar-radius'); else store.set('tabbar-radius', String(n)); }));
          wrap.appendChild(mkSlider('背景模糊', 'tabbar-blur', '', 0, 20, 1, 'px', 0, (v) => {
            const n = parseInt(v, 10);
            setBarVar('--tabbar-blur', n > 0 ? n + 'px' : null);
            const bar = document.querySelector('.tabbar');
            if (bar) bar.classList.toggle('tabbar-blur-on', n > 0);
          }, (v) => { const n = parseInt(v, 10); if (n > 0) store.set('tabbar-blur', String(n)); else store.remove('tabbar-blur'); }));
          wrap.appendChild(mkSlider('图标大小', 'tabbar-icon-size', '--tabbar-ico-size', 18, 34, 1, 'px', 23, null, (v) => { const n = parseInt(v, 10); if (n === 23) store.remove('tabbar-icon-size'); else store.set('tabbar-icon-size', String(n)); }));
          paletteHost = document.createElement('div');
          const cgrid = document.createElement('div');
          cgrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
          cgrid.appendChild(mkColorItem('栏背景色', 'tabbar-bg-color', '--tabbar-bg-color', false));
          wrap.appendChild(cgrid);
          wrap.appendChild(paletteHost);
          const rst = document.createElement('button');
          rst.textContent = '恢复底部栏默认';
          rst.style.cssText = 'padding:8px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:11.5px;cursor:pointer';
          rst.addEventListener('click', () => { armUndo(); resetTabbarBeauty(); renderSec('tabbar'); toast('底部栏已恢复默认'); });
          wrap.appendChild(rst);
          const nt = document.createElement('div');
          nt.style.cssText = 'font-size:10.5px;color:var(--muted,#999);line-height:1.5';
          nt.textContent = '「背景透明度」只稀释底色；「整栏透明度」连图标一起淡出——图标保底 12%、按屏下瞬间显形，不会消失找不回。按钮图片点上面三个按钮上传（已传过可选更换/移除）。';
          wrap.appendChild(nt);
          return wrap;
        } }
      ];
      let activeSec = 'color';
      // v8.29 #1008：点亮态只在真变化时写（口径同 #938：先比对现状与目标，相等就别写）。
      // 原实现每次 renderSec 都无条件写 3×N 个 style——实测重复点同一个分区会白写 24~30 次，
      // 而「没变也在动」正是用户报的闪屏里可去掉的那一半。重建控件区的行为刻意保留：
      // 点当前分区胶囊＝重画本区视图是既有刷新链路（verify-badge-tune D3 依赖它）。
      const paintChips = (key) => {
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
        activeSec = key;
        paintChips(key);
        body.innerHTML = '';
        paletteHost = null;
        colorItems = [];
        const sec = SECS.filter(s => s.key === key)[0];
        if (sec) body.appendChild(sec.build());
      };
      SECS.forEach(s => {
        const c = document.createElement('button');
        c.textContent = s.label;
        c.dataset.sec = s.key;
        c.style.cssText = 'flex:1;font-size:11.5px;padding:5px 0;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);cursor:pointer';
        c.addEventListener('click', () => renderSec(s.key));
        chipsRow.appendChild(c);
      });
      renderSec(activeSec);
      if (secKey) renderSec(secKey);
      // v8.29 #1008：先落位再显形——自动位＝停在底部导航之上（见 beautyDrawerReserve），
      // 这样开着抽屉也能点到底部导航去别的页面看现场。
      beautyDrawerApplyBottom();
      d.style.display = 'flex';
      // 切页落定后（底部导航由 syncChrome 补显）再量一次自动位；rAF 兜首帧（观察器回调是
      // 微任务、rAF 在绘制前跑，正常首次绘制就已是正确位置，不会看到一次跳动）。
      watchBeautyDockPages();
      if (window.requestAnimationFrame) requestAnimationFrame(() => { if (beautyDockBot == null) beautyDrawerApplyBottom(); });
  };
  // v8.29 #1008：兜住「开着抽屉时转屏/改窗口尺寸」——自动位按当前底部导航高度重算；
  // 用户拖过的位置（beautyDockBot != null）不动。
  try {
    window.addEventListener('resize', () => { if (beautyDockBot == null) beautyDrawerApplyBottom(); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (beautyDockBot == null) beautyDrawerApplyBottom(); });
  } catch (e) {}
  // 回到「手机桌面美化」页（抽屉关闭/跳转用）。
  // 导航口径对齐 tabs.js 的 #row-appearance 处理：隐藏所有页 → 只显示 #page-theme，
  // 底部 tab 停在「设置」（page-theme 是 setting 的二级页，不单独占 tab）。
  const showThemePage = () => {
    try {
      document.querySelectorAll('.page').forEach(pg => pg.hidden = true);
      const pg = document.getElementById('page-theme');
      if (pg) pg.hidden = false;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      const setTab = document.querySelector('.tab[data-page="page-setting"]');
      if (setTab) setTab.classList.add('active');
    } catch (e) {}
  };
  const dqDrawer = document.getElementById('dq-drawer');
  if (dqDrawer) dqDrawer.addEventListener('click', openBeautyDrawer);
  // v3.27.x：长按桌面空白处进装修模式（项5）——长按 .app-grid 空白（非图标），500ms 触发
  // 仅长按空白区域，避开图标长按误触（原长按图标入口已移除，此处恢复便利性且不冲突）
  (function bindLongPressDecor() {
    let timer = null;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    grids.forEach(g => {
      const start = (e) => {
        const phone = document.getElementById('page-phone');
        if (!phone || phone.hidden) return;
        if (e.target.closest('.app')) return;
        clear();
        timer = setTimeout(() => { timer = null; try { enterDecor(); } catch (er) {} }, 500);
      };
      g.addEventListener('touchstart', start, { passive: true });
      g.addEventListener('mousedown', start);
      g.addEventListener('touchend', clear);
      g.addEventListener('touchmove', clear, { passive: true });
      g.addEventListener('mouseup', clear);
      g.addEventListener('mouseleave', clear);
    });
  })();
  // v3.27.x：美化项搜索（F）——输入过滤 .set-row，跨标签显示匹配项
  (function bindThemeSearch() {
    const inp = document.getElementById('theme-search-input');
    const page = document.getElementById('page-theme');
    if (!inp || !page) return;
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      const secs = page.querySelectorAll('.them-sec');
      const rows = page.querySelectorAll('.set-row');
      if (!q) {
        rows.forEach(r => r.style.display = '');
        const activeTab = page.querySelector('.them-tab.active');
        if (activeTab) activeTab.click();
        return;
      }
      secs.forEach(sec => sec.hidden = false);
      rows.forEach(r => {
        const txtEl = r.querySelector('.txt');
        const txt = (txtEl ? txtEl.textContent : '').toLowerCase();
        r.style.display = txt.indexOf(q) >= 0 ? '' : 'none';
      });
    });
  })();
  // #542：设置页搜索（与上方美化项搜索同款）——设置项上百行，输入即跨 5 个 tag（通用/聊天/系统/工具/关于）
  // 过滤 .set-row 显示匹配项；清空后复位所有行并重放当前 tag（恢复原分区视图）
  (function bindSettingsSearch() {
    const inp = document.getElementById('set-search-input');
    const page = document.getElementById('page-setting');
    if (!inp || !page) return;
    // #549：搜索无条件带一个「在功能大全中搜索『X』」入口——设置行只是子集，功能大全才是全量索引；
    // 点了走 feature-hub.js 暴露的 window.mochiFeatureHubOpen（带入关键词，返回仍回设置页）。
    const jump = document.createElement('div');
    jump.hidden = true;
    jump.style.cssText = 'padding:7px 12px 0';
    const jumpBtn = document.createElement('div');
    jumpBtn.style.cssText = 'display:inline-block;padding:7px 12px;border-radius:9px;background:rgba(47,111,208,.12);color:#2f6fd0;font-size:13px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent';
    jump.appendChild(jumpBtn);
    if (inp.parentNode) inp.parentNode.insertBefore(jump, inp.nextSibling);
    jumpBtn.addEventListener('click', () => {
      const kw = inp.value.trim();
      if (!kw) return;
      if (typeof window.mochiFeatureHubOpen === 'function') window.mochiFeatureHubOpen(kw);
    });
    // FIX 2026-09-16 #550 设置搜索精准化（用户报「不能精准搜索」）：
    // ① 取词剔除 settings-help.js 注入的「功能说明」.tag 胶囊（此前搜「功能/说明」几乎全行命中）；
    // ② 口语词→入口行别名表（此前搜「壁纸/通知/概率/夜间」等 0 命中）；
    // ③ 多词 AND（空格分隔，每词都须命中）；④ 空分组/空分区隐藏 + 零命中空态提示。
    const SEC_NAME = { basic: '通用', chat: '聊天', system: '系统', tools: '工具', diag: '信息诊断', about: '关于' };
    const KW = {
      '联系人 / 桌面': '切换桌面 多桌面 独立 称呼',
      '开启群聊': '多人聊天 群',
      '跨桌面查岗': '定位 位置 远程',
      '查岗频率': '次数',
      '打电话': '拨打 通话',
      '深色模式': '夜间模式 暗色模式 黑暗模式 夜间 暗色 黑暗 黑色 主题 dark mode',
      '手机桌面美化': '壁纸 主题 图标 字体 字号 圆角 装修 装扮 小组件 桌面美化 底部栏 底栏 导航栏 tabbar',
      '回复设置': '概率 回复速度 拍一拍 撤回 已读 触发 自动回复 聊天',
      '通话设置': '来电 挂断 通话背景 铃声',
      '音效设置': '声音 铃声 提示音 静音',
      '功能大全': '索引 直达 查找',
      '应用锁': '密码 锁 隐私',
      '开屏问答门': '问答 暗号 验证 提问',
      '手机布局': '布局 适配 模式',
      '离线消息提醒': '通知 推送 通知提醒 新消息 安卓 电脑 主屏幕 iPhone Chrome Edge',
      '使用说明': '教程 帮助 常见问题 安装',
      '导出数据': '备份 保存 导出',
      '导入数据': '恢复 还原 迁移 换机',
      '修改摸鱼天数': '恢复 找回 补回 归零 重来 已摸鱼',
      '设备兼容诊断': '诊断 兼容 报错 环境',
      '顶部避让修正': '安全区 白带 重叠 刘海 添加到主屏幕 独立应用 电脑',
      '屏幕适配诊断': '适配 屏幕 空白 裁切',
      '屏幕适配微调': '微调 字号 文字大小 放大 变小 偏移 遮挡 裁切 留白 白带 状态栏 手势条 屏幕错位 位置',
      '功能诊断': '检测 测试',
      '查看存储': '空间 清理 占用',
      '压缩图片': '图片 瘦身',
      '卡顿自检': '卡顿 优化 流畅',
      '字卡使用状态自检': '字卡 自检 可用',
      '清除本地数据': '清空 重置 删除',
      '新手引导': '教程 上手 入门',
      '功能介绍': '介绍 许可 版权 二传'
    };
    // FIX 2026-09-16 #573 拼音首字母轻量表（仅设置入口行，不引拼音库＝产物零增重）：
    // 搜「ssms」＝深色模式、「hfsz」＝回复设置。单字母前缀会泛命中属预期，用户自然补足。
    const PY = {
      '联系人 / 桌面': 'lxrzm', '开启群聊': 'kqql', '跨桌面查岗': 'kzmcg', '查岗频率': 'cgpl', '打电话': 'dh',
      '深色模式': 'ssms', '手机桌面美化': 'sjzmmh', '回复设置': 'hfsz', '通话设置': 'thsz', '音效设置': 'yxsz',
      '功能大全': 'gndq', '应用锁': 'yys', '开屏问答门': 'kpwdm', '手机布局': 'sjbj', '离线消息提醒': 'lxxtx',
      '使用说明': 'sysm', '导出数据': 'dcsj', '导入数据': 'drsj', '修改摸鱼天数': 'xgmyts', '设备兼容诊断': 'sbjrzd', '顶部避让修正': 'dbbrxz',
      '屏幕适配诊断': 'pmspzd', '屏幕适配微调': 'pmspwt', '功能诊断': 'gnzd', '查看存储': 'ckcc', '压缩图片': 'ystp', '卡顿自检': 'kdzj',
      '字卡使用状态自检': 'zksyztzj', '清除本地数据': 'qcbdsj', '新手引导': 'xsyd', '功能介绍': 'gnjs'
    };
    // 行搜索素材 = 标题 + .sub 说明 + 分区名 + settings-help 说明文案（#573）+ 命中 key 的别名/拼音；
    // 标题取词剔除 .tag 胶囊（①）
    const rowHay = (r) => {
      const t = r.querySelector('.txt');
      if (!t) return '';
      const c = t.cloneNode(true);
      c.querySelectorAll('.tag').forEach(x => x.remove());
      const base = c.textContent.replace(/\s+/g, ' ').trim();
      const sec = r.closest('.them-sec');
      let extra = ' ' + (SEC_NAME[sec && sec.dataset.sec] || '');
      // #573：按行上「功能说明」胶囊的 data-setdesc 反查说明文案，说明里的词（壁纸/备份/总入口…）自动可搜
      const tagEl = t.querySelector('[data-setdesc]');
      const help = (tagEl && window.__settingsHelpDesc) ? window.__settingsHelpDesc[tagEl.getAttribute('data-setdesc')] : null;
      if (help) extra += ' ' + (help.name || '') + ' ' + (help.d || '');
      for (const k in KW) { if (base.indexOf(k) >= 0) { extra += ' ' + KW[k]; if (PY[k]) extra += ' ' + PY[k]; } }
      return (base + extra).toLowerCase();
    };
    const emptyTip = document.createElement('div');
    emptyTip.id = 'set-search-empty-tip';
    emptyTip.hidden = true;
    emptyTip.style.cssText = 'padding:14px 12px 4px;text-align:center;font-size:13px;color:var(--muted,#888)';
    emptyTip.textContent = '没有匹配的设置项，可换个词试试，或用上方按钮去「功能大全」搜索';
    if (jump.parentNode) jump.parentNode.insertBefore(emptyTip, jump.nextSibling);
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      const secs = page.querySelectorAll('.them-sec');
      const rows = page.querySelectorAll('.set-row');
      if (!q) {
        jump.hidden = true;
        rows.forEach(r => r.style.display = '');
        page.querySelectorAll('.set-group').forEach(g => g.style.display = '');
        emptyTip.hidden = true;
        const activeTab = page.querySelector('.them-tab.active');
        if (activeTab) activeTab.click();
        return;
      }
      jump.hidden = false;
      jumpBtn.textContent = '在「功能大全」中搜索“' + inp.value.trim() + '” →';
      // ③ 多词 AND：空格分隔的每个词都须出现在行素材里
      const terms = q.split(/\s+/);
      let hits = 0;
      rows.forEach(r => {
        const hay = rowHay(r);
        const ok = terms.every(w => hay.indexOf(w) >= 0);
        r.style.display = ok ? '' : 'none';
        if (ok) hits++;
      });
      // ④ 命中稀疏时不留空分组/空分区，零命中给空态提示
      secs.forEach(sec => {
        sec.querySelectorAll('.set-group').forEach(g => {
          const rs = g.querySelectorAll('.set-row');
          const any = Array.prototype.some.call(rs, x => x.style.display !== 'none');
          g.style.display = (rs.length > 0 && !any) ? 'none' : '';
        });
        sec.hidden = !Array.prototype.some.call(sec.querySelectorAll('.set-row'), x => x.style.display !== 'none');
      });
      emptyTip.hidden = hits > 0;
    });
  })();
  // v3.6.x：装修模式设置卡片背景入口的绑定在 CARD_BG_TYPES 定义之后（见卡片背景段末尾）——
  // 该入口引用了 CARD_BG_TYPES 统计已设置数量，需等其声明后再绑定。

  // FIX 2026-09-15 #527（美化页可读性）：颜色行统一「显示当前值 + 独立色块」。
  // 原实现非默认值时写入空字符串 → 用户选完颜色，行右侧一片空白，既看不出是否生效、
  // 也看不出当前是什么色（用户报「看不懂美化设置」的最大来源）。现统一：默认值显示默认
  // 文案，非默认显示大写色值 + 一个色块；色块保证「取色器被机型渲染成透明/文本框」时
  // 用户仍能看到当前颜色。
  function paintBeautyVal(el, color, defaultColor, defaultLabel) {
    if (!el) return;
    const isDefault = !color || color === defaultColor;
    el.textContent = isDefault ? (defaultLabel || '默认') : String(color).toUpperCase();
    const row = el.closest ? el.closest('.set-row') : null;
    if (!row) return;
    let chip = row.querySelector('.bfy-val-chip');
    if (isDefault) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'bfy-val-chip';
      chip.style.cssText = 'width:14px;height:14px;border-radius:4px;border:1px solid var(--card-border,#ddd);flex:none;margin-right:6px;display:inline-block;vertical-align:middle';
      el.parentNode.insertBefore(chip, el);
    }
    chip.style.background = color;
  }

  // 小组件颜色：点击色板选择，CSS 变量 --widget-bg 实时生效
  const widgetColorRow = document.getElementById('row-widget-color');
  const widgetColorVal = document.getElementById('widget-color-val');
  const applyWidgetColor = (color) => {
    document.documentElement.style.setProperty('--widget-bg', color);
    paintBeautyVal(widgetColorVal, color, '#ffffff', '默认白');
  };
  const savedWidgetColor = store.get('widget-bg-color');
  if (savedWidgetColor) applyWidgetColor(savedWidgetColor);
  if (widgetColorRow) {
    const syncWidgetColorUI = () => {
      const c = store.get('widget-bg-color') || '#ffffff';
      paintBeautyVal(widgetColorVal, c, '#ffffff', '默认白');
    };
    syncWidgetColorUI();
    widgetColorRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = store.get('widget-bg-color') || '#ffffff';
      // v3.6.x：20 色板（覆盖黑白灰 + 8 个常用色相浅色 + 8 个深/中色）——告别"阉割版"
      const swatchList = [
        { color: '#ffffff', label: '默认白' },
        { color: '#f5f0eb', label: '暖米白' },
        { color: '#fff0f0', label: '樱花粉' },
        { color: '#f0f4ff', label: '雾霭蓝' },
        { color: '#f0fff0', label: '薄荷绿' },
        { color: '#fff5e6', label: '奶油黄' },
        { color: '#f5e6ff', label: '淡紫' },
        { color: '#fff0e0', label: '暖橘' },
        { color: '#e6f7f5', label: '薄青' },
        { color: '#fff8dc', label: '米黄' },
        { color: '#fce4ec', label: '粉桃' },
        { color: '#e8eaf6', label: '淡靛' },
        { color: '#f1f8e9', label: '嫩绿' },
        { color: '#fafafa', label: '银灰' },
        { color: '#f0f0f0', label: '浅灰' },
        { color: '#d4d4d4', label: '中灰' },
        { color: '#111111', label: '深黑' },
        { color: '#e8b4b8', label: '玫瑰' },
        { color: '#b8d4e8', label: '天蓝' },
        { color: '#c8e6c9', label: '森绿' },
      ];
      window.openModal('小组件颜色', '', (v) => {
        // v 可能是色板下标（number）或自定义色值（#hex 字符串）
        const color = (typeof v === 'number' && swatchList[v]) ? swatchList[v].color : v;
        if (!color) return;
        if (color === '__reset__') {
          store.remove('widget-bg-color');
          applyWidgetColor('#ffffff');
          syncWidgetColorUI();
          return;
        }
        store.set('widget-bg-color', color);
        applyWidgetColor(color);
        syncWidgetColorUI();
      }, {
        colorPicker: true,
        noInput: true,
        color: current,
        swatches: swatchList,
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // 小组件边框颜色：CSS 变量 --widget-border 实时生效
  const widgetBorderRow = document.getElementById('row-widget-border');
  const widgetBorderVal = document.getElementById('widget-border-val');
  const applyWidgetBorder = (color) => {
    document.documentElement.style.setProperty('--widget-border', color);
    paintBeautyVal(widgetBorderVal, color, 'rgba(0,0,0,.1)', '默认');
  };
  const savedWidgetBorder = store.get('widget-border-color');
  if (savedWidgetBorder) applyWidgetBorder(savedWidgetBorder);
  if (widgetBorderRow) {
    const syncWidgetBorderUI = () => {
      const c = store.get('widget-border-color') || 'rgba(0,0,0,.1)';
      paintBeautyVal(widgetBorderVal, c, 'rgba(0,0,0,.1)', '默认');
    };
    syncWidgetBorderUI();
    const borderSwatches = [
      { color: 'rgba(0,0,0,.1)', label: '默认' },
      { color: 'rgba(0,0,0,.15)', label: '浅灰' },
      { color: 'rgba(0,0,0,.25)', label: '中灰' },
      { color: 'rgba(0,0,0,.4)', label: '深灰' },
      { color: '#111111', label: '纯黑' },
      { color: '#ffffff', label: '纯白' },
      { color: '#e05555', label: '樱花粉' },
      { color: '#5555cc', label: '雾霭蓝' },
      { color: '#55aa55', label: '薄荷绿' },
      { color: '#d4a017', label: '暖橘黄' },
      { color: '#cc55cc', label: '淡紫' },
      { color: '#cc6622', label: '暖橘' },
      { color: '#e8b4b8', label: '玫瑰' },
      { color: '#b8d4e8', label: '天蓝' },
      { color: '#c8e6c9', label: '森绿' },
      { color: '#ffd54f', label: '明黄' },
    ];
    widgetBorderRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = store.get('widget-border-color') || 'rgba(0,0,0,.1)';
      window.openModal('小组件边框颜色', '', (v) => {
        // 色板点击传下标（number），自定义取色传 #hex 字符串，pill 传 value
        const color = (typeof v === 'number' && borderSwatches[v]) ? borderSwatches[v].color : v;
        if (!color) return;
        if (color === '__reset__') {
          store.remove('widget-border-color');
          applyWidgetBorder('rgba(0,0,0,.1)');
          syncWidgetBorderUI();
          return;
        }
        store.set('widget-border-color', color);
        applyWidgetBorder(color);
        syncWidgetBorderUI();
      }, {
        colorPicker: true,
        noInput: true,
        color: current,
        swatches: borderSwatches,
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // 按钮颜色：CSS 变量 --widget-btn 实时生效
  const widgetBtnRow = document.getElementById('row-widget-btn');
  const widgetBtnVal = document.getElementById('widget-btn-val');
  const applyWidgetBtn = (color) => {
    document.documentElement.style.setProperty('--widget-btn', color);
    paintBeautyVal(widgetBtnVal, color, '#111111', '跟随主题色');
  };
  const savedWidgetBtn = store.get('widget-btn-color');
  if (savedWidgetBtn) applyWidgetBtn(savedWidgetBtn);
  if (widgetBtnRow) {
    const syncWidgetBtnUI = () => {
      const c = store.get('widget-btn-color') || '#111111';
      paintBeautyVal(widgetBtnVal, c, '#111111', '跟随主题色');
    };
    syncWidgetBtnUI();
    const btnSwatches = [
      { color: '#111111', label: '默认黑' },
      { color: '#222222', label: '深灰' },
      { color: '#444444', label: '中深' },
      { color: '#666666', label: '中灰' },
      { color: '#888888', label: '灰' },
      { color: '#aaaaaa', label: '浅灰' },
      { color: '#ffffff', label: '白' },
      { color: '#e05555', label: '樱花粉' },
      { color: '#5555cc', label: '雾霭蓝' },
      { color: '#55aa55', label: '薄荷绿' },
      { color: '#d4a017', label: '暖橘黄' },
      { color: '#cc55cc', label: '淡紫' },
      { color: '#cc6622', label: '暖橘' },
      { color: '#e8b4b8', label: '玫瑰' },
      { color: '#b8d4e8', label: '天蓝' },
      { color: '#c8e6c9', label: '森绿' },
    ];
    widgetBtnRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = store.get('widget-btn-color') || '#111111';
      window.openModal('按钮颜色', '', (v) => {
        // 色板点击传下标（number），自定义取色传 #hex 字符串，pill 传 value
        const color = (typeof v === 'number' && btnSwatches[v]) ? btnSwatches[v].color : v;
        if (!color) return;
        if (color === '__reset__') {
          store.remove('widget-btn-color');
          // FIX 2026-09-16 #562：恢复默认＝摘掉内联变量、回落到 :root 的 var(--btn-bg)（跟随主题色）；
          // 原来写死 applyWidgetBtn('#111111')＝内联变量把主题色链截断，恢复默认后再点主题色按钮不跟随。
          document.documentElement.style.removeProperty('--widget-btn');
          syncWidgetBtnUI();
          return;
        }
        store.set('widget-btn-color', color);
        applyWidgetBtn(color);
        syncWidgetBtnUI();
      }, {
        colorPicker: true,
        noInput: true,
        color: current,
        swatches: btnSwatches,
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // 按钮文字颜色：CSS 变量 --widget-btn-text 实时生效（打卡按钮/周末倒计时按钮等）
  const widgetBtnTextRow = document.getElementById('row-widget-btn-text');
  const widgetBtnTextVal = document.getElementById('widget-btn-text-val');
  const applyWidgetBtnText = (color) => {
    document.documentElement.style.setProperty('--widget-btn-text', color);
    paintBeautyVal(widgetBtnTextVal, color, '#ffffff', '跟随主题色');
  };
  const savedWidgetBtnText = store.get('widget-btn-text-color');
  if (savedWidgetBtnText) applyWidgetBtnText(savedWidgetBtnText);
  if (widgetBtnTextRow) {
    const syncWidgetBtnTextUI = () => {
      const c = store.get('widget-btn-text-color') || '#ffffff';
      paintBeautyVal(widgetBtnTextVal, c, '#ffffff', '跟随主题色');
    };
    syncWidgetBtnTextUI();
    const btnTextSwatches = [
      { color: '#ffffff', label: '默认白' },
      { color: '#f2f2f2', label: '亮白' },
      { color: '#dddddd', label: '浅灰' },
      { color: '#bbbbbb', label: '中浅灰' },
      { color: '#999999', label: '中灰' },
      { color: '#777777', label: '深灰' },
      { color: '#555555', label: '更深灰' },
      { color: '#111111', label: '纯黑' },
      { color: '#e05555', label: '樱花粉' },
      { color: '#5555cc', label: '雾霭蓝' },
      { color: '#2e8b57', label: '薄荷绿' },
      { color: '#d4a017', label: '暖橘黄' },
      { color: '#cc55cc', label: '淡紫' },
      { color: '#cc6622', label: '暖橘' },
      { color: '#e8b4b8', label: '玫瑰' },
      { color: '#b8d4e8', label: '天蓝' },
    ];
    widgetBtnTextRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = store.get('widget-btn-text-color') || '#ffffff';
      window.openModal('按钮文字颜色', '', (v) => {
        // 色板点击传下标（number），自定义取色传 #hex 字符串，pill 传 value
        const color = (typeof v === 'number' && btnTextSwatches[v]) ? btnTextSwatches[v].color : v;
        if (!color) return;
        if (color === '__reset__') {
          store.remove('widget-btn-text-color');
          // FIX 2026-09-16 #562：同按钮颜色——摘内联变量回落到 var(--btn-ink)，跟随主题色文字色
          document.documentElement.style.removeProperty('--widget-btn-text');
          syncWidgetBtnTextUI();
          return;
        }
        store.set('widget-btn-text-color', color);
        applyWidgetBtnText(color);
        syncWidgetBtnTextUI();
      }, {
        colorPicker: true,
        noInput: true,
        color: current,
        swatches: btnTextSwatches,
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // 图标文字颜色：注入 style 覆盖 .app .app-name 的 color（home.css 默认 var(--ink)）
  // per-cid store，键 app-name-color；恢复默认移除 style 回到 var(--ink) 跟随主题/深色模式
  const appNameColorRow = document.getElementById('row-app-name-color');
  const appNameColorVal = document.getElementById('app-name-color-val');
  const APP_NAME_COLOR_KEY = 'app-name-color';
  const appNameColorValOf = () => { try { return store.get(APP_NAME_COLOR_KEY) || ''; } catch (e) { return ''; } };
  function applyAppNameColor() {
    const old = document.getElementById('app-name-color-style');
    if (old) old.remove();
    const c = appNameColorValOf();
    if (appNameColorVal) appNameColorVal.textContent = c === 'auto' ? '自动' : (c ? c.toUpperCase() : '默认');
    document.documentElement.style.setProperty('--app-name-color', c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '');
    if (!c) return;
    const st = document.createElement('style');
    st.id = 'app-name-color-style';
    if (c === 'auto') {
      // v3.27.x：自动档——纯 CSS 跟随深色模式（light 黑 / dark 白），零 JS 重算
      st.textContent = '.app .app-name{color:#111111 !important;}[data-theme="dark"] .app .app-name{color:#ffffff !important;}';
    } else if (/^#[0-9a-fA-F]{6}$/.test(c)) {
      st.textContent = '.app .app-name{color:' + c + ' !important;}';
    } else return;
    document.head.appendChild(st);
  }
  applyAppNameColor();
  if (appNameColorRow) {
    const appNameSwatches = [
      { color: '#111111', label: '默认黑' },
      { color: '#333333', label: '深灰' },
      { color: '#555555', label: '中灰' },
      { color: '#777777', label: '浅中灰' },
      { color: '#999999', label: '中浅灰' },
      { color: '#bbbbbb', label: '浅灰' },
      { color: '#ffffff', label: '纯白' },
      { color: '#e05555', label: '樱花粉' },
      { color: '#cc5555', label: '珊瑚红' },
      { color: '#e8753a', label: '暖橘' },
      { color: '#f0a020', label: '琥珀金' },
      { color: '#2e8b57', label: '薄荷绿' },
      { color: '#4a9d5e', label: '森绿' },
      { color: '#3a7bd5', label: '天蓝' },
      { color: '#7b5fd6', label: '紫罗兰' },
      { color: '#d6459d', label: '玫红' },
    ];
    appNameColorRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = appNameColorValOf();
      window.openModal('图标文字颜色', '', (v) => {
        if (v === '__reset__') { store.remove(APP_NAME_COLOR_KEY); applyAppNameColor(); return; }
        if (v === 'auto') { store.set(APP_NAME_COLOR_KEY, 'auto'); applyAppNameColor(); return; }
        const color = (typeof v === 'number' && appNameSwatches[v]) ? appNameSwatches[v].color : v;
        if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
        store.set(APP_NAME_COLOR_KEY, color);
        applyAppNameColor();
      }, {
        colorPicker: true,
        noInput: true,
        color: current,
        swatches: appNameSwatches,
        pills: [{ label: '自动跟随深色', value: 'auto' }, { label: '恢复默认', value: '__reset__' }],
      });
    });
  }
  document.addEventListener('contact-switched', applyAppNameColor);

  // 颜色分区预览面板样式（一次性注入；各部位用 CSS 变量着色，用户改色时变量实时变 → 预览自动更新，零额外 JS 开销）
  if (!document.getElementById('desk-cp-style')) {
    const cpStyle = document.createElement('style');
    cpStyle.id = 'desk-cp-style';
    cpStyle.textContent = '.desk-cp{margin:0 0 14px;padding:12px;border-radius:14px;background:var(--card-bg);border:1px solid var(--card-border);}' +
      '.desk-cp-phone{display:flex;flex-direction:column;gap:10px;padding:10px;border-radius:12px;background:linear-gradient(180deg,var(--phone-bg-a),var(--phone-bg-b));}' +
      '.desk-cp-apps{display:flex;gap:18px;justify-content:center;}' +
      '.desk-cp-app{display:flex;flex-direction:column;align-items:center;gap:4px;}' +
      '.desk-cp-ico{width:30px;height:30px;border-radius:9px;background:var(--ink);opacity:.85;}' +
      '.desk-cp-name{font-size:10px;color:var(--app-name-color,var(--ink));letter-spacing:.5px;}' +
      '.desk-cp-card{padding:8px 10px;border-radius:10px;background:var(--widget-bg,var(--card-bg));border:1.5px solid var(--widget-border,var(--card-border));opacity:var(--widget-opacity,1);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.desk-cp-card-title{font-size:11px;color:var(--ink);font-weight:600;}' +
      '.desk-cp-btn{padding:4px 10px;border-radius:8px;border:none;background:var(--widget-btn,var(--btn-bg));color:var(--widget-btn-text,var(--btn-ink));font-size:10px;font-weight:600;}' +
      '.desk-cp-heart{color:var(--widget-heart,#e05555);font-size:15px;line-height:1;}' +
      '.desk-cp-theme{padding:4px 12px;border-radius:8px;border:none;background:var(--btn-bg);color:var(--btn-ink);font-size:10px;font-weight:600;align-self:flex-start;cursor:default;}' +
      '.desk-cp-legend{margin-top:10px;font-size:10.5px;color:var(--muted);line-height:1.6;}' +
      '.desk-cp-legend b{color:var(--ink);font-weight:600;}';
    document.head.appendChild(cpStyle);
  }

  // 爱心外框颜色：CSS 变量 --widget-heart 实时生效（打卡横幅「和 TA 一起摸鱼」的爱心圆底）
  const widgetHeartRow = document.getElementById('row-widget-heart');
  const widgetHeartVal = document.getElementById('widget-heart-val');
  const applyWidgetHeart = (color) => {
    document.documentElement.style.setProperty('--widget-heart', color);
    paintBeautyVal(widgetHeartVal, color, '#111111', '默认黑');
  };
  const savedWidgetHeart = store.get('widget-heart-color');
  if (savedWidgetHeart) applyWidgetHeart(savedWidgetHeart);
  if (widgetHeartRow) {
    const syncWidgetHeartUI = () => {
      const c = store.get('widget-heart-color') || '#111111';
      paintBeautyVal(widgetHeartVal, c, '#111111', '默认黑');
    };
    syncWidgetHeartUI();
    const heartSwatches = [
      { color: '#111111', label: '默认黑' },
      { color: '#222222', label: '深灰' },
      { color: '#444444', label: '中深' },
      { color: '#666666', label: '中灰' },
      { color: '#888888', label: '灰' },
      { color: '#aaaaaa', label: '浅灰' },
      { color: '#e05555', label: '樱花粉' },
      { color: '#5555cc', label: '雾霭蓝' },
      { color: '#2e8b57', label: '薄荷绿' },
      { color: '#d4a017', label: '暖橘黄' },
      { color: '#cc55cc', label: '淡紫' },
      { color: '#cc6622', label: '暖橘' },
      { color: '#e8b4b8', label: '玫瑰' },
      { color: '#b8d4e8', label: '天蓝' },
      { color: '#c8e6c9', label: '森绿' },
      { color: '#ffd54f', label: '明黄' },
    ];
    widgetHeartRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = store.get('widget-heart-color') || '#111111';
      window.openModal('爱心外框颜色', '', (v) => {
        const color = (typeof v === 'number' && heartSwatches[v]) ? heartSwatches[v].color : v;
        if (!color) return;
        if (color === '__reset__') {
          store.remove('widget-heart-color');
          applyWidgetHeart('#111111');
          syncWidgetHeartUI();
          return;
        }
        store.set('widget-heart-color', color);
        applyWidgetHeart(color);
        syncWidgetHeartUI();
      }, {
        colorPicker: true,
        noInput: true,
        color: current,
        swatches: heartSwatches,
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // 小组件透明度：CSS 变量 --widget-opacity（0~1），输入 0~100 百分比
  // #146 修复：widget-opacity 历史上被「随机美化」写成小数（如 "0.9"/"1"），而读取点用 parseInt 按百分比解析
  // → parseInt("0.9")=0 → 小组件全透明。统一 opacityRawToPct：≤1 的数值按比例 ×100 换算，≥2 视为已是百分比。
  const opacityRawToPct = (raw) => { const f = parseFloat(raw); if (isNaN(f)) return NaN; if (f <= 1) return Math.round(f * 100); return Math.round(f); };
  const widgetOpacityRow = document.getElementById('row-widget-opacity');
  const widgetOpacityVal = document.getElementById('widget-opacity-val');
  const applyWidgetOpacity = (pct) => {
    const op = Math.max(0, Math.min(100, pct)) / 100;
    document.documentElement.style.setProperty('--widget-opacity', String(op));
    if (widgetOpacityVal) widgetOpacityVal.textContent = (pct === 100 ? '不透明' : pct + '%');
  };
  const savedWidgetOpacity = store.get('widget-opacity');
  if (savedWidgetOpacity) {
    const opPct0 = opacityRawToPct(savedWidgetOpacity);
    if (!isNaN(opPct0)) {
      try { if (String(opPct0) !== String(savedWidgetOpacity)) store.set('widget-opacity', String(opPct0)); } catch (e) {} // #146：历史小数脏值改写为百分比存储
      applyWidgetOpacity(opPct0);
    }
  }
  if (widgetOpacityRow) {
    const syncWidgetOpacityUI = () => {
      const v = store.get('widget-opacity');
      if (widgetOpacityVal) widgetOpacityVal.textContent = (!v || v === '100') ? '不透明' : v + '%';
    };
    syncWidgetOpacityUI();
    widgetOpacityRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = store.get('widget-opacity') || '100';
      window.openModal('小组件透明度（0-100）', current, (v) => {
        const pct = parseInt(v, 10);
        if (isNaN(pct) || pct < 0 || pct > 100) { toast('请输入 0-100 的数字'); return; }
        if (pct === 100) store.remove('widget-opacity');
        else store.set('widget-opacity', String(pct));
        applyWidgetOpacity(pct);
        syncWidgetOpacityUI();
      }, {
        maxlength: 3,
        pills: [
          { label: '100%', value: '100' },
          { label: '80%', value: '80' },
          { label: '60%', value: '60' },
          { label: '40%', value: '40' },
          { label: '20%', value: '20' },
        ],
      });
    });
  }

  // v3.7.x：背景模糊——slider 0~20px，CSS 变量 --desk-bg-blur。
  // v3.7.x 修复：blur(0px) 也会保持 backdrop-filter 激活（iOS 全屏每帧栅格化卡顿源），
  // 模糊为 0 时去掉 .desk-blur-on（filter 属性整个移除），>0 才启用
  const bgBlurRow = document.getElementById('row-bg-blur');
  const bgBlurVal = document.getElementById('bg-blur-val');
  const getBgBlur = () => { const v = store.get('bg-blur'); if (v) { const n = parseInt(v, 10); if (!isNaN(n)) return Math.max(0, Math.min(20, n)); } return 0; };
  const setBgBlurClass = (px) => {
    // FIX 2026-09-07 #240：模糊改画在壁纸常驻图层自身（.desk-blur-on 挂 .phone，
    // 见 home.css 同日注）——原 .phone-bg-mask.blur-on 的 backdrop-filter 在
    // 小米15Pro/Chrome 151 真机上采样不生效（#219 提层后仍无感），不再挂。
    const ph = document.querySelector('.phone');
    if (ph) ph.classList.toggle('desk-blur-on', px > 0);
  };
  const applyBgBlur = (px) => {
    document.documentElement.style.setProperty('--desk-bg-blur', px + 'px');
    setBgBlurClass(px);
    if (bgBlurVal) bgBlurVal.textContent = px === 0 ? '关闭' : px + 'px';
  };
  applyBgBlur(getBgBlur());
  if (bgBlurRow) {
    bgBlurRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = getBgBlur();
      window.openModal('背景模糊', '', (v) => {
        if (v === '__reset__') { store.remove('bg-blur'); applyBgBlur(0); return; }
        const px = parseInt(v, 10); if (isNaN(px)) return;
        if (px === 0) store.remove('bg-blur'); else store.set('bg-blur', String(px));
        applyBgBlur(px);
      }, {
        noInput: true,
        slider: { min: 0, max: 20, step: 1, value: current, label: '拖动调整背景模糊', unit: 'px',
          onChange: (val) => { applyBgBlur(val); } },
        pills: [{ label: '关闭', value: '__reset__' }],
      });
    });
  }

  // v3.7.x：背景遮罩——slider 0~80%，CSS 变量 --desk-bg-mask-op（白色半透明遮罩让背景变淡）
  const bgMaskOpRow = document.getElementById('row-bg-mask-op');
  const bgMaskOpVal = document.getElementById('bg-mask-op-val');
  const getBgMaskOp = () => { const v = store.get('bg-mask-op'); if (v) { const n = parseInt(v, 10); if (!isNaN(n)) return Math.max(0, Math.min(80, n)); } return 0; };
  const applyBgMaskOp = (pct) => {
    document.documentElement.style.setProperty('--desk-bg-mask-op', String(pct / 100));
    if (bgMaskOpVal) bgMaskOpVal.textContent = pct === 0 ? '关闭' : pct + '%';
  };
  applyBgMaskOp(getBgMaskOp());
  if (bgMaskOpRow) {
    bgMaskOpRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = getBgMaskOp();
      window.openModal('背景遮罩', '', (v) => {
        if (v === '__reset__') { store.remove('bg-mask-op'); applyBgMaskOp(0); return; }
        const pct = parseInt(v, 10); if (isNaN(pct)) return;
        if (pct === 0) store.remove('bg-mask-op'); else store.set('bg-mask-op', String(pct));
        applyBgMaskOp(pct);
      }, {
        noInput: true,
        slider: { min: 0, max: 80, step: 5, value: current, label: '白色遮罩让背景变淡', unit: '%',
          onChange: (val) => { document.documentElement.style.setProperty('--desk-bg-mask-op', String(val / 100)); } },
        pills: [{ label: '关闭', value: '__reset__' }],
      });
    });
  }

  // v3.7.x：组件卡片圆角——slider 0~30px，CSS 变量 --desk-card-radius（默认 20px）
  const cardRadiusRow = document.getElementById('row-desk-card-radius');
  const cardRadiusVal = document.getElementById('desk-card-radius-val');
  const CARD_RADIUS_DEFAULT = 20;
  const getCardRadius = () => { const v = store.get('desk-card-radius'); if (v) { const n = parseInt(v, 10); if (!isNaN(n)) return Math.max(0, Math.min(30, n)); } return CARD_RADIUS_DEFAULT; };
  const applyCardRadius = (px) => {
    document.documentElement.style.setProperty('--desk-card-radius', px + 'px');
    if (cardRadiusVal) cardRadiusVal.textContent = px === CARD_RADIUS_DEFAULT ? '默认' : px + 'px';
  };
  applyCardRadius(getCardRadius());
  if (cardRadiusRow) {
    cardRadiusRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = getCardRadius();
      window.openModal('组件圆角', '', (v) => {
        if (v === '__reset__') { store.remove('desk-card-radius'); applyCardRadius(CARD_RADIUS_DEFAULT); return; }
        const px = parseInt(v, 10); if (isNaN(px)) return;
        if (px === CARD_RADIUS_DEFAULT) store.remove('desk-card-radius'); else store.set('desk-card-radius', String(px));
        applyCardRadius(px);
      }, {
        noInput: true,
        slider: { min: 0, max: 30, step: 1, value: current, label: '拖动调整组件圆角', unit: 'px',
          onChange: (val) => { document.documentElement.style.setProperty('--desk-card-radius', val + 'px'); } },
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // v3.6.x：图标圆角——滑块 0~30px 自由调整（原「圆形/圆角方/直角方」三选一删除，
  // 旧 ico-shape 值迁移：circle→30 / square→0 / rounded→18），CSS 变量 --app-ico-radius
  const icoShapeRow = document.getElementById('row-ico-shape');
  const icoShapeVal = document.getElementById('ico-shape-val');
  const ICO_RADIUS_DEFAULT = 18;
  const getIcoRadius = () => {
    const v = store.get('ico-radius');
    if (v !== null && v !== undefined && v !== '') {
      const n = parseInt(v, 10);
      if (!isNaN(n)) return Math.max(0, Math.min(30, n));
    }
    const old = store.get('ico-shape');
    if (old === 'circle') return 30;
    if (old === 'square') return 0;
    return ICO_RADIUS_DEFAULT;
  };
  const applyIcoRadius = (px) => {
    document.documentElement.style.setProperty('--app-ico-radius', px + 'px');
    if (icoShapeVal) icoShapeVal.textContent = px === ICO_RADIUS_DEFAULT ? '18px（默认）' : px + 'px';
  };
  applyIcoRadius(getIcoRadius());
  if (icoShapeRow) {
    const syncIcoShapeUI = () => {
      const px = getIcoRadius();
      if (icoShapeVal) icoShapeVal.textContent = px === ICO_RADIUS_DEFAULT ? '18px（默认）' : px + 'px';
    };
    syncIcoShapeUI();
    icoShapeRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = getIcoRadius();
      window.openModal('图标圆角', '', (v) => {
        if (v === '__reset__') {
          store.remove('ico-radius');
          store.remove('ico-shape');
          applyIcoRadius(ICO_RADIUS_DEFAULT);
          syncIcoShapeUI();
          return;
        }
        const px = parseInt(v, 10);
        if (isNaN(px)) return;
        store.set('ico-radius', String(px));
        applyIcoRadius(px);
        syncIcoShapeUI();
      }, {
        noInput: true,
        slider: {
          min: 0, max: 30, step: 1, value: current, label: '拖动调整图标圆角', unit: 'px',
          preview: true,
          onChange: (val) => { document.documentElement.style.setProperty('--app-ico-radius', val + 'px'); },
        },
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // v3.7.x：美化方案导入导出——收集所有美化相关 key 打包 JSON
  // v3.7.x 修复：小组件五个颜色键此前写成 widget-color/widget-border/... 与
  // 实际存储键 widget-bg-color/widget-border-color/... 全部对不上，导出静默漏掉；
  // 自定义图标（app-icon-*）/图标顺序（app-icon-order-*）/图片组件本体
  //（desk-image-src-*）为动态键，在 collectBeauty/导入处单独收集
  // FIX 2026-09-15 #527：补齐 5 个「已定义、已被「恢复全部默认」删除、但从未进采集清单」的键。
  // 本数组是方案/导出文件/分享链接/撤销快照的唯一数据源，漏一个键 = 该设置在这四条链路里
  // 全部静默蒸发：壁纸定位与缩放(phone-bg-pos-x/-y/-size)/纯色壁纸(phone-bg-solid)/
  // 图标文字颜色(app-name-color) 此前不在数组内，导致「存了方案再应用 → 定位缩放回默认」，
  // 且「恢复全部默认」删得掉、撤销快照里却没有 → 点完撤销救不回来。
  // 三个 SCOPE_* 数组早已列有这些键（作者本意就是要它们随方案走），此处补齐即闭合。
  const BEAUTY_KEYS = [
    'phone-bg', 'phone-bg-preset', 'phone-bg-solid', 'phone-bg-pos-x', 'phone-bg-pos-y', 'phone-bg-size',
    'bg-blur', 'bg-mask-op',
    'desk-font-size', 'desk-card-scale', 'desk-card-radius',
    'widget-opacity', 'ico-radius', 'ico-shape',
    'widget-bg-color', 'widget-border-color', 'widget-btn-color', 'widget-btn-text-color', 'widget-heart-color',
    'app-name-color',
    // #769：底部导航栏样式键（图片本体 tab-icon-<page> 为动态键，在 collectBeauty 单独收集）
    'tabbar-bg-op', 'tabbar-whole-op', 'tabbar-bg-color', 'tabbar-radius', 'tabbar-blur', 'tabbar-icon-size',
    'tab-icon-opacity',
    'desk-layout', 'desk-page-count',
    'desk-images', 'desk-texts', 'desk-countdowns',
  ];
  ['deco','quote','fish','checkin','music','memo','mood','week','weekend'].forEach(function(t) {
    BEAUTY_KEYS.push('card-bg-' + t, 'card-bg-mask-' + t);
  });
  for (var _i = 0; _i < 5; _i++) BEAUTY_KEYS.push('page-bg-' + _i);
  // v3.26.x：文字部位颜色（widget-text-<type>-<key>）随美化方案导入导出
  ['deco','quote','fish','checkin','music','memo','mood','week','weekend','desk-clock','desk-calendar','desk-timer','desk-anniv'].forEach(function(t) {
    ['lbl','days','date','title','body','heart','txt','btn','tag','song','artist','times','sub','val','time','disp','mode','label','name'].forEach(function(k) {
      BEAUTY_KEYS.push('widget-text-' + t + '-' + k);
    });
  });
  const collectBeauty = () => {
    const data = {};
    BEAUTY_KEYS.forEach(k => { const v = store.get(k); if (v !== null && v !== undefined) data[k] = v; });
    // 动态键：自定义图标 + 图标顺序（.app 的 data-app 与 .app-grid 的 data-app 各自成键）
    try {
      document.querySelectorAll('.app').forEach(app => {
        const k = 'app-icon-' + app.dataset.app;
        const v = store.get(k);
        if (v) data[k] = v;
        // v3.27.x：图标透明度随方案导出
        const ok = 'app-icon-opacity-' + app.dataset.app;
        const ov = store.get(ok);
        if (ov) data[ok] = ov;
        // FIX 2026-09-16 #581：图标图片缩放/位置随方案导出（同一动态键口径）
        ['app-icon-zoom-', 'app-icon-pos-x-', 'app-icon-pos-y-'].forEach(pfx => {
          const fk = pfx + app.dataset.app;
          const fv = store.get(fk);
          if (fv !== null && fv !== undefined && fv !== '') data[fk] = fv;
        });
      });
      document.querySelectorAll('.app-grid').forEach(grid => {
        const k = 'app-icon-order-' + grid.dataset.app;
        const v = store.get(k);
        if (v) data[k] = v;
      });
      // #769：底部栏按钮图片（动态键，同 app-icon-* 口径；样式键与图片透明度已在 BEAUTY_KEYS）
      TABBAR_PAGES.forEach(pk => {
        const v = store.get('tab-icon-' + pk);
        if (v) data['tab-icon-' + pk] = v;
      });
    } catch (e) {}
    // 动态键：图片组件本体（desk-image-src-<id> 只进 IDB+内存缓存，此前不导出 → 导入后空壳）
    try {
      const imgs = JSON.parse(store.get('desk-images') || '[]');
      if (Array.isArray(imgs)) imgs.forEach(m => {
        const v = store.get('desk-image-src-' + m.id);
        if (v) data['desk-image-src-' + m.id] = v;
      });
    } catch (e) {}
    return data;
  };
  // v3.27.x：导出保留「文件」为主通道；v3.26.x #172：文件导出接统一三级降级保存链
  //（window.mochiExportFile：系统分享面板→系统保存框→确认后下载）——f4158f6 收敛为
  // 仅 a[download] 后，iPhone 主屏安装（standalone 无下载管理器）与夸克等壳浏览器点导出
  // 静默无反应=方案无法导出；同时补回「复制文字」通道（>3MB 拒绝，防剪贴板截断）。
  // v3.26.x：导出前先选「当前设置 / 某个已保存方案」，再选导出方式。
  // 全局主题延续右侧方案保存逻辑（collectBeautyFull），方案的 data 里已含 accent/theme。
  const downloadBeautyFile = (json) => {
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mochi美化方案-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 1000);
      toast('已导出美化方案文件');
    } catch (e) { toast('导出文件失败'); }
  };
  const beautyFileLocalDate = () => {
    const d = new Date(); const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const startBeautyExport = (data) => {
    const json = JSON.stringify(data);
    if (json.length > 64 * 1024 * 1024) { toast('方案过大，导出失败'); return; }
    const fname = 'mochi美化方案-' + beautyFileLocalDate() + '.json';
    const doExportFile = () => {
      if (window.mochiExportFile) { window.mochiExportFile(json, fname, 'mochi美化方案'); return; }
      downloadBeautyFile(json);
    };
    const doCopy = () => {
      if (json.length > 3 * 1024 * 1024) { toast('方案过大（含图片），复制可能被截断，请用「导出文件」'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(() => toast('已复制到剪贴板，发给对方粘贴导入')).catch(() => toast('复制失败，请改用导出文件'));
      } else { toast('剪贴板不可用，请改用导出文件'); }
    };
    if (!window.openModal) { doExportFile(); return; }
    window.openModal('导出美化方案', '', (v) => {
      if (v === 'copy') { doCopy(); return; }
      doExportFile();
    }, {
      noInput: true,
      staticText: '选择导出方式：\n· 导出文件：自动弹分享/保存框（iPhone 主屏安装到桌面时用这个），不支持时确认后下载\n· 复制文字：方案较小时可发给对方粘贴导入',
      pills: [
        { label: '导出文件', value: 'file' },
        { label: '复制文字', value: 'copy' },
      ],
    });
  };
  const beautyExportRow = document.getElementById('row-beauty-export');
  if (beautyExportRow) {
    beautyExportRow.addEventListener('click', () => {
      const schemes = getSchemes();
      // 第一步：选择要导出「当前设置」还是某个已保存方案；无保存方案时直接导出当前设置
      if (!schemes.length || !window.openModal) { startBeautyExport(collectBeautyFull()); return; }
      const pills = [{ label: '当前设置', value: 'current' }]
        .concat(schemes.map((s, i) => ({ label: s.name || ('方案' + (i + 1)), value: 'sch_' + i })));
      // v3.27.x：选完来源直接下载文件（startBeautyExport 已无嵌套弹窗，无需 ctl.stay）
      window.openModal('导出美化方案', '', (v) => {
        let data;
        if (v && v.indexOf('sch_') === 0) {
          const i = parseInt(String(v).slice(4), 10);
          const s = schemes[i];
          if (!s) { toast('未找到该方案'); return; }
          data = s.data || {};
        } else {
          data = collectBeautyFull();
        }
        startBeautyExport(data);
      }, {
        noInput: true,
        staticText: '选择要导出的美化方案，将生成 .json 文件：\n· 当前设置：导出当前正在使用的美化\n· 已保存方案：导出对应方案（含其壁纸/配色）',
        pills: pills,
      });
    });
  }
  // v3.17.x：美化数据写入当前桌面（导入 / 应用方案共用），含动态键与全局主题
  // v3.27.x：方案部分应用（C）——scope='color'|'bg'|'layout'|'all'，默认 all 完全兼容现有
  const SCOPE_COLOR_KEYS = ['widget-bg-color','widget-border-color','widget-btn-color','widget-btn-text-color','widget-heart-color','app-name-color','widget-opacity','desk-card-radius','ico-radius','ico-shape','desk-font-size','desk-card-scale'];
  const SCOPE_BG_KEYS = ['phone-bg','phone-bg-preset','phone-bg-solid','phone-bg-pos-x','phone-bg-pos-y','phone-bg-size','bg-blur','bg-mask-op'];
  const SCOPE_LAYOUT_KEYS = ['desk-layout','desk-page-count','desk-images','desk-texts','desk-countdowns'];
  const applyBeautyData = (data, scope) => {
    scope = scope || 'all';
    let n = 0;
    const allow = (k) => {
      if (scope === 'all') return true;
      if (scope === 'color') return SCOPE_COLOR_KEYS.indexOf(k) >= 0 || k === '__accent__' || k === '__theme__';
      if (scope === 'bg') return SCOPE_BG_KEYS.indexOf(k) >= 0 || /^page-bg-/.test(k);
      if (scope === 'layout') return SCOPE_LAYOUT_KEYS.indexOf(k) >= 0 || k.indexOf('app-icon-') === 0 || k.indexOf('desk-image-src-') === 0 || k.indexOf('tab-icon-') === 0 || k === 'hidden-icons';
      return true;
    };
    BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined && allow(k)) { store.set(k, data[k]); n++; } });
    Object.keys(data).forEach(k => {
      // #769：tab-icon- 为底部栏按钮图片动态键（BEAUTY_KEYS 只列静态样式键）
      if ((k.indexOf('app-icon-') === 0 || k.indexOf('desk-image-src-') === 0 || k.indexOf('tab-icon-') === 0) && data[k] !== undefined && allow(k)) {
        store.set(k, data[k]); n++;
      }
    });
    if (data['__accent__'] && allow('__accent__')) { try { localStorage.setItem('xy-home-v2:accent-color', data['__accent__']); } catch (e) {} n++; }
    if (data['__theme__'] && allow('__theme__')) { try { localStorage.setItem('xy-home-v2:theme-mode', data['__theme__']); } catch (e) {} n++; }
    // FIX 2026-09-15 #527：返回「实际写入的项数」——导入方据此如实反馈，不再无条件报「已导入」
    return n;
  };
  // FIX 2026-09-15 #527：方案用途标记。此前方案 JSON 无任何用途标识，把「聊天美化」的
  // JSON 粘进「桌面美化」导入框会解析通过、命中的键为 0，却照样提示「已导入」（用户以为
  // 导入成功、实际什么都没变）。现在导出带 __kind__，导入先对用途、再报识别项数。
  const BEAUTY_KIND = 'mochi-desk-beauty';
  const BEAUTY_FMT = 2;
  const beautyKindMismatch = (data) => {
    const k = data && data['__kind__'];
    return !!k && k !== BEAUTY_KIND;
  };
  // 预检：不写盘，只算这份数据能命中几项（用于「识别到 0 项就别备份/别刷新」）
  const recognizeBeauty = (data) => {
    let n = 0;
    if (!data || typeof data !== 'object') return 0;
    BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined) n++; });
    Object.keys(data).forEach(k => {
      if ((k.indexOf('app-icon-') === 0 || k.indexOf('desk-image-src-') === 0) && data[k] !== undefined) n++;
    });
    if (data['__accent__']) n++;
    if (data['__theme__']) n++;
    return n;
  };
  // FIX 2026-09-15 #527：刷新前先等大键落盘。壁纸/卡片背景/图片组件是 base64（压缩上限
  // 4.5MB），超过 200KB 的键只进 IndexedDB（idb.js LS_BIG_LIMIT），而写日志只记 ≤64KB 的值
  // → 大键没有 localStorage 兜底。此前导入/应用方案/撤销/恢复默认收尾一律
  // setTimeout(reload, 800) 不等 IDB 事务提交：慢机与挂起内核上刷新后大图未落盘即丢
  //（用户报「提示导入成功，但壁纸不见了」）。现显式重写这些大键并 await 事务完成，
  // 另设 1.2s 上限——IDB 真挂起时也必须刷新，绝不把用户卡在页面上。
  const BEAUTY_LS_BIG = 200 * 1024;
  const beautyBigKeyCandidates = () => {
    const ks = BEAUTY_KEYS.slice();
    try {
      JSON.parse(store.get('desk-images') || '[]').forEach(m => { if (m && m.id) ks.push('desk-image-src-' + m.id); });
    } catch (e) {}
    return ks;
  };
  const flushBeautyIdb = () => {
    try {
      if (!window.idbSet) return Promise.resolve(false);
      const pre = window.activePrefix();
      const jobs = [];
      beautyBigKeyCandidates().forEach((k) => {
        let v = null;
        try { v = store.get(k); } catch (e) {}
        if (typeof v === 'string' && v.length > BEAUTY_LS_BIG) jobs.push(window.idbSet(pre + ':' + k, v));
      });
      return jobs.length ? Promise.all(jobs) : Promise.resolve(false);
    } catch (e) { return Promise.resolve(false); }
  };
  const reloadAfterBeautyWrite = () => {
    let done = false;
    const go = () => { if (done) return; done = true; try { location.reload(); } catch (e) {} };
    // 时序契约：刷新不早于原来的 800ms——既有回归脚本（verify-beauty-io F2/F3）按这个节奏
    // 在导入后读取设置值，提前刷新会让读取撞上「导航进行中」而取到空值；但落盘必须等，
    // 所以是「800ms 与落盘完成两者都满足才刷」，落盘慢则顺延，2.5s 硬上限兜底。
    const RE_MIN = 800, RE_MAX = 2500;
    const t0 = Date.now();
    const afterFlush = () => setTimeout(go, Math.max(0, RE_MIN - (Date.now() - t0)));
    try { Promise.resolve(flushBeautyIdb()).then(afterFlush, afterFlush); } catch (e) { setTimeout(go, RE_MIN); }
    setTimeout(go, RE_MAX);
  };
  const beautyImportRow = document.getElementById('row-beauty-import');
  if (beautyImportRow) {
    beautyImportRow.addEventListener('click', () => {
      if (!window.openModal) return;
      // v3.26.x #172：补回「粘贴文本导入」通道（与文件导入并存，同聊天美化导入）——
      // f4158f6 收敛为仅文件选择后，iPhone 主屏安装（standalone 文件选择器常不弹）等
      // 环境导入全断；粘贴通道不依赖文件选择能力。txtImportAuto 仍保留：选完文件自动应用。
      window.openModal('导入美化方案', '', (v) => {
        if (!v || !v.trim()) { toast('请先粘贴方案文本，或点「从文件导入」选择 .json 文件'); return; }
        try {
          // #408：粘贴/文件导入统一走自救解析（安卓各机型浏览器粘贴链路会弄脏 JSON）
          const data = window.mochiParsePastedJSON(v);
          // FIX 2026-09-15 #527：用途校验——把「聊天美化」的方案粘进桌面导入框时，
          // 旧行为是解析通过、命中 0 项、照样提示「已导入」（用户以为成功，其实没变）。
          if (beautyKindMismatch(data)) {
            toast('这份方案不是桌面美化方案（' + data.__kind__ + '），请到对应页面导入');
            return;
          }
          const hit = recognizeBeauty(data);
          if (!hit) {
            // 未命中任何美化项：不备份、不压撤销栈、不刷新——避免「什么都没变却生成一份垃圾备份」
            toast('这份数据里没有识别到桌面美化项，请确认是桌面美化方案');
            return;
          }
          // v3.27.x：导入前自动把「当前美化」保存成方案，避免被导入覆盖后丢失
          //（用户要求：导入不影响原本拥有的美化，原美化自动存为方案）
          // FIX 2026-09-15 #527：备份如实报错 + 数量上限。
          // 原实现 saveSchemesList 吞掉所有异常（配额满也吞），toast 却照样报「已自动保存」——
          // 用户以为有安全网其实没有；且每次导入都无条件追加一份（每份含 base64 壁纸可达数 MB），
          // 列表无限膨胀直到配额爆掉。现在：写入后用读回校验确认落盘，并只保留最近 5 份自动备份。
          let backupName = '';
          try {
            const cur = collectBeautyFull();
            if (cur && Object.keys(cur).length > 0) {
              const d = new Date();
              const p = (n) => (n < 10 ? '0' : '') + n;
              const name = '导入前备份 ' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
              let list = getSchemes();
              // 自动备份只留最近 5 份，用户自己命名的方案一份不动
              const autos = list.filter(s => s && typeof s.name === 'string' && s.name.indexOf('导入前备份') === 0);
              if (autos.length >= 5) {
                const drop = new Set(autos.slice(0, autos.length - 4).map(s => s.time));
                list = list.filter(s => !(s && drop.has(s.time) && typeof s.name === 'string' && s.name.indexOf('导入前备份') === 0));
              }
              list.push({ name, time: Date.now(), data: cur });
              saveSchemesList(list);
              // 读回校验：写入被静默吞掉时不再谎报成功
              const back = getSchemes();
              const saved = back.some(s => s && s.name === name);
              if (saved) { backupName = name; toast('已自动保存原美化 → 方案「' + name + '」'); }
              else { toast('原美化备份失败（可能存储空间不足），建议先导出备份再导入'); }
            }
          } catch (e) {
            toast('原美化备份失败：' + ((e && e.message) || '未知原因') + '，建议先导出备份再导入');
          }
          try { pushBeautyUndo(); } catch (e) {}
          const applied = applyBeautyData(data);
          toast('已导入 ' + applied + ' 项，刷新生效');
          // FIX #527：刷新前先等大键（壁纸/卡片背景/图片组件）IDB 事务落盘，见 reloadAfterBeautyWrite
          reloadAfterBeautyWrite();
        } catch (e) {
          // #408：带出真实原因 + 失败现场写诊断（设置页「复制诊断信息」可直接自证机型粘贴链路）
          const _sv = String(v || '');
          try { if (window.__jsErrors) window.__jsErrors.push('[美化导入] ' + ((e && e.message) || e) + ' | 收到长度=' + _sv.length + ' | 开头: ' + _sv.replace(/[\uFEFF\u200B-\u200F]/g, '').slice(0, 100)); } catch (e1) {}
          toast('解析失败：' + ((e && e.message) || '请检查文本内容'));
        }
      }, { textarea: true, textareaPlaceholder: '粘贴美化方案文本（JSON），或点下方「从文件导入」选择 .json 文件', txtImport: true, txtImportAuto: true, staticText: '导入前会自动把当前美化保存为「导入前备份」方案（最多保留 5 份）；支持粘贴文本或从文件导入（选完文件自动应用）' });
    });
  }

  // ===== v3.17.x：美化方案（全局保存，所有联系人桌面通用） =====
  // 方案数据与导出一致（collectBeauty + 全局主题），存根命名空间 xy-home-v2:beauty-schemes，
  // 切换联系人桌面后依然可见、可一键应用——满足「通用」需求。
  const SCHEMES_KEY = 'beauty-schemes';
  const getSchemes = () => {
    try { const a = JSON.parse(gStore.get(SCHEMES_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  };
  const saveSchemesList = (arr) => { try { gStore.set(SCHEMES_KEY, JSON.stringify(arr)); } catch (e) {} };
  // v3.27.x：内置美化方案库（只读，绝不写用户 beauty-schemes）——开箱即用，降低首次上手成本
  // 应用走 applyBeautyData（与用户方案同链路），用户主动点才覆盖当前桌面；不污染用户已保存方案
  const BUILTIN_SCHEMES = [
    { name: '情侣粉', builtin: true, data: { '__accent__': '#e05555', '__theme__': 'light', 'widget-bg-color': '#fff0f0', 'widget-border-color': '#ffd0d0', 'widget-btn-color': '#e05555', 'widget-btn-text-color': '#ffffff', 'widget-heart-color': '#e05555', 'phone-bg-preset': '樱花' } },
    { name: '极简黑白', builtin: true, data: { '__accent__': '#111111', '__theme__': 'light', 'widget-bg-color': '#ffffff', 'widget-border-color': 'rgba(0,0,0,.1)', 'widget-btn-color': '#111111', 'widget-btn-text-color': '#ffffff', 'widget-heart-color': '#111111' } },
    { name: '森系', builtin: true, data: { '__accent__': '#4a9d5e', '__theme__': 'light', 'widget-bg-color': '#f0fff0', 'widget-border-color': '#c8e6c9', 'widget-btn-color': '#4a9d5e', 'widget-btn-text-color': '#ffffff', 'widget-heart-color': '#4a9d5e', 'phone-bg-preset': '森林' } },
    { name: '海洋', builtin: true, data: { '__accent__': '#3a7bd5', '__theme__': 'light', 'widget-bg-color': '#f0f4ff', 'widget-border-color': '#b8d4e8', 'widget-btn-color': '#3a7bd5', 'widget-btn-text-color': '#ffffff', 'widget-heart-color': '#3a7bd5', 'phone-bg-preset': '海洋' } },
    { name: '暮色', builtin: true, data: { '__accent__': '#d6459d', '__theme__': 'dark', 'widget-bg-color': '#1c1c1e', 'widget-border-color': 'rgba(255,255,255,.12)', 'widget-btn-color': '#d6459d', 'widget-btn-text-color': '#ffffff', 'widget-heart-color': '#d6459d', 'phone-bg-preset': '星空' } },
  ];
  const collectBeautyFull = () => {
    const data = collectBeauty();
    try { const ac = localStorage.getItem('xy-home-v2:accent-color'); if (ac) data['__accent__'] = ac; } catch (e) {}
    try { const tm = localStorage.getItem('xy-home-v2:theme-mode'); if (tm) data['__theme__'] = tm; } catch (e) {}
    // FIX 2026-09-15 #527：写入用途/格式标记。旧版本导出的文件没有这两个键，
    // 导入侧按「无标记即放行」处理，向后兼容不受影响。
    data['__kind__'] = BEAUTY_KIND;
    data['__v__'] = BEAUTY_FMT;
    return data;
  };
  // ---- 桌面美化方案缩略图 + 保存确认（预览+摘要），同聊天方案一致 ----
  // 迷你手机屏幕：强调色状态栏/底栏 + 页面底色/壁纸 + 强调色图标点，便于识别每个方案
  function desktopSchemeThumb(data) {
    data = data || {};
    const dark = data['__theme__'] === 'dark';
    const accent = data['__accent__'] || (dark ? '#ffffff' : '#111111');
    const pgBg = data['page-bg-0'] || (dark ? '#1c1c1e' : '#f2f3f5');
    const ink = dark ? '#ffffff' : '#111111';
    const soft = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.45)';
    let wallStyle = 'background:' + pgBg;
    const bgv = data['phone-bg'];
    if (bgv && typeof bgv === 'string' && (bgv.indexOf('data:') === 0 || bgv.indexOf('http') === 0)) {
      wallStyle += ';background-image:url(&quot;' + bgv + '&quot;);background-size:cover;background-position:center';
    } else if (bgv && typeof bgv === 'string') {
      wallStyle += ';background:' + bgv;
    }
    let dots = '';
    for (let _d = 0; _d < 4; _d++) dots += '<div style="flex:1;height:9px;border-radius:4px;background:' + soft + ';opacity:.7"></div>';
    return '' +
      '<div style="position:relative;width:100%;height:74px;border-radius:9px;overflow:hidden;background:#e6e9ee;display:flex;align-items:center;justify-content:center;box-sizing:border-box">' +
        '<div style="position:relative;width:58px;height:100%;border-radius:8px;overflow:hidden;border:1.5px solid ' + ink + ';box-sizing:border-box;background:#fff">' +
          '<div style="height:10px;background:' + accent + '"></div>' +
          '<div style="height:16px;display:flex;align-items:center;padding:0 5px;box-sizing:border-box"><div style="flex:1;height:5px;border-radius:3px;background:' + ink + '"></div><div style="width:5px;height:5px;border-radius:2px;background:' + accent + ';margin-left:2px"></div></div>' +
          '<div style="height:35px;' + wallStyle + ';display:flex;align-items:center;justify-content:center;gap:4px;padding:0 5px;box-sizing:border-box">' + dots + '</div>' +
          '<div style="height:9px;background:' + accent + ';opacity:.85"></div>' +
        '</div>' +
      '</div>';
  }
  function desktopBeautySummary(data) {
    data = data || {};
    const out = [];
    out.push('主题 ' + (data['__theme__'] === 'dark' ? '深色' : '浅色'));
    if (data['__accent__']) out.push('强调色 ' + data['__accent__']);
    if (data['phone-bg'] || data['phone-bg-preset']) out.push('壁纸');
    if (data['page-bg-0']) out.push('页面配色已设');
    const fs = data['desk-font-size'];
    if (fs) out.push('桌面字号 ' + fs);
    const is = data['ico-shape'];
    if (is) out.push('图标 ' + ({ square: '方形', circle: '圆形', round: '圆角' }[is] || is));
    const rad = data['desk-card-radius'];
    if (rad) out.push('卡片圆角 ' + rad);
    return out;
  }
  function beautySaveModalEl() {
    let m = document.getElementById('beauty-save-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'beauty-save-modal'; m.hidden = true;
      m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
    }
    return m;
  }
  // 保存当前为方案：可视确认（缩略预览 + 设置摘要）再取名入库（全局）
  window.saveBeautyScheme = function () {
    const x = beautySaveModalEl();
    x.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'box-sizing:border-box;width:min(84vw,340px);max-height:84vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
    const hd = document.createElement('div');
    hd.style.cssText = 'font-size:15px;font-weight:700;text-align:center;margin-bottom:12px';
    hd.textContent = '保存当前为桌面美化方案';
    const data = collectBeautyFull();
    const pv = document.createElement('div');
    pv.innerHTML = desktopSchemeThumb(data);
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10.5px;color:var(--muted,#999);margin:8px 0 6px';
    sub.textContent = '正在保存的当前设置：';
    const sum = document.createElement('div');
    sum.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px';
    const chips = desktopBeautySummary(data);
    chips.forEach(c => { const el = document.createElement('span'); el.textContent = c; el.style.cssText = 'font-size:10.5px;color:var(--muted,#666);background:var(--card-soft,#f2f3f5);border:1px solid var(--card-border,#eee);padding:2px 8px;border-radius:999px'; sum.appendChild(el); });
    const inp = document.createElement('input');
    inp.placeholder = '例如：情侣粉、简约黑白…'; inp.maxLength = 20;
    inp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)';
    const act = document.createElement('div');
    act.style.cssText = 'display:flex;gap:8px;margin-top:13px;justify-content:flex-end';
    const cancel = mkBtn('取消', 'font-size:12.5px;padding:7px 14px;border:1px solid var(--card-border,#eee);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => { x.style.display = 'none'; x.hidden = true; });
    const ok = mkBtn('保存方案', 'font-size:12.5px;padding:7px 14px;border:none;border-radius:9px;background:var(--ink,#111);color:#fff', () => {
      const name = (inp.value || '').trim();
      if (!name) { inp.style.borderColor = '#e05a5a'; return; }
      const list = getSchemes();
      list.push({ name, time: Date.now(), data });
      saveSchemesList(list);
      x.style.display = 'none'; x.hidden = true;
      toast('已保存方案「' + name + '」，所有桌面通用');
      const m = document.getElementById('beauty-scheme-manager');
      if (m && !m.hidden) window.openBeautySchemes();
    });
    act.appendChild(cancel); act.appendChild(ok);
    wrap.appendChild(hd); wrap.appendChild(pv); wrap.appendChild(sub); wrap.appendChild(sum); wrap.appendChild(inp); wrap.appendChild(act);
    x.appendChild(wrap);
    x.style.display = 'flex'; x.hidden = false;
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
  };
  // 方案管理器弹窗（自定义居中框，与联系人管理器同风格）
  function schemeModalEl() {
    let m = document.getElementById('beauty-scheme-manager');
    if (!m) {
      m = document.createElement('div'); m.id = 'beauty-scheme-manager'; m.hidden = true;
      m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) hideSchemeModal(m); });
    }
    return m;
  }
  function showSchemeModal(m) { m.style.display = 'flex'; m.hidden = false; }
  function hideSchemeModal(m) { m.style.display = 'none'; m.hidden = true; }
  function applyScheme(idx, m) {
    const s = getSchemes()[idx];
    if (!s || !window.openModal) return;
    // v3.27.x：部分应用（C）——先选范围再应用，默认全部
    const scopePills = [
      { label: '应用全部', value: 'all' },
      { label: '仅配色', value: 'color' },
      { label: '仅壁纸', value: 'bg' },
      { label: '仅布局', value: 'layout' },
    ];
    const scopeLabel = { all: '全部', color: '配色', bg: '壁纸', layout: '布局' };
    const ctl = window.openModal('应用方案「' + s.name + '」', '', (v) => {
      const scope = (!v || v === 'ok') ? 'all' : v;
      if (!scopePills.some(p => p.value === scope)) return;
      try { pushBeautyUndo(); } catch (e) {}
      applyBeautyData(s.data || {}, scope);
      hideSchemeModal(m);
      toast('已应用「' + s.name + '」(' + (scopeLabel[scope] || scope) + ')，刷新生效');
      reloadAfterBeautyWrite();
    }, { noInput: true, pillSubmit: true, staticText: '选择应用范围：点 pill 直接应用该范围，或点确定应用全部', pills: scopePills });
    if (ctl && ctl.pills) ctl.pills(scopePills, 'all');
  }
  function deleteScheme(idx, m) {
    const s = getSchemes()[idx];
    if (!s || !window.openModal) return;
    // v3.26.x：预选中唯一「删除」pill——否则只点底部「确定」传 null → 静默不删除（反馈"没反应"）
    const ctl = window.openModal('删除方案「' + s.name + '」？', '', (v) => {
      if (v !== 'ok') return;
      const list = getSchemes();
      list.splice(idx, 1);
      saveSchemesList(list);
      toast('已删除方案');
      window.openBeautySchemes();
    }, { noInput: true, pillSubmit: true, staticText: '删除后不可恢复', pills: [{ label: '删除', value: 'ok' }] });
    if (ctl && ctl.pills) ctl.pills([{ label: '删除', value: 'ok' }], 'ok');
  }
  window.openBeautySchemes = function () {
    const m = schemeModalEl();
    m.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    const head = document.createElement('div');
    head.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:4px">美化方案</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">方案在所有联系人桌面通用，点「应用」一键切换当前桌面外观</div>';
    box.appendChild(head);
    const list = document.createElement('div'); list.className = 'cm-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0';
    const schemes = getSchemes();
    // v3.27.x：内置方案置顶（只读，不可改名/删除）——开箱即用，应用走 applyBeautyData
    BUILTIN_SCHEMES.forEach((s) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--card-soft,rgba(0,0,0,.02))';
      const th = document.createElement('div');
      th.innerHTML = desktopSchemeThumb(s.data || {});
      row.appendChild(th);
      const nm = document.createElement('div');
      nm.innerHTML = '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px;font-weight:600">' + s.name + '</span><span style="font-size:10px;color:#fff;background:var(--ink,#111);padding:1px 6px;border-radius:999px">内置</span></div>';
      row.appendChild(nm);
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap';
      btns.appendChild(mkBtn('预览', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => desktopStartPreview(s, m)));
      btns.appendChild(mkBtn('套用', 'font-size:12px;padding:4px 10px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => {
        const applyBuiltin = () => { applyBeautyData(s.data || {}); hideSchemeModal(m); toast('已应用「' + s.name + '」，刷新生效'); reloadAfterBeautyWrite(); };
        if (!window.openModal) { applyBuiltin(); return; }
        const ctl = window.openModal('应用内置方案「' + s.name + '」？', '', (v) => { if (v !== 'ok') return; applyBuiltin(); }, { noInput: true, pillSubmit: true, staticText: '将覆盖当前桌面的美化设置，刷新生效', pills: [{ label: '应用', value: 'ok' }] });
        if (ctl && ctl.pills) ctl.pills([{ label: '应用', value: 'ok' }], 'ok');
      }));
      row.appendChild(btns);
      list.appendChild(row);
    });
    if (!schemes.length) {
      const empty = document.createElement('div');
      empty.innerHTML = '<div style="font-size:13px;color:var(--muted,#999);text-align:center;padding:20px 0">还没有保存的方案<br>先点下方「保存当前为方案」</div>';
      list.appendChild(empty);
    }
    schemes.forEach((s, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px';
      const th = document.createElement('div');
      th.innerHTML = desktopSchemeThumb(s.data || {});
      row.appendChild(th);
      const nm = document.createElement('div');
      const t = new Date(s.time || Date.now());
      const ds = (t.getMonth() + 1) + '-' + t.getDate();
      nm.innerHTML = '<div style="font-size:14px;font-weight:600;word-break:break-all">' + s.name + '</div><div style="font-size:11px;color:var(--muted,#999)">保存于 ' + ds + '</div>';
      row.appendChild(nm);
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap';
      btns.appendChild(mkBtn('预览', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => desktopStartPreview(s, m)));
      btns.appendChild(mkBtn('应用', 'font-size:12px;padding:4px 10px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => applyScheme(i, m)));
      btns.appendChild(mkBtn('改名', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => renameScheme(i, m)));
      btns.appendChild(mkBtn('删除', 'font-size:12px;padding:4px 10px;border:1px solid rgba(163,45,45,.35);border-radius:8px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d)', () => deleteScheme(i, m)));
      row.appendChild(btns);
      list.appendChild(row);
    });
    box.appendChild(list);
    const save = document.createElement('button');
    save.textContent = '+ 保存当前为方案';
    save.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600';
    save.addEventListener('click', () => { window.saveBeautyScheme(); });
    box.appendChild(save);
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
    close.addEventListener('click', () => hideSchemeModal(m));
    box.appendChild(close);
    m.appendChild(box);
    showSchemeModal(m);
  };
  const beautySaveRow = document.getElementById('row-beauty-save');
  if (beautySaveRow) beautySaveRow.addEventListener('click', () => window.saveBeautyScheme());
  const beautySchemesRow = document.getElementById('row-beauty-schemes');
  if (beautySchemesRow) beautySchemesRow.addEventListener('click', () => window.openBeautySchemes());
  // v3.27.x：撤销栈（A）——批量操作前压栈（最近 10 次），撤销恢复。纯本地，不动现有数据
  // FIX 2026-09-15 #527：撤销栈改 per-cid。原实现 gStore（全局根键）存的是「当前联系人」的
  // 快照 —— 在联系人 A 调完美化，切到 B 点「撤销最近改动」，会把 A 的美化写到 B 桌面上
  //（跨桌面串美化）。方案列表全局共用是有意设计（用户要求跨桌面通用），撤销栈不是：
  // 撤销的语义是「回退我刚在这个桌面做的操作」，必须按桌面隔离。
  // 兼容：旧的全局键 beauty-undo-stack 保留可读（首次迁移到当前桌面命名空间），不删除历史数据。
  const UNDO_KEY = 'beauty-undo-stack';
  const getUndoStack = () => {
    try {
      const a = JSON.parse(store.get(UNDO_KEY) || '[]');
      if (Array.isArray(a) && a.length) return a;
    } catch (e) {}
    // 一次性回退读旧全局键（老数据不丢；读到即由下次 push 写入当前桌面命名空间）
    try { const a = JSON.parse(gStore.get(UNDO_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  };
  const setUndoStack = (st) => { try { store.set(UNDO_KEY, JSON.stringify(st)); } catch (e) {} };
  const pushBeautyUndo = () => { try { const st = getUndoStack(); st.push({ time: Date.now(), data: collectBeautyFull() }); while (st.length > 10) st.shift(); setUndoStack(st); } catch (e) {} };
  const popBeautyUndo = () => { const st = getUndoStack(); if (!st.length) { toast('没有可撤销的改动了'); return null; } const it = st.pop(); setUndoStack(st); return it; };
  const beautyUndoRow = document.getElementById('row-beauty-undo');
  if (beautyUndoRow) {
    beautyUndoRow.addEventListener('click', () => {
      const it = popBeautyUndo();
      if (!it) return;
      const n = applyBeautyData(it.data || {}, 'all');
      toast('已撤销最近一次改动（恢复 ' + n + ' 项），刷新生效');
      reloadAfterBeautyWrite();
    });
  }
  // v3.27.x：一键重置全部美化（项4）——遍历 BEAUTY_KEYS + 全局键清空，二次确认。已保存方案不受影响
  const resetAllBeautyRow = document.getElementById('row-beauty-reset-all');
  if (resetAllBeautyRow) {
    resetAllBeautyRow.addEventListener('click', () => {
      const ctl = window.openModal('恢复全部默认美化', '将清空所有美化设置（颜色/壁纸/字号/圆角/布局/图标自定义等），恢复为系统默认。已保存的美化方案不受影响。确定继续？', (v) => {
        if (v !== '1') return;
        try { pushBeautyUndo(); } catch (e) {}
        try {
          BEAUTY_KEYS.forEach(k => store.remove(k));
          ['app-name-color','phone-bg-solid','phone-bg-pos-x','phone-bg-pos-y','phone-bg-size'].forEach(k => store.remove(k));
          document.querySelectorAll('.app').forEach(app => { if (app.dataset.app) store.remove('app-icon-' + app.dataset.app); });
          // FIX 2026-09-16 #581：图标图片的缩放/位置（与图片同生共死）一并清掉
          document.querySelectorAll('.app').forEach(app => {
            const k = app.dataset.app;
            if (!k) return;
            store.remove('app-icon-zoom-' + k);
            store.remove('app-icon-pos-x-' + k);
            store.remove('app-icon-pos-y-' + k);
          });
          document.querySelectorAll('.app-grid').forEach(g => { if (g.dataset.app) store.remove('app-icon-order-' + g.dataset.app); });
          // #769：底部栏按钮图片一并清掉（样式键在 BEAUTY_KEYS 里已被上面 forEach 覆盖）
          TABBAR_PAGES.forEach(pk => store.remove('tab-icon-' + pk));
          try { localStorage.removeItem('xy-home-v2:accent-color'); } catch (e) {}
          try { localStorage.removeItem('xy-home-v2:theme-mode'); } catch (e) {}
        } catch (e) {}
        toast('已恢复全部默认美化，刷新生效');
        reloadAfterBeautyWrite();
      }, { noInput: true, pillSubmit: true, pills: [{ label: '确定恢复全部默认', value: '1' }] });
      if (ctl && ctl.pills) ctl.pills([{ label: '确定恢复全部默认', value: '1' }], '1');
    });
  }
  // v3.27.x #146：「一键随机美化」（row-beauty-random 处理块）已删除——
  // 其写入的 widget-opacity 为小数（如 "0.9"/"1"），而各读取点用 parseInt 按百分比解析
  // → parseInt("0.9")=0 → 小组件全透明；且该键属美化键，「恢复默认布局」只清 desk-layout 不清它，用户无从恢复。
  // 功能整体下线；历史脏值由下方 opacityRawToPct 启动自愈修正（见 #146 修复）。
  // v3.27.x：方案分享 URL（D）——当前美化 JSON → base64 → hash，对方打开自动弹导入。纯本地无服务器
  // FIX 2026-09-15 #527：剔除 base64 图片键后再生成链接。原实现把整份美化（含压缩上限 4.5MB 的
  // 壁纸）base64 塞进 URL hash，base64 后约 6MB，远超浏览器 URL 上限——接收端拿到截断串、
  // JSON.parse 抛错被最外层 catch 吞掉，连失败提示都没有。用户设了自定义壁纸就发不出去。
  // 现在：链接只带「配色/尺寸/圆角/内置壁纸预设」等小体积项；带图壁纸不进链接（数据太大），
  // 生成时如实告知走「导出文件」。另对最终 URL 长度设硬上限，超限就明确报错、不静默生成坏链接。
  // #602 优化：硬上限从 60000 收到 16000。分享链接的 fragment 不会发给服务器，浏览器本身能吃很长，
  // 真正的风险是聊天软件/复制过程把长链接截断——截断后对方拿到坏链接（以前是静默失败，现已在接收端
  // 明确报「链接不完整」）。16000 足以覆盖几乎所有真实美化数据，又大幅远离易被截断的区间。
  const SHARE_URL_MAX = 16000;
  // 超过这个长度就提示「可能被截断」，但仍允许生成（数据本身完整）
  const SHARE_URL_WARN = 4000;
  const isBeautyImageKey = (k) => /^(phone-bg|page-bg-|card-bg-|desk-image-src-|phone-bg-item-)/.test(k);
  const shareBeautyLink = () => {
    try {
      // #602：本地文件方式（file:// / 其它非 http(s)）打开的页面，生成的链接对方打不开
      //（origin 会是 "null"，路径也只是本机绝对路径）。直接引导走文件导出，不生成坏链接。
      if (!/^https?:$/.test(location.protocol)) {
        toast('当前以本地文件方式打开，生成的链接对方打不开。请改用「导出美化方案」把方案文件发给对方');
        return;
      }
      const full = collectBeautyFull();
      const data = {};
      Object.keys(full).forEach(k => {
        // #602：分享链接不带主题——主题归设置页管，导入不该把对方的深/浅色改掉
        if (k === '__theme__') return;
        // 大图（dataURL / 图片键）不带进链接；色值、百分比、预设名等小项照常带
        const v = full[k];
        const bigImg = typeof v === 'string' && v.indexOf('data:') === 0;
        // #602：图片组件清单 desk-images 必须跟图片本体一起剔除，否则对方导入后会得到一排空壳组件
        if (k === 'desk-images' || bigImg || (isBeautyImageKey(k) && typeof v === 'string' && v.length > 2048)) { return; }
        data[k] = v;
      });
      let json = JSON.stringify(data);
      let b64 = btoa(unescape(encodeURIComponent(json)));
      let url = location.origin + location.pathname + '#beauty=' + b64;
      if (url.length > SHARE_URL_MAX) {
        // 兜底：仍超长（极端配色数据/超长文本键）→ 明确失败，不生成会被截断的坏链接
        toast('这份美化太大，无法生成分享链接，请改用「导出美化方案」发文件');
        return;
      }
      // #602：链接只同步配色/尺寸等小项——不含图片（含图片组件），也不改对方主题，提示如实说明
      // 设置行副标题/功能介绍页已有完整说明，toast 只给最要紧的两句，避免手机上过长被截断
      const scopeNote = '只同步配色/尺寸/圆角/内置壁纸/布局等小项，不含图片，也不改对方深色模式';
      const longNote = url.length > SHARE_URL_WARN ? '；链接较长，个别聊天软件可能截断，若对方提示链接损坏请改用「导出美化方案」发文件' : '';
      const note = '分享链接已复制，发给对方打开即可导入（不含图片，也不改对方深色模式）' + longNote;
      // #602 优化：复制优先走 execCommand（无权限体系、不弹系统授权；部分安卓 WebView 上
      // navigator.clipboard.writeText 会拒绝甚至 Promise 悬空），失败再回退 clipboard API 并加 1.2s 超时。
      // 两条都失败时弹窗展示链接本体供长按复制——原实现给 openModal 传了 noInput:true，input 被隐藏，
      // 弹窗里根本没有链接可复制（提示「请手动复制下方链接」却看不到链接）。
      const copyFrom = (text) => new Promise((resolve) => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
          document.body.appendChild(ta);
          try { ta.select(); } catch (e) {}
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          setTimeout(() => { try { document.body.removeChild(ta); } catch (e) {} }, 800);
          if (ok) { resolve(true); return; }
        } catch (e) {}
        let done = false;
        const fin = (v) => { if (done) return; done = true; resolve(v); };
        try { setTimeout(() => fin(false), 1200); } catch (e) {}
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => fin(true), () => fin(false));
          else fin(false);
        } catch (e) { fin(false); }
      });
      const showShareLink = () => {
        if (!window.openModal) { toast('已生成链接（见控制台）'); try { console.log(url); } catch (e) {} return; }
        window.openModal('分享链接', '', () => {}, {
          noInput: true,
          staticText: '自动复制未成功，请长按下面的链接复制后发给对方：\n\n' + url + '\n\n' + scopeNote + longNote,
          copyBtn: { label: '复制链接', fn: function () { copyFrom(url).then((ok) => toast(ok ? '已复制到剪贴板' : '复制失败，请长按上面链接手动复制')); } }
        });
      };
      copyFrom(url).then((ok) => { if (ok) toast(note); else showShareLink(); });
    } catch (e) { toast('生成链接失败：' + ((e && e.message) || '未知原因')); }
  };
  const beautyShareRow = document.getElementById('row-beauty-share');
  if (beautyShareRow) beautyShareRow.addEventListener('click', shareBeautyLink);
  // 启动读 hash 自动弹导入分享方案
  // FIX 2026-09-16 #602：整段包进独立函数——原 return 会穿透到 personalize 外层 IIFE，
  // 遇到「用途不符 / 命中 0 项」的 #beauty= 链接时，其后所有初始化（主题开关绑定、预览浮条、
  // 页签、引导等）会被整段跳过，桌面美化相关功能集体不工作。包一层后 return 只结束本段。
  (function handleSharedBeauty() {
    if (!location.hash || location.hash.indexOf('#beauty=') !== 0) return;
    const cleanHash = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} };
    let data = null;
    try {
      // #602 加固：先做一次 percent 解码，兼容个别客户端把片段里的 + 编码成 %2B 导致 atob 崩
      const b64 = decodeURIComponent(location.hash.slice(8)).replace(/-/g, '+').replace(/_/g, '/');
      data = JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) {
      // #602：解不出来不再静默——最常见是链接被聊天软件/复制截断。明确告知并给出「导出文件」正路。
      cleanHash();
      const msg = '这条分享链接不完整或已损坏（多半被聊天软件截断了）。请让 TA 用「导出美化方案」把方案文件发给你，或重新发送完整链接。';
      if (window.openModal) window.openModal('分享链接无法读取', '', () => {}, { noInput: true, pillSubmit: true, staticText: msg, pills: [{ label: '知道了', value: 'ok' }] });
      else toast(msg);
      return;
    }
    // #602：分享链接不应用主题——即使旧链接/手改链接带了 __theme__ 也丢掉，避免悄悄改对方明暗
    if (data && typeof data === 'object') delete data['__theme__'];
    if (!window.openModal || typeof data !== 'object' || !data) return;
    // FIX 2026-09-15 #527：分享链接同样做用途校验 + 命中项数为 0 时不覆盖
    if (beautyKindMismatch(data)) { cleanHash(); return; }
    const shareHit = recognizeBeauty(data);
    if (!shareHit) { cleanHash(); toast('这条链接里没有可导入的桌面美化项'); return; }
    // #602：启动弹窗优先级——openModal 全站唯一、后开的覆盖先开的。延迟到「开屏收起 + 800ms 内
    // 没有任何弹窗」才弹导入提示，避免被首启引导 / 备份提醒等启动弹窗顶掉；30s 兜底防永不出现。
    let opened = false;
    const openImport = () => {
      if (opened) return; opened = true;
      const ctl = window.openModal('导入分享的美化方案？', '', (v) => {
        if (v !== 'ok') { cleanHash(); return; }
        try { pushBeautyUndo(); } catch (e) {}
        const applied = applyBeautyData(data, 'all');
        cleanHash();
        toast('已导入 ' + applied + ' 项，刷新生效');
        reloadAfterBeautyWrite();
      }, { noInput: true, pillSubmit: true, staticText: '从分享链接导入美化方案，将覆盖当前桌面美化（不含图片，也不会改动深色模式）', pills: [{ label: '导入', value: 'ok' }] });
      if (ctl && ctl.pills) ctl.pills([{ label: '导入', value: 'ok' }], 'ok');
    };
    let quietMs = 0;
    const timer = setInterval(() => {
      if (opened) { clearInterval(timer); return; }
      const splash = document.getElementById('splash');
      const splashGone = !splash || splash.classList.contains('hide') || splash.hidden;
      const mask = document.getElementById('modal-mask');
      const modalOpen = !!(mask && !mask.hidden);
      if (splashGone && !modalOpen) { quietMs += 250; if (quietMs >= 800) { clearInterval(timer); openImport(); } }
      else quietMs = 0;
    }, 250);
    setTimeout(() => { try { clearInterval(timer); openImport(); } catch (e) {} }, 30000);
  })();
  // v3.27.x：完整外观方案（项9）——桌面+聊天美化合并保存/应用，跨域用 window.collectChatBeauty/applyChatBeautyData
  const FULL_SCHEMES_KEY = 'full-beauty-schemes';
  const getFullSchemes = () => { try { const a = JSON.parse(gStore.get(FULL_SCHEMES_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const saveFullSchemesList = (arr) => { try { gStore.set(FULL_SCHEMES_KEY, JSON.stringify(arr)); } catch (e) {} };
  const collectFullBeauty = () => { const data = { desk: collectBeautyFull() }; try { if (window.collectChatBeauty) data.chat = window.collectChatBeauty(); } catch (e) {} return data; };
  const applyFullBeautyData = (data) => { try { applyBeautyData(data.desk || {}, 'all'); } catch (e) {} try { if (window.applyChatBeautyData && data.chat) window.applyChatBeautyData(data.chat); } catch (e) {} };
  const openFullBeautySchemes = () => {
    let m = document.getElementById('full-beauty-scheme-manager');
    if (!m) { m = document.createElement('div'); m.id = 'full-beauty-scheme-manager'; m.hidden = true; m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } }); }
    m.innerHTML = ''; m.hidden = false; m.style.display = 'flex';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    const head = document.createElement('div');
    head.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:4px">完整外观方案</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">桌面+聊天美化合并保存，一键切换完整外观</div>';
    box.appendChild(head);
    const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;flex:1;min-height:0';
    const schemes = getFullSchemes();
    if (!schemes.length) { const empty = document.createElement('div'); empty.innerHTML = '<div style="font-size:13px;color:var(--muted,#999);text-align:center;padding:20px 0">还没有保存的完整方案<br>先点下方「保存当前为完整方案」</div>'; list.appendChild(empty); }
    schemes.forEach((s, i) => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px';
      const t = new Date(s.time || Date.now()); const ds = (t.getMonth()+1) + '-' + t.getDate();
      row.innerHTML = '<div style="font-size:14px;font-weight:600">' + s.name + '</div><div style="font-size:11px;color:var(--muted,#999)">保存于 ' + ds + '</div>';
      const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap';
      const apply = document.createElement('button'); apply.textContent = '应用'; apply.style.cssText = 'font-size:12px;padding:4px 10px;border:none;border-radius:8px;background:var(--ink,#111);color:#fff';
      apply.addEventListener('click', () => {
        const ctl = window.openModal('应用完整方案「' + s.name + '」？', '', (v) => {
          if (v !== 'ok') return;
          try { pushBeautyUndo(); } catch (e) {}
          applyFullBeautyData(s.data || {});
          m.style.display = 'none'; m.hidden = true;
          toast('已应用「' + s.name + '」，刷新生效');
          reloadAfterBeautyWrite();
        }, { noInput: true, pillSubmit: true, staticText: '将覆盖当前桌面+聊天美化，刷新生效', pills: [{ label: '应用', value: 'ok' }] });
        if (ctl && ctl.pills) ctl.pills([{ label: '应用', value: 'ok' }], 'ok');
      });
      const del = document.createElement('button'); del.textContent = '删除'; del.style.cssText = 'font-size:12px;padding:4px 10px;border:1px solid rgba(163,45,45,.35);border-radius:8px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d)';
      del.addEventListener('click', () => { const l2 = getFullSchemes(); l2.splice(i, 1); saveFullSchemesList(l2); toast('已删除'); openFullBeautySchemes(); });
      btns.appendChild(apply); btns.appendChild(del); row.appendChild(btns); list.appendChild(row);
    });
    box.appendChild(list);
    const save = document.createElement('button'); save.textContent = '+ 保存当前为完整方案'; save.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--ink,#111);color:#fff;font-size:14px;font-weight:600';
    save.addEventListener('click', () => {
      if (!window.openModal) return;
      const ctl = window.openModal('保存完整方案', '', (name) => {
        name = (name || '').trim(); if (!name) { ctl.hint('名称不能为空'); ctl.stay(); return; }
        const l2 = getFullSchemes(); l2.push({ name, time: Date.now(), data: collectFullBeauty() }); saveFullSchemesList(l2);
        toast('已保存完整方案「' + name + '」'); openFullBeautySchemes();
      }, { maxlength: 20, placeholder: '例如：情侣粉全套' });
    });
    box.appendChild(save);
    const close = document.createElement('button'); close.textContent = '关闭'; close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
    close.addEventListener('click', () => { m.style.display = 'none'; m.hidden = true; });
    box.appendChild(close);
    m.appendChild(box);
  };
  const fullBeautySchemesRow = document.getElementById('row-full-beauty-schemes');
  if (fullBeautySchemesRow) fullBeautySchemesRow.addEventListener('click', openFullBeautySchemes);

  // ---- v3.25.x：桌面方案 预览 / 重命名（预览跨 reload 保持，可还原） ----
  const PREVIEW_BACKUP_KEY = 'beauty-preview-backup';
  const PREVIEW_NAME_KEY = 'beauty-preview-name';
  function mkBtn(label, css, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = css;
    b.addEventListener('click', fn);
    return b;
  }
  function beautyPreviewBarEl() {
    let bar = document.getElementById('beauty-preview-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'beauty-preview-bar';
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:96;margin:12px;padding:12px 14px;background:var(--card-bg,#fff);color:var(--ink,#111);border:1px solid var(--card-border,#eee);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;align-items:center;gap:10px';
      document.body.appendChild(bar);
    }
    return bar;
  }
  function desktopStartPreview(s, m) {
    if (!s) return;
    try {
      localStorage.setItem(PREVIEW_BACKUP_KEY, JSON.stringify({ data: collectBeautyFull() }));
      localStorage.setItem(PREVIEW_NAME_KEY, s.name);
    } catch (e) {}
    hideSchemeModal(m);
    applyBeautyData(s.data || {});
    toast('正在预览「' + s.name + '」…');
    setTimeout(() => location.reload(), 350);
  }
  function renameScheme(idx, m) {
    const list = getSchemes();
    const s = list[idx];
    if (!s || !window.openModal) return;
    const ctl = window.openModal('编辑方案名称', s.name, (name) => {
      name = (name || '').trim();
      if (!name) { ctl.hint('名称不能为空'); ctl.stay(); return; }
      s.name = name; saveSchemesList(list); toast('已重命名');
      window.openBeautySchemes();
    }, { maxlength: 20, placeholder: '输入方案名称' });
  }
  // 打开页面时若有进行中的预览，显示浮条（「使用」/「还原」）
  (function initBeautyPreview() {
    let backup = null, name = '';
    try { backup = JSON.parse(localStorage.getItem(PREVIEW_BACKUP_KEY) || 'null'); } catch (e) {}
    try { name = localStorage.getItem(PREVIEW_NAME_KEY) || ''; } catch (e) {}
    if (!backup || !backup.data || !name) return;
    const bar = beautyPreviewBarEl();
    bar.innerHTML = '';
    const tx = document.createElement('div'); tx.style.flex = '1'; tx.style.fontSize = '13px';
    tx.innerHTML = '正在预览「<b>' + name + '</b>」<div style="font-size:11px;color:var(--muted,#999)">点「使用」保存 / 「还原」恢复</div>';
    const clearP = () => { try { localStorage.removeItem(PREVIEW_BACKUP_KEY); localStorage.removeItem(PREVIEW_NAME_KEY); } catch (e) {} };
    const re = mkBtn('还原', 'font-size:12px;padding:6px 12px;border:1px solid var(--card-border,#eee);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => {
      clearP(); applyBeautyData(backup.data); bar.style.display = 'none'; toast('已还原'); setTimeout(() => location.reload(), 350);
    });
    const keep = mkBtn('使用这个方案', 'font-size:12px;padding:6px 12px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => {
      clearP(); bar.style.display = 'none'; toast('已应用「' + name + '」');
    });
    bar.appendChild(tx); bar.appendChild(re); bar.appendChild(keep);
    bar.style.display = 'flex';
  })();

  // 手机桌面美化页：顶部标签切换分区（颜色/尺寸/背景/图标/方案），互斥显示
  (function initThemeTabs() {
    const tabsEl = document.getElementById('them-tabs');
    const page = document.getElementById('page-theme');
    if (!tabsEl || !page) return;
    const tabs = tabsEl.querySelectorAll('.them-tab');
    const secs = page.querySelectorAll('.them-sec');
    function show(name) {
      secs.forEach(s => { s.hidden = (s.dataset.sec !== name); });
      tabs.forEach(t => { t.classList.toggle('active', t.dataset.tab === name); });
    }
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    // 默认显示第一个省区（颜色）
    show(tabs[0] ? tabs[0].dataset.tab : 'color');
  })();

  // 设置页：顶部 tag 分类（通用/聊天/系统/工具/关于），互斥显示，默认第一个
  (function initSettingsTabs() {
    const tabsEl = document.getElementById('set-tabs');
    const page = document.getElementById('page-setting');
    if (!tabsEl || !page) return;
    const tabs = tabsEl.querySelectorAll('.them-tab');
    const secs = page.querySelectorAll('.them-sec');
    function show(name) {
      secs.forEach(s => { s.hidden = (s.dataset.sec !== name); });
      tabs.forEach(t => { t.classList.toggle('active', t.dataset.tab === name); });
    }
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    show(tabs[0] ? tabs[0].dataset.tab : 'basic');
  })();

  // ===== 设置页「本机能不能用」标记（v8.29 #978）：按真实前提标记，不按手机系统 =====
  // 沿革：用户先问「设置里好多 iOS / 安卓专属功能，要不要单独分一类」→ 结论不分类、改行级标记
  // （#964）；随后用户指出两处静态胶囊都误导——「后台通知」行右的「仅安卓」与「顶部避让修正」
  // 行的「仅 iPhone」。实测三条胶囊的真实前提没有一条是「手机系统」：
  //   后台通知   = Chromium 内核 + https + 通知权限（电脑版 Chrome / Edge 同样可用；而小米 /
  //                vivo / OPPO 自带、UC、夸克、Via 这些安卓壳本机没有 Notification 对象）
  //   离线消息提醒 = Chromium 内核（PeriodicSyncManager）+ 添加到主屏幕（电脑版 Chrome 也可以）
  //   顶部避让修正 = 添加到主屏幕的独立应用形态 + 用户自己声明形态（执行器 forceCover 的
  //                standalone 就是 ios-pwa-standalone 类，只在 iOS 独立应用形态加；iPhone 用
  //                Safari 直接打开时这个开关是空的，开了不生效）
  // 静态胶囊把「平台」当成门槛，两个方向都错：桌面 Chromium 用户被「仅安卓」劝退（其实能用），
  // iPhone 浏览器形态用户被「仅 iPhone」叫去开一个空开关。故撤掉静态胶囊，改为按本机实测条件
  // 标记：不满足条件才变灰 + 给替代入口，满足条件不加任何标记。判定保守口径不变（判定不明 /
  // 桌面 / UA 伪装一律不误伤），且只变灰、绝不 disabled 开关——识别失手的用户必须仍能点到
  // 唯一能修好自己问题的开关。
  (function initUseMark() {
    const page = document.getElementById('page-setting');
    if (!page) return;
    const d = window.mochiDevice || {};
    const isIOS = function () { return d.isIOS === true; };
    // 本机有没有网页通知能力（Chromium 只在 https / localhost 才暴露 Notification 对象）
    const hasNotify = function () { try { return 'Notification' in window; } catch (e) { return false; } };
    // 是不是「添加到主屏幕后的独立应用形态」——与 fullscreen.js 加 ios-pwa-standalone 类同口径
    // （fullscreen.js 在 personalize.js 之后加载，故先读类、读不到再按同式自算）
    const isIosStandalone = function () {
      if (!isIOS()) return false;
      if (document.documentElement.classList.contains('ios-pwa-standalone')) return true;
      try {
        return navigator.standalone === true ||
          !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      } catch (e) { return false; }
    };
    // 每行一个判定器：返回 null＝本机可用（不加任何标记）；返回 { text, go? }＝本机用不了，
    // 变灰 + 替代指引。key 取该行开关 input 的 id。
    const RULES = [
      { input: 'bg-notify', off: function () {
        if (isIOS()) return { text: '本机是 iPhone / iPad：网页拿不到系统通知（添加到主屏幕也不保证），请改用应用内横幅「桌面消息弹窗」。', go: '#desk-msg-en', goText: '去开启' };
        if (!hasNotify()) return { text: '本机浏览器没有通知能力（小米 / vivo / OPPO 等自带浏览器、UC、夸克常见如此）：请改用 Chrome / Edge 打开本站，安卓或电脑都行。' };
        return null;
      } },
      { input: 'safe-top-force', off: function () {
        if (isIosStandalone()) return null; // 本机就是它要修的形态
        if (isIOS()) return { text: '本项只在「添加到主屏幕」后打开（独立应用形态）才生效：浏览器里直接打开时开关无效果，顶部遮挡 / 底部裁切请用「屏幕适配微调」。', go: '#row-screen-adj', goText: '去调整' };
        return { text: '本项只修 iPhone / iPad 独立应用形态的顶部避让（安卓没有这个形态）：安卓要调顶部遮挡 / 底部裁切请用「屏幕适配微调」。', go: '#row-screen-adj', goText: '去调整' };
      } }
    ];
    function jumpTo(sel) {
      const target = document.querySelector(sel);
      if (!target) return;
      const row = (target.closest && target.closest('.set-row, .gs-row')) || target;
      // 搜索态下目标行可能正被过滤隐藏：先清空搜索框（回到原分区），再切 tag + 滚到现场
      const si = document.getElementById('set-search-input');
      if (si && si.value) {
        si.value = '';
        try { si.dispatchEvent(new Event('input')); } catch (e) {}
      }
      const sec = row.closest ? row.closest('.them-sec') : null;
      if (sec && sec.hidden) {
        const tab = document.querySelector('#set-tabs .them-tab[data-tab="' + (sec.dataset.sec || '') + '"]');
        if (tab) tab.click();
      }
      try { row.scrollIntoView({ block: 'center' }); } catch (e) {}
      row.classList.add('plat-flash');
      setTimeout(function () { row.classList.remove('plat-flash'); }, 1500);
    }
    RULES.forEach(function (rule) {
      const inp = document.getElementById(rule.input);
      if (!inp) return;
      const row = inp.closest('.set-row, .gs-row');
      if (!row) return;
      let alt = null;
      try { alt = rule.off(); } catch (e) { alt = null; }
      if (!alt) return;
      row.classList.add('plat-off');
      const hint = document.createElement('div');
      hint.className = 'gs-sub plat-hint';
      hint.textContent = alt.text;
      if (alt.go) {
        const go = document.createElement('span');
        go.className = 'plat-go';
        go.setAttribute('role', 'button');
        go.setAttribute('tabindex', '0');
        go.textContent = alt.goText || '去设置';
        const fire = function (e) { if (e) { e.preventDefault(); e.stopPropagation(); } jumpTo(alt.go); };
        go.addEventListener('click', fire);
        go.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') fire(e); });
        hint.appendChild(go);
      }
      // #978：提示插在该行【紧后面】。原 #964 是插在该行下面所有 .gs-sub 说明之后——「后台通知」
      // 那行的说明有六百多字，替代入口被压在整段说明底下，本机用不了的用户根本看不到该点哪里。
      if (row.parentNode) row.parentNode.insertBefore(hint, row.nextSibling);
    });
  })();

  // ===== 设置 → 关于 → 帮助与支持：使用说明页导航 + 页内搜索（#row-guide → #page-guide；说明内容静态在 template.html） =====
  (function initGuideNav() {
    const page = document.getElementById('page-guide');
    const row = document.getElementById('row-guide');
    if (row) {
      row.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
        if (page) {
          page.hidden = false;
          try { const sc = page.querySelector('.cal-scroll'); if (sc) sc.scrollTop = 0; } catch (e) {}
        }
      });
    }
    const back = document.getElementById('guide-back');
    if (back) {
      back.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
        const setPage = document.getElementById('page-setting');
        if (setPage) setPage.hidden = false;
      });
    }
    // ---- 页内搜索：跨分组过滤条目；组标题命中则整组显示，命中组自动展开、未命中组隐藏 ----
    const input = document.getElementById('guide-search');
    if (!page || !input) return;
    const hero = document.getElementById('guide-hero');
    const empty = document.getElementById('guide-empty');
    const groups = Array.prototype.slice.call(page.querySelectorAll('.lic-grp'));
    const baseOpen = groups.map(g => !!g.open); // 记原始展开态（首个默认 open）
    function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
    function apply() {
      const q = norm(input.value);
      if (!q) {
        if (hero) hero.hidden = false;
        if (empty) empty.hidden = true;
        groups.forEach((g, i) => {
          g.hidden = false;
          g.open = baseOpen[i];
          Array.prototype.forEach.call(g.querySelectorAll('.lic-li'), li => { li.style.display = ''; });
        });
        return;
      }
      if (hero) hero.hidden = true;
      let hits = 0;
      groups.forEach(g => {
        const nameEl = g.querySelector('.lg-name');
        const titleHit = norm(nameEl && nameEl.textContent).indexOf(q) >= 0;
        let gHit = 0;
        Array.prototype.forEach.call(g.querySelectorAll('.lic-li'), li => {
          const show = titleHit || norm(li.textContent).indexOf(q) >= 0;
          li.style.display = show ? '' : 'none';
          if (show) gHit++;
        });
        g.hidden = gHit === 0;
        if (gHit > 0) { g.open = true; hits += gHit; }
      });
      if (empty) empty.hidden = hits > 0;
    }
    input.addEventListener('input', apply);
    apply();
  })();

  // ===== v3.6.x：深色模式 · v3.27.x：三档（浅色/深色/跟随系统） =====
  // 全局设置（不按联系人隔离），存储键 xy-home-v2:theme-mode，取值 light/dark/auto
  // 切换时在 <html> 上设 data-theme 属性，base.css [data-theme=dark] + dark.css 覆盖
  // auto 档读 prefers-color-scheme 并监听变化；旧值 light/dark 完全兼容
  const THEME_KEY = 'xy-home-v2:theme-mode';
  const themeModeRow = document.getElementById('row-theme-mode');
  const themeModeVal = document.getElementById('theme-mode-val');
  const getThemeMode = () => { try { const v = localStorage.getItem(THEME_KEY); return (v === 'dark' || v === 'auto') ? v : 'light'; } catch (e) { return 'light'; } };
  const sysPrefersDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const applyThemeMode = (mode) => {
    const eff = (mode === 'auto') ? (sysPrefersDark() ? 'dark' : 'light') : mode;
    // #252：浅色档显式移除属性而非依赖"本来就没有"——旧版本/残留 DOM 的 data-theme
    // 会让用户选浅色后界面仍停留深色（属性在=dark.css 全量生效）
    if (eff === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    if (themeModeVal) themeModeVal.textContent = mode === 'auto' ? '跟随系统' : (mode === 'dark' ? '已开启' : '关闭');
    // #201 浏览器顶部黑边：安卓 Edge/Chromium 用 theme-color 涂页面外的系统区域（页面下移避让形态顶部那 41px），
    // 写死深色在浅色主题下就是一条黑边——这里跟随当前生效主题的 --page-bg 同步刷新
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim();
      const meta = document.querySelector('meta[name="theme-color"]');
      if (bg && meta) meta.setAttribute('content', bg);
    } catch (e) {}
  };
  applyThemeMode(getThemeMode());
  // v3.27.x：auto 档跟随系统——系统主题变化时仅当用户选 auto 才重算，避免覆盖手动选择
  try {
    const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mql && typeof mql.addEventListener === 'function') mql.addEventListener('change', () => { if (getThemeMode() === 'auto') applyThemeMode('auto'); });
    else if (mql && typeof mql.addListener === 'function') mql.addListener(() => { if (getThemeMode() === 'auto') applyThemeMode('auto'); });
  } catch (e) {}
  if (themeModeRow) {
    themeModeRow.addEventListener('click', () => {
      if (!window.openModal) {
        // 兜底：openModal 不可用时回退原两档快速切换
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
        applyThemeMode(next);
        return;
      }
      const cur = getThemeMode();
      const threePills = [
        { label: '跟随系统', value: 'auto' },
        { label: '浅色', value: 'light' },
        { label: '深色', value: 'dark' },
      ];
      const ctl = window.openModal('深色模式', '', (v) => {
        if (v !== 'auto' && v !== 'light' && v !== 'dark') return;
        try { localStorage.setItem(THEME_KEY, v); } catch (e) {}
        applyThemeMode(v);
      }, { noInput: true, pillSubmit: true, pill: cur, pills: threePills, staticText: '选择主题模式：跟随系统会按设备深色设置自动切换' });
      if (ctl && ctl.pills) ctl.pills(threePills, cur);
    });
  }

  // ===== v3.6.x：主题色（全局，覆盖按钮/激活态颜色） =====
  const ACCENT_KEY = 'xy-home-v2:accent-color';
  // v3.27.x：手输色值通用弹窗——部分手机（厂商内置浏览器 / APP 内嵌 WebView / 旧内核）
  // 不支持或打不开 <input type=color> 原生取色器，表现为「点自定义颜色没反应 / 颜色块
  // 看不见也调不了」。原生取色器是否可用无法可靠探测（type 属性存在≠能弹窗），所以
  // 手动输入 #RRGGBB 必须作为常驻兜底入口，而不是探测失败才出现。
  const openHexColorModal = (title, cur, apply) => {
    if (!window.openModal) return;
    const ctl = window.openModal(title, (cur || '').toUpperCase(), (v) => {
      let c = (v || '').trim().toLowerCase();
      if (c && c.charAt(0) !== '#') c = '#' + c; // 容错：允许不带 # 直接输 6 位
      if (!/^#[0-9a-f]{6}$/.test(c)) { ctl.hint('格式不对：# + 6 位十六进制（0-9 / a-f），如 #e05555'); ctl.stay(); return; }
      apply(c);
    }, { maxlength: 7, placeholder: '#RRGGBB，如 #e05555' });
  };
  // v3.27.x 优化③：从壁纸取主色做主题色——对不会查色值的用户，比手输 #RRGGBB 友好。
  // 24×24 降采样 + 4bit/通道桶计数，按「出现次数 × 饱和度」挑主色桶（纯平均会得到灰蒙蒙
  // 的杂色，饱和度加权让彩色区域胜出）；接近纯白/纯黑的像素不参与（跳过留白和暗角）。
  function sampleWallpaperColor(dataUrl) {
    return new Promise((resolve) => {
      if (typeof dataUrl !== 'string' || dataUrl.length > 50 * 1024 * 1024) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const N = 24;
          const c = document.createElement('canvas'); c.width = N; c.height = N;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, N, N);
          const d = ctx.getImageData(0, 0, N, N).data;
          const buckets = {};
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            if (mx > 250 && mn > 235) continue; // 纯白留白
            if (mx < 18) continue;              // 纯黑暗角
            const sat = mx === 0 ? 0 : (mx - mn) / mx;
            const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            if (!buckets[key]) buckets[key] = { n: 0, r: 0, g: 0, b: 0, sat: 0 };
            const bk = buckets[key];
            bk.n++; bk.r += r; bk.g += g; bk.b += b; bk.sat += sat;
          }
          let best = null, bestScore = 0;
          Object.keys(buckets).forEach((k) => {
            const bk = buckets[k];
            const score = bk.n * (0.25 + bk.sat / bk.n);
            if (score > bestScore) { bestScore = score; best = bk; }
          });
          if (!best) { resolve(null); return; }
          const hx = (v) => ('0' + Math.round(v).toString(16)).slice(-2);
          resolve('#' + hx(best.r / best.n) + hx(best.g / best.n) + hx(best.b / best.n));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  const applyAccentFromWallpaper = () => {
    const src = store.get('phone-bg') || store.get('cs-bg'); // 优先桌面壁纸，其次聊天壁纸
    if (!src) { toast('请先在桌面美化或聊天美化里设置一张壁纸'); return; }
    toast('正在从壁纸取色…');
    sampleWallpaperColor(src).then((c) => {
      if (!c || !/^#[0-9a-fA-F]{6}$/.test(c)) { toast('取色失败，请改用「手动输入色值」'); return; }
      try { localStorage.setItem(ACCENT_KEY, c); } catch (e) {}
      applyAccentColor(c);
      toast('已从壁纸取色 ' + c.toUpperCase() + '（不满意可再点色块微调）');
    });
  };
  const accentRow = document.getElementById('row-accent-color');
  const accentVal = document.getElementById('accent-color-val');
  const ACCENT_PRESETS = [
    { color: '#111111', label: '经典黑' },
    { color: '#e05555', label: '珊瑚红' },
    { color: '#e8753a', label: '暖橘' },
    { color: '#f0a020', label: '琥珀金' },
    { color: '#4a9d5e', label: '森绿' },
    { color: '#3a7bd5', label: '天蓝' },
    { color: '#7b5fd6', label: '紫罗兰' },
    { color: '#d6459d', label: '玫红' },
  ];
  const accentLuminance = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const getAccentColor = () => { try { return localStorage.getItem(ACCENT_KEY) || ''; } catch (e) { return ''; } };
  const applyAccentColor = (color) => {
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
      document.documentElement.style.setProperty('--btn-bg', color);
      document.documentElement.style.setProperty('--btn-ink', accentLuminance(color) > 0.55 ? '#111111' : '#ffffff');
      if (accentVal) accentVal.textContent = color.toUpperCase() === '#111111' ? '默认' : '已设置';
    } else {
      document.documentElement.style.removeProperty('--btn-bg');
      document.documentElement.style.removeProperty('--btn-ink');
      if (accentVal) accentVal.textContent = '默认';
    }
  };
  applyAccentColor(getAccentColor());
  if (accentRow) {
    accentRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = getAccentColor();
      window.openModal('主题色', '', (v) => {
        if (v === '__reset__') { try { localStorage.removeItem(ACCENT_KEY); } catch (e) {} applyAccentColor(''); return; }
        // v3.27.x 优化③：从壁纸取主色一键应用（先桌面壁纸，其次聊天壁纸）
        if (v === '__pick_wall__') { applyAccentFromWallpaper(); return; }
        // v3.27.x：手输色值入口——二级弹窗输入 #RRGGBB（取色器打不开的手机靠这个）
        if (v === '__hex__') {
          openHexColorModal('手动输入主题色', current || '#e05555', (c) => {
            try { localStorage.setItem(ACCENT_KEY, c); } catch (e) {}
            applyAccentColor(c);
            toast('主题色已设置 ' + c.toUpperCase());
          });
          return;
        }
        const color = (typeof v === 'number' && ACCENT_PRESETS[v]) ? ACCENT_PRESETS[v].color : v;
        if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
        try { localStorage.setItem(ACCENT_KEY, color); } catch (e) {}
        applyAccentColor(color);
      }, {
        noInput: true,
        colorPicker: true,
        color: current,
        swatches: ACCENT_PRESETS,
        // v3.27.x：详细说明——预置色块任何手机都能用；系统取色器部分手机弹不出来
        staticText: '点色块=一键选用，最简单可靠。「从壁纸取色」自动挑壁纸主色配成主题色。「自定义颜色」调起手机系统取色器，部分手机（内置浏览器/APP内打开）不支持、点了没反应——请改用「手动输入色值」，填 6 位色值如 #e05555（网上搜「颜色代码」可查任意颜色的色值）。',
        pills: [
          { label: '从壁纸取色', value: '__pick_wall__' },
          { label: '手动输入色值', value: '__hex__' },
          { label: '恢复默认', value: '__reset__' },
        ],
      });
    });
  }

  // FIX 2026-09-16 #562：美化页每个颜色行补一个可见的「默认」按钮（用户报「桌面美化的所有颜色，
  // 没有恢复默认颜色的按钮」——此前只有「点行→开弹窗→点弹窗里的『恢复默认』pill」这条隐藏路径，
  // 行上没有可见入口）。点它就地恢复该项：删键 + 摘内联 CSS 变量（回落主题/深色模式的默认值）。
  (function bindBeautyColorResets() {
    const rows = [
      ['row-accent-color', () => { try { localStorage.removeItem(ACCENT_KEY); } catch (e) {} applyAccentColor(''); }],
      ['row-widget-color', () => { store.remove('widget-bg-color'); document.documentElement.style.removeProperty('--widget-bg'); paintBeautyVal(widgetColorVal, '', '#ffffff', '默认白'); }],
      ['row-widget-border', () => { store.remove('widget-border-color'); document.documentElement.style.removeProperty('--widget-border'); paintBeautyVal(widgetBorderVal, '', 'rgba(0,0,0,.1)', '默认'); }],
      ['row-widget-btn', () => { store.remove('widget-btn-color'); document.documentElement.style.removeProperty('--widget-btn'); paintBeautyVal(widgetBtnVal, '', '#111111', '默认黑'); }],
      ['row-widget-btn-text', () => { store.remove('widget-btn-text-color'); document.documentElement.style.removeProperty('--widget-btn-text'); paintBeautyVal(widgetBtnTextVal, '', '#ffffff', '默认白'); }],
      ['row-app-name-color', () => { store.remove(APP_NAME_COLOR_KEY); applyAppNameColor(); }],
      ['row-widget-heart', () => { store.remove('widget-heart-color'); document.documentElement.style.removeProperty('--widget-heart'); paintBeautyVal(widgetHeartVal, '', '#111111', '默认黑'); }]
    ];
    rows.forEach(function (pair) {
      const row = document.getElementById(pair[0]);
      if (!row || row.querySelector('.bfy-reset-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bfy-reset-btn';
      btn.textContent = '默认';
      btn.title = '恢复该项默认颜色';
      btn.style.cssText = 'flex:none;margin-left:8px;padding:3px 9px;font-size:11px;line-height:1.4;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--muted,#888);cursor:pointer';
      btn.addEventListener('click', function (e) {
        e.stopPropagation(); // 别触发该行的弹窗
        try { pair[1](); } catch (err) {}
        try { if (typeof toast === 'function') toast('已恢复默认'); } catch (err) {}
      });
      row.appendChild(btn);
    });
  })();

  // ===== v3.27.x：全局字体（桌面美化快捷入口，与聊天设置「全局字体」互通同一功能） =====
  // 复用 chat-settings.js 的存储键 'cs-font' + 同款 applyFont 逻辑（@font-face 注入 / body+html font-family），
  // 两边任一改动写同一键、应用同一全局 DOM，天然互通。applyDeskCsFont 与 chat-settings 的 applyFont 都
  // 先 remove id="cs-font-style" 再注入，幂等可重复调用。
  // v3.26.x #628：字体按桌面各存各的（每个联系人可各自排版），面板里新增「同步到全部桌面」按钮——
  //   用户报「上传字体，无法应用到全部桌面」，缺的就是这一步。同步实现只有一份（chat-settings.js
  //   暴露的 window.csFontSyncAllDesks），本文件的按钮调用它，避免两处逻辑漂移。
  const deskCsFontRow = document.getElementById('row-desk-cs-font');
  const deskCsFontVal = document.getElementById('desk-cs-font-val');
  const CS_FONT_KEY = 'cs-font';
  const deskCsFontValOf = () => { try { return store.get(CS_FONT_KEY) || ''; } catch (e) { return ''; } };
  // #642：cs-font 现在存的是「轻量引用 @@font:<hash>」，真身在全局唯一下载键里——
  //   展示/应用前先展开；blob 未就绪（大键等 IDB 回填）时按空处理，chat-settings 侧的
  //   异步补读落地后会广播 cs-font-changed，这里跟着重渲染。
  function deskCsFontResolved() {
    const v = deskCsFontValOf();
    if (v.indexOf('@@font:') !== 0) return v;
    try { return window.xyStore('xy-home-v2').get('font-blob-' + v.slice(7)) || ''; } catch (e) { return ''; }
  }
  // #894：keepPending=true（启动/contact-switched 路径）时，引用形态但 blob 未就绪（同步读空）
  //   【不清除】已注入字体——弱内核补读挂起期间切桌面，旧逻辑按空值拆 @font-face＝字体应用消失；
  //   补读落地会广播 cs-font-changed 再校正。false（广播路径）读空＝补读已终局且确认读不到
  //   （成功落地必已回填 memoryCache 可同步读到），照常清除。
  function applyDeskCsFont(keepPending) {
    const v = deskCsFontResolved();
    const raw = deskCsFontValOf();
    if (deskCsFontVal) deskCsFontVal.textContent = raw ? ((raw.indexOf('data:') === 0 || raw.indexOf('@@font:') === 0) ? '已上传' : raw) : '默认';
    if (!v && raw.indexOf('@@font:') === 0 && keepPending) return;
    // 同一个值已在位就不再重注入（dataURL 字体可达 MB 级，切桌面/回填兜底都会调到这里）
    const old = document.getElementById('cs-font-style');
    if (old && old.__fontVal === v) return;
    if (old) old.remove();
    if (!v) {
      if (document.body.style.fontFamily || document.documentElement.style.fontFamily) {
        document.body.style.fontFamily = '';
        document.documentElement.style.fontFamily = '';
      }
      return;
    }
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
    document.body.style.fontFamily = '"' + v + '",sans-serif';
    document.documentElement.style.fontFamily = '"' + v + '",sans-serif';
  }
  // 与聊天设置那侧互相回显（cs-font-changed 广播；本函数不广播，避免两边成环）
  document.addEventListener('cs-font-changed', () => applyDeskCsFont(false));
  applyDeskCsFont(true);
  if (deskCsFontRow) {
    deskCsFontRow.addEventListener('click', () => {
      if (!window.openTCPanel) return;
      const cur = deskCsFontValOf();
      // #642：引用值（@@font:）不回填到字体名输入框（它不是字体名）
      const curName = (cur && cur.indexOf('@@font:') === 0) ? '' : cur;
      window.openTCPanel('全局字体', '' +
        '<div class="sm-fld"><label>上传本地字体（ttf / otf / woff / woff2），应用后本桌面全部页面生效</label>' +
        '<input class="tc-input" id="cs-font-name" placeholder="也可直接输入字体名或链接，如 Microsoft YaHei"' + (curName && curName.indexOf('data:') !== 0 && curName.indexOf('http') !== 0 ? ' value="' + String(curName).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"' : '') + '></div>' +
        '<div class="mail-actions"><button class="cc-tool" id="cs-font-upload">上传字体</button><button class="cc-tool" id="cs-font-clear">恢复默认</button><button class="cc-tool" id="cs-font-ok">应用</button></div>' +
        // #628：其它桌面也要用同一个字体时点这颗同步（走 chat-settings.js 同一份实现），不必逐个桌面重传
        '<div class="sm-fld" style="margin-top:10px"><label>其它桌面也要用这个字体？</label>' +
        '<button id="cs-font-sync" style="width:100%;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px">同步到全部桌面</button></div>');
      document.getElementById('cs-font-upload').addEventListener('click', () => {
        // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
        window.mochiFilePick({
          id: 'mochi-deskcs-font-pick', accept: '.ttf,.otf,.woff,.woff2',
          onFiles: (files) => {
          const f = files && files[0];
          if (!f) { toast('没有取到字体文件，请再选一次'); return; }
          toast('正在读取字体文件…');
          const reader = new FileReader();
          reader.onload = () => {
            if (window.csFontStoreData) window.csFontStoreData(reader.result); // #642：全局唯一份 + 引用
            else store.set(CS_FONT_KEY, reader.result);
            document.getElementById('tc-mask').hidden = true;
            applyDeskCsFont();
            try { document.dispatchEvent(new Event('cs-font-changed')); } catch (e) {}
            toast('字体已应用到本桌面');
          };
          reader.onerror = () => { toast('字体文件读取失败，请重试'); };
          reader.readAsDataURL(f);
          }
        });
      });
      document.getElementById('cs-font-sync').addEventListener('click', () => {
        if (window.csFontSyncAllDesks) window.csFontSyncAllDesks();
        else toast('同步入口未就绪，请稍后重试');
      });
      document.getElementById('cs-font-clear').addEventListener('click', () => {
        try { store.remove(CS_FONT_KEY); } catch (e) {}
        document.getElementById('tc-mask').hidden = true;
        applyDeskCsFont();
        try { document.dispatchEvent(new Event('cs-font-changed')); } catch (e) {}
        toast('已恢复默认字体');
      });
      document.getElementById('cs-font-ok').addEventListener('click', () => {
        const name = (document.getElementById('cs-font-name').value || '').trim();
        if (!name) { toast('请输入字体名或链接'); return; }
        if (/^https?:\/\/.+\.(ttf|otf|woff|woff2)$/i.test(name)) {
          toast('正在下载字体，请稍候…');
          fetch(name, { mode: 'cors' }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
          }).then(blob => {
            const rd = new FileReader();
            rd.onload = () => {
              if (window.csFontStoreData) window.csFontStoreData(rd.result); // #642：全局唯一份 + 引用
              else store.set(CS_FONT_KEY, rd.result);
              document.getElementById('tc-mask').hidden = true;
              applyDeskCsFont();
              try { document.dispatchEvent(new Event('cs-font-changed')); } catch (e) {}
              toast('字体下载并应用成功');
            };
            rd.onerror = () => {
              store.set(CS_FONT_KEY, name);
              document.getElementById('tc-mask').hidden = true;
              applyDeskCsFont();
              try { document.dispatchEvent(new Event('cs-font-changed')); } catch (e) {}
              toast('字体读取失败，已按字体名应用');
            };
            rd.readAsDataURL(blob);
          }).catch(() => {
            store.set(CS_FONT_KEY, name);
            document.getElementById('tc-mask').hidden = true;
            applyDeskCsFont();
            try { document.dispatchEvent(new Event('cs-font-changed')); } catch (e) {}
            toast('链接下载失败，已按字体名应用');
          });
          return;
        }
        store.set(CS_FONT_KEY, name);
        document.getElementById('tc-mask').hidden = true;
        applyDeskCsFont();
        try { document.dispatchEvent(new Event('cs-font-changed')); } catch (e) {}
        toast('字体已应用到本桌面');
      });
    });
  }
  document.addEventListener('contact-switched', () => applyDeskCsFont(true));

  // ===== v3.6.x：桌面字号（滑块 85~120%，默认 100%） =====
  // FIX 2026-09-17 #707：桌面缩放类门控（单点实现，所有写值路径都要调它）——只有
  // 「宽窗(>901px) 且非平板 且 缩放值≠1」才给 <html> 挂 desk-zoom-font / desk-zoom-card，
  // home.css 里带这两个前缀的 zoom 声明才真正存在；其余形态（手机/平板/默认值）零
  // zoom 声明。背景：Safari 18.2 起 WebKit 重写 zoom（标准化实现），官方自述该实现
  // 「genuinely tricky」、26.4 仍在修其性能/继承缺陷，而 zoom:1 的声明本身就会让整个
  // 桌面子树常年进 zoom 继承/布局路径（iOS 卡顿红线；真机 iPhone15ProMax 报「全局
  // 滑动卡顿 + 翻页灰屏」，诊断 html 类带 tablet＝伪装 UA 误判走了非主流布局）。
  // 视觉语义与旧版完全一致：旧版手机端 zoom 恒被 CSS 兜成 1（声明仍在、值被钉死）。
  function syncDeskZoomClass() {
    try {
      const d = document.documentElement;
      const wide = !!(window.matchMedia && window.matchMedia('(min-width: 901px)').matches);
      const tab = !!(window.mochiDevice && window.mochiDevice.isTablet);
      const fs = parseFloat(d.style.getPropertyValue('--desk-font-scale'));
      const cs = parseFloat(d.style.getPropertyValue('--desk-card-scale'));
      const onF = wide && !tab && fs > 0 && Math.abs(fs - 1) > 0.001;
      const onC = wide && !tab && cs > 0 && Math.abs(cs - 1) > 0.001;
      if (onF !== d.classList.contains('desk-zoom-font')) d.classList.toggle('desk-zoom-font', onF);
      if (onC !== d.classList.contains('desk-zoom-card')) d.classList.toggle('desk-zoom-card', onC);
    } catch (e) {}
  }
  const deskFontRow = document.getElementById('row-desk-font-size');
  const deskFontVal = document.getElementById('desk-font-size-val');
  const DESK_FONT_DEFAULT = 100;
  const getDeskFontPct = () => {
    const v = store.get('desk-font-size');
    if (v !== null && v !== undefined && v !== '') { const n = parseInt(v, 10); if (!isNaN(n)) return Math.max(85, Math.min(120, n)); }
    return DESK_FONT_DEFAULT;
  };
  const applyDeskFontPct = (pct) => {
    document.documentElement.style.setProperty('--desk-font-scale', String(pct / 100));
    if (deskFontVal) deskFontVal.textContent = pct === DESK_FONT_DEFAULT ? '默认' : pct + '%';
    syncDeskZoomClass();
  };
  applyDeskFontPct(getDeskFontPct());
  if (deskFontRow) {
    const syncDeskFontUI = () => { const pct = getDeskFontPct(); if (deskFontVal) deskFontVal.textContent = pct === DESK_FONT_DEFAULT ? '默认' : pct + '%'; };
    syncDeskFontUI();
    deskFontRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = getDeskFontPct();
      window.openModal('桌面字号', '', (v) => {
        if (v === '__reset__') { store.remove('desk-font-size'); applyDeskFontPct(DESK_FONT_DEFAULT); syncDeskFontUI(); return; }
        const pct = parseInt(v, 10); if (isNaN(pct)) return;
        store.set('desk-font-size', String(pct)); applyDeskFontPct(pct); syncDeskFontUI();
      }, {
        noInput: true,
        slider: { min: 85, max: 120, step: 1, value: current, label: '拖动调整桌面字号', unit: '%',
          onChange: (val) => { document.documentElement.style.setProperty('--desk-font-scale', String(val / 100)); syncDeskZoomClass(); } },
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // ===== v3.6.x：卡片大小（滑块 80~120%，默认 100%） =====
  const deskCardRow = document.getElementById('row-desk-card-scale');
  const deskCardVal = document.getElementById('desk-card-scale-val');
  const DESK_CARD_DEFAULT = 100;
  const getDeskCardPct = () => {
    const v = store.get('desk-card-scale');
    if (v !== null && v !== undefined && v !== '') { const n = parseInt(v, 10); if (!isNaN(n)) return Math.max(80, Math.min(120, n)); }
    return DESK_CARD_DEFAULT;
  };
  const applyDeskCardPct = (pct) => {
    document.documentElement.style.setProperty('--desk-card-scale', String(pct / 100));
    if (deskCardVal) deskCardVal.textContent = pct === DESK_CARD_DEFAULT ? '默认' : pct + '%';
    syncDeskZoomClass();
  };
  applyDeskCardPct(getDeskCardPct());
  if (deskCardRow) {
    const syncDeskCardUI = () => { const pct = getDeskCardPct(); if (deskCardVal) deskCardVal.textContent = pct === DESK_CARD_DEFAULT ? '默认' : pct + '%'; };
    syncDeskCardUI();
    deskCardRow.addEventListener('click', () => {
      if (!window.openModal) return;
      const current = getDeskCardPct();
      window.openModal('卡片大小', '', (v) => {
        if (v === '__reset__') { store.remove('desk-card-scale'); applyDeskCardPct(DESK_CARD_DEFAULT); syncDeskCardUI(); return; }
        const pct = parseInt(v, 10); if (isNaN(pct)) return;
        store.set('desk-card-scale', String(pct)); applyDeskCardPct(pct); syncDeskCardUI();
      }, {
        noInput: true,
        slider: { min: 80, max: 120, step: 1, value: current, label: '拖动调整卡片大小', unit: '%',
          onChange: (val) => { document.documentElement.style.setProperty('--desk-card-scale', String(val / 100)); syncDeskZoomClass(); } },
        pills: [{ label: '恢复默认', value: '__reset__' }],
      });
    });
  }

  // ===== v3.6.x：卡片背景图片（每类卡片独立上传，遮罩/原图可切换） =====
  // 存储：card-bg-<type>（图片 dataURL）+ card-bg-mask-<type>（'on'=白色遮罩 / 'off'=原图直出）
  // 卡片类型 → 目标元素：统一用 [data-card-bg] 属性选择（v3.6.x：卡片可被移到新增页，
  // 不能依赖 .page-slide.second 等固定位置选择器，否则挪页后背景设置失效）
  const CARD_BG_TYPES = [
    { type: 'deco', name: '纪念日卡', sel: '[data-card-bg="deco"]' },
    { type: 'quote', name: '今日情话卡', sel: '[data-card-bg="quote"]' },
    { type: 'fish', name: '已摸鱼卡', sel: '[data-card-bg="fish"]' },
    { type: 'checkin', name: '打卡横幅', sel: '[data-card-bg="checkin"]' },
    { type: 'music', name: '音乐播放器', sel: '[data-card-bg="music"]' },
    { type: 'memo', name: '今日备忘卡', sel: '[data-card-bg="memo"]' },
    { type: 'mood', name: '今天的心情卡', sel: '[data-card-bg="mood"]' },
    { type: 'week', name: '本周日常卡', sel: '[data-card-bg="week"]' },
    { type: 'weekend', name: '周末倒计时卡', sel: '[data-card-bg="weekend"]' },
  ];
  // #198：未登记进 CARD_BG_TYPES 的裸类型（desk-period 经期卡等，模板上有
  // data-card-bg 属性）回退到按属性直选——否则上传后存了键但 applyCardBg 静默
  // return，壁纸「传了不生效」（小米15Pro 反馈；卡片菜单/独立透明度 #192 均已
  // 按 DOM 属性支持裸类型，唯独此处漏了）。
  const cardBgSel = (type) => {
    const def = CARD_BG_TYPES.find(c => c.type === type);
    return def ? def.sel : '[data-card-bg="' + type + '"]';
  };
  // #198：从 DOM 收集全部卡片类型（含 CARD_BG_TYPES 之外的裸类型，去重）
  const cardBgAllTypes = () => {
    const seen = {};
    CARD_BG_TYPES.forEach(c => { seen[c.type] = 1; });
    document.querySelectorAll('[data-card-bg]').forEach(el => {
      const t = el.getAttribute('data-card-bg');
      if (t) seen[t] = 1;
    });
    return Object.keys(seen);
  };
  // ===== v3.26.x：装修模式可调文字部位颜色 =====
  // 每个卡片类型下可单独调色的文字部位：key=存储后缀，label=菜单显示名，sel=目标元素选择器。
  // 存储键 widget-text-<type>-<key>（per-cid 随桌面独立，走 store）；应用方式为内联 color，
  // 直接覆盖该部位文字的 CSS 变量色（var(--ink)/var(--muted)）。
  const WIDGET_TEXT_PARTS = {
    'deco': [
      { key: 'lbl', label: '昵称', sel: '[data-card-bg="deco"] .lbl' },
      { key: 'days', label: '纪念天数', sel: '#love-days' },
      { key: 'date', label: '纪念日期', sel: '#love-date' },
    ],
    'quote': [
      { key: 'title', label: '标题', sel: '[data-card-bg="quote"] .mc-top' },
      { key: 'body', label: '今日情话内容', sel: '#love-quote' },
    ],
    'fish': [
      { key: 'title', label: '标题', sel: '[data-card-bg="fish"] .mc-top' },
      { key: 'body', label: '摸鱼天数', sel: '[data-card-bg="fish"] .mc-b' },
    ],
    'checkin': [
      { key: 'heart', label: '爱心', sel: '[data-card-bg="checkin"] .ck-heart' },
      { key: 'txt', label: '打卡文案', sel: '[data-card-bg="checkin"] .ck-txt' },
      { key: 'btn', label: '打卡按钮', sel: '[data-card-bg="checkin"] .ck-btn' },
    ],
    'music': [
      { key: 'tag', label: '正在播放标签', sel: '[data-card-bg="music"] .mw-tag' },
      { key: 'song', label: '歌名', sel: '#mw-song' },
      { key: 'artist', label: '歌手', sel: '#mw-artist' },
      { key: 'times', label: '播放时间', sel: '[data-card-bg="music"] .mw-times' },
    ],
    'memo': [
      { key: 'title', label: '标题', sel: '[data-card-bg="memo"] .mc-top' },
      { key: 'body', label: '备忘内容', sel: '#memo-text' },
    ],
    'mood': [
      { key: 'title', label: '标题', sel: '[data-card-bg="mood"] .mc-top' },
      { key: 'body', label: '心情内容', sel: '#today-mood-text' },
    ],
    'week': [
      { key: 'title', label: '标题', sel: '[data-card-bg="week"] .mc-top' },
      { key: 'days', label: '日期格', sel: '[data-card-bg="week"] .week-day:not(.today), [data-card-bg="week"] .week-day:not(.today) b' },
    ],
    'weekend': [
      { key: 'days', label: '标题', sel: '#weekend-days' },
      { key: 'sub', label: '副标题', sel: '[data-card-bg="weekend"] .we-sub' },
      { key: 'val', label: '摸鱼/工作值', sel: '[data-card-bg="weekend"] .we-ta, [data-card-bg="weekend"] .we-ta b' },
      { key: 'btn', label: '摸鱼按钮', sel: '#weekend-fish' },
    ],
    'desk-clock': [
      { key: 'time', label: '时间', sel: '#dc-time' },
      { key: 'date', label: '日期', sel: '#dc-date' },
    ],
    'desk-calendar': [
      { key: 'title', label: '月份标题', sel: '#dcal-title' },
    ],
    'desk-timer': [
      { key: 'disp', label: '计时显示', sel: '#dt-disp' },
      { key: 'mode', label: '模式标签', sel: '#dt-mode-label' },
      { key: 'btn', label: '按钮文字', sel: '.desk-timer .dt-btn' },
    ],
    'desk-anniv': [
      { key: 'label', label: '标签', sel: '[data-card-bg="desk-anniv"] .da-label' },
      { key: 'days', label: '天数', sel: '#da-days' },
      { key: 'name', label: '纪念日名', sel: '#da-name' },
    ],
  };
  const textColorSwatches = [
    { color: '#111111', label: '默认黑' },
    { color: '#333333', label: '深灰' },
    { color: '#555555', label: '中灰' },
    { color: '#777777', label: '灰' },
    { color: '#999999', label: '浅灰' },
    { color: '#bbbbbb', label: '中浅灰' },
    { color: '#dddddd', label: '浅白' },
    { color: '#ffffff', label: '纯白' },
    { color: '#e05555', label: '樱花粉' },
    { color: '#d65c7a', label: '玫瑰' },
    { color: '#5555cc', label: '雾霭蓝' },
    { color: '#2e8b57', label: '薄荷绿' },
    { color: '#d4a017', label: '暖橘黄' },
    { color: '#8e44ad', label: '淡紫' },
    { color: '#cc6622', label: '暖橘' },
    { color: '#b8d4e8', label: '天蓝' },
  ];
  const widgetTextKey = (type, key) => 'widget-text-' + type + '-' + key;
  const applyWidgetText = (type, part, color) => {
    try {
      const els = document.querySelectorAll(part.sel);
      els.forEach(el => { if (el) el.style.color = color || ''; });
    } catch (e) {}
  };
  // 应用某卡片所有已保存的文字颜色（启动 / 切桌面 / 恢复方案后调用）
  const applyAllWidgetTexts = () => {
    Object.keys(WIDGET_TEXT_PARTS).forEach(type => {
      WIDGET_TEXT_PARTS[type].forEach(part => {
        const c = store.get(widgetTextKey(type, part.key));
        if (c) applyWidgetText(type, part, c);
      });
    });
  };
  // ===== v3.27.x：小组件独立透明度 =====
  // 每个组件按类型单独存 widget-opacity-<type>（per-cid 随桌面独立，走 store），
  // 应用方式为内联 style.opacity 直接覆盖全局 --widget-opacity；未设置或=100 时清内联
  // 回落全局默认。装修模式点卡片菜单「组件透明度」改本组件，并可一键应用到全部。
  const widgetOpKey = (type) => 'widget-opacity-' + type;
  const widgetOpacitySel = (type) => '[data-card-bg="' + type + '"]';
  const applyWidgetOpacityOf = (type, pct) => {
    try {
      const els = document.querySelectorAll(widgetOpacitySel(type));
      els.forEach(el => { if (el) el.style.opacity = (pct >= 100 ? '' : String(Math.max(0, pct) / 100)); });
    } catch (e) {}
  };
  // 应用所有已保存的组件独立透明度（启动 / 切桌面 / 恢复方案后调用）
  // 类型从 DOM [data-card-bg] 收集：比枚举 CARD_BG_TYPES 多覆盖 desk-period 等裸类型
  const applyAllWidgetOpacities = () => {
    const seen = {};
    document.querySelectorAll('[data-card-bg]').forEach(el => {
      const t = el.getAttribute('data-card-bg');
      if (!t || seen[t]) return;
      seen[t] = 1;
      const v = store.get(widgetOpKey(t));
      if (v !== null && v !== undefined && v !== '') {
        const p = opacityRawToPct(v); // #146 同族：兼容历史小数脏值
        if (!isNaN(p)) applyWidgetOpacityOf(t, Math.max(0, Math.min(100, p)));
      }
    });
  };
  // 应用单个卡片的背景：遮罩用多层背景（白色半透明叠加在图片上）
  // v3.6.x：遮罩浓度滑块 0~85（百分比），存数字字符串；旧值 'off'/'light'/'mid'/'strong'/'on' 迁移
  const MASK_ALPHA_LEGACY = { off: 0, light: 30, mid: 50, strong: 72, on: 50 };
  const maskAlphaOf = (type) => {
    const v = store.get('card-bg-mask-' + type);
    if (v === null || v === undefined || v === '') return 0.5;
    if (MASK_ALPHA_LEGACY[v] !== undefined) return MASK_ALPHA_LEGACY[v] / 100;
    const n = parseFloat(v);
    if (!isNaN(n)) return Math.max(0, Math.min(85, n)) / 100;
    return 0.5;
  };
  const maskPctOf = (type) => Math.round(maskAlphaOf(type) * 100);
  const applyCardBg = (type) => {
    const sel = cardBgSel(type);
    if (!sel) return;
    const els = document.querySelectorAll(sel);
    const img = sanitizeBg('card-bg-' + type, IMG_SAFE_LIMIT);
    const a = maskAlphaOf(type);
    els.forEach(el => {
      if (!el) return;
      if (img && typeof img === 'string' && img.length > 2) {
        // background-image 只放 url（与可选遮罩渐变层）；size/position 单独设置
        const next = a > 0
          ? 'linear-gradient(rgba(255,255,255,' + a + '), rgba(255,255,255,' + a + ')), url("' + img + '")'
          : 'url("' + img + '")';
        // FIX 2026-09-07 #249 切桌面卡死：恒等跳过——值没变不重写 backgroundImage。
        // 赋同值也会让浏览器作废已解码位图重新解码（MB 级 dataURL 尤甚），切联系人
        // 扇出的多条监听器（applyAllCardBgs 独立监听 + refreshDeskVisuals 综合监听）
        // 每次切换对同一批卡片重复赋值，真机表现为切换瞬间整屏图片重解码卡顿。
        if (el.style.backgroundImage === next) return;
        el.style.backgroundImage = next;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.backgroundRepeat = 'no-repeat';
      } else {
        // 无图：恢复默认（清内联，回落到 --widget-bg 变量）
        if (!el.style.backgroundImage) return;
        el.style.backgroundImage = '';
        el.style.backgroundSize = '';
        el.style.backgroundPosition = '';
        el.style.backgroundRepeat = '';
      }
    });
  };
  // #198：遍历 DOM 收集的全部类型——只遍历 CARD_BG_TYPES 的话，desk-period 等裸类型
  // 上传的壁纸在重启/切桌面后永远不会被重新应用
  const applyAllCardBgs = () => cardBgAllTypes().forEach(t => applyCardBg(t));
  // v3.10.x：首屏外观键直读兜底——idbRestore 整体恢复可能迟迟完不成（安卓 Edge/雨见等
  // 内核偶发 IndexedDB 事务挂起，分批回填卡住），或本会话早期写入导致某键被跳过回填；
  // 双方头像 / 卡片背景 / 页面背景是用户最敏感的图，这里不依赖整体恢复进度，
  // 直接逐键 idbGet 回填（idbGet 自带 4s+4s 超时自愈），store 已有值则跳过不覆盖。
  function rescueDeskVisuals() {
    if (!window.idbGet) return;
    let pfx; try { pfx = window.activePrefix(); } catch (e) { return; }
    const keys = ['avatar-user', 'avatar-partner'];
    // #198：裸类型（desk-period 等）的 card-bg 键也要进 IDB 直读兜底，否则大图只在
    // IDB 时经期卡壁纸回填不到
    cardBgAllTypes().forEach(t => keys.push('card-bg-' + t));
    try { for (let i = 0; i < deskPageCount(); i++) keys.push('page-bg-' + i); } catch (e) {}
    const miss = keys.filter(k => !store.get(k));
    if (!miss.length) return;
    let left = miss.length, refreshed = false;
    const done = () => { if (!refreshed) { refreshed = true; try { whenDeskVisible(refreshDeskVisuals); } catch (e) {} } };
    miss.forEach(k => {
      window.idbGet(pfx + ':' + k).then(v => {
        if (v && typeof v === 'string' && v.length > 2 && !store.get(k)) {
          store.set(k, v);
        }
        if (--left <= 0) done();
      }).catch(() => { if (--left <= 0) done(); });
    });
  }
  // v3.10.x：桌面外观全面重应用——回填完成后/切桌面后统一调用（含头像、卡片背景、
  // 页面背景、图片组件），修复「大图键恢复完成但界面停留在启动时的空白」。
  function refreshDeskVisuals() {
    try { window.applyAvatars(); } catch (e) {}
    try { applyAllCardBgs(); } catch (e) {}
    try { applyPageBgs(); } catch (e) {}
    // FIX 2026-09-20 #943d：整块七项同步跑（无头实测 ≈150ms，真机 iOS 大 dataURL 解码更高）
    // 恰压在「回到桌面/切桌面」的交互帧上＝桌面翻页/回桌面冻结（实测最慢 954ms）的来源。
    // 拆帧：头像/卡片背景/页面背景三样最显眼的大图仍在本帧落位（不闪旧桌面，#695 语义不变），
    // 其余四项（文本组件/透明度/图片组件/设置页背景 UI）逐帧让出，每帧之间主线程可响应触摸；
    // 隐藏态无渲染竞争，一次跑完。
    const rest = [applyAllWidgetTexts, applyAllWidgetOpacities, renderDeskImages, syncBgUI];
    let rest943 = 0;
    const step943 = function () {
      while (rest943 < rest.length) {
        try { rest[rest943](); } catch (e) {}
        rest943++;
        if (!document.hidden && rest943 < rest.length) { requestAnimationFrame(step943); return; }
      }
    };
    if (document.hidden) step943();
    else requestAnimationFrame(step943);
  }
  // ===== FIX 2026-09-17 #695 切桌面「直达聊天」时桌面视觉延后到主页真正显示前 =====
  // 症状（用户直派）：此间里点某位跨桌面梦角的【去找TA】直达聊天，点击后要卡一下。
  // 根因：cjian.js 的【去找TA】在同一次任务里先 setActiveContact 再 enterChat——前者尾部
  //   把主页显示出来，后者立刻又把它盖掉，主页这一帧从未被绘制；但 contact-switched 扇出
  //   已经把卡片背景/页面背景（MB 级 dataURL）整批重新解码应用（无头 4× CPU 节流实测
  //   refreshDeskVisuals ≈ 150ms + buildDeskPages 的 applyPageBgs，占整次点击同步耗时约 3/4）。
  // 口径：#249 群聊「隐藏态不重渲 + 脏标记」（group-chat.js gcSwitchDirty）同一模式。
  // 做法：主页不可见时只登记待办、不干活；主页真正显示前补跑一次——MutationObserver 回调
  //   与 microtask 都早于本帧绘制，观感与「当时就应用」完全一致（不会闪一帧旧桌面）。
  //   先例：本文件 1350 行的 #147 壁纸观察器同款盯 #page-phone 的 hidden 变化。
  const deskVisualJobs = new Set();   // 待补跑的桌面视觉重应用（去重＝同一个重应用函数只排一次）
  let deskVisualWatch = null;         // 主页显示触发器（只建一次）
  const homeVisibleNow = () => {
    const home = document.getElementById('page-phone');
    return !!home && !home.hidden;
  };
  function flushDeskVisualJobs() {
    if (!deskVisualJobs.size) return;
    const jobs = Array.from(deskVisualJobs);
    deskVisualJobs.clear();
    jobs.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function ensureDeskVisualWatch() {
    if (deskVisualWatch || !window.MutationObserver) return;
    const home = document.getElementById('page-phone');
    if (!home) return;
    try {
      deskVisualWatch = new MutationObserver(function () { if (homeVisibleNow()) flushDeskVisualJobs(); });
      deskVisualWatch.observe(home, { attributes: true, attributeFilter: ['hidden'] });
    } catch (e) { deskVisualWatch = null; }
  }
  // 主页可见＝当场跑（与修复前完全一致）；不可见＝登记待办，主页真正显示前补跑。
  // 返回 true＝本次已延后（调用方需当场补跑那些「与主页可见性无关」的项，如设置页的壁纸 UI）。
  function whenDeskVisible(fn) {
    if (homeVisibleNow()) { try { fn(); } catch (e) {} return false; }
    deskVisualJobs.add(fn);
    ensureDeskVisualWatch();
    // 微任务重查：同一次任务里「显示主页 → 随即被别的页盖掉」（此间【去找TA】就是这条路径）
    // 时主页始终没被绘制过，待办保留到主页真正显示那一刻
    Promise.resolve().then(function () { if (homeVisibleNow()) flushDeskVisualJobs(); });
    return true;
  }
  // 初始化 + 多桌面切换后重应用
  applyAllCardBgs();
  applyAllWidgetTexts();
  applyAllWidgetOpacities();
  // FIX 2026-09-07 #249 切桌面卡死：这三个监听器删掉——6750 行的综合切换监听器已调
  // refreshDeskVisuals()（内部含 applyAllCardBgs/applyAllWidgetTexts/applyAllWidgetOpacities，
  // 还带头像/页面背景/图片组件/壁纸 UI），同一批赋值每次切换重复跑两遍（prof-contact-switch
  // 实测 applyCardBg 全家桶 ~13ms/次，MB 级 dataURL 在真机上翻倍成解码卡顿）。重应用语义
  // 全保留在综合监听器一处，applyPageBgs→applyCardBg 的恒等跳过短路兜底其余重复赋值。
  // 卡片背景设置公共逻辑（设置页行点击 / 装修模式点卡片共用）：
  // 上传 / 清除 / 遮罩开关。type 为卡片类型，name 为显示名。
  // v3.6.x：装修模式点卡片时额外传入 anchorEl（点击的卡片元素）→ 菜单追加
  // 「上移/下移/移出此页」摆放操作（替代原悬浮操作条按钮：操作条挂在 app-grid 上
  // 会遮挡图标导致无法恢复默认，且用户反馈按钮多余，改为收进点卡片菜单）。
  const openCardBgMenu = (type, name, anchorEl) => {
    const img = store.get('card-bg-' + type);

    const widgetEl = anchorEl ? anchorEl.closest('[data-desk-widget]') : null;
    // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
    const pickFile = () => {
      window.mochiFilePick({
        id: 'mochi-card-bg-pick', accept: 'image/*',
        onFiles: (files) => {
          const f = files && files[0];
          if (!f) { toast('没有取到图片，请再选一次'); return; }
          const reader = new FileReader();
          reader.onload = () => {
            // v3.10.x：压缩并保证 <=450KB（渲染防护阈值 500KB 留余量）——超限自动降边长重压，
            // 防止「设置成功、重启后被渲染防护跳过变白板」
            compressImageFit(reader.result, 1000, 450 * 1024).then(data => {
              if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
              store.set('card-bg-' + type, data);
              applyCardBg(type);
              syncCardBgUIs();
              toast(name + '背景已设置');
            });
          };
          reader.onerror = () => toast('图片读取失败，请换一张再试');
          reader.readAsDataURL(f);
        }
      });
    };
    const moveWidget = (dir) => {
      if (!widgetEl || !widgetEl.parentNode) return;
      if (dir === 'up') {
        const prev = widgetEl.previousElementSibling;
        if (prev) widgetEl.parentNode.insertBefore(widgetEl, prev);
      } else if (dir === 'down') {
        const next = widgetEl.nextElementSibling;
        if (next) widgetEl.parentNode.insertBefore(next, widgetEl);
      }
      saveDeskLayout();
      toast(dir === 'up' ? '已上移' : '已下移');
    };
// 组装菜单选项：背景操作 + （装修模式点卡片时）摆放操作
  // v3.6.x：遮罩浓度滑块 0~85%（替换原四档 pills）
  // 嵌套弹窗必须延迟到当前弹窗关闭后再开：okBtn 的 finally close() 会立刻关掉
  // 当前 openModal 并清空 cb（fire() 对 cb===null 直接 return），同步嵌套必然闪关。
  const openCardMenuNext = (t, v, fn, opts) => {
    setTimeout(() => { if (window.openModal) window.openModal(t, v, fn, opts); }, 0);
  };
  const pills = [];
    pills.push({ label: img ? '更换图片' : '上传图片', value: '1' });
    if (img) pills.push({ label: '清除图片', value: '2' });
    if (img) pills.push({ label: '遮罩浓度', value: 'mask' });
    if (img) pills.push({ label: maskPctOf(type) === 0 ? '原图直出 ✓' : '原图直出', value: 'origin' });
    pills.push({ label: '组件透明度', value: 'opacity' });
    if (WIDGET_TEXT_PARTS[type]) pills.push({ label: '文字颜色', value: 'text' });
    if (widgetEl) {
      pills.push({ label: '上移', value: 'up' });
      pills.push({ label: '下移', value: 'down' });
      pills.push({ label: '移出此页', value: 'out' });
    }
    // 无背景且不在装修模式点卡片（设置页行）：直接选文件（原快捷行为）
    if (!img && !widgetEl) { pickFile(); return; }
    if (!window.openModal) return;
    window.openModal(name + '设置', '', (v) => {
      if (v === '1') pickFile();
      else if (v === '2') {
        store.remove('card-bg-' + type);
        applyCardBg(type);
        syncCardBgUIs();
        toast('已恢复默认');
      } else if (v === 'mask') {
        const cur = maskPctOf(type);
        openCardMenuNext('遮罩浓度', '', (sv) => {
          if (sv === '__reset__') { store.set('card-bg-mask-' + type, '50'); applyCardBg(type); syncCardBgUIs(); toast('已恢复默认 50%'); return; }
          const pct = parseInt(sv, 10);
          if (isNaN(pct)) return;
          store.set('card-bg-mask-' + type, String(pct));
          applyCardBg(type);
          syncCardBgUIs();
          toast(pct === 0 ? '已切换为原图直出' : '遮罩浓度 ' + pct + '%');
        }, {
          noInput: true,
          slider: {
            min: 0, max: 85, step: 1, value: cur, label: '拖动调整遮罩浓度（0 为原图直出）', unit: '%',
            onChange: (val) => {
              const a = val / 100;
              const els2 = document.querySelectorAll(cardBgSel(type));
              els2.forEach(el => {
                if (!el || !img) return;
                el.style.backgroundImage = a > 0
                  ? 'linear-gradient(rgba(255,255,255,' + a + '), rgba(255,255,255,' + a + ')), url("' + img + '")'
                  : 'url("' + img + '")';
              });
            },
          },
          pills: [
            { label: '原图直出', value: '0' },
            { label: '恢复默认', value: '__reset__' },
          ],
        });
      } else if (v === 'origin') {
        store.set('card-bg-mask-' + type, '0');
        applyCardBg(type);
        syncCardBgUIs();
        toast('已切换为原图直出');
      } else if (v === 'opacity') {
        // v3.27.x：独立透明度——滑条只改本组件（widget-opacity-<type>），
        // 「应用到全部」把当前值写入所有组件的独立键；「恢复默认」清本组件键回落全局
        const opKey = widgetOpKey(type);
        const savedOp = store.get(opKey);
        const opN = savedOp !== null && savedOp !== undefined && savedOp !== '' ? opacityRawToPct(savedOp) : NaN;
        const curOp = !isNaN(opN) ? Math.max(0, Math.min(100, opN)) : 100;
        let sliderVal = curOp;
        openCardMenuNext('组件透明度（' + name + '）', '', (sv) => {
          if (sv === '__all__') {
            const pct = Math.max(0, Math.min(100, sliderVal));
            const types = {};
            document.querySelectorAll('[data-card-bg]').forEach(el => { const t = el.getAttribute('data-card-bg'); if (t && !types[t]) { types[t] = 1; store.set(widgetOpKey(t), String(pct)); applyWidgetOpacityOf(t, pct); } });
            toast('已应用到全部小组件 ' + pct + '%');
            return;
          }
          if (sv === '__reset__') { store.remove(opKey); applyWidgetOpacityOf(type, 100); toast(name + '已恢复，跟随全局透明度'); return; }
          const pct = parseInt(sv, 10);
          if (isNaN(pct)) return;
          store.set(opKey, String(pct));
          applyWidgetOpacityOf(type, pct);
          toast(name + '透明度 ' + pct + '%');
        }, {
          noInput: true,
          slider: {
            min: 0, max: 100, step: 1, value: curOp, label: '拖动调整本组件透明度（只对' + name + '生效）', unit: '%',
            onChange: (val) => { sliderVal = val; applyWidgetOpacityOf(type, val); },
          },
          pills: [
            { label: '应用到全部小组件', value: '__all__' },
            { label: '恢复默认（跟随全局）', value: '__reset__' },
          ],
        });
      } else if (v === 'text') {
        // v3.26.x：文字部位颜色——先选部位（已设色的标「· 已设色」），再开色板
        const parts = WIDGET_TEXT_PARTS[type] || [];
        if (!parts.length) return;
        openCardMenuNext('文字颜色', '', (sv) => {
          const part = parts.find(p => p.key === sv);
          if (!part) return;
          const storeKey = widgetTextKey(type, part.key);
          const current = store.get(storeKey) || '#111111';
          window.openModal(part.label + '颜色', '', (cv) => {
            const color = (typeof cv === 'number' && textColorSwatches[cv]) ? textColorSwatches[cv].color : cv;
            if (!color) return;
            if (color === '__reset__') {
              store.remove(storeKey);
              applyWidgetText(type, part, '');
              toast(part.label + '已恢复默认颜色');
              return;
            }
            store.set(storeKey, color);
            applyWidgetText(type, part, color);
            toast(part.label + '颜色已设置');
          }, {
            colorPicker: true,
            noInput: true,
            color: current,
            swatches: textColorSwatches,
            pills: [{ label: '恢复默认', value: '__reset__' }],
          });
        }, {
          noInput: true,
          staticText: '选择要改颜色的文字部位，再选择颜色',
          pills: parts.map(p => ({ label: p.label + (store.get(widgetTextKey(type, p.key)) ? ' · 已设色' : ''), value: p.key })),
        });
      } else if (v === 'up') moveWidget('up');
      else if (v === 'down') moveWidget('down');
      else if (v === 'out') {
        // v3.6.x：移出前记住来源页，移出后同步空白页提示（空页在装修模式重新显示提示）
        const fromSlide = widgetEl.closest('.page-slide');
        // FIX 2026-09-13 #400：显式移出经期倒计时卡写移除标记——ensureDeskPeriod 的
        // 「布局不含即自动补位/加新页」迁移没有一次性语义，移出后每次启动/切桌面被拉回
        //（还会新建一页，同 #380 memo-row 强迁家族）；组件库显式加回时清标记。
        if (widgetEl.getAttribute('data-desk-widget') === 'desk-period') {
          try { store.set('desk-period-removed', '1'); } catch (e) {}
        }
        ensureWidgetPool().appendChild(widgetEl);
        saveDeskLayout();
        syncPageHint(fromSlide);
        toast('已移出此页（可在其他页「添加卡片」找回）');
      }
    }, {
      noInput: true,
      pills: pills,
    });
  };
  // 刷新所有设置行右侧状态文本
  const syncCardBgUIs = () => {
    CARD_BG_TYPES.forEach(c => {
      const val = document.getElementById('card-bg-val-' + c.type);
      if (!val) return;
      const img = store.get('card-bg-' + c.type);
      const pct = maskPctOf(c.type);
      const maskTxt = pct === 0 ? '原图' : '遮罩' + pct + '%';
      val.textContent = img ? '已设置 · ' + maskTxt : '';
    });
  };
  // 绑定每类卡片的设置行
  CARD_BG_TYPES.forEach(c => {
    const row = document.getElementById('row-card-bg-' + c.type);
    if (!row) return;
    syncCardBgUIs();
    row.addEventListener('click', () => openCardBgMenu(c.type, c.name));
  });
  // v3.6.x：装修模式下点击卡片直接上传背景（与自定义图标同交互）。
  // 用事件委托绑定在 #page-phone 上：仅 decor-on 装修模式生效，点击 [data-card-bg] 卡片弹设置菜单。
  // 注意 stopPropagation——装修模式下点击卡片不触发卡片自身功能（备忘/心情/打卡/音乐等），
  // 与「装修模式点击图标换图、不打开功能」的既有行为一致。
  const phonePageEl = document.getElementById('page-phone');
  if (phonePageEl) {
    phonePageEl.addEventListener('click', (e) => {
      if (!phonePageEl.classList.contains('decor-on')) return;
      // 组件库面板 / 装饰完成条 / 新增页「+ 添加卡片」点击不拦截
      if (e.target.closest('.desk-lib') || e.target.closest('.decor-bar') || e.target.closest('.desk-page-add')) return;
      // FIX 2026-09-21 #991：头像区不参与「点卡片设背景」——头像盒（.deco-avatar）长在
      // [data-card-bg="deco"] 卡片内部，装修模式下点它会走到下面 preventDefault+stopPropagation，
      // 把 label 转发（默认动作）和头像自己的 JS 兜底腿一起掐掉＝装修模式下换不了头像、点昵称也改不了名
      //（无头实测：装修模式点桌面头像 = 弹出「纪念日卡设置」、选择器 0 次）。头像/昵称是卡片内的
      // **可点元素**而非卡片背景区，按 #821 同口径各归各：点头像＝换头像，点卡片其余区域＝设背景。
      if (e.target.closest('.deco-avatar')) return;
      const card = e.target.closest('[data-card-bg]');
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      const type = card.getAttribute('data-card-bg');
      const def = CARD_BG_TYPES.find(c => c.type === type);
      // 传入 card 作为 anchorEl：菜单额外包含 上移/下移/移出此页
      openCardBgMenu(type, def ? def.name : type, card);
    }, true);
  }

  // ===== v3.6.x：桌面页面管理（新增空白主页 / 删除 / 每页独立背景图） =====
  // 页数存储：desk-page-count（默认 2，上限 5）；每页背景图：page-bg-<idx>（dataURL）
  const pagesBox = document.getElementById('desktop-pages');
  // FIX 2026-09-04 #151 模板默认排布快照（脚本加载期、buildDeskPages/applyDeskLayout
  // 尚未改动 DOM 前捕获；只记每页顶层组件与模板池内组件）。用于切回「未装修（无
  // desk-layout）」桌面时还原默认排布——此前 applyDeskLayout 对无布局直接 return：
  // 上个桌面（有布局）切走时把本桌组件按其布局扫进隐藏池，切回来池里的组件永不
  // 归还（「小组件会隐藏」），桌面还停留在他人桌面的排布上（「不同桌面显示不一样」）。
  const TEMPLATE_DESK_ARR = (() => {
    const arr = [];
    try {
      pagesBox.querySelectorAll('.page-slide').forEach((s, pi) => {
        Array.prototype.forEach.call(s.children, (n) => {
          if (n.hasAttribute && n.hasAttribute('data-desk-widget')) arr.push({ wid: n.getAttribute('data-desk-widget'), page: pi });
        });
      });
      document.querySelectorAll('#desk-widget-pool [data-desk-widget]').forEach((n) => {
        arr.push({ wid: n.getAttribute('data-desk-widget'), pool: true });
      });
    } catch (e) {}
    return arr;
  })();
  // 按快照还原默认排布（幂等：已在位的节点不动；页数不足的页其组件保持池语义，
  // 与冷启动 buildDeskPages 收缩页数的行为一致）。动态注入图标（同频/伸手/喝水等）
  // 在图标组网格内随组归位，不单独记录。
  const restoreTemplateDesk = () => {
    if (!pagesBox) return;
    const slides = pagesBox.querySelectorAll('.page-slide');
    const pool = ensureWidgetPool();
    // FIX 2026-09-16 #560 冷启动第三页顺序竞态（新浏览器默认「图标在上、小组件在下」，
    // 多机型随机复现）：时序为 0ms buildDeskPages 收缩把第三页三组件（desk-period/
    // memo-row/p3apps）扫进隐藏池 → 50ms ensureP3 重建第三页先放回 p3apps →
    // mochi-restore-done(~秒级) 回放 applyDeskLayout 时本函数此前对池里的组件逐个
    // appendChild 到页尾，而已在页里的 p3apps 被「node.parentNode === slide」跳过
    // ＝小组件全部排到图标组后面。两步谁先谁后不可控（50ms 与回放时序竞态）＝
    // 机型相关随机复现。改为按模板快照顺序整页归位：先把该页快照组件按原序
    // 依次插回（insertBefore addBtn 保位），快照顺序天然恢复；已在位且相对顺序
    // 与模板一致时整体跳过（幂等零抖动，同 #249 恒等跳过思路）。
    // 仅无布局（未装修）桌面走此分支，已装修用户 desk-layout 优先级不变。
    const byPage = {};
    TEMPLATE_DESK_ARR.forEach((it) => {
      if (it.pool) return;
      (byPage[it.page] = byPage[it.page] || []).push(it.wid);
    });
    Object.keys(byPage).forEach((pi) => {
      const slide = slides[pi];
      if (!slide) return;
      const nodes = byPage[pi].map(wid => document.querySelector('[data-desk-widget="' + wid + '"]')).filter(Boolean);
      if (!nodes.length) return;
      // 已全部在位且子节点相对顺序与快照一致 → 不动（避免每次切桌面/回填重排抖动）
      const orderOk = nodes.every((n, i) => {
        if (n.parentNode !== slide) return false;
        const idx = Array.prototype.indexOf.call(slide.children, n);
        return i === 0 || idx > Array.prototype.indexOf.call(slide.children, nodes[i - 1]);
      });
      if (orderOk) return;
      const addBtn = slide.querySelector('.desk-page-add');
      nodes.forEach((n) => {
        if (addBtn) slide.insertBefore(n, addBtn); else slide.appendChild(n);
      });
    });
    // 模板快照里属池的组件归池（页数收缩/未添加语义不变）；页缺失的保持旧版留池语义
    TEMPLATE_DESK_ARR.forEach((it) => {
      if (!it.pool) return;
      const node = document.querySelector('[data-desk-widget="' + it.wid + '"]');
      if (node && node.parentNode !== pool) pool.appendChild(node);
    });
  };
  const pagesVal = document.getElementById('desk-pages-val');
  const delPageRow = document.getElementById('row-desk-del-page');
  const pageBgsBox = document.getElementById('desk-page-bgs');
  const DESK_PAGE_MAX = 5;
  // 前两页是核心页（情侣空间 + 音乐播放器），只可增删第 3 页及以后的空白页
  const DESK_PAGE_MIN = 2;
  const deskPageCount = () => {
    const v = parseInt(store.get('desk-page-count'), 10);
    return isNaN(v) || v < DESK_PAGE_MIN ? DESK_PAGE_MIN : Math.min(v, DESK_PAGE_MAX);
  };
  // v3.10.x：每页背景应用（从 buildDeskPages 抽出）——页面背景是大图键
  //（>200KB 只存 IndexedDB，不进 localStorage），启动渲染时回填往往未完成读到空，
  // 需要在 mochi-restore-done / 切换联系人后单独重应用，否则整页背景"丢失"变默认。
  const applyPageBgs = () => {
    if (!pagesBox) return;
    const slides = pagesBox.querySelectorAll('.page-slide');
    const n = Math.min(slides.length, deskPageCount());
    for (let i = 0; i < n; i++) {
      const s = slides[i];
      if (!s) continue;
      const bg = sanitizeBg('page-bg-' + i, BG_SAFE_LIMIT);
      if (bg && typeof bg === 'string' && bg.length > 2) {
        // FIX 2026-09-07 #249 切桌面卡死：恒等跳过（同 applyCardBg——整页背景可达数 MB，
        // 赋同值触发真机重新解码；buildDeskPages 每次切换都走这里）
        const want = 'url("' + bg + '")';
        if (s.style.backgroundImage === want) continue;
        s.style.backgroundImage = want;
        s.style.backgroundSize = 'cover';
        s.style.backgroundPosition = 'center';
      } else {
        if (!s.style.backgroundImage) continue;
        s.style.backgroundImage = '';
        s.style.backgroundSize = '';
        s.style.backgroundPosition = '';
      }
    }
    // #754 桌面翻页卡顿（iPhone 15 Pro Max 实报：翻页 平均186ms / p90 719ms / 最慢3611ms，
    // 长任务为零＝卡在合成/栅格层）：有整页背景图的桌面挂类，触屏设备据此把三页提升为
    // 独立合成层——翻页只平移纹理，不再对整屏背景图逐帧重栅格化/重解码；与 #147 壁纸
    // 「常驻图层纹理保持存活、不再反复解码」同源修法。读 DOM 实态自校正（页背景增删后
    // 本函数必被调用），无整页背景图不挂类＝零额外显存。
    var anyPageBg = false;
    for (var j = 0; j < slides.length; j++) { if (slides[j] && slides[j].style.backgroundImage) { anyPageBg = true; break; } }
    if (pagesBox.classList.contains('has-page-bg') !== anyPageBg) pagesBox.classList.toggle('has-page-bg', anyPageBg);
  };
  // FIX 2026-09-15 #495：deskLayout 定义自 4397 行处上移至此——冷启动 personalize.js 顶层
  // 4288 行同步调用 buildDeskPages()，其删页收缩分支（原 4104 行）调用 deskLayout() 时该
  // const 尚未初始化＝TDZ「Cannot access 'deskLayout' before initialization」每次冷启动必抛
  //（被行内 catch 吞＝删页收缩落盘判断整体跳过，#151 收缩修复在冷启动路径失效；无头
  // pauseOnExceptions 实锤）。依赖仅 store（第 5 行）与 DESK_PAGE_MIN/MAX（4012/4014），
  // 均在本处之前，上移安全。
  // 读布局：desk-layout = JSON 数组（每页一个 widget id 数组）；无 → null（保持 DOM 原状）
  // v3.27.x（#140 Huawei Pura70Pro+/Chrome 122 等安卓同族）：布局完整性校验——
  // 高 IO/配额压力下持久化值可能损坏/空壳（[[],[]…] / 页数超限 / 重复组件 id），
  // applyDeskLayout 会把布局外全部小组件卡整批扫进隐藏池，只剩图标网格（「卡片大部分
  // 不显示」）；坏键落在 IDB 每次启动回填复发（同 #87/#134/#136 存量数据+慢 IO 家族）。
  // 校验不过 → 按无布局处理（保持 template 默认 DOM）并当场清坏键，防回填复活。
  const deskLayout = () => {
    let a = null;
    try {
      const v = store.get('desk-layout');
      if (v) { const p = JSON.parse(v); if (Array.isArray(p)) a = p; }
    } catch (e) {}
    if (!a) return null;
    const seen = {};
    const ok = a.length >= DESK_PAGE_MIN && a.length <= DESK_PAGE_MAX &&
      a.some(function (page) { return Array.isArray(page) && page.length > 0; }) &&
      a.every(function (page) { return Array.isArray(page) && page.every(function (w) { return typeof w === 'string'; }); }) &&
      a.every(function (page) { return (page || []).every(function (w) { if (seen[w]) return false; seen[w] = 1; return true; }); });
    if (!ok) {
      try { console.info('[mochi] desk-layout 校验失败（损坏/空壳），忽略并清除'); } catch (e) {}
      try { store.remove('desk-layout'); } catch (e) {}
      return null;
    }
    return a;
  };
  // 重建桌面页结构：保证页数 = desk-page-count，新增页为空 page-slide
  const buildDeskPages = () => {
    if (!pagesBox) return;
    const target = deskPageCount();
    const slides = Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide'));
    while (slides.length > target) {
      const delIdx = slides.length - 1;
      const s = slides.pop();
      if (s && s.parentNode) {
        // FIX 2026-09-12 #351：删除页时新页网格（pg*）就地解散——网格内图标归还各自
        // 模板默认网格并保存顺序，网格顺序键一并清除；空网格壳随后照常随顶层组件进
        // 隐藏池。不解散＝整网格带着图标一起进池＝图标集体隐身（池不可见），装修库
        // 只能逐个找回。只认 pg* 网格：第三页模板网格（p3apps）保留「整组进池、
        // 装修库整组找回」的既有语义不动。
        const pgG = s.querySelector('.app-grid[data-desk-widget^="pg"]');
        if (pgG && pgG.dataset.app) {
          const homeGrids = {};
          Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide')).forEach(ps => {
            const hg = ps.querySelector('.app-grid');
            if (hg && hg.dataset.app && hg !== pgG) homeGrids[hg.dataset.app] = hg;
          });
          Array.prototype.slice.call(pgG.querySelectorAll('.app')).forEach(a => {
            const key = a.dataset.app;
            if (!key) return;
            let dest = homeGrids[ICON_HOME_GRID[key]] || document.querySelector('.app-grid[data-desk-widget="apps"]');
            if (dest && dest !== pgG) {
              dest.appendChild(a);
              const dOrder = Array.prototype.slice.call(dest.querySelectorAll('.app')).map(x => x.dataset.app);
              try { store.set('app-icon-order-' + dest.dataset.app, JSON.stringify(dOrder)); } catch (e) {}
            }
          });
          try { store.remove('app-icon-order-' + pgG.dataset.app); } catch (e) {}
        }
        // 该页上的组件移回隐藏池（不随页面删除丢失）
        // 只移动顶层组件——嵌套子组件（如 p3apps 内的 app-period/app-accounting）
        // 随父组件整体移动，避免拆散导致空壳
        const pool = ensureWidgetPool();
        const widgetNodes = Array.prototype.slice.call(s.querySelectorAll('[data-desk-widget]'));
        widgetNodes.forEach(node => {
          let parent = node.parentElement, nested = false;
          while (parent && parent !== s) {
            if (parent.hasAttribute && parent.hasAttribute('data-desk-widget')) { nested = true; break; }
            parent = parent.parentElement;
          }
          if (!nested) pool.appendChild(node);
        });
        // 该页上的图片组件直接删除（图片不跨页保留，避免索引错位）
        removeDeskImagesOnPage(delIdx);
        removeDeskTextsOnPage(delIdx);
        removeDeskCountdownsOnPage(delIdx);
        s.parentNode.removeChild(s);
        // v3.7.x 修复：删页后收缩已存布局——此前 desk-layout 仍保留被删页条目，
        // 之后新增页并刷新会把旧页组件插回新页（组件"复活"）。只在已有自定义布局时
        // 收缩；默认布局（desk-layout 为空）不写，保持原「保持 DOM 原状」语义。
        // FIX 2026-09-04 #151：切桌面触发的收缩不落盘——此时 DOM 还是上一桌面的
        // 排布，store 已切到新桌面，saveDeskLayout 会把他人排布写成新桌面的
        // desk-layout（页数不同的两桌面来回切即互相污染、组件被吞进隐藏池）。
        // 用户手动删页（delPageRow）路径不走 contact-switched 监听，deskSwitchBuild=false 照旧保存。
        try { if (deskLayout() && !deskSwitchBuild) saveDeskLayout(); } catch (e) {}
      }
    }
    for (let i = slides.length; i < target; i++) {
      const s = document.createElement('div');
      s.className = 'page-slide desk-page';
      s.dataset.desk = String(i);
      // FIX 2026-09-12 #351：新页自带 4 列图标网格（id 稳定 = pg<页序>）——此前新页无
      // .app-grid，拖拽/装修库放进来的图标只能当独立组件竖排（无排版、无上移/下移、
      // 跨页拖到新页落不了格）。网格随页增删，页序稳定（页只能从尾部增删）键不漂移；
      // 删除页时网格内图标归还模板默认页（见上方删页分支）。
      const pgGrid = document.createElement('div');
      pgGrid.className = 'app-grid';
      pgGrid.dataset.app = 'pg' + i;
      pgGrid.setAttribute('data-desk-widget', 'pg' + i);
      // 空白页装修提示 + 「+ 添加卡片」（仅新增页，第 0/1 页是核心页）
      const hint = document.createElement('div');
      hint.className = 'desk-page-hint';
      hint.textContent = '空白主页 · 可上传整页背景图';
      const addBtn = document.createElement('div');
      addBtn.className = 'desk-page-add';
      addBtn.textContent = '+ 添加卡片';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const curIdx = Array.prototype.indexOf.call(pagesBox.querySelectorAll('.page-slide'), s);
        openDeskLib(s, curIdx);
      });
      s.appendChild(pgGrid);
      s.appendChild(hint);
      s.appendChild(addBtn);
      pagesBox.appendChild(s);
      slides.push(s);
    }
    // 应用每页背景图（v3.10.x：抽出为 applyPageBgs，供回填完成后/切桌面后单独重应用）
    // FIX 2026-09-17 #695：主页不可见时不在这里重解码整页背景（切桌面直达聊天时主页
    //   一帧都没画过，这份钱白付），登记待办、主页真正显示前补跑。syncPagesUI 是设置页
    //   的页面管理 UI，与主页可见性无关，保持同步（否则跨桌面后设置页会显示旧桌面的页数）。
    whenDeskVisible(applyPageBgs);
    if (window.deskRebuild) window.deskRebuild();
    syncPagesUI();
    setTimeout(function () { if (window.ensureP3) window.ensureP3(); }, 50);
  };
  // 同步页面管理 UI（页数显示 + 每页背景行列表 + 删除按钮显隐）
  const syncPagesUI = () => {
    const n = deskPageCount();
    if (pagesVal) pagesVal.textContent = '共 ' + n + ' 页';
    if (delPageRow) delPageRow.hidden = n <= 1;
    if (!pageBgsBox) return;
    pageBgsBox.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'set-row' + (i >= 2 ? '' : '');
      const ico = document.createElement('div');
      ico.className = 'ico';
      ico.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>';
      const txt = document.createElement('div');
      txt.className = 'txt';
      txt.textContent = (i === 0 ? '首页' : '第 ' + (i + 1) + ' 页') + '背景图';
      const val = document.createElement('div');
      val.className = 'val';
      val.id = 'page-bg-val-' + i;
      const syncRowUI = () => {
        const bg = store.get('page-bg-' + i);
        val.textContent = bg ? '已设置' : '';
      };
      syncRowUI();
      row.appendChild(ico); row.appendChild(txt); row.appendChild(val);
      // FIX 2026-09-21 #1002（第九波续）：本行「首页/第 N 页背景图」铺「真·可点 input」层——手指物理落在
      // 真 input 上，选择器由浏览器原生默认动作弹出，不再依赖 label 转发 / JS 合成 click / showPicker。
      // owner 写统一入口那个 input 的 id（点按时才建），选完文件转交它并派发 change ⇒ 压缩/落库管线一字未改。
      if (window.mochiFilePickSurface) window.mochiFilePickSurface(row, { id: 'page-bg-tap-' + i, accept: 'image/*', owner: 'mochi-page-bg-pick' });
      row.addEventListener('click', () => {
        const bg = store.get('page-bg-' + i);
        // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
        const pickPageBg = () => {
          window.mochiFilePick({
            id: 'mochi-page-bg-pick', accept: 'image/*',
            onFiles: (files) => {
              const f = files && files[0];
              if (!f) { toast('没有取到图片，请再选一次'); return; }
              const reader = new FileReader();
              reader.onload = () => {
                // v3.10.x：压缩并保证 <=4.5MB（渲染防护 6MB 留余量），超限自动降边长重压
                compressImageFit(reader.result, phoneBgMaxSide(), 4.5 * 1024 * 1024).then(data => {
                  if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
                  store.set('page-bg-' + i, data);
                  buildDeskPages();
                  syncRowUI();
                  toast((i === 0 ? '首页' : '第 ' + (i + 1) + ' 页') + '背景已设置');
                });
              };
              reader.onerror = () => toast('图片读取失败，请换一张再试');
              reader.readAsDataURL(f);
            }
          });
        };
        if (bg && window.openModal) {
          window.openModal((i === 0 ? '首页' : '第 ' + (i + 1) + ' 页') + '背景图', '', (v) => {
            if (v === '1') pickPageBg();
            else if (v === '2') {
              store.remove('page-bg-' + i);
              buildDeskPages();
              syncRowUI();
              toast('已恢复默认');
            }
          }, { noInput: true, pills: [{ label: '更换图片', value: '1' }, { label: '清除图片', value: '2' }] });
        } else {
          pickPageBg();
        }
      });
      pageBgsBox.appendChild(row);
    }
  };
  const addPageRow = document.getElementById('row-desk-add-page');
  if (addPageRow) {
    addPageRow.addEventListener('click', () => {
      const n = deskPageCount();
      if (n >= DESK_PAGE_MAX) { toast('最多 ' + DESK_PAGE_MAX + ' 页'); return; }
      store.set('desk-page-count', String(n + 1));
      buildDeskPages();
      toast('已新增第 ' + (n + 1) + ' 页');
    });
  }
  if (delPageRow) {
    delPageRow.addEventListener('click', () => {
      const n = deskPageCount();
      if (n <= DESK_PAGE_MIN) { toast('核心页不可删除'); return; }
      if (window.openModal) {
        window.openModal('删除最后一页？', '', (v) => {
          if (v === 'ok') {
            store.remove('page-bg-' + (n - 1));
            store.set('desk-page-count', String(n - 1));
            buildDeskPages();
            toast('已删除');
          }
        }, { noInput: true, staticText: '第 ' + n + ' 页上的卡片会移回隐藏池，可随时在其他页「添加卡片」找回' });
      } else {
        store.remove('page-bg-' + (n - 1));
        store.set('desk-page-count', String(n - 1));
        buildDeskPages();
      }
    });
  }
  const resetDeskRow = document.getElementById('row-desk-reset');
  if (resetDeskRow) {
    resetDeskRow.addEventListener('click', () => {
      // v3.26.x：预选中唯一「确定恢复默认」pill——noInput 弹窗只点底部「确定」时
      // fire() 传 pillVal=null → 静默不执行（反馈"点了没反应"）。与删除方案同因同修。
      const ctl = window.openModal('恢复默认桌面', '将恢复桌面卡片布局与页数，桌面恢复为默认三页（每页已设置的背景图与图标不受影响）。确定继续？', (v) => {
        if (v !== '1') return;
        // 恢复默认桌面：彻底回到系统默认布局（组件卡片 + 图标位置）。
        // 旧实现只删 desk-layout 并按隐藏池就地回位，有三处漏洞导致多次复现「没恢复」：
        // ① 已移动到非默认页的组件不在隐藏池里，不会被挪回；② 图标顺序 app-icon-order-*
        //   和隐藏图标 hidden-icons 从不清理，图标位置保持自定义；③ desk-layout 只存于
        //   IndexedDB 时（本地存储被清理的场景）刷新后会被回填还原。
        // 新做法：清掉「布局 / 页数 / 各网格图标顺序 / 隐藏图标」四类键（store.remove 会同时
        // 清 memoryCache + localStorage + IndexedDB），随后整页刷新——页面每次加载都由 template
        // 生成默认 DOM，布局键为空时 applyDeskLayout/图标排序都不重排，即还原成系统默认。
        // 每页背景图（page-bg-*）与自定义图标图片（app-icon-*）保留，符合提示文案。
        let dels = [];
        try {
          store.remove('desk-layout');
          store.set('desk-page-count', '3');
          document.querySelectorAll('.app-grid').forEach(function (g) {
            if (g.dataset.app) store.remove('app-icon-order-' + g.dataset.app);
          });
          store.remove('hidden-icons');
          // v3.27.x（华为 Mate 40 Pro+自带浏览器反馈）：store.remove 里的 idbDelete 是异步
          // fire-and-forget，原 400ms 后 reload 在 IDB 慢/事务挂起的浏览器上删除还没提交，
          // 新页面 idbRestore 会把旧 desk-layout 从 IDB 回填回来 →「恢复默认没生效」。
          // 这里显式等 IDB 删除完成（每键 3s 兜底超时）再 reload。
          if (window.idbDelete) {
            const P = (window.activePrefix ? window.activePrefix() : 'xy-home-v2:default');
            dels.push(window.idbDelete(P + ':desk-layout'));
            dels.push(window.idbDelete(P + ':hidden-icons'));
            document.querySelectorAll('.app-grid').forEach(function (g) {
              if (g.dataset.app) dels.push(window.idbDelete(P + ':app-icon-order-' + g.dataset.app));
            });
          }
        } catch (e) {}
        toast('已恢复默认桌面');
        Promise.all(dels.map(function (p) {
          return Promise.race([p, new Promise(function (r) { setTimeout(r, 3000); })]);
        })).then(function () {
          try { location.reload(); } catch (e) {}
        });
      }, { noInput: true, pillSubmit: true, pills: [{ label: '确定恢复默认', value: '1' }] });
      if (ctl && ctl.pills) ctl.pills([{ label: '确定恢复默认', value: '1' }], '1');
    });
  }
  // FIX 2026-09-04 #151：切桌面期间的 buildDeskPages 标记——删页收缩不把当前 DOM
  //（上一桌面的排布）落盘成新桌面的 desk-layout（见删页分支注释）
  let deskSwitchBuild = false;
  buildDeskPages();
  // FIX 2026-09-12 #351：行为验证口（verify-desk-icon-place 断言用）——暴露启动归位与页重建
  window.__deskIconDebug = { restoreAppIconOrder: restoreAppIconOrder, buildDeskPages: buildDeskPages };
  document.addEventListener('contact-switched', () => { deskSwitchBuild = true; try { buildDeskPages(); } finally { deskSwitchBuild = false; } });
  // v3.6.x 修复（刷新后桌面页数消失）：IndexedDB 回填完成前，desk-page-count 若只存于
  // IDB（localStorage 缺失，如旧数据迁移后/个别浏览器配额清理），首次 buildDeskPages
  // 会按默认 2 页构建，恢复完成后页数/新增页不会自动重建 → 刷新后「新增的页消失」。
  // 恢复完成事件后重建一次：页数未变时幂等（不动已存在页内容，仅重设背景/圆点）。
  const rebuildDeskWhenReady = () => {
    try { buildDeskPages(); } catch (e) {}
    // v3.14.x：回填完成后补应用组件布局——desk-layout 的 localStorage 副本可能因配额/
    // 浏览器清理而缺失（只存于 IndexedDB），首次 applyDeskLayout（脚本加载期，回填未完）
    // 读到空不应用；此前只重建页数不重排组件 → 用户装修的位置整次会话失效（重启回旧位），
    // 且失效期间的 saveDeskLayout 还会把默认 DOM 固化成新布局。此处补一次应用（幂等）；
    // 用 window 引用避免脚本顺序上的 TDZ 问题。
    try { if (window.applyDeskLayout) window.applyDeskLayout(); } catch (e) {}
  };
  if (window.__mochiDataReady) rebuildDeskWhenReady();
  else {
    try {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        rebuildDeskWhenReady();
      });
    } catch (e) { rebuildDeskWhenReady(); }
  }
  // v3.6.x：图片组件——启动渲染 + 点击/查看器初始化 + 切联系人重渲染
  renderDeskImages();
  setupDeskImageClick();
  setupDeskImageViewerClose();
  document.addEventListener('contact-switched', renderDeskImages);
  // v3.7.x：文字/倒计时组件——启动渲染 + 点击初始化 + 切联系人重渲染
  renderDeskTexts();
  setupDeskTextClick();
  renderDeskCountdowns();
  setupDeskCountdownClick();
  document.addEventListener('contact-switched', renderDeskTexts);
  document.addEventListener('contact-switched', renderDeskCountdowns);

  // ===== v3.6.x：卡片自由摆放（装修模式：上移/下移/移除；新增页可添加卡片） =====
  // 组件 id 列表（对应 template.html 中 [data-desk-widget]）；组件节点唯一，
  // 「添加」= 把节点移动到目标页（节点移动不重建，内部事件绑定保留）
  const WIDGET_IDS = ['deco', 'quote-row', 'checkin', 'apps', 'music', 'p2apps', 'memo-row', 'week', 'weekend', 'desk-clock', 'desk-calendar', 'desk-timer', 'desk-anniv', 'desk-period',
    'app-chat', 'app-group-chat', 'app-home', 'app-mail', 'app-feed', 'app-calendar', 'app-memory', 'app-divination', 'app-note', 'app-music', 'app-stats', 'app-interact', 'app-checkin', 'p3apps', 'app-period', 'app-accounting', 'app-garden',     'app-tongpin', 'app-shenshou', 'app-water', 'app-eat', 'app-pomo', 'app-cjian', 'app-memo-arc', 'app-my-arc', 'app-room', 'app-piggy', 'app-memo'];
  const WIDGET_NAMES = {
    deco: '纪念日卡', 'quote-row': '今日情话 / 已摸鱼', checkin: '打卡横幅', apps: '功能图标(整组)',
    music: '音乐播放器', p2apps: '第二页功能图标(整组)', 'memo-row': '今日备忘 / 心情', week: '本周日常', weekend: '摸鱼倒计时（周末）',
    'desk-clock': '时钟', 'desk-calendar': '月历', 'desk-timer': '计时器', 'desk-anniv': '纪念日倒计时', 'desk-period': '经期倒计时',
    'app-chat': '聊天图标', 'app-group-chat': '群聊图标', 'app-home': '主页图标', 'app-mail': '信箱图标', 'app-feed': '朋友圈图标',
    'app-calendar': '日历图标', 'app-memory': '纪念图标', 'app-divination': '占卜图标', 'app-note': '收藏图标',
    'app-music': '音乐图标', 'app-stats': '聊天统计图标', 'app-interact': '提问记录图标', 'app-checkin': '寻踪图标',
    'p3apps': '第三页功能图标(整组)', 'app-period': '经期记录图标', 'app-accounting': '记账图标', 'app-garden': '花园图标',     'app-tongpin': '同频图标', 'app-shenshou': '伸手图标', 'app-water': '喝水图标', 'app-eat': '吃什么图标', 'app-pomo': '番茄钟图标',
    'app-cjian': '此间图标', 'app-memo-arc': '梦角档案图标', 'app-my-arc': '我的档案图标', 'app-room': '房间图标', 'app-piggy': '存钱罐图标', 'app-memo': '备忘录图标',
  };
  // v3.7.x：装修模式组件库静态预览缩略图（glass 质感 + 真实 SVG 图标，不依赖真实数据/事件）
  const PREV_BOX = 'display:flex;align-items:center;justify-content:center;width:78px;height:58px;border-radius:10px;background:linear-gradient(135deg,#fff,#f6f6f6);border:1px solid rgba(0,0,0,.07);box-shadow:0 1px 3px rgba(0,0,0,.06);flex-shrink:0;overflow:hidden;padding:4px;box-sizing:border-box';
  const _av = '<span style="width:15px;height:15px;border-radius:50%;background:#f2f2f2;display:flex;align-items:center;justify-content:center"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg></span>';
  const _card = (top) => '<span style="width:26px;height:34px;border-radius:6px;background:#fff;border:1px solid rgba(0,0,0,.07);display:flex;flex-direction:column;padding:4px 3px;gap:2px;box-sizing:border-box"><span style="font-size:6px;color:#bbb;font-weight:600">' + top + '</span><span style="height:3px;border-radius:2px;background:#e0e0e0;width:70%"></span><span style="height:3px;border-radius:2px;background:#eee;width:55%"></span></span>';
  const _ico = (svg) => '<span style="display:flex;align-items:center;justify-content:center">' + svg + '</span>';
  const _appIcoPrev = (label) => '<span style="display:flex;flex-direction:column;align-items:center;gap:3px"><span style="width:26px;height:26px;border-radius:8px;background:#f4f4f4;display:flex;align-items:center;justify-content:center"><span style="width:14px;height:14px;border-radius:4px;background:#ddd"></span></span><span style="font-size:6px;color:#999">' + label + '</span></span>';
  const _appIcos = [
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M5.5 10v10h13V10"/></svg>',
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13.5" rx="2.5"/><path d="M3.5 7.5L12 13l8.5-5.5"/></svg>',
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v3.5M16 3v3.5"/></svg>',
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S4.5 15.2 4.5 9.9A4.9 4.9 0 0112 7.1a4.9 4.9 0 017.5 2.8c0 5.3-7.5 10.6-7.5 10.6z"/></svg>',
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M12 8.5l1.15 2.4 2.4 1.15-2.4 1.15L12 15.6l-1.15-2.4-2.4-1.15 2.4-1.15z"/></svg>',
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h11a1 1 0 011 1v16l-6.5-4-6.5 4v-16a1 1 0 011-1z"/></svg>',
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  ];
  const WIDGET_PREV_HTML = {
    deco: '<span style="display:flex;gap:3px;align-items:center">' + _av + '<svg width="10" height="10" viewBox="0 0 24 24" fill="#ccc"><path d="M12 21s-7-4.5-9-8.5a4.5 4.5 0 019-3 4.5 4.5 0 019 3c-2 4-9 8.5-9 8.5z"/></svg>' + _av + '</span>',
    'quote-row': '<span style="display:flex;gap:4px">' + _card('情话') + _card('摸鱼') + '</span>',
    checkin: '<span style="display:flex;align-items:center;gap:4px;width:64px;height:22px;padding:0 6px;border-radius:11px;background:#fff;border:1px solid rgba(0,0,0,.07);box-sizing:border-box"><svg width="9" height="9" viewBox="0 0 24 24" fill="#ccc"><path d="M12 21s-7-4.5-9-8.5a4.5 4.5 0 019-3 4.5 4.5 0 019 3c-2 4-9 8.5-9 8.5z"/></svg><span style="flex:1;font-size:6px;color:#999">一起摸鱼</span><span style="font-size:6px;color:#fff;background:#111;padding:1px 5px;border-radius:5px">打卡</span></span>',
    apps: '<span style="display:grid;grid-template-columns:repeat(3,14px);gap:4px">' + _appIcos.map(_ico).join('') + '</span>',
    music: '<span style="display:flex;gap:5px;align-items:center;width:64px"><span style="width:26px;height:26px;border-radius:7px;background:#f4f4f4;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span><span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="height:3px;border-radius:2px;background:#ccc;width:90%"></span><span style="height:3px;border-radius:2px;background:#eee;width:60%"></span><span style="height:2px;border-radius:1px;background:#111;width:40%"></span></span></span>',
    p2apps: '<span style="display:grid;grid-template-columns:repeat(2,16px);gap:4px">' + _appIcos.slice(0, 4).map(_ico).join('') + '</span>',
    'memo-row': '<span style="display:flex;gap:4px">' + _card('备忘') + _card('心情') + '</span>',
    week: '<span style="display:flex;gap:3px;align-items:center">' + ['日','一','二','三','四','五','六'].map((d, i) => '<span style="width:7px;height:7px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:5px;' + (i === 3 ? 'background:#111;color:#fff;font-weight:700' : 'background:#f0f0f0;color:#bbb') + '">' + d + '</span>').join('') + '</span>',
    weekend: '<span style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:56px;height:38px;border-radius:8px;background:#fff;border:1px solid rgba(0,0,0,.07);gap:1px"><span style="font-size:7px;color:#bbb">离周末还有</span><span style="font-size:13px;font-weight:700;color:#333">3 天</span></span>',
    'desk-clock': '<span style="display:flex;flex-direction:column;align-items:center;gap:2px"><span style="font-size:18px;font-weight:700;color:#222;letter-spacing:1px;font-variant-numeric:tabular-nums">12:30</span><span style="font-size:7px;color:#aaa">星期一 · 8 月 19 日</span></span>',
    'desk-calendar': '<span style="display:grid;grid-template-columns:repeat(7,6px);gap:2px">' + Array.from({ length: 21 }, (_, i) => '<span style="width:6px;height:6px;border-radius:2px;' + (i === 10 ? 'background:#111' : 'background:#eee') + '"></span>').join('') + '</span>',
    'desk-timer': '<span style="display:flex;flex-direction:column;align-items:center;gap:3px"><span style="font-size:14px;font-weight:700;color:#222;font-variant-numeric:tabular-nums">00:00.0</span><span style="display:flex;gap:3px"><span style="font-size:5px;color:#666;background:#f0f0f0;padding:1px 4px;border-radius:4px">开始</span><span style="font-size:5px;color:#666;background:#f0f0f0;padding:1px 4px;border-radius:4px">重置</span></span></span>',
    'desk-anniv': '<span style="display:flex;flex-direction:column;align-items:center;gap:1px"><span style="font-size:7px;color:#bbb">距下一个纪念日</span><span style="font-size:15px;font-weight:700;color:#333">30 天</span><span style="font-size:6px;color:#999">生日 · 9 月 18 日</span></span>',
    'desk-period': '<span style="display:flex;flex-direction:column;align-items:center;gap:1px"><span style="font-size:7px;color:#e85a8f">距下次经期</span><span style="font-size:15px;font-weight:700;color:#e85a8f">5 天</span><span style="font-size:6px;color:#999">周期第 23 天</span></span>',
    'app-chat': _appIcoPrev('聊天'), 'app-group-chat': _appIcoPrev('群聊'), 'app-home': _appIcoPrev('主页'), 'app-mail': _appIcoPrev('信箱'), 'app-feed': _appIcoPrev('朋友圈'),
    'app-calendar': _appIcoPrev('日历'), 'app-memory': _appIcoPrev('纪念'), 'app-divination': _appIcoPrev('占卜'), 'app-note': _appIcoPrev('收藏'),
    'app-music': _appIcoPrev('音乐'), 'app-stats': _appIcoPrev('统计'), 'app-interact': _appIcoPrev('提问'), 'app-checkin': _appIcoPrev('寻踪'),
    'app-period': _appIcoPrev('经期'), 'app-accounting': _appIcoPrev('记账'), 'app-garden': _appIcoPrev('花园'),     'app-tongpin': _appIcoPrev('同频'), 'app-shenshou': _appIcoPrev('伸手'), 'app-water': _appIcoPrev('喝水'), 'app-eat': _appIcoPrev('吃什么'), 'app-pomo': _appIcoPrev('番茄钟'), 'p3apps': _appIcoPrev('经期'),
    'app-cjian': _appIcoPrev('此间'), 'app-memo-arc': _appIcoPrev('梦角档案'), 'app-my-arc': _appIcoPrev('我的档案'), 'app-room': _appIcoPrev('房间'), 'app-piggy': _appIcoPrev('存钱罐'), 'app-memo': _appIcoPrev('备忘录'),
  };
  // 隐藏池：被移除的组件暂存（display:none），可从组件库重新添加
  function ensureWidgetPool() {
    let pool = document.getElementById('desk-widget-pool');
    if (!pool) {
      pool = document.createElement('div');
      pool.id = 'desk-widget-pool';
      pool.style.display = 'none';
      document.body.appendChild(pool);
    }
    return pool;
  }
  // deskLayout 定义已上移至 buildDeskPages 之前（FIX 2026-09-15 #495，冷启动顶层调用 TDZ），
  // 原位保留此指引防误移回。
  // 保存布局（按当前 DOM 状态，含隐藏池外的所有页）
  const saveDeskLayout = () => {
    const slides = Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide'));
    const lay = slides.map(s => Array.prototype.slice.call(s.querySelectorAll('[data-desk-widget]')).map(n => n.getAttribute('data-desk-widget')));
    // v3.27.x（#140）：写前防损坏——非数组/页数超界/组件 id 重复（嵌套遍历或并发装修
    // 可产生重复 id，回填后校验必失败 → 全卡进隐藏池复发）。异常时放弃本次保存并清除，
    // 保持 template 默认桌面，不把坏值固化进 IDB。
    try {
      const seen = {};
      const ok = Array.isArray(lay) && lay.length >= DESK_PAGE_MIN && lay.length <= DESK_PAGE_MAX &&
        lay.every(function (page) { return Array.isArray(page) && page.every(function (w) { return typeof w === 'string' && !seen[w] && (seen[w] = 1); }); });
      if (!ok) { try { store.remove('desk-layout'); } catch (e) {} return lay; }
    } catch (e) {}
    store.set('desk-layout', JSON.stringify(lay));
    return lay;
  };
  // v3.6.x：空白页提示显隐——有组件/图片的页内联隐藏（盖掉装修态 CSS 的 display:block），
  // 空页恢复为空（由 CSS 决定：仅装修模式显示，退出装修后空白页保持干净）。
  // 注：syncPageHint 声明在 IIFE 顶部（启动阶段 applyDeskLayout 会调用）
  // 按布局重建：把组件节点移动到对应页（默认布局保持 DOM 原状，不写布局）
  // v3.8.x：顺序修复——原实现只移动「不在本页」的节点，已在页内的节点即使
  // 顺序与布局不一致也不重排（刷新后用户排的顺序被 template 默认顺序覆盖）；
  // 且第 0/1 页没有 .desk-page-add，移入节点被 append 到页尾，顺序必然错乱。
  // 现在分两步：先移入不在本页的节点，再按布局数组顺序校正本页 widget 顺序
  //（顺序已一致则跳过，避免无谓 DOM 抖动；图片/文字组件有自己的排序存储，
  // 不在 desk-layout 内，重排时保持其节点不动）。
  const applyDeskLayout = () => {
    const lay = deskLayout();
    // FIX 2026-09-04 #151：无布局 ≠ 什么都不做——先按模板快照还原默认排布再返回，
    // 归还被上个桌面布局扫进隐藏池的本桌组件（见 TEMPLATE_DESK_ARR 注释）
    if (!lay) { restoreTemplateDesk(); return; }
    const slides = Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide'));
    // v3.7.x：单个功能图标仍在 app-grid 内（未被移出作独立组件）时跳过——
    // 它由 app-grid 容器管理（grid 4 列横排），移到 slide 会脱离 grid 布局
    // 变成竖向排列（刷新后图标从横变竖）。与池逻辑的保护一致。
    const inGrid = (wid) => {
      if (wid.indexOf('app-') === 0) {
        const n = document.querySelector('[data-desk-widget="' + wid + '"]');
        return !!(n && n.closest('.app-grid'));
      }
      return false;
    };
    lay.forEach((pageWidgets, pi) => {
      const slide = slides[pi];
      if (!slide) return;
      const wids = pageWidgets || [];
      // 1) 移入不在本页的节点（插入到「+ 添加卡片」按钮之前）
      wids.forEach(wid => {
        if (inGrid(wid)) return;
        const node = document.querySelector('[data-desk-widget="' + wid + '"]');
        if (!node || node.parentNode === slide) return;
        const addBtn = slide.querySelector('.desk-page-add');
        if (addBtn) slide.insertBefore(node, addBtn);
        else slide.appendChild(node);
      });
      // 2) 顺序校正：比对当前 DOM 顺序与布局数组顺序，不一致才重排
      const want = wids.filter(wid => {
        if (inGrid(wid)) return false;
        const n = document.querySelector('[data-desk-widget="' + wid + '"]');
        return !!(n && n.parentNode === slide);
      });
      const cur = Array.prototype.slice.call(slide.querySelectorAll('[data-desk-widget]'))
        .map(n => n.getAttribute('data-desk-widget'))
        .filter(w => want.indexOf(w) >= 0);
      if (cur.join('|') !== want.join('|') && want.length) {
        const addBtn = slide.querySelector('.desk-page-add');
        want.forEach(wid => {
          const node = document.querySelector('[data-desk-widget="' + wid + '"]');
          if (!node) return;
          if (addBtn) slide.insertBefore(node, addBtn);
          else slide.appendChild(node);
        });
      }
      syncPageHint(slide);
    });
    // 布局外的组件 → 隐藏池
    // v3.27.x（#140）：列在「不存在的页」上的组件也视为有主——只隐藏「布局数组里
    // 完全找不到」的组件。否则页面数被外部改动（删页/校验失败重建）时，布局后半段
    // 指向缺失页的组件会被误判为「布局外」整批进隐藏池，加重「卡片大部分不显示」。
    const pool = ensureWidgetPool();
    const inAnyPage = {};
    lay.forEach(function (page) { (page || []).forEach(function (w) { inAnyPage[w] = 1; }); });
    WIDGET_IDS.forEach(wid => {
      // v3.7.x：apps/p2apps 老兼容——之前 app-grid 没 data-desk-widget，老 layout 不含它们；
      // 加 data-desk-widget 后若按常规移池会把老用户的功能图标藏掉，故跳过池逻辑保持原位
      // v3.26.x：p3apps 同因——第三页图标组（经期/记账/花园/喝水/吃什么/番茄钟）老 layout
      // 不含它，按常规移池会让第三页整组功能图标消失，故同样跳过池逻辑保持原位
      if (wid === 'apps' || wid === 'p2apps' || wid === 'p3apps') return;
      const node = document.querySelector('[data-desk-widget="' + wid + '"]');
      if (!node) return;
      // v3.7.x：单个功能图标仍在 app-grid 内（未被移出）时跳过池逻辑，保持原位
      if (wid.indexOf('app-') === 0 && node.closest('.app-grid')) return;
      if (inAnyPage[wid]) return; // 布局里有名（哪怕页已不存在）→ 不进池
      const inLay = lay.some(page => (page || []).indexOf(wid) >= 0);
      if (!inLay && node.parentNode !== pool) pool.appendChild(node);
    });
    // FIX 2026-09-04 #156：布局应用完毕后重应用一次群聊模式——群聊开启期间占卜图标必须
    // 停在隐藏池；否则任何 bare applyDeskLayout 都会把占卜按 desk-layout 从池里放回桌面
    //（典型复活路径：启动 150ms ensureP2AppsBelowWeekend 兜底重跑发生在 applyGroupChatMode
    // 首次应用之后）。applyGroupChatMode 为同 IIFE 函数声明（提升可用）；群聊关闭时该调用
    // 对已归位图标是无操作，且其关闭分支回引 applyDeskLayout 最多两层即收敛（幂等）。
    try { applyGroupChatMode(); } catch (e) {}
    if (window.deskRebuild) window.deskRebuild();
    try { renderDeskWidgets(); } catch (e) {}
  };
  applyDeskLayout();
  // #861：暴露口包一层「落位后补套隐藏名单」——applyHiddenIcons 原本只在加载期跑一次
  //（彼时备忘录/心意市集/心意柜/喝水/吃什么/存钱罐/番茄钟/同频/伸手等动态图标尚未注入＝
  // 躲过隐藏），下一次再跑要等 contact-switched（含 contacts.js #88 启动校正的静默切换）
  // ＝「启动时看得见、切一次桌面就没了」（红米 K80 实报「第三页备忘录图标莫名其妙不见了」）。
  // 各注入方追加图标后都会调 window.applyDeskLayout；不能放在 applyDeskLayout 末尾——
  // 其 !lay 分支（默认桌面无布局）提前 return 走不到（无头实证），包在暴露口才覆盖全部路径。
  // contact-switched 直挂本函数不经此口，但该事件本就另有 applyHiddenIcons 监听，无缺口。
  window.applyDeskLayout = function () { try { applyDeskLayout(); } finally { try { applyHiddenIcons(); } catch (e) {} } };
  document.addEventListener('contact-switched', applyDeskLayout);
  // v3.10.x：经期倒计时组件默认放第三页顶部（template 已置）。
  // 已装修过的用户（desk-layout 存在且不含 desk-period）自动加新页放 desk-period，不破坏现有布局。
  function ensureDeskPeriod() {
    const lay = deskLayout();
    const node = document.querySelector('[data-desk-widget="desk-period"]');
    if (!node) return;
    if (!lay) {
      // 新用户：desk-period 应在第三页顶部（template 默认），被其他联系人移走则移回
      const slides = pagesBox.querySelectorAll('.page-slide');
      const p3 = slides[2];
      if (p3 && node.parentNode !== p3) {
        const p3apps = p3.querySelector('[data-desk-widget="p3apps"]');
        if (p3apps) p3.insertBefore(node, p3apps);
        else p3.appendChild(node);
        try { renderDeskWidgets(); } catch (e) {}
      }
      return;
    }
    if (lay.some(page => (page || []).indexOf('desk-period') >= 0)) return; // 已含
    // FIX 2026-09-13 #400：用户装修「移出此页」显式删过经期卡（desk-period-removed=1）时
    // 不再自动补位——原迁移逻辑无一次性语义，移出后每次启动/切桌面都被拉回、还会新建
    // 一页（实测 3 页变 4 页，#380 memo-row 强迁同族）；组件库显式加回时清标记。
    let dpRemoved = false;
    try { dpRemoved = store.get('desk-period-removed') === '1'; } catch (e) {}
    if (dpRemoved) return;
    if (deskPageCount() >= DESK_PAGE_MAX) return; // 达上限不加页
    store.set('desk-page-count', String(deskPageCount() + 1));
    buildDeskPages();
    const slides = pagesBox.querySelectorAll('.page-slide');
    const newSlide = slides[slides.length - 1];
    if (!newSlide) return;
    const addBtn = newSlide.querySelector('.desk-page-add');
    if (addBtn) newSlide.insertBefore(node, addBtn);
    else newSlide.appendChild(node);
    const newLay = lay.slice();
    while (newLay.length < slides.length - 1) newLay.push([]);
    newLay.push(['desk-period']);
    store.set('desk-layout', JSON.stringify(newLay));
    if (window.deskRebuild) window.deskRebuild();
    try { renderDeskWidgets(); } catch (e) {}
  }
  ensureDeskPeriod();
  // v3.15.x 修复：全新冷启动时序里 desk-period 曾流失进隐藏池——buildDeskPages 按
  // desk-page-count 默认 2 页收缩时把静态第三页整页删进池，第三页由 ensureP3 在
  // setTimeout(50) 重建，而 ensureDeskPeriod 只在 0ms 同步跑一次（当时 slides[2] 尚不
  // 存在 → 直接 return），此后无人再补位，经期卡从此留在池里，第三页缺首卡。
  // 补两次延迟重跑（200/600ms，均晚于 ensureP3 的 50ms）：!lay 分支只在「新用户且
  // 节点不在第三页」时移回，已装修用户走原 lay 分支语义不变，不破坏删除意图。
  // 重跑后若 memo-row（150ms 兜底先落位）排在了经期卡前面，校正回模板默认顺序
  // 「经期卡 → 备忘心情行 → p3apps」。
  function ensureDeskPeriodP3Order() {
    ensureDeskPeriod();
    try {
      // FIX 2026-09-13 #405：换序只在未装修（无 desk-layout）桌面兜底——原逻辑每次启动都把
      // 第三页经期卡强制排到备忘卡前面，用户装修「上移/下移/拖拽」调换两卡顺序后刷新/切桌面
      // 即被打回（同 #380/#400「迁移覆盖用户显式操作」家族）；有布局一律尊重（applyDeskLayout
      // 已按存储排序，#380 先例）。
      if (deskLayout()) return;
      const p3 = pagesBox.querySelectorAll('.page-slide')[2];
      if (!p3) return;
      const dp = p3.querySelector('[data-desk-widget="desk-period"]');
      const mr = p3.querySelector('[data-desk-widget="memo-row"]');
      if (dp && mr && Array.prototype.indexOf.call(p3.children, dp) > Array.prototype.indexOf.call(p3.children, mr)) {
        p3.insertBefore(dp, mr);
      }
    } catch (e) {}
  }
  setTimeout(ensureDeskPeriodP3Order, 200);
  setTimeout(ensureDeskPeriodP3Order, 600);
  document.addEventListener('contact-switched', ensureDeskPeriod);
  // v3.13.x：今日备忘/心情卡默认位置改为第三页「经期倒计时」下方（template 已移）。
  // 老用户 desk-layout 里 memo-row 在第一/二页的自动迁到第三页经期卡下方。
  // FIX 2026-09-12 #380 迁移只在发布时跑一次的语义早已达成（v3.13.x 时代上线，活跃用户
  // 早已迁完），如今存量为 0/1 页的 desk-layout 只可能是用户手动换页的结果——再无条件
  // 迁移＝每次启动/切桌面都把「今日备忘/心情」强制打回第三页（小米15 Pro 等多机型反馈
  // 「换去第二页刷新又回第三页」）。改为有布局一律尊重，只保留无布局时的 DOM 兜底。
  function ensureMemoRowP3() {
    const node = document.querySelector('[data-desk-widget="memo-row"]');
    if (!node || !pagesBox) return;
    const slides = Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide'));
    const p3 = slides[2];
    if (!p3) return;
    const lay = deskLayout();
    const placeUnderPeriod = () => {
      const dp = p3.querySelector('[data-desk-widget="desk-period"]');
      if (dp && dp.parentNode === p3) p3.insertBefore(node, dp.nextSibling);
      else {
        const grid = p3.querySelector('[data-desk-widget="p3apps"]');
        if (grid && grid.parentNode === p3) p3.insertBefore(node, grid);
        else p3.appendChild(node);
      }
    };
    // FIX 2026-09-12 #380 有布局一律尊重、不再迁移——memo-row 在第一/二页＝用户手动换页
    // 的结果（v3.13.x 的一次性迁移对存量早已完成），再强迁＝「换去第二页刷新又回第三页」(#380)
    if (lay) return;
    // 无布局（未装修）：模板默认就在第三页经期卡下方；被删页等流程挪走/进池则移回
    if (node.closest('.page-slide') !== p3) placeUnderPeriod();
  }
  ensureMemoRowP3();
  setTimeout(ensureMemoRowP3, 150); // 等 buildDeskPages 的 setTimeout(ensureP3) 补齐第三页后兜底一次
  document.addEventListener('contact-switched', ensureMemoRowP3);

  // ===== v3.13.x：第二页改版迁移（仿 ensureMemoRowP3 先例） =====
  // ① 功能图标组（p2apps：音乐/聊天统计/提问记录/寻踪/花园/此间 + 动态注入的同频/伸手）
  //    默认位置改为「周末倒计时」（摸鱼组件）下方——template 已移；
  //    老用户 desk-layout 里 p2apps 排在 weekend 前面的自动换序到其后（DOM+存储同步改写），
  //    已在其后的不动；两组件不在同一页 / weekend 已被用户移除进池的尊重现状不强行挪。
  // ② 第三页 p3apps 网格里的 花园/同频/伸手 图标归入第二页网格第二排（同频/伸手由 p2-features
  //    注入时直接落第二页，见该文件；此处兜底搬运仍留在第三页网格内的默认位节点）。
  //    喝水已默认移至第三页，绝不再拖回第二页。只搬仍位于 .p3-grid 内的节点——
  //    用户手动拖出成独立组件 / 移除进隐藏池的尊重不找回。
  // 每联系人桌面独立（desk-layout 按桌面命名空间存储，切联系人各自触发）。
  function ensureP2SecondRowIcons() {
    // FIX 2026-09-13 #405：p3→p2 救回迁移只跑一次——原逻辑每次启动/切联系人都把仍在
    // 第三页网格的花园/同频/伸手拽回第二页，用户故意把图标拖回第三页网格后刷新即被拽回
    //（同 #380/#400 家族）。当前模板静态花园已在 p2-grid、同频/伸手由 p2-features 直落
    // p2-grid，本函数对存量用户已是空转兜底，首跑（无论是否实际搬动）打标记
    // p2icons-p3-mig=1，此后尊重用户摆放不再扫描拽回。
    if (store.get('p2icons-p3-mig') === '1') return;
    store.set('p2icons-p3-mig', '1');
    const p2g = document.querySelector('.app-grid.p2-grid');
    const p3g = document.querySelector('.app-grid.p3-grid');
    if (!p2g) return;
    let moved = false;
    ['app-tongpin', 'app-shenshou', 'app-garden'].forEach(wid => {
      const n = document.querySelector('[data-desk-widget="' + wid + '"]');
      if (!n || !p3g || n.parentNode !== p3g) return;
      p2g.appendChild(n); moved = true;
    });
    if (!moved) return;
    // 归位后按新默认排序追加在已有图标之后：花园 此间 同频 伸手（此间为模板静态图标，
    // 在 p2-grid 内；喝水留在第三页）
    ['app-garden', 'app-cjian', 'app-tongpin', 'app-shenshou'].forEach(wid => {
      const n = document.querySelector('[data-desk-widget="' + wid + '"]');
      if (n && n.parentNode === p2g) p2g.appendChild(n);
    });
  }
  function ensureP2AppsBelowWeekend() {
    const node = document.querySelector('[data-desk-widget="p2apps"]');
    const we = document.querySelector('[data-desk-widget="weekend"]');
    ensureP2SecondRowIcons();
    if (!node || !we) return;
    const domBefore = (() => {
      const s1 = node.closest('.page-slide');
      return !!(s1 && s1 === we.closest('.page-slide') &&
        Array.prototype.indexOf.call(s1.children, node) < Array.prototype.indexOf.call(s1.children, we));
    })();
    const lay = deskLayout();
    if (!lay) {
      // 未装修：模板默认即在 weekend 后；被其他流程挪到前面则校正 DOM（恢复默认桌面后也走这里兜底）
      if (domBefore) node.parentNode.insertBefore(node, we.nextSibling);
      return;
    }
    const pi = lay.findIndex(page => (page || []).indexOf('weekend') >= 0);
    const pj = lay.findIndex(page => (page || []).indexOf('p2apps') >= 0);
    if (pi < 0 || pj !== pi) return; // weekend 不在任何页(已移除)或两组不在同一页：尊重现状
    const pw = lay[pi] || [];
    // FIX 2026-09-13 #405：存储换序只跑一次（补一次性迁移语义）——原逻辑每次启动/切桌面
    // 都把 p2apps 强制换回 weekend 下方，用户装修把 p2apps 挪到摸鱼卡上方后刷新/切联系人
    // 即被改回（同 #380/#400「迁移覆盖用户显式操作」家族）。有布局的首跑即打标记
    // p2apps-order-mig=1（无论当次顺序是否需要换序，保证「首跑恰逢顺序正确」的用户之后
    // 挪动也受尊重；必须在下方 ni>wi 早退分支之前落盘——首版放在早退之后被探针
    // verify-desk-order-respect P1 抓包），首跑且顺序错误时执行一次换序迁移，此后一律
    // 尊重 desk-layout 用户排序（上方「存储已正确只校正 DOM」分支不受影响，仍幂等）。
    const p2migDone = store.get('p2apps-order-mig') === '1';
    if (!p2migDone) store.set('p2apps-order-mig', '1');
    const wi = pw.indexOf('weekend'), ni = pw.indexOf('p2apps');
    if (ni < 0 || wi < 0 || ni > wi) {
      // 存储已正确但 DOM 仍错位（如老版本写入顺序）：只校正 DOM
      if (domBefore) node.parentNode.insertBefore(node, we.nextSibling);
      return;
    }
    if (p2migDone) return;
    // 首跑换序迁移：摘出 p2apps 插到 weekend 后一位
    lay[pi] = pw.filter(w => w !== 'p2apps');
    lay[pi].splice((lay[pi].indexOf('weekend')) + 1, 0, 'p2apps');
    store.set('desk-layout', JSON.stringify(lay));
    if (domBefore || node.closest('.page-slide') !== we.closest('.page-slide')) {
      we.parentNode.insertBefore(node, we.nextSibling);
    }
    try { window.applyDeskLayout(); } catch (e) {} // 重跑一次布局应用刷新各页提示与顺序
  }
  ensureP2AppsBelowWeekend();
  setTimeout(ensureP2AppsBelowWeekend, 150); // 等 buildDeskPages/ensureP3 收尾后兜底一次
  window.ensureP2AppsBelowWeekend = ensureP2AppsBelowWeekend;
  window.ensureP2SecondRowIcons = ensureP2SecondRowIcons;
  document.addEventListener('contact-switched', () => { try { ensureP2AppsBelowWeekend(); } catch (e) {} });
  document.addEventListener('contact-switched', () => { applyDeskFontPct(getDeskFontPct()); applyDeskCardPct(getDeskCardPct()); });
  document.addEventListener('contact-switched', () => { const sp = getBgPresetName(); if (sp) { const p = BG_PRESETS.find(b => b.name === sp); if (p) applyPhoneBgPreset(p.css); else clearPhoneBg(); } syncBgPresetUI(); });

  // v3.14.x 修复：vivo/OPPO/真我等 Edge 内核 IndexedDB 打开/回填较慢，且 localStorage
  // 偶发写入失败——启动阶段上方 applyDeskLayout() 在恢复到 localStorage 前读到的是
  // 旧/空 desk-layout，回填完成后又没有任何机制再应用一次，于是桌面小组件"保存后
  // 重开又回到上次位置"。现在监听 mochi-restore-done（idb.js 回填完成即派发），
  // 再完整重放一次布局应用，让 IDB 权威布局最终落到 DOM。
  // 幂等安全：applyDeskLayout 仅在 DOM 顺序与存储不一致时才重排（比对 cur/want），
  // 已一致则跳过，不会抖动；不重放 ensureDeskPeriod——它在「删页进池」场景下会
  // 把用户已删除的经期卡拉回第三页（延迟执行时页面已自愈回 3 页），破坏删除意图。
  const reapplyDeskAfterRestore = () => {
    try {
      ensureMemoRowP3();
      ensureP2AppsBelowWeekend();
    } catch (e) {}
    try { window.applyDeskLayout(); } catch (e) {}
    try { if (window.ensureP2SecondRowIcons) window.ensureP2SecondRowIcons(); } catch (e) {}
  };
  let _reapplyScheduled = false;
  document.addEventListener('mochi-restore-done', () => {
    if (_reapplyScheduled) return;
    _reapplyScheduled = true;
    // 回填是分批异步的，desk-layout 可能在事件派发后一小会儿才落到 localStorage；
    // 用多次短延时覆盖不同内核的回填时序（幂等可重复调用）
    [0, 120, 400].forEach(del => setTimeout(reapplyDeskAfterRestore, del));
    // 本会话后续再收到 restore 事件不再重放（只拾重新载入时的一次消费）
    setTimeout(() => { _reapplyScheduled = false; }, 2000);
  });

  // v3.8.x：群聊模式——开启后桌面聊天按钮右侧显示「群聊」按钮，占卜按钮隐藏（FIX 2026-09-04
  // #156：无论占卜图标当前在首页图标组、其他页还是组件库加回的位置，都强制收进隐藏池）；
  // 关闭恢复原样。须在 applyDeskLayout 之后执行（覆盖 desk-layout 对群聊/占卜图标的处置）。
  // group-chat-enabled 为全局键（v3.10.x 起群聊是全局功能），默认关闭。
  function applyGroupChatMode() {
    try {
      // v3.10.x：group-chat-enabled 改全局存储（群聊是全局功能），读时回退旧版每桌面值完成迁移
      let en = false;
      try { const v = window.xyStore ? window.xyStore('xy-home-v2').get('group-chat-enabled') : null; if (v !== null && v !== undefined) en = v === '1'; else en = store.get('group-chat-enabled') === '1'; } catch (e) {}
      // FIX 2026-09-13 #393：用户意图标记——装修组件库显式加回占卜（pin=1）时群聊模式不再强制收池
      //（尊重显式摆放，#156「无论在哪都收池」仅对未表态用户生效）；群聊关闭时清除标记恢复 v3.8
      // 默认语义（下次开启重新隐藏，可再次显式加回）。
      let divPin = false;
      try { divPin = store.get('divination-desk-pin') === '1'; } catch (e) {}
      // FIX 2026-09-13 #400：群聊图标位置意图标记——用户从组件库显式加到其他页（pin=1）时
      // 不再强制拽回聊天右侧（只保证可见）；群聊关闭时清标记恢复默认语义。
      let gcPin = false;
      try { gcPin = store.get('group-chat-desk-pin') === '1'; } catch (e) {}
      const mainGrid = document.querySelector('.app-grid[data-app="main"]');
      const pool = ensureWidgetPool();
      const chatBtn = document.querySelector('.app[data-app="chat"]');
      const gcBtn = document.querySelector('.app[data-app="group-chat"]');
      const divBtn = document.querySelector('.app[data-app="divination"]');
      const memBtn = document.querySelector('.app[data-app="memory"]');
      if (en) {
        // 群聊按钮：默认强制移到第一页 app-grid 的 chat 后面并显示；
        // FIX 2026-09-13 #400：用户从组件库显式加到其他页（group-chat-desk-pin=1）时
        // 尊重摆放不再拽回（同 #393 占卜意图标记约定），仅保证可见。
        if (gcBtn) {
          if (!gcPin) {
            if (mainGrid && chatBtn && gcBtn.parentNode !== mainGrid) {
              mainGrid.insertBefore(gcBtn, chatBtn.nextSibling);
            } else if (mainGrid && chatBtn && gcBtn.previousElementSibling !== chatBtn) {
              mainGrid.insertBefore(gcBtn, chatBtn.nextSibling);
            }
          }
          gcBtn.hidden = false;
        }
        // FIX 2026-09-04 #156 群聊模式没隐藏桌面占卜图标（用户反馈）：原逻辑只在占卜图标
        // 仍在第一页 app-grid（模板原位）时才收进隐藏池，装修过桌面（占卜被拖出图标组
        // 排在任意页顶层）或从组件库重新加回后，占卜图标一直显示在桌面上。改为群聊开启
        // 期间无论占卜在桌面哪个位置（图标组/任意页）都强制收进隐藏池（已在池则不动）；
        // 关闭后由 else 分支放回首页图标组默认位（v3.8 原语义）。
        // FIX 2026-09-13 #393：用户在装修组件库显式加回过占卜（divination-desk-pin=1）时豁免
        // 强制收池——否则退出装修即被收回，「装修拉出来也加不上」（多机型用户实报）。
        if (divBtn && divBtn.parentNode !== pool && !divPin) {
          pool.appendChild(divBtn);
        }
      } else {
        // 群聊关闭：清除占卜显式加回标记（恢复 v3.8 默认语义；只在标记存在时写，避免每次切换联系人空写）
        if (divPin) { try { store.set('divination-desk-pin', '0'); } catch (e) {} }
        // FIX 2026-09-13 #400：群聊关闭同样清除群聊图标位置标记（下次开启回聊天右侧默认位）
        if (gcPin) { try { store.set('group-chat-desk-pin', '0'); } catch (e) {} }
        // 群聊按钮：移到隐藏池（脱离 app-grid 避免占位）
        if (gcBtn && gcBtn.parentNode !== pool) {
          pool.appendChild(gcBtn);
        }
        // 占卜按钮：若在隐藏池，移回第一页 app-grid 的 memory 后面（默认位）。
        // FIX 2026-09-04 #156 语义：群聊开启期间占卜被强制收池（无论原位置），关闭后
        // 统一回首页图标组默认位（v3.8 原语义）；desk-layout 里残留的占卜条目因图标
        // 已回到网格内被「网格管理」规则忽略（inGrid 跳过），下次装修保存自动校正。
        if (divBtn && divBtn.parentNode === pool && mainGrid) {
          if (memBtn) mainGrid.insertBefore(divBtn, memBtn.nextSibling);
          else mainGrid.appendChild(divBtn);
        }
      }
    } catch (e) {}
  }
  applyGroupChatMode();
  document.addEventListener('contact-switched', applyGroupChatMode);
  document.addEventListener('group-chat-mode-changed', applyGroupChatMode);
  // 装修模式退出后重应用（用户可能在装修时移动了群聊/占卜按钮）
  document.addEventListener('decor-exited', applyGroupChatMode);
  // v3.9.x：idbRestore 异步回填完成后再应用一次——group-chat-enabled 是小键，
  // 正常情况同步写 localStorage，启动时即可读到。但 localStorage 配额紧张/被浏览器
  // 清理时该键只在 IndexedDB，applyGroupChatMode 同步首次调用读到 null→群聊按钮移入
  // 隐藏池；idbRestore 回填后 store.get 能读到 '1'，但此前不会重新触发 applyGroupChatMode
  //（contact-switched/group-chat-mode-changed 均不派发），群聊按钮留在池中"自己关闭"。
  // 监听 mochi-restore-done 在回填后重应用，与 buildDeskPages 的 rebuildDeskWhenReady 同模式。
  if (window.__mochiDataReady) applyGroupChatMode();
  else document.addEventListener('mochi-restore-done', applyGroupChatMode);

  // ===== v3.27.x #670：设置 → 工具 →【占卜】入口（#row-open-divination，模板静态行）=====
  // 背景（用户直派）：群聊模式开启期间桌面占卜图标按 #156 收进隐藏池（第一页留给「群聊」），
  // 桌面就找不到占卜了——用户要求把「打开占卜」放到「设置 → 工具」里，并在说明里讲清楚。
  // 打开路径复用桌面占卜图标的 click 处理器（divination.js 绑定，含「打开即渲染历史 +
  // 同步自动发送开关」）；图标被收进隐藏池时仍是同一个节点、监听器没丢，.click() 照样生效
  // ＝与点桌面图标行为逐字一致。图标确实不在（模板被改/被删）时才走兜底导航（同 feature-data
  // 的 openPage 写法：隐所有 .page、显 #page-divine），至少保证进得去占卜页。
  // 行下小字随群聊开关切换，把「为什么桌面没有图标」当场说明（#670 的「这点也要说明」）。
  (function () {
    const row = document.getElementById('row-open-divination');
    if (!row) return;
    const sub = document.getElementById('open-divination-sub');
    const SUB_ON = '群聊模式开启中：桌面占卜图标已收起，点这里直接打开（与点桌面图标等效，历史记录照常）';
    const SUB_OFF = '塔罗 78 张 / 雷诺曼 40 张，三种牌阵；与点桌面【占卜】图标等效';
    function openDivinePage() {
      const icon = document.querySelector('.app[data-app="divination"]');
      if (icon) { try { icon.click(); return; } catch (e) {} }
      document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
      const dp = document.getElementById('page-divine');
      if (dp) dp.hidden = false;
    }
    function groupChatOn() {
      try {
        const v = window.xyStore ? window.xyStore('xy-home-v2').get('group-chat-enabled') : null;
        if (v !== null && v !== undefined) return v === '1';
      } catch (e) {}
      try { return store.get('group-chat-enabled') === '1'; } catch (e) { return false; }
    }
    // 桌面图标是否真的被收起＝群聊开启 且 用户没在装修里显式固定占卜（#393 的
    // divination-desk-pin=1 豁免）；固定过的桌面图标照常显示，小字不能说「已收起」。
    function deskIconHidden() {
      if (!groupChatOn()) return false;
      try { return store.get('divination-desk-pin') !== '1'; } catch (e) { return true; }
    }
    function syncSub() { if (sub) sub.textContent = deskIconHidden() ? SUB_ON : SUB_OFF; }
    row.addEventListener('click', openDivinePage);
    syncSub();
    document.addEventListener('group-chat-mode-changed', syncSub);
    document.addEventListener('contact-switched', syncSub);
    // 装修里显式把占卜加回/移出桌面会改写 divination-desk-pin（#393），退出装修后重算小字
    document.addEventListener('decor-exited', syncSub);
    // 同 applyGroupChatMode：#670 也依赖全局键 group-chat-enabled，localStorage 被清理后
    // 该键可能只在 IndexedDB，idbRestore 回填完成后再同步一次小字（回填前读到的可能是空）。
    if (window.__mochiDataReady) syncSub();
    else document.addEventListener('mochi-restore-done', syncSub);
  })();

  // 组件库面板：列出所有组件 + 当前位置，点击「添加到此页」
  function openDeskLib(pageSlide, pageIdx) {
    const lib = document.createElement('div');
    lib.className = 'desk-lib';
    lib.addEventListener('click', (e) => { if (e.target === lib) lib.remove(); });
    const box = document.createElement('div');
    box.className = 'desk-lib-box';
    const title = document.createElement('div');
    title.className = 'desk-lib-title';
    title.textContent = '添加卡片到' + (pageIdx + 1 <= 2 ? (pageIdx === 0 ? '首页' : '第 ' + (pageIdx + 1) + ' 页') : '第 ' + (pageIdx + 1) + ' 页');
    const sub = document.createElement('div');
    sub.className = 'desk-lib-sub';
    sub.textContent = '组件全局唯一：选择后会从原位置移动过来';
    box.appendChild(title); box.appendChild(sub);
    // v3.26.x：组件库顶部按「小组件 / 图标」分类 Tab，点击切换
    const tabWrap = document.createElement('div');
    tabWrap.className = 'desk-lib-tabs';
    const groups = [ { key: 'widget', label: '小组件' }, { key: 'icon', label: '图标' } ];
    const panels = {};
    groups.forEach((g, gi) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'desk-lib-tab' + (gi === 0 ? ' on' : '');
      tab.textContent = g.label;
      tab.addEventListener('click', () => {
        tabWrap.querySelectorAll('.desk-lib-tab').forEach(t => t.classList.remove('on'));
        tab.classList.add('on');
        groups.forEach(x => { const p = panels[x.key]; if (p) p.style.display = (x.key === g.key) ? '' : 'none'; });
      });
      tabWrap.appendChild(tab);
    });
    box.appendChild(tabWrap);
    let iconSearch = null, iconGrid = null;
    groups.forEach(g => {
      const p = document.createElement('div');
      p.className = 'desk-lib-panel';
      p.style.display = (g.key === 'widget') ? '' : 'none';
      if (g.key === 'icon') {
        // v3.26.x：图标分类——顶部搜索框 + 紧凑网格，方便批量查找/添加管理
        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'desk-lib-search';
        search.placeholder = '搜索图标名…';
        p.appendChild(search);
        const grid = document.createElement('div');
        grid.className = 'desk-lib-grid';
        p.appendChild(grid);
        iconSearch = search; iconGrid = grid;
      }
      box.appendChild(p);
      panels[g.key] = p;
    });
    // 添加逻辑（行按钮 / 图标块共用）：把组件节点移到目标页
    const addWidgetToPage = (wid) => {
      const node = document.querySelector('[data-desk-widget="' + wid + '"]');
      if (!node) return;
      // FIX 2026-09-12 #351：功能图标入目标页【网格】排版（4 列横排、可上移/下移/
      // 拖拽定位，重进不丢），不再作为独立组件竖排。同时把该图标从其他页网格的顺序
      // 数组剔除并落盘——否则启动归位时旧页数组把它认领回去（「添加后重进回原位」）。
      if (wid.indexOf('app-') === 0) {
        const grid = pageSlide.querySelector('.app-grid');
        if (grid && grid.dataset.app) {
          const srcGrid = node.closest('.app-grid');
          grid.appendChild(node);
          document.querySelectorAll('.app-grid').forEach(g => {
            const gid = g.dataset.app;
            if (!gid || g === grid) return;
            let arr = [];
            try { arr = JSON.parse(store.get('app-icon-order-' + gid) || '[]'); } catch (e) {}
            const cleaned = arr.filter(k => k !== wid);
            if (cleaned.length !== arr.length) store.set('app-icon-order-' + gid, JSON.stringify(cleaned));
          });
          const order = Array.prototype.slice.call(grid.querySelectorAll('.app')).map(a => a.dataset.app);
          store.set('app-icon-order-' + grid.dataset.app, JSON.stringify(order));
          if (srcGrid && srcGrid !== grid) try { syncPageHint(srcGrid.closest('.page-slide')); } catch (e) {}
        } else {
          const addBtn = pageSlide.querySelector('.desk-page-add');
          if (addBtn) pageSlide.insertBefore(node, addBtn);
          else pageSlide.appendChild(node);
        }
      } else {
        const addBtn = pageSlide.querySelector('.desk-page-add');
        if (addBtn) pageSlide.insertBefore(node, addBtn);
        else pageSlide.appendChild(node);
      }
      // FIX 2026-09-13 #393：群聊模式下用户从组件库显式把占卜图标加回桌面——写意图标记
      // divination-desk-pin，applyGroupChatMode 读到标记不再强制收池（修复 #156 语义副作用：
      // 退出装修即被收回，「装修拉出来也加不上」）。标记 per-cid（store=activeStore），各桌面独立；
      // 群聊关闭时由 applyGroupChatMode 清除，恢复默认隐藏语义。
      if (wid === 'app-divination') { try { store.set('divination-desk-pin', '1'); } catch (e) {} }
      // FIX 2026-09-13 #400：组件库显式加回群聊图标＝用户自选位置——写意图标记，
      // applyGroupChatMode 不再强制拽回聊天按钮右侧（群聊关闭时清标记恢复默认）。
      else if (wid === 'app-group-chat') { try { store.set('group-chat-desk-pin', '1'); } catch (e) {} }
      // FIX 2026-09-13 #400：组件库显式加回经期倒计时卡＝撤销删除意图——清移除标记，
      // ensureDeskPeriod 恢复其「布局缺卡自动补位」的迁移语义。
      else if (wid === 'desk-period') { try { store.set('desk-period-removed', '0'); } catch (e) {} }
      syncPageHint(pageSlide);
      saveDeskLayout();
      if (window.deskRebuild) window.deskRebuild();
      lib.remove();
      toast('已添加到本页');
    };
    WIDGET_IDS.forEach(wid => {
      if (wid.indexOf('app-') === 0) {
        // 图标分类：紧凑网格块（缩略首字 + 名字），点击添加；已在本页置灰
        const node = document.querySelector('[data-desk-widget="' + wid + '"]');
        const curPage = node && node.closest('.page-slide') ? Array.prototype.indexOf.call(pagesBox.querySelectorAll('.page-slide'), node.closest('.page-slide')) : -1;
        const nm = WIDGET_NAMES[wid] || wid;
        const tile = document.createElement('div');
        tile.className = 'desk-lib-icon' + (curPage === pageIdx ? ' on' : '');
        tile.dataset.iconName = nm;
        const iprev = document.createElement('div');
        iprev.className = 'dli-prev';
        const letter = document.createElement('span');
        letter.className = 'dli-letter';
        letter.textContent = nm.charAt(0) || '?';
        iprev.appendChild(letter);
        const iname = document.createElement('div');
        iname.className = 'dli-name';
        iname.textContent = nm.replace(/图标$/, '');
        tile.appendChild(iprev); tile.appendChild(iname);
        tile.addEventListener('click', () => {
          if (curPage === pageIdx) { toast('已在本页'); return; }
          addWidgetToPage(wid);
        });
        iconGrid.appendChild(tile);
        return;
      }
      // 小组件：保持原有行式列表
      const item = document.createElement('div');
      item.className = 'desk-lib-item';
      // v3.7.x：静态预览缩略图
      const prev = document.createElement('div');
      prev.className = 'dl-prev';
      prev.style.cssText = PREV_BOX;
      prev.innerHTML = WIDGET_PREV_HTML[wid] || '';
      const meta = document.createElement('div');
      meta.className = 'dl-meta';
      const name = document.createElement('div');
      name.className = 'dl-name';
      name.textContent = WIDGET_NAMES[wid] || wid;
      const wnode = document.querySelector('[data-desk-widget="' + wid + '"]');
      const wcurPage = wnode && wnode.closest('.page-slide') ? Array.prototype.indexOf.call(pagesBox.querySelectorAll('.page-slide'), wnode.closest('.page-slide')) : -1;
      const where = document.createElement('div');
      where.className = 'dl-where';
      where.textContent = wcurPage < 0 ? '已隐藏' : (wcurPage === pageIdx ? '已在本页' : (wcurPage === 0 ? '首页' : '第 ' + (wcurPage + 1) + ' 页'));
      const btn = document.createElement('button');
      btn.className = 'dl-btn';
      btn.textContent = wcurPage === pageIdx ? '已在' : '添加到此页';
      btn.disabled = wcurPage === pageIdx;
      btn.addEventListener('click', () => addWidgetToPage(wid));
      meta.appendChild(name); meta.appendChild(where);
      item.appendChild(prev); item.appendChild(meta); item.appendChild(btn);
      panels.widget.appendChild(item);
    });
    // 图标搜索过滤（按名字模糊匹配）
    if (iconSearch && iconGrid) {
      iconSearch.addEventListener('input', () => {
        const q = (iconSearch.value || '').trim().toLowerCase();
        Array.prototype.slice.call(iconGrid.children).forEach(t => {
          const nm = (t.dataset.iconName || '').toLowerCase();
          t.style.display = (!q || nm.indexOf(q) >= 0) ? '' : 'none';
        });
      });
    }
    // v3.6.x：图片组件——可多个，上传新图片到本页
    const imgItem = document.createElement('div');
    imgItem.className = 'desk-lib-item';
    const imgPrev = document.createElement('div');
    imgPrev.className = 'dl-prev';
    imgPrev.style.cssText = PREV_BOX;
    imgPrev.innerHTML = '<span style="width:40px;height:30px;border-radius:6px;background:#f4f4f4;display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,0,0,.06)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.8"/><path d="M5.5 17l4-4 3 3 2.5-2.5L19 17"/></svg></span>';
    const imgMeta = document.createElement('div');
    imgMeta.className = 'dl-meta';
    const imgName = document.createElement('div');
    imgName.className = 'dl-name';
    imgName.textContent = '图片（上传新图片）';
    const imgWhere = document.createElement('div');
    imgWhere.className = 'dl-where';
    imgWhere.textContent = '可多个';
    const imgBtn = document.createElement('button');
    imgBtn.className = 'dl-btn';
    imgBtn.textContent = '上传并添加';
    imgBtn.addEventListener('click', () => { addDeskImage(pageIdx); lib.remove(); });
    imgMeta.appendChild(imgName); imgMeta.appendChild(imgWhere);
    imgItem.appendChild(imgPrev); imgItem.appendChild(imgMeta); imgItem.appendChild(imgBtn);
    panels.widget.appendChild(imgItem);
    // v3.7.x：自定义文字组件——可多个
    const textItem = document.createElement('div');
    textItem.className = 'desk-lib-item';
    const textPrev = document.createElement('div');
    textPrev.className = 'dl-prev';
    textPrev.style.cssText = PREV_BOX;
    textPrev.innerHTML = '<span style="font-size:10px;color:#333;font-weight:600;line-height:1.3;text-align:center;padding:2px 6px">愿你<br>温柔且自由</span>';
    const textMeta = document.createElement('div');
    textMeta.className = 'dl-meta';
    const textName = document.createElement('div');
    textName.className = 'dl-name';
    textName.textContent = '文字（自定义一句话）';
    const textWhere = document.createElement('div');
    textWhere.className = 'dl-where';
    textWhere.textContent = '可多个';
    const textBtn = document.createElement('button');
    textBtn.className = 'dl-btn';
    textBtn.textContent = '添加文字';
    textBtn.addEventListener('click', () => { addDeskText(pageIdx); lib.remove(); });
    textMeta.appendChild(textName); textMeta.appendChild(textWhere);
    textItem.appendChild(textPrev); textItem.appendChild(textMeta); textItem.appendChild(textBtn);
    panels.widget.appendChild(textItem);
    // v3.7.x：通用倒计时组件——可多个
    const cdItem = document.createElement('div');
    cdItem.className = 'desk-lib-item';
    const cdPrev = document.createElement('div');
    cdPrev.className = 'dl-prev';
    cdPrev.style.cssText = PREV_BOX;
    cdPrev.innerHTML = '<span style="display:flex;flex-direction:column;align-items:center;gap:1px"><span style="font-size:6px;color:#bbb">距出差</span><span style="font-size:14px;font-weight:700;color:#333">28 天</span><span style="font-size:5px;color:#999">9 月 16 日</span></span>';
    const cdMeta = document.createElement('div');
    cdMeta.className = 'dl-meta';
    const cdName = document.createElement('div');
    cdName.className = 'dl-name';
    cdName.textContent = '倒计时（自定义事件）';
    const cdWhere = document.createElement('div');
    cdWhere.className = 'dl-where';
    cdWhere.textContent = '可多个';
    const cdBtn = document.createElement('button');
    cdBtn.className = 'dl-btn';
    cdBtn.textContent = '添加倒计时';
    cdBtn.addEventListener('click', () => { addDeskCountdown(pageIdx); lib.remove(); });
    cdMeta.appendChild(cdName); cdMeta.appendChild(cdWhere);
    cdItem.appendChild(cdPrev); cdItem.appendChild(cdMeta); cdItem.appendChild(cdBtn);
    panels.widget.appendChild(cdItem);
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid #eee;border-radius:10px;background:#fafafa;font-size:13px;cursor:pointer;font-family:inherit';
    close.addEventListener('click', () => lib.remove());
    box.appendChild(close);
    lib.appendChild(box);
    document.body.appendChild(lib);
  }



  // ===== v3.6.x：桌面图片组件（可多个，每页可放多张不同图片） =====
  // 存储：desk-images（localStorage，元数据数组 [{id,page,addedAt,w}]）
  //       desk-image-src-<id>（IDB，图片 dataURL，大数据）
  // 组件节点用 [data-desk-image="<id>"] 标识，不参与 desk-layout（与现有组件系统解耦）
  // v3.6.x：w = 组件宽度百分比（40 小 / 70 中 / 100 大，档位见顶部 DESK_IMG_SIZES），不设时默认 100
  function loadDeskImagesMeta() {
    try { const v = JSON.parse(store.get('desk-images') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveDeskImagesMeta(arr) { store.set('desk-images', JSON.stringify(arr)); }
  // 渲染所有图片组件到对应页
  function renderDeskImages() {
    if (!pagesBox) return;
    pagesBox.querySelectorAll('[data-desk-image]').forEach(n => n.remove());
    const meta = loadDeskImagesMeta();
    const slides = pagesBox.querySelectorAll('.page-slide');
    meta.forEach(m => {
      const slide = slides[m.page];
      if (!slide) return;
      const node = document.createElement('div');
      node.className = 'desk-image-widget';
      node.dataset.deskImage = m.id;
      // v3.6.x：按 meta.w 应用宽度百分比——不同图片可设不同大小（小/中/大）
      const w = DESK_IMG_SIZES.l;
      const wv = (m.w === DESK_IMG_SIZES.s || m.w === DESK_IMG_SIZES.m) ? m.w : w;
      node.style.width = wv + '%';
      // v3.6.x：左右位置——窄图可 靠左(默认)/居中/靠右；满宽图无对齐效果
      if (wv < 100) node.style.alignSelf = m.align === 'c' ? 'center' : (m.align === 'r' ? 'flex-end' : 'flex-start');
      const img = document.createElement('img');
      node.appendChild(img);
      const addBtn = slide.querySelector('.desk-page-add');
      if (addBtn) slide.insertBefore(node, addBtn); else slide.appendChild(node);
      const srcKey = window.activePrefix() + ':desk-image-src-' + m.id;
      if (window.idbGet) {
        window.idbGet(srcKey).then(src => { if (src && node.dataset.deskImage === m.id) img.src = src; });
      } else {
        const src = store.get('desk-image-src-' + m.id);
        if (src) img.src = src;
      }
    });
    // v3.6.x：图片也算页面内容——有图页隐藏空白提示，空页恢复（装修模式才显示）
    for (let i = 0; i < slides.length; i++) syncPageHint(slides[i]);
  }
  // v3.6.x：图片组件上移/下移——只与同页相邻图片交换顺序，持久化到 meta
  function moveDeskImage(id, dir) {
    const meta = loadDeskImagesMeta();
    const idx = meta.findIndex(x => x.id === id);
    if (idx < 0) return;
    const same = [];
    meta.forEach((x, i) => { if (x.page === meta[idx].page) same.push(i); });
    const pos = same.indexOf(idx);
    if (dir === 'up' && pos > 0) {
      const a = same[pos - 1];
      const t = meta[a]; meta[a] = meta[idx]; meta[idx] = t;
    } else if (dir === 'down' && pos < same.length - 1) {
      const a = same[pos + 1];
      const t = meta[a]; meta[a] = meta[idx]; meta[idx] = t;
    } else {
      return;
    }
    saveDeskImagesMeta(meta);
    renderDeskImages();
    toast(dir === 'up' ? '已上移' : '已下移');
  }
  // 上传新图片到指定页（FIX 2026-09-18 #755：统一走 window.mochiFilePick，原实现 detached＋无 label）
  function addDeskImage(pageIdx) {
    window.mochiFilePick({
      id: 'mochi-desk-img-add-pick', accept: 'image/*',
      onFiles: (files) => {
        const f = files && files[0];
        if (!f) { toast('没有取到图片，请再选一次'); return; }
        const reader = new FileReader();
        reader.onload = () => {
          compressImage(reader.result, 1280).then(data => {
            if (!data) { toast('图片过大或格式不支持，请换一张'); return; }
            const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const meta = loadDeskImagesMeta();
            meta.push({ id: id, page: pageIdx, addedAt: Date.now() });
            saveDeskImagesMeta(meta);
            const srcKey = window.activePrefix() + ':desk-image-src-' + id;
            if (window.idbSet) window.idbSet(srcKey, data); else store.set('desk-image-src-' + id, data);
            renderDeskImages();
            toast('已添加图片');
          });
        };
        reader.onerror = () => toast('图片读取失败，请换一张再试');
        reader.readAsDataURL(f);
      }
    });
  }
  // FIX 2026-09-18 #755：原实现点击时现场 new input 且**从不挂文档**（#677 判据）＋无 label 兜底
  // ＋accept 迟到——vivo X200s/百度浏览器（T7 内核）报「上传无反应」的同族面。统一走
  // window.mochiFilePick（常驻挂文档 + accept 前置 + label 激活 + 最后 click）。
  function changeDeskImage(id) {
    window.mochiFilePick({
      id: 'mochi-desk-img-pick', accept: 'image/*',
      onFiles: (files) => {
        const f = files && files[0];
        if (!f) { toast('没有取到图片，请再选一次'); return; }
        const reader = new FileReader();
        reader.onload = () => {
          compressImage(reader.result, 1280).then(data => {
            if (!data) { toast('图片过大或格式不支持'); return; }
            const srcKey = window.activePrefix() + ':desk-image-src-' + id;
            if (window.idbSet) window.idbSet(srcKey, data); else store.set('desk-image-src-' + id, data);
            renderDeskImages();
            toast('已更换图片');
          });
        };
        reader.onerror = () => toast('图片读取失败，请换一张再试');
        reader.readAsDataURL(f);
      }
    });
  }
  // 删除图片组件
  function removeDeskImage(id) {
    const meta = loadDeskImagesMeta().filter(m => m.id !== id);
    saveDeskImagesMeta(meta);
    try { if (window.idbDelete) window.idbDelete(window.activePrefix() + ':desk-image-src-' + id); } catch (e) {}
    try { store.remove('desk-image-src-' + id); } catch (e) {}
    renderDeskImages();
    toast('已删除图片');
  }
  // 删除指定页上的所有图片（删页时调用，避免索引错位）
  function removeDeskImagesOnPage(pageIdx) {
    const meta = loadDeskImagesMeta();
    const toRemove = meta.filter(m => m.page === pageIdx);
    const remain = meta.filter(m => m.page !== pageIdx);
    saveDeskImagesMeta(remain);
    toRemove.forEach(m => {
      try { if (window.idbDelete) window.idbDelete(window.activePrefix() + ':desk-image-src-' + m.id); } catch (e) {}
      try { store.remove('desk-image-src-' + m.id); } catch (e) {}
    });
  }
  // 图片组件点击：装修模式 → 菜单（换图/删除），非装修 → 全屏查看
  function setupDeskImageClick() {
    if (!pagesBox) return;
    pagesBox.addEventListener('click', (e) => {
      const widget = e.target.closest('[data-desk-image]');
      if (!widget) return;
      const id = widget.dataset.deskImage;
      const phone = document.getElementById('page-phone');
      const isDecor = phone && phone.classList.contains('decor-on');
      if (isDecor) {
        e.stopPropagation();
        if (!window.openModal) return;
        // v3.6.x：菜单加尺寸选项（小/中/大），当前尺寸打 ✓——不同图片可设不同大小
        const cur = (loadDeskImagesMeta().find(x => x.id === id) || {}).w || DESK_IMG_SIZES.l;
        const sizePill = (label, val, w) => ({ label: label + (cur === w ? ' ✓' : ''), value: val });
        // v3.6.x：移动子菜单——上移/下移换顺序，靠左/居中/靠右调水平位置（窄图才有效果）
        // 嵌套弹窗必须延迟到当前弹窗关闭后再开（okBtn 的 finally close() 会立刻关掉当前
        // openModal 并清空 cb，同步嵌套必然闪关）——openCardBgMenu 内的 openCardMenuNext
        // 是它的局部变量，这里不能引用，直接内联同样的 setTimeout 模式
        const openMoveMenu = () => {
          const m = loadDeskImagesMeta().find(x => x.id === id) || {};
          const al = m.align || 'l';
          const alPill = (label, val) => ({ label: label + (al === val ? ' ✓' : ''), value: val });
          const opts = {
            noInput: true,
            pills: [
              { label: '上移', value: 'up' },
              { label: '下移', value: 'down' },
              alPill('靠左', 'al'),
              alPill('居中', 'ac'),
              alPill('靠右', 'ar'),
            ],
          };
          setTimeout(() => { if (window.openModal) window.openModal('图片移动', '', (v2) => {
            if (v2 === 'up' || v2 === 'down') moveDeskImage(id, v2);
            else if (v2 === 'al' || v2 === 'ac' || v2 === 'ar') {
              const meta = loadDeskImagesMeta();
              const mm = meta.find(x => x.id === id);
              if (mm) {
                mm.align = v2 === 'ac' ? 'c' : v2 === 'ar' ? 'r' : 'l';
                saveDeskImagesMeta(meta);
                renderDeskImages();
                toast(v2 === 'al' ? '已靠左' : v2 === 'ac' ? '已居中' : '已靠右');
              }
            }
          }, opts); }, 0);
        };
        window.openModal('图片组件', '', (v) => {
          if (v === '1') changeDeskImage(id);
          else if (v === '2') removeDeskImage(id);
          else if (v === 'move') openMoveMenu();
          else if (v === 's' || v === 'm' || v === 'l') {
            const w = DESK_IMG_SIZES[v];
            const meta = loadDeskImagesMeta();
            const m = meta.find(x => x.id === id);
            if (m) {
              m.w = w;
              saveDeskImagesMeta(meta);
              renderDeskImages();
              toast(v === 's' ? '已设为小尺寸' : v === 'm' ? '已设为中尺寸' : '已设为大尺寸');
            }
          }
        }, {
          noInput: true,
          pills: [
            { label: '更换图片', value: '1' },
            sizePill('尺寸：小', 's', DESK_IMG_SIZES.s),
            sizePill('尺寸：中', 'm', DESK_IMG_SIZES.m),
            sizePill('尺寸：大', 'l', DESK_IMG_SIZES.l),
            { label: '移动', value: 'move' },
            { label: '删除图片', value: '2' },
          ],
        });
      } else {
        const img = widget.querySelector('img');
        if (!img || !img.src) return;
        // v3.6.x：防御——查看器元素若因 DOM 顺序/动态重建未绑定关闭事件，打开前补绑一次
        setupDeskImageViewerClose();
        const viewer = document.getElementById('desk-image-viewer');
        const viewerImg = document.getElementById('desk-image-viewer-img');
        if (viewer && viewerImg) { viewerImg.src = img.src; viewer.hidden = false; }
      }
    });
  }
  // 关闭全屏查看器
  // v3.6.x：viewerBound 幂等守卫（声明在 IIFE 顶部）——启动绑定一次，
  // 打开路径防御性重调时不再重复挂监听
  function setupDeskImageViewerClose() {
    const viewer = document.getElementById('desk-image-viewer');
    if (!viewer) return;
    if (viewerBound) return;
    viewerBound = true;
    const closeBtn = document.getElementById('desk-image-viewer-close');
    const close = () => { viewer.hidden = true; const vi = document.getElementById('desk-image-viewer-img'); if (vi) vi.src = ''; };
    if (closeBtn) closeBtn.addEventListener('click', close);
    viewer.addEventListener('click', (e) => { if (e.target === viewer) close(); });
  }

  // ===== v3.7.x：桌面文字组件（可多个，自定义一句话放桌面） =====
  // 存储：desk-texts（localStorage，[{id,page,text,size,color}]）
  // 组件节点用 [data-desk-text="<id>"] 标识，不参与 desk-layout
  function loadDeskTextsMeta() {
    try { const v = JSON.parse(store.get('desk-texts') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveDeskTextsMeta(arr) { store.set('desk-texts', JSON.stringify(arr)); }
  function renderDeskTexts() {
    if (!pagesBox) return;
    pagesBox.querySelectorAll('[data-desk-text]').forEach(n => n.remove());
    const meta = loadDeskTextsMeta();
    const slides = pagesBox.querySelectorAll('.page-slide');
    meta.forEach(m => {
      const slide = slides[m.page];
      if (!slide) return;
      const node = document.createElement('div');
      node.className = 'desk-text-widget';
      node.dataset.deskText = m.id;
      const p = document.createElement('p');
      p.textContent = m.text || '点击编辑文字';
      p.style.fontSize = (m.size || 15) + 'px';
      p.style.color = m.color || '#333';
      node.appendChild(p);
      const addBtn = slide.querySelector('.desk-page-add');
      if (addBtn) slide.insertBefore(node, addBtn); else slide.appendChild(node);
    });
    for (let i = 0; i < slides.length; i++) syncPageHint(slides[i]);
  }
  function addDeskText(pageIdx) {
    if (!window.openModal) return;
    window.openModal('添加文字', '', (v) => {
      if (!v || !v.trim()) return;
      const id = 'txt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const meta = loadDeskTextsMeta();
      meta.push({ id: id, page: pageIdx, text: v.trim(), size: 15, color: '#333' });
      saveDeskTextsMeta(meta);
      renderDeskTexts();
      toast('已添加文字');
    }, { placeholder: '输入要显示的文字' });
  }
  function removeDeskText(id) {
    saveDeskTextsMeta(loadDeskTextsMeta().filter(m => m.id !== id));
    renderDeskTexts();
    toast('已删除');
  }
  // v3.26.x：文字组件上移/下移——只与同页相邻文字交换顺序，持久化到 meta
  function moveDeskText(id, dir) {
    const meta = loadDeskTextsMeta();
    const idx = meta.findIndex(x => x.id === id);
    if (idx < 0) return;
    const same = [];
    meta.forEach((x, i) => { if (x.page === meta[idx].page) same.push(i); });
    const pos = same.indexOf(idx);
    if (dir === 'up' && pos > 0) {
      const a = same[pos - 1];
      const t = meta[a]; meta[a] = meta[idx]; meta[idx] = t;
    } else if (dir === 'down' && pos < same.length - 1) {
      const a = same[pos + 1];
      const t = meta[a]; meta[a] = meta[idx]; meta[idx] = t;
    } else return;
    saveDeskTextsMeta(meta);
    renderDeskTexts();
    toast(dir === 'up' ? '已上移' : '已下移');
  }
  function removeDeskTextsOnPage(pageIdx) {
    saveDeskTextsMeta(loadDeskTextsMeta().filter(m => m.page !== pageIdx));
  }
  function setupDeskTextClick() {
    if (!pagesBox) return;
    pagesBox.addEventListener('click', (e) => {
      const widget = e.target.closest('[data-desk-text]');
      if (!widget) return;
      const id = widget.dataset.deskText;
      const phone = document.getElementById('page-phone');
      const isDecor = phone && phone.classList.contains('decor-on');
      if (!isDecor) return;
      e.stopPropagation();
      if (!window.openModal) return;
      // v3.7.x 修复：两处失效——① 原 setTimeout 里 querySelectorAll('.modal-pill')
      // 选择器不存在（pills 实际类名是 .pill、容器是 #modal-pills），字号+/字号-/
      // 换颜色/删除从未绑定、点了没反应；② 保存用 saveDeskTextsMeta(loadDeskTextsMeta())
      // 重新读旧数据存回，编辑的改动全部丢失。改为：一次 load 数组持有引用、
      // pill 动作走 openModal 确定回调（与全站 pills 弹窗一致：点 pill 记录、确定传回）。
      const meta = loadDeskTextsMeta();
      const m = meta.find(x => x.id === id);
      if (!m) return;
      window.openModal('编辑文字', m.text, (v) => {
        if (v === '__sizeup__') {
          m.size = Math.min(30, (m.size || 15) + 2);
          saveDeskTextsMeta(meta); renderDeskTexts(); toast('字号 ' + m.size + 'px');
        } else if (v === '__sizedn__') {
          m.size = Math.max(10, (m.size || 15) - 2);
          saveDeskTextsMeta(meta); renderDeskTexts(); toast('字号 ' + m.size + 'px');
        } else if (v === '__color__') {
          const colors = ['#333', '#666', '#999', '#e05555', '#3a7bd5', '#4a9d5e', '#d6459d', '#f0a020'];
          const ci = colors.indexOf(m.color || '#333');
          m.color = colors[(ci + 1) % colors.length];
          saveDeskTextsMeta(meta); renderDeskTexts(); toast('已换颜色');
        } else if (v === '__moveup__') {
          moveDeskText(id, 'up');
        } else if (v === '__movedn__') {
          moveDeskText(id, 'down');
        } else if (v === '__del__') {
          removeDeskText(id);
        } else if (v && v.trim()) {
          m.text = v.trim();
          saveDeskTextsMeta(meta); renderDeskTexts();
        }
      }, {
        placeholder: '输入文字',
        pills: [
          { label: '字号+', value: '__sizeup__' },
          { label: '字号-', value: '__sizedn__' },
          { label: '换颜色', value: '__color__' },
          { label: '上移', value: '__moveup__' },
          { label: '下移', value: '__movedn__' },
          { label: '删除', value: '__del__' },
        ],
      });
    });
  }

  // ===== v3.7.x：通用倒计时组件（可多个，自定义标题+目标日期） =====
  // 存储：desk-countdowns（localStorage，[{id,page,title,date}]）
  // 组件节点用 [data-desk-countdown="<id>"] 标识，不参与 desk-layout
  function loadDeskCountdownsMeta() {
    try { const v = JSON.parse(store.get('desk-countdowns') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveDeskCountdownsMeta(arr) { store.set('desk-countdowns', JSON.stringify(arr)); }
  function renderDeskCountdowns() {
    if (!pagesBox) return;
    pagesBox.querySelectorAll('[data-desk-countdown]').forEach(n => n.remove());
    const meta = loadDeskCountdownsMeta();
    const slides = pagesBox.querySelectorAll('.page-slide');
    meta.forEach(m => {
      const slide = slides[m.page];
      if (!slide) return;
      const node = document.createElement('div');
      node.className = 'desk-countdown-widget';
      node.dataset.deskCountdown = m.id;
      const target = new Date(m.date + 'T00:00:00');
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.round((target - today) / 86400000);
      node.innerHTML = '<div class="dcd-label">距' + (m.title || '事件') + '</div>' +
        '<div class="dcd-days">' + (days >= 0 ? days : '已过') + (days >= 0 ? ' 天' : '') + '</div>' +
        '<div class="dcd-date">' + m.date + '</div>';
      const addBtn = slide.querySelector('.desk-page-add');
      if (addBtn) slide.insertBefore(node, addBtn); else slide.appendChild(node);
    });
    for (let i = 0; i < slides.length; i++) syncPageHint(slides[i]);
  }
  function addDeskCountdown(pageIdx) {
    if (!window.openModal) return;
    const today = new Date().toISOString().slice(0, 10);
    window.openModal('添加倒计时', '', (v) => {
      if (!v || !v.trim()) return;
      const parts = v.split('|');
      const title = (parts[0] || '').trim();
      const date = (parts[1] || '').trim();
      if (!title || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('格式：标题|日期，如 出差|2026-09-16'); return; }
      const id = 'cd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const meta = loadDeskCountdownsMeta();
      meta.push({ id: id, page: pageIdx, title: title, date: date });
      saveDeskCountdownsMeta(meta);
      renderDeskCountdowns();
      toast('已添加倒计时');
    }, { placeholder: '标题|日期，如 出差|2026-09-16', value: '|' + today });
  }
  function removeDeskCountdown(id) {
    saveDeskCountdownsMeta(loadDeskCountdownsMeta().filter(m => m.id !== id));
    renderDeskCountdowns();
    toast('已删除');
  }
  // v3.26.x：倒计时组件上移/下移——只与同页相邻倒计时交换顺序，持久化到 meta
  function moveDeskCountdown(id, dir) {
    const meta = loadDeskCountdownsMeta();
    const idx = meta.findIndex(x => x.id === id);
    if (idx < 0) return;
    const same = [];
    meta.forEach((x, i) => { if (x.page === meta[idx].page) same.push(i); });
    const pos = same.indexOf(idx);
    if (dir === 'up' && pos > 0) {
      const a = same[pos - 1];
      const t = meta[a]; meta[a] = meta[idx]; meta[idx] = t;
    } else if (dir === 'down' && pos < same.length - 1) {
      const a = same[pos + 1];
      const t = meta[a]; meta[a] = meta[idx]; meta[idx] = t;
    } else return;
    saveDeskCountdownsMeta(meta);
    renderDeskCountdowns();
    toast(dir === 'up' ? '已上移' : '已下移');
  }
  function removeDeskCountdownsOnPage(pageIdx) {
    saveDeskCountdownsMeta(loadDeskCountdownsMeta().filter(m => m.page !== pageIdx));
  }
  function setupDeskCountdownClick() {
    if (!pagesBox) return;
    pagesBox.addEventListener('click', (e) => {
      const widget = e.target.closest('[data-desk-countdown]');
      if (!widget) return;
      const id = widget.dataset.deskCountdown;
      const phone = document.getElementById('page-phone');
      const isDecor = phone && phone.classList.contains('decor-on');
      if (!isDecor) return;
      e.stopPropagation();
      if (!window.openModal) return;
      // v3.7.x 修复：与文字组件同款——删除 pill 走确定回调、保存持有 meta 引用
      //（原 saveDeskCountdownsMeta(loadDeskCountdownsMeta()) 读旧数据存回、编辑丢失；
      //  原 setTimeout 的 .modal-pill 选择器不存在，删除 pill 从未绑定）
      const meta = loadDeskCountdownsMeta();
      const m = meta.find(x => x.id === id);
      if (!m) return;
      window.openModal('编辑倒计时', m.title + '|' + m.date, (v) => {
        if (v === '__del__') { removeDeskCountdown(id); return; }
        if (v === '__moveup__') { moveDeskCountdown(id, 'up'); return; }
        if (v === '__movedn__') { moveDeskCountdown(id, 'down'); return; }
        if (!v || !v.trim()) return;
        const parts = v.split('|');
        const title = (parts[0] || '').trim();
        const date = (parts[1] || '').trim();
        if (!title || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('格式：标题|日期'); return; }
        m.title = title; m.date = date;
        saveDeskCountdownsMeta(meta);
        renderDeskCountdowns();
      }, {
        placeholder: '标题|日期，如 出差|2026-09-16',
        pills: [
          { label: '上移', value: '__moveup__' },
          { label: '下移', value: '__movedn__' },
          { label: '删除', value: '__del__' },
        ],
      });
    });
  }

  // v3.6.x：装修模式装饰条「+ 添加卡片」——找回被移出的桌面组件，加到当前页
  const decorAddBtn = document.getElementById('decor-add-widget');
  if (decorAddBtn) {
    decorAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!pagesBox) return;
      // 当前页 = 滚动位置对应的 page-slide
      const slides = Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide'));
      if (!slides.length) return;
      let curIdx = 0;
      if (pagesBox.clientWidth) {
        curIdx = Math.max(0, Math.min(slides.length - 1, Math.round(pagesBox.scrollLeft / pagesBox.clientWidth)));
      }
      openDeskLib(slides[curIdx], curIdx);
    });
  }

  // 卡片摆放操作已收进点卡片的设置菜单（openCardBgMenu 的 上移/下移/移出此页），
  // 不再注入悬浮操作条——原操作条挂在 [data-desk-widget]（含 app-grid 图标网格）上，
  // 会遮挡图标导致装修模式下点图标弹不出「更换/清除」菜单（无法恢复默认图标）。

  // 退出装修模式（含桌面顶部"完成"按钮）
  function exitDecor() {
    document.querySelectorAll('.app-grid').forEach(g => g.classList.remove('editing')); // FIX 2026-09-12 #351 动态查询含 pg* 网格
    const phone = document.getElementById('page-phone');
    if (phone) phone.classList.remove('decor-on');
    const bar = document.getElementById('decor-bar');
    if (bar) bar.hidden = true;
    // v3.27.x：批量换图队列没点完就退出装修 → 队列作废（留在队列里会让下次进
    // 装修点的第一个图标莫名被换图）
    if (window.__iconBatchQ && window.__iconBatchQ.length) { window.__iconBatchQ = null; toast('批量换图未点完，已作废'); }
    // FIX 2026-09-17 #696：退出装修一并收掉「点图标上传/调位置」的挂起状态与位置面板——
    // 用户从抽屉/设置页点了「调整图标图片位置」却直接退出（没点图标）时，标记会留到下一次
    // 进装修，把那次点图标劫持成位置面板（表现为「点图标上传图片失效」）。
    window.__iconAdjustPick = false;
    const fitPanelEl = document.getElementById('icon-fit-panel');
    if (fitPanelEl && fitPanelEl.style.display !== 'none') { try { fitPanelEl.style.display = 'none'; } catch (e) {} }
    window.__iconFitPanelOpen = false;
    iconFitHighlight(null);
    try { document.dispatchEvent(new Event('decor-exited')); } catch (e) {}
  }
  // v3.5.131：暴露给 tabs.js 返回键（返回时退出编辑态，防止"点了没反应"）
  window.exitDecor = exitDecor;
  const decorDone = document.getElementById('decor-done');
  if (decorDone) {
    decorDone.addEventListener('click', exitDecor);
  }
  // v3.6.x：恢复隐藏图标——装修栏"恢复图标"按钮，弹窗列出已隐藏图标，点击恢复
  const decorRestoreIcon = document.getElementById('decor-restore-icon');
  if (decorRestoreIcon) {
    decorRestoreIcon.addEventListener('click', () => {
      const hidden = getHiddenIcons();
      if (!hidden.length) { toast('没有已隐藏的图标'); return; }
      if (!window.openModal) return;
      // 收集隐藏图标的标签
      const items = [];
      document.querySelectorAll('.app').forEach(app => {
        if (hidden.indexOf(app.dataset.app) >= 0) {
          const lbl = app.querySelector('.app-name');
          items.push({ key: app.dataset.app, label: lbl ? lbl.textContent : app.dataset.app });
        }
      });
      if (!items.length) { toast('没有已隐藏的图标'); return; }
      const pills = items.map(it => ({ label: '恢复「' + it.label + '」', value: it.key }));
      pills.push({ label: '全部恢复', value: '__all__' });
      window.openModal('恢复隐藏图标', '', (v) => {
        if (!v) return;
        if (v === '__all__') {
          setHiddenIcons([]);
          applyHiddenIcons();
          toast('已恢复全部图标');
          return;
        }
        const arr = getHiddenIcons().filter(k => k !== v);
        setHiddenIcons(arr);
        applyHiddenIcons();
        toast('已恢复');
      }, { noInput: true, pills: pills });
    });
  }
  // contact-switched 时重应用隐藏状态
  document.addEventListener('contact-switched', applyHiddenIcons);
  // FIX 2026-09-10 #265：图标【顺序】同为 per-cid 键（app-icon-order-<grid>），此前切桌面只重排
  //   图标图片和显隐、没重排顺序 → 网格留着上一个桌面的排布（与 #151 同族串桌面）。
  document.addEventListener('contact-switched', restoreAppIconOrder);

  // 点击底部 tab 切换页面时退出图标编辑模式
  const tabbar = document.querySelector('.tabbar');
  if (tabbar && grids.length) {
    tabbar.addEventListener('click', () => {
      document.querySelectorAll('.app-grid').forEach(g => g.classList.remove('editing')); // FIX 2026-09-12 #351 动态查询含 pg* 网格
      const phone = document.getElementById('page-phone');
      if (phone) phone.classList.remove('decor-on');
      const bar = document.getElementById('decor-bar');
      if (bar) bar.hidden = true;
    });
  }

  // ===== v3.x：桌面拖拽重排（移动模式，复用 decor-on + desk-layout/app-icon-order） =====
  // v3.27.x：移除「非移动模式长按 350ms 自动进移动模式+拖拽」入口——用户反馈日常点按
  // 图标长按即误触进移动模式、图标被拖乱（要求「固定一行 4 个」不被打乱）。拖动排序
  // 仅保留主动入口：装饰模式（设置→自定义桌面图标）→「编辑布局」→ 移动模式（短按即拖）。
  // 参考 chatcard.js pointer 拖拽；跨页拖到边缘 300ms 自动翻页（window.deskGo）
  // 图标限本 app-grid 内换位（持久化 app-icon-order）；独立组件可跨页（持久化 desk-layout）
  {
    const phone = document.getElementById('page-phone');
    const MOVE_DELAY = 350, EDGE = 44, EDGE_DELAY = 300;
    let inMoveMode = false, dragging = false;
    const enterMoveMode = () => {
      if (inMoveMode) return;
      inMoveMode = true;
      enterDecor();
      if (phone) phone.classList.add('desk-move-mode');
      const span = document.querySelector('#decor-bar span');
      if (span) span.textContent = '移动模式 · 短按图标拖动换位 · 完成退出';
      // v3.14.x：清掉长按按住阶段已形成的文字选区——Android 选中文字弹「复制」气泡后
      // 触摸序列被气泡抢占，进移动模式后拖不动；CSS 已禁桌面选择，这里兜底清残留
      try { const _sel = window.getSelection(); if (_sel && _sel.removeAllRanges) _sel.removeAllRanges(); } catch (e) {}
      if (navigator.vibrate) try { navigator.vibrate(20); } catch (e) {}
    };
    // 装修栏「编辑布局」按钮：点击进入移动模式（短按即拖，绕开长按 + 浏览器手势抢占）
    const editLayoutBtn = document.getElementById('decor-edit-layout');
    if (editLayoutBtn) editLayoutBtn.addEventListener('click', enterMoveMode);
    const resetMoveMode = () => {
      inMoveMode = false;
      dragging = false;
      if (phone) phone.classList.remove('desk-move-mode');
      // 退出时清理拖拽残留（拖拽中按返回键/点完成/切 tab）
      document.querySelectorAll('.desk-drag-clone, .desk-edge-hint, .desk-drop-line').forEach(n => n.remove());
      document.querySelectorAll('.desk-dragging').forEach(n => n.classList.remove('desk-dragging'));
    };
    document.addEventListener('decor-exited', resetMoveMode);
    const _tabbar = document.querySelector('.tabbar');
    if (_tabbar) _tabbar.addEventListener('click', resetMoveMode);
    // v3.14.x：拦截桌面原生右键/长按系统菜单——Android 长按图片组件/头像会弹
    // 「保存/复制」上下文菜单（-webkit-touch-callout 只拦 iOS 管不到 Android），
    // 菜单一弹即抢占触摸序列导致拖拽中断（配合 home.css 的 #page-phone 禁选择）。
    // 桌面无任何右键功能，全时拦截（含桌面 PC 右键，避免误触发浏览器菜单打断拖拽）
    if (phone) phone.addEventListener('contextmenu', (e) => e.preventDefault());

    // touchstart capture 兜底：移动模式下短按即拖，浏览器会按 pan-x pan-y 接管触摸序列→
    // pointermove 被抢占/翻页→拖不动。在 touchstart capture 阶段 preventDefault，阻止浏览器
    // 启动 pan-x/pan-y 手势，让 pointer 完整派发。
    // ⚠️ 必须限 inMoveMode：touchstart 的 preventDefault 会阻止浏览器合成 click 事件，
    //    非移动模式下若也无条件 preventDefault，桌面所有功能按钮（.app）/卡片点击全部失效
    //    （v3.10.x 回归：开屏进入后桌面按钮全点不动）。仅在移动模式（编辑布局后短按即拖）才需要。
    pagesBox.addEventListener('touchstart', (e) => {
      if (!inMoveMode) return;
      if (e.target.closest('.desk-lib, .desk-page-add, .decor-bar')) return;
      if (!e.target.closest('[data-desk-widget], .app')) return;
      e.preventDefault();
    }, { capture: true, passive: false });
    // v3.14.x：touchmove capture 兜底——组件已允许 pan-x pan-y（移动模式下桌面横滑翻页），
    //   长按进移动模式那一下 touchstart 发生时 inMoveMode 还是 false 拦不到，但手指要 350ms
    //   后才开始移动，第一个 touchmove 到达时 inMoveMode 已是 true——这里 preventDefault 阻止
    //   浏览器把序列当滚动，长按拖拽不被抢占（否则组件允许 pan 后拖动会被浏览器抢成翻页）。
    //   限 inMoveMode + 组件目标，不影响移动模式下组件间隙/空白处的正常横滑翻页。
    pagesBox.addEventListener('touchmove', (e) => {
      if (!inMoveMode) return;
      if (e.target.closest('.desk-lib, .desk-page-add, .decor-bar')) return;
      if (!e.target.closest('[data-desk-widget], .app')) return;
      e.preventDefault();
    }, { capture: true, passive: false });

    // 长按检测（事件委托在 pagesBox）
    pagesBox.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest('.desk-lib, .desk-page-add, .decor-bar')) return;
      const target = e.target.closest('[data-desk-widget], .app');
      if (!target) return;
      // v3.27.x：非移动模式不再有长按入口——日常点按/长按图标无副作用（点击照常），
      // 拖动排序只走「装饰模式→编辑布局」主动入口。下方逻辑仅在 inMoveMode 时生效。
      if (!inMoveMode) return;
      const t = target;
      // 移动模式已开启：区分「快速横滑翻页」与「长按/短按拖拽」——组件 touch-action:none
      // 时浏览器不会自动滚动，手指快速横滑由 JS 判为翻页（v3.14.x：修复移动/装修模式桌面
      // 滑不动）。记录按下时刻：短按后立即横向位移>12px → 翻页；长按超过 MOVE_DELAY（按住
      // 不动）或纵向位移为主 → 拖拽。这样长按图标拖动仍可拖（长按超时后移动不被判横滑）。
      t._swipeX = e.clientX; t._swipeY = e.clientY;
      t._swipeT = Date.now();
      t._swiping = null;
      return; // 等 pointermove 判定方向
    });
    pagesBox.addEventListener('pointermove', (e) => {
      // v3.27.x：非移动模式长按入口已移除，pressTimer 位移取消逻辑随之删除
      // 移动模式下的横滑翻页判定：手指按下但未进入拖拽（_swiping 未定）时判定方向
      if (inMoveMode && !dragging) {
        const t = e.target.closest ? e.target.closest('[data-desk-widget], .app') : null;
        if (t && t._swiping !== undefined && t._swiping === null) {
          const dx = e.clientX - t._swipeX, dy = e.clientY - t._swipeY;
          // 长按超过 MOVE_DELAY 后移动 → 直接拖拽（按住图标/组件拖动的场景）
          if (Date.now() - t._swipeT > MOVE_DELAY) {
            t._swiping = 'v';
            startDeskDrag(e, t);
            return;
          }
          if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
            // v3.27.x（华为 Mate 40 Pro+自带浏览器反馈）：移动模式（编辑布局）下图标/组件上
            // 任意方向滑动都直接拖拽——原「横向位移为主→翻页」把横向拖动抢成翻页，导致图标
            // 只能竖着换行、无法横向放置。移动模式翻页由「空白处原生滚动（.desk-move-mode
            // 容器 touch-action:pan-x pan-y）+ 拖到屏幕边缘自动翻页」承担，JS 横滑翻页冗余。
            t._swiping = 'v';
            startDeskDrag(e, t);
          }
        }
      }
    });
    // v3.27.x：pressTimer/cancelPress 已随长按入口移除（pointerdown 仅移动模式生效）
    // v3.14.x：移动模式下横滑判定结束/取消时清理（避免残留 _swiping 状态）
    const clearSwipe = (e) => {
      const t = e.target.closest ? e.target.closest('[data-desk-widget], .app') : null;
      if (t) { t._swiping = undefined; t._swipeX = undefined; t._swipeY = undefined; }
    };
    pagesBox.addEventListener('pointerup', clearSwipe);
    pagesBox.addEventListener('pointercancel', clearSwipe);

    // v3.10.x：tap→click 兜底——部分国产浏览器（X5 内核/夸克/UC 等）触摸不合成 click
    // 事件，桌面所有 .app 按钮触摸点击无响应（直接 .click() 正常，证明监听器已绑定）。
    // 在 touchend 判定 tap（单指、未移动、短按）后，等 120ms 看 click 是否触发，
    // 未触发则手动 click()。正常浏览器 click 在 touchend 后即时合成（<10ms），
    // 120ms 内检测到即跳过，零影响；不合成的浏览器才兜底，最多 120ms 延迟。
    // 守卫：移动模式/拖拽中不兜底（短按即拖，不应切页）；target 非 .app 不兜底。
    let _tapStart = null;
    pagesBox.addEventListener('touchstart', (e) => {
      if (inMoveMode || dragging) { _tapStart = null; return; }
      if (e.touches.length !== 1) { _tapStart = null; return; }
      const t = e.touches[0];
      _tapStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { capture: true, passive: true });
    pagesBox.addEventListener('touchend', (e) => {
      const s = _tapStart; _tapStart = null;
      if (!s || inMoveMode || dragging) return;
      if (e.changedTouches.length !== 1) return;
      const c = e.changedTouches[0];
      if (Math.abs(c.clientX - s.x) > 10 || Math.abs(c.clientY - s.y) > 10) return;
      if (Date.now() - s.time > 500) return;
      const btn = e.target.closest && e.target.closest('.app');
      if (!btn) return;
      let clicked = false;
      const once = () => { clicked = true; btn.removeEventListener('click', once, true); };
      btn.addEventListener('click', once, true);
      setTimeout(() => {
        btn.removeEventListener('click', once, true);
        if (!clicked) { try { btn.click(); } catch (e2) {} }
      }, 120);
    }, { capture: true, passive: true });

    let dropLine = null;
    const clearDropLine = () => { if (dropLine) { dropLine.remove(); dropLine = null; } };

    function startDeskDrag(e, el) {
      if (dragging) return; // 多指触摸守卫：拖拽中忽略第二指
      dragging = true;
      const rect = el.getBoundingClientRect();
      const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
      const clone = el.cloneNode(true);
      clone.classList.add('desk-drag-clone');
      clone.classList.remove('desk-dragging');
      clone.style.left = rect.left + 'px';
      clone.style.top = rect.top + 'px';
      clone.style.width = rect.width + 'px';
      clone.style.height = rect.height + 'px';
      document.body.appendChild(clone);
      el.classList.add('desk-dragging');
      // 捕获指针：长按后才加 touch-action:none 对当前触摸序列无效，浏览器仍会按 pan-x/pan-y
      // 接管触摸→pointermove 被抢占/pointercancel→"一直抖动拖不动"。setPointerCapture 夺回
      // 控制权，后续 pointermove 持续派发到 el 不被抢占。
      let captured = false;
      if (e.pointerId !== undefined && el.setPointerCapture) {
        try { el.setPointerCapture(e.pointerId); captured = true; } catch (er) {}
      }
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (er) {}
      let dropInfo = null, edgeTimer = null, edgeDir = 0;
      const edgeL = document.createElement('div'); edgeL.className = 'desk-edge-hint left';
      const edgeR = document.createElement('div'); edgeR.className = 'desk-edge-hint right';
      document.body.appendChild(edgeL); document.body.appendChild(edgeR);
      const clearEdge = () => {
        if (edgeTimer) { clearTimeout(edgeTimer); edgeTimer = null; }
        edgeL.classList.remove('show'); edgeR.classList.remove('show'); edgeDir = 0;
      };
      // v3.23.x：小图标（.app-grid 内）拖到屏幕边缘同样自动翻页——跨页移动的前提
      const onMove = (ev) => {
        ev.preventDefault();
        clone.style.left = (ev.clientX - offsetX) + 'px';
        clone.style.top = (ev.clientY - offsetY) + 'px';
        const w = window.innerWidth;
        const slides = pagesBox.querySelectorAll('.page-slide').length;
        const cur = window.deskIdx ? window.deskIdx() : 0;
        if (ev.clientX < EDGE && cur > 0) {
          edgeL.classList.add('show');
          if (edgeDir !== -1) { edgeDir = -1; if (edgeTimer) clearTimeout(edgeTimer); edgeTimer = setTimeout(() => { if (window.deskGo) window.deskGo(cur - 1); }, EDGE_DELAY); }
        } else if (ev.clientX > w - EDGE && cur < slides - 1) {
          edgeR.classList.add('show');
          if (edgeDir !== 1) { edgeDir = 1; if (edgeTimer) clearTimeout(edgeTimer); edgeTimer = setTimeout(() => { if (window.deskGo) window.deskGo(cur + 1); }, EDGE_DELAY); }
        } else { clearEdge(); }
        dropInfo = computeDrop(el, ev.clientX, ev.clientY);
        updateDropLine(dropInfo);
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (captured && el.releasePointerCapture) { try { el.releasePointerCapture(e.pointerId); } catch (er) {} }
        dragging = false;
        clone.remove();
        el.classList.remove('desk-dragging');
        clearDropLine();
        clearEdge();
        edgeL.remove(); edgeR.remove();
        // v3.26.x #134：computeDrop 对整组网格拖拽返回 null（禁止自嵌套），落空即放弃
        if (dropInfo) doDrop(el, dropInfo);
      };
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    }

    function gridDropInfo(grid, dragged, clientX, clientY) {
      const apps = Array.prototype.slice.call(grid.querySelectorAll('.app'))
        .filter(a => a !== dragged && a.style.display !== 'none' && !a.hidden);
      for (const a of apps) {
        const r = a.getBoundingClientRect();
        if (clientX < r.left + r.width / 2 && clientY < r.top + r.height / 2) {
          return { type: 'grid', grid: grid, ref: a, before: true };
        }
      }
      for (const a of apps) {
        const r = a.getBoundingClientRect();
        if (clientY < r.bottom) return { type: 'grid', grid: grid, ref: a, before: false };
      }
      if (apps.length) return { type: 'grid', grid: grid, ref: apps[apps.length - 1], before: false };
      // v3.23.x：空网格返回 ref:null（配合 doDrop append），原实现返回 null=整格不可落
      return { type: 'grid', grid: grid, ref: null, before: false };
    }
    function computeDrop(dragged, clientX, clientY) {
      // v3.26.x #134：整组图标网格（.app-grid 自带 data-desk-widget=apps/p2apps/p3apps）
      // 不能作为拖拽对象——dragged 是网格本身时，落点 ref 是网格的子图标，
      // doDrop 的 insertBefore(网格, 子图标引用) = 节点插进自己内部
      // → HierarchyRequestError（iPhone X 实测崩在 appendChild@native，拖拽功能报废）。
      if (dragged.classList && dragged.classList.contains('app-grid')) return null;
      const inGrid = !!dragged.closest('.app-grid');
      if (inGrid) {
        const grid = dragged.closest('.app-grid');
        // v3.23.x：跨页——贴边翻页后当前页（deskIdx 立即更新）与图标原页不同，
        // 落点改算【目标页网格】，返回 grid 型落点（doDrop 会把图标挪入该网格）
        const slides = Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide'));
        const curIdx = Math.max(0, Math.min(slides.length - 1, window.deskIdx ? window.deskIdx() : 0));
        const curGrid = slides[curIdx] ? slides[curIdx].querySelector('.app-grid') : null;
        if (curGrid && curGrid !== grid) return gridDropInfo(curGrid, dragged, clientX, clientY);
        return gridDropInfo(grid, dragged, clientX, clientY);
      }
      const slides = Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide'));
      // 用 deskIdx()（go() 立即更新）而非 scrollLeft——翻页中途 scrollLeft 在两页之间会算错页
      let curIdx = window.deskIdx ? window.deskIdx() : 0;
      curIdx = Math.max(0, Math.min(slides.length - 1, curIdx));
      const slide = slides[curIdx];
      if (!slide) return null;
      // FIX 2026-09-12 #351：独立组件状态的图标（历史装修库添加/旧数据）拖到本页网格
      // 上＝入格排版（网格型落点），不再只能与其他独立组件前后排序
      const curGrid = slide.querySelector('.app-grid');
      if (curGrid) {
        const gr = curGrid.getBoundingClientRect();
        if (clientX >= gr.left && clientX <= gr.right && clientY >= gr.top && clientY <= gr.bottom) {
          return gridDropInfo(curGrid, dragged, clientX, clientY);
        }
      }
      const items = Array.prototype.slice.call(slide.querySelectorAll('[data-desk-widget]')).filter(n => {
        if (n === dragged) return false;
        const p = n.parentElement;
        if (p === slide) return true;
        if (p && p.closest('[data-desk-widget]')) return false;
        return true;
      });
      for (const n of items) {
        const r = n.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return { type: 'slide', slide: slide, ref: n, before: true };
      }
      if (items.length) return { type: 'slide', slide: slide, ref: items[items.length - 1], before: false };
      return { type: 'slide', slide: slide, ref: null, before: false };
    }

    function updateDropLine(info) {
      if (!info || !info.ref) { clearDropLine(); return; }
      const r = info.ref.getBoundingClientRect();
      const cls = 'desk-drop-line ' + (info.type === 'grid' ? 'vert' : 'horiz');
      if (!dropLine) { dropLine = document.createElement('div'); document.body.appendChild(dropLine); }
      if (dropLine.className !== cls) dropLine.className = cls;
      if (info.type === 'grid') {
        dropLine.style.width = '';
        dropLine.style.height = r.height + 'px';
        dropLine.style.top = r.top + 'px';
        dropLine.style.left = (info.before ? r.left : r.right) + 'px';
      } else {
        dropLine.style.height = '';
        dropLine.style.width = r.width + 'px';
        dropLine.style.left = r.left + 'px';
        dropLine.style.top = (info.before ? r.top : r.bottom) + 'px';
      }
    }

    function doDrop(dragged, info) {
      if (info.type === 'grid') {
        // v3.23.x：跨页移动——目标网格不是图标当前网格时先挪入目标网格（空网格 append）
        // v3.26.x #134：自嵌套防线——ref 在 dragged 内部时 insertBefore 会抛
        // HierarchyRequestError（节点不能插进自己的子孙位置），任何路径都不允许
        if (info.ref && dragged.contains(info.ref)) return;
        // FIX 2026-09-12 #351：挪动前记下源网格——跨页后源页顺序数组必须同步剔除该
        // 图标，否则启动归位时源/目标两个数组都认领同一图标（旧版「回原位」根因之一）
        const srcGrid = dragged.closest('.app-grid');
        if (dragged.parentNode !== info.grid) info.grid.appendChild(dragged);
        if (info.ref && dragged !== info.ref) {
          if (info.before) info.grid.insertBefore(dragged, info.ref);
          else info.grid.insertBefore(dragged, info.ref.nextSibling);
        }
        const order = Array.prototype.slice.call(info.grid.querySelectorAll('.app')).map(a => a.dataset.app);
        store.set('app-icon-order-' + info.grid.dataset.app, JSON.stringify(order));
        if (srcGrid && srcGrid !== info.grid && srcGrid.dataset.app) {
          let srcOrder = [];
          try { srcOrder = JSON.parse(store.get('app-icon-order-' + srcGrid.dataset.app) || '[]'); } catch (e) {}
          const key = dragged.dataset.app;
          const cleaned = srcOrder.filter(k => k !== key);
          if (cleaned.length !== srcOrder.length) {
            store.set('app-icon-order-' + srcGrid.dataset.app, JSON.stringify(cleaned));
          }
        }
      } else {
        const slides = Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide'));
        const targetIdx = slides.indexOf(info.slide);
        if (dragged.parentNode !== info.slide) {
          const addBtn = info.slide.querySelector('.desk-page-add');
          if (addBtn) info.slide.insertBefore(dragged, addBtn);
          else info.slide.appendChild(dragged);
        }
        if (info.ref && dragged !== info.ref) {
          if (info.before) info.slide.insertBefore(dragged, info.ref);
          else info.slide.insertBefore(dragged, info.ref.nextSibling);
        }
        try { saveDeskLayout(); } catch (e) {}
        Array.prototype.slice.call(pagesBox.querySelectorAll('.page-slide')).forEach(s => { try { syncPageHint(s); } catch (e) {} });
        if (targetIdx >= 0 && window.deskGo) window.deskGo(targetIdx); // 跨页后停在目标页
      }
      if (window.deskRebuild) window.deskRebuild();
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
    }

    // 点空白退出移动模式
    pagesBox.addEventListener('click', (e) => {
      if (!inMoveMode) return;
      if (e.target.closest('[data-desk-widget], .app, .desk-page-add, .desk-lib, .decor-bar')) return;
      if (window.exitDecor) window.exitDecor();
    }, true);
  }

  // 已摸鱼天数：按和 TA 打卡或聊天的自然日统计
  // v3.9.x：改为全局累计（跨所有联系人按自然日去重），避免多联系人下每个桌面只显示各自天数
  function fishToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function getFishLog() {
    try { return JSON.parse(gStore.get('fish-log') || '[]'); } catch (e) { return []; }
  }
  // FIX 2026-09-11 #290：摸鱼天数自动修正——天数=fish-log 长度，三种错源里两种可就地修：
  // ① 虚高（重复日期/脏值混入：读-改-写竞态、旧格式）→ 规范化（只留 YYYY-MM-DD 合法
  //    日期 + Set 去重），有变化才写回（防无谓写放大）；② 偏低（各联系人命名空间旧
  //    fish-log 副本迟到：migrateFishLogGlobal 原来只在模块加载跑一次，早于 IDB 回填，
  //    副本后到就永远漏算）→ 见下方 restore-done/wrj-heal 再合并。③ IDB 旧快照遮蔽
  //    已由 idb.js retainValue（LS 优先）+ wrj 时间戳守卫兜住，不在此重复设防。
  function normalizeFishLog() {
    const seen = new Set();
    const clean = getFishLog().filter(d =>
      typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !seen.has(d) && seen.add(d));
    const old = getFishLog();
    if (old.length !== clean.length || old.some((d, i) => d !== clean[i])) {
      gStore.set('fish-log', JSON.stringify(clean));
    }
    return clean;
  }
  function logFish() {
    const list = normalizeFishLog();
    const t = fishToday();
    if (list.indexOf(t) === -1) {
      list.push(t);
      gStore.set('fish-log', JSON.stringify(list));
    }
    updateFishDays();
  }
  function updateFishDays() {
    const el = document.getElementById('fish-days');
    if (el) el.textContent = normalizeFishLog().length || 0;
  }
  window.logFish = logFish; // 供聊天页调用
  // v3.9.x：一次性迁移——把各联系人命名空间下的旧 fish-log 合并到全局 fish-log（按自然日去重）
  function migrateFishLogGlobal(setMark) {
    try {
      const all = new Set();
      try { JSON.parse(gStore.get('fish-log') || '[]').forEach(d => all.add(d)); } catch (e) {}
      const contacts = window.getContacts ? window.getContacts() : [{ id: 'default' }];
      contacts.forEach(c => {
        try {
          const s = window.xyStore('xy-home-v2:' + c.id);
          JSON.parse(s.get('fish-log') || '[]').forEach(d => all.add(d));
        } catch (e) {}
      });
      if (all.size) gStore.set('fish-log', JSON.stringify(Array.from(all).sort()));
      if (setMark) gStore.set('fish-log-global-migrated', '1');
    } catch (e) {}
  }
  migrateFishLogGlobal(false); // 模块加载时先合并 LS 已有的
  updateFishDays();
  // #290：回填完成/写日志自愈后再合并一次——此时尚未合并进全局键的各联系人旧副本
  //（只存 IDB、模块加载时还没回填进来）这时才可见；合并后规范化+刷新天数显示。
  try {
    function fishLogHeal() {
      try { migrateFishLogGlobal(false); normalizeFishLog(); updateFishDays(); } catch (e) {}
    }
    document.addEventListener('mochi-restore-done', fishLogHeal);
    document.addEventListener('mochi-wrj-heal', fishLogHeal);
  } catch (e) {}

  // 兼容旧数据：以前打过卡但未计入摸鱼天数的，自动补记（旧标记视为今天打卡）
  (function () {
    const ck = store.get('checkin');
    if (ck) {
      const d = ck === '1' ? fishToday() : ck; // 旧格式 '1' -> 今天；新格式为日期
      const list = getFishLog();
      if (list.indexOf(d) === -1) {
        list.push(d);
        gStore.set('fish-log', JSON.stringify(list));
        updateFishDays();
      }
    }
  })();

  // ===== v3.27.x #645：修改摸鱼天数（设置 → 工具，#row-fish-days）=====
  // 背景：fish-log（全局键，天数 = 日期去重个数）遇浏览器丢数据后从 0 重来，
  // 用户要求能手动改回原天数。走 openModal 数字输入：目标 > 现有 → 在最早一天之前
  // 往回补连续自然日（真实打卡日全部保留、仍是最近的日子）；目标 < 现有 → 保留最近
  // n 天（今天/近期打卡日不动）。写回走 gStore.set（内存 + LS + IDB 同链路），
  // #290 规范化/自愈只做并集合并，不会把这里的结果清掉。
  (function () {
    const row = document.getElementById('row-fish-days');
    if (!row || typeof window.openModal !== 'function') return;
    const fmtDate = (dt) =>
      dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    function fishToast(msg) {
      let t = document.getElementById('cc-toast');
      if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
      t.textContent = msg;
      t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
    }
    row.addEventListener('click', function () {
      const cur = normalizeFishLog().length;
      const HINT = '当前已摸鱼 ' + cur + ' 天。摸鱼天数＝使用网站的累计天数：当天在站内聊天、打卡或有互动就记 1 天（同一天不重复计）。数据丢失后天数会从 0 重新开始，输入原来的天数即可改回；改回后照常每天 +1。';
      const ctl = window.openModal('修改摸鱼天数', cur ? String(cur) : '', function (v) {
        const sv = String(v == null ? '' : v).trim();
        if (!/^\d+$/.test(sv)) { ctl.hint('请输入 0 起的整数天数'); ctl.stay(); return; }
        const n = parseInt(sv, 10);
        if (n > 36500) { ctl.hint('最多 36500 天（约 100 年），别填太大'); ctl.stay(); return; }
        const list = normalizeFishLog().slice().sort();
        if (n === list.length) { ctl.hint('现在就是 ' + n + ' 天，没有变化'); ctl.stay(); return; }
        let out;
        if (n < list.length) {
          out = list.slice(list.length - n); // 收缩：丢最旧的，最近 n 天（含今天）不动
        } else {
          out = list.slice();
          let d;
          if (out.length) {
            const p = out[0].split('-').map(Number);
            d = new Date(p[0], p[1] - 1, p[2]); // 非空：在最早一天之前回补，真实打卡日全保留
          } else {
            const now = new Date();
            d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 空日志（数据丢失场景）：从今天往回补
            d.setDate(d.getDate() + 1); // 循环先自减再入组，起点设明天＝首个入组日期是今天
          }
          for (let i = n - out.length; i > 0; i--) { d.setDate(d.getDate() - 1); out.unshift(fmtDate(d)); }
        }
        gStore.set('fish-log', JSON.stringify(out));
        updateFishDays();
        fishToast('已改为「已摸鱼 ' + n + ' 天」');
      }, {
        inputmode: 'numeric',
        maxlength: 6,
        placeholder: cur ? ('当前 ' + cur + ' 天，输入新天数') : '输入目标天数',
        staticText: HINT
      });
    });
  })();

  // ===== v3.27.x #707→#764：屏幕适配微调（设置 → 工具区首位，独立显眼分组，六轴滑杆）=====
  // #707 原「屏幕位置设置」：±2px 步进按钮 + 点数值 openModal 手输——用户看不到拖动效果只能猜。
  // #764 合并升级：入口挪到工具区第一组；每轴改 range 滑杆「边拖边看」实时生效（面板只占下半屏，
  // 上半屏就是预览现场），双击滑杆复位 0；新增「文字大小」第六轴（--mochi-text-adj，
  // display-tune.css 只叠加气泡/输入框/设置行等文字组，零 zoom/scale）。
  // 偏移存根命名空间 LS，跨桌面共用（屏幕是设备属性）；mobile-adapt.js mochiScreenAdj 落层。
  (function () {
    // #990：每轴带 group 字段＝它「管哪一页」，渲染时按组加小标题（原七轴平铺一列，用户看不出
    // 哪根滑杆管桌面、哪根管聊天；顺序也按组排：通用位置轴 → 桌面页专有 → 聊天文字）
    const AXES = [
      { k: 'top', name: '顶部', min: -80, max: 80, group: 'pos', hint: '顶部内容被状态栏遮挡=往正拖；离得太远=往负拖' },
      { k: 'bottom', name: '底部', min: -80, max: 80, group: 'pos', hint: '底部被手势条裁掉=往正拖；悬空离底太远=往负拖' },
      { k: 'h', name: '页面高度', min: -80, max: 80, group: 'pos', hint: '页面底部留白=往正撑满；内容超出屏幕被裁=往负收短' },
      { k: 'shift', name: '整体位移', min: -60, max: 60, group: 'pos', hint: '整页位置偏了：正=整页下移、负=上移' },
      { k: 'side', name: '左右安全边', min: 0, max: 12, group: 'pos', hint: '曲面屏/瀑布屏内容贴到屏幕弧边=往正加（两侧同时内收）；0=默认' },
      { k: 'desk', name: '桌面图标区', min: -60, max: 60, group: 'desk', hint: '全屏时桌面图标/按钮整体偏上=往正拉回（只影响桌面页）' },
      { k: 'text', name: '文字大小', min: 0, max: 12, group: 'text', hint: '聊天气泡/输入框/设置列表等正文文字整体加大（只放大文字组，非整页缩放）；0=默认' }
    ];
    // 组表＝「哪根滑杆管哪一页」的单一事实源（新增轴只要给 group 字段即可归类）
    const AXIS_GROUPS = {
      pos: '通用位置轴（桌面 / 聊天 / 设置都生效）',
      desk: '只影响「桌面页」',
      text: '只影响「聊天页」正文文字（气泡 / 输入框）'
    };
    function groupIsCurrent(g) {
      const nm = adjPageName();
      if (g === 'desk') return nm === '桌面';
      if (g === 'text') return nm === '聊天' || nm === '群聊';
      return false;
    }
    let panel = null;
    let elGrip = null, elHead = null, elBody = null, elMini = null; // 面板四块（收起态只留胶囊）
    // #940（用户 2026-09-20：「不是和边看边调一样半透明的，而且不能拖动滑动，不能预览其他页面」）
    // 对齐美化抽屉三件套：72% 半透明底（#562 口径）、竖向拖动（#760 bindDockDrag 口径）。
    // 拖动落位只记会话内、不落盘（纯 UI 位置，不碰数据层）。
    // #962（用户 2026-09-21：「现在只能在这个设置里面调、不能在桌面的页面调，需要区分在桌面页面
    // 调和在聊天页面里调，现在是盲调什么也看不见」）——无头实测（390×844）根因：面板贴底
    // bottom:0 时占距底 0~338px，而底部导航占距底 18~82px、聊天输入栏占距底 0~43px，
    // 连「收起」态也还占 0~70px ⇒ 切页的唯一入口（底部导航）与说话的唯一入口（输入栏）
    // 被整条盖死，用户在设置里开了面板就再也走不到桌面/聊天页，只能对着设置列表盲调。
    // 修法三条，零机型分支：①面板与胶囊自动停在底部操作区之上（量出来再让开）；
    // ②收起＝一枚小胶囊（不再横贯底边，点一下展开、拖走可让位），带着它就能切页看现场；
    // ③面板顶部显示「正在调：桌面/聊天」并给两枚切页按钮（#990 起＝带选中态的页签），桌面与聊天各自有入口。
    // #990（用户 2026-09-21：「屏幕适配打开了这个功能…没有把调桌面和聊天里的屏幕的功能分开，
    // 这样用户不知道点哪一个才是」「拖动说明那句没说清在挪什么」）修法：①两枚裸按钮改带选中态
    // 的页签（当前页那枚反色高亮＝一眼看出在调哪页，点另一枚＝切过去看现场）；②七轴按生效页面
    // 分三组加小标题，当前页那组打「你正在这一页」标记；③拖动说明从标题行（被按钮挤到省略号，
    // 用户根本没看到）移到标题下的用法段，标题行只留「按住这行标题上下拖＝把面板挪开」。
    // 注：本段注释刻意不照抄被替换掉的旧文案（旧句原文会命中 verify-962 的 S22/S24 删除型断言，
    // 也会命中 #982c 那类 absent 哨兵——注释里的裸标识符会被合并进产物）。
    let adjMini = false;   // true＝收起态小胶囊
    let adjBottom = null;  // null＝自动让开底部操作区；否则＝距视口底 px（用户拖过的位置）
    const toast = (msg) => { if (typeof window.toast === 'function') window.toast(msg); };

    // 当前页面短名：胶囊与面板顶部都显示它＝用户一眼知道正在给哪一页调
    function adjPageName() {
      const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };
      if (vis('page-chat')) return '聊天';
      if (vis('page-group-chat')) return '群聊';
      if (vis('page-phone')) return '桌面';
      if (vis('page-setting')) return '设置';
      return '本页';
    }
    // 底部操作区留白：tab 页＝底部导航栏高度；聊天/群聊页＝输入栏高度。量不到退回 14px。
    function bottomReserve() {
      let gap = 14;
      try {
        const chat = document.getElementById('page-chat');
        const gc = document.getElementById('page-group-chat');
        const host = (chat && !chat.hidden) ? chat : ((gc && !gc.hidden) ? gc : null);
        if (host) {
          const row = host.querySelector('.chat-input-row, .gc-input-row');
          const r = row && row.getBoundingClientRect();
          if (r && r.height) return Math.max(gap, Math.round(window.innerHeight - r.top + 8));
          return gap;
        }
        const tb = document.querySelector('.tabbar');
        const t = tb && tb.getBoundingClientRect();
        if (t && t.height && t.top > 0) gap = Math.max(gap, Math.round(window.innerHeight - t.top + 8));
      } catch (e) {}
      return gap;
    }
    // v8.29 #1008：落位写入带短过渡（cssText 里的 transition:bottom .16s ease，拖动期间由
    // bindAdjDrag 临时置 none）。切页时留白会在「底部导航留白」与「聊天输入栏留白 / 无导航
    // 14px」之间跳——无头实测：设置页 bottom:90px 一跳 → 聊天设置页 bottom:14px（旧实现
    // transition all 0s 硬切），76px 的瞬移就是用户报的「切换设置和设置美化还是会闪屏」。
    function applyAdjPos() { if (panel) panel.style.bottom = (adjBottom == null ? bottomReserve() : adjBottom) + 'px'; }
    function syncMiniLabel() {
      if (!panel) return;
      const nm = adjPageName();
      const pg = panel.querySelector('[data-adj-page]');
      if (pg) pg.textContent = nm;
      const ctx = panel.querySelector('[data-adj-ctx]');
      if (ctx) ctx.textContent = '正在调：' + nm;
      syncPageSeg();
    }
    // #990：页签选中态与分组标记——当前在调的那一页＝页签反色高亮、该页专有的那组滑杆＝
    // 打「你正在这一页」标记；切页（桌面↔聊天↔设置）随时跟着变，用户不必猜哪一根滑杆管哪页
    function syncPageSeg() {
      if (!panel) return;
      const nm = adjPageName();
      panel.querySelectorAll('[data-adj-goto]').forEach(function (b) {
        const on = (b.getAttribute('data-adj-goto') === 'chat') ? (nm === '聊天' || nm === '群聊') : (nm === '桌面');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.style.background = on ? '#111' : 'var(--btn-cancel-bg,#fafafa)';
        b.style.color = on ? '#fff' : 'var(--ink,#111)';
        b.style.borderColor = on ? '#111' : 'var(--card-border,#ddd)';
        b.style.fontWeight = on ? '800' : '600';
      });
      panel.querySelectorAll('[data-adj-group]').forEach(function (h) {
        const mk = h.querySelector('[data-adj-group-mine]');
        if (mk) mk.style.display = groupIsCurrent(h.getAttribute('data-adj-group')) ? 'inline-block' : 'none';
      });
      // 说明行随当前页改写：在设置/其它页开面板时两枚页签都不高亮（那两页都不是当前页），
      // 这里必须直说「点哪一枚切过去」，否则用户又会问「为什么两个都不亮、我该点哪个」
      const ch = panel.querySelector('[data-adj-ctxhint]');
      if (ch) {
        if (nm === '桌面') ch.textContent = '反色高亮的「桌面」＝你现在正在调的页面；点「聊天」就切到聊天页看现场（面板自动收成小胶囊）。';
        else if (nm === '聊天' || nm === '群聊') ch.textContent = '反色高亮的「聊天」＝你现在正在调的页面；点「桌面」就切到桌面页看现场（面板自动收成小胶囊）。';
        else ch.textContent = '当前不在桌面/聊天页（' + nm + '）：点「桌面」或「聊天」切过去看现场（面板自动收成小胶囊），调完点胶囊展开继续。';
      }
    }
    // 收起/展开：只切四块的显隐与外壳形态（全内联，不依赖新增 CSS 文件）
    function setMini(on) {
      if (!panel) return;
      adjMini = !!on;
      panel.style.left = '0'; panel.style.right = '0';
      if (adjMini) {
        panel.style.width = 'max-content'; panel.style.maxWidth = '80vw'; panel.style.margin = '0 auto';
        panel.style.borderRadius = '99px';
        panel.style.padding = '8px 14px';
        panel.style.overflow = 'visible';
        panel.style.boxShadow = '0 6px 20px rgba(0,0,0,.22)';
        panel.style.border = '1px solid var(--card-border,#ddd)';
        // 胶囊就这么点大：半透明会让底层文字透上来糊成一片，这一态用实色（展开态回半透明）
        panel.style.background = 'var(--card-bg,#fff)';
        panel.style.display = 'block';
      } else {
        panel.style.width = ''; panel.style.maxWidth = ''; panel.style.margin = '';
        panel.style.borderRadius = '16px 16px 0 0';
        panel.style.padding = '0 14px calc(14px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)))';
        panel.style.overflow = 'hidden auto';
        panel.style.boxShadow = '0 -6px 24px rgba(0,0,0,.18)';
        panel.style.border = 'none';
        panel.style.background = 'var(--card-bg,#fff)';
        panel.style.background = 'color-mix(in srgb, var(--card-bg,#fff) 72%, transparent)';
        panel.style.display = 'flex';
      }
      if (elGrip) elGrip.style.display = adjMini ? 'none' : 'block';
      if (elHead) elHead.style.display = adjMini ? 'none' : 'flex';
      if (elBody) elBody.style.display = adjMini ? 'none' : 'flex';
      if (elMini) elMini.style.display = adjMini ? 'flex' : 'none';
      syncMiniLabel();
      applyAdjPos();
    }
    // 切页后重算落位与页面名（只读观察 hidden 变化，不写页面状态＝不惊动 #336 的页面观察器）
    let adjObs = null;
    function watchAdjPages() {
      if (adjObs || !('MutationObserver' in window)) return;
      try {
        adjObs = new MutationObserver(function () { applyAdjPos(); syncMiniLabel(); });
        document.querySelectorAll('.page').forEach(function (p) { adjObs.observe(p, { attributes: true, attributeFilter: ['hidden'] }); });
      } catch (e) { adjObs = null; }
    }
    function unwindAdjPages() { try { if (adjObs) adjObs.disconnect(); } catch (e) {} adjObs = null; }
    // 拖动（面板把手与胶囊共用）：纵向改距底位置；胶囊态位移不足 6px 视为 tap＝展开
    function bindAdjDrag(el, tapToOpen) {
      el.style.touchAction = 'none';
      let sy = 0, sb = 0, drag = false, moved = false;
      el.addEventListener('pointerdown', (e) => {
        if (!tapToOpen && adjMini) return; // 展开态把手：胶囊态下不参与
        if (!tapToOpen && e.target.closest('button')) return; // header 里的按钮不参与拖动
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        drag = true; moved = false; sy = e.clientY;
        sb = parseFloat(panel.style.bottom) || bottomReserve();
        panel.style.transition = 'none'; // #1008：拖动期间关掉 bottom 过渡，保证跟手
        try { el.setPointerCapture(e.pointerId); } catch (er) {}
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (Math.abs(e.clientY - sy) > 6) moved = true;
        if (!moved) return;
        adjBottom = Math.max(0, Math.min(Math.round(window.innerHeight * 0.7), Math.round(sb + sy - e.clientY)));
        applyAdjPos();
      });
      const up = () => {
        if (!drag) return;
        drag = false;
        panel.style.transition = 'bottom .16s ease'; // #1008：松手恢复过渡（吸附/回自动位都是动画）
        if (tapToOpen && !moved) { setMini(false); return; } // 胶囊：点一下＝展开
        if (adjBottom != null && adjBottom <= bottomReserve() + 6) adjBottom = null; // 拖回自动位＝吸附复位
        applyAdjPos();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', () => { drag = false; });
      el.style.cursor = 'grab';
    }
    function valElOf(k) { return panel ? panel.querySelector('[data-adj-val="' + k + '"]') : null; }
    function sliderOf(k) { return panel ? panel.querySelector('[data-adj-slider="' + k + '"]') : null; }
    function refreshVals() {
      if (!panel || !window.mochiScreenAdj) return;
      const cur = window.mochiScreenAdj.all();
      AXES.forEach(ax => {
        const el = valElOf(ax.k);
        if (el) el.textContent = (cur[ax.k] > 0 ? '+' : '') + (cur[ax.k] || 0) + 'px';
        const sl = sliderOf(ax.k);
        if (sl) sl.value = cur[ax.k] || 0;
      });
    }
    function applyAxis(ax, nv, silent) {
      if (!window.mochiScreenAdj || !window.mochiScreenAdj.set(ax.k, nv)) return;
      refreshVals();
      if (!silent) toast(ax.name + ' ' + (nv > 0 ? '+' : '') + nv + 'px');
    }
    function buildPanel() {
      panel = document.createElement('div');
      panel.id = 'screen-adj-panel';
      // #940：底色 72% 半透明（color-mix 不支持的老内核自动回落上一句纯色）＋高度 62vh→40vh，
      // 与边看边调抽屉同口径；刻意不加 backdrop-filter——AGENTS 的 iOS 卡顿红线。
      panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:96;max-height:40vh;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);color:var(--ink,#111);box-shadow:0 -6px 24px rgba(0,0,0,.18);border-radius:16px 16px 0 0;overflow-y:auto;overflow-x:hidden;padding:0 14px calc(14px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)));box-sizing:border-box;display:flex;flex-direction:column;gap:6px;transition:bottom .16s ease';
      const grip = document.createElement('div');
      grip.style.cssText = 'width:36px;height:4px;border-radius:2px;background:var(--card-border,#ddd);margin:7px auto 2px;flex:none';
      panel.appendChild(grip);
      bindAdjDrag(grip, false);
      elGrip = grip;
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex:none;padding:2px 0 4px';
      // #990：标题与说明分两行——原来挤成一行时那句拖动提示被右侧按钮压成省略号
      // （390px 实测只剩不到 40px），用户看不到＝「没有写清楚」；现在这行完整可读
      const headTop = document.createElement('div');
      headTop.style.cssText = 'display:flex;align-items:center;gap:8px';
      headTop.innerHTML = '<b style="font-size:14px;flex:1;min-width:0">屏幕适配微调</b><span style="font-size:11px;color:#666;flex:none">本机永久保存</span>';
      head.appendChild(headTop);
      const headTool = document.createElement('div');
      headTool.style.cssText = 'display:flex;align-items:center;gap:8px';
      head.appendChild(headTool);
      const headHint = document.createElement('span');
      headHint.setAttribute('data-adj-draghint', '');
      headHint.style.cssText = 'font-size:11px;color:#666;flex:1;min-width:0;line-height:1.3';
      headHint.textContent = '按住这行标题上下拖＝把面板挪开';
      headTool.appendChild(headHint);
      const done = document.createElement('button');
      done.textContent = '完成';
      done.style.cssText = 'flex:none;border:none;background:#111;color:#fff;font-size:12px;font-weight:700;border-radius:99px;padding:6px 16px;cursor:pointer';
      done.addEventListener('click', closePanel);
      headTop.appendChild(done);
      // #794：按住看默认（A/B 对比）——按住期间全部轴临时归零预览出厂形态，
      // 松手恢复按住前的值；拖方向拿不准时按一下就知道该往哪边拖
      const holdBtn = document.createElement('button');
      holdBtn.textContent = '按住看默认';
      holdBtn.style.cssText = 'flex:none;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:12px;border-radius:99px;padding:6px 12px;cursor:pointer';
      let heldSnap = null;
      const holdOn = function () {
        if (heldSnap || !window.mochiScreenAdj) return;
        heldSnap = window.mochiScreenAdj.all();
        AXES.forEach(function (ax) { applyAxis(ax, 0, true); });
        holdBtn.textContent = '松手恢复';
      };
      const holdOff = function () {
        if (!heldSnap) return;
        const snap = heldSnap; heldSnap = null;
        AXES.forEach(function (ax) { applyAxis(ax, snap[ax.k] || 0, true); });
        holdBtn.textContent = '按住看默认';
        refreshVals();
      };
      holdBtn.addEventListener('pointerdown', holdOn);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { holdBtn.addEventListener(ev, holdOff); });
      headTool.insertBefore(holdBtn, headHint);
      // #940：收起＝只剩 grip＋标题行，露出 tabbar 可切到桌面/聊天等页面看六轴现场（同抽屉口径）
      const foldBtn = document.createElement('button');
      foldBtn.textContent = '收起';
      foldBtn.title = '收成一枚小胶囊（不挡底部导航/输入栏），切到桌面或聊天继续调';
      foldBtn.style.cssText = 'flex:none;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:12px;border-radius:99px;padding:6px 12px;cursor:pointer';
      const adjBody = document.createElement('div');
      adjBody.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:none';
      elBody = adjBody;
      // #962：收起＝整块收成小胶囊（原实现只折正文区，外壳仍横贯底边 70px 高、照样盖住底部导航）
      foldBtn.addEventListener('click', () => { setMini(true); });
      headTool.insertBefore(foldBtn, holdBtn);
      panel.appendChild(head);
      elHead = head;
      bindAdjDrag(head, false); // grip 只有 4px 高，标题行才是主拖拽把手
      // #962：收起态胶囊——一枚小 chip（点一下展开、可拖走让位），头上带当前页面名
      // ⇒ 用户带着它就能切到桌面/聊天看现场，一眼知道在给哪一页调
      const mini = document.createElement('div');
      mini.setAttribute('data-adj-mini', '');
      mini.style.cssText = 'display:none;align-items:center;gap:8px;font-size:13px;font-weight:700;white-space:nowrap';
      mini.innerHTML = '<span style="font-size:13px;font-weight:800">适配</span><span data-adj-page style="font-weight:600;color:#888">桌面</span><span style="font-weight:500;font-size:11px;color:#999">点开调 ›</span>';
      bindAdjDrag(mini, true);
      panel.appendChild(mini);
      elMini = mini;
      // #990：用法写在面板最上面（用户报拖动那句没说清在挪什么——原句还被右侧按钮挤成
      // 省略号）。拖动这条现已挪到标题行那行明说，这里只讲「切页」与「哪根滑杆管哪页」这两件
      // 最容易点错的事，避免把滑杆挤出首屏
      const tip = document.createElement('div');
      tip.setAttribute('data-adj-usage', '');
      tip.style.cssText = 'font-size:11px;color:#666;flex:none;line-height:1.5';
      tip.textContent = '想调哪一页，就点「正在调」旁边那一枚页签——切过去看现场（面板自动收成小胶囊）。下面滑杆按「哪一页生效」分三组，标着「你正在这一页」的那组才是当前页要调的；拖动当场生效、双击滑杆回默认 0。';
      adjBody.appendChild(tip);
      // #962 现场行 → #990：原来两枚裸按钮（分别写着「看桌面」与「看聊天」）分不出哪一枚是
      // 「我现在要调的」，用户报「不知道点哪一个才是」——改成带选中态的页签（当前页反色高亮）＋ 一行说明
      const ctx = document.createElement('div');
      ctx.style.cssText = 'flex:none;display:flex;align-items:center;gap:8px;border:1px solid var(--card-border,#eee);border-radius:10px;padding:7px 10px;font-size:12px';
      const ctxTxt = document.createElement('span');
      ctxTxt.setAttribute('data-adj-ctx', '');
      ctxTxt.style.cssText = 'flex:1;min-width:0;font-weight:600';
      ctxTxt.textContent = '正在调：' + adjPageName();
      ctx.appendChild(ctxTxt);
      [['page-phone', '桌面'], ['chat', '聊天']].forEach(function (pair) {
        const pb = document.createElement('button');
        pb.setAttribute('data-adj-goto', pair[0]);
        pb.setAttribute('aria-pressed', 'false');
        pb.title = '切到「' + pair[1] + '」页看现场（面板自动收成小胶囊）';
        pb.textContent = pair[1];
        pb.style.cssText = 'flex:none;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:12px;font-weight:600;border-radius:99px;padding:5px 14px;cursor:pointer';
        pb.addEventListener('click', function () { goPage(pair[0]); });
        ctx.appendChild(pb);
      });
      adjBody.appendChild(ctx);
      const ctxHint = document.createElement('div');
      ctxHint.setAttribute('data-adj-ctxhint', '');
      ctxHint.style.cssText = 'font-size:11px;color:#666;flex:none;line-height:1.4;margin-top:-2px';
      ctxHint.textContent = '点「桌面」或「聊天」切过去看现场（面板自动收成小胶囊），调完点胶囊展开继续。'; // syncPageSeg 随后按当前页改写
      adjBody.appendChild(ctxHint);
      // #794：诊断建议行——打开面板即现场探测一次（device.js 只读采集+判定同源），
      // 有可修项才显示；点「一键修正」直接写入对应轴，不用再跑诊断报告
      try {
        const sug = (window.mochiScreenFixSuggest ? window.mochiScreenFixSuggest() : []) || [];
        if (sug.length) {
          const srow = document.createElement('div');
          srow.style.cssText = 'flex:none;display:flex;align-items:center;gap:8px;border:1px solid #d9a400;background:#fff8e0;color:#6b5200;font-size:11.5px;line-height:1.5;border-radius:10px;padding:8px 10px';
          const stxt = document.createElement('span');
          stxt.style.cssText = 'flex:1;min-width:0';
          stxt.textContent = '诊断发现：' + sug.map(function (s) { return s.why; }).join('、');
          srow.appendChild(stxt);
          const sbtn = document.createElement('button');
          sbtn.textContent = '一键修正';
          sbtn.style.cssText = 'flex:none;border:none;background:#8a6d00;color:#fff;font-size:11.5px;font-weight:700;border-radius:99px;padding:5px 12px;cursor:pointer';
          sbtn.addEventListener('click', function () {
            let n = 0;
            sug.forEach(function (s) { try { if (window.mochiScreenAdj.set(s.axis, s.delta)) n++; } catch (e) {} });
            toast(n ? ('已按诊断应用 ' + n + ' 项修正') : '没有可应用的修正');
            refreshVals();
            if (srow.parentNode) srow.remove();
          });
          srow.appendChild(sbtn);
          adjBody.appendChild(srow);
        }
      } catch (eSug) {}
      const cur0 = window.mochiScreenAdj ? window.mochiScreenAdj.all() : {};
      let lastGroup = '';
      AXES.forEach(ax => {
        // #990：换组就插一个小标题＝「这根滑杆管哪一页」的唯一说明位，当前页那组带「你正在这一页」
        if (ax.group !== lastGroup) {
          lastGroup = ax.group;
          const gh = document.createElement('div');
          gh.setAttribute('data-adj-group', ax.group);
          gh.style.cssText = 'flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;font-weight:800;color:#444;padding-top:7px';
          gh.textContent = AXIS_GROUPS[ax.group] || '';
          const mine = document.createElement('span');
          mine.setAttribute('data-adj-group-mine', '');
          mine.style.cssText = 'display:none;background:#111;color:#fff;font-size:10px;font-weight:700;border-radius:99px;padding:1px 7px';
          mine.textContent = '你正在这一页';
          gh.appendChild(mine);
          adjBody.appendChild(gh);
        }
        const row = document.createElement('div');
        row.style.cssText = 'flex:none;border-top:1px solid var(--card-border,#eee);padding:7px 0';
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;align-items:center;gap:8px';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'flex:1;min-width:0;font-size:13px;font-weight:600';
        lbl.innerHTML = ax.name + ' <span style="font-weight:400;color:#888;font-size:11px">（' + ax.min + '~' + ax.max + 'px）</span>';
        line.appendChild(lbl);
        const val = document.createElement('span');
        val.setAttribute('data-adj-val', ax.k);
        val.style.cssText = 'flex:none;min-width:52px;text-align:right;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums';
        line.appendChild(val);
        row.appendChild(line);
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:10.5px;color:#999;line-height:1.4;margin:1px 0 3px';
        sub.textContent = ax.hint;
        row.appendChild(sub);
        const rng = document.createElement('input');
        rng.type = 'range';
        rng.setAttribute('data-adj-slider', ax.k);
        rng.min = ax.min; rng.max = ax.max; rng.step = 1;
        rng.value = cur0[ax.k] || 0;
        rng.style.cssText = 'width:100%;margin:0;accent-color:#111';
        rng.addEventListener('input', () => {
          applyAxis(ax, parseInt(rng.value, 10) || 0, true);
        });
        rng.addEventListener('dblclick', () => { applyAxis(ax, 0); });
        row.appendChild(rng);
        adjBody.appendChild(row);
      });
      const reset = document.createElement('button');
      reset.textContent = '全部恢复默认（各轴归零）';
      reset.style.cssText = 'flex:none;margin-top:6px;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:12px;font-weight:600;border-radius:99px;padding:8px 0;cursor:pointer';
      reset.addEventListener('click', () => {
        AXES.forEach(ax => applyAxis(ax, 0, true));
        toast('屏幕适配微调已全部恢复默认');
      });
      adjBody.appendChild(reset);
      // #794：适配码（换机/情侣互帮）——把当前各轴值打成一串 MCADJ1 码，对方在
      // 「屏幕适配微调→导入适配码」粘贴即套用（值域校验走 mochiScreenAdj.set，
      // 越界/残缺项自动忽略，不会把对方面板写坏）
      const MOCHI_ADJ_TAG = 'MCADJ1:';
      const ADJ_CODE_MAP = { t: 'top', b: 'bottom', h: 'h', d: 'desk', s: 'shift', x: 'text', e: 'side' };
      function adjCodeExport() {
        const a = window.mochiScreenAdj ? window.mochiScreenAdj.all() : {};
        const o = {};
        Object.keys(ADJ_CODE_MAP).forEach(function (k) { o[k] = a[ADJ_CODE_MAP[k]] || 0; });
        return MOCHI_ADJ_TAG + JSON.stringify(o);
      }
      function adjCodeImport(str) {
        str = String(str || '');
        const at = str.indexOf(MOCHI_ADJ_TAG);
        if (at < 0) return -1;
        const b0 = str.indexOf('{', at);
        const b1 = str.lastIndexOf('}');
        if (b0 < 0 || b1 <= b0) return -1;
        let o = null;
        try { o = JSON.parse(str.slice(b0, b1 + 1)); } catch (e) { return -1; }
        if (!o || typeof o !== 'object') return -1;
        let n = 0;
        Object.keys(ADJ_CODE_MAP).forEach(function (k) {
          if (o[k] !== undefined && window.mochiScreenAdj.set(ADJ_CODE_MAP[k], o[k])) n++;
        });
        return n;
      }
      const codeRow = document.createElement('div');
      codeRow.style.cssText = 'flex:none;display:flex;gap:8px;margin-top:6px';
      const expBtn = document.createElement('button');
      expBtn.textContent = '复制适配码';
      expBtn.style.cssText = 'flex:1;border:1px solid var(--card-border,#ddd);background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:12px;font-weight:600;border-radius:99px;padding:8px 0;cursor:pointer';
      expBtn.addEventListener('click', function () {
        const code = adjCodeExport();
        let settled = false;
        const fin = function (ok) {
          if (settled) return; settled = true;
          toast(ok ? '适配码已复制，发给对方在本面板「导入适配码」粘贴' : '复制失败，请手动抄录：' + code);
        };
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code).then(function () { fin(true); }, function () { fin(false); }); return; } } catch (e1) {}
        try {
          const ta = document.createElement('textarea');
          ta.value = code;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
          document.body.appendChild(ta);
          ta.select();
          const ok2 = document.execCommand('copy');
          window.mochiKillCopySelection && window.mochiKillCopySelection(ta);
          document.body.removeChild(ta);
          fin(!!ok2);
        } catch (e2) { fin(false); }
      });
      codeRow.appendChild(expBtn);
      const impBtn = document.createElement('button');
      impBtn.textContent = '导入适配码';
      impBtn.style.cssText = expBtn.style.cssText;
      impBtn.addEventListener('click', function () {
        window.openModal('导入适配码', '', function (v) {
          const n = adjCodeImport(v);
          if (n < 0) { toast('适配码无法识别——请让对方在「屏幕适配微调」里点「复制适配码」后整段发来'); return; }
          refreshVals();
          toast(n ? ('已应用对方适配码（' + n + ' 项生效）') : '适配码与本机现状一致，无需改动');
        });
      });
      codeRow.appendChild(impBtn);
      adjBody.appendChild(codeRow);
      panel.appendChild(adjBody);
      document.body.appendChild(panel);
      setMini(false); // 每次新建都从展开态起步（落位自动摆到底部操作区之上）
      watchAdjPages();
    }
    function closePanel() { if (panel) { panel.remove(); panel = null; unwindAdjPages(); } }
    // #962：切到桌面/聊天现场（面板里那两枚切页页签用）——切完自动收成胶囊，一眼看到那一页
    function goPage(which) {
      try {
        if (which === 'chat') { if (typeof window.enterChat === 'function') window.enterChat(); }
        else { const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click(); }
      } catch (e) {}
      setMini(true);
      applyAdjPos();
      syncMiniLabel();
    }
    function openAdjPanel() {
      // #962：节点若被外部摘掉（页面重建/测试脚本 remove）就重建——否则 openAdjPanel 会对着
      // 游离节点置 hidden=false：命令都执行了、屏上什么都没有（实测踩过）
      if (!panel || !panel.isConnected) { panel = null; buildPanel(); }
      else panel.hidden = false; // 安卓返回键走 tabs.js 只置 hidden，重开要显回来（防 zombie 面板）
      applyAdjPos();
      refreshVals();
      syncMiniLabel();
    }
    // #962/#982：三处入口收敛到同一个开面板动作——设置页「工具」首位（原有）＋聊天页「聊天设置 → 美化」
    // ＋桌面页「装修模式栏」，用户不用先钻进设置：在桌面/聊天现场就能开面板调，调的位置看得见＝不再盲调。
    // #982：聊天侧入口由「更多 → 工具」改为「聊天设置 → 美化」（用户直派），按钮 id 随行 id 一并换掉。
    window.mochiOpenScreenAdj = openAdjPanel;
    const entry = document.getElementById('row-screen-adj');
    if (entry) entry.addEventListener('click', openAdjPanel);
    const chatSetEntry = document.getElementById('cs-screen-adj');
    if (chatSetEntry) chatSetEntry.addEventListener('click', openAdjPanel);
    const decorEntry = document.getElementById('decor-fit');
    if (decorEntry) decorEntry.addEventListener('click', () => {
      try { if (window.exitDecor) window.exitDecor(); } catch (e) {} // 先退出装修模式再开面板，避免两层叠着看不清
      openAdjPanel();
    });
    try {
      window.addEventListener('resize', () => { applyAdjPos(); });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (panel) applyAdjPos(); });
    } catch (e) {}
  })();

  // 今日情话：每天固定随机一条（按日期种子，当天不变，隔天换新）
  // 字卡库「桌面今日情话」可自定义字卡库；未自定义时用默认库
  // v3.6.x：抽成可复用函数——多桌面切换联系人后重读新桌面的字卡库与存档
  function renderQuoteOfDay() {
    const el = document.getElementById('love-quote');
    if (!el) return;
    const text = (window.getQuoteOfDay && window.getQuoteOfDay()) || '我偏爱你。';
    el.textContent = window.taFit ? window.taFit(text) : text;
    // v3.25.x：3 行（45px 盒）仍放不下时逐级缩字号（13→10px 下限），尽量卡内显示全文；
    // 超过 10px 也装不下的极端长句保留省略号（完整内容日历页按天可查）。
    // rAF 等一帧布局稳定后再量，避免启动早期量到 0 高。
    requestAnimationFrame(function () {
      var fs = 13;
      el.style.fontSize = fs + 'px';
      while (el.scrollHeight > el.clientHeight + 1 && fs > 10) {
        fs -= 0.5;
        el.style.fontSize = fs + 'px';
      }
    });
    // 今日情话存档：每天一条，全部历史保存在主页（同一天不重复）
    try {
      const today = fishToday();
      const list = JSON.parse(store.get('quote-history') || '[]');
      if (!list.length || list[0].date !== today) {
        list.unshift({ date: today, text: text, ts: Date.now() });
        store.set('quote-history', JSON.stringify(list));
      }
    } catch (e) {}
  }
  renderQuoteOfDay();

  // 主纪念日（原「恋爱纪念日」）：已相伴天数（默认不预设日期，设置页选择后显示）
  // v3.26.x：可设关系类型 rel-cat（love 爱情向 / family 亲情向 / friend 友情向）+ 关系称呼 rel-role（选填）
  function relCat() {
    const v = store.get('rel-cat');
    return v === 'family' || v === 'friend' ? v : 'love';
  }
  function relRole() {
    return (store.get('rel-role') || '').trim();
  }
  function relLabel() {
    const c = relCat();
    return c === 'family' ? '亲情纪念日' : c === 'friend' ? '友情纪念日' : '恋爱纪念日';
  }
  function updateLove() {
    // v8.29 #984：统一经 normDateStr 收口——历史脏值（如内核 date 回落 text 时落库的
    // 「20260601」）不再渲染成「20260601 年 undefined 月 undefined 日」
    const start = normDateStr(store.get('love-start'));
    const daysEl = document.getElementById('love-days');
    const dateEl = document.getElementById('love-date');
    const mDays = document.getElementById('mem-love-days');
    const mDate = document.getElementById('mem-love-date');
    const mNext = document.getElementById('mem-next');
    const label = relLabel();
    if (!start) {
      if (daysEl) daysEl.textContent = '';
      if (dateEl) dateEl.textContent = '';
      if (mDays) mDays.textContent = '—';
      if (mDate) mDate.textContent = '';
      if (mNext) mNext.textContent = '请先设置' + label;
      return;
    }
    const d = new Date(start + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    const days = Math.max(1, Math.floor((new Date() - d) / 864e5));
    const fmt = start.split('-').join('.');
    // 爱情向=「我们在一起」，亲情/友情向=「我们相识」；设置了关系称呼时以称呼为对象（如「和姐姐相识」）
    const role = relRole();
    const who = role ? '和' + role : '我们';
    const tog = relCat() === 'love' ? '在一起' : '相识';
    const base = fmt + ' 起 · ' + who + tog;
    if (daysEl) daysEl.textContent = days + ' 天';
    if (dateEl) dateEl.textContent = base;
    if (mDays) mDays.textContent = days;
    if (mDate) mDate.textContent = base;
    // 下一个纪念日倒计时（下次同月同日）
    const now = new Date();
    const ann = new Date(now.getFullYear(), d.getMonth(), d.getDate());
    if (ann.getTime() < now.getTime()) ann.setFullYear(ann.getFullYear() + 1);
    const cd = Math.ceil((ann - now) / 864e5);
    if (mNext) mNext.textContent = '还有 ' + cd + ' 天 · ' + (ann.getMonth() + 1) + ' 月 ' + ann.getDate() + ' 日';
  }
  updateLove();

  // 设置页恋爱纪念日：站内月历弹层（openLoveDateModal）
  // v8.29 #984：原实现是「透明的原生 date 控件铺满假按钮」——按钮本身 pointer-events:none
  //   且无任何点击处理，点按能否生效、取回的日期字符串是什么形态，全看内核把触摸转发给
  //   原生控件的行为与内核的 date 支持（date 回落 text 的内核给的是「20260601」这类无连字
  //   符串，落库即脏值）。iPhone X / iOS16.7 / 夸克实报「点击设置恋爱纪念日无反应」，同族
  //   机型同现；功能大全「纪念 · 恋爱纪念日」的链式 .click() 也正落在这个没有处理器的按钮
  //   上（点了没反应）。改为纯 DOM 月历（与「添加纪念日」共用 .mem-cal 渲染），点击、取值、
  //   校验全在自己手里，零机型分支。
  const dateBtnTxt = document.getElementById('love-date-btn-txt');
  const dateBtn = document.getElementById('love-date-btn');
  // 日期字符串收口：只接受 YYYY-MM-DD，并容忍内核/历史数据里的无连字符与点/斜杠形态
  function normDateStr(v) {
    const s = String(v == null ? '' : v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (!m) m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(s);
    if (!m) return '';
    const y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }
  // 纪念日起值的唯一写入口（月历「确定」与任何外部赋值都走它）：非法值一律不落库
  function setLoveStart(v) {
    const ds = normDateStr(v);
    if (!ds) return false;
    store.set('love-start', ds);
    syncLoveDateBtn(ds);
    updateLove();
    try { renderDeskAnniv(); } catch (e) {}
    return true;
  }
  // 把已选的日期显示到按钮文字上
  function syncLoveDateBtn(val) {
    if (!dateBtnTxt || !dateBtn) return;
    const ds = normDateStr(val);
    if (ds) {
      const parts = ds.split('-');
      dateBtnTxt.textContent = parts[0] + ' 年 ' + parts[1] + ' 月 ' + parts[2] + ' 日';
      dateBtn.setAttribute('data-set', '1');
    } else {
      dateBtnTxt.textContent = '点击设置日期';
      dateBtn.setAttribute('data-set', '0');
    }
  }
  syncLoveDateBtn(store.get('love-start'));
  if (dateBtn) dateBtn.addEventListener('click', openLoveDateModal);

  // v3.26.x：主纪念日关系类型（爱情向/亲情向/友情向）+ 关系称呼（选填）
  // 桌面双方头像之间的图标随类型切换：爱情=爱心 / 亲情=家 / 友情=两人
  const REL_ICONS = {
    love: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>',
    family: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    friend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>'
  };
  function renderDeskRelIcon() {
    const el = document.getElementById('deco-heart');
    if (el) el.innerHTML = REL_ICONS[relCat()] || REL_ICONS.love;
  }
  function syncRelUI() {
    const labelEl = document.getElementById('mem-love-label');
    if (labelEl) labelEl.textContent = relLabel();
    const row = document.getElementById('rel-type-row');
    if (row) {
      row.querySelectorAll('.mem-type-pill').forEach(b => {
        b.classList.toggle('sel', b.getAttribute('data-rel') === relCat());
      });
    }
    const roleInput = document.getElementById('rel-role-input');
    if (roleInput && roleInput.value !== (store.get('rel-role') || '')) roleInput.value = store.get('rel-role') || '';
    renderDeskRelIcon();
  }
  const relRow = document.getElementById('rel-type-row');
  if (relRow) {
    relRow.addEventListener('click', (e) => {
      const b = e.target.closest('.mem-type-pill');
      if (!b) return;
      store.set('rel-cat', b.getAttribute('data-rel'));
      syncRelUI();
      updateLove();
      renderDeskAnniv();
    });
  }
  const roleInput = document.getElementById('rel-role-input');
  if (roleInput) {
    let roleTimer = null;
    const saveRole = () => {
      store.set('rel-role', (roleInput.value || '').trim());
      updateLove();
    };
    roleInput.addEventListener('change', saveRole);
    roleInput.addEventListener('input', () => {
      clearTimeout(roleTimer);
      roleTimer = setTimeout(saveRole, 400);
    });
  }
  syncRelUI();

  // 其他纪念日：可自由添加/删除（存本地）
  // 条目：{ name, date, type }——type: 'ann' 纪念日（已 X 天）/ 'count' 倒数日（还有 X 天）
  function getExtras() {
    try { return JSON.parse(store.get('mem-extras') || '[]'); } catch (e) { return []; }
  }
  function saveExtras(list) { store.set('mem-extras', JSON.stringify(list)); }
  function renderExtras() {
    const list = document.getElementById('mem-extra-list');
    if (!list) return;
    const extras = getExtras();
    list.innerHTML = '';
    extras.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'mem-extra';
      const target = new Date(it.date + 'T00:00:00');
      // v3.5.131：非法日期（导入的脏数据）跳过，不再显示"还有 NaN 天"
      if (isNaN(target.getTime())) return;
      // diff 正 = 日期在未来（倒计时）；负 = 已过
      const diff = Math.round((target.getTime() - Date.now()) / 864e5);
      const isCount = it.type === 'count' || diff > 0;
      const label = isCount
        ? (diff > 0 ? '还有 ' + diff + ' 天' : '就是今天')
        : '已 ' + Math.abs(diff) + ' 天';
      const fmt = it.date.split('-').join('.');
      d.innerHTML =
        '<span class="me-name">' + it.name + '</span>' +
        '<span class="me-date">' + fmt + '</span>' +
        '<span class="me-days' + (isCount ? ' count' : '') + '">' + label + '</span>' +
        '<button class="me-del">✕</button>';
      d.querySelector('.me-del').addEventListener('click', () => {
        const ex = getExtras();
        ex.splice(i, 1);
        saveExtras(ex);
        renderExtras();
      });
      list.appendChild(d);
    });
  }
  const memAdd = document.getElementById('mem-add');
  if (memAdd) {
    memAdd.addEventListener('click', openMemAddModal);
  }

  // ================= 纪念日日期选择：月历（「添加纪念日」与「恋爱纪念日」共用） =================
  // v3.5.29：从"文本输入名称+日期"改为可视化月历点选（更直观美观）
  // v8.29 #984：渲染与导航抽成共用件——两个弹层同一实现，日期控件族的坑只修一处，
  //   不再逐入口手抄（手抄必漏是本族反复复发的结构性原因）。
  let memMask = null;      // 添加纪念日弹层单例
  let memSelDate = '';     // 选中日期 'YYYY-MM-DD'
  let memSelType = 'auto'; // auto/ann/count
  const mvYM = { y: 0, m: -1 }; // 弹层当前查看的年/月（m=-1 表示「本月」，首帧落到当前年月）
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function memToday() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  // 月历导航条：‹‹ ›› 按年跳（选几年前的纪念日不必点几十下），‹ › 按月跳
  const MEM_CAL_NAV_HTML =
    '<div class="mem-cal-nav">' +
      '<button class="mem-cal-btn" data-nav="-12" title="上一年"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg></button>' +
      '<button class="mem-cal-btn" data-nav="-1" title="上个月"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M15 18l-6-6 6-6"/></svg></button>' +
      '<span class="mem-cal-title"></span>' +
      '<button class="mem-cal-btn" data-nav="1" title="下个月"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M9 18l6-6-6-6"/></svg></button>' +
      '<button class="mem-cal-btn" data-nav="12" title="下一年"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M13 7l5 5-5 5"/><path d="M6 7l5 5-5 5"/></svg></button>' +
    '</div>';
  // 画一个月（ym={y,m} 会被就地修正为合法月份；selDate 打选中态、今天打 today 态）
  function memCalPaint(panel, ym, selDate, onPick) {
    while (ym.m < 0) { ym.m += 12; ym.y--; }
    while (ym.m > 11) { ym.m -= 12; ym.y++; }
    const title = panel.querySelector('.mem-cal-title');
    const grid = panel.querySelector('.mem-cal-grid');
    if (!title || !grid) return;
    title.textContent = ym.y + ' 年 ' + (ym.m + 1) + ' 月';
    const days = new Date(ym.y, ym.m + 1, 0).getDate();
    const startWd = new Date(ym.y, ym.m, 1).getDay();
    const wds = ['日', '一', '二', '三', '四', '五', '六'];
    const t = memToday();
    let html = wds.map(w => '<span class="mem-cal-wd">' + w + '</span>').join('');
    for (let i = 0; i < startWd; i++) html += '<span class="mem-cal-cell blank"></span>';
    for (let d = 1; d <= days; d++) {
      const ds = ym.y + '-' + pad2(ym.m + 1) + '-' + pad2(d);
      html += '<span class="mem-cal-cell' + (ds === t ? ' today' : '') + (ds === selDate ? ' sel' : '') + '" data-d="' + ds + '">' + d + '</span>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.mem-cal-cell[data-d]').forEach(cell => {
      cell.addEventListener('click', () => { onPick(cell.getAttribute('data-d')); });
    });
  }
  function memCalNavBind(panel, ym, onChange) {
    panel.querySelectorAll('.mem-cal-btn').forEach(b => b.addEventListener('click', () => {
      ym.m += parseInt(b.getAttribute('data-nav'), 10) || 0;
      while (ym.m < 0) { ym.m += 12; ym.y--; }
      while (ym.m > 11) { ym.m -= 12; ym.y++; }
      onChange();
    }));
  }
  function renderMemCal() {
    if (!memMask) return;
    if (mvYM.m < 0) { const now = new Date(); mvYM.y = now.getFullYear(); mvYM.m = now.getMonth(); }
    memCalPaint(memMask, mvYM, memSelDate, (d) => { memSelDate = d; renderMemCal(); });
  }
  function closeMemAdd() {
    if (memMask) memMask.hidden = true;
  }
  function openMemAddModal() {
    if (!memMask) {
      memMask = document.createElement('div');
      memMask.id = 'mem-add-mask';
      memMask.className = 'mg-mask';
      memMask.innerHTML =
        '<div class="mg-panel mem-add-panel">' +
          '<div class="mg-head"><span>添加纪念日 / 倒数日</span><button class="mg-close">✕</button></div>' +
          '<input type="text" class="mem-add-input" placeholder="名称（如：在一起一周年 / 生日）" maxlength="24">' +
          '<div class="mem-cal">' + MEM_CAL_NAV_HTML + '<div class="mem-cal-grid"></div></div>' +
          '<div class="mem-type-row">' +
            '<button class="mem-type-pill sel" data-type="auto">自动</button>' +
            '<button class="mem-type-pill" data-type="ann">纪念日</button>' +
            '<button class="mem-type-pill" data-type="count">倒数日</button>' +
          '</div>' +
          '<div class="mem-type-hint">未来日期自动按倒数日显示，过去日期按纪念日显示</div>' +
          '<div class="mem-add-foot">' +
            '<button class="mem-add-cancel">取消</button>' +
            '<button class="mem-add-ok">添加</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(memMask);
      memMask.querySelector('.mg-close').addEventListener('click', closeMemAdd);
      memMask.addEventListener('click', (e) => { if (e.target === memMask) closeMemAdd(); });
      memMask.querySelector('.mem-add-cancel').addEventListener('click', closeMemAdd);
      // 月份/年份切换（共用件：‹ › 按月、‹‹ ›› 按年）
      memCalNavBind(memMask, mvYM, renderMemCal);
      // 类型切换
      memMask.querySelectorAll('.mem-type-pill').forEach(b => b.addEventListener('click', () => {
        memSelType = b.getAttribute('data-type');
        memMask.querySelectorAll('.mem-type-pill').forEach(x => x.classList.toggle('sel', x === b));
      }));
      // 确定添加
      memMask.querySelector('.mem-add-ok').addEventListener('click', () => {
        // v3.6.x：用 input.mem-add-input 精确命中输入框锚点——手机端（安卓 Chrome/Edge）
        // contenteditable 转换器会在原 input 前插一个同类的 .ce-box div，querySelector('.mem-add-input')
        // 会先匹配到这个 div（div.value 恒为 undefined），导致名称永远为空、纪念日添加不了
        const nameInput = memMask.querySelector('input.mem-add-input');
        const name = (nameInput.value || '').trim();
        if (!name) { nameInput.focus(); toast('请填写名称'); return; }
        if (!memSelDate) { toast('请选择日期'); return; }
        const type = memSelType === 'auto'
          ? (new Date(memSelDate + 'T00:00:00').getTime() > Date.now() ? 'count' : 'ann')
          : memSelType;
        const ex = getExtras();
        ex.push({ name: name, date: memSelDate, type: type });
        saveExtras(ex);
        renderExtras();
        closeMemAdd();
      });
    }
    // 每次打开重置：默认今天 + 自动类型
    memMask.hidden = false;
    memSelDate = memToday();
    memSelType = 'auto';
    const nameInput = memMask.querySelector('input.mem-add-input');
    nameInput.value = '';
    memMask.querySelectorAll('.mem-type-pill').forEach(x => x.classList.toggle('sel', x.getAttribute('data-type') === 'auto'));
    mvYM.y = 0; mvYM.m = -1;
    renderMemCal();
    setTimeout(() => nameInput.focus(), 80);
  }

  // ================= 恋爱纪念日：选日期弹层（#984） =================
  // 与「添加纪念日」同一套月历渲染，但只做一件事：选一个日期写进 love-start。
  // 纯 DOM、按钮自己接点击——不再依赖任何内核的原生日期控件行为。
  let memDateMask = null;
  let mdSel = '';
  const mdYM = { y: 0, m: 0 };
  function renderMemDateCal() {
    if (!memDateMask) return;
    memCalPaint(memDateMask, mdYM, mdSel, (d) => { mdSel = d; renderMemDateCal(); });
  }
  function closeMemDateModal() { if (memDateMask) memDateMask.hidden = true; }
  function openLoveDateModal() {
    if (!memDateMask) {
      memDateMask = document.createElement('div');
      memDateMask.id = 'mem-date-mask';
      memDateMask.className = 'mg-mask';
      memDateMask.innerHTML =
        '<div class="mg-panel mem-add-panel">' +
          '<div class="mg-head"><span>选择日期</span><button class="mg-close">✕</button></div>' +
          '<div class="mem-cal">' + MEM_CAL_NAV_HTML + '<div class="mem-cal-grid"></div></div>' +
          '<div class="mem-type-hint">‹ › 按月换，‹‹ ›› 按年换；点日期选中后按「确定」</div>' +
          '<div class="mem-add-foot">' +
            '<button class="mem-add-cancel">取消</button>' +
            '<button class="mem-add-ok">确定</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(memDateMask);
      memCalNavBind(memDateMask, mdYM, renderMemDateCal);
      memDateMask.querySelector('.mg-close').addEventListener('click', closeMemDateModal);
      memDateMask.addEventListener('click', (e) => { if (e.target === memDateMask) closeMemDateModal(); });
      memDateMask.querySelector('.mem-add-cancel').addEventListener('click', closeMemDateModal);
      memDateMask.querySelector('.mem-add-ok').addEventListener('click', () => {
        if (!setLoveStart(mdSel)) { toast('日期没选上，请再点一次'); return; }
        closeMemDateModal();
      });
    }
    // 每次打开：已设过就停在那一天（选中态 + 视图年月），没设过就以今天为初始
    const cur = normDateStr(store.get('love-start')) || memToday();
    mdSel = cur;
    const cp = cur.split('-');
    mdYM.y = +cp[0]; mdYM.m = +cp[1] - 1;
    memDateMask.hidden = false;
    renderMemDateCal();
  }

  // 纪念页：桌面【纪念】图标进入
  const memApp = document.querySelector('.app[data-app="memory"]');
  const memPage = document.getElementById('page-memory');
  if (memApp && memPage) {
    memApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      updateLove();
      renderExtras();
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      memPage.hidden = false;
    });
  }
  const memBack = document.getElementById('mem-back');
  if (memBack) {
    memBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const phonePage = document.getElementById('page-phone');
      if (phonePage) phonePage.hidden = false;
    });
  }

  // 清除本地数据（重置所有自定义内容）
  const resetRow = document.getElementById('row-reset');
  if (resetRow) {
    resetRow.addEventListener('click', () => {
      if (window.openModal) {
        window.openModal('确认清除所有本地数据？（头像、昵称、背景、图标、纪念日、打卡、聊天记录、字卡、音乐、设置）', '', () => {
          // v3.5.131：清空屏障——reload 触发的 beforeunload 会调 flushSave 把内存里的
          // 聊天记录写回（等于没清）；置标志后各模块的落盘路径跳过
          try { window.__resetting = true; } catch (e) {}
          // v3.5.109：彻底清除——除 uid 前缀键外，一并删除历史遗留的「裸键」
          //   （divine-history 是 v3.5.92 前占卜历史存的无前缀键，不删的话刷新后
          //   divination.histLoad 会把它重新迁回，等于没清除）
          // #315c：age-confirmed 是全局键（不带联系人前缀，同 splash-seen 族），
          //   不在 activePrefix 过滤范围内——重置数据应连年龄确认一并清掉，
          //   让用户重新勾选（重置≠保留「已确认年满18」的举证记录）
          const BARE_KEYS = ['divine-history', 'xy-home-v2:age-confirmed'];
          // #551：清除范围从「仅当前桌面命名空间」升级为「全部 xy-home-v2 键」——
          //   旧范围漏掉根命名空间全局键（联系人列表、公用字卡 cc-groups-public、
          //   我的表情包 my-emoji-groups、存钱罐 piggy-*、桌面美化/布局等）与
          //   其他联系人的整个命名空间，清完重载后这些数据原地残留＝「没有把本地
          //   的所有数据清空」（红米 K70 Chrome 及多机型确定复现，纯范围逻辑、
          //   与机型无关）。弹窗承诺「清除所有本地数据」，行为必须对齐；
          //   age-confirmed 前缀本就命中，BARE_KEYS 保留作显式口径。
          const wipeAppKeys = function () {
            try {
              Object.keys(localStorage)
                .filter(k => k.indexOf('xy-home-v2:') === 0 || BARE_KEYS.indexOf(k) >= 0)
                .forEach(k => localStorage.removeItem(k));
            } catch (e) {}
          };
          wipeAppKeys();
          // 清会话级迁移标记（大键迁移标记，随会话残留无实际数据，一并清掉）
          try { sessionStorage.removeItem('xy-ls-big-migrated'); } catch (e) {}
          // 清空 IndexedDB（mochi-db）：只清 localStorage 不清 IDB 的话，
          // 刷新后 idbRestore 会把 IDB 里的旧数据全部回填，等于没清除（手机端必现）
          // 优先真删库（idbDestroy 连库删除，IDB 残留彻底消失，回填无源可依）；
          // 删库失败（被其它连接占用等）再退回 idbClearAll 清 store。决不用
          // Promise.resolve(true) 掩盖失败——否则只清了 LS、IDB 残留回填复活，
          // 表现为「专属字卡没了但其余内容全还原」（用户已在红米 K70 等实测）。
          const idbClear = function () {
            const destroy = (window.idbDestroy && window.idbDestroy()) || Promise.resolve(false);
            return destroy.then(ok => ok ? true : ((window.idbClearAll && window.idbClearAll()) || Promise.resolve(false)));
          };
          const idbDone = idbClear();
          // 顺带清理 Service Worker 离线缓存（只缓存页面静态资源，不含用户数据）
          if (window.caches && caches.keys) {
            try {
              caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).catch(() => {});
            } catch (e) {}
          }
          // 清完后刷新；__resetting 屏障已阻止 beforeunload 把内存回写，删库成功则
          // 重启后 IDB 为空、idbRestore 无可回填，彻底清除（含专属字卡等 LS-only 键）。
          // #551：reload 前再全量补一刀——清窗口期（真删库最长 6s）内，未挂
          // __resetting 屏障的模块定时器/落盘路径可能重写键，不清会活过本次重置。
          idbDone.then(() => { wipeAppKeys(); try { location.reload(); } catch (e) {} });
        }, { noInput: true });
      }
    });
  }

  // 每日打卡
  const checkin = document.querySelector('.checkin');
  if (checkin) {
    const btn = checkin.querySelector('.ck-btn');
    // FIX 2026-09-11 #289：刷新后要求重新打卡——按钮状态原来只在模块初始化时读一次
    // store.get('checkin')，而该读取发生在启动回填（idbRestore）完成之前；localStorage
    // 写失败/配额满/IDB 为主的机型此刻 checkin 键还没进内存缓存，按钮渲染成「打卡」，
    // 之后数据补齐也没有代码回头刷新（同类已知坑见 AGENTS.md「回填完成前读到的键可能
    // 为空」）。抽成 syncCheckinBtn：初始化调一次 + 回填完成（mochi-restore-done）/
    // 写日志合并自愈（mochi-wrj-heal）时再同步；点击逻辑不变，logFish 按自然日去重，
    // 重复点击不会虚增天数。
    function syncCheckinBtn() {
      if (store.get('checkin') === fishToday()) {
        btn.textContent = '✓ 已打卡';
        btn.classList.add('done');
      } else {
        btn.textContent = '打卡';
        btn.classList.remove('done');
      }
    }
    // v3.5.131：按日期判断——键存在但跨天时恢复可打卡（原逻辑首次打卡后永久锁定）
    syncCheckinBtn();
    try {
      document.addEventListener('mochi-restore-done', function () { try { syncCheckinBtn(); updateFishDays(); } catch (e) {} });
      document.addEventListener('mochi-wrj-heal', function () { try { syncCheckinBtn(); updateFishDays(); } catch (e) {} });
    } catch (e) {}
    // 打卡反馈弹窗（IAB 用页面内弹窗）
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
    checkin.addEventListener('click', () => {
      if (btn.classList.contains('done')) {
        toast('今天已经打过卡啦');
        return;
      }
      btn.textContent = '✓ 已打卡';
      btn.classList.add('done');
      store.set('checkin', fishToday()); // 存日期，便于识别是哪天打的卡
      logFish();
      const days = getFishLog().length;
      toast('打卡成功！已摸鱼 ' + days + ' 天');
    });
  }

  // 离周末还有几天（点击摸鱼 +1，当天数值）
  const weDays = document.getElementById('weekend-days');
  const weCount = document.getElementById('weekend-count');
  const weFish = document.getElementById('weekend-fish');
  if (weDays) {
    const day = new Date().getDay(); // 0=日 6=六
    let daysTo = (6 - day + 7) % 7;   // 距周六
    if (day === 6 || day === 0) {
      // 周六/周日都算周末（v3.5.x：周日曾误显示"离周末还有 6 天"）
      weDays.textContent = '今天是周末';
    } else {
      weDays.textContent = '离周末还有 ' + daysTo + ' 天';
    }
  }

  // ===== 摸鱼值（当天值 + 每日新增记录 + 历史累计）=====
  // 三套数据（v3.5.26 起）：
  //  - day-fish-<日期> / day-fish-ta-<日期>：当天摸鱼值（每天 0 点自动重置）
  //  - fish-day-add：每日新增记录 [{date,mine,ta}]（按日期独立累加，导入备份不会互相覆盖）
  //  - fish-total / fish-total-ta：历史累计（主页「每日摸鱼值」顶部展示）
  function fishDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function fishDayLog() {
    try { return JSON.parse(store.get('fish-day-add') || '[]'); } catch (e) { return []; }
  }
  function saveFishDayLog(list) { store.set('fish-day-add', JSON.stringify(list)); }
  function dayVal(k) { return parseInt(store.get(k) || '0', 10) || 0; }
  // 当天摸鱼值（读 day 键；新的一天自动从 0 开始）
  function todayMine() { return dayVal('day-fish-' + fishDayKey()); }
  function todayTa() { return dayVal('day-fish-ta-' + fishDayKey()); }
  // v3.26.x：摸鱼值/工作值累计总开关（回复设置 → 其他，reply-fish-en / reply-work-en，
  // 默认开）——闸门收在 addFish/addWork 入口，关掉后所有加分来源（60 秒自动累计、
  // 点击摸鱼按钮、番茄钟补偿、抓包奖励）一并停止写入；已有数值保留只停止增长
  function fishWorkOn(key) {
    try {
      const v = window.replyCfg ? window.replyCfg()[key] : undefined;
      return v === undefined ? true : v === 1;
    } catch (e) { return true; }
  }
  // 增加当天摸鱼值：写入 day 键（当天）+ fish-day-add（每日新增）+ fish-total*（历史累计）
  function addFish(addMine, addTa) {
    if (!fishWorkOn('fish-en')) return;
    const key = fishDayKey();
    if (addMine) {
      store.set('day-fish-' + key, String(todayMine() + addMine));
      store.set('fish-total', String((dayVal('fish-total') || 0) + addMine));
    }
    if (addTa) {
      store.set('day-fish-ta-' + key, String(todayTa() + addTa));
      store.set('fish-total-ta', String((dayVal('fish-total-ta') || 0) + addTa));
    }
    // 每日新增记录：当天独立累加（不覆盖历史）
    const list = fishDayLog();
    const ex = list.find(x => x.date === key);
    if (ex) { ex.mine += addMine || 0; ex.ta += addTa || 0; }
    else list.push({ date: key, mine: addMine || 0, ta: addTa || 0 });
    if (list.length > 365) list.splice(0, list.length - 365);
    saveFishDayLog(list);
  }
  // v3.13.x：跨模块加分口（番茄钟补偿摸鱼 / 抓包 TA 翻倍用）——加完同步桌面数值 UI
  window.addFishPts = function (addMine, addTa) {
    try { addFish(addMine || 0, addTa || 0); } catch (e) {}
    try { syncFishUI(); } catch (e) {}
  };
  // 一次性迁移 v3.5.25 及更早数据：
  //  旧 weekend-fish / weekend-fish-ta（历史累计）→ fish-total*（历史累计）
  //  旧 fish-day-log（按天累计值）→ 按天差值拆成每日新增 fish-day-add + 重建当天 day-fish-*
  (function () {
    if (store.get('fish-migrated')) return;
    try {
      const oldMine = parseInt(store.get('weekend-fish') || '0', 10) || 0;
      const oldTa = parseInt(store.get('weekend-fish-ta') || '0', 10) || 0;
      // 历史累计
      if (!store.get('fish-total') && oldMine) store.set('fish-total', String(oldMine));
      if (!store.get('fish-total-ta') && oldTa) store.set('fish-total-ta', String(oldTa));
      // 旧按天累计记录 → 每日新增（后一天减前一天）
      let oldLog = [];
      try { oldLog = JSON.parse(store.get('fish-day-log') || '[]'); } catch (e) {}
      if (Array.isArray(oldLog) && oldLog.length) {
        const days = [];
        let prevMine = 0, prevTa = 0;
        // v3.5.131：按日期数值排序（原字符串排序在跨月时错乱——'2026-10-1' < '2026-8-16'）
        // v3.6.x：iOS Safari 对不补零日期（'2026-8-16'）按 ISO 解析返回 NaN——先补零再解析，
        // 否则 iOS 上比较器恒为 0、排序失效（超过 365 天记录时 slice(-365) 会截错）
        const parseDay = (s) => {
          const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
          if (!m) return NaN;
          return Date.parse(m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) + 'T00:00:00');
        };
        const byDate = (a, b) => (parseDay(a.date) || 0) - (parseDay(b.date) || 0);
        oldLog.slice().sort(byDate).forEach(x => {
          const m = parseInt(x.mine || '0', 10) || 0;
          const t = parseInt(x.ta || '0', 10) || 0;
          days.push({ date: x.date, mine: Math.max(0, m - prevMine), ta: Math.max(0, t - prevTa) });
          prevMine = m; prevTa = t;
        });
        const list = fishDayLog(); // 新格式（迁移前为空）
        const map = {};
        list.forEach(x => { map[x.date] = x; });
        days.forEach(x => {
          if (map[x.date]) { map[x.date].mine += x.mine; map[x.date].ta += x.ta; }
          else map[x.date] = x;
        });
        const merged = Object.keys(map).map(k => map[k]).sort((a, b) => (parseDay(a.date) || 0) - (parseDay(b.date) || 0)).slice(-365);
        saveFishDayLog(merged);
        // 重建当天 day 键（今天的新增 = 记录里今天的新增）
        const key = fishDayKey();
        const today = merged.find(x => x.date === key);
        if (today) {
          store.set('day-fish-' + key, String(dayVal('day-fish-' + key) + (today.mine || 0)));
          store.set('day-fish-ta-' + key, String(dayVal('day-fish-ta-' + key) + (today.ta || 0)));
        }
      } else {
        // 无旧记录：旧累计直接作为当天值（沿用）
        const key = fishDayKey();
        if (oldMine) store.set('day-fish-' + key, String(oldMine));
        if (oldTa) store.set('day-fish-ta-' + key, String(oldTa));
      }
      store.set('fish-migrated', '1');
    } catch (e) {}
  })();

  // ===== 工作值（v3.5.65：与摸鱼值完全并行——当天值 + 每日新增记录 + 历史累计） =====
  //  - day-work-<日期> / day-work-ta-<日期>：当天工作值（每天 0 点自动重置）
  //  - work-day-add：每日新增记录 [{date,mine,ta}]
  //  - work-total / work-total-ta：历史累计（主页「每日打工值」顶部展示）
  function workDayLog() {
    try { return JSON.parse(store.get('work-day-add') || '[]'); } catch (e) { return []; }
  }
  function saveWorkDayLog(list) { store.set('work-day-add', JSON.stringify(list)); }
  function todayWorkMine() { return dayVal('day-work-' + fishDayKey()); }
  function todayWorkTa() { return dayVal('day-work-ta-' + fishDayKey()); }
  function addWork(addMine, addTa) {
    if (!fishWorkOn('work-en')) return;
    const key = fishDayKey();
    if (addMine) {
      store.set('day-work-' + key, String(todayWorkMine() + addMine));
      store.set('work-total', String((dayVal('work-total') || 0) + addMine));
    }
    if (addTa) {
      store.set('day-work-ta-' + key, String(todayWorkTa() + addTa));
      store.set('work-total-ta', String((dayVal('work-total-ta') || 0) + addTa));
    }
    const list = workDayLog();
    const ex = list.find(x => x.date === key);
    if (ex) { ex.mine += addMine || 0; ex.ta += addTa || 0; }
    else list.push({ date: key, mine: addMine || 0, ta: addTa || 0 });
    if (list.length > 365) list.splice(0, list.length - 365);
    saveWorkDayLog(list);
  }

  // 我的摸鱼值（当天，与按钮数值一致）
  const weMineEl = document.getElementById('weekend-mine');
  const weMineName = document.getElementById('weekend-mine-name');
  if (weMineName) {
    const myName = store.get('lbl-user') || '我';
    // v3.5.75：新结构 grid 两列（.pair > i）——按列标签更新昵称
    const lab = weMineName.querySelectorAll('.pair i');
    if (lab.length >= 2) { lab[0].textContent = myName + ' 摸鱼值'; lab[1].textContent = myName + ' 工作值'; }
  }
  if (weMineEl) {
    weMineEl.textContent = todayMine();
  }
  if (weFish) {
    // ===== v3.13.x：摸鱼连击 + TA 反向抓包 =====
    // 连击：2.5 秒内连续点击算一波；第 3 连起每次 +2（翻倍），断了从头算。
    //   当天/历史最高连击存 fish-combo-best（主页「每日摸鱼值」顶部展示）。
    // 反向抓包：90 秒内点满 8 次且过冷却（10 分钟）时 45% 概率被 TA 抓包——
    //   弹窗调侃 + 这次点击改记工作值（不进摸鱼）+ 当前连击清零。
    const COMBO_WIN = 2500;
    let comboLast = 0, comboRun = 0, runMax = 0, runTimer = null;
    let recent = []; // 最近点击时间戳（反向抓包判定）
    let weComboEl = null;
    function comboBest() {
      try {
        const o = JSON.parse(store.get('fish-combo-best') || 'null');
        const dk = fishDayKey();
        if (o && o.d === dk) return { today: o.t || 0, best: o.b || 0 };
        return { today: 0, best: (o && o.b) || 0 };
      } catch (e) { return { today: 0, best: 0 }; }
    }
    function comboBestSave(today, best) {
      store.set('fish-combo-best', JSON.stringify({ d: fishDayKey(), t: today, b: best }));
    }
    function comboShow(n) {
      if (!n) { if (weComboEl) weComboEl.classList.remove('on'); return; }
      if (!weComboEl) {
        weComboEl = document.createElement('span');
        weComboEl.className = 'we-combo';
        weFish.parentNode.appendChild(weComboEl);
      }
      weComboEl.textContent = '连击 ×' + n;
      weComboEl.classList.add('on');
    }
    function runEnd() {
      if (runMax >= 3) {
        const cb = comboBest();
        if (runMax > cb.best) {
          comboBestSave(Math.max(runMax, cb.today), runMax);
          toast('连击新纪录 ×' + runMax + '！');
          if (window.renderFishHistory) window.renderFishHistory();
        }
      }
      comboRun = 0; runMax = 0; comboShow(0);
    }
    window.getFishComboBest = function () { return comboBest(); };
    weFish.addEventListener('click', () => {
      const now = Date.now();
      // —— 反向抓包判定 ——
      recent = recent.filter(t => now - t < 90 * 1000);
      recent.push(now);
      let caughtCd = 0;
      try { caughtCd = parseInt(store.get('fish-caught-me:last') || '0', 10) || 0; } catch (e) {}
      if (recent.length >= 8 && now - caughtCd > 10 * 60 * 1000 && Math.random() < 0.45 && window.openModal) {
        store.set('fish-caught-me:last', String(now));
        recent = [];
        comboRun = 0; runMax = 0; comboShow(0);
        addWork(1, 0); // 被抓包：这次算打工，不进摸鱼
        syncFishUI();
        const taName = store.get('lbl-partner') || 'TA';
        const tease = [
          '点这么快，老板就在身后吧？这次给你记成工作值啦。',
          '被抓包了！摸鱼太频繁会被发现的——这条先算打工。',
          '『你刚才是不是在疯狂点？』——嗯，被看见了。这次记工作值。',
          '摸鱼要有节奏感。连续猛点会被抓的，这条算你打工。'
        ][Math.floor(Math.random() * 4)];
        // v3.15.x：被抓包事件写入主页「摸鱼抓包」记录（双向之一：TA 抓到我）
        if (window.addFishCatchRecord) {
          try { window.addFishCatchRecord('ta', tease); } catch (e) {}
        }
        window.openModal('被 ' + taName + ' 抓包了！', '', () => {}, {
          noInput: true,
          staticText: (window.taFit ? window.taFit(tease) : tease) + '\n\n本次点击已改为 工作值 +1'
        });
        return;
      }
      // —— 连击 ——
      comboRun = (now - comboLast <= COMBO_WIN) ? comboRun + 1 : 1;
      comboLast = now;
      runMax = Math.max(runMax, comboRun);
      const pts = comboRun >= 3 ? 2 : 1; // 第 3 连起翻倍
      addFish(pts, 0);
      comboShow(comboRun);
      clearTimeout(runTimer);
      runTimer = setTimeout(runEnd, COMBO_WIN + 100);
      if (weCount) weCount.textContent = todayMine();
      if (weMineEl) weMineEl.textContent = todayMine();
      if (window.logFish) window.logFish();
    });
  }
  // 联系人摸鱼值：使用网站时每 60 秒 60% 概率 +1~10（当天值 + 每日记录 + 历史累计）
  // 我的摸鱼值：同样每 60 秒 60% 概率 +1~10（自动增长，按钮点击仍可 +1）
  const weTaEl = document.getElementById('weekend-ta');
  const weTaName = document.getElementById('weekend-ta-name');
  if (weTaName) {
    const name = store.get('lbl-partner') || 'TA';
    // v3.5.75：新结构 grid 两列（.pair > i）——按列标签更新昵称，不覆盖 pair 结构
    const lab = weTaName.querySelectorAll('.pair i');
    if (lab.length >= 2) { lab[0].textContent = name + ' 摸鱼值'; lab[1].textContent = name + ' 工作值'; }
  }
  function syncFishUI() {
    const mine = todayMine();
    const ta = todayTa();
    if (weMineEl) weMineEl.textContent = mine;
    if (weTaEl) weTaEl.textContent = ta;
    if (weCount) weCount.textContent = mine;
    // v3.5.65：工作值同步显示（桌面小字 + 主页历史）
    const wMine = todayWorkMine();
    const wTa = todayWorkTa();
    const weWorkMine = document.getElementById('weekend-work');
    const weWorkTa = document.getElementById('weekend-work-ta');
    if (weWorkMine) weWorkMine.textContent = wMine;
    if (weWorkTa) weWorkTa.textContent = wTa;
    // v3.5.74：昵称标签同步（摸鱼值 + 工作值标签一起更新昵称）
    const myName = store.get('lbl-user') || '我';
    const taName = store.get('lbl-partner') || 'TA';
    if (weMineName) {
      const lm = weMineName.querySelectorAll('.pair i');
      if (lm.length >= 2) { lm[0].textContent = myName + ' 摸鱼值'; lm[1].textContent = myName + ' 工作值'; }
    }
    if (weTaName) {
      const lt = weTaName.querySelectorAll('.pair i');
      if (lt.length >= 2) { lt[0].textContent = taName + ' 摸鱼值'; lt[1].textContent = taName + ' 工作值'; }
    }
    if (window.renderFishHistory) window.renderFishHistory();
    if (window.renderWorkHistory) window.renderWorkHistory();
  }
  if (weTaEl) {
    syncFishUI();
    setInterval(() => {
      try {
        if (document.hidden) return; // v3.5.127：后台不累计摸鱼/打工值
        // v3.13.x：番茄钟专注进行中——摸鱼值双方冻结（TA 在旁边安静陪），
        //   完成专注后由番茄钟结算「补偿摸鱼」；工作值照常累计（专注=在打工）
        if (window.pomoFocusActive && window.pomoFocusActive()) {
          let awm = 0, awt = 0;
          if (Math.random() * 100 < 60) awm = 1 + Math.floor(Math.random() * 10);
          if (Math.random() * 100 < 60) awt = 1 + Math.floor(Math.random() * 10);
          if (awm || awt) { addWork(awm, awt); syncFishUI(); }
          return;
        }
        let addMine = 0, addTa = 0, addWM = 0, addWT = 0;
        // 摸鱼值：双方各 60% 概率 +1~10
        if (Math.random() * 100 < 60) addTa = 1 + Math.floor(Math.random() * 10);
        if (Math.random() * 100 < 60) addMine = 1 + Math.floor(Math.random() * 10);
        // 工作值：同样各 60% 概率 +1~10（与摸鱼值刷新机制一致）
        if (Math.random() * 100 < 60) addWT = 1 + Math.floor(Math.random() * 10);
        if (Math.random() * 100 < 60) addWM = 1 + Math.floor(Math.random() * 10);
        if (addMine || addTa) addFish(addMine, addTa);
        if (addWM || addWT) addWork(addWM, addWT);
        syncFishUI();
      } catch (e) {}
    }, 60000);
  }
  // 每日摸鱼值历史（供主页展示；fish-day-add 按日期独立，最新在前）
  window.getFishHistory = function () { return fishDayLog().slice().reverse(); };
  // 历史累计（供主页顶部展示）
  window.getFishTotals = function () {
    return { mine: dayVal('fish-total'), ta: dayVal('fish-total-ta') };
  };
  // v3.5.65：每日工作值历史 + 累计（供主页「每日打工值」）
  window.getWorkHistory = function () { return workDayLog().slice().reverse(); };
  window.getWorkTotals = function () {
    return { mine: dayVal('work-total'), ta: dayVal('work-total-ta') };
  };

  // 可二传二改的说明：点设置行 → 全屏说明页
  const licRow = document.getElementById('row-license');
  if (licRow) {
    licRow.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const licPage = document.getElementById('page-license');
      if (licPage) licPage.hidden = false;
    });
  }
  const licBack = document.getElementById('lic-back');
  if (licBack) {
    licBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const setPage = document.getElementById('page-setting');
      if (setPage) setPage.hidden = false;
    });
  }

  // 原版功能介绍：点设置行 → 全屏介绍页
  const aboutRow = document.getElementById('row-about');
  if (aboutRow) {
    aboutRow.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const aboutPage = document.getElementById('page-about');
      if (aboutPage) aboutPage.hidden = false;
    });
  }
  const aboutBack = document.getElementById('about-back');
  if (aboutBack) {
    aboutBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const setPage = document.getElementById('page-setting');
      if (setPage) setPage.hidden = false;
    });
  }

  // #606（2026-09-16）「关于」分类信息行：版本与更新 / 开源与致谢 / 隐私与数据安全 / 联系与反馈。
  // 均为只读说明，统一走 openModal 弹窗（noInput + staticText）；「检查更新」复用开屏同一条
  // 刷新链 window.mochiRefreshNow（pwa.js 暴露），不新增网络轮询。
  // #620 维护提示：「开源与致谢」与「功能介绍与许可」现在都直接打开 #page-about（单一出处，不再各写一份）；
  //    「联系作者」的账号与设置页底部 .set-alert 防骗声明同源，账号变更时请一并同步。
  (function initAboutInfo() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    const open = (title, text, opts, cb) => {
      if (!window.openModal) return;
      window.openModal(title, '', cb || function () {}, Object.assign({ noInput: true, staticText: text }, opts || {}));
    };
    // 版本号从行内 .val 读（构建时 __APP_VERSION__ 已替换），不依赖从未赋值的 window.APP_VERSION
    bind('row-changelog', () => {
      const el = document.getElementById('about-ver-val');
      const ver = (el && el.textContent.trim()) || '（未知）';
      open('版本与更新',
        '当前版本：' + ver + '\n\n有新版本时，开屏「Mochi 字卡传讯」下方会出现「⇩ 有新版本 · 点此更新」，点一下即可更新到最新。\n\n更新只替换程序文件，本机的聊天记录、字卡、头像、壁纸、音乐等数据全部保留，不会被清除。\n\n作者已决定月底停更：之后不再维护更新、互助群月底解散（详见开屏公告）。\n\n本次更新了哪些内容：以开屏公告为准（公告可在线更新，每次上线会写在里面）。',
        { okText: '知道了', pills: [{ label: '检查更新（刷新到最新）', value: 'ok' }], pillSubmit: true },
        (v) => { if (v === 'ok' && typeof window.mochiRefreshNow === 'function') window.mochiRefreshNow(); });
    });
    // #620：开源与致谢不再另写一份（与 #page-about 的「许可 / 关于星言字卡与灵感来源」重复），
    // 改为直接打开功能介绍页，单一出处。
    bind('row-opensource', () => {
      document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
      const aboutPage = document.getElementById('page-about');
      if (aboutPage) aboutPage.hidden = false;
    });
    bind('row-privacy', () => {
      open('隐私与数据安全',
        '本站是纯本地应用：无后端、无账号、无需联网，你的聊天记录、字卡、头像、壁纸、音乐等全部数据只保存在本机浏览器存储里（localStorage + IndexedDB），作者看不到、也不会收集或上传。\n\n请留意：卸载应用或清除浏览器数据会一并删除本机数据且无法找回——唯一可靠的防线是定期「导出数据」完整备份。\n\niOS Safari 等可能被系统自动清空存储，建议常导出完整备份。\n\n「应用锁」「开屏问答门」用于防旁人日常偷看；数据存于本机，懂技术的人仍可读取本机数据。');
    });
    bind('row-contact', () => {
      open('联系作者 / 反馈',
        '作者只有两个账号：小红书 @言序（1842523578）、抖音 @言序（58334080131）。\n\n作者不玩抖音、不回消息，账号仅用于发布本站链接。本站完全免费，任何收费均为诈骗。\n\n作者已决定月底停更：互助群月底解散，之后不再答疑、不再帮看 bug；网站仍开源免费，代码可自行下载修改。\n\n遇到问题建议先看「使用说明」，并用 信息诊断 →「设备兼容诊断」一键复制本机环境信息再反馈。');
    });
    // #611：以下 5 条原在开屏（「其他说明与常见问题」/「四、关于全屏模式失效」/「八、关于系统预设字卡和功能设置」），
    // 按用户要求从开屏删除、移入设置 → 关于 → 常见问题（只读弹窗）。
    bind('row-faq-app', () => {
      open('关于“会不会做成 App”',
        '暂不考虑。原因是网站功能非常多——如果功能少还好说，功能太多的情况下，做成 App 可能出现的 Bug 只会更多，而且和设备、浏览器一样存在适配问题：不同手机的屏幕、系统、性能都不一样，要做到所有手机都适配，Bug 可能需要全部重写一遍。我没有这种精力和金钱。');
    });
    bind('row-faq-app2', () => {
      open('关于“自己转 App 使用”',
        '类似“一个木函”那种链接转应用的方式，没有我的原代码，本质是浏览器套壳，不是真正的 App，反而可能出现非常多的适配问题。所以不如直接浏览器使用，体验更稳定。\n\n替代方案：「浏览器 → 安装快捷方式到手机桌面」是可以正常使用的（PWA 方式，还能开全屏，效果最接近真正的 App）。');
    });
    bind('row-faq-addcard', () => {
      open('怎么添加字卡',
        '本站的系统预设字卡都是补充类和小功能衍生字卡，关于个人使用得根据个人情况添加 mj 聊天字卡。\n\n聊天、写信、朋友圈 添加 自定义字卡里的【公用字卡】和【专享字卡】即可。');
    });
    bind('row-faq-fullscreen', () => {
      open('全屏模式失效',
        '如果你是把浏览器切到后台，再切回来，全屏会失效——这是浏览器限制，只能手动重新开全屏。\n\n或者可以使用“浏览器安装快捷方式到手机桌面”的方式使用，这样可以全屏。\n\n但注意：手机自身顶部栏是手机系统限制，需要自己手动开全屏模式隐藏，且切到后台后同样会失效。');
    });
    bind('row-faq-preset', () => {
      open('系统预设字卡与功能设置',
        '建议打开使用。（我自己用是默认全开）\n\n初衷就是为了不限制梦角表达，如果关掉，反而限制了它，和基础传讯网站没什么差别——正是因为以前接触的字卡传讯类型太简单才做的。\n\n建议先全部打开使用，再根据个人适应情况调整。');
    });
    // #961（2026-09-21 用户直派）：常见问题新增三条——没有账号不同步 / 浏览器与桌面图标两套存储 / 收不到消息与通知
    bind('row-faq-noacct', () => {
      open('关于「没有账号、不会自动同步」',
        '本站没有账号系统（不用注册、不用登录），也没有云端——你的数据只存在【这台手机 + 这个浏览器】的本地存储里。两个直接后果：\n① 两台手机（或两个浏览器）之间不会自动同步，A 上的聊天记录不会出现在 B 上；\n② 换机 / 换浏览器时数据不会自己跟过去，必须靠「导出数据」→ 在新设备「导入数据」搬运一次。\n\n想换设备：先在旧设备 设置 → 通用 →「导出数据」导出完整备份，再在新设备 设置 → 通用 →「导入数据」导入。\n\n同一台手机上，浏览器直接打开 和「添加到桌面」后的图标也各自独立（见「浏览器和桌面图标是两份数据」）。');
    });
    bind('row-faq-twostore', () => {
      open('浏览器和桌面图标是两份数据',
        '「浏览器直接打开本站」和「添加到主屏幕 / 桌面后从图标打开」是两份彼此独立的存储：在一个入口存的数据，另一个入口看不到——这不是数据丢了。\n\n常见表现：装到桌面后打开发现是空的 / 两个入口聊天记录对不上。\n\n原因：iPhone 的主屏幕应用与 Safari、部分安卓浏览器（如 Edge）与它的桌面应用，各用各自的存储空间，互不相通。\n\n怎么处理：\n① 固定用一个入口，不要换来换去；\n② 想换入口：先在旧入口 设置 → 通用 →「导出数据」导出，再到新入口 设置 → 通用 →「导入数据」导入；\n③ iPhone 推荐「添加到主屏幕」后用桌面图标（不受 Safari 7 天清空规则限制，见关于段顶部提示）。');
    });
    bind('row-faq-notify', () => {
      open('锁屏 / 后台收不到消息、通知不弹？',
        '本站是网页、不是原生 App，消息与通知受浏览器 / 系统限制，不是网站坏了。按下面查：\n\n① 页面完全关掉后，普通网页无法自己醒来——需要到 设置 → 系统 打开「后台保活」并开启「离线消息提醒」；仅部分安卓浏览器（Chromium 系，如 Chrome / Edge）支持「离线消息提醒」，且要允许「通知」权限。\n② iPhone：Safari / 网页拿不到系统通知，关掉页面后不会再弹——可改用应用内的「桌面消息弹窗」横幅（需页面开着）。\n③ 省电 / 电池优化 / 后台限制会冻结网页导致不弹：把浏览器加入电池优化白名单、允许后台运行。\n④ 通知权限被拒：到系统设置里给浏览器打开「通知」权限。\n\n结论：想尽量稳定收到——安卓用 Chrome / Edge 并打开「后台保活」＋「后台弹窗」；iPhone 别指望关掉页面还能收通知（系统限制）。完整排查步骤见 设置 → 系统 →「后台弹窗」行的「功能说明」，或点该行右侧「测试」一键体检。');
    });
    // #792（2026-09-18 用户直派）：数据与存储必读五条——小白用户对「数据为什么会没」的重复疑问，
    // 详版文案在此（行点击弹窗），短版功能说明在 settings-help.js，行与警示条在 template.html，三处同步。
    bind('row-faq-st-lose', () => {
      open('数据为什么会自己没（先看这条）',
        '先把最重要的话说在前面：本站没有服务器、没有云端账号，你的全部数据（聊天记录、字卡、头像、壁纸、音乐、设置）只保存在【这台手机 + 这个浏览器】的本地存储里。所以浏览器或系统清理数据时，本站会跟着一起被清——这是所有网页共同的设备限制，不是本站坏了，也不是有人删了你的数据。\n\n常见的会清掉数据的操作（都属正常机制）：\n① 手动「清除浏览器数据 / 清理缓存」：勾选了「网站数据 / Cookie」就会把本站一起删掉；\n② 手机管家 / 安全中心的「一键清理」「清理加速」「释放空间」：很多手机会把浏览器存的网站数据当垃圾扫掉；\n③ 浏览器自己的自动清理：设了「退出时清除浏览数据」或「定期自动移除网站数据」（iPhone Safari 有类似选项）；存储空间紧张时，浏览器也会优先清掉不常用网站的数据；\n④ iPhone 的 Safari：网站数据可能被系统回收清空；长时间（约 7 天以上）完全不打开，系统也有权自动清——所以 iPhone 要定期打开用一用 + 定期备份；\n⑤ 卸载 / 重装浏览器、手机恢复出厂或系统大更新、换机换浏览器——本地数据跟着没。\n\n没做上面任何操作却突然丢、还高频反复丢，才需要怀疑是 bug（见「丢数据了，怎么判断是不是 bug」）。防丢的唯一办法＝定期导出备份（见「怎么备份与恢复」）。');
    });
    bind('row-faq-st-perm', () => {
      open('浏览器的存储权限与设置怎么开',
        '浏览器要被允许「保存网站数据」，本站才能存东西；同时要关掉一切「自动清除」类开关。逐项检查（不同浏览器版本名称略有差异）：\n\n【iPhone · Safari】手机设置 → Safari →「网站数据」保持允许；若看到「30 天后自动移除网站数据」类开关请关闭；不要用无痕浏览常驻。\n\n【安卓 · Chrome / Edge】浏览器 设置 → 网站设置 → 存储 / 网站数据：保持允许，不要选「退出时清除」类选项。\n\n【安卓 · 国产自带浏览器（小米 / 华为 / OPPO / vivo / 夸克等）】本就不建议用（兼容问题多，见开屏「浏览器兼容提醒」）；一定要用的话，进浏览器设置找到「清除浏览数据 / 自动清理」相关项，关掉「退出时 / 定期自动清除」。\n\n【手机清理类 App（清理管家 / 安全中心等）】把浏览器加入清理白名单，或关掉对浏览器的自动清理——否则每次「一键清理」都可能把数据当垃圾扫掉。\n\n一句话总结：允许网站保存数据 + 关掉所有「自动清除 / 定期清除」开关。\n\n自查方法：本站能记住你的设置、刷新后聊天记录还在，就说明存储权限是通的。');
    });
    bind('row-faq-st-incog', () => {
      open('为什么不能用无痕模式',
        '无痕模式（有的浏览器叫「隐私模式」「隐身模式」「InPrivate」）的设计就是【关掉就全部清空】：关掉无痕窗口的那一刻，你在里面产生的所有网站数据——聊天记录、字卡、设置——被浏览器全部删除，一样不留，也无法找回。\n\n所以：\n① 绝对不要用无痕 / 隐私模式打开本站；\n② 每次进入本站时看一眼浏览器顶部——无痕模式的窗口是深色的，Chrome / Safari 都有明显的「无痕 / 隐私」标识；\n③ 在无痕模式里用过的数据关掉就没，这是浏览器的正常设计，不是 bug，也找不回。\n\n正确做法：用正常（普通）模式打开本站 + 定期导出备份。');
    });
    bind('row-faq-st-backup', () => {
      open('怎么备份与恢复（唯一防线）',
        '备份＝把全部数据导出成一个文件，存到浏览器清不到的地方。这是防丢的唯一可靠防线，其它都没用（本机不保留任何自动备份副本）。\n\n【怎么做】设置 → 通用 →「导出数据」→ 选「完整备份」→ 把文件保存好。\n\n【存到哪】不要只留在浏览器的下载记录里——发送到微信收藏 / 文件夹 / 云盘 / 电脑，至少一份存在浏览器外面；文件不要改名弄丢后缀。\n\n【多久一次】建议每周一次；大量聊天 / 加了很多字卡之后；以及每次看到「有新版本」要刷新之前，都先导一次。\n\n【怎么恢复】换机或数据丢失后：装好本站 → 设置 → 通用 →「导入数据」→ 选备份文件 → 按完整备份覆盖恢复，等恢复完成提示后再操作。\n\n【换设备 / 换浏览器】数据不会自动跟过去（本站无云端不同步），全靠备份文件搬家：新设备导入一次即可。\n\n【两个入口不互通】浏览器直接打开 和 桌面快捷方式，是两份独立存储——固定用一个入口；非要换，先在旧入口导出、再到新入口导入。');
    });
    bind('row-faq-st-bug', () => {
      open('丢数据了，怎么判断是不是 bug',
        '先自查再报修——数据丢失最常见的原因不是 bug，是设备限制（详见「数据为什么会自己没」）。按顺序自查：\n\n① 想一想最近有没有：清过浏览器数据 / 缓存、用过手机管家一键清理、开过无痕模式、卸载重装过浏览器、恢复出厂 / 系统大更新、换过手机或浏览器、把手机给别人动过；\n② 打开其它常用网站，看登录状态还在不在：其它网站也被退出 / 被清了＝浏览器数据被清过，不是本站 bug；\n③ 看丢的范围：全部没了多半是浏览器层被清；只有个别消息或个别功能不对，才更像程序问题；\n④ 换过入口吗：浏览器打开和桌面快捷方式数据不互通，另一个入口里可能还在。\n\n都排除了、且是高频反复丢，才按疑似 bug 处理。报修格式：【手机型号 + 浏览器 + 具体现象】，外加 设置 → 信息诊断 →「设备兼容诊断」复制的信息，并说明丢了什么、什么时候发现、之前做过上面哪些操作。');
    });
  })();

  // ===== v3.26.x：查看存储——看全站功能占用空间 + 手动清理错误诊断记录 =====
  // 用户反馈「存储已用 1.x GB」：这里把 localStorage + IndexedDB 按功能归类展示占用，
  // 并提供「清理错误诊断记录」一键清掉诊断缓存（__diag-*）。只读统计 + 定向清理，
  // 不提供清业务数据（避免误删聊天记录等关键内容）。统计为异步（IDB 逐键读体积），
  // 打开页面时先渲染 localStorage，IndexedDB 边读边补齐。
  (function () {
    const page = document.getElementById('page-storage');
    if (!page) return;
    const row = document.getElementById('row-storage-view');
    const back = document.getElementById('storage-back');
    const G = 'xy-home-v2:';
    // v3.26.x 存储优化：媒体池分类名（catOf 与 IndexedDB 统计回调共用，勿改字面量）
    const CAT_MEDIA = '媒体池（图片去重）';
    const DIAG_KEYS = [
      'xy-home-v2:__diag-errs',
      'xy-home-v2:__diag-errs-seen',
      'xy-home-v2:__diag-env',
      'xy-home-v2:__diag-lt',
      'xy-home-v2:__diag-net',
      'xy-home-v2:__diag-tap',
      // #690：桌面翻页帧耗时采样（desktop-slider.js 写、诊断【性能】读）——同为诊断
      // 缓存，一并进「清理错误诊断记录」，不然每次翻页的样本会一直留在键里。
      'xy-home-v2:__diag-deskperf'
    ];

    function fmtBytes(n) {
      if (n == null || isNaN(n)) return '(未知)';
      if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
      return n + ' B';
    }
    // v3.29.x：键名可读化——`xy-home-v2:<cid>:xxx` 的机器键名用户读不懂，
    // 首段能对上联系人 id 的就换成「桌面名 · 剩余键名」，对不上（全局键如
    // incoming-last:xxx / music-file:xxx）原样显示，不猜。
    function deskNames() {
      const map = {};
      try {
        (window.getContacts ? window.getContacts() : []).forEach(function (c) {
          if (c && c.id) map[c.id] = c.name || c.id;
        });
      } catch (e) {}
      return map;
    }
    function labelKey(k, names) {
      const tail = String(k).slice(G.length);
      const i = tail.indexOf(':');
      if (i > 0) {
        const cid = tail.slice(0, i);
        if (names[cid]) return names[cid] + ' · ' + (tail.slice(i + 1) || cid);
      }
      return tail || String(k);
    }
    // 键名（去掉 xy-home-v2: 前缀，可能带 cid 命名空间）→ 功能分类
    function catOf(tail) {
      if (!tail) return '其他';
      // —— 全局系统 / 诊断 / 索引前缀（无 cid 命名空间）——
      if (tail.indexOf('__diag-') === 0) return '错误诊断记录';
      if (tail.indexOf('music-file:') >= 0) return '本地音乐';
      // v3.26.x 存储优化：媒体池（#142 聊天图片/表情去重仓库，全局根键 media:<hash>）单独成类
      if (/^media:[0-9a-f]{32}$/.test(tail)) return CAT_MEDIA;
      // v3.29.x：「自动备份快照」分类已随副本机制下线（遗留副本由 data-backup.js 启动时清理）
      // v3.26.x：__last-backup 只是"最近导出时间"小键，归到系统设置
      if (tail.indexOf('__last-backup') >= 0 || tail.indexOf('__last-backup-remind') >= 0) return '系统设置';
      if (tail.indexOf('psync-') >= 0) return '后台同步缓存';
      if (tail.indexOf('__big-idx') >= 0 || tail.indexOf('__ls-dirty') >= 0) return '数据索引';
      if (/^(__layout-pref|ver-update-ack-ts|__edge-backup-hint-done|__quota_probe__)$/.test(tail)) return '系统设置';
      if (/^(contacts|active-contact|migrated-v1)$/.test(tail)) return '联系人/桌面';
      // 根键里的「功能:子键」多段名（无 cid 前缀），先于 cid 剥离判断
      if (/^incoming-last:/.test(tail)) return '查岗/TA互动';
      // 剥离第一段 cid 命名空间（如 default:xxx、<cid>:xxx）
      const m = /^(?:[^:]+:)?(.*)$/.exec(tail);
      const base = m ? m[1] : tail;
      // —— 聊天 / 群聊 ——
      if (base === 'chat-msgs') return '聊天记录';
      if (base === 'group-chat-msgs') return '群聊记录';
      // —— 备忘录（必须在日历 memo- 规则之前）——
      if (/^memo-app-/.test(base)) return '备忘录';
      // —— 聊天设置全局键 ——
      if (base === 'reply-settings' || base === 'chat-settings') return '聊天设置';
      // —— 查岗 / TA 互动 ——
      if (/^(ta-checkin|checkin-|ckq-|incoming-|desk-checkin-en|desk-call-en|desk-freq-mode|ta-ask|ta-invite|ti-last-id|ta-cc-state|interact-card-last|invite-ask-history|reply-gc-)/.test(base)) return '查岗/TA互动';
      // —— 定位 / 轨迹 ——
      if (/^(loc-|loc-lib-|loc-sense)/.test(base)) return '定位/轨迹';
      // —— 日历 / 每日留言 / 心情 ——
      if (/^(cal-|first-use-date|quote-history|memo-|today-mood-|mood-history|memo-history|day-fish-|day-work-)/.test(base)) return '日历/每日留言';
      // —— 字卡 / 回复 / 收藏 / 拍一拍 / 表情 ——
      if (/^(cc-groups|cc-groups-public|default-cards|quote-cards|reply-|fav-|ta-mood|poke-|emoji-|my-emoji-groups|rps-score|mh-|rc-enabled|mc-enabled|chat-count)/.test(base)) return '字卡/回复/收藏';
      // —— 各业务功能 ——
      if (/^divine-/.test(base)) return '占卜';
      if (/^mail-/.test(base)) return '信箱';
      if (/^feed-/.test(base)) return '朋友圈';
      if (/^(records-|anniversary|myarc|myarc-cur)/.test(base)) return '纪念/统计/档案';
      if (/^(decision-|gdec-)/.test(base)) return '帮我决定';
      if (/^accounting-/.test(base)) return '记账';
      if (/^period-/.test(base)) return '经期';
      if (/^(garden-|plant-)/.test(base)) return '花园';
      if (base === 'room-data') return '房间';
      if (/^drift-/.test(base)) return '漂流瓶';
      if (/^(gift-|giftbox|rp-|market-|wallet)/.test(base)) return '礼物/红包';
      if (/^cjian-/.test(base)) return '梦角档案';
      if (/^fishing-/.test(base)) return '钓鱼';
      if (/^(brick-|c4-|ms-|ml2_coin|pong-|snake-|memory-|breakout-)/.test(base)) return '小游戏';
      if (/^music-/.test(base)) return '音乐';
      // —— 形象 / 设置 / 外观 / 通话 ——
      if (/^(avatar-|cs-avatar-|lbl-)/.test(base)) return '头像/昵称';
      if (/^(cs-|sysmsg-|more-|desk-msg-en|chat-unread|hide-ta-sticker)/.test(base)) return '聊天设置';
      if (/^(phone-bg|page-bg|card-bg|desk-bg|desk-image-src-|chat-bg|wallpaper|widget-|bg-blur|bg-mask-op|beauty-|chat-beauty-schemes|theme-mode|accent-color|desk-images|desk-texts|desk-countdowns)/.test(base)) return '桌面美化/壁纸';
      if (/^(call-|sfx-)/.test(base)) return '通话/音效';
      if (/^(fullscreen-|fs-edge-guard)/.test(base)) return '全屏';
      if (/^(bg-keepalive|bg-notify)/.test(base)) return '后台保持/通知';
      return '设置与其他';
    }
    function lsStats() {
      const cats = {};
      let total = 0, count = 0, otherSize = 0, otherCount = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          // 同 origin 下非本项目前缀的键（GitHub Pages 同账号各项目共用一个 origin，
          // #88 实测过配额被别的站点占满）单独计数，不混进本项目的明细里
          const mine = k.indexOf(G) === 0;
          const sz = (k.length + String(localStorage.getItem(k) || '').length) * 2;
          if (!mine) { otherSize += sz; otherCount++; continue; }
          total += sz; count++;
          const c = catOf(k.slice(G.length));
          if (!cats[c]) cats[c] = { n: 0, size: 0, keys: [] };
          cats[c].n++; cats[c].size += sz;
          if (cats[c].keys.length < 20) cats[c].keys.push(k);
        }
      } catch (e) {}
      return { cats: cats, total: total, count: count, otherSize: otherSize, otherCount: otherCount };
    }
    // IndexedDB：列出键后分批读取体积（用 idbGetMany 批量事务，比逐键快得多；
    // Blob/ArrayBuffer 只取 size 不读数据，字符串读完即弃，峰值内存=最大单键）
    function idbStats(onProgress, cb) {
      // v3.29.x：清单读取改走 #90 的严格三态 idbListKeys（null＝这次读不到）。
      // 旧实现用 idbGetAllKeys，失败时退化成 [] → 页面显示「0 B（0 键）」，
      // 把「读不到」显示成「库里没有」，正是要避免的口径。
      const listFn = window.idbListKeys || window.idbGetAllKeys;
      if (!listFn) { cb(null); return; }
      Promise.resolve(listFn()).then(function (keys) {
        if (keys === null || keys === undefined) { cb(null); return; }
        const cats = {};
        const list = (keys || []).filter(function (k) { return String(k || '').indexOf(G) === 0; });
        list.forEach(function (k) {
          const c = catOf(String(k).slice(G.length));
          if (!cats[c]) cats[c] = { n: 0, size: 0, keys: [] };
          cats[c].n++;
          if (cats[c].keys.length < 20) cats[c].keys.push(String(k));
        });
        const measure = function (v) {
          let sz = 0;
          try {
            if (v instanceof Blob) sz = v.size;
            else if (v instanceof ArrayBuffer) sz = v.byteLength;
            else if (typeof v === 'string') sz = v.length * 2;
            else if (v !== undefined && v !== null) sz = JSON.stringify(v).length * 2;
          } catch (e) { sz = 0; }
          return sz;
        };
        if (!window.idbGetMany) { cb({ cats: cats, count: list.length, total: 0 }); return; }
        const BATCH = 80;
        let pos = 0, total = 0, done = 0;
        function nextBatch() {
          if (pos >= list.length) { cb({ cats: cats, count: list.length, total: total }); return; }
          const batch = list.slice(pos, pos + BATCH);
          pos += batch.length;
          window.idbGetMany(batch).then(function (map) {
            batch.forEach(function (k) {
              const sz = measure(map[k]);
              const c = catOf(String(k).slice(G.length));
              if (cats[c]) cats[c].size += sz;
              total += sz;
            });
            done += batch.length;
            try { if (onProgress) onProgress(done, list.length); } catch (e) {}
            setTimeout(nextBatch, 0);
          }).catch(function () { done += batch.length; setTimeout(nextBatch, 0); });
        }
        setTimeout(nextBatch, 0);
      }).catch(function () { cb(null); });
    }
    function pctOf(size, total) {
      if (!total) return '0%';
      const p = size / total * 100;
      if (p >= 10) return Math.round(p) + '%';
      if (p >= 0.1) return p.toFixed(1) + '%';
      return '<0.1%';
    }
    // v3.29.x：明细可读性三改——①只列占用最大的 5 类 + 占比条，其余折成「其他 N 项合计」
    // （点开展开仍逐类列名列大小，核对覆盖没有变难）；②展开区键名换成「桌面名 · 键名」，
    // 键数被截断时如实标注「共 N 个键，仅列前 M 个」；③IDB 清单读取失败时明确说
    // 「下面只统计了 localStorage」，不再静默少算一整块。
    function renderCatTable(lsCats, idbCats, idbFailed) {
      const el = document.getElementById('st-cat');
      if (!el) return;
      const all = {};
      const add = function (map) {
        if (!map) return;
        Object.keys(map).forEach(function (c) {
          if (!all[c]) all[c] = { n: 0, size: 0, keys: [] };
          all[c].n += map[c].n; all[c].size += map[c].size;
          (map[c].keys || []).forEach(function (kk) { if (all[c].keys.length < 20) all[c].keys.push(kk); });
        });
      };
      add(lsCats); add(idbCats);
      const rows = Object.keys(all).map(function (c) {
        return { name: c, n: all[c].n, size: all[c].size, keys: all[c].keys };
      }).sort(function (a, b) { return b.size - a.size; });
      el.innerHTML = '';
      if (idbFailed) {
        const w = document.createElement('div');
        w.className = 'storage-cat-warn';
        w.textContent = '⚠ IndexedDB 键清单这次没读到（是读不到，不是库里没有），下面只统计了 localStorage，重进本页面可再试一次。';
        el.appendChild(w);
      }
      if (!rows.length) {
        const h = document.createElement('div');
        h.className = 'storage-hint';
        h.textContent = '暂未统计到数据。';
        el.appendChild(h);
        return;
      }
      const names = deskNames();
      const total = rows.reduce(function (s, r) { return s + r.size; }, 0);
      const max = rows[0].size || 1;
      const mkRow = function (name, n, size, subText, noBar) {
        const d = document.createElement('div');
        d.className = 'storage-cat-row' + (subText ? ' has-keys' : '');
        d.innerHTML = '<div class="storage-cat-line"><span class="storage-cat-name"></span><span class="storage-cat-num"></span><span class="storage-cat-size"></span></div>' +
          (noBar ? '' : '<div class="storage-cat-bar"><i></i></div>');
        d.querySelector('.storage-cat-name').textContent = name;
        d.querySelector('.storage-cat-num').textContent = n + ' 键 · ' + pctOf(size, total);
        d.querySelector('.storage-cat-size').textContent = fmtBytes(size);
        // 条长按平方根比例：真实数据常是一个大头占九成（实测某项 94%），线性条会把
        // 第 3~6 名全压到 1.5% 的下限上、彼此分不出来。平方根单调不减、最大项仍满格，
        // 小项也能排座次；精确份额看行末的百分比数字。
        if (!noBar) d.querySelector('.storage-cat-bar i').style.width = Math.max(1.5, Math.round(Math.sqrt(size / max) * 100)) + '%';
        if (subText) {
          const sub = document.createElement('div');
          sub.className = 'storage-cat-keys';
          sub.textContent = subText;
          d.appendChild(sub);
        }
        return d;
      };
      const top = rows.slice(0, 5);
      const rest = rows.slice(5);
      top.forEach(function (r) {
        const listed = (r.keys || []).length;
        let subText = listed ? r.keys.map(function (k) { return labelKey(k, names); }).join('、') : '';
        if (r.n > listed) subText += (subText ? '｜' : '') + '共 ' + r.n + ' 个键，仅列前 ' + listed + ' 个';
        el.appendChild(mkRow(r.name, r.n, r.size, subText));
      });
      if (rest.length) {
        const rn = rest.reduce(function (s, r) { return s + r.n; }, 0);
        const rs = rest.reduce(function (s, r) { return s + r.size; }, 0);
        el.appendChild(mkRow('其他 ' + rest.length + ' 项合计', rn, rs,
          rest.map(function (r) { return r.name + ' ' + fmtBytes(r.size); }).join('、'), true));
      }
    }
    function diagSummary() {
      let items = 0, bytes = 0, errs = 0;
      try {
        DIAG_KEYS.forEach(function (k) {
          const v = localStorage.getItem(k);
          if (v) { items++; bytes += (k.length + v.length) * 2; }
        });
        const o = JSON.parse(localStorage.getItem(DIAG_KEYS[0]) || '[]');
        if (Array.isArray(o)) errs = o.length;
      } catch (e) {}
      return { items: items, bytes: bytes, errs: errs };
    }
    function renderDiagCount() {
      const el = document.getElementById('st-err');
      if (!el) return;
      const d = diagSummary();
      el.textContent = (d.items ? d.items + ' 项缓存' : '无缓存') + (d.errs ? ' · ' + d.errs + ' 条错误' : '') + (d.items ? ' · 约 ' + fmtBytes(d.bytes) : '');
    }
    function renderStorage() {
      // v3.29.x：总占用摆两个口径——「本项目占用合计」（本页面统计到的 LS+IDB）和
      // 「浏览器整域已用」（navigator.storage.estimate 是整个 origin，含同域名下其他
      // 站点与图片缓存，#88 实测过同账号 Pages 共用配额）。以前只报后者，用户拿它跟
      // 明细一比就觉得「几百 MB 去哪了 / 是不是统计漏了」。
      const quotaEl = document.getElementById('st-quota');
      // #497 占比补全：原实现两条占用行只有绝对字节（「971.2 MB」「5.5 GB」），用户口算不出
      // 「全部数据占了多少配额」＝报障「内存占比显示不全」。整域行追加「（占 X%）」；本项目
      // 合计行在 quota/IDB 两个异步都到位后由 renderSelf 补上「占浏览器配额 X%」。
      let quotaInfo = null;
      // idbState.total：undefined=统计中 / null=读取失败 / 数字=IDB 合计字节（缓存供 quota 异步补渲染）
      const idbState = { total: undefined, count: 0 };
      if (quotaEl && navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (r) {
          quotaInfo = { usage: (r && r.usage) || 0, quota: (r && r.quota) || 0 };
          if (quotaEl) quotaEl.textContent = fmtBytes(quotaInfo.usage) + ' / ' + fmtBytes(quotaInfo.quota) +
            (quotaInfo.quota ? '（占 ' + pctOf(quotaInfo.usage, quotaInfo.quota) + '）' : '');
          renderSelf();
        }).catch(function () { if (quotaEl) quotaEl.textContent = '读取失败'; });
      } else if (quotaEl) quotaEl.textContent = '接口不可用';
      const ls = lsStats();
      const lsEl = document.getElementById('st-ls');
      if (lsEl) lsEl.textContent = fmtBytes(ls.total) + '（' + ls.count + ' 键）';
      // v3.32.x：可清理空间 · 本机音乐文件占用（从 IndexedDB 的「本地音乐」分类取，
      // Blob 按真实字节计数；IndexedDB 未读到前先显示占位，读到后由 idbStats 回调刷新）
      const musicEl = document.getElementById('st-music');
      if (musicEl) musicEl.textContent = '统计中…（IndexedDB）';
      // v3.26.x 存储优化：媒体池占用占位（IndexedDB 统计回调里刷新）
      const mediaEl = document.getElementById('st-media');
      if (mediaEl) mediaEl.textContent = '统计中…（IndexedDB）';
      const otherEl = document.getElementById('st-other');
      if (otherEl) otherEl.textContent = ls.otherCount ? fmtBytes(ls.otherSize) + '（' + ls.otherCount + ' 键）' : '无';
      const selfEl = document.getElementById('st-self');
      // #497：renderSelf 取代原 showSelf——缓存 idbState（quota 回调也调它），IDB 完成且 quota
      // 到位时在本行末尾追加「，占浏览器配额 X%」（quota 读不到就不加，绝不显示假百分比）
      const renderSelf = function () {
        if (!selfEl) return;
        const t = idbState.total;
        if (t === undefined) { selfEl.textContent = fmtBytes(ls.total) + '（IndexedDB 统计中…）'; return; }
        if (t === null) { selfEl.textContent = fmtBytes(ls.total) + '（不含 IndexedDB，见下方告警）'; return; }
        selfEl.textContent = fmtBytes(ls.total + t) + '（' + ls.count + ' + ' + idbState.count + ' 键' +
          (quotaInfo && quotaInfo.quota ? '，占浏览器配额 ' + pctOf(ls.total + t, quotaInfo.quota) : '') + '）';
      };
      renderSelf();
      const idbEl = document.getElementById('st-idb');
      if (idbEl) idbEl.textContent = '统计中…';
      // 先渲染 localStorage 明细，IndexedDB 异步补齐
      renderCatTable(ls.cats, null, false);
      idbStats(function (done, totalN) {
        if (idbEl) idbEl.textContent = '统计中…（' + done + '/' + totalN + '）';
      }, function (res) {
        if (idbEl) idbEl.textContent = res ? fmtBytes(res.total) + '（' + res.count + ' 键）' : '读取失败（未计入合计）';
        idbState.total = res ? res.total : null;
        idbState.count = res ? res.count : 0;
        renderSelf();
        renderCatTable(ls.cats, res ? res.cats : null, !res);
        // 可清理空间 · 本机音乐文件占用（本地音乐分类在 IndexedDB 里的 Blob 真实字节）
        if (musicEl) {
          const m = (res && res.cats && res.cats['本地音乐']) ? res.cats['本地音乐'].size : 0;
          musicEl.textContent = res ? fmtBytes(m) : '读取失败（未计入）';
        }
        // v3.26.x 存储优化：媒体池占用（媒体池分类在 IndexedDB 里的真实字节）
        if (mediaEl) {
          const mc = (res && res.cats && res.cats[CAT_MEDIA]) ? res.cats[CAT_MEDIA] : null;
          mediaEl.textContent = res ? (mc ? fmtBytes(mc.size) + '（' + mc.n + ' 条）' : '空') : '读取失败（未计入）';
        }
      });
      renderDiagCount();
      renderPersist();
      renderOtherSlim();
    }
    function clearDiag() {
      DIAG_KEYS.forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) {}
        try { if (window.idbDelete) window.idbDelete(k); } catch (e) {}
      });
      // 诊断角标归零（device.js 暴露的刷新接口）
      try { if (window.mochiRefreshDiagBadge) window.mochiRefreshDiagBadge(); } catch (e) {}
      renderDiagCount();
      try { if (typeof toast === 'function') toast('错误诊断记录已清理'); } catch (e) {}
    }
    const clearBtn = document.getElementById('st-clear-err');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (window.openModal) {
          window.openModal('确认清理错误诊断记录？', '', function () {
            clearDiag();
          }, {
            noInput: true,
            staticText: '将删除最近错误、环境变化、长任务卡顿、网络失败、交互轨迹等诊断缓存（__diag-*）。清理后诊断角标归零，不影响聊天、字卡、头像、音乐等任何业务数据。'
          });
        } else {
          clearDiag();
        }
      });
    }
    // v3.32.x：可清理空间 · 到音乐播放器清理——复用桌面「音乐」App 入口跳到音乐页，
    // 让用户在那里的 ⚙ 设置里一键清理本地音频缓存。不在本页直接删 IDB 音乐文件，
    // 避免和音乐播放器的内存歌单/外链/种子歌逻辑脱节（属业务功能，交给音乐设置收口）。
    const goMusicBtn = document.getElementById('st-goto-music');
    if (goMusicBtn) {
      goMusicBtn.addEventListener('click', function () {
        const app = document.querySelector('.app[data-app="music"]');
        if (app) {
          document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
          try { app.click(); } catch (e) {}
        } else {
          // 兜底：找不到桌面音乐入口时提示手动路径
          if (window.openModal) window.openModal('找不到音乐入口', '', null, { noInput: true, staticText: '请回到桌面，点右上角「音乐」进入播放器，再点 ⚙ 设置 → 清理本地音频缓存。' });
        }
      });
    }
    // ===== v3.26.x 存储优化：媒体池孤儿清理（mark-and-sweep 在 media-pool.js：mochiMediaGC / mochiMediaGCApply）=====
    const gcBtn = document.getElementById('st-media-gc');
    if (gcBtn) {
      gcBtn.addEventListener('click', function () {
        const orphanEl = document.getElementById('st-media-orphan');
        if (!window.mochiMediaGC || !window.mochiMediaGCApply) {
          if (window.openModal) window.openModal('本环境不支持', '', null, { noInput: true, staticText: '媒体池扫描需要安全上下文（HTTPS）与 IndexedDB 支持，当前环境不可用。' });
          return;
        }
        const oldTxt = gcBtn.textContent;
        gcBtn.disabled = true;
        // FIX 2026-09-14 #441 大库扫描改分批让出主线程+实时进度（旧整包 stringify 冻结主线程＝假死「没反应」）
        gcBtn.textContent = '扫描中… 0/?';
        try { if (typeof toast === 'function') toast('开始扫描：需通读聊天记录，大库约需一两分钟，请留在本页'); } catch (eT0) {}
        window.mochiMediaGC(function (done, total) {
          gcBtn.textContent = '扫描中… ' + done + '/' + total;
        }).then(function (rep) {
          gcBtn.disabled = false;
          gcBtn.textContent = oldTxt;
          if (orphanEl) orphanEl.textContent = (rep && rep.ok) ? (rep.orphans.length ? fmtBytes(rep.bytes) + '（' + rep.orphans.length + ' 条）' : '无孤儿，池很干净') : ((rep && rep.reason) || '扫描失败');
          if (!rep || !rep.ok) {
            if (window.openModal) window.openModal('扫描未完成', '', null, { noInput: true, staticText: (rep && rep.reason || '未知原因') + '\n\n没有删除任何内容，稍后存储空闲时可再试。' });
            return;
          }
          if (!rep.orphans.length) { if (typeof toast === 'function') toast('没有孤儿媒体，无需清理'); return; }
          if (window.openModal) {
            window.openModal('删除孤儿媒体？', '', function () {
              gcBtn.disabled = true;
              window.mochiMediaGCApply(rep.orphans).then(function (n) {
                gcBtn.disabled = false;
                if (orphanEl) orphanEl.textContent = '已清理 ' + n + ' 条，可重新扫描核对';
                if (typeof toast === 'function') toast('已清理 ' + n + ' 条孤儿媒体，释放约 ' + fmtBytes(rep.bytes));
              }).catch(function () { gcBtn.disabled = false; });
            }, {
              noInput: true,
              staticText: '扫描到 ' + rep.orphans.length + ' 条不再被任何聊天记录/收藏引用的池内图片（约 ' + fmtBytes(rep.bytes) + '）。删除只影响媒体池副本，聊天记录与收藏本身不动；删除不可撤销，建议先导出备份。'
            });
          }
        }).catch(function () {
          gcBtn.disabled = false;
          gcBtn.textContent = oldTxt;
          if (orphanEl) orphanEl.textContent = '扫描异常';
          if (window.openModal) window.openModal('扫描异常', '', null, { noInput: true, staticText: '孤儿媒体扫描中途出错，没有删除任何内容。\n\n可稍后重试；若反复出现请到「关于/诊断」导出诊断信息报障。' });
        });
      });
    }
    // FIX 2026-09-14 图片丢失核对：mochiMediaCoverage（media-pool.js）比对「聊天/收藏/群聊/尾巴
    // 引用到的唯一令牌数」vs「池里真正存在的条数」，帮用户分辨「图片丢失」是备份没带池
    //（引用数 > 池内数，需从源头设备重导含图片的完整备份）还是链路没写回（两边相等，自愈）。
    // 纯只读查询，不写不删；与 mochiMediaGC 同页面同纪律。
    const covBtn = document.getElementById('st-media-cov-btn');
    if (covBtn) {
      covBtn.addEventListener('click', function () {
        const covEl = document.getElementById('st-media-cov');
        if (!window.mochiMediaCoverage) {
          if (window.openModal) window.openModal('本环境不支持', '', null, { noInput: true, staticText: '图片核对需要安全上下文（HTTPS）与 IndexedDB 支持，当前环境不可用。' });
          return;
        }
        const oldTxt = covBtn.textContent;
        covBtn.disabled = true;
        // FIX 2026-09-14 #441 大库核对改分批让出主线程+实时进度（旧整包 stringify 冻结主线程＝
        // 页面假死、锁屏/切后台被杀后永不完成＝「点了没反应、等不到弹窗」红米K80 实报）
        covBtn.textContent = '核对中… 0/?';
        try { if (typeof toast === 'function') toast('开始核对：需通读聊天记录，大库约需一两分钟，请留在本页'); } catch (eT1) {}
        window.mochiMediaCoverage(function (done, total, label) {
          covBtn.textContent = '核对中… ' + done + '/' + total + (label ? '（' + label + '）' : '');
        }).then(function (rep) {
          covBtn.disabled = false;
          covBtn.textContent = oldTxt;
          if (!rep || !rep.ok) {
            if (covEl) covEl.textContent = '核对失败';
            if (window.openModal) window.openModal('核对未完成', '', null, { noInput: true, staticText: ((rep && rep.reason) || '未知原因') + '\n\n没有改动任何数据，稍后存储空闲时可再试。' });
            return;
          }
          if (covEl) covEl.textContent = rep.referenced + ' 张图 / 池内 ' + rep.inPool + (rep.missing ? '（缺 ' + rep.missing + '）' : '');
          const tpl = [];
          if (!rep.missing) {
            tpl.push('聊天/收藏/群聊引用的 ' + rep.referenced + ' 张图全部在池内，数据链完好。');
            tpl.push('若界面上仍有「图片缺失」占位，通常是渲染缓存问题：返回聊天页让图片重新渲染即可自愈；仍不显示可重启页面（关掉再打开）。');
          } else if (rep.inPool === 0) {
            tpl.push('当前设备媒体池里没有任何图片数据——聊天里引用的 ' + rep.referenced + ' 张图全部缺失。');
            tpl.push('这几乎可以断定是导入的备份未包含图片数据（旧「只备份文字」或源头设备本就没池数据）。恢复办法：找一台还有这些图片的源头设备，在它上面导出「完整备份」（导出时选完整/全部，不要选「只备份文字」），再在本机导入。');
          } else {
            tpl.push('聊天/收藏/群聊引用 ' + rep.referenced + ' 张图，媒体池里只有 ' + rep.inPool + ' 张，缺失 ' + rep.missing + ' 张。');
            tpl.push('说明本机池数据不完整。可先点下方「重建媒体池（图片自愈）」：用本机还留存的原图副本（字卡库/收藏/头像库/备份快照等）按内容哈希把缺失池条目补回；补不回的图片才需要从有完整图片的源头设备重新导出「完整备份」（不要选「只备份文字」）再导入。');
          }
          tpl.push('提示：图片数据本身无法在手机上凭空生成，代码只能保证「备份带全图→导入后自愈」的链路可靠。');
          if (window.openModal) {
            window.openModal('图片核对结果', '', null, { noInput: true, staticText: tpl.join('\n') });
          }
        }).catch(function () {
          covBtn.disabled = false;
          covBtn.textContent = oldTxt;
          if (covEl) covEl.textContent = '核对异常';
          if (window.openModal) window.openModal('核对异常', '', null, { noInput: true, staticText: '图片核对中途出错，没有改动任何数据。\n\n可稍后重试；若反复出现请到「关于/诊断」导出诊断信息报障。' });
        });
      });
    }
    // FIX 2026-09-13 #423 媒体池一键重建（图片自愈）：mochiMediaRebuild（media-pool.js）扫描本机
    // 存留的原始图片副本（字卡库/收藏/表情分组/头像库/壁纸/备份快照等），按内容哈希把
    // 「缺失/被旧文字模式备份剥空的」池条目补回——池是内容寻址（SHA-256=令牌），任何一处
    // 幸存副本都能让同名令牌恢复解析。只补缺失/空串条目，绝不覆盖有效池值、绝不删除任何数据。
    const rbBtn = document.getElementById('st-media-rebuild-btn');
    if (rbBtn) {
      rbBtn.addEventListener('click', function () {
        const rbEl = document.getElementById('st-media-rebuild');
        if (!window.mochiMediaRebuild) {
          if (window.openModal) window.openModal('本环境不支持', '', null, { noInput: true, staticText: '媒体池重建需要安全上下文（HTTPS）与 IndexedDB 支持，当前环境不可用。' });
          return;
        }
        const oldTxt = rbBtn.textContent;
        const doRebuild = function () {
          rbBtn.disabled = true;
          // FIX 2026-09-14 #441 重建三阶段（池体检/扫副本/哈希）分批让出主线程+实时进度
          rbBtn.textContent = '重建中… 准备';
          try { if (typeof toast === 'function') toast('开始重建：扫描+哈希校验，大库约需几分钟，请留在本页'); } catch (eT2) {}
          window.mochiMediaRebuild(function (done, total, label) {
            rbBtn.textContent = '重建中… ' + (label || '准备') + (total ? ' ' + done + '/' + total : '');
          }).then(function (rep) {
            rbBtn.disabled = false;
            rbBtn.textContent = oldTxt;
            if (!rep || !rep.ok) {
              if (rbEl) rbEl.textContent = '重建失败';
              if (window.openModal) window.openModal('重建未完成', '', null, { noInput: true, staticText: ((rep && rep.reason) || '未知原因') + '\n\n没有改动任何数据，稍后存储空闲时可再试。' });
              return;
            }
            if (rbEl) rbEl.textContent = '补回 ' + rep.written + ' 张' + (rep.writeFail ? '（' + rep.writeFail + ' 张写失败）' : '');
            const tpl = [];
            tpl.push('本机池内原有 ' + rep.poolN + ' 条（有效 ' + rep.validN + '、缺失/空串 ' + rep.brokenN + '）。');
            tpl.push('本机扫描到 ' + rep.foundN + ' 张存留原图（约 ' + fmtBytes(rep.bytes) + '），其中 ' + rep.alreadyOk + ' 张池里本来就有，新补回 ' + rep.written + ' 条池条目' + (rep.writeFail ? '，' + rep.writeFail + ' 条写入失败（存储繁忙，可稍后再点一次重建）' : '') + '。');
            if (rep.written > 0) {
              tpl.push('已补回的部分：回到聊天/字卡库即可看到图片恢复（当前页面会自动刷新占位图）。');
            } else {
              tpl.push('没有可补回的条目——本机池本身完整，或存留原图与缺失令牌对不上。');
            }
            tpl.push('仍显示「图片丢失」的图 = 本机已没有任何该图副本，只能从有完整图片的源头设备导出「完整备份」（不要选「只备份文字」）再导入恢复。');
            if (window.openModal) window.openModal('媒体池重建结果', '', null, { noInput: true, staticText: tpl.join('\n') });
          }).catch(function () {
            rbBtn.disabled = false;
            rbBtn.textContent = oldTxt;
            if (rbEl) rbEl.textContent = '重建异常';
            if (window.openModal) window.openModal('重建异常', '', null, { noInput: true, staticText: '媒体池重建中途出错，没有改动任何数据。\n\n可稍后重试；若反复出现请到「关于/诊断」导出诊断信息报障。' });
          });
        };
        if (window.openModal) {
          // 与上方「删除孤儿媒体」同款 noInput 确认：回调不判值（#32 同因族，noInput 点确定 fire 传 null）
          window.openModal('重建媒体池（图片自愈）？', '', function () {
            doRebuild();
          }, {
            noInput: true, okText: '开始重建',
            staticText: '本机聊天/收藏里的图片以「令牌」引用媒体池（IndexedDB）。若池条目缺失或被旧备份剥成空串，图片会显示「图片丢失」。\n\n重建 = 扫描本机还留存的原图副本（字卡库/收藏/表情分组/头像库/壁纸/备份快照等），按内容哈希把缺失的池条目补回。\n\n· 只补缺失/空串条目，不覆盖任何有效数据，不删除任何数据；\n· 补得回多少取决于本机还留有多少原图副本；补不回的仍需源头设备完整备份；\n· 大库扫描需要一些时间，期间请保持页面打开。'
          });
        } else {
          doRebuild();
        }
      });
    }
    // ===== v3.26.x 存储优化：持久存储（navigator.storage.persist——浏览器承诺不自动清库）=====
    // ===== v3.32.x 可清理空间 · 同域其他站点数据（ml2_* 等非本项目键占满配额，用户报障实锤）=====
    // 同 origin 下其他应用（GitHub Pages 同账号各项目共用配额）会写非 xy-home-v2: 前缀的键，
    // 把本应用配额挤到 QuotaExceededError（荣耀/小米等多机型实测）。这里列出来让用户自主清理，
    // 只删 localStorage 里非本应用前缀的键、绝不碰本应用任何键（xy-home-v2: 开头）。
    function scanOtherLS() {
      const rows = [];
      let size = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || k.indexOf(G) === 0) continue;
          const sz = (k.length + String(localStorage.getItem(k) || '').length) * 2;
          rows.push({ k: k, sz: sz });
          size += sz;
        }
      } catch (e) {}
      rows.sort(function (a, b) { return b.sz - a.sz; });
      return { rows: rows, size: size };
    }
    function renderOtherSlim() {
      const el = document.getElementById('st-other-slim');
      const btn = document.getElementById('st-slim-other');
      const lst = document.getElementById('st-other-slim-list');
      if (!el) return;
      const o = scanOtherLS();
      el.textContent = o.rows.length ? fmtBytes(o.size) + '（' + o.rows.length + ' 键）' : '无';
      btn.hidden = !o.rows.length;
      btn.textContent = o.rows.length ? '一键清理（' + fmtBytes(o.size) + '，仅删其他站点）' : '无需清理';
      if (lst) lst.textContent = o.rows.length ? '占用最多：' + o.rows.slice(0, 8).map(function (r) { return r.k + ' ' + fmtBytes(r.sz); }).join('、') : '';
    }
    const slimBtn = document.getElementById('st-slim-other');
    if (slimBtn) {
      slimBtn.addEventListener('click', function () {
        const o = scanOtherLS();
        if (!o.rows.length) { if (typeof toast === 'function') toast('没有可清理的同域其他站点数据'); return; }
        const list = o.rows.slice(0, 12).map(function (r) { return r.k + ' ' + fmtBytes(r.sz); }).join('\n');
        if (window.openModal) {
          window.openModal('清理同域其他站点数据？', '', function () {
            let n = 0;
            o.rows.forEach(function (it) {
              try { localStorage.removeItem(it.k); n++; } catch (e) {}
            });
            try { if (typeof toast === 'function') toast('已清理 ' + n + ' 键（约 ' + fmtBytes(o.size) + '）'); } catch (e) {}
            renderOtherSlim();
            renderStorage();
          }, {
            noInput: true,
            staticText: '将删除存储里「非本应用」前缀的所有键（共 ' + o.rows.length + ' 键，约 ' + fmtBytes(o.size) + '）——通常来自同域名下的其他项目/应用（如 ml2_*），本应用的数据（xy-home-v2: 开头）完全不动。删除不可撤销，若你同时在用那些站点，可能影响它们。\n\n占用最多：\n' + list
          });
        }
      });
    }
    function renderPersist() {
      const el = document.getElementById('st-persist');
      const btn = document.getElementById('st-persist-btn');
      if (!el) return;
      if (!(navigator.storage && navigator.storage.persisted && navigator.storage.persist)) {
        el.textContent = '接口不可用';
        if (btn) btn.hidden = true;
        return;
      }
      navigator.storage.persisted().then(function (p) {
        el.textContent = p ? '已持久化（浏览器承诺不自动清理）' : '未持久化（空间紧张时可能被浏览器自动清理）';
        if (btn) btn.hidden = !!p;
      }).catch(function () { el.textContent = '读取失败'; if (btn) btn.hidden = true; });
    }
    const persistBtn = document.getElementById('st-persist-btn');
    if (persistBtn) {
      persistBtn.addEventListener('click', function () {
        if (!(navigator.storage && navigator.storage.persist)) return;
        navigator.storage.persist().then(function (ok) {
          if (typeof toast === 'function') toast(ok ? '已获得持久存储' : '浏览器暂未授予：多访问、多使用本应用后再试');
          renderPersist();
        }).catch(function () { renderPersist(); });
      });
    }
    // ===== #168 字卡库瘦身（后端 src/js/storage-slim.js：mochiCcSlimScan / mochiCcSlimDeleteGroup）=====
    const ccScanBtn = document.getElementById('st-cc-scan');
    if (ccScanBtn) {
      const ccListEl = document.getElementById('st-cc-list');
      const CC_CAT_CN = { text: '文字', kaomoji: '颜文字', emoji: '表情', sticker: '表情包', image: '图片', poke: '拍一拍', voice: '语音' };
      const runCcScan = function () {
        if (!window.mochiCcSlimScan || !window.mochiCcSlimDeleteGroup) {
          if (window.openModal) window.openModal('本环境不支持', '', null, { noInput: true, staticText: '字卡库扫描需要 IndexedDB 支持，当前环境不可用。' });
          return Promise.resolve(null);
        }
        const ccEl = document.getElementById('st-cc');
        ccScanBtn.disabled = true;
        if (ccEl) ccEl.textContent = '扫描中…（大库较慢，勿离开本页）';
        if (ccListEl) ccListEl.innerHTML = '';
        return window.mochiCcSlimScan().then(function (rep) {
          ccScanBtn.disabled = false;
          if (!rep || !rep.ok) {
            if (ccEl) ccEl.textContent = (rep && rep.reason) || '扫描失败';
            return rep;
          }
          if (ccEl) ccEl.textContent = rep.libs.length ? rep.libs.map(function (l) { return l.label + ' ' + fmtBytes(l.bytes); }).join(' · ') : '未发现字卡库';
          if (rep.reason && typeof toast === 'function') toast(rep.reason);
          if (ccListEl) {
            const tops = rep.groups.slice(0, 12);
            if (!tops.length) {
              const h = document.createElement('div');
              h.className = 'storage-hint';
              h.textContent = '没有扫到可列的分组。';
              ccListEl.appendChild(h);
            }
            tops.forEach(function (gdata) {
              const row = document.createElement('div');
              row.className = 'storage-row';
              const sp = document.createElement('span');
              sp.textContent = gdata.label + ' · ' + (CC_CAT_CN[gdata.cat] || gdata.cat) + '「' + gdata.name + '」· ' + gdata.cards + ' 张';
              const bb = document.createElement('b');
              bb.textContent = fmtBytes(gdata.bytes);
              row.appendChild(sp);
              row.appendChild(bb);
              ccListEl.appendChild(row);
              const btn = document.createElement('button');
              btn.className = 'storage-clear';
              btn.type = 'button';
              btn.textContent = '删除「' + gdata.name + '」整组';
              btn.addEventListener('click', function () {
                if (!window.openModal) return;
                window.openModal('删除整组字卡？', '', function () {
                  btn.disabled = true;
                  window.mochiCcSlimDeleteGroup(gdata.prefix, gdata.key, gdata.cat, gdata.name).then(function (done) {
                    if (typeof toast === 'function') toast(done ? '已删除「' + gdata.name + '」整组' : '删除未生效（组可能刚被改过），已重新扫描');
                    runCcScan();
                  }).catch(function () { btn.disabled = false; });
                }, {
                  noInput: true,
                  staticText: '将删除 ' + gdata.label + ' · ' + (CC_CAT_CN[gdata.cat] || gdata.cat) + ' 分组「' + gdata.name + '」（' + gdata.cards + ' 张，约 ' + fmtBytes(gdata.bytes) + '）。与在字卡管理页删掉该组效果相同，不可撤销，建议先导出备份。'
                });
              });
              ccListEl.appendChild(btn);
            });
          }
          return rep;
        }).catch(function () {
          ccScanBtn.disabled = false;
          const ccEl2 = document.getElementById('st-cc');
          if (ccEl2) ccEl2.textContent = '扫描异常';
          return null;
        });
      };
      ccScanBtn.addEventListener('click', runCcScan);
    }
    // ===== #554（TASKS #128）字卡媒体令牌化持久化：库键内联图转池令牌（同图全库只存一份）=====
    // 后端 chatcard.js mochiCcPersistTokenize（池先令牌后 / 字符串级替换 / 不变小不写）。
    const ccTokBtn = document.getElementById('st-cc-tokbtn');
    if (ccTokBtn) {
      const tokEl = document.getElementById('st-cc-tok');
      ccTokBtn.addEventListener('click', function () {
        if (!window.mochiCcPersistTokenize) {
          if (window.openModal) window.openModal('本环境不支持', '', null, { noInput: true, staticText: '字卡图去重需要安全上下文（HTTPS/localhost）+ IndexedDB，当前环境不可用。' });
          return;
        }
        if (ccTokBtn.disabled) return;
        if (!window.openModal) { if (typeof toast === 'function') toast('当前环境缺少弹窗组件'); return; }
        window.openModal('字卡图去重入库？', '', function () {
          ccTokBtn.disabled = true;
          if (tokEl) tokEl.textContent = '处理中…';
          window.mochiCcPersistTokenize(function (label, done, total) {
            if (tokEl) tokEl.textContent = '处理中：' + label + ' ' + done + '/' + total;
          }).then(function (rep) {
            ccTokBtn.disabled = false;
            if (!rep || !rep.ok) {
              if (tokEl) tokEl.textContent = '未处理';
              if (typeof toast === 'function') toast('去重未执行：' + ((rep && rep.reason) || '未知原因'));
              return;
            }
            const msg = rep.written
              ? '已处理 ' + rep.images + ' 张内联图（唯一 ' + rep.uniq + ' 张），库键共缩小约 ' + fmtBytes(rep.saved) + '，写回 ' + rep.written + ' 个库'
              : '没有需要去重的内联大图（可能已处理过，或图片都在阈值以下）';
            if (tokEl) tokEl.textContent = rep.written ? ('已去重：缩小约 ' + fmtBytes(rep.saved)) : '无内联大图';
            try { if (typeof renderStorage === 'function') renderStorage(); } catch (eR) {}
            window.openModal('字卡图去重完成', '', null, { noInput: true, staticText: msg + '\n\n图片显示/发送不变；「导出数据」会自动还原成完整图片。' });
          }).catch(function (e) {
            ccTokBtn.disabled = false;
            if (tokEl) tokEl.textContent = '未处理';
            if (typeof toast === 'function') toast('去重异常：' + ((e && e.message) || e));
          });
        }, {
          noInput: true,
          staticText: '把字卡库里的内联图片转成媒体池令牌（与聊天图片同机制）：同一张贴图在公用库+各专属库里只存一份，库键大幅缩小；图片显示/发送不变，「导出数据」自动还原完整图片。处理不可逆，建议先导出备份留底。'
        });
      });
    }
    if (row) {
      row.addEventListener('click', function () {
        document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
        page.hidden = false;
        renderStorage();
      });
    }
    // #497：压缩图片完成后重算总占用（img-compress.js 压缩完派发本事件；注释里声称的
    // 「personalize 监听重算」此前从未实现＝压完总占用纹丝不动）。页面不在本页时不空转，
    // 重进（点行）本来就会重算。
    document.addEventListener('mochi-img-compressed', function () {
      if (!page.hidden) renderStorage();
    });
    if (back) {
      back.addEventListener('click', function () {
        document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
        const setPage = document.getElementById('page-setting');
        if (setPage) setPage.hidden = false;
      });
    }
    // 点击分类行展开/收起该分类下的存储键名（事件委托，行是动态渲染的）
    const stCat = document.getElementById('st-cat');
    if (stCat) {
      stCat.addEventListener('click', function (ev) {
        const row = ev.target && ev.target.closest ? ev.target.closest('.storage-cat-row.has-keys') : null;
        if (!row) return;
        row.classList.toggle('open');
      });
    }
  })();

  // ===== #726 卡顿自检·渲染层实测（设置→工具「卡顿自检」行）——与下方 #411 数据层一键优化互补：
  // 10 秒 rAF 帧间隔现场实测（可去任意页面复现），报告含掉帧率/集中页/键盘期占比/本地数据画像，
  // 报告走只读大弹窗（同功能诊断样式）。检测逻辑全在 perf-check.js，这里只做行接线/进度浮条/弹报告。
  (function () {
    const row = document.getElementById('row-perf-check');
    if (!row || !window.mochiPerfCheck) return;
    const sub = row.querySelector('.sub');
    function echoLast() {
      try {
        const r = JSON.parse(localStorage.getItem(window.mochiPerfCheck.LAST_KEY) || 'null');
        if (r && r.verdict && sub) sub.textContent = '上次：' + r.verdict + '（掉帧 ' + r.jankPct + '%）· ' + new Date(r.t).toLocaleString().replace(/^\d+\/\d+\/\d+\s*/, '');
      } catch (e) {}
    }
    echoLast();
    let bar = null;
    function showBar(txt) {
      try {
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'perf-check-bar';
          // #905：进度浮条从「底部横条」改「顶部居中小胶囊」——底部条把 tabbar/聊天输入栏/
          // 返回按钮这些用户实测时要点的按钮盖住了（用户实报「位置太靠下不居中，挡住按钮」；
          // pointer-events:none 本就点了穿透，问题在视觉遮挡）。顶部胶囊避开全部底部操作区，
          // 只占页面标题上方窄条；宽度按内容自适应（max-width 防长文案溢出）。
          bar.style.cssText = 'position:fixed;top:max(14px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);max-width:88%;z-index:99999;background:rgba(18,18,28,.94);color:#fff;padding:8px 14px;border-radius:999px;font-size:12px;line-height:1.45;text-align:center;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          document.body.appendChild(bar);
        }
        bar.textContent = txt;
      } catch (e) {}
    }
    function hideBar() { try { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); } catch (e) {} bar = null; }
    row.addEventListener('click', function () {
      if (!window.openModal || window.mochiPerfCheck.running()) return;
      // #905：时长可选（用户实报「为什么只能测十秒，不合理」）——纯 pills 弹窗确定时 cb(pillVal)，
      // 默认 30 秒（原 10 秒样本太少：60fps 下才 ~600 帧，偶发巨帧很容易整窗漏采），10/60 可换。
      // #906：抽 runTest——报告弹窗「确定」＝用同样时长马上再测一轮（okText 定制按钮文案），
      // 闭环不用重进设置；「取消」仅关闭。running() 守卫天然防双开。
      function runTest(durMs) {
        // 点确定＝开始：弹窗即关，用户去任意页面正常操作所选时长，顶部浮条实时倒数，结束自动弹报告
        window.mochiPerfCheck.start(durMs, function (p) {
          // #906：浮条带当前页名（采样在跟着走，用户放心）＋后台占比过高时提示「不算数」
          var hidRatio = (p.frames + p.hid) > 0 ? p.hid / (p.frames + p.hid) : 0;
          showBar('卡顿实测中…剩 ' + p.left + ' 秒｜' + (p.pg && p.pg !== '?' ? p.pg + '｜' : '') + '已采 ' + p.frames + ' 帧 · 掉帧 ' + p.janky + (hidRatio > 0.3 ? '（锁屏/切后台的时间不算数）' : ''));
        }).then(function (r) {
          hideBar();
          if (!r) return;
          echoLast();
          // #884：报告弹窗补【复制】+【导出docx】（同 device.js 诊断弹窗的 copyBtn/exportBtn 机制）——
          // 之前只有可手选的 textarea，手机上长篇手选复制极易漏段；导出走 device.js 暴露的
          // window.mochiDiagExportDocx（三级降级：分享面板→保存框→确认下载，Word/WPS 直开不乱码），
          // shareTitle 用「mochi 卡顿自检报告」；无该全局（旧产物）时提示改用复制。
          var ctlR = window.openModal('卡顿自检报告', r.text, function () { runTest(durMs); }, {
            noInput: true, textarea: true, textareaRows: 16, big: true,
            staticText: '点「再测一次」＝用同样时长马上再来一轮（对照测）；「取消」仅关闭本报告。',
            copyBtn: {
              label: '复制',
              fn: function (c) {
                var txt = c ? c.text() : r.text;
                var hint = function (s) { if (c && c.hint) c.hint(s); };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(txt).then(function () { hint('已复制到剪贴板，直接粘贴发给开发者即可'); }, function () { hint('复制失败，请长按选字手动复制'); });
                } else {
                  hint('当前内核不支持一键复制，请长按文本手动复制（或用【导出docx】）');
                }
              }
            },
            exportBtn: {
              label: '导出docx',
              fn: function (c) {
                var txt = c ? c.text() : r.text;
                if (typeof window.mochiDiagExportDocx === 'function') {
                  window.mochiDiagExportDocx(txt, 'mochi-perfcheck-', null, null, 'mochi 卡顿自检报告');
                } else {
                  if (c && c.hint) c.hint('导出组件未就绪，请用【复制】或长按手选复制');
                }
              }
            }
          });
          try { if (ctlR && ctlR.okText) ctlR.okText('再测一次'); } catch (e5) {}
        });
      }
      window.openModal('卡顿自检（渲染层实测）', '', function (v) {
        var durMs = { 10: 10000, 30: 30000, 60: 60000, 120: 120000, 300: 300000 }[String(v)] || 30000;
        runTest(durMs);
      }, {
        // #908：红字警示——用户在弹窗打开这一刻就要看见「短时长没用」（#900b 的 staticEmph+warn 重点标红机制）
        staticText: '**⚠ 时长太短没用！**10 秒 / 30 秒只能看「此刻顺不顺」，抓卡顿请用 **2 分钟档（已设为默认）**，卡得少就用 **5 分钟**——切页面卡、用一会儿才卡、玩一阵才掉帧这类，时间越长越撞得上。\n\n点「确定」开始后（弹窗会关）正常用手机：去感觉卡的地方打字、滑动、切页、从后台切回来；顶部浮条实时倒数和显示当前页，结束自动弹报告，可【复制】或【导出docx】发给开发者。采样只在本机、不上传；锁屏/切后台的时间自动剔除不算数。',
        noInput: true,
        warn: true,
        staticEmph: true,
        pills: [{ label: '10 秒', value: '10' }, { label: '30 秒', value: '30' }, { label: '60 秒', value: '60' }, { label: '2 分钟', value: '120' }, { label: '5 分钟', value: '300' }],
        pill: '120'
      });
    });
  })();

  // ===== v3.26.x #411：卡顿自检 · 一键优化（只优化不删除） =====
  // 数据过大（如公用库 44MB）是 iOS/安卓间歇卡顿主因（#377/#387/#398 内存内瘦身后，
  // 大库解析/按需取回仍是冻结点）。本模块扫描分级 + 非破坏预热：不碰不删任何用户数据，
  // 不写任何业务键，跨设备零语义变化。入口：#row-perf-optimize 设置行 + 启动后大库主动弹。
  (function () {
    const row = document.getElementById('row-perf-optimize');
    if (!row) return;
    function pfmt(n) {
      n = Number(n) || 0;
      if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
      return n + ' B';
    }
    const LEVEL_CN = { 轻: '轻量', 中: '中度', 重: '较重' };
    function perfToast(msg) {
      try {
        let t = document.getElementById('cc-toast');
        if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
        t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
        clearTimeout(t._pT); t._pT = setTimeout(function () { t.className = 'cc-toast'; }, 3200);
      } catch (e) {}
    }
    // 弹出「一键优化」确认——每次调用前传入已扫描的 agg
    function promptHeal(agg) {
      if (!window.openModal || !window.mochiPerfHeal) { perfToast('当前环境不支持，请在支持 IndexedDB 的设备上使用'); return; }
      const mb = (agg.totalBytes || 0) / 1048576;
      let lines = [];
      if (agg.ok) {
        lines.push('扫描结果：字卡库共 ' + agg.libs + ' 个作用域，占用约 ' + pfmt(agg.totalBytes) + '（' + LEVEL_CN[agg.level] + '）。');
        if (mb > 5) lines.push('其中最大分组约 ' + pfmt(agg.biggestBytes) + '，大分组 ' + agg.bigGroups + ' 个——这是切换/打开聊天卡顿的大头。');
      } else {
        lines.push('扫描未完成：' + ((agg && agg.reason) || '未知原因') + '。');
      }
      lines.push('「一键优化」会：取回被挂起的大库 + 预热回复池，把耗时移到这次点击里完成，之后的聊天/回复会明显顺滑。');
      lines.push('（不删除任何字卡/表情/图片数据，纯优化）');
      window.openModal('卡顿自检 · 一键优化', '', function () {
        perfToast('正在优化（字卡库较大会稍等片刻）…');
        // #459 实时进度浮层：取回/预热期间主线程间歇被占，用户需要能看见「在干活、到哪了」。
        // 阶段+百分比由 mochiPerfHeal 的 prog 回调驱动；完成/异常/挂起仍由下方常驻弹窗收尾。
        let done = false;
        const bar = document.createElement('div');
        bar.id = 'perf-heal-bar';
        bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:max(16px,env(safe-area-inset-bottom,0px));z-index:99999;background:rgba(18,18,28,.94);color:#fff;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.5;text-align:center;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.35);'; /* #718 env 补 ,0px：老内核不支持 env 时整条 max() 失效＝提示条贴出屏 */
        bar.textContent = '正在准备…';
        (document.body || document.documentElement).appendChild(bar);
        function showProg(pct, label) {
          if (done) return;
          const p = (typeof pct === 'number') ? ' ' + Math.max(0, Math.min(100, pct | 0)) + '%' : '';
          bar.textContent = (label || '正在优化') + p;
        }
        function hideBar() {
          try { if (bar.parentNode) bar.parentNode.removeChild(bar); } catch (e2) {}
        }
        // FIX 2026-09-14 #458（多机型同报「自检弹窗修复点击没用」）：原回调两端都只有 3.2s
        // 转瞬 toast——大库优化（取回 44MB+预热令牌化）耗时数十秒起，iOS 上还可能伴随卡顿/
        // 页面被杀，开始/完成提示一闪而过＝用户观感「点了没用、什么都没发生」；且链路无
        // .catch、idbGet 存储繁忙挂起（#229 家族 iOS 高发）时 promise 永不落定＝永远无声。
        // 改为：结果常驻弹窗（必可见）+ .catch 弹窗 + 90s 看门狗兜底提示。零机型分支，
        // 不动 mochiPerfHeal/存储语义，其它设备修复零覆盖。
        const wd = setTimeout(function () {
          if (done) return;
          performPerfEnd('优化长时间未完成：本机存储繁忙（大库设备常见）。没有改动任何数据，可稍后重试；期间如仍卡顿，多为字卡库总量过大，可到字卡库清理最大的表情/图片分组后重试。');
        }, 90000);
        function performPerfEnd(msg) {
          if (done) return;
          done = true;
          clearTimeout(wd);
          hideBar();
          if (window.openModal) window.openModal('卡顿自检 · 优化结果', '', null, { noInput: true, staticText: msg });
          else perfToast(msg);
        }
        Promise.resolve(window.mochiPerfHeal(showProg)).then(function (res) {
          performPerfEnd((res && res.ok)
            ? '优化完成：已预热字卡池' + (res.warmed ? ' ' + res.warmed + ' 张' : '') + (res.reason ? '（部分：' + res.reason + '）' : '') + '。之后的聊天/回复会明显顺滑。'
            : '优化未完全生效：' + ((res && res.reason) || '未知') + '，可稍后重试。');
        }).catch(function (e) {
          performPerfEnd('优化过程出错：' + ((e && e.message) || e) + '。没有改动任何数据，可稍后重试。');
        });
      }, { noInput: true, staticText: lines.join('\n') });
    }
    // 设置行点击：即时扫描并弹出结果
    row.addEventListener('click', function () {
      if (!window.mochiCcSlimScan) { perfToast('当前环境不支持，请在支持 IndexedDB 的设备上使用'); return; }
      perfToast('正在扫描字卡库（较大会稍等）…');
      window.mochiCcSlimScan().then(function (rep) {
        const agg = window.mochiPerfAgg ? window.mochiPerfAgg(rep) : null;
        promptHeal(agg || rep || {});
      }).catch(function () { perfToast('扫描异常，请稍后重试'); });
    });
    // 启动后（数据就绪）：若字卡库确为大库则主动弹一次（3 天内不重复打扰）
    // #452 两处收口（iPhone 15 Pro Max Chrome 报「每次打开都有自检和优化，点击之后再次
    // 打开仍然会有」+ 同机 iOS 卡顿；多机型同族）：
    // ① 免打扰标记原用裸 localStorage.setItem——LS 配额满（本机诊断 5.1MB 顶满 iOS 配额、
    //    写探针 QuotaExceededError）时被 catch 静默吞掉＝标记永远写不进＝每次启动都弹。
    //    改 IDB 权威写（idbSet）+LS 兜底，读侧 IDB/LS 取较新。
    // ② 启动扫描原走 mochiCcSlimScan 全量——把 44.59MB 公用库整串读进堆+JSON.parse+逐组
    //    stringify（只为算字节）＝iOS 启动期秒级长任务/堆尖峰＝「一打开就卡/自动刷新重进」
    //    主力之一，且因①每次启动必付一遍。改 __big-idx 尺寸分级（idbBigSize 免读大值）：
    //    逐组明细仍保留在「卡顿自检 · 一键优化」设置行（用户主动点击才全量扫）。
    const PERF_REMIND_KEY = 'xy-home-v2:perf-opt-remind';
    function perfRemindRead(cb) {
      let lsV = 0;
      try { lsV = Number(localStorage.getItem(PERF_REMIND_KEY)) || 0; } catch (e) {}
      if (window.idbGet) {
        try {
          window.idbGet(PERF_REMIND_KEY).then(function (v) {
            const iv = Number(v) || 0;
            cb(iv > lsV ? iv : lsV);
          }).catch(function () { cb(lsV); });
          return;
        } catch (e) {}
      }
      cb(lsV);
    }
    function perfRemindWrite(t) {
      try { localStorage.setItem(PERF_REMIND_KEY, String(t)); } catch (e) {}
      try { if (window.idbSet) window.idbSet(PERF_REMIND_KEY, String(t)); } catch (e) {}
    }
    function maybePerfPrompt() {
      try {
        perfRemindRead(function (last) {
          if (Date.now() - last < 3 * 864e5) return;
          setTimeout(function () {
            if (!window.idbListKeys || !window.idbBigSize || !window.mochiPerfLevel) return;
            window.idbListKeys().then(function (keys) {
              if (!keys) return; // 清单读失败＝本轮不判（绝不为启动提示去读大值）
              const re = /^xy-home-v2:(?:[^:]+:)?cc-groups(?:-public)?$/;
              let libs = 0, totalBytes = 0, biggest = 0, bigGroups = 0;
              (keys || []).forEach(function (k) {
                k = String(k);
                if (!re.test(k)) return;
                const sz = window.idbBigSize(k);
                if (typeof sz !== 'number') return; // ≤200KB 小库不构成卡顿源，忽略
                libs++; totalBytes += sz;
                if (sz > biggest) biggest = sz;
                if (sz > 1048576) bigGroups++;
              });
              if (!libs || window.mochiPerfLevel(totalBytes, bigGroups) !== '重') return;
              perfRemindWrite(Date.now());
              promptHeal({ ok: true, libs: libs, totalBytes: totalBytes, biggestBytes: biggest, bigGroups: bigGroups, level: '重', reason: '' });
            }).catch(function () {});
          }, 2500); // 启动让出主线程再判，避免加剧启动帧
        });
      } catch (e) {}
    }
    if (window.__mochiDataReady) { try { setTimeout(maybePerfPrompt, 2000); } catch (e) {} }
    else { document.addEventListener('mochi-restore-done', function h() { document.removeEventListener('mochi-restore-done', h); setTimeout(maybePerfPrompt, 2000); }); }
  })();

  // 通话设置：点设置行 → 全屏设置页
  const callSettingsRow = document.getElementById('row-call-settings');
  if (callSettingsRow) {
    callSettingsRow.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const csPage = document.getElementById('page-call-settings');
      if (csPage) csPage.hidden = false;
    });
  }

  // ===== v3.7.x：新增桌面小组件（时钟 / 月历 / 计时器 / 纪念日倒计时） =====
  // 时钟：实时更新时:分 + 星期 + 月日
  let deskClockTimer = null;
  function initDeskClock() {
    const el = document.getElementById('dc-time');
    const dateEl = document.getElementById('dc-date');
    if (!el || !dateEl || deskClockTimer) return;
    const week = ['日','一','二','三','四','五','六'];
    const update = () => {
      const d = new Date();
      const p = (n) => (n < 10 ? '0' + n : '' + n);
      el.textContent = p(d.getHours()) + ':' + p(d.getMinutes());
      dateEl.textContent = '星期' + week[d.getDay()] + ' · ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
    };
    update();
    deskClockTimer = setInterval(update, 5000);
  }
  // 月历：当月网格，高亮今天，标注有留言的日子，点击跳日历页
  function renderDeskCalendar() {
    const grid = document.getElementById('dcal-grid');
    const title = document.getElementById('dcal-title');
    if (!grid || !title) return;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const p2 = (n) => (n < 10 ? '0' + n : '' + n);
    title.textContent = y + ' 年 ' + (m + 1) + ' 月';
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push('<span class="dcal-cell empty"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = y + '-' + p2(m + 1) + '-' + p2(d);
      const isToday = d === now.getDate();
      const hasMsg = !!store.get('cal-my-' + ds);
      cells.push('<span class="dcal-cell' + (isToday ? ' today' : '') + (hasMsg ? ' has-msg' : '') + '" data-date="' + ds + '">' + d + '</span>');
    }
    grid.innerHTML = cells.join('');
    grid.querySelectorAll('.dcal-cell:not(.empty)').forEach(c => {
      c.addEventListener('click', () => {
        const calApp = document.querySelector('.app[data-app="calendar"]');
        if (calApp) calApp.click();
      });
    });
  }
  // 计时器：正计时 + 倒计时
  let deskTimerBound = false, dtTimer = null;
  let dtState = { mode: 'up', running: false, startTs: 0, elapsed: 0, target: 0 };
  function initDeskTimer() {
    const disp = document.getElementById('dt-disp');
    const startBtn = document.getElementById('dt-start');
    const resetBtn = document.getElementById('dt-reset');
    const modeBtn = document.getElementById('dt-toggle-mode');
    const modeLabel = document.getElementById('dt-mode-label');
    if (!disp || !startBtn || deskTimerBound) return;
    deskTimerBound = true;
    const fmt = (ms) => {
      if (ms < 0) ms = 0;
      const t = Math.floor(ms / 100);
      const mm = Math.floor(t / 600), ss = Math.floor((t % 600) / 10), ds = t % 10;
      return (mm < 10 ? '0' + mm : '' + mm) + ':' + (ss < 10 ? '0' + ss : '' + ss) + '.' + ds;
    };
    const render = () => {
      if (dtState.mode === 'up') {
        const ms = dtState.running ? (Date.now() - dtState.startTs + dtState.elapsed) : dtState.elapsed;
        disp.textContent = fmt(ms);
      } else {
        const remain = dtState.running ? (dtState.target - (Date.now() - dtState.startTs) - dtState.elapsed) : (dtState.target - dtState.elapsed);
        disp.textContent = fmt(remain);
        if (dtState.running && remain <= 0) {
          dtState.running = false;
          if (dtTimer) { clearInterval(dtTimer); dtTimer = null; }
          startBtn.textContent = '开始';
          disp.textContent = '00:00.0';
          toast('倒计时结束');
          try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) {}
        }
      }
    };
    startBtn.addEventListener('click', () => {
      if (dtState.mode === 'down' && !dtState.running && dtState.target <= 0) {
        if (!window.openModal) return;
        window.openModal('倒计时分钟数', '5', (v) => {
          const min = parseFloat(v);
          if (!min || min <= 0) { toast('请输入有效分钟数'); return; }
          dtState.target = min * 60000;
          dtState.elapsed = 0;
          dtState.startTs = Date.now();
          dtState.running = true;
          startBtn.textContent = '暂停';
          if (dtTimer) clearInterval(dtTimer);
          dtTimer = setInterval(render, 100);
          render();
        });
        return;
      }
      if (dtState.running) {
        dtState.elapsed += Date.now() - dtState.startTs;
        dtState.running = false;
        if (dtTimer) { clearInterval(dtTimer); dtTimer = null; }
        startBtn.textContent = '继续';
      } else {
        dtState.startTs = Date.now();
        dtState.running = true;
        if (dtTimer) clearInterval(dtTimer);
        dtTimer = setInterval(render, 100);
        startBtn.textContent = '暂停';
      }
      render();
    });
    resetBtn.addEventListener('click', () => {
      dtState.running = false; dtState.elapsed = 0; dtState.target = 0;
      if (dtTimer) { clearInterval(dtTimer); dtTimer = null; }
      startBtn.textContent = '开始';
      disp.textContent = '00:00.0';
    });
    modeBtn.addEventListener('click', () => {
      if (dtState.running) { toast('请先暂停再切换模式'); return; }
      dtState.mode = dtState.mode === 'up' ? 'down' : 'up';
      dtState.elapsed = 0; dtState.target = 0;
      modeLabel.textContent = dtState.mode === 'up' ? '正计时' : '倒计时';
      modeBtn.textContent = dtState.mode === 'up' ? '倒计时' : '正计时';
      startBtn.textContent = '开始';
      disp.textContent = '00:00.0';
    });
    render();
  }
  // 纪念日倒计时：读 love-start + mem-extras，找未来最近的纪念日
  function renderDeskAnniv() {
    const daysEl = document.getElementById('da-days');
    const nameEl = document.getElementById('da-name');
    if (!daysEl || !nameEl) return;
    const now = new Date();
    const cands = [];
    const start = normDateStr(store.get('love-start'));
    if (start) {
      const d = new Date(start + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        let ann = new Date(now.getFullYear(), d.getMonth(), d.getDate());
        if (ann.getTime() < now.getTime()) ann.setFullYear(ann.getFullYear() + 1);
        cands.push({ name: relLabel(), date: ann });
      }
    }
    try {
      const extras = JSON.parse(store.get('mem-extras') || '[]');
      extras.forEach(it => {
        if (!it.date) return;
        const d = new Date(it.date + 'T00:00:00');
        if (isNaN(d.getTime())) return;
        let dt = new Date(d.getTime());
        if (dt.getTime() < now.getTime()) {
          dt = new Date(now.getFullYear(), d.getMonth(), d.getDate());
          if (dt.getTime() < now.getTime()) dt.setFullYear(dt.getFullYear() + 1);
        }
        cands.push({ name: it.name || '纪念日', date: dt });
      });
    } catch (e) {}
    if (!cands.length) {
      daysEl.textContent = '—';
      nameEl.textContent = '未设置纪念日';
      return;
    }
    cands.sort((a, b) => a.date - b.date);
    const next = cands[0];
    const days = Math.ceil((next.date - now) / 864e5);
    daysEl.textContent = days + ' 天';
    nameEl.textContent = next.name + ' · ' + (next.date.getMonth() + 1) + ' 月 ' + next.date.getDate() + ' 日';
  }
  function renderDeskWidgets() {
    try { initDeskClock(); } catch (e) {}
    try { renderDeskCalendar(); } catch (e) {}
    try { initDeskTimer(); } catch (e) {}
    try { renderDeskAnniv(); } catch (e) {}
    try { window.periodRenderDeskWidget && window.periodRenderDeskWidget(); } catch (e) {}
  }
  renderDeskWidgets();

  // v3.6.x：多桌面——切换联系人后刷新桌面外观（壁纸/自定义图标/打卡/摸鱼展示）。
  // store 是动态绑定当前联系人的，restoreAppIcons/applyBgVisibility 会读新桌面的值；
  // 打卡按钮状态按新桌面的 checkin 键重新判断。
  document.addEventListener('contact-switched', function () {
    try { applyBgVisibility(); } catch (e) {}
    try { restoreAppIcons(); } catch (e) {}
    // #769：底部导航栏图标/样式同为 per-cid 键——切桌面后按新命名空间重刷
    try { restoreTabbarIcons(); } catch (e) {} // #769h2 切桌面重刷底部栏
    // v3.10.x：切桌面后按新命名空间重应用卡片背景/页面背景/图片组件 + 直读兜底
    //（这些大图键只存 IndexedDB，切桌面瞬间 memoryCache 可能还没新桌面的值）
    // FIX 2026-09-17 #695：主页不可见（切桌面后直接进了聊天）时改登记待办、主页真正
    //   显示前补跑；refreshDeskVisuals 内含的 syncBgUI 是设置页壁纸 UI（与主页可见性
    //   无关，跨桌面后必须读到新桌面的值），延后时当场补跑一次。
    if (whenDeskVisible(refreshDeskVisuals)) { try { syncBgUI(); } catch (e) {} }
    try { rescueDeskVisuals(); } catch (e) {}
    // v3.6.x：小组件三色（背景/边框/按钮）按桌面独立——切换后重新应用新桌面的值
    try { applyWidgetColor(store.get('widget-bg-color') || '#ffffff'); } catch (e) {}
    try { applyWidgetBorder(store.get('widget-border-color') || 'rgba(0,0,0,.1)'); } catch (e) {}
    try { applyWidgetBtn(store.get('widget-btn-color') || '#111111'); } catch (e) {}
    try { applyWidgetBtnText(store.get('widget-btn-text-color') || '#ffffff'); } catch (e) {}
    try { applyWidgetHeart(store.get('widget-heart-color') || '#111111'); } catch (e) {}
    // FIX 2026-09-04 #151：透明度等美化键按桌面独立，但 CSS 变量挂在 documentElement
    // 全局——此前切到「没有该键」的桌面时跳过应用，上一桌面的值残留 → 切回桌面小组件
    // 变透明/隐身（opacity 元素不可见但仍可点中）、不同桌面显示互相串。缺键必须复位默认。
    try { const op = store.get('widget-opacity'); if (op) { const opPct = opacityRawToPct(op); if (!isNaN(opPct)) applyWidgetOpacity(opPct); } else applyWidgetOpacity(100); } catch (e) {} // #146：兼容历史小数脏值（切桌面重应用）
    try { applyIcoRadius(getIcoRadius()); } catch (e) {}
    // FIX 2026-09-04 #151：背景模糊/遮罩/卡片圆角同族——按桌面重应用，缺键走各自 getter 默认值
    try { applyBgBlur(getBgBlur()); } catch (e) {}
    try { applyBgMaskOp(getBgMaskOp()); } catch (e) {}
    try { applyCardRadius(getCardRadius()); } catch (e) {}
    try {
      const btn = document.querySelector('.checkin .ck-btn');
      if (btn) {
        if (store.get('checkin') === fishToday()) {
          btn.textContent = '✓ 已打卡';
          btn.classList.add('done');
        } else {
          btn.textContent = '打卡';
          btn.classList.remove('done');
        }
      }
    } catch (e) {}
    try {
      const cnt = document.getElementById('weekend-count');
      if (cnt) cnt.textContent = String(dayVal('fish-total'));
    } catch (e) {}
    // v3.6.x：摸鱼天数 / 恋爱纪念日 / 今日情话 / 其他纪念日列表——初始化只跑一次，
    // 切换联系人后必须按新桌面的 store 重新渲染（store 动态绑定当前联系人）
    try { updateFishDays(); } catch (e) {}
    try { updateLove(); } catch (e) {}
    try { syncRelUI(); } catch (e) {}
    try { renderQuoteOfDay(); } catch (e) {}
    try { renderExtras(); } catch (e) {}
    try { renderDeskWidgets(); } catch (e) {}
    // v3.6.x：桌面双方昵称（lbl-user / lbl-partner）只在加载时写一次，
    // 切换联系人后必须按新桌面的 store 重新渲染，否则残留上一个联系人的名字
    // （新联系人未设昵称时回退默认「我 / TA」）
    try {
      const lu = document.getElementById('lbl-user');
      if (lu) { const v = store.get('lbl-user'); lu.textContent = v || '我'; }
      const lp = document.getElementById('lbl-partner');
      if (lp) { const v = store.get('lbl-partner'); lp.textContent = v || 'TA'; }
    } catch (e) {}
  });
})();