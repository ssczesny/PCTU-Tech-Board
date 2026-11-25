/* ================= analysis pass ================= */
/* Grade the played move from the same search root as the best move, so side-to-move bias cancels out. */
async function analyzeIndex(g, i) {
  const fen = g.fens[i];
  const term = terminalPos(fen);
  if (term) return term;
  const lvl = LEVELS[App.profile.settings.strength] || LEVELS.standard;
  const turn = fenTurn(fen);
  const r = await Engine.analyze(fen, { depth: lvl.depth, movetime: lvl.ms, priority: 1 });
  const pos = r.lines.length ? linePos(r.lines[0], turn, r.best) : { c: 0, m: null, b: r.best, p: r.best || '', d: 0 };
  const ply = g.plies[i];
  if (ply) {
    const uci = ply.from + ply.to + (ply.promotion || '');
    if (uci === pos.b) {
      pos.pc = pos.c;
      pos.pm = pos.m;
    } else {
      const r2 = await Engine.analyze(fen, { depth: lvl.depth, movetime: lvl.ms, priority: 1, searchmoves: uci });
      if (r2.lines.length) {
        const q = linePos(r2.lines[0], turn, uci);
        pos.pc = q.c;
        pos.pm = q.m;
      }
    }
  }
  return pos;
}
/* Evaluation after the played move, as seen from the position before it. */
function playedPos(a, b) {
  return a && a.pc != null ? { c: a.pc, m: a.pm != null ? a.pm : null } : b;
}
const Analyzer = {
  token: 0,
  game: null,
  wanted: [],
  waiters: [],
  error: null,
  start(g) {
    this.token++;
    this.game = g;
    this.wanted = [];
    this.error = null;
    this.waiters.splice(0).forEach(w => w.res());
    this.loop(this.token);
  },
  want(i) {
    const g = App.game;
    if (!g || i < 0 || i >= g.pos.length || g.pos[i] || this.error) return Promise.resolve();
    if (this.game !== g) this.start(g);
    if (!this.wanted.includes(i)) this.wanted.unshift(i);
    return new Promise(res => this.waiters.push({ i, res }));
  },
  next() {
    const g = this.game;
    while (this.wanted.length) {
      const i = this.wanted.shift();
      if (!g.pos[i]) return i;
    }
    return g.pos.findIndex(p => !p);
  },
  async loop(t) {
    const g = this.game;
    if (!g) return;
    let done = 0;
    renderStatus();
    while (t === this.token) {
      const i = this.next();
      if (i < 0) break;
      // Grading other games in the background waits while the student is busy with this one.
      if (g !== App.game) {
        while (t === this.token && performance.now() - Nav.userAt < 3000) await new Promise(r => setTimeout(r, 500));
        if (t !== this.token) return;
      }
      try {
        g.pos[i] = await analyzeIndex(g, i);
      } catch (e) {
        this.error = e;
        this.waiters.splice(0).forEach(w => w.res());
        renderStatus();
        renderCoach();
        return;
      }
      done++;
      this.waiters = this.waiters.filter(w => {
        if (w.i === i) {
          w.res();
          return false;
        }
        return true;
      });
      if (t !== this.token) return;
      onPositionAnalyzed(g, i);
      if (done % 30 === 0 && !g.pos.every(Boolean)) saveAnalysis(g, false);
    }
    if (t === this.token) {
      computeCls(g);
      if (done || !(g.rec.analysis && g.rec.analysis.complete)) saveAnalysis(g, true);
      onAnalysisDone(g);
    }
  },
};
