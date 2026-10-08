/**
 * PictaSync — study-data upload with an offline queue, shared by both groups.
 *
 *  - enqueue(record, photo): the record goes into the localStorage upload
 *    queue FIRST (and the photo into IndexedDB), then an upload is tried —
 *    so a meal is never lost to a failed request. POST /api/records uses the
 *    record id as the Firestore document id, so a retry can never duplicate.
 *  - Retries: at start, when the browser comes back online, when the page
 *    becomes visible, and every RETRY_MS.
 *  - Fires `pictameal:sync-update` { id, status: 'synced' | 'pending' }.
 *  - Also: the device's own copy of the Diary (loadDiary / saveDiary) and the
 *    photo helpers (compressPhoto, shrink).
 * Every storage access is wrapped in try/catch: blocked storage only means
 * the queue / diary copy lives in memory for this page load.
 */
(function(){
  'use strict';

  const QUEUE_KEY = 'pictameal:uploadQueue';
  const DIARY_KEY = 'pictameal:diary';
  const RETRY_MS = 60000;
  const TIMEOUT_MS = 60000;           // Render's cold start can take ~50 s
  const EVENT = 'pictameal:sync-update';

  let backendUrl = '';
  let queue = [];                     // [{ id, record, hasPhoto, photoInline?, attempts, errors, queuedAt }]
  let flushing = null;

  /* ---------- localStorage ---------- */
  function readJson(key, fallback){
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (err){ return fallback; }
  }
  function writeJson(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err){ console.warn('[sync] could not write', key, err && err.name); return false; }
  }
  function saveQueue(){
    if (writeJson(QUEUE_KEY, queue)) return;
    // out of space: keep the records, move any inline photo out (it stays in memory)
    writeJson(QUEUE_KEY, queue.map(({ photoInline, ...e }) => e));
  }

  /* ---------- IndexedDB (pending photos — too big for localStorage) ---------- */
  let dbPromise = null;
  function idb(){
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open('pictameal-sync', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err){ reject(err); }
    });
    return dbPromise;
  }
  async function idbDo(mode, fn){
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', mode);
      const req = fn(tx.objectStore('photos'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const putPhoto = (id, data) => idbDo('readwrite', s => s.put(data, id));
  const getPhoto = id => idbDo('readonly', s => s.get(id));
  const delPhoto = id => idbDo('readwrite', s => s.delete(id)).catch(() => {});

  /* ---------- queue ---------- */
  function emit(id, status){
    document.dispatchEvent(new CustomEvent(EVENT, { detail: { id, status } }));
  }

  async function enqueue(record, photoDataUrl){
    const old = queue.find(e => e.id === record.id);
    const entry = {
      id: record.id,
      record,
      // a re-sync without a photo must not drop a photo still waiting to go up
      hasPhoto: !!photoDataUrl || !!(old && old.hasPhoto),
      photoInline: old && old.photoInline,
      attempts: old ? old.attempts : 0,
      errors: old ? old.errors : [],
      queuedAt: old ? old.queuedAt : new Date().toISOString()
    };
    if (photoDataUrl){
      try { await putPhoto(record.id, photoDataUrl); entry.photoInline = undefined; }
      catch (err){ entry.photoInline = photoDataUrl; } // no IndexedDB: keep it in the queue
    }
    queue = queue.filter(e => e.id !== record.id).concat(entry);
    saveQueue();
    emit(record.id, 'pending');
    flush();
  }

  function isPending(id){ return queue.some(e => e.id === id); }

  async function uploadOne(entry){
    let photo = null;
    if (entry.hasPhoto){
      photo = entry.photoInline || null;
      if (!photo){ try { photo = await getPhoto(entry.id); } catch (err){ photo = null; } }
    }
    const record = {
      ...entry.record,
      upload: { attempts: entry.attempts + 1, errors: entry.errors.slice(-20), queuedAt: entry.queuedAt }
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${backendUrl}/api/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(photo ? { record, photo } : { record }),
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  // Uploads the queue in order; one run at a time.
  function flush(){
    if (!backendUrl) return Promise.resolve();
    if (flushing) return flushing;
    const snapshot = queue.slice();
    flushing = (async () => {
      for (const entry of snapshot){
        if (!queue.includes(entry)) continue;           // replaced meanwhile by a newer version
        try {
          await uploadOne(entry);
          if (queue.includes(entry)){                   // not re-queued while it was in flight
            queue = queue.filter(e => e !== entry);
            saveQueue();
            if (entry.hasPhoto) delPhoto(entry.id);
            emit(entry.id, 'synced');
          }
        } catch (err){
          entry.attempts += 1;
          entry.errors.push({ at: new Date().toISOString(), message: String((err && err.name === 'AbortError') ? 'timeout' : (err && err.message) || err).slice(0, 200) });
          if (entry.errors.length > 20) entry.errors = entry.errors.slice(-20);
          saveQueue();
          emit(entry.id, 'pending');
        }
      }
    })().finally(() => {
      flushing = null;
      // a record (re)queued while this run was going goes up right away
      if (queue.some(e => !snapshot.includes(e) && e.attempts === 0)) setTimeout(flush, 0);
    });
    return flushing;
  }

  /* ---------- photos ---------- */
  function loadImage(dataUrl){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
  const dataUrlBytes = u => Math.floor((u.length - u.indexOf(',') - 1) * 3 / 4) - (u.endsWith('==') ? 2 : u.endsWith('=') ? 1 : 0);

  // Long edge <= maxEdge, JPEG at `quality`, lowered (then the size reduced)
  // until it is under maxBytes.
  async function compressPhoto(dataUrl, opts = {}){
    const maxEdge = opts.maxEdge || 1024;
    const maxBytes = opts.maxBytes || 900 * 1024;
    let quality = opts.quality || 0.7;
    const img = await loadImage(dataUrl);
    let scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    for (;;){
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const cnv = document.createElement('canvas');
      cnv.width = w; cnv.height = h;
      cnv.getContext('2d').drawImage(img, 0, 0, w, h);
      const out = cnv.toDataURL('image/jpeg', quality);
      const bytes = dataUrlBytes(out);
      if (bytes <= maxBytes || (quality <= 0.3 && scale < 0.2)) return { dataUrl: out, width: w, height: h, bytes, quality: Math.round(quality * 100) / 100 };
      if (quality > 0.3) quality = Math.max(0.3, quality - 0.1);
      else scale *= 0.8;
    }
  }

  // A small copy for the device's Diary (local storage only).
  async function shrink(dataUrl, maxEdge, quality){
    try { return (await compressPhoto(dataUrl, { maxEdge, quality, maxBytes: 200 * 1024 })).dataUrl; }
    catch (err){ return ''; }
  }

  /* ---------- the device's Diary copy ---------- */
  function loadDiary(){ return readJson(DIARY_KEY, []); }
  // entries newest last; on a full storage, drop the photos of the oldest first
  function saveDiary(entries){
    if (writeJson(DIARY_KEY, entries)) return;
    for (let keep = Math.min(entries.length, 20); keep >= 0; keep = keep ? Math.floor(keep / 2) : -1){
      const slim = entries.map((e, i) => (i < entries.length - keep ? { ...e, photo: '' } : e));
      if (writeJson(DIARY_KEY, slim)) return;
    }
  }

  window.PictaSync = {
    init(opts){
      backendUrl = String((opts && opts.backendUrl) || '').replace(/\/$/, '');
      queue = readJson(QUEUE_KEY, []).filter(e => e && e.id && e.record);
      window.addEventListener('online', () => flush());
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
      setInterval(flush, RETRY_MS);
      flush();
    },
    enqueue, flush, isPending, compressPhoto, shrink, loadDiary, saveDiary,
    pendingCount: () => queue.length
  };
})();
