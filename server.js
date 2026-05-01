const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();

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

// Tablo oluştur
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    password VARCHAR(100),
    role VARCHAR(50),
    role_label VARCHAR(100),
    institution VARCHAR(100),
    city VARCHAR(50),
    initials VARCHAR(5),
    created_at TIMESTAMP DEFAULT NOW()
  )
`)
.then(() => console.log('Tablo hazır.'))
.catch(err => console.error('Tablo hatası:', err.message));

// Test endpoint
app.get('/api', (req, res) => {
  res.json({ message: 'API çalışıyor' });
});

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    console.log("BODY:", req.body);

    const {
      name = '',
      email = '',
      password = '',
      role = '',
      role_label = '',
      institution = null,
      city = null,
      initials = ''
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ detail: 'E-posta ve şifre zorunludur.' });
    }

    const emailLower = email.toLowerCase();

    // kullanıcı var mı
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [emailLower]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ detail: 'Bu e-posta zaten kayıtlı.' });
    }

    // initials hesapla
    const finalInitials =
      initials ||
      (name
        ? name
            .split(' ')
            .map(x => x[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
        : '?');

    const values = [
      name,
      emailLower,
      password,
      role,
      role_label,
      institution,
      city,
      finalInitials
    ];

    console.log("VALUES:", values);

    const result = await pool.query(
      `INSERT INTO users
      (name, email, password, role, role_label, institution, city, initials)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      values
    );


    const user = { ...result.rows[0] };
    delete user.password;

    res.json({
      access_token: 'fake-jwt-' + user.id,
      user
    });

  } catch (err) {
    console.error("HATA:", err);
    res.status(500).json({ detail: err.message });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = (req.body.username || req.body.email || '').toLowerCase();
    const password = req.body.password || '';

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND password = $2',
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ detail: 'E-posta veya şifre hatalı.' });
    }

    const user = { ...result.rows[0] };
    delete user.password;

    res.json({
      access_token: 'fake-jwt-' + user.id,
      user
    });

  } catch (err) {
    console.error("LOGIN HATA:", err);
    res.status(500).json({ detail: err.message });
  }
});

// SERVER
app.listen(5000, () => {
  console.log('Server çalışıyor: http://localhost:5000');
});
