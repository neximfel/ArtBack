const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// === ГЛОБАЛЬНЫЙ ПЕРЕХВАТ ОШИБОК (чтобы Render точно показал их в логах) ===
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

// Промисификация для удобства
const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
const get = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const all = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));

// Инициализация таблиц
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
    await run(`INSERT INTO users VALUES ('demo1','Алиса Краскова','@alice_art','alice@demo.com','demo123','digital','Цифровой художник','#6366f1',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO users VALUES ('demo2','Максим Творцов','@max_create','max@demo.com','demo123','photography','Пейзажный фотограф','#0ea5e9',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a1','demo1','Дракон над горами','Концепт-арт для студии','digital','["фэнтези","концепт"]',142,1250,3500,'','linear-gradient(135deg,#3b82f6,#1e3a8a)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO artworks VALUES ('a2','demo2','Рассвет в Альпах','Снято на Canon R5','photography','["пейзаж","горы"]',98,890,2100,'','linear-gradient(135deg,#059669,#065f46)',CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO ratings VALUES ('r1','a1','demo2','{"technique":9,"composition":8,"color":9,"lighting":8,"vibe":10,"originality":8}',CURRENT_TIMESTAMP)`);
  }
  console.log('✅ DB ready');
}

// === ЗАГРУЗКА ФАЙЛОВ ===
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

// === API ===
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

// === ЗАПУСК ===
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 ArtBack running on port ${PORT}`));
}).catch(err => {
  console.error('💀 FATAL DB INIT ERROR:', err);
  process.exit(1);
});