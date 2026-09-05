// ===== Mochi Service Worker：离线缓存 + 网络优先 =====
// v3.5.54：CACHE 名由 build.mjs 每次构建自动更新（mochi-<时间戳>），
// 新版本部署后旧缓存自动失效 → 强制更新到最新版
// v3.6.x：网络优先 + 超时兜底。GitHub Pages 在国内网络经常慢/卡，原实现
// fetch/addAll 均无超时——SW 卡在 installing 时 Chrome 安卓「安装到桌面」
// 会一直显示「正在安装」永不完成（WebAPK 安装要经 SW 拉 start_url/图标）。
// 现在每个请求最多等 NETWORK_TIMEOUT 毫秒，超时立即回退缓存（没缓存则快速
// 失败），SW 最迟约 10 秒内必然激活，安装/加载都不再无限挂起。
const CACHE = 'mochi-mtooyfox';
const BUILD_INFO = '部署于 2026-09-06 02:03';
const PRECACHE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png'];
// v3.10.x：网络优先超时从 8000 → 3500ms。GitHub Pages 国内访问经常 >8s，
// 原 8s 超时导致手机端 fetch 频繁超时 → 回退 SW 缓存旧 index.html → 用户永远
// 看不到新版。缩短到 3.5s：慢网络下页面秒开（回退缓存），配合页面版本检测 +
// PRECACHE_NOW 预取机制，用户点「刷新使用新版」时能真正拿到最新版。
const NETWORK_TIMEOUT = 3500; // 网络请求等待上限（毫秒）
// v3.26.x #157：index.html 专属超时（30s）。产物 index.html 已 4MB+，国内访问 GitHub
// Pages 3.5s 内根本传不完 → 安卓 Chrome 桌面快捷方式（standalone）每次启动都走导航
// 网络优先 → 必然超时回退缓存；预缓存/补拉/PRECACHE_NOW 全部 3.5s 失败 → 新缓存常年
// 缺 index、更新永远刷不上，表现为「快捷方式要刷新很多次才能打开甚至打不开」（小米
// 15Pro+Chrome 等多机型反馈，浏览器标签页因有 HTTP 缓存不明显）。index 下载单独给
// 长超时，小资源仍走 3.5s 快速回退。
const INDEX_NETWORK_TIMEOUT = 30000;

// 带超时的 fetch：超时按失败处理，走回退逻辑
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('net-timeout')), ms);
    fetch(req).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// v3.28.x：缓存版本号。CACHE 名固定为 mochi-<构建时间戳 base36>（build.mjs 每次
// 构建替换），时间戳单调递增 → base36 数值越大 = 越新的构建。跨旧版回退选缓存时
// 按此排序取最新，杜绝「慢网络回退到任意旧缓存 → 退回旧版布局/白屏」。
function cacheVersion(name) {
  const m = /^mochi-([a-z0-9]+)$/.exec(String(name || ''));
  if (m) {
    const v = parseInt(m[1], 36);
    if (!isNaN(v)) return v;
  }
  return 0;
}

// v3.26.x #134：index.html 完整性校验——iPhone X (iOS 16.7 Safari 主屏幕) 等机型
// 反复出现「桌面图标/小组件缺失 + 决策等功能没了 + html 类为空」（#87 旧版图标缺失同族）。
// 根因：产物 index.html 约 3.6MB、尾部是第 6/7 号脚本块（决策/全屏/移动适配/pwa 更新器），
// 弱网/切换网络时响应被中途截断，fetch 仍返回 ok → 截断体被当成功写进缓存/放行给页面；
// 尾部脚本块整体丢失且 HTML 解析不报错（启动文件异常=无），页面失去自愈能力
// （pwa.js 更新器也在尾部块里）。此后每次导航回退都命中这份残缺缓存 → 反复发作。
// 防线：任何 index.html 进缓存前必须通过 isCompleteHtml 校验（含 EOF 标记，由
// build.mjs 写在产物最尾部 + template.html 末尾锚点元素双保险），截断体一律丢弃。
// 注意：模板注释/说明里也会出现 __MOCHI_EOF__ 字样，但它们在 <style>/<body> 前部，
// 末尾截断必然同时丢掉「文档最末字节处的带版本号兜底标记」，故校验用带 buildStamp
// 的完整形式 `<!-- __MOCHI_EOF__ <stamp> -->`，与正文里的说明文字不混淆。
const HTML_EOF_MARKER = '__MOCHI_EOF__';
const HTML_EOF_STAMPED = /<!-- __MOCHI_EOF__ [a-z0-9]+ -->/;
// 只对导航文档做校验（./ / ./index.html / 任何以 index.html 结尾的请求）
function isIndexUrl(url) {
  const p = String(url);
  return p.endsWith('/index.html') || p.endsWith('./') || /\/$/.test(p);
}
function isCompleteHtml(text) {
  return typeof text === 'string' && HTML_EOF_STAMPED.test(text.slice(-300));
}

