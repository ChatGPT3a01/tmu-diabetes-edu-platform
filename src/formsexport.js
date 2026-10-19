// 問卷匯出成 Google 表單（傳統組／對照組施測用）
// 產生一支 Google Apps Script：貼到 script.google.com 執行 createAllForms()，自動建立
//   1. 前測：編號＋基本資料＋知識前測（測驗模式，每題 10 分）＋前測問卷
//   2. 後測：編號＋知識後測（同題）＋後測問卷
//   3. 滿意度：編號＋衛教滿意度（平台專屬的 SUS／系統滿意度預設不放，可改 INCLUDE_PLATFORM_SATISFACTION）
// 題目直接取自平台目前的衛教內容（content.json／後臺修改後的版本），量表題以 1–5 線性刻度記分，與平台資料編碼一致
const content = require('./content');

function part(c, key) {
  const d = c[key];
  return { key, instrument: d.instrument, title: d.title, intro: d.intro, scale: d.scale, items: d.items.map(i => ({ id: i.id, text: i.text })), open: (d.open || []).map(o => ({ id: o.id, label: o.label })) };
}

function buildData(c = content.load()) {
  const kt = c.knowledgeTest;
  return {
    platform: c.meta?.title || '糖尿病互動衛教平台',
    generated_at: new Date().toISOString(),
    demographics: (c.demographics || []).map(d => ({ id: d.id, label: d.label, type: d.type, options: d.options })),
    knowledge: { title: kt.title, intro: kt.intro, items: kt.items.map(i => ({ id: i.id, stem: i.stem, options: i.options, answer: i.answer })) },
    surveys: Object.fromEntries(Object.entries(c.surveys || {}).map(([sid, sv]) => [sid, { title: sv.title, intro: sv.intro, parts: sv.parts.map(k => part(c, k)) }]))
  };
}

const SCRIPT_BODY = String.raw`
// ===== 設定 =====
var INCLUDE_PLATFORM_SATISFACTION = false; // true＝滿意度表單也放「科技接受與系統滿意度（SUS）」（傳統組通常不需要）
var FORM_PREFIX = '糖尿病衛教｜傳統組｜';

// 執行這個函式：建立 3 份表單＋1 份回覆試算表，網址會印在「執行記錄」
function createAllForms() {
  var ss = SpreadsheetApp.create(FORM_PREFIX + '回覆資料');
  var out = [];
  out.push(makeForm_('前測', DATA.surveys.pre, true, true, ss));
  out.push(makeForm_('後測', DATA.surveys.post, false, true, ss));
  out.push(makeForm_('滿意度問卷', DATA.surveys.sat, false, false, ss));
  Logger.log('回覆試算表：' + ss.getUrl());
  out.forEach(function (f) { Logger.log(f.name + '\n  填答網址（給受試者）：' + f.publishedUrl + '\n  編輯網址（研究者）：' + f.editUrl); });
}

function makeForm_(name, survey, withDemographics, withKnowledge, ss) {
  var form = FormApp.create(FORM_PREFIX + name);
  form.setDescription('本問卷沒有對錯（知識測驗除外），請依照自己的實際情況作答。\n題目來源：' + DATA.platform + '（匯出時間 ' + DATA.generated_at.slice(0, 10) + '）');
  form.setCollectEmail(false);
  form.setProgressBar(true);
  form.addTextItem().setTitle('編號').setHelpText('請填寫現場提供的編號（前測、後測要填同一個編號）').setRequired(true);

  if (withDemographics) {
    form.addPageBreakItem().setTitle('基本資料');
    DATA.demographics.forEach(function (d) {
      var it = d.type === 'multi' ? form.addCheckboxItem() : form.addMultipleChoiceItem();
      it.setTitle(d.label).setChoiceValues(d.options).setRequired(true);
    });
  }

  if (withKnowledge) {
    form.setIsQuiz(true);
    form.addPageBreakItem().setTitle(DATA.knowledge.title).setHelpText(DATA.knowledge.intro);
    DATA.knowledge.items.forEach(function (q, i) {
      var it = form.addMultipleChoiceItem();
      it.setTitle((i + 1) + '. ' + q.stem).setHelpText(q.id)
        .setChoices(q.options.map(function (o, j) { return it.createChoice(o, j === q.answer); }))
        .setPoints(10).setRequired(true);
    });
  }

  survey.parts.forEach(function (p) {
    if (!INCLUDE_PLATFORM_SATISFACTION && p.instrument === 'satisfaction') return;
    form.addPageBreakItem().setTitle(p.title).setHelpText(p.intro + '\n作答方式：1＝' + p.scale[0] + '，2＝' + p.scale[1] + '，3＝' + p.scale[2] + '，4＝' + p.scale[3] + '，5＝' + p.scale[4]);
    p.items.forEach(function (q, i) {
      form.addScaleItem().setTitle((i + 1) + '. ' + q.text).setHelpText(q.id)
        .setBounds(1, 5).setLabels(p.scale[0], p.scale[4]).setRequired(true);
    });
    p.open.forEach(function (o) { form.addParagraphTextItem().setTitle(o.label).setHelpText(o.id).setRequired(false); });
  });

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  return { name: name, publishedUrl: form.getPublishedUrl(), editUrl: form.getEditUrl() };
}
`;

function buildAppsScript(c) {
  const data = buildData(c);
  return `/**
 * ${data.platform}：問卷匯出成 Google 表單（傳統組／對照組施測用）
 * 匯出時間：${data.generated_at}
 *
 * 使用方式：
 *   1. 開啟 https://script.google.com → 新專案
 *   2. 刪除預設內容，把這整個檔案貼上，按「儲存」
 *   3. 上方函式選單選 createAllForms → 按「執行」→ 第一次會要求授權（選自己的 Google 帳號 → 允許）
 *   4. 約 1 分鐘後，到「執行記錄」複製 3 份表單的填答網址與回覆試算表網址
 *
 * 計分對照：量表題回覆為 1–5 數字，與平台資料一致；知識測驗為測驗模式，每題 10 分、滿分 100。
 * 題目代號（HL01、K02…）放在每題說明，方便和平台資料對照。
 */
var DATA = ${JSON.stringify(data, null, 2)};
${SCRIPT_BODY}`;
}

module.exports = { buildAppsScript, buildData };
