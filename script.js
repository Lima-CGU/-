(() => {
  'use strict';

  const dropzone   = document.getElementById('dropzone');
  const fileInput  = document.getElementById('fileInput');
  const strip      = document.getElementById('strip');
  const emptyState = document.getElementById('emptyState');
  const countTag   = document.getElementById('countTag');
  const toast      = document.getElementById('toast');

  const video      = document.getElementById('video');
  const canvas     = document.getElementById('canvas');
  const cameraIdle = document.getElementById('cameraIdle');
  const recDot     = document.getElementById('recDot');
  const startCam   = document.getElementById('startCam');
  const stopCam    = document.getElementById('stopCam');
  const shotBtn    = document.getElementById('shotBtn');

  let stream = null;
  let photoCount = 0;

  /* ---------- toast ---------- */
  let toastTimer = null;
  function showToast(msg){
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  /* ---------- helpers ---------- */
  function timestamp(){
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function addPrint(dataUrl, label){
    emptyState.style.display = 'none';
    photoCount += 1;
    countTag.textContent = `${photoCount} 張`;

    const card = document.createElement('div');
    card.className = 'print';
    card.style.setProperty('--tilt', `${(Math.random() * 4 - 2).toFixed(2)}deg`);

    const tape = document.createElement('span');
    tape.className = 'print-tape';
    tape.setAttribute('aria-hidden', 'true');

    const img = document.createElement('img');
    img.className = 'print-photo';
    img.src = dataUrl;
    img.alt = label;

    const caption = document.createElement('div');
    caption.className = 'print-caption';

    const name = document.createElement('span');
    name.className = 'print-name';
    name.textContent = label;

    const time = document.createElement('span');
    time.className = 'print-time';
    time.textContent = timestamp();

    const removeBtn = document.createElement('button');
    removeBtn.className = 'print-remove';
    removeBtn.setAttribute('aria-label', `移除 ${label}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      card.remove();
      photoCount = Math.max(0, photoCount - 1);
      countTag.textContent = `${photoCount} 張`;
      if (photoCount === 0) emptyState.style.display = 'block';
    });

    caption.append(name, time);
    card.append(tape, img, caption, removeBtn);
    strip.prepend(card);
  }

  function handleFiles(fileList){
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length){
      showToast('請選擇圖片檔案');
      return;
    }
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => addPrint(e.target.result, file.name);
      reader.readAsDataURL(file);
    });
    showToast(`已加入 ${files.length} 張照片`);
  }

  /* ---------- dropzone events ---------- */
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', e => handleFiles(e.target.files));

  ['dragenter', 'dragover'].forEach(evt =>
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    })
  );
  dropzone.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  /* ---------- camera ---------- */
  async function openCamera(){
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      video.srcObject = stream;
      video.classList.add('active');
      cameraIdle.classList.add('hidden');
      recDot.hidden = false;
      startCam.disabled = true;
      stopCam.disabled = false;
      shotBtn.disabled = false;
    } catch (err){
      showToast('無法開啟鏡頭,請確認權限已允許');
    }
  }

  function closeCamera(){
    if (stream){
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    video.classList.remove('active');
    cameraIdle.classList.remove('hidden');
    recDot.hidden = true;
    startCam.disabled = false;
    stopCam.disabled = true;
    shotBtn.disabled = true;
  }

  function takeShot(){
    if (!stream) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    addPrint(dataUrl, `拍照-${Date.now()}.jpg`);
    showToast('拍好了一張');
  }

  startCam.addEventListener('click', openCamera);
  stopCam.addEventListener('click', closeCamera);
  shotBtn.addEventListener('click', takeShot);

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });
})();
