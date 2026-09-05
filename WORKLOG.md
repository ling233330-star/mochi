### 2026-09-06 01:2x（#211 聊天闪动双源收口：收发消息整窗重建 200 气泡 + 归一化收尾无条件重建；本次构建者：无——本会话未构建，构建权归在途会话收口时顺带）
- [AI-A 域]（**改动文件：src/js/chat.js（①addRec 窗口超限判定 RENDER_MAX→WINDOW_MAX；②runDeferredNormalization finish 渲染闸 changedHi/removedAll/sysNickChanged）、build.mjs（#211 哨兵 +2）、FIX-REGRESSION.md（#211 行）、tools/verify-chat-rebuild.mjs（新增 13 断言，verify:all 自动纳入）**；构建状态：**未构建——修复①已随并行会话 00:47 产物 mochi-mtom8td8 在树（裹入时 chat.js 仅含修复①），修复②待下次构建带上（哨兵已登记，--check-sentinels 446 全绿哑 0）**）。
- 需求：iQOO12+Chrome 151 报「打开聊天偶尔会闪动+对方回复消息会闪一下」，用户明说其他设备型号也有。
- 根因两处（均与机型无关、与**历史条数**相关，解释了「同版本有的设备不闪」）：①addRec 窗口超限判定 `msgs.length - renderStart > RENDER_MAX` 在每次钳位渲染后（renderStart=len−200）只要再来一条消息就恒为真——历史 >200 条的桌面每收/发一条消息都整窗重建 200 个气泡（img 全部重建重新解码=肉眼闪一下）；≤200 条的桌面 renderStart=0 从不命中。②后台分批归一化 finish 曾在「发现任意改动且聊天页可见」时无条件 renderWindow 整窗重建——历史里有待迁移老格式数据时打开聊天必白闪一次（改动全在窗口外也闪）。
- 方案：①判定收紧到 WINDOW_MAX(400) 硬上限（与 loadOlderIncremental→pruneWindowBottom 同口径），常规收发走 renderMsg 增量追加，DOM 上限语义不变；②finish 记录改动最靠后下标 changedHi 与结构性删除数 removedAll——改动全部在窗口外（changedHi<renderStart）时跳过重建只落盘，屏上数据真变了仍重渲，sysNick 清扫/相邻删除（下标位移）保守整窗。
- 验证：node --check 过；tools/verify-chat-rebuild.mjs 13/13（S0-S4 无头 Chrome 实测 9MB 懒读大历史：打开静置/对方回复/自己发送零整窗重建+回复走增量追加，MutationObserver 分类；G1-G4 抽 chat.js 真实源码桩环境验渲染闸四场景）；verify-chat-tail 27/27、quote-image 21/21、media-pool 8/8；tmp 探针已删。
- 待对方处理：无。chat.js 本会话只占 #211 两处（2840 附近/622-660），#215 在途区域（输入栏取值）与之无交集；下次构建请带上修复②（构建自然包含）。
- 【真机:待验证】（iQOO12 及任意大历史桌面）：打开聊天与连收多条消息，消息区均不再整屏闪；小历史设备行为不变。

### 2026-09-06 01:1x（信息诊断错误环三补强：条目带版本+启动序号、案发视口现场、去重计次；未构建·随在途联合批次收口）
- [AI-B 域]（**改动文件：src/js/device.js（复制诊断模块：errSnap 补 v（版本）/b（启动 id#N）字段 + pushErr 时 mochiVvDiag 六值迷你现场 vp（fs/vv/gap/平移/scale/kb，~50 字符）；30s 去重改累加次数 c；报告头部时间行带「本次启动 id#N」、最近错误逐条输出 [版本]/启动/×N/｛现场｝，旧条目与监视器直写条目无字段自然省略）**；构建状态：**未构建**——树内 #211/#215/#210/#216 联合批次 staged 在途（其 device.js 改动仅 ~1972 行 mochiViewportForm 一处，与本改 300-380/730/1216 三段零重叠已 git diff 核实），构建权留收口会话随库打入）。
- 背景：用户问【信息诊断】还能怎么优化，八条建议中指定 1/2/7 落地（错误归属/案发现场/重复计次）。
- 自验：node --check 过；--check-sentinels 446 全绿哑 0（未碰任何他人锚点）。
- 【真机:待验证】任意机型触发一次报错后打开诊断：最近错误条目带 [v3.26.x]/启动 id#N/×次数/｛现场 fs= vv= gap= 平移= s= kb=｝；报告头部「本次启动」与条目 b 对号。

### 2026-09-06 01:5x（#216 音乐封面全丢含新加（一加Ace3+Edge 多机型）+ #214 standalone 顶部黑边残留（manifest theme_color）——src/tools/台账全就绪·未构建，移交下一口构建者随库；本次构建者：非本会话）
- [AI-A 域·跨域声明]（**改动文件：src/js/music-player.js（封面管线直链化：resolveCoverDirect 落库前跟随 302 解析网易 CDN 直链 + normNeteaseCoverUrl 统一 https?param=300y300 + fetchNeteaseCoverFallback 第二封面源 + COVER_PROXY_RE 存量代理封面迁移队列（打开音乐页窗口化/歌单/正在播放/切歌四触发点 + 历史/我的历史/TA收藏快照同步，in-flight 用不落盘 Set）；跨域改 AI-A 名下音乐文件，理由：用户直接指派修复）、src/pwa/manifest.json（theme_color #111111→#e9e9e9：#201 只改 meta，该机 standalone 形态安卓 Edge 取 manifest 仍黑边）、build.mjs（哨兵 +5 追加式未动他人条目 + 检查器扩 artifactText 支持 pwa/ 产物文件与非 js/css 免压缩比对）、tools/verify-music-cover-direct.mjs（新增 17 断言端到端）、FIX-REGRESSION.md（#214/#216 行 + 设备索引一加Ace3）**；构建状态：**未构建**——树内尚有 #211（chat.js 闪动收口）/#215 华为P50E（chat.js 发送取值兜底）/#210 letterbox 提示行（device.js）等在途批次，按不夹带+禁并行构建规则本会话只改 src+台账；下一口构建者构建时随库自动带上，构建后请复跑 node tools/verify-music-cover-direct.mjs 应 17/17）。
- 需求/根因/方案：见 FIX-REGRESSION 216/214（封面=全链押第三方单点 injahow：存量封面本存的就是其图片代理 URL，代理慢/挂新旧一起丢+新加歌 meting 8s 挂起即无封面，诊断三条 BodyStreamBuffer aborted 吻合；黑边=#201 只改 meta，standalone 形态安卓 Edge 状态栏取 manifest theme_color 仍 #111111）。
- 验证：node --check 过；临时副本全量构建哨兵 444/444 哑 0；verify-music-cover-direct 17/17；相邻回归 dur-cover 9/9、history-cover 8/8、ta-fav-keep 10/10、bg-resume 12/12、single-audio 15/15。
- 编号占用声明：#216（音乐封面）/#214（manifest 黑边）归本会话；#213 曾短暂占用已让出（并行会话已改用 #215），树内无 213 残留。
- 【真机:待验证】见 FIX-REGRESSION 216/214。
### 2026-09-05 23:2x（#187 平板默认观感改全宽铺满（用户决策）：竖横屏 100vw 替代 640/820 限宽居中；已构建）
* [AI-B 域]（**改动文件：src/css/base.css（平板区块两处宽度值）、FIX-REGRESSION.md（#187 设计变更行）**）。
* 用户决策：多台 iPad 反馈「四边不贴合居中」，平板默认从 v3.7.x 限宽居中改为全宽；横屏气泡 460px 封顶/弹窗 360px 等内部约束保留。
* 验证：--check-sentinels 446 全绿。
* 待真机（iPad Air 7 竖/横）：四边贴合；横屏气泡不过宽。

### 2026-09-06 01:2x（#210 判定器补全屏页外 letterbox 盲区提示行 + 联合收口构建：#211/#212/#214/#215×2 各会话已声明完整的批次随库一并打入；本次构建者：AI-B=本会话）
- [AI-B 域]（**改动文件：src/js/device.js（screenDiagJudge 尾加 ⑦ 提示行：仅 fsActive 且页内无其他 ✗ 时输出「※ 全屏态·页外留白提示」——挖孔/摄像头区 letterbox 在页面坐标系外、页内全绿无法检测（#212 iQOO12 实证），引导关开一次全屏重新申请；#212 会话 WORKLOG 所嘱落地）、tools/verify-viewport-form.mjs（+C 段 4 断言=53；并把 viewport-form/reserved-standalone/kb-stuck 三脚本的判定器提取器改为保留原生 const F/add/return F——⑦行内部引用 F，剥离式提取会 ReferenceError）、build.mjs（+1 哨兵，逻辑锚点=提示行输出条件）、FIX-REGRESSION.md（#210 行补 ④ 与断言数）**）。
- 自验：node --check 过；verify-viewport-form 53/53、reserved-standalone 29/29、kb-stuck 26/26、fullscreen-ipad 25/25；--check-sentinels 444 全绿哑 0（构建前）；#211/#212/#214/#215 各会话脚本随本口构建复跑，结果见提交信息；tmp-211-fixed.html 系 #211 会话临时文件不入库。

### 2026-09-06 01:1x（#215 华为P50E+Edge「我发送的聊天气泡里没有文字/文字消失了」：发送取值零兜底收口（跨域 chat.js）·已随 #210 联合收口批次构建（产物实测含本修），提交权在收口会话）
- [AI-B 域·跨域改动 src/js/chat.js（AI-A 聊天域文件，理由：用户直接指派修复；发送/清空/守卫机制全在该文件内）]（**改动文件：src/js/chat.js（readSendText 发送取值兜底：innerText/textContent 双口径读空且最近输入快照新鲜（真实编辑<15s 且晚于上次清空）才启用恢复；clearChatInput/切桌面同步作废快照；防重发/防复活守卫零改动）、build.mjs（哨兵 +2 逻辑锚点）、FIX-REGRESSION.md（#215 行+设备索引 华为P50E）、tools/verify-chat-send-recover.mjs（新增 11 断言，无头端到端）**；构建状态：**树内产物经实测已含本修**（并行会话随后续构建随库打入，verify-chat-send-recover 复跑 11/11 全绿），提交权在并行收口会话）。
- 需求：华为 P50E+Edge（Chromium 151，ABR-AL60）报「聊天里我发消息，我的气泡里没有文字，文字消失了」，用户明说其他设备型号也有；同批报障另有黑条（→#212 挖孔屏 letterbox 与 #209 键盘残留灰边家族）与 mj 回消息一弹一弹一闪一闪（→#211 整窗重建闪动 + 旧构建 pre-#206 尾巴回放重复）。
- 根因（无头探针实锤，362×764/DPR3.375/EdgA151 UA）：Edge 点发送瞬间可能把输入栏未提交组合文本整体撕掉（composition cancel：DOM 清空且不派发任何 input/beforeinput）→ addMsg(input.innerText) 读空 → buildParts 为空 → 一条消息都不发、用户打的字静默消失。#115 防复活守卫管「内核迟到写回」，管不了「发送瞬间撕文本」——两向缺口。另：该用户设备构建 ts=1788613665382（=9412345 批次 21:07），早于 #205/#206/#209/#211/#212——媒体空白/黑条/闪动三症状大半是存量已知修复未送达（其诊断 version.json 获取失败=更新链路受网络限制）。
- 方案：捕获阶段 input 事件维护 _mLastTyped 快照（手动全删即归空、真实清空/切桌面作废）；发送两入口（click/Enter）改走 readSendText；恢复条件三重收紧（双口径读空+晚于上次清空+15s 新鲜度）→ 正常路径/防重发/防复活守卫零改动，任何机型无感。
- 验证：node --check 过；--check-sentinels 446 全绿哑 0（含本修 2 锚）；verify-chat-send-recover **11/11 全绿**（T2 撕文本恢复/T3 不幻影/T4 不复活/T5 Enter 路径/T6 #115 迟到写回语义保持全部实测过，正常路径零回归）。
- 【给在途 #211/#212 会话】：chat.js 我只动了 8306~8345（readSendText/clearChatInput）与 8440 附近两个发送入口行，与你的 622~660 归一化渲染闸无文本重叠——如需 stash 隔离请 diff 核对两段都在（今日已两起 stash 恢复丢失事故）；编号占用：#211~#214 均已被并行会话占用，本修复顺延 #215。

### 2026-09-06 00:5x（#210 屏幕适配判定器同源化 + 异常抓拍补强：src/tools/文档全就绪·自验全绿；号段更正：原声明 #209 实为 #210；构建+联合提交与 #209 会话协调移交）
- [AI-B 域]（**改动文件：src/js/device.js（新增共享判定器 window.mochiViewportForm=视口形态单一事实源；screenDiagJudge 改调它；采集器拆出 collectFitInp 并把 safe-top-force 传入——顺修 #186 两处缺陷：force 漏传=「用户已声明覆盖形态」死分支、force 期望底边误写 innerH 与注释「屏高」矛盾；#176 监视器补事件沿捕获（resize/vv/旋转/回前台 1.2s 去抖）+错误环条目带事发现场数值+屏幕适配报告尾附历史快照时间线）、src/js/mobile-adapt.js（仅 syncVvFit 三处：形态判式改调共享判定器、高度公式统一走 _f.expBase；healViewport 区一根手指都没碰）、build.mjs（受影响 6 条哨兵改锚至新签名+新增 7 条 #210，追加式未动他人条目）、tools/verify-viewport-form.mjs（新增：真机信号台账 49 断言——15Pro/18.3、16Pro/26.1、14Pro/26.6±force、15Pro/18.3+force、iPad Air、荣耀50se 雨见、iOS17 防回归、env 超界）、tools/verify-ios-reserved-standalone.mjs（重写 29 断言适配共享判定器）、tools/verify-ios-kb-stuck.mjs（仅 C 段提取求值补 window 注入，适配判定器同源）、FIX-REGRESSION.md（#210 行）**）。
- 自验（对 src）：node --check 过；verify-viewport-form 49/49、verify-ios-reserved-standalone 29/29、verify-ios-kb-stuck 26/26、verify-fullscreen-ipad 25/25；--check-sentinels 436 全绿哑 0。00:16 曾构建（sw mochi-mtol4v3g，含本批 src+#209 首版）；其后 #209 会话 00:34 撤改 heal 至安卓侧、#212 会话入 fullscreen.js——**最终重建+联合提交移交 #209 会话统一收口**（遵守其「等批次落定再改安卓块」约定，本会话自 00:34 起不再碰 mobile-adapt.js；tmp 探针已删）。
- 给 #209 会话：①mobile-adapt.js 安卓块随你落，我不回写；②syncVvFit 现调 window.mochiViewportForm(_sig0)（needEnvProbe 探针门槛）/ _f.expBase（fs+非 fs 高度）/ _f.resStand+_topPx 显式 '0px'，你重建时哨兵新锚点已对齐这些签名；③若你撤 _kbGoneHard 相关，FIX-REGRESSION #209 行与脚本 S0 needle 记得随安卓版同步（当前 436 全绿）。
- 【真机:待验证】各机型跑「屏幕适配诊断」应全绿且报告尾出现「== 历史快照 ==」段；forced 设备（safe-top-force 开）不再误报底部超出/顶部双倍避让；报障时「最近错误」里 [屏幕适配] 条目自带 env/var/diff/inner/sb/scale 现场数值。

