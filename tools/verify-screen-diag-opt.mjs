// verify-screen-diag-opt.mjs — #217 屏幕适配诊断优化批次行为断言
// 覆盖六件优化：①⑤e .phone 停靠残留判定条目（#209 同族对号）②⑤f 横向贴合判定
// ③⑦ letterbox 提示 isAndroid 门控 ④SIG 机读签名行 + 远端 ts「先更新再测」比对
// ⑤监视二次确认降噪 + 错误环 SD 先逐出 + 坏快照分级保留 ⑥离开抢拍（切页/hidden/
// pagehide 前同步存档，#209 K70「残留只存在于切页前最后一帧」盲区）。
// 判定器/采集报告为纯函数直接求值；监视/抢拍/环/档以桩件提取求值；tabs.js 钩点
// 用源码序断言。用法：node tools/verify-screen-diag-opt.mjs（退出码 0=全过）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const device = readFileSync(join(root, 'src/js/device.js'), 'utf8');
const tabs = readFileSync(join(root, 'src/js/tabs.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function extract(src, re, label) {
  const m = src.match(re);
  ok(!!m, label);
  return m ? m[0] : '';
}
function makeLS(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}
const hasF = (F, frag) => F.some((f) => !f.ok && f.name.indexOf(frag) >= 0);

// ===== 提取共享判定器与诊断判定器 =====
console.log('[提取]');
const cm = extract(device, /window\.mochiViewportForm = function \(sig\) \{[\s\S]*?\n\};/, '共享判定器 mochiViewportForm 可提取');
const mochiViewportForm = cm ? new Function(`'use strict';${cm.replace('window.mochiViewportForm = ', 'return ')}`)() : null;
const cj = extract(device, /function screenDiagJudge\(inp\) \{[\s\S]*?\n  \}/, '诊断判定器 screenDiagJudge 可提取');
const screenDiagJudge = cj ? new Function('window', cj + '\nreturn screenDiagJudge;')({ mochiViewportForm }) : null;
const cc = extract(device, /function collectScreenDiag\(remoteTs\) \{[\s\S]*?\n  \}/, 'collectScreenDiag 可提取');

// 基态 fixture：iPhone15Pro/iOS18.3 保留形态健康态（⑤e/⑤f/⑦ 未触发，全部 ✓）
const base = {
  scale: 1, envTop: 59, varTop: 59, diff: 59, innerW: 393, innerH: 793, screenW: 393, screenH: 852,
  vvW: 393, vvH: 793, dpr: 3, standalone: true, fsActive: false, iosMajor: 18,
  sbTop: 59, phoneBottom: 793, phoneH: 793, phonePadTop: '0px', iosH: 793,
  tabBottom: 759, envBottom: 34, vvOffTop: 0, vvOffLeft: 0, orientation: '竖屏',
  kb: null, kbAnd: null, phoneW: 393, phoneInlineH: '', phoneAlignSelf: '',
  tablet: false, isMobileDev: true, andr: false, htmlClass: 'ios-pwa-standalone'
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// ===== A. ⑤e .phone 停靠残留 =====
console.log('[A] ⑤e 停靠残留判定');
if (screenDiagJudge) {
  let F = screenDiagJudge(clone(base));
  ok(!hasF(F, '停靠残留'), 'A7 健康态不报停靠残留');
  F = screenDiagJudge(Object.assign(clone(base), { phoneInlineH: '600px' }));
  ok(hasF(F, '停靠残留'), 'A1 内联 height 残留且键盘非活动 → ✗');
  F = screenDiagJudge(Object.assign(clone(base), { phoneAlignSelf: 'flex-start' }));
  ok(hasF(F, '停靠残留'), 'A2 仅 alignSelf 残留 → ✗');
  F = screenDiagJudge(Object.assign(clone(base), { phoneInlineH: '600px', kb: { kbActive: true } }));
  ok(!hasF(F, '停靠残留'), 'A3 iOS 键盘会话中（kbActive）不报（内联合法）');
  F = screenDiagJudge(Object.assign(clone(base), { phoneInlineH: '600px', kbAnd: { kbActive: true, prov: false } }));
  ok(!hasF(F, '停靠残留'), 'A4 安卓键盘会话中不报');
  F = screenDiagJudge(Object.assign(clone(base), { phoneInlineH: '600px', kbAnd: { kbActive: false, prov: true } }));
  ok(!hasF(F, '停靠残留'), 'A5 安卓悬浮键盘推定停靠（prov）不报（防误报）');
  F = screenDiagJudge(Object.assign(clone(base), { phoneInlineH: '600px', vvH: 600 }));
  ok(!hasF(F, '停靠残留'), 'A6 可视高收缩 >60px（键盘视觉证据）不报');
} else { fail++; console.log('  ✗ 判定器未提取，A 段跳过即失败'); }

// ===== B. ⑤f 横向贴合 =====
console.log('[B] ⑤f 横向贴合判定');
if (screenDiagJudge) {
  let F = screenDiagJudge(Object.assign(clone(base), { phoneW: 300 }));
  ok(hasF(F, '左右露白'), 'B1 .phone 宽 300 < 393-8 → ✗ 左右露白');
  F = screenDiagJudge(Object.assign(clone(base), { phoneW: 390 }));
  ok(!hasF(F, '左右露白') && F.some((f) => f.ok && f.name.indexOf('横向贴合') >= 0), 'B2 8px 缝差容忍内 → ✓');
  F = screenDiagJudge(Object.assign(clone(base), { phoneW: 500 }));
  ok(hasF(F, '横向超出'), 'B4 横向溢出 → ✗');
  F = screenDiagJudge(Object.assign(clone(base), { phoneW: 300, tablet: true }));
  ok(hasF(F, '左右露白'), 'B3 平板同样期望全宽（#187 无限宽豁免）→ ✗');
  F = screenDiagJudge(Object.assign(clone(base), { phoneW: 390, isMobileDev: false, innerW: 800 }));
  ok(!F.some((f) => f.name.indexOf('横向') >= 0), 'B5 桌面手机壳（非移动判定）跳过横向判定');
  F = screenDiagJudge(Object.assign(clone(base), { phoneW: 360, vvW: 360 }));
  ok(F.some((f) => f.ok && f.name.indexOf('横向贴合') >= 0), 'B6 期望宽取 min(inner,vv)=360 贴合 → ✓');
}

// ===== C. ⑦ letterbox 提示 isAndroid 门控 =====
console.log('[C] ⑦ letterbox 门控');
if (screenDiagJudge) {
  let F = screenDiagJudge(Object.assign(clone(base), { fsActive: true, andr: true }));
  ok(F.some((f) => f.ok && f.name.indexOf('页外留白提示') >= 0), 'C1 全屏+安卓+全绿 → 输出页外留白提示');
  F = screenDiagJudge(Object.assign(clone(base), { fsActive: true, andr: false }));
  ok(!F.some((f) => f.name.indexOf('页外留白提示') >= 0), 'C2 iOS 全屏不输出提示（降噪）');
  F = screenDiagJudge(Object.assign(clone(base), { fsActive: true, andr: true, phoneBottom: 700 }));
  ok(!F.some((f) => f.name.indexOf('页外留白提示') >= 0), 'C3 已有 ✗ 时不输出提示（原语义保留）');
}

// ===== D. collectScreenDiag：SIG 机读行 + 版本链路比对 =====
console.log('[D] SIG 机读行与版本链路');
if (cc && screenDiagJudge) {
  const collect = new Function('collectFitInp', 'screenDiagJudge', 'sdVerCache', 'window',
    cc + '\nreturn collectScreenDiag;')(() => clone(base), screenDiagJudge, 'v3.27.x 构建 ts=1000', { mochiViewportForm });
  let r = collect(undefined);
  const sigLine = (r.text.split('\n') || []).find((l) => l.indexOf('SIG ') === 0);
  ok(!!sigLine, 'D1 报告含 SIG 机读行');
  let sig = null;
  try { sig = JSON.parse(sigLine.slice(4)); } catch (e) { sig = null; }
  ok(!!sig && sig.form === 'reserved', 'D2 SIG JSON 可解析且 form=reserved（15Pro/18.3 保留形态）');
  ok(sig && Array.isArray(sig.bad) && sig.bad.length === 0, 'D3 SIG.bad 健康态为空数组');
  ok(r.text.indexOf('版本链路') < 0, 'D4 自动监视路径（undefined）不输出版本链路行');
  r = collect(9999999999999);
  ok(r.text.indexOf('远端比本机新') >= 0, 'D5 远端 ts 新于本机 60s+ → ⚠ 建议先更新再测');
  r = collect(2000);
  ok(r.text.indexOf('本机已是最新') >= 0, 'D6 远端不新于本机 → 已是最新');
  r = collect(null);
  ok(r.text.indexOf('无法比对') >= 0, 'D7 远端获取失败 → 无法比对');
  r = collect(9999999999999);
  const sig2 = JSON.parse((r.text.split('\n').find((l) => l.indexOf('SIG ') === 0)).slice(4));
  ok(sig2.bad.length === 0, 'D8a 健康基线下 SIG.bad 为空（对照）');
  const brokenBase = clone(base);
  brokenBase.phoneBottom = 700;
  const collectBad = new Function('collectFitInp', 'screenDiagJudge', 'sdVerCache', 'window',
    cc + '\nreturn collectScreenDiag;')(() => brokenBase, screenDiagJudge, 'v3.27.x 构建 ts=1000', { mochiViewportForm });
  const rBad = collectBad(undefined);
  const sig3 = JSON.parse((rBad.text.split('\n').find((l) => l.indexOf('SIG ') === 0)).slice(4));
  ok(sig3.bad.length > 0 && sig3.bad.some((n) => n.indexOf('底部少填') >= 0), 'D8 异常 fixture 下 SIG.bad 带条目名');
} else { fail++; console.log('  ✗ collectScreenDiag 未提取，D 段跳过即失败'); }

// ===== E. sdHistSave 坏快照分级保留 =====
console.log('[E] 坏快照分级保留');
const es = extract(device, /function sdHistSave\(list\) \{[\s\S]*?\n  \}/, 'sdHistSave 可提取');
if (es) {
  const snap = (t, bad) => ({ t, bad, envTop: 59 });
  const load = (ls) => JSON.parse(ls.getItem('K') || '[]');
  let ls = makeLS();
  new Function('SD_HIST_KEY', 'localStorage', es + '\nreturn sdHistSave;')('K', ls)([
    snap(1, []), snap(2, []), snap(3, []), snap(4, []), snap(5, []), snap(6, []),
    snap(7, []), snap(8, []), snap(9, []), snap(10, []), snap(11, ['底部少填']), snap(12, ['顶部重叠'])
  ]);
  let kept = load(ls);
  ok(kept.length === 6, 'E1 10好+2坏 → 保 2坏+4好=6 条');
  ok(kept.filter((s) => s.bad.length).length === 2 && kept[0].t === 7 && kept[5].t === 12, 'E2 两条坏快照全部保留且按时间排序');
  ls = makeLS();
  new Function('SD_HIST_KEY', 'localStorage', es + '\nreturn sdHistSave;')('K', ls)([snap(1, ['a']), snap(2, ['b']), snap(3, ['c']), snap(4, ['d']), snap(5, ['e']), snap(6, ['f'])]);
  kept = load(ls);
  ok(kept.length === 4 && kept[0].t === 3, 'E3 6 坏 0 好 → 保最近 4 坏');
  ls = makeLS();
  new Function('SD_HIST_KEY', 'localStorage', es + '\nreturn sdHistSave;')('K', ls)([snap(1, []), snap(2, ['x']), snap(3, []), snap(4, []), snap(5, [])]);
  kept = load(ls);
  ok(kept.length === 5 && kept.some((s) => s.t === 2 && s.bad.length), 'E4 混合场景坏快照不被好快照冲掉（坏/好各 4 分级上限）');
}

// ===== F. sdRingPush 错误环 SD 先逐出（保 JS 错误） =====
console.log('[F] 错误环 SD 先逐出');
const fs2 = extract(device, /function sdRingPush\(names, snap\) \{[\s\S]*?\n  \}/, 'sdRingPush 可提取');
if (fs2) {
  const mk = (ls) => new Function('SD_ERR_KEY', 'localStorage', 'navigator', 'window', fs2 + '\nreturn sdRingPush;')('K', ls, { userAgent: 'UA' }, { mochiDevice: { isMobile: 1, isIOS: 1 } });
  const jsSeed = {}; jsSeed.K = JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ t: i, msg: 'TypeError at x' + i })));
  const ls1 = makeLS(jsSeed);
  const push1 = mk(ls1);
  for (let i = 0; i < 6; i++) push1('顶部重叠', { envTop: 59, varTop: 0, diff: 0, innerH: 793, phoneBottom: 700, sbTop: 0, scale: 1, trig: 'auto' });
  const arr1 = JSON.parse(ls1.getItem('K'));
  ok(arr1.length === 30, 'F1 环上限 30');
  ok(arr1.filter((e) => !/^\[屏幕适配\]/.test(e.msg)).length === 25, 'F2 SD 爆发后 25 条 JS 错误零丢失');
  const ls2 = makeLS({ K: JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ t: i, msg: 'JS err ' + i }))) });
  mk(ls2)('顶部重叠', { envTop: 1 });
  const arr2 = JSON.parse(ls2.getItem('K'));
  ok(arr2.length === 30 && arr2.every((e) => !/^\[屏幕适配\]/.test(e.msg)), 'F3 JS 满环时新 SD 条目让位（自有 hist 存档兜底），JS 零丢失');
}

