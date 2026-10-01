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
  const SOURCE_LABEL = {
    foods1000: '老師提供的食材資料',
    tfnd: '衛福部食藥署食品營養成分資料庫'
  };
  const MATCH_LABEL = { exact: '完全相符', close: '相近(做法或名稱略有不同)', approx: '近似(不同但最接近)' };

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

    // Beside the dish name: 計算中… / 約 N kcal / 約 N kcal(近似) / 無法估算
    badgeText(st){
      if (!st) return '';
      if (st.status === 'loading') return '計算中…';
      if (st.status === 'ok') return `約 ${st.result.kcal} kcal${st.result.match === 'approx' ? '(近似)' : ''}`;
      return '無法估算';
    },

    // Small text on the photo label: only when there is a number.
    labelText(st){
      return st && st.status === 'ok' ? `${st.result.match === 'approx' ? '≈' : ''}${st.result.kcal} kcal` : '';
    },

    // 整餐 line under/next to the progress. '' when there is nothing to say yet.
    totalText(sum){
      if (!sum || !sum.total) return '';
      const parts = [];
      if (sum.estimated) parts.push(`整餐約 ${sum.kcal} kcal`);
      else if (sum.pending) parts.push('整餐熱量計算中…');
      if (sum.estimated || sum.pending) parts.push('估算值');
      if (sum.estimated && sum.pending) parts.push(`${sum.pending} 道計算中`);
      if (sum.unavailable) parts.push(`另有 ${sum.unavailable} 道無法估算`);
      return parts.join('・');
    },

    // Fills `el` with the expandable explanation (item, source, how it was computed).
    renderExplain(el, st){
      el.textContent = '';
      if (!st || st.status === 'loading') return;
      const add = (label, value) => {
        const row = document.createElement('div');
        row.className = 'kcal-explain-row';
        const k = document.createElement('span');
        k.className = 'kcal-explain-k';
        k.textContent = label;
        const v = document.createElement('span');
        v.className = 'kcal-explain-v';
        v.textContent = value;
        row.append(k, v);
        el.appendChild(row);
      };
      const r = st.result;
      if (st.status === 'ok'){
        add('比對品項', r.matchedName);
        add('比對程度', MATCH_LABEL[r.match] || r.match);
        add('資料來源', r.sourceLabel || SOURCE_LABEL[r.source] || r.source);
        add('計算說明', r.explanation);
        const n = [];
        if (r.proteinG != null) n.push(`蛋白質 ${r.proteinG} g`);
        if (r.fatG != null) n.push(`脂肪 ${r.fatG} g`);
        if (r.carbohydrateG != null) n.push(`醣類 ${r.carbohydrateG} g`);
        if (r.sodiumMg != null) n.push(`鈉 ${r.sodiumMg} mg`);
        if (n.length) add('其他營養', n.join('・'));
      } else if (st.status === 'anomaly'){
        add('說明', '比對到的資料換算後熱量異常,視為資料異常,不顯示數字。');
        if (r && r.matchedName) add('比對品項', r.matchedName);
      } else if (st.status === 'none'){
        add('說明', (r && r.explanation) || '資料庫中找不到足以代表這道菜的品項,無法估算。');
      } else {
        add('說明', '熱量計算暫時失敗,稍後修改任一欄位會重新計算。');
      }
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