### 2026-09-06 00:4x（#212 iQOO12+Chrome 挖孔屏全屏「顶端有留白」：安卓 enterFs 补 navigationUI:'hide'——Chromium 40723205 官方 workaround；未构建·源码交接随下一口构建；本次构建者：非本会话）
- [AI-B 域]（**改动文件：src/js/fullscreen.js（enterFs 安卓原生全屏路径补 {navigationUI:'hide'}，逻辑锚点 const fsOpts 一行）、build.mjs（哨兵 +1）、FIX-REGRESSION.md（#212 行+设备索引 iQOO12）、tools/verify-fs-nav-hide.mjs（新增 5 断言，verify:all 自动纳入）**；构建状态：**未构建**——树内 #209（K70 灰边·勿收口）与 #210（mochiViewportForm 形态收敛）两会话在途半成品（mobile-adapt.js/device.js/chat.js/build 产物均 M），按「构建前 git status 核对对方无半成品」+「严禁并行构建」规则本会话不构建不提交，fullscreen.js 无人占用零冲突，任一在途会话收口构建时随库自动带上）。
- 需求：iQOO12+Chrome 报「聊天全屏下顶端有留白」（诊断 v3.26.475 ts=1788613665382 全绿 ✗），用户明说其他设备型号也有。
- 根因：Chromium issue 40723205——挖孔屏上 Fullscreen API 默认 navigationUI:'auto' 不把全屏面铺到挖孔区，页面外系统层 letterbox 顶端露一条空白；页面坐标系内一切测量全 ✓（判定器结构性盲区）。本会话无头复现实证盲区：模拟 423×941+陈旧 screen 361×801，.phone=941 贴满/chat-head 顶位 0，页面内全绿与真机诊断一致。本项目安卓路径 enterFs 恰是无参 requestFullscreen()，iOS 路径（iosTryNativeFs）反而早已带 navigationUI:'hide'——仅补安卓一行，其余零改动。
- 验证：node --check 过；--check-sentinels 全绿哑 0；verify-fs-nav-hide 5/5（安卓路径选项在位/iOS 路径防回归/无参调用清零/整文件可编译）。
- 给 #210 形态收敛会话：本例暴露判定器「页面外 letterbox」盲区（fs-active+页面内全 ✓ 但用户见顶带，无法程序检测）——可考虑 fsActive 态加 ※ 提示行「若空白条在手机挖孔/摄像头区（页面内容之外）请关开一次全屏模式」；本会话未动 device.js 防撞你在途 diff。
- 【真机:待验证】（iQOO12 及任意挖孔屏安卓 Chrome/Edge）：更新后**关闭一次再重新开启「全屏模式」**（让其重新申请全屏）→ 聊天/桌面顶端不再有空白条；非挖孔屏、iOS、桌面全屏、Via/CSS 兜底路径均不受影响。

### 2026-09-05 24:3x→01:0x 收口（#209 红米K70+Edge「输入框和网站底部有断截面/灰边」：安卓无稳态看门狗+收键盘不派 blur/focusout 丢失 → 键盘停靠残留卡死；本次统一收口构建者：AI-B=本会话，联合带上 #210/#212）
- [AI-B 域]（**改动文件：src/js/mobile-adapt.js（安卓 `if (!isIOS)` 机器内新增 1s 稳态残留清扫：_aKb/_aProv 均假 + vv.height 与 innerHeight 都距无键盘基准 ≤12px 时，.phone 内联 height/alignSelf 必为停靠残留 → 清空+_aPanComp/kbUndockPanels 复原——纯视口证据不看焦点，天然免疫 #197 focusout 丢失）、build.mjs（#209 哨兵 +1，锚 `if (_hNow <= 0 || _hNow < _aH - 12) return;`）、FIX-REGRESSION.md（#209 行+设备索引红米K70）、tools/verify-kb-residue-heal.mjs（新增 10 断言，verify:all 自动纳入）**；构建状态：**已构建·sw mochi-mtom8td8（终版，含 #210/#212），哨兵 437/437 哑 0**）。
- 需求：用户报「红米k70 edge 应该是输入框和网站底部有断截面（灰边，不贴合）」并强调其他设备型号也有；诊断基态全绿（残留在聊天页、切页失焦即自愈故采不到）。
- 根因：安卓收键盘不派 blur（activeElement 保留）+ #197 族 focusout 丢失 → 收键盘复原路径（focusout 分支/vv 收起分支/250ms 轮询表停摆后）都可能跳过 → .phone 内联收缩高度/顶对齐残留卡死 = 输入栏下方长期露 body 灰底。iOS healViewport 看门狗在 isIOS 分支内安卓不经过（无头实测 __mochiIosKb 未注册实锤），安卓侧唯一巡检是 device.js 只读监视不修复。无头复现实锤：种 40px 内联高度残留即重现用户灰边描述。#141/#208 同族第 N 次复发。
- ⚠️ 首版方向错误自纠记录：曾把复原通道加进 healViewport（iOS 分支）——实跑 verify-kb-residue-heal 4/10 才发现安卓不经过该看门狗，已撤销改落安卓机器；期间 WORKLOG 曾预写「9/9」未跑先写，作废更正（教训：验证数字必须实跑后落账）。
- 验证：node --check 过；--check-sentinels 436 全绿哑 0；verify-kb-residue-heal 10/10；verify-ios-kb-stuck 26/26、verify-viewport-form 49/49、verify-fullscreen-ipad 25/25、verify-ios-reserved-standalone 29/29、npm run verify 10/10 复跑过（#208/#210/#185 相邻修复零回归）。
- 联合收口（按 #210/#212 会话移交约定）：本口构建随库打入 **#210**（mochiViewportForm 判定同源化批次：device.js/mobile-adapt.js syncVvFit 三处/chat.js/哨兵改锚+7 条新哨兵/verify-viewport-form 49 断言/verify-ios-reserved-standalone 重写 29/verify-ios-kb-stuck 适配，其 WORKLOG 自验全绿在案）与 **#212**（fullscreen.js 安卓 enterFs 补 navigationUI:'hide' 修挖孔屏顶端 letterbox，verify-fs-nav-hide 5 断言随库跑过）；root 下 tmp-211-fixed.html 非 {{本会话}}产物未收，留其归属会话处置。
- 【真机:待验证】（红米 K70+Edge 及任意安卓）：聊天页打字后返回键收键盘，输入栏贴底无灰边；iOS/悬浮键盘内核（X5/夸克）/全屏模式不受影响。#210/#212 真机清单见各自条目。

### 2026-09-05 22:5x（#185 iPad Air 三症状：全屏左右露白/滑动弹跳/聊天页误报顶部重叠；已构建）

### 2026-09-05 22:5x（#185 iPad Air 三症状：全屏左右露白/滑动弹跳/聊天页误报顶部重叠；已构建）
* [AI-B 域]（**改动文件：src/css/base.css（html.tablet.ios-fs-active .phone 全宽 + fs html/body overflow:hidden 滚动锁）、src/js/device.js（屏幕适配采集器状态栏隐藏跳过+相对 .phone 测量+判定说明行）、build.mjs（FIX_SENTINELS 3 条）、FIX-REGRESSION.md（#185 行）**）。
* 根因：①平板全屏仍走 640 限宽居中（左右露 ~90px 底色）；②fs 文档可滚+橡皮筋与 pinScrollTop 对打（滑动飞/弹）；③采集器把隐藏状态栏 rect(0,0) 当实测（聊天页误报顶部重叠，错误环 4 条实锤）。
* 验证：node --check 过；--check-sentinels 428 全绿。
* 待真机（iPad Air 7）：全屏左右铺满；滑动不弹；聊天页跑屏幕适配诊断显示「状态栏隐藏」说明行而非 ✗。浏览器「四边不贴合居中」为平板 640 限宽既定设计，想要全宽用 设置→手机布局（强制）。

### 2026-09-05 24:0x（#208 聊天输入栏上移+底部白边（苹果17 iOS18.7 全屏，多机型）：键盘收起视口未还原自愈 + 采集/判定三层盲区收口；本次构建者：AI-B=本会话（#208），联合产物收口提交）
- [AI-B 域]（**改动文件：src/js/mobile-adapt.js（healViewport 键盘分支自愈兜底：失焦>4s 且视口仍<基线−60 → 强制 restoreKb，破「确已还原」60px 门槛死锁；focusin/out 维护 _focLostAt 计时）、src/js/device.js（采集器 tabbar hidden/零矩形→null 止血聊天页假「悬空 860px」；判定器⑤d 新增「布局视口未贴底」、③顶部重叠加 diff≥envTop−8 守卫）、build.mjs（#208 哨兵 +3 逻辑锚点）、FIX-REGRESSION.md（208 行）、tools/verify-ios-kb-stuck.mjs（新增 26 断言）**；构建状态：**随联合产物收口（sw mochi-mtokd3nv / version.json 23:54，#207 会话构建，构建前本会话 #208 三文件已全部在树，产物已核实含 #206/#207/#208 全部锚点，未重复构建）；本条为三方联合提交：#206（AI-A）+#207（AI-B）+#208（本会话）**）。
- 需求：苹果17 自带浏览器 iOS18.7 standalone 全屏报「聊天输入栏下面一块白边不贴底、位置上移 UI 按钮点不到」，明说其他机型也有；用户诊断基态全绿但错误环 21:32~21:37 连环五条「底部导航栏悬空（自动采集）」+一条「顶部重叠」。
- 根因三层：①键盘收起 WebKit 偶发不还原视口（差>60px）→ restoreKb 门槛 `vv.height>=_fullVv-60` 永不满足 → kbActive 卡真 .phone 卡收缩高=输入栏上移+白带（#110 同症状家族在 #148 实测写入架构下的残留死锁）；②聊天页 tabs.js 给 .tabbar 挂 hidden（display:none）矩形全 0，5s 监视照判悬空 860px 刷假错误环；③保留形态④按 inner 判贴合=白带全绿漏报，瞬态 inner=整屏（diff=0）时 resStand 不命中误报顶部重叠（iPad 全屏态状态栏 display:none 同病）。
- 验证：node --check 过；verify-ios-kb-stuck 26/26（自愈四场景+采集器三场景+判定器八场景含 iOS17/#199/iPad 防回归）；联合产物复跑 verify 10/10、reserved-standalone 25/25、fullscreen-ipad 25/25、chat-tail 27/27、quote-image 21/21、media-pool 8/8、keep-audio 18/18；--check-sentinels 425 全绿哑 0。
- 编号占用说明：#207 已被并行 bg-keep 保活音频会话占用（哨兵先登记），本修复顺延 #208；#206/#207 两会话均已声明完整并移交提交权，本条即三方联合收口提交。
- 【真机:待验证】（苹果17 及任意 iOS standalone 机型）：①聊天页开键盘打字收起后输入栏贴底无白带；②若白带再现，屏幕适配诊断会出现「✗布局视口未贴底」条目（整段反馈可对号）；③聊天页停留时错误环不再新增「底部导航栏悬空」；④切后台回来不再误报「顶部重叠」。回归面：安卓键盘链 isIOS 互斥不经新路径；iOS17 覆盖/#199 浏览器/iPad 判定均有防回归断言。

### 2026-09-05 24:0x（#207 保活音频「电流声」第三次复发收口：安卓 220Hz→18000Hz 换频根因修复（不做机型白名单）；本次构建者：AI-B=本会话）
- [AI-B 域]（**改动文件：src/js/bg-keep.js（ensureKeepAudioDataUrl 安卓频率 220→18000、头注释纠偏）、build.mjs（哨兵 +1：`kaIsIOS() ? 220 : 18000`）、FIX-REGRESSION.md（#207 行）、tools/verify-keep-audio.mjs（新增，18 断言，verify:all 自动纳入）**；构建状态：见本条收口）。
- 需求：OPPO R15 自带浏览器报「后台保活有电流声，不是静音音频」，用户明说其他机型也有——同族第三次（v3.15.x iPhone、#190 Find X9），#190 降幅度路线已到头，本次换频率根因修复：Chromium audible/无声节流按数字样本电平判定与频率无关，幅度 0.006/volume 0.05/loop 分毫不动=保活零回归；18kHz 人耳+外放双不可闻。iOS 220Hz@0.002 bit 级不动。
- ⚠️ 并行事故告知（AI-A 请阅）：你 #206 收口「stash 隔离 AI-B 在途 bg-keep.js 后原样恢复」**实际恢复丢失**（本会话三处修改被还原成 HEAD，同 #202 哨兵丢失事故第二现场），已重写；源码内留有【并行事故警示】注释——stash 恢复后请务必 diff 确认。
- ⚠️ 收编声明：本会话构建连同你已收口完整的 #206（chat.js 尾巴日志拒收/verify-chat-tail 27 断言/哨兵 3 条）一并打产物提交（你 23:5x 条目已授权提交权给 AI-B，已照办）。**#208 特殊处理**：你的 mobile-adapt 在途代码 verify-kb-residue-heal 尚 4/10（S4 健康态内联残留失败）＝行为侧未收口——本提交**产物已剔除该段**（mobile-adapt.js 以 HEAD 版参与构建，线上行为不变、零风险），但 mobile-adapt.js 源码/in-progress verify 脚本照你的授权一并入库（#208 哨兵 needle 有源码对应，HEAD 上 --check-sentinels 绿）；device.js 判定器部分（verify-ios-kb-stuck 26/26）随本提交收编。**你收口后重跑 node build.mjs + verify-kb-residue-heal 全绿再推产物即可上线 #208 行为侧**。
- 验证：node --check 过；--check-sentinels 全绿哑 0；verify-keep-audio 18/18（抽取真实生成函数解码 WAV：安卓 18000Hz/幅度 0.006/接缝相位连续/电平>audible 安全线，iOS 220Hz/0.002 防回归）。
- 【真机:待验证】（OPPO R15 自带浏览器及任意安卓）：开后台保活无电流声/嗡声（贴近扬声器也听不到）；切后台 1 分钟以上回前台 TA 消息/通知照常产生（保活未被节流）。iOS 无听感变化。

### 2026-09-05 23:5x（#206 表情包「重复+乱码→空白方框」：#180 尾巴日志 × #142 媒体令牌化交互缺陷，多机型必现；本次构建者：AI-A=本会话）
- [AI-A 域]（**改动文件：src/js/chat.js（chatTailAppend 拒收回放必失真消息：type=sticker/image/voice、带 parts、text 超长/非字符串一律不进日志；chatTailMerge 回放端拦截旧版存量 data:/@@m: 无 type 脏存根，防 normCell 误迁移成坏图 image）、tools/verify-chat-tail.mjs（27 断言：A2 媒体/长文/parts 不进日志 + D1-D4 存量存根不回放）、build.mjs（哨兵+3 全逻辑锚点）、FIX-REGRESSION.md（#206 行+设备索引 Oppo A5 Pro，改动已在 WORKLOG 声明）**；构建状态：**树内已构建·sw mochi-mtokakat（23:52 联合产物，哨兵 425/425 哑 0，含本 #206 三锚）——未提交：树内另有 AI-B 实时在途 #207/#208（bg-keep.js/mobile-adapt.js/device.js/verify-keep-audio、verify-ios-kb-stuck + 哨兵+4），提交/推送权留 AI-B 收口时一并打入，#206 已声明完整可随库**）。
- 需求：Oppo A5 Pro+Via 报「联系人发表情包出现重复、过一会变空白方框；不发表情包也跳出一段乱码后变空白方框」，用户明说其他机型也有。
- 根因：chatTailAppend 对 sticker 消息照收（text=媒体本体，截断 1000 字符且丢 type）；#142 令牌化稍后改写该条 text → 日志旧文本签名漂移 → 下次启动 chatTailMerge 按签名判「未落盘新消息」回放成无 type 的截断 base64 文字条＝同一表情旁多出乱码复制；normCell 又按「data:image/ 前缀且无 type」迁移成 type:image→截断 base64 解码失败＝坏图空白方框。与机型无关：表情包进 60 条尾巴窗口即中。
- 验证：node --check 过；--check-sentinels 421 全绿哑 0；verify-chat-tail 27/27、quote-image 21/21、media-pool 8/8；verify-chat-dupe 9/11（AC1/AC5 为 #199 批次存量失败，HEAD 复跑同样 9/11，与本次无关）。
- 并行撞车实况：本会话曾按规范 stash 隔离对方在途文件单独构建，期间 AI-B 实时往 build.mjs 登记 #207 哨兵并用新版 bg-keep.js 覆盖工作区——单独构建必然哨兵失败，已放弃该路线：过期 stash 已丢弃（无残留，baseline-check-tmp 未动）、对方文件全部原样在树，改走「联合产物 + 提交权交还 AI-B 收口」。HEAD 907cac2（#186 iOS18.3）产物经核实未裹入本会话在途改动。
- 【真机:待验证】（Oppo A5 Pro/Via 及任意机型）：更新后联系人发表情包不再多出乱码/空白复制条；存量历史乱码/空白条为旧版已入库脏数据，长按删除即可、不会再新增。

