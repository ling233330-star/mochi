// verify-ios-reserved-standalone.mjs — #200 iOS 18.x standalone「系统保留状态栏」形态 行为断言
// 症状（iPhone 15 Pro + Safari 18.3 主屏幕，多 iOS 机型通用）：滑动/切换卡顿，自检
// 自动采集 ✗顶部重叠+底部少填，.phone 顶=-29/底=823。
// 根因：该形态 inner=screen−envTop（系统已垫走状态栏）但 env() 仍报真实高度——
// 既有链 ①写 --mochi-safe-top=59（双重避让）②#179 公式 safeTop+inner 把 .phone 写到
// 852 超出布局视口 793，body flex 居中裁切 + 文档恒溢出 59px 与自愈 pin 对打。
// 修复：syncVvFit 甄别命中时 _safeTop 归 0 且显式写 '0px'（摘除会回落 env()）；
//   高度 bump/fs 公式随之自然贴 inner。device.js 判定器期望底边=inner、sbTop 期望=12。
// #210 起：甄别式收敛到共享判定器 window.mochiViewportForm（device.js，执行器/诊断
//   单一事实源）——本脚本 A 段锚执行器接线，B/C 段对提取出的判定器/判定文本真机
//   信号求值（fixture 见 tools/verify-viewport-form.mjs 台账）。
// 用法：node tools/verify-ios-reserved-standalone.mjs（退出码 0=全过 1=失败）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(root, p), 'utf8');
const ma = src('src/js/mobile-adapt.js');
const device = src('src/js/device.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// ===== A. mobile-adapt.js syncVvFit：共享判定器接线 + 显式 0px + bump 分支挂 safeTop>0 =====
console.log('[A] syncVvFit 接线（#210 单一事实源）');
{
  const m = ma.match(/var _sig0 = \{[\s\S]*?var _topPx = [^\n]+\n/);
  ok(!!m, '判定接线块可定位（_sig0/_f/_topPx）');
  const blk = m ? m[0] : '';
  ok(/var _f = window\.mochiViewportForm\(_sig0\);/.test(blk), '执行器调用共享判定器（判式回退手抄此行即消失）');
  ok(/var _resStand = _f\.resStand;/.test(blk), '保留形态布尔来自判定器 resStand');
  ok(/_topPx = _safeTop \? _safeTop \+ 'px' : \(_resStand \? '0px' : ''\)/.test(blk),
    "保留形态显式写 '0px'（摘除属性会回落 env() 反而避让）");
  // 覆盖形态/已避让形态不受影响：bump 分支仍要求 _safeTop>0，高度走判定器 expBase
  ok(/if \(d\.classList\.contains\('ios-pwa-standalone'\) && _safeTop > 0 && _ih2 > 0\) \{\s*vh = _f\.expBase;/.test(ma),
    '#179 bump 分支仍挂在 _safeTop>0（保留形态=0 自然跳过，覆盖形态照旧）');
  ok(/Math\.round\(_f\.expBase\) : 0/.test(ma), 'fs 高度=判定器 expBase（含 min 屏高）');
}

// ===== B. 共享判定器行为断言（提取 device.js 判定器对真机信号求值） =====
console.log('[B] 保留形态甄别行为（共享判定器）');
{
  const cm = device.match(/window\.mochiViewportForm = function \(sig\) \{[\s\S]*?\n\};/);
  ok(!!cm, '判定器可提取');
  if (cm) {
    const judge = new Function(`'use strict';${cm[0].replace('window.mochiViewportForm = ', 'return ')}`)();
    const pxOf = (f) => (f.safeTop ? f.safeTop + 'px' : (f.resStand ? '0px' : ''));
    // 用户实机：iPhone 15 Pro iOS 18.3 standalone（inner 793 / screen 852 / env 59）
    let r = judge({ standalone: true, envTop: 59, innerH: 793, screenH: 852, iosMajor: 18 });
    ok(r.resStand === true && r.safeTop === 0 && pxOf(r) === '0px', '保留形态（59/852/793）→ safeTop=0 且显式 0px');
    ok(r.expBase === 793, '保留形态期望底边=793（贴可视区，无文档溢出）');
    // 覆盖形态（#179 设备）：iOS17 门槛不命中，bump 照旧
    r = judge({ standalone: true, envTop: 59, innerH: 793, screenH: 852, iosMajor: 17 });
    ok(r.resStand === false && r.safeTop === 59 && pxOf(r) === '59px', 'iOS17 覆盖形态（59/852/793）→ safeTop=59 不变（#179 链防回归）');
    ok(r.expBase === 852, 'iOS17 覆盖形态期望底边=852（#179 语义不变）');
    // #148 已避让形态（iOS 26）：env=0 → 不写 var（回落 env 链）
    r = judge({ standalone: true, envTop: 0, innerH: 812, screenH: 874, iosMajor: 26 });
    ok(r.resStand === false && r.safeTop === 0 && pxOf(r) === '', '已避让形态（env=0）→ 不写 var（回落 env）不变');
    // 非 standalone（#199 coverBrowser 链接管）永远不命中保留形态
    r = judge({ standalone: false, envTop: 35, innerH: 980, screenH: 980, iosMajor: 18 });
    ok(r.resStand === false && r.coverBrowser === true, '非 standalone → 不命中（#199 浏览器覆盖链不受影响）');
    // 同信号 force 声明 → 相反处理（#185/#186）
    r = judge({ standalone: true, envTop: 59, innerH: 793, screenH: 852, iosMajor: 26, safeTopForce: true });
    ok(r.resStand === false && r.safeTop === 59 && r.expBase === 852, 'force 声明 → 覆盖处理补满屏（14 Pro/26.6 声明）');
  }
}

// ===== C. device.js screenDiagJudge：保留形态期望底边=inner（修好后不误报） =====
console.log('[C] screenDiagJudge 判定器');
{
  const cm = device.match(/window\.mochiViewportForm = function \(sig\) \{[\s\S]*?\n\};/);
  const m = device.match(/function screenDiagJudge\(inp\) \{[\s\S]*?\n  \}/);
  ok(!!m && !!cm, 'screenDiagJudge/判定器可提取');
  if (m && cm) {
    const clf = new Function(`'use strict';${cm[0].replace('window.mochiViewportForm = ', 'return ')}`)();
    // 提取保留原生 const F/add/return F（#210 ⑦提示行内部引用 F——剥离式提取会断）
    let body = m[0]
      .replace(/^function screenDiagJudge\(inp\) \{/, '')
      .replace(/\n  \}$/, '');
    // 判定器经 window 参数注入（judge 体内 window.mochiViewportForm(...) 直达真实现）
    const run = (inp) => Function('inp', 'window', `'use strict'; ${body}`)(inp, { mochiViewportForm: clf });
    // 保留形态：phoneBottom=793 应判「底部贴合」；852 应判「底部超出」
    const base = { scale: 1, envTop: 59, varTop: 0, diff: 59, standalone: true, innerH: 793, screenH: 852, sbTop: 14, phoneBottom: 793, fsActive: false, iosMajor: 18 };
    let F = run({ ...base });
    ok(F.some(f => f.name.indexOf('底部贴合') >= 0 && f.ok), '保留形态底=793 → 底部贴合（期望=inner）');
    ok(!F.some(f => f.name === '顶部重叠'), '保留形态 sbTop=14 → 不再误报顶部重叠');
    ok(F.some(f => f.name.indexOf('顶部形态判定：系统保留形态') >= 0), '形态文案识别为系统保留形态');
    F = run({ ...base, phoneBottom: 852 });
    ok(F.some(f => f.name.indexOf('底部超出') === 0), '保留形态底=852（旧 bug 值）→ 报底部超出');
    // 覆盖形态（#179 设备）：底=852 贴合、sbTop=73 不误报
    const cov = { scale: 1, envTop: 59, varTop: 59, diff: 59, standalone: true, innerH: 793, screenH: 852, sbTop: 73, phoneBottom: 852, fsActive: false, iosMajor: 17 };
    F = run(cov);
    ok(F.some(f => f.name.indexOf('底部贴合') >= 0 && f.ok), 'iOS17 覆盖形态底=852 → 底部贴合（期望=envTop+inner）');
    ok(!F.some(f => f.name === '顶部重叠') && !F.some(f => f.name.indexOf('顶部双倍') >= 0), 'iOS17 覆盖形态 sbTop=73 → 顶部双判都不误报');
    F = run({ ...cov, phoneBottom: 793 });
    ok(F.some(f => f.name === '底部少填 59px 白带'), 'iOS17 覆盖形态底=793 → 仍按 #179 报少填（防回归）');
    // 浏览器覆盖形态（#199）：不变
    F = run({ scale: 1, envTop: 35, varTop: 35, diff: 0, standalone: false, innerH: 817, screenH: 817, sbTop: 45, phoneBottom: 817, fsActive: false });
    ok(F.some(f => f.name.indexOf('底部贴合') >= 0 && f.ok), '#199 浏览器覆盖形态 → 底部贴合（期望=inner）不变');
    // fsActive 期望屏高
    F = run({ ...base, fsActive: true, iosH: 793 });
    ok(!F.some(f => f.name.indexOf('--mochi-ios-h 与期望屏高不符') >= 0), '保留形态 fs 期望屏高=inner（793 不误报）');
    F = run({ ...cov, fsActive: true, iosH: 852 });
    ok(!F.some(f => f.name.indexOf('--mochi-ios-h 与期望屏高不符') >= 0), 'iOS17 覆盖形态 fs 期望屏高=envTop+inner（852 不误报）');
    F = run({ ...base, iosMajor: 17, phoneBottom: 793 });
    ok(F.some(f => f.name === '底部少填 59px 白带'), '同信号 iOS17（未命中保留形态）→ 仍走 #179 判 852（防回归）');
    // #186 force 设备：判定器曾漏传 force（死分支）+ force 期望误写 innerH（误报底部超出）
    const f186 = { scale: 1, envTop: 0, varTop: 59, diff: 59, standalone: true, innerH: 793, screenH: 852, sbTop: 14, phoneBottom: 852, fsActive: false, iosMajor: 18, force: true };
    F = run(f186);
    ok(F.some(f => f.name.indexOf('底部贴合') >= 0 && f.ok), '#186 force 设备底=852 → 底部贴合（期望=屏高，原误写 innerH 必误报超出）');
    ok(F.some(f => f.name.indexOf('覆盖形态（用户已在设置声明') >= 0), '#186 force 设备 → 形态文案=用户已声明覆盖（原漏传 force 死分支）');
    // #185 期缺陷回归：forced 设备 sbTop 期望必须=max(env,12) 而非 12（否则 14 Pro sbTop=73 误报顶部双倍）
    const f14 = { scale: 1, envTop: 59, varTop: 59, diff: 59, standalone: true, innerH: 793, screenH: 852, sbTop: 73, phoneBottom: 852, fsActive: false, iosMajor: 26, force: true };
    F = run(f14);
    ok(!F.some(f => f.name === '顶部双倍避让'), 'forced 14 Pro sbTop=73 → 不误报顶部双倍避让（expect=max(env,12)）');
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
