let currentUser = JSON.parse(localStorage.getItem('artback_session') || 'null');
let currentFilter = 'all';
let donateArtworkId = null;
let donateAmount = 0;
let selectedFile = null;
let viewingProfileId = null;
let commentInputTimeout = null;

const TYPES = {
  digital: { name: 'Цифровой арт', objective: [{ key: 'technique', name: 'Техника' }, { key: 'composition', name: 'Композиция' }, { key: 'color', name: 'Цвет' }, { key: 'lighting', name: 'Освещение' }], subjective: [{ key: 'vibe', name: 'Атмосфера' }, { key: 'originality', name: 'Оригинальность' }] },
  traditional: { name: 'Живопись', objective: [{ key: 'technique', name: 'Техника мазка' }, { key: 'composition', name: 'Композиция' }, { key: 'color', name: 'Гармония цвета' }, { key: 'texture', name: 'Текстура' }], subjective: [{ key: 'vibe', name: 'Атмосфера' }, { key: 'expression', name: 'Выразительность' }] },
  illustration: { name: 'Иллюстрация', objective: [{ key: 'line', name: 'Линейная работа' }, { key: 'narrative', name: 'Повествование' }, { key: 'character', name: 'Дизайн персонажа' }, { key: 'style', name: 'Стиль' }], subjective: [{ key: 'vibe', name: 'Атмосфера' }, { key: 'charm', name: 'Обаяние' }] },
  photography: { name: 'Фотография', objective: [{ key: 'exposure', name: 'Экспозиция' }, { key: 'focus', name: 'Фокус' }, { key: 'composition', name: 'Композиция' }, { key: 'timing', name: 'Момент' }], subjective: [{ key: 'vibe', name: 'Атмосфера' }, { key: 'storytelling', name: 'Сторителлинг' }] },
  '3d': { name: '3D-моделирование', objective: [{ key: 'topology', name: 'Топология' }, { key: 'texturing', name: 'Текстурирование' }, { key: 'lighting', name: 'Освещение' }, { key: 'render', name: 'Рендеринг' }], subjective: [{ key: 'vibe', name: 'Атмосфера' }, { key: 'creativity', name: 'Креативность' }] }
};

const GRADIENTS = ['linear-gradient(135deg,#3b82f6,#1e3a8a)','linear-gradient(135deg,#059669,#065f46)','linear-gradient(135deg,#d97706,#92400e)','linear-gradient(135deg,#6366f1,#4338ca)','linear-gradient(135deg,#475569,#1e293b)'];

async function api(endpoint, method='GET', body=null) {
  const opts = { method, headers: {} };
  if (body) {
    if (body instanceof FormData) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(`/api/${endpoint}`, opts);
  const contentType = res.headers.get('content-type');
  if (!res.ok) {
    if (contentType?.includes('application/json')) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка сервера');
    }
    throw new Error(`Ошибка ${res.status}`);
  }
  return contentType?.includes('application/json') ? await res.json() : {};
}

function init() {
  if (currentUser) { 
    document.getElementById('userMenu').style.display = 'block'; 
    document.getElementById('dropdownName').textContent = currentUser.name; 
    document.getElementById('dropdownUsername').textContent = currentUser.username; 
    updateAvatarUI('navAvatar', currentUser.avatar_url, currentUser.avatar_color);
    showPage('feed'); 
  } else { showPage('login'); }
  initFileUpload();
}

function initFileUpload() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  if (!uploadArea || !fileInput) return;
  uploadArea.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fileInput.click(); }, { passive: true });
  fileInput.addEventListener('change', handleFileSelect, { passive: true });
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => { uploadArea.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false }); });
  ['dragenter', 'dragover'].forEach(eventName => { uploadArea.addEventListener(eventName, () => uploadArea.classList.add('dragover'), { passive: true }); });
  ['dragleave', 'drop'].forEach(eventName => { uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('dragover'), { passive: true }); });
  uploadArea.addEventListener('drop', (e) => { const files = e.dataTransfer?.files; if (files?.length) { fileInput.files = files; handleFileSelect({ target: fileInput }); } }, { passive: true });
}

function handleFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { notify('Выберите изображение', 'warning'); e.target.value = ''; return; }
  if (file.size > 10 * 1024 * 1024) { notify('Файл слишком большой', 'warning'); e.target.value = ''; return; }
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => { const preview = document.getElementById('previewImage'); if (preview) { preview.src = ev.target.result; preview.onload = () => { document.getElementById('uploadPreview').style.display = 'block'; document.getElementById('uploadArea').style.display = 'none'; }; } };
  reader.readAsDataURL(file);
}

function updateAvatarUI(elementId, avatarUrl, fallbackColor) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const img = el.querySelector('img');
  if (!img) return;
  if (avatarUrl) { img.src = avatarUrl; img.style.display = 'block'; el.style.background = 'none'; }
  else { img.style.display = 'none'; el.style.background = `linear-gradient(135deg, ${fallbackColor||'#6366f1'}, #3b82f6)`; }
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');
  document.querySelectorAll('nav button').forEach(btn => { btn.classList.toggle('active', btn.dataset.page === pageId); });
  if (pageId === 'feed') loadFeed(); 
  else if (pageId === 'explore') renderExplore(); 
  else if (pageId === 'upload') { updateCriteria(); initFileUpload(); }
  else if (pageId === 'profile') loadProfile(viewingProfileId || currentUser?.id);
}

function navigateTo(pageId) { 
  if (!currentUser && !['login','register'].includes(pageId)) { showPage('login'); return; } 
  showPage(pageId);
}

async function login() {
  const email = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value;
  if (!email || !password) return notify('Заполните поля', 'warning');
  try { 
    const u = await api('auth/login', 'POST', { email, password }); 
    currentUser = u; 
    localStorage.setItem('artback_session', JSON.stringify(u)); 
    document.getElementById('userMenu').style.display = 'block'; 
    document.getElementById('dropdownName').textContent = u.name; 
    document.getElementById('dropdownUsername').textContent = u.username; 
    updateAvatarUI('navAvatar', u.avatar_url, u.avatar_color);
    showPage('feed'); 
    notify(`Добро пожаловать, ${u.name}`, 'success'); 
  } catch(e) { notify(e.message || 'Ошибка входа', 'warning'); }
}

// 🔧 ИСПРАВЛЕННАЯ РЕГИСТРАЦИЯ С УВЕДОМЛЕНИЕМ
async function register() {
  const name = document.getElementById('regName')?.value.trim();
  const username = document.getElementById('regUsername')?.value.trim();
  const email = document.getElementById('regEmail')?.value.trim();
  const password = document.getElementById('regPassword')?.value;
  const artType = document.getElementById('regArtType')?.value;
  
  if (!name || !username || !email || !password) return notify('Заполните все поля', 'warning');
  
  try { 
    const u = await api('auth/register', 'POST', { name, username, email, password, artType }); 
    currentUser = u; 
    localStorage.setItem('artback_session', JSON.stringify(u)); 
    document.getElementById('userMenu').style.display = 'block'; 
    document.getElementById('dropdownName').textContent = u.name; 
    document.getElementById('dropdownUsername').textContent = u.username; 
    updateAvatarUI('navAvatar', u.avatar_url, u.avatar_color);
    showPage('feed'); 
    notify('Аккаунт создан!', 'success'); 
  } catch(e) {
    // 🔧 ЗДЕСЬ МЫ ПОКАЗЫВАЕМ КРАСНУЮ ПЛАШКУ
    notify(e.message || 'Ошибка регистрации', 'warning');
  }
}

function logout() { 
  currentUser = null; 
  localStorage.removeItem('artback_session'); 
  document.getElementById('userMenu').style.display = 'none'; 
  document.getElementById('userDropdown')?.classList.remove('show'); 
  viewingProfileId = null;
  showPage('login'); 
  notify('Вы вышли', 'info');
}

function toggleDropdown() { const dd = document.getElementById('userDropdown'); if (dd) dd.classList.toggle('show'); }

