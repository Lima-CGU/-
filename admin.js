/* PICTAMEAL research admin page.
   The password is the backend's ADMIN_TOKEN: typed in, kept ONLY in
   sessionStorage (gone when the tab closes), sent as an Authorization header
   — never in the URL, localStorage or this file. */
(() => {
  'use strict';

  const BACKEND_URL = 'https://xianghu-backend.onrender.com';
  const TOKEN_KEY = 'pictameal:adminToken';
  const Stats = window.PictaAdminStats;
  const $ = id => document.getElementById(id);

  const CONTAINER_LABEL = { plate: '盤子', bowl: '碗', cup: '杯子' };
  const FIELD_LABEL = { containerType: '容器', size: '份量', cookingMethod: '烹調', sugar: '糖', salt: '鹽' };
  const FIELDS = Object.keys(FIELD_LABEL);
  const GROUP_LABEL = { A: 'A', B: 'B', C: 'C' };
  const EXCLUDE_REASONS = ['技術故障', '操作錯誤', '練習資料', '重複紀錄', '其他'];

  let rows = [];          // summaries from /api/admin/records (current filters)
  let lastFilters = null; // the filters those rows were loaded with

  /* ---------- token (sessionStorage only) ---------- */
  function getToken(){ try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (err){ return ''; } }
  function setToken(t){ try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (err){ /* blocked */ } }

  class ApiError extends Error {
    constructor(message, status){ super(message); this.status = status; }
  }
  // fetch with the password header; 401 = wrong / expired password -> back to login
  async function api(path, opts = {}){
    let res;
    try {
      res = await fetch(`${BACKEND_URL}${path}`, {
        ...opts,
        headers: { ...(opts.headers || {}), Authorization: `Bearer ${opts.token || getToken()}` },
        cache: 'no-store'
      });
    } catch (err){
      throw new ApiError('連不上伺服器。後端可能在休眠,請等 30~60 秒後再試一次。', 0);
    }
    if (res.ok) return res;
    let msg = '';
    try { msg = (await res.json()).error || ''; } catch (err){ /* not JSON */ }
    if (res.status === 401) msg = '密碼錯誤,請重新輸入。';
    else if (res.status === 429) msg = msg || '密碼錯誤次數太多,請 15 分鐘後再試。';
    else if (res.status === 503) msg = msg || '伺服器沒有設定後台密碼(ADMIN_TOKEN)。';
    throw new ApiError(msg || `伺服器錯誤(${res.status})`, res.status);
  }
  function handleAuthError(err){
    if (err.status === 401 || err.status === 429){
      logout(err.message);
      return true;
    }
    return false;
  }

  function showMsg(el, text, isError){
    el.hidden = !text;
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  /* ---------- login / logout ---------- */
  function showApp(on){
    $('loginView').hidden = on;
    $('appView').hidden = !on;
    $('logoutBtn').hidden = !on;
  }
  function logout(message){
    setToken('');
    stopServerStatus();
    rows = [];
    showApp(false);
    $('loginToken').value = '';
    showMsg($('loginMsg'), message || '', !!message);
    $('loginToken').focus();
  }
  $('logoutBtn').addEventListener('click', () => logout('已登出。'));
  $('loginMsg').classList.remove('is-error');

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const token = $('loginToken').value.trim();
    if (!token) return;
    const btn = $('loginBtn');
    btn.disabled = true;
    showMsg($('loginMsg'), '登入中…(後端休眠時可能要等 30~60 秒)');
    try {
      await api('/api/admin/check', { token });
      setToken(token);
      $('loginToken').value = '';
      showMsg($('loginMsg'), '');
      showApp(true);
      startServerStatus();
      loadRecords();
    } catch (err){
      showMsg($('loginMsg'), err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- filters ---------- */
  function currentFilters(){
    const clean = (v, re) => (re.test(v) ? v : '');
    return {
      group: $('fGroup').value,
      meal: clean($('fMeal').value.trim(), /^[A-Za-z0-9_-]{1,20}$/),
      pid: clean($('fPid').value.trim(), /^[A-Za-z0-9_-]{1,40}$/),
      hide: $('fHide').checked
    };
  }
  function query(f, extra = {}){
    const q = new URLSearchParams();
    if (f.group) q.set('group', f.group);
    if (f.meal) q.set('meal', f.meal);
    if (f.pid) q.set('pid', f.pid);
    if (f.hide) q.set('hideExcluded', '1');
    Object.entries(extra).forEach(([k, v]) => q.set(k, v));
    const s = q.toString();
    return s ? `?${s}` : '';
  }
  $('filterForm').addEventListener('submit', e => {
    e.preventDefault();
    const badMeal = $('fMeal').value.trim() && !currentFilters().meal;
    const badPid = $('fPid').value.trim() && !currentFilters().pid;
    if (badMeal || badPid){
      showMsg($('loadMsg'), '編號只能有英文字母、數字、- 或 _。', true);
      return;
    }
    loadRecords();
  });
  $('filterReset').addEventListener('click', () => {
    $('fGroup').value = '';
    $('fMeal').value = '';
    $('fPid').value = '';
    $('fHide').checked = true;
    loadRecords();
  });

  /* ---------- load ---------- */
  async function loadRecords(){
    const f = currentFilters();
    showMsg($('loadMsg'), '讀取中…(後端休眠時可能要等 30~60 秒)');
    try {
      // the list follows the checkbox too; the statistics always apply it themselves
      const data = await (await api(`/api/admin/records${query(f)}`)).json();
      rows = Array.isArray(data.records) ? data.records : [];
      rows.sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
      lastFilters = f;
      showMsg($('loadMsg'), '');
      render();
    } catch (err){
      if (!handleAuthError(err)) showMsg($('loadMsg'), err.message, true);
    }
  }

  function render(){
    renderStats();
    renderList();
  }

  /* ---------- overview ---------- */
  function renderStats(){
    const s = Stats.overview(rows, { hideExcluded: lastFilters ? lastFilters.hide : true });
    const groups = Stats.GROUPS;
    const cell = d => `${Stats.fmt(d.mean)}${d.n ? `<span class="n">(n=${d.n})</span>` : ''}`;
    const msd = d => (d.n ? `${Stats.fmt(d.mean)} ± ${Stats.fmt(d.sd)}<span class="n">(n=${d.n})</span>` : '—');
    const lines = [
      ['紀錄筆數', g => String(s[g].records)],
      ['受試者人數', g => String(s[g].participants)],
      ['修正時間(秒)平均 ± 標準差', g => msd(s[g].correctionSec)],
      ['總時間(秒)平均 ± 標準差', g => msd(s[g].totalSec)],
      ['操作次數 平均 ± 標準差', g => msd(s[g].userActionCount)],
      ['AI 處理時間(秒)平均', g => (s[g].aiProcessingSec.n ? cell(s[g].aiProcessingSec) : '—')]
    ];
    $('statsTable').querySelector('tbody').innerHTML = lines
      .map(([label, fn]) => `<tr><th scope="row">${label}</th>${groups.map(g => `<td>${fn(g)}</td>`).join('')}</tr>`).join('');
  }

  /* ---------- list ---------- */
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num2 = v => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—');
  function fmtTime(iso){
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderList(){
    const tbody = $('recordsTable').querySelector('tbody');
    tbody.textContent = '';
    $('listCount').textContent = `(${rows.length} 筆)`;
    $('listEmpty').hidden = rows.length > 0;
    rows.forEach(r => tbody.appendChild(renderRow(r)));
  }

  function renderRow(r){
    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.dataset.id = r.id;
    tr.tabIndex = 0;
    tr.setAttribute('aria-expanded', 'false');
    tr.classList.toggle('is-excluded', !!r.excluded);
    const cells = [
      ['時間', esc(fmtTime(r.doneAt))],
      ['受試者', esc(r.pid)],
      ['組別', esc(GROUP_LABEL[r.group] || r.group)],
      ['便當', esc(r.mealId || '—')],
      ['菜數', String(r.dishCount)],
      ['修正時間(秒)', num2(r.correctionSec)],
      ['操作次數', r.userActionCount == null ? '—' : String(r.userActionCount)],
      ['整餐熱量', r.totalKcal == null ? '—' : `${r.totalKcal} kcal`],
      ['上傳狀態', `<span class="tag ok">已上傳${r.uploadCount > 1 ? `(${r.uploadCount} 次)` : ''}</span>${r.photoStored ? '' : ' <span class="tag">無照片</span>'}${r.deletedFromDiary ? ' <span class="tag warn">受試者已從日記刪除</span>' : ''}`],
      ['排除', r.excluded ? `<span class="tag warn">已排除</span><span class="reason">${esc(r.excludeReason)}</span>` : '<span class="tag">否</span>']
    ];
    tr.innerHTML = cells.map(([label, html]) => `<td data-label="${label}">${html}</td>`).join('');
    const toggle = () => toggleDetail(tr, r);
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
    return tr;
  }

  /* ---------- detail ---------- */
  function toggleDetail(tr, r){
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')){
      next.remove();
      tr.classList.remove('is-open');
      tr.setAttribute('aria-expanded', 'false');
      return;
    }
    tr.classList.add('is-open');
    tr.setAttribute('aria-expanded', 'true');
    const dtr = document.createElement('tr');
    dtr.className = 'detail';
    dtr.innerHTML = '<td colspan="10"><p class="muted">讀取中…</p></td>';
    tr.after(dtr);
    loadDetail(dtr.firstChild, r);
  }

  async function loadDetail(td, r){
    let record;
    try {
      record = (await (await api(`/api/admin/records/${encodeURIComponent(r.id)}`)).json()).record;
    } catch (err){
      if (!handleAuthError(err)) td.innerHTML = `<p class="msg is-error">${esc(err.message)}</p>`;
      return;
    }
    td.innerHTML = `
      <div class="detail-grid">
        <div><div class="detail-photo">${r.photoStored ? '照片讀取中…' : '這筆紀錄沒有照片'}</div></div>
        <div>
          <p class="meta">紀錄 ID:${esc(record.id)}・受試者 ${esc(record.pid)}・${esc(record.group)} 組${record.mealId ? `・便當 ${esc(record.mealId)}` : ''}・總時間 ${num2(record.times && record.times.totalSec)} 秒・AI 處理 ${num2(record.times && record.times.aiProcessingSec)} 秒</p>
          <h3>AI 初稿 ↔ 受試者最後的結果</h3>
          <div class="table-scroll">${compareTable(record)}</div>
          ${record.chat && Array.isArray(record.chat.messages) ? chatHtml(record.chat) : ''}
          <div class="exclude-box"></div>
        </div>
      </div>`;
    renderExclude(td.querySelector('.exclude-box'), r);
    if (r.photoStored) loadPhoto(td.querySelector('.detail-photo'), r.id);
  }

  async function loadPhoto(box, id){
    try {
      const blob = await (await api(`/api/admin/photo?id=${encodeURIComponent(id)}`)).blob();
      const img = document.createElement('img');
      img.alt = '這一餐的照片';
      img.src = URL.createObjectURL(blob);
      box.textContent = '';
      box.appendChild(img);
    } catch (err){
      if (!handleAuthError(err)) box.textContent = err.status === 404 ? '找不到照片' : '照片讀取失敗';
    }
  }

  const plain = s => String(s || '').replace(/\(\d+%\)$/, '');
  function fieldsText(d){
    const x = d.detail || {};
    const parts = FIELDS.filter(k => x[k]).map(k => `${FIELD_LABEL[k]}:${k === 'containerType' ? CONTAINER_LABEL[x[k]] || x[k] : x[k]}`);
    if (d.count) parts.push(`數量:${d.count}${d.countUnit ? ` ${d.countUnit}` : ''}`);
    return parts.length ? parts.join('、') : '(沒有填欄位)';
  }
  // One row per final dish (left: what the AI said; right: the final name + fields),
  // plus the AI dishes the participant deleted.
  function compareTable(record){
    const dishes = Array.isArray(record.dishes) ? record.dishes : [];
    const out = dishes.map((d, i) => {
      const ai = d.aiOriginal || null;
      const aiName = ai && ai.name ? `${esc(ai.name)}${ai.confidence != null ? `(${esc(ai.confidence)}%)` : ''}${ai.count ? ` ×${esc(ai.count)}` : ''}` : (d.source === 'chat' ? '(對話中新增)' : d.source === 'user' ? '(受試者新增)' : '—');
      const finalName = plain(d.name);
      const changed = ai && ai.name && ai.name !== finalName;
      return `<tr><td>${i + 1}</td><td>${aiName}</td><td><span class="${changed ? 'changed' : ''}">${esc(finalName)}</span>${changed ? '(改過菜名)' : ''}<div class="fields">${esc(fieldsText(d))}</div>${Array.isArray(d.notes) && d.notes.length ? `<div class="fields">備註:${esc(d.notes.join(';'))}</div>` : ''}${d.nutrition && d.nutrition.status === 'ok' ? `<div class="fields">${esc(d.nutrition.kcal)} kcal</div>` : ''}</td></tr>`;
    });
    const deleted = ((record.editLog && record.editLog.deletedDishes) || []).filter(x => x && (x.aiName || x.name));
    deleted.forEach(x => out.push(`<tr><td>—</td><td>${esc(x.aiName || x.name)}</td><td><span class="changed">(受試者刪除)</span></td></tr>`));
    if (!out.length) return '<p class="muted">沒有菜色。</p>';
    return `<table class="compare"><thead><tr><th>#</th><th>AI 初稿</th><th>受試者最後</th></tr></thead><tbody>${out.join('')}</tbody></table>`;
  }

  function chatHtml(chat){
    const lines = chat.messages.map(m => {
      const who = m.role === 'assistant' ? 'ai' : 'user';
      const tag = [m.role === 'assistant' ? 'AI' : '受試者', fmtTime(m.at).slice(11),
        m.source === 'suggestion' ? '點提示按鈕' : '', m.isClarification ? '追問' : '', m.offTopic ? '拒答' : '', m.failed ? '連線失敗' : '']
        .filter(Boolean).join('・');
      return `<div class="chat-line ${who}"><small>${esc(tag)}</small>${esc(m.content)}</div>`;
    }).join('');
    return `<h3 style="margin-top:16px">對話內容(${chat.messages.length} 則)</h3><div class="chat">${lines || '<p class="muted">沒有對話。</p>'}</div>`;
  }

  /* ---------- exclude (a mark only — nothing is deleted) ---------- */
  function renderExclude(box, r){
    if (r.excluded){
      box.innerHTML = `<p class="small"><span class="tag warn">已排除</span> 原因:${esc(r.excludeReason || '(未填)')}${r.excludedAt ? `・${esc(fmtTime(r.excludedAt))}` : ''}</p>
        <button type="button" class="btn btn-outline btn-sm" data-act="unexclude">取消排除</button>`;
    } else {
      box.innerHTML = `<p class="small muted" style="margin-bottom:8px">標記排除後,這筆紀錄不會算進總覽統計(資料不會被刪除,隨時可以取消)。</p>
        <div class="exclude-form">
          <select aria-label="排除原因">${EXCLUDE_REASONS.map(x => `<option>${x}</option>`).join('')}</select>
          <input type="text" maxlength="150" placeholder="補充說明(可不填)" aria-label="補充說明">
          <button type="button" class="btn btn-danger btn-sm" data-act="exclude">標記排除</button>
        </div>`;
    }
    const msg = document.createElement('p');
    msg.className = 'msg';
    msg.hidden = true;
    box.appendChild(msg);
    box.querySelector('button').addEventListener('click', async e => {
      e.stopPropagation();
      const excluding = !r.excluded;
      let reason = '';
      if (excluding){
        const sel = box.querySelector('select').value;
        const note = box.querySelector('input').value.trim();
        reason = note ? `${sel}:${note}` : sel;
      } else if (!window.confirm('確定要取消排除這筆紀錄嗎?')) return;
      e.target.disabled = true;
      try {
        const out = await (await api(`/api/admin/records/${encodeURIComponent(r.id)}/exclude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ excluded: excluding, reason })
        })).json();
        Object.assign(r, { excluded: out.excluded, excludeReason: out.excludeReason, excludedAt: out.excludedAt });
        const tr = $('recordsTable').querySelector(`tr.row[data-id="${CSS.escape(r.id)}"]`);
        if (tr){
          const fresh = renderRow(r);
          fresh.classList.add('is-open');
          fresh.setAttribute('aria-expanded', 'true');
          tr.replaceWith(fresh);
        }
        renderExclude(box, r);
        renderStats();
        const m = box.querySelector('.msg');
        showMsg(m, excluding ? '已標記排除(重新套用篩選後,這筆會從列表中隱藏)。' : '已取消排除。');
      } catch (err){
        e.target.disabled = false;
        if (!handleAuthError(err)) showMsg(box.querySelector('.msg'), err.message, true);
      }
    });
    box.addEventListener('click', e => e.stopPropagation());
  }

  /* ---------- downloads (fetched with the header, saved as a file) ---------- */
  document.querySelectorAll('[data-download]').forEach(btn => btn.addEventListener('click', async () => {
    const format = btn.dataset.download;
    const f = currentFilters();
    const msg = $('downloadMsg');
    btn.disabled = true;
    showMsg(msg, '準備檔案中…');
    try {
      const res = await api(`/api/admin/export${query(f, { format })}`);
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const name = format === 'events' ? `pictameal-events-${stamp}.csv` : format === 'json' ? `pictameal-meals-${stamp}.json` : `pictameal-meals-${stamp}.csv`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      showMsg(msg, `已下載 ${name}`);
    } catch (err){
      if (!handleAuthError(err)) showMsg(msg, err.message, true);
    } finally {
      btn.disabled = false;
    }
  }));

  /* ---------- server status (Render free plan: sleeps, ~80 s cold start) ----------
     GET / (no password needed). 醒著 = it answered; 喚醒中 = still waiting (the
     request itself wakes it); 無法連線 = no answer for WAKE_GIVE_UP_MS. */
  const PING_TIMEOUT_MS = 8000;      // a quick check
  const WAKE_TRY_TIMEOUT_MS = 20000; // one try while waking
  const WAKE_GIVE_UP_MS = 180000;
  const RECHECK_MS = 120000;         // re-check while the page is open
  let waking = null;                 // the running wake loop
  let recheckTimer = null;

  function setServer(state, note){
    const label = { awake: '醒著', waking: '喚醒中', down: '無法連線', checking: '檢查中…' }[state];
    $('serverState').textContent = label;
    $('serverDot').className = `status-dot ${state}`;
    $('serverNote').textContent = note || '';
  }
  async function ping(timeoutMs){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BACKEND_URL}/`, { cache: 'no-store', signal: ctrl.signal });
      return res.ok;
    } catch (err){
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  // Keeps asking until the backend answers, showing the seconds waited.
  function wake(){
    if (waking) return waking;
    const started = Date.now();
    const secs = () => Math.round((Date.now() - started) / 1000);
    setServer('waking', '已等待 0 秒(冷啟動約需 1~2 分鐘)');
    const tick = setInterval(() => setServer('waking', `已等待 ${secs()} 秒(冷啟動約需 1~2 分鐘)`), 1000);
    $('wakeBtn').disabled = true;
    waking = (async () => {
      while (Date.now() - started < WAKE_GIVE_UP_MS){
        if (await ping(WAKE_TRY_TIMEOUT_MS)) return true;
        await new Promise(r => setTimeout(r, 2000));
      }
      return false;
    })().then(ok => {
      clearInterval(tick);
      setServer(ok ? 'awake' : 'down', ok ? `(等了 ${secs()} 秒)` : '請稍後再按一次「喚醒伺服器」;一直失敗的話請聯絡負責的研究人員。');
      $('wakeBtn').disabled = false;
      waking = null;
      return ok;
    });
    return waking;
  }
  async function checkServer(){
    if (waking) return;
    if (await ping(PING_TIMEOUT_MS)) setServer('awake');
    else wake(); // no quick answer: it is asleep (or waking) — keep asking
  }
  function startServerStatus(){
    setServer('checking');
    checkServer();
    clearInterval(recheckTimer);
    recheckTimer = setInterval(() => { if (!document.hidden) checkServer(); }, RECHECK_MS);
  }
  function stopServerStatus(){ clearInterval(recheckTimer); recheckTimer = null; }
  $('wakeBtn').addEventListener('click', () => wake());

  /* ---------- start ---------- */
  if (getToken()){
    showApp(true);
    startServerStatus();
    loadRecords();
  } else {
    showApp(false);
  }
})();
