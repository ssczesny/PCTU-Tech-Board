/* ================= rules ================= */
/* A small, fast move generator. chess.js stays the reference (and is still used for draw detection and the
   engine tools), but it takes ~1 ms to list the legal moves of one position with their notation, which adds
   up when a card quotes ten positions or an import reads sixty games. This does the same job in a fraction of
   that, and the test suite checks it against chess.js move for move: same legal moves, same notation, same
   FEN after every move.
   Board: 64 cells, index = rank * 8 + file (a1 = 0, h8 = 63), 'P'..'K' white, 'p'..'k' black, '' empty. */
const R_KN = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const R_KING = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const R_DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const R_ORTH = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const R_ALL = R_DIAG.concat(R_ORTH);
const SQN = [];
for (let i = 0; i < 64; i++) SQN.push('abcdefgh'[i & 7] + ((i >> 3) + 1));
const sqi = s => (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);

function parsePos(fen) {
  const p = fen.split(' ');
  const b = new Array(64).fill('');
  const rows = p[0].split('/');
  for (let i = 0; i < 8; i++) {
    const row = rows[i] || '';
    let f = 0;
    for (let j = 0; j < row.length; j++) {
      const ch = row[j];
      if (ch >= '1' && ch <= '8') f += +ch;
      else b[(7 - i) * 8 + f++] = ch;
    }
  }
  return {
    b,
    w: (p[1] || 'w') === 'w',
    castle: p[2] && p[2] !== '-' ? p[2] : '',
    ep: p[3] && p[3] !== '-' ? sqi(p[3]) : -1,
    half: +p[4] || 0,
    full: +p[5] || 1,
  };
}
function posFen(P) {
  let s = '';
  for (let r = 7; r >= 0; r--) {
    let run = 0;
    for (let f = 0; f < 8; f++) {
      const ch = P.b[r * 8 + f];
      if (!ch) run++;
      else {
        if (run) s += run;
        run = 0;
        s += ch;
      }
    }
    if (run) s += run;
    if (r) s += '/';
  }
  return `${s} ${P.w ? 'w' : 'b'} ${P.castle || '-'} ${P.ep >= 0 ? SQN[P.ep] : '-'} ${P.half} ${P.full}`;
}
/* Is square (f, r) attacked by the white (or black) pieces? */
function attackedBy(b, f, r, white) {
  const pr = white ? r - 1 : r + 1;
  if (pr >= 0 && pr < 8) {
    const P = white ? 'P' : 'p';
    if (f > 0 && b[pr * 8 + f - 1] === P) return true;
    if (f < 7 && b[pr * 8 + f + 1] === P) return true;
  }
  const N = white ? 'N' : 'n',
    K = white ? 'K' : 'k',
    B = white ? 'B' : 'b',
    R = white ? 'R' : 'r',
    Q = white ? 'Q' : 'q';
  for (let i = 0; i < 8; i++) {
    let x = f + R_KN[i][0],
      y = r + R_KN[i][1];
    if (x >= 0 && x < 8 && y >= 0 && y < 8 && b[y * 8 + x] === N) return true;
    x = f + R_KING[i][0];
    y = r + R_KING[i][1];
    if (x >= 0 && x < 8 && y >= 0 && y < 8 && b[y * 8 + x] === K) return true;
  }
  for (let i = 0; i < 8; i++) {
    const dx = R_ALL[i][0],
      dy = R_ALL[i][1];
    const slider = i < 4 ? B : R;
    let x = f + dx,
      y = r + dy;
    while (x >= 0 && x < 8 && y >= 0 && y < 8) {
      const p = b[y * 8 + x];
      if (p) {
        if (p === slider || p === Q) return true;
        break;
      }
      x += dx;
      y += dy;
    }
  }
  return false;
}
/* Internal move: f/t square indices, p piece type, c captured type or '', pr promotion or '', fl chess.js-style
   flags ('n' quiet, 'b' double pawn push, 'c' capture, 'e' en passant, 'k'/'q' castling, +'p' promotion). */
