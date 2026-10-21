// SQLite database. Uses better-sqlite3 when available, otherwise Node's built-in node:sqlite (Node 22.5+).
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'truthlens.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;
try {
  const Better = require('better-sqlite3');
  db = new Better(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (e) {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS searches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim         TEXT NOT NULL,
  verdict       TEXT NOT NULL,
  verdict_label TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',
  result_json   TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_searches_user ON searches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
`);

module.exports = db;
