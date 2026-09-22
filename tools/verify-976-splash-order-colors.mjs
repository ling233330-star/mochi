// verify-976-splash-order-colors.mjs — #976 开屏「颜色太乱 / 内容也很乱」优化（常驻）
// 用户 2026-09-21 直派「开屏里的颜色太乱，内容也很乱。怎么优化一下？」＋两条约束：
//   ①「不要删除我的内容」②「必读卡挪到品牌卡前」；配色由用户选定「顶卡 + 免责声明保留红」。
// 本批只做两件事：把 7 张必读卡整组前移到品牌卡之前（逐字节原样搬运）＋把强调色从 6 种收到 4 种
//   （红＝使用红线〔顶卡 + 免责声明〕/ 橙＝须知提醒〔停更、公告已精简、安卓浏览器〕/
//     琥珀＝需要你操作〔系统内置字卡锁〕/ 灰＝陈述〔防倒卖、使用前提〕；使用前提的蓝色专属色撤除）。
// 断言：位置（组在品牌卡之前、组内 7 张齐全有序）＋**一字未删**（与改前文本快照逐块比对）＋
//   颜色语义（红恰好 2 处、亮暗两套）＋防倒卖回填仍在（删卡后补回组内首位）＋进入门控零回归。
// 用法：node tools/verify-976-splash-order-colors.mjs
//   MOCHI_SERVE_ROOT=<仓外副本目录> 可指向隔离副本（默认 = 本仓根）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || here);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
console.log('serve root = ' + root);

