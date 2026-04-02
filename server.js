const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// === ГЛОБАЛЬНЫЙ ПЕРЕХВАТ ОШИБОК ===
process.on('uncaughtException', (err) => console.error('💥 UNCAUGHT:', err));
process.on('unhandledRejection', (err) => console.error('🚫 UNHANDLED REJECTION:', err));
app.use((err, req, res, next) => {
  console.error('❌ SERVER ROUTE ERROR:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// === БАЗА ДАННЫХ ===
const dbPath = path.join(__dirname, 'artback.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('DB OPEN ERROR:', err);
  else console.log('✅ SQLite connected:', dbPath);
});

const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
const get = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const all = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));

async function initDB() {
  console.log('📦 Initializing tables...');
  await run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, username TEXT UNIQUE, email TEXT UNIQUE,
    password TEXT, art_type TEXT DEFAULT 'digital', bio TEXT DEFAULT '',
    avatar_color TEXT DEFAULT '#6366f1', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS artworks (
    id TEXT PRIMARY KEY, user_id TEXT, title TEXT, description TEXT DEFAULT '',
    type TEXT, tags TEXT DEFAULT '[]', likes INTEGER DEFAULT 0, views INTEGER DEFAULT 0,
    total_donated INTEGER DEFAULT 0, image_path TEXT DEFAULT '',
    gradient TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY, artwork_id TEXT, user_id TEXT, params TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(artwork_id, user_id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, artwork_id TEXT, user_id TEXT, text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY, artwork_id TEXT, user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(artwork_id, user_id)
  )`);

  // Демо-данные (только если таблица users пуста)
  const count = await get('SELECT COUNT(*) as c FROM users');
  if (count.c === 0) {
    console.log('🌱 Inserting demo data...');
    
    // Демо-пользователи
    await run(`INSERT INTO users VALUES ('demo1','Алиса Краскова','@alice_art','alice@demo.com','demo123','digital','Цифровой художник и концепт-артист. Работаю в Photoshop и Procreate.','#6366f1',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO users VALUES ('demo2','Максим Творцов','@max_create','max@demo.com','demo123','photography','Пейзажный фотограф. Снимаю на Canon R5.','#0ea5e9',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO users VALUES ('demo3','Юлия Иллюстраторова','@julia_draws','julia@demo.com','demo123','illustration','Иллюстратор детских книг. Люблю акварель и цифру.','#10b981',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO users VALUES ('demo4','Денис 3D','@denis_3d','denis@demo.com','demo123','3d','3D-художник. Создаю модели в Blender.','#f59e0b',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO users VALUES ('demo5','Анна Аниматор','@anna_motion','anna@demo.com','demo123','animation','Аниматор. Делаю короткие ролики в After Effects.','#ef4444',CURRENT_TIMESTAMP)`);

    // 🔧 ФИКС: Демо-работы с реальными изображениями (16 штук)
    await run(`INSERT INTO artworks VALUES ('a1','demo1','Дракон над горами','Концепт-арт для игровой студии. Нарисовано в Photoshop за 8 часов. Вдохновлена работами Алана Ли.','digital','["фэнтези","концепт","цифра"]',142,1250,3500,'https://images.unsplash.com/photo-1577493340887-b7bfff550145?w=800&q=80','linear-gradient(135deg,#3b82f6,#1e3a8a)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a2','demo2','Рассвет в Альпах','Снято на Canon R5 с объективом 24-70mm. Золотой час в швейцарских Альпах — невероятное зрелище.','photography','["пейзаж","горы","природа"]',98,890,2100,'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=800&q=80','linear-gradient(135deg,#059669,#065f46)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a3','demo3','Маленький волшебник','Иллюстрация для обложки детской книги о мальчике, который нашёл волшебную палочку. Акварель + цифровая доработка.','illustration','["книга","персонаж","сказка"]',215,2100,5200,'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80','linear-gradient(135deg,#d97706,#92400e)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a4','demo4','Киберпанк город','3D-сцена ночного города в стиле киберпанк. Создано в Blender с использованием Cycles рендера.','3d','["киберпанк","город","научная фантастика"]',178,1560,4100,'https://images.unsplash.com/photo-1555617981-778dd1c43165?w=800&q=80','linear-gradient(135deg,#6366f1,#4338ca)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a5','demo1','Портрет эльфийки','Детальный портрет в стиле фэнтези. Акцент на глаза и волосы — использовала кастомные кисти для текстуры.','digital','["портрет","эльф","фэнтези"]',203,1890,4800,'https://images.unsplash.com/photo-1535295972055-1c762f4483e5?w=800&q=80','linear-gradient(135deg,#118ab2,#065f46)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a6','demo2','Туманный лес','Мистическая атмосфера утреннего тумана в осеннем лесу. Снято на 50mm объектив с длинной выдержкой.','photography','["лес","туман","осень"]',134,1100,2800,'https://images.unsplash.com/photo-1511497584788-87676011196d?w=800&q=80','linear-gradient(135deg,#2d6a4f,#1e293b)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a7','demo3','Лесная фея','Иллюстрация для серии открыток. Фея, которая прячется среди цветов. Использовала акварель и цифровую доработку.','illustration','["фея","природа","открытка"]',189,1650,3900,'https://images.unsplash.com/photo-1518182170546-0766aa6f6a56?w=800&q=80','linear-gradient(135deg,#ec4899,#be185d)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a8','demo4','Космический корабль','3D-модель исследовательского корабля для инди-игры. Низкополигональный стиль с ручной прорисовкой текстур.','3d','["космос","корабль","игра"]',156,1320,3200,'https://images.unsplash.com/photo-1614728894747-a631e4be966b?w=800&q=80','linear-gradient(135deg,#7c3aed,#4c1d95)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a9','demo1','Воин света','Цифровая живопись. Персонаж для фэнтези-игры. Освещение в стиле Rembrandt.','digital','["персонаж","воин","фэнтези"]',167,1420,3600,'https://images.unsplash.com/photo-1598556776374-0b313a9c83f1?w=800&q=80','linear-gradient(135deg,#f59e0b,#b45309)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a10','demo2','Горное озеро','Кристально чистое озеро в горах Норвегии. Снято на рассвете.','photography','["озеро","горы","норвегия"]',145,1230,2900,'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80','linear-gradient(135deg,#0ea5e9,#0369a1)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a11','demo3','Зимняя сказка','Иллюстрация для новогодней книги. Девочка и её олень в зимнем лесу.','illustration','["зима","сказка","новый год"]',198,1780,4200,'https://images.unsplash.com/photo-1512474932049-78ac69ede12c?w=800&q=80','linear-gradient(135deg,#3b82f6,#1e40af)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a12','demo4','Механический дракон','3D-модель стимпанк дракона для настольной игры. Детализация каждого винтика.','3d','["стимпанк","дракон","механизм"]',172,1490,3700,'https://images.unsplash.com/photo-1599839575945-a9043f0a4d1f?w=800&q=80','linear-gradient(135deg,#dc2626,#991b1b)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a13','demo5','Танец огня','Короткометражная анимация о духе огня. 2D анимация в After Effects.','animation','["огонь","танец","дух"]',183,1620,3800,'https://images.unsplash.com/photo-1504333638930-c8787321eee0?w=800&q=80','linear-gradient(135deg,#f97316,#c2410c)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a14','demo1','Подводный мир','Концепт-арт подводной цивилизации. Атмосфера глубины и таинственности.','digital','["подводный","океан","цивилизация"]',159,1380,3400,'https://images.unsplash.com/photo-1582967788606-a171f1080ca8?w=800&q=80','linear-gradient(135deg,#06b6d4,#0e7490)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a15','demo2','Северное сияние','Полярное сияние в Исландии. Длинная выдержка 15 секунд.','photography','["сияние","исландия","ночь"]',201,1890,4500,'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=800&q=80','linear-gradient(135deg,#10b981,#059669)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a16','demo3','Волшебный сад','Иллюстрация сказочного сада с говорящими цветами. Акварель и тушь.','illustration','["сад","волшебство","цветы"]',176,1540,3600,'https://images.unsplash.com/photo-1463936575829-25148e1db1b8?w=800&q=80','linear-gradient(135deg,#8b5cf6,#6d28d9)',CURRENT_TIMESTAMP)`);

    // Демо-оценки
    await run(`INSERT INTO ratings VALUES ('r1','a1','demo2','{"technique":9,"composition":8,"color":9,"lighting":8,"vibe":10,"originality":8}',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO ratings VALUES ('r2','a1','demo3','{"technique":8,"composition":9,"color":8,"lighting":7,"vibe":9,"originality":9}',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO ratings VALUES ('r3','a2','demo1','{"exposure":9,"focus":8,"composition":10,"timing":9,"vibe":10,"storytelling":8}',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO ratings VALUES ('r4','a3','demo4','{"line":9,"narrative":8,"character":10,"style":9,"vibe":10,"charm":10}',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO ratings VALUES ('r5','a4','demo1','{"topology":8,"texturing":9,"lighting":10,"render":9,"vibe":9,"creativity":8}',CURRENT_TIMESTAMP)`);

    // Демо-комментарии
    await run(`INSERT INTO comments VALUES ('c1','a1','demo2','Потрясающая работа с освещением и глубиной сцены. Дракон выглядит невероятно живым!',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO comments VALUES ('c2','a1','demo3','Обожаю цветовую палитру! Облака просто шедевральные.',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO comments VALUES ('c3','a2','demo1','Какая красота! Мечтаю побывать там. Какой объектив использовали?',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO comments VALUES ('c4','a3','demo4','Персонаж очень милый! Дети точно оценят эту иллюстрацию.',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO comments VALUES ('c5','a4','demo3','Невероятная детализация! Сколько времени ушло на рендер?',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO comments VALUES ('c6','a5','demo2','Глаза просто гипнотизируют! Отличная работа с портретом.',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO comments VALUES ('c7','a6','demo1','Атмосфера просто волшебная. Очень нравится работа с туманом.',CURRENT_TIMESTAMP)`);
  }
  console.log('✅ DB ready');
}

// === ЗАГРУЗКА ФАЙЛОВ ===
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Created uploads directory:', uploadDir);
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// === MIDDLEWARE ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

// === API: Auth ===
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await get('SELECT id,name,username,email,art_type,bio,avatar_color FROM users WHERE email=? AND password=?', [email, password]);
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
    res.json(user);
  } catch(e) { console.error('LOGIN ERR:', e); res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, username, email, password, artType } = req.body;
    if (!name || !username || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    const id = 'u_' + Date.now();
    const colors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await run('INSERT INTO users (id,name,username,email,password,art_type,avatar_color) VALUES (?,?,?,?,?,?,?)',
      [id, name, username.startsWith('@')?username:'@'+username, email, password, artType||'digital', color]);
    res.json({ id, name, username, email, artType: artType||'digital', bio:'', avatar_color: color });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email или ник заняты' });
    console.error('REG ERR:', e); res.status(500).json({ error: e.message });
  }
});

// === API: Artworks ===
app.get('/api/artworks', async (req, res) => {
  try {
    const type = req.query.type;
    const query = type && type!=='all'
      ? 'SELECT a.*, u.name as author_name, u.username as author_username, u.avatar_color FROM artworks a LEFT JOIN users u ON a.user_id=u.id WHERE a.type=? ORDER BY a.created_at DESC'
      : 'SELECT a.*, u.name as author_name, u.username as author_username, u.avatar_color FROM artworks a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC';
    
    const arts = await all(query, type && type!=='all' ? [type] : []);
    const result = [];
    for (const a of arts) {
      const avg = await getAvgRating(a.id);
      const likes = await get('SELECT COUNT(*) as c FROM likes WHERE artwork_id=?', [a.id]);
      result.push({ ...a, avgRating: avg, likesCount: likes.c });
    }
    res.json(result);
  } catch(e) {
    console.error('🔥 ARTWORKS FETCH ERROR:', e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

async function getAvgRating(artId) {
  const rows = await all('SELECT params FROM ratings WHERE artwork_id=?', [artId]);
  let sum = 0, count = 0;
  rows.forEach(r => {
    try { const p = JSON.parse(r.params); Object.values(p).forEach(v => { sum += v; count++; }); } catch {}
  });
  return count ? sum / count : 0;
}

app.post('/api/artworks', async (req, res) => {
  try {
    const { userId, title, description, type, tags, imagePath, gradient } = req.body;
    const id = 'a_' + Date.now();
    await run('INSERT INTO artworks (id,user_id,title,description,type,tags,image_path,gradient) VALUES (?,?,?,?,?,?,?,?)',
      [id, userId, title, description||'', type, JSON.stringify(tags||[]), imagePath||'', gradient||'linear-gradient(135deg,#475569,#1e293b)']);
    res.status(201).json({ id });
  } catch(e) { console.error('CREATE ART ERR:', e); res.status(500).json({ error: e.message }); }
});

app.get('/api/artworks/:id', async (req, res) => {
  try {
    const art = await get('SELECT a.*, u.name as author_name, u.username as author_username, u.avatar_color FROM artworks a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?', [req.params.id]);
    if (!art) return res.status(404).json({ error: 'Not found' });
    await run('UPDATE artworks SET views=views+1 WHERE id=?', [art.id]);
    const ratings = await all('SELECT * FROM ratings WHERE artwork_id=?', [art.id]);
    const comments = await all('SELECT c.*, u.name as author_name, u.avatar_color FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.artwork_id=? ORDER BY c.created_at', [art.id]);
    const avg = await getAvgRating(art.id);
    const likes = await get('SELECT COUNT(*) as c FROM likes WHERE artwork_id=?', [art.id]);
    res.json({ art: { ...art, avgRating: avg, likesCount: likes.c }, ratings, comments });
  } catch(e) { console.error('ART DETAIL ERR:', e); res.status(500).json({ error: e.message }); }
});

app.post('/api/artworks/:id', async (req, res) => {
  try {
    const { type, userId, text, params, amount } = req.body;
    const artId = req.params.id;
    if (type === 'like') {
      const exists = await get('SELECT id FROM likes WHERE artwork_id=? AND user_id=?', [artId, userId]);
      if (exists) return res.json({ liked: false });
      await run('INSERT INTO likes (id,artwork_id,user_id) VALUES (?,?,?)', ['l_'+Date.now(), artId, userId]);
      return res.json({ liked: true });
    }
    if (type === 'comment') {
      await run('INSERT INTO comments (id,artwork_id,user_id,text) VALUES (?,?,?,?)', ['c_'+Date.now(), artId, userId, text]);
      return res.json({ ok: true });
    }
    if (type === 'rate') {
      await run('INSERT OR REPLACE INTO ratings (id,artwork_id,user_id,params) VALUES (?,?,?,?)', ['r_'+Date.now(), artId, userId, JSON.stringify(params)]);
      return res.json({ ok: true });
    }
    if (type === 'donate') {
      await run('UPDATE artworks SET total_donated=total_donated+? WHERE id=?', [amount, artId]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'Unknown action' });
  } catch(e) { console.error('ART ACTION ERR:', e); res.status(500).json({ error: e.message }); }
});

app.delete('/api/artworks/:id', async (req, res) => {
  try {
    const { userId } = req.body;
    const artId = req.params.id;
    const art = await get('SELECT user_id, image_path FROM artworks WHERE id=?', [artId]);
    if (!art) return res.status(404).json({ error: 'Работа не найдена' });
    if (art.user_id !== userId) return res.status(403).json({ error: 'Только владелец может удалить работу' });
    if (art.image_path && art.image_path.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, art.image_path);
      try { fs.unlinkSync(filePath); } catch(e) { console.log('File not found:', filePath); }
    }
    await run('DELETE FROM ratings WHERE artwork_id=?', [artId]);
    await run('DELETE FROM comments WHERE artwork_id=?', [artId]);
    await run('DELETE FROM likes WHERE artwork_id=?', [artId]);
    await run('DELETE FROM artworks WHERE id=?', [artId]);
    res.json({ ok: true });
  } catch(e) { console.error('DELETE ART ERR:', e); res.status(500).json({ error: e.message }); }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });
  res.json({ path: `/uploads/${req.file.filename}` });
});

app.get('/api/user/:id', async (req, res) => {
  try {
    const user = await get('SELECT id,name,username,email,art_type,bio,avatar_color FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const arts = await all('SELECT id,title,type,likes,views,total_donated,image_path,gradient,created_at FROM artworks WHERE user_id=? ORDER BY created_at DESC', [req.params.id]);
    res.json({ user, artworks: arts });
  } catch(e) { console.error('USER ERR:', e); res.status(500).json({ error: e.message }); }
});

app.put('/api/user/:id/bio', async (req, res) => {
  try {
    await run('UPDATE users SET bio=? WHERE id=?', [req.body.bio, req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error('BIO ERR:', e); res.status(500).json({ error: e.message }); }
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 ArtBack running on port ${PORT}`));
}).catch(err => {
  console.error('💀 FATAL DB INIT ERROR:', err);
  process.exit(1);
});