/* ================= review: navigation ================= */
/* Stepping must feel instant, so a change of position is handled in two beats:
   1. now, inside the key or click handler: the board, last-move marks, eval bar, graph cursor, move-list
      highlight and the coach card's title (all cheap);
   2. after the browser has painted that: the coach card body, suggestions and scrolling (the expensive part).
   While a key is held (steps arrive faster than NAV_RAPID_MS) pieces snap instead of sliding and beat 2 waits
   until the stepping stops, so no work is spent on moves that are only passed through. */
const NAV_RAPID_MS = 150;
const Nav = { seq: 0, lastAt: -1e9, timer: 0, dirty: false, userAt: 0 };
/* Narrow screens show one column and the page itself scrolls (see the max-width: 1000px rules). */
const ONE_COL = window.matchMedia ? window.matchMedia('(max-width: 1000px)') : { matches: false };
function curFen() {
  const g = App.game,
    v = App.view;
  return v.explore ? v.explore.fens[v.explore.fens.length - 1] : g.fens[v.ply];
}
function go(ply) {
  const g = App.game;
  if (!g) return;
  const v = App.view;
  const from = v.explore ? null : v.ply;
  v.explore = null;
  v.ply = clamp(ply, 0, g.plies.length);
  navChanged(from != null && Math.abs(v.ply - from) === 1);
}
function navChanged(oneStep) {
  App.coachArrows = [];
  App.coachSquares = [];
  App.hover = null;
  hidePop();
  const now = performance.now();
  const rapid = now - Nav.lastAt < NAV_RAPID_MS;
  Nav.lastAt = Nav.userAt = now;
  paintBoard(oneStep && !rapid);
  schedulePanels(rapid);
  scheduleAutoExplain();
  if (!App.view.explore) Analyzer.want(App.view.ply);
}
function schedulePanels(rapid) {
  const seq = ++Nav.seq;
  Nav.dirty = true;
  const body = $('#cc-body');
  if (body) body.classList.add('stale');
  clearTimeout(Nav.timer);
  const run = () => {
    if (seq === Nav.seq && Nav.dirty) flushPanels();
  };
  if (rapid) {
    Nav.timer = setTimeout(run, NAV_RAPID_MS - 20);
    return;
  }
  // After the next paint; the plain timer is a fallback for when no frames are being produced (hidden tab).
  requestAnimationFrame(() => setTimeout(run, 0));
  Nav.timer = setTimeout(run, 120);
}
function flushPanels() {
  Nav.dirty = false;
  if (!App.game || App.tab !== 'review') return;
  // A new position starts at the top of the coach column. Done before the card is rebuilt (layout is still
  // clean, so this costs nothing) and only if the column was actually scrolled.
  const v = App.view;
  const at = App.game.id + '|' + v.ply + '|' + (v.explore ? v.explore.fens.length : 0);
  if (at !== Nav.shownAt) {
    Nav.shownAt = at;
    if (ONE_COL.matches) pageToNewMove();
    else if (Nav.scrolled) {
      $('#coach-scroll').scrollTop = 0;
      Nav.scrolled = false;
    }
  }
  renderCoachBody();
  renderSuggestions();
  moveListReveal();
  prewarmAround();
}
/* One-column layout, new position: make sure the board is on screen (it is pinned unless the screen is very
   short), and if the reader was part-way down the previous card, bring the top of the new one back under it. */
function pageToNewMove() {
  const stick = $('#board-stick').getBoundingClientRect();
  if (!stick.height) return;
  if (stick.bottom < 80 || stick.top > window.innerHeight - 80) {
    window.scrollBy(0, stick.top - 6);
    return;
  }
  if ($('#pane-coach').hidden) return;
  const card = $('#coach-card').getBoundingClientRect();
  if (card.top < stick.bottom) window.scrollBy(0, card.top - stick.bottom - 10);
}
/* Stepping is usually sequential, so while the browser is idle the cards for the next and previous moves are
   prepared (legal-move tables, board strips, linked text). The step itself then only has to show them. */
