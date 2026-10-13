// SQLite 資料層（Node 內建 node:sqlite，免編譯）。
// 日後改接 PostgreSQL/MySQL 時，只需替換本檔提供的函式。
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'platform.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS participants (
  participant_id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  consent_at TEXT,
  demographics TEXT,
  state TEXT,
  device_type TEXT,
  status TEXT DEFAULT 'active',
  pretest_score REAL,
  posttest_score REAL,
  completed_at TEXT,
  is_simulated INTEGER DEFAULT 0,
  resume_code TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  last_seen TEXT,
  device_type TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  client_ts TEXT,
  event_type TEXT NOT NULL,
  module_id TEXT,
  item_id TEXT,
  response TEXT,
  correct INTEGER,
  attempt_count INTEGER,
  time_on_task REAL,
  feedback_viewed INTEGER,
  ai_question TEXT,
  ai_question_category TEXT,
  ai_response_viewed INTEGER,
  module_completion INTEGER,
  pretest_score REAL,
  posttest_score REAL,
  extra TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_pid ON events(participant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE TABLE IF NOT EXISTS test_responses (
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  item_id TEXT NOT NULL,
  response INTEGER,
  correct INTEGER,
  time_on_task REAL,
  answered_at TEXT,
  PRIMARY KEY (participant_id, phase, item_id)
);
CREATE TABLE IF NOT EXISTS ai_interactions (
  interaction_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  session_id TEXT,
  module_id TEXT,
  question TEXT,
  category TEXT,
  guardrail TEXT,
  provider TEXT,
  response TEXT,
  response_viewed INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS questionnaires (
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  item_id TEXT NOT NULL,
  value TEXT,
  created_at TEXT,
  PRIMARY KEY (participant_id, instrument, item_id)
);
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','researcher')),
  display_name TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  sid TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  action TEXT,
  detail TEXT,
  at TEXT
);
`);

// 舊資料庫升級：補欄位
try { db.exec('ALTER TABLE participants ADD COLUMN resume_code TEXT'); } catch { /* 已存在 */ }

const now = () => new Date().toISOString();

function all(sql, ...p) { return db.prepare(sql).all(...p); }
function get(sql, ...p) { return db.prepare(sql).get(...p); }
function run(sql, ...p) { return db.prepare(sql).run(...p); }
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const EVENT_COLS = ['event_id', 'participant_id', 'session_id', 'timestamp', 'client_ts', 'event_type', 'module_id', 'item_id',
  'response', 'correct', 'attempt_count', 'time_on_task', 'feedback_viewed', 'ai_question', 'ai_question_category',
  'ai_response_viewed', 'module_completion', 'pretest_score', 'posttest_score', 'extra'];
const insertEventStmt = db.prepare(`INSERT INTO events (${EVENT_COLS.join(',')}) VALUES (${EVENT_COLS.map(() => '?').join(',')})`);

function insertEvent(e) {
  const v = EVENT_COLS.map(c => {
    const x = e[c];
    if (x === undefined) return null;
    if (typeof x === 'boolean') return x ? 1 : 0;
    if (x !== null && typeof x === 'object') return JSON.stringify(x);
    return x;
  });
  insertEventStmt.run(...v);
}

function audit(username, action, detail) {
  run('INSERT INTO audit_log (username, action, detail, at) VALUES (?,?,?,?)', username || null, action, detail ? String(detail).slice(0, 2000) : null, now());
}

module.exports = { db, all, get, run, tx, now, insertEvent, audit, EVENT_COLS, DATA_DIR, DB_PATH };
