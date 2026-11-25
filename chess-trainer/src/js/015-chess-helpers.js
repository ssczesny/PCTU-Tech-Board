/* ================= chess helpers ================= */
const winPct = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const povCp = (cpWhite, color) => (color === 'w' ? cpWhite : -cpWhite);
const uciMove = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
const fenTurn = fen => fen.split(' ')[1];
const fenFull = fen => +fen.split(' ')[5] || 1;
function material(fen) {
  let w = 0,
    b = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = VAL[ch.toLowerCase()];
    if (v == null) continue;
    if (ch === ch.toUpperCase()) w += v;
    else b += v;
  }
  return { w, b };
}
function fenPieces(fen) {
  const m = new Map();
  const rows = fen.split(' ')[0].split('/');
  for (let i = 0; i < 8; i++) {
    let f = 0;
    for (const ch of rows[i] || '') {
      if (/\d/.test(ch)) f += +ch;
      else {
        m.set(FILES[f] + (8 - i), (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
        f++;
      }
    }
  }
  return m;
}
function boardArr(fen) {
  const B = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const [sq, code] of fenPieces(fen)) B[+sq[1] - 1][FILES.indexOf(sq[0])] = { color: code[0], type: code[1].toLowerCase() };
  return B;
}
const KN = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KG = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ORTH = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
function attackersOf(B, f, r, color) {
  const res = [];
  const at = (x, y) => (x < 0 || x > 7 || y < 0 || y > 7 ? null : B[y][x]);
  const sq = (x, y) => FILES[x] + (y + 1);
  const pd = color === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const p = at(f + df, r + pd);
    if (p && p.color === color && p.type === 'p') res.push({ sq: sq(f + df, r + pd), type: 'p' });
  }
  for (const [dx, dy] of KN) {
    const p = at(f + dx, r + dy);
    if (p && p.color === color && p.type === 'n') res.push({ sq: sq(f + dx, r + dy), type: 'n' });
  }
  for (const [dx, dy] of KG) {
    const p = at(f + dx, r + dy);
    if (p && p.color === color && p.type === 'k') res.push({ sq: sq(f + dx, r + dy), type: 'k' });
  }
  for (const [dirs, types] of [
    [DIAG, 'bq'],
    [ORTH, 'rq'],
  ])
    for (const [dx, dy] of dirs) {
      let x = f + dx,
        y = r + dy;
      while (x >= 0 && x < 8 && y >= 0 && y < 8) {
        const p = B[y][x];
        if (p) {
          if (p.color === color && types.includes(p.type)) res.push({ sq: sq(x, y), type: p.type });
          break;
        }
        x += dx;
        y += dy;
      }
    }
  return res;
}
/* Pieces of `color` that are attacked and either undefended or attacked by something cheaper. */
function loosePieces(fen, color) {
  const B = boardArr(fen);
  const opp = other(color);
  const out = [];
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const p = B[r][f];
      if (!p || p.color !== color || p.type === 'k') continue;
      const att = attackersOf(B, f, r, opp);
      if (!att.length) continue;
      const def = attackersOf(B, f, r, color);
      const minAtt = Math.min(...att.map(a => (a.type === 'k' ? 100 : VAL[a.type])));
      if (att.every(a => a.type === 'k') && def.length) continue;
      if (!def.length || minAtt < VAL[p.type]) out.push({ sq: FILES[f] + (r + 1), type: p.type, attackers: att, defenders: def });
    }
  return out.sort((a, b) => VAL[b.type] - VAL[a.type]);
}
function targetsOf(fen, fromSq) {
  const B = boardArr(fen);
  const f0 = FILES.indexOf(fromSq[0]),
    r0 = +fromSq[1] - 1;
  const me = B[r0][f0];
  if (!me) return [];
  const out = [];
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const p = B[r][f];
      if (!p || p.color === me.color) continue;
      if (attackersOf(B, f, r, me.color).some(a => a.sq === fromSq)) out.push({ sq: FILES[f] + (r + 1), type: p.type });
    }
  return out.sort((a, b) => (b.type === 'k') - (a.type === 'k') || VAL[b.type] - VAL[a.type]);
}
function phaseOf(fen, ply) {
  const pieces = fen.split(' ')[0];
  let npm = 0,
    queens = 0;
  for (const ch of pieces) {
    const t = ch.toLowerCase();
    if ('nbrq'.includes(t) && /[a-z]/i.test(ch)) npm += VAL[t];
    if (t === 'q') queens++;
  }
  if (npm <= 26 || (queens === 0 && npm <= 34)) return 'endgame';
  if (ply <= 20 && npm >= 54) return 'opening';
  return 'middlegame';
}
function lineText(fen, sans) {
  if (!sans || !sans.length) return '';
  let turn = fenTurn(fen),
    n = fenFull(fen);
  const out = [];
  sans.forEach((s, i) => {
    out.push(turn === 'w' ? `${n}. ${s}` : i === 0 ? `${n}... ${s}` : s);
    if (turn === 'b') n++;
    turn = other(turn);
  });
  return out.join(' ');
}
function moveText(fen, san) {
  return fenTurn(fen) === 'w' ? `${fenFull(fen)}. ${san}` : `${fenFull(fen)}... ${san}`;
}
function fmtEval(pos) {
  if (!pos) return '…';
  if (pos.over) return pos.c > 0 ? '1-0' : pos.c < 0 ? '0-1' : '½-½';
  if (pos.m != null) return (pos.m > 0 ? '+' : '−') + 'M' + Math.abs(pos.m);
  const v = pos.c / 100,
    a = Math.abs(v);
  return (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '') + (a >= 10 ? a.toFixed(0) : a.toFixed(1));
}
function evalWords(pos) {
  if (!pos) return 'unknown';
  if (pos.over) return pos.c === 0 ? 'drawn' : `game over, ${pos.c > 0 ? 'White' : 'Black'} has won`;
  if (pos.m != null) return `${pos.m > 0 ? 'White' : 'Black'} has a forced mate in ${Math.abs(pos.m)}`;
  const v = pos.c / 100,
    a = Math.abs(v),
    side = v > 0 ? 'White' : 'Black';
  if (a < 0.3) return `about equal (${fmtEval(pos)})`;
  if (a < 1) return `${side} slightly better (${fmtEval(pos)})`;
  if (a < 2.5) return `${side} clearly better (${fmtEval(pos)})`;
  return `${side} winning (${fmtEval(pos)})`;
}
function matWords(n) {
  n = Math.abs(n);
  if (n >= 9) return 'about a queen';
  if (n >= 5) return 'about a rook';
  if (n >= 3) return 'about a piece';
  if (n === 2) return 'two pawns';
  if (n === 1) return 'a pawn';
  return 'no material';
}
