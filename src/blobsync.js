// Netlify Blobs 同步層（STORAGE=blobs）
// 每次請求：從 Blobs 載入「這次需要的資料」到記憶體 SQLite → 原本的路由／統計程式照常執行 → 只把有變動的資料寫回。
// 寫回使用條件寫入（onlyIfMatch / onlyIfNew），若同一位受試者同時有兩個請求，後者偵測到衝突會整個重跑，不會互相覆蓋。
//
// Blob 鍵值：
//   p/<participant_id>   受試者完整資料包（基本資料、session、事件、作答、AI 紀錄、問卷）
//   t/<sha256(token)>    受試者 token → participant_id 索引
//   u/<username>         研究者／管理者帳號（密碼為 scrypt 雜湊）
//   s/<sid>              研究者登入 session
//   a/<時間>_<id>_<亂數>  操作稽核紀錄（只新增）
//   content/current、content/backup/<stamp>   後臺修改後的衛教內容與備份
//   v/<臺灣日期>/<訪客id>  每日瀏覽人次（匿名訪客，每人每天一筆）
const crypto = require('crypto');
const { db, all, twDay } = require('./db');
const content = require('./content');
const auth = require('./auth');

const P_TABLES = ['participants', 'sessions', 'events', 'test_responses', 'ai_interactions', 'questionnaires', 'test_retakes'];
const ALL_TABLES = [...P_TABLES, 'users', 'admin_sessions', 'audit_log', 'visits'];
const PID_RE = /^[A-Za-z0-9_-]{3,24}$/;
const colsCache = {};
const cols = t => (colsCache[t] = colsCache[t] || all(`PRAGMA table_info(${t})`).map(c => c.name));
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

class ConflictError extends Error { constructor(key) { super('blob conflict: ' + key); this.code = 'CONFLICT'; } }

let S = null;

function clearAll() {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of ALL_TABLES) db.exec(`DELETE FROM ${t}`);
  db.exec('PRAGMA foreign_keys = ON');
}
function insertRows(t, rows) {
  if (!rows || !rows.length) return;
  const c = cols(t);
  const st = db.prepare(`INSERT INTO ${t} (${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`);
  for (const r of rows) st.run(...c.map(k => (r[k] === undefined ? null : r[k])));
}
function normJSON(data) { const o = {}; for (const t of P_TABLES) o[t] = data[t] || []; return JSON.stringify(o); }
function bundle(pid) {
  const b = {};
  for (const t of P_TABLES) b[t] = all(`SELECT * FROM ${t} WHERE participant_id = ? ORDER BY rowid`, pid);
  return b;
}

async function getJSON(key) {
  const r = await S.store.getWithMetadata(key, { type: 'json' });
  return r ? { data: r.data, etag: r.etag } : null;
}
async function listKeys(prefix) {
  const out = [];
  for await (const page of S.store.list({ prefix, paginate: true })) for (const b of page.blobs) out.push(b.key);
  return out;
}
async function parallel(items, fn, n = 16) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

async function loadParticipant(pid) {
  if (!PID_RE.test(String(pid || ''))) return null;
  const key = 'p/' + pid;
  if (S.loaded.has(key)) return pid;
  const r = await getJSON(key);
  if (!r) return null;
  for (const t of P_TABLES) insertRows(t, r.data[t]);
  S.loaded.set(key, { etag: r.etag, json: normJSON(r.data), token: r.data.participants?.[0]?.token });
  return pid;
}

async function loadAllParticipants() {
  const keys = (await listKeys('p/')).filter(k => !S.loaded.has(k));
  const recs = await parallel(keys, k => getJSON(k));
  keys.forEach((k, i) => {
    const r = recs[i]; if (!r) return;
    for (const t of P_TABLES) insertRows(t, r.data[t]);
    S.loaded.set(k, { etag: r.etag, json: normJSON(r.data), token: r.data.participants?.[0]?.token });
  });
}

// 只需要「已存在的研究編號」時（新增受試者），插入不寫回的佔位列
async function loadParticipantStubs() {
  for (const k of await listKeys('p/')) {
    const pid = k.slice(2);
    insertRows('participants', [{ participant_id: pid, token: 'stub:' + pid, created_at: '' }]);
    S.stubs.add(pid);
  }
}

async function loadKeyed(prefix, table) {
  const keys = await listKeys(prefix);
  const recs = await parallel(keys, k => getJSON(k));
  keys.forEach((k, i) => { const r = recs[i]; if (!r) return; insertRows(table, [r.data]); S.loaded.set(k, { etag: r.etag, json: JSON.stringify(r.data) }); });
}