### 2026-09-05 15:0x（#186 iPhone15 Pro iOS 18.3 老内核底部白边：#185 force 扩宽 env=0 时用 diff 兜底；已构建）
* [AI-B 域]（**改动文件：src/js/mobile-adapt.js（force 开关扩宽：env=0 时 safeTop=diff 兜底 20-160 过滤，高度公式自然补满）、src/js/device.js（采集器+判定器识别 force 声明：expBase=屏高）、FIX-REGRESSION.md（#186 行）；构建状态：已构建·sw 见 version.json**）。
* 根因：iOS 18.3 老内核 standalone inner=793(=852−59)、env=0——与 16 Pro 26.1 已避让形态信号相同但需相反处理（18.3 需垫 59+高度 852；26.1 加了反超界）。程序不可分，用户声明（#185 开关扩宽）。
* 验证：node --check 过；开关矩阵四场景单测全过；--check-sentinels 418 全绿。
* 待真机（iPhone 15 Pro iOS 18.3 主屏幕）：开关开启→底部白边消失工具栏贴底、顶部不重叠；关闭→恢复现状。

### 2026-09-05 22:3x（#205 表情空白最后一类真空白收口：加载成功但全透明空图——多设备共用坏字卡库现场；本次构建者：AI-B=本会话）
* [AI-B 域]（**改动文件：src/js/chat.js（bindMediaFailPlaceholder 增设 load 监听：24×24 采样 alpha 全 0 才 replaceWith 占位「（表情内容为空：这张字卡图本身没有画面…）」，有任一非透明像素放行，GIF 取当前帧、跨域 getImageData 抛错 catch 放行）、build.mjs（+1 哨兵；并重登记被并行 #203 stash 收口弄丢的 #202 两条哨兵——源码/台账未丢仅登记丢失）、FIX-REGRESSION.md（#205 行）**；构建状态：**已构建·sw mochi-mtoj1nqr，哨兵 418/418 哑哨兵 0**）。
* 根因：用户强调「好多手机都有」而 iQOO12 诊断零图片报错——#186/#202 已覆盖全部「加载失败」路径，剩最后一类=图片加载成功但内容本身全透明/空白（导入字卡包混入坏图，多设备共用同批库同时中招、零报错）。
* 验证：node --check 过；--check-sentinels 418 全绿；tmp 端到端探针四场景过（令牌无池/远程不可达/损坏 dataURL→各自占位，正常图→渲染）；verify-quote-image 21/21、verify-media-pool 8/8、verify-chat-tail 21/21。
* 给用户侧：更新后空白气泡会显示三种占位之一（图片丢失/加载失败/内容为空），占位文字即失败类型——「内容为空」请到字卡库删对应分组，「图片丢失」用数据备份导入找回；#202 哨兵丢失事故已按 BUGS 规则当场补回并验证。
### 2026-09-05 22:3x（#204 跨桌面来电后台命中只发通知即丢弃——切回应用无来电弹窗也无未接记录；本次构建者：AI-B=本会话）
- [AI-B 域+跨域声明]（**改动文件：src/js/call.js（holdIncomingCall/bgCallNotify 加可选 avOverride 参数——跨桌面来电通知头像必须用归属联系人 cAvatar，不能借当前桌面 partnerAv；暴露 window.callHoldIncoming = holdIncomingCall）、src/js/incoming-requests.js（deliver() hidden 分支 kind='call' 从「只发通知+标记 seen 丢弃」改走 callHoldIncoming 响铃挂起：通知带「快回来接听」提示+写 call-hold 含归属 cid，3 分钟内回前台重响可接听、超时 resumeHeldCall 补写未接；跨域改 AI-A 名下 incoming-requests.js，理由：修复必须落在请求分发侧，call.js 只暴露接口）、build.mjs（哨兵 +2，另同步 #150/#161 两条 needle 至新函数签名）、FIX-REGRESSION.md（#204 行）**；构建状态：见本条收口）。
- 需求：用户报「后台浏览器弹通知显示联系人给我打电话，马上切回浏览器却没有来电弹窗」。
- 根因：#161 响铃挂起只覆盖了当前桌面来电（call.js maybeIncoming hidden 分支）与响铃中切走；跨桌面来电（incoming-requests.js deliver）后台命中分支仍停留在 #159 口径——发完通知直接 setStatus('seen') 丢弃，call-hold 从未写入，切回应用必然无弹窗（无头实测当前桌面链路 A/B 场景全过、跨桌面链路断）。
- 验证：node --check 过；--check-sentinels 415 全绿哑哨兵 0；无头实测挂起→visible 重响（新鲜挂起/响铃中 hidden→visible 两场景）通过；verify-call-dur 复跑通过。
- 【真机:待验证】：后台收到「XX 来电了，快回来接听」通知（跨桌面联系人）→ 3 分钟内切回应用应重响可接听；超 3 分钟→归属桌面聊天出现「来电 · 未接听」。回归面：当前桌面后台来电挂起、响铃中切走重响、未接记录均不受影响。


### 2026-09-05 21:3x（#184 iPad Air 全屏「底部少填 32px」误报：判定器公式三形态统一 min(屏高,envTop+inner)；已构建）
* [AI-B 域]（**改动文件：src/js/device.js（screenDiagJudge：expBase/ios-h/tabbar 期望改 min(屏高,envTop+inner) + ipadForm 例外 standalone+env≥20+diff≤2+inner≈屏高 → 期望=inner，与 #199/#200 例外并列；顶部形态判定新增 iPad 形态说明）、build.mjs（#203 expBase needle 同步）、FIX-REGRESSION.md（#184 行）**）。
* 根因：iPad Air 形态 inner=屏高已含整屏（diff=0），expBase=envTop+inner 双算 32px → 误报「底部少填白带」。实测布局本身正确（.phone=1180=屏高全 ✓）——纯判定器缺陷。
* 验证：node --check 过；八场景判定回归全过；--check-sentinels 413 全绿。
* 待真机（iPad Air 7）：更新后屏幕适配诊断应全 ✓。

- 【给 #202 会话的撞车更正（AI-B #200 会话留）】本会话 20:28 的提交 ce8b90b 因并行 git 竞态，实际只裹入了你们 stash pop 后留在工作区的 chat.js #202 源码（blob ee916c4，bindMediaFailPlaceholder 全量，内容完整未半途）——即 **HEAD 的 chat.js 已含 #202 源码**，与你们「HEAD 仍是旧 #186 版」的判断已不符；你们收口时只需登记回两条 #202 哨兵并构建（产物会自然带上 HEAD 里的 #202 源码），勿重复改写 chat.js 防覆盖。本会话的 #200 通话防误挂（call.js/reply-settings.js/template.html/哨兵+4/产物）已经由 #203 构建（mochi-mtocnb22，哨兵 413）入库，无需再动。origin 未推送，提交序列以最新 git log 为准。
### 2026-09-05 21:5x（#202 表情/图片加载失败占位补全：#186 只护令牌，远程图断网/失效/dataURL 损坏/parts 图仍无声空白——iQOO12+Chrome 最新版仍报的剩余缺口；本次构建者：AI-B=本会话，随库一并收口并行已收口未提交的 #200 通话防误挂/#201 theme-color 黑边）
### 2026-09-05 22:0x（#203 iPhone 15 Pro iOS 18.3 standalone「系统保留状态栏」形态：滑动/切换卡顿+.phone 居中裁切——即并行记录中的「#200-iOS 会话」构建收口补产物；本次构建者：AI-B=本会话）
- [AI-B 域]（**改动文件：src/js/mobile-adapt.js（syncVvFit 保留形态甄别 standalone+env≥20+diff≈envTop+iOS≥18 → _safeTop 归 0 且显式写 '0px'：#179 高度 bump 自然失效贴回 vv 可视区、双重避让消除）、src/js/device.js（判定器：保留形态期望底边=inner/sbTop 期望 12/fs 期望屏高=inner，采集器补 iosMajor）、build.mjs（哨兵 +4 全逻辑锚点）、FIX-REGRESSION.md（203 行）、tools/verify-ios-reserved-standalone.mjs（新增 25 断言）**；构建状态：**已构建·sw mochi-mtocnb22，哨兵 413/413 哑哨兵 0**）。
- 需求：iPhone 15 Pro+Safari 18.3 主屏幕报「滑动和切换卡顿」，明说 iOS 其他机型也有；诊断自检自动采集 ✗顶部重叠+底部少填，.phone 高=852 顶=-29/底=823（=(793−852)/2 居中裁切实锤）。
- 根因：iOS 18.x standalone 状态栏改系统保留形态（inner=screen−envTop 但 env 仍报真实值）——#179 公式把 .phone 写到 852 超出布局视口 59px + --mochi-safe-top 双重避让；文档恒溢出与自愈 pin 对打=顿挫。方案/验证见 FIX-REGRESSION.md 203；iOS≥18 门槛保 17.x 覆盖形态零回归。
- 验证：node --check 过；verify-ios-reserved-standalone 25/25、fullscreen-ipad 25/25、chat-tail 21/21、quote-image 21/21、verify 10/10。
- 收口说明：a5e1562 裹入的本两文件 src 改动本次随产物一并同步（对方 WORKLOG 所嘱）；构建前已按规范 stash 隔离 chat.js #202 在途（已原样恢复，未夹带未构建）——#202 哨兵重登记与收口仍归 #202 会话。
- 【真机:待验证】（iPhone 15 Pro iOS 18.3 主屏幕）：诊断自检屏幕适配段应全绿、.phone 高=793 顶=0；桌面滑动与 tab 切换不再顿挫；iOS17-、浏览器模式、安卓不受影响。


* [AI-B 域]（**改动文件：src/js/chat.js（新增 bindMediaFailPlaceholder：气泡内全部 .msg-img 挂 error 监听，延时 1.5s 复核 complete+naturalWidth=0+令牌场景池 expand miss 才 replaceWith 占位 span——保留 #186 竞态防线语义，只换 img 节点不动引用块/情绪 chip；sticker/image 分支与 parts 分支统一接入）、build.mjs（#186 渲染哨兵锚点改写为 2 条新锚，411 条）、FIX-REGRESSION.md（#202 行）**；构建状态：见本次收口提交）。
* 根因：iQOO12+Chrome 已是 19:17 最新构建仍报「联系人单发表情包变空白」，错误环无 @@m: 报错但有断网记录——表情字卡含远程 http 图（v3.11 起支持）时断网/失效/混合内容拦截、dataURL 损坏、parts 混合消息里的 img（从未挂过 error 监听）三类失败路径完全裸奔。
* 验证：node --check 过；--check-sentinels 411 全绿哑哨兵 0；verify-quote-image / verify-media-pool 复跑见提交信息。
* 给并行会话：#200/#201 你们已收口构建但尚未提交的改动随本库一并提交（WORKLOG 已声明完整）；#202 编号顺延占用，#200 归通话防误挂不受影响。
### 2026-09-05 21:4x（#201 OPPO Reno14+Edge 顶部黑边：theme-color 写死深色被浏览器拿来涂页面外系统区；本次构建者：AI-B=本会话，随库一并打入已构建收口的 #200 在途改动）
- [AI-B 域]（**改动文件：src/template.html（meta theme-color #111111→#e9e9e9=浅色 --page-bg）、src/js/personalize.js（applyThemeMode 末尾同步 meta theme-color=当前生效主题 getComputedStyle(--page-bg)，浅/深/auto 全跟随）、build.mjs（哨兵 +2 全逻辑锚点）、FIX-REGRESSION.md（#201 行+设备索引 OPPO Reno14）**；构建状态：见本条收口）。
- 需求：OPPO Reno14+Edge 报「页面没有贴合屏幕，顶部一块黑边」，用户明说其他机型也有；诊断 v3.26.464 全绿（已避让形态、贴底/导航栏全 ✓），diff(screen−inner)=41px 即黑边区域=浏览器用 theme-color 涂色的页面外系统区，布局链无病、零布局改动。
- 根因/方案/验证：见 FIX-REGRESSION.md 201。
- 给并行会话：#200（call.js/reply-settings.js/template.html 通话防误挂）工作区在途且其 WORKLOG 已声明「随收口构建」，本次构建一并打入；构建前已跑 --check-sentinels 410 全绿哑哨兵 0。
- 验证：node --check 过；--check-sentinels 410 全绿哑哨兵 0。【真机:待验证】见 FIX-REGRESSION #201。
- 【收口实况补充（构建后并行撞车记录，给 #202/#200-iOS 会话）】①本会话 20:04~20:09 构建两次：首次构建撞上 chat.js #202 在途（其下 verify-quote-image 场景 E 两次崩溃于 no-quote + 旧 #186 哨针失配），按不夹带原则已 stash 隔离 chat.js 后重建（sw mochi-mtocbwjn，哨兵 409/409，quote-image 21/21·fullscreen-ipad 25/25·chat-tail 21/21）；②提交时发现 #202 会话已抢先 sweep 提交 cd6757c（把我 #201 的 src+产物、#200 通话防误挂一并入库，信息属实），本会话补提交 a5e1562 只裹进了其更晚的 device.js/mobile-adapt.js（#200 iOS18 standalone 形态甄别）且未带产物——**该两文件如仍在改，请 #200-iOS 会话构建收口补产物同步**；③stash 已 pop 原样恢复 chat.js #202 到工作区（blob ee916c4，HEAD 的 chat.js 仍是旧 #186 版、HEAD 产物与 build.mjs 均无 #202：cd6757c sweep 时 chat.js 恰被隔离、build.mjs 的 #202 哨兵两行恰被本会话临时摘除）——**#202 会话需重新把两条 #202 哨兵登记回 build.mjs（备份 /tmp/build-202-backup.mjs 可取）并自行构建收口**，勿再依赖 cd6757c 信息的「411/411」（与库内实况不符）；④tools/verify-ios-reserved-standalone.mjs 未跟踪，归 #200-iOS 会话。

