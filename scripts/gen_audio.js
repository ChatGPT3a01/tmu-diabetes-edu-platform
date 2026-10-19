// 預錄衛教語音：把受試者端每個「🔊」按鈕的文字轉成 mp3（public/audio/<雜湊>.mp3）＋ manifest.json
// 用法（在 app 資料夾）：node scripts/gen_audio.js [--voice zh-TW-HsiaoChenNeural] [--rate -10%] [--jobs 2] [--gap 800] [--prune]
// 需要 edge-tts（pip install edge-tts）。已存在的音檔會略過；衛教內容修改後重跑即可補上新段落，--prune 會刪除用不到的舊音檔。
// 文字組成規則必須與 public/js/app.js 的 ttsBtn(...) 呼叫一致，雜湊算法與 ttsHash 相同（FNV-1a 32 位元）。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'audio');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VOICE = arg('--voice', 'zh-TW-HsiaoChenNeural');
const RATE = arg('--rate', '-10%');
const PRUNE = process.argv.includes('--prune');
const JOBS = Math.max(1, Number(arg('--jobs', 2)) || 2); // 語音服務會限流（HTTP 403），並行不要太多
const GAP = Number(arg('--gap', 800)); // 每段之間的間隔毫秒
const sleep = ms => new Promise(r => setTimeout(r, ms));

const clean = t => String(t).replace(/[①-⑧]/g, '');
const hash = t => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const choiceText = q => q.stem + '。' + q.options.map((o, i) => `選項${i + 1}，${o}`).join('。');

function collect(c) {
  const list = [];
  const add = (text, where) => list.push({ text: clean(text), where });
  for (const m of c.modules) {
    add('學習目標。' + m.objectives.join('。'), `${m.id} 學習目標`);
    m.sections.forEach((s, i) => add(s.title + '。' + s.text, `${m.id} 圖文 ${i + 1}`));
    if (m.insulin) add(m.insulin.steps.map(s => s.title + '。' + s.text).join('。'), `${m.id} ${m.insulin.title}`);
    add(m.case.title + '。' + m.case.story, `${m.id} 生活案例`);
    (m.questions || []).forEach(q => add(choiceText(q), `${m.id} 互動問題 ${q.id}`));
  }
  c.knowledgeTest.items.forEach(it => add(choiceText(it), `知識測驗 ${it.id}`));
  const parts = new Set(Object.values(c.surveys || {}).flatMap(s => s.parts));
  for (const p of parts) c[p].items.forEach(it => add(it.text, `問卷 ${it.id}`));
  const seen = new Map();
  for (const x of list) { x.hash = hash(x.text); if (!seen.has(x.hash)) seen.set(x.hash, x); }
  return [...seen.values()];
}

function tts(text, file) {
  return new Promise((resolve, reject) => {
    const tmp = file + '.txt', part = file + '.part';
    fs.writeFileSync(tmp, text, 'utf8');
    const p = spawn('edge-tts', ['--voice', VOICE, `--rate=${RATE}`, '-f', tmp, '--write-media', part], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      fs.rmSync(tmp, { force: true });
      // 先寫到 .part，確認是完整音檔才改名，避免失敗留下空檔被當成已完成
      if (code === 0 && fs.existsSync(part) && fs.statSync(part).size > 1000) { fs.renameSync(part, file); resolve(); }
      else { fs.rmSync(part, { force: true }); reject(new Error(`edge-tts exit ${code} ${err.slice(-200)}`)); }
    });
  });
}

async function main() {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'content.json'), 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const items = collect(c);
  const ok = h => { const f = path.join(OUT, h + '.mp3'); return fs.existsSync(f) && fs.statSync(f).size > 1000; };
  const todo = items.filter(x => !ok(x.hash));
  console.log(`共 ${items.length} 段，需產生 ${todo.length} 段（聲音 ${VOICE}，語速 ${RATE}）`);
  let n = 0; const failed = [];
  const worker = async () => {
    for (let x; (x = todo.shift());) {
      for (let attempt = 1; ; attempt++) {
        try { await tts(x.text, path.join(OUT, x.hash + '.mp3')); break; }
        catch (e) { if (attempt >= 4) { failed.push(`${x.where}：${e.message.slice(0, 120)}`); break; } await sleep(attempt * 15000); }
      }
      if (++n % 20 === 0) console.log(`  已完成 ${n} 段`);
      await sleep(GAP);
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  const files = items.map(x => x.hash).filter(ok);
  if (PRUNE) for (const f of fs.readdirSync(OUT)) if (f.endsWith('.mp3') && !files.includes(f.slice(0, -4))) fs.rmSync(path.join(OUT, f));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ voice: VOICE, rate: RATE, generated_at: new Date().toISOString(), files, index: items.filter(x => files.includes(x.hash)).map(x => ({ hash: x.hash, where: x.where })) }, null, 1), 'utf8');
  console.log(`完成：${files.length}/${items.length} 段有音檔${failed.length ? `；失敗 ${failed.length} 段：\n  ` + failed.join('\n  ') : ''}`);
  if (failed.length) process.exitCode = 1;
}
main();
