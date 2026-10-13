// 研究 Dashboard 統計與匯出資料表組裝
const { all, get } = require('./db');
const content = require('./content');

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const round = (x, d = 2) => x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d;

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

// Student t 雙尾 p 值（正則化不完全 Beta 函數，Numerical Recipes 演算法）
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function tTestP(t, df) { return ibeta(df / 2, 0.5, df / (df + t * t)); }

function simFilter(includeSim) { return includeSim ? '' : ' AND p.is_simulated = 0'; }

function participantRows(includeSim = true) {
  return all(`SELECT * FROM participants p WHERE 1=1 ${simFilter(includeSim)} ORDER BY created_at`);
}

// 每位受試者 × 每模組 的表現
function modulePerformance(includeSim = true) {
  const c = content.load();
  const parts = participantRows(includeSim);
  const ev = all(`SELECT e.participant_id, e.event_type, e.module_id, e.item_id, e.correct, e.attempt_count, e.timestamp, e.time_on_task
    FROM events e JOIN participants p ON p.participant_id = e.participant_id
    WHERE e.module_id IS NOT NULL ${simFilter(includeSim)} ORDER BY e.timestamp`);
  const map = new Map();
  for (const p of parts) for (const m of c.modules) map.set(p.participant_id + '|' + m.id, {
    participant_id: p.participant_id, module_id: m.id, module_title: m.title, started_at: null, completed_at: null,
    duration_sec: null, content_views: 0, questions_answered: 0, first_try_correct: 0, total_attempts: 0,
    feedback_views: 0, ai_questions: 0, completed: 0, first_try_items: new Set(), answered_items: new Set()
  });
  for (const e of ev) {
    const r = map.get(e.participant_id + '|' + e.module_id); if (!r) continue;
    switch (e.event_type) {
      case 'module_started': if (!r.started_at) r.started_at = e.timestamp; break;
      case 'module_completed': if (!r.completed_at) { r.completed_at = e.timestamp; r.completed = 1; } break;
      case 'content_viewed': r.content_views++; break;
      case 'question_answered':
        r.total_attempts++;
        if (!r.answered_items.has(e.item_id)) {
          r.answered_items.add(e.item_id);
          if (e.correct === 1 && (e.attempt_count || 1) === 1) r.first_try_correct++;
        }
        break;
      case 'feedback_viewed': r.feedback_views++; break;
      case 'ai_question_submitted': r.ai_questions++; break;
    }
  }
  return [...map.values()].map(r => {
    if (r.started_at && r.completed_at) r.duration_sec = Math.round((new Date(r.completed_at) - new Date(r.started_at)) / 1000);
    r.questions_answered = r.answered_items.size;
    const accuracy = r.questions_answered ? round(r.first_try_correct / r.questions_answered * 100, 1) : null;
    const { first_try_items, answered_items, ...rest } = r;
    return { ...rest, first_try_accuracy: accuracy };
  });
}

function questionnaireScores(pid) {
  const rows = all('SELECT instrument, item_id, value FROM questionnaires WHERE participant_id = ?', pid);
  const se = rows.filter(r => r.instrument === 'self_efficacy').map(r => Number(r.value)).filter(n => !Number.isNaN(n));
  const sat = rows.filter(r => r.instrument === 'satisfaction');
  const c = content.load();
  let susSum = 0, susN = 0;
  for (const it of c.satisfaction.items.filter(i => i.sus)) {
    const r = sat.find(x => x.item_id === it.id); if (!r) continue;
    const v = Number(r.value); susN++;
    susSum += it.sus === 'pos' ? v - 1 : 5 - v;
  }
  return { se_mean: se.length ? round(mean(se), 2) : null, sus_score: susN === 10 ? round(susSum * 2.5, 1) : null, raw: rows };
}

