(function () { try {
(function () {
const store = window.activeStore();
const KEY = 'ta-invite';
const DEFAULT_QUESTIONS = [
{ id: 'iv_r1', cat: 'rps', kind: 'rps', text: '想和你猜拳，来一局？', enabled: true },
{ id: 'iv_r2', cat: 'rps', kind: 'rps', text: '来猜拳呀，输的人答应一件事！', enabled: true },
{ id: 'iv_r3', cat: 'rps', kind: 'rps', text: '手痒了，陪我猜拳好不好？', enabled: true },
{ id: 'iv_r4', cat: 'rps', kind: 'rps', text: '三局两胜的猜拳，敢不敢？', enabled: true },
{ id: 'iv_p1', cat: 'pong', kind: 'pong', text: '想和你玩一局 Pong，来吗？', enabled: true },
{ id: 'iv_p2', cat: 'pong', kind: 'pong', text: '敢不敢来一局 Pong？我可是很强的', enabled: true },
{ id: 'iv_p3', cat: 'pong', kind: 'pong', text: 'Pong 桌子摆好了，就等你了', enabled: true },
{ id: 'iv_s1', cat: 'snake', kind: 'snake', text: '想和你玩双人贪吃蛇，来吗？', enabled: true },
{ id: 'iv_s2', cat: 'snake', kind: 'snake', text: '来盘贪吃蛇？看谁吃得多！', enabled: true },
{ id: 'iv_s3', cat: 'snake', kind: 'snake', text: '双人贪吃蛇开一局？这次我不撞你', enabled: true },
{ id: 'iv_c1', cat: 'cuddle', kind: 'cuddle', text: '想贴贴了，你可以过来一点吗？', enabled: true },
{ id: 'iv_c2', cat: 'cuddle', kind: 'cuddle', text: '抱一下再忙别的嘛，就一下下', enabled: true },
{ id: 'iv_c3', cat: 'cuddle', kind: 'cuddle', text: '手伸过来，我想牵一会儿', enabled: true },
{ id: 'iv_c4', cat: 'cuddle', kind: 'cuddle', text: '靠着你坐一会儿吧，什么都不做的那种', enabled: true },
{ id: 'iv_c5', cat: 'cuddle', kind: 'cuddle', text: '想把脑袋搁在你肩上，借我五分钟', enabled: true },
{ id: 'iv_c6', cat: 'cuddle', kind: 'cuddle', text: '刚才好像碰到你的手了？再来一次，这次牵住不放', enabled: true },
{ id: 'iv_c7', cat: 'cuddle', kind: 'cuddle', text: '隔着世界也想贴贴你，感觉到了就不要躲', enabled: true },
{ id: 'iv_c8', cat: 'cuddle', kind: 'cuddle', text: '今天很想你，想到想蹭蹭你', enabled: true },
{ id: 'iv_c9', cat: 'cuddle', kind: 'cuddle', text: '晚上早点休息，我来抱着你睡', enabled: true },
{ id: 'iv_c10', cat: 'cuddle', kind: 'cuddle', text: '心情很好，这种时候最适合亲亲了', enabled: true }
];
const CATS_TI = [['rps', '猜拳邀请'], ['pong', 'Pong 邀请'], ['snake', '贪吃蛇邀请'], ['cuddle', '贴贴邀请']];
const KIND_OF = {};
CATS_TI.forEach(([k]) => { KIND_OF[k] = k; });
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function toast(t) { if (typeof window.toast === 'function') window.toast(t); }
function kindLabel(kind) {
const hit = CATS_TI.filter(function (c) { return c[0] === kind; })[0];
return hit ? hit[1] : '邀请';
}
function tiMerge(d) {
const ids = {};
(d.questions || []).forEach(q => { if (q && q.id) ids[q.id] = true; });
const merged = Array.isArray(d.mergedIds) ? d.mergedIds.slice() : [];
const mergedSet = {};
merged.forEach(id => { if (id) mergedSet[id] = true; });
let changed = false;
DEFAULT_QUESTIONS.forEach(q => {
if (!mergedSet[q.id] && !ids[q.id]) {
const nq = Object.assign({}, q);
nq.isPreset = true;
d.questions.push(nq);
changed = true;
}
});
DEFAULT_QUESTIONS.forEach(q => {
if (!mergedSet[q.id]) { merged.push(q.id); mergedSet[q.id] = true; changed = true; }
});
DEFAULT_QUESTIONS.forEach(q => {
if (ids[q.id] && d.questions.some(x => x && x.id === q.id && x.isPreset !== true)) {
d.questions.forEach(x => { if (x && x.id === q.id) x.isPreset = true; });
changed = true;
}
});
if (changed) d.mergedIds = merged;
return changed;
}
function tiLoad() {
let d = null;
try { d = JSON.parse(store.get(KEY) || 'null'); } catch (e) { d = null; }
if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
if (!d.settings || typeof d.settings !== 'object') d.settings = {};
if (d.settings.useDefault === undefined) d.settings.useDefault = true;
if (!Array.isArray(d.questions) || !d.questions.length) {
const isNew = !store.get(KEY);
d.questions = DEFAULT_QUESTIONS.map(q => {
const nq = Object.assign({}, q);
nq.isPreset = true;
return nq;
});
d.mergedIds = DEFAULT_QUESTIONS.map(q => q.id);
if (!isNew) { try { store.set(KEY, JSON.stringify(d)); } catch (e) {} }
} else {
if (tiMerge(d)) { try { store.set(KEY, JSON.stringify(d)); } catch (e) {} }
}
if (!Array.isArray(d.groups)) d.groups = [];
return d;
}
function tiSave(d) { try { store.set(KEY, JSON.stringify(d)); } catch (e) {} }
function pickFrom(pool, lastId) {
if (!pool || !pool.length) return null;
let list = pool;
if (pool.length > 1 && lastId) {
const filtered = pool.filter(q => String(q.id || '') !== String(lastId));
if (filtered.length) list = filtered;
}
return list[Math.floor(Math.random() * list.length)];
}
function lastId() { try { return String(store.get('ti-last-id') || ''); } catch (e) { return ''; } }
function markLast(q) { try { if (q && q.id) store.set('ti-last-id', String(q.id)); } catch (e) {} }
function drawFrom(pool) { const q = pickFrom(pool, lastId()); if (q) markLast(q); return q; }
function enabledPool(d, kinds) {
const useDefault = (d.settings || {}).useDefault !== false;
return d.questions.filter(q => q && q.enabled !== false && q.text && kinds.indexOf(q.kind) >= 0 && (useDefault || q.isPreset !== true));
}
function gn(c, k, def) { try { const v = c ? c[k] : undefined; return (typeof v === 'number' && !isNaN(v)) ? v : def; } catch (e) { return def; } }
function hit(p) { return Math.random() * 100 < (window.dcpEff ? window.dcpEff(p) : p); }
window.taInviteDraw = function (c) {
try {
const d = tiLoad();
if (gn(c, 'ai-rps-en', 1) === 1 && hit(gn(c, 'ai-rps-prob', 8))) {
const q = drawFrom(enabledPool(d, ['rps']));
if (q) return q;
}
if (gn(c, 'ai-game-en', 1) === 1 && hit(gn(c, 'ai-game-prob', 5))) {
const q = drawFrom(enabledPool(d, ['pong', 'snake']));
if (q) return q;
}
if (gn(c, 'ai-cuddle-en', 1) === 1 && hit(gn(c, 'ai-cuddle-prob', 5))) {
const q = drawFrom(enabledPool(d, ['cuddle']));
if (q) return q;
}
return null;
} catch (e) { return null; }
};
window.taInvitePickAny = function () {
try {
const d = tiLoad();
return drawFrom(enabledPool(d, ['rps', 'pong', 'snake', 'cuddle']));
} catch (e) { return null; }
};
window.taInvitePickKind = function (kind) {
try {
const d = tiLoad();
return drawFrom(enabledPool(d, [kind]));
} catch (e) { return null; }
};
window.__tiBankInfo = function () {
try {
const d = tiLoad();
const useDefault = (d.settings || {}).useDefault !== false;
return {
total: d.questions.length,
preset: d.questions.filter(q => q && q.isPreset === true).length,
mine: d.questions.filter(q => q && q.isPreset !== true).length,
enabledPool: d.questions.filter(q => q && q.enabled !== false && q.text && (useDefault || q.isPreset !== true)).length,
useDefault: useDefault,
groups: (d.groups || []).length
};
} catch (e) { return null; }
};
let tiSysCat = null;
function renderTiSysInto(container, search) {
if (!container) return;
const d = tiLoad();
const useDefault = (d.settings || {}).useDefault !== false;
const hitKw = q => q && q.isPreset === true && q.text && (search === '' || q.text.indexOf(search) >= 0);
const counts = {};
CATS_TI.forEach(([k]) => { counts[k] = d.questions.filter(q => hitKw(q) && q.kind === k).length; });
const hasCats = CATS_TI.filter(([k]) => counts[k] > 0);
if (!hasCats.length) { container.innerHTML = '<div class="ta-empty" style="padding:14px">暂无系统预设邀请</div>'; return; }
if (!tiSysCat || !hasCats.some(([k]) => k === tiSysCat)) tiSysCat = hasCats[0][0];
let html = '<div class="card-tabs" style="padding:2px 2px 10px">';
hasCats.forEach(([k, label]) => {
html += '<button class="cc-tab' + (k === tiSysCat ? ' sel' : '') + '" data-cat="' + k + '">' + esc(label) + '<em class="cc-tab-n">' + counts[k] + '</em></button>';
});
html += '</div>';
d.questions.forEach(q => {
if (!(hitKw(q) && q.kind === tiSysCat)) return;
const idx = d.questions.indexOf(q);
html += '<div class="ta-row' + (!useDefault ? ' off' : '') + '">' +
'<label class="toggle"><input type="checkbox"' + (q.enabled !== false ? ' checked' : '') + ' data-idx="' + idx + '"><span class="tk"></span></label>' +
'<span class="ta-txt">' + esc(q.text) + ' <span class="tc-known">系统</span></span>' +
'</div>';
});
container.innerHTML = html;
container.querySelectorAll('.cc-tab[data-cat]').forEach(t => {
t.addEventListener('click', () => { tiSysCat = t.dataset.cat; renderTiSysInto(container, search); });
});
container.querySelectorAll('input[data-idx]').forEach(cb => {
cb.addEventListener('change', () => {
const d2 = tiLoad();
const q = d2.questions[Number(cb.dataset.idx)];
if (q) q.enabled = cb.checked;
tiSave(d2);
});
});
}
let tiBatchMode = false;
let tiSelected = new Set();
function tiItemHtml(q, idx, batchOn) {
if (batchOn) {
return '<div class="ta-row ti-batch-row">' +
'<label class="ti-batch-cb"><input type="checkbox" class="ti-batch-cb-in" data-bidx="' + idx + '"' + (tiSelected.has(idx) ? ' checked' : '') + '></label>' +
'<span class="ta-txt">' + esc(q.text) + ' <span class="tc-known">' + esc(kindLabel(q.kind)) + '</span></span>' +
'</div>';
}
const sysPreset = q.isPreset === true;
return '<div class="ta-row">' +
'<label class="toggle"><input type="checkbox"' + (q.enabled !== false ? ' checked' : '') + ' data-idx="' + idx + '"><span class="tk"></span></label>' +
'<span class="ta-txt">' + esc(q.text) + ' <span class="tc-known">' + esc(kindLabel(q.kind)) + '</span></span>' +
(sysPreset ? '' : '<button class="ta-edit" data-idx="' + idx + '" title="修改">✎</button>') +
'<button class="ta-del" data-idx="' + idx + '">✕</button>' +
'</div>';
}
function tiAddFormHtml(blockKey, grp, kind) {
return '<div class="ta-add">' +
'<select class="ti-type tc-input" data-key="' + blockKey + '">' +
'<option value="rps">猜拳邀请</option>' +
'<option value="pong">Pong 邀请</option>' +
'<option value="snake">贪吃蛇邀请</option>' +
'<option value="cuddle">贴贴邀请</option>' +
'</select>' +
'<input id="ti-new-' + blockKey + '" type="text" placeholder="添加邀请话术…（发送时自动带昵称）">' +
'<button class="ta-add-btn" data-key="' + blockKey + '" data-cat="' + (kind || 'rps') + '" data-grp="' + (grp || '') + '">添加</button>' +
'</div>';
}
function renderTiMineInto(container, search) {
if (!container) return;
const d = tiLoad();
const groups = Array.isArray(d.groups) ? d.groups : [];
const mineQs = d.questions.filter(q => q && q.isPreset !== true && q.text && (search === '' || q.text.indexOf(search) >= 0));
let html = '';
html += '<div class="mg-grp-row">' +
'<button class="cc-tool" id="ti-grp-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>新建分组</button>' +
'<button class="cc-tool" id="ti-batch-toggle" style="margin-left:6px' + (tiBatchMode ? ';background:#111;color:#fff;border-color:#111' : '') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>批量管理</button>' +
'</div>';
if (!mineQs.length && !groups.length) {
html += '<div class="ta-empty" style="padding:14px">暂未添加自定义邀请，可在上方批量导入或下方添加</div>';
container.innerHTML = html;
bindTiGroupOps();
bindTiBatchToggle();
return;
}
groups.forEach(g => {
const arr = mineQs.filter(q => q.grp === g.id);
html += '<div class="cal-card glass mg-block">' +
'<div class="cal-card-title mg-title"><span class="mg-name">' + esc(g.name) + '</span><span class="mg-cnt">(' + arr.length + ')</span>' +
'<span class="mg-ops"><button class="mg-op" data-tig="' + esc(g.id) + '" data-op="rn" title="重命名">✎</button><button class="mg-op" data-tig="' + esc(g.id) + '" data-op="rm" title="删除分组">✕</button></span></div>';
if (!arr.length) html += '<div class="ta-empty">这个分组还没有内容，可在下方直接添加</div>';
arr.forEach(q => { html += tiItemHtml(q, d.questions.indexOf(q), tiBatchMode); });
html += tiAddFormHtml('g' + g.id, g.id, 'rps');
html += '</div>';
});
const ungrouped = mineQs.filter(q => !q.grp);
html += '<div class="cal-card glass mg-block mg-ungrouped"><div class="cal-card-title mg-title"><span class="mg-name">未分组 · 按类型</span><span class="mg-cnt">(' + ungrouped.length + ')</span></div>';
if (!ungrouped.length) html += '<div class="ta-empty">暂无未分组内容，可在上方批量导入或下方添加</div>';
CATS_TI.forEach(([k, label]) => {
const arr = ungrouped.filter(q => (q.kind || 'rps') === k && (search === '' || q.text.indexOf(search) >= 0));
if (!arr.length) return;
html += '<div class="mg-subcat">' + esc(label) + ' <span style="font-size:11px;color:var(--muted);font-weight:400">(' + arr.length + ')</span></div>';
arr.forEach(q => { html += tiItemHtml(q, d.questions.indexOf(q), tiBatchMode); });
html += tiAddFormHtml('c' + k, '', k);
});
html += '</div>';
if (tiBatchMode) {
html += '<div class="ti-batch-bar" id="ti-batch-bar">' +
'<span class="ti-batch-cnt" id="ti-batch-cnt">已选 <em>' + tiSelected.size + '</em> 条</span>' +
'<button class="ti-batch-btn" id="ti-batch-all">全选</button>' +
'<button class="ti-batch-btn" id="ti-batch-move"' + (tiSelected.size === 0 ? ' disabled' : '') + '>移动</button>' +
'<button class="ti-batch-btn ti-batch-del-btn" id="ti-batch-del"' + (tiSelected.size === 0 ? ' disabled' : '') + '>删除</button>' +
'<button class="ti-batch-btn" id="ti-batch-cancel">取消</button>' +
'</div>';
}
container.innerHTML = html;
container.querySelectorAll('input[data-idx]').forEach(cb => {
cb.addEventListener('change', () => {
const d2 = tiLoad();
const q = d2.questions[Number(cb.dataset.idx)];
if (q) q.enabled = cb.checked;
tiSave(d2);
});
});
container.querySelectorAll('.ta-del').forEach(b => {
b.addEventListener('click', () => {
const d2 = tiLoad();
const q = d2.questions[Number(b.dataset.idx)];
if (q && q.isPreset === true) { toast('系统预设邀请不可删除，可关闭使用'); return; }
d2.questions.splice(Number(b.dataset.idx), 1);
tiSave(d2);
renderTiMineInto(container, search);
refreshTiCardCounts();
});
});
container.querySelectorAll('.ta-edit').forEach(b => {
b.addEventListener('click', () => {
const idx = Number(b.dataset.idx);
const d2 = tiLoad();
const q = d2.questions[idx];
if (!q) return;
if (q.isPreset === true) { toast('系统预设邀请不可修改'); return; }
if (!window.openModal) { toast('弹窗组件未就绪'); return; }
window.openModal('修改邀请话术', q.text || '', function (v) {
const nt = String(v || '').trim();
if (!nt) { toast('请输入邀请话术'); return; }
if (nt === q.text) return;
const d3 = tiLoad();
const q2 = d3.questions[idx];
if (!q2) return;
q2.text = nt;
tiSave(d3);
renderTiMineInto(container, search);
refreshTiCardCounts();
toast('已保存');
}, { maxLength: 80 });
});
});
container.querySelectorAll('input[data-bidx]').forEach(cb => {
cb.addEventListener('change', () => {
const idx = Number(cb.dataset.bidx);
if (cb.checked) tiSelected.add(idx); else tiSelected.delete(idx);
const cnt = document.getElementById('ti-batch-cnt');
if (cnt) cnt.innerHTML = '已选 <em>' + tiSelected.size + '</em> 条';
const del = document.getElementById('ti-batch-del');
if (del) del.disabled = tiSelected.size === 0;
const move = document.getElementById('ti-batch-move');
if (move) move.disabled = tiSelected.size === 0;
const all = document.getElementById('ti-batch-all');
if (all) all.textContent = tiSelected.size === 0 ? '全选' : (isAllSelected() ? '取消全选' : '全选');
});
});
container.querySelectorAll('.ta-add-btn').forEach(btn => {
btn.addEventListener('click', () => {
const key = btn.dataset.key;
const inp = document.getElementById('ti-new-' + key);
const v = inp ? inp.value.trim() : '';
if (!v) { toast('请输入邀请话术'); return; }
const typeSel = btn.parentElement.querySelector('.ti-type');
const kind = typeSel ? typeSel.value : 'rps';
if (!KIND_OF[kind]) { toast('类型无效'); return; }
const d2 = tiLoad();
const q = { id: 'iv_' + Date.now() + '_' + Math.floor(Math.random() * 999), kind: kind, cat: kind, text: v, enabled: true, isPreset: false };
if (btn.dataset.grp) q.grp = btn.dataset.grp;
d2.questions.push(q);
tiSave(d2);
renderTiMineInto(container, search);
refreshTiCardCounts();
toast('已添加' + kindLabel(kind) + '话术');
});
});
bindTiGroupOps();
bindTiBatchToggle();
if (tiBatchMode) bindTiBatchBar(container, search);
}
function bindTiBatchBar(container, search) {
const all = document.getElementById('ti-batch-all');
const del = document.getElementById('ti-batch-del');
const cancel = document.getElementById('ti-batch-cancel');
if (all && !all.__bound) {
all.__bound = true;
all.addEventListener('click', () => {
const d2 = tiLoad();
const customIdx = [];
d2.questions.forEach((q, i) => { if (q && q.isPreset !== true && q.text) customIdx.push(i); });
if (isAllSelected()) {
tiSelected.clear();
} else {
customIdx.forEach(i => tiSelected.add(i));
}
renderTiMineInto(container, search);
});
}
if (del && !del.__bound) {
del.__bound = true;
del.addEventListener('click', () => {
if (tiSelected.size === 0) return;
const cnt = tiSelected.size;
if (!window.openModal) { toast('弹窗组件未就绪'); return; }
window.openModal('批量删除邀请话术', '', function () {
const d2 = tiLoad();
const idxs = Array.from(tiSelected).sort((a, b) => b - a);
let removed = 0;
idxs.forEach(i => {
if (i >= 0 && i < d2.questions.length && d2.questions[i].isPreset !== true) {
d2.questions.splice(i, 1);
removed++;
}
});
tiSave(d2);
tiSelected.clear();
tiBatchMode = false;
renderTiMineInto(container, search);
refreshTiCardCounts();
toast('已删除 ' + removed + ' 条');
}, { noInput: true, staticText: '删除选中的 ' + cnt + ' 条自定义邀请话术？此操作不可撤销。' });
});
}
if (cancel && !cancel.__bound) {
cancel.__bound = true;
cancel.addEventListener('click', () => {
tiBatchMode = false;
tiSelected.clear();
renderTiMineInto(container, search);
});
}
const move = document.getElementById('ti-batch-move');
if (move && !move.__bound) {
move.__bound = true;
move.addEventListener('click', () => {
if (tiSelected.size === 0) { toast('请先勾选要移动的邀请话术'); return; }
if (!window.openModal) { toast('弹窗组件未就绪'); return; }
const d2 = tiLoad();
const groups = Array.isArray(d2.groups) ? d2.groups : [];
const opts = [{ label: '未分组', value: '' }];
groups.forEach(g => opts.push({ label: g.name, value: g.id }));
window.openModal('移动到分组', '', function (v) {
const targetGrp = String(v || '');
const d3 = tiLoad();
let moved = 0;
tiSelected.forEach(idx => {
const q = d3.questions[idx];
if (q && q.isPreset !== true) {
if (targetGrp) q.grp = targetGrp; else delete q.grp;
moved++;
}
});
tiSave(d3);
tiSelected.clear();
tiBatchMode = false;
renderTiMineInto(container, search);
refreshTiCardCounts();
const gName = targetGrp ? ((d3.groups || []).find(x => x.id === targetGrp) || {}).name || '未分组' : '未分组';
toast('已移动 ' + moved + ' 条到「' + gName + '」');
}, { pills: opts, pill: opts[0].value, noInput: true });
});
}
}
function isAllSelected() {
const d2 = tiLoad();
let total = 0;
d2.questions.forEach(q => { if (q && q.isPreset !== true && q.text) total++; });
if (total === 0) return false;
if (tiSelected.size < total) return false;
for (const i of tiSelected) {
const q = d2.questions[i];
if (!q || q.isPreset === true || !q.text) return false;
}
return true;
}
function bindTiBatchToggle() {
const btn = document.getElementById('ti-batch-toggle');
if (!btn || btn.__bound) return;
btn.__bound = true;
btn.addEventListener('click', () => {
const container = document.getElementById('ti-mine-cats');
if (!container) return;
const d2 = tiLoad();
const hasAny = d2.questions.some(q => q && q.isPreset !== true && q.text);
if (!hasAny) { toast('暂无自定义邀请可批量管理'); return; }
tiBatchMode = !tiBatchMode;
tiSelected.clear();
renderTiMineInto(container, getTiSearch());
});
}
function bindTiGroupOps() {
const grpAdd = document.getElementById('ti-grp-add');
if (grpAdd && !grpAdd.__bound) {
grpAdd.__bound = true;
grpAdd.addEventListener('click', () => {
const d2 = tiLoad();
window.cardGroups.addFlow(d2.groups, g => {
if (!g) return;
tiSave(d2);
renderTiMineInto(document.getElementById('ti-mine-cats'), getTiSearch());
toast('已新建分组「' + g.name + '」');
});
});
}
const wrap = document.getElementById('ti-mine-cats');
if (!wrap) return;
wrap.querySelectorAll('.mg-op').forEach(b => {
if (b.__bound) return;
b.__bound = true;
b.addEventListener('click', () => {
const d2 = tiLoad();
const gid = b.dataset.tig;
const g = (d2.groups || []).find(x => x.id === gid);
if (!g) return;
if (b.dataset.op === 'rn') {
window.cardGroups.renameFlow(g, d2.groups, name => {
if (!name) return;
g.name = name;
tiSave(d2);
renderTiMineInto(wrap, '');
toast('分组已重命名');
});
} else if (b.dataset.op === 'rm') {
window.cardGroups.removeFlow(g.name, ok => {
if (!ok) return;
d2.questions.forEach(q => { if (q.grp === gid) q.grp = ''; });
d2.groups = d2.groups.filter(x => x.id !== gid);
tiSave(d2);
renderTiMineInto(wrap, '');
toast('已删除分组「' + g.name + '」');
});
}
});
});
}
let tiTab = 'sys';
let tiSearch = '';
function getTiSearch() { return tiSearch; }
function switchTiTab(tab) {
tiTab = tab;
const tabsWrap = document.getElementById('ti-tabs');
if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
const sysPanel = document.getElementById('ti-sys-panel');
const minePanel = document.getElementById('ti-mine-panel');
if (sysPanel) sysPanel.hidden = tab !== 'sys';
if (minePanel) minePanel.hidden = tab !== 'mine';
tiSearch = '';
tiBatchMode = false;
tiSelected.clear();
const searchInput = document.getElementById('ti-search');
if (searchInput) searchInput.value = '';
if (tab === 'sys') renderTiSysInto(document.getElementById('ti-sys-cats'), ''); else renderTiMineInto(document.getElementById('ti-mine-cats'), '');
}
const tiTabsWrap = document.getElementById('ti-tabs');
if (tiTabsWrap) {
tiTabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
tab.addEventListener('click', () => switchTiTab(tab.dataset.tab));
});
}
const tiSearchInput = document.getElementById('ti-search');
if (tiSearchInput) {
tiSearchInput.addEventListener('input', () => {
tiSearch = tiSearchInput.value.trim();
if (tiTab === 'sys') renderTiSysInto(document.getElementById('ti-sys-cats'), tiSearch);
else renderTiMineInto(document.getElementById('ti-mine-cats'), tiSearch);
});
}
function renderTiSettings() {
const el = document.getElementById('ti-default');
if (el) el.checked = (tiLoad().settings || {}).useDefault !== false;
}
const tiDefault = document.getElementById('ti-default');
if (tiDefault) tiDefault.addEventListener('change', () => {
const d = tiLoad();
d.settings.useDefault = tiDefault.checked;
tiSave(d);
switchTiTab(tiTab);
toast(tiDefault.checked ? '系统预设邀请已开启' : '系统预设邀请已关闭（仅用你添加的）');
});
const batchKindEl = document.getElementById('ti-batch-kind');
const batchTextEl = document.getElementById('ti-batch');
const batchAddBtn = document.getElementById('ti-batch-add');
if (batchTextEl && batchAddBtn) {
batchAddBtn.addEventListener('click', () => {
const kind = batchKindEl ? batchKindEl.value : 'rps';
if (!KIND_OF[kind]) { toast('请选择要导入的类型'); return; }
const lines = (batchTextEl.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
if (!lines.length) { toast('请先输入邀请话术，每行一条'); return; }
const d2 = tiLoad();
lines.forEach(t => {
d2.questions.push({ id: 'iv_' + Date.now() + '_' + Math.floor(Math.random() * 9999), kind: kind, cat: kind, text: t, enabled: true, isPreset: false });
});
tiSave(d2);
batchTextEl.value = '';
renderTiMineInto(document.getElementById('ti-mine-cats'), '');
refreshTiCardCounts();
toast('已导入 ' + lines.length + ' 条' + kindLabel(kind));
});
}
const nowBtn = document.getElementById('ti-now');
if (nowBtn) nowBtn.addEventListener('click', () => {
if (window.triggerTaInviteNow && window.triggerTaInviteNow()) toast('TA 在聊天里向你发起了邀请');
});
const page = document.getElementById('page-ta-invite');
if (page) {
const showPage = (tab) => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
page.hidden = false;
const tw = document.getElementById('ti-tabs'); if (tw) tw.style.display = 'none';
switchTiTab(tab);
};
const li = document.getElementById('li-ta-invite');
if (li) li.addEventListener('click', () => showPage('sys'));
const liMine = document.getElementById('li-ta-invite-mine');
if (liMine) liMine.addEventListener('click', () => showPage('mine'));
const backBtn = document.getElementById('ti-back');
if (backBtn) backBtn.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
renderTiSettings();
}
window.refreshTiCardCounts = function () {
try {
const qs = tiLoad().questions || [];
const elSys = document.querySelector('#li-ta-invite > .t');
if (elSys) elSys.textContent = qs.filter(q => q && q.isPreset === true).length;
const elMine = document.querySelector('#li-ta-invite-mine > .t');
if (elMine) elMine.textContent = qs.filter(q => q && q.isPreset !== true).length;
} catch (e) {}
};
const ccPageEl = document.getElementById('page-chatcard');
if (ccPageEl) {
const mo = new MutationObserver(() => { if (!ccPageEl.hidden) window.refreshTiCardCounts(); });
mo.observe(ccPageEl, { attributes: true, attributeFilter: ['hidden'] });
}
window.refreshTiCardCounts();
window.__cardSearchFns = window.__cardSearchFns || [];
window.__cardSearchFns.push({ name: 'TA的邀请', fn: function (kw) {
const out = [];
try { (tiLoad().questions || []).forEach(function (q) { const txt = q && q.text ? q.text : ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: q.isPreset === true ? '系统预设' : '我的添加' }); }); } catch (e) {}
return out;
} });
var _invCeReflowT = null;
function _reflowInviteCeBoxes() {
var pg = document.getElementById('page-ta-invite');
if (!pg || pg.hidden) return;
pg.querySelectorAll('.ta-add .ce-box').forEach(function (b) {
if (b.offsetParent === null) return;
var prev = b.style.transform;
b.style.transform = 'translateZ(0)';
void b.offsetHeight;
b.style.transform = prev;
});
}
function _schedInviteCeReflow() {
clearTimeout(_invCeReflowT);
_invCeReflowT = setTimeout(_reflowInviteCeBoxes, 120);
}
if (window.visualViewport) window.visualViewport.addEventListener('resize', _schedInviteCeReflow);
window.addEventListener('resize', _schedInviteCeReflow);
(function () {
if (!window.idbGet || !window.activePrefix) return;
window.idbGet(window.activePrefix() + ':' + KEY).then(function (v) {
if (v === undefined || v === null) return;
try {
const idbData = typeof v === 'string' ? JSON.parse(v) : v;
if (!idbData || typeof idbData !== 'object' || Array.isArray(idbData)) return;
if (!Array.isArray(idbData.questions) || !idbData.questions.length) return;
const local = tiLoad();
if (idbData.questions.length > (Array.isArray(local.questions) ? local.questions.length : 0)) {
tiMerge(idbData);
try { store.set(KEY, JSON.stringify(idbData)); } catch (e) {}
try { window.refreshTiCardCounts(); } catch (e) {}
}
} catch (e) {}
});
})();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("ta-invite.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("ta-invite.js"); try { console.error("[JS] ta-invite.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[ta-invite.js] " + String(__e && __e.message || __e)); } })();