// 文本快照（2026-09-21，逐块抓取的规范化文本）——本批为「用户已确认的文案基线」：
//   · 76855ca 版（#973 定稿）为初始基线；#981 用户重写顶卡四段并在摘要补「词典字卡在哪关」后，
//     基线同步更新为 ae7a744 构建产物（其余 9 块与 76855ca 完全相同）；
//     #998 只同步 cardlock（锁定态 tip）与 summary（必读摘要密码条）两块，其余 9 块一字未动。
// ——「不要删除我的内容」这条约束的判据：改后每一块文本必须与快照完全相同。
const SNAPSHOT = {
 "bigwarn": "使用前必看 · 本站内容非常多，不适用建议不使用本站 网站本质只是工具，使用效果取决于个人使用和个人理解，各种原因都需要适应和调整。 网站内置内容非常非常多，需给一定时间适应和根据个人使用习惯调整，或不适用建议不使用这个网站。 回复设置概率，非常多功能的时间和概率，全部都是公开的可以自己调，功能也可以自己设置关闭。 聊天字卡也可以单独关闭某个分组或关闭某个单独的字卡。默认聊天字卡的词典字卡太多，不适用建议关闭。",
 "antiscam": "免费 · 署名 · 防倒卖 本站完全免费，没有收过任何人一分钱，个人出资和花费时间搭建的。开放二传二改但禁止以盈利为目的。 Mochi字卡网站完全免费。作者只有两个账号：小红书@言序（1842523578）和抖音@言序（58334080131）。作者不玩抖音、不回消息，是看到有人想花钱求网站才开的号，仅用于发布本站链接。本站不收取任何费用，如有出现任何收费情况，均为诈骗，注意防止被骗。 二传、分享本站链接必须标注作者署名：小红书 @言序（1842523578），禁止删除或修改。严禁冒为自己制作、删除篡改署名，或以任何形式收费倒卖本站链接、安装包——本站完全免费，收费即诈骗。如果你是花钱买来的链接：你被骗了，请拒付退款并举报卖家。",
 "stopupdate": "停更公告 · 2026年9月底后永久停更 mochi字卡 2026年9月底后永久停更。停更后不会再帮人调不同人的设备型号的兼容 bug。 作者自己的手机使用无异常情况；其他人的设备上的问题，不报出来作者手机碰不到、也无法发现——不同手机型号的情况就是不同。 永久停更以后，建议自己拿代码给 AI 调（代码已在 GitHub 完全开源，可自行下载修改）。",
 "abouttip": "公告已精简：原公告里的大量使用说明已移到【设置 → 关于】（数据与存储 / 常见问题 / 使用说明）。有问题先去那里找答案，再去报修。",
 "browser": "安卓用户 · 请勿使用手机自带浏览器 安卓手机不建议使用自带浏览器打开本站（小米 / 华为 / OPPO / vivo / 荣耀 / 夸克等），自带浏览器兼容问题多。已实测出现：点导入 / 添加按钮没反应（系统相册弹不出来）、显示错位、卡顿等。 建议改用 Chrome 或 Edge 浏览器打开本站；或在浏览器菜单里「添加到主屏幕 / 安装应用」，之后从桌面图标进入。",
 "ioshome": "iPhone / iPad 用户 · 请把本站「添加到主屏幕」再用 iPhone 上数据总是丢，多半就是没装到主屏幕：Safari 会在连续 7 天没打开本站后自动清空它的全部本地数据（Apple 的隐私策略，网站躲不过）；手机存储紧张时，系统也会回收网页数据。 把本站「添加到主屏幕」、之后从桌面图标打开，能明显改善这一点（主屏幕应用不计入那 7 天）。做法：用 Safari 打开本站 → 点底部中间的「分享」按钮（方框加箭头）→「添加到主屏幕」→ 再从手机桌面点新图标进入。 注意：主屏幕应用与 Safari 是两套独立存储，切换前先在 设置 → 通用 →「导出数据」导一份完整备份，切过去后再「导入数据」恢复；平时都从桌面图标打开用。（安卓没有这条 7 天规则，但存储紧张时系统同样会清网页数据，所以两种手机都要定期导出备份。）",
 "what": "使用前提 · 先认清本站是什么 本站是字卡传讯，纯代码运行，没有任何 AI，不是小手机。请至少了解什么是字卡传讯、使用过其他传讯网站，再进行使用。 本站不是小手机，请勿带 #小手机 等相关 tag 发帖引流。作者做这个站只是为了方便字卡传讯交流，不是为了扩圈；现在使用的人越来越多，请大家保持基本的礼貌与规则，不要扩圈、刷屏引流，谢谢。",
 "disclaimer": "免责声明 本站禁止未满 18 周岁的未成年人使用。点击进入即视为你确认已年满 18 周岁，并已阅读、理解并同意本页全部说明。 1. 本站所有字卡回复、TA 的消息与互动均为预先编写的随机代码随机触发，纯属虚构娱乐，不代表任何真实人物的观点、承诺或情感，不具备任何真实、法律、医疗、心理或情感效力。 2. 本站的虚拟互动不能替代、也不应替代真实的人际交往、恋爱关系、心理疏导或专业帮助。如果你正处于情绪低落、焦虑或其他心理困境，请及时向家人朋友求助，或前往正规医疗机构、心理援助热线（全国心理援助热线：12356）寻求专业支持。 3. 使用本站产生的一切后果（包括但不限于情绪影响、时间消耗、数据丢失、设备问题）由使用者本人自行承担；未成年人违规使用的，相关责任由其本人及监护人承担。作者不承担任何直接或间接责任。 4. 本站无后端服务器，所有数据仅保存在你自己的设备浏览器中，清除浏览器数据、卸载、换机、iOS 系统回收存储均会导致数据丢失，请务必定期导出备份；作者无法找回任何丢失数据。",
 "cardlock": "防未成年人 · 系统内置字卡已锁定 系统内置字卡已全部锁定，这是面向未成年人的保护措施，不是 bug。锁定影响：默认聊天字卡、词典（含词典拼字）、其他系统预设互动字卡全部停用；你自建的字卡与情绪 / 心意 / 意图字卡不受影响。豁免说明（#499）：聊天情绪字卡、TA 的心情、聊天回应字卡这三大互动链不受锁定影响，未解锁也照常触发与抽取。所以若发现「某功能开关都开了却没效果」，先看是不是锁定中。不输密码也能正常使用全部功能，密码只管两件事：解锁系统内置字卡、跳过开屏的 2 个问答。注意：锁定时若自定义字卡（含 mj 字卡）一张都没添加，回复会更单薄（情绪/回应字卡仍在，但少了系统预设内容），自己在自定义字卡里添加几张即可。密码一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）——不是第二页「进入前 · 作者必读公告」上那两个日期，也不是开屏最底下的部署时间（那只是用来判断有没有更新到新版本）。这个密码与开屏问答页的「暗号」是同一个。解开密码请勿二传（不要告诉别人），一旦有人二传，密码就会被重新设置。 输入密码解锁",
 "brandcard": "mochi 摸鱼字卡 小红书@言序（1842523578） · 抖音@言序（58334080131） 设计与开发均由作者@言序 一个人独立完成。 「Mochi」这个名字与 milk 字卡没有关系，就是想取个简单的名字取的。本文因为有人公开二传本站链接，将其理解为新的 milk 二改字卡，故特此解释：本站不是 milk 字卡代码的二改版本，是从零开始独立编写的字卡传讯二创作品。 本人原作，本人部署。 使用网站为：https://ling233330-star.github.io/mochi/ github库为：https://github.com/ling233330-star/mochi 除上述使用网站（本人原作、本人部署）外，其他非作者本人发布的版本，均是因本作开放二传二改权限而产生的二传/二改版，并非本站原版，特此说明。",
 "summary": "必读摘要【有问题先去「关于」找答案，再去报修】原公告里大部分解答过的问题已移动至【设置 → 关于】：数据丢失 / 浏览器自动清数据 / 存储权限 / 无痕模式 / 备份恢复 / 会不会做成 App / 全屏失效等。打开路径：设置 → 关于 →「数据与存储（重要）」「常见问题」「使用说明」。【本站内容非常多，不适用建议不使用】网站本质只是工具、使用取决于个人，各种原因都需要适应和调整；内置内容非常非常多，不适用建议不使用这个网站，或给一定时间适应。觉得不好用的地方基本都能自己调、自己关，所有设置一直都是全部公开的：各类概率与很多功能的时间/间隔（设置 → 回复设置，调 0 = 不触发）、系统预设字卡可逐张或按分类开关（回复设置 →「系统预设字卡 · 聊天触发概率」把整体概率总档调到 0，聊天里所有系统预设字卡都不再触发）、一些功能可以自己设置关闭（设置里的各项开关，或收进桌面隐藏池）、聊天字卡可以单独关闭某个分组（分组标题右侧的「整组停用」开关）或关闭某一张字卡（逐张开关）；默认聊天字卡的词典字卡太多：字卡库 → 词典（与默认聊天字卡同属系统预设）可把不用的分组整组停用、或逐张关闭（该页顶部也有同款标红提醒）。找不到就用设置页顶部的搜索框搜关键词。【安卓用户必读】不建议使用手机自带浏览器（小米/华为/OPPO/vivo/荣耀/夸克等）打开本站——自带浏览器兼容问题多，已实测出现「点导入/添加按钮没反应（系统相册弹不出来）」、显示错位等。建议改用 Chrome 或 Edge 浏览器，或在浏览器菜单里「添加到主屏幕/安装应用」后从桌面图标进入（详见『浏览器兼容提醒』章）。【iPhone 用户必读】请把本站「添加到主屏幕」后再用：Safari 会在连续 7 天没打开本站后自动清空它的全部本地数据，存储紧张时系统也会回收网页数据；添加到主屏幕、从桌面图标打开能明显改善。做法：Safari 打开本站 → 底部中间的「分享」按钮 →「添加到主屏幕」。注意主屏幕应用与 Safari 是两套独立存储，先「导出数据」备份、切过去后再「导入数据」恢复（详见『iPhone 用户必读：把本站「添加到主屏幕」再用』章）。本站完全免费，个人出资搭建、代码开源，开放二传二改但禁止以盈利为目的；二传、分享必须标注署名：小红书 @言序（1842523578），严禁收费倒卖。作者已决定月底停更、互助群月底解散（详见『互助群公告』章）。本站禁止未满 18 周岁的未成年人使用；字卡回复均为随机代码生成、纯属虚构娱乐，不能替代真实人际交往与专业心理帮助；点击进入即视为已阅读并同意本页全部说明，使用后果由使用者本人自行承担，作者不承担任何责任。关于二级验证密码（暗号）：6 位数字，前两位是 99，后 4 位是 mochi 字卡生日的字面数字（生日写在开屏第一页的章节目录里——点开第一页顶部的「目录」逐章翻一下就能找到；不是第二页「进入前 · 作者必读公告」上那两个日期，也不是最底下的部署时间）。解开后请勿二传。数据丢失属浏览器正常概率，请定期备份：本机不保留任何自动副本，你导出的文件就是唯一备份。TA 的主动消息、字卡等均按概率随机触发，嫌频繁可在 设置 → 回复设置 或 字卡库 → 其他互动功能字卡 调低（0 = 不触发）。完整说明在各章节内，可点上方目录跳转查看。",
 "noticeTitle": "Mochi字卡 · 开屏说明"
};

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const PROBE = `(function(){
  var norm = function(s){ return (s||'').replace(/\\s+/g,' ').trim(); };
  var box = document.getElementById('splash-box');
  var must = document.getElementById('splash-mustread');
  var brand = document.querySelector('.splash-brandcard');
  var notice = document.getElementById('splash-notice');
  var big = document.querySelector('.splash-bigwarn');
  var disc = document.querySelector('.splash-alert[data-anti-scam="d"]');
  var cs = function(el){ return el ? getComputedStyle(el) : null; };
  var cards = must ? Array.prototype.slice.call(must.children) : [];
  var cardInfo = cards.map(function(c){
    var t = c.querySelector('.splash-alert-t, .splash-stopupdate-t, .splash-bigwarn-t') || c.querySelector('p');
    var g = cs(c);
    return { cls: c.className, id: c.id || '', tag: c.getAttribute('data-anti-scam') || c.getAttribute('data-stop-update') || c.getAttribute('data-about-tip') || c.getAttribute('data-browser-warn') || '',
      title: t ? norm(t.textContent) : '', bg: g.backgroundColor, bl: g.borderLeftColor };
  });
  var brandCards = brand ? brand.querySelectorAll('[data-anti-scam],[data-stop-update],[data-about-tip],[data-browser-warn]').length : -1;
  var noticeCards = notice ? notice.querySelectorAll('.splash-alert, .splash-stopupdate, .splash-abouttip').length : -1;
  var reds = [];
  Array.prototype.forEach.call(document.querySelectorAll('.splash-box .splash-alert, .splash-box .splash-stopupdate, .splash-box .splash-abouttip, .splash-box .splash-bigwarn'), function(el){
    var g = cs(el);
    var t = el.querySelector('.splash-alert-t, .splash-stopupdate-t, .splash-bigwarn-t');
    var REDS = { 'rgb(210, 52, 48)': 1, 'rgb(255, 107, 107)': 1, 'rgb(224, 85, 85)': 1 };
    if (REDS[g.borderLeftColor]) reds.push(t ? norm(t.textContent) : '');
  });
  return {
    hasMust: !!must,
    boxChildren: box ? Array.prototype.slice.call(box.children).map(function(c){ return c.className; }) : [],
    mustBeforeBrand: !!(must && brand && (must.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    mustBeforeNotice: !!(must && notice && (must.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    bigFirst: !!(box && big && box.firstElementChild === big),
    brandCards: brandCards, noticeCards: noticeCards,
    cardInfo: cardInfo,
    reds: reds,
    noHOverflow: !!(box && box.scrollWidth <= box.clientWidth + 1),
    texts: {
      bigwarn: norm(big ? big.textContent : null),
      antiscam: norm((document.querySelector('.splash-alert[data-anti-scam="1"]') || {}).textContent),
      stopupdate: norm((document.querySelector('[data-stop-update]') || {}).textContent),
      abouttip: norm((document.querySelector('[data-about-tip]') || {}).textContent),
      browser: norm((document.querySelector('[data-browser-warn]') || {}).textContent),
      ioshome: norm((document.querySelector('[data-ios-home]') || {}).textContent),
      what: norm((document.querySelector('.splash-alert[data-anti-scam="w"]') || {}).textContent),
      disclaimer: norm(disc ? disc.textContent : null),
      cardlock: norm((document.getElementById('splash-cardlock') || {}).textContent),
      brandcard: norm(brand ? brand.textContent : null),
      summary: norm((document.querySelector('.splash-summary') || {}).textContent),
      noticeTitle: norm((document.querySelector('.splash-notice-title') || {}).textContent)
    },
    whatStyle: (function(){ var w = document.querySelector('.splash-alert[data-anti-scam="w"]'); var a = document.querySelector('.splash-alert[data-anti-scam="1"]'); if(!w||!a) return {}; return { what: cs(w).borderLeftColor, antiscam: cs(a).borderLeftColor }; })(),
    lockColor: (function(){ var l = document.getElementById('splash-cardlock'); return l ? cs(l).borderLeftColor : ''; })(),
    iosColor: (function(){ var l = document.querySelector('[data-ios-home]'); return l ? cs(l).borderLeftColor : ''; })(),
    discColor: disc ? cs(disc).borderLeftColor : ''
  };
})()`;

