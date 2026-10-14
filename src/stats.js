// 研究 Dashboard 統計與匯出資料表組裝
const { all, get, twDay } = require('./db');
const content = require('./content');
const { scaleScores } = require('./participant');

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
  const sat = rows.filter(r => r.instrument === 'satisfaction');
  const c = content.load();
  let susSum = 0, susN = 0;
  for (const it of c.satisfaction.items.filter(i => i.sus)) {
    const r = sat.find(x => x.item_id === it.id); if (!r) continue;
    const v = Number(r.value); susN++;
    susSum += it.sus === 'pos' ? v - 1 : 5 - v;
  }
  const scales = scaleScores(pid, c);
  return { se_mean: scales.self_efficacy?.post_mean ?? null, sus_score: susN === 10 ? round(susSum * 2.5, 1) : null, scales, raw: rows };
}

// 前後測量表的配對比較（健康識能、焦慮、學習自我效能、自我管理自我效能）
const SCALES = ['health_literacy', 'anxiety', 'learning_se', 'self_efficacy'];
function pairedStats(pre, post) {
  const pairs = pre.map((x, i) => [x, post[i]]).filter(([a, b]) => a != null && b != null);
  const d = pairs.map(([a, b]) => b - a);
  let t = null, pv = null;
  if (d.length >= 2 && sd(d) > 0) { t = mean(d) / (sd(d) / Math.sqrt(d.length)); pv = tTestP(Math.abs(t), d.length - 1); }
  const a = pre.filter(x => x != null), b = post.filter(x => x != null);
  return { pre_mean: round(mean(a)), pre_sd: round(sd(a)), pre_n: a.length, post_mean: round(mean(b)), post_sd: round(sd(b)), post_n: b.length,
    diff_mean: round(mean(d)), paired_n: d.length, t: round(t, 3), p: pv == null ? null : (pv < 0.001 ? '<0.001' : round(pv, 4)) };
}

// 每日瀏覽人次（最近 30 天）：首頁匿名訪客、登入使用者、頁面瀏覽次數
function dailyVisits(includeSim) {
  const days = [];
  const today = twDay();
  for (let i = 29; i >= 0; i--) days.push(twDay(new Date(Date.parse(today + 'T00:00:00Z') - i * 864e5 + 12 * 36e5).toISOString()));
  const v = all(`SELECT day, COUNT(*) visitors, SUM(views) views FROM visits ${includeSim ? '' : "WHERE visitor_id NOT LIKE 'SIMV%'"} GROUP BY day`);
  const ev = all(`SELECT e.participant_id, e.timestamp FROM events e JOIN participants p ON p.participant_id = e.participant_id WHERE e.event_type = 'page_view' ${simFilter(includeSim)}`);
  const pv = new Map(), users = new Map();
  for (const e of ev) {
    const d = twDay(e.timestamp);
    pv.set(d, (pv.get(d) || 0) + 1);
    if (!users.has(d)) users.set(d, new Set()); users.get(d).add(e.participant_id);
  }
  const series = days.map(d => {
    const r = v.find(x => x.day === d);
    return { day: d, visitors: r ? r.visitors : 0, visits: r ? r.views : 0, active_users: users.has(d) ? users.get(d).size : 0, page_views: pv.get(d) || 0 };
  });
  const t = series[series.length - 1];
  return { series, today: t, total_visitors_30d: series.reduce((a, x) => a + x.visitors, 0), total_visits_30d: series.reduce((a, x) => a + x.visits, 0) };
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
  const scales = SCALES.map(k => ({ key: k, title: c[{ health_literacy: 'healthLiteracy', anxiety: 'anxiety', learning_se: 'learningSelfEfficacy', self_efficacy: 'selfEfficacy' }[k]]?.title || k,
    ...pairedStats(qs.map(q => q.scales[k]?.pre_mean ?? null), qs.map(q => q.scales[k]?.post_mean ?? null)) }));
  const eduSat = qs.map(q => q.scales.edu_satisfaction?.post_mean).filter(x => x != null);
  const surveyN = sid => consented.filter(p => get("SELECT 1 FROM events WHERE participant_id = ? AND event_type = 'questionnaire_completed' AND item_id = ?", p.participant_id, sid + '_survey')).length;

  const funnel = [
    ['登入', consented.length],
    ['完成知識前測', pre.length],
    ['完成前測問卷', surveyN('pre')],
    ['完成 8 模組', consented.filter(p => mp.filter(r => r.participant_id === p.participant_id && r.completed).length === 8).length],
    ['完成知識後測', post.length],
    ['完成後測問卷', surveyN('post')],
    ['完成滿意度問卷', surveyN('sat')],
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
      se_mean: round(mean(seMeans), 2), sus_mean: round(mean(sus), 1), edu_sat_mean: round(mean(eduSat), 2),
      retake_total: get(`SELECT COUNT(*) n FROM test_retakes t JOIN participants p ON p.participant_id = t.participant_id WHERE 1=1 ${simFilter(includeSim)}`).n
    },
    funnel, items, modules, scales, visits: dailyVisits(includeSim),
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
    questionnaires: questionnaireScores(pid),
    retakes: all('SELECT attempt_no, score, n_correct, total, completed_at FROM test_retakes WHERE participant_id = ? ORDER BY attempt_no', pid)
  };
}

