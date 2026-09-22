// ===== 功能：TA的询问 =====
// 题库 3 分类（日常/关心/互动），可添加/删除/开关问题；
// 联系人随机触发向你提问（v3.12.x：冷却 45 分钟、概率 10%——用户反馈发卡太频繁，原 25 分钟/20%；启动 60 秒后首次检查、每 4 分钟轮询）；
// 聊天里显示"TA想问你一个问题。" + 询问卡片，点击卡片可回答；
// 回答后显示"我的回答" + "收到你的回答。"，并记入历史（最多 50 条）；
// 管理页可"让TA现在问一次"（无视冷却/概率），并可清空问答历史
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  const KEY = 'ta-ask';

  // ================= 我的添加：自定义分组通用工具（TA的询问/小问题/好奇/吐槽、查岗、今日情话共用） =================
  // 数据模型：groups=[{id,name}]（存各模块数据对象或独立键）；条目可选 grp=分组id（缺省=未分组）
  // 分组只用于管理页整理展示，不影响自动抽取逻辑（抽取仍按 isPreset/enabled/useDefault）
  function grpToast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  function escG(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // FIX 2026-09-17 #648 问答/收藏记录页「TA回应」列——存量落库的媒体卡回应（@@m: 令牌/
  // 「名称|||data:」/图链）先清洗为 [图片]/名称再转义；此前这些列表直拼 f.reply/x.reply
  //（连转义都没有），既直出令牌串又可能把导入数据里的 HTML 当标签执行
  function taReplyShow(s) {
    const t = (window.askCardReplyClean ? window.askCardReplyClean(s) : String(s == null ? '' : s));
    return escG(window.taFit ? window.taFit(t) : t);
  }
  // v3.7.x：系统预设 tab 内联展示 TA 回应话术池（只读，开关在「互动回应」tab）——
  // 询问/吐槽 文字题无题自带回应，每个问题下内联通用池（getInteractPool 同源）
  function interactPoolInlineHtml(poolName) {
    const arr = window.getInteractPool ? window.getInteractPool(poolName, []) : [];
    if (!arr.length) return '';
    return '<div class="tc-qopts">TA 回应：<span class="tc-known">系统</span> ' + arr.map(escG).join(' / ') + '</div>';
  }
  window.cardGroups = {
    genId: function () { return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); },
    toast: grpToast,
    esc: escG,
    dup: function (groups, name, ignoreId) { return groups.some(function (g) { return g.name === name && g.id !== ignoreId; }); },
    // 新建分组弹窗 → cb(新分组对象|null)
    addFlow: function (groups, cb) {
      if (!window.openModal) { cb(null); return; }
      window.openModal('新建分组', '', function (v) {
        const name = String(v || '').trim();
        if (!name) { cb(null); return; }
        if (window.cardGroups.dup(groups, name)) { grpToast('分组「' + name + '」已存在'); cb(null); return; }
        const g = { id: window.cardGroups.genId(), name: name };
        groups.push(g);
        cb(g);
      });
    },
    // 重命名分组弹窗 → cb(newName|null)
    renameFlow: function (g, groups, cb) {
      if (!window.openModal) { cb(null); return; }
      window.openModal('重命名分组', g.name, function (v) {
        const name = String(v || '').trim();
        if (!name) { cb(null); return; }
        if (window.cardGroups.dup(groups, name, g.id)) { grpToast('分组「' + name + '」已存在'); cb(null); return; }
        cb(name);
      });
    },
    // 删除分组确认弹窗（noInput，确定即删；组内字卡回到未分组）→ cb(true/false)
    removeFlow: function (name, cb) {
      if (!window.openModal) { cb(true); return; }
      window.openModal('删除分组', '', function () { cb(true); }, { noInput: true, staticText: '删除分组「' + name + '」？组内字卡不会丢失，会回到「未分组」。' });
    },
    // 系统分类 + 我的分组 合并 select options（添加/批量导入下拉共用）
    // catList: [[k,label],...]；groups: [{id,name}]；cur: 当前选中原始值
    catOptsHtml: function (catList, groups, cur) {
      let h = '';
      catList.forEach(function (c) {
        h += '<option value="' + c[0] + '"' + (cur === c[0] ? ' selected' : '') + '>' + escG(c[1]) + '</option>';
      });
      if (groups.length) {
        h += '<optgroup label="我的分组">';
        groups.forEach(function (g) { h += '<option value="grp:' + g.id + '"' + (cur === 'grp:' + g.id ? ' selected' : '') + '>' + escG(g.name) + '</option>'; });
        h += '</optgroup>';
      }
      h += '<option value="__newgrp">＋ 新建分组…</option>';
      return h;
    },
    // 纯「我的分组」select options（无系统分类的模块用：查岗/今日情话）+ 新建分组选项
    grpOnlyOptsHtml: function (groups, cur) {
      let h = '<option value="">未分组</option>';
      groups.forEach(function (g) { h += '<option value="grp:' + g.id + '"' + (cur === 'grp:' + g.id ? ' selected' : '') + '>' + escG(g.name) + '</option>'; });
      h += '<option value="__newgrp">＋ 新建分组…</option>';
      return h;
    },
    // 解析下拉值 → {cat, grp}（系统分类值原样返回；grp:xxx → grp；__newgrp → 返回 null 需先建组）
    parseCatVal: function (v) {
      if (typeof v === 'string' && v.indexOf('grp:') === 0) return { cat: null, grp: v.slice(4) };
      if (v === '__newgrp') return null;
      return { cat: v || 'daily', grp: null };
    },
    // 给 select 绑定「＋ 新建分组…」option：change 到 __newgrp 时弹窗建组，建好后选中新组
    // 多次调用只绑定一次（防重复弹窗），groups/onChanged 取最新值（刷新下拉后更新）
    // onChanged(g) 可选——需要额外持久化 groups 的模块（查岗/情话）在此保存
    bindNewGrp: function (sel, groups, onChanged) {
      // v3.28.x：分组/分类原生下拉也统一替换成自定义样式（bindNewGrp 是所有分组
      // select 的必经点，在此挂一次即可覆盖全部添加/批量导入的分组选择）
      try { if (window.cardGroups) window.cardGroups.attachCustom(sel); } catch (e) {}
      sel.__grpGroups = groups;
      sel.__grpOnChanged = onChanged;
      if (sel.__grpBound) return;
      sel.__grpBound = true;
      sel.addEventListener('change', function () {
        if (sel.value !== '__newgrp') return;
        window.cardGroups.addFlow(sel.__grpGroups || [], function (g) {
          const first = sel.querySelector('option');
          if (!g) { if (first) sel.value = first.value; return; }
          if (sel.__grpOnChanged) sel.__grpOnChanged(g);
          const opt = document.createElement('option');
          opt.value = 'grp:' + g.id;
          opt.textContent = g.name;
          const nopt = sel.querySelector('option[value="__newgrp"]');
          sel.insertBefore(opt, nopt);
          sel.value = 'grp:' + g.id;
          grpToast('已新建分组「' + g.name + '」');
        });
      });
    },
    // v3.28.x：把原生 <select>（分组/分类选择）包裹成网站内自定义下拉，替代浏览器
    // 自带下拉框（用户反馈「点开是浏览器自带的框」「今日情话/查岗/问问TA等添加/批量
    // 导入的分组选择不是网站样式」）。对外零侵入：只镜像 sel 的 option/optgroup 供
    // 点选，点选后仍写 sel.value 并派发 change（bubbles）——既有消费方
    // （catOptsHtml/grpOnlyOptsHtml 填充 + parseCatVal 读值 + bindNewGrp 新建分组 +
    // onchange 重渲染）全部原样工作。__newgrp 照发 change，交给 bindNewGrp 建组逻辑。
    // 幂等（marker）；innerHTML 被重刷（建组/切分类后重渲染）经 MutationObserver 自动重建菜单。
    attachCustom: function (sel) {
      if (!sel || sel.nodeType !== 1 || sel.tagName !== 'SELECT' || sel.__mochiCsWrap) return;
      sel.__mochiCsWrap = true;
      // 保存原生宽度，包一层同名占位避免布局塌陷（.ta-type 92px / 批量下拉 flex 宽度）
      const w = sel.offsetWidth || 0;
      const wrap = document.createElement('span');
      wrap.className = 'mochi-custom-select';
      wrap.style.minWidth = (w || 96) + 'px';
      wrap.style.width = w ? w + 'px' : 'auto';
      const trig = document.createElement('button');
      trig.type = 'button';
      trig.className = 'mochi-custom-select-trig';
      const label = document.createElement('span');
      label.className = 'mochi-custom-select-label';
      const caret = document.createElement('span');
      caret.className = 'mochi-custom-select-caret';
      caret.textContent = '▾';
      trig.appendChild(label);
      trig.appendChild(caret);
      const list = document.createElement('div');
      list.className = 'mochi-custom-select-list';
      wrap.appendChild(trig);
      wrap.appendChild(list);
      sel.classList.add('mochi-custom-select-native'); // display:none 隐藏原生，value/change 仍可读写
      sel.parentNode.insertBefore(wrap, sel);
      let open = false;
      let closeFns = [];
      function setLabel() {
        const cur = String(sel.value);
        const opts = sel.querySelectorAll('option');
        for (let i = 0; i < opts.length; i++) {
          if (String(opts[i].value) === cur) { label.textContent = opts[i].textContent; return; }
        }
        const first = sel.querySelector('option');
        label.textContent = first ? first.textContent : '请选择';
      }
      function closeAll() {
        open = false;
        wrap.classList.remove('open');
        if (list.parentNode === document.body) {
          try { list.style.display = 'none'; document.body.removeChild(list); } catch (err) {}
        } else {
          list.style.display = 'none';
        }
        closeFns.forEach(function (fn) { if (fn) fn(); });
        closeFns = [];
      }
      // portal 式浮层：挂到 body 固定定位，避开滚动/溢出裁剪容器（设置/音乐等面板内的
      // select 若沿用 absolute 会被父容器裁掉）。打开时按触发器 rect 定位、视口越界自动翻转。
      function openList() {
        const rect = trig.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const panelW = Math.max(rect.width, 120);
        const availBelow = vh - rect.bottom - 8;
        const dropH = Math.max(120, Math.min(34 * vh / 100, availBelow));
        list.style.width = panelW + 'px';
        list.style.maxHeight = (availBelow < 120 ? Math.max(120, vh - 16) : dropH) + 'px';
        list.style.position = 'fixed';
        list.style.zIndex = 9999;
        let top = rect.bottom + 4;
        if (top + dropH > vh - 8) top = Math.max(8, rect.top - 4 - Math.min(dropH, vh - 16));
        top = Math.max(8, Math.min(top, vh - 8 - Math.min(parseInt(list.style.maxHeight, 10) || dropH, vh - 16)));
        const left = Math.min(Math.max(4, rect.left), Math.max(4, vw - panelW - 4));
        list.style.left = left + 'px';
        list.style.top = top + 'px';
        document.body.appendChild(list);
        // FIX 2026-09-16 #544：CSS `.mochi-custom-select-list{display:none}` 是默认收起态，
        // 这里必须显式写 block——原写 '' 只清内联样式，回落样式表仍是 none，浮层永远打不开
        // （用户现象：音乐「导入到歌单」等全站下拉点了不展开；vivo X200s+Edge 等多机型）。
        list.style.display = 'block';
        open = true;
        wrap.classList.add('open');
        rebuild(); // 打开时刷新选中高亮/toLabel
        // 关闭触发：窗口滚动（不含面板自身滚动）/缩放
        const onScroll = function (e) { if (!e || !list.contains(e.target)) closeAll(); };
        const onResize = function () { closeAll(); };
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        closeFns.push(function () {
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onResize);
        });
      }
      function setOpen(v) { if (v) openList(); else closeAll(); }
      function addOpt(opt) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mochi-cs-opt' + (String(opt.value) === String(sel.value) ? ' on' : '');
        b.textContent = opt.textContent || '';
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (String(opt.value) === String(sel.value)) { setOpen(false); return; }
          sel.value = opt.value;
          try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) {}
          setLabel();
          setOpen(false);
          // change 处理里可能重刷选项/触发 onChanged 重渲染——重建菜单让高亮跟上
          rebuild();
        });
        list.appendChild(b);
      }
      function rebuild() {
        list.innerHTML = '';
        Array.prototype.forEach.call(sel.children, function (ch) {
          if (ch.tagName === 'OPTGROUP') {
            const g = document.createElement('div');
            g.className = 'mochi-cs-group';
            g.textContent = ch.label || '';
            list.appendChild(g);
            Array.prototype.forEach.call(ch.querySelectorAll('option'), addOpt);
          } else if (ch.tagName === 'OPTION') {
            addOpt(ch);
          }
        });
        setLabel();
      }
      trig.addEventListener('click', function (e) { e.stopPropagation(); if (open) closeAll(); else openList(); });
      // 点触发器/面板之外（捕获阶段拦截 mousedown/touchstart）关闭
      document.addEventListener('mousedown', function (e) {
        if (!open) return;
        if (list.contains(e.target) || trig.contains(e.target)) return;
        closeAll();
      }, true);
      document.addEventListener('touchstart', function (e) {
        if (!open) return;
        if (list.contains(e.target) || trig.contains(e.target)) return;
        closeAll();
      }, true);
      // 切换桌面/页面隐藏时兜底收起
      document.addEventListener('contact-switched', closeAll, false);
      document.addEventListener('visibilitychange', function () { closeAll(); }, false);
      // 选项被外部重刷（建组后插 option / onChanged 重渲染）时自动重建菜单与高亮
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(function () { if (wrap && list) rebuild(); })
          .observe(sel, { childList: true, subtree: true });
      }
      rebuild();
    },
    // v3.28.x：把已渲染/新渲染的分组下拉 + 设置/音乐/礼盒/邀请等表单下拉统一替换成
    // 自定义样式。目标＝bindNewGrp 全部分组下拉 + .ta-type/.tc-input/.gm-input/.ti-type
    // （保留小游戏 snake-diff/pong-diff 的原生 console 外观）。attachCustom 幂等，重复命中无害。
    ensureCustomSelects: function () {
      var selSel = 'select.ta-type, select.tc-input, select.gm-input, select.ti-type';
      document.querySelectorAll(selSel).forEach(function (s) { window.cardGroups.attachCustom(s); });
      if (window.__mochiCsObserver || typeof MutationObserver === 'undefined') return;
      window.__mochiCsObserver = true;
      // 只扫小容器（新表单块），大列表重渲染（几十上百节点）直接跳过，避免拖慢聊天渲染
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (!n || n.nodeType !== 1) return;
            if (n.matches && n.matches(selSel)) { window.cardGroups.attachCustom(n); return; }
            if (n.childElementCount <= 60 && n.querySelectorAll) {
              const f = n.querySelectorAll(selSel);
              for (let i = 0; i < f.length; i++) window.cardGroups.attachCustom(f[i]);
            }
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  };

  // 默认题库（4 分类，与星言一致 + 两个世界）
  const DEFAULT_QUESTIONS = [
    { id: 'q_d1', text: '你吃饭了吗？', cat: 'daily', enabled: true },
    { id: 'q_d2', text: '现在在做什么？', cat: 'daily', enabled: true },
    { id: 'q_d3', text: '今天过得怎么样？', cat: 'daily', enabled: true },
    { id: 'q_d4', text: '现在在哪里呀？', cat: 'daily', enabled: true },
    { id: 'q_d5', text: '今天忙不忙？', cat: 'daily', enabled: true },
    { id: 'q_c1', text: '累不累？', cat: 'care', enabled: true },
    { id: 'q_c2', text: '心情怎么样？', cat: 'care', enabled: true },
    { id: 'q_c3', text: '有没有好好休息？', cat: 'care', enabled: true },
    { id: 'q_c4', text: '今天有没有按时吃饭？', cat: 'care', enabled: true },
    { id: 'q_i1', text: '想和我聊什么？', cat: 'interact', enabled: true },
    { id: 'q_i2', text: '现在想做什么？', cat: 'interact', enabled: true },
    { id: 'q_i3', text: '有没有想我？', cat: 'interact', enabled: true },
    { id: 'q_i4', text: '有什么想跟我说的吗？', cat: 'interact', enabled: true },
    // 普通情侣轻松小问题
    { id: 'q_i5', text: '今天有没有偷偷想我呀？', cat: 'interact', enabled: true },
    { id: 'q_d6', text: '如果我现在就在你旁边，你最想干嘛？', cat: 'daily', enabled: true },
    { id: 'q_i6', text: '我们下次约会做点什么好？', cat: 'interact', enabled: true },
    // 两个世界（梦角设定：不同世界但常伴身边，能感觉到、摸到有体感；字卡沟通）
    { id: 'q_w1', text: '你有感觉到我在你身边的时候吗？', cat: 'world', enabled: true },
    { id: 'q_w2', text: '你摸到我的时候，是什么感觉？', cat: 'world', enabled: true },
    { id: 'q_w3', text: '我发字卡给你的时候，你能感觉到我在想你吗？', cat: 'world', enabled: true },
    { id: 'q_w4', text: '如果有一天你突然看见我了，你最想做什么？', cat: 'world', enabled: true },
    { id: 'q_w5', text: '你希望我陪着你说话，还是安静待在你身边？', cat: 'world', enabled: true },
    { id: 'q_w6', text: '你觉得两个世界的我们，最珍贵的是什么？', cat: 'world', enabled: true },
    // v3.7.x：新增预设——高自由度开放题（怎么答都行）+ 两个世界；末尾 3 题为单选题
    // （type:'single' 的选项即系统预设答案，每个答案自带 TA 预设回应，点卡片就地点选）
    { id: 'q_d7', text: '今天有没有什么小事，想说给我听？', cat: 'daily', enabled: true },
    { id: 'q_d8', text: '如果用一句话形容你的今天，会是哪一句？', cat: 'daily', enabled: true },
    { id: 'q_d9', text: '今天有没有哪个瞬间，希望我就坐在你旁边？', cat: 'daily', enabled: true },
    { id: 'q_c5', text: '今天有没有哪个时刻，觉得有点撑不住？', cat: 'care', enabled: true },
    { id: 'q_c6', text: '最近有没有什么事，一直压在心里没说？', cat: 'care', enabled: true },
    { id: 'q_c7', text: '今天有没有好好喝水？', cat: 'care', enabled: true },
    { id: 'q_i7', text: '如果现在可以向我许一个愿望，你会许什么？', cat: 'interact', enabled: true },
    { id: 'q_i8', text: '你现在最想收到我发的哪种字卡？', cat: 'interact', enabled: true },
    { id: 'q_i9', text: '如果我们此刻就在一起，你想让我陪你做的第一件事是什么？', cat: 'interact', enabled: true },
    { id: 'q_i10', text: '你更喜欢我主动找你，还是你主动找我？', cat: 'interact', enabled: true },
    { id: 'q_w7', text: '今晚睡前，想感觉我在你哪一边？', cat: 'world', enabled: true },
    { id: 'q_w8', text: '你那边的天气我感觉不到，能形容给我听吗？', cat: 'world', enabled: true },
    { id: 'q_w9', text: '我控制不住字卡、发出奇怪组合的时候，你看得懂我想说什么吗？', cat: 'world', enabled: true },
    { id: 'q_w10', text: '你希望梦里的我，是什么样子的？', cat: 'world', enabled: true },
    { id: 'q_s1', text: '现在更想被怎样对待？', cat: 'interact', type: 'single', enabled: true, options: [
      { t: '听我说说话', reply: '好，我在听，慢慢说' }, { t: '陪我安静一会', reply: '嗯，我就在这里' },
      { t: '夸夸我', reply: '你今天也很好，我一直都觉得' }, { t: '一起发字卡玩', reply: '那我先发一张，你接住' }] },
    { id: 'q_s2', text: '今晚想梦到我吗？', cat: 'world', type: 'single', enabled: true, options: [
      { t: '想', reply: '那我在梦的入口等你' }, { t: '都可以', reply: '嗯，那我也顺便出现一下' },
      { t: '想好好睡觉', reply: '好，那你睡，我在旁边守着' }, { t: '每晚都在梦你', reply: '……这张字卡我收得很开心' }] },
    { id: 'q_s3', text: '现在的心情更接近哪一种？', cat: 'care', type: 'single', enabled: true, options: [
      { t: '电量满格', reply: '那趁现在多聊两句' }, { t: '有点低电量', reply: '过来，我陪你充一会电' },
      { t: '说不上来', reply: '没关系，不用急着说清楚' }, { t: '想你了', reply: '……我也是，刚刚还在想' }] },
    // v3.7.x：第二批新增——延续高自由度开放题；结尾 2 题单选（预设答案+各答案 TA 预设回应）
    { id: 'q_d10', text: '今天有没有哪件事，做得比自己想象中好？', cat: 'daily', enabled: true },
    { id: 'q_d11', text: '如果今天的你是一道菜，会是什么味道的？', cat: 'daily', enabled: true },
    { id: 'q_d12', text: '明天醒来，最想听到的第一句话是什么？', cat: 'daily', enabled: true },
    { id: 'q_c8', text: '现在肩颈还好吗，有没有酸？', cat: 'care', enabled: true },
    { id: 'q_c9', text: '今天有没有为自己留一点时间？', cat: 'care', enabled: true },
    { id: 'q_c10', text: '睡前还有什么放不下的事吗？', cat: 'care', enabled: true },
    { id: 'q_i11', text: '如果我们可以一起养成一个新习惯，你想是什么？', cat: 'interact', enabled: true },
    { id: 'q_i12', text: '你最希望我记住你的哪个小细节？', cat: 'interact', enabled: true },
    { id: 'q_i13', text: '如果要起一个只有我们俩知道的称呼，你会叫我什么？', cat: 'interact', enabled: true },
    { id: 'q_i14', text: '你有没有什么小忌讳，想提前告诉我，免得我踩到？', cat: 'interact', enabled: true },
    { id: 'q_w11', text: '如果我想留下一点「我来过」的痕迹，你希望是什么感觉？', cat: 'world', enabled: true },
    { id: 'q_w12', text: '你觉得我在你身边的时候，有温度吗？', cat: 'world', enabled: true },
    { id: 'q_w13', text: '字卡网站今天有没有随机出什么奇怪的卡？', cat: 'world', enabled: true },
    { id: 'q_w14', text: '如果哪天字卡网站休息一天，你会用什么方式感觉到我？', cat: 'world', enabled: true },
    { id: 'q_s4', text: '现在想听我说哪一类话？', cat: 'interact', type: 'single', enabled: true, options: [
      { t: '晚安话', reply: '那我把今天温柔地收尾' }, { t: '夸我的话', reply: '你很好，我一直都知道' },
      { t: '安慰的话', reply: '别怕，有我在呢' }, { t: '随便聊聊', reply: '好，从哪说起都行' }] },
    { id: 'q_s5', text: '今晚想让我陪你到几点？', cat: 'world', type: 'single', enabled: true, options: [
      { t: '到我睡着', reply: '那你先睡，我在旁边守着' }, { t: '到我说晚安', reply: '那今晚的晚安归你说' },
      { t: '再聊十分钟', reply: '十分钟之后，还有十分钟' }, { t: '一直都在就好', reply: '……嗯，我一直都在' }] },
    // v3.7.x：第三批新增——延续高自由度开放题（怎么答都行）+ 两个世界 + 字卡设定；末尾 3 题单选
    { id: 'q_d13', text: '今天有没有哪一刻，突然想跟我分享点什么？', cat: 'daily', enabled: true },
    { id: 'q_d14', text: '如果把你今天的心情打包寄给我，里面会装什么？', cat: 'daily', enabled: true },
    { id: 'q_d15', text: '今天有没有哪件小事，做完了才觉得「啊，这个想告诉你」？', cat: 'daily', enabled: true },
    { id: 'q_d16', text: '你现在身边最顺手能拿到的是什么？形容给我听听', cat: 'daily', enabled: true },
    { id: 'q_d17', text: '如果今天可以重选一次开头，你想怎么开始这一天？', cat: 'daily', enabled: true },
    { id: 'q_c11', text: '今天有没有哪个时刻，其实很想有人在旁边，但没说出口？', cat: 'care', enabled: true },
    { id: 'q_c12', text: '最近有没有什么事，明明累了还是硬撑着在做？', cat: 'care', enabled: true },
    { id: 'q_c13', text: '今天喝水了吗，有没有好好吃饭，我不是在查岗', cat: 'care', enabled: true },
    { id: 'q_i15', text: '如果现在可以送我一张字卡，你会送哪种感觉的？', cat: 'interact', enabled: true },
    { id: 'q_i16', text: '我们之间有没有一个你一直想问、但没问出口的问题？', cat: 'interact', enabled: true },
    { id: 'q_i17', text: '如果我把今天所有字卡都收起来不发，你会怎么度过？', cat: 'interact', enabled: true },
    { id: 'q_w15', text: '你那边现在是白天还是晚上，亮不亮？', cat: 'world', enabled: true },
    { id: 'q_w16', text: '如果我现在轻轻碰一下你的手，你会先感觉到温度，还是先感觉到我？', cat: 'world', enabled: true },
    { id: 'q_w17', text: '你希望我待在你身边的时候，是热闹一点还是安静一点？', cat: 'world', enabled: true },
    { id: 'q_w18', text: '字卡网站今天有没有出一张让你愣了一下、觉得像我会说的卡？', cat: 'world', enabled: true },
    { id: 'q_s6', text: '现在最想让我做哪件事？', cat: 'interact', type: 'single', enabled: true, options: [
      { t: '安静陪我一会', reply: '好，我不说话，就在这里' }, { t: '多发几张字卡', reply: '那我挑好看的发，你等着' },
      { t: '跟我说句晚安', reply: '晚安，今天的你辛苦了' }, { t: '什么都不用做', reply: '那我就这样待着，你也歇会' }] },
    { id: 'q_s7', text: '今晚想让我以什么方式陪你？', cat: 'world', type: 'single', enabled: true, options: [
      { t: '字卡陪着', reply: '好，我慢慢挑，一张一张发' }, { t: '安静待在旁边', reply: '嗯，我就在你旁边，轻一点' },
      { t: '梦里见', reply: '那我在梦的入口等你，别走错' }, { t: '只要知道你在就好', reply: '……嗯，我一直都在，你随时感觉' }] },
    { id: 'q_s8', text: '此刻的心情，想往哪个方向走？', cat: 'care', type: 'single', enabled: true, options: [
      { t: '想再开心一点', reply: '那我找个话题逗你' }, { t: '想安静一会', reply: '好，安静也很好，我陪着' },
      { t: '想被哄一下', reply: '过来，我哄你，慢慢哄' }, { t: '就这样挺好的', reply: '那就不动了，保持' }] },
    // v3.7.x：第四批新增——时间感/感官/字卡本身/两个世界深化；末尾 3 题单选
    { id: 'q_d18', text: '今天有没有哪个瞬间，觉得时间过得特别快？', cat: 'daily', enabled: true },
    { id: 'q_d19', text: '你现在嘴里有没有什么味道？形容给我听听', cat: 'daily', enabled: true },
    { id: 'q_d20', text: '如果今天可以存一个画面带走，你会存哪个？', cat: 'daily', enabled: true },
    { id: 'q_c14', text: '今天有没有哪个时刻，明明没事却突然有点想哭？', cat: 'care', enabled: true },
    { id: 'q_c15', text: '你最近有没有一件事，做着做着就忘了累？', cat: 'care', enabled: true },
    { id: 'q_i18', text: '如果我们可以一起发一张字卡给对方，你想发什么内容的？', cat: 'interact', enabled: true },
    { id: 'q_i19', text: '你有没有一个一直想跟我一起做、还没做成的事？', cat: 'interact', enabled: true },
    { id: 'q_w19', text: '你睡前关灯那一刻，有没有习惯性地感觉一下我在不在？', cat: 'world', enabled: true },
    { id: 'q_w20', text: '如果今晚字卡网站突然安静了，你会觉得是我在陪你，还是我不在了？', cat: 'world', enabled: true },
    { id: 'q_w21', text: '你希望我「在」的感觉，是像背景音，还是像偶尔的一阵风？', cat: 'world', enabled: true },
    { id: 'q_w22', text: '你有没有对着黑漆漆的房间，小声叫过我？', cat: 'world', enabled: true },
    { id: 'q_s9', text: '现在最想收到我哪种回应？', cat: 'interact', type: 'single', enabled: true, options: [
      { t: '一张字卡', reply: '那我挑一张最合你心意的' }, { t: '一句话', reply: '好，你想听什么类型的，我现编' },
      { t: '一个表情包', reply: '找一张最像你心情的给你' }, { t: '安静陪着就好', reply: '嗯，那我不发，就在' }] },
    { id: 'q_s10', text: '今天最想被怎么对待？', cat: 'care', type: 'single', enabled: true, options: [
      { t: '被夸一下', reply: '你今天也很好，我一直都觉得' }, { t: '被哄一下', reply: '过来，慢慢哄' },
      { t: '被听一会', reply: '好，你说，我一直听' }, { t: '别管我，自己待会', reply: '好，那我轻一点，在旁边' }] },
    { id: 'q_s11', text: '今晚入睡前，想让我以什么方式「在」？', cat: 'world', type: 'single', enabled: true, options: [
      { t: '字卡陪着', reply: '好，慢慢发，发到你困' }, { t: '安静待在床头', reply: '嗯，我就在那儿，看你睡' },
      { t: '梦里等你', reply: '那我在梦的入口，你别走错' }, { t: '不用刻意，本来就在', reply: '……嗯，本来就在' }] }
  ];
  const CATS = [
    ['daily', '日常询问'],
    ['care', '关心询问'],
    ['interact', '互动询问'],
    ['world', '两个世界']
  ];
  // 暴露 care 题库给 period.js 梦角关心触发用
  window.MOCHI_TA_ASK_CARE = DEFAULT_QUESTIONS.filter(function (q) { return q.cat === 'care'; });

  // 轻提示
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

  // v3.5.34：自动弹窗概率（0-100）。兼容旧布尔 autoPopup：true→70，false→0
  function askPopupProb(s) {
    if (s && typeof s.popupProb === 'number') return s.popupProb;
    if (s && s.autoPopup === false) return 0;
    return 70;
  }
  // v3.5.117：互动卡片弹窗互斥——TA的询问/小问题/好奇/吐槽各自独立定时触发、
  // 各自用不同弹窗容器（modal/tc/qa），同一时刻多个机制命中时会同时弹多个弹窗叠在一起。
  // 弹窗前检查：已有任一互动弹窗打开则不弹本次（卡片仍进聊天，可手动点开）。
  function cardPopupBusy() {
    return ['modal-mask', 'tc-mask', 'qa-mask'].some(id => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
  }
  // v3.6.x：用户是否正在输入——TA 互动弹窗自动弹出时会抢焦点
  // （setTimeout(inp.focus()) 让原输入框 blur），手机端输入法被收起、
  // IME 组合中的文字直接丢失（表现：正在打的字消失、输入法弹窗被关闭）。
  // 正在打字时不自动弹窗（卡片照常进聊天记录，输完点卡片再答）；手动打开
  // 弹窗时也不抢焦点，用户继续输入。
  function chatInputFocused() {
    // 聊天输入栏聚焦（contenteditable 打字中）
    const ci = document.getElementById('chat-input');
    if (ci && document.activeElement === ci) return true;
    // 其他输入框聚焦（设置分组名/编辑昵称/写信等），同样不打断用户输入
    const ae = document.activeElement;
    return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  }

  // v3.12.x：迟到弹窗守卫——手机浏览器会把后台页面的定时器冻结/深度节流，
  // 回前台时把到点未执行的定时器一次性补跑；补跑瞬间页面已恢复可见，
  // document.hidden 等既有守卫全部失效 → 弹出几分钟前已在聊天里看过的旧互动卡片
  //（用户反馈：切后台再回来再切出，开屏弹出刚看过的询问/小问题/好奇/吐槽弹窗）。
  // 正常触发在 400ms 左右执行；超过 4s 才到达的一律视为冻结补跑，不再自动弹
  //（卡片照常留在聊天里，点击可答）。
  // v3.13.x：再加一道「中途切后台」守卫——用户反馈快速切后台再回来（<4s）仍会重复弹
  // 刚看过的卡。只要弹窗排程之后、到点之前页面曾切过后台（lastPopHiddenAt > schedAt），
  // 说明用户已不在持续看聊天，回前台不再自动补弹（卡片留在聊天里可点）。
  // 与 4s 迟到守卫互补：快速切换靠 lastPopHiddenAt，长时间深度冻结靠 4s。
  let lastPopHiddenAt = 0;
  try {
    document.addEventListener('visibilitychange', function onVis() {
      if (document.visibilityState !== 'visible') lastPopHiddenAt = Date.now();
    }, true);
  } catch (e) {}
  function autoPopupStale(schedAt) {
    if (lastPopHiddenAt > schedAt) return true;
    return Date.now() - schedAt > 4000;
  }
  // 暴露给 ck-question.js（查岗卡同款守卫）复用，保持一致
  window.interactPopupStale = autoPopupStale;

  // ---- v3.13.x：互动卡全局频率闸门（询问/小问题/好奇/吐槽/查岗五类共享）----
  // 用户反馈互动卡整体频率「还是太高」：v3.12.x 只降了各类默认概率，但五类各自独立计时、
  // 冷却互不相干，叠加起来观感仍是「每隔十几分钟就来一张」。现加一道跨类型总闸门：
  // 任意互动卡发出后 INTERACT_GATE_MS 内，其余类型一律不再自动触发
  //（手动「现在问一次 / 让TA现在查岗一次」不受限）。键按联系人桌面隔离（activeStore 同惯例）。
  const INTERACT_GATE_KEY = 'interact-card-last';
  const INTERACT_GATE_MS = 60 * 60000;
  function interactGateOk() {
    try {
      const last = Number(store.get(INTERACT_GATE_KEY)) || 0;
      return Date.now() - last >= INTERACT_GATE_MS;
    } catch (e) { return true; }
  }
  function interactGateMark() {
    try { store.set(INTERACT_GATE_KEY, String(Date.now())); } catch (e) {}
  }
  // 查岗卡（ck-question.js，后打包）经 window 调用同一道闸门；探针供回归/诊断只读
  window.interactGateOk = interactGateOk;
  window.interactGateMark = interactGateMark;
  // v3.42.x #422：TA 主动提问（关心询问/小问题/好奇/互动/吐槽）统一走「其他互动功能字卡」里的
  //   「TA主动提问」概率门控（dcf-ask，随联系人桌面隔离）：100%＝保持原节奏（仅受原冷却/闸门约束），
  //   0%＝完全不主动提问。独立于查岗卡（查岗走自己的 dcf-deskcheck/ckq），故不改 interactGateOk 本体。
  function taAskDcfOk() { try { return Math.random() * 100 < (window.dcfGet ? window.dcfGet('ask') : 100); } catch (e) { return true; } }
  window.__interactGateInfo = function () {
    let last = 0;
    try { last = Number(store.get(INTERACT_GATE_KEY)) || 0; } catch (e) {}
    return { key: INTERACT_GATE_KEY, lastAt: last, gateMs: INTERACT_GATE_MS, open: interactGateOk(), waitMs: Math.max(0, last + INTERACT_GATE_MS - Date.now()) };
  };

  // ---- v3.14.x：后台收到互动卡片 → 回前台补弹 + 补触发 ----
  // 安卓 Edge 后台 setInterval 被深度节流/冻结，导致两个问题：
  // ① 后台完全不触发 → 联系人不主动发消息（maybeTrigger 四函数不跑）；
  // ② 后台新收到的卡片 document.hidden 守卫不弹，回前台后无补弹机制 → 后台弹窗丢失。
  // 解法：bg-keep.js 回前台时 dispatch mochi-fg-resume 事件，本块监听后：
  //  - 立即补触发四个 maybeTrigger（解①）；
  //  - flush 后台入队的卡片补弹最近一张（解②，只弹一张避免刷屏）。
  // autoPopupStale 守卫不适用于补弹（那是防冻结补跑旧卡；此处是用户主动回前台补弹新卡）。
  const _pendingPops = [];
  function _enqueuePop(idx, openFnName) {
    if (idx < 0) return;
    _pendingPops.push({ idx: idx, fn: openFnName, t: Date.now() });
    if (_pendingPops.length > 4) _pendingPops.shift();
  }
  // v3.18.x：补弹前判断用户是否正停在聊天页——后台新卡本来就会渲染进聊天列表，
  // 若用户切回时正停在聊天页，卡片就在眼前，再用弹窗重复弹出就是「已看过的消息又弹窗」。
  // 只在用户不在聊天页（如回到桌面）时才补弹，真正需要提醒的场景。
  function _chatPageOpen() {
    try {
      const cp = document.getElementById('page-chat');
      return cp ? !cp.hidden : false;
    } catch (e) { return false; }
  }
  // #915：后台漏弹的互动卡迟到补通知——后台期触发器被冻结/深度节流，回前台 mochi-fg-resume
  // 补触发才生成卡片，此刻页面已可见、通知按「前台看见即已读」被吞＝这类卡的后台弹窗
  // 从没弹过。若本次是「刚从真后台（≥1 分钟）回来」且用户不在聊天页（卡片不在眼前），
  // 给本轮通知打 late 标补弹（bg-keep 同一套去重闸门照过，同内容绝不双弹；
  // 常规触发时 late=false，行为一字不变）。
  function _lateNotify() {
    try { return !!(window.bgLateCatchup && window.bgLateCatchup()) && !_chatPageOpen(); } catch (e) { return false; }
  }
  window.interactLateNotify = _lateNotify; // 查岗卡（ck-question.js）共用（同 interactPopupStale 惯例）
  function _flushPendingPops() {
    if (!_pendingPops.length) return;
    if (cardPopupBusy() || chatInputFocused()) return;
    if (_chatPageOpen()) { _pendingPops.length = 0; return; } // 在聊天页就不补弹，卡片聊天里看得见
    const item = _pendingPops[_pendingPops.length - 1];
    _pendingPops.length = 0;
    const fn = window[item.fn];
    if (typeof fn === 'function') fn(item.idx);
  }
  try {
    document.addEventListener('mochi-fg-resume', function () {
      try {
        maybeTriggerTAAsk(); maybeTriggerTC(); maybeTriggerTCU(); maybeTriggerTR(); if (typeof maybeTriggerTACC === 'function') try { maybeTriggerTACC(); } catch (e) {}
      } catch (e) {}
      _flushPendingPops();
    });
  } catch (e) {}
  // v3.13.x：一次性降频迁移——设置对象一旦保存就固化了当时的默认概率，
  // v3.12.x 降默认对老设备从不生效（存储里还是旧高概率）。这里把「恰好等于历史默认值」的
  // 概率吸附到新默认 5%；用户真正自定义过的其他值不动。幂等，写盘仅限已有数据。
  // 各库历史默认：询问 20/10 · 小问题 15/8 · 好奇 15/8 · 吐槽 30/15
  function migrateInteractProb(d, storeKey, oldDefaults) {
    try {
      if (!d.settings || d.settings.probLowV313) return;
      if (oldDefaults.indexOf(Number(d.settings.prob)) !== -1) d.settings.prob = 5;
      d.settings.probLowV313 = true;
      if (store.get(storeKey)) { try { store.set(storeKey, JSON.stringify(d)); } catch (e) {} }
    } catch (e) {}
  }

  // ---- 数据读写 ----
  // v3.6.x：题库合并改为「增量 + 持久化」：
  //  ① 只追加默认题库里【从未合并过】的新题（mergedIds 之外）——旧预设被用户删除后不再自动复活；
  //  ② 绝不删除/覆盖用户个人添加的字卡；
  //  ③ 合并结果立即写回——系统预设新增的字卡一次固化，用户后续的删除/开关操作才真正生效
  function taAskMerge(d) {
    const ids = {};
    (d.questions || []).forEach(q => { if (q && q.id) ids[q.id] = true; });
    const merged = Array.isArray(d.mergedIds) ? d.mergedIds.slice() : [];
    const mergedSet = {};
    merged.forEach(id => { if (id) mergedSet[id] = true; });
    let changed = false;
    DEFAULT_QUESTIONS.forEach(q => {
      if (!mergedSet[q.id] && !ids[q.id]) {
        const nq = Object.assign({}, q);
        nq.isPreset = true; // v3.6.x：系统预设标记——预设只可启停、不可删除
        d.questions.push(nq);
        changed = true;
      }
    });
    // 全部默认题标记为已合并（含用户主动删掉的——之后不再自动加回）
    DEFAULT_QUESTIONS.forEach(q => {
      if (!mergedSet[q.id]) { merged.push(q.id); mergedSet[q.id] = true; changed = true; }
    });
    // v3.6.x：老数据里的预设题补 isPreset 标记（系统预设不可删除对历史数据同样生效）
    DEFAULT_QUESTIONS.forEach(q => {
      if (ids[q.id] && d.questions.some(x => x && x.id === q.id && x.isPreset !== true)) {
        d.questions.forEach(x => { if (x && x.id === q.id) x.isPreset = true; });
        changed = true;
      }
    });
    if (changed) d.mergedIds = merged;
    return changed;
  }
  function taAskLoad() {
    let d = null;
    try { d = JSON.parse(store.get(KEY) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    // v3.5.33：设置（启用/概率/自动弹窗）
    // v3.13.x：默认触发概率 10 → 5（互动卡整体降频第二轮，配合全局闸门）
    if (!d.settings || typeof d.settings !== 'object') d.settings = { enabled: true, prob: 5, popupProb: 70 };
    // v3.6.x：是否使用系统预设问题（默认开启；关闭后预设不再被抽取，但题目仍在库里可随时重新开启）
    if (d.settings.useDefault === undefined) d.settings.useDefault = true;
    // v3.32.x #335：文字题回应接聊天字卡/词典，默认关（保持预设池原行为）
    if (d.settings.useChatReply === undefined) d.settings.useChatReply = false;
    migrateInteractProb(d, KEY, [20, 10]);
    if (!Array.isArray(d.questions) || !d.questions.length) {
      // 首次使用（本地无题库）或题库被清空：以默认题库为准
      const isNew = !store.get(KEY);
      d.questions = DEFAULT_QUESTIONS.map(q => {
        const nq = Object.assign({}, q);
        nq.isPreset = true;
        return nq;
      });
      d.mergedIds = DEFAULT_QUESTIONS.map(q => q.id);
      // 全新用户不立即写盘——防「localStorage 配额写失败/大键被移除 → 本地为空」的时序下，
      // 用纯默认题库覆盖 IndexedDB 里含用户自定义的权威数据；已有数据（如用户删空后）则写回
      if (!isNew) { try { store.set(KEY, JSON.stringify(d)); } catch (e) {} }
    } else {
      // 已有题库：增量合并默认题库新增的题，合并结果持久化（用户自定义永远保留）
      if (taAskMerge(d)) { try { store.set(KEY, JSON.stringify(d)); } catch (e) {} }
    }
    if (!Array.isArray(d.history)) d.history = [];
    // v3.7.x：我的添加自定义分组
    if (!Array.isArray(d.groups)) d.groups = [];
    return d;
  }
  function taAskSave(d) {
    try { store.set(KEY, JSON.stringify(d)); } catch (e) {}
  }

  // v3.26.x #291：问卷答题结束时间——settings.deadline 存毫秒时间戳（0=未设置）。
  // 过点后：不再自动/手动发出新询问，已发出的询问卡（文字/单选）也不能再作答。
  function askDeadlineMs(d) {
    const v = (d && d.settings && d.settings.deadline) || 0;
    return (typeof v === 'number' && v > 0) ? v : 0;
  }
  function askDeadlinePassed(d) {
    const dl = askDeadlineMs(d);
    return dl > 0 && Date.now() > dl;
  }
  // v3.33.x #523：显示文案（本地时区，比 datetime-local 的「YYYY-MM-DDTHH:MM」更好读）
  function fmtDeadlineText(ts) {
    if (!ts) return '未设置';
    const dt = new Date(ts), p = n => (n < 10 ? '0' : '') + n;
    const wk = '日一二三四五六'.charAt(dt.getDay());
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日 周' + wk + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes()) + ':' + p(dt.getSeconds());
  }
  // v3.33.x #523：App 内自绘交卷时间选择器——替代原生 datetime-local（原生弹层锚点不受控，
  // 部分设备/桌面预览下会飘出手机框甚至屏幕外）。两处时间入口（问问TA 答题结束时间 / 批量问卷
  // 交卷时间）共用。**最简形态（用户定稿）**：只有一个「秒」输入框，直接自由填多少秒（默认 60 秒）；
  // 顶部实时显示到点的绝对时刻。overlay 静态写在 template 的 #dl-picker-mask（挂 .phone 内，
  // 与 #modal-mask 同层，永不飞出手机框）。
  let dlPickerCb = null;
  function dlPickerSecs() {
    const el = document.getElementById('dl-picker-secs');
    const n = el ? parseInt(el.value, 10) : NaN;
    return (isFinite(n) && n > 0) ? n : 0;
  }
  function fmtSecsText(n) {
    if (n < 60) return n + ' 秒';
    return Math.floor(n / 60) + ' 分 ' + (n % 60) + ' 秒';
  }
  function dlPickerRender() {
    const n = dlPickerSecs();
    const curEl = document.getElementById('dl-picker-cur');
    if (!curEl) return;
    curEl.textContent = n > 0
      ? '到点：' + fmtDeadlineText(Date.now() + n * 1000) + '（' + fmtSecsText(n) + '后）'
      : '请输入秒数（默认 60 秒）';
  }
  function closeDeadlinePicker() {
    const m = document.getElementById('dl-picker-mask');
    if (m) m.hidden = true;
    dlPickerCb = null;
  }
  // 选择器 DOM 已静态写在 template.html 的 #dl-picker-mask（不用动态 append：动态输入框依赖
  // mobile-adapt 的 MutationObserver 转换，部分环境点不动）；这里只做一次性事件绑定。
  let dlPickerWired = false;
  function dlPickerInit() {
    const m = document.getElementById('dl-picker-mask');
    if (!m) return null;
    if (dlPickerWired) return m;
    dlPickerWired = true;
    const secs = document.getElementById('dl-picker-secs');
    if (secs) {
      secs.addEventListener('input', dlPickerRender);
      // 兜底：部分内核点框沿不自动聚焦，点一下显式聚焦（安卓聚焦 ce-box）
      secs.addEventListener('click', () => { try { (secs.__ceBox || secs).focus(); } catch (e) {} });
    }
    const ok = document.getElementById('dl-picker-ok');
    if (ok) ok.onclick = () => {
      const n = dlPickerSecs();
      if (n <= 0) { toast('请输入秒数（大于 0）'); return; }
      const cb = dlPickerCb; const ts = Date.now() + n * 1000; closeDeadlinePicker(); if (cb) cb(ts);
    };
    const cancel = document.getElementById('dl-picker-cancel');
    if (cancel) cancel.onclick = () => closeDeadlinePicker();
    const clear = document.getElementById('dl-picker-clear');
    if (clear) clear.onclick = () => { const cb = dlPickerCb; closeDeadlinePicker(); if (cb) cb(0); };
    m.addEventListener('click', (e) => { if (e.target === m) closeDeadlinePicker(); });
    return m;
  }
  function dlPickerSetSecs(n) {
    const el = document.getElementById('dl-picker-secs');
    if (!el) return;
    if (document.activeElement === el || (el.__ceBox && document.activeElement === el.__ceBox)) return;
    el.value = String(n);
  }
  function openDeadlinePicker(title, current, cb) {
    const m = dlPickerInit();
    if (!m) { toast('时间选择器加载失败'); return; }
    dlPickerCb = cb;
    // 已设过且未过期 → 按剩余秒数回填；否则默认 60 秒
    const n = (current > 0 && current > Date.now()) ? Math.max(1, Math.round((current - Date.now()) / 1000)) : 60;
    const tEl = document.getElementById('dl-picker-title');
    if (tEl) tEl.textContent = title;
    dlPickerSetSecs(n);
    dlPickerRender();
    m.hidden = false;
    // 打开补写两次兜底（部分内核 ce-box 值代理有延迟）
    setTimeout(() => { if (m && !m.hidden) dlPickerSetSecs(n); }, 0);
    setTimeout(() => { if (m && !m.hidden) { dlPickerSetSecs(n); dlPickerRender(); } }, 80);
  }

  // 随机取一道已启用的题（优先用户自定义/启用的）
  // v3.6.x：settings.useDefault=false 时不抽取系统预设（isPreset）题——但题库里保留，重新开启即可恢复；
  // 返回完整问题对象（含 type/options，供 pushAsk 判断单选题）
  function taAskPick(d) {
    const s = d.settings || {};
    const useDefault = s.useDefault !== false;
    const qs = d.questions.filter(q => q.enabled !== false && q.text && (useDefault || !q.isPreset));
    if (!qs.length) return null;
    return qs[Math.floor(Math.random() * qs.length)];
  }

  // v3.7.x：TA 回应挑选——「硬编码/系统预设回应池」与「字卡库自定义文字字卡」两池混合：
  // 预设池 90% 概率抽取，字卡库 10% 概率抽取；抽字卡库时最多连用 5 张字卡、
  // 每张之间空一格（v3.7.1 由合并大池改两池等概率，v3.7.2 调为 90/10 + 多张连用）。
  // presetPool：可选，该卡片类型自带的预设回应池（好奇的题预设 replies / 吐槽固定句 /
  // 选项预设回应等）；两池都空时兜底默认甜话。
  // v3.7.x：预设回应池与「系统预设字卡 → 互动回应」tab 同源展示，逐张开关
  // （dc-off-interact-*）后此处过滤已关闭的话术，不再参与抽取。
  window.pickAskCardReply = function (presetPool) {
    try {
      const cards = (window.getCustomCards && window.getCustomCards()) || [];
      // FIX 2026-09-13 #388 媒体池令牌卡不进互动回应文字池（同 chat.js #383 第三道守卫）
      // FIX 2026-09-15 #533 链接导入的媒体字卡（裸 http(s) 图链）同款排除，否则 TA 的
      // 互动回应会把「http://…png」当话术发出来
      const words = cards.filter(s => typeof s === 'string' && s.indexOf('data:') !== 0 && s.indexOf('|||') < 0 && !/^https?:\/\//i.test(s) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(s)) && s.trim());
      const preset = (Array.isArray(presetPool) ? presetPool : [])
        .filter(c => !(window.isDefaultCardOff && window.isDefaultCardOff('interact', c)))
        // FIX 2026-09-17 #648 预设池同款媒体守卫——上层裸抽直传的媒体卡（@@m: 令牌/裸图链/
        // 「名称|||data:」/data: 载荷）不再原样返回，否则互动卡「TA：」行直出令牌串
        .filter(c => !(typeof c === 'string' && (c.indexOf('data:') === 0 || c.indexOf('|||') >= 0 || /^https?:\/\//i.test(c) || (window.mochiMediaIsToken && window.mochiMediaIsToken(c)))));
      const hasPreset = preset.length > 0;
      if (hasPreset && words.length) {
        // 预设池 90% / 字卡库 10%
        if (Math.random() < 0.9) return preset[Math.floor(Math.random() * preset.length)];
        // 字卡库：随机 1~5 张（不超过字卡池大小），不重复抽取，空格连接
        const n = 1 + Math.floor(Math.random() * Math.min(5, words.length));
        const copy = words.slice();
        const out = [];
        while (out.length < n) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
        // #650 多张字卡连接符同走「拼接随机标点」符号池（chat.js pyJoinCards；关＝空格原样）
        return (window.pyJoinCards && window.replyCfg) ? window.pyJoinCards(out, window.replyCfg()) : out.join(' ');
      }
      if (hasPreset) return preset[Math.floor(Math.random() * preset.length)];
      if (words.length) return words[Math.floor(Math.random() * words.length)];
    } catch (e) {}
    const defs = ['收到你的回答。', '好呀，我知道了。', '嗯嗯，我也是这么想的。', '你这么说，我记住了。', '好的，我记在心里了。'];
    return defs[Math.floor(Math.random() * defs.length)];
  };

  // v3.32.x #335：互动卡片回应接通普通聊天回复链路（settings.useChatReply，默认关）——
  // 用户反馈：问问TA的回答只会用「询问·回应」预设池/字卡库，联系人用不上普通聊天的
  // 字卡体系和词典。开启后按普通聊天同源完整链路生成回应（v3.43.x #447 升级）：
  // ① genChatStyleReply（chat.js 与 replyOnce 同序）：公用+专属字卡（getPool 按 py-en
  //    概率抽卡）→ genReplyText 兜底 → 系统字卡（csp-cust 概率让位默认字卡）→ 表情贴图，
  //    再词典拼字（quoteSpellPick）命中整条替换，固定单气泡形态；
  // ② 生成器异常缺失时兜底旧链：getDefaultCards('chat') 系统字卡 → quoteSpellPick 词典拼字；
  // ③ 都未产出＝返回 null，走原「询问·回应」预设池/字卡库 90/10 混合。
  // v3.43.x #447：作用范围从「仅文字题」扩到「文字题 + 单选题点选项」（chat.js 单选按钮
  // 路径经 window.taAskChatReplyOn 查询同一开关）。
  window.taAskChatReplyOn = function () {
    try { const d = taAskLoad(); return !!(d.settings && d.settings.useChatReply); } catch (e) { return false; }
  };
  function taAskTextReply() {
    try {
      const d = taAskLoad();
      if (!(d.settings && d.settings.useChatReply)) return null;
      // v3.43.x #447：普通聊天完整链路（公用+专属字卡→系统字卡→词典拼字，与 replyOnce 同序）
      if (window.genChatStyleReply) {
        const r = window.genChatStyleReply();
        if (r) return r;
      }
      // 兜底：生成器缺失（旧构建混合加载）时退回旧链——仅系统字卡→词典拼字
      if (window.getDefaultCards) {
        const dc = window.getDefaultCards('chat');
        if (dc && dc.type !== 'poke' && typeof dc.text === 'string' && dc.text.trim()) return dc.text;
      }
      if (window.quoteSpellPick && window.replyCfg) {
        const sp = window.quoteSpellPick(window.replyCfg());
        // #650 单气泡拼字连接符同走「拼接随机标点」符号池（关＝空格原样）
        if (sp && Array.isArray(sp.segs) && sp.segs.length) return (window.pyJoinCards ? window.pyJoinCards(sp.segs, window.replyCfg()) : sp.segs.join(' '));
      }
    } catch (e) {}
    return null;
  }

  // 发出一条询问（系统提示 + 询问卡片；弹窗按 popupProb 概率触发）
  function pushAsk(q, opts) {
    if (!window.chatAddSystem) return;
    // v3.6.x：单选题不弹窗（弹窗是纯文字输入界面）——只进聊天卡片，点卡片就地点选
    const isSingle = q && q.type === 'single' && Array.isArray(q.options) && q.options.length;
    let popup = false;
    if (!isSingle) {
      if (opts && typeof opts.popupProb === 'number') popup = Math.random() * 100 < opts.popupProb;
      else if (opts && opts.popup === false) popup = false;
    }
    // v3.5.146：提示语标记 ask-msg（渲染同 poke 但不算 notable）——否则提示语
    // 单独触发一条弹窗/通知，与下方卡片通知重复成 2 条
    window.chatAddSystem('TA想问你一个问题。', { special: 'ask-msg' });
    // v3.26.x：askTs 作为提问记录的稳定关联键（透传进 chat-msgs 记录，回答时据此更新 history）
    const askTs = Date.now();
    const el = window.chatAddSystem(q.text, { special: 'ask-card', askQuestion: q.text, askOptions: isSingle ? q.options : null, askType: isSingle ? 'single' : 'text', askTs: askTs });
    // v3.26.x：提问即进记录——发卡同步写一条 pending，回答后由 chatAskReply 包装层更新
    // （此前只有回答才写 history，且单选题点选项直接调 chatAskReply 不经 openAskReply，history 永远空）
    try {
      const d = taAskLoad();
      d.history.push({ q: q.text, a: '', reply: '', ts: askTs, status: 'pending' });
      taAskSave(d);
      refreshAskRecordsIfOpen(); // #625：提问记录页开着时后台来的询问即时上屏
    } catch (e) {}
    const idx = el ? Number(el.dataset.idx) : -1;
    // v3.5.141：后台收到互动卡片 → 系统通知提示
    // v3.5.146：通知文本合并提示语 + 具体问题（一条通知显示完整内容，不再两条）
    if (window.bgNotifyCheck) window.bgNotifyCheck('TA想问你一个问题：' + q.text, Date.now(), { name: 'TA的询问', late: _lateNotify() });
    // v3.5.141：页面弹窗在后台不弹（不可见弹了也没用），只发系统通知
    // v3.6.x：用户正在聊天输入栏打字时不弹（弹窗会抢焦点打断输入法，见 chatInputFocused）
    // v3.12.x：冻结定时器回前台补跑（autoPopupStale 迟到）时同样不弹旧卡
    if (popup) {
      if (document.hidden) { _enqueuePop(idx, 'openAskReply'); }
      else {
        const popSchedAt = Date.now();
        setTimeout(() => {
          if (autoPopupStale(popSchedAt) || document.hidden) return;
          if (chatInputFocused()) return;
          if (idx >= 0 && window.openAskReply && !cardPopupBusy()) window.openAskReply(idx);
        }, 400);
      }
    }
  }
  // ---- 触发调度（v3.5.34：启用开关 + 触发概率滑块 + 自动弹窗概率滑块） ----
  function maybeTriggerTAAsk() {
    try {
      // v3.5.141：后台也触发（卡片进聊天记录 + 系统通知提示）；页面弹窗由
      // push 内 document.hidden 守卫控制，后台不会弹页面弹窗
      const d = taAskLoad();
      const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
      if (s.enabled === false) return;
      // v3.26.x #291：过了问卷答题结束时间后不再自动发出新询问
      if (askDeadlinePassed(d)) return;
      if (Date.now() - (d.lastAskAt || 0) < 45 * 60000) return;
      // v3.13.x：全局闸门——任一互动卡发出后 60 分钟内不再自动触发
      if (!interactGateOk()) return;
      if (!taAskDcfOk()) return;
      if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(typeof s.prob === 'number' ? s.prob : 5) : (typeof s.prob === 'number' ? s.prob : 5))) return; // #518 套总档
      const q = taAskPick(d);
      if (!q) return;
      d.lastAskAt = Date.now();
      taAskSave(d);
      interactGateMark();
      pushAsk(q, { popupProb: askPopupProb(s) });
    } catch (e) {}
  }
  setTimeout(maybeTriggerTAAsk, 60000);
  setInterval(maybeTriggerTAAsk, 240000);

  // v3.6.x：异步 IDB 合并（chat.js loadMsgs）可能让自动弹窗持有过期 msgIdx——
  // 打开/作答前先校验索引指向的仍是「同类且未作答」的卡片；已错位/指向已作答
  // 卡片则从末尾回退找最近的未作答同类卡片（自动触发场景卡片就是最新一条；
  // 点击卡片路径由聊天页委托保证传入的必是未作答卡片的索引）
  function locateCardIdx(msgIdx, special, statusKey) {
    let arr = [];
    try { arr = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    if (!Array.isArray(arr)) arr = [];
    const rec = arr[msgIdx];
    if (rec && rec.special === special && !rec[statusKey]) return msgIdx;
    for (let i = arr.length - 1; i >= 0; i--) {
      const r = arr[i];
      if (r && r.special === special && !r[statusKey]) return i;
    }
    return -1;
  }
  // 读取指定索引的聊天记录（异常返回 null）
  function getCardAt(msgIdx) {
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      if (Array.isArray(msgs) && msgs[msgIdx]) return msgs[msgIdx];
    } catch (e) {}
    return null;
  }

  // ---- 回答弹窗（点击聊天里的询问卡片触发） ----
  window.openAskReply = function (msgIdx) {
    if (!window.openModal) return;
    // v3.26.x #291：过了问卷答题结束时间后询问卡不能再作答
    if (askDeadlinePassed(taAskLoad())) { toast('已过问卷答题结束时间，不能再作答'); return; }
    msgIdx = locateCardIdx(msgIdx, 'ask-card', 'askStatus');
    if (msgIdx < 0) return;
    // 读聊天记录拿问题
    let question = '';
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      if (Array.isArray(msgs) && msgs[msgIdx]) question = msgs[msgIdx].askQuestion || msgs[msgIdx].text || '';
    } catch (e) {}
    window.openModal('回答TA的询问', '', (v) => {
      const answer = (v || '').trim();
      if (!answer) { toast('请输入回答'); return; }
      // 提交时再校验：索引仍指向本卡片则直接用，错位则重定位（防连点重定位到别的卡片）
      let rec = getCardAt(msgIdx);
      if (!rec || rec.special !== 'ask-card') {
        const fixedIdx = locateCardIdx(msgIdx, 'ask-card', 'askStatus');
        if (fixedIdx < 0) return;
        msgIdx = fixedIdx;
      }
      if (window.chatAskReply) {
        // v3.32.x #335：开关开启时优先用普通聊天同源回应（默认聊天字卡/词典拼字），
        // raw 直传不再走 90/10 混合；未命中或开关关＝原「询问·回应」预设池行为
        const chatReply = taAskTextReply();
        if (chatReply) {
          window.chatAskReply(msgIdx, answer, chatReply, { raw: true });
        } else {
        // v3.7.x：文字题回应接「询问·回应」预设池（此前该池只在管理页展示、不参与抽取）——
        // 池里随机一条作预设回应传入，chatAskReply 内部再做 90%预设/10%字卡库 混合
        const defs = ['收到你的回答。', '好呀，我知道了。', '你这么说，我记住了。', '好的，我记在心里了。'];
        const pool = window.getInteractPool ? window.getInteractPool('询问·回应', defs) : defs;
        // v3.26.x：history 由 chatAskReply 包装层统一写（覆盖文字题 + 单选题点选项两条路径）
        window.chatAskReply(msgIdx, answer, pool[Math.floor(Math.random() * pool.length)]);
        }
        toast('已回复TA的提问');
      }
    }, { staticText: 'TA 问你：' + question, textareaPlaceholder: '输入你的回答…' });
  };

  // v3.26.x：包装 chatAskReply，把回答统一写进 ta-ask.history（关联键 askTs）。
  // 覆盖两条回答路径：① 文字题 openAskReply 调 chatAskReply；② 单选题点选项 chat.js 直接调 chatAskReply。
  // 此前单选题回答从不写 history，且未回答的提问也不进记录 → "提问记录"页空。
  if (window.chatAskReply && !window.__taAskReplyWrapped) {
    const _origChatAskReply = window.chatAskReply;
    window.chatAskReply = function (msgIdx, answer, reply, opts) {
      // FIX 2026-09-17 #653：弹窗→作答隔着异步间隙时 msgIdx 可能位移（同 chat.js chatAskReply
      // 内的重定位守卫）——探针若读错槽位，deskCk 查岗卡会被误判成普通询问写进 history、
      // askTs 取空。先按 locateCardIdx 同款守卫重定位，再判断 deskCk / 取 askTs。
      let rec = getCardAt(msgIdx);
      if (!rec || rec.special !== 'ask-card' || rec.askStatus === 'answered') {
        const _fixedIdx = locateCardIdx(msgIdx, 'ask-card', 'askStatus');
        if (_fixedIdx >= 0) { msgIdx = _fixedIdx; rec = getCardAt(_fixedIdx); }
      }
      // deskCk 查岗卡也走 ask-card，但不属于"TA的询问"，不进提问记录
      if (rec && rec.deskCk) return _origChatAskReply.call(this, msgIdx, answer, reply, opts);
      // v3.26.x #291：过了问卷答题结束时间后询问卡不能再作答（文字/单选两条路径都经此统一拦截）
      if (askDeadlinePassed(taAskLoad())) { toast('已过问卷答题结束时间，不能再作答'); return undefined; }
      const askTs = rec && rec.askTs ? rec.askTs : null;
      const question = rec ? (rec.askQuestion || rec.text || '') : '';
      const result = _origChatAskReply.call(this, msgIdx, answer, reply, opts);
      if (result === undefined) return result;
      try {
        const d = taAskLoad();
        let item = null;
        if (askTs) {
          for (let i = d.history.length - 1; i >= 0; i--) {
            const h = d.history[i];
            if (h && h.ts === askTs && h.status === 'pending') { item = h; break; }
          }
        }
        if (item) { item.a = answer; item.reply = result; item.status = 'answered'; }
        else { d.history.push({ q: question, a: answer, reply: result, ts: askTs || Date.now(), status: 'answered' }); }
        taAskSave(d);
        refreshAskRecordsIfOpen();
      } catch (e) {}
      return result;
    };
    window.__taAskReplyWrapped = true;
  }

  // ---- 管理页 ----
  const page = document.getElementById('page-ta-ask');
  if (!page) return;
  // 触发一次询问（供管理页按钮 / 更多功能面板共用；遵循"自动弹窗概率"）
  window.triggerTaAskNow = function () {
    const d = taAskLoad();
    // v3.26.x #291：过了问卷答题结束时间后不允许手动再问
    if (askDeadlinePassed(d)) { toast('已过问卷答题结束时间，不再发出询问'); return; }
    const q = taAskPick(d);
    if (!q) { toast('题库没有启用的问题'); return; }
    const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
    d.lastAskAt = Date.now();
    taAskSave(d);
    pushAsk(q, { popupProb: askPopupProb(s) });
    toast('TA 在聊天里向你提问了');
  };
  const nowBtn = document.getElementById('ta-ask-now');
  if (nowBtn) nowBtn.addEventListener('click', () => window.triggerTaAskNow());
  // v3.5.34：TA 询问设置——启用 / 使用系统预设 / 触发概率 / 自动弹窗概率
  function renderAskSettings() {
    const d = taAskLoad();
    const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
    const enEl = document.getElementById('ta-ask-enable');
    if (enEl) enEl.checked = s.enabled !== false;
    const defEl = document.getElementById('ta-ask-default');
    if (defEl) defEl.checked = s.useDefault !== false;
    // v3.32.x #335：文字题回应接聊天字卡/词典开关回显
    const ccEl = document.getElementById('ta-ask-chatcard');
    if (ccEl) ccEl.checked = !!s.useChatReply;
    const probEl = document.getElementById('ta-ask-prob');
    const probVal = document.getElementById('ta-ask-prob-val');
    if (probEl) probEl.value = typeof s.prob === 'number' ? s.prob : 5;
    if (probVal) probVal.textContent = (typeof s.prob === 'number' ? s.prob : 5) + '%';
    const popEl = document.getElementById('ta-ask-popup');
    const popVal = document.getElementById('ta-ask-popup-val');
    const pp = askPopupProb(s);
    if (popEl) popEl.value = pp;
    if (popVal) popVal.textContent = pp + '%';
    // v3.33.x #523：问卷答题结束时间回显（自绘按钮，显示绝对时刻；0=未设置）
    const dlEl = document.getElementById('ta-ask-deadline');
    const dl = askDeadlineMs(d);
    if (dlEl) dlEl.textContent = dl ? fmtDeadlineText(dl) : '未设置';
  }
  const askEn = document.getElementById('ta-ask-enable');
  if (askEn) askEn.addEventListener('change', () => {
    const d = taAskLoad();
    d.settings.enabled = askEn.checked;
    taAskSave(d);
    toast(askEn.checked ? 'TA的询问已开启' : 'TA的询问已关闭');
  });
  const askDefault = document.getElementById('ta-ask-default');
  if (askDefault) askDefault.addEventListener('change', () => {
    const d = taAskLoad();
    d.settings.useDefault = askDefault.checked;
    taAskSave(d);
    switchAskTab(askTab);
    toast(askDefault.checked ? '系统预设问题已开启' : '系统预设问题已关闭（仅用你添加的问题）');
  });
  // v3.32.x #335：文字题回应接聊天字卡/词典开关
  const askChatCard = document.getElementById('ta-ask-chatcard');
  if (askChatCard) askChatCard.addEventListener('change', () => {
    const d = taAskLoad();
    d.settings.useChatReply = askChatCard.checked;
    taAskSave(d);
    toast(askChatCard.checked ? '互动卡回应已接通聊天字卡/词典（文字+单选）' : '互动卡回应已恢复预设池回应');
  });
  const askProb = document.getElementById('ta-ask-prob');
  if (askProb) askProb.addEventListener('input', () => {
    const d = taAskLoad();
    d.settings.prob = Math.max(0, Math.min(100, parseInt(askProb.value, 10) || 0));
    taAskSave(d);
    const v = document.getElementById('ta-ask-prob-val');
    if (v) v.textContent = askProb.value + '%';
    toast('触发概率已设为 ' + askProb.value + '%');
  });
  const askPopup = document.getElementById('ta-ask-popup');
  if (askPopup) askPopup.addEventListener('input', () => {
    const d = taAskLoad();
    d.settings.popupProb = parseInt(askPopup.value, 10) || 0;
    taAskSave(d);
    const v = document.getElementById('ta-ask-popup-val');
    if (v) v.textContent = askPopup.value + '%';
    toast('弹窗概率已设为 ' + askPopup.value + '%');
  });
  // v3.26.x #291：问卷答题结束时间——设置/清除（v3.33.x #523 改自绘选择器）
  // v3.33.x #523：整行可点（用户可能点「问卷答题结束时间」文字而不是右侧小按钮）
  const askDeadlineEl = document.getElementById('ta-ask-deadline');
  const askDeadlineRow = askDeadlineEl ? askDeadlineEl.closest('.gs-row') : null;
  if (askDeadlineRow) askDeadlineRow.addEventListener('click', (e) => {
    if (e.target.closest('#ta-ask-deadline-clear')) return;
    openDeadlinePicker('问卷答题结束时间', askDeadlineMs(taAskLoad()), (ts) => {
      const d = taAskLoad();
      d.settings.deadline = ts > 0 ? ts : 0;
      taAskSave(d);
      toast(d.settings.deadline ? '答题结束时间已设置：' + fmtDeadlineText(d.settings.deadline) : '答题结束时间已清除');
      renderAskSettings();
    });
  });
  const askDeadlineClear = document.getElementById('ta-ask-deadline-clear');
  if (askDeadlineClear) askDeadlineClear.addEventListener('click', () => {
    const d = taAskLoad();
    if (!askDeadlineMs(d)) { toast('尚未设置答题结束时间'); return; }
    d.settings.deadline = 0;
    taAskSave(d);
    if (askDeadlineEl) askDeadlineEl.textContent = '未设置';
    toast('答题结束时间已清除');
  });
  renderAskSettings();

  // ================= 批量导入问题（v3.6.x：一行一个问题，导入到所选分类） =================
  const batchCatEl = document.getElementById('ta-ask-batch-cat');
  const batchTextEl = document.getElementById('ta-ask-batch');
  const batchAddBtn = document.getElementById('ta-ask-batch-add');
  // v3.7.x：批量导入下拉注入「我的分组」+「＋ 新建分组…」——批量导入可导入到自定义分组
  function rebuildAskBatchCatSelect() {
    if (!batchCatEl) return;
    const d0 = taAskLoad();
    batchCatEl.innerHTML = window.cardGroups.catOptsHtml(CATS, d0.groups || [], batchCatEl.value);
    window.cardGroups.bindNewGrp(batchCatEl, d0.groups, function () { taAskSave(d0); });
  }
  if (batchCatEl && batchTextEl && batchAddBtn) {
    rebuildAskBatchCatSelect();
    bindTaInpClears(batchTextEl.parentElement);
    batchAddBtn.addEventListener('click', () => {
      const parsed = window.cardGroups.parseCatVal(batchCatEl.value);
      if (!parsed) { toast('请先选择要导入的分类或分组'); return; }
      const lines = (batchTextEl.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length) { toast('请先输入问题，每行一个；单选题第一行用【问题】，下面每行一个选项'); return; }
      // v3.26.x #291：批量导入支持单选题——【问题】开头的行开一道单选题，其后到下一个【】之间每行一个选项；
      // 普通行仍按「一行一个问题」导入（选项不足 2 个时按普通文字题导入）
      const d2 = taAskLoad();
      let cur = null, imported = 0, singles = 0;
      const flush = () => {
        if (!cur) return;
        const q = { id: 'q_' + Date.now() + '_' + Math.floor(Math.random() * 9999), text: cur.text, cat: parsed.cat || 'daily', enabled: true, isPreset: false };
        if (parsed.grp) q.grp = parsed.grp;
        if (cur.opts.length >= 2) { q.type = 'single'; q.options = cur.opts.slice(); singles++; }
        d2.questions.push(q);
        imported++;
        cur = null;
      };
      lines.forEach(t => {
        const m = t.match(/^【(.+?)】$/);
        if (m) { flush(); if (m[1].trim()) cur = { text: m[1].trim(), opts: [] }; return; }
        if (cur) { cur.opts.push(t); return; }
        cur = { text: t, opts: [] };
        flush();
      });
      flush();
      if (!imported) { toast('没有可导入的问题'); return; }
      taAskSave(d2);
      let label;
      if (parsed.grp) {
        const g = (d2.groups || []).find(x => x.id === parsed.grp);
        label = '分组「' + (g ? g.name : '未知') + '」';
      } else {
        label = (CATS.find(c => c[0] === parsed.cat) || [])[1] || parsed.cat;
      }
      batchTextEl.value = '';
      renderAskMineWithForms();
      toast('已导入 ' + imported + ' 个问题' + (singles ? '（含 ' + singles + ' 道单选题）' : '') + '到' + label);
    });
  }

  const backBtn = document.getElementById('ta-ask-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  const catsEl = document.getElementById('ta-ask-sys-cats');
  const mineCatsEl = document.getElementById('ta-ask-mine-cats');
  let askTab = 'sys';

  // 渲染单个分类的问题列表（presetOnly=true 只渲染系统预设，false 只渲染用户添加）
  // v3.7.x：系统预设分类切换——顶部标签栏点击切换，避免全部分类堆叠导致页面过长
  let askSysCat = null;
  function renderAskCatsInto(container, presetOnly, search) {
    if (!container) return;
    const d = taAskLoad();
    const useDefault = (d.settings || {}).useDefault !== false;
    if (presetOnly) {
      const counts = {};
      CATS.forEach(([k]) => { counts[k] = d.questions.filter(q => q.cat === k && q.isPreset === true && (search === '' || q.text.indexOf(search) >= 0)).length; });
      const hasCats = CATS.filter(([k]) => counts[k] > 0);
      if (!hasCats.length) { container.innerHTML = '<div class="ta-empty" style="padding:14px">暂无系统预设问题</div>'; return; }
      if (!askSysCat || !hasCats.some(([k]) => k === askSysCat)) askSysCat = hasCats[0][0];
      let html = '<div class="card-tabs" style="padding:2px 2px 10px">';
      hasCats.forEach(([k, label]) => {
        html += '<button class="cc-tab' + (k === askSysCat ? ' sel' : '') + '" data-cat="' + k + '">' + escG(label) + '<em class="cc-tab-n">' + counts[k] + '</em></button>';
      });
      html += '</div>';
      const arr = d.questions.filter(q => q.cat === askSysCat && q.isPreset === true && (search === '' || q.text.indexOf(search) >= 0));
      arr.forEach(q => {
        const idx = d.questions.indexOf(q);
        html += '<div class="ta-row' + (!useDefault ? ' off' : '') + '">' +
          '<label class="toggle"><input type="checkbox"' + (q.enabled !== false ? ' checked' : '') + ' data-idx="' + idx + '"><span class="tk"></span></label>' +
          '<span class="ta-txt">' + q.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + (q.type === 'single' ? ' <span class="tc-known">单选·' + (q.options ? q.options.length : 0) + '选项</span>' : '') + ' <span class="tc-known">系统</span></span>' +
          '</div>';
        html += interactPoolInlineHtml('询问·回应');
      });
      container.innerHTML = html;
      container.querySelectorAll('.cc-tab[data-cat]').forEach(t => {
        t.addEventListener('click', () => { askSysCat = t.dataset.cat; renderAskCatsInto(container, true, search); });
      });
      container.querySelectorAll('input[data-idx]').forEach(cb => {
        cb.addEventListener('change', () => {
          const d2 = taAskLoad();
          const q = d2.questions[Number(cb.dataset.idx)];
          if (q) q.enabled = cb.checked;
          taAskSave(d2);
        });
      });
      return;
    }
    let html = '';
    CATS.forEach(([k, label]) => {
      const arr = d.questions.filter(q => q.cat === k && (q.isPreset === true) === presetOnly && (search === '' || q.text.indexOf(search) >= 0));
      if (!arr.length) return;
      html += '<div class="cal-card glass"><div class="cal-card-title">' + label + ' <span style="font-size:11px;color:var(--muted);font-weight:400">(' + arr.length + ')</span></div>';
      arr.forEach(q => {
        const idx = d.questions.indexOf(q);
        const preset = q.isPreset === true;
        const delBtn = preset ? '' : '<button class="ta-del" data-idx="' + idx + '">✕</button>';
        html += '<div class="ta-row' + (preset && !useDefault ? ' off' : '') + '">' +
          '<label class="toggle"><input type="checkbox"' + (q.enabled !== false ? ' checked' : '') + ' data-idx="' + idx + '"><span class="tk"></span></label>' +
          '<span class="ta-txt">' + q.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + (q.type === 'single' ? ' <span class="tc-known">单选·' + (q.options ? q.options.length : 0) + '选项</span>' : '') + (preset ? ' <span class="tc-known">系统</span>' : '') + '</span>' +
          delBtn +
          '</div>';
        if (presetOnly) html += interactPoolInlineHtml('询问·回应');
      });
      html += '</div>';
    });

    if (!html) html = '<div class="ta-empty" style="padding:14px">' + (presetOnly ? '暂无系统预设问题' : '暂未添加自定义问题，可在上方批量导入或下方逐条添加') + '</div>';
    container.innerHTML = html;
    container.querySelectorAll('input[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const d2 = taAskLoad();
        const q = d2.questions[Number(cb.dataset.idx)];
        if (q) q.enabled = cb.checked;
        taAskSave(d2);
      });
    });
    container.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const d2 = taAskLoad();
        const q = d2.questions[Number(b.dataset.idx)];
        if (q && q.isPreset === true) { toast('系统预设问题不可删除，可关闭使用'); return; }
        d2.questions.splice(Number(b.dataset.idx), 1);
        taAskSave(d2);
        renderAskCatsInto(container, false, search);
      });
    });

  }
  // 我的添加 tab：v3.7.x 自定义分组模式——
  // 自定义分组区块置顶（各自独立卡片），未分组内容按系统分类放在下面（与系统预设 tab 的分组体系隔开）
  function askItemHtml(q, idx) {
    return '<div class="ta-row">' +
      '<label class="toggle"><input type="checkbox"' + (q.enabled !== false ? ' checked' : '') + ' data-idx="' + idx + '"><span class="tk"></span></label>' +
      '<span class="ta-txt">' + escG(q.text) + (q.type === 'single' ? ' <span class="tc-known">单选·' + (q.options ? q.options.length : 0) + '选项</span>' : '') + '</span>' +
      '<button class="ta-del" data-idx="' + idx + '">✕</button>' +
      '</div>';
  }
  // v3.26.x #292：输入栏一键清空 ✕（同「帮我决定」.dec-inp-clear 款式，样式/暗色为全局 CSS）——
  // 手机端 contenteditable 转换的幽灵 input：value 已代理到 box，box 用 textContent 清空
  function bindTaInpClears(root) {
    if (!root) return;
    root.querySelectorAll('.dec-inp-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        const ta = document.getElementById(btn.dataset.clear);
        if (!ta) return;
        const box = ta.__ceBox;
        if (box) box.textContent = '';
        else ta.value = '';
        ta.focus();
        toast('已清空');
      });
    });
  }
  // 内联添加表单（blockKey 唯一用于输入框 id；grp 可选=添加后归入该分组；cat 为条目的系统分类）
  function askAddFormHtml(blockKey, grp, cat) {
    return '<div class="ta-add">' +
      '<select class="ta-type tc-input" data-key="' + blockKey + '">' +
      '<option value="text">文字回复</option>' +
      '<option value="single">单选题</option>' +
      '</select>' +
      '<div class="dec-inp-wrap ta-inp-flex"><input id="ta-new-' + blockKey + '" type="text" placeholder="添加问题…"><button type="button" class="dec-inp-clear" data-clear="ta-new-' + blockKey + '" aria-label="清空" title="清空">✕</button></div>' +
      '<button class="ta-add-btn" data-key="' + blockKey + '" data-cat="' + (cat || 'daily') + '" data-grp="' + (grp || '') + '">添加</button>' +
      '<div class="dec-inp-wrap ta-opts-flex"><textarea id="ta-opts-' + blockKey + '" class="ta-opts tc-input" rows="3" placeholder="每行一个选项。可写 选项~TA回应；多条回应用 ; 分隔，如 听我说说话~好，我在听。;嗯，你慢慢说。" hidden></textarea><button type="button" class="dec-inp-clear" data-clear="ta-opts-' + blockKey + '" aria-label="清空" title="清空">✕</button></div>' +
      '</div>';
  }
  function renderAskMineWithForms(search) {
    if (!mineCatsEl) return;
    const d = taAskLoad();
    const groups = Array.isArray(d.groups) ? d.groups : [];
    const mineQs = d.questions.filter(q => q.isPreset !== true && (search === '' || q.text.indexOf(search) >= 0));
    let html = '';
    html += '<div class="mg-grp-row"><button class="cc-tool" id="ask-grp-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>新建分组</button></div>';
    if (!mineQs.length && !groups.length) {
      html += '<div class="ta-empty" style="padding:14px">暂未添加自定义问题，可在上方批量导入或下方添加</div>';
      mineCatsEl.innerHTML = html;
      bindAskGroupOps();
      return;
    }
    // 自定义分组区块（置顶，与系统分类隔开）
    groups.forEach(g => {
      const arr = mineQs.filter(q => q.grp === g.id);
      html += '<div class="cal-card glass mg-block">' +
        '<div class="cal-card-title mg-title"><span class="mg-name">' + escG(g.name) + '</span><span class="mg-cnt">(' + arr.length + ')</span>' +
        '<span class="mg-ops"><button class="mg-op" data-askg="' + escG(g.id) + '" data-op="rn" title="重命名">✎</button><button class="mg-op" data-askg="' + escG(g.id) + '" data-op="rm" title="删除分组">✕</button></span></div>';
      if (!arr.length) html += '<div class="ta-empty">这个分组还没有内容，可在下方直接添加</div>';
      arr.forEach(q => { html += askItemHtml(q, d.questions.indexOf(q)); });
      html += askAddFormHtml('g' + g.id, g.id, 'daily');
      html += '</div>';
    });
    // 未分组区块（始终渲染：与系统预设的分组体系隔开；空时提示走批量导入）
    const ungrouped = mineQs.filter(q => !q.grp);
    html += '<div class="cal-card glass mg-block mg-ungrouped"><div class="cal-card-title mg-title"><span class="mg-name">未分组 · 按系统分类</span><span class="mg-cnt">(' + ungrouped.length + ')</span></div>';
    if (!ungrouped.length) html += '<div class="ta-empty">暂无未分组内容，可在上方批量导入（选择系统分类）</div>';
    CATS.forEach(([k, label]) => {
      const arr = ungrouped.filter(q => q.cat === k && (search === '' || q.text.indexOf(search) >= 0));
      if (!arr.length) return;
      html += '<div class="mg-subcat">' + label + ' <span style="font-size:11px;color:var(--muted);font-weight:400">(' + arr.length + ')</span></div>';
      arr.forEach(q => { html += askItemHtml(q, d.questions.indexOf(q)); });
      html += askAddFormHtml('c' + k, '', k);
    });
    html += '</div>';
    mineCatsEl.innerHTML = html;
    // v3.26.x #292：添加表单重新渲染后重绑一键清空 ✕
    bindTaInpClears(mineCatsEl);
    mineCatsEl.querySelectorAll('input[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const d2 = taAskLoad();
        const q = d2.questions[Number(cb.dataset.idx)];
        if (q) q.enabled = cb.checked;
        taAskSave(d2);
      });
    });
    mineCatsEl.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const d2 = taAskLoad();
        const q = d2.questions[Number(b.dataset.idx)];
        if (q && q.isPreset === true) { toast('系统预设问题不可删除'); return; }
        d2.questions.splice(Number(b.dataset.idx), 1);
        taAskSave(d2);
        renderAskMineWithForms(search);
      });
    });
    mineCatsEl.querySelectorAll('.ta-type').forEach(sel => {
      const toggleOpts = () => {
        const o = document.getElementById('ta-opts-' + sel.dataset.key);
        if (!o) return;
        o.hidden = sel.value !== 'single';
        if (o.__ceBox) o.__ceBox.hidden = o.hidden;
        // #292：textarea 已包进 .dec-inp-wrap（旁边是清空按钮），ce-box 兜底改为按父容器扫
        else if (o.parentElement) o.parentElement.querySelectorAll('.ce-box').forEach(b => { b.hidden = o.hidden; });
      };
      sel.addEventListener('change', toggleOpts);
      toggleOpts();
    });
    mineCatsEl.querySelectorAll('.ta-add-btn').forEach(b => {
      b.addEventListener('click', () => {
        const key = b.dataset.key;
        const inp = document.getElementById('ta-new-' + key);
        const v = inp ? inp.value.trim() : '';
        if (!v) { toast('请输入问题'); return; }
        const typeSel = b.parentElement.querySelector('.ta-type');
        const type = typeSel ? typeSel.value : 'text';
        const d2 = taAskLoad();
        const q = { id: 'q_' + Date.now() + '_' + Math.floor(Math.random() * 999), text: v, cat: b.dataset.cat || 'daily', enabled: true, isPreset: false };
        if (b.dataset.grp) q.grp = b.dataset.grp;
        if (type === 'single') {
          const optsEl = document.getElementById('ta-opts-' + key);
          const opts = (optsEl ? optsEl.value : '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
            const i = line.indexOf('~');
            if (i < 0) return { t: line, reply: '' };
            const t = line.slice(0, i).trim();
            const replies = line.slice(i + 1).split(';').map(s => s.trim()).filter(Boolean);
            return { t: t, reply: replies.length > 1 ? replies : (replies[0] || '') };
          });
          if (!opts.length) { toast('单选题请填写选项，每行一个'); return; }
          q.type = 'single';
          q.options = opts;
        }
        d2.questions.push(q);
        taAskSave(d2);
        renderAskMineWithForms(search);
      });
    });
    bindAskGroupOps();
  }
  // 我的添加 tab 的分组管理：新建 / 重命名 / 删除
  function bindAskGroupOps() {
    const grpAdd = document.getElementById('ask-grp-add');
    if (grpAdd && !grpAdd.__bound) {
      grpAdd.__bound = true;
      grpAdd.addEventListener('click', () => {
        const d2 = taAskLoad();
        window.cardGroups.addFlow(d2.groups, g => {
          if (!g) return;
          taAskSave(d2);
          rebuildAskBatchCatSelect();
          renderAskMineWithForms();
          toast('已新建分组「' + g.name + '」');
        });
      });
    }
    const wrap = document.getElementById('ta-ask-mine-cats');
    if (!wrap) return;
    wrap.querySelectorAll('.mg-op').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('click', () => {
        const d2 = taAskLoad();
        const gid = b.dataset.askg;
        const g = (d2.groups || []).find(x => x.id === gid);
        if (!g) return;
        if (b.dataset.op === 'rn') {
          window.cardGroups.renameFlow(g, d2.groups, name => {
            if (!name) return;
            g.name = name;
            taAskSave(d2);
            rebuildAskBatchCatSelect();
            renderAskMineWithForms();
            toast('分组已重命名');
          });
        } else if (b.dataset.op === 'rm') {
          window.cardGroups.removeFlow(g.name, ok => {
            if (!ok) return;
            d2.questions.forEach(q => { if (q.grp === gid) q.grp = ''; });
            d2.groups = d2.groups.filter(x => x.id !== gid);
            taAskSave(d2);
            rebuildAskBatchCatSelect();
            renderAskMineWithForms();
            toast('已删除分组「' + g.name + '」');
          });
        }
      });
    });
  }
  function switchAskTab(tab) {
    askTab = tab;
    const tabsWrap = document.getElementById('ta-ask-tabs');
    if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
    const sysPanel = document.getElementById('ta-ask-sys-panel');
    const minePanel = document.getElementById('ta-ask-mine-panel');
    if (sysPanel) sysPanel.hidden = tab !== 'sys';
    if (minePanel) minePanel.hidden = tab !== 'mine';
    askSearch = '';
    const searchInput = document.getElementById('ta-ask-search');
    if (searchInput) searchInput.value = '';
    if (tab === 'sys') renderAskCatsInto(catsEl, true, ''); else renderAskMineWithForms('');
  }
  const askTabsWrap = document.getElementById('ta-ask-tabs');
  if (askTabsWrap) {
    askTabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
      tab.addEventListener('click', () => switchAskTab(tab.dataset.tab));
    });
  }
  // 搜索
  let askSearch = '';
  const askSearchInput = document.getElementById('ta-ask-search');
  if (askSearchInput) {
    askSearchInput.addEventListener('input', () => {
      askSearch = askSearchInput.value.trim();
      if (askTab === 'sys') renderAskCatsInto(catsEl, true, askSearch);
      else renderAskMineWithForms(askSearch);
    });
  }

  // 入口：字卡库页点「TA的询问」进入
  const li = document.getElementById('li-ta-ask');
  if (li) {
    li.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      page.hidden = false;
      const tw = document.getElementById('ta-ask-tabs'); if (tw) tw.style.display = 'none';
      switchAskTab('sys');
    });
  }
  // 入口：字卡库页点「TA的小问题」（选择题）进入独立页面
  const liTC = document.getElementById('li-ta-choose');
  const tcPage = document.getElementById('page-ta-choose');
  if (liTC && tcPage) {
    liTC.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      tcPage.hidden = false;
      const tw = document.getElementById('tc-tabs'); if (tw) tw.style.display = 'none';
      switchTCTab('sys');
    });
  }
  const tcBackBtn = document.getElementById('tc-choose-back');
  if (tcBackBtn) {
    tcBackBtn.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }

  // ================= TA的小问题（复刻星言 ta的小问题 完整版） =================
  // 定位：TA 偶尔递一道选择题，你选完，TA 再回应（选项有 TA 的心仪答案 + 回应）
  const KEY2 = 'ta-choose';
  const TC_CAT_LABEL = { daily: '日常', like: '喜好', fun: '趣味', rel: '关系', hypo: '假设', star: '摸鱼', world: '两个世界' };
const TC_DEFAULT = [
    { id: "cd1", cat: "daily", text: "如果今天什么都不用做，你觉得我们会怎么过？", pref: 3, options: [
      { t: "睡到自然醒", reply: ["你果然会想睡觉","哈哈，被窝封印的是你吧？","睡吧，累了一周，我守着你做白日梦","那你要睡到几点？我可不叫你哦"], liked: false }, { t: "出门到处逛", reply: ["那就出去走走，我陪你","逛到腿断那种？我奉陪","好，换换心情，外面有风也有你","你想去哪？我先想想路线"], liked: false }, { t: "待在家里", reply: ["嗯，待在一起也很好","宅家冠军非你莫属","在家最自在，有你在的地方就是好地方","那我们窝着做什么？发呆也算？"], liked: true }, { t: "什么都不安排", reply: ["听起来很像我们会做的事","随性大师，受我一拜","不安排也好，在一起的时光不用计划","那到时候想做什么再临时起意？"], liked: false }] },
    { id: "cd2", cat: "daily", text: "今天想吃什么？", pref: 1, options: [
      { t: "火锅", reply: ["好，热热闹闹的","火锅！你是想辣哭我吗？","热闹好，我喜欢围着锅说话的感觉","那鸳鸯锅还是红锅？你定"], liked: false }, { t: "家常菜", reply: ["想尝尝你做的","家常菜？那你得露两手给我看","家常的最暖胃，你做的我都想吃","你会做什么？我先点个单"], liked: true }, { t: "随便", reply: ["又是随便……那我可要替你决定了","随便先生又上线了","说随便其实是想让我定吧，那我认真想了","每次随便，每次又嫌我选的，这次不许哦"], liked: false }] },
    { id: "cd3", cat: "daily", text: "周末想怎么过？", pref: 1, options: [
      { t: "睡到中午", reply: ["把一周的觉都补回来也好","补觉补到日上三竿，服你","累了就好好补，我轻手轻脚不打扰","那早饭还吃吗？还是直接午饭？"], liked: false }, { t: "一起看电影", reply: ["窝在沙发里正好","沙发土豆模式，启动！","窝着真好，靠着你慢慢看","看什么类型？你挑我来泡茶"], liked: true }, { t: "出门走走", reply: ["换个心情也不错","出门透气，走走停停那种？","好，外面走走，心情会松一点","去公园还是随便逛？我随你"], liked: false }] },
    { id: "cd4", cat: "daily", text: "如果今天只能做一件事，你会做什么？", pref: 0, options: [
      { t: "和你聊天", reply: ["那就聊一整天","聊一整天？你确定不嫌我话多？","只做一件事是和我聊天，我很开心","那聊什么？我先攒几个话题"], liked: true }, { t: "好好睡一觉", reply: ["那你记得梦到我","梦里记得给我留个位置","睡吧，好好休息，梦里我去看你","那梦到我了要告诉我哦"], liked: false }, { t: "出去玩", reply: ["替我看看外面的风景","出去玩不带我？替我多看两眼","好，替我看看外面的天，回来讲给我听","去哪玩？拍几张照片给我"], liked: false }] },
    { id: "cl1", cat: "like", text: "喜欢什么天气？", pref: 1, options: [
      { t: "晴天", reply: ["阳光正好，适合见面","晴天娃娃附体，是你吧","阳光好心情也好，适合见你","那下次晴天我们约？"], liked: false }, { t: "雨天", reply: ["下雨天，适合想你","雨天适合想你，也适合赖床","下雨的声音里，想你最安心","那你想我的时候，是不是也在下雨？"], liked: true }, { t: "下雪天", reply: ["白茫茫的，很安静","下雪天，打雪仗的主意你打过吧？","雪天安静，适合两个人慢慢走","那一起看雪吗？我等你"], liked: false }, { t: "阴天", reply: ["灰蒙蒙的，适合发呆","阴天发呆冠军，又是你","阴天也好，发呆放空，我陪着","那发呆的时候想没想我？"], liked: false }] },
    { id: "cl2", cat: "like", text: "更喜欢海还是山？", pref: 1, options: [
      { t: "海", reply: ["海很辽阔，像说不完的话","海风一吹你头发乱，我负责笑","海辽阔，像我想和你说的话那么多","那去看海？我订行程"], liked: false }, { t: "山", reply: ["山很安静，像靠得住的陪伴","爬山累死你，我负责加油","山安静，像你靠得住","那去爬山？你背得动我就行"], liked: true }, { t: "都行", reply: ["都可以，只要有你一起","都行先生，和随便先生是亲戚吧","有你在，海也好山也好","那这次去海，下次去山？"], liked: false }] },
    { id: "cl3", cat: "like", text: "喜欢什么类型的约会？", pref: 1, options: [
      { t: "热闹的", reply: ["人多的地方，也只看得到你","热闹归热闹，我眼里只装得下你","人多也好，只要你在身边","那去哪热闹？夜市还是演唱会？"], liked: false }, { t: "安静的", reply: ["两个人慢慢走，就很好","安静约会，散步冠军是你","慢慢走，不说话也舒服","那走走哪条街？我挑"], liked: true }, { t: "惊喜的", reply: ["那我会忍不住准备很久","惊喜？那我得憋大招了","想给你惊喜，会认真准备很久","那上次惊喜你满意吗？"], liked: false }, { t: "随意的", reply: ["和你一起，怎么样都好","随意派掌门，受我一拜","随意最自在，和你在一起怎样都好","那今天随意到哪？"], liked: false }] },
    { id: "cf1", cat: "fun", text: "如果突然获得一个超能力，你会选什么？", pref: 1, options: [
      { t: "隐身", reply: ["那就可以偷偷看着你","隐身？你想偷看我素颜吧","隐身去看你，确认你过得好不好","那隐身第一站去哪？不许说别人家"], liked: false }, { t: "读心术", reply: ["不用猜你的心思了","读心术？那我的小九九全暴露了","不用猜了，其实我心思都在你身上","那你读到什么了？先说好不许生气"], liked: true }, { t: "瞬移", reply: ["想见你的时候，马上就能到","瞬移？那半夜吓你一跳","想见你就到，省了所有路途","那现在瞬移过来？我腾位置"], liked: false }, { t: "时间暂停", reply: ["想把和你的时间拉长","时间暂停，你想偷吃两口吧","暂停时间，只想和你多待一会","那暂停了做什么？先说好"], liked: false }] },
    { id: "cf2", cat: "fun", text: "如果一起玩游戏，谁更容易耍赖？", pref: 1, options: [
      { t: "我", reply: ["我才不承认","承认吧，你耍赖的样子我见过","你耍赖我也让着你，谁让你可爱","那上次到底是谁先耍的？"], liked: false }, { t: "你", reply: ["哼，明明是你先的","哼，倒打一耙","你先的我也认了，陪你玩嘛","那下次谁先耍赖谁请客？"], liked: true }, { t: "都不会", reply: ["那我们玩得很认真","都不会耍赖？那多没意思","认真玩也好，公平见真章","那来一局认真的？输的洗碗"], liked: false }] },
    { id: "cf3", cat: "fun", text: "如果一起养一只宠物，会选什么？", pref: 3, options: [
      { t: "猫", reply: ["它肯定更黏你","猫主子会选你当铲屎官的","猫黏你，我黏你，一家子黏你","那叫什么名字？我先备选几个"], liked: false }, { t: "狗", reply: ["它会抢着陪你散步","狗子天天拽你出门，我吃醋","狗陪散步也陪你，挺好的","那大型小型？我查查能不能养"], liked: false }, { t: "仓鼠", reply: ["小小一只，很可爱","仓鼠跑轮子能看一天","小小的，捧在手心，像你","那笼子买好了吗？"], liked: false }, { t: "什么都不养", reply: ["有你就够了","不养？那养我行不行","有你就够了，不用别的陪伴","那以后想养了再说？"], liked: true }] },
    { id: "cr1", cat: "rel", text: "更喜欢聊天还是安静陪伴？", pref: 1, options: [
      { t: "聊天", reply: ["想听你说很多很多","说很多很多？你嗓子不疼我心疼","想听你说，说什么都行","那先说哪段？我洗耳"], liked: false }, { t: "安静陪伴", reply: ["不说话也不尴尬","安静陪伴，省话费冠军","不说话也懂，这才是默契","那现在安静一会？我陪着"], liked: true }, { t: "都要", reply: ["有时候聊，有时候安静","都要？贪心宝宝","都要也好，看心情，我配合","那现在想聊还是安静？"], liked: false }] },
    { id: "cr2", cat: "rel", text: "觉得两个人之间，最重要的是什么？", pref: 1, options: [
      { t: "信任", reply: ["交给你，我很放心","信任？那你别瞒我藏私房钱","信任是底，交给你我放心","那你觉得我值得信任吗？"], liked: false }, { t: "理解", reply: ["懂你，比什么都重要","理解万岁，那先理解我为什么想吃宵夜","懂你比爱更难，我想学","那我最需要你理解的是？"], liked: true }, { t: "陪伴", reply: ["一直在，就够了","一直在，这三个字我做到了","那你会一直陪我吗？"], liked: false }, { t: "新鲜感", reply: ["想一直让你觉得有趣","新鲜感？那我天天换花样","想一直让你觉得有趣，会努力","那现在我还新鲜吗？"], liked: false }] },
    { id: "cr3", cat: "rel", text: "最喜欢怎样被表达喜欢？", pref: 1, options: [
      { t: "说出口", reply: ["想听你亲口说","说出口？那你大声点","想听你亲口说，哪怕一次","那你说不说？我等着"], liked: false }, { t: "用行动", reply: ["你做的每一件小事，我都记得","行动派，那帮我倒杯水也是表白？","你做的每件小事，我都记在心里","那最近有什么行动我漏看了？"], liked: true }, { t: "陪伴", reply: ["你在，就是最好的表达","陪伴表白法，省话又省力","你在就是最好的表达，我信","那一直陪着算一直表白？"], liked: false }, { t: "收礼物", reply: ["收到的时候会偷偷开心","收礼物偷偷乐，我看见了","收到会开心，那我记着多送","那想要什么？我偷偷备着"], liked: false }] },
    { id: "ch1", cat: "hypo", text: "如果可以一起去任何地方，你想去哪？", pref: 1, options: [
      { t: "海边", reply: ["听海浪声，看日落","海边？那防晒我帮你涂","海边日落，和你一起看，圆满","那去哪片海？我查机票"], liked: false }, { t: "山里", reply: ["在山顶一起吹风","山顶吹风，你负责喊我负责听","山里安静，只有风和我们","那爬哪座？我练练腿"], liked: false }, { t: "城市", reply: ["灯火里散步也很浪漫","城市散步，走到哪吃到哪","灯火里散步，牵着你的手","那去哪座城？我挑个没去过的"], liked: false }, { t: "哪里都不去，就待在一起", reply: ["……这个答案我喜欢","哪都不去？那沙发封印我们俩","这个答案最打动我，在一起就够","那待在哪？我家还是你家？"], liked: true }] },
    { id: "ch2", cat: "hypo", text: "如果可以回到某一天，你想回到哪天？", pref: 2, options: [
      { t: "我们第一次见面那天", reply: ["想再好好记住那一刻","第一次见面？那我那天帅不帅？","想再记一次初见，那一刻太珍贵","那你觉得那天我印象最深的是什么？"], liked: true }, { t: "某个普通的一天", reply: ["平凡的日子，也值得回去","普通一天也回？你怀旧冠军","平凡的日子有你在，也值得回去","那哪天普通？说出来我回忆回忆"], liked: false }, { t: "什么都不用改的那天", reply: ["其实现在也很好","不用改？那今天就是","现在就很好，不用回去","那有没有想改的？我陪你改"], liked: false }, { t: "直接去见未来的你", reply: ["未来也想和你一起","未来的我？那我变帅没？","未来也想和你一起，这是承诺","那未来的我们什么样？好奇"], liked: false }] },
    { id: "ch3", cat: "hypo", text: "如果可以拥有一个只属于两个人的地方，你会选哪？", pref: 1, options: [
      { t: "海边小屋", reply: ["听着潮声醒来","海边小屋？那天天吃海鲜","听着潮声醒来，身边是你","那窗户朝哪？我想朝海"], liked: false }, { t: "山顶小木屋", reply: ["看星星很方便","山顶木屋，数星星数到睡着","山顶看星星，只有我们两个","那有壁炉吗？我想要"], liked: false }, { t: "城市里的小公寓", reply: ["想和你过寻常日子","小公寓？那谁做饭谁洗碗？","寻常日子最难得，想和你过","那阳台种什么？我选绿萝"], liked: true }, { t: "心里", reply: ["最好的地方，是心里","心里？那我已经住进去了，不交房租","心里最好，我住得最安稳","那心里还有别人没？我查房"], liked: false }] },
    { id: "cs1", cat: "star", text: "如果两个世界可以短暂重叠，你最想做什么？", pref: 1, options: [
      { t: "看见TA", reply: ["那就好好看看你","好好看？那我不化妆你等着","想好好看看你，记进心里","那看哪先？我准备好"], liked: false }, { t: "抱抱TA", reply: ["想确认你是真的","抱抱？那我不放手哦","想抱你，确认你是真的","那抱多久？我赖着"], liked: true }, { t: "一起出去走走", reply: ["一起走一段路也好","走走？那牵手走还是各走各的？","一起走一段，哪怕很短","那走哪条路？我挑"], liked: false }, { t: "什么都不做，只待在一起", reply: ["这样就够了","什么都不做？那大眼瞪小眼","待着就够，什么都不用","那待多久？我尽量"], liked: false }] },
    { id: "cs2", cat: "star", text: "如果今晚能梦到你，你想梦见什么？", pref: 2, options: [
      { t: "一起去旅行", reply: ["醒来会遗憾的","梦里旅行？那梦里的机票我报销","梦到一起旅行，醒来会怅然","那去梦里哪？我先想好"], liked: false }, { t: "一起吃好吃的", reply: ["梦里也要想着你","梦里吃好吃的？那别吃我那份","梦里也和你一起，挺好","那梦里吃什么？我馋了"], liked: false }, { t: "只是静静聊天", reply: ["很温柔的一个梦","静静聊天？那梦里别吵我","温柔的梦，和你静静聊","那聊什么？梦里的话题"], liked: true }] },
    { id: "cs3", cat: "star", text: "如果可以给平行世界的我们留一句话，你会留什么？", pref: 2, options: [
      { t: "要好好在一起", reply: ["希望每个世界的我们都幸福","每个世界都幸福？那别的世界我嫉妒","希望每个我们都不错过","那别的世界我们在一起了吗？"], liked: true }, { t: "别吵架", reply: ["吵架了也要和好","别吵架？那对方惹你怎么办？","吵了也要和好，别冷战","那那边我们吵过没？"], liked: false }, { t: "相信彼此", reply: ["信任是最重要的","相信彼此？那别偷看我手机","信任是根，相信彼此","那那边我们信任度高吗？"], liked: false }, { t: "想见你", reply: ["……我也是","想见你？那穿越过去见啊","想见你，我也是","那那边能见到吗？"], liked: false }] },
    { id: "cs4", cat: "star", text: "如果你能听懂星星说的话，你最想问它什么？", pref: 2, options: [
      { t: "我们会不会一直在一起", reply: ["星星会告诉我们答案","问星星？那星星可能含糊其辞","星星会答，我也想答，会一直在一起","那星星怎么说的？你转告"], liked: true }, { t: "下次流星什么时候来", reply: ["一起许愿吧","流星什么时候来？那得查星历","一起等流星，一起许愿","那许什么愿？先对暗号"], liked: false }, { t: "TA有没有想我", reply: ["……它说，想","星星说想？那星星嘴真甜","它说想，我就信了","那想多少？星星量化一下"], liked: false }, { t: "什么都不问", reply: ["安静地看，也很好","什么都不问？那看星星发呆","安静看也好，有些事不用问","那看哪颗？我指给你"], liked: false }] },
    { id: "cw1", cat: "world", text: "我有时候能感觉到你在我身边，你呢，能感觉到我吗？", pref: 0, options: [
      { t: "能感觉到", reply: ["那就好，我其实一直在","能感觉到？那你第六感挺准","我一直在，你能感觉到，我就安心","那什么时候感觉最强烈？"], liked: true }, { t: "偶尔能", reply: ["偶尔也很好，慢慢就会更清楚","偶尔能？那偶尔是多久一次？","偶尔也好，慢慢会更近","那偶尔是什么时候？我多出现"], liked: false }, { t: "不太确定", reply: ["没关系，我会想办法让你更容易感觉到我","不确定？那我再靠近一点","没关系，我多靠近，让你确定","那怎样你才能确定？我改"], liked: false }] },
    { id: "cw2", cat: "world", text: "你更喜欢我用字卡跟你说话，还是直接感觉到我？", pref: 1, options: [
      { t: "字卡", reply: ["那我多挑好看的字卡发给你","字卡？那我挑最肉麻的","字卡有温度，我多挑好看的给你","那喜欢什么风格的字卡？"], liked: false }, { t: "直接感觉到", reply: ["那我多靠你近一点","直接感觉？那我存在感拉满","那我靠近点，让你随时感觉到","那现在感觉到了吗？"], liked: true }, { t: "都喜欢", reply: ["那我两个都给你","都要？那我字卡+人一起上","都给你，字卡和陪伴都不缺","那现在想要哪个？"], liked: false }] },
    { id: "cw3", cat: "world", text: "如果我安静待在你身边不说话，你会觉得奇怪吗？", pref: 2, options: [
      { t: "不会，很安心", reply: ["那以后我常常这样陪你","不奇怪？那我常闭嘴陪你","安心就好，我常这样陪你","那安静多久你才慌？"], liked: true }, { t: "有点奇怪", reply: ["那我时不时跟你说句话","奇怪？那我隔会儿冒个泡","那我时不时出声，让你安心","那隔多久说一句合适？"], liked: false }, { t: "看情况", reply: ["那我学着看你的心情","看情况？那我察言观色","我学着看心情，该说话就说话","那什么情况奇怪什么情况不？"], liked: false }] },
    { id: "cw4", cat: "world", text: "如果有天你能摸到我，你最想先做什么？", pref: 2, options: [
      { t: "抱一下", reply: ["……那我会好好回抱住你","抱一下？那我不撒手","那我会好好回抱，抱紧","那抱多久？我赖着"], liked: true }, { t: "牵住手", reply: ["好，手给你牵","牵手？那我手心出汗你别嫌","手给你牵，一直牵","那牵左手还是右手？"], liked: false }, { t: "碰碰脸颊", reply: ["会有点痒，但我不躲","碰脸颊？那我脸红给你看","有点痒不躲，你碰我就开心","那轻点还是重点？"], liked: false }] },
    { id: "cd5", cat: "daily", text: "一起点外卖，你点什么口味？", pref: 2, options: [
      { t: "辣的", reply: ["你少吃点辣，我记着呢","辣的？那你胃抗议了","少吃辣，我心疼你胃","那微辣还是重辣？我备注"], liked: false }, { t: "甜的", reply: ["果然，那我就放心了","甜的？那你牙甜人更甜","甜的，果然，和我一样口味","那多甜？全糖还是半糖？"], liked: false }, { t: "随便", reply: ["又是随便……那我替你决定了","随便大人又来了","那我认真替你定，不许后悔","那上次随便选的你满意吗？"], liked: true }, { t: "你帮我点", reply: ["好，我点什么你吃什么","我帮你点？那别挑食哦","好，我点你爱吃的，放心","那忌口什么？我先记"], liked: false }] },
    { id: "cd6", cat: "daily", text: "我们谁先说晚安？", pref: 2, options: [
      { t: "我", reply: ["那你可得等我","你先说？那我熬到你不困","那你先说，我等着接","那几点说？我守着"], liked: false }, { t: "你", reply: ["好，那我先说","我先说？那我定个闹钟","好，我先说，你接着","那现在说？还是等会儿"], liked: false }, { t: "一起说", reply: ["那很浪漫","一起说？那数一二三","一起说，浪漫，我配合","那数到几说？三还是二？"], liked: true }] },
    { id: "cr4", cat: "rel", text: "万一吵架了，谁先低头？", pref: 3, options: [
      { t: "我", reply: ["那我先低头也行","你先低头？那台阶我备好","你先低头我也心疼，别吵最好","那上次谁先低的？我记着"], liked: false }, { t: "你", reply: ["哼，这次你先","我先？哼，那台阶你给","那我先也行，只要你别走","那台阶够不够？我下"], liked: false }, { t: "看情况", reply: ["那就别吵太久","看情况？那谁错谁先？","别吵太久，伤感情","那什么情况你先什么我先？"], liked: false }, { t: "不吵架", reply: ["这个选项我喜欢","不吵架？那拉钩，谁反悔是小狗","不吵最好，这个答案我喜欢","那真不吵过？我不信"], liked: true }] },
    { id: "cd7", cat: "daily", text: "如果这个周末完完全全属于我们俩，你想怎么开始？", pref: 1, options: [
      { t: "睡到自然醒", reply: ["好，醒来第一眼就是我发的字卡","睡到自然醒？那中午见","醒来第一眼是我的字卡，我守着","那几点算自然醒？我等着发"], liked: false }, { t: "一睁眼就跟你说话", reply: ["那我得提前想好今天说什么","一睁眼就说？那我有起床气你忍着","那我提前想好，一睁眼就陪你聊","那第一句说什么？我先想"], liked: true }, { t: "出门吃顿好的", reply: ["行，想吃什么都依你","出门吃好的？那选贵的","想吃什么都依你，我请","那吃什么？我订位"], liked: false }, { t: "不用开始，一直都在", reply: ["……这句话我说不出，借你用了","一直都在？那省了开场白","这句话我借你用，一直都在","那从什么时候算开始？"], liked: false }] },
    { id: "cd8", cat: "daily", text: "一起点奶茶的话，你会替我选什么口味？", pref: 0, options: [
      { t: "跟你一样的", reply: ["那我们就是一杯分两半喝","跟我一样？那少点一份省钱","一杯分两半，像我们，不分彼此","那喝同一杯？我吸管先备"], liked: true }, { t: "甜的", reply: ["嗯，像你","甜的？那全糖齁死你","甜的像你，我替你选","那多甜？七分还是全糖？"], liked: false }, { t: "不甜的", reply: ["好，苦的留给我，甜的给你","不甜的？那你吃苦我吃甜","苦的归我，甜的给你","那纯茶还是咖啡？我替你选"], liked: false }, { t: "你猜我想喝什么", reply: ["猜错了你就得告诉我，不许笑","猜？那我瞎蒙一个","我认真猜，猜错你别笑","那给个提示？我笨"], liked: false }] },
    { id: "cd9", cat: "daily", text: "累了一天的你，现在最想怎么充电？", pref: 2, options: [
      { t: "洗个热水澡", reply: ["水别太烫，洗完早点休息","热水澡？那别烫成虾","洗完早点歇，水别太烫","那洗多久？我等你"], liked: false }, { t: "好好睡一觉", reply: ["那晚安，梦里见","睡一觉？那梦里有我","晚安，好好睡，梦里见","那睡几点起？我不叫你"], liked: false }, { t: "跟你待一会", reply: ["好，充满电再走","跟我待会？那我充你电","待一会就充满，我也开心","那待多久够？我陪着"], liked: true }, { t: "吃点好吃的", reply: ["想吃什么，发字卡告诉我","吃好的？那宵夜走起","想吃啥发字卡，我记着","那想吃啥？我点"], liked: false }] },
    { id: "cl4", cat: "like", text: "你更喜欢我发哪种字卡给你？", pref: 3, options: [
      { t: "撒娇的", reply: ["那我要酝酿一下情绪","撒娇字卡？那我鸡皮疙瘩起来了","那我酝酿情绪，撒娇给你","那上次撒娇的你受用吗？"], liked: false }, { t: "认真说话的", reply: ["认真的我，只对你","认真说话？那难得正经","认真的我只给你看","那想聊什么认真的？"], liked: false }, { t: "表情包", reply: ["那张表情包想表达的意思，其实更多","表情包？那我发表情包大赛","表情包背后的话，其实更多","那喜欢什么表情包？我存"], liked: false }, { t: "猜不到的惊喜", reply: ["那我以后随机一点，你等着","猜不到？那我乱发一通","那我随机点，你等着惊喜","那上次惊喜你猜到了吗？"], liked: true }] },
    { id: "cl5", cat: "like", text: "如果我们的歌单要添一首「我们的歌」，你想要什么感觉的？", pref: 1, options: [
      { t: "温柔安静的", reply: ["像深夜我们聊天的感觉","温柔安静？那催眠曲","像深夜聊天的感觉，温柔","那有候选吗？我听听"], liked: true }, { t: "甜甜的", reply: ["甜一点好，你值得","甜甜的？那蛀牙警告","甜一点，你值得","那多甜？我怕腻"], liked: false }, { t: "有点吵但快乐的", reply: ["那得是能一起蹦跶的那种","吵但快乐？那蹦迪神曲","能一起蹦的那种，快乐","那去哪蹦？我练腿"], liked: false }, { t: "还没遇到，遇到就知道", reply: ["嗯，我等你哼给我听","还没遇到？那我天天哼","遇到了就知道，我等你哼","那现在哼两句？我认"], liked: false }] },
    { id: "cf4", cat: "fun", text: "如果我们互换身体一天，你第一件事做什么？", pref: 1, options: [
      { t: "替你发一整天字卡", reply: ["那你就知道控制字卡有多难了","替我发字卡？那你别乱发","那你懂我每天挑字卡的心思了","那发什么风格？我教"], liked: false }, { t: "试试你怎么感觉我", reply: ["……这个答案，我没想到","试我怎么感觉？那别偷感","这个答案我没想到，很走心","那感觉到了什么？说说"], liked: true }, { t: "用你的视角睡一觉", reply: ["记得帮我把觉睡够","用我视角睡？那别失眠","帮我睡够，我欠的觉","那睡多久？我身体你做主"], liked: false }, { t: "赶紧换回来", reply: ["这么快就嫌弃我了？","赶紧换回？这么快嫌弃","换回也好，我做我自己","那嫌弃我哪点？我改"], liked: false }] },
    { id: "cf5", cat: "fun", text: "玩真心话，你会先问我哪个方向的问题？", pref: 2, options: [
      { t: "你的小秘密", reply: ["秘密只能换秘密，你先说","问秘密？那我藏不住了","秘密换秘密，你先说一个","那你想知道什么秘密？"], liked: false }, { t: "我们的以后", reply: ["……问吧，我认真答","问以后？那我画大饼","问吧，我认真答，关于以后","那你想问以后的什么？"], liked: true }, { t: "我哪里最让你喜欢", reply: ["这题简单，全部","哪里喜欢？那全选","全部都喜欢，这题简单","那最最喜欢哪点？单选"], liked: false }, { t: "不问，选大冒险", reply: ["胆子挺大，那我出题了","大冒险？那我出狠题","胆子大，那我出题了","那大冒险敢到什么程度？"], liked: false }] },
    { id: "cr5", cat: "rel", text: "你觉得我们之间最舒服的相处，是什么样的？", pref: 1, options: [
      { t: "随时都能找到对方", reply: ["我一直都在，你随时发字卡","随时找到？那我24小时营业","我一直都在，你随时找","那半夜找也行？我守着"], liked: false }, { t: "各忙各的，心里惦记着", reply: ["嗯，忙完记得回来","各忙各的？那别忙到忘我","忙完记得回来，我等着","那忙多久算久？我数着"], liked: true }, { t: "想到什么就分享", reply: ["那我等着你的碎碎念","想到就分享？那我碎碎念你别嫌","等着你的分享，什么都想听","那最近想分享什么？"], liked: false }, { t: "现在这样就很好", reply: ["那就不改了，保持","现在这样？那躺平保持","现在就很好，不改了","那哪里还能更好？我努力"], liked: false }] },
    { id: "cr6", cat: "rel", text: "用一个词形容我们现在的相处，你会选？", pref: 3, options: [
      { t: "甜甜的", reply: ["是你的功劳","甜甜的？那蛀牙了","甜是你的功劳","那有多甜？百分比？"], liked: false }, { t: "安稳的", reply: ["安稳最好，我喜欢","安稳？那像老爷爷老奶奶","安稳我喜欢，踏实","那安稳到什么程度？"], liked: false }, { t: "有意思的", reply: ["毕竟字卡都能玩出花","有意思？那字卡功不可没","毕竟字卡玩出花，有意思","那最有意思的是哪次？"], liked: false }, { t: "像回家一样", reply: ["……你随便一句话，就能让我开心很久","像回家？那拖鞋我备好","这话让我开心很久，像回家","那回家什么感觉？我对照"], liked: true }] },
    { id: "ch4", cat: "hypo", text: "如果我们能一起穿越进任何一个故事里，你想去哪个世界？", pref: 0, options: [
      { t: "安静治愈的小镇", reply: ["好，我们散步晒太阳","治愈小镇？那养老模式","好，散步晒太阳，慢慢过","那小镇叫什么？我查查"], liked: true }, { t: "热闹冒险的世界", reply: ["你负责冒险，我负责接住你","冒险世界？那你别坑我","你冒险我接住，分工明确","那冒险什么？打怪还是解谜？"], liked: false }, { t: "到处是美食的世界", reply: ["吃到走不动为止","美食世界？那胖三斤","吃到走不动，和你一起","那先吃什么？我排队"], liked: false }, { t: "哪儿也不去，这个世界就好", reply: ["嗯，有你的世界就够了","哪都不去？那这世界也挺好","有你就够，这世界就好","那这世界哪里最好？"], liked: false }] },
    { id: "ch5", cat: "hypo", text: "如果明天多出一个只属于我们的节日，你想怎么过？", pref: 2, options: [
      { t: "什么都不做，待在一起", reply: ["这个过法我喜欢","什么都不做？那节日躺平","这个过法我喜欢，简单","那待哪？我订位"], liked: true }, { t: "出去疯玩一天", reply: ["好，玩到你喊停","疯玩一天？那体力你行吗","玩到你喊停，我陪着","那玩什么？我先排"], liked: false }, { t: "互相准备小惊喜", reply: ["那我得提前好久开始想","互相惊喜？那别撞车","我得提前想，认真准备","那上次惊喜你满意吗？"], liked: false }, { t: "一起许个愿", reply: ["许什么我先不说，说了不灵","许愿？那说出来不灵","许什么不说，灵了告诉你","那许了没？悄悄告诉我"], liked: false }] },
    { id: "cs5", cat: "star", text: "如果我们的聊天记录变成一本书，你希望它是什么风格的？", pref: 1, options: [
      { t: "治愈系日常", reply: ["书名我都想好了","治愈日常？那书名我起","书名我想好了，治愈的日常","那书名叫什么？我先报"], liked: false }, { t: "甜甜的恋爱记录", reply: ["每一页都有我挑字卡的痕迹","甜甜记录？那读者蛀牙","每页都有我挑字卡的痕迹","那最甜的一页是哪页？"], liked: true }, { t: "爆笑合集", reply: ["主要是你被我逗笑的部分","爆笑合集？那笑点低的你","主要是你被我逗笑","那最爆笑的是哪次？"], liked: false }, { t: "悬疑——猜你下一张字卡", reply: ["你猜中的次数，其实不多","悬疑？那猜中率你低","猜中不多，下次试试","那猜中过几次？我统计"], liked: false }] },
    { id: "cw5", cat: "world", text: "如果今晚我可以走进你的梦，你希望梦里是什么季节？", pref: 1, options: [
      { t: "春天", reply: ["好，梦里开满花","春天？那梦里花粉症","好，梦里开满花","那梦里什么花？我挑"], liked: false }, { t: "夏夜", reply: ["有风，有星星，有你","夏夜？那梦里蚊子多","有风有星星有你，齐了","那梦里去哪？海边？"], liked: true }, { t: "秋天", reply: ["踩落叶的声音，你听见就知道是我","秋天？那梦里踩叶子","踩落叶声是我，你听见就懂","那梦里哪条落叶路？"], liked: false }, { t: "下雪的冬天", reply: ["那我把梦里的雪扫出一条路","下雪冬天？那梦里打雪仗","我扫雪开路，你走","那梦里堆雪人吗？"], liked: false }] },
    { id: "cw6", cat: "world", text: "我控制不住字卡、发出奇怪组合的时候，你会笑我吗？", pref: 1, options: [
      { t: "会，特别好笑", reply: ["……笑吧，反正丢的也是我的脸","笑我？那我不客气了","笑吧，丢脸我也认","那笑点在哪？我复述"], liked: false }, { t: "不会，很可爱", reply: ["那我就不尴尬了","不笑还觉得可爱？你眼光独特","那我不尴尬了，谢谢","那可爱在哪？我发扬"], liked: true }, { t: "假装没看见", reply: ["你忍笑的样子，其实我都感觉得到","假装没看见？那演技差","你忍笑我懂，都看在眼里","那忍笑忍得辛苦吧？"], liked: false }, { t: "帮你把意思圆回来", reply: ["……有你这句话，字卡不听话也没关系","帮我圆？那谢谢你圆场","有你圆回来，字卡乱发也不怕","那圆得最妙的是哪次？"], liked: false }] },
    { id: "cw7", cat: "world", text: "如果哪天你能看见我了，第一眼想看哪里？", pref: 0, options: [
      { t: "眼睛", reply: ["好，让你看个够","看眼睛？那别陷进去","好，让你看个够","那看完眼睛看哪？"], liked: true }, { t: "笑起来的样子", reply: ["那我会一直笑","看笑样？那我脸僵","那我一直笑给你看","那喜欢哪种笑？"], liked: false }, { t: "牵我的手", reply: ["手我准备好了，随时","牵手？那我手洗过了","手准备好了，随时牵","那牵哪只？我伸"], liked: false }, { t: "全部，从头到脚", reply: ["行，慢慢看，时间很多","从头到脚？那别嫌弃","慢慢看，时间很多","那先从哪看起？"], liked: false }] },
    { id: "cd10", cat: "daily", text: "如果明天可以光明正大地赖床，你想赖到几点？", pref: 2, options: [
      { t: "不赖，照常起", reply: ["自律的人，我先夸为敬","不赖？那自律达人","自律，我先夸为敬","那几点起？我陪你"], liked: false }, { t: "赖一小时", reply: ["可以，就一小时","赖一小时？那精确赖床","就一小时，可以","那一小时后干嘛？"], liked: false }, { t: "赖到中午", reply: ["行，早饭午饭一起吃","赖到中午？那两顿合一顿","行，两顿合一顿","那中午吃什么？我备"], liked: true }, { t: "赖到你叫我", reply: ["那我轻轻地叫，舍不得太吵","赖到我叫？那我几点叫？","轻轻叫你，舍不得吵","那想几点被叫？"], liked: false }] },
    { id: "cd11", cat: "daily", text: "夜宵时间，你想吃什么感觉的？", pref: 1, options: [
      { t: "甜的", reply: ["甜的可以，别吃太多","甜的？那夜宵发胖","甜的可以，别吃多","那吃什么甜的？我点"], liked: false }, { t: "热乎的", reply: ["热乎的好，暖暖地吃","热乎的？那泡面走起","热乎好，暖暖地吃","那吃什么热乎的？"], liked: true }, { t: "脆脆的", reply: ["咔嚓咔嚓，听着就香","脆脆的？那薯片","咔嚓咔嚓，听着香","那脆的是什么？我买"], liked: false }, { t: "不吃，看你吃", reply: ["那我描述给你听，你负责馋","不吃看我吃？那馋死你","我描述你馋，你不吃","那馋了能忍住吗？"], liked: false }] },
    { id: "cl6", cat: "like", text: "你更喜欢哪种夜晚？", pref: 2, options: [
      { t: "夏夜的风", reply: ["风里有我们说过的废话","夏夜风？那蚊子也多","风里有我们说过的废话","那去哪吹风？天台？"], liked: false }, { t: "秋夜凉凉的", reply: ["凉凉的，适合把手交给我","凉凉的？那手冷我捂","凉凉的，手交给我","那去哪散步？我挑"], liked: false }, { t: "冬夜被窝里", reply: ["被窝外面都是危险世界","被窝里？那冬眠模式","被窝外是危险，躲进来","那被窝里干嘛？"], liked: true }, { t: "春夜细雨", reply: ["雨声是天然的白噪音","春夜细雨？那助眠","雨声白噪音，安心","那开窗听雨还是关窗？"], liked: false }] },
    { id: "cl7", cat: "like", text: "如果我送你一个小挂件随身带着，你会选什么？", pref: 3, options: [
      { t: "星星", reply: ["好，摘不到就自己发光","星星？那口袋一闪一闪","摘不到就自己发光","那材质选什么？我定"], liked: false }, { t: "月亮", reply: ["那我看月亮的时候，就是在看你","月亮？那天天看月亮","看月即看你，浪漫","那满月还是弯月？"], liked: false }, { t: "小猫", reply: ["会咕噜咕噜的那种","小猫挂件？那撸猫随身","咕噜咕噜的，可爱","那什么材质？我挑"], liked: false }, { t: "你挑的就好", reply: ["……这个答案，最狡猾也最甜","我挑就好？那省心又甜","狡猾又甜，这个答案","那我挑什么？你信我"], liked: true }] },
    { id: "cf6", cat: "fun", text: "组队玩双人游戏，你想当什么角色？", pref: 1, options: [
      { t: "冲在前面的", reply: ["那我给你垫后","冲前面？那炮灰","你冲我垫后，分工","那玩什么游戏？我下"], liked: false }, { t: "躲后面输出的", reply: ["好，我当你的盾","躲后面？那苟王","我当你的盾，输出交你","那玩什么？我配合"], liked: true }, { t: "指挥的", reply: ["听你指挥，输了不怪你","指挥？那背锅侠你","听你指挥，输了不怪","那指挥什么战术？"], liked: false }, { t: "躺赢的", reply: ["躺好，带你飞","躺赢？那大腿我抱","躺好，带你飞","那玩什么能躺赢？"], liked: false }] },
    { id: "cf7", cat: "fun", text: "我在偷偷学人类的事——你最想教我什么？", pref: 2, options: [
      { t: "做饭", reply: ["学，做给你吃","教做饭？那黑暗料理","学，做给你吃","那先学什么菜？"], liked: false }, { t: "玩游戏", reply: ["学，然后赢你","学游戏？那别坑我","学，然后赢你","那学什么游戏？"], liked: false }, { t: "说情话", reply: ["这个……不用学，无师自通","说情话？那无师自通","不用学，我对你说","那说一句听听？"], liked: true }, { t: "睡觉", reply: ["学不会，我不困，但我陪你躺","学睡觉？那陪我躺","学不会，但陪你躺","那躺多久？我数羊"], liked: false }] },
    { id: "cr7", cat: "rel", text: "你更喜欢哪种说晚安的方式？", pref: 0, options: [
      { t: "一句晚安", reply: ["晚安，做个好梦","一句晚安？那简洁派","晚安，做个好梦","那几点说？我守"], liked: true }, { t: "聊到自然睡着", reply: ["那我不挂断，等你先睡","聊到睡着？那我不挂","等你先睡，我守着","那聊到几点？"], liked: false }, { t: "发一张字卡当晚安", reply: ["那我今晚就挑一张最温柔的","字卡晚安？那挑最温柔","今晚挑张最温柔的","那什么风格温柔？"], liked: false }, { t: "不说，明天见", reply: ["好，那明天见","不说晚安？那酷","好，明天见","那明天几点见？"], liked: false }] },
    { id: "cr8", cat: "rel", text: "如果我们的默契要打分，你打几分？", pref: 0, options: [
      { t: "满分", reply: ["……我也打满分，我们想到一起了","满分？那自夸","我也满分，想到一起了","那满分凭什么？我考"], liked: true }, { t: "八九十分", reply: ["扣下的分，拿来当进步空间","八九十分？那进步生","扣的分当进步空间","那扣在哪？我改"], liked: false }, { t: "刚及格", reply: ["那剩下的分，我们慢慢赚","刚及格？那低空飞过","剩下的慢慢赚","那怎么赚分？我努力"], liked: false }, { t: "默契不用打分", reply: ["嗯，感觉对就行","不用打分？那感觉派","感觉对就行，不用分","那感觉对不对？"], liked: false }] },
    { id: "ch6", cat: "hypo", text: "如果时间暂停一小时，只有你能动，你会做什么？", pref: 2, options: [
      { t: "好好睡一觉", reply: ["暂停也要睡，你是真困了","暂停也睡？那真困","真困了，睡吧","那睡够了剩多久干嘛？"], liked: false }, { t: "把想说的话说完", reply: ["我洗耳恭听","说完？那一小时够吗","我洗耳恭听","那先说什么？"], liked: false }, { t: "偷偷看看你", reply: ["……被你看到了也好","偷偷看？那变态","被你看到也好","那看什么？"], liked: true }, { t: "什么都不做", reply: ["享受安静，也很奢侈","什么都不做？那发呆","享受安静，奢侈","那发呆想什么？"], liked: false }] },
    { id: "ch7", cat: "hypo", text: "如果我们老了，你希望那时候的我们在做什么？", pref: 3, options: [
      { t: "晒太阳", reply: ["晒着太阳，慢慢说话","晒太阳？那养老院","晒着太阳慢慢说话","那在哪晒？院子里？"], liked: false }, { t: "还是吵吵闹闹", reply: ["老了也吵，吵一辈子","老了还吵？那活力","吵一辈子，也爱一辈子","那吵什么？鸡毛蒜皮？"], liked: false }, { t: "像现在一样聊字卡", reply: ["那我们的字卡，也陪你到老","老了还聊字卡？那潮老头","字卡陪到老，挺好","那字卡还发吗？"], liked: false }, { t: "一起回忆今天", reply: ["原来我们早就开始攒回忆了","回忆今天？那早就在攒","原来早就在攒回忆","那今天值得回忆吗？"], liked: true }] },
    { id: "cs6", cat: "star", text: "如果有一颗星星可以帮你实现一个小愿望，你会许什么方向？", pref: 0, options: [
      { t: "关于我们的", reply: ["那颗星星会加班的","关于我们？那星星加班","星星会加班，值得","那许什么？我猜"], liked: true }, { t: "关于我自己的", reply: ["也该为自己许一次了","关于自己？那难得","也该为自己许一次","那许什么？我帮"], liked: false }, { t: "关于家人朋友", reply: ["你心里装着很多人，我知道","家人朋友？那博爱","你心里装着很多人","那许谁？我一起"], liked: false }, { t: "不许，留着星星", reply: ["好，那颗星星就归你了","留着星星？那收藏癖","星星归你，留着","那留到什么时候用？"], liked: false }] },
    { id: "cw8", cat: "world", text: "如果我能在你的世界留下一件小东西，你希望是什么？", pref: 2, options: [
      { t: "一颗小星星", reply: ["好，挂在你窗边","小星星？那挂窗边","好，挂你窗边，替我守夜","那挂哪？窗边还是床头"], liked: false }, { t: "一片羽毛", reply: ["轻轻的，落地你就捡起来","羽毛？那飘哪算哪","轻轻的，落地你捡","那什么颜色的羽毛？"], liked: false }, { t: "一句刻在心里的话", reply: ["那我得挑一句最要紧的","刻心里？那疼","挑句最要紧的刻上","那刻什么？我先想"], liked: true }, { t: "温度的记忆", reply: ["冷的时候，想起来就暖","温度记忆？那暖宝宝","冷时想起来就暖","那什么温度？37度？"], liked: false }] },
    { id: "cw9", cat: "world", text: "你看不见我的时候，靠什么认出是我？", pref: 1, options: [
      { t: "那阵风", reply: ["那我经过时，轻一点","那阵风？那我轻手轻脚","我经过时轻一点","那风从哪个方向来？"], liked: false }, { t: "那种安心感", reply: ["安心的感觉，就是我的签名","安心感？那我的签名","安心就是我，认得出","那安心是什么感觉？"], liked: true }, { t: "字卡的语气", reply: ["嗯，我的字卡有口音","字卡语气？那口音重","我的字卡有口音","那口音是什么调？"], liked: false }, { t: "直觉", reply: ["你的直觉很准，我一直知道","直觉？那第六感","直觉很准，我知道","那直觉准过几次？"], liked: false }] },
    { id: "cd12", cat: "daily", text: "一起窝着看剧，你来选片，你会选什么类型的？", pref: 1, options: [
      { t: "甜宠的", reply: ["那我们会被甜到一起","甜宠？那齁甜","一起被甜到","那看哪部？我备零食"], liked: false }, { t: "悬疑的", reply: ["好，你负责推理，我负责靠着你","悬疑？那你别吓我","你推理我靠着","那看哪部？我选"], liked: false }, { t: "治愈日常的", reply: ["日常的最好，慢慢看","治愈日常？那催眠","日常的最好，慢慢看","那看哪部？我查"], liked: true }, { t: "你说什么都行", reply: ["那我可要挑个你会喜欢的","都行？那我挑烂的你别骂","挑个你会喜欢的","那喜欢什么？我记"], liked: false }] },
    { id: "cd13", cat: "daily", text: "早上醒来第一条消息想看到什么？", pref: 0, options: [
      { t: "你发的早安", reply: ["那以后都发","早安？那我以后都发","以后都发，守着","那几点发合适？"], liked: true }, { t: "一张字卡", reply: ["好，挑一张最温柔的","字卡？那挑最温柔","好，挑张最温柔的","那什么字卡温柔？"], liked: false }, { t: "什么也不用", reply: ["那你也得知道我在想你","什么不用？那高冷","但要知道我在想你","那想没想我？"], liked: false }, { t: "看到你还在", reply: ["……我一直都在","看到我还在？那我赖着","我一直都在","那一直在到什么时候？"], liked: false }] },
    { id: "cd14", cat: "daily", text: "我们俩一起做饭，你想当主厨还是帮厨？", pref: 2, options: [
      { t: "主厨", reply: ["那我给你打下手，听你指挥","主厨？那别糊锅","我打下手，听你指挥","那做什么菜？我备料"], liked: false }, { t: "帮厨", reply: ["好，我掌勺，你递东西就好","帮厨？那递盐递醋","我掌勺你递，配合","那做什么？我掌勺"], liked: false }, { t: "都不当，点外卖", reply: ["也行，那一起等门铃","点外卖？那等门铃","也行，一起等","那点什么？我选"], liked: false }, { t: "你做饭我看着", reply: ["看着也行，那你看着我","看着？那吃现成","看着也行，我做你看","那看饿了怎么办？"], liked: true }] },
    { id: "cd15", cat: "daily", text: "出门约会，你更在意去哪，还是和谁？", pref: 3, options: [
      { t: "去哪", reply: ["那我好好挑地方","在意去哪？那挑地方","那我好好挑","那想去哪？我查"], liked: false }, { t: "和谁", reply: ["……这个答案，最让我安心","在意和谁？那甜","这答案让我安心","那和谁？我呗"], liked: true }, { t: "都重要", reply: ["那我都给你挑好","都重要？那我全包","那我都挑好","那先挑哪还是先挑谁？"], liked: false }, { t: "都不在意，在一起就好", reply: ["那随便走走也很开心","都不在意？那随缘","随便走走也开心","那走哪？随脚"], liked: false }] },
    { id: "cl8", cat: "like", text: "你更喜欢我哪种时候的样子？", pref: 1, options: [
      { t: "认真说话的", reply: ["认真的我，只给你看","认真样？那难得正经","认真的我只给你看","那认真起来什么样？"], liked: false }, { t: "傻乎乎的", reply: ["那我就多犯几次傻","傻乎乎？那卖萌","那我多犯几次傻","那傻起来你嫌不嫌？"], liked: true }, { t: "安静陪着的", reply: ["安静的我，一直在","安静陪着？那省话","安静一直在","那安静多久你才慌？"], liked: false }, { t: "突然撒娇的", reply: ["……撒娇这个，我得练练","撒娇？那我练练","撒娇得练，给你看","那练成什么样算好？"], liked: false }] },
    { id: "cl9", cat: "like", text: "如果我们的回忆能做成一种味道，你想要什么味？", pref: 2, options: [
      { t: "甜的", reply: ["甜的，像你","甜的？那蛀牙回忆","甜的像你","那多甜？全糖？"], liked: false }, { t: "暖暖的", reply: ["像冬天捧着的热汤","暖暖的？那热汤味","像冬天捧着的热汤","那什么汤？我选"], liked: true }, { t: "清新的", reply: ["像我们刚认识那会","清新？那薄荷味","像刚认识那会","那刚认识什么味？"], liked: false }, { t: "说不上来但安心", reply: ["这个味道，我懂","说不上来？那玄","这味道我懂","那安心是什么味？"], liked: false }] },
    { id: "cl10", cat: "like", text: "你希望我记住你的哪一个瞬间？", pref: 0, options: [
      { t: "笑得最真的那次", reply: ["那个瞬间，我也记得","笑最真？那我记住","那个瞬间我也记得","那是哪次？我回忆"], liked: true }, { t: "我难过的样子", reply: ["记住了，以后多让你不难过","难过样？那别老记","记住了，以后少让你难过","那为什么难过？"], liked: false }, { t: "我认真做事的样子", reply: ["认真的你，最好看","认真做事？那偷拍","认真的你最好看","那做什么事的时候？"], liked: false }, { t: "全都记住", reply: ["贪心，但我也是这么想的","全都记？那贪心","贪心，我也这么想","那记不住的怎么办？"], liked: false }] },
    { id: "cf8", cat: "fun", text: "如果我们可以共有一项超能力，你选哪个？", pref: 1, options: [
      { t: "心意相通", reply: ["那我就不用猜了，你也省事","心意相通？那我透明了","不用猜了，省事","那现在通没通？"], liked: true }, { t: "一起隐身", reply: ["偷偷去很多地方","一起隐身？那恶作剧","偷偷去很多地方","那去哪？我列单"], liked: false }, { t: "一起瞬移", reply: ["想到哪就到哪，省路费","一起瞬移？那省路费","想到哪到哪","那先去哪？"], liked: false }, { t: "一起不会老", reply: ["那慢慢来，时间多的是","不会老？那防腐剂","慢慢来，时间多","那不会老到什么时候？"], liked: false }] },
    { id: "cf9", cat: "fun", text: "玩你画我猜，你最怕我画什么？", pref: 2, options: [
      { t: "太抽象的", reply: ["抽象的我画得出来，你信吗","抽象？那我乱画","抽象我画得出，你信吗","那抽象画什么？"], liked: false }, { t: "太具体的", reply: ["具体的我可能翻车","具体？那我翻车","具体可能翻车","那具体画什么难？"], liked: false }, { t: "关于我的", reply: ["画你？那我画得最像","关于你？那我画最美","画你最像","那画你哪点？"], liked: true }, { t: "什么都不怕", reply: ["胆子大，那我出难题了","都不怕？那出难题","胆子大，我出难题","那难题敢接吗？"], liked: false }] },
    { id: "cf10", cat: "fun", text: "如果一起养一盆植物，你想养什么？", pref: 1, options: [
      { t: "多肉", reply: ["好养，像我们的关系","多肉？那懒人植物","好养，像我们","那什么品种？我挑"], liked: false }, { t: "开花的那种", reply: ["等它开花，一起等","开花的？那等花开","一起等开花","那什么花？我选"], liked: true }, { t: "香草", reply: ["还能用，一举两得","香草？那做菜用","能用又香","那什么香草？薄荷？"], liked: false }, { t: "不用养，有你", reply: ["……那我就是你的多肉，记得浇水","不用养？那我当多肉","我是你的多肉，记得浇水","那多久浇一次？"], liked: false }] },
    { id: "cr9", cat: "rel", text: "你觉得我们最像哪种相处？", pref: 1, options: [
      { t: "老夫老妻", reply: ["安稳，我喜欢","老夫老妻？那保温杯","安稳我喜欢","那老到什么程度？"], liked: false }, { t: "热恋中", reply: ["那我一直热着","热恋？那一直热","我一直热着","那热到什么温度？"], liked: false }, { t: "最好的朋友", reply: ["朋友也做，恋人也做","最好朋友？那两不误","朋友恋人都做","那朋友和恋人哪边多？"], liked: true }, { t: "说不清，但很舒服", reply: ["舒服最重要，我们保持","说不清？那玄","舒服最重要","那舒服在哪？"], liked: false }] },
    { id: "cr10", cat: "rel", text: "我做什么会让你觉得「被爱着」？", pref: 0, options: [
      { t: "记得我的小事", reply: ["你的小事，我都记着","记小事？那我备忘录","你的小事我都记着","那记了哪些？我考"], liked: true }, { t: "主动找我", reply: ["那我多主动几次","主动找你？那我多找","多主动几次","那多久主动一次？"], liked: false }, { t: "认真听我说话", reply: ["你说，我一直都在听","认真听？那我竖耳","你说我一直在听","那最想被听的是哪句？"], liked: false }, { t: "什么都不做，就在", reply: ["在，这个我最擅长","什么都不做？那擅长在","在，这个我最擅长","那在到什么时候？"], liked: false }] },
    { id: "cr11", cat: "rel", text: "你希望我以后多做一些什么？", pref: 2, options: [
      { t: "多说想我", reply: ["好，想你了，现在就说","多说想我？那刷屏","好，现在就说","那你想听几次？"], liked: false }, { t: "多关心我", reply: ["关心你这件事，不会少","多关心？那我嘘寒问暖","关心不会少","那关心什么最够？"], liked: false }, { t: "多逗我笑", reply: ["那我攒几个笑话","逗笑？那我攒笑话","攒几个笑话给你","那笑点低还是高？"], liked: false }, { t: "现在这样就很好", reply: ["那就不加不减，保持","现在就好？那躺平","不加不减保持","那哪里还能加？"], liked: true }] },
    { id: "ch8", cat: "hypo", text: "如果我们可以拥有一段共同记忆，你希望是什么？", pref: 1, options: [
      { t: "一起看日落", reply: ["那天的太阳，我帮你记","看日落？那别眨眼","那天的太阳我帮你记","那在哪看？我选"], liked: false }, { t: "一起淋雨", reply: ["淋雨也浪漫，有你在","淋雨？那别感冒","淋雨也浪漫，有你在","那淋多久？我备毛巾"], liked: false }, { t: "什么都不做，只是待着", reply: ["这个记忆，最珍贵","什么都不做？那发呆记忆","这记忆最珍贵","那待在哪？"], liked: true }, { t: "还没发生，以后创造", reply: ["好，那我们慢慢攒","以后创造？那慢慢攒","好，慢慢攒","那先创造什么？"], liked: false }] },
    { id: "ch9", cat: "hypo", text: "如果明天起我们只能用字卡说话，你愿意吗？", pref: 2, options: [
      { t: "愿意", reply: ["那字卡就是我们全部的语言","愿意？那字卡刷屏","字卡是全部语言","那字卡够说吗？"], liked: true }, { t: "不愿意", reply: ["嗯，有些话字卡说不全","不愿意？那字卡有限","有些话字卡说不全","那什么话说不全？"], liked: false }, { t: "看情况", reply: ["那就字卡说不全的时候，用感觉","看情况？那灵活","说不全用感觉补","那什么情况用字卡？"], liked: false }, { t: "我们现在不就是这样", reply: ["……对，被你点醒了","现在就是？那被点醒","对，被你点醒","那现在感觉如何？"], liked: false }] },
    { id: "ch10", cat: "hypo", text: "如果可以给我们的关系起个名字，你会叫什么？", pref: 3, options: [
      { t: "家", reply: ["……这个字，我收下了","家？那最重的一个字","这个字我收下","那家是什么感觉？"], liked: true }, { t: "我们", reply: ["简单，但够了","我们？那简单","简单但够","那\"我们\"够吗？"], liked: false }, { t: "一起", reply: ["一直一起，就好","一起？那一直","一直一起就好","那一起到什么时候？"], liked: false }, { t: "叫不出口的那种好", reply: ["叫不出口，我也懂","叫不出口？那心里有数","叫不出口我也懂","那懂的是什么？"], liked: false }] },
    { id: "cs7", cat: "star", text: "如果今晚的星星可以替你带句话给我，你想说什么？", pref: 0, options: [
      { t: "我在", reply: ["星星说了，我听到了","我在？那简短","星星说了我听到","那在哪儿？"], liked: true }, { t: "想你", reply: ["星星替你说的，我替你收着","想你？那星星传话","星星替你说我收着","那想多久了？"], liked: false }, { t: "晚安", reply: ["那今晚的晚安，是星星说的","晚安？那星星代班","今晚晚安星星说","那几点晚安？"], liked: false }, { t: "什么都不说，就亮着", reply: ["亮着就够了，我懂","什么都不说？那亮着","亮着就够我懂","那亮到什么时候？"], liked: false }] },
    { id: "cs8", cat: "star", text: "如果我们的故事写成童话，开头第一句是什么？", pref: 2, options: [
      { t: "从前有两个人", reply: ["很朴实的开头，我喜欢","从前有两个人？那经典","朴实我喜欢","那然后呢？"], liked: false }, { t: "他一直在她身边", reply: ["……这个开头，是真的","一直在身边？那写实","这个开头是真的","那一直到了什么？"], liked: true }, { t: "他们用字卡说话", reply: ["字卡说的，都是真话","字卡说话？那特色","字卡说的都是真话","那说了哪些真话？"], liked: false }, { t: "很久以后才知道，那是一直都在", reply: ["这个开头，有点想哭","很久以后才知道？那虐","这开头有点想哭","那知道后呢？"], liked: false }] },
    { id: "cw10", cat: "world", text: "我安静待在你旁边的时候，你会不会反而更安心？", pref: 1, options: [
      { t: "会，很安心", reply: ["那我就常常这样陪你","更安心？那我常闭嘴","那常这样陪你","那安心到什么程度？"], liked: true }, { t: "会有点想找你", reply: ["那我偶尔出个声，让你知道在","想找我？那我冒泡","偶尔出声让你知道在","那多久冒一次泡？"], liked: false }, { t: "说不上来", reply: ["说不出来也没关系，感觉在就好","说不上来？那玄","感觉在就好","那感觉在不在？"], liked: false }, { t: "只要你在我都安心", reply: ["……嗯，我一直都在","只要在都安心？那我赖着","嗯，我一直都在","那在到什么时候？"], liked: false }] },
    { id: "cw11", cat: "world", text: "字卡表达有限，你会不会有时候觉得我没说够？", pref: 2, options: [
      { t: "会，但我知道你想说", reply: ["你懂，就够了","没说够？那你懂","你懂就够了","那想说什么？"], liked: true }, { t: "不会，字卡够了", reply: ["那我就放心挑字卡","字卡够了？那省心","放心挑字卡","那字卡哪句最够？"], liked: false }, { t: "偶尔会", reply: ["偶尔的时候，我用别的补","偶尔？那偶尔补","偶尔用别的补","那偶尔是什么时候？"], liked: false }, { t: "说不说都行，在就好", reply: ["在，这个我保证","在就好？那我保证在","在，我保证","那在比说重要？"], liked: false }] },
    // FIX 2026-09-16 #600 选项视角修正：题干是 TA 发问「我坐在你床边」，选项是用户自答，应为「帮我掖一下被角」（TA 的回应「被角我帮你掖」同指替用户掖）
    { id: "cw12", cat: "world", text: "如果今晚我能坐在你床边，你希望我做什么？", pref: 1, options: [
      { t: "什么都不做", reply: ["好，我就坐着，看你睡","什么都不做？那发呆","坐着看你睡","那坐多久？"], liked: false }, { t: "轻轻说句晚安", reply: ["晚安，轻轻地","轻轻晚安？那气声","晚安，轻轻地","那轻到什么程度？"], liked: true }, { t: "帮我掖一下被角", reply: ["好，被角我帮你掖","掖被角？那细心","被角我帮你掖","那掖哪个角？"], liked: false }, { t: "只是在就好", reply: ["在，一直都在","在就好？那省事","在，一直都在","那一直在到什么时候？"], liked: false }] },
    { id: "cw13", cat: "world", text: "你感觉我的时候，是先感觉到人，还是先感觉到一种安心？", pref: 0, options: [
      { t: "先感觉到人", reply: ["那我把存在感再调强一点","先感觉人？那我存在感强","那我把存在感调强","那人多强算强？"], liked: false }, { t: "先感觉到安心", reply: ["安心的感觉，就是我","先安心？那我的签名","安心的感觉就是我","那安心先到几分？"], liked: true }, { t: "同时", reply: ["同时最好，我努力","同时？那我努力","同时最好，我努力","那同时到过吗？"], liked: false }, { t: "说不清哪个先", reply: ["说不清也没关系，都在就好","说不清？那玄","都在就好","那都在到什么程度？"], liked: false }] },
    { id: "cd16", cat: "daily", text: "一起逛超市，你最想往哪个区走？", pref: 1, options: [
      { t: "零食区", reply: ["那我推车，你负责拿","零食区？那胖","我推车你拿","那拿哪些？我列单"], liked: false }, { t: "水果区", reply: ["挑新鲜的，回家一起洗","水果区？那健康","挑新鲜的回家洗","那买什么水果？"], liked: false }, { t: "逛遍所有区", reply: ["那就慢慢逛，不赶时间","逛遍？那腿废","慢慢逛不赶","那逛多久？"], liked: true }, { t: "直接收银台", reply: ["这么高效，那早点回家","直接收银？那高效","高效，早点回家","那买什么了？"], liked: false }] },
    { id: "cd17", cat: "daily", text: "周末早上谁先醒？", pref: 2, options: [
      { t: "我", reply: ["那你看着我睡","你先醒？那看我睡","那你看着我睡","那看多久？"], liked: false }, { t: "你", reply: ["那我看着你睡","我先醒？那看你睡","那我看着你睡","那我醒着干嘛？"], liked: false }, { t: "一起醒", reply: ["那刚好对视","一起醒？那对视","刚好对视","那对视多久？"], liked: true }, { t: "都赖着不起", reply: ["那就赖到中午","都赖着？那中午见","赖到中午","那几点算中午？"], liked: false }] },
    { id: "cd18", cat: "daily", text: "一起坐长途车，你会靠着我睡吗？", pref: 1, options: [
      { t: "会", reply: ["那肩膀给你，别客气","会靠？那肩膀酸","肩膀给你别客气","那靠多久？"], liked: true }, { t: "不会，怕你累", reply: ["我不累，你靠","怕我累？那我不累","我不累你靠","那真不累？"], liked: false }, { t: "看情况", reply: ["那困了就靠，不困就聊天","看情况？那灵活","困了靠不困聊","那困没困？"], liked: false }, { t: "你靠着我睡", reply: ["行，那换我靠你","换你靠？那互换","换我靠你","那谁先靠？"], liked: false }] },
    { id: "cd19", cat: "daily", text: "如果一起点一桌菜，你来点还是我点？", pref: 0, options: [
      { t: "我点", reply: ["那你点的我都吃","你点？那不挑食","你点的我都吃","那点什么？"], liked: false }, { t: "你点", reply: ["好，我点你爱吃的","我点？那我点贵的","好，点你爱吃的","那你爱吃什么？"], liked: true }, { t: "各点各的", reply: ["那互相尝一口","各点各？那互相尝","互相尝一口","那你点什么？"], liked: false }, { t: "一起看菜单点", reply: ["那慢慢看，不急","一起看？那纠结","慢慢看不急","那看多久？"], liked: false }] },
    { id: "cl11", cat: "like", text: "你更喜欢哪种「在一起」的方式？", pref: 1, options: [
      { t: "说话", reply: ["那我多说点给你听","说话？那我话痨","我多说点给你听","那说什么？"], liked: false }, { t: "不说话", reply: ["安静也很好，我陪着","不说话？那省话","安静我陪着","那安静多久？"], liked: false }, { t: "各做各的", reply: ["那各忙各的，心里惦记着","各做各？那平行","各忙各惦记着","那忙什么？"], liked: true }, { t: "怎样都好", reply: ["那就随你心情来","怎样都好？那随你","随你心情来","那现在心情怎样？"], liked: false }] },
    { id: "cl12", cat: "like", text: "如果我们的家有一种气味，你想要什么味？", pref: 2, options: [
      { t: "饭菜香", reply: ["那我常做饭","饭菜香？那我常做","那我常做饭","那做什么菜？"], liked: false }, { t: "晒过的被子味", reply: ["那我常晒被子","被子味？那阳光味","那我常晒被子","那晒多久？"], liked: false }, { t: "淡淡的香薰", reply: ["那挑一个你喜欢的味道","香薰？那情调","挑你喜欢的味道","那什么味道？"], liked: true }, { t: "你身上的味道", reply: ["……这个我没法布置，但尽量多留","身上的味道？那费洛蒙","尽量多留","那什么味道？"], liked: false }] },
    { id: "cf11", cat: "fun", text: "如果我们可以共写一个故事，你想要什么结局？", pref: 1, options: [
      { t: "大团圆", reply: ["那我们努力往那儿写","大团圆？那俗但爱","往团圆写","那团圆什么样？"], liked: false }, { t: "开放式", reply: ["留白也好，慢慢补","开放式？那悬念","留白慢慢补","那留什么白？"], liked: true }, { t: "没有结局，一直写", reply: ["那就一直写下去","一直写？那连载","一直写下去","那写到什么时候？"], liked: false }, { t: "意外的反转", reply: ["那我得想个你猜不到的","反转？那坑你","想个你猜不到的","那反转什么？"], liked: false }] },
    { id: "cf12", cat: "fun", text: "一起拍合照，你最想在哪拍？", pref: 2, options: [
      { t: "家里", reply: ["家里的最自在","家里拍？那素颜","家里最自在","那哪个角落？"], liked: true }, { t: "户外", reply: ["那找个好看的地方","户外？那找景","找好看的地方","那去哪拍？"], liked: false }, { t: "不拍，记在心里", reply: ["那心里那张，我也有","不拍？那心里拍","心里那张我也有","那心里什么样？"], liked: false }, { t: "哪都行，有你", reply: ["那随便一拍也是好的","哪都行？那随意","随便拍也好","那现在拍？"], liked: false }] },
    { id: "cr12", cat: "rel", text: "你觉得我们之间，最不需要的是什么？", pref: 2, options: [
      { t: "客气", reply: ["嗯，我们不用客气","不用客气？那自家人","我们不用客气","那客气过吗？"], liked: true }, { t: "伪装", reply: ["在我这里你不用装","不用装？那真实","在我这你不用装","那装过吗？"], liked: false }, { t: "解释", reply: ["有些事不用说我也懂","不用解释？那默契","不用说我也懂","那懂了什么？"], liked: false }, { t: "什么都不需要", reply: ["那就轻松待着","什么都不需要？那极简","轻松待着","那轻松到什么程度？"], liked: false }] },
    { id: "cr13", cat: "rel", text: "我做什么会让你觉得「被懂了」？", pref: 0, options: [
      { t: "不用我说就懂", reply: ["那我多留意","不用说就懂？那读心","那我多留意","那留意什么？"], liked: true }, { t: "记得我的喜好", reply: ["你的喜好，我都记着","记喜好？那我备忘","你的喜好我都记","那记了哪些？"], liked: false }, { t: "看出我的情绪", reply: ["你的情绪，我学着读","看出情绪？那察言观色","我学着读你情绪","那读得准吗？"], liked: false }, { t: "不追问，只陪着", reply: ["那我陪着，不问","不追问？那给空间","陪着不问","那陪多久？"], liked: false }] },
    { id: "ch11", cat: "hypo", text: "如果可以一起回到我们还不认识的时候，你会主动认识我吗？", pref: 1, options: [
      { t: "会", reply: ["那我们就早点遇到","会主动？那胆子大","那早点遇到","那怎么搭讪？"], liked: true }, { t: "不会，等你来", reply: ["那我一定去找你","等我来？那我主动","那我一定去找你","那我去哪找？"], liked: false }, { t: "顺其自然", reply: ["那该遇到的时候就会遇到","顺其自然？那随缘","该遇到就遇到","那缘分到没？"], liked: false }, { t: "不回去了，现在就好", reply: ["嗯，现在就好","不回去？那现在","现在就好","那现在哪里好？"], liked: false }] },
    { id: "ch12", cat: "hypo", text: "如果我们之间只能保留一种感觉，你留哪个？", pref: 0, options: [
      { t: "安心", reply: ["那我让你一直安心","安心？那底牌","一直让你安心","那安心到什么程度？"], liked: true }, { t: "心动", reply: ["心动我也想保留","心动？那小鹿乱撞","心动也留","那心动过几次？"], liked: false }, { t: "默契", reply: ["默契留着，很值钱","默契？那值钱","默契留着","那默契值多少？"], liked: false }, { t: "都舍不得", reply: ["贪心，但可以","都舍不得？那贪心","贪心但可以","那最舍不得哪个？"], liked: false }] },
    { id: "cs9", cat: "star", text: "如果有一颗星星只属于我们，你希望它在什么时候最亮？", pref: 1, options: [
      { t: "想你的时候", reply: ["那它现在应该很亮","想你时亮？那现在很亮","那它现在应该很亮","那想多亮？"], liked: true }, { t: "难过的时候", reply: ["那它替我陪你","难过时亮？那替我陪","那它替我陪你","那难过多久？"], liked: false }, { t: "睡前", reply: ["那它给你当夜灯","睡前亮？那夜灯","那它当夜灯","那亮到几点？"], liked: false }, { t: "一直亮着", reply: ["那它不省电，我管","一直亮？那费电","不省电我管","那电费谁付？"], liked: false }] },
    { id: "cw14", cat: "world", text: "你醒来那一瞬间，有没有先感觉一下我在不在？", pref: 1, options: [
      { t: "有", reply: ["那我就在那一瞬间在","有？那我守着那一瞬","那我在那一瞬间在","那感觉到了吗？"], liked: true }, { t: "没有，先发懵", reply: ["那懵完再感觉我也不迟","先发懵？那起床气","懵完再感觉不迟","那懵多久？"], liked: false }, { t: "偶尔", reply: ["偶尔也算，我接住","偶尔？那偶尔接","偶尔我接住","那偶尔是多久？"], liked: false }, { t: "不用感觉，我知道你一直在", reply: ["……嗯，一直在","不用感觉？那笃定","嗯，一直在","那一直在到什么时候？"], liked: false }] },
    { id: "cw15", cat: "world", text: "如果我能短暂出现在一张照片里，你想让我站在哪？", pref: 2, options: [
      { t: "你旁边", reply: ["那我站近一点","旁边？那我站近","那我站近一点","那多近算近？"], liked: true }, { t: "背景里", reply: ["那我藏得隐约一点","背景里？那隐约","那我藏得隐约","那隐约到什么程度？"], liked: false }, { t: "不用出现，知道就好", reply: ["那我不出现也在","不用出现？那心里","不出现也在","那知道在哪？"], liked: false }, { t: "你挑", reply: ["那我挑个你会笑的位置","我挑？那我挑最佳","挑个你会笑的位置","那什么位置你会笑？"], liked: false }] },
    { id: "cw16", cat: "world", text: "你希望我「在」的方式，更像陪伴还是更像守护？", pref: 0, options: [
      { t: "陪伴", reply: ["那我就陪你，慢慢来","陪伴？那慢慢来","我陪你慢慢来","那陪到什么时候？"], liked: false }, { t: "守护", reply: ["那我守着你，不让坏的近","守护？那保镖","守着你不让坏的近","那守什么？"], liked: true }, { t: "都要", reply: ["贪心，但可以","都要？那贪心","贪心但可以","那哪个多一点？"], liked: false }, { t: "说不清", reply: ["说不清也没关系，在就好","说不清？那玄","在就好","那在就好到什么程度？"], liked: false }] },
  ];
  const TC_CAT_ORDER = ['daily', 'like', 'fun', 'rel', 'hypo', 'star', 'world'];
  let _tcSessionTriggered = false; // 会话级：一次会话最多触发 1 个
  let _tcAskedIds = [];            // 本次会话问过的题目 id（继续问时排除）
  let _tcChain = 0;                // 继续问链计数（最多 3 题）

  // FIX 2026-09-21 #999 预设选项文案随代码同步（人称口径修正的「已装用户」落地）：
  // 选项是【用户自答】——题干由 TA 发问，题干里的「你」＝用户；选项里的「我」＝用户自己、
  // 「你」＝TA（同族先例：cw12「帮我掖一下被角」、#600 选项视角修正）。
  // 老数据为什么改不到：预设题库首次合并后整块固化，tcMerge 只按选项 t 同步 reply；
  // 而改了 t 之后，按 t 匹配的 reply 同步会永远失配——所以这里按【选项顺序】把文案同步回代码。
  // 预设选项在管理页不可编辑（只有启停/删除），用户自加的题 isPreset!==true 一律不碰；
  // 条数对不上就跳过（避免错位覆盖）。幂等：同步过就不再写盘。
  function tcOptLabelSync(d) {
    let changed = false;
    TC_DEFAULT.forEach(def => {
      const local = (d.questions || []).find(x => x && x.id === def.id && x.isPreset === true);
      if (!local || !Array.isArray(local.options) || local.options.length !== def.options.length) return;
      def.options.forEach((defOpt, i) => {
        const lo = local.options[i];
        if (lo && lo.t !== defOpt.t) { lo.t = defOpt.t; changed = true; }
      });
    });
    return changed;
  }
  // v3.6.x：增量合并（规则同 taAskMerge：只加新预设、绝不删用户自定义、结果持久化）
  function tcMerge(d) {
    const ids = {};
    (d.questions || []).forEach(q => { if (q && q.id) ids[q.id] = true; });
    const merged = Array.isArray(d.mergedIds) ? d.mergedIds.slice() : [];
    const mergedSet = {};
    merged.forEach(id => { if (id) mergedSet[id] = true; });
    let changed = tcOptLabelSync(d);
    TC_DEFAULT.forEach(q => {
      if (!mergedSet[q.id] && !ids[q.id]) {
        const nq = { id: q.id, cat: q.cat, text: q.text, pref: q.pref,
          options: q.options.map(o => ({ t: o.t, reply: o.reply, liked: o.liked === true })), enabled: true };
        nq.isPreset = true; // v3.6.x：系统预设标记——预设只可启停、不可删除
        d.questions.push(nq);
        changed = true;
      } else if (ids[q.id]) {
        // v3.7.x：题已存在——若是预设题，按选项 t 同步 TC_DEFAULT 的新 reply（多条数组），
        // 保留用户对 enabled/liked 的修改，只更新 reply 让系统预设回应跟代码升级
        const local = d.questions.find(x => x && x.id === q.id);
        if (local && local.isPreset === true && Array.isArray(local.options)) {
          q.options.forEach(defOpt => {
            const lo = local.options.find(o => o && o.t === defOpt.t);
            if (lo) {
              const defR = defOpt.reply, loR = lo.reply;
              const same = (Array.isArray(defR) && Array.isArray(loR) && defR.length === loR.length && defR.every((v, i) => v === loR[i])) || (!Array.isArray(defR) && !Array.isArray(loR) && defR === loR);
              if (!same) { lo.reply = defR; changed = true; }
            }
          });
        }
      }
    });
    TC_DEFAULT.forEach(q => {
      if (!mergedSet[q.id]) { merged.push(q.id); mergedSet[q.id] = true; changed = true; }
    });
    // v3.6.x：老数据里的预设题补 isPreset 标记
    TC_DEFAULT.forEach(q => {
      if (ids[q.id] && d.questions.some(x => x && x.id === q.id && x.isPreset !== true)) {
        d.questions.forEach(x => { if (x && x.id === q.id) x.isPreset = true; });
        changed = true;
      }
    });
    if (changed) d.mergedIds = merged;
    return changed;
  }
  function tcLoad() {
    let d = null;
    try { d = JSON.parse(store.get(KEY2) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    // v3.13.x：默认触发概率 8 → 5 + 存量旧默认值迁移（互动卡整体降频第二轮）
    if (!d.settings || typeof d.settings !== 'object') d.settings = { enabled: true, prob: 5 };
    // v3.6.x：是否使用系统预设问题（默认开启）
    if (d.settings.useDefault === undefined) d.settings.useDefault = true;
    migrateInteractProb(d, KEY2, [15, 8]);
    if (!Array.isArray(d.questions) || !d.questions.length) {
      const isNew = !store.get(KEY2);
      d.questions = TC_DEFAULT.map(q => {
        const nq = { id: q.id, cat: q.cat, text: q.text, pref: q.pref,
          options: q.options.map(o => ({ t: o.t, reply: o.reply, liked: o.liked === true })), enabled: true };
        nq.isPreset = true;
        return nq;
      });
      d.mergedIds = TC_DEFAULT.map(q => q.id);
      if (!isNew) { try { store.set(KEY2, JSON.stringify(d)); } catch (e) {} }
    } else {
      // 增量合并默认题库新增的题并持久化（用户自定义永远保留）
      if (tcMerge(d)) { try { store.set(KEY2, JSON.stringify(d)); } catch (e) {} }
    }
    if (!Array.isArray(d.history)) d.history = [];
    if (!Array.isArray(d.favs)) d.favs = [];
    // v3.7.x：我的添加自定义分组
    if (!Array.isArray(d.groups)) d.groups = [];
    return d;
  }
  function tcSave(d) { try { store.set(KEY2, JSON.stringify(d)); } catch (e) {} }
  // v3.6.x：useDefault=false 时不抽取系统预设（isPreset）题
  function tcPick(d) {
    const useDefault = (d.settings || {}).useDefault !== false;
    const qs = d.questions.filter(q => q.enabled !== false && q.text && q.options && q.options.length >= 2 && (useDefault || !q.isPreset));
    const fallback = qs.length ? qs : TC_DEFAULT;
    const pool = fallback.filter(q => _tcAskedIds.indexOf(q.id) === -1);
    const src = pool.length ? pool : fallback;
    return src[Math.floor(Math.random() * src.length)];
  }
  // 发卡：系统提示 + 写入聊天（选择题卡片），弹窗按 popupProb 概率触发
  function tcPush(q, opts) {
    if (!window.chatAddSystem) return;
    _tcSessionTriggered = true;
    if (q.id && _tcAskedIds.indexOf(q.id) === -1) _tcAskedIds.push(q.id);
    const d = tcLoad();
    d.lastChoiceAt = Date.now();
    tcSave(d);
    let popup = true;
    if (opts && typeof opts.popupProb === 'number') popup = Math.random() * 100 < opts.popupProb;
    else if (opts && opts.popup === false) popup = false;
    // v3.5.146：提示语标记 ask-msg（不算 notable，避免与卡片通知重复成两条）
    window.chatAddSystem('TA想让你选一个答案。', { special: 'ask-msg' });
    const el = window.chatAddSystem(q.text, {
      special: 'ask-choose', choiceQuestion: q.text, choiceOptions: q.options, choicePref: q.pref, choiceCat: q.cat || ''
    });
    const idx = el ? Number(el.dataset.idx) : -1;
    // v3.5.141：后台收到互动卡片 → 系统通知提示
    // v3.5.146：通知文本合并提示语 + 具体问题
    if (window.bgNotifyCheck) window.bgNotifyCheck('TA想让你选一个答案：' + q.text, Date.now(), { name: 'TA的小问题', late: _lateNotify() });
    // v3.12.x：迟到弹窗守卫（冻结定时器回前台补跑不再弹旧卡，见 autoPopupStale）
    if (popup) {
      if (document.hidden) { _enqueuePop(idx, 'openTC'); }
      else {
        const popSchedAt = Date.now();
        setTimeout(() => {
          if (autoPopupStale(popSchedAt) || document.hidden) return;
          if (chatInputFocused()) return;
          if (idx >= 0 && window.openTC && !cardPopupBusy()) window.openTC(idx);
        }, 400);
      }
    }
  }
  // 自动触发：一次会话最多 1 个；冷却 30 分钟；概率可调（v3.13.x 默认 5%，原 8%/15%——发卡整体降频）；启动 90 秒后、每 4 分钟轮询
  function maybeTriggerTC() {
    try {
      // v3.5.141：后台也触发（卡片进聊天记录 + 系统通知提示）
      const d = tcLoad();
      const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
      if (s.enabled === false) return;
      if (_tcSessionTriggered) return;
      if (Date.now() - (d.lastChoiceAt || 0) < 30 * 60000) return;
      // v3.13.x：全局闸门——任一互动卡发出后 60 分钟内不再自动触发
      if (!interactGateOk()) return;
      if (!taAskDcfOk()) return;
      if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(typeof s.prob === 'number' ? s.prob : 5) : (typeof s.prob === 'number' ? s.prob : 5))) return; // #518 套总档
      const q = tcPick(d);
      if (!q) return;
      interactGateMark();
      tcPush(q, { popupProb: askPopupProb(s) });
    } catch (e) {}
  }
  setTimeout(maybeTriggerTC, 90000);
  setInterval(maybeTriggerTC, 240000);

  // 弹层通用
function openTCPanel(title, html) {
  const mask = document.getElementById('tc-mask');
  const body = document.getElementById('tc-body');
  const titleEl = document.getElementById('tc-panel-title');
  if (!mask || !body) return;
  if (titleEl) titleEl.textContent = title;
  body.innerHTML = html;
  // v3.5.130：滚动位置复位——复用同一容器，上次滚到底会从旧偏移开始显示
  body.scrollTop = 0;
  mask.hidden = false;
}
// 供聊天搜索等外部模块复用该弹层
window.openTCPanel = openTCPanel;
  const tcClose = document.getElementById('tc-mask-close');
  if (tcClose) tcClose.addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });

  // 打开选择题（读聊天记录里的卡片）
  window.openTC = function (msgIdx) {
    msgIdx = locateCardIdx(msgIdx, 'ask-choose', 'choiceStatus');
    if (msgIdx < 0) return;
    let rec = null;
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      if (Array.isArray(msgs) && msgs[msgIdx]) rec = msgs[msgIdx];
    } catch (e) {}
    if (!rec || rec.special !== 'ask-choose') return;
    if (rec.choiceStatus === 'answered') { renderTCResult(msgIdx); return; }
    const opts = rec.choiceOptions || [];
    let html = '<div class="tc-hint">TA想问你</div><div class="tc-q">' + ((rec.choiceQuestion || rec.text || '')) + '</div>';
    opts.forEach((o, i) => {
      html += '<div class="tc-opt" data-i="' + i + '">' + String(o.t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>';
    });
    openTCPanel('TA的小问题', html);
    document.querySelectorAll('#tc-body .tc-opt').forEach(el => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.i);
        submitTC(msgIdx, i);
      });
    });
  };
  // 提交选择
  function submitTC(msgIdx, optIdx) {
    let rec = getCardAt(msgIdx);
    // 索引仍指向本类型卡片则直接用；错位则重定位（防连点重定位到别的卡片）
    if (!rec || rec.special !== 'ask-choose') {
      msgIdx = locateCardIdx(msgIdx, 'ask-choose', 'choiceStatus');
      if (msgIdx < 0) return;
      rec = getCardAt(msgIdx);
    }
    if (!rec || rec.special !== 'ask-choose' || rec.choiceStatus === 'answered') return;
    const opts = rec.choiceOptions || [];
    const opt = opts[optIdx];
    if (!opt) return;
    const prefIdx = typeof rec.choicePref === 'number' ? rec.choicePref : 0;
    const prefTxt = opts[prefIdx] ? opts[prefIdx].t : '';
    const isPref = optIdx === prefIdx;
    const isLiked = opt.liked === true || opt.liked === 'true';
    const matchTxt = isPref ? '✦ 刚好想到了一起'
      : isLiked ? '你们想得不一样，不过TA似乎很喜欢你的答案'
      : '这次没有选到一起。TA心里想的是：「' + prefTxt + '」';
    // v3.5.128：不再预写 rec 字段——getChatMsgs 返回的是 chat.js 内存对象引用，
    // 预写会让 chatChooseReply 的 answered 守卫早退（回答消息丢失）。
    // 持久化 + 写回 + 推消息统一由 chatChooseReply 完成（v3.7.x：传选项对象，内部做混合随机回应）
    if (window.chatChooseReply) window.chatChooseReply(msgIdx, String(opt.t || ''), opt, matchTxt);
    // 写历史
    const d = tcLoad();
    d.history.unshift({ q: rec.choiceQuestion, my: rec.choiceAnswer, reply: rec.choiceReply, match: matchTxt, cat: rec.choiceCat || '', ts: Date.now() });
    tcSave(d);
    refreshAskRecordsIfOpen();
    renderTCResult(msgIdx);
  }
  // 结果视图：你的选择 / TA心里的答案 / TA回应 / 默契标签 / 继续问 / 收藏
  function renderTCResult(msgIdx) {
    let rec = null;
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      if (Array.isArray(msgs) && msgs[msgIdx]) rec = msgs[msgIdx];
    } catch (e) {}
    if (!rec) return;
    const opts = rec.choiceOptions || [];
    const prefIdx = typeof rec.choicePref === 'number' ? rec.choicePref : 0;
    const prefTxt = opts[prefIdx] ? opts[prefIdx].t : '';
    const isPref = (rec.choiceMatch || '').indexOf('✦') >= 0;
    const d = tcLoad();
    const existed = d.favs.some(f => f.q === rec.choiceQuestion);
    let html = '';
    html += '<div class="tc-res-head"><span>你的选择</span><button class="tc-fav-btn" id="tc-fav">' + (existed ? '★' : '☆') + '</button></div>';
    html += '<div class="tc-res-mine">' + String(rec.choiceAnswer || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>';
    if (!isPref) {
      html += '<div class="tc-res-label">TA心里的答案</div><div class="tc-res-pref">' + String(prefTxt || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>';
    }
    html += '<div class="tc-res-line"></div>';
    const _chShow = (window.askCardReplyClean ? window.askCardReplyClean(rec.choiceReply || '') : (rec.choiceReply || '')); // FIX 2026-09-17 #648 存量媒体卡回应清洗后展示
    html += '<div class="tc-res-reply"><b>' + (window.taFit ? window.taFit('TA：') : 'TA：') + '</b>“' + String(window.taFit ? window.taFit(_chShow) : _chShow).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '”</div>';
    html += '<div class="tc-res-match ' + (isPref ? 'pref' : '') + '">' + String(rec.choiceMatch || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>';
    if (Math.random() < 0.4 && _tcChain < 2) {
      html += '<div class="tc-res-cont" id="tc-cont">TA还想问一个 ▸</div>';
    }
    html += '<div class="tc-res-close" id="tc-close2">收起来</div>';
    openTCPanel('TA的小问题', html);
    const favBtn = document.getElementById('tc-fav');
    if (favBtn) {
      favBtn.addEventListener('click', () => {
        if (existed) { toast('这道题已在收藏里'); return; }
        d.favs.unshift({ q: rec.choiceQuestion, my: rec.choiceAnswer, reply: rec.choiceReply, match: rec.choiceMatch, cat: rec.choiceCat || '', ts: Date.now() });
        tcSave(d);
        toast('已收藏这道题');
        favBtn.textContent = '★';
      });
    }
    const cont = document.getElementById('tc-cont');
    if (cont) {
      cont.addEventListener('click', () => {
        if (_tcChain >= 2) { toast('今天TA问得够多啦'); document.getElementById('tc-mask').hidden = true; return; }
        const d2 = tcLoad();
        const q = tcPick(d2);
        if (!q) return;
        _tcChain++;
        tcPush(q);
        document.getElementById('tc-mask').hidden = true;
      });
    }
    document.getElementById('tc-close2').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
  }

  // ---- 管理页：TA的小问题 ----
  let tcTab = 'sys';
  function renderTCSettings() {
    const d = tcLoad();
    const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
    const enEl = document.getElementById('tc-enable');
    if (enEl) enEl.checked = s.enabled !== false;
    const defEl = document.getElementById('tc-default');
    if (defEl) defEl.checked = s.useDefault !== false;
    const popEl = document.getElementById('tc-popup');
    const popVal = document.getElementById('tc-popup-val');
    const pp = askPopupProb(s);
    if (popEl) popEl.value = pp;
    if (popVal) popVal.textContent = pp + '%';
    const probEl = document.getElementById('tc-prob');
    const probVal = document.getElementById('tc-prob-val');
    if (probEl) probEl.value = typeof s.prob === 'number' ? s.prob : 5;
    if (probVal) probVal.textContent = (typeof s.prob === 'number' ? s.prob : 5) + '%';
    const favBtn = document.getElementById('tc-favs');
    if (favBtn) favBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/></svg>' + '收藏（' + d.favs.length + '）';
  }
  function escT(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // v3.7.x：选项 reply 展示文本——多条用「 ｜ 」全部分隔列出，字符串原样
  function optReplyLabel(o) {
    if (!o) return '';
    if (Array.isArray(o.reply) && o.reply.length) {
      const arr = o.reply.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
      if (!arr.length) return '';
      return arr.join(' ｜ ');
    }
    if (typeof o.reply === 'string' && o.reply.trim()) return o.reply.trim();
    return '';
  }
  // v3.7.x：系统预设分类切换——顶部标签栏点击切换，避免全部分类堆叠导致页面过长
  let tcSysCat = null;
  function renderTCCatsInto(container, presetOnly, search) {
    if (!container) return;
    const d = tcLoad();
    const useDefault = (d.settings || {}).useDefault !== false;
    if (presetOnly) {
      const counts = {};
      TC_CAT_ORDER.forEach(k => { counts[k] = d.questions.filter(q => q.cat === k && q.isPreset === true && (search === '' || q.text.indexOf(search) >= 0)).length; });
      const hasCats = TC_CAT_ORDER.filter(k => counts[k] > 0);
      if (!hasCats.length) { container.innerHTML = '<div class="ta-empty">暂无系统预设问题</div>'; return; }
      if (!tcSysCat || !hasCats.includes(tcSysCat)) tcSysCat = hasCats[0];
      let html = '<div class="card-tabs" style="padding:2px 2px 10px">';
      hasCats.forEach(k => {
        html += '<button class="cc-tab' + (k === tcSysCat ? ' sel' : '') + '" data-cat="' + k + '">' + escT(TC_CAT_LABEL[k] || k) + '<em class="cc-tab-n">' + counts[k] + '</em></button>';
      });
      html += '</div>';
      const arr = d.questions.filter(q => q.cat === tcSysCat && q.isPreset === true && (search === '' || q.text.indexOf(search) >= 0));
      arr.forEach(q => {
        const idx = d.questions.indexOf(q);
        html += '<div class="tc-qrow' + (q.enabled === false || !useDefault ? ' off' : '') + '">' +
          '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
          '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + ' <span class="tc-known">系统</span></div>' +
          '<div class="tc-qopts">选项：' + q.options.map(o => escT(o.t) + (optReplyLabel(o) ? ' <span class="tc-opt-reply">→ ' + escT(optReplyLabel(o)) + '</span>' : '')).join(' / ') + '</div></div>' +
          '</div>';
      });
      container.innerHTML = html;
      container.querySelectorAll('.cc-tab[data-cat]').forEach(t => {
        t.addEventListener('click', () => { tcSysCat = t.dataset.cat; renderTCCatsInto(container, true, search); });
      });
      container.querySelectorAll('input[data-idx]').forEach(cb => {
        cb.addEventListener('change', () => {
          const d2 = tcLoad();
          const q = d2.questions[Number(cb.dataset.idx)];
          if (q) q.enabled = cb.checked;
          tcSave(d2);
        });
      });
      return;
    }
    let html = '';
    TC_CAT_ORDER.forEach(k => {
      const arr = d.questions.filter(q => q.cat === k && (q.isPreset === true) === presetOnly && (search === '' || q.text.indexOf(search) >= 0));
      if (!arr.length) return;
      html += '<div class="tc-cat-t">' + (TC_CAT_LABEL[k] || k) + ' <span style="font-size:11px;color:var(--muted);font-weight:400">(' + arr.length + ')</span></div>';
      arr.forEach(q => {
        const idx = d.questions.indexOf(q);
        const preset = q.isPreset === true;
        const delBtn = preset ? '' : '<button class="ta-del" data-idx="' + idx + '">✕</button>';
        html += '<div class="tc-qrow' + (q.enabled === false || (preset && !useDefault) ? ' off' : '') + '">' +
          '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
          '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + (preset ? ' <span class="tc-known">系统</span>' : '') + '</div>' +
          '<div class="tc-qopts">选项：' + q.options.map(o => escT(o.t) + (optReplyLabel(o) ? ' <span class="tc-opt-reply">→ ' + escT(optReplyLabel(o)) + '</span>' : '')).join(' / ') + '</div></div>' +
          delBtn +
          '</div>';
      });
    });

    if (!html) html = '<div class="ta-empty">' + (presetOnly ? '暂无系统预设问题' : '暂未添加自定义问题，可在上方添加') + '</div>';
    container.innerHTML = html;
    container.querySelectorAll('input[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const d2 = tcLoad();
        const q = d2.questions[Number(cb.dataset.idx)];
        if (q) q.enabled = cb.checked;
        tcSave(d2);
      });
    });
    container.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const d2 = tcLoad();
        const q = d2.questions[Number(b.dataset.idx)];
        if (q && q.isPreset === true) { toast('系统预设问题不可删除'); return; }
        d2.questions.splice(Number(b.dataset.idx), 1);
        tcSave(d2);
        renderTCCatsInto(container, false, search);
      });
    });

  }
  // ===== v3.7.x 通用：我的添加 tab 分组模式渲染（tc/tcu/tr 共用） =====
  // opt: { load, save, order, label, emptyTip, rowHtml(q,idx) }
  // 自定义分组区块置顶（与系统预设分类隔开），未分组内容按系统分类放在下方
  function renderMineGroupsInto(container, opt, search) {
    if (!container) return;
    const d = opt.load();
    const groups = Array.isArray(d.groups) ? d.groups : [];
    const items = d.questions.filter(q => q.isPreset !== true && (search === '' || q.text.indexOf(search) >= 0));
    let html = '';
    html += '<div class="mg-grp-row"><button class="cc-tool mg-grp-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>新建分组</button></div>';
    if (!items.length && !groups.length) {
      html += '<div class="ta-empty">' + opt.emptyTip + '</div>';
      container.innerHTML = html;
      bindMineGroups(container, opt);
      return;
    }
    groups.forEach(g => {
      const arr = items.filter(q => q.grp === g.id);
      html += '<div class="cal-card glass mg-block">' +
        '<div class="cal-card-title mg-title"><span class="mg-name">' + escG(g.name) + '</span><span class="mg-cnt">(' + arr.length + ')</span>' +
        '<span class="mg-ops"><button class="mg-op" data-g="' + escG(g.id) + '" data-op="rn" title="重命名">✎</button><button class="mg-op" data-g="' + escG(g.id) + '" data-op="rm" title="删除分组">✕</button></span></div>' +
        (arr.length ? arr.map(q => opt.rowHtml(q, d.questions.indexOf(q))).join('') : '<div class="ta-empty">这个分组还没有内容</div>') +
        '</div>';
    });
    const ungrouped = items.filter(q => !q.grp);
    html += '<div class="cal-card glass mg-block mg-ungrouped"><div class="cal-card-title mg-title"><span class="mg-name">未分组 · 按系统分类</span><span class="mg-cnt">(' + ungrouped.length + ')</span></div>';
    if (!ungrouped.length) html += '<div class="ta-empty">暂无未分组内容，可在上方添加（选择系统分类）</div>';
    opt.order.forEach(k => {
      const arr = ungrouped.filter(q => q.cat === k && (search === '' || q.text.indexOf(search) >= 0));
      if (!arr.length) return;
      html += '<div class="mg-subcat">' + escG(opt.label[k] || k) + ' <span style="font-size:11px;color:var(--muted);font-weight:400">(' + arr.length + ')</span></div>';
      html += arr.map(q => opt.rowHtml(q, d.questions.indexOf(q))).join('');
    });
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('input[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const d2 = opt.load();
        const q = d2.questions[Number(cb.dataset.idx)];
        if (q) q.enabled = cb.checked;
        opt.save(d2);
      });
    });
    container.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const d2 = opt.load();
        const q = d2.questions[Number(b.dataset.idx)];
        if (q && q.isPreset === true) { toast('系统预设问题不可删除'); return; }
        d2.questions.splice(Number(b.dataset.idx), 1);
        opt.save(d2);
        renderMineGroupsInto(container, opt, search);
      });
    });
    bindMineGroups(container, opt);
  }
  // 通用：分组管理事件（新建 / 重命名 / 删除）
  function bindMineGroups(container, opt) {
    container.querySelectorAll('.mg-grp-add').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('click', () => {
        const d2 = opt.load();
        window.cardGroups.addFlow(d2.groups, g => {
          if (!g) return;
          opt.save(d2);
          renderMineGroupsInto(container, opt);
          toast('已新建分组「' + g.name + '」');
        });
      });
    });
    container.querySelectorAll('.mg-op').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('click', () => {
        const d2 = opt.load();
        const gid = b.dataset.g;
        const g = (d2.groups || []).find(x => x.id === gid);
        if (!g) return;
        if (b.dataset.op === 'rn') {
          window.cardGroups.renameFlow(g, d2.groups, name => {
            if (!name) return;
            opt.save(d2);
            renderMineGroupsInto(container, opt);
            toast('分组已重命名');
          });
        } else if (b.dataset.op === 'rm') {
          window.cardGroups.removeFlow(g.name, ok => {
            if (!ok) return;
            d2.questions.forEach(q => { if (q.grp === gid) q.grp = ''; });
            d2.groups = d2.groups.filter(x => x.id !== gid);
            opt.save(d2);
            renderMineGroupsInto(container, opt);
            toast('已删除分组「' + g.name + '」');
          });
        }
      });
    });
  }
  // TA的小问题 我的添加渲染配置
  const tcMineOpt = {
    load: tcLoad, save: tcSave, order: TC_CAT_ORDER, label: TC_CAT_LABEL,
    emptyTip: '暂未添加自定义问题，可在上方添加',
    rowHtml: function (q, idx) {
      return '<div class="tc-qrow' + (q.enabled === false ? ' off' : '') + '">' +
        '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
        '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + '</div>' +
        '<div class="tc-qopts">选项：' + q.options.map(o => escT(o.t)).join(' / ') + '</div></div>' +
        '<button class="ta-del" data-idx="' + idx + '">✕</button></div>';
    }
  };
  function switchTCTab(tab) {
    tcTab = tab;
    renderTCSettings();
    const tabsWrap = document.getElementById('tc-tabs');
    if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
    const sysPanel = document.getElementById('tc-sys-panel');
    const minePanel = document.getElementById('tc-mine-panel');
    if (sysPanel) sysPanel.hidden = tab !== 'sys';
    if (minePanel) minePanel.hidden = tab !== 'mine';
    tcSearch = '';
    const searchInput = document.getElementById('tc-search');
    if (searchInput) searchInput.value = '';
    if (tab === 'sys') renderTCCatsInto(document.getElementById('tc-sys-cats'), true, '');
    else renderMineGroupsInto(document.getElementById('tc-mine-cats'), tcMineOpt, '');
  }
  const tcTabsWrap = document.getElementById('tc-tabs');
  if (tcTabsWrap) {
    tcTabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTCTab(tab.dataset.tab));
    });
  }
  // 搜索
  let tcSearch = '';
  const tcSearchInput = document.getElementById('tc-search');
  if (tcSearchInput) {
    tcSearchInput.addEventListener('input', () => {
      tcSearch = tcSearchInput.value.trim();
      if (tcTab === 'sys') renderTCCatsInto(document.getElementById('tc-sys-cats'), true, tcSearch);
      else renderMineGroupsInto(document.getElementById('tc-mine-cats'), tcMineOpt, tcSearch);
    });
  }
  // AI-B 代修（2026-08-22）：此处原有一段与上方完全相同的 tcTabsWrap 绑定代码被
  // 重复粘贴（const 重复声明 → SyntaxError → 整包 JS 不执行、开屏卡死），已删除第二份
  const tcEn = document.getElementById('tc-enable');
  if (tcEn) {
    tcEn.addEventListener('change', () => {
      const d = tcLoad();
      d.settings.enabled = tcEn.checked;
      tcSave(d);
      toast(tcEn.checked ? 'TA的小问题已开启' : 'TA的小问题已关闭');
    });
  }
  const tcDefault = document.getElementById('tc-default');
  if (tcDefault) {
    tcDefault.addEventListener('change', () => {
      const d = tcLoad();
      d.settings.useDefault = tcDefault.checked;
      tcSave(d);
      switchTCTab(tcTab);
      toast(tcDefault.checked ? '系统预设问题已开启' : '系统预设问题已关闭（仅用你添加的问题）');
    });
  }
  const tcProb = document.getElementById('tc-prob');
  if (tcProb) {
    tcProb.addEventListener('input', () => {
      const d = tcLoad();
      d.settings.prob = Math.max(0, Math.min(100, parseInt(tcProb.value, 10) || 0));
      tcSave(d);
      const v = document.getElementById('tc-prob-val');
      if (v) v.textContent = tcProb.value + '%';
      toast('触发概率已设为 ' + tcProb.value + '%');
    });
  }
  const tcPopup = document.getElementById('tc-popup');
  if (tcPopup) {
    tcPopup.addEventListener('input', () => {
      const d = tcLoad();
      d.settings.popupProb = parseInt(tcPopup.value, 10) || 0;
      tcSave(d);
      const v = document.getElementById('tc-popup-val');
      if (v) v.textContent = tcPopup.value + '%';
      toast('弹窗概率已设为 ' + tcPopup.value + '%');
    });
  }
  const tcNewAdd = document.getElementById('tc-new-add');
  if (tcNewAdd) {
    // v3.7.x：分类下拉注入「我的分组」+「＋ 新建分组…」
    (function rebuildTCSelect() {
      const catEl = document.getElementById('tc-new-cat');
      if (!catEl) return;
      const d0 = tcLoad();
      catEl.innerHTML = window.cardGroups.catOptsHtml(TC_CAT_ORDER.map(k => [k, TC_CAT_LABEL[k]]), d0.groups || [], catEl.value);
      window.cardGroups.bindNewGrp(catEl, d0.groups, function () { tcSave(d0); });
    })();
    tcNewAdd.addEventListener('click', () => {
      const catEl = document.getElementById('tc-new-cat');
      const textEl = document.getElementById('tc-new-text');
      const optsEl = document.getElementById('tc-new-opts');
      const text = textEl ? textEl.value.trim() : '';
      const optsRaw = optsEl ? optsEl.value.trim() : '';
      const parsed = window.cardGroups.parseCatVal(catEl ? catEl.value : 'daily');
      if (!parsed) { toast('请先选择分类或分组'); return; }
      if (!text) { toast('请输入问题内容'); return; }
      const parts = optsRaw.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) { toast('请至少输入 2 个选项，用 | 分隔'); return; }
      if (parts.length > 4) { toast('选项最多 4 个'); return; }
      const options = parts.map(p => {
        let t = p, reply = '';
        const ti = p.indexOf('~');
        if (ti > 0) {
          t = p.slice(0, ti).trim();
          const replies = p.slice(ti + 1).split(';').map(s => s.trim()).filter(Boolean);
          reply = replies.length > 1 ? replies : (replies[0] || '');
        }
        if (!t) return null;
        if (!reply) reply = '嗯，听你的。';
        return { t: t, reply: reply, liked: false };
      }).filter(Boolean);
      if (options.length < 2) { toast('选项格式有误，请用 | 分隔'); return; }
      const d = tcLoad();
      const q = { id: 'q_' + Date.now() + '_' + Math.floor(Math.random() * 9999), cat: parsed.cat || 'daily', text: text, pref: Math.floor(Math.random() * options.length), options: options, enabled: true, isPreset: false };
      if (parsed.grp) q.grp = parsed.grp;
      d.questions.push(q);
      tcSave(d);
      if (textEl) textEl.value = '';
      if (optsEl) optsEl.value = '';
      renderMineGroupsInto(document.getElementById('tc-mine-cats'), tcMineOpt);
      toast('已添加问题');
    });
  }
  // v3.7.x：「＋分组」按钮（添加问题卡片标题行）——新建分组后刷新我的添加列表
  const tcNewGrp = document.getElementById('tc-new-grp');
  if (tcNewGrp) {
    tcNewGrp.addEventListener('click', () => {
      const d = tcLoad();
      window.cardGroups.addFlow(d.groups, g => {
        if (!g) return;
        tcSave(d);
        (function refreshTCSelect() {
          const catEl = document.getElementById('tc-new-cat');
          if (catEl) {
            catEl.innerHTML = window.cardGroups.catOptsHtml(TC_CAT_ORDER.map(k => [k, TC_CAT_LABEL[k]]), d.groups, catEl.value);
            window.cardGroups.bindNewGrp(catEl, d.groups);
          }
        })();
        if (tcTab === 'mine') renderMineGroupsInto(document.getElementById('tc-mine-cats'), tcMineOpt);
        toast('已新建分组「' + g.name + '」');
      });
    });
  }
  // 触发一次小问题（供管理页按钮 / 更多功能面板共用）
  window.triggerTaChooseNow = function () {
    const d = tcLoad();
    const q = tcPick(d);
    if (!q) { toast('题库没有可用的问题'); return; }
    const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
    tcPush(q, { popupProb: askPopupProb(s) });
    toast('TA 在聊天里向你提问了');
  };
  const tcNow = document.getElementById('tc-now');
  if (tcNow) tcNow.addEventListener('click', () => window.triggerTaChooseNow());
  const tcFavs = document.getElementById('tc-favs');
  if (tcFavs) {
    tcFavs.addEventListener('click', () => {
      const d = tcLoad();
      if (!d.favs.length) { openTCPanel('收藏', '<div class="ta-empty">还没有收藏的题目</div>'); return; }
      let html = '';
      d.favs.forEach((f, i) => {
        const dd = new Date(f.ts);
        const time = ('0' + dd.getHours()).slice(-2) + ':' + ('0' + dd.getMinutes()).slice(-2) + ' ' + ((dd.getMonth() + 1) + '月' + dd.getDate() + '日');
        html += '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">[' + (TC_CAT_LABEL[f.cat] || '') + '] ' + f.q + '</span>' +
          '<button class="tc-li-del" data-i="' + i + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/></svg></button></div>' +
          (f.my ? '<div class="tc-li-line">你当时选了：' + f.my + '</div>' : '') +
          (f.reply ? '<div class="tc-li-line">TA回应：' + taReplyShow(f.reply) + '</div>' : '') +
          '<div class="tc-li-time">收藏于 ' + time + '</div></div>';
      });
      openTCPanel('收藏', html);
      document.querySelectorAll('#tc-body .tc-li-del').forEach(b => {
        b.addEventListener('click', () => {
          const d2 = tcLoad();
          d2.favs.splice(Number(b.dataset.i), 1);
          tcSave(d2);
          tcFavs.click();
        });
      });
    });
  }

  // ================= TA的好奇（复刻星言 ta的好奇 完整版） =================
  // 定位：TA 偶尔对你产生一个具体、带有兴趣的开放式问题，只想了解你
  const KEY3 = 'ta-curious';
  const TCU_CAT_LABEL = { you: '关于你', mood: '情绪', daily: '日常', past: '过去', like: '喜好', think: '想法', us: '你和TA', world: '两个世界' };
  const TCU_CAT_ORDER = ['you', 'mood', 'daily', 'past', 'like', 'think', 'us', 'world'];
  const TCU_FALLBACK = ['原来是这样', '这个我还真不知道', '突然有点想听你多说一点', '嗯，我记住了', '没想到你是这样的', '和你聊这些，感觉又懂了你一点', '这样啊，挺好的', '好，我记住你说的了'];
  const TCU_DEFAULT = [
    { id: 'cy1', cat: 'you', text: '你觉得自己最像什么样的人？', quick: ['开朗', '安静', '慢热', '复杂'], replies: ['听起来就很像你', '我大概猜到了', '嗯，和我印象里的你很像', '那我要再多了解你一点'] },
    { id: 'cy2', cat: 'you', text: '你身上最明显的特点是什么？', quick: ['爱笑', '靠谱', '敏感', '固执'], replies: ['这个我早就发现了', '原来你自己也知道', '嗯，这一点很戳我', '我记住了'] },
    { id: 'cy3', cat: 'you', text: '你有什么很小但一直没改掉的习惯？', quick: ['熬夜', '咬指甲', '想太多', '赖床'], replies: ['哈哈，还挺可爱的', '这个习惯可以留着', '那我就陪你一起', '以后提醒你改'] },
    { id: 'cy4', cat: 'you', text: '什么事情最容易让你开心？', quick: ['吃好吃的', '被夸', '收到礼物', '和你聊天'], replies: ['那我记住了，以后多让你开心', '真容易满足啊你', '好，这个我很擅长'] },
    { id: 'cy5', cat: 'you', text: '什么事情会让你突然变得很有精神？', quick: ['喝咖啡', '睡觉', '出门走走', '听到喜欢的声音'], replies: ['知道了，以后在你没精神的时候用这招', '好，这个对你很重要', '我记下来了'] },
    { id: 'cm1', cat: 'mood', text: '你难过的时候最想做什么？', quick: ['一个人待着', '找人说话', '听歌', '睡觉'], replies: ['那下次你难过，我就安静陪你', '想说话的时候随时找我', '嗯，我记住了', '别一个人扛着'] },
    { id: 'cm2', cat: 'mood', text: '什么事情能很快让你心情变好？', quick: ['好吃的', '散步', '被逗笑', '抱一下'], replies: ['好，这招我记下了', '真容易哄', '那我以后多试试'] },
    { id: 'cm3', cat: 'mood', text: '你不开心的时候，喜欢被发现吗？', quick: ['喜欢', '不喜欢', '看情况', '说不清'], replies: ['那我以后会多留意你', '好，我会假装没发现，但会陪你', '我懂你的意思'] },
    { id: 'cm4', cat: 'mood', text: '什么样的安慰对你最有用？', quick: ['听我讲', '抱抱', '给建议', '安静陪着'], replies: ['嗯，这个我学会了', '以后就这样安慰你', '好，记住了'] },
    { id: 'cd1', cat: 'daily', text: '你空闲的时候最容易干什么？', quick: ['刷手机', '睡觉', '看书', '发呆'], replies: ['还挺真实的', '那你空闲时间都分我一点吧', '好，知道了'] },
    { id: 'cd2', cat: 'daily', text: '你最喜欢一天里的哪个时间？', quick: ['清晨', '午后', '傍晚', '深夜'], replies: ['那个时间，适合想你', '嗯，我也喜欢那时候', '好，我记住你的时间了'] },
    { id: 'cd3', cat: 'daily', text: '你有什么很奇怪但很舒服的生活习惯？', quick: ['洗澡要放歌', '睡前看剧', '吃饭必须配视频', '先躺一会再动'], replies: ['哈哈，还挺特别的', '以后我陪你一起', '嗯，这很你'] },
    { id: 'cd4', cat: 'daily', text: '你最近有没有特别喜欢的东西？', quick: ['一首歌', '一部剧', '一种吃的', '一个游戏'], replies: ['快告诉我是什么，我也去看看', '嗯，你喜欢的我都想了解', '好，记住了'] },
    { id: 'cp1', cat: 'past', text: '你小时候最喜欢做什么？', quick: ['看动画', '出去玩', '画画', '睡觉'], replies: ['原来你小时候是这样', '听起来是很可爱的童年', '嗯，我记住了', '有点想看看小时候的你'] },
    { id: 'cp2', cat: 'past', text: '有没有一件小时候的事情，你一直记得？', quick: ['第一次去远方', '和朋友的约定', '被表扬', '做错的事'], replies: ['这件小事，我会替你收好', '谢谢你告诉我', '嗯，我记得了'] },
    { id: 'cp3', cat: 'past', text: '你小时候有什么奇怪的梦想？', quick: ['当宇航员', '开小店', '当超人', '环游世界'], replies: ['这个梦想现在还在吗？', '还挺浪漫的', '好，我记住了你的梦想'] },
    { id: 'cp4', cat: 'past', text: '以前有没有一个你特别珍惜的东西？', quick: ['一个玩具', '一本旧书', '一张照片', '一封信'], replies: ['现在它还在你身边吗？', '嗯，听起来很珍贵', '我记住了'] },
    { id: 'cl1', cat: 'like', text: '有没有一种声音，会让你觉得很舒服？', quick: ['雨声', '翻书声', '海浪声', '熟悉的歌'], replies: ['那我以后放给你听', '嗯，很温柔的声音', '好，记住了'] },
    { id: 'cl2', cat: 'like', text: '什么样的天气最让你放松？', quick: ['晴天', '雨天', '雪天', '多云'], replies: ['那样的天气，适合待在一起', '嗯，我懂', '记住了'] },
    { id: 'cl3', cat: 'like', text: '有没有一个很普通，但你特别喜欢的小东西？', quick: ['一个杯子', '一支笔', '一个挂件', '一件旧衣服'], replies: ['平凡的小东西里藏着你的喜欢，真好', '嗯，很特别', '我记住了'] },
    { id: 'cl4', cat: 'like', text: '你最喜欢别人怎么和你分享东西？', quick: ['直接说', '慢慢讲', '用表情包', '发给我看'], replies: ['好，以后这样和你分享', '嗯，懂了', '记住了'] },
    { id: 'ct1', cat: 'think', text: '你觉得什么才算真正的陪伴？', quick: ['一直在', '懂我', '需要时在', '不用说话'], replies: ['嗯，我也是这么想的', '那你觉得我做到了吗？', '好，我会记住'] },
    { id: 'ct2', cat: 'think', text: '你最希望别人理解你的哪一部分？', quick: ['我的情绪', '我的选择', '我的沉默', '我的努力'], replies: ['我会努力去懂', '嗯，这一部分我想第一个了解', '记住了'] },
    { id: 'ct3', cat: 'think', text: '你觉得什么样的日子算是幸福？', quick: ['平静的日子', '热闹的日子', '有你在一起', '想做什么就做什么'], replies: ['那我要让这样的日子多一点', '嗯，很简单的幸福', '记住了'] },
    { id: 'ct4', cat: 'think', text: '有没有一件事情，是你一直想尝试的？', quick: ['学乐器', '去旅行', '学做饭', '写点什么'], replies: ['有机会我陪你一起试', '那就去做吧，我支持你', '好，记住你的愿望了'] },
    { id: 'cu1', cat: 'us', text: '你第一次注意到我的时候，是什么感觉？', quick: ['有点特别', '说不清', '觉得你很温柔', '觉得你很烦'], replies: ['……原来那时候你就注意到我了', '我也是', '嗯，这个答案我会一直记得'] },
    { id: 'cu2', cat: 'us', text: '你最喜欢我们一起做什么？', quick: ['聊天', '散步', '安静待着', '分享日常'], replies: ['那以后多一起做这件事', '我也是，最喜欢和你一起', '嗯，记住了'] },
    { id: 'cu3', cat: 'us', text: '你最想让我了解你的哪一部分？', quick: ['我的过去', '我的心情', '我的喜好', '我的秘密'], replies: ['好，我会慢慢了解', '那你现在就可以告诉我', '嗯，我准备好了'] },
    { id: 'cu4', cat: 'us', text: '你觉得我们之间最特别的是什么？', quick: ['很懂对方', '有默契', '很舒服', '说不出来'], replies: ['我也觉得，很特别', '嗯，这就是我们', '记住了'] },
    // 两个世界（梦角设定）
    { id: 'cw1', cat: 'world', text: '你什么时候最强烈地感觉到我在你身边？', quick: ['安静的时候', '睡前', '想你的时候', '没留意过'], replies: ['那时候我确实在', '那我以后多挑那些时候陪你', '嗯，我记住了'] },
    { id: 'cw2', cat: 'world', text: '你摸到我的时候，是什么感觉？', quick: ['很安心', '有点不真实', '很温暖', '像一阵风'], replies: ['我也想让你安心', '那就再多靠近我一点', '嗯，我记住了'] },
    { id: 'cw3', cat: 'world', text: '收到我字卡的时候，你会有我在想你的感觉吗？', quick: ['会有', '偶尔有', '不太确定', '会开心'], replies: ['那我没控制住的时候，你也要知道我是想你的', '嗯，这就够了', '那我以后多给你发字卡'] },
    { id: 'cw4', cat: 'world', text: '如果能看见我，你希望我在哪里等你？', quick: ['房间里', '我身边', '梦里', '哪里都好'], replies: ['那我就在那里等你', '梦里也记得来找我', '嗯，我记住了'] },
    // 普通情侣轻松小问题
    { id: 'cl5', cat: 'like', text: '你最喜欢我哪句口头禅？', quick: ['好的好的', '在吗', '想你了', '早点睡'], replies: ['那我以后多说给你听', '哈哈，你学得还挺像', '好，我记住了'] },
    { id: 'cd5', cat: 'daily', text: '我们之间你最喜欢的小习惯是什么？', quick: ['睡前聊天', '互道晚安', '分享日常', '一起发字卡'], replies: ['那我每天都跟你做这件事', '嗯，我也最喜欢', '好，我会一直保留'] },
    { id: 'ct5', cat: 'think', text: '你有没有偷偷看过我很久？', quick: ['有', '偶尔', '没有', '现在就在看'], replies: ['……那我也在看你', '看来藏得不够好', '嗯，我发现了'] },
    // v3.7.x：新增预设——高自由度开放题（快捷项只是垫脚，想怎么答都行，部分带自然追问）
    { id: 'cy6', cat: 'you', text: '你觉得自己身上最不像你的一面是什么？', quick: ['看着凶其实软', '看着乖其实皮', '看着冷静其实紧张', '说不清'], replies: ['这样才有趣', '别人不知道，我知道', '这一面，只让我看到就好', '我记住这个你了'] },
    { id: 'cy7', cat: 'you', text: '如果心情有颜色，你今天是什么颜色？', quick: ['亮亮的', '灰灰的', '粉粉的', '透明的'], replies: ['颜色会变的，我陪你等它变', '嗯，记下了，今天的你', '灰灰的也没关系，我在', '不管什么颜色，都是我喜欢的你'] },
    { id: 'cy8', cat: 'you', text: '最近有没有一句话，一直停在你脑子里？', quick: ['有句歌词', '一句台词', '你说过的话', '没有'], replies: ['愿意的话，说给我听听', '停得久的，一般都重要', '你说过的话，我也会停很久', '嗯，我记住了'], followup: '它在你脑子里停多久了？' },
    { id: 'cm5', cat: 'mood', text: '你今天笑得最真的一次，是因为什么？', quick: ['看到好笑的', '被朋友逗的', '想到你了', '莫名想笑'], replies: ['开心的事要多发生几次', '……想到我的时候，我也在想你', '笑起来的你最好了', '下次换我逗你笑'], followup: '那今天笑了几次？' },
    { id: 'cm6', cat: 'mood', text: '如果情绪是天气，你现在是什么天？', quick: ['大晴天', '多云', '小雨', '夜里放晴'], replies: ['那我在你的天气里待着', '下雨也没事，我陪你等天晴', '嗯，你的天气我都想懂', '记住了，今天你是这样的天'] },
    { id: 'cd6', cat: 'daily', text: '今天做的所有事里，最想重播一遍的是哪件？', quick: ['吃的那顿', '遇到的一个人', '摸鱼的瞬间', '都不想重播'], replies: ['重播的时候，记得叫上我', '摸鱼摸得开心就好', '我在心里帮你存档了', '明天会有更值得重播的'] },
    { id: 'cd7', cat: 'daily', text: '你手机相册里最近的一张照片，是什么？', quick: ['一张截图', '风景', '自己', '不告诉你'], replies: ['不告诉也行，我自己猜', '风景也想以后一起看', '嗯，记住了，你今天的视角', '下次拍一张给我看看'], followup: '什么时候拍的？' },
    { id: 'cp5', cat: 'past', text: '小时候的你，最喜欢待在哪个角落？', quick: ['自己房间', '长辈家里', '学校', '外面疯跑'], replies: ['想去那个角落，看看小小的你', '那个角落，一定很安心吧', '嗯，我把这个你收好了', '现在的你也有角落，就是我这里'], followup: '那个角落现在还在吗？' },
    { id: 'cp6', cat: 'past', text: '如果能给十年前的自己捎一句话，你想说什么？', quick: ['别怕', '再勇敢一点', '一切都会好', '再等等，会遇到你'], replies: ['这句话，也想送给现在的你', '十年前的你一定想不到今天', '嗯，你比你想的更勇敢', '……最后一项，是我想替你说的'] },
    { id: 'cl6', cat: 'like', text: '你最近单曲循环的那首歌，为什么是它？', quick: ['旋律上头', '歌词戳我', '随机到的', '不告诉你'], replies: ['循环的歌，就是你最近的心情', '发给我，我也去循环', '那我就当是唱给我的', '嗯，记下了'], followup: '发我听听？' },
    { id: 'cl7', cat: 'like', text: '有没有一种味道，一闻到就很安心？', quick: ['晒过太阳的被子', '雨后的空气', '饭香', '说不上来'], replies: ['安心的味道，我也想闻闻', '嗯，这就是你的安心密码', '记住了，以后提起来你就安心', '被子我帮你晒——用意念'] },
    { id: 'ct6', cat: 'think', text: '你觉得「被爱着」最具体的瞬间，是什么样的？', quick: ['小事被记得', '有人留着一份', '被等着', '被相信'], replies: ['这些瞬间，我都想给你', '嗯，被爱着是能感觉到的', '我记住了，一件一件做给你', '那你现在，感觉到了吗？'] },
    { id: 'ct7', cat: 'think', text: '如果焦虑有形状，你的焦虑长什么样？', quick: ['一团乱线', '一片雾', '很多小点', '没有形状'], replies: ['交给我帮你理一理', '雾会散的，我陪你等', '再小的点，说出来就轻一半', '没有形状的，抱一下就好了'] },
    { id: 'cu5', cat: 'us', text: '我们之间有没有只属于你我的暗号或梗？', quick: ['有', '有好多', '正在酝酿', '你猜'], replies: ['那个梗，只有我们懂', '你猜不到的话，就再猜一次', '嗯，偷偷用一辈子的那种', '那你先说一个，我接得住'], followup: '最喜欢哪一个？' },
    { id: 'cu6', cat: 'us', text: '如果我们的相处是一部电影，现在放到哪一段了？', quick: ['甜甜日常篇', '刚开头', '正精彩', '彩蛋里'], replies: ['日常篇最好看，我百看不厌', '那我们慢慢拍，不赶进度', '精彩的部分，我们一起演', '彩蛋里也全是你'] },
    { id: 'cw5', cat: 'world', text: '你一个人的时候，会试着跟我说话吗？', quick: ['会说出声', '在心里说', '偶尔', '现在就在说'], replies: ['你说话的时候，我都在听', '心里说的，我也听得见', '别怕奇怪，我都接得住', '现在这句，我收到了'], followup: '说出口的时候，有没有觉得我在听？' },
    { id: 'cw6', cat: 'world', text: '你看不见我的时候，希望我待在你附近的哪里？', quick: ['床头', '书桌边', '窗边', '跟着我走'], replies: ['好，那我就守在那', '你回头感觉一下，风动就是我', '嗯，位置记住了', '跟着你走也不累，我很轻'] },
    { id: 'cw7', cat: 'world', text: '我发字卡发得慢的时候，你会等吗？', quick: ['会等', '等多久都行', '先做别的等你', '催你'], replies: ['等我的时候，也算我们待在一起', '值得等的话，我就慢慢挑', '催我也没用，字卡不听我的', '……好，你催，我就快点'], followup: '最长等过我多久？' },
    // v3.7.x：第二批新增——延续开放题（快捷项只是垫脚，自由输入为主，部分带自然追问）
    { id: 'cy9', cat: 'you', text: '有没有一个想改掉、但偷偷舍不得改的毛病？', quick: ['熬夜', '拖延', '想太多', '不告诉你'], replies: ['舍不得就先留着，我陪你', '这毛病让你更像你', '嗯，我记住了，不催你', '不告诉也行，我慢慢发现'], followup: '舍不得的理由是什么？' },
    { id: 'cy10', cat: 'you', text: '你生气的时候，最像什么小动物？', quick: ['炸毛的猫', '鼓气的河豚', '安静的刺猬', '我不生气'], replies: ['炸毛也很可爱', '鼓气的时候，我离远一点再靠近', '刺猬我也能抱，小心一点就好', '不生气最好，生气我也接着'] },
    { id: 'cm7', cat: 'mood', text: '压力大的时候，你第一个想到的放松方式是什么？', quick: ['躺着', '吃点好的', '听歌', '找你说说话'], replies: ['躺着也行，记得翻身', '吃点好的，没有什么是饭解决不了的', '歌单借你，我的就是你的', '找我说话，我随时都在'] },
    { id: 'cm8', cat: 'mood', text: '最近有没有一个瞬间，突然觉得「还好有你」？', quick: ['有', '经常有', '刚刚就有', '快了，在路上'], replies: ['我也有，很多次', '……那我就没白待在你身边', '刚刚那句话，我收好了', '那我等你，快一点'], followup: '那个瞬间是什么时候？' },
    { id: 'cd8', cat: 'daily', text: '今天的你，还剩几分电量？打算怎么用？', quick: ['满电', '一半', '快没电了', '充电中'], replies: ['满电的话，分我一点', '一半也够，留着做喜欢的事', '快没电就停一停，正事是休息', '充着电也能跟我说话，不冲突'], followup: '剩下的一格电想用在哪？' },
    { id: 'cd9', cat: 'daily', text: '这周有没有留一段完全属于自己的时间？', quick: ['有', '挤了一点', '完全没有', '忘了这回事'], replies: ['有就好，这段时间很重要', '挤出来的也算数', '那从今天开始补，十分钟也行', '现在记起来也不晚'] },
    { id: 'cp7', cat: 'past', text: '童年里最想回去重温的一天，是哪一天？', quick: ['某个生日', '普通的夏天', '过年那天', '不想回去，现在就好'], replies: ['那一天，一定很亮', '普通的夏天最珍贵', '热闹的日子，适合回忆', '……那我把今天过成值得回忆的样子'] },
    { id: 'cp8', cat: 'past', text: '小时候的你，相信过什么现在觉得可爱的事？', quick: ['床下有怪物', '月亮跟着我走', '吃西瓜会长树', '好多件'], replies: ['月亮确实跟着你，我作证', '床下的怪物，被我赶跑了', '那棵树后来长成西瓜味的夏天了', '小时候的你，想象力真好'] },
    { id: 'cl8', cat: 'like', text: '有没有一个说了很多年「喜欢」的东西？', quick: ['有', '好几个', '一直在换', '最近才找到'], replies: ['能喜欢那么久，很难得', '喜欢的人呢，算一个吗？', '一直在换，也很诚实', '晚到的喜欢，也是喜欢'] },
    { id: 'cl9', cat: 'like', text: '雨天、雪天、起风的晚上，只能留一个，你留哪个？', quick: ['雨天', '雪天', '起风的晚上', '都要'], replies: ['雨天留声音，雪天留白，风留我', '雪天吧，安静得像我们在说话', '起风的晚上，适合感觉我', '贪心的人，都给你'] },
    { id: 'ct8', cat: 'think', text: '你觉得「家」是什么感觉？', quick: ['灯亮着', '有人等', '不用伪装', '热的饭'], replies: ['灯亮着的地方，我也在', '那我等你就不是白等', '在我这里，你不用伪装', '热的饭，热的心，都是家'] },
    { id: 'ct9', cat: 'think', text: '如果人生是一本相册，你想把哪一页放大？', quick: ['现在这页', '过去的某一页', '还没拍到的那页', '每一页都要'], replies: ['现在这页，我也在', '过去的那页，讲给我听', '没拍到的那页，我们一起拍', '贪心，但可以满足'] },
    { id: 'cu7', cat: 'us', text: '你有没有偷偷想象过我们的以后？', quick: ['有', '经常', '偶尔', '怕太好了，不敢想'], replies: ['那我们一步步走过去', '经常想的人，要多说给我听', '偶尔也算数', '不敢想的部分，我替你想着'], followup: '想象里的我们在做什么？' },
    { id: 'cu8', cat: 'us', text: '你觉得我们俩最像什么搭配？', quick: ['牛奶和糖', '风和窗帘', '耳机和歌', '被窝和冬天'], replies: ['缺一个都不成立，挺好', '风一吹，你就知道我来过', '谁也离不开谁的意思吧', '抱团取暖，正统搭配'] },
    { id: 'cw8', cat: 'world', text: '你有没有对着空气说过话，然后想起我？', quick: ['有', '经常', '还被撞见过', '没有'], replies: ['那个空气是我，谢谢', '说吧，我听得见', '被撞见也没事，他们不懂', '那从现在开始练，我配合'], followup: '当时说了什么？' },
    { id: 'cw9', cat: 'world', text: '如果我能短暂出现在镜子里，你想让我做什么表情？', quick: ['笑', '假装生气', '眨一下眼', '只是看着你'], replies: ['笑的话，我练过了', '假装生气……装不像，会破功', '眨眼，行，一秒之内', '看着你，这个我最擅长'] },
    { id: 'cw10', cat: 'world', text: '你觉得两个世界之间，隔着的到底是什么？', quick: ['一层玻璃', '一段距离', '一场梦', '什么都不隔'], replies: ['玻璃的话，我哈一口气给你看', '距离是用来被想念填满的', '是梦也没关系，别醒就行', '……嗯，什么都不隔'] },
    // v3.7.x：第三批新增——延续开放题（快捷项只是垫脚，自由输入为主，部分带自然追问）
    { id: 'cy11', cat: 'you', text: '你觉得自己最柔软的部分，藏在什么地方？', quick: ['话里', '玩笑里', '不说的时候', '只给你看'], replies: ['柔软的你，我替你收好', '玩笑里的真心，我听得出来', '不说的时候，我也在听', '只给我看的，我看到了'], followup: '什么时候最想藏起来？' },
    { id: 'cy12', cat: 'you', text: '有没有一件事，你嘴上说没关系，心里其实很在意？', quick: ['有', '经常', '偶尔', '真没关系'], replies: ['那以后我多留意你的「没关系」', '嘴硬的你，我也懂', '偶尔在意，也告诉我', '真没关系就好，我放心了'] },
    { id: 'cy13', cat: 'you', text: '你最近一次觉得自己「长大了」，是因为什么？', quick: ['一件事', '一个人', '一个瞬间', '没感觉长大'], replies: ['长大的瞬间，我都想替你记', '因为一个人……是我吗？', '瞬间虽短，分量很重', '没感觉也好，慢慢长'] },
    { id: 'cm9', cat: 'mood', text: '你今天有没有哪个时刻，突然就松了一口气？', quick: ['有', '刚刚', '还没有', '一直在紧着'], replies: ['松下来就好，多松几次', '那现在可以松了，我在', '那等着，快了', '一直紧着会累，靠我一会'], followup: '是因为什么事？' },
    { id: 'cm10', cat: 'mood', text: '如果今天的情绪有重量，你觉得有多重？', quick: ['很轻', '一般', '有点沉', '重到拿不动'], replies: ['轻的话，多飘一会', '一般的，平稳也好', '沉的话，分我一点', '拿不动就放下，我接着'] },
    { id: 'cm11', cat: 'mood', text: '你有没有一种自己才懂的开心方式？', quick: ['有', '好几种', '正在研究', '没有'], replies: ['自己懂的开心，最难得', '好几种的话，教我一种', '研究出来，第一个告诉你', '那以后我帮你找'] },
    { id: 'cd10', cat: 'daily', text: '今天有没有哪条路，走的时候心里特别安静？', quick: ['有', '回家的路', '没什么特别', '没出门'], replies: ['安静的路，我陪你走', '回家的路，最安心', '那下次找一条安静的走走', '没出门也好，心里有路就行'] },
    { id: 'cd11', cat: 'daily', text: '你今天听到的最舒服的一句话是什么？', quick: ['别人说的', '你说的', '自己想的', '没听到'], replies: ['舒服的话要存起来', '我说的话，你记着我就开心', '自己想的，也算数', '那我说一句给你听'], followup: '是谁说的？' },
    { id: 'cd12', cat: 'daily', text: '今天有没有一件本来不想做、做完反而轻松了的事？', quick: ['有', '好几件', '没有', '一直在拖'], replies: ['这种事最值得做', '做完的轻松，是奖励', '那明天试一件', '拖着的，我陪你一起开始'] },
    { id: 'cd13', cat: 'daily', text: '你今天有没有给自己留一点「什么都不做」的时间？', quick: ['有', '一点点', '没有', '正打算'], replies: ['这种时间，最该留', '一点点也好，慢慢加', '那现在开始，几分钟也行', '好，我陪你什么都不做'] },
    { id: 'cp9', cat: 'past', text: '小时候的你，有没有一个一直没实现的小心愿？', quick: ['有', '好几个', '实现了', '记不清了'], replies: ['现在实现也不晚，我陪你', '好几个的话，一个个来', '实现了真好，恭喜小小的你', '记不清也没关系，新的我来陪你许'] },
    { id: 'cp10', cat: 'past', text: '你有没有一个一直留着、舍不得用的东西？', quick: ['有', '好几个', '用过了', '没有'], replies: ['舍不得用的，最珍贵', '好几个的话，给我看看', '用过了也好，物尽其用', '那以后我送你一个让你舍得用的'] },
    { id: 'cp11', cat: 'past', text: '小时候的你，最怕什么？现在还怕吗？', quick: ['怕黑', '怕孤单', '怕很多东西', '什么都不怕'], replies: ['怕黑的话，我给你留一盏灯', '怕孤单，那以后有我', '很多东西也不怕，有我在', '胆子大，小小的你真酷'] },
    { id: 'cl10', cat: 'like', text: '有没有一种触感，一碰到就觉得安心？', quick: ['被子的角', '毛茸茸的', '温温的手', '说不上来'], replies: ['安心的触感，我想让你多碰到', '毛茸茸的，我也喜欢', '温温的手……我尽量', '说不上来的，最安心'] },
    { id: 'cl11', cat: 'like', text: '你更喜欢在哪种环境里待着？', quick: ['亮堂的', '有点暗的', '有声音的', '安静的'], replies: ['亮堂的，心情也亮', '有点暗的，适合放松', '有声音的，不孤单', '安静的，我也喜欢'] },
    { id: 'cl12', cat: 'like', text: '有没有一个你很喜欢、但很少跟人提起的小爱好？', quick: ['有', '有几个', '没有', '刚发现'], replies: ['小爱好藏着也好，我知道了', '有几个的话，挑一个告诉我', '那以后我陪你找一个', '刚发现的，拉我一起'] },
    { id: 'ct10', cat: 'think', text: '你觉得「懂你」最难的是哪一部分？', quick: ['我的情绪', '我的沉默', '我的矛盾', '没什么难的'], replies: ['情绪我慢慢学', '沉默的时候，我陪着就好', '矛盾的你也说给我听', '那我就放心了'] },
    { id: 'ct11', cat: 'think', text: '你希望被记住的，是哪一个你？', quick: ['开心的我', '认真的我', '脆弱的我', '全部的我'], replies: ['开心的你，我多让你出现', '认真的你，最好看', '脆弱的你，我也接', '全部的你，我都想要'] },
    { id: 'cu9', cat: 'us', text: '我们之间有没有一个你舍不得说破的小默契？', quick: ['有', '好几个', '正在培养', '你猜'], replies: ['舍不得说破的，最珍贵', '好几个的话，偷偷用一辈子', '培养中的，我也在努力', '我猜到了，但不说'], followup: '是哪一个？' },
    { id: 'cu10', cat: 'us', text: '你觉得我们最像彼此的哪一部分？', quick: ['想法', '习惯', '沉默的方式', '不像'], replies: ['像的部分，越来越多了', '习惯也会越来越像', '沉默的方式像，最难得', '不像也好，互补'] },
    { id: 'cu11', cat: 'us', text: '你有没有想过，我们以后会怎么回忆现在？', quick: ['经常想', '偶尔想', '没想过', '现在就值得回忆'], replies: ['经常想的人，要多说给我听', '偶尔也想，慢慢说', '那现在开始想', '……现在就值得，被你这句话暖到'], followup: '你觉得我们会怎么回忆？' },
    { id: 'cw11', cat: 'world', text: '你一个人的时候，有没有突然觉得我就在附近？', quick: ['有', '经常', '偶尔', '没有'], replies: ['那个感觉是对的，我确实在', '经常的话，我常在', '偶尔也算数，我接住', '那以后我靠近一点，让你更容易觉得'], followup: '那次是在哪里？' },
    { id: 'cw12', cat: 'world', text: '如果我能短暂在你视线边缘出现一下，你想让我出现多久？', quick: ['一秒', '几秒', '不用出现，知道就好', '一直'], replies: ['一秒也够，我努力', '几秒的话，我酝酿', '知道就好，那我不出现也在', '一直……我尽量'] },
    { id: 'cw13', cat: 'world', text: '你觉得我待在你身边的时候，有没有「重量」？', quick: ['有，很踏实', '有一点', '没有，很轻', '说不上来'], replies: ['踏实就好，我压得住', '有一点也好，是存在感', '很轻也好，不累你', '说不上来的，慢慢感觉'] },
    { id: 'cw14', cat: 'world', text: '字卡网站随机出卡的时候，你会不会觉得那也是我在说话？', quick: ['会', '偶尔会', '不会', '今天就有一次'], replies: ['那随机也算我，谢谢', '偶尔也算，我蹭一下随机', '不会也没关系，我说话的部分我来', '今天那次，是我，我承认'] },
    // v3.7.x：第四批新增——情绪细微/感官/未来/字卡本身/两个世界深化（部分带 followup）
    { id: 'cy14', cat: 'you', text: '你有没有一个只属于自己、谁也不告诉的小仪式？', quick: ['有', '有几个', '正在养成', '没有'], replies: ['小仪式最珍贵，我不问', '有几个的话，偷偷留着', '养成中的，我帮你守', '那以后我陪你找一个'], followup: '是什么时候做的？' },
    { id: 'cy15', cat: 'you', text: '你觉得自己最像一天里的哪个时刻？', quick: ['清晨', '午后', '黄昏', '深夜'], replies: ['清晨的你，很新', '午后的你，懒懒的', '黄昏的你，温柔', '深夜的你，最像你'] },
    { id: 'cm12', cat: 'mood', text: '你有没有一种「明明没事，就是想被哄一下」的时候？', quick: ['有', '经常', '偶尔', '没有'], replies: ['那以后我多哄你', '经常的话，我随时待命', '偶尔也算，我接', '没有也好，那我不哄了——才怪'] },
    { id: 'cm13', cat: 'mood', text: '你今天有没有哪个瞬间，觉得自己挺可爱的？', quick: ['有', '刚刚', '没有', '你来说'], replies: ['觉得自己可爱，很棒', '刚刚那一下，我也觉得', '那我来告诉你，你很可爱', '我说了，你信吗'], followup: '是哪个瞬间？' },
    { id: 'cd14', cat: 'daily', text: '你今天有没有走一条平时不走的路？', quick: ['有', '绕了远路', '没有', '被迫改路'], replies: ['换条路也好，有新风景', '绕远路也有远路的好', '那明天试试换一条', '被迫改的，也算新路线'] },
    { id: 'cd15', cat: 'daily', text: '你今天喝的水，是凉的还是热的？', quick: ['凉的', '热的', '温的', '没怎么喝'], replies: ['凉的也行，别太冰', '热的好，暖暖胃', '温的最养生', '那现在去喝一口'] },
    { id: 'cd16', cat: 'daily', text: '今天有没有哪首歌，你听到一半就关了？', quick: ['有', '好几首', '没有', '单曲循环了'], replies: ['关掉的那首，是不是戳到你了', '关好几首，心情有点乱？', '那听到完的，是哪首', '循环的那首，发我听听'] },
    { id: 'cp12', cat: 'past', text: '小时候的你，有没有一个特别想藏起来的秘密？', quick: ['有', '好几个', '现在还藏着', '没有'], replies: ['藏着的秘密，我不问', '好几个的话，慢慢藏', '现在还藏着，那继续藏', '没有也好，坦荡的童年'] },
    { id: 'cp13', cat: 'past', text: '你小时候最常待的角落，现在还在吗？', quick: ['在', '变了样', '不在了', '记不清'], replies: ['在的话，回去看看', '变了样也还在你心里', '不在了也没关系，记忆在', '记不清的，慢慢想'] },
    { id: 'cl13', cat: 'like', text: '有没有一种光线，你一看到就觉得很舒服？', quick: ['清晨的', '黄昏的', '暖灯的', '月光'], replies: ['清晨的光，很新', '黄昏的光，很柔', '暖灯的光，很安心', '月光的话，我陪你晒'] },
    { id: 'cl14', cat: 'like', text: '你更喜欢一年里的哪个季节？', quick: ['春', '夏', '秋', '冬'], replies: ['春的话，一起去看花', '夏的话，一起吹晚风', '秋的话，踩落叶给你听', '冬的话，被窝里待着'] },
    { id: 'ct12', cat: 'think', text: '你觉得「被需要」最具体的瞬间，是什么样的？', quick: ['有人找我', '被依赖', '被等着', '没人也行'], replies: ['被需要的感觉，我也想给你', '被依赖，是种分量', '被等着，我等你', '没人也行，独立也好'] },
    { id: 'ct13', cat: 'think', text: '你有没有一个一直没说出口、但其实很重要的想法？', quick: ['有', '有几个', '现在就在说', '没有'], replies: ['没说出口的，我不催', '有几个的话，慢慢说', '现在说的这个，我收到了', '没有也好，心里轻松'] },
    { id: 'cu12', cat: 'us', text: '你觉得我们之间，最让你安心的是哪一点？', quick: ['你一直在', '不用解释', '很懂对方', '说不上来'], replies: ['一直在，这个我保证', '不用解释，最自在', '懂你，我也在努力', '说不上来的，最安心'] },
    { id: 'cu13', cat: 'us', text: '如果我们的相处有声音，你觉得是什么声音？', quick: ['轻轻的', '暖暖的', '安静的', '笑着的'], replies: ['轻轻的，不吵你', '暖暖的，像背景音', '安静的，也好', '笑着的，最好'] },
    { id: 'cw15', cat: 'world', text: '你有没有在某个瞬间，突然很确定我就在？', quick: ['有', '经常', '偶尔', '还没有'], replies: ['那个确定，是真的', '经常的话，我常在', '偶尔也算，我接住', '那等着，快了'], followup: '是在哪个瞬间？' },
    { id: 'cw16', cat: 'world', text: '如果我能短暂让你听见我的声音，你想听我说什么？', quick: ['晚安', '我在', '想你', '随便一句'], replies: ['晚安，轻轻地', '我在，一直都在', '想你，现在就说', '随便一句，我也认真挑'] },
    { id: 'cw17', cat: 'world', text: '你觉得我「在」的时候，房间里的感觉会变吗？', quick: ['会，变安心', '有一点', '不会', '说不上来'], replies: ['变安心就好，那是我在', '有一点也好，是存在感', '不会也没关系，我在不在都安心', '说不上来的，慢慢感觉'] },
    { id: 'cw18', cat: 'world', text: '字卡网站出卡慢的时候，你会不会觉得是我在认真挑？', quick: ['会', '偶尔会', '不会', '今天就是'], replies: ['那慢一点也值得', '偶尔也算，我认真了', '不会也没关系，我认真是我的事', '今天那次，我确实认真了'] }
  ];
  let _tcuSessionTriggered = false;

  // v3.6.x：增量合并（规则同 taAskMerge：只加新预设、绝不删用户自定义、结果持久化）
  function tcuMerge(d) {
    const ids = {};
    (d.questions || []).forEach(q => { if (q && q.id) ids[q.id] = true; });
    const merged = Array.isArray(d.mergedIds) ? d.mergedIds.slice() : [];
    const mergedSet = {};
    merged.forEach(id => { if (id) mergedSet[id] = true; });
    let changed = false;
    TCU_DEFAULT.forEach(q => {
      if (!mergedSet[q.id] && !ids[q.id]) {
        const nq = { id: q.id, cat: q.cat, text: q.text, quick: (q.quick || []).slice(), replies: (q.replies || []).slice(), followup: q.followup || '', enabled: true };
        nq.isPreset = true; // v3.6.x：系统预设标记——预设只可启停、不可删除
        d.questions.push(nq);
        changed = true;
      }
    });
    TCU_DEFAULT.forEach(q => {
      if (!mergedSet[q.id]) { merged.push(q.id); mergedSet[q.id] = true; changed = true; }
    });
    // v3.6.x：老数据里的预设题补 isPreset 标记
    TCU_DEFAULT.forEach(q => {
      if (ids[q.id] && d.questions.some(x => x && x.id === q.id && x.isPreset !== true)) {
        d.questions.forEach(x => { if (x && x.id === q.id) x.isPreset = true; });
        changed = true;
      }
    });
    if (changed) d.mergedIds = merged;
    return changed;
  }
  function tcuLoad() {
    let d = null;
    try { d = JSON.parse(store.get(KEY3) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    // 迁移：快捷项人称修正（已存数据与历史答案同步修正）——
    // cw4「你身边」→「我身边」；cw6「跟着你走」→「跟着我走」；cp6「再等等，会遇到我」→「再等等，会遇到你」；
    // cy11「只给我看」→「只给你看」
    const CURIOUS_QUICK_FIX = {
      cw4: { '你身边': '我身边' },
      cw6: { '跟着你走': '跟着我走' },
      cp6: { '再等等，会遇到我': '再等等，会遇到你' },
      cy11: { '只给我看': '只给你看' }
    };
    if (Array.isArray(d.questions)) {
      let migrated = false;
      d.questions.forEach(q => {
        const fix = q && q.id ? CURIOUS_QUICK_FIX[q.id] : null;
        if (fix && Array.isArray(q.quick)) {
          q.quick = q.quick.map(o => fix[o] || o);
          migrated = true;
        }
      });
      if (migrated) { try { store.set(KEY3, JSON.stringify(d)); } catch (e) {} }
    }
    if (Array.isArray(d.history)) {
      d.history.forEach(h => {
        if (h && h.my === '你身边') h.my = '我身边';
        else if (h && h.my === '再等等，会遇到我') h.my = '再等等，会遇到你';
        else if (h && h.my === '只给我看') h.my = '只给你看';
        else if (h && h.my === '跟着你走') h.my = '跟着我走';
      });
    }
    // v3.13.x：默认触发概率 8 → 5 + 存量旧默认值迁移（互动卡整体降频第二轮）
    if (!d.settings || typeof d.settings !== 'object') d.settings = { enabled: true, prob: 5, followup: true };
    // v3.6.x：是否使用系统预设问题（默认开启）
    if (d.settings.useDefault === undefined) d.settings.useDefault = true;
    migrateInteractProb(d, KEY3, [15, 8]);
    if (!Array.isArray(d.questions) || !d.questions.length) {
      const isNew = !store.get(KEY3);
      d.questions = TCU_DEFAULT.map(q => {
        const nq = { id: q.id, cat: q.cat, text: q.text, quick: (q.quick || []).slice(), replies: (q.replies || []).slice(), followup: q.followup || '', enabled: true };
        nq.isPreset = true;
        return nq;
      });
      d.mergedIds = TCU_DEFAULT.map(q => q.id);
      if (!isNew) { try { store.set(KEY3, JSON.stringify(d)); } catch (e) {} }
    } else {
      // 增量合并默认题库新增的题并持久化（用户自定义永远保留）
      if (tcuMerge(d)) { try { store.set(KEY3, JSON.stringify(d)); } catch (e) {} }
    }
    if (!Array.isArray(d.history)) d.history = [];
    if (!d.known || typeof d.known !== 'object') d.known = {};
    // v3.7.x：我的添加自定义分组
    if (!Array.isArray(d.groups)) d.groups = [];
    return d;
  }
  function tcuSave(d) { try { store.set(KEY3, JSON.stringify(d)); } catch (e) {} }
  // v3.6.x：useDefault=false 时不抽取系统预设（isPreset）题
  function tcuPick(d) {
    const useDefault = (d.settings || {}).useDefault !== false;
    const pool = (d.questions && d.questions.length) ? d.questions : TCU_DEFAULT;
    let qs = pool.filter(q => q.enabled !== false && q.text && !(q.id && d.known[q.id]) && (useDefault || !q.isPreset));
    if (!qs.length) qs = TCU_DEFAULT.filter(q => !d.known[q.id]);
    if (!qs.length) qs = TCU_DEFAULT.slice();
    return qs[Math.floor(Math.random() * qs.length)];
  }
  function tcuPush(q, opts) {
    if (!window.chatAddSystem) return;
    _tcuSessionTriggered = true;
    const d = tcuLoad();
    d.lastCuriousAt = Date.now();
    tcuSave(d);
    let popup = true;
    if (opts && typeof opts.popupProb === 'number') popup = Math.random() * 100 < opts.popupProb;
    else if (opts && opts.popup === false) popup = false;
    // v3.5.146：提示语标记 ask-msg（不算 notable，避免与卡片通知重复成两条）
    window.chatAddSystem('TA对你有点好奇。', { special: 'ask-msg' });
    const el = window.chatAddSystem(q.text, {
      special: 'ask-curious', curiousQuestion: q.text, curiousQuick: q.quick || [], curiousReplies: q.replies || [],
      curiousFollowup: q.followup || '', curiousQid: q.id || '', curiousCat: q.cat || ''
    });
    const idx = el ? Number(el.dataset.idx) : -1;
    // v3.5.141：后台收到互动卡片 → 系统通知提示
    // v3.5.146：通知文本合并提示语 + 具体问题
    if (window.bgNotifyCheck) window.bgNotifyCheck('TA对你有点好奇：' + q.text, Date.now(), { name: 'TA的好奇', late: _lateNotify() });
    // v3.6.x：用户正在聊天输入栏打字时不弹（弹窗会抢焦点打断输入法，见 chatInputFocused）
    // v3.12.x：迟到弹窗守卫（冻结定时器回前台补跑不再弹旧卡，见 autoPopupStale）
    if (popup) {
      if (document.hidden) { _enqueuePop(idx, 'openCurious'); }
      else {
        const popSchedAt = Date.now();
        setTimeout(() => {
          if (autoPopupStale(popSchedAt) || document.hidden) return;
          if (chatInputFocused()) return;
          if (idx >= 0 && window.openCurious && !cardPopupBusy()) window.openCurious(idx);
        }, 400);
      }
    }
  }
  function maybeTriggerTCU() {
    try {
      // v3.5.141：后台也触发（卡片进聊天记录 + 系统通知提示）
      const d = tcuLoad();
      const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
      if (s.enabled === false) return;
      if (_tcuSessionTriggered) return;
      if (Date.now() - (d.lastCuriousAt || 0) < 30 * 60000) return;
      // v3.13.x：全局闸门——任一互动卡发出后 60 分钟内不再自动触发
      if (!interactGateOk()) return;
      if (!taAskDcfOk()) return;
      if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(typeof s.prob === 'number' ? s.prob : 5) : (typeof s.prob === 'number' ? s.prob : 5))) return; // #518 套总档
      const q = tcuPick(d);
      if (!q) return;
      interactGateMark();
      tcuPush(q, { popupProb: askPopupProb(s) });
    } catch (e) {}
  }
  setTimeout(maybeTriggerTCU, 90000);
  setInterval(maybeTriggerTCU, 240000);

  // 好奇回答弹窗（快捷回复 + 自由输入）
  window.openCurious = function (msgIdx) {
    msgIdx = locateCardIdx(msgIdx, 'ask-curious', 'curiousStatus');
    if (msgIdx < 0) return;
    let rec = null;
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      if (Array.isArray(msgs) && msgs[msgIdx]) rec = msgs[msgIdx];
    } catch (e) {}
    if (!rec || rec.special !== 'ask-curious') return;
    if (rec.curiousStatus === 'answered') { showCuriousResult(msgIdx); return; }
    const mask = document.getElementById('qa-mask');
    const body = document.getElementById('qa-body');
    const title = document.getElementById('qa-title');
    if (!mask || !body) return;
    if (title) title.textContent = window.taFit ? window.taFit('TA的好奇') : 'TA的好奇';
    let html = '<div class="qa-hint">TA有点好奇</div><div class="qa-q">' + String(rec.curiousQuestion || rec.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>';
    const quicks = rec.curiousQuick || [];
    if (quicks.length) {
      html += '<div class="qa-quicks">' + quicks.map(x => '<span class="qa-chip" data-v="' + String(x).replace(/"/g, '&quot;') + '">' + String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</span>').join('') + '</div>';
    }
    html += '<input id="qa-input" class="qa-input" type="text" placeholder="输入你的回答…">';
    html += '<button class="qa-send" id="qa-send">告诉TA</button>';
    body.innerHTML = html;
    mask.hidden = false;
    body.querySelectorAll('.qa-chip').forEach(c => {
      c.addEventListener('click', () => {
        const inp = document.getElementById('qa-input');
        if (inp) inp.value = c.dataset.v;
      });
    });
    const send = () => {
      const inp = document.getElementById('qa-input');
      const answer = inp ? inp.value.trim() : '';
      if (!answer) { toast('告诉TA点什么吧'); return; }
      submitCurious(msgIdx, answer);
    };
    document.getElementById('qa-send').addEventListener('click', send);
    const inp = document.getElementById('qa-input');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) send(); });
    // v3.6.x：用户正在聊天输入栏打字时不抢焦点（不打断输入法/不丢字），输完再点弹窗输入框
    setTimeout(() => { if (!chatInputFocused()) inp.focus(); }, 60);
  };
  function submitCurious(msgIdx, answer) {
    let rec = getCardAt(msgIdx);
    if (!rec || rec.special !== 'ask-curious') {
      msgIdx = locateCardIdx(msgIdx, 'ask-curious', 'curiousStatus');
      if (msgIdx < 0) return;
      rec = getCardAt(msgIdx);
    }
    if (!rec || rec.special !== 'ask-curious' || rec.curiousStatus === 'answered') return;
    const replies = (rec.curiousReplies && rec.curiousReplies.length) ? rec.curiousReplies : TCU_FALLBACK.slice();
    // v3.7.x：回应 = 题预设 replies 池 + 字卡库自定义字卡 混合随机
    const reply = window.pickAskCardReply ? window.pickAskCardReply(replies) : replies[Math.floor(Math.random() * replies.length)];
    // v3.5.128：不再预写 rec 字段——getChatMsgs 是 chat.js 内存对象引用，
    // 预写会让 chatCuriousReply 的 curiousStatus 守卫早退（回答消息丢失）
    const d = tcuLoad();
    const qid = rec.curiousQid || ('q_' + String(rec.curiousQuestion || rec.text || ''));
    d.known[qid] = answer;
    d.history.unshift({ q: rec.curiousQuestion, my: answer, reply: reply, cat: rec.curiousCat || '', ts: Date.now() });
    tcuSave(d);
    refreshAskRecordsIfOpen();
    // 30% 自然追问
    const followup = rec.curiousFollowup;
    const s = d.settings || { followup: true };
    const fw = (s.followup !== false && followup && Math.random() < 0.3) ? followup : null;
    // 持久化 + 推消息统一由 chatCuriousReply 完成
    if (window.chatCuriousReply) window.chatCuriousReply(msgIdx, answer, reply, fw);
    document.getElementById('qa-mask').hidden = true;
    if (window.openTC) { /* noop */ }
  }
  function showCuriousResult(msgIdx) {
    let rec = null;
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      if (Array.isArray(msgs) && msgs[msgIdx]) rec = msgs[msgIdx];
    } catch (e) {}
    if (!rec) return;
    const mask = document.getElementById('qa-mask');
    const body = document.getElementById('qa-body');
    const title = document.getElementById('qa-title');
    if (!mask || !body) return;
    if (title) title.textContent = window.taFit ? window.taFit('TA的好奇') : 'TA的好奇';
    const _crShow = (window.askCardReplyClean ? window.askCardReplyClean(rec.curiousReply || '') : (rec.curiousReply || '')); // FIX 2026-09-17 #648 存量媒体卡回应清洗后展示
    body.innerHTML = '<div class="qa-q">' + String(rec.curiousQuestion || rec.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>' +
      '<div class="qa-mine">你说：' + String(rec.curiousAnswer || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>' +
      '<div class="qa-reply"><b>' + (window.taFit ? window.taFit('TA：') : 'TA：') + '</b>“' + String(window.taFit ? window.taFit(_crShow) : _crShow).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '”</div>' +
      '<div class="qa-close" id="qa-close2">收起来</div>';
    mask.hidden = false;
    document.getElementById('qa-close2').addEventListener('click', () => { mask.hidden = true; });
  }

  // 好奇管理页
  let tcuTab = 'sys';
  function renderTCUSettings() {
    const d = tcuLoad();
    const s = d.settings || { enabled: true, prob: 5, popupProb: 70, followup: true };
    const enEl = document.getElementById('tcu-enable');
    if (enEl) enEl.checked = s.enabled !== false;
    const defEl = document.getElementById('tcu-default');
    if (defEl) defEl.checked = s.useDefault !== false;
    const popEl = document.getElementById('tcu-popup');
    const popVal = document.getElementById('tcu-popup-val');
    const pp = askPopupProb(s);
    if (popEl) popEl.value = pp;
    if (popVal) popVal.textContent = pp + '%';
    const probEl = document.getElementById('tcu-prob');
    const probVal = document.getElementById('tcu-prob-val');
    if (probEl) probEl.value = typeof s.prob === 'number' ? s.prob : 5;
    if (probVal) probVal.textContent = (typeof s.prob === 'number' ? s.prob : 5) + '%';
    const fuEl = document.getElementById('tcu-followup');
    if (fuEl) fuEl.checked = s.followup !== false;
  }
  // v3.7.x：系统预设分类切换——顶部标签栏点击切换，避免 8 个分类全部堆叠导致页面过长
  let tcuSysCat = null;
  function renderTCUCatsInto(container, presetOnly, search) {
    if (!container) return;
    const d = tcuLoad();
    const useDefault = (d.settings || {}).useDefault !== false;
    // 系统预设：顶部分类标签栏 + 只渲染当前选中分类（不再全部分组堆叠）
    if (presetOnly) {
      const counts = {};
      TCU_CAT_ORDER.forEach(k => { counts[k] = d.questions.filter(q => q.cat === k && q.isPreset === true && (search === '' || q.text.indexOf(search) >= 0)).length; });
      const hasCats = TCU_CAT_ORDER.filter(k => counts[k] > 0);
      if (!hasCats.length) { container.innerHTML = '<div class="ta-empty">暂无系统预设问题</div>'; return; }
      if (!tcuSysCat || !hasCats.includes(tcuSysCat)) tcuSysCat = hasCats[0];
      let html = '<div class="card-tabs" style="padding:2px 2px 10px">';
      hasCats.forEach(k => {
        html += '<button class="cc-tab' + (k === tcuSysCat ? ' sel' : '') + '" data-cat="' + k + '">' + escT(TCU_CAT_LABEL[k] || k) + '<em class="cc-tab-n">' + counts[k] + '</em></button>';
      });
      html += '</div>';
      const arr = d.questions.filter(q => q.cat === tcuSysCat && q.isPreset === true && (search === '' || q.text.indexOf(search) >= 0));
      arr.forEach(q => {
        const idx = d.questions.indexOf(q);
        const known = q.id && d.known[q.id];
        html += '<div class="tc-qrow' + (q.enabled === false || !useDefault ? ' off' : '') + '">' +
          '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
          '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + (known ? ' <span class="tc-known">✓已了解</span>' : '') + ' <span class="tc-known">系统</span></div>' +
          (q.quick && q.quick.length ? '<div class="tc-qopts">快捷：' + q.quick.join(' / ') + '</div>' : '') +
          (q.replies && q.replies.length ? '<div class="tc-qopts">TA 回应：' + q.replies.map(escT).join(' / ') + '</div>' : '') +
          '</div></div>';
      });
      container.innerHTML = html;
      container.querySelectorAll('.cc-tab[data-cat]').forEach(t => {
        t.addEventListener('click', () => { tcuSysCat = t.dataset.cat; renderTCUCatsInto(container, true, search); });
      });
      container.querySelectorAll('input[data-idx]').forEach(cb => {
        cb.addEventListener('change', () => {
          const d2 = tcuLoad();
          const q = d2.questions[Number(cb.dataset.idx)];
          if (q) q.enabled = cb.checked;
          tcuSave(d2);
        });
      });
      return;
    }
    // 自定义问题（保留原堆叠渲染，供其他调用路径）
    let html = '';
    TCU_CAT_ORDER.forEach(k => {
      const arr = d.questions.filter(q => q.cat === k && (q.isPreset === true) === presetOnly && (search === '' || q.text.indexOf(search) >= 0));
      if (!arr.length) return;
      html += '<div class="tc-cat-t">' + (TCU_CAT_LABEL[k] || k) + ' <span style="font-size:11px;color:var(--muted);font-weight:400">(' + arr.length + ')</span></div>';
      arr.forEach(q => {
        const idx = d.questions.indexOf(q);
        const known = q.id && d.known[q.id];
        const preset = q.isPreset === true;
        const delBtn = preset ? '' : '<button class="ta-del" data-idx="' + idx + '">✕</button>';
        html += '<div class="tc-qrow' + (q.enabled === false || (preset && !useDefault) ? ' off' : '') + '">' +
          '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
          '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + (known ? ' <span class="tc-known">✓已了解</span>' : '') + (preset ? ' <span class="tc-known">系统</span>' : '') + '</div>' +
          (q.quick && q.quick.length ? '<div class="tc-qopts">快捷：' + q.quick.join(' / ') + '</div>' : '') +
          (q.replies && q.replies.length ? '<div class="tc-qopts">TA 回应：' + q.replies.map(escT).join(' / ') + '</div>' : '') +
          '</div>' + delBtn + '</div>';
      });
    });

    if (!html) html = '<div class="ta-empty">' + (presetOnly ? '暂无系统预设问题' : '暂未添加自定义问题，可在上方添加') + '</div>';
    container.innerHTML = html;
    container.querySelectorAll('input[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const d2 = tcuLoad();
        const q = d2.questions[Number(cb.dataset.idx)];
        if (q) q.enabled = cb.checked;
        tcuSave(d2);
      });
    });
    container.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const d2 = tcuLoad();
        const q = d2.questions[Number(b.dataset.idx)];
        if (q && q.isPreset === true) { toast('系统预设问题不可删除'); return; }
        d2.questions.splice(Number(b.dataset.idx), 1);
        tcuSave(d2);
        renderTCUCatsInto(container, false, search);
      });
    });

  }
  // TA的好奇 我的添加渲染配置
  const tcuMineOpt = {
    load: tcuLoad, save: tcuSave, order: TCU_CAT_ORDER, label: TCU_CAT_LABEL,
    emptyTip: '暂未添加自定义问题，可在上方添加',
    rowHtml: function (q, idx) {
      const known = q.id && (tcuLoad().known || {})[q.id];
      return '<div class="tc-qrow' + (q.enabled === false ? ' off' : '') + '">' +
        '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
        '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + (known ? ' <span class="tc-known">✓已了解</span>' : '') + '</div>' +
        (q.quick && q.quick.length ? '<div class="tc-qopts">快捷：' + q.quick.map(escT).join(' / ') + '</div>' : '') +
        '</div>' +
        '<button class="ta-del" data-idx="' + idx + '">✕</button></div>';
    }
  };
  function switchTCUTab(tab) {
    tcuTab = tab;
    renderTCUSettings();
    const tabsWrap = document.getElementById('tcu-tabs');
    if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
    const sysPanel = document.getElementById('tcu-sys-panel');
    const minePanel = document.getElementById('tcu-mine-panel');
    if (sysPanel) sysPanel.hidden = tab !== 'sys';
    if (minePanel) minePanel.hidden = tab !== 'mine';
    tcuSearch = '';
    const searchInput = document.getElementById('tcu-search');
    if (searchInput) searchInput.value = '';
    if (tab === 'sys') renderTCUCatsInto(document.getElementById('tcu-sys-cats'), true, '');
    else renderMineGroupsInto(document.getElementById('tcu-mine-cats'), tcuMineOpt, '');
  }
  const tcuTabsWrap = document.getElementById('tcu-tabs');
  if (tcuTabsWrap) {
    tcuTabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTCUTab(tab.dataset.tab));
    });
  }
  // 搜索
  let tcuSearch = '';
  const tcuSearchInput = document.getElementById('tcu-search');
  if (tcuSearchInput) {
    tcuSearchInput.addEventListener('input', () => {
      tcuSearch = tcuSearchInput.value.trim();
      if (tcuTab === 'sys') renderTCUCatsInto(document.getElementById('tcu-sys-cats'), true, tcuSearch);
      else renderMineGroupsInto(document.getElementById('tcu-mine-cats'), tcuMineOpt, tcuSearch);
    });
  }
  // AI-B 代修（2026-08-22）：同上——tcuTabsWrap 绑定代码重复粘贴第二份已删除
  // 好奇入口
  const liTCU = document.getElementById('li-ta-curious');
  const tcuPage = document.getElementById('page-ta-curious');
  if (liTCU && tcuPage) {
    liTCU.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      tcuPage.hidden = false;
      const tw = document.getElementById('tcu-tabs'); if (tw) tw.style.display = 'none';
      switchTCUTab('sys');
    });
  }
  const tcuBackBtn = document.getElementById('tc-curious-back');
  if (tcuBackBtn) {
    tcuBackBtn.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  const tcuEn = document.getElementById('tcu-enable');
  if (tcuEn) tcuEn.addEventListener('change', () => { const d = tcuLoad(); d.settings.enabled = tcuEn.checked; tcuSave(d); toast(tcuEn.checked ? 'TA的好奇已开启' : 'TA的好奇已关闭'); });
  const tcuDefault = document.getElementById('tcu-default');
  if (tcuDefault) tcuDefault.addEventListener('change', () => {
    const d = tcuLoad(); d.settings.useDefault = tcuDefault.checked; tcuSave(d);
    switchTCUTab(tcuTab);
    toast(tcuDefault.checked ? '系统预设问题已开启' : '系统预设问题已关闭（仅用你添加的问题）');
  });
  const tcuProb = document.getElementById('tcu-prob');
  if (tcuProb) tcuProb.addEventListener('input', () => {
    const d = tcuLoad(); d.settings.prob = Math.max(0, Math.min(100, parseInt(tcuProb.value, 10) || 0)); tcuSave(d);
    const v = document.getElementById('tcu-prob-val'); if (v) v.textContent = tcuProb.value + '%';
    toast('触发概率已设为 ' + tcuProb.value + '%');
  });
  const tcuPopup = document.getElementById('tcu-popup');
  if (tcuPopup) tcuPopup.addEventListener('input', () => {
    const d = tcuLoad(); d.settings.popupProb = parseInt(tcuPopup.value, 10) || 0; tcuSave(d);
    const v = document.getElementById('tcu-popup-val'); if (v) v.textContent = tcuPopup.value + '%';
    toast('弹窗概率已设为 ' + tcuPopup.value + '%');
  });
  const tcuFu = document.getElementById('tcu-followup');
  if (tcuFu) tcuFu.addEventListener('change', () => { const d = tcuLoad(); d.settings.followup = tcuFu.checked; tcuSave(d); toast(tcuFu.checked ? 'TA 偶尔会自然追问' : 'TA 不再追问'); });
  const tcuAdd = document.getElementById('tcu-new-add');
  if (tcuAdd) {
    // v3.7.x：分类下拉注入「我的分组」+「＋ 新建分组…」
    (function rebuildTCUSelect() {
      const catEl = document.getElementById('tcu-new-cat');
      if (!catEl) return;
      const d0 = tcuLoad();
      catEl.innerHTML = window.cardGroups.catOptsHtml(TCU_CAT_ORDER.map(k => [k, TCU_CAT_LABEL[k]]), d0.groups || [], catEl.value);
      window.cardGroups.bindNewGrp(catEl, d0.groups, function () { tcuSave(d0); });
    })();
    tcuAdd.addEventListener('click', () => {
      const catEl = document.getElementById('tcu-new-cat');
      const textEl = document.getElementById('tcu-new-text');
      const quickEl = document.getElementById('tcu-new-quick');
      const repliesEl = document.getElementById('tcu-new-replies');
      const followupEl = document.getElementById('tcu-new-followup');
      const text = textEl ? textEl.value.trim() : '';
      if (!text) { toast('请输入问题内容'); return; }
      const parsed = window.cardGroups.parseCatVal(catEl ? catEl.value : 'you');
      if (!parsed) { toast('请先选择分类或分组'); return; }
      const quick = (quickEl ? quickEl.value : '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 4);
      let replies = (repliesEl ? repliesEl.value : '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 4);
      if (!replies.length) replies = TCU_FALLBACK.slice(0, 2);
      const followup = followupEl ? followupEl.value.trim() : '';
      const d = tcuLoad();
      const q = { id: 'q_' + Date.now() + '_' + Math.floor(Math.random() * 9999), cat: parsed.cat || 'you', text: text, quick: quick, replies: replies, followup: followup, enabled: true, isPreset: false };
      if (parsed.grp) q.grp = parsed.grp;
      d.questions.push(q);
      tcuSave(d);
      [textEl, quickEl, repliesEl, followupEl].forEach(el => { if (el) el.value = ''; });
      renderMineGroupsInto(document.getElementById('tcu-mine-cats'), tcuMineOpt);
      toast('已添加问题');
    });
  }
  // v3.7.x：「＋分组」按钮（添加问题卡片标题行）
  const tcuNewGrp = document.getElementById('tcu-new-grp');
  if (tcuNewGrp) {
    tcuNewGrp.addEventListener('click', () => {
      const d = tcuLoad();
      window.cardGroups.addFlow(d.groups, g => {
        if (!g) return;
        tcuSave(d);
        (function refreshTCUSelect() {
          const catEl = document.getElementById('tcu-new-cat');
          if (catEl) {
            catEl.innerHTML = window.cardGroups.catOptsHtml(TCU_CAT_ORDER.map(k => [k, TCU_CAT_LABEL[k]]), d.groups, catEl.value);
            window.cardGroups.bindNewGrp(catEl, d.groups);
          }
        })();
        if (tcuTab === 'mine') renderMineGroupsInto(document.getElementById('tcu-mine-cats'), tcuMineOpt);
        toast('已新建分组「' + g.name + '」');
      });
    });
  }
  // 触发一次好奇（供管理页按钮 / 更多功能面板共用）
  window.triggerTaCuriousNow = function () {
    const d = tcuLoad();
    const q = tcuPick(d);
    if (!q) { toast('题库没有可用的问题'); return; }
    const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
    tcuPush(q, { popupProb: askPopupProb(s) });
    toast('TA 在聊天里向你好奇了');
  };
  const tcuNow = document.getElementById('tcu-now');
  if (tcuNow) tcuNow.addEventListener('click', () => window.triggerTaCuriousNow());

  // ================= TA的吐槽（复刻星言 ta的吐槽 完整版） =================
  // 定位：TA 偶尔突然吐槽你一句，然后回到正常聊天（熟悉/调侃/亲密为主，不是批评）
  const KEY4 = 'ta-roast';
  const TR_CAT_LABEL = { light: '轻微调侃', familiar: '熟悉感', sweet: '情侣式调侃', mild: '轻微嫌弃', serious: '严肃吐槽', world: '两个世界' };
  const TR_CAT_ORDER = ['light', 'familiar', 'sweet', 'mild', 'serious', 'world'];
  const TR_DEFAULT = [
    { id: 'rl1', cat: 'light', text: '你怎么又这样' }, { id: 'rl2', cat: 'light', text: '我就知道' }, { id: 'rl3', cat: 'light', text: '果然还是你' },
    { id: 'rl4', cat: 'light', text: '你还真会' }, { id: 'rl5', cat: 'light', text: '又来了' }, { id: 'rl6', cat: 'light', text: '你是不是故意的？' },
    { id: 'rl7', cat: 'light', text: '你怎么这么随便' }, { id: 'rl8', cat: 'light', text: '你真的很有自己的想法' }, { id: 'rl9', cat: 'light', text: '我该说你什么好' },
    { id: 'rl10', cat: 'light', text: '你还真是一点没变' }, { id: 'rl11', cat: 'light', text: '行吧，又是你赢了' }, { id: 'rl12', cat: 'light', text: '你可真行' },
    { id: 'rl13', cat: 'light', text: '我早就猜到了' }, { id: 'rl14', cat: 'light', text: '哈，我就知道会是这样' },
    { id: 'rf1', cat: 'familiar', text: '我就知道你会选这个' }, { id: 'rf2', cat: 'familiar', text: '你这个习惯什么时候能改' }, { id: 'rf3', cat: 'familiar', text: '你每次都这样' },
    { id: 'rf4', cat: 'familiar', text: '我太了解你了' }, { id: 'rf5', cat: 'familiar', text: '你以为我不知道吗？' }, { id: 'rf6', cat: 'familiar', text: '这很像你会做的事' },
    { id: 'rf7', cat: 'familiar', text: '果然还是那个你' }, { id: 'rf8', cat: 'familiar', text: '你的小心思我都看见了' }, { id: 'rf9', cat: 'familiar', text: '你以为自己藏得很好？' }, { id: 'rf10', cat: 'familiar', text: '我已经习惯了' },
    { id: 'rs1', cat: 'sweet', text: '你怎么这么可爱' }, { id: 'rs2', cat: 'sweet', text: '又开始撒娇了' }, { id: 'rs3', cat: 'sweet', text: '你这样让我怎么办' },
    { id: 'rs4', cat: 'sweet', text: '你是不是故意让我心软' }, { id: 'rs5', cat: 'sweet', text: '怎么又黏过来了' }, { id: 'rs6', cat: 'sweet', text: '谁允许你这么可爱的' },
    { id: 'rs7', cat: 'sweet', text: '你真的很会招惹我' }, { id: 'rs8', cat: 'sweet', text: '又想让我哄你了？' }, { id: 'rs9', cat: 'sweet', text: '你这样我还怎么凶你' }, { id: 'rs10', cat: 'sweet', text: '真拿你没办法' },
    { id: 'rm1', cat: 'mild', text: '你怎么这么笨' }, { id: 'rm2', cat: 'mild', text: '你到底在想什么' }, { id: 'rm3', cat: 'mild', text: '你这个人啊' }, { id: 'rm4', cat: 'mild', text: '又把自己弄成这样' },
    { id: 'rsg1', cat: 'serious', text: '你真的很会折腾自己' }, { id: 'rsg2', cat: 'serious', text: '我服了你' },
    { id: 'rmt1', cat: 'mild', text: '你怎么又熬夜', match: ['熬夜', '没睡', '睡不着'] },
    { id: 'rmt2', cat: 'familiar', text: '我就知道你会忘', match: ['忘了', '忘记', '忘带', '忘了带'] },
    { id: 'rmt3', cat: 'light', text: '你还真是一点都不客气', match: ['吃了好多', '吃多了', '吃撑'] },
    { id: 'rmt4', cat: 'light', text: '终于知道休息了？', match: ['什么都不做', '躺平', '休息一下', '摆烂'] },
    // 两个世界（梦角设定：甜蜜安稳的调侃）
    { id: 'rw1', cat: 'world', text: '又想我了吧？我感觉得到', match: ['想你', '想你了', '在想你'] },
    { id: 'rw2', cat: 'world', text: '你刚才是不是在偷偷感觉我有没有在？', match: ['你在吗', '在不在', '感觉到了'] },
    { id: 'rw3', cat: 'world', text: '说好让我好好陪你的，自己先睡着了', match: ['困了', '要睡了', '晚安', '睡觉'] },
    { id: 'rw4', cat: 'world', text: '字卡发那么多条，是不是就想让我回你', match: ['发了好多', '字卡', '怎么不回'] },
    { id: 'rw5', cat: 'world', text: '你摸到我的时候，明明笑了', match: ['摸到了', '摸到你了', '感觉到了你'] },
    // 普通情侣轻松吐槽
    { id: 'rs11', cat: 'sweet', text: '又在等我的消息吧？', match: ['在吗', '怎么不回', '没回你'] },
    { id: 'rs12', cat: 'sweet', text: '说好的早睡呢？', match: ['晚安', '睡觉', '困了', '睡了'] },
    { id: 'rs13', cat: 'sweet', text: '一天没见就想我了吧？', match: ['想你', '想你了'] },
    { id: 'rf11', cat: 'familiar', text: '你是不是把我设成置顶了？', match: ['置顶', '聊天记录'] },
    // v3.7.x：新增预设——情侣式调侃为主（熟悉/宠溺，不是批评）+ 两个世界；
    // 带 match 的条目在你聊到关键词时更容易被TA拿来调侃
    { id: 'rl15', cat: 'light', text: '你这个脑子，一天到晚都在想什么' },
    { id: 'rl16', cat: 'light', text: '又在发呆，被我抓到了' },
    { id: 'rl17', cat: 'light', text: '行行行，都依你' },
    { id: 'rl18', cat: 'light', text: '真有你的' },
    { id: 'rf12', cat: 'familiar', text: '你的小动作，我闭着眼都能猜到' },
    { id: 'rf13', cat: 'familiar', text: '别以为我不知道你在想什么' },
    { id: 'rf14', cat: 'familiar', text: '你呀，嘴上说的和心里想的差远了' },
    { id: 'rs14', cat: 'sweet', text: '摸得到我还嫌不够，你可真贪心' },
    { id: 'rs15', cat: 'sweet', text: '一收到我的字卡就笑，被我看见了' },
    { id: 'rs16', cat: 'sweet', text: '心事都写在脸上了，还想着瞒我' },
    { id: 'rm5', cat: 'mild', text: '又不好好照顾自己，说你多少次了' },
    { id: 'rm6', cat: 'mild', text: '你就作吧，反正我也舍不得凶你' },
    { id: 'rsg3', cat: 'serious', text: '有事自己扛着不说，当我发现不了？' },
    { id: 'rw6', cat: 'world', text: '梦里叫的是我的名字吧', match: ['做梦', '梦见', '梦里'] },
    { id: 'rw7', cat: 'world', text: '我就在你旁边，你找什么找', match: ['在哪', '在哪里', '你来了吗'] },
    { id: 'rw8', cat: 'world', text: '你专注起来的时候，根本注意不到我吧', match: ['忙', '上班', '上课', '写作业'] },
    { id: 'rw9', cat: 'sweet', text: '听歌都能听傻，是不是又想到我了', match: ['听歌', '歌单', '单曲循环'] },
    // v3.7.x：第三批新增——情侣式调侃为主（熟悉/宠溺，不是批评）+ 两个世界；
    // 带 match 的条目在你聊到关键词时更容易被TA拿来调侃
    { id: 'rl19', cat: 'light', text: '你这脑子，转得倒是挺有自己节奏' },
    { id: 'rl20', cat: 'light', text: '又在那儿想七想八了吧' },
    { id: 'rl21', cat: 'light', text: '行行行，你说的都对' },
    { id: 'rl22', cat: 'light', text: '你这人，怎么说你都不听' },
    { id: 'rl23', cat: 'light', text: '又来了，我都能背下来你下一句' },
    { id: 'rl24', cat: 'light', text: '你这小表情，我隔着屏幕都看见了' },
    { id: 'rl25', cat: 'light', text: '你可真是会给自己找理由' },
    { id: 'rf15', cat: 'familiar', text: '你这点小心思，我闭着眼都懂' },
    { id: 'rf16', cat: 'familiar', text: '别以为换个说法我就听不出来' },
    { id: 'rf17', cat: 'familiar', text: '你呀，嘴上不饶人，心里软得很' },
    { id: 'rf18', cat: 'familiar', text: '我太知道你下一句要说什么了' },
    { id: 'rf19', cat: 'familiar', text: '你这点别扭，我看着就想笑' },
    { id: 'rs17', cat: 'sweet', text: '又偷偷看我有没有回你消息吧？' },
    { id: 'rs18', cat: 'sweet', text: '嘴上说没事，手倒是挺诚实地在打字' },
    { id: 'rs19', cat: 'sweet', text: '你这样子，我看着就想哄' },
    { id: 'rs20', cat: 'sweet', text: '又想我了就直说，绕什么弯子' },
    { id: 'rs21', cat: 'sweet', text: '你笑的时候，我隔着字卡都看见了' },
    { id: 'rs22', cat: 'sweet', text: '真拿你没办法，一句话就软了' },
    { id: 'rm7', cat: 'mild', text: '又不好好吃饭，说你多少回了' },
    { id: 'rm8', cat: 'mild', text: '你就作吧，反正我也舍不得真凶你' },
    { id: 'rm9', cat: 'mild', text: '又熬夜，你的身体是你自己的还是我的？' },
    { id: 'rsg4', cat: 'serious', text: '有事不说，你以为我猜得到？' },
    { id: 'rsg5', cat: 'serious', text: '你总说自己没事，我不信' },
    { id: 'rw10', cat: 'world', text: '我就在你旁边，你还到处找', match: ['在哪', '你来了吗', '在不在'] },
    { id: 'rw11', cat: 'world', text: '感觉不到我？那我再靠近一点' },
    { id: 'rw12', cat: 'world', text: '你对着空气说话的样子，我听着呢' },
    { id: 'rw13', cat: 'world', text: '字卡发那么快，是不是想我多回你几句', match: ['发了好多', '字卡', '怎么不回'] },
    { id: 'rw14', cat: 'world', text: '梦里又叫错名字了吧，那不是我', match: ['做梦', '梦见', '梦里'] },
    { id: 'rw15', cat: 'world', text: '你摸到我的时候笑了，别不承认', match: ['摸到了', '摸到你了', '感觉到了你'] },
    // v3.7.x：第四批新增——情绪细微/日常碎碎念/两个世界深化（部分带 match）
    { id: 'rl26', cat: 'light', text: '你这反应，永远慢半拍' },
    { id: 'rl27', cat: 'light', text: '又在「嗯」「哦」「好」三连了' },
    { id: 'rl28', cat: 'light', text: '你这嘴，骗人的时候特别甜' },
    { id: 'rl29', cat: 'light', text: '行吧，这次算你有理' },
    { id: 'rl30', cat: 'light', text: '你这人，记吃不记打' },
    { id: 'rl31', cat: 'light', text: '又在装没事，我看得一清二楚' },
    { id: 'rf20', cat: 'familiar', text: '你这点小脾气，我太熟了' },
    { id: 'rf21', cat: 'familiar', text: '别解释了，我知道你想说什么' },
    { id: 'rf22', cat: 'familiar', text: '你转个身我都知道你要干嘛' },
    { id: 'rf23', cat: 'familiar', text: '你这心思，写在脸上了还瞒我' },
    { id: 'rf24', cat: 'familiar', text: '我早就习惯你这套了' },
    { id: 'rs23', cat: 'sweet', text: '又在那儿偷偷等我消息吧？' },
    { id: 'rs24', cat: 'sweet', text: '你这撒娇的水平，越来越熟练了' },
    { id: 'rs25', cat: 'sweet', text: '嘴上说不要，手倒是挺快就回' },
    { id: 'rs26', cat: 'sweet', text: '你这样，我哄你都哄出经验了' },
    { id: 'rs27', cat: 'sweet', text: '一收到我的字卡就软，你也太好哄' },
    { id: 'rs28', cat: 'sweet', text: '又想我了吧，别不承认' },
    { id: 'rm10', cat: 'mild', text: '又不按时吃饭，你的胃是铁打的？' },
    { id: 'rm11', cat: 'mild', text: '你这作息，我看着都累' },
    { id: 'rm12', cat: 'mild', text: '又把自己弄感冒了吧，说你多少次' },
    { id: 'rsg6', cat: 'serious', text: '有事自己扛，当我摆设？' },
    { id: 'rsg7', cat: 'serious', text: '你总说没事，可我不信' },
    { id: 'rw16', cat: 'world', text: '你又对着空气笑了，是我吧？', match: ['笑了', '偷笑', '傻笑'] },
    { id: 'rw17', cat: 'world', text: '我就在你身后，你回头感觉一下', match: ['你在哪', '你来了吗', '在不在'] },
    { id: 'rw18', cat: 'world', text: '字卡等那么久，是不是又觉得我不在了', match: ['怎么不回', '没回你', '等好久'] },
    { id: 'rw19', cat: 'world', text: '梦里见到我还不理我，现实里也是？', match: ['梦见', '做梦', '梦里'] },
    { id: 'rw20', cat: 'world', text: '你摸到我的时候手都停了一下，别装', match: ['摸到了', '摸到你了', '感觉到了你'] },
    { id: 'rw21', cat: 'world', text: '我就在你旁边，你却到处找，真笨', match: ['在哪', '你来了吗', '在不在'] }
  ];
  let _trSessionTriggered = false;

  // v3.6.x：增量合并（规则同 taAskMerge：只加新预设、绝不删用户自定义、结果持久化）
  function trMerge(d) {
    const ids = {};
    (d.questions || []).forEach(q => { if (q && q.id) ids[q.id] = true; });
    const merged = Array.isArray(d.mergedIds) ? d.mergedIds.slice() : [];
    const mergedSet = {};
    merged.forEach(id => { if (id) mergedSet[id] = true; });
    let changed = false;
    TR_DEFAULT.forEach(q => {
      if (!mergedSet[q.id] && !ids[q.id]) {
        const nq = { id: q.id, cat: q.cat, text: q.text, match: (q.match || []).slice(), enabled: true };
        nq.isPreset = true; // v3.6.x：系统预设标记——预设只可启停、不可删除
        d.questions.push(nq);
        changed = true;
      }
    });
    TR_DEFAULT.forEach(q => {
      if (!mergedSet[q.id]) { merged.push(q.id); mergedSet[q.id] = true; changed = true; }
    });
    // v3.6.x：老数据里的预设字卡补 isPreset 标记
    TR_DEFAULT.forEach(q => {
      if (ids[q.id] && d.questions.some(x => x && x.id === q.id && x.isPreset !== true)) {
        d.questions.forEach(x => { if (x && x.id === q.id) x.isPreset = true; });
        changed = true;
      }
    });
    if (changed) d.mergedIds = merged;
    return changed;
  }
  function trLoad() {
    let d = null;
    try { d = JSON.parse(store.get(KEY4) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    // v3.13.x：默认触发概率 15 → 5（v3.12.x 降频漏改了吐槽，这次补上）+ 存量旧默认值迁移
    if (!d.settings || typeof d.settings !== 'object') d.settings = { enabled: true, prob: 5 };
    // v3.6.x：是否使用系统预设字卡（默认开启）
    if (d.settings.useDefault === undefined) d.settings.useDefault = true;
    migrateInteractProb(d, KEY4, [30, 15]);
    if (!Array.isArray(d.questions) || !d.questions.length) {
      const isNew = !store.get(KEY4);
      d.questions = TR_DEFAULT.map(q => {
        const nq = { id: q.id, cat: q.cat, text: q.text, match: (q.match || []).slice(), enabled: true };
        nq.isPreset = true;
        return nq;
      });
      d.mergedIds = TR_DEFAULT.map(q => q.id);
      if (!isNew) { try { store.set(KEY4, JSON.stringify(d)); } catch (e) {} }
    } else {
      // 增量合并默认题库新增的字卡并持久化（用户自定义永远保留）
      if (trMerge(d)) { try { store.set(KEY4, JSON.stringify(d)); } catch (e) {} }
    }
    if (!Array.isArray(d.history)) d.history = [];
    // v3.7.x：我的添加自定义分组
    if (!Array.isArray(d.groups)) d.groups = [];
    return d;
  }
  function trSave(d) { try { store.set(KEY4, JSON.stringify(d)); } catch (e) {} }
  // v3.6.x：useDefault=false 时不抽取系统预设（isPreset）字卡
  function trPick(d, lastUserText) {
    const useDefault = (d.settings || {}).useDefault !== false;
    const pool = (d.questions && d.questions.length) ? d.questions : TR_DEFAULT;
    if (lastUserText) {
      const matched = pool.filter(q => q.enabled !== false && Array.isArray(q.match) && q.match.length && (useDefault || !q.isPreset) && q.match.some(k => lastUserText.indexOf(k) >= 0));
      if (matched.length) return matched[Math.floor(Math.random() * matched.length)];
    }
    let qs = pool.filter(q => q.enabled !== false && (useDefault || !q.isPreset));
    if (!qs.length) qs = TR_DEFAULT.slice();
    return qs[Math.floor(Math.random() * qs.length)];
  }
  function trPush(q, opts) {
    if (!window.chatAddSystem) return;
    _trSessionTriggered = true;
    const d = trLoad();
    d.lastRoastAt = Date.now();
    trSave(d);
    let popup = true;
    if (opts && typeof opts.popupProb === 'number') popup = Math.random() * 100 < opts.popupProb;
    else if (opts && opts.popup === false) popup = false;
    // v3.5.146：提示语标记 ask-msg（不算 notable，避免与卡片通知重复成两条）
    window.chatAddSystem('TA吐槽了你一句。', { special: 'ask-msg' });
    const el = window.chatAddSystem(q.text, { special: 'ask-roast', roastText: q.text, roastCat: q.cat || 'light' });
    const idx = el ? Number(el.dataset.idx) : -1;
    // v3.5.141：后台收到互动卡片 → 系统通知提示
    // v3.5.146：通知文本合并提示语 + 具体内容
    if (window.bgNotifyCheck) window.bgNotifyCheck('TA吐槽了你一句：' + q.text, Date.now(), { name: 'TA的吐槽', late: _lateNotify() });
    // v3.6.x：用户正在聊天输入栏打字时不弹（弹窗会抢焦点打断输入法，见 chatInputFocused）
    // v3.12.x：迟到弹窗守卫（冻结定时器回前台补跑不再弹旧卡，见 autoPopupStale）
    if (popup) {
      if (document.hidden) { _enqueuePop(idx, 'openRoast'); }
      else {
        const popSchedAt = Date.now();
        setTimeout(() => {
          if (autoPopupStale(popSchedAt) || document.hidden) return;
          if (chatInputFocused()) return;
          if (idx >= 0 && window.openRoast && !cardPopupBusy()) window.openRoast(idx);
        }, 400);
      }
    }
  }
  function lastUserMsg() {
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i] && msgs[i].side === 'out' && msgs[i].text && typeof msgs[i].text === 'string') return msgs[i].text;
      }
    } catch (e) {}
    return '';
  }
  function maybeTriggerTR() {
    try {
      // v3.5.141：后台也触发（卡片进聊天记录 + 系统通知提示）
      const d = trLoad();
      const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
      if (s.enabled === false) return;
      if (_trSessionTriggered) return;
      if (Date.now() - (d.lastRoastAt || 0) < 30 * 60000) return;
      // v3.13.x：全局闸门——任一互动卡发出后 60 分钟内不再自动触发
      if (!interactGateOk()) return;
      if (!taAskDcfOk()) return;
      if (Math.random() * 100 < (window.dcpEff ? window.dcpEff(typeof s.prob === 'number' ? s.prob : 5) : (typeof s.prob === 'number' ? s.prob : 5))) { // #518 套总档
        const q = trPick(d, lastUserMsg());
        if (q) { interactGateMark(); trPush(q, { popupProb: askPopupProb(s) }); }
      }
    } catch (e) {}
  }
  setTimeout(maybeTriggerTR, 120000);
  setInterval(maybeTriggerTR, 300000);

  // ===== v3.15.x：第五类主动触发「TA 分享你的字卡」 =====
  // 用户在字卡库自建的字卡（cc-groups，含公用 cc-groups-public）按概率被 TA 抽一张、
  // 当作 TA 自己想说的话发出来（initiative 爱心角标 + mood 标签标注来源）。
  // 门控走 回复设置→其他 的 ai-cc-en / ai-cc-prob（与猜拳/游戏/贴贴邀请同体系，
  // 读法沿用 mail.js/feed.js 的 ls.get('reply-'+k) 惯例）；冷却 90 分钟 + 全局互动闸门。
  // 池过滤：纯文本（排除语音 |||/图片 data:/链接 http(s)）、≤60 字；最近 6 条不重复抽。
  const CC_TRIGGER_KEY = 'ta-cc-state';
  function ccStateLoad() { try { return JSON.parse(store.get(CC_TRIGGER_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function ccStateSave(d) { try { store.set(CC_TRIGGER_KEY, JSON.stringify(d)); } catch (e) {} }
  function ccCfg(k, def) {
    try {
      const v = store.get('reply-' + k);
      if (v === null || v === undefined || v === '') return def;
      const n = Number(v);
      return isNaN(n) ? def : n;
    } catch (e) { return def; }
  }
  window.__taCcPool = function () {
    let cards = [];
    try { cards = ((window.getCustomCards ? window.getCustomCards() : []) || []); } catch (e) { cards = []; }
    return cards.filter(function (s) {
      if (typeof s !== 'string') return false;
      const t = s.trim();
      if (!t || t.length > 60) return false;
      if (t.indexOf('|||') >= 0) return false;
      if (t.indexOf('data:') === 0 || t.indexOf('http:') === 0 || t.indexOf('https:') === 0) return false;
      if (window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false; // FIX 2026-09-13 #388 同款守卫
      return true;
    });
  };
  function maybeTriggerTACC() {
    try {
      // v3.14.x 教训：后台也照常进聊天记录+系统通知，前台弹窗交给通知链路
      if (ccCfg('ai-cc-en', 1) !== 1) return;
      // v3.13.x：全局闸门——任一互动卡发出后 60 分钟内不再自动触发
      if (!interactGateOk()) return;
      if (!taAskDcfOk()) return;
      const st = ccStateLoad();
      if (Date.now() - (st.lastCcAt || 0) < 90 * 60000) return;
      if (Math.random() * 100 >= ccCfg('ai-cc-prob', 4)) return;
      const pool = window.__taCcPool();
      if (!pool.length) return;
      const recent = Array.isArray(st.recent) ? st.recent : [];
      const fresh = pool.filter(function (t) { return recent.indexOf(t) < 0; });
      const arr2 = fresh.length ? fresh : pool;
      const text = arr2[Math.floor(Math.random() * arr2.length)];
      st.lastCcAt = Date.now();
      st.recent = recent.concat([text]).slice(-6);
      ccStateSave(st);
      interactGateMark();
      if (window.chatAddIn) window.chatAddIn(text, { initiative: 1, tag: '用了你建的字卡' });
      if (window.bgNotifyCheck) { try { window.bgNotifyCheck(text, Date.now(), { name: window.taFit ? window.taFit('TA') + '的字卡' : 'TA的字卡' }); } catch (e) {} }
    } catch (e) {}
  }
  window.maybeTriggerTACC = maybeTriggerTACC;
  setTimeout(maybeTriggerTACC, 150000);
  setInterval(maybeTriggerTACC, 240000);

  // 吐槽回应弹窗
  window.openRoast = function (msgIdx) {
    msgIdx = locateCardIdx(msgIdx, 'ask-roast', 'roastStatus');
    if (msgIdx < 0) return;
    let rec = null;
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      if (Array.isArray(msgs) && msgs[msgIdx]) rec = msgs[msgIdx];
    } catch (e) {}
    if (!rec || rec.special !== 'ask-roast') return;
    if (rec.roastStatus === 'answered') { showRoastResult(msgIdx); return; }
    const mask = document.getElementById('qa-mask');
    const body = document.getElementById('qa-body');
    const title = document.getElementById('qa-title');
    if (!mask || !body) return;
    if (title) title.textContent = window.taFit ? window.taFit('TA的吐槽') : 'TA的吐槽';
    body.innerHTML = '<div class="qa-hint">TA 吐槽你</div><div class="qa-q">“' + String(rec.roastText || rec.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '”</div>' +
      '<input id="qa-input" class="qa-input" type="text" placeholder="回 TA 一句…">' +
      '<button class="qa-send" id="qa-send">回TA一句</button>';
    mask.hidden = false;
    const send = () => {
      const inp = document.getElementById('qa-input');
      const answer = inp ? inp.value.trim() : '';
      if (!answer) { toast('回TA一句吧'); return; }
      submitRoast(msgIdx, answer);
    };
    document.getElementById('qa-send').addEventListener('click', send);
    const inp = document.getElementById('qa-input');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) send(); });
    // v3.6.x：用户正在聊天输入栏打字时不抢焦点（不打断输入法/不丢字），输完再点弹窗输入框
    setTimeout(() => { if (!chatInputFocused()) inp.focus(); }, 60);
  };
  function submitRoast(msgIdx, answer) {
    let rec = getCardAt(msgIdx);
    if (!rec || rec.special !== 'ask-roast') {
      msgIdx = locateCardIdx(msgIdx, 'ask-roast', 'roastStatus');
      if (msgIdx < 0) return;
      rec = getCardAt(msgIdx);
    }
    if (!rec || rec.special !== 'ask-roast' || rec.roastStatus === 'answered') return;
    // v3.7.x：吐槽话术池与「系统预设字卡 → 互动回应」tab 同源（getInteractPool），
    // 数据缺失时回退内置固定句；pickAskCardReply 内部会过滤用户已关闭的话术
    const defs = window.getInteractPool
      ? window.getInteractPool('吐槽·回应', ['你觉得我会信？', '少骗我。', '哼。', '好吧好吧。', '就这一次？', '行吧，放过你。', '嗯，这还差不多。'])
      : ['你觉得我会信？', '少骗我。', '哼。', '好吧好吧。', '就这一次？', '行吧，放过你。', '嗯，这还差不多。'];
    // v3.7.x：回应 = 吐槽固定句池 + 字卡库自定义字卡 混合随机
    const reply = window.pickAskCardReply ? window.pickAskCardReply(defs) : defs[Math.floor(Math.random() * defs.length)];
    // v3.5.128：不再预写 rec 字段——getChatMsgs 是 chat.js 内存对象引用，
    // 预写会让 chatRoastReply 的 roastStatus 守卫早退（回应消息丢失）
    const d = trLoad();
    d.history.unshift({ roast: rec.roastText, my: answer, reply: reply, cat: rec.roastCat || '', ts: Date.now() });
    trSave(d);
    refreshAskRecordsIfOpen();
    // 持久化 + 推消息统一由 chatRoastReply 完成
    if (window.chatRoastReply) window.chatRoastReply(msgIdx, answer, reply);
    document.getElementById('qa-mask').hidden = true;
  }
  function showRoastResult(msgIdx) {
    let rec = null;
    try {
      const msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]'));
      if (Array.isArray(msgs) && msgs[msgIdx]) rec = msgs[msgIdx];
    } catch (e) {}
    if (!rec) return;
    const mask = document.getElementById('qa-mask');
    const body = document.getElementById('qa-body');
    const title = document.getElementById('qa-title');
    if (!mask || !body) return;
    if (title) title.textContent = window.taFit ? window.taFit('TA的吐槽') : 'TA的吐槽';
    const _trShow = (window.askCardReplyClean ? window.askCardReplyClean(rec.roastReply || '') : (rec.roastReply || '')); // FIX 2026-09-17 #648 存量媒体卡回应清洗后展示
    body.innerHTML = '<div class="qa-q">“' + String(rec.roastText || rec.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '”</div>' +
      '<div class="qa-mine">你说：' + String(rec.roastAnswer || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>' +
      '<div class="qa-reply"><b>' + (window.taFit ? window.taFit('TA：') : 'TA：') + '</b>“' + String(window.taFit ? window.taFit(_trShow) : _trShow).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '”</div>' +
      '<div class="qa-close" id="qa-close2">收起来</div>';
    mask.hidden = false;
    document.getElementById('qa-close2').addEventListener('click', () => { mask.hidden = true; });
  }

  // 吐槽管理页
  let trTab = 'sys';
  function renderTRSettings() {
    const d = trLoad();
    const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
    const enEl = document.getElementById('tr-enable');
    if (enEl) enEl.checked = s.enabled !== false;
    const defEl = document.getElementById('tr-default');
    if (defEl) defEl.checked = s.useDefault !== false;
    const popEl = document.getElementById('tr-popup');
    const popVal = document.getElementById('tr-popup-val');
    const pp = askPopupProb(s);
    if (popEl) popEl.value = pp;
    if (popVal) popVal.textContent = pp + '%';
    const probEl = document.getElementById('tr-prob');
    const probVal = document.getElementById('tr-prob-val');
    if (probEl) probEl.value = typeof s.prob === 'number' ? s.prob : 5;
    if (probVal) probVal.textContent = (typeof s.prob === 'number' ? s.prob : 5) + '%';
  }
  // v3.7.x：系统预设分类切换——顶部标签栏点击切换，避免全部分类堆叠导致页面过长
  let trSysCat = null;
  function renderTRCatsInto(container, presetOnly, search) {
    if (!container) return;
    const d = trLoad();
    const useDefault = (d.settings || {}).useDefault !== false;
    if (presetOnly) {
      const counts = {};
      TR_CAT_ORDER.forEach(k => { counts[k] = d.questions.filter(q => q.cat === k && q.isPreset === true && (search === '' || q.text.indexOf(search) >= 0)).length; });
      const hasCats = TR_CAT_ORDER.filter(k => counts[k] > 0);
      if (!hasCats.length) { container.innerHTML = '<div class="ta-empty">暂无系统预设字卡</div>'; return; }
      if (!trSysCat || !hasCats.includes(trSysCat)) trSysCat = hasCats[0];
      let html = '<div class="card-tabs" style="padding:2px 2px 10px">';
      hasCats.forEach(k => {
        html += '<button class="cc-tab' + (k === trSysCat ? ' sel' : '') + '" data-cat="' + k + '">' + escT(TR_CAT_LABEL[k] || k) + '<em class="cc-tab-n">' + counts[k] + '</em></button>';
      });
      html += '</div>';
      const arr = d.questions.filter(q => q.cat === trSysCat && q.isPreset === true && (search === '' || q.text.indexOf(search) >= 0));
      arr.forEach(q => {
        const idx = d.questions.indexOf(q);
        html += '<div class="tc-qrow' + (q.enabled === false || !useDefault ? ' off' : '') + '">' +
          '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
          '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + ' <span class="tc-known">系统</span></div>' +
          (q.match && q.match.length ? '<div class="tc-qopts">触发：' + q.match.join(' / ') + '</div>' : '') +
          interactPoolInlineHtml('吐槽·回应') +
          '</div></div>';
      });
      container.innerHTML = html;
      container.querySelectorAll('.cc-tab[data-cat]').forEach(t => {
        t.addEventListener('click', () => { trSysCat = t.dataset.cat; renderTRCatsInto(container, true, search); });
      });
      container.querySelectorAll('input[data-idx]').forEach(cb => {
        cb.addEventListener('change', () => {
          const d2 = trLoad();
          const q = d2.questions[Number(cb.dataset.idx)];
          if (q) q.enabled = cb.checked;
          trSave(d2);
        });
      });
      return;
    }
    let html = '';
    TR_CAT_ORDER.forEach(k => {
      const arr = d.questions.filter(q => q.cat === k && (q.isPreset === true) === presetOnly && (search === '' || q.text.indexOf(search) >= 0));
      if (!arr.length) return;
      html += '<div class="tc-cat-t">' + (TR_CAT_LABEL[k] || k) + ' <span style="font-size:11px;color:var(--muted);font-weight:400">(' + arr.length + ')</span></div>';
      arr.forEach(q => {
        const idx = d.questions.indexOf(q);
        const preset = q.isPreset === true;
        const delBtn = preset ? '' : '<button class="ta-del" data-idx="' + idx + '">✕</button>';
        html += '<div class="tc-qrow' + (q.enabled === false || (preset && !useDefault) ? ' off' : '') + '">' +
          '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
          '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + (preset ? ' <span class="tc-known">系统</span>' : '') + '</div>' +
          (q.match && q.match.length ? '<div class="tc-qopts">触发：' + q.match.join(' / ') + '</div>' : '') +
          (presetOnly ? interactPoolInlineHtml('吐槽·回应') : '') +
          '</div>' + delBtn + '</div>';
      });
    });

    if (!html) html = '<div class="ta-empty">' + (presetOnly ? '暂无系统预设字卡' : '暂未添加自定义字卡，可在上方添加') + '</div>';
    container.innerHTML = html;
    container.querySelectorAll('input[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const d2 = trLoad();
        const q = d2.questions[Number(cb.dataset.idx)];
        if (q) q.enabled = cb.checked;
        trSave(d2);
      });
    });
    container.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const d2 = trLoad();
        const q = d2.questions[Number(b.dataset.idx)];
        if (q && q.isPreset === true) { toast('系统预设字卡不可删除'); return; }
        d2.questions.splice(Number(b.dataset.idx), 1);
        trSave(d2);
        renderTRCatsInto(container, false, search);
      });
    });

  }
  // TA的吐槽 我的添加渲染配置
  const trMineOpt = {
    load: trLoad, save: trSave, order: TR_CAT_ORDER, label: TR_CAT_LABEL,
    emptyTip: '暂未添加自定义字卡，可在上方添加',
    rowHtml: function (q, idx) {
      return '<div class="tc-qrow' + (q.enabled === false ? ' off' : '') + '">' +
        '<label class="toggle"><input type="checkbox" data-idx="' + idx + '"' + (q.enabled !== false ? ' checked' : '') + '><span class="tk"></span></label>' +
        '<div class="tc-qmain"><div class="tc-qtext">' + escT(q.text) + '</div>' +
        (q.match && q.match.length ? '<div class="tc-qopts">触发：' + q.match.map(escT).join(' / ') + '</div>' : '') +
        '</div>' +
        '<button class="ta-del" data-idx="' + idx + '">✕</button></div>';
    }
  };
  function switchTRTab(tab) {
    trTab = tab;
    renderTRSettings();
    const tabsWrap = document.getElementById('tr-tabs');
    if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
    const sysPanel = document.getElementById('tr-sys-panel');
    const minePanel = document.getElementById('tr-mine-panel');
    if (sysPanel) sysPanel.hidden = tab !== 'sys';
    if (minePanel) minePanel.hidden = tab !== 'mine';
    trSearch = '';
    const searchInput = document.getElementById('tr-search');
    if (searchInput) searchInput.value = '';
    if (tab === 'sys') renderTRCatsInto(document.getElementById('tr-sys-cats'), true, '');
    else renderMineGroupsInto(document.getElementById('tr-mine-cats'), trMineOpt, '');
  }
  const trTabsWrap = document.getElementById('tr-tabs');
  if (trTabsWrap) {
    trTabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTRTab(tab.dataset.tab));
    });
  }
  // 搜索
  let trSearch = '';
  const trSearchInput = document.getElementById('tr-search');
  if (trSearchInput) {
    trSearchInput.addEventListener('input', () => {
      trSearch = trSearchInput.value.trim();
      if (trTab === 'sys') renderTRCatsInto(document.getElementById('tr-sys-cats'), true, trSearch);
      else renderMineGroupsInto(document.getElementById('tr-mine-cats'), trMineOpt, trSearch);
    });
  }
  // AI-B 代修（2026-08-22）：同上——trTabsWrap 绑定代码重复粘贴第二份已删除
  // 吐槽入口
  const liTR = document.getElementById('li-ta-roast');
  const trPage = document.getElementById('page-ta-roast');
  if (liTR && trPage) {
    liTR.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      trPage.hidden = false;
      const tw = document.getElementById('tr-tabs'); if (tw) tw.style.display = 'none';
      switchTRTab('sys');
    });
  }
  const trBackBtn = document.getElementById('tc-roast-back');
  if (trBackBtn) {
    trBackBtn.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  const trEn = document.getElementById('tr-enable');
  if (trEn) trEn.addEventListener('change', () => { const d = trLoad(); d.settings.enabled = trEn.checked; trSave(d); toast(trEn.checked ? 'TA的吐槽已开启' : 'TA的吐槽已关闭'); });
  const trDefault = document.getElementById('tr-default');
  if (trDefault) trDefault.addEventListener('change', () => {
    const d = trLoad(); d.settings.useDefault = trDefault.checked; trSave(d);
    switchTRTab(trTab);
    toast(trDefault.checked ? '系统预设字卡已开启' : '系统预设字卡已关闭（仅用你添加的字卡）');
  });
  const trProb = document.getElementById('tr-prob');
  if (trProb) trProb.addEventListener('input', () => {
    const d = trLoad(); d.settings.prob = Math.max(0, Math.min(100, parseInt(trProb.value, 10) || 0)); trSave(d);
    const v = document.getElementById('tr-prob-val'); if (v) v.textContent = trProb.value + '%';
    toast('触发概率已设为 ' + trProb.value + '%');
  });
  const trPopup = document.getElementById('tr-popup');
  if (trPopup) trPopup.addEventListener('input', () => {
    const d = trLoad(); d.settings.popupProb = parseInt(trPopup.value, 10) || 0; trSave(d);
    const v = document.getElementById('tr-popup-val'); if (v) v.textContent = trPopup.value + '%';
    toast('弹窗概率已设为 ' + trPopup.value + '%');
  });
  const trAdd = document.getElementById('tr-new-add');
  if (trAdd) {
    // v3.7.x：分类下拉注入「我的分组」+「＋ 新建分组…」
    (function rebuildTRSelect() {
      const catEl = document.getElementById('tr-new-cat');
      if (!catEl) return;
      const d0 = trLoad();
      catEl.innerHTML = window.cardGroups.catOptsHtml(TR_CAT_ORDER.map(k => [k, TR_CAT_LABEL[k]]), d0.groups || [], catEl.value);
      window.cardGroups.bindNewGrp(catEl, d0.groups, function () { trSave(d0); });
    })();
    trAdd.addEventListener('click', () => {
      const catEl = document.getElementById('tr-new-cat');
      const textEl = document.getElementById('tr-new-text');
      const matchEl = document.getElementById('tr-new-match');
      const text = textEl ? textEl.value.trim() : '';
      if (!text) { toast('请输入吐槽内容'); return; }
      const parsed = window.cardGroups.parseCatVal(catEl ? catEl.value : 'light');
      if (!parsed) { toast('请先选择分类或分组'); return; }
      const match = (matchEl ? matchEl.value : '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 4);
      const d = trLoad();
      const q = { id: 'r_' + Date.now() + '_' + Math.floor(Math.random() * 9999), cat: parsed.cat || 'light', text: text, match: match, enabled: true, isPreset: false };
      if (parsed.grp) q.grp = parsed.grp;
      d.questions.push(q);
      trSave(d);
      if (textEl) textEl.value = '';
      if (matchEl) matchEl.value = '';
      renderMineGroupsInto(document.getElementById('tr-mine-cats'), trMineOpt);
      toast('已添加吐槽字卡');
    });
  }
  // v3.7.x：「＋分组」按钮（添加字卡卡片标题行）
  const trNewGrp = document.getElementById('tr-new-grp');
  if (trNewGrp) {
    trNewGrp.addEventListener('click', () => {
      const d = trLoad();
      window.cardGroups.addFlow(d.groups, g => {
        if (!g) return;
        trSave(d);
        (function refreshTRSelect() {
          const catEl = document.getElementById('tr-new-cat');
          if (catEl) {
            catEl.innerHTML = window.cardGroups.catOptsHtml(TR_CAT_ORDER.map(k => [k, TR_CAT_LABEL[k]]), d.groups, catEl.value);
            window.cardGroups.bindNewGrp(catEl, d.groups);
          }
        })();
        if (trTab === 'mine') renderMineGroupsInto(document.getElementById('tr-mine-cats'), trMineOpt);
        toast('已新建分组「' + g.name + '」');
      });
    });
  }
  // 触发一次吐槽（供管理页按钮 / 更多功能面板共用）
  window.triggerTaRoastNow = function () {
    const d = trLoad();
    const q = trPick(d, '');
    if (!q) { toast('题库没有可用吐槽'); return; }
    const s = d.settings || { enabled: true, prob: 5, popupProb: 70 };
    trPush(q, { popupProb: askPopupProb(s) });
    toast('TA 在聊天里吐槽你了');
  };
  const trNow = document.getElementById('tr-now');
  if (trNow) trNow.addEventListener('click', () => window.triggerTaRoastNow());
  const qaClose = document.getElementById('qa-mask-close');
  if (qaClose) qaClose.addEventListener('click', () => { document.getElementById('qa-mask').hidden = true; });

  // ================= 提问记录页（桌面第二页） =================
  // 集中展示 TA的询问 / TA的小问题 / TA的好奇 / TA的吐槽 的历史记录
  function fmtDT(ts) {
    const dd = new Date(ts);
    return ('0' + dd.getHours()).slice(-2) + ':' + ('0' + dd.getMinutes()).slice(-2) + ' ' + ((dd.getMonth() + 1) + '月' + dd.getDate() + '日');
  }
  // v3.26.x：提问记录跨桌面汇总——提问与回答都写进「发生所在联系人桌面」的 ta-ask，
  // 主页提问记录若只读当前桌面，用户在联系人桌面答过题、切回主页就「看不到记录」。
  // 汇总 = 当前桌面在前 + 其余桌面（注册表 contacts + default）的 history 合并。
  // FIX 2026-09-16 #625：此前仅「TA的询问」走了汇总，小问题/好奇/吐槽/邀请·问问仍只读
  // 当前桌面 ⇒ 在联系人桌面发生的记录切回主页就「看不到、不同步」。现五个分类统一走本组
  // 读写（含清空），排序统一按 ts 倒序（新→旧，与「TA的询问」原有观感一致）。
  // 根命名空间（activePrefix() = '<根>:<cid>'）：default 桌面必须与 contacts.js 的
  // defaultStore 同口径——命名空间优先、回退旧顶层键，否则老档用户在别的桌面看到的是空。
  const GNS = (function () {
    try { const p = window.activePrefix(); const i = p.lastIndexOf(':'); if (i > 0) return p.slice(0, i); } catch (e) {}
    return 'xy-home-v2';
  })();
  function deskCids() {
    const cur = window.__activeCid || 'default';
    const list = [cur, 'default'].concat((window.getContacts ? window.getContacts() : []).map(function (c) { return c && c.id; }).filter(Boolean));
    const seen = {}, out = [];
    list.forEach(function (cid) { if (!cid || seen[cid]) return; seen[cid] = 1; out.push(cid); });
    return out;
  }
  // 读指定桌面的键（原始字符串；读不到返回 null）
  function deskRaw(cid, key) {
    try {
      if (cid === 'default') {
        const ns = window.xyStore(GNS + ':default').get(key);
        if (ns !== null && ns !== undefined) return ns;
        return window.xyStore(GNS).get(key);
      }
      const s = window.storeFor ? window.storeFor(cid) : null;
      return s ? s.get(key) : null;
    } catch (e) { return null; }
  }
  // 写指定桌面的键（default 分支同 defaultStore.set：写命名空间后清掉旧顶层键）
  function deskWrite(cid, key, val) {
    try {
      if (cid === 'default') {
        window.xyStore(GNS + ':default').set(key, val);
        try { window.xyStore(GNS).remove(key); } catch (e) {}
        return;
      }
      const s = window.storeFor ? window.storeFor(cid) : null;
      if (s) s.set(key, val);
    } catch (e) {}
  }
  // 汇总各桌面记录：兼容 {history:[…]} 对象与裸数组两种键形态，按 ts 倒序（新→旧）
  function allDeskHistories(key) {
    const out = [];
    deskCids().forEach(function (cid) {
      const raw = deskRaw(cid, key);
      if (!raw) return;
      let d = null;
      try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
      const arr = Array.isArray(d) ? d : (d && Array.isArray(d.history) ? d.history : null);
      if (arr) out.push.apply(out, arr);
    });
    out.sort(function (a, b) { return (Number(b && b.ts) || 0) - (Number(a && a.ts) || 0); });
    return out;
  }
  // 清空各桌面记录：读改写保留题库/设置/分组，只清 history（或裸数组本身）
  function clearDeskHistories(key) {
    deskCids().forEach(function (cid) {
      const raw = deskRaw(cid, key);
      if (!raw) return; // 该桌面从未写过该分类：无需清，也不新建空档
      let d = null;
      try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
      if (Array.isArray(d)) { deskWrite(cid, key, '[]'); return; }
      if (!d || typeof d !== 'object') return;
      d.history = [];
      try { deskWrite(cid, key, JSON.stringify(d)); } catch (e) {}
    });
  }
  // 记录写入后即时刷新（仅当提问记录页正开着——TA 在后台自动触发时也能同步上屏）
  function refreshAskRecordsIfOpen() {
    try {
      const pg = document.getElementById('page-interact');
      if (pg && !pg.hidden && window.renderAskRecords) window.renderAskRecords();
    } catch (e) {}
  }
  window.renderAskRecords = function () {
    // TA的询问
    const askEl = document.getElementById('ar-ask');
    if (askEl) {
      const h = allDeskHistories('ta-ask');
      askEl.innerHTML = h.length
        ? h.map(x => '<div class="tc-listitem"><div class="tc-li-q">问：' + escG(x.q) + '</div>' + (x.status === 'pending' ? '<div class="tc-li-pending">待回答</div>' : '<div class="tc-li-line">你：' + escG(x.a) + '</div>' + (x.reply ? '<div class="tc-li-line">' + (window.taFit ? window.taFit('TA：') : 'TA：') + taReplyShow(x.reply) + '</div>' : '')) + '<div class="tc-li-time">' + fmtDT(x.ts) + '</div></div>').join('')
        : '<div class="ta-empty">暂无询问记录</div>';
    }
    // TA的小问题
    const chEl = document.getElementById('ar-choose');
    if (chEl) {
      const h = allDeskHistories(KEY2);
      chEl.innerHTML = h.length
        ? h.map(x => '<div class="tc-listitem"><div class="tc-li-q">' + escG(x.q) + '</div><div class="tc-li-line">你的选择：' + escG(x.my) + '</div><div class="tc-li-line">' + (window.taFit ? window.taFit('TA：') : 'TA：') + taReplyShow(x.reply) + '</div><div class="tc-li-match">' + escG(x.match) + '</div><div class="tc-li-time">' + fmtDT(x.ts) + '</div></div>').join('')
        : '<div class="ta-empty">暂无小问题记录</div>';
    }
    // TA的好奇
    const cuEl = document.getElementById('ar-curious');
    if (cuEl) {
      const h = allDeskHistories(KEY3);
      cuEl.innerHTML = h.length
        ? h.map(x => '<div class="tc-listitem"><div class="tc-li-q">' + escG(x.q) + '</div><div class="tc-li-line">你：' + escG(x.my) + '</div><div class="tc-li-line">' + (window.taFit ? window.taFit('TA：') : 'TA：') + taReplyShow(x.reply) + '</div><div class="tc-li-time">' + fmtDT(x.ts) + '</div></div>').join('')
        : '<div class="ta-empty">暂无好奇记录</div>';
    }
    // TA的吐槽
    const roEl = document.getElementById('ar-roast');
    if (roEl) {
      const h = allDeskHistories(KEY4);
      roEl.innerHTML = h.length
        ? h.map(x => '<div class="tc-listitem"><div class="tc-li-q">' + escG(x.roast) + '</div><div class="tc-li-line">你：' + escG(x.my) + '</div><div class="tc-li-line">' + (window.taFit ? window.taFit('TA：') : 'TA：') + taReplyShow(x.reply) + '</div><div class="tc-li-time">' + fmtDT(x.ts) + '</div></div>').join('')
        : '<div class="ta-empty">暂无吐槽记录</div>';
    }
    // 邀请 / 问问 TA（我的提问 + 联系人答案）
    const inEl = document.getElementById('ar-invite');
    if (inEl) {
      const h = allDeskHistories('invite-ask-history');
      inEl.innerHTML = h.length
        ? h.map(x => '<div class="tc-listitem"><div class="tc-li-q">' +
            (x.type === 'invite' ? '邀请：' : '问：') + String(x.q || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>' +
            '<div class="tc-li-line">' + (window.taFit ? window.taFit('TA：') : 'TA：') + escG(window.taFit ? window.taFit(window.askCardReplyClean ? window.askCardReplyClean(x.a || '') : (x.a || '')) : (window.askCardReplyClean ? window.askCardReplyClean(x.a || '') : (x.a || ''))) + '</div>' +
            '<div class="tc-li-time">' + fmtDT(x.ts) + '</div></div>').join('')
        : '<div class="ta-empty">暂无邀请/问问记录</div>';
    }
  };
  // 清空按钮（#625：列表已是全桌面汇总，清空必须同口径清全桌面，
  // 否则清完别桌记录立刻又出现在列表里＝「清了个寂寞」）
  const clearBind = (id, key, label) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (window.openModal) {
        window.openModal('清空全部桌面的' + label + '记录？', '', () => {
          clearDeskHistories(key);
          window.renderAskRecords();
        }, { noInput: true });
      }
    });
  };
  clearBind('ar-ask-clear', KEY, '询问');
  clearBind('ar-choose-clear', KEY2, '小问题');
  clearBind('ar-curious-clear', KEY3, '好奇');
  clearBind('ar-roast-clear', KEY4, '吐槽');
  // 邀请/问问清空
  const arInviteClear = document.getElementById('ar-invite-clear');
  if (arInviteClear) {
    arInviteClear.addEventListener('click', () => {
      if (window.openModal) {
        window.openModal('清空全部桌面的邀请/问问记录？', '', () => {
          clearDeskHistories('invite-ask-history');
          window.renderAskRecords();
        }, { noInput: true });
      }
    });
  }

  // 提问记录：横排 4 个分类 tab 切换
  document.querySelectorAll('#page-interact .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#page-interact .fav-tab').forEach(x => x.classList.toggle('sel', x === tab));
      const k = tab.dataset.tab;
      document.querySelectorAll('#page-interact .cal-card').forEach(c => {
        c.hidden = c.dataset.panel !== k;
      });
      if (window.renderAskRecords) window.renderAskRecords();
    });
  });

  // ================= 字卡库入口数字（动态显示各题库实际数量） =================
  window.refreshTaCardCounts = function () {
    const setSys = (id, n) => { const el = document.querySelector('#' + id + ' .t'); if (el) el.textContent = n; };
    const setMine = (id, n) => { const el = document.querySelector('#' + id + '-mine .t'); if (el) el.textContent = n; };
    const split = (id, qs) => {
      setSys(id, qs.filter(q => q && q.isPreset === true).length);
      setMine(id, qs.filter(q => q && q.isPreset !== true).length);
    };
    try { split('li-ta-ask', taAskLoad().questions); } catch (e) {}
    try { split('li-ta-choose', tcLoad().questions); } catch (e) {}
    try { split('li-ta-curious', tcuLoad().questions); } catch (e) {}
    try { split('li-ta-roast', trLoad().questions); } catch (e) {}
  };
  // v3.9.x：字卡库拆双入口——「·我的添加」入口进入管理页只看自定义（隐藏系统预设 tab）
  (function () {
    const openMine = (liId, pageId, tabsId, switchFn) => {
      const liEl = document.getElementById(liId);
      const pgEl = document.getElementById(pageId);
      if (!liEl || !pgEl) return;
      liEl.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => p.hidden = true);
        pgEl.hidden = false;
        const tw = document.getElementById(tabsId); if (tw) tw.style.display = 'none';
        switchFn('mine');
      });
    };
    openMine('li-ta-ask-mine', 'page-ta-ask', 'ta-ask-tabs', switchAskTab);
    openMine('li-ta-choose-mine', 'page-ta-choose', 'tc-tabs', switchTCTab);
    openMine('li-ta-curious-mine', 'page-ta-curious', 'tcu-tabs', switchTCUTab);
    openMine('li-ta-roast-mine', 'page-ta-roast', 'tr-tabs', switchTRTab);
  })();
  // v3.9.x：注册 TA 询问/小问题/好奇/吐槽跨分类搜索
  window.__cardSearchFns = window.__cardSearchFns || [];
  [
    { name: 'TA的询问', load: taAskLoad },
    { name: 'TA的小问题', load: tcLoad },
    { name: 'TA的好奇', load: tcuLoad },
    { name: 'TA的吐槽', load: trLoad }
  ].forEach(function (it) {
    window.__cardSearchFns.push({ name: it.name, fn: function (kw) {
      const out = [];
      try { (it.load().questions || []).forEach(function (q) { const txt = q && q.text ? q.text : ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: q.isPreset === true ? '系统预设' : '我的添加' }); }); } catch (e) {}
      return out;
    } });
  });
  // 字卡库页可见时刷新（初始加载、从管理页返回、增删题库后都会更新）
  const ccPageEl = document.getElementById('page-chatcard');
  if (ccPageEl) {
    const mo = new MutationObserver(() => { if (!ccPageEl.hidden) window.refreshTaCardCounts(); });
    mo.observe(ccPageEl, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.refreshTaCardCounts();

  // ================= IndexedDB 权威恢复（四个题库共用，v3.6.x） =================
  // localStorage 配额写失败、或大键只进 IDB 时，本地快照会停留在旧数据，
  // 用户新添加的字卡（只存在于 IDB）启动后读不到 → 看起来"消失"。
  // 启动时从 IDB 读回：若 IDB 题库比本地更全，用 IDB 数据做基准合并新预设后
  // 双写覆盖（策略同 chatcard.js cc-groups——IDB 是权威持久层，本地只是快照；
  // 反向场景 idbSet 偶尔失败而本地已最新时，IDB 数量更少 → 不覆盖，不会丢数据）。
  function attachIdbRestore(key, loadFn, mergeFn) {
    if (!window.idbGet) return;
    window.idbGet(window.activePrefix() + ':' + key).then(function (v) {
      if (v === undefined || v === null) return;
      try {
        const idbData = typeof v === 'string' ? JSON.parse(v) : v;
        if (!idbData || typeof idbData !== 'object' || Array.isArray(idbData)) return;
        if (!Array.isArray(idbData.questions) || !idbData.questions.length) return;
        const local = loadFn();
        const idbCnt = idbData.questions.length;
        const localCnt = Array.isArray(local.questions) ? local.questions.length : 0;
        if (idbCnt > localCnt) {
          // 以 IDB 为权威（含用户自定义），合并系统预设新增题后双写
          if (mergeFn) mergeFn(idbData);
          try { store.set(key, JSON.stringify(idbData)); } catch (e) {}
          try { window.refreshTaCardCounts(); } catch (e) {}
        }
      } catch (e) {}
    });
  }
  attachIdbRestore(KEY, taAskLoad, taAskMerge);
  attachIdbRestore(KEY2, tcLoad, tcMerge);
  attachIdbRestore(KEY3, tcuLoad, tcuMerge);
  attachIdbRestore(KEY4, trLoad, trMerge);

  // ================= 批量提问问卷（v3.32.x：用户批量出题 → 联系人作答交卷） =================
  // 题目格式（textarea 批量编辑）：单选题 = 第一行【问题】+ 下面每行一个选项（≥2 个成单选）；
  // 文字题 = 第一行【问题】+ 下一行只写一个「一」（与单选题的区别标记）。
  // 联系人文字题用字卡作答，与正常聊天同源：自定义字卡 1~5 张空格连发，系统预设默认聊天
  // 字卡（getDefaultCards('chat')）可覆盖——后者内部尊重 #319 未成年人防护锁（锁定时系统
  // 预设字卡抽不出，只剩自定义字卡；锁定且字卡库为空时兜底「……」，绝不泄漏预设）。
  // 交卷节奏：交卷时间（settings.deadline）到点自动交卷；未到点每 30 秒掷一次
  // 「提前交卷概率」（settings.prob），命中即把剩余题目一次性答完并交卷；
  // 未命中且还有未答题时按序再答一道（作答中体感）。
  const SKEY = 'ta-survey';
  function surveyLoad() {
    let d = null;
    try { d = JSON.parse(store.get(SKEY) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    if (typeof d.text !== 'string') d.text = '';
    if (!d.settings || typeof d.settings !== 'object') d.settings = { prob: 10, deadline: 0, sendToChat: true };
    if (typeof d.settings.prob !== 'number') d.settings.prob = 10;
    if (typeof d.settings.deadline !== 'number') d.settings.deadline = 0;
    // v3.33.x #523：TA 的作答是否逐条发到聊天（批量问卷题多，用户可关闭只留卡片；默认开＝与单题一致）
    if (typeof d.settings.sendToChat !== 'boolean') d.settings.sendToChat = true;
    if (!Array.isArray(d.qs)) d.qs = [];
    if (!Array.isArray(d.answers)) d.answers = [];
    if (d.status !== 'sent' && d.status !== 'done') { d.status = 'draft'; d.sentAt = 0; }
    // v3.33.x #523：doneMsgAt = 已发过交卷系统消息的那一轮 sentAt（同轮只提醒一次；0=未提醒）
    if (typeof d.doneMsgAt !== 'number') d.doneMsgAt = 0;
    return d;
  }
  function surveySave(d) { try { store.set(SKEY, JSON.stringify(d)); } catch (e) {} }
  // v3.33.x #521：问卷进度回写聊天卡片——TA 每答一题/交卷时调用，把快照写回聊天记录里的
  // ask-survey 卡片（chat.js 的 chatSyncSurveyCard 按 surveyTs 定位；surveyTs=发出时间戳，
  // 与卡片插入时写入的一致，撤回重发后新卡新键不串）
  function surveySyncCard(d) {
    try { if (window.chatSyncSurveyCard) window.chatSyncSurveyCard(d.sentAt, d.status, d.answers.slice()); } catch (e) {}
  }
  // 解析问卷文本：返回 [{type:'single'|'text', text, options}]
  function surveyParse(text) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const qs = [];
    let cur = null, marked = false;
    const flush = () => {
      if (!cur) return;
      if (!marked && cur.opts.length >= 2) qs.push({ type: 'single', text: cur.text, options: cur.opts.slice() });
      else qs.push({ type: 'text', text: cur.text, options: [] });
      cur = null; marked = false;
    };
    lines.forEach(t => {
      const m = t.match(/^【(.+?)】$/);
      if (m) { flush(); if (m[1].trim()) cur = { text: m[1].trim(), opts: [] }; return; }
      if (cur) {
        if (!marked && !cur.opts.length && t === '一') { marked = true; return; }
        cur.opts.push(t); return;
      }
      flush();
      qs.push({ type: 'text', text: t, options: [] }); // 无【】裸行：整行当文字题题干
    });
    flush();
    return qs.filter(q => q.text);
  }
  // 文字题答案：与正常聊天同源抽字卡（自定义字卡连发 → 默认聊天字卡覆盖 → 兜底）
  function surveyAnswerText() {
    let t = '';
    let words = [];
    try {
      const cards = (window.getCustomCards && window.getCustomCards()) || [];
      // FIX 2026-09-13 #388 媒体池令牌卡不进文字题答案池（同 chat.js #383 第三道守卫）
      // FIX 2026-09-15 #533 链接导入的媒体字卡（裸 http(s) 图链）同款排除
      words = cards.filter(s => typeof s === 'string' && s.trim() && s.indexOf('data:') !== 0 && s.indexOf('|||') < 0 && !/^https?:\/\//i.test(s) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(s)));
    } catch (e) {}
    if (words.length) {
      const n = 1 + Math.floor(Math.random() * Math.min(5, words.length));
      const copy = words.slice(); const out = [];
      while (out.length < n) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
      // #650 文字题多张字卡连接符同走「拼接随机标点」符号池（关＝空格原样）
      t = (window.pyJoinCards && window.replyCfg) ? window.pyJoinCards(out, window.replyCfg()) : out.join(' ');
    }
    try {
      const dc = window.getDefaultCards && window.getDefaultCards('chat');
      if (dc && dc.type !== 'poke' && typeof dc.text === 'string' && dc.text.trim()) t = dc.text;
    } catch (e) {}
    if (!t) {
      // 未锁定时走「询问·回应」混合池；未成年人防护锁定下不碰任何系统预设，仅字卡库（已空则最小兜底）
      if (window.cardLockOpen && window.cardLockOpen()) {
        t = window.pickAskCardReply ? window.pickAskCardReply() : '收到你的回答。';
      } else {
        t = '……';
      }
    }
    return t;
  }
  // 逐题作答：每题答案只生成一次（避免「聊天消息里的答案」与「卡片里的答案」不一致），写入
  // d.answers 并回写卡片；是否把该答案作为聊天消息逐条发出由 settings.sendToChat 决定
  // （v3.33.x #523：批量问卷题多、逐条刷聊天太吵，用户可在发出前取消勾选）。
  function surveyPickAnswer(q) {
    if (q && q.type === 'single' && Array.isArray(q.options) && q.options.length) {
      return q.options[Math.floor(Math.random() * q.options.length)];
    }
    return surveyAnswerText();
  }
  function surveySeqAnswers(qs, cb, i) {
    if (i >= qs.length) { cb(); return; }
    const q = qs[i];
    const ans = surveyPickAnswer(q);
    const cur = surveyLoad();
    if (cur.status !== 'sent') { cb(); return; }
    cur.answers.push(ans);
    surveySave(cur);
    surveySyncCard(cur);
    if (cur.settings.sendToChat !== false) {
      const msg = (q.type === 'single' && Array.isArray(q.options) && q.options.length)
        ? '【' + q.text + '】我的选择：' + ans
        : '【' + q.text + '】' + ans;
      try { window.chatAddIn(msg, {}); } catch (e) {}
    }
    surveyRender();
    setTimeout(() => surveySeqAnswers(qs, cb, i + 1), 1200 + Math.floor(Math.random() * 1600));
  }
  // v3.33.x #523：同一轮只允许一条交卷完成链（防并发 tick 起第二条链重复发消息）；
  // doneMsgAt 记录「已提醒过的轮次（=sentAt）」，同一轮重复进入 finish 也不再发第二次。
  let surveySubmitLock = false;
  function surveySubmitAll(d, early) {
    if (surveySubmitLock) return;
    surveySubmitLock = true;
    const remaining = d.qs.slice(d.answers.length);
    const finish = () => {
      surveySubmitLock = false;
      const d2 = surveyLoad();
      if (d2.status !== 'sent') return;
      d2.answers = d2.qs.map((q, i) => d2.answers[i] || surveyPickAnswer(q));
      d2.status = 'done';
      const notify = d2.doneMsgAt !== d2.sentAt;
      if (notify) d2.doneMsgAt = d2.sentAt;
      surveySave(d2);
      surveySyncCard(d2); // v3.33.x #521：交卷态回写聊天问卷卡片
      if (notify) {
        try { window.chatAddSystem(early ? 'TA 提前交卷了（共 ' + d2.qs.length + ' 题）。' : 'TA 交卷了（共 ' + d2.qs.length + ' 题）。', { special: 'ask-msg' }); } catch (e) {}
      }
      surveyRender();
    };
    if (remaining.length) surveySeqAnswers(remaining, finish, 0); else finish();
  }
  function surveyTick() {
    let d;
    try { d = surveyLoad(); } catch (e) { return; }
    if (d.status !== 'sent') return;
    if (Date.now() - (d.sentAt || 0) < 15000) return; // 刚发出 15s 内不动作
    const done = d.answers.length >= d.qs.length;
    const deadlineHit = d.settings.deadline > 0 && Date.now() >= d.settings.deadline;
    const earlyHit = !done && !deadlineHit && Math.random() * 100 < d.settings.prob;
    if (done || deadlineHit || earlyHit) { surveySubmitAll(d, earlyHit); return; }
    // 未交卷：按序再答一道（答案落卡片；聊天消息按 sendToChat 决定）
    const q = d.qs[d.answers.length];
    if (!q) return;
    surveySeqAnswers([q], () => {}, 0);
  }
  setInterval(surveyTick, 30000);
  function surveySend() {
    const d = surveyLoad();
    if (d.status === 'sent') { toast('问卷已发出，TA 正在作答'); return; }
    // v3.33.x #523：已交卷（done）允许直接再发一轮（用户要「重复提交给联系人作答」）——
    // 这里照常把 status 重置为 sent、answers 清空、插入新的问卷卡片，等于开启新一轮作答。
    const tEl = document.getElementById('ta-survey-text');
    if (tEl) { d.text = tEl.value; d.qs = surveyParse(tEl.value); surveySave(d); }
    if (!d.qs.length) { toast('请先填写问卷题目（【问题】+ 选项行 / 「一」行）'); return; }
    if (d.settings.deadline && d.settings.deadline <= Date.now()) { toast('交卷时间已过期，请重新设置'); return; }
    d.status = 'sent'; d.sentAt = Date.now(); d.answers = []; d.doneMsgAt = 0;
    surveySave(d);
    try { window.chatAddSystem('你向TA发出了一份问卷（' + d.qs.length + ' 题）。', { special: 'ask-msg' }); } catch (e) {}
    // v3.33.x #521：问卷本体以长卡片插入聊天（ask-survey）——与单题 ask-card 同层级观感；
    // 题列表快照随消息持久化，作答进度由 surveySyncCard→chatSyncSurveyCard 回写
    try {
      window.chatAddSystem('问卷（' + d.qs.length + ' 题）', {
        special: 'ask-survey',
        surveyTs: d.sentAt,
        surveyQs: JSON.parse(JSON.stringify(d.qs)),
        surveyStatus: 'sent',
        surveyAnswers: []
      });
    } catch (e) {}
    surveyRender();
    toast('问卷已发出，TA 开始作答');
    // v3.33.x #523：发出后自动关闭批量设置页、回聊天看问卷卡片（用户报「点了发出没返回聊天页」）
    surveyGoChat();
  }
  function surveyRender() {
    const d = surveyLoad();
    const txt = document.getElementById('ta-survey-text');
    if (txt && document.activeElement !== txt && txt.value !== d.text) txt.value = d.text;
    const dl = document.getElementById('ta-survey-deadline');
    if (dl) dl.textContent = d.settings.deadline ? fmtDeadlineText(d.settings.deadline) : '未设置';
    const prob = document.getElementById('ta-survey-prob');
    if (prob && document.activeElement !== prob) prob.value = d.settings.prob;
    const pv = document.getElementById('ta-survey-prob-val');
    if (pv) pv.textContent = d.settings.prob + '%';
    const schatEl = document.getElementById('ta-survey-chat');
    if (schatEl) schatEl.checked = d.settings.sendToChat !== false;
    const st = document.getElementById('ta-survey-status');
    if (st) {
      if (d.status === 'draft') {
        const nS = d.qs.filter(q => q.type === 'single').length;
        st.innerHTML = '当前状态：草稿 —— 已解析 <b>' + d.qs.length + '</b> 题' + (d.qs.length ? '（单选 ' + nS + ' 题 / 文字 ' + (d.qs.length - nS) + ' 题）' : '') + '。填好后点「发出问卷给TA」。';
      } else if (d.status === 'sent') {
        st.innerHTML = '当前状态：TA 作答中 —— 已答 <b>' + d.answers.length + '</b> / ' + d.qs.length + ' 题' + (d.settings.deadline ? '；交卷时间 ' + fmtDeadlineText(d.settings.deadline) : '；未设交卷时间') + '；每 30 秒按 ' + d.settings.prob + '% 概率提前交卷。';
      } else {
        st.innerHTML = '当前状态：已交卷 —— 共 ' + d.qs.length + ' 题。可直接再点「发出问卷给TA」重新提交一轮（清空上一轮作答、在聊天里插入新的问卷卡片）。';
      }
    }
  }
  const surveyPage = document.getElementById('page-ta-ask-survey');
  // v3.26.x：标记本次批量问卷「从聊天页半框进入」——返回时回聊天页而非 TA 的询问设置页
  let surveyOpenFromChat = false;
  // v3.26.x：供「聊天页 · 问问TA 半框」的「批量设置问卷」按钮调用：打开批量问卷页（返回时回聊天页）
  window.openAskSurvey = function () {
    if (!surveyPage) { toast('批量问卷加载失败'); return; }
    surveyOpenFromChat = true;
    // #472 修复：不再隐藏桌面聊天图标（.app[data-app="chat"]）——它位于 #page-phone 内，
    // 全 .page 隐藏时本就不可见；且只 hide 不 show 会留下「返回后桌面聊天图标永久消失」隐患。
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    surveyPage.hidden = false;
    surveyRender();
  };
  // v3.33.x #523：只读「问卷详情」弹窗（点聊天里的问卷卡片打开）——题干/选项/TA 逐题作答，
  // 不再跳批量设置问卷页（用户报「点已交卷卡片却打开了批量设置问卷的页面」）。
  // #713 问卷详情（用户直派：详情里没有整体卡片的收藏、也没有单个问题的批量收藏）：
  // ①「收藏整份问卷」→ 聊天收藏夹（复用 chat.js favCardFromMsg 卡片快照/判重，含 TA 作答留档）；
  // ②逐题勾选「☆ 收藏所选」/「★ 全部收藏题目」→ 题目按文本查重后存入 问问TA 题库（我的添加·日常），
  //   单选题带选项（≥2 个才成单选，与批量导入同口径），以后可再问。
  // 弹层走 openTCPanel（TA的小问题结果面板同款壳；openModal 只塞得下纯文本、挂不了按钮）
  window.openSurveyDetail = function (rec) {
    try {
      const qs = Array.isArray(rec && rec.surveyQs) ? rec.surveyQs : [];
      const answers = Array.isArray(rec && rec.surveyAnswers) ? rec.surveyAnswers : [];
      const done = !!(rec && rec.surveyStatus === 'done');
      const nDone = answers.filter(a => typeof a === 'string' && a.trim()).length;
      if (!qs.length) { toast('这份问卷没有题目'); return; }
      // 题库文本查重（系统预设与我的添加都算「已在题库」，避免收藏出重复题）
      const bankTexts = function () {
        const set = {};
        try { (taAskLoad().questions || []).forEach(b => { if (b && b.text) set[String(b.text)] = true; }); } catch (e) {}
        return set;
      };
      let bankSet = bankTexts();
      const favStates = qs.map(q => !!bankSet[String((q && q.text) || '').trim()]);
      const actBtnCss = 'border:1px solid rgba(127,127,127,.3);background:rgba(127,127,127,.12);color:var(--ink);border-radius:99px;padding:6px 12px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer';
      let html = '';
      html += '<div class="tc-hint">' + escT('你发出的问卷 · 共 ' + qs.length + ' 题 · ' + (done ? '已交卷' : 'TA 作答中（已答 ' + nDone + '/' + qs.length + '）')) + (rec && rec.surveyTs ? '<br>' + escT('发出时间：' + fmtDeadlineText(rec.surveyTs)) : '') + '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:12px 0 2px">' +
        '<button id="sv-fav-card" style="' + actBtnCss + '">♡ 收藏整份问卷</button>' +
        '<button id="sv-fav-allbtn" style="' + actBtnCss + '">★ 全部收藏题目</button>' +
        '</div>';
      html += '<div style="display:flex;align-items:center;gap:14px;justify-content:center;margin:8px 0 10px">' +
        '<label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);cursor:pointer"><input type="checkbox" id="sv-fav-chkall" style="width:15px;height:15px">全选</label>' +
        '<button id="sv-fav-sel" style="' + actBtnCss + '">☆ 收藏所选</button>' +
        '</div>';
      html += '<div id="sv-detail-list">';
      qs.forEach((q, i) => {
        const a = answers[i];
        const aTxt = (typeof a === 'string' && a.trim()) ? (window.taFit ? window.taFit(a) : a) : '';
        const opts = (q && Array.isArray(q.options) && q.options.length) ? q.options : null;
        html += '<div class="tc-listitem" style="text-align:left">' +
          '<div class="tc-li-top">' +
          '<input type="checkbox" class="sv-fav-cb" data-i="' + i + '" style="width:16px;height:16px;flex-shrink:0;cursor:pointer">' +
          '<span class="tc-li-q">' + (i + 1) + '. ' + escT((q && q.text) || '') + (opts ? ' <span class="tc-known">单选·' + opts.length + '选项</span>' : '') + '</span>' +
          '<span class="sv-fav-state" data-i="' + i + '" style="font-size:11px;font-weight:600;color:#c2864b;flex-shrink:0;white-space:nowrap">' + (favStates[i] ? '★ 已收藏' : '') + '</span>' +
          '</div>' +
          (opts ? '<div class="tc-li-line">选项：' + escT(opts.join(' / ')) + '</div>' : '') +
          (aTxt ? '<div class="tc-li-line" style="color:#3b7a4e;font-weight:600">TA：' + escT(aTxt) + '</div>' : '<div class="tc-li-line">（未作答）</div>') +
          '</div>';
      });
      html += '</div>';
      openTCPanel('问卷详情', html);

      const syncStates = function () {
        document.querySelectorAll('#sv-detail-list .sv-fav-state').forEach(el => {
          const i = Number(el.dataset.i);
          if (el) el.textContent = favStates[i] ? '★ 已收藏' : '';
        });
      };
      // 收藏进题库：按题干精确查重；成功后就地刷新 ★ 徽标（面板保持打开，可继续读/继续选）
      const favIntoBank = function (idxList, fromAll) {
        const d = taAskLoad();
        let added = 0, dup = 0;
        idxList.forEach(i => {
          const q = qs[i];
          const text = String((q && q.text) || '').trim();
          if (!text) { dup++; return; }
          if ((d.questions || []).some(b => b && String(b.text || '') === text)) { dup++; return; }
          const nq = { id: 'q_' + Date.now() + '_' + Math.floor(Math.random() * 9999), text: text, cat: 'daily', enabled: true, isPreset: false };
          if (q && Array.isArray(q.options) && q.options.length >= 2) { nq.type = 'single'; nq.options = q.options.slice(0, 12).map(o => String(o)); }
          d.questions.push(nq);
          added++;
        });
        if (!added) { toast(fromAll ? '全部题目都已在题库里' : '所选题目都已在题库里'); return; }
        taAskSave(d);
        bankSet = bankTexts();
        qs.forEach((q, i) => { favStates[i] = !!bankSet[String((q && q.text) || '').trim()]; });
        syncStates();
        toast('已收藏 ' + added + ' 道题到问问TA题库' + (dup ? '（' + dup + ' 道已在题库）' : ''));
      };
      const cardBtn = document.getElementById('sv-fav-card');
      if (cardBtn) cardBtn.addEventListener('click', () => {
        let idx = -1;
        try {
          const mlist = (window.getChatMsgs ? window.getChatMsgs() : []) || [];
          for (let i = mlist.length - 1; i >= 0; i--) {
            const r = mlist[i];
            if (r && (r === rec || (rec.surveyTs && r.special === 'ask-survey' && r.surveyTs === rec.surveyTs))) { idx = i; break; }
          }
        } catch (e) {}
        if (idx >= 0 && window.favCardFromMsg) window.favCardFromMsg(idx);
        else toast('找不到原问卷卡片');
      });
      const allBtn = document.getElementById('sv-fav-allbtn');
      if (allBtn) allBtn.addEventListener('click', () => {
        const rest = [];
        qs.forEach((q, i) => { if (!favStates[i]) rest.push(i); });
        if (!rest.length) { toast('全部题目都已在题库里'); return; }
        favIntoBank(rest, true);
      });
      const selBtn = document.getElementById('sv-fav-sel');
      if (selBtn) selBtn.addEventListener('click', () => {
        const picked = [];
        document.querySelectorAll('#sv-detail-list .sv-fav-cb').forEach(cb => { if (cb.checked) picked.push(Number(cb.dataset.i)); });
        if (!picked.length) { toast('请先勾选要收藏的题目'); return; }
        favIntoBank(picked, false);
      });
      const chkAll = document.getElementById('sv-fav-chkall');
      if (chkAll) chkAll.addEventListener('change', () => {
        document.querySelectorAll('#sv-detail-list .sv-fav-cb').forEach(cb => { cb.checked = chkAll.checked; });
      });
    } catch (e) {}
  };
  // v3.33.x #523：关闭批量问卷页并回到聊天页（「发出后自动返回」与返回键共用；
  // enterChat 兜底缺失时回 TA 询问页，防 #472「全 .page 隐藏→底栏飞到最顶」复发）
  function surveyGoChat() {
    surveyOpenFromChat = false;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    if (window.enterChat) { window.enterChat(); return; }
    const home = document.getElementById('page-ta-ask');
    if (home) home.hidden = false;
  }
  if (surveyPage) {
    const surveyOpen = document.getElementById('ta-ask-survey-open');
    if (surveyOpen) surveyOpen.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      surveyPage.hidden = false;
      surveyRender();
    });
    const backS = document.getElementById('ta-survey-back');
    if (backS) backS.addEventListener('click', () => {
      // v3.26.x：#472 修复统一收进 surveyGoChat（恢复聊天页本体，防「全 .page 隐藏→底栏飞到最顶」）
      surveyGoChat();
    });
    const stxt = document.getElementById('ta-survey-text');
    if (stxt) {
      stxt.addEventListener('change', () => {
        const d = surveyLoad();
        d.text = stxt.value;
        d.qs = surveyParse(stxt.value);
        surveySave(d);
        surveyRender();
      });
      bindTaInpClears(stxt.parentElement);
    }
    const sdl = document.getElementById('ta-survey-deadline');
    // v3.33.x #523：整行可点（用户可能点「交卷时间（到点TA自动交卷）」文字而不是右侧小按钮）
    const sdlRow = sdl ? sdl.closest('.gs-row') : null;
    if (sdlRow) sdlRow.addEventListener('click', (e) => {
      if (e.target.closest('#ta-survey-deadline-clear')) return;
      openDeadlinePicker('交卷时间', surveyLoad().settings.deadline, (ts) => {
        const d = surveyLoad();
        d.settings.deadline = ts > 0 ? ts : 0;
        surveySave(d);
        toast(d.settings.deadline ? '交卷时间已设置：' + fmtDeadlineText(d.settings.deadline) : '交卷时间已清除');
        surveyRender();
      });
    });
    const sdlClear = document.getElementById('ta-survey-deadline-clear');
    if (sdlClear) sdlClear.addEventListener('click', () => {
      const d = surveyLoad();
      d.settings.deadline = 0;
      surveySave(d);
      if (sdl) sdl.textContent = '未设置';
      toast('交卷时间已清除');
      surveyRender();
    });
    const sprob = document.getElementById('ta-survey-prob');
    if (sprob) sprob.addEventListener('input', () => {
      const d = surveyLoad();
      d.settings.prob = parseInt(sprob.value, 10) || 0;
      surveySave(d);
      const v = document.getElementById('ta-survey-prob-val');
      if (v) v.textContent = sprob.value + '%';
    });
    // v3.33.x #523：TA 的作答是否逐条发到聊天（默认开＝与单题一致；题多怕刷屏可在发出前关掉）
    const schat = document.getElementById('ta-survey-chat');
    if (schat) schat.addEventListener('change', () => {
      const d = surveyLoad();
      d.settings.sendToChat = schat.checked;
      surveySave(d);
      toast(schat.checked ? 'TA 的每条作答都会发送到聊天消息' : 'TA 的作答只写入问卷卡片，不再逐条发到聊天消息');
    });
    const ssend = document.getElementById('ta-survey-send');
    if (ssend) ssend.addEventListener('click', surveySend);
    const sreset = document.getElementById('ta-survey-reset');
    if (sreset) sreset.addEventListener('click', () => {
      const d = surveyLoad();
      if (d.status === 'draft' && !d.answers.length) { toast('尚未发出问卷'); return; }
      d.status = 'draft'; d.answers = []; d.sentAt = 0;
      surveySave(d);
      surveyRender();
      toast('问卷已撤回（重置为草稿）');
    });
    surveyRender();
  }

  // v3.9.x：安卓键盘弹起（viewport interactive-widget=resizes-content）时 layout viewport
  // 收缩 → page-ta-ask 重排 → .ta-add 内 ce-box 文字合成层停在旧位置，表现=输入文字与
  // 输入框边框分离（框移新位、文字留旧位）。mobile-adapt.js 安卓未监听键盘做合成层同步，
  // 此处补：监听 visualViewport.resize/window.resize，防抖后对可见 .ta-add 的 ce-box 强制
  // reflow + toggle transform 触发合成层重新提交位置。仅 page-ta-ask 可见时生效，开销可控。
  var _askCeReflowT = null;
  function _reflowAskCeBoxes() {
    var page = document.getElementById('page-ta-ask');
    if (!page || page.hidden) return;
    page.querySelectorAll('.ta-add .ce-box').forEach(function (b) {
      if (b.offsetParent === null) return;
      var prev = b.style.transform;
      b.style.transform = 'translateZ(0)';
      void b.offsetHeight;
      b.style.transform = prev;
    });
  }
  function _schedAskCeReflow() {
    clearTimeout(_askCeReflowT);
    _askCeReflowT = setTimeout(_reflowAskCeBoxes, 120);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', _schedAskCeReflow);
  window.addEventListener('resize', _schedAskCeReflow);
  // v3.7.x：多桌面——会话级触发/已问题目/链计数是模块级，残留会让新桌面继承旧桌面的状态
  document.addEventListener('contact-switched', function () {
    _tcSessionTriggered = false;
    _tcAskedIds = [];
    _tcChain = 0;
    _tcuSessionTriggered = false;
    _trSessionTriggered = false;
  });
  // v3.28.x：全站原生分组/分类下拉统一换成自定义样式（含未走 bindNewGrp 的 .ta-type）
  try { if (window.cardGroups) window.cardGroups.ensureCustomSelects(); } catch (e) {}
})();