// ===== G. sdTick 二次确认降噪 =====
console.log('[G] 监视二次确认');
const gs = extract(device, /let _sdLastBad = '', _sdPend = null;[\s\S]*?\n  \}/, 'sdTick 及其状态可提取');
if (gs) {
  const mkTick = () => {
    const calls = { archive: [], ring: [] };
    const win = {
      __collectScreenDiag: null,
      __mochiIosKb: null
    };
    const doc = { visibilityState: 'visible', activeElement: null };
    const snapOf = (r, trig) => ({ trig, envTop: r.inp.envTop });
    const tick = new Function('window', 'document', 'sdArchive', 'sdRingPush', 'sdSnapOf', gs + '\nreturn sdTick;')(
      win, doc,
      (r, trig) => calls.archive.push(trig),
      (names, snap) => calls.ring.push(names),
      snapOf
    );
    const badR = () => ({ findings: [{ ok: false, name: '底部少填 59px', detail: '' }], inp: { envTop: 59 } });
    return { calls, win, doc, tick, badR };
  };
  let t = mkTick();
  t.win.__collectScreenDiag = t.badR;
  t.tick(); t.tick(); t.tick();
  ok(t.calls.archive.length === 1 && t.calls.ring.length === 1, 'G1 持续坏态：首见存档 1 次、二次确认后入环恰 1 次（不再刷屏）');
  t = mkTick();
  t.win.__collectScreenDiag = t.badR;
  t.tick();
  t.win.__collectScreenDiag = () => ({ findings: [], inp: { envTop: 59 } });
  t.tick();
  ok(t.calls.archive.length === 1 && t.calls.ring.length === 0, 'G2 单采样瞬态：只存档留证据、不入错误环');
  t = mkTick();
  t.win.__collectScreenDiag = t.badR;
  t.tick();
  t.win.__collectScreenDiag = () => ({ findings: [], inp: { envTop: 59 } });
  t.tick();
  t.win.__collectScreenDiag = t.badR;
  t.tick(); t.tick();
  ok(t.calls.ring.length === 1, 'G3 好转后同形态复发 → 再走一次存档+确认入环');
  t = mkTick();
  t.doc.visibilityState = 'hidden';
  t.win.__collectScreenDiag = t.badR;
  t.tick();
  ok(t.calls.archive.length === 0 && t.calls.ring.length === 0, 'G4 后台不采集');
}

