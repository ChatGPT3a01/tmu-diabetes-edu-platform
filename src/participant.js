// 受試者端核心邏輯（路由與模擬資料共用，確保兩者產生的資料格式一致）
const crypto = require('crypto');
const { get, run, all, insertEvent, now } = require('./db');
const content = require('./content');
const aiSvc = require('./ai');

const EVENT_TYPES = new Set([
  'consent_completed', 'pretest_started', 'pretest_answer', 'pretest_completed', 'module_started', 'content_viewed',
  'question_answered', 'feedback_viewed', 'ai_question_submitted', 'ai_response_viewed', 'module_completed',
  'posttest_started', 'posttest_answer', 'posttest_completed', 'questionnaire_completed', 'session_completed',
  // 擴充事件
  'session_started', 'demographics_completed', 'page_view', 'widget_interaction', 'font_size_changed', 'tts_used'
]);
// 只允許由伺服器端產生的事件（避免前端偽造分數）
const SERVER_ONLY = new Set(['consent_completed', 'pretest_answer', 'pretest_completed', 'posttest_answer', 'posttest_completed',
  'ai_question_submitted', 'questionnaire_completed', 'session_completed', 'demographics_completed']);

const uid = () => crypto.randomUUID();

function nextParticipantId() {
  const rows = all("SELECT participant_id FROM participants WHERE participant_id LIKE 'P%'");
  let max = 0;
  for (const r of rows) { const m = /^P(\d+)$/.exec(r.participant_id); if (m) max = Math.max(max, Number(m[1])); }
  return 'P' + String(max + 1).padStart(4, '0');
}

const CODE_RE = /^[A-Za-z0-9_-]{3,24}$/;

function createParticipant({ code, deviceType, userAgent, isSimulated = 0, ts }) {
  const t = ts || now();
  let pid = (code || '').trim();
  if (pid) {
    if (!CODE_RE.test(pid)) { const e = new Error('研究編號格式不正確（限英數字、- 或 _，3–24 字）'); e.status = 400; throw e; }
    if (get('SELECT 1 FROM participants WHERE participant_id = ?', pid)) { const e = new Error('此研究編號已被使用，若是您本人請用「繼續上次進度」'); e.status = 409; throw e; }
  } else pid = nextParticipantId();
  const token = crypto.randomBytes(24).toString('base64url');
  const resume_code = makeResumeCode();
  run('INSERT INTO participants (participant_id, token, created_at, consent_at, device_type, is_simulated, state, resume_code) VALUES (?,?,?,?,?,?,?,?)',
    pid, token, t, t, deviceType || null, isSimulated ? 1 : 0, JSON.stringify({ stage: 'demographics' }), resume_code);
  const session_id = startSession(pid, deviceType, userAgent, t);
  logEvent(pid, session_id, { event_type: 'consent_completed', response: 'agree' }, t, true);
  return { participant_id: pid, token, session_id, resume_code };
}

// 繼續碼：6 碼、排除易混淆字元（0/O、1/I/L），長者容易抄寫；需搭配研究編號使用
const RC_ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function makeResumeCode() { let s = ''; const b = crypto.randomBytes(6); for (const x of b) s += RC_ALPHA[x % RC_ALPHA.length]; return s; }
function byResumeCode(pid, code) {
  if (!pid || !code) return null;
  return get('SELECT * FROM participants WHERE participant_id = ? AND resume_code = ?', String(pid).trim(), String(code).trim().toUpperCase().replace(/[^0-9A-Z]/g, ''));
}

function startSession(pid, deviceType, userAgent, ts) {
  const t = ts || now();
  const session_id = uid();
  run('INSERT INTO sessions (session_id, participant_id, started_at, last_seen, device_type, user_agent) VALUES (?,?,?,?,?,?)',
    session_id, pid, t, t, deviceType || null, (userAgent || '').slice(0, 300));
  insertEvent({ event_id: uid(), participant_id: pid, session_id, timestamp: t, event_type: 'session_started', extra: { device_type: deviceType } });
  return session_id;
}

function byToken(token) {
  if (!token || typeof token !== 'string') return null;
  return get('SELECT * FROM participants WHERE token = ?', token);
}

function sessionBelongs(pid, sid) {
  return !!get('SELECT 1 FROM sessions WHERE session_id = ? AND participant_id = ?', sid, pid);
}

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function bool(x) { return x === true || x === 1 || x === '1' ? 1 : x === false || x === 0 || x === '0' ? 0 : null; }

