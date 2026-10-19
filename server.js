// 生成式 AI 智慧助理輔助之成年人糖尿病互動衛教平台 — 伺服器
const path = require('path');
const fs = require('fs');
const HERE = typeof __dirname === 'string' ? __dirname : process.cwd(); // 被打包進 Netlify 函式時沒有 __dirname
const express = require('express');
const { get, run, all, audit, DB_PATH } = require('./src/db');
const content = require('./src/content');
const P = require('./src/participant');
const auth = require('./src/auth');
const stats = require('./src/stats');
const exporter = require('./src/exporter');
const sim = require('./src/simulate');
const aiSvc = require('./src/ai');
const settingsSvc = require('./src/settings');
const formsExport = require('./src/formsexport');

const app = express();
const PORT = Number(process.env.PORT || 3100);
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.use(express.json({ limit: '2mb' }));

// 安全標頭
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

// 跨網域（前端放 GitHub Pages、後端放 Render）：只對白名單網域開放「受試者 API」；研究者後臺 API 一律不開放
// ALLOWED_ORIGINS=https://chatgpt3a01.github.io,http://localhost:8080（逗號分隔）
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean));
app.use(['/api/p', '/api/content', '/api/health', '/api/visit'], (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Participant-Token, X-Session-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && ALLOWED_ORIGINS.has(origin) ? 204 : 403);
  next();
});

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const deviceOf = ua => /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua || '') ? 'tablet' : /Mobi|iPhone|Android/i.test(ua || '') ? 'mobile' : 'desktop';

// ===================== 受試者 API =====================
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), ai: aiSvc.providerInfo().provider }));
app.get('/api/content', (req, res) => res.json(content.publicContent()));

// 每日瀏覽人次：首頁載入時送出匿名訪客 id（存在瀏覽器 localStorage，與受試者編號無關）
app.post('/api/visit', (req, res) => {
  P.recordVisit(req.body?.vid);
  res.json({ ok: true });
});

// 登入（建立編號）：研究說明與同意書改為現場紙本，平台不再顯示同意頁
app.post('/api/p/start', (req, res, next) => {
  try {
    const ua = req.headers['user-agent'];
    const deviceType = ['mobile', 'tablet', 'desktop'].includes(req.body.device_type) ? req.body.device_type : deviceOf(ua);
    const r = P.createParticipant({ code: req.body.code, deviceType, userAgent: ua });
    res.json(r);
  } catch (e) { next(e); }
});

// 以「研究編號＋繼續碼」換回 token（換裝置或清除瀏覽器後繼續）
const resumeTries = new Map();
app.post('/api/p/recover', (req, res) => {
  const ip = req.ip; const t = Date.now(); const a = resumeTries.get(ip);
  if (a && t - a.first < 15 * 60e3 && a.count >= 10) return res.status(429).json({ error: '嘗試次數過多，請 15 分鐘後再試' });
  const p = P.byResumeCode(req.body?.participant_id, req.body?.resume_code);
  if (!p) {
    if (!a || t - a.first > 15 * 60e3) resumeTries.set(ip, { first: t, count: 1 }); else a.count++;
    return res.status(404).json({ error: '研究編號或繼續碼不正確' });
  }
  res.json({ token: p.token, participant_id: p.participant_id });
});

// 以 token 驗證受試者；每位受試者只能存取自己的資料
function participantAuth(req, res, next) {
  const p = P.byToken(req.get('X-Participant-Token'));
  if (!p) return res.status(401).json({ error: '找不到您的學習紀錄，請重新開始或輸入繼續碼' });
  if (p.status === 'withdrawn') return res.status(403).json({ error: '此研究編號已撤回' });
  req.p = p;
  const sid = req.get('X-Session-Id');
  req.sid = sid && P.sessionBelongs(p.participant_id, sid) ? sid : null;
  next();
}

app.post('/api/p/resume', participantAuth, (req, res) => {
  const ua = req.headers['user-agent'];
  const deviceType = ['mobile', 'tablet', 'desktop'].includes(req.body?.device_type) ? req.body.device_type : deviceOf(ua);
  const session_id = req.sid || P.startSession(req.p.participant_id, deviceType, ua);
  const done = all("SELECT DISTINCT module_id FROM events WHERE participant_id = ? AND event_type = 'module_completed'", req.p.participant_id).map(r => r.module_id);
  const answered = all('SELECT phase, item_id, response FROM test_responses WHERE participant_id = ?', req.p.participant_id);
  res.json({
    participant_id: req.p.participant_id, resume_code: req.p.resume_code, session_id, state: JSON.parse(req.p.state || '{}'),
    modules_completed: done, has_demographics: !!req.p.demographics,
    pretest_done: req.p.pretest_score != null, posttest_done: req.p.posttest_score != null,
    pretest_score: req.p.pretest_score, posttest_score: req.p.posttest_score,
    surveys_done: P.surveysDone(req.p.participant_id),
    completed: !!req.p.completed_at, answered
  });
});