function pseudoMoves(P) {
  const b = P.b,
    w = P.w,
    out = [];
  const push = (f, t, p, c, pr, fl) => out.push({ f, t, p, c, pr, fl });
  for (let s = 0; s < 64; s++) {
    const ch = b[s];
    if (!ch || ch < 'a' !== w) continue;
    const f = s & 7,
      r = s >> 3,
      type = ch.toLowerCase();
    if (type === 'p') {
      const dir = w ? 1 : -1,
        r1 = r + dir;
      if (r1 < 0 || r1 > 7) continue;
      const promo = r1 === (w ? 7 : 0);
      const add = (t, c, fl) => {
        if (promo) for (const pr of 'qrbn') push(s, t, 'p', c, pr, fl + 'p');
        else push(s, t, 'p', c, '', fl);
      };
      if (!b[r1 * 8 + f]) {
        add(r1 * 8 + f, '', 'n');
        if (r === (w ? 1 : 6) && !b[(r + 2 * dir) * 8 + f]) push(s, (r + 2 * dir) * 8 + f, 'p', '', '', 'b');
      }
      for (let df = -1; df <= 1; df += 2) {
        const x = f + df;
        if (x < 0 || x > 7) continue;
        const t = r1 * 8 + x,
          tc = b[t];
        if (tc) {
          if (tc < 'a' !== w) add(t, tc.toLowerCase(), 'c');
        } else if (t === P.ep) push(s, t, 'p', 'p', '', 'e');
      }
    } else if (type === 'n' || type === 'k') {
      const steps = type === 'n' ? R_KN : R_KING;
      for (let i = 0; i < 8; i++) {
        const x = f + steps[i][0],
          y = r + steps[i][1];
        if (x < 0 || x > 7 || y < 0 || y > 7) continue;
        const t = y * 8 + x,
          tc = b[t];
        if (!tc) push(s, t, type, '', '', 'n');
        else if (tc < 'a' !== w) push(s, t, type, tc.toLowerCase(), '', 'c');
      }
      if (type === 'k' && f === 4 && r === (w ? 0 : 7) && P.castle) {
        const rook = w ? 'R' : 'r';
        if (
          P.castle.includes(w ? 'K' : 'k') &&
          !b[s + 1] &&
          !b[s + 2] &&
          b[s + 3] === rook &&
          !attackedBy(b, 4, r, !w) &&
          !attackedBy(b, 5, r, !w) &&
          !attackedBy(b, 6, r, !w)
        )
          push(s, s + 2, 'k', '', '', 'k');
        if (
          P.castle.includes(w ? 'Q' : 'q') &&
          !b[s - 1] &&
          !b[s - 2] &&
          !b[s - 3] &&
          b[s - 4] === rook &&
          !attackedBy(b, 4, r, !w) &&
          !attackedBy(b, 3, r, !w) &&
          !attackedBy(b, 2, r, !w)
        )
          push(s, s - 2, 'k', '', '', 'q');
      }
    } else {
      const from = type === 'r' ? 4 : 0,
        to = type === 'b' ? 4 : 8;
      for (let i = from; i < to; i++) {
        const dx = R_ALL[i][0],
          dy = R_ALL[i][1];
        let x = f + dx,
          y = r + dy;
        while (x >= 0 && x < 8 && y >= 0 && y < 8) {
          const t = y * 8 + x,
            tc = b[t];
          if (!tc) push(s, t, type, '', '', 'n');
          else {
            if (tc < 'a' !== w) push(s, t, type, tc.toLowerCase(), '', 'c');
            break;
          }
          x += dx;
          y += dy;
        }
      }
    }
  }
  return out;
}
/* Play a move on the board array in place. Returns what is needed to take it back. */
function boardMake(b, m, w) {
  const piece = b[m.f];
  const capSq = m.fl === 'e' ? m.t + (w ? -8 : 8) : m.t;
  const captured = b[capSq];
  b[m.f] = '';
  if (capSq !== m.t) b[capSq] = '';
  b[m.t] = m.pr ? (w ? m.pr.toUpperCase() : m.pr) : piece;
  if (m.fl === 'k') {
    b[m.t - 1] = b[m.t + 1];
    b[m.t + 1] = '';
  } else if (m.fl === 'q') {
    b[m.t + 1] = b[m.t - 2];
    b[m.t - 2] = '';
  }
  return { piece, captured, capSq };
}
function boardUnmake(b, m, u) {
  if (m.fl === 'k') {
    b[m.t + 1] = b[m.t - 1];
    b[m.t - 1] = '';
  } else if (m.fl === 'q') {
    b[m.t - 2] = b[m.t + 1];
    b[m.t + 1] = '';
  }
  b[m.f] = u.piece;
  b[m.t] = '';
  b[u.capSq] = u.captured;
}
/* Legal moves, each marked with whether it gives check (m.chk). With `any`, stops at the first legal move. */
function legalMoves(P, any) {
  const b = P.b,
    w = P.w,
    out = [];
  const myKing = b.indexOf(w ? 'K' : 'k'),
    theirKing = b.indexOf(w ? 'k' : 'K');
  for (const m of pseudoMoves(P)) {
    const u = boardMake(b, m, w);
    const k = m.p === 'k' ? m.t : myKing;
    const ok = k < 0 || !attackedBy(b, k & 7, k >> 3, !w);
    if (ok) m.chk = theirKing >= 0 && attackedBy(b, theirKing & 7, theirKing >> 3, w);
    boardUnmake(b, m, u);
    if (ok) {
      out.push(m);
      if (any) return out;
    }
  }
  return out;
}
/* The position after a move (a new object; the input is not changed). */
function applyMove(P, m) {
  const b = P.b.slice(),
    w = P.w;
  boardMake(b, m, w);
  let castle = P.castle;
  if (castle) {
    const drop = chs => {
      for (const ch of chs) castle = castle.replace(ch, '');
    };
    if (m.p === 'k') drop(w ? 'KQ' : 'kq');
    for (const s of [m.f, m.t]) {
      if (s === 0) drop('Q');
      else if (s === 7) drop('K');
      else if (s === 56) drop('q');
      else if (s === 63) drop('k');
    }
  }
  return {
    b,
    w: !w,
    castle,
    ep: m.fl === 'b' ? m.t + (w ? -8 : 8) : -1,
    half: m.p === 'p' || m.c ? 0 : P.half + 1,
    full: P.full + (w ? 0 : 1),
  };
}
/* Standard notation for a legal move, given all legal moves of the position (for disambiguation). */
function sanOf(P, m, legal) {
  let s;
  if (m.fl === 'k') s = 'O-O';
  else if (m.fl === 'q') s = 'O-O-O';
  else {
    s = '';
    if (m.p !== 'p') {
      s = m.p.toUpperCase();
      let others = 0,
        sameFile = 0,
        sameRank = 0;
      for (const o of legal)
        if (o.p === m.p && o.t === m.t && o.f !== m.f) {
          others++;
          if ((o.f & 7) === (m.f & 7)) sameFile++;
          if (o.f >> 3 === m.f >> 3) sameRank++;
        }
      if (others) s += sameFile && sameRank ? SQN[m.f] : sameFile ? SQN[m.f][1] : SQN[m.f][0];
    }
    if (m.c) s += (m.p === 'p' ? SQN[m.f][0] : '') + 'x';
    s += SQN[m.t];
    if (m.pr) s += '=' + m.pr.toUpperCase();
  }
  if (m.chk) s += legalMoves(applyMove(P, m), true).length ? '+' : '#';
  return s;
}
/* Legal moves in the shape the rest of the app uses (the same fields as chess.js verbose moves). */
function movesOf(fen) {
  const P = parsePos(fen);
  const legal = legalMoves(P);
  const color = P.w ? 'w' : 'b';
  for (const m of legal) {
    m.color = color;
    m.from = SQN[m.f];
    m.to = SQN[m.t];
    m.piece = m.p;
    if (m.c) m.captured = m.c;
    if (m.pr) m.promotion = m.pr;
    m.flags = m.fl;
    m.san = sanOf(P, m, legal);
  }
  legal.P = P;
  return legal;
}