async function loadFeed() {
  try { 
    const arts = await api(`artworks?type=${currentFilter}`); 
    const grid = document.getElementById('feedGrid');
    if (!grid) return;
    if (!arts?.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🎨</div><p>Пока нет работ</p><button class="btn btn-primary" onclick="navigateTo('upload')" style="width:auto;margin-top:0.8rem">Загрузить первую</button></div>`;
      return;
    }
    grid.innerHTML = arts.map(a => {
      const img = a.image_url ? `<div class="card-image"><img src="${a.image_url}" alt="${a.title}" onerror="this.parentElement.innerHTML='<div class=\\'placeholder\\' style=\\'background:${a.gradient}\\'>${TYPES[a.type]?.name||'Арт'}</div>'"></div>` : `<div class="placeholder" style="background:${a.gradient}">${TYPES[a.type]?.name || 'Арт'}</div>`;
      const authorName = a.author_name || 'Аноним';
      const authorId = a.user_id;
      const avatarContent = a.avatar_url ? `<img src="${a.avatar_url}" alt="${authorName}">` : (authorName.charAt(0) || '?');
      
      // 🔧 ИСПРАВЛЕНО: преобразуем в число перед toFixed
      const rating = Number(a.avgRating || 0);
      const ratingPercent = Math.min(100, rating * 10);
      
      return `<div class="artwork-card" onclick="openArt('${a.id}')">${img}<span class="type-badge">${TYPES[a.type]?.name || a.type}</span><div class="card-body"><h3>${a.title}</h3><p class="desc">${a.description || ''}</p><div class="card-meta"><div class="author"><div class="avatar" onclick="event.stopPropagation();viewUserProfile('${authorId}')" style="background:${a.avatar_color||'var(--gradient-main)'}">${avatarContent}</div><span onclick="event.stopPropagation();viewUserProfile('${authorId}')" style="cursor:pointer">${authorName}</span></div><div class="stats"><span>❤️ ${a.likesCount || 0}</span><span>👁️ ${a.views || 0}</span></div></div></div><div class="card-footer"><div class="rating-wrap"><div class="rating-bar"><div class="rating-fill" style="width:${ratingPercent}%"></div></div><span class="rating-text">${rating.toFixed(1)}</span></div><button class="donate-btn" onclick="event.stopPropagation();openDonate('${a.id}')">Донат</button></div></div>`;
    }).join('');
  } catch(e) { console.error('Feed error:', e); notify('Не удалось загрузить ленту', 'warning'); }
}

async function viewUserProfile(userId) {
  if (!userId) return;
  viewingProfileId = userId;
  await loadProfile(userId);
  showPage('profile');
}

function filterFeed(type, btn) { 
  currentFilter = type; 
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active')); 
  if (btn) btn.classList.add('active'); 
  loadFeed();
}

async function openArt(artId) {
  try { 
    console.log('🔍 Opening artwork:', artId);
    const response = await api(`artworks/${artId}`);
    
    // 🔧 Проверка структуры ответа
    if (!response || !response.art) {
      console.error('❌ Invalid response structure:', response);
      return notify('Ошибка загрузки работы', 'warning');
    }
    
    const { art, ratings, comments } = response;
    const avg = Number(art.avgRating || 0);
    
    const img = art.image_url 
      ? `<img src="${art.image_url}" style="width:100%;max-height:320px;object-fit:contain;background:#000;border-radius:var(--radius)" onerror="this.outerHTML='<div style=\\'width:100%;height:280px;background:${art.gradient};display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7)\\'>${TYPES[art.type]?.name||'Изображение'}</div>'">` 
      : `<div style="width:100%;height:280px;background:${art.gradient};display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);border-radius:var(--radius)">${TYPES[art.type]?.name || 'Арт'}</div>`;
    
    const authorName = art.author_name || 'Аноним';
    const authorAvatar = art.avatar_url 
      ? `<img src="${art.avatar_url}" alt="${authorName}">` 
      : (authorName.charAt(0) || '?');
    
    const rateSection = (currentUser && currentUser.id !== art.user_id) 
      ? renderRates(art, ratings) 
      : `<div class="rating-section"><div class="overall-score"><div class="score-circle"><span style="color:${avg>=7?'var(--success)':avg>=5?'var(--warning)':'var(--accent)'}">${avg.toFixed(1)}</span></div><div class="score-details"><h4>Средняя оценка</h4><p>На основе ${ratings?.length || 0} оценок</p></div></div></div>`;
    
    const commentsHtml = (comments || []).map(c => {
      const cAuthor = c.users?.name || 'Аноним';
      const cAvatar = c.users?.avatar_url 
        ? `<img src="${c.users.avatar_url}" alt="${cAuthor}">` 
        : (cAuthor.charAt(0) || '?');
      return `<div class="comment"><div class="comment-avatar" style="background:linear-gradient(135deg,${c.users?.avatar_color||'#6366f1'},#3b82f1)">${cAvatar}</div><div class="comment-content"><div class="comment-author">${cAuthor}</div><div class="comment-text">${escapeHtml(c.text || '')}</div><div class="comment-time">${new Date(c.created_at).toLocaleDateString('ru-RU')}</div></div></div>`;
    }).join('') || '<p style="color:var(--text-muted);text-align:center;padding:0.8rem">Пока нет комментариев</p>';
    
    const commentInputHtml = (currentUser && currentUser.id !== art.user_id) 
      ? `<div class="comment-input"><input type="text" id="commentIn" placeholder="Написать комментарий..." autocomplete="off"><button class="btn btn-sm btn-primary" onclick="addComment('${art.id}')">➤</button></div>` 
      : '';
    
    const deleteBtnHtml = (currentUser && currentUser.id === art.user_id) 
      ? `<div style="margin-top:1rem;padding:0.7rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px"><p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.4rem">Вы владелец</p><button class="btn btn-sm" style="background:rgba(239,68,68,0.2);color:#ef4444;border:1px solid rgba(239,68,68,0.4)" onclick="deleteArtwork('${art.id}')">🗑️ Удалить</button></div>` 
      : '';
    
    document.getElementById('modalContent').innerHTML = `${img}<div class="modal-body"><h2>${art.title}</h2><p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:0.7rem">${TYPES[art.type]?.name} • ${new Date(art.created_at).toLocaleDateString('ru-RU')}</p><p class="description">${art.description || ''}</p><div class="modal-author-row"><div class="author"><div class="avatar" style="width:38px;height:38px;font-size:0.85rem;background:linear-gradient(135deg,${art.avatar_color||'#6366f1'},#3b82f1)" onclick="viewUserProfile('${art.user_id}')">${authorAvatar}</div><div><div style="font-weight:600;cursor:pointer" onclick="viewUserProfile('${art.user_id}')">${authorName}</div><div style="font-size:0.75rem;color:var(--text-muted)">${art.author_username || ''}</div></div></div><div style="display:flex;gap:0.4rem"><button class="btn btn-sm btn-secondary" onclick="like('${art.id}')">❤️ ${art.likesCount || 0}</button><button class="donate-btn" style="padding:0.35rem 0.8rem" onclick="closeModal('artworkModal');openDonate('${art.id}')">Донат</button></div></div>${rateSection}<div class="comments-section"><h3>Комментарии (${comments?.length || 0})</h3>${commentInputHtml}${deleteBtnHtml}<div id="commList">${commentsHtml}</div></div></div>`;
    
    const commentInput = document.getElementById('commentIn');
    if (commentInput) {
      const newInput = commentInput.cloneNode(true);
      commentInput.parentNode.replaceChild(newInput, commentInput);
      newInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); addComment(art.id); } }, { passive: false });
    }
    
    document.getElementById('artworkModal')?.classList.add('show'); 
    document.body.style.overflow = 'hidden';
    
  } catch(e) { 
    console.error('❌ Open art error:', e); 
    notify('Ошибка: ' + e.message, 'warning'); 
  }
}

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('show');
  document.body.style.overflow = '';
}