// ===== AI 常問關鍵字（文字雲）=====
// 中文沒有空白斷詞：先比對衛教詞典（長詞優先），其餘再取 2–4 字常見片段，排除虛詞
const AI_DICT = ['糖化血色素', '胰島素阻抗', '低血糖', '高血糖', '血糖機', '血糖值', '空腹血糖', '飯後血糖', '血糖', '胰島素', '注射部位', '注射', '針頭', '筆針',
  '二甲雙胍', 'Metformin', 'Rybelsus', '瑞倍適', 'Jardiance', 'Trajenta', 'GLP-1', 'SGLT2', '類固醇', '藥物', '吃藥', '停藥', '劑量', '單位', '副作用',
  '飲食', '早餐', '外食', '白飯', '地瓜', '水果', '代糖', '飲料', '無糖', '澱粉', '醣類', '蛋白質', '蔬菜', '餐盤', '點心', '喝酒', '酒精', '咖啡',
  '運動', '散步', '走路', '肌力訓練', '膝蓋', '游泳', '飯後運動', '足部', '腳麻', '傷口', '泡腳', '趾甲', '鞋子', '足底', '乾裂', '水泡',
  '併發症', '眼睛', '視網膜', '腎臟', '腎功能', '心血管', '血壓', '血脂', '中風', '戒菸', '抽菸', '神經病變', '糖尿病前期', '第一型', '第二型',
  'CGM', '連續血糖', '15-15', '方糖', '果汁', '巧克力', '頭暈', '冒冷汗', '發抖', '睡覺', '晚上', '懷孕', '感冒', '生病'];
// 片段若含下列虛詞／泛用字就不列入（「糖尿病」幾乎每題都有，也排除）
const STOP_CHARS = /[較比幾吃的嗎呢吧啊我你他她是有會能要可以做人怎麼什為了在和與或還就都很太也嗎這那哪些個多少請問該需如何樣沒不]/;
const STOP_WORDS = ['糖尿', '尿病'];
function aiKeywords(includeSim = true) {
  const rows = all(`SELECT a.question, a.category FROM ai_interactions a JOIN participants p ON p.participant_id = a.participant_id WHERE 1=1 ${simFilter(includeSim)}`);
  const dict = AI_DICT.slice().sort((a, b) => b.length - a.length);
  const kw = new Map(), frag = new Map(), qmap = new Map();
  for (const r of rows) {
    let q = String(r.question || '');
    const norm = q.replace(/[？?！!。，,\s]+$/g, '').trim();
    if (norm) { const o = qmap.get(norm) || { question: norm, n: 0, category: r.category }; o.n++; qmap.set(norm, o); }
    const seen = new Set();
    for (const w of dict) {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'), 'gi');
      if (re.test(q)) { if (!seen.has(w)) { kw.set(w, (kw.get(w) || 0) + 1); seen.add(w); } q = q.replace(re, '　'); }
    }
    // 詞典外的片段：連續中文 2–4 字
    for (const seg of q.split(/[^一-鿿]+/).filter(x => x.length >= 2)) {
      const local = new Set();
      for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= seg.length; i++) { const g = seg.slice(i, i + n); if (!STOP_CHARS.test(g) && !STOP_WORDS.some(w => g.includes(w))) local.add(g); }
      for (const g of local) frag.set(g, (frag.get(g) || 0) + 1);
    }
  }
  // 片段需出現 ≥3 次；與已選片段重疊 2 字以上且次數相近者視為同一詞（避免「今天天氣」「天氣如何」重複）
  const fr = [...frag.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const overlap = (x, y) => { for (let i = 0; i + 2 <= x.length; i++) if (y.includes(x.slice(i, i + 2))) return true; return false; };
  const kept = [];
  for (const [g, n] of fr) if (!kept.some(([k, m]) => overlap(g, k) && m >= n * 0.8)) kept.push([g, n]);
  const words = [...[...kw.entries()].map(([text, n]) => ({ text, n, source: 'dict' })), ...kept.slice(0, 30).map(([text, n]) => ({ text, n, source: 'ngram' }))]
    .sort((a, b) => b.n - a.n).slice(0, 80);
  const questions = [...qmap.values()].sort((a, b) => b.n - a.n).slice(0, 20);
  return { total_questions: rows.length, words, top_questions: questions };
}

