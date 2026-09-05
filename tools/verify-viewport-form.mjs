// verify-viewport-form.mjs — #210 视口形态判定器（window.mochiViewportForm）真机台账断言
// 背景：iOS 屏幕适配 bug 反复以不同「形态」出现（#148 已避让/#179+#185 覆盖/#199 浏览器
// 沉浸壳/#200 iOS18 系统保留/#184 iPad/#186 force 声明）。#210 把形态判别收敛到 device.js
// 的纯函数 mochiViewportForm（执行器 syncVvFit 与诊断 screenDiagJudge 共用，单一事实源）。
// 本脚本=真机信号台账：每条 fixture 来自真机诊断实采（注释注明机型/出处），判定器输出
// 必须与真机已验证的行为一致。新机型报障 → 先对台账，没有再加分汰+登记台账行。
// 用法：node tools/verify-viewport-form.mjs（退出码 0=全过 1=失败）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const device = readFileSync(join(root, 'src/js/device.js'), 'utf8');
const ma = readFileSync(join(root, 'src/js/mobile-adapt.js'), 'utf8');
const builtIdx = (() => { try { return readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } })();

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// ===== 提取共享判定器（纯函数，Node 直接求值） =====
const cm = device.match(/window\.mochiViewportForm = function \(sig\) \{[\s\S]*?\n\};/);
ok(!!cm, '共享判定器可在 device.js 提取');
if (!cm) { console.log(`${pass} PASS / ${fail} FAIL`); process.exit(1); }
const mochiViewportForm = new Function(`'use strict';${cm[0].replace('window.mochiViewportForm = ', 'return ')}`)();
const topPxOf = (f) => (f.safeTop ? f.safeTop + 'px' : (f.resStand ? '0px' : ''));

// ===== A. 真机台账（信号 → 形态/生效 safeTop/期望底边/期望顶位） =====
console.log('[A] 真机信号台账');
const cases = [
  {
    n: 'iPhone 15 Pro · iOS 18.3 · Safari 主屏幕（#200 实测 inner793/screen852/env59）',
    sig: { standalone: true, envTop: 59, innerH: 793, screenH: 852, iosMajor: 18 },
    want: { form: 'reserved', safeTop: 0, px: '0px', expBase: 793, expTop: 12 }
  },
  {
    n: 'iPhone 16 Pro · iOS 26.1 · standalone 已避让形态（#148 实测 inner812/screen874/env0）',
    sig: { standalone: true, envTop: 0, innerH: 812, screenH: 874, iosMajor: 26 },
    want: { form: 'avoided', safeTop: 0, px: '', expBase: 812, expTop: 12 }
  },
  {
    n: 'iPhone 15 Pro · iOS 18.3 老内核 · force 声明（#186 实测 env0/diff59：safeTop=diff 兜底补满 852）',
    sig: { standalone: true, envTop: 0, innerH: 793, screenH: 852, iosMajor: 18, safeTopForce: true },
    want: { form: 'force-cover', safeTop: 59, px: '59px', expBase: 852, expTop: 12 }
  },
  {
    n: 'iPhone 14 Pro · iOS 26.6 · 覆盖形态 + force 声明（#185：信号与保留形态相同需相反处理）',
    sig: { standalone: true, envTop: 59, innerH: 793, screenH: 852, iosMajor: 26, safeTopForce: true },
    want: { form: 'force-cover', safeTop: 59, px: '59px', expBase: 852, expTop: 59 }
  },
  {
    n: 'iPad Air · standalone（#184 实测 inner1180/screen1180/env32：状态栏悬浮、高度贴 inner）',
    sig: { standalone: true, envTop: 32, innerH: 1180, screenH: 1180, iosMajor: 26 },
    want: { form: 'ipad', safeTop: 32, px: '32px', expBase: 1180, expTop: 32 }
  },
  {
    n: '荣耀 50se · 雨见沉浸壳（#199 实测 env35、screen==inner：页面避让由 safe-top 承担、.phone 贴 inner）',
    sig: { standalone: false, envTop: 35, innerH: 980, screenH: 980, iosMajor: 0 },
    want: { form: 'cover-browser', safeTop: 35, px: '35px', expBase: 980, expTop: 35 }
  },
  {
    n: 'iOS 17.x 覆盖形态 standalone（#179 设备：inner=screen−env 但 iOS<18 门槛不判保留，防回归）',
    sig: { standalone: true, envTop: 59, innerH: 793, screenH: 852, iosMajor: 17 },
    want: { form: 'covered', safeTop: 59, px: '59px', expBase: 852, expTop: 59 }
  },
  {
    n: '常规安卓浏览器带工具栏（diff≈工具条高=系统已把页面垫在浏览器 UI 下，同「已避让」语义）',
    sig: { standalone: false, envTop: 0, innerH: 780, screenH: 800, iosMajor: 0 },
    want: { form: 'avoided', safeTop: 0, px: '', expBase: 780, expTop: 12 }
  },
  {
    n: '保留形态信号但 env 超上限 160（异常值不认，回落实测链）',
    sig: { standalone: true, envTop: 200, innerH: 793, screenH: 993, iosMajor: 18 },
    want: { form: 'covered', safeTop: 0, px: '', expBase: 993, expTop: 200 }
  },
];
for (const c of cases) {
  const f = mochiViewportForm(c.sig);
  ok(f.form === c.want.form, c.n + ' → 形态 ' + f.form);
  ok(f.safeTop === c.want.safeTop && topPxOf(f) === c.want.px, '  safeTop=' + f.safeTop + ' 写法 ' + topPxOf(f));
  ok(f.expBase === c.want.expBase, '  期望底边=' + f.expBase);
  ok(f.expTop === c.want.expTop, '  期望顶位=' + f.expTop);
}
// force 开关矩阵（#185 设备信号相同需相反处理；#186 env=0 diff 兜底）四场景
{
  const f1 = mochiViewportForm({ standalone: true, envTop: 59, innerH: 793, screenH: 852, iosMajor: 18 });
  const f2 = mochiViewportForm({ standalone: true, envTop: 59, innerH: 793, screenH: 852, iosMajor: 18, safeTopForce: true });
  ok(f1.resStand === true && f1.safeTop === 0 && f1.expBase === 793, '同信号无 force → 保留形态贴 inner（15 Pro/18.3）');
  ok(f2.resStand === false && f2.safeTop === 59 && f2.expBase === 852, '同信号有 force → 覆盖处理补满屏（14 Pro/26.6 声明）');
  ok(f1.expTop === 12 && f2.expTop === 59, 'force 下期望顶位=max(env,12)（修 #186 期 sbTop expect=12 顶部双倍误报）');
  const f3 = mochiViewportForm({ standalone: true, envTop: 0, innerH: 793, screenH: 852, iosMajor: 18 });
  const f4 = mochiViewportForm({ standalone: true, envTop: 0, innerH: 793, screenH: 852, iosMajor: 18, safeTopForce: true });
  ok(f3.form === 'avoided' && f3.safeTop === 0, 'env=0 无 force → 已避让（16 Pro/26.1）');
  ok(f4.safeTop === 59 && f4.expBase === 852, 'env=0 有 force → diff 兜底 59 补满 852（#186 修白边）');
}

