/* 圖文插圖（內嵌 SVG）與互動小工具 */
(function () {
  const S = (fill) => `style="fill:${fill}"`;
  const T = (x, y, txt, size = 16, anchor = 'middle', color = 'var(--ink)', weight = 700) =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" style="fill:${color};font-size:${size}px;font-weight:${weight}">${txt}</text>`;

  const VISUALS = {
    key: () => `<svg viewBox="0 0 420 200" role="img" aria-label="胰島素像鑰匙，打開細胞讓葡萄糖進入">
      <rect x="250" y="30" width="150" height="140" rx="70" ${S('var(--brand-soft)')} stroke="var(--brand)" stroke-width="3"/>
      ${T(325, 95, '細胞', 20)}${T(325, 122, '（產生能量）', 14, 'middle', 'var(--ink-2)', 400)}
      <rect x="236" y="82" width="28" height="36" rx="6" ${S('var(--surface)')} stroke="var(--brand)" stroke-width="3"/>
      <circle cx="60" cy="100" r="26" ${S('#f59e0b')}/><rect x="84" y="94" width="110" height="12" rx="4" ${S('#f59e0b')}/>
      <rect x="168" y="106" width="10" height="16" ${S('#f59e0b')}/><rect x="184" y="106" width="10" height="22" ${S('#f59e0b')}/>
      ${T(60, 106, '胰島素', 13, 'middle', '#3b2300')}
      <circle cx="120" cy="45" r="13" ${S('#ef4444')}/><circle cx="155" cy="160" r="13" ${S('#ef4444')}/><circle cx="205" cy="40" r="13" ${S('#ef4444')}/>
      ${T(120, 50, '糖', 12, 'middle', '#fff')}${T(155, 165, '糖', 12, 'middle', '#fff')}${T(205, 45, '糖', 12, 'middle', '#fff')}
      ${T(210, 192, '鑰匙不靈光或不夠 → 糖留在血液', 14, 'middle', 'var(--ink-2)', 400)}
    </svg>`,
    a1c: () => {
      const segs = [[5, '#22c55e'], [6, '#84cc16'], [7, '#eab308'], [8, '#f97316'], [9, '#ef4444']];
      return `<svg viewBox="0 0 420 150" role="img" aria-label="糖化血色素刻度，常見目標低於 7%">
      ${segs.map(([v, c], i) => `<rect x="${20 + i * 76}" y="40" width="76" height="34" ${S(c)}/>${T(20 + i * 76, 96, v + '%', 15)}`).join('')}
      ${T(400, 96, '10%', 15)}
      <path d="M172 30 L172 84" stroke="var(--ink)" stroke-width="4"/>${T(172, 24, '常見目標 < 7%', 16, 'middle', 'var(--brand)')}
      ${T(210, 130, '反映過去約 2–3 個月的平均血糖', 15, 'middle', 'var(--ink-2)', 400)}</svg>`;
    },
    meter: () => `<svg viewBox="0 0 420 190" role="img" aria-label="測血糖步驟：洗手、插試紙、扎指側、記錄">
      ${['🧼 洗手擦乾', '📟 插入試紙', '🩸 扎手指側邊', '📒 記錄數值'].map((s, i) => `
        <rect x="${10 + i * 102}" y="30" width="94" height="110" rx="14" ${S('var(--surface-2)')} stroke="var(--line)" stroke-width="2"/>
        <circle cx="${57 + i * 102}" cy="20" r="16" ${S('var(--brand)')}/>${T(57 + i * 102, 26, i + 1, 16, 'middle', 'var(--brand-ink)')}
        ${T(57 + i * 102, 85, s.split(' ')[0], 34)}${T(57 + i * 102, 125, s.split(' ')[1], 14)}`).join('')}
      ${T(210, 175, '手上殘留糖分會讓數值假性偏高', 14, 'middle', 'var(--ink-2)', 400)}</svg>`,
    range: () => `<svg viewBox="0 0 420 170" role="img" aria-label="血糖範圍：低於 70 為低血糖，空腹 80 到 130，餐後低於 180">
      <rect x="20" y="50" width="380" height="36" rx="8" ${S('var(--surface-2)')}/>
      <rect x="20" y="50" width="76" height="36" rx="8" ${S('#ef4444')}/>
      <rect x="117" y="50" width="76" height="36" ${S('#22c55e')}/>
      <rect x="193" y="50" width="76" height="36" ${S('#a3e635')}/>
      <rect x="269" y="50" width="131" height="36" rx="8" ${S('#f59e0b')}/>
      ${T(58, 40, '< 70 低血糖', 13)}${T(155, 40, '空腹 80–130', 13)}${T(231, 40, '餐後 < 180', 13)}${T(334, 40, '偏高', 13)}
      ${[0, 70, 130, 180, 300].map(v => T(20 + v / 300 * 380, 108, v, 13, 'middle', 'var(--ink-2)', 400)).join('')}
      ${T(210, 150, '單位 mg/dL；個人目標以醫療團隊建議為準', 14, 'middle', 'var(--ink-2)', 400)}</svg>`,
    plate: () => `<svg viewBox="0 0 420 240" class="plate-svg" role="img" aria-label="糖尿病餐盤：一半蔬菜、四分之一蛋白質、四分之一全穀">
      <circle cx="150" cy="120" r="105" ${S('var(--surface)')} stroke="var(--line)" stroke-width="6"/>
      <path d="M150 120 L150 15 A105 105 0 0 0 150 225 Z" ${S('#86efac')}/>
      <path d="M150 120 L150 15 A105 105 0 0 1 255 120 Z" ${S('#fca5a5')}/>
      <path d="M150 120 L255 120 A105 105 0 0 1 150 225 Z" ${S('#fde68a')}/>
      ${T(98, 118, '🥦', 30)}${T(98, 148, '½ 蔬菜', 16, 'middle', '#14532d')}
      ${T(190, 72, '🍗', 24)}${T(192, 98, '¼ 蛋白質', 13, 'middle', '#7f1d1d')}
      ${T(190, 160, '🍚', 24)}${T(192, 186, '¼ 全穀', 13, 'middle', '#713f12')}
      <rect x="300" y="70" width="60" height="100" rx="10" ${S('#bae6fd')} stroke="#0284c7" stroke-width="3"/>${T(330, 128, '💧', 26)}${T(330, 195, '白開水', 15)}
    </svg>`,
    twoType: () => `<svg viewBox="0 0 420 210" role="img" aria-label="兩種交互作用：A 會改變血糖，B 會影響藥物吸收或藥效">
      <rect x="10" y="10" width="195" height="190" rx="16" ${S('#fef3c7')} stroke="#d97706" stroke-width="3"/>
      <rect x="215" y="10" width="195" height="190" rx="16" ${S('#ede9fe')} stroke="#7c3aed" stroke-width="3"/>
      ${T(107, 42, 'A 會改變血糖', 17, 'middle', '#92400e')}${T(312, 42, 'B 影響吸收／藥效', 17, 'middle', '#5b21b6')}
      ${['⬆ 類固醇、利尿劑', '⬆ 甲狀腺素、感冒藥', '⬇ 酒精、漏餐', '⬇ 胰島素＋磺醯脲類'].map((s, i) => T(107, 80 + i * 30, s, 14, 'middle', '#3b2300', 400)).join('')}
      ${['Rybelsus＋食物', '→ 吸收變差', 'Rifampin＋Trajenta', '→ 藥效降低'].map((s, i) => T(312, 80 + i * 30, s, 14, 'middle', '#2e1065', i % 2 ? 400 : 700)).join('')}
    </svg>`,
    symptoms: () => {
      const items = [['😋', '飢餓感'], ['💦', '冒冷汗'], ['💓', '心跳加快'], ['🫨', '顫抖'], ['😵‍💫', '頭暈'], ['😪', '嗜睡'], ['😩', '虛弱無力'], ['🤯', '注意力不集中']];
      return `<svg viewBox="0 0 420 210" role="img" aria-label="低血糖常見症狀">
      ${items.map(([e, t], i) => { const x = 52 + (i % 4) * 105, y = 20 + Math.floor(i / 4) * 95; return `<rect x="${x - 46}" y="${y}" width="92" height="84" rx="14" ${S('var(--surface-2)')} stroke="var(--line)"/>${T(x, y + 44, e, 30)}${T(x, y + 72, t, 13)}`; }).join('')}</svg>`;
    },
    rule1515: () => `<svg viewBox="0 0 420 250" role="img" aria-label="15-15 原則流程">
      ${[['血糖 < 70', '#ef4444', '#fff'], ['吃 15g 快速醣類', '#f59e0b', '#3b2300'], ['等 15 分鐘再測', '#0ea5e9', '#fff'], ['≥ 70：吃正餐或點心', '#22c55e', '#052e16']].map(([t, c, tc], i) =>
        `<rect x="70" y="${8 + i * 60}" width="280" height="44" rx="22" ${S(c)}/>${T(210, 37 + i * 60, t, 17, 'middle', tc)}${i < 3 ? `<path d="M210 ${52 + i * 60} l0 8" stroke="var(--ink)" stroke-width="3"/>` : ''}`).join('')}
      <path d="M350 150 C 410 150, 410 90, 350 90" fill="none" stroke="var(--bad)" stroke-width="3" stroke-dasharray="6 4"/>
      ${T(398, 124, '仍<70', 12, 'middle', 'var(--bad)')}${T(398, 140, '再一次', 12, 'middle', 'var(--bad)')}</svg>`,
    foot: () => `<svg viewBox="0 0 420 230" role="img" aria-label="每天檢查腳背、腳底、腳跟、趾縫">
      <path d="M120 210 C 70 210, 60 150, 75 110 C 85 80, 90 50, 120 40 C 150 30, 170 60, 168 100 C 166 140, 175 210, 120 210 Z" ${S('#fcd9b8')} stroke="#b45309" stroke-width="3"/>
      ${[[98, 30], [122, 22], [142, 26], [158, 36], [168, 52]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="${9 - i}" ry="${11 - i}" ${S('#fcd9b8')} stroke="#b45309" stroke-width="2"/>`).join('')}
      ${[[130, 70, '趾縫'], [110, 130, '腳底'], [120, 190, '腳跟']].map(([x, y, t]) => `<circle cx="${x}" cy="${y}" r="10" ${S('var(--accent)')} opacity=".85"/><path d="M${x + 10} ${y} L240 ${y}" stroke="var(--accent)" stroke-width="2"/>${T(250, y + 5, t, 16, 'start')}`).join('')}
      ${T(300, 30, '每天 3 分鐘', 17, 'middle', 'var(--brand)')}${T(330, 225, '看不到腳底可用鏡子', 13, 'middle', 'var(--ink-2)', 400)}</svg>`,
    abc: () => `<svg viewBox="0 0 420 170" role="img" aria-label="糖尿病 ABC：糖化血色素、血壓、膽固醇">
      ${[['A', 'A1C 糖化血色素', '#0ea5e9'], ['B', 'Blood pressure 血壓', '#f97316'], ['C', 'Cholesterol 膽固醇', '#a855f7']].map(([l, t, c], i) =>
        `<circle cx="${75 + i * 135}" cy="65" r="48" ${S(c)}/>${T(75 + i * 135, 82, l, 46, 'middle', '#fff', 800)}${T(75 + i * 135, 140, t.split(' ').slice(-1)[0], 15)}`).join('')}
      ${T(210, 165, '＋ 戒菸，大幅降低心血管風險', 14, 'middle', 'var(--ink-2)', 400)}</svg>`
  };

  // ---------- 互動小工具 ----------
  const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

  function glucoseMeter(el, ctx) {
    el.innerHTML = `<div class="widget"><h3>🩸 互動練習：看懂血糖數字</h3>
      <p class="muted">拖曳滑桿或輸入數值，並選擇測量時間，看看屬於哪個範圍（一般衛教參考）。</p>
      <div class="row" role="group" aria-label="測量時間">
        <button class="opt" style="width:auto" data-t="fast" aria-pressed="true"><span class="mark">✓</span>空腹／餐前</button>
        <button class="opt" style="width:auto" data-t="post" aria-pressed="false"><span class="mark"></span>餐後 1–2 小時</button></div>
      <div class="range-wrap field"><label for="gm-v">血糖值：<b id="gm-show">110</b> mg/dL</label>
        <input id="gm-v" type="range" min="30" max="350" value="110" step="1"></div>
      <div id="gm-out" aria-live="polite"></div></div>`;
    let t = 'fast';
    const v = el.querySelector('#gm-v'), out = el.querySelector('#gm-out'), show = el.querySelector('#gm-show');
    let touched = false;
    const render = () => {
      const x = +v.value; show.textContent = x;
      let cls, label, msg;
      if (x < 70) { cls = 'low'; label = '低血糖警示'; msg = '若清醒，依 15-15 原則先吃 15 公克快速吸收醣類，15 分鐘後再測。意識不清請撥 119。'; }
      else if (t === 'fast' ? x <= 130 : x < 180) { cls = 'ok'; label = '在常見目標範圍內'; msg = '很好！持續記錄，回診時和醫療團隊一起看趨勢。'; }
      else { cls = 'high'; label = '高於常見目標'; msg = '記錄當時飲食、活動與身體狀況；持續偏高請與醫療團隊討論，不要自行加藥。若有嚴重口渴、嘔吐、意識改變請就醫。'; }
      out.innerHTML = `<p><span class="zone ${cls}">${label}</span></p><p>${msg}</p>`;
    };
    v.addEventListener('input', render);
    v.addEventListener('change', () => { if (!touched) { touched = true; } ctx.log({ event_type: 'widget_interaction', item_id: 'glucoseMeter', response: `${t}:${v.value}` }); });
    el.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
      t = b.dataset.t; el.querySelectorAll('[data-t]').forEach(x => { x.setAttribute('aria-pressed', x === b); x.querySelector('.mark').textContent = x === b ? '✓' : ''; }); render();
    }));
    render();
  }

  const FOODS = [
    { id: 'veg1', e: '🥬', n: '燙青菜', g: 'veg' }, { id: 'veg2', e: '🥦', n: '花椰菜', g: 'veg' }, { id: 'veg3', e: '🍄', n: '炒菇類', g: 'veg' },
    { id: 'pro1', e: '🍗', n: '滷雞腿去皮', g: 'pro' }, { id: 'pro2', e: '🧈', n: '滷豆腐', g: 'pro' }, { id: 'pro3', e: '🍤', n: '炸排骨', g: 'fried' },
    { id: 'gr1', e: '🍚', n: '糙米飯半碗', g: 'grain' }, { id: 'gr2', e: '🍠', n: '地瓜一小條', g: 'grain' }, { id: 'gr3', e: '🍛', n: '大碗滷肉飯', g: 'biggrain' },
    { id: 'dr1', e: '🍵', n: '無糖茶', g: 'drink' }, { id: 'dr2', e: '💧', n: '白開水', g: 'drink' }, { id: 'dr3', e: '🧋', n: '全糖珍奶', g: 'sugar' }
  ];
  function plateBuilder(el, ctx) {
    el.innerHTML = `<div class="widget"><h3>🍽️ 互動練習：幫張大哥配一份午餐</h3>
      <p class="muted">點選食物放進餐盤（可多選），再按「檢查我的餐盤」。</p>
      <div class="food-grid">${FOODS.map(f => `<button class="food" data-id="${f.id}" aria-pressed="false"><span class="e">${f.e}</span>${f.n}</button>`).join('')}</div>
      <div class="actions"><button class="btn" id="pb-check">檢查我的餐盤</button><button class="btn ghost" id="pb-reset">清空</button></div>
      <div id="pb-out" aria-live="polite"></div></div>`;
    const sel = new Set();
    el.querySelectorAll('.food').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id; sel.has(id) ? sel.delete(id) : sel.add(id); b.setAttribute('aria-pressed', sel.has(id));
    }));
    el.querySelector('#pb-reset').addEventListener('click', () => { sel.clear(); el.querySelectorAll('.food').forEach(b => b.setAttribute('aria-pressed', 'false')); el.querySelector('#pb-out').innerHTML = ''; });
    el.querySelector('#pb-check').addEventListener('click', () => {
      const g = [...sel].map(id => FOODS.find(f => f.id === id).g);
      const cnt = k => g.filter(x => x === k).length;
      const tips = []; let good = 0;
      if (cnt('veg') >= 2) { good++; tips.push('✅ 蔬菜有 2 份以上，約佔半盤，很棒！'); } else tips.push('➕ 蔬菜要佔半盤，建議至少選 2 種蔬菜。');
      if (cnt('pro') >= 1) { good++; tips.push('✅ 有選低脂蛋白質。'); } else tips.push('➕ 加一份滷雞腿去皮或豆腐等蛋白質（約 ¼ 盤）。');
      if (cnt('fried')) tips.push('⚠️ 炸排骨油脂高，可換成滷或烤的蛋白質。');
      if (cnt('biggrain')) tips.push('⚠️ 大碗滷肉飯主食份量太多、油脂也高，可換成半碗糙米飯。');
      const gr = cnt('grain') + cnt('biggrain');
      if (gr === 1 && !cnt('biggrain')) { good++; tips.push('✅ 主食份量適中（約 ¼ 盤）。'); }
      else if (gr === 0) tips.push('➕ 別忘了適量主食，完全不吃飯容易沒力或低血糖。');
      else if (gr >= 2) tips.push('⚠️ 選了兩種主食（例如地瓜＋米飯），醣量加倍，請擇一。');
      if (cnt('sugar')) tips.push('⚠️ 全糖珍奶會讓血糖快速上升，改無糖茶或白開水。');
      else if (cnt('drink')) { good++; tips.push('✅ 飲料選得好！'); } else tips.push('➕ 搭配白開水或無糖茶。');
      const perfect = good === 4 && !cnt('fried') && !cnt('sugar') && !cnt('biggrain');
      el.querySelector('#pb-out').innerHTML = `<div class="feedback ${perfect ? 'ok' : 'bad'}"><h3>${perfect ? '🎉 完美的糖尿病餐盤！' : '再調整一下會更好'}</h3>${tips.map(t => `<p>${t}</p>`).join('')}</div>`;
      ctx.log({ event_type: 'widget_interaction', item_id: 'plateBuilder', response: [...sel].join('|'), correct: perfect });
    });
  }

  function hypoSimulator(el, ctx) {
    const FOOD = [
      { n: '🧃 柳橙汁 150 mL', ok: true }, { n: '🍬 方糖 3 顆', ok: true }, { n: '🍫 巧克力一條', ok: false, why: '巧克力含脂肪，糖分吸收較慢，不是處理低血糖的首選。' },
      { n: '🍘 高纖蘇打餅', ok: false, why: '高纖食物吸收慢，無法快速提升血糖。' }, { n: '🍵 無糖茶', ok: false, why: '無糖茶沒有醣類，無法提升血糖。' }
    ];
    let glu = 58, round = 0;
    el.innerHTML = `<div class="widget"><h3>🍬 互動模擬：幫吳太太處理低血糖</h3><div id="hs"></div></div>`;
    const box = el.querySelector('#hs');
    const screen = (msg) => `<div class="sim-screen"><div class="muted">血糖機</div><div class="glu">${glu}</div><div class="muted">mg/dL</div></div><p aria-live="polite">${msg}</p>`;
    const choose = () => {
      box.innerHTML = screen(round === 0 ? '吳太太頭暈、手抖，血糖 58 mg/dL，意識清楚。請選擇要給她吃什麼？' : '15 分鐘後血糖仍低於 70，請再處理一次：') +
        `<div class="opt-list">${FOOD.map((f, i) => `<button class="opt" data-i="${i}"><span class="mark">${i + 1}</span>${f.n}</button>`).join('')}</div>`;
      box.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
        const f = FOOD[+b.dataset.i];
        ctx.log({ event_type: 'widget_interaction', item_id: 'hypoSimulator', response: `round${round}:${f.n}`, correct: f.ok });
        if (!f.ok) { b.classList.add('wrong'); b.disabled = true; const p = document.createElement('p'); p.className = 'feedback bad'; p.textContent = '❌ ' + f.why; b.after(p); return; }
        box.innerHTML = screen(`✅ 很好！吃了 ${f.n}（約 15 公克醣）。接下來要等 15 分鐘再測血糖。`) + `<div class="actions"><button class="btn" id="hs-wait">⏩ 快轉 15 分鐘並再測</button></div>`;
        box.querySelector('#hs-wait').addEventListener('click', () => {
          round++;
          glu = round === 1 ? 66 : 92;
          if (glu < 70) choose();
          else box.innerHTML = screen('🎉 血糖回升到 92 mg/dL！症狀改善。') +
            `<div class="feedback ok"><h3>最後一步</h3><p>若接近吃飯時間就立即吃正餐；若離下一餐超過 1 小時，吃一份點心（例如一杯 240 mL 牛奶）避免再次低血糖。若處理兩次仍未改善，應送醫。</p></div>
             <button class="btn secondary small" id="hs-again">再玩一次</button>`;
          const again = box.querySelector('#hs-again'); if (again) again.addEventListener('click', () => { glu = 58; round = 0; choose(); });
        });
      }));
    };
    choose();
  }

  function footCheck(el, ctx) {
    const items = ['看腳背、腳底有沒有傷口或水泡', '看趾縫有沒有破皮、潮濕或黴菌', '看有沒有紅腫、發熱或顏色改變', '摸摸看有沒有雞眼、厚繭', '檢查趾甲有沒有變形、嵌甲', '用溫水洗腳（手肘測水溫）並擦乾趾縫', '乾燥處擦乳液（趾縫不擦）', '穿上淺色襪子與合腳的鞋，先摸鞋內有無異物'];
    el.innerHTML = `<div class="widget"><h3>🦶 互動練習：今天的雙腳檢查清單</h3><p class="muted">一邊想像自己在檢查，一邊勾選完成的項目。</p>
      <div>${items.map((t, i) => `<label class="check-line"><input type="checkbox" data-i="${i}"> <span>${t}</span></label>`).join('')}</div><div id="fc-out" aria-live="polite"></div></div>`;
    const boxes = el.querySelectorAll('input');
    boxes.forEach(b => b.addEventListener('change', () => {
      const n = [...boxes].filter(x => x.checked).length;
      el.querySelector('#fc-out').innerHTML = n === items.length ? '<div class="feedback ok"><h3>🎉 完成今天的足部照護！</h3><p>每天花 3 分鐘，就能及早發現小傷口。發現異狀請盡快就醫。</p></div>' : `<p class="muted">已完成 ${n} / ${items.length} 項</p>`;
      if (n === items.length) ctx.log({ event_type: 'widget_interaction', item_id: 'footCheck', response: 'all_checked', correct: true });
    }));
  }

  function injectionMap(el, ctx) {
    el.innerHTML = `<div class="widget"><h3>📍 互動練習：選擇注射部位與輪替</h3>
      <p class="muted">點選人體圖上的區域「模擬注射」。綠色是常見皮下注射部位，紅色虛線是要避開的地方。</p>
      <div class="body-map"><svg viewBox="0 0 200 400" aria-label="人體正面圖">
        <circle cx="100" cy="40" r="28" style="fill:var(--surface-2);stroke:var(--ink-2);stroke-width:2"/>
        <path d="M60 75 Q100 65 140 75 L150 200 Q100 215 50 200 Z" style="fill:var(--surface-2);stroke:var(--ink-2);stroke-width:2"/>
        <path d="M60 78 L30 190 L42 194 L68 110 Z M140 78 L170 190 L158 194 L132 110 Z" style="fill:var(--surface-2);stroke:var(--ink-2);stroke-width:2"/>
        <path d="M55 200 L60 380 L95 380 L98 215 Z M145 200 L140 380 L105 380 L102 215 Z" style="fill:var(--surface-2);stroke:var(--ink-2);stroke-width:2"/>
        <rect class="site" data-site="arm_l" tabindex="0" role="button" aria-label="左上臂外側" x="34" y="100" width="22" height="50" rx="8"/>
        <rect class="site" data-site="arm_r" tabindex="0" role="button" aria-label="右上臂外側" x="144" y="100" width="22" height="50" rx="8"/>
        <path class="site" data-site="abdomen" tabindex="0" role="button" aria-label="腹部（避開肚臍周圍）" d="M68 135 H132 V190 H68 Z"/>
        <circle class="site no" data-site="navel" tabindex="0" role="button" aria-label="肚臍周圍" cx="100" cy="162" r="12"/>
        <rect class="site" data-site="thigh_l" tabindex="0" role="button" aria-label="左大腿前外側" x="60" y="230" width="30" height="70" rx="10"/>
        <rect class="site" data-site="thigh_r" tabindex="0" role="button" aria-label="右大腿前外側" x="110" y="230" width="30" height="70" rx="10"/>
        <circle class="site no" data-site="wrist" tabindex="0" role="button" aria-label="手腕" cx="36" cy="196" r="10"/>
        <g id="im-dots"></g></svg>
        <div><div id="im-out" aria-live="polite"><p>請點選一個部位。</p></div><p class="muted">臀部外上方也是常見部位（圖為正面，未繪出）。</p>
        <button class="btn ghost small" id="im-reset">清除注射點</button></div></div></div>`;
    const NAMES = { arm_l: '左上臂外側', arm_r: '右上臂外側', abdomen: '腹部', thigh_l: '左大腿前外側', thigh_r: '右大腿前外側', navel: '肚臍周圍', wrist: '手腕' };
    const hist = [];
    const dots = el.querySelector('#im-dots'), out = el.querySelector('#im-out');
    const act = (site, evt) => {
      const svg = el.querySelector('svg');
      if (site === 'navel' || site === 'wrist') {
        out.innerHTML = `<div class="feedback bad"><h3>❌ ${NAMES[site]}不適合</h3><p>${site === 'navel' ? '腹部注射要避開肚臍周圍約 5 公分。' : '手腕不是皮下注射部位。請選擇腹部、大腿前外側、上臂外側或臀部外上方。'}</p></div>`;
        ctx.log({ event_type: 'widget_interaction', item_id: 'injectionMap', response: site, correct: false }); return;
      }
      let x = 0, y = 0;
      if (evt && evt.clientX) { const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); x = p.x; y = p.y; }
      else { const r = evt.target.getBBox(); x = r.x + r.width / 2 + (Math.random() - .5) * r.width * .6; y = r.y + r.height / 2 + (Math.random() - .5) * r.height * .6; }
      const prev = hist[hist.length - 1];
      let msg;
      if (prev && prev.site === site && Math.hypot(prev.x - x, prev.y - y) < 6) msg = '⚠️ 和上一次太接近了！同一區域內每次要移動約 1 指幅（2–3 公分），避免脂肪增生硬塊。';
      else if (prev && prev.site === site) msg = '✅ 同一區域內換了位置，很好！可以用順時針方向系統性輪替。';
      else msg = `✅ ${NAMES[site]}是常見的皮下注射部位。下次在同一區域內移動約 1 指幅。`;
      hist.push({ site, x, y });
      dots.insertAdjacentHTML('beforeend', `<circle class="dot" cx="${x}" cy="${y}" r="4"/>`);
      out.innerHTML = `<div class="feedback ${msg.startsWith('⚠️') ? 'bad' : 'ok'}"><h3>第 ${hist.length} 次注射：${NAMES[site]}</h3><p>${msg}</p></div>`;
      ctx.log({ event_type: 'widget_interaction', item_id: 'injectionMap', response: site, correct: !msg.startsWith('⚠️') });
    };
    el.querySelectorAll('.site').forEach(s => {
      s.addEventListener('click', e => act(s.dataset.site, e));
      s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(s.dataset.site, { target: s }); } });
    });
    el.querySelector('#im-reset').addEventListener('click', () => { hist.length = 0; dots.innerHTML = ''; out.innerHTML = '<p>請點選一個部位。</p>'; });
  }

  window.DMW = {
    visual: k => (VISUALS[k] ? VISUALS[k]() : ''),
    mount: (name, el, ctx) => ({ glucoseMeter, plateBuilder, hypoSimulator, footCheck, injectionMap }[name] || (() => {}))(el, ctx)
  };
})();
