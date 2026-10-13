// CSV（UTF-8 BOM，Excel/SPSS/R/Python 皆可讀）與 Excel 匯出
const ExcelJS = require('exceljs');
const stats = require('./stats');

const TABLES = ['participants', 'pre_post_test', 'learning_events', 'module_performance', 'ai_interactions', 'questionnaires'];

function toCSV(rows) {
  if (!rows.length) return '﻿';
  const cols = Object.keys(rows[0]);
  const esc = v => {
    if (v == null) return '';
    let s = String(v);
    // 防 CSV 公式注入
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
}

async function toXLSX(includeSim) {
  const t = stats.exportTables(includeSim);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DM Edu Platform'; wb.created = new Date();
  for (const name of TABLES) {
    const rows = t[name];
    const ws = wb.addWorksheet(name);
    const cols = rows.length ? Object.keys(rows[0]) : ['(no data)'];
    ws.columns = cols.map(c => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 2)) }));
    rows.forEach(r => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const readme = wb.addWorksheet('README');
  [
    ['糖尿病互動衛教平台 研究資料匯出'],
    ['匯出時間', new Date().toISOString()],
    ['含模擬資料', includeSim ? '是（is_simulated=1 為模擬）' : '否'],
    ['participants', '每位受試者一列：基本資料、前後測分數、進步分數、學習時間、AI 使用次數'],
    ['pre_post_test', '長格式：每位受試者 × 測驗階段（pre/post）× 題目；correct 1=答對'],
    ['learning_events', '完整學習行為事件紀錄（event logging）'],
    ['module_performance', '每位受試者 × 8 模組：起訖時間、停留秒數、首次答對率、回饋檢視、AI 提問數'],
    ['ai_interactions', 'AI 提問紀錄與自動分類（knowledge/blood_glucose/diet/exercise/medication/hypoglycemia/foot_care/complication/other）'],
    ['questionnaires', '寬格式：自我效能 SE01–SE10、se_mean；SUS01–10、sus_score（0–100）；SAT01–03；開放題']
  ].forEach(r => readme.addRow(r));
  return wb.xlsx.writeBuffer();
}

module.exports = { TABLES, toCSV, toXLSX };