app.post('/api/p/state', participantAuth, (req, res) => {
  const s = JSON.stringify(req.body?.state || {});
  if (s.length > 20000) return res.status(413).json({ error: 'state too large' });
  run('UPDATE participants SET state = ? WHERE participant_id = ?', s, req.p.participant_id);
  res.json({ ok: true });
});

app.post('/api/p/demographics', participantAuth, (req, res) => {
  res.json({ ok: true, demographics: P.saveDemographics(req.p.participant_id, req.sid, req.body?.answers) });
});

app.post('/api/p/events', participantAuth, (req, res, next) => {
  try {
    const list = Array.isArray(req.body?.events) ? req.body.events.slice(0, 200) : [];
    const ids = []; const errors = [];
    for (const e of list) {
      try { ids.push(P.logEvent(req.p.participant_id, req.sid, e)); } catch (err) { errors.push(err.message); }
    }
    res.json({ ok: true, saved: ids.length, errors });
  } catch (e) { next(e); }
});

app.post('/api/p/test/answer', participantAuth, (req, res) => {
  P.recordTestAnswer(req.p.participant_id, req.sid, req.body || {});
  res.json({ ok: true }); // 不回傳正誤，避免干擾
});

app.post('/api/p/test/complete', participantAuth, (req, res) => {
  const phase = req.body?.phase;
  const s = P.completeTest(req.p.participant_id, req.sid, phase);
  // 依專題需求：前測、後測完成後都顯示分數（不顯示逐題正誤，避免影響後測）
  const pre = phase === 'post' ? get('SELECT pretest_score v FROM participants WHERE participant_id = ?', req.p.participant_id).v : null;
  res.json({ ok: true, score: s.score, n_correct: s.nCorrect, total: s.total, pretest_score: pre });
});

// 完成全部學習後可再測知識測驗（不覆蓋正式後測）
app.post('/api/p/test/retake', participantAuth, (req, res) => {
  res.json(P.retakeTest(req.p.participant_id, req.sid, req.body || {}));
});

// AI 設定（受試者端）：是否開放自備金鑰、目前引擎名稱；不含任何金鑰
app.get('/api/p/ai/config', participantAuth, (req, res) => res.json(aiSvc.publicConfig()));

app.post('/api/p/ai', participantAuth, wrap(async (req, res) => {
  // byok＝受試者自備金鑰（後臺開放時才會使用），只用於這次請求，不寫入資料庫
  const b = req.body?.byok;
  const byok = b && typeof b === 'object' ? { provider: String(b.provider || ''), model: String(b.model || ''), key: String(b.key || '') } : null;
  const r = await P.askAI(req.p.participant_id, req.sid, { question: req.body?.question, module_id: req.body?.module_id, byok });
  res.json(r);
}));

app.post('/api/p/ai/viewed', participantAuth, (req, res) => {
  P.markAIViewed(req.p.participant_id, req.sid, req.body?.interaction_id, Number(req.body?.time_on_task) || null);
  res.json({ ok: true });
});

app.post('/api/p/survey', participantAuth, (req, res) => {
  P.saveSurvey(req.p.participant_id, req.sid, req.body?.survey, req.body?.answers || {});
  res.json({ ok: true, surveys_done: P.surveysDone(req.p.participant_id) });
});

app.post('/api/p/complete', participantAuth, (req, res) => {
  P.completeSession(req.p.participant_id, req.sid);
  res.json({ ok: true, summary: P.learningSummary(req.p.participant_id) });
});

app.get('/api/p/summary', participantAuth, (req, res) => {
  if (req.p.posttest_score == null) return res.status(403).json({ error: '完成後測後才能查看學習成果' });
  res.json(P.learningSummary(req.p.participant_id));
});

// 學習成果頁的「我 vs 大家」比較趨勢圖（只回傳群體平均，不含任何個人資料）
app.get('/api/p/compare', participantAuth, (req, res) => {
  if (req.p.posttest_score == null) return res.status(403).json({ error: '完成後測後才能查看比較' });
  res.json(P.groupComparison(req.p.participant_id));
});