self.addEventListener('install', (e) => {
  // 跳过等待：新 sw 安装后立即接管（配合每次构建新缓存名 → 强制更新）
  self.skipWaiting();
  // 预缓存逐文件超时 + 单文件失败不影响整体：网络再差也保证 SW 能激活，
  // 不阻塞浏览器安装流程
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(PRECACHE.map((url) =>
        // v3.26.x #157：index.html 用长超时（4MB 在慢网络 3.5s 必然失败 → 新缓存常年缺 index）
        fetchWithTimeout(url, isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT).then((res) => {
          if (res && res.ok) {
            // v3.26.x #134：index.html 完整性校验——截断体不进缓存（下同）
            if (isIndexUrl(url)) {
              return res.clone().text().then((t) => {
                if (!isCompleteHtml(t)) return undefined;
                return c.put(url, res);
              });
            }
            return c.put(url, res);
          }
        })
      ))
    ).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  // v3.7.x：删旧缓存前先确认当前 CACHE 已缓存 index.html。precache 在慢网络下可能
  // 全部 8s 超时失败（PRECACHE 逐文件 allSettled）→ 新 CACHE 为空，此时若照旧删光
  // 旧缓存，导航回退 caches.match('./index.html') 拿不到 → Response.error() → 白屏。
  // iOS PWA 切回前台弱网时极易触发（Edge/Safari 切回瞬间网络未就绪 + SW 更新竞态）。
  // 当前 CACHE 无 index.html 时，保留一个含 index.html 的旧缓存兜底，等下次更新再清；
  // 旧缓存都没有 index.html 才全删（留着也无用）。
  e.waitUntil(
    caches.keys().then((keys) => {
      const oldKeys = keys.filter((k) => k !== CACHE);
      // v3.26.x #136：删旧缓存前先「抢救」一份最新的完整 index.html——弱网/被墙下
      // install 预缓存可能全超时、activate 网络补拉也可能超时，新缓存缺 index 时离线
      // 导航兜底落空 → Chrome 错误页。从旧缓存按版本新→旧找第一份带 EOF 标记的完整
      // index 先救出来，激活后缺 index 时用它顶上（旧但完整 >> 错误页），网络可用再
      // 刷新到最新。截断/无 EOF 标记的旧体一律不救（宁缺勿残，同 #134 铁律）。
      const rescue = (function () {
        if (!oldKeys.length) return Promise.resolve(null);
        const sorted = oldKeys.slice().sort((a, b) => cacheVersion(b) - cacheVersion(a));
        return sorted.reduce((p, k) => p.then((found) => found || caches.match('./index.html', { cacheName: k }).then((m) => {
          if (!m || !m.ok) return null;
          return m.clone().text().then((t) => (isCompleteHtml(t) ? m : null));
        })), Promise.resolve(null)).catch(() => null);
      })();
      const cleanup = !oldKeys.length ? Promise.resolve()
        : caches.open(CACHE).then((c) => c.match('./index.html')).then((hit) => {
            if (hit) return Promise.all(oldKeys.map((k) => caches.delete(k)));
            return Promise.all(oldKeys.map((k) =>
              caches.open(k).then((c) => c.match('./index.html')).then((m) => m ? k : null)
            )).then((hits) => {
              // v3.28.x：命中多个旧缓存时保留「最新」一个做兜底（hits.find(Boolean)
              // 按 caches.keys() 顺序取第一个，通常是老缓存 → 用户下次导航回退会退回旧版）。
              // 按 base36 版本降序排，取最新的旧缓存；其余照删。
              const keep = hits.filter(Boolean).sort((a, b) => cacheVersion(b) - cacheVersion(a))[0];
              if (keep) return Promise.all(oldKeys.filter((k) => k !== keep).map((k) => caches.delete(k)));
              return Promise.all(oldKeys.map((k) => caches.delete(k)));
            });
          });
      return cleanup
        .then(() => self.clients.claim())
        .then(() => rescue)
        .then((rescued) => {
          // v3.27.x：precache 失败时当前 CACHE 可能没 index.html，导航回退会命中旧缓存旧版
          // → 用户"退回旧版白屏"（iOS PWA 切后台回前台 WebKit 重新加载 + 网络超时回退）。
          // claim 后异步补一次 fetch 写入当前 CACHE（不阻塞，失败有旧缓存兜底），
          // 下次导航回退优先命中当前 CACHE（新版），不再退回旧版。
          return caches.open(CACHE).then((c) => c.match('./index.html')).then((hit) => {
            if (hit) {
              // v3.26.x #134：历史截断缓存自愈——存量缓存里的 index.html 可能是
              // 修复上线前已写进去的残缺体（无 EOF 标记），丢弃让它重新走网络补齐
              return hit.clone().text().then((t) => {
                if (isCompleteHtml(t)) return;
                // v3.26.x #136：残缺体删除后先用抢救的完整旧版顶上（离线不留空窗）
                return c.delete('./index.html').catch(() => {}).then(() => {
                  return rescued ? c.put('./index.html', rescued).catch(() => {}) : undefined;
                });
              }).catch(() => {});
            }
            // v3.26.x #136：无 index 时先放抢救的完整旧版兜底（网络补拉失败也有得用）
            const seed = rescued ? c.put('./index.html', rescued).catch(() => {}) : Promise.resolve();
            return seed.then(() => fetchWithTimeout('./index.html', INDEX_NETWORK_TIMEOUT).then((res) => {
              if (res && res.ok) {
                // v3.26.x #134：补写前同样校验完整性，截断体不进缓存
                return res.clone().text().then((t) => {
                  if (!isCompleteHtml(t)) return undefined;
                  return c.put('./index.html', res);
                });
              }
            }).catch(() => {}));
          });
        });
    })
  );
});

