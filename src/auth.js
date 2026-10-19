// 研究者／管理者登入：scrypt 雜湊、HttpOnly Cookie Session、登入節流
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { get, run, all, now, audit } = require('./db');

const COOKIE = 'dm_admin_sid';
const SESSION_HOURS = 8;

function hash(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
function verify(pw, stored) {
  const [alg, saltHex, hHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hHex, 'hex'));
}

function validPassword(pw) { return typeof pw === 'string' && pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw); }

function createUser(username, password, role, displayName) {
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) { const e = new Error('帳號限英數字、底線、點、減號，3–32 字'); e.status = 400; throw e; }
  if (!validPassword(password)) { const e = new Error('密碼至少 10 碼，且需同時包含英文字母與數字'); e.status = 400; throw e; }
  if (!['admin', 'researcher'].includes(role)) { const e = new Error('角色錯誤'); e.status = 400; throw e; }
  if (get('SELECT 1 FROM users WHERE username = ?', username)) { const e = new Error('帳號已存在'); e.status = 409; throw e; }
  run('INSERT INTO users (username, pass_hash, role, display_name, created_at) VALUES (?,?,?,?,?)', username, hash(password), role, displayName || username, now());
}

// 首次啟動：若無任何帳號，建立 admin。密碼取環境變數，否則隨機產生並寫入部署資料夾外的備忘檔
function ensureBootstrapAdmin() {
  if (get('SELECT COUNT(*) n FROM users').n > 0) return;
  const user = process.env.ADMIN_USER || 'admin';
  let pw = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!pw || !validPassword(pw)) { pw = 'Dm' + crypto.randomBytes(9).toString('base64url') + '7'; generated = true; }
  createUser(user, pw, 'admin', '系統管理者');
  audit('system', 'bootstrap_admin', user);
  if (generated) {
    const memo = path.join(typeof __dirname === 'string' ? __dirname : process.cwd(), '..', '..', '..', '_帳密備忘_勿上傳.md'); // 專案根目錄（F:/專案_北醫專案）
    const line = `\n## 糖尿病衛教平台 後臺管理者（${new Date().toLocaleString('zh-TW')} 自動產生）\n- 網址：/admin\n- 帳號：${user}\n- 密碼：${pw}\n- 首次登入後請至「帳號管理」修改密碼。\n`;
    try { fs.appendFileSync(memo, line, 'utf8'); console.log(`[auth] 已建立管理者帳號「${user}」，初始密碼已寫入：${memo}`); }
    catch { console.log(`[auth] 已建立管理者帳號「${user}」，備忘檔無法寫入`); }
    // 雲端主機（如 Render）看不到備忘檔：只在主控台紀錄（僅帳號擁有者可見）顯示一次
    if (process.env.RENDER) console.log(`[auth] 初始密碼：${pw}（請登入後立即修改）`);
  }
}

// 登入失敗節流：每 IP 15 分鐘最多 8 次
const attempts = new Map();
function throttled(ip) {
  const a = attempts.get(ip); const t = Date.now();
  if (!a || t - a.first > 15 * 60e3) return false;
  return a.count >= 8;
}
function fail(ip) {
  const a = attempts.get(ip); const t = Date.now();
  if (!a || t - a.first > 15 * 60e3) attempts.set(ip, { first: t, count: 1 }); else a.count++;
}

function login(username, password, ip) {
  if (throttled(ip)) { const e = new Error('登入失敗次數過多，請 15 分鐘後再試'); e.status = 429; throw e; }
  const u = get('SELECT * FROM users WHERE username = ? AND active = 1', String(username || ''));
  if (!u || !verify(String(password || ''), u.pass_hash)) { fail(ip); audit(username, 'login_failed', ip); const e = new Error('帳號或密碼錯誤'); e.status = 401; throw e; }
  attempts.delete(ip);
  const sid = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO admin_sessions (sid, username, expires_at) VALUES (?,?,?)', sid, u.username, Date.now() + SESSION_HOURS * 3600e3);
  run('UPDATE users SET last_login = ? WHERE username = ?', now(), u.username);
  run('DELETE FROM admin_sessions WHERE expires_at < ?', Date.now());
  audit(u.username, 'login', ip);
  return { sid, user: { username: u.username, role: u.role, display_name: u.display_name } };
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(sid, maxAgeSec) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

function currentUser(req) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;
  const s = get('SELECT s.sid, s.expires_at, u.username, u.role, u.display_name, u.active FROM admin_sessions s JOIN users u ON u.username = s.username WHERE s.sid = ?', sid);
  if (!s || s.expires_at < Date.now() || !s.active) return null;
  return { sid: s.sid, username: s.username, role: s.role, display_name: s.display_name };
}

function requireRole(...roles) {
  return (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: '請先登入研究者後臺' });
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: '權限不足' });
    req.user = u; next();
  };
}

function logout(req) {
  const sid = parseCookies(req)[COOKIE];
  if (sid) run('DELETE FROM admin_sessions WHERE sid = ?', sid);
}

function listUsers() { return all('SELECT username, role, display_name, active, created_at, last_login FROM users ORDER BY created_at'); }
function setPassword(username, pw) {
  if (!validPassword(pw)) { const e = new Error('密碼至少 10 碼，且需同時包含英文字母與數字'); e.status = 400; throw e; }
  run('UPDATE users SET pass_hash = ? WHERE username = ?', hash(pw), username);
  run('DELETE FROM admin_sessions WHERE username = ?', username);
}

module.exports = { COOKIE, ensureBootstrapAdmin, login, logout, currentUser, requireRole, cookieHeader, createUser, listUsers, setPassword, verify, validPassword };
