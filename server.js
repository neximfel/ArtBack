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

// 🔧 TEST CONNECTION
supabase.from('artworks').select('count', { count: 'exact', head: true }).then(({ count, error }) => {
  if (error) {
    console.error('❌ Database connection error:', error);
  } else {
    console.log('✅ Database connected! Artworks count:', count);
  }
});

// === GLOBAL ERROR HANDLING ===
process.on('uncaughtException', (err) => console.error('💥 UNCAUGHT:', err));
process.on('unhandledRejection', (err) => console.error('🚫 UNHANDLED:', err));

// === MULTER SETUP ===
const storage = multer.memoryStorage();
const upload = multer({ 
  storage, 
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images'));
  }
});

// === MIDDLEWARE ===
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === HELPER FUNCTIONS ===
async function getAvgRating(artId) {
  try {
    const { data, error } = await supabase.from('ratings').select('params').eq('artwork_id', artId);
    if (error || !data?.length) return 0;
    
    let sum = 0, count = 0;
    data.forEach(r => {
      try { 
        const p = typeof r.params === 'string' ? JSON.parse(r.params) : r.params;
        Object.values(p).forEach(v => { sum += Number(v) || 0; count++; }); 
      } catch {}
    });
    return count ? (sum / count).toFixed(1) : 0;
  } catch (e) {
    console.error('❌ getAvgRating error:', e);
    return 0;
  }
}

// === API: GET ARTWORKS ===
app.get('/api/artworks', async (req, res) => {
  try {
    console.log('📥 GET /api/artworks - type:', req.query.type);
    
    const type = req.query.type;
    let query = supabase.from('artworks').select(`
      *,
      users!artworks_user_id_fkey (id, name, username, avatar_color, avatar_url)
    `).order('created_at', { ascending: false });
    
    if (type && type !== 'all') {
      query = query.eq('type', type);
    }
    
    const { data: arts, error } = await query;
    
    if (error) {
      console.error('❌ Database error:', error);
      return res.status(500).json({ error: error.message, details: error });
    }
    
    console.log('✅ Fetched artworks:', arts?.length || 0);
    
    if (!arts || arts.length === 0) {
      return res.json([]);
    }
    
    // Process each artwork
    const result = [];
    for (const a of arts) {
      try {
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
      } catch (e) {
        console.error('❌ Error processing artwork', a.id, ':', e);
      }
    }
    
    console.log('✅ Sending', result.length, 'artworks');
    res.json(result);
    
  } catch (e) {
    console.error('❌ API /artworks error:', e);
    res.status(500).json({ 
      error: e.message, 
      stack: e.stack 
    });
  }
});