async function like(artId) {
  if (!currentUser) return notify('Войдите', 'warning');
  try { const r = await api(`artworks/${artId}`, 'POST', { type: 'like', userId: currentUser.id }); notify(r.liked ? 'Лайк! ❤️' : 'Лайк убран', r.liked ? 'success' : 'info'); openArt(artId); } catch(e) { notify(e.message, 'warning'); }
}

async function addComment(artId) {
  const input = document.getElementById('commentIn');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return notify('Напишите что-нибудь', 'warning');
  input.disabled = true;
  const btn = input.nextElementSibling;
  if (btn) btn.disabled = true;
  try {
    await api(`artworks/${artId}`, 'POST', { type: 'comment', userId: currentUser.id, text });
    input.value = '';
    notify('Комментарий добавлен', 'success');
    openArt(artId);
  } catch(e) { notify(e.message, 'warning'); } finally { input.disabled = false; if (btn) btn.disabled = false; input.focus(); }
}

function renderRates(art, ratings) {
  const t = TYPES[art.type]; if (!t) return '';
  const myRating = ratings?.find(r => r.user_id === currentUser?.id);
  let html = '';
  let avg = 0, count = 0; 
  (ratings || []).forEach(r => {
    try { 
      const p = typeof r.params === 'string' ? JSON.parse(r.params) : r.params;
      Object.values(p || {}).forEach(v => { const num = Number(v); if (!isNaN(num)) { avg += num; count++; } }); 
    } catch {}
  }); 
  avg = count ? (avg / count).toFixed(1) : 0;
  
  html += `<div class="overall-score"><div class="score-circle"><span style="color:${avg>=7?'var(--success)':avg>=5?'var(--warning)':'var(--accent)'}">${avg}</span></div><div class="score-details"><h4>Общая оценка</h4><p>${(ratings || []).length} оценок</p><div class="breakdown">${Object.entries(getBreakdown(ratings, t)).map(([k, v]) => `<div class="bd-item"><div class="bd-val">${v.toFixed(1)}</div><div class="bd-lbl">${t.objective.find(p=>p.key===k)?.name || t.subjective.find(p=>p.key===k)?.name || k}</div></div>`).join('')}</div></div></div>`;
  
  html += `<div class="rating-section"><h3>📊 Объективные</h3><div class="params-grid">${t.objective.map(p => { const val = myRating ? (JSON.parse(typeof myRating.params === 'string' ? myRating.params : JSON.stringify(myRating.params))[p.key] || 5) : 5; return `<div class="param-item"><div class="param-header"><span class="param-name">${p.name}</span><span class="cat-label cat-obj">Объективно</span><span class="param-value" id="v-${p.key}">${val}</span></div><input type="range" class="slider" min="1" max="10" value="${val}" id="s-${p.key}" oninput="document.getElementById('v-${p.key}').textContent=this.value"></div>`; }).join('')}</div></div>`;
  
  html += `<div class="rating-section"><h3>💭 Субъективные</h3><div class="params-grid">${t.subjective.map(p => { const val = myRating ? (JSON.parse(typeof myRating.params === 'string' ? myRating.params : JSON.stringify(myRating.params))[p.key] || 5) : 5; return `<div class="param-item"><div class="param-header"><span class="param-name">${p.name}</span><span class="cat-label cat-subj">Субъективно</span><span class="param-value" id="v-${p.key}">${val}</span></div><input type="range" class="slider" min="1" max="10" value="${val}" id="s-${p.key}" oninput="document.getElementById('v-${p.key}').textContent=this.value"></div>`; }).join('')}</div></div>`;
  
  html += `<button class="btn btn-primary" onclick="submitRate('${art.id}')">Отправить оценку</button>`; 
  return html;
}