// ===== B. 接线：执行器/诊断/监视都走共享判定器（单一事实源不被绕开） =====
console.log('[B] 接线锚点');
ok(/var _f = window\.mochiViewportForm\(_sig0\);/.test(ma), 'syncVvFit 调用共享判定器');
ok(/var _f0 = window\.mochiViewportForm\(_sig0\);/.test(ma), 'syncVvFit 探针门槛走判定器 needEnvProbe');
ok(/vh = _f\.expBase;/.test(ma), '非全屏高度=判定器 expBase');
ok(/Math\.round\(_f\.expBase\) : 0/.test(ma), '全屏高度=判定器 expBase');
ok(/const Fm = window\.mochiViewportForm\(\{ standalone: !!inp\.standalone/.test(device), 'screenDiagJudge 调用共享判定器');
ok(/window\.visualViewport\.addEventListener\('resize', sdEdge\)/.test(device), '监视器事件沿捕获在位（#210）');
if (builtIdx) {
  ok((builtIdx.match(/mochiViewportForm/g) || []).length >= 4, '产物已接入（定义+执行器×2+诊断）');
} else {
  console.log('  （index.html 未构建，跳过产物核对）');
}

// ===== C. 判定器全屏「页外 letterbox」盲区提示（#212 实证：iQOO12 诊断全绿但用户见顶带） =====
console.log('[C] 全屏页外留白提示');
{
  const jm = device.match(/function screenDiagJudge\(inp\) \{[\s\S]*?\n  \}/);
  ok(!!jm, 'screenDiagJudge 可提取');
  if (jm) {
    const clf = new Function(`'use strict';${cm[0].replace('window.mochiViewportForm = ', 'return ')}`)();
    // 提取保留原生 const F/add/return F（#210 ⑦提示行内部引用 F——剥离式提取会断）
    let body = jm[0]
      .replace(/^function screenDiagJudge\(inp\) \{/, '')
      .replace(/\n  \}$/, '');
    const run = (inp) => Function('inp', 'window', `'use strict'; ${body}`)(inp, { mochiViewportForm: clf });
    // iQOO12 场景：全屏态页内全绿（挖孔屏 letterbox 在页面坐标系外测不到）→ 必出提示行
    // （v3.27.x #217 起提示行加 isAndroid 门控：现象是安卓 Chromium 系统层行为，
    //   iOS 无原生全屏 API 提示行纯噪声——fixture 补 andr:true，iOS 不出提示另断言）
    const fsGreen = { scale: 1, envTop: 0, varTop: 0, diff: 0, standalone: true, innerH: 894, screenH: 956, sbTop: null, phoneBottom: 894, fsActive: true, iosH: 894, iosMajor: 19, envBottom: 34, tabBottom: null, andr: true };
    let F = run({ ...fsGreen });
    ok(F.some(f => f.ok && f.name.indexOf('※ 全屏态·页外留白提示') === 0), '全屏态页内全绿 → 出页外 letterbox 提示行');
    // iOS 全屏全绿 → 不出提示（#217 isAndroid 门控降噪）
    F = run({ ...fsGreen, andr: false });
    ok(!F.some(f => f.name.indexOf('※ 全屏态·页外留白提示') === 0), 'iOS 全屏 → 不出提示（#217 门控）');
    // 全屏但有 ✗（如 ios-h 与期望不符）→ 已有 ✗ 可对号，不出提示
    F = run({ ...fsGreen, iosH: 800 });
    ok(!F.some(f => f.name.indexOf('※ 全屏态·页外留白提示') === 0), '全屏态已有 ✗ → 不出提示（以 ✗ 对号为准）');
    // 非全屏全绿 → 不出提示
    F = run({ ...fsGreen, fsActive: false, sbTop: 12, tabBottom: 860 });
    ok(!F.some(f => f.name.indexOf('※ 全屏态·页外留白提示') === 0), '非全屏 → 不出提示');
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