// ===== H. 离开抢拍 __mochiLeaveSnap =====
console.log('[H] 离开抢拍');
const hs = extract(device, /let _sdLeaveT = 0;[\s\S]*?\n  \};/, '离开抢拍钩子可提取');
if (hs) {
  const mk = () => {
    const archived = [];
    const win = { __collectScreenDiag: null, __mochiIosKb: null, __mochiAndroidKb: null };
    const doc = { activeElement: null };
    new Function('window', 'document', 'sdArchive', hs + '\nreturn window.__mochiLeaveSnap;')(
      win, doc, (r, trig) => archived.push(trig)
    );
    return { archived, win, snap: win.__mochiLeaveSnap };
  };
  const badColl = () => ({ findings: [{ ok: false, name: '.phone 停靠残留', detail: '' }], inp: { envTop: 0 } });
  let m = mk();
  m.win.__collectScreenDiag = badColl;
  m.snap('switch'); m.snap('switch');
  ok(m.archived.length === 1 && m.archived[0] === 'switch', 'H1 坏形态切页抢拍存档 trig=switch，3s 限频只存一次');
  m = mk();
  m.win.__collectScreenDiag = () => ({ findings: [], inp: { envTop: 0 } });
  m.snap('switch');
  ok(m.archived.length === 0, 'H2 好形态切页不存档（不刷档）');
  m = mk();
  m.win.__collectScreenDiag = badColl;
  m.win.__mochiAndroidKb = () => ({ kbActive: false, prov: true });
  m.snap('switch');
  ok(m.archived.length === 0, 'H3 安卓推定停靠期跳过（键盘会话不采）');
  m = mk();
  m.win.__collectScreenDiag = badColl;
  m.win.__mochiIosKb = () => ({ kbActive: true });
  m.snap('switch');
  ok(m.archived.length === 0, 'H4 iOS 键盘会话跳过');
  m = mk();
  m.win.__collectScreenDiag = badColl;
  m.snap('hide');
  ok(m.archived.length === 1 && m.archived[0] === 'hide', 'H5 hidden/pagehide 抢拍 trig=hide');
}