function getBreakdown(ratings, type) {
  const b = {};
  [...(type.objective||[]), ...(type.subjective||[])].forEach(p => {
    const v = (ratings||[]).map(r => { try { const params = typeof r.params === 'string' ? JSON.parse(r.params) : r.params; return params?.[p.key]; } catch { return null; } }).filter(x => x !== undefined && !isNaN(Number(x)));
    b[p.key] = v.length ? v.reduce((a,b)=>a+Number(b),0)/v.length : 0;
  });
  return b;
}

async function submitRate(artId) {
  const { art } = await api(`artworks/${artId}`);
  const t = TYPES[art?.type];
  if (!t) return notify('Ошибка', 'warning');
  const params = {};
  [...t.objective, ...t.subjective].forEach(param => { const s = document.getElementById('s-'+param.key); if (s) params[param.key] = parseInt(s.value, 10); });
  try { await api(`artworks/${artId}`, 'POST', { type: 'rate', userId: currentUser.id, params }); notify('Оценка сохранена! ✨', 'success'); openArt(artId); } catch(e) { notify(e.message, 'warning'); }
}

function removePreview() { selectedFile = null; document.getElementById('uploadPreview').style.display = 'none'; document.getElementById('uploadArea').style.display = 'block'; const fi = document.getElementById('fileInput'); if (fi) fi.value = ''; }

