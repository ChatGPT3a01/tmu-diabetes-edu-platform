// 衛教內容讀取／後臺更新（含自動備份）
const fs = require('fs');
const path = require('path');

const CONTENT_PATH = path.join(__dirname, '..', 'content', 'content.json');
const BACKUP_DIR = path.join(__dirname, '..', 'content', 'backups');
let cache = null;

function load() {
  if (!cache) cache = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
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
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(CONTENT_PATH, path.join(BACKUP_DIR, `content_${stamp}.json`));
  fs.writeFileSync(CONTENT_PATH, JSON.stringify(obj, null, 2), 'utf8');
  cache = null;
  return stamp;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().reverse();
}

module.exports = { load, publicContent, save, validate, listBackups };
