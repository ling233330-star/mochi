// ===== 验证：使用说明「后台弹窗 / 手机卡顿 / 设备与浏览器限制」三块内容在位且可搜 =====
// 用户直派（2026-09-16）：「后台弹窗也要有使用说明、详细说清楚」「安卓和 iOS 卡顿要给说明和
// 优化建议，让用户去做，也要写在设置里」「很多设备限制和浏览器限制，出现的问题用户以为是
// 网站 bug，也要详细说清楚」。
// 落点：① 使用说明页（设置 → 关于 → 帮助与支持 → 使用说明）新增第 10/11/12 节（长文）；
//      ② 设置页对应行的「功能说明」胶囊（src/js/settings-help.js 的 #bg-notify /
//         #row-perf-optimize / #row-guide / #row-diagnostics）为同口径要点版；
//      ③ 系统分区的「后台通知」行与工具分区的「卡顿自检」行下各加一条可见提示（gs-sub），
//         不点开弹窗也能看到要点。
// 断言分两层：静态锚（src 文本）＋ 无头 Chrome 实跑（节数/计数/页内搜索/胶囊弹窗/设置搜索）。
// #997 追加：用户直派「批量上传图片的地方要小字说明＝浏览器限制、可换浏览器；网站没有那么大权限，
//   打开的只是手机相册 / 应用，与网站无关」→ ① 使用说明新增第 13 节「本站只是一个网页（前端网站）·
//   很多做不到是设备限制」（原 13/14 顺延为 14/15）；② 六处批量上传入口就地小字（桌面批量上传图标 /
//   聊天批量发送面板 / 两个头像库 / 字卡库批量导入 / 壁纸图库 / 塔罗牌面批量上传）；③ 入口副文案与
//   设置页「功能说明」口径同步（四节长文 + 设备兼容诊断指向第 13 节）；④ 顺手校正第 11 节 lg-count 漂移。
// 用法：node tools/verify-guide-help.mjs（需本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// 内存拼装 src（与 build.mjs 同序，不写产物）
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
const tpl = read('template.html');
let html = tpl.replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

