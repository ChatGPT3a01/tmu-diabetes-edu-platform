// 衛教內容讀取／後臺更新（含自動備份）
const fs = require('fs');
const path = require('path');

const HERE = typeof __dirname === 'string' ? __dirname : process.cwd(); // 被打包進 Netlify 函式時沒有 __dirname
const CONTENT_PATH = path.join(HERE, '..', 'content', 'content.json');
const BACKUP_DIR = path.join(HERE, '..', 'content', 'backups');
let cache = null;

// Netlify（STORAGE=blobs）環境檔案系統唯讀：後臺修改的內容存在 Blobs，由 blobsync 注入覆寫
let override = null, pendingSave = null, blobBackups = [];
function setOverride(obj) { override = obj; }
function takePendingSave() { const p = pendingSave; pendingSave = null; return p; }
function setBlobBackups(list) { blobBackups = list; }

function load() {
  if (override) return override;
  // Netlify 函式：衛教內容直接打包進程式（require JSON），不依賴檔案路徑
  if (!cache) cache = process.env.STORAGE === 'blobs' ? JSON.parse(JSON.stringify(require('../content/content.json'))) : JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
  return cache;
}

// 給受試者端的內容：移除知識測驗答案，避免前端可查到標準答案
function publicContent() {
  const c = load();
  const copy = JSON.parse(JSON.stringify(c));
  copy.knowledgeTest.items = copy.knowledgeTest.items.map(({ answer, ...rest }) => rest);
  delete copy.ai.knowledge;
  return copy;
}

function validate(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object') return ['內容不是 JSON 物件'];
  if (!Array.isArray(obj.modules) || obj.modules.length !== 8) errs.push('modules 必須剛好 8 個模組');
  const items = obj.knowledgeTest && obj.knowledgeTest.items;
  if (!Array.isArray(items) || items.length < 20) errs.push('knowledgeTest.items 至少 20 題');
  (items || []).forEach(it => {
    if (!it.id || !it.domain || !Array.isArray(it.options) || typeof it.answer !== 'number' || it.answer < 0 || it.answer >= it.options.length)
      errs.push(`題目 ${it.id || '?'} 欄位不完整或答案索引錯誤`);
  });
  (obj.modules || []).forEach(m => {
    (m.questions || []).forEach(q => {
      if (typeof q.answer !== 'number' || !q.options || q.answer >= q.options.length) errs.push(`模組題 ${q.id} 答案索引錯誤`);
    });
  });
  return errs;
}

function save(obj) {
  const errs = validate(obj);
  if (errs.length) { const e = new Error(errs.join('；')); e.status = 400; throw e; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (process.env.STORAGE === 'blobs') {
    pendingSave = { stamp, prev: load(), next: obj };
    override = obj;
    return stamp;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.copyFileSync(CONTENT_PATH, path.join(BACKUP_DIR, `content_${stamp}.json`));
  fs.writeFileSync(CONTENT_PATH, JSON.stringify(obj, null, 2), 'utf8');
  cache = null;
  return stamp;
}

function listBackups() {
  if (process.env.STORAGE === 'blobs') return blobBackups.slice().sort().reverse();
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().reverse();
}

module.exports = { load, publicContent, save, validate, listBackups, setOverride, takePendingSave, setBlobBackups };