// === API: AUTH ===
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Fill all fields' });
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id,name,username,email,art_type,bio,avatar_color,avatar_url')
      .eq('email', email)
      .eq('password', password)
      .single();
    
    if (error || !user) return res.status(401).json({ error: 'Invalid credentials' });
    res.json(user);
  } catch(e) { 
    console.error('❌ Login error:', e);
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, username, email, password, artType } = req.body;
    if (!name || !username || !email || !password) 
      return res.status(400).json({ error: 'Fill all fields' });
    
    const id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const colors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const cleanUsername = username.startsWith('@') ? username : '@' + username;
    
    const { error } = await supabase.from('users').insert({
      id, name, username: cleanUsername, email, password, 
      art_type: artType||'digital', avatar_color: color
    });
    
    if (error) {
      console.error('❌ Registration error:', error);
      if (error.code === '23505' || error.message?.includes('unique')) {
        if (error.message.includes('email')) {
          return res.status(400).json({ error: '⛔ Email already used!' });
        }
        return res.status(400).json({ error: '⛔ Username already taken!' });
      }
      throw error;
    }
    
    res.json({ id, name, username: cleanUsername, email, artType: artType||'digital', bio:'', avatar_color: color });
  } catch(e) {
    console.error('❌ Registration error:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

// === OTHER API ENDPOINTS ===
app.post('/api/artworks', async (req, res) => {
  try {
    const { userId, title, description, type, tags, imageUrl, gradient } = req.body;
    const id = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const { error } = await supabase.from('artworks').insert({ 
      id, user_id: userId, title, description: description||'', type, 
      tags: tags || [], image_url: imageUrl||'', gradient: gradient||'linear-gradient(135deg,#475569,#1e293b)' 
    });
    if (error) throw error;
    res.status(201).json({ id });
  } catch(e) { 
    console.error('❌ Create artwork error:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.get('/api/artworks/:id', async (req, res) => {
  try {
    const {  art, error } = await supabase
      .from('artworks')
      .select(`*, users!artworks_user_id_fkey (id, name, username, avatar_color, avatar_url)`)
      .eq('id', req.params.id)
      .single();
    
    if (error || !art) return res.status(404).json({ error: 'Not found' });
    
    const [avg, likesRes, ratings, comments] = await Promise.all([
      getAvgRating(art.id),
      supabase.from('likes').select('id', { count: 'exact' }).eq('artwork_id', art.id),
      supabase.from('ratings').select('*').eq('artwork_id', art.id),
      supabase.from('comments').select(`*, users!comments_user_id_fkey(id, name, avatar_color, avatar_url)`).eq('artwork_id', art.id).order('created_at', { ascending: true })
    ]);
    
    supabase.from('artworks').update({ views: (art.views || 0) + 1 }).eq('id', art.id).then();
    
    res.json({
      art: { ...art, avgRating: avg, likesCount: likesRes.count || 0, author_name: art.users?.name, author_username: art.users?.username, avatar_color: art.users?.avatar_color, avatar_url: art.users?.avatar_url },
      ratings: ratings.data || [],
      comments: comments.data || []
    });
  } catch(e) { 
    console.error('❌ Get artwork error:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/artworks/:id', async (req, res) => {
  try {
    const { type, userId, text, params, amount } = req.body;
    const artId = req.params.id;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    
    if (type === 'like') {
      const {  exists } = await supabase.from('likes').select('id').eq('artwork_id', artId).eq('user_id', userId).maybeSingle();
      if (exists) await supabase.from('likes').delete().eq('artwork_id', artId).eq('user_id', userId);
      else await supabase.from('likes').insert({ id: 'l_'+Date.now(), artwork_id: artId, user_id: userId });
      return res.json({ liked: !exists });
    }
    if (type === 'comment') {
      if (!text?.trim()) return res.status(400).json({ error: 'Empty' });
      await supabase.from('comments').insert({ id: 'c_'+Date.now(), artwork_id: artId, user_id: userId, text: text.trim() });
      return res.json({ ok: true });
    }
    if (type === 'rate') {
      await supabase.from('ratings').upsert({ id: 'r_'+Date.now(), artwork_id: artId, user_id: userId, params }, { onConflict: 'artwork_id,user_id' });
      return res.json({ ok: true });
    }
    if (type === 'donate') {
      const {  art } = await supabase.from('artworks').select('total_donated').eq('id', artId).single();
      await supabase.from('artworks').update({ total_donated: ((art?.total_donated || 0) + parseInt(amount)) }).eq('id', artId);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'Unknown action' });
  } catch(e) { 
    console.error('❌ Artwork action error:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.delete('/api/artworks/:id', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const {  art } = await supabase.from('artworks').select('user_id, image_url').eq('id', req.params.id).single();
    if (!art) return res.status(404).json({ error: 'Not found' });
    if (art.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });
    
    await Promise.all([
      supabase.from('ratings').delete().eq('artwork_id', req.params.id),
      supabase.from('comments').delete().eq('artwork_id', req.params.id),
      supabase.from('likes').delete().eq('artwork_id', req.params.id),
      supabase.from('artworks').delete().eq('id', req.params.id)
    ]);
    res.json({ ok: true });
  } catch(e) { 
    console.error('❌ Delete error:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const bucket = req.body.type === 'avatar' ? 'avatars' : 'artworks';
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2,10)}${path.extname(req.file.originalname)}`;
    
   const { data, error } = await supabase.storage.from(bucket).upload(fileName, req.file.buffer, { 
  contentType: req.file.mimetype 
});
if (error) throw error;

const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(data.path);
res.json({ url: publicUrl });
  } catch(e) { 
    console.error('❌ Upload error:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.get('/api/user/:id', async (req, res) => {
  try {
    const {  user, error } = await supabase.from('users').select('id,name,username,email,art_type,bio,avatar_color,avatar_url').eq('id', req.params.id).single();
    if (error || !user) return res.status(404).json({ error: 'User not found' });
    const {  arts } = await supabase.from('artworks').select('id,title,type,likes,views,total_donated,image_url,gradient,created_at').eq('user_id', req.params.id).order('created_at', { ascending: false });
    res.json({ user, artworks: arts || [] });
  } catch(e) { 
    console.error('❌ User error:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.put('/api/user/:id', async (req, res) => {
  try {
    const { bio, avatarUrl } = req.body;
    const updateData = {};
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl !== undefined) updateData.avatar_url = avatarUrl;
    if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'No data' });
    const { error } = await supabase.from('users').update(updateData).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) { 
    console.error('❌ Update user error:', e); 
    res.status(500).json({ error: e.message }); 
  }
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 ArtBack running on port ${PORT}`));