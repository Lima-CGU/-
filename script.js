(() => {
  'use strict';

  /* ---------- elements ---------- */
  const steps       = document.querySelectorAll('.flow-steps li');
  const screens      = document.querySelectorAll('.screen');
  const phone        = document.getElementById('phone');

  const toCameraBtn      = document.getElementById('toCameraBtn');
  const usageLink        = document.getElementById('usageLink');
  const cameraDiaryBtn   = document.getElementById('cameraDiaryBtn');
  const diaryCameraBtn   = document.getElementById('diaryCameraBtn');
  const usageModal       = document.getElementById('usageModal');
  const usageModalClose  = document.getElementById('usageModalClose');
  const usageConfirmBtn  = document.getElementById('usageConfirmBtn');
  const startHomeBtn     = document.getElementById('startHomeBtn');
  const cameraHomeBtn    = document.getElementById('cameraHomeBtn');
  const retakeBtn        = document.getElementById('retakeBtn');
  const confirmUploadBtn = document.getElementById('confirmUploadBtn');

  const video        = document.getElementById('video');
  const canvas       = document.getElementById('canvas');
  const cameraIdle   = document.getElementById('cameraIdle');
  const cameraStatus = document.getElementById('cameraStatus');
  const retryCamBtn  = document.getElementById('retryCamBtn');
  const shotBtn       = document.getElementById('shotBtn');
  const fileInput     = document.getElementById('fileInput');
  const lastShotThumb = document.getElementById('lastShotThumb');
  const cameraThumbPlaceholder = document.querySelector('.camera-thumb-placeholder');

  const reviewImg   = document.getElementById('reviewImg');

  const recognizeStage   = document.getElementById('recognizeStage');
  const recognizeWrap    = document.getElementById('recognizeWrap');
  const recognizeContent = document.getElementById('recognizeContent');
  const recognizeZoomToggle = document.getElementById('recognizeZoomToggle');
  const recognizePhoto   = document.getElementById('recognizePhoto');
  const recognizeOverlay = document.getElementById('recognizeOverlay');
  const manualBoxSpawner = document.getElementById('manualBoxSpawner');
  const confirmProgress  = document.getElementById('confirmProgress');
  const recognizeScreen  = document.querySelector('.screen[data-screen="recognize"]');
  const recognizeBody    = recognizeScreen.querySelector('.recognize-body');
  const recognizeNextBtn = document.getElementById('recognizeNextBtn');
  const reportAddDishBtn = document.getElementById('reportAddDishBtn');

  // Research study arm. Never rendered anywhere on screen — participants
  // must not learn another group exists; it's only written into each saved
  // meal record. Resolution order:
  //   1. ?group=A / ?group=B in the URL (always wins, so a research
  //      assistant can switch a device by opening a link) — also saved to
  //      localStorage;
  //   2. otherwise the last group saved — e.g. when launched from the
  //      home-screen PWA icon, whose start_url has no query string;
  //   3. otherwise A.
  const STUDY_GROUP_STORAGE_KEY = 'pictameal:studyGroup';
  const STUDY_GROUP = (() => {
    const fromUrl = (new URLSearchParams(location.search).get('group') || '').trim().toUpperCase();
    if (fromUrl === 'A' || fromUrl === 'B'){
      try { localStorage.setItem(STUDY_GROUP_STORAGE_KEY, fromUrl); } catch (err){ /* storage unavailable */ }
      return fromUrl;
    }
    try {
      const saved = localStorage.getItem(STUDY_GROUP_STORAGE_KEY);
      if (saved === 'A' || saved === 'B') return saved;
    } catch (err){ /* storage unavailable */ }
    return 'A';
  })();

  // Participant id for the study data — like the group: ?pid=P001 wins and
  // is remembered (localStorage); otherwise the saved one; otherwise "TEST".
  // Never shown on screen.
  const PID_STORAGE_KEY = 'pictameal:pid';
  const PARTICIPANT_ID = (() => {
    const ok = v => /^[A-Za-z0-9_-]{1,40}$/.test(v);
    const fromUrl = (new URLSearchParams(location.search).get('pid') || '').trim();
    if (ok(fromUrl)){
      try { localStorage.setItem(PID_STORAGE_KEY, fromUrl); } catch (err){ /* storage unavailable */ }
      return fromUrl;
    }
    try {
      const saved = localStorage.getItem(PID_STORAGE_KEY);
      if (saved && ok(saved)) return saved;
    } catch (err){ /* storage unavailable */ }
    return 'TEST';
  })();

  // Upload a compressed copy of each meal photo with the record
  // (Firestore "photos" collection). false = never upload photos.
  const SAVE_PHOTOS = true;

  // Countable foods (/api/detect count): the units, and 1..COUNT_MAX
  const COUNT_UNITS = ['隻', '顆', '個', '片', '根', '塊', '粒', '條'];
  const COUNT_MAX = 50;
  const withCount = (name, d) => (d && d.count ? `${name} ×${d.count}` : d && d.countable ? `${name} ×?` : name);

  // App version stored with every record = sw.js's CACHE_NAME (read from the
  // cached sw.js, so it is the version of the shell actually running).
  let APP_VERSION = 'unknown';
  fetch('./sw.js').then(r => r.text()).then(t => {
    const m = /CACHE_NAME\s*=\s*['"]([^'"]+)['"]/.exec(t);
    if (m) APP_VERSION = m[1];
  }).catch(() => {});

  // Page 3 (this recognize screen) is a read-only "initial result" view for
  // both groups: a numbered marker + name per dish, no editing. The editing
  // machinery (confirm dots, × delete, manual + box, low-confidence picker,
  // auto-advance, progress text) is kept in code for Page 4 but switched
  // off here — via this flag in JS and the .recognize-preview class in CSS.
  const RECOGNIZE_PREVIEW_ONLY = true;
  recognizeScreen.classList.toggle('recognize-preview', RECOGNIZE_PREVIEW_ONLY);

  // Every saved meal, with its group and each dish's full-photo box — the
  // data a later upload / Page 4 needs (the Diary cards are only a view).
  const mealRecords = [];
  const finishRecognizeBtn = document.getElementById('finishRecognizeBtn');

  const strip      = document.getElementById('strip');
  const emptyState = document.getElementById('emptyState');
  const countTag   = document.getElementById('countTag');
  const toast       = document.getElementById('toast');

  let stream = null;
  let currentPhotoData = null;
  // Study data for the meal in progress (times, AI originals, edits, API
  // errors) — reset for every new photo, saved with the record.
  let currentMealMeta = null;
  function newMealMeta(){
    return {
      startedAt: new Date().toISOString(), nextAt: null,
      aiDetections: [],
      editLog: { renameCount: 0, fieldSetCount: 0, fieldChangeCount: 0, deletedDishes: [], addedDishes: [], diaryEditCount: 0, diaryDeletedDishes: [] },
      apiErrors: []
    };
  }
  function logApiError(api, message){
    if (!currentMealMeta) return;
    currentMealMeta.apiErrors.push({ api, at: new Date().toISOString(), message: String(message || '').slice(0, 200) });
  }
  document.addEventListener('pictameal:api-error', e => {
    if (reportActive) logApiError(e.detail.api, e.detail.message);
  });
  let mealCount = 0;
  // Set while the camera is being used to add one more dish to an already-
  // saved meal record, instead of starting a brand-new one — holds refs to
  // that meal card's own dish-list container and dish-count label. Cleared
  // whenever the user bails out (Home/Diary) without actually taking a photo.
  let addDishTargetMeal = null;

  /* ---------- toast ---------- */
  let toastTimer = null;
  function showToast(msg){
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  /* ---------- screen navigation: iOS-style push/pop slide ---------- */
  // Order of screens along the main flow, used only to decide whether a
  // transition is a forward "push" (slide from the right) or a backward
  // "pop" (slide from the left) — diary sits after recognize since it's
  // reached once a meal is saved, or from the tab bar.
  const SCREEN_ORDER = ['start', 'camera', 'review', 'recognize', 'report', 'diary'];

  function getScreenEl(name){
    return document.querySelector(`.screen[data-screen="${name}"]`);
  }

  let pendingSlideCleanup = null;

  function finishSlide(fromEl, toEl){
    fromEl.classList.remove('active', 'slide-exit', 'slide-enter', 'slide-start');
    toEl.classList.remove('slide-enter', 'slide-exit', 'slide-start');
    toEl.classList.add('active');
    phone.classList.remove('slide-push', 'slide-pop');
  }

  function slideToScreen(fromEl, toEl, isForward){
    // If a previous transition is still in flight (rapid navigation),
    // snap it straight to its end state before starting the new one.
    if (pendingSlideCleanup){
      pendingSlideCleanup();
      pendingSlideCleanup = null;
    }

    phone.classList.remove('slide-push', 'slide-pop');
    phone.classList.add(isForward ? 'slide-push' : 'slide-pop');

    fromEl.classList.remove('active');
    fromEl.classList.add('slide-exit');
    toEl.classList.add('slide-enter', 'slide-start');

    // Commit the entering screen's off-screen starting position before
    // moving it, so the browser has a real "before" frame to animate from.
    void toEl.offsetWidth;

    const cleanup = () => {
      toEl.removeEventListener('transitionend', onTransitionEnd);
      clearTimeout(fallbackTimer);
      finishSlide(fromEl, toEl);
      pendingSlideCleanup = null;
    };
    function onTransitionEnd(e){
      if (e.target === toEl && e.propertyName === 'transform') cleanup();
    }
    toEl.addEventListener('transitionend', onTransitionEnd);
    const fallbackTimer = setTimeout(cleanup, 420);
    pendingSlideCleanup = cleanup;

    requestAnimationFrame(() => {
      toEl.classList.remove('slide-start');
    });
  }

  function goToScreen(name){
    const fromName = phone.dataset.screen;

    // Leaving the recognize screen for any reason (home icon, the
    // auto-advance itself) should drop a pending auto-advance — it must
    // never fire later while the user is looking at some other screen.
    if (fromName === 'recognize' && name !== 'recognize' && typeof cancelAutoAdvance === 'function'){
      cancelAutoAdvance();
    }

    // Bailing out to Home or Diary without ever taking the add-dish photo
    // (the success path itself already clears this before navigating away,
    // so this is purely a safety net for an abandoned attempt).
    if (name === 'start' || name === 'diary'){
      addDishTargetMeal = null;
    }

    steps.forEach(li => {
      li.classList.toggle('active', li.dataset.step === name);
      const order = ['start', 'camera', 'review', 'recognize'];
      li.classList.toggle('done', order.indexOf(li.dataset.step) < order.indexOf(name));
    });
    phone.dataset.screen = name;
    if (name === 'camera') openCamera();
    else closeCamera();

    if (name === fromName) return;

    const fromEl = getScreenEl(fromName);
    const toEl = getScreenEl(name);
    if (!fromEl || !toEl){
      screens.forEach(s => s.classList.toggle('active', s.dataset.screen === name));
      return;
    }

    const isForward = SCREEN_ORDER.indexOf(name) > SCREEN_ORDER.indexOf(fromName);
    slideToScreen(fromEl, toEl, isForward);
  }

  cameraDiaryBtn.addEventListener('click', () => goToScreen('diary'));
  diaryCameraBtn.addEventListener('click', () => goToScreen('start'));

  function openUsageModal(){
    usageModal.hidden = false;
  }

  function closeUsageModal(){
    usageModal.hidden = true;
  }

  usageLink.addEventListener('click', e => {
    e.preventDefault();
    openUsageModal();
  });
  usageModalClose.addEventListener('click', closeUsageModal);
  usageConfirmBtn.addEventListener('click', closeUsageModal);
  toCameraBtn.addEventListener('click', () => goToScreen('camera'));
  startHomeBtn?.addEventListener('click', () => goToScreen('start'));
  cameraHomeBtn?.addEventListener('click', () => goToScreen('start'));
  retakeBtn.addEventListener('click', () => goToScreen('camera'));

  /* ---------- camera ---------- */
  async function openCamera(){
    cameraIdle.classList.remove('hidden');
    cameraStatus.textContent = '正在開啟鏡頭…';
    retryCamBtn.hidden = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      video.srcObject = stream;
      video.classList.add('active');
      cameraIdle.classList.add('hidden');
      shotBtn.disabled = false;
    } catch (err){
      cameraStatus.textContent = '無法開啟鏡頭,請確認權限已允許,或改用「從相簿選」';
      retryCamBtn.hidden = false;
      shotBtn.disabled = true;
    }
  }

  function closeCamera(){
    if (stream){
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    video.classList.remove('active');
    shotBtn.disabled = true;
  }

  retryCamBtn.addEventListener('click', openCamera);

  function updateLastShotThumb(dataUrl){
    lastShotThumb.src = dataUrl;
    lastShotThumb.hidden = false;
    if (cameraThumbPlaceholder) cameraThumbPlaceholder.hidden = true;
  }

  function useDataUrl(dataUrl){
    currentPhotoData = dataUrl;
    reviewImg.src = dataUrl;
    updateLastShotThumb(dataUrl);
    goToScreen('review');
  }

  shotBtn.addEventListener('click', () => {
    if (!stream) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    useDataUrl(canvas.toDataURL('image/jpeg', 0.92));
  });

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => useDataUrl(ev.target.result);
    reader.readAsDataURL(file);
  });

  /* ---------- confirm upload -> log entry ---------- */
  function timestamp(){
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDishDetail(detail){
    if (!detail) return '';
    const containerMap = { plate: '盤子', bowl: '碗', cup: '杯子' };
    const parts = [];

    if (detail.containerType) {
      parts.push(containerMap[detail.containerType] || detail.containerType);
    }
    if (detail.size) {
      parts.push(detail.size);
    }
    if (detail.cookingMethod) {
      parts.push(detail.cookingMethod);
    }
    if (detail.sugar) {
      parts.push(detail.sugar);
    }
    if (detail.salt) {
      parts.push(detail.salt.replace(/\s+/g, ''));
    }
    return parts.join('・');
  }

  // Split "菜名(97%)" into the dish name and the confidence number, so the
  // bounding-box label can show the name as the primary text and the
  // confidence as a smaller, secondary detail.
  function splitNameConfidence(fullName){
    const match = /^(.*?)\((\d+%)\)$/.exec(fullName || '');
    return match ? { name: match[1], confidence: match[2] } : { name: fullName || '', confidence: '' };
  }

  function renderDetLabel(labelEl, det){
    const base = det && !det.loading && det.name ? det.name : '辨識中…';
    const { name, confidence } = splitNameConfidence(base);
    // Page 3/4 labels are just "name + confidence" — the filled-in details
    // live in Page 4's panel, and would only make crowded labels longer.
    const detailText = det && !RECOGNIZE_PREVIEW_ONLY ? formatDishDetail(det.detail) : '';

    labelEl.innerHTML = '';
    const lineEl = document.createElement('span');
    lineEl.className = 'det-label-line';
    labelEl.appendChild(lineEl);
    const nameEl = document.createElement('span');
    nameEl.className = 'det-label-name';
    nameEl.textContent = det && !det.loading ? withCount(name, det) : name;
    lineEl.appendChild(nameEl);

    const metaText = [confidence, detailText].filter(Boolean).join(' · ');
    if (metaText){
      const metaEl = document.createElement('span');
      metaEl.className = 'det-label-meta';
      metaEl.textContent = metaText;
      lineEl.appendChild(metaEl);
    }

    // Page 4 only (results exist only after a dish is filled in): the dish's
    // estimated calories, small, at the end of the label.
    const kcalState = det && window.PictaCalorie ? window.PictaCalorie.getState(det.id) : null;
    const kcalText = kcalState ? window.PictaCalorie.labelText(kcalState) : '';
    if (kcalText){
      const kcalEl = document.createElement('span');
      kcalEl.className = `det-label-kcal ${window.PictaCalorie.labelClass(kcalState)}`.trim();
      kcalEl.textContent = kcalText;
      labelEl.appendChild(kcalEl);
    }
  }

  // Line icons (not emoji — emoji glyphs carry their own fixed colors and
  // ignore CSS `color`, so a uniform purple line-icon look needs real SVG)
  // for each attribute row, matching the reference UI's icon style.
  const DIARY_ICON_COOKING = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="10" cy="13" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="15" y1="10" x2="20" y2="6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const DIARY_ICON_PORTION = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M4 11h16a8 8 0 0 1-16 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 11c0-2.2 1.8-4 4-4s4 1.8 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const DIARY_ICON_SUGAR = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const DIARY_ICON_SALT = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M9.5 4h5l.9 2.5h-6.8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.4 6.5h7.2L14.4 19a1 1 0 0 1-1 1h-2.8a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="10.8" cy="10" r=".6" fill="currentColor"/><circle cx="13.2" cy="10" r=".6" fill="currentColor"/><circle cx="12" cy="12.4" r=".6" fill="currentColor"/></svg>';

  // The paper's AI only recognizes the dish name — portion/cooking/sugar/
  // salt are always filled in by the user by hand, for every dish, not as
  // an occasional correction. Since that makes it a mandatory per-dish step
  // rather than a rare fix, the spec's separate "Edit" (name) and "Expand"
  // (attributes) entries are merged into one ✏️ editor here, instead of
  // making the user open two different places to describe one dish.
  const DIARY_ATTR_FIELDS = [
    { icon: DIARY_ICON_COOKING, get: d => d.cookingMethod || '' },
    { icon: DIARY_ICON_PORTION, get: d => {
      const containerMap = { plate: '盤子', bowl: '碗', cup: '杯子' };
      const parts = [];
      if (d.containerType) parts.push(containerMap[d.containerType] || d.containerType);
      if (d.size) parts.push(d.size);
      return parts.join('・');
    } },
    { icon: DIARY_ICON_SUGAR, get: d => d.sugar || '' },
    { icon: DIARY_ICON_SALT, get: d => d.salt ? d.salt.replace(/\s+/g, '') : '' }
  ];

  // One row per saved dish in the Diary: its own bounding-box crop thumbnail,
  // name, a bordered block listing cooking method / portion / sugar / salt
  // (blank until the user fills them in — no placeholder example text), and
  // three actions: 🎤 voice-correct the name, ✏️ open the merged name +
  // attributes editor, 🗑️ delete this dish.
  function renderDiaryDishRow(dish, meta){
    const row = document.createElement('div');
    row.className = 'meal-dish-row';

    const thumb = document.createElement('img');
    thumb.className = 'meal-dish-thumb';
    thumb.src = dish.thumbUrl || '';
    thumb.alt = dish.name || '';
    row.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'meal-dish-body';

    const nameEl = document.createElement('span');
    nameEl.className = 'meal-dish-name';
    nameEl.textContent = withCount(dish.name, dish);
    const headEl = document.createElement('div');
    headEl.className = 'meal-dish-head';
    headEl.appendChild(nameEl);
    body.appendChild(headEl);

    // Saved calories (same tag + explanation as Page 4). Only dishes saved
    // with a result have one — older records and Group B show nothing.
    const kcalTag = document.createElement('button');
    kcalTag.type = 'button';
    kcalTag.className = 'kcal-tag';
    kcalTag.setAttribute('aria-expanded', 'false');
    const kcalExplain = document.createElement('div');
    kcalExplain.className = 'kcal-explain';
    kcalExplain.hidden = true;
    let kcalOpen = false;
    let kcalLoading = false;
    const renderKcal = () => {
      const st = kcalLoading ? { status: 'loading' } : window.PictaCalorie.fromSaved(dish.nutrition);
      const expandable = !!st && st.status !== 'loading';
      if (!expandable) kcalOpen = false;
      kcalTag.hidden = !st;
      window.PictaCalorie.renderBadge(kcalTag, st);
      kcalTag.disabled = !expandable;
      kcalTag.setAttribute('aria-expanded', String(kcalOpen));
      kcalExplain.hidden = !kcalOpen;
      if (kcalOpen) window.PictaCalorie.renderExplain(kcalExplain, st);
    };
    kcalTag.addEventListener('click', () => { kcalOpen = !kcalOpen; renderKcal(); });
    headEl.appendChild(kcalTag);
    body.appendChild(kcalExplain);
    renderKcal();

    // Group B: what the user said that doesn't fit a field (from the chat)
    if (dish.notes && dish.notes.length){
      const notesEl = document.createElement('div');
      notesEl.className = 'meal-dish-notes';
      notesEl.textContent = `備註:${dish.notes.join(';')}`;
      body.appendChild(notesEl);
    }

    // After a ✏️ edit: recalculate a dish that had calories (only the last
    // edit's reply is kept), then refresh the card's meal total.
    let kcalSeq = 0;
    const recalcKcal = async () => {
      if (!dish.nutrition) return;
      const seq = ++kcalSeq;
      kcalLoading = true;
      renderKcal();
      const result = await window.PictaCalorie.calculate(dish);
      if (seq !== kcalSeq) return;
      kcalLoading = false;
      dish.nutrition = result;
      if (result && (result.status === 'needs-count' || result.countable) && !dish.countable){
        dish.countable = true;
        dish.countUnit = dish.countUnit || result.countUnit || result.itemUnit || null;
        nameEl.textContent = withCount(dish.name, dish);
      }
      renderKcal();
      if (meta && meta.refreshTotal) meta.refreshTotal();
      if (meta && meta.record) syncRecordSoon(meta.record);
    };

    const attrsBox = document.createElement('div');
    attrsBox.className = 'meal-dish-attrs';
    const attrValueEls = DIARY_ATTR_FIELDS.map(field => {
      const attrRow = document.createElement('div');
      attrRow.className = 'meal-dish-attr';
      const iconEl = document.createElement('span');
      iconEl.className = 'meal-dish-attr-icon';
      iconEl.innerHTML = field.icon;
      const valueEl = document.createElement('span');
      valueEl.className = 'meal-dish-attr-value';
      valueEl.textContent = field.get(dish.detail || {});
      attrRow.append(iconEl, valueEl);
      attrsBox.appendChild(attrRow);
      return valueEl;
    });
    body.appendChild(attrsBox);

    row.appendChild(body);

    // Recognize-screen dets refresh their own labelEl; a Diary dish has no
    // labelEl, so applyVoiceResult/confirmDetailAdjust call this instead.
    dish.refreshRow = () => {
      nameEl.textContent = withCount(dish.name, dish);
      DIARY_ATTR_FIELDS.forEach((field, i) => {
        attrValueEls[i].textContent = field.get(dish.detail || {});
      });
      if (meta && meta.record){
        meta.record.editLog = meta.record.editLog || {};
        meta.record.editLog.diaryEditCount = (meta.record.editLog.diaryEditCount || 0) + 1;
        meta.record.lastEditedAt = new Date().toISOString();
        syncRecordSoon(meta.record);
      }
      recalcKcal();
    };

    const actions = document.createElement('div');
    actions.className = 'meal-dish-actions';

    const actionsTop = document.createElement('div');
    actionsTop.className = 'meal-dish-actions-top';

    const micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'meal-dish-mic-btn';
    micBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3M9 20h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    micBtn.setAttribute('aria-label', `用語音修正「${dish.name}」的菜名`);
    micBtn.addEventListener('click', () => openVoiceModal(dish, 'name'));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'meal-dish-edit-btn';
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M4 20l1-4.2L15.6 5.2a1.5 1.5 0 0 1 2.1 0l1.1 1.1a1.5 1.5 0 0 1 0 2.1L8.2 19l-4.2 1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    editBtn.setAttribute('aria-label', `編輯「${dish.name}」的菜名與細部屬性`);
    editBtn.addEventListener('click', () => openDetailAdjustModal(dish));

    // Group A reports with buttons only — no voice entry point anywhere
    // Group B records come from the chat — to change them, go back to the
    // chat; their cards keep only 刪除
    const chatRecord = !!(meta && meta.record && meta.record.group === 'B');
    if (STUDY_GROUP === 'A') actionsTop.append(editBtn);
    else if (!chatRecord) actionsTop.append(micBtn, editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'meal-dish-delete-btn';
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    deleteBtn.setAttribute('aria-label', `刪除「${dish.name}」這道菜`);
    deleteBtn.addEventListener('click', () => {
      row.remove();
      kcalSeq += 1; // ignore a recalculation still in flight
      if (meta) meta.dishCount = Math.max(0, meta.dishCount - 1);
      if (meta && meta.dishesEl) meta.dishesEl.textContent = `${meta.dishCount} 道菜`;
      if (meta && meta.record) meta.record.dishes = meta.record.dishes.filter(d => d !== dish);
      if (meta && meta.refreshTotal) meta.refreshTotal();
      if (meta && meta.record){
        const log = meta.record.editLog = meta.record.editLog || {};
        log.diaryDeletedDishes = (log.diaryDeletedDishes || []).concat({ name: splitNameConfidence(dish.name || '').name, at: new Date().toISOString() });
        meta.record.lastEditedAt = new Date().toISOString();
        syncRecordSoon(meta.record);
      }
    });

    actions.append(actionsTop, deleteBtn);
    row.appendChild(actions);

    return row;
  }

  function addMealCard(dataUrl, dishCount, dishes, record){
    emptyState.style.display = 'none';
    mealCount += 1;
    countTag.textContent = `${mealCount} 筆`;

    const card = document.createElement('div');
    card.className = 'meal-card';
    // data only — the group is never displayed
    if (record){
      card.dataset.mealId = record.id;
      card.dataset.group = record.group;
    }

    const img = document.createElement('img');
    img.className = 'meal-photo';
    img.src = dataUrl;
    img.alt = `餐點照片,標記 ${dishCount} 道菜`;

    const dishesEl = document.createElement('span');
    dishesEl.className = 'meal-dishes';
    dishesEl.textContent = `${dishCount} 道菜`;
    const meta = document.createElement('div');
    meta.className = 'meal-meta';

    const timeEl = document.createElement('span');
    timeEl.className = 'meal-time';
    timeEl.textContent = record && record.createdAt ? formatMealTime(record.createdAt) : timestamp();

    // upload state, small: 已同步 / 等待上傳
    const syncEl = document.createElement('span');
    syncEl.className = 'meal-sync';
    if (record){
      card.dataset.recordId = record.id;
      renderSyncStatus(syncEl, record.syncStatus);
    } else {
      syncEl.hidden = true;
    }

    // "整餐 N kcal 估算值" beside "N 道菜" — from the saved results only;
    // hidden for records saved without calories (older ones, Group B).
    const totalKcalEl = document.createElement('span');
    totalKcalEl.className = 'meal-total-kcal';
    const totalNumEl = document.createElement('span');
    const totalNoteEl = document.createElement('small');
    totalNoteEl.textContent = '估算值';
    totalKcalEl.append(totalNumEl, totalNoteEl);
    const refreshTotal = () => {
      const saved = record && record.dishes ? record.dishes : [];
      const hasCalories = saved.some(d => d && d.nutrition);
      if (record) record.nutrition = hasCalories ? window.PictaCalorie.mealFromSaved(saved) : null;
      const ok = hasCalories && record.nutrition.estimatedDishes > 0;
      totalKcalEl.hidden = !ok;
      totalNumEl.textContent = ok ? `整餐 ${record.nutrition.totalKcal} kcal` : '';
    };
    refreshTotal();

    const dishCountMeta = { dishCount, dishesEl, record, refreshTotal };

    const status = document.createElement('div');

    // Lets the user add one more dish to this already-saved record later,
    // without redoing the whole capture -> detect -> confirm flow — see
    // handleAddDishPhoto/appendDishToMeal, which this button hands off to.
    const addDishBtn = document.createElement('button');
    addDishBtn.type = 'button';
    addDishBtn.className = 'meal-add-dish-btn';
    addDishBtn.textContent = '+ 新增菜色';
    addDishBtn.setAttribute('aria-label', '為這筆紀錄新增一道菜');
    addDishBtn.addEventListener('click', () => {
      addDishTargetMeal = { status, dishCountMeta, cardEl: card, record };
      goToScreen('camera');
    });

    const metaRight = document.createElement('div');
    metaRight.className = 'meal-meta-right';
    metaRight.append(addDishBtn, syncEl, timeEl);
    const metaLeft = document.createElement('div');
    metaLeft.className = 'meal-meta-left';
    metaLeft.append(dishesEl, totalKcalEl);
    meta.append(metaLeft, metaRight);

    if (dishes && dishes.length){
      status.className = 'meal-status done';
      dishes.forEach(dish => {
        status.appendChild(renderDiaryDishRow(dish, dishCountMeta));
      });
    } else {
      status.className = 'meal-status';
      status.textContent = '等待辨識';
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'meal-remove';
    removeBtn.setAttribute('aria-label', '移除這筆紀錄');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      card.remove();
      mealCount = Math.max(0, mealCount - 1);
      countTag.textContent = `${mealCount} 筆`;
      if (mealCount === 0) emptyState.style.display = 'block';
      // the study data keeps it, marked as removed from the Diary
      if (record){
        record.deletedFromDiary = true;
        record.deletedFromDiaryAt = new Date().toISOString();
        syncRecordSoon(record);
      }
    });

    card.append(img, meta, status, removeBtn);
    strip.prepend(card);
  }

  /* ---------- study data: upload + this device's Diary copy (sync.js) ---------- */
  function formatMealTime(iso){
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return timestamp();
    const pad = n => String(n).padStart(2, '0');
    const today = new Date().toDateString() === d.toDateString();
    return `${today ? '' : `${d.getMonth() + 1}/${d.getDate()} `}${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function renderSyncStatus(el, status){
    const synced = status === 'synced';
    el.textContent = synced ? '已同步' : '等待上傳';
    el.classList.toggle('is-synced', synced);
  }
  // What goes to /api/records: the record without images or UI-only fields.
  const LOCAL_ONLY_KEYS = new Set(['thumbUrl', 'localPhoto', 'syncStatus']);
  function uploadableRecord(record){
    return JSON.parse(JSON.stringify(record, (k, v) => (LOCAL_ONLY_KEYS.has(k) ? undefined : v)));
  }
  // This device's Diary (records with small thumbnails + a small photo), so
  // it survives a reload. Removed meals are not kept here.
  function persistDiary(){
    window.PictaSync.saveDiary(mealRecords.filter(r => !r.deletedFromDiary).map(r => ({
      record: JSON.parse(JSON.stringify(r, (k, v) => (k === 'localPhoto' || k === 'syncStatus' ? undefined : v))),
      photo: r.localPhoto || ''
    })));
  }
  // Diary edits after saving: upload the changed record again (same id).
  const syncTimers = new Map();
  function syncRecordSoon(record){
    clearTimeout(syncTimers.get(record.id));
    syncTimers.set(record.id, setTimeout(() => {
      syncTimers.delete(record.id);
      record.syncStatus = 'pending';
      persistDiary();
      window.PictaSync.enqueue(uploadableRecord(record), null);
    }, 1200));
  }
  document.addEventListener('pictameal:sync-update', e => {
    const { id, status } = e.detail;
    const record = mealRecords.find(r => r.id === id);
    if (!record) return;
    record.syncStatus = status;
    const el = document.querySelector(`.meal-card[data-record-id="${id}"] .meal-sync`);
    if (el) renderSyncStatus(el, status);
    persistDiary();
  });

  confirmUploadBtn.addEventListener('click', () => {
    if (!currentPhotoData) return;
    if (addDishTargetMeal){
      handleAddDishPhoto(currentPhotoData, addDishTargetMeal);
      return;
    }
    goToScreen('recognize');
    setupRecognizeScreen(currentPhotoData);
  });

  // Add-dish mode: skip /api/detect entirely (that's for finding multiple
  // dishes in a whole plate) and send the single photo straight to
  // /api/recognize, same as a manual box does. photoDataUrl/target are
  // captured here rather than re-read from the mutable globals later, so a
  // retake or a second add-dish click mid-request can't corrupt this run.
  async function handleAddDishPhoto(photoDataUrl, target){
    showToast('正在辨識新菜色…');

    let candidates = [];
    try {
      const data = await callRecognizeAPI(photoDataUrl);
      candidates = (data.dishes || [])
        .map(d => ({
          name: String(d.name || '').trim(),
          confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0))),
          category: d.category === 'beverage' ? 'beverage' : 'food'
        }))
        .filter(d => d.name && d.name !== '看不出來')
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);
    } catch (err){
      console.error('[handleAddDishPhoto] recognize call failed:', err);
      showToast('辨識失敗,請重新拍照試試');
      return;
    }

    if (!candidates.length){
      appendDishToMeal(target, { name: '辨識失敗,自己填', category: 'food' }, photoDataUrl);
      return;
    }

    const top = candidates[0];
    if (top.confidence >= CONFIDENCE_DIALOG_THRESHOLD * 100){
      appendDishToMeal(target, { name: `${top.name}(${top.confidence}%)`, category: top.category }, photoDataUrl);
      return;
    }

    // Reuses the same candidate-name bottom sheet the recognize screen uses;
    // a plain object works because openCandidateDialog/setConfirmState only
    // touch box/dot/labelEl when they exist (see setConfirmState).
    const virtualDet = { name: null, confidence: 0, category: 'food', confirmState: 'pending' };
    openCandidateDialog(virtualDet, candidates, () => {
      // onClose fires for both Confirm and Cancel; only Confirm sets a name.
      if (!virtualDet.name){
        showToast('已取消新增菜色');
        return;
      }
      appendDishToMeal(target, { name: virtualDet.name, category: virtualDet.category }, photoDataUrl);
    });
  }

  function appendDishToMeal(target, dishInfo, photoDataUrl){
    const dish = {
      name: dishInfo.name,
      detail: null,
      category: dishInfo.category === 'beverage' ? 'beverage' : 'food',
      thumbUrl: photoDataUrl
    };
    // the same object in the record and the row, so later edits reach both
    Object.assign(dish, { confidence: null, box: null, source: 'diary' });
    if (target.record){
      target.record.dishes.push(dish);
      const log = target.record.editLog = target.record.editLog || {};
      log.addedDishes = (log.addedDishes || []).concat({ name: splitNameConfidence(dish.name || '').name, source: 'diary' });
      target.record.lastEditedAt = new Date().toISOString();
    }
    target.status.appendChild(renderDiaryDishRow(dish, target.dishCountMeta));
    if (target.record) syncRecordSoon(target.record);
    target.dishCountMeta.dishCount += 1;
    target.dishCountMeta.dishesEl.textContent = `${target.dishCountMeta.dishCount} 道菜`;

    addDishTargetMeal = null;
    currentPhotoData = null;
    goToScreen('diary');
    showToast('新菜色已加入!');
    requestAnimationFrame(() => {
      target.cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  /* ---------- mock recognition (demo data, no real AI) ---------- */
  const DISH_NAME_POOL = [
    '白飯', '蕃茄炒蛋', '滷雞腿', '炒高麗菜', '味噌湯',
    '涼拌小黃瓜', '紅燒豆腐', '糖醋排骨', '蒜炒地瓜葉', '蒸魚',
    '木耳炒肉絲', '滷豆干', '玉米濃湯', '煎鮭魚', '芹菜炒豆包'
  ];
  function pickRandomNames(n){
    const pool = [...DISH_NAME_POOL];
    const picked = [];
    for (let i = 0; i < n; i++){
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0] || `菜色 ${i + 1}`);
    }
    return picked;
  }

  /* ---------- real recognition via backend (Hugging Face food model) ---------- */
  const BACKEND_URL = 'https://xianghu-backend.onrender.com';
  // Start the upload queue (retries anything left from earlier), then restore
  // this device's Diary. Here, after BACKEND_URL exists.
  window.PictaSync.init({ backendUrl: BACKEND_URL });
  (function restoreDiary(){
    const entries = window.PictaSync.loadDiary();
    entries.forEach(entry => {
      const record = entry && entry.record;
      if (!record || !record.id || !Array.isArray(record.dishes)) return;
      record.localPhoto = entry.photo || '';
      record.syncStatus = window.PictaSync.isPending(record.id) ? 'pending' : 'synced';
      mealRecords.push(record);
      addMealCard(record.localPhoto, record.dishes.length, record.dishes, record);
    });
  })();

  let backendWarned = false;

  // Design decision: the original spec always popped a candidate-name dialog
  // after AI recognition. In practice GPT-4.1's confidence is usually high
  // enough that showing the result directly is faster for the user, so the
  // dialog now only appears when confidence falls below this threshold —
  // everything else still goes through the existing pending/editing/confirmed
  // flow (voice correction, detail adjustment, manual box) unchanged.
  const CONFIDENCE_DIALOG_THRESHOLD = 0.85;

  // Crop just the boxed region out of the full photo, return a data URL of the crop
  function cropRegionToDataUrl(photoDataUrl, xPct, yPct, wPct, hPct){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const sx = (xPct / 100) * img.naturalWidth;
        const sy = (yPct / 100) * img.naturalHeight;
        const sw = (wPct / 100) * img.naturalWidth;
        const sh = (hPct / 100) * img.naturalHeight;
        const cnv = document.createElement('canvas');
        cnv.width = Math.max(1, Math.round(sw));
        cnv.height = Math.max(1, Math.round(sh));
        cnv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cnv.width, cnv.height);
        resolve(cnv.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = photoDataUrl;
    });
  }

  async function callRecognizeAPI(croppedDataUrl, attempt){
    attempt = attempt || 1;
    const res = await fetch(`${BACKEND_URL}/api/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: croppedDataUrl })
    });
    const data = await res.json();

    if (!res.ok){
      if (res.status === 503 && data.estimated_time && attempt < 3){
        await new Promise(r => setTimeout(r, Math.min(data.estimated_time, 20) * 1000));
        return callRecognizeAPI(croppedDataUrl, attempt + 1);
      }
      throw new Error(data.error || '辨識失敗');
    }
    return data;
  }

  // Crop a det's own region out of the current photo and ask /api/recognize
  // for up to 3 ranked name candidates — used both to re-check a low
  // confidence auto-detected dish and to name a freshly manual-drawn box.
  async function fetchCandidatesForDet(det){
    try {
      const cropped = await cropRegionToDataUrl(currentPhotoData, det.x, det.y, det.w, det.h);
      const data = await callRecognizeAPI(cropped);
      console.log('[fetchCandidatesForDet] raw /api/recognize dishes for det %s:', det.id, data.dishes);
      const candidates = (data.dishes || [])
        .map(d => ({
          name: String(d.name || '').trim(),
          confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0))),
          category: d.category === 'beverage' ? 'beverage' : 'food'
        }))
        // "看不出來" is GPT saying it couldn't identify anything — never show
        // it as a pickable candidate (it can carry any confidence number).
        .filter(d => d.name && d.name !== '看不出來')
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);
      if (!candidates.length){
        console.warn('[fetchCandidatesForDet] no usable candidates for det %s (raw:', det.id, data.dishes, ')');
      }
      return candidates;
    } catch (err){
      console.error('[fetchCandidatesForDet] recognize call failed for det', det.id, err);
      logApiError('recognize', err && err.message);
      return [];
    }
  }

  // Ask the backend to auto-detect every dish (position + name) in one go
  async function callDetectAPI(photoDataUrl, attempt){
    attempt = attempt || 1;
    const res = await fetch(`${BACKEND_URL}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: photoDataUrl })
    });
    const data = await res.json();

    if (!res.ok){
      if (res.status === 503 && data.estimated_time && attempt < 3){
        await new Promise(r => setTimeout(r, Math.min(data.estimated_time, 20) * 1000));
        return callDetectAPI(photoDataUrl, attempt + 1);
      }
      throw new Error(data.error || '自動辨識失敗');
    }
    return data;
  }

  function normalizeDetectionBox(raw){
    const w = Number(raw?.w ?? 0);
    const h = Number(raw?.h ?? 0);
    let x = Number(raw?.x ?? 0);
    let y = Number(raw?.y ?? 0);
    let width = Number.isFinite(w) ? w : 0;
    let height = Number.isFinite(h) ? h : 0;

    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0, w: 10, h: 10 };

    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
    width = Math.max(8, Math.min(100, width));
    height = Math.max(8, Math.min(100, height));

    const originalX = x;
    const originalY = y;
    const originalWidth = width;
    const originalHeight = height;

    if (x + width > 100) width = Math.max(8, 100 - x);
    if (y + height > 100) height = Math.max(8, 100 - y);

    // 這裡要保留整道菜的主要範圍，不要把框縮得只剩一小塊食材。
    // 只在明顯超大時做收斂，讓它能覆蓋整道菜但不會把整個容器都當進去。
    const maxDimension = 72;
    if (width > maxDimension || height > maxDimension){
      const scale = Math.min(maxDimension / width, maxDimension / height, 1);
      width *= scale;
      height *= scale;
    }

    const area = width * height;
    if (area > 4200){
      const scale = Math.sqrt(4200 / area);
      width *= scale;
      height *= scale;
    }

    // 如果仍過大，最多縮到約 68% 左右，避免把整個盤/背景都框進去
    if (width > 68 || height > 68){
      const scale = Math.min(68 / width, 68 / height, 1);
      width *= scale;
      height *= scale;
    }

    // 如果框太小，代表模型只抓到局部食材，補足到整道菜的主體範圍
    if (width < 18 || height < 18){
      const expandFactor = Math.max(1.4, 28 / Math.max(width, 1), 28 / Math.max(height, 1));
      width *= expandFactor;
      height *= expandFactor;
    }

    // 保底防止長寬過大或過小，讓 box 更像整道菜的主體區塊
    width = Math.max(18, Math.min(68, width));
    height = Math.max(18, Math.min(68, height));

    // 以原本中心點為基準縮放，避免框被擠到邊緣
    x = originalX + (originalWidth - width) / 2;
    y = originalY + (originalHeight - height) / 2;

    x = Math.max(0, Math.min(100 - width, x));
    y = Math.max(0, Math.min(100 - height, y));

    return { x, y, w: width, h: height };
  }

  // Single source of truth for "AI is working" — the spinner lives here,
  // next to the text that already says so, instead of a second indicator
  // repeating the same fact in different words further down the screen.
  function setRecognizeHint(text, loading){
    recognizeHint.textContent = text;
    recognizeHint.classList.toggle('recognize-hint-loading', !!loading);
  }

  async function autoDetectDishes(photoDataUrl){
    isAutoDetecting = true;
    updateProgress();

    if (!backendWarned){
      backendWarned = true;
      showToast('第一次辨識可能要等後端伺服器醒過來,約 30-50 秒');
    }
    setRecognizeHint('AI 正在自動框出並辨識菜色…', true);
    finishRecognizeBtn.disabled = true;

    try {
      const data = await callDetectAPI(photoDataUrl);
      const dishes = data.dishes || [];

      if (!dishes.length){
        setRecognizeHint('沒有辨識到菜色,可以拖曳左下角的框自己補一個', false);
      } else {
        const lowConfidenceDishes = [];
        dishes.forEach((d, i) => {
          const box = normalizeDetectionBox(d);
          const confidence = Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0)));
          const det = {
            id: `auto${i}`,
            x: box.x, y: box.y, w: box.w, h: box.h,
            // the box exactly as /api/detect returned it (% of the full
            // photo) — x/y/w/h above are normalizeDetectionBox()'s enlarged
            // / edge-clamped version, whose center can drift off the dish
            apiBox: { x: Number(d.x), y: Number(d.y), w: Number(d.w), h: Number(d.h) },
            name: `${d.name}(${confidence}%)`,
            confidence,
            category: d.category === 'beverage' ? 'beverage' : 'food',
            loading: false,
            confirmState: 'pending'
          };
          // what the AI said, kept even if the user renames / deletes the dish
          // countable foods: how many the AI saw (the user can change it on Page 4)
          if (Number.isInteger(d.count) && d.count >= 1 && d.count <= COUNT_MAX && COUNT_UNITS.includes(d.countUnit)){
            det.count = d.count;
            det.countUnit = d.countUnit;
            det.countEdits = 0;
          }
          det.aiOriginal = { name: String(d.name || ''), confidence, category: det.category, box: { ...det.apiBox },
            ...(det.count ? { count: det.count, countUnit: det.countUnit } : {}) };
          if (currentMealMeta) currentMealMeta.aiDetections.push({ no: i + 1, ...det.aiOriginal });
          currentDetections.push(det);
          renderOneDetection(det, i);
          if (confidence < CONFIDENCE_DIALOG_THRESHOLD * 100){
            lowConfidenceDishes.push(det);
          }
        });
        setRecognizeHint('', false);
        // Clearing the hint resizes the stage; let that re-layout (via the
        // ResizeObserver) land first so it doesn't cut the zoom animation.
        requestAnimationFrame(() => requestAnimationFrame(zoomToFood));
        // Page 3 is read-only — no low-confidence name picker here (kept for Page 4)
        if (lowConfidenceDishes.length && !RECOGNIZE_PREVIEW_ONLY){
          lowConfidenceQueue.push(...lowConfidenceDishes);
          processLowConfidenceQueue();
        }
      }
    } catch (err){
      console.error(err);
      logApiError('detect', err && err.message);
      setRecognizeHint('自動辨識失敗,請重新拍一張照片試試', false);
      showToast('自動辨識失敗,請重新拍照');
    }

    isAutoDetecting = false;
    updateProgress();
  }

  const recognizeHint    = document.getElementById('recognizeHint');

  let currentDetections = [];
  // True only while the initial /api/detect call is in flight — lets
  // updateProgress() show a distinct "still working" message instead of
  // reusing the same text/color as a genuine "0 dishes" result.
  let isAutoDetecting = false;
  // True while "下一步" is cropping thumbnails / saving, to block a double tap.
  let isSavingMeal = false;

  // Once every dish is confirmed (and none is mid-edit, mid-recognition, or a
  // freshly-dropped manual box still awaiting its "✓ 確認範圍"), the screen
  // auto-advances to Diary after a short pause so the all-green state is
  // actually visible before it navigates away. Any state change that makes
  // "all confirmed" untrue again (e.g. dragging in a new manual box during
  // that pause) must cancel the pending timer — checkAutoAdvance() re-derives
  // this from currentDetections every time updateProgress() runs, so that
  // just falls out naturally rather than needing separate bookkeeping.
  let autoAdvanceTimer = null;

  function cancelAutoAdvance(){
    if (autoAdvanceTimer){
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function allDishesConfirmed(){
    return currentDetections.length > 0 && currentDetections.every(d => d.confirmState === 'confirmed');
  }

  function checkAutoAdvance(){
    // Page 3 has no confirming at all; leaving it is only via "下一步"
    if (RECOGNIZE_PREVIEW_ONLY) return;
    if (!allDishesConfirmed()){
      cancelAutoAdvance();
      return;
    }
    if (autoAdvanceTimer) return; // already scheduled
    showToast('全部確認完成,即將進入日記…');
    // Aim for the whole pause (this wait + the thumbnail-cropping work
    // performFinishRecognize does before the screen actually changes) to
    // land within ~0.5-0.8s, not just this timer in isolation.
    autoAdvanceTimer = setTimeout(() => {
      autoAdvanceTimer = null;
      if (allDishesConfirmed()) performFinishRecognize();
    }, 550);
  }

  function updateProgress(){
    const total = currentDetections.length;
    const done = currentDetections.filter(d => d.confirmState === 'confirmed').length;

    // While AI is still detecting, recognizeHint above the photo already
    // says so (with its own spinner) — stay quiet here instead of repeating
    // the same "still working" message in different words.
    confirmProgress.textContent = isAutoDetecting
      ? ''
      : (total ? `已確認 ${done}` : '還沒有框任何一道菜');

    // Nothing to say here when there's nothing detected yet (confirmProgress
    // above already covers that with "還沒有框任何一道菜") or once every dish
    // is confirmed (auto-advance is about to take over) — only show this as
    // a status label for the one state in between: some dishes exist, not
    // all confirmed yet.
    if (total === 0 || done === total){
      finishRecognizeBtn.hidden = true;
    } else {
      finishRecognizeBtn.hidden = false;
      finishRecognizeBtn.disabled = true;
      finishRecognizeBtn.textContent = `還有 ${total - done} 道菜未確認`;
    }

    // Page 3's only way forward; usable once detection has finished (even
    // with nothing found — Page 4 is where dishes get added/fixed)
    recognizeNextBtn.hidden = !RECOGNIZE_PREVIEW_ONLY;
    recognizeNextBtn.disabled = isAutoDetecting || isSavingMeal;

    checkAutoAdvance();
    resolveLabelOverlaps();
  }

  // Picks where each box's (single-line, never width-clamped) label goes:
  // above the box's top edge, else below its bottom edge, else inside its
  // top-left corner — the first slot that stays inside the visible photo
  // and doesn't hit an already-placed label or any confirm dot. A label is
  // also shifted sideways to stay inside the visible photo. If no slot is
  // clean, the least-bad one wins (fewest collisions, staying visible
  // first). Its size is never reduced — a squeezed, unreadable label is
  // what this replaced. Re-run after every render/state change (from
  // updateProgress) and every photo re-layout/zoom; fine for the <=8 boxes
  // this screen shows (a few getBoundingClientRect reads per label).
  // Tried in order; 'right' variants right-align the label to the box's
  // right edge instead of its left (more room to dodge a neighbor in dense
  // layouts).
  const LABEL_SLOTS = [
    { v: 'above', right: false },
    { v: 'above', right: true },
    { v: 'below', right: false },
    { v: 'below', right: true },
    { v: 'inside', right: false }
  ];
  const LABEL_NUDGES = [0, -36, 36, -72, 72]; // px, sideways

  // Page 3 (read-only preview): a label must read as belonging to its own
  // numbered marker at a glance, so it only ever sits snug directly under
  // that marker — or, if that can't be made clean, directly above it — and
  // dodges neighbors only by sliding sideways a little (previewLabelNudges).
  const PREVIEW_LABEL_SLOTS = [
    { v: 'under', right: false },
    { v: 'over', right: false }
  ];
  // Smallest shift first; never more than 1.5x the marker's own width.
  function previewLabelNudges(markerWidth){
    const max = markerWidth * 1.5;
    const steps = [0, 1 / 3, 2 / 3, 1].map(f => Math.round(f * max));
    return [0, ...steps.slice(1).flatMap(s => [-s, s])];
  }
  const LABEL_SLOT_CLASSES = ['det-label-below', 'det-label-inside', 'det-label-right',
    'det-label-under', 'det-label-over'];

  function setLabelSlot(labelEl, slot){
    labelEl.classList.remove(...LABEL_SLOT_CLASSES);
    if (slot.v !== 'above') labelEl.classList.add(`det-label-${slot.v}`);
    if (slot.right) labelEl.classList.add('det-label-right');
    labelEl.style.transform = '';
  }

  function resolveLabelOverlaps(){
    const dets = currentDetections.filter(d => d.labelEl && d.boxEl && d.dotEl);
    if (!dets.length) return;
    const clip = recognizeWrap.getBoundingClientRect();
    if (!clip.width || !clip.height) return; // screen hidden

    function overlaps(a, b){
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    // what a label must not sit under: on Page 3 every dish's numbered
    // marker, otherwise every box's confirm dot
    const dotRects = dets
      .map(d => (RECOGNIZE_PREVIEW_ONLY && d.markerEl ? d.markerEl : d.dotEl).getBoundingClientRect());
    // controls that sit on the photo itself — a label under them is unreadable
    // (CSS-hidden ones measure 0x0 and are skipped)
    const controlRects = [recognizeZoomToggle, manualBoxSpawner, reportAddDishBtn]
      .filter(el => !el.hidden)
      .map(el => el.getBoundingClientRect())
      .filter(r => r.width && r.height);
    const allSlots = RECOGNIZE_PREVIEW_ONLY ? PREVIEW_LABEL_SLOTS : LABEL_SLOTS;
    // Group B's chat photo is smaller, so labels would flip ABOVE their marker
    // far more often — and a label above one marker reads as the label under
    // the marker above it. There, try UNDER only first (hiding calorie lines,
    // then compact), and allow ABOVE only if labels still collide after that.
    let slots = chatMode && RECOGNIZE_PREVIEW_ONLY ? PREVIEW_LABEL_SLOTS.filter(s => s.v === 'under') : allSlots;
    const fixedRects = dotRects.concat(controlRects);

    // Labels start full size; only those that still collide after a full
    // placement pass get the compact style (≈15% smaller font, confidence
    // hidden) and then everything is placed again with their new sizes.
    dets.forEach(d => d.labelEl.classList.remove('det-label-compact', 'det-label-nokcal'));
    let stillColliding = placeAll();
    // Page 4: calorie lines are all-or-nothing — if any colliding label has
    // one, EVERY label drops it (only names), so no dish looks uncalculated.
    if (stillColliding.some(k => dets[k].labelEl.querySelector('.det-label-kcal'))){
      dets.forEach(d => d.labelEl.classList.add('det-label-nokcal'));
      stillColliding = placeAll();
    }
    if (stillColliding.length){
      stillColliding.forEach(i => dets[i].labelEl.classList.add('det-label-compact'));
      stillColliding = placeAll();
    }
    if (stillColliding.length && slots !== allSlots){
      slots = allSlots;
      placeAll();
    }

    // Places every label; returns the indices of labels that still overlap
    // another label, a marker/dot, or an on-photo control afterwards.
    function placeAll(){
      // 1) Every allowed spot for every label, measured once, in preference
      //    order (earlier slot first, then smallest sideways shift first).
      //    Each candidate is clamped to stay inside the visible photo — only
      //    that edge clamp can ever move a label further than its nudge.
      const cands = dets.map(d => {
        const el = d.labelEl;
        const markerW = RECOGNIZE_PREVIEW_ONLY && d.markerEl ? (d.markerEl.getBoundingClientRect().width || 24) : 0;
        const nudges = markerW ? previewLabelNudges(markerW) : LABEL_NUDGES;
        // Page 3/4: the edge clamp pushing a label further than 1.5x the
        // marker width also breaks "reads as its own marker's label", so
        // treat that like a collision (it then gets the compact style).
        const maxShift = markerW ? markerW * 1.5 + 0.5 : Infinity;
        const list = [];
        slots.forEach((slot, si) => {
          setLabelSlot(el, slot);
          const r0 = el.getBoundingClientRect();
          nudges.forEach(nudge => {
            let shift = nudge;
            if (r0.right + shift > clip.right - 4) shift = clip.right - 4 - r0.right;
            if (r0.left + shift < clip.left + 4) shift = clip.left + 4 - r0.left;
            const rect = { left: r0.left + shift, right: r0.right + shift, top: r0.top, bottom: r0.bottom };
            const leaves = rect.top < clip.top || rect.bottom > clip.bottom;
            const fixedHits = fixedRects.filter(fr => overlaps(rect, fr)).length;
            // not counting other labels — those depend on where they end up
            const tooFar = Math.abs(shift) > maxShift;
            const base = (leaves ? 100 : 0) + fixedHits * 10 + (tooFar ? 10 : 0)
              + si * 0.5 + Math.min(0.4, Math.abs(nudge) / 100);
            list.push({ slot, shift, rect, base, ok: !leaves && fixedHits === 0 && !tooFar });
          });
        });
        return list;
      });

      const pick = new Array(dets.length);
      const hitsWith = (i, ci, others) => others.reduce((n, j) =>
        n + (j !== i && pick[j] !== undefined && overlaps(cands[i][ci].rect, cands[j][pick[j]].rect) ? 1 : 0), 0);
      const all = dets.map((_, i) => i);

      // 2) Greedy, in order: the first candidate that's clean against the
      //    labels already placed, else the least bad.
      all.forEach(i => {
        let bestC = 0, bestS = Infinity;
        for (let ci = 0; ci < cands[i].length; ci++){
          const hits = hitsWith(i, ci, all.slice(0, i));
          const s = cands[i][ci].base + hits * 10;
          if (s < bestS){ bestS = s; bestC = ci; }
          if (cands[i][ci].ok && hits === 0) break;
        }
        pick[i] = bestC;
      });

      // 3) Greedy can paint itself into a corner in dense layouts (a label's
      //    only free spot is taken by a neighbor that had another option), so
      //    for the few labels still overlapping — plus the neighbors sitting
      //    where they could move — try every combination of their allowed
      //    spots and keep the one with the fewest overlaps.
      const conflicted = all.filter(i => hitsWith(i, pick[i], all) > 0);
      if (conflicted.length){
        const cluster = new Set(conflicted);
        conflicted.forEach(i => cands[i].forEach(c => all.forEach(j => {
          if (!cluster.has(j) && overlaps(c.rect, cands[j][pick[j]].rect)) cluster.add(j);
        })));
        const members = [...cluster].slice(0, 5);
        const memberSet = new Set(members);
        const outside = all.filter(j => !memberSet.has(j));
        const options = members.map(i => {
          const ok = cands[i].map((c, ci) => ci).filter(ci => cands[i][ci].ok);
          return (ok.length ? ok : [pick[i]]).slice(0, 10);
        });
        const choice = new Array(members.length);
        let bestChoice = members.map(i => pick[i]);
        let bestScore = Infinity;
        (function search(a, partial){
          if (partial >= bestScore) return;
          if (a === members.length){ bestScore = partial; bestChoice = choice.slice(); return; }
          const i = members[a];
          for (const ci of options[a]){
            const r = cands[i][ci].rect;
            let s = cands[i][ci].base;
            for (const j of outside) if (overlaps(r, cands[j][pick[j]].rect)) s += 10;
            for (let b = 0; b < a; b++) if (overlaps(r, cands[members[b]][choice[b]].rect)) s += 10;
            choice[a] = ci;
            search(a + 1, partial + s);
          }
        })(0, 0);
        members.forEach((i, a) => { pick[i] = bestChoice[a]; });
      }

      // 4) Apply.
      dets.forEach((d, i) => {
        const c = cands[i][pick[i]];
        setLabelSlot(d.labelEl, c.slot);
        d.labelEl.style.transform = c.shift ? `translateX(${c.shift}px)` : '';
      });

      return all.filter(i => !cands[i][pick[i]].ok || hitsWith(i, pick[i], all) > 0);
    }
  }

  // Drives the three-state ✓ indicator: pending (hollow) -> editing (thin
  // outline, while a voice/detail edit is open) -> confirmed (solid green).
  // The box border itself stays a fixed, neutral color in every state —
  // only the center dot signals where a dish stands.
  function setConfirmState(det, state){
    det.confirmState = state;
    const box = det.boxEl;
    const dot = det.dotEl;

    if (box){
      box.classList.toggle('confirmed', state === 'confirmed');
    }

    if (dot){
      dot.classList.remove('state-pending', 'state-editing', 'state-confirmed');
      dot.classList.add(`state-${state}`);
    }

    // Only a recognize-screen det has a box/dot; a saved Diary dish reusing
    // this same state machinery shouldn't touch the recognize screen's
    // "已確認 N" progress readout.
    if (box || dot){
      updateProgress();
    }
  }

  /* ---------- candidate-name bottom sheet (only for low-confidence dishes) ---------- */
  const candidateSheet      = document.getElementById('candidateSheet');
  const candidateList       = document.getElementById('candidateList');
  const candidateCancelBtn  = document.getElementById('candidateCancelBtn');
  const candidateConfirmBtn = document.getElementById('candidateConfirmBtn');

  const candidateCustomInput = document.getElementById('candidateCustomInput');
  const candidateLoading     = document.getElementById('candidateLoading');

  let candidateTargetDet = null;
  let candidateChoices = [];
  let candidateSelectedIndex = 0;
  let candidateOnClose = null;
  let candidateOnConfirm = null;
  let candidateHideTimer = null;

  function renderCandidateList(){
    candidateList.innerHTML = '';
    candidateChoices.forEach((choice, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'candidate-row' + (i === candidateSelectedIndex ? ' selected' : '');
      row.textContent = choice.confidence ? `${choice.name}(${choice.confidence}%)` : choice.name;
      row.addEventListener('click', () => {
        candidateSelectedIndex = i;
        candidateCustomInput.value = ''; // a picked candidate replaces any typed name
        renderCandidateList();
      });
      candidateList.appendChild(row);
    });
  }

  // Page 4 rename: the sheet opens right away (loading) and candidates
  // arrive later from /api/recognize.
  function setCandidateChoices(choices){
    candidateChoices = choices;
    candidateSelectedIndex = choices.length ? 0 : -1;
    candidateLoading.hidden = true;
    renderCandidateList();
  }

  // Typing a name deselects any picked candidate — the typed name wins.
  candidateCustomInput.addEventListener('input', () => {
    if (candidateCustomInput.value.trim() && candidateSelectedIndex !== -1){
      candidateSelectedIndex = -1;
      renderCandidateList();
    }
  });

  // onClose is called after the sheet fully closes, whether by Cancel or
  // Confirm — the low-confidence queue uses it to chain to the next dish.
  // opts (Page 4 rename): allowCustom shows the "type a name" field and
  // lets the sheet open with no candidates yet; loading shows a
  // "searching" line until setCandidateChoices(); onConfirm(det,
  // prevCategory) runs after a confirmed rename.
  function openCandidateDialog(det, choices, onClose, opts){
    opts = opts || {};
    if (!choices.length && !opts.allowCustom){
      if (onClose) onClose();
      return;
    }
    clearTimeout(candidateHideTimer);

    candidateTargetDet = det;
    candidateChoices = choices;
    candidateSelectedIndex = choices.length ? 0 : -1;
    candidateOnClose = onClose || null;
    candidateOnConfirm = opts.onConfirm || null;
    candidateCustomInput.hidden = !opts.allowCustom;
    candidateCustomInput.value = '';
    candidateLoading.hidden = !opts.loading;

    det.preEditState = det.confirmState;
    setConfirmState(det, 'editing');

    renderCandidateList();
    candidateSheet.hidden = false;
    document.body.classList.add('candidate-sheet-open');
    requestAnimationFrame(() => candidateSheet.classList.add('show'));
  }

  // silent=true skips the onClose callback — used when the recognize screen
  // resets for a new photo and any in-flight dialog must just disappear.
  function closeCandidateDialog(silent){
    const cb = candidateOnClose;
    candidateSheet.classList.remove('show');
    document.body.classList.remove('candidate-sheet-open');
    clearTimeout(candidateHideTimer);
    candidateHideTimer = setTimeout(() => { candidateSheet.hidden = true; }, 320);
    candidateTargetDet = null;
    candidateChoices = [];
    candidateOnClose = null;
    candidateOnConfirm = null;
    candidateCustomInput.hidden = true;
    candidateCustomInput.value = '';
    candidateLoading.hidden = true;
    if (!silent && cb) cb();
  }

  candidateCancelBtn.addEventListener('click', () => {
    if (candidateTargetDet){
      setConfirmState(candidateTargetDet, candidateTargetDet.preEditState || 'pending');
    }
    closeCandidateDialog();
  });

  candidateConfirmBtn.addEventListener('click', () => {
    const det = candidateTargetDet;
    const custom = candidateCustomInput.hidden ? '' : candidateCustomInput.value.trim();
    const choice = candidateChoices[candidateSelectedIndex];
    if (det && !custom && !choice && !candidateCustomInput.hidden){
      showToast('請選一個菜名,或自己輸入');
      return;
    }
    const onConfirm = candidateOnConfirm;
    const prevCategory = det ? det.category : null;
    if (det && custom){
      // typed by the user: no AI confidence, category left as it was
      det.name = custom;
      det.confidence = null;
      if (det.labelEl) renderDetLabel(det.labelEl, det);
      setConfirmState(det, 'confirmed');
    } else if (det && choice){
      det.name = `${choice.name}(${choice.confidence}%)`;
      det.confidence = choice.confidence;
      det.category = choice.category === 'beverage' ? 'beverage' : 'food';
      if (det.labelEl) renderDetLabel(det.labelEl, det);
      setConfirmState(det, 'confirmed');
    }
    closeCandidateDialog();
    if (det && onConfirm) onConfirm(det, prevCategory);
  });

  // Low-confidence auto-detected dishes queue up here and are reviewed one
  // dialog at a time, instead of stacking several sheets at once.
  let lowConfidenceQueue = [];

  async function processLowConfidenceQueue(){
    if (!lowConfidenceQueue.length) return;
    const det = lowConfidenceQueue.shift();
    if (!currentDetections.includes(det)){
      processLowConfidenceQueue();
      return;
    }
    const candidates = await fetchCandidatesForDet(det);
    const fallback = { name: splitNameConfidence(det.name).name || det.name, confidence: det.confidence, category: det.category === 'beverage' ? 'beverage' : 'food' };
    const choices = candidates.length ? candidates : [fallback];
    openCandidateDialog(det, choices, () => processLowConfidenceQueue());
  }

  function setupRecognizeScreen(photoDataUrl){
    exitReportMode(); // a new photo always starts back on Page 3
    currentMealMeta = newMealMeta(); // "started" = the photo was confirmed
    recognizePhoto.src = photoDataUrl;
    resetRecognizeZoom(); // full photo while detecting / if nothing is found
    layoutRecognizePhoto(false); // again on 'load' once natural size is known
    recognizeOverlay.innerHTML = '';
    currentDetections = [];
    lowConfidenceQueue = [];
    cancelAutoAdvance();
    closeCandidateDialog(true);
    finishRecognizeBtn.disabled = true;
    updateProgress();
    autoDetectDishes(photoDataUrl);
  }

  function renderOneDetection(det, i){
    const box = document.createElement('div');
    box.className = 'det-box';
    box.dataset.detId = det.id;
    box.style.left = det.x + '%';
    box.style.top = det.y + '%';
    box.style.width = det.w + '%';
    box.style.height = det.h + '%';

    const label = document.createElement('span');
    label.className = 'det-label';
    det.labelEl = label;
    renderDetLabel(label, det);
    box.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'det-remove';
    removeBtn.setAttribute('aria-label', '刪除這個框');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      currentDetections = currentDetections.filter(d => d.id !== det.id);
      box.remove();
      updateProgress();
    });

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'det-dot';
    if (det.loading) dot.classList.add('loading');
    dot.setAttribute('aria-label', `確認第 ${i + 1} 道菜`);
    det.dotEl = dot;
    det.boxEl = box;

    dot.addEventListener('click', e => {
      e.stopPropagation();
      if (det.loading){
        showToast('還在辨識中,等結果出來再確認');
        return;
      }
      if (det.manualPendingSubmit){
        showToast('請先拖曳調整範圍,再按「✓ 確認範圍」送出辨識');
        return;
      }
      if (det.confirmState === 'pending'){
        setConfirmState(det, 'confirmed');
      }
    });

    // Voice-correct and detail-adjust now live only behind Diary's unified
    // ✏️ editor (see renderDiaryDishRow) — this screen just needs the ✓
    // confirm indicator, so there's no mic/⚙ button here anymore.
    box.append(removeBtn, dot);

    // Page 3's read-only marker: a numbered dot at the box's center, with
    // the label placed right under it (see resolveLabelOverlaps). The
    // confirm dot / × above stay in the DOM for Page 4 but are hidden by
    // the .recognize-preview CSS.
    if (RECOGNIZE_PREVIEW_ONLY){
      const marker = document.createElement('span');
      marker.className = 'det-marker';
      marker.textContent = String(i + 1);
      marker.setAttribute('aria-hidden', 'true');
      det.markerEl = marker;
      box.appendChild(marker);
      // The marker (and its label, via the same vars) sits at the center of
      // the box the backend returned, not the normalized display box — or,
      // for a dish added on Page 4, exactly where the user tapped.
      const a = det.apiBox;
      const center = a && [a.x, a.y, a.w, a.h].every(Number.isFinite)
        ? { x: a.x + a.w / 2, y: a.y + a.h / 2 }
        : det.tapPoint || null;
      if (center && det.w > 0 && det.h > 0){
        box.style.setProperty('--mx', `${(center.x - det.x) / det.w * 100}%`);
        box.style.setProperty('--my', `${(center.y - det.y) / det.h * 100}%`);
      }
      // Page 4 (Group A) selects a dish by tapping its marker; inert on Page 3
      marker.addEventListener('click', e => {
        if (!reportActive) return;
        e.stopPropagation();
        onReportMarkerTap(det);
      });
      marker.addEventListener('keydown', e => {
        if (!reportActive || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        onReportMarkerTap(det);
      });
    }
    recognizeOverlay.appendChild(box);

    if (det.manualPendingSubmit){
      addManualBoxControls(det, box);
    }

    setConfirmState(det, det.confirmState);
  }

  /* ---------- manual box: drag the corner spawner onto the photo ---------- */
  const MANUAL_BOX_DEFAULT_SIZE = 24; // percent of the photo, a reasonable default dish size

  // The rectangle (client coords) the photo is actually drawn in. The <img>
  // fills recognizeWrap with object-fit:contain, so when the photo's aspect
  // ratio differs from the frame it's letterboxed — every /api/detect box is
  // a percentage of the FULL photo, so boxes, manual-box drops, and resizing
  // must all be measured against this rect, never the <img>/wrap box itself.
  function photoRect(){
    const r = recognizePhoto.getBoundingClientRect();
    const nw = recognizePhoto.naturalWidth;
    const nh = recognizePhoto.naturalHeight;
    if (!nw || !nh || !r.width || !r.height) return r; // not loaded yet
    const scale = Math.min(r.width / nw, r.height / nh);
    const width = nw * scale;
    const height = nh * scale;
    const left = r.left + (r.width - width) / 2;
    const top = r.top + (r.height - height) / 2;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  // Pin the overlay (which holds every .det-box, positioned in %) exactly
  // over the drawn photo area, so a box's % maps to the same % of the photo.
  function layoutRecognizeOverlay(){
    const wrap = recognizeWrap.getBoundingClientRect();
    if (!wrap.width || !wrap.height) return; // screen hidden — redone on show
    const p = photoRect();
    recognizeOverlay.style.left = `${p.left - wrap.left}px`;
    recognizeOverlay.style.top = `${p.top - wrap.top}px`;
    recognizeOverlay.style.width = `${p.width}px`;
    recognizeOverlay.style.height = `${p.height}px`;
    // label positions/clamps depend on pixel sizes, so redo them too
    resolveLabelOverlaps();
  }

  /* ---------- photo display frame + zoom-to-food ---------- */
  // Display-only zoom: every det keeps its x/y/w/h as % of the FULL photo.
  // Zooming just draws the whole <img> bigger and shifted inside the
  // clipping frame (recognizeWrap); photoRect() then reports that full,
  // partly-offscreen photo rect, so layoutRecognizeOverlay() and
  // clientToPct() keep mapping boxes / manual drops correctly unchanged.
  const FOOD_CROP_MARGIN = 8;   // % of the photo added around the dishes, each side
  const FOOD_CROP_MIN_W = 0.4;  // never zoom in past 40% of the photo's width (one tiny dish)

  let zoomMode = 'full';  // 'full' | 'food'
  let foodCrop = null;    // {x,y,w,h} in natural px; null = nothing to zoom to
  let shownCrop = null;   // the crop currently laid out, to animate from

  // Union of every box + margin, grown to the frame's aspect ratio (which
  // is the photo's own) and kept inside the photo.
  function computeFoodCrop(){
    const nw = recognizePhoto.naturalWidth;
    const nh = recognizePhoto.naturalHeight;
    if (!nw || !nh || !currentDetections.length) return null;
    let x0 = 100, y0 = 100, x1 = 0, y1 = 0;
    currentDetections.forEach(d => {
      x0 = Math.min(x0, d.x); y0 = Math.min(y0, d.y);
      x1 = Math.max(x1, d.x + d.w); y1 = Math.max(y1, d.y + d.h);
    });
    x0 = Math.max(0, x0 - FOOD_CROP_MARGIN); y0 = Math.max(0, y0 - FOOD_CROP_MARGIN);
    x1 = Math.min(100, x1 + FOOD_CROP_MARGIN); y1 = Math.min(100, y1 + FOOD_CROP_MARGIN);

    const aspect = nw / nh;
    let w = (x1 - x0) / 100 * nw;
    let h = (y1 - y0) / 100 * nh;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    if (w < nw * FOOD_CROP_MIN_W){ w = nw * FOOD_CROP_MIN_W; h = w / aspect; }
    w = Math.min(w, nw);
    h = Math.min(h, nh);
    if (w >= nw * 0.98) return null; // food already fills the photo — nothing to zoom

    const cx = (x0 + x1) / 2 / 100 * nw;
    const cy = (y0 + y1) / 2 / 100 * nh;
    return {
      x: Math.max(0, Math.min(nw - w, cx - w / 2)),
      y: Math.max(0, Math.min(nh - h, cy - h / 2)),
      w, h
    };
  }

  // Sizes the frame to the photo's aspect ratio (width-filled; height-filled
  // only when the photo is too tall), centers it on the plain stage, then
  // draws the photo at the current crop and re-pins the overlay.
  function layoutRecognizePhoto(animate){
    // Always measure with no zoom animation transform in play. Removing the
    // transition class alone isn't enough: a transition already running
    // stays applied until the next style flush, so a re-layout mid-animation
    // (e.g. the ResizeObserver firing as the hint line disappears) would
    // measure the half-zoomed photo — cancel it explicitly.
    if (recognizeContent.getAnimations){
      recognizeContent.getAnimations().forEach(a => a.cancel());
    }
    recognizeContent.classList.remove('zoom-animating');
    recognizeContent.style.transform = '';

    const stage = recognizeStage.getBoundingClientRect();
    if (!stage.width || !stage.height) return; // screen hidden — redone on show
    const nw = recognizePhoto.naturalWidth;
    const nh = recognizePhoto.naturalHeight;
    if (!nw || !nh){
      // not loaded yet: CSS fallback (frame = stage, photo contained in it)
      ['left', 'top', 'width', 'height'].forEach(p => {
        recognizeWrap.style[p] = '';
        recognizePhoto.style[p] = '';
      });
      layoutRecognizeOverlay();
      updateZoomToggle();
      return;
    }

    const fit = Math.min(stage.width / nw, stage.height / nh);
    const fw = nw * fit;
    const fh = nh * fit;
    recognizeWrap.style.left = `${(stage.width - fw) / 2}px`;
    recognizeWrap.style.top = `${(stage.height - fh) / 2}px`;
    recognizeWrap.style.width = `${fw}px`;
    recognizeWrap.style.height = `${fh}px`;

    const crop = (zoomMode === 'food' && foodCrop) ? foodCrop : { x: 0, y: 0, w: nw, h: nh };
    const s = fw / crop.w;
    recognizePhoto.style.left = `${-crop.x * s}px`;
    recognizePhoto.style.top = `${-crop.y * s}px`;
    recognizePhoto.style.width = `${nw * s}px`;
    recognizePhoto.style.height = `${nh * s}px`;

    layoutRecognizeOverlay();

    const prev = shownCrop;
    shownCrop = crop;
    if (animate && prev && (prev.x !== crop.x || prev.y !== crop.y || prev.w !== crop.w)){
      animateZoomFrom(prev, crop, fw);
    }
    updateZoomToggle();
  }

  // FLIP: the final layout is already in place (and was measured); briefly
  // transform the content back to where the previous crop drew it, then let
  // it transition to identity.
  function animateZoomFrom(prev, next, frameW){
    const sPrev = frameW / prev.w;
    const sNext = frameW / next.w;
    const tx = (next.x - prev.x) * sPrev;
    const ty = (next.y - prev.y) * sPrev;
    recognizeContent.style.transform = `translate(${tx}px, ${ty}px) scale(${sPrev / sNext})`;
    recognizeContent.getBoundingClientRect(); // commit the start frame
    recognizeContent.classList.add('zoom-animating');
    recognizeContent.style.transform = '';
    recognizeContent.addEventListener('transitionend', () => {
      recognizeContent.classList.remove('zoom-animating');
      resolveLabelOverlaps(); // re-place labels against the settled layout
    }, { once: true });
  }

  function updateZoomToggle(){
    recognizeZoomToggle.hidden = !foodCrop;
    recognizeZoomToggle.textContent = zoomMode === 'food' ? '查看完整照片' : '放大到食物範圍';
  }

  function zoomToFood(){
    foodCrop = computeFoodCrop();
    zoomMode = foodCrop ? 'food' : 'full';
    layoutRecognizePhoto(true);
  }

  function resetRecognizeZoom(){
    zoomMode = 'full';
    foodCrop = null;
    shownCrop = null;
  }

  recognizeZoomToggle.addEventListener('click', e => {
    e.stopPropagation();
    if (zoomMode === 'food'){
      zoomMode = 'full';
      layoutRecognizePhoto(true);
    } else {
      zoomToFood(); // recompute — manual boxes may have been added since
    }
  });

  recognizePhoto.addEventListener('load', () => layoutRecognizePhoto(false));
  window.addEventListener('resize', () => layoutRecognizePhoto(false));
  // Also catches layout changes that aren't window resizes: the screen
  // becoming visible, the hint line above the photo appearing/disappearing.
  if ('ResizeObserver' in window){
    new ResizeObserver(() => layoutRecognizePhoto(false)).observe(recognizeStage);
  }

  function clientToPct(clientX, clientY){
    const r = photoRect();
    return {
      x: Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - r.top) / r.height) * 100))
    };
  }

  function addManualBoxControls(det, box){
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'det-box-resize-handle';
    handle.setAttribute('aria-label', '拖曳調整這個框的大小');

    const confirmRangeBtn = document.createElement('button');
    confirmRangeBtn.type = 'button';
    confirmRangeBtn.className = 'det-box-confirm-range';
    confirmRangeBtn.textContent = '✓ 確認範圍';
    confirmRangeBtn.setAttribute('aria-label', '確認框選範圍,送出辨識');

    handle.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);

      function onMove(ev){
        const p = clientToPct(ev.clientX, ev.clientY);
        det.w = Math.max(8, Math.min(100 - det.x, p.x - det.x));
        det.h = Math.max(8, Math.min(100 - det.y, p.y - det.y));
        box.style.width = det.w + '%';
        box.style.height = det.h + '%';
      }
      function onUp(){
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    confirmRangeBtn.addEventListener('click', e => {
      e.stopPropagation();
      handle.remove();
      confirmRangeBtn.remove();
      det.manualPendingSubmit = false;
      submitManualBoxForRecognition(det);
    });

    box.append(handle, confirmRangeBtn);
  }

  async function submitManualBoxForRecognition(det){
    det.loading = true;
    det.name = null;
    if (det.labelEl) renderDetLabel(det.labelEl, det);
    if (det.dotEl) det.dotEl.classList.add('loading');
    showToast('框好了,正在辨識這道菜…');

    const candidates = await fetchCandidatesForDet(det);

    det.loading = false;
    if (det.dotEl) det.dotEl.classList.remove('loading');

    if (!candidates.length){
      det.name = '辨識失敗,自己填';
      det.confidence = 0;
      if (det.labelEl) renderDetLabel(det.labelEl, det);
      updateProgress();
      showToast('辨識失敗,可以用語音或細部調整自己填菜名');
      return;
    }

    const top = candidates[0];
    det.name = `${top.name}(${top.confidence}%)`;
    det.confidence = top.confidence;
    det.category = top.category === 'beverage' ? 'beverage' : 'food';
    if (det.labelEl) renderDetLabel(det.labelEl, det);
    updateProgress();

    if (top.confidence < CONFIDENCE_DIALOG_THRESHOLD * 100){
      openCandidateDialog(det, candidates, null);
    }
  }

  function createManualBox(centerXPct, centerYPct){
    let w = MANUAL_BOX_DEFAULT_SIZE;
    let h = MANUAL_BOX_DEFAULT_SIZE;
    let x = Math.max(0, Math.min(100 - w, centerXPct - w / 2));
    let y = Math.max(0, Math.min(100 - h, centerYPct - h / 2));

    const idx = currentDetections.length;
    const det = {
      id: `manual${Date.now()}`,
      x, y, w, h,
      name: '拖曳邊角調整範圍,再按 ✓ 確認',
      confidence: 0,
      category: 'food',
      loading: false,
      confirmState: 'pending',
      manualPendingSubmit: true
    };
    currentDetections.push(det);
    renderOneDetection(det, idx);
    updateProgress();
  }

  manualBoxSpawner.addEventListener('pointerdown', e => {
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = 'manual-box-ghost';
    document.body.appendChild(ghost);

    function positionGhost(clientX, clientY){
      ghost.style.left = clientX + 'px';
      ghost.style.top = clientY + 'px';
    }
    positionGhost(e.clientX, e.clientY);

    function onMove(ev){
      positionGhost(ev.clientX, ev.clientY);
    }
    function onUp(ev){
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      ghost.remove();

      // must land on the photo AND inside the visible frame (when zoomed,
      // the photo rect extends past the frame's clipped edges)
      const r = photoRect();
      const v = recognizeWrap.getBoundingClientRect();
      if (ev.clientX < Math.max(r.left, v.left) || ev.clientX > Math.min(r.right, v.right)
          || ev.clientY < Math.max(r.top, v.top) || ev.clientY > Math.min(r.bottom, v.bottom)){
        return; // dropped outside the photo — do nothing, spawner stays put
      }
      const p = clientToPct(ev.clientX, ev.clientY);
      createManualBox(p.x, p.y);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  // GPT-4o's boxes are an estimate, not pixel-accurate detection (see
  // README), so a Diary thumbnail cropped exactly to the box can end up
  // clipping a bit of the dish at the edges. Padding the crop region a
  // little — just for the thumbnail, not the live det.x/y/w/h used for
  // confirming/re-recognizing — lowers the odds of that without needing a
  // more precise (and non-free) detection model.
  const THUMBNAIL_SAFETY_MARGIN = 0.12; // 12% of the box's own size, each side
  function padBoxForThumbnail(x, y, w, h){
    const padW = w * THUMBNAIL_SAFETY_MARGIN;
    const padH = h * THUMBNAIL_SAFETY_MARGIN;
    let nx = x - padW;
    let ny = y - padH;
    let nw = w + padW * 2;
    let nh = h + padH * 2;

    if (nx < 0){ nw += nx; nx = 0; }
    if (ny < 0){ nh += ny; ny = 0; }
    if (nx + nw > 100) nw = 100 - nx;
    if (ny + nh > 100) nh = 100 - ny;

    return { x: nx, y: ny, w: nw, h: nh };
  }

  // Shared by the auto-advance timer once every dish is confirmed. The
  // button itself is now a non-interactive status label (see
  // updateProgress) — it's hidden exactly when this would be reachable, so
  // there's no click path into this anymore, only the auto-advance one.
  async function performFinishRecognize(){
    const total = currentDetections.length;
    if (total === 0 || currentDetections.some(d => d.loading) || !allDishesConfirmed()){
      return;
    }
    cancelAutoAdvance();
    await saveCurrentMeal();
  }

  // Shared save path: Page 3's "下一步" and the (Page 4) confirm flow above.
  // Builds the meal record — study group + each dish's name, confidence,
  // category and full-photo box (% coordinates, for later thumbnail crops
  // and Page 4 marking) — then shows it as a Diary card.
  // opts (Group B chat only): extraDets = dishes added in the chat that are
  // not on the photo (no box); recordExtra = extra record fields (the chat).
  async function saveCurrentMeal(opts = {}){
    const photoDataUrl = currentPhotoData;
    const allDets = currentDetections.concat(opts.extraDets || []);
    // Each Diary dish gets its own thumbnail — the actual bounding-box crop,
    // not the whole plate photo — so cards stay recognizable at a glance.
    const dishes = await Promise.all(allDets.map(async d => {
      let thumbUrl = photoDataUrl;
      if (d.onPhoto !== false) try {
        const padded = padBoxForThumbnail(d.x, d.y, d.w, d.h);
        thumbUrl = await cropRegionToDataUrl(photoDataUrl, padded.x, padded.y, padded.w, padded.h);
      } catch (err){
        console.error('[finishRecognize] crop failed for dish thumbnail:', err);
      }
      if (d.onPhoto === false){
        // Group B: a dish the user mentioned in the chat — no box on the photo
        return {
          name: d.name, confidence: null,
          detail: d.detail ? { ...d.detail } : null,
          category: d.category === 'beverage' ? 'beverage' : 'food',
          box: null, displayBox: null, source: 'chat', tapPoint: null,
          notes: [...(d.notes || [])],
          ...(d.count || d.countable ? { count: d.count || null, countUnit: d.countUnit || null, countEdits: d.countEdits || 0, countable: true, countConfirmed: !!d.countConfirmed } : {}),
          nutrition: window.PictaCalorie ? window.PictaCalorie.snapshot(d.id) : null,
          thumbUrl
        };
      }
      return {
        name: d.name,
        confidence: d.confidence,
        detail: d.detail ? { ...d.detail } : null,
        category: d.category === 'beverage' ? 'beverage' : 'food',
        // box = exactly what /api/detect returned (manual boxes: as drawn);
        // displayBox = the normalized one drawn on screen / used for the thumbnail
        box: d.apiBox ? { ...d.apiBox } : { x: d.x, y: d.y, w: d.w, h: d.h },
        displayBox: { x: d.x, y: d.y, w: d.w, h: d.h },
        // 'ai' = from /api/detect; 'user' = added on Page 4 by tapping the
        // photo (tapPoint = where, % of the full photo)
        source: d.addedByUser ? 'user' : 'ai',
        tapPoint: d.tapPoint ? { ...d.tapPoint } : null,
        // countable dishes: final count (AI's is in aiOriginal.count) + edits
        ...(d.count || d.countable ? {
          count: d.count || null, countUnit: d.countUnit || null, countEdits: d.countEdits || 0, countable: true,
          ...(chatMode ? { countConfirmed: !!d.countConfirmed } : {})
        } : {}),
        // calorie result for this dish (match level, matched item, source,
        // numbers, explanation); null when never calculated (Group B for now)
        nutrition: window.PictaCalorie ? window.PictaCalorie.snapshot(d.id) : null,
        // Group B only: notes from the chat, the AI's original recognition,
        // and the name before a rename made in the chat
        ...(d.notes ? { notes: [...d.notes] } : {}),
        ...(d.aiOriginal ? { aiOriginal: { ...d.aiOriginal } } : {}),
        ...(d.renamedFrom ? { renamedFrom: d.renamedFrom } : {}),
        thumbUrl
      };
    }));

    // small thumbnails: they are also kept in this device's Diary copy
    await Promise.all(dishes.map(async d => {
      if (d.thumbUrl) d.thumbUrl = (await window.PictaSync.shrink(d.thumbUrl, 160, 0.75)) || d.thumbUrl;
    }));
    const meta = currentMealMeta || newMealMeta();
    const doneAt = new Date().toISOString();
    meta.editLog.addedDishes = allDets.filter(d => d.addedByUser || d.onPhoto === false)
      .map(d => ({ name: splitNameConfidence(d.name || '').name, source: d.onPhoto === false ? 'chat' : 'user' }));
    let photoUpload = null;
    let photoInfo = { saved: false, reason: 'disabled' };
    if (SAVE_PHOTOS){
      try {
        photoUpload = await window.PictaSync.compressPhoto(photoDataUrl, { maxEdge: 1024, quality: 0.7, maxBytes: 900 * 1024 });
        photoInfo = { saved: true, width: photoUpload.width, height: photoUpload.height, bytes: photoUpload.bytes, quality: photoUpload.quality };
      } catch (err){
        photoInfo = { saved: false, reason: 'compress-failed' };
      }
    }

    const record = {
      // unique, and the Firestore document id (so a retry can't duplicate)
      id: `m-${(crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12))}`,
      pid: PARTICIPANT_ID,
      group: STUDY_GROUP,
      appVersion: APP_VERSION,
      userAgent: navigator.userAgent,
      createdAt: doneAt,
      times: {
        startedAt: meta.startedAt,
        nextAt: meta.nextAt,
        doneAt,
        durationSec: Math.round((Date.parse(doneAt) - Date.parse(meta.startedAt)) / 100) / 10
      },
      aiDetections: meta.aiDetections,
      editLog: meta.editLog,
      apiErrors: meta.apiErrors,
      photo: photoInfo,
      // whole-meal estimate (only dishes with a number add in)
      nutrition: dishes.some(x => x.nutrition) ? window.PictaCalorie.mealSnapshot(allDets.map(d => d.id)) : null,
      dishes,
      ...(opts.recordExtra || {})
    };
    mealRecords.push(record);
    record.localPhoto = await window.PictaSync.shrink(photoDataUrl, 640, 0.6);
    record.syncStatus = 'pending';

    addMealCard(photoDataUrl, dishes.length, dishes, record);
    persistDiary();
    window.PictaSync.enqueue(uploadableRecord(record), photoUpload ? photoUpload.dataUrl : null);
    currentMealMeta = null;
    showToast('這餐記錄好了!');
    currentPhotoData = null;
    goToScreen('diary');
  }

  // Page 3 -> Page 4. Group A fills in each dish on its own Page 4 (report
  // screen); Group B reports by chatting, on the same screen in chat mode.
  // The group goes onto the record.
  recognizeNextBtn.addEventListener('click', async () => {
    if (isAutoDetecting || isSavingMeal || !currentPhotoData) return;
    if (currentMealMeta && !currentMealMeta.nextAt) currentMealMeta.nextAt = new Date().toISOString();
    if (STUDY_GROUP === 'A'){
      enterReportMode();
      return;
    }
    if (STUDY_GROUP === 'B'){
      enterChatMode();
      return;
    }
    isSavingMeal = true;
    updateProgress();
    try {
      await saveCurrentMeal();
    } finally {
      isSavingMeal = false;
      updateProgress();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });

  /* ---------- detail adjustment panel ---------- */
  const detailAdjustModal = document.getElementById('detailAdjustModal');
  const detailAdjustClose = document.getElementById('detailAdjustClose');
  const detailAdjustCancelBtn = document.getElementById('detailAdjustCancelBtn');
  const detailAdjustConfirmBtn = document.getElementById('detailAdjustConfirmBtn');
  const detailNameField = document.getElementById('detailNameField');
  const detailNameInput = document.getElementById('detailNameInput');
  const detailContainerList = document.getElementById('detailContainerList');
  const detailSizeList = document.getElementById('detailSizeList');
  const detailCookingList = document.getElementById('detailCookingList');
  const detailSugarList = document.getElementById('detailSugarList');
  const detailSaltList = document.getElementById('detailSaltList');

  // Same reasoning as DIARY_ICON_*/FOOD_COOKING_METHODS above: plain emoji
  // render inconsistently across devices, so every picker icon in this
  // modal is inline SVG.
  const containerOptions = [
    { value: 'plate', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><ellipse cx="12" cy="12" rx="8.5" ry="6" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="4" ry="2.8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>', label: '盤子' },
    { value: 'bowl', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 11h16a8 8 0 0 1-16 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>', label: '碗' },
    { value: 'cup', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4h10l-1.2 15a1.5 1.5 0 0 1-1.5 1.3h-4.6a1.5 1.5 0 0 1-1.5-1.3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>', label: '杯子' }
  ];
  const sizeOptions = ['XS', 'S', 'M', 'L', 'XL'];
  // Same reasoning as DIARY_ICON_* above: these were emoji and rendered as a
  // garbled glyph on some devices/fonts. Every cooking-method icon — both the
  // fixed Diary-row one and this per-option picker set — is now inline SVG.
  const FOOD_COOKING_METHODS = [
    { value: '沙拉', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 12h16a8 8 0 0 1-16 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12c0-3 1-6 1-6M15 12c0-3-1-6-1-6M12 12c0-4 .5-7 .5-7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
    { value: '水煮', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 11h14v3a7 7 0 0 1-14 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8c0-1.2.8-1.2.8-2.4S9 4.2 9 3M13 8c0-1.2.8-1.2.8-2.4S13 4.2 13 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
    { value: '蒸', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="13" width="14" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 10c0-1.2.9-1.2.9-2.4S9 5.2 9 4M12.5 10c0-1.2.9-1.2.9-2.4S12.5 5.2 12.5 4M16 10c0-1.2.9-1.2.9-2.4S16 5.2 16 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
    { value: '炒', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 12h14v1a7 7 0 0 1-14 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="17" y1="12.5" x2="21.5" y2="12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="7.5" cy="8" r=".9" fill="currentColor"/><circle cx="10.5" cy="6.3" r=".9" fill="currentColor"/><circle cx="13.5" cy="8" r=".9" fill="currentColor"/></svg>' },
    { value: '煎', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 15h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="16" y1="15" x2="20.5" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 15c0-1.8 1.3-2.8 3-2.8s3 1 3 2.8" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="9" cy="13.4" r=".7" fill="currentColor"/></svg>' },
    { value: '炸', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 11h14v3a7 7 0 0 1-14 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="12.5" cy="4.5" r="1" fill="currentColor"/><circle cx="16" cy="6" r="1" fill="currentColor"/></svg>' },
    { value: '烤', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="4" y="6" width="16" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="4" y1="11" x2="20" y2="11" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="15.5" r="1" fill="currentColor"/><circle cx="12" cy="15.5" r="1" fill="currentColor"/><circle cx="17" cy="15.5" r="1" fill="currentColor"/></svg>' },
    { value: '燒烤', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><line x1="4" y1="10" x2="20" y2="10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="4" y1="14" x2="20" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7 20c-1.5-2 1-3 0-5M12 20c-1.5-2 1-3 0-5M17 20c-1.5-2 1-3 0-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
    { value: '烘焙', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 4c1.5 2-1 3 0 5s2.5 2.5 2.5 4.5A2.5 2.5 0 0 1 12 16a2.5 2.5 0 0 1-2.5-2.5c0-2 2.5-3.5 2.5-4.5s-1.5-3 0-5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 20c0-3 2.7-5 6-5s6 2 6 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' }
  ];
  const BEVERAGE_COOKING_METHODS = [
    { value: '沖泡', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9h12l-1.5 10a2 2 0 0 1-2 1.7h-5a2 2 0 0 1-2-1.7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 4c1 1-1 2 0 3M13 4c1 1-1 2 0 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
    { value: '現煮', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h10v3a5 5 0 0 1-10 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 13h2a2.5 2.5 0 0 1 0 5h-2" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="7" y1="9" x2="7" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
    { value: '現榨', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4v16M12 4 8 8M12 4l4 4M12 20l-4-4M12 20l4-4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' },
    { value: '冰鎮', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.3"/><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="1.3"/></svg>' },
    { value: '熱飲', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 11h12v3a6 6 0 0 1-12 0Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 12h1.5a2 2 0 0 1 0 4H17" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 8c0-1.2.9-1.2.9-2.4S9 3.2 9 2M13 8c0-1.2.9-1.2.9-2.4S13 3.2 13 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' },
    { value: '調製', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 5h14l-7 8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="12" y1="13" x2="12" y2="20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="8.5" y1="20" x2="15.5" y2="20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
    { value: '不適用', icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="6.5" y1="17.5" x2="17.5" y2="6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' }
  ];
  const sugarOptions = [
    { value: '無糖', level: 0 },
    { value: '微糖(四分之一)', level: 25 },
    { value: '半糖', level: 50 },
    { value: '少糖(四分之三)', level: 75 },
    { value: '全糖', level: 100 }
  ];
  // Same salt-shaker glyph as DIARY_ICON_SALT — the amount already reads
  // from the label text, so every option reuses one consistent icon.
  const SALT_SHAKER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9.5 4h5l.9 2.5h-6.8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.4 6.5h7.2L14.4 19a1 1 0 0 1-1 1h-2.8a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="10.8" cy="10" r=".6" fill="currentColor"/><circle cx="13.2" cy="10" r=".6" fill="currentColor"/><circle cx="12" cy="12.4" r=".6" fill="currentColor"/></svg>';
  const saltOptions = [
    { value: '無鹽', icon: SALT_SHAKER_ICON },
    { value: '1/4 茶匙', icon: SALT_SHAKER_ICON },
    { value: '1/2 茶匙', icon: SALT_SHAKER_ICON },
    { value: '3/4 茶匙', icon: SALT_SHAKER_ICON },
    { value: '1 茶匙', icon: SALT_SHAKER_ICON }
  ];

  let detailAdjustTarget = null;
  let detailDraft = {};
  let detailCountDraft = null; // the Diary edit sheet's 數量 (null = not known yet: "?")
  let detailCountShown = false;
  const detailCountRow = document.getElementById('detailCountRow');
  const stepDetailCount = delta => {
    if (!detailCountShown) return;
    detailCountDraft = stepCount(detailCountDraft, delta);
    renderCountStepper('detailCount', detailCountDraft, detailAdjustTarget && detailAdjustTarget.countUnit);
  };
  document.getElementById('detailCountMinus').addEventListener('click', () => stepDetailCount(-1));
  document.getElementById('detailCountPlus').addEventListener('click', () => stepDetailCount(1));

  // Rebuilds the cooking-method picker for the given dish category, reusing
  // the same list/scroll-hint UI for both — only which array feeds it differs.
  function renderCookingMethodOptions(category){
    const methods = category === 'beverage' ? BEVERAGE_COOKING_METHODS : FOOD_COOKING_METHODS;
    detailCookingList.innerHTML = methods.map(option => `
      <button type="button" class="detail-choice detail-cooking-choice" data-kind="cookingMethod" data-value="${option.value}" aria-label="${option.value}">
        <span class="detail-choice-icon">${option.icon}</span>
        <span class="detail-choice-label">${option.value}</span>
      </button>
    `).join('');
    detailCookingList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        detailDraft.cookingMethod = btn.dataset.value;
        syncDetailSelectionState();
      });
    });
  }

  function renderDetailSelectorButtons(){
    detailContainerList.innerHTML = containerOptions.map(option => `
      <button type="button" class="detail-choice detail-container-choice" data-kind="containerType" data-value="${option.value}" aria-label="${option.label}">
        <span class="detail-choice-icon">${option.icon}</span>
        <span class="detail-choice-label">${option.label}</span>
      </button>
    `).join('');

    detailSizeList.innerHTML = sizeOptions.map(size => `
      <button type="button" class="detail-choice detail-size-choice" data-kind="size" data-value="${size}" aria-label="尺寸 ${size}">${size}</button>
    `).join('');

    renderCookingMethodOptions('food');

    detailSugarList.innerHTML = sugarOptions.map(option => `
      <button type="button" class="detail-choice detail-sugar-choice" data-kind="sugar" data-value="${option.value}" aria-label="糖 ${option.value}">
        <span class="detail-sugar-cup" aria-hidden="true">
          <span class="detail-sugar-fill" style="height:${option.level}%"></span>
        </span>
        <span class="detail-choice-label">${option.value}</span>
      </button>
    `).join('');

    detailSaltList.innerHTML = saltOptions.map(option => `
      <button type="button" class="detail-choice detail-salt-choice" data-kind="salt" data-value="${option.value}" aria-label="鹽 ${option.value}">
        <span class="detail-choice-icon">${option.icon}</span>
        <span class="detail-choice-label">${option.value}</span>
      </button>
    `).join('');

    detailContainerList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        detailDraft.containerType = btn.dataset.value;
        syncDetailSelectionState();
      });
    });

    detailSizeList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        detailDraft.size = btn.dataset.value;
        syncDetailSelectionState();
      });
    });

    detailSugarList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        detailDraft.sugar = btn.dataset.value;
        syncDetailSelectionState();
      });
    });

    detailSaltList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        detailDraft.salt = btn.dataset.value;
        syncDetailSelectionState();
      });
    });
  }

  function syncDetailSelectionState(){
    const selected = detailDraft;
    detailContainerList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === selected.containerType);
    });
    detailSizeList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === selected.size);
    });
    detailCookingList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === selected.cookingMethod);
    });
    detailSugarList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === selected.sugar);
    });
    detailSaltList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === selected.salt);
    });
  }

  function closeDetailAdjustModal(){
    detailAdjustModal.hidden = true;
    detailAdjustTarget = null;
    detailDraft = {};
  }

  function cancelDetailAdjust(){
    if (detailAdjustTarget && detailAdjustTarget.confirmState === 'editing'){
      setConfirmState(detailAdjustTarget, detailAdjustTarget.preEditState || 'pending');
    }
    closeDetailAdjustModal();
  }

  function openDetailAdjustModal(det){
    detailAdjustTarget = det;
    det.preEditState = det.confirmState;
    setConfirmState(det, 'editing');
    detailDraft = { ...(det.detail || {}) };
    renderCookingMethodOptions(det.category === 'beverage' ? 'beverage' : 'food');
    syncDetailSelectionState();

    // Only a Diary dish (identified by having a refreshRow hook) gets the
    // merged name field — the recognize screen's own ⚙ button still edits
    // attributes only, with 🎤 staying its separate name-correction entry.
    const isDiaryDish = typeof det.refreshRow === 'function';
    detailNameField.hidden = !isDiaryDish;
    // 數量: Diary dishes that have a count
    detailCountShown = isDiaryDish && !!(det.count || det.countable);
    detailCountDraft = detailCountShown ? (det.count || null) : null;
    detailCountRow.hidden = !detailCountShown;
    if (detailCountShown) renderCountStepper('detailCount', detailCountDraft, det.countUnit);
    if (isDiaryDish){
      detailNameInput.value = stripConfidenceText(det.name || '');
    }

    detailAdjustModal.hidden = false;
  }

  function confirmDetailAdjust(){
    if (!detailAdjustTarget) return;
    detailAdjustTarget.detail = { ...detailDraft };
    if (detailCountDraft && detailCountDraft !== detailAdjustTarget.count){
      detailAdjustTarget.count = detailCountDraft;
      detailAdjustTarget.countEdits = (detailAdjustTarget.countEdits || 0) + 1;
    }
    if (!detailNameField.hidden){
      const newName = detailNameInput.value.trim();
      if (newName) detailAdjustTarget.name = newName;
    }
    if (detailAdjustTarget.labelEl) {
      renderDetLabel(detailAdjustTarget.labelEl, detailAdjustTarget);
    }
    if (typeof detailAdjustTarget.refreshRow === 'function') {
      detailAdjustTarget.refreshRow();
    }
    setConfirmState(detailAdjustTarget, 'confirmed');
    closeDetailAdjustModal();
    showToast('細部調整已更新');
  }

  renderDetailSelectorButtons();
  detailAdjustClose.addEventListener('click', cancelDetailAdjust);
  detailAdjustCancelBtn.addEventListener('click', cancelDetailAdjust);
  detailAdjustConfirmBtn.addEventListener('click', confirmDetailAdjust);

  /* ---------- Page 4, Group A: fill in each dish ----------
     Same photo, markers, labels and zoom as Page 3: the #recognizeStage
     node is moved into #reportPhotoSlot, so photoRect() /
     layoutRecognizeOverlay() / zoom / resolveLabelOverlaps() all keep
     working unchanged (the report screen also carries .recognize-preview).
     Tap a marker -> that one dish shows below; its five fields use the same
     option lists as the detail-adjust modal. */
  const reportPhotoSlot     = document.getElementById('reportPhotoSlot');
  const reportCountTag      = document.getElementById('reportCountTag');
  const reportCameraBtn     = document.getElementById('reportCameraBtn');
  const reportAddHint       = document.getElementById('reportAddHint');
  const reportEmptyHint     = document.getElementById('reportEmptyHint');
  const reportDish          = document.getElementById('reportDish');
  const reportDishThumb     = document.getElementById('reportDishThumb');
  const reportDishNum       = document.getElementById('reportDishNum');
  const reportDishName      = document.getElementById('reportDishName');
  const reportDishConf      = document.getElementById('reportDishConf');
  const reportDishKcal      = document.getElementById('reportDishKcal');
  const reportKcalExplain   = document.getElementById('reportKcalExplain');
  const reportTotal         = document.getElementById('reportTotal');
  const reportTotalNum      = document.getElementById('reportTotalNum');
  const reportTotalNote     = document.getElementById('reportTotalNote');
  const reportRenameBtn     = document.getElementById('reportRenameBtn');
  const reportDeleteBtn     = document.getElementById('reportDeleteBtn');
  const reportDeleteConfirm = document.getElementById('reportDeleteConfirm');
  const reportDeleteCancel  = document.getElementById('reportDeleteCancel');
  const reportDeleteYes     = document.getElementById('reportDeleteYes');
  const reportDoneBtn       = document.getElementById('reportDoneBtn');
  const reportProgress      = document.getElementById('reportProgress');
  const reportPanel         = document.getElementById('reportPanel');
  const reportNextDishBtn   = document.getElementById('reportNextDishBtn');
  const reportScreenEl      = document.querySelector('.screen[data-screen="report"]');
  const reportLists = {
    containerType: document.getElementById('reportContainerList'),
    size: document.getElementById('reportSizeList'),
    cookingMethod: document.getElementById('reportCookingList'),
    sugar: document.getElementById('reportSugarList'),
    salt: document.getElementById('reportSaltList')
  };
  // A dish is "filled" only when all five have a value.
  const REPORT_FIELDS = ['containerType', 'size', 'cookingMethod', 'sugar', 'salt'];

  let reportActive = false;      // Page 4 is showing (and owns the photo stage)
  let chatMode = false;          // ...as Group B's chat page (see "Group B chat" below)
  let reportSelectedId = null;   // det.id shown in the panel, or null
  let reportAddingDish = false;  // waiting for a tap on the photo
  let reportRenaming = false;    // a rename sheet is open / loading

  function isDishComplete(det){
    const d = det.detail || {};
    // a countable dish (AI counted it, or its matched item is per 隻/顆/個 …)
    // also needs its 數量 — never silently 1
    return REPORT_FIELDS.every(k => !!d[k]) && (!det.countable || Number.isInteger(det.count));
  }

  // THE hook for the upcoming calorie feature. Fired on document whenever a
  // dish has all five fields filled: reason 'completed' the moment it first
  // becomes complete, 'changed' on any later edit (a field or its name) to
  // a dish that is still complete. Listen with
  //   document.addEventListener('pictameal:dish-detail-complete', e => ...)
  function notifyDishDetailComplete(det, reason){
    document.dispatchEvent(new CustomEvent('pictameal:dish-detail-complete', {
      detail: {
        dishId: det.id,
        name: splitNameConfidence(det.name || '').name,
        confidence: det.confidence ?? null,
        category: det.category === 'beverage' ? 'beverage' : 'food',
        detail: { ...det.detail },
        // Group B: the photo's count is not what was eaten — only a count the
        // user confirmed is calculated (otherwise 待補數量)
        count: Number.isInteger(det.count) && (!chatMode || det.countConfirmed) ? det.count : null,
        countUnit: det.countUnit || null,
        group: STUDY_GROUP,
        reason
      }
    }));
  }

  function selectedReportDet(){
    return currentDetections.find(d => d.id === reportSelectedId) || null;
  }

  // White hollow = not filled, green ring = selected, solid green = filled.
  function refreshMarkerStates(){
    currentDetections.forEach((d, i) => {
      const m = d.markerEl;
      if (!m) return;
      // Group B: "done" = described in the chat
      const done = reportActive && (chatMode ? !!d.chatDescribed : isDishComplete(d));
      m.classList.toggle('marker-empty', reportActive && !done);
      m.classList.toggle('marker-done', done);
      m.classList.toggle('marker-active', reportActive && d.id === reportSelectedId);
      if (reportActive){
        m.setAttribute('role', 'button');
        m.setAttribute('tabindex', '0');
        m.removeAttribute('aria-hidden');
        m.setAttribute('aria-label', `第 ${i + 1} 道菜${done ? '(已填完)' : ''}`);
      } else {
        m.removeAttribute('role');
        m.removeAttribute('tabindex');
        m.removeAttribute('aria-label');
        m.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function renumberMarkers(){
    currentDetections.forEach((d, i) => {
      if (d.markerEl) d.markerEl.textContent = String(i + 1);
    });
    refreshMarkerStates();
  }

  // Footer: "已填 N / 總數 道" while anything is unfilled — plus "下一道 ›"
  // once the selected dish is itself filled — and only "完成" when every
  // dish is filled. Called on every select / field / rename / add / delete.
  function updateReportDone(){
    const all = currentDetections;
    const filled = all.filter(d => !d.loading && isDishComplete(d)).length;
    const allDone = all.length > 0 && filled === all.length;
    const sel = selectedReportDet();
    reportProgress.textContent = `已填 ${filled} / ${all.length} 道`;
    reportProgress.hidden = allDone;
    reportNextDishBtn.hidden = allDone || !sel || !!sel.loading || !isDishComplete(sel);
    reportDoneBtn.hidden = !allDone;
    reportDoneBtn.disabled = isSavingMeal || !allDone;
    renderReportTotal();
  }

  /* ---------- 數量 (countable dishes) ---------- */
  // Shared by Page 4 (Group A) and the Diary edit sheet: "−  N 隻  +",
  // 1..COUNT_MAX, buttons only.
  function renderCountStepper(prefix, count, unit){
    document.getElementById(`${prefix}Value`).textContent = `${count || '?'} ${unit || '個'}`;
    document.getElementById(`${prefix}Minus`).disabled = !count || count <= 1;
    document.getElementById(`${prefix}Plus`).disabled = !!count && count >= COUNT_MAX;
  }
  // 1 + 1 = 2, ? + 1 = 1 (a missing count starts at 1), ? − 1 = ?
  const stepCount = (count, delta) => (count ? Math.max(1, Math.min(COUNT_MAX, count + delta)) : (delta > 0 ? 1 : null));
  const reportCountRow = document.getElementById('reportCountRow');
  function renderReportCount(det){
    const has = !!(det && (det.count || det.countable) && !det.loading);
    reportCountRow.hidden = !has;
    if (has) renderCountStepper('reportCount', det.count, det.countUnit);
  }
  function changeReportCount(delta){
    const det = selectedReportDet();
    if (!det || !(det.count || det.countable) || det.loading) return;
    const next = stepCount(det.count, delta);
    if (next === (det.count || null)) return;
    const wasComplete = isDishComplete(det);
    det.count = next;
    det.countEdits = (det.countEdits || 0) + 1;
    renderReportCount(det);
    if (det.labelEl) renderDetLabel(det.labelEl, det);
    resolveLabelOverlaps();
    refreshMarkerStates();
    updateReportDone();
    // only a filled dish is (re)calculated
    if (isDishComplete(det)) notifyDishDetailComplete(det, wasComplete ? 'changed' : 'completed');
  }
  document.getElementById('reportCountMinus').addEventListener('click', () => changeReportCount(-1));
  document.getElementById('reportCountPlus').addEventListener('click', () => changeReportCount(1));

  /* ---------- calories (shared component: calorie.js) ---------- */
  const Calorie = window.PictaCalorie;
  Calorie.init({ backendUrl: BACKEND_URL });
  let reportKcalOpen = false; // the explanation under the dish name is expanded

  // Whole-meal estimate beside the progress / 完成 button.
  function renderReportTotal(){
    const ids = currentDetections.filter(d => !d.loading && isDishComplete(d)).map(d => d.id);
    const sum = Calorie.summary(ids);
    reportTotal.hidden = !(sum.estimated || sum.pending);
    reportTotalNum.textContent = sum.estimated ? String(sum.kcal) : '…';
    reportTotalNote.hidden = !sum.unavailable;
    reportTotalNote.textContent = sum.unavailable ? `另有 ${sum.unavailable} 道無法估算` : '';
  }

  // Calories beside the selected dish's name, and its expandable explanation.
  function renderReportKcal(){
    const det = selectedReportDet();
    const st = det ? Calorie.getState(det.id) : null;
    const expandable = !!st && st.status !== 'loading';
    if (!expandable) reportKcalOpen = false;
    reportDishKcal.hidden = !st;
    Calorie.renderBadge(reportDishKcal, st);
    reportDishKcal.disabled = !expandable;
    reportDishKcal.setAttribute('aria-expanded', String(reportKcalOpen));
    reportKcalExplain.hidden = !reportKcalOpen;
    if (reportKcalOpen) Calorie.renderExplain(reportKcalExplain, st);
  }
  reportDishKcal.addEventListener('click', () => {
    reportKcalOpen = !reportKcalOpen;
    renderReportKcal();
  });

  // Any dish's calculation started / finished / was dropped.
  document.addEventListener('pictameal:calorie-update', e => {
    const det = (chatMode ? chatAllDets() : currentDetections).find(d => d.id === e.detail.dishId);
    // the matched item is counted per 隻/顆/個 …: the dish needs a 數量
    const st = Calorie.getState(e.detail.dishId);
    const r = st && st.result;
    if (det && r && (st.status === 'needs-count' || r.countable) && !det.countable){
      det.countable = true;
      det.countUnit = det.countUnit || r.countUnit || r.itemUnit || null;
      if (reportActive && !chatMode){
        refreshMarkerStates();
        updateReportDone();
        if (det.id === reportSelectedId) renderReportCount(det);
      }
    }
    if (det && det.labelEl) renderDetLabel(det.labelEl, det);
    if (!reportActive) return;
    resolveLabelOverlaps(); // label width changed
    if (chatMode){
      renderChatKcalRows(e.detail.dishId);
      renderChatTotal();
      return;
    }
    renderReportKcal();
    renderReportTotal();
  });

  // Next unfilled dish after the selected one, in marker-number order,
  // wrapping to the start; null if none is left.
  function nextUnfilledReportDet(){
    const all = currentDetections;
    const start = all.indexOf(selectedReportDet());
    for (let k = 1; k <= all.length; k++){
      const d = all[(start + k + all.length) % all.length];
      if (!d.loading && !isDishComplete(d)) return d;
    }
    return null;
  }

  // Option buttons — same markup/classes as the detail-adjust modal.
  function choiceHtml(kind, value, inner, aria){
    return `<button type="button" class="detail-choice detail-${kind === 'containerType' ? 'container' : kind === 'cookingMethod' ? 'cooking' : kind}-choice" data-kind="${kind}" data-value="${value}" aria-label="${aria}">${inner}</button>`;
  }
  function renderReportCookingOptions(category){
    if (reportLists.cookingMethod.dataset.category === category) return;
    reportLists.cookingMethod.dataset.category = category;
    const methods = category === 'beverage' ? BEVERAGE_COOKING_METHODS : FOOD_COOKING_METHODS;
    reportLists.cookingMethod.innerHTML = methods.map(o => choiceHtml('cookingMethod', o.value,
      `<span class="detail-choice-icon">${o.icon}</span><span class="detail-choice-label">${o.value}</span>`, o.value)).join('');
  }
  function renderReportChoiceLists(){
    reportLists.containerType.innerHTML = containerOptions.map(o => choiceHtml('containerType', o.value,
      `<span class="detail-choice-icon">${o.icon}</span><span class="detail-choice-label">${o.label}</span>`, o.label)).join('');
    reportLists.size.innerHTML = sizeOptions.map(s => choiceHtml('size', s, s, `尺寸 ${s}`)).join('');
    reportLists.sugar.innerHTML = sugarOptions.map(o => choiceHtml('sugar', o.value,
      `<span class="detail-sugar-cup" aria-hidden="true"><span class="detail-sugar-fill" style="height:${o.level}%"></span></span><span class="detail-choice-label">${o.value}</span>`, `糖 ${o.value}`)).join('');
    reportLists.salt.innerHTML = saltOptions.map(o => choiceHtml('salt', o.value,
      `<span class="detail-choice-icon">${o.icon}</span><span class="detail-choice-label">${o.value}</span>`, `鹽 ${o.value}`)).join('');
    renderReportCookingOptions('food');
  }
  function syncReportChoices(det){
    const d = det.detail || {};
    Object.entries(reportLists).forEach(([kind, list]) => {
      list.querySelectorAll('.detail-choice').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.value === d[kind]);
      });
    });
  }
  Object.values(reportLists).forEach(list => {
    list.addEventListener('click', e => {
      const btn = e.target.closest('.detail-choice');
      if (btn) setReportField(btn.dataset.kind, btn.dataset.value);
    });
  });

  function setReportField(kind, value){
    const det = selectedReportDet();
    if (!det || det.loading) return;
    const wasComplete = isDishComplete(det);
    const prev = (det.detail || {})[kind];
    if (currentMealMeta && prev !== value){
      currentMealMeta.editLog.fieldSetCount += 1;
      if (prev) currentMealMeta.editLog.fieldChangeCount += 1; // changed an answer already given
    }
    det.detail = { ...(det.detail || {}), [kind]: value };
    syncReportChoices(det);
    refreshMarkerStates();
    updateReportDone();
    if (isDishComplete(det)) notifyDishDetailComplete(det, wasComplete ? 'changed' : 'completed');
  }

  // Thumbnail = the dish's own (padded) box, cropped once and cached.
  function ensureReportThumb(det){
    if (!det.reportThumb){
      const p = padBoxForThumbnail(det.x, det.y, det.w, det.h);
      det.reportThumb = cropRegionToDataUrl(currentPhotoData, p.x, p.y, p.w, p.h).catch(() => '');
    }
    return det.reportThumb;
  }

  function renderReportPanel(){
    const det = selectedReportDet();
    reportEmptyHint.hidden = !!det;
    reportDish.hidden = !det;
    updateReportDone();
    if (!det) return;

    const { name, confidence } = splitNameConfidence(det.loading ? '辨識中…' : (det.name || ''));
    reportDishNum.textContent = String(currentDetections.indexOf(det) + 1);
    reportDishName.textContent = name;
    reportDishConf.textContent = confidence;
    reportRenameBtn.disabled = !!det.loading || reportRenaming;
    reportDeleteBtn.disabled = !!det.loading;
    renderReportCookingOptions(det.category === 'beverage' ? 'beverage' : 'food');
    syncReportChoices(det);
    renderReportKcal();
    renderReportCount(det);

    reportDishThumb.removeAttribute('src');
    ensureReportThumb(det).then(url => {
      if (reportSelectedId === det.id && url) reportDishThumb.src = url;
    });
  }

  function selectReportDish(id){
    reportSelectedId = id;
    reportKcalOpen = false;
    reportDeleteConfirm.hidden = true;
    refreshMarkerStates();
    renderReportPanel();
  }

  function onReportMarkerTap(det){
    if (reportAddingDish) return;
    if (chatMode){ toggleChatDish(det); return; }
    selectReportDish(det.id);
  }

  function enterReportMode(){
    reportActive = true;
    reportSelectedId = null; // nothing selected until the user taps a dish
    setReportAdding(false);
    reportDeleteConfirm.hidden = true;
    currentDetections.forEach(d => { d.detail = d.detail || {}; });
    reportPhotoSlot.appendChild(recognizeStage);
    reportCountTag.textContent = countTag.textContent;
    renumberMarkers();
    renderReportPanel();
    goToScreen('report');
    requestAnimationFrame(() => {
      sizeReportPhotoSlot();
      layoutRecognizePhoto(false);
    });
  }

  // Page 4's photo area: full content width, height following the photo's
  // aspect ratio, but never taller than half the Page 4 screen (then the
  // photo is height-limited inside it — never cropped, since box
  // coordinates are % of the full photo). The stage's ResizeObserver then
  // re-lays out the photo, markers and labels.
  const REPORT_PHOTO_MAX_SCREEN_SHARE = 0.5;
  const CHAT_PHOTO_MAX_SCREEN_SHARE = 0.4;
  function sizeReportPhotoSlot(){
    if (!reportActive) return;
    const nw = recognizePhoto.naturalWidth;
    const nh = recognizePhoto.naturalHeight;
    const width = reportPhotoSlot.clientWidth;
    const screenH = reportScreenEl.clientHeight;
    if (!nw || !nh || !width || !screenH) return;
    // Group B keeps more room under the photo for the conversation
    const h = Math.min(width * nh / nw, screenH * (chatMode ? CHAT_PHOTO_MAX_SCREEN_SHARE : REPORT_PHOTO_MAX_SCREEN_SHARE));
    reportPhotoSlot.style.height = `${Math.round(h)}px`;
  }
  window.addEventListener('resize', sizeReportPhotoSlot);
  recognizePhoto.addEventListener('load', sizeReportPhotoSlot);

  // Hands the photo stage back to Page 3. Safe to call any time.
  function exitReportMode(){
    reportActive = false;
    if (chatMode) resetChat();
    Calorie.reset();
    reportSelectedId = null;
    setReportAdding(false);
    if (recognizeStage.parentElement !== recognizeBody) recognizeBody.appendChild(recognizeStage);
    reportPhotoSlot.style.height = '';
    refreshMarkerStates();
  }

  /* rename: up to 3 candidates from /api/recognize, or type one */
  reportRenameBtn.addEventListener('click', async () => {
    const det = selectedReportDet();
    if (!det || det.loading || reportRenaming) return;
    reportRenaming = true;
    renderReportPanel();
    const wasComplete = isDishComplete(det);
    const nameBefore = det.name;
    openCandidateDialog(det, [], () => {
      reportRenaming = false;
      renderReportPanel();
    }, {
      allowCustom: true,
      loading: true,
      onConfirm(target, prevCategory){
        if (currentMealMeta && target.name !== nameBefore) currentMealMeta.editLog.renameCount += 1;
        if (target.name !== nameBefore && !target.count) target.countable = false; // re-learned from the next calculation
        // a category switch (food <-> beverage) swaps the cooking options;
        // drop a cooking method the new list doesn't have
        if (target.category !== prevCategory && target.detail && target.detail.cookingMethod){
          const methods = target.category === 'beverage' ? BEVERAGE_COOKING_METHODS : FOOD_COOKING_METHODS;
          if (!methods.some(m => m.value === target.detail.cookingMethod)){
            target.detail = { ...target.detail, cookingMethod: undefined };
          }
        }
        resolveLabelOverlaps();
        refreshMarkerStates();
        renderReportPanel();
        if (isDishComplete(target)) notifyDishDetailComplete(target, wasComplete ? 'changed' : 'completed');
        else Calorie.forget(target.id); // lost its cooking method: the old figure no longer applies
      }
    });
    const candidates = await fetchCandidatesForDet(det);
    if (candidateTargetDet === det) setCandidateChoices(candidates);
  });

  /* delete, with a second confirmation */
  reportDeleteBtn.addEventListener('click', () => {
    if (selectedReportDet()) reportDeleteConfirm.hidden = false;
  });
  reportDeleteCancel.addEventListener('click', () => { reportDeleteConfirm.hidden = true; });
  reportDeleteYes.addEventListener('click', () => {
    const det = selectedReportDet();
    reportDeleteConfirm.hidden = true;
    if (!det) return;
    currentDetections = currentDetections.filter(d => d !== det);
    if (det.boxEl) det.boxEl.remove();
    if (currentMealMeta) currentMealMeta.editLog.deletedDishes.push({
      name: splitNameConfidence(det.name || '').name,
      source: det.addedByUser ? 'user' : 'ai',
      aiName: det.aiOriginal ? det.aiOriginal.name : null
    });
    Calorie.forget(det.id);
    reportSelectedId = null;
    renumberMarkers();
    renderReportPanel();
    resolveLabelOverlaps();
    showToast('已刪除這道菜');
  });

  /* add a dish the AI missed: tap the photo where it is */
  function setReportAdding(on){
    reportAddingDish = on;
    reportAddHint.hidden = !on;
    reportAddDishBtn.textContent = on ? '取消新增' : (chatMode ? '+ 整餐/其他' : '+ 新增菜色');
    reportScreenEl.classList.toggle('report-adding', on);
  }
  reportAddDishBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (reportActive && chatMode){ toggleChatMeal(); return; }
    if (reportActive) setReportAdding(!reportAddingDish);
  });
  recognizeWrap.addEventListener('click', e => {
    if (!reportActive || !reportAddingDish || e.target.closest('button')) return;
    const r = photoRect();
    const v = recognizeWrap.getBoundingClientRect();
    if (e.clientX < Math.max(r.left, v.left) || e.clientX > Math.min(r.right, v.right)
        || e.clientY < Math.max(r.top, v.top) || e.clientY > Math.min(r.bottom, v.bottom)) return;
    const p = clientToPct(e.clientX, e.clientY);
    setReportAdding(false);
    addReportDishAt(p.x, p.y);
  });

  async function addReportDishAt(cx, cy){
    const w = MANUAL_BOX_DEFAULT_SIZE;
    const h = MANUAL_BOX_DEFAULT_SIZE;
    const det = {
      id: `added${Date.now()}`,
      // crop box centered on the tap (kept inside the photo)
      x: Math.max(0, Math.min(100 - w, cx - w / 2)),
      y: Math.max(0, Math.min(100 - h, cy - h / 2)),
      w, h,
      tapPoint: { x: cx, y: cy },
      addedByUser: true,
      name: null,
      confidence: null,
      category: 'food',
      loading: true,
      confirmState: 'pending',
      detail: {}
    };
    currentDetections.push(det);
    renderOneDetection(det, currentDetections.length - 1);
    renumberMarkers();
    selectReportDish(det.id);
    resolveLabelOverlaps();

    const candidates = await fetchCandidatesForDet(det);
    if (!currentDetections.includes(det)) return; // deleted while recognizing
    det.loading = false;
    if (det.dotEl) det.dotEl.classList.remove('loading');
    if (candidates.length){
      const top = candidates[0];
      det.name = `${top.name}(${top.confidence}%)`;
      det.confidence = top.confidence;
      det.category = top.category === 'beverage' ? 'beverage' : 'food';
    } else {
      det.name = '沒認出來,請改菜名';
    }
    renderDetLabel(det.labelEl, det);
    resolveLabelOverlaps();
    refreshMarkerStates();
    if (reportSelectedId === det.id) renderReportPanel();
    else updateReportDone();
  }

  /* done: every dish filled -> save (with group) -> Diary */
  reportDoneBtn.addEventListener('click', async () => {
    if (reportDoneBtn.disabled || isSavingMeal) return;
    isSavingMeal = true;
    updateReportDone();
    try {
      await Calorie.settle(currentDetections.map(d => d.id)); // don't save a half-calculated meal
      await saveCurrentMeal();
    } finally {
      isSavingMeal = false;
      exitReportMode();
    }
  });

  reportNextDishBtn.addEventListener('click', () => {
    const next = nextUnfilledReportDet();
    if (next){
      selectReportDish(next.id);
      reportPanel.scrollTop = 0; // start the next dish at its first field
    }
  });

  reportCameraBtn.addEventListener('click', () => {
    const started = currentDetections.some(d => d.detail && Object.values(d.detail).some(Boolean))
      || (chatMode && chatMessages.some(m => m.role === 'user'));
    if (started && !window.confirm('這一餐還沒完成,離開的話剛剛填的不會儲存。確定要離開嗎?')) return;
    exitReportMode();
    goToScreen('start');
  });

  /* ---------- Page 4, Group B: report by chatting with the AI ----------
     Same screen and photo stage as Group A (markers, labels, zoom, label
     calorie lines) with .report-chat: the field panel is replaced by a
     conversation. Each turn goes to POST /api/chat, which returns Group A's
     five fields (values checked server-side), notes, new / renamed dishes.
     Calories come from calorie.js once a dish has a size (and, for a
     gram / ml item, a container); the chat shows them in a tag row the page
     adds under the AI's reply — never in the AI's own text. */
  const chatLog        = document.getElementById('chatLog');
  const chatForm       = document.getElementById('chatForm');
  const chatInput      = document.getElementById('chatInput');
  const chatSendBtn    = document.getElementById('chatSendBtn');
  const chatMicBtn     = document.getElementById('chatMicBtn');
  const chatDoneBtn    = document.getElementById('chatDoneBtn');
  const chatTotalNum   = document.getElementById('chatTotalNum');
  const chatTotalNote  = document.getElementById('chatTotalNote');
  const chatSelChip    = document.getElementById('chatSelChip');
  const CHAT_HISTORY_SENT = 12;      // recent messages sent with each turn
  const CHAT_TIMEOUT_MS = 45000;

  let chatMessages = [];   // the full conversation, saved with the record
  let chatExtraDets = [];  // dishes added in the chat (not on the photo)
  let chatMealSelected = false;
  let chatBusy = false;
  let chatRenames = [];    // [{ no, from, to }]
  let chatRecognition = null;

  const CHAT_AI_AVATAR = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4v4M9 13h.01M15 13h.01M10 16h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>';
  const CHAT_USER_AVATAR = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  // Every dish the chat knows about: the photo's (numbered like their
  // markers) then the chat-added ones.
  function chatAllDets(){ return currentDetections.concat(chatExtraDets); }
  function chatDishNo(det){ return chatAllDets().indexOf(det) + 1; }
  function chatDishName(det){ return splitNameConfidence(det.name || '').name; }

  function enterChatMode(){
    chatMode = true;
    reportScreenEl.classList.add('report-chat');
    resetChatState();
    currentDetections.forEach(d => {
      d.notes = d.notes || [];
      d.aiOriginal = d.aiOriginal || { name: chatDishName(d), confidence: d.confidence ?? null };
    });
    enterReportMode();
    updateChatSelection();
    renderChatTotal();
    const n = currentDetections.length;
    addChatMessage('assistant', n
      ? `我已辨識到 ${n} 個食物項目(如上圖)。請點選你想描述的食物,然後告訴我你吃了多少、餐點的烹調方式或其他細節。`
      : '照片上沒有辨識到食物。請點「+ 整餐/其他」,告訴我你吃了什麼、吃了多少。');
  }

  function resetChatState(){
    chatMessages = [];
    chatExtraDets = [];
    chatRenames = [];
    chatMealSelected = false;
    chatBusy = false;
    chatLog.textContent = '';
    chatInput.value = '';
    stopChatListening();
  }

  // Leaving the chat page (save, camera, new photo): back to plain Page 4.
  function resetChat(){
    resetChatState();
    chatMode = false;
    reportScreenEl.classList.remove('report-chat');
    reportAddDishBtn.classList.remove('is-active');
  }

  /* selection: a marker, or "+ 整餐/其他"; tapping again deselects */
  function toggleChatDish(det){
    chatMealSelected = false;
    selectReportDish(reportSelectedId === det.id ? null : det.id);
    updateChatSelection();
  }
  function toggleChatMeal(){
    chatMealSelected = !chatMealSelected;
    if (chatMealSelected && reportSelectedId) selectReportDish(null);
    updateChatSelection();
  }
  function updateChatSelection(){
    reportAddDishBtn.classList.toggle('is-active', chatMealSelected);
    reportAddDishBtn.setAttribute('aria-pressed', String(chatMealSelected));
    const det = selectedReportDet();
    chatSelChip.hidden = !det && !chatMealSelected;
    chatSelChip.textContent = '';
    if (!det && !chatMealSelected) return;
    // a thumbnail first: the dish's own box crop (same as Group A's panel),
    // or the whole photo for 整餐/其他
    const img = document.createElement('img');
    img.className = 'chat-sel-thumb';
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = det ? `已選取:${chatDishNo(det)}. ${chatDishName(det)}(再點一次圓圈取消)`
      : '已選取:整餐/其他(再點一次按鈕取消)';
    chatSelChip.append(img, label);
    if (det) ensureReportThumb(det).then(url => { if (url && img.isConnected) img.src = url; });
    else img.src = currentPhotoData || '';
  }
  function chatSelection(){
    const det = selectedReportDet();
    if (det) return { type: 'dish', no: chatDishNo(det), name: chatDishName(det), det };
    return chatMealSelected ? { type: 'meal' } : null;
  }

  /* messages */
  // extra.thumb: a Promise of a thumbnail URL shown in the bubble (display
  // only — the record keeps just which dish was selected)
  function addChatMessage(role, content, extra = {}){
    const msg = { role, content, at: new Date().toISOString(), selected: extra.selected || null, ...extra.meta };
    chatMessages.push(msg);
    const row = renderChatMessage(msg, extra.dishIds || [], extra.thumb);
    scrollChatToEnd();
    return { msg, row };
  }

  function renderChatMessage(msg, dishIds, thumb){
    const row = document.createElement('div');
    row.className = `chat-msg ${msg.role === 'assistant' ? 'chat-msg-ai' : 'chat-msg-user'}`;
    const avatar = document.createElement('span');
    avatar.className = 'chat-avatar';
    avatar.innerHTML = msg.role === 'assistant' ? CHAT_AI_AVATAR : CHAT_USER_AVATAR;
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    if (thumb){
      // "我點選了 X" with that dish's crop beside it
      bubble.classList.add('has-thumb');
      const img = document.createElement('img');
      img.className = 'chat-msg-thumb';
      img.alt = '';
      thumb.then(url => { if (url) img.src = url; });
      const text = document.createElement('span');
      text.textContent = msg.content;
      bubble.append(img, text);
    } else {
      bubble.textContent = msg.content;
    }
    wrap.appendChild(bubble);
    if (dishIds.length){
      const rows = document.createElement('div');
      rows.className = 'chat-kcal-rows';
      rows.dataset.dishIds = dishIds.join(' ');
      wrap.appendChild(rows);
      dishIds.forEach(id => renderChatKcalItem(rows, id));
    }
    const time = document.createElement('span');
    time.className = 'chat-time';
    const at = new Date(msg.at);
    time.textContent = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    wrap.appendChild(time);
    row.append(avatar, wrap);
    chatLog.appendChild(row);
    return row;
  }

  // One "dish name + calorie tag" line under an AI reply, tap to expand.
  function renderChatKcalItem(rows, id){
    let item = rows.querySelector(`[data-dish-id="${id}"]`);
    if (!item){
      item = document.createElement('div');
      item.className = 'chat-kcal-entry';
      item.dataset.dishId = id;
      item.innerHTML = '<div class="chat-kcal-item"><span class="chat-kcal-name"></span><button type="button" class="kcal-tag" aria-expanded="false"></button></div><div class="kcal-explain" hidden></div>';
      const tag = item.querySelector('.kcal-tag');
      tag.addEventListener('click', () => {
        item.dataset.open = item.dataset.open === '1' ? '' : '1';
        renderChatKcalItem(rows, id);
      });
      rows.appendChild(item);
    }
    const det = chatAllDets().find(d => d.id === id);
    const st = Calorie.getState(id);
    const tag = item.querySelector('.kcal-tag');
    const explain = item.querySelector('.kcal-explain');
    item.querySelector('.chat-kcal-name').textContent = det ? chatDishName(det) : '';
    const expandable = !!st && st.status !== 'loading';
    if (!expandable) item.dataset.open = '';
    const open = item.dataset.open === '1';
    tag.hidden = !st;
    Calorie.renderBadge(tag, st);
    tag.disabled = !expandable;
    tag.setAttribute('aria-expanded', String(open));
    explain.hidden = !open;
    if (open) Calorie.renderExplain(explain, st);
  }

  function renderChatKcalRows(id){
    chatLog.querySelectorAll('.chat-kcal-rows').forEach(rows => {
      if (rows.dataset.dishIds.split(' ').includes(id)) renderChatKcalItem(rows, id);
    });
  }

  function scrollChatToEnd(){
    requestAnimationFrame(() => { chatLog.scrollTop = chatLog.scrollHeight; });
  }

  function renderChatTotal(){
    const sum = Calorie.summary(chatAllDets().map(d => d.id));
    chatTotalNum.textContent = sum.estimated ? String(sum.kcal) : (sum.pending ? '…' : '0');
    const notes = [];
    if (sum.needsPortion) notes.push(`${sum.needsPortion} 道待補份量`);
    if (sum.needsCount) notes.push(`${sum.needsCount} 道待補數量`);
    if (sum.unavailable) notes.push(`另有 ${sum.unavailable} 道無法估算`);
    chatTotalNote.hidden = !notes.length;
    chatTotalNote.textContent = notes.join('・');
  }

  /* one turn */
  function chatDishesPayload(){
    return chatAllDets().map(d => ({
      no: chatDishNo(d),
      name: chatDishName(d),
      category: d.category === 'beverage' ? 'beverage' : 'food',
      onPhoto: d.onPhoto !== false,
      fields: { ...(d.detail || {}) },
      notes: [...(d.notes || [])],
      // calorie.js couldn't estimate it yet (a gram / ml item with no container)
      needsPortion: (Calorie.getState(d.id) || {}).status === 'needs-portion',
      count: d.count || null,
      aiCount: (d.aiOriginal && d.aiOriginal.count) || null,
      countUnit: d.countUnit || null,
      countable: !!(d.count || d.countable),
      countConfirmed: !!d.countConfirmed,
      countAsked: !!d.countAsked
    }));
  }

  async function sendChat(text){
    if (chatBusy) return;
    const sel = chatSelection();
    const content = sel && sel.type === 'dish' ? `我點選了 ${sel.name}。${text}`
      : sel && sel.type === 'meal' ? `關於整餐:${text}` : text;
    const history = chatMessages.slice(-CHAT_HISTORY_SENT).map(m => ({ role: m.role, content: m.content }));
    addChatMessage('user', content, {
      selected: sel ? (sel.type === 'dish' ? { type: 'dish', no: sel.no } : { type: 'meal' }) : null,
      thumb: sel && sel.type === 'dish' ? ensureReportThumb(sel.det) : null
    });
    chatInput.value = '';
    // the selection applies to this message only
    chatMealSelected = false;
    if (reportSelectedId) selectReportDish(null);
    updateChatSelection();

    chatBusy = true;
    updateChatBusy();
    // "AI is typing" bubble until the reply arrives
    const typing = renderChatMessage({ role: 'assistant', content: '', at: new Date().toISOString() }, []);
    const typingBubble = typing.querySelector('.chat-bubble');
    typingBubble.classList.add('is-typing');
    typingBubble.innerHTML = '正在整理<span class="chat-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    typing.querySelector('.chat-time').textContent = '';
    scrollChatToEnd();

    const started = performance.now();
    let data = null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);
    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dishes: chatDishesPayload(), selected: sel ? { type: sel.type, no: sel.no } : null, history, message: content }),
        signal: ctrl.signal
      });
      data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.reply !== 'string') data = null;
    } catch (err){
      console.error('[chat] request failed:', err);
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Math.round(performance.now() - started);
    typing.remove();
    chatBusy = false;
    updateChatBusy();
    if (!reportActive || !chatMode) return; // left the page meanwhile

    if (!data){
      logApiError('chat', latencyMs >= CHAT_TIMEOUT_MS ? 'timeout' : 'request failed');
      addChatMessage('assistant', '連線有點慢,請再送一次', { meta: { failed: true, latencyMs } });
      if (!chatInput.value) chatInput.value = text; // ready to resend
      chatInput.focus();
      return;
    }
    const touched = applyChatResult(data);
    addChatMessage('assistant', data.reply, {
      dishIds: touched.map(d => d.id),
      meta: {
        isClarification: !!data.isClarification,
        latencyMs,
        updates: data.updates, notes: data.notes, newDishes: data.newDishes, renameDishes: data.renameDishes
      }
    });
  }

  function updateChatBusy(){
    chatSendBtn.disabled = chatBusy;
    chatInput.disabled = chatBusy;
    chatMicBtn.disabled = chatBusy;
    chatDoneBtn.disabled = chatBusy || isSavingMeal;
  }

  // Applies one /api/chat answer; returns the dishes it touched (in order).
  function applyChatResult(data){
    const all = chatAllDets();
    const byNo = no => all[no - 1] || null;
    const touched = [];
    const touch = det => { if (det && !touched.includes(det)) touched.push(det); };
    const before = new Map(all.map(d => [d, calorieKey(d)]));

    (data.renameDishes || []).forEach(r => {
      const det = byNo(r.no);
      if (!det) return;
      const from = chatDishName(det);
      det.renamedFrom = det.renamedFrom || from;
      det.name = r.name;
      det.confidence = null;
      if (r.category && r.category !== det.category){
        det.category = r.category;
        const methods = det.category === 'beverage' ? BEVERAGE_COOKING_METHODS : FOOD_COOKING_METHODS;
        if (det.detail && det.detail.cookingMethod && !methods.some(m => m.value === det.detail.cookingMethod)){
          det.detail = { ...det.detail, cookingMethod: undefined };
        }
      }
      chatRenames.push({ no: r.no, from, to: r.name });
      if (currentMealMeta) currentMealMeta.editLog.renameCount += 1;
      if (det.labelEl) renderDetLabel(det.labelEl, det);
      det.chatDescribed = true;
      touch(det);
    });
    (data.updates || []).forEach(u => {
      const det = byNo(u.no);
      if (!det) return;
      if (currentMealMeta) Object.entries(u.fields).forEach(([k, v]) => {
        const prev = (det.detail || {})[k];
        if (prev === v) return;
        currentMealMeta.editLog.fieldSetCount += 1;
        if (prev) currentMealMeta.editLog.fieldChangeCount += 1;
      });
      det.detail = { ...(det.detail || {}), ...u.fields };
      // "雞腿吃了 4 隻": what the user ate wins over the photo's count
      if (Number.isInteger(u.count)){
        if (u.count !== det.count) det.countEdits = (det.countEdits || 0) + 1;
        det.count = u.count;
        det.countConfirmed = true;
        det.countable = true;
        det.countUnit = det.countUnit || COUNT_UNITS[2];
        if (det.labelEl) renderDetLabel(det.labelEl, det);
      }
      det.chatDescribed = true;
      touch(det);
    });
    (data.notes || []).forEach(n => {
      const det = byNo(n.no);
      if (!det) return;
      det.notes = det.notes || [];
      if (!det.notes.includes(n.note)) det.notes.push(n.note);
      det.chatDescribed = true;
      touch(det);
    });
    (data.newDishes || []).forEach((nd, i) => {
      const det = {
        id: `chat${Date.now()}_${i}`,
        name: nd.name, confidence: null,
        category: nd.category === 'beverage' ? 'beverage' : 'food',
        detail: { ...(nd.fields || {}) },
        notes: nd.note ? [nd.note] : [],
        ...(Number.isInteger(nd.count) ? { count: nd.count, countUnit: COUNT_UNITS[2], countEdits: 0 } : {}),
        onPhoto: false,
        chatDescribed: true
      };
      chatExtraDets.push(det);
      touch(det);
    });

    // the AI asked how many of this dish were eaten (asked once per dish)
    const asked = byNo(data.askCountFor);
    if (asked){ asked.countAsked = true; asked.countable = true; }

    resolveLabelOverlaps();
    refreshMarkerStates();
    touched.forEach(det => {
      if ((det.count || det.countable) && !det.countConfirmed){
        Calorie.markNeedsCount(det.id, det.countUnit); // 待補數量
        det.kcalStarted = false;
        return;
      }
      if (!det.detail || !det.detail.size){
        Calorie.markNeedsPortion(det.id); // 待補份量
        det.kcalStarted = false;
        return;
      }
      if (!det.kcalStarted || before.get(det) !== calorieKey(det)){
        notifyDishDetailComplete(det, det.kcalStarted ? 'changed' : 'completed');
        det.kcalStarted = true;
      }
    });
    renderChatTotal();
    return touched;
  }
  // What the calorie depends on (notes alone never trigger a recalculation)
  const calorieKey = d => JSON.stringify([chatDishName(d), d.category, d.detail || {}, d.count || null, !!d.countConfirmed]);

  chatForm.addEventListener('submit', e => {
    e.preventDefault();
    stopChatListening();
    const text = chatInput.value.trim();
    if (text) sendChat(text);
  });
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing){
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 110)}px`;
  });

  /* 🎤 Web Speech: the words go into the text box; the user sends them */
  function stopChatListening(){
    if (chatRecognition){
      try { chatRecognition.stop(); } catch (err){ /* already stopped */ }
      chatRecognition = null;
    }
    chatMicBtn.classList.remove('is-listening');
  }
  chatMicBtn.addEventListener('click', () => {
    if (chatRecognition){ stopChatListening(); return; }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor){ showToast('這個瀏覽器不支援語音輸入,請直接打字'); return; }
    const rec = new Ctor();
    rec.lang = 'zh-TW';
    rec.interimResults = true;
    rec.continuous = false;
    const base = chatInput.value ? `${chatInput.value.trim()} ` : '';
    rec.onresult = ev => {
      let text = '';
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      chatInput.value = base + text;
      chatInput.dispatchEvent(new Event('input'));
    };
    rec.onerror = ev => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') showToast('沒有麥克風權限,請直接打字');
      else if (ev.error !== 'aborted' && ev.error !== 'no-speech') showToast('語音辨識失敗,請再試一次或直接打字');
    };
    rec.onend = () => { if (chatRecognition === rec) stopChatListening(); chatInput.focus(); };
    try {
      rec.start();
      chatRecognition = rec;
      chatMicBtn.classList.add('is-listening');
    } catch (err){
      showToast('語音辨識無法啟動,請直接打字');
    }
  });

  /* 完成: any time; asks first when something is incomplete */
  chatDoneBtn.addEventListener('click', async () => {
    if (chatBusy || isSavingMeal) return;
    const all = chatAllDets();
    const incomplete = all.filter(d => !d.chatDescribed || !d.detail || !d.detail.size
      || ((d.count || d.countable) && !d.countConfirmed)).length; // count not confirmed yet
    if (incomplete && !window.confirm(`還有 ${incomplete} 道菜的資訊不完整,確定要完成嗎?`)) return;
    isSavingMeal = true;
    updateChatBusy();
    try {
      await Calorie.settle(all.map(d => d.id));
      const recordExtra = {
        chat: {
          messages: chatMessages.map(m => ({ ...m })),
          messageCount: chatMessages.length,
          userMessageCount: chatMessages.filter(m => m.role === 'user').length,
          clarificationCount: chatMessages.filter(m => m.isClarification).length,
          newDishes: chatExtraDets.map(d => d.name),
          renamedDishes: chatRenames.map(r => ({ ...r }))
        }
      };
      await saveCurrentMeal({ extraDets: chatExtraDets.slice(), recordExtra });
    } finally {
      isSavingMeal = false;
      exitReportMode();
      updateChatBusy();
    }
  });

  renderReportChoiceLists();

  /* ---------- voice correction + feedback translation (Web Speech API) ---------- */
  const voiceModal            = document.getElementById('voiceModal');
  const voiceModalClose       = document.getElementById('voiceModalClose');
  const voiceStateListening   = document.getElementById('voiceStateListening');
  const voiceStateResult      = document.getElementById('voiceStateResult');
  const voiceStateFallback    = document.getElementById('voiceStateFallback');
  const voiceListeningText    = document.getElementById('voiceListeningText');
  const voiceCancelBtn        = document.getElementById('voiceCancelBtn');
  const voiceResultText       = document.getElementById('voiceResultText');
  const voiceRenameWarning    = document.getElementById('voiceRenameWarning');
  const voiceRetryBtn         = document.getElementById('voiceRetryBtn');
  const voiceConfirmBtn       = document.getElementById('voiceConfirmBtn');
  const voiceFallbackInput    = document.getElementById('voiceFallbackInput');
  const voiceFallbackConfirmBtn = document.getElementById('voiceFallbackConfirmBtn');

  function getSpeechRecognitionCtor(){
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  let voiceTargetDet = null;
  let voiceMode = 'name';
  let recognition = null;
  let recognizedText = '';
  let renameWarningPending = null;
  let renameRequiresExplicitOverride = false;

  function normalizeRenameText(value){
    return String(value || '')
      .replace(/\(\d+%\)$/g, '')
      .replace(/[（()）]/g, '')
      .replace(/[，、。！？]/g, '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase();
  }

  function isRenameDifferenceLarge(originalValue, candidateValue){
    const originalName = normalizeRenameText(originalValue);
    const candidateName = normalizeRenameText(candidateValue);

    if (!originalName || !candidateName || originalName === candidateName) return false;
    if (originalName.includes(candidateName) || candidateName.includes(originalName)) return false;

    const originalChars = [...new Set(originalName)];
    const candidateChars = [...new Set(candidateName)];
    const sharedChars = originalChars.filter(ch => candidateChars.includes(ch));
    const sharedRatio = sharedChars.length / Math.max(originalChars.length, candidateChars.length, 1);
    const lengthGap = Math.abs(originalName.length - candidateName.length);

    return sharedRatio < 0.35 || lengthGap >= 3;
  }

  function stripConfidenceText(value){
    return String(value || '').replace(/\(\d+%\)$/g, '').trim();
  }

  function clearRenameWarningState(){
    renameWarningPending = null;
    renameRequiresExplicitOverride = false;
    voiceRenameWarning.hidden = true;
    voiceRenameWarning.textContent = '';
    voiceConfirmBtn.textContent = '✓ 確認';
  }

  function maybeShowRenameWarning(candidateText){
    const originalName = voiceTargetDet ? stripConfidenceText(voiceTargetDet.name || '') : '';
    const normalizedOriginal = normalizeRenameText(originalName);
    const normalizedCandidate = normalizeRenameText(candidateText || '');

    if (!normalizedOriginal || !normalizedCandidate || normalizedOriginal === normalizedCandidate){
      clearRenameWarningState();
      return false;
    }

    if (!isRenameDifferenceLarge(originalName, candidateText)) {
      clearRenameWarningState();
      return false;
    }

    renameWarningPending = candidateText.trim();
    renameRequiresExplicitOverride = true;
    voiceRenameWarning.textContent = `你想把這道菜改成「${candidateText.trim()}」，但目前辨識結果更像是「${originalName}」。這兩個名稱差異很大，若你確認是系統誤判，請點「我確認是誤判」；若不確定，請保留目前結果。`;
    voiceRenameWarning.hidden = false;
    voiceConfirmBtn.textContent = '我確認是誤判';
    return true;
  }

  function showVoiceState(name){
    voiceStateListening.hidden = name !== 'listening';
    voiceStateResult.hidden = name !== 'result';
    voiceStateFallback.hidden = name !== 'fallback';
    if (name !== 'result') clearRenameWarningState();
  }

  function stopRecognition(){
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.stop(); } catch (err){ /* already stopped */ }
    recognition = null;
  }

  function closeVoiceModal(){
    voiceModal.hidden = true;
    stopRecognition();
    voiceTargetDet = null;
    clearRenameWarningState();
  }

  function startListening(){
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    recognizedText = '';
    showVoiceState('listening');
    stopRecognition();

    if (!SpeechRecognitionCtor){
      showVoiceState('fallback');
      voiceFallbackInput.value = '';
      setTimeout(() => voiceFallbackInput.focus(), 50);
      return;
    }

    recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-TW';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      recognizedText = transcript.trim();
      if (!recognizedText){
        showToast('沒聽清楚,再說一次看看');
        return;
      }
      voiceResultText.textContent = recognizedText;
      if (maybeShowRenameWarning(recognizedText)) {
        showVoiceState('result');
        return;
      }
      showVoiceState('result');
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech'){
        showToast('沒聽到聲音,再試一次');
        showVoiceState('listening');
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed'){
        showToast('沒有麥克風權限,改用文字輸入');
        showVoiceState('fallback');
        voiceFallbackInput.value = '';
        voiceFallbackInput.focus();
      } else {
        showToast('語音辨識發生問題,改用文字輸入');
        showVoiceState('fallback');
      }
    };

    try {
      recognition.start();
    } catch (err){
      showVoiceState('fallback');
    }
  }

  function openVoiceModal(det, mode){
    voiceTargetDet = det;
    voiceMode = mode;
    voiceListeningText.textContent = '請說出菜名…';
    voiceFallbackInput.placeholder = '輸入菜名';
    voiceModal.hidden = false;

    if (!getSpeechRecognitionCtor()){
      showVoiceState('fallback');
      voiceFallbackInput.value = '';
      setTimeout(() => voiceFallbackInput.focus(), 50);
      return;
    }
    startListening();
  }

  function applyVoiceResult(text){
    const det = voiceTargetDet;
    if (!det || !text) return;
    det.name = text;
    det.loading = false;
    if (det.labelEl) renderDetLabel(det.labelEl, det);
    if (det.dotEl) det.dotEl.classList.remove('loading');
    if (typeof det.refreshRow === 'function') det.refreshRow();
    closeVoiceModal();
    setConfirmState(det, 'confirmed');
    showToast('菜名已更新');
  }

  function cancelVoiceEditing(){
    if (voiceTargetDet && voiceTargetDet.confirmState === 'editing'){
      setConfirmState(voiceTargetDet, voiceTargetDet.preEditState || 'pending');
    }
    closeVoiceModal();
  }

  voiceModalClose.addEventListener('click', cancelVoiceEditing);
  voiceCancelBtn.addEventListener('click', cancelVoiceEditing);
  voiceRetryBtn.addEventListener('click', startListening);
  voiceConfirmBtn.addEventListener('click', () => {
    const candidate = recognizedText.trim();
    if (!candidate) return;

    const originalName = voiceTargetDet ? stripConfidenceText(voiceTargetDet.name || '') : '';
    const normalizedOriginal = normalizeRenameText(originalName);
    const normalizedCandidate = normalizeRenameText(candidate);

    if (renameWarningPending && normalizedCandidate === normalizeRenameText(renameWarningPending)) {
      if (renameRequiresExplicitOverride) {
        applyVoiceResult(candidate);
        return;
      }
      applyVoiceResult(candidate);
      return;
    }

    if (normalizedOriginal && normalizedCandidate && normalizedOriginal !== normalizedCandidate) {
      if (isRenameDifferenceLarge(originalName, candidate)) {
        if (renameRequiresExplicitOverride) {
          applyVoiceResult(candidate);
          return;
        }
        maybeShowRenameWarning(candidate);
        return;
      }
    }

    applyVoiceResult(candidate);
  });
  voiceFallbackConfirmBtn.addEventListener('click', () => {
    const text = voiceFallbackInput.value.trim();
    if (!text) return;
    const originalName = voiceTargetDet ? stripConfidenceText(voiceTargetDet.name || '') : '';
    const normalizedOriginal = normalizeRenameText(originalName);
    const normalizedCandidate = normalizeRenameText(text);
    recognizedText = text;

    if (normalizedOriginal && normalizedCandidate && normalizedOriginal !== normalizedCandidate) {
      if (!isRenameDifferenceLarge(originalName, text)) {
        applyVoiceResult(text);
        return;
      }

      voiceResultText.textContent = text;
      renameWarningPending = text;
      renameRequiresExplicitOverride = true;
      voiceRenameWarning.textContent = `你想把這道菜改成「${text}」，但目前辨識結果更像是「${originalName}」。這兩個名稱差異很大，若你確認是系統誤判，請點「我確認是誤判」；若不確定，請保留目前結果。`;
      voiceRenameWarning.hidden = false;
      voiceConfirmBtn.textContent = '我確認是誤判';
      showVoiceState('result');
      return;
    }

    applyVoiceResult(text);
  });
  voiceFallbackInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') voiceFallbackConfirmBtn.click();
  });
})();