async function publishArtwork() {
  const title = document.getElementById('artTitle')?.value.trim();
  const description = document.getElementById('artDescription')?.value.trim();
  const type = document.getElementById('artType')?.value;
  const tagsInput = document.getElementById('artTags')?.value;
  if (!title) return notify('Введите название', 'warning');
  if (!selectedFile) return notify('Выберите изображение', 'warning');
  const btn = document.getElementById('publishBtn');
  const originalText = btn.textContent;
  btn.textContent = 'Загрузка...';
  btn.disabled = true;
  try {
    const formData = new FormData();
    formData.append('image', selectedFile);
    const uploadRes = await api('upload', 'POST', formData);
    const tags = tagsInput?.split(',').map(t => t.trim()).filter(Boolean) || [];
    await api('artworks', 'POST', { userId: currentUser.id, title, description, type, tags, imageUrl: uploadRes.url, gradient: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)] });
    notify('Опубликовано! 🎉', 'success');
    document.getElementById('artTitle').value = '';
    document.getElementById('artDescription').value = '';
    document.getElementById('artTags').value = '';
    removePreview();
    navigateTo('feed');
  } catch(e) { notify(e.message, 'warning'); } finally { btn.textContent = originalText; btn.disabled = false; }
}

function updateCriteria() {
  const type = document.getElementById('artType')?.value;
  const info = document.getElementById('uploadCriteriaInfo');
  if (!info || !type || !TYPES[type]) { if (info) info.innerHTML = ''; return; }
  const t = TYPES[type];
  info.innerHTML = `<p style="margin-bottom:0.5rem"><strong style="color:var(--text-primary)">Параметры для "${t.name}":</strong></p><p style="color:var(--success);margin:0.3rem 0"><strong>Объективные:</strong> ${t.objective.map(x => x.name).join(', ')}</p><p style="color:var(--accent);margin:0.3rem 0 0"><strong>Субъективные:</strong> ${t.subjective.map(x => x.name).join(', ')}</p>`;
}

function openDonate(artId) { donateArtworkId = artId; document.getElementById('donateModal')?.classList.add('show'); document.body.style.overflow = 'hidden'; }
function selectDonate(amount, btn) { donateAmount = amount; document.getElementById('customDonate').value = ''; document.querySelectorAll('.donate-amount').forEach(b => b.classList.remove('selected')); if (btn) btn.classList.add('selected'); }
async function processDonate() {
  const custom = document.getElementById('customDonate');
  const amount = parseInt(custom?.value) || donateAmount;
  if (!amount || amount <= 0) return notify('Введите сумму', 'warning');
  try { await api(`artworks/${donateArtworkId}`, 'POST', { type: 'donate', amount }); closeModal('donateModal'); notify(`Донат ${amount} ₽ отправлен 💜`, 'success'); } catch(e) { notify(e.message, 'warning'); }
}

