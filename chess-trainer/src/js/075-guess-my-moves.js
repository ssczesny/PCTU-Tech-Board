/* ================= guess my moves ================= */
function guessPending() {
  const g = App.game,
    v = App.view;
  return !!(App.guess.on && g && !v.explore && v.ply < g.plies.length && g.plies[v.ply].color === g.userColor && !App.guess.res[v.ply + 1]);
}
function guessScore() {
  const xs = Object.values(App.guess.res).filter(r => r.pts != null);
  return { pts: xs.reduce((s, r) => s + r.pts, 0), n: xs.length };
}
async function handleGuess(from, to, promo) {
  const g = App.game,
    v = App.view;
  const i = v.ply,
    k = i + 1;
  const fen = g.fens[i];
  const m = posInfo(fen).moves.find(x => x.from === from && x.to === to && (!x.promotion || x.promotion === (promo || 'q')));
  const after = m ? fenAfter(fen, m) : null;
  if (!after) return false;
  const c = { fen: () => after };
  const u = from + to + (m.promotion || '');
  const pl = g.plies[i];
  const playedU = pl.from + pl.to + (pl.promotion || '');
  const entry = (App.guess.res[k] = { san: m.san, pts: null, checking: true, same: u === playedU });
  board.setPosition(after, true);
  board.setInteractive(false);
  renderCoachBody();
  await Analyzer.want(i);
  const a = g.pos[i];
  let drop = null;
  if (a && a.b === u) drop = 0;
  else if (a && u === playedU && a.pc != null) drop = Math.max(0, winPct(povCp(a.c, g.userColor)) - winPct(povCp(a.pc, g.userColor)));
  else if (a) {
    try {
      const r = await evalFen(c.fen(), { priority: 5, depth: 13, movetime: 1500 });
      drop = Math.max(0, winPct(povCp(a.c, g.userColor)) - winPct(povCp(r.pos.c, g.userColor)));
    } catch {}
  }
  entry.checking = false;
  entry.drop = drop;
  entry.top = !!(a && a.b === u);
  entry.best = a && a.b ? sanLine(fen, a.b, 1)[0] : null;
  entry.pts = drop == null ? 0 : drop <= 2 ? 2 : drop <= 6 ? 1 : 0;
  entry.verdict =
    drop == null
      ? 'not graded'
      : entry.top
        ? 'the engine’s top move'
        : drop <= 2
          ? 'excellent'
          : drop <= 6
            ? 'good'
            : drop <= 12
              ? 'inaccurate'
              : 'a mistake';
  if (App.game === g && App.view.ply === i && !App.view.explore) go(k);
  else renderCoach();
  return true;
}
function guessPromptEl() {
  if (!guessPending()) return null;
  const sc = guessScore();
  return el(
    'div',
    { class: 'guess-box' },
    el('b', { text: 'Your move. ' }),
    'What would you play here? Make your move on the board before the game move is revealed, or press → to skip.',
    sc.n ? el('span', { class: 'guess-score mono', text: ` Score ${sc.pts} / ${sc.n * 2}` }) : null,
  );
}
function guessResultEl(k) {
  const r = App.guess.res[k];
  if (!r) return null;
  const g = App.game;
  const sc = guessScore();
  if (r.checking) return el('div', { class: 'guess-box' }, thinkingEl(`Checking your guess, ${r.san}…`));
  const tone = r.pts === 2 ? 'ok' : r.pts === 1 ? '' : 'bad';
  return el(
    'div',
    { class: 'guess-box ' + tone },
    el('b', { text: `You guessed ${r.san}: ${r.verdict} (+${r.pts}). ` }),
    r.same ? 'That’s what you played in the game. ' : `In the game you played ${g.plies[k - 1].san}. `,
    r.best && !r.top ? `Stockfish preferred ${r.best}. ` : '',
    el('span', { class: 'guess-score mono', text: `Score ${sc.pts} / ${sc.n * 2}` }),
  );
}