// ===== 行為序列分析（Lag Sequential Analysis, lag 1）=====
// 把學習事件轉成行為代碼，計算相鄰行為的轉移次數與調整後殘差 Z（Bakeman & Quera），Z > 1.96 表示該轉移顯著（p < .05）
const LSA_CODES = [
  ['MS', '開始單元'], ['CV', '閱讀圖文'], ['WI', '互動練習'], ['QC', '作答正確'], ['QW', '作答錯誤'], ['FB', '查看回饋'],
  ['AQ', '提問 AI'], ['AR', '閱讀 AI 回答'], ['MC', '完成單元'], ['TT', '使用朗讀']
];
function codeOf(e) {
  switch (e.event_type) {
    case 'module_started': return 'MS';
    case 'content_viewed': return 'CV';
    case 'widget_interaction': return 'WI';
    case 'question_answered': return e.correct === 1 ? 'QC' : 'QW';
    case 'feedback_viewed': return 'FB';
    case 'ai_question_submitted': return 'AQ';
    case 'ai_response_viewed': return 'AR';
    case 'module_completed': return 'MC';
    case 'tts_used': return 'TT';
    default: return null;
  }
}
function lagSequential(includeSim = true, { module = '', scope = 'all' } = {}) {
  const codes = LSA_CODES.map(c => c[0]);
  const idx = new Map(codes.map((c, i) => [c, i]));
  const K = codes.length;
  const F = Array.from({ length: K }, () => Array(K).fill(0));
  const ev = all(`SELECT e.participant_id, e.event_type, e.module_id, e.correct FROM events e JOIN participants p ON p.participant_id = e.participant_id
    WHERE 1=1 ${simFilter(includeSim)} ${scope === 'completed' ? 'AND p.completed_at IS NOT NULL' : ''} ORDER BY e.participant_id, e.timestamp, e.rowid`);
  let prevPid = null, prev = null, nSeq = 0, nCodes = 0;
  const freq = Array(K).fill(0);
  for (const e of ev) {
    if (module && e.module_id !== module) continue;
    const c = codeOf(e); if (!c) continue;
    if (e.participant_id !== prevPid) { prevPid = e.participant_id; prev = null; nSeq++; }
    if (c === prev) continue; // 連續相同行為合併為一次
    freq[idx.get(c)]++; nCodes++;
    if (prev) F[idx.get(prev)][idx.get(c)]++;
    prev = c;
  }
  const N = F.flat().reduce((a, b) => a + b, 0);
  const rowT = F.map(r => r.reduce((a, b) => a + b, 0));
  const colT = codes.map((_, j) => F.reduce((a, r) => a + r[j], 0));
  const Z = F.map((r, i) => r.map((o, j) => {
    if (!N || !rowT[i] || !colT[j]) return null;
    const e = rowT[i] * colT[j] / N;
    const v = e * (1 - rowT[i] / N) * (1 - colT[j] / N);
    return v > 0 ? round((o - e) / Math.sqrt(v), 2) : null;
  }));
  const sig = [];
  F.forEach((r, i) => r.forEach((o, j) => { if (Z[i][j] != null && Z[i][j] > 1.96 && o >= 2) sig.push({ from: codes[i], to: codes[j], n: o, z: Z[i][j] }); }));
  sig.sort((a, b) => b.z - a.z);
  return { codes: LSA_CODES.map(([code, label], i) => ({ code, label, n: freq[i] })), freq: F, z: Z, n_transitions: N, n_sequences: nSeq, n_codes: nCodes, significant: sig, module, scope };
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
      ai_question_count: aiAll.filter(a => a.participant_id === p.participant_id).length,
      retake_count: get('SELECT COUNT(*) n FROM test_retakes WHERE participant_id = ?', p.participant_id).n
    });
    const sc = scaleScores(p.participant_id, c);
    for (const k of [...SCALES, 'edu_satisfaction']) {
      if (k !== 'edu_satisfaction') row[`${k}_pre_sum`] = sc[k]?.pre_sum ?? null;
      row[`${k}_post_sum`] = sc[k]?.post_sum ?? null;
    }
    return row;
  });

  const itemMap = new Map(c.knowledgeTest.items.map(i => [i.id, i]));
  const pre_post_test = all('SELECT * FROM test_responses ORDER BY participant_id, phase DESC, item_id')
    .filter(r => pids.has(r.participant_id))
    .map(r => ({ participant_id: r.participant_id, phase: r.phase, item_id: r.item_id, domain: itemMap.get(r.item_id)?.domain || '',
      response: r.response, correct: r.correct, time_on_task_sec: r.time_on_task, answered_at: r.answered_at }));
  // 完成後的再測（練習，不是正式後測）：phase = retake1、retake2…
  for (const r of all('SELECT * FROM test_retakes ORDER BY participant_id, attempt_no').filter(r => pids.has(r.participant_id))) {
    const ans = safeJSON(r.answers) || {};
    for (const [item_id, resp] of Object.entries(ans)) {
      const it = itemMap.get(item_id);
      pre_post_test.push({ participant_id: r.participant_id, phase: 'retake' + r.attempt_no, item_id, domain: it?.domain || '', response: resp,
        correct: it ? (resp === it.answer ? 1 : 0) : null, time_on_task_sec: null, answered_at: r.completed_at });
    }
  }

  const learning_events = all('SELECT * FROM events ORDER BY timestamp, rowid').filter(r => pids.has(r.participant_id));

  const module_performance = mp.map(r => ({ ...r }));

  const ai_interactions = aiAll.map(a => ({
    interaction_id: a.interaction_id, participant_id: a.participant_id, session_id: a.session_id, module_id: a.module_id,
    timestamp: a.created_at, ai_question: a.question, ai_question_category: a.category, guardrail: a.guardrail || '',
    provider: a.provider, ai_response_viewed: a.response_viewed, response_length: (a.response || '').length
  }));

  // 寬格式：每個量表 × 前／後測的逐題分數與總分（instrument 名稱見 README）
  const cols = [];
  for (const sid of ['pre', 'post', 'sat']) {
    const sv = content.survey(sid, c); if (!sv) continue;
    for (const d of sv.defs) cols.push({ sid, d, inst: content.storedInstrument(sid, d) });
  }
  const questionnaires = parts.filter(p => p.consent_at).map(p => {
    const q = questionnaireScores(p.participant_id);
    const val = (inst, id) => { const r = q.raw.find(x => x.instrument === inst && x.item_id === id); return r ? r.value : ''; };
    const row = { participant_id: p.participant_id };
    for (const { sid, d, inst } of cols) {
      const sfx = sid === 'sat' ? '' : '_' + sid;
      for (const it of d.items) row[it.id + sfx] = val(inst, it.id);
      const sc = q.scales[d.instrument] || {};
      const ph = sid === 'sat' ? 'post' : sid;
      row[d.instrument + sfx + '_sum'] = sc[ph + '_sum'] ?? '';
      row[d.instrument + sfx + '_mean'] = sc[ph + '_mean'] ?? '';
      if (d.instrument === 'satisfaction') row.sus_score = q.sus_score;
      for (const o of d.open || []) row[o.id] = val(inst, o.id);
    }
    return row;
  });

  return { participants, pre_post_test, learning_events, module_performance, ai_interactions, questionnaires };
}

module.exports = { dashboard, participantList, participantDetail, exportTables, modulePerformance, questionnaireScores, aiKeywords, lagSequential, round };
