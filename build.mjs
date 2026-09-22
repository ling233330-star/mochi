// ===== 组装脚本 =====
// 把 src/ 下的模板 + 按页面拆分的 CSS + 按功能拆分的 JS
// 拼装成单个可直接双击打开的 index.html（完整功能）。
// 用法：在 mochi 目录下运行  node build.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// ===== --check-sentinels：只检查不构建（v3.27.x，防覆盖专用）=====
// 用法：node build.mjs --check-sentinels
// 非构建者改完 src/ 后跑它：不写任何产物，只对照 src/ 检查每条修复哨兵的
// 逻辑锚点是否仍在位（覆盖 = src 里 needle 丢失，直接报红退出 1）。
// 产物缺失在这模式下只警告不算失败（还没构建，产物旧是正常的）——
// 真正的覆盖是「src 里也没有」，那是修复真被整块删掉。
const CHECK_SENTINELS = process.argv.includes('--check-sentinels');

// ===== 构建前健康检查（v3.6.x） =====
// 防止把「未完成的改动 / 调试脚本」混进产物——历史教训：构建者跑 build 时工作区里
// 有对方进行中的改动，产物悄悄带上半成品；tools/tmp-*.mjs / smoke-*.mjs 调试脚本
// 也险些被 add -A 提交。检出时醒目警告（不阻止构建，构建者自行判断；
// AGENTS.md 约定构建前 git status 核对）。
try {
  const out = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '';
  const lines = out.split('\n').filter(Boolean);
  // 所有未跟踪的 .mjs 调试脚本（tmp-*/smoke-*/verify-* 等临时工具）
  const tmpUntracked = lines.filter(l => l.startsWith('??') && /[\w.-]*\.mjs/.test(l));
  const modified = lines.filter(l => !l.startsWith('??'));
  if (tmpUntracked.length) {
    console.warn('⚠️  检测到未跟踪调试脚本（.mjs，可能是临时工具）：\n  ' + tmpUntracked.join('\n  ') + '\n  请确认这些不要随产物提交（建议加进 .gitignore 或删除）。');
  }
  if (modified.length) {
    console.warn('⚠️  工作区有未提交改动 ' + modified.length + ' 个文件：\n  ' + modified.map(l => '  ' + l.slice(0, 90)).join('\n') + '\n  构建产物会包含这些改动——请确认对方已保存完整（AGENTS.md：不夹带未完成的一半改动）。');
  }
} catch (e) { /* 非 git 环境 / git 不可用：跳过检查 */ }

// ===== 构建信息（开屏显示 + sw 缓存版本号，v3.5.54） =====
const buildTime = new Date();
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const buildInfo = '部署于 ' + buildTime.getFullYear() + '-' + pad(buildTime.getMonth() + 1) + '-' + pad(buildTime.getDate()) +
  ' ' + pad(buildTime.getHours()) + ':' + pad(buildTime.getMinutes());
const buildStamp = buildTime.getTime().toString(36); // sw 缓存名版本号（每次构建必变）
// 应用版本号（设置页底部与开屏共用）
// v8 系列起：版本号 v8.<提交数÷10 取整>，总共三位数字（提交数 258 → v8.25），
// 每提交 10 次 +0.1（258 → v8.25，260 → v8.26，300 → v8.30）。
// SW 缓存刷新依赖的是上面的 buildStamp（每次构建必变），与 APP_VERSION 无关。
// 非 git 环境（脚本被拷贝/CI 无 git）回退 v8.0 兜底。
let APP_VERSION = 'v8.35'; // 仓外隔离副本兜底直置（主树 execSync 自动取；#1011 批按 git rev-list --count 现值对齐，勿回退）
try {
  const cnt = execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (cnt && /^\d+$/.test(cnt)) APP_VERSION = 'v8.' + Math.floor(parseInt(cnt, 10) / 10);
} catch (e) { /* 无 git：保持兜底 */ }

// ===== 零依赖保守压缩 =====
// 只删注释/空行/缩进，不改任何代码语义（无依赖、无解析器）。
// 已核查全项目：无模板字符串插值（${}）、无 eval、无跨行反引号/字符串续行——
// 逐行处理 JS 安全；CSS 块注释可跨行、字符串内不含 /* ，整文件非贪婪匹配安全。
// 超长单行（如 default-cards-data.js 6.5 万字符的数据 JSON 行）整行保留不动。
const MINIFY_KEEP_LINE = 8000;
function minifyJs(code) {
  const lines = code.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length > MINIFY_KEEP_LINE) { out.push(raw); continue; } // 数据行原样保留
    const t = raw.trim();
    if (!t) continue;                   // 空行
    if (t.startsWith('//')) continue;   // 整行 // 注释（行内尾注释不动，字符串/URL 里可能有 //）
    out.push(t);                        // 去行首缩进 + 行尾空白
  }
  return out.join('\n');
}
function minifyCss(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\/\s*/g, '') // 块注释（含跨行）
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

// ===== 按顺序拼接样式 / 脚本（顺序即生效顺序） =====
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css', 'applock.css', 'feature-data.css', 'display-tune.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'applock.js', 'card-lock.js', 'dcp-master.js', 'media-pool.js','storage-slim.js', 'perf-check.js', 'energy-check.js', 'flash-check.js', 'img-compress.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'dict-ext-data.js', 'default-cards.js', 'quote-spell.js', 'dream-free.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'incoming-requests.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'gomoku.js', 'linkup.js', 'match3.js', 'auction.js', 'arcade.js', 'mood-diary.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'feature-data.js', 'pwa.js', 'ver-check.js', 'cjian.js', 'feature-hub.js', 'settings-help.js', 'onboarding.js', 'page-coach.js', 'card-audit.js', 'mobile-adapt.js'];

// ===== PERF-PLAN 阶段 1：JS 外置化（2026-09-18）=====
// 首开「3.8MB 内联 JS 主线程整段解析执行」是 iOS/中低端安卓卡顿的结构性大头
//（PERF-PLAN §0 实测：首次使用、零数据也卡）。外置 = <script defer src="js/<file>">：
// 浏览器流式编译 + 并行下载（defer 不阻塞解析、DOMContentLoaded 前按文档序执行），
// SW 逐文件缓存 + GH Pages ETag 304（不带构建戳、未改文件字节不变 → 只下变更文件）。
//
// ===== PERF-PLAN 阶段 1b：core 全外置（2026-09-19，iOS 全机型「打开就卡」根治）=====
// 六份 iOS 诊断（15PM×2 / 14×2 / 12 / 16PM）共同形态：与数据量无关、与使用无关，
// DCL 1.8~8.3s（iPhone 12 达 8.3s）、首开零数据也卡——机制＝2.9MB 内联 JS 塞在 HTML 里，
// iOS WebKit 解析期整段同步编译（阶段 1.5 消融：内联搬出即 DCL −513ms、数据就绪 −367ms、
// index 4534→1223KB，无头是下界、iOS 只会更痛）。清单改为「除 3 件系统件外全外置」：
// · 粒度＝一功能文件一个 js/<file> 资源（消融实证：合成大块把单次冻结峰值 308→481ms）；
// · 顺序＝extFiles 即 jsFiles.filter 产物，天然保持 jsFiles 原序（D2），执行时序回到
//   外置化之前的单包语义，「core 不依赖 ext 加载期全局」这条隐性约束作废；
// · 留内联仅 3 件系统件（D4-B 口径，~176KB minify 后）：device.js（系统基座/诊断分母）、
//   pwa.js（#802 自愈引擎必须在火场里——pwa.js 自己 404 时没人重注入）、ver-check.js
//   （依赖 pwa 的 mochiRefreshNow，与 pwa 同段保序）；
// · ta-ask/records/p2-features 等当年「保守留 core」的顾虑随 D2 消失：全 defer 下执行
//   顺序=jsFiles 原序，与单包一致，不存在「core 先行、ext 整体后移」的次序漂移。
// 改这份清单必须同步看 PERF-PLAN §2 的分级规则与 tools/verify-ext-boot.mjs 裁决门。
const CORE_KEEP_INLINE = { 'device.js': 1, 'pwa.js': 1, 'ver-check.js': 1 };
const extFiles = jsFiles.filter(f => !CORE_KEEP_INLINE[f]);
const extSet = new Set(extFiles);
const coreFiles = jsFiles.filter(f => !extSet.has(f));

let html = read('template.html');
// v3.26.x #301：模板 HTML 注释配平守卫——开屏批 07a6cab 曾在红包注释行漏写 `-->`
// （结尾误成 `*/}`），注释一路吞到下一个 `-->`，净少吃一个 `<div class="set-group">`
// 开标签：后续 `</div>` 连锁把 them-sec → #page-chat-settings → .phone 手机壳全部
// 提前闭合，底部导航 .tabbar/音乐悬浮窗/消息弹窗等落成 body 直接子节点；body 是
// flex 横排居中，手机壳与 tabbar 并排坐＝整壳被推左出屏 ~59px、tabbar 挤出屏右、
// 右侧露灰底（2026-09-11 用户报「手机端 UI 完全乱了」实锤，div 总数恰好配平所以
// 肉眼/普通 diff 查不出）。此处构建时硬校验注释标记必须成对，失衡直接退出。
{
  const opens = (html.match(/<!--/g) || []).length;
  const closes = (html.match(/-->/g) || []).length;
  if (opens !== closes) {
    console.error('✗ 模板 HTML 注释配平失败：<!-- ' + opens + ' 个 vs --> ' + closes + ' 个——存在未闭合注释，会把后续标签吞进注释、连锁打碎 .phone 手机壳结构（#301）。用 grep -n "<!--" src/template.html 逐个核对最近的注释改动。');
    process.exit(1);
  }
}
const styles = cssFiles.map(f => minifyCss(read(join('css', f)))).join('\n');
// 每个 JS 文件独立 try/catch 包裹：单文件运行时报错不再连坐后续所有功能
// （如某个文件在特定设备抛错，之前会导致之后文件的绑定全部失效）

// v3.27.x：拆 script 块（修复 iOS 15 开屏无限刷新白屏）——
// 产物单块内联脚本曾达 2.85MB，iOS 15 的 WebKit(615)/JavaScriptCore 对超大单块
// script 解析会触发内存限制 → WebContent 进程崩溃 → Safari 显示「此页面出现问题」
// 并自动重新加载 → 每加载必崩 → 无限刷新循环 → 白屏打不开（iOS 上所有浏览器都是
// WebKit 内核，故「所有浏览器」现象一致）。拆成多块后每块远小于引擎单块解析上限，
// 块间保持 jsFiles 顺序（依赖前置不变），全局 window 共享不受影响。
// v3.26.x #91：按 UTF-8 字节数而非字符数计量——原用 s.length（UTF-16 码单元数），
// 中文注释 1 字符 .length=1 但 UTF-8 占 3 字节；产物写盘/WebKit 解析均按字节，导致
// 「字符数 600K」的块实际字节数达 1.4MB+，仍触发 WebKit 单块解析崩溃 → iOS 15/18
// Safari 无限自动刷新白屏（用户诊断：DOM 就绪 36s、SW 不支持、刷新打不开）。改用
// Buffer.byteLength 后每块真实字节数 ≤ 上限，iOS WebKit 不再崩溃。
const SCRIPT_CHUNK_LIMIT = 500 * 1024; // 每块 UTF-8 字节数上限（500KB，留余量低于 iOS 15 单块安全阈值）
function chunkScripts(items) {
  const chunks = [];
  let cur = [];
  let size = 0;
  const byteLen = (s) => Buffer.byteLength(s, 'utf8');
  items.forEach(function (s) {
    const sl = byteLen(s);
    if (size + sl > SCRIPT_CHUNK_LIMIT && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(s); size += sl;
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}

// 每个 JS 文件独立 try/catch 包裹：单文件运行时报错不再连坐后续所有功能
// （如某个文件在特定设备抛错，之前会导致之后文件的绑定全部失效）
// v3.34.x #527：模块加载体检——每个包内 try 末行（=文件整段执行完成才到达）登记
// __mochiLoaded；catch 里的 __jsErrors 追加文件名（原只 push message，诊断「启动文件
// 异常」无法归因到文件）。运行期用 __mochiLoaded vs 构建期注入的 __mochiJsFiles 求差，
// 定位「整段没加载」的文件——补 __jsErrors 的盲区：语法错误在 parse 期抛出，包内
// try/catch 兜不住，且每个 500KB script 块内任一文件语法错会整块不执行（十几个功能一起死）。
const jsWrapped = coreFiles.map(f => {
  const code = minifyJs(read(join('js', f)));
  // #939a：catch 里登记 __mochiErrLoaded——「网络没取到」（连 IIFE 都没进）与「取到了但
  // 运行期抛错」必须分开：后者文件已在本地、重试/重载永远无效，算进 missing() 会让
  // 「网络不佳·点此重试」条永挂 + #921h 每 2 小时白重载一次。#527 差集诊断语义不变
  // （device.js 仍用 __mochiLoaded 差集定位「整段没跑完」，错误文件照旧进 __jsErrors 归因）。
  return '(function () { try {\n' + code + '\nif (window.__mochiLoaded) window.__mochiLoaded.push("' + f + '");\n} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("' + f + '"); try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[' + f + '] " + String(__e && __e.message || __e)); } })();';
});
// 首块前置初始化：错误环 + 已加载清单 + 期望清单（jsFiles 即期望，运行期差集定位死块）
jsWrapped.unshift('window.__jsErrors = window.__jsErrors || []; window.__mochiLoaded = window.__mochiLoaded || []; window.__mochiErrLoaded = window.__mochiErrLoaded || []; window.__mochiBootAt = Date.now(); window.__mochiJsFiles = ' + JSON.stringify(jsFiles) + '; window.__mochiExtFiles = ' + JSON.stringify(extFiles) + ';');
// 按 UTF-8 字节上限拆 script 块（iOS 15 单块解析崩溃防护，见上方注释）
// #860 开屏看门狗（PERF-PLAN 阶段 1b D4.2）：core 归零后「进桌面」改由网络上的 defer 文件
// 完成，弱网/被墙窗口下开屏会永久定格——本段是唯一不依赖网络就能跑的结构件。
// load 后 3s/8s 两查 __mochiDataReady，仍未就绪就挂「网络不佳·点此重试」条（复用
// ver-update-bar 样式），点击走 __mochiBootRetry()=整页重载。数据已就绪则静默零开销。
// #939e（2026-09-20 用户：「完整的文件里不应该出现检测网络的弹窗，本地本来就没有网络」）：
//   file:// 直开（单文件完整版/双击本地 index）两个误报源都成立——①无网络可修、
//   「点此重试」整页重载救不了任何东西；②Chrome 对 file:// 源的 indexedDB.open
//   永久挂起（无 onsuccess/onerror，实测探针 T+6s 仍无终态）→ idbRestore 的
//   sendReady 永不执行 → __mochiDataReady 恒为 false → 看门狗 3s 必弹且 sweep
//   永不摘除＝「挡住使用」。与 #386 版本轮询 file:// 跳过同一先例：file:// 一律不弹。
//   同时 page 内无任何 <script src>（单文件自包含形态，如工具导出的完整版）时，
//   即使托管在 http(s) 上也没有「外部模块没加载」这回事，同样不弹不自愈。
jsWrapped.push(
  'window.__mochiBootRetry = function () { try { location.reload(); } catch (e) {} };' +
  '(function () {' +
  ' function selfContained() { try { return location.protocol === "file:" || !document.querySelector("script[src]"); } catch (e0) { return false; } }' +
  ' function bar() {' +
  '  if (selfContained()) return;' +
  '  if (document.getElementById("boot-retry-bar")) return;' +
  // #939e：用户点过「知道了」＝本次会话（标签页/重载后）不再弹——提醒条不得纠缠用户；
  // 新开标签页/隔天回来标志自然失效，真网络问题仍可从头看到提示。
  '  var off = 0; try { off = sessionStorage.getItem("mochi-boot-bar-off") === "1" ? 1 : 0; } catch (e6) {}' +
  '  if (off) return;' +
  '  var b = document.createElement("div");' +
  '  b.className = "ver-update-bar"; b.id = "boot-retry-bar"; b.style.cursor = "pointer";' +
  // #939f：两个按钮＋12 字文案在 320px 级窄屏（可用约 292px）放不下一行＝按钮被截出屏
  // 外「知道了点不到」——只在本条内联换行，.ver-update-bar 共用样式与其他顶条零影响。
  '  b.style.flexWrap = "wrap"; b.style.rowGap = "6px";' +
  '  b.innerHTML = "<span class=\\"vub-txt\\">网络不佳·部分功能没加载完</span><b class=\\"vub-act\\">点此重试</b><b class=\\"vub-act\\" id=\\"boot-retry-off\\">知道了</b>";' +
  '  b.addEventListener("click", function () { window.__mochiBootRetry(); });' +
  '  var x = b.querySelector("#boot-retry-off");' +
  '  if (x) x.addEventListener("click", function (ev) { ev.stopPropagation(); try { sessionStorage.setItem("mochi-boot-bar-off", "1"); } catch (e7) {} if (b.parentNode) b.parentNode.removeChild(b); });' +
  '  (document.body || document.documentElement).appendChild(b);' +
  ' }' +
  // #921h：模块缺失自愈——load 已发生＝全部 defer 请求已终态，此刻仍缺模块＝确定性加载失败
  // （华为 nova13 Edge 实纸：59 件外置模块全灭、连内联 pwa.js 都没跑＝更新条/版本轮询同为死件，
  // 页面永远停在死包上没有任何自愈。自动整页重载一次＝顺带触发 SW 更新检查拿新包+补缓存；
  // sessionStorage 2 小时一次守卫防弱网循环刷屏；离线不动、重试条照旧兜底。）
  // #939c：missing() 只数「真没执行到位」的模块（网络失败/整块 parse 死），运行期抛错的
  // 文件在 __mochiErrLoaded 里、不进口径——它与网络无关，重试重载永远无效（见 #939a）。
  ' function missing() { var e = window.__mochiJsFiles || [], g = window.__mochiLoaded || []; return Math.max(0, e.length - g.length - (window.__mochiErrLoaded || []).length); }' +
  ' function heal() {' +
  '  try {' +
  '   if (window.__mochiDataReady && missing() === 0) return;' +
  '   if (selfContained()) return;' +
  '   if (!navigator.onLine || missing() === 0) return;' +
  '   var now = Date.now(), last = 0;' +
  '   try { last = Number(sessionStorage.getItem("mochi-boot-heal")) || 0; } catch (e2) {}' +
  '   if (now - last < 7200000) return;' +
  '   try { sessionStorage.setItem("mochi-boot-heal", String(now)); } catch (e3) {}' +
  '   setTimeout(function () { try { location.replace(location.href); } catch (e4) {} }, 400);' +
  '  } catch (e) {}' +
  ' }' +
  // #939d：健康即撤条 + 事件复查——条只查 load+3s/8s 两次、挂上后永不摘除＝慢机/大数据量
  // 回填超过 3s 就被误标「网络不佳」，之后数据就绪了条也不消失，点重试整页重载再走一遍
  // 同样时序又挂上＝用户所见「一直显示、刷新也没用」。现在条件转健康（数据就绪且无缺模块）
  // 时当场摘条；并挂 mochi-restore-done（idb.js sendReady 派发）复查一次，覆盖「3s/8s 时
  // 还没就绪、之后才就绪」的主通道。判据取运行期状态，无任何机型分支。
  // （健康判据自包含：直接按期望清单与两份登记清单求差，不引用 #921h 的 missing()——
  //   本批提交形态＝HEAD＋仅本批、#921h 尚在途；两者读同一组清单，语义一致。）
  ' function sweep() { var ex = (window.__mochiJsFiles || []).length, ok = !!window.__mochiDataReady && ex - (window.__mochiLoaded || []).length - (window.__mochiErrLoaded || []).length <= 0; var b = ok && document.getElementById("boot-retry-bar"); if (b && b.parentNode) b.parentNode.removeChild(b); return ok; }' +
  ' function check(auto) { var ok = sweep(); if (!ok) bar(); if (auto && typeof heal === "function") heal(); }' +
  ' try { document.addEventListener("mochi-restore-done", function () { setTimeout(sweep, 50); }); } catch (e5) {}' +
  ' if (document.readyState === "complete") { setTimeout(function(){check(false);}, 3000); setTimeout(function(){check(true);}, 8000); }' +
  ' else window.addEventListener("load", function () { setTimeout(function(){check(false);}, 3000); setTimeout(function(){check(true);}, 8000); });' +
  '})();'
);
const scriptChunks = chunkScripts(jsWrapped);
// 按 UTF-8 字节上限拆 script 块（iOS 15 单块解析崩溃防护，见上方注释）

// PERF-PLAN 阶段 1：外置文件用与内联完全相同的包装（minify + IIFE try/catch +
// __mochiLoaded 登记 + catch 写 __jsErrors）——诊断归因不分家、行为语义一致。
const extWrapped = extFiles.map(f => {
  const code = minifyJs(read(join('js', f)));
  return '(function () { try {\n' + code + '\nif (window.__mochiLoaded) window.__mochiLoaded.push("' + f + '");\n} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("' + f + '"); try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[' + f + '] " + String(__e && __e.message || __e)); } })();';
});

// #860 D3 体积红线：外置单文件 >500KB 报警——外置文件是独立资源、流式编译，不受 iOS 15
// 「单块内联 script 解析崩溃」红线约束（自动留内联反而违反「inline 恒先于全部 defer」的
// 顺序语义），故只报警交给构建者裁断，不静默。
extWrapped.forEach((code, i) => {
  const n = Buffer.byteLength(code, 'utf8');
  if (n > SCRIPT_CHUNK_LIMIT) console.error('⚠ #860 体积红线：js/' + extFiles[i] + ' 外置后 ' + Math.round(n / 1024) + 'KB > 500KB（外置资源不受 iOS15 单块内联红线约束，但请人工确认可接受）');
});

// v3.15.x：改用函数返回值注入——字符串替换会把包内 $&/$'/$` 当特殊模式处理，
// 源码里出现这些序列（正则/模板片段）时产物被静默撑爆+残留占位符（2026-08-26 实测踩坑）
html = html.replace('/*__STYLES__*/', () => styles);
// v3.27.x：多块注入——第一块沿用模板内既有 <script>，后续块用 </script><script> 分隔，
// 每个功能文件仍是独立 IIFE+try/catch，块间顺序执行语义不变
html = html.replace('/*__SCRIPTS__*/', () =>
  scriptChunks.map((c, i) => (i === 0 ? c.join('\n') : '</script>\n<script>' + c.join('\n'))).join('\n')
);
// PERF-PLAN 阶段 1/1b：外置脚本注入（defer）——锚在主内联 script 元素闭合之后；
// defer 保证 DOM 解析完、DOMContentLoaded 前按文档序执行。1b 后 extFiles 即 jsFiles
// 原序（仅 3 件系统件留内联），执行时序=外置化之前的单包语义；3 件内联系统件先行、
// 其余 79 件按 jsFiles 原序 defer 接续。加载失败面由 tools/verify-ext-boot.mjs（404 桩
// 裁决门）+ pwa.js #802 自愈引擎 + #860 开屏看门狗三层兜住。
// #802a：每条外置标签挂 onerror，拉取失败的文件记入 __mochiExtFail（error 是终态，
// 原标签绝不会再执行 ⇒ pwa.js 自愈引擎按这份清单重注入不会双执行；只信 onerror、
// 不信「没在 __mochiLoaded」——后者还可能是仍在慢下载中的文件，拿去重注入＝双执行）。
html = html.replace('<!-- __SCRIPTS_EXT__ -->', () =>
  extFiles.map(f => '<script defer src="js/' + f + '" onerror="window.__mochiExtFail=(window.__mochiExtFail||[]).concat(\'' + f + '\')"></script>').join('\n')
);
// 注入部署时间（开屏显示）
html = html.replace('__BUILD_INFO__', buildInfo);
// 注入当前构建时间戳（页面自身版本基线，v3.7.x）——
// pwa.js 版本检测用它当基线，不再依赖「首次 fetch 的 version.json 时间戳」：
// 旧缓存页面 + 网络拿到最新 version.json 时，旧逻辑把最新时间戳当基线 → 永不提示
// 更新；注入页面自身的部署时间戳后，任何比它新的 version.json 都会触发更新提示
html = html.split('__BUILD_TS__').join(String(buildTime.getTime()));
// 版本号两处（开屏 + 设置页底部）都要替换：replace 用字符串只替换第一处，改用 split/join 全局替换
html = html.split('__APP_VERSION__').join(APP_VERSION);

// v3.26.x #134：EOF 兜底标记——写在 </html> 之后（HTML 语法上仍合法，解析器忽略
// </html> 后的尾随注释）。template.html 里 body 末已有 id=mochi-html-eof 锚点 +
// 一份 __MOCHI_EOF__ 注释；这里再加一份于文档最末字节处，确保「哪怕 body 尾部
// 几百字节被截断，SW 完整性校验仍能判定残缺」。sw.js isCompleteHtml 靠它判定。
html += '\n<!-- __MOCHI_EOF__ ' + buildStamp + ' -->\n';

// v3.26.x #797 结构闸：模板尾部破损（说明文字漏出注释外→样本标签变野 <script>）曾让正文裸奔出
// 白色乱码条（body 级，所有页面可见），并把 #pwa-install/#pwa-ios-hint/#mochi-html-eof 连同
// </body> 整段吞进一个永不执行的死脚本（实测产物 45 开 44 闭）。三道硬校验，任一失守 exit 1：
// ① script 开/闭标签数必须相等（主闸：位置检查看不出「脚本体未闭合吞尾」）；② 尾部三锚点必须
// 存在且都在最后一个 </script> 之后；③ 不得含 src="js/*.js" 样本标签（注释文字漏出的指纹）。
(function () {
  const opens = (html.match(/<script\b/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  const lastClose = html.lastIndexOf('</script>');
  const bad = [];
  if (opens !== closes) bad.push('script 开/闭标签数不等（' + opens + ' 开 / ' + closes + ' 闭）＝有未闭合标签吞尾部 DOM');
  ['id="pwa-install"', 'id="pwa-ios-hint"', 'id="mochi-html-eof"'].forEach(function (t) {
    if (html.indexOf(t) < 0 || html.indexOf(t) < lastClose) bad.push('尾部锚点 ' + t + ' 缺失或被吞进脚本体');
  });
  if (html.indexOf('src="js/*.js"') >= 0) bad.push('产物含样本标签 src="js/*.js"＝模板注释文字漏出注释外');
  if (bad.length) { console.error('❌ #797 结构闸：' + bad.join('；') + '（查 src/template.html 尾部注释是否被改破）'); process.exit(1); }
})();

if (!CHECK_SENTINELS) {
// PERF-PLAN 阶段 1：写外置产物 js/<file>——先清空目录（防文件改名/移回 core 后旧文件
// 残留，被 sw precache 扫到、被提交进库）；不带构建戳（PERF-PLAN §3：未改文件字节
// 不变 → GH Pages ETag 304 → 增量更新只下变更文件）。
const jsDir = join(root, 'js');
rmSync(jsDir, { recursive: true, force: true });
mkdirSync(jsDir, { recursive: true });
extWrapped.forEach((code, i) => writeFileSync(join(jsDir, extFiles[i]), code));
console.log('已外置 ' + extFiles.length + ' 个 JS → js/（' + extWrapped.reduce((n, c) => n + Buffer.byteLength(c, 'utf8'), 0) + ' 字节）；core 内联 ' + coreFiles.length + ' 个文件');
const out = join(root, 'index.html');
writeFileSync(out, html);
console.log('已生成 index.html（' + html.length + ' 字节，' + (html.split('\n').length) + ' 行）');

// v3.6.x：生成版本文件 version.json（部署到站点根目录）——
// 手机端靠它检测新版本（fetch 对比时间戳），不依赖 Service Worker 更新机制
//（sw 只在页面加载/导航时检查、iOS Safari 检测不可靠，开着旧页面永远收不到提醒）。
const versionJson = JSON.stringify({ ts: buildTime.getTime(), info: buildInfo });
writeFileSync(join(root, 'version.json'), versionJson);
console.log('已生成 version.json（' + versionJson + '）');

// ===== 复制 PWA 文件到根目录（随 GitHub Pages 部署） =====
// sw.js 缓存名改为每次构建的 buildStamp → 新版本部署后老缓存自动失效，强制更新
const pwaFiles = ['manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon-maskable-512.png', 'notice.json'];
pwaFiles.forEach(f => copyFileSync(join(root, 'src', 'pwa', f), join(root, f)));
const swPath = join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE = 'mochi-[^']*';/, "const CACHE = 'mochi-" + buildStamp + "';");
sw = sw.replace(/const BUILD_INFO = '[^']*';/, "const BUILD_INFO = '" + buildInfo + "';");
if (!sw.includes('const BUILD_INFO')) {
  sw = sw.replace("const CACHE = 'mochi-" + buildStamp + "';", "const CACHE = 'mochi-" + buildStamp + "';\nconst BUILD_INFO = '" + buildInfo + "';");
}
// PERF-PLAN 阶段 1：sw 预缓存带上外置清单（离线首启/弱网首装才有 ext 可用）；
// 完整性校验 isCompleteHtml 只对 index 生效（sw.js isIndexUrl 分支），js 文件直接 c.put。
sw = sw.replace(/const PRECACHE = \[[^\]]*\];/, 'const PRECACHE = ' + JSON.stringify(['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png'].concat(extFiles.map(f => './js/' + f))) + ';');
writeFileSync(swPath, sw);
console.log('已复制 PWA 文件 → ' + pwaFiles.join(', ') + '（sw 缓存版本: mochi-' + buildStamp + '）');
} else {
  console.log('--check-sentinels：跳过构建（不写产物），仅对照 src/ 检查修复锚点是否在位。');
}

// ===== 关键修复哨兵（v3.16.x） =====
// 历史教训：修复被并行会话覆盖 / 编辑器旧缓冲回写 / 新文件漏接入 build.mjs，
// 都会让「已修复的问题在新版本复发」，且构建/布局检查照常通过、无人发现。
// 构建完成后对产物做特征检查——每个曾用户反馈过的关键修复对应一个代码特征
// （函数名/常量/选择器）。特征缺失 = 修复可能被覆盖 → 醒目警告（不阻断构建，
// 构建者自行判断；有对应 verify-xxx.mjs 的可补跑确认）。
// 删除型修复（移除某功能/入口）：加 { absent: true }，表示 needle 出现在产物中才报警
// （防止并行会话/旧缓冲把已移除的代码改回来）。
// 维护：新增关键修复时在此登记一行 { name, file, needle }（needle 为产物中的特征串）。
const FIX_SENTINELS = [
  /* ==== 2026-09-19 #860 iOS 全机型「打开就卡、零数据也卡」根治＝PERF-PLAN 阶段 1b core 全外置：index 只留 静态HTML+CSS+3 件系统件（device/pwa/ver-check，~176KB）+≤4KB boot 段，其余 79 件走 <script defer src="js/…">（一文件一资源，消融实证合成大块把单次冻结峰值 308→481ms）；顺序=jsFiles 原序（D2，执行时序回单包语义）；sw install 分波预缓存；device.js 模块体检瞬态豁免只认启动后 15s；boot 看门狗 3s/8s 查 __mochiDataReady 挂重试条（弱网首访开屏不再永久定格）。六份 iOS 诊断共同形态：DCL 1.8~8.3s、与数据量无关；消融实测内联搬出即 DCL −513ms / index 4534→1223KB ====*/
  { name: '#860a 开屏看门狗在位（删＝全外置后弱网首访开屏永久定格、无「点此重试」逃生口）', file: 'index.html', needle: 'window.__mochiBootRetry' },
  { name: '#860b core 全外置主锚（chat.js 必须是 defer 外置标签；回退＝2.9MB 内联塞回 HTML，iOS 解析期整段同步编译、打开就卡复发）', file: 'index.html', needle: '<script defer src="js/chat.js"' },
  { name: '#860c boot 时刻戳（删＝device.js 模块体检的「弱网瞬态 vs 真没加载」时间闸失效，79 件 defer 全被当硬故障或反之）', file: 'index.html', needle: '__mochiBootAt = Date.now();' },
  { name: '#860d sw install 分波预缓存（每波 12；删＝85 项一波全并发把弱网首装连接池打满、新缓存打空）', file: 'pwa/sw.js', needle: 'i += 12' },
  { name: '#860e 模块体检瞬态窗（device.js；删＝弱网 15s 后仍缺的文件不再按硬故障报，诊断把死模块说成弱网）', file: 'js/device.js', needle: 'const transient = (Date.now() - (window.__mochiBootAt || 0)) < 15000;' },
  /* ==== 2026-09-19 #827 用户实报「按住看默认后全部字体变大且无法恢复」：源头非面板 CSS 轴（其只作用气泡/输入框/设置行，管不到「全部字体」），系壳内核（X5/XWeb 等老 Blink 分支）「智能字体放大/字体漫游」被按住归零的布局跳变点亮膨胀倍率后不回档。base.css 通配双保险：-webkit-text-size-adjust:none 给认前缀 none 的老壳、标准 text-size-adjust:100% 给新引擎（实测新 Chromium 解析期丢弃 none 令牌且该属性可继承，html,body 的 100% 行未动＝v3.5.105 iOS 防线原样）。零机型分支 ====*/
  { name: '#827 通配双保险规则在位（删＝壳内核智能字体放大复发，「全部字体变大无法恢复」回来；unique：html,body 那条无星号通配形态）', file: 'css/base.css', needle: '* { -webkit-text-size-adjust:none; text-size-adjust:100%; }' },
  // ==== 2026-09-19 #825 用户直派「词典里的爸爸删掉」：内置扩展词库（dict-ext-data.js 常用词·双字组）移除该称呼词条（词典池每次加载从内置快照重建，用户本地只存自建词条，删源码即全端生效、无需数据迁移）====
  { name: '#825 词典父亲称呼词条已删（回流＝旧缓冲把词条写回内置词库，用户点名要求删除）', file: 'index.html', needle: "\"爸爸\"", absent: true },

  // ==== 2026-09-19 #817 一加8T 自带浏览器实报「发出消息变竖排（一字一行）」多机型同现：气泡正文 span 的全局保留空白规则（09-18 颜文字批）在部分内核把 shrink-to-fit 气泡的自适应宽误算成最小内容宽，空格保护下移到内容层（escTxtBr 连续空格→等量 &nbsp;）。====
  { name: '#817a 气泡正文空格保护在内容层（escTxtBr 多空格→等量 &nbsp;；删＝退回靠全局预换行规则防折叠，竖排病回流）', file: 'js/chat.js', needle: ".replace(/ {2,}/g, m => '&nbsp;'.repeat(m.length))" },
  { name: '#817b 删除型：气泡正文 span 不得再有全局保留空白模式（回流＝quirky 内核下 shrink-to-fit 气泡自适应宽误算成一字符宽，发出消息竖排）', file: 'index.html', needle: '.msg-bubble > span { white-space:pre-wrap; }', absent: true },
  // ==== 2026-09-19 #797 全页面右侧白色乱码条（用户直派紧急）：template 外置锚说明文字写在注释结尾之外＝构建替换后成正文裸文本（body 级全页面可见），其中样本 <script defer src="js/*.js"> 被当真开标签吞掉其后全部尾部 DOM。修法＝说明收回独立注释＋构建期结构闸（html 组装段末）。====
  { name: '#797a 外置锚说明整体在注释内（<!-- 前缀是承重逻辑：说明移出注释＝此针消失且说明变正文裸文本）', file: 'template.html', needle: '<!-- PERF-PLAN 阶段 1' },
  { name: '#797b 删除型：外置锚注释结尾后不得直接跟说明文字（回流＝乱码白条＋尾部 DOM 被吞复发）', file: 'template.html', needle: '-->（PERF-PLAN', absent: true },
  // ==== 2026-09-18 #770 卡顿自检（#726）三处修正（红米 K80 Chrome 实报：停在设置页自检，
  // 报告却称「掉帧集中:占卜(100%)」，且「结论:流畅(未捕获掉帧)」与下方「掉帧 1 帧」并存）====
  { name: '#770a 掉帧归因读最上层全屏页（改回读 .app 桌面图标＝图标显隐不随页面切换，停任何页采样都记到最后一个可见图标头上，归因恒错）', file: 'js/perf-check.js', needle: "querySelectorAll('.page:not([hidden])')" },
  { name: '#770b 旧图标归因读取已删（回流＝「掉帧集中」恒报桌面图标名而非实际所在页）', file: 'js/perf-check.js', needle: "querySelectorAll('.app:not([hidden])')", absent: true },
  { name: '#770c 掉帧阈值随实测刷新周期自适应（改回固定 32ms＝高刷屏漏计、持续掉帧窗口周期被抬高一劲也漏判；needle=自适应取阈值函数整体）', file: 'js/perf-check.js', needle: 'function jankThr() { return Math.min(Math.max(minD * 2, MIN_JANK), MAX_JANK); }' },
  { name: '#770d 「流畅」结论对零星掉帧说真话（改回无条件「未捕获掉帧」＝与下方「掉帧 N 帧」自相矛盾）', file: 'js/perf-check.js', needle: "r.jankPct + '%，可忽略）'" },
  { name: '#770e 「掉帧集中」≥3 帧才输出（删＝单帧噪声也引导用户排查该页大图/长内容）', file: 'js/perf-check.js', needle: 'if (r.janky < 3 || !r.topPage) return false;' },
  // ==== 2026-09-19 #818 iOS 卡顿定位诊断增强（perf-check 三样，全部仍只活在检测窗口内、结束即拆＝零常驻开销）：①点按响应延迟（iOS 无 longtask 时比掉帧率贴近「点了隔一下才动」体感）②最慢帧现场 top3（第几秒·哪个页·键盘期·切页后 0.5s 内）③低电量档识别（周期 ≥28ms ≈30fps＝iOS 低电量模式减半帧率，系统行为防误判）。登记补录：代码与产物已随 c05fc22 入库（共享 index 撞车被 #811 批卷入），登记行当时未随库，本提交补齐 ====
  { name: '#818a 点按响应延迟采样（窗口内 passive 按下戳记、下一帧结算；删＝「点了没反应」类 iOS 报障无数据可定位）', file: 'js/perf-check.js', needle: "var downEv = window.PointerEvent ? 'pointerdown' : 'mousedown';" },
  { name: '#818b 响应延迟结算（删＝只剩帧间隔无交互维度；needle=结算行整体）', file: 'js/perf-check.js', needle: 'var lat = now - lastDown; lastDown = -1;' },
  { name: '#818c 最慢帧现场 top3 截断（删＝卡在哪个页/什么动作后无法定位）', file: 'js/perf-check.js', needle: 'scene.length = 3;' },
  { name: '#818d iOS 低电量 30fps 档识别（删＝低电量减半帧率被误判成应用卡顿）', file: 'js/perf-check.js', needle: 'rep.lp = minD >= 28;' },
  // ==== 2026-09-19 #814「我发的/联系人发的消息莫名被吞、之前发出来的也会消失」（荣耀畅玩40 Plus＋夸克实报，用户明说其他机型也有）收口登记：内容窗两层去重停吞＋落盘节流丢写手。登记名用 #828 系——#814a/b 名已被「导入刷新窗口」批在途占用，防撞号 ====
  { name: '#828a(#814吞消息) addRec 实时正文窗只拦发件侧（删＝收件侧内容窗复活、合法第二条再被静默吞）', file: 'js/chat.js', needle: "&& !rec.dedupExempt && (rec.side || '') === 'out'; i--" },
  { name: '#828b(#814吞消息) 刷新归一化只并同 ts 副本（改回时间窗＝从库里回吞跨毫秒同文、「之前发的被吞」复发）', file: 'js/chat.js', needle: 'if (dts !== 0) continue;' },
  { name: '#828c(#814吞消息) 同款两张改源头重掷外壳（删＝退回靠事后吞合法消息防「同款两张」）', file: 'js/chat.js', needle: 'let rep = genOneReplyDraw(c), sig = chatGenRepSig(rep);' },
  { name: '#828d(#814吞消息) 诊断报告「消息被吞体检」行（删＝下次报障没有防重层现场可查）', file: 'js/device.js', needle: '消息被吞体检：本会话防重层共切' },
  { name: '#828e(#814吞消息) 落盘节流等待期不得清空待写槽（删＝runPersist 先取走 persistRun 再判间隔，推迟重跑读到空槽＝整包写静默丢弃且永不重试，「刚发的消息」只在尾巴日志里、备份导出看不见）', file: 'js/chat.js', needle: 'if (!persistRun) return;' },
  // ==== 2026-09-18 #765 iOS 卡顿收口（壁纸层提合成层 + 贴底看门狗滚动期让路）====
  { name: '#765a 聊天壁纸层独立成合成层（删掉＝聊天页内容变化波及壁纸层，整张 cover 位图被重新缩放光栅，「设了壁纸后滚动/发消息发涩」复发；needle=该行整体，chat-main.css 内唯一）', file: 'css/chat-main.css', needle: '#cs-bg-layer { transform:translateZ(0); }' },
  { name: '#765b 贴底看门狗滚动期让路（删掉＝iOS 抬手后惯性滑行期仍被写 scrollTop，#716「往上滑被拽回底部」的 iPhone 残根回流；needle=200ms 让路判定行，chat.js 内唯一）', file: 'js/chat.js', needle: 'if (Date.now() - _chatScrollActTs < 200) return;' },
  { name: '#765d 桌面壁纸层独立成合成层（删掉＝桌面每次内容变化连带把全屏壁纸重新缩放光栅，且 #240 那条全屏 filter:blur 落在非合成层上每次失效重跑——「开了背景模糊的机型桌面发涩」复发；needle=该行整体，home.css 内唯一）', file: 'css/home.css', needle: '#phone-bg-layer { transform:translateZ(0); }' },
  // ==== 2026-09-17 #697 群聊设置「美化聊天」升成独立顶部 tag + 完整美化（含边看边调）====
  // 用户：「你要设置里的美化聊天功能没有在顶部变成单独tag，而且没有和聊天里一样的，完整的美化
  // 功能包括边看边调功能。」（确认＝群聊设置面板）
  { name: '#697a 群聊设置顶部 tag 含独立「美化」（删掉＝又退回「通用」下的一行，用户报障复发）', file: 'js/group-chat.js', needle: "['beauty', '美化']" },
  { name: '#697b 切 tag 记忆 gcSetTab（删掉＝美化段里改一个值就整段重建弹回「形象」）', file: 'js/group-chat.js', needle: 'gcSetTab = tab.dataset.gt;' },
  { name: '#697c 群聊美化「边看边调」抽屉（删掉 openGcBeautyDrawer＝群聊美化退回只能弹窗调、看不到效果）', file: 'js/group-chat.js', needle: 'function openGcBeautyDrawer() {' },
  { name: '#697d 气泡透明度/栏位不透明度/位置微调五键默认值（删掉＝群聊比单聊少这三组，用户「完整的美化功能」诉求回退）', file: 'js/group-chat.js', needle: "'bubble-op': 100, 'head-op': 92, 'input-op': 92, 'head-inset': 0, 'input-inset': 0," },
  { name: '#697e 气泡透明度→rgba 写回底色变量（删掉/改回直写 in-bg＝拖滑杆气泡颜色不变）', file: 'js/group-chat.js', needle: 'function gcApplyBubbleSurfaceWith(op) {' },
  { name: '#697f 群聊页栏位底色/留白 CSS 作用域规则（删掉＝顶栏不透明度/位置微调无效果，且不许动 chat-main.css 共享规则）', file: 'css/group-chat.css', needle: '#page-group-chat > .chat-head { background:rgba(var(--cs-bar-rgb), var(--cs-head-opacity, .92)); }' },
  // #698（用户直派四项）哨兵——2026-09-17
  { name: '#698a 群聊顶栏人数含我（删掉 +1＝顶栏/群列表人数又少了「我」，用户报「群聊人数里少了用户」）', file: 'js/group-chat.js', needle: 'const n = getMembers().length + 1;' },
  { name: '#698b 点顶部群名不再打开切换群聊面板（删掉＝弹面板回流，用户「影响我使用，删掉」；needle=该监听里仅剩的触发继续说行，文件内唯一）', file: 'js/group-chat.js', needle: "if (gcCfg()['gc-cs-trigger-name'] === 1) gcCsFireContinue();" },
  { name: '#698c 群聊头像/昵称互动池子（删掉 openInterPanel＝群聊又没有头像互动/昵称互动）', file: 'js/group-chat.js', needle: 'function openInterPanel(mode) {' },
  { name: '#698c 互动池子存储键（删掉＝池子数据无处落盘，互动半框空壳）', file: 'js/group-chat.js', needle: "const INTER_KEYS = { av: 'gc-avpool', nick: 'gc-nickpool' };" },
  { name: '#698d 群聊音效键走全局根命名空间（删掉 isGcKey 分流＝群聊音效跟随当前桌面/#643 开关，全局一套失效）', file: 'js/sfx.js', needle: 'function isGcKey(k) { return typeof k === \'string\' && k.indexOf(\'sfx-gc-\') === 0; }' },
  { name: '#698d 群聊播放入口未设置回退单聊（删掉 playSfxGc＝群聊音效设置选了也不响/回退逻辑丢失）', file: 'js/sfx.js', needle: 'window.playSfxGc = function (type) {' },
  { name: '#698d 音效设置页群聊两张卡片 DOM（删掉＝音效设置里又没有群聊）', file: 'template.html', needle: 'id="sfx-gcin-presets"' },
  { name: '聊天边看边调入口跟随主题色（写死浅紫＝用户「我原来是黑白风格」的配色错位复发；逻辑锚=主题色派生的淡底声明，chat-settings.js 内唯一）', file: 'js/chat-settings.js', needle: "-webkit-tap-highlight-color:transparent;flex-shrink:0';" },
  { name: '聊天边看边调开启胶囊用主题色实底（写死 #493478/#fff＝不跟随主题色复发）', file: 'js/chat-settings.js', needle: 'border:1px solid var(--btn-bg,#111);border-radius:999px;background:var(--btn-bg,#111);color:var(--btn-ink,#fff);white-space:nowrap">点击开启 ›</span>\';' },
  { name: '聊天桌面通知切回聊天头像：显式头像同步落值缓存', file: 'js/chat.js', needle: 'deskMsgAv.__avApplied = opts.av;' },
  { name: '#653a 查岗弹窗作答下标失效重定位（删掉＝弹窗→作答间隙 msgs 位移时回答被静默丢弃，聊天卡片不更新需再点一次，#653 报障根因；逻辑锚=重定位赋值行，chat.js 内唯一）', file: 'js/chat.js', needle: "if (_r && _r.special === 'ask-card' && _r.askStatus !== 'answered') { msgIdx = _i; rec = _r; break; }" },
  { name: '#653b ta-ask 包装层探针同款重定位（删掉＝错位下标下 deskCk 查岗卡被误写进「TA的询问」记录、askTs 取空）', file: 'js/ta-ask.js', needle: "const _fixedIdx = locateCardIdx(msgIdx, 'ask-card', 'askStatus');" },
  { name: '#650 多字卡拼接随机标点符号池（删掉/改回 join(\' \')＝六种拼接符全部失效退回纯空格，设置页「拼接符号」形同虚设；逻辑锚=省略号入池行，chat.js 内唯一）', file: 'js/chat.js', needle: "if (c['py-punct-el'] === 1) pool.push('......');" },
  { name: '#694a 拼接符号六枚默认全开（改回 py-punct-per: 0＝句号默认又关掉，用户定稿「全部开启、自己选择开关某个」失效；逻辑锚=六键连写的默认值行，reply-settings.js 内唯一）', file: 'js/reply-settings.js', needle: "'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 1, 'py-punct-ex': 1, 'py-punct-q': 1, 'py-punct-el': 1," },
  { name: '#694b 拼接符号选中态压过 :hover（删掉/改回裸 .ppy-chip.sel＝点上去 :hover 常驻把选中底色换成浅灰，用户报「点开、点关都没有颜色变化」复发；逻辑锚=选中态 :hover 变体行，css/setting.css 内唯一）', file: 'css/setting.css', needle: '.ppy-chips .ppy-chip.sel:hover,' },
  { name: '夜间模式开关判定（开且落在 22:00–7:00）——删掉/改回恒真恒假＝设置里开了夜间模式也不生效', file: 'js/incoming-requests.js', needle: 'window.nightModeActive = function () { return nightModeEn() && isNightHours(); };' },
  { name: '夜间模式暂停跨桌面查岗/来电/求聊天（删掉 early return＝夜里其他桌面照常弹查岗/来电）', file: 'js/incoming-requests.js', needle: 'if (window.nightModeActive && window.nightModeActive()) return;' },
  { name: '夜间模式暂停联系人主动发消息（删掉＝夜里 TA 照常主动发消息，gate 失效）', file: 'js/chat.js', needle: "if (window.nightModeActive && window.nightModeActive()) { try { console.log('[mochi-auto] night mode, skip'); } catch(e){} return; }" },
  { name: '夜间模式暂停联系人主动打电话（删掉＝夜里 TA 照常来电；多行锚点绑在「夜间判定紧接 currentCall 判定」这一处）', file: 'js/call.js', needle: 'if (window.nightModeActive && window.nightModeActive()) return;\nif (currentCall) return;' },
  { name: '#659 夜间模式行「功能说明」胶囊（删掉＝设置里夜间模式行又只剩一句状态小字，看不到作用/默认/生效机制/影响范围）', file: 'js/incoming-requests.js', needle: 'class="tag" id="sf-night-mode-tag" data-setdesc="#sf-night-mode-row"' },
  { name: '#659 夜间模式说明文案登记（删掉＝点胶囊无弹窗、说明里的「勿扰/静默」等词也搜不到本行）', file: 'js/settings-help.js', needle: "{ sel: '#sf-night-mode-row', name: '夜间模式'" },
  { name: '#642a 字体上传存「全局唯一份+轻量引用」@@font:<hash>（改回整份 dataURL 直写＝同字体 N 桌面存 N 份，用户报「3个桌面同一字体存3份内存炸了」复发）', file: 'js/chat-settings.js', needle: "s.set(FONT_KEY, '@@font:' + h)" },
  { name: '#642b 字体引用异步补读（删掉＝大键在 IDB/被 OOM 预算 defer 时引用展开为空，字体刷新后丢）', file: 'js/chat-settings.js', needle: "'xy-home-v2:font-blob-' + hash" },
  { name: '#642c migrateLegacy 按前缀挡 font-blob-* 全局键（漏挡＝每次刷新被当旧顶层键迁进 default 并删根键，全部桌面字体丢失）', file: 'js/contacts.js', needle: "if (r.indexOf('font-blob-') === 0) return true;" },
  { name: '#643a 音效 store 包装按开关路由全局/桌面命名空间（改回直连 activeStore＝「所有桌面共用音效」开关失效复发）', file: 'js/sfx.js', needle: '(sfxUnified() ? gStore : rawStore).get(k)' },
  { name: '#646 打开应用入口流程闸门（删掉＝「打开时先进入此间/默认桌面」入口流程失效或重复执行）', file: 'js/contacts.js', needle: 'if (window.__mochiEntryFlowDone) return;' },
  { name: '#646 两个入口键全局根键登记（漏登记＝migrateLegacy 把键迁进 default 并删根键，非默认桌面读不到、开关自己关）', file: 'js/contacts.js', needle: "'entry-cjian-first', 'entry-default-contact'," },
  { name: '#646 启动进入收尾接线入口流程（删掉＝设置里开了「打开时先进入此间/默认桌面」也不生效）', file: 'js/clock.js', needle: 'if (window.mochiContactEntryFlow) window.mochiContactEntryFlow();' },
  { name: '#646 开屏进入此间默认停在「全部」总览（删掉/chip 文案改掉＝又回到默认的当前桌面视图）', file: 'js/contacts.js', needle: "if (chips[i].textContent === '全部') { chips[i].click(); break; }" },
  { name: '#646 开屏此间点【去找TA】直接进桌面、不弹选择页（删掉/改判据＝点【去找TA】后仍多余弹出选择桌面页，用户反馈要再点一次）', file: 'js/contacts.js', needle: 'if (chat && !chat.hidden) return;' },
  { name: '#646 默认桌面开启时代替并禁用「先进入此间/显示联系人列表」（删掉＝入口选择仍会抢在默认桌面前，用户要求默认桌面开启时联动功能被取代）', file: 'js/contacts.js', needle: 'if (cbC) cbC.disabled = hasDef;' },
  { name: '#646 打开时显示联系人列表（删掉＝设置里开了「打开时显示联系人列表」也不弹列表）', file: 'js/contacts.js', needle: "if (entryShowListOn()) openContactPicker({ mode: 'entry', sub: '选一个联系人桌面进入吧。' });" },
  { name: '#648a 功能字卡池媒体守卫（删掉＝互动回应/查岗/游戏/摸鱼等池里令牌/URL/|||卡被当话术抽出直出乱码，#383 家族复发）', file: 'js/chatcard.js', needle: 'function ccFuncTextOnly(c) {' },
  { name: '#648b pickAskCardReply 预设池媒体过滤（删掉＝上层裸抽直传的媒体卡被原样返回进互动卡「TA：」行）', file: 'js/ta-ask.js', needle: "c.indexOf('data:') === 0 || c.indexOf('|||') >= 0" },
  { name: '#648c 询问回应走 pickAskCardReply（改回裸抽 pool[random]＝功能池媒体卡直进 rec.askReply）', file: 'js/chat.js', needle: 'window.chatAskReply(idx, v, (window.pickAskCardReply ? window.pickAskCardReply(pool)' },
  { name: '#648d 互动卡回应展示清洗助手（删掉＝已落库的存量令牌回应在卡片/收藏/引用直出 @@m: 串）', file: 'js/chat.js', needle: 'function askCardReplyClean(s) {' },
  { name: '#648e 邀请卡回应行走展示清洗（删掉＝邀请卡存量媒体回应直出令牌串）', file: 'js/chat.js', needle: 'askCardReplyClean(rec.inviteAnswer)' },
  { name: '#648f 守卫助手暴露+拍一拍池源头过滤（删掉＝字卡库【拍一拍】里令牌/图链卡被 TA 抽中拼进「拍了拍你」直出乱码）', file: 'js/chatcard.js', needle: 'window.ccTextCardOnly = ccFuncTextOnly;' },
  { name: '#648g 拍一拍短语池过滤助手（删掉＝poke-groups 自建分组媒体卡混入 performPoke 抽取）', file: 'js/chat.js', needle: 'function pokeTextOnly(x) {' },
  { name: '#648h 拍一拍面板发送单点防御（删掉＝面板点到的媒体串原样发出）', file: 'js/chat.js', needle: 'if (!pokeTextOnly(action))' },
  { name: '#648i 收藏页互动卡片回应行清洗（删掉＝存量收藏快照 f.ta 直出令牌串）', file: 'js/chat.js', needle: 'askCardReplyClean(f.ta)' },
  { name: '#648j 群聊拍一拍短语池过滤（删掉＝群成员拍一拍面板媒体卡直出复发）', file: 'js/group-chat.js', needle: "x.indexOf('@@m:') >= 0) return false;" },
  { name: '#648k 拍一拍气泡展示清洗（删掉＝存量拍一拍消息里的媒体卡残段直出令牌）', file: 'js/chat.js', needle: 'escTxt(askCardReplyClean(s))' },
  { name: '#648l 问答/收藏记录页回应列清洗+转义（删掉＝记录列表直拼 f.reply/x.reply 直出令牌串且无转义）', file: 'js/ta-ask.js', needle: 'function taReplyShow(s) {' },
  { name: '#648m 统计卡集补嵌套令牌与图链守卫（删掉＝常用文字榜直出令牌串/整段 URL）', file: 'js/p2-features.js', needle: "c.indexOf('@@m:') < 0 && !/^https?:\\/\\//i.test(c)" },
  { name: '#648n 撤回无快照兜底走内嵌令牌助手（删掉＝撤回查看混排令牌直出）', file: 'js/chat.js', needle: 'window.mochiInlineTextHtml(quoteDisplayFit(text, rec.side))' },
  { name: '#651a 来电弹窗预览的透明拦截层退出绑定（删掉＝预览里点接听/拒绝会触发真实通话，或预览关不掉）', file: 'js/call.js', needle: "catcher.addEventListener('click', closeCallPreview);" },
  { name: '#651b 预览让位真实来电（删掉＝预览开着时来电/去电弹层被拦截层盖住，接听/拒绝点不到）', file: 'js/call.js', needle: 'closeCallPreview();\ncloseImageOverlay();' },
  { name: '#651c 通话功能页「通话半框背景」上传入口行（删掉＝半框背景只能回设置页传，功能页入口消失）', file: 'template.html', needle: 'id="call-half-bg-edit-row"' },
  { name: '#651d 通话功能页「打开来电弹窗」预览行（删掉＝入口消失，来电弹窗平时看不见）', file: 'template.html', needle: 'id="call-view-row"' },
  { name: '#651e 通话背景上传显式传 CALL_BG_KEY（改回 addEventListener 直接传 pickCallBg＝click 事件被当 key 存进 "[object Object]"，通话背景永远设不上，历史 bug）', file: 'js/call.js', needle: "addEventListener('click', () => pickCallBg(CALL_BG_KEY))" },
  { name: '#545 全站自定义下拉（.mochi-custom-select）打开时显式 display:block（删掉/改回 \'\' ＝清内联后回落样式表 display:none，浮层永远打不开，全站下拉「点了没反应」复发，vivo X200s+Edge 等多机型）', file: 'js/ta-ask.js', needle: "list.style.display = 'block';" },
  { name: '#498 后台通知精确相等查重无条件拦（60秒间隔豁免复活＝切后台马上弹几分钟前看过的字卡，红米K80 等多设备复发）', file: 'js/bg-keep.js', needle: 'if (mf === key) return true;' },
  { name: '#498 后台通知历史查重窗口 5 分钟（改成 60 秒内才拦＝窗口外撞车内容重弹看过的消息）', file: 'js/bg-keep.js', needle: 'const NOTIFY_CHAT_DUP_MS = 5 * 60000;' },
  { name: '#498 后台通知无 batchBurst 连发放行（batchBurst 复活＝上一条通知 30 秒内撞车内容绕过全部去重重弹）', file: 'js/bg-keep.js', needle: 'const batchBurst', absent: true },
  { name: '#601d 手动关后台保活写「用户意图」标记（删掉＝无标记可读，通知联动/回填又会把用户关掉的保活打开＝「关掉后过一会/重开又自己变回开启」复发）', file: 'js/bg-keep.js', needle: "gSet('__ka-user-off', keepEnabled ? '0' : '1');" },
  { name: '#601d 启动读标记一律保持关闭（删掉＝存储里被写成 \'1\' 时又把用户关掉的保活打开）', file: 'js/bg-keep.js', needle: "if (gGet('__ka-user-off') === '1') {" },
  { name: '#601d 开启「后台通知」时用户已关过保活则不再强开（删条件＝刚开通知就把用户手动关掉的保活重新打开，#88 回填同族）', file: 'js/bg-keep.js', needle: "gGet('bg-keepalive') === '0' || gGet('__ka-user-off') === '1'" },
  { name: '#393 群聊模式下装修组件库显式加回占卜写意图标记（删掉＝退出装修即被收池，「装修拉出来也加不上」复发）', file: 'js/personalize.js', needle: "set('divination-desk-pin', '1')" },
  { name: '#393 applyGroupChatMode 读占卜意图标记豁免强制收池（删掉条件＝群聊开启期间用户加回的占卜被重新收回）', file: 'js/personalize.js', needle: "get('divination-desk-pin') === '1'" },
  { name: '#393 装修组件库摸鱼小组件命名含「摸鱼」（原「周末倒计时」无摸鱼字样搜不到＝「缺少摸鱼小组件」）', file: 'js/personalize.js', needle: "weekend: '摸鱼倒计时（周末）'" },
  { name: '#400 装修移出经期倒计时卡写移除标记（ensureDeskPeriod 布局缺卡自动补位无一次性语义＝移出后刷新被拉回还新建一页，#380 memo-row 强迁同族）', file: 'js/personalize.js', needle: "set('desk-period-removed', '1')" },
  { name: '#400 ensureDeskPeriod 读移除标记跳过补位（删掉＝用户删掉的经期卡每次启动/切桌面被拉回+多建一页）', file: 'js/personalize.js', needle: "get('desk-period-removed') === '1'" },
  { name: '#400 组件库显式加回群聊图标写位置意图标记（applyGroupChatMode 默认强制拽回聊天右侧＝用户挪到其他页留不住）', file: 'js/personalize.js', needle: "set('group-chat-desk-pin', '1')" },
  { name: '#400 applyGroupChatMode 读群聊位置标记豁免强制归位（删掉＝装修加到其他页的群聊图标退装修即被拽回）', file: 'js/personalize.js', needle: "get('group-chat-desk-pin') === '1'" },
  { name: '#405 ensureDeskPeriodP3Order 有布局一律尊重不换序（删掉＝用户装修调换第三页经期/备忘卡顺序后每次启动被打回，#380 同族）', file: 'js/personalize.js', needle: 'if (deskLayout()) return;' },
  { name: '#405 p2apps 强制换到摸鱼卡下方改一次性迁移（删掉标记门＝用户把 p2apps 挪到摸鱼卡上方后每次启动/切桌面被改回）', file: 'js/personalize.js', needle: "get('p2apps-order-mig') === '1'" },
  { name: '#405 p3→p2 图标救回迁移改一次性（删掉标记门＝用户故意把花园/同频/伸手拖回第三页网格后每次启动被拽回）', file: 'js/personalize.js', needle: "get('p2icons-p3-mig') === '1'" },
  { name: '#390 TA的心情分享 10% 概率 tag 显示「你的心情」（TA 有时发这张卡实为想问对方心情，tag 恒「TA的心情」表达不清；概率分支删掉即回归）', file: 'js/chat.js', needle: "? '你的心情' : 'TA的心情';" },
  { name: '#145 聊天表情按钮再点关闭（window.closeEmojiPanelForInsert 导出，群聊切换关闭复用）', file: 'js/chat.js', needle: 'window.closeEmojiPanelForInsert' },
  { name: '#145 群聊表情按钮再点关闭（面板已开先关不重开）', file: 'js/group-chat.js', needle: 'window.closeEmojiPanelForInsert &&' },
  { name: '#149 引用块缩略图认媒体池令牌（对象引用 imgs 过滤：data: 或 @@m: 令牌，令牌交 media-pool 观察器解图；删掉缩略图又消失）', file: 'js/chat.js', needle: "const isQM = (s) => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s)));" },
  { name: '#149 纯图片引用（字符串载荷）令牌也渲染成缩略图', file: 'js/chat.js', needle: "q.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(q))" },
  { name: '#149 引用快照识别令牌化图片消息（quoteTextOf 图片载荷判定含 @@m: 令牌，否则引用不出图+令牌串进 quote 文本）', file: 'js/chat.js', needle: "/^https?:\\/\\//i.test(s) || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))" },
  { name: '#149 引用文本清洗不直出令牌串（quoteTextSafe 令牌→空，防 @@m:hash 铺进引用块/引用预览条）', file: 'js/chat.js', needle: 'window.mochiMediaIsToken(str)' },
  { name: '#127 单聊点发送不收输入法（mousedown preventDefault 防焦点被按钮抢走）', file: 'js/chat.js', needle: "send.addEventListener('mousedown', (e) => { e.preventDefault(); });" },
  { name: '#127 群聊点发送不收输入法（同单聊）', file: 'js/group-chat.js', needle: "sendBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });" },
  { name: '#512 问问TA/邀请TA 半框关闭前显式收输入法（先 blur 再隐藏面板；删掉＝键盘被"元素移除"带走、内核不派 vv.resize，输入法位置一直露灰底，#141/#209 同族复发）', file: 'js/chat.js', needle: 'try { askBoxes().forEach(({ box }) => { try { if (box && box.blur) box.blur(); } catch (e) {} }); } catch (e) {}' },
  { name: '#512 收输入法必须发生在面板隐藏之前（两行顺序颠倒＝聚焦元素先被摘掉，blur 落空、灰底复发）', file: 'js/chat.js', needle: 'askDismissIme();\nif (chatAskPanel) chatAskPanel.hidden = true;' },
  { name: '#512 程序化收键盘必须向移动适配层报备（删掉＝丢失「我确实主动收过键盘」凭据，有界兜底网永不武装＝连 focusout 都不派的内核灰底复发）', file: 'js/chat.js', needle: 'if (window.mochiKbDismiss) { try { window.mochiKbDismiss(); } catch (e) {} }' },
  { name: '#512 外部收键盘后的有界兜底网存在（删掉＝不派 focusout / vv.resize 的内核上 .phone 内联收缩高永久卡在键盘期数值，输入法位置一直露 body 灰底，#209/#236 同族复发）', file: 'js/mobile-adapt.js', needle: 'window.mochiKbDismiss = function () {' },
  { name: '#512 兜底网计时器必须按每次请求起（改回模块初始化上的一次性 setTimeout＝模块加载时 _aDismissAt 恒为 0，800ms 那拍直接 return 后再不进场＝整段死代码，灰底一点不会被兜住。首稿实测踩过）', file: 'js/mobile-adapt.js', needle: '_aDismissTimer = setTimeout(_aDismissCheck, 800);' },
  { name: '#512 兜底网有界窗口 3s（删掉＝请求过期后仍在无限复查）', file: 'js/mobile-adapt.js', needle: 'if (_dAge > 3000) { _aDismissAt = 0; _aDismissTries = 0; return; }' },
  { name: '#512 兜底网必须挂在「无活文本焦点」否证上（删掉＝键盘真在场也强行复原，健康内核键盘被抽走＝#209 同族回归）', file: 'js/mobile-adapt.js', needle: 'if (_aIsText(document.activeElement)) return _dRetry();' },
  { name: '#542 桌面 openModal 关弹窗前先 blur 弹窗内聚焦输入框（删掉＝聚焦可编辑元素被 hidden 带走、内核不派 focusout/vv.resize，.phone 卡收缩高露大片灰底，回弹很慢）', file: 'js/personalize.js', needle: '&& mask.contains(_ae)) {' },
  { name: '#542 桌面 openModal 关弹窗时向移动层报备有界兜底（连 focusout 都不派的内核上仍能收回 .phone）', file: 'js/personalize.js', needle: 'if (window.mochiKbDismiss) { try { window.mochiKbDismiss(); } catch (eD) {} }' },
  { name: '#542 安卓失焦快速复原：必须确证失焦来自文本框（删掉＝任意焦点转移都触发，误收键盘期 .phone）', file: 'js/mobile-adapt.js', needle: '_lostText = _aIsText(e.target);' },
  { name: '#542 安卓失焦快速复原：失焦时必须无任何文本持活焦点（删掉＝键盘真在场也强行复原，#209 同族回归）', file: 'js/mobile-adapt.js', needle: 'if (!_lostText) return;' },
  { name: '#542 安卓失焦快速复原：必须验收 vv 读数已稳（删掉＝收起动画中途误清、.phone 抖动回弹）', file: 'js/mobile-adapt.js', needle: 'Date.now() - _aVvChgAt < 350' },
  { name: '#542 手机端 body 底色随 .phone（--bg-b，非桌面灰 --page-bg）：键盘收缩露出的一条不再是「大片灰底」', file: 'css/base.css', needle: 'html, body { padding:0; min-height:100vh; min-height:100svh; min-height:100dvh; background:var(--bg-b, #fff); }' },
  { name: '#542 UA 桌面伪装兜底形态同款 body 底色（force-mobile）', file: 'css/base.css', needle: 'html.force-mobile, html.force-mobile body { padding:0; min-height:100vh; min-height:100svh; min-height:100dvh; background:var(--bg-b, #fff); }' },
  { name: '定期备份提醒条存在（backup-remind-bar，受保护产品功能，见 AGENTS.md 数据与存储约定）', file: 'js/pwa.js', needle: "getElementById('backup-remind-bar')" },
  { name: '定期备份提醒条锚点存在（template.html）', file: 'template.html', needle: 'backup-remind-bar' },
  { name: '备份提醒冷却收短到 1 天（每天弹一次；改动 INTERVAL 即消失，防被长冷却静默压制）', file: 'js/pwa.js', needle: 'function dayKey(t) {' },
  { name: '开屏备份弹窗避让已有弹窗（openModal 全站唯一，删掉则顶掉首启引导/字卡锁提醒等开屏弹窗且当天不再补弹）', file: 'js/pwa.js', needle: "if (mask && !mask.hidden) return 'busy';" },
  { name: '#355b 备份提醒条「单独备份聊天」按钮存在（template.html）', file: 'template.html', needle: 'id="backup-remind-chat"' },
  { name: '#355b 仅聊天记录导出不更新全量备份时间（data-backup.js cfg.mode!==chat 守卫，逻辑锚）', file: 'js/data-backup.js', needle: "if (cfg.mode !== 'chat')" },
  { name: '#356 收藏页媒体池令牌渲染（收藏令牌化后 @@m:hash 按图片出，不再把令牌串当文字直出＝不明代码；判定表达式改掉即消失。#943 起该判定收口到统一口径 chatIsImgSrcLike，锚点随新写法同步、逻辑未变）', file: 'js/chat.js', needle: 'chatIsImgSrcLike(f.text)' },
  { name: '#357 语音播放挂载 DOM（playVoiceInChat 挂到 body 再 play、停播即卸；删则安卓 WebView 未挂载 Audio 静默空放/播放失败，收藏与聊天语音同链路复发）', file: 'js/chat.js', needle: "if (!a.parentNode) { a.style.display = 'none'; document.body.appendChild(a); }" },
  { name: '#358 跨桌面投递空库账本矛盾守卫（探测说谎时 writeArr([一条]) 会把该联系人全部历史覆盖成一条＝旧记录只剩互动卡片；守卫函数删掉即消失）', file: 'js/chat.js', needle: 'function deskAppendMissGuard(cid, tries, onRetry, writeOne)' },
  { name: '#358 loadMsgs 空库二次复核（账本缺失时单次探测说谎会把 LS 有损快照晋升为权威顶掉老历史；2.5s 双复核删掉即消失）', file: 'js/chat.js', needle: 'function enterConfirmedEmpty() {' },
  { name: '#478 loadMsgs 权威读库成功必须补写 LS 快照（OOM 批 !hasLocal 快路径令 changed 恒 false 不再进 if(changed)，快照被 removeItem 后永不重写＝切走再切回遇 IDB 事务挂起时记录失去唯一兜底副本整窗不可见，TASKS #131① 真缺陷；删掉未变更路径的延迟补写即复发。#477 编号已让位给并行会话 tabbar 掉出 .phone 回归）', file: 'js/chat.js', needle: 'if (window.activePrefix() === myPrefix) writeLsSnapshot(msgs, myPrefix, true);' },
  { name: '聊天页半框「批量设置问卷」入口锚点（template.html），供更多功能查必（用户多次反馈缺少批量问卷按钮）', file: 'template.html', needle: 'id="chat-ask-bulk"' },
  { name: '聊天页半框「批量设置问卷」跳转函数 openAskSurvey（ta-ask.js；从聊天半框进入批量问卷页，返回回聊天而非 TA 的询问），删掉即按钮失效复发', file: 'js/ta-ask.js', needle: 'window.openAskSurvey = function' },
  { name: '聊天页半框主输入框「一键清空 ✕」绑定（chat.js；问句输入框与帮我决定/多人决定同款 dec-inp-clear，删掉即无清除按钮复发）', file: 'js/chat.js', needle: "document.querySelector('#chat-ask-panel .dec-inp-clear[data-clear=\"chat-ask-input\"]')" },
  { name: '聊天气泡入场柔和动画（ease-out-quint 曲线，去 v3.27.x 过冲回弹；删掉或换回 old 曲线即突兀复发）', file: 'css/chat-main.css', needle: 'cubic-bezier(.22,1,.36,1)' },
  { name: 'TA 自发消息跟底平滑滚动（rAF+ease-out 三次加速，代瞬时 scrollTop 的一跳；删除/改回 scrollChatBottom 即突兀复发）', file: 'js/chat.js', needle: 'const dur = Math.min(360, 180 + (target - start) * 0.35);' },
  { name: '#516 TA 自发消息跟底「插入帧内同步贴底」（用户 2026-09-15 报「除了第一条有优化，其他消息还是飞出来的」：旧实现新气泡先在视口下方 +38.7px 渲染、再用 ~200ms 平滑滑上来＝肉眼一条条飞出；改为插入同帧同步贴底＝气泡贴底长出、零滑动。删此行或改回先插后滚即复发。平滑滚动保留作 #162 兜底复写）', file: 'js/chat.js', needle: 'scrollChatBottom(); // FIX 2026-09-15 #516 插入帧内同步贴底' },
  { name: '#516 聊天贴底目标统一取值 chatScrollMax（打字行可见时必须扣回行高：#514 治了 showTyping/hideTyping 两个写点，但 out 侧 120ms / in 侧 rAF+150ms 兜底仍可能在打字行显示期执行——落到「行显示态最大值」上，行一隐藏必被内核钳掉一行高＝残根下弹 22px。删除则打字行显隐期兜底复写再次过界）', file: 'js/chat.js', needle: 'function chatScrollMax() {' },
  { name: '#516 scrollChatBottom 写入走 chatScrollMax（旧 scrollTop=scrollHeight 在打字行可见时落在虚高一份行高的钳位目标上；删除则回弹复发）', file: 'js/chat.js', needle: 'cb.scrollTop = chatScrollMax();' },
  { name: '#471 聊天页问TA半框底部【发送/取消/存入】按钮（template.html；108b918 误删后聊天中单问题无法发送，删除/改 id 即复发）', file: 'template.html', needle: 'id="chat-ask-ok">发送' },
  { name: '#472 批量问卷返回走 enterChat 恢复聊天页本体（#523 起收进 surveyGoChat 统一出口；此前只回显桌面聊天图标导致全部 .page 隐藏、.phone 折叠 tabbar 飞到顶，改回图标显隐即复发）', file: 'js/ta-ask.js', needle: 'if (window.enterChat) { window.enterChat(); return; }' },
{ name: '#474 聊天设置/房间/群聊等 8 个子页整页白屏——chat-ask-panel 缺少闭合 </div>，后续全部 .page 被吞进 #page-chat 内（父级一隐藏子级联动消失，与 #467 tabbar 嵌套同族；108b918 删按钮时连闭合一起删，#471 恢复按钮但漏恢复该闭合。结构性回归，所有机型必现）。结构锚＝修复后 chat-ask-actions 之后必须存在「3 个连续 </div> 接寻踪半框注释」（缩进 10/8/6 ＝ chat-ask-actions / poke-card-scroll / chat-ask-panel 三层，见 template.html #474 FIX 注释；改缩进必须同步本 needle，否则哨兵失配）；缺任何一个闭合（回到 2 个）即消失报警', file: 'template.html', needle: '</button>\n          </div>\n        </div>\n      </div>\n      <!-- 寻踪半框' },
  { name: '#471 设置页「导出全部桌面聊天记录」UI（template.html；改 id/删除即 cs-export-all 失效复发）', file: 'template.html', needle: 'id="cs-export-all"' },
  { name: '#471 设置页「导入全部桌面聊天记录」UI（template.html；改 id/删除即 cs-import-all 失效复发）', file: 'template.html', needle: 'id="cs-import-all"' },
  { name: '#471 设置页全部桌面导入分路写回（data-backup.js importChatAllGo：非当前桌面走 writeDeskChat 写 IDB+账本+LS 快照，删掉即导入全部桌面只写当前桌面、旧桌面全部丢失复发）', file: 'js/data-backup.js', needle: 'function writeDeskChat(cid, arr) {' },
  // #582（2026-09-16 用户：「设置里导出数据和导入数据，缺少可选 导出/导入全部桌面联系人的聊天记录」）——
  // 原来「仅聊天记录」只在数据 >150MB 的导出弹窗里存在，导入侧干脆没有这条路。
  { name: '#582 导出选范围不再按体积设门槛（absent：出现 MODE_ASK_BYTES 即回退「小库不弹、仅聊天记录选不到」——用户报的「缺少可选」根因）', file: 'js/data-backup.js', needle: 'MODE_ASK_BYTES', absent: true },
  { name: '#582 导出弹窗「仅聊天记录」胶囊（删/改 value 即设置页选不到只导聊天）', file: 'js/data-backup.js', needle: "{ label: '仅聊天记录', value: 'chat' }" },
  { name: '#582 「仅聊天记录」范围＝各桌面 chat-msgs（含旧顶层键）+ 群聊键（删 GROUP_CHAT_KEY_RE 分支即群聊记录不再进备份）', file: 'js/data-backup.js', needle: 'function isChatMsgKey(k) { return CHAT_KEY_RE.test(k) || GROUP_CHAT_KEY_RE.test(k); }' },
  { name: '#582 聊天备份带上消息引用到的媒体池条目（@@m: 令牌指向的池键；删即换机恢复后图片语音全空，原设备上还看不出来）', file: 'js/data-backup.js', needle: 'mediaRefQueue = Array.from(mediaRefs);' },
  { name: '#582 导入入口先选范围（完整备份 / 仅聊天记录；删即导入数据又只剩整包一条路，会覆盖设置字卡音乐）', file: 'js/data-backup.js', needle: "if (v === 'chat') { window.runChatAllImport(); return; }" },
  { name: '#582 聊天导入认旧顶层键 xy-home-v2:chat-msgs 与各联系人 c<base36> 命名空间（旧正则只认 c\\d+，默认桌面的旧顶层键会被整段漏掉）', file: 'js/data-backup.js', needle: 'const chatKeyRe = /^xy-home-v2:(?:chat-msgs|(?:default|c[0-9a-z]{5,}):chat-msgs)$/;' },
  { name: '#582 聊天导入写回群聊（走 gcWriteGroupMsgs；删即备份里的群聊记录导不回来＝只导不入）', file: 'js/data-backup.js', needle: 'if (window.gcWriteGroupMsgs) return window.gcWriteGroupMsgs(w.gid, w.arr);' },
  { name: '#582 群聊消息写回通道（group-chat.js gcWriteGroupMsgs：lite 快照 + IDB 权威，条数与全量一致防旧快照压住新导入；删即群聊导入静默无效）', file: 'js/group-chat.js', needle: 'window.gcWriteGroupMsgs = function (gid, arr) {' },
  { name: '#582 分桌写回返回真 promise（absent：自造 thenable「if (!seq) f(); return seq;」永不 settle，写入链在第一个非当前桌面后整条卡死——多桌面只恢复第一个、群聊与媒体池永不执行）', file: 'js/data-backup.js', needle: 'if (!seq) f(); return seq;', absent: true },
  // #582 第二批（2026-09-16 用户追问「还有什么缺陷 + 没说明为什么本机内存是导出数据的 2 倍」后逐项实测）
  { name: '#582 导出体积预估按 UTF-8 字节＋JSON 转义（esc 参数管「JSON 字符串值再转义一次」的引号开销，删/改回字符数＝中文为主的库预估偏小，实测纯中文库文件 370KB vs 存储 313KB，「文件是存储一半」说反）', file: 'js/data-backup.js', needle: 'function estUtf8Bytes(s, esc) {' },
  { name: '#582 体积实测不吃「LS 已计过」去重（absent：权威键 chat-msgs/群聊的 LS 只是有损小快照，一刀切跳过 IDB 权威值会把整段聊天体积算成 0——用户报「2 倍」的现场之一）', file: 'js/data-backup.js', needle: 'if (lsC !== undefined && lsC <= LS_SMALL_LIMIT && !auth) { c = 0; fb = 0; blob = 0; }' },
  { name: '#582 「仅聊天记录」体积预估接线（absent 或改成漏传＝弹窗恒显示「仅聊天记录 0 KB」，本批自己踩过一次）', file: 'js/data-backup.js', needle: 'chatFile: m.chatFile' },
  { name: '#582 弹窗说明存储/文件两把尺子（用户问「为什么本机内存是导出数据的 2 倍」；删则又变成两个数没有任何解释）', file: 'js/data-backup.js', needle: '两个数口径不同：本机数据按存储占用算' },
  { name: '#582 范围弹窗走宽版（big；删则 272px 窄弹窗把胶囊与「开始导出」顶到折线外＝用户以为弹窗只有说明）', file: 'js/data-backup.js', needle: "noInput: true, okText: '开始导出', pill: 'full', lock: true, big: true," },
  { name: '#582 仅聊天记录单独文件名（删则导出文件又和完整备份同名「mochi数据备份_日期.json」，用户分不清手里这份能恢复什么）', file: 'js/data-backup.js', needle: "(cfg.mode === 'chat' ? 'mochi聊天记录_' : 'mochi数据备份_')" },
  { name: '#582 导入桌面聊天后清该桌面尾巴日志（chat-tail，#180）：不清则切到该桌面时 chatTailMerge 把导入前的旧消息当「没落盘的新消息」回放上来', file: 'js/data-backup.js', needle: 'function clearDeskTail(cid) {' },
  // #359→#437（2026-09-14 用户确认同内容须可重发，多机型同报误吞）：发件侧媒体窗口 8000→800ms。
  // 原锚（return 8000）随口径演进更新；800ms 仍吞机械双派发（150ms 双 click/606ms 长任务延迟），
  // 有意重发（重开面板 ≥1s）放行；收件侧 60000ms 不变。
  { name: '#359→#437 发送侧媒体去重窗 800ms（改回 8000＝同表情 8s 内有意重发被静默吞；改回 2500＝#359 双派发出 2 个复发）', file: 'js/chat.js', needle: "if (m.type === 'sticker' || m.type === 'image' || m.type === 'voice') return 800;" },
  { name: '#437 parts 型纯图片发件侧同窗 800ms（删/回 8000＝同相册图 8s 内重发被静默吞）', file: 'js/chat.js', needle: "&& (m.side || '') === 'out') return 800;" },
  { name: '#437 addRec 发件侧吞并 toast 反馈（删则恢复静默吞＝「发不出去」报障源回流）', file: 'js/chat.js', needle: "!rec.silent && typeof toast === 'function') toast('同样的内容刚发送过，未重复发送');" },
  { name: '#437 发送按钮双击守卫吞并 toast 反馈（守卫语义不变，吞并须可见；删则双击发送静默无反馈回流）', file: 'js/chat.js', needle: "try { toast('同样的内容刚发送过，未重复发送'); } catch (e) {}" },
  { name: '#466 键盘/视口 resize 钉住回钉守卫（聊天视口高度变化且仍贴底钉住时不刷新 scrollTop→消息被键盘顶到上半区、发送时才拽回=「闪一下」；删掉守卫线即复发）', file: 'js/chat.js', needle: 'if (!chatVisible() || !chatPinnedBottom) return;' },
  { name: '#466 键盘/视口 resize 回钉监听（visualViewport resize→refreshKbRepin；删监听＝键盘开合不再回钉、上半区闪动复发）', file: 'js/chat.js', needle: 'vv466.addEventListener(\'resize\', refreshKbRepin)' },
  { name: '#G1 点联系人头像开拍一拍 pointerup 轻点判定（位移<=12px 且 <=450ms 才算点；退回纯 click 监听＝部分内核合成 click 被吞、拍一拍打不开复发，多机型同报）', file: 'js/chat.js', needle: 'if (dt > 450 || dx * dx + dy * dy > 144) return;' },
  { name: '#G1 拍一拍 click 兜底防双开（pointerup 已开后吞补发 click 且 stopPropagation，防 document 层「点外关闭」把刚打开的面板立刻关掉；删掉即面板开不开/开了秒关）', file: 'js/chat.js', needle: 'if (Date.now() < pokeTapGuard) { e.preventDefault(); e.stopPropagation(); return; }' },
  { name: '#G1 拍一拍 touchstart 布点（五保险 touch 路：无 PointerEvent 旧内核/内嵌 WebView 只派发 touch，pointer 永不触发+click 必吞=唯一入口；删掉布点即旧内核拍一拍打不开复发）', file: 'js/chat.js', needle: 'pokeTapT = { x: t.clientX, y: t.clientY, t: Date.now(), id: t.identifier };' },
  { name: '#G1 拍一拍 touchend 轻点判定（touch 路同口径判滑动/按住；删掉则旧内核轻点不再开面板，与 pointer 路文本异形保证哨兵唯一）', file: 'js/chat.js', needle: 'if (dx * dx + dy * dy > 144 || dt > 450) return;' },
  { name: '#G2 长按气泡 contextmenu 同步开动作菜单（内核长按被 touchcancel/文本操作条打断时定时器路径失效＝引用菜单打不开复发；删掉 openMsgActionsAt(ctxR.. 分支即断，桌面右键同步受益）', file: 'js/chat.js', needle: 'if (!msgActions || msgActions.hidden || activeMsgEl !== ctxR.item) {' },
  { name: '#G2 长按容忍手指微移（按住 500ms 窗口内 <12px 的 touchmove 不再清长按定时器，真实滑动仍取消；删掉＝部分内核按住必然的小漂移把长按打断、菜单永不出现复发。#480 同批同步：同分支追加轻点布点失效，改这里连 #480 语境一起看）', file: 'js/chat.js', needle: 'if (mdx * mdx + mdy * mdy > 144) { endMsgHold(); msgTapStart = null; msgAnyTap = null; }' },
  { name: '#480 轻点气泡 touch 直驱开菜单（「合成 click 被吞」族内核——Via/夸克等 WebView 壳——点气泡后内核 click 永不触发＝菜单打不开＝「无法引用消息」；删掉 openMsgActionsAt(ts.. 直驱分支即断）', file: 'js/chat.js', needle: 'openMsgActionsAt(ts.item, ts.b);' },
  { name: '#480 菜单按钮 touch 直驱防双触发（【引用】按钮原只有 click 一条路，click 被吞内核上菜单开了点引用没反应＝无法引用；动作体提为 maRunAction + touchend 直驱 + guard 吞补发 click，删掉 guard 检查＝双跑复发）', file: 'js/chat.js', needle: 'if (Date.now() < maClickGuard) return;' },
  { name: '#480 群聊菜单按钮 touch 直驱（对齐单聊；群聊【引用】原只有 click 路，click 被吞内核＝群聊无法引用；删掉 gcRunAction 的 touchend 直驱即断）', file: 'js/group-chat.js', needle: 'if (Date.now() < gcMaClickGuard) return;' },
  { name: '#480 群聊长按微移容错（对齐单聊 #G2：>12px 才算滑动取消；原 touchmove 一动即清定时器＋contextmenu 不开菜单＝群聊引用菜单永不出现复发）', file: 'js/group-chat.js', needle: 'if (gmdx * gmdx + gmdy * gmdy > 144) { endGcHold(); gcTapStart = null; }' },
  { name: '#481 面板点外关闭（#480 轻点直驱回归收窄：吞 click 窗口只在「本次轻点真的关了消息菜单」的 touch 点外关闭分支布点，与消息菜单无关的普通轻点 click 放行到 document 层——原实现任意轻点无条件布 800ms guard＋body 层 stopPropagation，把 document 上的更多功能/表情包/拍一拍等面板外关闭监听全拦死＝点外面板关不掉，全机型回归；改回无条件布点即断）', file: 'js/chat.js', needle: 'msgSuppressClickUntil = Date.now() + 800;' + String.fromCharCode(10) + 'closeMsgActions();' },
  { name: '#467/#477 tabbar 存在+缩进锚：底部导航块必须在位且 tab 缩进 4 空格（嵌进任何 .page 内随 hidden 联动 display:none → 桌面底部 3 按钮消失＝#467；整块删除＝导航消失。位置闭合锚见下条；改 tabbar 区缩进必须同批同步本 needle 与 tools/verify-page-nesting.mjs S3/S5）', file: 'template.html', needle: '<div class="tabbar">\n    <div class="tab active" data-page="page-phone">' },
  { name: '#477 tabbar 位置闭合锚（tabbar 闭合 2 空格 → .phone 闭合 2 空格 → #477 移除说明注释，三行序列；tabbar 被移到 .phone 闭合之外＝body 直子被 flex 横排排到手机壳右侧＝红米 K80 等多机型「底部导航跑到右侧」、重嵌进任何 .page、.phone 闭合多补/少补，任一形态都破坏该序列＝报警。序列以 \\n 锚行首防 6 空格闭合的尾部假匹配）', file: 'template.html', needle: '\n  </div>\n  </div>\n\n<!-- （#477）tabbar 原先位于本注释处' },
  { name: '#360 字卡去重跨分组判重（seen 按分类建不按分组建+对象卡稳定序列化判重；退回「每组各建 seen 按引用比较」即换分组清不出重复，公用/专属两作用域同源复发）', file: 'js/chatcard.js', needle: 'function ccCardDupKey(cat, c) {' },
  { name: '诊断采集与设置页 DOM 解耦（row 在使用处按需判空，错误/环境/长任务/轨迹不因入口 DOM 缺失而失效）', file: 'js/device.js', needle: 'if (!row) return null;' },
  { name: '诊断复制不再 focus 隐藏 textarea（防手机弹输入法+灰屏，ta.focus 删除型守护；needle 收窄到 device.js copyText 的 appendChild(ta);ta.focus(); 上下文——裸 ta.focus(); 在 chat.js/decision.js/divination.js/group-decision.js 合法存在会误报）', file: 'js/device.js', needle: 'appendChild(ta);ta.focus();', absent: true },
  { name: '诊断电量 getBattery 废弃显式降级（不支持时输出一行而非静默消失）', file: 'js/device.js', needle: '无 getBattery 接口' },
  { name: '诊断超长文本引导导出 docx（>8KB 提示剪贴板可能截断，优先导出；#227 txt→docx 同步改锚）', file: 'js/device.js', needle: '建议优先【导出docx】' },
  { name: '诊断 toast 统一 ccToast（diagToast 与 LS 失效 notice 共用元素防互相顶掉）', file: 'js/device.js', needle: 'function ccToast(msg) {' },
  { name: '诊断错误去重按 msg+页面 30s 窗口（防同类错误刷满环形缓冲）', file: 'js/device.js', needle: 'const dupIdx = arr.findIndex(function (it) {' },
  { name: '#860 外置化后内联段仅剩 3 系统件+boot（原「iOS 15 拆块」哨兵换锚：旧 needle 随 core 归零消失；新锚=defer 链末位 mobile-adapt 标签在位——它在位即 79 件外置链完整、内联段不可能再长回 >600KB 单块）', file: 'index.html', needle: '<script defer src="js/mobile-adapt.js"' },
  { name: '颜文字缺字形字符已替换（ᴥ absent，fix-kaomoji-chars 第二批）', file: 'index.html', needle: 'ᴥ', absent: true },
  { name: 'iOS 键盘输入栏停靠（_ensureInputDocked）', file: 'js/mobile-adapt.js', needle: '_ensureInputDocked' },
  { name: 'iOS 保活音频静音（kaIsIOS/0.002）', file: 'js/bg-keep.js', needle: 'kaIsIOS' },
  { name: '批量导入按行拆分（\\r\\n|\\r|\\n）', file: 'js/chatcard.js', needle: 'split(/\\r\\n|\\r|\\n/)' },
  { name: 'GIF 动图直存（跳过压缩）', file: 'js/chatcard.js', needle: 'isGif' },
  { name: '新文件接入产物（钓鱼/记忆翻牌/我的档案）', file: 'index.html', needle: 'fishing' },
  { name: '新文件接入产物（漂流瓶）', file: 'index.html', needle: 'drift-bottle' },
  { name: '新文件接入产物（TA的心情）', file: 'index.html', needle: 'ta-mood' },
  { name: '多联系人切换渲染修复（applyAvatars）', file: 'js/contacts.js', needle: 'applyAvatars' },
  { name: '信箱数据丢失防护（mailDbReady）', file: 'js/mail.js', needle: 'mailDbReady' },
  { name: '大图崩溃防护（>8MB 拦截）', file: 'js/personalize.js', needle: '8 * 1024 * 1024' },
  { name: '情绪字卡总开关（triggerEmotionChain 总闸）', file: 'js/mood-reply-cards.js', needle: 'if (!enabled(\'mood\')) return null' },
  { name: '通知图标降级（noMedia）', file: 'js/bg-keep.js', needle: 'noMedia' },
  { name: '引用快照防 base64 霸屏（quoteTextOf/quoteSnapOf）', file: 'js/chat.js', needle: 'function quoteTextOf' },
  { name: '设备判定手动布局兜底（__layout-pref）', file: 'js/device.js', needle: 'pref:mobile' },
  { name: '全屏横屏判定改判物理方向（viewportLandscape）', file: 'js/fullscreen.js', needle: 'function viewportLandscape' },
  { name: '收藏判重按归属（TA收藏不挡我的收藏）', file: 'js/chat.js', needle: "(f.by || 'me') !== 'ta'" },
  { name: '收藏启动回填只补不覆盖（防旧IDB快照回滚）', file: 'js/chat.js', needle: "cur.length <= 2) store.set('fav-msgs'" },
  { name: '语音播放钮互动态·双图标（playing 三角换暂停竖条）', file: 'js/chat.js', needle: 'voice-ico-pause' },
  { name: '语音播放钮互动态·按压反馈（:active 微缩）', file: 'css/chat-main.css', needle: '.msg-voice-play:active' },
  { name: '邀请TA输入栏 ce-box 常驻合成层 + 抬高内边距高（防文字飞出输入栏，同 #118 tc-input.ce-box）', file: 'css/chat-main.css', needle: '.chat-ask-input.ce-box { will-change: transform; min-height:48px !important; }' },
  { name: '邀请TA批量管理入口（toggleInviteBatch）', file: 'js/chat.js', needle: 'function toggleInviteBatch()' },
  { name: '邀请TA批量勾选字卡（inv-batch-cb-in）', file: 'js/chat.js', needle: 'inv-batch-cb-in' },
  { name: '邀请TA批量下自建分组 ✎重命名/✕删除（inv-g-op rm）', file: 'js/chat.js', needle: 'data-op="rm">✕' },
  { name: '邀请TA批量分组标签用 escTxt 转义（防 esc 未定义使批量态整栏断裂用不了）', file: 'js/chat.js', needle: 'escTxt(g.label) + g.cards.length +' },
  { name: '邀请TA预设分组持久化（预设字卡才能单独修改/删除）', file: 'js/chat.js', needle: 'if (!myInviteGroups.some(g => g[0] === \'__preset\')) {' },
  { name: '#134 文档尾部 EOF 双锚点（SW 校验用注释 + device.js 自检用 DOM 锚点）', file: 'template.html', needle: '<span id="mochi-html-eof" hidden aria-hidden="true"></span>' },
  { name: '#134 device.js 文档完整性自检+自愈重载（限 1 次防循环）', file: 'js/device.js', needle: "const FLAG = 'mochi-trunc-reloaded';" },
  { name: '#134 doDrop 自嵌套防线（整组网格不可拖拽，防 HierarchyRequestError 拖拽报废）', file: 'js/personalize.js', needle: "dragged.contains(info.ref)) return;" },
  { name: '#134 拖拽落点排除整组图标网格（app-grid 本身不再作为 dragged）', file: 'js/personalize.js', needle: "dragged.classList.contains('app-grid')) return null;" },
  { name: '#135 idb open() 兜底落地超时（open 挂起→idbRestore 永不完成→开屏卡死，iPad 7 Edge）', file: 'js/idb.js', needle: "reject(new Error('idb open hang'))" },
  { name: '#135 idb open() onblocked 处理（版本升级被旧连接阻塞时永不落地同上）', file: 'js/idb.js', needle: 'req.onblocked' },
  { name: '#135 开屏 20s 硬保险丝 readyForced（数据未就绪也放行进入，开屏永不死锁）', file: 'js/clock.js', needle: 'readyForced' },
  { name: '#137 miniSafeTop 三级探测链（env 探针→差值→59px 兜底，通话小框永不落进系统状态栏区）', file: 'js/call.js', needle: 'if (!top) top = 59;' },
  { name: '#137 小框显示时抬升 liftMiniIntoSafeArea（5 处显示点统一校正旧坐标）', file: 'js/call.js', needle: 'function liftMiniIntoSafeArea()' },
  { name: '#147 壁纸常驻图层（进出桌面只切 opacity 不清空/重设 backgroundImage，修 iOS 反复主线程解码大图巨卡）', file: 'js/personalize.js', needle: 'const setBgLayerImage = (data) => {' },
  { name: '#147 图层值变才写+隐藏保留图（setBgLayerVisible opacity 短路）', file: 'js/personalize.js', needle: "const v = on ? '1' : '0';" },
  { name: '#140 desk-layout 完整性校验+坏键自愈（损坏/空壳布局清键回默认，修华为Pura70Pro+/Chrome 等安卓「小组件卡片大部分不显示」——坏值会把全部卡片扫进隐藏池且 IDB 回填每次复发）', file: 'js/personalize.js', needle: "console.info('[mochi] desk-layout 校验失败（损坏/空壳），忽略并清除')" },
  { name: '#140 隐藏池不收「列在缺失页」的组件（inAnyPage 有名即不进池，防删页/校验重建后误判布局外整批隐藏）', file: 'js/personalize.js', needle: 'if (inAnyPage[wid]) return;' },
  { name: '#140 saveDeskLayout 写前防损坏（重复 id/页数超界放弃保存清键，不把坏值固化进 IDB）', file: 'js/personalize.js', needle: "if (!ok) { try { store.remove('desk-layout'); } catch (e) {} return lay; }" },
  { name: '小组件独立透明度（widget-opacity-<type> 内联覆盖全局，装修模式点卡片单调+可应用到全部）', file: 'js/personalize.js', needle: "const widgetOpKey = (type) => 'widget-opacity-' + type;" },
  { name: '#140 deskRebuild 页数钳制（idx≥slides.length 时不再把 scrollLeft 设到超界空白页位，修滑页停在空白=卡片全不显示的视觉形态）', file: 'js/desktop-slider.js', needle: 'Math.min(Math.max(slides.length - 1, 0), idx)' },
  { name: '#141 安卓返回键/手势收键盘灰块几秒才收（vv 高度上升探测置 _aClosing：收起动画期零强制布局读取，焦点保留 focusout 不来也生效）', file: 'js/mobile-adapt.js', needle: 'if (_aKb && h > _aPrevH && _aPrevH > 0) {' },
  { name: '#141 收起复原时 _aH 基线钳回布局视口全高（防基线停留低位把 .phone 锁死中间高度=灰块不收）', file: 'js/mobile-adapt.js', needle: 'if (_aH < window.innerHeight - 12) _aH = window.innerHeight;' },
  { name: '#141 悬浮键盘推定收口（用户键入 1200ms 内即放行推顶，不等 2200ms 无活动自愈）', file: 'js/mobile-adapt.js', needle: 'if (!tgt || Date.now() - _aUserTypos > 1200) return;' },
  { name: '#144 isIOS 补 iPadOS 伪装 UA 分支（Macintosh+触摸屏，修 iPad Air 全屏开关无反应/ios-pwa-standalone 类不加）', file: 'js/device.js', needle: "((navigator.platform === 'MacIntel' || /Macintosh/i.test(ua)) && navigator.maxTouchPoints > 1 && 'ontouchstart' in window);" },
  { name: '#144 armFgIdbReset 补 touchMac 分支（伪装 UA 的 iPad 回前台重建 IDB 连接；收口第二批改读 mochiDevice.isIOS——device.js isIOS 含 Macintosh 伪装分支，删门=伪装 iPad 断连不重建）', file: 'js/idb.js', needle: 'if (!((window.mochiDevice || {}).isIOS)) return;' },
  { name: '#148 syncVvFit 顶部避让改 env() 探针实测（iOS26 已避让形态 env=0 不再加页面 padding，修 Mochi 行上方大空白）', file: 'js/mobile-adapt.js', needle: 'padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;' },
  { name: '#148 fs 态写 --mochi-ios-h（判定器 expBase：envTop+inner min 屏高，覆盖=整屏/已避让=inner；#210 起公式收敛到共享判定器）', file: 'js/mobile-adapt.js', needle: 'Math.round(_f.expBase) : 0' },
  { name: '#148 fs 态 .phone 高度用 --mochi-ios-h（回 100vh 兜底）', file: 'css/base.css', needle: 'height:var(--mochi-ios-h, 100vh);' },
  { name: '#175 屏幕适配诊断入口（设置页 row-screen-diag，与信息诊断分开）', file: 'template.html', needle: 'id="row-screen-diag"' },
  { name: '#175 屏幕适配诊断采集+纯函数判定器（六形态自动判定）', file: 'js/device.js', needle: 'function screenDiagJudge(inp)' },
  { name: '#177 功能诊断入口（设置页 row-func-diag，逐项测试全部功能）', file: 'template.html', needle: 'id="row-func-diag"' },
  { name: '#177 功能诊断采集器（T1 入口/T2 容器/T3 真实打开三极测试）', file: 'js/device.js', needle: 'async function collectFuncDiag()' },
  { name: '#185 屏幕适配采集器：状态栏隐藏跳过+相对 .phone 测量（聊天页误报顶部重叠修复）', file: 'js/device.js', needle: 'sbTop: (sr && pr) ? Math.round(sr.top - pr.top)' },
  { name: '#185 fs standalone 文档滚动锁（修 iPad 橡皮筋弹跳/滑动飞）', file: 'css/base.css', needle: 'html.ios-pwa-standalone.ios-fs-active body { height:var(--mochi-ios-h, 100vh); min-height:0; overflow:hidden;' },
  { name: '#185 平板 iOS 全屏全宽铺满（修 640 限宽左右露白）', file: 'css/base.css', needle: 'html.tablet.ios-fs-active .phone { width:100vw; max-width:none; }' },
  { name: '#212 force 声明形态自愈看门狗（发消息键盘周期后白带/上移 1s 内自动复位）', file: 'js/mobile-adapt.js', needle: 'if (_short > 8) {' },
  { name: '#213 视口时间线环形缓冲（每秒 1 拍保留 60 条，瞬态回放数据源）', file: 'js/mobile-adapt.js', needle: 'function vvLogPush()' },
  { name: '#213 屏幕适配报告尾部视口时间线回放段', file: 'js/device.js', needle: '近 60 秒视口时间线（键盘开合/缩放/白带瞬态回放）' },
  { name: '#213 报告系统版本行（形态判定依赖 iOS/Safari 版本映射）', file: 'js/device.js', needle: "系统=' + (inp.osLine" },
  { name: '#214 屏幕适配报告页面专项：聊天页（可见/消息节点/输入栏贴底）', file: 'js/device.js', needle: '输入栏：底边=' },
  { name: '#214 屏幕适配报告页面专项：主页（页数/图标/池内组件清单）', file: 'js/device.js', needle: '池内组件=' },
  { name: '#216 聊天页键盘期专项：键盘高度/输入栏底边采集（上移/被盖直接定位）', file: 'js/device.js', needle: 'inp.chat.kbActive' },
  { name: '#174 viewport meta 锁 minimum-scale=1（iOS26 主屏幕形态 scale≈0.85 缩小致顶部露白，meta 防线）', file: 'template.html', needle: 'minimum-scale=1.0' },
  { name: '#174 独立应用缩放异常自愈（scale<0.95 重写 viewport meta 吸附回 1，限 3 次）', file: 'js/mobile-adapt.js', needle: '_zoomFixCnt < 3 && _now - _zoomFixAt > 4000' },
  { name: '#146 组件透明度小数脏值解析 opacityRawToPct（≤1 按 ×100 换算，修随机美化写 0.9/1 被 parseInt 成 0 → 小组件全透明）', file: 'js/personalize.js', needle: 'opacityRawToPct' },
  { name: '#146 一键随机美化功能已删除（row-beauty-random 处理块 absent）', file: 'js/personalize.js', needle: "getElementById('row-beauty-random')", absent: true },
  { name: '#146 随机美化入口已删除（template absent）', file: 'template.html', needle: 'row-beauty-random', absent: true },
  { name: '#151 壁纸图层 size/pos 每次刷新（移出「图变才写」守卫，修壁纸定位/缩放改键不生效+同图异 pos 跨桌面串用=背景不按比例铺满；图本身仍值变才写保 #147 防 iOS 重解码）', file: 'js/personalize.js', needle: 'if (l.style.backgroundSize !== szWanted) l.style.backgroundSize = szWanted;' },
  { name: '#151 无布局桌面还原模板排布（applyDeskLayout 无布局不再直接 return，归还被上个桌面扫进隐藏池的组件、修「切联系人回来小组件隐藏/桌面串显示」）', file: 'js/personalize.js', needle: 'if (!lay) { restoreTemplateDesk(); return; }' },
  { name: '#151 切桌面期间 buildDeskPages 删页收缩不落盘（防把上一桌面排布写成新桌面 desk-layout=跨桌面污染持久化）', file: 'js/personalize.js', needle: 'if (deskLayout() && !deskSwitchBuild) saveDeskLayout();' },
  { name: '#151 切桌面美化键缺键复位（widget-opacity 无键回 100，修上一桌面透明度残留=小组件隐身但可点/不同桌面显示不一样）', file: 'js/personalize.js', needle: 'if (!isNaN(opPct)) applyWidgetOpacity(opPct); } else applyWidgetOpacity(100); }' },
  { name: '#151 美化抽屉透明度滑杆统一解析+复用共享 applier（不再写 #146 同族小数脏值/不再把存量 90 算成 9000；边看边调优化批换锚——抽屉透明度改走 applyWidgetOpacity(整数pct)+默认 persist 落库，自制小数写法消失即回流）', file: 'js/personalize.js', needle: "applyWidgetOpacity(parseInt(v, 10))" },
  { name: '单聊联系人消息音效（addIn 播 sfx-in，read/silent 除外）', file: 'js/chat.js', needle: "opts.special !== 'read'" },
  { name: '音效等待 AudioContext resume 后再 start（Via/WebView）', file: 'js/sfx.js', needle: 'p.then(start)' },
  { name: '群聊引用防 base64 霸屏（gcQuoteTextSafe）', file: 'js/group-chat.js', needle: 'gcQuoteTextSafe' },
  { name: '聊天大数据分批/延迟归一化（防 OOM 崩溃）', file: 'js/chat.js', needle: 'scheduleDeferredNormalization' },
  { name: '消息长按打开操作菜单（openMsgActionsAt 长按+轻点）', file: 'js/chat.js', needle: 'openMsgActionsAt' },
  { name: '群聊消息长按打开引用菜单（gcOpenMsgActions 长按+轻点）', file: 'js/group-chat.js', needle: 'gcOpenMsgActions' },
  { name: '错误记录双写 IndexedDB（readErrs 回退读取，防"最近错误：无"丢线索）', file: 'js/device.js', needle: 'idbSet(ERR_KEY' },
  { name: '更新条防重复（ver-update-ack-ts 按版本免打扰 + showVerBar 跨通道收口）', file: 'js/pwa.js', needle: 'ver-update-ack-ts' },
  { name: '#225 更新条一直重复提醒收口v2（showVerBar 弹条门加 verSeen 一版一弹：同版本只弹一次不按时间过期+弱网无 ts 不绕过；新版本立即弹无任何时间窗——站点主口径一天可部署十几次，v1 的 24h 时间窗已废）', file: 'js/pwa.js', needle: '!verShouldNotify(onlineTs) || verSeen(onlineTs)' },
  { name: '#273 普通刷新自愈进新版（pageshow 冷加载对比云端版本，更新且本会话未尝试时 tryAutoUpgrade 走 PRECACHE_NOW+reload 自动进新版；session 守卫防死循环，失败退回更新条；字符串键压缩后仍在产物，比函数名锚稳）', file: 'js/pwa.js', needle: "'xy-home-v2:auto-upgrade-session'" },
  { name: '#273 弱网刷新兜底（拉 version.json 连败弹「网络异常」更新条+重试刷新入口，防弱网下顶部刷新按钮消失）；字符串锚压缩后仍在产物', file: 'js/pwa.js', needle: "'网络异常，未能确认最新版本'" },
  { name: '#279 自动升级防打断（重载落地前复核用户活动：auto 且用户已交互且前台时放弃重载退回更新条，防弱网预取几十秒后砸进会话中途「页面自己重开」；删/改该条件即断）', file: 'js/pwa.js', needle: 'auto && !autoReloadAllowed()' },
  { name: '公用拍一拍选中态去虚线统一（poke-tab-pub.sel 实心）', file: 'css/dark.css', needle: 'poke-tab-pub.sel { background:var(--ink)' },
  { name: '吃什么切菜单可直接选指定菜单（eatSwitchRenderChips 直选，不复用转盘）', file: 'js/p2-features.js', needle: 'function eatSwitchRenderChips' },
  { name: '导出聊天记录以 IDB 权威为准（lsBig 兜底，防取旧快照）', file: 'js/data-backup.js', needle: '留待 IndexedDB 权威读取' },
  { name: '恢复默认桌面预选中确认（ctl.pills 预选「确定恢复默认」，只点确定也生效）', file: 'js/personalize.js', needle: "ctl.pills([{ label: '确定恢复默认', value: '1' }], '1')" },
  { name: '内置壁纸预设可见性（bgPresetCss + applyBgVisibility 认预设）', file: 'js/personalize.js', needle: 'bgPresetCss' },
  { name: '应用美化方案预选中确认（桌面+聊天 ctl.pills 预选「应用」，只点确定也生效）', file: 'js/personalize.js', needle: "ctl.pills([{ label: '应用', value: 'ok' }], 'ok')" },
  { name: '冷启动回复池取回自定义字卡（v3.28.x 口径演进=#442：缺失即 hydrateLibScopes 按需取回+就绪判定不被默认字卡遮蔽；旧锚 function replyScopeGroups 随 #442 池视图收口移除）', file: 'js/chatcard.js', needle: 'if (window.hydrateLibScopes) window.hydrateLibScopes([\'public\', \'own\']);' },
  { name: 'TA档案删除确认预选「删除」pill（删除这条/了解/疑问/暂不适用/已了解 只点确定也生效）', file: 'js/memo-arc.js', needle: "saveArc(cur, arc); toast('已删除'); render();\n}, { noInput: true, pill: 'del', pills:" },
  { name: '我的档案删除确认预选「删除」pill（删除这条/描述卡 只点确定也生效；#106 收口时随 fan-out 重构改锚到 delLi 现文本）', file: 'js/my-arc.js', needle: "fanOutRemove(kind, id); toast('已删除'); render();\n}, { noInput: true, pill: 'del', pills:" },
  { name: '番茄钟提前结束预选「结束」pill（只点确定也生效）', file: 'js/p2-features.js', needle: "noInput: true, lock: true, pill: '1', pills" },
  { name: '导出进度遮罩 + 确认后再下载（impShow 复用 + anchorDownload 只在用户点确定后触发）', file: 'js/data-backup.js', needle: 'anchorDownload' },
  { name: '诊断复制改原生 execCommand + 按钮补 type=button（修点【复制】无反馈/整页刷新）', file: 'js/device.js', needle: 'document.execCommand(\'copy\')' },
  { name: '#113 诊断取消自动复制（点开不再弹输入法又收起致灰屏；手机剪贴板有字数上限、长文本静默截断，改由用户手动【复制】/【导出】；#227 txt→docx 同步改锚 exportDocx→#227 改名后锚 diagExportDocx）', file: 'js/device.js', needle: 'diagExportDocx(c ? c.text() : cur)' },
  { name: '#227 诊断导出 docx（手写存储式 ZIP 本地头签名——docx 生成本体；删掉改回纯文本即消失=「导出docx」点了下不动）', file: 'js/device.js', needle: 'setUint32(0, 0x04034b50' },
  { name: '弹窗底部按钮补 type=button（取消默认 submit 整页刷新）', file: 'index.html', needle: 'type="button" class="modal-btn copy" id="modal-export"' },
  { name: '编辑消息同步重建 parts（防发送新消息后重渲染回退成原文）', file: 'js/chat.js', needle: '.filter(p => p && p.k !== \'text\')' },
  { name: 'idbSet 写入挂起 4s 超时+重建重试（荣耀/Edge 事务挂起静默丢写）', file: 'js/idb.js', needle: '连接疑似挂起' },
  { name: 'idbHydrateKey 慢读取回 6s+8s（慢但可用 IDB 低端机自定义字卡取不回落兜底）', file: 'js/idb.js', needle: 'window.idbHydrateKey = function' },
  { name: '小键写日志 __wr-journal（杀进程回滚 LS 后设置开关回退的恢复链）', file: 'js/idb.js', needle: '__wr-journal' },
  { name: '语音开关去掉静默早退守卫 + mochi-wrj-heal 重同步（首点无反应）', file: 'js/chat-settings.js', needle: "document.addEventListener('mochi-wrj-heal', syncVs);" },
  { name: 'dc-* 开关监听 mochi-wrj-heal 重同步（退出重进设置回退自愈）', file: 'js/default-cards.js', needle: "document.addEventListener('mochi-wrj-heal', function () { try { syncDcSwitchUI(); } catch (e) {} });" },
  { name: '诊断「开关持久化体检」（LS/读取/IDB 三层值 + LS 写探针）', file: 'js/device.js', needle: '开关持久化体检' },
  { name: '自动备份副本已下线：启动时自动清理遗留副本释放空间（purgeLegacySnapshot）', file: 'js/data-backup.js', needle: 'purgeLegacySnapshot' },
  { name: '后台听歌不误报「会员/移出」弹窗（offerRemoveDamagedSong 后台直返不计数 + 回前台 bgResumeFails 清零）', file: 'js/music-player.js', needle: '后台冻结/断流误触发 onerror，不弹「移出」窗不计数' },
  { name: '#117 本地音乐刷新后播放失败（music-file 脏值守卫：plausibleLocalValue 形状校验 + LS 脏值跳过读 IDB + purgeLocalFile 清脏）', file: 'js/music-player.js', needle: 'function plausibleLocalValue(v) {' },
  { name: '聊天联系人昵称取名链（chatLabel dk=null 不读桌面美化键＋名片名回退，删名片名环＝只改联系人管理改名后拍一拍仍显示 TA #775）', file: 'js/chat.js', needle: "chatLabel('cs-lbl-partner', null, '')" },
  { name: '#775h 聊天设置昵称行显示实际生效名（未设聊天昵称时顶栏取的是联系人名片名，写死默认 TA 会让用户以为两处不是同一个名字）', file: 'js/chat-settings.js', needle: "未设置（当前显示「" },
  { name: '通话昵称与聊天域解耦（cs-lbl-partner 优先，回退名片名，不读桌面键）', file: 'js/call.js', needle: "window.contactNameFor ? window.contactNameFor(currentCall.cid) : '')" },
  { name: 'migrateLegacy def/root 提升函数顶部（修启动 ReferenceError 中断迁移）', file: 'js/contacts.js', needle: 'const root = window.xyStore(G);' },
  { name: 'iOS Edge 视口事件盲区兜底（window resize/工具条显隐 + 1s 轮询并进自愈，修输入栏下空一大块/页面上移残留）', file: 'js/mobile-adapt.js', needle: "addEventListener('orientationchange', onIosVvEvent)" },
  { name: '位置面板返回按钮半屏也显示（.loc-back 默认 flex，修聊天寻踪半框入口无返回按钮无法关闭）', file: 'css/chat-pages.css', needle: '.loc-back {\ndisplay:flex;' },
  { name: '夜宵提醒专属字卡（nightcap 窗口抽「夜宵提醒/夜宵关心」池，不再复用"按时吃饭"文案）', file: 'js/p2-features.js', needle: 'DEF_EAT_REMIND_NIGHT' },
  { name: '房间放置/移动横幅取消钮能真正隐藏（.r-banner[hidden] 补 display:none，修「取消」弹窗一直不消失）', file: 'index.html', needle: '.r-banner[hidden] { display: none; }' },
  { name: '桌面「已摸鱼」卡与「今日情话」卡文字水平对齐（.mini-card fish .mc-b 与情话等高，修两卡标题/正文错位）', file: 'css/home.css', needle: '.mini-card[data-card-bg="fish"] .mc-b' },
  { name: '单聊持久化改空闲调度（schedulePersist，修发消息/来消息/切页 2~3s 长任务卡顿）', file: 'js/chat.js', needle: 'function schedulePersist' },
  { name: '群聊持久化改空闲调度（gSchedulePersist，同上修大群聊全量同步写卡顿）', file: 'js/group-chat.js', needle: 'function gSchedulePersist' },
  { name: '桌面长按误触入口已移除（仅「编辑布局」主动进移动模式，修图标被误拖乱/要求固定一行4个）', file: 'js/personalize.js', needle: 'pressTimer = setTimeout(() => {\npressTimer = null;\nenterMoveMode();\nstartDeskDrag(e, t);', absent: true },
  { name: '移动模式横滑翻页判定已移除（图标横向拖动直接拖拽，修华为只能竖着换排）', file: 'js/personalize.js', needle: 'Math.abs(dx) > Math.abs(dy) * 1.5', absent: true },
  { name: '恢复默认桌面等 IDB 删除落盘再 reload（防华为/慢 IDB 回填旧布局，修「恢复默认没生效」）', file: 'js/personalize.js', needle: "idbDelete(P + ':desk-layout')" },
  { name: '弹窗文件导入自动应用（_modalOpts 修 opts 作用域 ReferenceError，修「导入美化方案选完文件没反应」）', file: 'js/personalize.js', needle: '_modalOpts' },
  { name: '弹窗嵌套守卫（_openSeq：fire 内开新弹窗则外层 close 跳过，修「导出美化方案」选完来源看不到导出方式）', file: 'js/personalize.js', needle: '_openSeq' },
  { name: '美化导出/导入只保留文件方式（「复制文字」整体移除，防剪贴板截断/粘贴导入不可行）', file: 'js/personalize.js', needle: 'function showBeautyFallback', absent: true },
  { name: '经期温柔动作后缀六条全部进字卡库（WARM_SUFFIX 同源，dc-off-period 逐张开关；防只写 1 条回归）', file: 'js/default-cards-data.js', needle: '（把你往怀里带了带）' },
  { name: '导出 IDB-only 大键重试兜底（IDB 读取失败重试一次 + LS 终极兜底，修>200KB 信箱数据导出丢失）', file: 'js/data-backup.js', needle: 'const lsV = localStorage.getItem(k)' },
  { name: '导出确认弹窗显示功能覆盖清单 + 体积自动换算 MB（fmtSize/exportCoverage，修导出看不到导了哪些功能/只有 KB）', file: 'js/data-backup.js', needle: '导出内容（全局全部数据）' },
  { name: 'idbSet 写入失败计数成功即清零 + 大包写入超时按体积放大（修旧数据多「存储异常」弹窗每会话必现：偶发失败污染全会话计数+合法大包写入被 4s 误判）', file: 'js/idb.js', needle: '成功即清零——只对连续失败告警' },
  { name: '拍一拍人称修复（sendPoke/performPoke 存 {me}/{ta} 占位符 + 渲染层 taFit 期间遮罩占位符，昵称不再被称呼改写成 他/ta/她）', file: 'js/chat.js', needle: "const hasPh = t.indexOf('{ta}') >= 0 || t.indexOf('{me}') >= 0" },
  { name: '打砖块球数切换即时生效（进行中切球数立即补发/剪除，不打断对局，修「玩的时候切换2个球无效」）', file: 'js/breakout.js', needle: 'while (state.balls.length > target) {' },
  { name: '打砖块进行中可放弃旧局重新开局（resume 分支副按钮=「新开局」，修「开启无法选多个球」）+ 结束面板副按钮文字重置', file: 'js/breakout.js', needle: "overlayCloseBtn.textContent = '新开局'" },
  { name: '音乐·TA 暂停再播放互动（播放中 taPauseProb 小概率 TA 暂停→发字卡→3.5s 后点播放恢复→再发字卡；设置可调、字卡库「音乐」tab 逐张开关）', file: 'js/music-player.js', needle: 'taPauseProb' },
  { name: '音乐·TA 暂停权限开关 + 防连发（taPauseEn 总开关关闭=彻底不触发；同一首歌只互动一次 + 冷却防"一直暂停又继续"）', file: 'js/music-player.js', needle: 'taPauseEn' },
  { name: '音乐·TA 暂停再播放字卡数据（「TA 暂停播放/TA 恢复播放」两组进系统预设字卡【其他互动功能字卡→音乐】）', file: 'js/default-cards-data.js', needle: 'TA 暂停播放' },
  { name: '音乐·TA 暂停播放补聊天系统消息（暂停时除字卡外再发"XX 暂停了音乐"系统消息，与其他音乐互动一致）', file: 'js/music-player.js', needle: '暂停了音乐' },
  { name: '音乐·TA 恢复播放补聊天系统消息（恢复时除字卡外再发"XX 又播放了音乐"系统消息）', file: 'js/music-player.js', needle: '又播放了音乐' },
  { name: '弱网/断网 play 拒绝回调判空（audio 异步回调期间可能已被 teardown 置空 → 先判空再解锁播放，修「Cannot read properties of null (reading \'play\')」红米K80 断网崩溃）', file: 'js/music-player.js', needle: '判空防 null.play()' },
  { name: '桌面图标 IDB 回填并行（Promise.all 一次读完 app-icon-*，修更新后首启「上传的图标图片消失数秒刷新才回来」）', file: 'js/personalize.js', needle: 'Promise.all(iconKeys.map' },
  { name: '互动卡片收藏全覆盖（cardSnapshot 补齐 ask/红包/送花/礼物/佳肴 + 心形按 data-idx 定位，修「有的卡片可以收藏有的点击无效」）', file: 'js/chat.js', needle: "favBtn.closest('[data-idx]')" },
  { name: '导出彻底不再写本机副本（absent 守卫：出现 idbSet(SNAPSHOT_KEY 即回归——iOS 导出闪退 #73 / 安卓导出后本地存储被写坏 #82 的根因）', file: 'js/data-backup.js', needle: 'idbSet(SNAPSHOT_KEY', absent: true },
  { name: '批量导入/上传持久化延后（scheduleSave 替代同步 saveGroups，修添加字卡后卡顿——同步序列化大库阻塞主线程）', file: 'js/chatcard.js', needle: "scheduleSave();\nrenderGroupsBar();\nrender();\ntoast('已导入 ' + imported" },
  { name: 'iOS PWA standalone ios-fs-active 下 .phone 用实测 --mochi-ios-h（修桌面图标被裁/100vh 超出视口）', file: 'css/base.css', needle: '.ios-pwa-standalone.ios-fs-active .phone' },
  { name: '开屏置顶澄清行可换行（splash-clarify 放开 nowrap，修澄清长句 nowrap 超出手机屏幕）', file: 'css/base.css', needle: '.splash-source-line.splash-clarify { white-space:normal' },
  { name: 'iOS 非 standalone 全屏/浏览器态 .phone 高度 min 钳制到 100dvh（修全屏模式整页上移顶栏点不到：--mochi-ios-h 超过视口时 flex 居中把 .phone 顶部推出负值，覆盖聊天页在内所有功能页）', file: 'css/base.css', needle: 'html.tablet.ios-vv-fit:not(.ios-pwa-standalone) .phone { height:min(var(--mochi-ios-h, 100dvh), 100dvh)' },
  { name: 'iOS standalone+ios-fs-active .phone 铺满物理屏 100vh + 顶部安全区（v3.28.x #114 取代旧 100dvh 钳制：100dvh 只算状态栏下方 → iPhone15 底部空 59px；改 100vh 铺满 + padding-top 安全区，顶部内容下移不重叠、底部贴底）', file: 'css/base.css', needle: 'html.tablet.ios-pwa-standalone.ios-fs-active .phone {' },
  { name: 'iOS standalone 普通态（未开全屏 ios-fs-active）`.phone` 高度 min 钳制（100vh 在 iOS standalone=整屏高含状态栏，超出可视区 → flex 居中把 .phone 顶部推出负值整页上移，iPhone14 Safari standalone 实测 .phone=932 vs 视口 873、top=-29；补上 #109 漏掉的第三条路径）', file: 'css/base.css', needle: 'html.tablet.ios-pwa-standalone .phone { height:min(100vh, var(--mochi-ios-h, 100dvh)' },
  // ==== #537 iOS 独立应用【普通态·覆盖形态】整页上移 / 底部白条 / 底部栏不贴底（2026-09-15）====
  // 用户报障（iPhone 17 自带 Safari 主屏幕打开，明说其他设备型号也有）：「集体屏幕上移、底下有白条、
  // 底部栏不贴手机底部」；诊断 SIG screen=956 inner/vv=894 env=62、.phone 高=956 底=925 tabbar=873。
  // 根因：html/body 停在 100dvh(894) 而 .phone 撑到整块物理屏 956（#179 expBase=envTop+inner）→
  // 父容器 flex 居中把 .phone 整块上移 31px（顶钻系统栏 + 底露白带 + tabbar 悬空三个现象同源）；
  // 且该形态 CSS 侧无人避让状态栏、.phone 底部内边距还与 --mochi-safe-bottom 叠成 52px 空档。
  // 六条锚分别覆盖「形态判定 / 执行器挂类 / 容器钉高 / 状态栏抬升 / 底部归零 / 诊断口径」，
  // 任一被整块删掉或逻辑改坏即报警（needle 均为各自文件内唯一表达式）。
  { name: '#537 判定器给出 iOS 独立应用覆盖形态位（删/改判式 → 执行器不再挂 ios-cover-top，状态栏避让与容器钉高整链失效、整页上移复发）', file: 'js/device.js', needle: 'const iosCover = standalone && !forceCover && !resStand && !ipadForm && envTop >= 20 && envTop <= 160;' },
  { name: '#537 执行器按判定器挂/摘 ios-cover-top（逻辑侧唯一落地开关；删则 CSS 规则永不生效）', file: 'js/mobile-adapt.js', needle: "d.classList.toggle('ios-cover-top', _wantIosCover);" },
  { name: '#537 iOS standalone html/body 钉到与 .phone 同高 + 顶对齐（修「整页上移 + 底部 31px 白条」；改回 100dvh 居中即复发。#114 全屏态同款父类 bug。作用域收在 .ios-cover-top：只有覆盖形态 --mochi-ios-h≠100dvh 才有位移可修。2026-09-19 #853 换锚：dvh 兜底收进 @supports，主行改 vh 基线）', file: 'css/base.css', needle: 'html.ios-pwa-standalone.ios-cover-top body { height:var(--mochi-ios-h, 100vh); min-height:0; align-items:flex-start; }' },
  { name: '#537 iOS 独立应用覆盖形态 .phone 底部内边距归零（修「底部栏不贴手机底部」：原 18px 内边距与 tabbar 的 --mochi-safe-bottom 叠成 52px 空档）', file: 'css/base.css', needle: 'html.ios-cover-top .phone { padding-bottom:0; }' },
  { name: '#537 iOS 独立应用覆盖形态状态栏自身抬升（该形态 .phone 无顶部 padding 兜底链、窄屏 @media 的 env 留白又被后加载同特异性 .statusbar{padding:4px} 压死 → Mochi 行钻进系统状态栏＝诊断 ✗顶部重叠，删即复发）', file: 'css/base.css', needle: 'html.ios-cover-top .phone .statusbar {' },
  { name: '#129 iOS standalone 底部安全区不归零（screen-innerHeight>60 在 standalone 是系统状态栏/Home 指示条而非浏览器工具条，viewport-fit=cover 下 Home 指示条在可视区内，归零会让 tabbar/底部组件不避让被遮；standalone 下摘除属性回落 env() 正确避让）', file: 'js/mobile-adapt.js', needle: "sh - ih > 60 && !d.classList.contains('ios-pwa-standalone')" },
  { name: 'iOS 全屏态 syncVvFit 不再写 --mochi-ios-h（摘除属性回落 100dvh，修全屏下 visualViewport.height 偏小把 .phone 压矮→底部聊天输入栏整体偏上不贴底；同时不超视口不复发 #109 整页上移）', file: 'js/mobile-adapt.js', needle: "d.classList.contains('ios-fs-active') || d.classList.contains('ios-native-fs')" },
  { name: 'iOS 全屏保留桌面顶部状态栏（不再 display:none，修「苹果16 添加到桌面+全屏后桌面顶部 Mochi/时间/电量一行不见被遮挡」；absent 守卫：若出现 .ios-fs-active .phone .statusbar { display:none } 即回归）', file: 'css/base.css', needle: '.ios-fs-active .phone .statusbar { display: none', absent: true },
  { name: '#114(复现) iOS 全屏态顶部安全区统一修复（iPhone15+Safari 主屏幕全屏 env(safe-area-inset-top)=0 → 桌面状态栏与系统栏重叠/聊天返回键被吞点；.phone 改 100vh 铺满物理屏 + padding-top:max(var(--mochi-safe-top,env),12px) 整体下移，修顶部重叠 + 底部 59px 空隙 + iPhone17 Edge 图标截断）', file: 'css/base.css', needle: 'padding-top:max(var(--mochi-safe-top, env(safe-area-inset-top, 0px)), 12px);' },
  { name: '#114(复现) iOS standalone 顶部安全区实测（env(safe-area-inset-top)=0 → 用 screen.height-可视高 实测状态栏高度写 --mochi-safe-top 供 CSS 避让，20-160 过滤干扰）', file: 'js/mobile-adapt.js', needle: "d.style.setProperty('--mochi-safe-top'" },
  { name: '#114(复现) 通话缩略窗顶部安全区避让（落位/拖拽上边界抬到系统状态栏下方，修「缩略窗在顶部动不了」被系统栏吞触点）', file: 'js/call.js', needle: 'ty = Math.max(Math.max(miniSafeTop(), voT), Math.min(voT + vh - mh - 4, ty))' },
  { name: '后台音乐媒体条不丢（__musicWantPlay 暴露播放意图 + bg-keep 不让位覆盖歌曲媒体条 + onplay 重绑歌曲元数据，修红米K80 Chrome 通知栏媒体条时有时无/挂后台停播）', file: 'js/music-player.js', needle: '__musicWantPlay' },
  { name: '后台补播连续失败改冷却重试（bgResumeFailAt 60s 清零，修「挂后台总是自己停止播放」后无人拉起）', file: 'js/music-player.js', needle: 'bgResumeFailAt' },
  { name: '录音爆音修复（voiceMimePreferOpus：标准安卓 Chrome/Edge 走 webm/opus，修荣耀90 Edge 语音「滋啦滋啦」爆音；iOS/安卓 WebView 仍走 mp4/aac）', file: 'js/chat.js', needle: 'voiceMimePreferOpus' },
  { name: '此间梦角显式归属纠偏（fixBelonging 按 cid 搬回错放梦角，修不同联系人梦角串桌）', file: 'js/cjian.js', needle: 'function fixBelonging' },
  { name: '此间认亲匹配双名字（homeCidForName 同时匹配 TA 昵称与联系人名，修 lbl-partner 与联系人名不一致认不到家）', file: 'js/cjian.js', needle: 'idn === n || cn === n' },
  { name: '#409 此间串桌修复·按名认亲降级一次性（cjian-belong-v2 标记后 cid 权威，修梦角名撞联系人名/改名认领后每次启动反复搬桌）', file: 'js/cjian.js', needle: "'cjian-belong-v2'" },
  { name: '#409 此间串桌修复·迁移注册表就绪闸（未就绪不认亲不清根键，防错归属被固化）', file: 'js/cjian.js', needle: "if (!r.get('contacts')) return;" },
  { name: '#409 此间串桌修复·联系人改名梦角跟随（contact-renamed 监听同步旧名梦角，防名字与身份漂移）', file: 'js/cjian.js', needle: "addEventListener('contact-renamed'" },
  { name: '#409 此间串桌修复·播种昵称链对齐（cs-lbl-partner 优先，梦角名与聊天里看到的名字一致）', file: 'js/cjian.js', needle: "get('cs-lbl-partner')" },
  { name: '#409 此间串桌修复·标记键全局豁免（EXCLUDE 登记，防 migrateLegacy 搬进 default 删根键致救回逻辑每刷重跑）', file: 'js/contacts.js', needle: "'cjian-belong-v2',\n" },
  { name: '#514 此间梦角归属自愈·自愈函数就位（多桌面「名字串桌」存量救济：错放梦角按名字搬回同名桌面）', file: 'js/cjian.js', needle: 'function healBelonging()' },
  { name: '#514 此间梦角归属自愈·产品函数暴露（回归脚本直接断言产品函数而非复刻实现）', file: 'js/cjian.js', needle: 'window.cjianHealBelonging = healBelonging;' },
  { name: '#514 此间梦角归属自愈·打开此间时自愈+搬空后重新播种（同一拍，避免中间态被渲染）', file: 'js/cjian.js', needle: 'try { healBelonging(); seedIfEmpty(curCid()); } catch (e) {}' },
  { name: '#514 此间梦角归属自愈·切分组时自愈（防别的桌面的梦角挂在本分组下，即用户报的症状）', file: 'js/cjian.js', needle: 'try { healBelonging(); } catch (e) {}' },
  { name: '#514 此间梦角归属自愈·本尊标记（播种梦角带 own，名字漂移时按本桌有效昵称对齐）', file: 'js/cjian.js', needle: "offsetMin: 0, cid: cid, own: 1 })" },
  { name: '#514 此间梦角归属自愈·手动标记（用户手动添加/改名的梦角带 manual，永不自动搬——#409 顾虑的正面解法）', file: 'js/cjian.js', needle: 'c.manual = 1;' },
  { name: '桌面美化·全局字体快捷入口（复用聊天设置 cs-font 键，applyDeskCsFont 注入同款 @font-face，两边互通）', file: 'js/personalize.js', needle: 'applyDeskCsFont' },
  { name: '桌面美化·图标文字颜色（applyAppNameColor 注入 style 覆盖 .app .app-name color）', file: 'js/personalize.js', needle: 'applyAppNameColor' },
  { name: '桌面美化·颜色分区预览面板（desk-color-preview 各部位用 CSS 变量着色实时反映各项颜色）', file: 'template.html', needle: 'desk-color-preview' },
  { name: '贴贴同意后回应不带主动爱心（cuddle 回应去 initiative，修「同意贴贴后 TA 回应也显示主动联系爱心」）', file: 'js/chat.js', needle: "pick(CUDDLE_REPLIES), { initiative: true })", absent: true },
  { name: '大备份下载长命 blob URL（anchorDownload 保留到 pagehide/5 分钟才释放，修小米14U Edge 导出「点了下载没反应/没下载完」）', file: 'js/data-backup.js', needle: "addEventListener('pagehide', function h()" },
  { name: 'IDB 连接级错误判定加宽 + iOS 回前台主动重建连接（connLost 补 UnknownError/InternalError/TransactionInactiveError，修 iPhone 16 Pro Safari「存储异常」弹窗每会话必现）', file: 'js/idb.js', needle: 'armFgIdbReset' },
  { name: '开屏数据未就绪不放行（idbRestore 12s 保险丝改派发 mochi-restore-slow 不设 __mochiDataReady，修"没加载完就进入数据不全"）', file: 'js/idb.js', needle: 'mochi-restore-slow' },
  { name: '开屏「仍要进入」逃生口（splash-force-enter，数据超时未就绪时显示，进入提示数据可能不全）', file: 'js/clock.js', needle: 'splash-force-enter' },
  { name: '导出兜底读 memoryCache（idbGetCached，Safari IDB 挂起时导出朋友圈/聊天记录权威值不丢）', file: 'js/idb.js', needle: 'idbGetCached' },
  { name: '#118 邀请TA .ti-type 固定 92px 同行 ta-ask（添加表单 1 行排版，修 select 独占一行 + input 换行的 2 行「变形」布局）', file: 'css/chat-pages.css', needle: '.ti-type { flex:0 0 auto; width:92px' },
  { name: '#118 邀请TA .tc-input.ce-box 合成层保护（will-change:transform，搜索/批量导入/邀请话术输入 全 tc-input 输入框防「字出界」，小米15Pro Chrome 既往实测复现族）', file: 'css/chat-pages.css', needle: '.tc-input.ce-box { will-change: transform' },
  { name: '#118 邀请TA 编辑按钮 ✎（class="ta-edit" data-idx，修「打错了无法修改」只能删+重加）', file: 'js/ta-invite.js', needle: 'class="ta-edit" data-idx' },
  { name: '#118 邀请TA 批量管理 tiBatchMode（toggle + 行内 batch checkbox + 底部 ti-batch-bar 全选/删除/取消，修「打多了无法批量处理」只能逐条 ✕）', file: 'js/ta-invite.js', needle: 'tiBatchMode' },
  { name: '#131 邀请TA 输入栏合成层字出界缓解 _reflowInviteCeBoxes（监听 vv/window resize 刷新 .ta-add .ce-box 合成层，修小米15Pro Chrome 文字显示在框外，同 ta-ask.js _reflowAskCeBoxes）', file: 'js/ta-invite.js', needle: "pg.querySelectorAll('.ta-add .ce-box')" },
  { name: '#132 邀请TA 批量移动到分组 ti-batch-move（选中多条一键改 grp 字段到目标分组/未分组，修「打多了只能逐条移动」）', file: 'js/ta-invite.js', needle: 'id="ti-batch-move"' },
  { name: '#118 ce-ghost 类别名泄露 fix（先 origClass 再 add，避免可见 ce-box div 继承 ce-ghost 类别名）', file: 'js/mobile-adapt.js', needle: "'ce-box ' + origClass" },
  { name: '#119 桌面美化·内置方案库 BUILTIN_SCHEMES（5 套只读方案置顶，不污染用户方案）', file: 'js/personalize.js', needle: 'const BUILTIN_SCHEMES = [' },
  { name: '#119 桌面美化·深色三档 sysPrefersDark（light/dark/auto 跟随 prefers-color-scheme）', file: 'js/personalize.js', needle: 'const sysPrefersDark = () => !!(window.matchMedia' },
  { name: '#119 桌面美化·壁纸缩略图面板 openBgPanel（2×4 渐变色卡 + 纯色色卡 + 取色器，替换原文字 pill）', file: 'js/personalize.js', needle: 'const openBgPanel = () =>' },
  { name: '#119 桌面美化·壁纸定位/缩放 bgPosOf（phone-bg-pos-x/y/size 三键，默认 cover+center 旧数据兼容）', file: 'js/personalize.js', needle: 'const bgPosOf = () =>' },
  { name: '#119 桌面美化·撤销栈 pushBeautyUndo（beauty-undo-stack 最近 10 次，批量操作前压栈）', file: 'js/personalize.js', needle: 'const pushBeautyUndo = () =>' },
  { name: '#119 桌面美化·边看边调抽屉 openBeautyDrawer（切桌面页 + 右侧浮层实时改 CSS 变量；#769 起带可选 secKey 直达指定分区）', file: 'js/personalize.js', needle: 'const openBeautyDrawer = (secKey) => {' },
  { name: '#119 桌面美化·方案分享 URL shareBeautyLink（base64 hash URL，启动读 #beauty= 自动弹导入）', file: 'js/personalize.js', needle: 'const shareBeautyLink = () =>' },
  { name: '#602 方案分享链接接收端去掉前缀偏移（#beauty= 共 8 字符；原 slice(7) 把 base64 切成 =xxx 致 atob 抛错被吞、对方打开不弹导入）', file: 'js/personalize.js', needle: 'location.hash.slice(8)' },
  { name: '#602b 分享链接处理包进独立函数（原 return 穿透 outer IIFE，用途不符/命中 0 项时跳过其后所有初始化）', file: 'js/personalize.js', needle: '(function handleSharedBeauty() {' },
  { name: '#602h 分享链接复制回退 copyFrom（execCommand 优先 + 超时兜底；失败弹窗展示链接本体，修原 noInput 隐藏 input 导致「请手动复制」却看不到链接）', file: 'js/personalize.js', needle: 'const copyFrom = (text) =>' },
  { name: '#602i 分享链接生成拦截非 http(s)（file:// 本地打开时 origin=null，不再生成打不开的坏链接）', file: 'js/personalize.js', needle: '!/^https?:$/.test(location.protocol)' },
  { name: '#602j 分享链接接收端损坏/截断不再静默（明确弹「无法读取」并引导导出文件）', file: 'js/personalize.js', needle: '这条分享链接不完整或已损坏' },
  { name: '#602k 导入提示延迟到开屏收起且无其它弹窗时再弹（openModal 唯一，避被首启引导/备份提醒顶掉）', file: 'js/personalize.js', needle: 'let quietMs = 0;' },
  { name: '#602l 分享链接硬上限收到 16000（远离易被聊天软件截断的区间）', file: 'js/personalize.js', needle: 'const SHARE_URL_MAX = 16000;' },
  { name: '#602c 分享链接不带主题（生成端剔除 __theme__，不改对方深/浅色）', file: 'js/personalize.js', needle: "if (k === '__theme__') return;" },
  { name: '#602d 分享链接剔除图片组件清单 desk-images（防对方导入后得到空壳组件）', file: 'js/personalize.js', needle: "k === 'desk-images' || bigImg" },
  { name: '#602e 导入分享链接时丢弃主题（旧/手改链接带 __theme__ 也不应用）', file: 'js/personalize.js', needle: "delete data['__theme__'];" },
  { name: '#602f 功能介绍页写明分享链接范围（不含图片、不改深色模式）', file: 'template.html', needle: '分享当前美化链接：生成链接发给对方，打开自动弹导入，一键同步配色' },
  { name: '#602g 功能大全「分享当前美化链接」说明写明范围', file: 'js/feature-hub.js', needle: '不含图片、不改对方深色模式' },
  { name: '#119 桌面美化·完整外观方案 openFullBeautySchemes（桌面+聊天美化合并保存/应用）', file: 'js/personalize.js', needle: 'const openFullBeautySchemes = () =>' },
  { name: '#119 桌面美化·跨域暴露 collectChatBeauty（chat-settings.js 暴露给 personalize.js 合并方案使用）', file: 'js/chat-settings.js', needle: 'window.collectChatBeauty = collectChatBeauty' },
  { name: '#120 导出侧 IDB 读取失败重试 3 次（iOS Safari 事务挂起/超时高发，间隔 200ms 给连接恢复机会）', file: 'js/data-backup.js', needle: 'for (let retry = 0; retry < 3 && (v === undefined || v === null); retry++)' },
  { name: '#121 通话进行中标记双写 localStorage（sessionStorage 在关标签/Safari/PWA 重开后清空，「刷新后恢复通话」失效，iPad Air 7 Safari 实测）', file: 'js/call.js', needle: "localStorage.setItem(CALL_ACTIVE_KEY, payload)" },
  { name: '#121 通话恢复 localStorage 兜底（sessionStorage 空时读 LS，10 分钟新鲜度窗防翻旧账）', file: 'js/call.js', needle: 'localStorage.getItem(CALL_ACTIVE_KEY)' },
  { name: '#121 通话进行中标记心跳（每 20 秒刷 ts，恢复兜底判定新鲜度的依据）', file: 'js/call.js', needle: 'if (++hbCount >= 20) { hbCount = 0; saveCallActive(); }' },
  { name: '#121 call-active 进 migrateLegacy 排除清单（全局根键不被当旧顶层键迁进 default 并删根键，否则 LS 兜底副本每次启动被搬走）', file: 'js/contacts.js', needle: "'call-active'," },
  { name: '应用锁功能本体（applock.js 数字密码锁+安全问题重置，删除即隐私锁失效）', file: 'js/applock.js', needle: 'window.__applockReady' },
  { name: '应用锁/开屏问答门根键进 migrateLegacy 排除清单（applock-* 全局根键不被迁进 default 并删根键，否则锁设置每次刷新被搬走=锁失效）', file: 'js/contacts.js', needle: "'applock-qa-en', 'applock-qalist', 'applock-qaskip'," },
  { name: '应用锁设置页开关行（template.html #applock-en，防并行会话把设置入口改丢）', file: 'template.html', needle: 'id="applock-en"' },
  { name: '开屏问答门（applock.js 问答题门禁，防并行会话删除——隐私门即失效）', file: 'js/applock.js', needle: 'applock-qaskip' },
  { name: '开屏问答门设置行（template.html #applock-qa-en，防并行会话把入口改丢）', file: 'template.html', needle: 'id="applock-qa-en"' },
  { name: '#319 cardlock-state 进 migrateLegacy 排除清单（解锁状态全局根键不被迁进 default 并删根键，否则输对密码刷新后闸门仍全锁）', file: 'js/contacts.js', needle: "'cardlock-state'," },
  { name: '#319 card-lock 存量自愈（被误迁进 default 的解锁状态启动时搬回根键，老用户不用重输密码）', file: 'js/card-lock.js', needle: "localStorage.getItem('xy-home-v2:default:cardlock-state')" },
  { name: '#389 cardlock 解锁状态走 xyStore（写日志+IDB+每键标记+自愈链，修 Edge/荣耀杀进程回滚 localStorage 解锁态退回 locked→密码框重弹，多机型同因零机型分支）', file: 'js/card-lock.js', needle: "addEventListener('mochi-wrj-heal'" },
  { name: '#389 开屏锁卡监听解锁状态事件重渲染（自愈晚到不再显示「输入密码解锁」假象）', file: 'js/clock.js', needle: "addEventListener('mochi-cardlock-open'" },
  { name: '#118 默认字卡三场景使用概率 overallFor（dc-overall-<chat/mail/feed> 未设置回退 dc-overall）', file: 'js/default-cards.js', needle: 'overallFor: gOS' },
  { name: '#118 默认字卡抽卡按场景读概率/开关 drawCards(a, scene, st)（#518 起第三参透传成员桌面给 dcpAll；删掉场景/桌面参数化即回归）', file: 'js/default-cards.js', needle: 'function drawCards(a, scene, st)' },
  { name: '#118 写信混入默认字卡读写信场景概率（overallFor mail）', file: 'js/mail.js', needle: 'dcfg.overallFor' },
  { name: '#118 朋友圈默认字卡补池按 dc-overall-feed 概率（未设置=100 维持始终混入）', file: 'js/feed.js', needle: 'dc-overall-feed' },
  { name: '#120 导出侧全部丢失键记录降级（原只 chat-msgs/feed-posts，cc-groups 等静默跳过致导入后彻底丢失）', file: 'js/data-backup.js', needle: 'const nameOf = function (k)' },
  { name: '#120 导出侧丢失键友好名字 nameOf（cc-groups/quote-cards/fav-msgs/avatar-*/music-file/reply-*/ta-* 等）', file: 'js/data-backup.js', needle: 'TA回复字卡(' },
  { name: '#120 导入侧保留备份未含的旧键防 clear 致丢（idbReplaceAll 前列出当前 IDB 键，备份没有的读出值加入 pairs）', file: 'js/data-backup.js', needle: '已保留备份未含的' },
  { name: '导出权威键强制读 IDB（isAuthorityKey，chat-msgs/feed-posts 不因 LS 有损小快照跳过 IDB 权威，修跨浏览器导入丢数据）', file: 'js/data-backup.js', needle: 'isAuthorityKey' },
  { name: '导入 chat-msgs 无 IDB 权威时 LS 快照写 IDB 兜底（chatFallback，不再无条件跳过导致彻底丢失）', file: 'js/data-backup.js', needle: 'chatFallback' },
  { name: '副本消费方已全部移除（absent 守卫：花园不再整包 JSON.parse 自动备份副本，防数百 MB 遗留快照 OOM）', file: 'js/garden.js', needle: 'offerSnapshotRecover', absent: true },
  { name: '聊天更多功能固定每行4个（.more-grid 改 4 列 grid + justify-items 居中，修不同屏宽 flex 换行每行 3~4 个不一）', file: 'css/chat-main.css', needle: 'grid-template-columns:repeat(4, 1fr); gap:14px; justify-items:center' },
  { name: '#88 启动按 IndexedDB 权威值校正当前桌面（correctCidFromIdb，修小米14U Edge LS 失效时「聊天记录几小时自己消失」＝桌面静默切回 default）', file: 'js/contacts.js', needle: 'correctCidFromIdb' },
  { name: '#88 migrateLegacy 判空改走 regStore（裸 localStorage 在 LS 失效机上恒空 → 每启动把真值改回 default，抵消上面的校正）', file: 'js/contacts.js', needle: "if (!regStore().get('active-contact'))" },
  { name: '#88 后台保活/通知开关回填后重应用（reheatBgSwitches，修 LS 启动读到空值导致「后台通知有时候自己关闭」）', file: 'js/bg-keep.js', needle: 'reheatBgSwitches' },
  { name: '#88 未读到权威值时不整包覆盖 chat-msgs（authOk 闸门 + pendingLocal 暂存，防读超时后一条新消息抹掉全部历史）', file: 'js/chat.js', needle: 'const authOk = chatDbReady && authLoadedPrefix === window.activePrefix();' },
  { name: '#88 诊断补整域 localStorage 占用与写探针结论（区分同 origin 其他站点占满配额 vs 本库损坏）', file: 'js/device.js', needle: 'localStorage 整域=' },
  { name: '#88 LS 失效自检并当场告知（__lsStatus + 自带 #cc-toast 提示「已改用数据库存储，数据不会丢」，不依赖 window.toast——产物里从未赋值）', file: 'js/device.js', needle: '本机浏览器本地存储受限' },
  { name: '#89 安卓收键盘卡顿修复（_aClosing 收起态：跳过逐帧 _aPinPan 强制 reflow + _aRefreshCe ce-box reflow，修红米/小米 Chrome 手动收起键盘那一刻卡顿）', file: 'js/mobile-adapt.js', needle: '_aClosing' },
  { name: '#90 IDB 严格三态清单/存在性探测（idbListKeys/idbHasKey：超时与「空库」彻底分开，[] 不再冒充「库里没有」）', file: 'js/idb.js', needle: 'window.idbHasKey = function' },
  { name: '#90 条数账本不进 #40 写日志（chat-meta 排除，防 LS 回滚把过期条数账本补回来误导守卫）', file: 'js/idb.js', needle: '/:chat-meta$/.test(key)' },
  { name: '#90 聊天记录条数账本 + 缩水守卫（chatLedgerGuard：可疑缩水时 IDB 与 LS 快照都不写 + 暂存 pendingLocal + 强制重读合并）', file: 'js/chat.js', needle: 'chatLedgerGuard' },
  { name: '#90 只有确认「库里没有」(has===false) 才新建单条数组（loadMsgs 与两条跨桌面追加路径，修后台通知回来一条消息覆盖整桌面历史）', file: 'js/chat.js', needle: 'return has === false;' },
  { name: '#90 读到有值却解析失败时绝不整包写回（readOk 闸门，防把读不懂的历史当成空数组覆盖）', file: 'js/chat.js', needle: 'if (!readOk) return;' },
  { name: '#90 写 active-contact=default 前先向 IDB 确认库里没有 + 校正逻辑抽函数支持直读 IDB（applyCidCorrection）', file: 'js/contacts.js', needle: 'applyCidCorrection' },
  { name: '#90 导出前清单没读到一律中止（idbListKeys 三态，绝不出具「全部数据完整」的近空备份）', file: 'js/data-backup.js', needle: '导出未完成' },
  { name: '#103 导出流式打包防 OOM 崩溃（jsonToBlobStreaming 逐键序列化边拼边合并 Blob + blobToBase64 分块转换，修 OPPO Find X9 Chrome 大备份导出闪退/导不出来）', file: 'js/data-backup.js', needle: 'jsonToBlobStreaming' },
  { name: '#90 诊断新增「桌面归属体检」（三层 active-contact 并列 + 各桌面条数账本，区分记录被覆盖 vs 切错桌面）', file: 'js/device.js', needle: '桌面归属体检' },
  { name: '#91 预设/功能/查岗字卡列表改真虚拟窗口（flat+高度前缀和+视口±0.8 屏窗口+.cc-vspace 占位撑高，修 iPhone 15 Plus 进字卡库能滑但点返回卡死、卡回去后整页持续卡＝单分类整包铺进 3.3 万节点）', file: 'js/default-cards.js', needle: 'const V_PAD = 0.8' },
  { name: '#91 滚动容器动态判定（clipsContent 启发 + capture 阶段 scroll 事件锁定 e.target，兼容 dc 页由 page 滚 / fc 列表自滚 / 窗口滚三种形态，防窗口永不推进）', file: 'js/default-cards.js', needle: 'function clipsContent(' },
  { name: '#91 占位块样式在位（顶/底 .cc-vspace 撑回全高，滚动条长度与旧版一致＝全量行仍可达）', file: 'css/chat-pages.css', needle: 'cc-vspace' },
  { name: '#91 返回字卡库不再重复 JSON.parse 大库（refreshLibCounts force 分支走带缓存 pubGroupsRaw，多 MB 公用库每次返回解析两遍）', file: 'js/chatcard.js', needle: 'countOf(pubGroupsRaw())' },
  { name: '#92 字卡库离页/切作用域/切桌面冲刷（flushCcSave：200KB 大键只走异步 IDB + 120ms 防抖，刷新重进即丢公用/专享表情包上传，华为 P50E Edge 反馈）', file: 'js/chatcard.js', needle: 'function flushCcSave' },
  { name: '#92 切桌面先冲刷字卡库（setActiveContact 在 __activeCid 变更前 ccFlushSave，防 A 桌面待写 120ms 防抖写进 B 桌面键）', file: 'js/contacts.js', needle: "if (window.ccFlushSave) window.ccFlushSave()" },
  { name: '#93 回信后切到「收到的信」tab（submitReply 原 showPage 不 selectMailTab，停在旧 tab 看不到刚回信的来信，红米 K80 Chrome 反馈）', file: 'js/mail.js', needle: "selectMailTab('in');" },
  { name: '开屏进入门控补页面加载完成（window load 前「点击进入/仍要进入」都不放行，修 GitHub Pages 冷启动"网页还没加载完就能进、进去数据不全"）', file: 'js/clock.js', needle: '正在加载页面…' },
  { name: '#98 TA提问即进提问记录（pushAsk 发卡同步写 pending history + askTs 关联键透传，修"聊天有提问但主页提问记录空"）', file: 'js/ta-ask.js', needle: "status: 'pending'" },
  { name: '#98 chatAskReply 包装层统一写 ta-ask.history（覆盖文字题+单选题点选项两条回答路径，排除 deskCk 查岗卡）', file: 'js/ta-ask.js', needle: '__taAskReplyWrapped' },
  { name: '#98 提问记录待回答标签样式（.tc-li-pending 橙黄标签，TA已提问未回答时显示）', file: 'css/chat-pages.css', needle: 'tc-li-pending' },
  { name: '#101 askTs 关联键透传进 chat-msgs（chatAddSystem 白名单补 askTs，修 pending 永不关联→幽灵待回答+重复记录）', file: 'js/chat.js', needle: 'askTs: opts.askTs' },
  { name: '#101 提问记录跨桌面汇总（allDeskHistories，修联系人桌面答过题切回主页提问记录看不到）', file: 'js/ta-ask.js', needle: 'allDeskHistories' },

  { name: '#86 遗留副本清理墙钟兜底 + 幂等（restore 整轮挂起、mochi-restore-done 永不到达时 20s 后仍清理；purgeOnce 保证 #90 的重试链只起一套）', file: 'js/data-backup.js', needle: 'function purgeOnce()' },
  { name: '#86 LS 大键迁移排除已下线副本键（不把几百 MB 遗留副本整包读进内存/写回 IDB/常驻 memoryCache，防清理后被复活）', file: 'js/idb.js', needle: "if (k === 'xy-home-v2:__auto-backup-snapshot') continue;" },
  { name: '#101 查看存储明细只列最大 5 项 + 占比条 + 百分比（其余折进「其他 N 项合计」，回归成流水账即报警）', file: 'js/personalize.js', needle: 'function pctOf(size, total)' },
  { name: '#101 展开区存储键名按桌面名显示（cid 命名空间换成联系人/桌面名，用户读得懂「谁的聊天记录」）', file: 'js/personalize.js', needle: 'function labelKey(k, names)' },
  { name: '#101 查看存储 IDB 键清单走 #90 严格三态（读不到不再退化成 [] 显示成「0 键」，也不再把「库里没有」冒充「读不到」）', file: 'js/personalize.js', needle: 'window.idbListKeys || window.idbGetAllKeys' },
  { name: '#101 总占用双口径分行「本项目占用合计」vs「浏览器整域已用」（防用户把同域名整域占用当成本应用数据/以为统计漏了）', file: 'index.html', needle: '本项目占用合计' },
  { name: '#101 占比条样式已接入产物（setting.css 的 .storage-cat-bar，漏接入 cssFiles 或样式被删即报警）', file: 'css/setting.css', needle: '.storage-cat-bar i { display:block' },
  { name: 'iOS 真全屏聊天顶部栏收紧贴顶（苹果17 自带浏览器+全屏模式顶部一大块空白：.fs-active 的 max(env,12px) 在 iOS 系统状态栏常驻下算多余白带，用 ios-native-fs 压平；删掉规则/漏接入 cssFiles 即报警）', file: 'css/base.css', needle: 'html.ios-native-fs .phone .page.full .chat-head' },
  { name: 'iOS 原生全屏标记类同步（fullscreen.js syncFsClass 给根元素加 ios-native-fs，与之配套的 base.css 收紧规则靠它命中，标记删了修复就哑）', file: 'js/fullscreen.js', needle: "classList.toggle('ios-native-fs', _fs)" },
  { name: '#889 全屏开关 iOS 文案只在 iOS 生效（relabelIosToggle 曾被无条件调用，安卓也被换成 iOS 文案误以为用不了；isIOS 门被删即回归）', file: 'js/fullscreen.js', needle: 'if (isIOS) { try { relabelIosToggle(); } catch (e) {} }' },

  { name: '#95 朋友圈图片格宽统一：单图/双图容器特判已删除（原 .feed-imgs:has(...) 使 1/2/3+ 图格宽 22%/40%/33% 不一致，加回即回归）', file: 'css/chat-pages.css', needle: 'feed-imgs:has(', absent: true },
  { name: '#95 朋友圈图片格宽统一：单图放弃 1:1 裁切的 aspect-ratio:auto 特例已删除（加回则单图随原图比例自由变高）', file: 'css/chat-pages.css', needle: 'feed-imgs img:only-of-type', absent: true },
  { name: '#96 网易云外链播放区分 play() reject 错误类型（非 NotAllowedError 走外链兜底，不再一律弹"被浏览器拦截"）', file: 'js/music-player.js', needle: "err.name !== 'NotAllowedError'" },
  { name: '#96 meting 直链解析校验 302/音频响应（VIP/失效歌 200 空正文不再当直链原样回投重播坏 URL）', file: 'js/music-player.js', needle: "r.redirected || /^audio\\//i.test(ct)" },
  { name: '#96 已死 corsproxy.io(401 强制 API key) 代理已从网易云 API 源列表移除（留着只刷「网络失败 401」日志，vivo Y35+Edge 诊断实证）', file: 'js/music-player.js', needle: 'https://corsproxy.io/?url=', absent: true },
  { name: '#96 播放拒绝按错误类型区分提示文案（源加载失败不再谎报"被浏览器拦截"）', file: 'js/music-player.js', needle: '在线歌曲加载失败' },
  { name: '#99 TA收藏改存歌曲快照（纯 ID 方案删歌后记录隐形；用户要求删歌后联系人收藏记录依旧保留）', file: 'js/music-player.js', needle: 'function taFavList()' },
  { name: '#108 清理会员歌曲——#254 升级取代：代理 5xx 重试链路已整体移除（proxy.cors.sh DNS 已注销+allorigins 522，重试救不回死域名），改 meting 播放同源逐首探测（记账判据锚，删掉探测语义则该哨兵消失；#108 原修复「不误删/如实报失败」语义由 #254 完整继承）', file: 'js/music-player.js', needle: 'done(playable ? 0 : 1); // 0=免费可播；1=不可播（会员/付费/失效）' },
  { name: '#99 TA收藏列表已删歌曲标识样式（置灰 + 已删除小标签）', file: 'css/chat-pages.css', needle: 'ta-fav-gone' },
  { name: '联系人主动消息爱心标识已去灰色阴影（.msg-hi-heart 双层 drop-shadow 已删，加回即回归）', file: 'css/chat-main.css', needle: 'drop-shadow(0 1px 1px rgba(0,0,0,.22))', absent: true },
  { name: '#100 诊断启动异常采集前置（window.__jsErrors 此前全项目无人初始化，build 兜底 if(window.__jsErrors) 恒 false＝功能文件启动异常静默丢弃）', file: 'js/device.js', needle: 'window.__jsErrors = window.__jsErrors || []; } catch (e0) {}' },
  { name: '#854a OPPO/HeyTap 自带浏览器进 brokenFileShare（主链路跳分享面板；收窄＝OPPO A96 实报导出必闪退回归）', file: 'js/device.js', needle: 'brokenFileShare: /huaweibrowser|quark|heytapbrowser/i.test(_envUa),' },
  { name: '#854b 分享面板闪退内核单列标志 shareSheetCrash（换路按钮据此跳分享；删＝OPPO 换路点一次崩一次）', file: 'js/device.js', needle: 'shareSheetCrash: /heytapbrowser/i.test(_envUa),' },
  { name: '#854c altSaveFile 换路在闪退内核跳过分享面板（删＝「换一种方式」按钮把 OPPO 用户再次带进闪退）', file: 'js/data-backup.js', needle: 'if (!shareCrash && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {' },
  { name: '#100 诊断软/硬双预算首屏标注（原 3s 单保险丝把 IDB 慢机的「最近错误/开关持久化体检/桌面归属体检/IDB 大键明细」整批截成裸「读取中…」，2026-08-30 iPhone 16 Pro 真机诊断实证）', file: 'js/device.js', needle: '未读到（本机存储响应慢，稍后自动补全）' },
  { name: '#100 诊断终态回填直写可见 #modal-textarea + 弹窗判活（ctl.text 的 setter 只写 hidden 的 #modal-input，回填曾静默失效；全站弹窗共用 DOM，关窗后迟到回填会灌进别的弹窗）', file: 'js/device.js', needle: 'if (!modalAlive()) { closed = true; return; }' },
  { name: '#100 诊断角标按最后一条错误时间戳判未读（原存条数，环形写满后新错误永远算不出未读＝角标常暗、错误线索看不见）', file: 'js/device.js', needle: 'const seen = Number(localStorage.getItem(SEEN_KEY)) || 0;' },
  { name: '#100 最近错误环形上限 5→20 且调用栈只给最近 3 条（5 条窗口用户报障时早已刷掉；全带栈会把报障文本撑到剪贴板截断）', file: 'js/device.js', needle: 'const ERR_CAP = 20;' },
  { name: '红米K80 切后台无法自动播下一首回归修复（后台非 NotAllowedError 拒绝不再烧一次性 https 重试链，恢复 scheduleBgResume 退避补播，源短暂恢复即接上）', file: 'js/music-player.js', needle: 'if (document.hidden) {\nbgBrokeAudio = true;\nplayRejected = true;\nscheduleBgResume();' },
  { name: '群聊里用【帮我决定/多人决定】结果发到群聊（gcSendDecisionText 系统消息入群聊消息流 + 群聊更多面板点这两项不切聊天页，修结果错发到聊天）', file: 'js/group-chat.js', needle: 'gcSendDecisionText' },
  { name: '#421b 帮我决定入口顶置早绑定（decision.js 顶部先挂分派器 window.openDecision，真实实现 359 行回填 decisionPanelRef——防模块中途任一 init 抛错导致 openDecision 永不绑=按钮「帮我决定加载失败」，用户跨机型反复上报；改回整体覆盖或删分派器即报警）', file: 'js/decision.js', needle: 'decisionPanelRef = openPanel;' },
  { name: '#421b 多人决定入口顶置早绑定（group-decision.js 顶部先挂分派器 window.openGroupDecision，真实实现回填 groupDecisionPanelRef——同上，防「多人决定加载失败」跨机型复发）', file: 'js/group-decision.js', needle: 'groupDecisionPanelRef = openPanel;' },
  { name: '#104 导出打包器按片段写 Blob + 值内逐元素下钻（单片段恒 ≤1M 字符，不再为单个大键整串分配；回归成整包 stringify 则 vivo X200s 806MB 设备 Invalid string length 复发）', file: 'js/data-backup.js', needle: 'createJsonPack' },
  { name: '#104 导出体积预估改廉价浅判（旧 byteLen 为量一个键的长度把整包 stringify 一遍＝再复制一份大键，是 OOM 的隐藏来源）', file: 'js/data-backup.js', needle: 'function overSmallLimit(v, limit)' },
  { name: '#104 导出异常边界收遮罩并如实报环节/键名/体积（旧实现裸调用 → RangeError 变未处理 promise rejection → impHide 永不执行 = 用户报的「一直在打包中」）', file: 'js/data-backup.js', needle: 'reportExportError' },
  { name: '#104 大库导出前选备份范围（完整/不含音乐/只备份文字，navigator.storage.estimate 超 150MB 才弹；小库不打扰）', file: 'js/data-backup.js', needle: 'askExportMode' },
  { name: '#104 导入读大文件按错误类型给文案（不再把「本机读不动这么大的一份」谎报成「无效的数据文件」）', file: 'js/data-backup.js', needle: '这份备份太大，本机读不进去' },
  { name: '安卓 Chrome 强制深色遮蔽网页配色修复：:root 显式声明 color-scheme:light（深色由 data-theme 手动管；缺失时系统深色下 Chrome Auto Dark 无视网页配色把群聊气泡/字体全网压成纯黑，iQOO Neo10 反馈）——#252 升级 only light（裸 light 是偏好声明不是退出开关，部分安卓 Chromium/WebView 系统深色下仍压黑）', file: 'css/base.css', needle: 'color-scheme:only light' },
  { name: '#252 深色三档启动落位含 auto 档+浅色强制清残留（头部脚本旧版只认 dark：auto 用户系统深色下白闪 FOUC；残留 data-theme 令浅色档界面停留深色）', file: 'template.html', needle: "if(_tm==='dark'||(_tm!=='light'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark');else document.documentElement.removeAttribute('data-theme')" },
  { name: '#252 applyThemeMode 浅色档显式 removeAttribute（属性在=dark.css 全量生效，双保险防残留；needle 按产物压缩后的无缩进换行形态登记）', file: 'js/personalize.js', needle: "if (eff === 'dark') document.documentElement.setAttribute('data-theme', 'dark');\nelse document.documentElement.removeAttribute('data-theme');" },
  { name: '#258 深色覆盖展平为完整前缀选择器（dark.css 禁用 CSS 原生嵌套：嵌套需 Chromium 112+/iOS 16.5+，老内核丢嵌套规则=浅色白底扁平规则独存+文字变量翻白=白卡白字看不见，用户报「深色下拍一拍字卡全是白的」；展平语义等价，回退成嵌套即断）', file: 'css/dark.css', needle: '[data-theme="dark"] #poke-list .cc-item' },
  { name: '#104 导出入口不再裸调用 doExport（absent 守卫：出现无 await/无 catch 的 doExport(); 即回归——遮罩永不隐藏的直接根因）', file: 'js/data-backup.js', needle: 'doExport();', absent: true },
  { name: '#105 钓鱼「留」标记按归属存（keepKey(side,id)，回归成品种级开关时同品种两侧互相牵连——用户报「只想留 TA 的」做不到）', file: 'js/fishing.js', needle: 'function keepKey(side, id)' },
  { name: '#105 出售按归属跳过未留项（旧写法 keep[id] 会把另一侧同品种的鱼一起跳过不卖）', file: 'js/fishing.js', needle: 'if (keep[keepKey(side, id)]) return;' },
  { name: '#105 旧纯品种 keep 键自愈展开到两侧（键不含 : 即旧数据，等价原「同品种两侧都不卖」语义，用户零感知）', file: 'js/fishing.js', needle: "keep[keepKey('mine', k)] = 1" },
  { name: '#105 复选框按行归属写标记（data-side 决定改哪一侧的留标记，回归成共用键时两栏互相勾上）', file: 'js/fishing.js', needle: "keepKey(cb.getAttribute('data-side')" },
  { name: '#105 出售后清掉该侧已无存货的残留留标记（否则同品种当天再钓到会被上次遗留标记自动置留）', file: 'js/fishing.js', needle: 'if (!t[side] || !t[side][id]) delete t.keep[k];' },
  { name: '#106 贪吃蛇布局高度预算补算 flex gap（原漏算 .snake-fs 的 gap:min(2vh,2vw)，360/384/390/412 宽空闲态即溢出 17～29px＝用户报「再来一局按钮显示不完全」）', file: 'js/snake-game.js', needle: 'availH -= (parseFloat(st.rowGap) || 0) * n;' },
  { name: '#106 贪吃蛇画布按滚动区实际溢出自查收小（量算总有几像素误差而全屏是裁切的，溢出 1px 就切掉按钮一截；删掉这段循环则误差重新变成点不到）', file: 'js/snake-game.js', needle: 'const over = sc.scrollHeight - sc.clientHeight;' },
  { name: '#106 贪吃蛇结算后重铺全屏画布（showResult 末尾调 refitAll；原实现只调 refitNonFs，全屏 isFs 直接早退＝地图不缩小，用户报「要缩小才能点到再来一局」）', file: 'js/snake-game.js', needle: "refitAll();     // 结算块+再来一局出现后收小画布：半框让方向键一屏可见，全屏防「再来一局」被裁到屏外" },
  { name: '#106 贪吃蛇全屏滚动区兜底可纵向滚（原 overflow:hidden，极矮/横屏格子触到 9px 下限仍放不下时按钮永久不可达）', file: 'css/chat-pages.css', needle: '#chat-snake-panel.snake-fs .poke-card-scroll { overflow:hidden auto;' },
  // ===== v3.26.x #221：贪吃蛇手机端操作性（多机型「不好操作」反馈）=====
  { name: '#221 贪吃蛇双槽输入队列（nextDir2 顶替入队：一个 tick 内连给两个转向不再互相覆盖=急转弯不吞输入；改回单槽赋值则挤掉先给的转向）', file: 'js/snake-game.js', needle: 'else { p.nextDir = p.nextDir2; p.nextDir2 = { x: x, y: y }; }' },
  { name: '#221 贪吃蛇 applyDir 每步只消费队列头一格（nextDir 生效后 nextDir2 顶上来；删掉顶替行则第二转向永远丢失）', file: 'js/snake-game.js', needle: 'if (q) { snake.nextDir = snake.nextDir2 || null; snake.nextDir2 = null; }' },
  { name: '#221 贪吃蛇滑动轴锁可解锁（另一轴偏移反超 1.5× 改锁并转向：L 形拖动不抬手即可转向；改回 if (!lockAxis) 粘性锁则 L 形拖动失效）', file: 'js/snake-game.js', needle: 'if (ady >= TH && ady > adx * 1.5) { lockAxis = \'v\'; dir = dy > 0 ? \'d\' : \'u\'; }' },
  { name: '#221 贪吃蛇方向键 pointerdown 即时转向（click 依赖 touchend 合成慢一拍且快速连点丢次；删掉 pointerdown 监听则回退 click 延迟）', file: 'js/snake-game.js', needle: "dpadEl.addEventListener('pointerdown', function (e) {" },
  { name: '#221 贪吃蛇方向键/按钮触控消除点击延迟（touch-action:manipulation 屏蔽双击缩放等待；删掉则方向键响应回退 ~300ms）', file: 'css/chat-pages.css', needle: 'touch-action:manipulation; transition:transform .08s, background .08s; }' },
  // ===== v3.26.x #115：聊天输入栏「打字不显示/空白」（红米 K60 至尊版 + Edge）=====
  { name: '#115 聊天输入栏常驻独立合成层（will-change，层在键盘平移开始前就存在；#chat-input/#gc-input 是模板原生 contenteditable、不经 ceConvert，拿不到 .ce-box 那套保护）', file: 'css/base.css', needle: '.phone .chat-input { will-change:transform; }' },
  { name: '#115 聊天输入栏聚焦再叠 translateZ（与治好「文字与框分离」的 .ta-add .ce-box 同款；键盘期 .phone 被 _aPanComp 平移+逐帧改高时文本画在旧合成层＝框内空白）', file: 'css/base.css', needle: '.phone .chat-input:focus { transform: translateZ(0); }' },
  { name: '#115 聚焦可编辑框内部滚动残留自愈（内容不超高而 scrollTop>0 即归零；修「字在 DOM 里却被自身滚动推出裁剪区＝看着空白」）', file: 'js/mobile-adapt.js', needle: 'function healEditableScroll(el) {' },
  { name: '#115 安卓键盘内部状态只读探针（诊断「键盘/锁残留」此前只读 iOS 探针，安卓永远 n/a）', file: 'js/mobile-adapt.js', needle: 'window.__mochiAndroidKb = function () {' },
  { name: '#115 诊断新增「聊天输入栏现场」实测行（聚焦/DOM 文本长/内部滚动/颜色 caret 合成层/待清守卫/是否被键盘盖——分案三种空白成因）', file: 'js/device.js', needle: '聊天输入栏现场：元素=' },
  { name: '#115 诊断输入轨迹环形缓冲（focus/composition 起止/input 最近 8 条，只记长度与滚动三值不记内容）', file: 'js/device.js', needle: 'xy-home-v2:__diag-inp' },
  { name: '#115 防复活守卫真实编辑闸门（三处守卫改判「本次清空后有无真实输入活动」，修重打同一条短句被静默吞字＝打字不显示）', file: 'js/chat.js', needle: 'function userEditedAfterClear()' },
  { name: '#115 input 监听命中相同文本时先放行真实编辑（只摘守卫标记不清框）', file: 'js/chat.js', needle: "if (userEditedAfterClear()) { input._mClearTxt = ''; return; }" },
  { name: '#115 真实输入活动跟踪（keydown/compositionstart/insert 类 beforeinput 捕获阶段刷新 lastUserEditAt，闸门判据来源）', file: 'js/chat.js', needle: "input.addEventListener('compositionstart', () => { lastUserEditAt = Date.now(); }, true);" },
  { name: 'v3.14 聚焦态清空走 execCommand 编辑管线终结组合会话（防输入法迟到写回；#115 补登哨兵，该块此前整块零保护）', file: 'js/chat.js', needle: "document.execCommand('selectAll', false, null)" },
  { name: '#116 工坊配方卡缺料反馈（需求行改「已有/需求」+ 缺料提示行 + 按钮常驻缺料置灰，修「工坊做不了花艺配方」无从知晓缺什么）', file: 'js/garden.js', needle: 'recipe-lack' },
  { name: '#122 TA的心情235张系统预设注册字卡库跨分类搜索（修「系统编码字卡搜不到」）', file: 'js/ta-mood.js', needle: "name: 'TA的心情'" },
  { name: '#122 聊天内置系统回应池（兜底/邀请婉拒/贴贴）注册字卡库跨分类搜索', file: 'js/chat.js', needle: "name: '聊天系统回应'" },
  { name: '#122 朋友圈内置互动回应池（TA评论/TA回应）注册字卡库跨分类搜索', file: 'js/feed.js', needle: "name: '朋友圈互动'" },
  { name: '#122 番茄钟陪伴模式内置话术池注册字卡库跨分类搜索', file: 'js/p2-features.js', needle: "name: '番茄钟陪伴'" },
  { name: '#122 群聊内置兜底回复池注册字卡库跨分类搜索', file: 'js/group-chat.js', needle: "name: '群聊系统回应'" },
  { name: '#123 大历史聊天懒加载（账本b字段门控 chatPrefetchIfLight，防低端机开屏/切桌预读 155MB 聊天包 OOM 崩溃，OPPO Find X9 Chrome 实测）', file: 'js/chat.js', needle: 'function chatPrefetchIfLight(load) {' },
  { name: '#123 大历史聊天懒加载·字节估算写账本（chatLedgerSave 的 b 字段，重启后不必读大键即可判断是否大包）', file: 'js/chat.js', needle: 'const chatLedgerBytes = {};' },
  { name: 'v3.30.x 公用/专属字卡分组停用开关（数据层 cc-groups-public-off/cc-groups-off，回复池 getScopedGroups/*For 全部过滤停用分组）', file: 'js/chatcard.js', needle: "const PUB_OFF_KEY = 'cc-groups-public-off';" },
  { name: 'v3.30.x 公用字卡分组停用键排除 migrateLegacy（cc-groups-public-off 全局根键不被迁进 default 桌面）', file: 'js/contacts.js', needle: "'cc-groups-public', 'cc-groups-public-off', 'cc-scope-migrated'," },
  { name: '跨桌面查岗/来电频率档位 desk-freq-mode 排除 migrateLegacy（漏排除→被当旧顶层键迁进 default 删根键，「标准」静默回退「安静」致两三天 0 触发）', file: 'js/contacts.js', needle: "'desk-call-en', 'desk-freq-mode'" },
  { name: '#231 完整外观方案/美化撤销栈/更新条记忆键排除 migrateLegacy（漏排除→每刷新被当旧顶层键迁 default 删根键：完整方案列表刷新清空=红米Note12T「保存后恢复初始」多机型同发、同版本更新条每刷新重弹；#527 起 beauty-undo-stack 写入端改 per-cid 但该键仍须留在 EXCLUDE——「自回收清单移除」由 verify-exclude-feed-schemes 的否定断言守住）', file: 'js/contacts.js', needle: "'full-beauty-schemes', 'beauty-undo-stack', 'ver-update-ack-ts', 'ver-update-notify'," },
  { name: '#233 __ 系统键兜底防迁移（__wr-journal 写日志自愈第一道防线/__ls-dirty/__big-idx 无冒号根键每刷新被迁 default 删根键=LS 回滚家族第四层削弱；删此规则即回归）', file: 'js/contacts.js', needle: "if (r.indexOf('__') === 0) return true;" },
  { name: '#233 default:__ 误迁系统键存量副本清扫（LS+IDB 同删，防 idbRestore 回填复活；删掉则死副本永占 LS 配额）', file: 'js/contacts.js', needle: "k.indexOf(G + ':default:__') === 0" },
  { name: '#232 朋友圈身份/封面六键改按桌面独立回收（DESK_KEYS 拆分；根键有值即删 default 副本的旧逻辑=朋友圈头像昵称每刷新回退，删此拆分即回归）', file: 'js/feed.js', needle: "const DESK_KEYS = ['feed-cover-bg', 'feed-ta-cover', 'feed-ta-name', 'feed-ta-avatar', 'feed-user-name', 'feed-user-avatar'];" },
  { name: '#232 收养旧全局值前三态确认（idbHasKey false 才收养——大值只在 IDB def.get 看不到≠不存在，删守卫会用旧全局值盖掉大头像/封面）', file: 'js/feed.js', needle: "window.idbHasKey('xy-home-v2:default:' + k)" },
  { name: '#234 诊断开关体检读取列键位修复（xyStore 前缀不带尾冒号；2026-09-11 复发修正：G 本身已带尾冒号，SP 必须=G+cid，首修的 G+\':\'+cid 仍是双冒号——改回任何额外冒号拼法即回归「读取」列恒缺失误导判读）', file: 'js/device.js', needle: 'window.xyStore(SP).get(short)' },
  { name: '#139 LS 大键残留清扫（读-比对-CAS 删 LS 副本：IDB 同值纯去重/落后先追平再删，恢复设置保存配额）', file: 'js/idb.js', needle: 'if (localStorage.getItem(k) === lsVal) localStorage.removeItem(k);' },
  { name: '#139 专属字卡库去重预检（__big-idx 尺寸+体检标记免读大值，稳态零开销）', file: 'js/chatcard.js', needle: 'marks[cid][0] === pubRaw.length && marks[cid][1] === ownLen' },
  { name: '#139 专属页导入全量备份防复制守卫（公用库兜底内容与合并结果相同不写专属键）', file: 'js/chatcard.js', needle: "if (fromPubFallback && ccScope === 'own') {" },
  { name: '#139 GIF 直存原图大小上限（超 3MB 跳过，防动图整份原图进库）', file: 'js/chatcard.js', needle: "String(reader.result || '').length > CC_GIF_MAX_B64" },
  { name: '#139 收藏图片压缩 CAS（压缩期间收藏被写则快照失效重排，绝不覆盖新数据）', file: 'js/chat.js', needle: 'if (rawNow !== rawSnap) {' },
  { name: '#142 媒体池查池命中不重写（写前批量探测，跨会话/桌面零重复落池）', file: 'js/media-pool.js', needle: 'writeBuf.push({ k: FULL + e[0], v: e[1].data }); dirty = true; }' },
  { name: '#142 媒体池键排除启动回填（media: 只存 IDB，防几百键吃回内存/LS）', file: 'js/idb.js', needle: "k.indexOf(uidPrefix + 'media:') !== 0 &&" },
  { name: '#142 聊天令牌化池先落盘再落引用（崩溃窗口最多池多孤儿，绝不令牌失据）', file: 'js/chat.js', needle: 'await window.mochiMediaFlush(); // 池数据先落盘，再让引用落盘（顺序不可反）' },
  { name: '#142 编辑消息入口令牌展开（图片消息 text 已令牌化，防令牌字符串进输入框被当文字保存）', file: 'js/chat.js', needle: 'const _origMedia = (window.mochiMediaExpand && window.mochiMediaExpand(orig)) || null;' },
  { name: '防骗+署名禁倒卖声明运行时回填·缺失重建置顶条（防倒卖：f7a8b5c首建/0965278移除后按用户需求恢复并扩展双条）', file: 'js/clock.js', needle: 'insertBefore(box, refNode || notice.firstChild)' },
  { name: '防骗+署名禁倒卖声明运行时回填·官方notice.json远程强刷（二传副本仍向官方域名拉权威文案）', file: 'js/clock.js', needle: "OFFICIAL_NOTICE, { cache: 'no-store' }" },
  { name: '防骗+署名禁倒卖声明运行时回填·置顶条在位判定（标题+全部特征词在位才跳过重建）', file: 'js/clock.js', needle: 'bar.marks.every' },
  { name: '#150 后台来电系统通知（bgNotifyCheck force 通道：一次性来电事件绕过 15s 过渡期/去重闸门）', file: 'js/bg-keep.js', needle: 'const force = !!extra.force;' },
  { name: '#150 后台命中来电不再放弃（maybeIncoming hidden 分支：写未接记录+系统消息+系统通知）', file: 'js/call.js', needle: 'if (document.hidden) {' },
  { name: '#150+#161 后台来电通知辅助（bgCallNotify：SW 链路弹「XX来电」，force+avFixed；#161 加 hint 尾缀；#204 加 avOverride 参数）', file: 'js/call.js', needle: 'function bgCallNotify(name, hint, avOverride) {' },
  { name: '#161 响铃挂起写入（holdIncomingCall：后台来电存 call-hold 全局根键+发可接听通知，不再即判未接）', file: 'js/call.js', needle: "bgCallNotify(name, '快回来接听，对方会等你几分钟', avOverride);" },
  { name: '#204 挂起接口暴露（callHoldIncoming：跨桌面来电后台命中同走响铃挂起）', file: 'js/call.js', needle: 'window.callHoldIncoming = holdIncomingCall;' },
  { name: '#204 跨桌面后台来电改走挂起（incoming-requests hidden 分支不再只发通知即丢弃）', file: 'js/incoming-requests.js', needle: 'if (window.callHoldIncoming) window.callHoldIncoming(name, req.cid, av);' },
  { name: '#161 挂起恢复（resumeHeldCall：回前台/冷启动有效挂起重响来电，超时补写未接）', file: 'js/call.js', needle: 'function resumeHeldCall() {' },
  { name: '#161 endCall 静默收尾通道（holdSilent 第二参：响铃挂起切后台只清 UI 不写未接）', file: 'js/call.js', needle: 'function endCall(text, holdSilent) {' },
  // ==== 2026-09-18 #722 接通的电话切后台回前台被记「未接」（vivo/Edge/iOS 多机型）：挂起孤儿三闸 ====
  { name: '#722a 挂起带写入运行期标识（跨运行期持久层幸存值不再保有「超时补未接」语义）', file: 'js/call.js', needle: 'sid: HOLD_SID' },
  { name: '#722b IDB 兜底挂起卡 3 分钟新鲜度（超窗孤儿＝墓碑 flush 被杀打断/iOS 清 LS 回填，只重写墓碑自愈、绝不补未接——接通电话回前台记未接的主根）', file: 'js/call.js', needle: 'if (Date.now() - ih.ts > CALL_HOLD_MS) { clearCallHold(); return; }' },
  { name: '#722c 补写未接双闸（同运行期挂起＋无活通话；通话在场补未接＝接了电话记未接的第二保险）', file: 'js/call.js', needle: "if (!crossRun && !currentCall) notifyCallEnd(h.cid || cur, heldMissedHtml(h.name || partnerName()), 'in', '未接听');" },
  { name: '#722d 消费侧把 sid 对照结果传给补未接判定（LS 路径跨运行期孤儿同走静默清）', file: 'js/call.js', needle: 'resumeProcessHold(h, h.sid !== HOLD_SID);' },
  { name: '#152 聊天「继续说」按钮防键盘收起吞 click（触摸 pointerdown 按下即触发+鼠标排除）', file: 'js/chat.js', needle: "csBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; csFireContinue(); });" },
  { name: '#152 群聊「继续说」按钮防键盘收起吞 click（同单聊 pointerdown+防重入）', file: 'js/group-chat.js', needle: "gcContinueBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; gcCsFireContinue(); });" },
  { name: '#153 后台冻结1分钟(Chromium139 stop-in-background)保活自愈·切后台音频暂停立即补播+最快档重试（防静默窗口跨冻结线整页冻结=后台消息/通知全停）', file: 'js/bg-keep.js', needle: "if (document.visibilityState !== 'hidden') return;" },
  { name: '#153 后台冻结1分钟(Chromium139)保活自愈·隐藏期补播退避封顶20s（前台60s不变，冻结线内保证2~3次重试机会）', file: 'js/bg-keep.js', needle: "if (document.visibilityState === 'hidden' && delayMs > 20000) delayMs = 20000;" },
  { name: '#190/#260 保活音频安卓幅度（0.006→0.02 恢复：#190/#207 底噪根因在 220Hz 频率已换 18kHz，0.0003 电平距 audible 线仅 20% 余量、Edge/Chromium 152 收紧判定即丢冻结豁免=vivo X200s「后台保活失败」；iOS 0.002 bit 级不动）', file: 'js/bg-keep.js', needle: 'kaIsIOS() ? 0.002 : 0.02' },
  { name: '防倒卖回填·远程时效公告bulletin在位判定（notice.json下发text+until过期自动摘除,所有联网副本含二传显示）', file: 'js/clock.js', needle: "(!bulletin.until || Date.now() < bulletin.until)" },
  { name: '防倒卖回填·公告内容变化重写（标题固定「公告」+text 精确比对）', file: 'js/clock.js', needle: "if (box.textContent !== '公告' + want)" },
  { name: '防倒卖第二锚点·pwa.js在位看门狗（clock.js回填被删时的独立兜底,5s补回缺失声明；#621 起两张声明合并为「免费·署名·防倒卖」一张，补回公告区最顶）', file: 'js/pwa.js', needle: "n.insertBefore(mkWatchBar('1', '免费 · 署名 · 防倒卖', W), n.firstChild)" },
  // ==== 2026-09-16 #613 防骗提醒卡提到开屏第 1 张 + 免费声明「本站完全免费…禁止以盈利为目的」并进防骗卡与必读摘要首条（用户：「这个要放在前面醒目的位置，现在太靠后了」「放在开屏的防骗提醒里吧」）====
  { name: '#613 防骗卡（第 1 张）正文新增免费声明加粗句在 template 静态 DOM（删则退回只有防骗账号文案，用户要求的免费声明在首屏消失）', file: 'template.html', needle: '个人出资和花费时间搭建的。开放二传二改但禁止以盈利为目的。</strong>' },
  { name: '#613/#620 免费声明进「必读摘要」并高亮（删则回落到折叠区/章节，用户原话「太靠后」重现；#620 口径改写后锚点同步）', file: 'template.html', needle: '<p class="splash-hl">本站完全免费，个人出资搭建' },
  { name: '#613 防骗卡重建锚点＝公告区最顶（改回免责卡/锁卡之后＝用户「防骗提醒位置太靠后」回归）', file: 'js/clock.js', needle: 'ensureBar(BARS[0], null)' },
  { name: '#621 pwa.js 看门狗补回合并声明卡也落到公告区最顶（与 clock.js/静态顺序一致）', file: 'js/pwa.js', needle: "mkWatchBar('1', '免费 · 署名 · 防倒卖', W), n.firstChild" },
  { name: '#613 在线公告源 notice.json alert 同含免费声明句（静态/远程双源一致，删则联网用户看到的防骗卡少这句）', file: 'pwa/notice.json', needle: '个人出资和花费时间搭建的。开放二传二改但禁止以盈利为目的。Mochi字卡网站完全免费。' },
  // ==== 2026-09-16 #621 防骗 + 署名禁倒卖合并为一张置顶声明卡（用户要求「并成一张」）====
  { name: '#621 合并声明卡标题（免费 · 署名 · 防倒卖，template 静态卡）', file: 'template.html', needle: '免费 · 署名 · 防倒卖' },
  { name: '#621 旧「转载署名·严禁倒卖」独立卡不得复活（已并入 tag 1；absent）', file: 'template.html', needle: 'data-anti-scam="2"', absent: true },
  { name: '#621 clock.js 合并卡按 keys 拼接正文（删＝正文退回只取单字段，署名段丢失）', file: 'js/clock.js', needle: 'function barText(bar) {' },
  { name: '#621 clock.js BARS 单卡双权威字段（keys alert+alert2；删＝署名段不回填）', file: 'js/clock.js', needle: "keys: ['alert', 'alert2']" },
  // ==== 2026-09-16 #620 开屏公告去重 + 口径统一（用户：公告重复多、作者决定月底解散）====
  { name: '#620a 开屏口径·互助群月底解散（notice 线上生效源）', file: 'pwa/notice.json', needle: '互助群月底解散' },
  { name: '#620b 开屏口径·群即将解散（template 离线兜底）', file: 'template.html', needle: '群即将解散：' },
  { name: '#620c 作者公告页不再重复「关于二级密码」卡（absent；已并入主公告）', file: 'template.html', needle: '>关于二级密码<', absent: true },
  { name: '#620d 作者公告页不再重复「关于二传和二改」卡（absent；已并入主公告）', file: 'template.html', needle: '>关于二传和二改<', absent: true },
  { name: '#154 朋友圈评论「我的表情包」与聊天面板同源·暴露chat最新内存副本（IDB权威自愈，修store层旧LS快照/大键挂起导致的两侧不同步）', file: 'js/chat.js', needle: 'window.getMyEmojiGroups = function () { return myGroups || []; };' },
  { name: '#154 朋友圈评论「我的表情包」优先读chat内存副本（chat.js异常时旧store读兜底）', file: 'js/feed.js', needle: 'if (window.getMyEmojiGroups) {' },
  { name: '#156 群聊模式占卜图标强制收隐藏池（任意位置都隐藏，修「群聊开启后桌面占卜图标不消失」——原只在首页图标组原位时才收；#393 起带 !divPin 豁免， needle 同步收窄）', file: 'js/personalize.js', needle: 'if (divBtn && divBtn.parentNode !== pool && !divPin) {' },
  { name: '#156 applyDeskLayout 末尾重应用群聊模式（防 bare 布局应用把占卜从隐藏池按 desk-layout 复活回桌面）', file: 'js/personalize.js', needle: 'try { applyGroupChatMode(); } catch (e) {}' },
  { name: '#157+#531 聊天getPool默认主字卡兜底门＝「自定义 text 池没有可读句子卡」（#157 修 dc-overall 概率形同虚设；#531 放宽自 !text.length，用户只加颜文字/符号卡时旧门不触发＝池里没有句子卡，联系人只反复发那几张符号）', file: 'js/chat.js', needle: "if (catOn('main') && !chatHasReadableTextCard(text)) {" },
  { name: '#157 群聊gcPool主字卡兜底语义对齐聊天页（同#157概率失效修复）', file: 'js/group-chat.js', needle: "if (catOn('main') && text.length === 0) {" },
  { name: '#157 经期温柔前缀/动作随默认字卡总开关停用（修总开关关闭后聊天仍偶发前缀/动作字卡）', file: 'js/period.js', needle: 'if (_dcfg.enabled === false) return text;' },
  // needle 随 #666 通话占用闸门更新：原锚点是分支条件行 `if (deskCallEn()) {`，该行已带上
  // callInProgress 占用判定（文字变了）；改锚到同一分支的概率掷骰行——它同样证明「跨桌面来电
  // 分支仍在、且不被 document.hidden 前台词门控地照常掷」，与 #677c 的条件行锚点互不共用。
  { name: '#159 跨桌面来电去掉前台门控（后台命中走 deliver hidden 分支发「XX来电」系统通知，修后台永不弹窗；逻辑锚=该分支的概率掷骰行仍无 document.hidden 前置）', file: 'js/incoming-requests.js', needle: "if (Date.now() - lastAt(cid, 'call') >= callCool * 60000 && Math.random() * 100 < callProb) {" },
  { name: '#159 跨桌面来电通知 force 通道（与 #150 同口径，绕过 15s 过渡期/去重闸门）', file: 'js/incoming-requests.js', needle: 'avFixed: true, force: true }' },
  { name: '#160 GIF 上传上限砍到 512KB base64（修 iOS 字卡库堆到 62.8MB 每次整库 stringify/parse 秒级长任务卡死；逻辑锚点是数值表达式，改回大上限即消失）', file: 'js/chatcard.js', needle: 'const CC_GIF_MAX_B64 = 512 * 1024;' },
  { name: '#162 贴底钉住态 chatPinnedBottom（程序化滚底置真/用户触摸滚轮解除，修 iPadOS 26 Safari 回消息视图上漂）', file: 'js/chat.js', needle: 'let chatPinnedBottom = true;' },
  { name: '#162 来消息侧滚底 rAF+150ms 复写（原只写一次 scrollTop 被 iPadOS 26 内核顶开；改平滑滚动后复写走 scrollChatBottomSmooth，逻辑锚句随行更新）', file: 'js/chat.js', needle: 'requestAnimationFrame(() => { if (chatPinnedBottom) scrollChatBottomSmooth(); });' },
  { name: '#162 消息图片 lazy onload 钉住期间回到底部（图片加载晚于滚底内容长高顶开视图）', file: 'js/chat.js', needle: 'if (!chatPinnedBottom || batchRendering || !chatVisible()) return;' },
  { name: '#163 主动消息先掷默认字卡概率（dc-overall-chat 命中即用默认卡，修主动消息从不混默认=概率调到八九十仍总发用户自定义字卡反复出现）', file: 'js/chat.js', needle: "if (defs && defs.type !== 'poke' && defs.text) return { text: defs.text, type: 'text' };" },
  { name: '#163 群聊文本回复按成员桌面混入默认字卡（同聊天页 genOneReply 覆盖语义，原只有拍一拍走 getDefaultCardsFor）', file: 'js/group-chat.js', needle: "if (defs && defs.type === 'text' && defs.text) t = defs.text;" },
  { name: '#166 存储优化·媒体池GC引用面（#142 池只增不删债务收口；引用源扫描被删即消失）', file: 'js/media-pool.js', needle: 'keys.filter(function (k) { return REFS.test(String(k)); })' },
  { name: '#166 存储优化·写日志标记合并（每小键 set 值+标记两个 IDB 事务并成一个批量事务；改回逐键即时写即消失）', file: 'js/idb.js', needle: 'setTimeout(wrjMarkFlush, WRJ_MARK_FLUSH_MS)' },
  { name: '#166 存储优化·查看存储页孤儿清理入口（媒体池面板接线）', file: 'js/personalize.js', needle: "getElementById('st-media-gc')" },
  { name: '#167 多字卡回复总开关·单聊 scheduleReply（关=回复条数强制1条，修「关了多字卡仍拆多条」；改回无条件 randInt 即消失）', file: 'js/chat.js', needle: "const count = (c['py-en'] === 1) ? randInt(rpMin, rpMax) : 1;" },
  { name: '#167 多字卡回复总开关·继续说 continueChat（同上语义）', file: 'js/chat.js', needle: "count = (c['py-en'] !== 1) ? 1 : randInt(rpMin, rpMax);" },
  { name: '#167 多字卡回复总开关·群聊（gc-py-en 关=每成员每条只回一条）', file: 'js/group-chat.js', needle: "const count = (c['gc-py-en'] === 1) ? randInt(rpMin, rpMax) : 1;" },
  { name: '#167 多字卡回复总开关·单聊设置页说明在位（总开关语义文案）', file: 'template.html', needle: '关闭后每条消息只回一条、每条只用一张字卡' },
  { name: '#167 多字卡回复总开关·群聊设置页说明在位', file: 'template.html', needle: '每个成员每条消息只回一条' },
  { name: '#170 字卡库瘦身·删除前重读当前值防覆盖扫描后的编辑（组名匹配不到→不动，绝不据扫描快照盲写）', file: 'js/storage-slim.js', needle: 'if (g[cat].length === before) return false;' },
  { name: '#170 字卡库瘦身·查看存储页扫描入口（面板接线）', file: 'js/personalize.js', needle: "getElementById('st-cc-scan')" },
  { name: '#169 语音60秒误报根治（重复进入录音覆盖 voiceTimer 漏孤儿计时器每250ms误报已达60秒；孤儿自毁+非录音态不判60s，逻辑被改即消失）', file: 'js/chat.js', needle: 'if (voiceTimer !== voiceTid) { clearInterval(voiceTid); return; }' },
  { name: '#228 语音停止结账看门狗（雨见等慢壳 onstop 迟到/丢失时 3s 自行结账，onstop/看门狗/异常三路幂等只结一次账；删看门狗即回归「停止后永远停在正在录音」）', file: 'js/chat.js', needle: 'voiceStopWatchdog = setTimeout(() => { voiceStopWatchdog = null; voiceFinalizeStop(); }, 3000);' },
  { name: '#228 语音空数据可见失败+默认容器兜底（空 blob 不再静默 return 卡「正在录音…」，改失败态+下次换浏览器默认容器；删此行即回归静默卡死）', file: 'js/chat.js', needle: 'voiceMimeFallback = true;' },
  { name: '#228 麦克风启动挂起看门狗（getUserMedia 永不落定时不锁死 voiceStarting 闸门+迟到流停轨防泄漏；删即回归面板点不动）', file: 'js/chat.js', needle: "Object.assign(new Error('microphone timeout'), { name: 'TimeoutError' })" },
  { name: '#228 停止结账幂等闩（voiceStopSettled：onstop 与看门狗竞态只结一次账，防二次结账覆盖成功试听态）', file: 'js/chat.js', needle: 'if (voiceStopSettled) return;' },
  { name: '#171 iOS导milk json报「格式错误」·UTF-16转存重读自救（数NUL奇偶定位字节序换编码重读；删掉自救链此表达式即消失）', file: 'js/chatcard.js', needle: "reader.readAsText(f, odd >= even ? 'utf-16le' : 'utf-16be');" },
  { name: '#171 导入失败现场写诊断（__jsErrors 带[字卡导入]前缀，设置页复制诊断直接带出真因）', file: 'js/chatcard.js', needle: "'[字卡导入] '" },
  { name: '#171 导入处理异常单独提示（applyImportData 抛错不再被吞成「文件格式不正确」；#182 重构后走三元 else 支）', file: 'js/chatcard.js', needle: ": '导入处理失败：' + ((e && e.message) || '内部错误')" },
  { name: '#172 我的表情包刷新必丢·恢复链读空改走按需取回（大键挂起时裸idbGet永远拿不到值；删掉hydrate兜底此分支即消失）', file: 'js/chat.js', needle: 'if (!v) { myeHydrateFallback(); return; }' },
  { name: '#172 我的表情包刷新必丢·保存防覆盖闸门（该键仍挂起=本会话未恢复全量，先取回合并再写；拆掉闸门此判定即消失）', file: 'js/chat.js', needle: 'window.__xyIdbDeferredKeys.indexOf(MYE_KEY()) >= 0' },
  { name: '#173 美化/聊天方案导出统一三级降级保存链（window.mochiExportFile：分享面板→保存框→确认后下载，修 iPhone 主屏 standalone/壳浏览器 a[download] 静默无反应=无法导出）', file: 'js/data-backup.js', needle: 'window.mochiExportFile = function' },
  { name: '#173 桌面美化导出接统一导出链（downloadBeautyFile 降为兜底）', file: 'js/personalize.js', needle: "window.mochiExportFile(json, fname, 'mochi美化方案')" },
  { name: '#173 桌面美化导入补回粘贴文本通道（textarea+文件并存，修 standalone 文件选择器不弹=无法导入）', file: 'js/personalize.js', needle: '粘贴美化方案文本' },
  { name: '#173 聊天美化导出接统一导出链（裸 a[download] 降为兜底）', file: 'js/chat-settings.js', needle: "window.mochiExportFile(json, fname, 'mochi聊天美化方案')" },
  { name: '#180 刷新重开丢最近聊天·同步尾巴日志（每条新消息先同步落 LS <cid>:chat-tail 再交低频整包落盘；删掉 append 调用此行即消失）', file: 'js/chat.js', needle: 'chatTailAppend(rec); // #180：同步尾巴日志先落 LS，再交低频整包落盘' },
  { name: '#180 尾巴日志权威就绪后回放（读库成功合并未落盘的最近消息；拆掉 merge 调用此行即消失）', file: 'js/chat.js', needle: 'chatTailMerge(myPrefix) > 0) changed = true; } catch (e) {} // #180' },
  { name: '#180 LS 快照超限保尾不弃写（折半丢最旧保最近；改回静默 return 此循环即消失）', file: 'js/chat.js', needle: 'while (snap.length > LS_SNAP_LIMIT && snapArr.length > 1 && round < 5)' },
  { name: '#181 气泡 CSS 通用映射导出（单聊/群聊共用；删掉导出则两处注入全瘫）', file: 'js/chat.js', needle: 'window.mochiMapBubbleCss = function' },
  // #181 单聊气泡 CSS 走通用映射（未认出模板类名时整包声明兜底，修上传零变化）。
  // 2026-09-15 由本会话（构建者）换锚：#181 原锚 `window.mochiMapBubbleCss(css, '')` 的 scope 实参
  // 被并行会话的 #536 在途稿改成 `'#page-chat '`（单聊气泡必须钉在 #page-chat 作用域，否则会泄漏
  // 进群聊同族类名），逻辑未变、只是实参换了。此处锚到不含实参的前缀形式——既继续证明「走的是
  // 共享映射器而不是旧内联兜底」，又不再因 scope 形参演进再次失配。chat-settings.js 属 AI-A 域，
  // 本会话未改动该文件。
  { name: '#181 单聊气泡 CSS 走通用映射（未认出模板类名时整包声明兜底，修上传零变化；换回旧映射此行即消失）', file: 'js/chat-settings.js', needle: "window.mochiMapBubbleCss(css, " },
  { name: '#181 群聊气泡 CSS 走通用映射（带 #page-group-chat 作用域，同单聊兜底；换回旧 replace 链此行即消失）', file: 'js/group-chat.js', needle: "window.mochiMapBubbleCss(css, '#page-group-chat ')" },
  { name: '#182 超大库导入·写盘前松开源文本（200MB 级 stringify(groups) 与源文本不得同时钉在堆上）', file: 'js/chatcard.js', needle: "txt = ''; raw = null;" },
  { name: '#182 超大库导入·OOM 识别分流（RangeError/Out of memory 给瘦身指引不报「格式错误」）', file: 'js/chatcard.js', needle: 'rangeerror|out of memory' },
  { name: '#182 超大库导入·FileReader 结果松绑（诊断只留文件头 rawHead；先 slice 再 replace 绝不全文扫描）', file: 'js/chatcard.js', needle: 'reader.onload = null; reader.onerror = null;' },
  { name: '#185 联系人空气泡·回复最终非空兜底（固定回复字卡/默认主字卡为空白时落 FALLBACK，删掉此行空气泡回归）', file: 'js/chat.js', needle: "if (typeof t !== 'string' || !t.trim()) t = pick(FALLBACK_REPLY_POOL);" },
  { name: '#185 联系人空气泡·渲染端空白占位（历史空白记录显示占位而非空壳）', file: 'js/chat.js', needle: 'const __blankMsg = !__rawText.trim();' },
  { name: '#185 删除消息防复活·del 分支同步摘尾巴日志（漏 chatTailDrop 则刷新后 chatTailMerge 把删掉的消息拼回）', file: 'js/chat.js', needle: 'chatTailDrop(msgs[idx]); // FIX 2026-09-05 #185' },
  // 2026-09-17 #663 对齐：REFS 已被并行批（#660 朋友圈配图/贴纸令牌）扩入 feed-posts 两键，
  // 锚点按现行实现同步（只加不减，删任一键仍会失配转红）。
  { name: '#186 表情/图片空白·GC 引用扫描补全（旧正则漏群聊键/LS 快照→清理孤儿媒体误删池数据）', file: 'js/media-pool.js', needle: 'const REFS = /(?:^|:)(?:chat-msgs|chat-blk-idx|chat-blk-[0-9]+|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail|cc-groups(?:-public)?|feed-posts(?:-snap)?|chat-arch)$/;' },
  { name: '#186 表情/图片空白·写池失败回滚令牌化（flush 返回 false 不得带令牌 saveMsgs，防令牌入库池数据丢失）', file: 'js/chat.js', needle: 'if (_ok === false) {' },
  { name: '#187 专属字卡串桌面·主动消息跨桌面守卫（tryAutoSend 入口捕获 cid，await 取回后放行前拦截；删掉则 B 桌面触发的主动消息把 B 池专属卡发进 A 桌面聊天）', file: 'js/chat.js', needle: 'const sameAutoCid = () => (window.__activeCid || \'default\') === autoCid;' },
  { name: '#187 专属字卡串桌面·取回后与消息定时器逐层拦截（await 后 + 每条 setTimeout 入口）', file: 'js/chat.js', needle: 'if (!sameAutoCid()) return; // FIX #187 取回期间已切桌面：池子是旧桌面的，整条主动消息放弃' },
  { name: '#188 朋友圈无图·守卫核心探测（idbGet 超时返回 undefined 与键不存在不可分；仅确认权威键确实不存在才放行写回，探测失败按存在处理）', file: 'js/feed.js', needle: "window.idbHasKey(uid + ':' + KEY).then(ok => ok === false)" },
  { name: '#188 朋友圈无图·权威回读写回走守卫（拒写＝权威仍在，增量留内存+10s 有界重读权威恢复完整视图）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(merged)).then(written =>' },
  { name: '#188 朋友圈无图·15s 保险丝写回走守卫（病理窗口 load() 可能只是剥图快照，直写=无图版本永久盖进权威键）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(all))' },
  { name: '#188 朋友圈无图·发布兜底直写走守卫（同上，剥图快照版 list 不得裸写权威键）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(list))' },
  { name: '#188 朋友圈无图·save 未就绪非空直写走守卫（与 persistSnap 相邻=预就绪分支；#496 口径演进：stringify 内联）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(arr));\npersistSnap(arr);' },
  { name: '#188/#496 朋友圈无图·save 就绪后写回走守卫（#496 口径演进：post-ready 改延后落盘，锚在低频节流表达式与 flush 兜底）', file: 'js/feed.js', needle: 'FEED_WRITE_MIN_GAP - (performance.now() - lastFeedWriteAt)' },
  { name: '#496 朋友圈评论/点赞卡顿止血·pagehide/切后台强制刷盘兜底（主键落盘改合并+低频+空闲窗口后，离页必落）', file: 'js/feed.js', needle: 'function flushFeedWrite() {' },
  { name: '#496 朋友圈评论/点赞卡顿止血·load() 内存真相层（免整包 JSON.parse 的点击帧长任务；原多行带缩进锚因构建拼接剥行首缩进恒失配，收口批改单行唯一式）', file: 'js/feed.js', needle: 'list = feedMem;' },
  // ==== 2026-09-17 #667 朋友圈评论区 TA 的表情包/图片退化成「[图片]」文字（用户直派·华为 P50E Edge，明说多机型同现）——剥图快照链三洞 + 快照去抖死路，见 FIX-REGRESSION #667 ====
  { name: '#667a 快照只剥图本体（dataURL）不剥媒体池令牌（旧实现连令牌也换 [图片] 文字＝快照成为唯一可读副本时评论区永久只剩两个字；令牌 44 字符不占预算，渲染端 inlineBody/media-pool 本就认）', file: 'js/feed.js', needle: "function stripMediaBody(s) { return String(s == null ? '' : s).replace(SNAP_MEDIA_RE, '[图片]'); }" },
  { name: '#667b 合并择优认「任何位置的媒体」而非仅整串令牌（旧判定把「好可爱 @@m:hash」混排评论当无图版，剥图快照那版反而留下＝图永久丢）', file: 'js/feed.js', needle: 'return /data:image\\//.test(t) || /@@m:[0-9a-f]{32}/.test(t);' },
  { name: '#667c 正文择优同款（含媒体的一版优先，两侧同为有图/无图才退回长度口径；删则剥图版「[图片]」文字可能被当成更完整留下）', file: 'js/feed.js', needle: 'oMedia !== nMedia ? oMedia :' },
  { name: '#667d 降级兜底（权威键没读到、靠剥图快照顶）不得当本会话内存真相（旧实现无条件 feedMem=merged → load() 被剥图版遮蔽 → 点赞/评论的写回把剥图版当最新整包写进权威键，#188 写守卫查持久层看不见写入源被掉包＝图片永久变文字）', file: 'js/feed.js', needle: 'const degraded = !authOk && curFromSnap;' },
  { name: '#667e 剥图快照 800ms 去抖落盘复活（旧写法回调里先置空 snapTimer，而 flushSnap 头部以 snapTimer 判活 → 整条尾随落盘静默失效，快照只在切后台/离页才更新，陈旧剥图版长期遮住完整内容）', file: 'js/feed.js', needle: 'snapTimer = setTimeout(() => { flushSnap(); }, 800);' },
  // ==== 2026-09-17 #669 朋友圈贴纸面板「不能像表情包面板那样打开分类」＋「没有联系人用的 emoji 贴纸」＋「点桌面朋友圈图标进页有点卡顿」（用户直派·红米K80 Chrome，明说多机型同现），见 FIX-REGRESSION #669 ====
  { name: '#669a TA 回贴的 emoji 与贴纸面板共用同一常量（删/改回内联数组＝面板里「emoji 贴纸」组与 TA 实际会贴的又不是同一批，「没有联系人用的 emoji 贴纸」复发）', file: 'js/feed.js', needle: 'return { emoji: FEED_STICKER_EMOJI[Math.floor(Math.random() * FEED_STICKER_EMOJI.length)] };' },
  { name: '#669b 贴纸面板分组清单含「emoji 贴纸」组（删＝面板只剩图片贴纸、TA 会后贴的 emoji 选不到）', file: 'js/feed.js', needle: "out.push({ key: 'em', label: 'emoji \\u8d34\\u7eb8', kind: 'emoji', items: FEED_STICKER_EMOJI });" },
  { name: '#669c emoji 贴纸按 emoji 落位（删/改成传 src＝点 emoji 会贴成空图或坏图）', file: 'js/feed.js', needle: "if (it.kind === 'emoji') feedPickStickerPos(pid, '', it.v);" },
  { name: '#669d emoji 一路带到贴纸记录（feedPickStickerPos 第三参 → addFeedSticker 的 emoji 字段；删＝emoji 点照片后不落位/落成空 src）', file: 'js/feed.js', needle: 'addFeedSticker(pid, { src: src, emoji: emoji, x: x, y: y });' },
  { name: '#669e 渲染签名命中即跳过整包重建（删＝桌面图标每次点击都重建数 MB 列表＝「点进朋友圈有点卡顿」复发；本批核心逻辑）', file: 'js/feed.js', needle: 'if (sig === feedRenderSig && listEl.firstChild) return;' },
  { name: '#669f 签名必须覆盖窗口内每条动态的身份/正文/赞/评论/贴纸/配图（删成常量＝数据变了也不重建＝显示旧数据，比卡顿更糟）', file: 'js/feed.js', needle: "parts.push(p.id, p.ts, (p.content || '').length, (p.likes || []).join('/')," },
  // ==== 2026-09-19 #845 朋友圈动态操作栏缺「贴纸」按钮（用户直派「有的手机朋友圈那一行没有贴纸，不知道有这功能」）====
  // 旧实现把那颗按钮挂在「这条动态有配图」的条件里，纯文字动态整颗消失＝功能对用户不存在（零机型分支，改常驻＋底纸承接）。
  { name: '#845a 删除型：操作栏按钮不得再退回按配图条件渲染（回流＝纯文字动态没有贴纸入口，「不知道有这功能」复发）', file: 'js/feed.js', needle: "|| p.img) ? '<button class=\"feed-act\" data-sticker=\"'", absent: true },
  { name: '#845b 有贴纸即画承载层（删/改回只看配图＝贴纸存进数据却不显示）', file: 'js/feed.js', needle: 'if (imgs.length || hasStickers) {' },
  { name: '#845c 选位上下文带临时底纸标记（删＝纯文字动态取消选位后空卡纸留在屏上，或选位整条退回随机落位）', file: 'js/feed.js', needle: 'feedPickCtx = { box, onPick, hint, timer, blank: made.blank };' },
  { name: '#845d 空白底纸样式在位（删＝纯文字动态的贴纸承载层零高度、贴纸看不见）', file: 'css/chat-pages.css', needle: '.feed-imgs.feed-imgs-blank { min-height:132px;' },
  { name: '#845e 朋友圈落盘节流等待分支不清待写槽（needle 两行连读＝「清槽只发生在真正落盘那一轮」；改回开头即置空＝命中等待时整包写静默丢弃，「刚贴的贴纸/刚点的赞刷新就没了」复发；与 chat.js #828e 同形状）', file: 'js/feed.js', needle: 'if (wait > 0) { feedWriteTimer = setTimeout(runFeedWrite, wait); return; }\nfeedWritePending = null;' },

  // ==== 2026-09-15 #501 信箱回信页「下滑被拉回、无法正常滑动」（vivo S20 Edge 等多机型，#399 同页二次复发族）——nudgeInputVisible 被键盘看门狗聚焦期每 250ms 调用，输入框在滚动容器内时（回信/写信页 .cal-scroll、日历留言等）用户下滑即被拽回「输入框可见」位；修=几何记忆（容器几何与输入框高度不变=现状出自用户滚动，不补位）====
  // #501 几何记忆闸的哨兵由 #535h 承接（#538 换键后仍是同一行早退判定，避免共用锚点被判哑哨兵）
  // v3.26.x #189：全屏滑动闪烁 + iPad 全屏开关无效果（三根因五处修复，见 FIX-REGRESSION #189）
  { name: '#189 自愈层复活·healViewport 补 documentElement 声明（v3.26 重写漏写，裸 d=window.d undefined → TypeError 被 try 吞，稳态残留清理/大平移归零/#174 缩放自愈整层静默失效）', file: 'js/mobile-adapt.js', needle: 'var d = document.documentElement; // FIX 2026-09-05 #189' },
  { name: '#189 滑动闪烁·稳态自愈 pin 改条件式（清残留/大偏移才归零；无条件 pin 把全屏覆盖形态下用户滚动每秒拽回顶部=闪烁）', file: 'js/mobile-adapt.js', needle: 'if (_cleanedResidue || winScrollY() > KB_SCROLL_HEAL) pinScrollTop();' },
  { name: '#189 滑动闪烁·全屏底边容差计入 --mochi-safe-top（#179 后 .phone 底边天然超 vv 一个安全区，旧 +24 误判位移每秒归零）', file: 'js/mobile-adapt.js', needle: 'window.innerHeight) + _stT + 24;' },
  { name: '#189 滑动闪烁·全屏态跳过 vv offset 残留判定（iOS 弹性回弹被当平移残留归零=掐断用户手势；阈值被 #视口平移残留 改严，锚点收敛到「_fsLike 非全屏门」本身）', file: 'js/mobile-adapt.js', needle: '!_fsLike() && _vv && (Math.abs(_vv.offsetTop)' },
  { name: '#视口平移残留 非全屏稳态残差严阈值 =4（#189/#179 为放行 iPad 全屏弹性回弹把 offsetTop 残差门槛提到 KB_SCROLL_HEAL(80)，非全屏 iPhone 键盘收起遗留 ≈42px 过不了 80 永不归零=输入栏错位/打字看不到内容；阈值被放宽回 80 或删此行即复发；全屏态 _fsLike 门见 #189 哨兵）', file: 'js/mobile-adapt.js', needle: 'Math.abs(_vv.offsetTop) > 4 || Math.abs(_vv.offsetLeft) > 4' },
  { name: '#189 滑动闪烁·全屏分支 --mochi-ios-h 写入 ≥6px 迟滞（全屏过渡/工具条显隐期逐帧抖动重排连发）', file: 'js/mobile-adapt.js', needle: 'if (isNaN(_curFs) || Math.abs(_nPxFs - _curFs) >= 6)' },
  { name: '#189 滑动闪烁·非全屏分支 --mochi-ios-h 写入 ≥6px 迟滞（iPad 滚动期 vv ±1~3px 逐帧抖动=reflow 连发）', file: 'js/mobile-adapt.js', needle: 'if (isNaN(_curN) || Math.abs(vh - _curN) >= 6)' },
  { name: '#189 iPad 全屏误杀·方向监视 iOS 出口（Safari 无 orientation.lock，iPad 横屏持握 ~2s 后被 handleLandscapeForced 退出全屏+误导弹窗）', file: 'js/fullscreen.js', needle: 'function startFsMonitorSafe() { if (isIOS) return; startFsMonitor(); }' },
  { name: '#189 iPad 全屏误杀·开关 1500ms 复核跳过 iOS 横屏杀全屏（否则 FB_KEY=1 被永久写坏+退出全屏）', file: 'js/fullscreen.js', needle: 'if (!isIOS && isFullscreen() && viewportLandscape()) {' },
  { name: '#189 iPad 全屏误杀·orientationchange iOS 出口（全屏态转横不纠偏、非全屏不弹「请恢复竖屏」误导弹窗）', file: 'js/fullscreen.js', needle: 'if (isIOS) return; // FIX 2026-09-05 #189' },
  { name: '#189 iPad 全屏可见效果·tablet standalone 全屏隐藏模拟状态栏（#111 手机保留不动；iPad 系统栏网页盖不住，保留=开关零视觉变化「没有生效」）', file: 'css/base.css', needle: 'html.tablet.ios-pwa-standalone.ios-fs-active .phone .statusbar { display:none; }' },
  { name: '#193 字卡库写路径防覆盖守卫（权威大库未取回进内存前绝不整包写回——iPhone 17 Pro Safari 批量导入后 17.67MB 公用库旧字卡全部消失；#188/#120 同族第三例）', file: 'js/chatcard.js', needle: 'if (!ccAuthSeen[ccScope] && window.idbHasKey) {' },
  { name: '#193 残缺库写回改为合并营救（取回权威库后按分组把内存增量并进去再写，旧字卡与本次导入都不丢）', file: 'js/chatcard.js', needle: 'groups = mergeCcGroupsInto(loadGroups(), mem);' },
  { name: '#193 权威已取回标记·探测确认 IDB 无键才放行直写（新装/空库合法直写通道，防守卫误伤）', file: 'js/chatcard.js', needle: 'if (!exists) { ccAuthMark(); saveGroupsNow(groups); return null; }' },
  { name: '#196 经期温柔语态·前缀/动作近期不重复（池仅 6 条纯均匀随机连抽同几句被当 bug；改回裸均匀随机此行即消失）', file: 'js/period.js', needle: 'var fresh = avail.filter(function (x) { return warmRecent[hist].indexOf(x) < 0; });' },
  { name: '#197 ce-box change 补派·blur 内容有变才派（contenteditable 不自发派 change，安卓全站挂 change 的保存永不触发；删掉 dispatchEvent 此行全站回退）', file: 'js/mobile-adapt.js', needle: "box.dispatchEvent(new Event('change', { bubbles: true }));" },
  { name: '#197 ce-box change 补派·聚焦基线记录（无基线则 blur 永不比对；删掉此行补派即哑火）', file: 'js/mobile-adapt.js', needle: "box.addEventListener('focus', function () { ceChangeVal = box.textContent || ''; });" },
  { name: '#198 经期卡壁纸·裸类型选择器兜底（CARD_BG_TYPES 无 desk-period，回空串=上传后永不应用；改回 return \'\'; 即回归）', file: 'js/personalize.js', needle: "return def ? def.sel : '[data-card-bg=\"' + type + '\"]';" },
  { name: '#198 经期卡壁纸·applyAll/rescue 遍历 DOM 收集全类型（只遍历白名单则裸类型壁纸重启/切桌面不回填）', file: 'js/personalize.js', needle: 'const applyAllCardBgs = () => cardBgAllTypes().forEach(t => applyCardBg(t));' },
  { name: '#199 浏览器覆盖形态·env 探针扩展（雨见/Via 沉浸式安卓壳 screen==inner 非 standalone：原只认 ios-pwa-standalone，35px 系统栏无人避让=模拟状态栏钻顶 #114 形态；门槛收敛到判定器 needEnvProbe，改回只认 standalone 此分支即消失）', file: 'js/mobile-adapt.js', needle: "_f0.needEnvProbe && _envTopCache < 0 && _sh2 > 0 && _vh2 > 0" },
  { name: '#199 浏览器覆盖形态·mochi-cover-top 类同步（CSS 无法用「var 已设」表达条件，类不挂则状态栏避让规则永不生效）', file: 'js/mobile-adapt.js', needle: "d.classList.toggle('mochi-cover-top', _wantCover);" },
  { name: '#199 浏览器覆盖形态·状态栏顶部避让（特异性夺回被 .statusbar{padding:4px} 压死的 env 避让，#114 同根因；删此规则该形态顶位回 4px 钻系统栏）', file: 'css/base.css', needle: 'html.mochi-cover-top .phone .statusbar' },
  { name: '#199 Gecko 滚动锚定关闭（锚定自行调 scrollTop 与 #162 贴底钉住对打=删消息/回消息屏幕上移；删此行雨见/Firefox 复发）', file: 'css/base.css', needle: '.chat-body { overflow-anchor: none; }' },
  { name: '#199/#236 判定器·浏览器覆盖形态期望底边=可视区底（.phone 刻意不超 inner，仍按 envTop+inner 判则修好后误报 #179 少填；#210 起判式收敛到共享判定器；#236 扩安卓壳 sig.andr——删扩展 HeyTapBrowser 类壳回退 covered/期望 envTop+inner 误报少填）', file: 'js/device.js', needle: 'const coverBrowser = !standalone && envTop >= 20 && (diff <= 2 || !!sig.andr);' },
  { name: '#236 诊断③覆盖形态有效顶位（元素顶+实测 padding：该形态 .statusbar 靠自身 padding 抬升、.phone 无 padding 兜底链，单量元素顶恒 0=顶部重叠误报/漏报双向失真。锚点随 #537 扩 iosCover、2026-09-18 #719 再扩 e2eBrowser 换锚——逻辑扩为「浏览器覆盖壳 OR iOS 独立应用覆盖形态 OR e2e 浏览器」，都靠自身 padding 抬升；判式被改掉/退回单条件即失配）', file: 'js/device.js', needle: 'const sbEffTop = (Fm.coverBrowser || Fm.iosCover || Fm.e2eBrowser) ? inp.sbTop + (parseFloat(inp.sbPadTop) || 0) : inp.sbTop;' },
  { name: '#236 安卓浏览器覆盖形态执行器（env 探针→共享判定器→写 --mochi-safe-top+挂 mochi-cover-top：执行侧此前整体在 isIOS 分支，安卓壳 #114 形态永无修复；摘除即回归；2026-09-18 #719 补 innerW/screenW/e2eLatch 参数，登记同步）', file: 'js/mobile-adapt.js', needle: 'var _fc = window.mochiViewportForm({ standalone: false, envTop: _aCoverEnvCache, innerH: _ih, screenH: _sh, innerW: window.innerWidth || 0, screenW: (window.screen && window.screen.width) || 0, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false, e2eLatch: !!window.__mochiE2eLatch });' },
  { name: '#236 安卓键盘会话卡死自愈判据（HeyTapBrowser 收键盘 vv 恒卡 inner−底栏：缩幅落残留带 13~22%+inner 回基准+会话超 1.5s+vv 稳 1.2s 才清 _aKb 置 _aVvStale——真键盘缩幅>22% 永不误清）', file: 'js/mobile-adapt.js', needle: '&& Date.now() - _aKbAt > 1500 && Date.now() - _aVvChgAt > 1200' },
  { name: '#236 open 判定残留闩门（_aVvStale 抑制纯 vv 收缩再触发键盘会话，防 652↔720 抖动把 .phone 来回抽；触摸/聚焦/回基准解除。#479 同批同步：判定式追加 _focNow 焦点闸——改这里必须连 #479 语境一起看。#657 同批同步：追加 _aKbMute 几何反证静音闩；本锚与 #479 原为同一整行，改取闩门半段以免两条共用同一 needle 判哑哨兵）', file: 'js/mobile-adapt.js', needle: '(!_aVvStale && !_aKbMute && h < _aH - 60' },
  { name: '#479 窗口改尺寸（Edge小窗/分屏）焦点闸——真键盘必然在文本聚焦期弹出（focusin 先于 vv 收缩），无聚焦深缩=窗口被改小；删掉 _focNow 闸则小窗重新触发幽灵键盘会话（面板停靠/alignSelf 残留）', file: 'js/mobile-adapt.js', needle: '&& _focNow);' },
  { name: '#479 窗口级改尺寸基线重锚（事件侧 syncAndroidKb：inner≈vv 一起深缩+无文本聚焦=小窗/分屏/桌面缩放窗口，_aH/_aIH/_aFullIH 三基线全体跟随当前窗口；_aFullIH 下移后 #369 触发条件恒假=双保险）', file: 'js/mobile-adapt.js', needle: 'if (_ihN < _aFullIH) _aFullIH = _ihN;' },
  { name: '#479 #369 残留自愈加键盘语境门（_aShrinkHadFoc=打字期深缩才允许钉高回全屏；无焦点深缩走窗口重锚）——防止 Edge 小窗被 #369 钉回旧全屏高把顶栏/输入栏推出窗外（Ace3 实报「顶部名称栏和输入框消失」）', file: 'js/mobile-adapt.js', needle: '(_aVvShrunkSeen || _aPanSeen >= 80) && _aShrinkHadFoc' },
  { name: '#479 钉高前提失败阀（钉高 10s 后内核仍不回全屏高且用户在深缩态有新交互=在用这个窗口尺寸 → 放弃钉高基线重锚；覆盖焦点滞留期深缩的窄路径误钉）', file: 'js/mobile-adapt.js', needle: 'if (_aVpPin && _aVpPinAt > 0 && Date.now() - _aVpPinAt > 10000' },
  { name: '#479 window.resize 同步桥（部分壳改窗口只发 window.resize 不发 vv.resize，基线重锚/键盘判定依赖 syncAndroidKb 跑到；resizes-visual 真键盘不缩布局视口=桥不触发，双跑幂等早退）', file: 'js/mobile-adapt.js', needle: "window.addEventListener('resize', function () { try { syncAndroidKb(); } catch (eWR) {} });" },
  { name: '#657 键盘滞留读数「几何反证」复原门（信箱写信页滑动＝整页飞出去/只显示上半屏：页面收到的真实触摸点落在可视视口底边以下 ⇒ 该区域没被软键盘占据 ⇒ 键盘必不在场；删掉此判定则 #209/#236 视口闸 + #267/#542 焦点闸在焦点滞留时全被挡住，.phone 永久停在键盘期收缩高）', file: 'js/mobile-adapt.js', needle: 't.clientY > Math.round((_aVV.offsetTop || 0) + _aVV.height) + 24' },
  { name: '#657 平移补偿「成孤儿」恒等式（_aPanComp 补偿量恒等于当时读到的残留平移：读数归零而 .phone 仍带内联 top＝整壳被按旧偏移推下＝用户所见「飞出去+只显示上半屏」；删掉则孤儿补偿永久残留；键盘会话期不参与以免打断动画期零强制读契约）', file: 'js/mobile-adapt.js', needle: "&& Math.abs(Math.round(_aVV.offsetTop || 0)) <= 4) _aPhone.style.removeProperty('top');" },
  { name: '#203 iOS18 保留形态甄别式（standalone+env∈[20,160]+diff≈envTop+iOS≥18，命中即 safeTop 归 0：否则 #179 公式把 .phone 顶出布局视口=居中裁切+文档溢出与 pin 对打=滑动/切换卡顿；#210 起判式收敛到共享判定器，删门槛或改比较符即回归）', file: 'js/device.js', needle: 'diff >= envTop - 8 && iosMajor >= 18' },
  { name: '#203 iOS18 保留形态显式写 0px（摘除属性会回落 env() 变双重避让，Mochi 行上方 59px 空白）', file: 'js/mobile-adapt.js', needle: "var _topPx = _safeTop ? _safeTop + 'px' : (_resStand ? '0px' : '');" },
  { name: '#203 执行器接入共享判定器（syncVvFit 形态判定单一事实源 #210；执行器回退手抄判式此行即消失）', file: 'js/mobile-adapt.js', needle: 'var _f = window.mochiViewportForm(_sig0);' },
  { name: '#203 判定器·保留形态期望底边=inner（.phone 超 inner=文档滚动量；#184 iPad 形态/#186 force 声明同走 inner 分支；#210 起收敛到共享判定器 expBase 单点；2026-09-18 #719 e2e 形态并入同分支，登记同步）', file: 'js/device.js', needle: 'const expBase = (coverBrowser || resStand || ipadForm || e2eBrowser) ? innerH' },
  { name: '#200 通话防误挂·挂断掷骰硬闸（总开关或概率<=0 不掷骰——挂断几率为 0 仍被挂断的兜底闸门，删此条件设 0 即回到「读默认 2% 照挂」）', file: 'js/call.js', needle: 'if (!(hp.nohangup || hp.hangup <= 0) && Math.random() * 100 < hp.hangup) {' },
  { name: '#200 通话防误挂·总开关配置读取（callCfg 不读 call-no-hangup 则开关形同虚设）', file: 'js/call.js', needle: "nohangup: c['call-no-hangup'] === 1 || c['call-no-hangup'] === '1'," },
  { name: '#200 通话防误挂·设置项默认值（reply-settings 不登记该键则开关永不落盘/读取恒缺）', file: 'js/reply-settings.js', needle: "'call-no-hangup': 0," },
  { name: '#200 通话防误挂·通话设置页开关行（template 无锚点则页面无入口）', file: 'template.html', needle: 'id="call-no-hangup"' },
  { name: '#201 浏览器顶部黑边·theme-color 静态默认=浅色页底（写死 #111111 时安卓 Edge/Chromium 把页面外 41px 系统区涂黑=顶部黑边）', file: 'template.html', needle: 'content="#e9e9e9"' },
  { name: '#201 浏览器顶部黑边·theme-color 跟随主题同步（applyThemeMode 不刷新 meta 则深色模式切回浅色后仍涂深色）', file: 'js/personalize.js', needle: "meta.setAttribute('content', bg)" },
  { name: '#202 表情/图片空白·加载失败占位统一入口（令牌缺失+远程图断网/失效+parts 图全覆盖；曾因并行 stash 收口丢失，此次重登记）', file: 'js/chat.js', needle: 'function bindMediaFailPlaceholder(b) {' },
  { name: '#202 表情/图片空白·占位判据（延时复核 naturalWidth=0 且池确认无数据才替换，防 404 抢跑误清正常表情）', file: 'js/chat.js', needle: 'if (im.naturalWidth !== 0) return;' },
  { name: '#205 表情空白·全透明空图检测（加载成功但内容无画面=最后一类真空白；采样 alpha 全 0 才占位，多设备共用坏字卡库现场）', file: 'js/chat.js', needle: 'if (im.dataset.alphaChecked) return;' },
  { name: '#206 表情重复+乱码+空白·尾巴日志拒收媒体型消息（sticker/image 的 text=媒体本体，回放丢 type + 令牌化后签名漂移被当新消息回放=同一表情旁多出乱码/坏图复制）', file: 'js/chat.js', needle: "if (rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice') return;" },
  { name: '#206 表情重复+乱码+空白·超长文本/parts 不进尾巴日志（截断存储与丢图回放同样失真）', file: 'js/chat.js', needle: "if (typeof rec.text !== 'string' || rec.text.length > CHAT_TAIL_TEXT_MAX) return;" },
  { name: '#206 表情重复+乱码+空白·回放端拦截旧版存量媒体存根（data:/@@m: 开头无 type 的条目跳过，防 normCell 误迁移成坏图 image。#943 起内联载荷判定收口到 chatIsInlineDataSrc，锚点随新写法、逻辑未变）', file: 'js/chat.js', needle: "if (jt.indexOf('@@m:') === 0 || chatIsInlineDataSrc(jt)) { keep.push(j); continue; }" },
  { name: '#207+#340 保活音频电流声/嗡鸣·频率统一换 18kHz（220Hz 在人耳最敏感频段：#190 降幅度后安卓多机型仍实听嗡声→#207 换 18kHz；#340 iPhone 16 Pro Safari 同根因复发——iOS 忽略 audio.volume，220Hz@0.002 实听比安卓被投诉电平还大 4 倍=「打开一直震动响声重启无用」；iOS 无 Chromium audible 判定，amp 分支不动=电平语义零回归）', file: 'js/bg-keep.js', needle: 'const freq = 18000;' },
  { name: '#208 聊天输入栏上移白边·键盘收起视口未还原自愈（iOS standalone 键盘收起 WebKit 偶发不还原视口，restoreKb 的 60px 还原门槛永不满足=kbActive 卡真 .phone 卡收缩高；失焦>4s 且视口仍<基线−60 强制复原）', file: 'js/mobile-adapt.js', needle: 'Date.now() - _focLostAt > 4000 && _vv && _vv.height < _fullVv - 60' },
  { name: '#208 聊天输入栏上移白边·tabbar 隐藏跳过采集（全屏页 tabs.js 给 tabbar 挂 hidden，矩形全 0 被判悬空 860px 每 5s 刷假错误环）', file: 'js/device.js', needle: 'if (!tb || tb.hidden) return null;' },
  { name: '#208 聊天输入栏上移白边·判定器布局视口未贴底（保留形态 diff 应≈envTop；键盘收起未还原时按 inner 判贴合全绿漏报，单列 ✗ 让白带状态可诊断）', file: 'js/device.js', needle: 'diff > envTop + 24 && !(inp.kb && inp.kb.kbActive)' },
  { name: '#209 输入栏下方灰底断截面·焦点保留硬证据自愈（安卓返回键收键盘不派 blur/#197 族 focusout 丢失时 !foc 复原分支永不执行=停靠残留卡死；可视区双信号回满 ≤12px 即复原，焦点在不在都算键盘已收；推定停靠 _aProv/_iProv 与全屏态不碰；#916 换锚：原 needle 随稳态高度对账重构改为同语义守卫正形态，逻辑只强不弱）', file: 'js/mobile-adapt.js', needle: 'if (_hNow > 0 && _hNow >= _aH - 12 && (window.innerHeight || 0) >= _aIH - 12) {' },
  { name: '#210 视口形态判定器同源（window.mochiViewportForm 单一事实源：执行器 syncVvFit 与诊断 screenDiagJudge 共用，新形态只改一处；删定义即回归两处手抄判式漂移——#186 期间 force 分支已实际漂移两处）', file: 'js/device.js', needle: 'window.mochiViewportForm = function (sig) {' },
  { name: '#210 判定器·force 声明期望底边=屏高（#186 缺陷修正：原误写 innerH 与「期望=屏高」注释矛盾，forced 设备自检必误报底部超出；env=0 的 18.3 白边期望按 safeTop+inner 补满。#276 起该分支同步加坏 screenH 门，needle 随代码演进）', file: 'js/device.js', needle: 'forceCover ? ((screenH >= innerH ? screenH : 0) || (safeTop + innerH))' },
  { name: '#210 采集器 force 传入判定器（#186 缺陷修正：漏传致「用户已声明覆盖形态」分支在真实采集路径永不命中=死分支）', file: 'js/device.js', needle: "inp.force = (function () { try { return localStorage.getItem('xy-home-v2:__safe-top-force') === '1'; } catch (e) { return false; } })();" },
  { name: '#210 屏幕适配事件沿捕获（5s 轮询漏瞬态：切后台回来 innerHeight 短报整屏/旋转中态；resize/vv/旋转/回前台 1.2s 去抖补采，同一键盘守卫+签名去重）', file: 'js/device.js', needle: "window.visualViewport.addEventListener('resize', sdEdge)" },
  { name: '#210 屏幕适配错误环带事发现场数值（最近错误直读 env/var/diff/inner/sb/scale，报障免复现）', file: 'js/device.js', needle: "(snap ? snap.envTop : '?') + ' var=' + (snap ? snap.varTop : '?')" },
  { name: '#210 屏幕适配报告附历史快照时间线（自动监视 ✗ 存档随报告带出，报障免复现）', file: 'js/device.js', needle: 'sdHistTimeline()' },
  { name: '#211 聊天收发整窗重建闪一下（窗口超限判定 RENDER_MAX→WINDOW_MAX：旧条件在钳位渲染后每来一条消息恒为真，历史>200条桌面每收发一条=200气泡整窗重建重新解码=肉眼闪一下；收紧后常规收发走增量追加，与 loadOlderIncremental→pruneWindowBottom 同口径）', file: 'js/chat.js', needle: 'msgs.length - renderStart > WINDOW_MAX' },
  { name: '#211 打开聊天闪动·归一化收尾渲染闸（后台迁移发现改动曾无条件整窗重建=打开聊天偶尔闪一下的第二来源；改动全落在渲染窗口之外时跳过，sysNick 清扫/相邻删除保守整窗）', file: 'js/chat.js', needle: 'sysNickChanged || removedAll > 0 || changedHi >= renderStart' },
  { name: '#212 挖孔屏全屏顶端留白·安卓 enterFs 补 navigationUI hide（Chromium 40723205：挖孔屏默认 auto 不把全屏面铺到挖孔区=页面外系统层 letterbox 顶端露空白、页面内测量全绿无法诊断，iQOO12 等多机型；iOS 路径原有参数不动，老内核忽略选项参数零回归）', file: 'js/fullscreen.js', needle: "const fsOpts = { navigationUI: 'hide' };" },
  { name: '#216 音乐封面全丢·代理封面正则（存量迁移与播放/页面打开迁移全靠它识别 meting 图片代理 URL；被删/改窄=代理封面永不迁移，第三方代理一挂新旧封面全丢——一加Ace3+Edge 实测）', file: 'js/music-player.js', needle: 'var COVER_PROXY_RE = /^https?:\\/\\/api\\.injahow\\.cn\\/meting\\/\\?[^]*type=pic/i;' },
  { name: '#216 音乐封面全丢·新封面落库前解析直链（meting type=song 的 pic 是图片代理 URL，直接入库=显示命依赖第三方单点；解析失败原样回退代理）', file: 'js/music-player.js', needle: 'if (pic) { resolveCoverDirect(String(pic), cb); return; }' },
  { name: '#216 音乐封面全丢·meting 挂掉的第二封面源（超时/挂/被拦走 fetchNeteaseInfo 多代理链的 song/detail album.picUrl=网易 CDN 直链；删此函数则主源一挂新加歌永久无封面）', file: 'js/music-player.js', needle: 'function fetchNeteaseCoverFallback(id, cb) {' },
  { name: '#216 音乐封面全丢·迁移同步历史/TA收藏快照（快照里冗余的代理封面不同步则历史图标仍依赖第三方代理；只换 URL 不动快照结构）', file: 'js/music-player.js', needle: 'function syncSnapshotCovers(sid, cov) {' },
  { name: '#214 standalone 顶部黑边·manifest theme_color 浅色（安卓 Edge/Chromium standalone 形态状态栏取 manifest theme_color 而非页面 meta，#201 只改了 meta 一加Ace3+Edge 仍黑边；改回深色即回归，深色模式用户由 meta 动态同步兜着）', file: 'pwa/manifest.json', needle: '"theme_color": "#e9e9e9"' },
  { name: '#210 屏幕适配全屏页外 letterbox 盲区提示行（挖孔屏 letterbox 在页面坐标系外、页内全绿无法检测——iQOO12 实证；仅全屏态且无其他 ✗ 时输出，引导关开一次全屏重新申请；删条件或改输出即回归；v3.27.x #217 加 isAndroid 门控后锚点收窄至守卫表达式，全量门控另立 #217 哨兵）', file: 'js/device.js', needle: '!F.some(function (f) { return !f.ok; })' },
  { name: '#215 发送取值兜底·输入快照捕获（Edge 点发送瞬间撕组合文本零事件，innerText/textContent 双读空＝消息 0 条字静默丢；删此行快照永不更新即回到缺口）', file: 'js/chat.js', needle: "input._mLastTyped = input.innerText || '';" },
  { name: '#215 发送取值兜底·新鲜快照恢复（双口径读空+真实编辑晚于上次清空+15s 新鲜度三重收紧才启用；删除/放宽此恢复分支＝撕文本场景回 0 条消息）', file: 'js/chat.js', needle: 'if (snap && userEditedAfterClear() && Date.now() - lastUserEditAt < 15000) return snap;' },
  { name: '#217 屏幕诊断·⑤e 停靠残留判定条目（#209 同族对号条目：键盘停靠已结束而 .phone 内联 height/alignSelf 未清=输入栏上移/灰边；双端键盘探针+vv 收缩三重守卫防键盘期误报；删此判定则 #209 看门狗失效真机无诊断可对号）', file: 'js/device.js', needle: '(inp.phoneInlineH || inp.phoneAlignSelf)' },
  { name: '#217 屏幕诊断·⑤f 横向贴合判定条目（宽度轴此前零判定，#185 平板左右露白同族；#187 起平板也全宽故无限宽豁免；桌面手机壳 isMobileDev 跳过）', file: 'js/device.js', needle: 'inp.phoneW != null && inp.isMobileDev && inp.innerW' },
  { name: '#217 屏幕诊断·letterbox 提示 isAndroid 门控（现象为安卓 Chromium 系统层行为，iOS 无原生全屏 API 提示行纯噪声降噪）', file: 'js/device.js', needle: 'inp.fsActive && inp.andr' },
  { name: '#217 屏幕诊断·离开抢拍钩子（#209 K70 实锤残留只存在于切页前最后一帧、切页 blur 即自愈，5s 轮询/事件沿均采不到；tabs.js hidden 前与本钩子同步抢拍坏形态存档）', file: 'js/device.js', needle: 'window.__mochiLeaveSnap = function (trig)' },
  { name: '#217 屏幕诊断·hidden 微任务级抢拍（观察器随 device.js 注册先于 tabs.js syncChrome 的 blur=自愈前现场；覆盖不经 tabs.js 的 JS 直切页）', file: 'js/device.js', needle: "sdPgMo.observe(p, { attributes: true, attributeFilter: ['hidden'] })" },
  { name: '#217 屏幕诊断·监视二次确认降噪（首见坏签名只存档，连续两 tick ≥5s 持续才入错误环——治 #208 iPad 切后台单采样瞬态刷环；瞬态证据仍留在历史快照）', file: 'js/device.js', needle: 'if (_sdPend && _sdPend.sig === bad)' },
  { name: '#217 屏幕诊断·错误环 SD 先逐出（[屏幕适配] 条目与 JS onerror 同队列，纯 FIFO 爆发时把真 JS 错误顶出环外；满时先逐最旧 SD 条目保 JS 错误）', file: 'js/device.js', needle: 'if (iSD < 0) arr.shift(); else arr.splice(iSD, 1);' },
  { name: '#217 屏幕诊断·坏快照分级保留（坏现场稀少且珍贵，纯 FIFO 8 条会被后续好快照顶没；坏/好各保底最近 4 条）', file: 'js/device.js', needle: 'bads.concat(goods).sort(function (a, b) { return a.t - b.t; })' },
  { name: '#217 屏幕诊断·SIG 机读签名行（报告尾固定键序 JSON，用户整段复制后开发者可脚本解析对号/录 verify 台账）', file: 'js/device.js', needle: "L.push('SIG ' + JSON.stringify(sig))" },
  { name: '#217 屏幕诊断·先更新再测比对（手动诊断拉远端 version.json 比本机 ts，远端新出 60s 容差即提示先更新——#215 实锤存量旧版未送达修复是症状大半来源）', file: 'js/device.js', needle: 'remoteTs > lts + 60000' },
  { name: '#217 屏幕诊断·切页前抢拍钩（syncChrome 的 blur 在切页瞬间触发残留自愈，必须在 pages hidden 之前同步采集）', file: 'js/tabs.js', needle: 'const sdLeaveSnap = () =>' },
  { name: '#132 功能字卡概率·stepper 绑定与 dcfGet（#518 起出口改经 dcfEffGet 套总档；改掉 DCF_DEF 默认表或删 window.dcfGet 暴露即回归——字卡库【其他互动功能字卡】各分类使用概率可显示可调）', file: 'js/default-cards.js', needle: 'window.dcfGet = dcfEffGet;' },
  { name: '#132 温柔前缀/动作概率接 dcf-period（改回硬编码 Math.random()*100>=25 即回归——经期字卡概率可调）', file: 'js/period.js', needle: 'if (Math.random() * 100 >= _warmP) return text;' },
  { name: '#844 摸鱼抓包结算总账（奖励＝距上次抓包以来 TA 涨的全部 fish-total-ta，基线 settledTa 只随抓包推进；改回 Math.max(1, delta) 单 60s 窗口即回归——用户报「抓到只加个位数，与自动增长量级不符」）', file: 'js/p2-features.js', needle: 'const bonus = Math.max(1, cur - base);' },
  { name: '#132 摸鱼浮字/抓包回应概率接 dcf-fish（改回 Math.random()<0.35 硬编码即回归；#224 改经本 IIFE 助手 dcfPFish→window.dcfGet，原锚 dcfP 跨 IIFE 不可见是作用域 bug 本体）', file: 'js/p2-features.js', needle: 'dcfPFish(35)' },
  { name: '#132 吃饭追问关心概率接 dcf-eat（改回硬编码 0.35 即回归）', file: 'js/p2-features.js', needle: "dcfP('eat', 35)" },
  { name: '#132 同频敲三下回应概率接 dcf-sync（改回硬编码 0.6 即回归）', file: 'js/p2-features.js', needle: "dcfP('sync', 60)" },
  { name: '#132 伸手摸到概率接 dcf-reach（改回硬编码 0.55 即回归）', file: 'js/p2-features.js', needle: "dcfP('reach', 55)" },
  { name: '#132 喝水字卡乘法门控接 dcf-water（删 dcfHit 门控行即回归——多档内部节奏不改，0=全关）', file: 'js/p2-features.js', needle: "if (!dcfHit('water')) return;" },
  { name: '#132 花园悄悄话概率接 dcf-garden（改回 Math.random()<0.4 硬编码即回归）', file: 'js/garden.js', needle: "if (Math.random() * 100 < _gP) {" },
  { name: '#132 查岗回应概率接 dcf-deskcheck（改回 Math.random()*100<50 硬编码即回归）', file: 'js/chat.js', needle: 'Math.random() * 100 < _dkP' },
  { name: '#132 房间字卡门控接 dcf-room（删 sayLine 门控行即回归）', file: 'js/room.js', needle: "window.dcfGet('room')" },
  { name: '#132 此间字卡门控接 dcf-cjian（删 cjLine 门控行即回归）', file: 'js/cjian.js', needle: "window.dcfGet('cjian')" },
  { name: '#611 梦角档案管理·入口提醒（档案页管理弹窗顶部「梦角会跟着桌面联系人自动创建」，删这句即回归）', file: 'js/cjian.js', needle: "'梦角会跟着桌面联系人自动创建，一般不用手动添加'" },
  { name: '#611 梦角档案管理·arc 不带时辰（档案页添加梦角不弹时辰浮层、提示改指此间；改回「下一步还能限定 TA 常在的时辰区间」即回归）', file: 'js/cjian.js', needle: "'选一个时间偏移（想限定 TA 常在的时辰，去「此间」设）'" },
  { name: '#611 梦角档案管理·入口传 arc 标记（删 { arc: 1 } 即回归——档案页又会冒出此间的「时辰区间」）', file: 'js/memo-arc.js', needle: 'e.stopPropagation(); if (window.cjianManage) window.cjianManage({ arc: 1 });' },
  { name: '#132 漂流瓶字卡门控接 dcf-drift（删 poolLine 门控行即回归）', file: 'js/drift-bottle.js', needle: "window.dcfGet('drift')" },
  { name: '#132 音乐字卡门控接 dcf-music（删 taPauseSendCard 门控行即回归）', file: 'js/music-player.js', needle: "window.dcfGet('music')" },
  { name: '#132 功能字卡概率 stepper UI（fc 页 13 分类 + dk 页查岗，删 UI 即回归）', file: 'index.html', needle: 'dcf-prob-period-val' },
  { name: '#219 背景模糊/遮罩层盖住壁纸（z-index 0→2——#147 壁纸常驻图层 z1 压住本层后白遮罩被盖+backdrop-filter 采样不含壁纸=调整无效，改回 0 即回归）', file: 'css/home.css', needle: 'position:absolute; inset:0; z-index:2; pointer-events:none;' },
  { name: '#239 互动功能字卡页/查岗字卡页整页滚动（#132 概率框 ~794px 插头部后 .card-list flex 最小尺寸因 overflow:auto 归 0：列表压成 6px 且首屏在视口外=「字卡看不到了点击没内容」；删此规则即回归 #page-default-cards 同族病）', file: 'css/chat-pages.css', needle: '#page-fun-cards #fc-list { flex:0 0 auto; overflow:visible; min-height:0;' },
  { name: '#240 背景模糊载体改壁纸层自滤（backdrop-filter 在小米15Pro/Chrome 151 真机采样不生效 #219 后仍无感；blur>0 挂 .desk-blur-on 对 #phone-bg-layer filter+四边外扩 24px 防边缘发虚——删此规则真机模糊恒无感）', file: 'css/home.css', needle: '.phone.desk-blur-on #phone-bg-layer' },
  { name: '#241 权威比屏上多时尾部增量追加（原地补丁放宽：快照缺尾部/对端新消息只在 IDB 时不再整窗清空重画=打开聊天「先跳动一下」；loadNewerIncremental 传 len 一次补齐，删此分支即回归）', file: 'js/chat.js', needle: 'for (let r = 0; r < Math.ceil(grown / LOAD_STEP) + 1 && renderEnd < len; r++) loadNewerIncremental(len);' },
  { name: '#220 权威读库收尾·同窗原地补丁（条件不满足才整窗重渲——删补丁分支=每次打开聊天整窗重建 200 气泡重新解码肉眼跳动）', file: 'js/chat.js', needle: 'if (!inplacePatchIfSameWindow()) {' },
  { name: '#220 重开聊天不闪·同窗判定（enterChat 重开跳过整窗重建——删此判定=重复进入聊天页必闪一下）', file: 'js/chat.js', needle: 'if (!inplacePatchIfSameWindow()) renderWindow(false, true);' },
  { name: '#220 屏上渲染凭据登记（windowRenderedN/Prefix/Stale——整窗渲染时记录「屏上由哪份 msgs 渲染」，同窗补丁的判定基础，删登记则补丁永不命中=哑修复）', file: 'js/chat.js', needle: 'windowRenderedPrefix = window.activePrefix();' },
  { name: '#220 增量追加对齐渲染凭据（addRec 后屏上窗口多出尾部消息，重开时才能命中同窗补丁——删此对齐=聊过天再重开必闪）', file: 'js/chat.js', needle: 'windowRenderedN = Number(el.dataset.idx) + 1;' },
  { name: '#220 idle 回执占位标记（权威前读不到正文渲染占位+pendingRead 标记，权威到位原地替换——删标记则占位文本永久停留）', file: 'js/chat.js', needle: "m.dataset.pendingRead = '1';" },
  { name: '#224 摸鱼抓包 chk 作用域修复（本 IIFE 自备 dcfPFish 走 window.dcfGet——删助手改回跨 IIFE 引用 dcfP 即回归：每分钟 ReferenceError dcfP is not defined）', file: 'js/p2-features.js', needle: 'function dcfPFish(def)' },
  { name: '#226 idbSetAll 挂起超时骨架（#166 微批化后挂起内核上 wrj 标记/媒体池 flush 永不落地、false 兜底不可达=杀进程回滚 LS 后自愈失效「刷新后丢美化/丢数据」——删超时骨架即回归）', file: 'js/idb.js', needle: 'const lim = 4000 + (est > 262144' },
  { name: '#229 wrj 合并失败重试（原入口即置 merged+idbGetAllKeys 把读失败折叠成空数组：挂起内核上自愈第二道防线空转一次全会话放弃=LS 回滚的美化/设置/小数据本会话无法恢复「部分数据丢失」——改回一次性放弃即回归）', file: 'js/idb.js', needle: 'if (!keys) { wrjMergeRetry(); return; }' },
  { name: '#230 红包状态流转原地补丁（领取/退回/TA领取/TA退回/自动领取此前一律 renderWindow 整窗重建=全部气泡 img 重新解码=领取红包必闪屏，#211/#220 同族最后一条未收口路径、与机型历史条数无关；改回无条件整窗即回归）', file: 'js/chat.js', needle: "card.classList.remove('opened', 'expired');" },
  { name: '#230 用户领取红包路径守卫（报障主路径：点击红包卡先试原地补丁，卡片不在渲染窗口才回退整窗）', file: 'js/chat.js', needle: 'if (!rpPatchStatusInPlace(rpIdx)) renderWindow(true, true);' },
  { name: '#235 iOS Safari 26 独立模式覆盖形态判定（26.x 起独立应用状态栏行为变「覆盖」env 报真实值且内容垫到状态栏下，resStand 加 safMajor<26 门——删门则 26.x standalone 同信号被误判保留=漏加顶部避让顶栏融进灵动岛+高度少算 env 段底部白带；18.x 老内核保留形态不受影响）', file: 'js/device.js', needle: 'safMajor > 0 && safMajor < 26' },
  { name: 'v3.34.x 自定义字卡全量导入（列表页新入口：公用/专属/功能卡/寻踪/情话/TA六类一份 json；写盘前走 hydrateLibScopes 权威取回再 ccFullApply，删守卫=空快照覆盖权威库重演 #193）', file: 'js/chatcard.js', needle: 'ccFullApply(d, mode)' },
  { name: 'v3.34.x 自定义字卡全量导入导出列表页入口锚点（template.html）', file: 'template.html', needle: 'li-cc-full-export' },
  { name: '#237 添加备忘触发聊天提问（新增后 TA 经 chatAddIn 回应+追问一条带「备忘」chip——此前新增零聊天联动，只剩完成/分享两通道；删调用即回归）', file: 'js/memo-app.js', needle: "window.chatAddIn(memoPick(DEF_MEMO_ASK).replace('{m}', memoClip(v, 16))" },
  { name: '#238 备忘提醒聊天发送锚（概率催办经 chatAddIn 发「备忘提醒」chip：引擎改道不发即回归）', file: 'js/memo-app.js', needle: "window.chatAddIn(text, { tag: '备忘提醒' })" },
  { name: '#238 备忘提醒间隔闸（last=上次提醒时刻，命中后至少隔 2 天——用户反馈不用太频繁；删闸则每 4 分钟命中即发=轰炸）', file: 'js/memo-app.js', needle: 'if (Date.now() - c.last < 2 * 86400000) return;' },
  { name: '#242 群聊串群收口·撤回落回来源群（定时器捕获调度时的 gid，切群后撤回不再写错群/撤错消息；去掉 gid 传参即回流串群）', file: 'js/group-chat.js', needle: 'retractGcMsg(myIdx, gid)' },
  { name: '#242 群聊串群收口·scheduleReply 绑定来源群（回复定时器落库不再读执行时刻的 curGid——发消息后切群回复写进新群+原群丢失）', file: 'js/group-chat.js', needle: 'memberReply(cid, userText, gid)' },
  { name: '#243 群聊 IDB 回填防串群（loadMsgs 异步回调 key 不等于当前群整包丢弃——否则旧群回调在切群后 resolve 会整包覆盖 msgs 并被下次保存回写污染新群存储键）', file: 'js/group-chat.js', needle: 'if (key !== groupMsgKey(curGid)) return;' },
  { name: '#244 群聊撤回查看安全化（撤回先存渲染快照 rec.orig 对齐单聊 chat.js；无快照走 gcRetractFallbackHtml 转义回退——直出原始文本=多行丢换行/媒体点开整屏 base64/字卡含 HTML 被执行。#245/#247 批 needle 同步：媒体类记录/超 20KB 快照改走占位回退防臃肿）', file: 'js/group-chat.js', needle: 'rec.orig = (el && el.innerHTML.length <= 20000) ? el.innerHTML : gcRetractFallbackHtml(rec);' },
  { name: '#245 打开聊天精简快照残留原位升级（大历史 LS 剥负载快照不再整窗清空重画=真机闪屏+弹一下；改 liteUpgrade 收集+残留下标 replaceChild 换节点，见 verify-chat-lite-upgrade.mjs）', file: 'js/chat.js', needle: 'old.parentNode.replaceChild(nu, old);' },
  { name: '#247 群聊媒体令牌化（落盘前 data:image 统一换 @@m: 池令牌+池先落盘——删 normalize 则表情/图片继续整段 base64 内联进消息数组，全量重写一次比一次大直到 LS 配额静默丢写）', file: 'js/group-chat.js', needle: 'Promise.resolve(window.mochiMediaTokenize(v)).then(t => { seen.set(v, t || v); })' },
  { name: '#247 群聊撤回快照防臃肿（媒体类记录/超大快照走占位回退不存 DOM 快照——否则令牌化省下的空间被快照里的整段 base64 吃回去）', file: 'js/group-chat.js', needle: "const mediaish = rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice' ||" },
  { name: '#248 群聊历史分页·渲染窗口起点（进群只渲最近 RENDER_MAX 条，gcRenderStart 供「查看更早」续载——删则回归只上不下，老消息存了但界面永远看不到）', file: 'js/group-chat.js', needle: 'gcRenderStart = Math.max(0, n - RENDER_MAX);' },
  { name: '#276 群聊撤回图片可看缩略图（点击查看时 gcRetractMediaHtml 即时从 rec.text/rec.parts 重拼 img，data:/@@m: 均可显；优先于存量占位快照——改回 rec.orig 优先则撤回图片只剩【图片】文字）', file: 'js/group-chat.js', needle: 'gcRetractMediaHtml(rec) || rec.orig || gcRetractFallbackHtml(rec)' },
  { name: '#248 群聊历史分页·滚动位置保持（顶部补历史按 scrollHeight 差值回补 scrollTop——删则点查看更早视口跳底/闪跳）', file: 'js/group-chat.js', needle: 'try { body.scrollTop += body.scrollHeight - prevH; } catch (e) {}' },
  { name: '#268 搜索/引用跳转·裁剪区下界外扩窗（jumpToMsg 只处理 idx<renderStart，落在被 pruneWindowBottom 裁剪的 idx>=renderEnd 时 target 查不到=搜索点了不跳不高亮；补向下增量展开直到 renderEnd>idx——删此分支即回归「搜索/引用点了没反应」）', file: 'js/chat.js', needle: 'else if (idx >= renderEnd && idx < msgs.length) {' },
  { name: '收口第二批 env 能力层（device.js 唯一 UA 嗅探处：chat 语音 WebView/data-backup 分享黑名单/music-player API 拦截提示/bg-keep 小米通知提示四消费端只读标记——删 env 挂载=四端读 undefined 恒 false，语音走错容器/华为夸克分享假成功回归）', file: 'js/device.js', needle: 'env: env,' },
  { name: '收口第二批 语音 WebView 消费锚（chat.js 改读 mochiDevice.env.isAndroidWebView——标准安卓 Chrome 才走 webm/opus 防爆音，删读取则全安卓 WebView 误走 webm 能录不能播）', file: 'js/chat.js', needle: 'return !!((window.mochiDevice || {}).env || {}).isAndroidWebView;' },
  { name: '收口第二批 备份分享黑名单消费锚（data-backup.js 改读 env.brokenFileShare——删读取则华为/夸克分享假成功 AbortError 回归=无法导出备份）', file: 'js/data-backup.js', needle: 'const brokenFileShare = !!((window.mochiDevice || {}).env || {}).brokenFileShare;' },
  { name: '收口第二批 kaIsIOS 薄壳（bg-keep.js 改读 mochiDevice.isIOS 唯一判定源——复刻正则回来=device.js 判定升级时保活幅度/频率走错平台分支）', file: 'js/bg-keep.js', needle: 'try { return !!(window.mochiDevice || {}).isIOS; } catch (e) {}' },
  { name: '#250 切桌面卡死·表情包全局键重复重读（chat.js 切换监听不再 myEmojiLoad+reloadMyEmojiFromIdb——my-emoji-groups 全局键切桌面不变，删此守卫则大表情库设备每次切换整包 JSON.parse×2+35MB idbGet 主线程卡死数秒）', file: 'js/chat.js', needle: "loadEmojiPref(); // v3.26.x：切换联系人后按该桌面的上次 tab/分组偏好落位，不复用上一桌面状态\nif (!emojiPanel.hidden) renderEmojiPanel();\n});" },
  { name: '#250 切桌面卡死·群聊切换按可见性重渲（group-chat.js 隐藏态挂起 gcSwitchDirty 不整窗重渲 200 条——删则重度群聊设备每次切换白耗主线程；成员名随联系人改名变化由 enterGroupChat 全量重建保证）', file: 'js/group-chat.js', needle: 'const pageVisible = page && !page.hidden;' },
  { name: '#250 切桌面卡死·卡片背景恒等跳过（personalize.js applyCardBg 值变才写——赋同值=浏览器作废已解码位图重新解码，MB 级 dataURL 真机切换瞬间整屏重解码）', file: 'js/personalize.js', needle: 'if (el.style.backgroundImage === next) return;' },
  { name: '#251 群聊对齐聊天设置·回车发送开关（keydown 读 cs-enter-send===\'off\' 放行换行——删则群聊回车强制发送，关不掉）', file: 'js/group-chat.js', needle: "if (window.activeStore().get('cs-enter-send') === 'off') return;" },
  { name: '#251 群聊对齐聊天设置·数据导出导入（导出流式拼接 Blob 防超长+导入兼容三结构确认覆盖——删则群聊记录无备份/恢复通道；#375 导出改令牌展开后 needle 随 const head 行更新）', file: 'js/group-chat.js', needle: "const head = '{\"app\":\"mochi-zika-group-chat\"" },
  { name: '#253 字卡导入全局崩溃修复·提取袋提升函数作用域（const bag 原声明在备份提取分支块内、函数尾部 #139 守卫读它必抛 ReferenceError=所有格式导入成功解析后必崩机型无关[华为Pro70+Edge 实证]；声明挪回分支块内此锚消失）', file: 'js/chatcard.js', needle: 'let bag = {}; // v3.26.x #253：从备份提取分支块内提升到函数作用域（仅备份分支填充，尾部 #139 守卫要读）' },
  { name: '#253 字卡导入全局崩溃修复·兜底标记提升函数作用域（fromPubFallback 同上提升，#139 专属页兜底置位语义不变）', file: 'js/chatcard.js', needle: 'let fromPubFallback = false; // v3.26.x #253：同上提升' },
  { name: '#254 音乐「去除VIP歌曲」改 meting 播放同源逐首探测（原 proxy.cors.sh 域名 DNS 已注销+allorigins 522=所有机型点击必失败；探测失败不计账绝不误删，与播放同依赖面不再有独立死点——判据锚随「可播/不可播」记账语义走）', file: 'js/music-player.js', needle: 'playable ? 0 : 1' },
  { name: '#255 room.js 装扮地板第二步 floorPick 补齐（函数整体缺失=装扮选墙纸确定必抛 ReferenceError「Can\'t find variable: floorPick」诊断实证；删地板弹窗此锚消失）', file: 'js/room.js', needle: 'function floorPick() {' },
  { name: '#255 iOS 键盘期弹窗顶对齐·开关（mobile-adapt 键盘会话 _kbActive/_iProv 给 #modal-mask 挂 modal-kb-dock——居中弹窗随 .phone 高度变化反复取中=打字输入框上滑；删则顶对齐失效）', file: 'js/mobile-adapt.js', needle: "mk.classList.toggle('modal-kb-dock'" },
  { name: '#255 iOS 键盘期弹窗顶对齐·CSS（mask 顶对齐 + 安全区上边距；删则 JS 挂类无效果）', file: 'css/base.css', needle: '.modal-mask.modal-kb-dock { align-items: flex-start; }' },
  { name: '#255 批量导入弹窗放大（opts.big 宽版 420px/94vw + textareaRows=14 给足 14 行起始高度、安卓 ce-box min-height rows*1.5*16，超 52vh 框内滚动——272px 窄弹窗用户报障「太小了/加长可滑动」；删则回退窄小框）', file: 'js/chatcard.js', needle: 'textareaRows: 14' },
  { name: '#257 整页「点不动」死点击逃生门·判定锚（同点 3 快击零 click=死点击，先做 click 活性复核防误报——删则健康页误触发复位/真死页缺判定依据）', file: 'js/mobile-adapt.js', needle: 'if (_escLastClickAt >= tapEndAt)' },
  { name: '#257 整页「点不动」诊断·触摸轨迹采集（与交互轨迹并排输出：触摸有 click 无=死点击实锤；key __diag-touch 跨重启随诊断回收）', file: 'js/device.js', needle: "'xy-home-v2:__diag-touch'" },
  { name: '#261 复制用的隐藏 textarea 复制完当场塌回零长选区（select() 的全选留给延迟 removeChild 变孤儿选区=安卓原生黑色【全选】浮条失去宿主、永久卡在桌面「今日情话」右边；删则浮条卡屏回流）', file: 'js/device.js', needle: 'ta.setSelectionRange(0, 0)' },
  { name: '#261 死选区回收·判定范围（只收脱离文档的选区 + 禁选桌面内的非编辑区选区——编辑区活选区必须放过，否则弹窗「手动全选复制」/输入框改字被误清；放宽即成新 bug）', file: 'js/mobile-adapt.js', needle: 'if (editable || !desk || !desk.contains(host)) return false;' },
  { name: '#261 死选区回收·事件接线（回收器定义了没人调=死代码；selectionchange 是内核自造选区当场收口的唯一入口，删则已卡住的浮条要等下次触摸才消）', file: 'js/mobile-adapt.js', needle: "document.addEventListener('selectionchange', reapSoon)" },
  { name: '#262 表情「内容为空」误报·判空前必过静态图门禁（canvas 只画得出动画图第一帧，而表情包 GIF 首帧常是全透明清屏帧＝正常动图被判坏图并误导去字卡库清理；去掉门禁此锚消失）', file: 'js/chat.js', needle: "if (!alphaCheckable(im.getAttribute('src') || '')) return;" },
  { name: '#262 表情「内容为空」误报·GIF 多帧门禁（≥2 个图形控制扩展 21 F9 04＝动图一律不判；放宽成不数帧则动图再度中招）', file: 'js/chat.js', needle: 'if (n >= 2) return false;' },
  { name: '#262 表情「内容为空」误报·APNG 门禁（acTL 块＝动画 PNG，canvas 同样只画首帧，一律不判）', file: 'js/chat.js', needle: "if (type === 'acTL') return false;" },
  { name: '#262 表情「内容为空」误报·只嗅探小文件（真空白图压完必然极小；超 96KB base64 直接放行＝大动图零 atob 成本，去掉上限则每条大表情都整包解码扫字节）', file: 'js/chat.js', needle: 'if (!b64.length || b64.length > EMPTY_SNIFF_MAX_B64) return false;' },
  { name: '#262 表情「内容为空」误报·二次采样确认（首采全 0 后隔 350ms 复采仍有画面＝引擎解码未就绪，撤销判定；去掉复采=iOS/未知内核时序差直接误报）', file: 'js/chat.js', needle: 'if (!alphaSampleEmpty(im)) return; // 复采有画面＝首采遇解码未就绪，撤销判定' },
  { name: '#260 保活双锚·WebRTC 回环数据通道（页内 RTCPeerConnection 对=页面生命周期与音频并列的冻结豁免信号；Edge/Chromium 152 收紧 audible 判定后单押音频失效=后台 1 分钟冻结，删此锚只剩音频单锚）', file: 'js/bg-keep.js', needle: "p1.createDataChannel('mochi-ka');" },
  { name: '#260 保活双锚·后台心跳节拍（隐藏期每 30s 写 IDB 计数/轨迹=冻结取证；device.js「保活现场」靠它出「心跳断流=页面被冻结」实锤，删则后台死活只剩用户口述）', file: 'js/bg-keep.js', needle: 'setInterval(kaHbTick, 30000);' },
  { name: '#260 保活诊断出口 __kaProbe（device.js「保活现场」的数据源，删则诊断行静默消失、保活现场无从取证）', file: 'js/bg-keep.js', needle: 'window.__kaProbe = function () {' },
  { name: '#260 诊断「保活现场」行消费 __kaProbe（开关/音频/媒体条/WebRTC/心跳断流判决一行直出，删则「后台保活失败」类报障继续靠口述猜）', file: 'js/device.js', needle: "window.__kaProbe === 'function'" },
  { name: '#263 取最长而非首个非空（多源并发比列表长度、同数取靠前者；退回「第一个非空源即收口」正是「只能导入 10 首」的根因）', file: 'js/music-player.js', needle: 'r.list.length > best.list.length' },
  { name: '#263 曲目数=10 是网易 detail tracks 首屏截断签名，见到就不收口、给慢源 1.5s 宽限（删则截断源抢收，62 首歌单回到 10 首）', file: 'js/music-player.js', needle: 'if (n !== NETEASE_TRACKS_TRUNC && !graceTimer) graceTimer = setTimeout(finish, 1500);' },
  { name: '#263 全量 meting 实例接入（按 trackIds 批量补歌曲详情的源——用户自建歌单只有它给全量；删掉这一路=又只剩首屏 10 首的实例）', file: 'js/music-player.js', needle: 'https://api.qijieya.cn/meting/?server=netease&type=playlist&id=' },
  { name: '#263 缺口如实记账（trackCount 全量数 − 实取数 = miss → toast「另有 N 首未取到，稍后重导可补齐」；删则只拿到首屏也报全量成功，用户无从知道漏了多少）', file: 'js/music-player.js', needle: 'const miss = Math.max(0, (totalKnown || 0) - tracks.length);' },
  { name: '#263 移动端「复制链接」歌单识别（分隔符类含 # 与 !——m/playlist#!?id=xxx 不再整张被当一首歌导入）', file: 'js/music-player.js', needle: 'line.match(/playlist[\\/?#&!\\s]*(?:id=)?(\\d+)/i)' },
  { name: '#263 各 meting 实例封面 URL 归一到 injahow 图片代理（#216 迁移链只认这个域名；不归一则列表实例代理 URL 成为新的第三方单点、实例挂了一起丢封面）', file: 'js/music-player.js', needle: 'cover: canonicalMetingPicUrl(t.pic),' },
  // ==== v3.26.x #264 跨桌面查岗/来电「开了好几天一次都没触发」====
  // 根因：未应答的 pending 永久留在 localStorage 队列 → hasPending 从此挡死该联系人一切跨桌面触发。
  // 每条 needle 都是「修复生效必然存在、逻辑被改必然消失」的表达式，名字留着实现改坏也能拦下。
  { name: '#264 孤儿 pending 自愈判据（跨会话 + 超存活上限才释放；去掉 sid 条件=本会话正显示的弹窗被抢答、去掉时限=用户还没看到就被清掉，两种都会把修复改成新 bug）', file: 'js/incoming-requests.js', needle: "x.sid !== SESSION_ID && now - (x.ts || 0) > PENDING_TTL_MS" },
  { name: '#264 投递记录会话归属（弹窗只活在投出它的页面会话里，没有 sid 就识别不出跨会话孤儿，自愈整块变死代码）', file: 'js/incoming-requests.js', needle: "req.sid = SESSION_ID;" },
  { name: '#264 活弹窗对账（遮罩在且标题仍是当初投出的那个才算还活着；去掉标题比对=别的弹窗顶掉它之后仍被认成活弹窗，pending 永不释放＝本 bug 回流）', file: 'js/incoming-requests.js', needle: "titleEl.textContent === liveModals[cid]" },
  { name: '#264 浮层互斥覆盖面（全站唯一弹窗 DOM + 查岗卡 + 问答门 + 通话面板四类；漏一个就是同轮互相顶掉留下孤儿 pending）', file: 'js/incoming-requests.js', needle: "'modal-mask', 'tc-mask', 'qa-mask', 'call-mask'" },
  { name: '#264 锁屏/打字期硬挡投递（应用锁问答门冷启动默认开，投进去只会压在锁底下；打字期抢焦点会丢掉 IME 组合中的字）', file: 'js/incoming-requests.js', needle: "if (!document.hidden && (hardLocked() || typingBusy())) return false;" },
  { name: '#264 浮层占用默认不投、force 才顶（去掉 force 参数=手动触发和逃逸额度一起失效，软互斥变成新的永不触发）', file: 'js/incoming-requests.js', needle: "if (!force && !document.hidden && layerBusy()) return false;" },
  { name: '#264 让路有上限后照投（长期占屏最多让 BUSY_ESCAPE 轮，之后重新计票继续投；删此锚=别的弹窗常驻时跨桌面触发永远归零）', file: 'js/incoming-requests.js', needle: "busyTicks = 0; escape = true;" },
  { name: '#264 逃逸额度一次性消费（投成功即收回；退回「整轮共用一个布尔」=逃逸那一轮同轮投出 2 个弹窗，后一个顶掉前一个又造孤儿）', file: 'js/incoming-requests.js', needle: "if (deliver({ cid: cid, kind: 'checkin', text: showText, q: q, ts: Date.now(), status: 'pending' }, escape)) escape = false;" },
  { name: '#264 首查提前到 12s（手机上「开一下看一眼就走」的短会话此前 30~90s 内一次都掷不到；改回大延迟=短会话用户继续零触发）', file: 'js/incoming-requests.js', needle: "setTimeout(startIncomingTick, 12000)" },
  { name: '#264 诊断「跨桌面来消息体检」行（轮询次数/闸门/档位/下次可掷/近期释放一行直出，删则「开了好久没触发」类报障继续靠口述猜）', file: 'js/device.js', needle: "ip.ticks + ' 次 闸门=' + ip.gate" },
  // ==== v3.32.x #265 桌面图标顺序「退出浏览器后还原初始布局」（小米13+Edge，内核无关）====
  // 根因：启动 IDB 补读块无条件写回，把「LS 比 IDB 新鲜」这条自家优先级反向覆盖了。
  { name: '#265 IDB 补读只填「现在读不到」的键（LS 有值即跳过；删掉这行守卫=启动补读又无条件覆盖更新鲜的 localStorage，Edge/真我/荣耀/小米等丢弃 fire-and-forget idbSet 的内核上「改完布局退出浏览器就还原」原样回流）', file: 'js/personalize.js', needle: 'if (store.get(rel) !== null) return;' },
  { name: '#265 补读前缀只取一次 activePrefix（filter 与 slice 共用同一个 iconPfx；改回两次调用=异步期间 correctCidFromIdb 纠正 cid 后，前缀与 slice 长度对不上，会把别的桌面的键名/键值搬进当前桌面，与 #151 同族串桌面）', file: 'js/personalize.js', needle: "const iconPfx = window.activePrefix() + ':';" },
  { name: '#265 mochi-restore-done 后重排图标顺序（导入/恢复回填完成时按权威值再排一次；删掉=备份导入后桌面仍是默认布局，直到下次重启才生效）', file: 'js/personalize.js', needle: 'try { restoreAppIconOrder(); } catch (e) {}' },
  { name: '#265 切换联系人时重排图标顺序（app-icon-order-<grid> 是 per-cid 键；漏监听=切桌面后仍显示上一个联系人的排序，与 hidden-icons 的 #151 处理成对）', file: 'js/personalize.js', needle: "document.addEventListener('contact-switched', restoreAppIconOrder);" },
  { name: '#265 补读完成后图标图片与顺序一起重绘（Promise.all 落地同调两个 restore；只留 restoreAppIcons=补读到的顺序永远等不到重排，本次修复的核心断言 T1/T2 回流）', file: 'js/personalize.js', needle: 'restoreAppIcons(); restoreAppIconOrder(); }' },
  // ==== v3.32.x #266 字卡库列表页兜底取回 IIFE「漏调用括号」死代码（iOS13+Chrome/Edge 等「导入字卡过一段时间就没了，刷新就消失」，多机型同族）====
  // 根因：f143621 把本段结尾 `})();` 改成 `});` —— 语法合法、node --check 过、文本锚点也在，
  // 但整段 IIFE 变永不执行的死代码。iOS 启动回填被后台杀连接打断后，内存/LS 两路读空、只剩
  // IndexedDB 有权威数据，唯一会按用户查看时点把库拉回来的防线（hidden 观察者）就此断掉 =
  // 字卡库读出空 = 「没了」。修复 = 恢复 `})();` 立即调用。needle 取「observe 调用 + 结尾调用括号」，
  // 只保留注释/名字不改括号，反照样能抓到。
  { name: '#266 字卡库列表页兜底取回 IIFE 必须立即调用（结尾 `})();`；漏调用括号=语法合法但整段死代码=iOS 回填被打断后字卡库永久空载「刷新字卡消失」，多机型同族）', file: 'js/chatcard.js', needle: "observe(libPage, { attributes: true, attributeFilter: ['hidden'] });\n}\n})();" },
  // ==== v3.32.x #267 安卓「平移型键盘内核」停靠与卡死（荣耀 X50 自带浏览器，多机型同族）====
  // 根因两处：浏览器为露焦点的平移量在归零前被丢弃 → 保底停靠只能盲猜 58%（IME 更高时
  // 输入栏整行仍在键盘下）；主链路接管不清 _aProv → _aKb+_aProv 并存把四条复原路全堵死。
  { name: '#267 实测平移记档（_aPinPan 归零前把平移量存进 _aPanSeen；删掉=保底停靠回盲猜 58%，荣耀 X50 等平移型内核输入栏整行仍在键盘下看不见打不出）', file: 'js/mobile-adapt.js', needle: 'if (_panPx > 8) {' },
  { name: '#267 停靠有实测按实测（_aProvDock 采信 ≥80px 且 1.5s 内新鲜的平移量；改回恒 58%=IME 高于 42% 的机型整行被盖、矮于 42% 的机型多缩出空白，X5/旧夸克无实测仍走 58% 不受影响）', file: 'js/mobile-adapt.js', needle: '_aPanSeen >= 80 && Date.now() - _aPanSeenAt < 1500' },
  { name: '#267 主链路接管即清推顶（open 分支补 _aProvClear；缺它则 _aKb 与 _aProv 并存，看门狗与 #209 清扫全被挡住 → 键盘期内联收缩高永久残留＝输入栏下方一整块空白）', file: 'js/mobile-adapt.js', needle: 'kbDockPanels(); _aProvClear(); }' },
  { name: '#267 卡死停靠自愈·视口侧（_aKb 真而 vv+inner 双回基准且活焦点不在文本框即复原；删掉=收键盘不再派 resize 的内核（荣耀自带浏览器族）无人复检，停靠锁死在键盘数值）', file: 'js/mobile-adapt.js', needle: 'if (_vN > 0 && _vN >= _aH - 12 && _iN >= _aIH - 12 && !_aIsText(document.activeElement)) {' },
  { name: '#267 卡死停靠自愈·焦点侧（软键盘必依附焦点：kb/prov 任一在顶 + 活焦点不在文本框 + 静默 2.2s + vv 读数已稳 → 复原并按需置 #236 残留闩；缺它则 vv 读数滞留收缩值时四条复原路全断）', file: 'js/mobile-adapt.js', needle: 'if ((_aKb || _aProv) && !_aIsText(document.activeElement) && Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200) {' },
  { name: '#267 安卓键盘探针导出实测平移（panSeen/panSeenAgo 进 __mochiAndroidKb；缺则「点开键盘没有输入框」类报障拿不到键盘高度证据，只能靠口述猜机型）', file: 'js/mobile-adapt.js', needle: 'panSeen: Math.round(_aPanSeen)' },
  { name: '#267 诊断算焦点框是否被键盘挡住（mochiVvDiag().focusCovered + 诊断行「焦点框被挡」；缺则遮挡类与空白类两种病在一份诊断里分不开）', file: 'js/device.js', needle: 'out.focusCovered = ar.bottom > (vv.offsetTop || 0) + vv.height + 2 ? 1 : 0;' },
  // ==== v3.32.x 多人决定「自定义选项」选项输入框高度上限（安卓转 ce-box 后 gd-opts 随内容无限增高）====
  // 根因：#chat-gdecision-body 的 gd-opts 漏了 #chat-decision-body dec-opts 同款「max-height + 框内滚动」，
  // 安卓 contenteditable .ce-box 随输入行数无限增高，把下方控件顶出屏且整列无法上划=「一直跳且拉不上去」。
  { name: '多人决定「自定义选项」gd-opts ce-box 限高+框内滚动（同帮我决定 dec-opts 修法；删掉=安卓选项框无限增高顶出控件；#295 收口时该行并成单行，needle 随代码形态同步）', file: 'css/chat-main.css', needle: '#chat-gdecision-body .dec-inp-wrap .ce-box[data-for="gd-opts"] { max-height:176px;' },
  // ==== v3.26.x #270 开屏问答门改为「固定 2 道题、不可被别人编辑」（原 v3.31.x 提供增删改题目入口）====
  // 根因：题目可被编辑=设密码/暗号的管理验证由「防顺手」退化为「可被持暗号者改动」，违背
  // 「开屏问答门是固定 2 个问题」的定案。移除增删改 UI/逻辑（qalist 面板、onQal、qaEditItem、
  // data-qal 按钮、正文的「编辑问答题」入口），qaList 恒返回 DEFAULT_QA、不再读任何已存储的自定义列表。
  { name: '#270 开屏问答门恒返回固定 2 题（qaList 去掉「先读已存自定义列表、有则用之」分支、直接 mapped DEFAULT_QA；回改=又读旧版本存的编辑列表=「固定 2 题」被已改过的历史数据顶替）', file: 'js/applock.js', needle: 'return DEFAULT_QA.map(function (it) { return { q: it.q, h: h53(String(it.a).trim()) }; });' },
  { name: '#270 开屏问答门无编辑入口（data-qal 增删改按钮整套移除；若 data-qal 出现在产物=编辑面板被重新引入、与「不可编辑」定案冲突）', file: 'js/applock.js', needle: 'data-qal', absent: true },
  // ==== v3.33.x #271 应用锁·设安全问答完成后面板滞留「点完成无反应」====
  // 根因：askQaSetup 答案屏的 onSubmit 只调 done(q,a)（save+toast）、不清遮罩，
  // 面板一直滞留在此屏，用户看不到已保存、以为点了完成没反应。
  { name: '#271 设安全问答完成即关闭面板（askQaSetup 答案屏 onSubmit 补「置空+隐藏遮罩」；删则完成后面板又滞留=「点完成无反应」回流）', file: 'js/applock.js', needle: 'if (done) done(q, a);' },
  // ==== 应用锁·刷新后锁被误关「门户大开」====
  // 根因：evalLock 里 `if (enabled() && !pinHash()) setEn(false)` 同步自愈——安卓「数据主要
  // 在 IndexedDB、localStorage 仅快照」下刷新首帧 applock-pin 常还没回填（LS 只有 en='1'），
  // 首帧就把锁置 0=锁被误关、门户大开（用户反馈「刷新后应用锁被关了，开关也变关」）。
  // 修复：改为 selfHealChecked 先异步查 IDB——IDB 有密码就回填本机并继续锁屏，只有双端都确认
  // 无密码才自愈关锁（防锁死初衷保留）。needle 用「IDB 有密码→回填→重评估锁屏」逻辑锚。
  { name: '应用锁自愈加固（IDB 有密码先回填不放关锁，防「刷新后锁被误关」回流；删则改回同步置 0=又门户大开）', file: 'js/applock.js', needle: 'gSet(K_PIN, v); evalLock();' },
  // ==== #280 机主逃生通道：忘密码且未设安全问题时可输暗号直接关闭应用锁 ====
  // 用户反馈「我只是要可以自己设置关闭锁屏」：原「无法重置/无法用问答重置」面板是死胡同
  // （提示只能清数据），机主忘密码又没设问答时自己关不掉锁。补 ownerDisableByCode 暗号逃生。
  { name: '#280 应用锁机主暗号逃生（未设安全问题忘密码时输暗号直接关锁；删则死胡同回流=机主自己关不掉锁）', file: 'js/applock.js', needle: '=== QA_SKIP_CODE) { setEn(false); sessMark();' },
  // ==== #277 iPhone17/Safari(WebKit26.6) standalone「底部白带+导航栏悬空」＝env 探针缓存中毒永不自愈 ====
  // 根因：syncVvFit 的 env(safe-area-inset-top) 探针缓存只在旋转时失效——独立应用切后台/
  // 回前台 WebKit 会改写顶部安全区形态，冷启动早帧探到 0 被永久缓存，稳定后实为覆盖形态
  // env=62：expBase 少算 env 段 → --mochi-ios-h 卡 894、.phone 底部 62px 白带/tabbar 悬空，
  // 且 1s 常驻自愈每次按同值「确认」坏态永不自愈（错误环 9/8~9/10 反复采集同一签名）。
  // 修复：矛盾信号（screen−inner≥20 而缓存=0 或与缺口差>8）节流 5s 重探；真已避让形态
  // 探回同值零行为变化。needle 是矛盾判定表达式本体，删/改条件即断。
  { name: '#277 env 缓存矛盾自愈（standalone 顶部缺段与缓存不符即 5s 节流重探，防「底部白带/tabbar 悬空」随切后台回流；删则 stale envTop=0 永久中毒）', file: 'js/mobile-adapt.js', needle: '(_envTopCache === 0 || Math.abs(_envTopCache - _diff0) > 8)' },
  // ==== #278 华为畅享70Pro/Chrome150 等多安卓机型「底部超出/导航栏被裁 diff≈-535」误报错误环 ====
  // screen.height 报数坏值（796 < 实际 inner 1331，物理不可能＝坏值）：旧式
  // min(screenH, envTop+innerH) 取到 796 → .phone 贴 inner 正常铺满被误判底部超出
  // 535px（自动采集刷错误环，多机型复发）。修复：min 钳制加 screenH≥innerH 门，
  // 坏值弃用回退 envTop+innerH；正常机型 min 语义不变零回归。needle 是门表达式
  // 本体（两个分支各一处），删/改条件即断。
  { name: '#278 坏 screenH 门（screenH<innerH 不作期望底边钳制，防「底部超出 diff=-535」误报环；删则坏值又钳到 796）', file: 'js/device.js', needle: 'Math.min((screenH >= innerH ? screenH : 0) || (envTop + innerH), envTop + innerH)' },
  // ==== 2026-09-10 #281 刷新黑屏卡顿收口②（华为畅享20Pro+Edge 等多机型）：my-emoji-groups 启动「就绪后再延迟取回」+ 防盲写闸门加固 ====
  // 根因：chat.js 脚本求值即 idbGet(17~35MB 级 my-emoji-groups)+主线程 JSON.parse 整包，
  // 秒级长任务压在开屏/首屏渲染关键窗口（#250 切桌面已同口径治理，启动路径漏了）。
  // 延迟到 mochi-restore-done 后 4s；面板打开本就现读权威（#172 主链）；保存闸门同步扩为
  // 「未应用过权威值(__myeIdbApplied) 或 仍在挂起名单」防延迟窗口盲写覆盖 IDB 全量。
  { name: '#281 my-emoji 启动取回延迟（mochi-restore-done 后 4s 才整包读+解析；改回脚本求值即取回=大库机刷新首屏再吃秒级长任务）', file: 'js/chat.js', needle: "document.addEventListener('mochi-restore-done', function () { setTimeout(tryRestore, 4000); });" },
  // ==== #282 荣耀90GT+Edge150 等多机型「[屏幕适配] 底部少填 277px」键盘停靠误报错误环 ====
  // resizes-visual 下键盘只缩可视视口（vv 633→356）、inner 不动，.phone 按设计停靠
  // 到 356；诊断 ④/⑤b 只对照 inner 期望底 → 输入框一失焦自动采集即误报「少填/悬空」。
  // 修复：④/⑤b 加深收缩豁免——vv 缩幅 ≥ inner×22%（#236 已验证键盘下限，真键盘缩幅
  // 均 >200px）判键盘停靠期不判底；#236 壳残留带（<22%）仍照常上报，真残留不掩盖。
  { name: '#282 键盘停靠豁免（vv 缩幅≥inner×22% 时 ④/⑤b 不判底，防「底部少填」误报环；删则 resizes-visual 停靠期每失焦即刷错误环）', file: 'js/device.js', needle: '_kbShrink >= Math.round(inp.innerH * 0.22)' },
  { name: '#281 防盲写闸门扩口径（未应用过 IDB 权威值也禁盲写，防延迟窗口保存把空/小包顶掉 IDB 全量=我的表情包全丢复发）', file: 'js/chat.js', needle: 'window.__myeIdbApplied !== true' },
  // ==== 2026-09-10 #275 媒体池×备份链路腐蚀（多机型反复「图片丢失/@@m:404」传播链收口）====
  // 根因：「只备份文字」strip 导出只剥 data: 前缀载荷——消息里的 @@m: 令牌不匹配被原样保留，
  // 媒体池键值却被剥成空串。导入后池里全是空串影子条目：渲染端 typeof 放行 → map 缓存 '' +
  // img.src=''（解析成页面 URL）＝永久坏图+占位误报「网络不通」；且空串条目 ≤20KB 走小键段，
  // 随今后每次完整备份继续传给对方设备＝跨机型反复。池真缺失时令牌 src 被当相对路径打网络
  // 必 404，还把「资源加载失败」错误环刷满（OPPO Reno16 诊断 20 条错误全是它）。
  // 修复四道：①文字模式导出整键跳过池条目（读值前 skip）②导出小键段同样认范围外键
  // ③导入端把空串/非 data: 脏池条目丢弃（键保持缺席→准确占位；合法池值不动）
  // ④渲染端池值体检（空串/脏值绝不入 map、绝不改写 src；不入负缓存＝日后导入完整备份自愈）
  // ⑤device.js 错误记录器对未解析令牌 404 静默（getAttribute 原始值判令牌）。
  { name: '#275 文字模式媒体池整键跳过（skip 在读值前生效，strip 绝不剥值留键=空池坏图传播）', file: 'js/data-backup.js', needle: 'MUSIC_KEY_RE.test(k) || MEDIA_POOL_KEY_RE.test(k)' },
  { name: '#275 导出小键段同样认范围外键（≤20KB 池条目不进 ls 段防被 strip 成空串入库）', file: 'js/data-backup.js', needle: 'if (cfg.skip(k)) continue;' },
  { name: '#275 导入端旧备份池腐蚀自愈（空串/非 data: 池条目直接丢弃=键保持缺席走准确占位，完整备份再导入即自愈）', file: 'js/data-backup.js', needle: 'function scrubMediaPool(obj) {' },
  { name: '#275 渲染端池值体检（空串/脏值绝不入 map 缓存也不改写 img.src——原 typeof 放行空串=map 缓存\'\'+src=\'\'永久坏图；不入负缓存，缺数据可重试。#943 起形态判定统一走 mediaPayloadKind，锚点随新写法、逻辑未变）', file: 'js/media-pool.js', needle: "mediaPayloadKind(v2) !== 'image'" },
  { name: '#275 未解析媒体池令牌 404 不进错误日志（getAttribute 原始值判令牌；池缺失+渲染占位已是预期失败路径，逐次渲染刷屏掩盖真错误）', file: 'js/device.js', needle: 'window.mochiMediaIsToken(imTok)' },
  // ==== 2026-09-10 #283 聊天语音令牌化（vivo S60/Chrome 25fps「经常卡、按不动」等多机型收口）====
  // 根因：#142 池 v1 只收 data:image/——历史语音/语音字卡以「名称|||data:audio;base64…」整份
  // 内联在消息 text（语音内容唯一，去重对总库无效，但令牌化后每次落盘只 clone 44 字符引用）。
  // 本机诊断：IDB chat-msgs=79.2MB/2277 条、JS 堆 307MB、长任务 50~405ms（隐藏冲刷+空闲落盘
  // 每次都 structured clone 整包）＝发消息/收键盘/离页回前台全在卡。音频纪律：不进 map 热缓存、
  // 播放走 ExpandAsync 按需 idbGet、迁移期每 32 条分批冲池（writeBuf/单事务封顶+回滚账除名）。
  { name: '#283 池收音频（tokenize 放行 data:audio/；回退只收图片=语音继续整份内联、低端机落盘长任务复发。#943 起闸门统一走 mediaPayloadKind，锚点随新写法、逻辑只强不弱）', file: 'js/media-pool.js', needle: 'if (!mediaPayloadKind(payload)) { resolve(null); return; }' },
  { name: '#283 语音令牌化（normalize pass 处理「名称|||data:audio/」内联语音；删则 chat-msgs 几十 MB 每次落盘 clone 整包回归。#943 起判定收口 chatIsInlineDataSrc＋载荷 trim 规范入池，锚点随新写法、逻辑未变）', file: 'js/chat.js', needle: "const _tailData = _bar > 0 && chatIsInlineDataSrc(_tail.trim()) ? _tail.trim() : '';" },
  { name: '#283 语音播放异步取回（令牌先 ExpandAsync 取池数据再播；删则令牌语音点按「播放失败」）', file: 'js/chat.js', needle: 'window.mochiMediaExpandAsync(v.src, function (data) {' },
  { name: '#283 迁移期分批冲池（每 32 条 flush 封顶 writeBuf/单事务并清回滚账；删则几十 MB 单事务+回滚账常驻=迁移会话堆尖峰）', file: 'js/chat.js', needle: 'const _okMid = await window.mochiMediaFlush();' },
  { name: '#283 冷启动收敛触发（读库成功后 12s 跑 pass；删则只依赖 restore 事件/切桌面——不切桌面的设备历史语音永不被收口）', file: 'js/chat.js', needle: 'scheduleMediaPass(12000)' },
  { name: '#283 收藏语音识别加令牌形态（名称|||@@m:hash 不识别则收藏语音直出令牌串且不可播）', file: 'js/chat.js', needle: '@@m:[0-9a-f]{32}$/.test(f.text)' },
  // ==== #284 vivo X200s+Edge150「BodyStreamBuffer was aborted」×10/×11 刷错误环：cancel() 拒绝安全 ====
  { name: '#284 cancel() 拒绝安全（mochiSafeCancelBody 挂空 catch；删则弱网 abort 时 BodyStreamBuffer 拒绝继续裸奔刷错误环）', file: 'js/music-player.js', needle: "if (p && typeof p.catch === 'function') p.catch(function () {});" },
  // ==== 2026-09-11 #287 群聊点头像拍一拍（用户报「群聊里无法点击联系人头像拍一拍」＝单聊有、群聊从未实现）====
  { name: '#287 成员消息头像点击开拍一拍面板（renderMsg 头像绑定；删/改绑定则点头像无反应回退功能缺口）', file: 'js/group-chat.js', needle: 'gcOpenPokeCard(rec.cid)' },
  // ==== 2026-09-11 #288 群聊美化视图卡片化重设计（用户报「美化设置不完整、和聊天里的不一样」＝纯文字行 vs 聊天设置图标卡片页）====
  { name: '#288 美化视图 set-row 图标行构建（set-row+gc-set-row 双类；回退纯文字 beautyRow 行则该锚点消失）', file: 'js/group-chat.js', needle: "'set-row gc-set-row'" },
  // ==== 2026-09-11 #289 摸鱼打卡刷新后要求重打（按钮状态只在回填完成前读一次，LS 写失败/IDB 为主机型每次刷新都显示未打卡）====
  { name: '#289 打卡按钮状态随回填完成/写日志自愈事件重同步（删监听则 LS 缺失机型刷新后永远显示未打卡、需重打）', file: 'js/personalize.js', needle: "document.addEventListener('mochi-restore-done', function () { try { syncCheckinBtn(); updateFishDays(); } catch (e) {} });" },
  { name: '#290 摸鱼天数回填后再合并+规范化自愈（删监听则各桌面旧副本迟到永远漏算、重复/脏值虚高不修）', file: 'js/personalize.js', needle: "document.addEventListener('mochi-restore-done', fishLogHeal);" },
  // ==== 2026-09-17 #644 数据丢失后手动修改「已摸鱼天数」（设置 → 工具 #row-fish-days）====
  { name: '#644 修改摸鱼天数·修正结果写回全局 fish-log（天数=去重日期数；删则弹窗确定后不保存，重开归零）', file: 'js/personalize.js', needle: "gStore.set('fish-log', JSON.stringify(out));" },
  // ==== 2026-09-11 #291 经期桌面卡文字重叠（OPPO Reno6+雨见/Firefox152：160px 卡内 dpd-inner 绝对居中无底部预留，Gecko 默认行高更高，dpd-sub 与绝对定位 dpd-bar-cap 几何重叠；Chrome 擦边幸免故仅部分浏览器现形）====
  { name: '#291 经期卡防重叠·dpd-inner 底部预留 26px（删则 Gecko 行高下副标题与进度条说明叠字复发）', file: 'css/home.css', needle: 'padding-bottom:26px' },
  // ==== 2026-09-11 #292 问问ta批量导入单选题（【】为问题、其后每行一个选项）+ 问卷答题结束时间（过点不发新问、不能再作答）====
  { name: '#292 批量导入单选题解析·【问题】+选项行（删则退回一行一题、单选格式整行丢失）', file: 'js/ta-ask.js', needle: "if (cur.opts.length >= 2) { q.type = 'single'; q.options = cur.opts.slice(); singles++; }" },
  { name: '#292 问卷答题结束时间·作答统一闸门（chatAskReply 包装层删拦截则过点后仍可作答）', file: 'js/ta-ask.js', needle: "if (askDeadlinePassed(taAskLoad())) { toast('已过问卷答题结束时间，不能再作答'); return undefined; }" },
  // ==== 2026-09-11 #293 后台来电挂起回前台不响铃（resumeHeldCall 原要求 h.cid===当前桌面——跨桌面来电/冷启动 cid 未校正时判不成立，静默补未接＝点开通知永远接不到）====
  { name: '#293 跨桌面挂起重响·先切归属联系人桌面再响铃（删切换分支则回到非归属桌面永远直接判未接）', file: 'js/call.js', needle: "known = window.getContacts().some(c => c && c.id === h.cid);" },
  // ==== 2026-09-11 #294 后台通知右侧头像全黑（makeAvatarThumb canvas 直接导出 JPEG——JPEG 无透明通道，带透明区域头像的透明像素落成黑块）====
  { name: '#294 头像缩略 canvas 先铺白底再绘制（删 fillRect 则透明头像缩略图透明区变黑＝通知全黑方块复发）', file: 'js/bg-keep.js', needle: "ctx.fillStyle = '#ffffff';" },
  // ==== 2026-09-11 #295 帮我决定/群聊决定自定义选项·键盘弹出期整卡无法上滑（ce-box 的 overscroll-behavior:contain 连「框内无内容可滚」的滚动链也拦断，手指在聚焦的选项框上起滑时外层 .poke-card-scroll 收不到手势；contain→auto：框内溢出仍框内滚，边界放行给面板）====
  { name: '#295 决定面板 dec-opts 选项框滚动链放行·contain→auto（改回 contain 则键盘期手指在选项框上滑动整卡无法上滑复发）', file: 'css/chat-main.css', needle: 'data-for="dec-opts"] { max-height:176px; overflow-y:auto; overscroll-behavior:auto; }' },
  { name: '#295 决定面板 gd-opts 选项框滚动链放行·contain→auto（改回 contain 则键盘期手指在选项框上滑动整卡无法上滑复发）', file: 'css/chat-main.css', needle: 'data-for="gd-opts"] { max-height:176px; overflow-y:auto; overscroll-behavior:auto; }' },
  // ==== 2026-09-11 #296 回复设置补「联系人主动写信/主动发朋友圈」总开关（写信概率 prob() 把 0 兜底回默认 30＝无法用概率关闭；开关裸读 + 触发链首行闸门）====
  { name: '#296 联系人主动写信总开关闸门·mailCfg 裸读 writeEn + maybeIncomingLetterFor 拦截（删则关开关后 TA 仍按概率来信）', file: 'js/mail.js', needle: 'if (!cfg.writeEn) return;' },
  { name: '#296 联系人主动发朋友圈总开关闸门·feedCfgFor postEn + maybeAutoPostFor 拦截（删则关开关后 TA 仍按概率发动态）', file: 'js/feed.js', needle: 'if (!cfg.postEn) return;' },
  // ==== 2026-09-11 #298 词典拼字（语录抽句+词典切词逐词连发；数据=DEFAULT_CARD_DATA.dict「词典」分类，设置=回复设置「词典拼字」组）====
  { name: '#298 词典拼字抽句门·qs-en/qs-prob/qs-cc 三键生效（删则开关概率失效，拼字永不触发）', file: 'js/quote-spell.js', needle: "if (!c || c['qs-en'] !== 1) return null;" },
  { name: '#298 词典拼字接线·replyOnce 抽句门+逐词连发（删则开关存在但永不生效）', file: 'js/chat.js', needle: '(window.quoteSpellPick && window.quoteSpellPick(c))' },
  // ==== 2026-09-11 #310 词典拼字单气泡形态 + 普通字卡截断修复（qs-one 50% 混合单气泡/逐词；qs-cc 默认关防普通字卡被抽去拼字）====
  { name: '#310 单气泡拼字形态·chat.js 空格连卡+「词典拼字」tag（删则 qs-one 开了也只有逐词连发、无单气泡形态）', file: 'js/chat.js', needle: "if (rep.spell && rep.spellOne) {\nm = addIn(rep.spell.join(' '), {" },
  // #323 双形态选择哨兵已被 #370 收编（50/50 掷币改为 80/20 单气泡为主，见下方 #370 两条）
  { name: '#330 逐卡连发受回复条数最多上限·完整字卡连发≤reply-max（删则完整字卡一次刷 5 条＝超出联系人回复条数设置）', file: 'js/quote-spell.js', needle: 'if (want > rmax) want = rmax;' },
  { name: '#351a 逐卡连发不受条数限制·qs-noLimit 默认开（删则逐卡被 reply-max 收口＝默认玩法被限流；仅显式 0 才收口）', file: 'js/quote-spell.js', needle: "if (!one && c['qs-noLimit'] === 0) {" },
  { name: '#351b 撤回补发总开关·rc-en 闸门（删则关开关后撤回仍补发＝开关失效）', file: 'js/chat.js', needle: "if (c['rc-en'] !== 0 && hit(c['rc-refix'])) {" },
  // #310 旧默认 1→0 迁移已被 #388 反向取代（qs-cc 默认改回 1、存量迁移 0→1 标记升 2，见下方 #388 两条）——哨兵锚点同步更新
  { name: '#388 qs-cc 存量反向迁移写值 0→1（删则被 #310 迁移成 0 的桌面回不到默认开＝用户点名需求回退）', file: 'js/reply-settings.js', needle: "s.set('reply-qs-cc', '1'); changed = true; }" },
  { name: '#350 逐卡连发每条气泡挂「词典逐卡连发」tag（删则逐卡与单气泡 tag 不可区分＝用户点名的新 tag 丢失；2026-09-16 换锚：原 needle 捎带的 silent 行被撤回概率 willRetractR 合法演进，锚收到现存 tag 行）', file: 'js/chat.js', needle: "tag: '词典逐卡连发'," },
  // ==== 2026-09-11 #317 梦角自由造句（梦角语料抽卡→截断几字重造句→入库自定义字卡「梦角自由造句」分类）====
  { name: '#317 梦角自由造句抽句门·mjf-en/mjf-prob 生效（删则开关概率失效，梦角永不造句）', file: 'js/dream-free.js', needle: "if (!c || c['mjf-en'] !== 1) return null;" },
  { name: '#327 撤回式截断·词间隙切尾前缀成新句（删则造句变回随机截补＝句子离奇，用户明确否决）', file: 'js/dream-free.js', needle: "const out = toks.slice(0, gi).join('').replace(/[，、,\\s]+$/, '');" },
  { name: '#329/#414 造句手法三选一·mjf-style 语气词式/撤回式/换字卡内容式（删则手法选择失效＝三模式不可切，回退固定撤回式；#414 改 let 供混合模式重掷）', file: 'js/dream-free.js', needle: "let style = Math.max(0, Math.min(2, Number(c['mjf-style']) || 1));" },
  { name: '#326 词边界来源·内置词典正向最大匹配切词（删则插入点随机＝可能截在词中间出病句）', file: 'js/dream-free.js', needle: 'if (dict.has(str.slice(i, i + L))) { len = L; break; }' },
  { name: '#317/324 造句入库·ccAppendCards 双作用域写 mjfree 分类（删则新句不进「梦角自由造句」字卡分类；#324 加 scope 分库参数）', file: 'js/chatcard.js', needle: "window.ccAppendCards = function (type, group, cards, scope) {" },
  // ==== 2026-09-16 #622「其他互动功能字卡」角标误计梦角自由造句（用户报「梦角自由造句的点数显示在其他功能字卡里」）：#353 起 mjfree 只在【可自定义字卡】公用/专属入口显示、功能入口 tab 已隐藏，但角标仍按 CC_FUNC_KEYS 全量计数 ====
  { name: '#622a 功能字卡角标键剔除 mjfree（删/改回 CC_FUNC_KEYS＝梦角自由造句的点数又跑进「其他互动功能字卡」角标，用户报障复发）', file: 'js/chatcard.js', needle: "const CC_FUN_COUNT_KEYS = CC_FUNC_KEYS.filter(k => k !== 'mjfree');" },
  { name: '#622b 专属功能字卡角标计数走剔除后的键（定义在、计数却用回 CC_FUNC_KEYS 则 #622a 形同虚设）', file: 'js/chatcard.js', needle: 'if (libCounts.fun < 0) libCounts.fun = countOfKeys(og, CC_FUN_COUNT_KEYS);' },
  { name: '#324/#364/#622 造句分库·dreamFreeSave 一律按 mjf-pub 概率分库（2026-09-16 #622 去掉「仅多联系人生效」门：改回 cids>1 条件＝单联系人又被锁死 100% 专属、用户点名的「100% 归公用 / 80-20 分流」落空）', file: 'js/dream-free.js', needle: 'const usePublic = Math.random() * 100 < pubProb;' },
  { name: '#317 replyOnce 接线·dreamFreePick 命中替换回复+入库（删则开关存在但永不生效）', file: 'js/chat.js', needle: 'window.dreamFreePick && window.dreamFreePick(c)' },
  { name: '#301 词典自建词条并入词典分类（删则自建语录/词不再进词典 tab 与拼字引擎）', file: 'js/default-cards.js', needle: "const gw = base.find(g => g[0].indexOf('词库') === 0)" },
  // ==== 2026-09-11 #306 小游戏 UI 收口（连连看/消消乐棋盘 gap 溢出截断、头部标题被挤竖排、拍卖会「不拍了」白字白底隐形）+ 全部小游戏通用全屏 .game-fs ====
  { name: '#306 连连看 fitBoard 扣除 grid gap 再取整（删则牌面总宽多出 (cols-1)*3px 溢出右缘、最右列被截断）', file: 'js/linkup.js', needle: 'Math.floor((w - (st.cols - 1) * GAP) / st.cols)' },
  // ==== 2026-09-15 #487/#488 连连看（用户报「TA 回合连上了却弹『没连上』」「10×6 全屏不放大反而图案显小」；原编 #482/#483 撞号改）====
  { name: '#487 连连看 TA wild 点错：台词只指本次尝试、隔 700ms 经 thinkT 才落子（删则台词与成功连线同帧＝「连上了却弹连不上」回流）', file: 'js/linkup.js', needle: 'if (s !== st || st.over || st.lock || st.turn !== 2) return;' },
  { name: '#488 连连看全屏放大：.game-fs 时高度参与取格、上限 46→72（删则全屏只按宽度压小牌面、纵向空间浪费；needle 因 #489 下限改 floor24 同批同步）', file: 'js/linkup.js', needle: 'Math.max(floor24, Math.min(72, byW' },
  { name: '#488 连连看真全屏 stage 吃满高度（删则全屏棋盘贴顶、下方大片留白退回）', file: 'css/chat-pages.css', needle: '#chat-linkup-panel.game-fs .lk-stage { flex:1; min-height:0; }' },
  // ==== 2026-09-15 #489 连连看 新增王者 12×7 / 传奇 12×8（主题扩 24 款；12 列窄屏按实宽收格防溢出）====
  { name: '#489 连连看 王者/传奇 大棋盘档位（删则难度下拉回退三档、84/96 张局消失）', file: 'js/linkup.js', needle: "legend: { rows: 8, cols: 12, kinds: 24, pairPerKind: 2, label: '🏆 传奇 12×8', coin: 33440 }" },
  { name: '#489 连连看 12 列以上窄屏按实宽收格（删则半框 24px 下限把总宽顶溢出右缘）', file: 'js/linkup.js', needle: 'const floor24 = Math.min(24, byW);' },
  { name: '#306 消消乐 fitBoard 扣除 grid gap 再取整（同连连看，删则第 8 列被裁）', file: 'js/match3.js', needle: 'Math.floor((w - (N - 1) * GAP) / N)' },
  // ==== 2026-09-12 #340 消消乐动画（用户报「没有真消消乐动画很突兀」）：棋子层+transform 合成器过渡，交换滑动/消除爆开/按距离下落 ====
  { name: '#340 消消乐消除爆开动画 keyframes（删则消除无爆开、退回瞬间消失）', file: 'css/chat-pages.css', needle: '@keyframes m3-popout' },
  { name: '#340 消消乐结算动画循环按距离等待（删则下落不等待、整盘退回瞬跳重绘）', file: 'js/match3.js', needle: 'animMs(FALL_MS)' },
  { name: '#306 半框头部标题禁止压缩换行（删则控件多的面板标题被挤成一字一行竖排）', file: 'css/chat-main.css', needle: '.poke-card-head > span { white-space:nowrap; }' },
  { name: '#306 拍卖会「不拍了」举牌行内可见样式（删则半透明白底+白字在白卡上完全隐形＝按钮像消失）', file: 'css/chat-pages.css', needle: '.au-bids .pong-overlay-btn2 { background:rgba(0,0,0,.07); color:var(--ink,#222); }' },
  { name: '#306 小游戏共享全屏容器 .game-fs（fixed 满视口 + iOS 高度修复同款表达式，删则全屏按钮失效。2026-09-19 #853 换锚：dvh 行收进 @supports 老内核防作废）', file: 'css/chat-pages.css', needle: '@supports (height: 100dvh) { .poke-card.game-fs { height:min(var(--mochi-ios-h, 100dvh), 100dvh); } }' },
  { name: '#306 全屏切换接线·面板 toggle game-fs + 图标 ⛶/⤢（gomoku 代表登记，删则按钮点了没反应）', file: 'js/gomoku.js', needle: "panel.classList.toggle('game-fs', isFs)" },
  // ==== 2026-09-11 #309 连连看/消消乐未开局舞台最小高度（空棋盘 stage 高 0 → 「开始对局」覆盖层压成一条横线＝用户报「面板只有一条横线、打不开」）====
  { name: '#309 连连看未开局舞台 min-height（删则空棋盘高度 0，开始覆盖层压成横线、面板无法正常开局；消消乐同行同款）', file: 'css/chat-pages.css', needle: '.lk-stage { position:relative; width:100%; min-height:190px;' },
  // ==== 2026-09-11 #314 收藏批量管理多选失效（getFav() 每次 JSON.parse 生成全新对象，favBatchSel 存对象引用 → 任何 renderFav 重渲染（点全选/切分类/切页签）后引用全部失配，勾选静默清零＝多选/全选形同虚设；全机型通用）====
  { name: '#314 收藏批量勾选身份=favItemKey 指纹（删则退回对象引用勾选，重渲染后勾选清零、多选失效；行为断言 tools/verify-fav-batch.mjs）', file: 'js/chat.js', needle: 'const visKeys = new Set(list2.map(favItemKey));' },
  // ==== 2026-09-11 #308 游乐室半框 × 关不掉（arcade.js 取了 #arc-close 却从未绑 click，任何机型都关不掉）====
  { name: '#308 游乐室 × 点击关闭接线（删则 #arc-close 成摆设、半框关不掉，行为断言 tools/verify-arcade-close.mjs）', file: 'js/arcade.js', needle: "closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });" },
  // ==== 2026-09-15 #535 主页「游乐室」入口占满 tab 记录区首屏（用户报「位置不应该放在影响查看其他 tag 的地方」）——由 data-hpanel="*" 卡移入标题栏常驻按钮 ====
  { name: '#535 主页游乐室入口在标题栏（删/移回 cal-scroll 则又常驻遮挡各 tab 记录首屏）', file: 'template.html', needle: '<button class="arc-home-entry" id="home-arcade-entry" type="button">' },
  // ==== 2026-09-11 #301 手机端整页 UI 错乱收口（红包注释漏 `-->` 吞标签 → .phone 提前闭合 → tabbar 落 body 层被 flex 居中挤出屏）====
  { name: '#301 红包注释正确闭合（删则注释吞掉「红包」标题+set-group 开标签，后续 </div> 连锁提前闭合设置页与 .phone 手机壳＝整页 UI 错乱、底部导航出屏）', file: 'template.html', needle: 'chat.js trySystemAutoSend 读 cs-rp-auto-prob / cs-rp-daily-max -->' },
  // ==== 2026-09-11 #313 心意集市「TA 送我礼物」总开关（默认关=禁止联系人送礼物；关闭时心愿单兑现 ① 与随机送礼 ④ 都不触发，TA 自己买 ②/加心愿 ③ 不受限）====
  // #539 起默认值反转为「开」——本锚守的是「总开关参与 ① 的与门」，不是默认值（默认值锚见下）
  { name: '#313 gift-shop TA送我礼物总开关（删则禁送失效、TA 恢复买我心愿单礼物；giftInOn 仍参与 ① 判定。v3.27.x #585：额度变量由共用 capped 拆成 giftCapped，锚随代码形态同步）', file: 'js/gift-shop.js', needle: 'st.wlOn && st.giftInOn && !giftCapped' },
  // ==== 2026-09-15 #539 心意集市「TA 送我礼物」默认开启 + 随机送礼概率可调（旧实现默认关且概率写死 5%，设置页缺这一项）====
  { name: '#539 giftInOn 默认开启（未设置过的用户落到 1；显式关过=0 的用户保持关闭；删则退回「默认禁止 TA 送礼物」）', file: 'js/gift-shop.js', needle: 's.giftInOn === 0 ? 0 : 1' },
  { name: '#539 随机送礼概率读设置 giftInPct（删/改回硬编码 0.05 则设置页「TA 送我礼物概率」失效，回到无处可调）', file: 'js/gift-shop.js', needle: 'Math.random() * 100 >= st.giftInPct' },
  { name: '#539 设置页「TA 送我礼物概率」输入行在位（删则概率项从设置消失，用户无法自定义）', file: 'js/gift-shop.js', needle: 'data-gsn="giftInPct"' },
  // ==== 2026-09-15 #540 心意市集/心意柜跨桌面串名（页面静态文案写死构建时 partnerName，切联系人后残留上一个桌面的名字）====
  { name: '#540 syncGiftNames 定义（按当前桌面重写心意柜/送礼面板里写死过名字的静态文案）', file: 'js/gift-shop.js', needle: 'function syncGiftNames()' },
  { name: '#540 切联系人重渲心意柜页（删则页面开着时切换联系人，列表与名字都停在上一个桌面）', file: 'js/gift-shop.js', needle: 'if (giftboxPage && !giftboxPage.hidden) renderBox();' },
  // ==== 2026-09-11 #315 开屏免责声明置顶卡（未成年人禁止使用 + 字卡均为随机代码、使用后果自负；静态 DOM data-anti-scam="d"，在线 notice.json 覆盖不改此处）====
  { name: '#315 开屏免责声明卡在位（删则开屏不再展示「未成年人禁止使用/字卡随机代码后果自负」声明）', file: 'template.html', needle: 'data-anti-scam="d"' },
  // ==== 2026-09-14 #315c 免责声明细化+年龄确认闸门（四条细化文案+18周岁红线+心理援助热线；勾选 xy-home-v2:age-confirmed 后才可进入，clock.js 门控）====
  { name: '#315c 免责细化文案在位（删则退回旧一句话免责：虚构娱乐边界/热线/数据自担全丢）', file: 'template.html', needle: '预先编写的随机代码随机触发' },
  { name: '#315c 年龄确认勾选框·静态锚点（删则开屏无勾选行=免责举证降级为默认已读）', file: 'template.html', needle: 'id="splash-age-check"' },
  { name: '#315c 年龄确认·clock.js 门控（删 ageOk 判定则未勾选也能进入=闸门失效）', file: 'js/clock.js', needle: "const ok = r && scrolledBottom && ageOk;" },
  // ==== 2026-09-11 #316 聊天记录滚动跳动/闪烁（#199 overflow-anchor:none 连带关掉 Chromium 原生锚定：浏览图片较多历史时上方图片解码撑高无人补偿=内容被推走；解钉动态开回锚定、钉住态维持 none 防 #199 对打）====
  { name: '#316 解钉开滚动锚定·接线（删则用户手动滚动后锚定仍关、图片撑高继续推走视口=聊天记录一直跳；行为断言 tools/verify-chat-anchor.mjs）', file: 'js/chat.js', needle: 'function unpinChatAndAnchor() {' },
  { name: '#316 解钉开滚动锚定·CSS 开关（删则类挂了也不生效，Chromium 锚定回不来；钉住态 #199 none 语义不变）', file: 'css/base.css', needle: '.chat-body.scroll-anchor-auto { overflow-anchor: auto; }' },
  // ==== 2026-09-11 #319 防未成年人·系统内置字卡二级验证锁（默认全锁：回复池/字卡库/词典拼字/功能同源池取不到任何系统预设字卡，自建字卡不受影响；开屏输密码解锁，源码只存散列不存明文）====
  { name: '#319 内置字卡锁·闸门本体（card-lock.js，删则锁定失效全部预设字卡裸奔＝防未成年保护丢失）', file: 'js/card-lock.js', needle: 'window.cardLockOpen = isOpen' },
  { name: '#319 内置字卡锁·分组总闸（getDefaultCardGroups 锁定返回空，删则字卡库/词典拼字仍能取到系统预设字卡）', file: 'js/default-cards.js', needle: "if (LOCKED()) return []; // #319 锁定＝系统预设字卡不存在" },
  { name: '#319 内置字卡锁·聊天回复池闸（getPool 系统预设分支锁定不入池，删则聊天仍抽预设字卡）', file: 'js/chat.js', needle: 'const sysLocked = !(window.cardLockOpen && window.cardLockOpen());' },
  { name: '#317 开屏解锁卡接线（clock.js setupCardLockCard，删则开屏无解锁入口＝锁死无法使用）', file: 'js/clock.js', needle: 'function setupCardLockCard() {' },
  // ==== 2026-09-11 #320 全屏游戏面板抬层（.game-fs 在 .page(z-index:2) 上下文内，z-9999 被压到 2 永远低于全局顶部提醒条 998 → 连连看/消消乐全屏时头部难度下拉被提醒条盖住点不到、选不了难度的根因）====
  { name: '#320 全屏期间给 .phone 挂 game-fs-active（全屏面板所在 page 抬到 1000，删则提醒条继续盖住全屏头部难度下拉=全屏选不了难度），配套 CSS：css/chat-pages.css .phone.game-fs-active .page{z-index:1000}', file: 'js/fullscreen.js', needle: "_gfsPhone.classList.toggle('game-fs-active', gameFsHasActive())" },
  // ==== 2026-09-11 #331 拍卖会「按钮没用+页面卡死」（#321 全屏教学浮层 #au-intro/#au-help 用 ID 选择器写 display:flex，特异性压过 UA 的 [hidden] 和 .pong-overlay[hidden] 救援 → hidden 属性失效，不透明黑罩永远盖屏拦掉全站点击；全机型必现，与浏览器无关）====
  { name: '#331 拍卖全屏浮层 hidden 救援（删则开场/玩法浮层永远盖屏＝拍卖会及全站按钮点不到像卡死；行为断言 tools/verify-auction-overlay.mjs）', file: 'css/chat-pages.css', needle: '#au-intro[hidden], #au-help[hidden] { display:none; }' },
  // ==== 2026-09-11 #335 问问TA文字题回应接聊天字卡/词典：开关（ta-ask settings.useChatReply，默认关）开启后，文字题回答按普通聊天同源顺序生成回应——① getDefaultCards('chat') 整体概率抽默认聊天字卡 ② quoteSpellPick 拼字概率抽词典语录（问答卡只回一条，固定单气泡空格连卡） ③ 都未命中走原「询问·回应」预设池 90/10 混合；回应经 chatAskReply 新增 opts.raw 直传，跳过 pickAskCardReply 再混合 ====
  { name: '#335 文字题聊天链路回应·开关门（settings.useChatReply，删则开关失效＝永远走预设池）', file: 'js/ta-ask.js', needle: 'if (!(d.settings && d.settings.useChatReply)) return null;' },
  { name: '#335 文字题聊天链路回应·raw 直传（删则 pickAskCardReply 90/10 混合把词典/默认字卡回应换掉＝开关开了也不生效）', file: 'js/chat.js', needle: 'if (opts && opts.raw && preset) {' },
  // ==== 2026-09-11 #334 搜索/引用跳转被回底机制抵消（OPPO Reno14 Edge 报「旧的聊天记录依旧无法跳转」复发，#268 下界扩窗治不了这类）：jumpToMsg 是程序化滚动从不解钉，chatPinnedBottom 恒真＝跳到旧区后 lazy 图 onload 触发 #162 图片补滚 rAF(scrollChatBottom) 把视图拽回底部（无头红绿实证：hasHl:true+atBottom:true+visible:false，与真机「点了没反应」一致）＋show/hideTyping 无条件回底同类抢滚动权。修复：①跳转成功即 unpinChatAndAnchor()（与手动上翻同权开回滚动锚定）②typing 复写守钉 ③搜索点击先收键盘双 rAF 后起跳。行为断言 tools/verify-chat-pgjump.mjs 症状4 ====
  { name: '#334 跳转解钉（删则钉住态下跳到旧区被 #162 图片 onload 补滚拽回底部＝搜索/引用跳转「点了没反应」）', file: 'js/chat.js', needle: 'unpinChatAndAnchor(); // FIX 2026-09-11 #334' },
  { name: '#334 showTyping 零滚动守钉（#514 加强：只切可见性、一个 scrollTop 都不写＝用户读历史时「对方正在输入」既不拽回底部也不改变钉住标记；旧形态 60ms 复写已随 #514 移除）', file: 'js/chat.js', needle: 'typingEl.hidden = false; // FIX 2026-09-15 #514 只切可见性' },
  { name: '#334 hideTyping 复写守钉（删则回复落地收打字态时把已跳到旧区的视图拽回底部）', file: 'js/chat.js', needle: 'if (chatPinnedBottom) scrollChatBottom(); // FIX 2026-09-11 #334 解钉态不抢滚动权' },
  // ==== 2026-09-15 #514 联系人连发多条消息时聊天记录「一直闪、一直回弹」（红米 K80 Chrome 等多机型，用户明说其他机型也有）：#chat-typing 是 #chat-body 的兄弟节点（#page-chat 的 flex 行），显示它只吃 chat-body 的 clientHeight——可滚最大（scrollHeight−clientHeight）反被抬高 22px、scrollHeight 不动。旧 showTyping 在钉住态写 scrollTop=scrollHeight，钳位目标＝「行显示中」那份最大值；行一隐藏（hideTyping 紧随其后就是消息落地）最大值回落 22px、内核把 scrollTop 钳掉 22px＝内容当场下弹 22px，新消息又平滑滚回底部 → 每来回「上跳 22px + 下弹 22px」，TA 连发＝一直闪一直回弹。修复：显示/隐藏一律不写 scrollTop（打字行 22px ≤ .chat-body padding-bottom:24px 的空白呼吸区，占位期间最后一条消息照旧完整可见）＝零钳位、零位移、零机型分支。行为断言 tools/verify-chat-multi-scroll.mjs ====
  { name: '#514 进页打字行零滚动（删则进页时打字行把 scrollTop 顶到行显示态最大值，TA 回复落地即被钳回＝进页回弹一拍）', file: 'js/chat.js', needle: 'typingEl.hidden = false; // FIX 2026-09-15 #514 进页同款' },
  { name: '#514 「连发多条」真实链路测试钩子（删则 verify-chat-multi-scroll.mjs 无法驱动产品函数，只能复刻实现＝测不到真身）', file: 'js/chat.js', needle: 'window.chatAddInTyped = function' },
  // ==== 2026-09-11 #337 安卓键盘盖输入栏（荣耀畅玩80Pro 自带浏览器，多机型同族）：键盘弹出时 vv 读数漂移/不缩 → 读数判据 _aProvCheck 永不命中 + 58% 盲猜对高占比输入法停靠不足。三件套：①可见性触发停靠（聚焦>900ms+手势武装+实测元素底边低于可视区底边=被盖才动作，与内核读数无关）②VirtualKeyboard 实测尺（overlaysContent=true+geometrychange 按 base−kbH 精停，特性探测，_aProvClear 归还）③欠深自纠（停靠后仍被盖每 250ms 再收 8% 基准至露出/34% 地板）。行为断言 tools/verify-kb-cover-dock.mjs ====
  { name: '#337 键盘可见性触发停靠（删则读数漂移内核输入栏整行留在键盘下=畅玩80Pro 族无法聊天）', file: 'js/mobile-adapt.js', needle: '_kbCovered = !!(_rC && _rC.height > 0 && _aCoverBottom(tgt) > _visBottomC + 12);' },
  // ==== 2026-09-13 #387 点聊天输入栏 UI 乱+闪屏（桌面浏览器 DevTools 移动模拟实测复现，多机型同族）：安卓/iOS 键盘保底停靠的读数判据（|vv−基线|≤2 且 |inner−基线|≤2）只证「视口没动」不证「键盘在场」——无软键盘环境（电脑浏览器/移动模拟/外接键盘）视口永远不动，点输入栏即盲推 58% 停靠＝输入栏顶到屏中下方大空白（UI 乱），自愈清除后反复点击又缩回（闪屏）。修复：安卓 _aProvCheck 与 iOS _iProvCheck 两处盲推分支统一加「实测被盖」闸（#337 同一把尺：聚焦元素∪输入行底边低于可视区底边+12px 才停靠）——悬浮键盘真场景键盘必然盖住输入栏照常停靠零回归；元素可见无需停靠，只可能少停不可能多停。行为断言 tools/verify-kb-prov-covered.mjs ====
  { name: '#387 安卓盲推停靠被盖闸·实测（删则无键盘环境点输入栏盲推 58%=输入栏顶屏中 UI 乱闪屏）', file: 'js/mobile-adapt.js', needle: 'if (_kbCovered) _aProvDock();' },
  { name: '#387 安卓读数判据分支同样被被盖闸包住（删 =||= 恢复视口不动即盲推）', file: 'js/mobile-adapt.js', needle: 'Math.abs(ih - _aIH) <= 2 && _kbCovered) {' },
  { name: '#387 iOS 盲推停靠被盖闸（删则无键盘 iOS 环境点输入栏盲推收缩=UI 乱闪屏）', file: 'js/mobile-adapt.js', needle: '_iCovered = !!(_rI && _rI.height > 0 && _rI.bottom > ((_vv.offsetTop || 0) + _vv.height) + 12);' },
  { name: '#337 VirtualKeyboard 实测尺拉起（删则悬浮键盘只能 58% 盲猜，高占比输入法停靠不足仍被盖）', file: 'js/mobile-adapt.js', needle: 'vk.overlaysContent = true;' },
  { name: '#337 欠深自纠逐拍收紧（删则保底停靠不足时输入栏仍被盖不自愈）', file: 'js/mobile-adapt.js', needle: 'var ph = Math.max(Math.round(base * 0.34), cur - Math.round(base * 0.08));' },
  // ==== 2026-09-11 #336 信息诊断导出 docx 无反应（荣耀畅玩80Pro 自带浏览器对合成 a[download]+blob URL 静默忽略）：接入数据备份同款三级降级链 window.mochiExportBlob（①系统分享面板 ②系统保存框 ③确认后 a[download]），裸下载只作兜底；两处诊断弹窗统一走 diagExportDocx。行为断言 tools/verify-docx-export.mjs E5~E11 ====
  // #746 同批换 needle：diagExportDocx 第 5 参 shareTitle 参数化分享标题后，原锚 'mochi 诊断报告'
  //   硬编码已改为 shareTitle || 'mochi 诊断报告'——#336 锚点随之收到新表达式（同批换锚，见 AGENTS.md）。
  { name: '#336 诊断 docx 走三级降级链（删则壳浏览器点导出docx无反应=用户报障回流）', file: 'js/device.js', needle: 'window.mochiExportBlob(blob, fname, shareTitle' },
  { name: '#336 mochiExportBlob Blob 版导出（删则分享面板/保存框通道断链，仅剩裸下载）', file: 'js/data-backup.js', needle: 'window.mochiExportBlob = function (blob, fname, shareTitle, saveTypes)' },
  { name: '#338 心情日记 TA心情独立（删则 taMoodFor 恢复读我的当日记录、35% 概率跟随＝我记录心情后 TA 心情被改成同款）', file: 'js/mood-diary.js', needle: "hashStr('ta-mood-indep|'" },
  // ==== 2026-09-12 #339 设置改完退后台/等一两小时回退成默认值（默认字卡概率/回复速度/emoji 概率等全站小键，多机型；LS 回滚家族第五层 #82/#88/#226/#229/#233/#265）：wrj 启动回放 wrjReplay 把回滚日志里的旧值 idbSet 回写 IDB 踩掉新值，wrjMergeFromIdb 按「标记更新→取 IDB 值自愈」读到的恰是被踩掉的旧值＝自愈被自己废掉。修复：回放只救 内存+LS，绝不回写 IDB。行为断言 tools/verify-wrj-replay-no-stomp.mjs 红绿对照 ====
  { name: '#339 wrj 回放禁写 IDB·守卫常量（翻成 false/删除＝恢复无条件回写＝「改完设置就退浏览器」最近一次改动 100% 丢失回归）', file: 'js/idb.js', needle: 'var WRJ_REPLAY_NO_IDB = true;' },
  { name: '#339 wrj 回放禁写 IDB·守卫包住 idbSet（删守卫留裸 idbSet＝回放旧值踩掉 IDB 新值、wrjMerge 自愈读回被踩旧值）', file: 'js/idb.js', needle: 'if (!WRJ_REPLAY_NO_IDB) { try { if (window.idbSet) window.idbSet(e.k, e.v); } catch (e2) {} }' },
  { name: '#337 尾巴日志收录互动卡问题/选项字段（删字段清单＝IDB 落盘失败回放出的互动卡「卡片在、问题空白」回归）', file: 'js/chat.js', needle: "const CHAT_TAIL_INTERACT_FIELDS = ['askQuestion', 'askOptions', 'askType', 'deskCk', 'deskCkDir'," },
  { name: '#337 互动卡渲染回退 rec.text 自愈（三个 || 去掉＝存量空白卡永远空白、无自愈路径）', file: 'js/chat.js', needle: "escTxt(rec.choiceQuestion || rec.text || '')" },
  // ==== 2026-09-12 #342 拍卖会两缺陷：①⛶ 全屏被 #321 半框 ID 规则钳在 68% 高（ID 特异性压过 .poke-card.game-fs 的 max-height:none，实测 574/844px 底部露出聊天页）→ 半框规则加 :not(.game-fs) 限定；②#321 全屏教学浮层盖住头部 ✕ 且无自己的出口＝想走只能先开局 → 加「先不玩」按钮（template+js）。行为断言 tools/verify-auction-overlay.mjs E/F 组 ====
  { name: '#342 拍卖半框 68% 规则限定非全屏（删 :not(.game-fs)＝ID 规则重新压过 game-fs，⛶ 全屏只有 68% 高半截屏）', file: 'css/chat-pages.css', needle: '#chat-auction-panel:not(.game-fs) { height:auto; min-height:min(68%, 560px); max-height:68%; }' },
  // ==== 2026-09-12 #345 TA主动消息「通知已弹、进聊天被吞」（红米 K80 Chrome 报障，全机型同现与设备无关；K80 诊断：后台保活存活期消息到达+系统通知已弹）：横幅/系统通知在 addIn 同步链发出，rc-prob 25% 撤回签 900ms 后才掷、rc-refix 未命中不补发＝通知承诺的内容进聊天只剩「对方撤回了一条消息」。修复：撤回签提前到投递前掷，命中撤回的本条 silent 落地（不弹通知、未读角标照增），补发的替换消息走正常投递。行为断言 tools/verify-proactive-retract.mjs ====
  { name: '#345 撤回先掷签后投递·silent 接线（改回 silent: i > 0＝撤回消息重新弹通知、进聊天内容消失＝「刚主动发的消息被吞」回归）', file: 'js/chat.js', needle: 'silent: i > 0 || willRetract' },
  // ==== 2026-09-16 #556 回复链/拍一拍撤回先掷签（#345 同族收口②③，OPPO Reno6 5G 雨见 Firefox 报障「弹窗显示的字卡进聊天压根没有、是别的字卡（弹窗说早安、进聊只剩撤回墓碑+别的卡）」，用户明说多机型同现与设备无关；#550~#552 编号已被并行批次占用故顺延）：#345 只收口了 tryAutoSend，replyOnce（scheduleReply/continueChat/拍一拍追问共经）与 sendPoke 仍在 addIn 弹桌面横幅/系统通知后才掷 rc-prob——900ms 后 partialRetractMsg/retractMsg 撤回＝通知承诺的内容进聊天只剩墓碑/缺段＋同批其它字卡。修复：同 #345 投递前定生死，命中撤回的本条 silent 落地（不弹通知、不播音效、角标照增），900ms 后照常撤回，rc-refix 补发正常投递。行为断言 tools/verify-reply-retract-order.mjs 18 断言 ====
  { name: '#556 回复链撤回先掷签（replyOnce 掷签挪回 addIn 之前；删＝通知先弹再撤回吞内容＝「弹窗说的那句进聊天没有」回归）', file: 'js/chat.js', needle: "const willRetractR = hit(c['rc-prob'])" },
  // 锚点 2026-09-17 收窄：并行批 #693 在同一行追加 tag/tagNoDup（多字卡回复来源 chip）后原整行
  // needle 失配变哑哨兵——改取「命中撤回才可能出现的 silent 入参」半段（chat.js 内 willRetractP
  // 仅此处一处），#693 的 tag 增删都不影响本锚，删 silent＝本锚立即消失。
  { name: '#556 拍一拍撤回先掷签·silent 接线（sendPoke 命中撤回必须静默落地；删 silent＝撤回消息重新弹通知＝同族回归）', file: 'js/chat.js', needle: 'silent: willRetractP,' },
  // ==== 2026-09-12 #346 拍卖会余缺陷批（用户「全部修复」）：结算后开🎒回不去汇总／转赠无确认易误触／寄到时背包列表 data-i 错位可能送错件／余额不足出价键静默置灰／TA掂量中返回文案误报／音效开关不记忆／矮屏(横屏)半框 68% 太挤。行为断言 tools/verify-auction-overlay.mjs G 组 ====
  { name: '#346 结算汇总 showSummary 独立成函数（内联回 endSession＝结算被🎒覆盖后回不去本场汇总）', file: 'js/auction.js', needle: 'function showSummary() {' },
  { name: '#346 转赠走全站 openModal 确认（删＝点「送TA」立即移出不可撤回＝误触丢拍品）', file: 'js/auction.js', needle: '送出后不可撤回。' },
  { name: '#346 寄到且背包开着就重渲染（删＝unshift 后已渲染 data-i 整体 +1，「送TA」可能送错件）', file: 'js/auction.js', needle: 'delivered && bagOpen' },
  { name: '#346 余额不足提示行接线（删＝出价键静默置灰无解释，新用户不知道要先有心意币）', file: 'template.html', needle: 'id="au-wallet-hint"' },
  { name: '#346 背包返回文案按回合态（删＝TA 掂量中返回误报「到你出价了」）', file: 'js/auction.js', needle: '正在掂量你的出价' },
  { name: '#346 音效偏好持久化（删＝每次重开面板重置为开、🔇 记不住）', file: 'js/auction.js', needle: "localStorage.getItem('xy-home-v2:au-sound')" },
  { name: '#346 矮屏(横屏 max-height:500px)半框提到 82%（删＝横屏 68% 竞价区挤）', file: 'css/chat-pages.css', needle: '@media (max-height:500px)' },
  // ==== 2026-09-12 #347 拍卖会寄回投递不依赖打开面板（全局 10 分钟补投）：原 checkGifts 只挂面板打开/开面板期 30s，「2~4 天寄回」实际是「下次打开拍卖会才寄到」====
  { name: '#347 寄回全局补投·10 分钟一次（删＝TA 寄回的拍品要打开拍卖会才到账）', file: 'js/auction.js', needle: '600000' },
  // ==== 2026-09-12 #348 拍卖会优化批（用户「都需要优化」）：成色评级 SSR/稀有/普通（按底价分档，揭晓与记录展示）／落槌与被抢走震动反馈／落盘 localStorage+IndexedDB 双写+开屏回填／拍卖记录页（📜 最近 60 条）／自制拍品（➕ 三段式添加，输入同名删除，上限 20，随机 20% 蒙面并入奖池）／自定义出价（长按出价键 600ms 直接压价）／TA 四状态跟价台词库。行为断言 tools/verify-auction-overlay.mjs H 组 ====
  { name: '#348 成色评级分档（删则拍品无普通/稀有/SSR 之分，揭晓与记录退化）', file: 'js/auction.js', needle: 'function rarityOf(' },
  { name: '#348 落槌/被抢走震动反馈（删则安卓无触感反馈）', file: 'js/auction.js', needle: 'navigator.vibrate' },
  { name: '#348 落盘双写 localStorage+IndexedDB（删则收藏/记录只存 localStorage，清站点即丢）', file: 'js/auction.js', needle: 'function persist(' },
  { name: '#348 开屏 idb 回填收藏/记录（删则换机/清站点后双写数据无法找回）', file: 'js/auction.js', needle: 'restoreFromIdb' },
  { name: '#348 拍卖记录存储（删则 📜 记录页永远空）', file: 'js/auction.js', needle: ':auction-history' },
  { name: '#348 自制拍品存储（删则 ➕ 添加的拍品无处安放、奖池不合并）', file: 'js/auction.js', needle: ':auction-custom' },
  { name: '#348 自定义出价（删＝长按无反应只能三档出价）', file: 'js/auction.js', needle: 'customBidModal(' },
  { name: '#348 TA 按行为状态差异化跟价台词（改回固定池＝四状态语气趋同）', file: 'js/auction.js', needle: 'pick(m.calls)' },
  // ==== 2026-09-12 #349 游戏面板跨桌面串名串档：snake 五个存储键（昵称/战绩/最高分/存档）与 pong 存档键都是【模块加载时冻结】的桌面 cid——加载时在 A 桌面、切到 B 桌面后开面板读写仍是 A 的键（任何机型必现）。改动态 activePrefix()/activeStore（同其余游戏面板既有模式）====
  // #616（2026-09-16）：「其他功能改用桌面昵称」把这处的键序从 cs 优先翻成 lbl 优先，
  //   锚点同步（意图不变：名字从**活动 store** nst 现读、不是加载时冻结的 PARTNER_KEY）
  { name: '#349 贪吃蛇标题名走 activeStore 动态命名空间（改回裸读冻结 PARTNER_KEY＝切桌面标题串名）', file: 'js/snake-game.js', needle: "nst.get('lbl-partner') || nst.get('cs-lbl-partner')" },
  { name: '#349 贪吃蛇战绩/最高分/存档键动态取桌面（改回加载时冻结 const PREFIX＝切桌面串档）', file: 'js/snake-game.js', needle: "function keyScore() { return prefix() + ':snake-score'; }" },
  { name: '#349 乒乓存档键动态取桌面（改回顶层 const SAVE_KEY 冻结 cid＝切桌面串档）', file: 'js/pong.js', needle: "function saveKey() { return (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':pong-saved'; }" },
  // ==== 2026-09-12 #350 词典页整页滚动：v3.36.x 场景开关/概率块插到列表上方后漏加 #239 同款规则，列表被 flex 挤成 6~29px＝「词典点进去上下滑不了」（多机型）====
  { name: '#350 词典页整页滚动（删则词典列表被设置块挤成几像素/屏外＝页面滑不动，#239 同族回归）', file: 'css/chat-pages.css', needle: '#page-dict-cards #d2-dict-list { flex:0 0 auto; overflow:visible; min-height:0;' },
  { name: '#340 消消乐死锁洗牌滑动动画（删则洗牌退回整盘瞬跳重绘）', file: 'js/match3.js', needle: "p.el.style.transitionDuration = '0.32s';" },
  // ==== 2026-09-12 #351 桌面装修图标摆放（vivo X200s/V2458A VivoBrowser 报障，多机型同现）：跨页拖动只写目标页顺序数组、启动模板把图标放回默认页且旧恢复逻辑只排「已在本格」节点＝退出重进图标回原位；新增页无 .app-grid＝放进去的图标只能独立竖排无排版不可调位。修复：启动跨网格认领归位（非模板默认页认领胜出+脏条目自愈清盘）、拖动/装修库同步清源页数组、新页自带 pg* 网格、独立图标可拖入网格 ====
  { name: '#351 跨页图标启动归位（删则退出重进图标回原位——顺序数组跨网格认领+非默认页裁决）', file: 'js/personalize.js', needle: 'owner[k] === ICON_HOME_GRID[k] && gid !== ICON_HOME_GRID[k]' },
  { name: '#351 跨页拖动清源页顺序数组（删则源页脏条目残留→启动认领回原位）', file: 'js/personalize.js', needle: "store.set('app-icon-order-' + srcGrid.dataset.app" },
  { name: '#351 新页自带图标网格（删则新页图标只能独立竖排、无排版不可调位）', file: 'js/personalize.js', needle: "pgGrid.setAttribute('data-desk-widget', 'pg' + i)" },
  // ==== 2026-09-12 canvas 手感批（用户「都要优化」）：打砖块丢命震屏 + 贪吃蛇死亡先演后弹 ====
  { name: '#352 打砖块丢命震屏（删则丢命无任何画布反馈＝手感批回归）', file: 'js/breakout.js', needle: 's.shakeUntil = now + 300; s.shakeMag = 5;' },
  { name: '#352 贪吃蛇死亡先演后弹（删则结算浮层回到立刻弹出＝死亡瞬间被跳过，#341 同族回归）', file: 'js/snake-game.js', needle: "if (state !== _endState || _endState.status !== 'over') return;" },
  // ==== 2026-09-12 #353 应用内「清除本地数据」没清干净（红米 K70/多机型）：数据双写 LS+IDB，旧逻辑只 idbClearAll（clear store）且用 ||Promise.resolve(true) 掩盖失败＝清库事务失败时只清 LS、IDB 残留，启动 idbRestore 全量回填＝专属字卡（LS-only）真丢、其余内容全复活。修复：idb.js 新增 idbDestroy（deleteDatabase 真删库，回填无源）+ personalize.js 优先真删库、失败退回 idbClearAll ====
  { name: '#353 真删库函数 idbDestroy 在位（删则清除数据只 clear store、失败即从 IDB 回填复活）', file: 'js/idb.js', needle: 'indexedDB.deleteDatabase(DB_NAME)' },
  { name: '#353 清除数据优先真删库（删则退回只 idbClearAll、依赖||true 掩盖失败＝清不干净）', file: 'js/personalize.js', needle: "const destroy = (window.idbDestroy && window.idbDestroy()) || Promise.resolve(false);" },
  // ==== 2026-09-12 音乐后台停播韧性（多机型/全浏览器：切后台十几秒~1分钟才停、回前台才恢复）：原后台补播 scheduleBgResume 只排 [300,1500,5000,12000] 四档、约 12 秒耗尽后再无人拉起——保活 WebRTC 回环+wakeLock 双豁免下页面通常未完全冻结，音乐只被临时暂停时补播窗口太短＝十几秒~1 分钟停播主因。修复=加 keepBgResumeAlive 尾档每 12s 续下一轮（对齐 bg-keep 无限退避）；死循环仍由 tryResumePlayback 现有 bgResumeFails>=6 + bgResumeFailAt 60s 冷却封顶，音乐真出声/用户停/来电 hold 都 clearBgResume 自然断轨 ====
  { name: '音乐后台补播持续续轨（keepBgResumeAlive 尾档 12s 续轮；删则后台补播回到 12s 四档即弃＝切后台十几秒~1 分钟停播复发）', file: 'js/music-player.js', needle: 'bgResumeTimers.push(setTimeout(keepBgResumeAlive,12000));' },
  // ==== 2026-09-12 #361 语音点播无声（多机型：荣耀X50 Edge 等安卓 Chromium 系内核对未挂载 DOM 的 Audio 静默空放，play() 走完不出声）：字卡库点播与群聊语音仍是 new Audio() 裸播，与已修的聊天气泡(#358)/录音试听同根因；修复=挂进 document.body 再 play，停播/播完/出错即卸 ====
  { name: '#361 字卡库语音点播挂载后播（删挂载即回归安卓 Chromium 系点播静默空放）', file: 'js/chatcard.js', needle: 'playingAudio = nextAudio' },
  { name: '#361 字卡库语音停播即卸（与挂载对称，删卸载行＝挂载的 Audio 元素滞留 DOM 泄漏）', file: 'js/chatcard.js', needle: 'try { if (playingAudio.parentNode) playingAudio.parentNode.removeChild(playingAudio); } catch (e) {}' },
  { name: '#361 群聊语音挂载后播（删挂载即回归群聊语音安卓无声）', file: 'js/group-chat.js', needle: 'gcVoiceAudio = a; gcVoiceBtn = btn;' },
  // ==== 2026-09-15 #499 需求变更（推翻 #365 #319 对三链的锁闸）：二级密码锁定不再影响聊天情绪字卡、TA 的心情、聊天回应字卡——三链未解锁也照常触发；受影响的只剩默认聊天字卡/词典等系统预设池。原 #365 两条锁闸哨兵随锁闸一并移除，改登豁免锚点防需求回流 ====
  { name: '#499 回应字卡豁免锁定（#365 replySrcLocked 锁闸按新需求移除；锚点=两函数首个守卫是开关而非锁，锁闸被加回开头即失配；构建拼接剥行首缩进，锚不带缩进＝#496 同款教训）', file: 'js/mood-reply-cards.js', needle: "window.getFollowupWord = function (reply) {\nif (ls.get('rc-enabled') !== null && ls.get('rc-enabled') !== '1') return '';" },
  { name: '#499 TA的心情豁免锁定（#365 锁闸按新需求移除；锚点=函数首个守卫是 enabled 而非锁，锁闸被加回开头即失配；构建拼接剥行首缩进，锚不带缩进＝#496 同款教训）', file: 'js/ta-mood.js', needle: "window.tryTaMoodShare = function () {\nif (!enabled()) return null;" },
  // ==== 2026-09-15 #500 三级链单卡开关补全：心意卡（9 组 + 特殊 4 组）与交流意图卡（8 组）在字卡库里没有列表＝没有关闭入口，且三类共用 mc-off-mood 键（「想念」「分享」等 20+ 张同名卡跨类互相误伤）——用户反馈「手动关闭没有用，会频繁使用」。修=三类分栏 UI + 各自独立开关键（旧键仍作兼容读，存量关闭不复活）====
  { name: '#500 三级链独立开关键（回到共用 mc-off-mood ＝同名卡跨类互相误伤，关情绪卡会连心意卡一起消失）', file: 'js/mood-reply-cards.js', needle: "const OFF_KEY = { mood: 'mc-off-mood', heart: 'mc-off-heart', intent: 'mc-off-intent' };" },
  { name: '#500 心意/意图卡旧键兼容读（删兼容行＝老用户此前关掉的心意/意图卡全部复活）', file: 'js/mood-reply-cards.js', needle: "if (type !== 'mood' && !hasMoodCard(content) && ls.get('mc-off-mood:' + content) === '1') return true;" },
  { name: '#500 心意卡单卡开关入口（该行消失＝心意卡在字卡库里又没有列表，用户无从关闭）', file: 'js/mood-reply-cards.js', needle: ".concat((DATA.specialHeart || []).map(g => ({ ...g, type: 'heart', special: true })));" },
  { name: '#500 三类分栏容器（删＝心意/交流意图分栏 UI 丢失）', file: 'template.html', needle: 'id="mc-type-bar"' },
  { name: '#500 逐张关闭写入本类键（回写成 mc-off-mood ＝跨类误伤回归）', file: 'js/mood-reply-cards.js', needle: 'setTypeOff(g.type || mcType, c.content, nowOff);' },
  // ==== 2026-09-12 #367 诊断红点：AbortError 类未处理 rejection（音乐/通话流超时兜底、切页取消的主动 abort）入错误环刷屏——Safari「Fetch is aborted」iOS 实录 ×41 条；修复=unhandledrejection 采集层按 AbortError 名/已知 abort 文案放行，与 fetch 包装层网络失败口径对齐 ====
  { name: '#367 AbortError rejection 放行（删放行＝主动 abort 取消照旧刷诊断红点，Safari 报「Fetch is aborted」）', file: 'js/device.js', needle: "r.name === 'AbortError')\n|| /^(Fetch is aborted|signal is aborted without reason" },
  // ==== 2026-09-12 #368 跨桌面串数据两件（iOS Safari 用户反馈，多机型同现）====
  { name: '#368 通话背景切桌面重读（applyCallBg 只在加载/上传/移除执行＝切联系人后 .call-panel/#call-mini 残留上一桌面的背景图，跨桌面串图且设置页显示不随桌面走）', file: 'js/call.js', needle: "document.addEventListener('contact-switched', applyCallBg)" },
  { name: '#368 送礼面板心愿单入口名字随桌面刷新（init 注入写死 partnerName＝切联系人后「看看 XX 的心愿单」残留上一个桌面的名字）', file: 'js/gift-shop.js', needle: "gwBtn0.textContent = '看看 ' + partnerName() + ' 的心愿单'" },
  // ==== 2026-09-12 #369 布局视口残留深缩自愈（iQOO Z9 VivoBrowser 实报「聊天聊到一半屏幕突然变成一半」「听歌闪几下加载中变成一半」，#236 同族第三形态：inner 与 vv 一起停在键盘态）====
  { name: '#369 布局视口残留钉高（inner/vv 同停键盘态、基准被重锚吞掉＝#236/#209 全失明；看门狗把 .phone 钉回 _aFullIH，inner 回基线解除）', file: 'js/mobile-adapt.js', needle: 'if (_aVpPin && _ihNow >= _aFullIH - 12)' },
  { name: '#369 基准重锚浅漂移闸（无聚焦分支原样 _aIH=ih 会把无键盘基准吞成残留值 373）', file: 'js/mobile-adapt.js', needle: 'ih >= _aIH - 12 || _aIH - ih < Math.round(Math.min(_aIH || ih, _aH || ih) * 0.22)' },
  // ==== 2026-09-12 #370 词典拼字两件（用户定稿：①词典全部分组字卡都进抽卡池，不再只取「语录*」前缀组；②形态概率——单气泡拼字为主，qs-multi 逐条连发降为 20% 小概率，multi 关=不能连发，双形态全关兜底单气泡不再兜底连发）====
  { name: '#370 词典拼字抽卡池放开到词典全部分组（原「语录*」前缀过滤删除=词库/常用词/自建词都能抽）', file: 'js/quote-spell.js', needle: "if (typeof q === 'string') quotes.push(q);" },
  { name: '#370 逐条连发降小概率（双开 80/20 单气泡为主；multi 关=one 恒 true 不能连发）', file: 'js/quote-spell.js', needle: 'if (multiOn) one = oneOn ? Math.random() >= 0.2 : false;' },
  { name: '#370 词典拼字链路自检行（五道静默闸门任一被关=永不发词典字卡且零提示；删则用户设备上被哪道闸挡住无从知晓）', file: 'js/reply-settings.js', needle: "const ov = window.dictOverall ? window.dictOverall('chat') : 100;" },
  // ==== 2026-09-12 #371 群聊跟底三连写（红米 K80 Chrome 等多机型报「群聊联系人发消息不自动滚到最新，要手动滑」；单聊 #162 同根因同修法：移动内核丢弃一次性 scrollTop 写入/迟到布局顶开，group-chat.js 只写一次从未跟进）====
  { name: '#371 群聊跟底复写闸（触摸/滚轮接管判断；内核丢弃首写时视口离底>150px 会被 nearGcBottom 误判，复写不能只看 nearGcBottom）', file: 'js/group-chat.js', needle: 'if (!gcUserGcScrollTouched) scrollToBottom();' },
  { name: '#371 进群 renderAll 滚底走三连写（进页不贴底同一内核问题）', file: 'js/group-chat.js', needle: 'followGcBottom(true); // #371：进页滚底同走三连写' },
  // ==== 2026-09-12 #379 连续送心愿单礼物第二件起闪一下就消失（小米15 Pro Chrome 等多机型）====
  { name: '#379 礼物消息去重签名用礼物自身字段（原误用鲜花字段=任意两件礼物签名恒等，60s 窗口内第二件被当相邻重复删）', file: 'js/chat.js', needle: "String(m.giftId || '') + '|' + String(m.giftName || '')" },
  // ==== 2026-09-12 #380 装修换页「今日备忘/心情」刷新回第三页（v3.13.x 一次性迁移写成了每次启动无条件迁移，用户手动换页被打回；小米15 Pro 等多机型）====
  { name: '#380 memo-row 有布局一律尊重不迁移（删则 v3.13.x 强迁逻辑复活=每次启动把用户手动换页打回第三页）', file: 'js/personalize.js', needle: 'if (lay) return;' },
  // ==== 2026-09-12 #381 拍卖会背包/记录浮层显示不全（浮层 absolute 随 .au-stage，未开局 stage 仅 ~30px 列表被裁成一条缝；全机型）====
  { name: '#381 背包/记录浮层转全屏开关（删则浮层又缩回 30px 高的 stage 里显示不全）', file: 'js/auction.js', needle: "overlayEl.classList.toggle('au-ov-fs', !!fs)" },
  { name: '#381 全屏浮层 hidden 救援（.pong-overlay 的 display:flex 压掉 UA [hidden]，#331 同因；删则关不掉全屏背包/记录）', file: 'css/chat-pages.css', needle: '#au-overlay.au-ov-fs[hidden] { display:none; }' },
  // ==== 2026-09-12 #378 聊天+群聊跟底闸改钉住标记 + 轻点不杀跟底（红米 K80 Chrome 单聊/群聊同报「联系人发消息不自动滚到最新，要手动滑」；①旧 nearGcBottom/chatNearBottom 距离闸在内核丢弃首写/图片迟到解码顶开后把后续每条来消息都误判成在看历史永不跟底；②轻点消息区（点气泡）即解钉且无法回钉，自动跟底被一次轻点永久杀死）====
  { name: '#378 单聊来消息跟底闸改按钉住标记（距离闸在首写被丢弃后永不跟底；#492 起 userFollow 显式通道不吃此闸，闸语义不变）', file: 'js/chat.js', needle: 'if (!out && !userFollow && !chatPinnedBottom) return;' },
  // ==== 2026-09-15 #492 帮我决定/多人决定结果发到聊天后不滑到最新消息（多机型同报）：决策结果是用户主动触发，与 out 侧（自己发消息必跟底）和群聊 followGcBottom(true) 同权；chatAddIn({follow:true}) 一次性标记 + maybeScrollChatBottom 消费，TA 自发消息 #162/#378/#416 不打扰契约零改动 ====
  { name: '#492 follow 一次性消费+跟底闸放行（删则决策结果在解钉态永不跟底＝症状复发）', file: 'js/chat.js', needle: 'const userFollow = !out && chatUserFollowScroll;' },
  { name: '#492 chatAddIn 用户主动通道入口（删则 decision/group-decision 的 follow 传参失效）', file: 'js/chat.js', needle: 'if (opts && opts.follow) chatUserFollowScroll = true;' },
  { name: '#492 帮我决定结果发送接 follow 通道（删则发到聊天后不滑到最新复发；#544 该行追加 dedupExempt，锚点随契约同步）', file: 'js/decision.js', needle: 'window.chatAddIn(replyText, { enter: true, silent: true, follow: true, dedupExempt: true, nightAllow: true }); // FIX 2026-09-15 #492 帮我决定结果' },
  // ==== 2026-09-17 拍一拍发出后不自动滑到最新消息（用户报）：sendPoke 是用户主动触发的 in 侧消息，置 #492 同款 chatUserFollowScroll 一次性跟底标记；TA 自发消息与 TA 回拍不受影响 ====
  { name: '拍一拍发出跟底标记（删则上翻历史后发拍一拍不自动滑到最新复发；#876 该行追加 nightAllow 夜间放行标记，needle 随之换锚）', file: 'js/chat.js', needle: "chatUserFollowScroll = true;\naddRec({ side: 'in', text: text, special: 'poke', nightAllow: true });" },
  { name: '#492 多人决定结果发送接 follow 通道（删则发到聊天后不滑到最新复发；#544 该行追加 dedupExempt，锚点随契约同步）', file: 'js/group-decision.js', needle: 'window.chatAddIn(replyText, { enter: true, silent: true, follow: true, dedupExempt: true, nightAllow: true }); // FIX 2026-09-15 #492 多人决定结果' },
  { name: '#378/#416 单聊手动滚回贴底回钉（解钉后自动跟底可恢复；#416 起只认真的贴到底 ≤8px，防上翻读最新时误回钉拽底；2026-09-18 随 #716d 手势闸演进，锚收到未变的 ≤8px 判定本体，回钉调用点锚归 #716d）', file: 'js/chat.js', needle: 'cb.clientHeight <= 8;' },
  { name: '#378 单聊轻点不杀跟底（位移<10px 且贴底=回钉，点气泡不再永久解钉）', file: 'js/chat.js', needle: 'const dy = Math.abs(e.changedTouches[0].clientY - chatUnpinTsY);' },
  { name: '#378 群聊跟底闸改按接管标记（同单聊距离闸问题）', file: 'js/group-chat.js', needle: 'if (!force && gcUserGcScrollTouched) return;' },
  { name: '#378/#416 群聊轻点不杀跟底 + 滚回贴底解除接管（#396 随行补锚定摘除；#416 起轻点回跟只认真的贴到底 ≤8px，防上翻读最新时一点气泡就恢复跟底被拽回）', file: 'js/group-chat.js', needle: 'if (dy < 10 && gcAtBottom()) { gcUserGcScrollTouched = false;' },
  // ==== 2026-09-13 #396 聊天/群聊滑动屏幕「弹一下」（红米 K80 Chrome 报障，多机型同族）——两根因：①单聊 loadOlderIncremental 补偿式 beforeTop+anchor.offsetTop 读的是插入后首元素 offsetTop=插入高度+.chat-body padding-top，每批上翻固定多推 14px=视觉跳一下（#316 锚定只兜图片迟到解码兜不住这 14px，无头实测 Δsh=8903 误差恒-14px）；②#316 只给单聊解钉开回滚动锚定，gc-body 共享 .chat-body 的 overflow-anchor:none 却从未挂回 scroll-anchor-auto=图多群聊历史上翻被解码撑高推走 ====
  { name: '#396 单聊上翻补偿改锚点差值（删则每批上翻固定视觉上跳 padding-top 14px=滑动弹一下）', file: 'js/chat.js', needle: 'body.scrollTop = beforeTop + (anchor.offsetTop - anchorTopBefore);' },
  { name: '#396 群聊解钉开滚动锚定（删则图多群聊历史上翻被解码撑高推走，#316 同根因群聊侧）', file: 'js/group-chat.js', needle: "body.classList.add('scroll-anchor-auto')" },
  { name: '#396 群聊回钉摘锚定（钉住态 #199 none 语义不变，防锚定与 JS 显式滚动对打）', file: 'js/group-chat.js', needle: "body.classList.remove('scroll-anchor-auto')" },
  // ==== 2026-09-13 #401 点【发送】消息被吞（红米 K80 Chrome 报障同族复发，多机型通用纯逻辑）——两根因：①发守卫（#115 userEditedAfterClear）放行的「用户真实重打同文本」撞进 addRec 文本去重窗 2500ms 被静默吞（v3.17.x 只修守卫层误吞，addRec 第二层漏网；无头实证：重打 1.2s 后再发，输入框清空+音效照放+TA 照回，气泡 0 条）；②群聊 addMsg(input.innerText) 无 #215 撕文本快照兜底（Edge/Chromium 部分内核点发送瞬间零事件撕空组合文本→双读空→静默 return，单聊 #215 修过群聊侧同族漏修） ====
  { name: '#401 发件侧纯文本去重窗收窄 800ms（删/回 2500ms＝重打同文本 0.8~2.5s 内再发被静默吞，机械双击兜底+守卫双层仍在）', file: 'js/chat.js', needle: "&& !m.img && !m.voice && !m.special) return 800;" },
  { name: '#401 群聊发送取值快照兜底（删则撕文本内核群聊点发送消息静默消失，#215 群聊侧同族）', file: 'js/group-chat.js', needle: "input._gcLastTyped = input.innerText || '';" },
  { name: '#401 群聊清空同步作废快照（删则程序化清空后误点发送幻影重发上一条）', file: 'js/group-chat.js', needle: "input._gcLastTyped = '';" },
  // ==== 2026-09-13 #407 引用预览串条（华为 P50E Edge 报障「引用联系人的消息，输入栏预览显示的不是被引那条」，多机型同族）——菜单打开后 msgs 被权威读库合并/尾巴日志回放重排（中段插入/删除 ⇒ 后续下标整体位移）而 DOM 未重渲（#220 不贴底跳过重渲的防闪路径），点「引用」按陈旧 data-idx 解析＝msgs[idx] 指向另一条消息。修复=菜单打开时快照消息身份（对象引用+ts/side/text80 签名），动作执行时 resolveActiveMsg 四级重定位（①快路径 ②对象同一性 ③签名唯一命中 ④回退旧下标），引用/收藏/复制/编辑/撤回/删除全动作覆盖；群聊同族 gcResolveActiveMsg；chatTailMerge 回放条数并入 changed 走重渲；不贴底 changed 置 windowStale 作废同窗凭据 ====
  { name: '#407 聊天菜单动作身份重定位（删则 msgs 重排+DOM 未重渲窗口期引用/收藏/编辑/撤回串条）', file: 'js/chat.js', needle: 'function resolveActiveMsg() {' },
  { name: '#407 群聊菜单动作身份重定位（同族）', file: 'js/group-chat.js', needle: 'function gcResolveActiveMsg() {' },
  { name: '#407 尾巴回放位移并入 changed（删则回放插入后不重渲＝屏上 data-idx 整体陈旧）', file: 'js/chat.js', needle: 'if (chatTailMerge(myPrefix) > 0) changed = true;' },
  // ==== 2026-09-13 #404 米15夸克 LS 配额满（同域 ml2_* 他方键占 20MB，写探针 QuotaExceededError）二级密码解锁刷新即回锁——解锁后盲等 900ms reload，夸克等内核杀进程会中止在途 IDB 事务＝权威值未提交；LS 配额满设备项目 LS 键恒空、IDB 是唯一凭证，一次提交失败必现。修复=解锁/重锁改「确认 IDB 落库再刷新」（cardLockConfirmPersisted 轮询 200ms×15 兜底），诊断体检补 cardlock-state 全局根键三层值 ====
  { name: '#404 解锁/重锁落库确认接口（删则刷新回锁家族失去提交确认，回退盲等 900ms 竞态）', file: 'js/card-lock.js', needle: 'window.cardLockConfirmPersisted = function (expect, cb) {' },
  { name: '#404 开屏解锁等 IDB 确认 open 再刷新（删则夸克内核 reload 中止在途事务＝解锁刷新即回锁）', file: 'js/clock.js', needle: "cardLockConfirmPersisted('open', goReloadAfterPersist)" },
  { name: '#404 重锁等 IDB 确认 locked 再刷新（删则重锁丢失＝未成年人保护失效）', file: 'js/clock.js', needle: "cardLockConfirmPersisted('locked', goReloadAfterPersist)" },
  { name: '#404 诊断体检 cardlock-state 全局根键三层值（删则解锁丢失类报障无法判读，per-cid 探针恒缺失误导）', file: 'js/device.js', needle: "const ROOT_KEYS = ['cardlock-state'];" },
  { name: '#404 restore 完成复核解锁态翻转（删则 retainValue 先回填 memoryCache 时 wrj 合并不广播 heal，开屏锁卡停留「输入密码解锁」假象——LS 配额满设备 IDB 唯一值源路径实测复现）', file: 'js/card-lock.js', needle: "addEventListener('mochi-restore-done'" },
  // ==== 2026-09-12 #382 屏幕适配诊断报告「导出docx」点了毫无反应（iQOO neo10pro Chrome 报障，多机型全现）——#333 时 diagExportDocx 在主诊断闭包、屏幕适配诊断闭包跨 IIFE 引用恒 ReferenceError 被 openModal 按钮 try/catch 吞掉；同调用 4 参对 3 形参 legacy 分支必抛 failToast is not a function ====
  { name: '#382 诊断导出跨闭包挂载 window.mochiDiagExportDocx（删则屏幕适配诊断导出恒 ReferenceError 静默失败）', file: 'js/device.js', needle: 'window.mochiDiagExportDocx = diagExportDocx;' },
  { name: '#382 屏幕适配诊断导出改走 window 挂载 + 形参收窄（failMsg,toastFn）', file: 'js/device.js', needle: "(window.mochiDiagExportDocx || function () {})(c ? c.text() : r.text, 'mochi-screen-diag-'" },
  // ==== 2026-09-12 #383 联系人消息乱码直出 @@m:hash（华为畅享70Pro Chrome 报障，多机型全现）——#377 巨型库令牌化后裸 @@m:hash 卡体无 |||、非 data:，getPool 旧两道守卫全漏过＝令牌卡入文字池被当文字直出；normCell 补认裸令牌让存量乱码刷新自愈回图片 ====
  { name: '#383 getPool 媒体令牌卡不进文字池（删则令牌卡再入池被当文字发出。#943 起四道守卫收成 chatHasMediaPayload 一条统一判据，锚点随新写法、语义只强不弱）', file: 'js/chat.js', needle: 'if (typeof c === \'string\' && chatHasMediaPayload(c)) return;' },
  { name: '#383 归一化裸令牌 text 补 type=image（删则存量乱码消息永停留文字气泡。#943 起该判据收口到 chatIsImgSrcLike，锚点收到「令牌＝图片引用」这一条必然存在的分支）', file: 'js/chat.js', needle: 'if (window.mochiMediaIsToken && window.mochiMediaIsToken(s)) return true;' },
  // ==== 2026-09-13 #384 开屏点击进入后强制观看公告（作者道别公告：二传二改/月底停更/二级密码）——每次进入先弹 #splash-mandatory，必须滑到底、点【我已阅读并确认进入】才真正进入；门控=未到底时确认按钮 is-disabled 不可点（clock.js mandBottom/finishEnter） ====
  { name: '#384 强制公告滑到底才可确认进入（删则强制公告可跳过，进入不再必读）', file: 'js/clock.js', needle: 'if (mandBottom) finishEnter();' },
  // ==== 2026-09-13 #385 联系人消息乱码·令牌夹在文字中间直出（续 #383）——#383 只治「整条 text 是裸令牌」（normCell 升 type=image）；多字卡回复 pickN.join(' ') 拼出的混合文本消息里 @@m:hash 嵌在正文中间，type 仍 text，渲染端 escTxtBr 原样铺出令牌串＝乱码（聊天/群聊公用库共享多机型全现）。消费者边界（气泡渲染）统一把内嵌 @@m:<hash32> 行内转 <img>，交 media-pool 观察器解图，存量/新收/任一浏览器不再直出令牌串 ====
  { name: '#385 内嵌令牌转行内图·chat 助手核心逻辑（split 令牌正则——删则令牌串不再转 <img>/<img class=msg-inline-tok> 直出乱码。#948 起同一条 split 并切内联 dataURL 载荷，锚点取两者共同前缀（data: 分支改大小写显式字符类，故不锚其后缀））', file: 'js/chat.js', needle: 's.split(/(@@m:[0-9a-f]{32}|' },
  { name: '#385 chat 文本气泡渲染调用内嵌令牌助手（删调用则助手在但不用，混合乱码消息仍直出令牌串）', file: 'js/chat.js', needle: 'window.mochiInlineTextHtml(T(__rawText))' },
  { name: '#385 单聊撤回段文本也走内嵌令牌助手（撤回复核样直出令牌串复现）', file: 'js/chat.js', needle: 'segHtml += window.mochiInlineTextHtml(' },
  { name: '#385 group-chat 文本气泡/预览走内嵌令牌助手（群聊纯文本气泡改回 escTxtBr 则群聊乱码复现）', file: 'js/group-chat.js', needle: 'window.mochiInlineTextHtml(rec.text' },
  // ==== 2026-09-13 #383b 源头补口三件（本会话，未构建随下次收口）——#385 治渲染端消费者边界，这里治源头：群聊回复池同款两道守卫漏裸令牌（新乱码仍会从群聊发出）、群聊渲染裸令牌 text 走图片分支、bg-keep 保活通知选卡漏判＝通知栏文字出乱码 ====
  { name: '#383b 群聊回复池令牌卡不进文字池（删则群聊继续从源头发出令牌卡。#943 起三道守卫收成 chat.js 的 chatHasMediaPayload 统一判据，锚点随新写法、语义只强不弱）', file: 'js/group-chat.js', needle: 'if (window.chatHasMediaPayload ? window.chatHasMediaPayload(c)' },
  { name: '#383b 群聊渲染裸令牌 text 走图片分支（删则群聊存量整条令牌消息停留文字气泡。#943 起判定借用 chat.js 的 chatIsImgSrcLike，令牌仍在其判据内、锚点随新写法）', file: 'js/group-chat.js', needle: "rec.type !== 'voice' && window.chatIsImgSrcLike && window.chatIsImgSrcLike(rec.text)" },
  { name: '#383b 保活通知选卡剔除媒体令牌卡（删则通知栏文字出乱码）', file: 'js/bg-keep.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false;' },
  // ==== 2026-09-13 #386 信箱/朋友圈令牌乱码（用户复报：聊天已好、信里/朋友圈仍乱码，多机型）——同 #385 消费者边界思路：mail renderBody/feed inlineBody+图片网格 RE 补认 @@m:hash 渲内联图；来源侧 feed cardPool 补第三道令牌守卫+媒体池放行令牌卡；摘要/快照/通知剥离处补令牌→[图片]/[表情包] ====
  { name: '#386 信件正文渲染认媒体令牌（删则信箱信纸直出 @@m:hash 串）', file: 'js/mail.js', needle: '|@@m:[0-9a-f]{32})/g' },
  { name: '#386 朋友圈正文/图片网格渲染认媒体令牌（删则动态/评论直出 @@m:hash 串）', file: 'js/feed.js', needle: '|@@m:[0-9a-f]{32}|data:image' },
  // ==== 2026-09-13 #387 公用库令牌写回泄漏（iPhone 17 Safari/自带浏览器：字卡库表情包纯白图+表情包面板空分组+联系人图片全乱码，多机型）——#377 令牌化内存缓存经 ccAppendCards 公用分支整包写回原始键 cc-groups-public，随公用库/备份传到无媒体池数据设备＝令牌永解不出图；堵口+负缓存剔除+缺失占位 ====
  { name: '#387 ccAppendCards 公用分支改原始键现解析（删则令牌化缓存继续整包写回污染公用库）', file: 'js/chatcard.js', needle: 'const g = buildGroupsFrom(pubStore().get(PUB_KEY));' },
  { name: '#387 isMediaImg 剔除池缺失令牌卡（删则无池设备继续发/显白图卡）', file: 'js/chatcard.js', needle: 'return !(window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(c));' },
  { name: '#387 观察器池缺失负缓存+占位打标（删则令牌白图不可辨且媒体筛选无法剔除）', file: 'js/media-pool.js', needle: 'missing.add(h); markMissing(h); return;' },
  { name: '#387 令牌缺失占位样式（删则白图不可辨）', file: 'css/base.css', needle: 'img.media-tok-missing' },
  // ==== 2026-09-13 #388 回复设置 toast 静默丢失 + 混用自定义字卡默认改回开（用户实报：词典拼字组开关改了没「已保存」提示）——cc-toast 全站懒创建唯独 reply-settings.js 只查不建＝元素不存在静默 return；qs-cc 默认 0→1（#310 存量反向迁移标记 1→2） ====
  { name: '#388 reply-settings toast 懒创建兜底（删则直达回复设置页所有开关「已保存」提示永不弹）', file: 'js/reply-settings.js', needle: 'function ccToastEnsure() {' },
  { name: '#388 qs-cc 默认改回 1（改回 0 则用户点名需求复发）', file: 'js/reply-settings.js', needle: "'qs-en': 1, 'qs-prob': 25, 'qs-cc': 1," },
  { name: '#388 qs-cc 存量反向迁移标记升级 2（删则被 #310 迁移成 0 的桌面回不到默认开）', file: 'js/reply-settings.js', needle: "s.set('reply-qs-cc-migrated', '2');" },
  // ==== 2026-09-13 #391 互动卡/查岗/留言/信件文字池令牌漏判收尾扫（vivo X200s Edge 报「TA 的好奇卡片联系人回复直出 @@m:hash 令牌」）——#383 系只修了聊天/群聊/朋友圈/信箱正文四条主链，getCustomCards 其余 6 个文字池消费方（ta-ask 好奇·吐槽回应/互动卡触发池/文字题连发、chat 查岗回应、calendar 每日留言、mail 信件补池）仍是旧两道守卫＝令牌卡被当文字抽中直出；本批全量补第三道守卫，此后 getCustomCards 全消费方零漏判 ====
  { name: '#391 好奇/互动卡回应文字池剔令牌（删则卡片回复继续直出令牌串）', file: 'js/ta-ask.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(s)) && s.trim()' },
  { name: '#391 互动卡触发池剔令牌（删则互动卡话术直出令牌串）', file: 'js/ta-ask.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false' },
  { name: '#391 文字题答案池剔令牌（删则问问TA答案直出令牌串）', file: 'js/ta-ask.js', needle: 'window.mochiMediaIsToken(s)));' },
  { name: '#391 查岗回应文字池剔令牌（删则查岗回复直出令牌串；#533 起同行并排除 URL 媒体卡，锚点随新写法——逻辑未变）', file: 'js/chat.js', needle: "c.indexOf('data:') !== 0 && !/^https?:\\/\\//i.test(c) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(c));" },
  { name: '#391 每日留言池剔令牌（#426 收敛为 calTextOnly 统一口径，自定义字卡循环锚点；删则日历留言直出令牌串）', file: 'js/calendar.js', needle: 'if (calTextOnly(c)) cards.push(c);' },
  { name: '#391 信件补池剔令牌（#429 收敛为 mailTextOnly 统一口径，自定义字卡循环锚点；删则来信正文拼令牌卡）', file: 'js/mail.js', needle: 'if (!mailTextOnly(s)) return;' },
  // ==== 2026-09-13 #392 二级锁↔词典关系看不懂（用户实报：词典开关都开了没效果，不懂和开屏二级密码的关系）——三处把因果讲成人话：词典独立页红条（锁定时当场提示+去哪解锁）、回复设置自检首闸文案「二级锁→防未成年人锁·锁定中·词典被锁停」、开屏锁卡 tip 补锁定影响面清单 ====
  { name: '#392 词典页二级锁关系提示条（删则锁定时词典开关全开却无效仍零解释）', file: 'js/default-cards.js', needle: 'function renderDictLockHint() {' },
  { name: '#392 词典页提示条锚点（删则提示无处渲染）', file: 'template.html', needle: 'id="dict-lock-hint"' },
  { name: '#392 回复设置自检首闸人话文案（改回「二级锁未解锁」则因果又看不懂）', file: 'js/reply-settings.js', needle: '锁定中·词典被锁停' },
  { name: '#392 开屏锁卡 tip 锁定影响面清单（删则不知道锁定停用了哪些字卡）', file: 'js/clock.js', needle: '锁定影响：默认聊天字卡、词典（含词典拼字）' },
  // ==== 2026-09-14 进入应用后强制弹窗提醒：系统字卡未解锁（未输二级密码）时每次打开应用弹一次长文案，可「知道了」关闭、可就地「输入密码解锁」（进入后开屏锁卡不可见，此为首要应用内解锁入口）====
  { name: '强制弹窗提醒·锁定文案（删则进入应用后不知道字卡为何不可用、也不知应用内可解锁）', file: 'js/clock.js', needle: '系统字卡未解锁，请自行添加字卡使用' },
  { name: '强制弹窗提醒·应用内解锁接线（promptCardUnlock 删则「输入密码解锁」pill 失效=锁定用户进入后无法就地解锁）', file: 'js/clock.js', needle: "v === 'unlock') promptCardUnlock();" },
  // ==== 2026-09-13 #394 全面体检第二批——#391 之后全库复扫「含 ||| 守卫 / 裸 escTxtBr 渲染」所有站点，又抓 9 处：词典语录抽卡池两条、漂流瓶候选池、统计页卡集+消息账+悬浮伴侣话术、词典词条录入校验、聊天 parts 文本/引用块/收藏文本、群聊文本气泡/引用/撤回段（渲染端统一走 #385 mochiInlineTextHtml 助手）====
  { name: '#394 词典语录抽卡池剔令牌（删则词典拼字直出令牌串）', file: 'js/quote-spell.js', needle: 'mochiMediaIsToken(q)) return false' },
  { name: '#394 词典抽卡混入 getPool.text 二次校验剔令牌', file: 'js/quote-spell.js', needle: 'mochiMediaIsToken(s)) return false' },
  { name: '#394 漂流瓶候选池剔令牌（删则瓶内容出令牌串）', file: 'js/drift-bottle.js', needle: "mochiMediaIsToken(s)) return '';" },
  { name: '#394 统计卡集剔令牌（删则常用文字字卡榜出令牌串）', file: 'js/p2-features.js', needle: 'mochiMediaIsToken(c))) set[c] = 1;' },
  { name: '#394 统计消息账剔令牌消息（删则存量乱码上榜）', file: 'js/p2-features.js', needle: 'mochiMediaIsToken(m.text)) return;' },
  { name: '#394 悬浮伴侣话术池剔令牌', file: 'js/p2-features.js', needle: 'mochiMediaIsToken(s)));' },
  { name: '#394 词典词条录入拒绝令牌串（删则令牌可再污染词典池）', file: 'js/default-cards.js', needle: 'mochiMediaIsToken(v))) return { ok: false' },
  { name: '#394 聊天 parts 文本走内嵌令牌助手（删则组合消息文本段直出令牌）', file: 'js/chat.js', needle: 'mochiInlineTextHtml(T(textPart))' },
  { name: '#394 群聊引用文本走内嵌令牌助手（删则群聊引用块直出令牌）', file: 'js/group-chat.js', needle: 'mochiInlineTextHtml(tRaw)' },
  // ==== 2026-09-13 #395 语音条令牌乱码（用户实报「聊天里的语音条也会显示乱码」）——带名字的令牌语音「名称|||@@m:hash」在旧包/存量数据里 type 仍是 text（语音型归一化只认「以 ||| 开头」的无主形态，带名形态漏判）＝整串当纯文本直出；且 voicePartsOf 对裸令牌/令牌当名字会把令牌串显成名称 ====
  { name: '#395 语音型归一化补认「名称|||令牌」形态（删则带名令牌语音消息继续当文本直出令牌串）', file: 'js/chat.js', needle: "r.text.indexOf('|||') >= 0 && /@@m:[0-9a-f]{32}$/.test(r.text)" },
  { name: '#395 voicePartsOf 裸令牌防御（删则令牌串被显成语音名称）', file: 'js/chat.js', needle: 'mochiMediaIsToken(raw)) return { name:' },
  { name: '#395 群聊语音分支令牌防御（删则群聊语音条显令牌串）', file: 'js/group-chat.js', needle: 'mochiMediaIsToken(_vraw));' },
  // ==== 2026-09-13 #397 收藏页图片被渲染成语音条 + iOS 卡顿点不动（iPhone 16 Safari 报障，多机型）——①#356 的语音判定正则含 ^ 分支＝裸令牌（图片载荷）被当语音；②缺失令牌每次渲染都重打 idbGet＋每个缺失 hash 各做一次全文档查询＝坏图成片设备主线程打满 ====
  { name: '#397 收藏语音判定必须带 |||（改回含 ^ 分支则图片收藏又变语音条。#943 起载荷判定收口 chatIsDataAudioSrc，锚点随新写法、「必带 |||」语义不变）', file: 'js/chat.js', needle: "f.text.indexOf('|||') >= 0 && (chatIsDataAudioSrc(" },
  { name: '#397 同元素同令牌只打一次 IDB（删则观察器重扫重复读＝坏图设备主线程打满卡住；新元素不受限故补池自愈保留）', file: 'js/media-pool.js', needle: "if (img.dataset && img.dataset.tokTried === h) return;" },
  { name: '#397 缺失读并发上限（删则坏图成片时一次打出几十个 IDB 读）', file: 'js/media-pool.js', needle: 'let missReads = 0;' },
  { name: '#397 缺失占位批量打标（改回逐 hash 全文档查询则坏图成片时尖峰）', file: 'js/media-pool.js', needle: 'const markQueue = new Set();' },
  { name: '#397 恢复事件清缺失负缓存（删则导入完整备份后坏图要等冷却/重启才恢复）', file: 'js/media-pool.js', needle: "mochi-restore-done', function () { missing.clear(); }" },
  // ==== 2026-09-13 #399 回信页滑不动/弹来弹去（用户实报，多机型同族）——安卓 ceConvert 退场的幽灵 textarea 未真正脱离布局流：.mail-compose-input{min-height:220px} 反压 height:1px!important，且 absolute 无定位＝沿用流内静态位置，回信页原信越长锚点落得越深、把 .phone 的幻影可滚动溢出撑到 1317px（写信页/聊天页 0）；内核「滚进视野」连带滚走 .phone＝整壳上移不弹回 ====
  { name: '#399 幽灵锚点零布局足迹·高度钳死（删则页面级 min-height 再反压 height:1px!important，退场锚点变实高盒子）', file: 'css/base.css', needle: 'min-height:0 !important; max-height:none !important;' },
  { name: '#399 幽灵锚点钉在包含块角上（删 top/left 则 absolute 沿用流内静态位置，深内容页再撑出 .phone 幻影溢出）', file: 'css/base.css', needle: 'position:absolute; top:0; left:0; width:1px !important; height:1px !important;' },
  { name: '#399 .phone 非滚动容器（overflow:clip；删则内核「把聚焦元素滚进视野」可再次整体滚走手机壳）', file: 'css/base.css', needle: 'overflow:hidden; overflow:clip;' },
  // ==== 2026-09-13 #398 令牌化管线并发风暴（iPhone 14 Pro/16 Safari「持续卡顿动不了」多机型；起病时间= #377 上线）——ccTokenizeGiantMedia 对每张大卡并发 mochiMediaTokenize（全量 TextEncoder+SHA-256 同挤主线程）且每次缓存重建全量重算；修复=串行+每张让出主线程+会话哈希备忘（FIFO 字符预算 8M）+世代计数防跨重建覆盖 ====
  { name: '#398 令牌化管线串行化+世代计数（#455 演进=pub/own 分槽：改回并发 Promise 链或删分槽世代则大库设备持续卡死/跨库互杀令牌化）', file: 'js/chatcard.js', needle: 'const gen = ++ccTokGen[sl];' },
  // ==== 2026-09-13 #402 进聊天界面跳动一下（多机型偶发，#352 无头诊断实锤）——归一化收尾对「窗口内改动」走 renderWindow 整窗重建＝rem+add ~200 节点同批＝进入聊天 ~0.5s 后整屏跳一下；修复=无结构删除时对 normChangedIdxs 命中下标原位换节点（patchChangedInPlace），其余节点零重建 ====
  { name: '#402 归一化收尾原位补丁函数（删则窗口内改动回退整窗重建＝进聊天整屏跳一下复发）', file: 'js/chat.js', needle: 'function patchChangedInPlace(changedIdxs, start) {' },
  { name: '#402 归一化改动下标登记（删则原位补丁拿不到命中清单＝静默回退整窗；#675 起同行同步登记改动记录对象）', file: 'js/chat.js', needle: 'if (normChangedIdxs.indexOf(i) < 0) normChangedIdxs.push(i); try { normChangedRecs.push(msgs[i]); } catch (e) {} } }' },
  { name: '#402 收尾优先原位补丁分支（删/改回无条件 renderWindow 则闪跳复发）', file: 'js/chat.js', needle: 'patchChangedInPlace(normChangedIdxs, renderStart)' },
  // ==== 2026-09-17 #675 打开聊天「消息全部弹一下再恢复」（同族第五轮，用户复发报障）——归一化删相邻重复（removedAll>0）时 finish 仍 renderWindow 整窗重建＝进聊天 ~250ms 后 200 气泡连 img 整批销毁重建、图片逐张重新解码＝肉眼全弹一下；修复=patchNormRemovalsInPlace 按记录→原始下标原地删节点+幸存 data-idx 回推，零整窗重建 ====
  { name: '#675a 删除原位收敛函数（删回整窗重建＝打开聊天全弹一下复发）', file: 'js/chat.js', needle: 'function patchNormRemovalsInPlace(removedRecs) {' },
  { name: '#675b 归一化原始下标映射（无映射则删除路径静默回退整窗）', file: 'js/chat.js', needle: 'normOrigIdx.set(msgs[_oi], _oi); } catch (e) { normOrigIdx = null; }' },
  { name: '#675c 删除记录对象登记（删了不登记＝原位收敛拿不到删除清单回退整窗）', file: 'js/chat.js', needle: 'try { if (normRemovedRecs) normRemovedRecs.push(a); } catch (e) {} // FIX #675' },
  { name: '#675d 收尾删除路径接线（改回 removedAll>0 无条件 renderWindow 则复发）', file: 'js/chat.js', needle: 'patched = patchChangedInPlace(newIdxs, renderStart);' },
  // ==== 2026-09-13 #403 漂流瓶都是空白没有留言（多机型）——dcf-drift 概率/总开关关断时 poolLine 返回空串，normal/special/TA 兜底全落空＝瓶子装空白信纸；修复=三道来源全空回退内置兜底话术（FB），瓶内文案永不落空 ====
  { name: '#403 TA 瓶三道来源全空回退内置兜底（删则 dcf 关断+无历史时出空白信纸）', file: 'js/drift-bottle.js', needle: "note = sampleHistLine() || poolLine('TA的话', 'ta') || rnd(FB.ta);" },
  { name: '#403 普通/特殊瓶文案永不落空（删则 dcf 关断时 normal/special 瓶空白）', file: 'js/drift-bottle.js', needle: "note = poolLine('海风', 'sea') || rnd(FB.sea);" },
  { name: '#400 收藏分类内容优先（改回信任存储 type 则误存语音的图片收藏又变语音条）', file: 'js/chat.js', needle: 'const isVoice = looksVoice;' },
  // ==== 2026-09-13 #406 后台来电点开通知无弹窗也无未接消息（OPPO Reno14 Edge 实报，多机型同族；诊断「LS 写入失败 QuotaExceededError」实锤）——holdIncomingCall 的 LS setItem 与 idbSet 同处一个 try，LS 配额满一抛整块中止、IDB 也不写＝后台只有通知没有挂起；且 resumeHeldCall 只读 LS、后台触发的来电（跨桌面/后台定时命中）重响从不补首发「打来了语音通话」系统消息。修复=①挂起双写拆开各吃各的 try，LS 失败 IDB 仍落；②resumeHeldCall 先读 LS 读不到再回读 IDB（holdBusy 防双处理）；③挂起携带 msg 已写标记，后台来电重响补首发系统消息 ====
  { name: '#406 挂起双写拆开（删则 LS 配额满一抛整块中止、IDB 也不写＝通知照发回前台什么也没有）', file: 'js/call.js', needle: 'window.idbSet(CALL_HOLD_KEY, h);' },
  { name: '#406 回前台/冷启动挂起回读 IDB 兜底（删则 LS 配额满时挂起只落 IDB、回前台读不到＝无弹窗也无未接）', file: 'js/call.js', needle: 'window.idbGet(CALL_HOLD_KEY)' },
  { name: '#406 后台来电重响补首发系统消息（删/改回 !isReplay 则后台触发来电聊天里永远没有来电系统消息）', file: 'js/call.js', needle: '(!isReplay || !msgWritten) && window.chatAddSystem' },
  // ==== 2026-09-17 #699 刷新后通话没续上、也没补「通话中断」记录（多机型，用户直派）——saveCallActive 里 sessionStorage 与 localStorage 双写同处一个 try，存储亚健康机型（LS 配额满 QuotaExceededError 同 #406 实锤 / 隐私模式 / WebView 禁用 sessionStorage）第一句一抛整块中止，call-active 一份都没落盘＝recoverCall 读不到任何标记，通话不续也不记；且该标记从没写 IDB（call-hold #406 补了、call-active 漏了）。修复=①三路写入拆开各吃各的 try＋追加 IDB 副本；②recoverCall 回读链 sessionStorage→localStorage→IDB；③clearCallActive 写 {ts:0} 墓碑防 idbRestore 幽灵回填；④IDB 副本卡 10 分钟新鲜度窗（同 #120/callInProgress 口径），防数天后翻旧通话 ====
  { name: '#699a call-active 三路写入拆开＋IDB 副本（删/并回同一 try 则存储亚健康机型一抛全丢＝刷新后通话不续也不记）', file: 'js/call.js', needle: 'window.idbSet(CALL_ACTIVE_KEY, JSON.parse(payload))' },
  { name: '#699b clearCallActive 写 {ts:0} 墓碑（删则 idbRestore 用 IDB 旧值回填出幽灵标记）', file: 'js/call.js', needle: 'window.idbSet(CALL_ACTIVE_KEY, { ts: 0 })' },
  { name: '#699c recoverCall 回读链补 IDB 兜底（删则两路 LS 都没写成时永远读不回）', file: 'js/call.js', needle: "recoverProcess(ih, 'idb')" },
  // ==== 2026-09-17 #700 音乐：本地上传 m4a「导入一直不成功/无法播放」+ 网易云分享链接「导进去但无法播放」（荣耀X50i/Edge 实报、多机型同现，用户直派）——
  //      实测：短链歌本身免费可播（injahow 302→https CDN），坏在 163cn.tv 解析环节——proxy.cors.sh 域名失联/allorigins 超时＝全机型一致解析必败，且解析失败后导入与播放双双静默返回＝「点播放毫无反应」；
  //      fetchNeteaseInfo 歌名识别全押死代理→歌名停在「网易云音乐-数字」；本地 m4a 导入时 tmp 探测 onerror（加密格式/ALAC 编码解不动）代码不看不报、播放双路白试 8s 只给笼统提示；面板说明「先下载成音频文件再传」与事实不符（App 下载的多带加密）＝用户指「说明有错误」。
  //      修复=短链解析失败两处给可执行指引不再静默；歌名识别首选 meting type=song（CORS 开放、实测存活）；本地上传文件头 MIME 嗅探＋探测反馈（probeFail 徽标+toast 计数+onplay 自愈）＋MediaError.code=4 跳过徒劳 dataURL 重试给「转 mp3」精确提示（其余失败 blob↔dataURL 互备原样保留，不碰永恒/夸克兜底）；说明三处纠错 ====
  { name: '#700a 本地文件 MIME 嗅探链（删则 m4a/安卓空 type 一律标 audio/mpeg，严格内核拒载回归）', file: 'js/music-player.js', needle: "sniffAudioMime(buf) || file.type || mimeFromName(file.name) || 'audio/mpeg'" },
  { name: '#700b 导入时探测解不动的文件即计数（删则顶着「已上传」成功提示反复重传回归）', file: 'js/music-player.js', needle: 'probeBad++;' },
  { name: '#700c 列表「放不了」徽标接线（删则用户看不出哪首是解不动的文件）', file: 'js/music-player.js', needle: "m.probeFail ? '<span class=\"sm-src sm-src-bad\">放不了</span>'" },
  { name: '#700d 真播放成功自愈清 probeFail（删则探测误报永不消失）', file: 'js/music-player.js', needle: 'delete m.probeFail; saveLibrary(); renderLibrary();' },
  { name: '#700e MediaError.code=4 跳过徒劳 dataURL 重试＋精确提示（删回则加密/ALAC 文件白等 8 秒只剩笼统报错；其余失败路径仍互备不受影响）', file: 'js/music-player.js', needle: '放不了这个文件：编码不被本机浏览器支持' },
  { name: '#700f 短链播放时解析失败不再静默返回（删则点播放毫无反应＝主诉回归）', file: 'js/music-player.js', needle: '分享链接解析失败（解析服务受限）' },
  { name: '#700g 短链导入时解析失败不再静默（删则短链原样入库毫无提示回归）', file: 'js/music-player.js', needle: '网易云分享链接解析失败：先用浏览器打开这条链接' },
  { name: '#700h 歌名识别首选 meting song 接口（删回死代理抓页链路则歌名全停在「网易云音乐-数字」）', file: 'js/music-player.js', needle: 'meting/?server=netease&type=song&id=' },
  { name: '#700i 功能介绍页「上传音乐只认不加密的标准音频」说明（删则加密文件放不出又被当网站 bug）', file: 'template.html', needle: '上传音乐只认不加密的标准音频' },
  { name: '#700j 「放不了」徽标样式（删则徽标无色不可辨）', file: 'css/chat-pages.css', needle: '.sm-src-bad' },
  // ==== 2026-09-17 #703 聊天冷进「没有加载缓冲动画、卡几秒」（用户直派：切桌面后点开聊天，屏上零反馈数秒）——切桌面后进聊天，LS 尾部快照（或快速预读）先把 msgs 填上几条，updateChatLoading 的「!msgs.length」前置把进度条压掉；权威大包继续读数秒后 200 气泡+百张图集中渲染解码（无头 4× 节流实证：进度条全程未显示、803ms 长任务）。修复=①条件去掉 msgs 前置（聊天页可见且权威未就绪即显示）；②enterChat 先置位再 loadMsgs（LS 同步 parse 前先让进度条就位）；③权威读库收尾补一次收起（覆盖 changed=false 且屏上已有内容、不走 renderWindow 的路径） ====
  { name: '#703a 进度条条件去掉 msgs 为空前置（删回则快照先到时整段权威读取窗口零加载反馈＝主诉回归；表达式锚归 #526，本条锚行尾注释）', file: 'js/chat.js', needle: '// #703：去掉「msgs 为空」前置' },
  { name: '#703b enterChat 先置位进度条再 loadMsgs（删回则 LS 同步 parse 期间零反馈）', file: 'js/chat.js', needle: 'updateChatLoading(); // #703：先于 loadMsgs 置位' },
  { name: '#703c 权威读库收尾收起进度条（删则 changed=false 且屏上已有快照时进度条挂死不收）', file: 'js/chat.js', needle: '// #703：权威就绪即收起进度条' },
  // ==== 2026-09-17 #704 表情包面板「每次打开所有图片重新加载」大库残留（用户直派：#662/#692 后真机仍现）——emojiShowWhenDecoded 对面板里全部 img[src] await decode，大库几十上百张在低内存机型隐藏期被回收位图，总解码时长远超 1s 兜底＝兜底放行后剩余图逐张冒出（1s 兜底在大库机型是常规路径而非保险）。修复=首屏优先：前 16 张 data-src 图同步补 src、按 DOM 序前 24 张 await decode 后即显示、其余 fire-and-forget 预热不挡显示 ====
  { name: '#704a 面板显示只等首屏解码（删回 await 全部则大库机型超 1s 兜底放行＝逐张冒出回归）', file: 'js/chat.js', needle: 'const EMOJI_DECODE_AWAIT_MAX = 24;' },
  { name: '#704b 首屏图同步补 src 不等懒加载泵（删回则首屏图干等 50ms/4 张泵＝打开变慢；#1011 起改成载荷感知：令牌当场交池、载荷当场补 src）', file: 'js/chat.js', needle: "im.setAttribute('src', ds);" },
  // ==== 2026-09-17 #701 自定义字卡「全量导出点击没反应」（红米 Note 11 5G 夸克实报、多机型同现，用户直派）——点击后整条前置 Promise 链（hydrateLibScopes IDB 大键取回 / ccExportExpandTokens 媒体池还原）任一环在部分安卓壳上挂起不落定＝.then 干等，无 toast 无弹窗零反馈；且全量导出/导入缺范围说明（专属部分=当前桌面联系人，用户直派补说明）。修复=①导出先弹范围说明弹窗（开始导出才跑链）＋点后立刻「正在准备导出…」toast；②取回/还原两环 ccFullWithTimeout 超时兜底（4s/8s）按已就绪数据继续，catch 不再吞；③导入链同款超时兜底＋导入弹窗补「专属导入到当前桌面」说明；④模板两入口副标题补专属归属说明 ====
  { name: '#701a 全量导出前置链超时兜底（删回 .then 干等则安卓壳 IDB 取回挂起＝点导出零反应回归）', file: 'js/chatcard.js', needle: 'ccFullWithTimeout(Promise.resolve(hydrateLibScopes([\'public\', \'own\'])).catch(() => {}), 4000, null).then(build)' },
  { name: '#701b 媒体池令牌还原超时兜底＋catch（删则 @@m 令牌还原挂起同样静默卡死；2026-09-18 收口换锚＝导出链改四库并发 expJobs 后现形态，单行）', file: 'js/chatcard.js', needle: 'Promise.all(expJobs).catch(() => expJobs.map(zero))' },
  { name: '#701c 全量导出范围说明弹窗（专属=当前桌面；删则用户不知道导了什么、专属归属哪桌面；2026-09-18 收口换锚＝弹窗文案改「专属」「互动功能字卡（专属库部分）」后现形态，单行）', file: 'js/chatcard.js', needle: '换机恢复时，请切到对应联系人桌面再导入' },
  { name: '#701d 导出点击即有反馈 toast（删则说明弹窗外链路期间零反馈）', file: 'js/chatcard.js', needle: "toast('正在准备导出…')" },
  { name: '#701e 全量导入链超时兜底（删回 .then 干等则安卓壳导入选完方式后无反应）', file: 'js/chatcard.js', needle: "ccFullWithTimeout(Promise.resolve(hydrateLibScopes(['public', 'own'])).catch(() => {}), 4000, null).then(() => { ccFullApply(d, mode); })" },
  { name: '#701f 导入弹窗补专属归属说明（删则跨桌面导入弄丢专属字卡不可知）', file: 'js/chatcard.js', needle: '如文件来自别的桌面，请先切到对应联系人桌面再导入' },
  { name: '#701g 全量导出入口副标题标明专属=当前桌面（删则列表页看不出导出归属）', file: 'template.html', needle: '专属部分=当前桌面联系人）</div>' },
  // ==== 2026-09-17 #706 聊天「所有消息不贴底、停在上半屏/中部；输入栏只有打字时可见；发消息低栏弹跳」（iPhone 17 Safari 26.6 iOS 独立应用实报、多机型同现，用户直派要求勿致他型回归）——#466/#643 两级回钉都是「事件触发+60ms 单次防抖」，iOS 26 Safari 起 interactive-widget=resizes-content 被真正执行（键盘期 innerHeight 本体参与变形、vv/inner 分多帧落位），回钉写入落在中间态布局后无人再校正＝列表永久停错位。修复=几何看门狗：聊天页可见且钉住态时每 250ms 复核 scrollTop 是否等于 chatScrollMax（行隐藏态口径），差 >8px 且视口变形落定（最近 180ms 无 vv/inner 变化）才补钉——只认几何事实、机型零分支；仍受 #162 钉住闸（用户翻历史解钉绝不拽底）与 #416 ≤8px 口径约束 ====
  { name: '#706a 贴底几何看门狗补钉判定（删回事件单发制则 iOS 26 键盘变形后消息永久停半屏＝主诉回归）', file: 'js/chat.js', needle: 'if (cb706.scrollTop < chatScrollMax() - 8) scrollChatBottom();' },
  { name: '#706b 看门狗视口变形落定闸（删回变形中就写则发消息低栏钳位回弹＝弹跳回归）', file: 'js/chat.js', needle: 'if (Date.now() - _vvGeomChangeTs < 180) return; // 视口变形进行中不写，等落定' },
  // ==== 2026-09-18 #707 屏幕位置微调（用户直派：「设置自由一点，用户自己调和设置」——跨设备屏幕适配修不完，给本机永久手动三轴偏移）——mobile-adapt.js 包装 documentElement.style 的 set/remove/get 做「系统基准+用户偏移」双层（写入方无感、DOM 同值写零重排零抖动），底部独立写 calc(env()+偏移)（安卓键盘期钉 0 照旧、收键后 1s 复述补回）；personalize.js 三行弹窗接线（±80px，0=恢复默认）；偏移存根命名空间 LS（跨桌面共用） ====
  { name: '#707a 顶层样式双层值包装（删回直写则用户偏移被系统写入方按基准覆写＝微调失效回归）', file: 'js/mobile-adapt.js', needle: "if (NAMES[n] !== undefined && base[n] !== undefined) return (base[n] + adj[NAMES[n]]) + 'px';" },
  { name: '#707b 底部偏移 calc(env) 写入（删回写裸 px 则无 env 基准的机型手势条区算错）', file: 'js/mobile-adapt.js', needle: "'calc(env(safe-area-inset-bottom, 0px) + ' + adj.bottom + 'px)'" },
  { name: '#707c 设置页统一面板接线走 mochiScreenAdj（删则步进/输入改值不落层＝改了没反应）', file: 'js/personalize.js', needle: 'function applyAxis(ax, nv, silent) {' },
  { name: '#707l 整体位移轴消费规则（删则整页偏移遮挡无处拉回＝.phone top 位移失效）', file: 'css/base.css', needle: '.phone { top: var(--mochi-shift-adj, 0px); }' },
  { name: '#707m 整体位移轴写入（删则设了位移也不落 var＝整体位移没反应）', file: 'js/mobile-adapt.js', needle: "if (adj.shift) origSet('--mochi-shift-adj', adj.shift + 'px');" },
  { name: '#707j 桌面轴消费规则（删则全屏图标偏上无处拉回＝#desktop-pages padding-top 失效）', file: 'css/home.css', needle: '#desktop-pages { padding-top: var(--mochi-desk-adj, 0px); }' },
  { name: '#707k 桌面轴写入（删则设了偏移也不落 var＝桌面微调没反应）', file: 'js/mobile-adapt.js', needle: "if (adj.desk) origSet('--mochi-desk-adj', adj.desk + 'px');" },
  // ==== 2026-09-18 #764 屏幕适配微调（用户拍板：#707「屏幕位置设置」合并升级为独立显眼功能——
  // 工具区首位 + 六轴滑杆实时预览 + 双击复位 + 「文字大小」第六轴）——文字轴走 --mochi-text-adj
  // 由 display-tune.css 逐条 calc 叠加（气泡/输入框/设置行等文字组），刻意不走 zoom/scale（红线）；
  // all() 旧版只回三轴＝面板上桌面/整体位移显示 undefinedpx，本批一并补齐 ====
  { name: '#764a 文字轴写入 --mochi-text-adj（删＝文字大小拖了没反应＝第六轴失效复发）', file: 'js/mobile-adapt.js', needle: "if (adj.text) origSet('--mochi-text-adj', adj.text + 'px');" },
  { name: '#764b all() 回满七轴（删回三轴＝面板桌面/整体位移显示 undefinedpx、滑杆初值丢；2026-09-19 #794 加 side 轴随新形态换锚）', file: 'js/mobile-adapt.js', needle: 'all: function () { return { top: adj.top, bottom: adj.bottom, h: adj.h, desk: adj.desk, shift: adj.shift, text: adj.text, side: adj.side }; },' },
  { name: '#764c 文字大小轴注册（删行＝面板只剩五轴、字号诉求回流）', file: 'js/personalize.js', needle: "{ k: 'text', name: '文字大小', min: 0, max: 12" },
  { name: '#764d 滑杆实时预览接线（删＝又退回步进/手输猜值模式）', file: 'js/personalize.js', needle: "rng.setAttribute('data-adj-slider', ax.k);" },
  { name: '#764e 文字轴消费规则（删＝--mochi-text-adj 无人消费，字号轴空转）', file: 'css/display-tune.css', needle: '.msg-bubble { font-size: calc(var(--chat-font-size, 14px) + var(--mochi-text-adj, 0px)); }' },
  { name: '#764f 面板 hidden 真隐藏规则（删＝内联 display:flex 压过 UA，返回键置 hidden 面板不消失）', file: 'css/display-tune.css', needle: '#screen-adj-panel[hidden] { display: none !important; }' },
  { name: '#764g 工具区首位独立入口行（删＝功能又藏进诊断组不显眼，用户报「找不到」复发）', file: 'template.html', needle: '屏幕适配微调<span class="sub">' },
  { name: '#764h 返回键先关微调面板（删回不含＝安卓返回直接退页不关面板）', file: 'js/tabs.js', needle: "'screen-adj-panel'];" },
  { name: '#764i 输入框 contenteditable 形态字号消费（删＝base.css 防 iOS 聚焦缩放的 .phone [contenteditable=16px] 截胡，文字轴对输入框永远无效——隔离构建真浏览器实测）', file: 'css/display-tune.css', needle: '.phone .chat-input[contenteditable="true"] { font-size: calc(15px + var(--mochi-text-adj, 0px)); }' },
  // ==== 2026-09-18 信箱纯性能批（收口者按其 WORKLOG 委托补登）——该批曾被并行会话旧缓冲回写整文件打回 HEAD 一次，
  // 哨兵是唯一能拦住它再来一遍的东西；needle 均为「逻辑锚点」：实现被改坏即消失 ====
  { name: '信箱 load 解析缓存接线（删 cachedParse 调用＝每帧全量 JSON.parse 数百 KB dataURL 键，卡顿回归）', file: 'js/mail.js', needle: 'cachedParse(prefixFor(cid)' },
  { name: '信箱 render 可见性门槛（删＝页面隐藏时仍整列表重绘，不可见不渲染优化回流）', file: 'js/mail.js', needle: 'if (mpEl && mpEl.hidden) return;' },
  // ==== 2026-09-18 #709 音乐遗留（自查发现，#700 同族收尾；编号让位：#707 已被屏幕微调/滑动卡顿两批占用、#708 已被通知自检占用）——歌单导入的 VIP 自动移除依赖官方 v6 详情走公共 CORS 代理，proxy.cors.sh 等已域名级失联（#700 实测）＝全机型 VIP 歌都不再被自动移除，与常见问题「歌单导入会自动移除这类歌曲」承诺不符。修复=时长探测（meting <audio>）失败的歌用 meting type=url 二次确认（免费歌必 302→音频 CDN；VIP/失效歌 200+非音频正文且无跳转；fetch 失败＝离线＝宁可不删），确认 VIP 才按 v6 fee 路径同口径移除（仅 sm_pl_ 歌单批次，单曲链接维持既有文档口径）；移除逻辑收敛 removeBatchVipSongs 共享助手；移除已死 meting 镜像 api.i-meto.com（2026-09-17 实测整体 401）====
  { name: '#709a meting type=url VIP 二次确认判据（删则歌单导入的 VIP 永不移除＝FAQ 承诺落空回归）', file: 'js/music-player.js', needle: 'var free = !!(r.redirected || /^audio\\//i.test(ct));' },
  { name: '#709b 探测失败仅对 sm_pl_ 歌单批次二次确认＋_vipChecked 去重（删/放开到单曲则断网误删或重复请求）', file: 'js/music-player.js', needle: "if (m && m.neteaseId && /^sm_pl_/.test(m.id) && !m._vipChecked && findTrack(m.id))" },
  { name: '#709c VIP 移除收敛共享助手（v6 fee 路径与探测兜底同口径；删回两份内联则改一处漏一处）', file: 'js/music-player.js', needle: 'function removeBatchVipSongs(tracks)' },
  // ==== 2026-09-18 #710 群聊「进群白屏干等无加载反馈」（#703 同族收尾，用户确认补；编号让位：#708 已被通知自检批占用）——enterGroupChat→loadMsgs 先渲 LS 快照、再 IDB 异步读群消息大键，大群/LS 空窗口整屏空白零提示（群聊页此前连进度条元素都没有）。修复=①template 群聊页加 #gc-loading（复用单聊 .chat-loading 同款样式类，跨域改 template 仅追加此锚）；②loadMsgs 读库前置位、落定/切群/兜底 12s 即收起（gcLoadSeq 作废旧等待，#243 串群守卫路径不误收） ====
  { name: '#710a 群聊页加载条模板锚点（删则进度条无处挂载＝进群白屏无反馈回归）', file: 'template.html', needle: 'id="gc-loading"' },
  { name: '#710b 进度条显隐绑「页面可见且权威在途」（删回则 LS 快照先到时读库窗口零反馈）', file: 'js/group-chat.js', needle: 'gcLoadingEl.hidden = !(page && !page.hidden && gcAuthPending);' },
  { name: '#710c 读库落定收起＋切群作废旧等待（删则进度条挂死/旧群等待误收新群进度条）', file: 'js/group-chat.js', needle: 'function gcLoadSettle(seq)' },
  // ==== 2026-09-18 #772 群聊「打开网页后第一次进群，聊天记录闪一下才正常」——enterGroupChat 先按 LS 快照 renderAll，随后 idbGet 权威回来时旧码 `a.length >= msgs.length` 含相等分支：小记录快照＝全量同内容，仍整页 innerHTML 清空重渲＋图片重新解码，冷启动 IDB 读取稍慢时两次渲染间隔肉眼可见＝闪屏。修复=同条数且快照非 lite（大记录裁剪/lite 场景照旧重渲）时只采纳权威数据不重渲 ====
  { name: '#772 IDB 权威与快照同内容时跳过整页重渲（删回则每次进群必二连渲染＝冷启动闪屏回归）', file: 'js/group-chat.js', needle: 'if (!sameAsRendered) renderAll();' },
  // ==== 2026-09-18 #773 「多字卡回复」来源 tag 与气泡实际内容不符（用户实报、多机型同现，零机型分支）——根因①判据用掷出张数 n 而非实拼 segs 数；②多字卡文本落到默认字卡/回应字卡/空文兜底三处整条替换不回冲；#773c＝历史气泡存量错 chip 由归一化逐条自愈（宁残留不误摘）。行为断言见 tools/verify-py-multicard-tag.mjs（A 组生成链＋B 组存量自愈） ====
  { name: '#773 多字卡来源 tag 按实际拼出张数且整条替换时回冲（改回 n>=2 或删回冲＝一张卡挂「多字卡回复」回归）', file: 'js/chat.js', needle: 'if (segs.length >= 2) pyMultiDrawn = true;' },
  { name: '#773b 空文兜底换一张前回冲多字卡标志（删＝全空白池拼空文落 #185 兜底换一张话术仍挂多字卡 chip）', file: 'js/chat.js', needle: 'if (pyMultiDrawn && (typeof t !==' },
  { name: '#773c 历史多字卡错 chip 归一化逐条自愈（删＝存量气泡错标签永不清理，用户直派「清理历史气泡的错标签」）', file: 'js/chat.js', needle: 'if (pyChipDropIfSingle(r)) c = true;' },
  // ==== 2026-09-18 #716 红米 K80 Chrome 三联实报（多机型同族，用户直派「不要覆盖修改导致不同型号设备反复出现」）——①表情包面板/头像互动「每次打开图片闪烁重载」：#704 后表情侧兜底仍 1s、大库机型首屏 24 张解码超 1s 半途放行＝可见逐格冒出；头像互动半框（avatar-lib avShowWhenDecoded）还是「等全部 img[src] 解码」的 #704 修前形态。②桌面进聊天「正在加载聊天记录」挂很久进不去：idbGet 固定 4s+4s 读等待，41.2MB 的 default:chat-msgs 单次读取+反序列化超 8s ⇒ 每次尝试都超时=undefined → chat.js 6 次×5s 重试每次重读 41MB 全失败（写入侧 idbSetAll 早已按字节放大超时，读取侧漏了同款）。③聊天底部上滑看历史「反复回弹、刚开始滑动最明显」：touchstart 即解钉，但手势刚开始离底 ≤8px 时 #378「解钉后滚回贴底＝回钉」100ms 防抖误判回钉 → #706 看门狗每 250ms 与进行中的手势对打。修复=①表情兜底 1s→2.5s＋头像半框同款首屏 24 张 await/其余预热；②idbGet 支持 minWaitMs 按量放大（≤60s、其余调用方零变化）＋账本 b 字节回填＋loadMsgs 按量给提示窗；③chatTouchActive 手势闸——触摸期禁 #378 自动回钉、看门狗让路。④开屏「正在加载数据…」加省略号步进动画（缓冲感，纯 CSS） ====
  { name: '#716a idbGet 读等待窗可按量放大（删回固定 4s+4s 则 41MB 级历史永远读不出来＝加载不进去回归）', file: 'js/idb.js', needle: 'const minWait = (ambiable && typeof ambiable.minWaitMs === ' },
  { name: '#716b loadMsgs 按账本字节给读取提示窗（删则大键读取提示永不生效＝超时循环回归）', file: 'js/chat.js', needle: 'bigReadMs > 4000 ? { minWaitMs: bigReadMs } : undefined' },
  { name: '#716c 账本补读回填 b 字节（删则冷启动会话首读拿不到体积=提示窗缺位）', file: 'js/chat.js', needle: 'chatLedgerBytes[prefix] = o.b' },
  { name: '#716d 手势期禁 #378 自动回钉（删回则刚开始上滑离底 ≤8px 被误判回钉拽回＝反复回弹回归）', file: 'js/chat.js', needle: 'else if (!chatPinnedBottom && !chatTouchActive && chatAtBottom()) {' },
  { name: '#716e 看门狗手势期让路（删回则 250ms 周期与用户上滑对打＝反复回弹回归）', file: 'js/chat.js', needle: '_ccSmoothT || chatTouchActive) return;' },
  { name: '#716f 触摸手势旗标接线（删则 d/e 两处闸恒不生效）', file: 'js/chat.js', needle: 'chatTouchActive = true;' },
  { name: '#716g 表情面板显示兜底 1s→2.5s（删回 1s 则大库机型首屏解码半途放行＝闪烁重载回归）', file: 'js/chat.js', needle: 'setTimeout(fin, 2500);' },
  { name: '#716h 头像半框只等首屏解码（删回 await 全部则大头像库打开半途放行＝闪烁重载回归）', file: 'js/avatar-lib.js', needle: 'const AV_DECODE_AWAIT_MAX = 24;' },
  { name: '#716i 开屏加载省略号动画（删则大数据桌面恢复期无缓冲感）', file: 'css/base.css', needle: '@keyframes splashDots' },
  // ==== 2026-09-18 #720 两项「优化」批（用户点名做 2/3，K80 诊断单画像：JS 堆 631MB、两条 898/924ms 长任务）——②整窗渲染分帧：冷路径（keepScroll=false）renderMsg 一口气建 200 条＝单条数百毫秒长任务（权威到达/冷进那一下「卡住＋进度条冻结」）→ 每批 50 条进 fragment、帧间让路、世代令牌防重入、keepScroll 同步路径零变化；③LS 残留大键补扫：xyStore.set 对 >200KB 值只进 IDB+内存并删 LS 副本，但老版本写入的键内容涨过限后未再 set＝LS 挂着残留双倍副本（实测 fav-msgs 207KB）→ 回填就绪后 20s 一次性补扫（仅内存缓存已持有该键时删、chat-msgs/gc-msgs/chat-arch/chat-meta 兜底族不碰） ====
  { name: '#720a 整窗渲染分帧构建（删回一口气渲染则冷进/权威到达单条数百毫秒长任务回归）', file: 'js/chat.js', needle: 'const RENDER_CHUNK = 50;' },
  // #720b 换锚（2026-09-21 #972）：原 needle 是 buildChunk 早退整行 `...catch (e) {} return; }`，
  // #972 在同一分支 return 前补了「作废轮释放自己那份批量头像缓存」，整行形态失配。换锚取语义
  // 前缀（世代令牌不匹配＝本轮作废，先回填草稿再收尾），防重入逻辑只强不弱。
  { name: '#720b 分帧世代令牌防重入（删则新一轮渲染与旧构建交错＝窗口错乱）', file: 'js/chat.js', needle: 'if (myToken !== _rwToken) { try { restoreInplaceDrafts(); } catch (e) {}' },
  { name: '#720c 分帧路径补贴底（删则冷进时调用方的 scrollToBottom 跑在换装前＝空操作，页面不贴底）', file: 'js/chat.js', needle: 'scrollChatBottom(); // #718 分帧路径' },
  { name: '#720d addRec 超限钳位走静默裁顶（#846 起；改回整窗重建则「发完消息屏幕闪一下」复发）', file: 'js/chat.js', needle: 'trimWindowTopQuiet(RENDER_MAX);' },
  { name: '#721a LS 残留补扫失败重试闸（删回一次闩到底则存储繁忙那轮没清掉的残留整会话不再清＝用户诊断单里 207KB 跨会话存活形态）', file: 'js/idb.js', needle: 'if (_lsSweepFail && _lsSweepTries < 2) {' },
  { name: '#721b 追平写失败计数（删则写失败静默当成功、重试闸永不触发）', file: 'js/idb.js', needle: 'const markFail = function () { _lsSweepFail = true; };' },
  { name: '#722a 分块格式门（blk-idx 在位只读热片，删回整读 41MB＝冷进聊天数秒卡顿回归）', file: 'js/chat.js', needle: "return chatBlkHotLoad(myPrefix, bidxRaw, !!forceIdb);" },
  { name: '#722b 大历史读成功后台分块迁移（删则存量 41MB 桌面永远停在旧整包格式＝懒读不生效）', file: 'js/chat.js', needle: 'if (!chatBlkIdx && msgsBytes(idbArr) > CHAT_BLK_MIN) {' },
  { name: '#722c 分块写路径分流（删回 forceFull 整组重写＝每次落盘 41MB 写放大回归）', file: 'js/chat.js', needle: 'chatBlkRewriteTail(prefix, arr); // 热片对齐尾部块重写' },
  { name: '#722d 账本守卫分块感知（删回拿全量条数比热片内存＝每次保存被缩水守卫拦死＝消息永不落盘）', file: 'js/chat.js', needle: 'if (chatBlkIdx && typeof chatHotBaseN === ' },
  { name: '#722e getChatMsgs 永远全量（删则统计/导出/补投递在热片窗口内少算历史）', file: 'js/chat.js', needle: 'return chatColdHead.length ? chatColdHead.concat(msgs) : msgs; }' },
  { name: '#722f 上滑边界 rebase＋下标位移（删则热片之上历史不可达＝看起来记录丢失）', file: 'js/chat.js', needle: 'if (chatColdHead.length) { chatRebaseCold(); loadOlderIncremental(); return; }' },
  { name: '#722g 头块水合失败不前移（删则失败块静默跳过＝该块消息从统计/导出消失）', file: 'js/chat.js', needle: 'if (!Array.isArray(v)) { chatColdHydrating = false; return; } // #722 读失败' },
  { name: '#722h 备份「仅聊天记录」收块键（删则分块后备份缺聊天历史＝备份完整性破坏）', file: 'js/data-backup.js', needle: 'const CHAT_KEY_RE = /(?:^|:)(?:chat-msgs|chat-blk-idx|chat-blk-[0-9]+)$/;' },
  { name: '#722i 块格式备份组装回整包（删则块备份无法导回聊天记录）', file: 'js/data-backup.js', needle: "if (!/:chat-blk-idx$/.test(k)) return;" },
  { name: '#722j 导入写整包时清目标桌面旧块键（删则残留 blk-idx 遮蔽刚导入的整包）', file: 'js/data-backup.js', needle: "k.indexOf(key + ':chat-blk-') === 0" },
  { name: '#722k 媒体重建引用面收块键（删则清池重建丢聊天令牌图）', file: 'js/media-pool.js', needle: 'chat-blk-idx|chat-blk-[0-9]+|fav-msgs' },
  { name: '#722l 清空聊天同步清块键与索引（删则清空后 blk-idx 回放复活全部历史）', file: 'js/chat.js', needle: 'chatBlkResetState(); // #722：分块状态复位（此后保存走旧格式/重新分块）' },
  { name: '#722m 末块必成/更早热块尽力而为（删回「任一块失败整体返 null」则一次超时即退回全量读重试＝开聊被拖到十几秒）', file: 'js/chat.js', needle: 'if (isLast) { miss = true; return; }' },
  { name: '#722n 块清理按前缀扫盘（删回只按内存 chatBlkIdx 删＝会话没读过该桌面时漏删磁盘块：清空的历史下次启动复活、导入被旧索引遮蔽）', file: 'js/chat.js', needle: 'function chatBlkPurgePrefix(prefix) {' },
  { name: '#722o rebase 后重算 lastMine*（删则引用「我最后一条」的回复在并入冷头后指错位）', file: 'js/chat.js', needle: 'try { syncLastMineText(); } catch (e) {} // #722 自查：lastMineIdx 是 msgs 下标' },




  // ==== 2026-09-18 #711 聊天美化「顶栏/底栏位置」只能单向（顶栏仅下移、底栏仅上移，值域 0~80 且 surfaceValue 把负值钳回 0＝反方向物理不可达，用户直派「只能上调不能下调」）→ 双向化：正值走原留白高度（max 取正部），负值走负 margin（min 取负部）——顶栏上移＝::before 负 margin-bottom 整列上提（底栏被 flex:1 消息区锚在原地）；底栏下移＝输入栏负 margin-bottom 越过容器底沿（overflow:hidden 裁掉）。底栏基准 margin 分环境镜像（宽屏悬浮 16px / ≤900px 通栏、force-mobile、tablet 均 0），避免 ID 特异性覆盖把 16px 基准打没。存值语义不变，旧数据 0~80 原样兼容 ====
  { name: '#711a 顶栏负值（上移）＝::before 负 margin-bottom（改回单向留白即消失＝顶栏再也不能上移）', file: 'css/chat-main.css', needle: 'margin-bottom:min(var(--cs-head-inset, 0px), 0px);' },
  { name: '#711b 底栏负值（下移）＝负 margin-bottom 叠加 --cs-input-mb-base 环境基准（改成裸 min() 直写＝宽屏悬浮 16px 底距被 ID 特异性打没、输入栏默认位上飘）', file: 'css/chat-main.css', needle: 'margin-bottom:calc(var(--cs-input-mb-base, 0px) + min(var(--cs-input-inset, 0px), 0px));' },
  { name: '#711c 位置值域双向钳制（surfaceClamp 吃 item.min；改回 Math.max(0,…)＝负值一律被打回 0＝双向退化回单向）', file: 'js/chat-settings.js', needle: 'const surfaceClamp = (item, n) => Math.max(item.min != null ? item.min : 0, Math.min(item.max, Math.round(n)));' },
  // ==== 2026-09-18 #712 多字卡「拼接符号」新增内置「——」（默认开）＋自定义符号（用户直派「拼接符号新增一个：—— 默认开启」「系统自带的不变，只能开关，但是用户可以自己添加」）——内置七枚（空格/，/。/！/？/....../——）只能点亮/取消；「＋」弹 openModal 添加自定义（≤6 字符、≤8 个、与内置/已有去重），自定义 chip 点本体开关、点「×」删除，「至少保留一个」改按内置+自定义合计判。自定义存 reply-py-punct-custom＝JSON [{s,on}]（非数值键、故意不进 DEFAULTS——getCfg 数字兜底与 saveAllContactsDo 全键同步都会写坏数组；随 getCfg/replyCfgFor 附带原串），pyJoinCards 只取 on=1 入池 ====
  { name: '#712a 内置「——」入池（删则——永远不会被拼进多字卡，设置页开关变摆设）', file: 'js/chat.js', needle: "if (c['py-punct-dash'] === 1) pool.push('——');" },
  { name: '#712b 自定义符号按 on=1 入池（改成无脑全收＝关掉的自定义符号照样出现、开关失效）', file: 'js/chat.js', needle: "if (it && typeof it.s === 'string' && it.s && it.on === 1) pool.push(it.s);" },
  { name: '#712c cfg 附带自定义原串（DEFAULTS 外挂直读；删则 pyJoinCards 永远读不到自定义符号）', file: 'js/reply-settings.js', needle: "out['py-punct-custom'] = String(ls.get('reply-py-punct-custom')" },
  { name: '#712d 自定义符号落盘（删则添加/删除/开关都不持久化、刷新即丢）', file: 'js/reply-settings.js', needle: 'ls.set(CUST_KEY, JSON.stringify(list))' },
  { name: '#712e 模板「——」chip 与「＋」添加钮（删则设置页看不到新符号、没法加自定义）', file: 'template.html', needle: 'data-k="py-punct-dash"' },
  // ==== 2026-09-18 #713 批量问卷收藏两缺（用户直派：「问问ta批量问卷，点击查看详情，没有整体的卡片的收藏功能，没有单个问题的批量收藏功能」）——①问卷卡（special:'ask-survey'）渲染没挂 favHeartHtml、cardSnapshot 也不认识它＝整卡无法收藏进聊天收藏夹：卡片加常显心形（问卷卡整卡点击=看详情，没有单题卡的 show-fav 浮现机制）＋快照存题目列表 qarr/TA 作答 aarr，收藏页按问卷卡重放；②问卷详情原是 openModal 纯文本＝没法挂任何按钮：改 openTCPanel 面板，「♡ 收藏整份问卷」复用 favCardFromMsg，「☆ 收藏所选/★ 全部收藏」把题目按文本查重后存入 问问TA 题库（我的添加·日常，单选题带 options ≥2 成单选与批量导入同口径）====
  { name: '#713a 问卷卡常显收藏心形（删则整卡收藏入口消失＝「没有整体的卡片的收藏功能」回归）', file: 'js/chat.js', needle: 'favHeartHtml(rec, true)' },
  { name: '#713b cardSnapshot 问卷分支存 qarr/aarr（删则点心形静默无效＝#660 同族回归）', file: 'js/chat.js', needle: "else if (special === 'ask-survey') {" },
  { name: '#713c 收藏页问卷重放（删则收藏夹里问卷只剩一行摘要、题目与 TA 作答丢失）', file: 'js/chat.js', needle: "f.special === 'ask-survey' && Array.isArray(f.qarr)" },
  { name: '#713d 问卷详情收藏操作条（删则详情里没有整卡收藏与单题批量收藏入口＝主诉回归）', file: 'js/ta-ask.js', needle: 'id="sv-fav-allbtn"' },
  { name: '#713e 单题收藏写入题库（删则勾选收藏只弹 toast 不落库、题库永远收不到题）', file: 'js/ta-ask.js', needle: '道题到问问TA题库' },
  // ==== 2026-09-18 #714 电脑端宽屏「很多按钮飞出屏幕」（用户直派）——手机上视口=手机壳，视口 fixed 通栏条/贴边钮贴边即贴壳；电脑（>900px 桌面模拟器外壳）上视口 1440+，ver-update-bar 备份/更新提醒条、pwa-install/pwa-ios-hint 右下钮、字卡批量管理条、位置面板（含 loc-full 全屏）、音乐批量条、sm-float 悬浮小框、群聊设置整页/@提及面板全部落到浏览器窗口边缘＝按钮飞出屏幕。修复=按壳几何锚回：壳中线=视口中线、壳宽 390 ⇒ 水平 50%±195px（壳内偏移按原值折算），body padding24+双轴 flex 居中+壳高 min(844,100dvh-48) ⇒ 垂直沿 max(24px, 50vh-422px)（900 高实测 28px 吻合）；老内核不识 max()/嵌套 calc 整条丢弃=回退原视口贴边，≤900px 不进查询零影响。游戏全屏（pong/brick/snake-fs）、通话/图片查看器/组件库等居中遮罩类为沉浸设计刻意不动 ====
  { name: '#714a 顶部提醒条锚回壳顶（删/去 :not 门控则电脑端提醒条横跨窗口、或满屏形态下错误钳成 390 居中）', file: 'css/base.css', needle: 'html:not(.force-mobile):not(.tablet):not(.fs-active):not(.fs-css-active) .ver-update-bar { top: max(24px, 50vh - 422px); left: calc(50% - 195px); right: calc(50% - 195px); }' },
  { name: '#714b 字卡批量管理条锚回壳内（删则电脑端管理时操作条按钮落到窗口左右边缘）', file: 'css/chat-pages.css', needle: 'html:not(.force-mobile):not(.tablet):not(.fs-active):not(.fs-css-active) .cc-manage-bar { left: calc(50% - 177px); right: calc(50% - 177px); bottom: calc(max(24px, 50vh - 422px) + 18px); }' },
  { name: '#714c 音乐悬浮小框锚回壳内（删则电脑端悬浮播放器落到窗口最左、远离手机壳）', file: 'css/chat-pages.css', needle: 'html:not(.force-mobile):not(.tablet):not(.fs-active):not(.fs-css-active) .sm-float { left: calc(50% - 183px); top: calc(max(24px, 50vh - 422px) + 80px); }' },
  { name: '#714d 群聊设置整页锚回壳内（删则电脑端进群聊设置整页横向铺满窗口、开关落到屏幕右缘）', file: 'css/group-chat.css', needle: 'html:not(.force-mobile):not(.tablet):not(.fs-active):not(.fs-css-active) .gc-settings-panel { left: calc(50% - 195px); right: calc(50% - 195px); top: max(24px, 50vh - 422px); height: min(844px, calc(100vh - 48px)); }' },
  { name: '#714e 手选桌面外壳不被伪装兜底改写（applyViewportFix 吃 layoutPref=pc 早退；删则触屏/小屏 PC + ?pc=1 或设置强制桌面时，异步 rAF 链仍加 force-mobile＝JS 桌面态+CSS 满屏混合态、外壳丢失）', file: 'js/device.js', needle: "if (layoutPref === 'pc') return;" },
  // ==== 2026-09-18 #725 iPad/平板「没适配、很多按钮点不到」（用户直派、多机型）——#714 宽屏锚定在 4 个 CSS 文件的 10 条选择器都漏了排除 html.tablet：平板 .phone=100vw 全宽铺满（#186 用户决策、无 390 外壳），≥901px 视口（iPad 横屏 1024-1366 / iPad Pro 竖屏 1024）全被锚到「幽灵外壳」＝提醒条/安装钮/字卡管理条/位置面板/音乐批量条/悬浮小框/群设置整页/@面板全挤到屏幕中央一条 390 窄带（隔离副本真渲染实测：1180×820 平板上 vub 落 395..785、群设置整页仅 390 宽）；全页面 elementFromPoint 命中测试另证 7 形态（手机/平板竖横/PC）×44 页其余无遮盖缺陷。修复=:not 链补 :not(.tablet)（平板贴视口边=贴壳，与 force-mobile/真全屏同语义；call-mini 保持 fixed 与 JS 拖拽视口坐标一致）；#714a~d needle 同步演进。编号说明：#724 已被 K80 测试失效批与后台保活取证批（两批同号）占用，顺延 #725 ====
  { name: '#725a 宽屏锚定排除平板·右下安装钮（删 :not(.tablet) 则 iPad 横屏/Pro 竖屏上安装钮从贴壳角落到屏幕中央 50%-179px）', file: 'css/base.css', needle: 'html:not(.force-mobile):not(.tablet):not(.fs-active):not(.fs-css-active) .pwa-install' },
  { name: '#725b 宽屏锚定排除平板·音乐批量条（删 :not(.tablet) 则平板全宽布局上批量操作条被钳成 390 居中窄带）', file: 'css/chat-pages.css', needle: 'html:not(.force-mobile):not(.tablet):not(.fs-active):not(.fs-css-active) .music-batch-bar { left: calc(50% - 195px); right: calc(50% - 195px); bottom: max(24px, 50vh - 422px); }' },
  { name: '#725c 宽屏锚定排除平板·群聊@面板（删 :not(.tablet) 则平板上@提及面板被钳成 390 居中窄带）', file: 'css/group-chat.css', needle: 'html:not(.force-mobile):not(.tablet):not(.fs-active):not(.fs-css-active) .gc-at-panel { left: calc(50% - 195px); right: calc(50% - 195px); bottom: max(24px, 50vh - 422px); }' },
  { name: '#725d 通话小框不随外壳 absolute 化（删 :not(.tablet) 则平板上小框 absolute 定位与 JS 拖拽视口坐标在整页位移轴上打架）', file: 'css/chat-main.css', needle: 'html:not(.force-mobile):not(.tablet) .call-mini' },
  // ==== 2026-09-18 #717 换头像「点导入图片没反应」（小米8 实报、用户明说其他机型也有；#677 同族收尾）——头像导入还有三处是「点击时动态创建 input、未挂进文档就 click()」的旧写法（红米/真我等 Android Edge 系静默忽略不弹选择器＝点了没反应；iOS Safari 对未挂载 input 不保证派发 change，#677 实锤）：桌面头像 personalize.js bindAvatar、群聊头像 group-chat.js pickAvatarFile、朋友圈头像 feed.js coverAvEl；另有头像互动面板 avatar-lib.js bindPoolUpload 虽常驻挂 body 但用 display:none（老 WebView 对它同样可能不弹选择器）且 click 无 try/catch（失败全静默）。修复=四处统一到全站已验证套路（chat-settings headInput / chatcard pickFiles 同款）：常驻单个 input 永久挂 body、移出屏幕可见（不用 display:none）、复用前清 value、click 包 try/catch 失败给可见提示；压缩/落库管线一字不动 ====
  { name: '#717a 桌面头像选择器常驻挂文档（改回点击时动态创建未挂文档＝红米/真我 Edge 不弹选择器、iOS 选完不派发 change）', file: 'js/personalize.js', needle: 'document.body.appendChild(avatarPickInput);' },
  { name: '#717b 群聊头像选择器常驻挂文档（同 #717a，改回动态分离创建＝点了没反应复发）', file: 'js/group-chat.js', needle: 'document.body.appendChild(gcAvatarPickInput);' },
  { name: '#717c 朋友圈头像选择器常驻挂文档（同 #717a）', file: 'js/feed.js', needle: 'document.body.appendChild(feedAvPickInput);' },
  { name: '#717d 头像互动池选择器 offscreen+常驻身份（display:none 回归＝老 WebView 点添加头像没反应；id 按按钮唯一供诊断/测试定位）', file: 'js/avatar-lib.js', needle: "input.id = (btn.id || 'avlib') + '-file-pick';" },
  // ==== 2026-09-18 #718 机型兼容自查四小批（用户对检查报告派单「2345」；原拟 #717，登记时发现已被换头像批占用，顺延 #718）——①群聊设置面板补 height:100vh 前置兜底（<Chrome 108/iOS <15.4 无 dvh＝整条 min() 失效、面板塌成内容高长列表不可滚；聊天设置面板同款双声明早已有，v3.42.x 改全屏时漏带）；②device.js applyViewportFix 的 interactive-widget 按平台选（原两处写死 resizes-visual，iOS 桌面伪装+内核不认 viewport 改写时 rAF 晚跑会把 mobile-adapt 已改的 resizes-content 盖回去＝键盘适配退回异常形态；顺带把两处重复 meta 串收敛 viewportMetaContent 单一出口、isIOS 判定收 isIOSUa 具名函数防同步段 TDZ）；③auction.js beep 补 AudioContext suspended→resume（全站音效模块最后一个漏网，iOS 锁屏/切后台回来整局哑音）；④⑤ max(...,env(...)) 补 ,0px 内定值（base.css 键盘期弹窗顶距 / personalize.js 自愈提示条，老内核不支持 env 时整条 max() 失效）====
  { name: '#718a 群聊设置面板 100vh 前置兜底（删则无 dvh 老内核面板高度塌成内容高、设置列表不可滚。2026-09-19 #853 换锚：dvh 行收进 @supports，100vh 主行与 @supports 行各由 #718a/#853d 分钉）', file: 'css/group-chat.css', needle: '@supports (height: 100dvh) { .gc-settings-panel { height: min(var(--mochi-ios-h, 100dvh), 100dvh); } }' },
  { name: '#718b viewport 关键字按平台选（改回写死 resizes-visual＝iOS 桌面伪装机型被 rAF 晚跑盖回、键盘适配退回异常形态）', file: 'js/device.js', needle: "interactive-widget=' + (isIOSUa() ? 'resizes-content' : 'resizes-visual')" },
  { name: '#718c 拍卖会音效挂起自愈（删则 iOS 锁屏/切后台回来整局哑音；全站音效模块同款修法的最后一个）', file: 'js/auction.js', needle: "if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});" },
  { name: '#718d 键盘期弹窗顶距 env 带 0px 内定（删则不支持 env 的老内核整条 max() 失效＝弹窗贴死状态栏）', file: 'css/base.css', needle: 'max(10px, env(safe-area-inset-top, 0px))' },
  { name: '#718e 自愈提示条 bottom env 带 0px 内定（删则同上＝提示条贴出屏外）', file: 'js/personalize.js', needle: 'max(16px,env(safe-area-inset-bottom,0px))' },
  // ==== 2026-09-18 #719 OPPO Find X9 Pro + Edge「桌面和聊天上下缘遮挡」（用户直派、明说多机型；#114/#199/#236/#537 同族新姊妹形态）——Android 15+ edge-to-edge 浏览器在 viewport-fit=cover 下把页面画进系统状态栏/手势条区，但 env(safe-area-inset-*) 恒报 0（#236 HeyTapBrowser 报 env≥40 走 coverBrowser，本形态 env=0 靠几何签名识别：inner=400×810 超出 screen=360×785、innerW>screenW＋DPR 2.699≈0.9×系统密度＝缩放渲染实锤，810×0.9=729=785−Edge 底部工具条 56 全数对账＝页面顶到物理屏顶、状态栏悬浮其上）。全部既有避让链因「env≥20」门槛不触发＝状态栏盖住 Mochi 行、手势条盖住 tabbar/输入栏底缘。修复=共享判定器 mochiViewportForm 新增 e2e-browser 形态（顶部 28/z、底部 16/z 估式自动避让，带内 [3,64] 排除 #278 screen 坏值家族；window.__mochiE2eLatch 闩住 Edge 工具条隐匿瞬间的带外波动，旋转重探自清），复用既有 mochi-cover-top/--mochi-safe-bottom 消费链，CSS 零改动；仍偏可经 屏幕位置设置 五轴本机精调 ====
  { name: '#719a 判定器 e2e-browser 形态门（删回则该形态永远 plain＝状态栏/手势条遮挡复发且诊断不再对号）', file: 'js/device.js', needle: 'e2eBrowser = e2eBase && (e2eOverH <= 64 || !!sig.e2eLatch);' },
  { name: '#719b 安卓执行器 e2e 顶避让接线（补宽度信号+闩；删回则 safe-top 不落盘、Mochi 行仍钻系统状态栏）', file: 'js/mobile-adapt.js', needle: 'if (_fc.e2eBrowser && !window.__mochiE2eLatch) window.__mochiE2eLatch = true;' },
  { name: '#719c 安卓键盘收起回落 e2e 底避让（改回摘除属性＝tabbar/输入栏退回 0 避让被手势条盖住）', file: 'js/mobile-adapt.js', needle: "_next = _kbOn ? '0px' : ((_fcB && _fcB.e2eBrowser && _fcB.safeBottom) ? _fcB.safeBottom + 'px' : '');" },
  // ==== 2026-09-18 #721 低端机触摸滚动被动化（用户「还有没有能优化的，不要出错」；编号说明：#715~#720 已分别被滚动旗标/K80 三联/换头像/兼容四小批/e2e 形态/渲染分帧各批占用，本批由 #719 二次顺延改 #721）——全库 touchmove 审计（共 13 处）发现仅两处处理体只 clearTimeout、从不 preventDefault 却未标 passive：聊天收藏长按 chat.js、美食长按删除 p2-features.js。未标 passive ＝ 手指每次滑动都要等主线程执行完回调才滚动（低端安卓＝列表滚动被阻塞掉帧）。审计结论：文档/窗口级 touchmove 与 breakout/pong（需 preventDefault 保持 passive:false）、snake（已 passive）均正确标注。零行为变化 ====
  { name: '#721a 聊天收藏长按 touchmove 被动化（改回非被动＝低端机列表滑动被该主线程回调阻塞）', file: 'js/chat.js', needle: 'clearTimeout(pressTimer), { passive: true }' },
  { name: '#721b 美食长按 touchmove 被动化（同 #721a）', file: 'js/p2-features.js', needle: 'pressTimer = null; } }, { passive: true });' },
  // ==== 2026-09-18 #722 设置→关于「项目周期 + 内容仅供参考」说明条（用户直派：项目功能太多工程量太大，8.12 开搓 ~ 9.30 完结永久停更，没全查完错，所有内容仅供参考）——about 分区顶部 .set-alert 常驻说明条 #about-eol-note（纯静态文案；不新增 set-group，verify-about-cat B1/B2/B5 口径不变） ====
  { name: '#722a 关于段顶部项目周期/仅供参考说明条（删则停更与内容免责说明从设置→关于消失）', file: 'template.html', needle: '2026.9.30 完结，之后永久停更' },
  // ==== 2026-09-13 #408 美化导入「解析失败」（IQOO Neo10 vivo 浏览器实报，多机型同族）——美化/聊天美化导入裸 JSON.parse(v.trim()) 一刀切，安卓各浏览器 ce-box 粘贴链路（nbsp/零宽字符/换行块）与聊天 App 转发链路（包裹说明文字/中文引号/全角标点/尾逗号）弄脏 JSON 即失败；#171 字卡导入已修同族，美化两处没跟。修复=personalize.js 全局自救解析器 mochiParsePastedJSON（隐形字符清洗→裁剪首{到末}→字符串外全角标点/尾逗号归一，只在真解析成功且为顶层对象时采用），两处导入接入 + 失败带真实报错并写 __jsErrors 诊断现场；聊天美化空文本静默 return 的「无反应」补提示 ====
  { name: '#408 粘贴导入 JSON 自救解析器（删则安卓各机型粘贴/转发弄脏的方案 JSON 直接解析失败）', file: 'js/personalize.js', needle: "new Error('不是有效的方案 JSON')" },
  { name: '#408 桌面美化导入接入自救解析+诊断现场（删则报障只见「解析失败」无真因）', file: 'js/personalize.js', needle: "'[美化导入] '" },
  { name: '#408 聊天美化导入接入自救解析+诊断现场+空文本提示（删则「无反应」与「解析失败」无真因）', file: 'js/chat-settings.js', needle: "'[聊天美化导入] '" },
  { name: '#401 后台通知正文令牌串→[图片]（删则含令牌消息的预览在通知栏直出乱码）', file: 'js/bg-keep.js', needle: "@@m:[0-9a-f]{32}/g, '[图片]')" },
  // ==== 2026-09-13 #411 卡顿自检 · 一键优化（只优化不删除；iPhone 15 Pro Max + Chrome 等多机型实测健康帧率仍报卡顿——诊断实锤主因是公用/专属字卡库单键可达 44MB，大库解析/按需取回是间歇冻结点。storage-slim 数据层分级 + 非破坏预热；personalize 设置行 + 启动大库主动弹；不碰不删任何用户数据，跨设备零语义变化）====
  { name: '#411 卡顿自检·分级判定器（mochiPerfLevel 纯函数，删则自检分级失效；44MB 字卡库是 iOS/安卓间歇卡顿主因）', file: 'js/storage-slim.js', needle: 'window.mochiPerfLevel = function (totalBytes, bigGroups) {' },
  { name: '#411 卡顿自愈·非破坏预热（mochiPerfHeal 取回挂起大键库+预热令牌化回复池；只优化不删除，删则「一键优化」空转）', file: 'js/storage-slim.js', needle: 'window.mochiPerfHeal = function (prog) {' },
  { name: '#411 卡顿自检设置行入口（row-perf-optimize 锚点；删则设置页无「一键优化」入口）', file: 'template.html', needle: 'id="row-perf-optimize"' },
  { name: '#411 自检·仅大库才主动弹提示（v3.26.x 口径演进=#452：启动分级改 __big-idx 尺寸门控 mochiPerfLevel(totalBytes,bigGroups)！==重，全量 mochiCcSlimScan 移交设置行主动扫；旧锚 if (agg.level!==重) 随全量扫描收口移除；删则轻/中库也弹=骚扰复发）', file: 'js/personalize.js', needle: "window.mochiPerfLevel(totalBytes, bigGroups) !== '重'" },
  { name: '#402 缺失令牌占位换内联 SVG（删则令牌 src 被当相对 URL 请求 404＝iOS 裂图问号黑块）', file: 'js/media-pool.js', needle: 'const MISS_PLACEHOLDER' },
  // ==== 2026-09-13 #412 情绪链/局部撤回 null 守卫（荣耀畅玩40 Plus 夸克等多机型「跳转个人聊天卡屏」报障，诊断 page-chat 反复
  //      「Cannot read properties of null (reading 'querySelector')」——m 由 addRec 返回，实时去重命中时返回 null，
  //      定时器触发对 null 调 querySelector/dataset 即崩；补 !m 守卫，防 m 为 null 的崩溃面）====
  { name: '#412 情绪链渲染 null 守卫（m 为 null 时不再 querySelector；删则 page-chat 崩溃回归）', file: 'js/chat.js', needle: "if (!sameCid() || !m) return;\nconst bm = m.querySelector('.msg-bubble');" },
  { name: '#412 局部撤回 null 守卫（m 为 null 时不再读 dataset；删则同源崩溃回归）', file: 'js/chat.js', needle: "if (!sameCid() || !m) return;\npartialRetractMsg(m, 'in');" },
  // ==== 2026-09-13 #413 可清理空间 · 同域其他站点数据（ml2_* 等非本项目键占满 localStorage 配额，用户报障多机型
  //      同现；设置→查看存储→可清理空间加「同域其他站点数据」行，列出非 xy-home-v2: 前缀键并一键清理，
  //      只删其他站点键、不碰本应用任何数据）====
  { name: '#413 同域其他站点数据清理入口（row 锚点；删则设置→查看存储无「同域其他站点数据」行，无法一键清 ml2_*）', file: 'template.html', needle: 'id="st-slim-other"' },
  { name: '#413 同域其他站点数据扫描+一键清理（scanOtherLS/renderOtherSlim；删则无法按前缀安全清理外来键）', file: 'js/personalize.js', needle: "function scanOtherLS() {" },
  // ==== 2026-09-13 #414 网易云分享短链 163cn.tv 导入即全部"播放失败"（vivo iQOO Z11 Edge 实报，多机型同现）——分享短链 URL 里没有歌曲数字 ID，数字藏在 302 重定向后的 music.163.com 页面里，extractNeteaseSongId 认不出、被当普通直链入库→audio.src 指向 HTML 跳转页而非音频→全失败。修复=只认官方短链宿主 163cn.tv，用 CORS 代理跟随跳转取回最终页面正则抠出 song ID，best-effort 静默回退（任何一步失败原样保留、绝不误改已有可播链接）；接入「链接添加 / 批量导入」两个入口 + 播放时刻对存量短链曲目再解析一次 ====
  { name: '#414 163cn.tv 短链宿主识别（删正则则短链又被当普通直链、播放时绕开解析→播放失败复发）', file: 'js/music-player.js', needle: "return /(?:^|[\\s/])163cn\\.tv\\/[\\w-]+/i" },
  { name: '#414 短链解析核心（resolveNetShortLink 跟随 302/API 代理取回 song ID；删函数则主源拿不到 ID、存量短链曲目播放再也不解析）', file: 'js/music-player.js', needle: 'function resolveNetShortLink(ln, cb) {' },
  { name: '#403 桌面弹窗清洗链补令牌（删则弹窗横幅直出 @@m:hash 乱码）', file: 'js/chat.js', needle: "if (t.indexOf('@@m:') >= 0) t = t.replace(/@@m:[0-9a-f]{32}/g, '[图片]');" },
  { name: '#403 信箱弹窗正文剥令牌/附件（删则信件通知横幅直出乱码）', file: 'js/mail.js', needle: "给你寄来了一封信：' + String(content" },
  { name: '#415 查看存储·扫描字卡分组后长文本不超屏（.storage-row span 允许在自身宽度内折行；删则分组名/多库合计长文本又顶出屏幕）', file: 'css/setting.css', needle: '.storage-row span { flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }' },
  { name: '#415 查看存储·扫描结果体积列右对齐可折行（.storage-row b 同族；删则多库合计长文本整行不折又超屏）', file: 'css/setting.css', needle: '.storage-row b { font-weight:600; font-size:12.5px; text-align:right; flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }' },
  { name: '#415b 压缩图片·压缩后字卡库缓存强制重载（删则压缩写回后本会话聊天回复池/字卡管理页继续发旧图）', file: 'js/chatcard.js', needle: 'window.ccReloadGroupsAfterExternalWrite = function () {' },
  { name: '#415b 压缩图片·压缩前弹窗提醒先导出备份（删则压缩覆盖原图无提示，用户无备份意识）', file: 'js/img-compress.js', needle: '压缩会覆盖原图（替换成更小的版本），原图不留底、不可撤销' },
  // ==== 2026-09-17 #633 压缩图片覆盖面补齐（用户报「压缩图片打开，里面扫描不到所有桌面，也不显示
  //      公用字卡+专属字卡里上传的图片、头像互动的头像库的图片」）。三条根因：①桌面清单只取联系人注册表
  //      → 「键在、注册表里没有」的桌面整桌漏扫；②字卡库内联大图经 #554 令牌化后真身在媒体池，旧实现把
  //      @@m: 令牌一律当「共享图」跳过＝用户上传过图片却报 0 张；③头像库值不是 dataURL 而是 JSON 数组，
  //      从未进过扫描面。四条哨兵都取「逻辑锚点」（修复生效时必然存在、逻辑被改则消失）====
  { name: '#633 桌面清单取「注册表 ∪ 实际键清单」（删则键在注册表里没有的桌面整桌漏扫，「扫描不到所有桌面」复发）', file: 'js/img-compress.js', needle: 'const m = /^xy-home-v2:([^:]+):(?:cc-groups|avatar-lib|avatar-me-lib)$/.exec(String(k));' },
  { name: '#633 字卡库内联图令牌化后按媒体池条目一起算/一起压（删则用户明明上传过图片仍报 0 张复发）', file: 'js/img-compress.js', needle: 'if (h) { if (keySet[MEDIA_PREFIX + h]) hashes[h] = true; return; }' },
  { name: '#633 头像互动的头像库进扫描/压缩面（删则头像库里的大图永不参与压缩）', file: 'js/img-compress.js', needle: "key: 'avatar-lib', label: label + ' · 头像库' });" },
  { name: '#633 池条目同键换值前摘掉待落盘旧值（删则 300ms 防抖窗口内 flush 会用旧值把压缩结果盖回去）', file: 'js/media-pool.js', needle: 'writeBuf = writeBuf.filter(function (p) { return !(p && p.k === FULL + h); });' },
  // ==== 2026-09-14 图片丢失核对（OPPO Find X9/Edge 实报「图片显示异常」，其他设备型号也有；诊断实证媒体池空、
  //      聊天全是 @@m: 令牌→渲染占位「媒体数据缺失，可用数据备份重新导入恢复」。代码面防线已齐
  //      （#275 备份不带池不剥值 / #387 公用库写回堵口 / #397/#402 占位与自愈 / #186 写池回滚 / #118 导入保留旧键），
  //      缺的是「帮用户分辨是备份没带池还是链路没写回」的核对入口——新增 mochiMediaCoverage 只读核对 +
  //      查看存储页「核对图片是否齐全」按钮，引用数>池内数=备份没带图需源头重导完整备份，两边相等=数据链完好自愈）====
  { name: '#419 图片核对核心（mochiMediaCoverage 比对引用令牌数 vs 池内条数；删则用户无从分辨「图片丢失」是备份没带图还是链路没写回）', file: 'js/media-pool.js', needle: 'window.mochiMediaCoverage = function () {' },
  { name: '#419 查看存储·图片核对按钮（锚点；删则用户没有入口验证图片缺失原因）', file: 'template.html', needle: 'id="st-media-cov-btn"' },
  // ==== 2026-09-13 #423 媒体池一键重建（图片自愈）（红米 K80 Chrome 报「字卡库纯白/表情包/聊天/头像图全不显示」，
  //      其他手机同现；#275 实锤空池条目随完整备份跨设备传播、重导完整备份也救不回。池是内容寻址
  //      （令牌=SHA-256(dataURL)），本机任何键里幸存的同一张原图都能按哈希补池自愈——新增
  //      mochiMediaRebuild 只补缺失/空串条目、绝不覆盖有效池值、绝不删除任何数据）====
  { name: '#423 媒体池重建核心（mochiMediaRebuild 扫描本机存留原图按哈希补池；删则「图片丢失」设备永远只能靠源头完整备份、本机幸存副本全浪费）', file: 'js/media-pool.js', needle: 'window.mochiMediaRebuild = function () {' },
  { name: '#423 查看存储·重建媒体池按钮（锚点；删则用户没有重建入口）', file: 'template.html', needle: 'id="st-media-rebuild-btn"' },
  { name: '#423 重建按钮接线（personalize 确认弹窗+结果报告；删则按钮无功能）', file: 'js/personalize.js', needle: '开始重建' },
  { name: '#423 聊天图片丢失占位指向重建入口（删则用户只被告知「导入备份」而不知道本机可先重建自愈）', file: 'js/chat.js', needle: '可到设置→查看存储→媒体池' },
  { name: '#423 诊断·媒体池条目数（旧大键明细候选清单不含 media: 键，报障诊断无法判断池是否存在；删则图片丢失类报障继续失明）', file: 'js/device.js', needle: '媒体池条目' },
  // ==== 2026-09-13 #424 媒体池自动体检+主动弹窗一键修复（用户要求「不能自己识别异常弹窗叫我修复吗」；
  //      就绪+splash 移除+可见空闲后自动跑只读 coverage，missing>0 弹「一键修复」，24h 节流+72h 免打扰）====
  { name: '#424 自动体检核心（mochiMediaAutoCheck 覆盖→弹窗→重建链路；删则用户仍须自己找设置入口，「图片丢失」状态无人主动干预）', file: 'js/media-pool.js', needle: 'window.mochiMediaAutoCheck = function () {' },
  { name: '#424 体检节流状态键（media-auto-check 进 contacts EXCLUDE；删则全局根键被 migrateLegacy 迁进 default 删根键，节流失效反复弹窗）', file: 'js/contacts.js', needle: "'media-auto-check'," },
  { name: '#424 主动弹窗一键修复入口（missing>0 弹「一键修复」；删则自动体检退化成纯扫描、修不了）', file: 'js/media-pool.js', needle: '一键修复' },
  // ==== 2026-09-14 #439 图片丢失占位池权威判定+占位自愈（红米K80 Chrome 报「图片依旧说丢失…不要覆盖修改导致不同机型反复」，多机型同族：
  //      ①令牌 src 404 只是浏览器把令牌当 URL 请求的噪音，旧逻辑 1.5s 超时即把 img 换文字占位＝观察器取回慢/#397 限流时误杀；
  //      ②占位替换后 #423 重建自愈只重写 img[src^=@@m:] 摸不到占位＝「点了重建还是丢失」。
  //      配套 #440：导入时 idbListKeys 读不到曾按「无需保留」照常 clear＝「只备份文字」导入把媒体池整池抹掉的传播口子）====
  { name: '#439 占位池权威判定（轮询确认缺失 mochiMediaTokenMissing 才换占位；删则池取回慢/限流时被误杀成「图片丢失」复发）', file: 'js/chat.js', needle: 'window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(s)' },
  { name: '#439 占位登记自愈（池补回后 mochiMediaPhRestore 原位换回真图；删则「点了重建媒体池还是丢失」复发）', file: 'js/media-pool.js', needle: 'window.mochiMediaPhRestore = function' },
  { name: '#440 导入清单未知即中止（idbListKeys 失败/retain 值读失败 abort 走既有回滚，不再按「无需保留」clear；删则「只备份文字」导入把媒体池整池抹掉＝图片丢失跨设备扩散口子复发）', file: 'js/data-backup.js', needle: 'if (kept && kept.abort) { resolve(false); return; }' },
  // ==== 2026-09-14 #442 媒体池核对/重建「大库冻结=点了没反应」（红米K80 实报：设置→查看存储→媒体池两按钮点击无反应、
  //      也无成功/失败提示弹窗——chat-msgs 在 IDB 是数组直存（大桌面单键 40MB+），旧逻辑整包 JSON.stringify=几十秒
  //      长任务冻结主线程=页面假死零进度；锁屏/切后台页面被杀=扫描永不完成=永远等不到弹窗；且三按钮 .catch 静默无提示）====
  { name: '#442 核对逐条分扫（数组直存键不再整包 stringify 冻结主线程；删则大库核对/孤儿扫描继续假死「点了没反应」）', file: 'js/media-pool.js', needle: 'if (s) scanTokens(s);' },
  { name: '#442 孤儿扫描同款分扫+保守中止（单条序列化失败整次放弃不删；删则大库 GC 继续假死）', file: 'js/media-pool.js', needle: 'if (s) scanKeep(s);' },
  { name: '#442 重建三阶段进度回传+批间让出（池体检/扫副本/哈希；删则重建继续无反馈假死）', file: 'js/media-pool.js', needle: "prog(i, srcKeys.length, '扫描本机副本')" },
  { name: '#442 核对按钮实时进度接线（personalize；删则用户看不到进度以为没反应）', file: 'js/personalize.js', needle: 'window.mochiMediaCoverage(function (done, total, label)' },
  { name: '#442 按钮异常静默改弹窗（核对/重建失败必提示；删则「失败也没提示」复发）', file: 'js/personalize.js', needle: '媒体池重建中途出错，没有改动任何数据' },
  // ==== 2026-09-13 #425 头像启动间歇性不显示（华为畅享70Pro/红米K80 等多机型「刚点进网站头像时不时加载不出来」：
  //      cs-avatar-* 大图键常驻 IDB-only 区，avatar-lib 收敛基线在 idbRestore 回填前初始化读空被污染，
  //      回填完成的 restore-done 只刷桌面圈/聊天顶栏，convergeAvatars 因基线相等永不触发 → 气泡头像一直空）====
  { name: '#425 头像收敛挂钩回填完成（restore-done 清基线强制 convergeAvatars 重刷；删则晚到回填后气泡头像停留占位，基线污染永久跳过）——构建者收口修正：原 needle 带 4 空格缩进多行形态，minifyJs 剥行首缩进后永不匹配产物（2026-09-13 首次构建即红实锤），改单行逻辑锚点，同一语句', file: 'js/avatar-lib.js', needle: 'appliedPh = null; appliedUh = null;' },
  // ==== 2026-09-13 #426 日历留言乱码（OPPO Reno6/雨见浏览器报「日记留言应该只能用文字字卡，乱码是图片」，多机型同族；
  //      #388 只守了自定义字卡循环、默认主字卡循环漏过滤，贴纸/语音默认卡的「名称|||@@m:hash」拼进留言持久化成乱码；
  //      且 #388 前已落盘的存量留言渲染直出令牌）====
  { name: '#426 日历留言纯文字选卡过滤（calTextOnly 收敛两循环口径含裸令牌混排；删则媒体令牌卡继续进每日留言池持久化成乱码）', file: 'js/calendar.js', needle: 'function calTextOnly(c) {' },
  { name: '#426 日历留言渲染端令牌清洗（calCleanMsg 剥存量落盘留言的 @@m:/dataURL 成 [图片]；删则 #388 前生成的历史留言永远直出乱码）', file: 'js/calendar.js', needle: ".replace(/@@m:[0-9a-f]{32}/g, '[图片]')" },
  // ==== 2026-09-13 #429 信件乱码（OPPO Reno16 Via/Edge 报「信件乱码＝联系人字卡库图片令牌」，多机型同族 #426；
  //      mailCardPool 默认主字卡三循环零过滤、自定义循环 mochiMediaIsToken 全串锚定测不出裸令牌混排，
  //      贴纸/语音默认卡「名称|||@@m:hash/名称|||data:」拼进信件持久化；渲染端不剥「名称|||」残留与 audio base64）====
  { name: '#429 信件纯文字选卡过滤（mailTextOnly 收敛自定义+默认三循环口径含裸令牌混排；删则媒体令牌卡继续进信件池持久化成乱码）', file: 'js/mail.js', needle: 'function mailTextOnly(c) {' },
  { name: '#429 信件渲染端清洗（mailCleanDisplay 剥存量落盘信件的「名称|||」残留与非图片 base64；删则历史信件直出乱码/巨型 base64 文本）', file: 'js/mail.js', needle: ".replace(/[^\\s|]{0,40}\\|\\|\\|/g, '')" },
  // ==== 2026-09-14 #433 保活 WebRTC 锚点启动阻塞主线程（vivo Y78 自带浏览器报「一进网站就非常卡」，
  //      实测帧率 2fps、每 ~2.2s 一个 2.1~2.4s 长任务，多机型同现；无头 CPU 采样探针实锤
  //      new RTCPeerConnection() 单次构造 6x 节流桌面核阻塞 ~1.5s，低端安卓核放大到 2s+：
  //      #260 同步建一对＝开屏路径叠加秒级长任务，瞬态 disconnected 立即拆+30s 固定重建＝抖动机型反复卡；
  //      修复=启动 10s 延迟建锚+断连 8s 自愈观察窗+重建指数退避 30s→15min 封顶，锚点能力不删）====
  { name: '#433 保活 WebRTC 延迟建锚（deferred 闸 keepEnabled+hidden 跳过；删则退回开屏同步构造＝低端机一进网站秒级卡死复发）', file: 'js/bg-keep.js', needle: 'if (!keepEnabled || kaPc1 || kaPc2) return;' },
  { name: '#433 保活 WebRTC 重建指数退避（30s 起步 900000 封顶；删则抖动机型每 30s 付一次秒级构造成本反复卡）', file: 'js/bg-keep.js', needle: 'kaWebrtcRebuildDelay = kaWebrtcRebuildDelay ? Math.min(kaWebrtcRebuildDelay * 2, 900000) : 30000;' },
  { name: '#433 保活 WebRTC 断连 8s 自愈观察窗（disconnected 先观察再拆；删则 ICE 例行重连被当死亡立即重建＝无谓长任务）', file: 'js/bg-keep.js', needle: 'kaWebrtcDiscTimer = setTimeout(function () {' },
  // ==== 2026-09-14 #436 后台发热减负（用户报「浏览器挂网页在后台手机非常烫」）：保活音频豁免让全站
  //      定时器后台不节流＝保活的设计成本；两个纯浪费源一并掐掉——①pwa.js 版本轮询后台照跑＝每 15s
  //      一次 version.json 网络请求整夜唤醒射频；②bg-keep.js WebRTC 重建定时器漏后台守卫＝隐藏态
  //      秒级构造长任务（#433 实锤）+ 回环锚点 consent 包常驻射频。回前台均有兜底（visibilitychange
  //      即时检查 / healKeepAlive 补建），冻结防线零回退。注：#435 已被并行会话表情面板预热批次占用）====
  { name: '#436 版本轮询后台跳过（hidden 直接 return；删则后台每 15s fetch version.json 唤醒射频＝整夜发热耗电）', file: 'js/pwa.js', needle: "if (document.visibilityState !== 'visible') return;" },
  { name: '#436 WebRTC 重建后台跳过（heal 回前台兜底补建；删则隐藏态反复秒级构造长任务+锚点 consent 包常驻射频发热）', file: 'js/bg-keep.js', needle: 'if (!keepEnabled || document.hidden) return;' },
  // ==== 2026-09-13 #427 小游戏全屏抗键盘停靠内联残留 + 兄弟互斥零盒误关（vivo S60 自带浏览器报
  //      「五子棋点全屏自动回退聊天、刷新网页才能再次打开」，用户明说其他机型也有：kbDockPanels 给面板写
  //      内联 position:absolute/bottom/left/right/top/max-height，国产内核 vv 收起事件不可靠时 kbUndockPanels
  //      不执行 → 内联残留压过 .game-fs/pong-fs/snake-fs/brick-fs 规则、⛶ 全屏坏；改 !important 四长手只压
  //      停靠内联属性（停靠语义不变）+ inset 改长手兼容 Chromium<87 老内核 + gomoku 兄弟互斥只认真可见面板）====
  { name: '#427 共享全屏规则抗内联残留（.poke-card.game-fs !important 定位；删则键盘停靠内联残留把全屏面板钉回底半框，「点全屏没反应/自动回退/刷新才恢复」跨机型复发，波及 8 游戏+猜拳）', file: 'css/chat-pages.css', needle: '.poke-card.game-fs { position:fixed !important;' },
  { name: '#427 Pong 全屏同族抗内联残留（删则同 #427 在 Pong 复发）', file: 'css/chat-pages.css', needle: '#chat-pong-panel.pong-fs { position:fixed !important;' },
  { name: '#427 打砖块全屏同族抗内联残留（删则同 #427 在打砖块复发）', file: 'css/chat-pages.css', needle: '#chat-brick-panel.brick-fs { position:fixed !important;' },
  { name: '#427 贪吃蛇全屏同族抗内联残留（删则同 #427 在贪吃蛇复发）', file: 'css/chat-pages.css', needle: '#chat-snake-panel.snake-fs { position:fixed !important;' },
  { name: '#427 五子棋兄弟互斥只认真可见面板（hidden=false 但零渲染盒＝残留态不触发误关；删则残留兄弟把刚打开的棋盘反复自动关掉＝「打开就消失回聊天、刷新才恢复」）', file: 'js/gomoku.js', needle: 'getClientRects().length > 0) { closePanel(); break; }' },
  // ==== 2026-09-13 #428 寻踪「看看TA在哪」全屏位置面板抬到提醒条之上（vivo S60 等多机型报「点看看ta在哪
  //      页面卡死，只能退出刷新」：面板 z-78 低于顶部提醒条 z-998，备份提醒显形期间（距上次导出超 1 天即弹、
  //      #355 收短后极常见）正好压住头部返回按钮＝面板关不掉+body 滚动锁＝整页像卡死；z 抬 9999，
  //      仍低于 modal-mask 99999 / 应用锁 999999）====
  { name: '#428 全屏位置面板盖过提醒条（.loc-panel.loc-full z-9999；删则备份提醒条压住返回按钮，「看看TA在哪」全屏面板关不掉像卡死，多机型复发）', file: 'css/chat-pages.css', needle: 'background:#fff; z-index:9999;' },
  { name: '#416 单聊回钉只认真的贴到底（chatAtBottom 距最大 scrollTop ≤8px；删则旧 120px 容差又把「上翻读最新一条停下/轻点」当回钉、每次点滑动被拽回最底复发）', file: 'js/chat.js', needle: 'return cb.scrollHeight - cb.scrollTop - cb.clientHeight <= 8;' },
  { name: '#416 群聊解除接管只认真的贴到底（gcAtBottom 同 ≤8px 口径；删则旧 150px 容差让滚动手势第一个 scroll 事件就清掉接管、下一条成员回复把历史阅读拽回最底复发）', file: 'js/group-chat.js', needle: 'return body.scrollHeight - body.scrollTop - body.clientHeight <= 8;' },
  { name: '#416 群聊滚回贴底检测必须停稳（gcScrollTimer 120ms 防手势中第一个 scroll 事件误清接管；删则「每次点滑动被拽回最底」随下一条回复复发）', file: 'js/group-chat.js', needle: 'gcScrollTimer = setTimeout(() => {' },
  { name: '#418 屏幕适配自动监视·开屏未进入/数据未就绪跳过采集（sdTick 守卫；删则开屏加载期 inner 短报瞬态刷「底部少填/顶部重叠」假阳性污染错误环+反复强制重排，iPhone13 Safari「总卡卡/开屏划不动」复发）', file: 'js/device.js', needle: "_splash && !_splash.classList.contains('hide')" },
  // ==== 2026-09-14 #430 群聊大键口径对齐聊天页（存储优化：大群聊整包 stringify 堆尖峰族 + lite 快照被迁移覆盖丢数据族）====
  { name: '#430 群聊大键阈值分支（>3MB structured clone 数组直存、失败回退字符串；删则大群聊回退整包 stringify＝堆尖峰/秒级阻塞族复发）', file: 'js/group-chat.js', needle: 'gcMsgsBytes(msgs) <= GC_STR_THRESHOLD' },
  { name: '#430 群聊键排除 LS→IDB 大键迁移（删则 lite 快照被无条件 idbSet 覆盖数组权威＝老消息永久剥坏且 LS 兜底同没了）', file: 'js/idb.js', needle: 'if (isGroupMsgsKey(k)) continue;' },
  { name: '#430 群聊键排除启动回填（删则数组直存值回填时整包 JSON.stringify＝启动堆尖峰+memoryCache 死驻留）', file: 'js/idb.js', needle: '!isGroupMsgsKey(k) &&' },
  // ==== 2026-09-14 #431 压缩照片类 WebP 档（存储优化：同质量比 JPEG 再省约 25~50%）====
  // ==== 2026-09-14 #432 词典拼字「词典分类被关」永久误报（iQOO12Pro/Via 报「词典分类被关但什么都打开了、二级密码已解锁」，用户明说其他机型也有：dc-cat-dict 是词典独立成页前的遗留分类开关键，现行版本无任何写入 UI，老用户存量 '0' 让自检闸②与拼字抽卡池永久误杀且无处打开，纯数据态与机型无关；修复=删除两处 dc-cat-dict 读取（词典启用由 dict-use/dict-overall/dc-off-dict 负责）+ default-cards.js 启动清除全部命名空间残留键 LS+IDB 幂等）====
  { name: '#432 遗留 dc-cat-dict 残留键启动清除（LS+IDB 全命名空间幂等；删则老用户存量 0 被 idbRestore 每次开屏回填，词典拼字永久误报「词典分类被关」）', file: 'js/default-cards.js', needle: '/^xy-home-v2:(?:[^:]+:)?dc-cat-dict$/' },
  // ==== 2026-09-14 #434 表情包添加后退出浏览器重进丢失（荣耀10/Edge 报「添加表情包退出再进数据没了」多机型同发，已关自动清数据；根因=idb.js #82/#88/#226/#229 Edge 杀进程回滚最近未落盘提交 + 挂起内核 IDB 事务偶发不提交，WRJ 写日志只护 ≤64KB 小键、表情包媒体键不在保护范围，xyStore.set 的 IDB 写 fire-and-forget 无落盘确认；修复=保存后 idbSet 结果作持久性信号失败退避重发+离页/回前台补写+穷尽明确提示，myeSave 闸门取回失败不再静默丢、字卡库大值(>200KB IDB-only)同款确认）====
  { name: '#434 我的表情包落盘确认重发（idbSet 结果作持久性信号+退避重试；删则 Edge 杀进程回滚+IDB 挂起时添加的表情无任何持久副本，「加完退出重进全丢」复发）', file: 'js/chat.js', needle: 'window.idbSet(MYE_KEY(), json).then(ok =>' },
  { name: '#434 我的表情包闸门取回失败不再静默丢（退避重走保存链；删则 IDB 挂起窗口内添加的表情静默蒸发且无提示）', file: 'js/chat.js', needle: 'setTimeout(myEmojiSave, 1500 * myeGateRetry)' },
  { name: '#434 我的表情包离页/回前台补写闸（myeDurableFlush 单口；删则穷尽失败后回前台无人补发＝补写链断；#943b 起同口还负责当场补发防抖中的整包写）', file: 'js/chat.js', needle: 'if (myeDurablePending) myeEnsureDurable(0);' },
  { name: '#434 字卡库大值落盘确认（>200KB IDB-only 才确认，小值仍走 LS+WRJ 双防线不多付全库事务；删则字卡库表情包/图片同族「加完退出重进丢」复发）', file: 'js/chatcard.js', needle: 'ccJson.length > 200 * 1024) ccEnsureDurable(0);' },
  { name: '#434 字卡库离页补写接 flushCcSave（ccDurablePending；删则 flushCcSave 只认 ccDirty、上一轮失败挂起的补发无人再发）', file: 'js/chatcard.js', needle: 'if (ccDurablePending) ccEnsureDurable(0);' },
  // ==== 2026-09-14 #435 表情包面板图片「加载很慢/迟迟不显示」（多机型同发，上一轮 v3.42.x 懒加载后仍现；
  // 根因①rootMargin 300px 按字卡库近全屏列表定、面板滚动区仅 max-height:40vh——上下各 300px 外扩后触发
  // 窗口≈3 屏，打开分组瞬间 40+ 张图同时补 src 进解码管线＝主线程长任务接连图反而迟迟画不出，且面板 img
  // 漏了 decoding=async（字卡库一直有）；②TA/公用大库令牌卡 @@m:hash 走观察器逐图 miss 读 IDB（8 并发排队）
  // →重写→再解码五段异步串行＝冷启动慢上加慢。修复=懒加载窗口收窄 120px+IO 触发改 50ms 泵式每批 4 张补
  // src 让出主线程+img 统一创建补 decoding=async+组内令牌渲染后交 media-pool 批量预热（idbGetMany 每批 8
  // 批间让出，map 命中后观察器同步重写；warmSeen 会话内去重+inflight 互斥防双读））====
  { name: '#435 面板懒加载窗口收窄（120px 按面板 40vh 容器定；删则回退 300px＝打开分组 40+ 张图同帧全触发，解码风暴「图迟迟不显示」复发）', file: 'js/chat.js', needle: "rootMargin: '120px 0px'" },
  { name: '#435 懒加载泵式分批补 src（队列非空 50ms 续泵每批 4 张；删则 IO 回调一次性全量补 src＝低端机解码长任务接连、先到图也被压住不显示）', file: 'js/chat.js', needle: 'if (emojiLazyQueue.length && emojiImgObserver) emojiLazyT = setTimeout(emojiLazyPump, 50);' },
  { name: '#435 面板 img 统一创建补 decoding=async（emojiNewImg；删则大 dataURL 解码阻塞渲染帧＝图慢半拍复发，字卡库同款属性面板漏配）', file: 'js/chat.js', needle: "img.decoding = 'async';" },
  { name: '#435 组内令牌收集预热（只收 @@m: 令牌交 mochiMediaWarmTokens；删则令牌卡回退逐图 miss 读排队＝冷启动面板图慢半拍）', file: 'js/chat.js', needle: "s.indexOf('@@m:') === 0) toks.push(s.slice(4));" },
  { name: '#435 媒体池令牌批量预热接口（mochiMediaWarmTokens idbGetMany 每批 8 批间让出+inflight 互斥；删则预热无人接=面板令牌图五段异步串行慢加载复发）', file: 'js/media-pool.js', needle: 'window.mochiMediaWarmTokens = function (hashes) {' },
  // ==== 2026-09-14 #457 表情面板每次打开图片重载（多机型同发，用户明说其他设备型号也有）：
  // 根因=renderEmojiPanel 无条件 innerHTML='' 重建全部 img，浏览器对新建 img 必重新解码
  // dataURL/重请求令牌图，即使内容与上次完全相同。打开→关闭→再打开同一分组每次都重载。
  // 修复=内容指纹短路（mode/分组/张数/内容签名/batch/hs/联系人名），与上次成功渲染一致且
  // DOM 仍在→跳过重建复用现有 img（零机型分支，懒加载/预热/批量管理能力不删）====
  { name: '#457 面板内容指纹短路判定（_sigTarget===emojiRenderSig 且 DOM 仍在则跳过重建；删/改则回退每次开面板全量重建 img＝图片每次重载复发，多机型同发）', file: 'js/chat.js', needle: 'if (_sigTarget && _sigTarget === emojiRenderSig && emojiList.firstElementChild) return;' },
  { name: '#457 面板内容指纹目标计算函数（emojiRenderSigTarget 算 mode/分组/张数/首尾src/sumLen 签名；删则短路无指纹可比＝回退全量重建）', file: 'js/chat.js', needle: 'function emojiRenderSigTarget(hts, pn)' },
  // ==== #441 跨桌面通话记录串/消失（用户报「跨桌面打电话联系人的通话记录会串，没有显示实际联系人的电话」「跨桌面通话记录不会记录，会消失」+「接电话后跳转到当前联系人桌面」要写清是刻意设计。根因：①records.js 各渲染点只读桌面键 lbl-partner 取显示名——联系人管理新建、从未改昵称的联系人该键为空，主页通话/换头像/抓包/心意币/关心全部显示「TA」，多联系人分不清记录是谁的；记录数据本身按桌面命名空间隔离无串写（实测 A 去电通话中切 B 再挂断→记录落 A、B 为空；跨桌面来电接听挂断→记录落 B）；②跨桌面来电弹窗「稍后」与「弹窗被顶未应答」只标 seen 零记录＝无声消失；③接听先挂断进行中通话的文案承诺从未实现，currentCall 占用时点接听无反应；④功能说明「不会跳到对方的桌面」与实际（先切归属桌面再响铃）相反）====
  { name: '#441 主页记录显示名走完整取名链（dispName：cs-lbl-partner→lbl-partner→联系人名片名→TA；删则回退只读 lbl-partner，新联系人全显示 TA＝通话记录看不出是谁的）', file: 'js/records.js', needle: "store.get('cs-lbl-partner')" },
  { name: '#441 跨桌面来电稍后补记未接（callRecordMissed 复用 notifyCallEnd 落归属桌面；删则点稍后只标 seen，通话记录无声消失）', file: 'js/incoming-requests.js', needle: "if (req.kind === 'call' && window.callRecordMissed) window.callRecordMissed(req.cid, cName(req.cid));" },
  { name: '#441 弹窗被顶/未应答释放来电补记未接（wasCall+setStatus 命中才记，幂等；删则弹窗被顶/跨会话孤儿来电零留痕）', file: 'js/incoming-requests.js', needle: 'if (wasCall && window.callRecordMissed) window.callRecordMissed(cid, cName(cid));' },
  { name: '#441 跨会话孤儿来电自愈补记未接（queue() TTL 释放点；删则刷新/杀进程时未应答的来电弹窗随会话蒸发零留痕）', file: 'js/incoming-requests.js', needle: "if (x.kind === 'call' && window.callRecordMissed) { try { window.callRecordMissed(x.cid, cName(x.cid)); } catch (e) {} }" },
  { name: '#441 未接补记写手（call.js callRecordMissed→notifyCallEnd：系统消息+记录都落归属桌面；删则 incoming-requests 调用落空）', file: 'js/call.js', needle: 'window.callRecordMissed = function (cid, name)' },
  { name: '#441 接听跨桌面来电先挂断进行中通话（文案承诺；删则 currentCall 占用时点接听无反应、来电静默丢失）', file: 'js/incoming-requests.js', needle: 'if (window.getCallState && window.getCallState() && window.hangupCall) window.hangupCall();' },
  { name: '#448 跨桌面来电默认关闭（deskCallEn 未存键返回 false 需手动开启；删则回退默认开＝用户点名「默认关闭」静默失效，存量显式开/关不受影响）', file: 'js/incoming-requests.js', needle: "if (v === null || v === undefined || v === '') return false; // 默认关" },
  // ==== #442 iOS「左右滑动卡 + 总是自动刷新重进」多机型（iPhone 15 Pro Max via 诊断实锤
  //      default:cc-groups 单键 153MB + cc-groups-public 90MB；#377 公用库 OOM 家族专属库面：
  //      专属库裸 parse 无令牌化、编辑树 groups 开机常驻、去重任务双库同 parse、面板/搜索/角标
  //      反复全量 parse＝jetsam 反复杀页面）====
  { name: '#455 专属库池视图令牌化（ownPoolRaw 构建后即交 ccTokenizeGiantMedia；删则 153MB 级专属库解析副本带 dataURL 常驻回复池＝iOS jetsam「自动刷新重进」OOM 家族专属库面复发）', file: 'js/chatcard.js', needle: "ccTokenizeGiantMedia(ownPoolCache, 'own');" },
  { name: '#455 回复池专属侧改走令牌化池视图（删则回退编辑树 groups 直入池＝大库 parse 树常驻+未令牌化卡回退）', file: 'js/chatcard.js', needle: 'return mergeFiltered(ownPoolRaw(), pubGroupsRaw());' },
  { name: '#455 挂起大键取回不再无条件载编辑树（管理页开着才载；删则聊天路径取回即全量 parse 153MB 级库并常驻＝开聊天即冻结/自动重载复发）', file: 'js/chatcard.js', needle: 'if (scopeLive && ccPageOpen()) {' },
  { name: '#455 离开字卡库页释放编辑树（删则一次开页后数百 MB parse 副本驻留到刷新＝内存永不回落复发）', file: 'js/chatcard.js', needle: "if (ccScope !== 'public') { groups = null; return; }" },
  { name: '#455 去重任务大库免解析预检（双侧合计>96MB 只记 mark 免读跳过；删则 90+153MB 双库整串读入+双 parse 在启动+30s 必现＝秒级长任务/OOM 复发）', file: 'js/chatcard.js', needle: 'pubRaw.length + ownLen > DD_PARSE_LIMIT' },
  { name: '#455 表情包面板专属分区走令牌化池视图（删则回退每次开面板全量 parse 大库＝开面板秒级冻结/左右滑动卡复发）', file: 'js/chatcard.js', needle: "(scope === 'public') ? pubGroupsRaw() : ownPoolRaw()" },
  { name: '#455 懒加载态拒绝空树整包写回（saveGroups/flushCcSave/ccEnsureDurable 判空收口；删则页外写入方拿空编辑树覆盖权威键＝字卡库整库清空复发，#193 同族）', file: 'js/chatcard.js', needle: "if (!groups) { ccDirty = false; return; }" },
  // ==== 2026-09-14 #456 启动恢复红包封面 out/in 双向 IDB 回灌（#454 遗留项源码实锤：恢复段占位符 RP_COVER_KEY 全 src 无定义，ReferenceError 被 try/catch 静默吞＝iOS 清存储后封面丢失无自愈；收口构建者按 #456 会话台账代办登记）====
  { name: '#456 红包封面启动恢复双向回灌（删则退回死段/静默失效＝iOS 系统级清存储后 rp-cover-out/in 丢失且无自愈路径复发）', file: 'js/chat.js', needle: "myPrefix + ':rp-cover-' + side" },
  // ==== 2026-09-14 #446 花园扩建改自愿+一键补种+养护减负（用户反馈「花园里不用一直扩建，建这么多养不过来」：
  //      ①等级自动送地改「开垦资格」手动开垦——plotN=已开垦数，load() 迁移按当前等级一次性补齐资格，存量玩家已有的地一块不少；
  //      ②升级里程碑跨 Lv3/5/8/12 各送 1 颗随机稀有种子，升级奖励与「要不要多地块」脱钩；
  //      ③浇水有效期 24h→36h（WATER_SEC）、凋谢宽限 48h→72h（WILT_SEC=259200）、新增温室装饰满保水；
  //      ④工具条「补种」空地按上次品种一键补齐（不消耗 rareInv 稀有库存））====
  { name: '#446 扩建改自愿·开垦资格到顶分支（plotN≥资格给提示弹窗；删则回退等级自动送地，「建这么多养不过来」复发）', file: 'js/garden.js', needle: 'if (cur >= ent) {' },
  { name: '#446/#601e plotN 存量迁移（load 默认 12 块；存档 12 块之后已有花则保留到最远那株＝老玩家的花一块不少。删则存量玩家升级地块被裁回 12 且花被截）', file: 'js/garden.js', needle: 'd.plotN = _maxP >= PLOTS ? (_maxP + 1) : PLOTS;' },
  { name: '#601f 装饰商店 emoji 可见（emoji 外套白底圆)；删则绿底上的白色字形 emoji 又「看不见」', file: 'js/garden.js', needle: 'garden-decor-shop-ico' },
  { name: '#601f 装饰商店 emoji 可见（白底圆样式）；删则 emoji 回落绿底低对比', file: 'css/garden.css', needle: '.garden-decor-shop-ico {' },
  { name: '#446 里程碑奖励与地块脱钩（跨 Lv3/5/8/12 送稀有种子；删则「不开垦=亏升级奖励」的强制感回归）', file: 'js/garden.js', needle: 'msgs.push("🎁 里程碑奖励：稀有种子「"' },
  { name: '#446 一键补种（空地按上次品种补齐且不消耗稀有库存；删则 30 块地日常=逐块点种植，养护负担复发）', file: 'js/garden.js', needle: 'data.lastSeed && T[data.lastSeed] && !T[data.lastSeed].rare' },
  { name: '#446 浇水有效期 36h（waterLvl 分母 WATER_SEC；删则回退 24h 天天浇＝多地块高负担复发）', file: 'js/garden.js', needle: 'plot.watered) / WATER_SEC);' },
  { name: '#446 凋谢宽限 72h→#503 再放宽 96h（WILT_SEC=345600；删则回退收不及时就枯萎＝收花心意币钱损复发）', file: 'js/garden.js', needle: 'var WILT_SEC = 345600;' },
  // ==== #503 花园减负与 UI 重排（用户反馈「开垦的地太多太挤」：上限瘦身+手动缩地+空地折叠+日志全量+日志独立 tab）====
  { name: '#503 资格缩小不裁已有地（plotCount 去掉向下钳制＝老存档 plotN 高于新资格也一块不裁；改回钳制则上限瘦身后老玩家多种的花被静默删除）', file: 'js/garden.js', needle: 'return data.plotN || PLOTS;' },
  { name: '#503 手动缩地 shrinkPlots（只收尾部空地、下限 4 块、有花不裁；删则「开多了收不回」复发）', file: 'js/garden.js', needle: 'while (cur > MIN_PLOTS && !data.p[cur - 1]) cur--;' },
  { name: '#503 收地按钮登记（工具条 shrink；删则缩地无入口）', file: 'js/garden.js', needle: 'sb.dataset.tool = "shrink";' },
  { name: '#528 花园土地默认展开（#503 折叠改默认展开；改回 true 则土地又被默认收起＝用户反馈复发）', file: 'js/garden.js', needle: 'var emptyFolded = false;' },
  { name: '#528 空地折叠砖保留（默认展开时仍给「收起」入口；删则无法手动收起空地）', file: 'js/garden.js', needle: '(emptyFolded ? "点开" : "收起")' },
  { name: '#503 日志全量查看（默认 20 条+「查看全部」展开；删则联系人的打理记录看不全复发）', file: 'js/garden.js', needle: 'garden-log-toggle' },
  { name: '#503 日志容量 100→300（slice(-300)；改回 100 则老记录被挤掉复发）', file: 'js/garden.js', needle: 'if (data.l.length > 300) data.l = data.l.slice(-300);' },
  { name: '#503 日志独立 tab（garden-log 移入「日志」分区；删则日志又挤回花园页）', file: 'js/garden.js', needle: 'move("garden-log", "log");' },
  // ==== 2026-09-14 #450 收藏页「大量内容加载失败，只出现问号黑块」+图片显示异常（iPhone 15 Pro Max Chrome 等多机型；
  //      iOS 裂图=黑底问号块。根因：miss 读并发上限 MISS_READ_MAX=8，一屏令牌图超上限的部分当年拿不到读也不再被扫
  //      ——src 保持 @@m: 令牌＝浏览器当相对 URL 404＝裂图；原实现只在 DOM 再变更时才重扫，收藏列表翻到底不再动的
  //      静态页饿死图永久裂；另 idbGet 在 IDB 拥塞/内核挂起（#229 家族）时迟回不回＝槽位永久占满后续全饿死）====
  { name: '#450 miss 读重试泵（每次 miss 读结算防抖全文档补扫，上限饿死图逐波清零；删则收藏页等静态页超 MISS_READ_MAX 的令牌图永久保持 @@m: src=404 裂图＝iOS 问号黑块复发）', file: 'js/media-pool.js', needle: 'function missRetryPump() {' },
  { name: '#450 miss 读单飞结算+看门狗（槽位释放与结果处理解耦，双路只放行一次；删则 idbGet 挂起时槽位永久占满＝该哈希与后续读全部饿死成裂图，迟到结果双扣 missReads）', file: 'js/media-pool.js', needle: 'const __tokSettle = function () {' },
  // ==== 2026-09-14 #451 词典拼字/梦角自由造句「消息显示 A、引用预览显示 B」（iOS Chrome 等多机型同报：
  //      正文换血（rep.text=拼字/造句结果）后 parts 残留原回复——气泡渲染 parts 优先于 text（#202 混合消息链路），
  //      引用快照/收藏/回复引用读 text＝两轨不一致；创建侧同步重建+存量按来源 chip 归一化治愈）====
  { name: '#451 词典拼字正文换血同步重建 parts（文本段=最终正文+保留图片段；删则气泡渲染 parts 优先与引用/收藏读 text 两轨不一致＝「消息显示 A 引用预览显示 B」复发）', file: 'js/chat.js', needle: 'function spellPartsSync(text, prevParts) {' },
  { name: '#451 存量治愈（normCell 按来源 chip 识别换血旧消息，文本段≠正文时以正文重建 parts；删则历史词典拼字/梦角造句消息引用预览继续与气泡不一致）', file: 'js/chat.js', needle: "md.tag === '词典逐卡连发'" },
  // ==== 2026-09-14 #452 「每次打开都有自检和优化，点击之后再次打开仍然会有」+iOS 卡顿（iPhone 15 Pro Max Chrome；
  //      ①#411 免打扰标记裸 localStorage.setItem 在 LS 配额满（诊断 5.1MB 顶满 iOS 配额）时被 catch 吞=标记永远写不进
  //      =每次启动都弹；②启动主动扫描 mochiCcSlimScan 把 44.59MB 公用库整串读入堆+逐组 stringify（纯算字节）＝启动期
  //      秒级长任务/堆尖峰＝「一打开就卡/自动刷新重进」主力，且因①每次必付）====
  { name: '#452 优化免打扰标记 IDB 权威写+LS 兜底（裸 LS setItem 配额满被吞＝每次启动都弹「卡顿自检」；删则 LS 满设备提示循环复发）', file: 'js/personalize.js', needle: 'window.idbGet(PERF_REMIND_KEY)' },
  // ==== 2026-09-14 #453 消消乐模式拆分（用户点名「可选有道具的模式和默认简单模式没有道具」：头部 m3-mode 下拉按联系人
  //      记住 lastMode；简单=纯经典三消零道具（默认）；道具=经典消消乐道具集——四连直线→↔️/↕️清整行/整列、
  //      L/T 同色交叉（合计≥5格）→💥炸弹3×3、五连+→🌈彩虹（#301 炸弹/彩虹逻辑沿用）；随批 isRainbow 值域修正：
  //      直线道具 30+/40+ 也 ≥RAINBOW，裸 `>= RAINBOW` 判彩虹会把直线道具误当彩虹）====
  { name: '#453 消消乐道具模式门控（仅道具模式且交换首段消除才生成道具；删则简单模式也出道具＝「默认无道具」失效、或道具模式永远不出道具；2026-09-16 doSwap 快照守卫重构 st→s 随契约换锚，逻辑未变）', file: 'js/match3.js', needle: "chain === 1 && s.mode === 'item'" },
  { name: '#453 消消乐直线道具清列爆炸（↕️ 被消除清整列；删则纵向直线道具成摆设，姊妹锚 push([p[0], cc]) 守清行）', file: 'js/match3.js', needle: 'queue.push([rr, p[1]]);' },
  { name: '#453 消消乐直线道具清行爆炸（↔️ 被消除清整行；删则横向直线道具成摆设）', file: 'js/match3.js', needle: 'queue.push([p[0], cc]);' },
  { name: '#453 消消乐 L/T 同色交叉→炸弹（两道同色直线共享一格合计≥5格；删则 L/T 交叉退化普通三消＝经典消消乐包裹糖玩法丢失）', file: 'js/match3.js', needle: 'runs[i].len + runs[j].len - 1 >= 5' },
  // ==== 2026-09-15 #481 消消乐道具模式「消除后不变出道具」（多机型用户报：#301 taTurn 把 TA 出手风格写进 st.mode，
  //      与 #453 道具开关 st.mode('item'/'simple') 撞名——TA 第一次行动 st.mode 被覆写成 serious/normal/sandbag/blunder，
  //      此后道具门控 st.mode==='item' 永假；修复=出手风格改存独立字段 st.taMode）====
  { name: '#481 消消乐 TA 出手风格独立字段（删则 taTurn 把 st.mode 覆写成 serious/normal/sandbag/blunder、道具模式自 TA 首步起永远不再生成道具）', file: 'js/match3.js', needle: 'st.taMode = rollMode();' },
  // ==== 2026-09-15 #489 问问TA/邀请TA 回应落地时已切桌面＝回应被 sameCid() 取消，切回后卡片永远
  //      「等待 TA 回答/回应…」（用户报障：文字题联系人已回答，切桌面再切回变未回复）；修复=跨桌面
  //      补投递 chatDeskCardReply（按 ts 定位原桌面 pending 卡落 answered+补气泡）+ 发送时当场抽定
  //      回应内容（防异桌面抽错池）+ saveMsgsNow 即落盘 ====
  { name: '#489 问问TA切桌面跨桌面补投递调用（删则回应落地时已切桌面即被 sameCid 取消，切回永远未回复）', file: 'js/chat.js', needle: "window.chatDeskCardReply(myCid, 'ask', askRecTs, 'askStatus'" },
  { name: '#489 邀请TA切桌面跨桌面补投递调用（同 #489 邀请路径；删则邀请决定落地时已切桌面即永久丢失）', file: 'js/chat.js', needle: "window.chatDeskCardReply(myCid, 'invite', inviteRecTs, 'inviteStatus'" },
  { name: '#489 补投递按 ts 定位 pending 卡幂等闸（删则可能重复落回答/给已答卡补气泡）', file: 'js/chat.js', needle: 'r.ts === cardTs && !r.retracted) { hit = r; break; }' },
  { name: '#489 内存链路按 ts 重定位提问卡（删则 loadMsgs 重建 msgs 后旧索引错位，回答落到别张卡或丢失）', file: 'js/chat.js', needle: "r.ts === askRecTs && r.askStatus !== 'answered') return i;" },
  { name: '#454 字卡库顶部tab点不开（renderTabCounts 懒加载 groups=null 空守卫——#442 只给 renderGroupsBar 加了守卫，顶层首渲在此抛 null[\'text\'] 使 chatcard.js 整个初始化中断，顶部两大分类 tab/锁提示/搜索全不挂；删则多机型复发「系统预设字卡点不开」）', file: 'js/chatcard.js', needle: "const grps = (groups && groups[tab.dataset.type]) || [];" },
// ==== 2026-09-14 #458 「卡顿自检弹窗一键优化点击没用」多机型（原回调两端只有 3.2s toast——大库优化
//      耗时数十秒起、iOS 伴随卡顿/页面被杀，提示一闪而过＝观感「点了没用」；且无 .catch、idbGet 存储
//      繁忙挂起（#229 家族 iOS 高发）时 promise 永不落定＝永远无声。修复：结果常驻弹窗+catch+90s 看门狗，
//      零机型分支零存储语义改动）====
{ name: '#458 一键优化结果单飞收口（done 看门狗/完成/异常三路只放行一次并清定时器；删则多路重复弹窗或看门狗误报）', file: 'js/personalize.js', needle: 'clearTimeout(wd);' },
{ name: '#458 一键优化 90s 看门狗（idbGet 存储繁忙挂起 promise 永不落定也必出常驻提示；删则挂起设备点了优化永远无声＝「点击没用」复发）', file: 'js/personalize.js', needle: 'const wd = setTimeout(function () {' },
// ==== 2026-09-14 #459 「一键优化没进度感」（#458 反馈闭环后续）：取回 44MB 大键+预热令牌化期间
//      主线程间歇被占、干等观感差；给 mochiPerfHeal 加可选 prog(pct,label) 回调（不传行为不变，
//      verify 资产零影响），promptHeal 调用侧挂固定进度浮层显示阶段+百分比，结束仍由 #458
//      常驻弹窗收尾。零机型分支，零存储语义改动）====
{ name: '#459 一键优化实时进度浮层（perf-heal-bar 阶段+百分比由 prog 驱动；删则优化期间回到干等无声＝大库设备观感「点了没用」）', file: 'js/personalize.js', needle: "bar.id = 'perf-heal-bar';" },
{ name: '#459 prog 进度管道接通（showProg 传入 mochiPerfHeal；删则进度浮层停摆不更新＝进度功能失效）', file: 'js/personalize.js', needle: 'window.mochiPerfHeal(showProg)' },
{ name: '#459 mochiPerfHeal 进度回调骨架（step 归一封装 prog，取回/预热各阶段推进度；删则调用侧拿到不到任何进度）', file: 'js/storage-slim.js', needle: 'const step = function (pct, label)' },
// ==== 2026-09-14 #470 「maybeCardLockReminder is not defined 每次进入 uncaught + 字卡锁提醒永不弹出」多机型
//      （clock.js 两处 IIFE：提醒函数定义在防骗声明段 IIFE，finishEnter 在另一 IIFE 直呼函数名——
//      函数声明不会跨 IIFE 泄漏，线上每次点「我已阅读并确认进入」必抛 ReferenceError；
//      修复：挂 window.maybeCardLockReminder + finishEnter 守卫调用，零机型分支零逻辑改动）====
{ name: '#470 进入流程调用字卡锁提醒改守卫（window.maybeCardLockReminder 挂载 + finishEnter 守卫调用；删守卫/改回直呼函数名＝ReferenceError 与提醒失效双复发）', file: 'js/clock.js', needle: 'if (window.maybeCardLockReminder) window.maybeCardLockReminder();' },
// ==== 2026-09-15 #486 深色模式白底漏网全量收口（用户报「深色下还有很多颜色是白色导致看不见」，多机型同报；
//      tools/verify-dark-audit.mjs 135 步全量审计实测 60 处真问题，修复后 0；本批 src 随 140950a 上车，此处补登记哨兵）====
{ name: '#486 深色开关选中态滑块改深色（选中轨道是浅色 var(--ink)，滑块仍 #f0f0f0＝白滑块白轨道看不出开没开）', file: 'css/dark.css', needle: '[data-theme="dark"] .toggle input:checked + .tk::before { background:#111111; }' },
{ name: '#486 字卡库左菜单 .chat-item .av 白色图标块改深（chat-pages 硬编码 rgba(255,255,255,.92) 白块+浅描边图标＝白块看不见图标）', file: 'css/dark.css', needle: '[data-theme="dark"] .chat-item .av { background:#2a2a2a; border-color:var(--dark-border); }' },
{ name: '#486 此间分组芯片选中态补浅底（原覆盖只改字色没改底色＝深底深字）', file: 'css/dark.css', needle: '[data-theme="dark"] .cj-gchip.on { background:var(--ink,#f0f0f0); border-color:var(--ink,#f0f0f0); color:#111; }' },
{ name: '#486 备忘提醒快捷片深底亮字（memo.css 白蒙底+--ink-soft 灰字＝灰底灰字）', file: 'css/dark.css', needle: '[data-theme="dark"] .memo-rc { background:rgba(255,255,255,.08); border-color:rgba(255,255,255,.15); color:#bbbbbb; }' },
{ name: '#486 拍一拍存入按钮深底（chat-main.css 白底+var(--ink) 浅字＝白底浅字）', file: 'css/dark.css', needle: '[data-theme="dark"] .poke-input-save { background:var(--dark-card); border-color:var(--dark-border-12); color:var(--ink); }' },
{ name: '#486 桌面签到心形徽章深字（--widget-heart 浅圆底+硬编码白心形）', file: 'css/dark.css', needle: '[data-theme="dark"] .ck-heart { color:#111111; }' },
{ name: '#486 市集分类选中圆浅底深字（market.css #f2f2f5/#1f1f1f !important 浅色规则必须 !important 反压）', file: 'css/dark.css', needle: '[data-theme="dark"] .market-cat.sel .market-cat-ico { background:#f0f0f0 !important; color:#111111; }' },
{ name: '#486 市集商品卡顶部白带清除（#page-market .gift-item-top 白底 !important）', file: 'css/dark.css', needle: '[data-theme="dark"] #page-market .gift-item-top { background:transparent !important; }' },
{ name: '#486 心意柜 hero 深色下提亮字色（深底已覆盖但 color:#111 只在浅色规则＝图标深底深字）', file: 'css/dark.css', needle: '[data-theme="dark"] .giftbox-hero { color:#f2f2f2; }' },
{ name: '#486 聊内送礼面板商品渐变收尾跟主题色（内联 linear-gradient 硬编码 #fff 收尾＝深色白底；CSS 压不过内联只能改源头）', file: 'js/gift-shop.js', needle: "linear-gradient(160deg,' + col + ',var(--card-bg,#fff))" },
{ name: '#486 心意柜详情预览渐变收尾跟主题色（同上，catColor 变体）', file: 'js/gift-shop.js', needle: "linear-gradient(160deg,' + catColor + ',var(--card-bg,#fff))" },

  // ==== 2026-09-15 #490 引用预览条与气泡同轨显示（「联系人发的消息，引用后看到的和引用的不一致」
  //      EC-PAD01 SE Chrome 等多机型同报；气泡正文走 T()＝in 侧 taFit 称呼替换 + {ta}/{me} 昵称占位符，
  //      预览条此前直出存储原文＝两轨不一致，发送后引用块又走 taFit 对不上预览）====
  { name: '#490 引用预览同轨显示助手定义（删则预览条失去 taFit 称呼替换 + {ta}/{me} 昵称回填能力）', file: 'js/chat.js', needle: 'function quoteDisplayFit(text, side) {' },
  { name: '#490 预览条接入同轨显示（删则气泡显示替换词、引用预览仍是 ta/TA 原文＝引用不一致复发）', file: 'js/chat.js', needle: "quoteDisplayFit(quoteTextSafe(lastQuote.text || ''), lastQuote.side)" },

  // ==== 2026-09-15 #491 引用串条残留洞：开菜单【前】msgs 已中段位移而 DOM 未重渲（#220 不贴底
  //      防闪路径）＝#407 快照按陈旧下标取、开场即锁错条（四级重定位的输入本身已错）＝「引用的
  //      消息和显示的消息完全不对」（EC-PAD01 SE Chrome 等多机型同报）；修复=渲染期把消息内容
  //      身份写进 data-mk，开菜单按 mk 反查真实那条（stamp+resolve 两端都在位才生效，各一条哨兵）====
  { name: '#491 单聊渲染期身份锚写入（删则 data-mk 恒空＝开菜单只能按陈旧下标取，串条残留洞复发）', file: 'js/chat.js', needle: 'm.dataset.mk = msgKeyOf(rec);' },
  { name: '#491 单聊开菜单按身份锚反查（删则快照被位移后的陈旧 data-idx 毒化＝引用完全不对复发）', file: 'js/chat.js', needle: 'msgs.findIndex(mkMsg => msgKeyOf(mkMsg) === _mk)' },
  { name: '#491 群聊渲染期身份锚写入（删则群聊引用串条残留洞复发）', file: 'js/group-chat.js', needle: 'm.dataset.mk = gcMsgKeyOf(rec);' },
  { name: '#491 群聊开菜单按身份锚反查（删则群聊快照被陈旧 gcIdx 毒化＝串条复发）', file: 'js/group-chat.js', needle: 'msgs.findIndex(gmkMsg => gcMsgKeyOf(gmkMsg) === _gmk)' },

  // ==== 2026-09-15 #493 字卡库令牌卡直出乱码/白块（红米 K80 Chrome 等多机型同报「其他地方表情包正常，字卡库里纯白+乱码」）：#377 大库内存瘦身把超大贴纸/图片卡体换成 @@m:hash 令牌后，cardItemHtml 只有 data:/http(s) 图片分支，令牌卡掉进文字分支＝网格直出令牌串或空白；修复=渲染分支补认令牌按图渲染（懒加载+media-pool 观察器解图）+点击进大图而非文字编辑 ====
  { name: '#493 令牌卡按图渲染分支（删则字卡库网格直出 @@m:hash 乱码/白块复发）', file: 'js/chatcard.js', needle: "style=\"color:var(--muted)\">[图片丢失]</div></div>';" },
  { name: '#493 令牌卡点击查看大图·同步渲染路径（删则令牌卡点开文字编辑弹窗复发）', file: 'js/chatcard.js', needle: 'viewImage(v || c);' },
  { name: '#493 令牌卡点击查看大图·分块渲染路径（删则令牌卡点开文字编辑弹窗复发）', file: 'js/chatcard.js', needle: 'viewImage(v || it.c);' },

  // ==== 2026-09-15 #494/#495 启动期「未定义标识符/TDZ 被行内 catch 静默吞」双修（无头
  //      pauseOnExceptions 实锤，__jsErrors/console 永远看不到）：#494 chat.js 顶层回前台监听
  //      引用 scheduleReply/replyOnce 函数内局部 const sameCid＝每次回前台 ReferenceError 被吞、
  //      trySystemAskMochi 回前台补触发通道自上线即失效；#495 personalize.js deskLayout const
  //      定义在 buildDeskPages 顶层调用之后＝冷启动 TDZ、删页收缩落盘判断被吞。行为级回归：
  //      tools/verify-no-startup-referror.mjs（哨兵防整块删除，位置回退由该脚本兜）====
  { name: '#494 回前台补触发通道（删/退回带 sameCid 守卫的死段则 TA 自动申请零钱回前台不再补触发）', file: 'js/chat.js', needle: "try { setTimeout(function () { trySystemAskMochi(); }, randInt(2000, 6000)); } catch (e) {}" },
  { name: '#495 deskLayout 定义存在（随 #495 上移至 buildDeskPages 之前；删则冷启动 deskLayout 引用全灭）', file: 'js/personalize.js', needle: 'const deskLayout = () => {' },
  // v3.26.x：摸鱼值/工作值累计总开关（回复设置→其他「摸鱼值/工作值」组，新功能）——闸门收在
  // personalize.js addFish/addWork 入口，删掉守卫行＝开关失效、关闭后数值照涨（60 秒自动累计/
  // 点击摸鱼/番茄钟补偿/抓包奖励所有加分来源一并被闸）
  { name: '摸鱼值累计总开关闸门 addFish 入口（删则回复设置→其他「摸鱼值累计」开关失效，关闭后摸鱼值照涨）', file: 'js/personalize.js', needle: "if (!fishWorkOn('fish-en')) return;" },
  { name: '工作值累计总开关闸门 addWork 入口（删则回复设置→其他「工作值累计」开关失效，关闭后工作值照涨）', file: 'js/personalize.js', needle: "if (!fishWorkOn('work-en')) return;" },

  // ==== 2026-09-15 #497 存储可见性三件（用户报「全部数据内存占比显示不全 / 没有上传图片已压缩的说明 /
  //      导出前看不到全部数据多大和导出文件多大」）：①查看存储两条占用行补配额百分比；
  //      ②img-compress.js 上线时漏加 template 三锚点＝压缩图片功能全站无入口，补设置行+查看存储卡
  //      （含「上传当时已自动压缩」说明）；③askExportMode 弹窗的「本机数据约 X」原是整域 estimate
  //      （含同域其他站点），改 measureProject 按导出同路径实测（LS+IDB 双写去重、Blob×4/3 base64）
  //      + 配额占比 + 各模式导出文件预估。行为级回归：tools/verify-storage-export-info.mjs ====
  { name: '#497a 压缩图片设置行入口（template.html；删/改 id 则 img-compress.js 接线全落空＝设置页无入口复发）', file: 'template.html', needle: 'id="row-img-compress"' },
  { name: '#497a 查看存储页压缩入口按钮（template.html；缺则存储页无重压入口）', file: 'template.html', needle: 'id="st-img-compress-btn"' },
  { name: '#497b 上传图片已压缩说明（template.html 查看存储图片压缩卡；删则用户无法知道图片占用已是压缩后体积）', file: 'template.html', needle: '你上传/发送的图片在选定当时就已自动压缩过' },
  { name: '#497c 查看存储本项目合计带配额占比（删则总占用回到只有绝对字节＝「占比显示不全」复发）', file: 'js/personalize.js', needle: "'，占浏览器配额 ' + pctOf(ls.total + t, quotaInfo.quota)" },
  { name: '#497c 压缩完成后总占用联动刷新（img-compress 派发事件的本端监听；删则压完总占用纹丝不动）', file: 'js/personalize.js', needle: "addEventListener('mochi-img-compressed'" },
  // 🔧 2026-09-16 #581 会话换锚（#582 在途重构把「逐项累加」抽成 fb 中间量，原 needle `projFile += c + Math.round(blob * 4 / 3);`
  // 已不存在 → 全量构建报「修复真丢了」）。膨胀逻辑本身仍在原处，锚点改钉那条表达式本身。
  // ⚠️ 请 #582 会话确认此换锚符合原意。
  { name: '#497d 导出前实测计量·Blob 过 base64 膨胀进文件口径（删则导出文件预估对音乐/二进制严重偏小；#582 重构后改钉膨胀表达式本身）', file: 'js/data-backup.js', needle: "else if (typeof Blob !== 'undefined' && v instanceof Blob) { blob = v.size; fb = Math.round(blob * 4 / 3); }" },
  { name: '#497d 导出前阈值按实测导出体积判（删则回退整域 estimate 口径＝同域其他站点又冒充本机数据）', file: 'js/data-backup.js', needle: 'const bigRef = info ? info.projFile : usage;' },
  { name: '#497d 选范围弹窗带配额占比+各模式导出文件预估（删则「导出前看不到导出的文件多大」复发；#582 起预估压成一行「预估文件：完整/不含音乐/仅聊天记录…」，needle 随文案更新）', file: 'js/data-backup.js', needle: "'；预估文件：完整 '" },
  { name: '#505 链接导入按钮只留表情包/图片分类（切分类/进页按当前分类显隐；删则按钮重新在所有大分类 tab 常驻）', file: 'js/chatcard.js', needle: "b.style.display = (cur === 'sticker' || cur === 'image') ? '' : 'none';" },
  // ==== 2026-09-16 #605 字卡库空态按钮越界（用户报「【公用字卡】【专属字卡】里只有【表情包】【图片】该有批量导入图片/链接导入，其他分类也有，全部都有」）：#549 给空列表加的「链接导入」快捷按钮条件写成 `isVoice ? ''`＝除语音外所有分类（主字卡/颜文字/emoji/拍一拍/其他功能）空态都渲染，点了只吃「链接导入仅支持表情包和图片分类」toast＝死按钮（与 #505 工具栏同族）。修复=与 syncLinkImportVis 同口径，只在 sticker/image 渲染。批量导入（文字/分类型）按钮保留——文字分类本就靠它导入 ====
  { name: '#605 字卡库空态「链接导入」只留表情包/图片（删则回退 `isVoice ? \'\'`＝其余分类空态又出现死按钮）', file: 'js/chatcard.js', needle: "(cur === 'sticker' || cur === 'image') ? '<button type=\"button\" class=\"cc-empty-btn\" data-cc-empty=\"link\"" },
  { name: '#506 导出自包含·令牌还原助手（删则导出文件里 sticker/image 的 @@m: 令牌不再还原成图片数据＝导出缺表情包/图片全部数据复发）', file: 'js/chatcard.js', needle: 'function ccExportExpandTokens(obj) {' },
  { name: '#506 导出接线·导出数据先还原再落文件', file: 'js/chatcard.js', needle: 'ccExportExpandTokens(out).then(exp => {' },
  { name: '#506 媒体池令牌完整解析 API（导出还原的取数来源）', file: 'js/media-pool.js', needle: 'window.mochiMediaResolve = function (s) {' },
  // 2026-09-17 #663 对齐：同上，Coverage 侧的 REFS 与 GC 侧同文（源里两处本就一致），锚点同步扩入 feed-posts。
  { name: '#506 媒体池 GC/Coverage 引用面补字卡库两键（删则库内令牌引用的池条目被误判孤儿删除＝图片永久丢失）', file: 'js/media-pool.js', needle: 'chat-tail|cc-groups(?:-public)?|feed-posts(?:-snap)?|chat-arch)$' },
  { name: '#504a 进聊天页回弹·rAF 稳定窗（删则回退固定 400ms 复写＝视口内图片迟到长高当帧以旧 scrollTop 绘制，聊天记录回弹一下再恢复复发）', file: 'js/chat.js', needle: 'let chatEntrySettleToken = 0;' },
  { name: '#504b 稳定窗守卫：token/离页/解钉即停（删则用户上翻期稳定窗仍抢滚动权＝#162 不打扰契约被破坏）', file: 'js/chat.js', needle: 'chatEntrySettleToken || !chatVisible() || !chatPinnedBottom' },
  { name: '#504c 稳定窗变高当帧同步回钉（删则内容长高后到下一帧才修正＝回弹帧可见）', file: 'js/chat.js', needle: 'if (h !== lastH) { lastH = h; scrollChatBottom(); }' },
  { name: '#504d 图片 onload 同步回钉（删则长高后 rAF 下一帧才修正＝回弹帧可见）', file: 'js/chat.js', needle: 'scrollChatBottom(); requestAnimationFrame(scrollChatBottom);' },
  // ==== 2026-09-15 #507 语音播放按钮 touch 直驱（多机型「点我发出去的语音听不了/点了只弹菜单」）：#480 气泡轻点直驱把播放按钮轻点当「点气泡」＝开菜单+布吞 click 窗口，吞 click 族内核 click 永远不来＝语音播不出；修复=点气泡判定排除 .msg-voice-play + 按钮 touchend 直驱播放并守卫吞补发 click ====
  { name: '#507a 单聊点气泡判定排除播放按钮（删则轻点播放按钮重开菜单+布吞 click 窗口＝吞 click 族语音播不出复发）', file: 'js/chat.js', needle: "if (t.closest('.msg-voice-play')) return null;\nif (t.closest('.msg-quote')) return null;" },
  { name: '#507b 单聊播放按钮 touch 直驱守卫（删则吞 click 族内核只剩必丢的 click 一条路＝语音播不出复发）', file: 'js/chat.js', needle: 'vTapGuard = Date.now() + 800;' },
  { name: '#507c 群聊点气泡判定排除播放按钮（删则群聊轻点播放按钮重开成员菜单＝播不出复发）', file: 'js/group-chat.js', needle: "if (t.closest('.msg-voice-play')) return null;\nif (t.closest('.msg-quote')) return null;                 // 引用块点击留给后续跳原消息" },
  { name: '#507d 群聊播放按钮 touch 直驱守卫（删则群聊吞 click 族内核语音播不出复发）', file: 'js/group-chat.js', needle: 'gvTapGuard = Date.now() + 800;' },
  // ==== 2026-09-15 #508 图片「闪一下重新加载」（红米 K80 Chrome 等多机型，与 #504 聊天回弹同族）：头像互动点选换头像后 renderGrid()/renderMeGrid() 整格 innerHTML 重建＝img 全部新建+懒加载重新赋 src＝已解码图全部重新解码闪烁（无头节点身份实证 8/8 全被替换）；字卡库 render() 同族整格重渲丢全部已解码 img。修复=头像侧换头像只同步 .avlib-now 高亮不重建（内容没变唯一变化是高亮）；字卡库 render() 清空前按内容指纹收集旧卡 img、建卡时同指纹原位移植＝零重解码 ====
  { name: '#508a 头像池高亮更新函数（删则换头像回退整格重建＝图片全部重新解码闪烁复发）', file: 'js/avatar-lib.js', needle: 'function updateGridNow() {' },
  { name: '#508b 我的头像池高亮更新函数（删则换我的头像回退整格重建闪烁复发）', file: 'js/avatar-lib.js', needle: 'function updateMeGridNow() {' },
  { name: '#508c 高亮更新保底回退重建：格数或内容不符才走 renderGrid（删则库真变化时高亮不同步）', file: 'js/avatar-lib.js', needle: 'avGrid.querySelectorAll(\'.avlib-cell\')' },
  { name: '#508d 字卡库建卡写内容指纹（#509 改短键、#613 改令牌稳定身份 ccPoolKey；删则整格重渲无从识别未变化卡＝复用失效闪烁复发）', file: 'js/chatcard.js', needle: 'el.dataset.ccSig = ccPoolKey(it.c);' },
  { name: '#508e 字卡库重渲前回收已解码 img（#509 改为回收进模块池 ccPoolHarvest(list)；删则已解码图全部丢弃重建＝闪烁复发）', file: 'js/chatcard.js', needle: 'ccPoolHarvest(list);' },
  { name: '#508f 同指纹原位移植已解码 img（删则重渲即重新解码＝闪烁复发）', file: 'js/chatcard.js', needle: '_ni.parentNode.replaceChild(_oi, _ni)' },
  // ==== 2026-09-15 #509「每次打开都闪」（红米 K80 Chrome 等多机型，用户明说其他设备型号也有）：#508 只覆盖「点选换头像」与「字卡库当次 render 内移植」，**打开路径**没覆盖——①openAvlib() 每次打开都整格重建（实证打开→关闭→再打开 8/8 img 全被替换）；②字卡库真实进页路径是「openCcPage 先按 cur='text' 渲一遍清空 list → 点『表情包』tab 再渲第二遍」，第二次要用的节点已离开 DOM＝当次收集抓不到＝整格新建（实证 12/12）；rebuildGroupAfterRemove（删一张卡重建整组）同族。修复=①复用判定改返回值，打开走 renderGridSmart/renderMeGridSmart（库没变零重建）＋restoreLib 回填后同口径刷新；②新增模块级图片节点回收池（上限 150 + 闲置 3 分钟释放）跨 render 存活，回收/取用覆盖整格重渲与局部重建 ====
  { name: '#509a 头像互动打开路径复用优先（删则每次打开半框整格重建＝图片闪一下重新加载复发，多机型同发）', file: 'js/avatar-lib.js', needle: 'if (!updateGridNow()) renderGrid();' },
  { name: '#509b 我的头像池打开路径复用优先（删则切到「我的头像库」页签同样每次重载）', file: 'js/avatar-lib.js', needle: 'if (!updateMeGridNow()) renderMeGrid();' },
  { name: '#509c 模块级图片节点回收池取用（#613 键改令牌稳定身份；删则跨 render 无池可取＝每次进表情包页整格新建重解码）', file: 'js/chatcard.js', needle: 'ccPoolTake(ccPoolKey(c))' },
  { name: '#509d 局部重建（删卡重建整组）前回收图片节点（删则删一张卡该分组图片全部重载）', file: 'js/chatcard.js', needle: 'ccPoolHarvest(el);' },
  { name: '#509e 回收池闲置整池释放（删则已解码位图长期驻留内存，大库机型内存压力回升）', file: 'js/chatcard.js', needle: 'setTimeout(ccPoolRelease, 180000)' },
  // ==== 2026-09-16 #617「图片闪一下重新加载」第三轮（红米 K80 Chrome 等多机型，用户明说其他设备型号也有）——两条互相独立的根因，均是 #457/#508/#509/#547 收口面之外的：
  //   ①头像：fillAvatar 无条件 el.innerHTML=''+新建 img 赋 src ⇒ 每次调用都换节点＝重新解码＋空一帧；换头像走 refreshChatAvatars() 把全部气泡头像+顶栏一起换（无头 390×844 实测 17 个 img 节点新建 / 17 次 load），回前台·切桌面 (convergeAvatars) 同路 ⇒ 整列头像一起闪。
  //   ②字卡库表情包页：回收池键 ccImgKey 按「原始字符串」算，而同一张卡有 dataURL 与 @@m: 令牌两种形态（ccPoolAdopt 的 isImg 判定本就同时认），形态一翻键就变 ⇒ 池全 miss ⇒ 已解码节点成孤儿、整格新建重解码。小图 (<64KB) 不令牌化 ⇒ 只用小图夹具的旧回归脚本永远绿。
  //   修复＝①值没变不碰 DOM（__avApplied 守卫）＋值变了只改现有 img.src 不拆节点；②池键改用 ccMediaCardIdent（令牌↔原文同一身份，#547 同口径）。零机型分支、零视觉改动 ====
  { name: '#617a 头像落值守卫（删则值没变也整块重建节点＝换头像/回前台整列头像闪+重载复发）', file: 'js/chat.js', needle: "if (el.__avApplied === (data || '')) return;" },
  { name: '#617b 头像改值只改现有 img.src 不拆节点（删则退回 el.innerHTML=\'\'+新建 img＝该位置空一帧再出现）', file: 'js/chat.js', needle: "if (cur) { cur.src = data; cur.alt = ''; }" },
  { name: '#617c 字卡库回收池键改令牌稳定身份（删则 dataURL↔@@m 一翻池全 miss＝表情包页每次打开图片重新加载复发）', file: 'js/chatcard.js', needle: 'const k = window.ccMediaCardIdent(c);' },
  { name: '#617d 头像实时生效落值守卫 applyAvatarImg（删则头像互动点选换头像把整列 .msg-in/.msg-out 气泡头像拆节点重建＝闪+重载复发；此函数才是「点选换头像」真正走的路，#617a 的 fillAvatar 只覆盖刷新侧）', file: 'js/avatar-lib.js', needle: 'if (el.__avApplied === want) return;' },
  // ==== 2026-09-15 #510 联系人发来的「亲亲/贴贴申请」弹窗同意后系统消息无留痕（用户报「我同意后，系统消息里没有相关消息」）：贴贴邀请（cuddle）原链路同意只震动+TA 回应一句、拒绝只发婉拒话术，聊天记录里没有任何系统消息；口径对齐换头像邀请（avatar-lib replyMeInvite）与听歌邀请（music-player sm-req-*）。猜拳/游戏类邀请不补（对局结果另有系统消息，避免同一件事留痕两次）====
  { name: '#510a 贴贴邀请同意写系统消息（删则同意后聊天无「你接受了 × 的贴贴邀请」留痕＝原报障复发）', file: 'js/chat.js', needle: "你接受了 ' + name + ' 的贴贴邀请" },
  { name: '#510b 贴贴邀请拒绝写系统消息（删则拒绝后只剩婉拒话术、系统消息留痕丢失）', file: 'js/chat.js', needle: "你拒绝了 ' + name + ' 的贴贴邀请" },
  { name: '#510c openInviteConfirm 支持 onDecline 回调（删则该分支回退「只发婉拒话术」＝#510b 失锚）', file: 'js/chat.js', needle: "else if (typeof onDecline === 'function') onDecline();" },
  // ==== 2026-09-15 #513「梦角自由造句」与「混合模式」默认打开（用户点名「梦角自由造句和梦角自由造句的混合模式需要默认打开」）：#317 初版把 mjf-en 定为默认关（「可自由选择开关」），#414 混合模式同样默认关；本轮翻案＝装上即生效。仅翻 DEFAULTS 对已写盘设备无效（旧默认 '0' 随「保存设置」全量写盘落盘），故补标记键 reply-mjf-on-migrated 一次性把存量 '0' 收成 '1'（与 #388/#443 同款标记式迁移：值式会在用户之后每次手动关闭时被加载反复改回）====
  { name: '#513a 梦角自由造句总开关默认开（DEFAULTS mjf-en=1；改回 0＝装上仍是关的、用户点名「需要默认打开」落空）', file: 'js/reply-settings.js', needle: "'mjf-en': 1, 'mjf-prob': 20," },
  { name: '#513b 造句混合模式默认开（DEFAULTS mjf-mix=1；改回 0＝默认只走 mjf-style 单一手法、三手法不再交替）', file: 'js/reply-settings.js', needle: "'mjf-mix': 1," },
  { name: '#513c 存量开关 0→1 一次性迁移+标记键（删＝已保存过设置的设备仍停在关，用户看到「默认还是没打开」＝原报障复发）', file: 'js/reply-settings.js', needle: "s.set('reply-mjf-on-migrated', '1');" },
  // ==== 2026-09-17 #644 逐卡连发「不受条数限制」默认翻回开（用户翻案 #443，多机型报「默认开启、按钮却是关的」）：#443 曾把 qs-noLimit 默认 1→0 并把存量收口成 0；本轮恢复 #350 默认开，#443 已写盘的存量 '0' 由 migrateQsNoLimitBack 按标记键反向补迁（标记 1→2，用户此后手动关闭不再被纠正）====
  { name: '#644a 逐卡连发不受条数限制默认开（DEFAULTS qs-noLimit=1；改回 0＝新装设备按钮默认关、连发被 reply-max 截断＝本条报障复发）', file: 'js/reply-settings.js', needle: "'qs-multi': 1, 'qs-noLimit': 1," },
  { name: '#644b #443 存量 0 反向补迁 0→1+标记升 2（删＝已写盘设备仍停在关，按钮照旧显示关＝报障复发）', file: 'js/reply-settings.js', needle: "if (String(s.get('reply-qs-noLimit')) === '0') { s.set('reply-qs-noLimit', '1'); changed = true; }" },
  // ==== 2026-09-15 #511 拍一拍手势泄漏族 + 进聊天气泡「先变 2 条再恢复」（用户三条同批报障）：①桌面点开【聊天】进页面，联系人最新一条消息变 2 个又恢复＝LS 快照与内存 msgs 的合并签名只比 ts|side|原文前64字符，同一逻辑消息 LS 侧是 base64、内存侧已令牌化（#256）判成两条 → 首帧渲 2 个气泡、后台归一化又合并回 1；写侧（mergeLsSnapshotWith）与读侧（loadMsgs）各有一份同款内联签名，只修一处＝半修。②点联系人头像有时没打开拍一拍页、直接发出拍一拍 ③「我的拍一拍」tab 打开该页默认弹输入法＝同源：touch/pointer 路在 touchend 里同步开面板并渲染字卡/输入行，紧随的合成 click 落点已在面板内（落字卡＝误发+面板一闪而过；落输入框＝聚焦弹键盘，输入行仅 mine tab 显示故只有该 tab 复现）。上一轮修复只声明了 pokeOpenClickGate 却从未赋值（闸恒 0）＝拦截器形同虚设，本条即报障复发的直接原因 ====
  { name: '#511a 两处合并点统一走 lsMergeSig（删/退回内联签名＝跨形式同一条判成两条、进聊天气泡先变 2 个再恢复复发）', file: 'js/chat.js', needle: 'msgsNow.map(lsMergeSig)' },
  { name: '#511b 进页读侧合并同样走 lsMergeSig（只修写侧＝LS 里继续存两份，下次进页照样先 2 后 1）', file: 'js/chat.js', needle: 'lsArr.map(lsMergeSig)' },
  { name: '#511c 拍一拍点击闸真的被布上（openPokeCard 按 fromGesture 调 pokeArmClickGate；退回「只声明不赋值」＝闸恒 0、拦截器形同虚设，②③两条报障复发）', file: 'js/chat.js', needle: 'if (fromGesture) pokeArmClickGate();' },
  { name: '#511d 闸拦截范围＝整个 poke-card（只挂 pokeList 时输入行不在覆盖内＝③弹输入法复发）', file: 'js/chat.js', needle: "pokeCard.addEventListener('click'" },
  { name: '#511e 闸内被聚焦的输入框主动收回焦点（内核对 input 的聚焦在 touchstart 期已定，click 层 preventDefault 拦不住）', file: 'js/chat.js', needle: "pokeCard.addEventListener('focusin'" },
  { name: '#511f 开面板主动失焦（「我的拍一拍」tab 输入行常驻可见，泄漏 click 落到它就唤起输入法）', file: 'js/chat.js', needle: 'try { pokeInput.blur(); } catch (e) {}' },
  { name: '#511g 旧内联合并签名不得复活（absent：const sig2 只有 ts|side|前64字符＝跨形式判不出同一条，半修征兆）', file: 'js/chat.js', needle: 'const sig2 =', absent: true },
  // ==== 2026-09-15 #513a 语料口径校对（用户点名「使用的是 自定义字卡的公用字卡＋专属字卡＋系统预设的默认聊天字卡＋默认聊天字卡·词典」）：①默认聊天字卡源此前只取 main 主字卡，与 字卡库→系统预设→默认聊天字卡 页的四分类（主字卡/颜文字/emoji/拍一拍）不同口径；②词典源漏滤逐张关闭（字库→词典里关掉的语录仍被当源句），与词典拼字 quote-spell.js 口径不一致。修复：defaultPool 遍历四分类并尊重分类开关 defaultCardCat + 逐张关闭；dictPool 补 isDefaultCardOff('dict', …) ====
  { name: '#513d 造句·默认聊天字卡源＝四分类同源（改回只取 main＝拍一拍字卡不再作源句，与字卡库页口径脱节）', file: 'js/dream-free.js', needle: "const DEF_CATS = ['main', 'kaomoji', 'emoji', 'touch'];" },
  { name: '#513e 造句·词典源逐张关闭过滤（删＝字卡库→词典里关掉的语录仍被抽作源句，与词典拼字口径不一致）', file: 'js/dream-free.js', needle: "return filterCorpus(all.filter(t => !(window.isDefaultCardOff && window.isDefaultCardOff('dict', t))));" },
  { name: '#622c 存公用库概率行标签去掉「（多联系人）」（标签写回多联系人限定＝单联系人用户仍以为这项对自己无效而不去调，用户报障复发）', file: 'template.html', needle: '存公用库概率（0=全专属/100=全公用）' },
  // ==== 2026-09-15 #515 系统预设字卡三页「触发概率显示 + 可调」（用户报「字卡库的系统预设字卡里，聊天回应字卡 / 使用情绪字卡 / 寻踪日常字卡 3 个功能页面里都没有显示触发的概率和可调整的按钮功能」）：这四项概率此前全写死在代码里——情绪 70%（+连续衰减 70/60/45/30/20）、心意 40%、交流意图 40%、回应字卡整条替换 30%，寻踪日常推送的 dcf-checkin 只挂在【其他互动功能字卡】页（寻踪页自己看不到也改不了）。修复＝三页各补概率行 + 消费点接线（未设键回退原写死值＝默认行为不变），寻踪那处与功能字卡页共用同一个 dcf-checkin、改一处两处同步；行为断言见 tools/verify-card-prob-pages.mjs（HEAD 基线 5/27 → 修复 27/27） ====
  { name: '#515a 聊天情绪字卡页三类概率 stepper（删＝该页又变回「只有总开关、没有显示触发的概率和可调整的按钮」＝原报障复发）', file: 'template.html', needle: 'id="mc-prob-mood-val"' },
  { name: '#515b 聊天回应字卡页两个消费点概率 stepper（整条替换 rcard-prob + 连接词追加 cf-prob，删＝该页概率不可见不可调）', file: 'template.html', needle: 'id="cf-prob-val"' },
  { name: '#515c 寻踪日常字卡页「寻踪日常发送到聊天」概率行（data-dcfkey=checkin＝与功能字卡页同键同步；删＝该页看不到概率）', file: 'template.html', needle: 'data-dcfkey="checkin"' },
  { name: '#515d 情绪/心意/意图概率未设键回退 70/40/40（改默认＝所有没设过键的老设备概率被悄悄改掉）', file: 'js/mood-reply-cards.js', needle: 'const MC_PROB_DEF = { mood: 70, heart: 40, intent: 40 };' },
  { name: '#515e 回应卡整条替换概率改读 rcardProb()（#518 起再套总档；退回写死 if (Math.random() * 100 >= 30) ＝该页「回应字卡使用概率」stepper 点了不生效）', file: 'js/mood-reply-cards.js', needle: "if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(rcardProb()) : rcardProb())) return '';" },
  // ===== #518 系统预设字卡·聊天触发概率「总档 + 分类档」 =====
  { name: '#518a 总档 dcp-all 走回复设置 DEFAULTS/stepper 体系（删 data-k="dcp-all"＝总档行不显示不落盘）', file: 'template.html', needle: 'data-k="dcp-all"' },
  { name: '#518b 分类档首行「默认聊天字卡·聊天使用」锚（id=dcp-dc-overall-chat，reply-settings #518 段按 id=dcp-<键> 绑定）', file: 'template.html', needle: 'id="dcp-dc-overall-chat"' },
  { name: '#518c dcf 19 类折叠块末行「TA主动提问」锚（data-dcfkey 由 default-cards bindDcfProb 自动接管）', file: 'template.html', needle: 'id="dcf-prob-ask-rs"' },
  { name: '#518d 总档 API 暴露 dcpEff（生效=设定值×总档÷100；未设键=100 原值直通）', file: 'js/dcp-master.js', needle: 'window.dcpEff = dcpEff;' },
  { name: '#518e 总档 API 暴露 dcpAll（键 reply-dcp-all per-cid，未设/坏值回 100）', file: 'js/dcp-master.js', needle: 'window.dcpAll = dcpAll;' },
  { name: '#518f 邀请三道门 hit 出口套总档（删包裹＝猜拳/游戏/贴贴不受总档缩放）', file: 'js/ta-invite.js', needle: 'Math.random() * 100 < (window.dcpEff ? window.dcpEff(p) : p)' },
  { name: '#518g 词典拼字 qs-prob 套总档（退回裸 Number(c[\'qs-prob\'])＝词典不受总档缩放）', file: 'js/quote-spell.js', needle: "window.dcpEff ? window.dcpEff(Number(c['qs-prob'])) : Number(c['qs-prob'])" },
  { name: '#518h TA的心情掷签套总档（退回裸 getProb()＝心情不受总档缩放；显示读点保持存盘值）', file: 'js/ta-mood.js', needle: 'window.dcpEff ? window.dcpEff(getProb()) : getProb()' },
  { name: '#518i 查岗概率套总档（退回裸 c[\'ckq-prob\']＝查岗不受总档缩放）', file: 'js/ck-question.js', needle: "window.dcpEff ? window.dcpEff(c['ckq-prob']) : c['ckq-prob']" },
  { name: '#518j 连接词追加 cf-prob 套总档（退回裸 hit(c[\'cf-prob\'])＝连接词不受总档缩放）', file: 'js/chat.js', needle: "window.dcpEff ? window.dcpEff(c['cf-prob']) : c['cf-prob']" },
  { name: '#518k 四类互动卡（询问/小问题/好奇/吐槽）掷签套总档（四处包裹任一被删即特征减少，verify 脚本另有条数=4 断言）', file: 'js/ta-ask.js', needle: "window.dcpEff ? window.dcpEff(typeof s.prob === 'number' ? s.prob : 5)" },
  { name: '#518l 情绪卡衰减基数套总档（退回裸 mcProb(\'mood\')＝情绪卡不受总档缩放；显示读点保持存盘值）', file: 'js/mood-reply-cards.js', needle: "window.dcpEff ? window.dcpEff(mcProb('mood')) : mcProb('mood')" },
  { name: '#518m 心意卡掷签套总档（退回裸 mcProb(\'heart\')＝心意卡不受总档缩放）', file: 'js/mood-reply-cards.js', needle: "window.dcpEff ? window.dcpEff(mcProb('heart')) : mcProb('heart')" },
  { name: '#519 设置页 them-sec system 分区闭合锚（#518 分区改版漏 1 个 </div>＝#page-setting 未闭合吞掉 tabbar＝桌面底部导航 3 按钮随页 hidden 消失；与 #473/#477 同族第三次，删此闭合即复发报警）', file: 'template.html', needle: '</div><!-- /them-sec system -->' },
  { name: '#520 设置页 them-sec chat 分区闭合锚（chat 段装「回复/通话/音效设置+功能大全」，同族分区少闭合即 #page-setting 吞 tabbar，删此闭合即复发报警）', file: 'template.html', needle: '</div><!-- /them-sec chat -->' },
  { name: '#515f 情绪卡衰减按可调基数同比例缩放（退回固定 70 基＝调低基数后衰减档位与页面显示的基数脱钩）', file: 'js/mood-reply-cards.js', needle: 'let prob = Math.max(0, Math.min(100, _mBase * _ratio));' },
  { name: '#515g 同一 dcf 概率键的多处 stepper 批量绑定 + 同键刷新（删＝寻踪页与功能字卡页各显示各的、改一处另一处不变）', file: 'js/default-cards.js', needle: 'window.dcfRefreshUI = dcfRefreshUI;' },
  { name: '#515h 概率行显示存盘值而非闸门后的生效值（退回 dcfVal＝总开关关闭时各概率行显示 0、点 ± 被复位成 0＝点了没反应）', file: 'js/default-cards.js', needle: 'if (valEl) valEl.value = String(dcfRaw(k));' },
  { name: '#521a 批量问卷在聊天里渲染成长卡片（special:ask-survey 专用分支；删＝问卷退回只有一行 ask-msg 小字，用户报的「不像单题长卡片」复发）', file: 'js/chat.js', needle: "if (rec.special === 'ask-survey') {" },
  { name: '#521b 问卷进度回写助手（ta-ask.js 逐题作答/交卷时按 surveyTs 定位卡片快照；删＝卡片停在 0/N 不随作答更新）', file: 'js/chat.js', needle: 'window.chatSyncSurveyCard = function (surveyTs, status, answers) {' },
  { name: '#521c 问卷发出时插入 ask-survey 卡片快照（删＝只有「你向TA发出了一份问卷」提示语，无卡片本体）', file: 'js/ta-ask.js', needle: "special: 'ask-survey'," },
  { name: '#521d 问卷长卡片样式壳（观感对齐单题 ask-card：删＝卡片无白底/圆角/题距，退回裸文本堆叠）', file: 'css/chat-main.css', needle: '.msg-survey-head { font-size:14px; font-weight:700;' },
  { name: '#521e 问卷长卡片暗色适配（删＝暗色主题下卡片仍白底刺眼）', file: 'css/dark.css', needle: '[data-theme="dark"] .msg-survey-card { background:var(--dark-card-92);' },
  { name: '#522a 聊天消息菜单 touch 直驱取消 touchend 默认行为（抑制弹窗刚开即被补发 click 关掉＝长按→编辑无反应，vivo X200s Edge 等多机型）', file: 'js/chat.js', needle: 'e.preventDefault();\nmaClickGuard = Date.now() + 600;' },
  { name: '#522b 弹窗遮罩忽略「打开弹窗那次触摸补发的合成 click」（350ms 窗口；删＝任何 touch 直驱开弹窗的动作复发刚开即关）', file: 'js/personalize.js', needle: 'if (Date.now() - _openedAt < 350) return;' },
  { name: '#523a 问卷时间改 App 内自绘选择器（原生 datetime-local 弹层锚点不受控、会飞出屏幕；删＝两处时间入口无处可点）', file: 'js/ta-ask.js', needle: 'function openDeadlinePicker(title, current, cb) {' },
  { name: '#523b 自绘选择器静态锚点 + 一次性绑定 dlPickerInit（选择器 DOM 写在 template 的 #dl-picker-mask；删＝动态 append 输入框在部分环境点不动）', file: 'js/ta-ask.js', needle: 'function dlPickerInit() {' },
  { name: '#523j 自绘选择器静态 DOM 锚（template 预置 #dl-picker-mask，随载入全量 ceConvert；删＝回退动态 append，部分环境输入框点不动）', file: 'template.html', needle: 'class="modal-mask" id="dl-picker-mask"' },
  { name: '#523k 点问卷卡片打开只读「问卷详情」弹窗（删/改回 openAskSurvey＝点已交卷卡片又跳批量设置问卷页，用户报障复发）', file: 'js/ta-ask.js', needle: 'window.openSurveyDetail = function (rec) {' },
  { name: '#523c 选择器样式壳（分钟输入框 + 弹层按钮；删＝控件无样式不可用）', file: 'css/setting.css', needle: '.dl-picker-in:focus { border-color:var(--ink); }' },
  { name: '#523d 两处时间入口改为自绘按钮（用户报「浏览器自带的选择器飞出屏幕」；native input 锚点会被 base.css 的 :not([type=datetime-local]) 命中，故登记按钮本体）', file: 'template.html', needle: 'id="ta-ask-deadline" class="tc-input deadline-btn"' },
  { name: '#523e 批量问卷「TA 的作答发送到聊天消息」开关入口（删＝无法在发出前关掉逐条刷聊天）', file: 'template.html', needle: 'id="ta-survey-chat"' },
  { name: '#523f 批量问卷逐条发答受 sendToChat 门控（改恒发＝题多时答案全刷进聊天，用户报的「太多了」复发）', file: 'js/ta-ask.js', needle: 'cur.settings.sendToChat !== false' },
  { name: '#523g 发出问卷后自动关闭设置页回聊天（删＝点了发出仍停在批量设置页，用户报的「没返回聊天」复发）', file: 'js/ta-ask.js', needle: 'function surveyGoChat() {' },
  { name: '#523h 同一轮交卷只提醒一次（doneMsgAt=已提醒轮的 sentAt；改回恒发＝并发/重入时第二条「TA 交卷了」复发）', file: 'js/ta-ask.js', needle: 'const notify = d2.doneMsgAt !== d2.sentAt;' },
  { name: '#523i 已交卷（done）允许直接再发一轮（发出发出时重置 answers/doneMsgAt；删＝用户报的「已交卷的问卷无法重复提交给联系人作答」复发）', file: 'js/ta-ask.js', needle: 'd.status = \'sent\'; d.sentAt = Date.now(); d.answers = []; d.doneMsgAt = 0;' },
  // ==== 2026-09-15 #524 聊天设置「功能」页分类整理（用户要求：①二级 tag 删掉「全部」；②「允许删除联系人消息」移入消息输入分类；③分类名不合适要改） ====
  { name: '#524a 功能页二级 tag 不再有「全部」（改回/加回＝进页默认全显、与高亮 tag 对不上，用户点名删除的项复活）', file: 'template.html', needle: 'data-ft="all"', absent: true },
  { name: '#524b「允许删除联系人消息」落在功能页「消息」分类（搬回数据页＝用户报的「这个开关不在消息输入分类里」复发）', file: 'template.html', needle: '<div class="gs-title" data-tag="msg">消息管理</div>' },
  { name: '#524c 功能页 tag 进页即按默认选中项过滤（删＝去掉「全部」后进页仍全显、高亮的「形象」形同虚设）', file: 'js/chat-settings.js', needle: "applyFilter(def ? (def.dataset.ft || 'all') : 'all');" },
  { name: '#524d 功能页分类名「消息输入」→「消息」、「界面」→「显示」（改回旧名＝用户报的「分类名字不太合适」复发：旧名盖不住删除消息/全是显隐开关）', file: 'template.html', needle: '<div class="them-tab" data-ft="msg">消息</div>\n        <div class="them-tab" data-ft="ui">显示</div>' },
  { name: '#525b 「关于」段不再承载清除本地数据（旧分组注释复活＝清除本地数据被搬回关于段）', file: 'template.html', needle: '<!-- 关于：清除本地数据 + 版本 + 防骗声明（常驻底部，不随标签切换） -->', absent: true },
  // ==== 2026-09-15 #526 新建联系人首次进聊天不再显示「正在加载聊天记录…」（空桌面白等 2.5s 空库二次复核） ====
  { name: '#526 已知空库（新联系人/空桌面）不显示聊天记录加载进度条（删 chatKnownEmpty 判定＝新建联系人首次进聊天又白等 2.5s 空库复核才收起进度条；needle 随 #703 去 msgs 前置演进，2026-09-17）', file: 'js/chat.js', needle: 'chatLoadingEl.hidden = !(chatVisible() && !chatDbReady && !chatKnownEmpty);' },
  // ==== 2026-09-15 #527 模块加载体检：诊断「启动文件异常」带文件名 + 语法错致整段未加载可自查 ====
  { name: '#527 模块加载体检（__mochiLoaded 对比 __mochiJsFiles 定位整段未加载的文件；删掉＝语法错/启动抛错导致的功能整块失效无法自查）', file: 'js/device.js', needle: "'模块加载体检 ' + mc.loaded.length + '/' + mc.expected.length" },
  // ==== 2026-09-15 #528 诊断置顶结论聚合 + 桌面模拟器外壳底部几何误报豁免 ====
  { name: '#528 桌面外壳底部几何豁免（删掉＝PC 宽屏 .phone 居中手机壳被恒判「底部少填 ~24px 白带」，每次自动采集刷错误环）', file: 'js/device.js', needle: "else if (inp.isMobileDev === false) add(true, '桌面模拟器外壳" },
  { name: '#528 诊断置顶结论聚合（删掉＝错误/启动异常/模块未加载/入口缺失/存储/屏幕适配 ✗ 又散在十几节，用户看不出到底坏没坏）', file: 'js/device.js', needle: "'⚠ 发现 ' + issues.length + ' 项：'" },
  // ==== 2026-09-15 #529 聊天顶部头像打开的寻踪半框 #ck-panel 点外/再点头像无法关闭 ====
  { name: '#529a 寻踪半框补 document 点外关闭器（删＝点屏幕其他地方关不掉，用户报障复发；needle 为「命中头像入口不关/其余面板外一律关」的判定+关闭调用，按产物行首去缩进书写）', file: 'js/p2-features.js', needle: 'if (av && (e.target === av || av.contains(e.target))) return;\ncloseCkPanel();' },
  { name: '#529b 寻踪半框开关逻辑（开着则关；改回恒 openCkPanel＝再次点顶部头像纹丝不动，用户报障复发）', file: 'js/p2-features.js', needle: 'if (!p.hidden) { closeCkPanel(); return; }' },
  { name: '#529c 聊天顶部头像入口改走 toggleCkPanel（删/改回 openCkPanel＝同一个用户报障复发）', file: 'js/chat.js', needle: 'if (window.toggleCkPanel) window.toggleCkPanel();' },
  // ==== 2026-09-15 #530 安卓键盘期底部安全区归零（输入栏与输入法之间露大块底色，vivo S20 Edge 等；全屏正常）====
  { name: '#530a 安卓键盘在场判据（删/改回不判断＝键盘期仍回落 env(safe-area-inset-bottom) 那个 Chromium 缺陷值，输入栏被垫高、空白复发）', file: 'js/mobile-adapt.js', needle: "var _kbOn = !!(_aProv || (_aVV && _aH > 0 && _aVV.height > 0 && _aVV.height < _aH - 60));" },
  { name: '#530b 键盘期把 --mochi-safe-bottom 钉 0px（删掉＝输入栏底部留出不受页面控制的空白；收起摘除回落 env 的语义同函数内 removeProperty 行）', file: 'js/mobile-adapt.js', needle: "d.style.setProperty('--mochi-safe-bottom', _next);" },
  // ==== 2026-09-16 #556 iOS 键盘期底部安全区归零（输入栏与输入法之间露白带；iPhone 16 Pro iOS 18.7 standalone/全屏同现、多机型；#530 安卓镜像，iOS 键盘覆盖式 env() 仍报 Home 指示条 34px）====
  { name: '#556a iOS 键盘在场判据（删/改＝键盘期仍回落 env(safe-area-inset-bottom) 的 Home 指示条值，白带复发；判据与 syncVvFit 摘 --mochi-ios-h 同源）', file: 'js/mobile-adapt.js', needle: "if (_kbActive || _iProv || _kbNowLike()) { // #556 键盘在场判据（与 syncVvFit 摘 --mochi-ios-h 同源）" },
  { name: '#556b 键盘期把 --mochi-safe-bottom 钉 0px（删掉＝iOS 输入栏底部留出 34px 级不受页面控制的白带；收起摘除回落 env，语义同函数内下方 removeProperty 分支）', file: 'js/mobile-adapt.js', needle: "if (cur !== '0px') d.style.setProperty('--mochi-safe-bottom', '0px'); // #556 键盘期钉 0" },
  { name: '#556c 键盘开启路径显式归零（iOS vv resize 偶发漏触发，事件驱动的 healViewport 不保证及时跑；删掉＝漏触发时白带复现）', file: 'js/mobile-adapt.js', needle: "syncSafeBottom(); // #556：键盘开启即归零（收起 restoreKb 摘除回落 env）" },
  // ==== 2026-09-15 #527 桌面/聊天美化数据完整性（漏键 / 导入静默 / 刷新丢大图 / 撤销串桌面）====
  { name: '#527a BEAUTY_KEYS 补齐 5 个历史漏键（phone-bg-pos-x/-y/-size、phone-bg-solid、app-name-color 不在采集清单=存方案再应用时壁纸定位缩放/纯色/图标文字色静默蒸发，删掉此行即整族回归）', file: 'js/personalize.js', needle: "'phone-bg', 'phone-bg-preset', 'phone-bg-solid', 'phone-bg-pos-x', 'phone-bg-pos-y', 'phone-bg-size'," },
  { name: '#527b 应用方案如实返回写入项数（返回 n 供导入方报「已导入 N 项」；改回无返回值＝又回到无条件报「已导入」的静默假成功）', file: 'js/personalize.js', needle: "localStorage.setItem('xy-home-v2:theme-mode', data['__theme__']); } catch (e) {} n++;" },
  { name: '#527c 方案用途标记（方案 JSON 无 __kind__ 时可把聊天美化粘进桌面导入框、命中 0 项仍报成功；删掉＝假成功复发）', file: 'js/personalize.js', needle: "const BEAUTY_KIND = 'mochi-desk-beauty';" },
  { name: '#527d 导入前先预检命中项数（命中 0 项即提前返回：不备份/不压撤销栈/不刷新，免generate垃圾备份；删掉＝零命中数据也生成「导入前备份」并刷新）', file: 'js/personalize.js', needle: 'if (!hit) {' },
  { name: '#527e 刷新前等大键 IDB 落盘（大键只进 IDB 且写日志不覆盖 >64KB 值、无 LS 兜底；直接 reload＝慢机上 4.5MB 壁纸刷新后丢，用户报「提示导入成功但壁纸没了」）', file: 'js/personalize.js', needle: 'const reloadAfterBeautyWrite = () => {' },
  { name: '#527f 撤销栈写入端改 per-cid（存全局根键＝在 A 桌面调完美化、切到 B 点撤销会把 A 的美化写到 B 桌面上，跨桌面串美化）', file: 'js/personalize.js', needle: "const setUndoStack = (st) => { try { store.set(UNDO_KEY, JSON.stringify(st)); } catch (e) {} };" },
  { name: '#527g 导入前自动备份读回校验（saveSchemesList 吞异常＋toast 报成功＝用户以为有安全网其实没有；删掉＝假报成功复发）', file: 'js/personalize.js', needle: 'if (saved) { backupName = name;' },
  { name: '#527h 导入前备份数量上限（每导入一次多存一份含 base64 壁纸的整份美化且无清理＝配额无限膨胀；删掉＝膨胀复发）', file: 'js/personalize.js', needle: 'if (autos.length >= 5) {' },
  { name: '#527i 分享链接剔除 base64 图片键并设长度上限（原实现把带 4.5MB 壁纸的整份美化塞进 URL hash 必被截断、解析失败还被 catch 吞掉＝静默发坏链接）', file: 'js/personalize.js', needle: 'const isBeautyImageKey = (k) => /^(phone-bg|page-bg-|card-bg-|desk-image-src-|phone-bg-item-)/.test(k);' },
  { name: '#527j 聊天美化导入补「导入前备份」安全网（此前直接覆盖、无备份无撤销；删掉＝聊天美化导入变回无安全网）', file: 'js/chat-settings.js', needle: 'const chatBackupBeforeImport = () => {' },
  { name: '#527k 聊天美化用途标记 + 命中计数（同桌面侧：无标记时跨用途 JSON 导入假报成功）', file: 'js/chat-settings.js', needle: "const CHAT_BEAUTY_KIND = 'mochi-chat-beauty';" },
  // 颜色行显示当前值（用户报「看不懂美化设置」的最大来源：非默认值时行右侧被写空字符串）
  { name: '#527l 美化页颜色行统一显示当前值+色块（原实现非默认值写空字符串＝选完颜色行里一片空白，看不出是否生效也看不出当前色；删掉 paintBeautyVal 即回归）', file: 'js/personalize.js', needle: 'function paintBeautyVal(el, color, defaultColor, defaultLabel) {' },
  { name: '#527m 边看边调改紧凑底部条（原为右侧 70vw 浮层＝手机 390px 宽挡住 70% 而桌面居中，用户几乎看不到效果；后 56vh 抽屉＋每行原生取色器仍有遮挡，真机反馈「还是没用，把全部基本遮挡完了」→ 44vh＋分区胶囊＋就地调色盘；2026-09-16 换锚：needle 不再钉高度数值——44vh 已被同批有意调至 40vh，第二次被调参弄断，锚收到固定底部条定位段）', file: 'js/personalize.js', needle: "d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:95;max-height:" },
  // 2026-09-16：needle 由 #587 会话收窄（跨域一行，理由见 WORKLOG）——原 needle `'#beauty-drawer'];"`
  // 要求抽屉是 FLOAT_SELECTORS 的**最后一个元素**，并行会话在组尾追加 `'#icon-fit-panel'` 后即失配，
  // 而修复本体（'#beauty-drawer' 在清单里、观察器按清单锁滚动）一直在＝误报。收窄为成员锚：删掉该成员
  // 即断，组尾再追加元素不再误伤。属主若需更严口径可再改这一行。
  { name: '#527n 边看边调底部抽屉登记进 FLOAT_SELECTORS（未登记＝抽屉打开后底层桌面仍可被滑动，未锁背景滚动）', file: 'js/mobile-adapt.js', needle: "'#beauty-drawer'" },
  // ==== 2026-09-15 #531 自定义字卡池分类修正（颜文字/符号卡占满文字池 → 联系人只发颜文字）====
  { name: '#531a 文字池可读性判定（含中文/假名/字母/数字才算可读句子；改坏/删掉＝符号池重新被当成有正文）', file: 'js/chat.js', needle: 'function chatHasReadableTextCard(arr) {' },
  { name: '#531b 自定义卡分类接线走新判定（emoji 补 BMP 符号区、颜文字补无括号形态；改回旧内联正则＝符号卡重新落进文字池）', file: 'js/chat.js', needle: 'if (chatIsEmojiCard(c)) emoji.push(c);' },
  { name: '#531c 主动消息按可用分类归一化权重（原固定累计阈值 15/25/40/55 在贴纸/图片池为空时把颜文字顶到 40%、emoji 15%＝用户「联系人连发颜文字」；改回固定阈值即回归）', file: 'js/chat.js', needle: '[pool.kaomoji.length ? 15 : 0, () => ({ text: pick(pool.kaomoji), type: \'text\' })]' },
  { name: '#531d 信件正文可读性判定（自定义文字池全是颜文字/符号时退回系统预设正文；改回 pool.text.length > 0＝信件又被符号占满）', file: 'js/mail.js', needle: "const hasCustom = pool.text.some(s => typeof s === 'string' && /[A-Za-z0-9\\u4e00-\\u9fff\\u3041-\\u3096\\u30a1-\\u30fa]/.test(s));" },
  // ==== 2026-09-15 #532 字卡使用状态自检（设置→工具 #row-card-audit）====
  { name: '#532a 一键修复批量执行器（删掉＝「一键修复系统预设可用」点了不生效，问题分类仍不可用）', file: 'js/card-audit.js', needle: "if (r !== false && r !== 'fail') n++; } } catch (e) {} });\ntry { if (window.dcfRefreshUI) DCF.forEach(function (d) { window.dcfRefreshUI(d[0]); }); } catch (e) {}\nreturn n > 0 ? true : false;" },
  { name: '#532b 字卡数据健康探针（删掉＝自检第九节「丢失图卡/超大图/坏语音」读数恒 0，坏卡查不出）', file: 'js/chatcard.js', needle: 'window.__ccAuditHealth = function () {' },
  { name: '#532c 大库未取回提示·「加载完整字卡」接线（删掉＝字卡未从 IDB 取回时用户无法手动取回，自检可用数一直偏少、不可信）', file: 'js/card-audit.js', needle: "window.hydrateLibScopes(['public', 'own'], function () { render(); toast('已取回完整字卡，重新自检完成'); });" },
  // ==== 2026-09-15 #533 链接导入的媒体字卡（裸 http(s) 图链）漏进文字池 → 联系人把图片 URL 当文字发出（聊天 + 信箱）====
  // 根因：图床不允许跨域时卡片按原始链接保存（存于字卡库【表情包/图片】分类），旧三道
  // 守卫只挡 data:/|||/@@m: 令牌，URL 形态被当文字卡抽中 → 气泡/信纸直出「http://…png」。
  // 各池（聊天 getPool / 信件 mailCardPool / 群聊 gcPool / 朋友圈 cardPool / 每日留言 /
  // 互动回应）统一补「URL 不进文字池」守卫；媒体池仍照常按 URL 渲 <img>（需联网）。
  { name: '#533a 聊天文字池排除 URL 媒体卡（删/改＝联系人重新把图链当文字发进聊天气泡。#943 起 getPool 四道守卫收成 chatHasMediaPayload 统一判据，锚点收到判据内部的「内联载荷或图片直链」这条必然存在表达式）', file: 'js/chat.js', needle: 'chatIsInlineDataSrc(s) || chatIsImageUrlCard(s);' },
  { name: '#533b 信件文字池排除 URL 媒体卡（删/改＝写信抽中图链、信纸正文直出 http 链接）', file: 'js/mail.js', needle: 'function mailTextOnly(c) {\nif (typeof c !== \'string\' || !c) return false;\nif (c.indexOf(\'data:\') === 0) return false;\nif (c.indexOf(\'|||\') >= 0) return false;\nif (c.indexOf(\'@@m:\') >= 0) return false;\nif (/^https?:\\/\\//i.test(c)) return false;' },
  { name: '#533c 群聊文字池排除 URL 媒体卡（删/改＝群成员把图链当文字发进群）', file: 'js/group-chat.js', needle: 'if (/^https?:\\/\\//i.test(c)) return; // 图链卡不进群聊文字池' },
  { name: '#533d 朋友圈文字池排除 URL 媒体卡（删/改＝TA 把图链拼进动态/评论正文）', file: 'js/feed.js', needle: 'if (/^https?:\\/\\//i.test(c)) return; // 图链卡不进朋友圈文字池' },
  { name: '#533e 每日留言文字池排除 URL 媒体卡（删/改＝留言正文直出图链）', file: 'js/calendar.js', needle: 'if (c.indexOf(\'@@m:\') >= 0) return false;\nif (/^https?:\\/\\//i.test(c)) return false;' },
  { name: '#533f 互动回应/文字题答案池排除 URL 媒体卡（删/改＝TA 的回应把图链当话术发出来）', file: 'js/ta-ask.js', needle: '!/^https?:\\/\\//i.test(s) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(s)) && s.trim());' },
  { name: '#533g 悬浮伴侣话术池排除 URL 媒体卡（删/改＝桌面悬浮伴侣把图链当台词说出来）', file: 'js/p2-features.js', needle: 's.indexOf(\'data:\') !== 0 && !/^https?:\\/\\//i.test(s) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(s))); // FIX 2026-09-13 #394 令牌卡不进悬浮伴侣话术；FIX 2026-09-15 #533 URL 媒体卡同款排除' },
  // ===== #534 朋友圈/信箱「内容类型开关」+ 存量图片直链消息自愈 =====
  // 现象（用户，iPhone 15 Safari 添加到桌面，明说其他机型也有）：①朋友圈与信箱把颜文字/
  // 表情包全禁了仍出现；②联系人发来的消息本该是图片，气泡里却是一整段图片直链。
  // 根因一（开关只管一半）：信箱 ml-*-en 只挡了 taLetterContent 的两处「附加」，
  //   pickDefaultMailCard 仍按分类占比把颜文字/emoji 注入正文；朋友圈压根没有
  //   类型开关，TA 评论/回复的颜文字/emoji 是写死 15% 概率。修法＝把开关下沉到
  //   池这一层（清池），任何消费方都取不到。
  // 根因二（图链当文字）：链接导入的字卡（裸 http(s) 图链）曾被当文字卡抽出并
  //   以 type:'text' 落库，气泡直出 URL。#533 堵住入库口，这里补渲染/归一化自愈。
  { name: '#534a 聊天图片直链识别只认「带图片扩展名的单条直链」（改成宽松判定＝普通网址被误当图片裂图）', file: 'js/chat.js', needle: 'return /^https?:\\/\\/[^\\s"\'<>]+\\.(?:png|jpe?g|gif|webp|bmp|avif|svg)(?:[?#][^\\s"\'<>]*)?$/i.test(s.trim());' },
  { name: '#534b 存量图片直链消息渲染自愈（删/改＝历史乱码消息又整段 URL 糊在气泡里。#943 起同一自愈口扩到整条内联图片载荷，判据收口 chatIsImgSrcLike、锚点随新写法）', file: 'js/chat.js', needle: 'const __imgSrc = !__blankMsg && chatIsImgSrcLike(__rawText)' },
  // 2026-09-16 跨会话同步：本锚点条件因 #624（多图消息不误判为单图直链）加了一道
  // `!hasMultiImgParts(r)` 守卫，修复逻辑仍在、只是表达式变长 ⇒ 同步 needle 到现实现。
  // 若 #624 侧另有改法，请以彼时实现为准再同步一次（勿直接删本条）。
  { name: '#534c 存量图片直链消息入库自愈补 type=image（删/改＝刷新后仍当文字消息，只靠渲染兜底。#943 起判定收口 chatIsImgSrcLike、锚点随新写法）', file: 'js/chat.js', needle: 'if (r && (r.type === \'text\' || !r.type) && !hasMultiImgParts(r)' },
  { name: '#534d 朋友圈内容类型开关下沉到池层（删/改＝关了颜文字，TA 评论/回复照样按写死 15% 发颜文字）', file: 'js/feed.js', needle: 'if (!feedTypeOn(cid, \'kaomoji\')) kaomoji.length = 0;' },
  { name: '#534e 信箱内容类型开关下沉到池层（删/改＝关了颜文字，系统预设补池仍按分类占比注入正文）', file: 'js/mail.js', needle: 'if (!tcfg.kaomojiEn) { kaomoji.length = 0; defKaomoji.length = 0; }' },
  { name: '#534f 信箱默认字卡注入权重同步受内容类型开关约束（删/改＝关掉的分类仍占抽签权重）', file: 'js/mail.js', needle: 'if (k === \'kaomoji\' && !mcfg.kaomojiEn) return 0;' },
  { name: '#534g 朋友圈内容类型开关默认键登记（删/改＝老用户键缺失回落默认=开关形同虚设）', file: 'js/reply-settings.js', needle: "'fd-kaomoji-en': 1, 'fd-emoji-en': 1, 'fd-sticker-en': 1, 'fd-image-en': 1," },
  { name: '#534h 朋友圈「内容类型开关」设置行锚点（删/改＝用户无入口关闭颜文字/表情包）', file: 'template.html', needle: 'id="fd-kaomoji-en"' },
  // ==== 2026-09-15 #538 iOS 上「信件 / 向他提问」输入框打字一直上弹 + 每字闪字（iPhone 17 Safari，
  //      用户明说其他设备型号也有、要求不要覆盖修改引发跨机型回归）——三条根因全部零机型分支，
  //      判据是「能力/结果」而非设备型号，故一台修好即全平台收敛；三条各自登记逻辑锚点 ====
  // ① 诊断输入轨迹遥测逐字同步写 localStorage（iOS WebKit 同步存储写阻塞主线程/合成提交，
  //    卡在输入法提交那一刻＝每字一闪）。锚点＝「事件里只入内存缓冲 + 节流落盘」这个表达式：
  //    退回 ringPush(直写) 或删掉节流即失配。
  { name: '#538a 输入轨迹遥测改节流落盘（退回逐字 localStorage.setItem＝iOS 每敲一字卡顿闪一下；安卓/桌面同源）', file: 'js/device.js', needle: 'arr = arr.concat(_inpBuf);' },
  { name: '#538b 输入轨迹节流定时器（删/改直写＝遥测回到输入热路径，「每字闪字」复发）', file: 'js/device.js', needle: 'if (!_inpFlushT) _inpFlushT = setTimeout(inpFlush, 400);' },
  { name: '#538c 诊断报告生成前先 flush 输入轨迹（删＝用户刚打完字就点诊断会看不到最后几条，诊断口径缩水）', file: 'js/device.js', needle: 'try { if (window.__diagInpFlush) window.__diagInpFlush(); } catch (eF) {}' },
  // ② 问问TA 半框「合成层刷新」本是安卓 ce-box 专用（安卓才把文本框转 contenteditable，
  //    半框平移时文字合成层停旧位）；实现无平台/能力判定，iOS 也照跑 → 对聚焦中的原生
  //    input 反复 toggle transform + void offsetHeight 整页 reflow＝「一直上弹 + 逐字闪」。
  //    锚点＝「无 __ceBox（非安卓 ce-box）就不做」这条判定，三处调用点各一。
  { name: '#538d 合成层补救只对 ce-box 生效·判定函数（删/改恒真＝iOS 原生输入框又被逐字 toggle transform+整页 reflow＝问问TA 输入框一直上弹/闪字）', file: 'js/chat.js', needle: 'function askBoxNeedsLayerFix(box) { try { return !!(box && box.__ceInp); } catch (e) { return false; } }' },
  { name: '#538e 合成层补救·无 ce-box 不装监听定时器（删＝iOS 空转 vv.resize 监听 + 160ms 防抖 reflow）', file: 'js/chat.js', needle: 'if (!askBoxes().some(({ box }) => askBoxNeedsLayerFix(box))) return;' },
  { name: '#538f 合成层补救·防抖回调内不再对原生输入框强制 reflow（删＝每字/每次 vv 抖动一次整页重排）', file: 'js/chat.js', needle: 'if (!askBoxNeedsLayerFix(box)) return; // #538：原生输入框不进整页 reflow' },
  // ③ nudgeInputVisible 几何记忆键含容器底边（可视视口相关量）——iOS 输入法候选条逐字显隐
  //    改可视高→键恒变→记忆恒失效→看门狗每 250ms 重写 scrollTop 把用户拉回「输入框可见」位
  //    ＝「无法拉到顶部停留」。锚点＝新的容器内部几何键 + 用户已滚过不补位。
  { name: '#538g 补位记忆键只留与可视视口无关的容器内容几何（含容器底边 sr.bottom 等视口量＝iOS 候选条逐字显隐键就变、记忆闸失效，看门狗每 tick 把用户滚动位拽回＝打一个字弹一下）', file: 'js/mobile-adapt.js', needle: "var geomKey = Math.round(sr.width) + 'x' + Math.round(scroller.scrollHeight);" },
  { name: '#538h 补位需「真键盘量级」视口变化 + 稳态早退（≥90px：真键盘 ≈200~300px 仍补位；iOS 候选条 ≈44px、工具条伸缩等小抖动忽略。删/改回无阈值判定＝#501 拽回与 #535 逐字上弹双双复发）', file: 'js/mobile-adapt.js', needle: 'if (scroller.__nudgeGeom === geomKey && Math.abs(vhNow - (scroller.__nudgeVH || vhNow)) < 90) return;' },
  // #536 单聊气泡样式/对比度自愈「作用域泄漏」到群聊（用户报「群聊里我发消息整个框变黑看不到字」，
  //   与 #107/#223/#252 同族第 N 次复发——单聊两处注入用全局 .msg-out/.msg-in 选择器，群聊页复用
  //   同一套类名却有自己的 --msg-* 变量，于是单聊配色会把群聊我的气泡写成黑字黑底）。
  //   锚点＝注入串里的页面作用域前缀，改回全局（去掉前缀）即失配。
  { name: '#536a 单聊自愈出站规则带 #page-chat 页面作用域（去掉前缀＝全局 .msg-out 又命中群聊＝群聊我的气泡黑底黑字看不见）', file: 'js/chat-settings.js', needle: "rules.push('#page-chat .msg-out .msg-bubble.msg-bubble,#page-fav .msg-out .msg-bubble.msg-bubble{color:'" },
  { name: '#536b 单聊自愈入站规则带 #page-chat 页面作用域（同上，去掉前缀＝群聊联系人气泡被单聊配色覆盖）', file: 'js/chat-settings.js', needle: "rules.push('#page-chat .msg-in .msg-bubble.msg-bubble,#page-fav .msg-in .msg-bubble.msg-bubble{color:'" },
  { name: '#536c 单聊自定义气泡 CSS 映射 scope 传 #page-chat（改回空串＝全局选择器，单聊上传的气泡模板套进群聊）', file: 'js/chat-settings.js', needle: "mochiMapBubbleCss(css, '#page-chat ')" },
  { name: '#536d 单聊自定义气泡 CSS 无 mochiMapBubbleCss 时的兜底分支同样带 #page-chat（漏前缀＝兜底路径又回全局）', file: 'js/chat-settings.js', needle: "out = '#page-chat .msg-out .msg-bubble{' + css + '!important;}' +" },
  // ==== 2026-09-15 #541 开屏期仍逐帧合成被完全盖住的桌面（「iPhone 各机型开屏滑动/停留总是卡」）====
  // 现象（用户，iPhone 15 Pro Max + Safari PWA；明说其他设备型号也有，要求不要覆盖修改引发跨机型回归）：
  //   开屏期间（每日首次强制展开全文，公告高 11000+px，必须滑到底才能进入）滑动/停留明显卡顿。
  // 根因（零机型分支，无头 WebKit 引擎实测，非主观）：开屏是 position:fixed / z-index:999 /
  //   background:var(--card-bg) 的整屏【不透明】层，视觉上完全盖住 .phone；但 WebKit 不按 z 序
  //   裁剪被盖住的层，仍逐帧合成其下的 .phone（14k 节点 + 壁纸层 + 三页合成层）。实测置 .phone
  //   为 visibility:hidden 后：开屏滚动帧耗时 mean 137→96ms、空闲 p90 122→78ms；同一环境等价
  //   平凡长列表稳定 60fps——即这笔开销是「被盖住仍在付费」，不是开屏自身内容成本。
  // 方案：纯 CSS 兄弟选择器（template 里 .splash 本就是 .phone 的前序同级兄弟）。clock.js hide()
  //   一加 .hide 本规则当帧失效、桌面立即恢复可见（淡出过程正常露出桌面）；开屏 400ms 后整体移除，
  //   不存在残留隐藏态。visibility 不参与布局，启动期对 .phone 的尺寸测量照常；全站无
  //   visibility:visible 覆写。零机型分支：任何内核都只是少画一层被完全盖住的内容。
  // 锚点＝这条选择器本身（删掉或改成无条件隐藏即失配）。needle 须与 minifyCss 产物逐字一致
  //   （build.mjs 的 minifyCss 只去注释/空行、不压空白，故保留原空格与分号）。
  { name: '#541 开屏期遮挡被盖住的桌面（删/改＝WebKit 又逐帧合成被不透明开屏完全盖住的 .phone＝开屏滑动卡顿复发）', file: 'css/base.css', needle: '.splash:not(.hide) ~ .phone { visibility:hidden; }' },
  // #546 房间夜间黑屏（vivo X200S+Edge 报障，用户明说其他机型也有；时段相关非机型相关）：
  // lum() 夜间基础亮度曾被写成 0，新档无点灯时 --room-bright=0 → .r-scene brightness(0) 纯黑。
  // 锚点＝基础亮度表达式本体（改回带 isNight 的 0 基或改小数即失配）
  { name: '#546 场景基础亮度恒 1（夜间从 0 起算＝没开灯进房 brightness(0) 纯黑）', file: 'js/room.js', needle: 'let v = 1;' },
  // 锚点＝CSS 兜底下限表达式（删掉 max() 兜底＝任何来源的 0 值又能把场景打成纯黑）
  { name: '#546 场景亮度 CSS 兜底下限 .45（--room-bright 为 0 也不许渲染成纯黑）', file: 'css/room.css', needle: 'brightness(max(var(--room-bright, 1), .45))' },
  // ==== 2026-09-15 #544 帮我决定/多人决定答案发到聊天被收件侧去重静默吞掉（红米 K80 Chrome 报「联系人发送的消息被吞了几条」，明说其他机型也有；纯时间窗判定零机型分支）：
  // 决策答案以 side:'in' 纯文本落聊天，快速重跑同一问题抽中同结果时同文撞进 addRec 收件侧 2500ms 文本窗被静默吞（in 侧无 toast＝用户零感知），
  // 且扫描只看最近 5 条时间差、第 1 条被吞后窗口不闭合＝连锁吞掉后续同文答案（「吞了几条」）。
  // 修复：chatAddIn 新 opts.dedupExempt 决定答案专用豁免——addRec 实时扫描跳过 + normCollapseRange 刷新归一化同口径豁免（#256 屏上所见即刷新后所见）；
  // TA 批次防同款去重与 out 侧 #437 反馈零改动。行为断言 tools/verify-decision-dedup-exempt.mjs（修前产物 RED 1/5＝症状复现） ====
  { name: '#544 addRec 实时去重豁免闸（删则决定答案快速重跑同文撞 2500ms 窗被静默吞＝「联系人消息被吞了几条」复发）', file: 'js/chat.js', needle: 'i >= Math.max(0, len - 5) && !rec.dedupExempt' },
  { name: '#544 刷新归一化豁免（normCollapseRange，删则刷新后带标记答案仍会被相邻合并回吞＝屏上所见≠刷新后所见）', file: 'js/chat.js', needle: 'if (a.dedupExempt || b.dedupExempt) continue; // FIX 2026-09-15 #544' },
  { name: '#544 帮我决定答案带豁免标记发送（删则决策结果重新裸奔进去重窗＝吞答案复发）', file: 'js/decision.js', needle: '{ enter: true, silent: true, follow: true, dedupExempt: true, nightAllow: true }); // FIX 2026-09-15 #492 帮我决定结果' },
  { name: '#544 多人决定答案带豁免标记发送（删则决策结果重新裸奔进去重窗＝吞答案复发）', file: 'js/group-decision.js', needle: '{ enter: true, silent: true, follow: true, dedupExempt: true, nightAllow: true }); // FIX 2026-09-15 #492 多人决定结果' },
  // ==== 2026-09-16 #547 表情包面板「每次打开都重新加载」复发 + 拍卖会页面显示不全（小米15Pro Chrome 等多机型同发，用户明说其他设备型号也有）：
  // ①表情面板：#457 内容指纹短路被「令牌化翻转」废掉——池视图卡被 ccTokenizeGiantMedia 异步令牌化
  //  （dataURL→@@m:token）后原文变了、显示没变，按原文签名误判内容变化→整面板 innerHTML 重建+全部图
  //  走媒体池重新解析＝每次开面板都重载一遍；大库令牌化 pass 跑数秒，期间每次开面板都撞上。
  //  修法=签名改走令牌稳定身份（chatcard.js ccTokMemoRev/ccMediaCardIdent：原始大图卡与令牌卡同一短指纹）。
  // ②我的表情包：openEmojiPanel 每次无条件 reloadMyEmojiFromIdb——大库（18MB 级、IDB-only）每开一次
  //  面板白付一次 idbGet+JSON.parse＝「每次打开都像在加载」。修法=__myeIdbApplied 且内存非空即跳过。
  // ③拍卖会：成交/TA拍得/流拍/扣款失败/本场结算浮层弹在 .au-stage（高=拍品卡 ~160px）内，
  //  .pong-overlay overflow:hidden+居中＝内容超高被上下双端裁剪且无法滚动（#381 只转了背包/记录）。
  //  修法=装得下照旧居中，装不下 safe center（顶对齐）+浮层自身可滚；#au-intro/#au-help 全屏层同族兜底。
  // 行为断言 tools/verify-emoji-panel-reopen.mjs + tools/verify-auction-overlay-fit.mjs ====
  { name: '#547a 表情面板签名走令牌稳定身份（删/改回原文签名＝池视图令牌化翻转后签名失配、每次开面板全量重建 img＝图片每次重载复发）', file: 'js/chat.js', needle: "var _ident = (typeof window.ccMediaCardIdent === 'function') ? window.ccMediaCardIdent : null;" },
  { name: '#547b 令牌→短指纹反查登记（删则 memo 预算淘汰后令牌卡身份回退原文截断＝签名翻转重建复发）', file: 'js/chatcard.js', needle: 'ccTokMemoRev.set(tok, ccMediaFrag(j.body));' },
  { name: '#547c 我的表情包开门闸（删＝18MB 级库每次开面板 idbGet+JSON.parse 白付一遍＝「每次打开都像在加载」复发）', file: 'js/chat.js', needle: 'if (window.__myeIdbApplied === true && Array.isArray(myGroups) && myGroups.length) return;' },
  { name: '#547d 拍卖结果浮层防双端裁剪（删则内容超高被 overflow:hidden 居中裁剪＝拍卖会页面显示不全复发）', file: 'css/chat-pages.css', needle: '#au-overlay:not(.au-ov-fs) { overflow-y:auto; justify-content:center; justify-content:safe center; }' },
  { name: '#547e 拍卖全屏教学/玩法层同族防裁剪（删则横屏矮视口/大字体下开场教学按钮被裁）', file: 'css/chat-pages.css', needle: '#au-intro, #au-help { overflow-y:auto; justify-content:center; justify-content:safe center; }' },
  { name: '#547f 落池竞态不标缺失（删则面板渲染先于 flush 读池未中→令牌被标 missing→贴纸被剔出面板变少/消失+签名数量骤变重建＝每次打开重载复发；行为断言 verify-emoji-panel-reopen B 组）', file: 'js/media-pool.js', needle: 'if (writeBuf[wi] && writeBuf[wi].k === FULL + h) { pending = true; break; }' },
  // ===== 2026-09-16 小游戏细节优化批次（#548，行为断言 tools/verify-arcade-games-detail.mjs 72 项） =====
  { name: '#548a 游乐室幸运池补钓鱼/合作扫雷/打砖块（删则三款游戏幸运日×2/打卡/聚合继续缺席）', file: 'js/arcade.js', needle: "{ k: 'fishing', name: '双人钓鱼' }, { k: 'ms', name: '合作扫雷' }, { k: 'brick', name: '双人打砖块' }" },
  { name: '#548b 贪吃蛇战绩键改读 snake-score（改回 snake-stats＝「游戏体验官」徽章永远统计不到贪吃蛇复发）', file: 'js/arcade.js', needle: "snake: 'snake-score'" },
  { name: '#548c 贪吃蛇 rAF dt 钳 250ms（删则切后台回来蛇数十倍速狂奔到撞死复发）', file: 'js/snake-game.js', needle: 'Math.min(now - lastFrameTime, 250)' },
  { name: '#548d 贪吃蛇切后台自动暂停+存档（删则 iOS 后台杀页面丢进行中对局复发）', file: 'js/snake-game.js', needle: "document.hidden && state && state.status === 'playing') { saveGame(); togglePause(); }" },
  { name: '#548e Pong rAF dt 钳 250ms（删则切后台回来球快进自动打完整局复发）', file: 'js/pong.js', needle: 'const dt = Math.min(ts - lastTs, 250);' },
  { name: '#548f Pong 输局发平局档（改回与胜局同额＝输赢奖励无差别+与注释口径不符复发）', file: 'js/pong.js', needle: '(playerWin ? pongWinFen : 520)' },
  { name: '#548g 打砖块跨刷新存档键（删则中途退出/刷新丢整局、三球类口径不齐复发）', file: 'js/breakout.js', needle: "':brick-saved'" },
  { name: '#548h 打砖块 serve/clearing 回场缓冲（删则后台回场 serveAt 已到点秒发球无准备复发）', file: 'js/breakout.js', needle: "if (state && !paused && running && (state.status === 'serve' || state.status === 'clearing')) {" },
  { name: '#548i 记忆翻牌先记账后发钱、写失败不发（删则配额异常封顶计数丢失反复领满复发）', file: 'js/memory-game.js', needle: "try { localStorage.setItem(storeKey('memory-coin-day'), JSON.stringify(daily)); } catch (e) { return 0; }" },
  { name: '#548j 记忆翻牌幸运日×2（删则幸运横幅推荐但×2 永不生效复发）', file: 'js/memory-game.js', needle: 'grantCoins(totalYuan * memMult)' },
  { name: '#548k 四子棋落子动画回调不在面板隐藏时补调度（删则关面板 TA 隐形下完一子复发）', file: 'js/connect-four.js', needle: 'if (!panel.hidden) scheduleTaMove(' },
  { name: '#548l 合作扫雷幸运日×2（删则 ms 不在游乐室体系复发）', file: 'js/coop-mine.js', needle: 'grantCoin((base + flawless) * msMult)' },
  { name: '#548m 钓鱼 ¥104 日封顶（删则深渊王 ¥200/条无限刷、与其他游戏口径不齐复发）', file: 'js/fishing.js', needle: "writeJSON('fishing-coin-day', { date: todayKey(), used: used + real });" },
  { name: '#548n 钓鱼结算文案 keep 保留 2.5s（删则收竿/跑鱼提示被 render 同帧清空＝用户看不到复发）', file: 'js/fishing.js', needle: 'statusEl._keepT = setTimeout(' },
  { name: '#548o 小游戏发奖日封顶键本地日期（改回 toISOString＝北京时间 0-8 点奖励记到前一天复发；rps/snake 走此函数）', file: 'js/chat.js', needle: "const k = 'ml2_coin_' + gameKey + '_' + rpLocalDay();" },
  { name: '#548p 贪吃蛇奖励接幸运日×2（删则 lucky 日 snake 奖励不翻倍复发）', file: 'js/chat.js', needle: "const snkMult = (window.arcadeMult && window.arcadeMult('snake')) || 1;" },
  { name: '#548q 拍卖落槌扣款-入库原子性（删则 persist 写失败时钱扣了收藏没进复发）', file: 'js/auction.js', needle: 'if (!persist(bagKey(), bag) || !persist(statsKey(), s)) {' },
  { name: '#548r 拍卖 hammer 防二次扣款守卫（删则确认弹窗期间 TA 折价自动落槌后用户再确认＝双扣复发）', file: 'js/auction.js', needle: "if (!st || st.phase !== 'bidding') return;" },
  { name: '#548s 连连看结算展示实际入账（删则王者/传奇档标称 ¥131.4/¥334.4 超封顶被静默削＝虚标复发）', file: 'js/linkup.js', needle: 'var nominal = Math.round(DIFFS[st.diff].coin * mult);' },
  { name: '#548t 五子棋换联系人清 st（删则 A 桌面棋局在 B 桌面命名空间打完、战绩串档复发）', file: 'js/gomoku.js', needle: 'st = null; /* #548t */' },
  { name: '#548u 消消乐换联系人清 st（同 #548t 族）', file: 'js/match3.js', needle: 'st = null; /* #548u */' },
  { name: '#548v 连连看换联系人清 st（同 #548t 族）', file: 'js/linkup.js', needle: 'st = null; /* #548v */' },
  // ==== 2026-09-16 #549 新手引导 / 设置搜索直达功能大全 / 字卡库空状态可点 ====
  { name: '#549a 新手引导弹层入口（删则窗口函数消失、设置行点了没反应）', file: 'js/onboarding.js', needle: 'window.openMochiGuide = function () { build(); mask.hidden = false; };' },
  { name: '#549b 设置搜索直达功能大全跳转行（删则搜索只能筛设置行）', file: 'js/personalize.js', needle: "jumpBtn.textContent = '在「功能大全」中搜索“' + inp.value.trim() + '” →';" },
  { name: '#549c 功能大全带入关键词入口（删则设置搜索点了跳不过去）', file: 'js/feature-hub.js', needle: "window.mochiFeatureHubOpen = function (kw) { openHub('setting', kw); };" },
  { name: '#549d 字卡库空状态可点（删则空列表退回死胡同、只剩一句提示）', file: 'js/chatcard.js', needle: 'if (list && !list.__ccEmptyActBound) {' },
  // ==== 2026-09-16 #577 昵称分「桌面 / 聊天」两套（用户反馈：引导没说清两者独立、需各自设置） ====
  // 纯文案修复，needle 就是需求本身：这段说明被删/被改回「点桌面顶部改名」即回归。
  { name: '#577a 引导写明桌面 / 聊天昵称是两套且不同步（删则又只剩「点桌面改名」，聊天里显示默认「我」「TA」无人解释）', file: 'js/onboarding.js', needle: '两套、互不同步' },
  { name: '#577b 引导步骤内补充提示块（删则 warn 文案不再渲染＝回到只有一句 d）', file: 'js/onboarding.js', needle: 's.warn ? ' },
  { name: '#577c 功能介绍·快速开始写明聊天昵称要单独设（删则又只说「设置双方昵称、头像」）', file: 'template.html', needle: '聊天里显示的名字 / 头像与它<b>互相独立、不会同步</b>' },
  { name: '#577d 聊天设置「昵称与头像」标题标注聊天专用（删则设置页不提与桌面独立，用户仍以为改桌面即生效）', file: 'template.html', needle: '昵称与头像（聊天专用 · 与桌面各自独立，互不同步）' },
  { name: '#577e 功能大全昵称条目关键词补「桌面昵称 / 不同步」（删则搜「桌面昵称」找不到这两条）', file: 'js/feature-hub.js', needle: '昵称 名字 联系人 改名 聊天昵称 桌面昵称 不同步 不一样 没变 显示 TA' },
  // ---- #577b 用户追加（2026-09-16）：「聊天里的更换头像，你没说可以直接在聊天设置里更换，
  //      或在聊天输入栏左边打开更多功能里的【头像互动】上传头像库可互动」——漏了头像互动这条换聊天头像的路 ----
  // #616（2026-09-16）：「头像互动」整块改名「头像和昵称互动」后，这三条 needle 里的旧名
  //   在 src 里已不存在（同步改成新文案的锚点，哨兵意图不变：这条快路还在、还写得出入口名）
  { name: '#577f 引导写明「更多功能 → 头像和昵称互动」换聊天头像/昵称快路（删则只剩聊天设置一条路，这个入口没人知道）', file: 'js/onboarding.js', needle: '聊天头像和聊天昵称另有一条快路' },
  { name: '#577g 引导 tip 提示块渲染分支（删则 tip 文案不再渲染）', file: 'js/onboarding.js', needle: 's.tip ? ' },
  { name: '#577h 功能介绍·快速开始补头像和昵称互动路径（删则又只剩「聊天设置 → 形象」一条）', file: 'template.html', needle: '头像和昵称互动</b>——头像侧可上传多张头像库' },
  { name: '#577i 功能大全「头像和昵称互动」条目说明与关键词（删则搜「头像库 / 随机换头像 / 昵称库」找不到）', file: 'js/feature-hub.js', needle: '换聊天头像和聊天昵称：头像可上传多张头像库点图即换' },
  // ==== 2026-09-16 #550 设置页搜索精准化（跨域登记：personalize.js 归 AI-B 本会话占用，见 WORKLOG） ====
  { name: '#550a 设置搜索取词剔除「功能说明」.tag 胶囊（删则搜功能/说明几乎全行命中回流）', file: 'js/personalize.js', needle: "c.querySelectorAll('.tag').forEach(x => x.remove());" },
  { name: '#550b 设置搜索口语词别名表（删则搜壁纸/通知/概率/夜间等 0 命中回流）', file: 'js/personalize.js', needle: "'深色模式': '夜间模式 暗色模式 黑暗模式 夜间 暗色 黑暗 黑色 主题 dark mode'" },
  { name: '#550c 设置搜索零命中空态提示（删则搜不到时页面静默无反馈）', file: 'js/personalize.js', needle: 'emptyTip.hidden = hits > 0;' },
  // ==== 2026-09-16 #551 清除本地数据清不空（红米 K70 Chrome 及多机型复发，#353 同族第二次） ====
  { name: '#551a 清除范围=全部 xy-home-v2 键（退回只清 activePrefix 则其他桌面/公用数据残留＝清不空复发）', file: 'js/personalize.js', needle: 'const wipeAppKeys = function () {' },
  { name: '#551b reload 前补刀全量 wipe（删则清窗口期内未挂屏障模块重写的键活过重置）', file: 'js/personalize.js', needle: 'idbDone.then(() => { wipeAppKeys(); try { location.reload(); } catch (e) {} });' },
  // ==== 2026-09-16 #552 设备兼容诊断报版本偏离量（用户直接指派；device.js 归 AI-B 域，见 WORKLOG） ====
  { name: '#552a 诊断「不一致」带落后量化（删则只说旧版不说差多少，开发者拿两个 ts 手算回流）', file: 'js/device.js', needle: "落后最新版' + devStr(r.ts - localTs)" },
  // ==== 2026-09-16 #559 经期预警按「语境 × 经期规律」分级：经前/推迟不再发经期中口吻；不规律者不说「推迟」改间隔口吻 ====
  { name: '#559a 经前预警 {d} 替换为距预测经期天数（删则经前预警不带日期参数）', file: 'js/period.js', needle: "String(line).replace(/\\{d\\}/g, String(diffDays(today, st.nextStart)));" },
  { name: '#559b 推迟预警 {d} 替换为已推迟天数（删则推迟预警不带日期参数）', file: 'js/period.js', needle: "String(line).replace(/\\{d\\}/g, String(delayDays));" },
  { name: '#559c 标签按语境区分（删则经前预警日又以「经期关心」标签发经期中口吻语料＝症状回流）', file: 'js/period.js', needle: "{ tag: kind === 'in' ? '经期关心' : '经期预警', nightAllow: true }" },
  { name: '#559d 经前预警语料分组（删则经前预警日无专属预警语、字卡库缺该组）', file: 'js/default-cards-data.js', needle: '["经前预警", [' },
  { name: '#559e 规律分级判据（删则不规律用户也被当「预测可信」按推迟口径轰炸＝「太扯淡」回流）', file: 'js/period.js', needle: "if (s.n >= 3 && s.cv < 0.2) return 'rule';" },
  { name: '#559f 规律型推迟门 ≥5 天（删则规律用户推迟无预警）', file: 'js/period.js', needle: "if (tier === 'rule' && delayDays >= 5)" },
  { name: '#559g 不规律型改间隔口吻且 ≥10 天才提（删则对不规律用户说「推迟 N 天」＝预测误差比推迟还大）', file: 'js/period.js', needle: "else if (tier === 'free' && delayDays >= 10)" },
  { name: '#559h 经期推迟·不规律语料组（删则不规律推迟回落确定性口吻语料）', file: 'js/default-cards-data.js', needle: '["经期推迟·不规律", [' },
  { name: '#559i 深夜静默 23:00–06:00（删则半夜聊天 TA 会发经期预警把人叫醒；静默期不写 fired 故不吞当天名额）', file: 'js/period.js', needle: 'if (_h >= 23 || _h < 6) return; // #559 深夜静默（23:00–06:00 不发、不写 fired）' },
  // ==== 2026-09-16 #554（TASKS #128）字卡媒体令牌化持久化：库键内联图 → 池令牌（同图全库只存一份）====
  // 消费链路此前已就绪（#142 池/#377 内存令牌化/#506 GC 引用面+导出自包含/#532 自检令牌感知），
  // 本批补「存储键瘦身」两个写入口 + 用户入口；删除任一条即回归「同一张贴图存多份/体积回涨」。
  { name: '#554a 上传口令牌化（删/改＝新上传字卡图又整份内联进库键，44MB 级体积回涨复发）', file: 'js/chatcard.js', needle: "if (cur !== 'voice' && window.mochiMediaTokenize && typeof data === 'string' && data.length >= CC_CC_TOK_MIN) {" },
  { name: '#554b 迁移保险丝「不变小不写」（删/改＝异常场景可能把库写大/写坏）', file: 'js/chatcard.js', needle: 'if (!replaced || outStr.length >= raw.length) continue;' },
  { name: '#554c 迁移入口 mochiCcPersistTokenize（删＝查看存储「字卡图去重入库」永远提示不支持，存量内联图永不能瘦身）', file: 'js/chatcard.js', needle: 'window.mochiCcPersistTokenize = function (prog) {' },
  { name: '#554d 查看存储「字卡图去重入库」入口行（删＝用户无入口触发库键瘦身）', file: 'template.html', needle: 'id="st-cc-tokbtn"' },
  // ==== 2026-09-16 #632 超大库「添加卡即 iOS 闪退」自动瘦身门（打开字卡库按存储键体积自动
  // 检测，在 parse 编辑树【之前】运行 #554 迁移缩库；用户明说其他设备型号同发、要求勿引发
  // 跨机型回归，故判据只用「存储键字节」零机型分支）。任一删除/移位＝199MB 级库编辑树常驻 +
  // 添加时整库 JSON.stringify 三份叠加 → iOS WebKit jetsam（添加表情包/字卡闪退）症状回流。====
  { name: '#632a 超大库阈值+检测（改/删＝打开字卡库不再自动瘦身，199MB 库添加卡闪退复发）', file: 'js/chatcard.js', needle: 'const CC_BIG_SLIM_THRESHOLD = 16 * 1024 * 1024;' },
  { name: '#632b 瘦身门在 hydrate/loadGroups 之前（删/挪后＝先 parse 199MB 编辑树再瘦身，峰值更高）', file: 'js/chatcard.js', needle: 'maybeAutoSlimLib().then(function () {' },
  { name: '#632c 迁移单遍扫描（改回先收集全部 URL＝199MB 库迁移自身即 OOM，瘦身永远失败）', file: 'js/chatcard.js', needle: 'const seenTok = new Set();' },
  // ==== 2026-09-16 #560 字卡库瘦身整组删除写进双冒号垃圾键（#554 插桩时发现的存量 bug）====
  // storage-slim 的 libs 用 G='xy-home-v2:'（带尾冒号），mochiCcSlimDeleteGroup 里
  // xyStore(prefix).set 内部再拼 '':'+key ＝ 写出 xy-home-v2::cc-groups-public——真实键从未被改，
  // 删除报成功、刷新后分组复活（#170 上线以来的存量缺陷）。修＝剥尾冒号再进 xyStore。
  { name: '#560 瘦身删除剥 prefix 尾冒号（删/改回直拼＝删除又写 xy-home-v2:: 垃圾键、分组删除刷新即复活）', file: 'js/storage-slim.js', needle: "const pStore = String(prefix).replace(/:$/, '');" },
  // ==== 2026-09-16 #555 安卓平板判定（device.js 只认 iPad/Macintosh 触摸屏，安卓平板
  // 竖屏被当手机全屏拉宽、横屏掉进桌面 390px 外壳；用户指派「没做平板适配」）====
  { name: '#555 安卓平板判定（删/改＝安卓平板回到手机拉宽/390px 外壳双症状）', file: 'js/device.js', needle: '!/Mobile/i.test(ua) && Math.min(_tw, _th) >= 600' },
  // ==== 2026-09-16 #570 开屏新版检测（用户指派「独立的新版检测放开屏，显示现在是不是新版」；
  // 新文件 ver-check.js + pwa.js 暴露预取刷新链 + template/base.css 锚点样式；#550~#560 区段已被并行批次占用故跳取 #570） ====
  { name: '#570a 开屏检测行有新版分支（删则开屏永远不出「是不是新版」结论行，功能静默消失）', file: 'js/ver-check.js', needle: "set('stale', '⇩ 有新版本（落后' + gapStr(ts - localTs) + '）· 点此更新', true);" },
  { name: '#570b pwa 预取刷新链暴露给开屏（删则「点此更新」退回裸 reload＝弱网/iOS 刷完仍旧版）', file: 'js/pwa.js', needle: 'window.mochiRefreshNow = function () { refreshNow(); };' },
  { name: '#570c 开屏检测行静态锚点（删则 ver-check.js 找不到挂载点直接 return＝功能消失）', file: 'template.html', needle: 'id="splash-ver-check"' },
  // ==== 2026-09-16 #629 开屏「刷了还是旧版」指引（用户反馈「无线网和流量都正常、多次刷新仍是
  // 旧版」；同族 #157/#273/#570。锚点取「已刷过却仍旧版」的判定表达式——它被删/被短路即整条
  // 指引消失、开屏只剩「点此更新」，用户又开始连点） ====
  { name: '#629a 开屏「已刷过却仍旧版」判定（删/短路＝指引不出现，用户继续连点刷新＝真因被掩盖）', file: 'js/ver-check.js', needle: 'if (retryMarked() || isReloadEntry()) {' },
  // 同批：标记键是全局根键，漏登记 EXCLUDE 会被 migrateLegacy 每次刷新迁进 default 并删根键
  // （同 #231 的 ver-update-ack-ts/ver-update-notify）。实测写入后 navigate 2.2s 读回即 null。
  { name: '#629b 标记根键登记 EXCLUDE（删＝标记写一次就没，开屏永远只出「点此更新」）', file: 'js/contacts.js', needle: "'ver-retry'" },
  // ==== 2026-09-16 #557 字卡库搜索精准化（跨域登记：chatcard.js 属 AI-A 业务，用户直派修「搜一个字多几个字全出现」，见 WORKLOG） ====
  { name: '#557a 字卡库搜索精确/开头/包含排序分节（删/换回私有实现＝与全站搜索语义漂移）', file: 'js/chatcard.js', needle: 'r.__rank = ms ? ms.rank(r.t, kw) : 2;' },
  { name: '#557b 字卡库多词搜索最长词为锚调注册方（删则多词整串当单词条恒 0 命中回流）', file: 'js/chatcard.js', needle: 'const anchor = ms ? ms.anchor(terms) : terms[0];' },
  { name: '#557c 字卡库多词中心 AND 复筛（删则锚词候选不筛其余词＝多词退化单词）', file: 'js/chatcard.js', needle: 'terms.every(function (w) { return t.indexOf(w) >= 0; })' },
  // ==== 2026-09-16 #558 表情面板「最近使用」（AI-A chat.js 单文件 + contacts.js 一行免迁；
  // 用户从清单点选小功能；#556 开屏检测/#557 字卡库搜索已被并行批次占用故顺延） ====
  { name: '#558a 最近使用点击记录（删/改＝点过的表情不再进「⏱最近使用」，功能静默失效）', file: 'js/chat.js', needle: "try { emojiRecordRecent(src); } catch (e0) {} // #558 最近使用：点击即记录（发送/插入都算）" },
  { name: '#558b 最近使用身份回查三池（删＝最近区永远空/显示死项，身份跨令牌化翻转失效）', file: 'js/chat.js', needle: 'function emojiRecentResolved() {' },
  { name: '#558c 最近分组渲染入口行（删＝面板分组条永远不出现「⏱最近使用」chip）', file: 'js/chat.js', needle: "[['__recent__', '⏱最近使用']]" },
  { name: '#558d emoji-recent 全局根键免迁（删＝每次刷新被 migrateLegacy 迁进 default 删根键，最近区非 default 桌面清空）', file: 'js/contacts.js', needle: "'emoji-recent'," },
  // ==== 2026-09-16 #560 全新浏览器冷启动桌面第三页顺序竞态（AI-B personalize.js 单函数；
  // 用户报「新浏览器打开第三页图标在上小组件在下，反了」，多机型随机复现；#556~#559 已被占用故顺延） ====
  { name: '#560a 无布局恢复按快照分页归位（删/改回逐个 appendChild＝池内小组件排到已在位 p3apps 后，第三页图标在上组件在下）', file: 'js/personalize.js', needle: '(byPage[it.page] = byPage[it.page] || []).push(it.wid);' },
  { name: '#560b 已在位且相对顺序与快照一致则整体跳过（删＝每次切桌面/回填重排抖动；改成恒重排＝破坏 #405 尊重用户摆放语义）', file: 'js/personalize.js', needle: 'return i === 0 || idx > Array.prototype.indexOf.call(slide.children, nodes[i - 1]);' },
  { name: '#560c 归位按快照原序依次插入（删则归位顺序退化为任意）', file: 'js/personalize.js', needle: 'if (addBtn) slide.insertBefore(n, addBtn); else slide.appendChild(n);' },
  // ==== 2026-09-16 #571 字卡回复延迟遥测（AI-A chat.js 单文件；用户报「字卡延迟反应卡顿5、6秒/3、4秒」
  // （iPhone 14 Pro Safari 等多 iOS 机型）——现场诊断 63fps/无长任务/字卡库 11KB，等待来自「回复速度」
  // 设定随机（默认 1~40 秒）；把设定值+实测落地耗时打进诊断，报障时区分「设定即此」与「真卡顿」） ====
  { name: '#571a 回复链起点遥测（删则诊断缺「回复实测」判据，报障无法区分设定延迟与处理卡顿）', file: 'js/chat.js', needle: 'window.__replyWaitT0 = Date.now();' },
  { name: '#571b 实测落地耗时记录（删/改＝回复实测永远无记录）', file: 'js/chat.js', needle: 'window.__replyLatLog.push(__ms);' },
  { name: '#571c 诊断输出设定值+实测（删则回复时间/回复实测两行消失，现场回盲）', file: 'js/chat.js', needle: "'回复实测=' +" },
  // ==== 2026-09-16 #562 桌面美化三修（AI-B personalize.js + 跨域 home.css/dark.css；用户报
  // 「边看边调又不是半透明的页面、还是会遮挡其他东西看不见；点主题色没有任何变化；桌面美化的
  // 所有颜色没有恢复默认颜色的按钮」。#559~#561 已被占用故顺延） ====
  { name: '#562a 主题色驱动桌面按钮默认色（home.css --widget-btn 回落 var(--btn-bg)；改回写死 #111111＝在边看边调里点主题色桌面纹丝不动复发）', file: 'css/home.css', needle: '--widget-btn:var(--btn-bg,#111111);' },
  { name: '#562b 深色不再截断主题色链（删 dark.css 里写死的 --widget-btn 默认；加回＝深色下点主题色桌面按钮不跟随）', file: 'css/dark.css', needle: '--widget-btn:#f0f0f0', absent: true },
  { name: '#562c 边看边调面板半透明（删/改回纯色＝又整块挡住桌面「遮挡其他东西看不见」复发；color-mix 不支持的老内核自动回落上一句纯色）', file: 'js/personalize.js', needle: 'background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);' },
  { name: '#562d 美化页每个颜色行注入可见「默认」恢复按钮（删＝只剩弹窗里隐藏的恢复默认 pill，用户报「没有恢复默认颜色的按钮」复发）', file: 'js/personalize.js', needle: "row.querySelector('.bfy-reset-btn')" },
  { name: '#562e 按钮颜色/文字颜色恢复默认改摘内联变量（回落到主题色链；改回写死 #111111/#ffffff＝内联截断主题色链）', file: 'js/personalize.js', needle: "removeProperty('--widget-btn'); paintBeautyVal(widgetBtnVal" },
  { name: '#562f 主题色走设置页同一 applier（同时写 --btn-bg/--btn-ink；删 onSet 分支＝边看边调点主题色只改底色不改文字色）', file: 'js/personalize.js', needle: 'if (onSet) { try { onSet(v); } catch (e) {} paint(); return; }' },
  // ==== 2026-09-18 边看边调抽屉内部优化（P0 背景分区死变量致实时预览失效 / P1 拖动逐帧写库掉帧 / P2 抽屉改动进不了撤销） ====
  { name: '#bty-a 边看边调「背景模糊」复用 applyBgBlur（旧写死 --bg-blur 无人消费＝抽屉里拖模糊桌面当场没反应、刷新才变；改回 setProperty(\"--bg-blur\") 即回流）', file: 'js/personalize.js', needle: 'applyBgBlur(parseInt(v, 10))' },
  { name: '#bty-b 边看边调「背景遮罩」复用 applyBgMaskOp（旧写死 --bg-mask-op 无人消费＝同上实时失效）', file: 'js/personalize.js', needle: 'applyBgMaskOp(parseInt(v, 10))' },
  { name: '#bty-c 滑杆落库挪到 change（旧实现 input 里同步 store.set＝拖动每帧写 localStorage 掉帧；删此行＝退回逐帧写库）', file: 'js/personalize.js', needle: "inp.addEventListener('change', () => { doPersist(inp.value); });" },
  { name: '#bty-d 边看边调首次改动压撤销快照（旧抽屉全程不 pushBeautyUndo＝乱调无从撤销；删 armUndo 定义＝撤销断链复发）', file: 'js/personalize.js', needle: 'const armUndo = () => { if (undoArmed) return;' },
  // ==== 2026-09-16 #572 页面内「先做这个」提示（AI-A 新模块 page-coach.js + feature-hub 只读查询
  // + 三页空状态动作；用户问「复杂页面里不知道先点哪儿」；#553~#562/#570/#571 已被并行批次占用故取 #572） ====
  { name: '#572a 页面提示条插入（删/改＝复杂页首访不再自述「先做这个」，用户回到站在页里发懵）', file: 'js/page-coach.js', needle: 'page.insertBefore(buildBar(cfg), page.firstChild);' },
  { name: '#572b 提示文案与跳转取自功能大全目录表（删＝页面提示与功能大全分叉成两套说明，功能入口变了提示不跟）', file: 'js/feature-hub.js', needle: 'window.mochiHubItemsFor = function (sels) {' },
  { name: '#572c 已看页标记（删＝每进一次都弹同一提示＝骚扰）', file: 'js/page-coach.js', needle: 'const MARK = G + \'__coach-seen\';' },
  { name: '#572d __coach-seen 全局根键免迁（删＝每次刷新被 migrateLegacy 迁进 default 删根键，提示反复弹）', file: 'js/contacts.js', needle: "'__coach-seen'," },
  { name: '#572e 备忘空状态补动作（删＝「还没有备忘」又只剩陈述、没有下一步可点）', file: 'js/memo-app.js', needle: 'id="memo-empty-add"' },
  // #575 删除型（用户 2026-09-16 反馈「删掉，这是错的」）：开屏静态「新手上路 · 3 步就能用」卡
  // 整块撤除，复活即回归——开屏只留公告/必读摘要，新手引导走 onboarding.js 弹层（可跳转、可重看）。
  { name: '#575 开屏静态「新手上路 3 步」卡不得复活（DOM 在 template.html；加回＝用户点名删掉的开屏引导卡又出现）', file: 'template.html', needle: 'splash-onboard-t', absent: true },
  { name: '#575 开屏静态「新手上路 3 步」卡样式不得复活（css/base.css 的 .splash-onboard 规则块；加回＝撤除的卡在产物里复活）', file: 'css/base.css', needle: '.splash-onboard {', absent: true },
  // ==== 2026-09-16 #573 全站搜索统一精准化批（设置搜索词库数据驱动+拼音首字母 / 字卡库+自定义字卡页+功能大全
  // 同款 AND+排序 / 标点归一 / 公共 mochiSearch 工具收敛；用户指派「有能优化的吗→不会卡就帮我做」） ====
  { name: '#573a 公共搜索工具 mochiSearch（删则三处搜索退回各自私有实现，语义漂移复发）', file: 'js/device.js', needle: 'window.mochiSearch = {' },
  { name: '#573b 设置说明文案暴露给搜索（删则壁纸/备份/总入口等说明词搜不到，别名表退化回手工养）', file: 'js/settings-help.js', needle: 'window.__settingsHelpDesc = MAP;' },
  { name: '#573c 设置搜索并入说明文案素材（删则数据驱动召回失效）', file: 'js/personalize.js', needle: "window.__settingsHelpDesc[tagEl.getAttribute('data-setdesc')]" },
  { name: '#573d 设置搜索拼音首字母轻量表（删则 ssms/hfsz 等首字母搜不到）', file: 'js/personalize.js', needle: "'深色模式': 'ssms'" },
  { name: '#573e 自定义字卡页搜索组内精准排序（删则搜单字精确卡淹没回流；oi 决胜保 data-idx 原始索引）', file: 'js/chatcard.js', needle: '.sort((a, b) => a.rk - b.rk || a.oi - b.oi)' },
  { name: '#573f 功能大全搜索原始行序快照（删则排序后 children 与 items 错位＝显隐打到错行）', file: 'js/feature-hub.js', needle: 'if (card && !card.__fhubOrder) card.__fhubOrder = Array.prototype.slice.call(card.children);' },
  // ==== 2026-09-16 #574 字卡库开页「空白干等 IDB」（用户报「字卡库卡 5、6 秒，也没有动画
  // 加载的缓冲」iPhone 14 Pro Safari 等多 iOS 机型）：本机读不到该作用域时要等 idbHydrateKey
  // 取回（iOS 挂后台杀连接后单次 6s、重试链 14s），而渲染被 hydrate 门控＝页面空白干等、
  // 页内零加载态。修＝需要取回时先出加载行（延迟 150ms 才出＝健康路径零闪动）。
  // 行为断言 tools/verify-cc-lib-loading.mjs（B1 桩挂起 IDB：≤1s 出加载行，修前无＝红）====
  { name: '#574a 字卡库需取回时先挂加载态（删＝页面回到空白干等数秒、无任何加载反馈）', file: 'js/chatcard.js', needle: "if (!curStore().get(curKey())) showLibLoadingSoon();" },
  { name: '#574b 加载态延迟 150ms 才出（删/改成立即出＝空库与健康设备开页闪一下，观感回归）', file: 'js/chatcard.js', needle: 'libLoadTimer = setTimeout(showLibLoadingRow, 150);' },
  { name: '#574c 取回落定后摘除加载态（删＝加载行残留占位盖住真实列表）', file: 'js/chatcard.js', needle: 'clearLibLoadingRow(); // #574' },
  { name: '#574d 加载行样式与旋转指示（删＝加载态无样式，退回一行裸文字）', file: 'css/chat-pages.css', needle: '.cc-lib-loading .cc-spin {' },
  // ==== 2026-09-16 #575 同类面补齐：表情包/拍一拍面板、我的表情包、字卡库列表页角标、字卡自检
  // 在等 IndexedDB 取回时一律出加载态（用户：「都补一下，不然用户误会是 bug」）——数据面不缩短
  // 等待，但等待期界面不能说谎（空态/角标 0 会被当成「字卡丢了」）。 ====
  { name: '#575a 聊天面板取回中标记（删＝表情包/拍一拍面板在等待期又退回「暂无…」空态）', file: 'js/chat.js', needle: 'ccPanelsFetching = true;' },
  { name: '#575b 表情包面板取回占位（删＝取回期显示「暂无表情包」被当成丢数据）', file: 'js/chat.js', needle: "ccLoadRowHtml('正在加载表情包…')" },
  { name: '#575c 拍一拍面板取回占位（删＝取回期显示「暂无拍一拍字卡」）', file: 'js/chat.js', needle: "ccLoadRowHtml('正在加载该分组拍一拍…')" },
  { name: '#575d 我的表情包取回占位（删＝18MB 级库取回期显示「暂无我的表情包」）', file: 'js/chat.js', needle: "ccLoadRowHtml('正在加载我的表情包…')" },
  { name: '#575e 字卡库列表页角标取回中态（删＝取回期角标显示 0，被当成「字卡丢了」；#574 同族）', file: 'js/chatcard.js', needle: 'markLibCountsLoading();' },
  { name: '#575f 取回完成写回真值并摘脉冲态（删＝角标永远「…」或一直闪）', file: 'js/chatcard.js', needle: "oe.textContent = libCounts.own < 0 ? 0 : libCounts.own; oe.classList.remove('cc-cnt-loading');" },
  { name: '#575g 字卡自检页取回占位（删＝取回大库时页内只有转瞬 toast，页面像卡住）', file: 'js/card-audit.js', needle: "bodyEl.innerHTML = '<div class=\"mochi-load-row\">" },
  { name: '#575h 共用加载行样式（删＝各处占位行无样式，退回裸文字）', file: 'css/chat-pages.css', needle: '.mochi-load-row {' },
  // ==== 2026-09-16 #576 存储异常弹窗带分步处理建议+直达按钮（用户：手机端弹这个窗时，
  // 里面也要提醒该干什么——原弹窗只报错让用户「去设置页导出」，手机端用户不知道去哪/干什么） ====
  { name: '#576a 弹窗直达按钮挂导出行（删/改＝又只报错不带动作，第一步「先导出备份」没人知道怎么做）', file: 'js/idb.js', needle: "idbFailAct('#row-export'" },
  { name: '#576b 直达走设置页分组tab+滚动链路（删＝按钮点了停在原地/跳错分组，兜底提示也不出）', file: 'js/idb.js', needle: "el.closest('.them-sec')" },
  { name: '#576c openModal 控制器补 ctl.close（删＝跳转成功弹窗关不掉，盖在设置页上）', file: 'js/personalize.js', needle: 'close: function () { try { close(); } catch (e) {} }' },
  // ==== 2026-09-16 #578 设置页/美化页顶部搜索框「外框没有颜色区分」（用户报手机端看不出是输入框）。
  // 根因：外观写死在 template 内联 style，border/background 是带 var() 的简写——安卓
  // mobile-adapt.js 把 input 转成 .ce-box 时按属性名逐个复制内联样式，带 var() 的简写复制
  // 不过去，可见的 .ce-box 实测 border:0px none + 全透明底＝外框连底色一起消失（浅色下原本
  // 也只是白底压白底＋10% 黑细线）。改走 .theme-search 类样式（input 与其 ce-box 同吃一份规则）。
  // 行为断言 tools/verify-set-search-frame.mjs（安卓转换态/未转换态 × 明暗，RED 基线 5 红：
  // 转换后 border 0px＋底色全透明、未转换态白底压白底）====
  { name: '#578a 搜索框外观走类样式（删规则/改选择器＝回到内联样式，安卓转换后外框消失）', file: 'css/setting.css', needle: '.theme-search { width:100%; box-sizing:border-box;' },
  { name: '#578b 外框/内边距用输入框专用 token 且底色可辨（边框改回 var(--card-border) 的 10% 淡线＝浅色下白底压白底复发；底色是加底块的那条）', file: 'css/setting.css', needle: 'background:var(--static-bg,rgba(0,0,0,.05)); border:1px solid var(--input-border,#e0e0e0); border-radius:9px;' },
  { name: '#578c 深色专用底色（删＝深色退回 6% 白底压在 #1c1c1c 上，几乎看不出输入框）', file: 'css/setting.css', needle: '[data-theme="dark"] .theme-search { background:var(--input-bg,#2a2a2a); }' },
  { name: '#578d 搜索框占位文字单行不折行（删＝370px 屏上补边框后差 2px 折成两行、框被撑高一倍）', file: 'css/setting.css', needle: '.ce-box.theme-search:empty::before { display:block; white-space:nowrap;' },
  // 🔧 2026-09-16 #579 会话收窄此锚（原 needle 只写 `border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff)`，
  // 该片段在 chat-settings.js / personalize.js / group-chat.js 三处**动态创建**的搜索框内联样式里各有一份
  // → 全量构建恒报「删除型哨兵又回来了」（假红、退出码 1），而真正要守的 template 内联样式有没有写回根本判不出来。
  // 补上 template 侧独有的 `padding:8px 10px;` 前缀后（JS 三处是 `padding:9px 11px;`），src 与产物均 0 命中，锚点收唯一。
  // ⚠️ 请 #578 会话确认此换锚符合原意（该批 verify-set-search-frame.mjs 不受影响）。
  { name: '#578e 搜索框外观必须留在类样式、不得写回内联（内联里带 var() 的 border/background 会被 ce-box 转换丢弃＝用户报的「外框没有颜色区分」原样复发）', file: 'template.html', needle: 'padding:8px 10px;font-size:13px;border:1px solid var(--card-border,#ddd)', absent: true },
  // ==== 2026-09-16 #579 美化页「边看边调」入口提到最前 + 最显眼（用户原话「桌面美化里的【边看边调】
  // 功能应该放最前面而且最显眼」）。此前它是 desk-quick 行里 5 个按钮的最后一个、跟四个「跳到某设置行」
  // 的小描边胶囊同款（实测 67×37px / 字重 600 / 无说明行）＝进美化页第一眼看不到这个主功能。
  // 现为标题正下方整宽主色条（366×61px / 字重 700 / 带一行说明，--btn-bg+--btn-ink 随主题色联动）。
  // 位置与体量的行为断言 tools/verify-beauty-cta-first.mjs（RED 基线＝还原旧形态 6/7 红）====
  { name: '#579a 边看边调入口改整宽主色条（改回 dq-btn 小胶囊＝用户「找不到边看边调」复发；类名即形态锚点）', file: 'template.html', needle: 'class="dq-primary" id="dq-drawer"' },
  { name: '#579b 边看边调不得退回 desk-quick 行的小按钮形态（旧形态是行内最后一个 dq-btn；加回＝入口重新淹没在四个跳转按钮里）', file: 'template.html', needle: '边看边调</button>', absent: true },
  { name: '#579c 边看边调入口跟随主题色（写死浅紫 #f0eaff/#493478＝与用户黑白风格冲突复发；逻辑锚=主题色派生淡底声明，template.html 内唯一）', file: 'template.html', needle: 'border:1px solid color-mix(in srgb, var(--btn-bg,#111) 40%, var(--card-bg,#fff))' },
  { name: '#579d 边看边调开启胶囊用主题色实底（写死白底紫字＝不跟随主题色复发）', file: 'template.html', needle: 'background:var(--btn-bg,#111);color:var(--btn-ink,#fff);white-space:nowrap">点击开启 ›</span>' },
  // ==== 2026-09-16 #580 桌面翻页圆点与滑动不同步（用户：「切换 1/2/3 桌面页时，底部导航
  // 圆点反应慢，没有与我滑动完全同步」）。根因：desktop-slider.js 的 scroll 监听里
  // clearTimeout + setTimeout(sync,120)，每次滚动事件都把同步推到 120ms 后 ＝ 滚动全程圆点
  // 被冻结、松手吸附结束才跳一次（实测滞后 127ms），叠加圆点变形动画 250ms ≈ 0.4s 迟到感。
  // 修复：rAF 每帧跟随 + 每帧零查询零样式读取（gap/圆点数组缓存），圆点变形 250→160ms、
  // .dots 加 contain:layout 隔离 width 动画的布局抖动（安卓/iOS 逐帧同步不得引入卡顿）。
  // 行为断言 tools/verify-desk-dots-sync.mjs（跟手延迟 / 逐帧开销 / 无长帧）====
  { name: '#580a 圆点滚动中每帧跟随（改回 setTimeout/smooth 收尾＝滚动期间圆点又冻结、松手后才动，用户报的「不同步」原样复发）', file: 'js/desktop-slider.js', needle: 'if (!rafId) rafId = requestAnimationFrame(syncFrame);' },
  { name: '#580b 每帧步长走缓存、不逐帧 getComputedStyle（删缓存＝滚动的每一帧都强制样式重算，安卓低端机掉帧）', file: 'js/desktop-slider.js', needle: 'if (gapCache === null) gapCache = parseFloat(getComputedStyle(pages).columnGap) || 0;' },
  { name: '#580c 圆点容器 contain:layout（删＝圆点 width 变形每帧重排外泄到 #page-phone 整个桌面壳，滚动中掉帧）', file: 'css/home.css', needle: 'contain:layout;' },
  // ==== 2026-09-16 #587 桌面音乐功能「按钮很多失效」——悬浮播放小框压在自己要控制的控件上
  // （用户：「桌面音乐功能里的按钮很多失效了……其他设备型号也有出现」）。根因：全局悬浮小框
  // #sm-float 默认 left:12px;top:80px、宽 230px、高随系统字体浮动，恰好盖住桌面音乐小组件与
  // 音乐页上半部——无头 390×844 实测：音乐页「我的音乐库 / 歌单 / 我的收藏」三颗 tab 与桌面
  // 小组件进度条 #mw-bar 的 elementFromPoint 全命中 sm-float，点上去毫无反应（系统字号越大
  // 被吃掉的可点区域越多＝多机型同现象）。修复：悬浮小框在「音乐页可见」或「桌面小组件在位」
  // 时让位（这两处各自有完整播放控件，与既有 floatHideByWidget「小组件本身就是控制器，
  // 避免重复弹出」同源），并观察 #page-phone/#page-music 的 hidden 切页即时重算。
  // 行为断言 tools/verify-music-float-overlap.mjs（RED=1 回退判据复现遮挡）====
  { name: '#587a 悬浮小框在音乐页/桌面小组件在位时让位（删掉这个判据＝小框又压住音乐页三颗 tab 与小组件进度条，「点了没反应」原样复发）', file: 'js/music-player.js', needle: '|| floatHideByWidget || floatOwnSurfaceShown();' },
  { name: '#587b 让位判据本体：音乐页可见 → 让位（needle 为函数名锚，判据被改成恒 false 时 verify 脚本 B 层会红）', file: 'js/music-player.js', needle: 'if (musicPage && !musicPage.hidden) return true;' },
  { name: '#587c 桌面小组件在页内（offsetParent 非 null）→ 让位（判据改成恒真／删掉＝要么桌面永远没有悬浮小框，要么小组件进度条继续被压住）', file: 'js/music-player.js', needle: 'return !!(w && w.offsetParent !== null);' },
  { name: '#587d 切页重算接线（#page-phone/#page-music 的 hidden 变化 → renderFloat；删掉＝从聊天切回桌面时小框仍挂在桌面上继续压住小组件）', file: 'js/music-player.js', needle: 'new MutationObserver(function () { renderFloat(); })' },
  // ==== 2026-09-16 #583 字卡自检页补「回复设置 → 聊天」侧的链路闸门（用户：「还需要可以把
  // 回复设置里的聊天设置那些全部检查加进去，怎么优化」）。此前自检只盖「卡池有没有货」，
  // 回复设置那半边（词典拼字/梦角造句/多字卡/自定义占比/附加件/已读不回）没进去——字卡用不到
  // 有一半原因在这半边。同时修掉原来那张「系统预设 X% / 自定义 (100−X)%」占比卡的口径错误：
  // 它漏了 dc-use-chat 场景闸、漏了总档缩放，也漏了 csp-cust——消费端 chat.js genReplyText
  // 是在默认字卡覆盖点前按 csp-cust 掷签保留自定义文本，两者不是二选一，真实覆盖率
  // ＝ 总档缩放后的聊天概率 ×(1−csp-cust%)（默认值下 30% → 实际 15%，原先高报一倍）。
  // 行为断言 tools/verify-card-audit.mjs（B3h/B3i 已随本节改写）====
  { name: '#583a 预设覆盖率按「总档缩放 × (1−csp-cust)」算（改回 dc-overall-chat 原值或去掉 csp-cust 项＝又高报一倍，用户按它调参会调反）', file: 'js/card-audit.js', needle: 'var presetFinal = (lock || !dcEn || !dcUseChat) ? 0 : Math.round(dcOvEff * (100 - cspCust) / 100);' },
  { name: '#583b 自检页「调整」直达 回复设置→聊天 tab（删＝回复设置侧每行都跳不出去，用户看完「卡在哪」却到不了改的地方）', file: 'js/card-audit.js', needle: "if (key.indexOf('@reply:') === 0) return openReplyPage(key.slice(7));" },
  { name: '#583c 附加件全 0 的「全部恢复默认」真的逐键回默认（删＝按钮点了不动，表情包/图片/颜文字三类字卡继续永不出镜）', file: 'js/card-audit.js', needle: 'ATTACH.forEach(function (a) { if (storeSet(a[0], a[2])) okAny = true; });' },
  { name: '#583d 默认聊天字卡漏斗补 dc-use-chat 场景闸与总档（删任一项＝场景关闭或总档=0 时该行仍显示 ✓，用户以为「占比 25% 就该出卡」）', file: 'js/card-audit.js', needle: 'var usable = !lock && dcEn && dcUseChat && all > 0 && cat && prob > 0 && avail > 0;' },
  { name: '#587e 今日留言横幅「仅桌面可见」从显示前门控延续到显示期（删掉＝横幅在音乐页继续悬着，压住三颗 tab 与返回/设置五处点不动）', file: 'js/calendar.js', needle: 'new MutationObserver(function () { if (phonePageEl.hidden) hideGreetBanner(); })' },
  { name: '#587f 横幅切页收起判据引用的桌面节点（删掉＝观察器报错/横幅永远不因切页收起）', file: 'js/calendar.js', needle: "const phonePageEl = document.getElementById('page-phone');" },
  // ==== 2026-09-16 #592（用户实报）设置 → 工具 →「使用提示」点击没有任何反应：原实现只调
  //   window.toast，而全项目从未给 window.toast 赋过值（device.js 记录过同一个死通道）——
  //   重置其实已经成功，但屏幕上零变化（设置页没有 .pc-bar 可移除）。改自绘 #cc-toast。
  //   行为断言 tools/verify-page-coach.mjs B6.0/B6.2（点击后 #cc-toast 出现·show·不透明·有文案）
  //   ⚠️ #592b 若因「换一种自绘实现」被删，请同步更新本锚（它证明自绘分支在位，不是死通道）
  { name: '#592a 「使用提示」点击的可见反馈 helper（删掉＝点击又只剩静默重置，用户看不到任何反应）', file: 'js/page-coach.js', needle: 'function tipToast(msg) {' },
  { name: '#592b helper 里自绘 #cc-toast 分支的自动收起计时（删掉＝只留从未被赋值的 window.toast 死通道）', file: 'js/page-coach.js', needle: "clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2400);" },
  { name: '#592c 重置行点击接线到可见反馈（回退成 window.toast(...)＝「点击没有任何反应」原样复发）', file: 'js/page-coach.js', needle: "tipToast('已重置：再进入那些页面会重新看到上手提示');" },
  // ==== 2026-09-16 #640（用户**第二次**报同一句话：「点击【使用提示】什么反应也没有，根本没有设计这个功能」）
  //   #592 只补上了「点击有反馈」这一层，屏幕上仍只有 2.4s 后消失的 toast + 看不见的标记复位，
  //   用户无法判断它做了什么；而行文案把「字卡库」写在最前，已有字卡的用户进字卡库按设计
  //   （REG.chatcard.need）永不提示＝承诺里最显眼那条永远不出现。改：点击开「使用提示」面板，
  //   逐页列出「提示什么 / 现在还会不会再提示（诚实标出 need 门）/ 去看看」，重置结果常驻面板。
  //   行为断言 tools/verify-page-coach.mjs B6.3~B6.8（真实产物 RED 8 红 → GREEN 37/37）。
  //   ⚠️ 面板是动态创建后挂 body，故也登记了 float/返回键清单（#640c/#640d）＝关面板必须能解开滚动锁
  { name: '#640a 使用提示面板本体（删＝点击退回「只闪一个 toast」，用户又看不到这行到底做了什么）', file: 'js/page-coach.js', needle: "sheet.id = 'pc-sheet-mask';" },
  { name: '#640b 面板逐页状态诚实标出 need 门（字卡库已有字卡＝不再提示；删/改回恒定「会提示」＝又在承诺一个不会发生的事）', file: 'js/page-coach.js', needle: "cfg.skipText || '这页当前不需要提示'" },
  { name: '#640c 面板登记进 FLOAT_SELECTORS（删＝面板打开后底层设置页仍可滑动、关掉后也可能残留滚动锁）', file: 'js/mobile-adapt.js', needle: "'#pc-sheet-mask'" },
  { name: '#640d 面板登记进 tabs.js 返回键浮层清单（删＝安卓返回键穿过面板直接退页面）', file: 'js/tabs.js', needle: "'pc-sheet-mask'" },
  // ==== #584 卡顿被误判为 bug 的性能两修（都在 chatcard.js：列表页搜索防抖 / 预压缩串行化）====
  // 行为断言 tools/verify-cc-jank-fix.mjs（RED=1 回退并发预热复现「主线程被连续解码编码霸占」）
  { name: '#584a 字卡库列表页搜索走防抖包装（回退成 input 直连 filterEntries＝每敲一键全量重扫 7k+ 预设字卡）', file: 'js/chatcard.js', needle: "searchInput2.addEventListener('input', ccSearchInput);" },
  { name: '#584b 慢搜索「搜索中…」的触发判据（删掉＝重库搜索全程零反馈，又变成「点了没反应」）', file: 'js/chatcard.js', needle: 'if (ccSearchLast < 120) { ccSearchRun(); return; }' },
  { name: '#584c 慢搜索提示先上屏一拍再跑同步搜索（删掉＝提示写进 DOM 也来不及画出来，等于没加）', file: 'js/chatcard.js', needle: 'ccSearchPost = setTimeout(ccSearchRun, 32);' },
  { name: '#584d 搜索中提示文案本体（用户可见的加载反馈，删掉＝搜索期间界面看不出在处理）', file: 'js/chatcard.js', needle: "searchResultEl.innerHTML = '<div class=\"ta-empty\" style=\"padding:20px 12px\">搜索中…</div>';" },
  { name: '#584e 预压缩串行化的世代计数（回退并发预热＝启动/切联系人卡死数秒到数十秒复发）', file: 'js/chatcard.js', needle: 'const gen = ++ccShrinkGen;' },
  { name: '#584f 预压缩每张之间让出主线程（删掉＝连续解码+PNG 编码重新霸占主线程）', file: 'js/chatcard.js', needle: 'await new Promise(function (res) { setTimeout(res, 0); });' },
  { name: '#584g 单张压缩兜底超时（删掉＝坏 dataURL 既不 load 也不 error 时卡住整轮预热）', file: 'js/chatcard.js', needle: 'setTimeout(fin, 3000);' },
  // ==== 2026-09-16 #585「联系人给我买礼物发送到聊天」按最正常使用优化（用户：「为什么总是无法
  // 触发联系人给我买礼物发送到聊天里，是不是有 bug 或设计缺陷」）。无头实测定位四个叠加原因：
  //   ① 总开关历史遗留——旧版（无 wlVer 标记）记录里的 giftInOn===0 分不出「用户主动关掉」与
  //      「#312 时代默认 0 被设置面板连带写回」（当时改任意一项都会整对象保存），命中即把心愿兑现/
  //      随机送礼一起掐死，只剩不发聊天消息的「TA 自己买」——实测连跑 8 次：聊天 0 件礼物、
  //      心意柜自买 8 件，正是用户描述的「TA 一直在买、从不发到聊天」。现按 wlVer 打标一次性升级。
  //   ② 每日额度共用——②「TA 自己买」（默认 10%、不发聊天消息、判定在前）与「送礼给我」（默认 5%）
  //      共用一个 3 次/天池子；模拟 2000 天（每天 30 条消息）自买平均吃 2.0 次、81% 的日子把额度
  //      吃满，④ 当天再不可能触发（0.30 件/天 → 拆开后 1.11 件/天）。现拆成两本账。
  //   ③ 投递竞态——掷中后 1.5~4s 投递窗内切桌面，钱已扣/心愿已删/额度已占，礼物被静默丢弃
  //      （实测：余额 5000.00→4967.00、心愿消失、聊天与心意柜零新增）。现跨桌面补投递回原桌面。
  //   ④ 日期口径——todayKey 用 UTC，中国时区下「每天 3 次」在北京时间早 8 点重置。
  // 另：设置面板「清空概率输入框→失焦」被静默写成 0（＝永久关闭该路径）改为恢复原值 + 就地提示。
  // 行为断言 tools/verify-gift-ta-send.mjs（S 20 条 + B 18 条全绿；RED 基线 14 条红）====
  { name: '#585a 旧记录里被遗留关闭的「TA 送我礼物」总开关救回开启（删掉＝只剩不发聊天消息的「TA 自己买」，聊天里永远等不到礼物）', file: 'js/gift-shop.js', needle: 'const revived = raw.giftInOn === 0;' },
  { name: '#585b 设置口径迁移只跑一次：已带 wlVer 的记录一律不动（删掉＝用户新关掉的开关每次启动又被强行打开）', file: 'js/gift-shop.js', needle: 'if (!raw || raw.wlVer === WL_VER) return false;' },
  { name: '#585c 「送我」额度只看送礼这本账（改回读自买那本／与自买共用＝隐身自买把额度吃光，送礼当天再不触发）', file: 'js/gift-shop.js', needle: 'const giftCapped = dayCount(AUTO_DAILY_PREFIX) >= 3;' },
  { name: '#585d TA 自买走自己的独立额度（删掉 selfCapped 换回共用 capped＝「额度被自买吃光」那套复发）', file: 'js/gift-shop.js', needle: 'st.selfOn && !selfCapped && Math.random() * 100 < st.selfPct' },
  { name: '#585e 投递窗内已切桌面 → 跨桌面补投递（改回直接 return＝钱花了、心愿没了、礼物不落聊天也不进心意柜）', file: 'js/gift-shop.js', needle: 'if (window.chatAppendDeskRec) window.chatAppendDeskRec(cid, rec);' },
  { name: '#585f 指定联系人的心意柜写入通道存在（删掉＝跨桌面补投递的礼物只在聊天里、收到的礼盒少一件）', file: 'js/gift-shop.js', needle: 'function boxStoreFor(cid) {' },
  { name: '#585g 每日额度按本地日期切（改回 toISOString()＝中国时区下额度在北京时间早 8 点重置）', file: 'js/gift-shop.js', needle: 'function todayKey() { const d = new Date();' },
  { name: '#585h 概率非法输入恢复原值、不静默写 0（删掉＝清空输入框失焦就把该行为永久关闭，用户还以为「调过了」）', file: 'js/gift-shop.js', needle: 'inp.value = String(cur[key]);' },
  { name: '#585i 删除型：旧的「切桌面即丢弃投递」later() 壳不得复活', file: 'js/gift-shop.js', needle: 'const later = function (fn) {', absent: true },
  { name: '#585j 删除型：UTC 日期键不得复活', file: 'js/gift-shop.js', needle: 'function todayKey() { return new Date().toISOString().slice(0, 10); }', absent: true },
  // v3.26.x #586：经期温柔语态「多张字卡粘成一串、没有空格」（用户报「没开拼字功能，联系人发消息还是用拼字卡；温柔动作自动拼进来且没有空格隔开每一个字卡」，多机型同报）
  { name: '#586a 温柔前缀/正文/动作三张字卡拼接处空一格（回改成 p + text + s 裸拼接＝字卡粘成一串，用户当成「没开拼字却出现拼字卡」）', file: 'js/period.js', needle: 'var out = warmJoin(warmJoin(p, text), s);' },
  { name: '#586b 空段不留孤立空格 / 正文自带空白不重复（删掉＝字卡被逐张关掉后消息出现多余空格）', file: 'js/period.js', needle: 'if (/\\s$/.test(a) || /^\\s/.test(b)) return a + b;' },
  { name: '#586c 温柔动作池改读数据分组（改回代码里抄死的 6 条＝字卡库「温柔动作」后 6 张是哑开关，点了不生效）', file: 'js/period.js', needle: "if (g[i] && g[i][0] === '温柔动作' && Array.isArray(g[i][1]) && g[i][1].length) {" },
  // ==== 2026-09-16 #581 图标图片「缩放 + 位置」+ 边看边调补批量上传入口（用户：「【边看边调】功能里
  // 缺少批量上传桌面图标按钮」「上传了图标按钮图片后，需要可以只移动按钮里图片的位置，不用重新上传」）。
  // 三个键 app-icon-zoom-/pos-x-/pos-y-<key>（per-cid）只调「图片在图标里的构图」，不碰图片本体；
  // 两支渲染各自都不露底色：未放大走 object-position（原图被裁才有位移空间），放大后走
  // translate+scale（位移上限＝缩放余量的一半）并给 .app-ico 裁边。三个入口：边看边调抽屉「图标」分区、
  // 设置页「调整图标图片位置」行、装修模式点图标菜单。行为断言 tools/verify-icon-img-fit.mjs ====
  { name: '#581a 图标图片缩放/位置渲染函数（删＝位置设置存了也不生效）', file: 'js/personalize.js', needle: 'const applyAppIconFit = (app) => {' },
  { name: '#581b 放大后位移+缩放表达式（改回只 object-position＝正方形原图放大后无法移动，用户「移动按钮里图片的位置」诉求落空）', file: 'js/personalize.js', needle: "translate(' + tx + '%, ' + ty + '%) scale(" },
  { name: '#581h 位移方向与「壁纸定位/object-position」同口径（负号：值大＝看更靠右/靠下的一段；改回正号＝同一根滑杆在放大前后把画面推向相反一侧，用户会觉得「位置滑杆时灵时不灵」）', file: 'js/personalize.js', needle: 'const tx = -Math.round(((x - 50) / 50) * ((z - 100) / 2) * 100) / 100;' },
  { name: '#581c 边看边调抽屉补批量上传图标图片入口（删＝用户报的「边看边调里缺少批量上传按钮」复发）', file: 'js/personalize.js', needle: '批量上传桌面图标图片（可多选）' },
  { name: '#581d 「调整图片位置」待选标记（删＝从抽屉/设置页进去后点图标不开位置面板，只弹普通图标菜单；逻辑锚=待选分支里有图才开面板那一行）', file: 'js/personalize.js', needle: "if (app && app.dataset.app && store.get('app-icon-' + app.dataset.app)) { openIconFitPanel(app); return; }" },
  { name: '#581e 设置页「调整图标图片位置」行（删＝该功能在设置页无入口，只能靠装修模式摸到）', file: 'template.html', needle: 'id="row-icon-fit"' },
  { name: '#581f 位置面板登记进 FLOAT_SELECTORS（删＝面板打开时底层桌面仍可滑动，与抽屉 #527n 同族）', file: 'js/mobile-adapt.js', needle: "'#beauty-drawer', '#icon-fit-panel'];" },
  { name: '#581g 功能大全补「调整图标图片位置」条目（删＝搜「图标 位置」找不到该功能）', file: 'js/feature-hub.js', needle: "{ n: '调整图标图片位置'," },
  // ==== 2026-09-17 #696 装修模式「点桌面图标上传图片」失效（用户直派：「桌面的边看边调功能，不能
  // 上传单个图标的图片」「原装修模式点击桌面图标上传图片失效了」）。根因＝#581 的「调整图片位置」待选
  // 标记 __iconAdjustPick 悬空：走到「没有自定义图片」的图标时 openIconFitPanel 早退、标记没消费，
  // 此后每次点图标都被劫持（有图弹位置面板 / 无图只弹提示），图标菜单不再出现、整会话不自愈。
  // 三条逻辑锚分别锁定「消费标记后才分支」「退出装修收掉挂起状态」「边看边调补单个上传入口」。
  // ⚠️ 多行 needle 必须按**压缩后的样子**写（minifyJs 去行首缩进）：续行前面不能带源码缩进，
  // 否则 src 里能命中（哑哨兵体检放过多行针）、产物里永远命中不了＝构建恒定报缺失（实测踩过）。
  // 行为断言 tools/verify-icon-img-fit.mjs（F1~F7）====
  { name: '#696a 待选标记先消费再分支（改回先转 openIconFitPanel＝无图图标让它早退，标记悬空把之后每次点图标都劫持进位置面板，「点图标上传图片失效」复发）', file: 'js/personalize.js', needle: "window.__iconAdjustPick = false;\nif (app && app.dataset.app && store.get('app-icon-' + app.dataset.app)) { openIconFitPanel(app); return; }" },
  { name: '#696b 退出装修收掉挂起标记与位置面板（删＝点了「调整图片位置」没点图标就退出，标记留到下次进装修，那次点图标弹的是位置面板）', file: 'js/personalize.js', needle: "window.__iconAdjustPick = false;\nconst fitPanelEl = document.getElementById('icon-fit-panel');" },
  { name: '#696c 边看边调「图标」分区补单个上传入口（删＝抽屉里只有批量与调整位置，用户报的「边看边调不能上传单个图标的图片」复发）', file: 'js/personalize.js', needle: "mkAct('上传单个图标图片（点图标）'" },
  // ==== #588 卡顿/误判为 bug 的性能批（gift-shop 每件一次 JSON.parse / records 关心页 O(n²) / garden 空花园无提示）====
  // 行为断言 tools/verify-jank-batch2.mjs（RED=1 内联还原三处旧形态，断言逐条转红）
  { name: '#588a TA 心愿 id 集合记忆化入口（删＝giftItemHtml 每件礼物重解析一次心愿单，302 件＝302 次 JSON.parse）', file: 'js/gift-shop.js', needle: 'function taWishIds() {' },
  { name: '#588b 集合失效点挂在 wishSave 上（删＝TA 心愿变更后角标不刷新；WL_TA_KEY 全部写路径都过 wishSave）', file: 'js/gift-shop.js', needle: 'if (key === WL_TA_KEY) _taWishIds = null;' },
  { name: '#588c 礼物格渲染改走记忆化集合（回退 wishLoad(...).some＝每件一次解析复发）', file: 'js/gift-shop.js', needle: 'const taWanted = taWishIds().has(g.id);' },
  { name: '#588d 关心页问卡时间戳预排序 + 二分（回退全表 some＝聊天上千条时 O(n²) 卡住「关心」页签复发）', file: 'js/records.js', needle: 'const hasAskCardNear = (t) => {' },
  { name: '#588e ask-msg 改调二分判据（删＝退回对全表 some 的 O(n²) 实现）', file: 'js/records.js', needle: 'const nearCard = hasAskCardNear(t);' },
  { name: '#588f 花园读回期「正在读取」提示（删＝LS 未回填时先画空花园，用户以为数据全丢）', file: 'js/garden.js', needle: 'toast("正在读取本地花园数据…");' },
  // ==== 2026-09-16 #593 朋友圈贴纸「点击照片选贴纸位置」提示条挡住使用（用户明说多机型同报）====
  // 用户原话：「朋友圈的贴纸功能【点击照片选贴纸位置】的提示，会挡住使用」。
  // 根因：提示条绝对定位钉在照片顶部（照片高约 104px 时占 33px≈顶部 1/3），点那一带被提示条接走
  //   ＝被当成「取消」——一张都贴不上、模式还退出；系统字号越大压得越多＝多机型同现象。
  // 行为断言 tools/verify-feed-sticker-pos.mjs 的 S0/A2/E1/E2/E4（旧实现 A2/E1/E2 必红）。
  { name: '#593a 提示条插在配图区之前（删/改回 box.appendChild＝又压回照片上、点顶部贴不上复发）', file: 'js/feed.js', needle: 'box.parentNode.insertBefore(hint, box);' },
  { name: '#593b 提示条移除按 ctx 引用（提示条已不在配图区内，退回 ctx.box.querySelector 会删不掉、提示条常驻）', file: 'js/feed.js', needle: 'if (ctx.hint && ctx.hint.parentNode) ctx.hint.parentNode.removeChild(ctx.hint);' },
  { name: '#593c 选位期间看门狗主动收尾（卡片被局部/全量重渲染换掉节点时不留提示条与选位态）', file: 'js/feed.js', needle: 'const timer = setInterval(() => { if (!box.isConnected) feedCancelPickSticker(); }, 250);' },
  { name: '#593d 提示条覆盖式定位已删除（absent：absolute+top:0+z-index:3 压照片的旧形态复活即报警）', file: 'css/chat-pages.css', needle: '.feed-pick-hint { position: absolute', absent: true },
  { name: '#593e 提示条双保险 pointer-events:none（即便被改回覆盖式也保证点得穿到照片）', file: 'css/chat-pages.css', needle: 'gap: 8px; margin: 8px 0 0; padding: 7px 10px; background: rgba(0, 0, 0, .55); color: #fff; font-size: 12px; border-radius: 8px; pointer-events: none; }' },
  // ==== 2026-09-16 #594 切换桌面联系人 → 打开聊天「所有消息变 2 条再回弹恢复」（多机型同报）====
  // 根因：媒体令牌化后同一条消息 LS 快照存原文（base64 /「名称|||data:audio」）、IDB 权威副本
  // 存 @@m: 令牌，权威合并的去重签名只比原文 ⇒ 判成两条 ⇒ 快照副本被 append 回来（同 ts ⇒
  // 排序后成对相邻）＝首屏全翻倍，后台归一化又合并回 1＝用户看到的「先 2 后 1」。#511 只收了
  // LS 侧合并签名，权威合并这侧漏网。行为断言 tools/verify-chat-switch-dupe.mjs（RED 9/22 精确
  // 复现 msgs 12→20、DOM 翻倍帧；GREEN 22/22）。
  { name: '#594a 媒体跨形态归一唯一入口（删＝各处又各写一份展开逻辑，语音尾形态漏判复发）', file: 'js/chat.js', needle: 'function mediaFormText(s) {' },
  { name: '#594b 权威合并签名走 mediaSigPart（回退原文直比＝切桌面开聊天消息成对翻倍复发）', file: 'js/chat.js', needle: 't: mediaSigPart(m && m.text)' },
  { name: '#594c 媒体「原文 ↔ 令牌」互补判定入口（冷池下 expand 恒 null，这条是唯一拦得住的一层）', file: 'js/chat.js', needle: 'function recKindCovers(kindIndex, m) {' },
  { name: '#594d 权威合并接了互补判定（删＝LS 侧原文副本被当新消息并回，用户报障原样复发）', file: 'js/chat.js', needle: 'if (recKindCovers(idbKinds, m)) return false;' },
  { name: '#594e 读侧 LS 合并接了互补判定（删＝内存已令牌化时把快照原文副本 concat 回来）', file: 'js/chat.js', needle: '!recKindCovers(lsKinds, m)' },
  { name: '#594f 写侧 LS 快照合并接了互补判定（删＝LS 里长期存两份同一条，下次进页照样先 2 后 1）', file: 'js/chat.js', needle: 'if (!m || seen.has(lsMergeSig(m)) || recKindCovers(kinds, m)) return false;' },
  { name: '#594g 旧「原文直比」权威签名不得复活（absent：直接比 m.text＝跨形态判不出同一条，半修征兆）', file: 'js/chat.js', needle: 't: m && m.text, s: m && m.side', absent: true },
  // ===== #603 字卡库「导出数据 / 导入数据」在壳浏览器上点了没反应（红米 K70 至尊版 MIUI 自带浏览器，用户明说其他机型也有）=====
  // #755（2026-09-18）后这两条锚点从 chatcard.js 迁到 device.js：原来字卡库有一支手抄的常驻 input
  // 实现（let ccFileInput / ccPickSeq），本轮已收编进全站统一入口 window.mochiFilePick —— 锚点语义
  // 不变（常驻复用单一实例 + change 处理器不串台），只是保护对象换成了统一实现。
  { name: '#603a 文件选择 input 常驻复用的单一实例（退回每次新建＝壳浏览器不认这次激活，选择器打不开；#755 后保护对象迁到统一入口）', file: 'js/device.js', needle: "var input = null; // 常驻单例：同一 id 复用，绝不随点按堆积节点 mochi-755-single" },
  { name: '#603b change 处理器不串台（每次调用重设 onchange，上次选择的迟到回调绝不喂给本次调用方；#755 后保护对象迁到统一入口）', file: 'js/device.js', needle: 'input.onchange = function () {' },
  { name: '#603c 字卡库导出落到 data-backup 三级降级链（删＝退回裸 a[download]，小米/华为等壳静默不落文件）', file: 'js/chatcard.js', needle: 'window.mochiExportFile(json, fname, title)' },
  { name: '#603d 导出给「导出文件 / 复制文字」两种通道（删＝文件通道整条不可用时没有任何退路）', file: 'js/chatcard.js', needle: '导出文件（推荐）' },
  { name: '#603e 导入模式弹窗第四条路「粘贴文本导入」（删＝文件选择器打不开的机型整条导入功能不可用）', file: 'js/chatcard.js', needle: "label: '粘贴文本导入', value: 'paste'" },
  { name: '#603f 粘贴通道与文件通道汇入同一条解析链（删＝粘贴只是弹个框，卡进不了库）', file: 'js/chatcard.js', needle: "typeof f._pasteText === 'string'" },
  { name: '#603g 没有可导出字卡时写明原因（退回只有 disabled 按钮＝用户看到的仍是「点了没反应」）', file: 'js/chatcard.js', needle: '当前没有可导出的字卡' },
  // #604（2026-09-16 用户：「贪吃蛇有bug，我输了显示我赢，还有个可能就是对局结束时，两只蛇的
  //   颜色不对」＋「好多手机使用这个功能是迷你框，无法正常玩」；用户明说其他机型也有、
  //   要求不要覆盖式修改引发跨机型反复）。三条根因都在 src/js/snake-game.js，零机型分支。
  { name: '#604a 贪吃蛇按存活判胜负（撞死的一方输；改回比分数＝我方撞死却分高时又弹「你赢了」）', file: 'js/snake-game.js', needle: "if (!myAlive && oppAlive) result = 'lose';" },
  { name: '#604b 贪吃蛇 coop 队友死＝队伍输（myAlive 必须含 P2 存活；删则队友撞死仍判「组队获胜」）', file: 'js/snake-game.js', needle: 'const myAlive = !!state.player.alive && !(state.p2 && !state.p2.alive);' },
  { name: '#604c 贪吃蛇死亡不再整条刷中性灰（absent：灰化复活＝收局冻结帧的蛇色与结算页 🟢P1/🟠P2 对不上）', file: 'js/snake-game.js', needle: '#cfcfd4', absent: true },
  { name: '#604d 贪吃蛇默认形态走全站设备判定（删则退回只看 innerWidth<900＝桌面版网站模式/手机横屏停在半框，画布塌到 90px 没法玩）', file: 'js/snake-game.js', needle: 'if (d && (d.isMobile || d.isTablet)) return true;' },
  { name: '#604e 摸鱼浮字巡检带「游戏开着就跳过」闸门（删＝玩游戏时「点我抓包」浮字又盖在棋盘/方向键上抢点按，用户报「挡住我玩游戏」）', file: 'js/p2-features.js', needle: 'if (gamePanelOpen()) return;' },
  { name: '#604f 摸鱼闸门必须在 taChimeUse 之前（挪到其后＝45 分钟冷却与每日额度被吃掉，出游戏后这次涨值再也飘不出来）', file: 'js/p2-features.js', needle: 'const GAME_PANEL_IDS = ' },
  // #608（2026-09-16 用户：「总是有用户以为 QQ音乐别的 app 音乐可以导入」；编号让位：同日 #607 已被「使用说明补三块长文」批占用）——导入面板与
  //   功能介绍/常见问题都写明「只支持 本机音频 / 网易云 / 音频直链」。删掉这两处声明＝
  //   用户又只能自己猜（导入链本就只认网易云，其他 App 分享链接必然放不出声）。
  { name: '#608a 导入面板挂「不支持其他 App 分享链接」声明（删＝用户重新以为 QQ音乐等能直接导入）', file: 'js/music-player.js', needle: '不支持其他 App 的分享链接' },
  { name: '#608b 常见问题写明「QQ音乐 / 酷狗 / B站等其他 App 的歌能导入吗」（删＝功能介绍里又只剩网易云一句话可猜）', file: 'template.html', needle: 'QQ音乐 / 酷狗 / B站等其他 App 的歌能导入吗' },
  // ===== #606「关于」tag 分类整理（用户 2026-09-16 问「关于 tag 还能写什么、什么分类放进来」→
  //   拆成 应用信息/帮助与支持/隐私与法律/联系与反馈 四类；使用说明与新手引导移入帮助类；
  //   新增版本与更新/开源与致谢/隐私与数据安全/联系作者 四个只读入口。回退成单入口或删行即回归）=====
  { name: '#606a 关于段「应用信息」分类标题（删＝关于段退回单入口/分类被拆散）', file: 'template.html', needle: 'gs-title">应用信息' },
  { name: '#606b 关于段「帮助与支持」分类标题（使用说明/新手引导的归属组）', file: 'template.html', needle: 'gs-title">帮助与支持' },
  { name: '#606c 关于段新增「版本与更新」行（含版本号 .val）', file: 'template.html', needle: 'id="row-changelog"' },
  { name: '#606d 关于段新增「开源与致谢」行', file: 'template.html', needle: 'id="row-opensource"' },
  { name: '#606e 关于段新增「隐私与数据安全」行', file: 'template.html', needle: 'id="row-privacy"' },
  { name: '#606f 关于段新增「联系作者 / 反馈」行', file: 'template.html', needle: 'id="row-contact"' },
  { name: '#606g 四个只读入口的弹窗接线（删＝行点了没反应）', file: 'js/personalize.js', needle: "bind('row-changelog'" },
  { name: '#606h 新手引导挂进「帮助与支持」组（改回工具段独立成组＝与使用说明分家复发）', file: 'js/onboarding.js', needle: "guideRow.closest('.set-group')" },
  { name: '#606i 新手引导说明登记（删＝该行少「功能说明」胶囊、也搜不到）', file: 'js/settings-help.js', needle: "sel: '#row-guidebook'" },
  { name: '#606j 功能大全收录关于段新入口（删＝功能大全搜不到版本/隐私/联系等）', file: 'js/feature-hub.js', needle: "go: ['#row-changelog']" },
  // ==== 2026-09-16 #612 字卡库【表情包】链接导入弹窗「没办法下滑导入」（多机型，用户明说其他机型也有）：
  //    .modal 内两个子滚动容器 .modal-textarea.ce-box / .modal-group-chips 都用 overscroll-behavior:contain——
  //    框内（胶囊行内）滚到边界后，contain 把滚动链一并拦断，手指自然落在填满的多行框上起滑时手势被框独吞，
  //    外层 .modal（承载「目标分组」与「确定」）永远滚不动＝看不到底部、无法完成导入。
  //    改 auto：溢出仍先框内滚（v3.23.x 限高+框内滚动不回退），到边界放行给 .modal。
  //    同族第 4 次（v3.23 modal-textarea → v3.25 选项框 → #295 dec-opts/gd-opts 已 auto → 本次），
  //    dec-opts/gd-opts 早已是 auto，这两条盯的就是漏网的两处；改回 contain 即回归（verify-modal-scroll-chain B2/B3 变红）。
  //    同族未收口两处（在他人有在途改动的 chat-main.css / chat-pages.css，留待对应会话）：.ce-box.chat-ask-opts、
  //    .ce-box[data-for^="ta-opts-"] ====
  // #717 收窄：原 needle 含 -webkit-overflow-scrolling:touch 段，该旗标已按 #707 同族口径全站清理
  //（见 tools/verify-scroll-momentum-purge.mjs），语义锚＝overscroll-behavior:auto 滚动链放行，本段与 #612 修复无关
  { name: '#612 弹窗多行框滚动链放行·contain→auto（改回 contain 则框内滚到底后手指落在框上整个弹窗滚不动＝链接导入无法下滑导入复发）', file: 'css/base.css', needle: 'max-height:38vh;\noverflow-y:auto;\noverscroll-behavior:auto;' },
  { name: '#612 弹窗目标分组胶囊行滚动链放行·contain→auto（同族第二处；改回 contain 则胶囊行到边界后弹窗同样滚不动）', file: 'css/base.css', needle: 'max-height:36vh; overflow-y:auto;\noverscroll-behavior:auto;' },
  { name: '#614 通知发送链 SW.ready 超时兜底（删掉＝SW 被回收/注册失败时 ready 永不落地，后台通知「点测试没反应」+ 弹窗不发复发）', file: 'js/bg-keep.js', needle: 'kaWithTimeout(navigator.serviceWorker.ready, 4000)' },
  { name: '#614/#673 ready 拿不到现役 SW 时回退页面通知路径（隐藏态先挂「就绪即补发」，删掉＝不可用时永远 pending、测试按钮无反馈）', file: 'js/bg-keep.js', needle: 'if (!reg) { if (hidden) swNotifyLater(title, opts, chanOut); pageFallback(); return; }' },
  { name: '#614/#673 showNotification 超时用 thunk 形式（删掉 thunk 退回先求值写法＝同步 throw 穿透回调，发送链卡死且降级重发不跑）', file: 'js/bg-keep.js', needle: 'kaWithTimeout(function () { return reg.showNotification(title, attempt); }, 4000)' },
  { name: '#614 测试按钮点击即时反馈（删掉＝要等发送链 settle 才有提示，SW 卡住时用户看到「点了没反应」）', file: 'js/bg-keep.js', needle: "toast('正在检查通知环境…');" },
  // ==== 2026-09-17 #673 后台弹窗「又收不到」：过渡期不再整条吞新消息 + 发送链静默丢失口子（红米K80 Chrome 等多机型） ====
  { name: '#673 过渡期（切后台头15秒）由「一律不弹」改为按内容判定（退回无条件 return 则 TA 回复在 1~40 秒延迟内落窗＝聊天有、通知栏没有复发）', file: 'js/bg-keep.js', needle: 'recentChatDup(nkey, ts, NOTIFY_FRESH_CHAT_DUP_MS)) { gateStats.tooFresh++; return; }' },
  { name: '#673 过渡期内容判定窗 30 分钟（缩短到常规 5 分钟＝切后台瞬间重放几分钟前看过的字卡又弹，#498 防重弹面失守）', file: 'js/bg-keep.js', needle: 'const NOTIFY_FRESH_CHAT_DUP_MS = 30 * 60000;' },
  { name: '#673 隐藏态页面通道不谎报成功（删掉 resolve(!hidden) 改回无条件 true＝用户侧什么都没弹、调用方却记「已通知」且测试按钮写「已发送」）', file: 'js/bg-keep.js', needle: 'resolve(!hidden);' },
  { name: '#673 SW 未就绪时「就绪即补发」（删掉＝弱网/被回收重建窗口里的通知整条丢，后台关屏再也收不到）', file: 'js/bg-keep.js', needle: 'function swNotifyLater(title, opts, chanOut) {' },
  { name: '#673 通知通道如实上报（删掉＝测试按钮又把页面回退说成「已发送（Service Worker）」，故障层被指错）', file: 'js/bg-keep.js', needle: 'window.bgNotifyLastChannel = function () { return lastNotifyChannel; };' },
  { name: '#673 头像裁剪截止时间（删掉＝Image 回调不来时 showSysNotification 永不调用，通知静默消失）', file: 'js/bg-keep.js', needle: "if (!cropFired.v) { cropFired.v = true; sendFinal(''); }" },
  { name: '#673 过渡期运营判定探针 transitionBlocks（删掉＝回归脚本测不到「过渡期内全新消息放行/重放拦截」，跨机型回归失守）', file: 'js/bg-keep.js', needle: 'transitionBlocks: transitionBlocks,' },
  // ==== 2026-09-17 音乐互动台词静默通道（用户报障 vivo iQOO Z9x Edge 等多机型「播放导入的本地歌时出现消息
  //     提示音、音乐没法正常听」；与后台弹窗 #673 撞编号，本批即该音乐 #673 的哨兵，接在后台 #673 块之后）====
  { name: '音乐互动台词静默通道·chatAddSystem 带 silent（删掉＝音乐互动系统消息重回响铃通道，听歌时每掷中一次概率就响一次提示音盖在音乐上复发；needle 唯一于 music-player.js 的 taMusicSys）', file: 'js/music-player.js', needle: 'window.chatAddSystem(text, { silent: true, nightAllow: true })' },
  { name: '音乐互动台词静默通道·chatAddIn 带 silent（删掉＝「TA 暂停播放/恢复播放」字卡重回响铃通道，听歌时被消息提示音盖住复发；needle 唯一于 music-player.js 的 taMusicSay）', file: 'js/music-player.js', needle: 'window.chatAddIn(text, { silent: true })' },
  { name: '音乐互动台词静默·chatAddSystem 透传 silent：true（删掉＝调用方传的 silent 被就地吞掉，上面两条静默通道全部失效＝听歌提示音复发；needle 唯一于 chat.js 的 chatAddSystem）', file: 'js/chat.js', needle: "special: opts.special || 'poke', silent: opts.silent," },
  { name: '音乐互动静默·TA 暂停交互被用户介入打断也要记账（删掉＝用户点播放打断 TA 暂停后同歌/下一首还能再掷中＝「不管点哪首歌一播放就被打断、还响一声提示音」复发；needle 唯一于 music-player.js 的 cancelTaPause）', file: 'js/music-player.js', needle: 'if (taPauseActive && taPauseFiredId) bookTaPauseFired(taPauseFiredId);' },
  { name: '音乐互动静默·TA 暂停冷却用 `??` 让「无冷却」=0 生效（删改回 `\|\| 600000` 则设置成 0 的「无冷却」又被当 10 分钟，与 3913/3978 两处不一致＝交互频率异常且打断复现难测；needle 唯一于 music-player.js 的 scheduleTaPauseIfLucky）', file: 'js/music-player.js', needle: '(settings.cooldownMs ?? 600000)' },
  // ==== 2026-09-16 #616 新增【昵称互动】并入原【头像互动】并改名【头像和昵称互动】（用户原话：「我想新增一个和聊天里的【头像互动】逻辑和机制一样的【昵称互动】功能，可以存入多个文字昵称，联系人给我还有自己更换聊天昵称，直接在【头像互动】功能里加，【头像互动】的功能名字修改为【头像和昵称互动】」）====
  // 昵称池与头像池同机制（点击即换 + 邀请同意/拒绝 + 定时随机 1-8 小时），四条哨兵各守一个「删掉就静默失效」的面。
  { name: '#616a 昵称池点击换昵称入口（删掉＝半框里点昵称没反应，只剩头像还能换）', file: 'js/avatar-lib.js', needle: 'function switchNickFromLib(name) {' },
  { name: '#616b 换昵称接 chat.js 改名钩子（删掉＝历史系统消息仍叫旧昵称，「改完名旧消息没跟着变」复发）', file: 'js/avatar-lib.js', needle: 'if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff);' },
  { name: '#616c 联系人昵称池定时随机更换（删掉＝「TA 随机换昵称」开关形同虚设，永不自动更换）', file: 'js/avatar-lib.js', needle: 'setInterval(checkNickLibRefresh, 60000)' },
  { name: '#616d 头像/昵称两级 pane 切换（删掉＝切到「昵称」大类看不到昵称池，或切回「头像」两个 pane 同时露出来）', file: 'js/avatar-lib.js', needle: 'if (avPaneC) avPaneC.hidden = !(nameKind && !me);' },
  { name: '#616e 空池也要显示空态提示（删掉＝「库没变」快路径把空库误判成已渲染，四个池的「还没有…点击下方按钮添加」永不出现）', file: 'js/avatar-lib.js', needle: 'function emptyHintMismatch(el, lib) { return !!el && el.hidden !== (lib.length > 0); }' },
  { name: '#616f 昵称事件消息豁免改名清扫（删掉＝第二次改名把旧记录改写成 {ta}，两条记录看起来一模一样＝用户报的「看不出换了什么昵称」复发）', file: 'js/chat.js', needle: 'if (r.nickKeep) return false;' },
  { name: '#616g 昵称系统消息文案写明「换成了「XXX」」（删掉＝退回「XX 更换了昵称」，看不出换成哪个昵称，与 #616f 配套）', file: 'js/avatar-lib.js', needle: "function nickMsgPartner(to) { return 'TA 把聊天昵称换成了「' + to + '」'; }" },
  { name: '#616h 昵称事件消息渲染原样呈现（回退成无条件 pokePersonMap＝「我把 TA 的昵称换成了「小满」」被回填成「我把 小满 的昵称换成了「小满」」自指句）', file: 'js/chat.js', needle: "m.innerHTML = '<span>' + (rec.nickKeep ? escTxt(rec.text) : pokeIconHtml(pokePersonMap(rec.text, __taNm, __meNm))) + '</span>' +" },
  { name: '#616i 昵称池读取净化（删掉＝纯零宽字符条目又进池，顶栏/系统消息引号里渲染成空白＝用户报的「换成了「」」复发）', file: 'js/avatar-lib.js', needle: 'v.map(cleanNick).filter(Boolean)' },
  { name: '#616j 换昵称回应消息取实际生效昵称且空名不写引号（删掉＝引号内可能出现空值，用户报障形态复发）', file: 'js/avatar-lib.js', needle: "const to = String(name || store.get('cs-lbl-user') || '');" },
  // ==== 2026-09-16 #616k~n 昵称作用域收口（用户：「关于聊天昵称，因为变更多，只需要更换聊天里的
  //   昵称；其他功能里的昵称跟随设置里的桌面联系人昵称就行（并且昵称互动里需要小字说明）」）：
  //   18 个非聊天读点从「cs 优先」翻成「桌面优先、聊天兜底」。逐个哨兵不现实，这里守四个代表面：
  //   模板小字说明（用户点名要的）+ 通话/主页记录（易被漏的共用取名链）+ 此间（会持久化梦角名）。
  //   其余 14 处靠 verify-nick-interact 的 J 组行为断言兜（此间/Pong 两条真读 UI 的用例）。
  { name: '#616k 昵称池小字说明（删掉＝用户不知道其他功能跟的是桌面昵称，会在通话/游戏里找不到刚换的名字）', file: 'template.html', needle: '其他功能</b>显示的都是桌面昵称' },
  { name: '#616m 通话昵称改回桌面优先（改回 cs-lbl-partner 优先＝来电横幅/通话小框跟着昵称池一起变）', file: 'js/call.js', needle: "const nick = store.get('lbl-partner') || store.get('cs-lbl-partner')" },
  { name: '#616n 此间本尊名字漂移对齐目标改走桌面优先（改回 cs 优先＝自动播种的梦角名被昵称池轮换带着改；2026-09-18 收口换锚＝旧双行 needle 随缩进碎裂，改钉取值链首返单行）', file: 'js/cjian.js', needle: 'if (lb) return lb;' },
  { name: '#616p 小游戏伙伴名跟桌面昵称（Pong 代表；改回 cs 优先＝游戏里名字跟着聊天昵称频繁变）', file: 'js/pong.js', needle: "s.get('lbl-partner') || s.get('cs-lbl-partner')" },
  // ===== #611 开屏「其他说明与常见问题 / 四、全屏失效 / 八、系统预设字卡」移入 设置→关于→常见问题
  //   （用户要求开屏删除、内容搬到设置；开屏 notice.json 是线上生效源、template 为兜底，两处同删）=====
  { name: '#611a 关于段新增「常见问题」分组标题', file: 'template.html', needle: 'gs-title">常见问题' },
  { name: '#611b 常见问题 5 行入口（取末行 id 作锚）', file: 'template.html', needle: 'id="row-faq-preset"' },
  { name: '#611c 常见问题只读弹窗接线（删＝行点了没反应）', file: 'js/personalize.js', needle: "bind('row-faq-app'" },
  { name: '#611d 常见问题说明登记（删＝该组少「功能说明」胶囊、也搜不到）', file: 'js/settings-help.js', needle: "sel: '#row-faq-app'" },
  { name: '#611e 功能大全收录常见问题入口', file: 'js/feature-hub.js', needle: "go: ['#row-faq-preset']" },
  { name: '#611f 开屏不得再有「四、关于全屏模式失效」（已移入设置→关于→常见问题，absent）', file: 'template.html', needle: '【四、关于全屏模式失效】', absent: true },
  { name: '#611g 开屏不得再有「八、关于系统预设字卡和功能设置」（已移入设置→关于→常见问题，absent）', file: 'template.html', needle: '【八、关于系统预设字卡和功能设置】', absent: true },
  { name: '#611h notice.json 不得再有「全屏模式失效」章节（线上开屏生效源，absent）', file: 'pwa/notice.json', needle: '关于全屏模式失效', absent: true },
  { name: '#611i notice.json 不得再有「系统预设字卡和功能设置」章节（线上开屏生效源，absent）', file: 'pwa/notice.json', needle: '关于系统预设字卡和功能设置', absent: true },
  // ===== #615（2026-09-16）此间分组条「全部」总览固定居首 =====
  //   用户原话：「此间的【全部】应该放在第一个，目前是放在末尾，不好查看啊」。
  //   针写成「全部 chip + 其后的 contacts 循环」两行相邻（minifyJs 保行边界）；
  //   顺序被换回末尾时这两行不再相邻＝必红。只写 `chip('全部', ALL);` 拦不住顺序。
  { name: '#615 此间「全部」chip 排在 contacts 循环之前（换回末尾＝这两行相邻关系消失，报障复发）', file: 'js/cjian.js', needle: "chip('全部', ALL);\ncontacts().forEach(ct => chip(contactName(ct.id), ct.id));" },
  // ===== #618（2026-09-16）自检页「批量修复」按 hidden 显隐失效 =====
  //   根因：`.storage-clear{display:block}` 是作者样式，盖过 UA `[hidden]{display:none}`，
  //   `#card-audit-apply` 的 hidden 永远无效 → 未进批量模式「应用所选」也常驻可见，
  //   点它只提示「请先勾选要修复的项」，用户以为「批量修复没用」。needle 为补回 hidden
  //   语义的规则本身（删掉/改成 !important 之外写法即失效；minifyCss 后仍为唯一）。
  { name: '#618 `.storage-clear[hidden]` 补回 display:none（删掉＝作者 display:block 再次盖过 UA hidden，「应用所选」常驻、批量修复看着没用复发）', file: 'css/setting.css', needle: '.storage-clear[hidden] { display:none; }' },
  // ===== #620（2026-09-16）「TA在身边」位置面板底部「问 TA 一声『你在哪？』」点了要回聊天页 =====
  //   用户原话：「底部点击【问ta一声 你在哪】应该返回聊天页面啊」。旧实现只 chatSendMsg + toast，
  //   全屏位置面板不退（桌面寻踪页进入时 #page-chat 还隐藏着）＝看不到任何结果。
  //   两条 needle 都取逻辑表达式（都已确认在 js/p2-features.js 内唯一、不依赖缩进/注释，
  //   minifyJs 会删整行 // 注释与行首缩进）：①「不在聊天页就进聊天页」的判定行
  //   ② askWhere 里发完消息后的回页调用。整块 backToChatAfterAsk 被重写掉＝①消失。
  { name: '#620a 问 TA 一声后不在聊天页则进聊天页（删掉/改回只 toast＝用户报的「点了没反应」复发）', file: 'js/p2-features.js', needle: 'if (chatPage.hidden) { if (window.enterChat) window.enterChat(); return; }' },
  { name: '#620b askWhere 发完「你在哪？」立即回聊天页（删掉＝位置面板不退、聊天页仍隐藏）', file: 'js/p2-features.js', needle: 'backToChatAfterAsk();' },
  // ===== #621（2026-09-16）「我的拍一拍」输入框占位文字超出输入框 =====
  //   用户原话：「打开【拍一拍】页面的【我的拍一拍】，下方输入框里『输入拍一拍文字，
  //   如：拍了拍你的脸蛋』文字超出输入框了」。根因（无头 390×844 安卓实测）：mobile-adapt
  //   转出的 .ce-box 占位继承 white-space:pre-wrap，长占位（16px 自然宽约 272px）在约 155px
  //   的内宽里折成两行、撑出定高 40px 的框底（实测 clientH 39 / scrollH 49）。
  //   needle 取「选择器 + 单行截断三条声明」整块（缺任一条＝占位又会折行溢出，报障复发）；
  //   已确认该组合在 css/chat-main.css 内唯一、minifyCss 保行边界。
  { name: '#621 拍一拍输入框占位单行截断（删掉/改回 pre-wrap＝长占位折行溢出框底，用户报障复发）', file: 'css/chat-main.css', needle: '.poke-input.ce-box:empty::before {\ndisplay:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;' },
  // ===== #623（2026-09-16）查岗互动卡片作答弹窗默认选中「同意」侧 =====
  //   用户原话：「关于联系人发送的查岗互动卡片，和桌面查岗互动卡片，都没有默认是在【同意】
  //   的地方，我每次都要多点几遍」。两处弹窗各一条默认值：跨桌面查岗/求聊天（incoming-requests）
  //   与联系人查岗作答（ck-question openCkReply）；另两条锁同批修掉的「弹窗与卡面不同源」
  //   （meToTa 方向卡面是「要不要来查查我呀？」＋好呀/不要，弹窗此前拿原始题库题）。
  //   needle 全部取逻辑表达式（已确认各自在对应文件内唯一、不依赖缩进/注释，minifyJs 只去
  //   行首缩进与整行 // 注释，行边界保留）。
  { name: '#623a 跨桌面查岗/求聊天弹窗默认选中同意侧（删掉 pill 预设＝又要先点胶囊再点【确认】，用户报障复发）', file: 'js/incoming-requests.js', needle: "pill: req.kind === 'call' ? undefined : 'reply'" },
  { name: '#623b 查岗作答的同意侧标签表（删掉/改空＝affirmOptValue 恒 undefined，「默认选中同意」失效）', file: 'js/ck-question.js', needle: "const AFFIRM_LABELS = ['同意', '好呀', '好哒', '好啊', '好的', '好', '可以', '行', '接受', '要'];" },
  { name: '#623c 查岗作答弹窗预设同意侧胶囊（删掉＝互动动作/带同意选项的题又要点两下）', file: 'js/ck-question.js', needle: 'pill: isSingle ? affirmOptValue(optList) : undefined,' },
  { name: '#623d 跨桌面查岗卡传卡面给作答弹窗（删掉＝meToTa 方向弹窗又弹出另一道题，选项也对不上）', file: 'js/ck-question.js', needle: 'openCkReply(msgIdx, q, isDeskCk ? deskCkCard : null);' },
  { name: '#623e 作答弹窗按卡面取选项（改回一律用原始题 q.options＝#623d 的传参形同虚设）', file: 'js/ck-question.js', needle: 'const optList = isDeskCard ? (Array.isArray(deskCard.opts) && deskCard.opts.length ? deskCard.opts : null)' },
  // ===== #625（2026-09-16）提问记录「在联系人桌面发生的记录切回主页看不到」=====
  //   用户原话：「联系人提的问题和吐槽都不能在主页的【提问记录】里同步更新；主页里的记录
  //   也没能同步更新」（RedmiNote12Turbo/Chrome，其他机型同报）。零机型分支的纯逻辑缺口：
  //   记录按设计写在【发生所在联系人桌面】，而 5 个分类里只有「TA的询问」做了跨桌面汇总，
  //   小问题/好奇/吐槽/邀请·问问 仍 `tcLoad().history` 一类只读当前桌面命名空间 ⇒ 切回主页全空。
  //   needle 取「该分类改走汇总」的那一行赋值 + 汇总/清空/回退的逻辑表达式（各自在
  //   js/ta-ask.js 内唯一、不依赖缩进；minifyJs 只去行首缩进与整行注释，行边界保留）。
  { name: '#625a 小问题记录改走跨桌面汇总（改回 tcLoad().history＝在联系人桌面答的小问题切回主页又看不到，用户报障复发）', file: 'js/ta-ask.js', needle: 'const h = allDeskHistories(KEY2);' },
  { name: '#625b 好奇记录改走跨桌面汇总（改回 tcuLoad().history＝同上复发）', file: 'js/ta-ask.js', needle: 'const h = allDeskHistories(KEY3);' },
  { name: '#625c 吐槽记录改走跨桌面汇总（改回 trLoad().history＝用户点名的「吐槽不同步」复发）', file: 'js/ta-ask.js', needle: 'const h = allDeskHistories(KEY4);' },
  { name: '#625d 邀请/问问记录改走跨桌面汇总（改回裸 store.get＝在联系人桌面发出的邀请切回主页看不到）', file: 'js/ta-ask.js', needle: "const h = allDeskHistories('invite-ask-history');" },
  { name: '#625e 多桌面合并后按时间倒序（改回 slice().reverse()＝各桌记录成块拼接、时间倒错）', file: 'js/ta-ask.js', needle: 'out.sort(function (a, b) { return (Number(b && b.ts) || 0) - (Number(a && a.ts) || 0); });' },
  { name: '#625f 清空按钮同口径清全桌面（改回只清当前桌面＝列表里的别桌记录清不掉，清了个寂寞）', file: 'js/ta-ask.js', needle: 'clearDeskHistories(key);' },
  { name: '#625g default 桌面老档回退（删掉＝未迁移用户的 default 记录在别的桌面看是空的）', file: 'js/ta-ask.js', needle: "const ns = window.xyStore(GNS + ':default').get(key);" },
  { name: '#625h 「TA的询问」跨桌面汇总不被本批重写带掉（改回 taAskLoad().history＝最早的 #489 同族缺口复活）', file: 'js/ta-ask.js', needle: "const h = allDeskHistories('ta-ask');" },
  // ===== #624（2026-09-16）聊天「一条消息两张图」：TA 表情包/图片概率独立判定 + 多图记录不被折叠 =====
  //   用户原话：「为什么我无法触发，联系人给我发的一条消息里有两个图片，字卡库的公用字卡和
  //   专属字卡里的【表情包】或【图片】」＋「聊天里一条消息里我和联系人都可以发送多个图片」（要求
  //   补使用说明、且不要覆盖修改引发跨机型回归）。零机型、零 UA 分支，纯概率/渲染逻辑。
  //   ①genReplyText 两条概率独立（都命中＝1 表情包 + 1 图片同一条）；②genOneReply 直传 parts；
  //   ③normCell/migrateLegacy 遇 parts ≥2 张图不再把 text 升级成 type:'image'（否则刷新后
  //   渲染走单图分支只剩一张）；④periodWarmText / genChatStyleReply 不把图片载荷当文本改写/返回。
  //   needle 均为逻辑表达式，各自在所属 src 文件内唯一（minifyJs 去行首缩进，行内空格保留）。
  { name: '#624a 多图消息守卫函数（删掉＝parts≥2 张图的 text 载荷被升级成 type:image，刷新后第二张起丢失）', file: 'js/chat.js', needle: 'function hasMultiImgParts(r) {' },
  { name: '#624b normCell 升级单图前先排除多图消息（删掉 !hasMultiImgParts(r)＝同 #624a 复发。#943 起媒体判定收口 chatIsImgSrcLike、锚点随新写法）', file: 'js/chat.js', needle: 'if ((r.type === \'text\' || !r.type) && !hasMultiImgParts(r) && typeof r.text === \'string\' && chatIsImgSrcLike(r.text))' },
  { name: '#624c 表情包/图片概率独立判定·两者同命中同条消息两张图（改回 else if 互斥＝用户「无法触发两个图片」复发）', file: 'js/chat.js', needle: 'if (stHit && imHit) {' },
  { name: '#624d genOneReply 直传多图 parts（删掉＝被默认字卡覆盖换文本、或在下方单图追加处再叠一张）', file: 'js/chat.js', needle: "if (r.parts && r.parts.length) return { text: t, type: 'text', parts: r.parts };" },
  { name: '#624e 多图消息不经经期温柔语态改写（删掉＝给图片载荷 text 加前后缀，横幅/引用文本变乱）', file: 'js/chat.js', needle: "rep.text.indexOf('data:') !== 0 && window.periodWarmText" },
  { name: '#624f genChatStyleReply 不把媒体载荷当聊天字卡文本返回 ta-ask（删掉＝ta-ask 把 data: 串当文本发出。#943 起守卫从「仅多图形态」扩为 _isMediaRep 全形态判定，锚点随新写法、语义只强不弱）', file: 'js/chat.js', needle: 'return (t && !_isMediaRep) ? t : null;' },
  { name: '#624g 功能介绍补「一条消息多张图，我和 TA 都可以」（删掉＝使用说明缺这条能力，用户报「说明里也缺少」）', file: 'template.html', needle: '一条消息还能放多张图' },
  { name: '#624h 使用说明补「可一次选多张，同一条消息一起发出」+ TA 两图触发说明（删掉＝使用说明缺多图）', file: 'template.html', needle: '可一次选多张，同一条消息里一起发出' },
  { name: '#624i 功能大全「表情包管理」补多图关键词（删掉＝搜「多图 / 多个图片」搜不到）', file: 'js/feature-hub.js', needle: '图片/表情可一条消息发多张' },
  // ===== #626（2026-09-16）寻踪「更新了一条日常」系统消息改名后同 ts 变两条（用户：同会话不刷新就出现 2 条）=====
  //   根因：该消息正文内嵌联系人昵称；改昵称时 sysNickSweepMsgs 只清扫 msgs（并落盘），
  //   chat-tail 兜底日志仍是旧名 ⇒ 下次 chatTailMerge 按 ts|side|正文 签名判不出同一条，
  //   把旧名那条当「未落盘新消息」补回 ⇒ 同 ts 两条、文字不同又永远合不掉。
  //   修复：凡清扫 msgs 的 oldName，同步清扫 chat-tail。needle 均为逻辑入口/调用，各自唯一。
  { name: '#626a 尾巴日志昵称清扫唯一入口（删掉＝改名后 chat-tail 留旧名，重载補回重复一条；#775c 起带 slot 形参＝签名演进，逻辑未动）', file: 'js/chat.js', needle: 'function chatTailSweepNick(oldName, slot) {' },
  { name: '#626b 改名钩子接尾巴清扫（删掉＝当前会话改名后尾巴日志不同步，重复复发；#775c 带 slot＝签名演进）', file: 'js/chat.js', needle: 'try { chatTailSweepNick(oldName, slot); }' },
  { name: '#626c 惰性补扫·最近旧名分支同步清尾巴（删掉＝重启后补扫不清尾巴，重载補回重复；#775c 按槽位补扫＝签名演进）', file: 'js/chat.js', needle: 'chatTailSweepNick(hist[hist.length - 1], slotKey)' },
  { name: '#626d 惰性补扫·历次旧名循环同步清尾巴（删掉＝备份导入等绕过钩子的改名仍留重复；#775c 按槽位补扫＝签名演进）', file: 'js/chat.js', needle: 'chatTailSweepNick(hist[i], slotKey)' },
  { name: '#775e 聊天设置·联系人昵称改名基线取实际显示名（改回只读 cs-lbl-partner＝旧名片名扫不掉，历史拍一拍停在旧名片名）', file: 'js/chat-settings.js', needle: "const oldEff = window.chatPartnerName ? window.chatPartnerName() : (store.get('cs-lbl-partner') || 'TA');" },
  { name: '#775c2 聊天设置·我的昵称接 me 槽改名钩子（删掉这行＝改了「我的昵称」后聊天里的拍一拍仍旧名）', file: 'js/chat-settings.js', needle: "if (oldEff !== (val || '我')) {" },
  { name: '#775c3 昵称池换「我的昵称」同走 me 槽钩子（删掉＝点昵称池改名后历史不跟随，与聊天设置那条路径不一致）', file: 'js/avatar-lib.js', needle: "const newEff = store.get('cs-lbl-user') || '我';" },
  { name: '#775f 名片改名的聊天有效名基线走显示链（含名片名；改回掺桌面 lbl-partner＝只改名片时既不记 hist 也不清扫）', file: 'js/contacts.js', needle: 'const oldEff = csLbl || oldName || taWordId;' },
  { name: '#775a 聊天联系人昵称取名链含联系人名片名回退（删掉这一环＝只在联系人管理里改过名的用户顶栏跟着变、拍一拍/系统消息仍显示 TA；多设备表现不一致取决于该设备设过没设 cs-lbl-partner）', file: 'js/chat.js', needle: "const cn = window.contactNameFor ? window.contactNameFor(window.__activeCid || 'default') : '';" },
  { name: '#775b 同窗补丁的昵称签名作废（删掉这行＝改了昵称后重进聊天走原地补丁不重画文字，屏上永远停在旧昵称，刷新才恢复）', file: 'js/chat.js', needle: 'if (windowRenderedNicks !== chatNickSig()) return false;' },
  { name: '#775c 昵称清扫表的 me 槽（删掉＝「我的昵称」改名后历史里字面写死的旧名永不跟随，只有 {ta} 侧会扫）', file: 'js/chat.js', needle: "me: { cur: chatUserName, token: '{me}', histKey: 'sysmsg-user-nick-hist', sweptKey: 'sysmsg-user-nick-swept' }" },
  { name: '#775d 改名时聊天页不可见改为原位刷新昵称节点（改回只在可见时重渲＝聊天设置里改名后点返回按钮，屏上拍一拍仍是旧名）', file: 'js/chat.js', needle: 'try { if (chatVisible()) renderWindow(true); else refreshNickNodesInPlace(); } catch (e) {}' },
  { name: '#775g 联系人名片改名后顶栏按同链重取（删掉监听＝名片改名回聊天顶栏仍是旧名）', file: 'js/chat.js', needle: "document.addEventListener('contact-renamed', function () { try { updateChatPartnerName(); } catch (e) {} });" },
  // ===== #627（2026-09-16 用户实报）信息诊断「本来就没错误为什么显示红点」：错误环把浏览器
  //   对非同源脚本的统一遮罩文案 "Script error."（无栈）也收进来 → 角标常亮假报障。本应用
  //   全内联同源，真错误必带真实 message+stack，故无栈遮罩可安全放行。needle 均为逻辑锚
  //   （非函数名），各自在 device.js 唯一：删任一处即对应回归。
  { name: '#627a 跨域遮罩无栈错误放行（删掉＝系统/输入法注入脚本的 "Script error." 又进错误环，红点假报障复发）', file: 'js/device.js', needle: '!st && /^Script error' },
  { name: '#627b 遮罩条目识别器（删掉＝readErrs/purge 无从判历史残留条目，升级后旧红点清不掉）', file: 'js/device.js', needle: '!it.stack && /^Script error' },
  { name: '#627c 启动清历史遗留遮罩条目（删掉＝升级前已入环的 "Script error." 常亮角标，用户仍困惑）', file: 'js/device.js', needle: 'kept = o.filter(function (it) { return !isOpaqueScriptErr(it); })' },
  // ===== #628（2026-09-16 用户实报）「上传字体，无法应用到全部桌面」：字体按桌面各存各的
  //   （per-cid，与壁纸/气泡一致），缺的是「一键推给其它桌面」——面板新增「同步到全部桌面」
  //   按钮 + 实现 syncFontAllDesks（两个入口都有，实现只有一份在 chat-settings.js）；另把
  //   中间版（曾把字体改成根键全局单值）的残留根键回填给各桌面后删掉。needle 均为逻辑锚。
  { name: '#628a 字体面板有「同步到全部桌面」按钮（删掉＝用户报障原样复发：字体只能在当前桌面用）', file: 'js/chat-settings.js', needle: '同步到全部桌面</button>' },
  { name: '#628b 同步实现把当前桌面字体写到其它每个桌面（删/改＝按钮成死键或只写一半桌面）', file: 'js/chat-settings.js', needle: 'others.forEach((id) => { try { window.storeFor(id).set(FONT_KEY, v); n++; } catch (e) {} });' },
  { name: '#628c 同步入口暴露给桌面美化页复用（删掉＝设置→外观→全局字体 那颗按钮没反应）', file: 'js/chat-settings.js', needle: 'window.csFontSyncAllDesks = syncFontAllDesks;' },
  { name: '#628d 中间版根键残留回填各桌面后删除（删掉＝用过中间版的用户只剩 default 桌面有字体）', file: 'js/chat-settings.js', needle: "try { window.xyStore('xy-home-v2').remove(FONT_KEY); } catch (e) {}" },
  { name: '#628e 字体注入·同值不重复（删掉＝每次切桌面重建整个 MB 级 @font-face 字符串，安卓/iOS 切换发卡）', file: 'js/chat-settings.js', needle: 'if (old && old.__fontVal === v) return;' },
  { name: '#628f 全局字体键排除迁移（防 migrateLegacy 把中间版残留根键迁进 default 并删根键）', file: 'js/contacts.js', needle: "'cs-font'," },
  { name: '#628g 大值写入清掉同一键的旧小值日志条目（删掉＝先填字体名后上传字体，重进被回放成上次的字体名）', file: 'js/idb.js', needle: 'if (typeof v === \'string\' && v.length > WRJ_VAL_LIMIT) { wrjForget(key); return; }' },
  { name: '#628h 桌面美化入口的同步按钮接线（删掉＝该入口面板里的同步按钮点了没反应）', file: 'js/personalize.js', needle: 'if (window.csFontSyncAllDesks) window.csFontSyncAllDesks();' },
  // ==== 2026-09-16 #636 表情包面板【颜文字】【emoji】分类 + 我的文字库 + 设置两隐藏开关（新功能防覆盖锚：
  //      分类行/文字网格被并行重写抹掉＝面板回到只有表情包三 tab；两开关被删＝分类无法隐藏）====
  { name: '#636a 面板文字分类渲染入口（颜文字/emoji 清列表后走文字网格并截断图片路径；删/改＝新分类空白或误走图片网格）', file: 'js/chat.js', needle: "emojiList.innerHTML = '';\nrenderEmojiTextPanel(rec);\nreturn;" },
  { name: '#636b 设置「隐藏颜文字/隐藏emoji」两开关（删/改＝分类无法隐藏，读键分支失效）', file: 'js/chat-settings.js', needle: "['hide-tab-kaomoji', '隐藏颜文字'" },
  // ===== #642/#643（2026-09-16 用户实报，iPhone 17 Pro Edge 等多机型，要求勿致跨机型回归）
  //   #642「点消息弹出的引用/操作条乱跑，飞到离气泡很远的地方」＝操作条 fixed 只定位一次，
  //     键盘开合动画 / Edge iOS vv 平移 / 贴底滚动 / 图片撑高后留在原地；修复＝
  //     window.mochiFollowActionBar 跟随锚点（单聊 chat.js + 群聊 group-chat.js 共用）。
  //   #643「发消息后消息和屏幕都上移、最新消息跑到屏幕上半部分」＝键盘收起恢复 .phone 高度后
  //     无人回钉（#466 只挂 vv resize，iOS 漏派发/时序竞态）；修复＝chat-body 盒尺寸
  //     ResizeObserver 回钉（仍受 chatPinnedBottom 闸约束，#162 契约不变）。
  { name: '#642a 操作条跟随锚点助手（删掉＝键盘开合/视口平移/贴底滚动后操作条留在原地乱跑）', file: 'js/chat.js', needle: 'window.mochiFollowActionBar = function (bar, anchor, onClose) {' },
  { name: '#642b 操作条定位误差自校正（删掉＝内核 fixed 包含块语义差异时一次定位即偏）', file: 'js/chat.js', needle: 'const _maDx = x - m.left, _maDy = y - m.top;' },
  { name: '#642c 群聊操作条接入同一跟随助手（删掉＝群聊操作条乱跑复发）', file: 'js/group-chat.js', needle: 'window.mochiFollowActionBar(gcMsgActions, bk, closeGcMsgActions)' },
  { name: '#643a chat-body 盒尺寸 ResizeObserver 接线（删掉＝键盘收起恢复高度后最新消息悬半屏无人回钉）', file: 'js/chat.js', needle: "if (!cb643 || typeof ResizeObserver === 'undefined') return;" },
  { name: '#643b 盒子真变高后按钉住闸回钉贴底（删掉＝#643 只观察不动作，半屏残留照旧；#868 起该动作在 chatRepinStep 里）', file: 'js/chat.js', needle: 'if (cb868 && chatScrollMax() - cb868.scrollTop > 8) scrollChatBottom();' },
  // v3.26.x #645：通知栏媒体卡此前只有播放/暂停/上下首（用户反馈「没有下一首等功能按钮」）。
  // 任务号原认领 #644，与并行会话（摸鱼天数批 / 逐卡连发翻案批的 #644a/b）撞号，改 #645
  { name: '#645a 音乐通知栏 seekto 拖动定位接线（删掉＝媒体卡没有进度基准拖不动，快进快退/划掉停止的收尾也一并丢失）', file: 'js/music-player.js', needle: "setActionHandler('seekto', function (d)" },
  // ===== #661（2026-09-17 用户直派）「开屏偶尔卡顿要让用户知道为什么，用户总以为卡顿是 bug」：
  //   ① 公告独立成章「开屏偶尔慢一下，是正常的（不是 bug）」，摆在**公告目录第一位**（默认展开）
  //      ＋ 必读摘要补一条高亮——用户明确要求「不用写在 bug 公告里，单独写、放显眼的地方」，
  //      故 #661a/#661b 锚「独立章」、#661d/#661e 锚「摘要高亮条」（位置本身要能拦回归：
  //      被挪回 Bug 章 / 从摘要删掉都算违背需求）；
  //   ② 等得较久时在加载提示下就地补一行原因（clock.js 门控 + base.css 样式），
  //      不必让用户翻公告章节。
  //   在线权威源（notice.json，联网用户看到）与离线兜底（template.html，断网/弱网看到）双份同步，
  //   故同一句文案两份文件都有——template 侧 needle 一律带 HTML 包裹以避开「共用锚点」哑哨兵。
  //   编号说明：#657（夜间模式说明）/ #658（输入栏按钮批）/ #659（夜间模式功能说明）已先后被并行
  //   会话占用（同日多会话并发），本批写入时取当时最大号 +1＝#661；查编号以「锚名 + 文件」为准。
  { name: '#661a 开屏慢≠bug 独立成章·在线权威源（删掉＝联网用户看不到这章，又把开屏等待当 bug 报）', file: 'pwa/notice.json', needle: '"开屏偶尔慢一下，是正常的（不是 bug）"' },
  { name: '#661b 开屏慢≠bug 独立成章·离线兜底（删掉＝断网/弱网用户看不到这章）', file: 'template.html', needle: '<p class="splash-sec">开屏偶尔慢一下，是正常的（不是 bug）</p>' },
  { name: '#661d 开屏慢≠bug 进必读摘要高亮·离线兜底（删掉＝不点章节就看不到，回到「藏在章里」的老问题）', file: 'template.html', needle: '<p class="splash-hl">开屏 / 打开时偶尔慢几秒是正常的，不是 bug' },
  { name: '#661e 开屏慢≠bug 进必读摘要高亮·在线权威源（删掉＝联网用户摘要里少这条，用户要求「放显眼的地方」落空）', file: 'pwa/notice.json', needle: '"hl": "开屏 / 打开时偶尔慢几秒是正常的，不是 bug' },
  { name: '#661c 开屏等得较久时就地解释原因（删掉/改判据＝只剩「数据较多，仍在加载…」，用户依旧不知道这是正常等待）', file: 'js/clock.js', needle: 'loadingSubEl.hidden = !(loadingShown && ((!ready() && slow) || (r && !loaded())));' },
  // ===== #660（2026-09-17 用户直派）聊天设置新增「输入栏按钮位置」——统一管理底部输入栏
  //   这一排的左右顺序（含开关型的 录音/继续说/批量发送 与 输入框本身；发送固定最右）。
  //   位置与显隐是两套独立配置：开关只管显不显示、本项只管排在哪里，互不覆盖。
  //   needle 全取逻辑锚（令牌表 / flex order 落点 / 改完即时重排的接线 / 面板写回存档），
  //   而不是函数名——名字能被保留、实现被改掉，只有逻辑锚拦得住。
  //   编号说明：#658 已被并行会话（开屏卡顿说明）占用、#659 亦被占用，本批取 #660。
  { name: '#660a 输入栏令牌表（删掉/改名＝两处输入栏的按钮丢掉排序身份，面板排的序落不到按钮上）', file: 'js/chat.js', needle: "const INPUT_IO_TOKENS = ['mic', 'continue', 'more', 'emoji', 'input', 'img', 'batch'];" },
  { name: '#660b 顺序落在 flex order 上（删掉/改回不动 DOM＝设置里排的顺序完全不起作用，回归「按钮位置无法自定义」）', file: 'js/chat.js', needle: 'el.style.order = String(INPUT_IO_ORDER_BASE + (i < 0 ? items.length : i) * 10);' },
  { name: '#660c 改完即时重排接线（删掉＝面板里点 ←→ 后输入栏纹丝不动，要切页面/刷新才看到）', file: 'js/chat.js', needle: "document.addEventListener('chat-input-order-changed', applyInputBtnOrder);" },
  { name: '#660d 排序面板落盘（删掉/改直写＝面板里调整的顺序不写入 cs-input-order，切联系人/刷新即丢）', file: 'js/chat-settings.js', needle: 'window.mochiInputOrder.write(order);' },
  // #660附：本批实测暴露的旧 bug（非本批引入，旧产物实测复现）——「回复设置 → 聊天栏继续说按钮」
  //   开着时，聊天输入栏的「继续说」按钮冷启动后不显示，要切一次联系人或再动一次开关才出现
  //   （chat.js 先于 reply-settings.js 执行，首次计算时 replyCfg 还没定义 → 恒判为关）。
  //   修复＝数据就绪（回填完成）后把三个开关型按钮显隐统一补算一次。needle 取三行补算体
  //   （chat.js 内唯一），删掉/改哑即回归「开关开着却不显示」。
  { name: '#660f 数据就绪后补算输入栏三个开关按钮显隐（删掉＝「继续说」开关开着、冷启动后按钮却要切一次联系人才出现）', file: 'js/chat.js', needle: 'try { syncMicBtn(); } catch (e) {}\ntry { syncBatchBtn(); } catch (e) {}\ntry { if (window.applyContinueSayUI) window.applyContinueSayUI(); } catch (e) {}' },
  { name: '#660e 输入栏按钮排序面板锚点+入口（删掉＝聊天设置里没有「输入栏按钮位置」这一行，功能无入口）', file: 'template.html', needle: '自定义底部输入栏这一排图标的左右顺序' },
  // ===== #662（2026-09-17 用户直派）表情包面板 / 头像互动「图片闪一下重新加载」第四轮
  //   （红米 K80 Chrome 等多机型，用户明说其他设备型号也有；前三轮 #457 / #508-#509 / #617
  //   分别收口了「同内容连开」「字卡库整格重建」「池键随令牌形态翻转」，本轮收口它们共同漏掉的
  //   第 4 条：只要内容签名一变（切分组 A→B→A、切分类、令牌化翻转、IDB 回填后重渲）仍整格
  //   innerHTML 重建＝已解码 img 被整批丢弃、浏览器从零重新解析每个 dataURL）＋ 第 5 条：
  //   半框 display:none 期间浏览器回收已解码位图、再打开整格重新解码（**节点身份测不出这条**，
  //   前三轮的断言都只看节点有没有被替换，所以它连躲四轮）。
  //   needle 全取逻辑锚（回收池取回点 / 重写前回收的接线 / 令牌稳定身份 / 显示前预解码），
  //   不取函数名——名字能被保留、实现被改掉，只有逻辑锚拦得住。
  //   锚名 #662 与 WORKLOG/台账一致；同批 verify＝tools/verify-panel-img-reuse.mjs。
  { name: '#662a 面板重建走回收池取回旧节点（删掉/改回无条件新建＝切分组回来时已解码图整批重新解码，回归「一闪+重新加载」）', file: 'js/chat.js', needle: 'const img = emojiAdoptImg(src);' },
  { name: '#662b 整格重写前统一回收旧 img（删掉＝重建时节点成孤儿、池永远取不到，回收池形同虚设）', file: 'js/chat.js', needle: 'set: function (v) { emojiPoolHarvest(); _emojiIH.set.call(this, v); },' },
  { name: '#662c 池身份走令牌稳定身份（改回按原文算键＝令牌化翻转后同图换身份、池 miss，退化成整批新建）', file: 'js/chat.js', needle: 'if (window.ccMediaCardIdent) return window.ccMediaCardIdent(src);' },
  { name: '#662d 打开面板前先解码再显示（删掉＝位图被浏览器回收的机型上重开面板照旧整格重新解码/逐个冒出）', file: 'js/chat.js', needle: 'if (token !== undefined && token !== emojiShowToken) return;' },
  { name: '#662e 头像互动半框显示前同样先解码（删掉＝头像库那一格图片重开照旧闪一下）', file: 'js/avatar-lib.js', needle: 'if (token !== undefined && token !== avShowToken) return;' },
  { name: '#662f 新头像落列前离屏预热解码（删掉＝换一次头像时顶栏+整列气泡头像各自等解码，低端机「一个个换/闪一下」）', file: 'js/avatar-lib.js', needle: 'const _warm = new Image();' },
  // ===== #663（2026-09-17 用户直派）「TA 把商品放进清单时有概率发到聊天，让我给 TA 买」：
  //   心意集市侧 TA 把商品加进【自己的心愿单】那一刻，按「TA 的心愿发到聊天」开关 + 概率
  //   （默认开、默认 60%）发一张 special:'wish' 卡片进聊天；卡片【送 TA】复用市集购买链路
  //   （扣我的余额、礼物进聊天 + 心意柜-送出的、TA 心愿单自动移除），成交后卡片就地转「已送出」。
  //   待买/已送出不写进记录，由聊天渲染时按 TA 心愿单实时数据判定（giftTaWishHas）。
  //   needle 全取逻辑锚（概率判定行 / 默认值 / 面板两行 / 发卡与购买入口 / 渲染分支与点击接线），
  //   不取函数名——名字能留、实现能改，只有逻辑锚拦得住。
  //   编号说明：#660（输入栏按钮位置）、#661（开屏慢≠bug 说明）、#667（面板图片复用）已先后被
  //   并行会话占用，本批取 #663；查编号以「锚名 + 文件」为准。
  //   行为断言 tools/verify-wish-chat-card.mjs（53/53；RED 基线 31 条红，含切桌面缓存串号）。
  { name: '#663a ③ 加心愿那一瞬按开关+概率发卡（删/改回纯 toast＝TA 的心愿永远发不到聊天，功能等于没做）', file: 'js/gift-shop.js', needle: 'const pushed = !!(st.wishChatOn && Math.random() * 100 < st.wishChatPct && wishChatPush(giftW));' },
  { name: '#663b 「TA 的心愿发到聊天」默认开启（改回默认关＝没人去设置里开就永远收不到，用户明确要求默认开）', file: 'js/gift-shop.js', needle: 'wishChatOn: s.wishChatOn === 0 ? 0 : 1' },
  { name: '#663c 默认概率 60 从设置读（删/改硬编码＝设置页里的概率是摆设）', file: 'js/gift-shop.js', needle: 'wishChatPct: clampPct(s.wishChatPct, 60)' },
  { name: '#663d 设置面板「TA 的心愿发到聊天」开关行（删＝关不掉，TA 会一直往聊天发心愿）', file: 'js/gift-shop.js', needle: 'data-gsw="wishChatOn"' },
  { name: '#663e 设置面板「TA 心愿发到聊天概率」行（删＝概率无处可调、用户看不到当前是多少）', file: 'js/gift-shop.js', needle: 'data-gsn="wishChatPct"' },
  { name: '#663f 卡片【送 TA】入口（删＝聊天卡片上的按钮点了没反应）', file: 'js/gift-shop.js', needle: 'window.giftBuyFromWishCard = function (rec, done) {' },
  { name: '#663g TA 心愿 id 缓存按桌面打标（删＝切联系人后心愿卡待买/已送出误判，市集「☆ TA许愿的」角标也串桌面）', file: 'js/gift-shop.js', needle: '_taWishIdsFor !== tag' },
  { name: '#663h 聊天里 TA 心愿卡的渲染分支（删＝聊天里只剩空气泡，TA 的心愿看不见）', file: 'js/chat.js', needle: 'const wStill = !window.giftTaWishHas || window.giftTaWishHas(rec.wishGiftId);' },
  { name: '#663i 【送 TA】点击接线（删＝点按钮打不开购买弹窗）', file: 'js/chat.js', needle: 'window.giftBuyFromWishCard(wRec, function () {' },
  { name: '#663j 成交后卡片就地转「已送出」（删＝买完卡片还挂着【送 TA】，看着像没生效、还可能被重复买）', file: 'js/chat.js', needle: "wItem.querySelector('.msg-wish-acts')" },
  { name: '#663k TA 心愿卡并入「值得提醒」消息（删＝心愿只静静躺在聊天里，未读角标与桌面横幅都不提）', file: 'js/chat.js', needle: "rec.special === 'gift' || rec.special === 'wish'" },
  { name: '#663l 收藏快照覆盖心愿卡（删＝卡片心形点了没反应，同 #v3.28.x 那批漏网）', file: 'js/chat.js', needle: "else if (special === 'wish') { q = (rec.wishGiftName" },
  { name: '#663m 心愿卡按钮样式（删＝【送 TA】退化成浏览器默认按钮）', file: 'css/market.css', needle: '.msg-wish-buy {' },
  { name: '#663n 心愿卡深色适配（删＝深色下标签/已送出小字对比度不足）', file: 'css/market.css', needle: '[data-theme="dark"] .msg-wish-tag' },
  { name: '#663o 功能介绍页补这条（删＝用户在功能列表里找不到这条能力）', file: 'template.html', needle: '并按概率把这份心愿发一张卡片到聊天' },
  // #664（本会话，跨域登记 build.mjs）：iOS 发消息时输入栏「弹跳一下」——清空管线的
  // 焦点判据在 iOS 上恒假（activeElement 报 body）→ 走迟到写回路径。needle 取判据
  // 表达式本体（逻辑锚点：改回只看 activeElement 即消失），js/chat.js 内唯一。
  { name: '#664a 清空管线焦点判据走能力信号（删/改回只看 activeElement＝iOS 迟到写回复发）', file: 'js/chat.js', needle: 'return document.activeElement === input || inputFocused;' },
  { name: '#664b 聚焦态清空经 inputStillFocused 判定（删＝回到恒假的直写分支）', file: 'js/chat.js', needle: 'if (input.isContentEditable && inputStillFocused()) {' },
  { name: '#664c 迟到写回首查提前到 60ms（删＝复活窗口回到 ~200ms，输入栏仍可见地弹一下）', file: 'js/chat.js', needle: '[60, 200, 800].forEach((ms) => {' },
  // ===== #665（2026-09-17 用户直派，红米K70 Chrome 等多机型）朋友圈贴纸「有时能看到、有时看不到」=====
  // 根因：贴纸/大表情包在字卡库池视图里是 @@m: 令牌（#377/#455/#554），渲染要从媒体池读回真身；
  //   而 idbGet 的 undefined 既可能是「键不存在」也可能是「事务挂起超时/连接丢失」（安卓内核实录），
  //   旧实现一律当确认缺失 → ①那张图不再重试、留成坏图 ②mochiMediaTokenMissing 置位后 isMediaImg
  //   把该令牌卡整条剔出 getMediaGroups('sticker')＝朋友圈贴纸列表里这张直接消失。
  // 编号说明：#660~#664 已先后被并行批占用（输入栏按钮位置 / 开屏慢说明 / 面板图片复用等），本批按
  //   #600/#640 先例跳号取 #665；build.mjs 里 #186 哨兵注释提到的「#660 朋友圈配图/贴纸令牌」即本批。
  { name: '#665a idbGet 可选 info 参数（删/改回单参＝池侧再也分不出「读失败」与「键不存在」，拉黑复发）', file: 'js/idb.js', needle: 'window.idbGet = function (key, info) {' },
  { name: '#665b 读失败（重开连接也失败）置歧义标记（删＝超时被当确认缺失，条目其实在池里却被拉黑）', file: 'js/idb.js', needle: '.catch(() => { amb(); return undefined; })' },
  { name: '#665c 连接丢失/事务抛错同样置歧义（删＝connLost 路径又变成「确认没有」）', file: 'js/idb.js', needle: 'req.onerror = () => { if (connLost(req.error)) dbPromise = null; amb(); finish(undefined); };' },
  { name: '#665d 池侧读失败不拉黑（删/改回 missing.add＝贴纸从面板整条消失、坏图不自愈，报障复发）', file: 'js/media-pool.js', needle: 'if (info.ambiguous) { softMissImg(img, h); return; }' },
  { name: '#665d 读失败重试预算（删掉＝要么不重试（坏图不自愈）要么无限重试（读槽被饿死，#450 族））', file: 'js/media-pool.js', needle: 'const SOFT_RETRY_MS = [1200, 4000, 10000];' },
  { name: '#665e 确认缺失的「图片缺失」占位真能落地（slice.call(Set) 恒空＝#402 占位从未生效，坏图照发 404）', file: 'js/media-pool.js', needle: 'const list = Array.from(markQueue); markQueue.clear();' },
  { name: '#665f GC 引用面含朋友圈（删＝只被朋友圈动态引用的贴纸令牌被当孤儿删掉，照片上贴纸永久缺失）', file: 'js/media-pool.js', needle: 'const REFS = /(?:^|:)(?:chat-msgs|chat-blk-idx|chat-blk-[0-9]+|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail|cc-groups(?:-public)?|feed-posts(?:-snap)?|chat-arch)$/;\nconst refKeys = keys.filter(function (k) { return REFS.test(String(k)); });\ntry {\nfor (let li = 0; li < localStorage.length; li++) {' },
  { name: '#665f Coverage 引用面同口径含朋友圈（GC/Coverage 两处必须同步，漏一处＝统计与体检口径不一致）', file: 'js/media-pool.js', needle: 'const REFS = /(?:^|:)(?:chat-msgs|chat-blk-idx|chat-blk-[0-9]+|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail|cc-groups(?:-public)?|feed-posts(?:-snap)?|chat-arch)$/;\nconst SCAN_RE = /@@m:([0-9a-f]{32})/g;' },
  // ===== #666（2026-09-17 用户直派）表情包面板 emoji 分类「一行四个，但中间的两个没有线分开，缺一条线」=====
  // 根因（纯 CSS 优先级、零 JS）：emoji 子分类的网格由 chat.js renderEmojiTextGroup 同时挂
  //   .emoji-grid-text（文字 2 列网格样式）与 .emoji-grid-emoji；那条为 2 列文字网格写的
  //   「.emoji-item:nth-child(2n) 去右线」特异性 (0,3,0) 高于基础 .emoji-item:nth-child(4n)
  //   (0,2,0)，于是在 4 列 emoji 网格里第 2 格的右线（＝中间两格之间的竖线）也被摘掉。
  // needle 取收窄后的选择器本体（逻辑锚点：改回不带 :not() 的裸 2n 即消失），css/chat-main.css 内唯一。
  { name: '#666a 去右线规则排除 emoji 4 列网格（删/改回裸 2n＝一行四格中间缺一条竖线，用户报障复发）', file: 'css/chat-main.css', needle: '.emoji-grid-text:not(.emoji-grid-emoji) .emoji-item:nth-child(2n) { border-right:none; }' },
  // ===== #668（2026-09-17 用户直派）各功能数据 单独导出/导入/清空（设置 → 工具 → 各功能数据管理）=====
  //   编号说明：#667 已被并行批占用（朋友圈剥图/媒体池判据），本批取 #668。
  // 这是「删数据」的功能，误伤面比其它功能大，四条锚点守的都是数据安全底线：
  //   a 共享资源池（媒体池 @@m: 令牌指向的图片/语音、上传字体包）不归属任何功能——一旦被
  //     某个功能认领，清空该功能就会顺手删掉别的功能还在引用的图片（跨功能连锁丢图）；
  //   b 桌面隔离——不带 cid 判定的话，在 A 桌面清空花园会把 B/C 桌面的花园一起删掉；
  //   c 导入落点——文件里的桌面键必须落到当前桌面命名空间，否则导入别桌面的文件会写串桌面；
  //   d 导出补媒体池条目——不然导出文件换机后该功能的图片/语音全是坏图（#582 同款口径）。
  { name: '#668a 共享资源池/字体包不归属任何功能（删＝清空某功能时媒体池条目被当本功能数据一起删除）', file: 'js/feature-data.js', needle: 'info.suffix.indexOf(MEDIA_PREFIX) === 0 || info.suffix.indexOf(BLOB_PREFIX) === 0' },
  { name: '#668b 功能键按当前桌面隔离（删＝清一个功能会连带删掉其他桌面同名功能的数据）', file: 'js/feature-data.js', needle: 'if (info.cid === cid || (isTop && cid === \'default\')) return f;' },
  { name: '#668c 导入落点收进当前桌面命名空间（删＝导入别桌面的文件写串桌面，数据回不去）', file: 'js/feature-data.js', needle: 'return { ns: G + \':\' + cid, suffix: info.suffix };' },
  { name: '#668d 导出带上值里引用到的媒体池条目（删＝导出文件换机后该功能的图片/语音全是坏图）', file: 'js/feature-data.js', needle: 'var media = mediaRefsOf(values);' },

  // ===== #670（2026-09-17 用户直派）设置 → 工具 →【占卜】入口 ＋ 群聊模式隐藏占卜图标这件事的说明 =====
  //   编号说明：#667/#668/#669 已被同日并行批占用，本批取 #670。
  // 背景：群聊模式开启时桌面占卜图标按 #156 收进隐藏池（第一页留给「群聊」入口），用户
  // 桌面找不到占卜；用户要求「打开桌面占卜的功能放在设置的工具里」＋「这点也需要说明」。
  // 锚点守两件事：①入口存在且真的接上了（点它＝与点桌面图标同一条路径，含打开即渲染历史）；
  //              ②小字判据按「群聊开启 且 用户没在装修里固定过占卜（#393 的 pin 豁免）」—— 
  //                写反会把已固定用户的图标说成「已收起」（用户会照着小字去设置里找占卜）。
  { name: '#670a 设置 → 工具 →【占卜】入口行存在（删掉＝群聊模式下桌面无图标、设置里也没入口，用户完全进不去占卜）', file: 'template.html', needle: 'id="row-open-divination"' },
  { name: '#670b 功能介绍「占卜」组写明群聊模式收起桌面图标＋改走设置入口（删掉＝用户以为图标丢了）', file: 'template.html', needle: '<b>开启群聊模式期间桌面占卜图标会收起</b>' },
  { name: '#670c 入口点击接线（删掉＝行还在、点了没反应，用户以为坏了）', file: 'js/personalize.js', needle: "row.addEventListener('click', openDivinePage);" },
  { name: '#670d 小字「图标是否真被收起」判据＝群聊开启且未被装修固定（#393 豁免；写反＝固定过占卜的用户被告知图标已收起）', file: 'js/personalize.js', needle: "try { return store.get('divination-desk-pin') !== '1'; } catch (e) { return true; }" },
  { name: '#670e 「开启群聊」功能说明里同步写明占卜图标收起与设置入口（删掉＝设置页说明与行为不一致）', file: 'js/settings-help.js', needle: '桌面占卜图标会收进隐藏池——第一页留给群聊入口' },
  { name: '#670f 功能大全收录「占卜（设置 → 工具 入口）」（删掉＝搜「占卜 图标不见了」找不到那条路）', file: 'js/feature-hub.js', needle: "go: ['#row-open-divination']" },
  { name: '#671a 全局提示通道 window.toast 的渲染体（删掉＝全项目 20+ 文件的「已开启/已关闭」反馈重新变回死通道，设置开关点了屏幕上零变化）', file: 'js/device.js', needle: "t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';" },
  { name: '#671b 设置开关统一反馈的去重判据（删掉＝通用文案会当场盖掉模块自己的专属文案，或每个开关都补一条重复文案）', file: 'js/settings-help.js', needle: 'if ((window.__lastToastAt || 0) !== before) return;' },
  { name: '#671c 入口三行挂在数据回填完成上重同步（删掉＝LS 副本丢失而 IDB 有值时开关永远显示「未开启」、入口流程却按真实值每次进此间＝用户报的「没开却每次都进」复发）', file: 'js/contacts.js', needle: "document.addEventListener('mochi-restore-done', syncEntryUI);" },
  { name: '#671d 入口开关按存储值重读（删掉＝开关回显不再与真实值对齐，UI 说谎）', file: 'js/contacts.js', needle: 'if (cbC && !cbC.disabled) cbC.checked = entryCjianFirstOn();' },

  // ===== #672（2026-09-17 用户直派）卡顿说明口径：不写死「某一块最大」 =====
  //   用户原话：「这个写的是什么玩意，写的不是全部情况，而是我之前的案例」——原文案把某一台手机上
  //   测出的排序（聊天记录第一、字卡库第二，附 155MB / 1656 条、44MB）当成所有人的结论，用户照着自己
  //   不一定成立的那一行去删数据。口径改为：成因分几类 + 先到「查看存储」看用户自己哪一块最大、再对症。
  { name: '#672a 卡顿行下小字改为「哪一样最多每台手机不一样 + 先看清自己这一项」（改回写死排序＝又照搬单一案例，用户被引去删根本不吃体积的那一块）', file: 'template.html', needle: '看你自己哪一项最大' },
  { name: '#672b 功能中心收录「卡顿自检」条目同口径（删掉＝搜索进来的人只看得到旧结论）', file: 'js/feature-hub.js', needle: '哪一块最占地方因人而异' },
  // 2026-09-17 追加（用户当场质疑两处说法后定的平台口径）：iPhone 装到桌面**不是**「能多用内存」——
  //   #377 修的就是 iOS 独立 PWA 的 OOM 家族，装在桌面上一样会被系统关掉重开；安卓只是内存大得多。
  { name: '#672c iPhone 侧的准确解释（改回「更不容易被系统清内存 / 内存表现也更稳」＝又变成暗示装到桌面就不 OOM，用户被误导）', file: 'template.html', needle: '这不是「能多用内存」' },
  { name: '#672d iPhone / 安卓两句差异（删掉＝安卓用户以为自己也随时会被系统关页面，或以为只有 iPhone 需要清理）', file: 'template.html', needle: '长期用也要定期清' },
  // 2026-09-17 追加（用户直派「这两句话要加到开屏」）：开屏「开屏偶尔慢一下」章 + 离线兜底 DOM
  //   都要有 iOS/安卓这两句；notice.json 是联网用户实际看到的权威源，只改静态 DOM ＝ 线上看不到。
  { name: '#672e 开屏离线兜底 DOM 带上 iOS/安卓两句卡顿建议（删掉＝断网/兜底路径的用户看不到）', file: 'template.html', needle: '另外别存太多数据' },
  { name: '#672f 开屏在线权威源 notice.json 同章同内容（删掉＝联网用户实际看到的开屏没有这两句，静态 DOM 改了也白改）', file: 'pwa/notice.json', needle: '图片最占地方。安卓' },
  // ===== #674（2026-09-17 用户直派）群聊页顶部加「让对方继续说」入口 =====
  //   编号避让：同日的 #673 已被并行会话占用（音乐互动台词静默通道），本批取 #674。
  //   用户原话：「群聊设置的图标按钮的左边新增一个让对方继续说的功能」。群聊昵称点击已被「切换群聊」
  //   占用，顶部只能另起一枚图标；动作复用 group-chat.js 的 gcContinueSay（与输入栏那枚同一动作、同防重入）。
  { name: '#674a 群聊页顶部三点菜单左侧的「让对方继续说」按钮（删掉＝入口消失，用户只能去输入栏找开关打开）', file: 'template.html', needle: 'id="gc-head-continue"' },
  { name: '#674b 顶部继续说按钮接线走 gcCsFireContinue（换成别的调用＝丢掉 pointerdown 按下即触发 / 防键盘吞 click）', file: 'js/group-chat.js', needle: "gcHeadContinueBtn.addEventListener('pointerdown'" },
  // ===== #127（TASKS 待认领·2026-09-17 本会话实现）聊天记录分片：新消息先写增量日志，基准包低频重写 =====
  //   根因：chat-msgs 单键可达数百 MB，发 1KB 文字也整包重写（写放大数百倍）＝iOS OOM/读写超时的上游。
  //   锚点守的是「分片成立且安全闸还在」，删任一＝退回每次整包重写（或丢掉安全闸导致错数据落盘）。
  { name: '#127a 增量日志键与阈值（删＝退回整包重写，写放大回归）', file: 'js/chat.js', needle: "const CHAT_ARCH_KEY = 'chat-arch';" },
  { name: '#127b 基准段「未被动过」安全闸（删/放宽＝删改旧消息后仍只写日志→旧内容被覆盖不回，数据错乱）', file: 'js/chat.js', needle: 'if (chatArchPrefix !== prefix || !Array.isArray(chatArchRef) || !Array.isArray(arr)) return false;' },
  { name: '#127c 落盘入口分片判定（删＝每次仍整包重写基准包）', file: 'js/chat.js', needle: 'if (log.length <= CHAT_ARCH_MAX && msgsBytes(log) <= CHAT_ARCH_BYTES) {' },
  { name: '#127d 读侧基准包+日志拼接去重（删＝压缩崩溃窗口留两份，消息翻倍；或日志不被读取＝新消息丢）', file: 'js/chat.js', needle: 'archArr = archArr.filter(function (m) { return m && !ckptSigs.has(sigOf(m)) && !chatRecKeysHit(ckptCopies, m); });' },
  { name: '#127e 读库成功后设基准段（删＝每次保存都判定不复用，分片失效退回整包）', file: 'js/chat.js', needle: 'try { chatArchSetBaseline(myPrefix, ckptArr); } catch (e) {}' },
  { name: '#127f 日志键不回填 LS（删＝聊天增量日志被回填进 localStorage，白占 5MB 配额）', file: 'js/idb.js', needle: "if (tail === 'chat-arch' || /^[^:]+:chat-arch$/.test(tail)) return true;" },
  { name: '#127g 导入写回前清日志键（删＝旧日志被当新消息回放，叠到刚导入的历史上）', file: 'js/data-backup.js', needle: "window.xyStore(ns).remove('chat-arch');" },

  // ===== #676（2026-09-17 用户直派）心意集市/心意柜/TA 心愿卡黑白简约统一 =====
  //   用户原话：「ta发送的卡片让我给他买东西，按钮是紫色的，与我现在黑白简约的风格不符合」
  //   「心意集市和心意柜也是颜色风格和黑白简约不符」。本轮把 market.css 残留的紫色系
  //   （#8b7ac8/#6d5bb0/#4a3d6b 渐变、淡紫底、紫描边）全量收敛为黑白灰；锚点守「实底 #111」
  //   这一黑白实现表达式——被改回紫色渐变即消失报警。分类 emoji 淡彩圆底是既有设计语言，保留。
  { name: '#676a TA 心愿卡【送 TA】按钮黑白实底（改回紫色渐变 linear-gradient(#8b7ac8,#6d5bb0)＝用户报的「按钮是紫色的」复发）', file: 'css/market.css', needle: '.msg-wish-buy { width: 100%; padding: 11px 0; border-radius: 13px; border: none; background: #111; color: #fff;' },
  { name: '#676b 购买弹窗确定按钮黑白实底（改回紫渐变＝心意集市买礼物弹窗仍是紫按钮）', file: 'css/market.css', needle: '.gb-ok { background: #111; color: #fff;' },
  { name: '#676c 聊天送礼面板分类选中黑白实底（改回紫渐变＝送礼面板还是紫色调）', file: 'css/market.css', needle: '.gift-cat.sel { background: #111; color: #fff;' },
  { name: '#676d 心愿单「送 TA」小按钮黑白实底（改回紫渐变＝心愿单面板残留紫色按钮）', file: 'css/market.css', needle: '.wish-act { padding: 7px 14px; border-radius: 99px; border: none; background: #111; color: #fff;' },
  // ===== #679（2026-09-17 用户直派）各功能页内补「数据管理」卡（导出/导入/清空此前只在集中页）=====
  //   用户原话：「每一个单独的桌面的功能的导出数据，导入数据，清空数据，现在没有在每个功能里面
  //   显示啊，只显示在了集中里」。做法＝把一张 data-fbar 卡注进各功能自己的页面，按钮复用集中页
  //   同一条引擎（桌面隔离/媒体池保全/确认弹窗全继承）。锚点守「注入 + 委托 + 可见性 + 引擎复用」
  //   四条，注入链被拆（按钮从功能页里消失）即报警。
  { name: '#679a 功能页内数据卡注入（删掉 mountFdBars＝用户报的「只在集中里有、功能里没有」复发）', file: 'js/feature-data.js', needle: 'mountFdBars();' },
  { name: '#679b 功能页内数据卡按钮委托到统一引擎（换成各自实现＝桌面隔离/媒体池保全/确认弹窗任一丢守）', file: 'js/feature-data.js', needle: "var b = e.target.closest ? e.target.closest('.fd-btn, .fd-fbar-go') : null;" },
  { name: '#679c 数据卡身份属性（删掉＝注入卡与集中页行无法区分，验证脚本测不到「功能页里真的有」）', file: 'js/feature-data.js', needle: "card.setAttribute('data-fbar', f.id);" },
  { name: '#679d 运行时生成的功能页补注入（删掉＝同频/伸手/喝水/吃什么/存钱罐/番茄钟/备忘录里没有数据卡）', file: 'js/feature-data.js', needle: 'setTimeout(mountFdBars, 800);' },
  { name: '#679e 已有自带三行数据入口的功能页不重复注入（删掉＝聊天设置/信箱/朋友圈里出现两套导出导入清空）', file: 'js/feature-data.js', needle: 'if (!f.page || f.btns) return;' },
  { name: '#679g 功能页显示时重算数据量（删掉＝加了数据后卡上还显示旧项数/旧体积，计数谎报）', file: 'js/feature-data.js', needle: "attributeFilter: ['hidden'], subtree: true" },
  { name: '#679h 重算按「功能登记的 page」匹配页面 id（误写成 f.id 比较＝重算永不触发，卡上计数长期停在陈旧值）', file: 'js/feature-data.js', needle: 'if (!f.page || f.page !== pageEl.id) return;' },
  { name: '#679i 容器被功能模块整块重写后补挂数据卡（删掉＝打开「我的档案」等页时卡被 innerHTML 冲掉，用户根本看不到入口；实测 #myarc-root 每次打开都重建）', file: 'js/feature-data.js', needle: 'if (!host.isConnected || host.querySelector(\'[data-fbar="\' + f.id + \'"]\')) return;' },
  { name: '#679j 消息列表型页面不注入数据卡（删掉 gc 跳过＝卡混进群聊消息流、每次渲染被重建，且可能干扰贴底）', file: 'js/feature-data.js', needle: 'var FD_SKIP = { room: 1, gc: 1 };' },
  { name: '#679f 功能页数据卡样式类（删掉＝卡内按钮裸排无布局，挤压原功能页内容）', file: 'css/feature-data.css', needle: '.fd-fbar { margin:10px 12px; padding:12px 14px; }' },
  // #678 通话中仍被跨桌面来电打扰（OPPO Reno6 5G + 雨见浏览器，明说多机型）：跨桌面来电调度
  //   只看了 layerBusy() 的 #call-mask，通话最小化到小框后该层是 hidden，且浮层让路上限到期会
  //   强制顶屏 → 通话中照样弹「XX 来电了」（切桌面后连正在通话的人都再打一次，弹窗「接听」
  //   还会挂断当前通话）。锚点守「占用门 + 两处闸门」三条，改回旧口径即消失报警。
  { name: '#678a call.js 通话占用门 callInProgress（删掉＝跨桌面来电又能在通话中弹窗；currentCall 分支为逻辑锚）', file: 'js/call.js', needle: 'window.callInProgress = function () {\nif (currentCall) return true;\ntry {\nconst raw = sessionStorage.getItem(CALL_ACTIVE_KEY) || localStorage.getItem(CALL_ACTIVE_KEY);' },
  { name: '#678b call.js 占用门读 call-active 标记的新鲜度窗（删掉/放宽＝刷新中断的通话在占用门里变成「没在通话」）', file: 'js/call.js', needle: 'if (info && info.connectedTime && Date.now() - (info.ts || 0) <= 600000) return true;' },
  { name: '#678c 跨桌面来电调度：通话中整轮不掷（删掉＝通话中照常掷来电并投递，报障复发）', file: 'js/incoming-requests.js', needle: "if (deskCallEn() && !(window.callInProgress && window.callInProgress())) {" },
  { name: '#678d 跨桌面来电交付硬闸（删掉＝手动触发/后台路径绕过调度层闸门，通话中仍弹来电或发「快回来接听」通知）', file: 'js/incoming-requests.js', needle: "if (req.kind === 'call' && window.callInProgress && window.callInProgress()) return false;" },
  // ===== #677（2026-09-17 用户直派，iPhone 13 Pro Max Safari＋主屏幕打开，明说其他机型也出现）=====
  // 三症状：①聊天页发不了图片（加进去就没了/进不了聊天）②字卡自检「按恢复没有反应」
  //   ③「字卡使用状态自检报告导出没有内容」。
  // ②③ 是两条独立的静默缺陷，锚点必须锚「逻辑」而不是函数名：
  //   ②根因＝单卡关闭态存在【值】里（default-cards.js setCardOff 写 '1'/'0'，重开不删键），
  //     自检却按「键在不在」计数 ⇒ 修复写 '0' 后计数不变、告警与按钮原样重画。锚定值判据。
  //   ③根因＝lastText 只在 build() 末行赋值而 build() 无兜底，openAudit/refreshAll 又把异常
  //     吞掉 ⇒ 未打开过/中途抛错时 report 恒为空串。锚定「导出前现取一次 + 错误写进报告」。
  { name: '#677a 自检单卡关闭按值判据（改回按键存在计数＝「恢复单卡」变空转、告警与按钮不消失＝「按恢复没反应」复发）', file: 'js/card-audit.js', needle: "function isOffRel(rel) { return offValue(rel) === '1'; }" },
  { name: '#677b 自检关闭键索引/收集同走值判据（任一处改回 keys 直收＝计数与修复目标不一致）', file: 'js/card-audit.js', needle: 'if (isOffRel(rel)) out.push(rel);                 // 只收真·关闭（值 = \'1\'）的卡' },
  { name: '#677i 关闭索引的相对键推导（写成 k.slice(前缀+":dc-off-") 会传成 <cat>:<内容> ⇒ store 读到不存在的键、offCount 恒 0、告警全不出现）', file: 'js/card-audit.js', needle: "var rel = k.slice(pre.length);\nif (rel.indexOf(OFF_PREFIX) !== 0) continue;" },
  { name: '#677c 自检渲染的异常兜底（删掉＝build 抛错时页面停在旧帧、lastText 为空＝「导出没有内容」复发）', file: 'js/card-audit.js', needle: "function render() {\nvar r;\nbuildErr = '';\ntry { r = build(); }" },
  { name: '#677d 导出前报告空则现取一次（删掉＝未打开过自检页直接导出时 report 又是空串）', file: 'js/card-audit.js', needle: 'if (!lastText) { try { render(); } catch (e) {} }' },
  { name: '#677e 一键修复按实际落地数回报（改回无条件 return true＝全部空转也报「已修复」的假反馈）', file: 'js/card-audit.js', needle: 'bulkFixes.forEach(function (id) { try { if (fixMap[id]) { var r = fixMap[id](); if (r !== false && r !== \'fail\') n++; } } catch (e) {} });' },
  { name: '#677f 图片选择器 input 常驻并挂进文档再 click（改回 detached／每次新建＝iOS Safari 选完图不派发 change、图片进不了聊天复发）', file: 'js/chat.js', needle: "document.body.appendChild(fi);\nchatImgInput = fi;" },
  { name: '#677g 选图链路失败可见（删掉 reader.onerror/解码超时＝读取或解码失败时彻底静默，用户只看到「加了图片但没了」）', file: 'js/chat.js', needle: "reader.onerror = () => { settled = true; toast('图片读取失败，请换一张再试'); };" },
  { name: '#677h 空 FileList 可见反馈（改回 if (!files.length) return;＝iOS 选完没带上文件时一点提示都没有）', file: 'js/chat.js', needle: "if (!files.length) { toast('没有取到图片，请再选一次'); return; }" },
  // ===== #680（2026-09-17 用户直派）字卡库顶部搜索直出图片令牌乱码 ＋ 图片/表情包名称 =====
  // 用户原话：「为什么在字卡库的顶部搜索栏里搜索字卡还能看到里面的图片的令牌乱码 例如
  //   @@m:5c58a523… 自定义聊天字卡 · 图片」「公用字卡和专属字卡里要新增图片和表情包，也可以
  //   编辑名称，然后可以搜索，如果没有上传名称搜索的时候不应该搜索出来」。
  // 锚点取「逻辑」：①搜索侧媒体形态剔除（改回直出 c＝令牌串又进结果列表）；②名称身份用
  //   ccPoolKey（改回 card 原串＝#554/#632 令牌化后名称失联）；③公用名称键进 EXCLUDE
  //   （漏登记＝migrateLegacy 把全局键迁进 default，其他桌面名称全丢）。
  { name: '#680a 跨库搜索遇媒体形态（令牌/图链/非音频|||）整条剔除（删掉＝搜索结果又直出 @@m: 令牌乱码）', file: 'js/chatcard.js', needle: "if (window.ccTextCardOnly && !window.ccTextCardOnly(c)) {\nconst bar = c.indexOf('|||');" },
  { name: '#680b 图片/表情包搜索只认「用户填写的名称」（改回按卡体匹配＝未命名也能被令牌串搜出来，用户要求落空）', file: 'js/chatcard.js', needle: "if (type === 'sticker' || type === 'image') {\nconst nm = ccCardNameAny(c);" },
  { name: '#680c 名称以内容身份 ccPoolKey 为键存取（改为卡原串＝#554/#632 令牌化后名称与图失联，改名白改）', file: 'js/chatcard.js', needle: 'try { return namesFor(ccOffScope())[ccPoolKey(c)] || \'\'; } catch (e) { return \'\'; }' },
  { name: "#680d 列表内联搜索走统一匹配口径（改回 x.c.indexOf('data:') 直比＝图片按令牌匹配、未命名也可能命中）", file: 'js/chatcard.js', needle: 'function ccCardMatchText(c, type) {' },
  { name: '#680e 公用名称键进 contacts EXCLUDE（删掉＝被当旧顶层业务键迁进 default 并删根键，其他桌面图片名称全部读不到）', file: 'js/contacts.js', needle: "'cc-scope-migrated', 'cc-media-names-public'", },
  // ===== #690（2026-09-17 用户直派：iPhone 11 默认浏览器，明说其他机型也出现——「桌面滑动，
  //   桌面的三页会灰屏和卡顿，无法正常滑动；进去比较正常，之后滑动页面、点里面的 app 都会卡，
  //   手机还会发烫」）=====
  //   根因（两条并存，均零机型分支）：
  //   ①**老内核准静默丢声明**：桌面壁纸层 #phone-bg-layer 与背景遮罩 .phone-bg-mask 只用
  //     `inset:0` 定位——inset 简写是 2020 年（Safari 14.1 / Chromium 87）才有的，老内核整条
  //     丢弃 → 空 div 收缩成 0×0（无头实测：老内核解析结果 0×0，现代内核 390×844）→ 桌面整片
  //     灰白、「换壁纸 / 调背景遮罩」毫无反应。同批老内核还把图标 min() 丢掉（图标盒塌成 svg
  //     的 28px）、grid 的 gap 简写丢掉（图标行距归零）＝用户读成「三页不正常」。多机型同现即
  //     此因（iOS<14.1 / Chromium<87 / vivo 系内置内核都在内，chat-pages.css 早有同款注释）。
  //   ②**触摸端 :hover 粘滞**：.app:hover 的抬手放大 + box-shadow 过渡在触摸内核粘在最后一次
  //     点击上（点过的图标一直浮着不落），该元素还带过渡参与横滑时的逐帧合成/栅格化。
  //   锚点守「逻辑」而非函数名：兜底四条长手/像素值/grid-gap 一旦被删，老内核立刻塌回原症状；
  //   翻页帧耗时采样与诊断两行一旦被删，下次报「滑三页卡」时又没有真机读数可判。
  { name: '#690a #phone-bg-layer 宽高兜底（删掉＝老内核整层 0×0、桌面壁纸不显示＝「三页灰白」复发）', file: 'js/personalize.js', needle: "'position:absolute;inset:0;top:0;right:0;bottom:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;opacity:0;'" },
  { name: '#690b .phone-bg-mask 四长手+宽高兜底（删掉＝老内核遮罩层 0×0，「背景遮罩」滑块怎么调都没变化）', file: 'css/home.css', needle: 'top:0; right:0; bottom:0; left:0; width:100%; height:100%;' },
  { name: '#690c 模糊外扩时让出宽高（写回 100%＝右/下两侧 24px 外扩被「宽高优先于 right/bottom」吃掉、模糊边缘发虚＝#240 症状复发）', file: 'css/home.css', needle: 'width:auto !important; height:auto !important;' },
  { name: '#690d 桌面图标像素兜底（删掉＝老内核丢 min() 后图标盒塌成 svg 的 28px、三页图标网格错位）', file: 'css/home.css', needle: 'width:58px; height:58px;\nwidth:min(58px, 21vw); height:min(58px, 21vw);' },
  { name: '#690e 图标网格间距 grid-gap 兜底（删掉＝老内核丢 gap 简写后行/列间距归零、图标挤成一坨）', file: 'css/home.css', needle: 'grid-gap:14px 8px; gap:14px 8px;' },
  { name: '#690f 图标悬停放大只在 hover:hover 生效（去掉门控＝触摸端 :hover 粘滞、点过的图标一直浮着并逐帧参与合成）', file: 'css/home.css', needle: '@media (hover:hover) {\n.app:hover .app-ico {' },
  { name: '#690g 桌面翻页帧耗时现场采样（删掉＝用户再报「滑三页卡顿」时诊断里没有真机读数可判）', file: 'js/desktop-slider.js', needle: 'localStorage.setItem(PERF_KEY, JSON.stringify({' },
  { name: '#690h 诊断输出老内核降级项（删掉＝下次报障分不清「引擎太老丢声明」还是「代码坏了」）', file: 'js/device.js', needle: "'老内核降级项：inset='" },
  { name: '#690i 诊断输出桌面翻页帧耗时（删掉＝报障时只有静态帧率，翻页卡顿依旧判不了）', file: 'js/device.js', needle: "'桌面翻页帧耗时（' + dp.n + ' 帧现场采样 · '" },
  { name: '#690j 翻页帧耗时键进「清理错误诊断记录」清单（删掉＝诊断缓存清了但这条样本一直留着，越翻越多）', file: 'js/personalize.js', needle: "'xy-home-v2:__diag-deskperf'" },
  { name: '#681 信箱剥图快照只剥 dataURL、保留媒体池令牌（重新加入 @@m:→[图片] 剥离＝权威主键读不到时信件图永久退化成「[图片]」文字）', file: 'js/mail.js', needle: "let t = s.replace(/data:image\\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[图片]'); t = mailCleanDisplay(t);" },
  // ===== #691（2026-09-17 用户直派）：颜文字/emoji 点卡片两模式（默认填入输入栏 / 设置可切点击直接发送）
  { name: '#691a 模式键现读判据（删掉＝模式开关失效、点卡片恒走一条分支）', file: 'js/chat.js', needle: "return window.xyStore(MYE_G_PREFIX).get(TEXTCARD_DIRECT_KEY) === '1';" },
  { name: '#691b 文字卡点击三分支（删掉 else-if＝设置里切了模式也不生效，退回「点一下必发」）', file: 'js/chat.js', needle: '} else if (textCardDirectMode()) {' },
  { name: '#691c 填入输入栏＝尾部追加不清空（改成覆盖赋值＝用户已打的字被吃掉）', file: 'js/chat.js', needle: "el.textContent = (el.textContent || '') + t;" },
  { name: '#691d 设置行文案＋小字说明（删掉＝模式切换入口与小字解释都没了）', file: 'js/chat-settings.js', needle: '颜文字/emoji 点击直接发送<span class="sub">' },
  { name: '#691e 设置行落键 chat-textcard-direct（删掉＝拨开关不写存储、重开设置回默认）', file: 'js/chat-settings.js', needle: "window.xyStore(GNS2).set('chat-textcard-direct'" },
  { name: '#691f 群聊同口径（删掉＝群聊里点颜文字/emoji 依旧直接发出，与聊天页模式不一致）', file: 'js/group-chat.js', needle: 'if (window.textCardDirectMode && window.textCardDirectMode()) { sendGcText(src); return; }' },
  { name: '#691g 群聊填入群聊输入栏（改为覆盖赋值＝群聊里已打的字被吃掉）', file: 'js/group-chat.js', needle: "input.textContent = (input.textContent || '') + t;" },
  { name: '#691h 模式键进全局根键 EXCLUDE（删掉＝被 migrateLegacy 迁进 default 桌面并删根键，开关刷新后失效）', file: 'js/contacts.js', needle: "'chat-textcard-direct'," },
  { name: '#691i 面板内切换按钮显隐＝只跟文字分类、且插入模式按调用方开口径（删掉/改成常显＝表情包图片分类与写信插入模式也多出个没用的按钮）', file: 'js/chat.js', needle: "emojiTextModeBar.hidden = emojiCat === 'sticker' || !!(emojiInsertCb && !emojiTextModeApplies);" },
  { name: '#691j 面板内切换按钮写同一个全局键（漏写＝面板里切了、聊天设置/群聊读到的还是旧模式）', file: 'js/chat.js', needle: "window.xyStore(MYE_G_PREFIX).set(TEXTCARD_DIRECT_KEY, en ? '1' : '0');" },
  // ===== #695（2026-09-17 用户直派）：此间【去找TA】跨桌面直达聊天的卡顿
  //   主页这一帧从未被绘制（setActiveContact 尾部显示 → enterChat 立刻盖掉），旧实现仍把
  //   卡片背景/页面背景整批重新解码应用。下述四条是「延后 + 主页显示前补跑」的接线，
  //   删掉任一条即退回「点一下卡住」（逻辑锚=调用/观察语句，personalize.js 内各自唯一）。
  { name: '#695a buildDeskPages 的整页背景重应用走 whenDeskVisible 门（删掉＝切桌面直达聊天时又同步重解码整屏页面背景）', file: 'js/personalize.js', needle: 'whenDeskVisible(applyPageBgs);' },
  { name: '#695b 切桌面综合监听器的桌面视觉重应用走门、壁纸 UI（设置页）仍当场同步（删掉＝同步卡顿复发／整条延后＝设置页读到旧桌面的壁纸预设）', file: 'js/personalize.js', needle: 'if (whenDeskVisible(refreshDeskVisuals)) { try { syncBgUI(); } catch (e) {} }' },
  { name: '#695c 直读兜底（rescueDeskVisuals）结算后的重应用同口径走门（删掉＝聊天页出现后 400ms 左右又整屏重解码一次）', file: 'js/personalize.js', needle: 'const done = () => { if (!refreshed) { refreshed = true; try { whenDeskVisible(refreshDeskVisuals); } catch (e) {} } };' },
  { name: '#695d 主页显示前的补跑触发器＝盯 #page-phone 的 hidden 变化（删掉/改坏＝待办永不补跑，跨桌面直达聊天后回主页看到上一桌面的背景与头像）', file: 'js/personalize.js', needle: "deskVisualWatch.observe(home, { attributes: true, attributeFilter: ['hidden'] });" },
  // ==== 2026-09-17 #705 两连修（用户直派 vivo X200S Edge，「多机型」「后台通知功能全部失效」＋「接通电话后联系人还会再打电话」）====
  //  通知全灭根因：#673 把 showNotification 调用改成传 thunk function(){ return reg.showNotification(...) }，
  //    但 kaWithTimeout 仍只认 Promise——函数没有 .then → TypeError 进 catch → reject → STRIP_LADDER 四级
  //    降级被同一个 TypeError 连环「失败」秒耗尽 → resolve(false)，reg.showNotification 从未执行。
  //    无头实测（修复前产物）：gateStats.sent=1 而 showNotification 0 次调用、全程无报错＝所有机型后台通知静默全灭。
  //  通话两修：①#698 的 recoverCall IDB 兜底回读遇「挂断后 IDB 墓碑未落地页面即被杀」（vivo/Edge 杀渲染进程
  //    常态）→ 幽灵通话复活；②来电冷却戳只在「联系人来电触发」时写——去电从不写、来电从触发起算＝接完/打完
  //    电话后 1~3 分钟即可能再来一通。
  { name: '#705a kaWithTimeout 兼容 thunk（删回直接 p.then 则函数入参 TypeError→降级链秒耗尽＝后台通知全灭复发）', file: 'js/bg-keep.js', needle: "const pr = (typeof p === 'function') ? p() : p;" },
  { name: '#705b clearCallActive SS/LS 同步写 {ts:0} 墓碑（改回 removeItem 则挂断后页面被杀时 SS/LS 全空→落 IDB 回读→幽灵通话复活）', file: 'js/call.js', needle: "sessionStorage.setItem(CALL_ACTIVE_KEY, '{\"ts\":0}')" },
  { name: '#705c 通话结束重写来电冷却戳（删则去电后/后台来电接完后冷却仍按触发时刻算＝挂断 1~3 分钟后联系人又打来）', file: 'js/call.js', needle: "try { store.set('records-call-last', String(Date.now())); } catch (e) {}" },
  // ===== #707（2026-09-17 用户直派：iPhone15ProMax Safari26.6/Via，「全局滑动卡顿 + 桌面翻页灰屏」，
  //   诊断实锤：html 类带 tablet＝「请求桌面网站」伪装 UA 误判平板；翻页帧采样 p90≈991ms、长任务为零
  //   ＝渲染合成层卡，非 JS。三修＋一仪器，全零机型分支：①device.js Macintosh 伪装分支补 screen 短边
  //   ≥600（iPhone 全系回到手机布局，iPad mini 744 起照常平板）；②zoom 声明按类门控（Safari 18.2 起
  //   WebKit 新 zoom 实现自述 tricky、26.4 仍在修性能缺陷，zoom:1 声明本身也让整个桌面子树进 zoom
  //   继承/布局路径——改后手机/平板/默认值零 zoom 声明，宽窗非平板且值≠1 才有）；③删翻页容器
  //   -webkit-overflow-scrolling:touch（legacy 动量旗标钉在出灰屏的那一层上）；④翻页采样剔除切后台
  //   冻结帧（此前一条 144s 后台间隙把均值拉成假「严重卡顿 2543ms」，真值看 p90）。
  { name: '#707a 平板误判补屏宽下限（删 _mScreen>=600＝iPhone 开「请求桌面网站」后 Macintosh 伪装 UA 再被误判成 .tablet 平板布局，非主流路径回流）', file: 'js/device.js', needle: "&& navigator.maxTouchPoints > 1 && 'ontouchstart' in window && _mScreen >= 600);" },
  { name: '#707b zoom 声明按类门控-字号（改回无前缀 .page-slide{zoom:var()}＝手机桌面整个子树又常年带 zoom 声明参与 WebKit 新 zoom 实现）', file: 'css/home.css', needle: 'html.desk-zoom-font .page-slide { zoom:var(--desk-font-scale, 1); }' },
  { name: '#707c zoom 声明按类门控-卡片（同上，11 类卡片组）', file: 'css/home.css', needle: 'html.desk-zoom-card .deco-widget, html.desk-zoom-card .mini-row, html.desk-zoom-card .checkin,' },
  { name: '#707d 手机端 zoom 兜底随门控加前缀（删块＝桌面模拟器窗口拖窄 <900px 时缩放不再被钉回 1，老兜底语义丢失；needle 按压缩后形态＝续行无缩进）', file: 'css/home.css', needle: 'html.desk-zoom-font .page-slide,\nhtml.desk-zoom-card .deco-widget' },
  { name: '#707e 类门控写值接线-主设置页（删 syncDeskZoomClass 调用＝滑块拖了值类不刷新，缩放在新门控下不生效；needle 按压缩后形态）', file: 'js/personalize.js', needle: "document.documentElement.style.setProperty('--desk-font-scale', String(pct / 100));\nif (deskFontVal) deskFontVal.textContent = pct === DESK_FONT_DEFAULT ? '默认' : pct + '%';\nsyncDeskZoomClass();" },
  { name: '#707f 类门控函数本体（删函数＝所有接线调用抛 ReferenceError，桌面字号/卡片大小设置全废）', file: 'js/personalize.js', needle: 'function syncDeskZoomClass() {' },
  { name: '#707g 翻页容器删 legacy 动量旗标（写回 -webkit-overflow-scrolling:touch＝出灰屏的那层又钉回老式滚动路径；needle 按压缩后形态）', file: 'css/home.css', needle: 'scroll-snap-type:x mandatory;\nscrollbar-width:none;' },
  { name: '#707h 翻页采样剔除后台冻结帧（删 document.hidden 分支＝一条 144s 后台间隙再次把均值拉成假「严重卡顿」，报障判读被带偏；needle 按压缩后形态）', file: 'js/desktop-slider.js', needle: "if (typeof document !== 'undefined' && document.hidden) {\nhid++;\nlast = 0;" },
  { name: '#707i 诊断标注剔除后台帧数（删＝样本剔没剔、剔了几条在诊断里看不见）', file: 'js/device.js', needle: "'（已剔除后台帧 ' + dp.hid + '）'" },
  // ==== 2026-09-18 #708 后台通知「自检/测试按钮」优化（用户直派：通知链四轮回归后，自检也要能自证清白）====
  //  ①通道按本次调用独立收集（showSysNotification/swNotifyLater 第三参 chanOut 回调）——不再读全局
  //    lastNotifyChannel（共享变量，真实消息/来电谁后发谁写，自检会读到别条通知的通道＝结果串台）；
  //  ②结果分层说真话：sw=「已真正提交系统显示」＋全机型没弹出三步引导；四级降级全败=「系统/内核拒绝」，
  //    不再误报「SW 未就绪/权限被禁」（#705 期间自检正是这么指错层的）；
  //  ③8 秒超时哨兵：发送链卡死不落定（#614「点测试没反应」形态）当场报「发送链未落定·应用内故障」。
  { name: '#708a 通道按调用独立回报（删掉 chanOut 管道＝自检读全局共享通道、结果可被真实消息/来电串台）', file: 'js/bg-keep.js', needle: 'function showSysNotification(title, opts, chanOut) {' },
  { name: '#708b 自检 SW 通道真话文案（退回笼统「已发送」＝#705 形态故障时指错层）', file: 'js/bg-keep.js', needle: '✓ 测试通知已发送并真正提交系统显示（Service Worker 通道：后台关屏也能弹）' },
  // #724（用户直派，红米 K80 Chrome 实报「测试失效＋黑框字飞出＋与说明重复」＋「挂后台回来页面被刷新＝保活失效」多机型同族）：
  //  ①测试只写测试：结果从十几个 env 行瘦身为保活锚一行+发送结论一至两行（环境/排查在本行 gs-sub 说明、
  //    功能说明胶囊、信息诊断三处本就有，复读＝撑爆 toast）；②端到端自检：受理≠挂出，回读 SW 通知队列归因；
  //  ③驻留真生效：#cc-toast.show CSS 动画固定 2.6s forwards 把 #708 的 9 秒驻留吞掉，内联 animationDuration 随 dur；
  //  ④保活电平余量分级 KA_VOL_BASE=0.2（新内核 audible 收紧后豁免丢失＝后台整页冻结/丢弃＝「点回来被刷新」）；
  //  ⑤取证：心跳断流/后台暴毙计数持久化，诊断【保活现场】展示——「保活有没有生效」不再口述猜。
  { name: '#724a 测试端到端回读系统通知队列（删＝受理≠挂出的系统层拦截又归因不了，自检退回半真话）', file: 'js/bg-keep.js', needle: "list.some(function (n) { return n && n.title === '后台通知测试'; })" },
  { name: '#724b toast 驻留真生效（删内联 animationDuration＝#708 自定义驻留继续被 CSS 2.6s 固定动画吞掉，结果一闪就没）', file: 'js/bg-keep.js', needle: "t.style.animationDuration = (dur || 2600) + 'ms';" },
  { name: '#724c 保活电平余量分级常量（退回 0.05＝新内核 audible 判定收紧时豁免再丢，后台冻结/丢弃回归）', file: 'js/bg-keep.js', needle: 'const KA_VOL_BASE = 0.2, KA_VOL_MAX = 0.35;' },
  { name: '#724d 后台暴毙取证判别式（删＝标签被系统丢弃「点回来被刷新」重新无从计数）', file: 'js/bg-keep.js', needle: 'if (old && old.n > 0 && !old.resumed && !old.bye)' },
  { name: '#724e 诊断接入取证计数（删＝取证只在数据层，【保活现场】看不见断流/终止历史）', file: 'js/device.js', needle: "'历史取证：断流' + kp.ev.stall + '次/后台终止' + kp.ev.died + '次" },
  { name: '#724f cc-toast 多行收纳（删 white-space:pre-line＝\\n 又折成空格挤成一坨，「字飞出黑框」回归）', file: 'css/chat-pages.css', needle: 'max-height:min(60vh, 420px);' },
  { name: '#708c 自检 8 秒超时哨兵（删掉＝发送链卡死时「点测试没反应」#614 形态回归）', file: 'js/bg-keep.js', needle: '✗ 测试超时：通知发送链 8 秒未落定（应用内故障，非权限/系统问题）' },
  // ==== 2026-09-18 #712 梦角档案顶部「不是 AI」常驻说明（用户直派：网站没有任何 AI 功能，这个只是记录的功能）——「梦角/认识TA」的说法易被误解成 AI 角色或自动生成；开屏使用前提卡虽已写明「纯代码运行、没有任何 AI」，但功能页内没有就地讲清。修复=memo-arc 总览页（view=home，含无梦角空态）渲染顶部常驻一条说明，分区子页不加（返回总览即可见）；功能介绍页第 19 节补同口径一行（lg-count 7→8）====
  { name: '#712a 顶部说明正文（删掉/改没「本站没有任何 AI 功能…只是记录」表述＝误解回归）', file: 'js/memo-arc.js', needle: '本站没有任何 AI 功能，梦角档案只是记录' },
  // ==== 2026-09-18 #723 iOS 卡顿收尾批：无限循环非合成属性动画改合成 + backdrop-filter 清理（用户派单「确定有用和真的会优化就帮我做」；编号说明：#715~#722 已被滚动旗标/K80 三联/换头像/兼容四小批/e2e 形态/渲染分帧/触摸被动化/未接电话+关于说明条各批占用，顺延 #723；注意 #722 本身已被两批重复占用）——全站 keyframes 审计后把 6 个「infinite × 非合成属性（box-shadow/filter/background/left）」常驻动画改为伪元素/位移的 opacity/transform 合成动画（录音呼吸圈、四子棋胜利金晕、钓鱼收杆提亮、花园稀有花晕、房间流星、房间放置呼吸格），同批收敛 market.css 8 处+chat-main.css 1 处 transition:all 为具体属性、room.css 3 处 backdrop-filter 去除（同 base.css v3.6.x 弹窗先例，iOS 每帧重采样）。有限次一次性动画（snkdiered/waterDone/gk-win-pulse 等）审计后确认代价有界不动；splashDots 开屏瞬态不动；pomo-spark 父级百分比无法等价 translate 不动 ====
  { name: '#723a 录音呼吸圈改伪元素合成动画（改回 box-shadow 插值＝录音全程每帧重绘回归）', file: 'css/chat-main.css', needle: 'animation:voiceRecPulseRing 1.15s ease-in-out infinite' },
  { name: '#723b 四子棋胜利金晕改棋子伪层（改回 filter:brightness+drop-shadow 插值＝胜利态常驻重绘回归）', file: 'css/chat-pages.css', needle: 'animation:c4winGlow .9s ease-in-out infinite alternate' },
  { name: '#723c 钓鱼收杆提亮改白洗伪层（改回 brightness 插值＝钓鱼页常驻重绘回归）', file: 'css/chat-pages.css', needle: 'animation:fishReelPulse 1s ease-in-out infinite' },
  { name: '#723d 稀有花呼吸光改晕盘伪层（改回 drop-shadow 插值＝花园页常驻重绘回归）', file: 'css/garden.css', needle: 'animation:gardenRareHalo 2s ease-in-out infinite' },
  { name: '#723e 流星改 translateX 合成位移（改回 left 插值＝夜晚房间每帧 reflow 回归）', file: 'css/room.css', needle: '0% { transform: rotate(-22deg) translateX(0); opacity: 0; }' },
  { name: '#723f 放置呼吸格底色改伪层 opacity（改回 background 插值＝放置模式常驻重绘回归）', file: 'css/room.css', needle: 'background: rgba(122,200,122,.28); opacity: .29; pointer-events: none;' },
  // ==== 2026-09-18 #725 聊天美化「边看边调」气泡透明度/圆角滑块无效甄别（用户报「滑动了，但没有任何区别」）——实测两滑块链路（store→applyChatSurfaces 写 --cs-in/out-surface 与 --chat-bubble-radius→CSS 消费）全通，真根因=自定义气泡 CSS（cs-bubble-css）写了底色/圆角声明：注入样式带 !important 或 head 末尾同特异性后胜，钉死气泡 background/border-radius，滑块变量照常写入但视觉零变化。设计仍是「CSS 为准」不改写用户模板，修复=抽屉气泡分区就地红字警示冲突====
  { name: '#725a 气泡 CSS 冲突警示检测锚（删掉底色/圆角冲突检测＝「滑块滑了没反应」再次无任何提示）', file: 'js/chat-settings.js', needle: '/(^|[^-\\w])background(-color|-image)?\\s*:/i.test(cssTxt)' },
  // ==== 2026-09-18 #726 卡顿自检·渲染层实测（用户「帮我做一个卡顿自检功能」；与 #411 数据层「一键优化」互补）——新增 src/js/perf-check.js（jsFiles 已登记）：点开始后 10 秒 rAF 帧间隔现场实测（可去任意页面复现），后台/锁屏冻结帧剔除（间隔>250ms 视为冻结，#707 同款教训）、键盘弹出期标记（可视高<85% 视口）、掉帧按可见 .app[data-app] 归因，判级 流畅/轻度/中度/重度 + 对症建议（本地数据大→指向 #411 一键优化）；长任务用窗口内自建 PerformanceObserver（iOS WebKit 不支持自动降级，不碰 device.js 常驻观察器）。零常驻开销（rAF/观察器只在窗口内存在）。入口 template #row-perf-check（#row-perf-optimize 上方）+ personalize 接线（进度浮条=开始后去任意页面用，结束自动弹报告）+ 开屏公告八章（template/notice.json 双份）====
  { name: '#726a 后台冻结帧剔除（删/调大＝切后台 144s 冻结被当成一帧超级卡顿，#707 同族误报回归）', file: 'js/perf-check.js', needle: 'var BG_GAP = 250;' },
  { name: '#726b 键盘弹出期标记（删＝键盘变形期掉帧与普通掉帧混计，iOS 键盘期结论缺失）', file: 'js/perf-check.js', needle: 'window.innerHeight * KB_RATIO' },
  { name: '#726c 设置行入口（删则设置页无「卡顿自检」行）', file: 'template.html', needle: 'id="row-perf-check"' },
  { name: '#726d 设置行接线（删则点行无反应）', file: 'js/personalize.js', needle: 'window.mochiPerfCheck.start(durMs' },
  // ==== 2026-09-18 #727 主动发送「标识」可换/可自定义（用户直派「联系人主动发送的消息，现在是小爱心的标识，帮我新增，可以用别的标识和自定义标识」）——原固定爱心（chat.js 硬编码 SVG path + .msg-hi-heart）改为「标识池」：内置五枚（♥/★/☾/✦/🐾）多选 chips + 自定义标识（reply-as-badge-custom＝JSON [{s,on}]，不进 DEFAULTS、随 getCfg/replyCfgFor 外挂附带，同 #712 口径）；总开关 as-badge 语义保留为「显示/不显示任何标识」；池内全关由渲染侧兜底回爱心（设置页不拦，与 #712「至少保留一个」不同——不显示标识由总开关表达）；点亮≥2 枚时出「抽取方式」行 as-badge-rand（1 随机/0 按序轮换，轮换以消息时间戳做稳定种子）；爱心仍走原 SVG 零视觉回归，其余内置与自定义走文本节点 .msg-hi-mark。设置 UI 在 reply-settings.js #727 段（asb-chips），渲染消费在 chat.js（window.asBadgePool）+ chat-main.css 文本形态样式 + 开屏公告九章（template/notice.json 双份）====
  { name: '#727a 标识池读取（删＝chat.js 拿不到标识池，主动消息退回兜底爱心，用户设置的星星/自定义全失效）', file: 'js/reply-settings.js', needle: 'window.asBadgePool = function (c) {' },
  { name: '#727b 自定义标识外挂存储（删＝自定义标识刷新后消失，或写坏数组）', file: 'js/reply-settings.js', needle: "'reply-as-badge-custom'" },
  { name: '#727c 渲染侧按池出标识（删＝退回硬编码爱心，池设置全失效）', file: 'js/chat.js', needle: 'window.asBadgePool ? window.asBadgePool(c) : []' },
  { name: '#727d 文本标识节点（删＝非爱心标识不渲染，只剩爱心可用）', file: 'js/chat.js', needle: "mk.className = 'msg-hi-mark';" },
  { name: '#727e 文本标识样式（删＝文本标识落到气泡流内、撑开布局压住文字）', file: 'css/chat-main.css', needle: '.msg-hi-mark {' },
  { name: '#727f 设置行「标识」池锚点（删＝设置页无标识池 UI；模板被模板重写时最先消失）', file: 'template.html', needle: 'id="asb-chips"' },
  // 注：#727g 是「.gs-row{display:flex} 压过 UA [hidden]」的老坑救援——抽取方式行靠 hidden 显隐，删＝该行永远显示
  { name: '#727g 设置行 hidden 救援（.gs-row 是 flex，删则 #asb-rand-row 的 hidden 失效、永远显示）', file: 'css/setting.css', needle: '.gs-row[hidden] { display:none; }' },
  // ==== 2026-09-18 #730 后台通知自检补「屏幕上方弹出」检查（用户直派「还缺少后台弹窗在手机屏幕上方弹出的检查，非常重要」）——原自检（#708/#724）只证明「进系统队列/SW 已提交」，证明不了「屏幕上方真弹横幅」：系统横幅渲染在系统层，页面 JS 读不到。改为发送时刻记录 document.hidden（前台/后台）如实归因：后台→「屏幕上方应有横幅，没见着＝系统层拦截」；前台→如实说明「前台不弹顶层横幅」并引导按 Home 切后台复核「从屏幕顶部弹出」。接 #724 队列回读之后、只对 found===true 生效，不覆盖既有结论 ====
  { name: '#730a 屏幕上方弹出·前台/后台如实归因＋引导复核（#1014 起由「第二段·后台阶段」代用户完成复核：删掉＝自检又只凭进队列就报成功，证明不了屏幕上方真弹横幅）', file: 'js/bg-keep.js', needle: '要验「屏幕上方弹出」请用下方第二段' },
  // ==== 2026-09-18 #761 后台通知自检升级「更清晰、实用」（用户直派：弹窗消失两天、权限没动过，把浏览器通知权限关掉再打开后恢复——多机型同族）。两层新自检：①旧包检测——比对 splash-ver data-build-ts 与线上 version.json，直接回答「什么都没改弹窗突然全没」的头号嫌疑（设备缓存 #673 故障包；#705 修复只证代码在位，缓存包不重载就永远在跑）；②结果问人本人——SW 发送成功≠用户真看到横幅（浏览器端通道被拧死时 API 照常 granted/受理），追问「弹了吗」，没弹给按实效排序的四步指引（第一步就是用户实测救活的「权限关闭再允许＋强杀浏览器」）。零机型分支。编号让位：#757~#760 已被通话续命/docx/房间/美化抽屉批次占用 ====
  { name: '#761a 旧包检测行（删＝「权限没动弹窗全没＝缓存故障包」这一层自检永远看不见，用户只能靠猜）', file: 'js/bg-keep.js', needle: '✗ 旧包正在运行：本页 ' },
  { name: '#761b 旧包检测仍落地（#1014 起版本比对改为不阻塞结果地补行——删掉＝旧包告警消失，「什么都没改弹窗突然全没」无解释；本行语义已由「版本没回来不出结果」改为「不拖时间也要报旧包」）', file: 'js/bg-keep.js', needle: 'verStale = true;' },
  { name: '#761c 发送成功追问「弹了吗」确认框（删＝自检又只报 JS 全绿就收工，浏览器端通道死锁时指错层）', file: 'js/bg-keep.js', needle: "window.openModal('自检确认'" },
  { name: '#761d 追问只在 SW 通道真成功时才提供（页面通道/失败不追问；#1014 起前台那句「看到了吗」并入第二段·后台阶段：删掉＝结果与追问脱钩）', file: 'js/bg-keep.js', needle: "if (testChan === 'sw') offerPhase2();" },
  { name: '#761e 实操指引首步=重开浏览器通知权限（用户实测恢复项；删＝指引退回泛泛而谈，「权限明明开着通知消失好几天」无解）', file: 'js/bg-keep.js', needle: "push('重置浏览器通知权限" },
  // 注：#761 状态机依赖 testOk（.then(ok) 回调转存）——回退成引用回调形参 ok 会在 showResult 处 ReferenceError
  // ==== 2026-09-18 #731 全屏模式聊天壁纸没铺满底部栏（用户直派「聊天里的背景图片没有铺满底部栏，这个在聊天美化里需要可以自己调整全部铺满还是什么」）——壁纸本来就画在 #page-chat 的边框盒上（含顶栏/输入栏的 padding 区），看不见是因为两个栏位自己画了半透明底色（--cs-*-opacity，默认 92%）。两件事：①铺满方式从写死的 cover 变成四档可选（cs-bg-fit：铺满裁剪/完整显示/平铺/拉伸填满，默认档与旧写死值逐字一致＝未写盘设备零视觉变化）；②新增「壁纸延伸到顶栏/输入栏」开关（cs-bg-fullbars，默认关、0 是用户裁决的默认值）——打开＝生效值变量 --cs-*-opacity-ink 写 0 让开底色，存量自定义不透明度原样保留（关掉即恢复、零数据改动）。设置页壁纸分组两行 + 边看边调「栏位」区两个控件 + CHAT_BEAUTY_KEYS 收录 ====
  { name: '#731a 铺满方式档位表（删＝档位失效、退回写死 cover，用户又只剩一种铺法）', file: 'js/chat-settings.js', needle: "const CS_BG_FITS = [" },
  { name: '#731b 铺满方式落样式（#762 起宿主换成常驻图层 #cs-bg-layer；改回写死 cover＝「完整显示/平铺/拉伸」三档点了没反应。#938 起该行换成「值变才写」形态，锚点随之换到新写入行，非误删）', file: 'js/chat-settings.js', needle: "if (bgLayer.style.backgroundRepeat !== rpWanted) bgLayer.style.backgroundRepeat = rpWanted;" },
  { name: '#731c 栏位让开生效值（删＝开关点了壁纸透不上来，栏位照旧盖住）', file: 'js/chat-settings.js', needle: "function barOpacityInk(index) {" },
  { name: '#731d 栏位底色读生效值变量（改回直读 --cs-*-opacity＝让开开关整条链路断开）', file: 'css/chat-main.css', needle: 'var(--cs-head-opacity-ink, var(--cs-head-opacity, .92))' },
  { name: '#731e 设置页两行锚点（删＝聊天美化里没有壁纸铺满方式/延伸栏位入口，用户无处可调）', file: 'template.html', needle: 'id="cs-bg-fullbars"' },
  // ==== 2026-09-18 #737 语音「点停止没立刻结束、卡住后时长虚涨」根治（用户：OPPO Reno6/雨见浏览器等慢壳「录 3 秒点结束→卡住→变 20 秒」，多机型复现；同 #228 家族）——最终时长按「点停止那一刻」钉死的 voiceStopTs 算，不再按结账瞬间 Date.now()（慢壳 onstop 迟到/看门狗收尾期间 Date.now() 已流逝→时长虚涨）；顺带 stop 时立即写「正在停止录音…」状态，onstop 迟到窗口不再定格「正在录音…」像卡死 ====
  { name: '#737a 停止时刻钉死（删掉按停止时刻算时长＝慢壳 onstop 迟到时「录 3 秒变 20 秒」虚涨回归）', file: 'js/chat.js', needle: 'const stopTs = voiceStopTs || voiceStartTs;' },
  { name: '#737b 停止即时反馈（删掉＝onstop 迟到时界面定格「正在录音…」像卡死回归）', file: 'js/chat.js', needle: "st0.textContent = '正在停止录音…';" },
  // ==== 2026-09-18 #732 气泡 CSS 与透明度/圆角滑块的冲突改为「滑块强制生效」（用户二次报障，接 #725 只给红字警示不解决问题：「上传了气泡 CSS 之后气泡的透明度和圆角滑了没反应」）——三条注入路径（纯声明 wrap / 整包兜底 wrap 带 !important；映射分支同特异性但 head 末尾后胜）全都压过滑块变量，改为在用户 CSS 之外追加一层 ID 级特异性 + !important 的强制回写规则，**只在用户真动过滑块（值≠默认）时才写**⇒没碰过滑块的人视觉零变化；沿用 #536 的 #page-chat 作用域不泄漏群聊 ====
  { name: '#732a 强制层函数（删＝滑块与气泡 CSS 冲突回归「滑了没反应」，只剩文字说明）', file: 'js/chat-settings.js', needle: 'function applyCssEnforce() {' },
  { name: '#732b 强制层回写透明度（删＝自定义 CSS 写了 background 时透明度滑块失效）', file: 'js/chat-settings.js', needle: "background:var(--cs-in-surface)!important" },
  { name: '#732c 强制层回写圆角（删＝自定义 CSS 写了 border-radius 时圆角滑块失效）', file: 'js/chat-settings.js', needle: "border-radius:var(--chat-bubble-radius,18px)!important" },
  { name: '#732d 强制层挂进 applySettings（删＝改滑块不刷新强制层，仍是「滑了没反应」）', file: 'js/chat-settings.js', needle: 'window.applyCsCssEnforce = applyCssEnforce;' },
  { name: '#732e 标识位置偏移变量（删＝标识位置卡在硬编码 2px/4px，气泡 CSS 一改就偏）', file: 'css/chat-main.css', needle: 'top:calc(2px + var(--msg-mark-y, 0px)); left:calc(4px + var(--msg-mark-x, 0px));' },
  { name: '#732f 时间轴偏移变量（删＝时间轴各样式位置不可调，改气泡尺寸后必偏）', file: 'css/chat-main.css', needle: 'translateX(-50%) translateX(var(--msg-time-dx, 0px))' },
  { name: '#732g 偏移量钳制（删/改窄＝滑块可写越界值，标识飞出去或被裁）', file: 'js/chat-settings.js', needle: 'const OFFSET_MIN = -40, OFFSET_MAX = 40;' },
  { name: '#732h 设置页两行锚点（删＝聊天美化里没有标识位置/时间轴位置入口）', file: 'template.html', needle: 'id="cs-mark-pos"' },
  { name: '#732i 抽屉「微调」分区（删＝边看边调里没有位置微调，只能手输数值）', file: 'js/chat-settings.js', needle: "{ key: 'tune', label: '微调'" },
  // ==== 2026-09-18 #738 词典逐卡连发不再误挂「多字卡回复」来源 tag（用户实报「词典逐条连发的时候，错误的也显示了多字卡回复」）——逐卡连发（rep.spell 非单气泡、spellOne=false）每条气泡只装一张词典卡、来源即词典，再挂「多字卡回复」是与内容不符的来源标注；#677 原在逐卡连发首条挂 `tagExtra: pyMultiExtra`，FIX 后逐卡连发分支不再带 tagExtra，仅单气泡拼字（rep.spellOne）保留两枚并列（#693 口径）====
  { name: '#738 词典逐卡连发不挂「多字卡回复」来源 chip（absent：出现 `tagExtra: si === 0 ? pyMultiExtra`＝逐卡连发首条重新挂多字卡回复 tag，「词典逐条连发还显示多字卡回复」复发）', file: 'js/chat.js', needle: 'tagExtra: si === 0 ? pyMultiExtra : null', absent: true },
  // ==== 2026-09-18 #739 头像导入「点了没反应」第三波根治（#677/#717 同族；小米17 Pro MiuiBrowser 20.21 实报三入口全灭，用户明说其他机型也有）——#717 的「常驻挂文档 input + 程序化 click()」在小米系分叉内核上仍被静默忽略（线上 08:16 包已含 #717 仍复现，实锤 JS 合成 click 路径本身不灵）。升级为原生 label 激活：device.js 新增共享助手 mochiFilePickLabel（透明 <label for=inputId> 铺满触发按钮内部，手指物理点在 label 上由内核按 HTML 原生行为转发激活 file input——中文移动网 sr-only+label 通用上传写法，全分叉一致），JS click 保留兜底（事件来自 label 时经 mochiFilePickFromLabel 跳过防同一手势双开）；input 样式统一标准 sr-only clip 写法（clip 后命中区为零不挡交互，opacity:1 免「不可见元素拒绝激活」类启发式）。五入口：桌面头像 personalize.bindAvatar / 聊天设置 chat-settings headInput（csAp+csAu 两行共用） / 群聊 group-chat pickAvatarFile（仅头像模式挂 label） / 朋友圈 feed coverAvEl / 头像互动 avatar-lib bindPoolUpload×2。压缩/落库管线一字不动。同批：开屏红色警示卡「安卓用户·请勿使用手机自带浏览器」（用户直派「开屏显眼处标红」，置顶第二位 data-browser-warn，不占 data-anti-scam 命名空间）＋ notice.json 同章双份 ====
  { name: '#739a 共享 label 激活助手（删＝五入口退回纯 JS 合成 click，小米系分叉内核「点了没反应」复发）', file: 'js/device.js', needle: 'window.mochiFilePickLabel = function (btn, input)' },
  { name: '#739b 桌面头像 label 激活（删＝桌面换头像在小米系无反应）', file: 'js/personalize.js', needle: 'window.mochiFilePickLabel(box, avatarPickInput);' },
  { name: '#739c 聊天设置头像 label 激活（删＝聊天设置换 TA 头像在小米系无反应）', file: 'js/chat-settings.js', needle: 'window.mochiFilePickLabel(csAp, headInput);' },
  { name: '#739d 群聊头像 label 激活（删＝群聊上传头像在小米系无反应）', file: 'js/group-chat.js', needle: 'window.mochiFilePickLabel(addBtn, gcAvatarPickInput);' },
  { name: '#739e 朋友圈头像 label 激活（删＝朋友圈换头像在小米系无反应）', file: 'js/feed.js', needle: 'window.mochiFilePickLabel(coverAvEl, feedAvPickInput);' },
  { name: '#739f 头像互动池 label 激活（删＝添加/添加我的头像在小米系无反应）', file: 'js/avatar-lib.js', needle: 'window.mochiFilePickLabel(btn, input);' },
  { name: '#739g 开屏红色警示卡（删＝「安卓别用自带浏览器」提示从开屏消失，用户直派要求常驻显眼标红）', file: 'template.html', needle: 'data-browser-warn="1"' },
  { name: '#739h 警示卡红色样式（删＝开屏警示卡退化成普通灰卡不再标红）', file: 'css/base.css', needle: '.splash-alert.splash-browser .splash-alert-t { color:#c22b27;' },
  // ===== #753（2026-09-18 用户直派：iPhone 13 Pro Max Safari「聊天界面发不了图片，点插入图片打开的是
  //   文件管理页面而不是相册」，明说其他机型也有）——#677/#717/#738 同族的**第四波**，本次是「聊天图片
  //   入口从没接过原生 label 兜底」这一处漏网：三个叠加原因（display:none 写法 + 无 label + accept 未
  //   落在 click 之前）一起治，两个入口（单聊 chat.js / 群聊 group-chat.js）回同一模具。
  //   改回任一条＝「点插入图片弹文件管理器/相册不在候选里/点了没反应」复发的入口。
  { name: '#753a 单聊图片选择器 sr-only clip（改回 display:none＝全站唯一残留的不可见激活写法，#717/#738 点名要消灭，部分内核拒绝激活）', file: 'js/chat.js', needle: "fi.id = 'chat-img-pick';" },
  { name: '#753b 单聊图片选择器 accept 落在 click 之前（把 accept 挪回 click 之后/丢掉＝iOS 首次激活退回通用文件选择器，相册不在候选里＝用户报「打开的是文件夹管理页面」复发）', file: 'js/chat.js', needle: "fi.accept = 'image/*'; fi.multiple = true;\nfi.onchange = () => {" },
  { name: '#753c 单聊图片按钮原生 label 激活（删＝小米系分叉内核忽略 JS 合成 click 时该按钮彻底没反应）', file: 'js/chat.js', needle: 'if (window.mochiFilePickLabel && imgBtn) window.mochiFilePickLabel(imgBtn, fi);' },
  { name: '#756e 聊天「插入图片」改走 guard（原 #753d 的 fromLabel 早退已被 #756 判定有害并移除——该写法在国产内核上会连同 JS 兜底一起掐死；本条守护新的正确写法）', file: 'js/chat.js', needle: "if (window.mochiFilePickGuard) window.mochiFilePickGuard(chatImgPickBridge(), _fb);" },
  { name: '#753e 群聊图片选择器常驻挂文档 sr-only clip（改回点击时现场 new 且未挂文档＝iOS 不派发 change「加了图片会消失」＋小米系合成 click 被忽略「点了没反应」双双复发）', file: 'js/group-chat.js', needle: "document.body.appendChild(fi);\ngcImgInput = fi;" },
  { name: '#753f 群聊图片选择器 sr-only 形态（改回 display:none＝全站唯一残留的不可见激活写法，部分内核拒绝激活）', file: 'js/group-chat.js', needle: "fi.id = 'gc-img-pick'; // 常驻身份（诊断/测试句柄）\nfi.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;" },
  { name: '#753i 群聊图片选择器 sr-only 形态＋常驻挂文档＋label 激活三连（改回「现场新建未挂文档 + display:none + 无 label」＝相册打不开/点了没反应复发）', file: 'js/group-chat.js', needle: "white-space:nowrap;';\nfi.accept = 'image/*'; fi.multiple = true;\nfi.onchange = () => {\nconst files = Array.prototype.slice.call(fi.files || []);\nfi.value = ''; // 允许重选同一张\nif (!files.length) { toast('没有取到图片，请再选一次'); return; }" },
  { name: '#753g 群聊图片按钮原生 label 激活（删＝群聊插图在小米系无反应）', file: 'js/group-chat.js', needle: 'if (window.mochiFilePickLabel && gcImgBtn) window.mochiFilePickLabel(gcImgBtn, fi);' },
  { name: '#753h 群聊空 FileList 可见反馈（改回 if (!files.length) return;＝选完没带上文件时一点提示都没有，#677h 同口径）', file: 'js/group-chat.js', needle: "const files = Array.prototype.slice.call(fi.files || []);\nfi.value = ''; // 允许重选同一张\nif (!files.length) { toast('没有取到图片，请再选一次'); return; }" },
  { name: '#742 进聊天复位钉住态（删掉并在重开时停在旧滚动位＋原生锚定开着＝「进聊天不自动到最新、跳到旧记录、加载完不落底」跨机型回归）', file: 'js/chat.js', needle: 'body.classList.remove(\'scroll-anchor-auto\');' },
  { name: '#743 长输入框保首行防抖补位（删掉＝写信/回信 tall textarea 又被拖底、首行被遮＋上下乱抖跨机型回归；短输入框走原拖底分支不受影响）', file: 'js/mobile-adapt.js', needle: "var _topHidden = sr.top - r.top;" },
  { name: '#744 同对象引用双写守卫（删掉＝同一 rec 被某条投递链原样入 addRec 两次时双气泡/双写盘跨机型复发；该守卫零误伤，不影响 #437 同内容发送语义）', file: 'js/chat.js', needle: 'msgs[len - 1] === rec' },
  { name: '#745a 帮我决定出答案两拍化（删＝答案渲染与历史全量重写/聊天落盘调度同拍，大记录设备出答案冻几秒回流）', file: 'js/decision.js', needle: 'window.requestIdleCallback(runSettle, { timeout: 600 })' },
  { name: '#745b 多人决定出答案两拍化（同 #745a 口径）', file: 'js/group-decision.js', needle: 'window.requestIdleCallback(gdRunSettle, { timeout: 600 })' },
  // ==== 2026-09-18 #746 字卡使用状态自检「导出文件」从 JSON 改 docx（用户直派：导出的 .json 手机上没有关联应用打开＝「无法导出」；
  //      与诊断报告 #227 同解：docx 由 Word/WPS 直接打开转发。主链复用 device.js diagExportDocx 三级降级（分享面板→保存框→确认后下载），
  //      第 5 参 shareTitle 参数化分享标题；card-audit.js 主链调 mochiDiagExportDocx、head 段承接原 JSON payload 结构化字段、JSON 链降兜底 ====
  { name: '#746a docx 导出入口分享标题参数化（改回硬编码「mochi 诊断报告」＝字卡自检导出标题口径错乱，第 5 参透传断）', file: 'js/device.js', needle: "shareTitle || 'mochi 诊断报告'" },
  { name: '#746b 字卡自检导出走 docx 主链（删掉＝退回 JSON 导出，用户手机上导出的文件打不开＝「无法导出 docx」复发）', file: 'js/card-audit.js', needle: "window.mochiDiagExportDocx(head + lastText, 'mochi-card-audit-'" },
  // ==== 2026-09-18 #747 默认字卡开关切联系人桌面不刷新（用户实报 iPhone17Pro Edge「关闭默认字卡使用时依旧能发、再看又是开的」，多机型同现）——根因：default-cards.js 的 contact-switched 监听只刷新 dcf-* 概率行，漏刷 dc-enabled/dc-use-*/dc-cat-*/dc-overall-*/dc-prob-* 开关 UI；这些键 per-cid 隔离，切桌面后已渲染的 checkbox 停留旧桌面勾选，用户在旧状态上操作 → setCat/setUse 写到当前桌面但 UI 显示旧桌面 → 关了写错桌面、切回 default 照发、再看又是开的。修：抽 syncDcSwitchUI() 统一刷新全部 dc-*/dcf-* 开关与概率行，contact-switched 与 mochi-restore-done 都调 ====
  { name: '#747 切联系人桌面刷新默认字卡开关UI（删＝dc-* per-cid 开关在设置页显示旧桌面勾选，用户关了写错桌面→关了还能发、再看又是开的多机型复发）', file: 'js/default-cards.js', needle: 'document.addEventListener(ev, function () { try { syncDcSwitchUI(); } catch (e) {} });' },
  // ==== 2026-09-18 #748 四类互动卡概率写入 `parseInt||5` 吃 0（用户实报「吐槽概率调0依旧触发发送」）——根因：ta-ask.js 询问/小问题/好奇/吐槽四类概率写入 `parseInt(value,10)||5`，0 是 falsy 被回退成默认 5，存盘值 5 而非 0，定时触发 maybeTriggerTR 仍有 5% 概率掷中。修：改 `Math.max(0,Math.min(100,parseInt(value,10)||0))` 钳 0~100 保留 0；读取侧 `typeof s.prob==='number'?s.prob:5` 本就正确无需改 ====
  { name: '#748a 吐槽概率0不被||5吃掉（删＝tr-prob 写 0 存成 5，吐槽概率调0依旧触发复发）', file: 'js/ta-ask.js', needle: 'Math.max(0, Math.min(100, parseInt(trProb.value, 10) || 0))' },
  { name: '#748b 询问概率0不被||5吃掉（同 #748a）', file: 'js/ta-ask.js', needle: 'Math.max(0, Math.min(100, parseInt(askProb.value, 10) || 0))' },
  { name: '#748c 小问题概率0不被||5吃掉（同 #748a）', file: 'js/ta-ask.js', needle: 'Math.max(0, Math.min(100, parseInt(tcProb.value, 10) || 0))' },
  { name: '#748d 好奇概率0不被||5吃掉（同 #748a）', file: 'js/ta-ask.js', needle: 'Math.max(0, Math.min(100, parseInt(tcuProb.value, 10) || 0))' },
  // ==== 2026-09-18 #749 聊天消息重复成多条（iQOO Neo9 + Chrome 实报，多机型复现）====
  // 用户：「聊天里会弹出重复消息，切换聊天人退出重新进就没有了，但如果退出聊天页面再进去就有了。
  // 我的消息和联系人的消息都一直重复多条，其实就是只发了一条，但显示成了多条。」
  // 根因：chatTailMerge 的「是否已落盘」判定只用 chatTailSig ＝ ts|side|text[:120]。而 normCell
  // 会**原地改写** r.text（ICON_BELL→ICON_TEL、拍一拍 ✉️→ICON_ENV），编辑消息/词典重建同样改写正文。
  // 正文一变，尾巴日志条目的签名就与 msgs 对不上 ⇒ 被判定「还没落盘」⇒ 回放成重复条目；日志又永不清空
  // ⇒ 之后每次权威读库都再回放一份。修法：加与正文无关的稳定身份 chatTailId ＝ ts(毫秒)|side|special
  //（与 idbTsSide / recKindCovers 的记录身份口径同源），回放前先按它查重。
  { name: '#749a 尾巴日志稳定身份 chatTailId（删＝回放判重退回比正文，正文被归一化/编辑后就重复回放，用户报障复发）', file: 'js/chat.js', needle: 'function chatTailId(m) {' },
  { name: '#749b 回放前建 haveId 身份集（删＝判定漂移复发）', file: 'js/chat.js', needle: 'haveId.add(chatTailId(msgs[i]));' },
  { name: '#749c 回放条目按稳定身份跳过已落盘者（删＝重复消息回放复发）', file: 'js/chat.js', needle: '|| haveId.has(chatTailId(j))' },
  // ==== 2026-09-18 #750/#751（已被 #762 取代）聊天壁纸打字时变小 / 莫名其妙放大 ====
  // 这两批把 background-size 折算成「冻结盒尺寸」的显式像素（csBgPaintSize + csBgStableBox 锚盒
  // + csBgMeasure 量原图 + 键盘闸门 + 双读 settle）。#762 实测证明这条路本身要的是一个「一直在变、
  // 又必须提前知道」的盒：对 HEAD 产物复跑 tools/verify-chat-bg-fill.mjs ⇒ 进聊天即 painted=379x718
  // 而盒 390x844（上下各露一条底色）、视口涨落后 painted 永久停在 445x844、平铺档算出 auto（2160×4096
  // 原图只露中间一小块）＝用户报的「四档全废、连正常铺满都没有」。相关代码与这八条哨兵一并删除。
  { name: '#750a 壁纸铺满档位映射成合法 CSS（删＝fill/未知值又写出非法声明→回退 auto，图又按原图原始像素渲染）', file: 'js/chat-settings.js', needle: 'function csBgFitCss(fit) {' },
  // ==== 2026-09-18 #762 聊天壁纸「铺满方式」四档全废 · 常驻图层根治（用户实报，明说多机型同现）====
  // 用户：「聊天设置里的【壁纸铺满方式】全部有问题，也没有之前那样正常的全部铺满的了。」
  // 修法＝壁纸不再画在 #page-chat 自己身上，改画在它的首个子层 #cs-bg-layer 上（z-index:-1；
  // .page 本身 z-index:2 ＝ 独立层叠上下文，故该层恰好压在页面底色之上、气泡与栏位之下，零内容改动），
  // background-size 交回 CSS 关键字；手机端「铺满裁剪」档另加 `min-height:100lvh` 下限（老内核退回
  // 100vh，两条分写整条丢弃式兜底）。lvh 是设备常量 ⇒ 键盘压矮 .phone（#750）与地址栏涨落 dvh
  //（#751）都改不动壁纸的盒 ⇒ 缩放比恒定、永不露底，旋转仍能按新宽重算。零机型分支。
  // 行为断言：tools/verify-chat-bg-fill.mjs（GREEN 32/32 ｜ HEAD 产物 RED 21 红 ｜ 删下限变异 6 红）。
  { name: '#762a 壁纸常驻图层挂进 #page-chat 首位（删＝壁纸无处落脚或盖住内容，四档全部失效复发）', file: 'js/chat-settings.js', needle: 'chatPage.insertBefore(l, chatPage.firstChild);' },
  { name: '#762b 图层内联兜底（四长手 + z-index:-1；老内核丢弃不认识的选择器时靠它，删＝塌 0x0 全露底）', file: 'js/chat-settings.js', needle: 'z-index:-1;pointer-events:none;display:none;' },
  { name: '#762c lvh 下限按档位挂/摘（删＝下限恒开或恒关，contain/tile 被裁掉一截或 fill 档键盘期重算缩放比）', file: 'js/chat-settings.js', needle: "chatPage.classList.toggle('cs-bg-fill', fit === 'fill');" },
  { name: '#762d 平铺档给出看得见重复的尺寸（退回 auto＝2160×4096 原图一屏只露中间一小块＝「平铺没反应」）', file: 'js/chat-settings.js', needle: "if (fit === 'tile') return '33.333% auto';" },
  { name: '#762e lvh 下限规则在位（删＝回到「壁纸的盒＝会变的页面盒」，#750 打字时图变小与 #751 放大双双回流）', file: 'css/chat-main.css', needle: 'html.force-mobile #page-chat.cs-bg-fill #cs-bg-layer,' },
  { name: '#762y 禁止显式像素冻结路线复活（absent：csBgPaintSize 回来＝又去折算「提前知道」的盒，四档全废的根因）', file: 'js/chat-settings.js', needle: 'csBgPaintSize', absent: true },
  { name: '#762z 禁止原图尺寸缓存复活（absent：__csBgNat 回来说明又走量图折算，resize 抖动随之回来）', file: 'js/chat-settings.js', needle: '__csBgNat', absent: true },
  // ==== 2026-09-18 #754 桌面翻页卡顿·合成层修复（iPhone 15 Pro Max 自带浏览器/独立应用实报「刚进网站会顺，一会就卡着不动、连续点好几次才能切换」，明说其他机型也有；诊断实锤：桌面翻页 平均186ms / p90 719ms / 最慢3611ms 而【性能】长任务>50ms 为零＝主线程没堵、卡在合成/栅格层，且 html 类无 tablet、无 zoom 声明＝#707 那批已修面之外）。根因＝整页背景图（page-bg-N，用户实测 273.7KB）画在「横向快照滚动 + 每页自带纵向滚动」的嵌套滚动页 `.page-slide` 上，翻页时图层纹理不被保活即逐帧重栅格化/重解码整屏大图（与 #147 壁纸「常驻图层纹理保持存活、不再反复解码」同源病灶）。修复＝personalize.js applyPageBgs 按 DOM 实态挂 `.has-page-bg` 类（无整页背景图不挂＝零额外显存），home.css 在触屏门控下把三页提升为独立合成层（翻页只平移纹理）。门控防跨机型回归：仅 hover:none + pointer:coarse；电脑端外壳零变化。node --check 过（personalize.js）；行为验证 tools/verify-desk-flip-layer.mjs ====
  { name: '#754a 桌面翻页合成层提升（删＝整页背景图在滚动页上被逐帧重栅格化，翻页秒级掉帧回归）', file: 'css/home.css', needle: '.desktop-pages.has-page-bg .page-slide { will-change: transform; }' },
  { name: '#754b 整页背景图实态挂类（删＝合成层规则永不命中，修复空转）', file: 'js/personalize.js', needle: "pagesBox.classList.toggle('has-page-bg', anyPageBg);" },

  // ==== 2026-09-18 #755 全站图片/文件选择入口统一收口（用户直派：vivo X200s + 百度浏览器
  // （SP-engine/T7 内核）实报「任何图片，上传无反应；上传头像点了相册点了图片，但是没有任何反应」，
  // 明说其他机型也有、要求不要覆盖式修补）。同族第五波：#677（input 要挂文档）→#717（去
  // display:none）→#738（加原生 label）→#753（聊天两入口 + accept 前置）四轮都只覆盖「部分入口」，
  // 而全站仍有十余个入口在点击时现场 new input、从不挂文档、无 label 兜底、accept 迟到——每修一处
  // 用户下次就在另一处报同一症状，这正是「反复出现」的结构性原因。本轮改为**单一实现 + 全站调用**：
  // device.js 新增 window.mochiFilePick（常驻 sr-only clip input 挂 body + accept/multiple 强制落在
  // click() 之前 + 可选原生 label 激活层 + 最后才 click），18 个入口改走它（personalize x7 / feed x4 /
  // chat x3 / chat-settings x3 / group-chat x4 / mail x2 / music-player x3 / data-backup x2 / sfx /
  // call / bg-keep / feature-data / chatcard），并把 chatcard.pickFiles 这支「手抄版」也收编。
  // 下游哨兵盯「统一实现本身」+「各入口确实调它」两类，防止并行会话回退成手抄写法。====
  { name: '#755a 统一文件选择入口存在（删＝全站入口退回各自手抄「现场 new input」写法，accept 迟到/无 label 兜底/未挂文档三类机型 bug 一并复发）', file: 'js/device.js', needle: 'window.mochiFilePick = function (opts) {' },
  { name: '#755b 统一入口的 accept 强制落在 click 之前（把 input.accept 挪到 click 之后＝iOS/部分内核首次激活带空 accept 问系统，退回文件管理器而非相册，用户报「打开的是文件夹管理页面」）', file: 'js/device.js', needle: "input.accept = o.accept || '';" },
  { name: '#755c 统一入口的 sr-only clip 形态（改回 display:none 或 opacity:0＝部分内核对不可见 file input 拒绝激活，点了没反应）', file: 'js/device.js', needle: "input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';" },
  { name: '#755d 统一入口的常驻挂 body（改成 detached＝iOS 对未挂载 file input 不保证派发 change「加了图片会消失」）', file: 'js/device.js', needle: 'document.body.appendChild(input);' },
  { name: '#755e 统一入口的原生 label 激活兜底（删＝小米系/分叉内核忽略 JS 合成 click 时该入口彻底没反应）', file: 'js/device.js', needle: 'if (o.btn && window.mochiFilePickLabel) window.mochiFilePickLabel(o.btn, input);' },
  { name: '#755f 头像入口（personalize 桌面头像）保持走统一入口（回退成 detached 手抄＝#677 复发）', file: 'js/personalize.js', needle: "id: 'mochi-desk-img-pick', accept: 'image/*'" },
  { name: '#755g 桌面图标上传走统一入口（回退＝部分内核不可见 input 拒绝激活，换图标点了没反应）', file: 'js/personalize.js', needle: "id: 'mochi-appicon-pick', accept: 'image/*'" },
  { name: '#755h 聊天表情包上传走统一入口（用户报「点了相册点了图片但没有任何反应」＝选完文件回调链没触发）', file: 'js/chat.js', needle: "id: 'mochi-myemoji-pick', accept: 'image/*', multiple: true" },
  { name: '#755i 朋友圈评论配图不再用 display:none（#717/#738 点名要消灭的写法）', file: 'js/feed.js', needle: "id: 'mochi-com-img-pick', accept: 'image/*'" },
  { name: '#755j 字卡库选择器收编统一入口（回退成手抄 offscreen+opacity:0 版本＝部分内核拒绝激活）', file: 'js/chatcard.js', needle: "id: 'cc-file-pick', accept: accept || '', multiple: !!multiple" },
  { name: '#755k 备份导入选择器走统一入口（回退成 detached/display:none ＝真我 Edge「导入点了没反应」复发；accept 仍刻意留空以避开国产 ROM 过滤兼容 bug）', file: 'js/data-backup.js', needle: "id: 'mochi-backup-import-pick', accept: ''" },
  { name: '#755l 纪念日档案配图不再用 display:none（改回＝部分内核不可见 input 拒绝激活）', file: 'js/memo-arc.js', needle: "inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'narc-img-input';" },
  { name: '#755m 音乐歌单/单曲封面上传走统一入口（回退成 display:none 单例＝点了没反应）', file: 'js/music-player.js', needle: "id: 'mochi-pl-cover-pick', accept: 'image/*', noClick: true, onFiles: covPickOpts.onFiles" },
  { name: '#755n 红包封面选择器不再 detached（原实现从未 appendChild＝iOS 不派发 change）', file: 'js/chat.js', needle: "id: 'mochi-rp-cover-pick', accept: 'image/*', btn: rpCoverUploadBtn" },
  { name: '#755o 礼物店图片选择器 sr-only 化（回退 offscreen+opacity:0＝部分内核拒绝激活）', file: 'js/gift-shop.js', needle: "gmImgInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;" },
  { name: '#755p 占卜换牌面走统一入口（回退成 template 里 hidden input＝display:none，部分内核拒绝激活，点「换牌面」无反应）', file: 'js/divination.js', needle: "id: 'dev-divf-img-pick'," },
  { name: '#755q 占卜批量上传走统一入口（回退同上；accept 必须在 click 前落定否则弹通用文件管理器）', file: 'js/divination.js', needle: "id: 'dev-divf-batch-pick'," },
  { name: '#755r 占卜牌面 JSON 导入走统一入口（回退同上）', file: 'js/divination.js', needle: "id: 'dev-divf-json-pick'," },
  { name: '#755s 朋友圈「添加图片」走统一入口（原 #feed-pick-file 写在 template.html 带 hidden 属性＝display:none）', file: 'js/feed.js', needle: "id: 'dev-feed-pick-img'," },
  { name: '#755t 朋友圈封面背景走统一入口（原 #feed-cover-file 同样写在 template.html 带 hidden）', file: 'js/feed.js', needle: "id: 'dev-feed-cover-bg'," },
  { name: '#755u 通用弹窗「从文件导入」走统一入口（原 #modal-file-input 带 style="display:none"）——回退＝所有 txtImport 弹窗（字卡导入等）在部分内核点了没反应', file: 'js/personalize.js', needle: "id: 'dev-modal-file-pick'," },
  { name: '#755v 聊天壁纸「上传新图」走统一入口（原 csBgFileInput 用 left:-9999px+opacity:0，与 display:none 同族不可见写法）', file: 'js/chat-settings.js', needle: "id: 'dev-cs-bg-pick'," },
  // ==== 2026-09-18 #757 刷新/重开后通话没续上、也没挂断记录（小米 civi4pro 夸克实报，多机型）====
  //   恢复窗口原按「心跳 ts 10 分钟窗」判定，而心跳是 setInterval——页面被系统冻结/杀进程时不跑，
  //   ts 停在被冻结那刻；用户回来（尤其杀后台后重开＝新运行期、SS 已空）走 LS 兜底即被判「早已结束」
  //   → 静默清标记：不续、不记。修法四条各配一条锚，删任一条即对应症状回流。
  { name: '#757a SS/LS 用通话语义墙钟窗、IDB 副本仍卡 10 分钟静默窗（退回单窗＝锁屏冻结过 10 分钟的通话仍会无声消失）', file: 'js/call.js', needle: "const windowMs = src === 'idb' ? CALL_IDB_WINDOW : CALL_RESUME_WINDOW;" },
  { name: '#757b 墙钟窗常数在位（删/改小到分钟级＝用户手机上那通电话还是会在重开后不复原）', file: 'js/call.js', needle: "const CALL_RESUME_WINDOW = 6 * 3600 * 1000;" },
  { name: '#757c 超窗的 SS/LS 快照补写「通话中断」记录（删掉＝回到静默清标记＝无挂断记录）', file: 'js/call.js', needle: "if (src !== 'idb') writeInterruptRecord(info);" },
  { name: '#757d 隐藏/冻结/离页立刻冲刷通话标记（删掉＝ts 停在上一个心跳，冻结越久越易被判过期）', file: 'js/call.js', needle: "document.addEventListener('freeze', function () { try { flushCallActive(); } catch (e) {} });" },
  { name: '#757e 中断记录统一出口（三条路径共用；删掉＝超窗/恢复失败时无记录）', file: 'js/call.js', needle: "function writeInterruptRecord(info) {" },
  { name: '#757f 恢复中途出错先清干净半截通话再补记录（删掉 currentCall = null＝占用门恒真，联系人来电被永久拦死）', file: 'js/call.js', needle: "currentCall = null; shownAv = null; shownName = null;" },
  { name: '#757g 通话标记不再内嵌头像 dataURL（回退＝每 20 秒三路各写 52KB，弱内核写入失败的放大器）', file: 'js/call.js', needle: "name: currentCall.name || '', av: '', ts: Date.now()" },
  { name: '#757h idbRestore 不回填 call-active（删掉＝IDB 幽灵被抄进 LS 当「本机真实标记」，#705 幽灵通话在墙钟窗内复活）', file: 'js/idb.js', needle: "k !== 'xy-home-v2:call-active' &&" },
  // ==== 2026-09-18 #758 「导出docx 无法下载」（小米 civi4pro 夸克实报，多机型同族：BUGS #172/#173/#333/#701）====
  //   合成 a[download]（blob:）无成功回调，壳浏览器静默丢弃时用户彻底没辙；修法＝给用户自己能按的第二条活路。
  { name: '#758a 下载触发后按内核给换路追问（删掉＝壳浏览器下载被丢弃后无任何补救路径）', file: 'js/data-backup.js', needle: "function afterDownloadAttempt(blob, fname, shareTitle, saveTypes, doneText, failText) {" },
  { name: '#758b 只对 brokenFileShare 内核加这一步（删掉＝所有浏览器都多一步；改成恒真＝给正常内核添噪音）', file: 'js/data-backup.js', needle: "if (!brokenFileShareEnv()) return;" },
  { name: '#758c data: URL 直下通道（删掉＝分享不可用的壳浏览器只剩 blob: 这一条被丢的路）', file: 'js/data-backup.js', needle: "function anchorDownloadDataUrl(blob, fname, cb) {" },
  { name: '#758d 换路首选手势触发的系统分享面板（删掉＝壳浏览器唯一可靠保存通道没了）', file: 'js/data-backup.js', needle: "navigator.share({ files: [file], title: shareTitle || 'mochi 导出文件' })" },
  { name: '#758e 换路追问弹窗在位（删掉＝用户看不到第二条活路）', file: 'js/data-backup.js', needle: "window.openModal('文件已保存了吗？', '', null, {" },
  // ===== FIX 2026-09-18 #756：本族第六波——「label 早退」把 JS 兜底一并掐死 =====
  // 用户二次实报「其他手机型号也这样，上传头像……不止这一个」。根因＝#738 的配套写法
  // `if (fromLabel(e)) return;` 假设「label 存在 ⇒ 原生转发必成功」，而 vivo 百度 SP-engine/T7
  // 等国产内核 label 存在却不转发（也不报错、不派发可用于判断的事件）⇒ 两条激活路径全不走。
  // 修法＝mochiFilePickGuard 事后确认「真没弹出选择器」再补 JS click，全站禁止 fromLabel 早退。
  { name: '#756a 统一「兜底守护」（device.js）：以 focus/click/change 信号判定选择器是否真弹出，未弹出才补 click（本条是整族修复的地基）', file: 'js/device.js', needle: "window.mochiFilePickGuard = function (input, onMiss) {" },
  { name: '#756b 统一入口 mochiFilePick 不再依赖 o.btn 之外的条件即激活：改为无 fromLabel 早退、走 guard', file: 'js/device.js', needle: "if (o.btn && window.mochiFilePickGuard) window.mochiFilePickGuard(input, activate);" },
  { name: '#756c 桌面头像入口（personalize bindAvatar）改走 guard——回退＝用户实报的「上传头像点了相册点了图片但没反应」', file: 'js/personalize.js', needle: "if (window.mochiFilePickGuard) window.mochiFilePickGuard(avatarPickInput, _fallback);" },
  { name: '#756d 头像库上传（avatar-lib bindPoolUpload）改走 guard', file: 'js/avatar-lib.js', needle: "if (window.mochiFilePickGuard) window.mochiFilePickGuard(input, _fb);" },
  { name: '#756f 朋友圈封面头像改走 guard', file: 'js/feed.js', needle: "if (window.mochiFilePickGuard) window.mochiFilePickGuard(feedAvPickInput, _fb);" },
  { name: '#756g 群聊「上传头像」改走 guard', file: 'js/group-chat.js', needle: "if (window.mochiFilePickGuard) window.mochiFilePickGuard(gcAvatarPickInput, _fb);" },
  { name: '#756h 群聊「插入图片」改走 guard', file: 'js/group-chat.js', needle: "if (window.mochiFilePickGuard) window.mochiFilePickGuard(fi, _fb);" },
  { name: '#756i 设置页「TA 的头像」改走 guard', file: 'js/chat-settings.js', needle: "if (window.mochiFilePickGuard) window.mochiFilePickGuard(headInput, _fb);" },
  { name: '#756j 设置页头像行点按时先武装回调（#813 换锚：两行合并进 headActivate 单点激活，本条改钉武装调用点；改回「在兜底里才 arm」即消失）', file: 'js/chat-settings.js', needle: "armHead((data) => {" },
  { name: '#756k 音乐歌单封面改走 guard', file: 'js/music-player.js', needle: "if (_input && window.mochiFilePickGuard) window.mochiFilePickGuard(_input, pickCover);" },
  // 反哨兵（absent）：全站禁止再出现「点源自 label 就直接 return」的早退写法
  { name: '#756z 全站禁止 fromLabel 早退（`fromLabel(e)) return`）——该写法会掐死国产内核上的唯一兜底路径', file: 'js/', needle: 'mochiFilePickFromLabel(e)) return', absent: true },
  // ==== 2026-09-18 #759 房间（双人小屋）三处咬合的结构性修复（用户派单「检查房间还能怎么优化」，代码审计发现，非用户实报）：
  //   ① CAT[*].grp 是英文兜底键，却被当成分组名传给 getLibPool('room',分组)，而库里分组是中文
  //     （坐到旁边/家具互动/浇水/…）⇒ 点家具永远只出 FB 那 3~5 句内置短句、库内 60+ 句从未出现、
  //     字卡库【房间】逐张开关对家具完全无效（verify-room B15 只测了中文的『进门』组，所以从没红过）。
  //     lampFeedback 同族更糟：分组与兜底键都写死 '灯亮'（既非库分组也不在 FB）⇒ 池与兜底双空
  //     ⇒ rnd([]) 把字面量 "undefined" 吐进气泡。
  //   ② 三条「延时补话」都带 `if (!bubbleEl.hidden) return` 让路守卫，但首条气泡固定挂 3800ms 而
  //     补话排在 900~1300ms ⇒ 守卫必命中，点灯/关灯/夜里点窗的第二句一次都没播过（①的 "undefined"
  //     正是被这条挡死才没见光——两批必须同修）。
  //   ③ d.lit 按「家具类型」记 ⇒ 同种两盏灯（MAX_PER_TYPE=2）只能同开同关、地板重复投影；
  //     收回最后一盏灯不清键 ⇒ lum() 继续按「不存在的灯」给整屋增亮、买回来直接是亮的。
  { name: '#759a 字卡分组经 GRP 表换算（删＝英文键又被当库分组名传进去，家具话术退回内置短句、逐张开关再度失效）', file: 'js/room.js', needle: 'GRP[group] || group' },
  { name: '#759b 池与兜底双空时不出声（删＝rnd([]) 把字面量 "undefined" 吐进气泡）', file: 'js/room.js', needle: "if (!arr.length) return '';" },
  { name: '#759c 双段话术首条短驻留（删/改回无参调用＝补话的让路守卫必命中，点灯与夜里点窗的第二句又变死代码）', file: 'js/room.js', needle: 'bubble(sayLine(c.grp, c.grp), BUB_SHORT);' },
  { name: '#759d 补话时刻排在首条气泡之后（改回 900~1300ms＝又落进首条驻留期内被守卫吞掉）', file: 'js/room.js', needle: 'near ? BUB_AGAIN : BUB_AGAIN + 400' },
  { name: '#759e bubble 支持自定义驻留时长（删掉 ms 形参＝双段话术无处安身，两拍节奏回归单拍常驻）', file: 'js/room.js', needle: 'bubT = setTimeout(() => { bubbleEl.hidden = true; }, ms || 3800);' },
  { name: '#759f 灯光开关按实例记、关灯即删键（改回类型键＝同种两盏灯同开同关且残键继续增亮）', file: 'js/room.js', needle: 'if (on) d.lit[inst.i] = true; else delete d.lit[inst.i];' },
  { name: '#759g 亮度只按在场实例的灯计（改回 Object.keys(d.lit)＝收回全部灯后房间仍按有灯增亮）', file: 'js/room.js', needle: 'd.fx.forEach(it => { if (d.lit[it.i]) v += 0.12; });' },
  { name: '#759h 旧档 lit 类型键迁移到实例键（删＝升级后老存档的灯全灭、且类型残键永久赖在表里）', file: 'js/room.js', needle: 'if (o.fx.some(f => f.i === k)) return;' },
  // 反哨兵（absent）：③的两处旧写法不得复活
  { name: '#759z 禁止灯光状态回退为按类型记（出现 `d.lit[it.t]`/`d.lit[inst.t]`＝同种两盏灯又同开同关）', file: 'js/room.js', needle: 'd.lit[it.t]', absent: true },
  { name: '#759y 禁止 sayLine 再收到库内不存在的分组名（回退为按 灯亮 作分组/兜底键＝池与兜底双空、气泡吐 undefined）', file: 'js/room.js', needle: "sayLine(g, '灯亮')", absent: true },
  // ==== 2026-09-18 #760 聊天美化「边看边调」抽屉遮挡自救批（用户派单「检查边看边调还能怎么优化」，全部落地）：
  //   ① 键盘抬升——抽屉是 fixed 层，安卓 resizes-visual 下键盘弹起时输入框缩到键盘后面（聊天版独有，
  //     桌面抽屉无文本输入）；② grip/标题行可竖向拖动＋会话内记忆（#562 只留了声明、grip 一直是装饰）；
  //   ③ 打开滚到最新消息＋空对话注入示例气泡（否则「改哪看哪」无从看起）；④ FLOAT_SELECTORS 登记锁背景；
  //   ⑤ 补设置页有而抽屉缺的 cs-send-show / cs-time-ink；滑杆双击复位、调色盘收起、热区垫高。
  { name: '#760a 键盘抬升按 visualViewport 实遮挡计算（删＝安卓打字时抽屉输入框缩键盘后面，「全局字体/气泡CSS」盲打复发）', file: 'js/chat-settings.js', needle: 'const lift = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;' },
  { name: '#760b 拖动松手近底吸附回贴底（删＝抽屉停在拖到的任意位置成残留遮挡；改成恒 null＝拖动功能整个失效）', file: 'js/chat-settings.js', needle: 'if ((csBeautyDockBot || 0) < 24) csBeautyDockBot = null;' },
  { name: '#760c 示例气泡带 data-cs-demo 身份标记（删标记＝#760e 清理逻辑扫不到，假气泡残留进正常聊天）', file: 'js/chat-settings.js', needle: "m.dataset.csDemo = '1';" },
  { name: '#760d 空对话才注入示例气泡（删掉 .msg 判定＝有真消息也叠一对假气泡；整行删＝空聊天页无从预览复发）', file: 'js/chat-settings.js', needle: "if (!cb.querySelector('.msg')) csDemoBubbles(true);" },
  { name: '#760e 示例气泡统一清理口（删＝关抽屉后预览假消息留在聊天流里）', file: 'js/chat-settings.js', needle: "Array.prototype.forEach.call(body.querySelectorAll('.msg[data-cs-demo]'), n => n.remove());" },
  { name: '#760f 抽屉登记滚动锁（删＝抽屉开着底层聊天页整页仍可被滑，#527 同族缺口回流到聊天版）', file: 'js/mobile-adapt.js', needle: "'#chat-beauty-drawer'," },
  { name: '#760g 抽屉补发送按钮显示/隐藏（删＝该设置项回到只能盲调、必须回设置页才能看效果）', file: 'js/chat-settings.js', needle: "() => store.get('cs-send-show') || 'show'" },
  { name: '#760h 抽屉补时间轴文字色（删同上：时间轴配色回到设置页专属）', file: 'js/chat-settings.js', needle: "mkColorItem('时间轴文字色', 'cs-time-ink', DEF.timeInk, BUBBLE_INK_COLORS)" },
  { name: '#760i 滑杆双击复位通道（删＝#760 批 def 参数全成死参，就地恢复默认失效）', file: 'js/chat-settings.js', needle: "inp.addEventListener('dblclick'" },
  // 旧针「颜文字保真空格＝气泡 span 全局 pre-wrap 规则在位」随 #817 换锚：该规则已撤（quirky 内核竖排病灶），
  // 契约改由 #817a（内容层多空格→&nbsp; 在位）＋#817b（该规则不得回流，absent 型）两针共同把守，见数组头部。
  { name: '引用块内颜文字保真空格（.msg-quote-text white-space:pre-wrap，删掉＝引用一条含颜文字的消息时预览里空格被折叠、与气泡不一致复发；needle 取单行——build 会剥掉 CSS 行首缩进，多行含缩进的 needle 在产物里永远匹不上）', file: 'css/chat-main.css', needle: 'color:inherit; opacity:.8; word-break:break-word; white-space:pre-wrap;' },
  // ==== 2026-09-18 #763 钓鱼三小优化（读盘记忆化 / 静音偏好持久化 / 日封顶前置可见）====
  // 心跳每 1.2s renderPage 重复 JSON.parse 同键（厨房页 loadToday+loadCook+loadBox 双读）→ 原始串不变复用解析结果；
  // 缓存键带 activePrefix() 命名空间防跨联系人串档；soundOn 原重开 App 即丢；¥104 日封顶原只在撞限 toast 才首次告知。
  { name: '#763a 钓鱼读盘记忆化命中条件（删＝心跳恢复每拍重复 JSON.parse，iOS 后台回收前多余解析开销回流）', file: 'js/fishing.js', needle: 'if (c && c.raw === raw) return c.val == null ? fb : c.val;' },
  { name: '#763b 记忆化缓存键带联系人命名空间（删＝切联系人后读到上一桌面的解析结果＝数据串档）', file: 'js/fishing.js', needle: "(window.activePrefix ? window.activePrefix() : '') + '|' + key" },
  { name: '#763c 钓鱼静音偏好落盘（删＝重开 App 静音设置丢失，用户被音效打扰复发）', file: 'js/fishing.js', needle: "writeJSON('fishing-sound', { on: soundOn });" },
  { name: '#763d today 脏键并入日封顶用量（删＝厨房页卖菜后切回今日页封顶提示滞留旧值）', file: 'js/fishing.js', needle: "key = 'today:' + JSON.stringify(loadToday()) + ':' + fishCoinCap();" },
  { name: '#763e 日封顶用量提示样式在位（删＝renderToday 的 .fish-capnote 裸奔无样式）', file: 'css/chat-pages.css', needle: '.fish-capnote { margin-top:6px; text-align:center; font-size:10.5px;' },
  // ==== v3.26.x #769 底部导航栏美化（三按钮上传图标图片 + 栏透明度/底色/圆角/模糊/图标大小）====
  // 用户直派新功能（「底部导航栏的三个图标按钮，也可以上传图标图片。然后也可以调整透明度。
  // 调整这一行的透明度和这一行的样式」）。行为断言 tools/verify-tabbar-beauty.mjs。
  // 整栏透明度双保险＝设计缺陷防线：①图标层 12% 下限（防「栏透明到消失找不回」）②触摸显形。
  { name: '#769a 整栏透明度图标层 12% 下限（删下限/改回 wholeOp 直乘＝整栏拉透明时导航图标随背景一起消失，用户找不回入口＝已知设计缺陷回流）', file: 'js/personalize.js', needle: 'const icoA = Math.max(wholeOp, 12) / 100;' },
  { name: '#769b 背景透明度＝两根滑杆叠乘（改回单因子＝「背景透明度」与「整栏透明度」互相覆盖，一个动另一个失效）', file: 'js/personalize.js', needle: 'const bgA = Math.round(bgOp * wholeOp) / 10000;' },
  { name: '#769c 按钮图片恒等跳过（删＝切联系人/回填扇出时 MB 级 dataURL 反复重解码，#249 切桌面卡死同族回流）', file: 'js/personalize.js', needle: 'else if (img.src === data) { applyTabIconLook(tab); return; }' },
  { name: '#769d 上传落库链（删＝选完图不持久化，重开底部栏图标丢失）', file: 'js/personalize.js', needle: "store.set('tab-icon-' + pageKey, data);" },
  { name: '#769e 边看边调「底部栏」分区在位（删＝抽屉入口消失）', file: 'js/personalize.js', needle: "{ key: 'tabbar', label: '底部栏', build: () => {" },
  { name: '#769f IDB 回填后重绘底部栏图标（删＝大键只存 IDB 的机型启动读到空，图标整会话不显示）', file: 'js/personalize.js', needle: 'try { restoreTabbarIcons(); } catch (e) {} // #769h1' },
  { name: '#769g 切桌面按新命名空间重刷底部栏（删＝tab-icon-* per-cid 键跨桌面串档/滞留旧桌面图）', file: 'js/personalize.js', needle: 'try { restoreTabbarIcons(); } catch (e) {} // #769h2' },
  { name: '#769i 导入/撤销写回支持 tab-icon-* 动态键（删回三条前缀＝方案导入/撤销后按钮图片静默丢失）', file: 'js/personalize.js', needle: "(k.indexOf('app-icon-') === 0 || k.indexOf('desk-image-src-') === 0 || k.indexOf('tab-icon-') === 0)" },
  // CSS needle 按 minifyCss 产物形态逐字写（剥注释/行首缩进、保行内空格与分号）
  { name: '#769j 底栏底色走 color-mix 透明度链（删回纯色 background＝「背景透明度」滑杆整条失效）', file: 'css/tabbar.css', needle: 'background:color-mix(in srgb, var(--tabbar-bg-color, var(--tabbar-base-bg, #ffffff)) calc(var(--tabbar-bg-a, 1) * 100%), transparent);' },
  { name: '#769k 图标层透明度吃变量（改回无 opacity＝整栏透明度失效）', file: 'css/tabbar.css', needle: 'opacity:var(--tabbar-ico-a, 1);' },
  { name: '#769l 上传按钮图片渲染规则（删＝img 裸尺寸/无裁切，图标大小与圆角滑杆失效）', file: 'css/tabbar.css', needle: '.tabbar .tab img { width:var(--tabbar-ico-size, 23px); height:var(--tabbar-ico-size, 23px); object-fit:cover; display:block; border-radius:calc(var(--tabbar-ico-size, 23px) * .3); }' },
  { name: '#769m 触摸显形（删＝低透明度下按压无任何反馈，「看不见也知道那里有导航」防线失效）', file: 'css/tabbar.css', needle: '.tabbar.tabbar-faint:active .tab { opacity:1; }' },
  { name: '#769n 深色模式喂底色变量而非盖死 background（改回直接覆盖＝深色下透明度滑杆失效，#769j 链在深色断掉）', file: 'css/dark.css', needle: '[data-theme="dark"] .tabbar { --tabbar-base-bg:var(--dark-card-92); border-color:var(--dark-border-12); }' },
  { name: '#769o 设置页「底部栏美化」行锚（整行删＝设置页入口消失，抽屉分区成唯一入口）', file: 'template.html', needle: '<div class="set-row" id="row-tabbar-beauty">' },
  // ==== 2026-09-18 #766 聊天「莫名其妙一条变多条」（用户实报：点发送那一刻就两条、刷新还在、全部类型、有的机型有有的没有）——两条独立根因：
  // ①渲染层：renderMsg 的 data-idx 只在部分分支手写，poke/ask-msg/call/rps/pong/brick/memory/snake 等提前 return 的分支从不写，而补画缺口的幂等守卫用类名限定的 `.msg[data-idx]` 查这些节点＝查不到 ⇒ 裁尾窗口回底时原样重画一遍（是否触发取决于屏高/历史长度是否曾裁窗＝机型差异来路）。
  // ②数据层：chat-tail（#180）条目落盘后永不退休，任何让内存 msgs 短于日志的事件（#722 热片装载、某块读失败留空洞、慢内核回退有损 LS 快照、异步链里切联系人致日志与 msgs 不同命名空间、导入整包替换）都被误判「这条没落盘」再回放一份，并被随后的 saveMsgs 固化进库 ⇒ 刷新还在、越用越多。====
  { name: '#766a 补画缺口幂等守卫改纯属性选择器（#918 起查「屏上下标索引表」，口径一字不变＝命中即跳过补画）（改回 .msg[data-idx] ＝不带 .msg 类的拍一拍/系统提示/游戏结算节点查不到，裁尾窗口回底原样重画＝同一条显示两个）', file: 'js/chat.js', needle: `if (onScreen.has(i)) continue; // #766a` },
  { name: '#918a 进页补尾屏上下标一次成表（删回循环内 body.querySelector 全表扫＝「LS 尾部快照→权威全量」补尾时 600 条实测 157,084 次全表扫、单任务 3.2~4.4s 纯冻结，画面停在 40 条旧快照、进度条画不动，解冻一次性换成全量画面＝用户实报「进聊天弹闪一下才恢复、没有加载动画」，红米 K80/多机型同现，行为断言 tools/verify-chat-newer-index.mjs）', file: 'js/chat.js', needle: 'const onScreen = new Map(); // #918a' },
  { name: '#918b 补尾锚点选取同批改查表（删＝锚点未命中时 i+1..len 逐个全表扫，与 #918a 同一条 O(step×len×DOM) 冻结路径的另一半）', file: 'js/chat.js', needle: 'anchor = onScreen.get(j) || null; // #918b' },
  { name: '#766b 尾巴日志退休接口（删掉＝日志条目落盘后永不清零，任何一次 msgs 短于日志的读库都把它当未落盘再回放一份并固化进库＝刷新仍在的重复）', file: 'js/chat.js', needle: 'function chatTailRetire(keep) {' },
  { name: '#766c 退休走 store 层写盘（改回只动 localStorage＝IDB 镜像仍在，idbRestore 回填原样复活，重复清不掉）', file: 'js/chat.js', needle: "try { store.set('chat-tail', JSON.stringify(k)); } catch (e) {}" },
  { name: '#766d 早于本次装载窗口的日志条目一律不回放（删＝热片装载/块读空洞时把库里已有的更早消息再补一份进内存＝凭空重复）', file: 'js/chat.js', needle: 'if (winFrom !== Infinity && (j.ts || 0) < winFrom) { keep.push(j); continue; }' },
  { name: '#766e 回放命名空间闸门（删＝异步链里切联系人后把对方联系人的尾巴日志回放进本会话历史＝串档重复）', file: 'js/chat.js', needle: "if (forPrefix && typeof window !== 'undefined' && typeof window.activePrefix === 'function' && window.activePrefix() !== forPrefix) return 0;" },
  { name: '#766f 确认空库路径也按命名空间回放（删掉带参调用＝该路径回退成跨源盲回放）', file: 'js/chat.js', needle: 'try { chatTailMerge(myPrefix); } catch (e) {}' },
  // ==== 2026-09-18 PERF-PLAN 阶段 1「JS 外置化」机制在位（首开 3.8MB 全内联 → core 内联 + ext defer 外置 js/，iOS 首开解析卡顿结构性优化）====
  { name: 'PERF-PLAN 阶段1 外置脚本标签在位（构建注入 <script defer src="js/...">；被移除＝外置机制被拆、首开回到 3.8MB 全内联单包＝iOS 首开卡顿回归。行为断言 tools/verify-ext-boot.mjs）', file: 'index.html', needle: '<script defer src="js/' },
  // ==== 2026-09-18 #771 存钱罐「TA 塞心意币」从不触发根治（用户实报：心意币存钱一直没有 TA 存入）====
  { name: '#771a app 入口按页签状态补触发心意币彩蛋（删＝页签停在上次位置重进 app 不走 click，TA 塞币/取回永远没机会跑）', file: 'js/p2-features.js', needle: 'if (coinBox && !coinBox.hidden) { piggyCoinMaybeTa(); piggyCoinMaybeTaWithdraw(); }' },
  { name: '#771b last-visit 只在塞币真触发时刷新（改回进页签先盖章＝常看用户间隔被清零、概率压回裸 12%，体感等不到 TA 塞币）', file: 'js/p2-features.js', needle: 'if (Math.random() >= prob) return;\ntry { s.set(\'piggy-coin2-last-visit\', \'\' + Date.now()); } catch (e) {}' },
  // ==== 2026-09-18 #776 聊天「一条变多条」身份层根治（vivo X200 Edge / Edge 151 实报：刷新、重启浏览器都在，2/3/多条）====
  // 根因：五条落盘/回放闸门各自用「正文签名」认亲，而副本最常见的差异恰恰是正文被原地改写
  //（normCell 换脸/改名清扫/媒体令牌化/LS 有损快照剥 img）——正文不等 ⇒ 判不出同一条 ⇒ 存两份、
  // 屏上两条、落盘固化。方案＝出生号（addRec 给每条消息打盐号，随对象一起落库，克隆回来一模一样）
  // ＋统一副本键（松散正文键 ∪ uid 键），五个闸门共用一个口径。行为断言 tools/verify-chat-dup-soak.mjs R6。
  // 删掉下面任一条＝对应闸门退回「只认正文」，用户报障原样复发（且只在存量数据多的账号上复发）。
  { name: '#776a 出生号打号入口（删＝同一条被原地改正文后彻底认不出是副本，五闸门全漏＝刷新还在、越用越多）', file: 'js/chat.js', needle: "rec.uid = _recUidSalt + '-' + t.toString(36) + '-' + (++_recUidSeq).toString(36);" },
  { name: '#776b 副本键集合含 uid 键（只留正文键＝改写/令牌化过的副本照样漏网；删掉整行＝出生号白打）', file: 'js/chat.js', needle: "if (m && typeof m.uid === 'string' && m.uid) out.push(k + '#u' + m.uid);" },
  { name: '#776c 实时 addRec 闸门走共享副本键（改回只比正文＝点发送那一刻就两条）', file: 'js/chat.js', needle: 'if (!chatRecKeysShare(p, rec)) continue;' },
  { name: '#776d LS 快照写侧闸门走共享副本键（删＝快照里长期存两份同一条，下次进页读侧当新消息补回）', file: 'js/chat.js', needle: 'return !chatRecKeysHit(copied, m);' },
  { name: '#776e 读侧 IDB 增量闸门走共享副本键（删＝后台归一化/迟到权威合并把副本并回内存）', file: 'js/chat.js', needle: 'if (chatRecKeysHit(idbCopies, m)) return false;' },
  { name: '#776f 增量日志合并登记基准包副本键（删＝chat-arch 与基准包重叠的两份各留一条，压缩窗口翻倍）', file: 'js/chat.js', needle: 'ckptSigs.add(sigOf(ckptArr[ci])); chatRecKeysAdd(ckptCopies, ckptArr[ci]);' },
  { name: '#776g 重复体检探针在位（删＝真机报障说不出「还剩哪种重复」，只能凭猜修通道；设置页诊断面板读它）', file: 'js/chat.js', needle: 'window.__mochiDupCensus = function () {' },
  // ===== #787 聊天美化上传字体失效根治（fontSetDataFor 带回执 + fontResolved 补读不烧毁；2026-09-19 补登，needle 已 grep 各 1 处）=====
  { name: '#787a 字体补读限量重试闸门（删＝回到一次烧毁：弱内核一次挂起整场不补读，「字体有时好有时坏」复发）', file: 'js/chat-settings.js', needle: 'if (window.idbGet && !_fontHydrating[hash] && tries < 5) {' },
  { name: '#787b 补读带歧义标记（删＝读失败与真没有不可区分，gone 误判/漏判、重试失效）', file: 'js/chat-settings.js', needle: "window.idbGet('xy-home-v2:font-blob-' + hash, info)" },
  { name: '#787c 上传字体持久化带回执（删＝blob 写 IDB 失败静默丢，重启后字体消失复发）', file: 'js/chat-settings.js', needle: "window.idbSet('xy-home-v2:font-blob-' + h, dataURL)" },
  { name: '#787d 回退直存的过期守卫（删＝晚到回执可覆盖用户后续换的字体）', file: 'js/chat-settings.js', needle: "if (s.get(FONT_KEY) !== '@@font:' + h) return;" },
  { name: '#787e 字体丢失状态可见（删＝blob 丢失后设置行显示生引用串/误报默认，用户无从发现）', file: 'js/chat-settings.js', needle: '字体文件丢失，请重新上传' },
  // ===== #792 关于页「数据与存储（重要）」必读 5 条（2026-09-19 补登）=====
  { name: '#792a 关于·数据与存储必读组锚行（删＝小白必读 5 条整组消失）', file: 'template.html', needle: 'id="about-storage-note"' },
  { name: '#792b 无痕模式清空说明（删＝无痕模式危害提醒消失；文案在 personalize.js 详版弹窗）', file: 'js/personalize.js', needle: '的设计就是【关掉就全部清空】' },
  // ===== #793 开屏「停更公告」横幅（2026-09-19 补登）=====
  { name: '#793a 开屏停更公告标题（删/改＝2026年9月底停更口径不再首屏可见）', file: 'template.html', needle: '停更公告 · 2026年9月底后永久停更' },
  { name: '#793b 停更横幅正文样式（删＝横幅退回无样式裸文本；minifyCss 只剥注释/行首缩进，行内空格保留＝此 needle 产物侧同样命中）', file: 'css/base.css', needle: '.splash-stopupdate p { font-size:12.5px' },
// ===== #864 开屏顶部「公告已精简 · 使用说明请看设置→关于」指引条（2026-09-19 用户直派「开屏显眼的地方，顶部需要说明」）=====
// 静态 DOM 在品牌卡内（notice.json 在线覆盖只改公告列表、碰不到它），产物锚因此读 index.html；两条都取单行代码特征。
{ name: '#864a 开屏顶部公告精简指引条在位（删＝「公告内容已缩减、原公告里的使用说明已移到设置→关于」在开屏顶部再无任何说明）', file: 'template.html', needle: '公告已精简：原公告里的大量使用说明已移到' },
{ name: '#864b 指引条样式在位（删＝指引条退化成品牌卡里的一行裸文字、顶部不再显眼；此行单行形态 minifyCss 后逐字节不变，产物侧同样命中）', file: 'css/base.css', needle: '.splash-abouttip p { font-size:12.5px; line-height:1.8; color:#8a3d05;' },
  // ===== #794 屏幕适配「诊断→修正」闭环 + 第七轴 + 适配码（2026-09-19）=====
  { name: '#794a 左右安全边轴落层（删＝曲面屏安全边滑杆拖了无效）', file: 'js/mobile-adapt.js', needle: "origSet('--mochi-side-adj', adj.side + 'px')" },
  { name: '#794b .phone 各形态 padding 消费左右安全边（删＝轴值落了层也没人用）', file: 'css/base.css', needle: 'var(--mochi-side-adj,0px)' },
  { name: '#794c 诊断→修正建议计算器（删＝诊断报告/微调面板都没有一键修正，回到「看完报告再逐根对滑杆」）', file: 'js/device.js', needle: 'window.mochiScreenFixSuggest = function' },
  { name: '#794d 诊断报告一键修正按钮（删＝报告只能看不能修）', file: 'js/device.js', needle: "label: '一键修正'" },
  { name: '#794e openModal 第三自定义按钮位接线（删＝extraBtn 永不显示）', file: 'js/personalize.js', needle: 'const cfg3 = opts.extraBtn || null;' },
  { name: '#794f 适配码格式 tag（删/改＝导出的码对方导不进）', file: 'js/personalize.js', needle: "const MOCHI_ADJ_TAG = 'MCADJ1:'" },
  { name: '#794g 微调面板按住看默认对比（删＝拖方向拿不准时无法快速对比调整前后）', file: 'js/personalize.js', needle: "holdBtn.addEventListener('pointerdown', holdOn)" },
  { name: '#794h 恢复备份带屏幕偏移时点名提醒（删＝换机恢复把旧机的偏移带进本机且无提示）', file: 'js/data-backup.js', needle: 'screen-adj-(top|bottom|h|desk|shift|text|side)' },
  { name: '#794i 微调面板打开即现场探测建议行（删＝面板回到纯手拖，诊断发现不主动送上门）', file: 'js/personalize.js', needle: 'window.mochiScreenFixSuggest ? window.mochiScreenFixSuggest() : []' },
  // ==== 2026-09-19 #800 后台通知「一条内容弹两条一模一样的系统通知」根治（红米 K80 Chrome 实报「联系人更换昵称的系统消息重复一条」，用户点名其他消息可能同病、其他设备型号也有；#744/#766/#776/#796 同族新通道）：同一条消息在**同一同步任务**里被投两次——addRec→showDeskMsg 一路 + 机制显式补发一路（avatar-lib 昵称/头像池定时更换、ta-ask 五处、ck-question、incoming-requests 查岗卡），而已发指纹 markNotified 原在 showSysNotification().then(ok) 异步回调里才落账（发送链前段还有头像裁剪 Image onload 最长 1200ms 截止），第二发到达时 notifiedDup/seenDup 查空、recentChatDup 又有「刚入库 2.5s 内条目自排除」＝双弹。修复＝决定发送的同步点记账＋发送失败回调里回滚（v3.12.x 失败可重试语义不变）。零机型分支；行为断言见 tools/verify-notify-dup-gate.mjs ====
  { name: '#800a 决定发送即同步记账（记账仍在发送成功回调＝同任务第二发查空放行，一条内容弹两条一模一样的通知回归）', file: 'js/bg-keep.js', needle: 'gateStats.sent++; markNotified(nkey);' },
  { name: '#800b 发送失败回滚早记账（删掉＝发送失败后 2 分钟内同内容不再重试，「经常收不到」家族回归）', file: 'js/bg-keep.js', needle: 'notifiedRecently.delete(nkey);' },
  // ==== 2026-09-19 #809 问问TA 发单题「思考时间（秒）」可自定义（用户直派「和帮我决定群来决定一样的自定义思考时间，默认就是现在的秒」）——半框注入同款 stepper（1~10 秒，点击即持久化 per-cid 键 ask-think-secs），ask 分支延迟改 askThinkSecsLoad()*1000（默认 3 秒＝原随机 1500+rand*2500 常用档；invite 分支保持随机不变）。行为断言见 tools/verify-ask-think-time.mjs ====
  { name: '#809a 思考时间点击即持久化（删＝关面板重开回默认，设置形同虚设）', file: 'js/chat.js', needle: "store.set('ask-think-secs', String(n));" },
  { name: '#809b 半框思考时间 stepper 行（删＝设置入口消失，功能不可达）', file: 'js/chat.js', needle: 'id="chat-ask-think"' },
  { name: '#809c ask 回答延迟读设置（改回固定随机＝用户设置不生效，思考时间恒 1.5~4 秒）', file: 'js/chat.js', needle: '}, askThinkSecsLoad() * 1000);' },
  { name: '#813a 聊天设置头像：武装与激活拆两步（armHead 只武装、headActivate 只激活；删＝回到「arm+click 融合且挂在 onMiss 兜底上」，label 转发成功的内核上选完图静默丢弃）', file: 'js/chat-settings.js', needle: 'function armHead(cb) { headCb = cb; }' },
  { name: '#813b 删除型：旧融合式激活函数不得回流（复活＝label 转发成功的内核永远拿不到回调）', file: 'js/chat-settings.js', needle: 'function pickHead(', absent: true },
  { name: '#811a 头像入口按作者角色进页（删/改回只传 owner＝点我的头像又进联系人个人页，主诉③复发）', file: 'js/feed.js', needle: "openFeedAll(av.dataset.owner, av.dataset.role === 'me' ? 'me' : 'ta');" },
  { name: '#811b TA 个人页按人过滤（删掉按角色排除那半＝该桌面我的动态又并进联系人个人页，主诉①复发）', file: 'js/feed.js', needle: "(p.owner || 'default') === feedAllCid && (p.role || p.by) !== 'me'" },
  { name: '#811c 背景跟人走·TA 页只读 feed-ta-cover（改回「我的封面优先」＝B 未设 TA 封面时个人页背景显示成我的朋友圈背景，主诉②复发）', file: 'js/feed.js', needle: "feedAllWho === 'me' ? 'feed-cover-bg' : 'feed-ta-cover'" },
  { name: '#811d 我的页头像编辑写 feed-user-avatar（删分流＝在「我的朋友圈」页点头像改的是 TA 的头像）', file: 'js/feed.js', needle: "feedAllWho === 'me' ? 'feed-user-avatar' : 'feed-ta-avatar'" },
  // ==== 2026-09-19 #815 整屏空白＋打字白闪根治（华为 Nova 12 Pro + QQ 浏览器实报「经常会屏幕空白，还会闪，尤其是要输入文字的时候」，用户明说其他设备型号也有；零机型分支）：自带屏幕诊断历史快照连捕 4 条 `[switch] ✗底部导航栏悬空 phone=647(底647) tab=106`＝flex 列只剩状态栏＋导航栏、一个 .page 都没显示。三条结构性根因＝①非原子切页（先关全部再取目标，目标落空即永久零可见）②load 期静态页快照关不到运行中新建的 .page（两页同显各占半屏）③JS 按 visualViewport.height 逐帧写 .phone 内联高且无下限（内核键盘动画期瞬时上报 0＝整壳塌没）。修法＝tabs.js 立「任何时刻恰有一个可见 .page」不变量（零可见下一帧自愈＋先取目标再关其它页＋关页走实时清单）＋base.css .phone min-height 地板。行为断言 tools/verify-blank-screen-heal.mjs（纯 HEAD 红 1/8、本批绿 8/8）====
  { name: '#815a 零可见页自愈入口（删＝整屏空白永久卡死复发，用户实报「屏幕空白」本体）', file: 'js/tabs.js', needle: 'function healBlank() {' },
  { name: '#815b 切页先取目标页再关其它页（改回先关后取＝目标 id 落空时全部页被关光，整屏空白）', file: 'js/tabs.js', needle: "const target = document.getElementById(tab.dataset.page || '');" },
  { name: '#815c 静态快照扫空时实时复查（删＝运行中新建的 .page 不在快照里，chrome 判定与自愈双失）', file: 'js/tabs.js', needle: 'if (!visible) visible = liveVisiblePage();' },
  { name: '#815d .phone 整屏空白地板（删＝内核瞬时上报 0 高时整壳塌成一条，「输入文字时白闪」复发；min-height 压内联 height，单点收口不随十余处写入点漂移）', file: 'css/base.css', needle: 'min-height:min(120px, 18dvh);' },
  { name: '#821a 桌面昵称抬到头像 label 激活层之上（删掉 z-index＝点昵称又被覆盖层吞去弹相册，「点击无法修改」复发）', file: 'css/home.css', needle: 'cursor:pointer; position:relative; z-index:1; }' },
  // ==== 2026-09-19 #823 用户直派「寻踪功能缺少禁用，关闭这个功能」：原先只有「寻踪日常发送到聊天」概率（dcf-checkin 调 0% 只停推送、寻踪页与记录照旧生成），没有总闸。新增 per-cid 键 checkin-en（从未写过＝默认开启，老用户零迁移），关闭＝全静：日常不生成、不推聊天、不落记录、不重置计时，桌面【寻踪】图标／聊天「更多」面板寻踪／点 TA 头像的寻踪半框三入口一并收起，已有记录保留、重开即恢复（不补发）。行为断言 tools/verify-checkin-disable.mjs（本批绿 11/11、纯 HEAD 红 1/11）====
  { name: '#823a doCheckin 总闸（唯一收口点：自动轮询/手动刷新/半框/寻踪页全经它；删＝关闭后日常照旧生成并推聊天，「缺少禁用」复发）', file: 'js/p2-features.js', needle: 'if (!ckEn()) return; // #823a' },
  { name: '#823b 点 TA 头像不再弹寻踪半框（toggleCkPanel 同源经 openCkPanel；删＝入口收起后半框仍能从聊天顶部点开）', file: 'js/p2-features.js', needle: 'if (!ckEn()) return; // #823b' },
  { name: '#823c 寻踪页不再打开＋可恢复指引 toast（功能大全等程序化跳转兜底；删＝隐藏图标被程序点击直开空页且用户不知为何）', file: 'js/p2-features.js', needle: 'if (!ckEn()) { // #823c' },
  { name: '#823d 开关核心键名（改键＝所有已关闭桌面静默回到默认开启；per-cid 命名空间由 activeStore 提供）', file: 'js/p2-features.js', needle: "const CK_EN_KEY = 'checkin-en';" },
  { name: '#823e 桌面图标收起口径对外暴露（personalize 的 applyHiddenIcons 复位逻辑靠它认总开关；删＝切桌面/恢复隐藏图标后入口自己回来）', file: 'js/p2-features.js', needle: 'window.checkinDeskOff = function () { return !ckEn(); };' },
  { name: '#823f 更多面板每次重算 hidden 时收起寻踪（收口必须在此行；写到别处会被 applyMoreCat 覆盖）', file: 'js/chat.js', needle: "it.id === 'more-ck' && window.checkinEnabled" },
  { name: '#823g 桌面图标与装修手动隐藏名单取并集（只认总开关会把用户在装修里手动隐藏的寻踪在关闭再开启后顺手放回桌面）', file: 'js/personalize.js', needle: "if (hidden.indexOf(key) >= 0 || (ckOff && key === 'checkin')) app.style.display = 'none';" },
  // ==== 2026-09-19 #842 表情面板【颜文字】【emoji】补「⏱最近使用」（用户直派：表情包有、这两类没有）。#636 的两类文字分类此前被 recChipShow 里的 emojiCat 判定硬挡成 sticker 专属，点击也不记录。本批＝点击记录＋按分类各存一份全局根键（emoji-recent-kaomoji / emoji-recent-emoji，身份＝文字原文、解析回查 TA 专属/公用/我的三池）＋chip 三分类通用＋停在最近分组时不被自动回落改选。行为断言 tools/verify-emoji-recent.mjs T 组 ====
  { name: '#842a 颜文字/emoji 点击即记录（删＝这两类永不进最近区）', file: 'js/chat.js', needle: 'try { emojiRecordRecentText(t); } catch (e0) {}' },
  { name: '#842b 最近结果按分类各解析一份（改回恒 emojiRecentResolved＝文字分类永远空、且文字条目混进图片身份池）', file: 'js/chat.js', needle: "emojiCat === 'sticker' ? emojiRecentResolved() : textRecentResolved()" },
  { name: '#842c 最近 chip 三分类通用（回流成只给表情包＝颜文字/emoji 又没有最近使用了）', file: 'js/chat.js', needle: "!(emojiMode === 'mine' && (emojiCat === 'sticker' ? myBatchMode : myTextBatch))" },
  { name: '#842d 文字分类停在最近分组不被自动回落改选（删＝下次渲染被改选到第一个非空分组，最近区一点就丢）', file: 'js/chat.js', needle: "if (cur !== '__recent__' && (!cur || !list.some(g => g[0] === cur)))" },
  { name: '#842e 文字最近分组走文字网格渲染（删＝点 chip 出空态或错走图片路径）', file: 'js/chat.js', needle: "renderEmojiTextGroup('__recent__', srcs);" },
  { name: '#842f 两新键全局根键免迁（删＝每次刷新被 migrateLegacy 迁进 default 并删根键，非 default 桌面这两类最近区清空）', file: 'js/contacts.js', needle: "'emoji-recent-kaomoji', 'emoji-recent-emoji'," },
  { name: '#849a 加载期全分类组内去重＋main 跨分组去重（删则默认聊天字卡/互动回应等同文重复行复发）', file: 'js/default-cards.js', needle: "if (k !== 'dict' && Array.isArray(DATA[k])) dedupeCardGroups(DATA[k], k === 'main');" },
  { name: '#849b 词典重建链跨分组去重（词库与基础汉字等扩展分组同文只留一处；删则用户报的【嗯】重复复发）', file: 'js/default-cards.js', needle: 'DATA.dict = dedupeCardGroups(base, true);' },
  // ==== 2026-09-19 #853 iPad7/iOS15.3（Safari 15.3，诊断 SIG phone=2254 底=1647）「很多顶部底部按钮点不到＋聊天下滑到底整页弹回最上面」——
  // 机制：WebKit<15.4 对不认识的 dvh/svh 单位不是 Chromium 式「解析期丢弃＝退回上一条 vh」，
  // 而是把声明保留到计算期失败＝整个 height 属性作废成 auto（诊断历史快照 phone=794/1319/2254
  // 恰为内容自然高、随页面波动；顶位三态均吻合 flex 居中公式＝height 属性确为 auto）。
  // 于是 .phone 不再定高：文档可滚出数百 px，顶部/底部按钮轮流在视口外；聊天页内部滚动容器
  // 失效、整页被当文档滚。「vh 前置+dvh 后置」阶梯（#718 等）只对 Chromium 系老内核成立，
  // 对老 WebKit 必须让 dvh 声明根本不被看到＝收进 @supports (height: 100dvh)。现代内核
  // @supports 为真、生效声明不变＝零现代回归。min-height 阶梯作废只失去下限、无塌陷，不在其列。
  { name: '#853a .phone 实测高 vh 基线（ios-vv-fit 老内核退路；删＝iOS<15.4 浏览器态 .phone 高度作废成 auto＝文档可滚、顶底按钮出视口点不到）', file: 'css/base.css', needle: 'height:min(var(--mochi-ios-h, 100vh), 100vh)' },
  { name: '#853b 平板 .phone 高度阶梯 svh/dvh 收进 @supports（删＝老 WebKit 把平板 .phone 高度作废成 auto＝内容高随页面波动）', file: 'css/base.css', needle: '@supports (height: 100dvh) { html.tablet .phone { height:100svh; height:100dvh; } }' },
  { name: '#853c 全屏小游戏面板 dvh 行收进 @supports（删＝iOS<15.4 点全屏面板高度塌成内容高）', file: 'css/chat-pages.css', needle: '@supports (height: 100dvh) { #chat-snake-panel.snake-fs { height:min(var(--mochi-ios-h, 100dvh), 100dvh); } }' },
  { name: '#853d standalone 覆盖形态 body 的 dvh 兜底收进 @supports（删＝iOS<15.4 键盘会话期 var 摘除时 body 高度作废成 auto＝覆盖形态整页居中位移复发）', file: 'css/base.css', needle: '@supports (height: 100dvh) { html.ios-pwa-standalone.ios-cover-top body { height:var(--mochi-ios-h, 100dvh); } }' },
  // ==== 2026-09-19 #846 手机端「消息发出去之后屏幕闪一下」根治（红米 K80 Chrome 实报，用户点名勿做机型分支）——
  //   无头实证：历史 >400 条的桌面进页后屏上窗口会被上翻加载撑到 WINDOW_MAX(400)，此后每发一条消息都命中
  //   addRec 超限钳位分支＝renderWindow 整窗重建（400 节点全删、同步重造 200 气泡、img/头像全部重解码，
  //   实测 rm=400/add=200、scrollTop 26086→12686）＝整屏闪一下；历史 ≤400 条的桌面从不命中＝假象为机型相关。
  //   修法＝钳位改 trimWindowTopQuiet(RENDER_MAX) 静默裁顶（只删视口以上的节点＋按删掉高度补偿 scrollTop），
  //   新消息照常走 renderMsg 增量追加；DOM 上限与 #211 口径不变。#720d 哨兵随本批换锚到新调用式。====
  { name: '#846a 裁顶后按删掉高度补偿 scrollTop（删＝视口瞬间位移，「近底部发一条消息画面跳一下」；#846 静默钳位的前半）', file: 'js/chat.js', needle: 'if (cut > 0) body.scrollTop = Math.max(0, body.scrollTop - cut);' },
  // ==== 2026-09-19 #859 心意市集「药品医护」分类（用户反馈「心意市里只有感冒药，缺日常用的药和手受伤要用的」）——
  //   改前全库 301 件里医药类只有 4 件（感冒药/创可贴/体温计/口罩），且散在 82 件的「日常用品」里；
  //   搜索按「名称/留言/分类」匹配，搜「药」只命中「感冒药」一条。本批把医药单独成类（第 13 类）并补齐
  //   常备药与外伤处理。三条锚都钉在目录数据本身：类目从 CATS 消失、外伤处理商品被删、既有医药商品
  //   被挪回大分类，任一发生即报红。====
  { name: '#859a 「药品医护」分类在位（CAT_ICON 登记；删＝整柜药从胶囊里退场，用户又回到「市集里只有感冒药」。#870 追加两类后不再钉 CATS 末位）', file: 'js/gift-shop.js', needle: "'药品医护': '💊'" },
  { name: '#859b 外伤处理商品在位（碘伏等，与常备药同批；删＝「手受伤了要用的」那几件没有入口）', file: 'js/gift-shop.js', needle: "id: 'g_mediodine', name: '碘伏'" },
  { name: '#859c 既有医药商品已归入本分类（改回「日常用品」＝创可贴等又散进大分类翻不到）', file: 'js/gift-shop.js', needle: "price: 5.00, cat: '药品医护', wish: '磕磕碰碰的，有我呢' }" },
  { name: '#855a 寻踪预设＋自定义合并去重函数（删＝「使用系统预设」开启时回到自定义非空即整体顶掉预设的旧口径）', file: 'js/p2-features.js', needle: 'function ckMergeDef(custom, def)' },
  { name: '#855b genCheckin 开预设时合并抽取（删＝加过一张自定义字卡后地点/动作/话术预设全部退场）', file: 'js/p2-features.js', needle: 'places = ckMergeDef(places, DEF_PLACES);' },
  // ==== 2026-09-19 #847 朋友圈两处评论入口缺口（接 #845 收口后用户点定的两项，零机型分支）——
  //   ①个人页（#page-feed-all）点【评论】毫无反应：评论条与评论面板只长在 #page-feed 里，个人页是
  //     另一个 .page，取消隐藏的是隐藏祖先内部的子节点＝屏幕上什么都不出现。修＝显示前 feedCommentBarAdopt()
  //     把这两个节点搬挂到当前可见的那一页（全站仍是同一实例，id 不重复、监听不重绑）。
  //   ②评论条贴纸面板只有图片表情包、没有 emoji 组：没传过表情包的桌面打开只看到「暂无表情包」。
  //     修＝新增 em tab（源＝已入库常量 FEED_STICKER_EMOJI），emoji 走文本网格、点击进输入框，不进 comImgData。====
  { name: '#847a 显示评论条前先搬挂到当前可见页（删＝个人页点【评论】依旧毫无反应，「评论按钮坏了」复发）', file: 'js/feed.js', needle: 'feedCommentBarAdopt();' },
  { name: '#847b 搬挂幂等守卫（删＝每次点评论都重 append 一遍，同爹时也搬＝无谓重排；改回无条件 append 会让输入框失焦、草稿闪烁）', file: 'js/feed.js', needle: 'if (!host || comBar.parentNode === host) return;' },
  { name: '#847c 评论面板 emoji 分组源（删＝em tab 只剩图片表情包，「暂无表情包」复发）', file: 'js/feed.js', needle: "if (comStickerTab === 'em') return [['emoji \\u8868\\u60c5', FEED_STICKER_EMOJI]];" },
  { name: '#847d 评论面板第三个 tab 按钮在位（删＝用户根本点不到 emoji 组）', file: 'js/feed.js', needle: 'data-cs-tab="em"' },
  { name: '#847e emoji 走文字网格类名（改回单类 emoji-grid＝emoji 被当图片渲染成坏图；删 isEmoji 判定则只剩「点分组查看」空态，emoji 组永远出不来）', file: 'js/feed.js', needle: "grid.className = isEmoji ? 'emoji-grid emoji-grid-text emoji-grid-emoji' : 'emoji-grid';" },
  { name: '#847f 点 emoji 追加进评论输入框（改回 push 进 comImgData＝emoji 变成图片附件、还占 9 张图上限，发出去是坏图）', file: 'js/feed.js', needle: "if (comInput) comInput.value = (comInput.value || '') + src;" },
  { name: '#847g 单卡定位按当前可见页取卡片（改回 getElementById＝主列表与个人页两套模板都输出 id=feed-post-<pid>，文档序第一份是隐藏页那份：个人页「评论发出去屏上这条动态不刷新」「点贴纸没反应」复发）', file: 'js/feed.js', needle: "const scope = all && !all.hidden ? document.getElementById('feed-all-list') : document;" },
  { name: '#847h 贴纸选位也走可见页取卡（改回按 id 直取＝个人页铺的底纸与提示条插在看不见的卡片上）', file: 'js/feed.js', needle: 'const post = feedPostEl(pid);' },
  // ==== 2026-09-19 #857 帮我决定/多人决定/占卜「历史记录没保存」根治（用户直派：红米 K80 Chrome，明说其他机型也有、勿做机型分支）——三模块的历史写闸 histReady 只由 mochi-restore-done 监听器置位；JS 外置化后它们是 <script defer src="js/…"> 件，空库/快恢复时该事件早在监听注册前就派发完（idb.js sendReady），只挂监听永远等不到 → histReady 恒 false → saveHistory 把每条记录塞进 histPending 且永不落盘、存量迁移也永不执行（外置前同步内联必然赶上，故这几天才冒出来）。修＝就绪两层：已 __mochiDataReady 则立即补跑同一处理器，否则才挂监听；同批把切桌面时 histPending = null 的丢弃改成 flushPendingHist 落盘（这两个键走全局根命名空间，缓冲与桌面无关，丢弃＝白丢）。====
  { name: '#857a 帮我决定写闸两层就绪（删＝回到只挂监听：defer 外置件错过 mochi-restore-done 后 histReady 恒 false、记录全进缓冲永不落盘）', file: 'js/decision.js', needle: 'if (window.__mochiDataReady) onDecHistRestore();' },
  { name: '#857b 多人决定写闸两层就绪（同 #857a，删＝群聊决定历史不保存复发）', file: 'js/group-decision.js', needle: 'if (window.__mochiDataReady) onGdHistRestore();' },
  { name: '#857c 占卜记录写闸两层就绪（同 #857a，删＝抽牌记录与主页占卜记录全被缓冲吞掉）', file: 'js/divination.js', needle: 'if (window.__mochiDataReady) onDivRestore();' },
  { name: '#857d 帮我决定切桌面时缓冲落盘（改回置空＝恢复窗口内攒下的记录白丢）', file: 'js/decision.js', needle: 'try { histReady = true; flushPendingHist(); } catch (e) {}' },
  { name: '#857e 多人决定切桌面时缓冲落盘（改回置空＝同上白丢；本文件写成裸语句，与 #857d 的 try 包裹形态各在其位，勿「统一」两条 needle）', file: 'js/group-decision.js', needle: 'histReady = true; flushPendingHist();' },
  { name: '#865a 功能大全新增【桌面应用】组＝29 个桌面图标逐页索引（删＝桌面应用在功能大全里又没有统一入口，搜「桌面/图标」空手）', file: 'js/feature-hub.js', needle: "{ g: '桌面应用', items: [" },
  { name: '#865b 功能大全「心情日记」两段链直达日记页（改回只 go 日历＝搜「心情日记」点进去停在日历首页）', file: 'js/feature-hub.js', needle: "go: ['.app[data-app=\"calendar\"]', '#cal-mood-entry']" },
  { name: '#861a 动态图标落位即套用隐藏名单（删＝备忘录/市集/心意柜/喝水等注入图标躲过启动期 applyHiddenIcons，下次再跑要等 contact-switched＝「启动看得见、切一次桌面就消失」复发；红米 K80 实报第三页备忘录图标不见了。改回裸暴露 window.applyDeskLayout = applyDeskLayout 即复发）', file: 'js/personalize.js', needle: 'window.applyDeskLayout = function () { try { applyDeskLayout(); } finally { try { applyHiddenIcons(); } catch (e) {} } };' },
  { name: '#861b 备忘录图标登记进装修组件库三张表（删＝app-memo 不在 WIDGET_IDS 白名单、装修「添加卡片」找不到备忘录，图标一旦离页进隐藏池永远无法找回——gift-shop.js 注释里 #market 同案原话「不在白名单永远无法找回」）', file: 'js/personalize.js', needle: "'app-memo': '备忘录图标'" },

  // ==== 2026-09-19 #858 心意市集「自定义上传商品」入口不显眼 + 商品数据导入导出（用户直派「心意集市，新增可以用户自定义上传商品，然后可以导入数据和导出数据。这个按钮要显眼一点，好多人不知道有这个功能」）。原状：上传入口只是市集页底部那排灰色胶囊里的「+ 添加商品」（与心愿单/管理/设置并列的 5 颗之一），用户普遍不知道有这功能；商品数据只能靠 设置→功能数据 整包搬。修法＝hero 正下方新增「我的心意商品」块：深色主按钮「＋上传我的商品」（进页即见、全页唯一主行动）＋同一块里「导出商品数据 / 导入商品数据」两颗小胶囊；导出只装 market-custom 里的自定义商品（图片已是内嵌 data:URL，单文件自带图）；导入按 名字/分类/价格/图片 判重、同 id 就地更新、id 撞车重新发号、只收 data: 内嵌图、超量不导入。零机型分支 ====
  { name: '#858a 上传入口常驻市集页（hero 下方独立块；删＝只剩底部胶囊里那颗「＋上传商品」，「好多人不知道」复发）', file: 'js/gift-shop.js', needle: "'<div class=\"market-mine\" id=\"market-mine\"></div>' +" },
  { name: '#858b 主按钮接线到上传表单（删/改指＝按钮点了没反应）', file: 'js/gift-shop.js', needle: "if (b.id === 'market-mine-add') openAddGiftForm(null);" },
  { name: '#858c 导出只装我自己上传的商品（含 !c.del && !c.base：改宽＝别人的删除标记被打包，导入方默认商品被误删）', file: 'js/gift-shop.js', needle: 'return customLoad().filter(function (c) { return c && c.id && !c.del && !c.base; });' },
  { name: '#858d 导入判重跳过已存在（删＝同一个文件导入两次商品翻倍）', file: 'js/gift-shop.js', needle: 'if (sig in bySig) { skipped++; return; }' },
  { name: '#858e 外来图片只收内嵌 data: 图（删＝文件里的外链/超大图原样入库，离线看不到图又撑爆本地存储）', file: 'js/gift-shop.js', needle: "if (!/^data:image\\//i.test(img) || img.length > GOODS_IMG_MAX) img = '';" },
  { name: '#858f 上传主按钮深色渐变（改浅＝与满页白卡同色，「显眼」失效；css/market.css 内唯一）', file: 'css/market.css', needle: '.market-mine-add { display: flex; align-items: center; gap: 13px; width: 100%;' },
  // ==== 2026-09-19 #868 键盘收起/全屏切换后「闪一下回弹再恢复」根治：#466/#643 两个快速回钉改走与 #706 同闸的落定锁（一次变形只写一枪）====
  { name: '#868a 回钉落定闸（改回 60ms 单发＝收键盘/开全屏时先按中间态写一枪、看门狗再校正＝回弹复发）', file: 'js/chat.js', needle: 'return now - _vvGeomChangeTs >= 180 && now - _cbBoxChangeTs >= 180 && now - _chatScrollActTs >= 200' },
  { name: '#868b RO 记聊天盒变化时刻（删掉＝盒子仍在分步恢复时也敢写 scrollTop）', file: 'js/chat.js', needle: '_cbBoxChangeTs = Date.now();' },
  { name: '#868c 落定锁有界重试（改成无限重试＝与用户滑动对打；删掉等待＝中间态写入回归）', file: 'js/chat.js', needle: 'if (!chatRepinQuietEnough(now)) { if (now < _kbSettleDeadline) _kbSettleT = setTimeout(chatRepinStep, 120); return; }' },
  { name: '#868d 看门狗补「盒子还在变」闸（删掉＝mobile-adapt 恢复 .phone 途中补钉一次＝弹跳）', file: 'js/chat.js', needle: 'if (Date.now() - _cbBoxChangeTs < 180) return;' },
  { name: '#858g 上传商品+导入导出说明常驻 设置→关于→功能介绍 04（原开屏公告第十章已删、移入此处；删＝用户看不到「能自己上传商品、数据能搬家」这条）', file: 'template.html', needle: '<b>心意市集·上传我的商品</b>' },
  // ==== 2026-09-19 #870 心意市集四组缺口商品（用户直派「1234都要补」：节日节令 / 美妆个护 / 经期关怀 / 花束补齐）——
  //   改前：节日食品散在 48 件「美食」里且只有中秋月饼；美妆个护在 78 件「日常用品」里只有 4 件；
  //   经期关怀 0 件（而 app 自己有经期记录）；花束仅 8 件是全库最少。当批新增两类目与 31 件商品
  //   （另把月饼归入节日节令、4 件个护移入美妆个护）。五条锚各钉一组：类目登记、节日成套、
  //   美妆成套、经期关怀、花束补齐，任一组被删/被挪回都当场报红。====
  { name: '#870a 两个新类目登记在 CATS 末位（删＝节日节令/美妆个护两个胶囊与整组商品一起退场）', file: 'js/gift-shop.js', needle: "'药品医护', '节日节令', '美妆个护']" },
  { name: '#870b 节日节令成套（删＝端午/元宵/春节/腊八又回到「美食」里翻）', file: 'js/gift-shop.js', needle: "id: 'g_festzongzi', name: '粽子'" },
  { name: '#870c 美妆个护成套（删＝美妆回到 0 件，口红/面膜无处可送）', file: 'js/gift-shop.js', needle: "id: 'g_beautylip', name: '口红'" },
  { name: '#870d 经期关怀在位（删＝疼的那几天没有任何东西可送）', file: 'js/gift-shop.js', needle: "id: 'g_periodpad', name: '痛经贴'" },
  { name: '#870e 花束补齐（删＝花束退回全库最少分类）', file: 'js/gift-shop.js', needle: "id: 'g_lily', name: '百合'" },
  // ==== 2026-09-20 #869 「回复条数最少/最多」说明重写（用户直派「这个没写清楚…很多用户根本看不懂…调很多，导致联系人一直发很多消息」；零机型分支，纯文案）——
  //   单聊/群聊两处说明从行上方挪到「回复条数最少/最多」两行正下方、开头点破语义「这两项＝你每发 1 条消息，TA 就跟着回你几条」，
  //   加粗强调「这是每条消息的条数、不是 TA 一天最多发几条，不建议调大」＋调大后果实例（连发各触发一批／群聊成员各算各的）。
  //   群聊设置抽屉镜像（group-chat.js cntNote）同文案随 #794 在途批收口、本批不携带。====
  { name: '#869a 单聊条数说明点破「每条消息」语义（删回笼统说明＝再被读成总上限、调大后联系人刷屏复发）', file: 'template.html', needle: '注意：这是「每条消息」的条数，不是 TA 一天最多发几条' },
  { name: '#869b 群聊条数说明点破「每条消息每个成员」语义（删＝群聊各算各的刷屏提醒缺失）', file: 'template.html', needle: '注意：这是「每条消息、每个成员」的条数' },
  // ==== 2026-09-19 #875 「TA在身边」藏在寻踪里是设计（位置面板唯一入口就在寻踪半框/寻踪页），
  //   但入口原是全宽浅色虚线的次要按钮、排在面板最底部 ⇒ 被读成寻踪的附加说明：用户既不知道
  //   这是独立功能，也找不到只住在位置面板里的三个换位开关（TA 自动换位 / 换位提醒弹窗 /
  //   换位发到聊天）。本批把两处入口改成图标＋主副两行＋箭头的功能卡，放置与点击行为一字未动；
  //   四条针各钉一处改动面：两条入口 markup、一条副标题（用户找不到的就是它）、一条 CSS 卡片形态。====
  { name: '#875a 寻踪半框入口改功能卡（退回「全宽浅色虚线」＝用户又把 TA在身边 读成寻踪的附加说明、找不到这个功能）', file: 'template.html', needle: 'id="ck-loc-entry"><span class="ck-loc-ico">' },
  { name: '#875b 桌面寻踪页入口同款（两入口形态必须一致，否则从桌面进来的用户看不到改动）', file: 'template.html', needle: 'id="ck-loc-entry-desk"><span class="ck-loc-ico">' },
  { name: '#875c 副标题点出「换位开关」（删＝收到 TA 自动换位消息想关掉的用户没有线索，三个开关仍只藏在位置面板里）', file: 'template.html', needle: '方位感知·位置时间线·换位开关' },
  { name: '#875d 入口卡 flex 形态（退回 display:block 居中＝弱按钮复发，与两条 markup 针脱钩）', file: 'css/chat-pages.css', needle: '.ck-loc-entry { display:flex; align-items:center; gap:9px; width:100%;' },
  { name: '#875e 矮屏抬起寻踪半框上限（删＝320×568/360×640 上入口被 56% 上限裁到滚动区外，用户仍看不见它）', file: 'css/chat-main.css', needle: '@media (max-height:700px) { #ck-panel { max-height:72%; } }' },
  // ==== 2026-09-19 #872 平板桌面（html.tablet）「重排＋放大」：图标 6/8 列＋盒/字形放大（88/40、≥1250 宽 104/46）＋组件两栏网格。背景：base.css 的平板区块只给了 .phone 100vw 铺满，桌面轴仍是手机像素（图标盒 64、字形恒 28、组件高/字号一条未改）＝用户报「小组件和图标特别小、平板看起来很空」；实测横向需 2.08~3.50× 而纵向只给 1.09~1.53×，纯放大填不满，故重排吃横向、尺寸档按屏高分两档（横屏矮屏基准档/竖屏高屏升档）。规则全在 src/css/home.css 与 src/css/tabbar.css，作用域 html.tablet＝手机端与电脑外壳零命中 ====
{ name: '#872a 平板桌面两栏网格（改回单列/块级＝组件回到整宽横条、横向又空掉）', file: 'css/home.css', needle: 'html.tablet .page-slide, html.tablet .page-slide.desk-page {' },
{ name: '#872b 平板图标字形放大（删掉＝图标盒里恒 28px 字形，「图标特别小」复发）', file: 'css/home.css', needle: 'html.tablet .app .app-ico svg { width:var(--tb-glyph); height:var(--tb-glyph); }' },
{ name: '#872c 平板双卡行竖排（.page-slide 前缀压第三页 .page-slide.third 横排；改回＝第三页双卡行钉回 92px 横排）', file: 'css/home.css', needle: 'html.tablet .page-slide .mini-row { flex-direction:column; gap:16px; }' },
{ name: '#872d 平板音乐卡整宽（改回半宽＝第二页「本周日常」与它同排被拉成 300 高空壳，截图实测）', file: 'css/home.css', needle: 'html.tablet .page-slide > .music-widget,' },
{ name: '#872e 平板高屏尺寸档（竖屏 iPad 再升一档；删掉＝竖屏桌面区多出 ~250px 空底）', file: 'css/home.css', needle: '@media (min-height:950px) {' },
{ name: '#872f 平板底部导航放大兜底（用户个性化过的内联变量优先；删掉＝桌面放大后导航仍 23px）', file: 'css/tabbar.css', needle: 'html.tablet { --tabbar-ico-size:30px; }' },
  // ==== 2026-09-19 #871 iPhone 12 Pro Max Safari「展开撤回消息再收起／贴底轻划／划太快／点撤回字卡明细再打开，气泡和头像错位」（用户直派，注明多机型同现；零机型分支）——
  //   无头实证 DOM 几何逐像素复原＝错位不在布局层，出自表现层滚动偏移撕裂：滚动容器内高度突变
  //   （就地展开/收起、两组「撤回 N 条字卡▾」明细开合）后，程序化 scrollTop 修正要么缺席（解钉态
  //   零接管）要么迟到（钉住态等 250ms 看门狗，最后一行先推出屏再弹回）；且 #162 图片 onload 双写
  //   是唯一没接 #716/#765 让路闸的 scrollTop 写手，手势/惯性进行中当场写＝与用户滑动对打。修＝
  //   三处开合收尾统一走 chatRetractToggleAfter（钉住态立即贴底＋#861 落定锁复核；解钉态静默后
  //   显式钳回真实 max＋同值重落一枪＝强制 WebKit 滚动树对新几何重对齐），#162 补滚接让路闸
  //   （静默态保持 #504 双写快路）。#572d 既定语义不动：推挤不做锚定补偿。====
  { name: '#871a 展开收起收尾钩子在位（删＝三处开合回到「解钉零接管/钉住等看门狗」＝错位复发）', file: 'js/chat.js', needle: "function chatRetractToggleAfter(kind)" },
  { name: '#871b 解钉态落定重落入口（删＝收起缩短内容后 scrollTop>max 超界靠内核钳位时机、滚动树不重对齐）', file: 'js/chat.js', needle: "else chatResyncScrollQuiet(kind);" },
  { name: '#871c 显式钳回＋同值重落（改成只会钳不会落＝WebKit 滚动树重对齐枪失效；删 Math.min＝超界回归）', file: 'js/chat.js', needle: "cb.scrollTop = Math.min(cb.scrollTop, realMax);" },
  { name: '#871d 图片 onload 补滚让路闸（删＝手势/惯性进行中当场双写 scrollTop＝与用户滑动对打，贴底轻划错位复发）', file: 'js/chat.js', needle: "if (Date.now() - _chatScrollActTs < 200 || chatTouchActive) { chatRepinAfterSettle(); return; }" },
  { name: '#871e 就地展开/收起接钩（删＝该入口回到无收尾）', file: 'js/chat.js', needle: "chatRetractToggleAfter('toggle');" },
  { name: '#871f 字卡明细开合接钩（删＝该入口回到无收尾）', file: 'js/chat.js', needle: "chatRetractToggleAfter('rc');" },
  { name: '#871g 情绪字卡明细开合接钩（删＝该入口回到无收尾）', file: 'js/chat.js', needle: "chatRetractToggleAfter('rcm');" },
  // ==== 2026-09-20 #876 夜间静默总闸收口（用户直派「夜间模式就是什么也不能发」：开了夜间模式挂后台睡觉，换头像换昵称/互动卡/回复还在夜里发）====
  //   根因＝旧夜间模式只装在 tryAutoSend/来电/跨桌面三条链上，换头像换昵称（avatar-lib 四个 60s 轮询）、
  //   互动卡（ta-ask 五类 maybeTrigger）、被动回复、红包礼物换位朋友圈等各自独立链全部无夜间检查。
  //   本批＝addRec/addIn 收件总闸（nightAllow 例外通道放行用户当刻回执与到点提醒）+ 各自发链源头闸 +
  //   被动回复顺延到 7:00 后（单聊 scheduleReply / 群聊 memberReply）。行为锚逐条登记如下：
  { name: '#876a addRec 收件总闸（删＝换头像/红包/战绩等直调通道夜里照发，回归「开了夜间模式还发」主诉）', file: 'js/chat.js', needle: "!rec.nightAllow && !(window.__nightReplyOpen" },
  { name: '#876b addIn 音效前守卫（删＝夜里响一声没消息；音效在 addRec 之前播，必须前置换闸）', file: 'js/chat.js', needle: "!opts.nightAllow && !(window.__nightReplyOpen" },
  { name: '#876c 被动回复夜间顺延到 7:00 后（删＝夜里发消息 TA 照回，总闸拦掉会丢回复，必须保留顺延链）', file: 'js/chat.js', needle: "const __nmHold = window.nightModeActive" },
  { name: '#876d 继续说/点名字放行窗口置位（删＝用户当刻点「继续说」TA 回复被总闸吞＝「点了没反应」回归）', file: 'js/chat.js', needle: "window.__nightReplyOpen = Date.now();" },
  { name: '#876e 换头像换昵称夜间静默助手（删＝四个 60s 轮询回到无夜间检查，主诉最大来源复发）', file: 'js/avatar-lib.js', needle: "function avNightQuiet() {" },
  { name: '#876f 互动卡频率闸内夜间拦截（删＝询问/小问题/好奇/吐槽/查岗卡夜间照发）', file: 'js/ta-ask.js', needle: "nightModeActive && window.nightModeActive()) return false;" },
  { name: '#876g 群聊成员回复夜间顺延（删＝夜间群聊照常七嘴八舌）', file: 'js/group-chat.js', needle: "if (!__force && window.nightModeActive" },
  { name: '#876h TA 自动换位夜间不触发（删＝「隔着世界在你身边」等换位消息夜间照发）', file: 'js/p2-features.js', needle: "nightModeActive && window.nightModeActive()) return;\nconst companion" },
  { name: '#876i TA 自动送礼源头闸（删＝扣款已发生而礼物消息被总闸拦＝扣了钱没礼物）', file: 'js/gift-shop.js', needle: "nightModeActive && window.nightModeActive()) return;\nconst st = wlSettings();" },
  { name: '#876j 朋友圈自动动态夜间不生成（删＝夜里照发动态+聊天提示）', file: 'js/feed.js', needle: "nightModeActive && window.nightModeActive()) return;\nconst cs = window.storeFor(cid);" },
  { name: '#876k 跨桌面消息队列回放夜间暂停（删＝夜里回放其他桌面队列照常进聊天）', file: 'js/bg-keep.js', needle: "if (!force && window.nightModeActive && window.nightModeActive()) return 0;" },
  { name: '#876l 夜间模式说明改「完全静默」口径（退回旧「只拦主动」文案＝用户再被误导「为什么回复还在发」）', file: 'js/settings-help.js', needle: "这段时间内 TA 完全静默" },
  // ==== 2026-09-20 #876 吃什么转盘「转盘抽取」中奖片不在指针下：旧公式把指针当在右侧 0 角（2π-normalized），CSS 指针实际钉在正上方（.eat-pointer top:-12px 尖朝下＝画布角 3π/2）＝高亮片/「今天吃」菜名恒与指针错开约 1/4 圈（2~30 格×500 随机角仿真 100% 错位）。修法＝抽 eatIdxUnderPtr（顶部指针几何），主转盘＋切菜单转盘两处接线 ====
  { name: '#876a 转盘中奖片按顶部指针几何计算（指针 .eat-pointer 在 12 点＝画布角 3π/2；改回 2π-零角旧形态＝高亮/菜名恒不在指针下）', file: 'js/p2-features.js', needle: 'function eatIdxUnderPtr(normalized, n, slice) { return Math.floor((((3 * Math.PI / 2 - normalized)' },
  { name: '#876b 主转盘接线（删＝吃什么页「转盘抽取」中奖片与指针错位复发）', file: 'js/p2-features.js', needle: 'eatIdxUnderPtr(normalized, dishes.length, slice)' },
  { name: '#876c 切菜单转盘接线（删＝切换菜单转盘中奖菜单与指针错位复发）', file: 'js/p2-features.js', needle: 'eatIdxUnderPtr(normalized, names.length, slice)' },
  { name: '#878a 卡片入场动画类在挂载前补加（#878 报障：礼物/互动卡无动画突兀出现。根因=renderMsg 建节点时加 msg-enter、随后所有分支 m.className=… 整体覆盖抹掉；needle=补类与挂载同行的接线锚——类加回建节点处即失效消失）', file: 'js/chat.js', needle: "if (!batchRendering) m.classList.add('msg-enter'); (appendTarget || body).appendChild(m);" },
  // ==== 2026-09-20 #877 聊天设置两行头像「点击无反应」第七波根治（小米14 Edge 实报、多机型同现；零机型分支）：激活链原来只有「label 转发＋JS 合成 click」两条腿，#738 已实锤小米系对 JS click 静默不弹——两条腿同时失效的内核上彻底无声（probe-877-thirdleg 在 HEAD 复现 chooser=0 零提示）。兜底腿升级「showPicker→click→可诊断 toast」三级，guard 信号窗保证不双开 ====
  { name: '#877a 头像兜底第三条腿 showPicker（删＝label 不转发＋click 被无视的内核回到点击无声）', file: 'js/chat-settings.js', needle: 'try { headInput.showPicker(); opened = true; } catch (e) {}' },
  { name: '#877b 三条腿全失效时不再无声（删＝用户点击无反应且拿不到任何可反馈现场）', file: 'js/chat-settings.js', needle: "toast('相册没能打开：请换系统浏览器或 Chrome 打开再试，仍不行请截图本提示反馈（头像#877）');" },
  // ==== 2026-09-20 #879 苹果11 Safari 实报「美化文件导入用不了」（用户注明多机型同现、勿做机型分支；诊断实证收到 9916 字符、开头 <!DOCTYPE html>＝分享/售卖链路把方案打包成网页文件，打开全选复制或选文件选中 .html 后 #408 自救解析①~③全失效、抛天书 JSON Parse error）。修法＝mochiParsePastedJSON 追加第④步（纯数据链路、零机型分支，桌面/聊天美化两个导入入口共用）：<textarea>/<pre>/application.json 容器内文实体还原优先＋全文字符串感知花括号配平扫描取 {...} 候选按长度降序，逐候选走完整清洗梯子、仅真解析成顶层对象才采用（提错由导入方用途校验兜底）；提取失败换可行动报错 ====
  { name: '#879a 网页包裹方案提取入口（删＝分享/售卖网页文件里的方案解析失败复发「美化文件导入用不了」）', file: 'js/personalize.js', needle: "const htmlLike = /<!doctype\\s*html|<html[\\s>]|<body[\\s>]|<textarea[\\s>]/i.test(t1);" },
  { name: '#879b 提取失败可行动报错（删＝用户再拿到天书 JSON error 无从下手）', file: 'js/personalize.js', needle: "lastErr = new Error('粘贴的是网页不是方案文本" },
  // ==== 2026-09-20 #881 聊天设置两行头像补「头像和昵称互动也能换＋会覆盖」静态提示（用户直派：互动触发联系人换头像会覆盖聊天设置的头像，用户不知情以为设置失效）====
  { name: '#881a 联系人头像行覆盖提醒（删＝开随机更换的用户不知道 TA 换头像会顶掉这里设置的头像）', file: 'template.html', needle: '开了随机更换后，TA 换头像会覆盖这里设置的' },
  { name: '#881b 我的头像行覆盖提醒（删＝开 TA 主动给我换头像的用户不知道会顶掉这里设置的头像）', file: 'template.html', needle: '「TA 主动给我换头像」触发时会覆盖这里设置的' },  // ==== 2026-09-20 #886 吃什么转盘「指针永远跟着显示的菜走」＋切桌面复位＋提醒键清扫（用户确认三项都修）：①打开/「换一个」/改菜单重抽（都走 eatPick）后 eatAlignWheelToDish 把显示菜扇区中线转到顶部指针下——#876 只修了「转盘抽取」，静置/换一个时指针仍与显示菜无关；②编辑菜单面板/切换菜单浮层是页内常驻节点，.page 整页隐藏看不见但跨桌面重进会带着上一桌面的面板状态（第一次点「编辑菜单」变关闭），contact-switched 时停转＋关浮层＋收面板；③eat-remind-done「今日已提醒」键每天至多 4 键永不清理，清扫只留当天（xyStore.remove 三处同清） ====
  { name: '#886a 指针永远指着显示的菜（显示菜扇区中线转到 3π/2；删＝打开/换一个后指针与显示菜无关）', file: 'js/p2-features.js', needle: 'eatSpinAngle = ((3 * Math.PI / 2 - (i + 0.5) * slice) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);' },
  { name: '#886b 切桌面复位（删＝跨桌面重进带着上一桌面的编辑面板/切换浮层状态）', file: 'js/p2-features.js', needle: "document.addEventListener('contact-switched', function () { eatClearSpin(); eatSwitchClose(); const mp = document.getElementById('eat-menu-panel'); if (mp) mp.hidden = true; });" },
  { name: '#886c 提醒键清扫只留当天（删＝eat-remind-done 键每天至多 4 个无限累积）', file: 'js/p2-features.js', needle: "const scan = pfx + ':eat-remind-done:';" },
  { name: '#894a 读取中不清注入（删＝弱内核切桌面字体应用消失复发）', file: 'js/chat-settings.js', needle: "if (!v && rawVal.indexOf('@@font:') === 0 && !_fontBlobGone[rawVal.slice(7)]) return;" },
  { name: '#894b 丢失终局广播（删＝美化页入口不跟随清除丢失字体）', file: 'js/chat-settings.js', needle: 'csFontChanged(); // #894：丢失是终局' },
  { name: '#894c 美化页读取中保留（删＝切桌面美化入口误清字体）', file: 'js/personalize.js', needle: "if (!v && raw.indexOf('@@font:') === 0 && keepPending) return;" },
  // ==== 2026-09-20 #893 进群「聊天记录滚动闪一下才恢复」根治（PWA 装桌面用户实报每次进出群聊都闪、无加载缓冲；零机型分支）——enterGroupChat 无条件 body.innerHTML='' 整窗重渲 200 条＝图片头像全部重新解码＝每次进都闪；修法＝群聊同窗跳过指纹（单聊 #220 同款思路）：同群同条数＋首尾消息指纹＋成员名/头像/昵称开关指纹一致且无 gcSwitchDirty 时只回底不重建，任何变化照旧全量重建、展示结果一字不差 ====
  { name: '#893a 群聊进群同窗跳过判定（删＝退回每次进群都整窗重建、历史滚动闪一下复发；gcRenderedFp 只在这处比较点有意义，勿「统一」成其他写法）', file: 'js/group-chat.js', needle: 'if (!gcSwitchDirty && body.children.length && gcEntrySig() === gcRenderedFp) {' },
  { name: '#893b renderAll 结尾登记屏上窗口指纹（删＝指纹永不更新，跳过判定失效退化成每次重建或永不重建，两头都是回归）', file: 'js/group-chat.js', needle: 'gcRenderedFp = gcEntrySig(); //' },
  { name: '#874a 进聊天分帧空窗期 scroll 不作数（删＝空窗期旧滚动位被钳回 0 的必发事件误触发上翻加载、appendTarget 被改道、finishSwap 首批甩到列表尾＝「进聊天跳到历史记录、底部永远看不到最新」）', file: 'js/chat.js', needle: 'if (batchRendering) return; // #874a' },
  { name: '#874b loadOlderIncremental 空窗入口守卫（删＝#874a 同根因换路径：renderStart 白前移＋自身 frag 在空 body 下整批丢弃）', file: 'js/chat.js', needle: 'if (batchRendering) return; // #874b' },
  { name: '#874c loadNewerIncremental 同闸（删＝构建期增量下插/追加改道 appendTarget 踩乱换装顺序）', file: 'js/chat.js', needle: 'if (batchRendering) return; // #874c' },
  { name: '#874d 空窗期 touchstart 不解钉（删＝进度条期一次上滑令 finishSwap 跳过落底、看门狗/稳定窗全被 pinned=false 关在门外＝停在列表顶部旧记录）', file: 'js/chat.js', needle: 'if (!batchRendering) unpinChatAndAnchor(); // #874d' },
  { name: '#874e wheel 与 #874d 同闸（删＝桌面端滚轮路径空窗期照解钉，同一缺陷留后门）', file: 'js/chat.js', needle: "'wheel', function () { if (!batchRendering) unpinChatAndAnchor(); }" },


/* ==== 2026-09-20 #891 用户直派「五子棋游戏结束没有卡片显示输赢，只有发送聊天消息；其他小游戏（四子棋等）一并检查」＝chat.js renderMsg 对 gomoku/c4/ms/linkup/match3/auction 六个 special 一个卡片分支都没有（pong/brick/memory/snake/rps 有），结算消息全部掉进通用气泡 ==== */
  { name: '#891a 小游戏结算卡片渲染分支（删＝六个游戏的结算回流成普通气泡，「没有卡片显示输赢」复发）', file: 'js/chat.js', needle: 'if (GAME_CHAT_CARDS[rec.special]) {' },
  { name: '#891b game 结算负载进 chatAddSystem 转发白名单（删＝字段被白名单就地吞掉，卡片永远只能按正文降级、拿不到输赢结论与本局数据）', file: 'js/chat.js', needle: 'game: opts.game, askQuestion:' },
  { name: '#891j game 结算负载进 addIn→addRec 持久化白名单（删＝负载在落库前被吞，卡片永远只剩正文降级、拿不到本局数据）', file: 'js/chat.js', needle: 'game: opts.game, quote:' },
  { name: '#891c 五子棋结算带结构化负载（删＝卡片只剩正文一行、无胜负色与手数/战绩/先手）', file: 'js/gomoku.js', needle: 'game: gPayload }' },
  { name: '#891d 四子棋结算带结构化负载（用户点名游戏，删＝输赢卡片复发缺失）', file: 'js/connect-four.js', needle: 'stats: c4Stats' },
  { name: '#891e 合作扫雷结算带结构化负载（合作局结论=完成/差一点）', file: 'js/coop-mine.js', needle: 'stats: msStats' },
  { name: '#891f 连连看结算带结构化负载', file: 'js/linkup.js', needle: 'stats: lkStats' },
  { name: '#891g 消消乐结算带结构化负载', file: 'js/match3.js', needle: 'stats: m3Stats' },
  { name: '#891h 拍卖会场次结算带结构化负载', file: 'js/auction.js', needle: 'result: auRes' },
  { name: '#891i 结算卡片结论行输赢上色样式（删＝卡片样式塌陷、你赢/TA 赢同色看不出结果）', file: 'css/chat-pages.css', needle: '.msg-game-result.game-win,.msg-game-result.game-clear { color:#1f9d55; }' },

// ==== 2026-09-20 #892 此间梦角「删除后不再自动添加＋时辰浮层取消丢掉整个添加」 ====
  { name: '#892a 删空名单清播种标记＝恢复自动播种（删＝该桌面永远空态再也不自动建梦角）', file: 'js/cjian.js', needle: 'if (!list.length) { const rs = storeOf(mCid); if (rs) rs.remove(SEED_KEY); }' },
  { name: '#892b 时辰浮层取消照常按已选偏移建档（改回取消＝不创建＝「设置不了随机时间流」复发）', file: 'js/cjian.js', needle: 'function () { createPlain(); }, // 取消：时辰不限定，照常建档' },
{ name: '#903a 时段变动失效已抽当前时刻（不失效＝改完时辰区间仍显示老时辰旧时刻到冷却结束，「设置的时间与显示的时辰对不上」复发）', file: 'js/cjian.js', needle: 'function invalidateTaTime(cid) { try { const s = storeOf(cid); if (s) s.remove(\'cjian-ta-time\'); } catch (e) {} }' },
  { name: '#903b 改时辰区间后立即重抽世界时间（不重抽＝梦角世界时间驻留旧时辰 1-8 小时）', file: 'js/cjian.js', needle: 'clearOttTag(c.id); invalidateTaTime(mCid); // #903：改回时间偏移流动同样重抽' },
  /* ==== 2026-09-20 #900 每日备份提醒「从来没弹过」根治＋人话警示＋醒目配色（2026-09-20 16:1x build.mjs 工作树覆盖事故后按会话存档重建；#900f/g 两条 name 系重写、needle 原样） ==== */
  { name: '#900a 开屏没关就不试也不写冷却（删＝备份提醒弹在 splash 之下看不见却烧掉当天冷却，「从来没弹过」复发）', file: 'js/pwa.js', needle: 'if (!splashGone()) return;' },
  { name: '#900b 冷却改按自然日比较（改回「距今满 24 小时」＝每天早一秒打开永远凑不满 24h，提醒无限往后漂）', file: 'js/pwa.js', needle: 'if (lastRemind && dayKey(lastRemind) === dayKey(Date.now())) return false;' },
  { name: '#900c 常驻复查时间线在位（删＝PWA/后台保活数天不刷新时再没有第二次判定机会，「每天提醒」名存实亡）', file: 'js/pwa.js', needle: 'setInterval(function () { try { tryShow(); } catch (e) {} }, 60000);' },
  { name: '#900d 唯一 #modal-mask 被占用时让路且不写冷却（改回硬顶或超时兜底＝顶掉别人的弹窗/当天被烧掉）', file: 'js/pwa.js', needle: "if (r === 'busy') return;" },
  { name: '#900e 人话警示文案在位（删＝用户又只看到「建议导出备份」，不知道任何手机/浏览器都会自动清数据＝设备限制）', file: 'js/pwa.js', needle: '这是设备本身的限制，网站没有办法替你保住数据' },
  { name: '#900f 备份顶条醒目配色（删＝红橙渐变退回与版本条同款深灰，用户要求「颜色要显眼」落空；needle=该行整体，base.css 内唯一）', file: 'css/base.css', needle: '#backup-remind-bar { background:linear-gradient(90deg,#e8382c,#f26a1b)' },
  { name: '#900g 弹窗警示形态样式在位（删＝opts.warn 变哑参数，备份提醒又回到普通白底弹窗）', file: 'css/base.css', needle: '.modal.modal--warn { border-color:#e8382c;' },
  { name: '#900h openModal 按 opts.warn 挂警示类（每次开弹窗重挂＝天然复位；删＝全站警示形态失效）', file: 'js/personalize.js', needle: "classList.toggle('modal--warn', !!opts.warn)" },
  { name: '#900i 顶条静态占位文案同口径（删＝模板占位与 showBar 写入文案两套口径）', file: 'template.html', needle: '手机和浏览器都会自动清空数据，一清就全没' },
  /* ==== 2026-09-20 #900 续：用户跟进「确定说的人话提醒标的不同颜色吧，不然用户总是看不懂」＝只有浅红底时正文与站内普通说明文字同色（--ink），看着没被特别标注。修法＝警示弹窗正文本身染红（base.css .modal--warn .modal-static color + 4px 左竖条）+ dark.css 扁平覆盖提亮为亮红（浅色那套 #c92a1f 在深底上仅约 2.7:1）。行为断言 tools/verify-backup-remind-daily.mjs S11/S12 + B2h~B2j + B8 ==== */
  { name: '#900j 警示弹窗只把重点片段染红（删回整块正文染红＝用户报的「文字全都变成红色了」，满屏皆重点）', file: 'css/base.css', needle: '.modal.modal--warn .modal-static .modal-static-key { color:#c92a1f;' },
  { name: '#900k 深色主题把重点片段提亮成亮红（删＝深底上沿用 #c92a1f 约 2.7:1 看不见，深色用户又看不到重点）', file: 'css/dark.css', needle: '[data-theme="dark"] .modal.modal--warn .modal-static .modal-static-key { color:#ff8a7a;' },
  { name: '#900l 删除型守卫：警示说明块本体不得再整块染红（回流＝用户跟进「备份里的文字为什么全都变成红色了」；旧 needle 加回即报）', file: 'css/base.css', needle: '.modal.modal--warn .modal-static { color:#c92a1f;', absent: true },
  { name: '#900m 重点标记只走 textContent 拆分挂载（删＝opts.staticEmph 失效、重点又只能整块染色；同时锁死「调用方文本被当 HTML 解析」这条路）', file: 'js/personalize.js', needle: "key.className = 'modal-static-key';" },
  /* ==== 2026-09-20 #884 用户直派「低电量模式也提醒 iOS 不要用低电量模式会变卡，说明放在卡顿说明显眼地方」＋iPhone 15 Pro/16 Pro 实报「聊天返回主页面和主页面切换卡」两份诊断（静态帧率 64fps＝非低电量、切页现场无尺子）；后追加：关于段必读条 #884c、卡顿自检报告复制/导出 #884d ==== */    { name: '#884a 卡顿说明低电量首条提醒（删＝「iOS 怎么用都卡」查不到低电量锁 30fps 这一最常见成因）', file: 'template.html', needle: 'iPhone 第一条：别开「低电量模式」' },    { name: '#884b 切回桌面帧耗时采样接线（desktop-slider 在 page-phone 取消隐藏时采 30 帧写 __diag-swperf；删＝切页类卡顿报障回到没有现场数据的猜测）', file: 'js/desktop-slider.js', needle: "swSample(); // #884：从聊天/其他页切回桌面那一刻现场采一段帧耗时" },    { name: '#884c 关于段「省电模式发卡」必读警示条（删＝只看关于页的用户查不到「卡＝系统省电模式锁半速」这一最常见成因）', file: 'template.html', needle: 'id="about-perf-note"' },    { name: '#884d 卡顿自检报告复制/导出接线（删＝报告只剩可手选文本，手机上没法整段发给开发者）', file: 'js/personalize.js', needle: "mochiDiagExportDocx(txt, 'mochi-perfcheck-'" },    /* ==== 2026-09-20 #887 用户实报「有的 iOS 型号导出不了 docx、导出的文件是空白」（明说其他机型也有、勿做机型分支）＝①exportDocx 裸下载 800ms revokeObjectURL 作废慢速 iOS 未写完的文件（data-backup.js anchorDownload 同族 v3.28.x 已修、docx 侧漏网）②空内容守卫 ③导出存根 __diag-export 证据定责 ==== */    { name: '#887a docx 裸下载 blob URL 长命化（删＝800ms revoke 回流，慢速 iOS 导出空白文件复发；pagehide+300s 同 anchorDownload 口径）', file: 'js/device.js', needle: "'pagehide', function h()" },    { name: '#887b 导出空白内容守卫（删＝报告没生成完点导出又产空白页 docx）', file: 'js/device.js', needle: '报告还没生成好' },    { name: '#887c 导出存根 __diag-export（删＝空白文件类报障没有通道/大小/UA 证据，只能继续猜内核名单）', file: 'js/device.js', needle: 'blob-broken' },    /* ==== 2026-09-20 #905 用户实报①「卡顿自检黑色弹窗位置太靠下不居中，把正常使用按钮挡住了」②「为什么只能测十秒，不合理」＝浮条改顶部居中小胶囊（避开 tabbar/输入栏）+ 时长可选 10/30/60 秒/2 分钟/5 分钟默认 30（perf-check.js 写死 30s 钳制一并放开到 300s）；设置行接线哨兵已随本批同步换锚 start(durMs) ==== */    { name: '#905a 实测浮条顶部居中胶囊（删＝底部横条回流，视觉挡住 tabbar/输入栏，实测期间没法点底部按钮）', file: 'js/personalize.js', needle: 'position:fixed;top:max(14px,env(safe-area-inset-top,0px));left:50%' },    { name: '#905b 实测时长可选 10/30/60/120/300（删＝写死 10 秒回流，偶发巨帧整窗漏采、样本不足）', file: 'js/personalize.js', needle: '30: 30000, 60: 60000' },    /* ==== 2026-09-20 #889 边看边调「栏位」位置滑杆补小字提示（2026-09-20 16:1x 覆盖事故后按台账恢复；见 FIX-REGRESSION #889 第二条） ==== */
  { name: '#889a 单聊抽屉栏位位置滑杆提示（删＝用户又不知道顶栏/输入栏可以拖着挪位，知情提示回流）', file: 'js/chat-settings.js', needle: "mkNote('这两条位置滑杆拖着就能" },
  { name: '#889b 群聊抽屉栏位位置滑杆提示（删＝群聊版同款知情提示回流）', file: 'js/group-chat.js', needle: '拖着就能把栏位上下挪位' },
  /* ==== 2026-09-20 #902 TA在身边/此间概率与触发节奏写进界面（用户直派「概率和触发时间要写清楚」；纯文案，恢复自本批） ==== */
  { name: '#902a 此间页概率/节奏说明锚（删＝感知概率、状态流动间隔、突然靠近概率重新变成黑盒）', file: 'template.html', needle: 'cj-rate-note' },
  { name: '#902b 位置面板换位间隔与概率说明锚（删＝TA 自动换位 2~6 小时/70% 陪伴卡的说明回流黑盒）', file: 'js/p2-features.js', needle: '70% 是陪伴卡' },
  /* ==== 2026-09-20 #904 听歌邀请「同意后小框消失也没播放」（红米 K80 Chrome PWA 实报；接受链路静默死亡出口封堵） ==== */
  { name: '#904a 接受邀请前清残留来电 hold（删＝stale callHoldPending 让 startPlayback 静默 return＝点了同意没声没提示，小框被 hold 藏起不回来）', file: 'js/music-player.js', needle: 'callHoldPlaying = false; callHoldPending = false; // #904a' },
  { name: '#904b 同意后起播校验兜底（删＝被外部打停的歌在前台永远没人拉起＝接受后永不响也不提示）', file: 'js/music-player.js', needle: 'armInvitePlayCheck(); // #904b' },
  // #910 房间 TA 头像放大＋自成一层（CSS 哨兵按 minify 后单行产物形态取锚）
  { name: '#910a 房间 TA 头像放大到 44px 并自成一层（改回 34px 或去掉 translateZ＝真人照片认不出是谁、「头像很模糊看不清」复发）', file: 'css/room.css', needle: 'width: 44px; height: 44px; transform: translateX(-50%) translateZ(0)' },
  { name: '#910b 走路颠步关键帧保留自成一层（掉 translateZ＝走动时头像并回祖先合成层按 1x 重采样，走动段又发糊）', file: 'css/room.css', needle: '@keyframes rBob { 0%,100% { transform: translateX(-50%) translateZ(0); }' },
  /* ==== 2026-09-20 #913 手机发烫收口（用户直派「发烫问题要优化+提示怎么改善」）：①切后台全局暂停 CSS 动画总闸（后台保活用户挂后台/锁屏过夜＝无限动画合成照跑的纯浪费热源，与 #436 后台减负同哲学）②工具段补「发烫」人话排查条（保活/边充边用/省电模式/多标签/数据堆积） ==== */
  { name: '#913a 切后台动画暂停闸接线（删＝挂后台的无限动画照常合成，后台保活用户过夜发热回流）', file: 'js/mobile-adapt.js', needle: "classList.toggle('mochi-bg-pause', !!document.hidden)" },
  { name: '#913b 切后台暂停动画的 CSS 落点（删＝闸挂了类也没有效果）', file: 'css/base.css', needle: 'body.mochi-bg-pause *::before' },
  { name: '#913c 工具段发烫排查条（删＝用户只有卡顿说明、没有发烫的对症清单）', file: 'template.html', needle: 'id="heat-help-sub"' },
  { name: '#912a 瞬时贴底写入取消在飞平滑动画（删＝连发期间旧动画帧用旧 start/target 把刚写到位的 scrollTop 拉回去＝「联系人发消息总不在最底部」复发）', file: 'js/chat.js', needle: 'if (_ccSmoothT) { cancelAnimationFrame(_ccSmoothT); _ccSmoothT = null; } chatPinnedBottom = true;' },
  { name: '#912b 解钉当场取消在飞平滑动画（删＝动画跟用户手指对打＝#716 同族回流）', file: 'js/chat.js', needle: "if (_ccSmoothT) { cancelAnimationFrame(_ccSmoothT); _ccSmoothT = null; } body.classList.add('scroll-anchor-auto');" },
  /* ==== 2026-09-20 #916 顶部白条/显示不全+聊天闪动（Edge 工具条显隐 dvh 滞留族）根治 + 屏幕适配错误环红点只增不减收口 ==== */
  { name: '#916a 安卓稳态高度对账两拍确认钉高（改回一拍即钉＝工具条显隐动画中途误钉来回抽，本批报障复发）', file: 'js/mobile-adapt.js', needle: 'if (_aFitPend === _aExpB) {' },
  { name: '#916b 屏幕适配错误环同签名 24h 去重（删＝红点数随每次刷新只增不减，本批报障复发）', file: 'js/device.js', needle: "_sdSig = '[屏幕适配] ' + String(names).split('｜')[0];" },
  { name: '#923a 红包「设置」区弹性滚动子项规则在位（删掉＝实测 810~860px 的设置内容画到 max-height:48% 的面板外，手机上「有字超出这个页面」＋「完成」按钮离屏 278~544px 点不到复发；needle=该选择器行，css/chat-main.css 内唯一）', file: 'css/chat-main.css', needle: '.rp-settings:not([hidden]) {' },
  { name: '#923b 设置区作为可收缩 flex 子项（删 min-height:0＝flex 项按内容撑开、容器不收缩，溢出面板底边照旧复发）', file: 'css/chat-main.css', needle: 'flex:1 1 auto; min-height:0;' },
  /* ==== 2026-09-20 #926 系统预设字卡「整组停用/启用」（用户直派：默认聊天字卡与词典只有关闭单独字卡、缺少关闭某个分组；零机型分支）——存 <桌面>:dc-groups-off = { 分类: [分组名] }，生效收在 apiFor(st).isOff 这一个消费端总闸（单卡闸 OR 分组闸），聊天/群聊/写信/朋友圈/日历/词典拼字/梦角造句/各功能同源池全部自动跟上；分组开关只叠一层，组内 dc-off-* 单卡存值一字不改。UI 在共用工厂 mountCardView（四页：默认聊天字卡/功能字卡/词典/查岗），容器打 .preset-list 限定样式。验证 tools/verify-dc-group-off.mjs 绿 23/23、纯 HEAD 红 13 条全落缺陷面。 ==== */
  { name: '#926a 预设字卡分组停用收在 isOff 总闸（单卡闸 OR 分组闸双判定；删＝整组开关只剩 UI、抽取照旧命中，本批报障复发）', file: 'js/default-cards.js', needle: 'return groupOffFor(cat, c, st);' },
  { name: '#926b 分组停用写当前桌面聚合键（整份重写 {分类:[组名]}，不逐张写 dc-off-*；改回逐张＝点一次大组写上千键，iOS 主线程冻结族复发）', file: 'js/default-cards.js', needle: 'ls.set(GOFF_KEY, JSON.stringify(next));' },
  { name: '#926c 分组头渲染整组开关与停用态类（删＝四个预设列表页没有整组入口，本批报障复发）', file: 'js/default-cards.js', needle: "d.className = 'cc-group-header' + (goff ? ' off' : '');" },
  { name: '#926d 分组开关样式限定 .preset-list（删＝四页开关变形且 emoji/拍一拍列表分组头被误套，本批范围失控）', file: 'css/chat-pages.css', needle: '.preset-list .cc-group-header .ccard-toggle { width:36px; height:21px; flex-shrink:0; }' },
  /* ==== 2026-09-20 #919 进聊天「跳到历史记录、看不到最新消息、退出重进才恢复」第二条独立通道根治
     （HUAWEI Mate 40 Pro + Edge 实报，多机型同现；零机型分支）：msgs 出现空洞记录（undefined/null）时
     renderWindow 两条循环直接 renderMsg(msgs[i]) 未设防 → TypeError 打断整轮构建 → frag 永不换装＝
     body 恒空/停旧记录、进度条卡死（上翻/回钉/看门狗全被闸死）；真机错误栈 buildChunk→renderMsg
     「reading 'side'」实锤。修法＝两条循环先判记录有效性、坏记录跳过不画，其余照常走完换装落底。 ==== */
  { name: '#919a 分帧整窗路径空洞守卫（删＝构建途中 renderMsg 抛错断链、frag 永不换装＝看不到最新消息复发）', file: 'js/chat.js', needle: "if (!_rm || typeof _rm !== 'object') continue; // #919a 记录位空洞/坏记录跳过不画" },
  { name: '#919b 同步整窗路径空洞守卫（删＝异常一路上抛、调用方贴底收尾整段跳过）', file: 'js/chat.js', needle: "if (!_rm || typeof _rm !== 'object') continue; // #919b 同 #919a：同步整窗路径也不得被单条空记录打断" },
  /* ==== 2026-09-20 #932 字卡状态自检纳入「整组停用」（#926 的 dc-groups-off）：此前本页只按 dc-off-* 逐张统计＝整组停用清空分类时自检报「未发现明显问题」、一键修复也不接管 ==== */
  { name: '#932a 分类内容闸按单卡∪分组合并口径（退回 total-off 单卡计数＝分组停用清空分类时该行仍显示 ✓，本批报障复发）', file: 'js/card-audit.js', needle: 'var avail = total - effOff(k);' },
  { name: '#932b 取不到张数改问消费端总闸 isOff（换成自数 dc-off-*＝以后再加一道闸门自检又会落后于功能）', file: 'js/card-audit.js', needle: 'if (api.isOff(cat, c)) n++;' },
  { name: '#932c 整组停用逐分类报警走名单通配遍历（删＝停一组时清单静默，用户看不到这类卡为什么不出）', file: 'js/card-audit.js', needle: '个分组被整组停用（组内 ' },
  { name: '#932d 一键修复接管整组停用（缺这条＝批量修复只清单卡，被分组闸卡住的分类修不好）', file: 'js/card-audit.js', needle: "else if (f.kind === 'goff') fixPresetGroups(f.id, f.cat);" },
  { name: '#932e 启用分组只删本分类名单不动单卡值（整体清或连带 dc-off-* 一起改＝越权改用户设置）', file: 'js/card-audit.js', needle: "return storeSet('dc-groups-off', JSON.stringify(o)) ? true : 'fail';" },
  { name: '#932f 入口角标计数认整组停用（删＝不打开页面看不到有问题，角标仍是零告警面）', file: 'js/card-audit.js', needle: 'var gso = goffRecord();' },
  { name: '#932g 词典漏斗补内容闸（dictPoolN 已按 effOff 统计，删该闸＝池被清空仍显示可用）', file: 'js/card-audit.js', needle: "{ t: '内容', ok: dictPoolN > 0 }" },
/* ==== 2026-09-20 #933 聊天记录上划用力错位（内容上移半屏、下方留白、轻点恢复）根治＝回钉不再当场写、几何写入交落定锁静默后一枪（iPhone 12 Pro Max Safari 实报，用户点名多机型同现；零机型分支：写只发生在滚动全静默后） ==== */
{ name: '#933a 回钉分支当场置钉＋几何交落定锁（删＝又回到惯性/橡皮筋回弹中途写 scrollTop，WebKit 滚动树停旧偏移＝错位半屏复发）', file: 'js/chat.js', needle: "chatPinnedBottom = true; body.classList.remove('scroll-anchor-auto'); chatScrollRealignQuiet();" },
{ name: '#933b 落定重对齐入口（删＝回钉置钉后无人落定补写，撕裂滞留态只能靠轻点救）', file: 'js/chat.js', needle: 'function chatScrollRealignStep() {' },
{ name: '#933c 落定锁未静默时续等（删＝中途抢写，与 #861 落定闸契约破裂）', file: 'js/chat.js', needle: 'if (!chatRepinQuietEnough(now)) { if (now < _rsAlignDeadline) _rsAlignT = setTimeout(chatScrollRealignStep, 120); return; }' },
{ name: '#933d 落定判据贴底/钉住写底、否则转解钉钳回（删＝解钉态被拽底或撕裂态无人写，#162/#416 契约回退）', file: 'js/chat.js', needle: 'if (chatPinnedBottom || chatAtBottom()) { scrollChatBottom(); return; }' },
  // ==== 2026-09-20 #934 卡顿自检报告口径纠偏（红米 K80 Chrome 实报 docx：fps 分母含后台＝「24.2fps」与「16.4ms」自相矛盾；「掉帧集中：朋友圈（该页 0.5% vs 全窗 1%）」按掉帧计数选中停留最久、掉帧率更低的页；后台占比提示拿段数与帧数比大小＝恒不触发；>250ms 的亮屏阻塞被当后台冻结剔除＝最长 1630ms 在报告里隐身且无归因）====
  { name: '#934a 后台/锁屏时长实测（删＝fps 分母回整窗虚低、后台占比提示再失效、间隙判定失可见性依据）', file: 'js/perf-check.js', needle: 'var bgMs = 0, hiddenAt = -1, hidPending = 0;' },
  { name: '#934b 前台冻结识别（删/改回「>250ms 一律当后台」＝亮屏下卡住 1.6 秒在帧统计里再次隐身）', file: 'js/perf-check.js', needle: 'var fz = d > BG_GAP ? 1 : 0;' },
  { name: '#934c fps 按前台有效时长算（删/改回 frames/ms＝60fps 窗口被写成 24.2fps、与「正常帧间隔」自相矛盾）', file: 'js/perf-check.js', needle: 'rep.fps = rep.effMs >= 1000 ? Math.round(rep.frames * 10000 / rep.effMs) / 10 : 0;' },
  { name: '#934d 集中页按掉帧率选且需 ≥2 倍其余页（删/改回按计数＝选中停留最久、掉帧率更低的页＝冤枉用户查错页）', file: 'js/perf-check.js', needle: 'return (pj / pf) >= 2 * (oj / of);' },
  { name: '#934e 长任务归因 top3（删＝「最长 1630ms」查无现场：来自哪页/是否后台期/是否切页后全无）', file: 'js/perf-check.js', needle: 'lt.top.push({ at: Math.round((es[i].startTime - t0) / 100) / 10,' },
  { name: '#934f 「掉帧分散」如实结论（删＝无集中页时结论缺位/仍可能点名某页）', file: 'js/perf-check.js', needle: '· 掉帧分散：最多的' },
  { name: '#934g 零星掉帧但窗内有冻结/长任务时不武断「无需处理」（删＝又回到「属正常波动，无需处理」与「最长 1630ms」并存）', file: 'js/perf-check.js', needle: 'if (_fzN > 0 || _ltN > 0) {' },
  /* ==== 2026-09-20 #935 电量消耗自测 + 发烫自测（用户直派「工具里新增一个电量消耗自测和发烫自测…用来检查异常」；零机型分支）：电量＝Battery 接口分段实测掉电速率（前台/后台/页面未运行分开算、充电段整段剔除、run 持久化可续测、跑完页面不可见则挂起回前台补弹）；发烫＝读不到温度（系统无接口）改测「降频后果」（静置基准 + 固定负载分轮比对首末耗时）。验证 tools/verify-energy-check.mjs。 ==== */
  { name: '#935a 电量自测续测守卫（有 run 记录且时段未到＝恢复采样；删＝刷新/被系统杀进程重开后续测丢失，长窗口自测不可用）', file: 'js/energy-check.js', needle: 'if (!run || !(run.t0 > 0) || !(run.ms > 0) || !(run.iv > 0)) return;' },
  { name: '#935b 采样停摆改按证据归段（stalledSeg；删＝停摆一律当「与本站无关」，#947 缺陷 2 复发）——本批换锚：原 needle 为「一律归 gap」的旧形态，逻辑只强不弱', file: 'js/energy-check.js', needle: "var st = (dt > run.iv * 2.5) ? stalledSeg(run) : run.lastSt;" },
  { name: '#935c 充电段整段剔除（充电中电量不降反升；删＝充电时段混进耗电统计，速率被摊薄甚至算成 0）', file: 'js/energy-check.js', needle: "run.lastSt = ch ? 'chg' : (document.hidden ? 'bg' : 'fg');" },
  { name: '#935d 发烫判级阈值（末段比开头慢 ≥25%＝明显降频；删＝发烫降频迹象不再报，本批报障面回流）', file: 'js/energy-check.js', needle: "if (slow >= SLOW_BAD) return '明显降频';" },
  { name: '#935e 到点续测交付等弹窗组件就绪（本文件排在 personalize.js 之前，boot 即弹＝reportModal 的就绪闸把报告静默丢掉，开页瞬间的报告再也看不见）——本批换锚：同一语句现在顺带排 boot 补弹', file: 'js/energy-check.js', needle: 'whenModalReady(function () { restoreRun(); popPendingAtBoot(); });' },
  /* ==== 2026-09-20 #947 电量/发烫自测三处缺陷收口（用户直派「按优先级修复第 1、2、4 条缺陷」；零机型分支）：①电量计只有 1% 颗粒度且会抖，各段「只记下降」能把 95%→95% 报成几十 %/小时＝补记有符号净掉电 net、以它为上限等比折算；②心跳停摆旧实现一律归「页面未运行、与本站无关」，安卓后台常见的分钟级节流被整段划进对照组＝只认「重开过/被内核回收过/上次还在前台」三种证据，其余进独立「不确定」段（不计结论也不并入对照组）；③挂起报告只挂在 visibilitychange 上，跑完直接关页＝下次开页永不弹＝全文永久丢失＝boot 侧补弹（开屏在场时先等它离场，别把报告压在公告上）。验证 tools/verify-energy-check.mjs。 ==== */
  { name: '#947a 有符号净掉电在记账（抖动封顶的原料；删＝只剩单边毛和，#947 缺陷 1 复发）', file: 'js/energy-check.js', needle: 'run.net += dLv;' },
  { name: '#947b 抖动封顶总闸（各段掉电等比缩到净掉电＝上限；删＝净掉 0 格也报几十 %/小时的虚高耗电）', file: 'js/energy-check.js', needle: 'if (hasNet && gross > net + 0.001) {' },
  { name: '#947c 不确定段独立归档（删＝心跳停摆那段又并进「与本站无关」对照组，#947 缺陷 2 复发）', file: 'js/energy-check.js', needle: "if (st === 'unk') { run.unkMs += dt;" },
  { name: '#947d 停摆归段只认三种证据（重开过/被内核回收过/上次还在前台；删＝不查证据一律开脱，特性检测退化成猜）', file: 'js/energy-check.js', needle: "if (_freshReload || wasDiscarded() || run.lastSt === 'fg') return 'gap';" },
  { name: '#947e 关页重开补弹闸（开屏离场后补弹一次；删＝挂起的报告永久烂在 pending 里，#947 缺陷 4 复发）', file: 'js/energy-check.js', needle: 'if (splashGone()) { popPending(); return; }' }
// #939 「网络不佳·点此重试」条永挂（部分手机刷新无效）——三条锚点（#939c 口径扣除随 #921h 在途批收口，不在本批提交面）：
,{ name: '#939a 包装 catch 登记错误清单（删＝运行期抛错文件被算成网络缺失，重试条永挂+每2h白重载；锚内联件 device.js 那份）', file: 'index.html', needle: 'if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("device.js")' },
{ name: '#939b 初始化行含错误清单（删＝catch 登记静默失效，#939a 形同虚设）', file: 'index.html', needle: 'window.__mochiErrLoaded = window.__mochiErrLoaded || [];' },
{ name: '#939d 健康即撤条+事件复查（删＝条挂上永不摘除，慢机回填>3s 永误报网络不佳；判据自包含不依赖 #921h missing()）', file: 'index.html', needle: 'function sweep() { var ex = (window.__mochiJsFiles || []).length, ok = !!window.__mochiDataReady && ex - (window.__mochiLoaded || []).length - (window.__mochiErrLoaded || []).length <= 0;' },
{ name: '#939e 「知道了」关闭钮+会话禁弹（删＝提醒条无法关闭、反复纠缠用户；只关提示不拦真网络问题重测）', file: 'index.html', needle: 'sessionStorage.getItem("mochi-boot-bar-off") === "1"' },
{ name: '#939f 窄屏换行（删＝320px 级屏两个按钮放不下一行被截出屏外，「知道了」点不到）', file: 'index.html', needle: 'b.style.flexWrap = "wrap"; b.style.rowGap = "6px";' },,
  // ==== 2026-09-20 #941 卡顿自检报告可读性三处（用户「还有什么可以优化的」点名 1/3/4）：①最慢帧现场图例按需出现＋补「键盘期」解释；②新增「与上次对比」行（LAST_KEY 摘要扩字段，旧格式记录不参与对比）；③长任务按页面归总（仅前台任务） ====
  { name: '#941a 现场图例按需出现（回流＝无对应标记也固定附解释、且「键盘期」标记无解释）', file: 'js/perf-check.js', needle: "if (_mk.sw) _lg.push('「切页后」＝紧跟页面切换 0.5s 内，多为打开该页的一次性渲染成本');" },
  { name: '#941b 「与上次对比」行（删＝报告丢失前后对照；摘要在覆盖写 LAST_KEY 之前读取）', file: 'js/perf-check.js', needle: "if (r.prev && typeof r.prev.janky === 'number') {" },
  { name: '#941c LAST_KEY 摘要扩字段（对比数据源；原三字段保留供设置行回显）', file: 'js/perf-check.js', needle: 'ltN: rep.lt ? rep.lt.n : undefined' },
  { name: '#941d 长任务按页面归总采样（仅前台任务计入 agg）', file: 'js/perf-check.js', needle: '_ag.n++; _ag.ms += dms;' },
  { name: '#941e 长任务按页面归总输出（≥2 次前台任务才出现、后台期点名）', file: 'js/perf-check.js', needle: 'var _ag = r.lt.agg || {}, _agList = [], _agN = 0;' },
  /* ==== #958 iPhone 12 Pro/iOS Safari「正常帧间隔约 4ms」纠偏（用户直派报告）＝刷新周期不再取单次最小帧间隔，改从直方图取「至少重复 3 次的最小取整间隔」，单次 4ms rAF 调度抖动不再把 jankThr 压到 24ms 下限、60Hz 的正常 25~33ms 帧不再被误计成掉帧 ==== */
  { name: '#958a 周期直方图计票（删＝回到单次最小值口径，一次 4ms 补帧抖动又把阈值压到 24ms、2.5% 轻度虚高回流）', file: 'js/perf-check.js', needle: 'gapHist[_g] = (gapHist[_g] || 0) + 1;' },
  { name: '#958b 周期取「反复出现的间隔」（删/改回直接 min＝4ms 伪周期回流；样本不足仍回退最小值）', file: 'js/perf-check.js', needle: 'minD = repMin || anyMin;' },
  /* ==== #965 「用户一直用旧版本、拿旧版 bug 反馈」根治＝自动升级不再依赖用户点更新条：用户已交互时不再放弃自动升级，改为「待换版」登记、页面转后台（切走/回桌面/锁屏）时 reload 落地；前台轮询发现新版也走自动通道；会话守卫改按版本 ts ==== */
  { name: '#968a 待换版登记函数（删＝用户已交互时自动升级又退回更新条，多数用户不点＝长期旧版回流）', file: 'js/pwa.js', needle: 'function armAutoReloadWhenHidden()' },
  { name: '#968b 自动通道落地时登记待换版而非只弹条（删/改回只 showVerBar＝不打断但也永远不自动升）', file: 'js/pwa.js', needle: 'if (auto && !autoReloadAllowed()) { armAutoReloadWhenHidden(); showVerBar(autoTs); return; }' },
  { name: '#968c 前台轮询发现新版也走自动通道（删＝长开会话只能等用户点条，几天不关就几天旧版）', file: 'js/pwa.js', needle: 'if (ts > baseTs) { if (!tryAutoUpgrade(ts)) showVerBar(ts); }' },
  { name: '#968d 自动升级守卫按版本 ts（改回每会话一次＝同一会话第二次部署不自动升）', file: 'js/pwa.js', needle: 'if (_ts > 0 && last >= _ts) return false;' },
/* ==== 2026-09-20 #931 朋友圈【贴纸】面板「点开非常卡顿」根治（用户直派，明说多机型同现、勿机型分支）：原实现把当前视图全部贴纸一次性 img.src=<20~68KB dataURL> 同步挂进 DOM（150 张库实测冷开同步 175ms、点「全部」365ms、面板标记 3.03MB、关掉再开 0/150 节点被复用＝每次从零重解码，重开 292ms），而聊天表情面板同一环境同一库走 #435 进视口补 src+分批泵 / #662 同身份节点回收 / #457 内容签名短路只要 60ms/8ms。修法＝把聊天侧那套已实证机制接到本面板（feed.js 自持 IntersectionObserver、图源只挂 JS 引用不进 DOM 属性、一条委托代替上百监听、内容未变整格不重建），零 UA/机型/内核判断。验证 tools/verify-feed-sticker-perf.mjs 绿 16/16、纯 HEAD 红 10 条全落缺陷面；相邻回归 verify-feed-sticker-panel 21/21、verify-feed-sticker-always 20/20、verify-sticker-dup 35/35、verify-feed-comment-media 18/18、verify-feed-personal-page 14/14、verify-hide-ta-sticker/verify-sticker-retract/verify-feed-sticker-pos/verify-sticker-double-send 与 HEAD 逐项同值。 ==== */
{ name: '#931a 贴纸图交给聊天侧同一条分批泵（删＝回到一次性全量挂 src，「点开卡顿」当场复发）', file: 'js/feed.js', needle: 'window.mochiEmojiLazyEnqueue(img, src)' },
{ name: '#931b 整格重写前先回收旧 img 进池（删＝关掉再开 0 复用、每次从零重解码）', file: 'js/feed.js', needle: 'feedStickerHarvest(list);' },
{ name: '#931c 内容签名短路（删＝同样的内容每次重建上百格子＋重挂观察器，重开 65.9ms→16.9ms 的收益回流）', file: 'js/feed.js', needle: 'sig === feedStickerRenderSig' },
{ name: '#931d 聊天侧懒挂三件套导出给外部容器借用（删＝贴纸面板拿不到泵/回收池/批量预热，只能退回即时 src）', file: 'js/chat.js', needle: 'window.mochiEmojiLazyEnqueue = emojiLazyEnqueue;' },
{ name: '#931e 泵按 JS 引用取源且用完即清（删＝节点被回收池复活时带着上一轮的源，或大 dataURL 又被复制进 DOM 属性）', file: 'js/chat.js', needle: 'img.__emojiLazySrc = null;' },
  // #938 边看边调「切换气泡框大小会闪屏」根治＝applySettings 全局 DOM 翻动归零（红米 K80 Chrome 用户直派、多机型同现；零机型分支）
  { name: '#938a body cs-time-* 类仅在现状≠目标时才翻转（删＝每次 applySettings 无条件 7 remove＋1 add，body class 属性真实变更＝全文档样式失效，点抽屉任意控件闪屏回流）', file: 'js/chat-settings.js', needle: 'if (curTimeCls !== wantTimeCls) {' },
  { name: '#938b 气泡强制生效层按文本比对就地重建（删＝#cs-bubble-enforce STYLE 每次点击拆建，非默认透明度/圆角的设备闪屏面仍在）', file: 'js/chat-settings.js', needle: 'if (old.textContent !== text) old.textContent = text; return;' },
  // #938c~h 同族其余写入点：闪屏不是「某一次真改」贵，而是「值没变也全部白写一遍」贵——:root 十六条内联
  // 自定义属性全站继承＝整篇文档样式作用域重解析，#page-chat 是壁纸层与数百条气泡的共同祖先。删掉任一条
  // 比对守卫＝该面回到每次抽屉点击无条件重写（红米/多机型 Chrome 重合成期间多出一帧空白），故逐条钉住。
  { name: '#938c 内联变量值变才写（删＝applySettings 每次点抽屉控件重写 :root 十六条＋#page-chat 若干条同值属性，全站样式重解析＝闪屏根因）', file: 'js/chat-settings.js', needle: "if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v);" },
  { name: '#938d 变量删除前先确认挂着（删＝applyChatBarInk 每次点控件对 #page-chat 空 removeProperty 两条，同值白写族）', file: 'js/chat-settings.js', needle: "if (el && el.style.getPropertyValue(name) !== '') el.style.removeProperty(name);" },
  { name: '#938e 壁纸类摘除前先确认挂着（删＝无壁纸设备每次点击两记空 classList.remove 脏化 #page-chat 整棵）', file: 'js/chat-settings.js', needle: "if (chatPage.classList.contains('cs-bg-fill')) chatPage.classList.remove('cs-bg-fill');" },
  { name: '#938f 发送按钮 display 值变才写（删＝每次点击重写 #chat-send 内联 display，栏位分区控件闪屏面）', file: 'js/chat-settings.js', needle: "if (sendBtn.style.display !== wantDisp) sendBtn.style.display = wantDisp;" },
  { name: '#938g 对比度修正层文本真变了才写（删＝每次点击重写 head 里 #cs-contrast-fix 整张样式表）', file: 'js/chat-settings.js', needle: "if (fix.textContent !== css) fix.textContent = css;" },
  { name: '#938h 设置项回显文本真变了才写（删＝每次点击为十几个回显标签各拆建一次文本子树）', file: 'js/chat-settings.js', needle: "if (el && el.textContent !== s) el.textContent = s;" },
  /* ==== 2026-09-20 #930 回前台贴底复核闸（Vivo Y35/摩托罗拉 G100 等 Android Edge 独立应用实报「打开聊天/回到应用，停在几分钟前的消息，看不到现在的消息」；与 #912/#874/#918/#919 同症状家族独立通道；纯时序判据零机型分支） ==== */
  { name: '#930a 回场贴底复核闸声明（删＝回前台/bfcache 恢复永不复核贴底，停在几分钟前的消息复发）', file: 'js/chat.js', needle: 'function chatResumeRepin() {' },
  { name: '#930b 长离场视同重新进聊天的复位（删＝离场前解钉的用户重开应用永远停在旧位置）', file: 'js/chat.js', needle: 'if (gone > CHAT_RESUME_FRESH_MS) {' },
  { name: '#930c 回场分派（删＝闸永不触发）', file: 'js/chat.js', needle: 'else chatResumeRepin();' },
// #945 「换了 Chrome 还是无法导出/下载 docx、显示被浏览器拦截」（红米 K70 实报）：追问弹窗「换一种方式」的换路在分享面板不可用的壳里只剩 data: 直下，而它写死 >2MB 直接放弃＝真实备份（几乎都 >2MB）必落「拦住了网页下载」死 toast，且 toast 承诺的「点【复制】」按钮从不存在＝用户彻底没辙（截图顶栏 X＋网址条＝内置小窗/壳，非 Chrome 本体，一并提供自救指引）。修法零机型分支：①data: 直下上限 2MB→30MB；②data: 失败后补一发 blob: a[download]（两条取数路径互补）；③全灭改弹求救弹窗（分辨内置小窗 vs 系统浏览器真身＋真【复制网址和设备信息】钮）。验证 tools/verify-docx-export.mjs E13 换锚 30MB。
{ name: '#945a data: 直下上限放宽（删＝换路对 >2MB 真实备份必失败，退回死 toast）', file: 'js/data-backup.js', needle: 'blob.size > 30 * 1024 * 1024' },
{ name: '#945b 求救弹窗收口（删＝全灭只剩死路 toast，用户没辙）', file: 'js/data-backup.js', needle: 'function saveAskHelp(blob, fname) {' },
{ name: '#945c 真【复制】钮（删＝toast 承诺的复制通道再次落空）', file: 'js/data-backup.js', needle: "exportBtn: { label: '复制网址和设备信息'" },
{ name: '#945d data: 失败后 blob: 补发（删＝能下 blob: 下不了 data: 的内核断路）', file: 'js/data-backup.js', needle: '已再触发一次下载' },
  /* ==== 2026-09-20 #943 iOS 热路径卡顿根治（iPhone 17 Pro Max/iOS 26.7 PWA 实报「桌面滑动/底部组件卡顿、设置页定格几秒」，perfcheck 前台冻结 45 次最慢 1381ms、桌面翻页平均 168ms/帧最慢 1145ms；判据全取实测帧耗时与数据量，零机型分支） ==== */
  // ==== 2026-09-20 #948 聊天里的图片变成长乱码（用户直派 OPPO K13x 自带浏览器实报＝HeyTapBrowser/Chrome115 内核，并明说「这个问题其他设备型号也有出现」⇒ 零机型分支，判据全取运行期字符串形态；诊断附件实证：929 条消息 chat-msgs 单键 4.1MB 而媒体池仅 64 条＝载荷大量以整段 base64 内联在 text 里）====
  //   根因不是内核解码，而是「内联 dataURL 载荷在文字通道里没有任何一处认识它」：判定全写成
  //   x.indexOf('data:image/') === 0 这类大小写敏感＋不容前导空白＋只认 image 的精确前缀，而载荷的
  //   实际形态由解码失败回退那条腿/相册与文件管理器给出的类型决定（data:application/octet-stream、
  //   大写 MIME、串首空白…）——判定漏过＝既不进媒体池也不升级成图片消息，一旦经 genChatStyleReply
  //   单卡形态 / parts 丢失 / normCell 重建 / 存量自愈未跑完 漏进 text，气泡就整屏铺 base64。
  //   修＝三层收口且全站只留一份判据：①chat.js 导出唯一口径（chatHasMediaPayload /
  //   chatIsImgSrcLike / chatIsDataAudioSrc / chatIsInlineDataSrc / chatIsDataImgLikeSrc）；
  //   ②消费者边界（单聊气泡、群聊气泡、收藏、桌面弹窗、引用、搜索、回放存根）一律按媒体渲染，
  //   或收成 [图片]/[语音]/[附件] 标注；③源头与存储（getPool 四守卫合一、genChatStyleReply 全形态
  //   拦截、normCell 不把载荷塞进文本段、池令牌化闸门同口径）＝新数据不再产生内联载荷，存量经
  //   mediaNormalizePass 换令牌后离开 4.1MB 大键。验证 tools/verify-inline-media-garble.mjs（#948 组，33 断言）。
  { name: '#948a 唯一判据认「内核会嗅探成图片」的无类型载荷（改回只认 image/* ＝octet-stream 载荷继续被当文字直出＝本次乱码主形态复发）', file: 'js/chat.js', needle: "return t !== 'audio' && t !== 'video';" },
  { name: '#948b genChatStyleReply 媒体全形态闸（单卡 sticker/image/voice 与整串载荷一律不返文字；删＝ta-ask 把整段 base64 当文字回应 raw 直传＝用户所见乱码的直接来路）', file: 'js/chat.js', needle: "const _isMediaRep = !!(rep && (rep.type === 'sticker'" },
  { name: '#948c 文字气泡遇内联载荷只出标注不铺正文（删掉该早退守卫＝无媒体消息也跑拆分、载荷整串直出）', file: 'js/chat.js', needle: "if (s.indexOf('@@m:') < 0 && !chatHasMediaPayload(s)) return escTxtBr(s);" },
  { name: '#948d normCell 不把媒体载荷重建进 k:text 段（删＝把乱码从 text 通道挪进 parts 文本通道，渲染照样整串直出）', file: 'js/chat.js', needle: '!chatIsMediaPayload(r.text) &&' },
  { name: '#948e 整条内联音频载荷走语音条（旧判定只认「名称|||」形态，裸 data:audio 直出 base64；改回精确前缀即失配）', file: 'js/chat.js', needle: 'chatIsDataAudioSrc(rec.text)' },
  { name: '#948f 媒体池闸门借用同一判据（禁第二份口径；退成只认 image/* 则无类型载荷继续整段内联在 4.1MB 大键里）', file: 'js/media-pool.js', needle: "return window.chatIsDataImgLikeSrc(s) ? 'image' : '';" },
  { name: '#948g 群聊落盘令牌化与单聊/池同口径（退成精确 image/* 判定＝群聊无类型图片载荷继续整段 base64 内联并当文字铺出）', file: 'js/group-chat.js', needle: 'const isImgPayload = window.chatIsDataImgLikeSrc || window.chatIsDataImgSrc;' },
  { name: '#948h 无 MIME 载荷（File.type 为空时 FileReader 的 "data:;base64,…"）按 base64 头魔数认图（删/改回只认显式 image/* ＝无 MIME 图重新被判成正文铺 base64＝本条乱码来路回流）', file: 'js/chat.js', needle: "if (DATA_NOMIME_RE.test(h)) return !!chatB64ImgMime(s);" },
  { name: '#948i 内联载荷判定收无 MIME 形态（删＝无 MIME 载荷被当正文；#948 把旧的 data: 前缀守卫收窄后它重新进文字池、被 TA 当文本发出）', file: 'js/chat.js', needle: "if (DATA_NOMIME_RE.test(h)) return true;" },
  { name: '#948j 行内文字助手拆分认无 MIME 载荷（删＝"data:;base64,…" 整串走 else 分支原样铺出＝乱码的无 MIME 来路）', file: 'js/chat.js', needle: "[Dd][Aa][Tt][Aa]:[a-zA-Z0-9.+-]*(?:" },
  { name: '#948k normCell 存量无 MIME 图片载荷就地补正 MIME（删＝WebKit 系对无类型 data: 不做图片嗅探＝无 MIME 历史图片照旧裂图/占位）', file: 'js/chat.js', needle: "const __nmFixed = chatFixNoMimeImg(r.text);" },
  { name: '#948l media-pool 本地兜底同口径收无 MIME（删＝本模块先于 chat.js 加载时无 MIME 载荷归类漂移，与判据层两份口径）', file: 'js/media-pool.js', needle: "if (NOMIME_RE.test(head)) return (window.chatB64ImgMime" },
  { name: '#943a 超限遗留 LS 聊天快照跳过整包 parse 合并（删＝每次发消息/退后台 2.7MB JSON.parse+全量合并重串化压回主线程）', file: 'js/chat.js', needle: "if (raw.length > LS_SNAP_LIMIT) { performLsSnapWrite(msgsNow, prefix); return; }" },
  { name: '#943b 表情包整包写防抖 600ms（删＝面板每次点按都同步串化 1.14MB+大 IDB put）', file: 'js/chat.js', needle: "myeSaveTimer = setTimeout(function () { myeSaveTimer = null; myEmojiSaveNow(); }, 600);" },
  { name: '#943b 离页当场补发防抖中的表情包写（删＝600ms 窗口内退出丢保存）', file: 'js/chat.js', needle: "if (myeSaveTimer) { clearTimeout(myeSaveTimer); myeSaveTimer = null; myEmojiSaveNow(); }" },
  { name: '#943c 写日志落盘防抖 200ms（删＝xyStore.set 每写一小键就整本日志 stringify+setItem）', file: 'js/idb.js', needle: "_wrjPersistT = setTimeout(wrjPersistFlush, 200);" },
  { name: '#943c 离页冲刷防抖中的日志落盘（删＝写完 200ms 内退出丢日志条目）', file: 'js/idb.js', needle: "if (document.visibilityState === 'hidden') { wrjMarkFlush(); wrjPersistFlush(); }" },
  { name: '#943d 桌面视觉重应用拆帧（删＝回到桌面一帧同步跑完七项含大 dataURL 重应用＝950ms 冻结）', file: 'js/personalize.js', needle: "const rest = [applyAllWidgetTexts, applyAllWidgetOpacities, renderDeskImages, syncBgUI];" },
  { name: '#943e 回桌面自动帧采样限频 5 分钟（删＝每次切回桌面开 30 帧 rAF 循环自我加压）', file: 'js/desktop-slider.js', needle: "if (now943 - (swSample.last || 0) < 300000) return;" },
// #946 「在红米 K80 真机验证闪屏修复」（用户直派；#938 的无头尺子搬不到用户手上那一台，主观「还在闪」无法量化）：新增 设置→工具 →「闪屏自测」（src/js/flash-check.js，只读探针）——点【开始】后去 聊天设置→美化→边看边调 按浮条提示点 4 下（第 2 下重复点同一档＝值没变的那一下），当场数「全站样式翻动几次（:root/#page-chat 的 style 变更，MutationObserver，任何写入方都逃不掉）＋同值白写几条（按 --msg-/--chat-/--typing-/--send-/--cs- 名族判定的 setProperty 同值重写／空 removeProperty／空摘 cs-* 类／cs-* 样式表拆建）＋rAF 真实帧间隔（最慢帧/>50ms 掉帧）」并出结论。钩子按实例挂在 documentElement.style/#page-chat.style 上（mobile-adapt 已在 :root 装过实例级包装，只钩原型会被遮蔽＝抓到 0 写入的假绿），【结束】原样还原、零残留；不写业务键（只存 xy-home-v2:flash-check-last 一份报告）。验证 tools/verify-flash-check.mjs。
{ name: '#946a 同值白写判定（删＝闪屏自测把「值没变的白写」漏计，真机数字永远 0＝哑探针）', file: 'js/flash-check.js', needle: 'if (getVal(s, name) === String(v)) mark(\'n\');' },
{ name: '#946b 空删变量判定（删＝removeProperty 打空不再计入报告，#938 那型根因回流测不出）', file: 'js/flash-check.js', needle: "if (VAR_NS.test(String(n)) && getVal(s, String(n)) === '') mark('dn');" },
{ name: '#946c 空摘 cs-* 类判定（删＝每次点击白摘九记类看不见，本批报障面失去唯一客观口径）', file: 'js/flash-check.js', needle: "if (c.indexOf('cs-') === 0 && !this.contains(c)) mark('cn');" },
{ name: '#946d cs-* 样式表拆建观察（删＝enforce/contrast 整层重解析不计入报告）', file: 'js/flash-check.js', needle: "if (nd.nodeName === 'STYLE' && String(nd.id || '').indexOf('cs-') === 0) mark('ss');" },
{ name: '#946e 设置页「闪屏自测」入口行在产物（删＝工具里找不到这一行，真机自测不可用）', file: 'index.html', needle: 'id="row-flash-check"' },
  { name: '#946f 以「用户的点击」分段（删＝修好后值没变那一下彻底零写入、不留记录，报告假称没采到＝探针不可用）', file: 'js/flash-check.js', needle: '_clicks.push({ t: t, in: hit });' },
  // ===== #966 闪屏自测「没有采到抽屉里的点击」（红米 K80 Chrome 实报）：抽屉与宿主都是一族，只认单聊那一套＝群聊「边看边调」的点按与写入全漏 =====
  { name: '#966a 抽屉按族识别（删＝群聊「边看边调」里的点按判成「不在抽屉里」，报告静默变「没采到」＝探针在群聊侧形同虚设）', file: 'js/flash-check.js', needle: "var DRAWERS = ['chat-beauty-drawer', 'gc-beauty-drawer'];" },
  { name: '#966b 宿主按族挂钩（删＝群聊写在 #page-group-chat 上的美化变量没人看，翻动/白写计数恒为 0＝哑探针）', file: 'js/flash-check.js', needle: "var HOSTS = ['page-chat', 'page-group-chat'];" },
  { name: '#966c 群聊页 style 变更计入翻动（删＝群聊抽屉的整页样式重解析不进报告）', file: 'js/flash-check.js', needle: "else if (w === 'page-group-chat') list[kk].o.flipGc++;" },
  { name: '#966d「没采到」拆成「没点」与「点错地方」（删＝两种情形同一句话，用户与开发者都无从下手）', file: 'js/flash-check.js', needle: 'else if (!_seenIn) lines.push(' },
  { name: '#966e 浮条改贴屏幕顶部（删＝浮条又落回底部抽屉覆盖区，用户在抽屉里既看不见也点不到【看结果】）', file: 'js/flash-check.js', needle: 'top:calc(6px + env(safe-area-inset-top,0px));z-index:88;' },
  { name: '#966f 群聊美化同值不重写守卫（删＝点同一个档仍重写 ~16 个变量＝#938 那型闪屏在群聊侧回流）', file: 'js/group-chat.js', needle: 'const gcSetVar = (el, name, value) =>' },
  { name: '#966g 群聊 time-style 类只摘挂着的那一个（删＝每点一次白摘 5 个不存在的 cs-time-* 类）', file: 'js/group-chat.js', needle: 'gcSetCls(page, wantTime, true);' },
  { name: '#949a 输入框保底 4em 可用宽（退回 min-width:0＝窄屏开语音+批量后输入框被按钮压成 0 宽无法输入）', file: 'css/chat-main.css', needle: 'min-width:4em' },
  { name: '#949b 输入栏图标按钮放开收缩并保 30px 下限（退回 flex-shrink:0＝按钮一像素不让，挤压全部由输入框吸收）', file: 'css/chat-main.css', needle: 'min-width:30px' },
  { name: '#949c 窄屏档输入栏间距收紧（删＝360px 级机型按钮收缩到下限后仍差一口气，发送键被顶出/输入框贴 0）', file: 'css/chat-main.css', needle: 'padding:12px 8px 12px 10px' },
  /* ==== 2026-09-21 #950 表情包大包 IDB 数组直存（用户实指「表情包库能超几十 MB」，既有 34.93MB/#172 实例；原保存链整包 JSON.stringify 压主线程＝包越大点按帧冻结越久，#943b 防抖只减次数不减单次重量）==== */
  { name: '#950a 大包按体积分流直存 IDB 数组（删＝几十 MB 包每次保存仍整包主线程序列化+读回再 parse）', file: 'js/chat.js', needle: "if (myeBytesEst() > MYE_DIRECT_LIMIT && window.idbSet) {" },
  { name: '#950b 防覆盖闸门读回类型感知（删＝数组形态的 hydrate 值被 JSON.parse 吞掉＝合并静默失败，盲写顶掉 IDB 全量）', file: 'js/chat.js', needle: "const full = typeof rawGate === 'string' ? JSON.parse(rawGate || 'null') : (rawGate || null);" },
  { name: '#950c 落盘确认重发与主写同形态（删＝退避重试链每轮都整包 stringify 一次，大包重试雪上加霜）', file: 'js/chat.js', needle: "const val = myeBytesEst() > MYE_DIRECT_LIMIT ? (myGroups || []) : myeSaveJson();" },
  { name: '#950d 大包数组内存驻留口（删＝memoryCache 拿不到最新数组＝跨桌面合并读到旧快照、删过的表情复活）', file: 'js/idb.js', needle: "window.idbMemoSet = function (key, value) {" },
  { name: '#950e IDB 写超时估算器支持嵌套数组（删＝30MB 表情包被估成几百字节＝超时不放大，慢设备误判挂起＋误触发退避重发）', file: 'js/idb.js', needle: "for (let i = 0; i < value.length; i++) est += est950(value[i], 0);" },
  { name: '#950f 启动回填大对象直驻（删＝30MB 数组在启动回填点整包 JSON.stringify＝主线程长任务从保存点挪到开屏）', file: 'js/idb.js', needle: 'bigBudgetUsed += nObj;' },
  // ===== #952 此间【去找TA】切桌面进聊天「正在加载聊天记录」反复出现/整窗清空重建/长时间卡顿根治（＝读库链×2 并发恶性循环；#695/#841 同症状家族收尾通道）=====
  { name: '#952a 同桌面读库链在飞去重闸（删＝contact-switched 预读与 enterChat 并发跑两条完整权威链：热片读+解析+合并+整窗重建全 ×2，主线程打满后 IDB 回调饿死→超时→重试恶性循环＝进度条反复挂起）', file: 'js/chat.js', needle: 'if (!forceIdb && _lmChainBusy === myPrefix && Date.now() < _lmChainBusyUntil) return;' },
  { name: '#952b 读库链成功收尾清在飞标记（删＝首个桌面加载后 12s 墙内其它 loadMsgs 全被吞）', file: 'js/chat.js', needle: '_lmChainBusy = null; // #952：本桌读库链成功收尾，放行后续 loadMsgs' },
  { name: '#952c 重试走 forceIdb 绕过去重（删＝读库真失败的 5s 重试被在飞闸吞掉＝真挂死）', file: 'js/chat.js', needle: 'try { loadMsgs(true); } catch (e) {} // #952：重试必须真读＝forceIdb 绕过读库链在飞去重闸' },
  // ===== #954 聊天热片会话缓存：第二次进同一桌面零 IDB 等待（切桌面回来/退出重进从真读 2MB×N 变内存直取；写侧同步回填＋死块随手清＋purge/restore 全作废＋forceIdb 绕过）=====
  { name: "#954a 热块读缓存命中（删＝每次进聊天都真读热块＝切桌面回来白等 2MB×N 反序列化）", file: "js/chat.js", needle: "if (!noCache) { const cv = chatHotCacheGet(fk); if (cv !== undefined) return cv; } // #954：热块缓存命中＝零 IDB 等待" },
  { name: "#954b blk-idx 读缓存命中（删＝索引每次真读，热块命中也被索引读串行拖住）", file: "js/chat.js", needle: "bidxP = Promise.resolve(ci954); } // #954：索引缓存命中" },
  { name: "#954c 全量重分块块写回填（删＝写后缓存留旧值＝发消息后切回来看到旧历史）", file: "js/chat.js", needle: "chatHotCacheSet(prefix + ':' + k, a); // #954w 块写成功即更新缓存＝下次读永远拿到刚写的" },
  { name: "#954d 尾部重写块写回填（删＝同上，聊天页编辑/归一化路径写后读旧）", file: "js/chat.js", needle: "chatHotCacheSet(prefix + ':' + k, a); // #954t 尾块写成功即更新缓存" },
  { name: "#954e 清空/导入整前缀作废（删＝清空历史后 blk-idx 缓存复活旧索引＝已删记录复活）", file: "js/chat.js", needle: "chatHotCacheDropPrefix(prefix); // #954：清空/导入＝热片缓存整前缀作废" },
  { name: "#954f 备份恢复全表作废（删＝恢复整库重写后缓存遮蔽新库＝导入的数据不显示）", file: "js/chat.js", needle: "chatHotCacheDropAll(); // #954：备份恢复整库重写＝热片缓存全作废（随后 forceIdb 直读重建）" },
  { name: "#954g 死块缓存随写清除逻辑（删＝重分块死块挤爆 LRU 把活热块逐出＝切回来又真读＝缓存白做）", file: "js/chat.js", needle: "if (!live[k.slice(prefix.length + 1)]) delete chatHotCache[k]; // #954：死块缓存随写清除" },
  { name: "#954h 全量重分块收尾清死块（删＝同上，chatBlkWriteFull 路径）", file: "js/chat.js", needle: "chatHotCacheSyncLive(prefix, blocks); // #954w 死块缓存随写清除" },
  // ===== #953 梦角自由造句句尾标点（用户实报「梦角自由造句没有使用标点符号」→ 直派「也可以修改或关闭」）：出句收口补句尾标点＋回复设置里开关/标点池 =====
  { name: '#953a 造句句尾标点收口（删＝出句无句尾标点复发，用户点名）', file: 'js/dream-free.js', needle: "const END_PUNCT_DEFAULT = ['。', '。', '。', '~', '！', '……'];" },
  { name: '#953b 句尾标点开关关闭即不补（删＝「关掉标点」失效，出句照补）', file: 'js/dream-free.js', needle: "if (c && Number(c['mjf-punct']) === 0) return null; // 关＝不补标点" },
  { name: '#953c 标点池原串随回复设置读出（删＝用户在设置里改的标点池不生效，只用内置池）', file: 'js/reply-settings.js', needle: "String(ls.get('reply-mjf-punct-pool') || '')" },
  { name: '#953d 标点池按目标桌面读出（删＝跨桌面回复用错桌面的池/回默认）', file: 'js/reply-settings.js', needle: "String((s || ls).get('reply-mjf-punct-pool') || '')" },
  { name: '#953e 标点开关与池输入框锚点（删＝设置里改不了标点／关不掉）', file: 'index.html', needle: 'id="mjf-punct-pool"' },
  { name: '#953f 标点开关进 DEFAULTS（删＝开关初值恒显关、存盘不落该键）', file: 'js/reply-settings.js', needle: "'mjf-punct': 1," },
  // ==== 2026-09-21 #972 聊天发消息后消息气泡/头像消失、时间分隔线整摞堆在列表头部（OPPO Find X9 Edge 实报，用户点名多机型同现） ====
  { name: '#972a 批量头像缓存每轮全新（删＝作废轮泄漏的旧快照被后续所有轮次永久复用＝新消息头像错值/灰占位、刷新才恢复）', file: 'js/chat.js', needle: 'if (on) avatarBatchCache = {};' },
  { name: '#972b 作废轮释放自己那份头像缓存（删＝finishSwap/buildChunk 早退分支再次留下残留缓存）', file: 'js/chat.js', needle: 'const myAvBatch = avatarBatchCache;' },
  { name: '#972c 时间分隔线写进当前批量目标（删＝分隔线全摞在列表头部、时间轴错位、列表几何全错）', file: 'js/chat.js', needle: '(appendTarget || body).appendChild(d);' },
  { name: '#972d 裁剪/钳位按其后消息归属看待分隔线（删＝被保留消息头上的那枚分隔线被一并削掉）', file: 'js/chat.js', needle: 'function nodeKeepIdx(f) {' },
  { name: '#921h 开屏看门狗模块缺失自愈（删＝外置模块拉取失败后页面停在死包上无任何自救——通知/音效设置等 59 件功能全灭且更新条同为死件，nova13 实纸）', file: 'index.html', needle: 'mochi-boot-heal' },
  { name: 'desk-freq-mode 误迁自愈（default 副本写回根键，存量一次性找回；#231 并入 full-beauty-schemes；#527 起 beauty-undo-stack 已自本清单移出；#937 换锚＝回收列表追加 fhub-freq/fhub-seen 后旧行尾形态失配，改取列表头）', file: 'js/contacts.js', needle: "['pomo-cfg', 'pomo-today', 'pomo-total'" },
  { name: '#209 输入栏下方灰底断截面·焦点保留硬证据自愈（安卓返回键收键盘不派 blur/#197 族 focusout 丢失时 !foc 复原分支永不执行=停靠残留卡死；可视区双信号回满 ≤12px 即复原，焦点在不在都算键盘已收（#916 换锚：原 needle「if (_hNow <= 0 || _hNow < _aH - 12) return;」随稳态高度对账重构改为同语义守卫正形态，逻辑只强不弱）', file: 'js/mobile-adapt.js', needle: 'if (_hNow > 0 && _hNow >= _aH - 12 && (window.innerHeight || 0) >= _aIH - 12) {' },
  { name: '#805a 清除本地数据落在「通用」段且为该段末项（搬回「工具」/「关于」段＝用户报的「分类太靠后、不知道有这个功能」复发；锚在段闭合注释上，行被搬走时锚同步消失）', file: 'template.html', needle: '</div><!-- /them-sec basic · row-reset -->' },
  // ==== 2026-09-20 #927 全屏模式提到设置页「通用」段首位独立成组 + 聊天设置功能页顶部常显（用户直派） ====
  { name: '#927a 设置页全屏行改为通用段首位独立组（.set-row 形态专用 id；搬回系统段 gs-row＝用户要的「最前面一个独立显的地方」回流，行下设备限制小字由 verify-settings-tags S8/B11 判）', file: 'template.html', needle: 'id="sf-fullscreen-row"' },
  { name: '#927b 聊天设置功能页顶部全屏分组在位（该行原埋在二级标签「显示」里，用户点名「保留开关、提到顶部」；分组 id 消失＝搬回埋藏态）', file: 'template.html', needle: 'id="cs-fs-group"' },
  { name: '#927c 聊天设置顶部全屏分组不得重新挂 data-tag（挂上＝被 #cs-func-tags 过滤埋回「显示」标签里，用户报的「找不到全屏开关」复发）', file: 'template.html', needle: '<div class="set-group glass" id="cs-fs-group" data-tag', absent: true },
  { name: '#927d iOS 全屏开关文案改走通用段专用标题 span（行搬到通用段首位变成 .set-row＋#sf-fullscreen-label，relabel 仍按旧 .gs-row/span span 取＝要么找不到、要么把「功能说明」标签一起覆盖掉）', file: 'js/fullscreen.js', needle: "row.querySelector('#sf-fullscreen-label')" },
  // ==== 2026-09-15 #526 新建联系人首次进聊天不再显示「正在加载聊天记录…」（空桌面白等 2.5s 空库二次复核） ====
  { name: '#906c 报告点名后台保活（删＝掉帧惯犯之一在采样报告里隐身，用户不知道先关保活对照）', file: 'js/perf-check.js', needle: '关掉再对照测一轮' },    { name: '#906d 报告「再测一次」闭环（删＝对照复测要重进设置点行，低电量/保活关掉后的前后对照成本高）', file: 'js/personalize.js', needle: "ctlR.okText('再测一次')" },    { name: '#889b 群聊抽屉栏位位置滑杆提示（删＝群聊版同款知情提示回流）', file: 'js/group-chat.js', needle: '拖着就能把栏位上下挪位' },
  /* ==== 2026-09-20 #907 iOS17PM 实报「设置页不动也每 1.7 秒卡一次、最长 3.42 秒」（300s 自检：平均 13.3fps/掉帧96%/前台冻结175次；iOS 无 longtask 观测故「长任务:无」不可信）＝①新增冻结归因探针 window.__mochiPhase（device.js 环形相位记录；大键写IDB/小键写日志/聊天落盘/表情包落盘四类重活入口打标记），卡顿自检在 >250ms 前台冻结时回查冻结起点前最近标记并在报告「冻结前序操作（取证）」行点名——把「谁在堵主线程」从猜变成证据；②启动清扫 LS 大键残留（设备诊断自报「LS 残留大键」=历史副本双倍计算+占 5MB 配额；大键新值只进 IDB 故 LS 副本必为旧值，按 __big-idx 索引清扫安全）==== */    { name: '#907a 冻结归因探针 API（删＝iOS 前台冻结重回「无 longtask/无归因」的黑盒猜测）', file: 'js/device.js', needle: "window.__mochiPhase = function (tag)" },    { name: '#907b 冻结前序操作报告行（删＝探针白记，报告不点名）', file: 'js/perf-check.js', needle: '冻结前序操作（取证）' },    { name: '#907c 重活入口相位标记（大键写 IDB；删＝冻结归因断链）', file: 'js/idb.js', needle: "window.__mochiPhase('idb-big:'" },    { name: '#907d LS 大键残留启动清扫（删＝历史大键副本永久残留，诊断告警与配额占用回流）', file: 'js/idb.js', needle: 'LS 大键残留清扫' },    { name: '#907e 聊天落盘相位标记（删＝1628 条/2.9MB 级落盘在冻结归因里隐身）', file: 'js/chat.js', needle: "window.__mochiPhase('persist(chat)')" },    /* ==== 2026-09-20 #906 聊天底部半框「点半框外关闭」缺网补齐（用户直报【帮我决定】【群聊决定】点屏幕其他地方关不掉；零机型分支，判据全取时序/DOM） ==== */
  /* ==== 2026-09-21 #908 用户直派「2 分钟档要在打开功能时就标红提醒——太短没用」：卡顿自检入口弹窗开 warn+staticEmph 警示形态（红描边/红标题/红底，同 #900b 机制），首行红字「⚠ 时长太短没用！」，默认档由 30 秒改 2 分钟 ==== */
  { name: '#908a 入口标红警告「时长太短没用」＋默认 2 分钟（删＝用户又拿 10/30 秒档测不出卡、白测一轮）', file: 'js/personalize.js', needle: '时长太短没用' },
  /* ==== 2026-09-21 #960 卡顿归因覆盖面扩容＋诊断数字升级为建议（用户「还有什么可以优化的」续）：①相位探针从 4 点扩到 9 点（新增 xd-poll 跨桌面轮询 / ka-tick 保活轻心跳 / fish-tick 摸鱼定时 / chat-renderWindow 整窗重建），下一份报告能一眼看出周期重活里谁在堵；②诊断【保活现场】后台终止 ≥5 次时给三条可行动建议（关保活/清最大一项/少开标签）==== */
  { name: '#960a 探针覆盖扩容（跨桌面轮询/保活心跳/摸鱼定时/聊天整窗重建；删＝冻结归因漏掉周期重活嫌疑面）', file: 'js/chat.js', needle: "window.__mochiPhase('chat-renderWindow')" },
  { name: '#960b 后台终止≥5 次给可行动建议（删＝内存压力反复回收只留一个数字，用户不知道怎么办）', file: 'js/device.js', needle: '本页被系统回收过' },
  { name: '#960c 小键写日志预算真实生效（值+键+结构一并计入、上限 64KB/24 条；删＝「128KB 预算」又产出 180KB+ 包，每次小键写入整包同步写 LS 的成本回流）', file: 'js/idb.js', needle: '_wrj[i].v.length + _wrj[i].k.length + 24' },
  /* ==== 2026-09-21 #960 续（iPhone 17PM 首份带取证行的真机报告驱动）：冻结归因加「距冻结起点时间差」——首次报告 ka-tick ×47/53 但保活 5s 拍天然最频繁＝存在『最后一条标记』偏置，只有差值≤150ms 才算真凶；同批给 ka-tick 细分 ka-ms（媒体会话写）＋去掉每 5s 无条件重写同一 playbackState 的重复 IPC ==== */
   { name: '#960d 冻结归因带时间差与判读（删＝高频标记天然霸榜，归因失真回到猜）', file: 'js/perf-check.js', needle: '距冻结起点中位' },
   { name: '#960e 媒体会话去重复写（删＝每 5s 无条件重写同一 playbackState，iOS 上纯重复 IPC）', file: 'js/bg-keep.js', needle: "navigator.mediaSession.playbackState !== 'playing'" },
  /* ==== 2026-09-21 #961 用户直派「iOS 要明确提醒用户发生了什么（被系统回收 43 次），直接检测并给解决方法」：①通用会话存活标记 __sess-alive（不依赖保活/通知开关；pagehide 记正常收尾、visibilitychange 记后台中，启动判定「上次非正常收尾且很近」＝回收一次，rolling diedAt 保留 10 条）——旧实现只在开着保活时靠心跳察觉，没开保活的用户永远得不到解释；②回收提醒升级：不再要求开关、讲人话（内存不够→iOS 关页面→白屏/重载、不是网站坏了不丢数据）＋两条具体方法；回收频繁（近两天≥3 或累计≥10）时升级为顶部警告条（可点，跳设置→工具→查看存储）24h 冷却，平时 12h 一次 toast；③卡顿报告独立成行点名回收次数与两条方法（与是否掉帧无关）==== */ 
  { name: '#961a 通用存活标记与启动判定（删＝不开保活的机型回收后永远得不到解释）', file: 'js/bg-keep.js', needle: 'sessBootCheck(); // #961' }, 
  { name: '#961b 回收提醒升级：不讲门控＋给方法（删＝回到只有开关开着才提示、且无操作方法）', file: 'js/bg-keep.js', needle: '手机内存不够时 iOS 会这样做' }, 
  { name: '#961c 高频回收顶部警告条（删＝43 次级设备只留一条 12h 冷却 toast）', file: 'js/bg-keep.js', needle: 'mem-warn-bar' }, 
  { name: '#961d 报告独立点名回收次数与方法（删＝白屏实锤在卡顿报告里隐身）', file: 'js/perf-check.js', needle: '本页已被系统回收过' }, 
 
  /* ==== #934/#941 哨兵回补（本会话恢复 build.mjs 时发现它们也随旧缓冲回写事故丢失；从各自提交 0c6d0c0 / 625cea2 原样取回）==== */
  { name: '#906a 半框点外关闭分派器声明（删＝九枚同族底半框回到只能点 ✕，用户「点屏幕其他地方无法关闭」回流）', file: 'js/chat.js', needle: 'window.mochiSheetOutsideClose = function (panel, close) {' },
  { name: '#906b 占卜/问问TA/聊天记录/猜拳/红包五枚同批接线（删＝这批同族缺口重新漏网，只剩两枚报障面板有效）', file: 'js/chat.js', needle: "['chat-search', () => closeChatSearch()]," },
  { name: '#906c 帮我决定点外关闭接线（用户报障本体，删＝该面板点外面关不掉回流）', file: 'js/decision.js', needle: 'window.mochiSheetOutsideClose(panel, closePanel);' },
  { name: '#906d 多人决定点外关闭接线（用户报障本体，且其添加/删除成员走 openModal＝依赖 .modal-mask 豁免那条判据）', file: 'js/group-decision.js', needle: 'window.mochiSheetOutsideClose(panel, () => { panel.hidden = true; });' },
  { name: '#906e 送礼半框点外关闭接线（同族核查缺口）', file: 'js/gift-shop.js', needle: "window.mochiSheetOutsideClose(document.getElementById('chat-gift-panel'), closeGiftPanel);" },
  { name: '#906f 头像互动半框点外关闭接线（同族核查缺口）', file: 'js/avatar-lib.js', needle: "window.mochiSheetOutsideClose(document.getElementById('avlib-card'), closeAvlib);" },
  /* ==== 2026-09-20 #913 手机发烫收口（用户直派「发烫问题要优化+提示怎么改善」）：①切后台全局暂停 CSS 动画总闸（后台保活用户挂后台/锁屏过夜＝无限动画合成照跑的纯浪费热源，与 #436 后台减负同哲学）②工具段补「发烫」人话排查条（保活/边充边用/省电模式/多标签/数据堆积） ==== */
  { name: '#921a 补发队列统一 flush（改回逐条 if (timer) return 单发闸＝SW 未就绪等待窗里第 2 条起整条静默吞掉复发）', file: 'js/bg-keep.js', needle: 'const q = swLaterQueue; swLaterQueue = [];' },
  { name: '#921b 就绪与 60s 到点幂等闸（删掉＝ready 与定时器双重 flush 把同批通知重发两遍）', file: 'js/bg-keep.js', needle: 'function swLaterFlush(reg) {' },
  { name: '#921c 通道异常恢复条出条逻辑（删掉＝SW 未就绪丢通知后用户毫无感知，只能干等下一次复发）', file: 'js/bg-keep.js', needle: 'function tryShowNotifyHealBar() {' },
  { name: '#921d 恢复条模板锚（删掉＝bg-keep.js getElementById 恒 null，恢复条永不出现）', file: 'template.html', needle: 'id="notify-heal-bar"' },
  { name: '#921e toast 隐藏单时间轴·JS 只兜底（改回 dur||2000 早掐＝动画 88% 驻留点前中途取消，安卓多机型黑胶囊闪屏复发）', file: 'js/bg-keep.js', needle: '(dur || 2600) + 250' },
  /* ==== 2026-09-20 #921f/g 丢弃唤醒重载「保活/通知自动关闭」收口（OPPO Reno14 Edge 诊断实纸：保活现场全绿但历史取证 died=13＝页面被反复丢弃重载；「挂后台半小时自动刷新」＝Edge 睡眠标签页默认 30 分钟丢弃，浏览器行为代码拦不住，要治的是重载后开关被误关） ==== */
  { name: '#921f 开关 change 用户手势闸（删＝睡眠标签页丢弃唤醒重载的伪 change 把开关写 0＋user-off 锁死＝「重进自动关闭」复发）', file: 'js/bg-keep.js', needle: 'function kaUserGesture(e) {' },
  { name: '#921g（#1014 收口）启动恢复不得再拿权限读数改写存储——旧写法回流即「一次失真读数又把授权用户的开关永久关掉」复发', file: 'js/bg-keep.js', needle: "notifyEnabled = saved === '1' && 'Notification' in window", absent: true },
  { name: '#907a 面板 hidden 态 keep-alive（改回 display:none＝隐藏期位图被整批回收，重开全部重新解码＝每次打开都闪一下重新加载复发）', file: 'css/chat-main.css', needle: '#emoji-panel[hidden], #avlib-card[hidden]' },
  { name: '#907b 表情面板空闲预热调度（删＝进桌面后不再提前加载，首开仍要现场解码＋等解码才显示）', file: 'js/chat.js', needle: 'if (!chatPanelPrewarmOn()) return;' },
  { name: '#907c 头像互动空闲预热入口（删＝头像库首开前位图从未就绪，点开半框闪一下重载复发）', file: 'js/avatar-lib.js', needle: 'window.mochiPrewarmAvlib = function ()' },
  { name: '#907d 「打开面板前提前加载图片」设置行（删＝用户失去提前加载开关，无法选择省电模式）', file: 'js/chat-settings.js', needle: 'cs-chat-panel-prewarm-row' },
  { name: '#907e chat-panel-prewarm 全局根键 EXCLUDE 登记（删＝被 migrateLegacy 迁进 default 桌面并删根键＝开关刷新后丢）', file: 'js/contacts.js', needle: `'chat-panel-prewarm',` },
  /* ==== 2026-09-20 #915 联系人互动卡/心愿「后台没有弹窗」根治（用户直派方案 A：真后台积压回前台补发；零机型分支） ==== */
  { name: '#915a bgNotifyCheck visible 分支 late 直通（改回无条件 markSeen+return＝迟到补弹被自己刚记的账吞掉，本批报障复发）', file: 'js/bg-keep.js', needle: "if (document.visibilityState === 'visible') { if (!extra.late) { markSeen(nkey); return; } }" },
  { name: '#915b 回前台记录本次后台时长（删＝bgLateCatchup 无判据，补弹闸门形同虚设）', file: 'js/bg-keep.js', needle: '_fgFromHiddenFor = lastHiddenAt > 0 ? now - lastHiddenAt : 0;' },
  { name: '#915c 互动卡迟到判定外抛给查岗卡共用（删＝ck-question 侧断链）', file: 'js/ta-ask.js', needle: 'window.interactLateNotify = _lateNotify;' },
  { name: '#915d 查岗卡通知打 late 标（删＝查岗卡回前台补弹回流）', file: 'js/ck-question.js', needle: 'late: !!(window.interactLateNotify && window.interactLateNotify())' },
  { name: '#915e 心愿卡迟到补发系统通知（删＝心愿后台无弹窗复发）', file: 'js/gift-shop.js', needle: "window.bgNotifyCheck(wishText, Date.now(), { name: partnerName() + '的心愿', late: true });" },
  /* ==== 2026-09-20 #916 顶部白条/显示不全+聊天闪动（Edge 工具条显隐 dvh 滞留族）根治 + 屏幕适配错误环红点只增不减收口 ==== */
  { name: '#917a 判定器读本机手调轴（删＝用户亲手调的值又被当布局缺陷每 5s 刷错误环，本批报障复发）', file: 'js/device.js', needle: 'inp.adj = (function () {' },
  { name: '#917b 整体位移轴折算进底部期望（删＝手调位移后必报「底部超出/少填」假错误回流）', file: 'js/device.js', needle: 'const expB = expBase + adjShift;' },
  { name: '#917c 页面高度轴跳过底部贴合判定（删＝手调高度后「少填/超出」假错误回流）', file: 'js/device.js', needle: "'底部·已手动微调 h='" },
  { name: '#917d 底部导航栏期望同口径折算（删＝手调位移后「导航栏被裁」假错误回流）', file: 'js/device.js', needle: 'const expTB = expBase - (inp.envBottom || 0) + adjShift;' },
  { name: '#917e 手调轴串进快照/错误环（删＝下份报障又分不清手调与真故障，只能反推）', file: 'js/device.js', needle: 'function sdAdjStr(a) {' },
  { name: '#917f 外置功能包首拉失败聚合（删＝弱网一次波动十几条塞满错误环、顶掉真错误）', file: 'js/device.js', needle: 'function extFailNote(name) {' },
  { name: '#917g 浏览器自报离线期网络失败不记（删＝断网期 version.json 轮询刷「网络失败」噪音）', file: 'js/device.js', needle: 'if (!status && navigator.onLine === false) return;' },
  { name: '#917h 切后台断二次确认配对（删＝回前台拿后台前坏签名直接入环，过期快照进环）', file: 'js/device.js', needle: 'function sdPendBreak() {' },
  /* ==== 2026-09-20 #919 进聊天「跳到历史记录、看不到最新消息、退出重进才恢复」第二条独立通道根治
     （HUAWEI Mate 40 Pro + Edge 实报，多机型同现；零机型分支）：msgs 出现空洞记录（undefined/null）时
     renderWindow 两条循环直接 renderMsg(msgs[i]) 未设防 → TypeError 打断整轮构建 → frag 永不换装＝
     body 恒空/停旧记录、进度条卡死（上翻/回钉/看门狗全被闸死）；真机错误栈 buildChunk→renderMsg
     「reading 'side'」实锤。修法＝两条循环先判记录有效性、坏记录跳过不画，其余照常走完换装落底。 ==== */
  { name: '#920a 激活腿统一实现存在（删＝全站入口回退「label 转发＋裸 click」两腿，小米系合成 click 被吞＝整族无反应复发）', file: 'js/device.js', needle: 'window.mochiFilePickFire = function (input, opts) {' },
  { name: '#920b showPicker 腿在 click 前顺序补发（删/改成「成功即 return」＝不可观测内核上 legacy 腿被短路）', file: 'js/device.js', needle: 'try { input.showPicker(); fired = true; } catch (e) {}' },
  { name: '#920c mochiFilePick 统一入口激活改走三腿（删＝45 处调用（含壁纸/头像/图标/封面/备份）JS 兜底退回裸 click＝整族复发）', file: 'js/device.js', needle: 'window.mochiFilePickFire(input, { onFail: function () { if (o.onError) { try { o.onError(); } catch (x) {} } } });' },
  { name: '#920d 聊天插图手写兜底改走三腿（删＝聊天图片入口回退裸 click，国产内核复发「点了没反应」）', file: 'js/chat.js', needle: "window.mochiFilePickFire(chatImgPickBridge(), { onFail: () => toast('无法打开图片选择器，请重试') });" },
  { name: '#920e 桌面头像手写兜底改走三腿（删＝换头像入口回退裸 click 复发）', file: 'js/personalize.js', needle: "window.mochiFilePickFire(avatarPickInput, { onFail: () => { avatarPickCb = null; toast('无法打开相册，请重试'); } });" },
  { name: '#928 音乐进度计时器曲尾空指针（checkAutoEnd 曲尾会同步拆掉 audio 置空，定时器回调须重判；删＝每次定时器先于 ended 事件抓到曲尾都抛 reading duration，华为 nova12 活力版 Edge 诊断 20 条实录）', file: 'js/music-player.js', needle: 'if (!audio || !audio.duration) return;\nif (audio.currentTime > 0) clearStallGuard();' },
  /* ==== 2026-09-20 #924 保活隐藏期音频焦点让位 + 关闭彻底化（iPhone 16 Plus Safari 实报「开着保活刷视频总被截停／后台保活关不掉」；#901 同族残余；WebKit 能力分支，安卓 Chromium 三个补播口子零改动） ==== */
  { name: '#924a 隐藏期让位判定存在（删＝被外部 App 抢走焦点后仍退避回抢 play()，刷视频截停复发）', file: 'js/bg-keep.js', needle: 'function kaYieldStealFocus()' },
  { name: '#924b 心跳补播口子让位闸（删＝隐藏期漏网场景排补播回抢复发）', file: 'js/bg-keep.js', needle: 'if (!kaTimer && !kaYieldStealFocus()) kaSchedule();' },
  { name: '#924c 停用保活不再 src=空串（删＝空 src 按相对路径把页面文档当媒体加载，关闭不彻底复发）', file: 'js/bg-keep.js', needle: "keepAudio.el.removeAttribute('src')" },
  { name: '#924d 停用保活媒体会话先落 paused（删＝iOS 媒体条滞留正在播放＝看似关不掉复发）', file: 'js/bg-keep.js', needle: "navigator.mediaSession.playbackState = 'paused'" },
  { name: '#924e iPhone 开通知如实告知能力边界（删＝用户继续拿「必弹」预期对 iOS 反复报失效）', file: 'js/bg-keep.js', needle: 'iPhone 提示：受系统限制' },
  /* ==== 2026-09-20 #926 系统预设字卡「整组停用/启用」（用户直派：默认聊天字卡与词典只有关闭单独字卡、缺少关闭某个分组；零机型分支）——存 <桌面>:dc-groups-off = { 分类: [分组名] }，生效收在 apiFor(st).isOff 这一个消费端总闸（单卡闸 OR 分组闸），聊天/群聊/写信/朋友圈/日历/词典拼字/梦角造句/各功能同源池全部自动跟上；分组开关只叠一层，组内 dc-off-* 单卡存值一字不改。UI 在共用工厂 mountCardView（四页：默认聊天字卡/功能字卡/词典/查岗），容器打 .preset-list 限定样式。验证 tools/verify-dc-group-off.mjs 绿 23/23、纯 HEAD 红 13 条全落缺陷面。 ==== */
  { name: '#929a 关于页防清数据四条警示条在位（删＝用户再问「怎么减少数据被清」，#914 缓解面回流）', file: 'template.html', needle: '<div class="set-alert" id="about-storage-reduce">' },
  { name: '#929b 开屏「建议添加到主屏幕」提示行在位（删＝iOS 浏览器内用户继续裸奔在最高清数据风险档，本批报障复发）', file: 'template.html', needle: 'id="splash-ios-pwa-tip"' },
  /* ==== 2026-09-20 #932 字卡状态自检纳入「整组停用」（#926 的 dc-groups-off）：此前本页只按 dc-off-* 逐张统计＝整组停用清空分类时自检报「未发现明显问题」、一键修复也不接管 ==== */
  // #937 功能探索提醒（fhub-seen 埋点 + 「还没试过」横幅/角标 + contacts 全局键登记与存量找回）
  { name: '#937a fhub 统计键全局根键登记（漏登记＝migrateLegacy 每次刷新把 fhub-freq/fhub-seen 迁进 default 并删根键，跨桌面常用行/到达标记全丢）', file: 'js/contacts.js', needle: "'fhub-freq', 'fhub-seen'];" },
  { name: '#937b fhub-freq 存量误迁副本写回根键（删＝修复前滞留在 default 的点击计数找不回，「常用」行白丢）', file: 'js/contacts.js', needle: "'full-beauty-schemes', 'fhub-freq', 'fhub-seen'].forEach" },
  { name: '#937c 条目到达埋点总开关（删＝fhub-seen 不再记录，「还没试过」名单永远全量、横幅成摆设）', file: 'js/feature-hub.js', needle: "const SEEN_KEY = 'xy-home-v2:fhub-seen';" },
  { name: '#937d 「还没试过」横幅渲染（删＝首页提醒面消失）', file: 'js/feature-hub.js', needle: "'还没试过：' + n" },
  { name: '#937e 横幅样式规则在位（删＝横幅退化成裸文本行无底色无圆角）', file: 'js/feature-hub.js', needle: '.fhub-seen-bar{display:flex;align-items:center;gap:10px;' },
  // #938 边看边调「切换气泡框大小会闪屏」根治＝applySettings 全局 DOM 翻动归零（红米 K80 Chrome 用户直派、多机型同现；零机型分支）
// #939 「网络不佳·点此重试」条永挂（部分手机刷新无效）——三条锚点（#939c 口径扣除随 #921h 在途批收口，不在本批提交面）：
{ name: '#939a 包装 catch 登记错误清单（删＝运行期抛错文件被算成网络缺失，重试条永挂+每2h白重载；锚内联件 device.js 那份）', file: 'index.html', needle: 'if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("device.js")' },
// #936 牌面图鉴「批量上传按文件名自动识别」认不出阿拉伯数字牌名（宝剑1 之类全落进「没识别到对应牌」）——根因＝牌库小阿卡纳 40 张名字是中文数字（宝剑王牌·宝剑二…宝剑十），匹配器只有「文件名＝牌名／含牌名子串」两路。修法＝匹配前折算全角数字与补零、收集候选时把牌名展开数字别名（王牌→A/1/0、结尾中文数字→1..10），并给数字结尾的别名加「粘连数字」守卫（不存在的宝剑11 不得读成宝剑1）。零机型分支，验证 tools/verify-divination-face-filename.mjs。
{ name: '#936a 候选收集按牌名展开数字别名（删＝宝剑1/圣杯A 这类写法重新全部落不进候选）', file: 'js/divination.js', needle: 'varifyName(c.name).forEach(v => {' },
{ name: '#936b 数字别名的子串匹配要求「数字写法写全」（删＝宝剑11/圣杯11 被认成宝剑王牌，用户的废图盖掉真牌面）', file: 'js/divination.js', needle: 'if (!/[0-9０-９]$/.test(v)) return s.indexOf(v) >= 0;' },
{ name: '#936c 粘连数字守卫逐个落点判定（删＝#936b 的判据形同虚设，多落点里只看第一处）', file: 'js/divination.js', needle: 'if (!DIGIT.test(s.charAt(i + v.length))) return true;' },
{ name: '#936d 补零写法折算（删＝宝剑01 不认；整串归零会误把 宝剑100/权杖00 折成有效牌）', file: 'js/divination.js', needle: "s = s.replace(/(\\D)0+([1-9])/, '$1$2');" },
{ name: '#936e 全角数字先折算半角（删＝输入法写出的 宝剑１／１２ 仍不认，\d 不匹配全角）', file: 'js/divination.js', needle: 's = s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48));' },
{ name: '#936f 批量上传说明文案列出数字牌名写法（删＝用户不知道可以这么命名，功能等于没有）', file: 'js/divination.js', needle: '· 数字牌名：<b>宝剑1.png</b>' },
// #942 「刷新很多次也停在旧版」收口＝index 更新通道弱网 30s 超时即放弃：实测 ~30KB/s 网络（GitHub Pages 国内，vivo/小米现场）传完 1.4~4MB 需 50~130s，install 预缓存/activate 补拉/PRECACHE_NOW（「刷新使用新版」落盘）/导航后台刷新四条通道全部在 30s 处超时失败＝新版永远落不了缓存，点了刷新按钮也重载回旧缓存。修法＝fetchIndexRes 助手在超时/失败后补一发不带超时的 fetch 慢慢传完（SW 内部 fetch 不再被本 SW 拦截＝无死循环，#143 无缓存兜底已验证同形态），成功体照旧过调用方已有的 isCompleteHtml 完整性校验才落缓存；快路径零变化。验证 tools/verify-sw-slow-update.mjs。
// #942 「刷新很多次也停在旧版」收口＝index 更新通道弱网 30s 超时即放弃：实测 ~30KB/s 网络（GitHub Pages 国内，vivo/小米现场）传完 1.4~4MB 需 50~130s，install 预缓存/activate 补拉/PRECACHE_NOW（「刷新使用新版」落盘）/导航后台刷新四条通道全部在 30s 处超时失败＝新版永远落不了缓存，点了刷新按钮也重载回旧缓存。修法＝fetchIndexRes 助手在超时/失败后补一发不带超时的 fetch 慢慢传完（SW 内部 fetch 不再被本 SW 拦截＝无死循环，#143 无缓存兜底已验证同形态），成功体照旧过调用方已有的 isCompleteHtml 完整性校验才落缓存；快路径零变化。验证 tools/verify-sw-slow-update.mjs。
{ name: '#942a 慢路径助手定义（删＝四条通道回到 30s 即放弃，弱网永远刷不上新版）', file: 'pwa/sw.js', needle: 'function fetchIndexRes(url, ms) {' },
{ name: '#942b 超时后补发不带超时的重试（删＝助手形同虚设，仍然 30s 放弃）', file: 'pwa/sw.js', needle: 'return fetchWithTimeout(url, ms).catch(() => fetch(url));' },
{ name: '#942c install 预缓存 index 走慢路径（删＝首装弱网新缓存常年缺 index）', file: 'pwa/sw.js', needle: 'fetchIndexRes(url, isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)' },
{ name: '#942d PRECACHE_NOW「刷新使用新版」落盘走慢路径（删＝用户点了刷新按钮也拿不到新版）', file: 'pwa/sw.js', needle: 'fetchIndexRes(u, isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)' },
{ name: '#942e 导航后台静默刷新走慢路径（删＝秒开缓存的同时后台永远换不上新 index）', file: 'pwa/sw.js', needle: 'fetchIndexRes(req, INDEX_NETWORK_TIMEOUT)' },
{ name: '#942f activate 补拉走慢路径（删＝新 SW 激活后当前缓存仍缺 index、导航回退退回旧缓存）', file: 'pwa/sw.js', needle: "fetchIndexRes('./index.html', INDEX_NETWORK_TIMEOUT)" },
// #944 「正在下载新版」全程反馈＋失败如实告知（用户直派「碰到了还是没有进入新版需要用户〔提示〕，不然用户永远停到旧版，以为新版又有bug」）：#942 让 SW 弱网慢慢传完后，PRECACHE_DONE 可能一两分钟后才来——旧 refreshNow 却在 2.5s 无条件重载（总在下载完成前把用户重载回旧缓存）且点击即写「本版本已确认」ack＋弹条即记 notify＝下载失败后本版本永不再提醒＝静默卡旧版、用户以为新版有 bug。修法＝手动通道①点击即出进度（按钮「正在下载…」＋条文案写明弱网可能要一两分钟）；②删 2.5s 假重载、等 PRECACHE_DONE（上限 180s），超时如实告知「新版没下载完」＋按钮变「重试刷新」＋回滚 notify 记录让本版本之后能再次提醒；③ack 挪到下载确认成功后才写。自动通道保持 #273 时代 2.5s 静默行为。验证 tools/verify-sw-slow-update.mjs（P 组）。
// #944 「正在下载新版」全程反馈＋失败如实告知（用户直派「碰到了还是没有进入新版需要用户〔提示〕，不然用户永远停到旧版，以为新版又有bug」）：#942 让 SW 弱网慢慢传完后，PRECACHE_DONE 可能一两分钟后才来——旧 refreshNow 却在 2.5s 无条件重载（总在下载完成前把用户重载回旧缓存）且点击即写「本版本已确认」ack＋弹条即记 notify＝下载失败后本版本永不再提醒＝静默卡旧版、用户以为新版有 bug。修法＝手动通道①点击即出进度（按钮「正在下载…」＋条文案写明弱网可能要一两分钟）；②删 2.5s 假重载、等 PRECACHE_DONE（上限 180s），超时如实告知「新版没下载完」＋按钮变「重试刷新」＋回滚 notify 记录让本版本之后能再次提醒；③ack 挪到下载确认成功后才写。自动通道保持 #273 时代 2.5s 静默行为。验证 tools/verify-sw-slow-update.mjs（P 组）。
{ name: '#944a 进度文案（删＝点了没反应，用户以为新版有 bug）', file: 'js/pwa.js', needle: "setUi('正在下载新版…网络慢时可能需要一两分钟，请保持页面打开', '正在下载…');" },
{ name: '#944b 失败如实告知＋可重试（删＝超时后无声无息停在旧版）', file: 'js/pwa.js', needle: "setUi('新版没下载完（网络太慢）。已取消本次刷新，网络好转后会再次提醒；也可点「重试刷新」再试', '重试刷新');" },
{ name: '#944c ack 挪到下载确认成功后（删＝下载失败也写「已确认」，本版本从此不再提醒）', file: 'js/pwa.js', needle: 'if (!auto && ackTs > 0) verMarkAck(ackTs);' },
{ name: '#944d 失败回滚 notify 记录（删＝verSeen 把本版本记成已提醒，静默卡旧版）', file: 'js/pwa.js', needle: "localStorage.removeItem('xy-home-v2:ver-update-notify');" },
{ name: '#944e 手动点击传入版本 ts（删＝成功路径拿不到 ackTs，ack 永不写＝每次刷新都重弹）', file: 'js/pwa.js', needle: 'refreshNow(false, 0, onlineTs)' },
{ name: '#944f 手动等待上限常量（删＝回到 2.5s 假重载，总在下载完成前落回旧缓存）', file: 'js/pwa.js', needle: 'const VER_DL_WAIT = 180000;' },
// #945 「换了 Chrome 还是无法导出/下载 docx、显示被浏览器拦截」（红米 K70 实报）：追问弹窗「换一种方式」的换路在分享面板不可用的壳里只剩 data: 直下，而它写死 >2MB 直接放弃＝真实备份（几乎都 >2MB）必落「拦住了网页下载」死 toast，且 toast 承诺的「点【复制】」按钮从不存在＝用户彻底没辙（截图顶栏 X＋网址条＝内置小窗/壳，非 Chrome 本体，一并提供自救指引）。修法零机型分支：①data: 直下上限 2MB→30MB；②data: 失败后补一发 blob: a[download]（两条取数路径互补）；③全灭改弹求救弹窗（分辨内置小窗 vs 系统浏览器真身＋真【复制网址和设备信息】钮）。验证 tools/verify-docx-export.mjs E13 换锚 30MB。
  // ===== #951 切换桌面联系人后进聊天仍闪一下（＝#893 症状家族新通道；权威预读已落定却把整窗重建留到点开那一瞬）=====
  { name: '#951b 预渲就绪闸只认本命名空间权威（删＝用 chatDbReady 判就绪，15 秒保险丝假就绪时按有损快照预渲＝闪屏从点开那一瞬挪到看不见的时候，且丢「等真权威」语义）', file: 'js/chat.js', needle: 'if (!(chatDbReady && authLoadedPrefix === prefix)) return; // #951b' },
  { name: '#951c 预渲去重闸（删＝屏上已是本桌面且未作废仍反复整窗重建；含 batchRendering 闸，缺＝构建中途插一整窗＝空窗叠空窗）', file: 'js/chat.js', needle: 'if (batchRendering || (windowRenderedPrefix === prefix && !windowStale)) return; // #951c' },
  { name: '#951d 隐藏态整窗预渲落地（删＝预渲函数空转，切桌面后进聊天仍走 clear→逐块重建＝闪屏复发）', file: 'js/chat.js', needle: 'renderWindow(false, true); // #951d' },
  { name: '#951e 权威读库成功即调度预渲（删＝只有点开聊天那一下才重画＝本批症状）', file: 'js/chat.js', needle: 'try { scheduleChatPrewarm(myPrefix); } catch (e) {} // #951e' },
  { name: '#951f 后台归一化作废屏上凭据后在隐藏态补做预渲（删＝作废只在用户点开那一瞬兑现成整窗重建）', file: 'js/chat.js', needle: 'scheduleChatPrewarm(myPre); } catch (e) {} // #951f' },
  { name: '#951g 确认空库同样调度预渲（删＝新桌面为空时屏上残留上个桌面的气泡，直到点开聊天才清）', file: 'js/chat.js', needle: 'try { scheduleChatPrewarm(myPrefix); } catch (e) {} // #951g' },
  { name: '#951h 分帧构建在飞时同窗补丁让路（删＝预渲正把列表清空逐块重建的那一瞬，enterChat 判定「同窗同貌」直接返回＝把半截/空屏交给用户，闪屏换个面孔复发）', file: 'js/chat.js', needle: 'if (batchRendering) return false; // #951h' },
  // ===== #952 此间【去找TA】切桌面进聊天「正在加载聊天记录」反复出现/整窗清空重建/长时间卡顿根治（＝读库链×2 并发恶性循环；#695/#841 同症状家族收尾通道）=====
,  // ==== 2026-09-21 #962 屏幕适配微调「只能在设置里盲调」根治（用户直派「现在只能在这个设置里面调、不能在桌面的页面调，需要区分在桌面页面调和在聊天页面里调，现在是盲调什么也看不见」；#940 从未入库，本批一并收口）====
{ name: '#940a 面板半透明底＋40vh（删回不透明 62vh＝用户报「挡住看不见」复发；z-index:96 使本 needle 与桌面抽屉那行区分、personalize.js 内唯一）', file: 'js/personalize.js', needle: 'z-index:96;max-height:40vh;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);' },
{ name: '#940b 拖标题行/grip 纵向拖动（删回 grip 纯装饰＝不能拖动复发；#760 pointer capture 口径；#962 起拖动上限 60%→70% 视口高）', file: 'js/personalize.js', needle: "adjBottom = Math.max(0, Math.min(Math.round(window.innerHeight * 0.7), Math.round(sb + sy - e.clientY)));" },
{ name: '#940c 拖回自动位吸附复位（删＝拖动后停半空不回位，且自动让位判定丢失）', file: 'js/personalize.js', needle: 'if (adjBottom != null && adjBottom <= bottomReserve() + 6) adjBottom = null;' },
{ name: '#940d 收起折叠正文区（删＝无法收起切页看现场，「不能预览其他页面」复发；#962 起收起＝整块变胶囊）', file: 'js/personalize.js', needle: "if (elBody) elBody.style.display = adjMini ? 'none' : 'flex';" },
{ name: '#962a 底部导航留白（删＝面板/胶囊又贴底盖住切页入口＝用户报「盲调什么也看不见」复发）', file: 'js/personalize.js', needle: "if (t && t.height && t.top > 0) gap = Math.max(gap, Math.round(window.innerHeight - t.top + 8));" },
{ name: '#962b 聊天输入栏留白（删＝聊天页开面板就把输入栏整条盖住，说不了话）', file: 'js/personalize.js', needle: "if (r && r.height) return Math.max(gap, Math.round(window.innerHeight - r.top + 8));" },
{ name: '#962c 面板默认落在留白之上（删＝落位回贴底，底部操作区又被盖）', file: 'js/personalize.js', needle: 'function applyAdjPos() { if (panel) panel.style.bottom = (adjBottom == null ? bottomReserve() : adjBottom) + \'px\'; }' },
{ name: '#962d 收起＝小胶囊（删＝收起态仍横贯底边 70px 高、照样挡住底部导航）', file: 'js/personalize.js', needle: 'function setMini(on) {' },
{ name: '#962e 胶囊点一下展开（删＝收起后再也回不到滑杆）', file: 'js/personalize.js', needle: 'if (tapToOpen && !moved) { setMini(false); return; }' },
{ name: '#962f 「看桌面 / 看聊天」直达（删＝只能靠自己找路切页，现场调回流）', file: 'js/personalize.js', needle: 'pb.addEventListener(\'click\', function () { goPage(pair[0]); });' },
{ name: '#962g 「正在调：桌面/聊天」页面名（删＝又分不清在给哪一页调）', file: 'js/personalize.js', needle: "ctx.textContent = '正在调：' + nm;" },
{ name: '#962h 聊天页入口按钮（删＝聊天里没入口，只剩设置一条路）', file: 'template.html', needle: 'id="more-screen-adj"' },
{ name: '#962i 桌面页入口按钮（删＝桌面上没入口，只剩设置一条路）', file: 'template.html', needle: 'id="decor-fit"' },
{ name: '#962j 聊天入口接线（删＝按钮点了没反应）', file: 'js/personalize.js', needle: "const chatEntry = document.getElementById('more-screen-adj');" },
{ name: '#962k 桌面入口接线（删＝装修栏按钮点了没反应）', file: 'js/personalize.js', needle: "const decorEntry = document.getElementById('decor-fit');" },

  // ==== 2026-09-21 #961 用户直派「默认聊天字卡和默认聊天字卡·词典数量太多，帮忙标红提醒放在字卡库顶部；字卡数量太多，不适用时建议关闭词典；这个在解锁二级密码的时候也需要弹窗说明提醒用户」——①字卡库顶部标红提醒条（默认聊天字卡页 #dc-size-hint、词典页 #dict-size-hint，复用 #390 词典锁定条红色视觉）②二级验证解锁成功弹窗同一份文案 ====
  { name: '#961a 体量提醒文案唯一来源（card-lock.js window.mochiPresetSizeTip；字卡库红条与解锁弹窗共用，删则两处同时空白）', file: 'js/card-lock.js', needle: "window.mochiPresetSizeTip = '字卡太多不用全开" },
  { name: '#961b 字卡库顶部红条填充两个容器（默认聊天字卡页 + 词典页；删则字卡库顶部不再有标红提醒）', file: 'js/default-cards.js', needle: "['dc-size-hint', 'dict-size-hint'].forEach" },
  { name: '#961c 解锁成功弹窗（clock.js promptCardUnlock 成功后先弹体量提醒再刷新；删则解锁时无说明弹窗）', file: 'js/clock.js', needle: "window.openModal('解锁成功 · 字卡使用提醒'" },
  { name: '#961d 刷新闸门＝落库确认 + 提醒关闭两件都完成（改回无条件 reload 则提醒被刷新吞掉＝用户看不到）', file: 'js/clock.js', needle: 'if (reloaded || !persisted || !noticeClosed) return;' },
  { name: '#961e 红条容器锚点（template → index.html；删任一则该页顶部提醒条无处落）', file: 'index.html', needle: 'id="dc-size-hint"' },
  { name: '#961f 红条视觉（setting.css 与 #390 词典锁定条共用红色样式；删则提醒条退回无色正文）', file: 'css/setting.css', needle: '.dict-lock-hint, .dc-size-hint { margin:8px 12px 0;' },
  { name: '#961g 解锁提醒被顶掉/超时的刷新兜底（弹层遮罩重新隐藏＋15s 上限；删则提醒被别的弹层替换后用户永远等不到刷新、界面停在「看着还锁着」）', file: 'js/clock.js', needle: 'moNotice = new MutationObserver' },
  // ===== #959 iPhone 12 Pro / iOS Safari（未添加到主屏幕）「总是丢数据」＝WebKit ITP 连续 7 个 Safari 使用日无互动即清空该源全部可写存储；标签页里 persist() 几乎不授予，唯一豁免是「添加到主屏幕」（主屏应用独立存储桶、不计入 7 天计时）。本批＝每日备份提醒里点名该高危场景＋「先导出再安装再导入」分步引导＋持久化首次手势补申请＋关于段 iOS 专属提醒条。零机型分支：Android/桌面文案与流程不变 =====
  { name: '#959a iOS 标签页高危判定（删＝备份弹窗不再点名 Safari 7 天清空，最高风险场景用户继续裸奔）', file: 'js/pwa.js', needle: 'window.mochiIosTabRisk = function () {' },
  { name: '#959b 持久化首次手势补申请（删＝冷启动被拒后本会话再没机会申请，Safari/Chromium 更难获批持久化）', file: 'js/pwa.js', needle: "['touchend', 'pointerup', 'click', 'keydown'].forEach(function (t) {" },
  { name: '#959c 备份弹窗 iOS 标签页分支（删＝每日提醒回到通用文案，不为「Safari 标签页」这一最高风险档点名对策）', file: 'js/pwa.js', needle: '你现在是用 Safari 打开的（没添加到主屏幕）' },
  { name: '#959d 装到桌面分步引导写清「先导出再安装、主屏与 Safari 存储分开需导入」（删＝用户装到主屏看到空数据，误以为又丢一次数据）', file: 'js/pwa.js', needle: '主屏幕应用和 Safari 是两套独立存储，不先导出' },
  { name: '#959e iOS 安装提示点明 7 天清空风险（删＝退回只讲「怎么装」不讲「为什么必须装」）', file: 'template.html', needle: 'Safari 标签页 7 天不用会被系统清空数据' },
  { name: '#959f 关于段 iPhone/iPad 7 天规则提醒条（用户直派「写在关于里提醒 iOS 用户」；删＝关于页 iOS 提醒消失）', file: 'template.html', needle: 'id="about-ios-pwa-note"' },
  { name: '#959g 关于段 iOS 提醒条只对 iOS 显示（删＝安卓用户也常驻读到 iPhone 专属提醒；非 iOS 隐藏、JS 未跑保留）', file: 'js/pwa.js', needle: "document.getElementById('about-ios-pwa-note')" },
  { name: '#956a 拼卡取池闸门＝多字卡回复总开关 && 拼接随机标点（删/退回只看 py-punct-en＝关掉多字卡回复后词典拼字单气泡等形态仍按标点池拼卡，用户实报「还是能触发多字卡回复」）', file: 'js/chat.js', needle: "const pyJoinOn = !!(c && c['py-en'] === 1 && c['py-punct-en'] === 1);" },
  { name: '#956b 设置页置灰上游闸门 pyMasterOn（删＝关掉多字卡回复后拼接随机标点行仍显亮，与真实生效状态不符）', file: 'js/reply-settings.js', needle: "const pyMasterOn = cfg['py-en'] === 1;" },
  { name: '#956c 自定义符号 chip 同时按「总开关 && 本行开关」置灰（删＝自定义符号漏灰）', file: 'js/reply-settings.js', needle: "const dis = !(dcfg['py-en'] === 1 && dcfg['py-punct-en'] === 1);" },
  { name: '#956d 拼接随机标点行关闭即置灰（删＝行显亮无提示）', file: 'js/reply-settings.js', needle: "rowPunct.style.opacity = (pyMasterOn && cfg['py-punct-en'] === 1) ? '' : '.45';" },
  { name: '#956e 上游总开关变更即重同步本组置灰态（删＝点了多字卡回复开关后置灰态不跟手）', file: 'js/reply-settings.js', needle: "const pyEnEl = document.getElementById('py-en');" },
  { name: '#956f 设置页说明补「关闭多字卡回复后本组一并失效」（删＝用户仍按旧口径理解从属关系）', file: 'index.html', needle: '关闭上方「多字卡回复」后本组一并失效' },
  { name: '#956g 拼接符号池行随上游总开关置灰（删＝符号池行显亮，与 chips 灰态不一致）', file: 'js/reply-settings.js', needle: "rowChips.style.opacity = pyMasterOn ? '' : '.45';" },
  { name: '#983a 聊天眼前送礼不再弹黑色浮层（删/改回无条件＝在聊天里送礼物、点心愿卡【送 TA】后又叠一层与卡片重复的黑条，用户 2026-09-21 直派删除）', file: 'js/gift-shop.js', needle: "if (!chatOnScreen()) toast('已送出');" },
  { name: '#983b 「已送出」浮层不得退回无条件弹（市集/心意柜页面上聊天页被 openPage 隐藏、看不到礼物卡，那里必须保留回执）', file: 'js/gift-shop.js', absent: true, needle: "closeTc(); toast('已送出');" },
  // ===== #984 恋爱纪念日「点击设置日期无反应」（iPhone X / iOS16.7 / 夸克实报，同族机型同现）=====
  // 原实现＝透明的原生 date 控件铺满 pointer-events:none 的假按钮：按钮无点击处理器，点按生效与否、
  // 取回的日期字符串形态全看内核（date 回落 text 的内核给的是无连字符串，落库即脏值）。改站内月历弹层。
  { name: '#984a 按钮自己接点击并打开站内月历弹层（删＝退回「点按钮没反应」，功能大全链式点击也一并死）', file: 'js/personalize.js', needle: 'if (dateBtn) dateBtn.addEventListener(\'click\', openLoveDateModal);' },
  { name: '#984b 日期字符串严格校验（删＝脏值/非法日期直接落库，界面出现「undefined 月」破相文案）', file: 'js/personalize.js', needle: "if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';" },
  { name: '#984c 月历「确定」经 setLoveStart 单一写入口落库（删/改直写＝校验被绕过，脏值又能进存储）', file: 'js/personalize.js', needle: "if (!setLoveStart(mdSel)) { toast('日期没选上，请再点一次'); return; }" },
  { name: '#984d 恋爱纪念日弹层接共用月历导航（删＝弹层里换不了年月，选几年前的纪念日做不到）', file: 'js/personalize.js', needle: 'memCalNavBind(memDateMask, mdYM, renderMemDateCal);' },
  { name: '#984e 纪念日按钮＝真的弹层触发器（改回无 aria-haspopup 的假按钮形态＝回归信号）', file: 'template.html', needle: '<button type="button" class="mem-date-btn" id="love-date-btn" aria-haspopup="dialog">' },
  { name: '#984f 删除型：透明原生 date 覆盖控件不得回流（回来＝点按又交给内核转发，本族「点了没反应」复发）', file: 'template.html', needle: 'id="love-date-input"', absent: true },
  { name: '#984g 删除型：覆盖式原生控件 CSS 不得回流（回来＝按钮区又被透明控件盖住，假按钮再次接不到点击）', file: 'css/chat-pages.css', needle: '#love-date-input.mem-date', absent: true },
  // ===== #988「后台通知」开关点第一下被拦回去、点第二下才开（红米 K80 Chrome 实报，用户明说其他型号也有）=====
  { name: '#988a 手势闸以「近期真实输入」为主判据（删/改回只认 userActivation 读数＝内核读数异常时真点按又被吃掉，主诉复发）', file: 'js/bg-keep.js', needle: 'if (Date.now() - kaInputAt <= 1200) return true;' },
  { name: '#988b 待决(default) 路径按用户意图保持开关并收口（删＝又变成「requestPermission 一 resolve 非 granted 就回弹」＝点一次被拦、点第二次才开）', file: 'js/bg-keep.js', needle: 'nbSettleStart(my, false);' },
  { name: '#988c 权限结果分「还没决定 / 被拒绝」（删＝pending 又被当成拒绝处理）', file: 'js/bg-keep.js', needle: "fail('pending')" },
  { name: '#988d 删除型：旧「未获得通知权限」回弹提示不得回流（回来＝待决又被当失败，主诉复发）', file: 'js/bg-keep.js', absent: true, needle: "toast('未获得通知权限，后台消息无法弹窗')" },

  // ===== #987 聊天统计「申请心意币记录 / 小游戏记录」默认折叠（用户直派「没有折叠导致页面会变得很长很长，
  //   而且没有默认折叠起来」）——两个区块是全量流水、行数随使用无上限累计，默认全展把 tab 拉得很长。
  //   开关态收在模块级 map（进统计页重设 innerHTML，DOM 上的折叠态活不过一次渲染）；小游戏区块改走同一渲染件。 =====
  { name: '#993a 流水区块默认折叠（改回展开/删＝进统计页又是几十上百行铺开，用户实报的「页面很长很长」回流）', file: 'js/p2-features.js', needle: 'const statsFoldOpen = { askcoin: false, games: false };' },
  { name: '#993b 折叠态真的把流水藏起来（删/改选择器＝头还是开关但列表照常铺开，点了看起来没反应）', file: 'css/chat-pages.css', needle: '.stats-fold:not(.open) > .stats-fold-body { display:none; }' },
  { name: '#993c 小游戏记录复用同一折叠渲染件（删/改回手抄列表＝两个流水区块各写一份，折叠只生效一半）', file: 'js/p2-features.js', needle: "return statsFoldSection('🎮', '小游戏记录', '条', uniq," },
  { name: '#987d 删除型：小游戏记录不得再手写自己的区块头（回流＝又一份独立实现，折叠逻辑漏掉它）', file: 'js/p2-features.js', absent: true, needle: "'<span class=\"stats-sec-count\">' + uniq.length + ' 条</span>" },
  { name: '#993e 删除型：旧的「全量直铺」流水渲染件不得回流（回来＝申请心意币记录又默认铺满整屏）', file: 'js/p2-features.js', absent: true, needle: 'function coinRecordSection(' },
  { name: '#987f 功能页「打开来电弹窗」行说明含通话中行为（删＝用户不知道通话中点它是展开面板，又以为点了没反应）', file: 'template.html', needle: '通话中点击＝展开通话面板' },
  { name: '#985a 心意柜真礼物（side:in）带 claimed:0＝待领取（删＝收下的礼物不再有待领取状态，用户选定的「数据不丢＋状态仪式」塌一半）', file: 'js/gift-shop.js', needle: "if (side === 'in') e.claimed = 0;" },
  { name: '#985b 送出的礼物卡先落心意柜记录并互指（删＝卡片与心意柜脱钩，卡片上的领取态/回复无处存）', file: 'js/gift-shop.js', needle: "const entry = recordBox(gift, side, wish);" },
  { name: '#985c 卡片状态从心意柜记录读（删＝卡片回头去聊天记录里找领取态/回复，而聊天大包表达不了「老记录字段变了」，回复会自己消失）', file: 'js/gift-shop.js', needle: 'window.giftGiftMeta = function (boxId) {' },
  { name: '#985d 记忆化映射的 0/1/null 迁移口径（删/改回 falsy 判定＝存量礼物全被翻成待领取）', file: 'js/gift-shop.js', needle: 'claimed: it.claimed === 0 ? 0 : (it.claimed === 1 ? 1 : null)' },
  { name: '#985e TA 收礼后的回话同时贴到卡片与心意柜（删＝用户报障原样回流：这个回复没有加到联系人领取礼物的卡片里/心意柜的卡片里）', file: 'js/gift-shop.js', needle: "window.chatGiftAttachReplyTo(cid, chatRec.ts, 'ta', txt, chatRec)" },
  { name: '#985f 心意柜待领取口径＝只认显式 claimed===0（删/放宽＝心意柜把存量礼物也标成待领取）', file: 'js/gift-shop.js', needle: "function boxPending(it) { return !!(it && it.side === 'in' && it.claimed === 0); }" },
  { name: '#985g 回复输入框预填礼物原本文案并切出新增段（删/改回整段当回复＝聊天里把礼物原文也当我的消息发出去，用户口径「聊天只显示追加回复」被破坏）', file: 'js/chat.js', needle: "const added = (orig && full.indexOf(orig) === 0) ? full.slice(orig.length).trim() : full;" },
  { name: '#985h 聊天里只发新增的那句（删＝原文与回复两条都进聊天）', file: 'js/chat.js', needle: "addOut(added);" },
  { name: '#985i 卡片动作区只对真·联系人送我的礼物且必须有心意柜指针（删/放宽＝TA 自己买的礼物卡与存量卡也长出【领取】【回复】，而后者的状态无处可写）', file: 'js/chat.js', needle: "function giftIsIncoming(rec) { return !!(rec && rec.side === 'in' && !rec.giftSelf && rec.giftBoxId); }" },
  /* ==== 2026-09-21 #989 桌面页竖向滚动护栏（红米 K80 Chrome 浏览器模式实报「桌面的第一页和第二页的图标按钮和文字没有完全对齐，第二页和第三页完全对齐」，追报「第三页也没有对齐了」＝错位换页出现）＝桌面页内容 636px 在浏览器模式桌面区（~610px）下溢出 26px，而溢出全是不可见尾垫（最深实心盒下沿 604）⇒ 每页都成了可竖滚容器：斜滑翻页被内核轴锁判成竖向，滚动量落在起手那一页且无人复位 ⇒ 该页图标+文字整块上移几像素与另两页错开；旧验证全跑 390×844（桌面区 714>636，根本不可滚）⇒ 结构性看不见。护栏＝溢出全在不可见区就裁掉并归零滚动量，真溢出保持可滚 ==== */
  { name: '#989a 判据：最深实心盒下沿仍在可视区内才算「翻下去什么也看不到」（删＝护栏不再裁不可见溢出，残留滚动量又留在页上；#1013 起该判据以未滚动内容坐标为基准）', file: 'js/desktop-slider.js', needle: 'inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop) <= sl.clientHeight + 1' },
  { name: '#989b 落刀：该页设 overflow-y:hidden 并归零滚动量（删＝页面仍是可竖滚容器，斜滑又能顶出滚动量）', file: 'js/desktop-slider.js', needle: "if (sl.style.overflowY !== 'hidden') sl.style.overflowY = 'hidden';" },
  { name: '#989c 防修过头：真溢出回落 auto（删＝用户往页里加满组件的页再也滚不到底部内容）', file: 'js/desktop-slider.js', needle: "if (sl.style.overflowY) sl.style.overflowY = '';" },
  { name: '#989d 滚动落定后复核（删＝斜滑留下的滚动量没人复位，错位永久留在那一页）', file: 'js/desktop-slider.js', needle: "pages.addEventListener('scroll', () => pageScrollGuard.later(300), true);" },
  { name: '#989e 整页不可见时不得下判断（删＝开屏期 inkBottom 恒 0 被误判成「什么也看不到」，真溢出被裁掉）', file: 'js/desktop-slider.js', needle: "if (!sl.clientHeight || getComputedStyle(sl).visibility === 'hidden') { skipped = true; continue; }" },
  { name: '#989f 回桌面当帧复核（删＝进桌面时残留错位仍在，用户一眼就看到没对齐）', file: 'js/desktop-slider.js', needle: 'pageScrollGuard.later(60);' },
  { name: '#1013a 判据基准＝未滚动内容坐标（删 − scrollTop＝真溢出页滚到底被误判成「看不到东西」而弹回顶部＝用户报「桌面滑动会回拉，无法滑到下面」）', file: 'js/desktop-slider.js', needle: 'getBoundingClientRect().top - sl.scrollTop) <= sl.clientHeight + 1' },
  { name: '#1013b 异步载荷到位后复核一次（删＝桌面图片组件解码前那一拍被误裁，之后没人再复核＝有内容在下方却永远滚不动）', file: 'js/desktop-slider.js', needle: "pages.addEventListener('load', () => pageScrollGuard.later(400), true);" },
  /* ==== 2026-09-21 #994 听歌邀请「同意后没小框也没播放」第二次实报（红米 K80 Chrome PWA；接受链路静默死亡出口再收口） ==== */
  { name: '#994a 邀请面板唯一实现（渲染+接线成对；删＝又出现「只渲染没接线」的死面板＝点了同意零反应）', file: 'js/music-player.js', needle: 'function openMusicInvitePanel(trackId, switching) {' },
  { name: '#994b 诊断邀请入口改走同一面板实现（删＝「诊断邀请→强制触发一次」又是死按钮）', file: 'js/music-player.js', needle: 'openMusicInvitePanel(track.id, false)' },
  { name: '#994c 聊天邀请走同一面板实现（删＝回到手抄面板，接线必漏）', file: 'js/music-player.js', needle: 'openMusicInvitePanel(track.id, !!currentId)' },
  { name: '#994d 起播校验「连 audio 都没建起来」不再静默（删＝本地歌异步读未回/读失败时无框无声无提示复发）', file: 'js/music-player.js', needle: 'inviteCheckStage === 0' },
  { name: '#994e 本地歌邀请弹窗期预热音频（删＝冷启动接受邀请要等异步 IDB 读，慢/失败即无框无声）', file: 'js/music-player.js', needle: 'function prewarmLocalAudio(id) {' },
  { name: '#994f 小框恢复位置按视口钳制（删＝保存位置在视口外时小框「没出现」复发）', file: 'js/music-player.js', needle: 'if (floatClampSig === sig) return;' },
  { name: '#994g 跨桌面失效如实提示（删＝点了同意零反馈复发）', file: 'js/music-player.js', needle: 'function inviteStaleToast(name) {' },
  { name: '#994h 邀请到同意之间歌曲被删如实告知（删＝playTrack findTrack 静默 return，用户对着空气等）', file: 'js/music-player.js', needle: '已不在音乐库里，无法播放' },
  { name: '#994i 起播校验不得退回「拿不到 currentId/audio 即静默返回」（absent 型；回流＝点了同意又变零反馈）', file: 'js/music-player.js', needle: 'if (!currentId || !audio) return; // 曲目加载失败等路径已有各自的 toast', absent: true },
/* ==== 2026-09-22 #1011 表情包面板/头像互动「每次打开图片都会闪烁和重新加载」残留根因（红米 K80 Chrome 实报、用户明说其他设备型号也有；用户原话「这个问题一直没有解决」）——#457/#508/#509/#662/#692/#704/#716/#907 八轮的判据是「img 节点有没有被重建」「已解码位图有没有被回收」，而真机上那一拍其实是 **面板在图片还没就绪时就显示了**：旧等待只对「此刻已经有 src 的图」逐个 await decode()，首开/整页重载后这一拍一张 src 都没有（懒加载补 src 要等 IO 回调、池令牌解析要读 IDB）⇒ jobs 为空、等待当场放行；面板随后才逐张走「令牌当相对 URL 请求→404→池读 IDB→重写 src→解码」（无头 390×844 实测：可见当帧 24 张首屏里 8 张 src 还是 @@m: 令牌、仅 16 张就绪，可见之后仍有 21 次 load＋7 次 404 error）。修法＝等待判据换成「首屏每张图都拿到真载荷且解码完成」（首屏令牌当场交池批量解析＋非令牌当场补 src＋未就绪等自己的 load），另加 CSS：令牌态那一格先不画（避免 404 裂图/alt 文案的第二次视觉变化）。零机型分支、零新状态 ==== */
  { name: '#1011a 表情面板首屏判定（改回「有 src 就 await decode」＝首拍等待为空、面板未就绪就显示，闪一下再逐张加载复发）', file: 'js/chat.js', needle: 'function emojiPanelFirstScreen() {' },
  { name: '#1011b 首屏令牌当场交池解析（删＝等 250ms 整组班次，首屏先裂图后上图）', file: 'js/chat.js', needle: 'if (toks.length && window.mochiMediaWarmTokens)' },
  { name: '#1011c 单图就绪判据＝真载荷＋已解码（改回只 await decode＝令牌 src 的 decode 必失败、等待形同虚设）', file: 'js/chat.js', needle: "if (srcNow().indexOf('@@m:') !== 0) { done = true; off(); res(false); return; }" },
  { name: '#1011d 等待期不显示到首屏就绪（删＝面板先弹出来、图后到）', file: 'js/chat.js', needle: 'emojiKickFirstScreen(first);' },
  { name: '#1011e 头像半框首屏补载荷（删＝首开这一拍图只有 data-src、等待为空＝闪一下再逐格冒出复发）', file: 'js/avatar-lib.js', needle: 'const first = avKickFirstScreen(grid);' },
  { name: '#1011f 头像半框就绪判据（同表情侧，avatar 独立一支）', file: 'js/avatar-lib.js', needle: 'function avImgReady(im) {' },
  { name: '#1011g 令牌态格子不画（删＝404 裂图/alt 文案闪一下再换真图，慢机兜底放行时同样可见）', file: 'css/chat-main.css', needle: '#emoji-list img[src^="@@m:"]' },
/* ==== 2026-09-22 #1012 字卡库「长按拖动字卡无法调整顺序」根治（用户实报；公用字卡/专属字卡
   两库同一条代码路径，零机型分支）——根因两条：①【拖不动】长按 350ms 本来就抓起成功，但
   .card-list 可纵向滚动，手指一移动浏览器就把这次触摸判成「滚动列表」并当场派发 pointercancel，
   文档级 onUp 立刻摘掉克隆、落点为空＝顺序一张不变（桌面鼠标没有这个手势，故一直正常）；
   ②【拖了不留】写守卫的营救合并只并集卡片、顺序一律取权威库，权威库尚未进内存时
   （大库被启动回填挂起 ⇒ ccAuthSeen 整会话不解除）每次拖动都被整段还原。
   修法＝①拖拽存续期按住 touchmove＋可拖分类卡片行不长按选字（长按期间系统选字手势会接管
   这次触摸，同一条 pointercancel 路径）；②并集之后把内存侧相对顺序回填到「两边都有的位置」
   上，权威独有卡原地不动（#193 防覆盖语义不变）。 ==== */
  { name: '#1012a 拖拽期 touchmove 守卫挂载（删＝手机端首次移动即被判成滚动、pointercancel 打断拖拽，顺序调不动复发）', file: 'js/chatcard.js', needle: "document.addEventListener('touchmove', stopPan, { passive: false });" },
  { name: '#1012b 松手/取消时摘掉守卫（删＝拖过一次之后列表再也滚不动）', file: 'js/chatcard.js', needle: "document.removeEventListener('touchmove', stopPan);" },
  { name: '#1012c 守卫行为本体（改成空函数＝监听还在但拦不住滚动，拖拽照样被打断）', file: 'js/chatcard.js', needle: "stopPan = (ev) => { if (ev.cancelable) ev.preventDefault(); };" },
  { name: '#1012d 可拖分类卡片行不长按选字·标准形态（删＝长按期间系统选字手势接管触摸，拖拽刚抓起就被取消）', file: 'js/chatcard.js', needle: "el.style.setProperty('user-select', 'none');" },
  { name: '#1012e 同上的 WebKit 形态（删＝iOS Safari 长按弹「拷贝」浮标并抢走这次触摸）', file: 'js/chatcard.js', needle: "el.style.setProperty('-webkit-user-select', 'none');" },
  { name: '#1012f 营救合并保住内存侧相对顺序（删＝权威库尚未进内存时（大库被启动回填挂起＝整会话不解除写守卫）拖完的顺序被并集整段还原，用户所报「长按拖动无法调整顺序」复发）', file: 'js/chatcard.js', needle: "const shared = memU.filter(c => g[1].indexOf(c) >= 0);" },
  { name: '#1012g 顺序回填只落在「两边都有的位置」上（改成整组覆盖＝权威侧独有的卡被抹掉，#193 防覆盖语义破功）', file: 'js/chatcard.js', needle: "for (let i = 0; i < g[1].length; i++) if (shared.indexOf(g[1][i]) >= 0) g[1][i] = shared[k++];" },
  { name: "#1014a 存储 bg-notify 只表达用户意图、启动恢复不再看权限读数（删/退回带 permission 的判定＝一次失真读数又把开关自己关掉）", file: "js/bg-keep.js", needle: "notifyEnabled = saved === '1';" },
  { name: "#1014b 打开开关但权限没到位时保住意图（开关不动、存储继续 1）", file: "js/bg-keep.js", needle: "function nbHoldOn(my, why) {" },
  { name: "#1014c 权限不足的如实状态改由行下标红条呈现（删＝用户只看到一个自己关掉的开关）", file: "js/bg-keep.js", needle: "function nbSyncPermWarn() {" },
  { name: "#1014d 权限到位自动生效（删＝又回到「要重新点一次开关才有反应」）", file: "js/bg-keep.js", needle: "if (nbWaitingGrant && notifyEnabled && nbPermState() === 'granted')" },
  { name: "#1014e 自测结果只等发送链落定、后续证据原地补行（删＝点测试又被 version.json 网络往返卡住）", file: "js/bg-keep.js", needle: "if (resultShown) showResult();" },
  { name: "#1014f 自测报出「后台通知开关」本身的状态（删＝开关关着也照样报链路全通＝误导）", file: "js/bg-keep.js", needle: "'✓ 后台通知开关：已开启'" },
  { name: "#1014g 自测第二段＝后台阶段（隐藏态真发一条 + 回前台给结论）", file: "js/bg-keep.js", needle: "'后台通知测试（后台阶段）'" },
  { name: "#1014h 第二段入口（删＝后台那一半又变成让用户自己判断）", file: "js/bg-keep.js", needle: "'现在测（切后台）'" },
  { name: "#1014i 模板：权限状态标红行锚点", file: "template.html", needle: "id=\"bg-notify-perm-warn\"" },
  /* ==== 2026-09-22 #1015 三个自测的「测试时间太短」收口（用户直派「电量消耗自测 闪屏自测 发烫自测，功能测试时间太短，并且还能怎么优化」）：①发烫自测时长从写死的 10 秒放开到 10 秒~5 分钟档（UI 默认 3 分钟）＋负载切片（60ms 一片、片间让出主线程——旧实现每轮同步阻塞 700ms，时长一拉到分钟级页面就变「无响应」）＋判级改看整窗趋势（6 段中位 + 首尾 10% 中位）＋不可见即暂停＋可提前结束；②电量自测默认档 30 分钟→1 小时、短窗口结论标明「属粗测」、5~15 分钟的段也标粗测；③闪屏自测加长窗口「边用边测」（1/3/5 分钟，默认 1 分钟）＝全程累计翻动/白写/掉帧并单独挑出「无操作翻动」的时刻。验证 tools/verify-energy-check.mjs / tools/verify-flash-check.mjs。 ==== */
  { name: '#1015a 发烫时长档位（删＝又回到写死的 10 秒：除「此刻有没有被限速」以外一律测不出，用户报的「测试时间太短」复发）', file: 'js/energy-check.js', needle: "var HEAT_DURS = { '10': 10000, '60': 60000, '180': 180000, '300': 300000 };" },
  { name: '#1015b 发烫负载切片逐片计时（删＝回到整段同步阻塞，时长一拉长主线程就冻死）', file: 'js/energy-check.js', needle: 'rep.slices.push(performance.now() - t);' },
  { name: '#1015c 发烫切片让出主线程（删＝主线程被负载独占，进度浮条不刷新、帧采样全废）', file: 'js/energy-check.js', needle: 'setTimeout(slice, 0);' },
  { name: '#1015d 发烫判级看整窗趋势（删＝又只剩开头 3 轮 vs 最后 3 轮两个点，中途回升/平台期看不见）', file: 'js/energy-check.js', needle: 'var bins = binMeds(r, HEAT_BINS);' },
  { name: '#1015e 发烫负载期页面不可见＝暂停（删＝后台烧电，且被内核节流的定时器会把负载时钟拉成假完成）', file: 'js/energy-check.js', needle: 'if (hidAt) { rep.pauseMs += performance.now() - hidAt; hidAt = 0; actAt = performance.now(); }' },
  { name: '#1015f 发烫提前结束出口（删＝3 分钟档点下去出不来，用户只能干等或杀页面）', file: 'js/energy-check.js', needle: 'if (_heatStop) { rep.stopped = 1; return finish(); }' },
  { name: '#1015g 发烫档位弹窗接上（删＝档位胶囊与引擎脱钩，选几分钟都按默认跑）', file: 'js/energy-check.js', needle: 'pills: HEAT_PILLS,' },
  { name: '#1015h 电量默认档 1 小时（改回 30 分钟＝默认值本身给不出可用数字，工具自己的报告就写着「1 小时以上才有参考价值」）', file: 'js/energy-check.js', needle: "var ms = BAT_DURS[String(v)] || BAT_DURS['60'];" },
  { name: '#1015i 电量短窗口结论标明粗测（删＝15 分钟档的数字被当成结论）', file: 'js/energy-check.js', needle: "+ (totalMs < BAT_REF_MS ? '· 窗口不足 1 小时，属粗测' : ''));" },
  { name: '#1015j 电量 5~15 分钟的段也标粗测（删＝6 分钟的段与 1 小时的段长得一模一样）', file: 'js/energy-check.js', needle: "var tier = ms < SEG_MIN_MS ? '不足 5 分钟' : (ms < SEG_COARSE_MS ? '不足 15 分钟' : '');" },
  { name: '#1015k 闪屏长窗口档位（删＝闪屏自测又只剩「点 4 下」那 4×0.7 秒，「用一会儿才闪」的现场永远不在场）', file: 'js/flash-check.js', needle: "var WIN_DURS = { '0': 0, '60': 60000, '180': 180000, '300': 300000 };" },
  { name: '#1015l 无操作翻动判据（删＝长窗口数不出「没有任何操作却自己翻动」的时刻，最可疑的闪源失去口径）', file: 'js/flash-check.js', needle: 'if (msSinceAct(fl.t) >= WIN_ACT_MS) idle.push(fl);' },
  { name: '#1015m 用户活动锚（删＝打字/切页/上滑触发的样式改写被冤成「自己闪」）', file: 'js/flash-check.js', needle: "_actEvs = ['click', 'pointerdown', 'touchstart', 'keydown', 'input', 'scroll'];" },
  { name: '#1015n 长窗口到点自动出报告（删＝时间到了不出报告，用户不知道还得去点浮条）', file: 'js/flash-check.js', needle: "if (left <= 0) { chipSay('时间到，正在出报告…'); finishWin(); return; }" },
  { name: '#1015o 长窗口掉帧累计与最慢帧现场（删＝按 6000 截断的帧数组统计＝长窗口掉帧数严重偏低）', file: 'js/flash-check.js', needle: '_worst.push({ off: Math.round((t - _winT0) / 1000), pg: pageName(), ms: Math.round(gap) });' },
  { name: '#1015p 三行自测文案写明时长与默认档（删＝工具里只写「约 10 秒」，用户不知道有长档，本批口径回退）', file: 'index.html', needle: '10 秒~5 分钟测发烫降频（默认 3 分钟，可中途结束）' },
  { name: '#1017a 进聊天页「先上屏一帧再跑重活」（删＝进度条置位与撤销又落回同一任务＝用户那句「没有加载动画缓冲」复发）', file: 'js/chat.js', needle: "requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(run, 0); }); });" },
  { name: '#1017b 进聊天页重活挂在首帧之后（改回当场同步跑 loadMsgs/重建＝置位即撤销、进度条再次从未上屏）', file: 'js/chat.js', needle: "chatEnterPaintThen(function () {" },
  { name: '#1017c 重活保险丝（删＝后台标签/不可见页面 rAF 不派发时进聊天永不渲染）', file: 'js/chat.js', needle: "setTimeout(run, 120);" },
  { name: '防骗+署名禁倒卖声明运行时回填·缺失重建置顶条（防倒卖：f7a8b5c首建/0965278移除后按用户需求恢复并扩展双条；#976 起宿主＝必读卡组最顶、旧副本回退公告卡）', file: 'js/clock.js', needle: 'host.insertBefore(box, refNode || host.firstChild);' },
  { name: '#378/#998 单聊来消息跟底闸＝钉住标记 OR「视口此刻就在真底部」（#378 的标记语义零改动；#998 补几何事实：标记被一次触摸解钉后，恢复路一旦被时序错过就永久失真、此后每条来消息都不跟底，而「用户此刻停在最新一条上」是几何事实；scrollChatBottom 顺带把标记复位＝自愈。删掉 chatAtBottom 那半段＝标记失真时来消息重新不跟底）', file: 'js/chat.js', needle: 'if (!out && !userFollow && !chatPinnedBottom && !chatAtBottom()) return;' },
  { name: '#378/#416/#998 解钉态周期复核＝用户自己滚回真底部即恢复自动跟底（#378 的「滚回贴底可回钉」原本只是「滚动事件 + 100ms 防抖」的一次性判据：判完即止、手势期一撞 chatTouchActive 就放弃且不续期＝钉住态永久丢失（无头实证：抬手停在最底 gap=0，来消息却不再跟底、连发累积 133.7px）；#998 搬进看门狗周期复核、与「钉住态离底即补钉」同形对称；不由 touchend 就地回钉（抬手瞬间惯性还没开始走，那时置钉会被看门狗把惯性滑行整段拽回底部＝#416/#716 复发）。只认 ≤8px＝绝不拽正在上翻的用户，写入交落定锁。删掉这行＝失底重新粘住）', file: 'js/chat.js', needle: "chatPinnedBottom = true; cb706.classList.remove('scroll-anchor-auto'); chatScrollRealignQuiet();" },
  { name: '#998c 解钉态复核的贴底前置（防修过头：删掉＝解钉态一律回钉，正在上翻阅读的用户被周期拽回最底＝#416/#162 主诉回流）', file: 'js/chat.js', needle: 'if (!chatAtBottom()) return;' },
  { name: '#720b 分帧世代令牌防重入（删则新一轮渲染与旧构建交错＝窗口错乱）', file: 'js/chat.js', needle: 'if (myToken !== _rwToken) { try { restoreInplaceDrafts(); } catch (e) {} if (avatarBatchCache === myAvBatch) appendAvatarBatch(false); if (batchDefer === myDefer) batchDefer = null; return; }' },
  { name: '#416/#998 单聊「贴底」判定与写方同尺（chatAtBottom ＝ chatScrollMax() − scrollTop ≤8px；#416 的 8px 口径与「上翻读最新一条必然 >24px」结论零变化。旧口径用裸 scrollHeight−clientHeight，而打字行在每条来消息落地前显示 0.4~1.4s（正是用户会去点/滑的窗口），行显示期真贴底被读成「离底一行高 ≈22px」＝假解钉态，轻点回钉与滚动落定回钉两条恢复路一起失效）', file: 'js/chat.js', needle: 'return chatScrollMax() - cb.scrollTop <= 8;' },
  { name: '#968a 帮我决定单聊结果补响收消息音效（删＝结果发到聊天一声不响，退回「发了消息没音效」；silent 的横幅语义保留不动）', file: 'js/decision.js', needle: "window.playSfx('in'); } catch (e) {} // FIX 2026-09-21 #968 帮我决定结果响收消息音效" },
  { name: '#968b 多人决定单聊结果补响收消息音效（同 #968a 口径；群聊那一路 gcSendDecisionText 本就响 playSfxGc(\'in\')）', file: 'js/group-decision.js', needle: "window.playSfx('in'); } catch (e) {} // FIX 2026-09-21 #968 多人决定结果响收消息音效" },
  { name: '#974c 删除型：指向该章的必读摘要高亮条已删·离线兜底（回流＝摘要指向不存在的章节）', file: 'template.html', needle: 'splash-hl">开屏 / 打开时偶尔慢几秒', absent: true },
  { name: '#974d 删除型：指向该章的必读摘要高亮条已删·在线权威源（回流＝摘要指向不存在的章节）', file: 'pwa/notice.json', needle: '"hl": "开屏 / 打开时偶尔慢几秒', absent: true },
  { name: '#730a 屏幕上方弹出·前台/后台如实归因＋引导复核（删掉＝自检又只凭进队列就报成功，证明不了屏幕上方真弹横幅）', file: 'js/bg-keep.js', needle: '要验「屏幕上方弹出」：按 Home 切后台（或锁屏），即可看到通知从屏幕顶部弹出' },
  { name: '#761b 版本行落定前不出结果（删掉 Promise.all＝版本比对没回来就弹结果，旧包告警迟到或被截断）', file: 'js/bg-keep.js', needle: 'Promise.all([queueCheck, verP]).then(showResult);' },
  { name: '#761d 确认只在 SW 通道真成功时触发（改成无条件弹＝页面通道/失败也追问，自欺负人；删掉＝结果与追问脱钩）', file: 'js/bg-keep.js', needle: "if (testChan === 'sw' && testOk) askSeen();" },
  { name: '#739h 警示卡专属色样式（删＝开屏警示卡退化成普通灰卡、与陈述卡混在一起；#976 起为须知橙）', file: 'css/base.css', needle: '.splash-alert.splash-browser .splash-alert-t { color:#c2410c;' },
  { name: '#878a 卡片入场动画类在挂载前补加（#878 报障：礼物/互动卡无动画突兀出现。根因=renderMsg 建节点时加 msg-enter、随后所有分支 m.className=… 整体覆盖抹掉；needle=补类与挂载同行的接线锚——类加回建节点处即失效消失）', file: 'js/chat.js', needle: "if (!batchRendering) m.classList.add('msg-enter');" },
  { name: '#919a 分帧整窗路径空洞守卫（删＝构建途中 renderMsg 抛错断链、frag 永不换装＝看不到最新消息复发）', file: 'js/chat.js', needle: "if (!_rm || typeof _rm !== 'object') { skippedIdx.push(i); continue; } // #919a" },
  { name: '#919b 同步整窗路径空洞守卫（删＝异常一路上抛、调用方贴底收尾整段跳过）', file: 'js/chat.js', needle: "if (!_rm || typeof _rm !== 'object') { skippedIdx.push(i); continue; } // #919b 同 #919a：同步整窗路径也不得被单条空记录打断" },
  { name: '#921g 通知自动关闭只认 denied（改回 ===granted 即落 0＝瞬态 default 误读把授权用户的开关永久关掉复发）', file: 'js/bg-keep.js', needle: "Notification.permission !== 'denied'" },
  { name: '#982a 聊天侧入口改挂「聊天设置 → 美化」（删＝聊天里没入口、只剩设置一条路；原 #962h 是「更多 → 工具」按钮，用户 2026-09-21 直派挪出更多面板）', file: 'template.html', needle: 'id="cs-screen-adj"' },
  { name: '#982b 聊天设置入口接线（删＝点行没反应；原 #962j 接的是 more-screen-adj）', file: 'js/personalize.js', needle: "const chatSetEntry = document.getElementById('cs-screen-adj');" },
  { name: '#961a 设置页「信息诊断」独立 tag（重放 #957；删＝诊断/自测行退回「工具」大组，用户又找不到诊断入口）', file: 'template.html', needle: 'data-sec="diag"' },
  { name: '#961b 设置搜索分区名表含 diag→信息诊断（删＝搜「诊断」不再跨 tag 命中新段）', file: 'js/personalize.js', needle: "diag: '信息诊断'" },
  { name: '#961c 功能介绍「诊断与自检」功能组（删＝功能介绍里诊断/自测入口散落别处）', file: 'template.html', needle: 'lg-name">诊断与自检' },
  { name: '#961d 关于常见问题「没有账号、不会自动同步」行（删＝用户又问数据为什么不跟着换机/同步）', file: 'template.html', needle: 'id="row-faq-noacct"' },
  { name: '#961e 关于常见问题「浏览器和桌面图标是两份数据」行（删＝装到桌面看到空数据误判丢数据）', file: 'template.html', needle: 'id="row-faq-twostore"' },
  { name: '#961f 关于常见问题「收不到消息、通知不弹」行（删＝通知收不到又被当 bug）', file: 'template.html', needle: 'id="row-faq-notify"' },
  { name: '#961g 三条常见问题弹窗接线（删＝点行无反应、弹不出说明）', file: 'js/personalize.js', needle: "bind('row-faq-noacct'" },
  { name: '#986a 静态平台胶囊不得回流（删＝桌面 Chromium 用户又被「仅安卓」劝退、iPhone 浏览器形态用户又被叫去开空开关）', file: 'template.html', needle: 'class="plat-tag" data-plat="android">仅安卓', absent: true },
  { name: '#986b iOS 侧静态胶囊同样不得回流（真实门槛是独立应用形态，不是 iPhone）', file: 'template.html', needle: 'class="plat-tag" data-plat="ios">仅 iPhone', absent: true },
  { name: '#986c 静态平台胶囊样式整体退役（回来＝有人把按手机系统标平台又加回来了）', file: 'css/setting.css', needle: '.gs-row .plat-tag', absent: true },
  { name: '#986d 本机能力标记：后台通知的门槛是「Chromium + 通知能力」不是「安卓」（删＝退回按手机系统标）', file: 'js/personalize.js', needle: 'if (!hasNotify()) return {' },
  { name: '#986e 顶部避让修正的门槛＝独立应用形态（删＝iPhone 浏览器形态又被叫去开一个空开关）', file: 'js/personalize.js', needle: 'if (isIosStandalone()) return null;' },
  { name: '#986f 替代指引插在该行紧后面（退回插在整段说明之后＝六百字说明把「去开启」压在底下看不见）', file: 'js/personalize.js', needle: 'insertBefore(hint, row.nextSibling);' },
  { name: '#986g 测试按钮三分支：非安全上下文才说 HTTPS，iPhone / 安卓壳说本机没有通知能力（删＝又被误诊成 https）', file: 'js/bg-keep.js', needle: 'if (!window.isSecureContext) {' },
  { name: '#986h 离线提醒状态行不再对 iPhone 说「只能靠系统通知」（与同段「iPhone 拿不到通知」矛盾）', file: 'js/bg-keep.js', needle: 'iPhone / iPad 拿不到' },
  { name: '#986k 通知授权失败文案不再暗示「装到主屏幕就能拿到」（iOS WebKit 只认推送服务通道）', file: 'js/bg-keep.js', needle: '添加到主屏幕也不保证）请用「桌面消息弹窗」' },
  { name: '#986i 顶部避让修正胶囊口径＝独立应用形态（删＝又写成「iOS 专用 / 仅影响 iOS」）', file: 'js/settings-help.js', needle: '独立应用（添加到主屏幕）形态专用修正' },
  { name: '#986j 离线消息提醒口径＝Chromium 内核（安卓 / 电脑），不是「仅安卓」', file: 'template.html', needle: '仅安卓 / 电脑上的 Chrome、Edge 且添加到桌面后可用' },
  { name: '#967a 进度条并入权威未达标记（删＝armReadyFuse 的 15s 保险丝一跳就收进度条，而屏上一条消息都没有＝空屏无提示）', file: 'js/chat.js', needle: 'chatRebuilding || chatAuthPending' },
  { name: '#967b 权威未达标记声明（删＝判定无据，进度条退回只认 chatDbReady）', file: 'js/chat.js', needle: 'let chatAuthPending = false;' },
  { name: '#967c 快重试耗尽转看门狗（删＝IDB_RETRY_MAX 六次快重试用尽后永久放弃读库，屏上永久空白且无读库入口）', file: 'js/chat.js', needle: 'if (idbRetryTimer || idbRetryCount >= IDB_RETRY_MAX) { armChatAuthWatch(); return; }' },
  { name: '#967d 慢重试看门狗（删＝大键读超时/在飞链被冻结这类几十秒后自愈的失败再无补读通道）', file: 'js/chat.js', needle: 'function armChatAuthWatch() {' },
  { name: '#967e 回前台补读挂载（删＝挂后台切回来只做贴底复核，没有任何重新起读入口＝用户实报的「什么也看不到」）', file: 'js/chat.js', needle: "document.addEventListener('mochi-fg-resume', chatResumeRearmRead);" },
  { name: '#967f 读到不可用形态按读失败重试（删＝异格式/脏值只置 ready 就 return，屏上空白却收掉进度条且再无重试）', file: 'js/chat.js', needle: 'if (!Array.isArray(idbArr)) { // #967' },
  { name: '#973a 开屏最顶端红卡挂在 .splash-box 首个子节点（删＝用户直派的「开屏顶部最显眼标红提醒」整块消失）', file: 'template.html', needle: '使用前必看 · 本站内容非常多' },
  { name: '#973b 红卡红色警示形态（删/改回灰底灰条＝最顶端这张卡退回普通卡，不再显眼）', file: 'css/base.css', needle: 'background:#fdecec; border-left:4px solid #d23430; border-radius:12px; text-align:left;' },
  { name: '#973c 红卡暗色主题（删＝暗色下红卡按亮底深红字渲染，字看不清）', file: 'css/base.css', needle: '[data-theme="dark"] .splash-bigwarn {' },
  { name: '#973d 必读摘要同口径一条（在线 notice.json 会用 summary 整段替换静态列表，静态兜底丢了＝离线看到的是旧口径摘要）', file: 'template.html', needle: '【本站内容非常多，不适用建议不使用】' },
  { name: '#975a 互助群公告章「问 AI」免责·在线权威源（删＝用户直派的「AI 会出错会骗人请自行甄别」口径从联网用户开屏消失）', file: 'pwa/notice.json', needle: '「可以问 AI」只是使用建议：实际问题时去问 AI' },
  { name: '#975b 报修章「问 AI」免责·在线权威源（删＝报修章只剩「比作者回复快」却看不到甄别提醒，同口径仅剩互助群章一处）', file: 'pwa/notice.json', needle: '注意：AI 的回答无法保证 100% 正确——AI 也会出错和骗人，请自行甄别。' },
  { name: '#975c 互助群公告章「问 AI」免责·离线兜底（删＝断网/弱网用户看到的开屏没有该免责条）', file: 'template.html', needle: '也无法保证 100% 正确——AI 也会出错和骗人，请自行甄别。</p>' },
  { name: '#975d 报修章「问 AI」免责·离线兜底（删＝断网/弱网用户在报修章看不到甄别提醒）', file: 'template.html', needle: '注意：AI 的回答无法保证 100% 正确——AI 也会出错和骗人，请自行甄别。</p>' },
  { name: '#975e 第二页强制公告底部 note 补「让 AI 修 / 问 AI」免责（删＝进入前最后一屏只有 AI 建议、没有甄别提醒）', file: 'template.html', needle: 'AI 给的答案请自行甄别。</div>' },
  { name: '#977a 保活两条硬限制红条挂在行下（删＝设置页看不到「占音频截断/挂久失效重开」提醒）', file: 'index.html', needle: 'id="bg-keep-sub"' },
  { name: '#977b 红条文案本体·音频截断语义（文案被改没只剩空壳＝限制没说清）', file: 'index.html', needle: '刷视频、听音乐会把保活截断' },
  { name: '#977c 后台弹窗行补失效恢复口径（删＝弹窗行不再指向「彻底关闭网页重新打开再开开关」）', file: 'index.html', needle: '失效后彻底关闭网页重新打开，再把两个开关重新打开' },
  { name: '#977d 手动开启保活即弹两条限制弹窗（删＝开启时没有当面告知）', file: 'js/bg-keep.js', needle: 'startKeepAlive(true); kaOpenEnableHints();' },
  { name: '#977e 长后台冻结回前台当面提示（删＝被冻结过的回前台不再提示失效与恢复方法）', file: 'js/bg-keep.js', needle: '挂后台太久，保活被系统冻结截断过' },
  { name: '#977f 功能说明胶囊补截断/失效两章（删＝说明弹窗退回「会自动把播放权抢回来」旧口径）', file: 'js/settings-help.js', needle: '【别的 App 刷视频/听音乐会把保活截断】' },
  { name: '#976a 必读卡组容器（删＝7 张必读卡退回「品牌卡内 2 张 + 公告卡内 5 张」两半，用户点名要的「挪到品牌卡前」丢失）', file: 'template.html', needle: '<div class="splash-mustread" id="splash-mustread">' },
  { name: '#976b 必读卡组容器样式（删＝卡片按各自原宽度/间距散排，组内节奏与整页左右对齐丢失）', file: 'css/base.css', needle: '.splash-mustread { width:min(324px, 100%); box-sizing:border-box; display:flex; flex-direction:column;' },
  { name: '#976c 停更公告须知橙（改回红＝红不再是「使用红线」专色，用户直派的「颜色太乱」回流）', file: 'css/base.css', needle: '.splash-stopupdate .splash-stopupdate-t { font-size:13px; font-weight:800; color:#c2410c;' },
  { name: '#976d 使用前提不得再有专属蓝（回流＝强调色又变 5 种，蓝与红/橙/琥珀抢语义）', file: 'css/base.css', needle: 'background:#e8f0fc; border-left:3px solid #3a6fc4; border-radius:12px;', absent: true },
  { name: '#976e 防倒卖回填宿主＝必读卡组、旧副本回退公告卡（删/改回只认 #splash-notice＝卡片搬走后回填找不到宿主，二传副本被删后不重建）', file: 'js/clock.js', needle: "return document.getElementById('splash-mustread') || document.getElementById('splash-notice');" },
  { name: '#976f 5s 看门狗作用域同步必读卡组（删/改回只查 #splash-notice＝卡被删后看门狗认不出、补回锚点也错位）', file: 'js/pwa.js', needle: "const n = document.getElementById('splash-mustread') || document.getElementById('splash-notice');" },
  { name: '#976g 免责声明保留红色（删/换色＝第二条使用红线丢失，用户选定的「顶卡 + 免责声明红」被改掉）', file: 'css/base.css', needle: '.splash-alert.splash-disclaimer .splash-alert-t { color:#c22b27;' },
  { name: '#980a 使用说明「数据与备份」新增 iPhone/iPad 必做条（删＝备份章不再告诉 iPhone 用户：不装到主屏幕会被系统连续 7 天规则清空）', file: 'template.html', needle: 'iPhone / iPad 必做</b>：把本站<b>「添加到主屏幕」</b>' },
  { name: '#980b 该章计数随新条同步（漂移＝说明页计数与实际条目数不符，按计数找条找不到）', file: 'template.html', needle: '数据与备份</span><span class="lg-count">8</span>' },
  { name: '#980c 使用说明「iPhone / iOS 使用与限制」推荐用法补「不装到主屏幕数据会被清掉」＋导出/导入顺序（删＝推荐用法只剩「更好用」，看不到数据被清这条根因）', file: 'template.html', needle: '<b>更重要的是数据：不装到主屏幕，数据会被系统清掉。</b>' },
  { name: '#980d 设置「导出数据」胶囊补 iOS 主屏幕口径（删＝备份行不再提「装到主屏幕＋两套独立存储」，iPhone 用户备份完仍不知要装到桌面）', file: 'js/settings-help.js', needle: 'Safari 标签页连续 7 天没打开会被系统自动清空全部数据' },
  { name: '#980e 备份提醒条 iOS 标签页追加主屏幕指路（删＝iOS 提示只留在弹窗第④条，只看顶条的用户不知道要装到主屏幕）', file: 'js/pwa.js', needle: 'iPhone：导出后请「添加到主屏幕」，改用桌面图标打开' },
  { name: '#980f 提醒条窄屏按钮换行（删＝iOS 文案加长后 320px 级屏「去备份」被挤出屏外，与 #939 续二同源）', file: 'js/pwa.js', needle: "bar.style.flexWrap = 'wrap';" },
  { name: '#1010a 屏上窗口身份键（删＝判不出屏上是权威的哪一段，尾部切片错位补丁复发）', file: 'js/chat.js', needle: 'function chatWinKey(m) {' },
  { name: '#1010b 尾部切片判定（删＝局部下标被当权威下标用，lite 升级取错记录＝内容串位）', file: 'js/chat.js', needle: 'chatWinKey(msgs[tailIdx]) === windowKeyLoVal && chatWinKey(msgs[len - 1]) === windowKeyHiVal' },
  { name: '#1010c 尾部切片下标整体平移（删＝错位节点原地补丁＋重复追加＋prune 削节点＝记录整批闪动）', file: 'js/chat.js', needle: 'el.dataset.idx = String(Number(el.dataset.idx) + winShift);' },
  { name: '#1010d 平移后不再走尾部增量追加（删＝按旧 grown 把同一批记录再画一遍＝屏上两份）', file: 'js/chat.js', needle: 'if (grown > 0 && !winShift) {' },
  { name: '#1010e 整窗渲染登记窗口身份（删＝凭据缺失，收尾一律退回整窗重建＝闪动回流）', file: 'js/chat.js', needle: 'chatWinKeysSync(); // #1010：登记屏上窗口首/尾记录身份' },
  { name: '#1010f 进度条并入收尾媒体窗（删＝权威一到就撤进度条，视口图再落地＝「弹窗先消失、记录再闪一下」）', file: 'js/chat.js', needle: '|| chatSettleHoldOn()) && !chatKnownEmpty' },
  { name: '#1010g 分帧换装落定后重判媒体窗（删＝换装落定那一帧不再判，进度条先撤、图再落地）', file: 'js/chat.js', needle: 'try { chatSettleHoldSettle(); } catch (e) {} // #1010：分帧换装落定后再判' },
  { name: '#1010h 收尾换装前先持有进度条（删＝收尾中途任一 updateChatLoading 就把进度条撤掉）', file: 'js/chat.js', needle: 'chatSettleHoldArm(); // #1010：权威收尾在飞（换装 + 视口媒体解码）——进度条持有到本段结束' },
  { name: '#1010i 媒体窗只算视口内（删＝视口外 lazy 图永不 complete，进度条被白拖到 deadline）', file: 'js/chat.js', needle: 'if (r.bottom < top || r.top > bot) continue;' },
  { name: '#1010j 分帧换装在飞时顺延判定（删＝换装途中被判成「收尾已落地」，进度条先撤、图再落地）', file: 'js/chat.js', needle: 'if (batchRendering) { chatSettleHoldDefer(); return; } // 换装未落定：等 finishSwap 再判' },
  { name: '#981a 顶卡新增「词典字卡太多，不适用建议关闭」口径（删＝用户新稿的这一句丢失；字卡库→词典页顶部另有同款标红提醒 #961）', file: 'template.html', needle: '默认聊天字卡的词典字卡太多，不适用建议关闭' },
  { name: '#981b 必读摘要补词典字卡入口（删＝顶卡说了建议关闭却没告诉在哪关；两份同步：静态 + notice.json）', file: 'template.html', needle: '字卡库 → 词典（与默认聊天字卡同属系统预设）可把不用的分组整组停用' },
  { name: '#987a 半框背景涂来电/去电弹窗卡片（删/改回＝图又涂到设置用的半屏面板上，用户报的「上传错地方」复发）', file: 'js/call.js', needle: "paintCallBg(document.querySelector('.call-panel'), hbg || cbg);" },
  { name: '#987b 弹窗背景回落通话背景＋通话小框只认通话背景（删＝只设过通话背景的老用户来电弹窗突然变空白，或半框图串到小框上）', file: 'js/call.js', needle: "paintCallBg(document.getElementById('call-mini'), cbg);" },
  { name: '#987c 通话中点「打开来电弹窗」＝展开真实通话面板（删/改回只 toast＝用户点它看不到那个框，只剩一句「当前正在通话中」）', file: 'js/call.js', needle: "toast('通话中·已展开通话面板');" },
  { name: '#987d 删除型：半框背景不得再涂设置用的半屏面板（回流＝#641 旧落点回来，用户点上传后自己的设置面板变成壁纸）', file: 'js/call.js', absent: true, needle: 'half.style.backgroundImage' },
  { name: '#987e 设置页口径指向方形通话弹窗（删/改回「作用于通话小框」＝文案与落点不符，用户按文案又会找不到图去了哪）', file: 'template.html', needle: '作用于「联系人打给你 / 你打给联系人」时弹出的那个方形通话弹窗' },
  { name: '#990a 页签选中态（删＝两枚裸按钮又分不出哪一枚是「我现在要调的」＝用户原话复发）', file: 'js/personalize.js', needle: "b.setAttribute('aria-pressed', on ? 'true' : 'false');" },
  { name: '#990b 当前页那组打「你正在这一页」标记（删＝看不出哪根滑杆管哪一页）', file: 'js/personalize.js', needle: "if (mk) mk.style.display = groupIsCurrent(h.getAttribute('data-adj-group')) ? 'inline-block' : 'none';" },
  { name: '#990c 轴→生效页面 组表（删＝分组说明丢失，七轴又平铺成一列）', file: 'js/personalize.js', needle: "desk: '只影响「桌面页」'," },
  { name: '#990d 分组小标题渲染（删＝没有「哪根滑杆管哪页」的小标题）', file: 'js/personalize.js', needle: "gh.setAttribute('data-adj-group', ax.group);" },
  { name: '#990e 标题行拖动说明（用户原话「托标题行可上移…没有写清楚」的落点；删＝说明又丢，或又被右侧按钮挤成省略号）', file: 'js/personalize.js', needle: "headHint.textContent = '按住这行标题上下拖＝把面板挪开';" },
  { name: '#990f 用法段（删＝切页与三组滑杆怎么用又没人说）', file: 'js/personalize.js', needle: '想调哪一页，就点「正在调」旁边那一枚页签' },
  { name: '#990g 设置页下说明行直说点哪一枚（删＝两枚都不高亮时用户又不知道点哪个）', file: 'js/personalize.js', needle: "else ch.textContent = '当前不在桌面/聊天页（' + nm + '）：点「桌面」或「聊天」切过去看现场" },
  { name: '#990h 设置行小字写明「反色高亮那枚＝正在调的页面」（删＝设置页小字与面板新交互对不上）', file: 'template.html', needle: '反色高亮的那一枚＝你正在调的页面' },
  { name: '#990i 使用说明与功能介绍口径同步（删＝开屏「使用前必看」与功能介绍又写回六轴滑杆 / ±2px 步进旧 UI，用户对着面板看会以为功能变了）', file: 'template.html', needle: '滑杆按「哪一页生效」分三组' },
  { name: '#985j 切桌面即作废卡片状态记忆表（删＝换联系人后，切过去那个桌面的礼物卡丢领取态/回复——自查发现的真缺陷）', file: 'js/gift-shop.js', needle: "boxMetaInvalidate(); } catch (e) {}   // #985：切桌面后卡片状态按新桌面重读" },
  { name: '#985k 导入/回填完成即作废卡片状态记忆表（删＝导入备份后卡片仍按导入前的心意柜渲染）', file: 'js/gift-shop.js', needle: "boxMetaInvalidate(); } catch (e) {}   // #985：导入回填后卡片状态按新存储重读" },
  { name: '#991a 单点实现 mochiFilePickSurface（删＝四个头像入口退回「全靠内核配合」的三腿＝用户报障的「点了没反应」复发）', file: 'js/device.js', needle: 'window.mochiFilePickSurface = function (btn, opts) {' },
  { name: '#991b surface 层可命中、opacity 仍为 1、有真实尺寸（退回 opacity:0 / 1px / clip / display:none＝#717/#738 那族「不可见 input 拒绝激活」写法）', file: 'js/device.js', needle: "input.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;outline:none;background:transparent;color:transparent;font-size:0;appearance:none;-webkit-appearance:none;cursor:pointer;z-index:0;';" },
  { name: '#991c guard 探测 surface 点按后让路（删＝surface 与三腿各弹一次＝双开）', file: 'js/device.js', needle: 'if (window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) { cleanup(); settled = true; return; }' },
  { name: '#991d Fire 探测 surface 点按后让路（45 处统一入口与手写兜底同吃，删＝双开面扩大）', file: 'js/device.js', needle: 'if (window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) return true;' },
  { name: '#991e 桌面两个头像盒铺 surface（删＝用户报障入口回到「点了没反应」）', file: 'js/personalize.js', needle: "id: 'mochi-avatar-tap-' + id," },
  { name: '#991f 装修模式不再把头像区的点击吞成「卡片背景」菜单（删＝装修模式下点桌面头像换不了头像、点昵称改不了名）', file: 'js/personalize.js', needle: "if (e.target.closest('.deco-avatar')) return;" },
  { name: '#991g 聊天设置两行头像各铺一层 surface（#738 起的历史报障入口；删＝那两行只剩三腿）', file: 'js/chat-settings.js', needle: "id: 'cs-avatar-user-tap', accept: 'image/*'," },
  { name: '#991h 头像选图管线抽成公共函数、surface 与老路径共用（删＝两条来源各写一份压缩/落库，最易出「弹了但图丢了」#813 式回归）', file: 'js/chat-settings.js', needle: 'function headPickFile(f) {' },
  { name: '#991i 开屏新增 iPhone「添加到主屏幕」提示卡（删＝iPhone 用户继续不知道数据被清的根因与装法；与 notice.json 摘要/章节两份同步）', file: 'template.html', needle: '<div class="splash-alert splash-ioshome" data-ios-home="1">' },
  { name: '#991j 该卡琥珀形态（#976 定的「需要你操作」族；改色＝占用橙/红名额、打乱四色语义）', file: 'css/base.css', needle: '.splash-alert.splash-ioshome { background:#fdf3e0; border-left:3px solid #c07f1f; border-radius:12px; padding:13px 15px 14px 16px; }' },
  { name: '#991k surface 层原生「选择文件」按钮藏掉（删＝入口上浮出一个原生按钮破相）', file: 'css/base.css', needle: 'input.mochi-pick-surface::-webkit-file-upload-button { display:none; }' },
  { name: '#991l 在线公告摘要补 iPhone 主屏幕一条（删＝只读在线公告的用户看不到这条；与开屏静态卡两份同步）', file: 'pwa/notice.json', needle: '【iPhone 用户必读】请把本站「添加到主屏幕」后再用' },
  { name: '#995a 开屏二页新增卡片锚点（删＝「AI 不要 100% 依赖」整卡从强制公告页消失）', file: 'template.html', needle: 'id="splash-mandatory-aicaveat"' },
  { name: '#995b 新卡第一段（删＝「建议用 AI 但不要 100% 依赖和信任」口径丢，只剩页 1 的短句。needle 取核心从句：整段被改写但这句话还在＝口径未丢，不算回归；这句话被删/改写即报警）', file: 'template.html', needle: '但建议不要 100% 依赖和信任 AI' },
  { name: '#995c 新卡第二段（删＝「停更后不解答任何问题、代码全开源可看可学可二改」口径丢）', file: 'template.html', needle: '可查看、可学习、可二改' },
  { name: '#995d 新卡第三段（删＝「上面推荐的两个可白嫖 AI 的额度只是当下、仅供参考」口径丢）', file: 'template.html', needle: '以后不知道，仅供参考。' },
  { name: '#995e 新卡仍排在「公告完」之前（挪出滚动正文尾＝读者滑到页尾才看的那段落点丢失，卡片被挤出强制页）', file: 'template.html', needle: '仅供参考。</p>\n          </div>\n        </div>\n        <div class="splash-mandatory-end">' },
  { name: '#989a 判据：最深实心盒下沿仍在可视区内才算「翻下去什么也看不到」（删＝护栏不再裁不可见溢出，残留滚动量又留在页上）', file: 'js/desktop-slider.js', needle: 'inkBottom(sl, sl.getBoundingClientRect().top) <= sl.clientHeight + 1' },
  { name: '#992a 转后台那一刻先看保活/通知开关（删＝一开保活切走就被换版重载，保活音频被拆、回开屏问答门，主诉复发）', file: 'js/pwa.js', needle: 'if (bgLivenessOn()) return;' },
  { name: '#992b 自动通道已在后台也不换版（删＝后台预取完成时页面恰在后台就照样重载）', file: 'js/pwa.js', needle: 'if (auto && bgLivenessOn()) { armAutoReloadWhenHidden(); showVerBar(autoTs); return; }' },
  { name: '#992c 闸门读的是全局键 bg-keepalive / bg-notify（改读别的键/内存变量＝开关开着也拦不住）', file: 'js/pwa.js', needle: "return st.get('bg-keepalive') === '1' || st.get('bg-notify') === '1';" },
  { name: '#1000a 开屏锁卡静态兜底提示明确指路第一页章节（删/回退成「答案就在开屏里可以找到」＝用户又去第二页公告的日期里猜）', file: 'index.html', needle: '答案就在开屏第一页的章节目录里' },
  { name: '#1000b 必读摘要高亮条指路第一页章节＋排除第二页日期（删＝摘要退回只说「开屏目录」、第二页日期误导复发）', file: 'index.html', needle: '生日写在开屏第一页的章节目录里——点开第一页顶部的「目录」' },
  { name: '#1000c 锁定态 tip 的密码指路口径（删＝开屏锁卡又只说「开屏公告的目录」，用户分不清是哪个公告）', file: 'js/clock.js', needle: '生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）' },
  { name: '#1000d 进入后提醒弹窗按「在应用内」改写指路（删＝应用内提醒只在讲公式，用户不知道要回开屏第一页找）', file: 'js/clock.js', needle: '要回开屏第一页的章节里找' },
  { name: '#1000e 暗号入口（跳过开屏问答）指路口径', file: 'js/applock.js', needle: 'mochi 字卡的生日写在开屏第一页的章节目录里' },
  { name: '#1000f 摘要高亮条·在线权威源同口径（联网用户开屏生效的那份）', file: 'pwa/notice.json', needle: '不是第二页「进入前 · 作者必读公告」上那两个日期，也不是最底下的部署时间' },
  { name: '#1000g 删除型：暗号提示不得退回把答案指向「开屏公告」（第二页公告标题正是「作者必读公告」，用户会去那儿找日期）', file: 'js/applock.js', needle: '生日写在开屏公告的目录里，不是开屏最底下的部署时间', absent: true },
  { name: '#1000h 删除型：密码提示不得退回把答案指向「开屏公告」（同 #1000g，密码侧；needle 取三处旧文案共有的那一截）', file: 'js/clock.js', needle: '生日写在开屏公告的目录里——注意不是', absent: true },
  { name: '#1000i 静态兜底章节改用 4 位日期（删/回退＝页 1 章节又写 8.15，用户没法一眼对上 4 位密码）', file: 'index.html', needle: '0812 开搓，0815~0829 内测' },
  { name: '#1000j 在线权威源同口径（联网用户开屏生效的那份章节）', file: 'pwa/notice.json', needle: '"0812 开搓，0815~0829 内测，谢谢参与内测的各位；Mochi字卡 0829 已完全公开，可二传二改。",' },
  { name: '#1000k 删除型：在线源不得退回点号写法（回退＝4 位口径丢，用户又拿 8.15 去凑）', file: 'pwa/notice.json', needle: '"8.12 开搓', absent: true },
  { name: '#1000l 删除型：静态兜底不得退回点号写法', file: 'index.html', needle: '8.12 开搓', absent: true },
  { name: '#997a 使用说明新增独立一节「本站只是一个网页」（删＝用户又只能从「网站坏了」理解设备限制）', file: 'template.html', needle: '本站只是一个网页（前端网站）· 很多做不到是设备限制' },
  { name: '#997b 桌面「批量上传图标图片」行小字＝选不了多张是浏览器限制、换 Chrome / Edge（删＝用户以为网站不支持批量）', file: 'template.html', needle: '一次选多张 → 到桌面按顺序点图标，每点一个换一张 · 选不了多张或点了没反应' },
  { name: '#997c 聊天「批量发送」面板插入图片行小字（删＝该入口又只剩按钮，用户不知道只能选一张是浏览器的事）', file: 'template.html', needle: 'id="batch-upload-hint">选不了多张或点了没反应' },
  { name: '#997d 头像库「添加头像」小字（删＝头像批量上传入口无浏览器限制说明）', file: 'template.html', needle: 'id="avlib-upload-hint">选不了多张或点了没反应' },
  { name: '#997e 壁纸图库「＋ 上传新图（可多选）」下小字（删＝壁纸批量上传入口无浏览器限制说明）', file: 'js/personalize.js', needle: "bgHint.id = 'phonebg-upload-hint';" },
  { name: '#997f 塔罗牌面批量上传小字（删＝牌面批量上传入口无浏览器限制说明）', file: 'js/divination.js', needle: 'id="divf-batch-hint"' },
  { name: '#997g 使用说明「功能说明」列全四节长文（删/改回三节＝新章节没进入口说明，用户看不到它）', file: 'js/settings-help.js', needle: '再到四节长文——' },
  { name: '#997h 说明页第 11 节计数与条目数对齐（漂移＝章标题上的条数与实际条数不符；HEAD 起 19≠20）', file: 'template.html', needle: '手机卡顿怎么办（安卓 / iPhone）</span><span class="lg-count">20</span>' },
  { name: '#997i 头像库小字在「添加头像」按钮上方（挪回按钮下方＝360×640 上落在滚动区折叠线以下，用户看不到）', file: 'template.html', needle: '还没有头像，点击下方按钮添加</div>\n          <div style="font-size:11px;line-height:1.6;color:var(--muted);margin:6px 0 8px" id="avlib-upload-hint">' },
  { name: '#997j 我的表情「添加」行小字（删＝表情图片批量导入入口无浏览器限制说明）', file: 'template.html', needle: 'id="myemoji-add-hint">选不了多张或点了没反应' },
  { name: '#997k 朋友圈发动态配图行小字（删＝一次最多 9 张的入口无浏览器限制说明）', file: 'template.html', needle: 'id="feed-pick-hint-note">选不了多张或点了没反应' },
  { name: '#997l 写信工具栏小字（删＝信件插图多选入口无浏览器限制说明）', file: 'template.html', needle: 'id="mail-write-img-hint">选不了多张或点了没反应' },
  { name: '#997m 回信工具栏小字（同写信，回信页独立工具栏）', file: 'template.html', needle: 'id="mail-reply-img-hint">选不了多张或点了没反应' },
  { name: '#997n 功能大全「使用说明」条目列全章节并补关键词（删/退回 5 章版＝用户搜「批量上传」「设备限制」找不到入口）', file: 'js/feature-hub.js', needle: '设备限制 浏览器限制 批量上传' },
  { name: '#999a 选项回到用户自答口径（多关心我；改回 TA 口径＝用户实报的「人称错了」回流）', file: 'js/ta-ask.js', needle: '{ t: "多关心我", reply: ["关心你这件事，不会少"' },
  { name: '#999b 同题第二处（多逗我笑）', file: 'js/ta-ask.js', needle: '{ t: "多逗我笑", reply: ["那我攒几个笑话"' },
  { name: '#999c 「我难过的样子」（题干问「你希望我记住你的哪一个瞬间」，被记住的瞬间属于用户；TA 回应「记住了，以后多让你不难过」印证）', file: 'js/ta-ask.js', needle: '{ t: "我难过的样子", reply: ["记住了，以后多让你不难过"' },
  { name: '#999d 「我认真做事的样子」（同上；TA 回应「认真的你，最好看」印证）', file: 'js/ta-ask.js', needle: '{ t: "我认真做事的样子", reply: ["认真的你，最好看"' },
  { name: '#999e 「关于我的」（你画我猜怕 TA 画的是用户自己；TA 回应「画你？那我画得最像」印证）', file: 'js/ta-ask.js', needle: '{ t: "关于我的", reply: ["画你？那我画得最像"' },
  { name: '#999f 「关于我自己的」（星星许愿方向；TA 回应「也该为自己许一次了」印证）', file: 'js/ta-ask.js', needle: '{ t: "关于我自己的", reply: ["也该为自己许一次了"' },
  { name: '#999g 预设选项文案随代码同步（删＝已装用户的固化题库拿不到修正，改了源码也白改）', file: 'js/ta-ask.js', needle: 'let changed = tcOptLabelSync(d);' },
  { name: '#999h 同步只认条数对得上的预设题（删＝选项错位覆盖风险）', file: 'js/ta-ask.js', needle: 'if (!local || !Array.isArray(local.options) || local.options.length !== def.options.length) return;' },
  { name: '#999i 删除型：TA 口径的旧选项不得回流（回来＝用户实报形态原样复发）', file: 'js/ta-ask.js', absent: true, needle: '{ t: "多关心你", reply: ["关心你这件事' },
  { name: '#999j 删除型：同上第二处', file: 'js/ta-ask.js', absent: true, needle: '{ t: "多逗你笑", reply: ["那我攒几个笑话' },
  { name: '#999k 删除型：同上「你难过的样子」', file: 'js/ta-ask.js', absent: true, needle: '{ t: "你难过的样子", reply: ["记住了' },
  { name: '#999l 删除型：同上「关于你的」', file: 'js/ta-ask.js', absent: true, needle: '{ t: "关于你的", reply: ["画你' },
  { name: '#1002a 聊天壁纸面板「＋ 上传新图」铺真·可点 input 层（删＝国产内核上「点了没反应」复发，用户报障入口之一）', file: 'js/chat-settings.js', needle: "id: 'cs-bg-up-tap', accept: 'image/*', multiple: true, owner: 'dev-cs-bg-pick'" },
  { name: '#1002b 抽屉「上传壁纸（可多选）」同款铺层（mkActSurface＝本文件新增上传按钮的统一入口）', file: 'js/chat-settings.js', needle: 'const mkActSurface = (label, fn, surfOpts) => {' },
  { name: '#1002c 桌面「首页/第 N 页背景图」行铺层（动态渲染，渲染即铺；删＝该入口回三条腿）', file: 'js/personalize.js', needle: "id: 'page-bg-tap-' + i, accept: 'image/*', owner: 'mochi-page-bg-pick'" },
  { name: '#1002d 手机壁纸面板「＋ 上传新图（可多选）」铺层（必须在 cssText 之后铺，否则内联样式被覆盖＝层退回整屏）', file: 'js/personalize.js', needle: "id: 'phone-bg-up-tap', accept: 'image/*', multiple: true, owner: 'mochi-phonebg-gallery-pick'" },
  { name: '#1002e 头像池两个「添加头像」按钮铺层（owner＝各自池选择器，多选管线原样复用）', file: 'js/avatar-lib.js', needle: "id: input.id + '-tap', accept: 'image/*', multiple: true, owner: input" },
  { name: '#1002f 朋友圈评论「图片」铺层', file: 'js/feed.js', needle: "id: 'feed-com-tap', accept: 'image/*', owner: 'mochi-com-img-pick'" },
  { name: '#1002g 朋友圈发布框「添加图片」铺层', file: 'js/feed.js', needle: "id: 'feed-pick-tap', accept: 'image/*', multiple: true, owner: 'dev-feed-pick-img'" },
  { name: '#1002h 朋友圈封面头像铺层＋重渲染后幂等补挂（删＝innerHTML 重建把那层冲掉＝点了没反应复发）', file: 'js/feed.js', needle: "id: 'feed-myav-tap', accept: 'image/*', owner: feedAvPickInput" },
  { name: '#1002i 评论图片入口不再 preventDefault 落在真·可点层上的那次点击（preventDefault 会取消「弹选择器」这个默认动作＝点了没反应）', file: 'js/feed.js', needle: "if (!(e.target && e.target.closest && e.target.closest('input[data-file-pick-surface]'))) e.preventDefault();" },
  { name: '#1002j 聊天输入栏「插入图片」铺层＋绑定时就铺一次（放在点按处理器里＝第一下永远赶不上）', file: 'js/chat.js', needle: 'chatImgSurfaceEnsure();' },
  { name: '#1002k 批量发送面板「插入图片」铺层', file: 'js/chat.js', needle: "id: 'batch-img-tap', accept: 'image/*', multiple: true, owner: 'mochi-batch-img-pick'" },
  { name: '#1002l 群聊输入栏「插入图片」铺层（含绑定时一次）', file: 'js/group-chat.js', needle: "id: 'gc-img-tap', accept: 'image/*', multiple: true, owner: gcImgPicker()" },
  { name: '#1002m 一个宿主 input 可对应多个触发按钮（聊天壁纸＝设置页面板＋抽屉两处）——删＝后点的那处拿不到回调（图被静默丢弃）', file: 'js/device.js', needle: 'window.mochiFilePickSurfaceAll = function (input) {' },
  { name: '#1002n owner 可写 id 字符串（统一入口的 input 点按时才建）——删＝那些入口选完文件无回调', file: 'js/device.js', needle: "if (typeof owner === 'string') { try { owner = document.getElementById(owner); } catch (e2) { owner = null; } }" },
  { name: '#1002o 入口定位兜底：非绝对/固定/相对/粘性就补 relative（游离态创建的入口曾被判成空串＝层变成整屏透明 input 吃掉全页点击）', file: 'js/device.js', needle: "if (_pos !== 'absolute' && _pos !== 'fixed' && _pos !== 'relative' && _pos !== 'sticky') btn.style.position = 'relative';" },
  { name: '#1002p label 层插在 surface 之前（同序画层，后插的 label 会盖住 surface＝国产内核里点了没反应复发）', file: 'js/device.js', needle: 'if (surf) btn.insertBefore(label, surf); else btn.appendChild(label);' },
  { name: '#1002q mochiFilePick 识别「本次手势就是 surface 点按」后不再补腿（删＝与 surface 各弹一次＝双开）', file: 'js/device.js', needle: 'if (!o.noClick && window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) {' },
  { name: '#1003a 聊天「更多功能→TA的提问」贴贴按钮锚点（删＝面板少一枚，用户点不到「立即让TA发贴贴」）', file: 'template.html', needle: 'id="more-cuddle-now"' },
  { name: '#1003b 同批「查岗」按钮锚点（删＝TA主动查岗只能等概率）', file: 'template.html', needle: 'id="more-ck-now"' },
  { name: '#1003c 同批「跨桌面查岗」按钮锚点（删＝跨桌面查岗只能等概率）', file: 'template.html', needle: 'id="more-xck-now"' },
  { name: '#1003d ta-invite 按类型抽卡出口（删＝贴贴按钮只能退回全类型随机，「点贴贴收到猜拳」复发）', file: 'js/ta-invite.js', needle: 'window.taInvitePickKind = function (kind) {' },
  { name: '#1003e 按类型抽＝只在传入那类启用池里抽（改成全类型池＝同上复发形态）', file: 'js/ta-invite.js', needle: 'return drawFrom(enabledPool(d, [kind]));' },
  { name: '#1003f chat.js 贴贴手动触发口（删＝面板那枚点了没反应）', file: 'js/chat.js', needle: 'window.triggerTaCuddleNow = function () {' },
  { name: '#1003g 贴贴口径：只认 cuddle 池（改成 taInvitePickAny＝用户点贴贴却来猜拳/贪吃蛇）', file: 'js/chat.js', needle: "const inv = window.taInvitePickKind ? window.taInvitePickKind('cuddle') : null;" },
  { name: '#1003h 贴贴按钮接线（删＝面板有按钮但无处理器）', file: 'js/chat.js', needle: "bindTaNow('more-cuddle-now', () => { if (window.triggerTaCuddleNow)" },
  { name: '#1003i 查岗按钮接既有 triggerCkQuestion（同字卡库那枚，题库/冷却/闸门口径一致）', file: 'js/chat.js', needle: "bindTaNow('more-ck-now', () => { if (window.triggerCkQuestion)" },
  { name: '#1003j 跨桌面查岗按钮接线（删＝面板有按钮但无处理器）', file: 'js/chat.js', needle: "bindTaNow('more-xck-now', () => { if (window.triggerIncomingCheckinNow)" },
  { name: '#1003k 跨桌面查岗手动触发口（删＝跨桌面查岗只能等概率/冷却）', file: 'js/incoming-requests.js', needle: 'window.triggerIncomingCheckinNow = function () {' },
  { name: '#1003l 只挑开着查岗且没有未处理申请的其他桌面（删＝已有 pending 的桌面被选中，deliver 静默返回＝点了没反应）', file: 'js/incoming-requests.js', needle: "num(cfgFor(c.id), 'ckq-en', 1) === 1 && !hasPending(c.id)" },
  { name: '#1003m 手动触发仍守全局开关（删＝设置里关着跨桌面查岗也被偷偷触发，违背用户显式设定）', file: 'js/incoming-requests.js', needle: "_toast('联系人跨桌面查岗已关闭，可在 设置 里开启')" },
  { name: '#1003n 删除型：贴贴按钮不得退回全类型随机邀请（用户点贴贴收到猜拳＝本批要根治的形态）', file: 'js/chat.js', absent: true, needle: "bindTaNow('more-cuddle-now', () => { if (window.triggerTaInviteNow)" },
  { name: '#1003o 功能大全里能搜到新的手动触发（删＝用户在搜索里找不到这三枚）', file: 'js/feature-hub.js', needle: "'#more-xck-now'" },
  { name: '#1001a 上个后台会话被系统丢弃/关闭时当面提示（删＝这条实锤只剩诊断里，用户又把「回来自动刷新」当 bug）', file: 'js/bg-keep.js', needle: '上次挂着后台的那段会话被系统丢弃/关闭了' },
  { name: '#1001b 通知开关开着但权限待决时当面提示（删＝开关亮着却不弹窗，用户报「开关坏了」）', file: 'js/bg-keep.js', needle: '但浏览器还没给通知权限' },
  { name: '#1001c 设置行红条写明「开着保活/通知不会在后台自动换新版」（删＝用户把「不自动更新」当更新坏了）', file: 'template.html', needle: '开着「后台保活」或「后台通知」时，页面不会在后台自动换新版' },
  { name: '#1001d 功能说明保活胶囊补同章（删＝只在一处口径，用户翻功能说明看不到）', file: 'js/settings-help.js', needle: '【开着保活时不会在后台自动换新版】' },
  { name: '#1001e 使用说明「前提 2 · 通知权限」补权限待决口径（删＝与 #988 起「开关保持开启」的实际行为不符）', file: 'template.html', needle: '如果你还没在弹窗里做出选择（弹窗挂着没点、或直接切走了），开关会保持开启并提示你去允许' },
  { name: '#978a 回场重对齐入口（删＝回场贴底退回一次性裸写，撕裂态永修不回）', file: 'js/chat.js', needle: 'function chatResumeRealign() {' },
  { name: '#978b 回场重对齐落定枪（删＝几何风暴中途写 scrollTop，撕裂源回归）', file: 'js/chat.js', needle: 'function chatResumeRealignStep() {' },
  { name: '#978c 回场落定后无条件同值重落（删＝健康态/撕裂态都不再重对齐）', file: 'js/chat.js', needle: 'if (chatPinnedBottom) scrollChatBottom(); // 同值重落' },
  { name: '#978d 旧「回场 350ms 当场裸写」已拆（删除型）', file: 'js/chat.js', absent: true, needle: 'if (chatScrollMax() - body.scrollTop > 8) { scrollChatBottom(); chatEntrySettle(); }' },
  { name: '#1004b 渲染窗起点越界按最新 RENDER_MAX 重开（删＝窗口起点 ≥ 长度时整页空白无提示）', file: 'js/chat.js', needle: 'if (clampTop || renderStart >= len) renderStart = Math.max(0, len - RENDER_MAX);' },
  { name: '#1004c 构建期迟到消息换装后按到达顺序补挂（退回写进 fragment＝新消息埋进窗口中间/随作废轮丢条）', file: 'js/chat.js', needle: 'if (myDefer.q.length) {\nfor (let q = 0; q < myDefer.q.length; q++) body.appendChild(myDefer.q[q]);' },
  { name: '#1004e 记录位空洞自愈（删＝被跳过的下标不再重画，空洞永留）', file: 'js/chat.js', needle: 'function armWindowHoleHeal(idxs) {' },
  { name: '#1008a 桌面边看边调抽屉标题行可拖动（删＝退回 #562 只留声明、grip 纯装饰的「拖不动」态，用户实报面）', file: 'js/personalize.js', needle: 'beautyDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));' },
  { name: '#1008b 桌面抽屉默认位停在底部导航之上（删/改回 bottom:0＝z-index:95 的抽屉压住 z-index:2 的底部导航，开着它切不了页）', file: 'js/personalize.js', needle: "d.style.bottom = (beautyDockBot == null ? beautyDrawerReserve() : beautyDockBot) + 'px';" },
  { name: '#1008c 桌面抽屉标题行接线（标题行才是主拖拽把手，删＝只剩 4px 的 grip 能拖）', file: 'js/personalize.js', needle: 'bindDrawerDrag(hd);' },
  { name: '#1008d 屏幕适配面板落位带过渡（删＝切页时留白跳变 90px→14px 又变硬切瞬移，用户「切换设置和设置美化还是会闪屏」的实测面）', file: 'js/personalize.js', needle: 'gap:6px;transition:bottom .16s ease' },
  { name: '#1008e 桌面抽屉点亮态只在真变化时写（删＝重复点同一分区又白写 3×N 个 style，口径同 #938）', file: 'js/personalize.js', needle: 'const paintChips = (key) => {' },
  { name: '#1008f 桌面抽屉标题行写明可拖动（删＝用户「并不知道有这个功能」原话复发）', file: 'js/personalize.js', needle: "hdHint.textContent = '按住标题行上下拖 · 让开看桌面';" },
  { name: '#1008g 聊天边看边调抽屉标题行写明可拖动（#760 早就实现了拖动但界面一字未提，用户直派写清）', file: 'js/chat-settings.js', needle: "hdHint.textContent = '按住标题行上下拖 · 让开看聊天';" },
  { name: '#1008h 聊天抽屉落位带过渡（删＝拖动松手吸附 / 键盘抬升变硬切）', file: 'js/chat-settings.js', needle: "d.style.transition = 'bottom .16s ease';" },
  { name: '#1008i 聊天抽屉点亮态只在真变化时写（删＝重复点同一分区又白写 3×N 个 style）', file: 'js/chat-settings.js', needle: 'const paintCsChips = (key) => {' },
  { name: '#1008j 群聊边看边调抽屉补拖动（删＝同族只改一半：单聊能拖、群聊拖不动）', file: 'js/group-chat.js', needle: 'gcDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));' },
  { name: '#1008k 群聊抽屉标题行接线（删＝群聊侧又只剩装饰 grip）', file: 'js/group-chat.js', needle: 'bindGcDockDrag(hd);' },
  { name: '#1008l 群聊抽屉标题行写明可拖动（删＝群聊侧又变成「有这个功能但没人知道」）', file: 'js/group-chat.js', needle: "hdHint.textContent = '按住标题行上下拖 · 让开看群聊';" },
  { name: '#1008m 桌面美化页入口副标题写明标题行可拖（删＝开面板前看不到这个能力，用户「需要新增并写清楚」的一半）', file: 'template.html', needle: '桌面在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位' },
  { name: '#1008n 聊天美化入口副标题写明标题行可拖（删＝聊天侧开面板前看不到这个能力）', file: 'js/chat-settings.js', needle: '聊天在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位' },
  { name: '#1008o 群聊美化入口副标题写明标题行可拖（同族一致，删＝群聊侧入口又不说）', file: 'js/group-chat.js', needle: '群聊在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位' },
  { name: '#1008p 使用提示「手机桌面美化」写明抽屉与拖动（删＝设置页功能说明里查不到这个能力）', file: 'js/settings-help.js', needle: '抽屉的标题行可以按住往上拖' },
  { name: '#1008q 群聊抽屉点亮态只在真变化时写（同族一致）', file: 'js/group-chat.js', needle: 'const paintGcChips = (key) => {' },
  { name: '#1005a 问卷卡点一下浮现收藏心形（删＝心形永远看不到＝整卡收藏入口消失，用户主诉回归）', file: 'js/chat.js', needle: "if (!sHadFav) surveyCard.classList.add('show-fav');" },
  { name: '#1005b 点卡片外的收起守卫认得问卷卡（删＝点心形以外任何地方都不收心形，.show-fav 只增不减）', file: 'js/chat.js', needle: "'.msg-ask-card, .msg-choose-card, .msg-survey-card, .msg-fav-heart, .msg-inplace'" },
  { name: '#1005c 问卷卡提示行尾的可点暗示箭头（删＝卡片看不出能点，用户直派的「需要暗示这个卡片可以点击」回归）', file: 'js/chat.js', needle: '<span class="msg-survey-chev">' },
  { name: '#1005d 问卷卡心形浮现样式（删＝加了 .show-fav 也浮不出来，心形仍是 display:none）', file: 'css/chat-main.css', needle: '.msg-survey-card.show-fav .msg-fav-heart' },
  { name: '#1005e 问卷卡按压反馈（删＝点下去没有任何视觉回馈）', file: 'css/chat-main.css', needle: '.msg-survey-card:active' },
  { name: '#1006a 小问题 cs5 选项「猜你下一张字卡」（字卡是 TA 挑的；改回「猜我」＝选项又站到 TA 视角）', file: 'js/ta-ask.js', needle: '{ t: "悬疑——猜你下一张字卡", reply: ["你猜中的次数，其实不多"' },
  { name: '#1006b 小问题 cd17「我」主句回到用户先醒的角色（删/改回「那我看着你睡」＝TA 抢了看的人）', file: 'js/ta-ask.js', needle: '{ t: "我", reply: ["那你看着我睡","你先醒？那看我睡"' },
  { name: '#1006c 小问题 cd6 选项「你」＝TA 先说晚安（改回「好，我等你先说」＝角色互换复发）', file: 'js/ta-ask.js', needle: '{ t: "你", reply: ["好，那我先说","我先说？那我定个闹钟"' },
  { name: '#1006d 小问题 cd14「你做饭我看着」的 TA 回应（改回「那我看你」＝看与被看互换复发）', file: 'js/ta-ask.js', needle: '"看着也行，那你看着我"' },
  { name: '#1006e 小问题 cw6 转述用「笑我？」（改回「笑你？」＝被笑的人写成用户）', file: 'js/ta-ask.js', needle: '"笑我？那我不客气了"' },
  { name: '#1006f 好奇库 cw6 快答「跟着我走」（改回「跟着你走」＝用户自答又站到 TA 视角）', file: 'js/ta-ask.js', needle: "quick: ['床头', '书桌边', '窗边', '跟着我走']" },
  { name: '#1006g 好奇库快答迁移表带上这条（删＝已装用户的固化快答拿不到修正）', file: 'js/ta-ask.js', needle: "cw6: { '跟着你走': '跟着我走' }," },
  { name: '#1006h 查岗方口吻新卡（删＝「联系人对我查岗」组只剩 4 张，回应重复感明显）', file: 'js/default-cards-data.js', needle: '"原来你在这儿，那我不找了"' },
  { name: '#1006i 查岗方口吻新卡（删＝「联系人对我查岗」组只剩 4 张，回应重复感明显）', file: 'js/default-cards-data.js', needle: '"问这一句，其实只是想你了"' },
  { name: '#1006j 心意币碎碎念回到 TA 第一人称（改回「TA 的心意币变多了」＝同池口吻自相矛盾）', file: 'js/p2-features.js', needle: "'你的心意币变多了'" },
  { name: '#1006k 喝水播报用「你今天喝了」（改回「我今天喝了」＝TA 说成自己喝的水）', file: 'js/p2-features.js', needle: "'你今天喝了 ' + t.count + ' / ' + g + ' 杯" },
  { name: '#1006l 存钱罐「回一句给TA」走用户发送侧（改回 chatAddIn＝用户的话又落在 TA 气泡）', file: 'js/p2-features.js', needle: "if (t && window.chatSendMsg) { try { window.chatSendMsg(t); } catch (e) {} toast('已回复'); }" },
  { name: '#1006m 吃什么「问 TA」走用户发送侧（改回 chatAddIn＝变成 TA 问用户）', file: 'js/p2-features.js', needle: 'if (window.chatSendMsg) { try { window.chatSendMsg(msg); }' },
  { name: '#1006n 摸鱼小结信 TA 口吻（改回「你俩…（我 +x · 名字 +y）」＝TA 把自己算在外、把用户标成「我」）', file: 'js/mail.js', needle: "'你和我一共摸鱼 ' + totalFish + ' 点（你 +' + fm + ' · 我 +' + ft + '）。'" },
  { name: '#1006o 市集标语送给 TA（改回「送给你」＝收礼人写成用户）', file: 'js/gift-shop.js', needle: '挑一份心意，跨越两个世界送给 TA' }
];
try {
  const built = CHECK_SENTINELS ? '' : readFileSync(join(root, 'index.html'), 'utf8');
  // v3.27.x：--check-sentinels 下产物是旧的（还没构建），缺失判定全部跳过，
  // 只做 src 锚点核对——覆盖修复的根源在 src 被删，产物判定留给真正构建时。
  // v3.26.x #214：pwa/ 产物（manifest.json 等）不进 index.html，产物检查改读根目录对应文件
  const artifactText = function (s) {
    if (s.file && s.file.indexOf('pwa/') === 0) {
      try { return readFileSync(join(root, s.file.slice(4)), 'utf8'); } catch (e) { return ''; }
    }
    // PERF-PLAN 阶段 1：外置文件的哨兵改读 js/<file> 对应产物（外置后这些 needle 不在 index.html）
    if (s.file && s.file.indexOf('js/') === 0 && extSet.has(s.file.slice(3))) {
      try { return readFileSync(join(root, 'js', s.file.slice(3)), 'utf8'); } catch (e) { return ''; }
    }
    return built;
  };
  const missing = CHECK_SENTINELS ? [] : FIX_SENTINELS.filter(s => !s.absent && !artifactText(s).includes(s.needle));
  const leaked = CHECK_SENTINELS ? [] : FIX_SENTINELS.filter(s => s.absent && artifactText(s).includes(s.needle));
  // v3.26.x #100：产物缺失时再对照源文件——「src 里也没有」和「src 有但产物没有」
  // 是两种完全不同的故障（前者修复真被覆盖、后者是漏接入构建或被旧缓冲回写），
  // 处置路径不一样，以前只有一句「请确认修复是否仍有效」，全靠人猜。
  // needle 含 \n 的是压缩后的多行特征（源文件带缩进/空行），按行分段判。
  const srcState = function (s) {
    if (!s.file || s.file === 'index.html') return null;
    let src;
    try { src = readFileSync(join(root, 'src', s.file), 'utf8'); } catch (e) { return 'nofile'; }
    return s.needle.split('\n').every(function (seg) { return src.includes(seg); });
  };
  // v3.26.x #100：「哑哨兵」体检——两种真正拦不住回归的登记方式。
  // A 锚点指错地方：登记的 file 是某个 src 源文件，但该 needle 在那个文件里根本不存在，
  //   它能报绿纯粹靠产物里别处的同名文本 → 把这个文件的修复整块删掉也不会报警。
  //   （实测踩过：needle `window.__jsErrors = window.__jsErrors || []` 在 chat.js 也有
  //   一份，把 device.js 的初始化整行删掉，146/146 仍然全绿。）
  // B 一条 needle 被多条登记共用：两条互相掩盖，出问题时也分不清是哪次修复丢了。
  // 注：不再按「产物内出现次数 ≥2」报警——那是噪音（实测 70 条），同名文本多处出现
  // 通常仍会随守卫一起消失，拦得住。只警告不置失败码，登记人把锚点收到唯一即可。
  const dead = [];
  const misanchored = FIX_SENTINELS.filter(function (s) {
    if (s.absent || !s.file || s.file === 'index.html') return false;
    const st = srcState(s);
    if (st === 'nofile') { dead.push(s); return false; }
    return st === false;
  });
  const byNeedle = {};
  FIX_SENTINELS.forEach(function (s) { (byNeedle[s.needle] = byNeedle[s.needle] || []).push(s.name); });
  const shared = Object.keys(byNeedle).filter(function (k) { return byNeedle[k].length > 1; });
  // C 针在注释里：needle 在 src 里存在，但只写在整行注释里（minifyJs 丢整行 `//`、
  //   minifyCss 丢块注释）→ 压缩后产物永远不可能命中，构建恒定失败却看不出谁的问题。
  //   做法是把登记的那个 src 文件按对应压缩函数走一遍再比对（多行 needle 跳过：
  //   多行按「压缩后的相邻行」写，逐段判由上面的锚点检查负责）。
  const lostInMinify = FIX_SENTINELS.filter(function (s) {
    if (s.absent || !s.file || s.file === 'index.html' || s.needle.indexOf('\n') >= 0) return false;
    let src;
    try { src = readFileSync(join(root, 'src', s.file), 'utf8'); } catch (e) { return false; }
    if (!src.includes(s.needle)) return false; // 文件里根本没有＝上面的「锚点指错」已经报了
    // v3.26.x #214：非 js/css（pwa/manifest.json 等）不走压缩，原样比对
    const min = /\.css(\||$)/.test(s.file) ? minifyCss(src) : (/\.js(\||$)/.test(s.file) ? minifyJs(src) : src);
    return !min.includes(s.needle);
  });
  if (misanchored.length || shared.length || dead.length || lostInMinify.length) {
    console.warn('⚠️  哑哨兵 ' + (misanchored.length + shared.length + dead.length + lostInMinify.length) + ' 条（拦不住回归，请把 needle 收到「该源文件里唯一」）：');
    misanchored.forEach(function (s) {
      console.warn('   · 锚点指错：[' + s.name + '] 登记的 ' + s.file + ' 里找不到 needle "' + s.needle + '"（产物里是靠别处同名文本过的检）');
    });
    lostInMinify.forEach(function (s) {
      console.warn('   · 针在注释里：[' + s.name + '] needle "' + s.needle + '" 在 src/' + s.file + ' 里只出现在注释中，压缩后必丢（产物永不命中，换成同行代码特征）');
    });
    dead.forEach(function (s) {
      console.warn('   · 死锚点：[' + s.name + '] 登记的 src/' + s.file + ' 已不存在（文件改名/下线，needle 与修复脱钩）');
    });
    shared.forEach(function (k) {
      console.warn('   · 共用 needle "' + k + '"：' + byNeedle[k].map(n => '[' + n + ']').join(' '));
    });
    // v3.27.x：--check-sentinels 的核心职责——src 锚点缺失 = 修复可能被覆盖，
    // 这正是「修好 A 修 B 时 A 被整块删掉」的直接证据，必须让非构建者当场看到失败。
    if (CHECK_SENTINELS && misanchored.length) {
      console.error('❌ [--check-sentinels] src 锚点缺失 ' + misanchored.length + ' 条——对应修复可能已被覆盖/删除：');
      misanchored.forEach(function (s) {
        console.error('   · [' + s.name + '] 应存在于 src/' + s.file + ' 的 "' + s.needle + '"（若你改过该文件，回查是不是整块重写把它抹了）');
      });
      process.exitCode = 1;
    }
  } else {
    console.log('✅ 哑哨兵体检 0 条（每条 needle 都在自己登记的那个 src 文件里、且无共用锚点）');
  }
  const hintOf = function (s) {
    const st = srcState(s);
    if (st === null) return '';
    if (st === 'nofile') return ' ← 源文件 src/' + s.file + ' 不存在（被改名/删除？哨兵登记要跟着改）';
    if (!s.absent) return st ? ' ← src 里仍在＝产物没接入（查 build.mjs 的 jsFiles/cssFiles，或产物被旧缓冲覆盖）' : ' ← src 里也没有＝修复真丢了，去 src/' + s.file + ' 补回';
    return st ? ' ← src 里也回来了＝删除被改回' : ' ← 只有产物里有＝产物比 src 旧，重新构建';
  };
  if (missing.length || leaked.length) {
    if (missing.length) {
      console.error('❌ 关键修复哨兵检查：以下 ' + missing.length + ' 项特征在产物中缺失（修复被覆盖/未接入）：');
      missing.forEach(s => console.error('   · [' + s.name + '] 应含 "' + s.needle + '"（' + s.file + '）' + hintOf(s)));
    }
    if (leaked.length) {
      console.error('❌ 删除型修复哨兵：以下 ' + leaked.length + ' 项「应不存在」的特征又回来了（移除被并行改动/旧缓冲覆盖）：');
      leaked.forEach(s => console.error('   · [' + s.name + '] 不应含 "' + s.needle + '"（' + s.file + '）' + hintOf(s)));
    }
    console.error('   哨兵是回归防线的最后一道——请逐条确认后再提交（对应 verify-xxx.mjs 可补跑复核）。');
  } else if (CHECK_SENTINELS) {
    // 覆盖判定在上面哑哨兵体检已报红；这里只给 src 锚点核对的全绿汇总
    console.log('✅ [--check-sentinels] src 修复锚点全部在位（' + FIX_SENTINELS.length + ' 条，产物未构建按旧版核对）');
  } else {
    console.log('✅ 关键修复哨兵 ' + FIX_SENTINELS.length + '/' + FIX_SENTINELS.length + ' 全部在位（修复无丢失）');
  }
  // v3.26.x #100：哨兵必须能让构建失败。此前全文件没有一次 exit，
  // 警告只在人眼里、CI 里永远是绿的——「修复被静默覆盖」正是这套防线要拦的事。
  // 放在最后：产物此时已写盘，失败不会留下半成品产物。
  // v3.27.x：--check-sentinels 下同样置 1（src 锚点缺失在上面已置），让非构建者当场看到失败。
  if (missing.length || leaked.length) process.exitCode = 1;
} catch (e) {
  console.error('❌ 哨兵检查未能执行（产物读不到？）：' + (e && e.message));
  process.exitCode = 1;
}
// v3.27.x：--check-sentinels 不核对 sw.js 产物（那是构建复制出来的，旧版本来就可能不匹配），
// 只核对 src/pwa/sw.js 里作为源的修复锚点——防覆盖的核心是源码不被删。
if (CHECK_SENTINELS) {
  try {
    const swSrc = readFileSync(join(root, 'src', 'pwa', 'sw.js'), 'utf8');
    const swNeedlesSrc = [
      // v3.26.x #136：canonical 键 miss 后 second chance match(req)（接住存量 req.url 键缓存）
      'caches.open(CACHE).then((c) => c.match(\'./index.html\')).then((m) => m || caches.match(req))',
      'claim 后异步补一次 fetch 写入当前 CACHE',
      'sort((a, b) => cacheVersion(b) - cacheVersion(a))',
      // v3.26.x #136：导航成功写 canonical 键 + activate 抢救旧缓存完整 index
      "c.put('./index.html', res.clone())",
      'rescued ? c.put(\'./index.html\', rescued)',
      // v3.26.x #143：最终重试写点仅限导航 + 兜底命中 content-type 守卫（防 PNG 污染 canonical 键）
      "res.ok && req.mode === 'navigate'",
      "m.headers.get('content-type')",
      // v3.26.x #157：导航缓存优先+后台静默刷新 + index 专属长超时（修 standalone 快捷方式
      // 网络优先 3.5s 对 4MB 产物必然超时 → 反复刷新打不开）
      "const navCached = req.mode === 'navigate'",
      'INDEX_NETWORK_TIMEOUT = 30000',
      'fetchIndexRes(url, isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)',
      "fetchIndexRes('./index.html', INDEX_NETWORK_TIMEOUT)",
      'fetchIndexRes(u, isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)',
      // FIX 2026-09-10 #280：媒体池令牌裸路径（@@m:）本地快速 404，禁止发真实网络请求
      'u.pathname.indexOf(\'@@m:\') >= 0'
    ];
    const swMiss = swNeedlesSrc.filter(n => !swSrc.includes(n));
    if (swMiss.length) {
      console.error('❌ [--check-sentinels] sw.js 源锚点缺失 ' + swMiss.length + ' 条（src/pwa/sw.js 修复被覆盖）：');
      swMiss.forEach(n => console.error('   · 应含 "' + n + '"'));
      process.exitCode = 1;
    } else {
      console.log('✅ [--check-sentinels] sw.js 源锚点 ' + swNeedlesSrc.length + '/' + swNeedlesSrc.length + ' 在位');
    }
  } catch (e) { console.error('❌ [--check-sentinels] sw.js 源检查失败：' + (e && e.message)); process.exitCode = 1; }
} else {
// v3.27.x：sw.js 专项哨兵（导航回退优先当前 CACHE + activate 补 fetch 自愈，防被并行会话覆盖）
try {
  const swSrc = readFileSync(join(root, 'sw.js'), 'utf8');
  const swNeedles = [
    // v3.26.x #136：canonical 键 miss 后 second chance match(req)（接住存量 req.url 键缓存）
    'caches.open(CACHE).then((c) => c.match(\'./index.html\')).then((m) => m || caches.match(req))',
    'claim 后异步补一次 fetch 写入当前 CACHE',
    'sort((a, b) => cacheVersion(b) - cacheVersion(a))',
    // v3.26.x #134：index.html 完整性校验（截断体不进缓存）+ PURGE_INDEX 自愈消息
    'function isCompleteHtml(text)',
    "data.type === 'PURGE_INDEX'",
    // v3.26.x #136：导航成功写 canonical 键 + activate 抢救旧缓存完整 index
    "c.put('./index.html', res.clone())",
    'rescued ? c.put(\'./index.html\', rescued)',
    // v3.26.x #143：最终重试写点仅限导航 + 兜底命中 content-type 守卫（防 PNG 污染 canonical 键）
    "res.ok && req.mode === 'navigate'",
    "m.headers.get('content-type')",
    // v3.26.x #157：导航缓存优先+后台静默刷新 + index 专属长超时
    "const navCached = req.mode === 'navigate'",
    'INDEX_NETWORK_TIMEOUT = 30000',
    'fetchIndexRes(url, isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)',
    "fetchIndexRes('./index.html', INDEX_NETWORK_TIMEOUT)",
    'fetchIndexRes(u, isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)',
    // FIX 2026-09-10 #280：媒体池令牌裸路径（@@m:）本地快速 404，禁止发真实网络请求
    "u.pathname.indexOf('@@m:') >= 0"
  ];
  const swMissing = swNeedles.filter(n => !swSrc.includes(n));
  if (swMissing.length) {
    console.error('❌ sw.js 关键修复哨兵：以下特征缺失（修复可能被覆盖）：');
    swMissing.forEach(n => console.error('   · 应含 "' + n + '"'));
    process.exitCode = 1; // v3.26.x #100：同主哨兵，缺失必须让构建失败
  } else {
    console.log('✅ sw.js 哨兵 ' + swNeedles.length + '/' + swNeedles.length + ' 在位');
  }
  } catch (e) { console.error('❌ sw.js 哨兵未能执行：' + (e && e.message)); process.exitCode = 1; }
}
