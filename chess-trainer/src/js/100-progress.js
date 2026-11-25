/* ================= progress ================= */
const ROADMAP = [
  {
    band: '800 → 1000',
    title: 'Stop giving pieces away',
    items: ['Blunder check before every move', 'Count attackers and defenders', 'Mate with queen, and with rook'],
    metric: s => `Blunders per game: <b>${s.bpg}</b> (goal under 1)`,
  },
  {
    band: '1000 → 1200',
    title: 'Take what they give you',
    items: ['Punish loose pieces', 'Forks, pins and skewers', 'Back-rank and mate-in-2 patterns'],
    metric: s => `Missed chances per game: <b>${s.mpg}</b> (goal under 0.5)`,
  },
  {
    band: '1200 → 1400',
    title: 'Openings with a plan',
    items: ['One opening as White, one vs 1.e4 and 1.d4', 'Castle early, develop before attacking', 'Know the plan after move 10'],
    metric: s => `Opening mistakes per game: <b>${s.opg}</b> (goal near 0)`,
  },
  {
    band: '1400 → 1600',
    title: 'Calculate and convert',
    items: ['Calculate forcing lines 3 moves deep', 'Trade pieces when ahead', 'King and pawn endings, active rooks'],
    metric: s => `Accuracy: <b>${s.acc}</b> (goal 80+)`,
  },
];
function renderProgress() {
  const box = $('#view-progress');
  box.innerHTML = '';
  const recs = (App.library.length ? App.library : [App.exampleRec]).filter(r => r && r.stats);
  const isExample = !App.library.length;
  if (!recs.length) {
    box.append(
      el(
        'div',
        { class: 'panel span-12 empty-state' },
        el('h3', { text: 'Your progress shows up here' }),
        el('p', {
          text: 'Import a few of your games and let Stockfish grade them. This page then tracks your accuracy, where your mistakes happen, and which habits to build next.',
        }),
        el('button', { class: 'btn primary', onclick: () => openDialog('import'), text: 'Import games' }),
      ),
    );
    return;
  }
  const sorted = recs
    .slice()
    .sort((a, b) => (gameDate(a.headers) || '').localeCompare(gameDate(b.headers) || '') || (a.importedAt || 0) - (b.importedAt || 0));
  const n = sorted.length;
  const recent = sorted.slice(-10);
  const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
  const accs = recent.map(r => r.stats.acc).filter(x => x != null);
  const avgAcc = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null;
  const bpg = sum(recent, r => r.stats.counts.blunder) / recent.length;
  const mpg = sum(recent, r => r.stats.counts.miss) / recent.length;
  const mispg = sum(recent, r => r.stats.counts.mistake) / recent.length;
  const opg = sum(recent, r => r.stats.phases.opening) / recent.length;
  const latestElo = [...sorted]
    .reverse()
    .map(userElo)
    .find(x => x);
  const wins = sorted.filter(r => resultFor(r) === 'W').length,
    losses = sorted.filter(r => resultFor(r) === 'L').length,
    draws = sorted.filter(r => resultFor(r) === 'D').length;
  if (isExample)
    box.append(el('div', { class: 'span-12 example-flag', text: 'Showing the example game. Import your own games to track your real progress.' }));
  const tile = (label, value, sub) =>
    el(
      'div',
      { class: 'panel ptile' },
      el('span', { class: 'pl', text: label }),
      el('span', { class: 'pv', text: value }),
      el('span', { class: 'pg', text: sub }),
    );
  const tr = training();
  const solvedN = Object.values(tr.items).filter(x => x.ok).length;
  const st = streak();
  box.append(
    el(
      'div',
      { class: 'span-12 tiles' },
      tile('Games reviewed', String(n), `${wins} won · ${losses} lost · ${draws} drawn`),
      tile('Accuracy', avgAcc != null ? avgAcc.toFixed(1) : '…', `average of your last ${recent.length}`),
      tile('Blunders per game', bpg.toFixed(1), `mistakes per game ${mispg.toFixed(1)}`),
      tile('Missed chances', mpg.toFixed(1), 'per game: their error, not punished'),
      tile('Puzzle rating', String(puzzleRating()), `${solvedN} exercise${solvedN === 1 ? '' : 's'} solved`),
      tile('Training streak', `${st} day${st === 1 ? '' : 's'}`, `${todayDone()} of ${tr.goal} done today`),
    ),
  );
  // accuracy chart
  const chart = el(
    'div',
    { class: 'panel pcard span-8' },
    el('h3', { text: 'Accuracy by game' }),
    el('div', { class: 'sub', text: 'Oldest on the left. Dots are colored by result.' }),
  );
  const W = 640,
    H = 210,
    L = 34,
    R = 10,
    T = 12,
    B = 26;
  const iw = W - L - R,
    ih = H - T - B;
  const xs = i => L + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const ys = v => T + ih - ((v - 40) / 60) * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Accuracy by game">`;
  for (const v of [40, 60, 80, 100])
    svg += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--rule)" stroke-width="1"/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end">${v}</text>`;
  const pts = sorted.map((r, i) => (r.stats.acc != null ? [xs(i), ys(clamp(r.stats.acc, 40, 100)), r] : null)).filter(Boolean);
  if (pts.length > 1) {
    svg += `<path d="M${pts[0][0]},${H - B} ${pts.map(p => `L${p[0]},${p[1]}`).join(' ')} L${pts[pts.length - 1][0]},${H - B} Z" fill="var(--accent-soft)"/>`;
    svg += `<polyline points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  }
  pts.forEach(p => {
    const res = resultFor(p[2]);
    svg += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${res === 'W' ? 'var(--c-best)' : res === 'L' ? 'var(--c-blunder)' : 'var(--ink-3)'}" stroke="var(--sheet)" stroke-width="2"><title>${esc(gameTitle(p[2]))}: ${p[2].stats.acc.toFixed(1)}</title></circle>`;
  });
  if (n > 1) {
    svg += `<text x="${L}" y="${H - 8}">${esc(fmtDate(gameDate(sorted[0].headers)) || 'first')}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${esc(fmtDate(gameDate(sorted[n - 1].headers)) || 'latest')}</text>`;
  }
  svg += '</svg>';
  chart.append(
    el('div', { class: 'chart', html: svg }),
    el(
      'div',
      { class: 'legend' },
      el('span', {}, el('i', { style: 'background:var(--c-best)' }), 'Win'),
      el('span', {}, el('i', { style: 'background:var(--c-blunder)' }), 'Loss'),
      el('span', {}, el('i', { style: 'background:var(--ink-3)' }), 'Draw'),
    ),
  );
  box.append(chart);
  // where mistakes happen
  const ph = { opening: 0, middlegame: 0, endgame: 0 };
  for (const r of sorted) for (const kx in ph) ph[kx] += r.stats.phases[kx] || 0;
  const tg = { hung: 0, tactic: 0, missed: 0, time: 0, rushed: 0 };
  for (const r of sorted) for (const kx in tg) tg[kx] += (r.stats.tags && r.stats.tags[kx]) || 0;
  const maxPh = Math.max(1, ...Object.values(ph)),
    maxTg = Math.max(1, ...Object.values(tg));
  const bar = (label, v, max, color) =>
    el(
      'div',
      { class: 'bar-row' },
      el('span', { text: label }),
      el('span', { class: 'track' }, el('i', { style: `width:${((v / max) * 100).toFixed(1)}%;background:${color}` })),
      el('span', { class: 'v', text: String(v) }),
    );
  box.append(
    el(
      'div',
      { class: 'panel pcard span-4' },
      el('h3', { text: 'Where your mistakes happen' }),
      el('div', { class: 'sub', text: 'Mistakes, blunders and misses, all games' }),
      el(
        'div',
        { class: 'bars' },
        bar('Opening', ph.opening, maxPh, 'var(--c-inaccuracy)'),
        bar('Middlegame', ph.middlegame, maxPh, 'var(--c-mistake)'),
        bar('Endgame', ph.endgame, maxPh, 'var(--c-blunder)'),
      ),
      el('h3', { text: 'Patterns', style: 'margin-top:6px' }),
      el(
        'div',
        { class: 'bars' },
        bar('Left a piece loose', tg.hung, maxTg, 'var(--c-blunder)'),
        bar('Missed a tactic', tg.tactic, maxTg, 'var(--c-mistake)'),
        bar('Didn’t punish an error', tg.missed, maxTg, 'var(--c-miss)'),
        bar('Low on time', tg.time, maxTg, 'var(--c-inaccuracy)'),
        bar('Moved in under 3s', tg.rushed, maxTg, 'var(--ink-3)'),
      ),
    ),
  );
  // roadmap
  const stageIdx = latestElo ? clamp(Math.floor((latestElo - 800) / 200), 0, 3) : 0;
  const s = { bpg: bpg.toFixed(1), mpg: mpg.toFixed(1), opg: opg.toFixed(1), acc: avgAcc != null ? avgAcc.toFixed(1) : '…' };
  box.append(
    el(
      'div',
      { class: 'panel pcard span-12' },
      el('h3', { text: 'The road to 1600' }),
      el('div', {
        class: 'sub',
        text: latestElo
          ? `Your latest rating in these games: ${latestElo}. Each stage lists the skills that matter most there, with your current number.`
          : 'Each stage lists the skills that matter most there, with your current number.',
      }),
      el(
        'div',
        { class: 'roadmap' },
        ...ROADMAP.map((st, i) =>
          el(
            'div',
            { class: 'stage' + (i === stageIdx ? ' now' : '') },
            el('span', { class: 'band', text: st.band + (i === stageIdx ? ' · you are here' : '') }),
            el('span', { class: 'st', text: st.title }),
            el('ul', {}, ...st.items.map(t => el('li', { text: t }))),
            el('span', { class: 'metric', html: st.metric(s) }),
          ),
        ),
      ),
    ),
  );
  // training by theme
  const ts = themeStats();
  const tcounts = {};
  for (const p of PUZZLES) tcounts[p.t] = (tcounts[p.t] || 0) + 1;
  const trows = Object.entries(THEMES)
    .filter(([k2]) => ts[k2] || tcounts[k2] || k2 === 'mine')
    .map(([k2, th]) => {
      const x = ts[k2] || { seen: 0, first: 0 };
      const pct = x.seen ? (x.first / x.seen) * 100 : 0;
      return el(
        'div',
        { class: 'bar-row' },
        el('span', { text: th.name }),
        el(
          'span',
          { class: 'track' },
          el('i', {
            style: `width:${pct.toFixed(1)}%;background:${pct >= 70 ? 'var(--c-best)' : pct >= 45 ? 'var(--c-inaccuracy)' : 'var(--c-mistake)'}`,
          }),
        ),
        el('span', { class: 'v', text: x.seen ? `${Math.round(pct)}%` : '…' }),
      );
    });
  const lessonsDone = LESSONS.filter(x => tr.items[x.id] && tr.items[x.id].ok).length;
  box.append(
    el(
      'div',
      { class: 'panel pcard span-12' },
      el('h3', { text: 'Training by theme' }),
      el('div', { class: 'sub', text: `First-try success rate in the Train tab. Lessons finished: ${lessonsDone} of ${LESSONS.length}.` }),
      el('div', { class: 'bars two-col' }, ...trows),
      el(
        'div',
        { class: 'card-actions' },
        el('button', {
          class: 'btn',
          onclick: () => {
            switchTab('drills');
            switchTrainMode('themes');
          },
          text: 'Practice a theme',
        }),
      ),
    ),
  );
  // training plan
  const plan = el('div', { class: 'panel pcard span-12' }, el('h3', { text: 'Your training plan' }));
  const P = App.profile.plan;
  if (App.planBusy) plan.append(thinkingEl('The coach is reading all of your games…', () => App.planBusy.abort()));
  else if (P) {
    plan.append(
      el('p', { class: 'prose', style: 'margin:0', text: P.summary }),
      el(
        'ol',
        { class: 'plan-list' },
        ...P.priorities.map((x, i) =>
          el(
            'li',
            {},
            el('span', { class: 'pn', text: String(i + 1) }),
            el('span', { class: 'pt', text: x.title }),
            el('span', { class: 'pd', text: x.why }),
            el('span', { class: 'pp' }, el('b', { text: 'Practice: ' }), x.practice),
          ),
        ),
      ),
    );
    if (P.routine && P.routine.length)
      plan.append(
        el(
          'div',
          {},
          el('h4', { class: 'checklist-h', text: 'Weekly routine' }),
          el('ul', { class: 'prose', style: 'margin:0;font-size:15px' }, ...P.routine.map(r => el('li', { text: r }))),
        ),
      );
    plan.append(el('span', { class: 'note', text: `Based on ${P.games} game${P.games === 1 ? '' : 's'} · ${new Date(P.at).toLocaleDateString()}` }));
  } else
    plan.append(
      el('p', {
        class: 'note',
        style: 'margin:0',
        text: 'The coach looks at the patterns across all of your reviewed games and writes a focused plan for the next few weeks.',
      }),
    );
  if (App.planError) plan.append(el('p', { class: 'note warn', text: sampleErrorText(App.planError) }));
  if (App.sample && !App.sampleOff && !App.planBusy)
    plan.append(
      el(
        'div',
        { class: 'card-actions' },
        el('button', { class: 'btn primary', onclick: () => writePlan(sorted), text: P ? 'Update my plan' : 'Write my plan' }),
      ),
    );
  box.append(plan);
  // games table
  const tbl = el(
    'table',
    { class: 'games' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        ...['Date', 'Opponent', 'Result', 'Accuracy', '??', '?', '×', 'Opening'].map((t, i) =>
          el('th', { text: t, style: i >= 3 && i <= 6 ? 'text-align:right' : null }),
        ),
      ),
    ),
  );
  const tb = el('tbody');
  [...sorted].reverse().forEach(r =>
    tb.append(
      el(
        'tr',
        {
          class: 'click',
          onclick: () => {
            switchTab('review');
            openGame(r.id);
          },
        },
        el('td', { text: fmtDate(gameDate(r.headers)) || '…' }),
        el('td', { text: `${opponentOf(r)}${opponentElo(r) ? ` (${opponentElo(r)})` : ''}` }),
        el('td', {}, el('span', { class: 'res ' + resultFor(r), text: resultFor(r) || '?' })),
        el('td', { class: 'num', text: r.stats.acc != null ? r.stats.acc.toFixed(1) : '…' }),
        el('td', { class: 'num', text: String(r.stats.counts.blunder) }),
        el('td', { class: 'num', text: String(r.stats.counts.mistake) }),
        el('td', { class: 'num', text: String(r.stats.counts.miss) }),
        el('td', { text: openingName(r.headers) || '' }),
      ),
    ),
  );
  tbl.append(tb);
  box.append(el('div', { class: 'panel pcard span-12' }, el('h3', { text: 'Reviewed games' }), el('div', { class: 'table-wrap' }, tbl)));
}
async function writePlan(sorted) {
  const lines = sorted.slice(-15).map(r => {
    const s = r.stats;
    return `- ${fmtDate(gameDate(r.headers)) || 'undated'} vs ${opponentOf(r)} (${resultFor(r) || '?'}), played ${colorName(r.userColor)}, accuracy ${s.acc != null ? s.acc.toFixed(0) : '?'}, blunders ${s.counts.blunder}, mistakes ${s.counts.mistake}, missed chances ${s.counts.miss}, opening ${openingName(r.headers) || 'unknown'}; errors by phase opening ${s.phases.opening} / middlegame ${s.phases.middlegame} / endgame ${s.phases.endgame}; patterns: left pieces loose ${s.tags.hung}, missed tactics ${s.tags.tactic}, unpunished opponent errors ${s.tags.missed}, low on time ${s.tags.time}, moved in under 3 seconds ${s.tags.rushed}.`;
  });
  const elo = [...sorted]
    .reverse()
    .map(userElo)
    .find(x => x);
  const prompt = `${PERSONA}

The student wants to climb from about ${elo || 800} to 1600. Here are their recently reviewed games with engine statistics:
${lines.join('\n')}
Puzzle training so far: puzzle rating ${puzzleRating()}, ${Object.keys(training().items).length} exercises attempted, current streak ${streak()} days. First-try success by theme: ${
    Object.entries(themeStats())
      .map(([k, x]) => `${(THEMES[k] || { name: k }).name} ${x.first}/${x.seen}`)
      .join(', ') || 'none yet'
  }.
The app has these training tools you can point to: a daily Train session (spaced review of their own mistakes plus puzzles near their rating), puzzles by theme (${Object.values(
    THEMES,
  )
    .filter(t => t.stage)
    .map(t => t.name.toLowerCase())
    .join(', ')}), lessons (classic mates, opening traps, endgame play-outs against Stockfish), and a Guess my moves mode for replaying their games.

Write a training plan focused on the 3 changes that will gain them the most rating points, based on the evidence above. Reply with ONLY a JSON object:
{"summary": "2 to 3 sentences on where their points are leaking", "priorities": [{"title": "short name", "why": "the evidence from their games", "practice": "a concrete practice routine, with amounts (for example 15 minutes of fork puzzles a day)"}], "routine": ["3 to 5 short weekly-routine items"]}`;
  const ctl = (App.planBusy = new AbortController());
  App.planError = null;
  renderProgress();
  try {
    const data = await App.sample.json(prompt, { signal: ctl.signal, modelTier: 'default', cache: false });
    App.consented = true;
    App.profile.plan = {
      summary: noDash(data.summary || ''),
      priorities: (data.priorities || [])
        .slice(0, 4)
        .map(p => ({ title: noDash(p.title || ''), why: noDash(p.why || ''), practice: noDash(p.practice || '') })),
      routine: (data.routine || []).slice(0, 6).map(noDash),
      games: sorted.length,
      at: Date.now(),
    };
    if (App.library.length) saveProfile();
  } catch (e) {
    if (e && OFF_CODES.has(e.code)) App.sampleOff = e.code;
    App.planError = e && e.code !== 'cancelled' ? e : null;
  }
  App.planBusy = null;
  if (App.tab === 'progress') renderProgress();
}
