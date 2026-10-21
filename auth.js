const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'tl_session';
const SESSION_DAYS = 30;

// ---------- passwords (scrypt, built into Node) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- sessions ----------
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, expires);
  return { token, expires };
}
function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(res, token, expires) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Attach req.user (or null) to every request
function loadUser(req, _res, next) {
  req.sessionToken = parseCookies(req.headers.cookie)[COOKIE] || null;
  req.user = null;
  if (req.sessionToken) {
    const row = db.prepare(
      `SELECT u.id, u.email, u.name, u.settings_json FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`
    ).get(sha(req.sessionToken), Date.now());
    if (row) req.user = row;
  }
  next();
}
function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Log in to do that.' });
  next();
}

// ---------- tiny in-memory rate limiter ----------
function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests. Try again in a few minutes.' }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60000).unref();
  return (req, res, next) => {
    const k = key(req), now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) h = { n: 0, reset: now + windowMs };
    h.n++; hits.set(k, h);
    if (h.n > max) return res.status(429).json({ error: message });
    next();
  };
}

function cleanupExpired() { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, setSessionCookie,
  clearSessionCookie, loadUser, requireUser, rateLimit, cleanupExpired
};
