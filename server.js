const fs = require('fs');
const path = require('path');

// Tiny .env loader (no extra dependency)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { verifyClaim, LANGS } = require('./verify');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.disable('x-powered-by');

// ---------- security headers ----------
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://upload.wikimedia.org",
    "connect-src 'self'",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '300kb' }));
app.use(auth.loadUser);

// Basic CSRF defence: cookies are SameSite=Lax, and cross-origin writes are refused.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request blocked.' }); }
    catch { return res.status(403).json({ error: 'Bad origin.' }); }
  }
  next();
});

// ---------- settings whitelist ----------
const THEMES = ['auto', 'midnight', 'lagoon', 'ember', 'paper', 'glacier'];
function cleanSettings(s = {}) {
  const out = {};
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));
  if (THEMES.includes(s.theme)) out.theme = s.theme;
  if (['s', 'm', 'l'].includes(s.fontSize)) out.fontSize = s.fontSize;
  if (typeof s.lensOn === 'boolean') out.lensOn = s.lensOn;
  if (Number.isFinite(+s.lensSize)) out.lensSize = num(s.lensSize, 0.6, 1.6);
  if (Number.isFinite(+s.lensFollow)) out.lensFollow = num(s.lensFollow, 0, 1);
  if (typeof s.lensReveal === 'boolean') out.lensReveal = s.lensReveal;
  if (['auto', 'low', 'balanced', 'high'].includes(s.quality)) out.quality = s.quality;
  if (typeof s.reduceMotion === 'boolean') out.reduceMotion = s.reduceMotion;
  if (LANGS[s.lang]) out.lang = s.lang;
  if (typeof s.news === 'boolean') out.news = s.news;
  if (typeof s.saveHistory === 'boolean') out.saveHistory = s.saveHistory;
  return out;
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

// ---------- auth ----------
const authLimiter = auth.rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

app.post('/api/auth/register', authLimiter, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'That email already has an account. Log in instead.' });

  const settings = JSON.stringify(cleanSettings(req.body.settings));
  const info = db.prepare('INSERT INTO users (email, name, password_hash, settings_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email, name, auth.hashPassword(password), settings, Date.now());
  const { token, expires } = auth.createSession(Number(info.lastInsertRowid));
  auth.setSessionCookie(res, token, expires);
  res.status(201).json({ user: { id: Number(info.lastInsertRowid), name, email }, settings: JSON.parse(settings) });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Run a hash either way so response time doesn't reveal whether the email exists
  const ok = row ? auth.verifyPassword(password, row.password_hash) : (auth.verifyPassword(password, 'scrypt$00$00'), false);
  if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const { token, expires } = auth.createSession(row.id);
  auth.setSessionCookie(res, token, expires);
  res.json({ user: publicUser(row), settings: JSON.parse(row.settings_json || '{}') });
});

app.post('/api/auth/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user), settings: JSON.parse(req.user.settings_json || '{}') });
});

// ---------- settings ----------
app.put('/api/settings', auth.requireUser, (req, res) => {
  const settings = cleanSettings(req.body);
  db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), req.user.id);
  res.json({ settings });
});

// ---------- status ----------
app.get('/api/status', (_req, res) => {
  res.json({
    sources: {
      googleFactCheck: !!process.env.GOOGLE_FACTCHECK_API_KEY,
      wikipedia: true,
      gdelt: true
    },
    languages: LANGS
  });
});

// ---------- verify ----------
const verifyLimiter = auth.rateLimit({
  windowMs: 10 * 60 * 1000, max: 40,
  key: (req) => (req.user ? `u${req.user.id}` : `ip${req.ip}`),
  message: 'You are checking claims very quickly. Wait a few minutes and try again.'
});

