// verify-ios-kb-stuck.mjs — #208 键盘收起视口未还原（输入栏上移+底部白带）行为断言
// 症状（苹果17 自带浏览器 iOS 18.7 standalone 全屏模式，多机型反复）：
//   聊天页输入栏下面一条白边不贴底、整体上移；自动采集连环误报「底部导航栏悬空」。
// 根因三层：
//   ① iOS standalone 键盘收起时 WebKit 偶发不把视口还原到基线（差 >60px），
//      restoreKb 的「确已还原」门槛 `vv.height >= _fullVv-60` 永不满足 → _kbActive
//      卡真、.phone 卡收缩高 → 输入栏上移+白带（mobile-adapt.js，本修复加 4s 自愈）；
//   ② 聊天页打开时 tabs.js 给 .tabbar 挂 hidden（display:none）→ 矩形全 0 被判
//      「底部导航栏悬空 860px」刷错误环（device.js 采集器，本修复 hidden/零矩形→null）；
//   ③ 保留形态设备切后台回来瞬态 inner=整屏（diff=0）→ 判定器误报「顶部重叠」
//      （device.js 判定器，本修复加 diff≥envTop−8 守卫）+新增⑤d「布局视口未贴底」
//      让白带状态本身可被诊断看见（④照 inner 判贴合会全绿漏报）。
// 用法：node tools/verify-ios-kb-stuck.mjs（退出码 0=全过 1=失败）
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

// ===== A. mobile-adapt.js：键盘收起未还原自愈（4s 失焦 + 视口仍 < 基线−60） =====
console.log('[A] 键盘收起未还原自愈（healViewport else-if(_kbActive) 分支）');
{
  const m = ma.match(/else if \(_kbActive\) \{[\s\S]*?\n          \} else if \(!foc\) \{/);
  ok(!!m, 'healViewport 键盘会话分支可定位');
  const blk = m ? m[0] : '';
  // 逻辑锚点：失焦计时 + 视口未还原门槛 + 强制复原
  ok(/!foc && _focLostAt && Date\.now\(\) - _focLostAt > 4000 && _vv && _vv\.height < _fullVv - 60[\s\S]*?restoreKb\(\)/.test(blk),
    '自愈条件：!foc && 失焦>4s && vv.height < _fullVv−60 → restoreKb()');
  ok(/_focLostAt = 0;/.test(ma), 'focusin 归零 _focLostAt（再聚焦即解除武装）');
  ok(/e\.target === _textFocused\) \{ _textFocused = null; _focLostAt = Date\.now\(\); \}/.test(ma),
    'focusout 盖时间戳（失焦才开始计时）');
  // 四场景求值
  const evalIt = (foc, lostMsAgo, vvH, fullVv) => (!foc && lostMsAgo != null && lostMsAgo > 4000 && vvH < fullVv - 60);
  ok(evalIt(false, 5000, 700, 894) === true, '卡死场景（失焦5s、视口700<834）→ 触发自愈');
  ok(evalIt(false, 2000, 700, 894) === false, '失焦仅2s（合法停靠窗口）→ 不触发');
  ok(evalIt(true, 9999, 700, 894) === false, '聚焦中（键盘真开着）→ 不触发');
  ok(evalIt(false, 5000, 880, 894) === false, '视口已还原（880≥834）→ 不触发（原 60px 门槛语义不变）');
  // restoreKb 仍挂在「确已还原」门槛后（原语义保留，4s 兜底只补漏）
  ok(/if \(_vv && _vv\.height >= _fullVv - 60\) restoreKb\(\);/.test(ma),
    '原「确已还原即复原」门槛保留（250ms 轮询路径不回归）');
}