let fail = 0, total = 0;
const A = (name, ok, extra) => { total++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

// ---- S 静态断言：内容锚点在 src 里（不用起浏览器） ----
const sh = read('js/settings-help.js');
A('S1 settings-help 后台弹窗长文在位（使用说明 + 收不到排查）',
  sh.includes('后台弹窗 · 使用说明') && sh.includes('【收不到怎么办】') && sh.includes('【开启步骤（安卓 / 电脑）】'));
A('S2 settings-help 卡顿长文在位（原因分几类 + 谁最占地方看用户自己的 + 按顺序优化清单）',
  sh.includes('手机卡顿怎么办（安卓 / iPhone）· 使用说明') && sh.includes('【按这个顺序优化') && sh.includes('不要用「清除本地数据」来治卡顿')
  && sh.includes('没有统一答案，看你自己的') && sh.includes('别照别人的排序删自己的数据') && sh.includes('别误会：不是让你少存图'));
A('S3 settings-help 使用说明行已登记（#row-guide 说明可被设置搜索命中）', sh.includes("sel: '#row-guide'"));
A('S4 settings-help 设备限制清单入口挂在设备兼容诊断行',
  sh.includes('像 bug 的问题') && sh.includes('使用说明 第 12 节'));
A('S5 使用说明页三节标题在位',
  tpl.includes('后台弹窗 · 怎么用（安卓 / 电脑）') && tpl.includes('手机卡顿怎么办（安卓 / iPhone）') && tpl.includes('设备与浏览器限制（看着像 bug，其实不是）'));
A('S6 设置页两条可见提示（后台通知行 / 卡顿自检行）在位',
  tpl.includes('id="bg-notify-sub"') && tpl.includes('id="perf-help-sub"'));

A('S7 说明页第 11 节含「谁占地方每台手机不一样 / iPhone 和安卓不一样 / 别让你少存图」三条要点',
  tpl.includes('哪一样占得最多，每台手机都不一样') && tpl.includes('iPhone 和安卓不一样') && tpl.includes('不是让你少存图'));

// S8 口径守卫（2026-09-17 用户反馈「写的不是全部情况，而是我之前的案例」）：
// 三个用户可见面（设置页行下小字 / 功能说明 / 功能中心收录）都不能把「某一台手机上的实测排序」
// 当成所有人的结论——必须「成因分几类 + 先看『查看存储』看用户自己哪一项最大」。
const fh = read('js/feature-hub.js');
const hubEntry = (fh.match(/\{ n: '卡顿自检[\s\S]*?\},/) || [''])[0];
A('S8 三处卡顿文案都不写死「某一样最大」，一律「成因分类 + 看用户自己」',
  tpl.includes('哪一样最多，每台手机都不一样') && tpl.includes('看你自己哪一项最大')
  && hubEntry.includes('哪一块最占地方因人而异') && hubEntry.includes('先到「查看存储」看清自己这一台')
  && !hubEntry.includes('实测占得最多的是聊天记录'));

// S9 平台口径（2026-09-17 用户直派结论）：「iPhone＝装到桌面 + 别存太多（图片最占）；
// 安卓＝好很多但长期也要清」。同时守住两处被用户当场质疑过的错误说法（添加到主屏幕提高内存、
// 「更不容易被系统清内存」）——iPhone 装到桌面也一样会被系统关掉重开（#377 就是独立 PWA 的 OOM 家族）。
A('S9 第 11 节写明 iPhone / 安卓两句差异，且不再出现「装到桌面就能多用内存」的说法',
  tpl.includes('先记住两句话') && tpl.includes('用久了也要清')
  && tpl.includes('这不是「能多用内存」') && tpl.includes('长期用也要定期清')
  && !tpl.includes('更不容易被系统清内存') && !tpl.includes('内存表现也更稳'));

// ---- #997：批量上传＝设备限制（入口小字 + 独立一节 + 口径同步）----
const pj = read('js/personalize.js');
const dj = read('js/divination.js');
A('S10 #997 桌面「批量上传图标图片」行小字＝选不了多张是浏览器限制 + 指向第 13 节',
  tpl.includes('每点一个换一张 · 选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）'));
A('S11 #997 聊天「批量发送」面板插入图片行小字在位',
  tpl.includes('id="batch-upload-hint">选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）'));
A('S12 #997 两个头像库 pane（TA 的 / 我的）都有小字',
  tpl.includes('id="avlib-upload-hint">选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）') && tpl.includes('id="avlib-me-upload-hint">选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）'));
A('S13 #997 字卡库批量导入按钮下小字在位',
  tpl.includes('id="cc-import-hint"') && tpl.includes('选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）'));
A('S14 #997 壁纸图库「＋ 上传新图（可多选）」下小字在位（personalize）',
  pj.includes("bgHint.id = 'phonebg-upload-hint';") && pj.includes('选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）'));
A('S15 #997 塔罗牌面批量上传小字在位（divination）',
  dj.includes('<div class="divf-hint" id="divf-batch-hint">') && dj.includes('选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）'));
A('S16 #997 入口副文案 + 功能说明四节长文 + 设备兼容诊断指向第 13 节',
  tpl.includes('设备与浏览器限制 · 只是网页（前端网站） · 数据备份') && sh.includes('再到四节长文——')
  && sh.includes('第 13 节「本站只是一个网页」'));
A('S17 #997 独立一节讲清能力边界（无服务器 / 网页没有相册权限 / 只提建议 / 换浏览器不带走数据）',
  tpl.includes('本站是一个网页，不是 App，也没有服务器') && tpl.includes('网页没有「相册权限 / 存储权限」这回事')
  && tpl.includes('网站能提的建议只有两条') && tpl.includes('换浏览器 / 装到主屏幕不会带走数据')
  && tpl.includes('本站是纯前端网页，能用的能力都是浏览器借给它的'));
A('S18 #997 第 11 节计数漂移已校正（19→20，与实际条目一致）',
  tpl.includes('手机卡顿怎么办（安卓 / iPhone）</span><span class="lg-count">20</span>'));
const fhAlready = read('js/feature-hub.js');
A('S19 #997 功能大全「使用说明」条目列全章节并补关键词（搜「批量上传 / 设备限制」要能找到入口）',
  fh.includes('设备限制 浏览器限制 批量上传') && fh.includes('本站只是一个网页（批量上传图片只能选一张')
  && fh.includes('设备与浏览器限制 / 本站只是一个网页'));
A('S20 #997 我的表情 / 朋友圈发动态 / 写信 / 回信 四处多选上传也补了小字',
  tpl.includes('id="myemoji-add-hint">' + '选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）')
  && tpl.includes('id="feed-pick-hint-note">' + '选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）')
  && tpl.includes('id="mail-write-img-hint">' + '选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）')
  && tpl.includes('id="mail-reply-img-hint">' + '选不了多张或点了没反应，是浏览器 / 所在 App 的限制：换 Chrome / Edge 再试（详见 使用说明第 13 节）'));
A('S21 #997 头像库小字排在「添加头像」按钮之前（原先在按钮之后＝小屏落在滚动区折叠线以下）',
  tpl.includes('还没有头像，点击下方按钮添加</div>\n          <div style="font-size:11px;line-height:1.6;color:var(--muted);margin:6px 0 8px" id="avlib-upload-hint">')
  && tpl.includes('还没有头像，点击下方按钮添加</div>\n          <div style="font-size:11px;line-height:1.6;color:var(--muted);margin:6px 0 8px" id="avlib-me-upload-hint">'));

// ---- 起本地服务 + 无头 Chrome ----
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 或安装后重试）'); process.exit(2); }
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vgh-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { server.close(); } catch (e) {} });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('环境不满足：无法连接无头浏览器'); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2600);
// 拆掉开屏 / 问答门 / 新手引导 / 遮罩，停在设置页
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove();
  const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
  const g=document.querySelector('.mg-guide-mask'); if(g) g.remove();
  const m=document.getElementById('modal-mask'); if(m) m.hidden=true;
  document.querySelectorAll('.page').forEach(p=>p.hidden=true);
  const sp=document.getElementById('page-setting'); if(sp) sp.hidden=false; })()`);
await sleep(300);

const setSearch = (q) => ev(`(()=>{ const i=document.getElementById('set-search-input'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return 1; })()`);
const rowVisible = (sel) => ev(`(()=>{ const r=document.querySelector(${JSON.stringify(sel)}); return !!r && r.style.display!=='none'; })()`);

// ---- P 设置页：胶囊存在 → 点开弹窗内容 → 不跳页 ----
A('P1 设置页「功能说明」胶囊已注入（后台通知 / 卡顿自检 / 使用说明 / 设备兼容诊断）',
  await ev(`['#bg-notify','#row-perf-optimize','#row-guide','#row-diagnostics'].every(s=>{
    const el=document.querySelector(s); if(!el) return false;
    const row=el.closest('.set-row, .gs-row'); return !!(row && row.querySelector('[data-setdesc="'+s+'"]'));
  })`));

const clickCapsule = (sel) => ev(`(()=>{ const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 0;
  const row=el.closest('.set-row, .gs-row'); if(!row) return 0;
  const t=[...row.querySelectorAll('[data-setdesc]')].find(x=>x.getAttribute('data-setdesc')===${JSON.stringify(sel)});
  if(!t) return 0; t.click(); return 1; })()`);
const modalText = () => ev(`(()=>{ const el=document.getElementById('modal-static'); const m=document.getElementById('modal-mask'); return (el && m && !m.hidden) ? el.textContent : ''; })()`);

await clickCapsule('#bg-notify'); await sleep(200);
let mt = await modalText();
A('P2 后台通知「功能说明」= 后台弹窗完整使用说明',
  mt.includes('后台弹窗 · 使用说明') && mt.includes('后台保活') && mt.includes('离线消息提醒') && mt.includes('iPhone') && mt.includes('测试'),
  'len=' + (mt ? mt.length : 0));
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

// 后台保活说明里必须写明「只是浏览器网页保活、没有别的意思」（用户直派补的澄清段）
await clickCapsule('#bg-keepalive'); await sleep(200);
mt = await modalText();
A('P2b 后台保活「功能说明」写明「只是网页保活，没有别的意思」',
  mt.includes('【它只是这个网页的「保活」，没有别的意思】') && mt.includes('不联网上传') && mt.includes('【为什么会影响其他 App 的声音】'),
  'len=' + (mt ? mt.length : 0));
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

await clickCapsule('#row-perf-optimize'); await sleep(200);
mt = await modalText();
A('P3 卡顿自检「功能说明」= 卡顿原因分几类 + 谁最占地方看用户自己的 + 用户可做的优化清单',
  mt.includes('手机卡顿怎么办（安卓 / iPhone）· 使用说明') && mt.includes('字卡库瘦身') && mt.includes('压缩图片') && mt.includes('不要用「清除本地数据」来治卡顿')
  && mt.includes('没有统一答案，看你自己的') && mt.includes('别照别人的排序删自己的数据') && mt.includes('别误会：不是让你少存图'),
  'len=' + (mt ? mt.length : 0));
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

await clickCapsule('#row-guide'); await sleep(200);
mt = await modalText();
const stillSetting = await ev(`(()=>{ const g=document.getElementById('page-guide'); const s=document.getElementById('page-setting'); return (!!g && g.hidden) && (!!s && !s.hidden); })()`);
A('P4 使用说明「功能说明」列全 15 节，且点胶囊不会跳页', mt.includes('后台弹窗 · 怎么用（安卓 / 电脑）') && mt.includes('设备与浏览器限制') && stillSetting, 'jump=' + !stillSetting);
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

await clickCapsule('#row-diagnostics'); await sleep(200);
mt = await modalText();
A('P5 设备兼容诊断「功能说明」点名设备/浏览器限制清单', mt.includes('浏览器限制') && mt.includes('第 12 节'));
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

// #659 夜间模式行（incoming-requests.js 动态插入）：胶囊在行内、点开＝作用/默认/机制/影响范围，
// 且点胶囊不会顺手把开关拨动（胶囊在 .txt 内、与 label.toggle 无关）
const nightOn = () => ev(`(()=>{ const i=document.getElementById('sf-night-mode'); return !!i && i.checked; })()`);
A('P5a 夜间模式行「功能说明」胶囊在位（动态行自带、未被 inject 跳过）',
  await ev(`(()=>{ const t=document.querySelector('#sf-night-mode-tag'); const r=document.getElementById('sf-night-mode-row');
    return !!t && !!r && r.querySelector('.txt')===t.parentNode && t.getAttribute('data-setdesc')==='#sf-night-mode-row'; })()`));
const beforeToggle = await nightOn();
await clickCapsule('#sf-night-mode-row'); await sleep(200);
mt = await modalText();
const nightTitle = await ev(`(()=>{ const t=document.getElementById('modal-title'); return t ? t.textContent : ''; })()`);
A('P5b 夜间模式「功能说明」= 时段 + 默认 + 机制 + 影响范围四段且不拨开关',
  nightTitle.indexOf('夜间模式') >= 0 &&
  mt.includes('22:00–次日 07:00') && mt.includes('默认：关闭') && mt.includes('无需手动操作') &&
  mt.includes('跨桌面查岗') && mt.includes('跨桌面来电') &&
  mt.includes('不受影响') && (await nightOn()) === beforeToggle,
  'len=' + (mt ? mt.length : 0) + ' title=' + nightTitle + ' toggle=' + beforeToggle);
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

// 设置搜索：卡顿 / 后台弹窗 / 浏览器限制 都能找到入口行
await setSearch('卡顿'); await sleep(150);
const perfVis = await rowVisible('#row-perf-optimize');
const guideVis = await rowVisible('#row-guide');
A('P6 设置搜索「卡顿」命中 卡顿自检 + 使用说明', perfVis && guideVis);
await setSearch('后台弹窗'); await sleep(150);
A('P7 设置搜索「后台弹窗」命中 使用说明', await rowVisible('#row-guide'));
await setSearch('浏览器限制'); await sleep(150);
A('P8 设置搜索「浏览器限制」命中 设备兼容诊断', await rowVisible('#row-diagnostics'));
// #659：说明文案并入搜索素材（行上胶囊带 data-setdesc，#573 数据驱动）——只出现在说明里的词也能搜到本行
await setSearch('勿扰'); await sleep(150);
A('P8b 设置搜索「勿扰」（只在夜间模式说明里）命中夜间模式行', await rowVisible('#sf-night-mode-row'));
await setSearch('功能说明'); await sleep(150);
const capsuleNoise = await ev(`(()=>[...document.querySelectorAll('#page-setting .set-row')].filter(r=>r.style.display!=='none').length)()`);
A('P8c 胶囊文本仍不入搜索素材（搜「功能说明」零命中，夜间模式行不误中）', capsuleNoise === 0, 'hits=' + capsuleNoise);
await setSearch(''); await sleep(150);

// ---- G 使用说明页：节数 / 计数 / 页内搜索 ----
await ev(`document.getElementById('row-guide').click()`);
await sleep(300);
A('G0 点「使用说明」行进入说明页', await ev(`(()=>{ const g=document.getElementById('page-guide'); return !!g && !g.hidden; })()`));

const secInfo = () => ev(`(()=>[...document.querySelectorAll('#page-guide .lic-grp')].map(g=>({
  num:(g.querySelector('.lg-num')||{}).textContent||'',
  name:(g.querySelector('.lg-name')||{}).textContent||'',
  count:Number((g.querySelector('.lg-count')||{}).textContent||0),
  items:g.querySelectorAll('.lic-li').length,
  hidden:!!g.hidden,
  shown:[...g.querySelectorAll('.lic-li')].filter(li=>li.style.display!=='none').length
})))()`);

const secs = await secInfo();
A('G1 说明页共 15 节、编号 1..15 连续', secs.length === 15 && secs.every((s, i) => s.num === String(i + 1)), 'n=' + secs.length + ' nums=' + secs.map(s => s.num).join(','));
const badCount = secs.filter(s => s.count !== s.items);
A('G2 每节 lg-count 与实际条目数一致', badCount.length === 0, badCount.map(s => s.name + ':' + s.count + '≠' + s.items).join(' '));
const byName = (kw) => secs.find(s => s.name.indexOf(kw) >= 0);
A('G3 三节都在说明页（后台弹窗 10 / 卡顿 11 / 设备限制 12）',
  !!byName('后台弹窗') && byName('后台弹窗').num === '10' && !!byName('手机卡顿') && byName('手机卡顿').num === '11' && !!byName('设备与浏览器限制') && byName('设备与浏览器限制').num === '12');

const guideSearch = async (q) => {
  await ev(`(()=>{ const i=document.getElementById('guide-search'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return 1; })()`);
  await sleep(120);
  return secInfo();
};
let gs = await guideSearch('卡顿');
let g11 = gs.find(s => s.name.indexOf('手机卡顿') >= 0);
const unrelatedHidden = gs.filter(s => ['快速开始', '功能都在哪里', '许可与免责'].indexOf(s.name) >= 0).every(s => s.hidden);
A('G4 说明页搜「卡顿」→ 第 11 节展开且有命中、无关节隐藏',
  !!g11 && !g11.hidden && g11.shown >= 5 && unrelatedHidden,
  'shown=' + (g11 ? g11.shown : -1) + ' visSecs=' + gs.filter(s => !s.hidden).length + ' unrelatedHidden=' + unrelatedHidden);

gs = await guideSearch('后台弹窗');
const g10 = gs.find(s => s.name.indexOf('后台弹窗') >= 0);
A('G5 说明页搜「后台弹窗」→ 第 10 节展开', !!g10 && !g10.hidden && g10.shown >= 5, 'shown=' + (g10 ? g10.shown : -1));

gs = await guideSearch('桌面版网站');
const g12 = gs.find(s => s.name.indexOf('设备与浏览器限制') >= 0);
A('G6 说明页搜「桌面版网站」→ 第 12 节命中', !!g12 && !g12.hidden && g12.shown >= 1, 'shown=' + (g12 ? g12.shown : -1));

gs = await guideSearch('语音');
A('G7 说明页搜「语音」仍能命中（既有行为未破坏）', gs.some(s => !s.hidden && s.shown > 0), 'visSecs=' + gs.filter(s => !s.hidden).length);

gs = await guideSearch('');
A('G8 清空搜索 → 15 节全部恢复可见', gs.length === 15 && gs.every(s => !s.hidden), 'n=' + gs.length);

// ---- #997：独立一节（第 13 节）渲染面 + 原 13/14 顺延 + 六处小字在 DOM 里 ----
const secsAll = await secInfo();
const pick = (kw) => secsAll.filter((x) => x.name.indexOf(kw) >= 0)[0];
const n13 = pick('本站只是一个网页');
A('G9 #997 说明页有独立一节「本站只是一个网页」（编号 13、计数与条目一致＝8）',
  !!n13 && n13.num === '13' && n13.items === 8 && n13.count === n13.items,
  n13 ? 'num=' + n13.num + ' count=' + n13.count + ' items=' + n13.items : 'none');
A('G10 #997 原 13/14 节顺延（应用锁＝14、许可与免责＝15）',
  (pick('应用锁') || {}).num === '14' && (pick('许可与免责') || {}).num === '15',
  'applock=' + (pick('应用锁') || {}).num + ' license=' + (pick('许可与免责') || {}).num);
const sec13 = await ev(`(()=>{const g=[...document.querySelectorAll('#page-guide .lic-grp')][12]; return g?g.textContent:'';})()`);
A('G11 #997 第 13 节写明「网页没有相册权限 / 网站只能提建议 / 换 Chrome·Edge / 在浏览器打开 / 导出数据」',
  sec13.includes('网页没有「相册权限 / 存储权限」这回事') && sec13.includes('网站能提的建议只有两条')
  && sec13.includes('在浏览器打开') && sec13.includes('Chrome / Edge') && sec13.includes('导出数据')
  && sec13.includes('设备与浏览器限制'), 'len=' + sec13.length);
const deskNote = await ev(`(()=>{const r=document.getElementById('row-icon-batch'); const t=r&&r.querySelector('.sub'); return t?t.textContent:'';})()`);
A('G12 #997 设置页「批量上传图标图片」行小字实际渲染含口径（渲染面，非仅 src）',
  deskNote.indexOf('选不了多张或点了没反应') >= 0 && deskNote.indexOf('第 13 节') >= 0, 'len=' + deskNote.length);
const hintOk = await ev(`(()=>{const ids=['batch-upload-hint','avlib-upload-hint','avlib-me-upload-hint','cc-import-hint','myemoji-add-hint','feed-pick-hint-note','mail-write-img-hint','mail-reply-img-hint'];
  return ids.every(id=>{const el=document.getElementById(id); return !!el && el.textContent.indexOf('Chrome / Edge')>=0 && el.textContent.indexOf('第 13 节')>=0;});})()`);
A('G13 #997 聊天批量面板 / 两个头像库 / 字卡库 / 我的表情 / 朋友圈 / 写信 / 回信 八处小字节点在位且有文案', hintOk);
const gsBatch = await guideSearch('批量上传');
const g13h = gsBatch.filter((x) => x.name.indexOf('本站只是一个网页') >= 0)[0];
A('G14 #997 说明页搜「批量上传」→ 第 13 节命中并展开', !!g13h && !g13h.hidden && g13h.shown >= 1,
  'shown=' + (g13h ? g13h.shown : -1));
const gsNoPerm = await guideSearch('相册权限');
const g13p = gsNoPerm.filter((x) => x.name.indexOf('本站只是一个网页') >= 0)[0];
A('G15 #997 说明页搜「相册权限」→ 第 13 节命中（用户原话关键词可搜到）', !!g13p && !g13p.hidden && g13p.shown >= 1,
  'shown=' + (g13p ? g13p.shown : -1));
await guideSearch('');

// ---- #997 收尾：头像库小字必须在「添加头像」按钮之前，且 360×640 下不被滚动区折叠线切掉 ----
await ev(`(()=>{document.querySelectorAll('.page').forEach(p=>p.hidden=true); const c=document.getElementById('page-chat'); if(c) c.hidden=false;
  const k=document.getElementById('avlib-card'); if(k){k.hidden=false; const a=document.getElementById('avlib-pane-a'); if(a) a.hidden=false;}
  const m=document.getElementById('modal-mask'); if(m) m.hidden=true; return 1;})()`);
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true });
await sleep(300);
const avPos = await ev(`(()=>{const hint=document.getElementById('avlib-upload-hint'), btn=document.getElementById('avlib-upload'), sc=document.getElementById('avlib-scroll');
  if(!hint||!btn||!sc) return {missing:true};
  const hr=hint.getBoundingClientRect(), sr=sc.getBoundingClientRect();
  return { before: !!(hint.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING),
    belowFold: hr.bottom > sr.bottom + 1, hintBottom: Math.round(hr.bottom), scrollBottom: Math.round(sr.bottom) };})()`);
A('G16 #997 头像库小字在按钮之前 且 360×640 下不被滚动区折叠（空池首屏可见）',
  !!(avPos && avPos.before) && avPos.belowFold === false,
  JSON.stringify(avPos));
await cdp('Emulation.clearDeviceMetricsOverride');

const jsErr = await ev('window.__jsErrors ? window.__jsErrors.length : -1');
A('E1 全程无 JS 异常', jsErr === 0 || jsErr === -1, 'jsErrors=' + jsErr);

console.log('\n' + (fail ? 'FAIL ' + fail + ' 项' : 'ALL PASS') + '（共 ' + total + ' 项断言）');
process.exit(fail ? 1 : 0);
