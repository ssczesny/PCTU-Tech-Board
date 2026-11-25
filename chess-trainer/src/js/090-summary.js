/* ================= summary ================= */
async function writeSummary(force) {
  const g = App.game;
  if (!g || !App.sample || App.sampleOff) return;
  if (!g.pos.every(Boolean)) {
    toast('The summary needs the full engine analysis. It will be ready in a moment.');
    return;
  }
  computeCls(g);
  const ua = accuracyOf(g, g.userColor),
    oa = accuracyOf(g, other(g.userColor));
  const st = computeStats(g);
  const prompt = `${PERSONA}

Write a post-game review for the student.
GAME: ${gameContext(g)}
Student accuracy ${ua != null ? ua.toFixed(1) : '?'}%, opponent ${oa != null ? oa.toFixed(1) : '?'}%. Student errors: ${st.counts.blunder} blunders, ${st.counts.mistake} mistakes, ${st.counts.miss} missed chances, ${st.counts.inaccuracy} inaccuracies.
EVERY MOVE WITH ENGINE GRADES (ply numbers are used for keyMoments):
${annotatedMoves(g)}

Reply with ONLY a JSON object of this shape:
{"headline": "one-sentence verdict on the game, at most 16 words",
 "story": "3 to 5 sentences: how the opening went, the turning point, how it ended",
 "keyMoments": [{"ply": 27, "title": "at most 6 words", "lesson": "1 to 2 sentences"}],
 "strengths": ["one or two things the student did well"],
 "focus": [{"title": "skill to work on", "why": "evidence from this game", "drill": "a concrete practice task for this week"}]}
Use 2 to 4 keyMoments (the biggest swings or most instructive moves, using the ply numbers above) and 2 to 3 focus items. Only cite tactics that the grades and best moves above support.`;
  App.summaryBusy = { g, ctl: new AbortController() };
  renderSummary();
  try {
    const opts = { signal: App.summaryBusy.ctl.signal, modelTier: 'default' };
    if (force) opts.cache = false;
    const data = await App.sample.json(prompt, opts);
    App.consented = true;
    if (!data || typeof data !== 'object') throw { code: 'invalid_json' };
    g.summary = {
      headline: noDash(data.headline || ''),
      story: noDash(data.story || ''),
      keyMoments: (data.keyMoments || [])
        .slice(0, 5)
        .map(x => ({ ply: clamp(+x.ply || 1, 1, g.plies.length), title: noDash(x.title || ''), lesson: noDash(x.lesson || '') })),
      strengths: (data.strengths || []).slice(0, 3).map(noDash),
      focus: (data.focus || []).slice(0, 4).map(f => ({ title: noDash(f.title || ''), why: noDash(f.why || ''), drill: noDash(f.drill || '') })),
      at: Date.now(),
    };
    saveGame(g, { summary: g.summary });
    App.summaryBusy = null;
  } catch (e) {
    if (e && OFF_CODES.has(e.code)) App.sampleOff = e.code;
    App.summaryBusy = e && e.code === 'cancelled' ? null : { g, error: e };
  }
  if (App.game === g) renderSummary();
}
function renderSummary() {
  const g = App.game;
  const box = $('#summary');
  if (!g || $('#pane-summary').hidden) return;
  box.innerHTML = '';
  const done = g.pos.every(Boolean);
  const ua = accuracyOf(g, g.userColor),
    oa = accuracyOf(g, other(g.userColor));
  if (done) {
    const st = computeStats(g);
    const ost = { inaccuracy: 0, mistake: 0, blunder: 0, miss: 0 };
    for (let k = 1; k <= g.plies.length; k++)
      if (g.plies[k - 1].color !== g.userColor && g.cls[k] && ost[g.cls[k].kind] != null) ost[g.cls[k].kind]++;
    const col = (title, acc, cnt, swatch) =>
      el(
        'div',
        { class: 'stat-col' },
        el(
          'div',
          { class: 'sc-h' },
          el('span', {
            class: 'side-swatch ' + swatch,
            style: 'width:10px;height:10px;border-radius:3px;border:1px solid var(--ink-3);display:inline-block;background:var(--bar-' + swatch + ')',
          }),
          title,
        ),
        el('div', { class: 'sc-r' }, 'Accuracy', el('b', { text: acc != null ? acc.toFixed(1) : '…' })),
        ...[
          ['blunder', 'Blunders'],
          ['mistake', 'Mistakes'],
          ['miss', 'Missed chances'],
          ['inaccuracy', 'Inaccuracies'],
        ].map(([kd, lbl]) =>
          el(
            'div',
            { class: 'sc-r' },
            el('span', {}, el('span', { class: 'g k-' + kd, style: 'font-weight:700;margin-right:6px', text: KINDS[kd].glyph }), lbl),
            el('b', { text: String(cnt[kd]) }),
          ),
        ),
      );
    box.append(el('div', { class: 'stat-row' }, col('You', ua, st.counts, g.userColor), col('Opponent', oa, ost, other(g.userColor))));
  }
  const busy = App.summaryBusy && App.summaryBusy.g === g ? App.summaryBusy : null;
  if (g.summary) {
    const s = g.summary;
    box.append(el('h3', { text: s.headline }), el('p', { class: 'prose', style: 'margin:0', text: s.story }));
    if (s.keyMoments.length)
      box.append(
        el(
          'div',
          {},
          el('h4', { text: 'Key moments' }),
          el(
            'div',
            { class: 'kms' },
            ...s.keyMoments.map(km => {
              const c = g.cls[km.ply];
              return el(
                'button',
                {
                  class: 'km',
                  type: 'button',
                  onclick: () => {
                    go(km.ply);
                    switchPane('coach');
                  },
                },
                mbEl(g.fens[km.ply], {
                  orient: App.view.orient,
                  move: { from: g.plies[km.ply - 1].from, to: g.plies[km.ply - 1].to },
                  tone: moveToneOf(c),
                  badge: c && BAD.has(c.kind) ? { sq: g.plies[km.ply - 1].to, kind: c.kind } : null,
                }),
                el(
                  'span',
                  { class: 'kmv' },
                  moveText(g.fens[km.ply - 1], g.plies[km.ply - 1].san),
                  c ? el('span', { class: 'glyph k-' + c.kind, text: ' ' + KINDS[c.kind].glyph }) : null,
                ),
                el('span', { class: 'kt', text: km.title }),
                el('span', { class: 'kl', text: km.lesson }),
              );
            }),
          ),
        ),
      );
    if (s.strengths.length)
      box.append(
        el(
          'div',
          {},
          el('h4', { text: 'What went well' }),
          el('ul', { class: 'prose', style: 'margin:0;font-size:15px' }, ...s.strengths.map(x => el('li', { text: x }))),
        ),
      );
    if (s.focus.length)
      box.append(
        el(
          'div',
          {},
          el('h4', { text: 'Work on this week' }),
          el(
            'ul',
            { class: 'focus-list' },
            ...s.focus.map(f =>
              el(
                'li',
                {},
                el('div', { class: 'ft', text: f.title }),
                el('div', { class: 'fd', text: f.why }),
                el('div', { class: 'fx' }, el('b', { text: 'Drill: ' }), f.drill),
              ),
            ),
          ),
        ),
      );
    if (App.sample && !App.sampleOff)
      box.append(
        el('div', { class: 'card-actions' }, el('button', { class: 'btn small', onclick: () => writeSummary(true), text: 'Write it again' })),
      );
  } else if (busy && busy.ctl) {
    box.append(thinkingEl('The coach is reviewing the whole game. This can take up to a minute.', () => busy.ctl.abort()));
  } else {
    if (busy && busy.error)
      box.append(
        el('p', {
          class: 'note warn',
          text: busy.error.code === 'invalid_json' ? 'The summary came back in an unexpected format. Try again.' : sampleErrorText(busy.error),
        }),
      );
    box.append(
      el(
        'div',
        { class: 'empty-state', style: 'padding:6px 0' },
        el('h3', { text: 'Game summary' }),
        el('p', {
          text: 'The coach reads the whole game with the engine’s grades and writes the story of the game, the key turning points, and what to practice next.',
        }),
        App.sample && !App.sampleOff
          ? el('button', {
              class: 'btn primary',
              disabled: !done,
              onclick: () => writeSummary(false),
              text: done ? 'Write the summary' : 'Waiting for the engine analysis…',
            })
          : el('p', { class: 'note', text: 'Summaries need Claude, which isn’t available in this view.' }),
      ),
    );
  }
}