await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForFunction(() => !!document.getElementById('splash-mustread'), null, { timeout: 20000 }).catch(() => {});
await sleep(1600);
let s = await page.evaluate(PROBE);

// ===== 位置：必读卡组整组在品牌卡之前 =====
ok(s.hasMust, 'S1 存在必读卡组容器 #splash-mustread');
ok(s.bigFirst, 'S2 开屏第一位仍是 #973 顶卡（#splash-bigwarn）', JSON.stringify(s.boxChildren.slice(0, 3)));
ok(s.mustBeforeBrand && s.mustBeforeNotice, 'S3 必读卡组排在品牌卡与公告卡之前（用户点名「必读卡挪到品牌卡前」）');
ok(s.brandCards === 0, 'S4 品牌卡内不再夹带必读卡（原先 2 张）', 'brandCards=' + s.brandCards);
ok(s.noticeCards === 0, 'S5 公告卡内不再夹带必读卡（原先 5 张）', 'noticeCards=' + s.noticeCards);

// ===== 组内 8 张齐全、有序、各 1 份 =====
// v8.29 #991（用户直派「安卓不要用手机自带的默认浏览器……和 ios 要添加到主屏幕，这个也要写在开屏显眼的地方」）
//   在「安卓浏览器」卡之后新增第 5 张「iPhone / iPad 添加到主屏幕」卡（琥珀＝#976 定的「需要你操作」族）；
//   本表随之 +1，其余 7 张的顺序与文本一字未动（S8.* 快照逐块比对仍在守）。
const WANT = [
  ['data-anti-scam="1"', '免费 · 署名 · 防倒卖'],
  ['data-about-tip="1"', '公告已精简：原公告里的大量使用说明已移到【设置 → 关于】'],
  ['data-stop-update="1"', '停更公告 · 2026年9月底后永久停更'],
  ['data-browser-warn="1"', '安卓用户 · 请勿使用手机自带浏览器'],
  ['data-ios-home="1"', 'iPhone / iPad 用户 · 请把本站「添加到主屏幕」再用'],
  ['data-anti-scam="w"', '使用前提 · 先认清本站是什么'],
  ['data-anti-scam="d"', '免责声明'],
  ['id="splash-cardlock"', '防未成年人 · 系统内置字卡已锁定']
];
ok(s.cardInfo.length === 8, 'S6 组内恰好 8 张必读卡（无重复、无遗漏）', 'n=' + s.cardInfo.length);
WANT.forEach((w, i) => {
  const c = s.cardInfo[i];
  // 有标题元素的卡 lead＝标题；无标题元素（.splash-abouttip）lead＝首个 <p> 全文，故按前缀判
  ok(!!c && c.title.indexOf(w[1]) === 0, 'S7.' + (i + 1) + ' 第 ' + (i + 1) + ' 张＝' + w[1], c ? c.title.slice(0, 40) : 'missing');
});

