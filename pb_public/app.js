(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- Справочники ---------- */
const STATUS = {
  todo:{l:'Не начинал', c:'st-todo'}, started:{l:'Приступил', c:'st-start'},
  finishing:{l:'Заканчиваю', c:'st-finish'}, done:{l:'Сделал', c:'st-done'}
};
const ORDER = ['todo','started','finishing','done'];
const CONTROLS = ['Экзамен','Зачёт','Дифференцированный зачёт','Курсовая работа','Контрольная работа','Реферат'];
const EXAM_KINDS = ['Экзамен','Зачёт','Дифференцированный зачёт','Защита курсовой','Консультация'];
const COLORS = {blue:'Синий', wine:'Бордовый', green:'Зелёный', amber:'Янтарный', violet:'Фиолетовый'};
const ALLOWED = ['pdf','png','jpg','jpeg','gif','webp','heic','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','txt','md','csv','zip','rar','7z','epub','fb2','djvu'];
const MB = 1024*1024;
const MAX_FILE = 20*MB;
const PBN = {inst:'institutions', subjects:'subjects', tasks:'tasks', sessions:'sessions', theses:'theses', stages:'stages', notes:'notes', att:'attachments'};
const KEYS = Object.keys(PBN);
let stMenu = null; // открытый список статусов
const SOON_DAYS = 31; // сколько дней вперёд показывать сроки на главной

/* ---------- Состояние ---------- */
const S = {inst:[], subjects:[], tasks:[], sessions:[], theses:[], stages:[], notes:[], att:[], invites:[], aiGrants:[], access:null, adminUsers:null, loaded:false};
const loadLS = (k, d) => { try { const v = localStorage.getItem('zach_'+k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } };
const saveLS = (k, v) => { try { localStorage.setItem('zach_'+k, JSON.stringify(v)); } catch(e){} };
/* ---------- Тема оформления: auto (как в системе), light, dark ---------- */
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
const ICON_SUN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"/></svg>';
function themePref(){ const t = loadLS('theme', 'auto'); return t === 'light' || t === 'dark' ? t : 'auto'; }
function isDark(){ const t = themePref(); return t === 'dark' || (t === 'auto' && darkMQ.matches); }
function applyTheme(){
  const t = themePref(), root = document.documentElement;
  if(t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  const dark = isDark();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#10161b' : '#f1f4f6'));
  const b = document.getElementById('theme-btn');
  if(b){ b.innerHTML = dark ? ICON_SUN : ICON_MOON; const l = dark ? 'Светлая тема' : 'Тёмная тема'; b.title = l; b.setAttribute('aria-label', l); }
}
function setTheme(t){ saveLS('theme', t); applyTheme(); }
darkMQ.addEventListener && darkMQ.addEventListener('change', () => { if(themePref() === 'auto') applyTheme(); });
applyTheme();

const UI = {
  tab: loadLS('tab','home'), subjectId:null,
  f: loadLS('filters', {inst:'', subj:'', st:'open'}),
  q:'', ch:'', noteDraft:'', noteCh:'', thesisId: loadLS('thesis', ''), aiPick: loadLS('ai', 'claude')
};
const pb = new PocketBase(location.origin);
pb.autoCancellation(false);
const me = () => pb.authStore.record || {};
const isAdmin = () => me().role === 'admin';

/* ---------- Даты ---------- */
const pad = n => String(n).padStart(2,'0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const dnum = iso => { const [y,m,d] = iso.split('-').map(Number); return Date.UTC(y,m-1,d)/864e5; };
const diff = iso => Math.round(dnum(iso) - dnum(todayISO()));
const MON = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const MONF = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WD = ['вс','пн','вт','ср','чт','пт','сб'];
const WDF = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
function fmt(iso, wd){
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return (wd ? WD[dt.getDay()]+', ' : '') + d + ' ' + MON[m-1] + (y !== new Date().getFullYear() ? ' ' + y : '');
}
// Дата цифрами: 10.11. (год добавляется, если он не текущий)
function fmtNum(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  return d + '.' + pad(m) + '.' + (y !== new Date().getFullYear() ? y : '');
}
const plural = (n, f) => { n = Math.abs(n) % 100; const n1 = n % 10; if(n > 10 && n < 20) return f[2]; if(n1 > 1 && n1 < 5) return f[1]; if(n1 === 1) return f[0]; return f[2]; };
const DAYS = ['день','дня','дней'];
function rel(iso){
  const k = diff(iso);
  if(k === 0) return 'сегодня';
  if(k === 1) return 'завтра';
  if(k === -1) return 'вчера';
  if(k > 0) return `через ${k} ${plural(k, DAYS)}`;
  return `${-k} ${plural(k, DAYS)} назад`;
}
const fsize = b => b < 1024*1024 ? Math.max(1, Math.round(b/1024)) + ' КБ' : (b/MB).toFixed(1).replace('.', ',') + ' МБ';

/* ---------- Доступ к данным ---------- */
const byId = (col, id) => S[col].find(x => x.id === id);
const instOf = id => byId('inst', id);
const subjOf = id => byId('subjects', id);
const sortedInst = () => [...S.inst].sort((a,b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name, 'ru'));
const subjOrder = (a,b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name, 'ru');
const subjectsOf = instId => S.subjects.filter(s => s.instId === instId).sort(subjOrder);
const sortedSubjects = () => sortedInst().flatMap(i => subjectsOf(i.id)).concat(S.subjects.filter(s => !instOf(s.instId)));
const isOverdue = t => t.status !== 'done' && t.due && diff(t.due) < 0;
function taskSort(a, b){
  const ad = a.status === 'done', bd = b.status === 'done';
  if(ad !== bd) return ad ? 1 : -1;
  if(a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  if(a.due && !b.due) return -1;
  if(!a.due && b.due) return 1;
  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}
const ID_ABC = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newId(){ const a = new Uint8Array(15); crypto.getRandomValues(a); return Array.from(a, x => ID_ABC[x % 36]).join(''); }
const SKIP = new Set(['id','owner','collectionId','collectionName','created','updated','expand']);
function clean(d){ const o = {}; for(const [k, v] of Object.entries(d || {})) if(!SKIP.has(k) && v !== undefined) o[k] = v; return o; }
function upsert(key, rec){ const arr = S[key]; const i = arr.findIndex(x => x.id === rec.id); if(i >= 0) arr[i] = {...rec}; else arr.push({...rec}); schedule(); }
function removeLocal(key, id){ S[key] = S[key].filter(x => x.id !== id); schedule(); }
function col(key){
  const c = pb.collection(PBN[key]);
  return { doc(id){
    const rid = id || newId();
    return {
      id: rid,
      async set(data){ const rec = byId(key, rid) ? await c.update(rid, clean(data)) : await c.create({...clean(data), id: rid, owner: me().id}); upsert(key, rec); return rec; },
      async update(data){ const rec = await c.update(rid, clean(data)); upsert(key, rec); return rec; },
      async delete(){ await c.delete(rid); removeLocal(key, rid); }
    };
  } };
}
async function loadAll(keys = KEYS){
  const res = await Promise.all(keys.map(k => pb.collection(PBN[k]).getFullList({batch: 500})));
  keys.forEach((k, n) => { S[k] = res[n]; });
  schedule();
}
let subscribed = false;
async function subscribeAll(){
  if(subscribed) return; subscribed = true;
  // администратор продлил доступ или изменилось имя с другого устройства
  await pb.collection('users').subscribe(me().id, e => { if(e.action === 'update'){ pb.authStore.save(pb.authStore.token, e.record); renderMe(); loadAccess(); } });
  for(const k of KEYS){
    await pb.collection(PBN[k]).subscribe('*', e => { if(e.action === 'delete') removeLocal(k, e.record.id); else upsert(k, e.record); });
  }
}

/* ---------- Запуск ---------- */
async function boot(){
  $('#today').textContent = (() => { const d = new Date(); return `${WDF[d.getDay()]}, ${d.getDate()} ${MONF[d.getMonth()]}`; })();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const invite = new URLSearchParams(location.search).get('invite');
  if(invite){ history.replaceState(null, '', location.pathname); }
  if(!pb.authStore.isValid){ showAuth(invite ? 'register' : 'login', invite); return; }
  try { await pb.collection('users').authRefresh(); }
  catch(e){ if(e && e.status && e.status !== 0){ pb.authStore.clear(); showAuth('login'); return; } }
  startApp();
}
async function startApp(){
  $('#auth').hidden = true; $('#app').hidden = false;
  renderMe(); loadAccess();
  render();
  try {
    await loadAll();
    S.loaded = true; $('#notice').hidden = true; render();
    if(UI.tab === 'account') loadAccount();
    subscribeAll().catch(() => {});
  } catch(e){
    showNotice('Не удалось загрузить данные. ' + errText(e));
  }
}
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible') return;
  checkUpdate();
  if(S.loaded && pb.authStore.isValid){ loadAll().catch(() => {}); loadAccess(); }
});

/* ---------- Пользователь в шапке и доступ ---------- */
const initial = u => (String(u.name || u.email || '?').trim()[0] || '?').toUpperCase();
function avatarHTML(u){
  return u.avatar ? `<img src="${esc(pb.files.getURL(u, u.avatar, {thumb: '96x96'}))}" alt="">` : `<span>${esc(initial(u))}</span>`;
}
function renderMe(){
  const u = me();
  $('#me-ava').innerHTML = avatarHTML(u);
  $('#me-name').textContent = String(u.name || '').trim().split(/\s+/)[0] || String(u.email || '').split('@')[0];
}
const fmtFull = iso => iso ? iso.split('-').reverse().join('.') : '';
const contactHTML = c => /^[^\s@]+@[^\s@]+$/.test(c || '') ? `<a href="mailto:${esc(c)}">${esc(c)}</a>` : esc(c || 'администратору');
const readOnly = () => !!(S.access && !S.access.active);
const RO_MSG = 'Доступ приостановлен: добавлять и менять записи сейчас нельзя.';
async function loadAccess(){
  try { S.access = await pb.send('/api/zachetka/access', {}); } catch(e){ return; }
  renderAccessBar();
  if(UI.tab === 'account' && S.loaded) render();
}
function renderAccessBar(){
  const a = S.access, bar = $('#access-bar');
  let html = '';
  if(a && !a.active){
    html = `<b>Доступ приостановлен${a.reason === 'expired' ? ` (срок закончился ${fmtFull(a.until)})` : ''}.</b> Ваши записи и файлы сохранены: их можно смотреть и скачивать, а добавлять и менять нельзя. Чтобы продлить доступ, напишите: ${contactHTML(a.contact)}.`;
    bar.classList.add('off');
  } else if(a && a.until && !a.admin && dnum(a.until) - dnum(a.today) <= 7){
    const k = Math.round(dnum(a.until) - dnum(a.today));
    html = `Доступ действует до ${fmtFull(a.until)}${k === 0 ? ' (последний день)' : ` (осталось ${k} ${plural(k, DAYS)})`}. Чтобы продлить, напишите: ${contactHTML(a.contact)}.`;
    bar.classList.remove('off');
  }
  $('#access-text').innerHTML = html;
  bar.hidden = !html;
}
function accessLine(){
  const a = S.access;
  if(!a) return '';
  if(a.admin) return 'Вы администратор, доступ бессрочный.';
  if(!a.active) return `Доступ приостановлен${a.reason === 'expired' ? ` (срок закончился ${fmtFull(a.until)})` : ''}. Чтобы продлить, напишите: ${contactHTML(a.contact)}.`;
  return a.until ? `Доступ действует до ${fmtFull(a.until)} включительно.` : 'Доступ бессрочный.';
}
// Фото уменьшаем до квадрата 256×256 прямо в браузере
async function squareJpeg(file, size){
  let img;
  try { img = await createImageBitmap(file); }
  catch(e){
    img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w = img.width, h = img.height, side = Math.min(w, h);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  cv.getContext('2d').drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.88));
}
async function uploadAvatar(file){
  let blob;
  try { blob = await squareJpeg(file, 256); } catch(e){ toast('Не удалось открыть картинку. Выберите фото в формате JPG или PNG.'); return; }
  const fd = new FormData(); fd.append('avatar', new File([blob], 'avatar.jpg', {type: 'image/jpeg'}));
  try { const rec = await pb.collection('users').update(me().id, fd); pb.authStore.save(pb.authStore.token, rec); renderMe(); render(); toast('Фото сохранено'); }
  catch(e){ toast(errText(e)); }
}

/* ---------- Проверка новой версии ---------- */
// Сравниваем ?v= у app.js и app.css в открытой странице и в свежем index.html с сервера
const verOf = html => (html.match(/\/app\.(?:js|css)\?v=\d+/g) || []).sort().join(' ');
const MY_VER = verOf(document.documentElement.innerHTML);
let lastCheck = 0;
async function checkUpdate(){
  if(!navigator.onLine || Date.now() - lastCheck < 60e3) return;
  lastCheck = Date.now();
  try {
    const res = await fetch('/index.html', {cache: 'no-store'});
    if(!res.ok) return;
    const v = verOf(await res.text());
    if(v && MY_VER && v !== MY_VER) $('#update-bar').hidden = false;
  } catch(e){}
}
setInterval(checkUpdate, 30*60e3);
$('#update-btn').addEventListener('click', () => location.reload());
$('#update-close').addEventListener('click', () => { $('#update-bar').hidden = true; });
window.addEventListener('online', () => { $('#notice').hidden = true; if(S.loaded) loadAll().catch(() => {}); });
window.addEventListener('offline', () => showNotice('Нет подключения к интернету. Изменения сохранятся, когда связь вернётся, если не закрывать страницу.'));
let raf = 0;
function schedule(){ if(raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function showNotice(text){ $('#notice-text').textContent = text; $('#notice').hidden = false; }

/* ---------- Отрисовка ---------- */
function render(){
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === UI.tab ? 'page' : 'false'));
  const m = $('#main');
  if(!S.loaded){ m.innerHTML = '<div class="loading">Загружаю данные…</div>'; return; }
  const views = {home:vHome, subjects:vSubjects, tasks:vTasks, sessions:vSessions, thesis:vThesis, account:vAccount};
  closeStatusMenu();
  m.innerHTML = (views[UI.tab] || vHome)();
  if(cur && cur.refresh) cur.refresh();
}

function chip(colName, id, status){
  const s = STATUS[status] || STATUS.todo;
  return `<button class="chip ${s.c}" data-act="status" data-col="${colName}" data-id="${esc(id)}" aria-haspopup="menu" title="Нажмите, чтобы выбрать статус">${s.l}</button>`;
}
function dueHTML(t){
  if(!t.due) return '<span class="muted">без срока</span>';
  const k = diff(t.due);
  let r = rel(t.due);
  if(t.status !== 'done' && k < 0) r = `просрочено на ${-k} ${plural(k, DAYS)}`;
  return `<span class="d">${fmt(t.due, true)}</span><span class="rel">${r}</span>`;
}
function taskRow(t, opts = {}){
  const s = subjOf(t.subjectId), i = s ? instOf(s.instId) : null;
  const files = S.att.filter(a => a.taskId === t.id).length;
  const sub = [];
  if(opts.subject !== false) sub.push(`<i class="dot c-${esc(i?.color || 'blue')}"></i>${esc(s ? s.name : 'Предмет удалён')}${i ? ' · ' + esc(i.name) : ''}`);
  if(files) sub.push(`${files} ${plural(files, ['файл','файла','файлов'])}`);
  return `<div class="row${isOverdue(t) ? ' is-overdue' : ''}${t.status === 'done' ? ' is-done' : ''}">
    ${chip('tasks', t.id, t.status)}
    <button class="row-main" data-act="task" data-id="${esc(t.id)}"><span class="row-title">${esc(t.title || 'Без названия')}</span>${sub.length ? `<span class="row-sub">${sub.join(' · ')}</span>` : ''}</button>
    <span class="row-due">${dueHTML(t)}</span>
  </div>`;
}
const taskList = (arr, opts) => `<div class="list">${arr.map(t => taskRow(t, opts)).join('')}</div>`;
const bar = (a, b) => `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${b}" aria-valuenow="${a}"><span style="width:${b ? Math.round(a / b * 100) : 0}%"></span></div>`;

/* ---------- Главная ---------- */
function nextSession(){
  const t = todayISO();
  return S.sessions.filter(s => s.start && (s.end || s.start) >= t).sort((a,b) => a.start < b.start ? -1 : 1)[0];
}
function countdownOf(s){
  const t = todayISO();
  if(s.start > t){ const k = diff(s.start); return {n:k, l:`${plural(k, DAYS)} до начала`, now:false}; }
  const end = s.end || s.start;
  if(end >= t){ const k = diff(end); return {n:'идёт', l: k === 0 ? 'последний день' : `до конца ${k} ${plural(k, DAYS)}`, now:true}; }
  return {n:'', l:'сессия прошла', now:false};
}
function vHome(){
  if(!S.inst.length) return firstRun();
  const open = S.tasks.filter(x => x.status !== 'done');
  const overdue = open.filter(isOverdue).sort(taskSort);
  const soon = open.filter(x => x.due && diff(x.due) >= 0 && diff(x.due) <= SOON_DAYS).sort(taskSort);
  const working = open.filter(x => (x.status === 'started' || x.status === 'finishing') && !(x.due && diff(x.due) <= SOON_DAYS)).sort(taskSort);
  const passed = S.subjects.filter(s => s.status === 'passed').length;
  const inWork = open.filter(x => x.status === 'started' || x.status === 'finishing').length;

  let left = '';
  if(overdue.length) left += `<section class="section"><h3 class="sec-title">Просрочено <span class="count">${overdue.length}</span></h3>${taskList(overdue)}</section>`;
  left += `<section class="section"><h3 class="sec-title">Сроки на месяц <span class="count">${soon.length}</span></h3>${soon.length ? taskList(soon) : `<div class="empty">В ближайший месяц (31 день) сроков нет.</div>`}</section>`;
  left += `<section class="section"><h3 class="sec-title">В работе, срок позже <span class="count">${working.length}</span></h3>${working.length ? taskList(working) : `<div class="empty">Здесь появятся задания со статусом «Приступил» или «Заканчиваю», у которых срок дальше месяца.</div>`}</section>`;
  left += `<div class="actions"><button class="btn primary" data-act="new-task">+ Задание</button></div>`;

  const ns = nextSession();
  let sess;
  if(ns){
    const cd = countdownOf(ns), i = instOf(ns.instId);
    const ex = [...(ns.exams || [])].filter(e => !e.date || e.date >= todayISO()).sort(examSort).slice(0, 4);
    sess = `<div class="card"><span class="inst-tag c-${esc(i?.color || 'blue')}">${esc(i?.name || '')}</span>
      <h3>${esc(ns.title || 'Сессия')}</h3>
      <div class="big-count"><b>${cd.n}</b><span class="muted">${cd.l}</span></div>
      <p class="muted">${sessRange(ns)}</p>
      ${ex.length ? `<div class="mini-exams">${ex.map(e => `<div><span class="mono">${fmt(e.date) || 'дата?'}</span><span>${esc(subjOf(e.subjectId)?.name || e.subjectName || 'Предмет')} · ${esc((e.kind || '').toLowerCase())}</span></div>`).join('')}</div>` : '<p class="muted">Экзамены и зачёты пока не внесены.</p>'}
      <div><button class="btn sm" data-goto="sessions">Все сессии</button></div></div>`;
  } else {
    sess = `<div class="card"><h3>Ближайшая сессия</h3><p class="muted">Сессий впереди нет. Добавьте даты, и здесь появится обратный отсчёт.</p><div><button class="btn sm" data-act="new-session">+ Сессия</button></div></div>`;
  }

  const thesis = !S.theses.length ? `<div class="card"><h3>Дипломная работа</h3><p class="muted">Добавьте диплом, чтобы вести план по этапам, заметки и файлы.</p><div><button class="btn sm" data-act="new-thesis">+ Диплом</button></div></div>` : thesisList().map((th, n) => {
  const st = ofThesis('stages', th), sd = st.filter(x => x.status === 'done').length;
  const nextStage = [...st].filter(x => x.status !== 'done').sort(taskSort)[0];
  const ti = th.instId ? instOf(th.instId) : null;
  return `<div class="card"><h3>Диплом${ti ? ` <span class="inst-tag c-${esc(ti.color || 'blue')}">${esc(ti.name)}</span>` : ''}</h3>
    ${th?.topic ? `<p>${esc(th.topic)}</p>` : '<p class="muted">Тема пока не указана.</p>'}
    ${st.length ? `<div class="kv"><span class="muted">Этапы</span><span class="mono">${sd} из ${st.length}</span></div>${bar(sd, st.length)}` : '<p class="muted">План по этапам ещё не составлен.</p>'}
    ${nextStage ? `<div class="kv"><span>Дальше: ${esc(nextStage.title)}</span>${nextStage.due ? `<span class="mono${diff(nextStage.due) < 0 ? '" style="color:var(--danger)' : ''}">${fmt(nextStage.due)}</span>` : ''}</div>` : ''}
    ${th?.submit ? `<div class="kv"><span class="muted">Сдача</span><span>${fmt(th.submit)}, ${rel(th.submit)}</span></div>` : ''}
    <div><button class="btn sm" data-act="pick-thesis" data-id="${esc(th.id)}" data-go="1">Открыть</button></div></div>`;
  }).join('');

  const insts = `<div class="card"><h3>Предметы</h3>${sortedInst().map(i => {
      const all = subjectsOf(i.id), p = all.filter(s => s.status === 'passed').length;
      return `<div class="kv"><span class="inst-tag c-${esc(i.color || 'blue')}">${esc(i.name)}</span><span class="mono">${p} из ${all.length} сдано</span></div>${bar(p, all.length)}`;
    }).join('')}</div>`;

  return `<div class="stats">
      <div class="stat${overdue.length ? ' alert' : ''}"><b>${overdue.length}</b><span>просрочено</span></div>
      <div class="stat"><b>${soon.length}</b><span>сроков за 31 день</span></div>
      <div class="stat"><b>${inWork}</b><span>в работе</span></div>
      <div class="stat"><b>${passed}<span class="muted" style="font-size:18px">/${S.subjects.length}</span></b><span>предметов сдано</span></div>
    </div>
    <div class="home-grid"><div>${left}</div><aside class="side">${sess}${thesis}${insts}</aside></div>`;
}
function firstRun(){
  return `<div class="empty"><b>Пока нет ни одного учебного заведения.</b><span>Добавьте первое, потом предметы и задания.</span><button class="btn primary" data-act="new-inst">+ Учебное заведение</button></div>`;
}

/* ---------- Предметы ---------- */
function vSubjects(){
  if(UI.subjectId){ const s = subjOf(UI.subjectId); if(s) return vSubject(s); UI.subjectId = null; }
  const head = `<div class="page-head"><h2>Предметы</h2><span class="grow"></span><div class="actions"><button class="btn" data-act="new-inst">+ Заведение</button><button class="btn primary" data-act="new-subject">+ Предмет</button></div></div>`;
  if(!S.inst.length) return head + firstRun();
  return head + sortedInst().map(i => {
    const list = subjectsOf(i.id), p = list.filter(s => s.status === 'passed').length;
    return `<section class="inst-block c-${esc(i.color || 'blue')}">
      <div class="inst-head"><h3>${esc(i.name)}</h3><span class="prog mono">${p} из ${list.length} сдано</span><span class="grow"></span>
        <button class="btn sm ghost" data-act="new-subject" data-inst="${esc(i.id)}">+ Предмет</button>
        <button class="btn sm ghost" data-act="edit-inst" data-id="${esc(i.id)}">Изменить</button></div>
      ${list.length ? `<div class="subj-grid">${list.map(subjCard).join('')}</div>` : `<div class="empty">Предметов пока нет.</div>`}
    </section>`;
  }).join('');
}
function subjCard(s){
  const tasks = S.tasks.filter(t => t.subjectId === s.id), done = tasks.filter(t => t.status === 'done').length;
  const over = tasks.filter(isOverdue).length;
  const passed = s.status === 'passed';
  return `<button class="subj${passed ? ' passed' : ''}" data-act="open-subject" data-id="${esc(s.id)}">
    <h4>${esc(s.name)}</h4>
    <div class="tags">${passed ? `<span class="tag ok">Сдал${s.grade ? ': ' + esc(s.grade) : ''}</span>` : `<span class="tag">Готовлю</span>`}<span class="tag">${esc(s.control || 'форма контроля не указана')}</span></div>
    ${(s.teacher || s.date) ? `<div class="meta">${s.teacher ? `<span>${esc(s.teacher)}</span>` : ''}${s.date ? `<span>Сдача: ${fmt(s.date, true)}${!passed ? ', ' + rel(s.date) : ''}</span>` : ''}</div>` : ''}
    <div class="foot"><span>Задания: ${done} из ${tasks.length}${over ? ` · <span style="color:var(--danger)">просрочено ${over}</span>` : ''}</span>${bar(done, tasks.length)}</div>
  </button>`;
}
function vSubject(s){
  const i = instOf(s.instId);
  const tasks = S.tasks.filter(t => t.subjectId === s.id).sort(taskSort);
  const exams = S.sessions.flatMap(se => (se.exams || []).filter(e => e.subjectId === s.id).map(e => ({...e, session: se.title})));
  const byNew = (a,b) => (b.createdAt ?? 0) - (a.createdAt ?? 0);
  const own = S.att.filter(f => f.subjectId === s.id).sort(byNew);
  const fromTasks = tasks.flatMap(t => S.att.filter(f => f.taskId === t.id).map(f => ({f, t}))).sort((a,b) => byNew(a.f, b.f));
  const filesN = own.length + fromTasks.length;
  return `<button class="btn ghost sm back" data-act="back">← Все предметы</button>
    <div class="detail-head"><span class="inst-tag c-${esc(i?.color || 'blue')}">${esc(i?.name || '')}</span><h2>${esc(s.name)}</h2>
      <div class="actions"><button class="btn primary" data-act="new-task" data-subject="${esc(s.id)}">+ Задание</button><button class="btn" data-act="edit-subject" data-id="${esc(s.id)}">Редактировать</button></div></div>
    <dl class="dl">
      <div><dt>Статус</dt><dd>${s.status === 'passed' ? 'Сдал' : 'Готовлю'}</dd></div>
      <div><dt>Форма контроля</dt><dd>${esc(s.control || 'не указана')}</dd></div>
      <div><dt>Дата сдачи</dt><dd>${s.date ? fmt(s.date, true) : 'не указана'}</dd></div>
      <div><dt>Оценка</dt><dd>${esc(s.grade || 'нет')}</dd></div>
      <div><dt>Преподаватель</dt><dd>${esc(s.teacher || 'не указан')}</dd></div>
    </dl>
    ${s.notes ? `<section class="section"><h3>Заметки</h3><div class="card prose">${esc(s.notes)}</div></section>` : ''}
    ${exams.length ? `<section class="section"><h3>В расписании сессий</h3><div class="card"><div class="mini-exams">${exams.map(e => `<div><span class="mono">${fmt(e.date) || 'дата?'}</span><span>${esc(e.kind || '')}${e.time ? ', ' + esc(e.time) : ''}${e.place ? ', ' + esc(e.place) : ''} <span class="muted">(${esc(e.session || 'сессия')})</span></span></div>`).join('')}</div></div></section>` : ''}
    <section class="section"><h3 class="sec-title">Задания <span class="count">${tasks.length}</span></h3>
      ${tasks.length ? taskList(tasks, {subject:false}) : `<div class="empty">По этому предмету заданий пока нет.<button class="btn sm" data-act="new-task" data-subject="${esc(s.id)}">+ Задание</button></div>`}</section>
    <section class="section"><h3 class="sec-title">Файлы <span class="count">${filesN}</span></h3>
      ${uploadBlock('sf-input')}
      ${filesN ? `<div class="files">${own.map(f => fileRow(f, {caption:f.caption, edit:true})).join('')}${fromTasks.map(({f, t}) => fileRow(f, {caption:[f.caption, 'из задания «' + (t.title || 'Без названия') + '»'].filter(Boolean).join(' · '), edit:true})).join('')}</div>` : '<div class="empty">Конспекты лекций, сделанные домашние задания и другие материалы по предмету. Файлы, прикреплённые к заданиям, тоже появятся здесь.</div>'}
    </section>`;
}

/* ---------- Задания ---------- */
function vTasks(){
  const f = UI.f;
  const instOpts = sortedInst().map(i => `<option value="${esc(i.id)}"${f.inst === i.id ? ' selected' : ''}>${esc(i.name)}</option>`).join('');
  const subjPool = f.inst ? subjectsOf(f.inst) : sortedSubjects();
  if(f.subj && !subjPool.some(s => s.id === f.subj)) f.subj = '';
  const subjOpts = subjPool.map(s => `<option value="${esc(s.id)}"${f.subj === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  const stOpts = [['open','Все несделанные'],['all','Все задания'],['overdue','Просроченные'],...ORDER.map(k => [k, STATUS[k].l])]
    .map(([v,l]) => `<option value="${v}"${f.st === v ? ' selected' : ''}>${l}</option>`).join('');
  let list = S.tasks.filter(t => {
    const s = subjOf(t.subjectId);
    if(f.inst && (!s || s.instId !== f.inst)) return false;
    if(f.subj && t.subjectId !== f.subj) return false;
    if(f.st === 'open') return t.status !== 'done';
    if(f.st === 'overdue') return isOverdue(t);
    if(f.st !== 'all') return t.status === f.st;
    return true;
  }).sort(taskSort);
  return `<div class="page-head"><h2>Задания</h2><span class="grow"></span><button class="btn primary" data-act="new-task" ${f.subj ? `data-subject="${esc(f.subj)}"` : ''}>+ Задание</button></div>
    <div class="filters">
      <label>Заведение<select id="f-inst" data-filter="inst"><option value="">Все</option>${instOpts}</select></label>
      <label>Предмет<select id="f-subj" data-filter="subj"><option value="">Все</option>${subjOpts}</select></label>
      <label>Статус<select id="f-st" data-filter="st">${stOpts}</select></label>
    </div>
    ${list.length ? taskList(list) : `<div class="empty">${S.tasks.length ? 'Под эти фильтры заданий нет.' : 'Заданий пока нет. Запишите первое, что вам задали.'}</div>`}
    <p class="hint" style="margin-top:10px">Чтобы сменить статус, нажмите на цветную метку и выберите нужный из списка.</p>`;
}

/* ---------- Сессии ---------- */
const examSort = (a,b) => (a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1 : (a.time || '') < (b.time || '') ? -1 : 1;
const sessRange = s => s.start ? `с ${fmtNum(s.start)}${s.end ? ' по ' + fmtNum(s.end) : ''}` : 'даты не указаны';
function vSessions(){
  const t = todayISO();
  const all = [...S.sessions].sort((a,b) => (a.start || '') < (b.start || '') ? -1 : 1);
  const active = all.filter(s => !s.start || (s.end || s.start) >= t);
  const past = all.filter(s => s.start && (s.end || s.start) < t).reverse();
  const head = `<div class="page-head"><h2>Сессии</h2><span class="grow"></span><button class="btn primary" data-act="new-session">+ Сессия</button></div>`;
  if(!all.length) return head + `<div class="empty">Сессий пока нет. Добавьте сессию с датами начала и конца, затем внесите в неё экзамены и зачёты.<button class="btn sm" data-act="new-session">+ Сессия</button></div>`;
  return head + `<div class="sessions">${active.map(sessCard).join('') || '<div class="empty">Предстоящих сессий нет.</div>'}</div>
    ${past.length ? `<details class="past-list"><summary>Прошедшие сессии (${past.length})</summary><div class="sessions">${past.map(sessCard).join('')}</div></details>` : ''}`;
}
function sessCard(s){
  const i = instOf(s.instId), cd = countdownOf(s);
  const ex = [...(s.exams || [])].sort(examSort);
  return `<article class="card session">
    <div class="sess-head"><div><span class="inst-tag c-${esc(i?.color || 'blue')}">${esc(i?.name || 'Заведение удалено')}</span><h3>${esc(s.title || 'Сессия')}</h3><p class="muted">${sessRange(s)}</p></div>
      <div class="countdown${cd.now ? ' now' : ''}"><b>${cd.n}</b><span>${cd.l}</span></div></div>
    ${ex.length ? `<div class="exams">${ex.map(e => {
        const sub = subjOf(e.subjectId);
        const pastE = e.date && e.date < todayISO();
        return `<div class="exam${pastE ? ' past' : ''}"><div class="when">${e.date ? fmt(e.date, true) : 'дата?'}<small>${esc(e.time || '')}</small></div>
          <div class="what"><b>${esc(sub?.name || e.subjectName || 'Предмет не выбран')}</b><span>${esc(e.kind || '')}${e.place ? ' · ' + esc(e.place) : ''}${e.date && !pastE ? ' · ' + rel(e.date) : ''}</span></div>
          <button class="btn sm ghost" data-act="edit-exam" data-session="${esc(s.id)}" data-id="${esc(e.id)}">Изменить</button></div>`;
      }).join('')}</div>` : '<p class="muted">Экзамены и зачёты пока не внесены.</p>'}
    <div class="card-foot"><button class="btn sm" data-act="new-exam" data-session="${esc(s.id)}">+ Экзамен или зачёт</button><button class="btn sm ghost" data-act="edit-session" data-id="${esc(s.id)}">Изменить сессию</button></div>
  </article>`;
}

/* ---------- Диплом ---------- */
function thesisList(){ return [...S.theses].sort((a,b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); }
function curThesis(){ const l = thesisList(); return l.find(t => t.id === UI.thesisId) || l[0] || null; }
const ofThesis = (key, t) => t ? S[key].filter(x => x.thesisId === t.id) : [];
function thesisLabel(t, n){ const i = t.instId ? instOf(t.instId) : null; return i ? i.name : 'Диплом ' + (n + 1); }
function chapters(){
  const t = curThesis(), set = new Set();
  ofThesis('stages', t).forEach(s => s.title && set.add(s.title));
  ofThesis('notes', t).forEach(n => n.chapter && set.add(n.chapter));
  return [...set];
}
function vThesis(){
  const th = curThesis();
  if(!th) return `<div class="page-head"><h2>Дипломная работа</h2></div><div class="empty"><b>Дипломов пока нет.</b><span>Добавьте работу: тему, руководителя, сроки. Потом здесь появятся план по этапам, заметки и файлы. Если дипломов несколько, у каждого будет своя вкладка.</span><button class="btn primary" data-act="new-thesis">+ Диплом</button></div>`;
  const i = th.instId ? instOf(th.instId) : null;
  const stages = ofThesis('stages', th).sort(taskSort), sd = stages.filter(x => x.status === 'done').length;
  const chs = chapters();
  const files = ofThesis('att', th).sort((a,b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const notesN = ofThesis('notes', th).length;
  const dd = (iso) => iso ? `${fmt(iso, true)}<small>${rel(iso)}</small>` : 'не указано';
  const sw = `<div class="th-switch" role="group" aria-label="Дипломные работы">${thesisList().map((t, n) => {
      const ii = t.instId ? instOf(t.instId) : null;
      return `<button class="th-pill" data-act="pick-thesis" data-id="${esc(t.id)}" aria-pressed="${t.id === th.id}">${ii ? `<i class="dot c-${esc(ii.color || 'blue')}"></i>` : ''}${esc(thesisLabel(t, n))}${t.topic ? `<span class="t">${esc(t.topic)}</span>` : ''}</button>`;
    }).join('')}<button class="btn sm ghost" data-act="new-thesis">+ Диплом</button></div>`;
  return sw + `<section class="card thesis-hero">
      <p class="eyebrow">Дипломная работа${i ? ' · ' + esc(i.name) : ''}</p>
      <h2 class="thesis-topic${th.topic ? '' : ' placeholder'}">${esc(th.topic || 'Тема пока не указана')}</h2>
      <dl class="thesis-meta">
        <div><dt>Научный руководитель</dt><dd>${esc(th.advisor || 'не указан')}</dd></div>
        <div><dt>Сдача работы</dt><dd>${dd(th.submit)}</dd></div>
        <div><dt>Защита</dt><dd>${dd(th.defense)}</dd></div>
      </dl>
      <div><button class="btn sm" data-act="edit-thesis" data-id="${esc(th.id)}">Изменить</button></div>
    </section>
    <div class="thesis-grid">
      <section class="section"><h3 class="sec-title">План по этапам <span class="count">${sd} из ${stages.length}</span></h3>
        ${stages.length ? bar(sd, stages.length) + `<div class="list">${stages.map(stageRow).join('')}</div>` : '<div class="empty">Разбейте работу на этапы: введение, главы, список литературы, предзащита.</div>'}
        <div><button class="btn sm" data-act="new-stage">+ Этап</button></div>
      </section>
      <section class="section"><h3 class="sec-title">Файлы <span class="count">${files.length}</span></h3>
        ${uploadBlock('tf-input')}
        ${files.length ? `<div class="files">${files.map(f => fileRow(f, {caption:f.caption, edit:true})).join('')}</div>` : '<div class="empty">Черновики, статьи и материалы к работе.</div>'}
      </section>
    </div>
    <section class="section"><h3 class="sec-title">Мысли и идеи <span class="count">${notesN}</span></h3>
      <div class="card composer">
        <textarea id="n-text" rows="3" placeholder="Запишите мысль, идею, цитату или вопрос к руководителю">${esc(UI.noteDraft)}</textarea>
        <div class="composer-row"><input type="text" id="n-ch" list="ch-list" placeholder="К какой главе (необязательно)" value="${esc(UI.noteCh)}"><button class="btn primary" data-act="add-note">Добавить запись</button></div>
        <datalist id="ch-list">${chs.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="filters">
        <label>Поиск по тексту<input type="search" id="n-q" value="${esc(UI.q)}" placeholder="Слово или фраза"></label>
        <label>Глава<select id="n-chf"><option value="">Все</option>${chs.map(c => `<option value="${esc(c)}"${UI.ch === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      </div>
      <div class="notes" id="notes-list">${notesList()}</div>
    </section>`;
}
function stageRow(s){
  return `<div class="row${isOverdue(s) ? ' is-overdue' : ''}${s.status === 'done' ? ' is-done' : ''}">${chip('stages', s.id, s.status)}
    <button class="row-main" data-act="edit-stage" data-id="${esc(s.id)}"><span class="row-title">${esc(s.title || 'Этап')}</span></button>
    <span class="row-due">${s.due ? dueHTML(s) : '<span class="muted">без срока</span>'}</span></div>`;
}
function highlight(text, q){
  if(!q) return esc(text);
  const lower = text.toLowerCase(), ql = q.toLowerCase();
  let out = '', i = 0, j;
  while((j = lower.indexOf(ql, i)) !== -1){ out += esc(text.slice(i, j)) + '<mark>' + esc(text.slice(j, j + q.length)) + '</mark>'; i = j + q.length; }
  return out + esc(text.slice(i));
}
function notesList(){
  const q = UI.q.trim().toLowerCase();
  const all = ofThesis('notes', curThesis());
  const list = all.filter(n => (!UI.ch || n.chapter === UI.ch) && (!q || (String(n.text || '') + ' ' + String(n.chapter || '')).toLowerCase().includes(q)))
    .sort((a,b) => (b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : (b.createdAt ?? 0) - (a.createdAt ?? 0));
  if(!list.length) return `<div class="empty">${all.length ? 'Ничего не нашлось.' : 'Записей пока нет. Первая мысль пойдёт сюда.'}</div>`;
  return list.map(n => `<article class="note"><div class="note-head"><span class="mono">${fmt(n.date, true)}</span>${n.chapter ? `<span class="tag">${highlight(n.chapter, UI.q.trim())}</span>` : ''}<span class="grow"></span><button class="btn sm ghost" data-act="edit-note" data-id="${esc(n.id)}">Изменить</button></div><div class="note-text">${highlight(String(n.text || ''), UI.q.trim())}</div></article>`).join('');
}

/* ---------- Файлы ---------- */
function uploadBlock(inputId){
  return `<div class="upload"><input type="file" id="${inputId}" multiple accept="${ALLOWED.map(x => '.' + x).join(',')}"><label class="btn sm" for="${inputId}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9"/></svg>Прикрепить файл</label><span class="hint">PDF, Word, Excel, фото и другие, до 20 МБ</span></div>`;
}
function fileRow(f, o = {}){
  const ext = (f.ext || String(f.name || '').split('.').pop() || '').slice(0, 4);
  const when = f.createdAt ? fmt(new Date(f.createdAt).toISOString().slice(0,10)) : '';
  const meta = [o.caption ? esc(o.caption) : '', f.size ? fsize(f.size) : '', when].filter(Boolean).join(' · ');
  const kind = viewKind(f);
  const id = esc(f.id);
  const openBtn = kind ? `<button type="button" class="btn sm ghost" data-act="view" data-key="${id}">Открыть</button>` : '';
  const nameEl = kind ? `<button type="button" class="fname" data-act="view" data-key="${id}">${esc(f.name)}</button>` : `<b>${esc(f.name)}</b>`;
  return `<div class="file"><span class="file-ext">${esc(ext)}</span><div class="file-main">${nameEl}${meta ? `<span>${meta}</span>` : ''}</div>
    <div class="file-acts">${openBtn}<button type="button" class="btn sm ghost" data-act="dl" data-key="${id}">Скачать</button>${o.edit ? `<button type="button" class="btn sm ghost" data-act="edit-att" data-id="${id}">Подпись</button>` : ''}<button type="button" class="btn sm ghost danger" data-act="del-att" data-key="${id}">Удалить</button></div></div>`;
}
async function uploadFile(file, link){
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if(!ALLOWED.includes(ext)) throw new Error(`Формат .${ext || '?'} не поддерживается. Сохраните файл как PDF или DOCX.`);
  if(file.size > MAX_FILE) throw new Error(`«${file.name}» больше 20 МБ.`);
  const fd = new FormData();
  fd.append('id', newId());
  fd.append('owner', me().id);
  fd.append('name', file.name);
  fd.append('ext', ext);
  fd.append('caption', '');
  fd.append('createdAt', String(Date.now()));
  if(link.taskId) fd.append('taskId', link.taskId);
  if(link.thesisId) fd.append('thesisId', link.thesisId);
  if(link.subjectId) fd.append('subjectId', link.subjectId);
  fd.append('file', file);
  const rec = await pb.collection('attachments').create(fd);
  upsert('att', rec);
  return rec;
}
const uploadErr = e => errText(e);
function viewKind(f){
  const ext = String(f.ext || String(f.name || '').split('.').pop() || '').toLowerCase();
  if(ext === 'pdf') return 'pdf';
  if(ext === 'docx') return 'docx';
  if(['png','jpg','jpeg','gif','webp'].includes(ext)) return 'img';
  if(['txt','md','csv'].includes(ext)) return 'text';
  return '';
}
async function fileUrl(f, download){
  const token = await pb.files.getToken();
  const q = {token};
  if(download) q.download = 1;
  return pb.files.getURL(f, f.file, q);
}
async function getBlob(f){
  const res = await fetch(await fileUrl(f));
  if(!res.ok) throw new Error('Файл не найден на сервере.');
  return await res.blob();
}
const libs = {};
function loadLib(src, global){
  if(window[global]) return Promise.resolve(window[global]);
  if(!libs[src]) libs[src] = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = () => window[global] ? res(window[global]) : rej(new Error('Модуль не загрузился.'));
    sc.onerror = () => { delete libs[src]; rej(new Error('Не удалось загрузить модуль. Проверьте интернет.')); };
    document.head.appendChild(sc);
  });
  return libs[src];
}
const viewer = $('#viewer');
let viewing = null;
let pdfView = null; // открытый PDF: документ и наблюдатель за страницами
function closePdf(){ if(pdfView){ pdfView.obs.disconnect(); pdfView.doc.destroy(); pdfView = null; } $('#v-body').classList.remove('is-pdf'); }
$('#v-close').addEventListener('click', () => viewer.close());
$('#v-dl').addEventListener('click', () => viewing && downloadFile(viewing));
viewer.addEventListener('close', () => { viewing = null; closePdf(); $('#v-body').innerHTML = ''; });
// PDF показываем сами через pdf.js: сервер отдаёт файлы с CSP sandbox, и встроенный
// просмотрщик Chrome в новой вкладке не запускается (пустая вкладка и скачивание).
async function loadPdfJs(){
  const lib = await import('/vendor/pdfjs/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  return lib;
}
async function showPdf(f, body){
  const [lib, blob] = await Promise.all([loadPdfJs(), getBlob(f)]);
  const doc = await lib.getDocument({data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true}).promise;
  if(viewing !== f){ doc.destroy(); return; }
  const first = (await doc.getPage(1)).getViewport({scale: 1});
  body.classList.add('is-pdf');
  body.innerHTML = Array.from({length: doc.numPages}, (_, n) => `<div class="pdf-page" data-n="${n + 1}" style="aspect-ratio:${first.width}/${first.height}"><span>${n + 1}</span></div>`).join('');
  // Страницы рисуются, когда до них доходит прокрутка: большой файл не съест память телефона
  const draw = async el => {
    const page = await doc.getPage(+el.dataset.n);
    const vp1 = page.getViewport({scale: 1});
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({scale: el.clientWidth / vp1.width * ratio});
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    el.style.aspectRatio = `${vp1.width}/${vp1.height}`;
    await page.render({canvasContext: cv.getContext('2d'), viewport: vp}).promise;
    el.replaceChildren(cv);
  };
  const obs = new IntersectionObserver(entries => entries.forEach(e => {
    if(!e.isIntersecting) return;
    obs.unobserve(e.target);
    draw(e.target).catch(() => { e.target.textContent = 'Страница не открылась'; });
  }), {root: body, rootMargin: '600px 0px'});
  pdfView = {doc, obs};
  body.querySelectorAll('.pdf-page').forEach(el => obs.observe(el));
}
async function openViewer(f){
  const kind = viewKind(f);
  closePdf();
  viewing = f;
  $('#v-title').textContent = f.name;
  const body = $('#v-body');
  body.innerHTML = '<div class="v-msg">Открываю файл…</div>';
  if(!viewer.open) viewer.showModal();
  try{
    if(kind === 'pdf'){ await showPdf(f, body); return; }
    if(kind === 'img'){ const url = await fileUrl(f); if(viewing === f) body.innerHTML = `<img class="v-img" src="${esc(url)}" alt="${esc(f.name)}">`; return; }
    if(kind === 'text'){ const t = await (await getBlob(f)).text(); if(viewing === f) body.innerHTML = `<pre class="v-text">${esc(t)}</pre>`; return; }
    if(kind === 'docx'){
      const [m, blob] = await Promise.all([loadLib('/vendor/mammoth.browser.min.js', 'mammoth'), getBlob(f)]);
      const r = await m.convertToHtml({arrayBuffer: await blob.arrayBuffer()});
      if(viewing !== f) return;
      const html = (r.value || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=/gi, ' data-x=');
      body.innerHTML = html.trim() ? `<article class="doc-view">${html}</article>` : '<div class="v-msg">Документ пустой.</div>';
      return;
    }
    body.innerHTML = '<div class="v-msg">Этот формат здесь не просматривается. Скачайте файл и откройте его на устройстве.</div>';
  }catch(e){
    if(viewing === f) body.innerHTML = `<div class="v-msg">${esc(errText(e))}<span>Попробуйте скачать файл кнопкой вверху.</span></div>`;
  }
}
async function downloadFile(f){
  try{
    const url = await fileUrl(f, true);
    const a = document.createElement('a');
    a.href = url; a.download = f.name || 'file'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }catch(e){ toast(errText(e)); }
}
async function deleteAttachment(f){ await col('att').doc(f.id).delete(); }

/* ---------- Диалог с формой ---------- */
const dlg = $('#dlg'), form = $('#dlg-form');
let cur = null;
function fieldHTML(fd, v){
  const id = 'fld-' + fd.key, val = v ?? '';
  const req = fd.required ? ' <i>*</i>' : '';
  let input;
  if(fd.type === 'textarea') input = `<textarea id="${id}" rows="${fd.rows || 3}" placeholder="${esc(fd.placeholder || '')}">${esc(val)}</textarea>`;
  else if(fd.type === 'select') input = `<select id="${id}">${(fd.options || []).map(([k,l]) => `<option value="${esc(k)}"${String(val) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if(fd.type === 'seg') {
    return `<div class="fld"><span>${esc(fd.label)}</span><div class="seg" role="radiogroup" aria-label="${esc(fd.label)}">${fd.options.map(([k,l,cls], n) =>
      `<input type="radio" name="${id}" id="${id}-${n}" value="${esc(k)}"${String(val) === String(k) ? ' checked' : ''}><label for="${id}-${n}">${cls ? `<span class="dot ${cls}"></span>` : ''}${esc(l)}</label>`).join('')}</div></div>`;
  }
  else input = `<input type="${fd.type || 'text'}" id="${id}" value="${esc(val)}" placeholder="${esc(fd.placeholder || '')}"${fd.list ? ` list="${fd.list}"` : ''}>`;
  return `<label class="fld${fd.half ? ' half' : ''}" for="${id}"><span>${esc(fd.label)}${req}</span>${input}</label>`;
}
function openForm(o){
  cur = {...o, saved:false};
  form.innerHTML = `<div class="dlg-head"><h2>${esc(o.title)}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">×</button></div>
    <div class="dlg-body">${o.fields.map(fd => fieldHTML(fd, (o.values || {})[fd.key])).join('')}${o.extra ? `<div class="dlg-extra" id="dlg-extra">${o.extra}</div>` : ''}</div>
    <p class="dlg-err" id="dlg-err" hidden></p>
    <div class="dlg-foot">${o.onDelete ? `<button type="button" class="btn ghost danger" id="dlg-del">${esc(o.deleteLabel || 'Удалить')}</button>` : ''}<span class="grow"></span><button type="button" class="btn ghost" data-close>Отмена</button><button type="submit" class="btn primary" id="dlg-ok">${esc(o.submit || 'Сохранить')}</button></div>`;
  if(!dlg.open) dlg.showModal();
  o.onOpen && o.onOpen();
  const first = form.querySelector('.dlg-body input:not([type=radio]):not([type=file]), .dlg-body textarea');
  if(first && window.matchMedia('(min-width: 761px)').matches) first.focus();
}
function formErr(msg){ const p = $('#dlg-err'); if(!p) return; p.textContent = msg; p.hidden = !msg; }
function collect(){
  const v = {};
  for(const fd of cur.fields){
    if(fd.type === 'seg'){ const r = form.querySelector(`input[name="fld-${fd.key}"]:checked`); v[fd.key] = r ? r.value : ''; }
    else { const el = form.querySelector('#fld-' + fd.key); v[fd.key] = el ? el.value.trim() : ''; }
  }
  return v;
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  if(!cur) return;
  const v = collect();
  const miss = cur.fields.find(fd => fd.required && !v[fd.key]);
  if(miss){ formErr(`Заполните поле «${miss.label}».`); return; }
  const ok = $('#dlg-ok'); ok.disabled = true; formErr('');
  try { await cur.onSave(v); cur.saved = true; dlg.close(); }
  catch(err){ formErr(dbErr(err)); }
  finally { ok.disabled = false; }
});
form.addEventListener('click', async e => {
  if(e.target.closest('[data-close]')){ dlg.close(); return; }
  const del = e.target.closest('#dlg-del');
  if(del){
    if(!arm(del, cur.confirmText || 'Нажмите ещё раз, чтобы удалить')) return;
    del.disabled = true;
    try { const r = await cur.onDelete(); if(r === false){ del.disabled = false; return; } cur.saved = true; dlg.close(); }
    catch(err){ formErr(dbErr(err)); del.disabled = false; }
  }
});
dlg.addEventListener('close', () => { const c = cur; cur = null; c && c.onClose && c.onClose(c.saved); });
function arm(btn, text){
  if(btn.dataset.armed === '1') return true;
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = text;
  setTimeout(() => { if(btn.isConnected){ btn.dataset.armed = ''; btn.textContent = old; } }, 3500);
  return false;
}
const FIELD_RU = {email:'почта', password:'пароль', passwordConfirm:'повтор пароля', oldPassword:'текущий пароль', name:'название', title:'название', text:'текст', file:'файл', code:'код'};
function errText(e){
  if(!e) return 'Неизвестная ошибка.';
  if(e.isAbort) return 'Запрос прерван.';
  if(e.status === 0) return 'Нет связи с сервером. Проверьте интернет.';
  const r = e.response || {};
  const msg = r.message || e.message || '';
  if(/[а-яё]/i.test(msg)) return msg;
  const data = r.data || {};
  const keys = Object.keys(data);
  if(e.status === 400 && keys.length){
    if(data.email && data.email.code === 'validation_not_unique') return 'Этот адрес почты уже зарегистрирован.';
    if(data.password && /length/.test(data.password.code || '')) return 'Пароль должен быть не короче 8 символов.';
    if(data.passwordConfirm) return 'Пароли не совпадают.';
    if(data.oldPassword) return 'Текущий пароль введён неверно.';
    if(data.file) return 'Файл не принят: проверьте формат и размер (до 20 МБ).';
    return 'Проверьте поля: ' + keys.map(k => FIELD_RU[k] || k).join(', ') + '.';
  }
  if(e.status === 401 || e.status === 403) return 'Нет доступа. Войдите заново.';
  if(e.status === 404) return 'Запись не найдена: возможно, её уже удалили.';
  if(e.status === 413) return 'Файл слишком большой.';
  if(e.status === 429) return 'Слишком много запросов подряд. Подождите немного.';
  return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}
const dbErr = errText;

/* ---------- Формы сущностей ---------- */
const colorSeg = () => Object.entries(COLORS).map(([k,l]) => [k, l, 'c-' + k]);
function openInst(id){
  const i = id ? instOf(id) : null;
  openForm({ title: i ? 'Учебное заведение' : 'Новое учебное заведение',
    fields:[{key:'name', label:'Название', required:true, placeholder:'Например: ТОГУ'}, {key:'color', label:'Цвет', type:'seg', options:colorSeg()}],
    values: i || {color: Object.keys(COLORS)[S.inst.length % 5]},
    async onSave(v){ if(i) await col('inst').doc(i.id).update(v); else await col('inst').doc().set({...v, order:Date.now(), createdAt:Date.now()}); toast('Сохранено'); },
    onDelete: i ? async () => {
      const n = subjectsOf(i.id).length + S.sessions.filter(s => s.instId === i.id).length;
      if(n){ formErr('Сначала удалите или перенесите предметы и сессии этого заведения.'); return false; }
      await col('inst').doc(i.id).delete(); toast('Заведение удалено');
    } : null });
}
function openSubject(id, instId){
  const s = id ? subjOf(id) : null;
  if(!S.inst.length){ openInst(); return; }
  const tasksN = s ? S.tasks.filter(t => t.subjectId === s.id).length : 0;
  const filesN = s ? S.att.filter(a => a.subjectId === s.id).length : 0;
  openForm({ title: s ? 'Предмет' : 'Новый предмет',
    fields:[
      {key:'name', label:'Название', required:true},
      {key:'instId', label:'Учебное заведение', type:'select', options: sortedInst().map(i => [i.id, i.name])},
      {key:'control', label:'Форма контроля', type:'select', options:[['','Не указана'], ...CONTROLS.map(c => [c,c])]},
      {key:'status', label:'Статус', type:'seg', options:[['prep','Готовлю'],['passed','Сдал']]},
      {key:'date', label:'Дата сдачи', type:'date', half:true},
      {key:'grade', label:'Оценка', half:true, placeholder:'отлично, зачтено, 5'},
      {key:'teacher', label:'Преподаватель', placeholder:'ФИО'},
      {key:'notes', label:'Заметки', type:'textarea'}],
    values: s || {instId: instId || sortedInst()[0].id, status:'prep'},
    async onSave(v){ if(s) await col('subjects').doc(s.id).update(v); else await col('subjects').doc().set({...v, order:Date.now(), createdAt:Date.now()}); toast('Предмет сохранён'); },
    confirmText: tasksN || filesN ? `Удалить вместе с ${[tasksN ? `заданиями (${tasksN})` : '', filesN ? `файлами (${filesN})` : ''].filter(Boolean).join(' и ')}?` : 'Нажмите ещё раз, чтобы удалить',
    onDelete: s ? async () => {
      const taskIds = new Set(S.tasks.filter(t => t.subjectId === s.id).map(t => t.id));
      await col('subjects').doc(s.id).delete();
      S.tasks = S.tasks.filter(t => !taskIds.has(t.id));
      S.att = S.att.filter(a => !taskIds.has(a.taskId) && a.subjectId !== s.id);
      if(UI.subjectId === s.id) UI.subjectId = null;
      toast('Предмет удалён');
    } : null });
}
function openTask(id, subjectId){
  if(!S.subjects.length){ toast('Сначала добавьте предмет.'); openSubject(); return; }
  let t = id ? byId('tasks', id) : null;
  const ref = t ? col('tasks').doc(t.id) : col('tasks').doc();
  const renderFiles = () => {
    const box = $('#task-files'); if(!box) return;
    const files = S.att.filter(f => f.taskId === ref.id).sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0));
    box.innerHTML = files.length ? files.map(f => fileRow(f)).join('') : `<p class="hint">${t ? 'Файлов пока нет.' : 'Файл можно прикрепить сразу: задание сохранится автоматически.'}</p>`;
  };
  openForm({ title: t ? 'Задание' : 'Новое задание',
    fields:[
      {key:'title', label:'Название', required:true, placeholder:'Например: эссе по теме 3'},
      {key:'subjectId', label:'Предмет', type:'select', options: sortedSubjects().map(s => [s.id, `${s.name} (${instOf(s.instId)?.name || '?'})`])},
      {key:'body', label:'Что задано', type:'textarea', rows:4},
      {key:'issued', label:'Дата выдачи', type:'date', half:true},
      {key:'due', label:'Срок выполнения', type:'date', half:true},
      {key:'status', label:'Статус', type:'seg', options: ORDER.map(k => [k, STATUS[k].l])},
      {key:'notes', label:'Заметки', type:'textarea', rows:2}],
    values: t || {status:'todo', issued: todayISO(), subjectId: subjectId || UI.subjectId || UI.f.subj || sortedSubjects()[0].id},
    extra: `<h3>Файлы</h3>${uploadBlock('task-input')}<div class="files" id="task-files"></div>`,
    refresh: renderFiles,
    onOpen(){
      renderFiles();
      const inp = $('#task-input');
      inp && inp.addEventListener('change', async () => {
        const list = [...inp.files]; inp.value = '';
        if(!list.length) return;
        if(!t){
          const v = collect();
          if(!v.title){ formErr('Сначала введите название задания, потом прикрепляйте файлы.'); return; }
          try { t = await ref.set({...v, createdAt: Date.now()}); $('#dlg-form h2').textContent = 'Задание'; }
          catch(e){ formErr(errText(e)); return; }
        }
        for(const file of list){
          toast(`Загружаю «${file.name}»…`);
          try { await uploadFile(file, {taskId: ref.id}); renderFiles(); toast('Файл прикреплён'); }
          catch(e){ formErr(uploadErr(e)); }
        }
      });
      $('#task-files').addEventListener('click', async e => {
        const b = e.target.closest('[data-act]'); if(!b) return;
        e.stopPropagation();
        const f = byId('att', b.dataset.key); if(!f) return;
        if(b.dataset.act === 'dl') return downloadFile(f);
        if(b.dataset.act === 'view') return openViewer(f);
        if(b.dataset.act === 'del-att'){
          if(!arm(b, 'Точно?')) return;
          try { await deleteAttachment(f); renderFiles(); toast('Файл удалён'); } catch(err){ formErr(errText(err)); }
        }
      });
    },
    async onSave(v){
      if(t) await ref.update(v); else await ref.set({...v, createdAt:Date.now()});
      toast('Задание сохранено');
    },
    onDelete: id ? async () => { await ref.delete(); S.att = S.att.filter(a => a.taskId !== ref.id); toast('Задание удалено'); } : null
  });
}
function openSession(id){
  const s = id ? byId('sessions', id) : null;
  if(!S.inst.length){ openInst(); return; }
  openForm({ title: s ? 'Сессия' : 'Новая сессия',
    fields:[
      {key:'instId', label:'Учебное заведение', type:'select', options: sortedInst().map(i => [i.id, i.name])},
      {key:'title', label:'Название', required:true, placeholder:'Зимняя сессия 2026/27'},
      {key:'start', label:'Начало', type:'date', half:true, required:true},
      {key:'end', label:'Конец', type:'date', half:true}],
    values: s || {instId: sortedInst()[0].id},
    async onSave(v){
      if(v.end && v.end < v.start) throw new Error('Дата конца раньше даты начала.');
      if(s) await col('sessions').doc(s.id).update(v); else await col('sessions').doc().set({...v, exams:[], createdAt:Date.now()});
      toast('Сессия сохранена');
    },
    onDelete: s ? async () => { await col('sessions').doc(s.id).delete(); toast('Сессия удалена'); } : null });
}
function openExam(sessionId, examId){
  const s = byId('sessions', sessionId); if(!s) return;
  const exams = (s.exams || []).map(e => ({...e}));
  const e = examId ? exams.find(x => x.id === examId) : null;
  const pool = subjectsOf(s.instId);
  openForm({ title: e ? 'Экзамен или зачёт' : 'Новый экзамен или зачёт',
    fields:[
      {key:'subjectId', label:'Предмет', type:'select', options: pool.length ? pool.map(x => [x.id, x.name]) : [['', 'Нет предметов в этом заведении']]},
      {key:'kind', label:'Вид', type:'seg', options: EXAM_KINDS.map(k => [k,k])},
      {key:'date', label:'Дата', type:'date', half:true, required:true},
      {key:'time', label:'Время', type:'time', half:true},
      {key:'place', label:'Место', placeholder:'Аудитория, корпус или ссылка'}],
    values: e || {kind: pool[0]?.control && EXAM_KINDS.includes(pool[0].control) ? pool[0].control : 'Экзамен', date: s.start || ''},
    async onSave(v){
      let next;
      if(e) next = exams.map(x => x.id === e.id ? {...x, ...v} : x);
      else next = [...exams, {...v, id: 'e' + Date.now().toString(36)}];
      await col('sessions').doc(s.id).update({exams: next});
      toast('Сохранено');
    },
    onDelete: e ? async () => { await col('sessions').doc(s.id).update({exams: exams.filter(x => x.id !== e.id)}); toast('Удалено'); } : null });
}
function openThesis(id){
  const th = id ? byId('theses', id) : null;
  const ref = th ? col('theses').doc(th.id) : col('theses').doc();
  const used = new Set(thesisList().map(t => t.instId).filter(Boolean));
  const freeInst = sortedInst().find(i => !used.has(i.id));
  const counts = th ? ['stages','notes','att'].reduce((a, c) => a + ofThesis(c, th).length, 0) : 0;
  openForm({ title: th ? 'Дипломная работа' : 'Новая дипломная работа',
    fields:[
      {key:'topic', label:'Тема', type:'textarea', rows:2},
      {key:'advisor', label:'Научный руководитель'},
      {key:'instId', label:'Учебное заведение', type:'select', options:[['', 'Не указано'], ...sortedInst().map(i => [i.id, i.name])]},
      {key:'submit', label:'Срок сдачи работы', type:'date', half:true},
      {key:'defense', label:'Дата защиты', type:'date', half:true}],
    values: th || {instId: freeInst ? freeInst.id : ''},
    async onSave(v){
      if(th) await ref.update(v); else await ref.set({...v, createdAt: Date.now()});
      UI.thesisId = ref.id; saveLS('thesis', ref.id);
      toast('Сохранено');
    },
    confirmText: counts ? 'Удалить вместе с этапами, заметками и файлами?' : 'Нажмите ещё раз, чтобы удалить',
    onDelete: th ? async () => {
      await ref.delete();
      for(const c of ['stages','notes','att']) S[c] = S[c].filter(x => x.thesisId !== th.id);
      UI.thesisId = ''; saveLS('thesis', '');
      toast('Диплом удалён');
    } : null });
}
function openStage(id){
  const s = id ? byId('stages', id) : null;
  const th = curThesis(); if(!s && !th){ openThesis(null); return; }
  openForm({ title: s ? 'Этап' : 'Новый этап',
    fields:[{key:'title', label:'Этап', required:true, placeholder:'Глава 1. Теоретические основы'}, {key:'due', label:'Срок', type:'date', half:true}, {key:'status', label:'Статус', type:'seg', options: ORDER.map(k => [k, STATUS[k].l])}],
    values: s || {status:'todo'},
    async onSave(v){ if(s) await col('stages').doc(s.id).update(v); else await col('stages').doc().set({...v, thesisId: th.id, createdAt:Date.now()}); toast('Сохранено'); },
    onDelete: s ? async () => { await col('stages').doc(s.id).delete(); toast('Этап удалён'); } : null });
}
function openNote(id){
  const n = byId('notes', id); if(!n) return;
  openForm({ title:'Запись',
    fields:[{key:'text', label:'Текст', type:'textarea', rows:6, required:true}, {key:'chapter', label:'Глава', list:'ch-list'}, {key:'date', label:'Дата', type:'date', half:true}],
    values: n,
    async onSave(v){ await col('notes').doc(n.id).update(v); toast('Сохранено'); },
    onDelete: async () => { await col('notes').doc(n.id).delete(); toast('Запись удалена'); } });
}
function openAtt(id){
  const f = byId('att', id); if(!f) return;
  openForm({ title:'Файл', fields:[{key:'caption', label:'Подпись', type:'textarea', rows:2, placeholder:'Что это за файл'}, {key:'name', label:'Имя файла', required:true}],
    values: f,
    async onSave(v){
      const ext = String(f.name).split('.').pop();
      if(ext && !v.name.toLowerCase().endsWith('.' + ext.toLowerCase())) v.name += '.' + ext;
      await col('att').doc(f.id).update(v); toast('Сохранено');
    } });
}

/* ---------- Действия ---------- */
// Выпадающий список статусов у цветной метки
function closeStatusMenu(){ if(stMenu){ stMenu.el.remove(); stMenu.btn.setAttribute('aria-expanded', 'false'); stMenu = null; } }
function openStatusMenu(btn){
  const {col: colName, id} = btn.dataset;
  const item = byId(colName, id); if(!item) return;
  const cur = item.status || 'todo';
  const el = document.createElement('div');
  el.className = 'st-menu'; el.setAttribute('role', 'menu');
  el.innerHTML = ORDER.map(k => `<button type="button" role="menuitemradio" aria-checked="${k === cur}" class="${STATUS[k].c}" data-st="${k}"><i></i>${STATUS[k].l}</button>`).join('');
  document.body.appendChild(el);
  const r = btn.getBoundingClientRect(), h = el.offsetHeight, w = el.offsetWidth;
  const top = r.bottom + 4 + h > window.innerHeight - 8 ? r.top - h - 4 : r.bottom + 4;
  el.style.top = Math.max(8, top) + 'px';
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  stMenu = {el, btn, colName, id};
  el.querySelector('[aria-checked="true"]').focus();
}
async function setStatus(colName, id, st){
  const item = byId(colName, id); if(!item || (item.status || 'todo') === st) return;
  try { await col(colName).doc(id).update({status: st}); toast(STATUS[st].l); }
  catch(e){ toast(errText(e)); }
}
window.addEventListener('resize', closeStatusMenu);
window.addEventListener('scroll', closeStatusMenu, true);
document.addEventListener('keydown', e => {
  if(!stMenu) return;
  if(e.key === 'Escape'){ const b = stMenu.btn; closeStatusMenu(); b.focus(); return; }
  if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    const items = [...stMenu.el.querySelectorAll('[data-st]')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    e.preventDefault();
  }
});
function go(tab){ UI.tab = tab; UI.subjectId = null; saveLS('tab', tab); render(); window.scrollTo(0, 0); if(tab === 'account') loadAccount(); }

document.addEventListener('click', async e => {
  if(stMenu){
    const opt = e.target.closest('.st-menu [data-st]');
    const {colName, id, btn} = stMenu;
    if(opt || !e.target.closest('.st-menu')) closeStatusMenu();
    if(opt){ setStatus(colName, id, opt.dataset.st); return; }
    if(e.target.closest('.st-menu') || e.target.closest('[data-act="status"]') === btn) return;
  }
  if(e.target.closest('#theme-btn')){
    setTheme(isDark() ? 'light' : 'dark');
    if(UI.tab === 'account' && S.loaded) render();
    return;
  }
  const tabBtn = e.target.closest('[data-tab]');
  if(tabBtn){ go(tabBtn.dataset.tab); return; }
  const g = e.target.closest('[data-goto]');
  if(g){ go(g.dataset.goto); return; }
  const a = e.target.closest('#main [data-act]');
  if(!a || !S.loaded) return;
  const d = a.dataset;
  if(readOnly() && (/^new-/.test(d.act) || d.act === 'status' || d.act === 'add-note')){ toast(RO_MSG); return; }
  switch(d.act){
    case 'status': openStatusMenu(a); break;
    case 'task': openTask(d.id); break;
    case 'new-task': openTask(null, d.subject); break;
    case 'new-inst': openInst(); break;
    case 'edit-inst': openInst(d.id); break;
    case 'new-subject': openSubject(null, d.inst); break;
    case 'edit-subject': openSubject(d.id); break;
    case 'open-subject': UI.subjectId = d.id; render(); window.scrollTo(0, 0); break;
    case 'back': UI.subjectId = null; render(); break;
    case 'new-session': openSession(); break;
    case 'edit-session': openSession(d.id); break;
    case 'new-exam': openExam(d.session); break;
    case 'edit-exam': openExam(d.session, d.id); break;
    case 'edit-thesis': openThesis(d.id); break;
    case 'new-thesis': openThesis(null); break;
    case 'pick-thesis': UI.thesisId = d.id; saveLS('thesis', d.id); UI.ch = ''; UI.q = ''; if(d.go){ go('thesis'); } else render(); break;
    case 'new-stage': openStage(); break;
    case 'edit-stage': openStage(d.id); break;
    case 'edit-note': openNote(d.id); break;
    case 'edit-att': openAtt(d.id); break;
    case 'add-note': {
      const text = ($('#n-text')?.value || '').trim(), chapter = ($('#n-ch')?.value || '').trim();
      const th = curThesis();
      if(!text || !th){ $('#n-text')?.focus(); return; }
      a.disabled = true;
      try { await col('notes').doc().set({text, chapter, thesisId: th.id, date: todayISO(), createdAt: Date.now()}); UI.noteDraft = ''; UI.noteCh = ''; toast('Запись добавлена'); render(); }
      catch(err){ toast(errText(err)); a.disabled = false; }
      break;
    }
    case 'dl': { const f = byId('att', d.key); if(f) downloadFile(f); break; }
    case 'view': { const f = byId('att', d.key); if(f) openViewer(f); break; }
    case 'del-att': {
      const f = byId('att', d.key); if(!f) return;
      if(!arm(a, 'Точно удалить?')) return;
      try { await deleteAttachment(f); toast('Файл удалён'); } catch(err){ toast(errText(err)); }
      break;
    }
    default: accountAction(a, d);
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if(t.name === 'p-theme'){ setTheme(t.value); return; }
  if(t.id === 'p-ava'){ const f = t.files[0]; t.value = ''; if(f) uploadAvatar(f); return; }
  if(readOnly() && ['sf-input', 'tf-input', 'imp-file'].includes(t.id)){ t.value = ''; toast(RO_MSG); return; }
  if(t.name === 'p-ai'){ UI.aiPick = t.value; saveLS('ai', t.value); $('#ai-steps').innerHTML = aiSteps(t.value); return; }
  if(t.matches('[data-filter]')){ UI.f[t.dataset.filter] = t.value; if(t.dataset.filter === 'inst') UI.f.subj = ''; saveLS('filters', UI.f); render(); return; }
  if(t.id === 'n-chf'){ UI.ch = t.value; $('#notes-list').innerHTML = notesList(); return; }
  if(t.id === 'tf-input' || t.id === 'sf-input'){
    let link;
    if(t.id === 'tf-input'){ const th = curThesis(); if(!th) return; link = {thesisId: th.id}; }
    else { const s = subjOf(UI.subjectId); if(!s) return; link = {subjectId: s.id}; }
    const list = [...t.files]; t.value = '';
    let last = null;
    for(const file of list){
      toast(`Загружаю «${file.name}»…`);
      try { const rec = await uploadFile(file, link); last = rec.id; toast('Файл загружен'); }
      catch(err){ toast(uploadErr(err)); }
    }
    if(last && list.length === 1) setTimeout(() => openAtt(last), 300);
    return;
  }
  if(t.id === 'imp-file'){ const f = t.files[0]; t.value = ''; if(f) importData(f); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if(t.id === 'n-q'){ UI.q = t.value; $('#notes-list').innerHTML = notesList(); }
  else if(t.id === 'n-text') UI.noteDraft = t.value;
  else if(t.id === 'n-ch') UI.noteCh = t.value;
});

/* ---------- Вход и регистрация ---------- */
let authMode = 'login', authInvite = '', isFirstRun = false;
async function showAuth(mode, invite){
  $('#app').hidden = true; $('#auth').hidden = false;
  authMode = mode || 'login'; if(invite) authInvite = invite;
  try { const r = await fetch('/api/zachetka/setup'); if(r.ok) isFirstRun = !!(await r.json()).firstRun; } catch(e){}
  if(isFirstRun) authMode = 'register';
  renderAuth();
}
function renderAuth(msg, ok){
  const b = $('#auth-body');
  const note = msg ? `<p class="${ok ? 'form-ok' : 'form-err'}">${esc(msg)}</p>` : '';
  if(authMode === 'register'){
    $('#auth-sub').textContent = isFirstRun ? 'Создайте аккаунт владельца. Вы станете администратором и сможете приглашать других.' : 'Регистрация по приглашению.';
    b.innerHTML = `<form class="stack" id="auth-form" data-mode="register" novalidate>
      ${isFirstRun ? '' : `<label>Код приглашения<input type="text" id="a-invite" autocomplete="off" autocapitalize="characters" value="${esc(authInvite)}" required></label>`}
      <label>Имя<input type="text" id="a-name" autocomplete="name"></label>
      <label>Почта<input type="email" id="a-email" autocomplete="email" required></label>
      <label>Пароль (не короче 8 символов)<input type="password" id="a-pass" autocomplete="new-password" minlength="8" required></label>
      <label>Повторите пароль<input type="password" id="a-pass2" autocomplete="new-password" required></label>
      <label class="check"><input type="checkbox" id="a-consent"><span>Согласен на обработку персональных данных по <a href="/privacy.html" target="_blank" rel="noopener">политике конфиденциальности</a></span></label>
      ${note}<button class="btn primary wide" type="submit">Создать аккаунт</button>
      ${isFirstRun ? '' : `<div class="auth-links"><button type="button" class="linkbtn" data-auth="login">У меня уже есть аккаунт</button></div>`}
    </form>`;
  } else if(authMode === 'reset'){
    $('#auth-sub').textContent = 'Пришлём ссылку для нового пароля на вашу почту.';
    b.innerHTML = `<form class="stack" id="auth-form" data-mode="reset" novalidate>
      <label>Почта<input type="email" id="a-email" autocomplete="email" required></label>
      ${note}<button class="btn primary wide" type="submit">Отправить ссылку</button>
      <div class="auth-links"><button type="button" class="linkbtn" data-auth="login">Вернуться ко входу</button></div>
    </form>`;
  } else {
    $('#auth-sub').textContent = 'Предметы, задания, сессии и дипломы в одном месте.';
    b.innerHTML = `<form class="stack" id="auth-form" data-mode="login" novalidate>
      <label>Почта<input type="email" id="a-email" autocomplete="email" required></label>
      <label>Пароль<input type="password" id="a-pass" autocomplete="current-password" required></label>
      ${note}<button class="btn primary wide" type="submit">Войти</button>
      <div class="auth-links"><button type="button" class="linkbtn" data-auth="register">Регистрация по приглашению</button><button type="button" class="linkbtn" data-auth="reset">Забыли пароль?</button></div>
    </form>`;
  }
}
$('#auth').addEventListener('click', e => { const b = e.target.closest('[data-auth]'); if(b){ authMode = b.dataset.auth; renderAuth(); } });
$('#auth').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('[type=submit]');
  const v = id => (f.querySelector('#' + id)?.value || '').trim();
  btn.disabled = true;
  try{
    if(f.dataset.mode === 'login'){
      if(!v('a-email') || !v('a-pass')) throw {msg:'Введите почту и пароль.'};
      try { await pb.collection('users').authWithPassword(v('a-email'), f.querySelector('#a-pass').value); }
      catch(err){ if(err.status === 400) throw {msg:'Неверная почта или пароль.'}; throw err; }
      startApp();
    } else if(f.dataset.mode === 'register'){
      const pass = f.querySelector('#a-pass').value, pass2 = f.querySelector('#a-pass2').value;
      if(!isFirstRun && !v('a-invite')) throw {msg:'Введите код приглашения.'};
      if(!v('a-email')) throw {msg:'Введите почту.'};
      if(pass.length < 8) throw {msg:'Пароль должен быть не короче 8 символов.'};
      if(pass !== pass2) throw {msg:'Пароли не совпадают.'};
      if(!f.querySelector('#a-consent').checked) throw {msg:'Нужно согласие на обработку персональных данных.'};
      const body = {email: v('a-email'), password: pass, passwordConfirm: pass2, name: v('a-name')};
      if(!isFirstRun) body.invite = v('a-invite');
      await pb.collection('users').create(body);
      await pb.collection('users').authWithPassword(body.email, pass);
      isFirstRun = false;
      startApp();
    } else {
      if(!v('a-email')) throw {msg:'Введите почту.'};
      await pb.collection('users').requestPasswordReset(v('a-email'));
      authMode = 'login'; renderAuth('Если такой адрес зарегистрирован, письмо со ссылкой уже отправлено. Проверьте и папку «Спам».', true); return;
    }
  }catch(err){
    renderAuthKeep(err.msg || errText(err));
  }finally{ btn.disabled = false; }
});
function renderAuthKeep(msg){
  const f = $('#auth-form'); if(!f) return;
  let p = f.querySelector('.form-err');
  if(!p){ p = document.createElement('p'); p.className = 'form-err'; f.querySelector('[type=submit]').before(p); }
  p.textContent = msg;
}

/* ---------- Профиль, данные, приглашения ---------- */
function vAccount(){
  const u = me();
  const inv = S.invites.slice().sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const used = S.att.reduce((n, a) => n + (a.size || 0), 0);
  return `<div class="page-head"><h2>Профиль</h2></div>
  <div class="acc">
    <section class="card"><h3>Аккаунт</h3>
      <div class="ava-row"><span class="ava lg">${avatarHTML(u)}</span><div class="actions"><span class="upload"><input type="file" id="p-ava" accept="image/*"><label class="btn sm" for="p-ava">${u.avatar ? 'Сменить фото' : 'Загрузить фото'}</label></span>${u.avatar ? '<button class="btn sm ghost" data-act="del-ava">Убрать фото</button>' : ''}</div></div>
      <div class="row2"><label class="fld"><span>Имя</span><input type="text" id="p-name" value="${esc(u.name || '')}"></label>
      <label class="fld"><span>Почта</span><input type="email" value="${esc(u.email || '')}" disabled></label></div>
      <div class="actions"><button class="btn" data-act="save-name">Сохранить имя</button></div>
      <p class="hint">Файлы занимают ${fsize(used || 1)}.</p>
      ${S.access ? `<p class="${S.access.active ? 'hint' : 'form-err'}">${accessLine()}</p>` : ''}
    </section>
    <section class="card"><h3>Оформление</h3>
      <div class="seg" role="radiogroup" aria-label="Тема">${[['auto','Как в системе'],['light','Светлая'],['dark','Тёмная']].map(([k,l]) =>
        `<input type="radio" name="p-theme" id="p-theme-${k}" value="${k}"${themePref() === k ? ' checked' : ''}><label for="p-theme-${k}">${l}</label>`).join('')}</div>
      <p class="hint">Тема запоминается на этом устройстве. Быстро переключить можно значком солнца или луны вверху.</p>
    </section>
    <section class="card"><h3>Пароль</h3>
      <label class="fld"><span>Текущий пароль</span><input type="password" id="p-old" autocomplete="current-password"></label>
      <div class="row2"><label class="fld"><span>Новый пароль</span><input type="password" id="p-new" autocomplete="new-password"></label>
      <label class="fld"><span>Повторите новый</span><input type="password" id="p-new2" autocomplete="new-password"></label></div>
      <div class="actions"><button class="btn" data-act="save-pass">Сменить пароль</button></div>
    </section>
    ${aiSection()}
    <section class="card"><h3>Резервная копия и перенос</h3>
      <p class="muted">Копия содержит все записи и файлы в одном архиве. Её же можно загрузить обратно, например на другом сервере.</p>
      <div class="actions"><button class="btn" data-act="export">Скачать копию (.zip)</button>
      <span class="upload"><input type="file" id="imp-file" accept=".zip,.json"><label class="btn" for="imp-file">Загрузить копию</label></span></div>
      <p class="hint">Загрузка добавляет записи к уже существующим. Повторная загрузка той же копии создаст дубликаты.</p>
      <div class="progress-log" id="imp-log"${UI.impLog ? '' : ' hidden'}>${esc(UI.impLog || '')}</div>
    </section>
    ${isAdmin() ? `<section class="card"><h3>Приглашения</h3>
      <p class="muted">Новый человек может зарегистрироваться только по коду. Отправьте ему ссылку или код.</p>
      <div class="row2"><label class="fld"><span>Для кого (заметка)</span><input type="text" id="i-note" placeholder="Например: Иван, группа 3"></label>
      <label class="fld"><span>Сколько регистраций</span><select id="i-max"><option value="1">1 человек</option><option value="5">до 5 человек</option><option value="30">до 30 человек</option><option value="0">без ограничения</option></select></label></div>
      <div class="row2"><label class="fld"><span>Приглашение действует до (необязательно)</span><input type="date" id="i-exp"></label>
      <label class="fld"><span>Срок доступа для новых пользователей</span><select id="i-period">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>
      <div class="actions"><button class="btn primary" data-act="new-invite">Создать приглашение</button></div>
      <div>${inv.length ? inv.map(i => {
          const left = i.max_uses > 0 ? `${i.uses} из ${i.max_uses}` : `${i.uses}, без ограничения`;
          const exp = (i.expires ? ` · до ${fmt(i.expires)}` : '') + (i.access_period ? ` · доступ ${PERIODS[i.access_period] || i.access_period}` : '');
          return `<div class="inv"><div><code>${esc(i.code)}</code><div class="muted">${i.note ? esc(i.note) + ' · ' : ''}использовано ${left}${exp}</div></div>
            <div class="acts"><button class="btn sm ghost" data-act="copy-invite" data-code="${esc(i.code)}">Скопировать ссылку</button><button class="btn sm ghost danger" data-act="del-invite" data-id="${esc(i.id)}">Удалить</button></div></div>`;
        }).join('') : '<p class="hint">Приглашений пока нет.</p>'}</div>
    </section>
    ${usersSection()}` : ''}
    <section class="card"><h3>Выход</h3>
      <div class="actions"><button class="btn" data-act="logout">Выйти из аккаунта</button><a class="btn ghost" href="/privacy.html" target="_blank" rel="noopener">Политика конфиденциальности</a></div>
      <div class="actions"><button class="btn ghost danger" data-act="delete-account">Удалить аккаунт и все данные</button></div>
    </section>
  </div>`;
}
/* ---------- Нейросети ---------- */
const AI = {
  claude: {name:'Claude', steps:[
    'Откройте <b>claude.ai</b> или приложение Claude на компьютере. Подходит и бесплатный тариф: на нём можно подключить один свой коннектор.',
    'Перейдите в «Настройки» (Settings) → «Коннекторы» (Connectors).',
    'Нажмите «Добавить свой коннектор» (Add custom connector).',
    'Название: <b>Зачётка</b>. В поле адреса (Remote MCP server URL) вставьте адрес выше. Нажмите «Добавить» (Add).',
    'Нажмите «Подключить» (Connect) у коннектора «Зачётка». Откроется окно зачётки: войдите и нажмите «Разрешить».',
    'В чате нажмите «+» или значок инструментов и проверьте, что «Зачётка» включена. Подключение работает и в приложении Claude на телефоне.'
  ]},
  chatgpt: {name:'ChatGPT', steps:[
    'Нужен платный тариф ChatGPT. Подключение делается на сайте <b>chatgpt.com</b> с компьютера: в приложении на телефоне свои подключения пока не работают.',
    'Включите режим разработчика: «Настройки» (Settings) → «Приложения» (Apps) → «Расширенные настройки» (Advanced settings) → «Режим разработчика» (Developer mode). В некоторых аккаунтах этот переключатель находится в разделе «Безопасность и вход» (Security and login).',
    'Нажмите «Создать приложение» (Create app). Если такой кнопки нет, откройте раздел «Plugins» → «+» → «Create MCP app».',
    'Название: <b>Зачётка</b>. Адрес (MCP Server URL): вставьте адрес выше. Аутентификация (Authentication): <b>OAuth</b>. Отметьте «I understand and want to continue» и нажмите «Создать» (Create).',
    'Откроется окно зачётки: войдите и нажмите «Разрешить».',
    'В новом чате нажмите «+» → «Ещё» (More) → «Режим разработчика» (Developer mode) и выберите «Зачётка». Перед изменением записей ChatGPT спросит у вас подтверждение.'
  ]},
  perplexity: {name:'Perplexity', steps:[
    'Нужна подписка Perplexity Pro или выше. Подключение делается на сайте <b>perplexity.ai</b> или в приложении для Mac.',
    'Откройте «Настройки» (Settings) → «Коннекторы» (Connectors) и нажмите «+ Свой коннектор» (Custom connector). Если спросит тип, выберите «Удалённый» (Remote).',
    'Название: <b>Зачётка</b>. Адрес (MCP Server URL): вставьте адрес выше. Аутентификация (Authentication): <b>OAuth</b>. Транспорт (Transport), если спросит: <b>Streamable HTTP</b>.',
    'Сохраните и нажмите на карточку коннектора «Зачётка», чтобы подключить. Откроется окно зачётки: войдите и нажмите «Разрешить».',
    'При вопросе включите «Зачётку» в источниках (Sources), чтобы Perplexity искал ответ в ваших данных.'
  ]}
};
const aiSteps = k => `<ol class="ai-steps">${(AI[k] || AI.claude).steps.map(x => `<li>${x}</li>`).join('')}</ol>`;
function aiSection(){
  const url = location.origin + '/mcp';
  const pick = AI[UI.aiPick] ? UI.aiPick : 'claude';
  const list = S.aiGrants.slice().sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
  const day = ms => ms ? fmt(new Date(ms).toISOString().slice(0, 10)) : '';
  return `<section class="card"><h3>Нейросети</h3>
    <p class="muted">Подключите свою нейросеть, и в чате с ней можно будет спрашивать о предметах, заданиях, сессиях и дипломе, добавлять задания, менять статусы, вносить экзамены и записи к диплому. Удалять записи нейросеть не может. Нейросеть видит только ваши данные.</p>
    <label class="fld"><span>Адрес для подключения</span><div class="ai-url"><input type="text" id="ai-url" value="${esc(url)}" readonly><button class="btn" data-act="copy-ai-url">Скопировать</button></div></label>
    <div class="seg" role="radiogroup" aria-label="Нейросеть">${Object.keys(AI).map(k =>
      `<input type="radio" name="p-ai" id="p-ai-${k}" value="${k}"${pick === k ? ' checked' : ''}><label for="p-ai-${k}">${AI[k].name}</label>`).join('')}</div>
    <div id="ai-steps">${aiSteps(pick)}</div>
    <p class="hint">Нейросети иногда переименовывают пункты меню. Если нужный не нашёлся, ищите слова «Коннекторы», «Connectors» или «Developer mode». Вопросы, которые вы задаёте нейросети, и найденные в зачётке ответы обрабатывает компания, которая делает эту нейросеть.</p>
    <div><b class="ai-sub">Подключено</b>${list.length ? list.map(g => `<div class="inv"><div><b>${esc(g.client_name || 'Нейросеть')}</b><div class="muted">${esc(g.redirect_host || '')}${g.created ? ' · подключено ' + day(Date.parse(String(g.created).replace(' ', 'T'))) : ''}${g.last_used ? ' · последний раз ' + day(g.last_used) : ''}</div></div>
      <div class="acts"><button class="btn sm ghost danger" data-act="del-ai" data-id="${esc(g.id)}">Отключить</button></div></div>`).join('') : '<p class="hint">Пока ни одной.</p>'}</div>
  </section>`;
}
async function loadAiGrants(){
  try { S.aiGrants = await pb.collection('ai_grants').getFullList(); if(UI.tab === 'account') render(); } catch(e){}
}
function loadAccount(){ loadInvites(); loadAiGrants(); loadAdminUsers(); }

/* ---------- Пользователи (для администратора) ---------- */
const PERIODS = {'': 'бессрочно', '7d': '7 дней', '14d': '14 дней', '1m': '1 месяц', '3m': '3 месяца'};
const ACC_DONE = {extend: 'Доступ продлён', set: 'Дата доступа изменена', unlimited: 'Доступ бессрочный', suspend: 'Доступ приостановлен', resume: 'Доступ возобновлён', note: 'Заметка сохранена'};
const ACC_LOG = {'extend:1': 'продлён на 1 месяц', 'extend:3': 'продлён на 3 месяца', set: 'дата изменена', unlimited: 'сделан бессрочным', suspend: 'приостановлен', resume: 'возобновлён', note: 'заметка'};
async function loadAdminUsers(){
  if(!isAdmin()) return;
  try { S.adminUsers = await pb.send('/api/zachetka/admin/users', {}); if(UI.tab === 'account') render(); } catch(e){}
}
function userState(x, today){
  if(x.role === 'admin') return '<span class="tag">администратор</span>';
  if(x.suspended) return '<span class="tag bad">приостановлен</span>';
  if(x.access_until && x.access_until < today) return `<span class="tag bad">срок закончился ${fmtFull(x.access_until)}</span>`;
  if(!x.access_until) return '<span class="tag ok">бессрочно</span>';
  const k = Math.round(dnum(x.access_until) - dnum(today));
  return `<span class="tag${k <= 7 ? ' warn' : ' ok'}">до ${fmtFull(x.access_until)}${k <= 7 ? `, осталось ${k} ${plural(k, DAYS)}` : ''}</span>`;
}
function usersSection(){
  const data = S.adminUsers;
  if(!data) return '<section class="card"><h3>Пользователи</h3><p class="hint">Загружаю…</p></section>';
  const t = data.today;
  const rank = x => x.role === 'admin' ? 3 : !x.active ? 0 : x.access_until ? 1 : 2;
  const list = data.users.slice().sort((a, b) => rank(a) - rank(b) || (a.access_until || '').localeCompare(b.access_until || '') || String(a.name || a.email).localeCompare(String(b.name || b.email)));
  return `<section class="card"><h3>Пользователи <span class="count">${list.length}</span></h3>
    <p class="muted">Когда срок доступа заканчивается или вы ставите паузу, человек может только смотреть и скачивать свои записи. Данные сохраняются, после продления всё работает как раньше. Продление считается от даты окончания, если она ещё не прошла, иначе от сегодня.</p>
    <div class="users">${list.map(x => {
      const id = esc(x.id), adm = x.role === 'admin';
      const log = x.log.map(l => `<li><span class="mono">${fmtFull(String(l.created).slice(0, 10))}</span> ${esc(ACC_LOG[l.action] || l.action)}${l.until_before !== l.until_after ? `: ${l.until_before ? fmtFull(l.until_before) : 'бессрочно'} → ${l.until_after ? fmtFull(l.until_after) : 'бессрочно'}` : ''}${l.note ? ` · ${esc(l.note)}` : ''}${l.by ? ` <span class="muted">(${esc(l.by)})</span>` : ''}</li>`).join('');
      return `<div class="usr">
        <div class="usr-head"><span class="ava">${avatarHTML(x.avatar ? {...x, collectionName: 'users'} : x)}</span>
          <div class="usr-main"><b>${esc(x.name || x.email)}</b><span class="muted">${x.name ? esc(x.email) + ' · ' : ''}с ${fmtFull(String(x.created).slice(0, 10))} · файлы ${fsize(x.files_size || 1)}</span><span>${userState(x, t)}</span></div></div>
        ${adm ? '' : `<div class="actions"><button class="btn sm" data-act="acc" data-action="extend" data-months="1" data-id="${id}">+1 месяц</button><button class="btn sm" data-act="acc" data-action="extend" data-months="3" data-id="${id}">+3 месяца</button>${x.suspended ? `<button class="btn sm" data-act="acc" data-action="resume" data-id="${id}">Возобновить</button>` : `<button class="btn sm ghost danger" data-act="acc" data-action="suspend" data-id="${id}">Приостановить</button>`}</div>`}
        <details class="usr-more"${UI.openUser === x.id ? ' open' : ''}><summary>${adm ? 'Заметки' : 'Дата, заметка и история'}</summary>
          ${adm ? '' : `<div class="usr-row"><label class="fld"><span>Доступ до</span><input type="date" id="ud-${id}" value="${esc(x.access_until || '')}"></label><button class="btn sm" data-act="acc" data-action="set" data-id="${id}">Поставить дату</button><button class="btn sm ghost" data-act="acc" data-action="unlimited" data-id="${id}">Бессрочно</button></div>`}
          <div class="usr-row"><label class="fld"><span>Заметка (видите только вы; добавится и к продлению)</span><input type="text" id="un-${id}" placeholder="Например: оплатил 500 ₽ 01.11 переводом"></label><button class="btn sm ghost" data-act="acc" data-action="note" data-id="${id}">Сохранить заметку</button></div>
          ${log ? `<ul class="usr-log">${log}</ul>` : '<p class="hint">Истории пока нет.</p>'}
        </details>
      </div>`;
    }).join('')}</div>
    <p class="hint">Удалить пользователя совсем можно в панели администратора: <a href="/_/" target="_blank" rel="noopener">${esc(location.host)}/_/</a></p>
  </section>`;
}
async function loadInvites(){
  if(!isAdmin()) return;
  try { S.invites = await pb.collection('invites').getFullList(); if(UI.tab === 'account') render(); } catch(e){}
}
const INV_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function inviteCode(){ const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, x => INV_ABC[x % INV_ABC.length]).join(''); }
async function copyText(text){
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); }
  catch(e){ window.prompt && window.prompt('Скопируйте:', text); }
}
async function accountAction(a, d){
  try{
    switch(d.act){
      case 'save-name': {
        const rec = await pb.collection('users').update(me().id, {name: $('#p-name').value.trim()});
        pb.authStore.save(pb.authStore.token, rec); renderMe(); toast('Имя сохранено'); break;
      }
      case 'del-ava': {
        const rec = await pb.collection('users').update(me().id, {avatar: null});
        pb.authStore.save(pb.authStore.token, rec); renderMe(); render(); toast('Фото убрано'); break;
      }
      case 'acc': {
        const note = ($('#un-' + d.id) || {}).value || '';
        if(d.action === 'suspend' && !arm(a, 'Точно приостановить?')) return;
        if(d.action === 'set' && !($('#ud-' + d.id) || {}).value){ toast('Выберите дату.'); return; }
        await pb.send('/api/zachetka/admin/access', {method: 'POST', body: {user: d.id, action: d.action, months: Number(d.months || 0), date: ($('#ud-' + d.id) || {}).value || '', note: note.trim()}});
        UI.openUser = d.id;
        await loadAdminUsers(); toast(ACC_DONE[d.action] || 'Сохранено'); break;
      }
      case 'save-pass': {
        const old = $('#p-old').value, n1 = $('#p-new').value, n2 = $('#p-new2').value;
        if(n1.length < 8){ toast('Новый пароль должен быть не короче 8 символов.'); return; }
        if(n1 !== n2){ toast('Новые пароли не совпадают.'); return; }
        const email = me().email;
        await pb.collection('users').update(me().id, {oldPassword: old, password: n1, passwordConfirm: n2});
        await pb.collection('users').authWithPassword(email, n1);
        toast('Пароль изменён'); render(); break;
      }
      case 'new-invite': {
        const body = {code: inviteCode(), note: $('#i-note').value.trim(), max_uses: Number($('#i-max').value), uses: 0, expires: $('#i-exp').value, access_period: $('#i-period').value};
        const rec = await pb.collection('invites').create(body);
        S.invites.push(rec); render();
        copyText(`${location.origin}/?invite=${rec.code}`);
        break;
      }
      case 'copy-invite': copyText(`${location.origin}/?invite=${d.code}`); break;
      case 'copy-ai-url': copyText(location.origin + '/mcp'); break;
      case 'del-ai': {
        if(!arm(a, 'Точно отключить?')) return;
        await pb.collection('ai_grants').delete(d.id);
        S.aiGrants = S.aiGrants.filter(g => g.id !== d.id); toast('Нейросеть отключена'); render(); break;
      }
      case 'del-invite': {
        if(!arm(a, 'Точно?')) return;
        await pb.collection('invites').delete(d.id);
        S.invites = S.invites.filter(i => i.id !== d.id); render(); break;
      }
      case 'export': await exportData(a); break;
      case 'logout': pb.authStore.clear(); location.reload(); break;
      case 'delete-account': {
        if(!arm(a, 'Все ваши записи и файлы будут удалены. Нажмите ещё раз')) return;
        await pb.collection('users').delete(me().id);
        pb.authStore.clear(); location.reload(); break;
      }
    }
  }catch(e){ toast(errText(e)); }
}

/* ---------- Резервная копия: выгрузка и загрузка ---------- */
const EXPORT_ORDER = [['inst','institutions'],['subjects','subjects'],['tasks','tasks'],['sessions','sessions'],['theses','theses'],['stages','stages'],['notes','notes']];
async function exportData(btn){
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Собираю архив…';
  try{
    const JSZip = await loadLib('/vendor/jszip.min.js', 'JSZip');
    const zip = new JSZip();
    const data = {app:'zachetka', version:1, exportedAt:new Date().toISOString()};
    for(const [k, name] of EXPORT_ORDER) data[name] = S[k].map(clean).map((x, n) => ({id: S[k][n].id, ...x}));
    data.attachments = [];
    for(const f of S.att){
      const path = `files/${f.id}-${String(f.name || 'file').replace(/[\\/:*?"<>|]/g, '_')}`;
      try { zip.file(path, await getBlob(f)); data.attachments.push({...clean(f), id: f.id, path}); }
      catch(e){ data.attachments.push({...clean(f), id: f.id, path: '', missing: true}); }
    }
    zip.file('data.json', JSON.stringify(data, null, 2));
    const blob = await zip.generateAsync({type:'blob'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `zachetka-${todayISO()}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast('Копия сохранена');
  }catch(e){ toast(errText(e)); }
  finally{ btn.disabled = false; btn.textContent = old; }
}
async function importData(file){
  UI.impLog = '';
  const say = t => { UI.impLog += t + '\n'; const log = $('#imp-log'); if(log){ log.hidden = false; log.textContent = UI.impLog; log.scrollTop = log.scrollHeight; } };
  let data, zip = null;
  try{
    if(/\.zip$/i.test(file.name)){
      const JSZip = await loadLib('/vendor/jszip.min.js', 'JSZip');
      zip = await JSZip.loadAsync(file);
      const dj = zip.file('data.json'); if(!dj) throw new Error('В архиве нет файла data.json.');
      data = JSON.parse(await dj.async('string'));
    } else data = JSON.parse(await file.text());
  }catch(e){ say('Не удалось прочитать файл: ' + errText(e)); return; }
  const ids = {};
  for(const [, name] of EXPORT_ORDER) ids[name] = new Set((data[name] || []).map(x => x.id));
  const map = new Map();
  const nid = old => { if(!map.has(old)) map.set(old, newId()); return map.get(old); };
  const relTo = (old, coll) => old && ids[coll].has(old) ? nid(old) : '';
  const REL = {subjects:{instId:'institutions'}, tasks:{subjectId:'subjects'}, sessions:{instId:'institutions'}, theses:{instId:'institutions'}, stages:{thesisId:'theses'}, notes:{thesisId:'theses'}};
  const REQ = {institutions:'name', subjects:'name', tasks:'title', sessions:'title', stages:'title', notes:'text'};
  let ok = 0, fail = 0;
  for(const [k, name] of EXPORT_ORDER){
    const list = data[name] || [];
    if(!list.length) continue;
    say(`${name}: ${list.length}…`);
    for(const rec of list){
      const body = clean(rec);
      body.id = nid(rec.id); body.owner = me().id;
      for(const [field, target] of Object.entries(REL[name] || {})) body[field] = relTo(rec[field], target);
      if(REQ[name] && !String(body[REQ[name]] || '').trim()) body[REQ[name]] = 'Без названия';
      if(name === 'sessions') body.exams = (rec.exams || []).map(e => ({...e, subjectId: relTo(e.subjectId, 'subjects')}));
      if(name === 'stages' || name === 'notes'){ if(!body.thesisId){ fail++; continue; } }
      try { const r = await pb.collection(name).create(body); upsert(k, r); ok++; }
      catch(e){ fail++; say(`  не загружено: ${rec.name || rec.title || rec.id} (${errText(e)})`); }
    }
  }
  const atts = data.attachments || [];
  if(atts.length) say(`файлы: ${atts.length}…`);
  for(const a of atts){
    const taskId = relTo(a.taskId, 'tasks'), thesisId = relTo(a.thesisId, 'theses'), subjectId = relTo(a.subjectId, 'subjects');
    const entry = zip && a.path ? zip.file(a.path) : null;
    if(!entry || (!taskId && !thesisId && !subjectId)){ fail++; say(`  пропущен файл: ${a.name || a.id}`); continue; }
    try{
      const blob = await entry.async('blob');
      const fd = new FormData();
      fd.append('id', newId()); fd.append('owner', me().id);
      fd.append('name', a.name || 'file'); fd.append('ext', a.ext || ''); fd.append('caption', a.caption || '');
      fd.append('createdAt', String(a.createdAt || Date.now()));
      if(taskId) fd.append('taskId', taskId);
      if(thesisId) fd.append('thesisId', thesisId);
      if(subjectId) fd.append('subjectId', subjectId);
      fd.append('file', new File([blob], a.name || 'file'));
      const r = await pb.collection('attachments').create(fd); upsert('att', r); ok++;
    }catch(e){ fail++; say(`  файл не загружен: ${a.name} (${errText(e)})`); }
  }
  say(`Готово. Загружено: ${ok}${fail ? `, не загружено: ${fail}` : ''}.`);
  toast('Загрузка завершена');
}

let tt = 0;
function toast(msg){ const el = $('#toast'); const host = viewer.open ? viewer : dlg.open ? dlg : document.body; if(el.parentNode !== host) host.appendChild(el); el.textContent = msg; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2800); }

boot();
})();