const whenIdle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 90));
function prewarmAround() {
  const g = App.game,
    v = App.view;
  if (!g || v.explore) return;
  const seq = Nav.seq;
  const todo = [v.ply + 1, v.ply - 1, v.ply + 2].filter(k => k >= 1 && k <= g.plies.length);
  const step = () => {
    if (seq !== Nav.seq || App.game !== g || App.tab !== 'review') return;
    const k = todo.shift();
    if (k == null) return;
    try {
      const saved = g.explanations[k];
      const figs = moveFigs(g, k, !!saved);
      if (saved) explanationHTML(g, k, saved.t, figs.seen);
    } catch {}
    whenIdle(step);
  };
  whenIdle(step);
}
function stepBack() {
  const v = App.view;
  if (v.explore) {
    v.explore.moves.pop();
    v.explore.fens.pop();
    v.explore.evals.pop();
    if (!v.explore.moves.length) v.explore = null;
    navChanged(true);
    evalExploreTip(); // a line opened from a board picture has no engine numbers for its earlier positions yet
    return;
  }
  if (v.ply > 0) go(v.ply - 1);
}
function stepForward() {
  if (App.view.explore || !App.game || App.view.ply >= App.game.plies.length) return;
  go(App.view.ply + 1);
}

/* A move made on the board: the game's own next move steps forward, anything else starts or extends a side line. */
async function onBoardMove(from, to, promo) {
  if (guessPending()) return handleGuess(from, to, promo);
  const g = App.game,
    v = App.view,
    fen = curFen();
  const m = posInfo(fen).moves.find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === (promo || 'q')));
  if (!m) return false;
  const next = g.plies[v.ply];
  if (!v.explore && next && next.from === from && next.to === to && (next.promotion || null) === (m.promotion || null)) {
    go(v.ply + 1);
    return true;
  }
  const after = fenAfter(fen, m);
  if (!after) return false;
  if (!v.explore) v.explore = { basePly: v.ply, moves: [], fens: [fen], evals: [g.pos[v.ply] || null] };
  v.explore.moves.push({ san: m.san, from, to, color: m.color });
  v.explore.fens.push(after);
  v.explore.evals.push(null);
  navChanged(true);
  evalExploreTip();
  return true;
}
async function evalExploreTip() {
  const ex = App.view.explore;
  if (!ex) return;
  const idx = ex.fens.length - 1,
    fen = ex.fens[idx];
  if (ex.evals[idx]) return;
  let r;
  try {
    r = await evalFen(fen, { priority: 4 });
  } catch {
    return;
  }
  // The line may have been shortened or changed while the engine was busy. A result is only kept for a
  // position that is still at the same place in the line.
  if (ex.fens[idx] !== fen) return;
  ex.evals[idx] = r.pos;
  if (App.view.explore !== ex || ex.fens.length - 1 !== idx || App.tab !== 'review') return;
  renderEvalBar();
  renderDecor();
  renderExploreBanner();
  if (!Nav.dirty) renderCoachBody();
}
/* Show a line on the main board: game ply `ply`, then the moves in `sans`. Moves that are the game's own
   continuation just step through the game; the rest becomes a side line. */
function openLine(ply, sans) {
  const g = App.game;
  if (!g || ply == null || isNaN(ply) || ply < 0 || ply > g.plies.length) return;
  if (App.tab !== 'review') switchTab('review');
  const bare = s => String(s).replace(/[+#!?]/g, '');
  let k = ply,
    i = 0;
  while (i < sans.length && k < g.plies.length && bare(g.plies[k].san) === bare(sans[i])) {
    k++;
    i++;
  }
  const v = App.view;
  const before = v.explore ? null : v.ply;
  v.explore = null;
  v.ply = k;
  const steps = i < sans.length ? sanSteps(g.fens[k], sans.slice(i)) : [];
  if (steps.length)
    v.explore = {
      basePly: k,
      moves: steps.map(s => ({ san: s.san, from: s.from, to: s.to, color: s.color })),
      fens: [g.fens[k]].concat(steps.map(s => s.fen)),
      evals: [g.pos[k] || null].concat(steps.map(() => null)),
    };
  navChanged(before != null && Math.abs(k - before) + steps.length === 1);
  evalExploreTip();
}
function exploreFromBefore(san) {
  if (App.view.ply >= 1) openLine(App.view.ply - 1, [san]);
}
