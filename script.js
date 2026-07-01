(() => {
  'use strict';

  /* ---------- elements ---------- */
  const steps       = document.querySelectorAll('.flow-steps li');
  const screens      = document.querySelectorAll('.screen');

  const toCameraBtn      = document.getElementById('toCameraBtn');
  const backToStartBtn   = document.getElementById('backToStartBtn');
  const retakeBtn        = document.getElementById('retakeBtn');
  const confirmUploadBtn = document.getElementById('confirmUploadBtn');

  const video        = document.getElementById('video');
  const canvas       = document.getElementById('canvas');
  const cameraIdle   = document.getElementById('cameraIdle');
  const cameraStatus = document.getElementById('cameraStatus');
  const retryCamBtn  = document.getElementById('retryCamBtn');
  const shotBtn       = document.getElementById('shotBtn');
  const fileInput     = document.getElementById('fileInput');

  const reviewImg   = document.getElementById('reviewImg');
  const dishChips   = document.getElementById('dishChips');

  const recognizeWrap    = document.getElementById('recognizeWrap');
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
  let selectedDishCount = 4;
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
    if (name === 'camera') openCamera();
    else closeCamera();
  }

  toCameraBtn.addEventListener('click', () => goToScreen('camera'));
  backToStartBtn.addEventListener('click', () => goToScreen('start'));
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

  function useDataUrl(dataUrl){
    currentPhotoData = dataUrl;
    reviewImg.src = dataUrl;
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

  /* ---------- dish count chips ---------- */
  dishChips.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    dishChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    selectedDishCount = Number(chip.dataset.count);
  });

  /* ---------- confirm upload -> log entry ---------- */
  function timestamp(){
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function addMealCard(dataUrl, dishCount, dishNames){
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
      <span class="meal-dishes">${dishCount === 6 ? '6+' : dishCount} 道菜</span>
      <span class="meal-time">${timestamp()}</span>
    `;

    const status = document.createElement('div');
    if (dishNames && dishNames.length){
      status.className = 'meal-status done';
      status.textContent = dishNames.join('、');
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
    setupRecognizeScreen(currentPhotoData, selectedDishCount);
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

  // Generate non-overlapping-ish bounding boxes in a jittered grid, as % of container
  function generateDetections(n){
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = 100 / cols;
    const cellH = 100 / rows;
    const names = pickRandomNames(n);
    const dets = [];
    for (let i = 0; i < n; i++){
      const col = i % cols;
      const row = Math.floor(i / cols);
      const jitterX = (Math.random() - 0.5) * cellW * 0.12;
      const jitterY = (Math.random() - 0.5) * cellH * 0.12;
      const w = cellW * (0.62 + Math.random() * 0.18);
      const h = cellH * (0.62 + Math.random() * 0.18);
      const x = col * cellW + (cellW - w) / 2 + jitterX;
      const y = row * cellH + (cellH - h) / 2 + jitterY;
      dets.push({
        id: `d${i}`,
        x: Math.max(2, Math.min(98 - w, x)),
        y: Math.max(2, Math.min(98 - h, y)),
        w, h,
        name: names[i],
        color: DET_COLORS[i % DET_COLORS.length],
        confirmed: false
      });
    }
    return dets;
  }

  let currentDetections = [];

  function updateProgress(){
    const total = currentDetections.length;
    const done = currentDetections.filter(d => d.confirmed).length;
    confirmProgress.textContent = `已確認 ${done} / ${total}`;
  }

  function closeAllTips(exceptEl){
    recognizeOverlay.querySelectorAll('.det-tip.show').forEach(tip => {
      if (tip !== exceptEl) tip.classList.remove('show');
    });
  }

  function setupRecognizeScreen(photoDataUrl, dishCount){
    const n = dishCount === 6 ? 6 : dishCount;
    recognizePhoto.src = photoDataUrl;
    recognizeOverlay.innerHTML = '';
    currentDetections = generateDetections(n);

    currentDetections.forEach((det, i) => {
      const box = document.createElement('div');
      box.className = 'det-box';
      box.style.left = det.x + '%';
      box.style.top = det.y + '%';
      box.style.width = det.w + '%';
      box.style.height = det.h + '%';
      box.style.borderColor = det.color;
      box.style.background = colorToRgba(det.color, 0.08);

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'det-dot';
      dot.style.left = (det.x + det.w / 2) + '%';
      dot.style.top = (det.y + det.h / 2) + '%';
      dot.style.background = det.color;
      dot.setAttribute('aria-label', `第 ${i + 1} 道菜,點看看是什麼`);
      dot.textContent = i + 1;

      const tip = document.createElement('span');
      tip.className = 'det-tip';
      if (det.y < 22) tip.classList.add('below');
      const tipName = document.createElement('span');
      tipName.className = 'det-tip-name';
      tipName.textContent = det.name;
      const tipConfirm = document.createElement('button');
      tipConfirm.type = 'button';
      tipConfirm.className = 'det-tip-confirm';
      tipConfirm.setAttribute('aria-label', `確認是${det.name}`);
      tipConfirm.textContent = '✓';
      tip.append(tipName, tipConfirm);
      dot.appendChild(tip);

      function confirmThis(){
        det.confirmed = true;
        box.classList.add('confirmed');
        box.style.borderColor = '#12a981';
        box.style.background = colorToRgba('#12a981', 0.1);
        dot.style.background = '#12a981';
        dot.textContent = '✓';
        tip.classList.remove('show');
        updateProgress();
      }

      tipConfirm.addEventListener('click', e => {
        e.stopPropagation();
        confirmThis();
      });

      dot.addEventListener('click', e => {
        e.stopPropagation();
        const willShow = !tip.classList.contains('show');
        closeAllTips();
        tip.classList.toggle('show', willShow);
      });

      box.appendChild(dot);
      recognizeOverlay.appendChild(box);
    });

    updateProgress();
  }

  document.addEventListener('click', () => closeAllTips());

  finishRecognizeBtn.addEventListener('click', () => {
    const total = currentDetections.length;
    const done = currentDetections.filter(d => d.confirmed).length;
    if (done < total){
      showToast(`還有 ${total - done} 道菜還沒確認,點圓點確認一下`);
      return;
    }
    const names = currentDetections.map(d => d.name);
    addMealCard(currentPhotoData, selectedDishCount, names);
    showToast('這餐記錄好了!');
    currentPhotoData = null;
    goToScreen('start');
  });

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });
})();
