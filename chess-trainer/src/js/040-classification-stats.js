/* ================= classification & stats ================= */
function classify(g, k) {
  const a = g.pos[k - 1],
    b = g.pos[k];
  if (!a || !b) return null;
  const ply = g.plies[k - 1];
  const color = ply.color;
  const pp = playedPos(a, b);
  const before = winPct(povCp(a.c, color)),
    after = winPct(povCp(pp.c, color));
  const drop = Math.max(0, before - after);
  const uci = ply.from + ply.to + (ply.promotion || '');
  let kind;
  if (a.b && uci === a.b) kind = 'best';
  else if (drop < 2) kind = 'excellent';
  else if (drop < 6 || (k <= 12 && drop < 9)) kind = 'good';
  else if (drop < 12) kind = 'inaccuracy';
  else if (drop < 20) kind = 'mistake';
  else kind = 'blunder';
  // A miss: the opponent just erred and this move let the chance go without losing the game outright.
  if ((kind === 'mistake' || kind === 'blunder') && k >= 2 && after >= 40) {
    const prev = g.cls[k - 1];
    if (prev && SERIOUS.has(prev.kind)) kind = 'miss';
  }
  const acc = clamp(103.1668 * Math.exp(-0.04354 * drop) - 3.1669, 0, 100);
  return { kind, drop, before, after, acc, uci };
}
function computeCls(g) {
  g.cls = [null];
  for (let k = 1; k <= g.plies.length; k++) g.cls[k] = classify(g, k);
  // Anything drawn from the grades (board strips, move list, linked text) is keyed on this version.
  g.ver = (g.ver || 0) + 1;
  g.figCache = null;
  return g.cls;
}
/* Blend of mean and harmonic mean, so one game-losing blunder weighs more than many routine moves. */
function accuracyOf(g, color) {
  const xs = [];
  for (let k = 1; k <= g.plies.length; k++) if (g.plies[k - 1].color === color && g.cls[k]) xs.push(g.cls[k].acc);
  if (!xs.length) return null;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const harm = xs.length / xs.reduce((s, x) => s + 1 / Math.max(10, x), 0);
  return (mean + harm) / 2;
}
function clockSpent(g, k) {
  const p = g.plies[k - 1];
  if (p.clk == null) return null;
  const tc = timeControl(g.headers);
  const inc = tc ? tc.inc : 0;
  for (let j = k - 2; j >= 1; j -= 2) {
    const q = g.plies[j - 1];
    if (q && q.clk != null) return Math.max(0, q.clk - p.clk + inc);
  }
  return tc ? Math.max(0, tc.base - p.clk + inc) : null;
}
function clockAt(g, k, color) {
  for (let j = k; j >= 1; j--) {
    const p = g.plies[j - 1];
    if (p.color === color && p.clk != null) return p.clk;
  }
  const tc = timeControl(g.headers);
  return tc ? tc.base : null;
}
function mistakeTags(g, k) {
  const c = g.cls[k];
  if (!c || !SERIOUS.has(c.kind)) return [];
  const tags = [];
  const ply = g.plies[k - 1];
  const s = ply.color === 'w' ? 1 : -1;
  const a = g.pos[k - 1],
    b = g.pos[k];
  if (b && b.p && s * lineSwing(g.fens[k], b.p, 4) <= -2) tags.push('hung');
  if (a && a.p && s * lineSwing(g.fens[k - 1], a.p, 5) >= 2) tags.push('tactic');
  if (c.kind === 'miss') tags.push('missed');
  const tc = timeControl(g.headers);
  if (ply.clk != null && tc && (ply.clk < 30 || ply.clk < tc.base * 0.08)) tags.push('time');
  else {
    const sp = clockSpent(g, k);
    if (sp != null && sp < 3 && tc && tc.base >= 180) tags.push('rushed');
  }
  return tags;
}
function computeStats(g) {
  const uc = g.userColor;
  const counts = { inaccuracy: 0, mistake: 0, blunder: 0, miss: 0 };
  const phases = { opening: 0, middlegame: 0, endgame: 0 };
  const tags = { hung: 0, tactic: 0, missed: 0, time: 0, rushed: 0 };
  let userMoves = 0;
  for (let k = 1; k <= g.plies.length; k++) {
    if (g.plies[k - 1].color !== uc) continue;
    userMoves++;
    const c = g.cls[k];
    if (!c) continue;
    if (counts[c.kind] != null) counts[c.kind]++;
    if (SERIOUS.has(c.kind)) {
      phases[phaseOf(g.fens[k - 1], k)]++;
      for (const t of mistakeTags(g, k)) tags[t]++;
    }
  }
  return {
    acc: accuracyOf(g, uc),
    oppAcc: accuracyOf(g, other(uc)),
    counts,
    phases,
    tags,
    userMoves,
    plies: g.plies.length,
    drills: drillsOf(g),
    at: Date.now(),
  };
}
/* The student's mistakes in a game, as self-contained puzzle seeds. Saved with the stats so the Train tab can
   list them without re-reading the game. */
function drillsOf(g) {
  const out = [];
  for (let k = 1; k <= g.plies.length; k++) {
    const c = g.cls[k],
      p = g.plies[k - 1],
      a = g.pos[k - 1];
    if (!c || p.color !== g.userColor || !SERIOUS.has(c.kind) || !a || !a.b) continue;
    const prev = k >= 2 ? g.plies[k - 2] : null;
    out.push({
      k,
      kind: c.kind,
      drop: Math.round(c.drop * 10) / 10,
      fen: g.fens[k - 1],
      san: p.san,
      last: prev ? prev.from + prev.to : null,
      best: a.b,
    });
  }
  return out;
}
