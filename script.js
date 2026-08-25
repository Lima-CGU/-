(() => {
  'use strict';

  /* ---------- elements ---------- */
  const steps       = document.querySelectorAll('.flow-steps li');
  const screens      = document.querySelectorAll('.screen');
  const phone        = document.getElementById('phone');
  const tabDiaryBtn  = document.getElementById('tabDiaryBtn');
  const tabCameraBtn = document.getElementById('tabCameraBtn');

  const toCameraBtn      = document.getElementById('toCameraBtn');
  const usageLink        = document.getElementById('usageLink');
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

  const recognizePhoto   = document.getElementById('recognizePhoto');
  const recognizeOverlay = document.getElementById('recognizeOverlay');
  const confirmProgress  = document.getElementById('confirmProgress');
  const finishRecognizeBtn = document.getElementById('finishRecognizeBtn');

  const strip      = document.getElementById('strip');
  const emptyState = document.getElementById('emptyState');
  const countTag   = document.getElementById('countTag');
  const toast       = document.getElementById('toast');

  let stream = null;
  let currentPhotoData = null;
  let mealCount = 0;

  /* ---------- toast ---------- */
  let toastTimer = null;
  function showToast(msg){
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  /* ---------- screen navigation ---------- */
  function goToScreen(name){
    screens.forEach(s => s.classList.toggle('active', s.dataset.screen === name));
    steps.forEach(li => {
      li.classList.toggle('active', li.dataset.step === name);
      const order = ['start', 'camera', 'review', 'recognize'];
      li.classList.toggle('done', order.indexOf(li.dataset.step) < order.indexOf(name));
    });
    phone.dataset.screen = name;
    tabDiaryBtn.classList.toggle('active', name === 'diary');
    tabCameraBtn.classList.toggle('active', name === 'start');
    if (name === 'camera') openCamera();
    else closeCamera();
  }

  tabDiaryBtn.addEventListener('click', () => goToScreen('diary'));
  tabCameraBtn.addEventListener('click', () => goToScreen('start'));

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

  function getDishDisplayText(det){
    const base = det && !det.loading && det.name ? det.name : '辨識中…';
    const detailText = det ? formatDishDetail(det.detail) : '';
    return detailText ? `${base} · ${detailText}` : base;
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
    const detailText = det ? formatDishDetail(det.detail) : '';

    labelEl.innerHTML = '';
    const nameEl = document.createElement('span');
    nameEl.className = 'det-label-name';
    nameEl.textContent = name;
    labelEl.appendChild(nameEl);

    const metaText = [confidence, detailText].filter(Boolean).join(' · ');
    if (metaText){
      const metaEl = document.createElement('span');
      metaEl.className = 'det-label-meta';
      metaEl.textContent = metaText;
      labelEl.appendChild(metaEl);
    }
  }

  function addMealCard(dataUrl, dishCount, dishes){
    emptyState.style.display = 'none';
    mealCount += 1;
    countTag.textContent = `${mealCount} 筆`;

    const card = document.createElement('div');
    card.className = 'meal-card';

    const img = document.createElement('img');
    img.className = 'meal-photo';
    img.src = dataUrl;
    img.alt = `餐點照片,標記 ${dishCount} 道菜`;

    const meta = document.createElement('div');
    meta.className = 'meal-meta';
    meta.innerHTML = `
      <span class="meal-dishes">${dishCount} 道菜</span>
      <span class="meal-time">${timestamp()}</span>
    `;

    const status = document.createElement('div');
    if (dishes && dishes.length){
      status.className = 'meal-status done';
      dishes.forEach(d => {
        const row = document.createElement('div');
        row.className = 'meal-dish-row';

        const nameEl = document.createElement('span');
        nameEl.className = 'meal-dish-name';
        nameEl.textContent = d.name;
        row.appendChild(nameEl);

        const detailText = formatDishDetail(d.detail);
        if (detailText){
          const detailEl = document.createElement('span');
          detailEl.className = 'meal-dish-detail';
          detailEl.textContent = detailText;
          row.appendChild(detailEl);
        }

        status.appendChild(row);
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
    });

    card.append(img, meta, status, removeBtn);
    strip.prepend(card);
  }

  confirmUploadBtn.addEventListener('click', () => {
    if (!currentPhotoData) return;
    goToScreen('recognize');
    setupRecognizeScreen(currentPhotoData);
  });

  /* ---------- mock recognition (demo data, no real AI) ---------- */
  const DISH_NAME_POOL = [
    '白飯', '蕃茄炒蛋', '滷雞腿', '炒高麗菜', '味噌湯',
    '涼拌小黃瓜', '紅燒豆腐', '糖醋排骨', '蒜炒地瓜葉', '蒸魚',
    '木耳炒肉絲', '滷豆干', '玉米濃湯', '煎鮭魚', '芹菜炒豆包'
  ];
  const DET_COLORS = ['#6d4fe0', '#ff6f59', '#ffc857', '#3b82f6', '#ec4899', '#8b5cf6'];

  function colorToRgba(hex, alpha){
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0,2), 16);
    const g = parseInt(h.substring(2,4), 16);
    const b = parseInt(h.substring(4,6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

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
  let backendWarned = false;

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

  async function autoDetectDishes(photoDataUrl){
    if (!backendWarned){
      backendWarned = true;
      showToast('第一次辨識可能要等後端伺服器醒過來,約 30-50 秒');
    }
    recognizeHint.textContent = 'AI 正在自動框出並辨識菜色…';
    finishRecognizeBtn.disabled = true;

    try {
      const data = await callDetectAPI(photoDataUrl);
      const dishes = data.dishes || [];

      if (!dishes.length){
        recognizeHint.textContent = '沒有辨識到菜色,請重新拍一張照片試試';
      } else {
        dishes.forEach((d, i) => {
          const box = normalizeDetectionBox(d);
          const det = {
            id: `auto${i}`,
            x: box.x, y: box.y, w: box.w, h: box.h,
            name: `${d.name}(${d.confidence}%)`,
            loading: false,
            color: DET_COLORS[i % DET_COLORS.length],
            confirmState: 'pending'
          };
          currentDetections.push(det);
          renderOneDetection(det, i);
        });
        recognizeHint.textContent = '';
      }
    } catch (err){
      console.error(err);
      recognizeHint.textContent = '自動辨識失敗,請重新拍一張照片試試';
      showToast('自動辨識失敗,請重新拍照');
    }

    finishRecognizeBtn.disabled = false;
    updateProgress();
  }

  const recognizeHint    = document.getElementById('recognizeHint');

  let currentDetections = [];

  function updateProgress(){
    const total = currentDetections.length;
    const done = currentDetections.filter(d => d.confirmState === 'confirmed').length;
    confirmProgress.textContent = total
      ? `已確認 ${done}`
      : '還沒有框任何一道菜';
  }

  // Drives the three-state ✓ indicator: pending (hollow) -> editing (thin
  // outline, while a voice/detail edit is open) -> confirmed (solid green).
  function setConfirmState(det, state){
    det.confirmState = state;
    const box = det.boxEl;
    const dot = det.dotEl;

    if (box){
      box.classList.toggle('confirmed', state === 'confirmed');
      if (state === 'confirmed'){
        box.style.borderColor = colorToRgba('#12a981', 0.55);
        box.style.background = colorToRgba('#12a981', 0.1);
      } else {
        box.style.borderColor = det.color;
        box.style.background = colorToRgba(det.color, 0.08);
      }
    }

    if (dot){
      dot.classList.remove('state-pending', 'state-editing', 'state-confirmed');
      dot.classList.add(`state-${state}`);
      dot.textContent = state === 'confirmed' ? '✓' : '';
    }

    updateProgress();
  }

  function setupRecognizeScreen(photoDataUrl){
    recognizePhoto.src = photoDataUrl;
    recognizeOverlay.innerHTML = '';
    currentDetections = [];
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
    box.style.borderColor = det.color;
    box.style.background = colorToRgba(det.color, 0.08);

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
    dot.style.left = (det.x + det.w / 2) + '%';
    dot.style.top = (det.y + det.h / 2) + '%';
    dot.setAttribute('aria-label', `確認第 ${i + 1} 道菜`);
    det.dotEl = dot;
    det.boxEl = box;

    dot.addEventListener('click', e => {
      e.stopPropagation();
      if (det.loading){
        showToast('還在辨識中,等結果出來再確認');
        return;
      }
      if (det.confirmState === 'pending'){
        setConfirmState(det, 'confirmed');
      }
    });

    const micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'det-mic';
    micBtn.style.left = (det.x + det.w / 2) + '%';
    micBtn.style.top = (det.y + det.h / 2) + '%';
    micBtn.textContent = '🎤';
    micBtn.setAttribute('aria-label', '用語音修正菜名');
    micBtn.addEventListener('click', e => {
      e.stopPropagation();
      det.preEditState = det.confirmState;
      setConfirmState(det, 'editing');
      openVoiceModal(det, 'name');
    });

    const detailBtn = document.createElement('button');
    detailBtn.type = 'button';
    detailBtn.className = 'det-detail';
    detailBtn.textContent = '⚙ 細部調整';
    detailBtn.setAttribute('aria-label', '細部調整這道菜的份量與烹調方式');
    detailBtn.addEventListener('click', e => {
      e.stopPropagation();
      openDetailAdjustModal(det);
    });

    box.append(removeBtn, dot, micBtn, detailBtn);
    recognizeOverlay.appendChild(box);

    setConfirmState(det, det.confirmState);
  }

  finishRecognizeBtn.addEventListener('click', () => {
    const total = currentDetections.length;
    if (total === 0){
      showToast('AI 沒有辨識到菜色,請重新拍一張照片');
      return;
    }
    if (currentDetections.some(d => d.loading)){
      showToast('還有菜色在辨識中,等一下再試');
      return;
    }
    const done = currentDetections.filter(d => d.confirmState === 'confirmed').length;
    if (done < total){
      showToast(`還有 ${total - done} 道菜還沒確認,點圓點確認一下`);
      return;
    }
    const dishes = currentDetections.map(d => ({
      name: d.name,
      detail: d.detail ? { ...d.detail } : null
    }));
    addMealCard(currentPhotoData, currentDetections.length, dishes);
    showToast('這餐記錄好了!');
    currentPhotoData = null;
    goToScreen('diary');
  });

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });

  /* ---------- detail adjustment panel ---------- */
  const detailAdjustModal = document.getElementById('detailAdjustModal');
  const detailAdjustClose = document.getElementById('detailAdjustClose');
  const detailAdjustCancelBtn = document.getElementById('detailAdjustCancelBtn');
  const detailAdjustConfirmBtn = document.getElementById('detailAdjustConfirmBtn');
  const detailContainerList = document.getElementById('detailContainerList');
  const detailSizeList = document.getElementById('detailSizeList');
  const detailCookingList = document.getElementById('detailCookingList');
  const detailSugarList = document.getElementById('detailSugarList');
  const detailSaltList = document.getElementById('detailSaltList');

  const containerOptions = [
    { value: 'plate', icon: '🍽️', label: '盤子' },
    { value: 'bowl', icon: '🥣', label: '碗' },
    { value: 'cup', icon: '🥤', label: '杯子' }
  ];
  const sizeOptions = ['XS', 'S', 'M', 'L', 'XL'];
  const cookingOptions = [
    { value: '沙拉', icon: '🥗' },
    { value: '水煮', icon: '🍲' },
    { value: '蒸', icon: '♨️' },
    { value: '炒', icon: '🥘' },
    { value: '煎', icon: '🍳' },
    { value: '炸', icon: '🍟' },
    { value: '烤', icon: '🥖' },
    { value: '燒烤', icon: '🍖' },
    { value: '烘焙', icon: '🍰' }
  ];
  const sugarOptions = [
    { value: '無糖', level: 0 },
    { value: '微糖(四分之一)', level: 25 },
    { value: '半糖', level: 50 },
    { value: '少糖(四分之三)', level: 75 },
    { value: '全糖', level: 100 }
  ];
  const saltOptions = [
    { value: '無鹽', icon: '🥄' },
    { value: '1/4 茶匙', icon: '🥄' },
    { value: '1/2 茶匙', icon: '🥄' },
    { value: '3/4 茶匙', icon: '🥄' },
    { value: '1 茶匙', icon: '🥄' }
  ];

  let detailAdjustTarget = null;
  let detailDraft = {};

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

    detailCookingList.innerHTML = cookingOptions.map(option => `
      <button type="button" class="detail-choice detail-cooking-choice" data-kind="cookingMethod" data-value="${option.value}" aria-label="${option.value}">
        <span class="detail-choice-icon">${option.icon}</span>
        <span class="detail-choice-label">${option.value}</span>
      </button>
    `).join('');

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

    detailCookingList.querySelectorAll('.detail-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        detailDraft.cookingMethod = btn.dataset.value;
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
    syncDetailSelectionState();
    detailAdjustModal.hidden = false;
  }

  function confirmDetailAdjust(){
    if (!detailAdjustTarget) return;
    detailAdjustTarget.detail = { ...detailDraft };
    if (detailAdjustTarget.labelEl) {
      renderDetLabel(detailAdjustTarget.labelEl, detailAdjustTarget);
    }
    setConfirmState(detailAdjustTarget, 'confirmed');
    closeDetailAdjustModal();
    showToast('細部調整已更新');
  }

  renderDetailSelectorButtons();
  detailAdjustClose.addEventListener('click', cancelDetailAdjust);
  detailAdjustCancelBtn.addEventListener('click', cancelDetailAdjust);
  detailAdjustConfirmBtn.addEventListener('click', confirmDetailAdjust);

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
