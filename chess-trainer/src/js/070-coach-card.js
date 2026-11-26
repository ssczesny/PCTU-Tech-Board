/* ================= coach card ================= */
/* Explanations are Claude calls on the viewer's own usage, so a call that has started is never thrown away:
   - it runs to the end and is saved even if the student has stepped on (it is there when they come back);
   - at most MAX_COACH_CALLS run at once; while both are busy, automatic explanations simply wait, and the
     move the student is on when a call finishes gets the next one;
   - a click on Explain always goes through.
   Only the Stop button, or a click that needs a slot, ends a call early. */
const MAX_COACH_CALLS = 2;
const AUTO_DWELL_MS = 700;
let autoTimer = null;
const runningJobs = () => App.jobs.filter(j => j.status === 'running');
function jobFor(g, k) {
  for (let i = App.jobs.length - 1; i >= 0; i--) if (App.jobs[i].g === g && App.jobs[i].k === k) return App.jobs[i];
  return null;
}
function autoAllowed(g, k) {
  return !!(
    g &&
    k >= 1 &&
    !App.view.explore &&
    App.tab === 'review' &&
    App.sample &&
    !App.sampleOff &&
    App.consented &&
    App.profile.settings.autoCoach &&
    !g.explanations[k] &&
    !(g.autoOff && g.autoOff.has(k)) &&
    performance.now() >= App.autoPausedUntil
  );
}
function scheduleAutoExplain() {
  clearTimeout(autoTimer);
  const g = App.game,
    k = App.view.ply;
  if (!autoAllowed(g, k)) return;
  autoTimer = setTimeout(() => {
    if (App.game === g && App.view.ply === k && autoAllowed(g, k)) explainMove(k, { auto: true });
  }, AUTO_DWELL_MS);
}
async function explainMove(k, { force = false, auto = false } = {}) {
  const g = App.game;
  if (!g || k < 1) return;
  if (!App.sample || App.sampleOff) {
    renderCoachBody();
    return;
  }
  const cur = jobFor(g, k);
  if (cur && cur.status === 'running') return;
  if (!force && g.explanations[k]) {
    renderCoachBody();
    return;
  }
  const busy = runningJobs();
  if (busy.length >= MAX_COACH_CALLS) {
    if (auto) return; // when a call finishes, the move on screen then is offered again
    (busy.find(j => j.auto && !j.text) || busy.find(j => j.auto) || busy[0]).ctl.abort();
  }
  const job = { g, k, ctl: new AbortController(), text: '', status: 'running', phase: 'engine', auto };
  App.jobs = App.jobs.filter(j => j.status === 'running' || !(j.g === g && j.k === k)).slice(-8);
  App.jobs.push(job);
  paintJob(job, true);
  await Promise.all([Analyzer.want(k - 1), Analyzer.want(k)]);
  if (job.ctl.signal.aborted) {
    job.status = 'cancelled';
    if (job.stopped) noAuto(g, k);
    paintJob(job, true);
    scheduleAutoExplain();
    return;
  }
  job.phase = 'coach';
  paintJob(job);
  const kind = g.cls[k] ? g.cls[k].kind : null;
  const opts = {
    signal: job.ctl.signal,
    modelTier: coachTier(kind),
    onText: ({ text }) => {
      job.text = text;
      paintJob(job);
    },
  };
  if (force) opts.cache = false;
  try {
    const res = await App.sample(explainPrompt(g, k), opts);
    App.consented = true;
    job.text = res.text;
    job.status = 'done';
    job.truncated = res.truncated;
    g.explanations[k] = { t: noDash(res.text), at: Date.now() };
    saveGame(g, { explanations: { [k]: g.explanations[k] } });
  } catch (e) {
    job.status = e && e.code === 'cancelled' ? 'cancelled' : 'error';
    job.error = e;
    if (e && OFF_CODES.has(e.code)) App.sampleOff = e.code;
    // A call that failed, or that the student stopped, is never repeated on its own for that move: only a
    // click asks again. After any failure automatic explanations also pause everywhere for a while (two
    // minutes after a usage limit), so stepping on does not send one doomed call per move.
    if (job.status === 'error') {
      noAuto(g, k);
      App.autoPausedUntil = performance.now() + (e && e.code === 'rate_limited' ? 120000 : 45000);
    } else if (job.stopped) noAuto(g, k);
    job.text = e && e.text && e.code !== 'refused' ? e.text : '';
  }
  paintJob(job, true);
  scheduleAutoExplain();
}
function noAuto(g, k) {
  (g.autoOff || (g.autoOff = new Set())).add(k);
}
function stopJob(job) {
  job.stopped = true;
  job.ctl.abort();
}
/* Paint a running explanation into the card, but only if the card is showing that move right now. */
function paintJob(job, full) {
  const v = App.view;
  if (App.game !== job.g || v.ply !== job.k || v.explore || App.tab !== 'review') return;
  if (Nav.dirty) return; // the card body is about to be rebuilt anyway
  const box = $('#coach-text');
  if (!box || full) {
    renderCoachBody();
    return;
  }
  if (job.text) {
    box.innerHTML = md(job.text);
    linkMoves(box, moveBases(job.g, job.k), { figs: false });
  } else
    box.replaceChildren(thinkingEl(job.phase === 'engine' ? 'Waiting for the engine…' : 'The coach is looking at the position…', () => stopJob(job)));
}
function thinkingEl(text, onStop) {
  return el(
    'div',
    { class: 'thinking' },
    el('span', { class: 'spinner' }),
    el('span', { text }),
    onStop ? el('button', { class: 'btn small quiet', onclick: onStop, text: 'Stop' }) : null,
  );
}
/* Positions the notation in an explanation of move k can refer to: after the move first, then before it. */
function moveBases(g, k) {
  // Written without a move number, the move being explained and the engine's pick are the mover's moves,
  // even when the other side could play the same notation next.
  const bare = s => s.replace(/[+#]/g, '');
  const own = new Set([bare(g.plies[k - 1].san)]);
  const a = g.pos[k - 1];
  if (a && a.b) {
    const best = lineSteps(g.fens[k - 1], a.p || a.b, 1)[0];
    if (best) own.add(bare(best.san));
  }
  return [
    { fen: g.fens[k], ply: k, pre: [] },
    { fen: g.fens[k - 1], ply: k - 1, pre: [], own },
  ];
}

/* Board pictures for move k. Compact = one row (played, best reply, better). Otherwise the engine's lines
   are laid out move by move: what happened in the game, and what was better. */
function moveFigs(g, k, compact) {
  const cacheKey = [k, App.view.orient, compact ? 1 : 0, g.ver || 0].join('|');
  if (!g.figCache) g.figCache = new Map();
  const hit = g.figCache.get(cacheKey);
  if (hit) return hit;
  const orient = App.view.orient;
  const p = g.plies[k - 1],
    c = g.cls[k],
    a = g.pos[k - 1],
    b = g.pos[k];
  const kind = c ? c.kind : null;
  const mine = p.color === g.userColor;
  const before = { fen: g.fens[k - 1], ply: k - 1, pre: [] },
    after = { fen: g.fens[k], ply: k, pre: [] };
  const played = lineFigs(before, [{ san: p.san, from: p.from, to: p.to, fen: g.fens[k] }], {
    orient,
    tone: moveToneOf(c),
    firstTag: mine ? 'You played' : 'They played',
    firstGlyph: kind && (BAD.has(kind) || kind === 'best') ? kind : null,
    firstBadge: kind && BAD.has(kind) ? kind : null,
  });
  const bad = kind && BAD.has(kind);
  const reply =
    b && b.p
      ? lineFigs(after, lineSteps(g.fens[k], b.p, compact ? 1 : 3), {
          orient,
          max: compact ? 1 : 3,
          tone: bad ? 'threat' : 'line',
          firstTag: 'Best reply',
        })
      : [];
  const better =
    kind && kind !== 'best' && a && a.b
      ? lineFigs(before, lineSteps(g.fens[k - 1], a.p || a.b, compact ? 1 : 4), {
          orient,
          max: compact ? 1 : 4,
          tone: 'best',
          firstTag: bad ? 'Better' : 'Engine’s pick',
          firstTone: 'best',
        })
      : [];
  const seen = new Set(played.concat(reply.slice(0, 1), better.slice(0, 1)).map(f => f.key));
  const html = compact ? figsHTML(played.concat(reply, better)) : figsHTML(played.concat(reply)) + figsHTML(better);
  const out = { html, seen };
  g.figCache.set(cacheKey, out);
  return out;
}
/* Explanation text with its notation linked and a strip of boards under each paragraph that walks a line. */
function explanationHTML(g, k, text, seen) {
  const exp = g.explanations[k];
  const key = [App.view.orient, g.ver || 0].join('|');
  if (exp && exp.t === text && exp._html && exp._key === key) return exp._html;
  const tmp = document.createElement('div');
  tmp.innerHTML = md(text);
  linkMoves(tmp, moveBases(g, k), { figs: true, orient: App.view.orient, seen: new Set(seen), maxFigs: 10 });
  const html = tmp.innerHTML;
  if (exp && exp.t === text) {
    // Cached on the object but kept out of saved data (see saveGame: keys starting with "_" are dropped).
    Object.defineProperty(exp, '_html', { value: html, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(exp, '_key', { value: key, writable: true, configurable: true, enumerable: false });
  }
  return html;
}

function ensureCard() {
  const card = $('#coach-card');
  if (!card.firstElementChild || card.firstElementChild.id !== 'cc-head')
    card.replaceChildren(el('div', { id: 'cc-head' }), el('div', { id: 'cc-body' }));
  return card;
}
/* The card's title line. Runs with the board, inside the key handler, so it stays tiny. */
function coachHead() {
  const g = App.game,
    v = App.view;
  if (!g) return;
  ensureCard();
  const head = $('#cc-head');
  const kids = [];
  if (g.example) kids.push(el('div', { class: 'example-flag', text: 'Example game · import your own to replace it' }));
  if (v.explore) {
    const base = v.explore.basePly;
    kids.push(
      el(
        'div',
        { class: 'move-head' },
        el('span', { class: 'move-title', text: 'Your side line' }),
        el('span', { class: 'who', text: `from ${base === 0 ? 'the start' : 'after ' + moveText(g.fens[base - 1], g.plies[base - 1].san)}` }),
      ),
    );
  } else if (v.ply === 0) {
    kids.push(el('div', { class: 'move-head' }, el('span', { class: 'move-title', text: 'Before the first move' })));
  } else {
    const k = v.ply,
      p = g.plies[k - 1],
      c = g.cls[k];
    const mine = p.color === g.userColor;
    kids.push(
      el(
        'div',
        { class: 'move-head' },
        el(
          'span',
          { class: 'move-title' },
          moveText(g.fens[k - 1], p.san),
          c && c.kind !== 'good' && c.kind !== 'excellent' ? el('span', { class: 'glyph k-' + c.kind, text: KINDS[c.kind].glyph }) : null,
        ),
        c ? el('span', { class: 'chip k-' + c.kind, text: KINDS[c.kind].label }) : el('span', { class: 'chip', text: 'Grading…' }),
        el('span', { class: 'who' + (mine ? ' me' : ''), text: mine ? 'Your move' : 'Opponent’s move' }),
      ),
    );
  }
  head.replaceChildren(...kids);
}
function renderCoach() {
  coachHead();
  renderCoachBody();
}
function renderCoachBody() {
  const g = App.game,
    v = App.view;
  if (!g) return;
  ensureCard();
  const body = $('#cc-body');
  body.classList.remove('stale');
  const kids = [];
  if (v.explore) {
    body.replaceChildren(...exploreCardKids());
    return;
  }
  const k = v.ply;
  const gp = guessPromptEl();
  if (gp) kids.push(gp);
  if (k === 0) {
    kids.push(
      el('p', {
        class: 'prose',
        style: 'margin:0',
        text: `${introLine(g)} Step through with the arrow keys or the buttons under the board. For every move the coach explains what it does, why it works or fails, and what was better, with small boards for each line. Ask follow-up questions in the chat, or drag pieces to try your own ideas.`,
      }),
      el(
        'div',
        { class: 'card-actions' },
        el('button', {
          class: 'btn primary',
          onclick: () => {
            go(1);
            explainMove(1);
          },
          text: 'Start the walk-through',
        }),
        firstSerious(g)
          ? el('button', {
              class: 'btn',
              onclick: () => {
                const j = firstSerious(g);
                go(j);
                explainMove(j);
              },
              text: 'Jump to my first mistake',
            })
          : null,
      ),
    );
    body.replaceChildren(...kids);
    return;
  }
  const p = g.plies[k - 1],
    c = g.cls[k],
    a = g.pos[k - 1],
    b = g.pos[k];
  const mine = p.color === g.userColor;
  const gr = guessResultEl(k);
  if (gr) kids.push(gr);
  const facts = el('div', { class: 'facts' });
  if (a && b) facts.append(el('span', {}, 'Eval ', el('span', { class: 'mono', text: `${fmtEval(a)} → ${fmtEval(playedPos(a, b))}` })));
  if (c) {
    const uc = g.userColor;
    const wb = winPct(povCp(a.c, uc)),
      wa = winPct(povCp(playedPos(a, b).c, uc));
    facts.append(el('span', {}, 'Your winning chances ', el('span', { class: 'mono', text: `${wb.toFixed(0)}% → ${wa.toFixed(0)}%` })));
  }
  const sp = clockSpent(g, k);
  if (sp != null) facts.append(el('span', {}, 'Time used ', el('span', { class: 'mono', text: fmtSpent(sp) })));
  if (facts.childNodes.length) kids.push(facts);

  const job = jobFor(g, k);
  const saved = g.explanations[k];
  const running = job && job.status === 'running';
  // With coach text on screen the engine lines shrink to one row; the text carries its own boards.
  const figs = moveFigs(g, k, !!(saved || (running && job.text)));
  kids.push(el('div', { class: 'cc-figs', html: figs.html }));

  const verdict = c && BAD.has(c.kind) ? engineVerdict(g, k) : '';
  if (verdict) kids.push(el('div', { class: 'verdict', text: verdict }));

  const text = el('div', { class: 'prose', id: 'coach-text' });
  const actions = el('div', { class: 'card-actions' });
  if (running) {
    if (job.text) {
      text.innerHTML = md(job.text);
      linkMoves(text, moveBases(g, k), { figs: false });
    } else text.append(thinkingEl(job.phase === 'engine' ? 'Waiting for the engine…' : 'The coach is looking at the position…', () => stopJob(job)));
  } else if (saved) {
    text.innerHTML = explanationHTML(g, k, saved.t, figs.seen);
    if (job && job.status === 'error') text.append(el('p', { class: 'note warn', text: sampleErrorText(job.error) }));
    actions.append(el('button', { class: 'btn small', onclick: () => explainMove(k, { force: true }), text: 'Explain again' }));
  } else if (!App.sample || App.sampleOff) {
    text.append(
      el('p', {
        class: 'note',
        text: App.sampleOff
          ? sampleErrorText({ code: App.sampleOff })
          : App.sampleReady
            ? 'Claude coaching isn’t available in this view. The engine grades, boards and arrows still work.'
            : 'Connecting to the coach…',
      }),
    );
  } else {
    if (job && job.status === 'error') {
      if (job.text) text.innerHTML = md(job.text);
      text.append(el('p', { class: 'note warn', text: sampleErrorText(job.error) }));
    }
    actions.append(
      el('button', {
        class: 'btn primary',
        onclick: () => explainMove(k),
        text: mine && c && BAD.has(c.kind) ? 'Explain my mistake' : 'Explain this move',
      }),
    );
  }
  if (job && job.status === 'done' && job.truncated) text.append(el('p', { class: 'note', text: 'The explanation was cut short.' }));
  kids.push(text);
  if (App.sample && !App.sampleOff) {
    actions.append(
      el(
        'label',
        { class: 'switch' },
        el('input', {
          type: 'checkbox',
          id: 'auto-coach',
          checked: App.profile.settings.autoCoach,
          onchange: e => {
            App.profile.settings.autoCoach = e.target.checked;
            saveProfile();
            e.target.blur();
            if (e.target.checked) scheduleAutoExplain();
          },
        }),
        'Explain each move as I step',
      ),
    );
  }
  if (actions.childNodes.length) kids.push(actions);
  body.replaceChildren(...kids);
}
function firstSerious(g) {
  for (let k = 1; k <= g.plies.length; k++) if (g.plies[k - 1].color === g.userColor && g.cls[k] && SERIOUS.has(g.cls[k].kind)) return k;
  return 0;
}
function exploreCardKids() {
  const g = App.game,
    ex = App.view.explore;
  const base = ex.basePly;
  const tip = ex.fens[ex.fens.length - 1];
  const pos = ex.evals[ex.evals.length - 1];
  const sans = ex.moves.map(m => m.san);
  const kids = [el('div', { class: 'better' }, el('span', { class: 'line', style: 'flex-basis:auto', text: lineText(ex.fens[0], sans) }))];
  const f = el('div', { class: 'facts' });
  f.append(el('span', {}, 'Engine ', el('span', { class: 'mono', text: pos ? fmtEval(pos) : 'thinking…' })));
  if (g.pos[base + 1] && base < g.plies.length)
    f.append(el('span', {}, 'Game move gave ', el('span', { class: 'mono', text: fmtEval(g.pos[base + 1]) })));
  kids.push(f);
  if (pos && pos.b) {
    const steps = lineSteps(tip, pos.p || pos.b, 4);
    if (steps.length)
      kids.push(
        el('div', {
          class: 'cc-figs',
          html: `<div class="figblock"><span class="fl">Engine’s best continuation</span>${figsHTML(
            lineFigs({ fen: tip, ply: base, pre: sans }, steps, { orient: App.view.orient, max: 4, tone: 'best' }),
          )}</div>`,
        }),
      );
  }
  if (pos) kids.push(el('p', { class: 'note', text: `Position: ${evalWords(pos)}. Drag pieces to keep exploring, press ← to take a move back.` }));
  const first = ex.moves[0];
  kids.push(
    el(
      'div',
      { class: 'card-actions' },
      App.sample && !App.sampleOff
        ? el('button', {
            class: 'btn primary',
            onclick: () =>
              askChat(
                base < g.plies.length
                  ? `Why is ${first.san} better or worse than ${g.plies[base].san}, which I played in the game?`
                  : `What do you think of ${first.san} here?`,
              ),
            text: 'Ask the coach about this line',
          })
        : null,
      el('button', { class: 'btn', onclick: () => go(base), text: 'Back to the game' }),
    ),
  );
  return kids;
}
