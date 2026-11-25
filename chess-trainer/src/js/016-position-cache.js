/* ================= position cache ================= */
/* Everything that needs "what is legal here" goes through posInfo(): the legal moves of a position with their
   notation, computed once by the rules module and kept. */
const POS_CACHE = new Map();
const LINE_CACHE = new Map();
const SWING_CACHE = new Map();
function cachePut(map, key, value, cap) {
  if (map.size >= cap) {
    let n = cap >> 3;
    for (const k of map.keys()) {
      map.delete(k);
      if (--n <= 0) break;
    }
  }
  map.set(key, value);
  return value;
}
function buildInfo(fen) {
  let moves = [];
  try {
    moves = movesOf(fen);
  } catch {}
  const bySan = new Map(),
    dests = new Map();
  for (const m of moves) {
    bySan.set(m.san.replace(/[+#]/g, ''), m);
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return { moves, bySan, dests, P: moves.P };
}
function posInfo(fen) {
  return POS_CACHE.get(fen) || cachePut(POS_CACHE, fen, buildInfo(fen), 3000);
}
const destsOf = fen => posInfo(fen).dests;

/* Resolve a move written in notation against a position. Tolerates "+", "#", "!?", 0-0, lower-case piece
   letters, extra disambiguation and promotions written without "=". Returns the chess.js verbose move, or
   null when it is not legal or is ambiguous. */
const legalSan = (fen, token) => matchSan(posInfo(fen), token);
function matchSan(info, token) {
  const t = String(token || '')
    .trim()
    .replace(/[!?]+$/, '')
    .replace(/[+#]+$/, '')
    .replace(/e\.p\.$/, '')
    .replace(/^0-0-0/, 'O-O-O')
    .replace(/^0-0/, 'O-O');
  if (!t) return null;
  const exact = info.bySan.get(t);
  if (exact) return exact;
  const mm = /^([KQRBNkqrn])?([a-h])?([1-8])?x?-?([a-h][1-8])(?:=?([QRBNqrbn]))?$/.exec(t);
  if (!mm) return null;
  const [, pc, ff, fr, to, pr] = mm;
  // "x" must agree with the move: Bh6 and Bxh6 are different moves in different positions, and text that
  // quotes a line should not latch onto the wrong one.
  const isCapture = t.includes('x');
  const pick = piece => {
    const c = info.moves.filter(
      m =>
        m.piece === piece &&
        m.to === to &&
        !!m.captured === isCapture &&
        (!ff || m.from[0] === ff) &&
        (!fr || m.from[1] === fr) &&
        (piece !== 'p' || ff || m.from[0] === to[0]) &&
        (pr ? m.promotion === pr.toLowerCase() : !m.promotion || m.promotion === 'q'),
    );
    return c.length === 1 ? c[0] : null;
  };
  if (pc) return pick(pc.toLowerCase());
  // No piece letter: a pawn move; "bc4" style can also be a lower-case bishop.
  if (ff !== 'b' || pr) return pick('p');
  const pawn = pick('p');
  if (pawn) return pawn;
  const c = info.moves.filter(m => m.piece === 'b' && m.to === to && !!m.captured === isCapture && (!fr || m.from[1] === fr));
  return c.length === 1 ? c[0] : null;
}
/* The legal move from -> to in a position (queen by default when it is a promotion), or undefined. */
function moveIn(info, mv) {
  return info.moves.find(x => x.from === mv.from && x.to === mv.to && (!x.promotion || x.promotion === (mv.promotion || 'q')));
}
/* FEN after a legal move; null if the move is not legal there. Kept on the move, so asking twice is free. */
function fenAfter(fen, mv) {
  const info = posInfo(fen);
  const m = mv && mv.fl != null && info.moves.includes(mv) ? mv : mv ? moveIn(info, mv) : null;
  if (!m) return null;
  return m.after || (m.after = posFen(applyMove(info.P, m)));
}

/* An engine line (UCI moves) played out from a position: [{san, from, to, color, captured, promotion, fen}] with
   `fen` the position after each move. Cached, since the same lines are shown on every visit to a move. */
function lineSteps(fen, pv, max = 8) {
  const key = fen + '|' + pv + '|' + max;
  const hit = LINE_CACHE.get(key);
  if (hit) return hit;
  const out = [];
  let cur = fen;
  for (const u of String(pv || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, max)) {
    const m = moveIn(posInfo(cur), uciMove(u));
    if (!m) break;
    cur = fenAfter(cur, m);
    out.push({ san: m.san, from: m.from, to: m.to, color: m.color, captured: m.captured || null, promotion: m.promotion || null, fen: cur });
  }
  return cachePut(LINE_CACHE, key, out, 3000);
}
const sanLine = (fen, pv, max = 8) => lineSteps(fen, pv, max).map(s => s.san);
/* The same, from moves written in notation. Stops at the first move that is not legal. */
function sanSteps(fen, sans) {
  const out = [];
  let cur = fen;
  for (const s of sans) {
    const m = legalSan(cur, s);
    if (!m) break;
    const next = fenAfter(cur, m);
    if (!next) break;
    out.push({ san: m.san, from: m.from, to: m.to, color: m.color, captured: m.captured || null, promotion: m.promotion || null, fen: next });
    cur = next;
  }
  return out;
}
/* Material change (White minus Black) along an engine line, letting captures at the horizon finish. */
function lineSwing(fen, pv, plies = 6) {
  const key = fen + '|' + pv + '|' + plies;
  const hit = SWING_CACHE.get(key);
  if (hit !== undefined) return hit;
  const steps = lineSteps(fen, pv, plies + 3);
  let i = Math.min(plies, steps.length);
  while (i < steps.length && i < plies + 3 && steps[i].captured) i++;
  if (!i) return cachePut(SWING_CACHE, key, 0, 3000);
  const m0 = material(fen),
    m1 = material(steps[i - 1].fen);
  return cachePut(SWING_CACHE, key, m1.w - m1.b - (m0.w - m0.b), 3000);
}
/* Square of the king that is in check, or null. */
function checkSquare(fen) {
  const P = parsePos(fen);
  const k = P.b.indexOf(P.w ? 'K' : 'k');
  return k >= 0 && attackedBy(P.b, k & 7, k >> 3, !P.w) ? SQN[k] : null;
}
