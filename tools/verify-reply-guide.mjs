// ===== 验证脚本：#218 互动频率引导提示（纯提醒、不改任何默认值；每天最多一次） =====
// 用法：node tools/verify-reply-guide.mjs —— 直接对 src 桩环境跑，无需构建
//
// 背景（WORKLOG #218）：用户反馈「默认功能全开、概率太高」，但开关/概率集中在
// 「设置 → 回复设置」，抱怨的用户不知道入口。方案 = TA 主动消息 / 连发多条 / 互动
// 邀请随机触发且用户正看聊天页时弹可点提示条引导去设置；频控=每天最多一次
// （reply-guide-day 存当日日期，用户决策：不设总次数上限），点过提示条或手动进过
// 回复设置页即永久关闭（reply-guide-done）。模块在 reply-settings.js 尾部，
// 触发点在 chat.js 三处一行调用。
//
// 场景：
//   A 段 逻辑锚点：chat.js 三处触发调用与守卫 / 模板说明行 / 开屏兜底摘要 /
//        notice.json 摘要 / base.css 样式 在位
//   B 段 行为断言（vm 桩环境加载 reply-settings.js 真实源码，注入可拨动假时钟）：
//    B1 首次触发（聊天页可见）→ 提示条 show + 落当日日期 + 文案含设置入口
//    B2 聊天页不可见 → 不弹、不占当日名额（日期键不落盘）、提示条不创建
//    B3 同日再次触发 → 静默（每天最多一次）
//    B4 次日再触发 → 可再弹（每日提醒），日期更新
//    B5 点击提示条 → done 落盘 + 跳转（设置 tab 与回复设置入口行各被点一次）+ 收起
//    B6 done 后次日再触发 → 仍完全静默
//    B7 手动点开过回复设置页 → done 落盘，之后触发静默且提示条从未创建
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- A 段：逻辑锚点 ----
const chatSrc = read('src/js/chat.js');
check('A1 chat.js 主动消息触发点', chatSrc.includes("window.replyGuideHint('as')"));
check('A2 chat.js 连发多条触发点', chatSrc.includes("window.replyGuideHint('py')"));
check('A3 chat.js 互动邀请触发点', chatSrc.includes("window.replyGuideHint('inv')"));
check('A4 三处触发均带存在性守卫', (chatSrc.match(/window\.replyGuideHint\) window\.replyGuideHint\('/g) || []).length === 3);
const tplSrc = read('src/template.html');
check('A5 回复设置页顶部说明行', tplSrc.includes('reply-guide-note'));
check('A6 开屏静态兜底含引导摘要', tplSrc.includes('嫌频繁可在 设置 → 回复设置'));
check('A7 notice.json 摘要含引导行', read('src/pwa/notice.json').includes('嫌频繁可在 设置 → 回复设置'));
check('A8 base.css 提示条样式在位', read('src/css/base.css').includes('#reply-guide-hint'));

// ---- B 段：vm 桩环境（加载 reply-settings.js 真实源码） ----
const pad2 = (n) => String(n).padStart(2, '0');
const dayStr = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
function makeEnv({ preset, hidden } = {}) {
  const store = new Map();
  if (preset) Object.keys(preset).forEach((k) => store.set(k, preset[k]));
  const clicks = { tab: 0, row: 0 };
  const rowListeners = [];
  const barClick = { fn: null };
  let bar = null;
  const pageChat = { hidden: !!hidden };
  // 假时钟：测试里用 setNow() 拨动「今天」（覆盖模块内的 new Date()）
  let now = new Date(2026, 8, 6, 10, 0, 0); // 2026-09-06 起始
  function makeBarEl() {
    const classes = new Set();
    const txt = { textContent: '' };
    return {
      id: 'reply-guide-hint', _rgT: null, _txt: txt, _classes: classes,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c)
      },
      innerHTML: '',
      querySelector: () => txt,
      addEventListener: (ev, fn) => { if (ev === 'click') barClick.fn = fn; }
    };
  }
  const rowEl = {
    click: () => { clicks.row += 1; rowListeners.forEach((fn) => fn()); },
    addEventListener: (ev, fn) => { if (ev === 'click') rowListeners.push(fn); }
  };
  const tabEl = { click: () => { clicks.tab += 1; } };
  const documentStub = {
    getElementById: (id) => {
      if (id === 'reply-guide-hint') return bar;
      if (id === 'page-chat') return pageChat;
      if (id === 'row-general') return rowEl;
      return null;
    },
    querySelector: (sel) => (String(sel).indexOf('page-setting') !== -1 ? tabEl : null),
    querySelectorAll: () => [],
    createElement: () => { bar = makeBarEl(); return bar; },
    body: { appendChild: () => {} },
    addEventListener: () => {}
  };
  const ls = {
    get: (k) => (store.has(k) ? store.get(k) : null),
    set: (k, v) => { store.set(k, String(v)); }
  };
  const ctx = {
    console,
    setTimeout: () => 0, // 桩：不真排队，防 12s 自动收起定时器挂住测试进程
    clearTimeout: () => {},
    // new Date() 桩：返回可拨动的当前日期（模块只用 getFullYear/getMonth/getDate）
    Date: function () {
      return {
        getFullYear: () => now.getFullYear(),
        getMonth: () => now.getMonth(),
        getDate: () => now.getDate()
      };
    },
    document: documentStub,
    activePrefix: () => 'test-cid',
    activeStore: () => ls
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('src/js/reply-settings.js'), ctx, { filename: 'reply-settings.js' });
  return {
    ctx, store, clicks, barClick, barRef: () => bar, rowListeners, pageChat,
    setNow: (d) => { now = d; },
    today: () => dayStr(now)
  };
}

const DAY1 = new Date(2026, 8, 6, 10, 0, 0);
const DAY2 = new Date(2026, 8, 7, 9, 0, 0);
const DAY3 = new Date(2026, 8, 8, 9, 0, 0);

// env1：B1 首次触发 → 同日静默 → 次日可再弹 → 点击关闭 → done 后永久静默
const env = makeEnv();
env.ctx.replyGuideHint('as');
let b = env.barRef();
check('B1 首次触发弹提示并落当日日期', b && b._classes.has('show') && env.store.get('reply-guide-day') === env.today());
check('B1b 文案含「随机」与设置入口', b && (b._txt.textContent || '').indexOf('随机') !== -1 && (b._txt.textContent || '').indexOf('回复设置') !== -1);

// B3 同日再次触发 → 静默
b._classes.delete('show');
env.ctx.replyGuideHint('py');
check('B3 同日重复触发静默（每天最多一次）', !b._classes.has('show') && env.store.get('reply-guide-day') === env.today());

// B4 次日再触发 → 可再弹
env.setNow(DAY2);
env.ctx.replyGuideHint('inv');
check('B4 次日再触发可再弹（每日提醒）', b._classes.has('show') && env.store.get('reply-guide-day') === env.today() && env.today() === dayStr(DAY2));

// B5 点击提示条 → done + 跳转 + 收起
env.barClick.fn();
check('B5 点击落 done 并跳转回复设置', env.store.get('reply-guide-done') === '1' && env.clicks.tab === 1 && env.clicks.row === 1 && !b._classes.has('show'));

// B6 done 后次日再触发 → 仍静默
env.setNow(DAY3);
env.ctx.replyGuideHint('as');
check('B6 done 后次日再触发仍静默', !b._classes.has('show') && env.store.get('reply-guide-day') === dayStr(DAY2));

// env2：B2 聊天页不可见 → 不弹、不占当日名额（日期键不落）、提示条不创建
const env2 = makeEnv({ hidden: true });
env2.ctx.replyGuideHint('as');
check('B2 页不可见不弹且不占当日名额', env2.barRef() === null && !env2.store.has('reply-guide-day'));
env2.pageChat.hidden = false;
env2.ctx.replyGuideHint('as');
check('B2b 同日随后可见时仍可弹（名额未被占）', env2.barRef() !== null && env2.barRef()._classes.has('show') && env2.store.get('reply-guide-day') === env2.today());

// env3：B7 手动进过回复设置页 → done 落盘，提示条从未创建
const env3 = makeEnv();
env3.rowListeners.forEach((fn) => fn());
check('B7a 手动进过回复设置页即落 done', env3.store.get('reply-guide-done') === '1');
env3.ctx.replyGuideHint('as');
check('B7b 之后触发静默且提示条从未创建', env3.barRef() === null);

// ---- 汇总 ----
const fails = results.filter((r) => !r.ok).length;
console.log('----\n' + (results.length - fails) + '/' + results.length + ' 通过');
process.exit(fails ? 1 : 0);
