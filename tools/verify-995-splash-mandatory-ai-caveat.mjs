// verify-995-splash-mandatory-ai-caveat.mjs — #995 开屏二页（进入前 · 作者必读公告）新增「让 AI 修」的三段实话（常驻）
// 用户直派（2026-09-21）：「开屏二页需要新增」＋三段定稿文案——
//   ①虽然建议使用 AI，但建议不要 100% 依赖和信任 AI……作者也是 0 经验开搓的，AI 需要一直自己调；
//   ②mochi 网站做了一个半月，永久停更后不解答任何问题、请自己解决，代码一直全部开源 可查看、可学习、可二改；
//   ③关于上面推荐的那两个可以白嫖一点点的 AI：是目前的额度，以后不知道，仅供参考。
// 落点：src/template.html 的 #splash-mandatory（页 2 强制公告）正文尾，排在 2026.09.14 建议卡之后、
//   「—— 公告完 ——」之前；纯静态 DOM，门控（clock.js mandBottom/finishEnter）与 notice.json 均未动。
// 断言面：src 三段逐字在位 ／ 位置（页 2 正文内、两张旧卡之后、公告完之前） ／ 旧内容一字未删 ／
//   notice.json 零夹带 ／ 哨兵 #995a~e 登记与 needle 唯一性 ／ 产物已接入 ／ 无头真机走完进入流程后可见且门控未被绕过。
// 用法：node tools/verify-995-splash-mandatory-ai-caveat.mjs
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

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const nw = (s) => String(s || '').replace(/\s+/g, '');

// ===== 定稿文案（与 src 一字不差；改文案必须连哨兵 #995a~e 一起改） =====
const T = {
  anchor: 'id="splash-mandatory-aicaveat"',
  p1: '虽然建议使用 AI，但建议不要 100% 依赖和信任 AI。AI 也会出错和骗人。作者也是 0 经验开搓的，目前是从 2026 年 6 月~9 月积累的制作经验，问就是已经体验过了：AI 需要一直自己调，每天和 AI 话几百条。',
  p2: 'mochi 网站做了一个半月，永久停更后不解答任何问题，请自己解决；代码一直是全部开源的，可查看、可学习、可二改。',
  p3: '关于上面推荐的那两个可以白嫖一点点的 AI：是目前有一点点可以白嫖的额度，以后不知道，仅供参考。',
  endMarker: '仅供参考。</p>\n          </div>\n        </div>\n        <div class="splash-mandatory-end">',
  h: '关于让 AI 修，先说清楚几句',
  date: '2026.09.21',
};
// 上一版页 2 内容（本批必须一字未删／未改）
const OLD = {
  card1h: '月底停更，说点心里话',
  card2h: '关于不再更新网站后的建议',
  card2p: '如果是解散后，我建议可以把所有代码都下载出来，在电脑上用 Trae WorkCN 和 WorkBuddy，输入问题、你的手机型号、还有诊断信息，让 AI 给你修。',
  note: '另：本页说的「让 AI 修」和开屏公告里的「问 AI」都只是使用建议——AI 无法保证 100% 正确，AI 也会出错和骗人，AI 给的答案请自行甄别。',
};
// #975 页 1 两处口径（相邻回归冒烟）
const D1 = '「可以问 AI」只是使用建议：实际问题时去问 AI，也无法保证 100% 正确——AI 也会出错和骗人，请自行甄别。';
const D2 = '注意：AI 的回答无法保证 100% 正确——AI 也会出错和骗人，请自行甄别。';

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/'/g, "\\'");