// ===================== 研究者／管理者 API =====================
app.post('/api/admin/login', (req, res, next) => {
  try {
    const r = auth.login(req.body?.username, req.body?.password, req.ip);
    res.setHeader('Set-Cookie', auth.cookieHeader(r.sid, 8 * 3600));
    res.json({ user: r.user });
  } catch (e) { next(e); }
});
app.post('/api/admin/logout', (req, res) => {
  const u = auth.currentUser(req); auth.logout(req);
  if (u) audit(u.username, 'logout');
  res.setHeader('Set-Cookie', auth.cookieHeader('', 0));
  res.json({ ok: true });
});
app.get('/api/admin/me', auth.requireRole(), (req, res) => res.json({ user: req.user }));

const R_ANY = auth.requireRole('admin', 'researcher');
const R_ADMIN = auth.requireRole('admin');
const incSim = req => req.query.include_sim !== '0';

app.get('/api/admin/dashboard', R_ANY, (req, res) => res.json(stats.dashboard(incSim(req))));
app.get('/api/admin/ai-keywords', R_ANY, (req, res) => res.json(stats.aiKeywords(incSim(req))));
app.get('/api/admin/lsa', R_ANY, (req, res) => res.json(stats.lagSequential(incSim(req), { module: req.query.module || '', scope: req.query.scope || 'all' })));
app.get('/api/admin/participants', R_ANY, (req, res) => res.json(stats.participantList(incSim(req))));
app.get('/api/admin/participants/:id', R_ANY, (req, res) => {
  const d = stats.participantDetail(req.params.id);
  if (!d) return res.status(404).json({ error: '找不到受試者' });
  audit(req.user.username, 'view_participant', req.params.id);
  res.json(d);
});
app.get('/api/admin/content-full', R_ANY, (req, res) => res.json(content.load()));

app.get('/api/admin/export/:name', R_ANY, wrap(async (req, res) => {
  const name = req.params.name;
  const sim = incSim(req);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  audit(req.user.username, 'export', `${name} include_sim=${sim}`);
  if (name === 'all.xlsx') {
    const buf = await exporter.toXLSX(sim);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dm_research_${stamp}.xlsx"`);
    return res.send(Buffer.from(buf));
  }
  if (name === 'google-forms.gs') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="google_forms_${stamp}.gs"`);
    return res.send(formsExport.buildAppsScript());
  }
  const m = /^([a-z_]+)\.csv$/.exec(name);
  if (!m || !exporter.TABLES.includes(m[1])) return res.status(404).json({ error: '未知的資料表' });
  const rows = stats.exportTables(sim)[m[1]];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${m[1]}_${stamp}.csv"`);
  res.send(exporter.toCSV(rows));
}));

// --- 管理者功能 ---
app.get('/api/admin/users', R_ADMIN, (req, res) => res.json(auth.listUsers()));
app.post('/api/admin/users', R_ADMIN, (req, res) => {
  const { username, password, role, display_name } = req.body || {};
  auth.createUser(username, password, role, display_name);
  audit(req.user.username, 'create_user', `${username} (${role})`);
  res.json({ ok: true });
});
app.patch('/api/admin/users/:u', R_ADMIN, (req, res) => {
  const u = req.params.u;
  if (!get('SELECT 1 FROM users WHERE username = ?', u)) return res.status(404).json({ error: '帳號不存在' });
  const { active, role, password } = req.body || {};
  if (u === req.user.username && (active === false || (role && role !== 'admin'))) return res.status(400).json({ error: '不能停用或降級自己的帳號' });
  if (typeof active === 'boolean') { run('UPDATE users SET active = ? WHERE username = ?', active ? 1 : 0, u); if (!active) run('DELETE FROM admin_sessions WHERE username = ?', u); }
  if (role) { if (!['admin', 'researcher'].includes(role)) return res.status(400).json({ error: '角色錯誤' }); run('UPDATE users SET role = ? WHERE username = ?', role, u); }
  if (password) auth.setPassword(u, password);
  audit(req.user.username, 'update_user', `${u} ${JSON.stringify({ active, role, password: password ? '***' : undefined })}`);
  res.json({ ok: true });
});
app.delete('/api/admin/users/:u', R_ADMIN, (req, res) => {
  const u = req.params.u;
  if (u === req.user.username) return res.status(400).json({ error: '不能刪除自己的帳號' });
  const r = run('DELETE FROM users WHERE username = ?', u);
  if (!r.changes) return res.status(404).json({ error: '帳號不存在' });
  audit(req.user.username, 'delete_user', u);
  res.json({ ok: true });
});
// 任何登入者可改自己的密碼
app.post('/api/admin/me/password', R_ANY, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const u = get('SELECT pass_hash FROM users WHERE username = ?', req.user.username);
  if (!auth.verify(String(old_password || ''), u.pass_hash)) return res.status(400).json({ error: '目前密碼不正確' });
  auth.setPassword(req.user.username, new_password);
  audit(req.user.username, 'change_own_password');
  res.setHeader('Set-Cookie', auth.cookieHeader('', 0));
  res.json({ ok: true });
});

