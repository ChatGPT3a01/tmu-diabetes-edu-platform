/* 研究者後臺 */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = '—') => v == null || v === '' ? d : v;
  const fmtTime = s => s ? new Date(s).toLocaleString('zh-TW', { hour12: false }) : '—';
  let ME = null; let charts = [];
  const CAT_ZH = { knowledge: '基礎知識', blood_glucose: '血糖監測', diet: '飲食', exercise: '運動', medication: '藥物', hypoglycemia: '低血糖', foot_care: '足部照護', complication: '併發症', other: '其他' };
  const PALETTE = ['#8e4a9e', '#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#db2777', '#0891b2', '#b91c1c', '#64748b'];
  const pfmt = p => p == null ? '—' : (String(p).startsWith('<') ? 'p ' + p : 'p = ' + p);

  async function api(path, opts = {}) {
    const res = await fetch(path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error(j.error || '請先登入'); }
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }
  const incSim = () => $('#inc-sim').checked ? '1' : '0';
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function chart(canvas, cfg) {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = css('--ink-2');
    Chart.defaults.borderColor = css('--line');
    const c = new Chart(canvas, cfg); charts.push(c); return c;
  }
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

  // ---------- 登入 ----------
  function showLogin() { $('#app-view').hidden = true; $('#login-view').hidden = false; $('#lu').focus(); }
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#login-err'); err.hidden = true;
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: { username: $('#lu').value, password: $('#lp').value } });
      $('#lp').value = ''; ME = r.user; startApp();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => { }); ME = null; showLogin(); });
  $('#inc-sim').addEventListener('change', () => { try { localStorage.setItem('dm_admin_sim', $('#inc-sim').checked ? '1' : '0'); } catch { } render(); });
  try { if (localStorage.getItem('dm_admin_sim') === '0') $('#inc-sim').checked = false; } catch { }
  $('#nav-toggle').addEventListener('click', () => { const n = $('#nav'); n.classList.toggle('open'); $('#nav-toggle').setAttribute('aria-expanded', n.classList.contains('open')); });

  function startApp() {
    $('#login-view').hidden = true; $('#app-view').hidden = false;
    $('#who').textContent = `${ME.display_name || ME.username}（${ME.role === 'admin' ? '管理者' : '研究者'}）`;
    $('.nav-admin').hidden = ME.role !== 'admin';
    if (!location.hash) location.hash = '#/overview'; else render();
  }

  // ---------- 路由 ----------
  const R = {};
  window.addEventListener('hashchange', render);
  async function render() {
    if (!ME) return;
    charts.forEach(c => c.destroy()); charts = [];
    const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
    const view = R[name] ? name : 'overview';
    $$('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/' + view));
    $('#nav').classList.remove('open');
    const main = $('#main'); main.innerHTML = '<p class="muted">載入中…</p>';
    try { await R[view](main, arg); } catch (e) { main.innerHTML = `<div class="feedback bad"><h3>載入失敗</h3><p>${esc(e.message)}</p></div>`; }
  }

  const kpi = (l, v, s = '') => `<div class="kpi"><div class="l">${l}</div><div class="v">${fmt(v)}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

  R.overview = async (el) => {
    const d = await api('/api/admin/dashboard?include_sim=' + incSim());
    const s = d.summary;
    el.innerHTML = `<h1>總覽 Dashboard</h1><p class="note">資料產生時間：${fmtTime(d.generated_at)}｜${d.include_simulated ? '含模擬資料' : '僅真實受試者'}（模擬 ${s.simulated} 位）</p>
      <div class="kpis">
        ${kpi('受試者人數', s.participants, `全程完成 ${s.completed} 位`)}
        ${kpi('前測平均分數', s.pretest_mean, `SD ${fmt(s.pretest_sd)}｜n=${s.pretest_n}`)}
        ${kpi('後測平均分數', s.posttest_mean, `SD ${fmt(s.posttest_sd)}｜n=${s.posttest_n}`)}
        ${kpi('平均進步分數', s.gain_mean, `SD ${fmt(s.gain_sd)}｜配對 n=${s.paired_n}`)}
        ${kpi('配對 t 檢定', s.paired_t, `p ${s.paired_p == null ? '—' : (String(s.paired_p).startsWith('<') ? s.paired_p : '= ' + s.paired_p)}`)}
        ${kpi('平均學習時間（分）', s.avg_learning_min, `8 模組停留合計｜全程 ${fmt(s.avg_total_min)} 分`)}
        ${kpi('AI 使用次數', s.ai_total, `人均 ${fmt(s.ai_per_participant)}｜使用者 ${s.ai_users} 位`)}
        ${kpi('自我管理自我效能（後測）', s.se_mean, '1–5 分')}
        ${kpi('衛教滿意度', s.edu_sat_mean, '1–5 分')}
        ${kpi('SUS 系統易用性', s.sus_mean, '0–100 分（68 為平均）')}
        ${kpi('今日瀏覽人次', d.visits.today.visitors, `今日瀏覽 ${d.visits.today.visits} 次｜30 天 ${d.visits.total_visitors_30d} 人次`)}
        ${kpi('完成後再測', s.retake_total, '知識測驗練習次數（不計入正式後測）')}
      </div>
      <div class="card"><h2>每日瀏覽人次（最近 30 天）</h2><p class="note">瀏覽人次＝當天開啟網站的不同裝置數（匿名，同一裝置一天算 1 人次）；瀏覽次數＝開啟網站的次數；登入使用者＝當天有學習紀錄的編號數。</p><div class="chart-box"><canvas id="c-visits"></canvas></div></div>
      <div class="card"><h2>問卷前後測（配對 t 檢定）</h2>${scaleTable(d.scales)}</div>
      <div class="grid-2">
        <div class="card"><h2>研究流程漏斗</h2><div class="chart-box"><canvas id="c-funnel"></canvas></div></div>
        <div class="card"><h2>前測 vs 後測（個別受試者）</h2><div class="chart-box"><canvas id="c-paired"></canvas></div></div>
        <div class="card"><h2>8 模組完成率（%）</h2><div class="chart-box"><canvas id="c-mod"></canvas></div></div>
        <div class="card"><h2>AI 問題類型分布</h2><div class="chart-box"><canvas id="c-cat"></canvas></div></div>
      </div>`;
    chart($('#c-visits'), { type: 'line', data: { labels: d.visits.series.map(v => v.day.slice(5)), datasets: [
      { label: '瀏覽人次', data: d.visits.series.map(v => v.visitors), borderColor: '#8e4a9e', backgroundColor: 'rgba(142,74,158,.15)', fill: true, tension: .25 },
      { label: '瀏覽次數', data: d.visits.series.map(v => v.visits), borderColor: '#db2777', borderDash: [6, 4], tension: .25 },
      { label: '登入使用者', data: d.visits.series.map(v => v.active_users), borderColor: '#2563eb', tension: .25 }
    ] }, options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    chart($('#c-funnel'), { type: 'bar', data: { labels: d.funnel.map(f => f.stage), datasets: [{ label: '人數', data: d.funnel.map(f => f.n), backgroundColor: '#8e4a9e' }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    chart($('#c-paired'), {
      type: 'line', data: { labels: ['前測', '後測'], datasets: d.scores.map((p, i) => ({ label: p.participant_id, data: [p.pre, p.post], borderColor: p.post >= p.pre ? 'rgba(142,74,158,.45)' : 'rgba(185,28,28,.6)', pointRadius: 3, fill: false })) },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, title: { display: true, text: '分數' } } } }
    });
    chart($('#c-mod'), { type: 'bar', data: { labels: d.modules.map(m => m.title), datasets: [{ label: '完成率', data: d.modules.map(m => m.completion_rate), backgroundColor: PALETTE }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } } });
    const cats = Object.entries(d.ai.categories);
    chart($('#c-cat'), { type: 'doughnut', data: { labels: cats.map(([k]) => CAT_ZH[k] || k), datasets: [{ data: cats.map(([, v]) => v), backgroundColor: PALETTE }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } } });
  };

  function scaleTable(rows) {
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>量表（1–5 分平均）</th><th>前測 M（SD）</th><th>後測 M（SD）</th><th>差異</th><th>配對 n</th><th>t</th><th>p</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.title)}${r.key === 'anxiety' ? '<br><span class="note">分數越低越不焦慮</span>' : ''}</td><td>${fmt(r.pre_mean)}（${fmt(r.pre_sd)}）</td><td>${fmt(r.post_mean)}（${fmt(r.post_sd)}）</td>
        <td>${fmt(r.diff_mean)}</td><td>${r.paired_n}</td><td>${fmt(r.t)}</td><td>${pfmt(r.p)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">配對樣本 t 檢定（雙尾），僅供即時檢視；正式分析請匯出資料以 SPSS／R 進行。量表題目為研究團隊自擬，正式施測前需完成信效度檢驗。</p>`;
  }

  // 文字雲：依次數決定字級，螺旋排列避免重疊（不需外部套件）
  function wordCloud(canvas, words) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (!words.length) { ctx.fillStyle = css('--ink-2'); ctx.font = '16px sans-serif'; ctx.fillText('尚無 AI 提問資料', W / 2, H / 2); return; }
    const max = words[0].n, min = words[words.length - 1].n;
    const placed = [];
    const font = getComputedStyle(document.body).fontFamily;
    words.forEach((w, i) => {
      const size = Math.round(14 + (max === min ? 1 : (w.n - min) / (max - min)) * Math.min(46, W / 12));
      ctx.font = `${i < 5 ? 800 : 600} ${size}px ${font}`;
      const tw = ctx.measureText(w.text).width + 6, th = size * 1.05;
      for (let t = 0; t < 1400; t++) {
        const a = t * 0.32, r = 3.2 * Math.sqrt(t) * 2.2;
        const x = W / 2 + r * Math.cos(a) * 1.5, y = H / 2 + r * Math.sin(a) * 0.85;
        const box = { x: x - tw / 2, y: y - th / 2, w: tw, h: th };
        if (box.x < 2 || box.y < 2 || box.x + box.w > W - 2 || box.y + box.h > H - 2) continue;
        if (placed.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
        placed.push(box);
        ctx.fillStyle = w.source === 'ngram' ? '#64748b' : PALETTE[i % PALETTE.length];
        ctx.fillText(w.text, x, y);
        break;
      }
    });
  }

  // 行為轉移圖：節點排成圓形，箭頭＝顯著轉移（Z > 1.96），線寬依 Z 值
  function lsaDiagram(d) {
    const sig = d.significant.slice(0, 18);
    const used = d.codes.filter(c => c.n > 0);
    if (!sig.length) return '<p class="muted">資料不足，沒有顯著的行為轉移。</p>';
    const W = 760, H = 560, cx = W / 2, cy = H / 2, R = 210, bw = 112, bh = 46;
    const pos = {}; used.forEach((c, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / used.length; pos[c.code] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }; });
    const zmax = Math.max(...sig.map(x => x.z));
    const edge = e => {
      const A = pos[e.from], B = pos[e.to]; if (!A || !B) return '';
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
      const off = 34; // 往右側彎，讓 A→B 與 B→A 分開
      const mx = (A.x + B.x) / 2 + nx * off, my = (A.y + B.y) / 2 + ny * off;
      // 起訖點縮到方框外緣
      const clip = (P, Q) => { const vx = Q.x - P.x, vy = Q.y - P.y; const k = Math.min((bw / 2 + 4) / Math.abs(vx || 1e-6), (bh / 2 + 4) / Math.abs(vy || 1e-6)); return { x: P.x + vx * k, y: P.y + vy * k }; };
      const s1 = clip(A, { x: mx, y: my }), e1 = clip(B, { x: mx, y: my });
      const w = 1.5 + 5 * e.z / zmax;
      const lx = 0.25 * s1.x + 0.5 * mx + 0.25 * e1.x, ly = 0.25 * s1.y + 0.5 * my + 0.25 * e1.y;
      return `<path d="M${s1.x},${s1.y} Q${mx},${my} ${e1.x},${e1.y}" fill="none" stroke="#8e4a9e" stroke-opacity=".75" stroke-width="${w}" marker-end="url(#arr)"/>
        <rect x="${lx - 22}" y="${ly - 11}" width="44" height="22" rx="6" fill="var(--surface)" stroke="#e6d6ea"/><text x="${lx}" y="${ly + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">${e.z}</text>`;
    };
    return `<svg viewBox="0 0 ${W} ${H}" class="lsa-svg" role="img" aria-label="顯著行為轉移圖">
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8e4a9e"/></marker></defs>
      ${sig.map(edge).join('')}
      ${used.map(c => `<g><rect x="${pos[c.code].x - bw / 2}" y="${pos[c.code].y - bh / 2}" width="${bw}" height="${bh}" rx="12" fill="#fdf3e1" stroke="#1e3a8a" stroke-width="2"/>
        <text x="${pos[c.code].x}" y="${pos[c.code].y - 3}" text-anchor="middle" font-size="14" font-weight="700" fill="#1b2a2f">${esc(c.label)}</text>
        <text x="${pos[c.code].x}" y="${pos[c.code].y + 15}" text-anchor="middle" font-size="11" fill="#475569">${c.code}｜n=${c.n}</text></g>`).join('')}
    </svg>`;
  }

  R.lsa = async (el) => {
    const mod = sessionStorage.getItem('lsa_mod') || '', scope = sessionStorage.getItem('lsa_scope') || 'all';
    const [d, content] = await Promise.all([api(`/api/admin/lsa?include_sim=${incSim()}&module=${encodeURIComponent(mod)}&scope=${scope}`), api('/api/admin/content-full')]);
    const zc = z => z == null ? '' : z > 1.96 ? `background:rgba(142,74,158,${Math.min(.85, .2 + z / 40)});color:${z > 20 ? '#fff' : 'inherit'};font-weight:700` : z < -1.96 ? 'color:#94a3b8' : '';
    el.innerHTML = `<h1>行為序列分析（點擊行為軌跡）</h1>
      <p class="note">把每位受試者的學習事件依時間排成行為序列，計算相鄰兩個行為的轉移（lag 1）。Z 為調整後殘差（Bakeman &amp; Quera），<b>Z &gt; 1.96</b> 代表該轉移出現次數顯著高於隨機（p &lt; .05）。連續相同的行為合併為一次。</p>
      <div class="card"><div class="row">
        <label>單元 <select id="lsa-mod" class="input" style="width:auto"><option value="">全部單元</option>${content.modules.map(m => `<option value="${m.id}" ${m.id === mod ? 'selected' : ''}>${m.id} ${esc(m.title)}</option>`).join('')}</select></label>
        <label>對象 <select id="lsa-scope" class="input" style="width:auto"><option value="all">全部受試者</option><option value="completed" ${scope === 'completed' ? 'selected' : ''}>僅全程完成者</option></select></label>
        <span class="note">序列 ${d.n_sequences} 人｜行為 ${d.n_codes} 次｜轉移 ${d.n_transitions} 次</span></div></div>
      <div class="card"><h2>顯著行為轉移圖</h2><div class="lsa-wrap">${lsaDiagram(d)}</div>
        <p class="note">箭頭方向為「前一個行為 → 下一個行為」，數字為 Z 值，線越粗 Z 越大；最多顯示前 18 條。</p></div>
      <div class="grid-2"><div class="card"><h2>顯著轉移列表</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>前一行為</th><th>下一行為</th><th>次數</th><th>Z</th></tr></thead>
        <tbody>${d.significant.map(x => `<tr><td>${x.from} ${esc(d.codes.find(c => c.code === x.from).label)}</td><td>${x.to} ${esc(d.codes.find(c => c.code === x.to).label)}</td><td>${x.n}</td><td><b>${x.z}</b></td></tr>`).join('') || '<tr><td colspan="4">無</td></tr>'}</tbody></table></div></div>
      <div class="card"><h2>行為代碼</h2><table class="tbl compact"><thead><tr><th>代碼</th><th>行為</th><th>來源事件</th><th>次數</th></tr></thead><tbody>
        ${d.codes.map(c => `<tr><td><b>${c.code}</b></td><td>${esc(c.label)}</td><td class="note">${{ MS: 'module_started', CV: 'content_viewed', WI: 'widget_interaction', QC: 'question_answered（correct=1）', QW: 'question_answered（correct=0）', FB: 'feedback_viewed', AQ: 'ai_question_submitted', AR: 'ai_response_viewed', MC: 'module_completed', TT: 'tts_used' }[c.code]}</td><td>${c.n}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>調整後殘差 Z 值矩陣（列＝前一行為，欄＝下一行為）</h2><div class="table-wrap"><table class="tbl compact lsa-z"><thead><tr><th></th>${d.codes.map(c => `<th title="${esc(c.label)}">${c.code}</th>`).join('')}</tr></thead>
        <tbody>${d.codes.map((r, i) => `<tr><th title="${esc(r.label)}">${r.code}</th>${d.z[i].map((z, j) => `<td style="${zc(z)}" title="次數 ${d.freq[i][j]}">${z == null ? '' : z}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="note">紫色＝顯著正向轉移（Z &gt; 1.96）；灰字＝顯著少於隨機（Z &lt; −1.96）。滑鼠停在格子上可看實際次數。</p></div>`;
    $('#lsa-mod').addEventListener('change', e => { sessionStorage.setItem('lsa_mod', e.target.value); render(); });
    $('#lsa-scope').addEventListener('change', e => { sessionStorage.setItem('lsa_scope', e.target.value); render(); });
  };

  R.scales = async (el) => {
    const d = await api('/api/admin/dashboard?include_sim=' + incSim());
    el.innerHTML = `<h1>問卷分析</h1><p class="note">前測問卷與後測問卷題目相同：糖尿病健康識能（5 題）、糖尿病相關焦慮（7 題）、衛教學習自我效能（5 題）、自我管理自我效能（10 題）。滿意度問卷於後測一次：衛教滿意度（7 題）＋科技接受與系統滿意度（SUS 10 題＋3 題）。</p>
      <div class="kpis">${kpi('完成前測問卷', d.funnel.find(f => f.stage === '完成前測問卷')?.n)}${kpi('完成後測問卷', d.funnel.find(f => f.stage === '完成後測問卷')?.n)}${kpi('衛教滿意度', d.summary.edu_sat_mean, '1–5 分')}${kpi('SUS', d.summary.sus_mean, '0–100 分')}</div>
      <div class="card"><h2>前測 vs 後測平均</h2><div class="chart-box"><canvas id="c-scales"></canvas></div></div>
      <div class="card">${scaleTable(d.scales)}</div>`;
    chart($('#c-scales'), { type: 'bar', data: { labels: d.scales.map(x => x.title), datasets: [{ label: '前測', data: d.scales.map(x => x.pre_mean), backgroundColor: '#c4b5cf' }, { label: '後測', data: d.scales.map(x => x.post_mean), backgroundColor: '#8e4a9e' }] },
      options: { maintainAspectRatio: false, scales: { y: { min: 1, max: 5, title: { display: true, text: '平均（1–5）' } } } } });
  };

  R.items = async (el) => {
    const d = await api('/api/admin/dashboard?include_sim=' + incSim());
    el.innerHTML = `<h1>各題正確率（前測 vs 後測）</h1>
      <div class="card"><div class="chart-box tall"><canvas id="c-items"></canvas></div></div>
      <div class="card"><div class="table-wrap"><table class="tbl compact"><thead><tr><th>題號</th><th>領域</th><th>題目</th><th>前測 n</th><th>前測正確率%</th><th>後測 n</th><th>後測正確率%</th><th>差異</th></tr></thead>
      <tbody>${d.items.map(i => `<tr><td>${i.item_id}</td><td>${i.domain}</td><td>${esc(i.stem)}</td><td>${i.pre_n}</td><td>${fmt(i.pre_correct_rate)}</td><td>${i.post_n}</td><td>${fmt(i.post_correct_rate)}</td>
        <td>${i.pre_correct_rate != null && i.post_correct_rate != null ? (i.post_correct_rate - i.pre_correct_rate).toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
    chart($('#c-items'), { type: 'bar', data: { labels: d.items.map(i => i.item_id), datasets: [{ label: '前測', data: d.items.map(i => i.pre_correct_rate), backgroundColor: '#94a3b8' }, { label: '後測', data: d.items.map(i => i.post_correct_rate), backgroundColor: '#8e4a9e' }] }, options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100, title: { display: true, text: '正確率 %' } } } } });
  };

  R.modules = async (el) => {
    const d = await api('/api/admin/dashboard?include_sim=' + incSim());
    el.innerHTML = `<h1>模組分析</h1>
      <div class="grid-2"><div class="card"><h2>各模組平均停留時間（分）</h2><div class="chart-box"><canvas id="c-dur"></canvas></div></div>
      <div class="card"><h2>各模組首次作答正確率（%）</h2><div class="chart-box"><canvas id="c-acc"></canvas></div></div></div>
      <div class="card"><div class="table-wrap"><table class="tbl compact"><thead><tr><th>模組</th><th>開始人數</th><th>完成人數</th><th>完成率%</th><th>平均停留（分）</th><th>首次正確率%</th><th>AI 提問數</th></tr></thead>
      <tbody>${d.modules.map(m => `<tr><td>${m.module_id} ${esc(m.title)}</td><td>${m.started}</td><td>${m.completed}</td><td>${fmt(m.completion_rate)}</td><td>${fmt(m.avg_duration_min)}</td><td>${fmt(m.avg_first_try_accuracy)}</td><td>${m.ai_questions}</td></tr>`).join('')}</tbody></table></div></div>`;
    chart($('#c-dur'), { type: 'bar', data: { labels: d.modules.map(m => m.title), datasets: [{ label: '分鐘', data: d.modules.map(m => m.avg_duration_min), backgroundColor: PALETTE }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    chart($('#c-acc'), { type: 'bar', data: { labels: d.modules.map(m => m.title), datasets: [{ label: '%', data: d.modules.map(m => m.avg_first_try_accuracy), backgroundColor: PALETTE }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } } });
  };

  R.ai = async (el) => {
    const [d, kw] = await Promise.all([api('/api/admin/dashboard?include_sim=' + incSim()), api('/api/admin/ai-keywords?include_sim=' + incSim())]);
    const a = d.ai;
    el.innerHTML = `<h1>AI 使用分析</h1>
      <div class="kpis">${kpi('AI 提問總數', d.summary.ai_total)}${kpi('人均提問', d.summary.ai_per_participant)}${kpi('r（AI 次數 × 後測）', a.r_ai_post, 'Pearson 相關')}${kpi('r（AI 次數 × 進步分數）', a.r_ai_gain, 'Pearson 相關')}
        ${kpi('安全守門觸發', Object.values(a.guardrails).reduce((x, y) => x + y, 0), Object.entries(a.guardrails).map(([k, v]) => `${k}:${v}`).join('｜') || '無')}</div>
      <div class="grid-2">
        <div class="card"><h2>AI 使用程度 × 後測／進步分數</h2><div class="chart-box"><canvas id="c-lvl"></canvas></div></div>
        <div class="card"><h2>AI 提問次數 vs 進步分數（散布圖）</h2><div class="chart-box"><canvas id="c-sc"></canvas></div></div>
        <div class="card"><h2>問題類型分布</h2><div class="chart-box"><canvas id="c-cat"></canvas></div></div>
        <div class="card"><h2>使用程度分組</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>AI 使用次數</th><th>n</th><th>後測平均</th><th>進步平均</th></tr></thead>
          <tbody>${a.by_level.map(l => `<tr><td>${l.level}</td><td>${l.n}</td><td>${fmt(l.mean_post)}</td><td>${fmt(l.mean_gain)}</td></tr>`).join('')}</tbody></table></div>
          <p class="note">註：此為描述性相關，不代表因果；正式分析請匯出資料以 SPSS／R 進行（可控制前測分數等共變項）。</p></div>
      </div>
      <div class="card"><h2>AI 常問關鍵字文字雲</h2><p class="note">共 ${kw.total_questions} 則提問。彩色字為衛教詞典比對到的關鍵詞；灰色字為詞典外、出現 3 次以上的常見片段（自動斷詞，僅供參考）。字越大代表越多人問。</p>
        <div class="cloud-box"><canvas id="c-cloud" aria-label="AI 常問關鍵字文字雲"></canvas></div></div>
      <div class="grid-2"><div class="card"><h2>常問關鍵字 Top 20</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>#</th><th>關鍵字</th><th>提問數</th><th>來源</th></tr></thead>
        <tbody>${kw.words.slice(0, 20).map((w, i) => `<tr><td>${i + 1}</td><td><b>${esc(w.text)}</b></td><td>${w.n}</td><td class="note">${w.source === 'dict' ? '衛教詞典' : '常見片段'}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>常問題目 Top 10</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>題目</th><th>次數</th><th>分類</th></tr></thead>
        <tbody>${kw.top_questions.slice(0, 10).map(q => `<tr><td>${esc(q.question)}</td><td>${q.n}</td><td>${CAT_ZH[q.category] || q.category}</td></tr>`).join('')}</tbody></table></div></div></div>`;
    wordCloud($('#c-cloud'), kw.words);
    chart($('#c-lvl'), { type: 'bar', data: { labels: a.by_level.map(l => `${l.level}（n=${l.n}）`), datasets: [{ label: '後測平均', data: a.by_level.map(l => l.mean_post), backgroundColor: '#8e4a9e' }, { label: '進步平均', data: a.by_level.map(l => l.mean_gain), backgroundColor: '#f59e0b' }] }, options: { maintainAspectRatio: false } });
    chart($('#c-sc'), { type: 'scatter', data: { datasets: [{ label: '受試者', data: a.scatter.map(s => ({ x: s.ai_count, y: s.gain, id: s.participant_id })), backgroundColor: 'rgba(142,74,158,.65)' }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw.id}: AI ${c.raw.x} 次, 進步 ${c.raw.y}` } } }, scales: { x: { title: { display: true, text: 'AI 提問次數' } }, y: { title: { display: true, text: '進步分數' } } } } });
    const cats = Object.entries(a.categories);
    chart($('#c-cat'), { type: 'bar', data: { labels: cats.map(([k]) => CAT_ZH[k] || k), datasets: [{ data: cats.map(([, v]) => v), backgroundColor: PALETTE }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
  };

  R.participants = async (el, id) => {
    if (id) return participantDetail(el, decodeURIComponent(id));
    const list = await api('/api/admin/participants?include_sim=' + incSim());
    el.innerHTML = `<h1>受試者與學習軌跡</h1>
      <div class="row" style="margin-bottom:.8rem"><input id="q" class="input" style="max-width:320px" placeholder="搜尋研究編號"><span class="note">共 ${list.length} 位，點選一列查看完整學習軌跡</span></div>
      <div class="card"><div class="table-wrap"><table class="tbl compact"><thead><tr><th>研究編號</th><th>建立時間</th><th>裝置</th><th>目前階段</th><th>完成模組</th><th>前測</th><th>後測</th><th>進步</th><th>AI 次數</th><th>完成時間</th></tr></thead>
      <tbody id="tb">${list.map(p => `<tr class="click" data-id="${esc(p.participant_id)}"><td><b>${esc(p.participant_id)}</b>${p.is_simulated ? '<span class="tag-sim">模擬</span>' : ''}</td><td>${fmtTime(p.created_at)}</td><td>${fmt(p.device_type)}</td><td>${fmt(p.stage)}</td><td>${p.modules_completed}/8</td><td>${fmt(p.pretest_score)}</td><td>${fmt(p.posttest_score)}</td><td>${fmt(p.gain)}</td><td>${p.ai_count}</td><td>${fmtTime(p.completed_at)}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#tb').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/participants/' + encodeURIComponent(tr.dataset.id); });
    $('#q').addEventListener('input', e => { const v = e.target.value.trim().toLowerCase(); $$('#tb tr').forEach(tr => tr.hidden = v && !tr.dataset.id.toLowerCase().includes(v)); });
  };

  async function participantDetail(el, id) {
    const d = await api('/api/admin/participants/' + encodeURIComponent(id));
    const p = d.participant; const demo = p.demographics || {};
    el.innerHTML = `<p><a href="#/participants">← 返回受試者列表</a></p><h1>受試者 ${esc(p.participant_id)} ${p.is_simulated ? '<span class="tag-sim">模擬</span>' : ''}</h1>
      <div class="kpis">${kpi('前測', p.pretest_score)}${kpi('後測', p.posttest_score)}${kpi('進步', p.pretest_score != null && p.posttest_score != null ? (p.posttest_score - p.pretest_score).toFixed(1) : null)}
        ${kpi('完成模組', d.modules.filter(m => m.completed).length + '/8')}${kpi('AI 提問', d.ai.length)}${kpi('SUS', d.questionnaires.sus_score)}${kpi('再測', d.retakes.length ? d.retakes.map(r => r.score).join('、') : '—', '完成後練習分數')}${kpi('事件數', d.events.length)}</div>
      <div class="card"><h2>問卷分數（平均 1–5）</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>量表</th><th>前測</th><th>後測</th></tr></thead><tbody>
        ${Object.values(d.questionnaires.scales || {}).map(x => `<tr><td>${esc(x.title)}</td><td>${fmt(x.pre_mean)}</td><td>${fmt(x.post_mean)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="grid-2">
        <div class="card"><h2>基本資料</h2><table class="tbl compact"><tbody>
          <tr><th>首次登入</th><td>${fmtTime(p.consent_at)}</td></tr><tr><th>完成時間</th><td>${fmtTime(p.completed_at)}</td></tr><tr><th>裝置</th><td>${fmt(p.device_type)}</td></tr>
          <tr><th>繼續碼</th><td>${fmt(p.resume_code)}（協助受試者換裝置時使用）</td></tr>
          ${Object.entries(demo).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? v.join('、') : v)}</td></tr>`).join('')}</tbody></table></div>
        <div class="card"><h2>各模組表現</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>模組</th><th>完成</th><th>停留（秒）</th><th>首次正確率</th><th>作答次數</th><th>AI</th></tr></thead>
          <tbody>${d.modules.map(m => `<tr><td>${m.module_id} ${esc(m.module_title)}</td><td>${m.completed ? '✓' : ''}</td><td>${fmt(m.duration_sec)}</td><td>${fmt(m.first_try_accuracy)}</td><td>${m.total_attempts}</td><td>${m.ai_questions}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      <div class="card"><h2>AI 互動紀錄</h2>${d.ai.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>時間</th><th>模組</th><th>問題</th><th>分類</th><th>守門</th><th>已讀</th><th>回答</th></tr></thead>
        <tbody>${d.ai.map(a => `<tr><td>${fmtTime(a.created_at)}</td><td>${fmt(a.module_id)}</td><td>${esc(a.question)}</td><td>${CAT_ZH[a.category] || a.category}</td><td>${fmt(a.guardrail, '')}</td><td>${a.response_viewed ? '✓' : ''}</td><td><details><summary>展開</summary>${esc(a.response)}</details></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">無</p>'}</div>
      <div class="card"><h2>完整學習軌跡（event log）</h2><div class="timeline table-wrap"><table class="tbl compact"><thead><tr><th>時間</th><th>event_type</th><th>module</th><th>item</th><th>response</th><th>correct</th><th>attempt</th><th>time_on_task</th><th>其他</th></tr></thead>
        <tbody>${d.events.map(e => `<tr><td>${fmtTime(e.timestamp)}</td><td><span class="ev-type">${e.event_type}</span></td><td>${fmt(e.module_id, '')}</td><td>${esc(fmt(e.item_id, ''))}</td><td>${esc(fmt(e.response ?? e.ai_question, ''))}</td><td>${e.correct == null ? '' : e.correct}</td><td>${fmt(e.attempt_count, '')}</td><td>${fmt(e.time_on_task, '')}</td><td>${e.ai_question_category ? CAT_ZH[e.ai_question_category] : ''}${e.pretest_score != null && e.event_type === 'pretest_completed' ? '前測 ' + e.pretest_score : ''}${e.posttest_score != null && e.event_type === 'posttest_completed' ? '後測 ' + e.posttest_score : ''}</td></tr>`).join('')}</tbody></table></div></div>
      ${ME.role === 'admin' ? `<div class="card"><h2>資料撤回</h2><p class="note">受試者要求撤回時，可永久刪除此編號的所有資料（含事件、作答、AI 紀錄、問卷），無法復原。</p><button class="btn warn small" id="del">刪除此受試者全部資料</button></div>` : ''}`;
    const del = $('#del');
    if (del) del.addEventListener('click', async () => {
      const v = prompt(`請輸入研究編號「${p.participant_id}」以確認永久刪除`);
      if (v !== p.participant_id) return toast('已取消');
      await api('/api/admin/participants/' + encodeURIComponent(p.participant_id), { method: 'DELETE' }); toast('已刪除'); location.hash = '#/participants';
    });
  }

  R.export = async (el) => {
    const tables = [
      ['participants', '受試者', '每人一列：基本資料、知識前後測、進步分數、學習時間、AI 次數、各量表前後測總分'],
      ['pre_post_test', '知識測驗作答', '長格式：受試者 × 階段（pre／post／retake1…）× 題目，含正誤與作答秒數'],
      ['learning_events', '學習行為事件', '完整 event logging（全部欄位）'],
      ['module_performance', '模組表現', '受試者 × 8 模組：起訖、停留、首次正確率、回饋檢視、AI 提問'],
      ['ai_interactions', 'AI 互動', '提問內容、自動分類、守門結果、是否閱讀'],
      ['questionnaires', '問卷', '寬格式：健康識能、焦慮、學習自我效能、自我管理自我效能（_pre／_post）、衛教滿意度、SUS、開放題']
    ];
    const q = '?include_sim=' + incSim();
    el.innerHTML = `<h1>資料匯出</h1><p class="note">匿名原始資料（無姓名等可識別資訊）。CSV 為 UTF-8（含 BOM），可直接以 Excel、SPSS、R（readr::read_csv）、Python（pandas.read_csv）開啟。目前設定：<b>${incSim() === '1' ? '含模擬資料' : '僅真實受試者'}</b>（可在頂端切換）。</p>
      <div class="card"><div class="row"><div class="grow"><h2 style="margin:0">📗 Excel 一次匯出（6 個工作表 + README）</h2><span class="note">participants、pre_post_test、learning_events、module_performance、ai_interactions、questionnaires</span></div>
        <a class="btn" href="/api/admin/export/all.xlsx${q}" download>下載 Excel (.xlsx)</a></div></div>
      <div class="export-grid">${tables.map(([k, n, d]) => `<div class="card"><h3 style="margin:0">${n}</h3><code>${k}.csv</code><span class="note">${d}</span><a class="btn secondary small" href="/api/admin/export/${k}.csv${q}" download>下載 CSV</a></div>`).join('')}</div>
      <div class="card"><div class="row"><div class="grow"><h2 style="margin:0">📝 問卷匯出成 Google 表單（傳統組用）</h2>
        <span class="note">下載一支 Google Apps Script，貼到 <b>script.google.com</b> 執行 <code>createAllForms</code>，就會自動建立「前測（基本資料＋知識前測＋前測問卷）」「後測」「滿意度問卷」3 份 Google 表單與回覆試算表。題目與平台目前版本相同；知識測驗為測驗模式（每題 10 分）；量表題回覆為 1–5 數字，可與平台資料合併分析。</span></div>
        <a class="btn" href="/api/admin/export/google-forms.gs" download>下載 Google 表單產生程式 (.gs)</a></div>
        <ol class="note" style="margin:.6rem 0 0"><li>開啟 script.google.com →「新專案」</li><li>刪除預設內容，貼上下載的檔案內容 → 儲存</li><li>函式選單選 <code>createAllForms</code> → 執行 → 授權自己的 Google 帳號</li><li>到「執行記錄」複製 3 份表單的填答網址</li></ol></div>`;
  };

  R.account = async (el) => {
    el.innerHTML = `<h1>我的帳號</h1><div class="card" style="max-width:520px"><p>帳號：<b>${esc(ME.username)}</b>（${ME.role === 'admin' ? '管理者' : '研究者'}）</p>
      <h2>修改密碼</h2><div class="field"><label for="op">目前密碼</label><input id="op" type="password" class="input" autocomplete="current-password"></div>
      <div class="field"><label for="np">新密碼（至少 10 碼，含英文與數字）</label><input id="np" type="password" class="input" autocomplete="new-password"></div>
      <button class="btn" id="cp">更新密碼</button><p class="note">更新後需重新登入。</p></div>`;
    $('#cp').addEventListener('click', async () => {
      try { await api('/api/admin/me/password', { method: 'POST', body: { old_password: $('#op').value, new_password: $('#np').value } }); toast('密碼已更新，請重新登入'); ME = null; showLogin(); }
      catch (e) { toast(e.message); }
    });
  };

  R.users = async (el) => {
    const users = await api('/api/admin/users');
    el.innerHTML = `<h1>帳號管理</h1><p class="note">研究者（researcher）可檢視 Dashboard 與匯出資料；管理者（admin）另可管理帳號、內容、模擬資料與刪除受試者資料。</p>
      <div class="card"><div class="table-wrap"><table class="tbl compact"><thead><tr><th>帳號</th><th>名稱</th><th>角色</th><th>狀態</th><th>最後登入</th><th>操作</th></tr></thead>
      <tbody>${users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.display_name)}</td><td>${u.role}</td><td>${u.active ? '啟用' : '停用'}</td><td>${fmtTime(u.last_login)}</td>
        <td>${u.username === ME.username ? '（自己）' : `<button class="btn ghost small" data-act="toggle" data-u="${esc(u.username)}" data-a="${u.active}">${u.active ? '停用' : '啟用'}</button>
        <button class="btn ghost small" data-act="pw" data-u="${esc(u.username)}">重設密碼</button>
        <button class="btn ghost small" data-act="del" data-u="${esc(u.username)}">刪除</button>`}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card" style="max-width:560px"><h2>新增帳號</h2>
        <div class="field"><label for="nu">帳號</label><input id="nu" class="input" autocomplete="off"></div>
        <div class="field"><label for="nn">顯示名稱</label><input id="nn" class="input" autocomplete="off"></div>
        <div class="field"><label for="npw">初始密碼（至少 10 碼，含英文與數字）</label><input id="npw" class="input" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="nr">角色</label><select id="nr" class="input"><option value="researcher">researcher 研究者</option><option value="admin">admin 管理者</option></select></div>
        <button class="btn" id="add">建立帳號</button></div>`;
    $$('[data-act]', el).forEach(b => b.addEventListener('click', async () => {
      try {
        if (b.dataset.act === 'toggle') await api('/api/admin/users/' + encodeURIComponent(b.dataset.u), { method: 'PATCH', body: { active: b.dataset.a !== '1' } });
        else if (b.dataset.act === 'del') { if (!confirm(`確定刪除帳號「${b.dataset.u}」？`)) return; await api('/api/admin/users/' + encodeURIComponent(b.dataset.u), { method: 'DELETE' }); }
        else { const pw = prompt('輸入新密碼（至少 10 碼，含英文與數字）'); if (!pw) return; await api('/api/admin/users/' + encodeURIComponent(b.dataset.u), { method: 'PATCH', body: { password: pw } }); }
        toast('已更新'); render();
      } catch (e) { toast(e.message); }
    }));
    $('#add').addEventListener('click', async () => {
      try { await api('/api/admin/users', { method: 'POST', body: { username: $('#nu').value.trim(), display_name: $('#nn').value.trim(), password: $('#npw').value, role: $('#nr').value } }); toast('帳號已建立'); render(); }
      catch (e) { toast(e.message); }
    });
  };

  R.content = async (el) => {
    const d = await api('/api/admin/content');
    el.innerHTML = `<h1>衛教內容管理</h1><p class="note">可直接編輯題庫、8 個模組內容、問卷與 AI 知識庫（JSON 格式）。儲存前會自動驗證格式（8 模組、知識測驗至少 5 題、答案索引、問卷組合 surveys），並自動備份舊版至 content/backups/。</p>
      <div class="card"><div class="row" style="margin-bottom:.6rem"><button class="btn" id="save">驗證並儲存</button><button class="btn ghost" id="fmt">格式化 JSON</button><span id="msg" class="note"></span></div>
      <label class="sr-only" for="ed">內容 JSON</label><textarea id="ed" class="input code" spellcheck="false"></textarea></div>
      <div class="card"><h2>最近備份</h2>${d.backups.length ? `<ul>${d.backups.map(b => `<li><code>${esc(b)}</code></li>`).join('')}</ul>` : '<p class="muted">尚無備份</p>'}</div>`;
    const ed = $('#ed'); ed.value = JSON.stringify(d.content, null, 2);
    $('#fmt').addEventListener('click', () => { try { ed.value = JSON.stringify(JSON.parse(ed.value), null, 2); $('#msg').textContent = 'JSON 格式正確'; } catch (e) { $('#msg').textContent = 'JSON 錯誤：' + e.message; } });
    $('#save').addEventListener('click', async () => {
      let obj; try { obj = JSON.parse(ed.value); } catch (e) { $('#msg').textContent = 'JSON 錯誤：' + e.message; return; }
      if (!confirm('確定要儲存？受試者端會立即使用新內容（已作答紀錄不受影響）。')) return;
      try { const r = await api('/api/admin/content', { method: 'PUT', body: { content: obj } }); toast('已儲存，備份 ' + r.backup); render(); }
      catch (e) { $('#msg').textContent = e.message; }
    });
  };

  R.system = async (el) => {
    const s = await api('/api/admin/system');
    el.innerHTML = `<h1>系統與模擬資料</h1>
      <div class="grid-2"><div class="card"><h2>AI 智慧助理</h2>
        <p>目前引擎：<b>${esc(s.ai.label)}</b>（${esc(s.ai.model)}）</p>
        <p class="note">引擎、模型與 API 金鑰請到左側「🧠 AI 設定」修改，不需重新部署。</p>
        <a class="btn small" href="#/aiset">前往 AI 設定</a></div>
      <div class="card"><h2>資料庫</h2><p>受試者：${s.db.participants}｜事件：${s.db.events}</p><p class="note">${esc(s.db.path)}｜Node ${esc(s.node)}</p>
        <h2>模擬資料（MVP 測試用）</h2><p class="note">模擬受試者編號為 SIMxxxx，is_simulated=1，可隨時清除，不影響真實資料。</p>
        <div class="row"><input id="sn" class="input" type="number" min="1" max="200" value="20" style="max-width:120px"><button class="btn" id="sim">產生模擬受試者</button></div>
        <div class="row" style="margin-top:.6rem"><button class="btn warn small" id="clr">清除全部模擬資料</button></div></div></div>`;
    $('#sim').addEventListener('click', async () => { const b = $('#sim'); b.disabled = true; b.textContent = '產生中…'; try { const r = await api('/api/admin/simulate', { method: 'POST', body: { n: +$('#sn').value } }); toast(`已產生 ${r.created} 位`); render(); } catch (e) { toast(e.message); b.disabled = false; } });
    $('#clr').addEventListener('click', async () => { if (!confirm('確定清除全部模擬資料？')) return; const r = await api('/api/admin/simulated', { method: 'DELETE' }); toast(`已清除 ${r.deleted} 位`); render(); });
  };

  // AI 設定：引擎／模型／金鑰／受試者自備金鑰；金鑰只送到伺服器，畫面只顯示末 4 碼
  R.aiset = async (el) => {
    const d = await api('/api/admin/ai-settings');
    const s = d.settings, O = d.options, L = d.labels;
    const KP = ['gemini', 'openai', 'groq'];
    const KEY_HELP = { gemini: 'Google AI Studio 取得（aistudio.google.com）', openai: 'OpenAI Platform 取得（platform.openai.com）', groq: 'Groq Console 取得（console.groq.com，有免費額度）' };
    const opt = (list, v) => list.map(m => `<option value="${esc(m)}"${m === v ? ' selected' : ''}>${esc(m || '（CLI 預設模型）')}</option>`).join('');
    const engines = ['local', ...KP, ...(s.cliAvailable ? ['cli'] : [])];
    el.innerHTML = `<h1>AI 設定</h1>
      <p class="note">目前實際使用：<b>${esc(d.current.label)}</b>（${esc(d.current.model)}）${s.updated_at ? `｜最後修改 ${fmtTime(s.updated_at)} by ${esc(s.updated_by)}` : ''}</p>
      <div class="card"><h2>1. 選擇 AI 引擎</h2>
        <div class="row" role="radiogroup" aria-label="AI 引擎" style="flex-wrap:wrap">${engines.map(p => `<label class="opt" style="width:auto"><input type="radio" name="prov" value="${p}"${p === s.provider ? ' checked' : ''}> ${esc(L[p])}${p !== 'local' && p !== 'cli' && !s.keys[p].set ? '（尚未設定金鑰）' : ''}</label>`).join('')}</div>
        ${s.cliAvailable ? '' : '<p class="note">「本機 CLI」只在本機執行（app\\start.bat）時可用，雲端網站不顯示。</p>'}
        <p class="note">選了 API 引擎但沒有金鑰、或連線失敗時，系統會自動改用本機衛教知識庫回答，受試者不會看到錯誤；AI 使用分析會記錄實際使用的引擎。</p></div>
      ${KP.map(p => `<div class="card"><h2>${esc(L[p])}</h2>
        <div class="grid-2"><label>模型<br><select class="input" data-model="${p}">${opt(O[p], s.models[p])}${O[p].includes(s.models[p]) ? '' : `<option selected>${esc(s.models[p])}</option>`}</select></label>
        <label>API 金鑰 ${s.keys[p].set ? `<span class="badge">${esc(s.keys[p].label)}${s.keys[p].source === 'env' ? '・環境變數' : ''}</span>` : '<span class="note">未設定</span>'}<br>
          <input class="input" type="password" autocomplete="off" data-key="${p}" placeholder="${s.keys[p].set ? '留空＝不變更' : '貼上金鑰'}"></label></div>
        <p class="note">${KEY_HELP[p]}</p>
        <div class="row"><button class="btn ghost small" data-test="${p}">測試連線</button>${s.keys[p].source === 'admin' ? `<button class="btn warn small" data-clear="${p}">清除此金鑰</button>` : ''}<span class="note" data-res="${p}"></span></div></div>`).join('')}
      ${s.cliAvailable ? `<div class="card"><h2>本機 CLI（Codex／Gemini／Claude）</h2>
        <p class="note">使用這台電腦已登入的 CLI 帳號回答，不需 API 金鑰；每題約 10–60 秒，適合課堂示範或本機測試，不適合多人同時使用。</p>
        <div class="grid-2"><label>CLI 工具<br><select class="input" id="cli-tool">${['codex', 'gemini', 'claude'].map(t => `<option value="${t}"${t === s.cli.tool ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>模型<br><select class="input" id="cli-model"></select></label></div>
        <div class="row"><button class="btn ghost small" data-test="cli">測試連線</button><span class="note" data-res="cli"></span></div></div>` : ''}
      <div class="card"><h2>2. 受試者自備金鑰</h2>
        <label class="opt" style="width:auto"><input type="checkbox" id="allow-user"${s.allowUserKey ? ' checked' : ''}> 開放受試者在「AI 智慧助理」頁輸入自己的 API 金鑰（Gemini／OpenAI／Groq）</label>
        <p class="note">受試者的金鑰只存在他自己的瀏覽器，每次提問時隨請求送出、伺服器不保存。沒有輸入的人照常使用上方設定的引擎。</p></div>
      <div class="actions"><button class="btn" id="save-ai">儲存 AI 設定</button><span id="ai-msg" class="note"></span></div>`;
    const fillCli = () => { const t = $('#cli-tool'); if (t) $('#cli-model').innerHTML = opt(O.cli[t.value], t.value === s.cli.tool ? s.cli.model : ''); };
    if ($('#cli-tool')) { fillCli(); $('#cli-tool').addEventListener('change', fillCli); }
    $$('[data-test]', el).forEach(b => b.addEventListener('click', async () => {
      const p = b.dataset.test, out = $(`[data-res="${p}"]`, el);
      const body = p === 'cli' ? { provider: 'cli', tool: $('#cli-tool').value, model: $('#cli-model').value } : { provider: p, model: $(`[data-model="${p}"]`, el).value, key: $(`[data-key="${p}"]`, el).value };
      b.disabled = true; out.textContent = '測試中…（CLI 可能需要 1 分鐘）';
      try { const r = await api('/api/admin/ai-test', { method: 'POST', body }); out.textContent = r.ok ? `✅ 成功（${r.ms} ms）：${r.answer.slice(0, 80)}` : `❌ 失敗：${r.error}`; }
      catch (e) { out.textContent = '❌ ' + e.message; }
      b.disabled = false;
    }));
    $$('[data-clear]', el).forEach(b => b.addEventListener('click', async () => {
      if (!confirm('確定清除這組金鑰？')) return;
      await api('/api/admin/ai-settings', { method: 'PUT', body: { keys: { [b.dataset.clear]: null } } }); toast('已清除'); render();
    }));
    $('#save-ai').addEventListener('click', async () => {
      const body = { provider: $('input[name="prov"]:checked', el)?.value, models: {}, keys: {}, allowUserKey: $('#allow-user').checked };
      KP.forEach(p => { body.models[p] = $(`[data-model="${p}"]`, el).value; const k = $(`[data-key="${p}"]`, el).value.trim(); if (k) body.keys[p] = k; });
      if ($('#cli-tool')) body.cli = { tool: $('#cli-tool').value, model: $('#cli-model').value };
      if (body.provider !== 'local' && body.provider !== 'cli' && !s.keys[body.provider].set && !body.keys[body.provider] && !confirm('這個引擎還沒有金鑰，儲存後會先使用本機知識庫。仍要儲存？')) return;
      try { const r = await api('/api/admin/ai-settings', { method: 'PUT', body }); toast(`已儲存，目前使用：${r.current.label}`); render(); }
      catch (e) { $('#ai-msg').textContent = e.message; }
    });
  };

  R.audit = async (el) => {
    const rows = await api('/api/admin/audit');
    el.innerHTML = `<h1>操作稽核紀錄</h1><div class="card"><div class="table-wrap"><table class="tbl compact"><thead><tr><th>時間</th><th>帳號</th><th>動作</th><th>內容</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${fmtTime(r.at)}</td><td>${esc(r.username)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</tbody></table></div></div>`;
  };

  // ---------- 啟動 ----------
  api('/api/admin/me').then(r => { ME = r.user; startApp(); }).catch(() => showLogin());
})();