// ===== 一字未删：与改前文本快照逐块比对 =====
Object.keys(SNAPSHOT).forEach((k) => {
  const a = SNAPSHOT[k] || '';
  const b = (s.texts[k] === undefined ? null : s.texts[k]) || '';
  if (k === 'brandcard') return; // 单独判：品牌卡少了已搬走的两张卡的正文，属位置变化
  ok(a === b, 'S8.' + k + ' 文本与改前快照逐字相同（' + a.length + ' 字）', a === b ? '' : 'now=' + b.slice(0, 60));
});
// 品牌卡：期望＝快照文本把「停更公告 + 公告已精简」两段原文整体剔除（只搬位置、不改字）
const brandWant = (SNAPSHOT.brandcard.split(SNAPSHOT.stopupdate).join(' ').split(SNAPSHOT.abouttip).join(' ')).replace(/\s+/g, ' ').trim();
ok(brandWant === s.texts.brandcard, 'S8.brandcard 品牌卡＝快照原文剔除两张已搬走的卡后逐字相同（只搬位置、未改字）', brandWant === s.texts.brandcard ? '' : 'want=' + brandWant.slice(0, 50) + ' | now=' + (s.texts.brandcard || '').slice(0, 50));

// ===== 颜色语义：红恰好 2 处 =====
ok(s.reds.length === 2, 'S9 全开屏红色警示块恰好 2 处（顶卡 + 免责声明）', JSON.stringify(s.reds));
ok(s.reds[0] && /使用前必看/.test(s.reds[0]), 'S10 第一处红＝#973 顶卡「使用前必看」', s.reds[0]);
ok(s.reds[1] === '免责声明', 'S11 第二处红＝免责声明', s.reds[1]);
const orange = s.cardInfo.filter((c) => c.bl === 'rgb(232, 89, 12)').map((c) => c.title.slice(0, 12));
ok(orange.length === 3, 'S12 橙（须知/提醒）恰好 3 张：停更公告 / 公告已精简 / 安卓浏览器', JSON.stringify(orange));
ok(s.whatStyle.what === s.whatStyle.antiscam, 'S13 使用前提已回落灰族（与防倒卖卡同色，蓝色专属色撤除）', JSON.stringify(s.whatStyle));
ok(s.lockColor === 'rgb(192, 127, 31)', 'S14 系统内置字卡锁保留琥珀（需要你操作）', s.lockColor);
ok(s.iosColor === 'rgb(192, 127, 31)', 'S14b #991 新增的 iPhone「添加到主屏幕」卡＝同一琥珀族（需要你操作），未占用橙/红名额', s.iosColor);
ok(s.noHOverflow, 'S15 新布局未把开屏撑出横向溢出');