function logEvent(pid, sid, e, ts, server = false) {
  if (!EVENT_TYPES.has(e.event_type)) { const err = new Error('未知的 event_type：' + e.event_type); err.status = 400; throw err; }
  if (!server && SERVER_ONLY.has(e.event_type)) { const err = new Error('此事件只能由伺服器產生：' + e.event_type); err.status = 400; throw err; }
  const p = get('SELECT pretest_score, posttest_score FROM participants WHERE participant_id = ?', pid);
  const ev = {
    event_id: uid(), participant_id: pid, session_id: sid || null, timestamp: ts || now(),
    client_ts: typeof e.client_ts === 'string' ? e.client_ts.slice(0, 40) : null,
    event_type: e.event_type,
    module_id: e.module_id ? String(e.module_id).slice(0, 20) : null,
    item_id: e.item_id ? String(e.item_id).slice(0, 40) : null,
    response: e.response == null ? null : String(e.response).slice(0, 500),
    correct: bool(e.correct), attempt_count: num(e.attempt_count), time_on_task: num(e.time_on_task),
    feedback_viewed: bool(e.feedback_viewed),
    ai_question: e.ai_question ? String(e.ai_question).slice(0, 500) : null,
    ai_question_category: e.ai_question_category || null,
    ai_response_viewed: bool(e.ai_response_viewed), module_completion: bool(e.module_completion),
    pretest_score: e.pretest_score ?? p?.pretest_score ?? null,
    posttest_score: e.posttest_score ?? p?.posttest_score ?? null,
    extra: e.extra && typeof e.extra === 'object' ? JSON.stringify(e.extra).slice(0, 2000) : null
  };
  insertEvent(ev);
  if (sid) run('UPDATE sessions SET last_seen = ? WHERE session_id = ?', ev.timestamp, sid);
  return ev.event_id;
}

function saveDemographics(pid, sid, answers, ts) {
  const c = content.load();
  const clean = {};
  for (const d of c.demographics) {
    const v = answers?.[d.id];
    if (d.type === 'multi') clean[d.id] = Array.isArray(v) ? v.filter(x => d.options.includes(x)) : [];
    else clean[d.id] = d.options.includes(v) ? v : null;
  }
  run('UPDATE participants SET demographics = ? WHERE participant_id = ?', JSON.stringify(clean), pid);
  logEvent(pid, sid, { event_type: 'demographics_completed' }, ts, true);
  return clean;
}

function recordTestAnswer(pid, sid, { phase, item_id, response, time_on_task, attempt_count }, ts) {
  if (!['pre', 'post'].includes(phase)) { const e = new Error('phase 錯誤'); e.status = 400; throw e; }
  const c = content.load();
  const item = c.knowledgeTest.items.find(i => i.id === item_id);
  if (!item) { const e = new Error('題目不存在'); e.status = 400; throw e; }
  const p = get('SELECT pretest_score, posttest_score FROM participants WHERE participant_id = ?', pid);
  if (phase === 'pre' && p.pretest_score != null) { const e = new Error('前測已完成，無法修改'); e.status = 409; throw e; }
  if (phase === 'post' && p.posttest_score != null) { const e = new Error('後測已完成，無法修改'); e.status = 409; throw e; }
  const r = Number(response);
  const correct = r === item.answer ? 1 : 0;
  const t = ts || now();
  run(`INSERT INTO test_responses (participant_id, phase, item_id, response, correct, time_on_task, answered_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(participant_id, phase, item_id) DO UPDATE SET response=excluded.response, correct=excluded.correct, time_on_task=excluded.time_on_task, answered_at=excluded.answered_at`,
    pid, phase, item_id, r, correct, num(time_on_task), t);
  logEvent(pid, sid, { event_type: phase === 'pre' ? 'pretest_answer' : 'posttest_answer', module_id: item.domain, item_id, response: r, correct, time_on_task, attempt_count: attempt_count || 1 }, t, true);
  return correct;
}

function scoreTest(pid, phase) {
  const c = content.load();
  const rows = all('SELECT item_id, correct FROM test_responses WHERE participant_id = ? AND phase = ?', pid, phase);
  const total = c.knowledgeTest.items.length;
  const nCorrect = rows.filter(r => r.correct === 1).length;
  return { answered: rows.length, total, nCorrect, score: Math.round(nCorrect / total * 1000) / 10 };
}

function completeTest(pid, sid, phase, ts) {
  const s = scoreTest(pid, phase);
  if (s.answered < s.total) { const e = new Error(`尚有 ${s.total - s.answered} 題未作答`); e.status = 400; throw e; }
  const col = phase === 'pre' ? 'pretest_score' : 'posttest_score';
  const cur = get(`SELECT ${col} v FROM participants WHERE participant_id = ?`, pid);
  if (cur.v == null) {
    run(`UPDATE participants SET ${col} = ? WHERE participant_id = ?`, s.score, pid);
    logEvent(pid, sid, { event_type: phase === 'pre' ? 'pretest_completed' : 'posttest_completed', [col]: s.score, response: `${s.nCorrect}/${s.total}` }, ts, true);
  }
  return s;
}

