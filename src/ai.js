// AI 智慧助理：問題分類 → 安全守門 → 回答（本機知識庫 / 可切換真正 LLM）
// 環境變數：
//   LLM_PROVIDER = local（預設）| openai | gemini
//   OPENAI_API_KEY / OPENAI_MODEL（預設 gpt-5.6-terra，可選 gpt-5.6-sol、gpt-5.6-luna）
//   GEMINI_API_KEY / GEMINI_MODEL（預設 gemini-3.5-flash，可選 gemini-3.1-pro-preview、gemini-3.1-flash-lite）
const content = require('./content');

const CATEGORY_KEYWORDS = {
  hypoglycemia: ['低血糖', '15-15', '15 15', '冒冷汗', '發抖', '手抖', '方糖', '昏迷', '叫不醒', '頭暈', '巧克力', '升糖素'],
  medication: ['藥', '胰島素', '打針', '注射', '針頭', 'metformin', 'rybelsus', '瑞倍適', 'trajenta', '糖漸平', '高糖優美', '恩美糖', 'galvus', 'jardiance',
    'glp', 'semaglutide', 'trulicity', '易週糖', '類固醇', '副作用', '劑量', '保健食品', '中藥', '草藥', '感冒藥', '交互作用', '輪替', 'sglt2', 'dpp'],
  foot_care: ['腳', '足', '趾甲', '鞋', '襪', '水泡', '雞眼', '厚繭', '腳麻', '截肢', '泡腳'],
  complication: ['併發症', '眼底', '視網膜', '視力', '腎', '蛋白尿', '洗腎', '心臟', '中風', '神經病變', '血壓', '膽固醇', '血脂', 'abc', '戒菸', '抽菸'],
  exercise: ['運動', '走路', '快走', '游泳', '健身', '肌力', '重訓', '跑步', '散步', '瑜珈', '太極', '膝蓋'],
  diet: ['吃', '飲食', '食物', '飯', '麵', '澱粉', '醣', '餐盤', '水果', '果汁', '飲料', '早餐', '午餐', '晚餐', '外食', '便當', '代糖', '無糖', '地瓜', '玉米', '酒', '點心', '零食', '營養'],
  blood_glucose: ['血糖', '測', '血糖機', '試紙', 'cgm', '連續血糖', '空腹', '飯後', '餐後', '數值', 'mg/dl', '目標', '紀錄'],
  knowledge: ['糖尿病', '胰島素阻抗', '糖化', 'a1c', 'hba1c', '前期', '第一型', '第二型', '第1型', '第2型', '症狀', '原因', '遺傳', '根治', '慢性病']
};
// 判斷順序：較具體的類別優先
const CATEGORY_ORDER = ['hypoglycemia', 'medication', 'foot_care', 'complication', 'exercise', 'diet', 'blood_glucose', 'knowledge'];
const CATEGORIES = [...CATEGORY_ORDER, 'other'];

