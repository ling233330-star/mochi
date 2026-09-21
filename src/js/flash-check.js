// ===== v3.26.x #946：闪屏自测（设置 → 工具 一行；把 #938 那把无头尺子搬到真机的只读诊断）=====
// 需求（用户直派「在红米 K80 真机验证闪屏修复」）：#938 修的是「值没变也把全站内联样式重写一遍」型闪屏。
// 无头环境只能拿参数代理（同屏幕参数＋CPU 节流）做 A/B，测不到用户手上那一台；而「有没有闪」全靠主观
// 感觉，用户报回来也只有一句「还在闪」。本自测让真机自己出数字：点【开始】后去
// 聊天设置/群聊设置 → 美化 → 边看边调 按浮条提示点 4 下（第 2 下故意重复点同一个档＝「值没变」的那一下），
// 每一次点击单独量三件事：
//   ①全站样式翻动＝:root / #page-chat / #page-group-chat 的 style 属性真被改了几次（MutationObserver，整篇文档样式作用域
//     重解析＝闪屏的直接来源；不认写入方是谁，别的模块在写也算得出来）
//   ②同值白写＝值一个字没变仍写进 DOM 的条数（内联变量同值 setProperty／空 removeProperty／空摘 cs-*
//     类／cs-* 样式表拆建，按 --msg-/--chat-/--typing-/--send-/--cs- 名族判定）——#938 的根因面
//   ③帧＝rAF 真实帧间隔（最慢帧与 >50ms 掉帧数）＝那一下到底卡没卡
// 分段以「用户的点击」为锚，不以「写入事件」为锚：修好之后值没变那一下是彻底零写入的，若靠写入事件开段
// 就永远不会留下记录，报告会假称「没采到」——这是探针可用性的前提（点击之外的事件一律不单独成段）。
// 抽屉与宿主都是一族（#966，红米 K80 实报「没有采到抽屉里的点击」）：单聊 #chat-beauty-drawer 把变量
// 写在 :root/#page-chat，群聊 #gc-beauty-drawer 写在 #page-group-chat——只认单聊那一套时，用户在群聊
// 「边看边调」里点档位判成「不在抽屉里」且写入没人看，报告静默变「没采到」。现在两族都认，
// 且「没采到」会拆开讲是「压根没点」还是「点了但不在抽屉里」。
// 判据：只有「值没变的那一下」翻动/白写为 0 才算修好；值真变了要重写样式＝功能必要开销，不算缺陷。
// 口径：全程只读——不写任何业务键、不改任何设置值（档位本来就是用户自己点的），【结束】即摘干净全部探针、
// 浮条与监听零残留；只有最后一次报告存 xy-home-v2:flash-check-last（同 #935 两个自测的 *_last 口径）。
// #1015（2026-09-22 用户直派「…闪屏自测…功能测试时间太短，并且还能怎么优化」）：分式改为两档——
// ①【点 4 下】＝原来的精确对照（只量那 4 下各自的 0.7 秒）；②【1/3/5 分钟】＝长窗口「边用边测」：
//    点开始后照常聊天/打字/切页，全程累计翻动/白写/掉帧，并单独挑出「无操作翻动」（那一下之前
//    WIN_ACT_MS 内没有任何点击/按键/输入/滚动）＝最可疑的「自己闪」，时刻与所在页一并列出。
//    闪烁多发生在「用一会儿才闪」的场景，4 下点档根本不在现场，这是用户说「时间太短」的实质。
(function () {
  'use strict';
  if (window.mochiFlashCheck) return;

  var LAST_KEY = 'xy-home-v2:flash-check-last';
  // 聊天美化抽屉写的变量名族（chat-settings.js 的 applySettings 全部落在这里面）
  var VAR_NS = /^(--msg-|--chat-|--typing-|--send-|--cs-)/;
  var GAP_MS = 400;      // 一次点击往后收 400ms 的写入事件（同一记点击的同步写入与随后微任务里的计数）
  var TAIL_MS = 700;     // 一次点击往后收 700ms 的帧（点击后的重排/重合成都落在这段）
  var MAX_OPS = 8;
  var JANK_MS = 50;      // 手机 60fps 下 >50ms 视为肉眼可见的跳帧
  // #1015 长窗口档位与判据
  var WIN_DURS = { '0': 0, '60': 60000, '180': 180000, '300': 300000 };
  var WIN_ACT_MS = 400;       // 「无操作翻动」判据：翻动时刻距最近一次用户事件 ≥400ms
  var WIN_CLUSTER_MS = 1500;  // 同一记闪的连续几次翻动聚成一条（否则一条闪会刷成一屏）
  var WIN_PILLS = [{ label: '点 4 下（精确对照）', value: '0' }, { label: '1 分钟', value: '60' }, { label: '3 分钟', value: '180' }, { label: '5 分钟', value: '300' }];

  var _on = false;
  var _clicks = [], _ev = [], _flips = [], _frames = [];
  var _styleHooks = [], _obs = [], _origRemove = null, _chip = null, _onClick = null;
  var _seen = 0, _seenIn = 0;   // #966：屏幕点击总数 / 其中落在抽屉内的次数（报障时区分「没点」与「点错地方」）
  // #1015 长窗口观测态：_winMs>0 表示本轮是「边用边测」，_acts＝用户最近动手的时刻（判无操作翻动），
  // _jankTotal/_worst＝掉帧累计与最慢 3 帧现场（_frames 有 6000 截断，长窗口必须另记计数器）
  var _winMs = 0, _winT0 = 0, _winTimer = null, _acts = [], _actHandler = null, _actEvs = [];
  var _jankTotal = 0, _worst = [];

  function now() { try { return performance.now(); } catch (e) { return Date.now(); } }
  // 版本号：#about-ver-val 是构建时替换的真值（window.APP_VERSION 未必赋值，见 card-audit.js 同款注释）
  function appVer() {
    try { var el = document.getElementById('about-ver-val'); var t = el && String(el.textContent || '').trim(); if (t && t.indexOf('__') < 0) return t; } catch (e) {}
    try { return String(window.APP_VERSION || '未知'); } catch (e2) { return '未知'; }
  }

  function mark(kind, name) { if (_on) _ev.push({ t: now(), k: kind, n: name || '' }); }
  // :root / #page-chat 的 style 真被改（带时刻入表；归哪一次点击由 collect() 判定，落不进窗口的算局外改写）
  function flip(where) { if (_on) _flips.push({ t: now(), w: where }); }
  var _other = 0;

  // —— 内联变量写入钩子：按元素挂钩（documentElement.style 上 mobile-adapt 已有实例级包装，
  //    只钩原型会被它遮蔽＝抓到 0 次写入的假绿，故必须链在实例上；【结束】原样还原）——
  function getVal(s, n) { try { return s.getPropertyValue(n); } catch (e) { return ''; } }
  function hookStyle(el, tag) {
    if (!el || !el.style) return;
    var s = el.style, _set = s.setProperty, _del = s.removeProperty;
    s.setProperty = function (n, v) {
      if (_on) {
        try {
          var name = String(n);
          if (VAR_NS.test(name)) {
            if (getVal(s, name) === String(v)) mark('n');       // 同值白写
            else mark('w', tag + ':' + name);                    // 必要写入
          }
        } catch (e) {}
      }
      return _set.apply(s, arguments);
    };
    s.removeProperty = function (n) {
      if (_on) {
        try { if (VAR_NS.test(String(n)) && getVal(s, String(n)) === '') mark('dn'); } catch (e) {}
      }
      return _del.apply(s, arguments);
    };
    _styleHooks.push({ s: s, set: _set, del: _del });
  }

  function arm() {
    var root = document.documentElement;
    hookStyle(root, 'root');
    // #966：宿主是一族。单聊把美化变量写在 :root 与 #page-chat 上；群聊写在 #page-group-chat 上
    // （group-chat.js applyGcBeauty 的 page.style.setProperty，变量名族与单聊同款）。只挂单聊两个宿主＝
    // 用户在群聊「边看边调」里点档位时写到的地方没人看，报告静默变成「没采到」（红米 K80 实报面）。
    var hosts = [];
    for (var h = 0; h < HOSTS.length; h++) {
      var el = document.getElementById(HOSTS[h]);
      if (el) { hookStyle(el, HOSTS[h]); hosts.push(el); }
    }
    // 真属性变更＝整篇文档样式作用域重解析的直接证据（与写入方是谁无关）
    var mo = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type !== 'attributes' || m.attributeName !== 'style') continue;
        flip(m.target === root ? 'root' : String(m.target.id || 'chat'));
      }
    });
    mo.observe(root, { attributes: true, attributeFilter: ['style'] });
    for (var j = 0; j < hosts.length; j++) mo.observe(hosts[j], { attributes: true, attributeFilter: ['style'] });
    _obs.push(mo);
    // cs-* 样式表拆建（enforce / contrast 两层）：重建＝整层样式重新解析
    var mo2 = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var bump = function (list) {
          for (var k = 0; k < list.length; k++) {
            var nd = list[k];
            if (nd.nodeName === 'STYLE' && String(nd.id || '').indexOf('cs-') === 0) mark('ss');
          }
        };
        bump(ms[i].addedNodes); bump(ms[i].removedNodes);
      }
    });
    mo2.observe(document.head, { childList: true });
    _obs.push(mo2);
    // 空摘 cs-* 类（remove 一个本来就没有的类＝纯白动作）
    _origRemove = DOMTokenList.prototype.remove;
    DOMTokenList.prototype.remove = function () {
      if (_on) {
        for (var i = 0; i < arguments.length; i++) {
          var c = String(arguments[i]);
          if (c.indexOf('cs-') === 0 && !this.contains(c)) mark('cn');
        }
      }
      return _origRemove.apply(this, arguments);
    };
    // 点击锚：抽屉里每一次点击＝一次测量段（值没变、零写入也照样留记录，这是「修好了」能被证明的前提）
    _onClick = function (e) {
      if (!_on) return;
      var t = now();
      var hit = drawerHit(e.target);
      _seen++;
      if (hit) _seenIn++;
      if (_clicks.length >= MAX_OPS * 6) _clicks.shift();
      _clicks.push({ t: t, in: hit });
    };
    document.addEventListener('click', _onClick, true);
    // #1015：长窗口要判「无操作翻动」，就必须知道「用户最近一次动手」是什么时候。点击已有锚点，
    // 再补按键/输入/触摸/滚动——打字、切页、上滑也会触发样式改写，缺了这几样会把它们冤成「自己闪」。
    _actEvs = ['click', 'pointerdown', 'touchstart', 'keydown', 'input', 'scroll'];
    _actHandler = function () { if (_on) { _acts.push(now()); if (_acts.length > 400) _acts.splice(0, 200); } };
    for (var av = 0; av < _actEvs.length; av++) { try { document.addEventListener(_actEvs[av], _actHandler, { capture: true, passive: true }); } catch (e) {} }
    (function frames() {
      var last = now();
      requestAnimationFrame(function tick() {
        if (!_on) return;
        var t = now();
        var gap = t - last;
        _frames.push({ t: t, gap: gap });
        // #1015：掉帧累计走计数器（_frames 有 6000 截断，长窗口按数组数会漏），
        // 并留最慢 3 帧的「第几秒·哪页」（长窗口的结论靠这两样定位）。
        if (gap > JANK_MS) {
          _jankTotal++;
          if (_winMs) {
            _worst.push({ off: Math.round((t - _winT0) / 1000), pg: pageName(), ms: Math.round(gap) });
            _worst.sort(function (x, y) { return y.ms - x.ms; });
            if (_worst.length > 3) _worst.length = 3;
          }
        }
        last = t;
        if (_frames.length > 6000) _frames.splice(0, 3000);
        requestAnimationFrame(tick);
      });
    })();
  }
  // #966：抽屉是一族（单聊 #chat-beauty-drawer／群聊 #gc-beauty-drawer，两个「边看边调」同源同貌）。
  // 只看单聊那一个＝用户在群聊抽屉里点档位被判成「不在抽屉里」，报告静默变「没采到」（红米 K80 实报）。
  var DRAWERS = ['chat-beauty-drawer', 'gc-beauty-drawer'];
  var HOSTS = ['page-chat', 'page-group-chat'];
  var DRAWER_NAME = { 'chat-beauty-drawer': '单聊', 'gc-beauty-drawer': '群聊' };
  function drawerHit(el) {
    if (!el) return '';
    for (var i = 0; i < DRAWERS.length; i++) {
      var d = document.getElementById(DRAWERS[i]);
      if (!d) continue;
      try { if (d.contains(el)) return DRAWERS[i]; } catch (e) {}
    }
    return '';
  }

  // —— #1015 长窗口观测：全程累计 + 挑「无操作翻动」 ——
  // 当前可见页名（与 卡顿自检 同一口径：读最上层可见 .page；无则算桌面）
  function pageName() {
    try {
      var p = document.querySelector('.page:not([hidden])');
      if (!p) return '桌面';
      var id = String(p.id || '').replace(/^page-/, '');
      return id || '桌面';
    } catch (e) { return '?'; }
  }
  // 距最近一次用户动手多久（_acts 递增，倒着找第一个不晚于 t 的）
  function msSinceAct(t) {
    for (var i = _acts.length - 1; i >= 0; i--) { if (_acts[i] <= t) return t - _acts[i]; }
    return Infinity;
  }
  // 连续翻动聚成一条（同一记闪往往连翻好几次）
  function clusterFlips(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var pg = f.w === 'root' ? '全局(:root)' : (f.w === 'page-group-chat' ? '群聊页' : '聊天页');
      var last = out[out.length - 1];
      if (last && f.t - last.t <= WIN_CLUSTER_MS) { last.n++; last.t = f.t; }
      else out.push({ t: f.t, n: 1, pg: pg });
    }
    return out;
  }
  function winStats() {
    if (!_winMs) return null;
    var t0 = _winT0, t1 = t0 + _winMs, i;
    var flips = 0, fr = 0, fc = 0, fg = 0, waste = 0;
    for (i = 0; i < _flips.length; i++) {          // _flips/_ev 都是按时刻递增压入的
      var f = _flips[i]; if (f.t < t0) continue; if (f.t > t1) break;
      flips++; if (f.w === 'root') fr++; else if (f.w === 'page-group-chat') fg++; else fc++;
    }
    for (i = 0; i < _ev.length; i++) {
      var e = _ev[i]; if (e.t < t0) continue; if (e.t > t1) break;
      if (e.k === 'n' || e.k === 'dn' || e.k === 'cn' || e.k === 'ss') waste++;
    }
    var idle = [];
    for (i = 0; i < _flips.length; i++) {
      var fl = _flips[i]; if (fl.t < t0) continue; if (fl.t > t1) break;
      if (msSinceAct(fl.t) >= WIN_ACT_MS) idle.push(fl);
    }
    var cl = clusterFlips(idle);
    return { ms: _winMs, flips: flips, flipRoot: fr, flipChat: fc, flipGc: fg, waste: waste, jank: _jankTotal,
      idle: idle.length, clusters: cl.slice(0, 3), worst: _worst.slice() };
  }
  function fmtLeft(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m > 0 ? (m + ':' + (s < 10 ? '0' : '') + s) : (s + ' 秒');
  }
  function winTick() {
    _winTimer = null;
    if (!_on || !_winMs) return;
    var left = Math.max(0, Math.ceil((_winT0 + _winMs - now()) / 1000));
    if (left <= 0) { chipSay('时间到，正在出报告…'); finishWin(); return; }
    var w = winStats();
    chipSay('边用边测中…剩 ' + fmtLeft(left) + '｜翻动 ' + (w ? w.flips : 0) + ' · 白写 ' + (w ? w.waste : 0) + ' · 掉帧 ' + (w ? w.jank : 0));
    _winTimer = setTimeout(winTick, 1000);
  }
  // 到点：先出报告（buildReport 读的数组还在），再摘探针
  function finishWin() {
    if (_winTimer) { clearTimeout(_winTimer); _winTimer = null; }
    showReport();
    stop();
  }

  // —— 分桶：把写入事件/属性变更/帧按「抽屉里的点击」归段 ——
  function collect() {
    var list = [];
    for (var i = 0; i < _clicks.length && list.length < MAX_OPS; i++) { if (_clicks[i].in) list.push({ t: _clicks[i].t, d: _clicks[i].in, o: newOp(_clicks[i].t) }); }
    var owner = function (t) {
      var best = -1;
      for (var i = 0; i < list.length; i++) { if (t >= list[i].t - 2 && t - list[i].t <= GAP_MS) best = i; }
      return best;
    };
    var other = 0;
    for (var e = 0; e < _ev.length; e++) {
      var k = owner(_ev[e].t); if (k < 0) { other++; continue; }
      var o = list[k].o, kind = _ev[e].k;
      if (kind === 'w') { o.writes++; if (_ev[e].n) o.names[_ev[e].n] = 1; }
      else if (kind === 'n') o.noop++;
      else if (kind === 'dn') o.delNoop++;
      else if (kind === 'cn') o.clsNoop++;
      else if (kind === 'ss') o.swap++;
    }
    for (var f = 0; f < _flips.length; f++) {
      var kk = owner(_flips[f].t); if (kk < 0) { other++; continue; }
      var w = _flips[f].w;
      if (w === 'root') list[kk].o.flipRoot++;
      else if (w === 'page-group-chat') list[kk].o.flipGc++;
      else list[kk].o.flipChat++;
    }
    _other = other;
    for (var j = 0; j < list.length; j++) {
      var t0 = list[j].t, t1 = t0 + TAIL_MS;
      if (j + 1 < list.length && list[j + 1].t < t1) t1 = list[j + 1].t;
      var o = list[j].o, gaps = [], sorted = [], jank = 0;
      for (var m = 0; m < _frames.length; m++) { if (_frames[m].t >= t0 && _frames[m].t <= t1) gaps.push(_frames[m].gap); }
      sorted = gaps.slice().sort(function (a, b) { return a - b; });
      o.frames = gaps.length;
      o.maxGap = sorted.length ? Math.round(sorted[sorted.length - 1]) : 0;
      for (var g = 0; g < gaps.length; g++) { if (gaps[g] > JANK_MS) jank++; }
      o.jank = jank;
    }
    var ops = [];
    for (var q = 0; q < list.length; q++) { var od = done(list[q].o); od.drawer = DRAWER_NAME[list[q].d] || ''; ops.push(od); }
    return ops;
  }
  function newOp(t) {
    return { t0: t, writes: 0, noop: 0, delNoop: 0, clsNoop: 0, swap: 0, flipRoot: 0, flipChat: 0, flipGc: 0, frames: 0, maxGap: 0, jank: 0, names: {} };
  }
  function done(o) { o.changed = Object.keys(o.names).join(' '); delete o.names; return o; }

  // —— 浮条：只讲下一步做什么＋计数，自己不写 :root（不参与采样）——
  function chip() {
    if (_chip) return _chip;
    var d = document.createElement('div');
    d.id = 'fc-chip';
    // #966：贴屏幕顶部，不再贴底。原先 bottom:78px 正好落在「边看边调」抽屉（z 95、最高 40vh）的
    // 覆盖区里——z 82 < 95，用户在抽屉里点档位时这条指引是看不见也点不到的（要看结果得先关抽屉，
    // 等于把人支开）。顶部与底部抽屉物理不相交，z 88 仍在报告框 .modal-mask(90) 之下。
    d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(6px + env(safe-area-inset-top,0px));z-index:88;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:20px;background:rgba(17,17,17,.86);color:#fff;font-size:12px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.28)';
    var txt = document.createElement('span');
    txt.id = 'fc-chip-txt';
    txt.textContent = '去点 4 下：宽松 → 再点宽松 → 紧凑 → 标准';
    var b1 = document.createElement('button');
    b1.id = 'fc-chip-view';
    b1.type = 'button';
    b1.textContent = '看结果';
    b1.style.cssText = 'border:0;border-radius:12px;padding:4px 10px;background:#ffd43b;color:#111;font-size:12px;flex:none';
    var b2 = document.createElement('button');
    b2.id = 'fc-chip-stop';
    b2.type = 'button';
    b2.textContent = '结束';
    b2.style.cssText = 'border:1px solid rgba(255,255,255,.5);border-radius:12px;padding:4px 10px;background:transparent;color:#fff;font-size:12px;flex:none';
    b1.addEventListener('click', function () { showReport(); });
    b2.addEventListener('click', function () { stop(); });
    d.appendChild(txt); d.appendChild(b1); d.appendChild(b2);
    document.body.appendChild(d);
    _chip = d;
    return d;
  }
  function chipSay(s) {
    if (!_chip) return;
    var t = _chip.querySelector('#fc-chip-txt');
    if (t) t.textContent = s;
  }

  // —— 报告 ——
  function wasteOf(o) { return o.noop + o.delNoop + o.clsNoop + (o.writes ? 0 : o.swap); }
  function opLine(o, i) {
    return '操作 ' + (i + 1) + (o.drawer ? '（' + o.drawer + '抽屉）' : '') + '｜' + (o.writes ? '值真变了（必要写 ' + o.writes + ' 条' + (o.changed ? '：' + o.changed : '') + '）' : '值没变（重复点同一档／切回刚点过的档）')
      + '\n  全站样式翻动 ' + (o.flipRoot + o.flipChat + o.flipGc) + ' 次（:root ' + o.flipRoot + '／聊天页 ' + o.flipChat + '／群聊页 ' + o.flipGc + '）｜白写 ' + wasteOf(o) + ' 条（同值重写 ' + o.noop + '／空删变量 ' + o.delNoop + '／空摘 cs-* 类 ' + o.clsNoop + '／样式表拆建 ' + o.swap + '）'
      + '\n  帧 ' + o.frames + ' 个｜最慢帧 ' + o.maxGap + 'ms｜>' + JANK_MS + 'ms 掉帧 ' + o.jank + ' 帧';
  }
  function buildReport() {
    var ops = collect();
    var win = winStats();
    var lines = ['闪屏自测' + (win ? '（长窗口 ' + Math.round(win.ms / 1000) + ' 秒）' : '（聊天美化·边看边调）') + ' · ' + appVer(), '设备：' + String(navigator.userAgent || '').slice(0, 100), ''];
    // #1015：长窗口这一轮根本没有「点档位」这件事，不能再去训用户「你怎么没点」——只在点档模式下提示
    if (!ops.length && !win) {
      // #966：把「没采到」拆开讲——是压根没点，还是点了但不在抽屉里（点错地方）。
      // 红米 K80 实报那句「没有采到抽屉里的点击」原本两种情形同一句话，用户与开发者都无从下手。
      if (!_seen) lines.push('没有采到任何屏幕点击：请点【开始】后回到 聊天设置/群聊设置 → 美化 → 边看边调 点档位（第 2 下重复点同一个档）。');
      else if (!_seenIn) lines.push('没有采到「抽屉里」的点击：这段时间共采到 ' + _seen + ' 次屏幕点击，但都不在 边看边调 的底部抽屉里。请确认点的是「聊天设置/群聊设置 → 美化 → 边看边调」打开的那条底部抽屉里的档位按钮（抽屉里可点的档位＝宽松/标准/紧凑这类胶囊）。');
      else lines.push('没有采到抽屉里的点击：请点【开始】后到 聊天设置/群聊设置 → 美化 → 边看边调 点档位（第 2 下重复点同一个档）。');
    }
    for (var i = 0; i < ops.length; i++) lines.push(opLine(ops[i], i));
    var noopOps = ops.filter(function (o) { return !o.writes; });
    var wasteAll = 0, jankAll = 0, worst = 0, flipAll = 0;
    for (var k = 0; k < noopOps.length; k++) {
      wasteAll += wasteOf(noopOps[k]);
      flipAll += noopOps[k].flipRoot + noopOps[k].flipChat + noopOps[k].flipGc;
      jankAll += noopOps[k].jank;
      if (noopOps[k].maxGap > worst) worst = noopOps[k].maxGap;
    }
    lines.push('');
    // 点档模式的结论只在这一轮真的点了档位、且不是长窗口轮时才给（长窗口有自己的结论）
    if (ops.length && !win) {
      lines.push('');
      if (!noopOps.length) lines.push('结论：没采到「值没变」的那一下——照提示把同一个档点两次（第 2 下就是），再点【看结果】。');
      else if (flipAll === 0 && wasteAll === 0 && jankAll === 0) lines.push('结论：值没变时全站样式翻动 0 次、白写 0 条、不掉帧（最慢帧 ' + worst + 'ms）＝未见闪屏来源（#938 修复在跑）。');
      else if (flipAll === 0 && wasteAll === 0) lines.push('结论：值没变时样式一字没写（翻动 0／白写 0），但那一下掉了 ' + jankAll + ' 帧（最慢帧 ' + worst + 'ms）＝闪的来源不在这里，多见于图片解码、字卡库体积或后台保活；把这份报告发回来。');
      else lines.push('结论：值没变仍然惊动了全站样式（真翻动 ' + flipAll + ' 次、白写 ' + wasteAll + ' 条，那一下掉帧 ' + jankAll + ' 帧、最慢帧 ' + worst + 'ms）＝#938 那型根因仍在。请先确认已更新到最新版（设置 → 关于 看版本与部署时间，顶部有「检测到新版本」就点它）；仍复现就把这份报告发回来。');
    }
    if (_other && !win) lines.push('附：另测到 ' + _other + ' 次与本抽屉无关的全站样式改写（不计入上面结论，仅供参考）。');
    // #1015 长窗口段：全程累计 + 「无操作翻动」时刻
    if (win) {
      lines.push('');
      lines.push('—— 长窗口观测（' + Math.round(win.ms / 1000) + ' 秒）——');
      lines.push('· 全站样式翻动 ' + win.flips + ' 次（:root ' + win.flipRoot + '／聊天页 ' + win.flipChat + '／群聊页 ' + win.flipGc + '）｜白写 ' + win.waste + ' 条（同值重写／空删变量／空摘 cs-* 类／样式表拆建）｜掉帧 ' + win.jank + ' 帧（>' + JANK_MS + 'ms）');
      if (win.idle) {
        lines.push('· 无操作翻动 ' + win.idle + ' 次：那一下的前 ' + (WIN_ACT_MS / 1000) + ' 秒里没有任何点击/按键/输入/滚动＝最可疑的「自己闪」（也可能是某个模块的定时刷新，按下面对照）：');
        for (var ci = 0; ci < win.clusters.length; ci++) lines.push('   ' + (ci + 1) + '. 第 ' + Math.round((win.clusters[ci].t - _winT0) / 1000) + ' 秒 · ' + win.clusters[ci].pg + ' · 连着翻动 ' + win.clusters[ci].n + ' 次');
      } else {
        lines.push('· 无操作翻动 0 次：窗口内每一次全站样式改写都发生在你操作之后的 ' + (WIN_ACT_MS / 1000) + ' 秒内＝没有「自己闪」的证据');
      }
      if (win.worst.length) lines.push('· 最慢的帧：' + win.worst.map(function (x) { return '第 ' + x.off + ' 秒 ' + x.pg + ' ' + x.ms + 'ms'; }).join('｜'));
      var wc = '';
      if (win.idle) wc = '抓到 ' + win.idle + ' 次「无操作翻动」（时刻见上）＝可能仍在闪；请把当时在做什么（打字／切页／上滑／什么都没动）和机型一起发回来。';
      else if (win.flips === 0) wc = '窗口内连一次全站样式改写都没有（连你操作后的必要写入也没有）——要么这段时间没触发会改样式的功能（换个页面、聊几句再测一轮），要么探针没生效（先确认已更新到最新版）。';
      else wc = '样式改写全部发生在你操作之后 ' + (WIN_ACT_MS / 1000) + ' 秒内＝这段时间没有可归因的闪源（未见闪屏来源）。';
      lines.push('结论（长窗口）：' + wc);
      lines.push('');
      lines.push('用法：时间越长越撞得上「用一会儿才闪」的现场——1 分钟能看出有没有，抓偶发请用 3 / 5 分钟档，期间正常聊天、打字、切页、开抽屉即可。');
    }
    return { text: lines.join('\n'), ops: ops, noopOps: noopOps.length, wasteAll: wasteAll, flipAll: flipAll, jankAll: jankAll, worstGap: worst, win: win };
  }
  function showReport() {
    var rep = buildReport();
    // #1015：长窗口轮没有「点击段」，回显改说累计量（否则会回一句「已记录 0 次点击」）
    chipSay(rep.win
      ? ('长窗口 ' + Math.round(rep.win.ms / 1000) + ' 秒：翻动 ' + rep.win.flips + '／白写 ' + rep.win.waste + '／掉帧 ' + rep.win.jank + (rep.win.idle ? '（无操作翻动 ' + rep.win.idle + ' 次）' : '（无操作翻动 0 次）'))
      : ('已记录 ' + rep.ops.length + ' 次点击 · 值没变那一下：翻动 ' + rep.flipAll + '／白写 ' + rep.wasteAll + '／掉帧 ' + rep.jankAll));
    if (!window.openModal) return rep;
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ ts: Date.now(), ver: appVer(), text: rep.text, wasteAll: rep.wasteAll, flipAll: rep.flipAll, jankAll: rep.jankAll })); } catch (e) {}
    var ctl = window.openModal('闪屏自测结果', rep.text, function () {}, {
      noInput: true, textarea: true, textareaRows: 16, big: true,
      staticText: '只在本机采样、不上传；可【复制】发给开发者。看「值没变」那一下的【全站样式翻动／白写】＝0 才算修好。',
      copyBtn: {
        label: '复制',
        fn: function (c) {
          var txt = c && c.text ? c.text() : rep.text;
          var hint = function (s) { if (c && c.hint) c.hint(s); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(function () { hint('已复制到剪贴板，直接粘贴发给开发者即可'); }, function () { hint('复制失败，请长按文本手动选中复制'); });
          } else hint('当前内核不支持一键复制，请长按文本手动复制');
        }
      }
    });
    if (ctl && ctl.okText) ctl.okText('知道了');
    return rep;
  }

  function stop() {
    if (!_on) return false;
    _on = false;
    if (_onClick) { try { document.removeEventListener('click', _onClick, true); } catch (e) {} _onClick = null; }
    for (var i = 0; i < _obs.length; i++) { try { _obs[i].disconnect(); } catch (e) {} }
    _obs.length = 0;
    for (var j = 0; j < _styleHooks.length; j++) {
      var h = _styleHooks[j];
      try { h.s.setProperty = h.set; h.s.removeProperty = h.del; } catch (e) {}
    }
    _styleHooks.length = 0;
    if (_origRemove) { try { DOMTokenList.prototype.remove = _origRemove; } catch (e) {} _origRemove = null; }
    // #1015：长窗口的逐秒倒计时与用户活动监听一并摘掉（零残留口径不变；_winMs/_winT0 留着，
    // 好让【结束】之后 report() 还能拿到这一轮的长窗口段）
    if (_winTimer) { clearTimeout(_winTimer); _winTimer = null; }
    if (_actHandler) {
      for (var ak = 0; ak < _actEvs.length; ak++) { try { document.removeEventListener(_actEvs[ak], _actHandler, true); } catch (e) {} }
      _actHandler = null;
    }
    if (_chip && _chip.parentNode) _chip.parentNode.removeChild(_chip);
    _chip = null;
    _clicks.length = 0; _ev.length = 0; _flips.length = 0; _frames.length = 0;
    return true;
  }

  function start(winMs) {
    if (_on || !window.openModal) return false;
    _on = true; _other = 0; _seen = 0; _seenIn = 0;
    _clicks = []; _ev = []; _flips = []; _frames = [];
    _winMs = 0; _winT0 = 0; _acts = []; _jankTotal = 0; _worst = [];
    if (_winTimer) { clearTimeout(_winTimer); _winTimer = null; }
    arm();
    chip();
    // #1015：给了时长＝长窗口「边用边测」，到点自动出报告；不给＝原来的「点 4 下」精确对照
    var ms = Number(winMs) || 0;
    if (ms > 0) {
      _winMs = Math.max(1000, Math.min(600000, ms));
      _winT0 = now();
      chipSay('边用边测中…剩 ' + fmtLeft(Math.round(_winMs / 1000)) + '｜正常使用本站即可');
      _winTimer = setTimeout(winTick, 1000);
    }
    return true;
  }

  function ask() {
    if (_on) { showReport(); return; }
    var ctl = window.openModal('闪屏自测（全站闪屏 / 聊天美化）', '', function (v) {
      start(WIN_DURS[String(v)] || 0);
    }, {
      noInput: true,
      // #1015：默认档从「点 4 下」换成 1 分钟长窗口——闪多发生在「用一会儿才闪」，4 下点档
      // 只量那 4 下各自的 0.7 秒。点档仍保留（它是 #938 的精确对照，能证明「值没变那一下有没有白写」）。
      warn: true, staticEmph: true,
      pills: WIN_PILLS,
      pill: '60',
      staticText: '**⚠ 只点 4 下只能量到那 4 下的 0.7 秒**——打字闪、切页闪、用一会儿才闪的现场它不在场；要抓这类请用 **1 分钟档（已设为默认）**：点【开始】后照常使用本站，到点自动出报告。\n\n【1 / 3 / 5 分钟】＝边用边测：正常聊天、打字、切页、开抽屉都行，报告会数「全站样式翻动几次／白写几条／掉帧几帧」，并单独挑出「没有任何操作却自己翻动」的时刻（最可疑的闪源，带第几秒与所在页）。\n【点 4 下】＝精确对照：去 聊天设置（或 群聊设置）→ 美化 → 边看边调，按屏幕顶部提示点 4 下（①气泡框大小选 宽松 ②再点一次 宽松＝值没变那一下 ③紧凑 ④标准），点完点浮条【看结果】。\n\n机制：只读采样——数每次改写让整篇文档的样式重解析了几次、其中几次是「值没变的白写」，并用 rAF 量真实帧间隔。不改你的任何设置、不写业务数据，点【结束】即摘掉全部探针。'
    });
    if (ctl && ctl.okText) ctl.okText('开始');
  }

  function boot() {
    var row = document.getElementById('row-flash-check');
    if (row && !row.__fc) {
      row.__fc = 1;
      row.addEventListener('click', ask);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.mochiFlashCheck = {
    start: start,
    stop: stop,
    report: buildReport,
    showReport: showReport,
    running: function () { return _on; },
    ops: function () { return collect(); },
    winStats: winStats,
    WIN_DURS: WIN_DURS,
    LAST_KEY: LAST_KEY,
    VAR_NS: VAR_NS
  };
})();