function renderExplore() {
  const catContainer = document.getElementById('exploreCategories');
  if (catContainer) {
    catContainer.innerHTML = Object.entries(TYPES).map(([key, t]) => `
      <div class="cat-card" onclick="navigateTo('feed');setTimeout(()=>filterFeed('${key}'),50)">
        <div class="cat-icon">${key==='3d'?'🧊':key==='digital'?'🖥️':key==='traditional'?'🎨':key==='illustration'?'✏️':key==='photography'?'📷':key==='animation'?'🎬':'🎨'}</div>
        <div class="cat-name">${t.name}</div>
        <div class="cat-count">${t.objective.length} объективных • ${t.subjective.length} субъективных</div>
      </div>
    `).join('');
  }
  
  const critContainer = document.getElementById('criteriaGrid');
  if (critContainer) {
    critContainer.innerHTML = Object.entries(TYPES).map(([key, t]) => `
      <div class="crit-item">
        <h4>${key==='3d'?'🧊':key==='digital'?'🖥️':key==='traditional'?'🎨':key==='illustration'?'✏️':key==='photography'?'📷':key==='animation'?'🎬':'🎨'} ${t.name}</h4>
        
        <p style="color:var(--success);font-size:0.75rem;font-weight:600;margin:0.5rem 0 0.3rem">📐 ОБЪЕКТИВНЫЕ ПАРАМЕТРЫ</p>
        ${t.objective.map(x => `<div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.2rem;padding:0.2rem 0;border-left:2px solid var(--success);padding-left:0.5rem">• ${x.name}</div>`).join('')}
        
        <p style="color:var(--accent);font-size:0.75rem;font-weight:600;margin:0.6rem 0 0.3rem">💭 СУБЪЕКТИВНЫЕ ПАРАМЕТРЫ</p>
        ${t.subjective.map(x => `<div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.2rem;padding:0.2rem 0;border-left:2px solid var(--accent);padding-left:0.5rem">• ${x.name}</div>`).join('')}
      </div>
    `).join('');
  }
}

async function loadProfile(userId) {
  if (!userId) return navigateTo('login');
  try {
    const { user, artworks: arts } = await api(`user/${userId}`);
    if (!user) return notify('Пользователь не найден', 'warning');
    const isOwnProfile = currentUser?.id === user.id;
    if (isOwnProfile) { currentUser = { ...currentUser, ...user }; localStorage.setItem('artback_session', JSON.stringify(currentUser)); updateAvatarUI('navAvatar', currentUser.avatar_url, currentUser.avatar_color); }
    const likes = (arts || []).reduce((sum, a) => sum + (a.likes || 0), 0);
    const views = (arts || []).reduce((sum, a) => sum + (a.views || 0), 0);
    const donations = (arts || []).reduce((sum, a) => sum + (a.total_donated || 0), 0);
    const avatarContent = user.avatar_url ? `<img src="${user.avatar_url}" alt="${user.name}" onerror="this.style.display='none';this.parentElement.textContent='${user.name?.charAt(0) || '?'}'">` : (user.name?.charAt(0) || '?');
    const avatarUploadHtml = isOwnProfile ? `<div class="avatar-upload-overlay">📷<br><small style="font-size:0.65rem">Сменить</small><input type="file" class="avatar-upload-input" accept="image/*" onchange="uploadAvatar(event)"></div>` : '';
    const actionsHtml = isOwnProfile ? `<button class="btn btn-sm btn-secondary" onclick="editBio()">✏️ Редактировать</button>` : `<button class="btn btn-sm btn-secondary" onclick="navigateTo('feed')">← Назад</button>`;
    
    let worksHtml = '';
    if (arts && arts.length > 0) {
      worksHtml = `<div class="grid-works">${arts.map(a => `<div class="work-thumb" onclick="openArt('${a.id}')"><div style="width:100%;height:100%;background:${a.gradient || 'var(--gradient-main)'};display:flex;align-items:center;justify-content:center;position:relative;">${a.image_url ? `<img src="${a.image_url}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'color:rgba(255,255,255,0.7)\\'>${TYPES[a.type]?.name||'Арт'}</span>'">` : `<span style="color:rgba(255,255,255,0.7)">${TYPES[a.type]?.name || 'Арт'}</span>`}</div><div class="overlay"><h4>${a.title || 'Без названия'}</h4><div class="mini"><span>❤️ ${a.likes || 0}</span><span>👁️ ${a.views || 0}</span></div></div></div>`).join('')}</div>`;
    } else {
      worksHtml = `<div class="empty-state"><div class="empty-icon">🎨</div><p>${isOwnProfile ? 'Загрузите первую работу' : 'Пользователь ещё не загрузил работы'}</p></div>`;
    }
    
    const container = document.getElementById('profileContent');
    if (!container) return;
    container.innerHTML = `<div class="profile-header"><div class="profile-banner"></div><div class="profile-avatar-lg" ${isOwnProfile ? 'onclick="document.querySelector(\'.avatar-upload-input\')?.click()"' : ''} style="background:${user.avatar_color||'var(--gradient-main)'}">${avatarContent}${avatarUploadHtml}</div><div class="profile-info"><h1>${user.name || 'Без имени'}</h1><div class="username">${user.username || ''}</div><div class="bio">${user.bio || 'Нет описания'}</div><div class="profile-stats"><div><div class="stat-val">${arts?.length || 0}</div><div class="stat-label">Работ</div></div><div><div class="stat-val">${likes}</div><div class="stat-label">Лайков</div></div><div><div class="stat-val">${views}</div><div class="stat-label">Просмотров</div></div><div><div class="stat-val">₽${donations}</div><div class="stat-label">Донатов</div></div></div><div class="profile-tags"><span class="tag">${TYPES[user.art_type]?.name || user.art_type || 'digital'}</span></div><div class="profile-actions">${actionsHtml}</div></div></div><div class="profile-tabs"><button class="tab active" onclick="switchTab('w',this)">Работы</button><button class="tab" onclick="switchTab('r',this)">Оценки</button></div><div id="tabContent">${worksHtml}</div>`;
  } catch(e) { console.error('Profile error:', e); notify('Ошибка профиля', 'warning'); }
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { notify('Выберите изображение', 'warning'); return; }
  if (file.size > 5 * 1024 * 1024) { notify('Файл слишком большой', 'warning'); return; }
  notify('Загрузка...', 'info');
  try {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('type', 'avatar');
    const { url } = await api('upload', 'POST', formData);
    await api(`user/${currentUser.id}`, 'PUT', { avatarUrl: url });
    currentUser.avatar_url = url;
    localStorage.setItem('artback_session', JSON.stringify(currentUser));
    updateAvatarUI('navAvatar', url, currentUser.avatar_color);
    await loadProfile(currentUser.id);
    notify('Аватар обновлён! ✨', 'success');
  } catch(e) { notify(e.message, 'warning'); } finally { event.target.value = ''; }
}

function editBio() {
  const b = prompt('О себе:', currentUser.bio || '');
  if (b === null) return;
  api(`user/${currentUser.id}`, 'PUT', { bio: b.trim() }).then(() => { currentUser.bio = b.trim(); localStorage.setItem('artback_session', JSON.stringify(currentUser)); loadProfile(currentUser.id); notify('Обновлено', 'success'); }).catch(() => notify('Ошибка', 'warning'));
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const content = document.getElementById('tabContent');
  if (!content) return;
  content.innerHTML = '<div class="empty-state"><div class="empty-icon">🚧</div><p>Раздел в разработке</p></div>';
}

function notify(text, type = 'info') {
  const el = document.getElementById('notification');
  if (!el) return;
  const textEl = el.querySelector('.notif-text');
  if (textEl) textEl.textContent = text;
  el.className = `notification ${type} show`;
  setTimeout(() => { el.classList.remove('show'); }, 4000); // 4 секунды
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => { overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.classList.remove('show'); document.body.style.overflow = ''; } }); });
  document.addEventListener('click', (e) => { const menu = document.getElementById('userMenu'); const dropdown = document.getElementById('userDropdown'); if (menu && dropdown && !menu.contains(e.target)) dropdown.classList.remove('show'); });
  init();
});

async function deleteArtwork(artId) {
  if (!confirm('Удалить работу?')) return;
  try {
    const res = await fetch(`/api/artworks/${artId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser?.id }) });
    if (res.ok) { notify('Удалено', 'success'); closeModal('artworkModal'); if (viewingProfileId === currentUser?.id) loadProfile(currentUser.id); else loadFeed(); }
    else { const err = await res.json().catch(() => ({})); notify(err.error || 'Ошибка', 'warning'); }
  } catch(e) { notify(e.message, 'warning'); }
}