self.addEventListener('message', (e) => {
  const data = e.data || {};
  // v3.26.x #134：页面启动自检发现「脚本块丢失/文档截断」时发 PURGE_INDEX——
  // 删掉当前缓存里的 index.html（残缺体），下次导航必然回源拿完整文档。
  // 回执 PURGE_DONE 让页面知道可以安全重载（避免重载后仍命中同一份残缺缓存）。
  if (data.type === 'PURGE_INDEX') {
    caches.keys().then((keys) => Promise.all(keys.map((k) =>
      caches.open(k).then((c) => c.delete('./index.html').catch(() => {}))
    ))).catch(() => {}).then(() => {
      try { if (e.source && e.source.postMessage) e.source.postMessage({ type: 'PURGE_DONE' }); } catch (x) {}
    });
    return;
  }
  // v3.10.x：页面点击「刷新使用新版」时先发 PRECACHE_NOW，让 SW 立即把最新
  // index.html 写进当前缓存，确认完成后再 reload——否则弱网下 reload 的导航请求
  // 仍可能超时回退旧缓存，用户永远卡在旧版（GitHub Pages 国内访问慢的根因场景）。
  if (data.type !== 'PRECACHE_NOW') return;
  const urls = Array.isArray(data.urls) ? data.urls : ['./index.html'];
  caches.open(CACHE).then((c) =>
    Promise.allSettled(urls.map((u) =>
      // v3.26.x #157：index.html 用长超时——PRECACHE_NOW 是「刷新使用新版」的落盘通道，
      // 3.5s 对 4MB 产物必然失败 → 用户点刷新永远拿不到新版、反复刷新
      fetchWithTimeout(u, isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT).then((res) => {
        if (res && res.ok) {
          // v3.26.x #134：PRECACHE_NOW 是「刷新使用新版」的落盘通道，同样校验，
          // 否则弱网下用户点刷新反而把截断的新版固化进缓存（永远卡残缺版）
          if (isIndexUrl(u)) {
            return res.clone().text().then((t) => {
              if (!isCompleteHtml(t)) return false;
              c.put(u, res); return true;
            });
          }
          c.put(u, res); return true;
        }
        return false;
      })
    ))
  ).then(() => {
    // 无论成功与否都回执，页面有超时兜底；网络再差也要让刷新流程能继续
    try { if (e.source && e.source.postMessage) e.source.postMessage({ type: 'PRECACHE_DONE' }); } catch (x) {}
  }).catch(() => {
    try { if (e.source && e.source.postMessage) e.source.postMessage({ type: 'PRECACHE_DONE' }); } catch (x) {}
  });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 跨域请求不接管，交给浏览器原生网络（不缓存、不拦截）
  if (new URL(req.url).origin !== self.location.origin) return;
  // v3.7.x：版本/公告文件一律不拦截、不缓存——SW 网络优先的超时兜底会让慢网络下
  // version.json（带 ?v= 唯一参数、缓存永不命中）8s 超时后 Response.error()，
  // 页面版本检测静默失败 → 用户永远收不到「有新版本」提示、一直停在旧缓存。
  // 这类小文件放行给浏览器原生网络（有浏览器 HTTP 缓存，请求极小、即时返回），
  // 版本检测才真正可靠。notice.json（开屏公告）同理。
  const u = new URL(req.url);
  if (u.pathname.endsWith('/version.json') || u.pathname.endsWith('/notice.json')) return;
  // v3.26.x #157：导航请求改「缓存优先 + 后台静默刷新」——standalone 桌面快捷方式每次
  // 启动都是一条导航请求，原「网络优先 3.5s」对 4MB 产物在国内网络必然超时回退缓存：
  // 每次打开先白等 3.5s、预缓存/更新通道全失败 → 「要刷新很多次才能打开甚至打不开」。
  // 有完整 HTML 缓存时立即返回（秒开，弱网增益最大），同时后台用 index 长超时拉最新
  // 完整体写缓存（静默保持新鲜，配合页面版本条「刷新使用新版」）；无缓存（首装/被清/
  // 污染）才落到下方原网络优先兜底链。
  const navCached = req.mode === 'navigate'
    ? caches.open(CACHE).then((c) => c.match('./index.html')).then((m) => m || caches.match(req)).then((m) => {
        // #143 同款 content-type 守卫：历史 PNG 污染条目当未命中，落回网络兜底链
        if (m && !/text\/html/i.test(String((m.headers && m.headers.get('content-type')) || 'text/html'))) m = null;
        if (!m) return null;
        e.waitUntil(
          fetchWithTimeout(req, INDEX_NETWORK_TIMEOUT).then((res) => {
            if (res && res.ok) {
              // 后台刷新体同样必须过 #134 完整性校验才落 canonical 键（第 6 写点）
              return res.clone().text().then((t) => {
                if (!isCompleteHtml(t)) return undefined;
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put('./index.html', copy));
                return res;
              }).catch(() => {});
            }
            return undefined;
          }).catch(() => {})
        );
        return m;
      }).catch(() => null)
    : Promise.resolve(null);
  // 网络优先：在线时始终用最新，超时/失败才回退缓存（导航缓存未命中时才走到这里）
  e.respondWith(
    navCached.then((hit) => hit || fetchWithTimeout(req, NETWORK_TIMEOUT)
      .then((res) => {
        if (res && res.ok) {
          // v3.26.x #134：导航文档写缓存前校验完整性——网络中途截断的响应（弱网/
          // 切网时连接被掐，fetch 仍 ok）绝不允许进缓存；残缺体放行给页面会丢尾部
          // 脚本块（决策/全屏/移动适配/pwa 更新器全灭）且不报错。截断时改走缓存
          // 兜底（下方 catch 分支），缓存也没有就透传截断响应（至少本次能渲染，
          // 但不会污染缓存，下次导航自动重试完整下载）。
          if (req.mode === 'navigate') {
            return res.clone().text().then((t) => {
              if (isCompleteHtml(t)) {
                // v3.26.x #136：导航成功统一写 canonical './index.html' 键——原写 req.url 键
                // （如 .../mochi/），而离线兜底只 match('./index.html')（= .../mochi/index.html），
                // 键不一致时缓存里明明有完整 index 也兜不住 → 网络不可达（GitHub Pages 被
                // 墙/超时，vivo+Chrome #136 现场实测 version.json 拉取失败）时导航兜底落空，
                // Chrome 错误页顶头就是站点 mochi 字母图标，用户看到「单独 mochi 字母图、进不去」。
                caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
                return res;
              }
              throw new Error('truncated-html');
            });
          }
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => {
        // 仅导航请求回退到 index.html；其他资源（manifest/图标/JS 等）
        // 只回退自身缓存，绝不用 HTML 顶替——否则安装/更新流程会拿到错误内容
        const fallback = req.mode === 'navigate'
          // v3.26.x #136：canonical 键 miss 后补一枪 caches.match(req)——旧版 SW 把导航
          // 成功体写进 req.url 键（存量设备缓存里只有这个键），second chance 接住它们，
          // 否则老缓存有完整 index 也照样回源 → 离线错误页
          ? caches.open(CACHE).then((c) => c.match('./index.html')).then((m) => m || caches.match(req)).then((m) => m || caches.keys().then((keys) => {
              // v3.7.x：主缓存无 index.html（precache 失败 / activate 保留了旧缓存兜底），
              // 遍历所有缓存找第一个命中的 index.html。原 for 循环首次即 return 只查
              // keys[0]，漏掉其余缓存——改为 reduce 顺序探测，命中即返回，保证导航永不白屏。
              // v3.28.x：reduce 按 caches.keys() 原顺序探测，命中第一个旧缓存（常为最老缓存）
              // → 慢网络下用户被回退到旧版布局（图标缺失/白屏）。现先按 base36 版本降序
              // 排序再探测，优先命中「最新」的旧缓存，尽可能停留在新版。
              return keys.slice().sort((a, b) => cacheVersion(b) - cacheVersion(a)).reduce((p, k) =>
                p.then((found) => found || caches.match('./index.html', { cacheName: k }))
              , Promise.resolve(null));
            }))
          : caches.match(req);
        return fallback.then((m) => {
          // v3.27.x：缓存也没有时不再直接 Response.error()（白屏）——
          // iOS 15 反馈「开屏一直自己刷新然后白屏，完全打不开」：GitHub Pages 国内
          // 慢网络（实测 ~30KB/s）下网络优先 3.5s 必然超时，若预缓存又失败/旧缓存被清，
          // 导航回退命中空缓存 → Response.error() → 白屏，用户刷新后同样超时 → 看似
          // 「一直自己刷新」。兜底改为再发一次不带超时的网络请求（SW 内部 fetch 不会
          // 再次触发本 SW 拦截，无死循环风险）：慢就慢，等 GitHub Pages 慢慢传完，成功
          // 后照常写入缓存，后续刷新走缓存秒开；只有网络真正不可达才由浏览器报错页。
          // FIX 2026-09-03 #143：导航命中先验 content-type——历史版本曾把任何成功体（含
          // icon-512.png 图标）一律写进 canonical './index.html' 键（见下方重试写点），
          // PNG 占位后离线导航第一级 match 就命中图片 = 浏览器把 PNG 当文档渲染，整页
          // 只有一张 mochi 字母图（一加Ace2+Edge 实测，#136 vivo 家族复发）；且图片文档
          // 不跑任何 JS，#134 完整性自检在图片页上无法触发，用户卡死到网络恢复为止。
          // 非 HTML 缓存一律当未命中处理，放行去后面的旧缓存扫描/网络重试（仅导航做此
          // 校验，图标等资源的自身缓存回退不受影响）。
          if (req.mode === 'navigate' && m &&
              !/text\/html/i.test(String((m.headers && m.headers.get('content-type')) || 'text/html'))) m = null;
          if (m) return m;
          return fetch(req).then((res) => {
            if (res && res.ok && req.mode === 'navigate') {
              // FIX 2026-09-03 #143：此重试同时接住非导航请求（慢网络下的图标等）。
              // 原实现把任何成功体一律写 canonical './index.html' 键且不过完整性校验，
              // 双漏洞：① icon-512.png 写进 index 键 = 上述「整页 mochi 字母图」根因；
              // ② 截断 HTML 绕过 #134 铁律（该路径是四处写缓存点之外漏挂校验的第 5 处）。
              // 现仅导航请求才写 canonical 键，且必须过 isCompleteHtml；非导航资源只
              // 透传不落盘（图标缓存由主成功路径按自身键写入，绝不污染 index 键）。
              return res.clone().text().then((t) => {
                if (!isCompleteHtml(t)) return res;
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put('./index.html', copy));
                return res;
              }).catch(() => res);
            }
            return res;
          });
        });
      })
    )
  );
});