app.post('/api/admin/simulate', R_ADMIN, wrap(async (req, res) => {
  const n = Math.max(1, Math.min(200, Number(req.body?.n) || 30));
  const ids = await sim.simulate(n);
  audit(req.user.username, 'simulate', `${n}`);
  res.json({ ok: true, created: ids.length });
}));
app.delete('/api/admin/simulated', R_ADMIN, (req, res) => {
  const n = sim.clearSimulated();
  audit(req.user.username, 'clear_simulated', `${n}`);
  res.json({ ok: true, deleted: n });
});
// 受試者撤回：刪除其所有資料
app.delete('/api/admin/participants/:id', R_ADMIN, (req, res) => {
  const r = run('DELETE FROM participants WHERE participant_id = ?', req.params.id);
  audit(req.user.username, 'delete_participant', req.params.id);
  res.json({ ok: true, deleted: r.changes });
});

app.get('/api/admin/content', R_ADMIN, (req, res) => res.json({ content: content.load(), backups: content.listBackups().slice(0, 20) }));
app.put('/api/admin/content', R_ADMIN, (req, res) => {
  const stamp = content.save(req.body?.content);
  audit(req.user.username, 'update_content', `backup ${stamp}`);
  res.json({ ok: true, backup: stamp });
});

// AI 設定（研究者後臺）：引擎、模型、金鑰（遮罩）、是否開放受試者自備金鑰
app.get('/api/admin/ai-settings', R_ADMIN, (req, res) => res.json({ settings: settingsSvc.publicView(), options: aiSvc.MODEL_OPTIONS, labels: aiSvc.PROVIDER_LABEL, current: aiSvc.providerInfo() }));
app.put('/api/admin/ai-settings', R_ADMIN, (req, res) => {
  const body = req.body || {};
  const v = settingsSvc.save(body, req.user.username);
  const changedKeys = Object.entries(body.keys || {}).filter(([, k]) => k === null || (typeof k === 'string' && k.trim())).map(([p, k]) => `${p}:${k === null ? '清除' : '更新'}`);
  audit(req.user.username, 'update_ai_settings', `provider=${v.provider} allowUserKey=${v.allowUserKey}${changedKeys.length ? ' keys=' + changedKeys.join(',') : ''}`);
  res.json({ settings: v, current: aiSvc.providerInfo() });
});
app.post('/api/admin/ai-test', R_ADMIN, wrap(async (req, res) => {
  const r = await aiSvc.testEngine(req.body || null);
  audit(req.user.username, 'test_ai', `${r.engine || ''} ok=${r.ok}`);
  res.json(r);
}));

app.get('/api/admin/system', R_ADMIN, (req, res) => {
  res.json({
    ai: aiSvc.providerInfo(),
    ai_options: aiSvc.MODEL_OPTIONS,
    db: { path: DB_PATH, participants: get('SELECT COUNT(*) n FROM participants').n, events: get('SELECT COUNT(*) n FROM events').n },
    node: process.version
  });
});
app.get('/api/admin/audit', R_ADMIN, (req, res) => res.json(all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300')));

// ===================== 靜態檔 =====================
app.use('/vendor/chart.umd.js', (req, res) => res.sendFile(path.join(HERE, 'node_modules', 'chart.js', 'dist', fs.existsSync(path.join(HERE, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js')) ? 'chart.umd.min.js' : 'chart.umd.js')));
app.use('/admin', express.static(path.join(HERE, 'public', 'admin'), { index: 'index.html' }));
app.use(express.static(path.join(HERE, 'public'), {
  setHeaders: (res, fp) => { if (fp.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(HERE, 'public', 'index.html')));

// 錯誤處理
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? '伺服器發生錯誤，請稍後再試' : err.message });
});

if (process.env.STORAGE !== 'blobs') auth.ensureBootstrapAdmin(); // Netlify 版由 blobsync 在載入帳號後處理
if (require.main === module) {
  app.listen(PORT, () => console.log(`[server] 糖尿病互動衛教平台 http://localhost:${PORT}  研究者後臺 http://localhost:${PORT}/admin  AI=${aiSvc.providerInfo().provider}`));
}
module.exports = app;
