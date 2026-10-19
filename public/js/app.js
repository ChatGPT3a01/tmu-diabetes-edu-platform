/* 糖尿病互動衛教平台 — 受試者端 SPA */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = s => esc(s).replace(/\n/g, '<br>');
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('dm_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('dm_' + k, JSON.stringify(v)); } catch { /* 私密模式 */ } },
    del(k) { try { localStorage.removeItem('dm_' + k); } catch { } }
  };

  // 研究說明與同意書改為現場紙本，平台從「登入」開始
  const STAGES = [
    { id: 'demographics', label: '基本資料' }, { id: 'pretest', label: '知識前測' }, { id: 'presurvey', label: '前測問卷' },
    { id: 'modules', label: '8 個衛教模組' }, { id: 'ai', label: 'AI 智慧助理' }, { id: 'posttest', label: '知識後測' },
    { id: 'postsurvey', label: '後測問卷' }, { id: 'sat', label: '滿意度問卷' }, { id: 'done', label: '完成' }
  ];
  const MOD_STEPS = ['學習目標', '圖文衛教', '生活案例', '互動問題', 'AI 延伸提問', '完成單元'];

  const S = {
    content: null, token: store.get('token'), pid: store.get('pid'), sid: null, resumeCode: store.get('rc'),
    state: { stage: 'demographics', mod: {} }, modulesDone: new Set(), pretestDone: false, posttestDone: false, completed: false,
    hasDemo: false, answered: { pre: {}, post: {} }, chats: {}, surveys: new Set(), scores: {}
  };

  // ---------- AWD：依裝置調整版面結構 ----------
  function detectDevice() {
    const w = window.innerWidth, coarse = matchMedia('(pointer: coarse)').matches;
    const ua = navigator.userAgent;
    // iPad 的 UA 也含 "Mobile"，須先判斷平板；iPadOS 13+ 偽裝成 Macintosh，以觸控點數辨識
    const tabletUA = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const phoneUA = !tabletUA && /iPhone|iPod|Android.*Mobile|Mobi/i.test(ua);
    if (phoneUA || w < 600) return 'mobile';
    if (tabletUA || (coarse && w < 1280) || w < 1024) return 'tablet';
    return 'desktop';
  }
  let device = detectDevice();
  function applyDevice() {
    const html = document.documentElement;
    html.classList.remove('device-mobile', 'device-tablet', 'device-desktop');
    html.classList.add('device-' + device);
    html.classList.toggle('input-touch', matchMedia('(pointer: coarse)').matches);
  }
  applyDevice();
  let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { const d = detectDevice(); if (d !== device) { device = d; applyDevice(); } }, 200); });

  // ---------- 字級／對比 ----------
  function applyPrefs() {
    document.documentElement.dataset.fs = store.get('fs', 2);
    document.documentElement.dataset.contrast = store.get('contrast', 'normal');
    const c = $('#btn-contrast'); if (c) c.setAttribute('aria-pressed', store.get('contrast') === 'high');
  }
  applyPrefs();

  // ---------- API 與事件紀錄 ----------
  // 後端網址：同站部署時為空字串；前端放 GitHub Pages 時由 config.js 指定 Render 網址
  const API = String(window.DM_API_BASE || '').replace(/\/+$/, '');
  async function api(path, body, method = 'POST') {
    const res = await fetch(API + path, {
      method, headers: { 'Content-Type': 'application/json', 'X-Participant-Token': S.token || '', 'X-Session-Id': S.sid || '' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return j;
  }
  let queue = store.get('queue', []);
  function log(e) {
    if (!S.token) return;
    queue.push({ ...e, client_ts: new Date().toISOString() });
    store.set('queue', queue);
    if (queue.length >= 10) flush();
  }
  let flushing = false;
  async function flush(keepalive = false) {
    if (flushing || !queue.length || !S.token || !navigator.onLine) return;
    flushing = true;
    const batch = queue.slice(0, 100);
    try {
      const res = await fetch(API + '/api/p/events', {
        method: 'POST', keepalive,
        headers: { 'Content-Type': 'application/json', 'X-Participant-Token': S.token, 'X-Session-Id': S.sid || '' },
        body: JSON.stringify({ events: batch })
      });
      if (res.ok) { queue = queue.slice(batch.length); store.set('queue', queue); }
    } catch { /* 離線時保留佇列 */ } finally { flushing = false; }
  }
  setInterval(flush, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flush(true); saveState(); } });
  window.addEventListener('online', () => { $('#offline')?.remove(); flush(); });
  window.addEventListener('offline', () => {
    if (!$('#offline')) document.body.insertAdjacentHTML('afterbegin', '<div id="offline" class="offline-banner" role="status">目前離線：您的作答會先保存在本機，恢復連線後自動上傳。</div>');
  });

  let stateTimer;
  function saveState() {
    store.set('state', S.state);
    clearTimeout(stateTimer);
    if (S.token) stateTimer = setTimeout(() => api('/api/p/state', { state: S.state }).catch(() => { }), 400);
  }

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.role = 'status'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  // ---------- 朗讀：優先播放預錄 AI 語音（audio/<雜湊>.mp3），沒有音檔時用瀏覽器朗讀（Web Speech API） ----------
  // 雜湊算法與 scripts/gen_audio.js 相同（FNV-1a 32 位元），衛教內容在後臺被修改後，該段自動改回瀏覽器朗讀
  let AUDIO = new Set();
  const ttsClean = t => String(t).replace(/[①-⑧]/g, '');
  const ttsHash = t => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const hasSpeech = () => 'speechSynthesis' in window;
  let speakingBtn = null, player = null;
  function ttsBtn(text) {
    const recorded = AUDIO.has(ttsHash(ttsClean(text)));
    if (!recorded && !hasSpeech()) return '';
    return `<button class="tts" data-tts="${esc(text)}" aria-pressed="false" aria-label="播放這段內容的語音">🔊 ${recorded ? '聽語音' : '朗讀'}</button>`;
  }
  function stopTTS() {
    if (player) { player.pause(); player = null; }
    window.speechSynthesis?.cancel?.();
    if (speakingBtn) speakingBtn.setAttribute('aria-pressed', 'false');
    speakingBtn = null;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tts]'); if (!b) return;
    const same = speakingBtn === b;
    stopTTS();
    if (same) return;
    const text = ttsClean(b.dataset.tts), h = ttsHash(text);
    const done = () => { if (speakingBtn === b) { b.setAttribute('aria-pressed', 'false'); speakingBtn = null; player = null; } };
    b.setAttribute('aria-pressed', 'true'); speakingBtn = b;
    const speak = () => {
      if (!hasSpeech()) { done(); toast('這台裝置無法播放語音'); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW'; u.rate = 0.9;
      const v = speechSynthesis.getVoices().find(v => /zh[-_]TW/i.test(v.lang)); if (v) u.voice = v;
      u.onend = done;
      speechSynthesis.speak(u);
    };
    if (AUDIO.has(h)) {
      player = new Audio(`audio/${h}.mp3`);
      player.onended = done;
      player.play().catch(() => { player = null; if (speakingBtn === b) speak(); });
    } else speak();
    log({ event_type: 'tts_used', module_id: currentModule, response: b.dataset.tts.slice(0, 40), extra: { audio: AUDIO.has(h) ? 'recorded' : 'speech' } });
  });

  // ---------- 階段與進度 ----------
  function allowedStage() {
    if (!S.token) return 'login';
    if (!S.hasDemo) return 'demographics';
    if (!S.pretestDone) return 'pretest';
    if (!S.surveys.has('pre')) return 'presurvey';
    if (S.modulesDone.size < 8) return 'modules';
    if (!S.state.aiDone) return 'ai';
    if (!S.posttestDone) return 'posttest';
    if (!S.surveys.has('post')) return 'postsurvey';
    if (!S.surveys.has('sat')) return 'sat';
    return 'done';
  }
  function progressPct() {
    let p = 0;
    if (S.token) p += 2;
    if (S.hasDemo) p += 4;
    if (S.pretestDone) p += 10;
    if (S.surveys.has('pre')) p += 8;
    p += S.modulesDone.size * 5;
    if (S.state.aiDone) p += 4;
    if (S.posttestDone) p += 10;
    if (S.surveys.has('post')) p += 8;
    if (S.surveys.has('sat')) p += 14;
    return S.completed ? 100 : Math.min(100, p);
  }
  // 側欄步驟可點選的目的地：學習中可隨時回單元列表與 AI；完成後可再測知識測驗、查看成果
  function stepLink(id) {
    const learning = S.pretestDone && S.surveys.has('pre');
    if (id === 'modules' && learning) return '#/hub';
    if (id === 'ai' && learning) return '#/ai';
    if (id === 'posttest' && S.completed) return '#/retake';
    if (id === 'done' && S.completed) return '#/done';
    return null;
  }
  function renderProgress() {
    const pct = progressPct();
    const cur = allowedStage();
    const ci = STAGES.findIndex(s => s.id === cur);
    const view = location.hash.replace(/^#\/?/, '').split('/')[0];
    const steps = STAGES.map((s, i) => {
      const extra = s.id === 'modules' && S.token ? `（${S.modulesDone.size}/8）` : s.id === 'posttest' && S.completed ? '（可再測）' : '';
      const cls = i < ci || cur === 'done' && s.id === 'done' ? 'done' : i === ci ? 'current' : '';
      const href = stepLink(s.id);
      const here = href && href === '#/' + view;
      const inner = `<span class="dot">${cls === 'done' ? '✓' : i + 1}</span>${s.label}${extra}`;
      return `<li class="${cls}${href ? ' link' : ''}${here ? ' here' : ''}" ${i === ci ? 'aria-current="step"' : ''}>${href && !here ? `<a href="${href}" data-nav="${s.id}">${inner}</a>` : inner}</li>`;
    }).join('');
    const label = `<div class="progress-label"><span>整體學習進度：${cur === 'login' ? '登入' : STAGES[ci].label}</span><b>${pct}%</b></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="整體學習進度"><i style="width:${pct}%"></i></div>`;
    // 登入前不顯示進度
    $('#progress-mobile').hidden = !S.token; $('#side').hidden = !S.token;
    // 手機頂部列放不下 logo＋編號＋工具鈕，編號改顯示在進度列（避免蓋住 logo）
    $('#progress-mobile').innerHTML = (S.pid ? `<div class="pid-line">編號 ${esc(S.pid)}</div>` : '') + label;
    $('#side').innerHTML = `<div class="card">${label}</div><div class="card"><ol class="stepper">${steps}</ol>${S.pretestDone && S.surveys.has('pre') ? '<p class="muted step-hint">可點選有底線的項目切換頁面</p>' : ''}</div>`;
    $('#pid-chip').textContent = S.pid ? `編號 ${S.pid}` : '';
    $$('[data-nav]').forEach(a => a.addEventListener('click', () => log({ event_type: 'nav_click', item_id: a.dataset.nav })));
    $('#pid-chip').hidden = !S.pid;
  }

  // ---------- 路由 ----------
  const routes = {};
  let currentModule = null;
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  window.addEventListener('hashchange', render);
  function render() {
    if (!S.content) return; // 內容尚未載入（網路較慢時切換網址），載入後 boot() 會再渲染
    // Android App 內建瀏覽器（LINE/FB WebView）沒有 speechSynthesis，須經 window 存取才不會丟 ReferenceError
    stopTTS();
    const h = location.hash.replace(/^#\/?/, '') || '';
    const [name, arg] = h.split('/');
    const allowed = allowedStage();
    const order = STAGES.map(s => s.id);
    const reach = id => order.indexOf(id) <= order.indexOf(allowed);
    let view = name || (S.token ? stageRoute(allowed) : 'home');
    if (view === 'consent') view = 'home'; // 舊網址相容
    // 進度保護：未到的階段導回目前階段；正式測驗與問卷完成後不可重做（完成全部後可另外「再測」）
    const learning = S.pretestDone && S.surveys.has('pre');
    const guards = {
      id: () => !!S.token, recover: () => !S.token, home: () => !S.token,
      demographics: () => !!S.token && !S.hasDemo,
      pretest: () => S.hasDemo && !S.pretestDone,
      presurvey: () => S.pretestDone && !S.surveys.has('pre'),
      hub: () => learning, module: () => learning && !!S.content.modules.find(m => m.id === arg),
      ai: () => learning,
      posttest: () => reach('posttest') && !S.posttestDone,
      postsurvey: () => S.posttestDone && !S.surveys.has('post'),
      sat: () => S.surveys.has('post') && !S.surveys.has('sat'),
      done: () => S.completed || S.surveys.has('sat'),
      retake: () => S.completed,
      sources: () => true
    };
    if (!routes[view] || !(guards[view] ? guards[view]() : true)) { view = S.token ? stageRoute(allowed) : 'home'; history.replaceState(null, '', '#/' + view); }
    currentModule = view === 'module' ? arg : null;
    renderProgress();
    const main = $('#main');
    main.innerHTML = '';
    routes[view](main, arg);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (S.token) log({ event_type: 'page_view', module_id: currentModule, item_id: view });
  }
  const stageRoute = st => ({ login: 'home', demographics: 'demographics', pretest: 'pretest', presurvey: 'presurvey', modules: 'hub', ai: 'ai', posttest: 'posttest', postsurvey: 'postsurvey', sat: 'sat', done: 'done' }[st]);

  // ================= 頁面 =================
  routes.home = (el) => {
    const m = S.content.meta;
    el.innerHTML = `<section class="hero"><img src="icons/icon.svg" alt="" width="104" height="104"><h1>${esc(m.title)}</h1>
      <p class="lead">用 8 個互動單元、生活案例與 AI 智慧助理，一步一步學會照顧血糖。</p></section>
      <div class="card login-box"><h2 style="margin-top:0">登入</h2>
        <div class="field"><label for="code">編號</label>
          <input id="code" class="input" autocomplete="off" autocapitalize="characters" placeholder="請輸入現場人員提供的編號">
          <p class="muted">沒有編號可留空，系統會自動產生一組。不需要填姓名。</p></div>
        <p id="c-err" class="feedback bad" hidden></p>
        <button class="btn block" id="login">登入 ➜</button>
        <p class="center" style="margin:.8rem 0 0"><a href="#/recover">已經登入過？輸入編號＋繼續碼，接著上次進度</a></p></div>
      <div class="feature-grid">
        <div class="feature"><span class="ic">🔤</span><div><b>字大好讀</b><br><span class="muted">右上角可放大字體、切換高對比，也可以按「朗讀」聽內容。</span></div></div>
        <div class="feature"><span class="ic">📱</span><div><b>手機電腦都能用</b><br><span class="muted">可分次完成，系統會記住您的進度。</span></div></div>
        <div class="feature"><span class="ic">🤖</span><div><b>AI 智慧助理</b><br><span class="muted">隨時提問糖尿病衛教問題。</span></div></div>
      </div>
      <p class="muted center" style="margin-top:1rem">${esc(m.aiDisclaimer)}</p>`;
    const go1 = async () => {
      const btn = $('#login'); btn.disabled = true; const er = $('#c-err'); er.hidden = true;
      try {
        const r = await api('/api/p/start', { code: $('#code').value.trim(), device_type: device });
        S.token = r.token; S.pid = r.participant_id; S.sid = r.session_id; S.resumeCode = r.resume_code;
        S.state = { stage: 'demographics', mod: {} };
        store.set('token', S.token); store.set('pid', S.pid); store.set('rc', S.resumeCode); store.set('state', S.state);
        go('#/id');
      } catch (e) { er.textContent = e.message; er.hidden = false; btn.disabled = false; }
    };
    $('#login').addEventListener('click', go1);
    $('#code').addEventListener('keydown', e => { if (e.key === 'Enter') go1(); });
  };

  routes.recover = (el) => {
    el.innerHTML = `<h1>繼續上次進度</h1><div class="card">
      <p>請輸入登入時系統給您的「編號」與「繼續碼」。</p>
      <div class="field"><label for="rc-pid">編號</label><input id="rc-pid" class="input" autocomplete="off" placeholder="例如 P0012" value="${esc(S.pid || '')}"></div>
      <div class="field"><label for="rc-code">繼續碼（6 碼）</label><input id="rc-code" class="input" autocomplete="off" autocapitalize="characters" placeholder="例如 7KQ2MX" maxlength="8"></div>
      <p id="rc-err" class="feedback bad" hidden></p></div>
      <div class="actions sticky"><a class="btn ghost" href="#/">返回</a><button class="btn" id="rc-go">繼續</button></div>`;
    $('#rc-go').addEventListener('click', async () => {
      const err = $('#rc-err'); err.hidden = true;
      try {
        const r = await api('/api/p/recover', { participant_id: $('#rc-pid').value, resume_code: $('#rc-code').value });
        S.token = r.token; S.pid = r.participant_id; store.set('token', S.token); store.set('pid', S.pid);
        await resume(); go('#/' + stageRoute(allowedStage()));
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  };

  routes.id = (el) => {
    el.innerHTML = `<h1>登入成功</h1>
      <div class="card center"><p>您的編號</p><div class="code-big">${esc(S.pid)}</div>
      <p style="margin-top:1rem">繼續碼</p><div class="code-big">${esc(S.resumeCode || '—')}</div>
      <p class="muted" style="margin-top:1rem">請把這兩組號碼抄下來或拍照保存。換手機、換電腦時，可以用它們繼續上次的進度。</p>
      <button class="btn secondary small" id="copy">📋 複製號碼</button></div>
      <div class="actions sticky"><button class="btn block" id="next">我記下了，下一步 ➜</button></div>`;
    $('#copy').addEventListener('click', () => { navigator.clipboard?.writeText(`編號 ${S.pid}／繼續碼 ${S.resumeCode}`).then(() => toast('已複製')); });
    $('#next').addEventListener('click', () => go('#/demographics'));
  };

  routes.demographics = (el) => {
    const qs = S.content.demographics;
    const ans = store.get('demo_draft', {});
    el.innerHTML = `<h1>基本資料</h1><p class="lead">這些資料只用於統計分析，不會用來辨識您的身分。</p>
      ${qs.map(q => `<div class="card" role="group" aria-labelledby="dq-${q.id}"><h2 id="dq-${q.id}" style="font-size:1.12rem">${esc(q.label)}</h2>
        <div class="opt-list">${q.options.map(o => `<button class="opt ${q.type === 'multi' ? 'multi' : ''}" role="${q.type === 'multi' ? 'checkbox' : 'radio'}" data-q="${q.id}" data-v="${esc(o)}" aria-checked="false"><span class="mark"></span>${esc(o)}</button>`).join('')}</div></div>`).join('')}
      <p id="d-err" class="feedback bad" hidden></p>
      <div class="actions sticky"><button class="btn block" id="d-next">送出，開始知識前測 ➜</button></div>`;
    const sync = () => $$('.opt[data-q]').forEach(b => {
      const q = qs.find(x => x.id === b.dataset.q); const v = ans[q.id];
      const on = q.type === 'multi' ? (v || []).includes(b.dataset.v) : v === b.dataset.v;
      b.setAttribute('aria-checked', on); b.querySelector('.mark').textContent = on ? '✓' : '';
    });
    $$('.opt[data-q]').forEach(b => b.addEventListener('click', () => {
      const q = qs.find(x => x.id === b.dataset.q);
      if (q.type === 'multi') { const a = new Set(ans[q.id] || []); a.has(b.dataset.v) ? a.delete(b.dataset.v) : a.add(b.dataset.v); ans[q.id] = [...a]; }
      else ans[q.id] = b.dataset.v;
      store.set('demo_draft', ans); sync();
    }));
    sync();
    $('#d-next').addEventListener('click', async () => {
      const miss = qs.filter(q => q.type === 'multi' ? !(ans[q.id] || []).length : !ans[q.id]);
      const er = $('#d-err');
      if (miss.length) { er.textContent = `還有 ${miss.length} 題沒有回答：${miss.map(q => q.label).join('、')}`; er.hidden = false; er.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      try { await api('/api/p/demographics', { answers: ans }); S.hasDemo = true; S.state.stage = 'pretest'; store.del('demo_draft'); saveState(); go('#/pretest'); }
      catch (e) { er.textContent = e.message; er.hidden = false; }
    });
  };

  // ---------- 知識測驗（前測／後測共用） ----------
  function testView(el, phase) {
    const T = S.content.knowledgeTest; const items = T.items;
    const key = phase === 'pre' ? 'preIdx' : 'postIdx';
    const answered = S.answered[phase];
    if (!S.state[key + '_started']) {
      S.state[key + '_started'] = true; saveState();
      log({ event_type: phase === 'pre' ? 'pretest_started' : 'posttest_started' });
    }
    let idx = Math.min(S.state[key] || 0, items.length - 1);
    const title = phase === 'pre' ? '知識前測' : '知識後測';
    const intro = () => phase === 'pre' ? T.intro : '恭喜完成所有學習單元！請再作答一次和前測相同的 10 題，看看自己進步了多少。';
    let shownAt, changes;
    // 答案在背景依序儲存（不讓長者每題等待網路）；送出測驗前會確認全部存好
    let chain = Promise.resolve(); const failed = new Map();
    const saveAnswer = payload => {
      chain = chain.then(async () => {
        for (let t = 0; t < 3; t++) {
          try { await api('/api/p/test/answer', payload); failed.delete(payload.item_id); return; }
          catch (e) { if (e.status && e.status < 500 && e.status !== 409) { failed.set(payload.item_id, payload); return; } await new Promise(r => setTimeout(r, 800 * (t + 1))); }
        }
        failed.set(payload.item_id, payload);
      });
    };
    const show = () => {
      const it = items[idx]; shownAt = performance.now(); changes = 0;
      const sel = answered[it.id];
      el.innerHTML = `<h1>${title}</h1>${idx === 0 ? `<div class="card soft"><p style="margin:0">${esc(intro())}</p></div>` : ''}
        <div class="progress-label"><span>第 ${idx + 1} / ${items.length} 題</span><span>${Object.keys(answered).length} 題已作答</span></div>
        <div class="bar" style="margin-bottom:1rem"><i style="width:${(idx + 1) / items.length * 100}%"></i></div>
        <div class="card" role="radiogroup" aria-labelledby="tq"><div class="row"><h2 id="tq" class="grow" style="font-size:1.2rem">${idx + 1}. ${esc(it.stem)}</h2>${ttsBtn(it.stem + '。' + it.options.map((o, i) => `選項${i + 1}，${o}`).join('。'))}</div>
        <div class="opt-list">${it.options.map((o, i) => `<button class="opt" role="radio" data-i="${i}" aria-checked="${sel === i}"><span class="mark">${sel === i ? '✓' : String.fromCharCode(65 + i)}</span>${esc(o)}</button>`).join('')}</div></div>
        <p id="t-err" class="feedback bad" hidden></p>
        <div class="actions sticky"><button class="btn ghost" id="prev" ${idx === 0 ? 'disabled' : ''}>← 上一題</button>
          <button class="btn" id="nxt" ${sel == null ? 'disabled' : ''}>${idx === items.length - 1 ? '送出測驗 ✓' : '下一題 →'}</button></div>`;
      let cur = sel;
      $$('.opt', el).forEach(b => b.addEventListener('click', () => {
        cur = +b.dataset.i; changes++;
        $$('.opt', el).forEach((x, i) => { x.setAttribute('aria-checked', i === cur); x.querySelector('.mark').textContent = i === cur ? '✓' : String.fromCharCode(65 + i); });
        $('#nxt').disabled = false;
      }));
      $('#prev').addEventListener('click', () => { idx--; S.state[key] = idx; saveState(); show(); });
      $('#nxt').addEventListener('click', async () => {
        const btn = $('#nxt'); btn.disabled = true;
        try {
          if (cur !== sel || answered[it.id] == null) {
            saveAnswer({ phase, item_id: it.id, response: cur, time_on_task: Math.round((performance.now() - shownAt) / 100) / 10, attempt_count: Math.max(1, changes) });
            answered[it.id] = cur;
          }
          if (idx < items.length - 1) { idx++; S.state[key] = idx; saveState(); show(); return; }
          const miss = items.filter(x => answered[x.id] == null);
          if (miss.length) { idx = items.indexOf(miss[0]); S.state[key] = idx; show(); toast(`還有 ${miss.length} 題未作答`); return; }
          btn.textContent = '儲存中，請稍候…';
          await chain;
          for (const p of [...failed.values()]) saveAnswer(p);
          await chain;
          if (failed.size) throw new Error(`有 ${failed.size} 題答案尚未儲存成功，請確認網路後再按一次「送出測驗」`);
          const r = await api('/api/p/test/complete', { phase });
          if (phase === 'pre') { S.pretestDone = true; S.scores.pre = r.score; S.state.stage = 'presurvey'; saveState(); finishPre(el, r); }
          else { S.posttestDone = true; S.scores.post = r.score; S.state.stage = 'postsurvey'; saveState(); finishPost(el, r); }
        } catch (e) { const er = $('#t-err'); er.textContent = e.message; er.hidden = false; btn.disabled = false; btn.textContent = '送出測驗 ✓'; }
      });
    };
    show();
  }
  const scoreCard = (r, label) => `<div class="card center score-card"><p class="muted" style="margin:0">${label}</p>
      <div class="score-big">${r.score}<small> 分</small></div><p style="margin:0">答對 ${r.n_correct} / ${r.total} 題（每題 10 分，滿分 100 分）</p></div>`;
  function finishPre(el, r) {
    renderProgress();
    el.innerHTML = `<div class="celebrate">👏</div><h1 class="center">知識前測完成！</h1>
      ${scoreCard(r, '您的知識前測分數')}
      <div class="card"><p>先記住這個分數，學完 8 個單元後還會再測一次相同的題目，看看自己進步多少。</p>
      <p>接下來請先填寫一份<b>前測問卷</b>（約 5 分鐘），了解您目前的想法與信心，沒有對錯。</p></div>
      <div class="actions sticky"><a class="btn block" href="#/presurvey">填寫前測問卷 ➜</a></div>`;
  }
  function finishPost(el, r) {
    renderProgress();
    const gain = r.pretest_score != null ? Math.round((r.score - r.pretest_score) * 10) / 10 : null;
    el.innerHTML = `<div class="celebrate">🎓</div><h1 class="center">知識後測完成！</h1>
      ${scoreCard(r, '您的知識後測分數')}
      ${gain != null ? `<div class="card center"><p style="margin:0">前測 <b>${r.pretest_score}</b> 分 → 後測 <b>${r.score}</b> 分　<b style="color:${gain >= 0 ? 'var(--ok)' : 'var(--bad)'}">${gain > 0 ? '進步 +' + gain : gain === 0 ? '持平' : gain} 分</b></p></div>` : ''}
      <div class="card"><p>最後還有兩份問卷：<b>後測問卷</b>與<b>滿意度問卷</b>，完成後就能看到完整的學習成果與趨勢圖。</p></div>
      <div class="actions sticky"><a class="btn block" href="#/postsurvey">填寫後測問卷 ➜</a></div>`;
  }
  routes.pretest = el => testView(el, 'pre');
  routes.posttest = el => testView(el, 'post');

  // ---------- 模組大廳 ----------
  routes.hub = (el) => {
    const mods = S.content.modules;
    const all8 = S.modulesDone.size >= 8;
    el.innerHTML = `<h1>互動衛教單元</h1><p class="lead">已完成 <b>${S.modulesDone.size}</b> / 8 個單元。建議依序學習，也可以挑有興趣的先看。</p>
      <div class="module-grid">${mods.map(m => {
        const done = S.modulesDone.has(m.id); const doing = !done && S.state.mod?.[m.id];
        return `<a class="module-card" href="#/module/${m.id}" style="--mc:${m.color}"><span class="ic" aria-hidden="true">${m.icon}</span>
          <span class="grow"><span class="muted">單元 ${m.no}</span><br><span class="t">${esc(m.title)}</span><br>
          <span class="badge ${done ? 'ok' : doing ? 'doing' : ''}">${done ? '✓ 已完成' : doing ? '學習中' : '未開始'}</span></span></a>`;
      }).join('')}</div>
      <div class="card soft" style="margin-top:1rem"><div class="row"><span style="font-size:2rem">🤖</span><div class="grow"><b>有問題想問嗎？</b><br><span class="muted">AI 智慧助理可以隨時回答糖尿病衛教問題。</span></div><a class="btn secondary" href="#/ai">問 AI</a></div></div>
      <div class="actions sticky">${S.completed ? '<a class="btn block" href="#/done">回到學習成果 ➜</a>' : all8 ? '<a class="btn block" href="#/ai">下一步：AI 智慧助理 ➜</a>' : `<a class="btn block" href="#/module/${(mods.find(m => !S.modulesDone.has(m.id)) || mods[0]).id}">繼續學習：${esc((mods.find(m => !S.modulesDone.has(m.id)) || mods[0]).title)} ➜</a>`}</div>`;
  };

  // ---------- 互動問題元件 ----------
  function questionBlock(box, q, moduleId, onNext, opts = {}) {
    let attempt = 0, shownAt = performance.now(), cur = null, solved = false;
    const draw = () => {
      box.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="font-size:1.15rem">${esc(q.stem)}</h2>${ttsBtn(q.stem + '。' + q.options.map((o, i) => `選項${i + 1}，${o}`).join('。'))}</div>
        <div class="opt-list" role="radiogroup">${q.options.map((o, i) => `<button class="opt" role="radio" aria-checked="false" data-i="${i}"><span class="mark">${String.fromCharCode(65 + i)}</span>${esc(o)}</button>`).join('')}</div>
        <div class="fb" aria-live="polite"></div>
        <div class="actions qa"><button class="btn" data-act="check" disabled>確認答案</button></div></div>`;
      const opts$ = $$('.opt', box);
      opts$.forEach(b => b.addEventListener('click', () => {
        if (solved) return;
        cur = +b.dataset.i; opts$.forEach((x, i) => { x.setAttribute('aria-checked', i === cur); x.classList.remove('wrong'); });
        $('[data-act=check]', box).disabled = false;
      }));
      $('[data-act=check]', box).addEventListener('click', check);
    };
    const check = () => {
      attempt++;
      const ok = cur === q.answer;
      const tot = Math.round((performance.now() - shownAt) / 100) / 10;
      log({ event_type: 'question_answered', module_id: moduleId, item_id: q.id, response: cur, correct: ok, attempt_count: attempt, time_on_task: tot, extra: opts.extra });
      const opts$ = $$('.opt', box);
      opts$.forEach((x, i) => { if (i === cur) x.classList.add(ok ? 'correct' : 'wrong'); });
      if (ok) { solved = true; opts$.forEach(x => x.disabled = true); }
      const fb = $('.fb', box);
      fb.innerHTML = `<div class="feedback ${ok ? 'ok' : 'bad'}"><h3>${ok ? '✔ 答對了！' : '✘ 這個答案不太對'}</h3><p>${ok ? esc(q.explain) : '再想一想，可以重新選擇，或直接看正確答案與解釋。'}</p></div>`;
      const fbShown = performance.now();
      const acts = $('.qa', box);
      const logFb = (reveal) => log({ event_type: 'feedback_viewed', module_id: moduleId, item_id: q.id, feedback_viewed: 1, correct: ok, attempt_count: attempt, time_on_task: Math.round((performance.now() - fbShown) / 100) / 10, response: reveal ? 'revealed' : null, extra: opts.extra });
      if (ok) {
        acts.innerHTML = `<button class="btn block" data-act="next">${opts.nextLabel || '下一步 →'}</button>`;
        $('[data-act=next]', box).addEventListener('click', () => { logFb(false); onNext(); });
      } else {
        acts.innerHTML = `<button class="btn secondary" data-act="retry">再試一次</button><button class="btn ghost" data-act="reveal">看正確答案</button>`;
        $('[data-act=retry]', box).addEventListener('click', () => { logFb(false); shownAt = performance.now(); cur = null; fb.innerHTML = ''; opts$.forEach(x => { x.classList.remove('wrong'); x.setAttribute('aria-checked', 'false'); }); acts.innerHTML = '<button class="btn" data-act="check" disabled>確認答案</button>'; $('[data-act=check]', box).addEventListener('click', check); });
        $('[data-act=reveal]', box).addEventListener('click', () => {
          solved = true; opts$.forEach((x, i) => { x.disabled = true; if (i === q.answer) x.classList.add('correct'); });
          fb.innerHTML = `<div class="feedback ok"><h3>正確答案：${String.fromCharCode(65 + q.answer)}. ${esc(q.options[q.answer])}</h3><p>${esc(q.explain)}</p></div>`;
          acts.innerHTML = `<button class="btn block" data-act="next">${opts.nextLabel || '下一步 →'}</button>`;
          $('[data-act=next]', box).addEventListener('click', () => { logFb(true); onNext(); });
        });
      }
    };
    draw();
  }

  // ---------- AI 對話元件 ----------
  function chatBlock(box, moduleId, prompts) {
    const key = moduleId || 'global';
    const hist = S.chats[key] = S.chats[key] || [];
    const disc = S.content.meta.aiDisclaimer;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    box.innerHTML = `<div class="disclaimer" role="note"><span aria-hidden="true">⚠️</span><span>${esc(disc)}<br><span style="font-weight:400">AI 不會診斷疾病，也不會建議停藥、改藥或提供個人化藥物／胰島素劑量。</span></span></div>
      <div class="chat" aria-live="polite" aria-label="AI 對話紀錄"></div>
      ${prompts?.length ? `<p class="muted" style="margin:.2rem 0">可以點選下面的問題，或自己輸入：</p><div class="pill-row">${prompts.map(p => `<button class="pill" data-p="${esc(p)}">💬 ${esc(p)}</button>`).join('')}</div>` : ''}
      <form class="chat-input" autocomplete="off"><label class="sr-only" for="ci-${key}">輸入問題</label>
        <input id="ci-${key}" class="input" maxlength="300" placeholder="輸入您的糖尿病衛教問題…" enterkeyhint="send">
        ${SR ? '<button type="button" class="btn secondary" data-mic aria-label="語音輸入">🎤</button>' : ''}
        <button class="btn" type="submit">送出</button></form>`;
    const chat = $('.chat', box), input = $('input', box);
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      entries.forEach(en => {
        const m = en.target;
        if (en.isIntersecting && !m._t) m._t = setTimeout(() => {
          io.unobserve(m);
          api('/api/p/ai/viewed', { interaction_id: m.dataset.iid, time_on_task: Math.round((performance.now() - m._shown) / 100) / 10 }).catch(() => { });
        }, 1500);
        else if (!en.isIntersecting && m._t) { clearTimeout(m._t); m._t = null; }
      });
    }, { threshold: 0.6 }) : null;
    const addMsg = (m, fresh) => {
      const d = document.createElement('div');
      d.className = `msg ${m.role}${m.guard ? ' guard' : ''}`;
      d.innerHTML = m.role === 'bot' ? `${nl2br(m.text)}<span class="meta">AI 智慧助理・健康教育資訊 ${ttsBtn(m.text)}</span>` : esc(m.text);
      chat.appendChild(d);
      if (fresh && m.role === 'bot' && m.iid) { d.dataset.iid = m.iid; d._shown = performance.now(); io ? io.observe(d) : api('/api/p/ai/viewed', { interaction_id: m.iid }).catch(() => { }); }
      chat.scrollTop = chat.scrollHeight;
    };
    if (!hist.length) addMsg({ role: 'bot', text: S.content.ai.welcome });
    hist.forEach(m => addMsg(m));
    const send = async (q) => {
      q = q.trim(); if (!q) return;
      input.value = '';
      const um = { role: 'user', text: q }; hist.push(um); addMsg(um);
      const typing = document.createElement('div'); typing.className = 'typing'; typing.textContent = 'AI 正在整理回答…'; chat.appendChild(typing);
      try {
        const byok = store.get('byok');
        const r = await api('/api/p/ai', { question: q, module_id: moduleId, ...(byok && byok.key ? { byok } : {}) });
        typing.remove();
        const bm = { role: 'bot', text: r.answer, guard: !!r.guardrail, iid: r.interaction_id }; hist.push(bm); addMsg(bm, true);
      } catch (e) { typing.remove(); addMsg({ role: 'bot', text: '抱歉，目前無法連線到 AI 智慧助理，請稍後再試。（' + e.message + '）' }); }
    };
    $('form', box).addEventListener('submit', e => { e.preventDefault(); send(input.value); });
    $$('[data-p]', box).forEach(b => b.addEventListener('click', () => send(b.dataset.p)));
    const mic = $('[data-mic]', box);
    if (mic) mic.addEventListener('click', () => {
      const r = new SR(); r.lang = 'zh-TW'; r.interimResults = false;
      mic.textContent = '⏺'; r.onresult = ev => { input.value = ev.results[0][0].transcript; }; r.onend = () => { mic.textContent = '🎤'; input.focus(); }; r.onerror = () => toast('語音辨識失敗，請改用打字');
      r.start();
    });
  }

  // ---------- 模組內頁 ----------
  routes.module = (el, id) => {
    const m = S.content.modules.find(x => x.id === id);
    const ms = S.state.mod[id] = S.state.mod[id] || { step: 0, page: 0, q: 0 };
    if (!ms.started) { ms.started = true; log({ event_type: 'module_started', module_id: id }); saveState(); }
    const pages = buildPages(m);
    let pageShownAt = performance.now();
    const leavePage = () => {
      if (ms.step === 1 && pages[ms.page]) log({ event_type: 'content_viewed', module_id: id, item_id: pages[ms.page].id, time_on_task: Math.round((performance.now() - pageShownAt) / 100) / 10 });
    };
    const draw = () => {
      pageShownAt = performance.now();
      const done = S.modulesDone.has(id);
      const head = `<div class="mod-head"><span class="ic" aria-hidden="true">${m.icon}</span><div><span class="muted">單元 ${m.no} / 8</span><h1 style="margin:0">${esc(m.title)}</h1></div></div>
        <nav class="substeps" aria-label="單元步驟">${MOD_STEPS.map((s, i) => `<button data-step="${i}" class="${i === ms.step ? 'current' : (i < ms.step || done) ? 'done' : ''}" ${i > (ms.maxStep || 0) && !done ? 'disabled' : ''} ${i === ms.step ? 'aria-current="step"' : ''}>${i + 1}. ${s}</button>`).join('')}</nav>`;
      el.innerHTML = head + '<div id="mbody"></div>';
      $$('[data-step]', el).forEach(b => b.addEventListener('click', () => { leavePage(); ms.step = +b.dataset.step; saveState(); draw(); }));
      const body = $('#mbody', el);
      const next = () => { leavePage(); ms.step++; ms.maxStep = Math.max(ms.maxStep || 0, ms.step); saveState(); draw(); window.scrollTo(0, 0); };
      const prev = () => { leavePage(); ms.step--; saveState(); draw(); window.scrollTo(0, 0); };
      if (ms.step === 0) {
        body.innerHTML = `<div class="card"><div class="row"><h2 class="grow">🎯 學習目標</h2>${ttsBtn('學習目標。' + m.objectives.join('。'))}</div>
          <p>完成這個單元後，您將能夠：</p><ol class="objectives">${m.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ol>
          ${m.steps ? `<p class="muted">本單元分為 ${m.steps.length} 個小步驟：${m.steps.map(esc).join(' → ')}</p>` : ''}</div>
          <div class="actions sticky"><a class="btn ghost" href="#/hub">← 單元列表</a><button class="btn" id="go">開始學習 →</button></div>`;
        $('#go').addEventListener('click', next);
      } else if (ms.step === 1) {
        const pg = pages[ms.page] || pages[0];
        body.innerHTML = `<div class="progress-label"><span>第 ${ms.page + 1} / ${pages.length} 張</span><span>${esc(pg.tag || '')}</span></div>
          <div class="bar" style="margin-bottom:1rem"><i style="width:${(ms.page + 1) / pages.length * 100}%"></i></div>
          <div id="pg"></div>
          <div class="actions sticky"><button class="btn ghost" id="pp">← 上一張</button><button class="btn" id="np">${ms.page === pages.length - 1 ? '看生活案例 →' : '下一張 →'}</button></div>`;
        pg.render($('#pg', body));
        $('#pp').addEventListener('click', () => { leavePage(); if (ms.page === 0) { ms.step = 0; } else ms.page--; saveState(); draw(); window.scrollTo(0, 0); });
        $('#np').addEventListener('click', () => { if (ms.page < pages.length - 1) { leavePage(); ms.page++; saveState(); draw(); window.scrollTo(0, 0); } else next(); });
      } else if (ms.step === 2) {
        body.innerHTML = `<div class="card case-card"><div class="row"><span class="who" aria-hidden="true">🧑‍🦳</span><h2 class="grow" style="margin:0">生活案例：${esc(m.case.title)}</h2>${ttsBtn(m.case.title + '。' + m.case.story)}</div>
          <p style="margin-top:.8rem;font-size:1.08rem">${esc(m.case.story)}</p><p class="muted">接下來請依照這個案例回答 ${m.questions.length} 個問題。</p></div>
          <div class="actions sticky"><button class="btn ghost" id="b">← 返回</button><button class="btn" id="n">開始作答 →</button></div>`;
        $('#b').addEventListener('click', prev); $('#n').addEventListener('click', next);
      } else if (ms.step === 3) {
        const qi = Math.min(ms.q || 0, m.questions.length - 1);
        body.innerHTML = `<div class="progress-label"><span>互動問題 ${qi + 1} / ${m.questions.length}</span><span>案例：${esc(m.case.title)}</span></div><div id="qb"></div>`;
        questionBlock($('#qb', body), m.questions[qi], id, () => {
          if (qi < m.questions.length - 1) { ms.q = qi + 1; saveState(); draw(); window.scrollTo(0, 0); } else { ms.q = 0; next(); }
        }, { nextLabel: qi < m.questions.length - 1 ? '下一題 →' : '完成作答，前往 AI 延伸提問 →' });
      } else if (ms.step === 4) {
        body.innerHTML = `<div class="card"><h2>🤖 AI 延伸提問</h2><p>對「${esc(m.title)}」還有疑問嗎？可以問問 AI 智慧助理（可略過）。</p><div id="cb"></div></div>
          <div class="actions sticky"><button class="btn ghost" id="b">← 返回</button><button class="btn" id="n">完成本單元 ✓</button></div>`;
        chatBlock($('#cb', body), id, m.aiPrompts);
        $('#b').addEventListener('click', prev);
        $('#n').addEventListener('click', () => {
          if (!S.modulesDone.has(id)) { log({ event_type: 'module_completed', module_id: id, module_completion: 1 }); flush(); S.modulesDone.add(id); }
          next();
        });
      } else {
        const nextMod = S.content.modules.find(x => !S.modulesDone.has(x.id));
        renderProgress();
        body.innerHTML = `<div class="celebrate">🏅</div><h2 class="center">完成「${esc(m.title)}」！</h2>
          <div class="card"><h3>本單元重點回顧</h3><ul>${m.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>
          <p class="center muted">已完成 ${S.modulesDone.size} / 8 個單元</p>
          <div class="actions sticky"><a class="btn ghost" href="#/hub">單元列表</a>${nextMod ? `<a class="btn" href="#/module/${nextMod.id}">下一單元：${esc(nextMod.title)} →</a>` : '<a class="btn" href="#/ai">前往 AI 智慧助理 →</a>'}</div>`;
      }
    };
    draw();
  };

  function buildPages(m) {
    const pages = [];
    const ctx = { log: e => log({ ...e, module_id: m.id }) };
    m.sections.forEach((s, i) => pages.push({
      id: `${m.id}-S${i + 1}`, tag: m.steps && s.step ? `步驟 ${s.step}：${m.steps[s.step - 1]}` : '圖文衛教',
      render: box => {
        box.innerHTML = `<article class="card content-card"><div class="row"><span class="big-ic" aria-hidden="true">${s.icon}</span><h2 class="grow" style="margin:0">${esc(s.title)}</h2>${ttsBtn(s.title + '。' + s.text)}</div>
          ${s.visual ? `<div class="vis">${DMW.visual(s.visual)}</div>` : ''}<p style="margin-top:.8rem;font-size:1.05rem">${esc(s.text)}</p></article>`;
      }
    }));
    if (m.widget) pages.push({ id: `${m.id}-W`, tag: '互動練習', render: box => DMW.mount(m.widget, box, ctx) });
    if (m.drugTable) pages.push({
      id: `${m.id}-DT`, tag: '藥物與食物注意事項', render: box => {
        box.innerHTML = `<div class="card"><h2>💊 常見需要注意的藥物與食物</h2><p class="muted">點選下方按鈕篩選兩種不同的交互作用，分開記比較不會混淆。</p>
          <div class="row" role="group"><button class="opt" style="width:auto" data-f="all" aria-pressed="true"><span class="mark">✓</span>全部</button>
          <button class="opt" style="width:auto" data-f="A" aria-pressed="false"><span class="mark"></span>A 會改變血糖</button>
          <button class="opt" style="width:auto" data-f="B" aria-pressed="false"><span class="mark"></span>B 影響吸收／藥效</button></div>
          <div class="table-wrap" style="margin-top:.8rem"><table class="tbl stack"><thead><tr><th>藥物／食物</th><th>影響</th><th>衛教重點</th></tr></thead><tbody></tbody></table></div>
          <p class="muted" style="margin-top:.6rem">資料整理自北醫附醫藥品使用指導單、FDA 仿單與 ADA 衛教資訊；此表不含所有藥物資訊，如有疑問請洽醫師或藥師。</p></div>`;
        const tb = $('tbody', box);
        const fill = f => { tb.innerHTML = m.drugTable.filter(r => f === 'all' || r.type === f).map(r => `<tr><td data-label="藥物／食物"><b>${esc(r.item)}</b> <span class="badge">${r.type}</span></td><td data-label="影響">${esc(r.effect)}</td><td data-label="衛教重點">${esc(r.tip)}</td></tr>`).join(''); };
        $$('[data-f]', box).forEach(b => b.addEventListener('click', () => { $$('[data-f]', box).forEach(x => { x.setAttribute('aria-pressed', x === b); x.querySelector('.mark').textContent = x === b ? '✓' : ''; }); fill(b.dataset.f); ctx.log({ event_type: 'widget_interaction', item_id: 'drugTable', response: b.dataset.f }); }));
        fill('all');
      }
    });
    if (m.insulin) {
      const ins = m.insulin;
      pages.push({
        id: `${m.id}-INS-STEPS`, tag: ins.title, render: box => {
          box.innerHTML = `<div class="card"><div class="row"><h2 class="grow">💉 ${esc(ins.title)}</h2>${ttsBtn(ins.steps.map(s => s.title + '。' + s.text).join('。'))}</div><p class="muted">${esc(ins.intro)}</p>
            <ol style="padding-left:1.2rem">${ins.steps.map(s => `<li style="margin:.7rem 0"><b>${s.icon} ${esc(s.title)}</b><br>${esc(s.text)}</li>`).join('')}</ol></div>`;
        }
      });
      pages.push({ id: `${m.id}-INS-MAP`, tag: '注射部位與輪替', render: box => DMW.mount('injectionMap', box, ctx) });
      pages.push({
        id: `${m.id}-INS-TYPE`, tag: '胰島素種類與進食時間', render: box => {
          box.innerHTML = `<div class="card"><h2>⏲️ 打完多久可以吃飯？先選胰島素種類</h2><p class="muted">「打完多久吃飯」不能統一寫成一個時間，要依胰島素種類而定。以下為一般原則，實際請依醫囑。</p>
            <div class="opt-list">${ins.types.map(t => `<button class="opt" data-t="${t.id}" aria-pressed="false"><span class="mark"></span>${esc(t.name)}</button>`).join('')}</div><div id="it-out" aria-live="polite"></div></div>`;
          $$('[data-t]', box).forEach(b => b.addEventListener('click', () => {
            const t = ins.types.find(x => x.id === b.dataset.t);
            $$('[data-t]', box).forEach(x => { x.setAttribute('aria-pressed', x === b); x.querySelector('.mark').textContent = x === b ? '✓' : ''; });
            $('#it-out', box).innerHTML = `<div class="feedback ok"><h3>${esc(t.name)}</h3><p>⏰ ${esc(t.timing)}</p><p>💡 ${esc(t.note)}</p></div>`;
            ctx.log({ event_type: 'widget_interaction', item_id: 'insulinType', response: t.id });
          }));
        }
      });
      pages.push({
        id: `${m.id}-INS-QUIZ`, tag: '胰島素 10 題情境測驗（加碼練習）', render: box => {
          const qs = ins.quiz; let i = 0, started = false;
          const intro = () => {
            const doneN = S.state.insQuizDone ? '（您已完成過，可再練習）' : '';
            box.innerHTML = `<div class="card center"><div style="font-size:3rem">📝</div><h2>胰島素施打 10 題情境測驗</h2><p>這是加碼練習${doneN}，幫助您熟悉胰島素的保存、注射與飲食配合。可以略過，直接按下方「下一張」。</p>
              <button class="btn" id="qs">開始 10 題測驗</button></div>`;
            $('#qs', box).addEventListener('click', () => { started = true; one(); });
          };
          const one = () => {
            box.innerHTML = `<div class="progress-label"><span>情境題 ${i + 1} / ${qs.length}</span></div><div id="iq"></div>`;
            questionBlock($('#iq', box), qs[i], m.id, () => {
              if (i < qs.length - 1) { i++; one(); box.scrollIntoView({ behavior: 'smooth' }); }
              else { S.state.insQuizDone = true; saveState(); box.innerHTML = '<div class="card center"><div class="celebrate">🎉</div><h2>完成 10 題情境測驗！</h2><p>請按下方「下一張」繼續。</p></div>'; }
            }, { extra: { set: 'insulin_quiz' }, nextLabel: i < qs.length - 1 ? '下一題 →' : '完成測驗 ✓' });
          };
          intro();
        }
      });
    }
    return pages;
  }

  // 受試者自備 AI 金鑰（研究者後臺開放時才顯示）：金鑰只存在這台裝置的瀏覽器
  async function byokPanel(box) {
    let cfg; try { cfg = await api('/api/p/ai/config', null, 'GET'); } catch { return; }
    if (!cfg.allowUserKey) { if (store.get('byok')) store.del('byok'); return; }
    const NAMES = { gemini: 'Google Gemini', openai: 'OpenAI（ChatGPT）', groq: 'Groq' };
    const draw = () => {
      const cur = store.get('byok');
      box.innerHTML = `<details class="card"><summary style="cursor:pointer;font-weight:700">🔑 使用自己的 AI 金鑰（選填）${cur ? `<span class="badge">使用中：${esc(NAMES[cur.provider])}</span>` : ''}</summary>
        <p class="muted">目前 AI 引擎：${esc(cfg.engine)}。如果您有自己的 API 金鑰，可以在這裡輸入；金鑰只存在這台裝置，不會被研究團隊保存。</p>
        <label>AI 服務<br><select class="input" id="bk-p">${Object.keys(NAMES).map(p => `<option value="${p}"${cur?.provider === p ? ' selected' : ''}>${NAMES[p]}</option>`).join('')}</select></label>
        <label style="display:block;margin-top:.6rem">模型<br><select class="input" id="bk-m"></select></label>
        <label style="display:block;margin-top:.6rem">API 金鑰<br><input class="input" id="bk-k" type="password" autocomplete="off" placeholder="${cur ? '已儲存，重新輸入可更換' : '貼上您的金鑰'}"></label>
        <div class="row" style="margin-top:.7rem"><button class="btn" id="bk-save">儲存</button>${cur ? '<button class="btn ghost" id="bk-del">清除我的金鑰</button>' : ''}</div></details>`;
      const fillM = () => { const p = $('#bk-p', box).value; $('#bk-m', box).innerHTML = cfg.options[p].map(m => `<option${m === (cur?.provider === p ? cur.model : cfg.defaults[p]) ? ' selected' : ''}>${esc(m)}</option>`).join(''); };
      fillM(); $('#bk-p', box).addEventListener('change', fillM);
      $('#bk-save', box).addEventListener('click', () => {
        const k = $('#bk-k', box).value.trim();
        if (!k && !cur) { toast('請先輸入金鑰'); return; }
        store.set('byok', { provider: $('#bk-p', box).value, model: $('#bk-m', box).value, key: k || cur.key });
        log({ event_type: 'widget_interaction', item_id: 'byok', response: $('#bk-p', box).value });
        toast('已儲存，之後的提問會使用您的金鑰'); draw();
      });
      const del = $('#bk-del', box); if (del) del.addEventListener('click', () => { store.del('byok'); toast('已清除'); draw(); });
    };
    draw();
  }

  // ---------- AI 智慧助理頁 ----------
  routes.ai = (el) => {
    const cats = S.content.modules.map(m => m.aiPrompts[0]);
    const all8 = S.modulesDone.size >= 8;
    el.innerHTML = `<h1>🤖 AI 智慧助理</h1><p class="lead">想問什麼都可以，例如血糖、飲食、運動、低血糖、足部照護或藥物安全的一般原則。</p>
      <div class="card"><div id="cb"></div></div><div id="byok"></div>
      <div class="actions sticky">${all8 && !S.posttestDone ? '<a class="btn ghost" href="#/hub">單元列表</a><button class="btn" id="to-post">前往知識後測 →</button>' : S.completed ? '<a class="btn ghost" href="#/hub">單元列表</a><a class="btn" href="#/done">回到學習成果</a>' : '<a class="btn block secondary" href="#/hub">← 回到單元列表</a>'}</div>`;
    chatBlock($('#cb', el), null, cats);
    byokPanel($('#byok', el));
    const tp = $('#to-post');
    if (tp) tp.addEventListener('click', () => { S.state.aiDone = true; S.state.stage = 'posttest'; saveState(); go('#/posttest'); });
  };

  // ---------- 問卷（前測問卷／後測問卷／滿意度問卷，每份分成數個部分，一頁一部分）----------
  function surveyView(el, sid, onDone) {
    const sv = S.content.surveys[sid];
    const defs = sv.parts.map(k => S.content[k]);
    const draftKey = 'sv_' + sid;
    const ans = store.get(draftKey, {});
    let part = Math.min(store.get(draftKey + '_part', 0), defs.length - 1);
    const draw = () => {
      const def = defs[part];
      el.innerHTML = `<h1>${esc(sv.title)}</h1>${part === 0 ? `<div class="card soft"><p style="margin:0">${esc(sv.intro)}</p></div>` : ''}
        <div class="progress-label"><span>第 ${part + 1} / ${defs.length} 部分：${esc(def.title)}</span><span>${def.items.length} 題</span></div>
        <div class="bar" style="margin-bottom:1rem"><i style="width:${(part + 1) / defs.length * 100}%"></i></div>
        <div class="card soft"><p style="margin:0">${esc(def.intro)}<br><span class="muted">1＝${esc(def.scale[0])}，5＝${esc(def.scale[def.scale.length - 1])}</span></p></div>
        <div class="card">${def.items.map((it, n) => `<div class="likert-item" role="radiogroup" aria-labelledby="lk-${it.id}">
          <div class="row"><p id="lk-${it.id}" class="grow" style="margin:0;font-weight:700">${n + 1}. ${esc(it.text)}</p>${ttsBtn(it.text)}</div>
          <div class="likert">${def.scale.map((sc, i) => `<button class="opt" role="radio" data-q="${it.id}" data-v="${i + 1}" aria-checked="${ans[it.id] === i + 1}"><span class="mark">${i + 1}</span>${esc(sc)}</button>`).join('')}</div></div>`).join('')}
        ${(def.open || []).map(o => `<div class="field"><label for="${o.id}">${esc(o.label)}</label><textarea id="${o.id}" class="input" rows="3" maxlength="1000">${esc(ans[o.id] || '')}</textarea></div>`).join('')}</div>
        <p id="q-err" class="feedback bad" hidden></p>
        <div class="actions sticky">${part > 0 ? '<button class="btn ghost" id="q-prev">← 上一部分</button>' : ''}<button class="btn ${part > 0 ? '' : 'block'}" id="q-next">${part < defs.length - 1 ? '下一部分 →' : '送出問卷 ✓'}</button></div>`;
      $$('.likert .opt', el).forEach(b => b.addEventListener('click', () => {
        ans[b.dataset.q] = +b.dataset.v; store.set(draftKey, ans);
        $$(`.opt[data-q="${b.dataset.q}"]`, el).forEach(x => x.setAttribute('aria-checked', x === b));
      }));
      (def.open || []).forEach(o => $('#' + o.id, el).addEventListener('input', e => { ans[o.id] = e.target.value; store.set(draftKey, ans); }));
      const prev = $('#q-prev', el);
      if (prev) prev.addEventListener('click', () => { part--; store.set(draftKey + '_part', part); draw(); window.scrollTo(0, 0); });
      $('#q-next', el).addEventListener('click', async () => {
        const er = $('#q-err', el);
        const miss = def.items.filter(it => !ans[it.id]);
        if (miss.length) { er.textContent = `這一部分還有 ${miss.length} 題沒有回答（第 ${miss.map(m => def.items.indexOf(m) + 1).join('、')} 題）`; er.hidden = false; $(`#lk-${miss[0].id}`, el).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        if (part < defs.length - 1) { part++; store.set(draftKey + '_part', part); draw(); window.scrollTo(0, 0); return; }
        const btn = $('#q-next', el); btn.disabled = true; btn.textContent = '儲存中，請稍候…';
        try {
          const r = await api('/api/p/survey', { survey: sid, answers: ans });
          S.surveys = new Set(r.surveys_done); store.del(draftKey); store.del(draftKey + '_part'); saveState(); onDone();
        } catch (e) { er.textContent = e.message; er.hidden = false; btn.disabled = false; btn.textContent = '送出問卷 ✓'; }
      });
    };
    draw();
  }
  routes.presurvey = el => surveyView(el, 'pre', () => {
    S.state.stage = 'modules'; saveState(); renderProgress();
    el.innerHTML = `<div class="celebrate">📘</div><h1 class="center">前測問卷完成，謝謝您！</h1>
      <div class="card"><p>接下來有 8 個互動式衛教單元，每個單元約 5–8 分鐘，可以依自己的步調分次完成。</p></div>
      <div class="actions sticky"><a class="btn block" href="#/hub">開始學習 ➜</a></div>`;
    window.scrollTo(0, 0);
  });
  routes.postsurvey = el => surveyView(el, 'post', () => { S.state.stage = 'sat'; saveState(); go('#/sat'); });
  routes.sat = el => surveyView(el, 'sat', async () => {
    S.state.stage = 'done'; saveState();
    try { await api('/api/p/complete', {}); S.completed = true; } catch (e) { toast(e.message); }
    go('#/done');
  });

  // ---------- 完成後：知識測驗再測（練習，不覆蓋正式後測）----------
  routes.retake = (el) => {
    const items = S.content.knowledgeTest.items;
    const ans = {}; let idx = 0; const t0 = performance.now();
    log({ event_type: 'retake_started' });
    const show = () => {
      const it = items[idx]; const sel = ans[it.id];
      el.innerHTML = `<h1>知識測驗：再測一次</h1>${idx === 0 ? '<div class="card soft"><p style="margin:0">這是完成學習後的自我練習，題目與前測、後測相同，不會改變您正式的後測分數。完成後會告訴您每一題的正確答案。</p></div>' : ''}
        <div class="progress-label"><span>第 ${idx + 1} / ${items.length} 題</span><span>${Object.keys(ans).length} 題已作答</span></div>
        <div class="bar" style="margin-bottom:1rem"><i style="width:${(idx + 1) / items.length * 100}%"></i></div>
        <div class="card" role="radiogroup" aria-labelledby="tq"><div class="row"><h2 id="tq" class="grow" style="font-size:1.2rem">${idx + 1}. ${esc(it.stem)}</h2>${ttsBtn(it.stem + '。' + it.options.map((o, i) => `選項${i + 1}，${o}`).join('。'))}</div>
        <div class="opt-list">${it.options.map((o, i) => `<button class="opt" role="radio" data-i="${i}" aria-checked="${sel === i}"><span class="mark">${sel === i ? '✓' : String.fromCharCode(65 + i)}</span>${esc(o)}</button>`).join('')}</div></div>
        <p id="t-err" class="feedback bad" hidden></p>
        <div class="actions sticky"><button class="btn ghost" id="prev" ${idx === 0 ? 'disabled' : ''}>← 上一題</button>
          <button class="btn" id="nxt" ${sel == null ? 'disabled' : ''}>${idx === items.length - 1 ? '送出 ✓' : '下一題 →'}</button></div>`;
      $$('.opt', el).forEach(b => b.addEventListener('click', () => {
        ans[it.id] = +b.dataset.i;
        $$('.opt', el).forEach((x, i) => { x.setAttribute('aria-checked', i === ans[it.id]); x.querySelector('.mark').textContent = i === ans[it.id] ? '✓' : String.fromCharCode(65 + i); });
        $('#nxt').disabled = false;
      }));
      $('#prev').addEventListener('click', () => { idx--; show(); });
      $('#nxt').addEventListener('click', async () => {
        if (idx < items.length - 1) { idx++; show(); return; }
        const btn = $('#nxt'); btn.disabled = true; btn.textContent = '計分中…';
        try {
          const r = await api('/api/p/test/retake', { answers: ans, time_on_task: Math.round((performance.now() - t0) / 1000) });
          el.innerHTML = `<div class="celebrate">💯</div><h1 class="center">再測完成！</h1>
            ${scoreCard(r, `第 ${r.attempt} 次再測分數`)}
            <div class="card"><h2>逐題對答案</h2><ol class="review">${r.review.map(q => `<li class="${q.correct ? 'ok' : 'bad'}"><b>${q.correct ? '✔' : '✘'} ${esc(q.stem)}</b><br>
              ${q.correct ? '' : `您的答案：${esc(q.options[q.response])}<br>`}正確答案：<b>${esc(q.options[q.answer])}</b></li>`).join('')}</ol></div>
            <div class="actions"><a class="btn" href="#/done">回到學習成果</a><a class="btn secondary" href="#/ai">問 AI</a><a class="btn ghost" href="#/hub">複習單元</a></div>`;
          renderProgress(); window.scrollTo(0, 0);
        } catch (e) { const er = $('#t-err'); er.textContent = e.message; er.hidden = false; btn.disabled = false; btn.textContent = '送出 ✓'; }
      });
    };
    show();
  };

  // Chart.js 只在學習成果頁需要，延後載入
  let chartJs = null;
  const loadChart = () => chartJs = chartJs || new Promise((ok, no) => {
    if (window.Chart) return ok(window.Chart);
    const sc = document.createElement('script'); sc.src = 'vendor/chart.umd.js'; sc.onload = () => ok(window.Chart); sc.onerror = no; document.head.appendChild(sc);
  });

  routes.done = async (el) => {
    el.innerHTML = '<p>載入學習成果中…</p>';
    let s = S.summary;
    try { s = await api('/api/p/summary', null, 'GET'); } catch { /* 使用快取 */ }
    if (!S.completed) { try { await api('/api/p/complete', {}); S.completed = true; renderProgress(); } catch { } }
    const sign = s.gain > 0 ? '+' : '';
    const best = (s.retakes || []).reduce((m, r) => Math.max(m, r.score), -1);
    const SCALE_NOTE = { anxiety: '分數越低代表越不焦慮' };
    el.innerHTML = `<div class="celebrate">🎉</div><h1 class="center">恭喜完成全部學習！</h1>
      <div class="card"><h2>您的學習成果摘要</h2>
        <div class="score-row"><div><div class="muted">前測</div><div class="n">${s.pretest_score ?? '—'}</div></div>
        <div><div class="muted">後測</div><div class="n">${s.posttest_score ?? '—'}</div></div>
        <div><div class="muted">進步</div><div class="n" style="color:${s.gain < 0 ? 'var(--bad)' : 'var(--ok)'}">${s.gain == null ? '—' : sign + s.gain}</div></div></div>
        <p class="muted center">滿分 100 分｜完成 ${s.modules_completed} 個單元｜向 AI 提問 ${s.ai_questions} 次${best >= 0 ? `｜再測最高 ${best} 分` : ''}</p></div>
      <div class="card"><h2>我和大家的比較趨勢</h2><p class="muted" id="cmp-note">載入中…</p>
        <div class="chart-box"><canvas id="c-cmp" aria-label="知識測驗分數：我和大家平均的比較"></canvas></div>
        <div class="table-wrap" id="cmp-table"></div></div>
      <div class="card"><h2>各主題答對題數</h2><p class="muted">灰色：前測｜紫色：後測</p>
        ${s.domains.map(d => `<div class="domain-bar"><span class="lbl">${d.icon} ${esc(d.title)}</span>
          <div><div class="bar" style="margin-bottom:3px"><i class="pre" style="width:${d.pre_correct / d.n * 100}%"></i></div><div class="bar"><i style="width:${d.post_correct / d.n * 100}%"></i></div></div>
          <span>${d.pre_correct}→${d.post_correct}/${d.n}</span></div>`).join('')}</div>
      <div class="card soft"><p><b>謝謝您完成本次學習！</b>您可以隨時回到單元列表複習、詢問 AI 智慧助理，或再測一次知識測驗（不影響正式成績）。</p><p class="muted">${esc(S.content.meta.aiDisclaimer)} 若有身體不適，請洽您的醫療團隊。</p></div>
      <div class="actions"><a class="btn" href="#/retake">再測一次知識測驗</a><a class="btn secondary" href="#/ai">問 AI</a><a class="btn secondary" href="#/hub">複習單元</a><a class="btn ghost" href="#/sources">資料來源</a></div>`;
    try {
      const [g, Chart] = await Promise.all([api('/api/p/compare', null, 'GET'), loadChart()]);
      if (!$('#c-cmp')) return;
      const labels = ['知識前測', '知識後測']; const me = [s.pretest_score, s.posttest_score]; const avg = [g.pretest_mean, g.posttest_mean];
      if (best >= 0) { labels.push('再測（最高）'); me.push(best); avg.push(g.retake_mean); }
      $('#cmp-note').textContent = `「大家」為已完成後測的 ${g.n} 人平均${g.simulated ? '（目前人數較少，含示範資料）' : ''}。`;
      const cs = getComputedStyle(document.documentElement);
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; Chart.defaults.color = cs.getPropertyValue('--ink-2').trim();
      new Chart($('#c-cmp'), {
        type: 'line',
        data: { labels, datasets: [
          { label: '我', data: me, borderColor: cs.getPropertyValue('--brand').trim(), backgroundColor: cs.getPropertyValue('--brand').trim(), borderWidth: 4, pointRadius: 7, tension: .2 },
          { label: '大家平均', data: avg, borderColor: '#9a8aa6', backgroundColor: '#9a8aa6', borderDash: [8, 6], borderWidth: 3, pointRadius: 6, tension: .2 }
        ] },
        options: { maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 16 } } } }, scales: { y: { min: 0, max: 100, title: { display: true, text: '分數' } }, x: { ticks: { font: { size: 15 } } } } }
      });
      const keys = ['health_literacy', 'anxiety', 'learning_se', 'self_efficacy'];
      const f = v => v == null ? '—' : v;
      $('#cmp-table').innerHTML = `<table class="tbl cmp" style="margin-top:1rem"><thead><tr><th>問卷（平均 1–5 分）</th><th>我：前→後</th><th>大家：前→後</th></tr></thead><tbody>
        ${keys.filter(k => s.scales[k]).map(k => `<tr><td data-label="問卷"><b>${esc(s.scales[k].title)}</b>${SCALE_NOTE[k] ? `<br><span class="muted">${SCALE_NOTE[k]}</span>` : ''}</td>
          <td data-label="我">${f(s.scales[k].pre_mean)} → ${f(s.scales[k].post_mean)}</td><td data-label="大家">${f(g.scales[k]?.pre_mean)} → ${f(g.scales[k]?.post_mean)}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) { const n = $('#cmp-note'); if (n) n.textContent = '目前無法載入比較資料（' + e.message + '）'; }
  };

  routes.sources = (el) => {
    el.innerHTML = `<h1>衛教資料來源</h1><div class="card"><ul>${S.content.meta.sources.map(s => `<li style="margin:.5rem 0"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join('')}</ul>
      <p class="muted">本平台內容為一般健康教育資訊，不能取代醫師、護理師或其他醫療專業人員之診斷與治療。</p></div>
      <div class="actions"><button class="btn secondary" id="src-back">← 返回</button></div>`;
    $('#src-back').addEventListener('click', () => history.back());
  };

  // ---------- 啟動 ----------
  async function resume() {
    const r = await api('/api/p/resume', { device_type: device });
    S.sid = r.session_id; S.pid = r.participant_id; S.resumeCode = r.resume_code; store.set('rc', S.resumeCode);
    S.state = Object.assign({ stage: 'demographics', mod: {} }, r.state || {}); S.state.mod = S.state.mod || {};
    S.modulesDone = new Set(r.modules_completed); S.hasDemo = r.has_demographics;
    S.pretestDone = r.pretest_done; S.posttestDone = r.posttest_done; S.completed = r.completed;
    S.surveys = new Set(r.surveys_done || []); S.scores = { pre: r.pretest_score, post: r.posttest_score };
    S.answered = { pre: {}, post: {} }; const ids = new Set(S.content.knowledgeTest.items.map(i => i.id)); r.answered.forEach(a => { if (S.answered[a.phase] && ids.has(a.item_id)) S.answered[a.phase][a.item_id] = a.response; });
    if (S.completed) { S.state.aiDone = true; ['pre', 'post', 'sat'].forEach(x => S.surveys.add(x)); }
  }

  async function boot() {
    $('#btn-fs-down').addEventListener('click', () => { const v = Math.max(1, store.get('fs', 2) - 1); store.set('fs', v); applyPrefs(); log({ event_type: 'font_size_changed', response: v }); });
    $('#btn-fs-up').addEventListener('click', () => { const v = Math.min(4, store.get('fs', 2) + 1); store.set('fs', v); applyPrefs(); log({ event_type: 'font_size_changed', response: v }); });
    $('#btn-contrast').addEventListener('click', () => { store.set('contrast', store.get('contrast') === 'high' ? 'normal' : 'high'); applyPrefs(); });
    // 預錄語音清單：載入失敗不影響使用（改用瀏覽器朗讀）
    const audioReady = fetch('audio/manifest.json').then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.files)) AUDIO = new Set(j.files); }).catch(() => { });
    try { const cr = await fetch(API + '/api/content'); if (!cr.ok) throw new Error('HTTP ' + cr.status); S.content = await cr.json(); await audioReady; }
    catch { $('#main').innerHTML = '<div class="card"><h1>無法載入內容</h1><p>請確認網路連線後重新整理頁面。伺服器若閒置較久，第一次開啟可能需要約 1 分鐘喚醒，請稍候再試。</p></div>'; return; }
    document.title = S.content.meta.shortTitle;
    // 每日瀏覽人次：匿名訪客 id（與編號無關）
    try {
      let vid = store.get('vid');
      if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9]/g, '').slice(0, 32); store.set('vid', vid); }
      fetch(API + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid }) }).catch(() => { });
    } catch { /* 不影響使用 */ }
    if (S.token) {
      try { await resume(); }
      catch (e) {
        if (e.status === 401 || e.status === 403) { store.del('token'); S.token = null; toast('找不到先前的紀錄，請重新開始或輸入繼續碼'); }
        else { S.state = store.get('state', S.state); toast('目前離線，部分功能可能無法使用'); }
      }
    }
    try { render(); }
    catch (e) { $('#main').innerHTML = '<div class="card"><h1>頁面載入發生問題</h1><p>請按瀏覽器的「重新整理」，或改用 Chrome／Safari 開啟本網址。</p><p class="muted">' + esc(e && e.message) + '</p></div>'; }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  boot();
})();