function dashboard(includeSim = true) {
  const c = content.load();
  const parts = participantRows(includeSim);
  const consented = parts.filter(p => p.consent_at);
  const pre = consented.filter(p => p.pretest_score != null).map(p => p.pretest_score);
  const post = consented.filter(p => p.posttest_score != null).map(p => p.posttest_score);
  const paired = consented.filter(p => p.pretest_score != null && p.posttest_score != null);
  const gains = paired.map(p => p.posttest_score - p.pretest_score);
  let tStat = null, pVal = null;
  if (gains.length >= 2 && sd(gains) > 0) {
    tStat = mean(gains) / (sd(gains) / Math.sqrt(gains.length));
    pVal = tTestP(Math.abs(tStat), gains.length - 1);
  }

  // 各題正確率（前／後測）
  const tr = all(`SELECT t.phase, t.item_id, t.correct FROM test_responses t JOIN participants p ON p.participant_id = t.participant_id WHERE 1=1 ${simFilter(includeSim)}`);
  const items = c.knowledgeTest.items.map(it => {
    const prs = tr.filter(r => r.item_id === it.id && r.phase === 'pre');
    const pos = tr.filter(r => r.item_id === it.id && r.phase === 'post');
    return {
      item_id: it.id, domain: it.domain, stem: it.stem,
      pre_n: prs.length, pre_correct_rate: prs.length ? round(prs.filter(r => r.correct === 1).length / prs.length * 100, 1) : null,
      post_n: pos.length, post_correct_rate: pos.length ? round(pos.filter(r => r.correct === 1).length / pos.length * 100, 1) : null
    };
  });

  // 模組完成率與停留時間
  const mp = modulePerformance(includeSim);
  const modules = c.modules.map(m => {
    const rows = mp.filter(r => r.module_id === m.id);
    const done = rows.filter(r => r.completed);
    const durs = done.map(r => r.duration_sec).filter(x => x != null);
    const acc = rows.map(r => r.first_try_accuracy).filter(x => x != null);
    return {
      module_id: m.id, title: m.title, started: rows.filter(r => r.started_at).length, completed: done.length,
      completion_rate: consented.length ? round(done.length / consented.length * 100, 1) : null,
      avg_duration_min: durs.length ? round(mean(durs) / 60, 1) : null,
      avg_first_try_accuracy: acc.length ? round(mean(acc), 1) : null,
      ai_questions: rows.reduce((s, r) => s + r.ai_questions, 0)
    };
  });

  // 學習時間：各模組停留時間合計
  const perPartLearning = new Map();
  for (const r of mp) if (r.duration_sec != null) perPartLearning.set(r.participant_id, (perPartLearning.get(r.participant_id) || 0) + r.duration_sec);
  const learnMins = [...perPartLearning.values()].map(s => s / 60);
  // 全程時間：同意 → 完成
  const totalMins = consented.filter(p => p.completed_at).map(p => (new Date(p.completed_at) - new Date(p.consent_at)) / 60000);

  // AI 使用
  const ai = all(`SELECT a.participant_id, a.category, a.guardrail, a.response_viewed FROM ai_interactions a JOIN participants p ON p.participant_id = a.participant_id WHERE 1=1 ${simFilter(includeSim)}`);
  const catDist = {}; for (const k of require('./ai').CATEGORIES) catDist[k] = 0;
  for (const a of ai) catDist[a.category] = (catDist[a.category] || 0) + 1;
  const guardDist = {};
  for (const a of ai) if (a.guardrail) guardDist[a.guardrail] = (guardDist[a.guardrail] || 0) + 1;
  const aiCount = new Map(); for (const a of ai) aiCount.set(a.participant_id, (aiCount.get(a.participant_id) || 0) + 1);

  const levelOf = n => n === 0 ? '0 次' : n <= 2 ? '1–2 次' : n <= 5 ? '3–5 次' : '6 次以上';
  const levels = ['0 次', '1–2 次', '3–5 次', '6 次以上'];
  const scatter = paired.map(p => ({ participant_id: p.participant_id, ai_count: aiCount.get(p.participant_id) || 0, posttest: p.posttest_score, gain: round(p.posttest_score - p.pretest_score, 1) }));
  const byLevel = levels.map(l => {
    const g = scatter.filter(s => levelOf(s.ai_count) === l);
    return { level: l, n: g.length, mean_post: round(mean(g.map(s => s.posttest)), 1), mean_gain: round(mean(g.map(s => s.gain)), 1) };
  });

  const qs = consented.map(p => questionnaireScores(p.participant_id));
  const seMeans = qs.map(q => q.se_mean).filter(x => x != null);
  const sus = qs.map(q => q.sus_score).filter(x => x != null);

  const funnel = [
    ['同意參與', consented.length],
    ['完成前測', pre.length],
    ['完成 8 模組', consented.filter(p => mp.filter(r => r.participant_id === p.participant_id && r.completed).length === 8).length],
    ['完成後測', post.length],
    ['完成問卷', consented.filter(p => get("SELECT COUNT(*) n FROM questionnaires WHERE participant_id=? AND instrument='satisfaction'", p.participant_id).n > 0).length],
    ['全程完成', consented.filter(p => p.completed_at).length]
  ].map(([stage, n]) => ({ stage, n }));

  return {
    generated_at: new Date().toISOString(),
    include_simulated: includeSim,
    summary: {
      participants: consented.length,
      simulated: consented.filter(p => p.is_simulated).length,
      completed: consented.filter(p => p.completed_at).length,
      pretest_mean: round(mean(pre), 1), pretest_sd: round(sd(pre), 1), pretest_n: pre.length,
      posttest_mean: round(mean(post), 1), posttest_sd: round(sd(post), 1), posttest_n: post.length,
      gain_mean: round(mean(gains), 1), gain_sd: round(sd(gains), 1), paired_n: gains.length,
      paired_t: round(tStat, 3), paired_p: pVal == null ? null : (pVal < 0.001 ? '<0.001' : round(pVal, 4)),
      avg_learning_min: round(mean(learnMins), 1), avg_total_min: round(mean(totalMins), 1),
      ai_total: ai.length, ai_per_participant: consented.length ? round(ai.length / consented.length, 2) : null,
      ai_users: [...aiCount.keys()].length,
      se_mean: round(mean(seMeans), 2), sus_mean: round(mean(sus), 1)
    },
    funnel, items, modules,
    ai: {
      categories: catDist, guardrails: guardDist, by_level: byLevel, scatter,
      r_ai_post: round(pearson(scatter.map(s => s.ai_count), scatter.map(s => s.posttest)), 3),
      r_ai_gain: round(pearson(scatter.map(s => s.ai_count), scatter.map(s => s.gain)), 3)
    },
    scores: paired.map(p => ({ participant_id: p.participant_id, pre: p.pretest_score, post: p.posttest_score }))
  };
}