// v3.5.114：移除「页面通知 → 清缓存 + 强制 reload」机制。
// 旧逻辑会让用户刚进入桌面就被打断刷新回开屏（每次构建 sw.js 内容都变，更新频繁时必现）。
// 现在新 sw 安装即 skipWaiting 接管，activate 自动清理旧缓存，当前页面继续可用，
// 用户下次刷新自然加载最新版；旧页面发来的 UPDATE_READY 消息在此一律忽略。

// ===== v3.15.x：离线消息提醒（Periodic Background Sync，零后端） =====
// 页面端（bg-keep.js psync 段）把可发文案快照写入 IDB 根键 xy-home-v2:psync-snap，
// 并注册 periodicsync。页面全关后浏览器按自身策略定期唤醒本 SW：读快照 → 随机抽
// 一条 → 弹系统通知，同时把该条追加进 xy-home-v2:psync-queue；用户回开应用后由
// 页面端 drainPsyncQueue 安全补投递进聊天（走 chatAddIn 内存链路，绝不直写 chat-msgs）。
// 如实边界（设置页状态行同步展示）：仅 Chromium 系支持且需 PWA 添加到桌面；调度
// 频率由浏览器决定（通常数小时~一天一次，非精确闹钟）；浏览器进程被系统杀死后
// 无法唤醒——那需要真推送服务端，本项目纯本地架构暂不引入。

