const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// === SUPABASE CLIENT ===
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseKey);

// === ГЛОБАЛЬНЫЙ ПЕРЕХВАТ ОШИБОК ===
process.on('uncaughtException', (err) => console.error('💥 UNCAUGHT:', err));
process.on('unhandledRejection', (err) => console.error('🚫 UNHANDLED REJECTION:', err));
app.use((err, req, res, next) => {
  console.error('❌ SERVER ROUTE ERROR:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// === ЗАГРУЗКА ФАЙЛОВ (в памяти для Supabase Storage) ===
const storage = multer.memoryStorage();
const upload = multer({ 
  storage, 
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения (PNG, JPG, WEBP)'));
  }
});

// === MIDDLEWARE ===
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { 
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    if (filepath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
  }
}));

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
async function getAvgRating(artId) {
  const { data, error } = await supabase
    .from('ratings')
    .select('params')
    .eq('artwork_id', artId);
  
  if (error || !data?.length) return 0;
  
  let sum = 0, count = 0;
  data.forEach(r => {
    try { 
      const p = typeof r.params === 'string' ? JSON.parse(r.params) : r.params;
      Object.values(p).forEach(v => { sum += Number(v) || 0; count++; }); 
    } catch {}
  });
  return count ? (sum / count).toFixed(1) : 0;
}

async function getArtworkWithDetails(artId) {
  const { data: art, error } = await supabase
    .from('artworks')
    .select(`
      *,
      users!artworks_user_id_fkey (id, name, username, avatar_color, avatar_url)
    `)
    .eq('id', artId)
    .single();
  
  if (error || !art) return null;
  
  const [avg, likesRes, ratings, comments] = await Promise.all([
    getAvgRating(artId),
    supabase.from('likes').select('id', { count: 'exact' }).eq('artwork_id', artId),
    supabase.from('ratings').select('*').eq('artwork_id', artId),
    supabase.from('comments')
      .select(`*, users!comments_user_id_fkey(id, name, avatar_color, avatar_url)`)
      .eq('artwork_id', artId)
      .order('created_at', { ascending: true })
  ]);
  
  // Обновляем просмотры асинхронно (не блокируем ответ)
  supabase.from('artworks').update({ views: (art.views || 0) + 1 }).eq('id', artId).then();
  
  return {
    art: { 
      ...art, 
      avgRating: avg, 
      likesCount: likesRes.count || 0,
      author_name: art.users?.name,
      author_username: art.users?.username,
      avatar_color: art.users?.avatar_color,
      avatar_url: art.users?.avatar_url
    },
    ratings: ratings.data || [],
    comments: comments.data || []
  };
}

