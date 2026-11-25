/* ================= engine ================= */
const Engine = {
  w: null,
  ready: null,
  queue: [],
  cur: null,
  seq: 0,
  failed: false,
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const src = `try{importScripts(${JSON.stringify(SF_URLS[0])})}catch(e){importScripts(${JSON.stringify(SF_URLS[1] || SF_URLS[0])})}`;
      let w;
      try {
        w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      } catch (e) {
        this.failed = true;
        reject(e);
        return;
      }
      this.w = w;
      const timer = setTimeout(() => {
        this.failed = true;
        reject(new Error('engine timeout'));
      }, 45000);
      w.onmessage = e => {
        const line = String(e.data);
        if (line === 'uciok') {
          clearTimeout(timer);
          resolve();
          return;
        }
        this._line(line);
      };
      w.onerror = e => {
        clearTimeout(timer);
        this.failed = true;
        reject(e);
        this._failAll(e);
      };
      w.postMessage('uci');
      // Contempt skews evals toward the side to move, which would grade every move as a loss.
      w.postMessage('setoption name Contempt value 0');
      w.postMessage('setoption name Analysis Contempt value Off');
    });
    return this.ready;
  },
  _failAll(err) {
    const q = this.queue.splice(0);
    if (this.cur) q.push(this.cur);
    this.cur = null;
    q.forEach(j => j.reject(err));
  },
  analyze(fen, { depth = 13, movetime = 1400, multipv = 1, priority = 0, onInfo, searchmoves } = {}) {
    return new Promise((resolve, reject) => {
      if (this.failed) {
        reject(new Error('engine unavailable'));
        return;
      }
      this.queue.push({ fen, depth, movetime, multipv, priority, onInfo, searchmoves, resolve, reject, lines: [], id: ++this.seq });
      this.queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
      this.start().then(
        () => this._pump(),
        err => this._failAll(err),
      );
    });
  },
  _pump() {
    if (this.cur || !this.queue.length) return;
    const job = (this.cur = this.queue.shift());
    this.w.postMessage('setoption name MultiPV value ' + job.multipv);
    this.w.postMessage('position fen ' + job.fen);
    this.w.postMessage(`go depth ${job.depth} movetime ${job.movetime}${job.searchmoves ? ' searchmoves ' + job.searchmoves : ''}`);
  },
  _line(line) {
    const job = this.cur;
    if (!job) return;
    if (line.startsWith('info ') && line.includes(' pv ') && !/ (lower|upper)bound /.test(line)) {
      const t = line.split(' ');
      let depth = 0,
        mpv = 1,
        cp = null,
        mate = null,
        pv = [];
      for (let i = 1; i < t.length; i++) {
        if (t[i] === 'depth') depth = +t[++i];
        else if (t[i] === 'multipv') mpv = +t[++i];
        else if (t[i] === 'score') {
          if (t[i + 1] === 'cp') cp = +t[i + 2];
          else if (t[i + 1] === 'mate') mate = +t[i + 2];
          i += 2;
        } else if (t[i] === 'pv') {
          pv = t.slice(i + 1);
          break;
        }
      }
      job.lines[mpv - 1] = { depth, cp, mate, pv };
      if (job.onInfo)
        try {
          job.onInfo(job.lines.filter(Boolean));
        } catch {}
    } else if (line.startsWith('bestmove')) {
      this.cur = null;
      job.resolve({ lines: job.lines.filter(Boolean), best: line.split(' ')[1] });
      this._pump();
    }
  },
};
function linePos(L, turn, best) {
  const s = turn === 'w' ? 1 : -1;
  const mate = L.mate != null ? L.mate * s : null;
  const cp = mate != null ? (mate > 0 ? 10000 - 10 * mate : -10000 - 10 * mate) : (L.cp || 0) * s;
  return { c: cp, m: mate, b: best && best !== '(none)' ? best : L.pv[0] || null, p: L.pv.slice(0, 10).join(' '), d: L.depth };
}
function terminalPos(fen) {
  const c = new Chess(fen);
  if (c.in_checkmate()) return { c: c.turn() === 'w' ? -10000 : 10000, m: null, b: null, p: '', d: 0, over: 1 };
  if (c.in_stalemate() || c.insufficient_material() || c.in_threefold_repetition()) return { c: 0, m: null, b: null, p: '', d: 0, over: 1 };
  return null;
}
async function evalFen(fen, { priority = 5, depth, movetime, multipv = 1 } = {}) {
  const term = terminalPos(fen);
  if (term) return { pos: term, lines: [] };
  const lvl = LEVELS[App.profile.settings.strength] || LEVELS.standard;
  const r = await Engine.analyze(fen, { depth: depth || lvl.depth, movetime: movetime || lvl.ms, multipv, priority });
  const turn = fenTurn(fen);
  if (!r.lines.length) return { pos: { c: 0, m: null, b: r.best, p: r.best || '', d: 0 }, lines: [] };
  return { pos: linePos(r.lines[0], turn, r.best), lines: r.lines.map(L => linePos(L, turn, L.pv[0])) };
}
