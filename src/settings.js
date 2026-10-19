// AI 設定（研究者後臺可改）：引擎、模型、API 金鑰、是否允許受試者自備金鑰
// 本機：存 data/ai_settings.json；Netlify（STORAGE=blobs）：存 Blobs settings/ai，由 blobsync 載入／寫回
// 金鑰只存在伺服器端，回傳給後臺時一律遮罩；不寫進程式碼與內容檔
const fs = require('fs');
const path = require('path');

const HERE = typeof __dirname === 'string' ? __dirname : process.cwd();
const BLOBS = process.env.STORAGE === 'blobs';
const FILE = path.join(process.env.DATA_DIR || path.join(HERE, '..', 'data'), 'ai_settings.json');

const PROVIDERS = ['local', 'gemini', 'openai', 'groq', 'cli'];
const KEY_PROVIDERS = ['gemini', 'openai', 'groq'];
const CLI_TOOLS = ['codex', 'gemini', 'claude'];

// 環境變數仍可當預設值（舊版部署設定照常有效）
function defaults() {
  const p = (process.env.LLM_PROVIDER || 'local').toLowerCase();
  return {
    provider: PROVIDERS.includes(p) ? p : 'local',
    models: {
      gemini: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      openai: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      groq: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
    },
    keys: { gemini: '', openai: '', groq: '' },
    cli: { tool: 'codex', model: '' },
    allowUserKey: false,
    updated_at: null,
    updated_by: null
  };
}

let blobValue = null, pendingSave = null;
function setOverride(v) { blobValue = v; }
function takePendingSave() { const p = pendingSave; pendingSave = null; return p; }

function merge(base, v) {
  if (!v || typeof v !== 'object') return base;
  return {
    ...base, ...v,
    models: { ...base.models, ...(v.models || {}) },
    keys: { ...base.keys, ...(v.keys || {}) },
    cli: { ...base.cli, ...(v.cli || {}) }
  };
}

function get() {
  let stored = null;
  if (BLOBS) stored = blobValue;
  else if (fs.existsSync(FILE)) { try { stored = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { stored = null; } }
  return merge(defaults(), stored);
}

// 實際可用的金鑰：後臺輸入優先，其次環境變數
const ENV_KEY = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', groq: 'GROQ_API_KEY' };
function keyFor(provider, s = get()) { return (s.keys && s.keys[provider]) || process.env[ENV_KEY[provider]] || ''; }

const MODEL_RE = /^[A-Za-z0-9._:\/-]{1,80}$/;
function mask(k) { return k ? `已設定（…${k.slice(-4)}）` : ''; }

// 給後臺看的版本：金鑰只顯示末 4 碼
function publicView() {
  const s = get();
  const keys = {};
  for (const p of KEY_PROVIDERS) keys[p] = { set: !!keyFor(p, s), label: mask(keyFor(p, s)), source: s.keys[p] ? 'admin' : (process.env[ENV_KEY[p]] ? 'env' : '') };
  return { provider: s.provider, models: s.models, cli: s.cli, allowUserKey: !!s.allowUserKey, keys, cliAvailable: !BLOBS, updated_at: s.updated_at, updated_by: s.updated_by };
}

// patch.keys[p]：非空字串＝更新；null＝清除；未提供或空字串＝保留原值
function save(patch, username) {
  const cur = get();
  const next = merge(cur, {});
  if (patch.provider !== undefined) {
    if (!PROVIDERS.includes(patch.provider)) throw bad('AI 引擎選項錯誤');
    if (patch.provider === 'cli' && BLOBS) throw bad('雲端網站無法使用 CLI，CLI 只能在本機（start.bat）使用');
    next.provider = patch.provider;
  }
  for (const p of KEY_PROVIDERS) {
    const m = patch.models && patch.models[p];
    if (m !== undefined && m !== '') { if (!MODEL_RE.test(m)) throw bad('模型名稱格式錯誤'); next.models[p] = m; }
    const k = patch.keys && patch.keys[p];
    if (k === null) next.keys[p] = '';
    else if (typeof k === 'string' && k.trim()) { if (k.trim().length > 300) throw bad('金鑰過長'); next.keys[p] = k.trim(); }
  }
  if (patch.cli) {
    if (patch.cli.tool !== undefined) { if (!CLI_TOOLS.includes(patch.cli.tool)) throw bad('CLI 工具選項錯誤'); next.cli.tool = patch.cli.tool; }
    if (patch.cli.model !== undefined) { if (patch.cli.model && !MODEL_RE.test(patch.cli.model)) throw bad('模型名稱格式錯誤'); next.cli.model = patch.cli.model || ''; }
  }
  if (patch.allowUserKey !== undefined) next.allowUserKey = !!patch.allowUserKey;
  next.updated_at = new Date().toISOString();
  next.updated_by = username || null;
  if (BLOBS) { pendingSave = next; blobValue = next; }
  else { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8'); }
  return publicView();
}

function bad(msg) { const e = new Error(msg); e.status = 400; return e; }

module.exports = { get, save, keyFor, publicView, setOverride, takePendingSave, PROVIDERS, KEY_PROVIDERS, CLI_TOOLS, MODEL_RE };
