/* ================= review: rendering ================= */
function posForView() {
  const g = App.game,
    v = App.view;
  if (v.explore) return v.explore.evals[v.explore.evals.length - 1];
  return g.pos[v.ply];
}
const winOf = p => (p.over ? (p.c > 0 ? 100 : p.c < 0 ? 0 : 50) : p.m != null ? (p.m > 0 ? 100 : 0) : winPct(p.c));

/* Beat 1 of a step: everything next to the board. Keep this cheap; it runs inside the key handler. */
function paintBoard(animate = true) {
  const g = App.game;
  if (!g) return;
  const v = App.view;
  board.setOrientation(v.orient);
  board.setPosition(curFen(), animate);
  board.setInteractive(true, () => destsOf(curFen()));
  renderDecor();
  renderEvalBar();
  renderPlayers();
  graphCursor();
  moveListCursor();
  renderExploreBanner();
  coachHead();
  const atStart = !v.explore && v.ply === 0,
    atEnd = !!v.explore || v.ply >= g.plies.length;
  $('#nav-prev').disabled = $('#nav-first').disabled = atStart;
  $('#nav-next').disabled = $('#nav-last').disabled = atEnd;
}
/* Full refresh of the Review tab, for everything that is not a plain step (new game, tab switch, flip). */
function updateReview() {
  if (!App.game) return;
  paintBoard(false);
  renderGraph();
  renderMoveList();
  renderToggles();
  Nav.seq++;
  flushPanels();
}
function renderDecor() {
  const g = App.game,
    v = App.view;
  const fen = curFen();
  const marks = [],
    arrows = [];
  let badge = null;
  const last = v.explore ? v.explore.moves[v.explore.moves.length - 1] : v.ply > 0 ? g.plies[v.ply - 1] : null;
  if (last) marks.push({ sq: last.from, kind: 'last' }, { sq: last.to, kind: 'last' });
  const ck = checkSquare(fen);
  if (ck) marks.push({ sq: ck, kind: 'check' });
  if (!v.explore && v.ply > 0) {
    const c = g.cls[v.ply];
    if (c) badge = { sq: g.plies[v.ply - 1].to, kind: c.kind };
    const a = g.pos[v.ply - 1];
    if (v.showBest && c && c.kind !== 'best' && a && a.b) arrows.push({ ...uciMove(a.b), color: 'var(--arrow-best)' });
  }
  const now = posForView();
  if (v.showThreat && now && now.b && !guessPending()) arrows.push({ ...uciMove(now.b), color: 'var(--arrow-threat)', opacity: 0.7 });
  if (v.showLoose) for (const col of ['w', 'b']) for (const l of loosePieces(fen, col)) marks.push({ sq: l.sq, kind: 'loose' });
  for (const a of App.coachArrows) arrows.push({ ...a, color: 'var(--arrow-coach)' });
  for (const s of App.coachSquares) marks.push({ sq: s, kind: 'coach' });
  if (App.hover) arrows.push({ ...App.hover, color: 'var(--arrow-hover)', opacity: 0.9 });
  board.setDecor({ marks, arrows, badge });
}
function renderToggles() {
  const v = App.view;
  $('#tog-best').setAttribute('aria-pressed', v.showBest);
  $('#tog-threat').setAttribute('aria-pressed', v.showThreat);
  $('#tog-loose').setAttribute('aria-pressed', v.showLoose);
  $('#tog-guess').setAttribute('aria-pressed', App.guess.on);
}
function renderEvalBar() {
  const pos = posForView();
  const bar = $('#evalbar');
  const fill = bar.firstElementChild,
    txt = bar.lastElementChild;
  const w = pos ? winOf(pos) : 50;
  bar.classList.toggle('flipped', App.view.orient === 'b');
  fill.style.height = w + '%';
  txt.textContent = pos ? fmtEval(pos).replace('+', '') : '';
  const whiteAhead = w >= 50;
  const atBottom = App.view.orient === 'w' ? whiteAhead : !whiteAhead;
  txt.className = 'etext ' + (atBottom ? 'at-bottom' : 'at-top');
  txt.style.color = whiteAhead ? 'var(--bar-b)' : 'var(--bar-w)';
}
/* Name strips above and below the board. Rebuilt only when something on them changes (clock, material). */
const Players = { key: '' };
function renderPlayers() {
  const g = App.game,
    v = App.view,
    h = g.headers;
  const mat = material(curFen());
  const k = v.explore ? v.explore.basePly : v.ply;
  const tc = timeControl(h);
  const info = color => ({
    color,
    name: color === 'w' ? h.White || 'White' : h.Black || 'Black',
    elo: color === 'w' ? h.WhiteElo : h.BlackElo,
    diff: color === 'w' ? mat.w - mat.b : mat.b - mat.w,
    clk: clockAt(g, k, color),
  });
  const top = info(v.orient === 'w' ? 'b' : 'w'),
    bottom = info(v.orient === 'w' ? 'w' : 'b');
  const key = [g.id, g.userColor, top.color, top.diff, top.clk, bottom.diff, bottom.clk].join('|');
  if (key === Players.key) return;
  Players.key = key;
  const strip = p =>
    [
      el('span', { class: 'side-swatch ' + p.color }),
      el('span', { class: 'pname', text: p.name }),
      p.elo && p.elo !== '?' ? el('span', { class: 'elo', text: p.elo }) : null,
      g.userColor === p.color ? el('span', { class: 'you', text: 'You' }) : null,
      p.diff > 0 ? el('span', { class: 'mat', text: '+' + p.diff }) : null,
      p.clk != null ? el('span', { class: 'clock' + (tc && p.clk < Math.min(30, tc.base * 0.1) ? ' low' : ''), text: fmtClock(p.clk) }) : null,
    ].filter(Boolean);
  $('#player-top').replaceChildren(...strip(top));
  $('#player-bottom').replaceChildren(...strip(bottom));
}
/* The eval graph is drawn when the analysis changes; stepping only moves the cursor line. */
const Graph = { cur: null };
function renderGraph() {
  const g = App.game;
  const box = $('#graph');
  const N = g.plies.length;
  const X = i => (N ? (i / N) * 100 : 0);
  const pts = [];
  for (let i = 0; i < g.pos.length; i++) {
    const p = g.pos[i];
    if (!p) break;
    pts.push([X(i), 100 - winOf(p)]);
  }
  let html = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="50" x2="100" y2="50" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" opacity=".6"/>`;
  if (pts.length > 1)
    html += `<path d="M0,100 ${pts.map(p => `L${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ')} L${pts[pts.length - 1][0].toFixed(2)},100 Z" fill="var(--graph-w)"/>`;
  html += '</svg>';
  for (let k = 1; k <= N; k++) {
    const c = g.cls[k];
    if (!c || !SERIOUS.has(c.kind) || !pts[k]) continue;
    html += `<span class="gdot" style="left:${pts[k][0]}%;top:${pts[k][1]}%;background:var(--c-${c.kind})"></span>`;
  }
  box.innerHTML = html + '<span class="gcur"></span>';
  Graph.cur = box.lastElementChild;
  graphCursor();
  const ua = accuracyOf(g, g.userColor),
    oa = accuracyOf(g, other(g.userColor));
  const done = g.pos.every(Boolean);
  $('#acc-line').innerHTML = ua != null && done ? `Accuracy: you <b>${ua.toFixed(1)}</b> · opponent <b>${oa != null ? oa.toFixed(1) : '…'}</b>` : '';
}
function graphCursor() {
  const g = App.game,
    v = App.view;
  if (!Graph.cur || !Graph.cur.isConnected) return;
  const N = g.plies.length;
  Graph.cur.style.left = (N ? ((v.explore ? v.explore.basePly : v.ply) / N) * 100 : 0) + '%';
}
function renderStatus() {
  const g = App.game;
  const box = $('#astatus');
  if (!g) return;
  if (Analyzer.error) {
    box.innerHTML = '';
    box.append(
      el('span', {
        class: 'note warn',
        text: 'The engine couldn’t start in this view, so moves aren’t graded. The coach can still explain moves without engine numbers.',
      }),
    );
    return;
  }
  const n = g.pos.filter(Boolean).length,
    N = g.pos.length;
  if (n >= N) {
    const left = App.library.filter(r => !(r.analysis && r.analysis.complete) && !r.broken && r.id !== g.id).length;
    box.textContent = `Stockfish analysis complete · ${LEVELS[g.rec.analysis?.level || App.profile.settings.strength]?.label || 'Standard'} depth${left ? ` · grading ${left} more game${left === 1 ? '' : 's'} in the background` : ''}`;
    return;
  }
  box.innerHTML = '';
  box.append(
    el('span', { class: 'spinner' }),
    el('span', { text: `Stockfish is grading the game · ${n} of ${N} positions` }),
    el('span', { class: 'pbar' }, el('i', { style: `width:${((n / N) * 100).toFixed(1)}%` })),
  );
}

/* The Moves pane: a scoresheet, or one small board per move. Built once per game/analysis state; stepping
   only moves the highlight. */
const MoveList = { cells: [], cur: 0, key: '', io: null };
function moveCaptionHTML(g, k) {
  const c = g.cls[k];
  return (
    esc(moveText(g.fens[k - 1], g.plies[k - 1].san)) + (c && BAD.has(c.kind) ? `<span class="g k-${c.kind}">${esc(KINDS[c.kind].glyph)}</span>` : '')
  );
}
function moveToneOf(c) {
  return !c ? 'line' : SERIOUS.has(c.kind) ? 'threat' : c.kind === 'inaccuracy' ? 'warn' : c.kind === 'best' ? 'best' : 'line';
}
function renderMoveList(force) {
  const g = App.game;
  const box = $('#movelist');
  if (!g || $('#pane-moves').hidden) return;
  const boards = App.movesView === 'boards';
  $$('#moves-view button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.view === 'boards') === boards)));
  const key = [g.id, boards ? 'b' : 'l', g.ver || 0, App.view.orient].join('|');
  if (!force && key === MoveList.key && box.childElementCount) {
    moveListCursor();
    moveListReveal();
    return;
  }
  MoveList.key = key;
  MoveList.cells = [];
  MoveList.cur = 0;
  if (MoveList.io) MoveList.io.disconnect();
  box.classList.toggle('boards', boards);
  let html = '';
  if (boards) {
    for (let k = 1; k <= g.plies.length; k++)
      html += `<button type="button" class="sb" data-k="${k}"><span class="mb ph"></span><span class="fc">${moveCaptionHTML(g, k)}</span></button>`;
  } else {
    for (let k = 1; k <= g.plies.length; k++) {
      const p = g.plies[k - 1],
        c = g.cls[k];
      if (p.color === 'w' || k === 1) {
        html += `<span class="num">${fenFull(g.fens[k - 1])}.</span>`;
        if (p.color === 'b') html += '<span class="mvc gap">…</span>';
      }
      const sp = clockSpent(g, k);
      html +=
        `<span class="mvc" role="button" tabindex="0" data-k="${k}"><span>${esc(p.san)}</span>` +
        (c && BAD.has(c.kind) ? `<span class="g k-${c.kind}">${esc(KINDS[c.kind].glyph)}</span>` : '') +
        (sp != null ? `<span class="clk">${esc(fmtSpent(sp))}</span>` : '') +
        '</span>';
    }
  }
  box.innerHTML = html;
  for (const e of box.querySelectorAll('[data-k]')) MoveList.cells[+e.dataset.k] = e;
  if (boards) {
    // Draw each board only when it scrolls into view.
    const fill = e => {
      const k = +e.dataset.k,
        p = g.plies[k - 1],
        c = g.cls[k];
      e.firstElementChild.outerHTML = miniBoardHTML(g.fens[k], {
        orient: App.view.orient,
        move: { from: p.from, to: p.to },
        tone: moveToneOf(c),
        badge: c && BAD.has(c.kind) ? { sq: p.to, kind: c.kind } : null,
      });
    };
    if ('IntersectionObserver' in window) {
      MoveList.io = new IntersectionObserver(
        entries => {
          for (const en of entries)
            if (en.isIntersecting) {
              MoveList.io.unobserve(en.target);
              fill(en.target);
            }
        },
        { root: box, rootMargin: '300px' },
      );
      for (let k = 1; k < MoveList.cells.length; k++) MoveList.io.observe(MoveList.cells[k]);
    } else for (let k = 1; k < MoveList.cells.length; k++) fill(MoveList.cells[k]);
  }
  moveListCursor();
  moveListReveal();
}
function moveListCursor() {
  const v = App.view;
  const k = v.explore ? 0 : v.ply;
  if (k === MoveList.cur) return;
  const old = MoveList.cells[MoveList.cur];
  if (old) old.classList.remove('cur');
  const cell = MoveList.cells[k];
  if (cell) cell.classList.add('cur');
  MoveList.cur = k;
}
function moveListReveal() {
  if ($('#pane-moves').hidden) return;
  const cell = MoveList.cells[MoveList.cur];
  if (!cell) return;
  // Scroll only the list itself, never the page.
  const box = $('#movelist'); // positioned, so offsetTop is measured inside it
  const top = cell.offsetTop,
    bottom = top + cell.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top - 8;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 8;
}
function renderExploreBanner() {
  const v = App.view;
  const b = $('#explore-banner');
  if (!v.explore) {
    if (!b.hidden) b.hidden = true;
    return;
  }
  b.hidden = false;
  const ex = v.explore;
  const pos = ex.evals[ex.evals.length - 1];
  const line = lineText(
    ex.fens[0],
    ex.moves.map(m => m.san),
  );
  b.replaceChildren(
    el('b', { text: 'Side line' }),
    el('span', { class: 'mono', text: line }),
    el('span', { class: 'mono', text: pos ? fmtEval(pos) : '…' }),
    el('button', { class: 'btn small', style: 'margin-left:auto', onclick: () => go(ex.basePly), text: 'Back to the game' }),
  );
}
