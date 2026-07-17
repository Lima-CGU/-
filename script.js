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

  /* ---------- confirm upload -> log entry ---------- */
  function timestamp(){
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

        if (d.feedbackSuggestion){
          const fb = document.createElement('span');
          fb.className = 'meal-dish-feedback';
          fb.textContent = `💬 ${d.feedbackText} → ${d.feedbackSuggestion}`;
          row.appendChild(fb);
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
      // Hugging Face model waking up — wait and retry once
      if (res.status === 503 && data.estimated_time && attempt < 3){
        await new Promise(r => setTimeout(r, Math.min(data.estimated_time, 20) * 1000));
        return callRecognizeAPI(croppedDataUrl, attempt + 1);
      }
      throw new Error(data.error || '辨識失敗');
    }
    return data;
  }

  async function recognizeAndAssign(det){
    if (!backendWarned){
      backendWarned = true;
      showToast('第一次辨識可能要等後端伺服器醒過來,約 30-50 秒');
    }
    try {
      const cropped = await cropRegionToDataUrl(currentPhotoData, det.x, det.y, det.w, det.h);
      const data = await callRecognizeAPI(cropped);
      if (data.dishes && data.dishes.length){
        det.name = `${data.dishes[0].name}(${data.dishes[0].confidence}%)`;
      } else {
        det.name = '沒認出來,自己填';
      }
    } catch (err){
      console.error(err);
      det.name = '辨識失敗,自己填';
    }
    det.loading = false;
    if (det.tipNameEl) det.tipNameEl.textContent = det.name;
    if (det.labelEl) det.labelEl.textContent = det.name;
    if (det.dotEl) det.dotEl.classList.remove('loading');
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
        recognizeHint.textContent = '沒有自動辨識到菜色,你可以在照片上拖曳自己框一個';
      } else {
        dishes.forEach((d, i) => {
          const det = {
            id: `auto${i}`,
            x: d.x, y: d.y, w: d.w, h: d.h,
            name: `${d.name}(${d.confidence}%)`,
            loading: false,
            color: DET_COLORS[i % DET_COLORS.length],
            confirmed: true
          };
          currentDetections.push(det);
          renderOneDetection(det, i);
        });
        recognizeHint.textContent = `AI 自動辨識出 ${dishes.length} 道菜 — 辨識錯的按框上的「×」刪掉,漏掉的可以自己拖曳框一個`;
      }
    } catch (err){
      console.error(err);
      recognizeHint.textContent = '自動辨識失敗,你可以在照片上拖曳自己框出每一道菜';
      showToast('自動辨識失敗,請改用手動框選');
    }

    finishRecognizeBtn.disabled = false;
    updateProgress();
  }

  const recognizeHint    = document.getElementById('recognizeHint');

  let currentDetections = [];

  function updateProgress(){
    const total = currentDetections.length;
    const done = currentDetections.filter(d => d.confirmed).length;
    confirmProgress.textContent = total
      ? `已確認 ${done} / ${total}`
      : '還沒有框任何一道菜';
  }

  function closeAllTips(exceptEl){
    recognizeOverlay.querySelectorAll('.det-tip.show').forEach(tip => {
      if (tip !== exceptEl) tip.classList.remove('show');
    });
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
    label.textContent = det.loading ? '辨識中…' : det.name;
    det.labelEl = label;
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
    dot.style.background = det.color;
    dot.setAttribute('aria-label', `第 ${i + 1} 道菜,點看看是什麼`);
    dot.textContent = i + 1;
    det.dotEl = dot;

    const tip = document.createElement('span');
    tip.className = 'det-tip';
    if (det.y < 22) tip.classList.add('below');
    const tipName = document.createElement('span');
    tipName.className = 'det-tip-name';
    tipName.textContent = det.loading ? '辨識中…' : det.name;
    det.tipNameEl = tipName;
    const tipConfirm = document.createElement('button');
    tipConfirm.type = 'button';
    tipConfirm.className = 'det-tip-confirm';
    tipConfirm.setAttribute('aria-label', '確認這個菜名');
    tipConfirm.textContent = '✓';
    tip.append(tipName, tipConfirm);
    dot.appendChild(tip);

    function confirmThis(){
      if (det.loading){
        showToast('還在辨識中,等結果出來再確認');
        return;
      }
      det.confirmed = true;
      box.classList.add('confirmed');
      box.style.borderColor = '#12a981';
      box.style.background = colorToRgba('#12a981', 0.1);
      dot.style.background = '#12a981';
      dot.textContent = '✓';
      tip.classList.remove('show');
      updateProgress();
    }
    det.confirmFn = confirmThis;

    tipConfirm.addEventListener('click', e => {
      e.stopPropagation();
      confirmThis();
    });

    // 自動辨識回來的框已經算確認過了,不用使用者手動點一次
    if (det.confirmed) confirmThis();

    dot.addEventListener('click', e => {
      e.stopPropagation();
      const willShow = !tip.classList.contains('show');
      closeAllTips();
      tip.classList.toggle('show', willShow);
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
      openVoiceModal(det, 'name');
    });

    // 只有確認過的菜才能留口感/份量回饋(靠 .det-box.confirmed 的 CSS 規則顯示)
    const feedbackBtn = document.createElement('button');
    feedbackBtn.type = 'button';
    feedbackBtn.className = 'det-feedback';
    feedbackBtn.textContent = '💬 這道菜如何?';
    feedbackBtn.setAttribute('aria-label', '用語音留下這道菜的口感或份量回饋');
    feedbackBtn.addEventListener('click', e => {
      e.stopPropagation();
      openVoiceModal(det, 'feedback');
    });

    box.append(removeBtn, dot, micBtn, feedbackBtn);
    recognizeOverlay.appendChild(box);
  }

  /* ---------- manual box drawing (fix AI misses / mistakes) ---------- */
  let drawState = null;

  function wrapRect(){
    return recognizeWrap.getBoundingClientRect();
  }

  function clientToPct(clientX, clientY){
    const r = wrapRect();
    const x = ((clientX - r.left) / r.width) * 100;
    const y = ((clientY - r.top) / r.height) * 100;
    return {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y))
    };
  }

  recognizeWrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.det-dot') || e.target.closest('.det-remove') || e.target.closest('.det-mic') || e.target.closest('.det-feedback')) return;
    const p = clientToPct(e.clientX, e.clientY);
    const tempBox = document.createElement('div');
    tempBox.className = 'det-box drawing';
    tempBox.style.left = p.x + '%';
    tempBox.style.top = p.y + '%';
    tempBox.style.width = '0%';
    tempBox.style.height = '0%';
    recognizeOverlay.appendChild(tempBox);
    drawState = { startX: p.x, startY: p.y, el: tempBox };
    recognizeWrap.setPointerCapture(e.pointerId);
  });

  recognizeWrap.addEventListener('pointermove', e => {
    if (!drawState) return;
    const p = clientToPct(e.clientX, e.clientY);
    const x = Math.min(drawState.startX, p.x);
    const y = Math.min(drawState.startY, p.y);
    const w = Math.abs(p.x - drawState.startX);
    const h = Math.abs(p.y - drawState.startY);
    drawState.el.style.left = x + '%';
    drawState.el.style.top = y + '%';
    drawState.el.style.width = w + '%';
    drawState.el.style.height = h + '%';
    drawState.current = { x, y, w, h };
  });

  recognizeWrap.addEventListener('pointerup', () => {
    if (!drawState) return;
    const box = drawState.current;
    drawState.el.remove();
    drawState = null;
    if (!box || box.w < 4 || box.h < 4) return; // too small, treat as accidental tap

    const idx = currentDetections.length;
    const det = {
      id: `manual${Date.now()}`,
      x: box.x, y: box.y, w: box.w, h: box.h,
      name: null,
      loading: true,
      color: DET_COLORS[idx % DET_COLORS.length],
      confirmed: false
    };
    currentDetections.push(det);
    renderOneDetection(det, idx);
    updateProgress();
    showToast('框好了,正在辨識這道菜…');
    recognizeAndAssign(det);
  });

  document.addEventListener('click', () => closeAllTips());

  finishRecognizeBtn.addEventListener('click', () => {
    const total = currentDetections.length;
    if (total === 0){
      showToast('請先在照片上拖曳框出至少一道菜');
      return;
    }
    if (currentDetections.some(d => d.loading)){
      showToast('還有菜色在辨識中,等一下再試');
      return;
    }
    const done = currentDetections.filter(d => d.confirmed).length;
    if (done < total){
      showToast(`還有 ${total - done} 道菜還沒確認,點圓點確認一下`);
      return;
    }
    const dishes = currentDetections.map(d => ({
      name: d.name,
      feedbackText: d.feedbackText,
      feedbackSuggestion: d.feedbackSuggestion
    }));
    addMealCard(currentPhotoData, currentDetections.length, dishes);
    showToast('這餐記錄好了!');
    currentPhotoData = null;
    goToScreen('start');
  });

  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });

  /* ---------- voice correction + feedback translation (Web Speech API) ---------- */
  const voiceModal            = document.getElementById('voiceModal');
  const voiceModalClose       = document.getElementById('voiceModalClose');
  const voiceStateListening   = document.getElementById('voiceStateListening');
  const voiceStateResult      = document.getElementById('voiceStateResult');
  const voiceStateFallback    = document.getElementById('voiceStateFallback');
  const voiceStateTranslating    = document.getElementById('voiceStateTranslating');
  const voiceStateFeedbackResult = document.getElementById('voiceStateFeedbackResult');
  const voiceListeningText    = document.getElementById('voiceListeningText');
  const voiceCancelBtn        = document.getElementById('voiceCancelBtn');
  const voiceResultText       = document.getElementById('voiceResultText');
  const voiceRetryBtn         = document.getElementById('voiceRetryBtn');
  const voiceConfirmBtn       = document.getElementById('voiceConfirmBtn');
  const voiceFallbackInput    = document.getElementById('voiceFallbackInput');
  const voiceFallbackConfirmBtn = document.getElementById('voiceFallbackConfirmBtn');
  const voiceFeedbackQuote      = document.getElementById('voiceFeedbackQuote');
  const voiceFeedbackSuggestion = document.getElementById('voiceFeedbackSuggestion');
  const voiceFeedbackConfirmBtn = document.getElementById('voiceFeedbackConfirmBtn');
  const voiceFeedbackRetryBtn   = document.getElementById('voiceFeedbackRetryBtn');

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  let voiceTargetDet = null;
  let voiceMode = 'name'; // 'name' 修正菜名 | 'feedback' 收集口感/份量回饋
  let recognition = null;
  let recognizedText = '';
  let pendingFeedbackText = '';
  let pendingFeedbackSuggestion = '';

  function showVoiceState(name){
    voiceStateListening.hidden = name !== 'listening';
    voiceStateResult.hidden = name !== 'result';
    voiceStateFallback.hidden = name !== 'fallback';
    voiceStateTranslating.hidden = name !== 'translating';
    voiceStateFeedbackResult.hidden = name !== 'feedbackResult';
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
  }

  // 把長者說的模糊感受送給後端,請 GPT-4o 轉譯成具體烹調建議
  async function translateFeedback(det, feedbackText){
    showVoiceState('translating');
    try {
      const res = await fetch(`${BACKEND_URL}/api/translate-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dishName: det.name, feedbackText })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '轉譯失敗');

      pendingFeedbackText = feedbackText;
      pendingFeedbackSuggestion = data.suggestion || '這道菜很合適,不需調整';
      voiceFeedbackQuote.textContent = feedbackText;
      voiceFeedbackSuggestion.textContent = pendingFeedbackSuggestion;
      showVoiceState('feedbackResult');
    } catch (err){
      console.error(err);
      showToast('AI 轉譯失敗,再說一次看看');
      showVoiceState('listening');
    }
  }

  function startListening(){
    recognizedText = '';
    showVoiceState('listening');
    stopRecognition();

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
      if (voiceMode === 'feedback'){
        translateFeedback(voiceTargetDet, recognizedText);
      } else {
        voiceResultText.textContent = recognizedText;
        showVoiceState('result');
      }
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
    pendingFeedbackText = '';
    pendingFeedbackSuggestion = '';
    voiceListeningText.textContent = mode === 'feedback'
      ? '請說說這道菜的口感或份量,例如太硬、太鹹、吃不下'
      : '請說出菜名…';
    voiceFallbackInput.placeholder = mode === 'feedback' ? '輸入這道菜的口感或份量回饋' : '輸入菜名';
    voiceModal.hidden = false;

    if (!SpeechRecognitionCtor){
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
    if (det.labelEl) det.labelEl.textContent = det.name;
    if (det.tipNameEl) det.tipNameEl.textContent = det.name;
    if (det.dotEl) det.dotEl.classList.remove('loading');
    closeVoiceModal();
    if (det.confirmFn) det.confirmFn();
    showToast('菜名已更新');
  }

  function applyFeedbackResult(){
    const det = voiceTargetDet;
    if (!det) return;
    det.feedbackText = pendingFeedbackText;
    det.feedbackSuggestion = pendingFeedbackSuggestion;
    closeVoiceModal();
    showToast('回饋已記錄');
  }

  voiceModalClose.addEventListener('click', closeVoiceModal);
  voiceCancelBtn.addEventListener('click', closeVoiceModal);
  voiceRetryBtn.addEventListener('click', startListening);
  voiceConfirmBtn.addEventListener('click', () => applyVoiceResult(recognizedText));
  voiceFeedbackRetryBtn.addEventListener('click', startListening);
  voiceFeedbackConfirmBtn.addEventListener('click', applyFeedbackResult);
  voiceFallbackConfirmBtn.addEventListener('click', () => {
    const text = voiceFallbackInput.value.trim();
    if (!text) return;
    if (voiceMode === 'feedback'){
      translateFeedback(voiceTargetDet, text);
    } else {
      applyVoiceResult(text);
    }
  });
  voiceFallbackInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') voiceFallbackConfirmBtn.click();
  });
})();