// 暗色主题：红/橙/琥珀三色各自换到暗色值（不得有块退回无色/透明）
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await sleep(200);
const dk = await page.evaluate(PROBE);
ok(dk.reds.length === 2 && dk.cardInfo.filter((c) => c.bl === 'rgb(255, 138, 61)').length === 3, 'S16 暗色主题下红仍 2 处、橙仍 3 张（橙切到 #ff8a3d）', JSON.stringify(dk.cardInfo.map((c) => c.bl)));
ok(dk.lockColor === 'rgb(217, 154, 58)', 'S17 暗色主题下字卡锁仍为琥珀', dk.lockColor);
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
await sleep(150);

// ===== 防倒卖回填：删卡后必须补回组内首位（搬容器后最容易断的就是这条） =====
await page.evaluate(() => { const a = document.querySelector('.splash-alert[data-anti-scam="1"]'); if (a) a.remove(); });
const back = await page.waitForFunction(() => {
  const m = document.getElementById('splash-mustread');
  const a = m && m.querySelector('.splash-alert[data-anti-scam="1"]');
  return !!a && m.firstElementChild === a && a.textContent.indexOf('倒卖') > -1;
}, null, { timeout: 9000 }).then(() => true).catch(() => false);
ok(back, 'B1 防倒卖卡被删后回填到必读卡组首位（回填宿主随容器同步）');

