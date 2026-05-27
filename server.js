const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');

const app = express();
const JWT_SECRET = 'psycoai_gizli_anahtar_2024';
const SALT_ROUNDS = 10;

// Multer — görsel yükleme
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Sadece görsel dosyası yüklenebilir.'));
  },
});

// Uploads klasörü yoksa oluştur
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// DB bağlantısı
const pool = new Pool({
  user: 'zeynep',
  host: 'localhost',
  database: 'psycoai',
  password: '1234',
  port: 5432,
});

// Tabloları oluştur
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(100) UNIQUE,
      password VARCHAR(255),
      role VARCHAR(50),
      role_label VARCHAR(100),
      institution VARCHAR(100),
      city VARCHAR(50),
      initials VARCHAR(5),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      image_path VARCHAR(255),
      figure_type VARCHAR(50),
      prompt TEXT,
      result TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('Tablolar hazır.');
}
initDB().catch((err) => console.error('DB hatası:', err.message));

// ── JWT middleware ──
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Token gerekli.' });
  }
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ detail: 'Geçersiz token.' });
  }
}

// ── REGISTER ──
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      name = '',
      email = '',
      password = '',
      role = '',
      role_label = '',
      institution = null,
      city = null,
      initials = '',
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ detail: 'E-posta ve şifre zorunludur.' });
    }

    const emailLower = email.toLowerCase();

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [
      emailLower,
    ]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ detail: 'Bu e-posta zaten kayıtlı.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const finalInitials =
      initials ||
      (name
        ? name
            .split(' ')
            .map((x) => x[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
        : '?');

    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, role_label, institution, city, initials)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        name,
        emailLower,
        hashedPassword,
        role,
        role_label,
        institution,
        city,
        finalInitials,
      ],
    );

    const user = { ...result.rows[0] };
    delete user.password;

    res.json({ message: 'Kayıt başarılı.', user });
  } catch (err) {
    console.error('REGISTER HATA:', err);
    res.status(500).json({ detail: err.message });
  }
});

// ── LOGIN ──
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase();
    const password = req.body.password || '';

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ detail: 'E-posta veya şifre hatalı.' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ detail: 'E-posta veya şifre hatalı.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    const safeUser = { ...user };
    delete safeUser.password;

    res.json({ access_token: token, user: safeUser });
  } catch (err) {
    console.error('LOGIN HATA:', err);
    res.status(500).json({ detail: err.message });
  }
});

// ── ANALYZE ──
app.post(
  '/api/analyze',
  authMiddleware,
  upload.single('image'),
  async (req, res) => {
    try {
      const { figure_type = 'Ev', prompt = '' } = req.body;
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({ detail: 'Görsel zorunludur.' });
      }

      const imagePath = req.file.path;

      // Model servisine istek at
      const FormData = require('form-data');
      const fetch = require('node-fetch');

      const form = new FormData();
      form.append('image', fs.createReadStream(imagePath), {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });
      form.append('figure_type', figure_type);

      const modelRes = await fetch('http://localhost:8000/analyze', {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      });

      if (!modelRes.ok) {
        throw new Error('Model servisi yanıt vermedi.');
      }

      const modelData = await modelRes.json();
      const result = modelData.result;

      // DB'ye kaydet
      const saved = await pool.query(
        `INSERT INTO analyses (user_id, image_path, figure_type, prompt, result)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, imagePath, figure_type, prompt, result],
      );

      res.json({ analysis: saved.rows[0] });
    } catch (err) {
      console.error('ANALYZE HATA:', err);
      res.status(500).json({ detail: err.message });
    }
  },
);

// ── ANALİZ GEÇMİŞİ ──
app.get('/api/analyses', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM analyses WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id],
    );
    res.json({ analyses: result.rows });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// ── PROFİL ──
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id,name,email,role,role_label,institution,city,initials,created_at FROM users WHERE id = $1',
      [req.user.id],
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// ── TEKİL ANALİZ ──
app.get("/api/analyses/:id", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM analyses WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ detail: "Bulunamadi." });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ detail: err.message }); }
});

app.use("/uploads", express.static(require("path").join(__dirname, "uploads")));

// ── STATS ──
app.get("/api/stats", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as monthly FROM analyses WHERE user_id = $1", [req.user.id]);
    res.json(r.rows[0]);
  } catch(err){ res.status(500).json({detail: err.message}); }
});

// SERVER
app.listen(5000, () => {
  console.log('Server çalışıyor: http://localhost:5000');
});
