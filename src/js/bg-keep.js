// ===== 功能：后台保活 + 后台通知（仿星言简约版） =====
// 后台保活：播放近静音音频（1 秒循环正弦波；安卓 18000Hz / iOS 220Hz，幅度 0.006/0.002
//           × volume 0.05 ≈ 数字 -70/-80dBFS）保持页面定时器活跃，
//           并请求屏幕常亮（wakeLock），防止浏览器后台休眠导致消息/回复停止；
//           首次交互时恢复 AudioContext（浏览器自动播放策略要求）。
// 后台通知：开启后，页面不在前台时收到 TA 的新消息会弹出浏览器通知。
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  // v3.9.x：后台保活 / 后台通知是【系统级】设置（位于全局设置页 #page-setting），
  // 但原先按当前联系人桌面存储（activeStore）——切换桌面或系统恢复页面时 active-contact
  // 指向别的桌面，开关就会显示成「关」（用户自述：挂机几小时后回来看「后台保活自己关了」，
  // 导致夜里系统通知不弹）。改为存全局命名空间，读时回退旧版每桌面值完成迁移。
  const GNS = 'xy-home-v2';
  function gGet(k) {
    try { const v = window.xyStore ? window.xyStore(GNS).get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
    try { return store.get(k); } catch (e) { return null; }
  }
  function gSet(k, v) {
    try { if (window.xyStore) window.xyStore(GNS).set(k, v); } catch (e) {}
  }
  function toast(msg, dur) {
    let t = document.getElementById('cc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cc-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    // #921e：动画时长先落、再加 .show——原顺序先加类后改 animationDuration，个别内核会在
    // 动画已启动后重映射时长＝起帧抖动；先定时长再起动画，起帧稳定。
    t.style.animationDuration = (dur || 2600) + 'ms';
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    // #724 驻留真生效：#cc-toast.show 的 CSS 动画固定 2.6s forwards，88% 处才开始淡出，
    // 内联 animationDuration 随 dur 覆盖 CSS 固定值（#708 多行驻留语义不变）。
    // FIX 2026-09-20 #921e 隐藏只走一条时间轴——原 JS 定时器默认 2000ms 早于动画 88% 驻留点
    // （2288ms）先掐 .show＝动画中途被取消，取消瞬跳与 .25s 过渡叠加，安卓多机型实报
    // 黑胶囊「一直闪屏、内容没看清」（主线程一卡定时器成批延迟触发更明显）。现在正常隐藏
    // 由 CSS 动画 100% 淡出完成（forwards 钉住透明度），JS 定时器只在动画结束后 +250ms
    // 兜底摘类，正常路径不再中途取消动画。元素级内联样式只影响本模块调用，不碰全局 toast CSS。
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, (dur || 2600) + 250);
  }

  // ===== v3.44.x：保活音频可换（默认静音音频 / 用户上传自定义音频）=====
  // 用户反馈：保活音频会占用手机音频通道、影响其他 App 的声音。
  // 让用户能换一段自己的音频（白噪音 / 助眠声，或一段更彻底的静音文件）。全部存全局根键：
  // __ka-audio（dataURL，xyStore 超 200KB 自动只进 IDB）＋ __ka-audio-on / __ka-audio-name
  // （小键）。__ 前缀在 contacts.js isExcluded 内，不会被 migrateLegacy 误迁进 default。
  let kaCustomAudio = null;
  let kaCustomAudioName = '';
  function kaCustomOn() { try { return gGet('__ka-audio-on') === '1'; } catch (e) { return false; } }
  function kaAudioLabel() { return (kaCustomAudio || kaCustomOn()) ? '自定义音频' : '默认静音音频'; }
  function kaApplyCustomAudio() {
    if (!kaCustomAudio || !keepAudio || !keepAudio.el) return;
    try {
      if (keepAudio.el.src !== kaCustomAudio) {
        keepAudio.el.src = kaCustomAudio;
        if (!musicNowPlaying()) {
          const p = keepAudio.el.play();
          if (p && p.catch) p.catch(function () {});
        }
      }
    } catch (e) {}
  }
  function kaLoadCustomAudio() {
    if (!kaCustomOn() || kaCustomAudio) return;
    try {
      if (!window.idbGet) return;
      window.idbGet(GNS + ':__ka-audio').then(function (v) {
        if (v && typeof v === 'string' && v.length > 10) {
          kaCustomAudio = v;
          try { kaCustomAudioName = gGet('__ka-audio-name') || ''; } catch (e) {}
          kaApplyCustomAudio();
          syncKaAudioUI();
        }
      }).catch(function () {});
    } catch (e) {}
  }
  function kaSetDefaultAudio() {
    kaCustomAudio = null;
    kaCustomAudioName = '';
    try {
      window.xyStore(GNS).remove('__ka-audio');
      window.xyStore(GNS).remove('__ka-audio-on');
      window.xyStore(GNS).remove('__ka-audio-name');
    } catch (e) {}
    if (keepEnabled && keepAudio && keepAudio.el) {
      try {
        keepAudio.el.src = ensureKeepAudioDataUrl();
        keepAudio.el.volume = KA_VOL_BASE; // #724：与启动档同源（原硬编码 0.05）
        if (!musicNowPlaying()) { const p = keepAudio.el.play(); if (p && p.catch) p.catch(function () {}); }
      } catch (e) {}
    }
    syncKaAudioUI();
    toast('已恢复默认静音音频');
  }
  function kaPickCustomAudio() {
    // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
    window.mochiFilePick({
      id: 'mochi-ka-audio-pick', accept: 'audio/*',
      onFiles: function (files) {
      const f = files && files[0];
      if (!f) { toast('没有取到音频，请再选一次'); return; }
      if (f.size > 3 * 1024 * 1024) toast('音频较大（>3MB），可能占用较多存储空间');
      toast('正在读取音频…');
      const r = new FileReader();
      r.onload = function () {
        kaCustomAudio = String(r.result || '');
        kaCustomAudioName = f.name || '自定义音频';
        try {
          window.xyStore(GNS).set('__ka-audio', kaCustomAudio);
          window.xyStore(GNS).set('__ka-audio-on', '1');
          window.xyStore(GNS).set('__ka-audio-name', kaCustomAudioName);
        } catch (e) {}
        if (keepEnabled && keepAudio && keepAudio.el) {
          try { keepAudio.el.volume = 1; } catch (e) {}
          kaApplyCustomAudio();
        }
        syncKaAudioUI();
        toast('已设为自定义保活音频（按原音量循环播放）');
      };
      r.onerror = function () { toast('音频读取失败'); };
      r.readAsDataURL(f);
      }
    });
  }
  function openKaAudioPicker() {
    if (!window.openModal) return;
    const pills = [
      { label: '默认静音音频', value: 'default' },
      { label: '上传自定义音频', value: 'upload' }
    ];
    if (kaCustomAudio || kaCustomOn()) pills.push({ label: '清除自定义', value: 'clear' });
    const hasCustom = !!(kaCustomAudio || kaCustomOn());
    const cur = kaAudioLabel() + (hasCustom && kaCustomAudioName ? '（' + kaCustomAudioName + '）' : '');
    const txt = '后台保活需要在后台持续播放一段音频来让页面保持运行。\n\n· 默认静音音频：内置生成、近乎无声，推荐。\n· 自定义音频：上传自己的音频（白噪音 / 助眠声，或更彻底的静音文件），按原音量循环播放。\n\n注意：任何持续播放的音频都会占用手机音频通道，可能影响其他 App 的声音（详见「后台保活」功能说明）。\n当前：' + cur;
    window.openModal('【保活音频】', '', function (v) {
      if (v === 'default' || v === 'clear') kaSetDefaultAudio();
      else if (v === 'upload') kaPickCustomAudio();
    }, { noInput: true, pillSubmit: true, staticText: txt, pills: pills });
  }

  // ================= 后台保活 =================
  let keepAudio = null;
  let keepInterval = null;
  let keepEnabled = false;
  let keepUserTouched = false; // v3.26.x #88：本会话用户手动动过保活开关 → 回填后不重读覆盖
  let wakeSentinel = null; // v3.5.131：模块级，供 stopKeepAlive 释放

  // v3.13.x：保活补播改指数退避——原来每 5 秒无条件 play() 抢回播放权，但安卓上网页
  // 音频与其他 App 共用系统音频焦点：被抢暂停后每 5 秒抢一次＝与对方无限拉锯（用户实测：
  // 开保活后别的 App 声音一直被打断；音乐播放器因补播带退避反而显得"能共存"）。
  // 新节奏：外部打断（pause 事件）按连击退避排期 5s→10s→20s→…→60s 封顶，被音频自己
  // 打断且连续 N 次时同样退避；补播失败自动翻倍续期。稳定播放够久才复位连击。回前台
  // 自愈立即清零。测试可覆盖 window.__kaRetryBaseMs / __kaRetryMaxMs / __kaStableMs。
  let kaTimer = null;     // 排中的退避补播定时器
  let kaDelay = 0;        // 下一次补播间隔 ms；0=不在退避轨道
  let kaPauseStreak = 0;  // 连续被打断次数（稳定播放一段时间后清零）
  let kaLastPlayAt = 0;   // 最近一次 play() 被接受的时间（音频跑起来后刷新）
  let kaPlayFailStreak = 0; // 连续 play() 被拒次数（补播一直失败时翻倍退避，不无限撞墙）
  function kaCfg() {
    let base = 5000, max = 60000;
    try { if (typeof window.__kaRetryBaseMs === 'number') base = Math.max(1, window.__kaRetryBaseMs); } catch (e) {}
    try { if (typeof window.__kaRetryMaxMs === 'number') max = Math.max(1, window.__kaRetryMaxMs); } catch (e) {}
    return { base: base, max: Math.max(base, max) };
  }
  function kaStableMs() {
    try { if (typeof window.__kaStableMs === 'number') return Math.max(1, window.__kaStableMs); } catch (e) {}
    return 90000;
  }
  // 排一次退避补播。delayMs 缺省按连击次数指数化（1st=base, 2nd=2*base…封顶 max）。
  // 已有排程不重复排。测试探针：window.__kaNextDelayMs 返回当前将用的间隔。
  function kaSchedule(delayMs) {
    if (!keepEnabled || kaTimer) return;
    const cfg = kaCfg();
    if (!delayMs) {
      kaPauseStreak++;
      delayMs = Math.min(cfg.base * Math.pow(2, Math.min(kaPauseStreak - 1, 10)), cfg.max);
    }
    // FIX 2026-09-04 #153 Chromium 139 起安卓后台页面冻结从 5 分钟缩到 1 分钟（stop-in-background，
    // Chrome for Android 139 / Edge 等内核跟进）——保活音频暂停超过冻结线页面即被整个冻结
    // （定时器全停=后台消息/通知全停）。页面隐藏期间补播退避封顶 20s（前台仍 60s 不变，
    // 不回归 v3.13.x 音频拉锯修复）：保证冻结线内至少 2~3 次重试，音频焦点一让位就能恢复
    // 「正在播放」豁免躲过冻结。
    if (document.visibilityState === 'hidden' && delayMs > 20000) delayMs = 20000;
    kaDelay = delayMs;
    window.__kaNextDelayMs = delayMs; // 回归探针
    kaTimer = setTimeout(function () {
      kaTimer = null;
      if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) { kaDelay = 0; return; }
      if (!keepAudio.el.paused) { kaDelay = 0; return; }
      const p = keepAudio.el.play();
      const after = function () {
        // 补播后仍在暂停（play 被拒/又被按住）→ 翻倍排下一次，封顶 max
        if (keepEnabled && keepAudio && keepAudio.el && keepAudio.el.paused && !musicNowPlaying()) {
          const c2 = kaCfg();
          kaSchedule(Math.min((kaDelay || c2.base) * 2, c2.max));
        }
      };
      if (p && p.then) p.then(after, after); else after();
    }, kaDelay);
  }
  function kaStopTimer() { if (kaTimer) { clearTimeout(kaTimer); kaTimer = null; } kaDelay = 0; }
  function kaResetBackoff() { kaStopTimer(); kaPauseStreak = 0; kaPlayFailStreak = 0; }
  function kaMarkPlayed() { kaLastPlayAt = Date.now(); }

  // v3.10.x：与音乐播放器共存（修复「音乐+保活音频同时出声导致音乐卡顿」）——
  // 手机端两个 <audio> 同时持续输出时，混音/音频焦点互相争抢；保活音频每 5 秒的
  // 补播重试还会与 music-player 自身的防暂停补播形成拉锯，表现为音乐周期性卡顿。
  // 策略：音乐播放期间（window.__musicPlaying=true）保活音频主动让位暂停——
  // 音乐自带活跃媒体会话（playbackState=playing），后台同样不被冻结，保活目的不丢；
  // 音乐停止/暂停后自动把保活音频拉回来。
  function musicNowPlaying() {
    try { if (!window.__musicPlaying) return false; } catch (e) { return false; }
    // #780 实效核验：标志说「在播」时再看元素真值。ROM/浏览器静默掐掉音频流不必然触发
    // onpause ⇒ 标志卡在 true，而这里一卡就让位（主动 pause 保活音频），主豁免当场丢失、
    // 整页冻结——红米 Chrome 151 取证形态「音频=暂停 · 媒体条=playing」即此。读到元素
    // 明确 paused 才判「没在播」；拿不到只读出口时退回原语义（宁可让位，不回归 v3.10.x
    // 修的音频拉锯）。
    try {
      const m = window.__mochiMusic;
      if (m && m.el && m.el.paused === false) return true;
      if (m && m.el && m.el.paused === true) return false;
    } catch (e) {}
    return true;
  }
  function syncKeepForMusic() {
    if (!keepAudio || !keepAudio.el) return;
    try {
      if (musicNowPlaying()) {
        if (!keepAudio.el.paused) keepAudio.el.pause(); // 让位：音乐在播，保活音频暂停
      } else if (keepEnabled && keepAudio.el.paused) {
        // 音乐停止，收回保活音频：已在退避轨道就让排程接管；否则立即试播
        if (kaTimer || kaDelay) return;
        // #780：假死核验——标志仍在播而元素已停、且用户播放意图还在，替它推一把。
        // 本模块只有只读出口，不推的话音乐一直不响、保活音频却已接管（媒体条挂着已暂停的歌）。
        // want() 为假＝用户主动暂停，绝不越权恢复。
        try {
          const m = window.__mochiMusic;
          if (window.__musicPlaying && m && m.el && m.el.paused && m.want && m.want()) m.el.unpause();
        } catch (e) {}
        const p = keepAudio.el.play();
        if (p && p.catch) p.catch(function () {});
        // v3.17.x：音乐停止/暂停后把媒体条接管回「Mochi 后台保活」——
        // 音乐暂停瞬间保活音频拉回，但媒体条 metadata 仍是歌曲（title=歌名），
        // 通知栏媒体条显示"已暂停的歌曲"甚至消失；这里立即重设保活条
        setKeepMediaSession();
      }
    } catch (e) {}
  }
  // 监听 music-player 对 __musicPlaying 的写入（onplay/onpause/updateMediaSession 维护，
  // 该文件先于本模块加载、只在播放事件时写）——音乐起播瞬间立即让位、停止瞬间立即收回，
  // 不等下一个 5 秒轮询。getter/setter 透传，对其他读取方完全透明。
  (function installMusicPlayingWatcher() {
    try {
      let v = !!window.__musicPlaying;
      Object.defineProperty(window, '__musicPlaying', {
        configurable: true,
        get: function () { return v; },
        set: function (nv) {
          nv = !!nv;
          if (nv === v) return;
          v = nv;
          setTimeout(syncKeepForMusic, 0);
        }
      });
    } catch (e) {}
  })();

  // v3.5.160：保活音频 dataURL——用 <audio> 元素循环播放（不是 Web Audio 振荡器）。
  // 关键机制：Chrome 安卓的媒体通知条（通知栏"正在播放"）绑定到 HTMLMediaElement
  // （<audio>/<video>），Web Audio 的 AudioContext 振荡器【不触发媒体条】——这正是
  // 之前"音乐能显示媒体条、保活看不到"的原因。改用 <audio> 后媒体条正常显示、
  // 后台不冻结。合成 1 秒极轻正弦波 WAV（220Hz）。
  // v3.15.x：幅度按平台自适应——原固定幅度 0.02 × volume 0.05 ≈ -60dBFS，是按安卓
  // Chrome「近零音量会被无声检测节流」调的下限；但 iPhone 扬声器灵敏、夜间环境安静，
  // 实听是明显的周期性「嘟嘟嘟嘟」（1 秒 loop 接缝 + 持续低频纯音），用户报修
  // 「不是静音音频」。iOS 无安卓那套无声节流，保活只要求「有非零样本在播」：
  // iOS 把幅度降到 ±3 LSB 级（0.002 × 0.05 ≈ -80dBFS，任何扬声器物理不可闻，
  // 但样本非零不构成数字静音）；安卓同型问题多机型复发（#190：OPPO Find X9 自带浏览器 HeyTapBrowser 等「一进网页就有底噪/电流声」）——220Hz 低频纯音在人耳最敏感频段、循环常播，-60dBFS 在灵敏扬声器上实听即持续嗡声，说明 0.02 下限过高；降为 0.006（×0.05 音量 ≈ -88dBFS，物理不可闻）：防无声节流要的是「样本非零 + volume>0」（浏览器静音检测按零样本/静音状态判定，不按响度），非零即保活有效；若保活因此失效（后台被冻结）再回调上限并换其他豁免信号，不回 220Hz 大音量（原安卓幅度 0.02）。
  // #724 保活音量余量分级（18kHz 频率继续扛「物理不可闻」，数字电平只加余量不加响度）：
  // 红米 K80 Chrome 等新内核再次收紧 audible 判定（#260 在 Chromium 152 已收过一次：
  // 0.02×0.05=0.001 的 4 倍余量仍可能被判「无声」→ 播放豁免丢失 → 后台整页被冻结/丢弃，
  // 用户实报「挂一会后台、点回来页面被刷新」＝标签被丢弃重载的直接形态）。基础档
  // 0.02×0.2=0.004（-48dBFS，18kHz 经手机扬声器高频天然滚降 20~40dB 后物理不可闻，
  // #207 结论不变）；心跳断流取证命中一次即升 KA_VOL_MAX=0.35（-43dBFS）仍不可闻。
  // iOS 分支 amp 0.002 且 WebKit 忽略 <audio>.volume（#340），完全不受影响；自定义音频仍 volume=1。
  const KA_VOL_BASE = 0.2, KA_VOL_MAX = 0.35;
  let KEEP_AUDIO_DATAURL = '';
  // v3.26.x 收口第二批：iOS 判定改读唯一判定源 device.js（mochiDevice.isIOS，
  // 含 iPadOS Macintosh 伪装分支 #144）——此前这里自拼一份 UA 正则 + 伪装检测，
  // 与 device.js 各算一遍（v3.16.x 收口漏网的角落，device.js 判定规则升级时
  // 这里会被漏掉）。保留函数名薄壳：#207 哨兵/verify-keep-audio 按函数抽取。
  function kaIsIOS() {
    try { return !!(window.mochiDevice || {}).isIOS; } catch (e) {}
    return false;
  }
  // FIX 2026-09-20 #924：隐藏期被外部 App 抢走音频焦点时不再回抢（WebKit 能力分支，
  // 同文件保活音频频率的 iOS 分支同款先例；零机型分支）。iPhone 上切去刷视频/听歌，
  // 系统把音频焦点交给对方并暂停保活音频；原实现随后（pause 事件退避补播 / 5s 心跳
  // 排补播 / 切后台瞬间立即补播）仍回抢 play()＝每次都把对方 App 的声音截停（iPhone
  // 16 Plus 实报「开着保活刷视频总被截停」，#901 退避只减轻未根治的残余）。iOS 无
  // Chromium「音频暂停约 1 分钟冻结页面」机制，回抢没有任何保活收益、只有打扰：
  // 隐藏期被外部打断就让位；回前台 healKeepAlive 既有路径照常拉回。安卓 Chromium 的
  // 冻结线依赖音频持续在播，三个补播口子全部保持原行为零改动。
  function kaYieldStealFocus() {
    return kaIsIOS() && document.visibilityState === 'hidden';
  }
  function ensureKeepAudioDataUrl() {
    if (KEEP_AUDIO_DATAURL) return KEEP_AUDIO_DATAURL;
    try {
      const sr = 44100, sec = 1, n = sr * sec;
      // #190：安卓 0.02 → 0.006（原值实听底噪，见上方注释；iOS 维持 0.002）
      // #260：0.006 恢复回 0.02——#190/#207 的底噪根因在 220Hz 频率（#207 已换 18kHz：
      // 人耳对 18kHz 基本无感 + 手机外放高频天然滚降 20~40dB，幅度回调不触发底噪回潮），
      // 而 0.006×0.05=0.0003 距 Chromium audible 判定线仅 20% 余量，Edge/Chromium 152
      // 起判定一收紧（按响度/频带）豁免即丢=后台 1 分钟冻结（vivo X200s Edge 152 实报，
      // 「以前可以」时代正是 0.02×0.05=0.001）。18kHz@0.02 恢复 4 倍电平余量，听感语义
      // 不变（18kHz 上线后无底噪投诉）；iOS 220Hz@0.002 维持 bit 级不动。
      const amp = kaIsIOS() ? 0.002 : 0.02;
      // #207：安卓频率 220Hz → 18000Hz——#190 降幅度后 OPPO R15 自带浏览器（HeyTapBrowser）
      // 等多机型仍报「后台保活有电流声，不是静音音频」：220Hz 落在人耳最敏感低频段，
      // -70dBFS 数字电平在老机型功放底噪/夜间安静环境实听仍是持续嗡声，降幅度已到头
      // （再降会跌破 Chromium audible 判定、保活失效）。保活只看「样本非零 + volume>0」：
      // Chromium 的 audible/无声节流按数字样本电平判定、与频率无关——18kHz 与 220Hz 同
      // 幅度 RMS 完全一致，保活有效性零变化；而人耳对 18kHz 基本无感 + 手机外放高频频响
      // 天然滚降 20~40dB（老机型更差），物理不可闻。18000×1s=整周期，循环接缝无相位跳变
      // （无咔哒声）；18000 < 22050 奈奎斯特且距 48k 重采样抗混叠滤波带有余量。
      // FIX 2026-09-12 #340 iOS 保活嗡鸣（iPhone 16 Pro Safari「打开一直震动响声，重启无用」）：
      // iOS 分支 220Hz@0.002 就是 #190/#207 在安卓上被投诉的同一根因（220Hz 落在人耳最敏感
      // 低频段），当时以「v3.15.x 已收敛」保留；且 iOS Safari 忽略 <audio>.volume（WebKit
      // 已知限制），volume=0.05 的压低在 iPhone 上完全不生效——iOS 实际电平 0.002 比安卓
      // 当年被投诉的 0.02×0.05=0.001 还大 4 倍，好扬声器机型实听持续嗡鸣（感知似震动）。
      // 保活开关持久化 → 每次打开自动恢复响，重启无用。修法与 #207 同根因：iOS 分支同改
      // 18000Hz（iOS 无 Chromium audible 节流判定，样本非零即可；循环接缝整周期性质不变），
      // 幅度分支 amp 不动=保活电平语义零变化。
      const freq = 18000;
      const buf = new ArrayBuffer(44 + n * 2);
      const dv = new DataView(buf);
      const ws = function (o, s) { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
      ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
      ws(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) {
        const v = Math.sin(2 * Math.PI * freq * (i / sr)) * amp;
        dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
      }
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      KEEP_AUDIO_DATAURL = 'data:audio/wav;base64,' + btoa(bin);
    } catch (e) { KEEP_AUDIO_DATAURL = ''; }
    return KEEP_AUDIO_DATAURL;
  }

  // v3.9.x：设置"后台保活"媒体会话条。音乐播放时（__musicPlaying）让位给 music-player
  // 的歌曲 metadata + 控制 handler，避免通知栏按钮空响应无法控制音乐。
  // v3.28.x：音乐「还有播放意图」（__musicWantPlay=true，仅被外部打断短暂暂停）时同样
  // 让位——否则一次后台瞬断就会把歌曲媒体条覆盖成「Mochi 后台保活」，音乐恢复后元数据
  // 不再回来，通知栏媒体条时有时无（Chrome 把页面当闲置标签冻结 → 音乐停播）。让位窗口内
  // 保活音频照常出声（页面持续输出音频，防冻结），歌曲条由 music-player 的 onplay 恢复。
  function musicIntentPlaying() { try { return !!window.__musicWantPlay; } catch (e) { return false; } }
  function setKeepMediaSession() {
    try {
      if (!('mediaSession' in navigator) || !navigator.mediaSession || !window.MediaMetadata) return;
      if (window.__musicPlaying) return; // 音乐在播，保留音乐的媒体条
      if (musicIntentPlaying()) return; // 音乐还想播（瞬断暂停中），不覆盖歌曲媒体条
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: 'Mochi 后台保活',
        artist: 'mochi',
        album: '后台消息提醒运行中'
      });
      // v3.5.159：声明 playbackState='playing'——Chrome 安卓判定"页面正在播放媒体"
      // 必须 playbackState=playing + 音频实际输出，否则媒体会话不激活、后台照常冻结
      try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
      try {
        navigator.mediaSession.setActionHandler('play', function () {});
        navigator.mediaSession.setActionHandler('pause', function () {});
      } catch (e) {}
    } catch (e) {}
  }

  // ================= #260：WebRTC 保活锚点（第二冻结豁免信号） =================
  // 保活音频只押「正在播放音频」这一个冻结豁免信号：0.006×0.05=0.0003 距 audible
  // 判定线仅 20% 余量，内核一收紧（vivo X200s Edge/Chromium 152 实报，「以前可以」）
  // 豁免即丢 → 页面 1 分钟冻结、后台消息/通知全停（#153 的补播钳制只能保证「音频被
  // 认定在播时」有效，豁免本身丢了它救不回）。页面生命周期规范的冻结豁免条件里
  // WebRTC 是与音频并列的另一条——这里建一对页内回环 RTCPeerConnection + 数据通道：
  // 全程本机回环（host candidate，无需 STUN/TURN、无外发流量）、无音频焦点、无声
  // 可听，与保活音频互为双锚（任一失效另一个仍在）。环境不支持则静默跳过，保活
  // 音频照旧；不做机型白名单。
  let kaPc1 = null, kaPc2 = null, kaWebrtcTimer = null;
  let kaCand1 = [], kaCand2 = [];
  // FIX 2026-09-13 #433 WebRTC 锚点「启动延迟 + 断连自愈窗 + 重建退避」（vivo Y78 自带浏览器
  //   等低端机「一进网站就非常卡」，实测帧率 2fps、每 ~2.2s 一个 2.1~2.4s 长任务，多机型同现）：
  //   实锤（无头 CPU 采样探针）：new RTCPeerConnection() 本身是重主线程操作——6x 节流的
  //   桌面核单次构造阻塞 ~1.5s（对应 1711/1887ms 长任务），低端安卓核放大到 ~2-2.5s，与
  //   真机诊断长任务尺寸完全吻合；#260 原来在 startKeepAlive 里**同步**建一对＝开屏关键
  //   路径上叠加两个秒级长任务。且 p1 瞬态 'disconnected'（ICE 例行重连，规范明示可恢复）
  //   也被当死亡立即拆+30s 重建＝网络抖动机型反复支付构造成本。改法（锚点能力不删，只改
  //   时机与节奏，防跨机型回归）：
  //   ① startKeepAlive 改 10s 后延迟建锚（保活音频/mediaSession/wakeLock 主锚点原样即时
  //     生效，WebRTC 只是第二豁免信号，晚到不回退 #260 的冻结防线；页面刚进前台也不冻结）；
  //   ② 'disconnected' 先给 8s 自愈观察窗，恢复即零成本，仍断才拆+排重建；
  //   ③ 重建间隔指数退避 30s→60s→…→15min 封顶，连接稳定满 5min 才复位——抖动机型
  //     不再每 30s 付一次构造成本；
  //   ④ 回前台补建（healKeepAlive）也走 3s 延迟——resume 瞬间主线程正忙（重渲/回填）。
  let kaWebrtcBootTimer = null;   // 启动延迟建锚定时器
  let kaWebrtcDiscTimer = null;   // disconnected 自愈观察窗定时器
  let kaWebrtcRebuildDelay = 0;   // 下次重建间隔 ms（指数退避轨道）；0=不在轨道
  let kaWebrtcOkAt = 0;           // 最近一次进入 connected 的时刻（稳定判定用）
  function kaWebrtcDeferredStart(delayMs) {
    if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
    kaWebrtcBootTimer = setTimeout(function () {
      kaWebrtcBootTimer = null;
      if (!keepEnabled || kaPc1 || kaPc2) return;
      // 已后台则不建：后台建锚同样阻塞主线程且无感知收益，回前台 healKeepAlive 兜底补建
      if (document.hidden) return;
      kaWebrtcStart();
    }, delayMs);
  }
  function kaWebrtcScheduleRebuild() {
    // 距上次 connected 稳定满 5min 才断＝环境性偶发，退避从头计；短命连接持续加码
    if (kaWebrtcOkAt && Date.now() - kaWebrtcOkAt > 300000) kaWebrtcRebuildDelay = 0;
    kaWebrtcRebuildDelay = kaWebrtcRebuildDelay ? Math.min(kaWebrtcRebuildDelay * 2, 900000) : 30000;
    if (keepEnabled && !kaWebrtcTimer) kaWebrtcTimer = setTimeout(function () {
      kaWebrtcTimer = null;
      // FIX 2026-09-14 #436 后台发热减负：重建对齐启动路径「已后台则不建」原则——后台构造
      // RTCPeerConnection 是秒级长任务（#433 实锤），回环锚点常驻 ICE consent 包也让射频
      // 无法深睡；音频主锚点在位时豁免不丢，页面真被冻结时定时器本就停摆跑不到这里＝
      // 后台重建纯付费。排程已清，回前台 healKeepAlive 兜底补建。
      if (!keepEnabled || document.hidden) return;
      kaWebrtcStart();
    }, kaWebrtcRebuildDelay);
  }
  function kaWebrtcStart() {
    if (kaPc1 || kaPc2) return;
    if (kaWebrtcTimer) { clearTimeout(kaWebrtcTimer); kaWebrtcTimer = null; }
    if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
    if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      const p1 = new RTCPeerConnection(), p2 = new RTCPeerConnection();
      p1.onicecandidate = function (e) { if (e.candidate) kaCand1.push(e.candidate); };
      p2.onicecandidate = function (e) { if (e.candidate) kaCand2.push(e.candidate); };
      p1.createDataChannel('mochi-ka');
      const wire = function (a, b) {
        return a.createOffer()
          .then(function (o) { return a.setLocalDescription(o); })
          .then(function () { return b.setRemoteDescription(a.localDescription); })
          .then(function () { return b.createAnswer(); })
          .then(function (ans) { return b.setLocalDescription(ans); })
          .then(function () { return a.setRemoteDescription(b.localDescription); });
      };
      // #780：等两端 ICE 采集完成再 flush。原实现在 setLocalDescription 刚落地的同一拍
      // 就 flush——而 gather 是异步的，那一刻 kaCand1/kaCand2 基本还是空的，两端都拿不到
      // 对端候选 ⇒ connectionState 恒 'new'、永不 connected（真机取证 WebRTC=new 即此，
      // 第二冻结豁免一直是死的）。3 秒兜底与 #673 给头像裁剪加截止同源：gather 卡住也要放行。
      const gathered = function (pc) {
        return new Promise(function (res) {
          let done = false;
          const fin = function () { if (!done) { done = true; res(); } };
          try { if (pc.iceGatheringState === 'complete') { fin(); return; } } catch (e) { fin(); return; }
          try {
            pc.addEventListener('icegatheringstatechange', function () {
              try { if (pc.iceGatheringState === 'complete') fin(); } catch (e) { fin(); }
            });
          } catch (e) { fin(); }
          setTimeout(fin, 3000);
        });
      };
      const flush = function () {
        try { for (let i = 0; i < kaCand2.length; i++) p1.addIceCandidate(kaCand2[i]); } catch (e) {}
        try { for (let i = 0; i < kaCand1.length; i++) p2.addIceCandidate(kaCand1[i]); } catch (e) {}
      };
      wire(p1, p2)
        .then(function () { return Promise.all([gathered(p1), gathered(p2)]); })
        .then(flush)
        .catch(function () { kaWebrtcStop(); kaWebrtcScheduleRebuild(); });
      p1.onconnectionstatechange = function () {
        const st = p1.connectionState;
        if (st === 'connected') {
          kaWebrtcOkAt = Date.now();
          if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
          return;
        }
        if (st === 'disconnected') {
          // FIX 2026-09-13 #433：瞬态断连先观察 8s（ICE 例行自愈，规范可恢复），
          // 恢复则零成本；仍断才拆+退避重建。原逻辑立即拆+30s 固定重建＝抖动机型反复卡
          if (kaWebrtcDiscTimer) return;
          kaWebrtcDiscTimer = setTimeout(function () {
            kaWebrtcDiscTimer = null;
            if (!kaPc1) return;
            const s2 = kaPc1.connectionState;
            if (s2 === 'connected') { kaWebrtcOkAt = Date.now(); return; }
            kaWebrtcStop();
            kaWebrtcScheduleRebuild();
          }, 8000);
          return;
        }
        if (st === 'failed' || st === 'closed') {
          kaWebrtcStop();
          kaWebrtcScheduleRebuild();
        }
      };
      kaPc1 = p1; kaPc2 = p2;
    } catch (e) {}
  }
  function kaWebrtcStop() {
    if (kaWebrtcTimer) { clearTimeout(kaWebrtcTimer); kaWebrtcTimer = null; }
    if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
    if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
    try { if (kaPc1) kaPc1.close(); } catch (e) {}
    try { if (kaPc2) kaPc2.close(); } catch (e) {}
    kaPc1 = kaPc2 = null;
    kaCand1 = []; kaCand2 = [];
  }

  // ================= #260：后台心跳（冻结取证） =================
  // 「保活到底有没有生效」不再靠用户口述猜：页面隐藏期间每 30s 往 IDB 写一笔心跳
  // （次数 + 最近 8 拍时间戳），回前台补记 resumed。device.js 诊断的【保活现场】直接
  // 读 window.__kaProbe()：相邻拍间隔 >90s=心跳断流=页面真被冻结的实锤，修复有没有
  // 效下次诊断见分晓。心跳只在开保活的本会话切过后台时才有记录（回前台即停表）。
  const KA_HB_KEY = 'xy-home-v2:__ka-hb';
  let kaHbTimer = null;
  let kaHb = null;
  function kaHbTick() {
    if (!kaHb) return;
    kaHb.n++;
    kaHb.ts = Date.now();
    try { kaHb.trail.push(kaHb.ts); if (kaHb.trail.length > 8) kaHb.trail.shift(); } catch (e) {}
    try { if (window.idbSet) window.idbSet(KA_HB_KEY, kaHb); } catch (e) {}
  }
  function kaHbStart() {
    if (kaHbTimer) return;
    kaHb = { n: 0, hid: Date.now(), ts: Date.now(), resumed: 0, trail: [] };
    kaHbTick();
    kaHbTimer = setInterval(kaHbTick, 30000);
  }
  function kaHbStop() {
    if (kaHbTimer) { clearInterval(kaHbTimer); kaHbTimer = null; }
  }
  // #724 保活失效取证计数（持久化，诊断【保活现场】与测试按钮展示）：stall=心跳断流次数
  // （隐藏期定时器停摆过＝冻结/丢弃实锤，页面即便活着回来也算）；died=后台会话暴毙次数
  // （上个会话没能活着回来＝标签被系统丢弃/杀掉，回来自动重载＝「点回来页面被刷新」）。
  // 历史累计、跨会话保留，零机型分支——「保活到底有没有生效」从口述猜变成有数可查。
  // #961：kaEv 增 rolling 回收时间表（diedAt，最多 10 条）——「近两天回收几次」要靠它，
  // 只在总数上判断会让老设备的累计值永远触发升级提醒。
  let kaEv = { stall: 0, died: 0, diedAt: [] };
  try {
    const _evSaved = gGet('__ka-ev');
    if (_evSaved && String(_evSaved).charAt(0) === '{') {
      const _ev = JSON.parse(_evSaved);
      if (_ev && typeof _ev === 'object') kaEv = Object.assign(kaEv, _ev);
    }
  } catch (e) {}
  function kaEvSave() { try { gSet('__ka-ev', JSON.stringify(kaEv)); } catch (e) {} }

  // ===== #961 通用会话存活标记（不依赖保活/通知开关）=====
  // 背景：iOS 内存紧张时会把整个 WebContent 回收，用户切回来看到的就是「白屏/重新加载」——
  // 旧实现只在开着保活时靠后台心跳察觉（kaLivenessOn 门控），没开保活的用户永远得不到解释，
  // 而 17PM 实报「严重时聊天完全白屏动不了」正是这一类（该机累计被回收 43 次）。
  // 标记极小：切后台/离开时写 {t, closed}；下次启动若上次不是正常收尾且时间很近 ⇒ 记一次回收。
  const SESS_KEY = '__sess-alive';
  function sessMark(closed) { try { gSet(SESS_KEY, JSON.stringify({ t: Date.now(), closed: !!closed })); } catch (e) {} }
  function sessBootCheck() {
    try {
      const prev = JSON.parse(gGet(SESS_KEY) || 'null');
      if (prev && typeof prev.t === 'number' && !prev.closed && (Date.now() - prev.t) < 30 * 60 * 1000) {
        kaEv.died++;
        kaEv.diedAt = kaEv.diedAt || [];
        kaEv.diedAt.push(Date.now());
        if (kaEv.diedAt.length > 10) kaEv.diedAt.shift();
        kaEvSave();
        kaDiedNotice = true;
      }
    } catch (e) {}
    sessMark(false);
  }
  try { window.addEventListener('pagehide', function () { sessMark(true); }); } catch (e) {}
  try { document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') sessMark(false); }); } catch (e) {}
  // 独立监听器（#153 的 hidden 监听器在音频播放中会提前 return，语义不同不共用）
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (!keepEnabled) return;
      kaHbStart();
    } else {
      if (kaHb) {
        kaHb.resumed = Date.now();
        // #724 断流取证：隐藏期最后一拍距回前台 >90s＝中途定时器停摆过（冻结/丢弃），计一次
        // 并把保活音量升到 KA_VOL_MAX（余量自愈一档、本会话不回改；iOS 忽略 volume 不受影响）
        if (kaHb.ts && kaHb.resumed - kaHb.ts > 90000) {
          kaEv.stall++; kaEvSave();
          try { if (keepAudio && keepAudio.el && !kaCustomAudio) keepAudio.el.volume = KA_VOL_MAX; } catch (e) {}
          // #977 长后台失效当面提示（用户直派「当后台长时间挂着，功能会失效，需要重新关掉网页
          //   打开并重新打开功能」）：心跳断流＝这段后台里页面被系统冻结过，保活/后台弹窗在这段
          //   时间实际停摆。只在「本次后台挂满 10 分钟且发生过冻结」的回前台提示一次（短冻结高频，
          //   弹了反而吵）；恢复方法口径与 #bg-keep-sub 红条 / 功能说明胶囊一致。
          if (kaHb.hid && kaHb.resumed - kaHb.hid >= 600000) {
            toast('⚠ 挂后台太久，保活被系统冻结截断过\n这段时间的后台消息/后台弹窗可能失效（回本页已自动恢复）\n经常失效：彻底关闭网页重新打开，再把「后台保活」「后台弹窗」开关重新打开', 6000);
          }
        }
        try { if (window.idbSet) window.idbSet(KA_HB_KEY, kaHb); } catch (e) {}
      }
      kaHbStop();
    }
  });
  // #724 上个会话「暴毙」取证：启动时读到的心跳记录若无 resumed（没回过前台）也无 bye
  // （pagehide 告别标记）＝上个后台会话没能活着回来。pagehide 在关标签/导航时会触发、
  // 进程被杀/标签被丢弃时不会触发，恰好构成「有序结束 vs 暴毙」的判别（bye 标记只在
  // kaHb 存在的本会话写，避免把用户开着没用保活的会话误记成保活失效）。
  // FIX 2026-09-21 #1001：这条实锤以前只有诊断里有数（测试按钮 / 信息诊断），用户侧零解释——
  //   而「挂后台被系统丢弃重载」正是最容易被当成 bug 的设备限制（回来自动重载＝「页面自己刷新了」，
  //   这段时间后台消息/弹窗本来就不存在）。本批把「上个后台会话暴毙」当面讲清：只在两个开关
  //   开着（＝用户确实指望后台收消息）且页面在前台、开屏已关时提示一次，12h 冷却防唠叨。
  try {
    sessBootCheck(); // #961：通用存活标记启动判定（含正常收尾标记，与保活开关无关）
    if (window.idbGet) window.idbGet(KA_HB_KEY).then(function (old) {
      if (old && old.n > 0 && !old.resumed && !old.bye) {
        kaEv.died++; kaEvSave();
        kaDiedNotice = true;
        tryShowKaDiedNotice();
      }
    }).catch(function () {});
  } catch (e) {}
  window.addEventListener('pagehide', function () {
    if (!kaHb) return;
    kaHb.bye = 1;
    try { if (window.idbSet) window.idbSet(KA_HB_KEY, kaHb); } catch (e) {}
  });

  // ===== FIX 2026-09-21 #1001：把两条「设备/权限限制」当面讲清（用户总当成 bug 的两类）=====
  //   A. 上个后台会话被系统丢弃/关闭（页面被重载）——见上面 kaDiedNotice；
  //   B. 「后台通知」开关开着但权限还没给（#988 起这种状态开关会保持开启、不再弹回）——
  //      开关亮着却不弹窗，用户最容易报「功能坏了」，其实只是还没允许通知。
  //   两条都只在「用户确实开着保活/通知」且页面在前台、开屏已关（#900 教训：开屏 z-999 之下
  //   弹＝弹在看不见的地方）时提示；各自 12h 冷却，避免唠叨。
  let kaDiedNotice = false;
  let kaPermNoticeArmed = false;
  function kaLivenessOn() {
    // try 包住：notifyEnabled 在文件更后面才声明（同一 IIFE 内同步执行完毕后才会有异步回调），
    // 万一某条路径提前跑到这里，读未初始化变量会抛 TDZ——按「没开」处理即可，不必崩
    try { return !!keepEnabled || !!notifyEnabled; } catch (e) { return false; }
  }
  function kaNoticeCool(key, ms) {
    try { const t = Number(gGet(key)) || 0; return t > 0 && (Date.now() - t) < ms; } catch (e) { return false; }
  }
  function kaNoticeStamp(key) { try { gSet(key, String(Date.now())); } catch (e) {} }
  // 开屏关掉（或用户已在应用内）时执行一次——冷启动时开屏正盖着，直接弹等于没弹
  function kaNoticeAfterSplash(fn) {
    try {
      if (chanSplashGone()) { fn(); return; }
      const s = document.getElementById('splash');
      if (!s) { fn(); return; }
      let done = false;
      let mo = null, moBody = null, tmr = null;
      const cleanup = function () {
        done = true;
        try { if (mo) mo.disconnect(); } catch (e) {}
        try { if (moBody) moBody.disconnect(); } catch (e) {}
        try { if (tmr) clearTimeout(tmr); } catch (e) {}
      };
      const fire = function () { if (done) return; cleanup(); try { fn(); } catch (e) {} };
      if (typeof MutationObserver === 'function') {
        mo = new MutationObserver(function () { if (chanSplashGone()) fire(); });
        try { mo.observe(s, { attributes: true, attributeFilter: ['class', 'hidden'] }); } catch (e) {}
        moBody = new MutationObserver(function () { if (!s.isConnected) fire(); });
        try { moBody.observe(document.body, { childList: true }); } catch (e) {}
      }
      // 兜底：90s 还没进页就作废（不当着开屏弹、也不留到很晚才突然弹）
      tmr = setTimeout(cleanup, 90000);
    } catch (e) { try { fn(); } catch (e2) {} }
  }
  // #961 升级：①不再要求「开着保活/通知」才提示——回收是系统行为、谁都可能遇到；
  // ②文案讲人话（内存不够→系统关掉页面→白屏/重试，不是网站坏了、不丢数据）并给两条具体方法；
  // ③回收频繁（近两天 ≥3 次或累计 ≥10 次）时升级为顶部警告条（可点，跳设置去清）＋ 24h 冷却，
  // 平时仍是 12h 冷却的一次 toast，避免唠叨。
  function showMemWarnBar(total, recent) {
    try {
      if (document.getElementById('mem-warn-bar')) return;
      const b = document.createElement('div');
      b.className = 'ver-update-bar';
      b.id = 'mem-warn-bar';
      b.style.cursor = 'pointer';
      b.innerHTML = '<span class="vub-txt"></span><b>去看怎么清</b>';
      b.querySelector('.vub-txt').textContent = '手机内存不够，系统已把本站关掉重载 ' + total + ' 次（近两天 ' + recent + ' 次）——白屏/重开就因为这个，不是网站坏了';
      b.addEventListener('click', function () {
        try {
          const t = document.querySelector('.tabbar .tab[data-page="page-setting"]');
          if (t) t.click();
          setTimeout(function () {
            try {
              const tg = document.querySelector('#set-tabs .them-tab[data-sec="tools"]');
              if (tg) tg.click();
            } catch (e) {}
            setTimeout(function () {
              try { const r = document.getElementById('row-storage-view'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'center' }); } catch (e) {}
            }, 300);
          }, 350);
        } catch (e) {}
      });
      (document.body || document.documentElement).appendChild(b);
      setTimeout(function () { try { b.hidden = true; } catch (e) {} }, 60000); // 60s 自动收起，不常驻
    } catch (e) {}
  }
  function tryShowKaDiedNotice() {
    if (!kaDiedNotice) return;
    try { if (document.visibilityState !== 'visible') return; } catch (e) { return; }
    const total = kaEv.died || 0;
    const recent = (kaEv.diedAt || []).filter(function (t) { return Date.now() - t < 48 * 3600 * 1000; }).length;
    if (recent >= 3 || total >= 10) {
      if (kaNoticeCool('__ka-mem-note-at', 24 * 3600 * 1000)) { kaDiedNotice = false; return; }
      kaDiedNotice = false;
      kaNoticeStamp('__ka-mem-note-at');
      kaNoticeAfterSplash(function () { showMemWarnBar(total, recent); });
      return;
    }
    if (kaNoticeCool('__ka-died-note-at', 12 * 3600 * 1000)) { kaDiedNotice = false; return; }
    kaDiedNotice = false;
    kaNoticeStamp('__ka-died-note-at');
    toast('⚠ 系统刚把本站整个关掉过一次（手机内存不够时 iOS 会这样做）——所以切回来会白一下、重新加载。这不是网站坏了，也不会丢数据。想少发生：①设置→系统 关掉「后台保活」②设置→工具→「查看存储」清掉最占地方的一项。');
  }
  function nbPermPendingNotice() {
    try { if (!notifyEnabled) return; } catch (e) { return; }
    try { if (nbPermState() !== 'default') return; } catch (e) { return; }  // 已授权/已拒绝都不提示
    if (kaNoticeCool('__nb-perm-note-at', 12 * 3600 * 1000)) return;
    try { if (document.visibilityState !== 'visible') return; } catch (e) { return; }
    kaNoticeStamp('__nb-perm-note-at');
    toast('⚠「后台通知」开关开着，但浏览器还没给通知权限\n地址栏左侧图标 → 网站设置 → 通知 → 允许（没允许之前，后台消息不会弹窗）\n这是权限限制，不是开关坏了', 7000);
  }
  try {
    if (kaDiedNotice) kaNoticeAfterSplash(tryShowKaDiedNotice);
    // 权限待决：给 #921g 说的「瞬态误读」留出恢复时间，20s 后复查仍是 default 才提示
    setTimeout(function () { kaPermNoticeArmed = true; kaNoticeAfterSplash(nbPermPendingNotice); }, 20000);
  } catch (e) {}

  // #260：诊断出口——device.js「保活现场」行消费（诊断在用户操作时生成，与加载顺序无关）
  window.__kaProbe = function () {
    let audio = null, ms = null;
    try { audio = keepAudio && keepAudio.el ? { paused: !!keepAudio.el.paused, volume: keepAudio.el.volume, loop: !!keepAudio.el.loop } : null; } catch (e) {}
    try { ms = ('mediaSession' in navigator && navigator.mediaSession) ? { metadata: !!navigator.mediaSession.metadata, state: navigator.mediaSession.playbackState } : null; } catch (e) {}
    // #780：把「保活音频被谁按住」摊开——取证曾见「音频=暂停 而 媒体条=playing」互相矛盾，
    // 现有字段判不出是 __musicPlaying 标志假死还是元素真停了，四项一起交即可分辨。
    let music = null;
    try {
      const m = window.__mochiMusic;
      music = {
        flag: !!window.__musicPlaying,
        paused: m && m.el ? !!m.el.paused : null,
        want: m && m.want ? !!m.want() : null,
        strict: musicNowPlaying()
      };
    } catch (e) {}
    return {
      keep: keepEnabled,
      notify: notifyEnabled,
      perm: ('Notification' in window) ? Notification.permission : 'unsupported',
      audio: audio,
      ms: ms,
      music: music,
      pc: kaPc1 ? (kaPc1.connectionState || 'new') : 'off',
      pcGathering: kaPc1 ? (function () { try { return kaPc1.iceGatheringState || '?'; } catch (e) { return '?'; } })() : 'off',
      pcCand: (kaCand1.length + kaCand2.length) | 0,
      pcNext: kaWebrtcTimer ? kaWebrtcRebuildDelay : 0,
      hb: kaHb ? { n: kaHb.n, hid: kaHb.hid, ts: kaHb.ts, resumed: kaHb.resumed, trail: (kaHb.trail || []).slice() } : null,
      ev: { stall: kaEv.stall, died: kaEv.died }
    };
  };

  function startKeepAlive(showToast) {
    if (keepAudio) return;
    try {
      // v3.5.160：保活音频改用 <audio> 元素循环播放极轻正弦波——媒体通知条才会显示
      // v3.44.x：优先用用户上传的自定义音频；否则内置默认静音音频
      const src = kaCustomAudio || ensureKeepAudioDataUrl();
      if (!src) { if (showToast) toast('后台保活启动失败（无法生成保活音频）'); return; }
      const keepEl = document.createElement('audio');
      keepEl.loop = true;
      // 自定义音频是用户主动选的（白噪音/助眠等），按原音量播放；默认静音音频压到近无声
      // #724：基础档音量升级 KA_VOL_BASE（0.05→0.2，见上方分级说明），治新内核 audible 收紧后豁免丢失
      keepEl.volume = kaCustomAudio ? 1 : KA_VOL_BASE;
      keepEl.src = src;
      keepEl.setAttribute('playsinline', '');
      // v3.13.x：play/pause 事件跟踪——play 成功刷新"最近播过"，外部打断（pause）
      // 进入退避排程；主动让位（音乐在播）不算打断
      keepEl.addEventListener('play', function () { kaMarkPlayed(); });
      keepEl.addEventListener('pause', function () {
        if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) return;
        if (kaTimer) return; // 已在退避轨道
        // #924：隐藏期被其他 App 抢走焦点＝用户正在看视频/听歌，不排回抢（见 kaYieldStealFocus）
        if (kaYieldStealFocus()) return;
        kaSchedule(); // 连击计数由 kaSchedule 内部递增
      });
      const playIt = function () {
        if (musicNowPlaying()) return; // v3.10.x：音乐在播，让位不抢音频（由 syncKeepForMusic 收回）
        const p = keepEl.play();
        if (p && p.catch) p.catch(function () {});
      };
      playIt();
      keepAudio = { el: keepEl };

      // v3.5.155：媒体会话标记——Chrome 安卓把「有活跃媒体会话 + 音频输出」的页面
      // 视为"正在播放媒体"，后台几乎不冻结（Youtube 网页版后台持续播放即此原理）。
      // 保活开启后在通知栏显示一个媒体条「mochi 后台保活」，既让用户看到保活在跑，
      // 又大幅提升后台定时器存活率 → 后台消息/通知到达率。比纯静音音频 + wakeLock
      // 强很多；停用保活时清除（stopKeepAlive）
      // v3.9.x：音乐播放时让位——music-player 已设置歌曲 metadata + 控制 handler，
      // 这里不覆盖（否则通知栏变成"后台保活"且按钮空响应，无法控制音乐）
      setKeepMediaSession();
      // #260：WebRTC 第二冻结豁免锚点——FIX 2026-09-13 #433 改启动 10s 后延迟建锚
      //（new RTCPeerConnection 构造是重主线程操作，同步建＝开屏路径叠加秒级长任务，
      //低端机「一进网站就非常卡」实锤元凶；音频主锚点不受影响）
      kaWebrtcDeferredStart(10000);

      // 用户首次交互时恢复播放（浏览器自动播放策略要求）
      const resumeOnInteraction = function () {
        if (musicNowPlaying()) return; // v3.10.x：音乐在播，让位
        if (keepAudio && keepAudio.el && keepAudio.el.paused) {
          const p = keepAudio.el.play();
          if (p && p.catch) p.catch(function () {});
        }
      };
      document.addEventListener('click', resumeOnInteraction, { once: true });
      document.addEventListener('touchstart', resumeOnInteraction, { once: true });
      document.addEventListener('keydown', resumeOnInteraction, { once: true });
      // v3.13.x：轻心跳（原每 5 秒无条件补播）——不再主动抢播，只做三件事：
      //   ① 音乐在播→保持让位；② 音频在跑→维持 mediaSession='playing'，稳定够久复位退避；
      //   ③ 音频被外部打断暂停→排一次退避补播（间隔由 kaSchedule 按连击指数化）。
      // 补播节奏明显放缓后，与其他 App 抢音频焦点的拉锯大幅减轻。
      keepInterval = setInterval(function () {
        try { if (window.__mochiPhase) window.__mochiPhase('ka-tick'); } catch (e0) {}
        if (keepAudio && keepAudio.el) {
          try {
            if (musicNowPlaying()) {
              // v3.10.x：音乐在播——保活音频保持让位暂停，不重试补播；媒体条由
              // music-player 管理，不再强设 playbackState（音乐暂停时会被误标）
              if (!keepAudio.el.paused) keepAudio.el.pause();
              return;
            }
            if (!keepAudio.el.paused) {
              // 音频在跑就持续声明"正在播放"，维持媒体会话活跃
              // FIX 2026-09-18 #780：隐藏态不再无条件重抢播放条——原实现每 5s 把
              // playbackState 按回 'playing'，会把同浏览器另一标签页（网页版网易云等）
              // 刚接管的系统媒体会话抢回来，真机表现＝通知栏条变成「Mochi 后台保活」+
              // 用户的音乐被挤停。改为「谁在放音乐谁拿条」：隐藏态只在条确实还归保活自己
              // 时才维持该信号，被接走（或没了）就让位。前台照旧，回前台由 healKeepAlive 接管。
              let hold = true;
              try {
                if (document.visibilityState === 'hidden') {
                  const md = navigator.mediaSession && navigator.mediaSession.metadata;
                  hold = !!(md && String(md.title) === 'Mochi 后台保活');
                }
              } catch (e) { hold = true; }
              if (hold) {
                try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
              }
              // 稳定播放够久 → 复位退避连击（下次打断从头 5s 起退避）
              if (kaPauseStreak && Date.now() - kaLastPlayAt > kaStableMs()) kaPauseStreak = 0;
              return;
            }
            // 音频暂停且不在退避轨道（启动被拒/媒体条丢失等漏网场景）→ 排退避补播
            // #924：隐藏期被外部抢焦点时同样不排（回抢＝截停对方 App 的声音）
            if (!kaTimer && !kaYieldStealFocus()) kaSchedule();
          } catch (e) {}
        }
      }, 5000);

      // 屏幕常亮（wakeLock），释放后自动重试
      // v3.5.131：wakeSentinel 提升为模块级——stopKeepAlive 需要释放它（原闭包变量
      // 关闭保活后屏幕仍常亮，用户以为关了实际没关）
      const requestWakeLock = function () {
        if (navigator.wakeLock && document.visibilityState === 'visible') {
          navigator.wakeLock.request('screen').then(function (sentinel) {
            wakeSentinel = sentinel;
            if (wakeSentinel) {
              wakeSentinel.addEventListener('release', function () {
                setTimeout(function () { if (keepEnabled) requestWakeLock(); }, 1000);
              });
            }
          }).catch(function () {});
        }
      };
      requestWakeLock();
      // v3.5.132：visibilitychange 监听移到模块顶层注册一次（在 startKeepAlive 内
      // 每次开关都会累积一个监听器 + 一个旧 wakeLock 永不释放）

      if (showToast) {
        // v3.5.133：保活开启时通知发送结果做成可感知诊断——
        // 系统通知能不能显示由浏览器+系统决定，API 不报错但可能被系统拦截；
        // 分情况提示用户卡在哪一环，避免"开了保活但通知栏永远没消息"的静默失效
        if (!('Notification' in window)) {
          toast('后台保活已启动（注意：本环境不支持系统通知，需 HTTPS 访问）');
        } else if (Notification.permission !== 'granted') {
          toast('后台保活已启动（通知未授权：去设置→后台通知→开启并允许权限）');
        } else {
          showSysNotification('后台保活已启动', { body: '正在播放静音音频以保持后台活跃，请勿关闭此页面' }).then(function (ok) {
            toast(ok
              ? '后台保活已启动 · 通知栏应弹出提示条，若没有请到系统设置→通知→Chrome→允许通知'
              : '后台保活已启动（通知发送未受理，请检查系统通知权限）');
          });
        }
      }
    } catch (e) {}
  }
  function stopKeepAlive(showToast) {
    // v3.5.160：停掉 <audio> 保活音频（原来 stop osc/close ctx）
    // FIX 2026-09-20 #924b：改 removeAttribute+load——原 `el.src = ''` 会把 src 置成
    //   当前文档 URL（空字符串按相对路径解析），iOS WebKit 等内核随即发起「把整个页面
    //   当媒体加载」的 load/error 循环，error 事件再触发既有补播口子的边缘路径＝关了
    //   以后音频/媒体条阴魂不散（用户实报「后台保活关不掉」的组成部分）。
    try { if (keepAudio && keepAudio.el) { keepAudio.el.pause(); keepAudio.el.removeAttribute('src'); try { keepAudio.el.load(); } catch (e2) {} } } catch (e) {}
    // v3.5.155：清除媒体会话标记（通知栏媒体条消失）
    // v3.9.x：音乐播放时不清除——music-player 正在用 MediaSession 控制音乐
    if (!window.__musicPlaying) {
      try {
        if ('mediaSession' in navigator && navigator.mediaSession) {
          // #924b：先把播放态落回 paused——iOS WebKit 清 metadata 后媒体条/控制中心
          //   「正在播放」项有残留（已知怪癖），只清 metadata 不改播放态时条目滞留
          //   ＝用户看到保活条还在、以为「关不掉」。声明暂停后由系统收走该条目。
          try { navigator.mediaSession.playbackState = 'paused'; } catch (e2) {}
          navigator.mediaSession.metadata = null;
          try { navigator.mediaSession.setActionHandler('play', null); } catch (e) {}
          try { navigator.mediaSession.setActionHandler('pause', null); } catch (e) {}
        }
      } catch (e) {}
    }
    // v3.5.131：释放屏幕常亮（原实现从不 release——关闭保活后屏幕持续不熄）
    try { if (wakeSentinel) { wakeSentinel.release(); } } catch (e) {}
    wakeSentinel = null;
    // v3.13.x：清掉排中的退避补播与连击计数
    kaStopTimer();
    kaPauseStreak = 0;
    kaPlayFailStreak = 0;
    // #260：WebRTC 锚点一并拆除
    kaWebrtcStop();
    clearInterval(keepInterval);
    keepAudio = null;
    keepInterval = null;
    if (showToast) toast('后台保活已关闭');
  }
  // v3.5.132：模块顶层注册一次（防反复开关保活累积监听器）
  // v3.9.x：回前台完整自愈——原逻辑回前台只补 wakeLock；Chrome/系统在后台/锁屏
  // 几小时后会挂起保活音频、丢弃媒体条，不恢复的话通知栏「Mochi 后台保活」条消失、
  // 静音音频停播 → 页面再次被后台冻结，TA 消息/弹窗停摆。现在回前台把音频/媒体条/
  // wakeLock 一并恢复，保证下一次后台会话依旧保活。
  function healKeepAlive() {
    if (!keepEnabled) return;
    // v3.13.x：回前台立即清零退避轨道——用户切回来了，补播不再退避，马上恢复
    kaResetBackoff();
    // #260：后台冻结/挂起后 WebRTC 通道可能已断——回前台补建（幂等）
    // FIX 2026-09-13 #433：改 3s 延迟 + 排程不抢占——resume 瞬间主线程正忙（重渲/回填），
    // 立即构造 RTCPeerConnection 会叠加秒级长任务；且部分内核加载期会冒一次
    // visibilitychange→visible（无头实测 3s 即建＝绕过启动 10s 延迟），重建退避排期也会
    // 被这里提前插队。故仅在「无现役锚且启动/重建排程都没挂期」时才补建：
    // 加载期由启动延迟负责、断连由退避排期负责，这里只兜「排程全空但锚不在」的真缺口。
    if (!kaPc1 && !kaWebrtcTimer && !kaWebrtcBootTimer) kaWebrtcDeferredStart(3000);
    // 1) 恢复被挂起的保活音频（回前台瞬间可能仍被浏览器阻塞，延迟再试几次）
    //    v3.10.x：音乐在播时跳过——保活音频让位中，不抢音频
    if (!musicNowPlaying() && keepAudio && keepAudio.el && keepAudio.el.paused) {
      const p = keepAudio.el.play();
      if (p && p.catch) p.catch(function () {});
    }
    [0, 600, 1800].forEach(function (d) {
      setTimeout(function () {
        if (!keepEnabled || musicNowPlaying()) return; // v3.10.x：音乐在播，让位
        if (keepAudio && keepAudio.el && keepAudio.el.paused) {
          const p = keepAudio.el.play();
          if (p && p.catch) p.catch(function () {});
        }
      }, d);
    });
    // 2) 媒体条可能已被丢弃——重设「Mochi 后台保活」媒体会话（音乐在播时自动让位）
    setKeepMediaSession();
    // 3) 重新请求屏幕常亮
    try {
      if (navigator.wakeLock && document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').then(function (sentinel) {
          wakeSentinel = sentinel;
          if (wakeSentinel) {
            wakeSentinel.addEventListener('release', function () {
              setTimeout(function () { if (keepEnabled) requestWakeLockTop(); }, 1000);
            });
          }
        }).catch(function () {});
      }
    } catch (e) {}
  }
  // v3.14.x：回前台统一信号——healKeepAlive + dispatch mochi-fg-resume 事件，
  // ta-ask 等模块监听后补触发主动消息 + 补弹后台新卡片（安卓后台 setInterval 被节流，
  // 回前台不等下一个 tick 立即检查；小米MIX4 Edge 收不到后台消息修复）
  let _fgResumeAt = 0;
  // #915：本次真回前台前「在后台待了多久」——互动卡/心愿等低频触发器在后台期被冻结/深度节流，
  // 回前台补触发时页面已可见、通知按「前台不弹」被吞＝用户从没收到过它们的后台弹窗。
  // 补触发侧据此判「这是刚从真后台回来的迟到消息」，给通知打 late 标补弹（见 window.bgLateCatchup）。
  let _fgFromHiddenFor = 0;
  function _onFgVisible() {
    // v3.18.x：一次切后台再切回会连续触发 visibilitychange(visible)+focus+pageshow，
    // 每次都派发 mochi-fg-resume 会让 ta-ask 补触发/补弹连跑多遍 → 弹出一大堆已看过的旧卡片重叠。
    // 用 1s 窗口合并为一次，只在真正再次回前台时重新派发。
    const now = Date.now();
    if (now - _fgResumeAt < 1000) return;
    _fgResumeAt = now;
    // lastHiddenAt 的置零监听器注册在本监听之后，此刻仍是本次后台的起点（未刷新）
    try { _fgFromHiddenFor = lastHiddenAt > 0 ? now - lastHiddenAt : 0; } catch (e) { _fgFromHiddenFor = 0; }
    healKeepAlive();
    try { document.dispatchEvent(new Event('mochi-fg-resume')); } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') _onFgVisible();
  });
  // v3.9.x：窗口重新聚焦 / bfcache 恢复（pageshow persisted）同样自愈——
  // 有些浏览器从后台切回只触发 focus 不触发 visibilitychange；bfcache 恢复时
  // 定时器已暂停，恢复后保活音频也一并拉回
  document.addEventListener('focus', function () {
    if (document.visibilityState === 'visible') _onFgVisible();
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted || document.visibilityState === 'visible') _onFgVisible();
  });
  // FIX 2026-09-04 #153 切后台方向保活自愈——原只有回前台的 healKeepAlive，切后台没有：
  // 若切后台瞬间音频正处暂停（前台被其他 App 抢过音频焦点、退避已在最长 60s 轨道），
  // 这段静默窗口会直接跨过 Chromium 139 的 1 分钟冻结线 → 页面整个被冻结（定时器全停，
  // 后台消息/系统通知全停，回前台解冻后积压定时器一口气补跑——用户报障形态）。
  // 这里切后台时：清退避轨道 + 立即补播一次 + 按最快档（5s）排下一次，把隐藏期静默窗口
  // 压到 20s 封顶（见 kaSchedule 内隐藏期钳制）；音乐在播时跳过（媒体会话由音乐维持）。
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) return;
    if (!keepAudio.el.paused) return;
    // #924：切后台瞬间正是用户切去刷视频/听歌的时刻，此时立即补播＝当场把对方截停；
    // iOS 无 Chromium 冻结线，让位（回前台 healKeepAlive 照常拉回）。安卓保持原行为。
    if (kaYieldStealFocus()) return;
    kaResetBackoff();
    const p = keepAudio.el.play();
    if (p && p.catch) p.catch(function () {});
    kaSchedule();
  });
  function requestWakeLockTop() {
    try {
      if (navigator.wakeLock && document.visibilityState === 'visible' && keepEnabled) {
        navigator.wakeLock.request('screen').then(function (sentinel) {
          wakeSentinel = sentinel;
        }).catch(function () {});
      }
    } catch (e) {}
  }
  // v3.9.x：音乐停止后（music-media-release）恢复"后台保活"媒体条——
  // music-player 播放时覆盖了保活 metadata，停止后这里重新设回，保活后台存活率不降
  // v3.10.x：音乐完全停止后同时收回让位中的保活音频（正常路径由 __musicPlaying=false
  // 的 watcher 收回，这里对 teardown 直接跳过 onpause 等边缘路径双保险）
  document.addEventListener('music-media-release', function () {
    if (keepEnabled) { setKeepMediaSession(); syncKeepForMusic(); }
  });
  // #977 开启即当面告知两条硬限制（用户直派「这两个功能需要提示用户」；惯例＝功能打开的一刻
  //   把限制说清，不藏在说明里）。只挂在用户手动开启这一刻（boot 恢复 / 通知联动走
  //   startKeepAlive(false) 不弹，避免重复打扰）；口径与 #bg-keep-sub 红条、功能说明胶囊一致。
  function kaOpenEnableHints() {
    try {
      if (typeof window.openModal !== 'function') return;
      window.openModal('后台保活已开启 · 三条必知', '', function () {}, {
        noInput: true, pillSubmit: true,
        pills: [{ label: '知道了', value: 'ok' }],
        staticText: '保活＝页面在后台持续播放一段近无声音频，让系统不冻结本页。有两条硬限制（手机/浏览器限制，不是网站故障）：\n\n① 别的 App 会把保活截断：刷视频、听歌等会占用手机音频通道，保活音频被暂停＝保活失效，回到本页才自动恢复；被截断期间后台消息收不到、后台弹窗不弹。\n\n② 后台挂久了会失效：系统省电/内存策略会把挂久的页面冻结甚至丢弃重载（Edge「睡眠标签页」/Chrome「内存节省程序」约 30 分钟就会丢）。失效后请彻底关闭网页重新打开，再把「后台保活」「后台弹窗」开关重新打开。\n\n③ 开着它时页面不会在后台自动换新版（换版要重载页面、会把后台运行打断）：顶部出现「检测到新版本」条时，你自己挑时间点「刷新使用新版」即可；不点也不影响使用，下次彻底关闭网页重开会自然换到新版。'
      });
    } catch (e) {}
  }
  const kaBtn = document.getElementById('bg-keepalive');
  function syncKeepUI() { if (kaBtn) kaBtn.checked = keepEnabled; }
  // #921f：change 事件的用户手势闸（保活/通知开关共用）
  // FIX 2026-09-21 #988：判据改为「以输入事件为准」，不再把 navigator.userActivation 当唯一裁判。
  //   原判据 `hasBeenActive === false` 是全局一次性标记，由内核按自己的「用户激活」定义维护——
  //   内核对触摸点按的激活判定与我们对「用户点按」的期望并不总是一致（定制内核 / 套壳 / 无头
  //   环境都有先例），一旦它把真点按算成「从未激活」，开关就表现为「点第一下被静默吃掉、点第二
  //   下才生效」（用户实报红米 K80 Chrome，明说其他型号也有）。现在先看证据：change 之前 1.2s 内
  //   有过真实输入（pointerdown/up、touchstart/end、mouse*、click、keydown——真点按、长按、键盘
  //   操作全覆盖，与内核 API 无关、零机型分支）即判为用户操作；#921f 要拦的唤醒重载伪 change 只
  //   派发 change、前面没有任何输入事件，照旧被拦。userActivation 只在「完全没有输入证据」时起
  //   二次否决作用，拿不到读数按真手势处理，不误伤。
  let kaInputAt = 0;
  try {
    const kaMarkInput = function (e) {
      // 只认真实输入：脚本造的 click/tap 不算手势证据（否则页面自身合成点击会把伪 change 放行）
      try { if (e && e.isTrusted === false) return; } catch (er) {}
      kaInputAt = Date.now();
    };
    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown'].forEach(function (t) {
      try { document.addEventListener(t, kaMarkInput, { passive: true, capture: true }); } catch (err) {}
    });
  } catch (e) {}
  function kaUserGesture(e) {
    try {
      if (e && e.isTrusted === false) return false;
      if (Date.now() - kaInputAt <= 1200) return true;
      if (navigator.userActivation && navigator.userActivation.hasBeenActive === false) return false;
    } catch (er) {}
    return true;
  }
  if (kaBtn) {
    kaBtn.addEventListener('change', function (e) {
      // FIX 2026-09-20 #921f：非用户手势来源的 change 一律忽略——Edge「睡眠标签页」/Chrome
      // 「内存节省程序」把挂后台约 30 分钟的页面丢弃后自动重载（用户实报 OPPO Reno14 Edge
      // 「挂后台半小时自动刷新、重进后保活/通知自动关闭」），这类唤醒重载路径可能产生
      // 无手势的 change 翻转；照单全收＝开关被写 '0'＋__ka-user-off 锁死＝「重进自动关闭」。
      // 真用户点按必有手势（hasBeenActive=true），正常操作不受影响。
      if (!kaUserGesture(e)) { syncKeepUI(); try { kaBtn.checked = keepEnabled; } catch (er) {} return; }
      keepUserTouched = true; // #88：手动动过 → 回填后不再重读覆盖
      keepEnabled = kaBtn.checked;
      gSet('bg-keepalive', keepEnabled ? '1' : '0');
      // FIX 2026-09-16 #601d：记住「用户手动关过保活」——开启「后台通知」时的自动联动
      // 与任何回填不得再把它强行打开（用户反馈：关掉后过一会/重开又变回开启）。
      gSet('__ka-user-off', keepEnabled ? '0' : '1');
      if (keepEnabled) { startKeepAlive(true); kaOpenEnableHints(); }
      else stopKeepAlive(true);
    });
  }
  (function () {
    // v3.9.x：全局化迁移——旧版按桌面存（activeStore），读时回退旧值并写全局，
    // 之后开关不再随桌面/active-contact 变化而"自己关掉"
    let saved = gGet('bg-keepalive');
    if (saved === null) {
      const old = store.get('bg-keepalive');
      if (old !== null) { gSet('bg-keepalive', old); saved = old; }
    }
    keepEnabled = saved === null ? false : saved === '1';
    // FIX 2026-09-16 #601d：用户手动关过的保活，启动时一律保持关闭——防任何来源（旧版迁移 /
    // 通知联动 / 存储回填）把存储里的值又写成 '1' 造成「重开又自己变回开启」。
    if (gGet('__ka-user-off') === '1') {
      keepEnabled = false;
      if (saved === '1') gSet('bg-keepalive', '0');
    }
    syncKeepUI();
    if (keepEnabled) startKeepAlive(false);
  })();

  // ===== v3.44.x：保活音频选择入口（「保活音频」行右侧按钮）=====
  const kaAudioBtn = document.getElementById('bg-keep-audio-btn');
  function syncKaAudioUI() { if (kaAudioBtn) kaAudioBtn.textContent = kaAudioLabel(); }
  if (kaAudioBtn) kaAudioBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    openKaAudioPicker();
  });
  kaLoadCustomAudio();
  syncKaAudioUI();
  // IDB 回填异步：回填完成后补读一次自定义音频（小键可能在 LS 被清后才到位）
  try { document.addEventListener('mochi-restore-done', function () { kaLoadCustomAudio(); syncKaAudioUI(); }); } catch (e) {}

  // ================= 后台通知 =================
  let notifyEnabled = false;
  let notifyUserTouched = false; // v3.26.x #88：本会话用户手动动过通知开关 → 回填后不重读覆盖
  // v3.5.151：系统通知左侧图标用「带 mochi 字母的完整图标」（icon-512.png，
  // 与手机桌面快捷方式图标一致）。之前用 icon-192.png（纯心形小图标），
  // 用户看到的左侧是"爱心"而非带字母的 mochi 图标
  const NOTIFY_ICON = (function () {
    try { return new URL('./icon-512.png', location.href).href; } catch (e) { return ''; }
  })();
  // v3.13.x：badge（通知左侧小图标）专用单色透明图——icon-512.png 是全不透明白底黑字
  // 大图，直接放 badge 位不符合 Android small icon 规范（要求 alpha 蒙版单色图），
  // 部分系统/浏览器（OPPO ColorOS + Edge 等）会渲染成白块或不显示。这里用 canvas
  // 把白底变透明、内容变白色剪影，生成 96px 透明底单色 PNG dataURL，供 badge 使用。
  let BADGE_DATAURL = '';
  let badgeReady = false;
  let badgeQueue = null;
  function getBadgeUrl(cb) {
    cb = cb || function () {};
    if (badgeReady) { cb(BADGE_DATAURL); return; }
    if (badgeQueue) { badgeQueue.push(cb); return; }
    badgeQueue = [cb];
    if (!NOTIFY_ICON) { badgeReady = true; BADGE_DATAURL = ''; const q = badgeQueue; badgeQueue = null; for (let i = 0; i < q.length; i++) q[i](''); return; }
    const img = new Image();
    img.onload = function () {
      try {
        const s = 96;
        const c = document.createElement('canvas');
        c.width = s; c.height = s;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, s, s);
        const d = ctx.getImageData(0, 0, s, s);
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          if (r > 248 && g > 248 && b > 248) px[i + 3] = 0;   // 白底 → 透明
          else { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255; } // 内容 → 白色不透明
        }
        ctx.putImageData(d, 0, 0);
        BADGE_DATAURL = c.toDataURL('image/png');
      } catch (e) { BADGE_DATAURL = ''; }
      badgeReady = true;
      const q = badgeQueue; badgeQueue = null;
      for (let i = 0; i < q.length; i++) { try { q[i](BADGE_DATAURL); } catch (e2) {} }
    };
    img.onerror = function () { badgeReady = true; BADGE_DATAURL = ''; const q = badgeQueue; badgeQueue = null; for (let i = 0; i < q.length; i++) { try { q[i](''); } catch (e) {} } };
    img.src = NOTIFY_ICON;
  }
  // v3.5.135：统一走 Service Worker 显示通知——Chrome Android 规范：页面在后台（隐藏）
  //   时，页面脚本直接 new Notification() 会被静默抑制（通知不弹也不报错），
  //   标准做法是 navigator.serviceWorker.ready → reg.showNotification()（SW 独立于页面，
  //   隐藏时允许显示）。此辅助函数统一封装：优先 SW，失败回退页面 Notification。
  //   返回 Promise<boolean>：true=已提交显示（能否真正显示仍由系统通知权限决定）
  // v3.14.x：media 全部 Blob 直传——此前头像/图片先转成 blob: URL 再交给 SW，但 blob URL
  //   由页面进程持有：页面切后台被冻结/回收后，系统通知进程按 URL 取不到图 → 图标空置，
  //   系统回退浏览器默认图标（用户反馈：后台弹窗左边一直不是 mochi 字母图标）。
  //   改为把 dataURL 就地转成 Blob 对象放进 NotificationOptions（规范允许
  //   icon/badge/image 为 (DOMString or Blob)），位图随通知序列化、不依赖页面存活；
  //   顺带删掉 createObjectURL + 延迟 revoke 的泄漏面。
  function dataUrlToBlob(dataUrl, cb) {
    try {
      fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (b) {
        cb(b && b.size ? b : null);
      }, function () { cb(null); });
    } catch (e) { cb(null); }
  }
  // 把 target 里 data: 形式的 icon/badge/image 原地换成 blob: URL 字符串；
  // http(s)/blob URL 原样保留，单个转换失败仅删该字段（宁缺图，不缺整条通知）
  // v3.18.x：修复「右侧无头像 + 有时通知发不出」——此前把 Blob 对象直接赋给
  // icon/badge/image 传给 showNotification，而 NotificationOptions 这些字段规范要求
  // URL 字符串（USVString），Chrome 收到 Blob 对象会失败/忽略 → 触发降级链剥掉图标
  // （右侧无头像），降级重发仍带 Blob 对象字段反复失败（有时整条通知发不出）。
  // 改用 URL.createObjectURL(blob) 生成 blob: URL 字符串，是合法 URL，Chrome 可靠渲染
  function prepMediaBlobs(target, done) {
    const keys = ['icon', 'badge', 'image'];
    let pending = 0;
    const finish = function () { if (!pending && done) { const d = done; done = null; d(); } };
    keys.forEach(function (k) {
      const v = target[k];
      if (typeof v === 'string' && v.indexOf('data:') === 0) {
        pending++;
        dataUrlToBlob(v, function (b) {
          if (b) {
            try { target[k] = URL.createObjectURL(b); } catch (e) { delete target[k]; }
          } else {
            delete target[k];
          }
          if (--pending === 0) finish();
        });
      }
    });
    finish();
  }
  // FIX 2026-09-16 #614 通知发送链「永不落地」加固（多机型同报：后台通知「点测试没反应」+
  //   后台弹窗不再弹；以前正常）。根因：showSysNotification 唯一等 navigator.serviceWorker.ready
  //   的 .then 才发通知/出结果——SW 被系统回收、注册在弱网下失败、或 active worker 不可用时，
  //   ready 会一直 pending（既不 resolve 也不 reject，无 catch 可兜）⇒ 测试按钮永远等不到
  //   .then（没有任何反馈）、后台通知也永远发不出去。加固（零机型分支、不改业务语义）：
  //   ① ready / showNotification 都加超时，任何一环卡住都必然 settle；
  //   ② ready 拿不到现役 SW 时主动补注册一次（自愈被回收/注册失败的场景）；
  //   ③ 仍不可用则回退页面 Notification 路径（前台可见时同样能弹）。
  function kaWithTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      let done = false;
      const t = setTimeout(function () { if (!done) { done = true; reject(new Error('ka-timeout')); } }, ms);
      try {
        // FIX 2026-09-17 #705 兼容 thunk——#673 把 showNotification 调用改成本函数不支持的
        //   thunk 形态（传 function 而非 Promise），而这里仍直接 p.then：函数没有 .then →
        //   TypeError 进 catch → reject → STRIP_LADDER 四级降级被同一个 TypeError 连环「失败」
        //   秒耗尽 → resolve(false)，reg.showNotification 从未执行。后果＝#673 部署后所有
        //   机型后台通知全灭（无头实测 gateStats.sent=1 而 showNotification 0 次调用、无任何
        //   报错）。修法：传函数则先调用取 Promise（同步 throw 同样落进本 catch），传
        //   Promise 维持原行为；Promise.resolve 兜住返回 undefined 的实现。
        const pr = (typeof p === 'function') ? p() : p;
        Promise.resolve(pr).then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
          function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
      } catch (e) { if (!done) { done = true; clearTimeout(t); reject(e); } }
    });
  }
  function kaSWReady() {
    // 返回 Promise<reg|null>：永不 reject（调用方按 null 回退页面路径）
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return Promise.resolve(null);
    const start = function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return (reg && reg.active) ? reg : null;
      }).catch(function () { return null; }).then(function (reg) {
        if (reg) return reg;
        // 无现役 SW：补注册一次自愈（原实现只在 pwa.js load 时注册一次，失败即长期不可用）
        try { navigator.serviceWorker.register('./sw.js').catch(function () {}); } catch (e) {}
        return kaWithTimeout(navigator.serviceWorker.ready, 4000).then(function (r2) {
          return r2 || null;
        }).catch(function () { return null; });
      });
    };
    return kaWithTimeout(start(), 5000).catch(function () { return null; });
  }
  // FIX 2026-09-17 #673 发送链三处「静默丢失」补齐（与 #614 同族——用户又报「后台弹窗收不到」，
  //   红米K80 Chrome 等多机型同现）。#614 解决的是 ready/showNotification 的 Promise 永不落地，
  //   本次是同一类「不报错、也不发」的剩余三个口子：
  //   ① 同步抛错逃逸：kaWithTimeout(reg.showNotification(...)) 是先求值再包超时——showNotification
  //      同步 throw 时异常穿透 prepMediaBlobs 回调（落进 dataUrlToBlob 的 fetch promise ＝未处理
  //      拒绝），发送链既不 resolve 也不走降级重发 ⇒ 整条通知静默消失、测试按钮也无结果。改为传 thunk。
  //   ② 页面通道在隐藏态不可显示却报成功：Chrome 安卓对隐藏页面的 new Notification() 静默抑制
  //      （不弹也不报错），原实现 resolve(true) ⇒ 调用方 markNotified（该内容此后不再弹）＋ 测试按钮
  //      写「✓ 测试通知已发送（Service Worker）」＝用户侧什么都没弹、诊断还说一切正常。现在隐藏态
  //      走页面通道一律 resolve(false)（未真正提交显示，不记「已通知」指纹，补发成功还能弹）。
  //   ③ SW 未就绪时整条丢：只等一次窗口就判死，弱网/刚被回收重建即永久丢失。现在隐藏态挂一次
  //      「就绪即补发」（swNotifyLater，最多等 60s），仍就绪不了才回退页面通道。
  //   ④ lastNotifyChannel 如实记录本次实际走的通道——测试按钮据此说真话，诊断不再指错层。
  let lastNotifyChannel = '';   // 'sw' | 'page' | 'none'：最近一次实际通道
  window.bgNotifyLastChannel = function () { return lastNotifyChannel; };
  let swLaterQueue = [];        // FIX 2026-09-20 #921：待补发队列——原单发闸在等待窗内只收第一条，
                                //   后续到达的通知整条静默吞掉（弱网/SW 被回收/刚更新完的窗口里
                                //   连着来几条消息＝只弹第一条），表现为「时不时收不到后台弹窗」。
  let swLaterTimer = null;      // 「就绪即补发」等待窗（同时只挂一个定时器，到点统一 flush）
  function swNotifyNote(ch, chanOut) {
    lastNotifyChannel = ch;
    if (typeof chanOut === 'function') { try { chanOut(ch); } catch (e) {} }
  }
  function swLaterFlush(reg) {
    if (!swLaterTimer) return; // 已 flush 过（ready 与 60s 到点谁先到都只跑一次）
    clearTimeout(swLaterTimer); swLaterTimer = null;
    const q = swLaterQueue; swLaterQueue = [];
    if (!reg) {
      for (let i = 0; i < q.length; i++) swNotifyNote('none', q[i].chanOut);
      // FIX 2026-09-20 #921：等到点仍拿不到 SW＝本页会话通知通道异常，这批消息已丢。
      // 回前台可见时顶部出恢复条引导「立即刷新 / 彻底关闭浏览器重开」（#761 同口径），
      // 不能再让用户毫无感知地丢通知。
      chanDownPending += q.length;
      tryShowNotifyHealBar();
      return;
    }
    // 自愈：通道恢复正常 → 收掉恢复条、清掉待提示计数
    chanDownPending = 0;
    try { const hb = document.getElementById('notify-heal-bar'); if (hb) hb.hidden = true; } catch (e) {}
    for (let i = 0; i < q.length; i++) {
      const o = Object.assign({}, q[i].opts);
      // 补发求稳：媒体字段全不带——纯文字通知最不容易被内核/系统挑掉（错过一次就不再错过）
      delete o.image; delete o.icon; delete o.badge;
      if (!o.urgency) o.urgency = 'high';
      try { reg.showNotification(q[i].title, o); swNotifyNote('sw', q[i].chanOut); } catch (e) { swNotifyNote('none', q[i].chanOut); }
    }
  }
  function swNotifyLater(title, opts, chanOut) {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) { swNotifyNote('none', chanOut); return; }
    swLaterQueue.push({ title: title, opts: opts, chanOut: chanOut });
    if (swLaterTimer) return;
    swLaterTimer = setTimeout(function () { swLaterFlush(null); }, 60000);
    kaWithTimeout(navigator.serviceWorker.ready, 60000).then(swLaterFlush, function () { swLaterFlush(null); });
  }
  // ===== #921：通知通道异常恢复条（复用 .ver-update-bar 顶条形态，模板锚 notify-heal-bar） =====
  // 出条条件：就绪补发到点仍拿不到 SW（通道异常且回天乏术）× 页面在前台 × 开屏已关
  // （#900 教训：z-998 顶条在开屏 z-999 之下，开屏期间弹＝弹在看不见的地方）。
  // 收条条件：用户点「知道了」（12h 内不再自动弹）或后续 flush 成功（自愈）。
  // 每个页面会话最多自动弹 2 次，不与版本更新条/备份提醒条抢位（本条只在通道异常时出现）。
  let chanDownPending = 0;
  let chanDownShown = 0;
  let chanDownDismissAt = 0;
  function chanSplashGone() {
    const s = document.getElementById('splash');
    return !s || !s.isConnected || s.classList.contains('hide');
  }
  function tryShowNotifyHealBar() {
    if (!chanDownPending) return;
    if (document.visibilityState !== 'visible' || !chanSplashGone()) return;
    const n = chanDownPending; chanDownPending = 0;
    if (chanDownShown >= 2 || Date.now() - chanDownDismissAt < 12 * 3600 * 1000) return;
    chanDownShown++;
    const bar = document.getElementById('notify-heal-bar');
    if (!bar) return;
    const txt = document.getElementById('notify-heal-txt');
    if (txt) txt.textContent = '⚠ 后台通知通道未就绪：刚才有 ' + n + ' 条消息没能弹出。点「立即刷新」恢复；无效请彻底关闭浏览器后重开';
    bar.hidden = false;
    const act = document.getElementById('notify-heal-refresh');
    if (act) act.onclick = function () { try { location.reload(); } catch (e) {} };
    const close = document.getElementById('notify-heal-close');
    if (close) close.onclick = function () { chanDownDismissAt = Date.now(); bar.hidden = true; };
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    setTimeout(tryShowNotifyHealBar, 800); // 回前台补出条（隐藏期间发生的丢失也提示）；错开回前台渲染高峰
  });
  function showSysNotification(title, opts, chanOut) {
    opts = opts || {};
    // #708 自检优化：通道回报支持「每次调用独立收集」——lastNotifyChannel 是全局共享，
    // 真实消息/来电/测试谁后发谁写，自检读全局可能读到别的通知的通道＝结果串台。
    // 各决策点改走 note()：全局语义不变，调用方第三参传回调即可拿到自己那一条的通道。
    const note = function (ch) {
      lastNotifyChannel = ch;
      if (typeof chanOut === 'function') { try { chanOut(ch); } catch (e) {} }
    };
    return new Promise(function (resolve) {
      try {
        if (!('Notification' in window) || Notification.permission !== 'granted') { note('none'); resolve(false); return; }
        const hidden = document.visibilityState === 'hidden';
        const pageFallback = function () {
          // SW 不可用回退页面路径：去掉 image/icon/badge（页面 Notification 对
          // dataURL 图片/图标不稳定，带上会导致整条通知失败，v3.5.118 教训）
          const noMedia = Object.assign({}, opts);
          delete noMedia.image;
          delete noMedia.icon;
          delete noMedia.badge;
          note('page');
          try {
            new Notification(title, noMedia);
            // #673：隐藏态下页面通知被内核静默抑制，不算「已提交显示」
            resolve(!hidden);
          } catch (e) { note('none'); resolve(false); }
        };
        if ('serviceWorker' in navigator && navigator.serviceWorker) {
          // v3.5.137：urgency:'high' 让通知以「高紧迫度」发送——Chrome 安卓上
          // 高紧迫度通知更可能以悬浮（head-up）形式显示在屏幕上方，而不是只进
          // 下拉通知栏；配合系统「横幅通知」权限即为微信式顶部弹窗
          const swOpts = Object.assign({}, opts);
          if (!swOpts.urgency) swOpts.urgency = 'high';
          // v3.5.156：mochi 图标设到 badge（左侧小图标）——安卓通知里 badge 才是
          // 左侧小图标位；icon 是右侧大图标位（由调用方传联系人头像/消息图）。
          // 此前把 mochi 设进 icon → 显示在右侧，左侧 badge 未设 → 浏览器默认图标
          // v3.13.x：badge 优先用 canvas 生成的单色透明图（Android small icon 规范）；
          // 未生成完成时回退原始 icon-512 URL（已启动即预热，首条通知前通常已就绪）。
          // v3.14.x：badge 同样走 Blob 直传（prepMediaBlobs 统一转换）
          if (!swOpts.badge) swOpts.badge = BADGE_DATAURL || NOTIFY_ICON || undefined;
          kaSWReady().then(function (reg) {
            // #673：SW 未就绪（被回收/弱网注册中）时先挂「就绪即补发」——隐藏态下
            // 页面通道根本不会显示，不补发就是整条丢；前台则直接走页面通道（可见即能弹）
            if (!reg) { if (hidden) swNotifyLater(title, opts, chanOut); pageFallback(); return; }
            // v3.14.x：逐级降级重发——带 image 失败 → 去 image；仍失败 → 去 badge；
            // 最后连 icon 也去掉只发纯文字。保证文字通知不因任一媒体字段异常整条丢失
            const STRIP_LADDER = [[], ['image'], ['image', 'badge'], ['image', 'badge', 'icon']];
            let ladderIdx = 0;
            const tryNext = function () {
              if (ladderIdx >= STRIP_LADDER.length) { note('none'); resolve(false); return; }
              const attempt = Object.assign({}, swOpts);
              STRIP_LADDER[ladderIdx++].forEach(function (k) { delete attempt[k]; });
              prepMediaBlobs(attempt, function () {
                // #614：showNotification 本身也加超时——防止个别内核返回的 Promise 不落地
                // #673：thunk 形式——同步 throw 也必须落进超时器的 reject 通道（原写法先求值，
                //   异常直接穿透回调＝发送链卡死、降级重发不跑）
                kaWithTimeout(function () { return reg.showNotification(title, attempt); }, 4000)
                  .then(function () { note('sw'); resolve(true); }, tryNext);
              });
            };
            tryNext();
          }).catch(pageFallback);
        } else {
          pageFallback();
        }
      } catch (e) { note('none'); resolve(false); }
    });
  }
  // v3.5.114：请求权限（支持成功/失败回调）——失败时开关要弹回关闭，
  //   否则 iOS 不支持 / 权限被拒时开关显示"开"但实际无效，误导用户
  // FIX 2026-09-21 #988：失败回调补「原因」并把「还没决定」与「被拒绝」分开——
  //   'unsupported' 环境不支持 / 'denied' 明确被拒 / 'pending' 用户还没在系统弹窗里做出选择
  //   （安卓 Chrome 与国产 ROM 上弹窗挂着未答复时 requestPermission 就 resolve 成 'default'）/
  //   'error' 调用异常。调用方据此区分「该回弹」与「该继续等」，不再把待决当失败。
  //   opts.quiet＝不打任何 toast（供轮询重试这类不该重复打扰的场合）。
  function requestNotifyPermission(cb, failCb, opts) {
    const quiet = !!(opts && opts.quiet);
    const say = function (m) { if (!quiet) toast(m); };
    const fail = function (why) { if (failCb) failCb(why); };
    if (!('Notification' in window)) {
      // v3.7.x：按平台区分文案——安卓阉割 WebView（OPPO 自带/Via 等）也无 Notification API，
      //   原文案硬编码"iPhone"对安卓用户很困惑。
      // FIX 2026-09-21 #978：iOS 那支原文案暗示「装到主屏幕后由系统接管」，与同一功能另外两处
      //   口径矛盾（行下说明「本开关在 iPhone 上无效」、#924c「不保证弹出」）——iOS WebKit 的
      //   网页通知只认推送服务通道，装到主屏幕也不保证。统一为「改用桌面消息弹窗」。
      // v3.16.x：设备判定统一读 device.js（mochiDevice）
      const _isIOS = !!(window.mochiDevice || {}).isIOS;
      say(_isIOS
        ? 'iPhone / iPad 的网页拿不到系统通知\n（添加到主屏幕也不保证）请用「桌面消息弹窗」'
        : '当前浏览器不支持系统通知\n请改用 Chrome/Edge 打开本站（安卓或电脑都行）');
      fail('unsupported');
      return;
    }
    if (Notification.permission === 'granted') { if (cb) cb(); return; }
    if (Notification.permission !== 'default') {
      say('通知权限被拒绝，请在浏览器设置中允许通知');
      fail('denied');
      return;
    }
    try {
      let settled = false;
      const once = function (p) {
        if (settled) return;
        settled = true;
        if (p === 'granted') { if (cb) cb(); return; }
        if (p === 'denied') { say('通知权限被拒绝，请在浏览器设置中允许通知'); fail('denied'); return; }
        say('还没拿到通知权限：请在浏览器弹窗里点「允许」（地址栏左侧图标 → 网站设置 → 通知）');
        fail('pending');
      };
      // 两种 API 形态都接：返回 Promise 的内核走 then；老回调形态（部分 iOS WebView）返回
      //   undefined、结果只从回调进——原写法直接 .then 会抛 TypeError，表现为「点了毫无反应」
      const ret = Notification.requestPermission(once);
      if (ret && typeof ret.then === 'function') {
        ret.then(function (p) { once(p); }, function () { once('error'); });
      }
    } catch (e) { fail('error'); }
  }
  const nbBtn = document.getElementById('bg-notify');
  function syncNotifyUI() { if (nbBtn) nbBtn.checked = notifyEnabled; }
  function nbPermState() {
    try { return ('Notification' in window) ? Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; }
  }
  // ===== FIX 2026-09-21 #988：开启「后台通知」的流程重写 =====
  //   用户实报：红米 K80 Chrome 点第一下开关被「拦回去」、点第二下才开（明说其他型号也有）。
  //   根因（零机型分支）：旧实现把 requestNotifyPermission 的回调当成成/败二值——resolve 不是
  //   'granted' 就走失败分支（toast「未获得通知权限」＋notifyEnabled=false＋开关弹回关闭）。
  //   而安卓 Chrome / 国产 ROM 上「系统授权弹窗已经弹出、用户还没点允许」时，requestPermission
  //   就会先 resolve 成 'default'（'default' ＝ 还没决定，不是拒绝）——用户那一下点按就这样被
  //   吃掉、开关自己弹了回去；等他第二下点开关时权限其实已经在系统弹窗里被允许了 ⇒「第二下才开」。
  //   同一文件里启动恢复（#921g）与回填重读本就按「'default' ＝ 瞬态，不落 0、开关照常开」处理，
  //   只有这条手动开启路径口径不一致，本批把两者统一（不碰 #601d/#921f 语义、零机型分支）。
  //   新语义：granted ＝ 当场生效；denied ＝ 明确被拒，回弹开关（沿用原口径：显示开着却无效会误导）；
  //   unsupported ＝ 环境不支持，回弹；default ＝ 先按用户意图把开关亮着（不丢这一下），再把结果
  //   等出来（轮询 + 回前台/重新聚焦补查 + 用户下次点按借手势再请求一次），全程不再要求点第二下。
  const NB_SETTLE_MS = 12000; // 待决等待上限：覆盖「系统弹窗弹着、用户过几秒才点允许」的正常窗口
  let nbAttempt = 0;          // 每轮「用户动开关」的代号：回调/轮询只认自己那一轮，过期即弃
  let nbSettleTimer = null;
  let nbSettlePoke = null;    // 待决轮询的「探一脚」入口（回前台/重新聚焦时立刻补查）
  let nbAppliedFor = 0;       // 已落地的轮次（granted 可能从回调与轮询两边同时到）
  function nbAttemptNext() {
    nbAttempt++;
    if (nbSettleTimer) { clearTimeout(nbSettleTimer); nbSettleTimer = null; }
    nbSettlePoke = null;
    return nbAttempt;
  }
  function nbRevertOff() { notifyEnabled = false; gSet('bg-notify', '0'); syncNotifyUI(); }
  function nbApplyOn(my) {
    if (my !== nbAttempt || nbAppliedFor === my) return;
    nbAppliedFor = my;
    notifyEnabled = true;
    gSet('bg-notify', '1');
    syncNotifyUI();
    nbSyncPermWarn();   // #1014：权限已到位，撤掉行下那条标红说明（否则权限好了还挂着「还挡着」）
    showSysNotification('通知已开启', { body: '后台消息提醒将正常弹窗' });
    // FIX 2026-09-20 #924c：iPhone 如实告知能力边界——iOS WebKit 的系统通知只认
    //   「推送服务」通道（App Store 级推送服务端），纯本地应用没有推送服务，
    //   保活期间的后台弹窗不保证弹出＝平台限制、代码无法绕过；消息本身不丢，
    //   回前台有迟到补弹（#915 bgLateCatchup）与聊天记录兜底。
    if (kaIsIOS()) setTimeout(function () { toast('iPhone 提示：受系统限制，后台弹窗不保证弹出；消息不会丢，回来自动补看'); }, 1600);
    // v3.5.132：开启通知时自动联动开启后台保活——后台消息要"到达"必须
    //   页面定时器在后台仍运行（静音音频保活）；否则开关开了但页面休眠，
    //   消息根本不产生，通知永远不会弹（旧版只 toast 提醒，用户容易漏开）
    setTimeout(function () {
      const keep = document.getElementById('bg-keepalive');
      const keepOn = keepEnabled;
      // FIX 2026-09-16 #601d：用户已手动关过保活（存储 '0' 或标记 __ka-user-off=1）时
      // 不再强行打开——尊重用户选择，只提醒「通知要靠保活才收得到后台消息」。
      const userWantsKeepOff = gGet('bg-keepalive') === '0' || gGet('__ka-user-off') === '1';
      if (!keepOn && userWantsKeepOff) {
        toast('你已手动关闭「后台保活」，保持你的设置；但后台消息可能收不到通知，需要时请手动开启');
      } else if (!keepOn) {
        if (keep) keep.checked = true;
        keepEnabled = true;
        gSet('bg-keepalive', '1');
        gSet('__ka-user-off', '0');
        startKeepAlive(false);
        syncKeepUI();
        toast('已自动开启后台保活（后台消息必需）');
      }
      if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        toast('提醒：需 HTTPS 访问，浏览器才允许通知');
      }
    }, 400);
  }
  // ===== FIX 2026-09-22 #1014：开关＝用户意图；权限读数只决定「标红提示」与「自动生效」 =====
  //   用户实报（红米 K80 Chrome，同一族第三次）：「首次打开后台通知功能，还是会显示被浏览器拒绝，
  //   我第二次打开才有反应」「后台通知功能开启后，切后台会自动关闭」。
  //   根因（无头实测取证、零机型分支）：原实现把**一次** Notification.permission 读数当成用户的最终
  //   决定——启动/回填回读读到 'denied' 就 notifyEnabled=false 并把存储写死 '0'（实测：存量 '1' 在
  //   一次瞬态 denied 读数后永久变 '0'，随后权限已 granted 也回不来＝用户看到的「切后台自动关闭、
  //   要重新开一次」）；点开关时请求被弹回 'denied' 也当场回弹关闭＝「第一次显示被拒绝」。
  //   而同一台设备上 #921g 早已实测「丢弃重载/回前台」这类时机的权限读数是失真的（那次失真读数是
  //   'default'，故只把 'default' 当瞬态）；'denied' 同样会不经用户决定地产生——首次授权被浏览器的
  //   安静提示 UI 挡掉、授权框被切后台打断、弹框压根没弹出，网页侧读到的都是 'denied'，分不出
  //   「用户点了拒绝」与「浏览器没让用户看见这个问题」。
  //   新口径（三句）：①存储 'bg-notify' 只表达「用户想不想要」，只由用户自己改（任何读数都不写它）；
  //   ②权限不到位时开关保持开＋行下标红如实说明缺哪一步，权限一到位**自动生效**（不再点第二次）；
  //   ③真的没有通知能力的设备（无 Notification API / iPhone）仍按平台限制如实告知并回弹开关
  //   （那里没有「等一会儿就好」可言，见 #975/#978 口径）。
  function nbNoticeOnce(key, msg) {
    try { if (kaNoticeCool(key, 60 * 1000)) return; kaNoticeStamp(key); } catch (e) {}
    toast(msg, 7000);
  }
  function nbPermWarnText() {
    const p = nbPermState();
    if (p === 'unsupported') {
      // 能力限制与开关无关，一直显示（这类设备点多少次都不会好）
      return (window.mochiDevice || {}).isIOS
        ? '⚠ 本机拿不到系统通知（iPhone / iPad 平台限制，添加到主屏幕也不保证）：请用「桌面消息弹窗」的应用内横幅'
        : '⚠ 本机浏览器没有通知能力（小米 / vivo / OPPO 自带浏览器、UC、夸克、Via 常见如此）：请改用 Chrome / Edge 打开本站';
    }
    if (!notifyEnabled) return '';
    if (p === 'denied') return '⚠ 浏览器还挡着本站的通知权限：地址栏左侧图标 → 网站设置 → 通知 → 允许（开关已记住你的选择，允许后自动生效，不用再点一次开关）';
    if (p === 'default') return '⚠ 还没给本站通知权限：地址栏左侧图标 → 网站设置 → 通知 → 允许（开关已记住你的选择，允许后自动生效）';
    return '';
  }
  function nbSyncPermWarn() {
    try {
      const el = document.getElementById('bg-notify-perm-warn');
      if (!el) return;
      const t = nbPermWarnText();
      el.textContent = t;
      el.hidden = !t;
    } catch (e) {}
  }
  let nbWaitingGrant = false;   // 意图在、权限没到位＝正等一个授权（等到了自动生效）
  let nbWatchTimer = null;
  let nbWatchFor = -1;          // 等待窗属于哪一轮（同轮不重挂，见 nbArmWatch）
  function nbArmWatch(my) {
    const p0 = nbPermState();
    const want = !!notifyEnabled && (p0 === 'denied' || p0 === 'default');
    // 同一轮的等待窗已经挂着就别重挂（重复收口不得把检查点往后推）：
    if (nbWatchTimer && nbWaitingGrant && nbWatchFor === my && want) return;
    if (nbWatchTimer) { clearTimeout(nbWatchTimer); nbWatchTimer = null; }
    nbWaitingGrant = want;
    nbWatchFor = my;
    if (!nbWaitingGrant) return;
    let ticks = 0;
    const tick = function () {
      nbWatchTimer = null;
      if (my !== nbAttempt || !notifyEnabled) { nbWaitingGrant = false; return; }
      const p = nbPermState();
      try { nbSyncPermWarn(); } catch (e) {}   // #1014：读数为 default/unsupported 时标红说明也要跟着变
      if (p === 'granted') { nbWaitingGrant = false; nbApplyOn(my); return; }
      if (p === 'unsupported' || ++ticks >= 24) { nbWaitingGrant = false; return; }  // 2 分钟封顶，不做永动机
      nbWatchTimer = setTimeout(tick, 5000);
    };
    nbWatchTimer = setTimeout(tick, 5000);
  }
  // 用户把开关打开但权限没到位（请求被弹回 / 已被挡着 / 还没决定）时的统一收口：保住意图（开关不动、
  //   存储继续 '1'）、如实说明缺哪一步、挂上「下次点按借手势再请求一次」与「权限到位自动生效」两条路。
  function nbHoldOn(my, why) {
    if (my !== nbAttempt) return;
    notifyEnabled = true;
    gSet('bg-notify', '1');
    syncNotifyUI();
    nbSyncPermWarn();
    nbArmWatch(my);
    if (why === 'denied') {
      nbNoticeOnce('__nb-denied-note-at',
        '⚠ 浏览器这次没放行通知权限（可能没弹授权框就直接挡了）\n地址栏左侧图标 → 网站设置 → 通知 → 允许\n开关已记住你的选择：允许后自动生效，不用再点一次开关');
    }
    nbArmRetry(my);
  }

  // 待决结果轮询：#988 本体——不回弹，把「用户还没点允许」这段窗口等出来（先密后疏，最长 NB_SETTLE_MS）
  function nbSettleStart(my, quiet) {
    const start = Date.now();
    const tick = function () {
      if (my !== nbAttempt) return;
      if (nbSettleTimer) { clearTimeout(nbSettleTimer); nbSettleTimer = null; }
      const p = nbPermState();
      if (p === 'granted') { nbSettlePoke = null; nbApplyOn(my); return; }
      if (p === 'denied') {
        // FIX #1014：不再回弹关闭＋不再写 '0'——保住用户意图并标红说明（见上方 #1014 注释）
        nbSettlePoke = null;
        nbHoldOn(my, 'denied');
        return;
      }
      if (Date.now() - start < NB_SETTLE_MS) {
        nbSettleTimer = setTimeout(tick, (Date.now() - start) < 3000 ? 600 : 2000);
        return;
      }
      // 一直没决定：开关保持开启（用户的意图留着），如实指路＋挂「下次点按再请求一次」
      nbSettlePoke = null;
      if (!quiet) toast('通知权限还没定下来：地址栏左侧图标 → 网站设置 → 通知 → 允许；开关已为你保持开启，允许后自动生效');
      nbArmRetry(my);
    };
    nbSettlePoke = tick;
    nbSettleTimer = setTimeout(tick, 600);
  }
  // 借用户下一次点按的手势再请求一次授权（Chrome 要求 requestPermission 带手势）——
  //   把旧版的「再点一次开关」变成「回来随手点哪都行」，且失败不重复弹打扰
  function nbArmRetry(my) {
    const onTap = function () {
      document.removeEventListener('pointerdown', onTap, true);
      document.removeEventListener('keydown', onTap, true);
      if (my !== nbAttempt) return;
      const p = nbPermState();
      if (p === 'granted') { nbApplyOn(my); return; }
      if (p === 'denied') { nbHoldOn(my, 'denied'); return; }   // FIX #1014：同上，不回弹
      requestNotifyPermission(null, function () {}, { quiet: true });
      nbSettleStart(my, true);
    };
    document.addEventListener('pointerdown', onTap, true);
    document.addEventListener('keydown', onTap, true);
  }
  function nbPermRecheck() {
    try { if (nbSettlePoke) nbSettlePoke(); } catch (e) {}
    // FIX #1014：用户多半是「切出去到浏览器设置里允许、再切回来」——回前台当场把意图兑现，
    //   不要求他再点一次开关（这正是旧版「第二次打开才有反应」里那多出来的一下）。
    try { if (nbWaitingGrant && notifyEnabled && nbPermState() === 'granted') { nbWaitingGrant = false; nbApplyOn(nbAttempt); } } catch (e) {}
    try { nbSyncPermWarn(); } catch (e) {}
  }
  // 有些内核从后台切回只发 focus 不发 visibilitychange（同 #153/#724 族的自愈口径），补一路
  try { window.addEventListener('focus', nbPermRecheck); } catch (e) {}
  if (nbBtn) {
    nbBtn.addEventListener('change', function (e) {
      // #921f / #988：无真实输入的 change 忽略并回弹（丢弃唤醒重载的伪翻转不得写 '0'）
      if (!kaUserGesture(e)) { syncNotifyUI(); try { nbBtn.checked = notifyEnabled; } catch (er) {} return; }
      notifyUserTouched = true; // #88：手动动过 → 回填后不再重读覆盖
      const my = nbAttemptNext();
      if (nbBtn.checked) {
        const p0 = nbPermState();
        // 先点亮＝不丢用户这一下（#988 口径保持），结果交给回调/轮询/自动生效收口
        notifyEnabled = true;
        gSet('bg-notify', '1');
        syncNotifyUI();
        nbSyncPermWarn();
        if (p0 === 'unsupported') {
          // 本机根本没有通知能力（无 Notification API）：留着开只会误导，按平台限制如实回弹
          //   （#975/#978 口径不变；行下标红的能力说明与开关无关、一直显示）
          requestNotifyPermission(null, function () {
            if (my !== nbAttempt) return;
            nbAttemptNext(); nbRevertOff();
          });
          return;
        }
        requestNotifyPermission(function () {
          // 直接在系统弹窗里点了「允许」：当场收口（轮询只是兜底，别让用户多等/再点一下）
          if (my !== nbAttempt) return;
          nbApplyOn(my);
        }, function (why) {
          // FIX #1014：请求被弹回不再把开关关掉、不再写 '0'（用户实报「第一次被拒绝、第二次才有
          //   反应」与「切后台自动关闭」都由这条回弹产生）；改为保住意图＋标红说明＋等一次自动生效。
          nbHoldOn(my, why);
        });
        if (p0 === 'default') nbSettleStart(my, false);
        return;
      }
      // 关闭：立即落 '0'，并把在途的授权请求/轮询/自动生效全作废（迟到的授权不得把开关又打开）
      notifyEnabled = false;
      gSet('bg-notify', '0');
      nbWaitingGrant = false;
      if (nbWatchTimer) { clearTimeout(nbWatchTimer); nbWatchTimer = null; }
      nbAttemptNext();
      syncNotifyUI();
      nbSyncPermWarn();
    });
  }
  (function () {
    // v3.9.x：全局化迁移（同 bg-keepalive）
    let saved = gGet('bg-notify');
    if (saved === null) {
      const old = store.get('bg-notify');
      if (old !== null) { gSet('bg-notify', old); saved = old; }
    }
    // v3.5.131：恢复时校验权限（浏览器/系统回收权限后开关仍显示"开"但通知静默失效）。
    // FIX 2026-09-20 #921g：'default' 一律视为瞬态误读（诊断实锤：实际 granted 却被读成 default，
    //   开关被落 '0'＝「重进后通知自动关闭」）。
    // FIX 2026-09-22 #1014：把同一判断再推进一步——'denied' 也可能是瞬态/非用户决定（安静提示 UI、
    //   授权框被切后台打断、丢弃重载后的失真读数），所以**任何读数都不再改写存储与开关**：开关
    //   恢复用户存的意图，权限不足由行下标红如实说明，权限到位自动生效（见上方 #1014 注释）。
    //   实测（无头）：旧实现下一次瞬态 denied 就把存量 '1' 永久写成 '0'、权限随后 granted 也回不来。
    notifyEnabled = saved === '1';
    // v3.13.x：预热 badge 单色图——页面启动即后台生成，首条通知前通常已就绪
    if ('Notification' in window && Notification.permission === 'granted') { getBadgeUrl(function () {}); }
    syncNotifyUI();
    nbSyncPermWarn();
    if (notifyEnabled) nbArmWatch(nbAttempt);
  })();

  // ===== v3.26.x 修复 #88：IDB 回填完成后重读一次两个开关 =====
  // 症状：小米 14U Edge 反馈「后台通知有时候会自己关闭」。上面两个初始化 IIFE 在模块
  // 加载时同步读值，而本机 localStorage 已彻底不可用（诊断：xy-home-v2 键数 0 + 写探针
  // QuotaExceededError）——值只能等 idbRestore 异步回填进内存缓存，回填必然晚于这次同步
  // 读 → saved===null → 判成「关」（bg-keepalive / bg-notify 在 IndexedDB 里一直是新值，
  // xyStore.set 双写过）。「有时候」= 那次回填恰好赶在读值之前（或 LS 还有残值）。
  // 方案：回填完成 / #40 写日志合并后再读一次，按差量重新应用。差量式实现可重复调用，
  // 所以三个触发点（含回填挂起设备的定时兜底）都直接调它，不做「只跑一次」的状态机。
  // 边界：用户本会话手动动过某个开关 → 该开关不再重读覆盖（他的操作就是最新值）。
  function reheatBgSwitches() {
    if (!keepUserTouched) {
      const wantKeep = gGet('bg-keepalive') === '1' && gGet('__ka-user-off') !== '1';
      if (wantKeep !== keepEnabled) {
        keepEnabled = wantKeep;
        syncKeepUI();
        if (wantKeep) startKeepAlive(false);
        else stopKeepAlive(false);
        try { console.info('[mochi] #88 回填后重读后台保活：' + (wantKeep ? '开' : '关')); } catch (e) {}
      }
    }
    if (!notifyUserTouched) {
      // FIX 2026-09-22 #1014：回填只重读「用户意图」，不再看权限读数——一次失真的 denied 读数
      //   曾经把开关自己关掉并把存储写死 '0'（用户实报「开启后切后台会自动关闭」），
      //   权限不足改由行下标红条说明，权限到位自动生效。
      const wantNotify = gGet('bg-notify') === '1';
      if (wantNotify !== notifyEnabled) {
        notifyEnabled = wantNotify;
        syncNotifyUI();
        if (wantNotify) getBadgeUrl(function () {}); // 预热 badge 单色图（同初始化）
        try { console.info('[mochi] #88 回填后重读后台通知：' + (wantNotify ? '开' : '关')); } catch (e) {}
      }
      try { nbSyncPermWarn(); } catch (e) {}
      try { nbArmWatch(nbAttempt); } catch (e) {}
    }
  }
  try {
    if (window.__mochiDataReady) setTimeout(reheatBgSwitches, 0);
    else document.addEventListener('mochi-restore-done', function () { reheatBgSwitches(); });
    document.addEventListener('mochi-wrj-heal', function () { reheatBgSwitches(); });
    setTimeout(reheatBgSwitches, 16000); // 回填整体挂起设备的兜底
  } catch (e) {}
  // ===== 后台通知「测试」按钮＝「后台弹窗自测」（两段） =====
  // v3.5.115 起：点一下发条测试通知 + 环境诊断（安卓 Chrome 上通知不生效时一键定位卡在哪一环）。
  // v3.5.116：增强诊断——权限未授权时主动请求；发送后追加系统级通知检查提示（红米/小米 HyperOS：
  //   站点权限通过后系统设置里 Chrome 的通知仍可能被关，此时 API 不报错但通知不显示）。
  // FIX 2026-09-22 #1014（用户直派「后台弹窗自测功能还是不完整，而且点测试有延迟」；红米 K80 Chrome）：
  //   ①「延迟」＝结果 toast 被两件与本测试无关的事卡住——线上 version.json 的网络往返（无头实测：
  //     正常网络 26ms 出结果；把 version.json 拖慢 3000ms，结果就 3025ms 才出）＋SW 通知队列回读里
  //     写死的 500ms。现在结果只等「发送链落定」（通常一两百毫秒），版本比对与队列回读改成**不阻塞**
  //     地往同一条结果里补行。
  //   ②「不完整」＝旧测试只测「现在能不能发出一条通知」：既没报「后台通知开关本身开没开」（开关
  //     关着也照样报「链路全通」＝误导），也没报权限 / 后台服务 / 保活锚点的真实状态；更测不到用户
  //     真正关心的那一半——旧实现自己都在文案里承认「要验屏幕上方弹出请按 Home 切后台后再测一次」，
  //     把活推给用户。现在补成两段：第一段当场给「环境＋发送」结论；第二段是「后台阶段」——按 Home
  //     切后台后由页面在**隐藏态**真发一条，回前台给结论并问本人看到没有（系统横幅网页读不到，
  //     本人是唯一裁判，同 #761 口径）。
  const testBtn = document.getElementById('bg-notify-test');
  if (testBtn) {
    let testSeq = 0;          // 每轮点按的代号：迟到的异步结论只认自己那一轮
    let env = [];             // 结果行（第一段写满即出，后续证据原地追加）
    let resultShown = false;  // 结果单飞闸（发送/超时/队列回读三路只出一次，之后只改内容）
    let verStale = false;     // 旧包（#761）——排查步骤据此把「先升级」排在第一位
    const showResult = function () {
      if (!env.length) return;
      resultShown = true;
      toast('测试结果：\n' + env.join('\n'), 6000);
    };
    const pushLine = function (line) {
      if (env.indexOf(line) >= 0) return;
      env.push(line);
      if (resultShown) showResult();   // 已出过结果：原地重写同一条 toast（不重开一条，不动驻留窗口语义）
    };
    // 第一段·环境体检：全部本地读数，点下就有（不联网、不 await）——这就是「点测试不再有延迟」的一半
    const envCheck = function () {
      env = [];
      resultShown = false;
      verStale = false;
      env.push(notifyEnabled
        ? '✓ 后台通知开关：已开启'
        : '✗ 后台通知开关：未开启——后台消息不会弹通知（点本行开关把它打开）');
      const p = nbPermState();
      if (p === 'granted') env.push('✓ 通知权限：已允许');
      else if (p === 'default') env.push('✗ 通知权限：还没允许——地址栏左侧图标 → 网站设置 → 通知 → 允许');
      else if (p === 'denied') env.push('✗ 通知权限：被浏览器挡着——地址栏左侧图标 → 网站设置 → 通知 → 允许（允许后自动生效）');
      else env.push('✗ 通知权限：本机浏览器没有通知能力——请改用 Chrome / Edge（安卓或电脑都行）');
      let kp = null;
      try { kp = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null; } catch (e) {}
      if (!kp || !kp.keep) env.push('✗ 后台保活：未开启（后台不产生消息，通知无从弹起）');
      else {
        env.push((kp.audio && !kp.audio.paused) ? '✓ 后台保活：音频播放中' : '! 后台保活：音频已暂停（回本页自动恢复；后台消息可能到不了）');
        const anchor = [];
        if (kp.ms && kp.ms.metadata) anchor.push('媒体会话');
        if (kp.pc && kp.pc !== 'off') anchor.push('连接保活');
        if (kp.hb && kp.hb.n) anchor.push('心跳 ' + kp.hb.n + ' 拍');
        if (anchor.length) env.push('· 保活锚点：' + anchor.join(' / '));
        if (kp.ev && (kp.ev.stall || kp.ev.died)) env.push('! 历史取证：断流 ' + kp.ev.stall + ' 次 / 后台终止 ' + kp.ev.died + ' 次（被系统冻结或丢弃过——恢复口径见本行「功能说明」）');
      }
      // 后台服务（Service Worker）：本地读数、通常很快，但也不阻塞结果（慢就后补一行）
      try {
        kaSWReady().then(function (reg) {
          pushLine(reg
            ? '✓ 后台服务：已就绪（Service Worker 通道，切后台 / 关屏也能弹）'
            : '! 后台服务：未就绪——只会走页面通道，切后台就不弹了（刷新页面后重测）');
        });
      } catch (e) {}
    };
    // 第 1.5 层·回读 SW 通知队列：API 受理 ≠ 系统真挂出来（系统通知总开关被关时 showNotification
    //   照常受理）——把「应用内成功」与「系统层拦截」分开归因。不阻塞结果（#1014）。
    const queueProbe = function (wasHidden) {
      kaSWReady().then(function (reg) {
        if (!reg || !reg.getNotifications) return null;
        return new Promise(function (res) {
          setTimeout(function () {
            try { reg.getNotifications().then(res, function () { res(null); }); } catch (e) { res(null); }
          }, 500);
        });
      }).then(function (list) {
        const found = !!(list && list.some && list.some(function (n) { return n && n.title === '后台通知测试'; }));
        pushLine(found
          ? '✓ 已确认进入系统通知队列——手机上没看到＝系统层拦截（通知总开关/悬浮横幅/省电限制），见本行「功能说明」排查'
          : '! 已提交但未进系统通知队列＝多半被系统拦截，见本行「功能说明」排查');
        if (found && wasHidden) {
          pushLine('✓ 发送时页面在后台——屏幕上方应有横幅；没看见＝系统层拦截（通知总开关/悬浮横幅/省电限制）见本行「功能说明」');
        } else if (found) {
          pushLine('! 前台发送不弹顶层横幅——要验「屏幕上方弹出」请用下方第二段：按 Home 切后台（或锁屏）再发一条');
        }
      }).catch(function () {});
    };
    // 第 1.6 层·线上版本比对（要联网 ⇒ 只补行、绝不 gate 结果；#761 旧包检测口径不变）
    const verProbe = function () {
      try {
        const sv = document.getElementById('splash-ver');
        const localTs = Number(sv && sv.getAttribute('data-build-ts')) || 0;
        kaWithTimeout(function () { return fetch('./version.json?v=' + Date.now()); }, 4000)
          .then(function (r) { return r && r.json ? r.json() : null; })
          .then(function (d) {
            const ts = Number(d && d.ts) || 0;
            if (!localTs || !ts) pushLine('! 版本：没问到线上版本（网络受限，不影响本测试）');
            else if (ts > localTs) {
              verStale = true;
              pushLine('✗ 旧包正在运行：本页 ' + new Date(localTs).toLocaleString() + ' · 线上最新 ' + new Date(ts).toLocaleString() + '——「什么都没改弹窗突然全没」的常见原因，彻底关闭浏览器重开（升级新版本）后再测');
            } else pushLine('✓ 版本已最新：' + new Date(ts).toLocaleString());
          }, function () { pushLine('! 版本：没拉到 version.json（网络受限，不影响本测试）'); });
      } catch (e) {}
    };
    // 结果问人本人（#761 口径）：JS 全绿 ≠ 用户真看到横幅（浏览器端通知通道被拧死时 API 不报错、
    //   队列回读也可能正常）。第二段（后台阶段）复用同一套追问与排查步骤，只换问法与首句结论。
    const askSeen = function (phase2) {
      if (typeof window.openModal !== 'function') return;
      window.openModal('自检确认', '', function (choice) {
        if (choice === 'seen') {
          toast(phase2 ? '✓ 后台弹窗链路全通：切后台（锁屏）也能弹横幅' : '✓ 弹窗链路全通：以后后台消息没弹时，先回来点这个测试', 4000);
          return;
        }
        if (choice !== 'miss') return;
        const MARKS = ['①', '②', '③', '④'];
        const steps = [];
        const push = function (s) { steps.push(MARKS[steps.length] + ' ' + s); };
        if (verStale) push('先升级：本页是旧版本包——彻底关闭浏览器再重开（或点顶部「刷新使用新版」），旧包＝「没改任何东西弹窗突然全没」的头号原因');
        push('重置浏览器通知权限：浏览器设置 → 网站设置 → 通知 → 把本站「关闭」再「允许」，然后强杀浏览器重开（「权限明明开着、通知却消失好几天」多数被这一步救活——JS 读到的一直是 granted，坏的是浏览器内部那条通道）');
        push('系统通知设置：系统设置 → 通知管理 → 本浏览器 → 总开关打开、「允许横幅通知/在屏幕上方显示」打开、通知重要性选「提醒」；国产 ROM（vivo/OPPO/小米/华为）每项可能各自独立');
        push('省电限制：允许本浏览器后台运行/关闭对它的省电优化（否则挂后台时整页被冻结，消息与通知都无从产生）；Edge 的「睡眠标签页」/Chrome 的「内存节省程序」默认把挂后台约 30 分钟的页面丢弃重载（表现＝回来时页面自动刷新、保活/通知可能被重置）——浏览器设置里把本站加入「永不睡眠/始终保持活动」名单');
        steps.push('每做完一步就按 Home 键把页面切到后台、让 TA 发一条消息验证；全部走完仍不弹 → 用「信息诊断」里的反馈入口一键上报');
        window.openModal('没弹出 → 按顺序排查（实效从高到低）', '', function () {}, {
          noInput: true, big: true,
          staticText: steps.join('\n')
        });
      }, {
        noInput: true, lock: true,
        staticText: (phase2
          ? '刚才按 Home 把页面切到后台（或锁屏）之后，屏幕上方弹出「后台通知测试（后台阶段）」这条横幅了吗？\n（通知栏里有小图标 ≠ 屏幕上方弹出；锁屏界面上的通知算弹出）'
          : '刚才屏幕上方弹出「后台通知测试」横幅了吗？\n（通知栏里有小图标 ≠ 屏幕上方弹出；前台发送通常只进通知栏，要验横幅请用第二段：按 Home 切后台后再测一次）'),
        pills: [{ label: '看到了，顶部弹出', value: 'seen' }, { label: '没看到', value: 'miss' }],
        pillSubmit: true
      });
    };
    // ===== 第二段·后台阶段（#1014 新增）：补上「自测不完整」的那一半 =====
    //   旧测试只能在前台发通知，然后把「切后台再测一次」推给用户自己判断。这一段由页面自己在
    //   隐藏态真发一条：点「现在测」→ 按 Home（可锁屏）→ 后台 5 秒后自动发 → 回前台给结论并
    //   问本人看到没有。只在第一段发送成功（SW 通道）时才提供，避免把坏链路的结论混进第二段。
    const bgT2 = { armed: false, sent: false, ok: false, chan: '', reported: false, hideT: null, disarmT: null };
    const bgT2Arm = function () {
      if (bgT2.armed && !bgT2.sent) return;
      bgT2.armed = true; bgT2.sent = false; bgT2.ok = false; bgT2.chan = ''; bgT2.reported = false;
      toast('第二段已就绪：按 Home 把页面切到后台（可锁屏），5 秒后自动发一条；回到本页看结论', 7000);
      if (bgT2.disarmT) clearTimeout(bgT2.disarmT);
      bgT2.disarmT = setTimeout(function () { if (!bgT2.sent) bgT2.armed = false; }, 180000); // 3 分钟没切后台就作废
    };
    const bgT2Report = function () {
      if (!bgT2.armed || !bgT2.sent || bgT2.reported) return;
      if (document.visibilityState === 'hidden') return;   // 后台弹的 toast 用户看不见，等回前台再说
      bgT2.reported = true;
      bgT2.armed = false;
      if (bgT2.disarmT) { clearTimeout(bgT2.disarmT); bgT2.disarmT = null; }
      const chTxt = bgT2.chan === 'sw' ? 'Service Worker 通道' : (bgT2.chan === 'page' ? '页面通道（后台会被系统抑制）' : '通道未就绪');
      // #1014：让开一拍——回前台时主 visibilitychange 处理器可能同帧弹自己的提醒 toast，
      //   而 #cc-toast 是同一个元素、后弹的会盖掉先弹的，第二段的结论必须落地可见。
      const sayIt = function () { toast('第二段（后台阶段）结果：\n'
        + (bgT2.ok
          ? '✓ 页面切到后台后发出的通知已提交系统（' + chTxt + '）\n（通知栏里有小图标 ≠ 屏幕上方弹出，下面请如实回答）'
          : '✗ 页面切到后台后没能发出通知（' + chTxt + '）——后台弹窗这一半不通，见本行「功能说明」排查'), 8000); };
      setTimeout(sayIt, 700);
      if (bgT2.ok) setTimeout(function () { askSeen(true); }, 1800);
    };
    const offerPhase2 = function () {
      if (typeof window.openModal !== 'function') return;
      window.openModal('后台弹窗自测 · 第二段', '', function (choice) {
        if (choice === 'go') { bgT2Arm(); return; }
        // 不测第二段：照旧问一句「刚才那条看到了吗」（#761 的「结果一定问人本人」不丢——
        //   选了现在测则改由后台阶段的结论来问，同一句问话不在两处打断）
        if (choice === 'no') askSeen(false);
      }, {
        noInput: true,
        staticText: '第一段测的是「现在能不能发出通知」。第二段测你真正关心的那一半：按 Home 把页面切到后台（可锁屏）之后还会不会弹。\n\n点「现在测（切后台）」后：按 Home → 页面在后台 5 秒后自动发一条 → 回到本页即出结论并问你看没看到。\n（第一段前台发的那条通常只进通知栏，屏幕上方横幅只能这样验）\n点「不用了」＝只测第一段，会照旧问你一句「刚才那条看到了吗」。',
        pills: [{ label: '现在测（切后台）', value: 'go' }, { label: '不用了', value: 'no' }],
        pillSubmit: true
      });
    };
    document.addEventListener('visibilitychange', function () {
      if (!bgT2.armed) return;
      if (document.visibilityState === 'hidden') {
        if (bgT2.sent || bgT2.hideT) return;
        // 隐藏态才是「后台弹窗」真实发生的场景：等 5 秒再发（避开刚切走那一下的瞬时抖动）
        bgT2.hideT = setTimeout(function () {
          bgT2.hideT = null;
          if (!bgT2.armed || bgT2.sent || document.visibilityState !== 'hidden') return;
          bgT2.sent = true;
          try {
            const nm = store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
            showSysNotification('后台通知测试（后台阶段）', { body: '这条是在页面切到后台之后发出的 · 来自 ' + nm }, function (ch) { bgT2.chan = ch; })
              .then(function (ok) { bgT2.ok = !!ok; bgT2Report(); });
          } catch (e) { bgT2.ok = false; bgT2Report(); }
        }, 5000);
        return;
      }
      // 回到前台：没发出去的那次作废（没在后台待够），发出去的给结论
      if (bgT2.hideT) { clearTimeout(bgT2.hideT); bgT2.hideT = null; }
      bgT2Report();
    });
    const runTest = function (my) {
      const testWasHidden = document.hidden;   // 发送那一刻在不在后台（决定「屏幕上方横幅」怎么解释）
      let testChan = '';
      let settled = false;
      const settle = function () {
        if (my !== testSeq || settled) return;
        settled = true;
        showResult();
        // 第一段成功（真走了 SW 通道）：把「第二段·后台阶段」端上来（#1014 补全的那一半）
        if (testChan === 'sw') offerPhase2();
      };
      try {
        const name = store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
        showSysNotification('后台通知测试', { body: '来自 ' + name + ' · 如果能看到这条，后台通知就通了' }, function (ch) { testChan = ch; }).then(function (ok) {
          if (my !== testSeq) return;
          if (testChan === 'sw' && ok) {
            pushLine('✓ 测试通知已发送并真正提交系统显示（Service Worker 通道：后台关屏也能弹）');
          } else if (testChan === 'page') {
            pushLine(ok
              ? '✓ 测试通知已发送（页面通道：仅本页前台可见）'
              : '! 未真正送达：后台服务未就绪，页面通道在后台会被系统抑制（已挂自动补发，或刷新页面重试）');
          } else {
            pushLine('✗ 测试通知提交失败：被浏览器/系统拒绝——见本行「功能说明」排查（权限已允许仍被拒＝查系统设置里本浏览器的通知总开关）');
          }
          settle();
          // 两件证据都不阻塞结果（#1014 治延迟）：到了就原地补行
          if (testChan === 'sw' && ok) queueProbe(testWasHidden);
          verProbe();
        });
      } catch (e) {
        pushLine('✗ 测试执行异常：' + (e && e.message ? e.message : e));
        settle();
        return;
      }
      setTimeout(function () {
        if (my !== testSeq || settled) return;
        settled = true;
        pushLine('✗ 测试超时：通知发送链 8 秒未落定（应用内故障，非权限/系统问题）——请用「诊断信息」一键反馈');
        showResult();
      }, 8000);
    };
    testBtn.addEventListener('click', function () {
      const my = ++testSeq;
      toast('正在检查通知环境…');
      envCheck();
      if (!('Notification' in window)) {
        // 三分支（#978 口径不变）：非安全上下文 / iOS 平台限制 / 本机浏览器没有通知能力
        if (!window.isSecureContext) {
          pushLine('✗ 当前浏览器不支持 Notification API');
          pushLine('原因：' + location.protocol + '//' + location.host + ' 不是安全上下文，浏览器不开放通知能力');
          pushLine('解决：用 https:// 部署访问（GitHub Pages 即是 HTTPS）');
        } else if (kaIsIOS()) {
          pushLine('✗ 当前浏览器不支持 Notification API');
          pushLine('原因：iPhone / iPad 的网页拿不到系统通知（添加到主屏幕也不保证）');
          pushLine('解决：改用 设置 → 系统 →「桌面消息弹窗」的应用内横幅');
        } else {
          pushLine('✗ 当前浏览器不支持 Notification API');
          pushLine('原因：本机浏览器没有通知能力（小米 / vivo / OPPO 等自带浏览器、UC、夸克、Via 常见如此）');
          pushLine('解决：改用 Chrome / Edge 打开本站（安卓或电脑都行）');
        }
        showResult();
        return;
      }
      if (Notification.permission === 'default') {
        // 还没授权：借这一下的手势请求一次，请求结果回来立刻给结论（不做无声等待）
        Notification.requestPermission().then(function (p) {
          if (my !== testSeq) return;
          if (p === 'granted') { envCheck(); runTest(my); return; }
          pushLine('✗ 通知权限：这次没能拿到' + (p === 'denied' ? '（浏览器没放行——可能没弹授权框就直接挡了）' : '（还没在弹窗里做选择）'));
          pushLine('解决：地址栏左侧图标 → 网站设置 → 通知 → 允许（开关已记住你的选择，允许后自动生效）');
          showResult();
        }).catch(function () {
          if (my !== testSeq) return;
          pushLine('✗ 请求通知权限失败（浏览器没给授权框）——地址栏左侧图标 → 网站设置 → 通知 → 允许');
          showResult();
        });
        return;
      }
      runTest(my);
    });
  }

  // v3.5.132：从后台回到前台时做一次状态检查——通知开但保活被关 / 权限被回收
  //   都是静默失效（页面照常运行、通知就是不弹），回到前台时主动提示一次
  // v3.5.137：回到前台时补弹应用内横幅——后台期间收到的消息系统通知已进通知栏，
  //   但页面切回前台时应用内顶部横幅（desk-msg）不会自动出现；这里根据未读数
  //   在屏幕上方补一条横幅（点击默认进聊天），实现「切回即见新消息」的体验
  // v3.5.161：修复「回前台重弹看过消息」——之前用 chat-unread 总量判断，但它是
  //   你【看过消息前】的旧未读累计（进聊天页才清零），回前台会把前几分钟看过的
  //   消息当新消息重弹。改为：切后台时记录未读基数（resumeUnreadBase），回前台
  //   只提示【后台期间新增】的未读增量；无增量则完全不弹。
  // v3.19.x：回前台汇总改用「本次后台实际发送的通知数」——不再用 chat-unread 差值：
  //   chat-unread 是当前桌面未读数，跨桌面/psync 补投递会污染它，导致回前台
  //   弹「错误联系人名 + 错误条数」（用户实测：切换桌面后弹窗显示旧桌面昵称、没收到
  //   消息却说收到1条）。hiddenSentCount 只在 bgNotifyCheck 真正发送系统通知时累加，
  //   回前台时据此弹一条汇总，准确反映"后台真收到了几条、来自谁"。
  let hiddenSentCount = 0;
  let hiddenSentName = '';
  document.addEventListener('visibilitychange', function () {
    const vis = document.visibilityState;
    if (vis === 'hidden') {
      // 切后台：重置本次后台会话的发送计数（bgNotifyCheck 发送时累加）
      hiddenSentCount = 0;
      hiddenSentName = '';
      return;
    }
    if (vis !== 'visible') return;
    // FIX 2026-09-21 #988：通知授权弹窗挂着时用户常切出去看/点「允许」——回前台立刻重查一次
    // 权限状态，待决的那一轮当场收口（不必等轮询到点，更不必让用户再点一次开关）
    nbPermRecheck();
    // FIX 2026-09-21 #1001：两条「设备/权限限制」提示的回前台补出口——启动时页面若在后台
    //（被系统丢弃重载后的常见形态），开屏/前台条件当场不满足，回前台这里补上
    try { kaNoticeAfterSplash(tryShowKaDiedNotice); } catch (e) {}
    try { if (kaPermNoticeArmed) kaNoticeAfterSplash(nbPermPendingNotice); } catch (e) {}
    const saved = gGet('bg-notify');
    if (saved === '1') {
      const keepOn = keepEnabled;
      if (!keepOn) {
        toast('提醒：后台保活已关闭，后台消息到不了，通知不会弹（设置里开启）');
      }
    }
    // 补弹汇总：仅当本次后台【真的发送过系统通知】时，用实际发送数与发送者名
    try {
      const chatPage = document.getElementById('page-chat');
      const inChat = chatPage && !chatPage.hidden;
      const n = hiddenSentCount;
      const who = hiddenSentName || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
      hiddenSentCount = 0;
      hiddenSentName = '';
      if (!inChat && n > 0 && window.showDeskPopup) {
        // visibilitychange 为 visible 时触发，isHidden=false 显示应用内横幅
        window.showDeskPopup({ name: who, text: '你不在的时候收到 ' + n + ' 条新消息', isHidden: false });
        const now = Date.now();
        if (saved === '1' && 'Notification' in window && Notification.permission === 'granted' &&
            (!lastResumeNotifyAt || now - lastResumeNotifyAt > 30000)) {
          lastResumeNotifyAt = now;
          // v3.21.x：汇总通知也带联系人头像（右位大图标）——此前只发文字，通知右侧无头像。
          // 取当前桌面聊天头像（与 bgNotifyCheck 同口径），等比缩略后作 icon，失败回退原文。
          const notiIcon = (store.get('cs-avatar-partner') || store.get('avatar-partner') || '');
          const sendNoti = function (iconVal) {
            const o = { body: '你不在的时候收到 ' + n + ' 条新消息' };
            if (iconVal) o.icon = iconVal;
            showSysNotification(who, o);
          };
          if (notiIcon && (notiIcon.indexOf('data:') === 0 || /^https?:\/\//i.test(notiIcon))) {
            makeAvatarThumb(notiIcon, function (u) { sendNoti(u || notiIcon); });
          } else {
            sendNoti('');
          }
        }
      }
    } catch (e) {}
  });
  let lastResumeNotifyAt = 0; // v3.5.154：回前台汇总通知去重

  // v3.12.x：修复「刚聊完切后台，通知栏弹出几分钟前已看过的消息」——
  // bgNotifyCheck 原来只判断「页面是否隐藏」，对内容毫无记忆：切后台后保活定时器
  // 继续跑，回复链剩余部分/下一轮主动发送/查岗卡等一旦产出与刚才对话相同或延续的
  // 内容，就原样再发一条系统通知（用户视角：明明看过的消息又弹一遍）。两道闸门：
  //   ① 隐藏时长门槛：切后台头 15 秒内的"消息"多为切换过渡期定时器到点
  //     （用户刚看完/马上回来看），不发系统通知；
  //   ② 内容去重：与【最近聊天记录里 TA 已说过的内容】或【最近已发过的通知】
  //     相同（指纹一致）→ 不再重复弹通知。消息本体照常进聊天记录和角标。
  // v3.13.x 修正误杀（用户反馈：只听见消息声音、后台却不弹窗）——原实现把图片/表情包
  // 统一归一成 [附件] 指纹，30 分钟内第二条图片消息或撞车的常见短语必被误拦：
  //   - 附件指纹加入图片本体采样（MIME + 长度 + 3 个错位段哈希）——不同图片互不误判，
  //     同一张图重复发仍可去重；
  //   - 历史聊天查重窗口 30→15 分钟、已发通知查重窗口 10→6 分钟，误杀面减半；
  //   - 文本指纹取前 60→100 字符，常见短语互撞更少。
  let lastVisibleAt = Date.now();
  let lastHiddenAt = 0; // v3.16.x：最近一次切后台时刻（修复过渡期闸门失效）
  (function () {
    const markVisible = function () {
      if (document.visibilityState === 'visible') {
        lastVisibleAt = Date.now();
        lastHiddenAt = 0;
      } else if (document.visibilityState === 'hidden') {
        lastHiddenAt = Date.now();
      }
    };
    document.addEventListener('visibilitychange', markVisible);
    window.addEventListener('pageshow', markVisible);
    window.addEventListener('focus', markVisible);
  })();
  const NOTIFY_HIDDEN_MIN_MS = 15000;
  // v3.20.x：去重窗口大幅缩短（15→5 分 / 6→2 分 / 新增前台看过 3 分）——
  // 「经常收不到」的根因：TA 字卡池有限（常用短语/表情包重复率高），长窗口内容去重
  // 会把【内容恰好与最近聊过/发过相同的新消息】误判为重放而吞掉。重放源头已分别
  // 堵住（psync 补投递 silent、切后台过渡期 15s 闸门、回前台按实际发送数汇总），
  // 去重只需覆盖「几分钟内的同条消息多机制重弹」短窗口即可
  const NOTIFY_CHAT_DUP_MS = 5 * 60000;  // v3.20.x：历史聊天查重 15→5 分钟
  const NOTIFY_SENT_DUP_MS = 2 * 60000;  // v3.20.x：已发通知查重 6→2 分钟
  const NOTIFY_SEEN_DUP_MS = 3 * 60000;  // v3.20.x：前台看过记忆 15→3 分钟
  // FIX 2026-09-17 #673：过渡期（切后台头 15s）的「看过内容」判定窗——比常规 5 分钟更宽。
  //   过渡期原来是「一律不弹」，防的是切后台瞬间积压定时器重放用户刚看过的内容；代价是把
  //   这 15 秒里真正新产生的消息也整条丢掉：TA 回复延迟默认 1~40 秒（设置→回复速度），
  //   用户发完消息立刻切出应用时回复常落在窗内 ⇒ 聊天记录里有、通知栏始终没有
  //   （红米K80 Chrome 等多机型同报「后台弹窗又收不到」）。
  //   现过渡期只做内容判定，且窗口加宽到 30 分钟：重放内容（#498 防重弹面）拦得更死，
  //   真新内容放行。窗口只在过渡期用，窗外的常规判定仍走 NOTIFY_CHAT_DUP_MS 5 分钟。
  const NOTIFY_FRESH_CHAT_DUP_MS = 30 * 60000;
  // v3.23.x：lastNotifySentAt 已随 batchBurst 一并移除（重放放大器，见 bgNotifyCheck 内注释）
  // 通知文本归一化：剥 dataURL/语音 ||| 段/SVG 标签，去空白后取前 100 字符做指纹
  function normNotifyKey(raw) {
    let s = String(raw || '');
    if (s.length > 1024) s = s.slice(0, 1024); // 先截断再正则，避免超长 base64 全文替换开销
    s = s.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]')
      .replace(/@@m:[0-9a-f]{32}/g, '[附件]') // FIX 2026-09-13 #401 令牌串入指纹同口径
      .replace(/\|\|\|.*$/, '')
      .replace(/<[^>]*>/g, '');
    return s.replace(/\s+/g, '').slice(0, 100);
  }
  // dataURL 采样哈希（v3.13.x）：不读 base64 全文，取 MIME + 长度 + 3 个错位散列——
  // 不同图片指纹互异（不再因都显示成 [图片] 而互判重复），相同图片重复发采样一致仍可去重
  function sampleDataUrl(dataUrl) {
    try {
      if (!dataUrl || typeof dataUrl !== 'string') return '';
      const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
      const b64 = m ? dataUrl.slice(m[0].length) : dataUrl;
      const h = function (shift) {
        let x = 0;
        for (let i = shift; i < b64.length; i += 7) x = (x * 31 + b64.charCodeAt(i)) & 0x7fffffff;
        return x.toString(36);
      };
      return '|' + (m ? m[1] : '?') + ':' + b64.length + ':' + h(0) + ':' + h(1) + ':' + h(2);
    } catch (e) { return ''; }
  }
  // 组装消息去重指纹：文本指纹 + 附件采样。纯附件消息（正文是 [图片]/[表情包] 占位、
  // 空串、或本身是 dataURL）且带图时，文本基统一为 [附件] —— 与聊天记录里纯图消息
  // （text 即 dataURL，扫描时抽出为 img）的指纹口径一致，保证查重能对上
  function msgFingerprint(text, img) {
    let t = String(text || '');
    const isPh = /^\[(图片|表情包|语音|附件)\]$/.test(t.trim());
    const imgOnly = isPh || !t.trim() || t.indexOf('data:') === 0;
    let k = normNotifyKey(imgOnly && img ? '[附件]' : t);
    const a = sampleDataUrl(img);
    if (a) k += a;
    return k;
  }
  // 最近窗口内聊天记录里 TA 是否已说过同样内容（扫尾部最多 150 条，命中即回）
  // v3.14.x：refTs=本次通知对应的到达时刻——用于把「这条新消息自己刚入库的条目」
  // 排除出扫描（卡片类是提示语+卡面两条几乎同时入库，见循环内说明）
  function recentChatDup(key, refTs, windowMs) {
    if (!key) return false;
    try {
      const arr = window.getChatMsgs ? window.getChatMsgs() : null;
      if (!arr || !arr.length) return false;
      // FIX 2026-09-17 #673：窗口可传入（默认常规 5 分钟）——过渡期用加宽窗判定「已看过/重放」
      const cutoff = Date.now() - (windowMs || NOTIFY_CHAT_DUP_MS);
      // v3.13.x 修复：聊天消息到达是「先入库（addRec msgs.push）再走 bgNotifyCheck」，
      // 查重扫历史会把【刚到达的这条】自己判成"最近说过"而吞掉通知（用户表现：联系人
      // 发消息有提示音但从不弹窗）。v3.14.x 演进：不再按下标跳过末尾条目——卡片类是
      // 「提示语+卡面」两条几乎同时入库，只跳末尾一条会让刚看过的卡面永远扫不到
      // （隐藏态再触发同文案时照样重弹，用户实测）；改为从末尾整条扫 + 按时间戳自排除：
      // 与本次通知时刻相近(refTs±)或刚入库(墙钟 2.5s 内)的条目都视为"这条新消息自己"。
      // 兜底处理迟到入库（refTs 远新于条目 ts 的延迟处理场景）不误吞。
      for (let i = arr.length - 1, n = 0; i >= 0 && n < 150; i--, n++) {
        const m = arr[i];
        if (!m) continue;
        const mts = m.ts || 0;
        if (mts && mts < cutoff) break; // 追加有序，更早的不可能落在窗口内
        // v3.14.x：自排除——本次通知对应的新入库条目（到达时刻±2.5s 或墙钟刚落库）
        if (refTs && (mts >= refTs - 2500 || (!mts && i === arr.length - 1) || Date.now() - mts < 2500)) continue;
        if (m.side !== 'in') continue;
        let t = m.text || '';
        let img = '';
        // v3.13.x：parts 化消息——图片/表情包/语音的 dataURL 一并采样，参与指纹比对
        if ((!t || t.indexOf('data:') === 0) && m.parts && m.parts.length) {
          const texts = [], images = [];
          for (let p = 0; p < m.parts.length; p++) {
            const part = m.parts[p];
            if (!part || !part.k) continue;
            if (part.k === 'text') texts.push(part.v);
            else if (part.k === 'image' || part.k === 'sticker' || part.k === 'voice') images.push(part.v);
          }
          t = texts.join(' ');
          img = images[0] || '';
        } else if (t.indexOf('data:') === 0) {
          img = t; // 无 parts 的旧式纯图消息：dataURL 即正文
          t = '';
        } else if (t.indexOf('|||') >= 0) {
          // v3.13.x：旧式语音消息 text 为「名称|||音频dataURL」——与探针/通知侧一致地
          // 剥离 ||| 段再比指纹，否则带语音文本查不到历史（语音段剥离后同指纹）
          t = t.split('|||')[0];
        }
        const mf = msgFingerprint(t, img);
        // v3.23.x：恢复精确相等无条件拦截（回退 v3.21.x 的 60 秒豁免）——
        // 60 秒豁免实测 reopen 了重放：用户在前台看过的字卡内容，切后台后
        // 自动发送/冻结定时器补跑撞车同内容（间隔 >60 秒）→ 照弹「几分钟前
        // 看过的消息」（红米 K80 等多设备复现）。字卡池有限，内容撞车无法与
        // 「TA 真的又说了一遍」区分，用户口径：近期（5 分钟窗口）同内容一律不弹，
        // 消息本体照常进聊天。防「收不到」用 v3.21.x 的 1.6 倍包含收紧即可（保留），
        // 精确相等不再放开
        if (mf === key) return true;
        // v3.14.x：双向包含兜底——互动卡的通知文本是「前缀+卡面」（如「TA想问你一个问题：」+
        // 卡面、「TA 来查岗了：」+卡面），聊天记录里存的却是裸卡面/裸提示语条目，精确相等
        // 永远对不上 → 已看过的卡片再被任何机制触发时照样重弹系统通知。
        // v3.21.x：包含比对收紧——原「较短边 ≥6 字即参与」在字卡池有限时会误吞全新短消息：
        // 新消息「在吗」是 5 分钟内旧消息「在吗？我想你了」的子串 → 被当成重放吞掉
        // （用户实测：经常收不到）。收紧为【较长边 ≥ 短边 ×1.6 且短边 ≥6 字】才参与——
        // 互动卡「前缀+卡面」场景仍命中（前缀明显更长），普通短语互为子串不再误杀
        if (mf.length >= 6 && key.length > mf.length && key.length >= mf.length * 1.6 && key.indexOf(mf) >= 0) return true;
        if (key.length >= 6 && mf.length > key.length && mf.length >= key.length * 1.6 && mf.indexOf(key) >= 0) return true;
      }
    } catch (e) {}
    return false;
  }
  // 最近已发过同内容的系统通知（跨"生成源不同但文本相同"兜底）
  const notifiedRecently = new Map();
  function notifiedDup(key) {
    if (!key) return false;
    const last = notifiedRecently.get(key);
    return !!(last && Date.now() - last < NOTIFY_SENT_DUP_MS);
  }
  function markNotified(key) {
    if (!key) return;
    notifiedRecently.set(key, Date.now());
    if (notifiedRecently.size > 60) { // 上限防膨胀：删最早的（Map 保持插入序）
      notifiedRecently.delete(notifiedRecently.keys().next().value);
    }
  }
  // v3.14.x：「前台已看过」指纹记忆——此前前台收到内容时 bgNotifyCheck 直接裸返回、
  // 什么都不记：同一条内容稍后再被任何机制触发（冻结定时器补跑/回复链延续/同类卡
  // 再抽中），只要错过已发窗口与历史扫描窗口，就会再以系统通知形式弹出用户刚在
  // 聊天里看过的内容。现在前台展示的同时记入 seenRecently（TTL 与历史扫描窗口一致，
  // 15 分钟），后台侧把它当作第三道去重闸门。
  const seenRecently = new Map();
  function markSeen(key) {
    if (!key) return;
    seenRecently.set(key, Date.now());
    if (seenRecently.size > 80) { // 上限防膨胀：删最早的（Map 保持插入序）
      seenRecently.delete(seenRecently.keys().next().value);
    }
  }
  function seenDup(key) {
    if (!key) return false;
    // v3.20.x：前台看过记忆用独立短窗口（3 分钟）——字卡池有限，长窗口会把
    // 「内容恰好相同的新消息」误吞（用户实测：经常收不到后台弹窗）
    const last = seenRecently.get(key);
    return !!(last && Date.now() - last < NOTIFY_SEEN_DUP_MS);
  }
  // v3.13.x：拦截统计——诊断"只听见声音不弹窗"时一屏看出每条消息卡在哪道闸门
  let gateStats = { total: 0, tooFresh: 0, dup: 0, replay: 0, sent: 0 };
  window.bgNotifyGateStats = function () { return Object.assign({}, gateStats); };
  // 只读探针：诊断/回归用——给定文本（+可选图片 dataURL、可选本次到达时刻 refTs）
  // 当前会被哪道闸门拦下
  window.bgNotifyGateInfo = function (text, img, refTs) {
    const nkey = msgFingerprint(text, img);
    // FIX 2026-09-17 #673：过渡期由「一律不弹」改为「只拦看过的内容」——这里把运营判定那
    //   一步（过渡期内 + 该内容是聊天近期已有内容）暴露给回归脚本：全新消息在这两步下组合
    //   =false（放行），重放内容 =true（拦截）。守卫住「切后台头 15s 不再整条吞 TA 新回复」。
    const transitionBlocks = lastHiddenAt > 0 && Date.now() - lastHiddenAt < NOTIFY_HIDDEN_MIN_MS &&
      recentChatDup(nkey, refTs, NOTIFY_FRESH_CHAT_DUP_MS);
    return {
      hiddenForMs: Date.now() - lastVisibleAt,
      // v3.16.x：过渡期用「切后台时刻 lastHiddenAt」——切后台头 15 秒内的积压消息不弹
      tooFreshHidden: lastHiddenAt > 0 && Date.now() - lastHiddenAt < NOTIFY_HIDDEN_MIN_MS,
      transitionBlocks: transitionBlocks,
      dupNotified: notifiedDup(nkey),
      dupSeen: seenDup(nkey),
      dupInChat: recentChatDup(nkey, refTs),
      // #780：身份闸门读数——本条此前有一次「在场投递」或「已弹过通知」即为 true
      identityBlocked: (function () {
        try {
          const d = window.__mochiMsgDelivered ? window.__mochiMsgDelivered(refTs, 'in') : null;
          return !!(d && (d.vis || d.nAt));
        } catch (e) { return false; }
      })(),
      nkey: nkey
    };
  };

  // #915：「刚从真后台回前台」探针——默认判据：本次回前台前在后台 ≥60s，且回前台未超 8s
  // （补触发链都在此刻同步/毫秒级跑完）。互动卡/心愿等低频触发器后台期被冻结、回前台补触发
  // 才生成卡片，产生方据此给 bgNotifyCheck 打 late 标补弹系统通知（走同一套去重闸门）。
  window.bgLateCatchup = function (minHiddenMs, winMs) {
    return Date.now() - _fgResumeAt < (winMs || 8000) && _fgFromHiddenFor >= (minHiddenMs || 60000);
  };
  // 供 chat.js（showDeskPopup 联动）/ 信箱 / 朋友圈调用：TA 相关新事件且页面不在
  // 前台时弹系统通知。第三参 extra：name 通知标题（信箱/朋友圈/机制名，默认 TA 昵称）、
  // img 图片 dataURL（通知 image 字段显示缩略图）；头像 + 昵称 + 时间（精确到秒）+ 内容
  window.bgNotifyCheck = function (text, ts, extra) {
    if (!notifyEnabled) return;
    extra = extra || {};
    // v3.12.x：两道闸门（详见上方注释）——过渡期不弹 + 已看过/已弹过的内容不重弹
    // v3.13.x：指纹由文本+附件采样构成——图片/表情包用本体采样去重，不同图片不再互拦
    // v3.14.x：前台收到改为「记 seen 指纹后返回」而非裸返回——用户已在应用内看到的
    // 内容，之后任何机制再次触发同文案都不再重复弹系统通知
    const nkey = msgFingerprint(text, extra.img);
    // #915：late＝「刚从真后台回来的迟到补弹」（产生方经 window.bgLateCatchup 判定后打标）。
    // 前台默认不弹系统通知（用户在场，看见即已读语义）；迟到补弹例外继续走后面的
    // 去重闸门——不在这里 markSeen（否则下面的 seenDup 会被自己刚记的账吞掉），
    // 同一内容前台真看过（seenDup/已发窗）照样吞，绝不双弹。
    if (document.visibilityState === 'visible') { if (!extra.late) { markSeen(nkey); return; } }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // FIX 2026-09-18 #780：消息身份闸门（治「切后台突然弹前几分钟看过的消息」）——
    // 整页冻结解冻时积压的回复链一口气重投，下面三道内容去重窗口起点全是 Date.now()
    // （已弹 2min / 已看 3min / 历史 5min），冻结几分钟就全部熬过期，重放被判成新内容。
    // 内容指纹加宽会误吞同文案的真消息（v3.20.x 已反复折过），这里改按【消息身份】判：
    // chat.js 每条消息首次投递时打了 dAt/dVis（dVis=1＝用户当场看得见），本次触发距那次
    // 投递已 >200ms（非同一条投递链）且当时在场 ⇒ 这是重放，只留聊天记录与角标，不进通知栏。
    // 同理 nAt（本条通知已受理过）永不再弹第二遍——内容指纹的 2 分钟窗会被冻结时长熬过期，
    // 消息自身的身份标记不会。force（来电等一次性事件）照旧绕过。
    if (!extra.force && extra.msgTs) {
      try {
        const d = window.__mochiMsgDelivered ? window.__mochiMsgDelivered(extra.msgTs, 'in') : null;
        if (d && (d.vis || d.nAt)) { gateStats.replay++; return; }
      } catch (e) {}
    }
    gateStats.total++;
    // v3.31.x：extra.force —— 一次性事件（如来电通知）不适用过渡期/去重闸门：
    // 来电是「错过就没了」的单发事件，切后台头 15 秒内命中、或与近期通知文案
    // 相同（「XX 来电了」高频重复）都不该被拦。消息类通知仍走原三道闸门。
    const force = !!extra.force;
    // v3.16.x：过渡期闸门改用「切后台时刻」——lastVisibleAt 是最近一次回前台时间，
    // 前台久驻后（如看了 10 分钟）它很旧，切后台瞬间积压的定时器批量到点产生的
    // 一堆消息会全部通过闸门 → 弹出大量看过的内容。改为切后台头 15 秒内一律不弹
    // FIX 2026-09-17 #673：过渡期由「一律不弹」改为「只拦看过的内容」——防重弹本意完整
    //   保留（切后台瞬间积压定时器重放的都是聊天记录里已有的内容，加宽窗拦得更死，见
    //   NOTIFY_FRESH_CHAT_DUP_MS），但不再连这 15 秒内真正新产生的消息一起吞掉
    //   （用户报障形态：发完消息就切出去，TA 在 1~40 秒随机延迟内回复 → 落在窗内 →
    //   聊天有、通知栏没有）。force（来电等一次性事件）照旧绕过。
    if (!force && lastHiddenAt > 0 && Date.now() - lastHiddenAt < NOTIFY_HIDDEN_MIN_MS &&
        recentChatDup(nkey, ts, NOTIFY_FRESH_CHAT_DUP_MS)) { gateStats.tooFresh++; return; }
    // v3.23.x：回退 v3.22.x 的 batchBurst（30 秒内同文案放行）——实测是重放放大器：
    // 切后台后 15 秒过渡期一过，撞车内容在上一条通知 30 秒内可绕过全部去重再次弹出，
    // 正是「切后台马上弹几分钟前看过的消息」的组成来源。v3.22.x 想解决的「批量连发
    // 撞车只弹一条」从未有用户反馈，属于臆造场景；真正的批量连发各条内容不同，
    // 本就不会被内容去重拦截
    if (!force && (notifiedDup(nkey) || seenDup(nkey))) { gateStats.dup++; return; }
    if (!force && recentChatDup(nkey, ts)) { gateStats.dup++; return; }
    // FIX 2026-09-19 #800：受理记账从「发送成功回调」提前到「决定发送」的同步点——
    // markNotified 原在 showSysNotification().then(ok) 里才落账，而发送链前段还有头像
    // 裁剪（Image onload，#673 起最长 1200ms 截止）等异步段。同一条消息在**同一同步任务**
    // 里被投两次时（昵称/头像池定时更换、ta-ask/ck-question/incoming-requests 互动卡：
    // addRec→showDeskMsg→bgNotifyCheck 一路 ＋ 各机制显式补发一路，如 avatar-lib 昵称
    // 定时更换就先后调了两次），第二发在第一发落账前到达，notifiedDup/seenDup/
    // recentChatDup（刚入库 2.5s 内条目自排除）全部查空放行 ＝ 一条内容弹两条一模一样
    // 的系统通知（红米 K80 Chrome 实报「联系人换昵称系统消息重复一条」，其他消息机制
    // 同构、其他设备型号同现）。改为决定发送即同步记账；发送失败在回调里回滚
    // （v3.12.x「受理成功才记已发、失败可重试」语义不变）。零机型分支。
    gateStats.sent++; markNotified(nkey);
    // v3.19.x：累加「本次后台实际发送的通知数」——回前台汇总用它（见 visibilitychange
    // 处理器），发送者名取本次通知标题
    hiddenSentCount++;
    hiddenSentName = extra.name || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
    const name = extra.name || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
    let t = '';
    if (ts) {
      const d = new Date(ts);
      // v3.5.138：时间精确到秒（原只有 时:分）
      t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    }
    // v3.5.142：正文防乱码——任何混入的 dataURL（图片/表情包/语音）都替换为占位文案，
    // 图片本体由 image 字段单独显示缩略图
    // v3.6.x：正则从 data:image/ 扩展到任意 data:MIME/（覆盖 data:audio/ 等），
    // 并清除语音「名|||dataURL」里 ||| 之后的音频 dataURL，避免 base64 乱码
    const body = String(text || '收到一条新消息')
      .replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]')
      // FIX 2026-09-13 #401 媒体池令牌串→[图片]（含令牌的消息预览不再直出 @@m:hash 乱码）
      .replace(/@@m:[0-9a-f]{32}/g, '[图片]')
      .replace(/\|\|\|.*$/, '');
    // v3.x.x：称呼跟随——通知正文里的 TA/他 按当前联系人性别替换（纯文本，安全）
    const bodyFitted = window.taFit ? window.taFit(body) : body;
    const opts = { body: (t ? t + '  ' : '') + (bodyFitted && bodyFitted.length > 40 ? bodyFitted.slice(0, 40) + '…' : bodyFitted) };
    // v3.5.156：修正安卓通知字段语义（此前 icon/badge/image 用反，导致
    // 「左侧浏览器图标、右侧 mochi、无头像」）：
    //   - badge（左侧小图标，单色）= mochi 字母图标（showSysNotification 兜底设）
    //   - icon（右侧大图标）= 联系人头像（v3.5.158：始终用头像，不被消息图顶替）
    //   - image（展开大图）= 消息图片（可选，有才设）
    // 头像/图片 dataURL → blob URL，安卓 Chrome 可靠渲染
    let bigIcon = '';   // 右侧大图标：联系人头像；无头像时兜底 mochi 字母图标（见下）
    let previewImg = ''; // 展开大图：消息图片
    // v3.5.158：右侧固定显示联系人头像——即使消息带表情包/图片，右侧仍是 TA 的头像，
    // 消息图只放 image（展开大图），不顶替头像位置
    // v3.7.x：跨桌面——extra.av（朋友圈通知的发布者头像）优先，其次当前桌面 TA 头像
    // v3.13.x：头像互动/换头像 v3.12.x 起只写聊天专用键 cs-avatar-partner（桌面
    // avatar-partner 独立不再跟随），后台通知此前仍读桌面键 → 通知弹窗头像不跟随换头像；
    // 与通话/聊天域同口径：先 cs-avatar-partner，未设回退 avatar-partner
    // v3.14.x：无头像时 icon 兜底 NOTIFY_ICON——此前 icon 缺省时大图标位空置，
    // 部分系统/浏览器会把通知左侧也渲染成浏览器默认图标；现在至少保证 mochi 字母图标
    //（https URL，SW 随时可取）。media 不再各自转 blob URL，dataURL 原样上交
    // showSysNotification 统一 Blob 化直传（页面冻结后 blob: URL 取不到图是左侧
    // 回退浏览器默认图标的根因）
    // avFixed：调用方已给出权威头像（如跨桌面联系人头像），即使为空也不再回退当前桌面头像，
    // 避免把「当前桌面的联系人头像」错当成跨桌面联系人头像显示；空值由下方兜底 mochi 图标。
    const avatar = extra.avFixed
      ? (extra.av || '')
      : (extra.av || store.get('cs-avatar-partner') || store.get('avatar-partner') || '');
    if (avatar && (avatar.indexOf('data:') === 0 || /^https?:\/\//i.test(avatar))) bigIcon = avatar;
    if (!bigIcon) bigIcon = NOTIFY_ICON;
    if (extra.img && (extra.img.indexOf('data:') === 0 || /^https?:\/\//i.test(extra.img))) previewImg = extra.img;
    // v3.21.x：头像为「等比缩略图」，统一走模块级 makeAvatarThumb
    const cropAvatarToSquare = makeAvatarThumb;
    // v3.14.x：发送链路收敛——icon 裁剪完成后连同消息图一次性交
    // showSysNotification（内部统一 dataURL→Blob 直传 + 逐级降级重发）
    const sendFinal = function (iconVal) {
      if (iconVal) opts.icon = iconVal;
      if (previewImg) opts.image = previewImg;
      // v3.12.x：受理成功才记入"已通知"指纹（窗口内同内容不再重弹）
      showSysNotification(name, opts).then(function (ok) {
        if (ok) {
          // FIX 2026-09-18 #780：受理成功再按【消息身份】落一个永久标记（随 rec 落盘）——
          // 内容指纹的 2 分钟已发窗口会被冻结时长熬过期，身份标记不会。写失败一律静默。
          // （#800：内容指纹的已发记账已提前到决定发送的同步点，这里只剩身份标记。）
          try { if (extra.msgTs && window.__mochiMsgNotified) window.__mochiMsgNotified(extra.msgTs, 'in'); } catch (e) {}
        } else {
          notifiedRecently.delete(nkey); // #800：发送失败回滚决定点早记账，保留「失败可重试」
        }
      });
    };
    if (bigIcon) {
      // v3.15.x：裁剪失败不再丢弃头像——回退原图交给 showSysNotification 的
      // prepMediaBlobs 转 Blob；此前裁剪失败 cb('') 会直接丢头像导致通知无头像
      // v3.20.x：data: 与 http(s) 头像都走 1:1 裁剪，杜绝通知 icon 位拉伸变形
      // FIX 2026-09-17 #673：裁剪加截止时间——makeAvatarThumb 依赖 Image.onload/onerror，
      //   页面被后台冻结/解码卡住时两个回调都不来 ⇒ showSysNotification 永不被调用、
      //   通知静默消失（与 #614 同族的「永不落地」，只是卡在图片这一步）。到点未回
      //   照发（不带头像，showSysNotification 会兜底 mochi 图标），不再等一张图。
      const cropFired = { v: false };
      const cropTimer = setTimeout(function () { if (!cropFired.v) { cropFired.v = true; sendFinal(''); } }, 1200);
      cropAvatarToSquare(bigIcon, function (u) {
        clearTimeout(cropTimer);
        if (cropFired.v) return;
        cropFired.v = true;
        sendFinal(u || bigIcon);
      });
    } else {
      sendFinal(bigIcon);
    }
  };
  // v3.21.x：头像「等比缩略图」——canvas 尺寸跟随图片本身宽高比，只整体缩放到
  // 最长边 96px，不裁切、不填充、不改变比例，避免原图在通知上被拉长/裁掉边缘；
  // 跨域图污染 canvas 时 toDataURL 抛错走 cb('') 回退原图，不影响通知发送。
  function makeAvatarThumb(dataUrl, cb) {
    try {
      const img = new Image();
      if (/^https?:\/\//i.test(dataUrl)) { img.crossOrigin = 'anonymous'; }
      img.onload = function () {
        try {
          // #292：零尺寸图（无固有宽高的 SVG 等）直接回退原图，避免缩成 1×1 白点
          if (!img.width || !img.height) { cb(''); return; }
          const maxSide = 96;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          // #292：先铺白底再绘制——JPEG 无透明通道，带透明区域的头像（PNG/默认图）
          // 直接导出会让透明像素落成黑色＝通知右侧大图标显示全黑方块
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          cb(c.toDataURL('image/jpeg', 0.85));
        } catch (e) { cb(''); }
      };
      img.onerror = function () { cb(''); };
      img.src = dataUrl;
    } catch (e) { cb(''); }
  }
  // ================= v3.15.x：离线消息提醒（Periodic Background Sync，零后端） =================
  // 页面全关后浏览器定期唤醒 SW（见 src/pwa/sw.js 同名段）：SW 读本段写入的快照弹通知。
  // 本段职责：①设置开关+状态行；②注册/注销 periodicsync；③把「当前联系人可发文案」
  // 快照写进 IDB 根键 xy-home-v2:psync-snap；④开屏就绪后把 SW 留下的 xy-home-v2:psync-queue
  // 队列按联系人安全补投递进聊天（只走 chatAddIn 内存链路——绝不直写 chat-msgs，
  // 遵守 v3.14.x 切桌面覆盖事故的教训）。
  // 边界如实展示在状态行：仅 Chromium 系支持、需添加到桌面、频率由浏览器策略决定；
  // 进程被杀无法唤醒（那需要真推送服务端，纯本地架构不引入）。iOS Safari 无此 API。
  const PSYNC_TAG = 'mochi-ta-msg';
  const PSYNC_SNAP_KEY = 'xy-home-v2:psync-snap';
  const PSYNC_QUEUE_KEY = 'xy-home-v2:psync-queue';
  const PSYNC_SNAP_TTL = 7 * 24 * 60 * 60 * 1000;
  // 兜底想念语：自建字卡不足时也保证有内容可发（k:'bl' 标记内置）
  const PSYNC_BUILTIN = [
    '刚看到一句话，想起你了。',
    '你在忙吗？我这边刚刚想到你。',
    '没什么事，就是想跟你说句话。',
    '今天也要好好吃饭呀。',
    '突然很想你，就说一声。',
    '记得喝水，别总忘了。',
    '晚安前跟你说一声，我在。',
    '有空的时候理理我呀。'
  ];
  function psyncSupported() {
    try { return 'serviceWorker' in navigator && 'PeriodicSyncManager' in window; } catch (e) { return false; }
  }
  function psyncStandalone() {
    try { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches); } catch (e) { return false; }
  }
  function psyncEnabled() { return gGet('psync-en') === '1'; }
  function psyncPlainCard(s) {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    if (!t || t.length > 60) return false;
    if (t.indexOf('|||') >= 0) return false;               // 语音卡
    if (t.indexOf('data:') === 0) return false;            // 图片/表情包
    // FIX 2026-09-12 #383 媒体池令牌卡（37 字符、无 |||、非 data:）不进保活通知文字
    if (window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false;
    if (t.indexOf('http:') === 0 || t.indexOf('https:') === 0) return false;
    return true;
  }
  function psyncShuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = r[i]; r[i] = r[j]; r[j] = t; }
    return r;
  }
  function psyncBuildSnapshot() {
    let cc = [];
    try { cc = ((window.getCustomCards ? window.getCustomCards() : []) || []).filter(psyncPlainCard).slice(0, 40); } catch (e) { cc = []; }
    const picks = [];
    psyncShuffle(cc).forEach(function (t) { picks.push({ t: t.trim(), k: 'cc' }); });
    psyncShuffle(PSYNC_BUILTIN).slice(0, 4).forEach(function (t) { picks.push({ t: t, k: 'bl' }); });
    const snap = {
      v: 1,
      ts: Date.now(),
      cid: window.__activeCid || 'default',
      name: (function () { try { return store.get('lbl-partner') || 'TA'; } catch (e) { return 'TA'; } })(),
      texts: psyncShuffle(picks).slice(0, 12)
    };
    window.__psyncSnapCount = snap.texts.length;
    try { if (window.idbSet) window.idbSet(PSYNC_SNAP_KEY, snap); } catch (e) {}
    return Promise.resolve(snap);
  }
  window.__psyncBuildSnapshot = function () { return psyncBuildSnapshot(); };
  async function psyncApply() {
    if (!psyncSupported() || !psyncEnabled()) { psyncSyncStatus(); return; }
    try {
      await navigator.serviceWorker.ready;
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st && st.state === 'denied') { psyncSyncStatus('denied'); return; }
      await navigator.periodicSync.register(PSYNC_TAG, { minInterval: 6 * 60 * 60 * 1000 });
      await psyncBuildSnapshot();
    } catch (e) {}
    psyncSyncStatus();
  }
  async function psyncTeardown() {
    try { if (psyncSupported() && navigator.periodicSync.getTags) {
      const tags = await navigator.periodicSync.getTags();
      if (tags.indexOf(PSYNC_TAG) >= 0) await navigator.periodicSync.unregister(PSYNC_TAG);
    } } catch (e) {}
    psyncSyncStatus();
  }
  async function drainPsyncQueue(force) {
    if (!window.idbGet || !window.idbSet || !window.chatAddIn) return 0;
    try { if (!force && performance.now() < 10000) return 0; } catch (e) {} // 开屏 10s 内不动，等聊天权威数据就绪
    let arr = null;
    try { arr = await window.idbGet(PSYNC_QUEUE_KEY); } catch (e) { return 0; }
    if (!Array.isArray(arr) || !arr.length) return 0;
    const cur = window.__activeCid || 'default';
    const remain = [];
    let delivered = 0;
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!it || typeof it.t !== 'string' || !it.t.trim()) continue;
      if (!it.ts || Date.now() - it.ts > PSYNC_SNAP_TTL) continue;   // 过期丢弃
      if ((it.cid || 'default') !== cur) { remain.push(it); continue; } // 别的桌面的留着
      let dup = false;                                               // 防重复：最近 10 条同文本 30 分钟内视为已投递
      try {
        const msgs = window.getChatMsgs ? window.getChatMsgs() : null;
        if (Array.isArray(msgs)) {
          for (let j = Math.max(0, msgs.length - 10); j < msgs.length; j++) {
            const m = msgs[j];
            if (m && m.side === 'in' && m.text === it.t && Math.abs((m.ts || 0) - it.ts) < 30 * 60000) { dup = true; break; }
          }
        }
      } catch (e) {}
      if (!dup) { try { window.chatAddIn(it.t, { initiative: 1, silent: true }); delivered++; } catch (e) {} }
    }
    try { await window.idbSet(PSYNC_QUEUE_KEY, remain); } catch (e) {}
    return delivered;
  }
  window.__psyncDrain = function (force) { return drainPsyncQueue(force === true); };
  function psyncSyncStatus(state) {
    const el = document.getElementById('psync-status');
    if (!el) return;
    const isIOS = !!(window.mochiDevice || {}).isIOS;
    if (!psyncSupported()) {
      el.textContent = isIOS
        ? '此浏览器不支持离线提醒（iPhone / iPad 拿不到；请靠「后台保活」+「桌面消息弹窗」的应用内横幅）'
        : '此浏览器不支持离线提醒（需要 Chromium 内核：安卓或电脑上的 Chrome / Edge，并把应用添加到主屏幕后重开此开关）';
      return;
    }
    if (!psyncEnabled()) { el.textContent = '已关闭 · 页面全关后不再收到 TA 的消息提醒'; return; }
    if (!psyncStandalone()) { el.textContent = '需先添加到主屏生效：浏览器菜单「添加到主屏幕」，再从桌面图标打开本应用，然后重新打开此开关'; return; }
    if (state === 'denied') { el.textContent = '已开启 · 但后台调度被系统/浏览器拒绝：多半是通知权限被关了。请 ①在本应用网址栏左侧打开「网站设置」→通知→允许；②手机 系统设置→应用→Edge/Chrome→通知→允许；③该应用开启「不受限制/省电」；再回来关闭并重新打开此开关'; return; }
    if ('Notification' in window && Notification.permission !== 'granted') {
      el.textContent = '已开启 · 还需允许系统通知（会弹授权，点「允许」才能收到提醒弹窗）';
      return;
    }
    let n = (typeof window.__psyncSnapCount === 'number') ? window.__psyncSnapCount : 0;
    el.textContent = '已开启 · 待发文案 ' + n + ' 条 · 后台频率由系统定（约数小时一次）；收不到请检查：系统设置允许本浏览器通知，且不限制其后台运行/省电';
  }
  // 使用说明弹窗（见 psync-help 功能说明标签）：怎么开 / 为什么开不了 / 有什么用
  const psHelp = document.getElementById('psync-help');
  if (psHelp) {
    const openPsyncHelp = function (e) {
      if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (er) {} }
      const txt = [
        '离线消息提醒（零后端）\n',
        '🌟 有什么用',
        '页面全部关闭后，TA 也会在后台「留话」提醒你，营造陪伴感。系统每隔几小时唤醒一次，随机抽一条你准备（或内置）的想念字卡，以 TA 的名义弹出系统通知；回来后这条消息也会补进聊天记录。\n',
        '🔗 它和「后台弹窗」无关',
        '两者是完全独立的功能，互不影响。后台弹窗要的是「页面还在后台时」TA 发消息、靠后台保活+通知权限弹横幅。不开离线消息提醒，后台弹窗照常工作；反之亦然。想收到后台弹窗时，只需：后台保活+桌面消息弹窗开关开着+系统通知允许。\n',
        '🔓 怎么开（安卓）',
        '1. 用 Chrome 或 Edge（安卓）打开本应用；',
        '2. 浏览器菜单 →「添加到主屏幕」，再从桌面图标打开；',
        '3. 打开本开关，系统弹通知授权时点「允许」；',
        '4. 到手机 系统设置→应用→浏览器，确认「通知」允许、且未限制后台/省电。\n',
        '⚠️ 为什么有人开不了',
        '· iPhone：iOS 不支持此技术，只能靠系统通知/保活；',
        '· 非 Chrome/Edge 的安卓浏览器：不支持，请换用；',
        '· 没添加到主屏：需先从桌面图标打开才能调度；',
        '· 开了却收不到：多半是系统关了通知，或浏览器被省电/后台清理。\n',
        '📌 注意',
        '它不是真推送，频率由系统决定（约数小时一次）、只随机抽一条；也不代表对方真实在线。'
      ].join('\n');
      const ctl = window.openModal('离线消息提醒 · 功能说明', '', function () {}, {
        noInput: true,
        staticText: txt
      });
      // openModal 的确认按钮文案走 ctl.okText()（opts.okText 不被 openModal 读取，原写法静默无效、按钮显示「确定」）
      if (ctl && ctl.okText) ctl.okText('知道了');
    };
    psHelp.addEventListener('click', openPsyncHelp);
    psHelp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPsyncHelp(); }
    });
  }
  // 设置开关（全局键 psync-en，与保活/通知同款 gGet/gSet）
  const psBtn = document.getElementById('psync-en');
  function syncPsyncUI() { if (psBtn) psBtn.checked = psyncEnabled(); }
  if (psBtn) {
    psBtn.addEventListener('change', function () {
      const on = psBtn.checked;
      gSet('psync-en', on ? '1' : '0');
      psyncSyncStatus();
      if (on) {
        const go = function () { psyncApply(); };
        if ('Notification' in window && Notification.permission === 'default' && typeof requestNotifyPermission === 'function') requestNotifyPermission(go);
        else go();
        toast(on ? '离线消息提醒已开启' : '离线消息提醒已关闭');
      } else psyncTeardown();
    });
  }
  // 调度钩子：开屏就绪刷快照+分批补投递；回前台/切桌面刷新
  setTimeout(function () { psyncApply(); }, 8000);
  [12000, 27000, 47000].forEach(function (ms) { setTimeout(function () { try { drainPsyncQueue(false); } catch (e) {} }, ms); });
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      try { drainPsyncQueue(false); } catch (e) {}
      try {
        if (psyncEnabled() && psyncSupported()) {
          const last = window.__psyncLastSnapAt || 0;
          if (Date.now() - last > 300000) { window.__psyncLastSnapAt = Date.now(); psyncApply(); }
        }
      } catch (e) {}
    });
  } catch (e) {}
  try {
    document.addEventListener('contact-switched', function () {
      setTimeout(function () {
        try { drainPsyncQueue(false); } catch (e) {}
        if (psyncEnabled() && psyncSupported()) psyncBuildSnapshot();
      }, 3000);
    });
  } catch (e) {}

  // v3.26.x：监听 SW notificationclick 回传——后台弹窗/离线提醒被点击时 SW 聚焦窗口后
  // 发 MOCHI_NOTIFY_CLICK，页面端调 enterChat 跳到聊天页（与桌面悬浮消息点击同款入口）。
  // enterChat 由 chat.js 定义为 window.enterChat，此处仅消费全局 API，不跨域改 chat.js。
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (!e || !e.data || e.data.type !== 'MOCHI_NOTIFY_CLICK') return;
        try { if (typeof window.enterChat === 'function') window.enterChat(); } catch (x) {}
      });
    }
  } catch (e) {}
})();
