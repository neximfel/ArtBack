const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// === БАЗА ДАННЫХ ===
const dbPath = path.join(__dirname, 'artback.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Инициализация таблиц (если ещё нет)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, username TEXT UNIQUE, email TEXT UNIQUE,
    password TEXT, art_type TEXT DEFAULT 'digital', bio TEXT DEFAULT '',
    avatar_color TEXT DEFAULT '#6366f1', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS artworks (
    id TEXT PRIMARY KEY, user_id TEXT, title TEXT, description TEXT DEFAULT '',
    type TEXT, tags TEXT DEFAULT '[]', likes INTEGER DEFAULT 0, views INTEGER DEFAULT 0,
    total_donated INTEGER DEFAULT 0, image_path TEXT DEFAULT '',
    gradient TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY, artwork_id TEXT, user_id TEXT, params TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(artwork_id, user_id),
    FOREIGN KEY(artwork_id) REFERENCES artworks(id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, artwork_id TEXT, user_id TEXT, text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(artwork_id) REFERENCES artworks(id)
  );
  CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY, artwork_id TEXT, user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(artwork_id, user_id)
  );
`);

// Демо-данные (запустится только при чистой БД)
if (db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0) {
  const initSql = `
    INSERT INTO users VALUES ('demo1','Алиса Краскова','@alice_art','alice@demo.com','demo123','digital','Цифровой художник','#6366f1',CURRENT_TIMESTAMP);
    INSERT INTO users VALUES ('demo2','Максим Творцов','@max_create','max@demo.com','demo123','photography','Пейзажный фотограф','#0ea5e9',CURRENT_TIMESTAMP);
    INSERT INTO artworks VALUES ('a1','demo1','Дракон над горами','Концепт-арт для студии','digital','["фэнтези","концепт"]',142,1250,3500,'','linear-gradient(135deg,#3b82f6,#1e3a8a)',CURRENT_TIMESTAMP);
    INSERT INTO artworks VALUES ('a2','demo2','Рассвет в Альпах','Снято на Canon R5','photography','["пейзаж","горы"]',98,890,2100,'','linear-gradient(135deg,#059669,#065f46)',CURRENT_TIMESTAMP);
    INSERT INTO ratings VALUES ('r1','a1','demo2','{"technique":9,"composition":8,"color":9,"lighting":8,"vibe":10,"originality":8}',CURRENT_TIMESTAMP);
  `;
  db.exec(initSql);
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
app.use('/uploads', express.static(uploadDir)); // Отдача фото
app.use('/public', express.static(path.join(__dirname, 'public')));

// === HELPER ===
function getAvgRating(artId) {
  const rows = db.prepare('SELECT params FROM ratings WHERE artwork_id = ?').all(artId);
  let sum = 0, count = 0;
  rows.forEach(r => {
    try {
      const p = JSON.parse(r.params);
      Object.values(p).forEach(v => { sum += v; count++; });
    } catch {}
  });
  return count ? sum / count : 0;
}

// === API ROUTES ===
// Auth
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT id,name,username,email,art_type,bio,avatar_color FROM users WHERE email=? AND password=?').get(email, password);
  if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
  res.json(user);
});

app.post('/api/auth/register', (req, res) => {
  const { name, username, email, password, artType } = req.body;
  if (!name || !username || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
  try {
    const id = 'u_' + Date.now();
    const colors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    db.prepare('INSERT INTO users (id,name,username,email,password,art_type,avatar_color) VALUES (?,?,?,?,?,?,?)')
      .run(id, name, username.startsWith('@')?username:'@'+username, email, password, artType||'digital', color);
    res.json({ id, name, username, email, artType: artType||'digital', bio:'', avatar_color: color });
  } catch(e) {
    return res.status(400).json({ error: 'Email или ник заняты' });
  }
});

// Artworks
app.get('/api/artworks', (req, res) => {
  const type = req.query.type;
  const query = type && type!=='all'
    ? `SELECT a.*, u.name as author_name, u.username as author_username, u.avatar_color FROM artworks a LEFT JOIN users u ON a.user_id=u.id WHERE a.type=? ORDER BY a.created_at DESC`
    : `SELECT a.*, u.name as author_name, u.username as author_username, u.avatar_color FROM artworks a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC`;
  
  const arts = db.prepare(query).all(type && type!=='all' ? type : undefined);
  const result = arts.map(a => ({
    ...a,
    avgRating: getAvgRating(a.id),
    likesCount: db.prepare('SELECT COUNT(*) as c FROM likes WHERE artwork_id=?').get(a.id).c
  }));
  res.json(result);
});

app.post('/api/artworks', (req, res) => {
  const { userId, title, description, type, tags, imagePath, gradient } = req.body;
  const id = 'a_' + Date.now();
  db.prepare('INSERT INTO artworks (id,user_id,title,description,type,tags,image_path,gradient) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, userId, title, description||'', type, JSON.stringify(tags||[]), imagePath||'', gradient||'linear-gradient(135deg,#475569,#1e293b)');
  res.status(201).json({ id });
});

app.get('/api/artworks/:id', (req, res) => {
  const art = db.prepare(`SELECT a.*, u.name as author_name, u.username as author_username, u.avatar_color FROM artworks a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`).get(req.params.id);
  if (!art) return res.status(404).json({ error: 'Not found' });
  
  db.prepare('UPDATE artworks SET views=views+1 WHERE id=?').run(art.id);
  const ratings = db.prepare('SELECT * FROM ratings WHERE artwork_id=?').all(art.id);
  const comments = db.prepare('SELECT c.*, u.name as author_name, u.avatar_color FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.artwork_id=? ORDER BY c.created_at').all(art.id);
  
  res.json({ art: { ...art, avgRating: getAvgRating(art.id), likesCount: db.prepare('SELECT COUNT(*) as c FROM likes WHERE artwork_id=?').get(art.id).c }, ratings, comments });
});

app.post('/api/artworks/:id', (req, res) => {
  const { type, userId, text, params, amount } = req.body;
  const artId = req.params.id;
  
  if (type === 'like') {
    const exists = db.prepare('SELECT id FROM likes WHERE artwork_id=? AND user_id=?').get(artId, userId);
    if (exists) return res.json({ liked: false });
    db.prepare('INSERT INTO likes (id,artwork_id,user_id) VALUES (?,?,?)').run('l_'+Date.now(), artId, userId);
    return res.json({ liked: true });
  }
  if (type === 'comment') {
    db.prepare('INSERT INTO comments (id,artwork_id,user_id,text) VALUES (?,?,?,?)').run('c_'+Date.now(), artId, userId, text);
    return res.json({ ok: true });
  }
  if (type === 'rate') {
    db.prepare('INSERT OR REPLACE INTO ratings (id,artwork_id,user_id,params) VALUES (?,?,?,?)')
      .run('r_'+Date.now(), artId, userId, JSON.stringify(params));
    return res.json({ ok: true });
  }
  if (type === 'donate') {
    db.prepare('UPDATE artworks SET total_donated=total_donated+? WHERE id=?').run(amount, artId);
    return res.json({ ok: true });
  }
  res.status(400).json({ error: 'Unknown action' });
});

// Upload
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });
  res.json({ path: `/uploads/${req.file.filename}` });
});

// User
app.get('/api/user/:id', (req, res) => {
  const user = db.prepare('SELECT id,name,username,email,art_type,bio,avatar_color FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const arts = db.prepare('SELECT id,title,type,likes,views,total_donated,image_path,gradient,created_at FROM artworks WHERE user_id=? ORDER BY created_at DESC').all(req.params.id);
  res.json({ user, artworks: arts });
});

app.put('/api/user/:id/bio', (req, res) => {
  db.prepare('UPDATE users SET bio=? WHERE id=?').run(req.body.bio, req.params.id);
  res.json({ ok: true });
});

// Фронтенд
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ ArtBack запущен на порту ${PORT}`));