function learningSummary(pid) {
  const c = content.load();
  const p = get('SELECT pretest_score, posttest_score FROM participants WHERE participant_id = ?', pid);
  const rows = all('SELECT phase, item_id, correct FROM test_responses WHERE participant_id = ?', pid);
  const domains = c.modules.map(m => {
    const ids = c.knowledgeTest.items.filter(i => i.domain === m.id).map(i => i.id);
    const pre = rows.filter(r => r.phase === 'pre' && ids.includes(r.item_id));
    const post = rows.filter(r => r.phase === 'post' && ids.includes(r.item_id));
    return { module_id: m.id, title: m.title, icon: m.icon, n: ids.length,
      pre_correct: pre.filter(r => r.correct).length, post_correct: post.filter(r => r.correct).length };
  });
  const ai = get('SELECT COUNT(*) n FROM ai_interactions WHERE participant_id = ?', pid).n;
  const modulesDone = get("SELECT COUNT(DISTINCT module_id) n FROM events WHERE participant_id = ? AND event_type = 'module_completed'", pid).n;
  return { pretest_score: p.pretest_score, posttest_score: p.posttest_score,
    gain: p.pretest_score != null && p.posttest_score != null ? Math.round((p.posttest_score - p.pretest_score) * 10) / 10 : null,
    domains, ai_questions: ai, modules_completed: modulesDone };
}

async function askAI(pid, sid, { question, module_id }, ts, overrideAnswer) {
  const q = String(question || '').trim();
  if (!q) { const e = new Error('請輸入問題'); e.status = 400; throw e; }
  const r = overrideAnswer || await aiSvc.ask(q, module_id);
  const interaction_id = uid();
  const t = ts || now();
  run('INSERT INTO ai_interactions (interaction_id, participant_id, session_id, module_id, question, category, guardrail, provider, response, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    interaction_id, pid, sid, module_id || null, q.slice(0, 500), r.category, r.guardrail || null, r.provider, r.answer, t);
  logEvent(pid, sid, { event_type: 'ai_question_submitted', module_id, item_id: interaction_id, ai_question: q, ai_question_category: r.category, extra: { guardrail: r.guardrail, provider: r.provider } }, t, true);
  return { interaction_id, answer: r.answer, category: r.category, guardrail: r.guardrail };
}

function markAIViewed(pid, sid, interaction_id, time_on_task, ts) {
  const a = get('SELECT * FROM ai_interactions WHERE interaction_id = ? AND participant_id = ?', interaction_id, pid);
  if (!a) { const e = new Error('找不到該 AI 互動'); e.status = 404; throw e; }
  if (!a.response_viewed) {
    run('UPDATE ai_interactions SET response_viewed = 1 WHERE interaction_id = ?', interaction_id);
    logEvent(pid, sid, { event_type: 'ai_response_viewed', module_id: a.module_id, item_id: interaction_id, ai_question: a.question, ai_question_category: a.category, ai_response_viewed: 1, time_on_task }, ts, true);
  }
}

function saveQuestionnaire(pid, sid, instrument, answers, ts) {
  const c = content.load();
  const def = instrument === 'self_efficacy' ? c.selfEfficacy : instrument === 'satisfaction' ? c.satisfaction : null;
  if (!def) { const e = new Error('問卷類型錯誤'); e.status = 400; throw e; }
  const t = ts || now();
  const missing = def.items.filter(i => ![1, 2, 3, 4, 5].includes(Number(answers?.[i.id])));
  if (missing.length) { const e = new Error(`尚有 ${missing.length} 題未作答`); e.status = 400; throw e; }
  const up = (id, v) => run(`INSERT INTO questionnaires (participant_id, instrument, item_id, value, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(participant_id, instrument, item_id) DO UPDATE SET value=excluded.value, created_at=excluded.created_at`, pid, instrument, id, String(v), t);
  for (const i of def.items) up(i.id, Number(answers[i.id]));
  for (const o of def.open || []) if (answers?.[o.id]) up(o.id, String(answers[o.id]).slice(0, 1000));
  logEvent(pid, sid, { event_type: 'questionnaire_completed', item_id: instrument, response: instrument }, t, true);
}

function completeSession(pid, sid, ts) {
  const t = ts || now();
  const p = get('SELECT completed_at, posttest_score FROM participants WHERE participant_id = ?', pid);
  if (p.posttest_score == null) { const e = new Error('尚未完成後測'); e.status = 400; throw e; }
  if (!p.completed_at) {
    run('UPDATE participants SET completed_at = ?, status = ? WHERE participant_id = ?', t, 'completed', pid);
    logEvent(pid, sid, { event_type: 'session_completed' }, t, true);
  }
}

module.exports = {
  EVENT_TYPES, createParticipant, byResumeCode, startSession, byToken, sessionBelongs, logEvent, saveDemographics, recordTestAnswer,
  completeTest, scoreTest, learningSummary, askAI, markAIViewed, saveQuestionnaire, completeSession
};
