/**
 * PictaCalorie — shared calorie component (Group A now, Group B later).
 *
 * Listens for the `pictameal:dish-detail-complete` event (fired when a dish
 * has all five fields: reason 'completed', then 'changed' on every later
 * edit), asks POST /api/nutrition, and keeps one result per dish id.
 * Rapid edits are debounced — only the last one is calculated, and a stale
 * response never overwrites a newer request.
 *
 * It owns no screen. A page reads state with getState()/summary() and the
 * text helpers below, and re-renders on the `pictameal:calorie-update`
 * event ({ dishId }). Nothing here knows about Group A's layout, so Group B
 * only has to fire the same event and render with the same helpers.
 */
(function(){
  'use strict';

  const IN_EVENT = 'pictameal:dish-detail-complete';
  const OUT_EVENT = 'pictameal:calorie-update';
  const DEBOUNCE_MS = { completed: 150, changed: 700 };
  const REQUEST_TIMEOUT_MS = 30000;

  let backendUrl = '';
  const states = new Map(); // dishId -> { status, result, payload, seq, timer, promise }

  // Failed calls are reported to the page (which logs them in the record).
  function reportError(message){
    document.dispatchEvent(new CustomEvent('pictameal:api-error', { detail: { api: 'nutrition', message: String(message).slice(0, 200) } }));
  }

  function emit(dishId){
    document.dispatchEvent(new CustomEvent(OUT_EVENT, { detail: { dishId } }));
  }

  function toPayload(d){
    const x = d.detail || {};
    return {
      name: d.name,
      category: d.category === 'beverage' ? 'beverage' : 'food',
      containerType: x.containerType,
      size: x.size,
      cookingMethod: x.cookingMethod,
      sugar: x.sugar,
      salt: x.salt,
      // countable dishes: how many (only used with a per-piece item)
      count: Number.isInteger(d.count) ? d.count : undefined,
      countUnit: d.countUnit || undefined
    };
  }

  // POST /api/nutrition once; resolves to a saved-result object
  // ({ status: ok|none|anomaly, ... } or { status: 'error' }). Never throws.
  async function request(payload){
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${backendUrl}/api/nutrition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.status) return { ...data, calculatedAt: new Date().toISOString() };
      reportError((data && data.error) || `HTTP ${res.status}`);
      return { status: 'error', calculatedAt: new Date().toISOString() };
    } catch (err){
      console.error('[calorie] request failed:', err);
      reportError(err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || err);
      return { status: 'error', calculatedAt: new Date().toISOString() };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function run(dishId, seq){
    const st = states.get(dishId);
    if (!st || st.seq !== seq) return;
    st.timer = null;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${backendUrl}/api/nutrition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(st.payload),
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => null);
      if (states.get(dishId) !== st || st.seq !== seq) return; // stale
      if (res.ok && data && data.status){
        st.status = data.status;       // 'ok' | 'none' | 'anomaly' | 'needs-portion'
        st.result = { ...data, calculatedAt: new Date().toISOString() };
      } else {
        reportError((data && data.error) || `HTTP ${res.status}`);
        st.status = 'error';
        st.result = null;
      }
    } catch (err){
      if (states.get(dishId) !== st || st.seq !== seq) return;
      console.error('[calorie] request failed:', err);
      reportError(err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || err);
      st.status = 'error';
      st.result = null;
    } finally {
      clearTimeout(timeout);
    }
    emit(dishId);
  }

  function schedule(d){
    if (!backendUrl || !d || !d.dishId) return;
    let st = states.get(d.dishId);
    if (!st){ st = { seq: 0 }; states.set(d.dishId, st); }
    clearTimeout(st.timer);
    st.seq += 1;
    st.status = 'loading';
    st.result = null;
    st.payload = toPayload(d);
    const seq = st.seq;
    st.promise = new Promise(resolve => {
      st.timer = setTimeout(() => run(d.dishId, seq).then(resolve), DEBOUNCE_MS[d.reason] ?? DEBOUNCE_MS.changed);
      st.flush = () => { clearTimeout(st.timer); st.flush = null; run(d.dishId, seq).then(resolve); };
    });
    emit(d.dishId);
  }

  document.addEventListener(IN_EVENT, e => schedule(e.detail));

  const API = {
    init(opts){ backendUrl = String((opts && opts.backendUrl) || '').replace(/\/$/, ''); },

    getState(id){ const s = states.get(id); return s ? { status: s.status, result: s.result } : null; },

    // The dish was deleted / is no longer complete: drop it; in-flight replies are ignored.
    forget(id){
      const s = states.get(id);
      if (!s) return;
      clearTimeout(s.timer);
      states.delete(id);
      emit(id);
    },

    // New meal: forget everything.
    reset(){
      const ids = [...states.keys()];
      states.forEach(s => clearTimeout(s.timer));
      states.clear();
      ids.forEach(emit);
    },

    // Runs any debounced calculation now and waits for the dishes' requests.
    async settle(ids){
      const waits = [];
      (ids || [...states.keys()]).forEach(id => {
        const s = states.get(id);
        if (s && s.status === 'loading'){
          if (s.flush) s.flush();
          waits.push(s.promise);
        }
      });
      await Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, REQUEST_TIMEOUT_MS + 2000))]);
    },

    // Meal total over the given dish ids: only dishes with a number add in.
    summary(ids){
      // needsPortion: Group B dishes still missing a portion (待補份量)
      // needsCount: countable dishes whose count isn't known yet (待補數量)
      const out = { kcal: 0, estimated: 0, unavailable: 0, pending: 0, needsPortion: 0, needsCount: 0, total: 0 };
      (ids || []).forEach(id => {
        const s = states.get(id);
        if (!s) return;
        out.total += 1;
        if (s.status === 'loading') out.pending += 1;
        else if (s.status === 'ok'){ out.kcal += s.result.kcal; out.estimated += 1; }
        else if (s.status === 'needs-portion') out.needsPortion += 1;
        else if (s.status === 'needs-count') out.needsCount += 1;
        else out.unavailable += 1;
      });
      return out;
    },

    /* ----- text helpers ----- */

    // The tag right of the dish name: "N kcal" (green) / "N kcal 近似" (orange) /
    // 計算中… / 無法估算 (grey). Style classes: is-ok is-approx is-loading is-none.
    renderBadge(el, st){
      el.textContent = '';
      el.classList.remove('is-ok', 'is-approx', 'is-loading', 'is-none');
      if (!st) return;
      if (st.status === 'loading'){ el.classList.add('is-loading'); el.textContent = '計算中…'; return; }
      if (st.status === 'needs-portion'){ el.classList.add('is-none'); el.textContent = '待補份量'; return; }
      if (st.status === 'needs-count'){ el.classList.add('is-none'); el.textContent = '待補數量'; return; }
      if (st.status !== 'ok'){ el.classList.add('is-none'); el.textContent = '無法估算'; return; }
      el.classList.add(st.result.match === 'approx' ? 'is-approx' : 'is-ok');
      el.append(`${st.result.kcal} kcal`);
      if (st.result.match === 'approx'){
        const small = document.createElement('small');
        small.textContent = '近似';
        el.appendChild(small);
      }
    },

    // Photo label line: "N kcal", 計算中…, or 無法估算 (none / anomaly /
    // failed). '' only for a dish that has never been calculated.
    labelText(st){
      if (!st) return '';
      if (st.status === 'loading') return '計算中…';
      if (st.status === 'needs-portion') return '待補份量';
      if (st.status === 'needs-count') return '待補數量';
      return st.status === 'ok' ? `${st.result.kcal} kcal` : '無法估算';
    },

    // Style class for that line: '' (a number), 'is-loading' or 'is-none'.
    labelClass(st){
      if (!st || st.status === 'ok') return '';
      return st.status === 'loading' ? 'is-loading' : 'is-none';
    },

    // The expandable explanation: how it was calculated, then 蛋白質 / 脂肪 / 醣類 / 鈉.
    renderExplain(el, st){
      el.textContent = '';
      if (!st || st.status === 'loading') return;
      const line = text => {
        const p = document.createElement('div');
        p.className = 'kcal-explain-formula';
        p.textContent = text;
        el.appendChild(p);
      };
      const r = st.result;
      if (st.status === 'needs-portion'){
        line((r && r.explanation) || '還不知道吃了多少,補充份量後就能估算熱量。');
        return;
      }
      if (st.status === 'needs-count'){
        line((r && r.explanation) || '還不知道吃了幾個,補上數量後就能估算熱量。');
        return;
      }
      if (st.status !== 'ok'){
        line(st.status === 'error' ? '熱量計算暫時失敗,修改任一欄位會重新計算。'
          : (r && r.explanation) || '資料庫中找不到足以代表這道菜的品項,無法估算。');
        return;
      }
      line(r.formula);
      const grid = document.createElement('div');
      grid.className = 'kcal-explain-grid';
      [['蛋白質', r.proteinG, 'g'], ['脂肪', r.fatG, 'g'], ['醣類', r.carbohydrateG, 'g'], ['鈉', r.sodiumMg, 'mg']].forEach(([label, v, u]) => {
        const cell = document.createElement('div');
        cell.className = 'kcal-explain-cell';
        const num = document.createElement('b');
        num.textContent = v == null ? '—' : `${v} ${u}`;
        const name = document.createElement('span');
        name.textContent = label;
        cell.append(num, name);
        grid.appendChild(cell);
      });
      el.appendChild(grid);
    },

    // What gets saved with the meal record for one dish (null = never calculated).
    snapshot(id){
      const s = states.get(id);
      if (!s) return null;
      if (s.status === 'ok' || s.status === 'none' || s.status === 'anomaly') return { ...s.result };
      if (s.status === 'needs-portion') return s.result ? { ...s.result } : { status: 'needs-portion' };
      if (s.status === 'needs-count') return s.result ? { ...s.result } : { status: 'needs-count' };
      return { status: 'error', calculatedAt: new Date().toISOString() };
    },

    /* ----- saved records (Diary cards) ----- */

    // A saved dish.nutrition -> the { status, result } shape the renderers take.
    fromSaved(saved){
      return saved && saved.status ? { status: saved.status, result: saved } : null;
    },

    // Recalculates one saved dish now (no debounce, no state) — for edits
    // made after saving. { name, category, detail } -> saved-result object.
    calculate(dish){
      return request(toPayload(dish));
    },

    // Whole-meal figure from saved dishes (only dishes with a number add in).
    mealFromSaved(dishes){
      const list = (dishes || []).filter(d => d && d.nutrition);
      const ok = list.filter(d => d.nutrition.status === 'ok');
      return { totalKcal: ok.reduce((s, d) => s + d.nutrition.kcal, 0), estimatedDishes: ok.length, unavailableDishes: list.length - ok.length, note: '估算值' };
    },

    // What gets saved with the meal record for the whole meal.
    mealSnapshot(ids){
      const sum = API.summary(ids);
      return { totalKcal: sum.kcal, estimatedDishes: sum.estimated, unavailableDishes: sum.unavailable + sum.pending + sum.needsPortion + sum.needsCount, note: '估算值' };
    },

    // Group B: a countable dish whose count the user hasn't confirmed: 待補數量
    markNeedsCount(id, countUnit){
      let s = states.get(id);
      if (!s){ s = { seq: 0 }; states.set(id, s); }
      clearTimeout(s.timer);
      s.seq += 1;
      s.status = 'needs-count';
      s.result = { status: 'needs-count', countUnit: countUnit || null };
      emit(id);
    },

    // Group B: a described dish that can't be calculated yet (no portion):
    // shows 待補份量; any reply still in flight for it is ignored.
    markNeedsPortion(id){
      let s = states.get(id);
      if (!s){ s = { seq: 0 }; states.set(id, s); }
      clearTimeout(s.timer);
      s.seq += 1;
      s.status = 'needs-portion';
      s.result = null;
      emit(id);
    }
  };

  window.PictaCalorie = API;
})();