// ===== S 系列：src 静态 =====
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const iMand = tpl.indexOf('id="splash-mandatory"');
const iCard = tpl.indexOf(T.anchor);
const iEnd = tpl.indexOf('<div class="splash-mandatory-end">');
const iOld2 = tpl.indexOf(OLD.card2h);
ok(iMand > 0 && iCard > iMand && iCard < iEnd, 'S1 新卡落在 #splash-mandatory（页 2 强制公告）正文内、且在「公告完」之前', 'mand=' + iMand + ' card=' + iCard + ' end=' + iEnd);
ok(iOld2 > 0 && iCard > iOld2, 'S2 新卡排在 2026.09.14「关于不再更新网站后的建议」卡之后（阅读顺序＝先建议后提醒）', 'old=' + iOld2 + ' card=' + iCard);
ok(tpl.split(T.p1).length - 1 === 1, 'S3 新卡第一段逐字在位（不要 100% 依赖和信任 AI）');
ok(tpl.split(T.p2).length - 1 === 1, 'S4 新卡第二段逐字在位（停更不解答 / 全开源可看可学可二改）');
ok(tpl.split(T.p3).length - 1 === 1, 'S5 新卡第三段逐字在位（两个可白嫖 AI 的额度仅供参考）');
ok(tpl.includes('>' + T.date + '<') && tpl.includes('>' + T.h + '<'), 'S6 新卡日期与标题在位（与页 2 其余卡片同构：date / h / body 三段）');
ok(tpl.split(T.endMarker).length - 1 === 1, 'S7 新卡仍紧贴「公告完」标记之前（结构锚，挪出正文尾即报警）');
ok(tpl.includes(OLD.card1h) && tpl.includes(OLD.card2h) && tpl.includes(OLD.card2p) && tpl.includes(OLD.note), 'S8 页 2 旧内容一字未删（两张旧卡标题/正文原句 + 页尾 note 原句都在）');
// 门控未动（clock.js 是页 2 放行的唯一开关，本批只加静态 DOM）
const clk = readFileSync(join(root, 'src', 'js', 'clock.js'), 'utf8');
ok(clk.includes('if (mandBottom) finishEnter();') && clk.includes('mandScroll.scrollHeight - mandScroll.scrollTop - mandScroll.clientHeight <= 8'), 'S9 强制页门控未被绕过（clock.js 仍是滑到底才 finishEnter）');
ok(tpl.includes('id="splash-mandatory-enter"') && tpl.includes('id="splash-mandatory-scroll"'), 'S10 强制页锚点齐全（确认按钮 / 滚动容器仍在）');
// notice.json 零夹带：强制页从不在线覆盖，本批文案不得跑进在线公告源（否则两处口径会各自漂移）
const jText = JSON.stringify(JSON.parse(readFileSync(join(root, 'src', 'pwa', 'notice.json'), 'utf8')));
ok(!jText.includes(nw(T.p1).slice(0, 18)) && !jText.includes('可查看、可学习、可二改') && !jText.includes('以后不知道，仅供参考。'), 'S11 在线公告源 notice.json 未被本批写入（页 2 强制公告从不接受在线覆盖）');