// ===== B. device.js 采集器：tabbar hidden/零矩形 → null（聊天页不再误报悬空） =====
console.log('[B] 采集器 tabbar 隐藏跳过');
{
  const m = device.match(/tabBottom: \(function \(\) \{[\s\S]*?\}\)\(\),/);
  ok(!!m, 'tabBottom 采集表达式可定位');
  const blk = m ? m[0] : '';
  ok(/if \(!tb \|\| tb\.hidden\) return null;/.test(blk), 'hidden 属性 → null（tabs.js 全屏页隐藏 tabbar）');
  ok(/if \(r\.width === 0 && r\.height === 0\) return null;/.test(blk), 'display:none 零矩形 → null');
  // 判定器 ⑤b 对 null 跳过（既有行为，防回归确认）
  ok(/if \(inp\.tabBottom != null && inp\.innerH\) \{/.test(device), '判定器 ⑤b 仅在 tabBottom 非 null 时判（跳过语义不变）');
  // 场景求值：聊天页 tabbar rect 全 0 → null → ⑤b 不产「悬空」
  const collect = (tbExists, hidden, w, h) => {
    if (!tbExists) return null;
    if (hidden) return null;
    if (w === 0 && h === 0) return null;
    return 860;
  };
  ok(collect(true, true, 0, 0) === null, '聊天页（tabbar hidden）→ null → 不判悬空');
  ok(collect(true, false, 0, 0) === null, 'display:none 零矩形 → null → 不判悬空');
  ok(collect(true, false, 390, 49) === 860, '桌面页 tabbar 可见 → 正常返回底边');
}

// ===== C. device.js 判定器：⑤d 布局视口未贴底 + ③ 顶部重叠 diff 守卫 =====
console.log('[C] screenDiagJudge 判定器');
{
  const m = device.match(/function screenDiagJudge\(inp\) \{[\s\S]*?\n  \}/);
  // #210：判定器改调共享判定器 window.mochiViewportForm——提取体求值时注入真实现
  const cm = device.match(/window\.mochiViewportForm = function \(sig\) \{[\s\S]*?\n\};/);
  ok(!!m, 'screenDiagJudge 可提取');
  if (m) {
    const clf = cm ? new Function(`'use strict';${cm[0].replace('window.mochiViewportForm = ', 'return ')}`)() : null;
    // 提取保留原生 const F/add/return F（#210 ⑦提示行内部引用 F——剥离式提取会断）
    let body = m[0]
      .replace(/^function screenDiagJudge\(inp\) \{/, '')
      .replace(/\n  \}$/, '');
    const run = (inp) => Function('inp', 'window', `'use strict'; ${body}`)(inp, { mochiViewportForm: clf });
    // 苹果17 实机基态：iPhone17 / iOS18.7 standalone 全屏，inner 894 / screen 956 / env 62
    const base = { scale: 1, envTop: 62, varTop: 0, diff: 62, standalone: true, innerH: 894, screenH: 956, sbTop: 12, phoneBottom: 894, fsActive: true, iosH: 894, iosMajor: 18, envBottom: 34, tabBottom: 860, kb: { kbActive: false, fullInner: 894, fullVv: 894 } };
    let F = run({ ...base });
    ok(!F.some(f => !f.ok), '健康基态全绿（无任何 ✗）');
    // ⑤d：键盘收起未还原——inner 卡 830 → diff=126 > 62+24 且 kb 不活跃 → ✗未贴底
    F = run({ ...base, diff: 126, innerH: 830, phoneBottom: 830, iosH: 830, tabBottom: 796 });
    ok(F.some(f => f.name.indexOf('布局视口未贴底') === 0 && !f.ok), '视口卡 830（diff=126）→ ✗布局视口未贴底');
    ok(F.some(f => f.name.indexOf('底部贴合') >= 0 && f.ok), '同场景④按 inner 仍判贴合（证明⑤d 独立补漏的必要性）');
    // 键盘会话中：kbActive=true → ⑤d 抑制（收缩=正常停靠）
    F = run({ ...base, diff: 126, innerH: 830, phoneBottom: 830, iosH: 830, tabBottom: 796, kb: { kbActive: true, fullInner: 894, fullVv: 894 } });
    ok(!F.some(f => f.name.indexOf('布局视口未贴底') >= 0), '键盘会话中（kbActive=true）→ ⑤d 抑制');
    // ③ 守卫：切后台瞬态 inner=956（diff=0）→ 不再误报顶部重叠
    F = run({ ...base, diff: 0, innerH: 956, phoneBottom: 956, iosH: 956, sbTop: 12, tabBottom: 922 });
    ok(!F.some(f => f.name === '顶部重叠'), '瞬态 inner=整屏（diff=0）→ 不误报顶部重叠');
    // ③ 真覆盖设备（iOS17 防回归）：diff=59≈envTop、sbTop=10 → 仍要报
    const cov = { scale: 1, envTop: 59, varTop: 59, diff: 59, standalone: true, innerH: 793, screenH: 852, sbTop: 10, phoneBottom: 852, fsActive: false, iosMajor: 17, tabBottom: 818, envBottom: 34 };
    F = run({ ...cov });
    ok(F.some(f => f.name === '顶部重叠'), 'iOS17 真覆盖形态 sbTop=10 → 顶部重叠仍检出（#114 防回归）');
    ok(F.some(f => f.name.indexOf('底部贴合') >= 0 && f.ok), 'iOS17 覆盖形态底=852 贴合（#179 语义不变）');
    // #199 浏览器覆盖形态：diff=0 不触发 ③（sbTop 正常时不报，检出交给 #179/#199 哨兵）
    F = run({ scale: 1, envTop: 35, varTop: 35, diff: 0, standalone: false, innerH: 817, screenH: 817, sbTop: 45, phoneBottom: 817, fsActive: false, envBottom: 0, tabBottom: 817 });
    ok(!F.some(f => !f.ok), '#199 浏览器覆盖形态健康态仍全绿');
    // iPad 形态（#184）：env 24 / diff 0 / 全屏隐藏状态栏 sbTop=null → 不误报
    F = run({ scale: 1, envTop: 24, varTop: 0, diff: 0, standalone: true, innerH: 1180, screenH: 1180, sbTop: null, phoneBottom: 1180, fsActive: true, iosH: 1180, iosMajor: 18, envBottom: 20, tabBottom: 1160 });
    ok(!F.some(f => f.name === '顶部重叠'), 'iPad 全屏态（状态栏隐藏 sbTop=null）→ 不误报顶部重叠');
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
