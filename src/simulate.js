// 模擬資料產生器：完全走與真實受試者相同的資料流程（participant.js），僅時間戳記為模擬
const { all, run, get, tx } = require('./db');
const content = require('./content');
const P = require('./participant');
const aiSvc = require('./ai');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const SAMPLE_Q = {
  knowledge: ['什麼是胰島素阻抗？', '糖化血色素是什麼意思？', '糖尿病前期可以逆轉嗎？', '第一型和第二型糖尿病差在哪？'],
  blood_glucose: ['為什麼早上起床血糖比較高？', '血糖機和抽血數字不同正常嗎？', '飯後血糖目標是多少？', 'CGM 是什麼？'],
  diet: ['外食族早餐怎麼吃比較好？', '地瓜可以取代白飯嗎？', '代糖飲料可以喝嗎？', '水果一天可以吃多少？'],
  exercise: ['膝蓋不好可以做什麼運動？', '飯後多久運動比較好？', '肌力訓練對血糖有幫助嗎？'],
  medication: ['類固醇為什麼會讓血糖升高？', 'Metformin 為什麼要隨餐吃？', '胰島素注射部位怎麼輪替？', 'Rybelsus 怎麼吃？', '我可以停藥嗎？', '胰島素要打幾單位？'],
  hypoglycemia: ['為什麼巧克力不適合處理低血糖？', '晚上睡覺低血糖有什麼徵兆？', '家人可以怎麼幫忙處理低血糖？'],
  foot_care: ['腳麻是不是神經病變？', '糖尿病人可以做足底按摩嗎？', '腳很乾裂怎麼保養？'],
  complication: ['糖尿病的 ABC 是什麼？', '戒菸有什麼方法？', '腎功能變差飲食要注意什麼？'],
  other: ['今天天氣如何？']
};
const DEVICES = ['mobile', 'mobile', 'mobile', 'tablet', 'desktop', 'desktop'];

