// AI 智慧助理：問題分類 → 安全守門 → 回答（本機知識庫 / 生成式 LLM）
// 引擎由研究者後臺「AI 設定」決定（src/settings.js）：
//   local（規則式知識庫）| gemini | openai | groq（API 金鑰）| cli（本機 codex／gemini／claude CLI，只限 start.bat 本機執行）
// 後臺可開放「受試者自備金鑰」：金鑰只存在受試者瀏覽器，每次提問隨請求送出，伺服器不保存
// LLM 失敗時自動改用本機知識庫，並在 ai_interactions.provider 記錄實際使用的引擎
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const content = require('./content');
const settings = require('./settings');

const MODEL_OPTIONS = {
  gemini: ['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'],
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.5-pro'],
  groq: ['llama-3.3-70b-versatile', 'qwen/qwen-3-32b', 'llama-3.1-8b-instant'],
  cli: {
    codex: ['', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    gemini: ['', 'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'],
    claude: ['', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']
  }
};
const PROVIDER_LABEL = { local: '本機衛教知識庫（規則式）', gemini: 'Google Gemini API', openai: 'OpenAI API', groq: 'Groq API', cli: '本機 CLI' };

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
6. 結尾不必重複免責聲明（介面已顯示）。
7. 純文字回答：不要使用 Markdown 粗體（**）、標題符號（#）或表格，不要附網址連結；條列請用「・」或數字。`;

const userText = (question, moduleTitle) => (moduleTitle ? `（使用者正在學習：${moduleTitle}）\n` : '') + question;

// OpenAI 與 Groq 都是 Chat Completions 相容格式
const OPENAI_BASE = { openai: 'https://api.openai.com/v1', groq: 'https://api.groq.com/openai/v1' };
async function callOpenAICompat(provider, key, model, system, text) {
  const res = await fetch(`${OPENAI_BASE[provider]}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content?.trim();
}

async function callGemini(key, model, system, text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text }] }] }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
  const j = await res.json();
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
}

// 本機 CLI：提示詞一律經 stdin 傳入（不放進命令列參數），工具以唯讀／無工具模式執行
function callCLI(tool, model, system, text) {
  if (process.env.STORAGE === 'blobs') return Promise.reject(new Error('雲端網站無法使用 CLI'));
  const prompt = `${system}\n\n請直接回答以下使用者問題，只輸出回答內容：\n${text}`;
  const tmp = path.join(os.tmpdir(), `dm_ai_${process.pid}_${Date.now()}.txt`);
  const m = model && settings.MODEL_RE.test(model) ? model : '';
  const args = {
    codex: ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-o', tmp, ...(m ? ['-m', m] : []), '-'],
    gemini: ['-p', 'Answer', '--approval-mode', 'plan', '-o', 'text', ...(m ? ['-m', m] : [])],
    claude: ['-p', '--no-session-persistence', '--output-format', 'text', ...(m ? ['--model', m] : [])]
  }[tool];
  if (!args) return Promise.reject(new Error('未知的 CLI 工具'));
  return new Promise((resolve, reject) => {
    // Windows 的 CLI 是 .cmd，需要經 shell 啟動；參數皆為固定值或已驗證的模型名稱
    const child = spawn(tool, args, { shell: process.platform === 'win32', cwd: os.tmpdir(), windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${tool} CLI 逾時`)); }, 120000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      let ans = out;
      if (tool === 'codex') { try { ans = fs.readFileSync(tmp, 'utf8'); fs.unlinkSync(tmp); } catch { ans = ''; } }
      ans = String(ans || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (code !== 0 || !ans) {
        // 常見原因轉成看得懂的說明（例如 Google 已停止 Gemini CLI 個人免費方案）
        const hint = /IneligibleTier|UNSUPPORTED_CLIENT/.test(err) ? '：這台電腦登入的 Google 帳號已不支援 Gemini CLI，請改用 Gemini API 金鑰或 codex／claude CLI'
          : /not logged in|login|auth/i.test(err) ? '：CLI 尚未登入，請先在這台電腦執行一次該 CLI 並登入' : '';
        return reject(new Error(`${tool} CLI 失敗（exit ${code}）${hint || err.slice(-200)}`));
      }
      resolve(ans);
    });
    child.stdin.end(prompt);
  });
}

// 決定這次要用的引擎：受試者自備金鑰（後臺有開放時）優先，其次後臺設定
function resolveEngine(byok) {
  const s = settings.get();
  if (s.allowUserKey && byok && settings.KEY_PROVIDERS.includes(byok.provider) && typeof byok.key === 'string' && byok.key.trim().length >= 10) {
    const model = byok.model && settings.MODEL_RE.test(byok.model) ? byok.model : s.models[byok.provider];
    return { provider: byok.provider, model, key: byok.key.trim().slice(0, 300), source: 'user' };
  }
  if (s.provider === 'cli') {
    if (process.env.STORAGE === 'blobs') return { provider: 'local', model: 'rule-based-kb', source: 'fallback' };
    return { provider: 'cli', tool: s.cli.tool, model: s.cli.model || '', source: 'admin' };
  }
  if (settings.KEY_PROVIDERS.includes(s.provider)) {
    const key = settings.keyFor(s.provider, s);
    if (key) return { provider: s.provider, model: s.models[s.provider], key, source: 'admin' };
  }
  return { provider: 'local', model: 'rule-based-kb', source: 'admin' };
}