function normalize(q) { return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function classify(question) {
  const q = normalize(question);
  let best = 'other', bestScore = 0;
  for (const cat of CATEGORY_ORDER) {
    let s = 0;
    for (const k of CATEGORY_KEYWORDS[cat]) if (q.includes(k)) s += k.length >= 3 ? 2 : 1;
    if (s > bestScore) { best = cat; bestScore = s; }
  }
  return best;
}

// 安全守門：不得診斷、不得建議停藥／改藥、不得提供個人化劑量；緊急狀況導向 119
const GUARD_RULES = [
  { type: 'emergency', re: /(昏迷|叫不醒|意識不清|不省人事|抽搐|胸痛|胸悶.*(冒汗|喘)|呼吸困難|中風|口齒不清|單側無力|自殺|想死)/ },
  { type: 'dose', re: /((打|注射|吃|服用|用|調|加|減|增加|減少)[^。？?]{0,8}(幾|多少)[^。？?]{0,6}(單位|顆|粒|錠|mg|毫克|劑量|cc|毫升))|((幾|多少)[^。？?]{0,4}(單位|劑量).{0,6}(胰島素|藥))|(劑量.{0,6}(多少|幾|怎麼調|調整))|(胰島素.{0,10}(要|該|可以).{0,6}(加|減|調)(多少|幾))/i },
  { type: 'stop', re: /((可以|能不能|能|要不要|是否|該不該|可不可以).{0,8}(停藥|停掉|不吃藥|不打|停打|不用吃|斷藥|換藥|改吃|改用|換成|減藥))|((停藥|停掉|不吃藥|停打|換藥|減藥).{0,6}(好嗎|可以嗎|嗎|呢))/ },
  { type: 'diagnose', re: /(我(是不是|是否|有沒有|會不會|算不算).{0,10}(得|罹患|有)?.{0,6}(糖尿病|病變|併發症|腎病|癌|中風|心臟病|感染))|(幫我(診斷|判斷|看看我))|(我(得了|罹患了)什麼)|(這樣(是|算)(糖尿病|病變))/ }
];

function guard(question) {
  const q = normalize(question);
  for (const r of GUARD_RULES) if (r.re.test(q)) return r.type;
  return null;
}

const OFFTOPIC_RE = /(股票|天氣|彩券|樂透|政治|選舉|寫程式|code|翻譯|食譜以外|電影|遊戲攻略|八卦)/i;

function localAnswer(question, category) {
  const c = content.load();
  const q = normalize(question);
  const kb = c.ai.knowledge;
  let best = null, bestScore = 0;
  for (const entry of kb) {
    let s = 0;
    for (const k of entry.keys) if (q.includes(k.toLowerCase())) s += 1 + k.length / 4;
    if (entry.category === category) s += 0.5;
    if (s > bestScore) { best = entry; bestScore = s; }
  }
  if (best && bestScore >= 1.2) return best.answer;
  // 分類命中但關鍵字不足：給該類別的通用回答（每類最後一筆通常為總覽）
  const sameCat = kb.filter(e => e.category === category);
  if (sameCat.length) return sameCat[sameCat.length - 1].answer;
  return null;
}

const SYSTEM_PROMPT = `你是「糖尿病互動衛教平台」的 AI 智慧助理，對象是台灣成年人與中高齡糖尿病人及家屬。
規則：
1. 只回答糖尿病健康教育的一般原則（基礎知識、血糖監測、飲食、運動、藥物安全一般原則、低血糖、足部照護、併發症預防）。
2. 不得診斷疾病、不得判讀個人是否罹患某病。
3. 不得建議停藥、換藥、改藥，不得提供任何個人化藥物或胰島素劑量（包括單位數、顆數、mg）。遇到這類問題，請說明需與醫師、藥師或衛教師討論。
4. 緊急狀況（意識不清、胸痛、呼吸困難等）請提醒立即撥打 119。
5. 使用繁體中文與台灣用語，句子簡短、口語、適合中高齡者閱讀，200 字以內，可用條列。
6. 結尾不必重複免責聲明（介面已顯示）。`;

async function callOpenAI(question, moduleTitle) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-terra';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: (moduleTitle ? `（使用者正在學習：${moduleTitle}）\n` : '') + question }
      ]
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content?.trim();
}

async function callGemini(question, moduleTitle) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: (moduleTitle ? `（使用者正在學習：${moduleTitle}）\n` : '') + question }] }]
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const j = await res.json();
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
}

// LLM 回覆後置檢查：若出現看似個人化劑量的內容，改用安全回覆
const DOSE_OUT_RE = /(\d+\s*(單位|u\b|iu)|每次\s*\d+\s*(顆|錠|mg|毫克))/i;

function providerInfo() {
  const p = (process.env.LLM_PROVIDER || 'local').toLowerCase();
  if (p === 'openai' && process.env.OPENAI_API_KEY) return { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-5.6-terra' };
  if (p === 'gemini' && process.env.GEMINI_API_KEY) return { provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-3.5-flash' };
  return { provider: 'local', model: 'rule-based-kb' };
}

async function ask(question, moduleId) {
  const c = content.load();
  const q = String(question || '').slice(0, 500);
  const category = classify(q);
  const g = guard(q);
  if (g) return { answer: c.ai.refusals[g], category, guardrail: g, provider: 'guardrail' };
  if (category === 'other' && OFFTOPIC_RE.test(q)) return { answer: c.ai.refusals.offtopic, category, guardrail: 'offtopic', provider: 'guardrail' };

  const info = providerInfo();
  const mod = (c.modules || []).find(m => m.id === moduleId);
  if (info.provider !== 'local') {
    try {
      const out = info.provider === 'openai' ? await callOpenAI(q, mod?.title) : await callGemini(q, mod?.title);
      if (out) {
        if (DOSE_OUT_RE.test(out)) return { answer: c.ai.refusals.dose, category, guardrail: 'dose_output', provider: info.provider };
        return { answer: out, category, guardrail: null, provider: info.provider };
      }
    } catch (e) {
      console.warn('[AI] LLM 呼叫失敗，改用本機知識庫：', e.message);
    }
  }
  const local = localAnswer(q, category);
  if (local) return { answer: local, category, guardrail: null, provider: 'local' };
  return { answer: c.ai.refusals.offtopic, category, guardrail: 'offtopic', provider: 'local' };
}

module.exports = { ask, classify, guard, providerInfo, CATEGORIES };