async function begin(store, req) {
  clearAll();
  content.setOverride(null);
  content.takePendingSave();
  S = { store, loaded: new Map(), stubs: new Set(), auditMax: 0 };
  const path = req.path;
  // 衛教內容覆寫與受試者索引並行讀取，減少每次請求的等待
  const token = path.startsWith('/api/p/') ? req.headers['x-participant-token'] : null;
  const [co, idx] = await Promise.all([
    store.get('content/current', { type: 'json' }),
    token ? store.get('t/' + sha(token), { type: 'json' }) : null
  ]);
  if (co) content.setOverride(co);

  if (path.startsWith('/api/admin')) {
    await loadKeyed('u/', 'users');
    await loadKeyed('s/', 'admin_sessions');
    // 首次部署：沒有任何帳號時，以環境變數 ADMIN_PASSWORD 建立 admin（不在程式碼中保存密碼）
    if (!all('SELECT 1 FROM users LIMIT 1').length && auth.validPassword(process.env.ADMIN_PASSWORD || '')) {
      auth.createUser(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASSWORD, 'admin', '系統管理者');
    }
    const needsData = !/^\/api\/admin\/(login|logout|me|users|audit)(\/|$)/.test(path) || /^\/api\/admin\/me\/password/.test(path);
    if (needsData) await loadAllParticipants();
    if (path === '/api/admin/dashboard' || path === '/api/admin/simulated') await loadKeyed('v/', 'visits'); // 清除模擬資料時一併刪除 SIMV 瀏覽紀錄
    if (path.startsWith('/api/admin/audit')) {
      const keys = (await listKeys('a/')).sort().slice(-300);
      const recs = await parallel(keys, k => getJSON(k));
      insertRows('audit_log', recs.filter(Boolean).map(r => r.data));
    }
    if (path === '/api/admin/content') content.setBlobBackups((await listKeys('content/backup/')).map(k => k.slice('content/backup/'.length)));
  } else if (path === '/api/visit') {
    const vid = String(req.body?.vid || '');
    if (/^[A-Za-z0-9_-]{8,40}$/.test(vid)) {
      const key = `v/${twDay()}/${vid}`;
      const r = await getJSON(key);
      if (r) { insertRows('visits', [r.data]); S.loaded.set(key, { etag: r.etag, json: JSON.stringify(r.data) }); }
    }
  } else if (path === '/api/p/compare') {
    if (idx?.pid) await loadParticipant(idx.pid);
    await loadAllParticipants();
  } else if (path === '/api/p/start') {
    await loadParticipantStubs();
  } else if (path === '/api/p/recover') {
    await loadParticipant(req.body?.participant_id);
  } else if (path.startsWith('/api/p/')) {
    if (idx?.pid) await loadParticipant(idx.pid);
  }
  S.auditMax = all('SELECT COALESCE(MAX(id), 0) m FROM audit_log')[0].m;
}

async function write(key, value, prev) {
  const r = prev ? await S.store.setJSON(key, value, { onlyIfMatch: prev.etag }) : await S.store.setJSON(key, value, { onlyIfNew: true });
  if (r && r.modified === false) throw new ConflictError(key);
}

async function commit() {
  const cur = new Map();
  const newTokens = [];
  for (const { participant_id: pid, token } of all('SELECT participant_id, token FROM participants')) {
    if (S.stubs.has(pid)) continue;
    const key = 'p/' + pid;
    cur.set(key, bundle(pid));
    if (!S.loaded.has(key)) newTokens.push({ token, pid });
  }
  for (const u of all('SELECT * FROM users')) cur.set('u/' + u.username, u);
  for (const s of all('SELECT * FROM admin_sessions')) cur.set('s/' + s.sid, s);
  for (const v of all('SELECT * FROM visits')) cur.set(`v/${v.day}/${v.visitor_id}`, v);

  // 新受試者先佔用研究編號（onlyIfNew），撞號時整個請求重跑、取下一個編號
  const ops = [];
  for (const [key, val] of cur) {
    const prev = S.loaded.get(key);
    if (prev && prev.json === JSON.stringify(val)) continue;
    ops.push(write(key, val, prev));
  }
  await Promise.all(ops);
  await Promise.all(newTokens.map(({ token, pid }) => S.store.setJSON('t/' + sha(token), { pid })));

  // 刪除：受試者撤回／清除模擬資料、帳號、過期 session
  const dels = [];
  for (const [key, prev] of S.loaded) {
    if (cur.has(key)) continue;
    dels.push(S.store.delete(key));
    if (key.startsWith('p/') && prev.token) dels.push(S.store.delete('t/' + sha(prev.token)));
  }
  await Promise.all(dels);

  const audits = all('SELECT * FROM audit_log WHERE id > ? ORDER BY id', S.auditMax);
  await Promise.all(audits.map(a => S.store.setJSON(`a/${a.at}_${String(a.id).padStart(6, '0')}_${crypto.randomBytes(3).toString('hex')}`, a)));

  const cs = content.takePendingSave();
  if (cs) {
    await S.store.setJSON('content/backup/content_' + cs.stamp + '.json', cs.prev);
    await S.store.setJSON('content/current', cs.next);
  }
}

module.exports = { begin, commit, ConflictError };