// ===== 进入门控零回归 =====
const pre = await page.evaluate(() => {
  const b = document.getElementById('splash-enter');
  const c = document.getElementById('splash-age-check');
  if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
  return { hidden: b ? b.hidden : null, disabled: b ? b.classList.contains('is-disabled') : null };
});
ok(pre.hidden === true || pre.disabled === true, 'B2 未滑到底时进入按钮不可点（门控在）', JSON.stringify(pre));
await page.evaluate(() => { const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight; });
await sleep(900);
const post = await page.evaluate(() => { const b = document.getElementById('splash-enter'); return { hidden: b.hidden, disabled: b.classList.contains('is-disabled') }; });
ok(post.hidden === false && post.disabled === false, 'B3 滑到底后进入按钮可点', JSON.stringify(post));
await page.evaluate(() => document.getElementById('splash-enter').click());
await sleep(700);
ok(await page.evaluate(() => { const m = document.getElementById('splash-mandatory'); return !!m && !m.hidden; }), 'B4 点进入后强制公告层照常弹出');
await page.evaluate(() => { const sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight; });
const mandReady = await page.waitForFunction(() => { const e = document.getElementById('splash-mandatory-enter'); return !!e && !e.classList.contains('is-disabled'); }, null, { timeout: 6000 }).then(() => true).catch(() => false);
ok(mandReady, 'B5 强制公告层滑到底后确认按钮转为可点');
await page.evaluate(() => { const e = document.getElementById('splash-mandatory-enter'); if (e && !e.classList.contains('is-disabled')) e.click(); });
await sleep(1200);
ok(await page.evaluate(() => { const s = document.getElementById('splash'); return !s || s.classList.contains('hide') || s.hidden; }), 'B6 确认后正常进入（开屏隐藏）');

await browser.close();
srv.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' verify-976-splash-order-colors: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