function participantList(includeSim = true) {
  const parts = participantRows(includeSim);
  const mp = modulePerformance(includeSim);
  const aiCounts = all('SELECT participant_id, COUNT(*) n FROM ai_interactions GROUP BY participant_id');
  const aiMap = new Map(aiCounts.map(r => [r.participant_id, r.n]));
  return parts.map(p => {
    const st = safeJSON(p.state) || {};
    return {
      participant_id: p.participant_id, created_at: p.created_at, consent_at: p.consent_at, completed_at: p.completed_at,
      device_type: p.device_type, is_simulated: p.is_simulated, stage: st.stage || null,
      modules_completed: mp.filter(r => r.participant_id === p.participant_id && r.completed).length,
      pretest_score: p.pretest_score, posttest_score: p.posttest_score,
      gain: p.pretest_score != null && p.posttest_score != null ? round(p.posttest_score - p.pretest_score, 1) : null,
      ai_count: aiMap.get(p.participant_id) || 0
    };
  });
}

function participantDetail(pid) {
  const p = get('SELECT * FROM participants WHERE participant_id = ?', pid);
  if (!p) return null;
  const { token, ...pub } = p;
  return {
    participant: { ...pub, demographics: safeJSON(p.demographics), state: safeJSON(p.state) },
    sessions: all('SELECT session_id, started_at, last_seen, device_type FROM sessions WHERE participant_id = ? ORDER BY started_at', pid),
    events: all('SELECT * FROM events WHERE participant_id = ? ORDER BY timestamp, rowid', pid),
    tests: all('SELECT * FROM test_responses WHERE participant_id = ? ORDER BY phase DESC, item_id', pid),
    modules: modulePerformance(true).filter(r => r.participant_id === pid),
    ai: all('SELECT * FROM ai_interactions WHERE participant_id = ? ORDER BY created_at', pid),
    questionnaires: questionnaireScores(pid)
  };
}

function safeJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// ===== 匯出用六大資料表 =====
function exportTables(includeSim = true) {
  const c = content.load();
  const parts = participantRows(includeSim);
  const pids = new Set(parts.map(p => p.participant_id));
  const mp = modulePerformance(includeSim);
  const aiAll = all('SELECT * FROM ai_interactions ORDER BY created_at').filter(r => pids.has(r.participant_id));
  const demoKeys = c.demographics.map(d => d.id);

  const participants = parts.map(p => {
    const d = safeJSON(p.demographics) || {};
    const learn = mp.filter(r => r.participant_id === p.participant_id && r.duration_sec != null).reduce((s, r) => s + r.duration_sec, 0);
    const row = {
      participant_id: p.participant_id, is_simulated: p.is_simulated, created_at: p.created_at, consent_at: p.consent_at,
      completed_at: p.completed_at, device_type: p.device_type
    };
    for (const k of demoKeys) row[k] = Array.isArray(d[k]) ? d[k].join(';') : (d[k] ?? '');
    Object.assign(row, {
      pretest_score: p.pretest_score, posttest_score: p.posttest_score,
      gain_score: p.pretest_score != null && p.posttest_score != null ? round(p.posttest_score - p.pretest_score, 2) : null,
      modules_completed: mp.filter(r => r.participant_id === p.participant_id && r.completed).length,
      learning_time_min: round(learn / 60, 2),
      total_time_min: p.completed_at && p.consent_at ? round((new Date(p.completed_at) - new Date(p.consent_at)) / 60000, 2) : null,
      ai_question_count: aiAll.filter(a => a.participant_id === p.participant_id).length
    });
    return row;
  });

  const itemMap = new Map(c.knowledgeTest.items.map(i => [i.id, i]));
  const pre_post_test = all('SELECT * FROM test_responses ORDER BY participant_id, phase DESC, item_id')
    .filter(r => pids.has(r.participant_id))
    .map(r => ({ participant_id: r.participant_id, phase: r.phase, item_id: r.item_id, domain: itemMap.get(r.item_id)?.domain || '',
      response: r.response, correct: r.correct, time_on_task_sec: r.time_on_task, answered_at: r.answered_at }));

  const learning_events = all('SELECT * FROM events ORDER BY timestamp, rowid').filter(r => pids.has(r.participant_id));

  const module_performance = mp.map(r => ({ ...r }));

  const ai_interactions = aiAll.map(a => ({
    interaction_id: a.interaction_id, participant_id: a.participant_id, session_id: a.session_id, module_id: a.module_id,
    timestamp: a.created_at, ai_question: a.question, ai_question_category: a.category, guardrail: a.guardrail || '',
    provider: a.provider, ai_response_viewed: a.response_viewed, response_length: (a.response || '').length
  }));

  const seItems = c.selfEfficacy.items.map(i => i.id);
  const satItems = c.satisfaction.items.map(i => i.id);
  const openItems = c.satisfaction.open.map(i => i.id);
  const questionnaires = parts.filter(p => p.consent_at).map(p => {
    const q = questionnaireScores(p.participant_id);
    const val = (inst, id) => { const r = q.raw.find(x => x.instrument === inst && x.item_id === id); return r ? r.value : ''; };
    const row = { participant_id: p.participant_id };
    for (const id of seItems) row[id] = val('self_efficacy', id);
    row.se_mean = q.se_mean;
    for (const id of satItems) row[id] = val('satisfaction', id);
    row.sus_score = q.sus_score;
    for (const id of openItems) row[id] = val('satisfaction', id);
    return row;
  });

  return { participants, pre_post_test, learning_events, module_performance, ai_interactions, questionnaires };
}

module.exports = { dashboard, participantList, participantDetail, exportTables, modulePerformance, questionnaireScores, round };