function saveSearch(userId, result) {
  const info = db.prepare(
    'INSERT INTO searches (user_id, claim, verdict, verdict_label, lang, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, result.claim, result.verdict, result.label, result.lang || 'en', JSON.stringify(result), Date.now());
  return Number(info.lastInsertRowid);
}

app.post('/api/verify', verifyLimiter, async (req, res) => {
  try {
    const result = await verifyClaim(req.body.claim, {
      lang: LANGS[req.body.lang] ? req.body.lang : 'en',
      news: req.body.news !== false
    });
    let savedId = null;
    if (req.user && req.body.save !== false) savedId = saveSearch(req.user.id, result);
    res.json({ result, savedId });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong while checking that claim.' });
    if (!e.status) console.error(e);
  }
});

// ---------- history ----------
app.get('/api/history', auth.requireUser, (req, res) => {
  const rows = db.prepare(
    'SELECT id, claim, verdict, verdict_label, lang, created_at FROM searches WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200'
  ).all(req.user.id);
  res.json({ items: rows.map((r) => ({ id: r.id, claim: r.claim, verdict: r.verdict, label: r.verdict_label, lang: r.lang, createdAt: r.created_at })) });
});

app.get('/api/history/:id', auth.requireUser, (req, res) => {
  const row = db.prepare('SELECT id, result_json, created_at FROM searches WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: 'That search was not found.' });
  res.json({ id: row.id, createdAt: row.created_at, result: JSON.parse(row.result_json) });
});

// Save a result that was produced while logged out
const VERDICTS = ['true', 'false', 'mixed', 'related', 'none'];
app.post('/api/history', auth.requireUser, (req, res) => {
  const r = req.body.result;
  if (!r || typeof r.claim !== 'string' || !VERDICTS.includes(r.verdict) || typeof r.label !== 'string' ||
      r.claim.length > 500 || r.label.length > 80 || JSON.stringify(r).length > 100000) {
    return res.status(400).json({ error: 'That result could not be saved.' });
  }
  res.status(201).json({ id: saveSearch(req.user.id, r) });
});

app.delete('/api/history/:id', auth.requireUser, (req, res) => {
  db.prepare('DELETE FROM searches WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});
app.delete('/api/history', auth.requireUser, (req, res) => {
  db.prepare('DELETE FROM searches WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ---------- your data ----------
app.get('/api/export', auth.requireUser, (req, res) => {
  const searches = db.prepare('SELECT claim, verdict_label, lang, result_json, created_at FROM searches WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)
    .map((s) => ({ claim: s.claim, verdict: s.verdict_label, language: s.lang, checkedAt: new Date(s.created_at).toISOString(), result: JSON.parse(s.result_json) }));
  res.setHeader('Content-Disposition', 'attachment; filename="truth-lens-data.json"');
  res.json({ account: publicUser(req.user), settings: JSON.parse(req.user.settings_json || '{}'), searches });
});

app.delete('/api/account', auth.requireUser, auth.rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!auth.verifyPassword(String(req.body.password || ''), row.password_hash)) return res.status(401).json({ error: 'Password is incorrect.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id); // sessions + searches cascade
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- static site ----------
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build'), { maxAge: '7d' }));
// Phones get the mobile app at "/"; add ?view=desktop to force the desktop site
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i;
app.get('/', (req, res, next) => {
  const want = req.query.view;
  const mobile = want === 'mobile' || (want !== 'desktop' && MOBILE_UA.test(req.headers['user-agent'] || ''));
  res.setHeader('Vary', 'User-Agent');
  res.sendFile(path.join(__dirname, mobile ? 'm.html' : 'index.html'));
});
// Only these files are public. The server code, .env and the database are never served.
const PUBLIC_FILES = new Set(['index.html', 'm.html', 'styles.css', 'mobile.css', 'app.js', 'mobile.js', 'scene.js', 'themes.js']);
app.get('/:file', (req, res, next) => {
  if (!PUBLIC_FILES.has(req.params.file)) return next();
  res.sendFile(path.join(__dirname, req.params.file));
});

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request body.' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

if (require.main === module) {
  auth.cleanupExpired();
  app.listen(PORT, () => {
    console.log(`\n  Truth Lens running at http://localhost:${PORT}`);
    console.log(`  Google Fact Check API: ${process.env.GOOGLE_FACTCHECK_API_KEY ? 'enabled' : 'off (add GOOGLE_FACTCHECK_API_KEY to .env)'}\n`);
  });
}
module.exports = app;
