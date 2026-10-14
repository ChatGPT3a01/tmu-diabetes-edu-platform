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
    ['participants', '每位受試者一列：基本資料、知識前後測分數、進步分數、學習時間、AI 使用次數、再測次數、各量表前後測總分（*_pre_sum／*_post_sum）'],
    ['pre_post_test', '長格式：每位受試者 × 測驗階段 × 題目；phase：pre 前測、post 後測（正式）、retake1/2… 完成後再測（練習，非正式後測）；correct 1=答對'],
    ['learning_events', '完整學習行為事件紀錄（event logging）'],
    ['module_performance', '每位受試者 × 8 模組：起訖時間、停留秒數、首次答對率、回饋檢視、AI 提問數'],
    ['ai_interactions', 'AI 提問紀錄與自動分類（knowledge/blood_glucose/diet/exercise/medication/hypoglycemia/foot_care/complication/other）'],
    ['questionnaires', '寬格式。前測問卷與後測問卷題目相同，欄位加 _pre／_post：健康識能 HL01–05、焦慮 AX01–07、學習自我效能 LSE01–05、自我管理自我效能 SE01–10，各附 *_sum 總分與 *_mean 平均'],
    ['', '滿意度問卷（後測一次）：衛教滿意度 ESAT01–07、edu_satisfaction_sum/mean、ESOPEN01；科技接受與系統滿意度 SUS01–10、sus_score（0–100）、SAT01–03、OPEN01–02'],
    ['', '計分：所有量表 1–5 分正向計分（焦慮分數越高代表越焦慮）；SUS 依標準公式轉 0–100'],
    ['', '注意：同意書改為現場紙本簽署，consent_at／consent_completed（response=paper_consent）代表首次登入時間']
  ].forEach(r => readme.addRow(r));
  return wb.xlsx.writeBuffer();
}

module.exports = { TABLES, toCSV, toXLSX };
