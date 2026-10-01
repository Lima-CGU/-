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
      salt: x.salt
    };
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
        st.status = data.status;       // 'ok' | 'none' | 'anomaly'
        st.result = { ...data, calculatedAt: new Date().toISOString() };
      } else {
        st.status = 'error';
        st.result = null;
      }
    } catch (err){
      if (states.get(dishId) !== st || st.seq !== seq) return;
      console.error('[calorie] request failed:', err);
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
      const out = { kcal: 0, estimated: 0, unavailable: 0, pending: 0, total: 0 };
      (ids || []).forEach(id => {
        const s = states.get(id);
        if (!s) return;
        out.total += 1;
        if (s.status === 'loading') out.pending += 1;
        else if (s.status === 'ok'){ out.kcal += s.result.kcal; out.estimated += 1; }
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
      if (st.status !== 'ok'){ el.classList.add('is-none'); el.textContent = '無法估算'; return; }
      el.classList.add(st.result.match === 'approx' ? 'is-approx' : 'is-ok');
      el.append(`${st.result.kcal} kcal`);
      if (st.result.match === 'approx'){
        const small = document.createElement('small');
        small.textContent = '近似';
        el.appendChild(small);
      }
    },

    // Photo label line: only when there is a number.
    labelText(st){
      return st && st.status === 'ok' ? `${st.result.kcal} kcal` : '';
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
      return { status: 'error', calculatedAt: new Date().toISOString() };
    },

    // What gets saved with the meal record for the whole meal.
    mealSnapshot(ids){
      const sum = API.summary(ids);
      return { totalKcal: sum.kcal, estimatedDishes: sum.estimated, unavailableDishes: sum.unavailable + sum.pending, note: '估算值' };
    }
  };

  window.PictaCalorie = API;
})();
