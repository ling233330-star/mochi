// ===== 组装脚本 =====
// 把 src/ 下的模板 + 按页面拆分的 CSS + 按功能拆分的 JS
// 拼装成单个可直接双击打开的 index.html（完整功能）。
// 用法：在 mochi 目录下运行  node build.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
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
// v3.26.x：自动从 git 提交数生成（v3.26.<提交数>）——此前手动维护 APP_VERSION，
// 与提交 message 里的版本号经常不同步（混用 v3.5.x/v3.6.x）。现在每次提交后构建，
// 版本号自动 +1、永不需要人工对齐；提交 message 前缀保持 v3.26.x 系列即可。
// ⚠️ 版本系列升级时（如 v3.26 → v3.27）把下面的前缀一起改掉，与提交 message 对齐。
// 2026-09-11：仓库历史重置为单提交（AI 协作台账移出公开库），提交数从 560 骤降，
// 加 VERSION_BASE 基数保持版本号连续不倒退（SW 缓存刷新依赖版本单调递增）。
// 非 git 环境（脚本被拷贝/CI 无 git）回退 v3.26.0 兜底。
const VERSION_BASE = 559;
let APP_VERSION = 'v3.26.0';
try {
  const cnt = execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (cnt && /^\d+$/.test(cnt)) APP_VERSION = 'v3.26.' + (VERSION_BASE + parseInt(cnt, 10));
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
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css', 'applock.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'applock.js', 'card-lock.js', 'media-pool.js', 'storage-slim.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'dict-ext-data.js', 'default-cards.js', 'quote-spell.js', 'dream-free.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'incoming-requests.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'gomoku.js', 'linkup.js', 'match3.js', 'auction.js', 'arcade.js', 'mood-diary.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'feature-hub.js', 'mobile-adapt.js'];

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
const jsWrapped = jsFiles.map(f => {
  const code = minifyJs(read(join('js', f)));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
});
// 按 UTF-8 字节上限拆 script 块（iOS 15 单块解析崩溃防护，见上方注释）
const scriptChunks = chunkScripts(jsWrapped);