const PSYNC_SNAP_KEY = 'xy-home-v2:psync-snap';
const PSYNC_QUEUE_KEY = 'xy-home-v2:psync-queue';
const PSYNC_TAG = 'mochi-ta-msg';
const PSYNC_SNAP_TTL = 7 * 24 * 60 * 60 * 1000; // 快照 7 天未刷新（长期没开应用）不再打扰

function psyncOpenDb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open('mochi-db', 1);
    req.onupgradeneeded = function () { try { req.result.createObjectStore('kv'); } catch (e) {} };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('psync idb open fail')); };
  });
}
function psyncIdbGet(key) {
  return psyncOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('kv', 'readonly');
      var rq = tx.objectStore('kv').get(key);
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  });
}
function psyncIdbSet(key, val) {
  return psyncOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

self.addEventListener('periodicsync', function (e) {
  if (e.tag !== PSYNC_TAG) return;
  e.waitUntil((async function () {
    const snap = await psyncIdbGet(PSYNC_SNAP_KEY);
    if (!snap || !Array.isArray(snap.texts) || !snap.texts.length) return;
    if (!snap.ts || Date.now() - snap.ts > PSYNC_SNAP_TTL) return;
    const pick = snap.texts[Math.floor(Math.random() * snap.texts.length)];
    const text = pick && pick.t ? String(pick.t) : '';
    if (!text) return;
    let arr = [];
    try { const q = await psyncIdbGet(PSYNC_QUEUE_KEY); if (Array.isArray(q)) arr = q; } catch (e2) {}
    arr.push({ t: text, cid: snap.cid || 'default', ts: Date.now(), k: pick.k || '' });
    while (arr.length > 20) arr.shift();
    await psyncIdbSet(PSYNC_QUEUE_KEY, arr);
    await self.registration.showNotification(snap.name || 'TA', {
      body: text,
      tag: PSYNC_TAG,
      renotify: true,
      icon: './icon-192.png',
      badge: './icon-192.png'
    });
  })().catch(function () {}));
});

// v3.26.x：notificationclick 此前只处理 PSYNC_TAG（离线消息提醒）一条，后台弹窗
// （bgNotifyCheck → showSysNotification → reg.showNotification）发的通知不带 tag，
// 点击直接 return → 既不 focus 也不 openWindow，用户反馈「点后台弹窗没反应」。
// 现统一处理所有通知点击：聚焦已有窗口 / 开新窗口，并 postMessage 通知页面端跳聊天页。
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const tag = (e.notification && e.notification.tag) || '';
  e.waitUntil((async function () {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (cs && cs.length) {
      const c = cs[0];
      try { await c.focus(); } catch (x) {}
      try { c.postMessage({ type: 'MOCHI_NOTIFY_CLICK', tag: tag }); } catch (x) {}
      return;
    }
    try {
      const w = await self.clients.openWindow('./');
      if (w && w.postMessage) {
        // 新开窗口页面脚本可能尚未注册 message 监听，重试几次
        for (let i = 0; i < 3; i++) {
          await new Promise(function (r) { setTimeout(r, 800); });
          try { w.postMessage({ type: 'MOCHI_NOTIFY_CLICK', tag: tag }); } catch (x) { break; }
        }
      }
    } catch (x) {}
  })());
});