async function simulate(n = 30, seed = Date.now()) {
  const c = content.load();
  const R = rng(seed);
  const pick = a => a[Math.floor(R() * a.length)];
  const clamp = x => Math.max(0.05, Math.min(0.97, x));
  const lik = x => Math.max(1, Math.min(5, Math.round(x + (R() - 0.5) * 1.6)));
  // 問卷：依量表給基準分；後測依學習程度略有改善（焦慮下降）
  const surveyAnswers = (sid, base) => {
    const a = {};
    for (const d of content.survey(sid, c).defs) {
      const b = base[d.instrument] ?? 3.5;
      for (const it of d.items) a[it.id] = it.sus === 'neg' ? 6 - lik(b) : lik(b);
    }
    return a;
  };
  // 示範用每日瀏覽：訪客 id 以 SIMV 開頭，清除模擬資料時一併刪除
  for (let d = 0; d < 30; d++) {
    const k = 2 + Math.floor(R() * 9);
    for (let j = 0; j < k; j++) {
      const t = new Date(Date.now() - d * 864e5 - Math.floor(R() * 10 * 36e5)).toISOString();
      const vid = 'SIMV' + Math.floor(R() * 1e9).toString(36).padStart(6, '0');
      const views = 1 + Math.floor(R() * 4);
      for (let v = 0; v < views; v++) P.recordVisit(vid, t);
    }
  }
  const existing = all("SELECT participant_id FROM participants WHERE participant_id LIKE 'SIM%'");
  let start = existing.reduce((m, r) => Math.max(m, Number(r.participant_id.slice(3)) || 0), 0);
  const created = [];

  for (let i = 0; i < n; i++) {
    let t = Date.now() - Math.floor(R() * 30 * 864e5) - 3 * 36e5;
    const ts = (addSec = 0) => { t += addSec * 1000; return new Date(t).toISOString(); };
    const device = pick(DEVICES);
    const code = 'SIM' + String(++start).padStart(4, '0');
    const ability = clamp(0.35 + R() * 0.35);
    const aiAffinity = R(); // 使用 AI 的傾向
    const dropout = R() < 0.18 ? Math.floor(R() * 4) : -1; // 0:前測後 1:模組中 2:後測前 3:問卷前

    const { participant_id: pid } = P.createParticipant({ code, deviceType: device, userAgent: 'simulator', isSimulated: 1, ts: ts() });
    const sid = get('SELECT session_id FROM sessions WHERE participant_id = ?', pid).session_id;
    created.push(pid);

    const demo = {};
    for (const d of c.demographics) demo[d.id] = d.type === 'multi' ? [pick(d.options)] : pick(d.options);
    P.saveDemographics(pid, sid, demo, ts(90 + R() * 120));

    // 前測
    P.logEvent(pid, sid, { event_type: 'pretest_started' }, ts(5));
    for (const it of c.knowledgeTest.items) {
      const ok = R() < ability;
      const wrong = [0, 1, 2, 3].filter(x => x !== it.answer);
      const sec = 8 + R() * 25;
      P.recordTestAnswer(pid, sid, { phase: 'pre', item_id: it.id, response: ok ? it.answer : pick(wrong), time_on_task: Math.round(sec) }, ts(sec));
    }
    P.completeTest(pid, sid, 'pre', ts(3));
    const preBase = { health_literacy: 2.6 + ability * 1.5, anxiety: 3.6 - ability * 1.2, learning_se: 2.8 + ability * 1.4, self_efficacy: 2.6 + ability * 1.6 };
    P.saveSurvey(pid, sid, 'pre', surveyAnswers('pre', preBase), ts(150 + R() * 120));
    run('UPDATE participants SET state = ? WHERE participant_id = ?', JSON.stringify({ stage: 'modules' }), pid);
    if (dropout === 0) continue;

    // 模組
    let aiCount = 0;
    const modOrder = c.modules;
    const stopAt = dropout === 1 ? 2 + Math.floor(R() * 5) : 99;
    let done = 0;
    for (const m of modOrder) {
      if (done >= stopAt) break;
      P.logEvent(pid, sid, { event_type: 'module_started', module_id: m.id }, ts(20 + R() * 60));
      for (let s = 0; s < m.sections.length; s++)
        P.logEvent(pid, sid, { event_type: 'content_viewed', module_id: m.id, item_id: `${m.id}-S${s + 1}`, time_on_task: Math.round(20 + R() * 70) }, ts(20 + R() * 70));
      for (const q of m.questions) {
        let attempt = 0, ok = false;
        while (!ok && attempt < 3) {
          attempt++;
          ok = R() < clamp(ability + 0.2 + (attempt - 1) * 0.3);
          const sec = 10 + R() * 30;
          P.logEvent(pid, sid, { event_type: 'question_answered', module_id: m.id, item_id: q.id, response: ok ? q.answer : (q.answer + 1) % q.options.length, correct: ok, attempt_count: attempt, time_on_task: Math.round(sec) }, ts(sec));
          P.logEvent(pid, sid, { event_type: 'feedback_viewed', module_id: m.id, item_id: q.id, feedback_viewed: 1, correct: ok, attempt_count: attempt, time_on_task: Math.round(5 + R() * 15) }, ts(5 + R() * 15));
        }
      }
      // AI 延伸提問
      const k = aiAffinity > 0.7 ? Math.floor(R() * 3) : aiAffinity > 0.35 ? (R() < 0.5 ? 1 : 0) : 0;
      for (let j = 0; j < k; j++) {
        const cat = R() < 0.8 ? m.aiCategory : pick(Object.keys(SAMPLE_Q));
        const q = pick(SAMPLE_Q[cat]);
        const r = await P.askAI(pid, sid, { question: q, module_id: m.id }, ts(15 + R() * 30), await aiSvc.ask(q, m.id, { forceLocal: true }));
        if (R() < 0.9) P.markAIViewed(pid, sid, r.interaction_id, Math.round(10 + R() * 40), ts(10 + R() * 40));
        aiCount++;
      }
      P.logEvent(pid, sid, { event_type: 'module_completed', module_id: m.id, module_completion: 1 }, ts(5));
      done++;
    }
    if (done < 8) continue;
    // AI 助理頁
    const extra = aiAffinity > 0.6 ? 1 + Math.floor(R() * 4) : R() < 0.4 ? 1 : 0;
    for (let j = 0; j < extra; j++) {
      const q = pick(SAMPLE_Q[pick(Object.keys(SAMPLE_Q))]);
      const r = await P.askAI(pid, sid, { question: q, module_id: null }, ts(20 + R() * 40), await aiSvc.ask(q, null, { forceLocal: true }));
      if (R() < 0.9) P.markAIViewed(pid, sid, r.interaction_id, Math.round(10 + R() * 30), ts(10 + R() * 30));
      aiCount++;
    }
    if (dropout === 2) continue;

    // 後測：學習效果 + AI 使用量帶來少量額外效果
    const postAbility = clamp(ability + 0.12 + R() * 0.12 + Math.min(aiCount, 10) * 0.012);
    P.logEvent(pid, sid, { event_type: 'posttest_started' }, ts(30));
    for (const it of c.knowledgeTest.items) {
      const ok = R() < postAbility;
      const sec = 6 + R() * 18;
      P.recordTestAnswer(pid, sid, { phase: 'post', item_id: it.id, response: ok ? it.answer : pick([0, 1, 2, 3].filter(x => x !== it.answer)), time_on_task: Math.round(sec) }, ts(sec));
    }
    P.completeTest(pid, sid, 'post', ts(3));
    if (dropout === 3) continue;

    const lift = postAbility - ability;
    P.saveSurvey(pid, sid, 'post', surveyAnswers('post', {
      health_literacy: preBase.health_literacy + lift * 2.5, anxiety: preBase.anxiety - lift * 2,
      learning_se: preBase.learning_se + lift * 2.5, self_efficacy: preBase.self_efficacy + lift * 3
    }), ts(150 + R() * 120));
    const sat = surveyAnswers('sat', { edu_satisfaction: 3.7 + R() * 0.8, satisfaction: 3.6 + (R() - 0.5) * 1.4 });
    if (R() < 0.4) sat.OPEN01 = pick(['低血糖的模擬很實用', 'AI 回答很快', '字很大很清楚', '餐盤遊戲很好玩']);
    if (R() < 0.3) sat.OPEN02 = pick(['希望有語音輸入', '題目有點多', '希望可以分享給家人']);
    if (R() < 0.4) sat.ESOPEN01 = pick(['藥物和胰島素的部分最有幫助', '案例很貼近生活', '希望多一點飲食的例子']);
    P.saveSurvey(pid, sid, 'sat', sat, ts(180));
    P.completeSession(pid, sid, ts(10));
    run('UPDATE participants SET state = ? WHERE participant_id = ?', JSON.stringify({ stage: 'done' }), pid);
    // 部分人完成後會再測一次知識測驗
    if (R() < 0.35) {
      const ans = {}; const ra = clamp(postAbility + 0.08);
      for (const it of c.knowledgeTest.items) ans[it.id] = R() < ra ? it.answer : pick([0, 1, 2, 3].filter(x => x !== it.answer));
      P.retakeTest(pid, sid, { answers: ans, time_on_task: Math.round(60 + R() * 120) }, ts(600 + R() * 3600));
    }
  }
  return created;
}

function clearSimulated() {
  return tx(() => {
    const n = get('SELECT COUNT(*) n FROM participants WHERE is_simulated = 1').n;
    run('DELETE FROM participants WHERE is_simulated = 1');
    run("DELETE FROM visits WHERE visitor_id LIKE 'SIMV%'");
    return n;
  });
}

module.exports = { simulate, clearSimulated };