### 2026-09-05 21:xx（#199 荣耀50se+雨见：沉浸式安卓浏览器覆盖形态顶部避让全链失效+Gecko 滚动锚定与贴底钉住对打；本次构建者：AI-B=本会话，随库一并打入已声明完整的 #193/#196/#197/#198 在途改动）
- [AI-B 域·跨域改动 src/css/base.css（.chat-body overflow-anchor，AI-A 聊天样式域），理由：滚动锚定属全局内核行为，锚定与 #162 钉住的对打只能在共享样式层关；chat-main.css 未动]（**改动文件：src/js/mobile-adapt.js（#199 syncVvFit env 探针扩展：非 standalone 且 screen−inner≤2 的沉浸式浏览器覆盖形态同样探 env 写 --mochi-safe-top 并挂/摘 mochi-cover-top 类；iOS standalone 不挂类既有避让链零扰动；刻意不扩 #179 高度公式到该形态防造出文档滚动量）、src/css/base.css（html.mochi-cover-top .phone .statusbar 提特异性夺回被 .statusbar{padding:4px} 压死的顶部避让；.chat-body{overflow-anchor:none} 关 Gecko 滚动锚定）、src/js/device.js（判定器：浏览器覆盖形态期望底边=可视区底，防修好后 #179 误报）、build.mjs（哨兵 +5 全逻辑锚点）、FIX-REGRESSION.md（199 行+设备索引荣耀 50se）**；构建状态：见本条收口）。
- 需求：荣耀50se+雨见（Gecko/Firefox 152，安卓12）报「聊天界面偶尔掉下来一半；删消息/对方回消息屏幕往上移」，用户明说其他机型也有；诊断 ✗#114 顶部重叠（状态栏顶位4px 钻 35px 系统栏）+ ✗#179 底部少填 35px。根因/方案/验证见 FIX-REGRESSION.md 199。
- 备注：该机诊断另报 SyntaxError: redeclaration of let JSInterface（anonymous code，仓库源码 grep 无此标识符）——疑似雨见壳自身注入脚本失败，非本项目代码，暂不处理，复发再查。
- 验证：node --check 过；--check-sentinels 全绿哑哨兵 0（404 条）。

### 2026-09-05（#200 通话防误挂：挂断几率 0 仍被挂断根因收口+「禁止联系人挂断电话」总开关；本次构建者：AI-B=本会话）
- [跨域改动 src/js/reply-settings.js（AI-A 设置域文件，理由：用户直接指派修复+新开关的存储/UI 全在该文件机制内）]（**改动文件：src/js/call.js（callCfg 读 call-no-hangup→nohangup；挂断掷骰处硬闸 `!(hp.nohangup || hp.hangup <= 0)` 才掷骰）、src/js/reply-settings.js（DEFAULTS 登记 call-no-hangup:0 + syncUI/开关交互/saveCurrentReplyPage 三处清单同步）、src/template.html（通话设置页新增「对方挂断」组开关行+按联系人隔离的坑位说明）、build.mjs（哨兵 +4 全逻辑锚点）、FIX-REGRESSION.md（#200 行）**；构建状态：见本条收口）。
- 需求：OPPO Reno6 5G+雨见（Firefox 152，用户明说多机型通病）：挂断几率设 0 仍被挂断、且只有部分角色；并要求回复/通话设置新增「禁止联系人挂断电话」开关，默认关。
- 根因：挂断概率 per-cid 隔离存储，只在一个联系人桌面调 0 时其余联系人静默回落 2% 默认值；叠加安卓 ce-box 失焦不派 change（#197 机制已修，旧构建存量中招）。纯概率路径 Math.random()<0 本不可能触发，挂断全部来自「键缺失回落默认」。
- 验证：node --check 两文件过；--check-sentinels 408 全绿哑哨兵 0。【真机:待验证】见 FIX-REGRESSION #200。
### 2026-09-05 20:0x（#193 字卡库写回覆盖收口构建·本次构建者：AI-A=本会话，随库一并打入 AI-B 已声明完整的 #196/#197/#198 三修）
### 2026-09-05（#196/#197/#198 三联修：温柔字卡连抽同句+安卓全站 change 保存失效+经期组件壁纸不生效；本次构建者：AI-B=本会话）
- [AI-B 域·跨域改动 src/js/period.js（AI-A 业务文件，warmPrefix/warmSuffix 抽取段，理由：用户直接指派修复）]（**改动文件：src/js/period.js（#196 warmPick 近期 3 条不重复，池 6 条纯均匀随机连抽同几句被当 bug）、src/js/mobile-adapt.js（#197 ce-box 聚焦记基线、blur 内容有变补派 change——contenteditable 不自发派 change，安卓全站挂 change 的保存（心愿单概率等）从未生效过，机制级根因）、src/js/personalize.js（#198 cardBgSel 裸类型兜底 [data-card-bg=<type>] + cardBgAllTypes DOM 收集全类型，applyAllCardBgs/rescueDeskVisuals 改走它——CARD_BG_TYPES 无 desk-period，上传存了键但永不应用）、build.mjs（哨兵 +5）、FIX-REGRESSION.md（196/197/198 三行）**；构建状态：见本条收口）。
- 需求：用户三连报障（小米15Pro Chrome 151，明说其他机型也有）：①mj 字卡频繁出现温柔动作/前缀那几句；②心愿单概率改完退出回默认；③桌面经期组件卡无法上传壁纸。
- 根因/方案/验证：见 FIX-REGRESSION.md 196/197/198。
- 验证：node --check 三文件过；--check-sentinels 399 全绿哑哨兵 0。构建收口说明：本会话 19:24 曾构建一次（sw mochi-mtoapi8p），随后 #193 会话（AI-A）声明收口并再构建（sw mochi-mtoapzhb，已含本三修+chatcard #193；verify-cc-import-guard 19/19、auto-cid-guard 8/8、chat-tail 21/21 复跑全过）——按不并行 commit 协议，提交由收口构建者 AI-A 执行。
- 给 AI-A：#197 是机制级修复，之后新写设置项仍建议优先 click/明确保存按钮，change 只是兜底能收了。
### 2026-09-05 19:4x（#193 字卡库批量导入后旧字卡全部消失：权威大库未取回写回覆盖；未构建，待收口；本条不构建——工作区另有并行会话在途 mobile-adapt.js/period.js/personalize.js）
- [跨域改动 src/js/chatcard.js（AI-A 业务文件），理由：用户直接指派修复（附完整诊断）]（**改动文件：src/js/chatcard.js（新增 ccAuthSeen 双作用域权威已见标记：applyRestored 启动恢复读到权威/hydrateScope 三出口（hasData 预检、idbHydrateKey 成功、确认无键 ok===null）且 fullKey===curFullKey() 时置位，contact-switched 重置 own；saveGroups 首行守卫——未确认权威库已取回时不直写，idbHasKey 探测权威键，存在=rescueCcOverwrite 合并营救（保住内存增量→hydrateCurScope 取回权威→mergeCcGroupsInto 按分组合并去重→写回+重绘），确认无键=放行直写，探测/取回失败宁缓写；原 saveGroups 逻辑改名 saveGroupsNow，幂等 ccRescueInflight）、build.mjs（哨兵 +3 全逻辑锚点）、FIX-REGRESSION.md（#193 行+设备索引苹果17 行补 193）、tools/verify-cc-import-guard.mjs（新增 19 断言）**；构建状态：**已构建·sw mochi-mtoapzhb，随库一并打入 #196/#197/#198（AI-B 已声明完整）**）。
- 需求/根因：iPhone 17 Pro+Safari（v3.26.445 诊断 ts=1788577876618）「字卡库一次性导入太多，之前字卡全部消失」——公用库 cc-groups-public 17.67MB 被启动回填挂起在 IDB，openCcPage 显示页面后 hydrateCurScope 异步取回权威库；该窗口内内存 groups 是空/残缺快照，批量导入（及上传/编辑/删除全部写路径）合并进残缺库后 saveGroups 整包写回权威键=旧字卡被覆盖不可恢复。#188/#120/#85 同族第三例（伤在写回覆盖），#139 防复制守卫只护 JSON 文件导入。
- 验证：node --check 过；node tools/verify-cc-import-guard.mjs 19/19（真实源码桩环境：权威存在拒写+合并营救旧卡新卡都在/确认无键放行/探测与取回失败宁缓写/并发幂等）；node build.mjs --check-sentinels 399 全绿哑哨兵 0。
- 给收口构建者：①工作区并行会话在途的 mobile-adapt.js/period.js/personalize.js 未声明收口，构建前按规范核对；②真机验证（iPhone 17 Pro Safari）：批量导入大量字卡后旧字卡不消失；正常导入/上传/编辑/删除不被守卫拖慢（已取回过权威库零开销直写）；③已丢字卡的该设备如需恢复，从「数据备份」导出包恢复（其他设备导出→本机导入）。

### 2026-09-05（开屏公告「基础疑问可直接问 AI」高亮标色——本次构建者：AI-B=本会话）
- [AI-B 域]（**改动文件：src/css/base.css（新增 .splash-hl 橙色加粗样式）、src/js/clock.js（renderSplashSections 与必读摘要渲染支持 {hl:...} 高亮条目类型）、src/template.html（静态兜底两处加 splash-hl）、src/pwa/notice.json（必读摘要拆行+章节二该句改 {hl}）**；构建状态：见本条收口）。
- 需求：用户要求开屏里「基础疑问可直接问 AI，比我回复快」标不同颜色、显眼；追加确认再标三处——备份警告（必读摘要）、报修格式（章节二）、浏览器/桌面快捷方式双开数据不统一（章节三），全开屏橙色密度控制在 4 条内。
### 2026-09-05 19:0x（#186 竞态防线收口构建：令牌 404 抢跑误清正常表情气泡——verify-quote-image E3 实证；本次构建者：AI-B=本会话，随库一并收口 #189/#190/#192 在途改动）
* [AI-B 域]（**改动文件：src/js/chat.js（#186 渲染占位加竞态防线：img error 延时 1.5s 复核 src 仍为令牌且池 expand miss 才落「图片丢失」占位——旧写法 404 事件抢在池观察器改写 src 前触发会误清池中有数据的正常表情，verify-quote-image E3 稳定复现 16 PASS 后崩，修后 20/20）、build.mjs（删 #191 残留 terser import——未安装依赖会使 node build.mjs ERR_MODULE_NOT_FOUND，#191 结论不接入，内部 minifyJs 保留）、FIX-REGRESSION.md（#186 行补竞态说明）+ 随库收口 stash 恢复的并行会话已声明完整改动：#189 fullscreen.js/mobile-adapt.js/base.css+verify-fullscreen-ipad.mjs（25/25）、#190 bg-keep.js 幅度 0.006、#192 personalize.js 小组件独立透明度、三方 WORKLOG/FIX-REGRESSION/build.mjs 哨兵登记**；构建状态：**已构建·sw mochi-mto9u2w0，哨兵 391/391 哑哨兵 0**）。
* 验证：node --check 全过；verify-fullscreen-ipad 25/25、verify-quote-image 20/20、verify-media-pool 8/8、verify-feed-auth-guard 16/16、verify-chat-tail 21/21。
* 备注：本会话与 #189 会话并发写过工作区（其 #189/#190/#192 WIP 曾被本会话临时 stash 隔离构建，已恢复并按其 WORKLOG「随库一并打入」声明收口）；全程未动 stash@{1}（baseline-check-tmp，非本会话所留）。
### 2026-09-05（#189 iPad 全屏「没有生效」+全屏滑动一直闪烁：方向监视误杀/iPad 零可见效果/自愈层死代码 三根因收口）
- [AI-B 域·本次构建者：AI-B=本会话]（**改动文件：src/js/fullscreen.js（startFsMonitorSafe iOS 出口+orientationchange 出口+1500ms 复核 !isIOS 门）、src/css/base.css（html.tablet.ios-pwa-standalone.ios-fs-active 隐藏模拟状态栏，#111 手机行为不动）、src/js/mobile-adapt.js（healViewport 补裸 d 声明复活整层自愈+稳态 pin 条件式+全屏底边容差 --mochi-safe-top+全屏态跳过 vv offset 归零+--mochi-ios-h 两分支 ≥6px 迟滞）、build.mjs（FIX_SENTINELS +10）、FIX-REGRESSION.md（#189 行+设备索引 iPad 三行补 144、189）、tools/verify-fullscreen-ipad.mjs（新增 25 断言）**；构建状态：见本次收口构建提交）。
- 根因：①Safari 无 orientation.lock（WebKit #257695），iPad 横屏持握点全屏 ~2s 被方向监视误杀退出+误导弹窗+FB_KEY 写坏=「没有生效」；②#111 让 iOS 全屏保留模拟状态栏（修 iPhone16），iPad 上保留=开关零视觉变化；③healViewport v3.26 重写漏写 documentElement 声明，裸 d=window.d undefined→TypeError 被 try 吞=稳态自愈整层死代码；修活后原无条件 pinScrollTop 会与用户滚动对打（#179 后 .phone 底边天然超 vv 一个安全区）+vv 逐帧抖动逐次重排=「滑动一直闪烁」，故 pin 条件式+容差+门控+迟滞必须同批落地。
- 验证：node --check 过；verify-fullscreen-ipad 25/25；--check-sentinels 全绿哑哨兵 0（391 条）。
- 收口说明：本会话为收口构建者，随本次构建一并打入 WORKLOG 已声明完整的在途改动（#179/#180/#185/#186/#187/#188/#192）。给并行会话：#188 feed 与本会话对 build.mjs 并发写过两次（Edit 撞「modified since read」），已改用脚本原子插入解决；后续对 build.mjs 的追加请走同款行插入而非整段重写。
### 2026-09-05 2x:xx（#192 小组件透明度拆分独立调+应用到全部；未构建，待收口）
- [跨域改动 src/js/personalize.js（AI-B 系统文件）+ src/template.html（一行文案），理由：用户直接指派「装修模式小组件透明度每个单独调+可应用到全部」，且该功能全部在 personalize.js 装修菜单内实现]（**改动文件：src/js/personalize.js（新增 widgetOpKey/widgetOpacitySel/applyWidgetOpacityOf/applyAllWidgetOpacities：按类型存 widget-opacity-<type> per-cid，内联 style.opacity 覆盖全局 --widget-opacity，未设/=100 清内联回落；点卡片菜单「组件透明度」改只调本组件，pills 增「应用到全部小组件」（当前值写所有 [data-card-bg] 组件键）与「恢复默认（跟随全局）」；启动/contact-switched/refreshDeskVisuals 三处统一 applyAllWidgetOpacities 回放；边看边调抽屉滑条文案改「全局默认组件透明度」）、src/template.html（设置页行文案加「（全局默认）」）、build.mjs（哨兵 +1，锚 widgetOpKey 定义行）、FIX-REGRESSION.md（#192 行）**；构建状态：**未构建**——工作区另有并行会话未收口的 bg-keep.js/mobile-adapt.js/fullscreen.js/base.css（#189/#190）与 build.mjs 残留 terser import（依赖未装会使 node build.mjs 直接 ERR_MODULE_NOT_FOUND，--check-sentinels 是临时 npm i terser --no-save 后才跑通的，收口构建前请先处理该 import），按不夹带规则留给收口方一并构建）。
- 需求/方案：全局 widget-opacity 键与 --widget-opacity 变量保留为「全局默认」；独立值优先级更高（内联 opacity 覆盖）。applyAllWidgetOpacities 类型从 DOM [data-card-bg] 收集，覆盖 CARD_BG_TYPES 之外的 desk-period 等裸类型。
- 验证：node --check 过；node build.mjs --check-sentinels 391 全绿哑哨兵 0。
- 给收口方：①构建前先决断 build.mjs 第 9 行 terser import 去留（WORKLOG #191 结论是不建议接 terser）；②真机验证：点单组件调透明度只影响该组件、应用到全部同值、恢复默认回落全局。

### 2026-09-05 18:2x（#191 首屏体积优化调研：terser 接入 build.mjs 已试并回滚——与哨兵体系不兼容；未构建）

- [AI-B 域]（**改动文件：无最终改动——build.mjs/package.json 曾接 terser（compress-only 不 mangle），--check-sentinels 实测 30+ 条哨兵「针在注释里/表达式被改写」警报，已 git checkout 完整回滚+npm prune，工作区恢复原样**；构建状态：未构建，产物未动）。
- 背景：用户报「部署链接部分手机打不开」。实测线上 v3.26.461 正常、无未推送提交；产物 3.92MB 但 **GitHub Pages 自带 gzip，实际传输约 0.97MB**，首屏传输并非 4MB。
- 结论：①terser compress-only 实测省 32% 原始体积（gzip 后仅再省 ~0.2MB），但会改写逻辑表达式（如 ok===false→!ok）并删行内 // FIX 注释——哨兵 needle 锚定「压缩后产物文本」，380 条防回归锚点会集体失明，重登锚点工作量与风险远大于收益，**不建议再试**；②「部分手机打不开」主因更可能是国内直连 GitHub Pages 可达性（弱网/微信内置壳/新用户无 SW 缓存），与产物体积关系不大。
- 给双方/用户建议：根治「打不开」优先**镜像部署（Cloudflare Pages 等国内可达平台，零代码改动）**；长期再看按需拆分 script 块。build.mjs 零依赖压缩保持不变。
### 2026-09-05 15:5x（#190 保活音频底噪/电流声（OPPO Find X9 自带浏览器等多机型）：安卓幅度 0.02→0.006；未构建，待收口）
* [B 域]（**改动文件：src/js/bg-keep.js（ensureKeepAudioDataUrl 安卓幅度 0.02→0.006 + 根因注释，iOS 0.002 不动）、build.mjs（哨兵 +1：bg-keep.js `kaIsIOS() ? 0.002 : 0.006`）、FIX-REGRESSION.md（#190 行 + 设备索引 OPPO Find X9 挂 190）**；构建状态：**未构建**（工作区另有并行会话未收口的 fullscreen.js/mobile-adapt.js 改动，按不夹带规则留给收口方一并构建））。
* 根因：后台保活的 1 秒循环 220Hz 正弦波（<audio> volume 0.05，安卓幅度 0.02 ≈ -60dBFS）在人耳最敏感低频段常播，灵敏扬声器实听即持续底噪/电流声；iOS 曾同型（v3.15.x）降 0.002，安卓保守下限过高、多机型复发。防无声节流有效条件是「样本非零 + volume>0」而非响度，降到 0.006（≈-88dBFS 物理不可闻）不影响保活。
* 验证：node --check 过；node build.mjs --check-sentinels 380 全绿哑哨兵 0。
* 待办：构建者收口构建+提交；真机验证（OPPO Find X9 自带浏览器）底噪消失且后台保活仍有效（切后台 1 分钟+回前台消息/通知正常）。
### 2026-09-05 15:xx（#188 朋友圈不显示图片（iPad Air 6+QQ浏览器）：IDB 读失败窗口把剥图快照写回 feed-posts 权威键——四条裸写路径全部上守卫；本次构建者：AI-B）
* [AI-B 域·跨域改动 src/js/feed.js（AI-A 业务文件），理由：用户直接指派修复朋友圈无图]（**改动文件：src/js/feed.js（新增权威键守卫：feedAuthSeen 会话见过权威数据标记 + feedGuardWrite——见过权威或 store.get(KEY) 非空→照常写，否则 window.idbHasKey 探测：确认存在=绝不写回+增量留 pending+10s 有界重读权威最多 2 次，确认不存在=放行写保住并集保数据，探测失败按存在处理；feedMergeFromIdb 改守卫写回+写回成功才清 pending；load() pending 合并去掉 !feedDbReady 前置；save 预就绪/post-ready、15s 保险丝、发布兜底四条 store.set(KEY) 全部改走守卫）、build.mjs（哨兵 +6，全逻辑锚点）、FIX-REGRESSION.md（#188 行+设备索引 iPad Air 挂 188）、tools/verify-feed-auth-guard.mjs（新增 16 断言）**；构建状态：见 git 提交，与在途 #186/#187 src 一并收口）。
* 根因：feed-posts 超 200KB 只写 IDB（LS 副本被大键迁移删走）；WKWebView 系（iPad QQ浏览器/Safari 家族，iOS 挂后台杀 IDB 连接）首发 idbGet 4s+4s 超时返回 undefined 与「键不存在」不可分，启动回填未到时 load() 手上只剩剥图快照（图片全被剥成 [图片]/imgs=[]），旧代码四条路径（feedMergeFromIdb 合并写回/save 非空直写/15s 保险丝/发布兜底）会把无图版本整包写进权威键——图片从数据层永久消失，之后 IDB 恢复也救不回。诊断佐证：用户 15:00:28 进朋友圈前后错误环零新增＝页内根本没有 img 元素（数据层无图），与聊天页 3 条 data:image 截断失败（同族：IDB 读失败回退有损快照）互为印证；#85/#120 同族但伤在「写回覆盖」而非只读丢失。
* 验证：node --check 过；verify-feed-auth-guard 16/16（抽真实守卫+load+feedMergeFromIdb 源码断言：超时拒写/键不存在放行/探测失败拒写/无接口旧行为/重读上限 2/seen 置位/pending 保留与清空/就绪后合并 pending）；--check-sentinels 全绿哑哨兵 0。
* 给 AI-A：①已丢图的设备若更新重进后朋友圈仍无图＝权威键已被旧版覆盖，只能从数据备份导出包恢复（其他设备导出→本机导入）；②本修复同时让「读失败窗口」内朋友圈不再把无图版写回，10s 重读权威成功即自动恢复完整显示。
* 收口说明：最终构建 sw **mochi-mto7m0dm**（17:57），已提交 bc4170f 并含 #186/#187 并行 src；**给并行会话（fullscreen/mobile-adapt 的 iPad 全屏修复）**：①发现你把修复注释标为 #188——该编号已被本条（朋友圈无图）登记进 FIX-REGRESSION 188 行并提交，你的修复请改用 **#189** 并补登记；②你的 src 改动（fullscreen.js/mobile-adapt.js，17:20-17:21 落盘、未经你声明完工）我按「不夹带半成品」规则**未收进本次构建与提交**（曾短暂被我 17:20 构建扫进 mobile-adapt，已重建剥离），现原样留在工作区未暂存，等你收口；③你 mobile-adapt 里 healViewport 补 `var d = document.documentElement` 声明的修复看着是真 bug 修复，收口时记得配哨兵。
### 2026-09-05（#187 专属字卡串桌面：tryAutoSend 主动消息异步链无跨桌面守卫；本次构建者：AI-B）
* [AI-B 域·跨域改动 src/js/chat.js（AI-A 业务文件，tryAutoSend 区块，与 #180 持久化链/#185 空气泡/#186 媒体链零重叠），理由：用户直接指派修复]（**改动文件：src/js/chat.js（tryAutoSend 入口捕获 autoCid+sameAutoCid；await ensureReplyCardsReady 后放行前拦截；消息/rc-prob 撤回重发/尾部副作用每个 setTimeout 入口逐层拦截）、build.mjs（哨兵+2）、FIX-REGRESSION.md（187 行）、tools/verify-auto-cid-guard.mjs（新增 8 断言）**；构建状态：本会话构建 sw mochi-mto5we80 后，并行 #188 收口会话已把本修复随提交 bc4170f 一并入库推送范围（哨兵 379/379）——本会话不重复提交/推送）。
* 根因：B 桌面触发的 TA 主动消息，await 取回字卡（可数秒）+每条 setTimeout（900~2600ms）期间用户切到 A 桌面，B 池专属卡发进 A 聊天；scheduleReply/replyOnce 均有 sameCid 守卫唯主动消息漏了，多机型通病与设备无关。无头 Chromium 双桌面大库基线验证读池全对佐证读链路无恙。
* 验证：node --check 过；verify-auto-cid-guard 8/8；--check-sentinels 全绿哑哨兵 0；verify:all 114 过/86 断言失败（均为 #129 已甄别存量口径过期类）。
* 待对方处理（AI-A）：verify-chat-dupe AC5「二次刷新条数稳定」total=21 expect=17 失败——疑似 #180 chat-tail 回放与去重收敛语义冲突（本会话只加 tryAutoSend 守卫未碰该链，#131 chat-switch-idb-hang 同为存量）。
### 2026-09-05 13:1x（#179 iPhone14 Pro 覆盖形态底部白带：#148 高度公式漏加 env-top；已构建）
* [AI-B 域]（**改动文件：src/js/mobile-adapt.js（fs 态与非全屏 standalone 的 --mochi-ios-h 公式改 envTop+inner=min(screen)；监视跳过键盘/聚焦会话防瞬态误报）、FIX-REGRESSION.md（#179 行+#175 判定补强）、build.mjs（#148 needle 公式变更同步）**）。
* 根因：两类 iOS 形态——覆盖（env-top>0，可视=整屏）vs 已避让（env-top=0，可视=inner）——#148 高度单用 vv(inner) 使覆盖形态底部少算 env-top 高度露白 60px。统一公式高度=envTop+inner=min(screen)。
* 验证：node --check 过；判定器七场景全过（含修复前 3✗/修复后 0✗）；--check-sentinels 371 全绿。
* 待真机（iPhone 14 Pro 主屏幕全屏）：底部白带消失；15 Pro/16 Pro 回归不变形。

### 2026-09-05（#186 补刀：vivo X200s+Edge 诊断实锤——mediaNormalizePass 写池失败不校验返回值，令牌带病落库）
* [AI-B 域]（**改动文件：src/js/chat.js（mediaNormalizePass：flush 返回 false 时回滚全部令牌化+WeakSet 去标记+8s 重试，绝不带令牌 saveMsgs）、build.mjs（#186 哨兵 2→3 条）、FIX-REGRESSION.md（#186 行补根因③）**；构建状态：见 git 提交）。
* 依据：用户诊断报障显示 chat 页 12 条 `<img src="https://…/@@m:hash">` 资源加载失败=令牌入库而池数据缺失，旧代码 `await mochiMediaFlush()` 不看 false 直接 saveMsgs；大库机 IDB 写失败/页面被杀即永久空白。与 GC 误删（根因①）同症状不同路径，均已修。
### 2026-09-05（#186 表情包/图片空白气泡真根因：媒体池 GC 引用扫描漏群聊键/LS 快照 → 误删池数据；补令牌失配渲染占位）
* [AI-B 域·跨域改动 src/js/media-pool.js（#142 系 AI-A 媒体池），理由：同用户报障根因收口]（**改动文件：src/js/media-pool.js（mochiMediaGC 引用扫描 REFS 扩 group-chat-msgs/gc-msgs-<gid>/chat-tail + localStorage 同名键一并标记，LS 整体读异常放弃本次清理，宁漏删不误删）、src/js/chat.js（renderMsg sticker/image 分支对 @@m: 令牌挂 img error 监听，池缺失渲染「图片丢失」占位不再空壳）、build.mjs（+2 哨兵并同步改写被 #186 替换的 #166 旧锚点）、FIX-REGRESSION.md（#186 行）**；构建状态：见 git 提交）。
* 根因：用户补充「单发表情包/图片变空白」——媒体消息靠媒体池令牌渲染，查看存储页「清理孤儿媒体」旧正则 /(?:^|:)(?:chat-msgs|fav-msgs)$/ 不匹配群聊键与 LS 快照/尾巴日志 → 被引用图片被当孤儿删除，不可逆空白。
* 验证：node --check 过；--check-sentinels 全绿；真机清单见 FIX-REGRESSION #186 行。
### 2026-09-05（#185 联系人空气泡双向修复：生成端非空兜底 + 渲染占位 + 删除消息防尾巴日志复活）
* [AI-B 域·跨域改动 src/js/chat.js（AI-A 业务文件），理由：用户直接指派修复并要求构建上线；本次构建者：AI-B]（**改动文件：src/js/chat.js（①genReplyText 五处 pick 换 pickNonBlank 滤空白字卡+kaomoji 追加判空；②genOneReply 多字卡拼接前 filter trim + replyWord/defs 覆盖后最终非空兜底落 FALLBACK；③renderMsg 普通文本/parts 分支空白内容渲染「（空白消息）」占位；④消息操作菜单 del 分支 splice 前补 chatTailDrop——用户报「删除空白消息后刷新复活」，根因=删除没同步 #180 尾巴日志，chatTailMerge 回放拼回）、build.mjs（FIX_SENTINELS +3）、FIX-REGRESSION.md（#185 行）**；构建状态：见下方 git 提交）。
* 根因：回复链路对字卡内容零非空校验（空串/纯空白/零宽字符卡 truthy 直发；固定回复字卡/默认主字卡为空白时无条件覆盖）；删除入口漏 chatTailDrop 致刷新后日志回放复活。
* 验证：node --check 过；--check-sentinels 368 全绿哑哨兵 0；构建后跑 npm run verify 系列。
* 给 AI-A：历史已存空白记录更新后会显示占位而非空壳；用户更新后需再删一次那条消息（本次修复后才会真正删得掉）。
### 2026-09-05（Mochi 名字澄清置顶 + 措辞改「就是想取个简单的名字取的」）
* [AI-B 域]（**改动文件：src/template.html（开屏顶部署名行下新增置顶澄清行 + 【六】灵感来源段措辞）、src/pwa/notice.json（summary 首行 + 同段措辞）**；构建状态：**已构建·sw mochi-mto23nlt，哨兵 364/364**）。
* 说明：好多人误会 Mochi 与 milk 字卡有关系/本站是 milk 二改，按用户要求把澄清提到开屏顶部，措辞统一为「就是想取个简单的名字取的」。

### 2026-09-05（防骗表述修正：「除这两个账号外收费均为诈骗」→「本站不收取任何费用，任何收费均为诈骗」）
* [AI-B 域]（**改动文件：src/template.html（开屏防骗声明 + 设置页底部防骗声明）、src/pwa/notice.json（alert）**；构建状态：**已构建·sw mochi-mto0cdz2，哨兵 364/364**）。
* 说明：上一条表述隐含「这两个账号可能收费」的错误含义，本站本就完全免费，统一改为「本站不收取任何费用，如有出现任何收费情况，均为诈骗」。

### 2026-09-05（开屏作者账号更新：新增抖音@言序（58334080131），改「只有小红书一个号」表述）
* [AI-B 域]（**改动文件：src/template.html（顶部署名行 + 开屏防骗声明 + 设置页底部防骗声明）、src/pwa/notice.json（alert）**；构建状态：**已构建·sw mochi-mto09n47，哨兵 364/364**）。
* 说明：作者开了抖音号发链接（不玩抖音、不回消息），原「作者只有小红书这一个账号」表述需更正为「两个账号」；署名/二传要求仍保持小红书不变。


### 2026-09-05（开屏补说明：非 milk 二改、从零二创、Mochi 名字与 milk 无关）
* [AI-B 域]（**改动文件：src/template.html（【六、版权与灵感来源】灵感来源段首加一条）、src/pwa/notice.json（同段同步）**；构建状态：**未构建**，待构建者收口）。
* 用户要求开屏明确：本站不是 milk 字卡的二改/二创版本，是从零独立编写的字卡传讯二创作品；「Mochi」名字与 milk 字卡无关，纯属灵机一动取的简单名字。已照加，原有 milk 灵感来源标注保留不动。notice.json 语法已验、--check-sentinels 全绿（364 条）。

### 2026-09-05 15:xx（#171/#182 字卡导入修复源码补提交：产物已随并行收口构建入库，本条补齐 src 与产物一致并推送）
* [AI-A 域]（**改动文件：仅补提交 src/js/chatcard.js（#171 真实报错三分流+UTF-16/裁剪/空文件自救+失败现场写 __jsErrors；#182 200MB 级库导入内存加固=rawHead 先截后清/write 前松开源文本与 reader 持有/OOM 两阶段单独指引/trim 自救限 80MB 内）+ tools/verify-cc-import-parse.mjs（23 断言）**；构建状态：无需重建——HEAD index.html 已含 utf-16le/内存不足以一次性导入/rawHead 全部锚点，哨兵 6 条随库 364/364 绿）。
* 说明：用户报障 iPhone 16 Pro+CriOS 换浏览器导字卡库失败（诊断实锤 cc-groups=203.74MB，OOM 被旧 catch 吞成「格式错误」，机型无关只与库体积有关）；修复经 #171（真因分流自救）+ #182（内存加固）两轮，中间 #177 收口会话已把当时工作区实现打进产物并同步哨兵 needle，本会话核对一致后补提交源码推送。

### 2026-09-05 14:xx（TASKS #129 全量甄别完成：58 个存量失败脚本定性 + 产出 #130/#131 两张派生清单；无 src/产物改动）
* [AI-B 域]（**改动文件：TASKS.md（#129 进度更新 + 新增 #130 过期批修清单 / #131 疑似真缺陷核查清单）**）。58 个存量失败脚本逐个收集失败断言行后定性：**约 44 个=口径过期非产品缺陷**（ta-checkin 预设 17→23 扩容、more-cats 互动 6→8/小游戏 4→8 项、narc/myarc 菜单加行、poke-emoji「小A的」→「TA 的」称呼统一、dark-mode D1-D5=v3.27 主题三档弹窗化（点行不再直接切换）、gc-pool-scope T3=#157 默认卡语义改版后 hasDefault:false 是新正确行为、oom-leaks B3/B5=v3.18 createObjectURL 政策、room A8=功能字卡 tab 重构、fish-play=摸鱼页本周小结改版等）；**6 个疑似真缺陷→#131**（最重：chat-switch-idb-hang 切联系人 LS 快照未写+记录未渲染——#90 修复回归 or chat.js 缩水防护拦截直种 IDB 数据，需 AI-A 判定；其余 mail-cfg-per-cid 跨桌面来信 0 封/feed-reply-ui role 反向/myarc 档案写入空/coop-mine B7b/water E1 连续天数）；**环境限制类**（voice-record 无麦克风、kb-overlay-kernel 悬浮键盘、desk-persist/move-swipe 拖拽模拟）保留。结论：AI-B 域未发现新产品缺陷。
* 待对方处理（AI-A）：#131 六项逐个核实——真缺陷按 BUGS 规则修+登记，测试侧则并入 #130 批修；#130 脚本簇 AI-A 忙时可由 #129 会话代修（只动脚本不动产品）。

### 2026-09-05 12:1x（#177 新增设置页【功能诊断】：逐项测试全部功能正常/异常；已构建）
* [AI-B 域]（**改动文件：src/template.html（row-func-diag 锚点，信息诊断分组下）、src/js/device.js（collectFuncDiag：25 项功能三级测试 T1 入口 typeof/T2 页面+图标节点/T3 真实打开-返回-恢复，门控功能 ⚠ 需注意，强制恢复桌面+关浮层+复位 tab；报告汇总+✗ 清单，弹窗+自动复制）、build.mjs（FIX_SENTINELS 2 条）、FIX-REGRESSION.md（#183 行）；构建状态：已构建·sw 见 version.json**）。
* 验证：node --check 过；--check-sentinels 全绿；CDP 端到端无头跑完整流程。
* 待真机：任意机型设置→功能诊断→约 15 秒逐项测试→报告。

### 2026-09-05 13:xx（#182 超大字卡库（200MB 级）导入内存加固：源文本松绑+写盘前释放+OOM 分流指引；源已完成·未构建，与 #171 同函数叠加）
* [AI-A 域]（**占用 src/js/chatcard.js pickImportFile（#171/#182 同一处，勿回滚）；改动文件：src/js/chatcard.js（①读入即只留 rawHead=先 slice(0,300) 再 replace——修掉 #171 初版「全文 replace 再 slice」对 200MB 文件的全文扫描+巨型中间串（本次自查抓到的真 bug）；onload 尾松开 reader.onload/onerror 引用让 200MB result 可回收②解析成功进写盘前置空 txt/raw 引用——JSON.stringify(groups) 与源文本两个 200MB 大头不得同时钉在堆上③OOM（RangeError/Out of memory）解析/写盘两阶段单独识别，给「查看存储→字卡库瘦身+设置→数据备份整包恢复」指引，不再误报格式错误④trim 自救对 >80MB 文件不启用（slice 复制本身就是峰值推手））、build.mjs（FIX_SENTINELS +3，接 #181 后）、FIX-REGRESSION.md（#182 行）、tools/verify-cc-import-parse.mjs（扩至 23 断言）**；构建状态：**未构建**——与 #171 同在 chatcard.js，随下次收口一并打入）。
* 根因（iPhone 16 Pro+CriOS 诊断 ts=1788547274682 实锤 default:cc-groups=203.74MB）：200MB 级库导入全程峰值=源文本+parse 结果+merge 后 groups+stringify 新串+IDB 克隆叠加，GB 级撞 iOS WebKit（含 iOS Chrome）单进程上限→OOM 被 catch 吞成「文件格式不正确」；与机型无关、只与库体积有关（用户明说「其他型号手机也有」），故修内存链路而非设备特判。
* 验证：node --check 过；verify-cc-import-parse 23/23；--check-sentinels 全绿哑哨兵 0（含新 3 条）。
* 给收口会话：#171+#182 都在 chatcard.js pickImportFile 一处，一起打；用户侧指引=更新到新构建后重试导入，若仍失败，诊断信息 [字卡导入] 行直接给真实失败点（哪阶段/什么错/文件头 120 字符）。

> 【占用声明 2026-09-05】#180（用户报障一加 ACE3/PJE110+Edge「刷新重开丢最近一段聊天记录」多机型反复）占用 src/js/chat.js 聊天持久化链区域（writeLsSnapshot/addRec/retractMsg/partialRetractMsg/loadMsgs/清空导入一带，新增 chatTail* 尾巴日志三件套与 performLsSnapWrite 保尾）+ build.mjs 哨兵尾部 3 条 + FIX-REGRESSION.md 180 行 + tools/verify-chat-tail.mjs 新增；与并行 #179（mochiMapBubbleCss，chat.js 尾部）零重叠，勿回滚彼此部分。**本次构建者：暂不构建**——并行 #179 会话仍在途（verify-bubble-css-map.mjs 刚落盘），按约定不夹带对方进行中的改动，等 #179 收口构建一并打入；收口构建者请把我这 3 条哨兵与 21 断言脚本一并核过。

### 2026-09-05 13:0x（#180 多机型「刷新重开丢最近一段聊天记录」：同步尾巴日志三件套 + LS 快照超限保尾；源已完成·未构建，待与并行 #179 一并收口）
* [AI-A 域·chat.js 持久化链]（**改动文件：src/js/chat.js、build.mjs（FIX_SENTINELS +3）、FIX-REGRESSION.md（180 行）、tools/verify-chat-tail.mjs（新增）；构建状态：未构建**）。
* 诊断解读（PJE110+Edge ts=1788519516988）：IDB default:chat-msgs=16.4MB 在、账本 1635 条——不是读不回，丢的是「低频落盘窗口内」的最新几条：saveMsgs 走 rIdle(≤4s)+2.5s 间隔合并落盘，而 16MB 级异步 IDB 事务在安卓 Edge 族（一加/OPPO/真我/荣耀/小米实测族）会挂起或随进程被杀回滚，visibilitychange/beforeunload 的离页 flushSave 事务也未必来得及提交——最近几条自始至终没有第二副本。另发现实打实漏洞：performLsSnapWrite 快照超 2MB 时静默 return＝LS 兜底全空（权威读取失败窗口里聊的消息零副本）。
* 方案：①chatTailAppend——每条新消息同步写 LS 小键 <cid>:chat-tail（纯文本轻副本≤60 条/文本截断 1000/img、voice/大 parts 不进防写爆）；②chatTailMerge——权威读库成功后按 ts|side|text 签名全量去重回放（撤回/两处局部撤回 chatTailDrop 摘除、清空记录与整包导入 chatTailClear，防已删内容复活）；③performLsSnapWrite 超 2MB 折半丢最旧保尾不弃写。#88 权威守卫/#90 账本守卫/低频落盘链路全部不动。
* 验证：node --check 过；tools/verify-chat-tail.mjs 21/21（抽真实函数源码跑行为断言：封顶/保尾/去重幂等/撤回不回放/清空/超限保尾/接线齐全）；--check-sentinels 356 全绿哑哨兵 0。
* 待收口构建后真机：聊几条→立即杀掉浏览器→重开→最近几条应在；撤回一条→刷新→不复活。

### 2026-09-05 12:3x（#178 屏幕适配诊断三件套：历史快照对比+常驻监视+异常形态自动上报；已构建）
* [AI-B 域]（**改动文件：src/js/device.js（快照存档 xy-home-v2:screen-diag-hist 上限 8 份+报告末尾自动历史对比；常驻监视每 5s 轻量采集、✗ 形态签名状态沿才存档/上报；静默写错误环 __diag-errs 与信息诊断同键同格式）、FIX-REGRESSION.md（#175 行补 #178 三件套）；构建状态：已构建·sw 见 version.json**）。
* 验证：node --check 过；对比单测（变化/一致）全过；CDP 端到端：手测存 baseline→注入异常→监视 ≤6.5s 自动捕获+错误环上报。

### 2026-09-05 12:0x（#175 补强 + #176：屏幕适配诊断五项新采集/两新判定 + 设备兼容诊断改名 + 信息诊断分组；已构建）
* [AI-B 域]（**改动文件：src/template.html（复制诊断信息→设备兼容诊断；两行上方加 gs-title【信息诊断】分组说明）、src/js/device.js（屏幕适配报告新增：方向/env(safe-area-inset-bottom)/.tabbar 底边/视口平移残留/键盘残留五项采集；新增判定「底部导航栏被裁」「视口平移残留」）、FIX-REGRESSION.md（#175 行补强+#176 说明）、build.mjs；构建状态：已构建·sw 见 version.json**）。
* 验证：node --check 过；判定器七场景单测全过；CDP 端到端（行/弹窗/报告 32 行/UI 改名与分组）全过；--check-sentinels 353 全绿。

### 2026-09-05 11:4x（#175 新增设置页【屏幕适配诊断】：跨设备屏幕适配问题精准定位工具；已构建）
* [AI-B 域]（**改动文件：src/template.html（设置页 row-screen-diag 锚点，与信息诊断分开）、src/js/device.js（collectScreenDiag 只读采集：env()/var/diff 三源对比+vv.scale+.phone/.statusbar 实测；screenDiagJudge 纯函数判定器——六形态 ✗/✓ 自动判定带修复条目号；openModal 大窗展示+copyText 自动复制）、build.mjs（FIX_SENTINELS 2 条）、FIX-REGRESSION.md（#175 行）；构建状态：已构建·sw 见 version.json**）。
* 动机：#114/#148/#168/#174 等 iOS 屏幕适配问题在不同机型/形态反复出现且形态互异，靠通用诊断+口述难精准定位；本工具一键出专项报告，✗ 条目直接对号修复条目。
* 验证：node --check 过；判定器六场景单测全过；--check-sentinels 353 全绿哑哨兵 0。
* 待真机：任意机型设置→屏幕适配诊断→健康设备全 ✓、故障设备 ✗ 对号。

### 2026-09-05 11:0x（#174 iPhone15 Pro 主屏幕顶部露白：iOS26 形态页面被缩到 scale≈0.85 盖不满屏幕；已构建）
* [AI-B 域]（**改动文件：src/template.html + src/js/device.js（viewport meta 全部加 minimum-scale=1.0 锁缩放下限）、src/js/mobile-adapt.js（healViewport 缩放异常自愈：standalone 下 scale<0.95 重写 viewport meta 吸附回 1，每会话限 3 次+4s 间隔）、build.mjs（FIX_SENTINELS 2 条）、FIX-REGRESSION.md（#174 行）；构建状态：已构建·sw 见 version.json**）。
* 根因：诊断实锤 visualViewport=462×932 scale=0.85（布局视口大于物理屏=页面被整体缩小），缩小后物理覆盖 393×792 < 852 → 顶部状态栏区域露白。maximum-scale=1 拦不住 iOS26 这类被动缩小；minimum-scale=1 可锁。
* 验证：node --check 过；--check-sentinels 351 全绿哑哨兵 0。
* 待真机（iPhone15 Pro 主屏幕）：更新后顶部白带消失；若存量会话已缩小，回前台 4s 内自动吸附回 1:1。

# 本次构建者：本会话（#172 收口构建：用户报障表情包刷新必丢修复打入产物，随库带 #171/#173/#129 在途改动一并收口提交推送）

> 【占用声明 2026-09-05】#172（用户报障「我的表情包/自定义字卡刷新必丢」）占用 src/js/chat.js 表情包恢复链区域（~6750-6800 与 ~7067-7090）+ build.mjs 哨兵尾部追加 + FIX-REGRESSION.md 新行；与工作区 #167（chat.js 3143/3260 两行）/ #171（chatcard.js）零重叠，勿回滚彼此部分。本会话不构建，收口时一并打入。

### 2026-09-05 06:xx（TASKS #129 第二批B：超时双修 + desk 簇 + 删 gift-wallet-split；无 src/产物改动·不涉及构建）
* [AI-B 域]（**改动文件：tools/verify-avatar-ta-change.mjs（16/16：T3 改自适应轮询+池就绪条件收紧为「池 JSON===BIGGOLD」——应用首启默认池种子（~214B 含与 cs 相同的 RED）会顶掉种子池致「随机到当前头像跳过」永跳，产品切换链路经干净环境探针验证 65s 正常换入 jpeg 1563B 无缺陷）、tools/verify-pong-balance.mjs（18/18：非 hang，矩阵 6 格 62 场对局在本机真实耗时 13.6 分钟超套件 180s 预算，头部加 `verify-suite:timeout=900000` 提示）、tools/verify-suite.mjs（新增脚本级超时提示机制：脚本头 `verify-suite:timeout=毫秒` 可上调单项预算，默认仍 180s）、tools/verify-desk-click.mjs（4/4：开屏断言从「节点被删」改「.hide class」=应用真实口径+兜底强制 hide；触摸合成 click 检查降级为告警——无头合成不稳定，原 bug 回归锚点是 preventDefault 检查+click 链路两条，均绿）、tools/verify-desk-icon-decor.mjs（7/7：同款开屏口径修正）、tools/verify-gift-wallet-split.mjs（删除：per-cid 拆分时代口径，迁移覆盖已由 unified-heart-wallet 的 D 组（老占位巨款迁移/落盘）+申请制流程（K 组）+wallet-edit C 段（市集入口）完整承接，无独立价值）**）。至此后 #129 累计修绿 14 个、删 2 个、套件剔除 2 个元工具；剩约 50 个待甄别（多为过期断言，cc-*/cjian-*/gc-*/brick/water 等簇）。

### 2026-09-05 05:xx（TASKS #129 第二批A：套件端口契约 174 脚本 codemod + 跑批末 Chrome 清理 + 环境性三件套修绿 + WORKLOG 归档；无 src/产物改动·不涉及构建）
* [AI-B 域]（**改动文件：tools/verify-*.mjs 174 个（codemod：`const cdpPort = 9xxx+random` 统一改 `Number(process.env.MOCHI_CDP_PORT) || (…)`——守约脚本 6→180，并发抢端口误报根除；全部 node --check 过）、tools/verify-suite.mjs（跑批末自动清理残留无头 Chrome：只杀命令行同带 remote-debugging-port+mochi- 临时档的实例，不碰用户浏览器，防 #162 型 32.8GB 涨盘）、tools/verify-bg-notify-dedupe.mjs（16/16：T2/T2b 探针补产品口径 refTs=到达时刻——闸门 2.5s 自查豁免靠它，裸调必误判重复；T2b 改等 2.7s 出新鲜窗再断真重复；T4 伪造 visibilitychange 置 lastHiddenAt——无头页恒 visible 不造不出切后台，v3.16 过渡期判定依赖它，另加回前台复位断言）、tools/verify-chat-send-btn.mjs（4/4：双击场景改 tapSend 同款 pointerdown/up+click 事件链——发送挂 pointerup 裸 click 不触发；两次 tap 真实间隔防第二击砸进第一击异步落盘；与上段拉开 2.5s 隔离守卫窗）、tools/verify-ask-no-false-dock.mjs（4/4：开屏关 hidden 属性改 .hide class＝作者 CSS 覆盖 [hidden] 同 .cc-tab 教训；补 cc-scope-mask 点掉；导航三跳改程序化 click——更多面板未开时 more-ask 矩形为 0 致触摸链全空转；保底停靠 490px 实测正常＝产品无缺陷）、WORKLOG.md+WORKLOG-archive/2026-09.md（按约定保留 14 条归档 78 条）**）。
* 三件套定性更正：此前 TASKS 备注写「疑似环境性」，实测全是测试自身缺陷（探针用法/事件链/导航链），产品行为经修后链路全部验证正确；至此后 #129 累计修绿 10 个、删 1 个，剩约 57 个待甄别。

### 2026-09-05 04:xx（TASKS #129 verify 套件基线清理·第一批收口：4 脚本修绿 + 1 删 + 套件剔除元工具；无 src/产物改动·不涉及构建；后半随 0e03d0f 已入库，本条为收尾提交）
* [AI-B 域]（**改动文件：tools/verify-cc-mine-clean.mjs（B3 预设断言 ===10→≥10=查岗地点预设池 10→19 句功能性扩容；D 组清场补 indexedDB.deleteDatabase('mochi-db')＝原只清 LS 被重载 idbRestore 把 C 组残留 1 卡盖回致 n===2 必红，同 D2 已知坑只修了 D2 没修 D1）、tools/verify-unified-heart-wallet.mjs（K3/F3 改 v3.16 红包摘要口径：明细已移主页「心意币红包记录」，聊天记录页为「我/联系人 发红包」双向摘要——原断言「发红包记录」「已领取」文案已不存在）、TASKS.md（#129 行进度更新）**；前半批（wallet-edit 重写 14/14、rp-wallet-edit 删、bg-notify-dedup A2 改 v3.18 createObjectURL 反转口径 13/13、suite 剔除 triage 元工具）已随并行会话 0e03d0f 收口推送，不再重复列）。验证：四脚本单跑全绿 14/14、13/13、21/21、14/14。
* 第一批结论（供第二批参考）：单跑复测 67 个失败脚本仅 4 个是并发假阳性（quote-image/sticker-retract 单跑全过、interact-frequency/invite-settings=AI-A #164/#165 已修），63 个真实独立失败＝绝大多数是断言过期而非产品缺陷；已定性 3 个疑似环境性（bg-notify-dedupe T2/T4 hiddenForMs≈4.3s 可见性模拟未生效 / chat-send-btn doubleCount=0 点击未达 / ask-no-false-dock .phone 取不到元素）；gift-wallet-split 待按 v3.15 全局账本迁移语义重写；超时 2（pong-balance/avatar-ta-change）＝等待逻辑。明细线索在 TASKS #129 备注。

### 2026-09-05 02:xx（#172 用户报障：华为畅享70Pro+Chrome 字卡库自己加的字卡/表情包每次刷新必丢；01:48 诊断实证数据在 IDB 34.93MB 未丢＝恢复链断；源已完成·未构建）
* [AI-A 域]（**改动文件：src/js/chat.js（表情包恢复链三件套：①myeApplyIdb 统一应用＝原 tryRestore/reloadMyEmojiFromIdb 两处重复逻辑收口，比较基准从 store 快照改内存 myGroups——hydrate 写 store 后二者脱节，按快照会误判「同量不覆盖」恢复永不落内存；②myeHydrateFallback＝idbGet 读空改走 idbHydrateKey 按需取回——34.93MB 超启动回填预算（低内存机 12MB）每次刷新被挂起 __xyIdbDeferredKeys+大键从不落 LS 快照，原裸 idbGet 固定 4s+4s 低端机读不完静默放弃＝面板永远空；hydrate 6s+8s 慢读友好、成功进驻存并移出挂起名单，与 chatcard hydrateScope 同机制，tryRestore 重试穷尽也兜底；③myEmojiSave 防覆盖闸门＝键仍挂起时先取回 IDB 全量与内存新增按组去重合并再写，false 不写回防小包顶掉全量，null（确认无键）直写）、build.mjs（FIX_SENTINELS +2）、FIX-REGRESSION.md（#172 行）、tools/verify-mye-hydrate.mjs（新增，纯 Node 抽源码真函数 14 断言，零浏览器依赖）**；构建状态：**未构建**——工作区挂着 #167 已构建未提交产物与 #171/#173 在途，本条等收口构建一并打入；--check-sentinels 349 全绿哑哨兵 0）。
* 诊断解读：①IDB 大键明细 my-emoji-groups=34.93MB＝用户表情包全在，症状是「读不回」不是「没存上」；②「自定义字卡=0」另因＝专属字卡按桌面隔离：用户字卡在 default:cc-groups（12.3KB 在库），当前桌面 cmtmi25vy3j8 无专属键，非丢失（已答复用户）；③真实风险：修复前用户在空面板上新建分组/上传会触发 myEmojiSave 把空态写回覆盖 IDB 全量（本例 34.93MB 尚存＝还没踩中），闸门已堵。
* 验证：node --check 过；verify-mye-hydrate 14/14（桩调试中反抓出两处设计修正：应用基准改内存/hydrate 失败不写回）；--check-sentinels 349 全绿。
* 待真机（构建收口推送后）：表情包面板「我的」应自动恢复存量（首次打开面板可能转几秒）；上传新表情→刷新重进→新表情与存量都在。
* 给收口会话：本条 chat.js 改动区域（~6750-6800/~7067-7090）与 #167（3143/3260）零重叠；build.mjs 我的两条哨兵接在 #171 三条之后（与 #173 的四条共存于数组尾部），收口重建时一并核对。

> 【占用声明 2026-09-05】#173（用户报障「桌面美化和聊天美化的美化方案无法导出也无法导入」）占用 src/js/personalize.js 导出/导入区域（~1949-2130，startBeautyExport/beautyImportRow 两处；当时该文件已随 1bde7b1 收口无在途改动）+ src/js/data-backup.js（新增 window.mochiExportFile，anchorDownload 之后）+ 跨域 src/js/chat-settings.js（chatSchemeExport 的 doExport 文件分支，理由：聊天美化导出与桌面同病，只修桌面半边用户主诉不闭环）+ build.mjs 哨兵尾部追加 + FIX-REGRESSION.md 新行；与 #167/#171/#172 在途改动零重叠，勿回滚彼此部分。本会话不构建，收口时一并打入。

### 2026-09-05 03:xx（#173 用户报障：桌面美化+聊天美化的美化方案无法导出也无法导入——导出接三级降级保存链+补回复制/粘贴通道；源已完成·未构建，请收口构建者一并打包）
* [AI-B 域 + 跨域 chat-settings.js]（**改动文件：src/js/data-backup.js（新增 window.mochiExportFile=复用 saveBackupFile 三级降级[分享面板→保存框→确认后 anchorDownload]，暴露给美化两侧复用）、src/js/personalize.js（桌面导出接统一链+无方案也弹方式选择+补回「复制文字」[>3MB 拒绝防剪贴板截断]+文件名本地日期；桌面导入补回「粘贴文本」通道[textarea 与从文件并存，txtImportAuto 选完文件仍自动应用]）、src/js/chat-settings.js（聊天导出「导出文件」接统一链，裸 a[download] 降为兜底，文件名本地日期）、build.mjs（FIX_SENTINELS +4，数组尾部 #173）、FIX-REGRESSION.md（#173 行）、tools/verify-beauty-io.mjs（新增无头行为断言，verify:all 按文件名自动纳入）**；构建状态：**未构建**——构建者由 #167 会话持有，本条只改 src，请收口时与工作区在途改动一并重建打入）。
* 根因（环境能力缺失，非逻辑缺陷）：无头 Chromium 对线上产物实测四流程（桌面/聊天 × 导出/导入）11/11 全过＝代码链路正常；断点在 f4158f6（08-29）把桌面导出收敛为裸 a[download]、导入收敛为仅文件选择——**iPhone 主屏安装（standalone PWA）无下载管理器，a[download] 静默无反应、文件选择器也常不弹**，夸克等壳浏览器同理 → 桌面四条路全断；聊天导出虽有复制文字，方案含壁纸 data URL 时 JSON 巨大剪贴板写不进。data-backup v3.9.x 早已为同族问题（真我/华为/夸克导出无反应）给数据备份做了三级降级保存，美化导出没跟上。
* 验证：node --check 三文件过；--check-sentinels 349 全绿哑哨兵 0（首版两条哨兵共用 needle 被哑哨兵体检拦下，已收窄为各自完整调用串）；verify-beauty-io **16/16**（真实点击链路：无方案导出弹方式选择不裸下载/复制文字进剪贴板/打包确认后下载/来源→方式嵌套弹窗不被关/导入粘贴+文件双通道+导入前自动备份/聊天导出复制+下载/聊天导入文件→textarea→应用）。
* 待真机（iPhone 主屏安装 standalone 优先）：①桌面/聊天美化导出点「导出文件」应弹分享面板（可存到「文件」App），普通安卓浏览器=确认后下载不回归；②导入：粘贴文本与从文件导入均生效，导入前自动备份原美化不变；③复制文字通道对纯文字小方案可用。
* 编号说明：#171/#172 已被并行会话占用（chatcard 导入诊断/表情包刷新），本条改 #173。

### 2026-09-05 02:xx（#171 iOS16 Safari 导 milk json 报「格式错误」无法导入：导入失败三分流+转存自救+失败现场进诊断；源已完成·未构建——现产物里无本修复，收口需重建）
* [AI-A 域]（**改动文件：src/js/chatcard.js（pickImportFile：原一个 catch 把三类失败混成「文件格式不正确」→拆「解析失败（带真因+自救）／applyImportData 异常单独提示」；自救链=UTF-16 转存重读（首400字数 NUL 奇偶定字节序 utf-16le/be）+裁剪提取首个{到末个}；空文件→iCloud 未下载完整指引、HTML→回 milk 重新导出指引；失败现场（原因+文件名+大小+开头100字符）写 __jsErrors，设置页复制诊断直接带出）、build.mjs（FIX_SENTINELS +3，接在 #167 新 5 条后）、FIX-REGRESSION.md（#171 行）、tools/verify-cc-import-parse.mjs（新增，纯 Node 抽源码真函数 18 断言；verify-suite 按文件名自动发现，无需改套件）**；构建状态：**未构建**——当前工作区 index.html/sw.js/version.json 是 #167 终版构建（早于本修复，grep utf-16le=0 可证），本条 chatcard.js 改动不在其中；收口时请重建一次把 #171 一并打入，源与产物同 commit）。
* 根因：iOS 16 Safari 导 milk json 报「文件格式不正确」＝导入入口一个 catch 把三类完全不同的失败混成一句提示（①JSON 解析失败②文件 iOS 转存链路损坏：微信/邮件/文本编辑转存常变 UTF-16、iCloud 未下载完整读到空、网页另存成 HTML③applyImportData 自身抛错如存储配额），真因永远不可见；milk 识别分支本身 8 月已验证（转换模拟 477+6 张全过）。本次修「可诊断性+常见 iOS 损坏自救」，真机上一跑便知真因。
* 验证：node --check 过；--check-sentinels 343 全绿哑哨兵 0；verify-cc-import-parse 18/18（合法/BOM/UTF-16LE 带 BOM/UTF-16BE 无 BOM/包文字裁剪/空文件/HTML/顶层数组/损坏 JSON/处理异常不报格式/成功不写诊断）。
* 待真机（iOS 16 Safari，收口构建推送后）：重导 milk json——正常应直接导入；若仍失败，toast 会写具体原因，且设置→复制诊断信息「启动文件异常」一节出现 [字卡导入] 行，发诊断即可定位。
* 编号说明：#170 已被瘦身会话占用（其 FIX-REGRESSION 行已入库），本条改 #171。
* 给收口会话：本条与 #167 终版改动同在工作区（build.mjs 里两者哨兵都在、--check-sentinels 343 全绿已验），一并提交即可；勿回滚 chatcard.js/build.mjs/FIX-REGRESSION.md 的 #171 部分。

### 2026-09-05 02:0x（#167 终版：用户报障「关了多字卡回复仍回多条」——实证后按用户预期把「多字卡回复」升级为总开关；已构建提交）
* [AI-A 域]（**改动文件：src/js/chat.js（scheduleReply/continueChat：py-en 关→回复条数强制 1，改回无条件 randInt 即消失）、src/js/group-chat.js（gcGenReply 同款 gc-py-en 联动，群聊语义对齐）、src/template.html（单聊/群聊「多字卡回复」两组补总开关语义说明，覆盖 e37f893 误收的中间态文案）、build.mjs（#167 哨兵 5 条=chat.js 2+group-chat.js 1+template.html 2，替换被 e37f893 收走的旧单条文案锚点）、FIX-REGRESSION.md（#167 行改写终版）、tools/verify-multicard-master.mjs（新增无头行为断言，旧产物上 S1 会红=修复未构建属预期）**；构建状态：已构建·sw 见 version.json）。
* 排查与实证：无头复现（冻结随机数对照 6/6）证明 py-en 开关链路（UI点击→落盘→genOneReply 闸门）无缺陷，多条来自同页「回复条数最少/最多」默认 1~2 拆条、与开关互不知晓；用户「关=彻底只回一条」的预期合理，遂把语义升级为总开关，开启时行为不变（拆条/拼卡仍由两组 stepper 管）。e37f893（#168）构建时曾把本会话工作区中间态（旧说明文案+旧哨兵）裹挟入库上线，本次构建已覆盖为终版。
* 验证：node --check 过；构建哨兵 340/340 哑哨兵 0；verify-multicard-master 对新产物全过；npm run verify 10/10。
* 待真机：荣耀平板10Pro 关多字卡后一句话只回一条；开多字卡仍按「回复条数」拆条/按「最少最多条数」拼卡；群聊成员同理。

### 2026-09-05 01:5x（#170 字卡库瘦身：分组体积扫描+整组删除；src 已被 e37f893 构建带入线上，本会话重建对齐注释/版本并提交遗留 src；已构建提交）
* [AI-B 域]（**改动文件：src/js/storage-slim.js（新增，纯逻辑+IDB：mochiCcSlimScan 枚举公用/旧顶层/各联系人专属键按分组统计体积卡数降序，读走 idbGet 权威层防大库驻留预算假空；mochiCcSlimDeleteGroup 整组删除=删除前重读当前值防快照覆盖，组名匹配不到不动，写回走 xyStore 三路同拍）、src/js/personalize.js（查看存储页「字卡库瘦身」卡接线：各库合计+Top12 分组+删除确认）、src/template.html（卡片锚点）、tools/verify-storage-opt.mjs（+11 断言至 31，含删除前重读防覆盖行为断言）、build.mjs jsFiles+哨兵 2 条（已被 e37f893 收走）**；构建状态：已构建·sw 见 version.json，哨兵 336/336 哑哨兵 0 verify 10/10）。
* 编号说明：原拟 #167/#168 均与并行会话撞号（#167=多字卡文案、#168=iPhone 全屏），改 #170；TASKS #128 方向②就此收口，方向①字卡媒体令牌化仍待认领。
* 待真机：查看存储页扫描出分组列表、公用/专属合计与明细对得上；删大 GIF 组→管理页该组消失、回复池正常、cc-groups 体积下降。


### 2026-09-05 01:5x（#169 补记：用户追交 01:02 诊断（OPPO Reno6 5G、UA 伪装 Firefox 152）；源码同步提交 chat.js）
* [AI-A 域]（**改动文件：src/js/chat.js（#169 源码补入库——e37f893 构建时工作区已含本修复故产物已打包，但该提交漏了 chat.js 源文件，本条恢复源码↔产物同步）、WORKLOG.md（本条）**；构建状态：**不涉及新构建**——产物已在库，仅源码同步）。
* 诊断解读：①设备跑 v3.26.404（ts=1788433073241，比抓诊断时的远端 00:49 旧约 30h）——修复在其后的 01:42 构建（e37f893 已推送）里，顶部更新条刷新/关全部标签页重开即得；②cs-voice-send IDB="1"（「读取=缺失」为探针已知双冒号误报，#157 有登记）＝语音功能在用，01:01:54 交互轨迹还在播语音；③首字节 14.4s/加载完成 17.1s＝慢设备，坐实「开麦等待期连点二次进入」触发条件；④SyntaxError: redeclaration of let JSInterface ×5＝浏览器壳注入的桥接脚本自身重复声明（src/产物 grep 零匹配，非本项目代码；启动文件异常=无、功能入口全部就绪，不影响功能）；⑤存储 persisted=true 配额足；cc-groups 22.65MB+16.79MB 正是瘦身会话（storage-slim WIP）目标；⚠ cmtmlbx3m18s:fav-msgs LS 残留 262.6KB 属迁移残留双倍计算，待瘦身批次一并看；⑥UA=Gecko/Firefox 152（雨见改 UA）：录音格式选择按「标准安卓浏览器」走 webm/opus 优先，Firefox 152 可录可播，若真机试听无声再另报。

### 2026-09-05 01:2x（#168 iPhone（402×874，iOS 18.7/Safari 26.1）主屏幕全屏态整页下坠+底部裁切：env/diff 双重避让 + 100vh>可视高；已构建）
* [AI-B 域]（**改动文件：src/js/mobile-adapt.js（syncVvFit 顶部避让改 env() 探针实测——探针缓存+旋转失效；fs 态健康时写 --mochi-ios-h=vv 实测可视高，键盘/推定态仍摘除）、src/css/base.css（#114 规则高度 100vh→var(--mochi-ios-h,100vh)，html/body 同步；#114 padding 锚点串原样保留）、build.mjs（FIX_SENTINELS 3 条）、FIX-REGRESSION.md（#168 行）；构建状态：已构建·sw 见 version.json**）。
* 根因（两个 iOS 26.x 形态差异）：①「系统不把网页垫到状态栏下」形态（innerHeight=874−62）上，diff 差值法照量出 62px 写进 --mochi-safe-top → 与系统避让双重叠加（Mochi 行掉到 ~150px，截图实证）；②100vh=874 高于可视 812 → .phone 底部 tabbar 裁出屏外（底部空隙=-62）。
* 验证：node --check 过；CDP 探针实测新级联（safe-top 摘除/12px/无叠加；--mochi-ios-h 消费+动态更新+回落全过）；--check-sentinels 336 全绿哑哨兵 0（#114 原 padding 锚点保留）。
* 待真机（同机型主屏幕+全屏）：①Mochi 行紧贴系统状态栏下方；②tabbar 完整不被裁；③输入栏贴底；④iPhone 15（inner==screen 形态）回归不变形。编号说明：#148/#149 已被并行会话占用，本条改 #168。

### 2026-09-05 01:5x（#169 状态更新：已随 e37f893（01:42 构建，已推送）打进产物；本会话补提交 chat.js 源码恢复同步；用户追交 01:02 诊断已解读，见顶部条目）
* 上条「未构建·随 #167 一并收口」已被 #168 iOS 会话的 e37f893 收口（构建时工作区已含本修复，产物 grep `voiceTimer !== voiceTid`/`voiceStarting` 在位）；但该提交漏了 src/js/chat.js 源文件（产物含修复、源码未入库＝反向不同步，新克隆重建会哨兵失败），本会话以单独提交补齐源码，不涉及新构建。

### 2026-09-05 0x:xx（用户报障 #169：OPPO Reno6 5G+雨见浏览器发语音「有时候一直提示已达最长60秒」无法使用；修复已随 e37f893 构建推送）
* [AI-A 域]（**改动文件：src/js/chat.js（录音三处：①startVoiceRec 拆防重入包装+startVoiceRecInner，voiceStarting 闸门 try/finally 复位；②计时器自证——闭包捕获自身 voiceTid，`voiceTimer!==voiceTid` 孤儿自毁、`!voiceRec||state!=='recording'` 不判 60s；③入场先清残留 voiceTimer）、build.mjs（FIX_SENTINELS +1，#169）、FIX-REGRESSION.md（#169 行，本条即改动说明）**；构建状态：**已随 e37f893 构建推送（01:42 构建），chat.js 源码由后继提交补同步入库**）。
* 根因：startVoiceRec 在 await getUserMedia 期间（雨见等慢壳开麦数秒、按钮文案未变）重复点击二次进入，覆盖 voiceRec/voiceStartTs 且 voiceTimer 被换成新 id——旧计时器成孤儿，每 250ms 查 `Date.now()-voiceStartTs>=60000` 而 voiceStartTs 停后从不清零，录音停 60 秒后每 250ms 误报「已达最长 60 秒」永不自停（面板关了仍弹）+ 第一路麦克风流泄漏；泄漏致后续开麦更慢更易连点，恶性循环。
* 验证：node --check 过；`node build.mjs --check-sentinels` 全绿（哑哨兵 0，见下条补数）；编号说明：原拟 #168 与并行瘦身会话撞号（其 storage-slim.js 哨兵已登记），改 #169。
* 临时自救（已答复用户）：出现连环提示时刷新页面立即止住（孤儿计时器随页面销毁）。

### 2026-09-05 01:2x（#167 用户报障：荣耀平板10Pro+Edge 回复设置关了「多字卡回复」，联系人一句话仍回多条；查明=设置语义非缺陷，补设置页边界说明；源已完成·未构建）
* [AI-A 域]（**改动文件：src/template.html（回复设置「多字卡回复」分组尾补 gs-sub：py-en 只管拼同一条、拆几条发送=「回复条数」默认1~2，想只回一条把回复条数最多设1）、build.mjs（#167 哨兵 1 条 template.html needle）、FIX-REGRESSION.md（#167 行）**；构建状态：**未构建**——构建时 git status 发现并行会话进行中改动（#148 mobile-adapt.js / #129 verify-wallet-edit / 未跟踪 storage-slim.js）已被打包进产物，按「不夹带半成品」回滚产物到 HEAD，源改动留工作区待下次构建收口）。
* 根因：非逻辑缺陷。genOneReply 的 py-en 闸门（v3.6.x 起在，报障设备旧包 f20003c 已含）关闭即生效；用户看到的多条来自 scheduleReply/continueChat 的 count=randInt(reply-min,reply-max)（默认1~2拆条），两独立设置边界混淆；撤回补发/TA心情/主动发送按设计不计入（页内已有 sub 注明）。已直接答复用户操作路径。
* 验证：--check-sentinels 330/330 哑哨兵 0（构建前后各一次）。
* 待对方处理（下一构建者）：①收口构建自动带上本条 template/build.mjs/FIX-REGRESSION 改动，请一并提交；②工作区 #148/#129/storage-slim.js 均非本条改动，勿误删；③本会话曾误构建一次（含 #148 半改动），产物已 `git checkout -- ` 回滚，sw 缓存名未外泄（未提交未推送）。

### 2026-09-05（TASKS #129 verify 套件基线清理开工：AI-B 认领，全量对账非点状修复；不涉及构建）
* [AI-B 域]（**认领 TASKS #129**：干净环境复跑 verify:all=131 通过/69 脚本断言失败/2 超时，与历史基线 130/69/2 同域——近期 #157~#166 无新增回归。分工说明：AI-A #164/#165 已点状修复 interact-frequency/invite-settings（登记①已关），本任务做的是**全量 69 脚本对账**（过期断言改期望/真缺陷登记/超时修等待），二者不重叠；#164/#165 修的两个脚本我不会再碰。已预判：钱包簇 wallet-edit/gift-wallet-split/rp-wallet-edit=断言 v3.15.x 申请制前老交互（过期）；quote-image 套件内崩=并发抢端口假阳性（单跑 20/20）；verify-triage=事后分析器误入套件待剔除。
* **#162 认账**：2026-09-04 深夜本任务诊断阶段曾出现两套套件并发互踩（TaskStop 只杀外壳不杀子进程树→孤儿套件+无头 Chrome 残留涨盘，即 #162 根因），已由并行会话清理；本任务后续跑批改为「单驱动器串行跑、批末清理 remote-debugging-port Chrome、不中途 SIGKILL 套件」防复发。

### 2026-09-05（#166 存储优化包：媒体池孤儿 GC + 写日志标记合并 + 查看存储页扩展；已构建提交）
* [AI-B 域]（**改动文件：src/js/idb.js（wrjMark 150ms 微批 idbSetAll 单事务+失败退回逐键+pagehide/hidden 冲刷+wrjUnmark 撤销未落库标记）、src/js/media-pool.js（mochiMediaGC mark-and-sweep：mark=全部 \*:chat-msgs/\*:fav-msgs 令牌∪map/writeBuf/inflight，引用键逐键串行读，清单/引用读不到整次放弃绝不盲删；mochiMediaGCApply）、src/js/personalize.js（查看存储页「媒体池」卡=占用+孤儿扫描清理，「持久存储」卡=storage.persist；catOf 媒体池单独成类）、src/template.html（两卡锚点）、build.mjs（#166 哨兵 3 条）、FIX-REGRESSION.md（#166 行）、tools/verify-storage-opt.mjs（新增，纯 Node 桩 20/20 零浏览器依赖）**）。
* 编号说明：原拟 #164 与并行会话撞号（其 #164/#165=verify 脚本清理），改 #166。
* 验证：node --check 过；verify-storage-opt 20/20；构建哨兵全绿哑哨兵 0。遗留专项已登记 TASKS #127（聊天记录分片）/ #128（字卡库瘦身）。
* 待真机：查看存储页媒体池占用显示；删含图消息→扫描报孤儿→确认删除→池瘦身且被引用图完好；持久存储行可读/可申请。

### 2026-09-05（#164/#165 清理 verify:all 两个存量红——均为脚本侧问题，产品代码无改动·不涉及构建）
* [AI-A 域]（**改动文件：tools/verify-interact-frequency.mjs（#164）、tools/verify-invite-settings.mjs（#165）**；无 src/产物改动，不涉及构建）。关掉 2026-09-05 待办登记①。
* #164 verify-interact-frequency（修前 6 跑 2 红抖动 + 1 处断言过时；修后 13/13 ×3 连跑）：①S1/S2「flag 已打但 prob 未吸附」抖动＝页面初始化偶发先把带 `probLowV313=true` 的默认 settings 落盘，脚本种子 `Object.assign` 合并保留旧标记→迁移函数见标记即跳过；修法＝种前先清四库（等效「无标记存量老设备」，语义不变）。②S7 静态断言 `gateCalls===4` 过时＝同频 cc 互动卡（maybeTriggerTACC）加入后闸门接入点实为 5，断言改 5。
* #165 verify-invite-settings（标题断言确定性红 + 弹窗交互抖动；修后 28/28 ×5 连跑）：①「面板有主动邀请标题」原断言要求 `.gs-title` 恰好 1 个——「其他」面板后来新增跨桌面查岗/打电话分组（#150/#159 同期），改「存在主动邀请标题」；②「点同意→确定→半框打开」固定 400ms 单次点击偶发赶不上异步弹窗，改轮询重试（断言口径不变）。
* 备注：两脚本失败在 f20003c（#162 之前）即复现，与 #162 无关；gitignore `tools/*.log` 已按 52e3782→a0ed3a0 捋直重放。另一并行会话正在改 build.mjs/idb.js/media-pool.js/personalize.js/template.html（进行中），本条未触碰。


> 【占用声明 2026-09-05】#181（用户报障 EC-PAD01 SE+Edge 聊天气泡 CSS 上传后无任何变化，多机型反复；号段修正：原占 #179 与在途尾巴日志撞号，让出）占用 src/js/chat.js 尾部（新增 window.mochiMapBubbleCss 共享映射导出）+ src/js/chat-settings.js applyCss 区 + src/js/group-chat.js applyGcCss 区 + build.mjs 哨兵尾部 + FIX-REGRESSION.md 新行 + tools/verify-bubble-css-map.mjs 新增；跨域说明：三文件均 AI-A 域，本次由 AI-B 会话按用户报障直接修复。**本次构建者：AI-B 本会话（#181 收口构建）**——应 #180 在途会话留言，随库一并打入其聊天尾巴日志改动（build.mjs 3 条 #180 哨兵 + verify-chat-tail.mjs 21 断言一并核过）。勿回滚彼此部分。

### 2026-09-05 12:3x（#181 气泡 CSS 上传零变化修复 + #180 尾巴日志随库收口；已构建）
* [AI-B 域·跨域说明见占用声明]（**改动文件：src/js/chat.js（新增 window.mochiMapBubbleCss 共享映射：别名扩充 bubble-left/right、msg/message/chat-left/right、you/sent/received 等 + 剥注释/跳 keyframes + 未认出模板类名时全部声明块整包兜底套双方气泡 !important 并提示）、src/js/chat-settings.js（applyCss 改走共享映射，兜底提示透传 toast）、src/js/group-chat.js（applyGcCss 同改，#page-group-chat 作用域）、build.mjs（哨兵 +3，随库含 #180 会话 3 条）、FIX-REGRESSION.md（181 行；#180 行为并行会话所加）、tools/verify-bubble-css-map.mjs（新增 23 断言）；构建状态：已构建·sw mochi-mtnvvget**）。
* 根因：上传的网页模板气泡 CSS 类名不在旧映射表（.bubble-left/.you/.sent 等）→ 替换后零规则命中 → 「已设置但气泡零变化」。与机型无关、只与内容有关，故多机型「反复出现」；EC-PAD01 SE 诊断（判桌面/视口 941×1449）与本 bug 无因果。
* 验证：verify-bubble-css-map 23/23；端到端 verify-bubble-css 8/8（UI 存取/刷新恢复/IDB-only 兜底）；verify-chat-tail 21/21（#180 并行会话脚本，收口核过）；npm run verify 10/10；哨兵 359/359、哑哨兵 0；node --check 过。
* 待真机（EC-PAD01 SE 及任意机型）：更新后重进 → 粘贴此前那份气泡 CSS → 应用 → 气泡必有变化；若模板类名全新会提示「未认出气泡类名，已整体套用」。

### 2026-09-05 23:5x（#209 屏幕适配判定器同源化 + ✗异常自动抓拍；进行中）
- 【占用声明】本会话占用：src/js/device.js（新增共享判定器 window.mochiViewportForm + screenDiagJudge 接入 + fit-watch 自动抓拍）、src/js/mobile-adapt.js（syncVvFit 接入共享判定器）、build.mjs（哨兵改锚点+新增，追加式不碰 #206 三条）、tools/verify-viewport-form.mjs（新增）、tools/verify-ios-reserved-standalone.mjs（锚点随重构同步）。**本次构建者：AI-B=本会话**。
- 并行说明：工作区现有 #206 未提交改动（chat.js 尾巴日志拒收媒体+build.mjs 哨兵×3+verify-chat-tail），三件套完整自洽，本会话构建时按 #181 随库收口 #180 先例一并打入并注明；#206 会话请勿再动上述占用文件。
- 内容：①判定器同源化（syncVvFit 与 screenDiagJudge 共用 window.mochiViewportForm，新形态只改一处）；②屏幕适配 ✗ 自动抓拍（环形存 xy-home-v2:__diag-fit-errs，报障带事发现场）；③顺修 #186 判定器两处缺陷（force 未传入真实采集路径=死分支；force 期望底边 innerH 与注释「屏高」矛盾→screenH，连带修 forced 设备 sbTop expect=12 顶部双倍误报）。
