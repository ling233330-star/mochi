// ===== v3.26.x #935：电量消耗自测 + 发烫自测（设置→工具 两行自接线；用户直派
//   「帮我在工具里新增一个电量消耗自测和发烫自测…用来检查异常」）=====
// 两个自测都不改任何业务数据、不写业务键，只产出可复制/导出的报告（同「卡顿自检」
// 「设备兼容诊断」口径）；长窗口自测的记录只存聚合量，不随时长膨胀。
//
// ① 电量消耗自测（#row-battery-check）：Battery Status API 分段实测掉电速率——前台使用段 /
//    后台段（页面仍在跑）/ 未运行段（有重开·被回收证据＝当时确实没在跑）/ 不确定段（#947：心跳停了，
//    但"被系统冻结"与"被内核节流"两种归因相反，不替系统猜）分开算 %/小时；充电段整体剔除
//    （充电中电量不降反升，混进来＝把耗电算成 0）。各段掉电以「非充电时段有符号净掉电」为上限等比
//    折算（#947）：电量计只有 1% 颗粒度且会抖，只记单边下降能把 95%→95% 报成几十 %/小时。
//    15 分钟~过夜长窗口，中途刷新/被系统杀进程重开都续测（run 记录持久化在
//    xy-home-v2:battery-check-run），跑完页面不可见则回前台补弹一次报告（能开着去忙别的，是这个自测
//    可用的前提）；关页重开这条路没有 visibilitychange，boot 时同样补弹（#947）。
//    iPhone/Safari 全系没有这个接口——特性检测如实告知能力边界并给替代路径，不写机型分支。
// ② 发烫自测（#row-heat-check）：浏览器读不到手机温度（全平台没有温度接口）——只能测
//    「发烫的后果」：先静置 3 秒量基准帧率，再持续跑固定工作量（切片 60ms、首片现场校准，
//    各机型/各内核同一口径、零机型分支），最后再静置 3 秒看帧率恢复；判级看整窗趋势
//    （6 段中位）与首尾 10% 中位：系统因发热限频时，同样的活会越干越慢。≥25% 判「明显降频」、
//    10~25%「轻度」、<10%「未见降频」；附帧率、电池状态与发热因素清单。
//    （低电量/省电模式同样会降频，报告里点名对照。）
// #1015（2026-09-22 用户直派「电量消耗自测 闪屏自测 发烫自测…功能测试时间太短，并且还能怎么优化」）：
//    时长从写死的 10 秒放开到 10 秒~5 分钟档、UI 默认 3 分钟——手机从冷到热要 1 分钟以上，
//    10 秒的负载只能答「此刻有没有被限速」，答不了「越跑越慢」；实现见下方 ② 段顶部说明。
(function () {
  'use strict';
  if (window.mochiEnergyCheck) return;

  var BAT_LAST_KEY = 'xy-home-v2:battery-check-last';
  var HEAT_LAST_KEY = 'xy-home-v2:heat-check-last';
  var BAT_RUN_KEY = 'xy-home-v2:battery-check-run';
  var CALL_KEY = 'xy-home-v2:call-active';
  var BAT_MIN_MS = 10000;           // 下限 10 秒（无头验证/快速复核；UI 档位最小 15 分钟）
  var BAT_MAX_MS = 8 * 3600 * 1000; // 上限 8 小时（过夜档）
  var SAMPLE_MIN = 2000, SAMPLE_MAX = 30000;
  var SEG_MIN_MS = 5 * 60 * 1000;   // 单段 ≥5 分钟才进结论；不足 5 分钟只给「粗测」值
  var SEG_SHOW_MS = 10000;          // 单段 <10 秒不给数字（样本太少，纯噪声）
  var FG_WARN = 18, FG_BAD = 35;    // 前台使用 %/小时 参考带
  var BG_WARN = 3, BG_BAD = 8;      // 后台段（页面仍在跑）%/小时 参考带
  var GAP_WARN = 2, GAP_BAD = 6;    // 未运行段（页面没在跑）参考带——只作对照，不进结论
  // #1015 发烫自测：时长可选（UI 默认 3 分钟）。原先写死「10 轮 ×700ms ≈ 10 秒」——
  // 手机从冷到热要 1 分钟以上，10 秒只能答「此刻有没有被限速」；档位放开后负载改切片（见下）。
  var HEAT_DURS = { '10': 10000, '60': 60000, '180': 180000, '300': 300000 };
  var HEAT_API_MS = 10000;          // 模块 API 不传时长时按 10 秒跑（无头验证/快速复核；UI 永远显式传档位）
  var HEAT_IDLE_MS = 3000;          // 负载前静置：量基准帧率
  var HEAT_TAIL_MS = 3000;          // 负载后静置：量恢复帧率（同一台机器前后对照）
  var HEAT_SLICE_MS = 60;           // 每片固定工作量（首片现场校准到 ~60ms）
  var HEAT_WARMUP = 5;              // 前 5 片只作 JIT 预热，不进统计
  var HEAT_MIN_JUDGE_MS = 60000;    // 负载不足 60 秒只算快测（热不起来，判不了「越跑越慢」）
  var HEAT_BINS = 6;                // 趋势分箱数
  var HEAT_TICK_MS = 500;           // 进度浮条刷新间隔（3 分钟窗口下每 0.5 秒一次足够）
  var HEAT_PILLS = [{ label: '10 秒·快测', value: '10' }, { label: '1 分钟', value: '60' }, { label: '3 分钟', value: '180' }, { label: '5 分钟', value: '300' }];
  var SLOW_BAD = 0.25, SLOW_MILD = 0.10; // 末段比开头慢的判定阈值（发热降频的共用阈值）
  var BAT_DURS = { '15': 900000, '30': 1800000, '60': 3600000, '180': 10800000, '480': 28800000 };
  // #1015：UI 默认档从 30 分钟提到 1 小时——工具自己的报告就写着「15 分钟档只能看趋势、1 小时以上
  // 才有参考价值」，默认却停在 30 分钟档＝默认值本身给不出可用的数字（电量计只有 1% 一格）。
  // 短档照旧可选（想快看趋势就用），但弹窗里按 #908 的红字警示把「短档只能看趋势」讲在前面。
  var BAT_PILLS = [{ label: '15 分钟·粗测', value: '15' }, { label: '30 分钟·粗测', value: '30' }, { label: '1 小时', value: '60' }, { label: '3 小时', value: '180' }, { label: '过夜 8 小时', value: '480' }];
  var BAT_REF_MS = 3600000;         // 不足 1 小时的窗口：结论里标明「属粗测」
  var SEG_COARSE_MS = 15 * 60 * 1000; // 单段 5~15 分钟也标粗测（旧版只把 <5 分钟标粗测，6 分钟的段看着和 1 小时的段一样正式）
  var _heatSink = 1;                // 见下方 ②（原先与 _heatRunning 同声明，本批拆开）

  // ---------- 小工具 ----------
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function mins(ms) {
    var m = Math.round(Math.max(0, ms) / 60000);
    if (m < 60) return m + ' 分钟';
    var h = Math.round(m / 6) / 10;
    return (h % 1 === 0 ? h : h.toFixed(1)) + ' 小时';
  }
  function leftTxt(run) { return mins(run.t0 + run.ms - Date.now()); }
  function rate(drop, ms) { return ms > 0 ? Math.round(drop / (ms / 3600000) * 10) / 10 : 0; }
  function bandOf(r, warn, bad) { return r >= bad ? '异常' : (r >= warn ? '偏高' : '正常'); }
  function med(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dtTxt(ts) {
    try { var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    catch (e) { return ''; }
  }
  function callActive() {
    try {
      var raw = sessionStorage.getItem(CALL_KEY) || localStorage.getItem(CALL_KEY);
      var info = raw ? JSON.parse(raw) : null;
      return !!(info && info.status && info.status !== 'ended' && info.ts && (Date.now() - info.ts) < 90000);
    } catch (e) { return false; }
  }
  // 发热/耗电相关因素清单（保活探针由 bg-keep.js 暴露；旧产物无探针时如实说读取不到）
  function factorLines() {
    var out = [];
    var ka = null;
    try { ka = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null; } catch (e) { ka = null; }
    if (ka) {
      out.push('后台保活=' + (ka.keep ? '开（页面在后台持续运行，最常见的耗电/发热源）' : '关'));
      out.push('后台通知=' + (ka.notify ? '开' : '关'));
      var mu = ka.music || null;
      var playing = !!(mu && (mu.strict || (mu.flag && mu.paused === false)));
      out.push('音乐=' + (playing ? '播放中（持续放音＝正常发热源）' : '未播放'));
    } else {
      out.push('保活/通知状态：未能读取（页面较早版本或被裁剪）');
    }
    out.push('通话=' + (callActive() ? '通话中（持续放音＝正常发热源）' : '不在通话'));
    return out;
  }
  function battLine(bm) {
    if (!bm) return null;
    try { return Math.round(Number(bm.level) * 100) + '% · ' + (bm.charging ? '充电中' : '未充电'); } catch (e) { return null; }
  }
  function getBm() {
    // 特性检测（零机型分支）：有接口就返回，没有/被拒就 null
    return new Promise(function (resolve) {
      try {
        if (typeof navigator.getBattery !== 'function') return resolve(null);
        navigator.getBattery().then(function (bm) { resolve(bm || null); }, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }
  // #947：内核（Chromium 系）告知「这个标签页被系统丢弃过、刚才是重载回来的」；没有这个属性的内核
  // 取到 undefined＝当作没有证据，走保守分支，不写机型判断。
  function wasDiscarded() { try { return !!document.wasDiscarded; } catch (e) { return false; } }
  // #947：心跳停摆（一个采样间隔没接上）有两种归因**相反**的可能——页面被系统冻结/关掉（那段掉电与
  // 本站无关），或内核把后台标签的定时器节流到分钟级（那段恰恰就是本站在后台跑的开销）。旧实现一律
  // 归前者，于是安卓后台常见的 60 秒节流被整段划进「与本站无关」的对照组：既低估本站耗电，又给用户
  // 一张「不关本站事」的假清白报告。现在只在拿得到真证据时归未运行段，其余进「不确定」段单独列。
  function stalledSeg(run) {
    if (run.lastSt === 'chg') return 'chg'; // 充电段本整段剔除，不必猜原因
    if (_freshReload || wasDiscarded() || run.lastSt === 'fg') return 'gap';
    return 'unk';
  }

  // ---------- 报告弹窗（复制/导出，同卡顿自检 #884 口径） ----------
  function reportModal(title, rep, expPrefix, shareTitle, okLabel, onOk) {
    if (!window.openModal) return;
    var ctl = window.openModal(title, rep.text, function () { if (typeof onOk === 'function') onOk(); }, {
      noInput: true, textarea: true, textareaRows: 16, big: true,
      staticText: '报告只在本机采样、不上传；可【复制】或【导出docx】发给开发者。',
      copyBtn: {
        label: '复制',
        fn: function (c) {
          var txt = c ? c.text() : rep.text;
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
          var txt = c ? c.text() : rep.text;
          if (typeof window.mochiDiagExportDocx === 'function') window.mochiDiagExportDocx(txt, expPrefix, null, null, shareTitle);
          else if (c && c.hint) c.hint('导出组件未就绪，请用【复制】或长按手选复制');
        }
      }
    });
    try { if (ctl && ctl.okText) ctl.okText(okLabel || '再测一次'); } catch (e) {}
  }
  // 跑完时页面不可见＝报告挂起（写 pending，回前台补弹一次）；可见＝直接弹
  function deliver(kind, rep) {
    var key = kind === 'battery' ? BAT_LAST_KEY : HEAT_LAST_KEY;
    if (document.hidden) {
      var last = lsGet(key, null) || {};
      last.pending = 1; last.text = rep.text; last.t = rep.t; last.verdict = rep.verdict;
      lsSet(key, last);
      return;
    }
    popReport(kind, rep);
  }
  function popReport(kind, rep) {
    if (kind === 'battery') reportModal('电量消耗自测报告', rep, 'mochi-batterycheck-', 'mochi 电量消耗自测报告', '再测一次', askBattery);
    else reportModal('发烫自测报告', rep, 'mochi-heatcheck-', 'mochi 发烫自测报告', '再测一次', runHeatUI);
  }
  function popPending() {
    if (document.hidden) return;
    var lb = lsGet(BAT_LAST_KEY, null);
    if (lb && lb.pending && lb.text) { lb.pending = 0; lsSet(BAT_LAST_KEY, lb); updateBatSub(); popReport('battery', { text: lb.text, verdict: lb.verdict, t: lb.t }); return; }
    var lh = lsGet(HEAT_LAST_KEY, null);
    if (lh && lh.pending && lh.text) { lh.pending = 0; lsSet(HEAT_LAST_KEY, lh); updateHeatSub(); popReport('heat', { text: lh.text, verdict: lh.verdict, t: lh.t }); }
  }
  function splashGone() {
    var el = null;
    try { el = document.querySelector('.splash'); } catch (e) {}
    return !el || el.classList.contains('hide');
  }
  // #947：挂起的报告此前只挂在 visibilitychange 上——用户跑完直接把页面关掉（手机上等于必然路径：
  // 后台自测跑完→切走→杀进程），下次打开本站根本不会再触发这个事件，报告就永久烂在 pending 里
  // （行小字只有一行结论，全文再也看不到）。重开页面也要补弹一次；开屏强读页还在场时先等它离场，
  // 别让报告压在公告上（那样用户只能关掉它，等于又丢一次）。
  function popPendingAtBoot() {
    var tries = 0;
    (function poll() {
      if (splashGone()) { popPending(); return; }
      if (++tries > 600) return; // 用户一直停在开屏＝不打扰，pending 留着下次再补
      setTimeout(poll, 500);
    })();
  }

  // ---------- 进度浮条（同 #905/#906 卡顿自测顶部胶囊） ----------
  var barEl = null, barTimer = null;
  function bar(txt, autoHideMs) {
    try {
      if (!barEl) {
        barEl = document.createElement('div');
        barEl.id = 'energy-check-bar';
        barEl.style.cssText = 'position:fixed;top:max(14px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);max-width:88%;z-index:99999;background:rgba(18,18,28,.94);color:#fff;padding:8px 14px;border-radius:999px;font-size:12px;line-height:1.45;text-align:center;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        document.body.appendChild(barEl);
      }
      barEl.textContent = txt;
      if (barTimer) { clearTimeout(barTimer); barTimer = null; }
      if (autoHideMs) barTimer = setTimeout(hideBar, autoHideMs);
    } catch (e) {}
  }
  function hideBar() { try { if (barEl && barEl.parentNode) barEl.parentNode.removeChild(barEl); } catch (e) {} barEl = null; if (barTimer) { clearTimeout(barTimer); barTimer = null; } }

  // ========== ① 电量消耗自测 ==========
  var _batRun = null, _batTimer = null, _batBm = null, _batResolve = null, _batTick = null, _batStarting = false, _freshReload = false;

  function writeRun(run) { lsSet(BAT_RUN_KEY, run); }
  function stopBatTimer() { if (_batTimer) { clearInterval(_batTimer); _batTimer = null; } }

  function createRun(bm, ms) {
    var now = Date.now();
    var lv = 0;
    try { lv = Number(bm.level) || 0; } catch (e) {}
    return {
      t0: now, ms: ms, iv: clamp(Math.round(ms / 40), SAMPLE_MIN, SAMPLE_MAX),
      last: now, lastLv: lv, lastSt: (bm.charging ? 'chg' : (document.hidden ? 'bg' : 'fg')),
      fgMs: 0, bgMs: 0, gapMs: 0, unkMs: 0, chgMs: 0, fgDrop: 0, bgDrop: 0, gapDrop: 0, unkDrop: 0, net: 0,
      lv0: lv, lvEnd: lv, n: 0
    };
  }
  // 单次采样：把「上一段」的时长与掉电量按采样时刻的实际状态归档（充电段整段剔除）
  function sampleOnce(run, bm) {
    var lv;
    try { lv = Number(bm.level); } catch (e) { return; }
    if (!isFinite(lv)) return;
    var ch = false;
    try { ch = !!bm.charging; } catch (e) {}
    var now = Date.now();
    var dt = now - run.last;
    if (dt < 500) return; // 定时器与 visibilitychange 撞上时的重复采样，跳过
    var dLv = (run.lastLv - lv) * 100; // 电量百分点（下降为正；回升为负，只进 net 不进各段掉电）
    var st = (dt > run.iv * 2.5) ? stalledSeg(run) : run.lastSt;
    if (st === 'chg') { run.chgMs += dt; }
    else {
      // #947：电量计只有 1% 颗粒度且会抖（掉一格又回一格）。各段只累计「下降」，抖动就被单边加成
      // 几十 %/小时的虚高耗电——实测过 95%→95%（净掉电 0）却报出后台 58.1%/小时。这里同时记一份
      // 有符号净掉电 net，结算时用它给三段封顶（净掉电才是这段窗口真正花掉的电）。
      run.net += dLv;
      if (st === 'unk') { run.unkMs += dt; if (dLv > 0) run.unkDrop += dLv; }
      else if (st === 'gap') { run.gapMs += dt; if (dLv > 0) run.gapDrop += dLv; }
      else if (st === 'bg') { run.bgMs += dt; if (dLv > 0) run.bgDrop += dLv; }
      else { run.fgMs += dt; if (dLv > 0) run.fgDrop += dLv; }
    }
    run.last = now; run.lastLv = lv; run.lvEnd = lv; run.n++;
    run.lastSt = ch ? 'chg' : (document.hidden ? 'bg' : 'fg');
    _freshReload = false; // 停摆证据只在重开后的第一个采样有用
  }
  function batTick() {
    var r = _batRun;
    if (!r) return;
    if (_batBm) { try { sampleOnce(r, _batBm); } catch (e) {} }
    writeRun(r);
    if (Date.now() >= r.t0 + r.ms) { endBatRun(); return; }
    if (typeof _batTick === 'function') _batTick({ left: Math.max(0, Math.ceil((r.t0 + r.ms - Date.now()) / 1000)), fgMin: Math.round(r.fgMs / 60000), bgMin: Math.round(r.bgMs / 60000) });
    updateBatSub();
  }
  function startBatLoop(run) {
    stopBatTimer();
    _batTimer = setInterval(batTick, run.iv);
  }
  function endBatRun() {
    var run = _batRun;
    if (!run) return null;
    _batRun = null; stopBatTimer(); _batBm = null; _batTick = null;
    lsDel(BAT_RUN_KEY);
    var rep = buildBat(run);
    var last = lsGet(BAT_LAST_KEY, null) || {};
    last.t = rep.t; last.verdict = rep.verdict; last.rateTxt = rep.rateTxt; last.text = rep.text; last.pending = 0;
    lsSet(BAT_LAST_KEY, last);
    updateBatSub();
    if (typeof _batResolve === 'function') { var f = _batResolve; _batResolve = null; f(rep); }
    else deliver('battery', rep); // 续测路径没有 promise 挂靠，由模块自己交付（可见即弹、不可见挂起）
    return rep;
  }
  function startBattery(ms, onTick) {
    return new Promise(function (resolve) {
      if (_batRun || _batStarting) return resolve(null);
      ms = clamp(Number(ms) || BAT_DURS['30'], BAT_MIN_MS, BAT_MAX_MS);
      _batStarting = true;
      getBm().then(function (bm) {
        _batStarting = false;
        if (!bm) return resolve(batUnsupported());
        _batBm = bm;
        _batTick = typeof onTick === 'function' ? onTick : null;
        _batRun = createRun(bm, ms);
        _batResolve = resolve;
        writeRun(_batRun);
        startBatLoop(_batRun);
        updateBatSub();
      });
    });
  }
  function segTxt(name, ms, drop, warn, bad) {
    if (ms < SEG_SHOW_MS) return null;
    var rt = rate(drop, ms);
    // #1015：粗测档从「<5 分钟」放宽到「<15 分钟」——5~15 分钟的段此前既给不出正式参考带的口径，
    // 又和 1 小时的段长得一模一样，用户会拿它当结论（1% 颗粒度下 6 分钟的段误差本来就极大）。
    var tier = ms < SEG_MIN_MS ? '不足 5 分钟' : (ms < SEG_COARSE_MS ? '不足 15 分钟' : '');
    return '· ' + name + '：约 ' + rt + '%/小时' + (tier
      ? '（' + tier + '，粗测、仅供参考）'
      : '（参考：≤' + warn + ' 正常 / ' + warn + '~' + bad + ' 偏高 / >' + bad + ' 异常）');
  }
  function batUnsupported() {
    var rep = { t: Date.now(), verdict: '测不了', text: '' };
    rep.text = [
      '结论：本机浏览器不提供电量接口，测不了（不是应用坏了）',
      '说明：电量自测依赖浏览器提供的 Battery 状态接口（navigator.getBattery）。iPhone / iPad 的 Safari 全系没有这个接口（系统限制），部分国产浏览器也没有——换安卓 Chrome / Edge 系打开本站即可测。',
      '替代路径：iPhone 可到 系统设置 → 电池 看「过去 24 小时」各应用耗电与屏幕时间，对照本站在其中的占比；安卓多数浏览器（Chrome / Edge 系）支持本自测。',
      '· 旁边「发烫自测」不依赖电量接口，任何设备都能跑，可以先测那个。',
      '',
      '（本报告只在本机生成、不上传任何数据）'
    ].join('\n');
    lsSet(BAT_LAST_KEY, { t: rep.t, verdict: rep.verdict, rateTxt: '', text: rep.text, pending: 0 });
    updateBatSub();
    return rep;
  }
  function buildBat(run) {
    var L = [];
    var unkMs = run.unkMs || 0;
    var totalMs = run.fgMs + run.bgMs + run.gapMs + unkMs;
    var wallMs = totalMs + run.chgMs;
    var avgIv = run.n > 0 ? wallMs / run.n : 0;
    // #947 抖动封顶：三段各自「只记下降」的毛和会把电量计的回升也当成本段掉电（净掉 0 格同样能算出
    // 几十 %/小时）。按非充电时段的有符号净掉电等比缩到净值为上限——各段速率之和恒等于实测净掉电。
    // 旧版本的 run 记录没有 net 字段＝不封顶（把 undefined 当 0 会把真测到的一窗抹平）。
    var fgD = run.fgDrop, bgD = run.bgDrop, gapD = run.gapDrop, unkD = run.unkDrop || 0;
    var gross = fgD + bgD + gapD + unkD;
    var hasNet = typeof run.net === 'number';
    var net = hasNet ? run.net : 0;
    var jitter = 0;
    // 净掉电为负（电量计整体回升）＝allow 取 0，各段掉电全折算为 0：这才是实情
    if (hasNet && gross > net + 0.001) {
      var allow = Math.max(0, net);
      var k = allow / gross;
      jitter = gross - allow;
      fgD *= k; bgD *= k; gapD *= k; unkD *= k;
    }
    var rFg = rate(fgD, run.fgMs), rBg = rate(bgD, run.bgMs);
    var cands = [];
    if (run.fgMs >= SEG_MIN_MS) cands.push({ n: '前台使用', r: rFg, b: bandOf(rFg, FG_WARN, FG_BAD) });
    if (run.bgMs >= SEG_MIN_MS) cands.push({ n: '后台页面自身', r: rBg, b: bandOf(rBg, BG_WARN, BG_BAD) });
    var order = { '正常': 0, '偏高': 1, '异常': 2 };
    var worst = null;
    cands.forEach(function (c) { if (!worst || order[c.b] > order[worst.b]) worst = c; });
    var verdict = worst ? worst.b : '数据不足';
    var rateTxt = worst ? (worst.n + ' ' + worst.r + '%/小时') : '';
    // #1015：窗口不足 1 小时在这里点明「属粗测」——结论行只加后缀，不动开头（开头恒为「结论：<判级>」，
    // 报告口径与既有解析都靠这个形状）。
    L.push('结论：' + verdict + (worst ? '（' + worst.n + '约 ' + worst.r + '%/小时）' : totalMs < SEG_MIN_MS ? '（窗口太短/掉电小于 1%，看下方粗测值）' : '（各段样本都不足 5 分钟，看下方粗测值）') + (totalMs < BAT_REF_MS ? '· 窗口不足 1 小时，属粗测' : ''));
    L.push('窗口 ' + mins(totalMs) + '：前台 ' + mins(run.fgMs) + ' / 后台（页面仍在跑）' + mins(run.bgMs) + ' / 页面未运行 ' + mins(run.gapMs) + (unkMs > 0 ? ' / 不确定 ' + mins(unkMs) : '') + (run.chgMs > 0 ? ' / 充电中 ' + mins(run.chgMs) : ''));
    L.push('电量 ' + Math.round(run.lv0 * 100) + '% → ' + Math.round(run.lvEnd * 100) + '%（采样 ' + run.n + ' 次，设计每 ' + Math.round(run.iv / 1000) + ' 秒、实测平均每 ' + Math.round(avgIv / 1000) + ' 秒）');
    if (jitter > 0) L.push('· 电量计抖动 ' + (Math.round(jitter * 10) / 10) + ' 个百分点（掉了又回升），下方各段速率已按实测净掉电 ' + (Math.round(Math.max(0, net) * 10) / 10) + '% 等比折算');
    var s1 = segTxt('前台使用（屏幕亮着用本站）', run.fgMs, fgD, FG_WARN, FG_BAD);
    if (s1) L.push(s1);
    var s2 = segTxt('后台页面自身（切出去了、页面还在跑，多与「后台保活」相关）', run.bgMs, bgD, BG_WARN, BG_BAD);
    if (s2) L.push(s2);
    var s3 = segTxt('页面未运行（有重开/被回收的证据，本站当时没在跑）', run.gapMs, gapD, GAP_WARN, GAP_BAD);
    if (s3) L.push(s3 + '——这段掉电与本站无关，只作对照');
    var s4 = segTxt('不确定（心跳停了，分不清是被系统冻结还是被内核节流）', unkMs, unkD, GAP_WARN, GAP_BAD);
    if (s4) L.push(s4 + '——两种归因方向相反，本工具不替系统猜：这段不计入结论，也不并进上面「与本站无关」的对照段');
    if (avgIv > run.iv * 2) L.push('· 心跳被限制：设计每 ' + Math.round(run.iv / 1000) + ' 秒一次、实测平均每 ' + Math.round(avgIv / 1000) + ' 秒一次——内核把本页面的定时器节流了（切后台/省电模式下常见），采样越稀分段越不可信');
    if (run.chgMs > 0) L.push('· 充电中 ' + mins(run.chgMs) + '：整段剔除不计（充电时电量不降反升，混进来会把耗电算成 0）');
    L.push('· 电量颗粒度是 1%：窗口越短数字越粗，15 分钟档只能看趋势，1 小时以上才有参考价值，夜里放着跑（过夜档）最准');
    L.push('· 发热/耗电相关因素：' + factorLines().join('；'));
    L.push('');
    L.push('建议：');
    var adv = [];
    if (verdict === '异常') adv.push('耗电明显偏高：先到 设置→系统 关掉「后台保活」再跑一轮对照（后台段速率应明显下降）；若前台段也异常，把本报告 + 设置→工具→「设备兼容诊断」的环境信息一起发给开发者');
    else if (verdict === '偏高') adv.push('偏高：对照系统设置里的电池统计（过去 24 小时本站占比）一起看；不用后台通知时把「后台保活」关掉再复测一轮，对比后台段速率');
    if (run.bgMs >= SEG_MIN_MS && bgD > 0) adv.push('后台段有 ' + rBg + '%/小时：这段就是「页面留在后台继续跑」的代价（保活音频 + 定时器），不用后台消息时关掉「后台保活」最省电');
    if (run.gapMs > 0) adv.push('窗口内有 ' + mins(run.gapMs) + ' 页面未运行（重开过/被系统回收过）：想让后台也一直跑，靠「后台保活」；不想耗电就别开，两者取一');
    if (unkMs >= SEG_MIN_MS) adv.push('有 ' + mins(unkMs) + ' 落在「不确定」段（心跳停了但说不清原因）：开着「后台保活」再跑一轮对照——保活开着时页面不被冻结，这段应明显缩短；缩不了就是内核在节流，那部分耗电本来就归本站');
    if (fgD <= 0 && bgD <= 0 && gapD <= 0 && run.chgMs === 0) adv.push('窗口内电量没有下降：要么耗电极低、要么时间还太短（电量 1% 一跳）——想抓异常请跑 1 小时以上或过夜档');
    if (run.chgMs > 0) adv.push('测的时候有 ' + mins(run.chgMs) + ' 在充电：充电本身发热/进电，想测准请拔掉充电器重跑一轮');
    if (!adv.length) adv.push('本窗口未见异常。要复现「耗电快」的现场，就在你觉得掉电快的时段随时点本行再测一轮，报告对比着看');
    adv.forEach(function (a, i) { L.push((i + 1) + '. ' + a); });
    L.push('');
    L.push('（电量数据由浏览器接口读取，只在本机统计、不上传；前台/后台/未运行/不确定四段分开算，充电段剔除）');
    var rep = { t: Date.now(), verdict: verdict, rateTxt: rateTxt, run: { fgMs: run.fgMs, bgMs: run.bgMs, gapMs: run.gapMs, unkMs: unkMs, chgMs: run.chgMs, n: run.n, net: net, jitter: jitter }, text: L.join('\n') };
    return rep;
  }

  // ========== ② 发烫自测 ==========
  // #1015：时长从「写死 10 秒」放开到 10 秒~5 分钟档、UI 默认 3 分钟。理由：10 秒的负载根本热不起来，
  // 它只能答「此刻有没有被限速」（已经烫了 / 开着省电模式），答不了「越跑越慢」——手机从冷到热要
  // 1 分钟以上，这就是用户报「测试时间太短」的实质。配套三处（均零机型分支）：
  //  ①负载切成 ~60ms 一小片、片间让出主线程。旧实现每轮同步阻塞 700ms（10 轮＝7 秒界面冻死），
  //    时长一拉到分钟级会把页面直接变成「无响应」，连进度浮条都不刷新；切片后界面全程可用、可随时
  //    【提前结束】出报告。顺带修好一个口径问题：旧版负载期只统计帧间隔 <250ms 的帧，自己那 700ms
  //    阻塞被算成「掉帧」、负载期 fps 恒≈0——切片后帧采样才反映真实情况。
  //  ②判级看整窗趋势：6 段中位（走势）+ 首尾 10% 中位（判级），不再只用「开头 3 轮 vs 最后 3 轮」2 个点。
  //  ③页面不可见＝暂停（后台烧电无意义，且内核会把定时器节流到分钟级、把测量搅乱），回前台接着跑，
  //    暂停时长在报告里如实标出。
  var _heatRunning = false, _heatStop = false, _heatProg = null;
  // 固定工作量单元（xorshift 混合运算）：结果写回模块级变量，防 JIT 当作死代码消除
  function heatWork(n) {
    var x = _heatSink | 1;
    for (var i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x = (x + i) | 0; }
    _heatSink = x;
    return x;
  }
  function timeWork(n) { var t = performance.now(); heatWork(n); return performance.now() - t; }
  function heatVerdict(slow) {
    if (slow >= SLOW_BAD) return '明显降频';
    if (slow >= SLOW_MILD) return '轻度降频';
    return '未见降频';
  }
  function durTxt(ms) {
    var s = Math.round(Math.max(0, ms) / 1000);
    if (s < 60) return s + ' 秒';
    var m = Math.round(s / 60 * 10) / 10;
    return (m % 1 === 0 ? m : m.toFixed(1)) + ' 分钟';
  }
  // 等时间分箱（趋势）：整窗切片按时间顺序均分成 k 段各取中位——热降频是「越跑越慢」的单调走势，
  // 只看首尾两个点看不出中途回升/平台期，分箱才看得见。
  function binMeds(arr, k) {
    var out = [], n = arr.length, i, a, b;
    if (!n) return out;
    for (i = 0; i < k; i++) {
      a = Math.floor(i * n / k); b = Math.floor((i + 1) * n / k);
      if (b <= a) b = a + 1;
      out.push(med(arr.slice(a, b)));
    }
    return out;
  }
  function heatText(rep) {
    var L = [];
    var r = rep.slices || [];
    var loadMs = rep.loadMs || 0;
    var warm = r.length > HEAT_WARMUP ? r.slice(HEAT_WARMUP) : r;
    var n10 = Math.max(3, Math.floor(warm.length / 10));
    var early = warm.length ? med(warm.slice(0, n10)) : 0;
    var late = warm.length ? med(warm.slice(warm.length - n10)) : 0;
    var slow = early > 0 ? (late - early) / early : 0;
    var bins = binMeds(r, HEAT_BINS);
    var enough = r.length >= (HEAT_WARMUP + 12);
    var verdict = enough ? heatVerdict(slow) : '数据不足';
    var short = loadMs < HEAT_MIN_JUDGE_MS;
    rep.verdict = verdict; rep.early = Math.round(early); rep.late = Math.round(late);
    rep.slow = slow; rep.bins = bins; rep.short = short;
    // 结论行恒以「结论：<判级>」开头，短窗提示一律加在行尾（解析口径与旧报告一致）
    L.push('结论：' + verdict
      + (enough ? '（末段比开头' + (slow >= 0 ? '慢 ' : '快 ') + Math.abs(Math.round(slow * 1000) / 10) + '%）' : '（负载样本不足）')
      + (short ? '· 本次是 ' + durTxt(loadMs) + '快测：只说明「此刻有没有被限速」，测不出不代表不烫' : ''));
    L.push('采样 ' + Math.round((rep.totalMs || 0) / 1000) + ' 秒：静置 ' + durTxt(HEAT_IDLE_MS) + ' 量基准帧率 → 固定负载 ' + durTxt(loadMs)
      + '（' + r.length + ' 片 × 约 ' + Math.round(HEAT_SLICE_MS) + 'ms，每片 ' + Math.round((rep.workN || 0) / 10000) + ' 万次运算）→ 再静置 ' + durTxt(HEAT_TAIL_MS) + ' 看帧率恢复'
      + (rep.pauseMs >= 1000 ? '（中途页面不可见 ' + durTxt(rep.pauseMs) + ' 已暂停、不计入负载）' : ''));
    if (bins.length >= 2) L.push('· 负载耗时趋势（整窗按时间分成 ' + bins.length + ' 段的中位）：' + bins.map(function (b) { return Math.round(b * 10) / 10; }).join(' → ') + ' ms');
    if (enough) L.push('· 开头 10% 中位 ' + Math.round(early) + 'ms → 最后 10% 中位 ' + Math.round(late) + 'ms（' + (slow >= 0 ? '+' : '') + Math.round(slow * 1000) / 10 + '%；判级：<10% 未见降频 / 10~25% 轻度 / ≥25% 明显降频）');
    var idleFps = rep.idleMs > 0 ? Math.round(rep.idleFrames * 1000 / rep.idleMs) : 0;
    var tailFps = rep.tailMs > 0 ? Math.round(rep.tailFrames * 1000 / rep.tailMs) : 0;
    L.push('· 帧率：负载前静置约 ' + idleFps + 'fps' + (rep.idleWorst > 50 ? '（最慢帧 ' + rep.idleWorst + 'ms）' : '') + ' → 负载后静置约 ' + tailFps + 'fps' + (rep.tailWorst > 50 ? '（最慢帧 ' + rep.tailWorst + 'ms）' : '') + '；负载期本测故意占满 CPU，掉帧 ' + rep.workJank + ' 帧属预期，只作对照');
    if (rep.batt) L.push('· 电池：' + rep.batt);
    L.push('· 发热相关因素：' + factorLines().join('；'));
    L.push('· 说明：浏览器读不到手机温度（系统不提供这个接口），本自测测的是「发烫的后果」——主频被系统压低后，同样的活越干越慢。手机从冷到热要 1 分钟以上，所以短档只答「此刻有没有被限速」，要看「越跑越慢」请用 3 分钟档；测出「明显降频」＝手机很可能正在烫并限速（或开着省电/低电量模式，两者表现一样）；没测出也不代表不烫（可能还没到限频阈值）。');
    if (rep.stopped) L.push('· 本次提前结束：负载只跑了 ' + durTxt(loadMs) + '，结论按已测到的部分给。');
    L.push('');
    L.push('建议：');
    var adv = [];
    if (verdict === '明显降频') adv.push('先把手机放凉几分钟再测一轮对照：凉机也「明显降频」＝多半是开了省电/低电量模式或系统长期限制性能，不是发烫；热机才降频＝就是发烫引起的');
    if (verdict === '轻度降频') adv.push('轻度降频：对照手摸温度，若确实烫＝按下方因素逐条排除；不烫则可能是系统温控偏保守，属正常波动');
    if (short) adv.push('这次只跑了 ' + durTxt(loadMs) + '（快测）：手机还没热起来就结束了，测不出「越跑越慢」是正常的——要判断发烫降频，请用 3 分钟档再跑一轮（跑完让手机凉一会儿）');
    var keepOn = false;
    try { var ka = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null; keepOn = !!(ka && ka.keep); } catch (e) {}
    if (keepOn) adv.push('「后台保活」开着：页面在后台持续运行＝最常见的发热源，不用后台通知时到 设置→系统 关掉，几分钟后再测一轮对照');
    if (rep.batt && rep.batt.indexOf('充电中') >= 0) adv.push('测试时正在充电：充电本身发热，建议拔掉充电器、等几分钟再测一轮对照');
    if (verdict === '未见降频' && !adv.length) adv.push('本窗口未见降频迹象。若手机确实烫，按 设置→工具 下方「手机发烫怎么改善」逐条排查（保活/边充边用/长时间放声音），并可在发烫的当下立刻再测一轮');
    adv.forEach(function (a, i) { L.push((i + 1) + '. ' + a); });
    L.push('');
    L.push('（测试负载固定、只在本机进行、不上传任何数据；「固定负载」按本机速度现场校准，各机型同一口径）');
    rep.text = L.join('\n');
    return rep;
  }
  function runHeat(onTick, ms) {
    return new Promise(function (resolve) {
      if (_heatRunning) return resolve(null);
      _heatRunning = true; _heatStop = false;
      onTick = typeof onTick === 'function' ? onTick : function () {};
      // 账目一律按「真正在跑负载的时间」算（actMs），页面不可见的时段不计——否则切出去两分钟
      // 回来会发现负载"跑完了"却只采到几片。
      ms = clamp(Number(ms) || HEAT_API_MS, HEAT_DURS['10'], HEAT_DURS['300']);
      var rep = { t: Date.now(), slices: [], idleFrames: 0, idleMs: 0, idleWorst: 0, tailFrames: 0, tailMs: 0, tailWorst: 0, workFrames: 0, workWorst: 0, workJank: 0, workN: 0, batt: null, totalMs: 0, loadMs: 0, pauseMs: 0, stopped: 0 };
      var t0 = performance.now(), last = t0, phase = 'idle', raf = 0, done = false;
      var actMs = 0, actAt = 0, hidAt = 0, lastTick = 0, tailAt = 0;
      function frame(now) {
        if (done) return;
        var d = now - last; last = now;
        if (phase === 'idle') { if (d < 250) { rep.idleFrames++; if (d > rep.idleWorst) rep.idleWorst = Math.round(d); } }
        else if (phase === 'load') { if (d < 250) rep.workFrames++; if (d > rep.workWorst) rep.workWorst = Math.round(d); if (d > 34) rep.workJank++; }
        else if (phase === 'tail') { if (d < 250) { rep.tailFrames++; if (d > rep.tailWorst) rep.tailWorst = Math.round(d); } }
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      getBm().then(function (bm) { rep.batt = battLine(bm); });
      // 浮条的剩余时间＝负载剩余 + 收尾静置（静置期也给用户一个「还剩几秒」）
      function tick(name) {
        _heatProg = { phase: name, left: Math.max(0, Math.ceil((ms - actMs + HEAT_TAIL_MS) / 1000)) };
        onTick(_heatProg);
      }
      function finish() {
        if (done) return;
        done = true;
        try { cancelAnimationFrame(raf); } catch (e) {}
        rep.totalMs = performance.now() - t0;
        rep.tailMs = tailAt > 0 ? Math.max(0, performance.now() - tailAt) : 0;
        _heatRunning = false; _heatProg = null;
        var out = heatText(rep);
        var lastRec = lsGet(HEAT_LAST_KEY, null) || {};
        lastRec.t = out.t; lastRec.verdict = out.verdict; lastRec.pending = 0; lastRec.text = out.text;
        lsSet(HEAT_LAST_KEY, lastRec);
        updateHeatSub();
        resolve(out);
      }
      function slice() {
        if (done) return;
        if (document.hidden) {
          if (!hidAt) hidAt = performance.now();
          setTimeout(slice, 250);
          return;
        }
        // 回前台先把不可见那段记进 pauseMs——无论这一片是接着跑，还是用户刚点过【提前结束】：
        // 结算入口在下面，若把停止判定放在前面，「切后台→回来马上结束」的那一轮就不会提暂停过多久。
        if (hidAt) { rep.pauseMs += performance.now() - hidAt; hidAt = 0; actAt = performance.now(); }
        if (_heatStop) { rep.stopped = 1; return finish(); }
        var t = performance.now();
        heatWork(rep.workN);
        rep.slices.push(performance.now() - t);
        actMs += performance.now() - actAt; actAt = performance.now();
        rep.loadMs = actMs;
        if (actMs >= ms) { phase = 'tail'; tailAt = performance.now(); tick('tail'); setTimeout(finish, HEAT_TAIL_MS); return; }
        if (actMs - lastTick >= HEAT_TICK_MS) { lastTick = actMs; tick('load'); }
        setTimeout(slice, 0);
      }
      function loadPhase() {
        phase = 'load'; actAt = performance.now();
        var calN = 200000; // 校准样本大些：performance.now 分辨率下量得准，且各机型同口径
        var unit = timeWork(calN);
        rep.workN = clamp(Math.round(calN * HEAT_SLICE_MS / Math.max(unit, 0.1)), 500, 400000000);
        tick('load');
        slice();
      }
      function idleDone() {
        rep.idleMs = performance.now() - t0;
        loadPhase();
      }
      setTimeout(idleDone, HEAT_IDLE_MS);
    });
  }
  function stopHeat() { if (_heatRunning) { _heatStop = true; return true; } return false; }
  // ---------- 设置行接线 ----------
  var batSubEl = null, batSubDefault = '', heatSubEl = null, heatSubDefault = '';
  function updateBatSub() {
    if (!batSubEl) return;
    var t = '';
    if (_batRun) t = '自测进行中：剩 ' + leftTxt(_batRun) + '（切去忙别的也算，时间到自动出报告）';
    else {
      var last = lsGet(BAT_LAST_KEY, null);
      if (last && last.t) t = '上次：' + last.verdict + (last.rateTxt ? '（' + last.rateTxt + '）' : '') + ' · ' + dtTxt(last.t) + (last.pending ? ' · 有未读报告' : '');
    }
    batSubEl.textContent = t || batSubDefault;
  }
  function updateHeatSub() {
    if (!heatSubEl) return;
    var last = lsGet(HEAT_LAST_KEY, null);
    heatSubEl.textContent = (last && last.t) ? ('上次：' + last.verdict + ' · ' + dtTxt(last.t) + (last.pending ? ' · 有未读报告' : '')) : heatSubDefault;
  }
  function askBattery() {
    if (!window.openModal || _batStarting) return;
    if (_batRun) {
      var ctlR = window.openModal('电量消耗自测进行中', '', function () { endBatRun(); }, {
        noInput: true,
        staticText: '正在测（剩 ' + leftTxt(_batRun) + '）：前台/后台/页面未运行分开计时，充电段自动剔除。\n点「结束并出报告」＝立即结算已测到的部分（剩余时长放弃）；点「取消」＝继续测，什么都不发生。'
      });
      try { if (ctlR && ctlR.okText) ctlR.okText('结束并出报告'); } catch (e) {}
      return;
    }
    var ctl = window.openModal('电量消耗自测', '', function (v) {
      var ms = BAT_DURS[String(v)] || BAT_DURS['60'];
      startBattery(ms, function (p) { bar('电量自测中…剩 ' + mins(p.left * 1000) + '（前台 ' + p.fgMin + ' 分 / 后台 ' + p.bgMin + ' 分）', 0); updateBatSub(); })
        .then(function (rep) { hideBar(); if (rep) deliver('battery', rep); });
    }, {
      noInput: true,
      // #1015：默认档提到 1 小时 + 红字警示（#908 在卡顿自检上立的同款口径：短档「没用」要在
      // 弹窗打开这一刻就说清，别让用户选了短档再拿到一句「数据不足」）
      warn: true, staticEmph: true,
      pills: BAT_PILLS,
      pill: '60',
      staticText: '**⚠ 15 / 30 分钟只能看趋势**——电量计只有 1% 一格，窗口太短数字粗得没意义；抓耗电异常请用 **1 小时档（已设为默认）**，最准是夜里放着跑**过夜档**。\n\n测法：确认后开始分段计时——前台用 / 切出去放着 / 页面被系统关掉，分开算 %/小时，充电段自动剔除；期间可以正常用手机、也可以去忙别的，时间到自动出报告（中途刷新、被系统杀进程重开都会续测）。想提前收工就再点一次本行 →「结束并出报告」，已测到的部分当场结算。\n建议拔掉充电器：充电中电量不降反升，测不出耗电。\n电量接口只有部分浏览器提供（安卓 Chrome/Edge 系有；iPhone 上任何浏览器都没有，属系统限制——那时本行会如实告知并给替代路径）。'
    });
    try { if (ctl && ctl.okText) ctl.okText('开始测'); } catch (e) {}
  }
  function runHeatUI() {
    if (!window.openModal) return;
    // #1015：3 分钟档必须有出口——进行中再点本行＝「提前结束并出报告」（同电量自测那套口径）
    if (_heatRunning) {
      var ctlR = window.openModal('发烫自测进行中', '', function () { stopHeat(); }, {
        noInput: true,
        staticText: '正在跑固定负载' + (_heatProg ? '（剩约 ' + durTxt(_heatProg.left * 1000) + '）' : '') + '：负载切成 60ms 一小片，界面全程可用。\n点「提前结束并出报告」＝立刻结算已测到的部分；点「取消」＝继续跑（手机请放在一边、别操作屏幕）。\n（负载跑满整档才看得出「越跑越慢」；提前结束只能看已测那段，报告里会标明。）'
      });
      try { if (ctlR && ctlR.okText) ctlR.okText('提前结束并出报告'); } catch (e) {}
      return;
    }
    var ctl = window.openModal('发烫自测', '', function (v) {
      var ms = HEAT_DURS[String(v)] || HEAT_DURS['180'];
      runHeat(function (p) { bar('发烫自测中…剩 ' + p.left + ' 秒（' + (p.phase === 'load' ? '固定负载' : '静置对照') + '，请别操作屏幕）', 0); }, ms)
        .then(function (rep) { hideBar(); if (rep) deliver('heat', rep); });
    }, {
      noInput: true,
      // #1015：默认 3 分钟 + 红字警示（#908 口径：短档答不了「越跑越慢」这件事，要在打开弹窗
      // 这一刻就讲清楚，不能让用户选了 10 秒档再拿到一句「测不出不代表不烫」）
      warn: true, staticEmph: true,
      pills: HEAT_PILLS,
      pill: '180',
      staticText: '**⚠ 10 秒档只能答「此刻有没有被限速」**——手机从冷到热要 1 分钟以上，要看「越跑越慢」请用 **3 分钟档（已设为默认）**。\n\n做法：先静置 3 秒量基准帧率，再持续跑固定工作量 N 分钟（切成 60ms 一小片，界面全程可用、可中途【提前结束】出报告），最后再静置 3 秒看帧率是否恢复；比对整窗趋势＝手机被系统压慢了多少（这就是「降频」）。\n说明：浏览器读不到手机温度（系统没有这个接口），所以本测的是「发烫的后果」而不是温度本身；测出「明显降频」＝手机很可能已经在烫（或开着省电/低电量模式，两者表现一样），没测出也不代表不烫。\n开始后把手机放手边、不要操作屏幕（点按与切页会干扰测量），顶部浮条倒数，结束自动出报告。'
    });
    try { if (ctl && ctl.okText) ctl.okText('开始（可中途结束）'); } catch (e) {}
  }
  // 续测：run 记录还在且未到点＝继续采；已过点＝补出报告（页面停在后台/被关过也认账）
  function restoreRun() {
    var run = lsGet(BAT_RUN_KEY, null);
    if (!run || !(run.t0 > 0) || !(run.ms > 0) || !(run.iv > 0)) return;
    if (Date.now() >= run.t0 + run.ms) {
      var rep = buildBat(run);
      lsDel(BAT_RUN_KEY);
      var last = lsGet(BAT_LAST_KEY, null) || {};
      last.t = rep.t; last.verdict = rep.verdict; last.rateTxt = rep.rateTxt; last.text = rep.text; last.pending = 0;
      lsSet(BAT_LAST_KEY, last);
      updateBatSub();
      deliver('battery', rep);
      return;
    }
    getBm().then(function (bm) {
      if (!bm) { lsDel(BAT_RUN_KEY); updateBatSub(); return; }
      _batBm = bm;
      _freshReload = true; // 带着旧记录重开＝上一个采样到这次之间页面确实没在跑（有证据，归未运行段）
      _batRun = run;
      startBatLoop(run);
      updateBatSub();
      bar('电量自测续测中…剩 ' + leftTxt(run) + '（时间到自动出报告）', 8000);
    });
  }
  function boot() {
    var rowB = document.getElementById('row-battery-check');
    if (rowB) {
      batSubEl = rowB.querySelector('.sub');
      if (batSubEl) batSubDefault = batSubEl.textContent;
      rowB.addEventListener('click', askBattery);
      updateBatSub();
    }
    var rowH = document.getElementById('row-heat-check');
    if (rowH) {
      heatSubEl = rowH.querySelector('.sub');
      if (heatSubEl) heatSubDefault = heatSubEl.textContent;
      rowH.addEventListener('click', runHeatUI);
      updateHeatSub();
    }
    try {
      document.addEventListener('visibilitychange', function () {
        if (_batRun && _batBm) { try { sampleOnce(_batRun, _batBm); writeRun(_batRun); } catch (e) {} updateBatSub(); }
        popPending();
      });
    } catch (e) {}
    // 本文件在 jsFiles 里排在弹窗组件（personalize.js）之前：boot 若在组件就绪前跑，到点续测
    // 的报告会被 reportModal 的就绪闸（!window.openModal 直接 return）静默丢掉——等 defer 脚本
    // 全部执行完的 DOMContentLoaded 再续测/交付（只影响这一小段时机，行接线已在上面做完）。
    whenModalReady(function () { restoreRun(); popPendingAtBoot(); });
  }
  function whenModalReady(fn) {
    if (typeof window.openModal === 'function') return fn();
    if (document.readyState === 'loading' || document.readyState === 'interactive') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.mochiEnergyCheck = {
    startBattery: startBattery,
    startHeat: runHeat,
    stopHeat: stopHeat,
    heatProg: function () { return _heatProg; },
    HEAT_DURS: HEAT_DURS,
    batteryRunning: function () { return !!_batRun; },
    heatRunning: function () { return _heatRunning; },
    restoreRun: restoreRun,
    BAT_LAST_KEY: BAT_LAST_KEY,
    HEAT_LAST_KEY: HEAT_LAST_KEY,
    BAT_RUN_KEY: BAT_RUN_KEY
  };
})();
