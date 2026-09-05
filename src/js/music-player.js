// ===== 功能：音乐（音乐库 / 歌单 / 听歌记录 / TA 互动 / 悬浮播放小框） =====
// 仿星言简约版【星音陪伴】：本地音频上传、网易云链接添加、批量导入、
// 歌单、听歌记录、TA 按概率请求一起听歌、歌曲结束 TA 可能接动作、悬浮小框可拖动
(function () {
  // v3.9.x：音乐数据全局共享——所有桌面共用同一份音乐库/歌单/历史/收藏/设置，
  // 固定读写 default 桌面命名空间（xy-home-v2:default:music-*）。各桌面原先独立
  // 的音乐数据由 mergeDesksMusic() 一次性合并迁移到 default（合并后清除源桌面的
  // 库/歌单键，见该函数注释；已上传的本地音频文件 IDB 仍保留作备份）。
  // 本地音频文件 IDB 键固定用 default 前缀。
  const MUSIC_PREFIX = 'xy-home-v2:default';
  const store = window.storeFor('default');
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    // v3.10.x：不设内联 opacity——内联 style.opacity 优先级高于 CSS 规则，
    // 本模块 toast 设 '1' 后若被其他模块 toast 打断（clearTimeout 清掉本
    // 回调），其他模块的 timer 回调只移除 show class、不清内联，残留的
    // opacity:1 会让 #cc-toast 永久可见（用户反馈"黑色弹窗不消失"）。
    // 统一只操作 className，靠 CSS 动画 ccToastAutoHide + JS timer 双兜底。
    t.style.opacity = '';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }

  // ================= 数据 =================
  let library = [];          // {id,name,artist,url,source,duration,playlistId,addedAt}
  let playlists = [];        // {id,name,createdAt}
  let history = [];          // {id,trackId,trackName,triggerType,ts} —— TA 邀请听歌记录
  let myHistory = [];        // {id,trackId,trackName,ts} —— 我的听歌记录（自己点击播放）
  let hisSubTab = 'ta';      // 听歌记录二级子 tab：ta（TA 邀请）/ mine（我的）；默认 ta 与原 tab 语义一致
  // v3.14.x：梦角主动控制概率可调——taNextProb/taRandProb/taModeProb=歌曲播完时
  // 梦角接动作（切下一首/随机挑一首/换播放模式）的概率；taFavProb=我播放歌曲时
  // 联系人把歌收进「TA的收藏」的概率。默认值与原硬编码行为一致（15/10/5）。
  const DEF_SETTINGS = { floatEn: true, reqProb: 5, cooldownMs: 600000, widgetCoverMode: 'song', taNextProb: 15, taRandProb: 10, taModeProb: 5, taFavProb: 20, taReserveProb: 6, taPauseProb: 3, taPauseEn: true };
  let settings = Object.assign({}, DEF_SETTINGS);
  // 概率取值兜底：非数字/越界时回退默认值并夹在 0~100
  function probOf(v, def) { const n = (typeof v === 'number' && !isNaN(v)) ? v : def; return Math.max(0, Math.min(100, n)); }
  let currentId = null;
  let mode = 'list';         // list / shuffle / single
  let audio = null;
  let progressTimer = null;
  let floatClosed = false;   // 悬浮小框手动收起
  let floatMin = false;      // 悬浮小框是否处于最小（最初版最小单行小框）状态
  let floatHideByWidget = false; // 桌面小组件触发播放时抑制悬浮小框自动唤出（小组件本身就是控制器，避免重复弹出）
  let taActive = false;      // TA 请求过一起听歌后置 true，歌曲结束 TA 可能接动作
  let cooldownAt = 0;        // TA 音乐请求冷却时间戳
  let reqData = null;        // 待确认的 TA 请求 {trackId}
  let curTab = 'lib';
  let playQueue = [];        // 播放队列：用户点「下一首播放」加入的歌曲 id 列表，播完当前手动/自动切歌时优先按序播放
  let localPlId = 'default'; // 本地上传的目标播放列表（歌单），单选歌曲时由弹窗决定
  let failMap = {};          // 连续播放失败计数（songId→次数），每次成功播放清零；用于区分临时/网络失败与真坏链
  // v3.29.x：本地音频内存缓存——uploadFiles 时把 Blob/dataURL 存这里，playTrack 本地
  // 分支优先同步查缓存，保留用户手势上下文（idbGet 异步会丢手势→play() 被 NotAllowedError
  // 拒→muted 解锁失败后 armAutoResume retry 用 m.url='' 必失败→本地歌播不出→TA 互动全失效）
  const localBlobCache = {};

  function loadArr(k) { try { const v = JSON.parse(store.get(k) || 'null'); return Array.isArray(v) ? v : []; } catch(e){ return []; } }
  function saveArr(k, a) { store.set(k, JSON.stringify(a)); }

  function partnerName() { return window.activeStore().get('lbl-partner') || 'TA'; }
  function findTrack(id) { return library.find(m => m.id === id) || null; }
  function fmtDur(sec) {
    if (isNaN(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
  }
  function fmtDT(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // v3.6.x：完整 HTML 转义（只转 < 可被 `&lt;…&gt;` 实体绕过注入）
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // ================= 自定义歌曲封面 =================
  // 封面存在时渲染圆形/圆角缩略图（背景图），否则渲染音符图标
  function songIcoHtml(m, icon) {
    if (m && m.cover) {
      return '<span class="sm-song-ico has-cov" style="background-image:url(\'' + esc(m.cover) + '\')"></span>';
    }
    return '<span class="sm-song-ico"><svg viewBox="0 0 24 24" fill="currentColor">' + (icon || '<path d="M8 5.5v13l11-6.5z"/>') + '</svg></span>';
  }
  // 封面图片压缩到最长边 512px JPEG（几十 KB，不撑爆存储；画布失败回退原图 dataURL）
  function compressCover(file, cb) {
    let url = null;
    try { url = URL.createObjectURL(file); } catch (e) {}
    if (!url) {
      const r = new FileReader();
      r.onload = () => cb(r.result);
      r.onerror = () => cb('');
      try { r.readAsDataURL(file); } catch (e) { cb(''); }
      return;
    }
    const img = new Image();
    img.onload = function () {
      try { URL.revokeObjectURL(url); } catch (e) {}
      let w = img.width, h = img.height;
      if (!w || !h) { cb(''); return; }
      const k = Math.min(1, 512 / Math.max(w, h));
      w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) { cb(''); return; }
      try { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h); } catch (e) { cb(''); return; }
      try { cb(c.toDataURL('image/jpeg', 0.82)); } catch (e) { cb(''); }
    };
    img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} cb(''); };
    img.src = url;
  }

  // ================= 存储 =================
  function saveLibrary() { saveArr('music-library', library); }
  // v3.10.x：批量补时长/封面时逐条 saveLibrary 是 O(n) 次全量序列化（大歌单卡顿），
  // 1.5s 内合并为一次；中途退出最多丢最后一批，下次打开对仍缺时长的歌会重新探测
  let _saveLibTimer = null;
  function saveLibrarySoon() {
    if (_saveLibTimer) return;
    _saveLibTimer = setTimeout(function () { _saveLibTimer = null; saveLibrary(); }, 1500);
  }
  function savePlaylists() { saveArr('music-playlists', playlists); }
  function saveHistory() { saveArr('music-history', history); }
  function saveMyHistory() { saveArr('music-my-history', myHistory); }
  function saveSettings() { store.set('music-global', JSON.stringify(settings)); }
  function loadAll() {
    library = loadArr('music-library');
    playlists = loadArr('music-playlists');
    history = loadArr('music-history');
    myHistory = loadArr('music-my-history');
    // v3.9.x：旧版本把"我自己点击听歌"也写进了 music-history（triggerType==='' 且非 mode/rejected），
    // 与 TA 邀请听歌记录混在一起。这里一次性迁移到 music-my-history 并从 music-history 删除，
    // 老用户的历史不丢且自动分开。迁移幂等：已迁移过的记录在 myHistory 里，music-history 里不再有。
    {
      let migrated = false;
      const mine = [];
      history = history.filter(h => {
        if (h && !h.mode && !h.rejected && !h.triggerType) {
          mine.push(h); migrated = true; return false;
        }
        return true;
      });
      if (mine.length) {
        const existIds = new Set(myHistory.map(h => h && h.id));
        mine.forEach(h => { if (!existIds.has(h.id)) { myHistory.push(h); existIds.add(h.id); } });
        if (myHistory.length > 500) myHistory = myHistory.slice(-500);
      }
      if (migrated) { saveHistory(); saveMyHistory(); }
    }
    try { settings = Object.assign({}, DEF_SETTINGS, JSON.parse(store.get('music-global') || '{}')); } catch(e) {}
    // 旧字段兼容：url 歌曲标记 source
    library.forEach(m => { if (!m.source) m.source = m.url ? 'url' : 'local'; });
    // 首次运行：内置默认歌单
    if (!playlists.length && !store.get('music-default-done')) {
      playlists.push({ id: 'spl_default', name: '默认歌单', createdAt: Date.now() });
      store.set('music-default-done', '1');
    }
    if (!playlists.some(p => p.id === 'spl_default')) {
      playlists.unshift({ id: 'spl_default', name: '默认歌单', createdAt: Date.now() });
    }
    // v3.9.x：不再自动放入内置示例歌曲（原「首次运行往默认歌单放 2 首种子歌」逻辑已移除）——
    // 音乐库由用户自行上传/导入，默认歌单不预置任何歌曲
    // v3.5.112：网易云外链已恢复可用（302 → 真实 CDN mp3，无需请求头）。
    // 旧版本曾把种子歌曲强制替换成本地 14 秒旋律并清空 url——检测这类旧数据，
    // 自动恢复网易云外链（source:'url'），让默认歌曲回到完整版；
    // 本地旋律仅在外链播放失败时兜底（见 setupHandlers / playTrack）。
    // v3.6.x：种子歌 url 直接用 meting API（api.injahow.cn/meting 302 → https CDN），
    // 不经 music.163.com/song/media/outer/url（302 → http CDN，HTTPS 页面下被
    // 混合内容拦截）。旧数据/备份恢复后自动规范成 meting URL，不管数据怎么来的
    // v3.7.x：加强自愈——
    // ① 检测所有 url 含 outer/url 旧格式的歌（不只种子歌），替换成 meting URL
    //    （旧版导入的歌也可能是 outer/url，HTTPS 下全被混合内容拦截）
    // ② 种子歌额外强制 source='url'，避免旧数据 source='local' 导致 playTrack
    //    走本地路径（IDB 无数据 → 兜底内置旋律，用户听不到原曲）
    library.forEach(m => {
      if (!m || !m.neteaseId) return;
      const seedId = String(m.neteaseId);
      const isSeed = (seedId === '2613048732' || seedId === '27538343');
      const target = neteaseMetingUrl(seedId);
      const hasOldOuterUrl = m.url && /music\.163\.com\/song\/media\/outer\/url/i.test(m.url);
      if (hasOldOuterUrl || (isSeed && (m.url !== target || m.source !== 'url'))) {
        m.url = target;
        m.source = 'url';
        saveLibrary();
        if (isSeed) { try { if (window.idbDelete) window.idbDelete(MUSIC_PREFIX + ':music-file:' + m.id); } catch (e) {} }
      }
    });
    // v3.9.x：移除内置种子歌——旧版本自动放入的默认歌曲（id 以 sm_seed_ 开头）在
    // 升级后自动删除；原「种子歌自愈补回」逻辑同步移除，默认歌单不再自动补任何歌曲
    {
      const before = library.length;
      library = library.filter(m => !(m && m.id && m.id.indexOf('sm_seed_') === 0));
      if (library.length !== before) {
        saveLibrary();
        // 清理种子歌可能残留的本地音频文件（IDB）
        try {
          if (window.idbGetAllKeys) {
            window.idbGetAllKeys().then(keys => {
              keys.filter(k => k.indexOf(MUSIC_PREFIX + ':music-file:sm_seed_') === 0)
                .forEach(k => { if (window.idbDelete) window.idbDelete(k); });
            });
          }
        } catch (e) {}
      }
    }
    mergeDesksMusic();
  }

  // v3.9.x：多桌面音乐合并——把所有非 default 桌面的音乐库/歌单/历史合并到 default
  // 共享库（按 id 去重），本地音频文件从各桌面 IDB 拷贝到 default IDB（已存在则跳过）。
  // v3.14.x：一次性迁移——合并完成即置 music-merge-done 标记并清除源桌面 music-* 键。
  // 原实现「不删除原桌面数据、每次启动重复合并」导致用户在共享库里删除的歌曲，重启后
  // 又被旧桌面备份合并回来（用户反馈「音乐里能播放已删除的歌曲」）。现在首次合并后
  // 源键已清 + 标记挡住后续合并，即使旧备份导入把源桌面键恢复回来也不会再合并。
  function loadArrFrom(s, k) { try { const v = JSON.parse(s.get(k) || 'null'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function mergeDesksMusic() {
    let contacts = [];
    try { contacts = window.getContacts() || []; } catch (e) {}
    const otherCids = contacts.map(c => c.id).filter(id => id && id !== 'default');
    if (store.get('music-merge-done')) return;
    if (!otherCids.length) { store.set('music-merge-done', '1'); return; }
    const libIds = new Set(library.map(m => m && m.id));
    const plIds = new Set(playlists.map(p => p && p.id));
    const histIds = new Set(history.map(h => h && h.id));
    const myHistIds = new Set(myHistory.map(h => h && h.id));
    let changed = false;
    let myChanged = false;
    otherCids.forEach(cid => {
      let s; try { s = window.storeFor(cid); } catch (e) { return; }
      loadArrFrom(s, 'music-library').forEach(m => {
        if (!m || !m.id || libIds.has(m.id)) return;
        library.push(m); libIds.add(m.id); changed = true;
      });
      loadArrFrom(s, 'music-playlists').forEach(p => {
        if (!p || !p.id || plIds.has(p.id)) return;
        playlists.push(p); plIds.add(p.id); changed = true;
      });
      loadArrFrom(s, 'music-history').forEach(h => {
        if (!h || !h.id || histIds.has(h.id)) return;
        history.push(h); histIds.add(h.id); changed = true;
      });
      loadArrFrom(s, 'music-my-history').forEach(h => {
        if (!h || !h.id || myHistIds.has(h.id)) return;
        myHistory.push(h); myHistIds.add(h.id); myChanged = true;
      });
    });
    if (changed) { saveLibrary(); savePlaylists(); saveHistory(); }
    if (myChanged) { saveMyHistory(); }
    // v3.14.x：源桌面键清理 + 一次性迁移标记——音乐全局共享后，各非 default 桌面的
    // music-* 键只是迁移前的陈旧副本。不清理的话，用户在共享库里删除的歌曲会在下次
    // 启动被旧副本重新合并回来（用户反馈「音乐里能播放已删除的歌曲」）。这里清掉源
    // 桌面 4 个键并置 music-merge-done，后续启动直接跳过合并；IDB 里已拷贝的本地
    // 音频文件保留作数据兜底，不影响。
    otherCids.forEach(cid => {
      let s; try { s = window.storeFor(cid); } catch (e) { return; }
      if (!s || typeof s.remove !== 'function') return;
      try { s.remove('music-library'); } catch (e) {}
      try { s.remove('music-playlists'); } catch (e) {}
      try { s.remove('music-history'); } catch (e) {}
      try { s.remove('music-my-history'); } catch (e) {}
    });
    store.set('music-merge-done', '1');
    // 拷贝本地音频文件 IDB（异步，不阻塞 UI）：各桌面 music-file:<id> → default music-file:<id>
    if (window.idbGet && window.idbSet && window.idbGetAllKeys) {
      const localIds = library.filter(m => m && (m.source === 'local' || (!m.url && m.source !== 'url'))).map(m => m.id);
      if (!localIds.length) return;
      window.idbGetAllKeys().then(keys => {
        const have = new Set(keys || []);
        otherCids.forEach(cid => {
          const srcPrefix = 'xy-home-v2:' + cid + ':music-file:';
          localIds.forEach(id => {
            const srcKey = srcPrefix + id;
            const dstKey = MUSIC_PREFIX + ':music-file:' + id;
            if (have.has(srcKey) && !have.has(dstKey)) {
              window.idbGet(srcKey).then(v => {
                if (v !== undefined && v !== null) window.idbSet(dstKey, v).catch(() => {});
              }).catch(() => {});
            }
          });
        });
      }).catch(() => {});
    }
  }


  // ================= 内置示例旋律：本地合成（无版权、不联网、永不失效） =================
  // 主路径用 Web Audio 离线渲染一小段钢琴音色旋律（22050Hz），编码为 WAV dataURL；
  // v3.6.x：任何失败路径（OfflineAudioContext 不可用/渲染失败/btoa 异常）都降级到
  //   genDemoWavJS 纯 JS 生成——保证默认歌单外链失败时兜底旋律一定可播，不再出现
  //   「已改用内置示例旋律」后仍提示「播放失败」。
  // 两段旋律（第一首小星星式上行，第二首欢快式）
  const DEMO_NOTES = [
    [523,523,587,587,659,659,587,523,523,587,587,659,659,587,659,698,784,784,698,698,659,659,587],
    [659,659,698,784,784,698,659,587,523,523,587,659,659,587,587,659,784,784,880,880,784,659,587]
  ];
  // 纯 JS 合成：正弦波 + 包络 → 16bit WAV dataURL（不依赖 WebAudio / btoa 大串分段安全）
  function genDemoWavJS(idx) {
    try {
      const sr = 8000, dur = 0.42;
      const notes = DEMO_NOTES[idx === 0 ? 0 : 1] || DEMO_NOTES[0];
      const total = sr * 14;
      const pcm = new Int16Array(total);
      let t = 0;
      notes.forEach((f) => {
        const nStart = Math.floor(t * sr);
        const nEnd = Math.min(Math.floor((t + dur) * sr), total);
        for (let i = nStart; i < nEnd; i++) {
          const tt = (i / sr) - t;
          // 20ms 起音 + 指数衰减包络
          const env = Math.min(1, tt / 0.02) * Math.pow(0.001, Math.max(0, tt - 0.02) / (dur - 0.02));
          pcm[i] = Math.max(-1, Math.min(1, Math.sin(2 * Math.PI * f * tt) * env * 0.5)) * 32767;
        }
        t += dur * 0.9;
      });
      const n = total;
      const wav = new DataView(new ArrayBuffer(44 + n * 2));
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
      ws(12, 'fmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
      wav.setUint32(24, sr, true); wav.setUint32(28, sr * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
      ws(36, 'data'); wav.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, pcm[i], true);
      const bytes = new Uint8Array(wav.buffer);
      let bin = '';
      // 分块拼接：String.fromCharCode.apply 有参数上限，8KB 块安全
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      }
      return 'data:audio/wav;base64,' + btoa(bin);
    } catch (e) { return ''; }
  }
  function genDemoAudio(idx) {
    return new Promise((resolve) => {
      // v3.6.x：OfflineAudioContext 不可用 → 直接纯 JS 合成，兜底必播
      const fallback = () => { try { resolve(genDemoWavJS(idx) || ''); } catch (e) { resolve(''); } };
      try {
        const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!AC) { fallback(); return; }
        const sr = 22050;
        const ctx = new AC(1, sr * 14, sr);
        const notes = DEMO_NOTES[idx === 0 ? 0 : 1] || DEMO_NOTES[0];
        let t = ctx.currentTime;
        const dur = 0.42;
        notes.forEach((f) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = f;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.5, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + dur);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + dur + 0.05);
          t += dur * 0.9;
        });
        // v3.6.x：startRendering 兼容——老 WebKit/低端安卓内核返回 undefined（不返回
        // Promise），直接 .then 会抛错导致合成失败、种子歌"不能播放"；先设 oncomplete
        // 回调再调用（Promise 内核同样走 then），事件不会丢。渲染/btoa 任何异常都降级。
        let cbDone = false;
        const finishRender = (buf) => {
          if (cbDone) return; cbDone = true;
          try {
            const ch = buf.getChannelData(0);
            const n = ch.length;
            const wav = new DataView(new ArrayBuffer(44 + n * 2));
            const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
            writeStr(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); writeStr(8, 'WAVE');
            writeStr(12, 'fmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
            wav.setUint32(24, sr, true); wav.setUint32(28, sr * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
            writeStr(36, 'data'); wav.setUint32(40, n * 2, true);
            for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 32767, true);
            const bytes = new Uint8Array(wav.buffer);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 8192) {
              bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            }
            resolve('data:audio/wav;base64,' + btoa(bin));
          } catch (e) { fallback(); }
        };
        try {
          const hasPromise = typeof ctx.startRendering === 'function' && ctx.startRendering.length === 0 && 'Promise' in window;
          if (hasPromise) {
            const rp = ctx.startRendering();
            if (rp && typeof rp.then === 'function') rp.then(finishRender).catch(fallback);
            else { ctx.oncomplete = (ev) => { try { finishRender(ev.renderedBuffer); } catch (e) { fallback(); } }; }
          } else {
            ctx.oncomplete = (ev) => { try { finishRender(ev.renderedBuffer); } catch (e) { fallback(); } };
            ctx.startRendering();
          }
        } catch (e) { fallback(); }
      } catch (e) { fallback(); }
    });
  }

  // ================= 网易云歌名/封面识别（多源兜底） =================
  // v3.5.117：内置已知歌曲（默认歌单这两首的元数据代理源已失效，命中直接返回，
  // 不再发起请求，避免控制台报错/加载失败）
  const KNOWN_NETEASE = {
    '27538343': { name: 'Baby', artist: 'EXO-K' },
    '2613048732': { name: 'Moonlit Dream', artist: 'DLSS / shell' }
  };
  // v3.6.x：解析网易云歌曲页面 HTML <title> 提取歌名/歌手
  // 页面标题格式："歌曲名 - 歌手名 - 单曲 - 网易云音乐" 或 "歌曲名 - 歌手名 - 网易云音乐"
  function parseNeteasePageTitle(html) {
    if (!html || typeof html !== 'string') return null;
    let m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return null;
    let title = m[1].trim().replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
    // v3.9.x：歌曲页 <meta property="music:duration" content="秒数"> 提取时长（零额外请求）
    let duration = 0;
    const dm = html.match(/property=["']music:duration["'][^>]*content=["'](\d+)["']/i) || html.match(/content=["'](\d+)["'][^>]*property=["']music:duration["']/i);
    if (dm) duration = parseInt(dm[1], 10) || 0;
    // 去掉末尾 " - 单曲 - 网易云音乐" 或 " - 网易云音乐"
    title = title.replace(/\s*[-－]\s*单曲\s*[-－]\s*网易云音乐\s*$/i, '');
    title = title.replace(/\s*[-－]\s*网易云音乐\s*$/i, '');
    // 剩余格式："歌曲名 - 歌手名"
    const parts = title.split(/\s*[-－]\s*/);
    if (parts.length >= 2) {
      return { name: parts[0].trim(), artist: parts.slice(1).join(' - ').trim(), pic: '', duration: duration };
    }
    if (parts.length === 1 && parts[0]) {
      return { name: parts[0].trim(), artist: '', pic: '', duration: duration };
    }
    return null;
  }
  function fetchNeteaseInfo(id, cb) {
    const known = KNOWN_NETEASE[String(id)];
    if (known) { cb({ name: known.name, artist: known.artist, pic: '' }); return; }
    // v3.6.x：原 type=netease 不是有效 meting 类型（返回空），网易云 API 需 Cookie
    // 返回 400——4 个 API 全失效。改用网易云歌曲页面 HTML <title> 解析歌名/歌手
    //（页面标题格式："歌曲名 - 歌手名 - 单曲 - 网易云音乐"），多 CORS 代理兜底
    const songPageUrl = 'https://music.163.com/song?id=' + id;
    const apis = [
      // v3.9.x：proxy.cors.sh（Cloudflare Workers，稳定可用）放首位；allorigins/corsproxy 兜底
      { url: 'https://proxy.cors.sh/' + songPageUrl, isText: true, parse(t) {
          return parseNeteasePageTitle(t); } },
      // 1-2：CORS 代理抓歌曲页面 HTML，解析 <title>
      { url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(songPageUrl), isText: true, parse(t) {
          return parseNeteasePageTitle(t); } },
      // v3.26.x：corsproxy.io 已整体 401（改为要求注册 API key，无 key 一律拒绝），
      // 留着只会刷「网络失败 401」日志（vivo Y35+Edge 诊断实证），移除。
      // 3：原网易云 API 直链（需 Cookie，多数返回 400，仅作兜底）
      { url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://music.163.com/api/song/detail/?ids=' + id), isText: true, parse(t) {
          let d; try { d = typeof t === 'string' ? JSON.parse(t) : t; } catch(e) { return null; }
          if (d && d.songs && d.songs[0]) {
            const s = d.songs[0];
            const artist = (s.artists || []).map(a => a.name).join('/');
            return { name: s.name, artist: artist, pic: (s.album && s.album.picUrl) || '', duration: s.dt ? Math.round(s.dt / 1000) : 0 };
          }
          return null; } }
    ];
    let idx = 0;
    function tryNext() {
      if (idx >= apis.length) { cb(null); return; }
      const api = apis[idx++];
      let controller;
      try { controller = new AbortController(); } catch(e) { controller = null; }
      const timer = setTimeout(() => { try { controller && controller.abort(); } catch(e){} }, 8000);
      fetch(api.url, controller ? { signal: controller.signal } : undefined)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return api.isText ? r.text() : r.json(); })
        .then(data => {
          clearTimeout(timer);
          try {
            const res = api.parse(data);
            if (res && res.name) cb(res); else tryNext();
          } catch (e) { tryNext(); }
        })
        .catch(() => { clearTimeout(timer); tryNext(); });
    }
    tryNext();
  }
  // ================= 网易云歌曲封面拉取（meting type=song） =================
  // v3.9.x：链接添加/批量导入的网易云单曲不带封面（只有歌单导入才带 pic），而
  // fetchNeteaseInfo 的 pic 字段依赖失效的 CORS 代理拿不到。改用 meting type=song
  // 接口（与播放同源的 api.injahow.cn，大陆直连、无 CORS、移动端同样可用）返回的
  // pic 代理 URL（302 → https 图片 CDN），img 直接引用即可显示。
  // v3.26.x #215：封面 URL 归一——网易 CDN 直链去掉旧 param 统一 ?param=300y300
  //（300px 对列表图标/正在播放封面/小组件都够用，原图 1~2MB 太重）；仅网易域名收
  // https+param，其余域名原样返回（混合内容场景下 http 输入本来就走不到重定向）。
  function normNeteaseCoverUrl(u) {
    var s = String(u || '');
    if (!/^https?:\/\/([^/]+\.)?music\.126\.net\//i.test(s)) return s;
    return s.replace(/^http:\/\//i, 'https://').replace(/\?.*$/, '') + '?param=300y300';
  }
  // v3.26.x #215：把封面 URL（meting 图片代理或网易直链）解析成最终直链。
  // 代理 URL 是 302 → 网易 CDN，两跳都有 CORS（ACAO:* 实测），fetch 的 r.url 即
  // 最终直链；解析失败原样回退入参（宁用代理也不空着）。收到响应头即落地，
  // 异步 abort+cancel body（同 resolveNeteaseDirectUrl 口径，防 BodyStreamBuffer
  // was aborted 未处理 rejection 刷诊断错误环——一加Ace3+Edge 音乐页实测 3 条）。
  function resolveCoverDirect(url, cb) {
    var controller;
    try { controller = new AbortController(); } catch (e) { controller = null; }
    var timer = setTimeout(function () { try { controller && controller.abort(); } catch (e) {} }, 8000);
    fetch(url, controller ? { signal: controller.signal } : undefined)
      .then(function (r) {
        clearTimeout(timer);
        var finalUrl = (r.ok || r.redirected) ? (r.url || '') : '';
        setTimeout(function () {
          try { controller && controller.abort(); } catch (e) {}
          try { r.body && r.body.cancel && r.body.cancel(); } catch (e) {}
          cb(finalUrl ? normNeteaseCoverUrl(finalUrl) : String(url));
        }, 0);
      })
      .catch(function () { clearTimeout(timer); cb(String(url)); });
  }
  function fetchNeteaseCover(id, cb) {
    let controller;
    try { controller = new AbortController(); } catch (e) { controller = null; }
    const timer = setTimeout(() => { try { controller && controller.abort(); } catch (e) {} }, 8000);
    fetch('https://api.injahow.cn/meting/?type=song&id=' + encodeURIComponent(String(id)), controller ? { signal: controller.signal } : undefined)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(txt => {
        clearTimeout(timer);
        try {
          const j = JSON.parse(txt);
          const pic = (j && j[0] && j[0].pic) || '';
          // v3.26.x #215：pic 是 meting 图片代理 URL（第三方单点，代理响应慢/挂时新旧
          // 封面一起丢——一加Ace3+Edge 实测）——解析成网易 CDN 直链再入库。
          if (pic) { resolveCoverDirect(String(pic), cb); return; }
        } catch (e) {}
        cb(null);
      })
      .catch(() => { clearTimeout(timer); fetchNeteaseCoverFallback(id, cb); });
  }
  // v3.26.x #215：meting 主源失败（超时/挂/被拦）的第二封面源——fetchNeteaseInfo
  // 的多代理链里 song/detail 接口带 album.picUrl（网易 CDN 直链）；拿不到才认输。
  function fetchNeteaseCoverFallback(id, cb) {
    fetchNeteaseInfo(id, function (info) {
      cb(info && info.pic ? normNeteaseCoverUrl(info.pic) : null);
    });
  }

  // ================= 网易云歌单导入 =================
  // v3.8.x：直接导入网易云歌单（粘贴歌单分享链接 / 链接添加里填歌单 ID）。
  // 主源：meting API type=playlist（api.injahow.cn，与播放 type=url 同源同域，
  // 大陆直连、无 CORS 问题，最多返回约 200 首）；兜底：网易云官方 v6 歌单详情
  // API（无 Cookie 可用，含全部曲目）经多个 CORS 代理转发（代理可用性随环境变化，
  // 与 fetchNeteaseInfo 同思路，留作未来恢复能力）。
  // 识别歌单链接：music.163.com/playlist?id=xxx / y.music.163.com/m/playlist?id=xxx / #/playlist?id=xxx
  function extractPlaylistId(line) {
    if (!line || typeof line !== 'string') return '';
    if (/\.mp3/i.test(line)) return '';
    const m = line.match(/playlist[\/?#]*(?:id=)?(\d+)/i);
    return m ? m[1] : '';
  }
  // v3.9.x：从任意输入中提取网易云歌曲数字 ID——纯数字、song?id=xxx、#/song?id=xxx
  //（hash 路由分享链接）、song/media/outer/url?id=xxx.mp3（官方外链）、/song/xxx 路径、
  // 分享文本混排（「分享…《歌名》https://music.163.com/song?id=xxx @QQ音乐」）都能识别；
  // 提取后统一转成 meting 播放直链（见 neteaseMetingUrl），用户不用手动抠数字。
  function extractNeteaseSongId(line) {
    if (!line || typeof line !== 'string') return '';
    const s = String(line).trim();
    if (/^\d+$/.test(s)) return s;
    let m = s.match(/[?&]id=(\d+)/);
    if (m) return m[1];
    m = s.match(/\/(?:song|playlist)\/(\d+)/i);
    if (m) return m[1];
    m = s.match(/\/(\d{5,})(?:\.mp3)?(?:\?|#|$)/);
    if (m) return m[1];
    return '';
  }
  function fetchNeteasePlaylist(id, cb) {
    const apiUrl = 'https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(String(id)) + '&n=1000&s=8';
    const sources = [
      // 主源：meting 歌单接口（与播放同源，稳定可用，约 200 首上限）
      { url: 'https://api.injahow.cn/meting/?type=playlist&id=' + encodeURIComponent(String(id)), parse(txt) {
          let j; try { j = JSON.parse(txt); } catch (e) { return null; }
          if (!Array.isArray(j) || !j.length) return null;
          return j.map(t => {
            const mid = (t.url || '').match(/type=url&id=(\d+)/);
            return {
              neteaseId: mid ? mid[1] : '',
              name: t.name || '',
              artist: t.artist || '',
              cover: String(t.pic || '').replace(/^http:\/\//i, 'https://'),
              url: mid ? neteaseMetingUrl(mid[1]) : (t.url || ''),
              duration: 0
            };
          }).filter(t => t.url);
        } },
      // v3.9.x：备用 meting 镜像（i-meto，独立域名——手机浏览器拦截/主源不可达时兜底；
      // 字段名 title/author，url 里的 id 提取方式与主源一致）
      { url: 'https://api.i-meto.com/meting/api?server=netease&type=playlist&id=' + encodeURIComponent(String(id)), parse(txt) {
          let j; try { j = JSON.parse(txt); } catch (e) { return null; }
          if (!Array.isArray(j) || !j.length) return null;
          return j.map(t => {
            const mid = (t.url || '').match(/type=url&id=(\d+)/);
            return {
              neteaseId: mid ? mid[1] : '',
              name: t.title || t.name || '',
              artist: t.author || t.artist || '',
              cover: String(t.pic || '').replace(/^http:\/\//i, 'https://'),
              url: mid ? neteaseMetingUrl(mid[1]) : (t.url || ''),
              duration: 0
            };
          }).filter(t => t.url);
        } },
      // 兜底：网易云官方 v6 歌单详情 API（无 Cookie 返回全部曲目）经 CORS 代理
      // v3.9.x：corsproxy.io(403)/codetabs(超时)已失效，改用 proxy.cors.sh（Cloudflare
      // Workers 代理，CORS 头正确、稳定可用）；allorigins/corsproxy 保留作低优先级兜底
      { url: 'https://proxy.cors.sh/' + apiUrl, parse(txt) {
          let j; try { j = JSON.parse(txt); } catch (e) { return null; }
          const pl = j && j.playlist;
          if (!pl || !Array.isArray(pl.tracks) || !pl.tracks.length) return null;
          return pl.tracks.map(s => ({
            neteaseId: String(s.id || ''),
            name: s.name || '',
            artist: ((s.ar || []).map(a => a.name).filter(Boolean).join('/')),
            cover: String((s.al && s.al.picUrl) || '').replace(/^http:\/\//i, 'https://'),
            url: s.id ? neteaseMetingUrl(s.id) : '',
            duration: s.dt ? Math.round(s.dt / 1000) : 0,
            fee: s.fee // v3.10.x：1=VIP 专属 4=购买专辑——导入时过滤
          })).filter(t => t.url);
        } },
      { url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(apiUrl), parse(txt) {
          let j; try { j = JSON.parse(txt); } catch (e) { return null; }
          const pl = j && j.playlist;
          if (!pl || !Array.isArray(pl.tracks) || !pl.tracks.length) return null;
          return pl.tracks.map(s => ({
            neteaseId: String(s.id || ''),
            name: s.name || '',
            artist: ((s.ar || []).map(a => a.name).filter(Boolean).join('/')),
            cover: String((s.al && s.al.picUrl) || '').replace(/^http:\/\//i, 'https://'),
            url: s.id ? neteaseMetingUrl(s.id) : '',
            duration: s.dt ? Math.round(s.dt / 1000) : 0,
            fee: s.fee
          })).filter(t => t.url);
        } },
      // v3.26.x：corsproxy.io 源已移除——整体 401（要求注册 API key），无意义请求只刷
      // 「网络失败」日志（vivo Y35+Edge 诊断实证）
    ];
    let idx = 0;
    function tryNext() {
      if (idx >= sources.length) { cb(null); return; }
      const src = sources[idx++];
      const srcLabel = src.url.substring(0, 60);
      let controller;
      try { controller = new AbortController(); } catch (e) { controller = null; }
      const timer = setTimeout(() => { try { controller && controller.abort(); } catch (e) {} }, 7000);
      fetch(src.url, controller ? { signal: controller.signal } : undefined)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(txt => {
          clearTimeout(timer);
          try {
            const res = src.parse(txt);
            if (res && res.length) cb(res); else tryNext();
          } catch (e) { tryNext(); }
        })
        .catch((err) => { clearTimeout(timer); tryNext(); });
    }
    tryNext();
  }
  // 导入单个歌单：去重（网易云 ID 已存在则跳过），只入内存，由调用方统一 saveLibrary
  // v3.10.x：VIP/付费歌曲前置过滤——数据源自带 fee 时（官方 v6 源）直接不入库；
  // meting 源不带 fee，由 enrichImportedDurations 拿到 v6 详情后再移除本批 VIP
  function importNeteasePlaylist(id, done, targetPl) {
    fetchNeteasePlaylist(id, function (tracks) {
      if (!tracks || !tracks.length) { done({ ok: false }); return; }
      let added = 0, skipped = 0, vip = 0;
      const now = Date.now();
      const addedIds = [];
      const plId = targetPl || 'default';
      tracks.forEach((t, i) => {
        if (t.neteaseId && library.some(m => m.neteaseId === t.neteaseId)) { skipped++; return; }
        if (t.fee === 1 || t.fee === 4) { vip++; return; } // VIP 专属/需购买专辑：网页外链播不了
        const nid = 'sm_pl_' + now + '_' + i + '_' + Math.random().toString(36).substr(2, 4);
        library.push({ id: nid, neteaseId: t.neteaseId, name: t.name || '网易云音乐-' + (t.neteaseId || i), artist: t.artist || '', cover: t.cover || '', url: t.url, source: 'url', duration: t.duration || 0, playlistId: plId, addedAt: now });
        addedIds.push(nid);
        added++;
      });
      done({ ok: true, added: added, skipped: skipped, vip: vip });
      // v3.9.x：导入后一次性补时长（meting 不带 duration）——v6 全量快路径 + 音频探测兜底
      // v3.10.x：同一趟 v6 详情顺带识别 VIP 并移除本批 VIP 曲目
      if (addedIds.length) enrichImportedDurations(id, addedIds);
    });
  }
  // 歌单导入后的时长补全：先试官方 v6 歌单详情（含每曲 dt，经 CORS 代理，代理可用则
  // 一次全量补齐并刷新列表）；代理全挂则对剩余歌曲逐个 <audio> 探测（见 enqueueDurProbe）
  // v3.10.x：同一趟 v6 详情顺带识别 VIP/付费曲（fee=1/4）——meting 导入源不带 fee，
  // 拿到 v6 后把「本次新导入」的 VIP 从库里移除并提示；只动本批 addedIds，不碰已有歌曲
  function enrichImportedDurations(id, trackIds) {
    const missing = trackIds.map(findTrack).filter(m => m && m.neteaseId && !m.duration);
    if (!missing.length) return;
    fetchV6Durations(id, function (durMap, feeMap) {
      if (durMap && Object.keys(durMap).length) {
        let any = false;
        missing.forEach(m => { if (durMap[m.neteaseId] && !m.duration) { m.duration = durMap[m.neteaseId]; any = true; } });
        if (any) { saveLibrary(); renderPage(); }
      }
      if (feeMap && Object.keys(feeMap).length) {
        const vipTracks = trackIds.map(findTrack).filter(m => m && m.neteaseId && (feeMap[m.neteaseId] === 1 || feeMap[m.neteaseId] === 4));
        if (vipTracks.length) {
          const vipIds = vipTracks.map(m => m.id);
          library = library.filter(x => vipIds.indexOf(x.id) < 0);
          if (currentId && vipIds.indexOf(currentId) >= 0) { teardownAudio(); currentId = null; updatePlayerBar(); renderLibrary(); }
          saveLibrary();
          renderPage();
          toast('已自动移除 ' + vipTracks.length + ' 首 VIP/付费歌曲（网页外链无法播放）');
        }
      }
      missing.forEach(m => { if (!m.duration) enqueueDurProbe(m); });
    });
  }
  // ================= 网易云歌曲时长补全（一次性加载） =================
  // v3.9.x：meting 系歌单接口不带时长，旧逻辑只有播放到那首歌时 loadedmetadata 才补，
  // 列表一直显示 00:00。这里用 <audio preload=metadata> 探测时长（与播放同源的 meting
  // URL，大陆直连、无需 CORS 代理、手机浏览器同样可用），并发 4 条后台跑，逐条写回
  // 并刷新界面，实现「导入后一次性把时长加载出来」；探测失败（如 VIP 歌）保持 00:00。
  function fetchV6Durations(id, cb) {
    const apiUrl = 'https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(String(id)) + '&n=1000&s=8';
    // v3.9.x：codetabs 已失效（超时），改用 proxy.cors.sh（Cloudflare Workers，稳定）
    const prox = [
      { p: 'https://proxy.cors.sh/', enc: false },
      { p: 'https://api.allorigins.win/raw?url=', enc: true }
    ];
    const out = {};
    const fees = {}; // v3.10.x：顺带收集 fee（1=VIP 4=购买专辑）供导入后移除本批 VIP
    let settled = false;
    const finish = () => { if (settled) return; settled = true; cb(out, fees); };
    prox.forEach(pr => {
      let controller;
      try { controller = new AbortController(); } catch (e) { controller = null; }
      const timer = setTimeout(() => { try { controller && controller.abort(); } catch (e) {} }, 6000);
      fetch(pr.p + (pr.enc ? encodeURIComponent(apiUrl) : apiUrl), controller ? { signal: controller.signal } : undefined)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(txt => {
          clearTimeout(timer);
          try {
            const j = JSON.parse(txt);
            const pl = j && j.playlist;
            if (pl && Array.isArray(pl.tracks) && pl.tracks.length) {
              pl.tracks.forEach(s => {
                if (!s || !s.id) return;
                if (s.dt) out[String(s.id)] = Math.round(s.dt / 1000);
                fees[String(s.id)] = s.fee;
              });
              finish();
            }
          } catch (e) {}
        })
        .catch(() => { clearTimeout(timer); });
    });
    // 兜底：最多等 7s（代理全挂时快速收尾，交给音频探测）
    setTimeout(finish, 7000);
  }
  // ================= 网易云会员歌曲批量检测与清理 =================
  // v3.14.x：存量库清理入口——导入时的 VIP 过滤（importNeteasePlaylist/
  // enrichImportedDurations）只覆盖「当批新导入」且依赖代理可用，老歌单/代理失效那批
  // 漏网的会员歌（fee=1 VIP 专属 / 4 需购买专辑）留在库里，点播即失败。这里批量查
  // 网易云单曲详情 API（与 v6 歌单详情同族，经 CORS 代理），拿到每首 fee 后确认移除。
  // 代理全挂时如实提示，绝不把「查不到」当成「免费」误删。
  function fetchNeteaseFees(ids, cb) {
    if (!ids || !ids.length) { cb({}, false); return; }
    // v6 批量接口已失效（返回 {"code":404,"message":"接口未找到！"}），只用 legacy 单曲详情接口
    const apiUrl = 'https://music.163.com/api/song/detail/?ids=' + encodeURIComponent('[' + ids.join(',') + ']');
    // 多 CORS 代理兜底：proxy.cors.sh 为主力（实测唯一能返 JSON 的），allorigins 作低优先级后备。
    // 代理偶发 HTTP 5xx/429（如 proxy.cors.sh 的 520）是第三方源站波动，走 retry 重试一次，
    // 别让瞬时抖动误判成「网络不可用」。
    const prox = [
      { p: 'https://proxy.cors.sh/', enc: false },
      { p: 'https://api.allorigins.win/raw?url=', enc: true }
    ];
    const out = {};
    let settled = false;
    let running = 0;
    const finish = (ok) => { if (settled) return; settled = true; cb(out, ok); };
    const job = (pr, retryLeft) => {
      running++;
      let controller;
      try { controller = new AbortController(); } catch (e) { controller = null; }
      const timer = setTimeout(() => { try { controller && controller.abort(); } catch (e) {} }, 6000);
      fetch(pr.p + (pr.enc ? encodeURIComponent(apiUrl) : apiUrl), controller ? { signal: controller.signal } : undefined)
        .then(r => {
          if (r.status >= 500 || r.status === 429) throw { retry: true, msg: 'HTTP ' + r.status };
          if (!r.ok) throw { retry: false, msg: 'HTTP ' + r.status };
          return r.text();
        })
        .then(txt => {
          clearTimeout(timer);
          try {
            const j = JSON.parse(txt);
            const songs = (j && Array.isArray(j.songs)) ? j.songs : [];
            let got = 0;
            songs.forEach(s => { if (s && s.id && typeof s.fee === 'number') { out[String(s.id)] = s.fee; got++; } });
            if (got) { finish(true); }
          } catch (e) {}
          if (--running === 0 && !settled) finish(false);
        })
        .catch(err => {
          clearTimeout(timer);
          if (err && err.retry && retryLeft > 0) {
            // 释放本轮计数，短暂延时后按同一代理重试
            running--;
            setTimeout(() => job(pr, retryLeft - 1), 400);
          } else if (--running === 0 && !settled) finish(false);
        });
    };
    prox.forEach(pr => job(pr, 1));
    // 兜底：全部请求 6s 内无有效结果 → 结束（回调 ok=false，调用方提示检测失败）
    setTimeout(() => finish(false), 7000);
  }
  function openVipClean() {
    const candidates = library.filter(m => m && m.neteaseId && m.source === 'url');
    if (!candidates.length) { toast('音乐库里没有网易云链接歌曲'); return; }
    const uniqueIds = [];
    candidates.forEach(m => { if (uniqueIds.indexOf(m.neteaseId) < 0) uniqueIds.push(m.neteaseId); });
    toast('正在检测 ' + uniqueIds.length + ' 首歌曲的会员状态…');
    fetchNeteaseFees(uniqueIds, (fees, ok) => {
      if (!ok || !Object.keys(fees).length) { toast('检测失败：网易云查询服务暂不可用，请稍后重试'); return; }
      const vip = candidates.filter(m => fees[m.neteaseId] === 1 || fees[m.neteaseId] === 4);
      if (!vip.length) { toast('未发现会员/付费歌曲'); return; }
      const shown = vip.slice(0, 30);
      const more = vip.length - shown.length;
      if (!window.openTCPanel) return;
      window.openTCPanel('清理会员歌曲', '' +
        '<div class="sm-fld-hint" style="margin-bottom:8px">以下 ' + vip.length + ' 首为网易云会员/付费歌曲（网页外链无法播放），可移除出音乐库：</div>' +
        shown.map(m => '<div class="sm-song" data-id="' + m.id + '">' + songIcoHtml(m) +
          '<div class="sm-song-info"><div class="sm-song-name">' + esc(m.name || '未知歌曲') + '</div>' +
          '<div class="sm-song-sub">' + esc(m.artist || '未知歌手') + '</div></div></div>').join('') +
        (more > 0 ? '<div class="sm-fld-hint" style="margin-top:6px">…还有 ' + more + ' 首，一并移除</div>' : '') +
        '<div class="mail-actions"><button class="cc-tool" id="sm-vip-cancel">取消</button><button class="cc-tool" id="sm-vip-ok">移除 ' + vip.length + ' 首</button></div>');
      document.getElementById('sm-vip-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
      document.getElementById('sm-vip-ok').addEventListener('click', () => {
        const vipIds = vip.map(m => m.id);
        library = library.filter(m => vipIds.indexOf(m.id) < 0);
        if (currentId && vipIds.indexOf(currentId) >= 0) { teardownAudio(); currentId = null; }
        saveLibrary();
        document.getElementById('tc-mask').hidden = true;
        renderPage();
        toast('已移除 ' + vip.length + ' 首会员/付费歌曲');
      });
    });
  }
  function updateDurUI(id, dur) {
    if (!dur) return;
    const txt = fmtDur(dur);
    document.querySelectorAll('#music-lib-list .sm-song, #tc-body .sm-song').forEach(row => {
      if (row.dataset.id === id) {
        const el = row.querySelector('.sm-song-dur');
        if (el) el.textContent = txt;
      }
    });
  }
  const durProbeQueue = [];
  const DUR_PROBE_CONCURRENCY = 4;
  let durProbeActive = 0;
  // v3.10.x：旧实现用 running 标志 + 固定 4 次 next() 起池，但 enqueue 是同步循环，
  // 队列被 next() 同步排空后 running 被提前清掉，后续每首歌都各自再起一批——
  // 大歌单几百首同时探测，12s 超时内大多拿不到连接 → 时长全 00:00。
  // 改为真正的 worker pool：active 计数 + 泵，任意时刻最多 4 条在探。
  function enqueueDurProbe(m) {
    if (!m || !m.neteaseId || m.duration > 0) return;
    if (durProbeQueue.some(x => x.id === m.id)) return;
    durProbeQueue.push(m);
    pumpDurProbe();
  }
  function pumpDurProbe() {
    while (durProbeActive < DUR_PROBE_CONCURRENCY && durProbeQueue.length) {
      const m = durProbeQueue.shift();
      durProbeActive++;
      probeOneDuration(m, function () { durProbeActive--; pumpDurProbe(); });
    }
  }
  function probeOneDuration(m, done) {
    let tmp = null;
    let finished = false;
    const timer = setTimeout(() => finish(0), 12000);
    function finish(dur) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { if (tmp) { tmp.onerror = null; tmp.onloadedmetadata = null; tmp.removeAttribute('src'); tmp.load(); } } catch (e) {}
      if (dur > 0) {
        const mm = findTrack(m.id);
        if (mm && !mm.duration) {
          mm.duration = dur;
          saveLibrarySoon();
          updateDurUI(m.id, dur);
        }
      }
      done();
    }
    try {
      tmp = new Audio();
      // v3.9.x：与播放同设 no-referrer——网易云 CDN 防盗链带 Referer 返回 403，
      // 探测不设则 onerror → duration 永远补不上（歌单导入后全显示 00:00）
      try { tmp.referrerPolicy = 'no-referrer'; } catch (e) {}
      tmp.preload = 'metadata';
      tmp.onloadedmetadata = function () { finish(tmp.duration || 0); };
      tmp.onerror = function () { finish(0); };
      tmp.src = neteaseMetingUrl(m.neteaseId);
    } catch (e) { finish(0); }
  }
  function probeAllMissingDurations() {
    // v3.26.x：只探测已渲染（窗口化）歌曲的时长，避免对几千首歌发起网络请求导致 ERR_INSUFFICIENT_RESOURCES
    libSongsFor(libFilter).slice(0, libRenderShown).forEach(m => { if (m && m.neteaseId && !m.duration) enqueueDurProbe(m); });
  }
  // ================= 网易云歌曲封面补全（列表/小组件共用，并发节流） =================
  // v3.9.x：链接添加/批量导入的单曲没有封面 → 导入后/播放时/打开音乐页时后台拉取
  //（fetchNeteaseCover，meting type=song）。并发 3 条排队，_coverLoading 防重复请求，
  // 拉到后写回 cover 并局部刷新封面图标（不整页重渲染），正在播放的同步刷新桌面小组件。
  let coverQueueRunning = false;
  const coverQueue = [];
  const COVER_CONCURRENCY = 3;
  function enqueueCoverFetch(m) {
    if (!m || !m.neteaseId || m.cover || m._coverLoading) return;
    if (coverQueue.some(x => x.id === m.id)) return;
    m._coverLoading = true;
    coverQueue.push(m);
    if (coverQueue.length <= COVER_CONCURRENCY) runCoverQueue();
  }
  function runCoverQueue() {
    if (coverQueueRunning) return;
    coverQueueRunning = true;
    const next = () => {
      if (!coverQueue.length) { coverQueueRunning = false; return; }
      const m = coverQueue.shift();
      fetchNeteaseCover(m.neteaseId, (pic) => {
        const mm = findTrack(m.id);
        if (mm) {
          mm._coverLoading = false;
          if (pic && !mm.cover) {
            mm.cover = pic;
            saveLibrarySoon();
            updateCoverUI(m.id);
            if (mm.id === currentId) setWidgetCover(mm);
          }
        }
        next();
      });
    };
    for (let i = 0; i < COVER_CONCURRENCY; i++) next();
  }
  function ensureSongCover(m) { enqueueCoverFetch(m); }
  function ensureMissingCovers() {
    // v3.26.x：只补已渲染（窗口化）歌曲的封面，避免对几千首歌发起网络请求导致 ERR_INSUFFICIENT_RESOURCES
    libSongsFor(libFilter).slice(0, libRenderShown).forEach(m => {
      if (!m) return;
      if (m.neteaseId && !m.cover) enqueueCoverFetch(m);
      // v3.26.x #215：已有封面但是代理 URL 的存量歌，顺路迁移成网易 CDN 直链
      else if (m.cover && COVER_PROXY_RE.test(m.cover)) enqueueCovMig(m);
    });
    // v3.26.x #215：歌单封面同批迁移（歌单个数少，不窗口化）
    playlists.forEach(pl => { if (pl && pl.cover && COVER_PROXY_RE.test(pl.cover)) enqueueCovMig(pl); });
  }
  // 局部刷新某首歌曲在列表/歌单面板里的封面图标（has-cov 与正常渲染一致，图标丢弃）
  function updateCoverUI(id) {
    const m = findTrack(id);
    if (!m || !m.cover) return;
    document.querySelectorAll('#music-lib-list .sm-song, #tc-body .sm-song').forEach(row => {
      if (row.dataset.id === id) {
        const ico = row.querySelector('.sm-song-ico');
        if (ico) {
          ico.className = 'sm-song-ico has-cov';
          ico.style.backgroundImage = 'url(\'' + m.cover + '\')';
          ico.innerHTML = '';
        }
      }
    });
  }
  // ================= 存量封面代理 URL 迁移（#215） =================
  // v3.26.x #215：历史数据把封面存成 meting 图片代理 URL（第三方单点，挂了全部封面
  // 一起丢）。只迁已渲染窗口内的歌 + 全部歌单，逐步解析成网易 CDN 直链写回；解析
  // 失败原样保留，下次打开音乐页继续自愈。串行一条一条来，不与播放/时长探测抢带宽。
  // in-flight 用 Set 记不落盘（_coverLoading 式布尔会随库序列化，中途退出卡 true 永不再补）。
  var COVER_PROXY_RE = /^https?:\/\/api\.injahow\.cn\/meting\/\?[^]*type=pic/i;
  const covMigInflight = new Set();
  let covMigBusy = false;
  const covMigQueue = [];
  function enqueueCovMig(m) {
    if (!m || !m.cover || !COVER_PROXY_RE.test(m.cover) || covMigInflight.has(m.id)) return;
    covMigInflight.add(m.id);
    covMigQueue.push(m);
    runCovMig();
  }
  function runCovMig() {
    if (covMigBusy) return;
    const m = covMigQueue.shift();
    if (!m) return;
    covMigBusy = true;
    resolveCoverDirect(m.cover, function (direct) {
      covMigInflight.delete(m.id);
      covMigBusy = false;
      if (direct && direct !== m.cover && !COVER_PROXY_RE.test(direct)) {
        m.cover = direct;
        if (String(m.id).indexOf('spl_') === 0) savePlaylists(); else saveLibrarySoon();
        syncSnapshotCovers(m.id, direct);
        if (findTrack(m.id)) {
          updateCoverUI(m.id);
          if (m.id === currentId) setWidgetCover(m);
        }
      }
      if (covMigQueue.length) runCovMig();
    });
  }
  // v3.26.x #215：歌库迁移完顺带把历史/TA收藏快照里同一首歌的代理封面一起换成直链
  //（快照冗余是 #99/v3.9.x 设计，只换 URL 不动结构）
  function syncSnapshotCovers(sid, cov) {
    let hch = false;
    history.forEach(x => { if (x && x.trackId === sid && x.cover && COVER_PROXY_RE.test(x.cover)) { x.cover = cov; hch = true; } });
    myHistory.forEach(x => { if (x && x.trackId === sid && x.cover && COVER_PROXY_RE.test(x.cover)) { x.cover = cov; hch = true; } });
    if (hch) { saveHistory(); saveMyHistory(); }
    let tch = false;
    const tl = taFavList();
    tl.forEach(x => { if (x && x.id === sid && x.cover && COVER_PROXY_RE.test(x.cover)) { x.cover = cov; tch = true; } });
    if (tch) saveTaFavList(tl);
  }
  // 串行导入多个歌单（避免并发刷爆网络）
  function importPlaylistIds(ids, cb, targetPl) {
    let total = 0, plOk = 0, plFail = 0, skipped = 0, vip = 0;
    const next = (i) => {
      if (i >= ids.length) { cb({ total: total, plOk: plOk, plFail: plFail, skipped: skipped, vip: vip }); return; }
      importNeteasePlaylist(ids[i], (res) => {
        if (res.ok) { plOk++; total += res.added; skipped += res.skipped; vip += res.vip || 0; }
        else plFail++;
        next(i + 1);
      }, targetPl);
    };
    next(0);
  }

  // 本地上传（多个文件，存储到 IndexedDB）
  // v3.6.x：改存 Blob（不再存 base64 dataURL 字符串）——夸克等浏览器对
  // `<audio src="data:...">`（尤其大段 base64）播放失效，Blob + 对象 URL 是标准播放方案
  // ================= 添加歌曲 =================
  // 本地上传（多个文件，存储到 IndexedDB）
  // v3.6.x：改存 Blob（不再存 base64 dataURL 字符串）——夸克等浏览器对
  // `<audio src="data:...">`（尤其大段 base64）播放失效，Blob + 对象 URL 是标准播放方案
  function triggerUpload() {
    if (!window.openTCPanel) { localPlId = 'default'; }
    // v3.x：本地上传前先选目标「播放列表（歌单）」——不再一律存进默认「我的音乐库」
    window.openTCPanel('添加本地音乐', '' +
      '<div class="sm-form">' +
      '<div class="sm-fld"><label>上传到播放列表</label><select class="tc-input" id="sm-local-pl">' + targetPlOptions() + '</select></div>' +
      '<div class="sm-fld-hint">选择一首或多首本地音频（mp3 / m4a / aac / ogg / wav / flac）存放进上面的歌单；选「新建歌单」可先建一个歌单再上传。</div>' +
      '</div>' +
      '<div class="mail-actions"><button class="cc-tool" id="sm-local-cancel">取消</button><button class="cc-tool" id="sm-local-ok">选择文件上传</button></div>');
    document.getElementById('sm-local-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
    document.getElementById('sm-local-ok').addEventListener('click', () => {
      resolveTargetPlSel('sm-local-pl', (pid) => {
        localPlId = pid || 'default';
        document.getElementById('tc-mask').hidden = true;
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac';
        inp.multiple = true;
        inp.onchange = function () { if (this.files && this.files.length) uploadFiles(this.files); };
        inp.click();
      });
    });
  }
  function uploadFiles(files) {
    const list = Array.from(files);
    if (!list.length) return;
    toast('正在上传 ' + list.length + ' 首音乐…');
    // v3.6.x：改为逐个文件串行处理——原来 N 个文件并行 FileReader.readAsArrayBuffer
    //（每个都把整段音频读进内存）+ 并行 idbSet 写 Blob，多首几十 MB 音乐同时进行时
    // 内存峰值 N 倍、GC 频繁，主线程被长阻塞（用户反馈 iQOO/QQ浏览器：添加音乐后
    // 页面卡顿、「已上传」弹窗一直不消失——2s 隐藏定时器被阻塞延迟）。
    // 串行后主线程不再长阻塞；每文件 3s 时长读取超时兜底——个别格式/内核不触发
    // loadedmetadata/error 时（原逻辑 pending 永远 >0）也不会卡住队列，
    // 最后一个文件完成时必然弹出「已上传 N 首音乐」替换掉「正在上传…」提示。
    // v3.6.x：Via/OPPO 等老内核 IndexedDB 不支持 Blob 结构化克隆——存 Blob 会静默失败，
    // 列表里有歌但播放时读不到音频。写入失败自动回退存 dataURL 字符串（老内核 100% 支持，
    // 播放路径 dataUrlToBlob 会转回 Blob 播）。readAsArrayBuffer 失败同样回退 readAsDataURL。
    let idx = 0;
    const done = () => { saveLibrary(); renderPage(); toast('已上传 ' + list.length + ' 首音乐（点歌曲右侧 ⋯ 可设置封面）'); };
    const readFile = (file, cb, failCb) => {
      const r1 = new FileReader();
      r1.onload = () => { if (r1.result instanceof ArrayBuffer) cb(r1.result, true); else cb(r1.result, false); };
      r1.onerror = () => {
        // ArrayBuffer 读取失败 → 回退 DataURL（最老内核也支持）
        const r2 = new FileReader();
        r2.onload = () => cb(r2.result, false);
        r2.onerror = failCb;
        try { r2.readAsDataURL(file); } catch (e) { failCb(); }
      };
      try { r1.readAsArrayBuffer(file); } catch (e) { failCb(); }
    };
    const storePayload = (id, file, buf) => {
      // 优先 Blob（紧凑）；ArrayBuffer 成功 → Blob；否则原样（dataURL 字符串）
      const payload = buf instanceof ArrayBuffer ? new Blob([buf], { type: file.type || 'audio/mpeg' }) : buf;
      const key = MUSIC_PREFIX + ':music-file:' + id;
      const toDataUrl = (cb) => {
        const fr = new FileReader();
        fr.onload = () => cb(fr.result);
        fr.onerror = () => cb(null);
        const src = payload instanceof Blob ? payload : new Blob([buf], { type: file.type || 'audio/mpeg' });
        try { fr.readAsDataURL(src); } catch (e) { cb(null); }
      };
      // localStorage 最终兜底：直接写（绕过 xyStore 大键只进 IDB 的限制）；
      // 播放读取路径（store.get('music-file:'+id)）会查 localStorage，数据不丢。
      // 超 5MB 配额时写失败 → 明确提示，用户知道原因而不是无声失败
      const saveToLocal = (dv) => {
        if (!dv) { saveLibrarySoon(); return; }
        try {
          localStorage.setItem(key, dv);
        } catch (e) {
          try { toast('存储空间不足，部分音乐可能无法播放'); } catch (e2) {}
        }
        saveLibrarySoon();
      };
      // dataURL 字符串 → 先试 IDB，失败再落 localStorage
      const saveStrFallback = (dv) => {
        if (!dv) { saveLibrarySoon(); return; }
        if (window.idbSet) {
          window.idbSet(key, dv).then(ok2 => { if (ok2) saveLibrarySoon(); else saveToLocal(dv); }).catch(() => saveToLocal(dv));
        } else {
          saveToLocal(dv);
        }
      };
      // v3.6.x：IDB 完全不可用（file:// 本地打开、部分国产浏览器）→ 直接 dataURL 存 localStorage
      if (!window.indexedDB || !window.idbSet) {
        toDataUrl(saveToLocal);
        return;
      }
      window.idbSet(key, payload).then(ok => {
        if (ok) { saveLibrarySoon(); return; }
        // Blob 写入失败（老内核不支持 Blob 克隆）→ 转 dataURL 字符串重存
        toDataUrl(saveStrFallback);
      }).catch(() => {
        toDataUrl(saveStrFallback);
      });
    };
    const next = function () {
      if (idx >= list.length) { done(); return; }
      const file = list[idx++];
      if (file.size > 50 * 1024 * 1024) { toast('「' + file.name + '」超过 50MB，已跳过'); next(); return; }
      readFile(file, function (buf) {
        const id = 'sm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const name = file.name.replace(/\.[^.]+$/, '');
        const item = { id: id, name: name, artist: '', url: '', source: 'local', duration: 0, playlistId: localPlId || 'default', addedAt: Date.now() };
        library.push(item);
        const payload = buf instanceof ArrayBuffer ? new Blob([buf], { type: file.type || 'audio/mpeg' }) : buf;
        localBlobCache[id] = payload; // v3.29.x 内存缓存：playTrack 同步读取保留用户手势
        // 尝试读取时长（读不到也能播放；3s 超时兜底，不阻塞队列）
        const tmp = document.createElement('audio');
        tmp.preload = 'metadata';
        let tmpUrl = null;
        let metaTimer = null;
        let settled = false;
        const cleanupTmp = () => {
          try { if (tmpUrl) URL.revokeObjectURL(tmpUrl); } catch(e) {}
          try { tmp.src = ''; tmp.load(); } catch(e) {}
        };
        const finishMeta = () => {
          if (settled) return;
          settled = true;
          if (metaTimer) clearTimeout(metaTimer);
          cleanupTmp();
          next();
        };
        tmp.onloadedmetadata = function () {
          const m = findTrack(id);
          if (m && tmp.duration) { m.duration = tmp.duration; }
          finishMeta();
        };
        tmp.onerror = finishMeta;
        metaTimer = setTimeout(finishMeta, 3000);
        if (payload instanceof Blob) {
          tmpUrl = URL.createObjectURL(payload);
          tmp.src = tmpUrl;
        } else {
          tmp.src = payload;
        }
        // 存储（异步写 IDB，不阻塞队列；Blob 失败自动回退字符串）
        storePayload(id, file, buf);
      }, function () { next(); });
    };
    next();
  }

  // 链接添加（网易云 ID / 直链）
  // v3.6.x：输入值读取兜底——部分国产浏览器（Via 等）对 contenteditable 转换器
  // （mobile-adapt.js 的 ce-box）的 input.value 代理支持不完整，读出来是空，
  // 表现为「输入了内容却提示请输入/添加失败」。这里优先走代理，读空时直接
  // 从 ce-box 取 innerText/textContent 兜底。
  function readCeInput(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    try {
      const v = el.value;
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    } catch (e) {}
    try {
      const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
      if (box) {
        const t = (box.innerText !== undefined ? box.innerText : box.textContent) || '';
        if (t.trim()) return t.trim();
      }
    } catch (e) {}
    return '';
  }
  // 生成"导入到歌单"下拉选项：我的音乐库 + 已有歌单 + 新建
  function targetPlOptions() {
    return '<option value="default">我的音乐库</option>' +
      playlists.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') +
      '<option value="__new__">＋ 新建歌单…</option>';
  }
  // 解析目标歌单：选"新建"时弹窗输入歌单名，创建后回调新歌单 id；否则直接回调选中 id
  function resolveTargetPlaylist(cb) {
    const sel = document.getElementById('sm-target-pl');
    if (!sel) { cb('default'); return; }
    const pid = sel.value;
    if (pid === '__new__') {
      if (!window.openModal) { cb('default'); return; }
      window.openModal('新建歌单', '', (name) => {
        name = (name || '').trim();
        if (!name) { toast('请输入歌单名称'); return; }
        const newId = 'spl_' + Date.now();
        playlists.push({ id: newId, name: name, createdAt: Date.now() });
        savePlaylists();
        cb(newId);
      });
    } else {
      cb(pid);
    }
  }
  // 解析指定下拉（按 id）的目标歌单：选"新建"时弹窗建歌单，否则回调所选 id（本地上传用）
  function resolveTargetPlSel(selId, cb) {
    const sel = document.getElementById(selId);
    if (!sel) { cb('default'); return; }
    const pid = sel.value;
    if (pid === '__new__') {
      if (!window.openModal) { cb('default'); return; }
      window.openModal('新建歌单', '', (name) => {
        name = (name || '').trim();
        if (!name) { toast('请输入歌单名称'); return; }
        const newId = 'spl_' + Date.now();
        playlists.push({ id: newId, name: name, createdAt: Date.now() });
        savePlaylists();
        cb(newId);
      });
    } else {
      cb(pid);
    }
  }
  function openAddUrl() {
    if (!window.openTCPanel) return;
    window.openTCPanel('添加链接音乐', '' +
      '<div class="sm-form">' +
      '<div class="sm-fld"><label>歌曲名称</label><input class="tc-input" id="sm-url-name" placeholder="可留空，识别后自动补全"></div>' +
      '<div class="sm-fld"><label>歌手</label><input class="tc-input" id="sm-url-artist" placeholder="可留空"></div>' +
      '<div class="sm-fld"><label>网易云歌曲ID 或 链接 / 音乐直链</label><textarea class="tc-input" id="sm-url-link" rows="3" placeholder="如 2064961530&#10;或 https://music.163.com/#/song?id=xxx&#10;每行一个，支持批量"></textarea></div>' +
      '<div class="sm-fld"><label>导入到歌单</label><select class="tc-input" id="sm-target-pl">' + targetPlOptions() + '</select></div>' +
      '<div class="sm-fld-hint">填网易云歌曲数字 ID（如 2064961530）或<b>直接粘贴完整网易云链接</b>（如 music.163.com/#/song?id=xxx、song/media/outer/url?id=xxx.mp3），都会自动识别导入，不用手动填 ID；mp3 直链也可。支持批量：每行一个 ID 或链接；批量时歌曲名/歌手自动识别，可不填。<br>粘贴歌单分享链接（music.163.com/playlist?id=xxx 或 #/playlist?id=xxx）自动导入整个歌单。<br><span style="opacity:.75">⚠ 链接上传的 VIP/付费歌曲无法播放（仅免费歌曲可播）；歌单导入受网络环境影响，失败可稍后重试</span></div>' +
      '</div>' +
      '<div class="mail-actions"><button class="cc-tool" id="sm-url-cancel">取消</button><button class="cc-tool" id="sm-url-ok">确认添加</button></div>');
    document.getElementById('sm-url-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
    document.getElementById('sm-url-ok').addEventListener('click', () => {
      // v3.6.x：修复——原用 const 声明 name，第 307 行「名称留空时补全」对其重新赋值，
      // 会抛 TypeError（Assignment to constant variable），导致「链接音乐添加」整体失效
      let name = readCeInput('sm-url-name');
      const artist = readCeInput('sm-url-artist');
      const raw = readCeInput('sm-url-link');
      if (!raw) { toast('请输入网易云ID或音乐链接'); return; }
      resolveTargetPlaylist((targetPl) => {
        // v3.8.x：支持批量——一次粘贴多行，每行一个网易云 ID / 音乐链接，逐条导入；
        // 多行时忽略「歌曲名称/歌手」输入（每首自动识别歌名/歌手）
        const lines = raw.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
        if (!lines.length) { toast('请输入网易云ID或音乐链接'); return; }
        const isBatch = lines.length > 1;
        // v3.8.x：歌单分享链接自动识别——含 playlist?id= 的行走整歌单导入，其余行照常导入
        const playlistIds = [];
        const trackLines = [];
        lines.forEach(ln => {
          const plId = extractPlaylistId(ln);
          if (plId) { if (playlistIds.indexOf(plId) < 0) playlistIds.push(plId); }
          else trackLines.push(ln);
        });
        // 普通 ID/链接行导入（单首或批量；歌单行混排时复用）
        const addLinkLines = (lins, batchMode) => {
          let added = 0;
          lins.forEach((ln, li) => {
            // v3.9.x：统一提取——纯数字 / #/song?id=xxx / outer/url?id=xxx.mp3 等
            // 任意网易云链接 / 分享文本，都能自动识别出歌曲 ID
            const neteaseId = extractNeteaseSongId(ln);
            let url = ln;
            let nm = batchMode ? '' : name;
            if (neteaseId) {
              url = neteaseMetingUrl(neteaseId);
              if (!nm) nm = '网易云音乐-' + neteaseId;
            }
            if (!/^(https?:\/\/|file:\/\/|data:|\/)/i.test(url)) return;
            const id = 'sm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + li;
            const item = { id: id, neteaseId: neteaseId || '', name: nm, artist: batchMode ? '' : artist, url: url, source: 'url', duration: 0, playlistId: targetPl || 'default', addedAt: Date.now() };
            library.push(item);
            added++;
            if (neteaseId) {
              // v3.9.x：后台探测时长（识别歌名失败也不影响，时长单独补）+ 拉取歌曲封面
              enqueueDurProbe(item);
              ensureSongCover(item);
              fetchNeteaseInfo(neteaseId, info => {
                const m = findTrack(id);
                if (m && info && info.name) {
                  m.name = info.name;
                  if (info.artist) m.artist = info.artist;
                  if (info.duration && !m.duration) { m.duration = info.duration; updateDurUI(m.id, m.duration); }
                  saveLibrary();
                  renderPage();
                  if (!batchMode) toast('已识别：' + info.name + (info.artist ? ' - ' + info.artist : ''));
                }
              });
            }
          });
          if (!added) return;
          saveLibrary();
          document.getElementById('tc-mask').hidden = true;
          renderPage();
          if (!playlistIds.length) toast(batchMode ? '已批量添加 ' + added + ' 首链接音乐' : '链接音乐已添加');
        };
        if (playlistIds.length) {
          toast('正在导入 ' + playlistIds.length + ' 个歌单…');
          importPlaylistIds(playlistIds, (res) => {
            if (trackLines.length) addLinkLines(trackLines, isBatch);
            else { saveLibrary(); document.getElementById('tc-mask').hidden = true; renderPage(); }
            let msg = res.total
              ? '已导入 ' + res.plOk + ' 个歌单 / ' + res.total + ' 首' + (res.skipped ? '（跳过已有 ' + res.skipped + ' 首）' : '')
              : '歌单导入失败';
            if (res.vip) msg += '（VIP 歌曲 ' + res.vip + ' 首未导入）';
            if (res.plFail) {
              if (!res.total) {
                const ua = navigator.userAgent || '';
                msg += '：可能为私密歌单、已失效或被浏览器拦截';
                if (/QQBrowser/i.test(ua) || /Quark/i.test(ua)) msg += '（当前浏览器可能拦截了音乐 API，可换用 Safari 重试）';
                else msg += '，可稍后重试';
              } else {
                msg += '；' + res.plFail + ' 个失败（可能私密/已失效/被浏览器拦截）';
              }
            }
            toast(msg);
          }, targetPl);
          return;
        }
        addLinkLines(lines, isBatch);
      });
    });
  }

  // 批量导入（格式：歌曲名称 / 歌手 / 音乐直链URL，每首空一行）
  // v3.6.x：音乐直链URL 栏可直接填网易云数字 ID——自动拼装成网易云直链导入
  function openBatch() {
    if (!window.openTCPanel) return;
    window.openTCPanel('批量导入音乐', '' +
      '<div class="sm-fld-hint" style="margin-bottom:8px"><b>支持 3 种导入方式：</b><br>① <b>网易云歌单</b>：直接粘贴歌单分享链接（music.163.com/playlist?id=xxx 或 #/playlist?id=xxx），自动导入整个歌单；<br>② <b>网易云单曲</b>：每行一个歌曲数字 ID（如 2064961530），或<b>直接粘贴完整网易云链接</b>（如 music.163.com/#/song?id=xxx、song/media/outer/url?id=xxx.mp3），自动识别导入，不用手动填 ID；<br>③ <b>本地/直链</b>：按「歌曲名称 / 歌手 / 音乐直链URL」格式粘贴，每首歌空一行分隔（URL 栏同样支持直接贴网易云链接）。<br><br><span style="opacity:.75">⚠ 链接上传的 VIP/付费歌曲无法播放（仅免费歌曲可播）；歌单导入会自动移除 VIP/付费歌曲；歌单导入受网络环境影响（部分手机浏览器可能拦截），失败可稍后重试</span></div>' +
      '<textarea id="sm-batch-input" class="tc-input" rows="8" placeholder="网易云歌单链接：https://music.163.com/playlist?id=3778678&#10;网易云单曲链接：https://music.163.com/#/song?id=27538343&#10;或纯数字 ID：27538343&#10;&#10;歌曲名称：Baby&#10;歌手：EXO-K&#10;音乐直链URL：http://music.163.com/song/media/outer/url?id=27538343.mp3"></textarea>' +
      '<div class="sm-fld"><label>导入到歌单</label><select class="tc-input" id="sm-target-pl">' + targetPlOptions() + '</select></div>' +
      '<div class="mail-actions"><button class="cc-tool" id="sm-batch-cancel">取消</button><button class="cc-tool" id="sm-batch-ok">开始导入</button></div>');
    document.getElementById('sm-batch-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
    document.getElementById('sm-batch-ok').addEventListener('click', () => {
      const raw = readCeInput('sm-batch-input');
      if (!raw) { toast('请输入内容'); return; }
      resolveTargetPlaylist((targetPl) => {
        // v3.8.x：无标签纯链接模式——整段没有「名称：xxx」式标签时，按每行一个
        // 网易云 ID / 音乐链接导入（标签行以 歌曲名称：/name: 开头，链接含 :// 不算标签）
        const rawLines = raw.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
        // v3.8.x：歌单分享链接识别（含 playlist?id= 的行单独走歌单导入）
        const plIds = [];
        rawLines.forEach(l => { const pid = extractPlaylistId(l); if (pid && plIds.indexOf(pid) < 0) plIds.push(pid); });
        const isLabelLine = (l) => {
          if (/^https?:\/\//i.test(l) || /^\/\//.test(l)) return false;
          return /^[^:=：＝/]+?[:：＝=]\s*\S+/.test(l);
        };
        const hasLabels = rawLines.some(isLabelLine);
        const units = hasLabels
          ? raw.split(/\n\s*\n/).map(b => ({ lines: b.split('\n').map(s => s.trim()).filter(Boolean), plain: false }))
          : rawLines.filter(l => !extractPlaylistId(l)).map(l => ({ lines: [l], plain: true }));
        let added = 0;
        units.forEach((unit, ui) => {
          let name = '', artist = '', url = '';
          if (unit.plain) {
            url = unit.lines[0];
          } else {
            unit.lines.forEach(line => {
              const sepMatch = line.match(/^([^:=]+?)(?:[:：＝=])\s*(.+)$/);
              if (!sepMatch) {
                // v3.9.x：标签块里混入的裸链接/纯数字行直接当作 URL 值（无需标签，
                // 用户可在标签之间顺手贴一条网易云链接/ID）
                const t = line.trim();
                if (/^\d+$/.test(t) || /^https?:\/\//i.test(t)) url = t;
                return;
              }
              const key = sepMatch[1].replace(/\s+/g, '').toLowerCase();
              const val = sepMatch[2].trim();
              if (/^(歌曲名称|歌名|名称|name|歌曲)$/.test(key)) name = val;
              else if (/^(歌手|艺术家|艺人|artist|演唱)$/.test(key)) artist = val;
              else if (/^(音乐直链url|音乐直链|音乐链接|链接|直链|url|音乐url|link)$/.test(key)) url = val;
            });
          }
          if (!url) return;
          if (extractPlaylistId(url)) return; // 歌单链接单独走歌单导入，不当作单曲
          // v3.6.x：URL 栏支持纯数字网易云 ID / 完整网易云链接 / 任意 mp3 直链——
          // 统一提取数字 ID 并规范化成网易云直链（与「链接添加」一致）
          // v3.9.x：改用统一提取函数（支持 #/song?id=xxx、outer/url?id=xxx.mp3 等格式）
          const neteaseId = extractNeteaseSongId(url);
          if (neteaseId) {
            url = neteaseMetingUrl(neteaseId);
            if (!name) name = '网易云音乐-' + neteaseId; // 只填数字时自动补默认名
          }
          if (!name) {
            // 纯链接模式且非网易云 ID：取链接文件名当歌名，取不到给默认名
            const fn = (url.match(/\/([^/?#]+?)(?:\.[^/.?#]+)?$/) || [])[1];
            name = fn || '链接音乐';
          }
          if (!/^(https?:\/\/|file:\/\/|data:|\/)/i.test(url)) return;
          const nid = 'sm_batch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + ui;
          const item = { id: nid, neteaseId: neteaseId || '', name: name, artist: artist, url: url, source: 'url', duration: 0, playlistId: targetPl || 'default', addedAt: Date.now() };
          library.push(item);
          added++;
          // v3.6.x：数字 ID 自动识别歌曲名（与「链接添加」一致，识别到后覆盖默认名）
          if (neteaseId) {
            // v3.9.x：后台探测时长 + 拉取歌曲封面
            enqueueDurProbe(item);
            ensureSongCover(item);
            fetchNeteaseInfo(neteaseId, info => {
              const mm = library.find(x => x.id === nid);
              if (mm && info && info.name) {
                mm.name = info.name;
                if (info.artist) mm.artist = info.artist;
                if (info.duration && !mm.duration) { mm.duration = info.duration; updateDurUI(mm.id, mm.duration); }
                saveLibrary();
                renderPage();
              }
            });
          }
        });
        if (!added && !plIds.length) { toast('没有识别到有效歌曲，请检查格式'); return; }
        // v3.8.x：含歌单链接 → 歌单与单曲都导入后统一提示
        if (plIds.length) {
          toast('正在导入 ' + plIds.length + ' 个歌单…');
          importPlaylistIds(plIds, (res) => {
            saveLibrary();
            document.getElementById('tc-mask').hidden = true;
            renderPage();
            let msg = (added ? '已导入 ' + added + ' 首音乐 + ' : '已导入 ');
            if (res.total) {
              msg += res.plOk + ' 个歌单 / ' + res.total + ' 首';
            } else {
              msg += '0 首歌单（可能私密/已失效/被浏览器拦截';
              const ua = navigator.userAgent || '';
              if (/QQBrowser/i.test(ua) || /Quark/i.test(ua)) msg += '，当前浏览器可能拦截了音乐 API，可换用 Safari 重试';
              else msg += '，可稍后重试';
              msg += '）';
            }
            if (res.skipped) msg += '（跳过已有 ' + res.skipped + ' 首）';
            if (res.vip) msg += '（VIP 歌曲 ' + res.vip + ' 首未导入）';
            if (res.plFail && res.total) msg += '；' + res.plFail + ' 个歌单失败（可能私密/已失效/被拦截）';
            toast(msg);
          }, targetPl);
          return;
        }
        saveLibrary();
        document.getElementById('tc-mask').hidden = true;
        renderPage();
        toast('已导入 ' + added + ' 首音乐');
      });
    });
  }

  // ================= 歌单 =================
  function renderPlaylists() {
    const el = document.getElementById('music-pl-list');
    if (!el) return;
    const pls = playlists.slice();
    // "我的音乐库"虚拟项（playlistId='default' 的未归类歌曲池），置顶显示，点击可打开查看
    const libCount = library.filter(m => !m.playlistId || m.playlistId === 'default').length;
    const libItem = '<div class="sm-pl sm-pl-lib" data-pid="default">' +
      '<span class="sm-pl-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>' +
      '<div class="sm-pl-info"><div class="sm-pl-name">我的音乐库</div><div class="sm-pl-sub">' + libCount + ' 首</div></div>' +
      '</div>';
    el.innerHTML = libItem + pls.map(p => {
      const count = library.filter(m => m.playlistId === p.id).length;
      const icoCls = p.cover ? 'sm-pl-ico has-cov' : 'sm-pl-ico';
      const icoStyle = p.cover ? ' style="background-image:url(\'' + esc(p.cover) + '\')"' : '';
      const icoInner = p.cover ? '' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
      return '<div class="sm-pl" data-pid="' + p.id + '">' +
        '<span class="' + icoCls + '"' + icoStyle + '>' + icoInner + '</span>' +
        '<div class="sm-pl-info"><div class="sm-pl-name">' + esc(p.name) + '</div><div class="sm-pl-sub">' + count + ' 首</div></div>' +
        '<button class="sm-pl-edit" data-pid="' + p.id + '" title="编辑歌单"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
        '<button class="sm-pl-del" data-pid="' + p.id + '" title="删除歌单"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/></svg></button>' +
        '</div>';
    }).join('');
    el.querySelectorAll('.sm-pl').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.sm-pl-del') || e.target.closest('.sm-pl-edit')) return;
        const pid = row.dataset.pid;
        let pl, songs;
        if (pid === 'default') {
          pl = { name: '我的音乐库' };
          songs = library.filter(m => !m.playlistId || m.playlistId === 'default');
        } else {
          pl = playlists.find(p => p.id === pid);
          songs = library.filter(m => m.playlistId === pid);
        }
        if (!pl || !window.openTCPanel) return;
        window.openTCPanel(esc(pl.name), songs.length
          ? songs.map(m => '<div class="sm-song" data-id="' + m.id + '">' +
              songIcoHtml(m) +
              '<div class="sm-song-info"><div class="sm-song-name">' + esc(m.name || '未知歌曲') + '</div>' +
              '<div class="sm-song-sub">' + esc(m.artist || '未知歌手') + '</div></div>' +
              '<span class="sm-song-dur">' + fmtDur(m.duration) + '</span></div>').join('')
          : '<div class="ta-empty">这个歌单还没有歌曲</div>');
        document.querySelectorAll('#tc-body .sm-song').forEach(s => {
          s.addEventListener('click', () => playTrack(s.dataset.id));
        });
      });
    });
    el.querySelectorAll('.sm-pl-del').forEach(b => {
      b.addEventListener('click', () => {
        const pid = b.dataset.pid;
        const pl = playlists.find(p => p.id === pid);
        if (!pl) return;
        if (pl.id === 'spl_default') { toast('默认歌单不能删除'); return; }
        if (window.openModal) {
          window.openModal('删除歌单「' + pl.name + '」？歌单里的歌曲不会删除', '', () => {
            library.forEach(m => { if (m.playlistId === pid) m.playlistId = 'default'; });
            playlists = playlists.filter(p => p.id !== pid);
            saveLibrary(); savePlaylists(); renderPage();
          }, { noInput: true });
        }
      });
    });
    el.querySelectorAll('.sm-pl-edit').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); openPlaylistEditor(b.dataset.pid); });
    });
  }
  // ================= 歌单编辑（封面/重命名/删除） =================
  function openPlaylistEditor(pid) {
    const pl = playlists.find(p => p.id === pid);
    if (!pl || !window.openTCPanel) return;
    const isDefault = pl.id === 'spl_default';
    window.openTCPanel('编辑歌单', '' +
      '<div class="sm-fld"><label>歌单名称</label><input class="tc-input" id="sm-pe-name" value="' + String(pl.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></div>' +
      '<div class="sm-fld"><label>歌单封面</label>' +
      '<div class="sm-cov-row">' +
      '<div class="sm-cov-prev' + (pl.cover ? ' has-cov' : '') + '" id="sm-pe-cov-prev"' + (pl.cover ? ' style="background-image:url(\'' + esc(pl.cover) + '\')"' : '') + ' title="点击上传封面"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg></div>' +
      '<div class="sm-cov-actions"><button class="cc-tool sm-cov-btn" id="sm-pe-cov-up">上传封面</button><button class="cc-tool sm-cov-btn" id="sm-pe-cov-clear"' + (pl.cover ? '' : ' hidden') + '>清除封面</button></div>' +
      '</div></div>' +
      '<div class="sm-set-hint">设置封面后，可在「音乐设置」切换桌面小组件显示歌单封面或歌曲封面</div>' +
      '<div class="mail-actions">' + (isDefault ? '' : '<button class="cc-tool" id="sm-pe-del">删除歌单</button>') + '<button class="cc-tool" id="sm-pe-cancel">取消</button><button class="cc-tool" id="sm-pe-ok">保存</button></div>');
    const covPrev = document.getElementById('sm-pe-cov-prev');
    const covUp = document.getElementById('sm-pe-cov-up');
    const covClear = document.getElementById('sm-pe-cov-clear');
    const covInput = document.createElement('input');
    covInput.type = 'file'; covInput.accept = 'image/*'; covInput.style.display = 'none';
    document.body.appendChild(covInput);
    covInput.onchange = function () {
      const f = covInput.files && covInput.files[0];
      covInput.value = '';
      if (!f) return;
      compressCover(f, function (dv) {
        if (!dv) { toast('封面读取失败，请换一张图片'); return; }
        pl.cover = dv;
        savePlaylists(); renderPage();
        covPrev.classList.add('has-cov');
        covPrev.style.backgroundImage = 'url(\'' + dv + '\')';
        covClear.hidden = false;
        const cur = findTrack(currentId);
        if (cur && cur.playlistId === pid && settings.widgetCoverMode === 'playlist') setWidgetCover(cur);
        toast('歌单封面已设置');
      });
    };
    const pickCover = () => { try { covInput.click(); } catch (e) {} };
    if (covUp) covUp.addEventListener('click', pickCover);
    if (covPrev) covPrev.addEventListener('click', pickCover);
    if (covClear) covClear.addEventListener('click', () => {
      pl.cover = '';
      savePlaylists(); renderPage();
      covPrev.classList.remove('has-cov');
      covPrev.style.backgroundImage = '';
      covClear.hidden = true;
      const cur = findTrack(currentId);
      if (cur && cur.playlistId === pid && settings.widgetCoverMode === 'playlist') setWidgetCover(cur);
      toast('已清除歌单封面');
    });
    document.getElementById('sm-pe-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
    document.getElementById('sm-pe-ok').addEventListener('click', () => {
      const name = (document.getElementById('sm-pe-name').value || '').trim();
      if (name) pl.name = name;
      savePlaylists();
      document.getElementById('tc-mask').hidden = true;
      renderPage();
      toast('已保存');
    });
    const delBtn = document.getElementById('sm-pe-del');
    if (delBtn) delBtn.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('删除歌单「' + pl.name + '」？歌单里的歌曲不会删除', '', () => {
        library.forEach(m => { if (m.playlistId === pid) m.playlistId = 'default'; });
        playlists = playlists.filter(p => p.id !== pid);
        saveLibrary(); savePlaylists(); renderPage();
        document.getElementById('tc-mask').hidden = true;
      }, { noInput: true });
    });
  }
  const plCreate = document.getElementById('music-pl-create');
  if (plCreate) {
    plCreate.addEventListener('click', () => {
      if (!window.openTCPanel) return;
      window.openTCPanel('新建歌单', '' +
        '<div class="sm-fld"><label>歌单名称</label><input class="tc-input" id="sm-pl-name" placeholder="歌单名称"></div>' +
        '<div class="mail-actions"><button class="cc-tool" id="sm-pl-cancel">取消</button><button class="cc-tool" id="sm-pl-ok">创建</button></div>');
      document.getElementById('sm-pl-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
      document.getElementById('sm-pl-ok').addEventListener('click', () => {
        const name = (document.getElementById('sm-pl-name').value || '').trim();
        if (!name) { toast('请输入歌单名称'); return; }
        playlists.push({ id: 'spl_' + Date.now(), name: name, createdAt: Date.now() });
        savePlaylists();
        document.getElementById('tc-mask').hidden = true;
        renderPage();
        toast('歌单已创建');
      });
    });
  }

  // ================= 渲染 =================
  // 批量管理模式：勾选多首 → 删除 / 加入歌单
  let musicBatch = false;
  const batchSel = new Set();
  // v3.9.x：我的音乐库分类筛选——'all' 全部 / 'default' 未分类 / 具体歌单 id
  let libFilter = 'all';
  // v3.26.x：窗口化渲染——大量歌曲时一次性 innerHTML 全量渲染会创建海量 DOM 节点 + 逐节点
  // 绑定事件监听器，内存峰值激增触发 ERR_INSUFFICIENT_RESOURCES 资源耗尽导致闪退。
  // 默认只渲染前 LIB_RENDER_LIMIT 首，超出部分显示"加载更多"按钮按需追加。
  const LIB_RENDER_LIMIT = 300;
  let libRenderShown = LIB_RENDER_LIMIT;
  function libSongsFor(filter) {
    if (filter === 'default') return library.filter(m => !m.playlistId || m.playlistId === 'default');
    if (filter && filter !== 'all') return library.filter(m => m.playlistId === filter);
    return library.slice();
  }
  function renderLibrary() {
    const listEl = document.getElementById('music-lib-list');
    const emptyEl = document.getElementById('music-lib-empty');
    if (!listEl) return;
    const songs = libSongsFor(libFilter);
    if (emptyEl) {
      emptyEl.hidden = songs.length > 0;
      if (!songs.length) {
        emptyEl.textContent = libFilter === 'all'
          ? '还没有音乐，上传本地音乐，建立属于你们的声音陪伴空间'
          : (libFilter === 'default' ? '还没有未分类的音乐' : '这个歌单还没有歌曲');
      }
    }
    // v3.26.x：窗口化渲染——只渲染前 libRenderShown 首，避免一次性 innerHTML 海量 DOM 节点导致闪退
    const renderSongs = songs.slice(0, libRenderShown);
    listEl.innerHTML = renderSongs.length
      ? renderSongs.map(m => {
          const active = m.id === currentId;
          const icon = active && audio && !audio.paused
            ? '<path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z"/>'
            : '<path d="M8 5.5v13l11-6.5z"/>';
          const badge = m.source === 'local'
            ? '<span class="sm-src sm-src-local">本地</span>'
            : '<span class="sm-src">网络</span>';
          const checked = musicBatch && batchSel.has(m.id) ? ' sel' : '';
          const chk = musicBatch ? '<span class="sm-batch-chk"></span>' : '';
          return '<div class="sm-song' + (active ? ' active' : '') + checked + '" data-id="' + m.id + '">' +
            chk +
            songIcoHtml(m, icon) +
            '<div class="sm-song-info"><div class="sm-song-name">' + esc(m.name || '未知歌曲') + '</div>' +
            '<div class="sm-song-sub">' + esc(m.artist || '未知歌手') + ' · ' + badge + '</div></div>' +
            '<span class="sm-song-dur">' + fmtDur(m.duration) + '</span>' +
            '<button class="sm-song-more" data-id="' + m.id + '" title="管理"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>' +
            '</div>';
        }).join('')
      : '';
    // 还有更多歌曲 → 追加"加载更多"按钮，按需追加渲染而非一次性全量
    if (songs.length > renderSongs.length) {
      const more = document.createElement('div');
      more.className = 'sm-load-more';
      more.style.cssText = 'text-align:center;padding:14px;color:var(--accent,#e74c5e);font-size:14px;cursor:pointer;border-radius:8px;margin:6px 0;background:rgba(255,255,255,.06)';
      more.textContent = '还有 ' + (songs.length - renderSongs.length) + ' 首，点击加载更多';
      more.addEventListener('click', () => { libRenderShown += LIB_RENDER_LIMIT; renderLibrary(); });
      listEl.appendChild(more);
    }
    listEl.querySelectorAll('.sm-song').forEach(row => {
      row.addEventListener('click', (e) => {
        if (musicBatch) {
          const id = row.dataset.id;
          if (batchSel.has(id)) batchSel.delete(id); else batchSel.add(id);
          row.classList.toggle('sel', batchSel.has(id));
          updateBatchCount();
          return;
        }
        if (e.target.closest('.sm-song-more')) return;
        playTrack(row.dataset.id);
      });
    });
    listEl.querySelectorAll('.sm-song-more').forEach(b => {
      b.addEventListener('click', () => openSongMenu(b.dataset.id));
    });
  }
  // v3.9.x：我的音乐库分类筛选条——全部音乐 / 未分类音乐（无未分类歌曲时不显示）/ 各歌单
  function renderLibFilter() {
    const wrap = document.getElementById('music-lib-filter');
    if (!wrap) return;
    const unclassified = library.filter(m => !m.playlistId || m.playlistId === 'default');
    // 当前筛选分组已不存在（未分类被删光 / 歌单被删）→ 自动回退「全部音乐」
    if (libFilter === 'default' && !unclassified.length) libFilter = 'all';
    if (libFilter !== 'all' && libFilter !== 'default' && !playlists.some(p => p.id === libFilter)) libFilter = 'all';
    wrap.hidden = !library.length;
    const chip = (key, name, count) =>
      '<button class="mlf-chip' + (libFilter === key ? ' sel' : '') + '" data-mlf="' + key + '">' +
      '<span class="mlf-name">' + name + '</span><span class="mlf-cnt">' + count + '</span></button>';
    let html = '<button class="mlf-chip mlf-queue" id="sm-lib-queue" title="查看播放队列">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h9"/></svg>' +
      '<span class="mlf-name">播放列表</span>' + (playQueue.length ? '<span class="mlf-cnt">' + playQueue.length + '</span>' : '') + '</button>';
    html += chip('all', '全部音乐', library.length);
    if (unclassified.length) html += chip('default', '未分类音乐', unclassified.length);
    html += playlists.map(p => chip(p.id, esc(p.name), library.filter(m => m.playlistId === p.id).length)).join('');
    wrap.innerHTML = html;
    const libQueue = document.getElementById('sm-lib-queue');
    if (libQueue) libQueue.addEventListener('click', openQueuePanel);
    wrap.querySelectorAll('.mlf-chip').forEach(b => {
      b.addEventListener('click', () => {
        if (!b.dataset.mlf) return;
        if (libFilter === b.dataset.mlf) return;
        libFilter = b.dataset.mlf;
        libRenderShown = LIB_RENDER_LIMIT; // 切换分类时重置窗口化渲染计数
        if (musicBatch) batchSel.clear();
        renderLibFilter();
        renderLibrary();
        updateBatchCount();
      });
    });
  }
  // 批量管理：进入/退出
  function enterBatch() {
    musicBatch = true;
    batchSel.clear();
    renderLibrary();
    if (!document.getElementById('music-batch-bar')) {
      const bar = document.createElement('div');
      bar.id = 'music-batch-bar';
      bar.className = 'music-batch-bar';
      bar.innerHTML =
        '<span class="music-batch-count" id="music-batch-count">已选 0 首</span>' +
        '<button class="music-batch-btn" id="mb-all">全选</button>' +
        '<button class="music-batch-btn" id="mb-to-pl">加入歌单</button>' +
        '<button class="music-batch-btn music-batch-del" id="mb-del">删除</button>' +
        '<button class="music-batch-btn" id="mb-exit">退出</button>';
      document.body.appendChild(bar);
      bar.querySelector('#mb-all').addEventListener('click', () => {
        const ids = libSongsFor(libFilter).map(m => m.id);
        if (batchSel.size === ids.length && ids.length) batchSel.clear();
        else ids.forEach(id => batchSel.add(id));
        renderLibrary();
        updateBatchCount();
      });
      bar.querySelector('#mb-del').addEventListener('click', () => {
        if (!batchSel.size) { toast('请先勾选歌曲'); return; }
        if (window.openModal) {
          window.openModal('删除选中的 ' + batchSel.size + ' 首音乐？', '', () => {
              library = library.filter(m => !batchSel.has(m.id));
            if (window.idbGetAllKeys) {
              window.idbGetAllKeys().then(keys => {
                // v3.5.123：全等匹配（前缀匹配在 id 互为前缀时会误删）
                keys.filter(k => { for (const id of batchSel) if (k === MUSIC_PREFIX + ':music-file:' + id) return true; return false; })
                  .forEach(k => { if (window.idbDelete) window.idbDelete(k); });
              });
            }
            if (batchSel.has(currentId)) { teardownAudio(); currentId = null; }
            batchSel.clear();
            saveLibrary();
            renderPage();
            updateBatchCount();
            toast('已删除');
          }, { noInput: true });
        }
      });
      bar.querySelector('#mb-to-pl').addEventListener('click', () => {
        if (!batchSel.size) { toast('请先勾选歌曲'); return; }
        if (!window.openTCPanel) return;
        window.openTCPanel('加入歌单', '<div class="sm-fld"><label>选择歌单</label><select class="tc-input" id="mb-pl-select">' +
          playlists.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select></div>' +
          '<div class="mail-actions"><button class="cc-tool" id="mb-pl-cancel">取消</button><button class="cc-tool" id="mb-pl-ok">加入</button></div>');
        document.getElementById('mb-pl-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
        document.getElementById('mb-pl-ok').addEventListener('click', () => {
          const pid = document.getElementById('mb-pl-select').value;
          library.forEach(m => { if (batchSel.has(m.id)) m.playlistId = pid; });
          saveLibrary();
          document.getElementById('tc-mask').hidden = true;
          batchSel.clear();
          renderPage();
          updateBatchCount();
          toast('已加入歌单');
        });
      });
      bar.querySelector('#mb-exit').addEventListener('click', exitBatch);
    }
    document.getElementById('music-batch-bar').hidden = false;
    // v3.5.138：批量条盖住底部播放条（播放/暂停/切歌不可操作）——批量期间隐藏播放条
    const pb = document.getElementById('sm-player-bar');
    if (pb) pb.hidden = true;
    updateBatchCount();
  }
  function exitBatch() {
    musicBatch = false;
    batchSel.clear();
    const bar = document.getElementById('music-batch-bar');
    if (bar) bar.hidden = true;
    // v3.5.138：退出批量恢复播放条（仅当有歌在播/有 currentId 时；无歌保持隐藏）
    const pb = document.getElementById('sm-player-bar');
    if (pb) pb.hidden = !(currentId && audio);
    renderLibrary();
  }
  function updateBatchCount() {
    const el = document.getElementById('music-batch-count');
    if (el) el.textContent = '已选 ' + batchSel.size + ' 首';
  }
  // 渲染单条听歌记录（我的 / TA 邀请共用）
  function renderHistoryItem(x) {
    // v3.9.x：听歌记录显示歌曲封面——优先取记录里冗余存的 cover，
    // 没有（旧记录/歌曲删了）再按 trackId 回查当前音乐库；都拿不到保留原图标
    const t = (!x.mode && x.trackId) ? findTrack(x.trackId) : null;
    const cov = (!x.mode && (x.cover || (t && t.cover))) || '';
    const ico = cov
      ? '<span class="sm-his-ico has-cov" style="background-image:url(\'' + esc(cov) + '\')"></span>'
      : '<span class="sm-his-ico">' + (x.mode
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>') + '</span>';
    return '<div class="sm-his">' + ico +
      '<div class="sm-his-info"><div class="sm-his-name">' + (x.mode ? esc(window.taFit ? window.taFit(x.triggerType || '播放模式') : (x.triggerType || '播放模式')) : esc(x.trackName || '未知歌曲')) + '</div>' +
      '<div class="sm-his-sub">' + fmtDT(x.ts) + (x.mode ? '' : (x.triggerType ? ' · ' + esc(window.taFit ? window.taFit(x.triggerType) : x.triggerType) : '')) + '</div></div></div>';
  }
  function renderHistory() {
    const el = document.getElementById('music-his-list');
    if (!el) return;
    // v3.9.x：二级子 tab——「我的听歌」/「TA 邀请听歌」分开记，避免自己点歌和 TA 邀请混在一起
    const subBar = '<div class="sm-his-subtabs">' +
      '<button class="sm-his-subtab' + (hisSubTab === 'mine' ? ' sel' : '') + '" data-hissub="mine">我的听歌</button>' +
      '<button class="sm-his-subtab' + (hisSubTab === 'ta' ? ' sel' : '') + '" data-hissub="ta">' + (window.taFit ? window.taFit('TA 邀请听歌') : 'TA 邀请听歌') + '</button>' +
      '</div>';
    if (hisSubTab === 'mine') {
      const h = myHistory.slice().reverse();
      el.innerHTML = subBar + (h.length
        ? h.map(renderHistoryItem).join('')
        : '<div class="ta-empty">还没有听歌记录，你播放过的歌会记在这里</div>');
    } else {
      const h = history.slice().reverse();
      el.innerHTML = subBar + (h.length
        ? h.map(renderHistoryItem).join('')
        : '<div class="ta-empty">' + (window.taFit ? window.taFit('还没有梦角邀请听歌记录，TA 邀请你一起听歌的记录会出现在这里') : '还没有梦角邀请听歌记录，TA 邀请你一起听歌的记录会出现在这里') + '</div>');
    }
    // 子 tab 点击：切换并重渲染
    el.querySelectorAll('.sm-his-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.hissub;
        if (v === hisSubTab) return;
        hisSubTab = v;
        renderHistory();
      });
    });
  }
  function renderPage() {
    renderLibFilter();
    renderLibrary();
    renderPlaylists();
    renderFavList();
    renderTaFavList();
    syncTaFavTab();
    renderHistory();
    updatePlayerBar();
    syncFloatToggle();
  }

  // ================= 播放器 =================
  // v3.6.x：本地音频播放——blob: URL 和 dataURL 双路径互为兜底。
  // 夸克等浏览器对 `<audio src="data:...">`（大段 base64）播放失效，blob: 必走；
  // 永恒浏览器（安卓 WebView）相反，对 blob: URL 音频静默失败（play() Promise 挂起、
  // onplay 不触发、无声无提示），dataURL 直接作为 src 才能播。
  // 策略：Blob 优先 blob:，dataURL 字符串优先 dataURL；4 秒无 onplay/无进度 →
  // teardown 切另一种 src 重试。两种都失败 → toast 提示。
  let curObjectUrl = null;
  function revokeObjectUrl() {
    if (curObjectUrl) { try { URL.revokeObjectURL(curObjectUrl); } catch (e) {} curObjectUrl = null; }
  }
  // dataURL 字符串 → Blob：优先 fetch（原生异步解码，不阻塞主线程），失败回退手动 base64 解码
  function dataUrlToBlob(dataUrl) {
    const manual = () => new Promise((resolve, reject) => {
      try {
        const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
        if (!m) { reject(new Error('bad data url')); return; }
        const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        resolve(new Blob([bytes], { type: m[1] || 'audio/mpeg' }));
      } catch (e) { reject(e); }
    });
    if (typeof fetch === 'function') {
      return fetch(dataUrl).then(r => r.blob()).catch(() => manual());
    }
    return manual();
  }
  // Blob → dataURL 字符串（FileReader，异步；用于 blob: 失败后切 dataURL 重试）
  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result || '');
      fr.onerror = () => resolve('');
      try { fr.readAsDataURL(blob); } catch (e) { resolve(''); }
    });
  }
  // 用本地值（Blob 或 dataURL 字符串）建音频并播放
  function playLocal(m, v) {
    if (currentId !== m.id) return;
    // v3.30.x：脏值兜底守卫——loadLocal 已过滤超短脏值，这里拦第二层（如侥幸通过长度
    // 校验的垃圾串），绝不把非法 src 喂给 <audio>（Blob 会转 blob: URL，天然合法）
    if (!(v instanceof Blob) && !validAudioSrc(v)) {
      toast('播放失败：音频数据无效'); wantPlay = false; clearBgResume(); currentId = null; updatePlayerBar(); renderLibrary();
      return;
    }
    let failoverUsed = false; // 防止 blob:↔dataURL 之间无限切换
    // 用指定 src 建 audio 并启动播放，4 秒无 onplay/无进度 → 切另一种 src
    function startWithSrc(src, isBlob) {
      if (currentId !== m.id) return;
      if (isBlob) { revokeObjectUrl(); curObjectUrl = src; }
      audio = createAudio();;
      audio.src = src;
      startPlayback(m);
      let wd = setTimeout(() => {
        wd = null;
        if (currentId !== m.id || !audio) return; // 已切歌/已 teardown
        if (audio.currentTime > 0) return; // 已在播，blob:/dataURL 成功
        if (failoverUsed) { // 两种 src 都失败
          toast('播放失败：浏览器无法加载音频');
          try { audio.pause(); } catch (e) {}
          try { syncPlayIcons(false); } catch (e) {}
          return;
        }
        failoverUsed = true;
        teardownAudio();
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        if (isBlob) {
          // blob: 失败 → 切 dataURL 直接作为 src（永恒浏览器走这条）
          const dataUrlP = (v instanceof Blob) ? blobToDataUrl(v) : Promise.resolve(v);
          dataUrlP.then(dataUrl => {
            if (currentId !== m.id) return;
            if (!dataUrl) { toast('播放失败：浏览器无法加载音频'); currentId = null; updatePlayerBar(); renderLibrary(); return; }
            startWithSrc(dataUrl, false);
          });
        } else {
          // dataURL 失败 → 切 blob: URL（夸克浏览器走这条）
          const blobP = (v instanceof Blob) ? Promise.resolve(v) : dataUrlToBlob(v);
          blobP.then(blob => {
            if (currentId !== m.id) return;
            try { startWithSrc(URL.createObjectURL(blob), true); } catch (e) { toast('播放失败：浏览器无法加载音频'); }
          }).catch(() => { toast('播放失败：浏览器无法加载音频'); currentId = null; updatePlayerBar(); renderLibrary(); });
        }
      }, 4000);
      // onplay 取消 watchdog（正常出声，无需切 src）
      if (audio) audio.addEventListener('play', () => { if (wd) { clearTimeout(wd); wd = null; } }, { once: true });
    }
    // 先试：Blob → blob: URL；dataURL 字符串 → dataURL 直接作为 src
    if (v instanceof Blob) {
      try { startWithSrc(URL.createObjectURL(v), true); } catch (e) { toast('播放失败：浏览器无法加载音频'); }
    } else {
      startWithSrc(v, false);
    }
  }
  // v3.10.x：单实例清场——本模块创建的每个 <audio> 都登记在 liveAudioEls，
  // 每次新建前把在册旧元素全部硬停（pause＋解绑事件＋去 src＋load 中断下载＋移出 DOM）。
  // 根因（用户实测：红米K80 弱网点播出现两个播放器同时响、暂停只停一个）：
  // 停滞守卫 retryWithHttpsUrl 先 teardownAudio 再异步拉 meting 直链（最长 8s），
  // 空窗期里原 play() 被 teardown 中断而 reject → handlePlayReject 武装自动续播/
  // 后台补播 → tryResumePlayback 见 !audio 就 rebuildAndPlay 用旧 URL 造出野元素；
  // 直链回来后 audio = createAudio() 只覆盖变量、没人停野元素 → 双声，暂停只停
  // 变量指向的那个。收口到唯一工厂后，无论哪条竞态路径抢先造过元素，新建时必被
  // 清场，结构上保证任意时刻最多只有一个可能出声的 <audio>（暂停即全停）。
  let liveAudioEls = [];
  function killAudioEl(a) {
    try { a.onended = null; a.onerror = null; a.onloadedmetadata = null; a.onplay = null; a.onpause = null; a.pause(); a.removeAttribute('src'); a.load(); } catch (e) {}
    try { if (a.parentNode) a.parentNode.removeChild(a); } catch (e) {}
  }
  // v3.9.x：创建 audio 元素并 attached 到 DOM（display:none）——
  // QQ浏览器 X5 内核对未 attached 的 new Audio() 元素播放限制更严格
  //（即使用户手势内 play() 也被拒），attached 后手势续播能放行。
  function createAudio() {
    liveAudioEls.forEach(killAudioEl);
    liveAudioEls = [];
    const a = new Audio();
    try { a.style.display = 'none'; document.body.appendChild(a); } catch (e) {}
    liveAudioEls.push(a);
    return a;
  }
  // v3.26.x：audio.src 赋值守卫——曲目 url 字段可能被存成脏值（空对象序列化成 '{}'），
  // 直接赋给 <audio> 会解析成站内路径 /mochi/{} 并打印一堆「资源加载失败」错误。
  // 只放行标准 http(s)/blob:/data: 链路，非法值返回 false 让调用方走失败兜底
  //（offerRemoveDamagedSong 的连续失败判定 / 跳过重播），不再把脏地址喂给 <audio>。
  function validAudioSrc(v) {
    return typeof v === 'string' &&
      (/^https?:\/\//i.test(v) || /^blob:/i.test(v) || /^data:/i.test(v));
  }
  // v3.30.x：本地歌曲文件值形状校验——本地链路只接受 Blob（新存储）或 dataURL 长字符串
  //（旧存储）。历史版本曾把 JSON 序列化串（'{}'、'[object Blob]' 等）写进 music-file 键
  //（双写/序列化失误），直接喂给 <audio> 会解析成站内路径 /mochi/{} 刷「资源加载失败」。
  // Blob 无条件放行；字符串要求 ≥10 字符（有效 dataURL 远长于此，超短串必为脏值）。
  function plausibleLocalValue(v) {
    if (v instanceof Blob) return true;
    if (typeof v === 'string') return v.length >= 10;
    return false;
  }
  // v3.30.x：清除某个本地歌的脏存储值。仅当本次读到的值已确认非法时调用——null/undefined
  // 表示数据缺失（可能只是 IDB 挂起超时，好文件还在），不得误删；'{}' 等脏值必删，
  // 否则每次刷新都反复读到同一脏值、永远需要手动删歌重加。
  function purgeLocalFile(m) {
    try { if (localBlobCache) delete localBlobCache[m.id]; } catch (e) {}
    try { store.remove('music-file:' + m.id); } catch (e) {} // 内存缓存+LS+IDB(default 前缀)
    try { localStorage.removeItem('xy-home-v2:music-file:' + m.id); } catch (e) {} // 旧 uid 前缀
    try { if (window.idbDelete) window.idbDelete('xy-home-v2:music-file:' + m.id); } catch (e) {}
  }
  function teardownAudio() {
    if (audio) { killAudioEl(audio); audio = null; }
    // v3.10.x：在册元素一并清场（竞态窗口内可能存在未被变量引用的野元素）
    liveAudioEls.forEach(killAudioEl);
    liveAudioEls = [];
    revokeObjectUrl();
    playRejected = false;
    endedHandled = false;
    disarmAutoResume();
    clearBgResume();
    clearStallGuard();
    bgBrokeAudio = false; // v3.29.x：切歌/停止清后台断流标记
    // v3.14.x：停止/切歌后不再判定联系人收藏（新播放会重新调度）
    clearTaFavTimer();
    // v3.27.x：停止/切歌取消 TA 暂停互动（未触发的延迟计划、进行中的恢复计划一并清）
    cancelTaPause();
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    // v3.9.x：真正停止（非切歌）后让 bg-keep 恢复"后台保活"媒体会话条；
    // 切歌时 currentId 已指向新歌，此处不触发
    setTimeout(function () {
      if (!audio && !currentId) {
        try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; } catch (e) {}
        try { document.dispatchEvent(new Event('music-media-release')); } catch (e) {}
      }
    }, 0);
  }
  // v3.5.112：内置种子歌曲判定与本地旋律兜底（共享：外链播放失败 / 本地数据缺失时使用）
  function seedIdxOf(m) {
    const seedId = m ? String(m.neteaseId || '') : '';
    if (seedId === '2613048732') return 0;
    if (seedId === '27538343') return 1;
    return -1;
  }
  let demoFallbackBusy = false; // 防止外链失败 → demo 失败 → 再走 demo 的递归
  // 现场合成内置示例旋律并直接播放（不改歌曲数据，外链/本地数据都保留）
  function playDemoFor(m, seedIdx) {
    genDemoAudio(seedIdx).then(d => {
      if (!d) { toast('播放失败：网络链接可能已失效，或该歌曲为VIP付费歌曲'); demoFallbackBusy = false; wantPlay = false; clearBgResume(); return; }
      try { window.idbSet(MUSIC_PREFIX + ':music-file:' + m.id, d); } catch (e) {}
      demoFallbackBusy = false;
      if (currentId !== m.id) return;
      teardownAudio();
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
      playLocal(m, d);
    });
  }
  // 播放启动（audio 已设 src 后调用）
  function startPlayback(m) {
    if (!audio) return;
    audio.preload = 'auto';
    setupHandlers(m);
    // v3.x：来电 hold 期间音频异步加载完成 → 不播放（避免通话中音乐响起），
    // 通话结束由 musicHoldForCall(false) 统一恢复播放与悬浮窗
    if (callHoldPending) { try { syncPlayIcons(false); } catch (e) {} return; }
    wantPlay = true; // v3.10.x：用户点播/切歌＝意图播放（外部打断时自动续播的依据）
    const p = audio.play();
    if (p && p.catch) {
      p.catch((err) => {
        // v3.28.x：防 null.play() 崩溃——play() 的 rejection 是异步回调，其间 audio
        // 可能已被 teardownAudio 置空（断网/弱网 meting 加载失败 → onerror →
        // retryWithHttpsUrl 先 teardown 再异步拉直链；或用户切歌/停止）。不判空直接
        // audio.play() 会抛「Cannot read properties of null (reading 'play')」
        //（红米K80 断网实测）。换源回调/后台补播/手势兜底自会接管，这里静默返回。
        if (!audio) return;
        // v3.27.x：区分 play() reject 的错误类型——只有 NotAllowedError 才是真正的
        // 自动播放策略拦截（走 muted 静音解锁）；其他错误（NotSupportedError/AbortError
        // 等）是源加载失败/跨域/混合内容/meting 服务不可达，走外链失败兜底（拉完整版
        // 直链/内置旋律），不再一律当"自动播放拦截"处理而误导用户"被浏览器拦截"。
        // 根因：网易云歌曲 audio.src 是跨域 meting URL，部分浏览器在跨域 media 数据未
        // 就绪时 play() 返回非 NotAllowedError 的 reject，旧代码不区分错误类型全走
        // muted 解锁 → 仍失败 → 弹"被浏览器拦截"，吞掉了本应走的拉直链/兜底路径。
        if (err && err.name !== 'NotAllowedError') {
          // v3.26.x：换源窗口期的拒绝是 teardown 旧元素的自然结果（同 handlePlayReject
          // 的守卫）——不视为源失效，静默等换源回调接管；否则会漏进 demoFallbackOrError
          // → offerRemoveDamagedSong 误计数/误停新元素（弱网换源场景）。
          if (httpsRetrying || demoFallbackBusy) return;
          // v3.29.x（回归修复）：后台（document.hidden）的非 NotAllowedError 拒绝＝源加载
          // 失败/断网（meting 不可达）。a6d854a 前所有拒绝都走 muted 解锁 + scheduleBgResume
          // 退避补播：自动下一首被拒后当前元素每隔 300ms~12s 反复试播，源短暂恢复立刻接上；
          // a6d854a 起改成「一次性 https 拉直链链」——后台 fetch 挂起/网络抖动时单发即弃、
          // 无退避，音乐停在后台（红米K80 实测「切后台无法自动播放下一首」，诊断见 meting
          // 网络失败）。这里恢复后台退避补播：不烧直链重试、不弹窗，保留当前元素交
          // scheduleBgResume 反复试播（源恢复即接上）；回前台 resumeOnForeground 见
          // bgBrokeAudio 再完整重建（playTrack 重置 _httpsRetried 走正常链路）。
          if (document.hidden) {
            bgBrokeAudio = true;
            playRejected = true;
            scheduleBgResume();
            return;
          }
          if (m && m.neteaseId && !m._httpsRetried) {
            if (retryWithHttpsUrl(m)) return;
          }
          demoFallbackOrError(m);
          return;
        }
        // v3.6.x：移动端自动播放策略——本地文件是「异步从 IDB/Blob 读回后再 play()」，
        // 用户点击的手势上下文已丢失，play() 被浏览器拒绝（NotAllowedError）。
        // muted 静音解锁（Chromium/国产 WebView 的 autoplay 策略对静音媒体放行）：
        // 静音 play() → 成功后再恢复音量。这比「提示用户再点一下屏幕」在
        // Via/OPPO 自带等国产浏览器上更可靠（实测其手势续播仍被拒）。
        try { audio.muted = true; } catch (e) {}
        const p2 = audio.play();
        if (p2 && p2.then) {
          p2.then(() => {
            if (audio) audio.muted = false; // 静音解锁成功 → 恢复出声
            playRejected = false;
            clearStallGuard();
            disarmAutoResume();
            try { syncPlayIcons(true); } catch (e) {}
          }).catch((e2) => {
            // v3.10.x：muted 也被拒——手势内才弹提示，自动切歌/断链重试等
            // 非手势场景静默走补播反击（聊天中听歌突然中断弹"被拦截"即此）
            if (audio) { try { audio.muted = false; } catch (e) {} }
            handlePlayReject(e2);
          });
        } else {
          handlePlayReject(err);
        }
      });
    }
    armStallGuard(m);
    updatePlayerBar();
    renderLibrary();
    startProgress();
    addMyRecord(m.id);
    // v3.14.x：联系人按概率收藏正在播的歌（听 10~25s 后判定，切歌/暂停即取消）
    scheduleTaFavCheck(m);
    // v3.27.x：TA 暂停再播放互动掷骰子（taPauseProb 概率，每首歌一次）
    scheduleTaPauseIfLucky();
    updateMediaSession(true);
  }
  // v3.6.x：自动播放被拒后的手势恢复——移动端 play() 被拒（异步链丢手势）后，
  // 挂一次性手势监听，用户下一次触摸/点击（任意位置）时恢复播放。
  // v3.9.x：QQ浏览器 X5 内核对已 rejected 的 audio 元素缓存 rejection 状态，
  // 后续同一元素的 play() 都被拒（即使用户手势内）。retry 里重新创建 audio
  // 元素 + 设置 src + play()，在用户手势内完整重建播放链路，绕过缓存。
  let autoResumeArmed = false;
  function armAutoResume() {
    if (autoResumeArmed) return;
    autoResumeArmed = true;
    const retry = function () {
      disarmAutoResume();
      if (!currentId) return;
      // v3.10.x：换源/兜底窗口期不重建——同理防野元素双声，等换源回调接管
      if (httpsRetrying || demoFallbackBusy) return;
      const m = findTrack(currentId);
      if (!m) return;
      // v3.29.x：本地歌 m.url='' → audio.src='' 必失败。重新走 playTrack 本地分支
      //（同步查内存缓存/localStorage 或异步 idbGet），而非用空 url 造必失败的元素。
      if (m.source === 'local' || (!m.url && m.source !== 'url')) {
        try { playTrack(currentId); } catch (e) {}
        return;
      }
      // v3.9.x：重新创建 audio 元素（X5 内核缓存 rejection 的兜底）
      try { if (audio) { audio.pause(); audio.onended = null; audio.onerror = null; audio.onloadedmetadata = null; audio.onplay = null; audio.onpause = null; if (audio.parentNode) audio.parentNode.removeChild(audio); } } catch (e) {}
      audio = createAudio();
      try { audio.referrerPolicy = 'no-referrer'; } catch (e) {}
      audio.preload = 'auto';
      setupHandlers(m);
      audio.src = m.url;
      const p2 = audio.play();
      if (p2 && p2.catch) p2.catch(function () { armAutoResume(); });
    };
    document.addEventListener('pointerdown', retry, true);
    document.addEventListener('touchend', retry, true);
    document.addEventListener('click', retry, true);
    document._mochiAutoResume = retry;
  }
  function disarmAutoResume() {
    autoResumeArmed = false;
    const retry = document._mochiAutoResume;
    if (!retry) return;
    document._mochiAutoResume = null;
    document.removeEventListener('pointerdown', retry, true);
    document.removeEventListener('touchend', retry, true);
    document.removeEventListener('click', retry, true);
  }
  // v3.10.x：后台被暂停自动续播——手机浏览器/系统在页面切后台后可能因省电、音频焦点
  // 抢占、渲染进程冻结等暂停 <audio>（用户没点暂停），表现为「挂后台音乐突然停了，
  // 切回前台才恢复」。旧逻辑只有 armAutoResume（等手势）兜底，后台完全无反击。
  // 引入「意图播放」标记 wantPlay：只有用户主动暂停、真正停止、来电 hold 才清除；
  // 其余 pause 一律视为外部打断 → 后台按 300ms~12s 退避定时补播；回前台（visible/
  // focus/pageshow）立即补播；另加 10s 看门狗兜住漏网场景。补播先试原元素（保留进度），
  // 被拒再 muted 静音解锁降级（同 startPlayback 思路），仍失败重建元素（X5 缓存
  // rejection 兜底，同 armAutoResume.retry）；全程静默不弹 toast。
  let wantPlay = false;
  // v3.29.x：后台冻结/断流导致 audio onerror 触发过——切回前台时若为 true，
  // 说明当前 audio 元素的 src 已失效（典型：retryWithHttpsUrl 把 src 换成 neteaseOuterUrl
  // 的 http CDN，HTTPS 页面下被混合内容拦截；或后台 fetch 挂起后 src 残留坏链）。
  // 此时用旧元素 play() 必失败 → offerRemoveDamagedSong 累计失败 → 误弹"会员/付费歌曲"窗。
  // 切回前台应直接 playTrack(currentId) 完整重建（用原始 m.url + 重置 _httpsRetried），
  // 而非 tryResumePlayback 用坏元素。onplay / teardownAudio / 重建成功时清零。
  let bgBrokeAudio = false;
  // v3.28.x：把「是否还想继续播放」（外部打断暂停 vs 用户主动暂停）实时暴露给 bg-keep——
  // bg-keep 需要据此决定是否接管媒体会话：音乐还有播放意图（wantPlay=true）时，其
  // setKeepMediaSession 不得覆盖歌曲媒体条，否则短暂后台打断会吞掉通知栏歌曲条。
  try {
    Object.defineProperty(window, '__musicWantPlay', {
      configurable: true,
      get: function () { return wantPlay; }
    });
  } catch (e) {}
  let bgResumeTimers = [];
  let bgResumeFails = 0; // 连续补播失败计数（死链/持续拦截时封顶，防止看门狗无限拉取）
  let bgResumeFailAt = 0; // 最近一次补播失败时刻；封顶后冷却 60s 清零重试一轮，后台不永久放弃
  function clearBgResume() {
    bgResumeTimers.forEach(clearTimeout);
    bgResumeTimers = [];
  }
  function scheduleBgResume() {
    clearBgResume();
    [300, 1500, 5000, 12000].forEach(function (d) {
      bgResumeTimers.push(setTimeout(function () { tryResumePlayback(); }, d));
    });
  }
  function tryResumePlayback() {
    if (!wantPlay || callHoldPending) return;
    // v3.28.x：连续失败封顶由「永久放弃」改为「冷却 60s 后清零重试」——旧逻辑 ≥6 次失败后
    // 后台永远不再尝试，弱网/音频焦点频繁被抢时音乐停播后无人拉起（用户实测「挂后台总自己停」）。
    // 冷却期内停手（不无限拉取），冷却结束清零再来一轮，配合回前台清零与 onplay 复位。
    if (bgResumeFails >= 6) {
      if (Date.now() - bgResumeFailAt < 60000) return;
      bgResumeFails = 0;
    }
    // v3.27.x：TA 暂停再播放互动进行中不补播（暂停 3.5s 由 TA 自己恢复）
    if (taPauseActive) return;
    // v3.10.x：换源/兜底窗口期不补播——!audio 分支会用旧 URL 造野元素，
    // 与即将回来的直链播放形成双声（弱网双播放器根因之一），还抢弱网带宽
    if (httpsRetrying || demoFallbackBusy) return;
    const m = findTrack(currentId);
    if (!m) { wantPlay = false; return; }
    if (!audio || audio.ended) {
      // 元素已丢失/已自然结束（冻结期间 ended 未及时处理）→ 只对外链歌重建链路
      rebuildAndPlay(m);
      return;
    }
    if (!audio.paused) return;
    const p = audio.play();
    if (p && p.then) {
      p.then(function () { bgResumeFails = 0; }).catch(function () {
        if (!audio) return; // v3.28.x：回调异步期间可能已 teardown（换源/切歌/停止），判空防 null.play()
        try { audio.muted = true; } catch (e) {}
        const p2 = audio.play();
        if (p2 && p2.then) {
          p2.then(function () { try { if (audio) audio.muted = false; } catch (e) {} bgResumeFails = 0; })
            .catch(function () { bgResumeFails++; bgResumeFailAt = Date.now(); rebuildAndPlay(m); });
        } else { bgResumeFails++; bgResumeFailAt = Date.now(); rebuildAndPlay(m); }
      });
    }
  }
  function rebuildAndPlay(m) {
    if (!wantPlay || !currentId || currentId !== m.id) return;
    if (!(m.source === 'url' && m.url)) return; // 本地 Blob 歌只走原元素续播
    try { if (audio) { audio.onended = null; audio.onerror = null; audio.onloadedmetadata = null; audio.onplay = null; audio.onpause = null; audio.pause(); if (audio.parentNode) audio.parentNode.removeChild(audio); } } catch (e) {}
    audio = createAudio();
    try { audio.referrerPolicy = 'no-referrer'; } catch (e) {}
    audio.preload = 'auto';
    setupHandlers(m);
    audio.src = m.url;
    const p = audio.play();
    if (p && p.catch) p.catch(function () { bgResumeFails++; bgResumeFailAt = Date.now(); });
  }
  // 回前台兜底：冻结解除/中断结束后立刻补播（不等用户点屏幕）
  function resumeOnForeground() {
    // v3.29.x：后台冻结/断流导致 audio onerror 过 → 旧元素 src 已失效（典型 neteaseOuterUrl
    // 的 http CDN 在 HTTPS 页面下被混合内容拦截，或后台 fetch 挂起后 src 残留坏链）。
    // 用旧元素 play() 必失败 → offerRemoveDamagedSong 累计失败 → 误弹"会员/付费歌曲"窗。
    // 直接 playTrack(currentId) 完整重建：用原始 m.url、重置 _httpsRetried、新 audio 元素，
    // 走正常起播链路（手势内可播 / 被拒则 armAutoResume 等用户点一下屏幕恢复）。
    if (bgBrokeAudio && wantPlay && currentId && !callHoldPending && !taPauseActive && !httpsRetrying && !demoFallbackBusy) {
      bgBrokeAudio = false;
      try { playTrack(currentId); } catch (e) {}
      return;
    }
    bgBrokeAudio = false;
    try { tryResumePlayback(); } catch (e) {}
  }
  ['visibilitychange', 'focus'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (document.visibilityState !== 'visible') return;
      failMap = {}; bgResumeFails = 0; // v3.x：从别的应用切回浏览器时，后台停滞触发的播放失败不算连续失败，避免误报"会员/移出"；v3.26.x：补播失败封顶一并清零，回前台才真正发起续播
      setTimeout(resumeOnForeground, 200);
    });
  });
  window.addEventListener('pageshow', function () {
    failMap = {}; bgResumeFails = 0; // v3.26.x：见 visibilitychange 同款——回前台重置补播失败封顶
    setTimeout(resumeOnForeground, 200);
  });
  // 后台看门狗：hidden 下若有「想播却被暂停」的元素，周期性尝试拉起
  //（页面未被完全冻结时生效；完全冻结时定时器停摆，由回前台兜底接管）
  setInterval(function () {
    try { if (document.hidden) tryResumePlayback(); } catch (e) {}
  }, 10000);
  // v3.10.x：最近用户手势时间戳——区分「用户刚点了播放」与「自动切歌 / 断链重试 /
  // 后台补播」等非手势上下文。后者 play() 被拒是常态（浏览器对无手势播放收紧），
  // 不该弹"点击播放被浏览器拦截"吓用户（聊天中听歌自动下一首就中断弹提示的来源），
  // 静默交给补播反击 + 手势兜底；只有真·用户点击后 4s 内被拒才提示。
  let lastGestureAt = 0;
  ['pointerdown', 'touchend', 'keydown', 'mousedown'].forEach(function (ev) {
    document.addEventListener(ev, function () { lastGestureAt = Date.now(); }, { capture: true, passive: true });
  });
  function recentUserGesture() { return Date.now() - lastGestureAt < 4000; }
  // startPlayback / toggle 共用的拒绝处理：手势内提示用户，非手势静默反击
  function handlePlayReject(err) {
    playRejected = true;
    // v3.10.x：换源重试（meting 直链/内置旋律合成）窗口期的拒绝是主动 teardown 旧元素
    // 的自然结果，不是播放被拦——此时武装续播反击会用旧 URL 造出第二个播放器抢跑，
    // 与即将回来的直链播放形成双声（弱网双播放器根因之一），交给换源回调接管即可
    if (httpsRetrying || demoFallbackBusy) return;
    // v3.26.x：play() 拒绝不全是自动播放拦截——只有 NotAllowedError 才是；其余
    //（NotSupportedError 等）是资源加载失败（meting 对 VIP/失效歌返回 200 空正文，
    // <audio> 解码必然失败）。用户明明点了屏幕却看到「被浏览器拦截」纯属误导
    //（vivo Y35+Edge 实测：在线歌反复提示拦截、点屏幕也没用），按错误类型给真实原因。
    // 兼容说明：①测试 mock 的错误可能挂在 message 而非 name 上，两处都查；
    // ②历史调用点不传 err（走到这里必是 NotAllowedError 分支）→ 默认按拦截处理。
    const blocked = !err ||
      err.name === 'NotAllowedError' ||
      /NotAllowedError/i.test(String(err.message || ''));
    if (recentUserGesture()) {
      if (blocked) {
        toast('点击播放被浏览器拦截，请再点一下屏幕继续播放');
      } else {
        const cm = findTrack(currentId);
        toast(cm && cm.source === 'url' && cm.url
          ? '在线歌曲加载失败：可能为会员歌曲、链接失效，或网络无法访问音乐源；可换一首或切换网络试试'
          : '播放失败，请再点一下屏幕重试');
      }
      armAutoResume();
    } else {
      armAutoResume();        // 用户下次任意触摸即恢复（不弹提示）
      scheduleBgResume();     // 定时补播先试，多数自动切歌场景直接救回
    }
  }
  // v3.6.x：播放停滞守卫——外链被拦截/302 跳转挂起时 audio 不触发 error 也不出声
  //（图标转但永远无声，Edge 等浏览器实测）。启动 12 秒后 currentTime 仍为 0：
  // 种子歌自动切内置示例旋律，其余歌曲提示并停止；有进度/暂停/切歌/播放事件都会取消守卫。
  // play() 被自动播放策略拒绝（playRejected）不算停滞——走 armAutoResume 等用户手势，
  // 不在这里误判成「外链失败」切兜底。
  let stallTimer = null;
  let playRejected = false;
  function clearStallGuard() {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  }
  function armStallGuard(m) {
    clearStallGuard();
    if (!m || (m.source !== 'url' && !m.url)) return;
    stallTimer = setTimeout(function () {
      stallTimer = null;
      try {
        if (!audio || currentId !== m.id) return;
        if (audio.currentTime > 0) return;
        if (playRejected) return; // 等手势恢复播放，不误判外链失败
        if (audio.paused) return; // 用户主动暂停，不兜底
        // v3.6.x：关键修复——「还在加载」不算停滞。Edge 移动端加载网易云外链
        // （outer/url 302 → CDN）可能需 10~30 秒缓冲，原 12 秒定时器到点时
        // currentTime 仍为 0，会把「正在缓冲的完整歌曲」误判为失败切到内置旋律。
        // readyState>0（有元数据）/ buffered 有数据 / networkState=LOADING → 重新计时再等。
        try {
          if (audio.readyState > 0 || (audio.buffered && audio.buffered.length > 0) || audio.networkState === 2) {
            armStallGuard(m);
            return;
          }
        } catch (e) {}
        // 确认无加载活动（真挂起/被拦）：网易云歌曲先拉 https 直链重播
        if (m && m.neteaseId && !httpsRetrying) {
          if (retryWithHttpsUrl(m)) return;
        }
        const idx = seedIdxOf(m);
        if (idx >= 0 && !demoFallbackBusy) {
          demoFallbackBusy = true;
          toast('外链播放失败，已改用内置示例旋律');
          playDemoFor(m, idx);
        } else if (idx < 0) {
          offerRemoveDamagedSong(m);
        }
      } catch (e) {}
    }, 12000);
  }
  // v3.6.x：外链失败 → 用 meting API 的 https 302 重播。
  // 根因：outer/url 302 到 http CDN，HTTPS 部署（GitHub Pages）下被浏览器按混合内容
  // 拦截（所有手机外链全失败、只能播内置旋律）。Meting-API（api.injahow.cn，大陆可直连）
  // 的 ?type=url&id=xxx 会 302 到 https://m*.music.126.net 直链——audio.src 直接指向
  // meting URL 即可，浏览器自动跟随 302，全程 https 无混合内容。已实测两首种子歌
  // 完整返回（5.3MB / 9.6MB，连续多次稳定）。若 meting 不可用则回退内置旋律。
  function neteaseMetingUrl(id) {
    return 'https://api.injahow.cn/meting/?type=url&id=' + encodeURIComponent(String(id));
  }
  // v3.6.x：解析 meting URL 的 302 跳转，拿到最终 CDN 直链 URL，把 http: 修正为 https:
  // 避免混合内容拦截。
  // v3.9.x：改用 fetch（response.url 跟随重定向后的最终 URL）——iOS Safari 上
  // XHR 的 responseURL 对跨域 302 不返回最终 URL（只返回原始请求 URL），导致
  // retryWithHttpsUrl 拿不到 CDN 直链、回退到 meting URL 重试无意义。fetch 的
  // response.url 在所有现代浏览器（含 iOS Safari 15.4+）都正确返回最终 URL。
  // fetch 收到响应头即 resolve，立即 abort body 不下载音频。
  function resolveNeteaseDirectUrl(m, cb) {
    try {
      let controller;
      try { controller = new AbortController(); } catch (e) { controller = null; }
      const timer = setTimeout(() => { try { controller && controller.abort(); } catch (e) {} }, 8000);
      fetch(neteaseMetingUrl(m.neteaseId), controller ? { signal: controller.signal } : undefined)
        .then(function (r) {
          clearTimeout(timer);
          // v3.26.x：校验拿到的是「可用音频直链」——必须是 302 跳转（r.redirected）
          // 或响应本身就是音频（content-type audio/*）。meting 对 VIP/失效歌返回
          // 200 + 空正文(text/html)且无跳转（vivo Y35+Edge 实测 2623931868），
          // 旧实现把 r.url（= 原始 meting URL）当直链回投，同一个坏 URL 必然
          // 再失败一次。校验不过 → cb(null) → 走网易云官方外链兜底。
          var ct = '';
          try { ct = (r.headers && r.headers.get('content-type')) || ''; } catch (e) {}
          var ok = !!(r.redirected || /^audio\//i.test(ct));
          var finalUrl = ok ? ((r.url || '').replace(/^http:/i, 'https:')) : null;
          // 异步 abort：同步 abort 会让 body 流缓冲器抛「BodyStreamBuffer was
          // aborted」未处理 rejection（诊断面板噪音来源），让 promise 链先落地
          setTimeout(function () {
            try { controller && controller.abort(); } catch (e) {}
            try { r.body && r.body.cancel && r.body.cancel(); } catch (e) {}
            cb(finalUrl);
          }, 0);
        })
        .catch(function () { clearTimeout(timer); cb(null); });
    } catch (e) { cb(null); }
  }
  let httpsRetrying = false;
  // v3.9.x：网易云官方外链——meting API 不可达时的备用播放方案。
  // https://music.163.com/song/media/outer/url?id=xxx 302 → CDN mp3
  // <audio> 标签不走 CORS，可直接设 src 播放（fetch 因 302 无 CORS 头会失败）。
  // 注意：302 目标是 http CDN，HTTPS 页面下可能被混合内容拦截——作为 meting 不可达时的最后兜底。
  function neteaseOuterUrl(id) {
    return 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(String(id));
  }
  function retryWithHttpsUrl(m) {
    // v3.6.x：每首歌最多重试一次（_httpsRetried 内存标记）——防止 meting 直链也失败时
    // onerror/停滞守卫反复触发 → 无限拉取
    if (httpsRetrying || !m || !m.neteaseId || m._httpsRetried) return false;
    m._httpsRetried = true;
    httpsRetrying = true;
    toast('正在获取完整版直链…');
    try {
      if (audio) { audio.onerror = null; audio.onended = null; audio.onloadedmetadata = null; }
    } catch (e) {}
    teardownAudio();
    // v3.6.x：先解析 meting URL 的 302 拿最终 CDN 直链，修正 http→https，
    // 再用直链播放（而非直接用 meting URL——和 m.url 相同的重试无意义）
    // v3.9.x：meting API 不可达（直链为空）时，用网易云官方外链作为备用
    // 播放源（<audio> 不走 CORS，能请求官方外链；302 到 CDN mp3 直接播放）
    resolveNeteaseDirectUrl(m, function (directUrl) {
      // v3.10.x：换源窗口到此结束
      httpsRetrying = false;
      // v3.10.x：拉直链的空窗期（最长 8s）里可能已切歌/按暂停/来电 hold——原实现
      // 无视状态强行起播（表现为"暂停了过几秒自己又响"）。切歌仍走 demo 兜底判定
      // （playDemoFor 内有 currentId 守卫不会串音）；暂停/hold 直接清场不再出声，
      // teardown 同时清掉空窗期补播反击可能造出的野元素
      if (currentId !== m.id) { demoFallbackOrError(m); return; }
      if (!wantPlay || callHoldPending) { teardownAudio(); try { syncPlayIcons(false); } catch (e) {} return; }
      audio = createAudio();
      try { audio.referrerPolicy = 'no-referrer'; } catch (e) {}
      if (directUrl) {
        audio.src = directUrl;
      } else {
        // meting API 失败 → 尝试网易云官方外链（<audio> 直接跟随 302 播放）
        audio.src = neteaseOuterUrl(m.neteaseId);
      }
      startPlayback(m);
    });
    return true;
  }

  // v3.14.x：外链/会员歌曲播放失败 → 弹窗让用户一键把它移出音乐库。
  // 背景：会员状态检测依赖的第三方 CORS 代理（proxy.cors.sh / allorigins / corsproxy.io）
  // 已整体失效，「清理会员歌曲」批量检测删不掉会员歌。播放失败这个时刻本身就是最可信
  // 的判定——见一次弹一次「是否移除」，替代原来只弹 toast 却无处删除的困境。
  function offerRemoveDamagedSong(m) {
    if (!m) return;
    // v3.26.x：后台（document.hidden）的播放失败不弹「移出」窗、也不累计失败次数——
    // Chrome/安卓冻结后台标签页或网络停顿会中断音频流触发 onerror，把普通免费歌误判
    // 成「会员/坏链」弹窗（用户红米 K80 后台听歌被弹「会员音乐失效」）。后台失败是
    // 瞬态：保持 wantPlay 不重置，回前台由 failMap 清零 + 补播兜底自动续播；真·坏链
    // 在前台手动播放时仍照常累计（toast → 连续 2 次 → 移出窗）。
    if (document.hidden) { bgBrokeAudio = true; return; } // v3.26.x：后台冻结/断流误触发 onerror，不弹「移出」窗不计数；v3.29.x：标记后台断流，切回前台重建
    wantPlay = false; clearBgResume(); // v3.10.x：真失败＝停止意图，不再自动续播
    try { if (audio) audio.pause(); } catch (e) {}
    try { syncPlayIcons(false); } catch (e) {}
    // v3.x：修复误报——播放失败不一定就是会员/付费歌曲。首次失败只有轻提示、不弹「移出」窗，
    // 否则会把网络/链接临时失效的普通歌曲误判成会员并催删。连续失败才确认为坏链再提示移除。
    const cnt = (failMap[m.id] || 0) + 1;
    failMap[m.id] = cnt;
    if (cnt < 2) {
      try { toast('播放失败（可能为会员/失效歌曲），可以在播放列表换一首歌试试'); } catch (e) {}
      return;
    }
    if (!window.openModal) return;
    try {
      window.openModal('「' + (m.name || '这首歌') + '」播放失败', '', () => {
        library = library.filter(function (x) { return x.id !== m.id; });
        if (currentId === m.id) { teardownAudio(); currentId = null; }
        saveLibrary();
        renderPage();
        toast('已移出音乐库');
      }, { noInput: true, staticText: '连续播放失败，可能是会员/付费歌曲或链接已失效。可以在播放列表换一首歌点击播放恢复播放，或把它移出音乐库。' });
    } catch (e) {}
  }
  function demoFallbackOrError(m) {
    const idx = seedIdxOf(m);
    if (idx >= 0 && !demoFallbackBusy) {
      demoFallbackBusy = true;
      toast('外链播放失败，已改用内置示例旋律');
      playDemoFor(m, idx);
      return;
    }
    if (idx >= 0) return; // 兜底合成/播放进行中，静默等待结果
    offerRemoveDamagedSong(m);
  }
  // v3.9.x：onended 兜底——网易云 meting 外链某些流不触发 ended 事件（duration=Infinity
  // 或 chunked 流无 Content-Length），导致自动下一首/循环/随机全失效，只能手动切歌。
  // endedHandled 去重：ended 事件与 startProgress 的 checkAutoEnd 任一先到都只处理一次。
  let endedHandled = false;
  function handleEnded() {
    if (endedHandled) return;
    endedHandled = true;
    revokeObjectUrl();
    // v3.x：播放队列优先——用户排好「下一首」时直接按序切，TA 不抢播
    if (playQueue.length) { next(); return; }
    let handled = false;
    try { handled = maybeTAAutoAction(); } catch(e) {}
    if (!handled) next();
  }
  function checkAutoEnd() {
    if (!audio || endedHandled || audio.paused) return;
    if (audio.ended) { handleEnded(); return; }
    const d = audio.duration;
    if (!d || !isFinite(d)) {
      // 流式音频（duration=Infinity）：用 buffered 末尾兜底
      try {
        if (audio.buffered && audio.buffered.length > 0) {
          const end = audio.buffered.end(audio.buffered.length - 1);
          if (end > 1 && audio.currentTime >= end - 0.3) handleEnded();
        }
      } catch (e) {}
      return;
    }
    if (audio.currentTime > 0 && audio.currentTime >= d - 0.15) handleEnded();
  }
  // v3.9.x：MediaSession——通知栏/锁屏媒体控制条。播放时覆盖 bg-keep 的"后台保活"条，
  // 让用户在通知栏直接切歌/暂停；停止后 dispatch music-media-release 让 bg-keep 恢复
  function updateMediaSession(playing) {
    try {
      if (!('mediaSession' in navigator) || !navigator.mediaSession) return;
      const m = findTrack(currentId);
      if (!m) return;
      if (window.MediaMetadata) {
        const artwork = m.cover ? [{ src: m.cover, sizes: '512x512', type: 'image/jpeg' }] : [];
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: m.name || '未知歌曲',
          artist: m.artist || '未知歌手',
          album: 'Mochi 音乐',
          artwork: artwork
        });
      }
      try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (e) {}
      try {
        navigator.mediaSession.setActionHandler('play', function () { try { toggle(); } catch (e) {} });
        navigator.mediaSession.setActionHandler('pause', function () { try { toggle(); } catch (e) {} });
        navigator.mediaSession.setActionHandler('nexttrack', function () { try { next(); } catch (e) {} });
        navigator.mediaSession.setActionHandler('previoustrack', function () { try { prev(); } catch (e) {} });
      } catch (e) {}
      try { window.__musicPlaying = playing; } catch (e) {}
    } catch (e) {}
  }
  function setupHandlers(m) {
    audio.onended = function () { handleEnded(); };
    audio.onerror = function () {
      // v3.29.x：后台冻结/断流触发的 onerror 标记——切回前台由 visibilitychange 重建播放，
      // 避免用坏掉的旧元素 play() 失败被误判成"会员/付费歌曲"弹窗
      if (document.hidden) bgBrokeAudio = true;
      // v3.5.112：网易云外链播放失败 → 若为内置种子歌曲，自动回退本地合成旋律；
      // 本地旋律也失败时不再递归（demoFallbackBusy 置位）
      // v3.6.x：onerror 可能被触发多次（不同错误码）——先尝试 https 直链重播，
      // 已重试/重试失败才走内置旋律兜底；兜底进行中后续 error 静默
      if (m && m.neteaseId && !httpsRetrying) {
        if (retryWithHttpsUrl(m)) return;
      }
      if (httpsRetrying) return; // 正在拉直链，等结果
      demoFallbackOrError(m);
    };
    audio.onloadedmetadata = function () {
      const dur = audio.duration || 0;
      const el = document.getElementById('sm-pb-dur');
      if (el) el.textContent = fmtDur(dur);
      if (m && dur) { m.duration = dur; saveLibrary(); updateDurUI(m.id, dur); }
      // v3.6.x：play() 曾被拒绝（自动播放策略/音频未就绪）→ 元数据就绪后补播一次，
      // 同样走 muted 静音解锁（直接 play 非手势仍会被拒）
      if (playRejected && currentId === m.id) {
        playRejected = false;
        try { audio.muted = true; } catch (e) {}
        const p2 = audio.play();
        if (p2 && p2.then) {
          p2.then(() => { if (audio) audio.muted = false; }).catch(() => {
            playRejected = true;
            try { syncPlayIcons(false); } catch (e) {}
            armAutoResume();
          });
        } else { armAutoResume(); }
      }
    };
    audio.onplay = function () { playRejected = false; bgResumeFails = 0; clearStallGuard(); disarmAutoResume(); clearBgResume(); bgBrokeAudio = false; wantPlay = true; syncPlayIcons(true); if (m) failMap[m.id] = 0; try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; } catch (e) {} try { window.__musicPlaying = true; } catch (e) {} // v3.28.x：每次真正出声都重新绑定歌曲媒体条——后台短暂打断被 bg-keep 接管媒体会话（元数据换成「Mochi 后台保活」）后，恢复播放时若不重设歌曲元数据，通知栏媒体条会停在保活条或直接消失
      try { updateMediaSession(true); } catch (e) {} };
    audio.onpause = function () { syncPlayIcons(false); try { if (navigator.mediaSession) navigator.mediaSession.playbackState = (wantPlay && !callHoldPending) ? 'playing' : 'paused'; } catch (e) {} try { window.__musicPlaying = false; } catch (e) {} // v3.28.x：外部打断（还想播）保持 playbackState='playing'，避免 Chrome 把页面当闲置标签冻结、通知栏媒体条消失；仅用户主动暂停才标 'paused'。v3.10.x：非用户暂停（后台省电/音频焦点抢占/系统打断）→ 定时补播反击
      // v3.27.x：TA 暂停再播放互动进行中不补播（TA 稍后会自己点播放恢复）
      if (wantPlay && !callHoldPending && !taPauseActive) scheduleBgResume(); };
  }
  function playTrack(id, fromWidget) {
    const m = findTrack(id);
    if (!m) return;
    markFloatSource(fromWidget);
    // v3.27.x：用户切歌取消 TA 暂停互动（未触发的计划 / 进行中的恢复一并作废）
    cancelTaPause();
    // v3.6.x：重置 https 重试标记——_httpsRetried 在 retryWithHttpsUrl 里设 true 后
    // 永不重置，导致后续每次播放都先尝试失败的原始 URL 被混合内容拦截，
    // catch 不区分错误类型当"自动播放拦截"处理 → toast"被浏览器拦截"。
    // 每次新播放重置，允许重新尝试 meting URL
    if (m) m._httpsRetried = false;
    currentId = id;
    // v3.9.x：播放时顺带补封面（列表/小组件缺封面的网易云歌曲）
    // v3.26.x #215：已有代理封面的顺路迁移成网易 CDN 直链
    if (m && m.cover) { if (COVER_PROXY_RE.test(m.cover)) enqueueCovMig(m); }
    else ensureSongCover(m);
    teardownAudio();
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    // v3.22.x：切歌瞬间立即同步所有音乐 UI（聊天悬浮小框 / 音乐页底部播放条 / 桌面
    // 音乐小组件）。此前悬浮小框/小组件只在音频真正 onplay(或本地歌异步加载完成后)
    // 才刷新——从通知栏/后台切歌、或播放本地歌时，UI 会停留在旧歌直到出声。
    // 这里提前刷新歌曲名/封面/小组件，与后续 startPlayback 内的刷新互相幂等；此时
    // audio 已 teardown 置空，syncPlayIcons 显示暂停态，待起播再由 onplay 纠正。
    updatePlayerBar();
    if (m.source === 'local' || (!m.url && m.source !== 'url')) {
      // 本地文件：从 IndexedDB 读取 Blob（新版）或 dataURL 字符串（旧版数据）
      const key = MUSIC_PREFIX + ':music-file:' + m.id;
      const loadLocal = (v) => {
        // v3.5.129：守卫——异步加载期间用户已切到别的歌（currentId 变了）→ 丢弃本次结果，
        // 否则旧歌的 audio 会继续创建播放，出现两首歌同时响
        if (currentId !== m.id) return;
        if (plausibleLocalValue(v)) {
          // v3.6.x：统一转 Blob + 对象 URL 播放（兼容旧 dataURL 字符串 / 新 Blob 存储）
          playLocal(m, v);
          return;
        }
        // v3.30.x：值存在但形状非法（'{}'、'[object Blob]'、超短字符串等历史脏值）→
        // 清掉脏存储，避免每次刷新反复读到同一脏值、被迫删歌重加；null/undefined 仅表示
        // 数据缺失（可能 IDB 挂起超时），保留存储不动，避免把好文件也误删
        if (v !== undefined && v !== null && v !== '') purgeLocalFile(m);
        const idx = seedIdxOf(m);
        if (idx >= 0) {
          playDemoFor(m, idx);
          return;
        }
        toast('音乐文件加载失败，可能已被清理'); wantPlay = false; clearBgResume(); currentId = null; updatePlayerBar(); renderLibrary();
      };
      // v3.29.x：优先同步查内存缓存/localStorage——idbGet 异步丢用户手势上下文，play()
      // 被 NotAllowedError 拒后 muted 解锁失败→armAutoResume retry 用 m.url='' 必失败，
      // 本地歌播不出→所有 TA 互动（邀请/切歌/预订/暂停/继续）全失效。同步读到则
      // loadLocal 在手势内执行 play() 成功，TA 互动正常触发。
      {
        const cached = localBlobCache[m.id];
        if (cached) { loadLocal(cached); return; }
        const lsSync = store.get('music-file:' + m.id);
        // v3.30.x：LS 里的本地歌值可能是历史脏值（'{}'）→ 若不可信就清掉 LS 副本并继续
        // 落下面 idbGet 读权威 IDB——脏值只污染过 LS 时，IDB 里往往还是好 Blob，直接能播，
        // 刷新后无需删歌重加
        if (lsSync && !plausibleLocalValue(lsSync)) {
          try { localStorage.removeItem(MUSIC_PREFIX + ':music-file:' + m.id); } catch (e) {}
          try { localStorage.removeItem('xy-home-v2:music-file:' + m.id); } catch (e) {}
        }
        if (plausibleLocalValue(lsSync)) { localBlobCache[m.id] = lsSync; loadLocal(lsSync); return; }
      }
      if (window.idbGet) {
        window.idbGet(key).then(v => {
          if (currentId !== m.id) return; // 已切歌
          if (v === undefined || v === null) {
            const lsV = store.get('music-file:' + m.id);
            if (lsV) { loadLocal(lsV); return; }
            // v3.6.x：旧数据前缀兼容——联系人数据隔离改造前，本地歌存在
            // 「xy-home-v2:music-file:<id>」（旧 uid 前缀，无 :default）；新代码
            // 用 activePrefix 读不到 → 回退旧前缀，旧上传的本地歌仍能播
            const legacyKey = 'xy-home-v2:music-file:' + m.id;
            const legacyFallback = (v2) => {
              if (currentId !== m.id) return;
              if (v2 !== undefined && v2 !== null && v2 !== '') loadLocal(v2);
              else failLocal();
            };
            const failLocal = () => { toast('音乐文件加载失败，可能已被清理'); wantPlay = false; clearBgResume(); currentId = null; updatePlayerBar(); renderLibrary(); };
            const oldLs = localStorage.getItem(legacyKey);
            if (oldLs) { legacyFallback(oldLs); return; }
            if (MUSIC_PREFIX !== 'xy-home-v2') {
              window.idbGet(legacyKey).then(legacyFallback).catch(() => legacyFallback(null));
              return;
            }
            // v3.5.123：刚上传（idbSet 异步未完成）就点播放的竞态——延迟重试一次
            setTimeout(() => {
              if (currentId !== m.id) return; // 已切歌
              window.idbGet(key).then(v2 => {
                if (currentId !== m.id) return; // 已切歌
                if (v2 !== undefined && v2 !== null) loadLocal(v2);
                else failLocal();
              });
            }, 600);
          } else { localBlobCache[m.id] = v; loadLocal(v); }
        });
      } else {
        loadLocal(store.get('music-file:' + m.id));
      }
      return;
    }
    audio = createAudio();;
    // v3.26.x：url 脏值守卫（如 '{}'/空串）——直接赋值会在控制台刷「资源加载失败」
    // 且永远播不出声。此类曲目判为坏链走 offerRemoveDamagedSong（连续失败后弹「移出音乐库」），
    // 不再把脏地址喂给 <audio>。blob:/data:（本地歌换源）与 http(s) 均放行。
    if (!validAudioSrc(m.url)) {
      offerRemoveDamagedSong(m);
      return;
    }
    // v3.5.118：网易云外链防盗链（带 Referer 时返回 403 无法播放）——
    // 设置 referrerPolicy=no-referrer 让请求不带 Referer，原曲可直接播放
    try { audio.referrerPolicy = 'no-referrer'; } catch (e) {}
    audio.src = m.url;
    startPlayback(m);
  }
  function startProgress() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      if (!audio) return;
      checkAutoEnd();
      if (!audio.duration) return;
      if (audio.currentTime > 0) clearStallGuard();
      const cur = document.getElementById('sm-pb-cur');
      if (cur) cur.textContent = fmtDur(audio.currentTime);
      const fill = document.getElementById('sm-f-fill');
      if (fill) fill.style.width = Math.min(100, audio.currentTime / audio.duration * 100) + '%';
      const fCur = document.getElementById('sm-f-cur');
      if (fCur) fCur.textContent = fmtDur(audio.currentTime);
      const fDur = document.getElementById('sm-f-dur');
      if (fDur) fDur.textContent = fmtDur(audio.duration);
    }, 500);
  }
  function toggle(fromWidget) {
    markFloatSource(fromWidget);
    if (!audio || !currentId) {
      const songs = library.filter(m => !m.playlistId || m.playlistId === 'default');
      if (songs.length) { playTrack(songs[0].id, fromWidget); return; }
      toast('音乐库还没有歌曲');
      return;
    }
    if (audio.paused) {
      // v3.27.x：用户手动点播放——TA 的暂停互动作废（避免 TA 恢复计划重复播放/重复字卡）
      cancelTaPause();
      // v3.6.x：按钮点击本身是用户手势，正常可播；个别浏览器仍拒 → muted 静音解锁
      const p = audio.play();
      if (p && p.catch) p.catch((err) => {
        if (!audio) return; // v3.28.x：判空防 null.play()（回调异步，audio 可能已被 teardown）
        // v3.27.x：非 NotAllowedError 的 reject 是源失效/跨域加载失败（非自动播放策略），
        // 走外链失败兜底而非弹"被浏览器拦截"误导用户。toggle 是暂停后再播，源已加载过，
        // 真自动播放拦截走 muted 解锁；源失效（后台断流等）走拉直链/兜底重建。
        if (err && err.name !== 'NotAllowedError') {
          // v3.26.x：换源窗口期的拒绝是 teardown 自然结果，静默等换源回调（同 startPlayback 守卫）
          if (httpsRetrying || demoFallbackBusy) return;
          const tm = currentId ? findTrack(currentId) : null;
          if (tm && tm.neteaseId && !tm._httpsRetried) {
            if (retryWithHttpsUrl(tm)) return;
          }
          if (tm) { demoFallbackOrError(tm); return; }
        }
        playRejected = true;
        try { audio.muted = true; } catch (e) {}
        const p2 = audio.play();
        if (p2 && p2.then) {
          p2.then(() => { if (audio) audio.muted = false; playRejected = false; try { syncPlayIcons(true); } catch (e) {} })
            .catch(() => {
              try { syncPlayIcons(false); } catch (e) {}
              toast('点击播放被浏览器拦截，请再点一下屏幕继续播放');
              armAutoResume();
            });
        } else { armAutoResume(); }
      });
    }
    else { wantPlay = false; clearBgResume(); cancelTaPause(); audio.pause(); } // v3.10.x：用户主动暂停＝清除意图，后台补播不得打扰；v3.27.x：TA 暂停互动一并作废
  }
  // v3.5.129：来电联动——暂停音乐 + 隐藏悬浮小框（否则铃声和音乐同时响、
  // 悬浮小框 z-index 9999 会盖在通话面板上遮挡接听按钮）；通话结束恢复
  // v3.x：修复"邀请听歌后来电，通话结束悬浮窗/播放不恢复"——
  //   1) hold 时若有 currentId 但 audio 未创建（本地文件异步加载中），标记 callHoldPending，
  //      startPlayback 检查该标志 → 不播放，避免通话期间音频加载完自动响起；
  //   2) release 时用 updatePlayerBar()（内含 renderFloat）恢复悬浮窗，按当前
  //      currentId/audio/floatEn 状态决定显示，不再依赖 dataset.callHold 字符串
  //      （hold 期间若 audio 被 teardown 会导致字符串状态错乱）；
  //   3) callHoldPending 场景下 release 也尝试恢复播放。
  let callHoldPlaying = false;
  let callHoldFloatShown = false;
  let callHoldPending = false;
  window.musicHoldForCall = function (hold) {
    try {
      const el = document.getElementById('sm-float');
      if (hold) {
        callHoldPlaying = !!(audio && !audio.paused);
        callHoldFloatShown = !!(el && !el.hidden);
        // 有当前曲目但 audio 还没创建（本地文件异步从 IDB 读取中）→ 标记，
        // startPlayback 时检查并跳过播放，避免通话期间音频加载完自动响起
        callHoldPending = !audio && !!currentId;
        // v3.27.x：来电打断 TA 暂停互动（通话中不恢复播放）
        cancelTaPause();
        if (audio && !audio.paused) { wantPlay = false; clearBgResume(); audio.pause(); } // v3.10.x：来电 hold＝清除意图，通话期间不自动续播
        if (el) el.hidden = true;
      } else {
        // 恢复播放：hold 前在播，或 hold 期间异步加载被挂起 → 尝试恢复
        if (audio && currentId && (callHoldPlaying || callHoldPending)) {
          const p = audio.play();
          if (p && p.catch) p.catch(() => {
            // v3.6.x：通话结束恢复也是非手势播放，被拒时 muted 静音解锁
            playRejected = true;
            if (!audio) return; // v3.28.x：判空防 null.play()（回调异步期间可能已 teardown）
            try { audio.muted = true; } catch (e) {}
            const p2 = audio.play();
            if (p2 && p2.then) {
              p2.then(() => { if (audio) audio.muted = false; playRejected = false; try { syncPlayIcons(true); } catch (e) {} })
                .catch(() => { try { if (audio) audio.muted = false; } catch (e) {} try { syncPlayIcons(false); } catch (e) {} armAutoResume(); try { toast('点一下屏幕即可恢复音乐播放'); } catch (e) {} });
            } else { armAutoResume(); }
          });
        }
        callHoldPlaying = false;
        callHoldPending = false;
        // 恢复悬浮窗 + 播放栏：hold 前显示过，或当前有曲目在播 → 按当前状态重新渲染
        if (callHoldFloatShown || (audio && currentId)) {
          updatePlayerBar();
        }
        callHoldFloatShown = false;
      }
    } catch (e) {}
  };
  function playableList() {
    // 当前歌曲所在歌单优先，否则默认列表
    const m = findTrack(currentId);
    const pid = m ? m.playlistId : 'default';
    let list = library.filter(x => x.playlistId === pid);
    if (!list.length) list = library.slice();
    // v3.22.x：按用户在播放列表面板里长按拖动保存的播放顺序重排（顺序播放/自动切歌遵循）
    const order = loadPlayOrder(pid);
    if (order && order.length) {
      const byId = {};
      list.forEach(x => { byId[x.id] = x; });
      const seen = {};
      const sorted = [];
      order.forEach(id => { if (byId[id] && !seen[id]) { sorted.push(byId[id]); seen[id] = true; } });
      list.forEach(x => { if (!seen[x.id]) sorted.push(x); });
      list = sorted;
    }
    return list;
  }
  // ================= 播放顺序（自定义顺序播放） =================
  // 播放列表面板「当前播放列表」长按拖动后保存每歌单的播放顺序，键 music-playorder
  function loadPlayOrder(pid) {
    try { const o = JSON.parse(store.get('music-playorder') || '{}'); return (o && Array.isArray(o[pid])) ? o[pid] : null; } catch (e) { return null; }
  }
  function sessionPlayListId() {
    const m = findTrack(currentId);
    return (m && (m.playlistId || 'default')) || 'default';
  }
  function naturalPlayOrder() {
    const pid = sessionPlayListId();
    let list = library.filter(x => x.playlistId === pid);
    if (!list.length) list = library.slice();
    return list.map(x => x.id);
  }
  // 面板里的可见行只包含「未排队的」当前列表；把拖完的可见顺序按排队位合并回完整歌单顺序再保存
  function setPlayOrderView(newView) {
    const pid = sessionPlayListId();
    const queued = {};
    playQueue.forEach(id => { queued[id] = true; });
    let full = loadPlayOrder(pid) || naturalPlayOrder();
    const newFull = [];
    let vi = 0;
    for (let o = 0; o < full.length; o++) {
      const id = full[o];
      if (queued[id]) newFull.push(id);
      else { if (vi < newView.length) newFull.push(newView[vi]); vi++; }
    }
    for (; vi < newView.length; vi++) newFull.push(newView[vi]);
    try {
      const o = JSON.parse(store.get('music-playorder') || '{}');
      o[pid] = newFull;
      store.set('music-playorder', JSON.stringify(o));
    } catch (e) {}
  }
  // ================= 播放队列（下一首播放） =================
  function addToQueue(id) {
    const m = findTrack(id);
    if (!m) return;
    if (playQueue.indexOf(id) >= 0) { toast('这首歌已在播放队列'); return; }
    if (currentId === id) { toast('这就是正在播放的歌'); return; }
    playQueue.push(id);
    renderQueueBadge();
  }
  // v3.x：队列数量黑色小圆点角标已按用户要求移除，保留调用点以兼容后续扩展
  function renderQueueBadge() {}
  // ================= 播放列表面板：长按拖动排序 + 自动定位当前歌 =================
  const qd = { active: null, timer: null, dragging: false, section: null, sx: 0, sy: 0, notMoved: false, bound: false, suppressClick: false };
  function qdBindGlobals() {
    if (qd.bound) return; qd.bound = true;
    document.addEventListener('touchmove', qdOnMove, { passive: false });
    document.addEventListener('mousemove', qdOnMove);
    document.addEventListener('touchend', qdOnEnd);
    document.addEventListener('touchcancel', qdOnEnd);
    document.addEventListener('mouseup', qdOnEnd);
  }
  function qdPoint(e) { return (e.touches && e.touches[0]) || e; }
  function qdOnMove(e) {
    if (!qd.dragging) {
      if (qd.notMoved && qd.active) {
        const p = qdPoint(e);
        if (Math.abs(p.clientX - qd.sx) > 10 || Math.abs(p.clientY - qd.sy) > 10) {
          qd.notMoved = false;
          if (qd.timer) { clearTimeout(qd.timer); qd.timer = null; }
        }
      }
      return;
    }
    e.preventDefault();
    const sec = qd.section;
    if (!sec || !qd.active) return;
    const p = qdPoint(e);
    const rows = sec.querySelectorAll('.sm-song[data-qid]');
    for (const r of rows) {
      if (r === qd.active) continue;
      const b = r.getBoundingClientRect();
      if (p.clientY >= b.top && p.clientY <= b.bottom) { qdSwap(qd.active, r); break; }
    }
  }
  function qdSwap(a, b) {
    const pa = a.parentNode;
    if (!pa) return;
    const children = Array.from(pa.children);
    const ai = children.indexOf(a), bi = children.indexOf(b);
    if (ai < 0 || bi < 0) return;
    if (ai < bi) pa.insertBefore(b, a); else pa.insertBefore(a, b);
  }
  function qdOnEnd() {
    if (qd.timer) { clearTimeout(qd.timer); qd.timer = null; }
    if (qd.dragging && qd.active) {
      qd.active.classList.remove('dragging');
      try { document.removeAttribute('aria-grabbed'); } catch (e) {}
      const sec = qd.section;
      if (sec) {
        const view = Array.from(sec.querySelectorAll('.sm-song[data-qid]')).map(r => r.dataset.qid);
        setPlayOrderView(view);
      }
      qd.suppressClick = true;
    }
    qd.dragging = false; qd.active = null; qd.notMoved = false;
    document.body.style.userSelect = '';
  }
  function qdStart(e, row) {
    if (e.target.closest('[data-qrm]')) return;
    const p = qdPoint(e);
    qd.sx = p.clientX; qd.sy = p.clientY; qd.notMoved = true;
    qd.active = row;
    if (qd.timer) clearTimeout(qd.timer);
    qd.timer = setTimeout(function () {
      qd.dragging = true;
      try { document.setAttribute('aria-grabbed', 'true'); } catch (err) {}
      row.classList.add('dragging');
      document.body.style.userSelect = 'none';
    }, 320);
  }
  function setupQueueDrag() {
    const sec = document.getElementById('td-qlist');
    if (!sec) return;
    qd.suppressClick = false;
    qd.section = sec;
    sec.querySelectorAll('.sm-song[data-qid]').forEach(function (row) {
      row.classList.add('draggable');
      row.addEventListener('touchstart', function (e) { qdStart(e, row); }, { passive: true });
      row.addEventListener('mousedown', function (e) { qdStart(e, row); });
    });
  }
  function scrollToCurrentSong() {
    const tcb = document.getElementById('tc-body');
    if (!tcb) return;
    const act = tcb.querySelector('.sm-song.active');
    if (!act) return;
    const tr = tcb.getBoundingClientRect(), ar = act.getBoundingClientRect();
    const top = (ar.top - tr.top) - tcb.clientHeight / 2 + ar.height / 2;
    tcb.scrollTop = Math.max(0, Math.min(top, tcb.scrollHeight - tcb.clientHeight));
  }
  function openQueuePanel() {
    if (!window.openTCPanel) return;
    const rowFor = (m, extra, withRm) => '<div class="sm-song' + (extra || '') + '" data-qid="' + m.id + '">' + songIcoHtml(m) +
      '<div class="sm-song-info"><div class="sm-song-name">' + esc(m.name || '未知歌曲') + '</div>' +
      '<div class="sm-song-sub">' + esc(m.artist || '未知歌手') + '</div></div>' +
      (withRm ? '<button class="sm-song-more" data-qrm="' + m.id + '" title="移出队列"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg></button>' : '') + '</div>';
    let html = '';
    // 一、待播队列（歌曲上点「⋯ → 下一首播放」加入，依次优先播放）
    html += '<div class="sm-req-hint" style="padding:2px 0;font-weight:700">待播队列</div>';
    if (playQueue.length) {
      html += playQueue.map(id => { const m = findTrack(id); return m ? rowFor(m, '', true) : ''; }).join('');
    } else {
      html += '<div class="sm-req-hint" style="padding:4px 0 2px">还没有排队的歌——在歌曲上点「⋯」选「下一首播放」即可加入</div>';
    }
    // 二、当前播放列表（正在听的歌单，正在播放的歌高亮）
    const queuedId = {};
    playQueue.forEach(id => { queuedId[id] = true; });
    let list = playableList();
    if (playQueue.length) list = list.filter(m => !queuedId[m.id]);
    html += '<div class="sm-req-hint" style="padding:10px 0 2px;font-weight:700;display:flex;align-items:center;gap:4px">当前播放列表<span class="sm-q-drag-hint"></span></div>';
    if (!list.length && !currentId) {
      html += '<div class="sm-req-hint" style="padding:4px 0 2px">音乐库暂无歌曲</div>';
    } else if (!list.length) {
      html += '<div class="sm-req-hint" style="padding:4px 0 2px">当前正在播放《' + esc(findTrack(currentId) ? findTrack(currentId).name : '') + '》，其余歌曲正在其他歌单</div>';
    } else {
      html += '<div id="td-qlist">' + list.map(m => rowFor(m, m.id === currentId ? ' active' : '', false)).join('') + '</div>';
    }
    window.openTCPanel('音乐播放列表', html +
      '<div class="mail-actions">' +
      (playQueue.length ? '<button class="cc-tool" id="sm-q-clear">清空队列</button>' : '') +
      '<button class="cc-tool" id="sm-q-close">关闭</button></div>');
    qdBindGlobals();
    setupQueueDrag();
    scrollToCurrentSong();
    document.getElementById('sm-q-close').addEventListener('click', function () { document.getElementById('tc-mask').hidden = true; });
    const clr = document.getElementById('sm-q-clear');
    if (clr) clr.addEventListener('click', function () { playQueue = []; renderQueueBadge(); toast('已清空播放队列'); openQueuePanel(); });
    // 点待播队列整行＝立刻播放并从队列移除；点 × 仅移除；点当前播放列表任一行＝直接切到这首歌
    document.querySelectorAll('#tc-body .sm-song[data-qid]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (qd.suppressClick) { qd.suppressClick = false; return; }
        if (e.target.closest('[data-qrm]')) return;
        const id = row.dataset.qid;
        playQueue = playQueue.filter(function (x) { return x !== id; });
        renderQueueBadge();
        document.getElementById('tc-mask').hidden = true;
        playTrack(id);
      });
    });
    document.querySelectorAll('#tc-body [data-qrm]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        playQueue = playQueue.filter(function (x) { return x !== btn.dataset.qrm; });
        renderQueueBadge();
        openQueuePanel();
      });
    });
  }
  function next(fromWidget) {
    markFloatSource(fromWidget);
    // v3.x：播放队列优先——用户点「下一首播放」加入的歌先播，逐首弹出直至清空，
    // 才回到按播放模式切歌。队列里的歌被删则跳过继续取下一首。
    while (playQueue.length) {
      const qid = playQueue.shift();
      if (findTrack(qid)) { playTrack(qid); return; }
    }
    renderQueueBadge();
    const list = playableList();
    if (!list.length) return;
    let idx = list.findIndex(x => x.id === currentId);
    let nid;
    if (mode === 'single') nid = currentId;
    else if (mode === 'shuffle') nid = list[Math.floor(Math.random() * list.length)].id;
    else {
      idx = idx < 0 ? -1 : idx;
      nid = list[(idx + 1) % list.length].id;
    }
    playTrack(nid, fromWidget);
  }
  function prev(fromWidget) {
    markFloatSource(fromWidget);
    const list = playableList();
    if (!list.length) return;
    const idx = list.findIndex(x => x.id === currentId);
    // v3.6.x：当前歌不在可播列表（idx=-1）时取最后一首，而不是 (idx-1+len)%len=len-2 的倒数第二首
    if (idx < 0) { playTrack(list[list.length - 1].id, fromWidget); return; }
    playTrack(list[(idx - 1 + list.length) % list.length].id, fromWidget);
  }
  function cycleMode() {
    const order = ['list', 'shuffle', 'single'];
    mode = order[(order.indexOf(mode) + 1) % order.length];
    const label = { list: '顺序播放', shuffle: '随机播放', single: '单曲循环' }[mode];
    toast(label);
    updateModeIcon();
    saveSettings();
  }
  function updateModeIcon() {
    const paths = {
      list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
      shuffle: '<path d="M2 11a5 5 0 0 1 5-5h13"/><path d="m16 3 4 3-4 3"/><path d="M22 13a5 5 0 0 1-5 5H4"/><path d="m8 21-4-3 4-3"/>',
      single: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M9.5 8.5h5"/>'
    };
    document.querySelectorAll('#sm-mode-ico, #sm-f-mode-ico, #mw-mode-ico').forEach(el => { el.innerHTML = paths[mode] || paths.list; });
  }
  function syncPlayIcons(playing) {
    const playPath = playing
      ? '<path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z"/>'
      : '<path d="M8 5.5v13l11-6.5z"/>';
    ['sm-play-ico', 'sm-f-play-ico', 'sm-f-mini-play-ico'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = playPath;
    });
    // 桌面小部件
    const wi = document.getElementById('mw-play-ico');
    if (wi) wi.innerHTML = playing
      ? '<path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z"/>'
      : '<path d="M8 5.5v13l11-6.5z"/>';
    const bars = document.getElementById('mw-bars');
    if (bars) bars.classList.toggle('playing', playing);
  }
  function updatePlayerBar() {
    const bar = document.getElementById('sm-player-bar');
    const m = findTrack(currentId);
    if (!bar) return;
    bar.hidden = !m;
    if (!m) return;
    document.getElementById('sm-pb-name').textContent = m.name || '未知歌曲';
    document.getElementById('sm-pb-artist').textContent = m.artist || '';
    document.getElementById('sm-pb-dur').textContent = fmtDur(m.duration);
    document.getElementById('sm-pb-cur').textContent = '00:00';
    syncPlayIcons(audio && !audio.paused);
    updateModeIcon();
    renderQueueBadge();
    // 桌面小部件同步
    const wSong = document.getElementById('mw-song');
    const wArtist = document.getElementById('mw-artist');
    if (wSong) wSong.textContent = m.name || '未知歌曲';
    if (wArtist) wArtist.textContent = m.artist || '';
    setWidgetCover(m);
    renderFloat();
  }

  // ================= 桌面小部件封面（网易云专辑图） =================
  function setWidgetCover(m) {
    const cover = document.getElementById('mw-cover');
    if (!cover) return;
    // 决定显示哪张封面：模式为 playlist 时优先显示当前歌曲所在歌单的封面，无则回退歌曲封面
    let coverUrl = '';
    if (m) {
      if (settings.widgetCoverMode === 'playlist') {
        const pl = playlists.find(p => p.id === m.playlistId);
        if (pl && pl.cover) coverUrl = pl.cover;
        else if (m.cover) coverUrl = m.cover;
      } else if (m.cover) {
        coverUrl = m.cover;
      }
    }
    if (coverUrl) {
      cover.style.backgroundImage = 'url("' + coverUrl + '")';
      cover.style.backgroundSize = 'cover';
      cover.style.backgroundPosition = 'center';
      cover.classList.add('has-cover');
    } else {
      cover.style.backgroundImage = '';
      cover.style.backgroundSize = '';
      cover.style.backgroundPosition = '';
      cover.classList.remove('has-cover');
    }
    // 没有歌曲封面时异步拉取（仅网易云链接歌曲，meting type=song；拉到后局部刷新，
    // 正在播放的歌曲由 ensureSongCover 内部再触发 setWidgetCover 更新小组件）
    if (m && m.neteaseId && !m.cover) ensureSongCover(m);
    // v3.26.x #215：正在播放的歌封面还是代理 URL 的，顺路迁移成直链
    else if (m && m.cover && COVER_PROXY_RE.test(m.cover)) enqueueCovMig(m);
  }

  // ================= 悬浮小框 =================
  function isFloatOn() { return settings.floatEn && !floatClosed && currentId && audio; }
  // 播放入口标记：桌面小组件本身就是播放控制器，凡由小组件触发的播放/暂停/切歌，
  // 一律抑制悬浮小框自动唤出（无论当前小框是否可见），避免「在桌面第二页小组件上点
  // 播放，还叠加弹出一个小浮窗」的重复控制；来自其他任何入口（音乐页/底部播放条/
  // 队列/列表/小框本身）→ 清除抑制，恢复正常显隐
  function markFloatSource(fromWidget) {
    floatHideByWidget = !!fromWidget;
  }
  // 悬浮小框 收起/展开：在新版多行小框 与 最初版最小单行小框 之间切换
  function applyFloatMin() {
    const el = document.getElementById('sm-float');
    if (el) el.classList.toggle('min', floatMin);
  }
  function toggleFloatMin() {
    floatMin = !floatMin;
    applyFloatMin();
    syncPlayIcons(audio && !audio.paused);
  }
  function renderFloat() {
    const el = document.getElementById('sm-float');
    if (!el) return;
    const m = findTrack(currentId);
    el.hidden = !(settings.floatEn && !floatClosed && currentId && audio && m) || floatHideByWidget;
    applyFloatMin();
    if (!m) return;
    document.getElementById('sm-f-name').textContent = m.name || '未知歌曲';
    const miniName = document.getElementById('sm-f-mini-name');
    if (miniName) miniName.textContent = m.name || '未知歌曲';
    const fArtist = document.getElementById('sm-f-artist');
    if (fArtist) fArtist.textContent = m.artist || '';
    const fDur = document.getElementById('sm-f-dur');
    if (fDur) fDur.textContent = fmtDur(m.duration || (audio && audio.duration) || 0);
    const fCur = document.getElementById('sm-f-cur');
    if (fCur) fCur.textContent = '00:00';
    syncPlayIcons(audio && !audio.paused);
    syncHeartIcons();
  }
  // v3.7.x：聊天设置「音乐悬浮小窗」开关钩子——读写同一 floatEn 状态（music-global，
  // 每桌面独立）。chat-settings.js 加载早于本文件，运行时调用；与音乐页 #music-float-en、
  // 音乐设置 #sm-set-float 完全同源（复用 saveSettings/syncFloatToggle/renderFloat 流程）。
  window.musicFloatGet = function () { return !!settings.floatEn; };
  window.musicFloatSet = function (en) {
    settings.floatEn = !!en;
    floatClosed = false;
    floatHideByWidget = false; // 用户显式操作悬浮小窗开关 → 清除小组件抑制
    saveSettings();
    syncFloatToggle();
    renderFloat();
  };
  // ================= 收藏（我的收藏：桌面部件/悬浮小框/音乐页列表 共用） =================
  function favIds() {
    try { return JSON.parse(store.get('music-favs') || '[]'); } catch (e) { return []; }
  }
  function saveFavIds(list) { store.set('music-favs', JSON.stringify(list)); }
  function isFav(id) { return favIds().indexOf(id) >= 0; }
  function toggleFav(id) {
    const list = favIds();
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.unshift(id);
    saveFavIds(list);
    syncHeartIcons();
    renderFavList();
    return i < 0;
  }
  // 同步所有爱心（桌面部件 / 悬浮小框 / 音乐页底部播放栏）
  function syncHeartIcons() {
    const m = findTrack(currentId);
    const liked = m ? isFav(m.id) : false;
    const hb = document.getElementById('mw-heart');
    if (hb) hb.classList.toggle('liked', liked);
    const fh = document.getElementById('sm-f-heart');
    if (fh) fh.classList.toggle('liked', liked);
    const pb = document.getElementById('sm-pb-heart');
    if (pb) pb.classList.toggle('liked', liked);
  }
  // 我的收藏列表
  function renderFavList() {
    const el = document.getElementById('music-fav-list');
    if (!el) return;
    const ids = favIds();
    const songs = ids.map(id => findTrack(id)).filter(Boolean);
    el.innerHTML = songs.length
      ? songs.map(m => {
          const active = m.id === currentId;
          return '<div class="sm-song' + (active ? ' active' : '') + '" data-id="' + m.id + '">' +
            songIcoHtml(m) +
            '<div class="sm-song-info"><div class="sm-song-name">' + esc(m.name || '未知歌曲') + '</div>' +
            '<div class="sm-song-sub">' + esc(m.artist || '未知歌手') + '</div></div>' +
            '<button class="sm-song-more" data-id="' + m.id + '" title="取消收藏"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5S4.5 15.2 4.5 9.9A4.9 4.9 0 0112 7.1a4.9 4.9 0 017.5 2.8c0 5.3-7.5 10.6-7.5 10.6z"/></svg></button>' +
            '</div>';
        }).join('')
      : '<div class="ta-empty">还没有收藏歌曲，播放时点击爱心收藏</div>';
    el.querySelectorAll('.sm-song').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.sm-song-more')) return;
        playTrack(row.dataset.id);
      });
    });
    el.querySelectorAll('.sm-song-more').forEach(b => {
      b.addEventListener('click', () => {
        toggleFav(b.dataset.id);
        toast('已取消收藏');
      });
    });
  }
  function syncFloatToggle() {
    const cb = document.getElementById('music-float-en');
    if (cb) cb.checked = settings.floatEn;
  }

  // ================= 联系人的收藏 =================
  // v3.14.x：我播放歌曲时，联系人按设置概率把这首歌收进「TA的收藏」（独立于我的收藏）。
  // 存 music-favs-ta（与音乐库同在 default 全局命名空间），tab 标题用联系人昵称动态渲染。
  // v3.26.x：改存「歌曲快照」而非纯 ID——纯 ID 方案下歌曲从音乐库删除后 findTrack 找不到，
  // 记录在列表里整体消失（用户要求：删歌后 TA 的收藏记录依旧保留）。条目两代格式兼容：
  // 旧数据是纯 id 字符串数组 → 读到后渲染时从库内信息回补快照（自愈迁移）；新数据是
  // {id,name,artist,neteaseId,url,cover,duration,favAt}。删除歌曲不清理本列表；已删歌曲
  // 用快照信息展示并标「已删除」，点击时若可还原（有 neteaseId 或原 url）则重新入库播放。
  function taFavList() {
    try {
      const v = JSON.parse(store.get('music-favs-ta') || '[]');
      if (!Array.isArray(v)) return [];
      return v.map(x => (typeof x === 'string') ? { id: x } : x).filter(x => x && x.id);
    } catch (e) { return []; }
  }
  function taFavIds() { return taFavList().map(x => x.id); }
  function saveTaFavList(list) { store.set('music-favs-ta', JSON.stringify(list)); }
  function isTaFav(id) { return taFavIds().indexOf(id) >= 0; }
  function addTaFav(id) {
    if (isTaFav(id)) return false;
    const m = findTrack(id);
    if (!m) return false; // 歌已不在库里，无法留快照（scheduleTaFavCheck 已先判 findTrack，理论到不了）
    const list = taFavList();
    list.unshift({ id: m.id, name: m.name || '', artist: m.artist || '', neteaseId: m.neteaseId || '', url: m.url || '', cover: m.cover || '', duration: m.duration || 0, favAt: Date.now() });
    saveTaFavList(list);
    renderTaFavList();
    return true;
  }
  function removeTaFav(id) {
    const list = taFavList();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    saveTaFavList(list);
    renderTaFavList();
    return true;
  }
  // 播放判定：听满 10~25 秒仍在播这首歌才掷概率——刚点开就切走不算「听过」，
  // 也避免快速切歌时连续弹提示。两次收藏间隔至少 90s，防刷屏。
  let taFavTimer = null;
  let taSongFavAt = 0;
  function clearTaFavTimer() {
    if (taFavTimer) { clearTimeout(taFavTimer); taFavTimer = null; }
  }
  function scheduleTaFavCheck(m) {
    clearTaFavTimer();
    const prob = probOf(settings.taFavProb, 20);
    if (!prob || !m || !m.id) return;
    if (isTaFav(m.id)) return;
    if (Date.now() - taSongFavAt < 90000) return;
    const trackId = m.id;
    taFavTimer = setTimeout(function () {
      taFavTimer = null;
      // 听歌中途切歌/暂停/停止都不再收藏
      if (currentId !== trackId) return;
      if (!audio || audio.paused) return;
      if (Math.random() * 100 >= probOf(settings.taFavProb, 20)) return;
      const mm = findTrack(trackId);
      if (!mm) return;
      if (addTaFav(trackId)) {
        taSongFavAt = Date.now();
        const name = partnerName();
        const trackName = mm.name || '未知歌曲';
        try { toast(window.taFit ? window.taFit(name + ' 收藏了这首歌') : (name + ' 收藏了《' + trackName + '》')); } catch (e) {}
        if (window.chatAddSystem) window.chatAddSystem(name + ' 收藏了歌曲《' + trackName + '》');
      }
    }, 10000 + Math.floor(Math.random() * 15000));
  }
  // 联系人的收藏列表（音乐页 tab：XX的收藏）
  // v3.26.x：快照渲染——歌在库里用实时信息（改名/换封面即时生效），已删除的用快照
  // 信息置灰展示并标「已删除」；旧纯 id 数据在渲染时从库内信息回补快照（自愈迁移）。
  // 点击已删歌曲：可还原（neteaseId/原 url 还在）→ 重新加入音乐库并播放；否则提示。
  function taFavRestorable(x) { return !!(x && (x.neteaseId || validAudioSrc(x.url))); }
  function restoreTaFavSong(x) {
    const url = x.neteaseId ? neteaseMetingUrl(x.neteaseId) : (validAudioSrc(x.url) ? x.url : '');
    if (!url) { toast('该歌曲文件已删除，无法播放'); return; }
    const nid = 'sm_fav_' + Date.now() + '_' + Math.floor(Math.random() * 1e4).toString(36);
    library.push({ id: nid, neteaseId: x.neteaseId || '', name: x.name || (x.neteaseId ? '网易云音乐-' + x.neteaseId : '未知歌曲'), artist: x.artist || '', cover: x.cover || '', url: url, source: 'url', duration: x.duration || 0, playlistId: 'default', addedAt: Date.now() });
    const list = taFavList();
    const it = list.find(t => t.id === x.id);
    if (it) { it.id = nid; it.url = url; saveTaFavList(list); } // 快照指向新库条目，列表行恢复可播
    saveLibrary();
    renderPage();
    renderTaFavList();
    playTrack(nid);
    toast('已重新加入音乐库并播放');
  }
  function renderTaFavList() {
    const el = document.getElementById('music-fav-ta-list');
    if (!el) return;
    const nm = partnerName();
    const list = taFavList();
    let healed = false;
    list.forEach(x => {
      if (x.name) return; // 已有快照信息
      const m = findTrack(x.id);
      if (m) { // 旧纯 id 数据：歌还在库 → 回补快照
        x.name = m.name || ''; x.artist = m.artist || ''; x.neteaseId = m.neteaseId || '';
        x.url = m.url || ''; x.cover = m.cover || ''; x.duration = m.duration || 0;
        healed = true;
      }
    });
    if (healed) saveTaFavList(list);
    const rows = list.map(x => {
      const m = findTrack(x.id);
      const gone = !m;
      const name = (m && m.name) || x.name || '未知歌曲';
      const artist = (m && m.artist) || x.artist || '';
      const active = m && m.id === currentId;
      return '<div class="sm-song' + (active ? ' active' : '') + (gone ? ' ta-fav-gone' : '') + '" data-id="' + x.id + '">' +
        songIcoHtml(m || x) +
        '<div class="sm-song-info"><div class="sm-song-name">' + esc(name) + (gone ? '<span class="sm-fav-gone-tag">已删除</span>' : '') + '</div>' +
        '<div class="sm-song-sub">' + esc(artist || '未知歌手') + (gone ? ' · ' + (taFavRestorable(x) ? '点击重新加入并播放' : '文件已不在，无法播放') : '') + '</div></div>' +
        '<button class="sm-song-more" data-id="' + x.id + '" title="取消收藏"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5S4.5 15.2 4.5 9.9A4.9 4.9 0 0112 7.1a4.9 4.9 0 017.5 2.8c0 5.3-7.5 10.6-7.5 10.6z"/></svg></button>' +
        '</div>';
    }).join('');
    el.innerHTML = rows || '<div class="ta-empty">' + esc(nm) + ' 还没有收藏歌曲，播放时 ' + esc(nm) + ' 有概率把喜欢的歌收进来</div>';
    el.querySelectorAll('.sm-song').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.sm-song-more')) return;
        const id = row.dataset.id;
        if (findTrack(id)) { playTrack(id); return; }
        const x = taFavList().find(t => t.id === id);
        if (x && taFavRestorable(x)) { restoreTaFavSong(x); return; }
        toast('该歌曲已删除，无法播放');
      });
    });
    el.querySelectorAll('.sm-song-more').forEach(b => {
      b.addEventListener('click', () => {
        removeTaFav(b.dataset.id);
        toast('已取消收藏');
      });
    });
  }
  // tab 标题跟随联系人昵称（模板里是静态占位，进入页面/切换联系人后由 JS 填）
  function syncTaFavTab() {
    const tab = document.querySelector('#page-music .fav-tab[data-mtab="favta"]');
    if (tab) tab.textContent = partnerName() + '的收藏';
  }
  function setupFloatDrag() {
    const el = document.getElementById('sm-float');
    if (!el) return;
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      document.body.style.cursor = 'move';
      const onMove = (ev) => {
        if (!dragging) return;
        ev.preventDefault();
        let x = ox + (ev.clientX - sx), y = oy + (ev.clientY - sy);
        x = Math.max(4, Math.min(window.innerWidth - el.offsetWidth - 4, x));
        y = Math.max(4, Math.min(window.innerHeight - el.offsetHeight - 4, y));
        el.style.left = x + 'px';
        el.style.top = y + 'px';
      };
      const onUp = () => {
        dragging = false;
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        store.set('music-float-pos', JSON.stringify({ left: el.style.left, top: el.style.top }));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // 触屏拖动
    el.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      const t = e.touches[0];
      dragging = true;
      sx = t.clientX; sy = t.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      const onMove = (ev) => {
        if (!dragging) return;
        ev.preventDefault();
        const t2 = ev.touches[0];
        let x = ox + (t2.clientX - sx), y = oy + (t2.clientY - sy);
        x = Math.max(4, Math.min(window.innerWidth - el.offsetWidth - 4, x));
        y = Math.max(4, Math.min(window.innerHeight - el.offsetHeight - 4, y));
        el.style.left = x + 'px';
        el.style.top = y + 'px';
      };
      const onUp = () => {
        dragging = false;
        el.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        store.set('music-float-pos', JSON.stringify({ left: el.style.left, top: el.style.top }));
      };
      el.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    }, { passive: true });
    // 恢复上次位置
    try {
      const pos = JSON.parse(store.get('music-float-pos') || 'null');
      if (pos && pos.left && pos.top) { el.style.left = pos.left; el.style.top = pos.top; }
    } catch(e) {}
  }

  // ================= 梦角邀请听歌记录 =================
  // 记录：TA 邀请一起听歌（接受/拒绝）、TA 切歌/随机挑歌、TA 换播放模式
  function addRecord(trackId, triggerType) {
    const m = findTrack(trackId);
    // v3.9.x：冗余存 cover——历史记录独立显示封面，歌曲之后被删/换封面不影响已产生的记录
    history.push({ id: 'smh_' + Date.now(), trackId: trackId, trackName: m ? (m.name || '未知歌曲') : '未知歌曲', cover: m ? (m.cover || '') : '', triggerType: triggerType, ts: Date.now() });
    if (history.length > 500) history = history.slice(-500);
    saveHistory();
    renderHistory();
  }
  // TA 换播放模式记录
  function addModeRecord(modeLabel) {
    history.push({ id: 'smh_' + Date.now(), trackId: '', trackName: '', triggerType: 'TA 把播放模式换成' + modeLabel, mode: true, ts: Date.now() });
    if (history.length > 500) history = history.slice(-500);
    saveHistory();
    renderHistory();
  }
  // ================= 我的听歌记录 =================
  // 用户主动点击播放（含从歌单/收藏/悬浮框点播），与 TA 邀请听歌记录分开存
  function addMyRecord(trackId) {
    const m = findTrack(trackId);
    myHistory.push({ id: 'smymh_' + Date.now(), trackId: trackId, trackName: m ? (m.name || '未知歌曲') : '未知歌曲', cover: m ? (m.cover || '') : '', ts: Date.now() });
    if (myHistory.length > 500) myHistory = myHistory.slice(-500);
    saveMyHistory();
    if (curTab === 'his' && hisSubTab === 'mine') renderHistory();
  }


  // ================= 音乐管理（编辑/删除） =================
  function openSongMenu(id) {
    const m = findTrack(id);
    if (!m) return;
    if (!window.openTCPanel) return;
    const plOpts = playlists.map(p => '<option value="' + p.id + '"' + (m.playlistId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
    window.openTCPanel('管理音乐', '' +
      '<div class="sm-fld"><label>快捷操作</label><div class="sm-quick-actions">' +
      '<button class="cc-tool" id="sm-e-qnext">下一首播放</button>' +
      '<button class="cc-tool" id="sm-e-qpl">加入播放列表</button>' +
      '</div></div>' +
      // v3.6.x：回填值做属性级转义——歌名/歌手含 " 会提前闭合 value 属性破坏表单（esc 只转义 <）
      '<div class="sm-fld"><label>歌曲名称</label><input class="tc-input" id="sm-e-name" value="' + String(m.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></div>' +
      '<div class="sm-fld"><label>歌手</label><input class="tc-input" id="sm-e-artist" value="' + String(m.artist || '').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></div>' +
      '<div class="sm-fld"><label>所属歌单</label><select class="tc-input" id="sm-e-pl"><option value="default">我的音乐库</option>' + plOpts + '</select></div>' +
      '<div class="sm-fld"><label>歌曲封面</label>' +
      '<div class="sm-cov-row">' +
      '<div class="sm-cov-prev' + (m.cover ? ' has-cov' : '') + '" id="sm-e-cov-prev"' + (m.cover ? ' style="background-image:url(\'' + esc(m.cover) + '\')"' : '') + ' title="点击上传封面"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg></div>' +
      '<div class="sm-cov-actions"><button class="cc-tool sm-cov-btn" id="sm-e-cov-up">上传封面</button><button class="cc-tool sm-cov-btn" id="sm-e-cov-clear"' + (m.cover ? '' : ' hidden') + '>清除封面</button></div>' +
      '</div></div>' +
      '<div class="mail-actions"><button class="cc-tool" id="sm-e-del">删除</button><button class="cc-tool" id="sm-e-cancel">取消</button><button class="cc-tool" id="sm-e-ok">保存</button></div>');
    // 自定义封面：上传（压缩到 512px 存 dataURL）/ 清除，保存到 m.cover（桌面部件/列表同步显示）
    const covPrev = document.getElementById('sm-e-cov-prev');
    const covUp = document.getElementById('sm-e-cov-up');
    const covClear = document.getElementById('sm-e-cov-clear');
    const covInput = document.createElement('input');
    covInput.type = 'file';
    covInput.accept = 'image/*';
    covInput.style.display = 'none';
    document.body.appendChild(covInput);
    covInput.onchange = function () {
      const f = covInput.files && covInput.files[0];
      covInput.value = '';
      if (!f) return;
      compressCover(f, function (dv) {
        if (!dv) { toast('封面读取失败，请换一张图片'); return; }
        m.cover = dv;
        saveLibrary();
        renderPage();
        covPrev.classList.add('has-cov');
        covPrev.style.backgroundImage = 'url(\'' + dv + '\')';
        covClear.hidden = false;
        toast('封面已设置');
      });
    };
    const pickCover = () => { try { covInput.click(); } catch (e) {} };
    if (covUp) covUp.addEventListener('click', pickCover);
    if (covPrev) covPrev.addEventListener('click', pickCover);
    if (covClear) covClear.addEventListener('click', () => {
      m.cover = '';
      saveLibrary();
      renderPage();
      covPrev.classList.remove('has-cov');
      covPrev.style.backgroundImage = '';
      covClear.hidden = true;
      toast('已清除封面');
    });
    document.getElementById('sm-e-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
    // v3.x：快捷操作——下一首播放（加入播放队列）/ 加入播放列表（移动到所选歌单）
    const qnext = document.getElementById('sm-e-qnext');
    if (qnext) qnext.addEventListener('click', () => {
      addToQueue(id);
      document.getElementById('tc-mask').hidden = true;
      toast('已加入播放队列，播完当前将播放');
    });
    const qpl = document.getElementById('sm-e-qpl');
    if (qpl) qpl.addEventListener('click', () => {
      if (!window.openTCPanel) return;
      const opts = playlists.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
      window.openTCPanel('加入播放列表', '<div class="sm-fld"><label>选择歌单</label><select class="tc-input" id="sm-qpl-sel"><option value="default">我的音乐库</option>' + opts + '</select></div>' +
        '<div class="mail-actions"><button class="cc-tool" id="sm-qpl-cancel">取消</button><button class="cc-tool" id="sm-qpl-ok">加入</button></div>');
      document.getElementById('sm-qpl-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
      document.getElementById('sm-qpl-ok').addEventListener('click', () => {
        m.playlistId = document.getElementById('sm-qpl-sel').value;
        saveLibrary();
        document.getElementById('tc-mask').hidden = true;
        renderPage();
        toast('已加入播放列表');
      });
    });
    document.getElementById('sm-e-ok').addEventListener('click', () => {
      m.name = (document.getElementById('sm-e-name').value || '').trim() || m.name;
      m.artist = (document.getElementById('sm-e-artist').value || '').trim();
      m.playlistId = document.getElementById('sm-e-pl').value;
      saveLibrary();
      document.getElementById('tc-mask').hidden = true;
      renderPage();
      toast('已保存');
    });
    document.getElementById('sm-e-del').addEventListener('click', () => {
      if (window.openModal) {
        window.openModal('删除这首音乐？', '', () => {
          library = library.filter(x => x.id !== id);
          if (window.idbGetAllKeys) {
            window.idbGetAllKeys().then(keys => {
              // v3.5.123：全等匹配（前缀匹配在 id 互为前缀时会误删）
              keys.filter(k => k === MUSIC_PREFIX + ':music-file:' + id).forEach(k => {
                if (window.idbDelete) window.idbDelete(k);
              });
            });
          }
          if (currentId === id) { teardownAudio(); currentId = null; }
          saveLibrary();
          document.getElementById('tc-mask').hidden = true;
          renderPage();
          toast('已删除');
        }, { noInput: true });
      }
    });
  }

  // ================= TA 互动：请求一起听歌 =================
  // 聊天回复完成后由 chat.js 调用（延后 2 秒，仿星言）
  window.maybeMusicRequest = function () {
    try {
      // v3.9.x：页面在后台时不发起听歌请求——否则 tc-mask 请求弹窗会在后台打开，
      // 回前台时突然弹出几分钟前的"想和你一起听《...》"旧请求（用户反馈：
      // 切换后台后返回浏览器，后台弹窗突然弹几分钟前的联系人播放音乐系统消息）
      if (document.hidden) { console.log('[music-req] return: page hidden'); return; }
      const prob = (typeof settings.reqProb === 'number' ? settings.reqProb : 5);
      console.log('[music-req] called', { libLen: library.length, cooldownAt: cooldownAt, cooldownMs: settings.cooldownMs, reqProb: settings.reqProb, prob: prob, now: Date.now() });
      if (!library.length) { console.log('[music-req] return: library empty'); return; }
      const now = Date.now();
      const cooling = now - cooldownAt < settings.cooldownMs;
      // v3.x：「一起去听」请求（弹窗）——触发后直接 return，同一次调用不再判断「预订下一首」
      if (!cooling) {
        const prob = (typeof settings.reqProb === 'number' ? settings.reqProb : 5);
        if (Math.random() * 100 < prob) {
          console.log('[music-req] TRIGGER');
          cooldownAt = now;
      const candidates = library.slice();
      if (!candidates.length) return;
      const track = candidates[Math.floor(Math.random() * candidates.length)];
      // 多桌面：弹窗期间切换联系人后点按钮会把接受/拒绝写到新桌面 → 捕获 cid 校验
      const myCid = window.__activeCid || 'default';
      // v3.x：正有音乐在播时，邀请语义＝「切换去听这首歌」；无播放时＝「开始一起听这首歌」
      const switching = !!currentId;
      reqData = { trackId: track.id, switching: switching };
      taActive = true;
      const name = partnerName();
      const trackName = track.name || '未知歌曲';
      const artist = track.artist ? ' - ' + track.artist : '';
      const askMsg = switching
        ? name + ' 想邀请你切换到《' + trackName + '》' + artist
        : name + ' 想和你一起听《' + trackName + '》' + artist;
      if (window.chatAddSystem) window.chatAddSystem(askMsg);
      if (window.openTCPanel) {
        window.openTCPanel('音乐', '' +
          '<div class="sm-req">' +
          '<div class="sm-req-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>' +
          '<div class="sm-req-hint">' + (window.taFit ? window.taFit(name + (switching ? ' 想邀请你切到这首歌：' : ' 想和你一起听：')) : (name + (switching ? ' 想邀请你切到这首歌：' : ' 想和你一起听：'))) + '</div>' +
          '<div class="sm-req-name">《' + esc(trackName) + '》</div>' +
          '</div>' +
          '<div class="mail-actions"><button class="cc-tool" id="sm-req-no">稍后</button><button class="cc-tool" id="sm-req-yes">' + (switching ? '切过去' : '一起听') + '</button></div>');
        document.getElementById('sm-req-no').addEventListener('click', () => {
          document.getElementById('tc-mask').hidden = true;
          if ((window.__activeCid || 'default') !== myCid) { reqData = null; return; }
          reqData = null;
          // 记录：TA 邀请听歌（拒绝）
          history.push({ id: 'smh_' + Date.now(), trackId: '', trackName: '', triggerType: '拒绝了 TA 的听歌邀请《' + esc(trackName) + '》', rejected: true, ts: Date.now() });
          if (history.length > 500) history = history.slice(-500);
          saveHistory(); renderHistory();
          if (window.chatAddSystem) window.chatAddSystem('你拒绝了 ' + name + ' 的听歌邀请');
        });
        document.getElementById('sm-req-yes').addEventListener('click', () => {
          document.getElementById('tc-mask').hidden = true;
          if ((window.__activeCid || 'default') !== myCid) { reqData = null; return; }
          if (!reqData) return;
          const switchNow = !!reqData.switching;
          playTrack(reqData.trackId);
          addRecord(reqData.trackId, '接受了 TA 的听歌邀请');
          const accMsg = switchNow
            ? '你接受了邀请，已切换到《' + (track.name || '未知歌曲') + '》'
            : '你接受了 ' + name + ' 的听歌邀请，一起听《' + (track.name || '未知歌曲') + '》';
          if (window.chatAddSystem) window.chatAddSystem(accMsg);
          reqData = null;
          toast('开始播放');
        });
      }
        return; // 「一起去听」已触发，本次调用不再判断「预订下一首」
      }
    }
    // v3.x：「预订下一首」——聊天中 TA 按独立概率把一首歌排进播放队列并发系统消息；
    // 与「一起去听」共用冷却（同一冷却窗内互斥，任一生效即进入冷却，不会同一条消息里同时发生）
    // v3.24.x：只有正在播放时才允许「预订下一首」——没播放时预订下一首无意义，
    // 且会让用户看到"预订下一首"系统消息却以为本该是"邀请一起听"弹窗（用户反馈）。
    // 没播放时只走上面的「一起去听」弹窗分支（switching=false，"想和你一起听"）。
    const rProb = probOf(settings.taReserveProb, 6);
    if (currentId && !(now - cooldownAt < settings.cooldownMs) && Math.random() * 100 < rProb && library.length) {
      // 挑一首「既没在播、也不在播放队列」的歌作为下一首目标（重试若干次）
      let candidate = null;
      for (let i = 0; i < 8; i++) {
        const c = library[Math.floor(Math.random() * library.length)];
        if (c && c.id !== currentId && playQueue.indexOf(c.id) < 0) { candidate = c; break; }
      }
      if (candidate) {
        cooldownAt = now;
        playQueue.push(candidate.id);
        renderQueueBadge();
        const name = partnerName();
        const trackName = candidate.name || '未知歌曲';
        const artist = candidate.artist ? ' - ' + candidate.artist : '';
        if (window.chatAddSystem) window.chatAddSystem(name + ' 预订了下一首要听的歌：《' + trackName + '》' + artist);
        addRecord(candidate.id, 'TA 预订了下一首');
      }
    }
    } catch (e) {}
  };
  // 歌曲结束：TA 可能接动作（切歌/随机/换模式）
  function maybeTAAutoAction() {
    if (!taActive || !currentId) return false;
    // v3.6.x：记录结束的这首歌——延迟抢播回调必须校验 currentId 仍是它，
    // 否则只要播放器还活跃（currentId 恒非 null），用户 300ms 内手动切歌也会被 TA 抢播覆盖
    const endedId = currentId;
    // v3.14.x：三个动作概率改为音乐设置可调（默认 切下一首15 / 随机挑歌10 / 换播放模式5，
    // 与原硬编码加权一致）；剩余概率=TA 不接动作，按当前播放模式正常自动切下一首。
    // 三项全设 0 即 TA 从不主动控制播放。
    const pNext = probOf(settings.taNextProb, 15);
    const pRand = probOf(settings.taRandProb, 10);
    const pMode = probOf(settings.taModeProb, 5);
    const r = Math.random() * 100;
    const name = partnerName();
    if (r < pNext) {
      const list = playableList();
      if (list.length > 1) {
        const others = list.filter(x => x.id !== currentId);
        const t = others[Math.floor(Math.random() * others.length)];
        if (window.chatAddSystem) window.chatAddSystem(name + ' 切到了下一首《' + (t.name || '未知歌曲') + '》');
        addRecord(t.id, 'TA 切到了下一首');
        // v3.5.129：延迟回调校验 currentId——期间用户手动切了歌就不再抢播
        setTimeout(() => { if (currentId === endedId) playTrack(t.id); }, 300);
        return true;
      }
      return false;
    }
    if (r < pNext + pRand) {
      const list = playableList();
      if (list.length > 1) {
        const t = list[Math.floor(Math.random() * list.length)];
        if (window.chatAddSystem) window.chatAddSystem(name + ' 随机挑了一首《' + (t.name || '未知歌曲') + '》');
        addRecord(t.id, 'TA 随机挑了一首');
        setTimeout(() => { if (currentId === endedId) playTrack(t.id); }, 300);
        return true;
      }
      return false;
    }
    if (r < pNext + pRand + pMode) {
      cycleMode();
      const modeLabel = { list: '顺序播放', shuffle: '随机播放', single: '单曲循环' }[mode];
      if (window.chatAddSystem) window.chatAddSystem(name + ' 把播放模式换成了' + modeLabel);
      addModeRecord(modeLabel);
    }
    return false;
  }

  // ================= v3.27.x：TA 暂停再播放互动 =================
  // 播放中按 taPauseProb 小概率触发：TA 突然暂停播放 → 聊天发「TA 暂停播放」字卡，
  // 约 3.5 秒后 TA 又帮你点播放恢复 → 再发「TA 恢复播放」字卡（保留播放进度）。
  // 字卡文案来自系统预设字卡【其他互动功能字卡 → 音乐】tab（dc-off-music:* 逐张可关）。
  // 防连发/防循环（用户明确要求不要"一直暂停又继续"）：
  //   ① 同一首歌只互动一次（taPauseDoneId）；
  //   ② 互动后进入冷却（cooldownMs，默认 10 分钟）——连续切歌/下一首也不会每首都触发；
  //   ③ 互动进行中全局 taPauseActive 重入保护；
  //   ④ 音乐设置「联系人可暂停你的播放」总开关（taPauseEn，关闭=彻底不触发）。
  const DEF_TA_PAUSE_CARDS = ['先暂停一下，听我说句话', '嘘——让音乐停一会儿', '（TA 按下了暂停键）'];
  const DEF_TA_RESUME_CARDS = ['好啦，继续听吧', '又帮你按了播放，接着听', '（TA 又按下了播放键）'];
  let taPauseActive = false;      // TA 暂停进行中（禁止后台补播/手势补播打扰）
  let taPauseTimer = null;        // 掷骰子命中后的延迟触发定时器
  let taPauseResumeTimer = null;  // TA 恢复播放定时器
  let taPauseDoneId = null;       // 已互动过的歌曲 id（同一首歌不重复触发）
  let taPauseCooldownAt = 0;      // 上次互动完成时间戳（冷却期内不连发）
  function cancelTaPause() {
    taPauseActive = false;
    if (taPauseTimer) { clearTimeout(taPauseTimer); taPauseTimer = null; }
    if (taPauseResumeTimer) { clearTimeout(taPauseResumeTimer); taPauseResumeTimer = null; }
  }
  // 从系统预设字卡「音乐」分类抽字卡发进聊天（过滤已关闭单卡，全关回退内置兜底）
  function taPauseSendCard(group, fallback) {
    try {
      let arr = window.getLibPool ? window.getLibPool('music', group, fallback) : (fallback || []);
      if (window.isDefaultCardOff) arr = arr.filter(c => !window.isDefaultCardOff('music', c));
      if (!arr.length) arr = (fallback || []).slice();
      if (!arr.length) return;
      let m = arr[Math.floor(Math.random() * arr.length)];
      if (window.taFit) m = window.taFit(m);
      if (window.chatAddIn) window.chatAddIn(m);
    } catch (e) {}
  }
  // 开始播放一首歌时掷一次骰子；命中则在该歌播放 10~25s 后执行「暂停→恢复」互动。
  // 任一防连发守卫命中即整首不触发：开关关闭 / 同歌已互动过 / 冷却期内 / 概率未中。
  function scheduleTaPauseIfLucky() {
    cancelTaPause();
    if (!settings.taPauseEn) return;                                  // 权限开关关闭：彻底不触发
    if (currentId && currentId === taPauseDoneId) return;             // 同一首歌只互动一次
    if (Date.now() - taPauseCooldownAt < (settings.cooldownMs || 600000)) return; // 冷却期内不连发
    const p = probOf(settings.taPauseProb, 3);
    if (p <= 0 || Math.random() * 100 >= p) return;
    if (!currentId || !audio) return;
    const endedId = currentId;
    taPauseTimer = setTimeout(function () {
      taPauseTimer = null;
      if (taPauseActive || !audio || !currentId || currentId !== endedId || audio.paused) return;
      if (callHoldPending || document.hidden) return; // 通话/后台不打扰
      taPauseActive = true;
      wantPlay = true; // 保留播放意图（TA 稍后会恢复，不按「用户主动暂停」处理）
      try { audio.pause(); } catch (e) {}
      try { const nm = partnerName(); if (window.chatAddSystem) window.chatAddSystem(nm + ' 暂停了音乐'); } catch (e) {}
      taPauseSendCard('TA 暂停播放', DEF_TA_PAUSE_CARDS);
      // 3.5s 后 TA 点播放恢复（校验仍是同一首歌；非手势播放被拒走 muted 解锁兜底）
      taPauseResumeTimer = setTimeout(function () {
        taPauseResumeTimer = null;
        if (!taPauseActive || !audio || !currentId || currentId !== endedId) { taPauseActive = false; return; }
        taPauseActive = false;
        // 防连发：互动完成——该歌标记已互动、进入冷却（切歌后 currentId 变化自然重置）
        taPauseDoneId = endedId;
        taPauseCooldownAt = Date.now();
        const p2 = audio.play();
        if (p2 && p2.catch) p2.catch(function () {
          if (!audio) return; // v3.28.x：判空防 null.play()（3.5s 恢复窗口内可能已切歌/停止）
          try { audio.muted = true; } catch (e) {}
          const p3 = audio.play();
          if (p3 && p3.then) p3.then(function () { try { if (audio) audio.muted = false; } catch (e) {} }).catch(function () {});
        });
        try { const nm = partnerName(); if (window.chatAddSystem) window.chatAddSystem(nm + ' 又播放了音乐'); } catch (e) {}
        taPauseSendCard('TA 恢复播放', DEF_TA_RESUME_CARDS);
      }, 3500);
    }, 10000 + Math.floor(Math.random() * 15000));
  }

  // ================= 星音设置 =================
  // v3.6.x：音乐本地缓存统计与清理——音频文件本体存 IndexedDB（music-file:<id>），
  // 这里按 IDB 键名统计占用、提供一键清理（删本地音频 + 移出歌单，外链/种子歌保留）
  function MUSIC_FILE_PREFIX() { return MUSIC_PREFIX + ':music-file:'; }
  // 统计本地音频缓存字节数（分批读，读完即弃，内存峰值=单批；失败返回 -1）
  function calcStorageBytes() {
    if (!window.idbGetAllKeys) return Promise.resolve(-1);
    return window.idbGetAllKeys().then(keys => {
      const fileKeys = keys.filter(k => k.indexOf(MUSIC_FILE_PREFIX()) === 0);
      if (!fileKeys.length) return 0;
      const BATCH = 20;
      function readBatch(i) {
        if (i >= fileKeys.length) return Promise.resolve(0);
        return window.idbGetMany(fileKeys.slice(i, i + BATCH)).then(map => {
          let total = 0;
          fileKeys.slice(i, i + BATCH).forEach(k => {
            const v = map[k];
            // v3.6.x：新版存 Blob（v.size 即真实字节）；旧版存 base64 字符串（字符数 ×0.75 ≈ 真实字节）
            if (v instanceof Blob) total += v.size;
            else if (typeof v === 'string') total += v.length * 0.75;
          });
          return readBatch(i + BATCH).then(sub => total + sub);
        });
      }
      return readBatch(0);
    }).catch(() => -1);
  }
  function fmtStorageMB(bytes) {
    if (bytes < 0) return '计算失败';
    if (!bytes) return '0 MB';
    // v3.6.x：bytes 已是真实字节（Blob 原大小 / base64 已换算），直接除 1024²
    const mb = bytes / 1048576;
    return (mb < 0.01 ? '0.01' : mb.toFixed(1)) + ' MB';
  }
  function refreshStorageUse() {
    const el = document.getElementById('sm-storage-use');
    if (!el) return;
    el.textContent = '计算中…';
    calcStorageBytes().then(b => { const e = document.getElementById('sm-storage-use'); if (e) e.textContent = fmtStorageMB(b); });
  }
  // 一键清理：删 music-file:<id> 音频文件；非种子歌曲从歌单移除（外链/种子歌保留）
  function clearLocalAudioCache() {
    if (!window.idbGetAllKeys || !window.idbDelete) { toast('当前环境不支持清理'); return; }
    window.idbGetAllKeys().then(keys => {
      const fileKeys = keys.filter(k => k.indexOf(MUSIC_FILE_PREFIX()) === 0);
      if (!fileKeys.length) { toast('没有本地音频缓存'); refreshStorageUse(); return; }
      const delIds = [];       // 要移除的歌曲 id（非种子，音频删了歌也播不了）
      const cacheOnly = [];    // 种子歌的本地旋律缓存键（可再生成，只删缓存不动歌）
      fileKeys.forEach(k => {
        const id = k.slice(MUSIC_FILE_PREFIX().length);
        const m = library.find(x => x.id === id);
        if (m && seedIdxOf(m) >= 0) cacheOnly.push(k);
        else delIds.push(id);
      });
      window.openModal('将删除 ' + fileKeys.length + ' 个本地音频文件，并从歌单移除 ' + delIds.length + ' 首本地歌曲（外链歌曲不受影响）。确定清理？', '', () => {
        let p = Promise.resolve(true);
        fileKeys.forEach(k => { p = p.then(() => window.idbDelete(k)); });
        p.then(() => {
          if (delIds.length) {
            library = library.filter(m => !delIds.includes(m.id));
            if (currentId && delIds.includes(currentId)) { teardownAudio(); currentId = null; }
            saveLibrary();
          }
          if (audio) updatePlayerBar();
          renderFloat();
          refreshStorageUse();
          toast('已清理本地音频缓存');
        });
      }, { noInput: true });
    });
  }
  function openSettings() {
    if (!window.openTCPanel) return;
    const cooldownOpts = [
      { v: '0', label: '无冷却' },
      { v: '300000', label: '5 分钟' },
      { v: '600000', label: '10 分钟' }
    ].map(o => '<option value="' + o.v + '"' + (String(settings.cooldownMs) === o.v ? ' selected' : '') + '>' + o.label + '</option>').join('');
    window.openTCPanel('音乐设置', '' +
      '<div class="sm-set-row"><span>悬浮播放小框</span><label class="toggle"><input type="checkbox" id="sm-set-float"' + (settings.floatEn ? ' checked' : '') + '><span class="tk"></span></label></div>' +
      '<div class="gs-row"><span>音乐请求触发概率</span><div class="stepper" id="sm-set-prob" data-min="0" data-max="30" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="sm-set-prob-val" readonly><button class="stp-max">+</button></div></div>' +
      '<div class="gs-row"><span>请求冷却时间</span><select class="tc-input" id="sm-set-cool" style="width:110px">' + cooldownOpts + '</select></div>' +
      '<div class="gs-row"><span>桌面小组件封面</span><select class="tc-input" id="sm-set-wcov" style="width:120px"><option value="song"' + (settings.widgetCoverMode !== 'playlist' ? ' selected' : '') + '>歌曲封面</option><option value="playlist"' + (settings.widgetCoverMode === 'playlist' ? ' selected' : '') + '>歌单封面</option></select></div>' +
      '<div class="sm-set-hint">聊天过程中 TA 会按概率请求和你一起听歌；播放时右上角出现可拖动的悬浮小框</div>' +
      '<div class="gs-row"><span>预订下一首概率</span><div class="stepper" id="sm-set-reserve" data-min="0" data-max="100" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="sm-set-reserve-val" readonly><button class="stp-max">+</button></div></div>' +
      '<div class="sm-set-hint">聊天过程中 TA 有概率「预订」下一首要播的音乐：把这首歌排进播放队列（底部播放条的「播放队列」里可见），并在聊天里发送系统消息；被预订的歌会按你排的顺序先播（设 0 = TA 从不预订下一首）</div>' +
      '<div class="gs-row"><span>歌曲播完·切下一首概率</span><div class="stepper" id="sm-set-next" data-min="0" data-max="100" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="sm-set-next-val" readonly><button class="stp-max">+</button></div></div>' +
      '<div class="gs-row"><span>歌曲播完·随机挑歌概率</span><div class="stepper" id="sm-set-rand" data-min="0" data-max="100" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="sm-set-rand-val" readonly><button class="stp-max">+</button></div></div>' +
      '<div class="gs-row"><span>歌曲播完·换播放模式概率</span><div class="stepper" id="sm-set-modep" data-min="0" data-max="100" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="sm-set-modep-val" readonly><button class="stp-max">+</button></div></div>' +
      '<div class="sm-set-hint">一起听完一首歌时，TA 按上面三个概率主动控制播放：切到下一首 / 随机挑一首 / 把播放模式换成顺序播放·列表循环·随机播放·单曲循环；三个都不中就正常自动切下一首（全设 0 = TA 从不主动控制）</div>' +
      '<div class="sm-set-row"><span>联系人可暂停你的播放</span><label class="toggle"><input type="checkbox" id="sm-set-pause-en"' + (settings.taPauseEn ? ' checked' : '') + '><span class="tk"></span></label></div>' +
      '<div class="gs-row"><span>播放中·TA 暂停再播放概率</span><div class="stepper" id="sm-set-pauseprob" data-min="0" data-max="100" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="sm-set-pauseprob-val" readonly><button class="stp-max">+</button></div></div>' +
      '<div class="sm-set-hint">播放歌曲时 TA 有小概率突然暂停播放（聊天里发一张字卡），几秒后再帮你点播放恢复（再发一张字卡）；字卡文案在【字卡库 → 其他互动功能字卡 → 音乐】可逐张开关。上方开关关闭或概率设 0 = 关闭 TA 暂停权限；同一首歌只触发一次、触发后 10 分钟内不重复（不会一直暂停又继续）</div>' +
      '<div class="gs-row"><span>TA 收藏歌曲概率</span><div class="stepper" id="sm-set-favprob" data-min="0" data-max="100" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="sm-set-favprob-val" readonly><button class="stp-max">+</button></div></div>' +
      '<div class="sm-set-hint">你播放歌曲听一会儿后，TA 有概率把这首歌收进「TA的收藏」（音乐页收藏 tab 右边可查看；已收藏过的歌不重复判定，两次收藏间隔至少 90 秒）</div>' +
      '<div class="sm-set-row"><span>本地音频缓存</span><span id="sm-storage-use" style="color:var(--muted);font-size:12px">计算中…</span></div>' +
      '<div class="mail-actions"><button class="cc-tool" id="sm-diag-req">诊断邀请</button><button class="cc-tool" id="sm-clear-cache">清理本地音频缓存</button><button class="cc-tool" id="sm-set-close">关闭</button></div>');
    document.getElementById('sm-set-close').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
    const diagBtn = document.getElementById('sm-diag-req');
    if (diagBtn) diagBtn.addEventListener('click', function () {
      const remain = Math.max(0, settings.cooldownMs - (Date.now() - cooldownAt));
      const lines = [
        '歌库: ' + library.length + ' 首',
        'maybeMusicRequest: ' + (typeof window.maybeMusicRequest),
        'reqProb: ' + settings.reqProb + ' → 实际 ' + (typeof settings.reqProb === 'number' ? settings.reqProb : 5) + '%',
        'cooldownMs: ' + settings.cooldownMs,
        '冷却剩余: ' + Math.ceil(remain / 1000) + ' s',
        'openTCPanel: ' + (typeof window.openTCPanel),
        'chatAddSystem: ' + (typeof window.chatAddSystem)
      ];
      window.openTCPanel('音乐邀请诊断', '<div class="sm-set-hint">' + lines.join('<br>') + '</div><div class="mail-actions"><button class="cc-tool" id="sm-diag-force">强制触发一次</button><button class="cc-tool" id="sm-diag-close">关闭</button></div>');
      document.getElementById('sm-diag-close').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
      document.getElementById('sm-diag-force').addEventListener('click', () => {
        document.getElementById('tc-mask').hidden = true;
        if (!library.length) { toast('library 为空，无法触发'); return; }
        const track = library[Math.floor(Math.random() * library.length)];
        reqData = { trackId: track.id };
        taActive = true;
        const name = partnerName();
        const trackName = track.name || '未知歌曲';
        const artist = track.artist ? ' - ' + track.artist : '';
        if (window.chatAddSystem) window.chatAddSystem(name + ' 想和你一起听《' + trackName + '》' + artist);
        if (window.openTCPanel) {
          window.openTCPanel('音乐', '<div class="sm-req"><div class="sm-req-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div><div class="sm-req-hint">' + name + ' 想和你一起听：</div><div class="sm-req-name">《' + esc(trackName) + '》</div></div><div class="mail-actions"><button class="cc-tool" id="sm-req-no">稍后</button><button class="cc-tool" id="sm-req-yes">一起听</button></div>');
        }
      });
    });
    const clearBtn = document.getElementById('sm-clear-cache');
    if (clearBtn) clearBtn.addEventListener('click', clearLocalAudioCache);
    refreshStorageUse();
    // v3.14.x：概率步进器统一绑定（步长 5；reqProb 上限保持原 30，
    // 新增的歌曲播完三动作 / TA 收藏歌曲上限 100——设 0 即关闭该行为）
    const bindProbStep = (id, key, def, max) => {
      const valEl = document.getElementById(id + '-val');
      const box = document.getElementById(id);
      if (!valEl || !box) return;
      valEl.value = probOf(settings[key], def);
      box.querySelector('.stp-min').addEventListener('click', () => {
        const nv = Math.max(0, (parseInt(valEl.value, 10) || 0) - 5);
        valEl.value = nv; settings[key] = nv; saveSettings();
      });
      box.querySelector('.stp-max').addEventListener('click', () => {
        const nv = Math.min(max, (parseInt(valEl.value, 10) || 0) + 5);
        valEl.value = nv; settings[key] = nv; saveSettings();
      });
    };
    bindProbStep('sm-set-prob', 'reqProb', 5, 30);
    bindProbStep('sm-set-reserve', 'taReserveProb', 6, 100);
    bindProbStep('sm-set-next', 'taNextProb', 15, 100);
    bindProbStep('sm-set-rand', 'taRandProb', 10, 100);
    bindProbStep('sm-set-modep', 'taModeProb', 5, 100);
    bindProbStep('sm-set-pauseprob', 'taPauseProb', 3, 100);
    bindProbStep('sm-set-favprob', 'taFavProb', 20, 100);
    // v3.27.x：「联系人可暂停你的播放」权限开关——关闭时彻底不触发，步进器置灰
    const syncPauseEn = function () {
      const box = document.getElementById('sm-set-pauseprob');
      if (box) box.style.opacity = settings.taPauseEn ? '' : '0.4';
      const valEl = document.getElementById('sm-set-pauseprob-val');
      if (valEl) valEl.style.pointerEvents = settings.taPauseEn ? '' : 'none';
    };
    const pauseEnCb = document.getElementById('sm-set-pause-en');
    if (pauseEnCb) {
      pauseEnCb.addEventListener('change', () => {
        settings.taPauseEn = pauseEnCb.checked;
        saveSettings();
        syncPauseEn();
      });
    }
    syncPauseEn();
    const cool = document.getElementById('sm-set-cool');
    if (cool) cool.addEventListener('change', () => { settings.cooldownMs = Number(cool.value); saveSettings(); });
    const floatCb = document.getElementById('sm-set-float');
    if (floatCb) floatCb.addEventListener('change', () => { settings.floatEn = floatCb.checked; floatHideByWidget = false; saveSettings(); syncFloatToggle(); renderFloat(); });
    const wcov = document.getElementById('sm-set-wcov');
    if (wcov) wcov.addEventListener('change', () => {
      settings.widgetCoverMode = wcov.value;
      saveSettings();
      const m = findTrack(currentId);
      if (m) setWidgetCover(m);
    });
  }

  // ================= 桌面小部件联动 =================
  function bindWidget() {
    const playBtn = document.getElementById('mw-play');
    const prevBtn = document.getElementById('mw-prev');
    const nextBtn = document.getElementById('mw-next');
    const heartBtn = document.getElementById('mw-heart');
    const modeBtn = document.getElementById('mw-mode');
    const queueBtn = document.getElementById('mw-queue');
    const bar = document.getElementById('mw-bar');
    const fill = document.getElementById('mw-fill');
    const knob = document.getElementById('mw-knob');
    const curEl = document.getElementById('mw-cur');
    const durEl = document.getElementById('mw-dur');
    if (playBtn) playBtn.addEventListener('click', () => toggle(true));
    if (modeBtn) modeBtn.addEventListener('click', cycleMode);
    if (queueBtn) queueBtn.addEventListener('click', openQueuePanel);
    if (prevBtn) prevBtn.addEventListener('click', () => prev(true));
    if (nextBtn) nextBtn.addEventListener('click', () => next(true));
    if (heartBtn) {
      heartBtn.addEventListener('click', () => {
        const m = findTrack(currentId);
        if (!m) { toast('请先播放一首歌'); return; }
        const liked = toggleFav(m.id);
        toast(liked ? '已收藏' : '已取消收藏');
      });
      syncHeartIcons();
    }
    // 悬浮小框收藏按钮
    const fHeart = document.getElementById('sm-f-heart');
    if (fHeart) {
      fHeart.addEventListener('click', () => {
        const m = findTrack(currentId);
        if (!m) { toast('请先播放一首歌'); return; }
        const liked = toggleFav(m.id);
        toast(liked ? '已收藏' : '已取消收藏');
      });
    }
    // 音乐页底部播放栏收藏按钮（v3.5.64）
    const pbHeart = document.getElementById('sm-pb-heart');
    if (pbHeart) {
      pbHeart.addEventListener('click', () => {
        const m = findTrack(currentId);
        if (!m) { toast('请先播放一首歌'); return; }
        const liked = toggleFav(m.id);
        toast(liked ? '已收藏' : '已取消收藏');
      });
      syncHeartIcons();
    }
    // 桌面进度条
    if (bar) {
      bar.addEventListener('click', (e) => {
        if (!audio || !audio.duration) return;
        const r = bar.getBoundingClientRect();
        audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
      });
    }
    if (fill && curEl && durEl && knob) {
      const iv = setInterval(() => {
        if (!audio || !audio.duration) return;
        const pct = audio.currentTime / audio.duration * 100;
        fill.style.width = pct + '%';
        knob.style.left = pct + '%';
        curEl.textContent = fmtDur(audio.currentTime);
        durEl.textContent = fmtDur(audio.duration);
      }, 500);
      window._mwProgressTimer = iv;
    }
    // 初始状态
    const wSong = document.getElementById('mw-song');
    if (wSong && !currentId) wSong.textContent = '未在播放';
    const wArtist = document.getElementById('mw-artist');
    if (wArtist && !currentId) wArtist.textContent = '音乐';
  }

  // ================= 页面入口 =================
  const musicApp = document.querySelector('.app[data-app="music"]');
  const musicPage = document.getElementById('page-music');
  if (musicApp && musicPage) {
    musicApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      musicPage.hidden = false;
      renderPage();
      // v3.9.x：打开音乐页时补探测缺失时长（覆盖本版本之前导入、时长还是 00:00 的旧歌曲）
      probeAllMissingDurations();
      // v3.9.x：顺带补历史导入歌曲的封面（网易云单曲链接添加的旧数据没有封面）
      ensureMissingCovers();
    });
  }
  const musicBack = document.getElementById('music-back');
  if (musicBack) {
    musicBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-phone');
      if (home) home.hidden = false;
    });
  }
  // tab 切换
  document.querySelectorAll('#page-music .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      curTab = tab.dataset.mtab;
      document.querySelectorAll('#page-music .fav-tab').forEach(x => x.classList.toggle('sel', x === tab));
      document.querySelectorAll('#page-music .cal-card').forEach(c => { c.hidden = c.dataset.mpanel !== curTab; });
      if (curTab === 'pl') renderPlaylists();
      if (curTab === 'fav') renderFavList();
      if (curTab === 'favta') renderTaFavList();
      if (curTab === 'his') renderHistory();
    });
  });
  // 按钮
  const upBtn = document.getElementById('music-upload');
  if (upBtn) upBtn.addEventListener('click', triggerUpload);
  const urlBtn = document.getElementById('music-add-url');
  if (urlBtn) urlBtn.addEventListener('click', openAddUrl);
  const batchBtn = document.getElementById('music-batch');
  if (batchBtn) batchBtn.addEventListener('click', openBatch);
  const batchMgmt = document.getElementById('music-batch-manage');
  if (batchMgmt) batchMgmt.addEventListener('click', () => { if (musicBatch) exitBatch(); else enterBatch(); });
  const vipClean = document.getElementById('music-vip-clean');
  if (vipClean) vipClean.addEventListener('click', openVipClean);
  const setBtn = document.getElementById('music-set');
  if (setBtn) setBtn.addEventListener('click', openSettings);
  // 播放器控制
  const playBtn = document.getElementById('sm-play');
  if (playBtn) playBtn.addEventListener('click', () => toggle());
  const modeBtn = document.getElementById('sm-mode');
  if (modeBtn) modeBtn.addEventListener('click', cycleMode);
  const fModeBtn = document.getElementById('sm-f-mode');
  if (fModeBtn) fModeBtn.addEventListener('click', cycleMode);
  const prevBtn = document.getElementById('sm-prev');
  if (prevBtn) prevBtn.addEventListener('click', () => prev());
  const nextBtn = document.getElementById('sm-next');
  if (nextBtn) nextBtn.addEventListener('click', () => next());
  const queueBtn = document.getElementById('sm-queue');
  if (queueBtn) queueBtn.addEventListener('click', openQueuePanel);
  // 悬浮小框控制
  const fPlay = document.getElementById('sm-f-play');
  if (fPlay) fPlay.addEventListener('click', () => toggle());
  const fPrev = document.getElementById('sm-f-prev');
  if (fPrev) fPrev.addEventListener('click', () => prev());
  const fNext = document.getElementById('sm-f-next');
  if (fNext) fNext.addEventListener('click', () => next());
  const fQueue = document.getElementById('sm-f-queue');
  if (fQueue) fQueue.addEventListener('click', openQueuePanel);
  // 悬浮小框 收起/展开（新版多行 ⇄ 最初版最小单行）
  const fCollapse = document.getElementById('sm-f-collapse');
  if (fCollapse) fCollapse.addEventListener('click', toggleFloatMin);
  const fMiniExpand = document.getElementById('sm-f-mini-expand');
  if (fMiniExpand) fMiniExpand.addEventListener('click', toggleFloatMin);
  const fMiniPlay = document.getElementById('sm-f-mini-play');
  if (fMiniPlay) fMiniPlay.addEventListener('click', () => toggle());
  const fToggle = document.getElementById('music-float-en');
  if (fToggle) {
    fToggle.addEventListener('change', () => {
      settings.floatEn = fToggle.checked;
      floatClosed = false;
      floatHideByWidget = false; // 用户显式操作悬浮小窗开关 → 清除小组件抑制
      saveSettings();
      renderFloat();
    });
  }

  // ================= 初始化 =================
  // v3.9.x：loadAll 必须在 IndexedDB 回填完成后执行——music-library 可能是大键
  //（导入大量网易云歌单后 JSON >200KB）只进 IDB 不进 localStorage；若 loadAll 先于
  // idbRestore 执行，读到空会触发种子自愈并 saveLibrary 覆盖 IDB，导入的歌单刷新
  // 后永久丢失。故推迟到数据就绪（__mochiDataReady / mochi-restore-done）后再加载。
  function bootMusic() {
    loadAll();
    // 迁移：默认歌单里旧版占位名（网易云音乐-xxxx）→ 已知歌名/封面，其余异步识别；
    // 删除默认歌单第四首（28815250），第三首（2064961530）保留并异步识别歌名
    {
      const known = { 2613048732: { name: 'Moonlit Dream', artist: 'DLSS · shell（月光梦）', cover: 'https://p2.music.126.net/cXuoNwFzgFoQF7bGvC2mIQ==/109951169832660411.jpg' }, 27538343: { name: 'Baby', artist: 'EXO-K', cover: '' } };
      let changed = false;
      const before = library.length;
      library = library.filter(m => !(m.playlistId === 'spl_default' && (m.neteaseId === '28815250' || m.neteaseId === '2064961530')));
      if (library.length !== before) changed = true;
      library.forEach(m => {
        if (m.playlistId === 'spl_default' && m.neteaseId) {
          const k = known[m.neteaseId];
          if (k && (!m.name || m.name.indexOf('网易云音乐-') === 0)) {
            m.name = k.name; m.artist = k.artist; changed = true;
          }
          if (k && k.cover && !m.cover) { m.cover = k.cover; changed = true; }
        }
      });
      if (changed) saveLibrary();
      // 仍为占位名的默认歌单歌曲：异步识别
      library.forEach(m => {
        if (m.playlistId === 'spl_default' && m.neteaseId && m.name && m.name.indexOf('网易云音乐-') === 0) {
          fetchNeteaseInfo(String(m.neteaseId), (info) => {
            const mm = findTrack(m.id);
            if (mm && info && info.name) {
              mm.name = info.name;
              if (info.artist) mm.artist = info.artist;
              if (info.duration && !mm.duration) mm.duration = info.duration;
              saveLibrary();
              renderPage();
            }
          });
        }
      });
    }
    renderPage();
    // v3.9.x：对缺时长的网易云歌补探测——已导入的旧歌单 duration=0 已存库，
    // 仅修 referrerPolicy 不重新导入不会补；启动时后台探测，修后能成功并刷新 UI
    probeAllMissingDurations();
  }
  setupFloatDrag();
  bindWidget();
  if (window.__mochiDataReady) {
    bootMusic();
  } else {
    document.addEventListener('mochi-restore-done', function h() {
      document.removeEventListener('mochi-restore-done', h);
      bootMusic();
    });
  }

  // v3.9.x：音乐数据全局共享 default 桌面，切联系人无需 loadAll（数据不变）。
  // 播放跨桌面延续（v3.25.x：不再因切桌面停歌——旧逻辑按桌面隔离音乐，库合并后停歌已无必要）；
  // 仅重置 TA 互动状态（旧桌面的互动不带到新桌面）
  document.addEventListener('contact-switched', function () {
    try {
      // 多桌面：TA 互动状态是模块级，残留会让新桌面误以为 TA 在一起听/冷却中/有待确认请求
      taActive = false;
      cooldownAt = 0;
      reqData = null;
      libFilter = 'all';
      libRenderShown = LIB_RENDER_LIMIT; // 切联系人时重置窗口化渲染计数
      // v3.14.x：取消待判定的联系人收藏（旧桌面的歌不带到新桌面）
      clearTaFavTimer();
      try { renderFloat(); } catch (e) {}
      try { syncTaFavTab(); renderTaFavList(); } catch (e) {}
    } catch (e) {}
  });
})();
