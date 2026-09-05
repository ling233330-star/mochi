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
// 非 git 环境（脚本被拷贝/CI 无 git）回退 v3.26.0 兜底。
let APP_VERSION = 'v3.26.0';
try {
  const cnt = execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (cnt && /^\d+$/.test(cnt)) APP_VERSION = 'v3.26.' + cnt;
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
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'media-pool.js', 'storage-slim.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'incoming-requests.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];

let html = read('template.html');
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
  { name: '诊断采集与设置页 DOM 解耦（row 在使用处按需判空，错误/环境/长任务/轨迹不因入口 DOM 缺失而失效）', file: 'js/device.js', needle: 'if (!row) return null;' },
  { name: '诊断复制不再 focus 隐藏 textarea（防手机弹输入法+灰屏，ta.focus 删除型守护；needle 收窄到 device.js copyText 的 appendChild(ta);ta.focus(); 上下文——裸 ta.focus(); 在 chat.js/decision.js/divination.js/group-decision.js 合法存在会误报）', file: 'js/device.js', needle: 'appendChild(ta);ta.focus();', absent: true },
  { name: '诊断电量 getBattery 废弃显式降级（不支持时输出一行而非静默消失）', file: 'js/device.js', needle: '无 getBattery 接口' },
  { name: '诊断超长文本引导导出 txt（>8KB 提示剪贴板可能截断，优先导出）', file: 'js/device.js', needle: '建议优先【导出txt】' },
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
  { name: '#144 armFgIdbReset 补 touchMac 分支（伪装 UA 的 iPad 回前台重建 IDB 连接）', file: 'js/idb.js', needle: 'if (!/iPhone|iPad|iPod/i.test(ua) && !touchMac) return;' },
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
  { name: '#113 诊断取消自动复制（点开不再弹输入法又收起致灰屏；手机剪贴板有字数上限、长文本静默截断，改由用户手动【复制】/【导出txt】）', file: 'js/device.js', needle: 'exportTxt(c ? c.text() : cur)' },
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
  { name: '#121 call-active 进 migrateLegacy 排除清单（全局根键不被当旧顶层键迁进 default 并删根键，否则 LS 兜底副本每次启动被搬走）', file: 'js/contacts.js', needle: "'call-active'];" },
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
  { name: '#108 清理会员歌曲改用 legacy 接口 + 代理 5xx 自动重试（v6 接口已死返回404"接口未找到！"，proxy.cors.sh 偶发 520；修华为Mate40Pro+Edge「无法清理会员歌曲、显示网络不可用」——实为第三方查询服务波动非断网）', file: 'js/music-player.js', needle: "r.status >= 500 || r.status === 429) throw { retry: true, msg: 'HTTP ' + r.status }" },
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
  { name: '安卓 Chrome 强制深色遮蔽网页配色修复：:root 显式声明 color-scheme:light（深色由 data-theme 手动管；缺失时系统深色下 Chrome Auto Dark 无视网页配色把群聊气泡/字体全网压成纯黑，iQOO Neo10 反馈）', file: 'css/base.css', needle: 'color-scheme:light' },
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
  { name: 'desk-freq-mode 误迁自愈（default 副本写回根键，存量一次性找回）', file: 'js/contacts.js', needle: "'hide-ta-sticker', 'desk-freq-mode']" },
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
  { name: '#190 保活音频安卓幅度降到物理不可闻（0.006，修 OPPO Find X9 自带浏览器等多机型「一进网页就有底噪/电流声」——220Hz 纯音 -60dBFS 实听嗡声）', file: 'js/bg-keep.js', needle: 'kaIsIOS() ? 0.002 : 0.006' },
  { name: '防倒卖回填·远程时效公告bulletin在位判定（notice.json下发text+until过期自动摘除,所有联网副本含二传显示）', file: 'js/clock.js', needle: "(!bulletin.until || Date.now() < bulletin.until)" },
  { name: '防倒卖回填·公告内容变化重写（标题固定「公告」+text 精确比对）', file: 'js/clock.js', needle: "if (box.textContent !== '公告' + want)" },
  { name: '防倒卖第二锚点·pwa.js在位看门狗（clock.js回填被删时的独立兜底,5s补回缺失声明）', file: 'js/pwa.js', needle: "n.insertBefore(mkWatchBar('1', '防骗提醒', W1), n.firstChild)" },
  { name: '#154 朋友圈评论「我的表情包」与聊天面板同源·暴露chat最新内存副本（IDB权威自愈，修store层旧LS快照/大键挂起导致的两侧不同步）', file: 'js/chat.js', needle: 'window.getMyEmojiGroups = function () { return myGroups || []; };' },
  { name: '#154 朋友圈评论「我的表情包」优先读chat内存副本（chat.js异常时旧store读兜底）', file: 'js/feed.js', needle: 'if (window.getMyEmojiGroups) {' },
  { name: '#156 群聊模式占卜图标强制收隐藏池（任意位置都隐藏，修「群聊开启后桌面占卜图标不消失」——原只在首页图标组原位时才收）', file: 'js/personalize.js', needle: 'if (divBtn && divBtn.parentNode !== pool) {' },
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
  { name: '#199 判定器·浏览器覆盖形态期望底边=可视区底（.phone 刻意不超 inner，仍按 envTop+inner 判则修好后误报 #179 少填；#210 起判式收敛到共享判定器）', file: 'js/device.js', needle: 'const coverBrowser = !standalone && diff <= 2 && envTop >= 20;' },
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
  { name: '#207 保活音频电流声·安卓频率换 18kHz（220Hz 在人耳最敏感频段，#190 降幅度后 OPPO R15 自带浏览器等多机型仍实听嗡声；数字振幅/volume 不动=audible 判定零回归，iOS 分支 bit 级不动）', file: 'js/bg-keep.js', needle: 'kaIsIOS() ? 220 : 18000' },
  { name: '#208 聊天输入栏上移白边·键盘收起视口未还原自愈（iOS standalone 键盘收起 WebKit 偶发不还原视口，restoreKb 的 60px 还原门槛永不满足=kbActive 卡真 .phone 卡收缩高；失焦>4s 且视口仍<基线−60 强制复原）', file: 'js/mobile-adapt.js', needle: 'Date.now() - _focLostAt > 4000 && _vv && _vv.height < _fullVv - 60' },
  { name: '#208 聊天输入栏上移白边·tabbar 隐藏跳过采集（全屏页 tabs.js 给 tabbar 挂 hidden，矩形全 0 被判悬空 860px 每 5s 刷假错误环）', file: 'js/device.js', needle: 'if (!tb || tb.hidden) return null;' },
  { name: '#208 聊天输入栏上移白边·判定器布局视口未贴底（保留形态 diff 应≈envTop；键盘收起未还原时按 inner 判贴合全绿漏报，单列 ✗ 让白带状态可诊断）', file: 'js/device.js', needle: 'diff > envTop + 24 && !(inp.kb && inp.kb.kbActive)' },
  { name: '#209 输入栏下方灰底断截面·焦点保留硬证据自愈（安卓返回键收键盘不派 blur/#197 族 focusout 丢失时 !foc 复原分支永不执行=停靠残留卡死；可视区双信号回满 ≤12px 即复原，焦点在不在都算键盘已收；推定停靠 _aProv/_iProv 与全屏态不碰）', file: 'js/mobile-adapt.js', needle: 'if (_hNow <= 0 || _hNow < _aH - 12) return;' },
  { name: '#210 视口形态判定器同源（window.mochiViewportForm 单一事实源：执行器 syncVvFit 与诊断 screenDiagJudge 共用，新形态只改一处；删定义即回归两处手抄判式漂移——#186 期间 force 分支已实际漂移两处）', file: 'js/device.js', needle: 'window.mochiViewportForm = function (sig) {' },
  { name: '#210 判定器·force 声明期望底边=屏高（#186 缺陷修正：原误写 innerH 与「期望=屏高」注释矛盾，forced 设备自检必误报底部超出；env=0 的 18.3 白边期望按 safeTop+inner 补满）', file: 'js/device.js', needle: 'forceCover ? (screenH || (safeTop + innerH))' },
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
      'isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT'
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
    'isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT'
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