// ===== S 系列（续）：哨兵登记体检 =====
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const n995 = [T.anchor, '但建议不要 100% 依赖和信任 AI', '可查看、可学习、可二改', '以后不知道，仅供参考。', T.endMarker];
ok((bm.match(/\{ name: '#995[a-e] /g) || []).length === 5, 'S12 build.mjs 登记 #995a~e 共 5 条哨兵', String((bm.match(/\{ name: '#995[a-e] /g) || []).length));
const allNeedles = [...bm.matchAll(/needle: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
ok(new Set(n995.map(esc)).size === 5 && n995.every((n) => allNeedles.filter((v) => v === esc(n)).length === 1), 'S13 本批 5 条 needle 两两不同、且在全部哨兵 needle 中各只出现一次（哑哨兵零新增）', n995.map((n) => allNeedles.filter((v) => v === esc(n)).length).join(','));
const nCheck = [
  ['#995a', 'template.html', T.anchor],
  ['#995b', 'template.html', '但建议不要 100% 依赖和信任 AI'],
  ['#995c', 'template.html', '可查看、可学习、可二改'],
  ['#995d', 'template.html', '以后不知道，仅供参考。'],
  ['#995e', 'template.html', T.endMarker],
];
for (const [nm, file, nd] of nCheck) {
  const registered = bm.includes("file: '" + file + "', needle: '" + esc(nd) + "'");
  const src = readFileSync(join(root, 'src', file), 'utf8');
  const hits = src.split(nd).length - 1;
  ok(registered && hits === 1, 'S14 ' + nm + ' 登记在 ' + file + '、且 needle 在该 src 文件里恰好命中 1 次（唯一）', registered ? ('hits=' + hits) : 'not registered');
}

// ===== P 系列：产物接入 =====
const idx = readFileSync(join(root, 'index.html'), 'utf8');
ok(idx.includes(T.anchor) && idx.includes(T.p1) && idx.includes(T.p2) && idx.includes(T.p3), 'P1 产物 index.html 已接入新卡三段（构建生效，不是只在 src）');
ok(idx.includes(OLD.card2h) && idx.includes(OLD.note), 'P2 产物里页 2 旧卡与 note 仍在（本批是追加，未改写旧内容）');

// ===== B 系列：无头实测（走真实进入流程） =====
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));

await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForFunction(() => !!document.querySelector('.splash-notice-list'), null, { timeout: 20000 }).catch(() => {});
await sleep(1600);
const page1 = await page.evaluate(([d1, d2]) => {
  const t = document.body.textContent || '';
  return { d1: t.includes(d1), d2: t.includes(d2), mustread: !!document.getElementById('splash-mustread') };
}, [D1, D2]);
ok(page1.d1 && page1.d2 && page1.mustread, 'B0 页 1 相邻口径未受影响（#975 两处免责 + #976 必读组仍在）', JSON.stringify(page1));

await page.evaluate(() => {
  const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight;
  const c = document.getElementById('splash-age-check');
  if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
});
await sleep(900);
await page.evaluate(() => { const b = document.getElementById('splash-enter'); if (b) b.click(); });
await sleep(800);
const mandShown = await page.evaluate(() => { const m = document.getElementById('splash-mandatory'); return !!m && !m.hidden; });
ok(mandShown, 'B1 点「我已阅读并知晓」后页 2 强制公告照常弹出（进入流程未被新卡打断）');
const gate0 = await page.evaluate(() => { const e = document.getElementById('splash-mandatory-enter'); return { disabled: !!e && e.classList.contains('is-disabled'), hint: !!document.getElementById('splash-mandatory-hint') && !document.getElementById('splash-mandatory-hint').hidden }; });
ok(gate0.disabled && gate0.hint, 'B2 未滑到底时确认按钮仍置灰、提示仍在（新卡没有顺手解锁门控）', JSON.stringify(gate0));

const cardText = await page.evaluate(() => {
  const c = document.getElementById('splash-mandatory-aicaveat');
  return c ? (c.textContent || '') : null;
});
ok(!!cardText && cardText.includes(T.h) && cardText.includes(T.date), 'B3 新卡在页 2 DOM 里渲染出来（标题 + 日期在位）', cardText ? cardText.slice(0, 30) : 'null');
const got = nw(cardText);
ok(!!cardText && got.includes(nw(T.p1)) && got.includes(nw(T.p2)) && got.includes(nw(T.p3)), 'B4 三段定稿文案在渲染后逐字可见（页 2 正文）');

const geom = await page.evaluate(() => {
  const sc = document.getElementById('splash-mandatory-scroll');
  const cards = Array.from(sc.querySelectorAll('.splash-mandatory-card'));
  const iNew = cards.findIndex((c) => c.id === 'splash-mandatory-aicaveat');
  const end = sc.querySelector('.splash-mandatory-end');
  const c = document.getElementById('splash-mandatory-aicaveat');
  return { n: cards.length, iNew, newH: c ? c.offsetHeight : 0, newTop: c ? c.offsetTop : -1, endTop: end ? end.offsetTop : -1, scrollH: sc.scrollHeight, clientH: sc.clientHeight };
});
ok(geom.n >= 3 && geom.iNew === geom.n - 1, 'B5 新卡是页 2 最后一张卡（排在两张旧卡之后，不与旧卡穿插）', JSON.stringify(geom));
ok(geom.newH > 60 && geom.newTop > 0 && geom.newTop < geom.endTop, 'B6 新卡在正文滚动流里占据真实高度、且位于「公告完」之前', JSON.stringify({ h: geom.newH, top: geom.newTop, end: geom.endTop }));
ok(geom.scrollH > geom.clientH + 20, 'B7 页 2 仍是可滚动长页（内容高于视口，门控仍需要滑动）', geom.scrollH + '/' + geom.clientH);

await page.evaluate(() => { const sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight; });
const gate1 = await page.waitForFunction(() => { const e = document.getElementById('splash-mandatory-enter'); return !!e && !e.classList.contains('is-disabled'); }, null, { timeout: 6000 }).then(() => true).catch(() => false);
ok(gate1, 'B8 滑到底后确认按钮转为可点（门控链路完好）');
const cardSeen = await page.evaluate(() => {
  const sc = document.getElementById('splash-mandatory-scroll');
  const c = document.getElementById('splash-mandatory-aicaveat');
  if (!sc || !c) return { bottomVisible: false, inScroll: false, why: 'card missing' };
  const sr = sc.getBoundingClientRect(), cr = c.getBoundingClientRect();
  return { bottomVisible: cr.bottom <= sr.bottom + 2, inScroll: sc.scrollTop > 0 };
});
ok(cardSeen.bottomVisible && cardSeen.inScroll, 'B9 滑到底时新卡已在视口内读得到（读者确认进入前确实看得到这张卡）', JSON.stringify(cardSeen));
ok(pageErrors.length === 0, 'Z1 全程零 JS 异常', pageErrors.slice(0, 2).join(' | '));

await browser.close();
srv.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' verify-995-splash-mandatory-ai-caveat: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