async function callEngine(eng, system, text) {
  if (eng.provider === 'gemini') return callGemini(eng.key, eng.model, system, text);
  if (eng.provider === 'openai' || eng.provider === 'groq') return callOpenAICompat(eng.provider, eng.key, eng.model, system, text);
  if (eng.provider === 'cli') return callCLI(eng.tool, eng.model, system, text);
  return null;
}

// 記錄用的引擎名稱，例如 gemini:gemini-3.5-flash、cli:codex、user-gemini:gemini-3.5-flash
function engineLabel(eng) {
  if (eng.provider === 'cli') return `cli:${eng.tool}${eng.model ? '/' + eng.model : ''}`;
  if (eng.provider === 'local') return 'local';
  return `${eng.source === 'user' ? 'user-' : ''}${eng.provider}:${eng.model}`;
}

// LLM 回覆後置檢查：若出現看似個人化劑量的內容，改用安全回覆
const DOSE_OUT_RE = /(\d+\s*(單位|u\b|iu)|每次\s*\d+\s*(顆|錠|mg|毫克))/i;

function providerInfo() {
  const eng = resolveEngine(null);
  return { provider: eng.provider, model: eng.provider === 'cli' ? `${eng.tool}${eng.model ? '/' + eng.model : ''}` : eng.model, label: PROVIDER_LABEL[eng.provider], generative: eng.provider !== 'local' };
}

// 給受試者端：是否開放自備金鑰、目前引擎名稱（不含金鑰）
function publicConfig() {
  const s = settings.get();
  const info = providerInfo();
  return { allowUserKey: !!s.allowUserKey, engine: info.label, generative: info.generative, options: { gemini: MODEL_OPTIONS.gemini, openai: MODEL_OPTIONS.openai, groq: MODEL_OPTIONS.groq }, defaults: s.models };
}

async function ask(question, moduleId, opts = {}) {
  const c = content.load();
  const q = String(question || '').slice(0, 500);
  const category = classify(q);
  const g = guard(q);
  if (g) return { answer: c.ai.refusals[g], category, guardrail: g, provider: 'guardrail' };
  if (category === 'other' && OFFTOPIC_RE.test(q)) return { answer: c.ai.refusals.offtopic, category, guardrail: 'offtopic', provider: 'guardrail' };

  const eng = opts.forceLocal ? { provider: 'local' } : resolveEngine(opts.byok);
  const mod = (c.modules || []).find(m => m.id === moduleId);
  let llmError = null;
  if (eng.provider !== 'local') {
    try {
      const raw = await callEngine(eng, SYSTEM_PROMPT, userText(q, mod?.title));
      // 受試者畫面是純文字：去掉模型殘留的 Markdown 粗體與標題符號
      const out = raw && raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').trim();
      if (out) {
        if (DOSE_OUT_RE.test(out)) return { answer: c.ai.refusals.dose, category, guardrail: 'dose_output', provider: engineLabel(eng) };
        return { answer: out, category, guardrail: null, provider: engineLabel(eng) };
      }
    } catch (e) {
      llmError = e.message;
      console.warn('[AI] LLM 呼叫失敗，改用本機知識庫：', e.message);
    }
  }
  const prov = llmError ? `local(fallback:${eng.provider})` : 'local';
  const local = localAnswer(q, category);
  if (local) return { answer: local, category, guardrail: null, provider: prov, llm_error: llmError };
  return { answer: c.ai.refusals.offtopic, category, guardrail: 'offtopic', provider: prov, llm_error: llmError };
}

// 後臺「測試連線」：用指定設定（或目前設定）問一題，回傳結果與耗時
async function testEngine(cfg) {
  const s = settings.get();
  let eng;
  if (cfg && cfg.provider === 'cli') eng = { provider: 'cli', tool: settings.CLI_TOOLS.includes(cfg.tool) ? cfg.tool : s.cli.tool, model: cfg.model && settings.MODEL_RE.test(cfg.model) ? cfg.model : '' };
  else if (cfg && settings.KEY_PROVIDERS.includes(cfg.provider)) {
    eng = { provider: cfg.provider, model: cfg.model && settings.MODEL_RE.test(cfg.model) ? cfg.model : s.models[cfg.provider], key: (cfg.key && cfg.key.trim()) || settings.keyFor(cfg.provider, s) };
    if (!eng.key) return { ok: false, error: '尚未設定這個引擎的 API 金鑰' };
  } else eng = resolveEngine(null);
  if (eng.provider === 'local') return { ok: true, engine: 'local', answer: '目前使用本機衛教知識庫（不需金鑰）。' };
  const t0 = Date.now();
  try {
    const answer = await callEngine(eng, SYSTEM_PROMPT, '請用一句話說明什麼是糖化血色素（HbA1c）。');
    return { ok: !!answer, engine: engineLabel(eng), ms: Date.now() - t0, answer: answer || '' };
  } catch (e) {
    return { ok: false, engine: engineLabel(eng), ms: Date.now() - t0, error: e.message };
  }
}

module.exports = { ask, classify, guard, providerInfo, publicConfig, testEngine, callEngine, MODEL_OPTIONS, PROVIDER_LABEL, CATEGORIES };
