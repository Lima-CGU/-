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
      const order = ['start', 'camera', 'review'];
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

  function addMealCard(dataUrl, dishCount){
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
    status.className = 'meal-status';
    status.textContent = '等待辨識';

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
    addMealCard(currentPhotoData, selectedDishCount);
    showToast(`已上傳,標記 ${selectedDishCount === 6 ? '6+' : selectedDishCount} 道菜,等待辨識`);
    currentPhotoData = null;
    goToScreen('start');
  });

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });
})();