// ===== I. tabs.js 切页前抢拍钩点（源码序断言） =====
console.log('[I] tabs.js 钩点');
ok(tabs.indexOf('const sdLeaveSnap = () =>') >= 0, 'I1 sdLeaveSnap 钩子已定义');
ok(tabs.indexOf('const sdLeaveSnap = () =>') < tabs.indexOf('pages.forEach(p => p.hidden = true)'), 'I2 钩子定义在首次切页点之前');
ok((tabs.match(/sdLeaveSnap\(\)/g) || []).length >= 3, 'I3 tab 点击/外观/主题返回三处切页前调用（≥3）');
const popIdx = tabs.indexOf("window.addEventListener('popstate'");
ok(popIdx >= 0 && tabs.indexOf("window.__mochiLeaveSnap('switch')", popIdx) > popIdx, 'I4 返回键回退页 hidden 前直调钩子');

// ===== J. device.js 抢拍挂接点（源码锚断言） =====
console.log('[J] device.js 挂接点');
ok(device.indexOf("sdPgMo.observe(p, { attributes: true, attributeFilter: ['hidden'] })") >= 0, 'J1 .page hidden 微任务观察器已注册（先于 syncChrome blur）');
ok(device.indexOf("else window.__mochiLeaveSnap('hide')") >= 0, 'J2 visibilitychange→hidden 抢拍');
ok(device.indexOf("window.addEventListener('pagehide', function () { window.__mochiLeaveSnap('hide'); })") >= 0, 'J3 pagehide 抢拍');

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