// v3.15.x：改用函数返回值注入——字符串替换会把包内 $&/$'/$` 当特殊模式处理，
// 源码里出现这些序列（正则/模板片段）时产物被静默撑爆+残留占位符（2026-08-26 实测踩坑）
html = html.replace('/*__STYLES__*/', () => styles);
// v3.27.x：多块注入——第一块沿用模板内既有 <script>，后续块用 </script><script> 分隔，
// 每个功能文件仍是独立 IIFE+try/catch，块间顺序执行语义不变
html = html.replace('/*__SCRIPTS__*/', () =>
  scriptChunks.map((c, i) => (i === 0 ? c.join('\n') : '</script>\n<script>' + c.join('\n'))).join('\n')
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

if (!CHECK_SENTINELS) {
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
  { name: '#393 群聊模式下装修组件库显式加回占卜写意图标记（删掉＝退出装修即被收池，「装修拉出来也加不上」复发）', file: 'js/personalize.js', needle: "set('divination-desk-pin', '1')" },
  { name: '#393 applyGroupChatMode 读占卜意图标记豁免强制收池（删掉条件＝群聊开启期间用户加回的占卜被重新收回）', file: 'js/personalize.js', needle: "get('divination-desk-pin') === '1'" },
  { name: '#393 装修组件库摸鱼小组件命名含「摸鱼」（原「周末倒计时」无摸鱼字样搜不到＝「缺少摸鱼小组件」）', file: 'js/personalize.js', needle: "weekend: '摸鱼倒计时（周末）'" },
  { name: '#390 TA的心情分享 10% 概率 tag 显示「你的心情」（TA 有时发这张卡实为想问对方心情，tag 恒「TA的心情」表达不清；概率分支删掉即回归）', file: 'js/chat.js', needle: "? '你的心情' : 'TA的心情';" },
  { name: '#145 聊天表情按钮再点关闭（window.closeEmojiPanelForInsert 导出，群聊切换关闭复用）', file: 'js/chat.js', needle: 'window.closeEmojiPanelForInsert' },
  { name: '#145 群聊表情按钮再点关闭（面板已开先关不重开）', file: 'js/group-chat.js', needle: 'window.closeEmojiPanelForInsert &&' },
  { name: '#149 引用块缩略图认媒体池令牌（对象引用 imgs 过滤：data: 或 @@m: 令牌，令牌交 media-pool 观察器解图；删掉缩略图又消失）', file: 'js/chat.js', needle: "const isQM = (s) => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s)));" },
  { name: '#149 纯图片引用（字符串载荷）令牌也渲染成缩略图', file: 'js/chat.js', needle: "q.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(q))" },
  { name: '#149 引用快照识别令牌化图片消息（quoteTextOf 图片载荷判定含 @@m: 令牌，否则引用不出图+令牌串进 quote 文本）', file: 'js/chat.js', needle: "/^https?:\\/\\//i.test(s) || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))" },
  { name: '#149 引用文本清洗不直出令牌串（quoteTextSafe 令牌→空，防 @@m:hash 铺进引用块/引用预览条）', file: 'js/chat.js', needle: 'window.mochiMediaIsToken(str)' },
  { name: '#127 单聊点发送不收输入法（mousedown preventDefault 防焦点被按钮抢走）', file: 'js/chat.js', needle: "send.addEventListener('mousedown', (e) => { e.preventDefault(); });" },
  { name: '#127 群聊点发送不收输入法（同单聊）', file: 'js/group-chat.js', needle: "sendBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });" },
  { name: '定期备份提醒条存在（backup-remind-bar，受保护产品功能，见 AGENTS.md 数据与存储约定）', file: 'js/pwa.js', needle: "getElementById('backup-remind-bar')" },
  { name: '定期备份提醒条锚点存在（template.html）', file: 'template.html', needle: 'backup-remind-bar' },
  { name: '备份提醒冷却收短到 2 天（每 2-3 天弹一次；改动 INTERVAL 即消失，防被 7 天冷却静默压制）', file: 'js/pwa.js', needle: 'const INTERVAL = 2 * DAY;' },
  { name: '#355b 备份提醒条「单独备份聊天」按钮存在（template.html）', file: 'template.html', needle: 'id="backup-remind-chat"' },
  { name: '#355b 仅聊天记录导出不更新全量备份时间（data-backup.js cfg.mode!==chat 守卫，逻辑锚）', file: 'js/data-backup.js', needle: "if (cfg.mode !== 'chat')" },
  { name: '#356 收藏页媒体池令牌渲染（收藏令牌化后 @@m:hash 按图片出，不再把令牌串当文字直出＝不明代码；判定表达式改掉即消失）', file: 'js/chat.js', needle: "f.text.indexOf('data:image/') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(f.text))" },
  { name: '#357 语音播放挂载 DOM（playVoiceInChat 挂到 body 再 play、停播即卸；删则安卓 WebView 未挂载 Audio 静默空放/播放失败，收藏与聊天语音同链路复发）', file: 'js/chat.js', needle: "if (!a.parentNode) { a.style.display = 'none'; document.body.appendChild(a); }" },
  { name: '#358 跨桌面投递空库账本矛盾守卫（探测说谎时 writeArr([一条]) 会把该联系人全部历史覆盖成一条＝旧记录只剩互动卡片；守卫函数删掉即消失）', file: 'js/chat.js', needle: 'function deskAppendMissGuard(cid, tries, onRetry, writeOne)' },
  { name: '#358 loadMsgs 空库二次复核（账本缺失时单次探测说谎会把 LS 有损快照晋升为权威顶掉老历史；2.5s 双复核删掉即消失）', file: 'js/chat.js', needle: 'function enterConfirmedEmpty() {' },
  { name: '#359 发送侧媒体消息去重窗口 8s（表情包/图片发一遍出 2 个＝无反馈补点，2500ms 窗漏放且刷新不收敛；改回 2500 即消失）', file: 'js/chat.js', needle: "if (m.type === 'sticker' || m.type === 'image' || m.type === 'voice') return 8000;" },
  { name: '#360 字卡去重跨分组判重（seen 按分类建不按分组建+对象卡稳定序列化判重；退回「每组各建 seen 按引用比较」即换分组清不出重复，公用/专属两作用域同源复发）', file: 'js/chatcard.js', needle: 'function ccCardDupKey(cat, c) {' },
  { name: '诊断采集与设置页 DOM 解耦（row 在使用处按需判空，错误/环境/长任务/轨迹不因入口 DOM 缺失而失效）', file: 'js/device.js', needle: 'if (!row) return null;' },
  { name: '诊断复制不再 focus 隐藏 textarea（防手机弹输入法+灰屏，ta.focus 删除型守护；needle 收窄到 device.js copyText 的 appendChild(ta);ta.focus(); 上下文——裸 ta.focus(); 在 chat.js/decision.js/divination.js/group-decision.js 合法存在会误报）', file: 'js/device.js', needle: 'appendChild(ta);ta.focus();', absent: true },
  { name: '诊断电量 getBattery 废弃显式降级（不支持时输出一行而非静默消失）', file: 'js/device.js', needle: '无 getBattery 接口' },
  { name: '诊断超长文本引导导出 docx（>8KB 提示剪贴板可能截断，优先导出；#227 txt→docx 同步改锚）', file: 'js/device.js', needle: '建议优先【导出docx】' },
  { name: '诊断 toast 统一 ccToast（diagToast 与 LS 失效 notice 共用元素防互相顶掉）', file: 'js/device.js', needle: 'function ccToast(msg) {' },
  { name: '诊断错误去重按 msg+页面 30s 窗口（防同类错误刷满环形缓冲）', file: 'js/device.js', needle: 'const dupIdx = arr.findIndex(function (it) {' },
  { name: 'iOS 15 拆 script 块（产物多块，防单块超 600KB 触发 WebKit 解析崩溃/白屏）', file: 'index.html', needle: '</script>\n<script>' },
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
  { name: '#151 美化抽屉透明度滑杆统一解析+存百分比整数（不再写 #146 同族小数脏值/不再把存量 90 算成 9000）', file: 'js/personalize.js', needle: "store.set('widget-opacity', String(Math.round(v * 100))); }" },
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
  { name: '冷启动回复池取回自定义字卡（replyScopeGroups 重载 + 就绪判定不再被默认字卡遮蔽）', file: 'js/chatcard.js', needle: 'function replyScopeGroups' },
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
  { name: 'dc-* 开关监听 mochi-wrj-heal 重同步（退出重进设置回退自愈）', file: 'js/default-cards.js', needle: "document.addEventListener('mochi-wrj-heal', function () {\ntry {" },
  { name: '诊断「开关持久化体检」（LS/读取/IDB 三层值 + LS 写探针）', file: 'js/device.js', needle: '开关持久化体检' },
  { name: '自动备份副本已下线：启动时自动清理遗留副本释放空间（purgeLegacySnapshot）', file: 'js/data-backup.js', needle: 'purgeLegacySnapshot' },
  { name: '后台听歌不误报「会员/移出」弹窗（offerRemoveDamagedSong 后台直返不计数 + 回前台 bgResumeFails 清零）', file: 'js/music-player.js', needle: '后台冻结/断流误触发 onerror，不弹「移出」窗不计数' },
  { name: '#117 本地音乐刷新后播放失败（music-file 脏值守卫：plausibleLocalValue 形状校验 + LS 脏值跳过读 IDB + purgeLocalFile 清脏）', file: 'js/music-player.js', needle: 'function plausibleLocalValue(v) {' },
  { name: '聊天昵称与桌面解耦（chatLabel dk=null 只读 cs-lbl-*，不回退桌面键）', file: 'js/chat.js', needle: "chatLabel('cs-lbl-partner', null, 'TA')" },
  { name: '聊天设置昵称行不再显示跟随桌面（未设置显示默认占位）', file: 'js/chat-settings.js', needle: "未设置（默认 TA）" },
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
  { name: '#129 iOS standalone 底部安全区不归零（screen-innerHeight>60 在 standalone 是系统状态栏/Home 指示条而非浏览器工具条，viewport-fit=cover 下 Home 指示条在可视区内，归零会让 tabbar/底部组件不避让被遮；standalone 下摘除属性回落 env() 正确避让）', file: 'js/mobile-adapt.js', needle: "sh - ih > 60 && !d.classList.contains('ios-pwa-standalone')" },
  { name: 'iOS 全屏态 syncVvFit 不再写 --mochi-ios-h（摘除属性回落 100dvh，修全屏下 visualViewport.height 偏小把 .phone 压矮→底部聊天输入栏整体偏上不贴底；同时不超视口不复发 #109 整页上移）', file: 'js/mobile-adapt.js', needle: "d.classList.contains('ios-fs-active') || d.classList.contains('ios-native-fs')" },
  { name: 'iOS 全屏保留桌面顶部状态栏（不再 display:none，修「苹果16 添加到桌面+全屏后桌面顶部 Mochi/时间/电量一行不见被遮挡」；absent 守卫：若出现 .ios-fs-active .phone .statusbar { display:none } 即回归）', file: 'css/base.css', needle: '.ios-fs-active .phone .statusbar { display: none', absent: true },
  { name: '#114(复现) iOS 全屏态顶部安全区统一修复（iPhone15+Safari 主屏幕全屏 env(safe-area-inset-top)=0 → 桌面状态栏与系统栏重叠/聊天返回键被吞点；.phone 改 100vh 铺满物理屏 + padding-top:max(var(--mochi-safe-top,env),12px) 整体下移，修顶部重叠 + 底部 59px 空隙 + iPhone17 Edge 图标截断）', file: 'css/base.css', needle: 'padding-top:max(var(--mochi-safe-top, env(safe-area-inset-top, 0px)), 12px);' },
  { name: '#114(复现) iOS standalone 顶部安全区实测（env(safe-area-inset-top)=0 → 用 screen.height-可视高 实测状态栏高度写 --mochi-safe-top 供 CSS 避让，20-160 过滤干扰）', file: 'js/mobile-adapt.js', needle: "d.style.setProperty('--mochi-safe-top'" },
  { name: '#114(复现) 通话缩略窗顶部安全区避让（落位/拖拽上边界抬到系统状态栏下方，修「缩略窗在顶部动不了」被系统栏吞触点）', file: 'js/call.js', needle: 'y = Math.max(miniSafeTop(), Math.min(window.innerHeight - mh - 4, y))' },
  { name: '后台音乐媒体条不丢（__musicWantPlay 暴露播放意图 + bg-keep 不让位覆盖歌曲媒体条 + onplay 重绑歌曲元数据，修红米K80 Chrome 通知栏媒体条时有时无/挂后台停播）', file: 'js/music-player.js', needle: '__musicWantPlay' },
  { name: '后台补播连续失败改冷却重试（bgResumeFailAt 60s 清零，修「挂后台总是自己停止播放」后无人拉起）', file: 'js/music-player.js', needle: 'bgResumeFailAt' },
  { name: '录音爆音修复（voiceMimePreferOpus：标准安卓 Chrome/Edge 走 webm/opus，修荣耀90 Edge 语音「滋啦滋啦」爆音；iOS/安卓 WebView 仍走 mp4/aac）', file: 'js/chat.js', needle: 'voiceMimePreferOpus' },
  { name: '此间梦角显式归属纠偏（fixBelonging 按 cid 搬回错放梦角，修不同联系人梦角串桌）', file: 'js/cjian.js', needle: 'function fixBelonging' },
  { name: '此间认亲匹配双名字（homeCidForName 同时匹配 TA 昵称与联系人名，修 lbl-partner 与联系人名不一致认不到家）', file: 'js/cjian.js', needle: 'idn === n || cn === n' },
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
  { name: '#119 桌面美化·边看边调抽屉 openBeautyDrawer（切桌面页 + 右侧浮层实时改 CSS 变量）', file: 'js/personalize.js', needle: 'const openBeautyDrawer = () =>' },
  { name: '#119 桌面美化·方案分享 URL shareBeautyLink（base64 hash URL，启动读 #beauty= 自动弹导入）', file: 'js/personalize.js', needle: 'const shareBeautyLink = () =>' },
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
  { name: '#319 cardlock-state 进 migrateLegacy 排除清单（解锁状态全局根键不被迁进 default 并删根键，否则输对密码刷新后闸门仍全锁）', file: 'js/contacts.js', needle: "'cardlock-state'];" },
  { name: '#319 card-lock 存量自愈（被误迁进 default 的解锁状态启动时搬回根键，老用户不用重输密码）', file: 'js/card-lock.js', needle: "localStorage.getItem('xy-home-v2:default:cardlock-state')" },
  { name: '#389 cardlock 解锁状态走 xyStore（写日志+IDB+每键标记+自愈链，修 Edge/荣耀杀进程回滚 localStorage 解锁态退回 locked→密码框重弹，多机型同因零机型分支）', file: 'js/card-lock.js', needle: "addEventListener('mochi-wrj-heal'" },
  { name: '#389 开屏锁卡监听解锁状态事件重渲染（自愈晚到不再显示「输入密码解锁」假象）', file: 'js/clock.js', needle: "addEventListener('mochi-cardlock-open'" },
  { name: '#118 默认字卡三场景使用概率 overallFor（dc-overall-<chat/mail/feed> 未设置回退 dc-overall）', file: 'js/default-cards.js', needle: 'overallFor: gOS' },
  { name: '#118 默认字卡抽卡按场景读概率/开关 drawCards(a, scene)', file: 'js/default-cards.js', needle: 'function drawCards(a, scene)' },
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
  { name: '#100 诊断软/硬双预算首屏标注（原 3s 单保险丝把 IDB 慢机的「最近错误/开关持久化体检/桌面归属体检/IDB 大键明细」整批截成裸「读取中…」，2026-08-30 iPhone 16 Pro 真机诊断实证）', file: 'js/device.js', needle: '未读到（本机存储响应慢，稍后自动补全）' },
  { name: '#100 诊断终态回填直写可见 #modal-textarea + 弹窗判活（ctl.text 的 setter 只写 hidden 的 #modal-input，回填曾静默失效；全站弹窗共用 DOM，关窗后迟到回填会灌进别的弹窗）', file: 'js/device.js', needle: 'if (!modalAlive()) { closed = true; return; }' },
  { name: '#100 诊断角标按最后一条错误时间戳判未读（原存条数，环形写满后新错误永远算不出未读＝角标常暗、错误线索看不见）', file: 'js/device.js', needle: 'const seen = Number(localStorage.getItem(SEEN_KEY)) || 0;' },
  { name: '#100 最近错误环形上限 5→20 且调用栈只给最近 3 条（5 条窗口用户报障时早已刷掉；全带栈会把报障文本撑到剪贴板截断）', file: 'js/device.js', needle: 'const ERR_CAP = 20;' },
  { name: '红米K80 切后台无法自动播下一首回归修复（后台非 NotAllowedError 拒绝不再烧一次性 https 重试链，恢复 scheduleBgResume 退避补播，源短暂恢复即接上）', file: 'js/music-player.js', needle: 'if (document.hidden) {\nbgBrokeAudio = true;\nplayRejected = true;\nscheduleBgResume();' },
  { name: '群聊里用【帮我决定/多人决定】结果发到群聊（gcSendDecisionText 系统消息入群聊消息流 + 群聊更多面板点这两项不切聊天页，修结果错发到聊天）', file: 'js/group-chat.js', needle: 'gcSendDecisionText' },
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
  { name: 'desk-freq-mode 误迁自愈（default 副本写回根键，存量一次性找回；#231 并入 full-beauty-schemes/beauty-undo-stack）', file: 'js/contacts.js', needle: "'full-beauty-schemes', 'beauty-undo-stack']" },
  { name: '#231 完整外观方案/美化撤销栈/更新条记忆键排除 migrateLegacy（漏排除→每刷新被当旧顶层键迁 default 删根键：完整方案列表刷新清空=红米Note12T「保存后恢复初始」多机型同发、同版本更新条每刷新重弹）', file: 'js/contacts.js', needle: "'full-beauty-schemes', 'beauty-undo-stack', 'ver-update-ack-ts', 'ver-update-notify'," },
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
  { name: '#161 响铃挂起写入（holdIncomingCall：后台来电存 call-hold 全局根键+发可接听通知，不再即判未接）', file: 'js/call.js', needle: 'function holdIncomingCall(name, cid, avOverride) {' },
  { name: '#204 挂起接口暴露（callHoldIncoming：跨桌面来电后台命中同走响铃挂起）', file: 'js/call.js', needle: 'window.callHoldIncoming = holdIncomingCall;' },
  { name: '#204 跨桌面后台来电改走挂起（incoming-requests hidden 分支不再只发通知即丢弃）', file: 'js/incoming-requests.js', needle: 'if (window.callHoldIncoming) window.callHoldIncoming(name, req.cid, av);' },
  { name: '#161 挂起恢复（resumeHeldCall：回前台/冷启动有效挂起重响来电，超时补写未接）', file: 'js/call.js', needle: 'function resumeHeldCall() {' },
  { name: '#161 endCall 静默收尾通道（holdSilent 第二参：响铃挂起切后台只清 UI 不写未接）', file: 'js/call.js', needle: 'function endCall(text, holdSilent) {' },
  { name: '#152 聊天「继续说」按钮防键盘收起吞 click（触摸 pointerdown 按下即触发+鼠标排除）', file: 'js/chat.js', needle: "csBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; csFireContinue(); });" },
  { name: '#152 群聊「继续说」按钮防键盘收起吞 click（同单聊 pointerdown+防重入）', file: 'js/group-chat.js', needle: "gcContinueBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; gcCsFireContinue(); });" },
  { name: '#153 后台冻结1分钟(Chromium139 stop-in-background)保活自愈·切后台音频暂停立即补播+最快档重试（防静默窗口跨冻结线整页冻结=后台消息/通知全停）', file: 'js/bg-keep.js', needle: "if (document.visibilityState !== 'hidden') return;" },
  { name: '#153 后台冻结1分钟(Chromium139)保活自愈·隐藏期补播退避封顶20s（前台60s不变，冻结线内保证2~3次重试机会）', file: 'js/bg-keep.js', needle: "if (document.visibilityState === 'hidden' && delayMs > 20000) delayMs = 20000;" },
  { name: '#190/#260 保活音频安卓幅度（0.006→0.02 恢复：#190/#207 底噪根因在 220Hz 频率已换 18kHz，0.0003 电平距 audible 线仅 20% 余量、Edge/Chromium 152 收紧判定即丢冻结豁免=vivo X200s「后台保活失败」；iOS 0.002 bit 级不动）', file: 'js/bg-keep.js', needle: 'kaIsIOS() ? 0.002 : 0.02' },
  { name: '防倒卖回填·远程时效公告bulletin在位判定（notice.json下发text+until过期自动摘除,所有联网副本含二传显示）', file: 'js/clock.js', needle: "(!bulletin.until || Date.now() < bulletin.until)" },
  { name: '防倒卖回填·公告内容变化重写（标题固定「公告」+text 精确比对）', file: 'js/clock.js', needle: "if (box.textContent !== '公告' + want)" },
  { name: '防倒卖第二锚点·pwa.js在位看门狗（clock.js回填被删时的独立兜底,5s补回缺失声明；#315b 起回填插免责卡之后）', file: 'js/pwa.js', needle: "n.insertBefore(mkWatchBar('1', '防骗提醒', W1), dis ? dis.nextSibling : n.firstChild)" },
  { name: '#154 朋友圈评论「我的表情包」与聊天面板同源·暴露chat最新内存副本（IDB权威自愈，修store层旧LS快照/大键挂起导致的两侧不同步）', file: 'js/chat.js', needle: 'window.getMyEmojiGroups = function () { return myGroups || []; };' },
  { name: '#154 朋友圈评论「我的表情包」优先读chat内存副本（chat.js异常时旧store读兜底）', file: 'js/feed.js', needle: 'if (window.getMyEmojiGroups) {' },
  { name: '#156 群聊模式占卜图标强制收隐藏池（任意位置都隐藏，修「群聊开启后桌面占卜图标不消失」——原只在首页图标组原位时才收；#393 起带 !divPin 豁免， needle 同步收窄）', file: 'js/personalize.js', needle: 'if (divBtn && divBtn.parentNode !== pool && !divPin) {' },
  { name: '#156 applyDeskLayout 末尾重应用群聊模式（防 bare 布局应用把占卜从隐藏池按 desk-layout 复活回桌面）', file: 'js/personalize.js', needle: 'try { applyGroupChatMode(); } catch (e) {}' },
  { name: '#157 聊天getPool默认主字卡只在自定义text池空时兜底并入（修dc-overall概率形同虚设,5%设置下联系人基本用默认字卡）', file: 'js/chat.js', needle: "if (catOn('main') && !text.length) {\nconst defGrps" },
  { name: '#157 群聊gcPool主字卡兜底语义对齐聊天页（同#157概率失效修复）', file: 'js/group-chat.js', needle: "if (catOn('main') && text.length === 0) {" },
  { name: '#157 经期温柔前缀/动作随默认字卡总开关停用（修总开关关闭后聊天仍偶发前缀/动作字卡）', file: 'js/period.js', needle: 'if (_dcfg.enabled === false) return text;' },
  { name: '#159 跨桌面来电去掉前台门控（后台命中走 deliver hidden 分支发「XX来电」系统通知，修后台永不弹窗）', file: 'js/incoming-requests.js', needle: 'if (deskCallEn()) {' },
  { name: '#159 跨桌面来电通知 force 通道（与 #150 同口径，绕过 15s 过渡期/去重闸门）', file: 'js/incoming-requests.js', needle: 'avFixed: true, force: true }' },
  { name: '#160 GIF 上传上限砍到 512KB base64（修 iOS 字卡库堆到 62.8MB 每次整库 stringify/parse 秒级长任务卡死；逻辑锚点是数值表达式，改回大上限即消失）', file: 'js/chatcard.js', needle: 'const CC_GIF_MAX_B64 = 512 * 1024;' },
  { name: '#162 贴底钉住态 chatPinnedBottom（程序化滚底置真/用户触摸滚轮解除，修 iPadOS 26 Safari 回消息视图上漂）', file: 'js/chat.js', needle: 'let chatPinnedBottom = true;' },
  { name: '#162 来消息侧滚底 rAF+150ms 复写（原只写一次 scrollTop 被 iPadOS 26 内核顶开）', file: 'js/chat.js', needle: 'requestAnimationFrame(() => { if (chatPinnedBottom) scrollChatBottom(); });' },
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
  { name: '#180 尾巴日志权威就绪后回放（读库成功合并未落盘的最近消息；拆掉 merge 调用此行即消失）', file: 'js/chat.js', needle: 'chatTailMerge(); } catch (e) {} // #180：权威就绪后回放尾巴日志（上次会话未落盘的最近消息）' },
  { name: '#180 LS 快照超限保尾不弃写（折半丢最旧保最近；改回静默 return 此循环即消失）', file: 'js/chat.js', needle: 'while (snap.length > LS_SNAP_LIMIT && snapArr.length > 1 && round < 5)' },
  { name: '#181 气泡 CSS 通用映射导出（单聊/群聊共用；删掉导出则两处注入全瘫）', file: 'js/chat.js', needle: 'window.mochiMapBubbleCss = function' },
  { name: '#181 单聊气泡 CSS 走通用映射（未认出模板类名时整包声明兜底，修上传零变化；换回旧映射此行即消失）', file: 'js/chat-settings.js', needle: "window.mochiMapBubbleCss(css, '')" },
  { name: '#181 群聊气泡 CSS 走通用映射（带 #page-group-chat 作用域，同单聊兜底；换回旧 replace 链此行即消失）', file: 'js/group-chat.js', needle: "window.mochiMapBubbleCss(css, '#page-group-chat ')" },
  { name: '#182 超大库导入·写盘前松开源文本（200MB 级 stringify(groups) 与源文本不得同时钉在堆上）', file: 'js/chatcard.js', needle: "txt = ''; raw = null;" },
  { name: '#182 超大库导入·OOM 识别分流（RangeError/Out of memory 给瘦身指引不报「格式错误」）', file: 'js/chatcard.js', needle: 'rangeerror|out of memory' },
  { name: '#182 超大库导入·FileReader 结果松绑（诊断只留文件头 rawHead；先 slice 再 replace 绝不全文扫描）', file: 'js/chatcard.js', needle: 'reader.onload = null; reader.onerror = null;' },
  { name: '#185 联系人空气泡·回复最终非空兜底（固定回复字卡/默认主字卡为空白时落 FALLBACK，删掉此行空气泡回归）', file: 'js/chat.js', needle: "if (typeof t !== 'string' || !t.trim()) t = pick(FALLBACK_REPLY_POOL);" },
  { name: '#185 联系人空气泡·渲染端空白占位（历史空白记录显示占位而非空壳）', file: 'js/chat.js', needle: 'const __blankMsg = !__rawText.trim();' },
  { name: '#185 删除消息防复活·del 分支同步摘尾巴日志（漏 chatTailDrop 则刷新后 chatTailMerge 把删掉的消息拼回）', file: 'js/chat.js', needle: 'chatTailDrop(msgs[idx]); // FIX 2026-09-05 #185' },
  { name: '#186 表情/图片空白·GC 引用扫描补全（旧正则漏群聊键/LS 快照→清理孤儿媒体误删池数据）', file: 'js/media-pool.js', needle: 'const REFS = /(?:^|:)(?:chat-msgs|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail)$/;' },
  { name: '#186 表情/图片空白·写池失败回滚令牌化（flush 返回 false 不得带令牌 saveMsgs，防令牌入库池数据丢失）', file: 'js/chat.js', needle: 'if (_ok === false) {' },
  { name: '#187 专属字卡串桌面·主动消息跨桌面守卫（tryAutoSend 入口捕获 cid，await 取回后放行前拦截；删掉则 B 桌面触发的主动消息把 B 池专属卡发进 A 桌面聊天）', file: 'js/chat.js', needle: 'const sameAutoCid = () => (window.__activeCid || \'default\') === autoCid;' },
  { name: '#187 专属字卡串桌面·取回后与消息定时器逐层拦截（await 后 + 每条 setTimeout 入口）', file: 'js/chat.js', needle: 'if (!sameAutoCid()) return; // FIX #187 取回期间已切桌面：池子是旧桌面的，整条主动消息放弃' },
  { name: '#188 朋友圈无图·守卫核心探测（idbGet 超时返回 undefined 与键不存在不可分；仅确认权威键确实不存在才放行写回，探测失败按存在处理）', file: 'js/feed.js', needle: "window.idbHasKey(uid + ':' + KEY).then(ok => ok === false)" },
  { name: '#188 朋友圈无图·权威回读写回走守卫（拒写＝权威仍在，增量留内存+10s 有界重读权威恢复完整视图）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(merged)).then(written =>' },
  { name: '#188 朋友圈无图·15s 保险丝写回走守卫（病理窗口 load() 可能只是剥图快照，直写=无图版本永久盖进权威键）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(all))' },
  { name: '#188 朋友圈无图·发布兜底直写走守卫（同上，剥图快照版 list 不得裸写权威键）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(list))' },
  { name: '#188 朋友圈无图·save 未就绪非空直写走守卫（与 persistSnap 相邻=预就绪分支）', file: 'js/feed.js', needle: 'feedGuardWrite(raw);\npersistSnap(arr);' },
  { name: '#188 朋友圈无图·save 就绪后写回走守卫（与清空摘快照分支相邻=post-ready）', file: 'js/feed.js', needle: 'feedGuardWrite(raw);\nif (!arr.length) {' },
  // v3.26.x #189：全屏滑动闪烁 + iPad 全屏开关无效果（三根因五处修复，见 FIX-REGRESSION #189）
  { name: '#189 自愈层复活·healViewport 补 documentElement 声明（v3.26 重写漏写，裸 d=window.d undefined → TypeError 被 try 吞，稳态残留清理/大平移归零/#174 缩放自愈整层静默失效）', file: 'js/mobile-adapt.js', needle: 'var d = document.documentElement; // FIX 2026-09-05 #189' },
  { name: '#189 滑动闪烁·稳态自愈 pin 改条件式（清残留/大偏移才归零；无条件 pin 把全屏覆盖形态下用户滚动每秒拽回顶部=闪烁）', file: 'js/mobile-adapt.js', needle: 'if (_cleanedResidue || winScrollY() > KB_SCROLL_HEAL) pinScrollTop();' },
  { name: '#189 滑动闪烁·全屏底边容差计入 --mochi-safe-top（#179 后 .phone 底边天然超 vv 一个安全区，旧 +24 误判位移每秒归零）', file: 'js/mobile-adapt.js', needle: 'window.innerHeight) + _stT + 24;' },
  { name: '#189 滑动闪烁·全屏态跳过 vv offset 残留判定（iOS 弹性回弹被当平移残留归零=掐断用户手势）', file: 'js/mobile-adapt.js', needle: '!_fsLike() && _vv && (Math.abs(_vv.offsetTop) > KB_SCROLL_HEAL' },
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
  { name: '#236 诊断③浏览器覆盖形态有效顶位（元素顶+实测 padding：该形态 .statusbar 靠自身 padding 抬升、.phone 无 padding 兜底链，单量元素顶恒 0=顶部重叠误报/漏报双向失真）', file: 'js/device.js', needle: 'const sbEffTop = Fm.coverBrowser ? inp.sbTop + (parseFloat(inp.sbPadTop) || 0) : inp.sbTop;' },
  { name: '#236 安卓浏览器覆盖形态执行器（env 探针→共享判定器→写 --mochi-safe-top+挂 mochi-cover-top：执行侧此前整体在 isIOS 分支，安卓壳 #114 形态永无修复；摘除即回归）', file: 'js/mobile-adapt.js', needle: 'var _fc = window.mochiViewportForm({ standalone: false, envTop: _aCoverEnvCache, innerH: _ih, screenH: _sh, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false });' },
  { name: '#236 安卓键盘会话卡死自愈判据（HeyTapBrowser 收键盘 vv 恒卡 inner−底栏：缩幅落残留带 13~22%+inner 回基准+会话超 1.5s+vv 稳 1.2s 才清 _aKb 置 _aVvStale——真键盘缩幅>22% 永不误清）', file: 'js/mobile-adapt.js', needle: '&& Date.now() - _aKbAt > 1500 && Date.now() - _aVvChgAt > 1200' },
  { name: '#236 open 判定残留闩门（_aVvStale 抑制纯 vv 收缩再触发键盘会话，防 652↔720 抖动把 .phone 来回抽；触摸/聚焦/回基准解除）', file: 'js/mobile-adapt.js', needle: 'var open = (!_aVvStale && h < _aH - 60);' },
  { name: '#203 iOS18 保留形态甄别式（standalone+env∈[20,160]+diff≈envTop+iOS≥18，命中即 safeTop 归 0：否则 #179 公式把 .phone 顶出布局视口=居中裁切+文档溢出与 pin 对打=滑动/切换卡顿；#210 起判式收敛到共享判定器，删门槛或改比较符即回归）', file: 'js/device.js', needle: 'diff >= envTop - 8 && iosMajor >= 18' },
  { name: '#203 iOS18 保留形态显式写 0px（摘除属性会回落 env() 变双重避让，Mochi 行上方 59px 空白）', file: 'js/mobile-adapt.js', needle: "var _topPx = _safeTop ? _safeTop + 'px' : (_resStand ? '0px' : '');" },
  { name: '#203 执行器接入共享判定器（syncVvFit 形态判定单一事实源 #210；执行器回退手抄判式此行即消失）', file: 'js/mobile-adapt.js', needle: 'var _f = window.mochiViewportForm(_sig0);' },
  { name: '#203 判定器·保留形态期望底边=inner（.phone 超 inner=文档滚动量；#184 iPad 形态/#186 force 声明同走 inner 分支；#210 起收敛到共享判定器 expBase 单点）', file: 'js/device.js', needle: 'const expBase = (coverBrowser || resStand || ipadForm) ? innerH' },
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
  { name: '#206 表情重复+乱码+空白·回放端拦截旧版存量媒体存根（data:/@@m: 开头无 type 的条目跳过，防 normCell 误迁移成坏图 image）', file: 'js/chat.js', needle: "if (jt.indexOf('data:') === 0 || jt.indexOf('@@m:') === 0) continue;" },
  { name: '#207+#340 保活音频电流声/嗡鸣·频率统一换 18kHz（220Hz 在人耳最敏感频段：#190 降幅度后安卓多机型仍实听嗡声→#207 换 18kHz；#340 iPhone 16 Pro Safari 同根因复发——iOS 忽略 audio.volume，220Hz@0.002 实听比安卓被投诉电平还大 4 倍=「打开一直震动响声重启无用」；iOS 无 Chromium audible 判定，amp 分支不动=电平语义零回归）', file: 'js/bg-keep.js', needle: 'const freq = 18000;' },
  { name: '#208 聊天输入栏上移白边·键盘收起视口未还原自愈（iOS standalone 键盘收起 WebKit 偶发不还原视口，restoreKb 的 60px 还原门槛永不满足=kbActive 卡真 .phone 卡收缩高；失焦>4s 且视口仍<基线−60 强制复原）', file: 'js/mobile-adapt.js', needle: 'Date.now() - _focLostAt > 4000 && _vv && _vv.height < _fullVv - 60' },
  { name: '#208 聊天输入栏上移白边·tabbar 隐藏跳过采集（全屏页 tabs.js 给 tabbar 挂 hidden，矩形全 0 被判悬空 860px 每 5s 刷假错误环）', file: 'js/device.js', needle: 'if (!tb || tb.hidden) return null;' },
  { name: '#208 聊天输入栏上移白边·判定器布局视口未贴底（保留形态 diff 应≈envTop；键盘收起未还原时按 inner 判贴合全绿漏报，单列 ✗ 让白带状态可诊断）', file: 'js/device.js', needle: 'diff > envTop + 24 && !(inp.kb && inp.kb.kbActive)' },
  { name: '#209 输入栏下方灰底断截面·焦点保留硬证据自愈（安卓返回键收键盘不派 blur/#197 族 focusout 丢失时 !foc 复原分支永不执行=停靠残留卡死；可视区双信号回满 ≤12px 即复原，焦点在不在都算键盘已收；推定停靠 _aProv/_iProv 与全屏态不碰）', file: 'js/mobile-adapt.js', needle: 'if (_hNow <= 0 || _hNow < _aH - 12) return;' },
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
  { name: '#132 功能字卡概率·stepper 绑定与 dcfGet（改掉 DCF_DEF 默认表或删 window.dcfGet 暴露即回归——字卡库【其他互动功能字卡】各分类使用概率可显示可调）', file: 'js/default-cards.js', needle: 'window.dcfGet = dcfVal;' },
  { name: '#132 温柔前缀/动作概率接 dcf-period（改回硬编码 Math.random()*100>=25 即回归——经期字卡概率可调）', file: 'js/period.js', needle: 'if (Math.random() * 100 >= _warmP) return text;' },
  { name: '#132 摸鱼浮字/抓包回应概率接 dcf-fish（改回 Math.random()<0.35 硬编码即回归；#224 改经本 IIFE 助手 dcfPFish→window.dcfGet，原锚 dcfP 跨 IIFE 不可见是作用域 bug 本体）', file: 'js/p2-features.js', needle: 'dcfPFish(35)' },
  { name: '#132 吃饭追问关心概率接 dcf-eat（改回硬编码 0.35 即回归）', file: 'js/p2-features.js', needle: "dcfP('eat', 35)" },
  { name: '#132 同频敲三下回应概率接 dcf-sync（改回硬编码 0.6 即回归）', file: 'js/p2-features.js', needle: "dcfP('sync', 60)" },
  { name: '#132 伸手摸到概率接 dcf-reach（改回硬编码 0.55 即回归）', file: 'js/p2-features.js', needle: "dcfP('reach', 55)" },
  { name: '#132 喝水字卡乘法门控接 dcf-water（删 dcfHit 门控行即回归——多档内部节奏不改，0=全关）', file: 'js/p2-features.js', needle: "if (!dcfHit('water')) return;" },
  { name: '#132 花园悄悄话概率接 dcf-garden（改回 Math.random()<0.4 硬编码即回归）', file: 'js/garden.js', needle: "if (Math.random() * 100 < _gP) {" },
  { name: '#132 查岗回应概率接 dcf-deskcheck（改回 Math.random()*100<50 硬编码即回归）', file: 'js/chat.js', needle: 'Math.random() * 100 < _dkP' },
  { name: '#132 房间字卡门控接 dcf-room（删 sayLine 门控行即回归）', file: 'js/room.js', needle: "window.dcfGet('room')" },
  { name: '#132 此间字卡门控接 dcf-cjian（删 cjLine 门控行即回归）', file: 'js/cjian.js', needle: "window.dcfGet('cjian')" },
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
  { name: '#255 批量导入弹窗放大（opts.big 宽版 420px/94vw + 原生 textarea rows=8——272px 窄弹窗用户报障「太小了」；删则回退窄版）', file: 'js/chatcard.js', needle: 'textareaRows: 8' },
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
  { name: '#275 渲染端池值体检（空串/脏值绝不入 map 缓存也不改写 img.src——原 typeof 放行空串=map 缓存\'\'+src=\'\'永久坏图；不入负缓存，缺数据可重试）', file: 'js/media-pool.js', needle: "v2.indexOf('data:image/') !== 0" },
  { name: '#275 未解析媒体池令牌 404 不进错误日志（getAttribute 原始值判令牌；池缺失+渲染占位已是预期失败路径，逐次渲染刷屏掩盖真错误）', file: 'js/device.js', needle: 'window.mochiMediaIsToken(imTok)' },
  // ==== 2026-09-10 #283 聊天语音令牌化（vivo S60/Chrome 25fps「经常卡、按不动」等多机型收口）====
  // 根因：#142 池 v1 只收 data:image/——历史语音/语音字卡以「名称|||data:audio;base64…」整份
  // 内联在消息 text（语音内容唯一，去重对总库无效，但令牌化后每次落盘只 clone 44 字符引用）。
  // 本机诊断：IDB chat-msgs=79.2MB/2277 条、JS 堆 307MB、长任务 50~405ms（隐藏冲刷+空闲落盘
  // 每次都 structured clone 整包）＝发消息/收键盘/离页回前台全在卡。音频纪律：不进 map 热缓存、
  // 播放走 ExpandAsync 按需 idbGet、迁移期每 32 条分批冲池（writeBuf/单事务封顶+回滚账除名）。
  { name: '#283 池收音频（tokenize 放行 data:audio/；回退只收图片=语音继续整份内联、低端机落盘长任务复发）', file: 'js/media-pool.js', needle: "dataUrl.indexOf('data:image/') !== 0 && dataUrl.indexOf('data:audio/') !== 0" },
  { name: '#283 语音令牌化（normalize pass 处理「名称|||data:audio/」内联语音；删则 chat-msgs 几十 MB 每次落盘 clone 整包回归）', file: 'js/chat.js', needle: "m.text.indexOf('data:audio/', _bar + 3) === _bar + 3" },
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
  { name: '#350 逐卡连发每条气泡挂「词典逐卡连发」tag（删则逐卡与单气泡 tag 不可区分＝用户点名的新 tag 丢失）', file: 'js/chat.js', needle: "silent: si > 0 ? true : silent,\ntag: '词典逐卡连发'," },
  // ==== 2026-09-11 #317 梦角自由造句（梦角语料抽卡→截断几字重造句→入库自定义字卡「梦角自由造句」分类）====
  { name: '#317 梦角自由造句抽句门·mjf-en/mjf-prob 生效（删则开关概率失效，梦角永不造句）', file: 'js/dream-free.js', needle: "if (!c || c['mjf-en'] !== 1) return null;" },
  { name: '#327 撤回式截断·词间隙切尾前缀成新句（删则造句变回随机截补＝句子离奇，用户明确否决）', file: 'js/dream-free.js', needle: "const out = toks.slice(0, gi).join('').replace(/[，、,\\s]+$/, '');" },
  { name: '#329 造句手法三选一·mjf-style 语气词式/撤回式/换字卡内容式（删则手法选择失效＝三模式不可切，回退固定撤回式）', file: 'js/dream-free.js', needle: "const style = Math.max(0, Math.min(2, Number(c['mjf-style']) || 1));" },
  { name: '#326 词边界来源·内置词典正向最大匹配切词（删则插入点随机＝可能截在词中间出病句）', file: 'js/dream-free.js', needle: 'if (dict.has(str.slice(i, i + L))) { len = L; break; }' },
  { name: '#317/324 造句入库·ccAppendCards 双作用域写 mjfree 分类（删则新句不进「梦角自由造句」字卡分类；#324 加 scope 分库参数）', file: 'js/chatcard.js', needle: "window.ccAppendCards = function (type, group, cards, scope) {" },
  { name: '#324/#364 造句分库·dreamFreeSave 按 mjf-pub 概率分库、单联系人 100% 专属（删则全部写专属＝多桌面公用库不再积累梦角语料）', file: 'js/dream-free.js', needle: "const usePublic = cids > 1 && Math.random() * 100 < pubProb;" },
  { name: '#317 replyOnce 接线·dreamFreePick 命中替换回复+入库（删则开关存在但永不生效）', file: 'js/chat.js', needle: 'window.dreamFreePick && window.dreamFreePick(c)' },
  { name: '#301 词典自建词条并入词典分类（删则自建语录/词不再进词典 tab 与拼字引擎）', file: 'js/default-cards.js', needle: "const gw = base.find(g => g[0].indexOf('词库') === 0)" },
  // ==== 2026-09-11 #306 小游戏 UI 收口（连连看/消消乐棋盘 gap 溢出截断、头部标题被挤竖排、拍卖会「不拍了」白字白底隐形）+ 全部小游戏通用全屏 .game-fs ====
  { name: '#306 连连看 fitBoard 扣除 grid gap 再取整（删则牌面总宽多出 (cols-1)*3px 溢出右缘、最右列被截断）', file: 'js/linkup.js', needle: 'Math.floor((w - (st.cols - 1) * GAP) / st.cols)' },
  { name: '#306 消消乐 fitBoard 扣除 grid gap 再取整（同连连看，删则第 8 列被裁）', file: 'js/match3.js', needle: 'Math.floor((w - (N - 1) * GAP) / N)' },
  // ==== 2026-09-12 #340 消消乐动画（用户报「没有真消消乐动画很突兀」）：棋子层+transform 合成器过渡，交换滑动/消除爆开/按距离下落 ====
  { name: '#340 消消乐消除爆开动画 keyframes（删则消除无爆开、退回瞬间消失）', file: 'css/chat-pages.css', needle: '@keyframes m3-popout' },
  { name: '#340 消消乐结算动画循环按距离等待（删则下落不等待、整盘退回瞬跳重绘）', file: 'js/match3.js', needle: 'animMs(FALL_MS)' },
  { name: '#306 半框头部标题禁止压缩换行（删则控件多的面板标题被挤成一字一行竖排）', file: 'css/chat-main.css', needle: '.poke-card-head > span { white-space:nowrap; }' },
  { name: '#306 拍卖会「不拍了」举牌行内可见样式（删则半透明白底+白字在白卡上完全隐形＝按钮像消失）', file: 'css/chat-pages.css', needle: '.au-bids .pong-overlay-btn2 { background:rgba(0,0,0,.07); color:var(--ink,#222); }' },
  { name: '#306 小游戏共享全屏容器 .game-fs（fixed 满视口 + iOS 高度修复同款表达式，删则全屏按钮失效）', file: 'css/chat-pages.css', needle: 'height:100vh; height:min(var(--mochi-ios-h, 100dvh), 100dvh);' },
  { name: '#306 全屏切换接线·面板 toggle game-fs + 图标 ⛶/⤢（gomoku 代表登记，删则按钮点了没反应）', file: 'js/gomoku.js', needle: "panel.classList.toggle('game-fs', isFs)" },
  // ==== 2026-09-11 #309 连连看/消消乐未开局舞台最小高度（空棋盘 stage 高 0 → 「开始对局」覆盖层压成一条横线＝用户报「面板只有一条横线、打不开」）====
  { name: '#309 连连看未开局舞台 min-height（删则空棋盘高度 0，开始覆盖层压成横线、面板无法正常开局；消消乐同行同款）', file: 'css/chat-pages.css', needle: '.lk-stage { position:relative; width:100%; min-height:190px;' },
  // ==== 2026-09-11 #314 收藏批量管理多选失效（getFav() 每次 JSON.parse 生成全新对象，favBatchSel 存对象引用 → 任何 renderFav 重渲染（点全选/切分类/切页签）后引用全部失配，勾选静默清零＝多选/全选形同虚设；全机型通用）====
  { name: '#314 收藏批量勾选身份=favItemKey 指纹（删则退回对象引用勾选，重渲染后勾选清零、多选失效；行为断言 tools/verify-fav-batch.mjs）', file: 'js/chat.js', needle: 'const visKeys = new Set(list2.map(favItemKey));' },
  // ==== 2026-09-11 #308 游乐室半框 × 关不掉（arcade.js 取了 #arc-close 却从未绑 click，任何机型都关不掉）====
  { name: '#308 游乐室 × 点击关闭接线（删则 #arc-close 成摆设、半框关不掉，行为断言 tools/verify-arcade-close.mjs）', file: 'js/arcade.js', needle: "closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });" },
  // ==== 2026-09-11 #301 手机端整页 UI 错乱收口（红包注释漏 `-->` 吞标签 → .phone 提前闭合 → tabbar 落 body 层被 flex 居中挤出屏）====
  { name: '#301 红包注释正确闭合（删则注释吞掉「红包」标题+set-group 开标签，后续 </div> 连锁提前闭合设置页与 .phone 手机壳＝整页 UI 错乱、底部导航出屏）', file: 'template.html', needle: 'chat.js trySystemAutoSend 读 cs-rp-auto-prob -->' },
  // ==== 2026-09-11 #313 心意集市「TA 送我礼物」总开关（默认关=禁止联系人送礼物；关闭时心愿单兑现 ① 与随机送礼 ④ 都不触发，TA 自己买 ②/加心愿 ③ 不受限）====
  { name: '#313 gift-shop TA送我礼物总开关（删则禁送失效、TA 恢复买我心愿单礼物；giftInOn 默认 0=禁止）', file: 'js/gift-shop.js', needle: 'st.wlOn && st.giftInOn && !capped' },
  // ==== 2026-09-11 #315 开屏免责声明置顶卡（未成年人禁止使用 + 字卡均为随机代码、使用后果自负；静态 DOM data-anti-scam="d"，在线 notice.json 覆盖不改此处）====
  { name: '#315 开屏免责声明卡在位（删则开屏不再展示「未成年人禁止使用/字卡随机代码后果自负」声明）', file: 'template.html', needle: 'data-anti-scam="d"' },
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
  { name: '#334 showTyping 复写守钉（删则用户读历史时「对方正在输入」把视图无条件拽回底部并重新钉住）', file: 'js/chat.js', needle: 'setTimeout(() => { if (chatPinnedBottom) scrollChatBottom(); }, 60);' },
  { name: '#334 hideTyping 复写守钉（删则回复落地收打字态时把已跳到旧区的视图拽回底部）', file: 'js/chat.js', needle: 'if (chatPinnedBottom) scrollChatBottom(); // FIX 2026-09-11 #334 同 showTyping' },
  // ==== 2026-09-11 #337 安卓键盘盖输入栏（荣耀畅玩80Pro 自带浏览器，多机型同族）：键盘弹出时 vv 读数漂移/不缩 → 读数判据 _aProvCheck 永不命中 + 58% 盲猜对高占比输入法停靠不足。三件套：①可见性触发停靠（聚焦>900ms+手势武装+实测元素底边低于可视区底边=被盖才动作，与内核读数无关）②VirtualKeyboard 实测尺（overlaysContent=true+geometrychange 按 base−kbH 精停，特性探测，_aProvClear 归还）③欠深自纠（停靠后仍被盖每 250ms 再收 8% 基准至露出/34% 地板）。行为断言 tools/verify-kb-cover-dock.mjs ====
  { name: '#337 键盘可见性触发停靠（删则读数漂移内核输入栏整行留在键盘下=畅玩80Pro 族无法聊天）', file: 'js/mobile-adapt.js', needle: '_kbCovered = !!(_rC && _rC.height > 0 && _aCoverBottom(tgt) > _visBottomC + 12);' },
  // ==== 2026-09-13 #387 点聊天输入栏 UI 乱+闪屏（桌面浏览器 DevTools 移动模拟实测复现，多机型同族）：安卓/iOS 键盘保底停靠的读数判据（|vv−基线|≤2 且 |inner−基线|≤2）只证「视口没动」不证「键盘在场」——无软键盘环境（电脑浏览器/移动模拟/外接键盘）视口永远不动，点输入栏即盲推 58% 停靠＝输入栏顶到屏中下方大空白（UI 乱），自愈清除后反复点击又缩回（闪屏）。修复：安卓 _aProvCheck 与 iOS _iProvCheck 两处盲推分支统一加「实测被盖」闸（#337 同一把尺：聚焦元素∪输入行底边低于可视区底边+12px 才停靠）——悬浮键盘真场景键盘必然盖住输入栏照常停靠零回归；元素可见无需停靠，只可能少停不可能多停。行为断言 tools/verify-kb-prov-covered.mjs ====
  { name: '#387 安卓盲推停靠被盖闸·实测（删则无键盘环境点输入栏盲推 58%=输入栏顶屏中 UI 乱闪屏）', file: 'js/mobile-adapt.js', needle: 'if (_kbCovered) _aProvDock();' },
  { name: '#387 安卓读数判据分支同样被被盖闸包住（删 =||= 恢复视口不动即盲推）', file: 'js/mobile-adapt.js', needle: 'Math.abs(ih - _aIH) <= 2 && _kbCovered) {' },
  { name: '#387 iOS 盲推停靠被盖闸（删则无键盘 iOS 环境点输入栏盲推收缩=UI 乱闪屏）', file: 'js/mobile-adapt.js', needle: '_iCovered = !!(_rI && _rI.height > 0 && _rI.bottom > ((_vv.offsetTop || 0) + _vv.height) + 12);' },
  { name: '#337 VirtualKeyboard 实测尺拉起（删则悬浮键盘只能 58% 盲猜，高占比输入法停靠不足仍被盖）', file: 'js/mobile-adapt.js', needle: 'vk.overlaysContent = true;' },
  { name: '#337 欠深自纠逐拍收紧（删则保底停靠不足时输入栏仍被盖不自愈）', file: 'js/mobile-adapt.js', needle: 'var ph = Math.max(Math.round(base * 0.34), cur - Math.round(base * 0.08));' },
  // ==== 2026-09-11 #336 信息诊断导出 docx 无反应（荣耀畅玩80Pro 自带浏览器对合成 a[download]+blob URL 静默忽略）：接入数据备份同款三级降级链 window.mochiExportBlob（①系统分享面板 ②系统保存框 ③确认后 a[download]），裸下载只作兜底；两处诊断弹窗统一走 diagExportDocx。行为断言 tools/verify-docx-export.mjs E5~E11 ====
  { name: '#336 诊断 docx 走三级降级链（删则壳浏览器点导出docx无反应=用户报障回流）', file: 'js/device.js', needle: "window.mochiExportBlob(blob, fname, 'mochi 诊断报告'" },
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
  { name: '#349 贪吃蛇标题名走 activeStore 动态命名空间（改回裸读冻结 PARTNER_KEY＝切桌面标题串名）', file: 'js/snake-game.js', needle: "nst.get('cs-lbl-partner') || nst.get('lbl-partner')" },
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
  // ==== 2026-09-12 #365 #319 锁定补口：聊天回应/接话/情绪链/TA的心情都是系统预设字卡源，此前未接二级密码锁——锁定态回复仍被「嗯嗯/知道了」类回应字卡覆盖或追加（用户反馈「没解锁时联系人只会发嗯嗯 知道了啦」）；修复=四处统一接 cardLockOpen 闸，解锁后照常 ====
  { name: '#365 回应字卡锁闸·replySrcLocked 判定（删闸＝锁定态联系人仍发嗯嗯/知道了等系统预设回应字卡）', file: 'js/mood-reply-cards.js', needle: 'return !!(window.cardLockOpen && !window.cardLockOpen())' },
  { name: '#365 TA的心情分享锁闸（删闸＝锁定态仍主动发系统预设心情字卡）', file: 'js/ta-mood.js', needle: 'if (window.cardLockOpen && !window.cardLockOpen()) return null;' },
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
  { name: '#378 单聊来消息跟底闸改按钉住标记（距离闸在首写被丢弃后永不跟底）', file: 'js/chat.js', needle: 'if (!out && !chatPinnedBottom) return;' },
  { name: '#378 单聊手动滚回贴底回钉（解钉后自动跟底可恢复）', file: 'js/chat.js', needle: 'else if (!chatPinnedBottom && body.scrollHeight - body.scrollTop - body.clientHeight < 120)' },
  { name: '#378 单聊轻点不杀跟底（位移<10px 且贴底=回钉，点气泡不再永久解钉）', file: 'js/chat.js', needle: 'const dy = Math.abs(e.changedTouches[0].clientY - chatUnpinTsY);' },
  { name: '#378 群聊跟底闸改按接管标记（同单聊距离闸问题）', file: 'js/group-chat.js', needle: 'if (!force && gcUserGcScrollTouched) return;' },
  { name: '#378 群聊轻点不杀跟底 + 滚回贴底解除接管（#396 随行补锚定摘除，锚随重构更新）', file: 'js/group-chat.js', needle: 'if (dy < 10 && nearGcBottom()) { gcUserGcScrollTouched = false;' },
  // ==== 2026-09-13 #396 聊天/群聊滑动屏幕「弹一下」（红米 K80 Chrome 报障，多机型同族）——两根因：①单聊 loadOlderIncremental 补偿式 beforeTop+anchor.offsetTop 读的是插入后首元素 offsetTop=插入高度+.chat-body padding-top，每批上翻固定多推 14px=视觉跳一下（#316 锚定只兜图片迟到解码兜不住这 14px，无头实测 Δsh=8903 误差恒-14px）；②#316 只给单聊解钉开回滚动锚定，gc-body 共享 .chat-body 的 overflow-anchor:none 却从未挂回 scroll-anchor-auto=图多群聊历史上翻被解码撑高推走 ====
  { name: '#396 单聊上翻补偿改锚点差值（删则每批上翻固定视觉上跳 padding-top 14px=滑动弹一下）', file: 'js/chat.js', needle: 'body.scrollTop = beforeTop + (anchor.offsetTop - anchorTopBefore);' },
  { name: '#396 群聊解钉开滚动锚定（删则图多群聊历史上翻被解码撑高推走，#316 同根因群聊侧）', file: 'js/group-chat.js', needle: "body.classList.add('scroll-anchor-auto')" },
  { name: '#396 群聊回钉摘锚定（钉住态 #199 none 语义不变，防锚定与 JS 显式滚动对打）', file: 'js/group-chat.js', needle: "body.classList.remove('scroll-anchor-auto')" },
  // ==== 2026-09-12 #382 屏幕适配诊断报告「导出docx」点了毫无反应（iQOO neo10pro Chrome 报障，多机型全现）——#333 时 diagExportDocx 在主诊断闭包、屏幕适配诊断闭包跨 IIFE 引用恒 ReferenceError 被 openModal 按钮 try/catch 吞掉；同调用 4 参对 3 形参 legacy 分支必抛 failToast is not a function ====
  { name: '#382 诊断导出跨闭包挂载 window.mochiDiagExportDocx（删则屏幕适配诊断导出恒 ReferenceError 静默失败）', file: 'js/device.js', needle: 'window.mochiDiagExportDocx = diagExportDocx;' },
  { name: '#382 屏幕适配诊断导出改走 window 挂载 + 形参收窄（failMsg,toastFn）', file: 'js/device.js', needle: "(window.mochiDiagExportDocx || function () {})(c ? c.text() : r.text, 'mochi-screen-diag-'" },
  // ==== 2026-09-12 #383 联系人消息乱码直出 @@m:hash（华为畅享70Pro Chrome 报障，多机型全现）——#377 巨型库令牌化后裸 @@m:hash 卡体无 |||、非 data:，getPool 旧两道守卫全漏过＝令牌卡入文字池被当文字直出；normCell 补认裸令牌让存量乱码刷新自愈回图片 ====
  { name: '#383 getPool 媒体令牌卡不进文字池（删则令牌卡再入池被当文字发出）', file: 'js/chat.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return;' },
  { name: '#383 归一化裸令牌 text 补 type=image（删则存量乱码消息永停留文字气泡）', file: 'js/chat.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(r.text)))) { r.type = '+"'image'"+'; c = true; }' },
  // ==== 2026-09-13 #384 开屏点击进入后强制观看公告（作者道别公告：二传二改/月底停更/二级密码）——每次进入先弹 #splash-mandatory，必须滑到底、点【我已阅读并确认进入】才真正进入；门控=未到底时确认按钮 is-disabled 不可点（clock.js mandBottom/finishEnter） ====
  { name: '#384 强制公告滑到底才可确认进入（删则强制公告可跳过，进入不再必读）', file: 'js/clock.js', needle: 'if (mandBottom) finishEnter();' },
  // ==== 2026-09-13 #385 联系人消息乱码·令牌夹在文字中间直出（续 #383）——#383 只治「整条 text 是裸令牌」（normCell 升 type=image）；多字卡回复 pickN.join(' ') 拼出的混合文本消息里 @@m:hash 嵌在正文中间，type 仍 text，渲染端 escTxtBr 原样铺出令牌串＝乱码（聊天/群聊公用库共享多机型全现）。消费者边界（气泡渲染）统一把内嵌 @@m:<hash32> 行内转 <img>，交 media-pool 观察器解图，存量/新收/任一浏览器不再直出令牌串 ====
  { name: '#385 内嵌令牌转行内图·chat 助手核心逻辑（split 令牌正则——删则令牌串不再转 <img>/<img class=msg-inline-tok> 直出乱码）', file: 'js/chat.js', needle: 's.split(/(@@m:[0-9a-f]{32})/g)' },
  { name: '#385 chat 文本气泡渲染调用内嵌令牌助手（删调用则助手在但不用，混合乱码消息仍直出令牌串）', file: 'js/chat.js', needle: 'window.mochiInlineTextHtml(T(__rawText))' },
  { name: '#385 单聊撤回段文本也走内嵌令牌助手（撤回复核样直出令牌串复现）', file: 'js/chat.js', needle: 'segHtml += window.mochiInlineTextHtml(' },
  { name: '#385 group-chat 文本气泡/预览走内嵌令牌助手（群聊纯文本气泡改回 escTxtBr 则群聊乱码复现）', file: 'js/group-chat.js', needle: 'window.mochiInlineTextHtml(rec.text' },
  // ==== 2026-09-13 #383b 源头补口三件（本会话，未构建随下次收口）——#385 治渲染端消费者边界，这里治源头：群聊回复池同款两道守卫漏裸令牌（新乱码仍会从群聊发出）、群聊渲染裸令牌 text 走图片分支、bg-keep 保活通知选卡漏判＝通知栏文字出乱码 ====
  { name: '#383b 群聊回复池令牌卡不进文字池（删则群聊继续从源头发出令牌卡）', file: 'js/group-chat.js', needle: 'c && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return;' },
  { name: '#383b 群聊渲染裸令牌 text 走图片分支（删则群聊存量整条令牌消息停留文字气泡）', file: 'js/group-chat.js', needle: "rec.type !== 'voice' && window.mochiMediaIsToken && window.mochiMediaIsToken(rec.text)" },
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
  { name: '#391 查岗回应文字池剔令牌（删则查岗回复直出令牌串）', file: 'js/chat.js', needle: "c.indexOf('data:') !== 0 && !(window.mochiMediaIsToken" },
  { name: '#391 每日留言池剔令牌（删则日历留言直出令牌串）', file: 'js/calendar.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(c))) cards.push(c);' },
  { name: '#391 信件补池剔令牌（删则来信正文拼令牌卡）', file: 'js/mail.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(s)) return;' },
  // ==== 2026-09-13 #392 二级锁↔词典关系看不懂（用户实报：词典开关都开了没效果，不懂和开屏二级密码的关系）——三处把因果讲成人话：词典独立页红条（锁定时当场提示+去哪解锁）、回复设置自检首闸文案「二级锁→防未成年人锁·锁定中·词典被锁停」、开屏锁卡 tip 补锁定影响面清单 ====
  { name: '#392 词典页二级锁关系提示条（删则锁定时词典开关全开却无效仍零解释）', file: 'js/default-cards.js', needle: 'function renderDictLockHint() {' },
  { name: '#392 词典页提示条锚点（删则提示无处渲染）', file: 'template.html', needle: 'id="dict-lock-hint"' },
  { name: '#392 回复设置自检首闸人话文案（改回「二级锁未解锁」则因果又看不懂）', file: 'js/reply-settings.js', needle: '锁定中·词典被锁停' },
  { name: '#392 开屏锁卡 tip 锁定影响面清单（删则不知道锁定停用了哪些字卡）', file: 'js/clock.js', needle: '锁定影响：默认聊天字卡、词典（含词典拼字）' },
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
      'isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT',
      "fetchWithTimeout('./index.html', INDEX_NETWORK_TIMEOUT)",
      'isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT',
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
    'isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT',
    "fetchWithTimeout('./index.html', INDEX_NETWORK_TIMEOUT)",
    'isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT',
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
