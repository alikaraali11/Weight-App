(() => {
  'use strict';

  const STORAGE_KEY = 'weight-tracker.v1';
  const MIN_LB = 50;
  const MAX_LB = 1000;
  const HISTORY_PAGE = 14;
  const DAY_MS = 86400000;

  const $ = (id) => document.getElementById(id);

  let state = load();
  let range = '90';
  let historyExpanded = false;
  let chartModel = null;

  /* ---------- Storage ---------- */

  function emptyState() {
    return { entries: [], goal: null, heightIn: null };
  }

  function validWeight(w) {
    return typeof w === 'number' && isFinite(w) && w >= MIN_LB && w <= MAX_LB;
  }

  function validDate(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const [y, m, day] = d.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
  }

  function normalize(raw) {
    const out = emptyState();
    if (!raw || typeof raw !== 'object') return out;
    const byDate = new Map();
    for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
      const w = round1(Number(e && e.weight));
      if (e && validDate(e.date) && validWeight(w)) byDate.set(e.date, w);
    }
    out.entries = [...byDate].map(([date, weight]) => ({ date, weight }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (validWeight(Number(raw.goal))) out.goal = round1(Number(raw.goal));
    const h = Number(raw.heightIn);
    if (isFinite(h) && h >= 36 && h <= 107) out.heightIn = h;
    return out;
  }

  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
      return emptyState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      toast('Could not save — browser storage is unavailable.');
    }
  }

  /* ---------- Helpers ---------- */

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayNum(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  }

  function fmtDay(day, withYear) {
    const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
    if (withYear) opts.year = 'numeric';
    return new Intl.DateTimeFormat(undefined, opts).format(new Date(day * DAY_MS));
  }

  function fmtDate(dateStr, withYear) {
    return fmtDay(dayNum(dateStr), withYear);
  }

  function lb(n) {
    return `${n.toFixed(1)} lb`;
  }

  function signed(n) {
    const r = round1(n);
    if (r === 0) return '0.0';
    return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(1);
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) Object.assign(node, props);
    for (const c of children || []) node.append(c);
    return node;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- Calculations ---------- */

  // Exponentially smoothed trend. Smoothing is time-aware so gaps between
  // weigh-ins don't make old readings linger.
  function withTrend(entries) {
    let trend = null;
    let prevDay = null;
    return entries.map((e) => {
      const day = dayNum(e.date);
      if (trend === null) trend = e.weight;
      else trend += (1 - Math.pow(0.9, day - prevDay)) * (e.weight - trend);
      prevDay = day;
      return { date: e.date, weight: e.weight, day, trend };
    });
  }

  // Least-squares slope (lb/day) over the last 28 days of weigh-ins.
  function pacePerDay(pts) {
    if (!pts.length) return null;
    const last = pts[pts.length - 1].day;
    const win = pts.filter((p) => p.day >= last - 28);
    if (win.length < 3 || win[win.length - 1].day - win[0].day < 6) return null;
    const n = win.length;
    const mx = win.reduce((s, p) => s + p.day, 0) / n;
    const my = win.reduce((s, p) => s + p.weight, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of win) {
      num += (p.day - mx) * (p.weight - my);
      den += (p.day - mx) ** 2;
    }
    return den ? num / den : null;
  }

  function average(pts, days) {
    if (!pts.length) return null;
    const last = pts[pts.length - 1].day;
    const win = pts.filter((p) => p.day > last - days);
    return win.reduce((s, p) => s + p.weight, 0) / win.length;
  }

  function bmiInfo(weight, heightIn) {
    const bmi = (703 * weight) / (heightIn * heightIn);
    let label = 'Obese range';
    if (bmi < 18.5) label = 'Underweight range';
    else if (bmi < 25) label = 'Healthy range';
    else if (bmi < 30) label = 'Overweight range';
    return { bmi, label };
  }

  /* ---------- Rendering ---------- */

  function render() {
    const pts = withTrend(state.entries);
    renderLogHint();
    renderSummary(pts);
    renderChart(pts);
    renderStats(pts);
    renderHistory(pts);
  }

  function renderLogHint() {
    const date = $('logDate').value;
    const existing = state.entries.find((e) => e.date === date);
    const hint = $('logHint');
    hint.classList.remove('error');
    $('logSubmit').textContent = existing ? 'Update' : 'Save';
    hint.textContent = existing
      ? `Already logged ${lb(existing.weight)} on ${fmtDate(date)} — saving will replace it.`
      : '';
  }

  function renderSummary(pts) {
    const box = $('summary');
    box.replaceChildren();
    if (!pts.length) {
      box.append(el('p', { className: 'empty', textContent: 'Log your first weigh-in above to get started.' }));
      return;
    }
    const first = pts[0];
    const cur = pts[pts.length - 1];

    box.append(el('div', { className: 'current' }, [
      el('strong', { textContent: cur.weight.toFixed(1) }),
      el('span', { textContent: `lb · ${fmtDate(cur.date)}` }),
    ]));

    if (pts.length > 1) {
      const diff = round1(cur.weight - first.weight);
      const cls = diff < 0 ? 'down' : diff > 0 ? 'up' : '';
      const word = diff < 0 ? 'down' : diff > 0 ? 'up' : 'no change';
      box.append(el('p', {
        className: `delta ${cls}`,
        textContent: diff === 0
          ? `No change since ${fmtDate(first.date)}`
          : `${Math.abs(diff).toFixed(1)} lb ${word} since ${fmtDate(first.date)}`,
      }));
    }

    const goalBox = el('div', { className: 'goal' });
    box.append(goalBox);

    if (state.goal === null) {
      const btn = el('button', { className: 'btn ghost', type: 'button', textContent: 'Set a goal weight' });
      btn.addEventListener('click', openSettings);
      goalBox.append(btn);
      return;
    }

    const goal = state.goal;
    const total = first.weight - goal;
    const remaining = round1(cur.weight - goal);
    const reached = remaining <= 0;
    const pct = reached ? 100 : total > 0 ? Math.max(0, Math.min(100, ((first.weight - cur.weight) / total) * 100)) : 0;

    const fill = el('i');
    fill.style.width = `${pct}%`;
    goalBox.append(el('div', { className: 'bar' }, [fill]));
    goalBox.append(el('div', { className: 'goal-row' }, [
      el('span', { textContent: reached ? 'Goal reached' : `${remaining.toFixed(1)} lb to go` }),
      el('span', { textContent: `${Math.round(pct)}% · goal ${lb(goal)}` }),
    ]));

    const proj = el('p', { className: 'projection' });
    goalBox.append(proj);
    if (reached) {
      proj.textContent = `You hit your goal of ${lb(goal)}. Nicely done.`;
      return;
    }
    const pace = pacePerDay(pts);
    if (pace === null) {
      proj.textContent = 'Log at least 3 weigh-ins across a week to see a projected goal date.';
      return;
    }
    const perWeek = pace * 7;
    if (perWeek > -0.05) {
      proj.textContent = `Recent pace is ${signed(perWeek)} lb/week, so there is no projected goal date yet.`;
      return;
    }
    const daysLeft = Math.ceil((cur.trend - goal) / -pace);
    const eta = Math.max(dayNum(todayStr()), cur.day) + Math.max(daysLeft, 1);
    proj.append(
      'At your recent pace of ',
      el('b', { textContent: `${Math.abs(perWeek).toFixed(1)} lb/week` }),
      ', you would reach your goal around ',
      el('b', { textContent: fmtDay(eta, true) }),
      '.',
    );
    if (perWeek < -2) {
      goalBox.append(el('p', {
        className: 'note',
        textContent: 'That is faster than the 1–2 lb/week usually recommended for sustainable loss.',
      }));
    }
  }

  function renderStats(pts) {
    const box = $('stats');
    box.replaceChildren();
    const add = (label, value, sub) => {
      const dd = el('dd', { textContent: value });
      if (sub) dd.append(el('small', { textContent: sub }));
      box.append(el('div', null, [el('dt', { textContent: label }), dd]));
    };
    if (!pts.length) {
      add('Weigh-ins', '0');
      return;
    }
    const first = pts[0];
    const cur = pts[pts.length - 1];
    const low = pts.reduce((a, b) => (b.weight < a.weight ? b : a));
    const pace = pacePerDay(pts);

    add('Starting weight', lb(first.weight), fmtDate(first.date, true));
    add('Total change', `${signed(cur.weight - first.weight)} lb`, `${cur.day - first.day} days`);
    add('Lowest', lb(low.weight), fmtDate(low.date, true));
    add('Trend weight', lb(cur.trend), 'smoothed');
    add('7-day average', lb(average(pts, 7)));
    add('30-day average', lb(average(pts, 30)));
    add('Recent pace', pace === null ? '—' : `${signed(pace * 7)} lb/wk`, 'last 4 weeks');
    if (state.heightIn) {
      const { bmi, label } = bmiInfo(cur.weight, state.heightIn);
      add('BMI', bmi.toFixed(1), label);
    } else {
      add('BMI', '—', 'add height in Settings');
    }
    add('Weigh-ins', String(pts.length));
  }

  function renderHistory(pts) {
    const list = $('history');
    list.replaceChildren();
    const more = $('historyMore');
    if (!pts.length) {
      list.append(el('li', null, [el('span', { className: 'empty', textContent: 'No weigh-ins yet.' })]));
      more.hidden = true;
      return;
    }
    const rows = pts.slice().reverse();
    const shown = historyExpanded ? rows : rows.slice(0, HISTORY_PAGE);
    shown.forEach((p) => {
      const idx = pts.indexOf(p);
      const prev = idx > 0 ? pts[idx - 1] : null;
      const diff = prev ? round1(p.weight - prev.weight) : null;
      const chg = el('span', {
        className: `chg ${diff === null || diff === 0 ? '' : diff < 0 ? 'down' : 'up'}`,
        textContent: diff === null ? '' : signed(diff),
      });
      const edit = el('button', { type: 'button', textContent: 'Edit' });
      edit.setAttribute('aria-label', `Edit ${fmtDate(p.date, true)}`);
      edit.addEventListener('click', () => {
        $('logDate').value = p.date;
        $('logWeight').value = p.weight.toFixed(1);
        renderLogHint();
        $('logWeight').focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      const del = el('button', { type: 'button', className: 'del', textContent: 'Delete' });
      del.setAttribute('aria-label', `Delete ${fmtDate(p.date, true)}`);
      del.addEventListener('click', () => {
        if (!confirm(`Delete the ${fmtDate(p.date, true)} weigh-in (${lb(p.weight)})?`)) return;
        state.entries = state.entries.filter((e) => e.date !== p.date);
        save();
        render();
      });
      list.append(el('li', null, [
        el('span', { className: 'd', textContent: fmtDate(p.date, p.date.slice(0, 4) !== todayStr().slice(0, 4)) }),
        el('span', { className: 'w', textContent: lb(p.weight) }),
        chg,
        el('span', { className: 'rowbtns' }, [edit, del]),
      ]));
    });
    more.hidden = rows.length <= HISTORY_PAGE;
    more.textContent = historyExpanded ? 'Show fewer' : `Show all ${rows.length}`;
  }

  /* ---------- Chart ---------- */

  function niceStep(span, target) {
    const rough = span / target;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    for (const m of [1, 2, 5, 10]) if (m * pow >= rough) return m * pow;
    return 10 * pow;
  }

  function legendHtml() {
    return '<i class="key trend"></i>Trend<i class="key raw"></i>Weigh-ins'
      + (chartModel && chartModel.showGoal ? '<i class="key goalkey"></i>Goal' : '');
  }

  function renderChart(pts) {
    const svg = $('chart');
    const empty = $('chartEmpty');
    for (const b of $('ranges').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.range === range));
    }

    let view = pts;
    if (range !== 'all' && pts.length) {
      const cutoff = pts[pts.length - 1].day - Number(range);
      view = pts.filter((p) => p.day >= cutoff);
    }

    if (view.length < 2) {
      chartModel = null;
      svg.replaceChildren();
      svg.style.display = 'none';
      empty.hidden = false;
      $('chartReadout').textContent = '';
      return;
    }
    svg.style.display = '';
    empty.hidden = true;

    const W = Math.max(svg.clientWidth || $('chartWrap').clientWidth || 320, 240);
    const H = 260;
    const m = { l: 40, r: 12, t: 12, b: 24 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const x0 = view[0].day;
    const x1 = view[view.length - 1].day;
    let lo = Math.min(...view.map((p) => Math.min(p.weight, p.trend)));
    let hi = Math.max(...view.map((p) => Math.max(p.weight, p.trend)));

    // Only stretch the axis to the goal when it is close enough that doing so
    // doesn't flatten the data into a line.
    const goal = state.goal;
    const showGoal = goal !== null && goal <= hi && lo - goal <= Math.max(10, (hi - lo) * 1.5);
    if (showGoal) lo = Math.min(lo, goal);

    let span = hi - lo;
    if (span < 4) {
      const mid = (hi + lo) / 2;
      lo = mid - 2;
      hi = mid + 2;
      span = 4;
    }
    lo -= span * 0.06;
    hi += span * 0.06;

    const sx = (d) => m.l + ((d - x0) / (x1 - x0)) * (W - m.l - m.r);
    const sy = (w) => m.t + ((hi - w) / (hi - lo)) * (H - m.t - m.b);
    const f = (n) => n.toFixed(1);

    let html = '';
    const step = niceStep(hi - lo, 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = f(sy(v));
      html += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
      html += `<text x="${m.l - 6}" y="${y}" text-anchor="end" dominant-baseline="middle">${step < 1 ? v.toFixed(1) : Math.round(v)}</text>`;
    }

    const ticks = Math.min(4, x1 - x0 + 1);
    for (let i = 0; i < ticks; i++) {
      const d = Math.round(x0 + ((x1 - x0) * i) / Math.max(ticks - 1, 1));
      const anchor = i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle';
      html += `<text x="${f(sx(d))}" y="${H - 6}" text-anchor="${anchor}">${fmtDay(d)}</text>`;
    }

    if (showGoal) {
      const y = sy(goal);
      html += `<line class="goalline" x1="${m.l}" x2="${W - m.r}" y1="${f(y)}" y2="${f(y)}"/>`;
      html += `<text class="goaltext" x="${W - m.r - 2}" y="${f(y - 5)}" text-anchor="end">Goal ${goal.toFixed(1)}</text>`;
    }

    html += `<polyline class="rawline" points="${view.map((p) => `${f(sx(p.day))},${f(sy(p.weight))}`).join(' ')}"/>`;
    if (view.length <= 90) {
      html += view.map((p) => `<circle class="dot" cx="${f(sx(p.day))}" cy="${f(sy(p.weight))}" r="2.5"/>`).join('');
    }
    html += `<polyline class="trendline" points="${view.map((p) => `${f(sx(p.day))},${f(sy(p.trend))}`).join(' ')}"/>`;
    html += `<g id="cursor" visibility="hidden"><line class="cursor" y1="${m.t}" y2="${H - m.b}"/><circle class="cursordot" r="5"/></g>`;

    svg.innerHTML = html;
    chartModel = { view, sx, sy, showGoal };
    $('chartReadout').innerHTML = legendHtml();
  }

  function chartPoint(evt) {
    if (!chartModel) return;
    const svg = $('chart');
    const x = evt.clientX - svg.getBoundingClientRect().left;
    const { view, sx, sy } = chartModel;
    let best = view[0];
    for (const p of view) if (Math.abs(sx(p.day) - x) < Math.abs(sx(best.day) - x)) best = p;
    const cursor = svg.querySelector('#cursor');
    cursor.setAttribute('visibility', 'visible');
    const line = cursor.querySelector('line');
    line.setAttribute('x1', sx(best.day));
    line.setAttribute('x2', sx(best.day));
    const dot = cursor.querySelector('circle');
    dot.setAttribute('cx', sx(best.day));
    dot.setAttribute('cy', sy(best.weight));
    const readout = $('chartReadout');
    readout.replaceChildren(
      el('b', { textContent: fmtDate(best.date, true) }),
      ` · ${lb(best.weight)} · trend ${best.trend.toFixed(1)}`,
    );
  }

  function chartLeave() {
    if (!chartModel) return;
    const cursor = $('chart').querySelector('#cursor');
    if (cursor) cursor.setAttribute('visibility', 'hidden');
    $('chartReadout').innerHTML = legendHtml();
  }

  /* ---------- Settings & data ---------- */

  function openSettings() {
    $('setGoal').value = state.goal === null ? '' : state.goal.toFixed(1);
    if (state.heightIn) {
      $('setFt').value = Math.floor(state.heightIn / 12);
      $('setIn').value = round1(state.heightIn % 12);
    } else {
      $('setFt').value = '';
      $('setIn').value = '';
    }
    $('settings').showModal();
  }

  function saveSettings(evt) {
    evt.preventDefault();
    const goalRaw = $('setGoal').value.trim();
    const ftRaw = $('setFt').value.trim();
    const inRaw = $('setIn').value.trim();

    let goal = null;
    if (goalRaw !== '') {
      goal = round1(Number(goalRaw));
      if (!validWeight(goal)) return toast(`Goal must be between ${MIN_LB} and ${MAX_LB} lb.`);
    }
    let heightIn = null;
    if (ftRaw !== '' || inRaw !== '') {
      const ft = Number(ftRaw || 0);
      const inches = Number(inRaw || 0);
      heightIn = ft * 12 + inches;
      if (!isFinite(heightIn) || inches < 0 || inches >= 12 || heightIn < 36 || heightIn > 107) {
        return toast('Enter a height between 3 ft and 8 ft 11 in.');
      }
    }
    state.goal = goal;
    state.heightIn = heightIn;
    save();
    $('settings').close();
    render();
    toast('Settings saved');
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function parseImport(text) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === 'object') return normalize(data);
    } catch { /* fall through to CSV */ }
    const entries = [];
    for (const line of text.split(/\r?\n/)) {
      const [date, weight] = line.split(',').map((s) => s.trim());
      if (validDate(date)) entries.push({ date, weight: Number(weight) });
    }
    return normalize({ entries });
  }

  async function importFile(file) {
    const incoming = parseImport(await file.text());
    if (!incoming.entries.length) return toast('No weigh-ins found in that file.');
    const merged = normalize({
      entries: [...state.entries, ...incoming.entries],
      goal: state.goal ?? incoming.goal,
      heightIn: state.heightIn ?? incoming.heightIn,
    });
    state = merged;
    save();
    $('settings').close();
    render();
    toast(`Imported ${incoming.entries.length} weigh-ins`);
  }

  /* ---------- Events ---------- */

  $('logForm').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const date = $('logDate').value;
    const weight = round1(Number($('logWeight').value));
    const hint = $('logHint');
    const fail = (msg) => {
      hint.textContent = msg;
      hint.classList.add('error');
    };
    if (!validDate(date)) return fail('Pick a date.');
    if (date > todayStr()) return fail('That date is in the future.');
    if ($('logWeight').value.trim() === '' || !validWeight(weight)) {
      return fail(`Enter a weight between ${MIN_LB} and ${MAX_LB} lb.`);
    }
    const replaced = state.entries.some((e) => e.date === date);
    state = normalize({ ...state, entries: [...state.entries.filter((e) => e.date !== date), { date, weight }] });
    save();
    $('logWeight').value = '';
    $('logDate').value = todayStr();
    render();
    toast(`${replaced ? 'Updated' : 'Saved'} ${lb(weight)} for ${fmtDate(date)}`);
  });

  $('logDate').addEventListener('change', renderLogHint);

  $('ranges').addEventListener('click', (evt) => {
    const btn = evt.target.closest('button[data-range]');
    if (!btn) return;
    range = btn.dataset.range;
    renderChart(withTrend(state.entries));
  });

  $('chart').addEventListener('pointerdown', chartPoint);
  $('chart').addEventListener('pointermove', chartPoint);
  $('chart').addEventListener('pointerleave', chartLeave);

  $('historyMore').addEventListener('click', () => {
    historyExpanded = !historyExpanded;
    renderHistory(withTrend(state.entries));
  });

  $('openSettings').addEventListener('click', openSettings);
  $('settingsCancel').addEventListener('click', () => $('settings').close());
  $('settingsForm').addEventListener('submit', saveSettings);

  $('exportJson').addEventListener('click', () => {
    download(`weight-backup-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
  });
  $('exportCsv').addEventListener('click', () => {
    const rows = ['date,weight_lb', ...state.entries.map((e) => `${e.date},${e.weight.toFixed(1)}`)];
    download(`weight-${todayStr()}.csv`, rows.join('\n') + '\n', 'text/csv');
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (evt) => {
    const file = evt.target.files[0];
    evt.target.value = '';
    if (file) importFile(file).catch(() => toast('Could not read that file.'));
  });
  $('wipe').addEventListener('click', () => {
    if (!confirm('Delete every weigh-in and your settings from this device? This cannot be undone.')) return;
    state = emptyState();
    save();
    $('settings').close();
    render();
    toast('All data deleted');
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderChart(withTrend(state.entries)), 120);
  });

  /* ---------- Start ---------- */

  $('logDate').value = todayStr();
  $('logDate').max = todayStr();
  render();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