// === API: Auth ===
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Заполните email и пароль' });
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id,name,username,email,art_type,bio,avatar_color,avatar_url')
      .eq('email', email)
      .eq('password', password)
      .single();
    
    if (error || !user) return res.status(401).json({ error: 'Неверный email или пароль' });
    res.json(user);
  } catch(e) { 
    console.error('LOGIN ERR:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, username, email, password, artType } = req.body;
    if (!name || !username || !email || !password) 
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    
    const id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const colors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const cleanUsername = username.startsWith('@') ? username : '@' + username;
    
    const { error } = await supabase.from('users').insert({
      id, name, username: cleanUsername, email, password, 
      art_type: artType||'digital', avatar_color: color
    });
    
    if (error) {
      if (error.message?.includes('unique') || error.code === '23505') 
        return res.status(400).json({ error: 'Email или никнейм уже заняты' });
      throw error;
    }
    
    res.json({ id, name, username: cleanUsername, email, artType: artType||'digital', bio:'', avatar_color: color });
  } catch(e) {
    console.error('REG ERR:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

// === API: Artworks ===
app.get('/api/artworks', async (req, res) => {
  try {
    const type = req.query.type;
    let query = supabase
      .from('artworks')
      .select(`
        *,
        users!artworks_user_id_fkey (id, name, username, avatar_color, avatar_url)
      `)
      .order('created_at', { ascending: false });
    
    if (type && type !== 'all') query = query.eq('type', type);
    
    const { data: arts, error } = await query;
    if (error) throw error;
    
    const result = [];
    for (const a of arts) {
      const avg = await getAvgRating(a.id);
      const { count } = await supabase.from('likes').select('*', { count: 'exact', head: true }).eq('artwork_id', a.id);
      result.push({ 
        ...a, 
        avgRating: avg, 
        likesCount: count || 0,
        author_name: a.users?.name,
        author_username: a.users?.username,
        avatar_color: a.users?.avatar_color,
        avatar_url: a.users?.avatar_url
      });
    }
    res.json(result);
  } catch(e) {
    console.error('🔥 ARTWORKS FETCH ERROR:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/artworks', async (req, res) => {
  try {
    const { userId, title, description, type, tags, imageUrl, gradient } = req.body;
    if (!userId || !title || !type) return res.status(400).json({ error: 'Заполните обязательные поля' });
    
    const id = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    
    const { error } = await supabase.from('artworks').insert({
      id, user_id: userId, title, description: description||'', type, 
      tags: tags || [], image_url: imageUrl||'', gradient: gradient||'linear-gradient(135deg,#475569,#1e293b)'
    });
    
    if (error) throw error;
    res.status(201).json({ id });
  } catch(e) { 
    console.error('CREATE ART ERR:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.get('/api/artworks/:id', async (req, res) => {
  try {
    const result = await getArtworkWithDetails(req.params.id);
    if (!result) return res.status(404).json({ error: 'Работа не найдена' });
    res.json(result);
  } catch(e) { 
    console.error('ART DETAIL ERR:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/artworks/:id', async (req, res) => {
  try {
    const { type, userId, text, params, amount } = req.body;
    const artId = req.params.id;
    
    if (!userId) return res.status(401).json({ error: 'Требуется авторизация' });
    
    if (type === 'like') {
      const { data: exists } = await supabase
        .from('likes')
        .select('id')
        .eq('artwork_id', artId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (exists) {
        await supabase.from('likes').delete().eq('artwork_id', artId).eq('user_id', userId);
        return res.json({ liked: false });
      }
      await supabase.from('likes').insert({ id: 'l_'+Date.now(), artwork_id: artId, user_id: userId });
      return res.json({ liked: true });
    }
    
    if (type === 'comment') {
      if (!text || text.trim().length === 0) return res.status(400).json({ error: 'Комментарий не может быть пустым' });
      await supabase.from('comments').insert({ 
        id: 'c_'+Date.now(), artwork_id: artId, user_id: userId, text: text.trim() 
      });
      return res.json({ ok: true });
    }
    
    if (type === 'rate') {
      await supabase.from('ratings').upsert({ 
        id: 'r_'+Date.now(), artwork_id: artId, user_id: userId, params 
      }, { onConflict: 'artwork_id,user_id' });
      return res.json({ ok: true });
    }
    
    if (type === 'donate') {
      const amt = parseInt(amount);
      if (!amt || amt <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
      
      const { data: art } = await supabase.from('artworks').select('total_donated').eq('id', artId).single();
      await supabase.from('artworks').update({ 
        total_donated: ((art?.total_donated || 0) + amt) 
      }).eq('id', artId);
      
      return res.json({ ok: true });
    }
    
    res.status(400).json({ error: 'Неизвестное действие' });
  } catch(e) { 
    console.error('ART ACTION ERR:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.delete('/api/artworks/:id', async (req, res) => {
  try {
    const { userId } = req.body;
    const artId = req.params.id;
    
    if (!userId) return res.status(401).json({ error: 'Требуется авторизация' });
    
    const { data: art } = await supabase.from('artworks').select('user_id, image_url').eq('id', artId).single();
    if (!art) return res.status(404).json({ error: 'Работа не найдена' });
    if (art.user_id !== userId) return res.status(403).json({ error: 'Только владелец может удалить работу' });
    
    // Удаляем изображение из Storage (опционально)
    if (art.image_url?.includes('supabase.co/storage')) {
      try {
        const filePath = art.image_url.split('/object/public/artworks/')[1];
        if (filePath) await supabase.storage.from('artworks').remove([filePath]);
      } catch(e) { console.log('Storage delete error (ignored):', e.message); }
    }
    
    // Удаляем связанные записи
    await Promise.all([
      supabase.from('ratings').delete().eq('artwork_id', artId),
      supabase.from('comments').delete().eq('artwork_id', artId),
      supabase.from('likes').delete().eq('artwork_id', artId)
    ]);
    
    await supabase.from('artworks').delete().eq('id', artId);
    res.json({ ok: true });
  } catch(e) { 
    console.error('DELETE ART ERR:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

// === ЗАГРУЗКА ИЗОБРАЖЕНИЙ В SUPABASE STORAGE ===
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });
    
    const bucket = req.body.type === 'avatar' ? 'avatars' : 'artworks';
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.jpg','.jpeg','.png','.webp','.gif'].includes(ext)) {
      return res.status(400).json({ error: 'Неподдерживаемый формат файла' });
    }
    
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2,10)}${ext}`;
    
    const { data, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, req.file.buffer, { 
        contentType: req.file.mimetype, 
        upsert: false,
        cacheControl: '3600'
      });
    
    if (uploadError) throw uploadError;
    
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(data.path);
    res.json({ url: publicUrl });
  } catch(e) {
    console.error('UPLOAD ERR:', e);
    res.status(500).json({ error: e.message || 'Ошибка загрузки файла' });
  }
});

// === API: Users ===
app.get('/api/user/:id', async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id,name,username,email,art_type,bio,avatar_color,avatar_url')
      .eq('id', req.params.id)
      .single();
    
    if (error || !user) return res.status(404).json({ error: 'Пользователь не найден' });
    
    const { data: arts } = await supabase
      .from('artworks')
      .select('id,title,type,likes,views,total_donated,image_url,gradient,created_at')
      .eq('user_id', req.params.id)
      .order('created_at', { ascending: false });
    
    res.json({ user, artworks: arts || [] });
  } catch(e) { 
    console.error('USER ERR:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.put('/api/user/:id', async (req, res) => {
  try {
    const { bio, avatarUrl } = req.body;
    const updateData = {};
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl !== undefined) updateData.avatar_url = avatarUrl;
    
    if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'Нет данных для обновления' });
    
    const { error } = await supabase.from('users').update(updateData).eq('id', req.params.id);
    if (error) throw error;
    
    res.json({ ok: true });
  } catch(e) { 
    console.error('UPDATE USER ERR:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

// === SPA FALLBACK ===
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.status(500).send('Ошибка загрузки приложения');
  });
});

// === ЗАПУСК ===
app.listen(PORT, () => console.log(`🚀 ArtBack running on port ${PORT}`));