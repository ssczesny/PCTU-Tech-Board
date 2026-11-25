/* ================= coach facts & prompts ================= */
const PERSONA = `You are Coach, a patient and sharp chess coach. Your student is rated about 800 and is working toward 1600. Speak plainly, like a strong club player teaching a friend. Use concrete squares and piece names, and name the idea or principle behind moves (development, center control, king safety, piece activity, forks, pins, skewers, discovered attacks, back-rank weakness, loose pieces, trading when ahead, and so on). Be encouraging and honest.
Accuracy rules: the engine data and board facts you are given are correct, but your own calculation is not reliable. Only state concrete tactics (captures, forks, mates, material won) that the engine lines or the facts support. If you go beyond them, stay general ("this leaves the knight loose") instead of inventing variations. Write moves in standard algebraic notation (Nf3, exd5, O-O). Never use em-dashes; use commas, periods or parentheses.`;

function gameContext(g) {
  const h = g.headers;
  const uc = g.userColor;
  const bits = [
    `${h.White || 'White'}${h.WhiteElo ? ` (${h.WhiteElo})` : ''} vs ${h.Black || 'Black'}${h.BlackElo ? ` (${h.BlackElo})` : ''}, result ${h.Result || '*'}${h.Termination ? ` (${h.Termination})` : ''}.`,
  ];
  if (openingName(h)) bits.push(`Opening: ${openingName(h)}.`);
  if (tcText(h)) bits.push(`Time control: ${tcText(h)}.`);
  bits.push(`The student played ${colorName(uc)}.`);
  return bits.join(' ');
}
function introLine(g) {
  const h = g.headers;
  const opp = g.userColor === 'w' ? h.Black || 'Black' : h.White || 'White';
  const res = resultFor(g.rec);
  const word = res === 'W' ? 'You won' : res === 'L' ? 'You lost' : res === 'D' ? 'You drew' : 'You played';
  return `${word} with ${g.userColor === 'w' ? 'White' : 'Black'} against ${opp}${openingName(h) ? ` in the ${openingName(h)}` : ''}${h.Termination ? ` (${h.Termination.replace(/^\w+ won by /, 'by ')})` : ''}.`;
}
function moveListUpTo(g, k) {
  const out = [];
  for (let i = 1; i <= k; i++) {
    const fen = g.fens[i - 1];
    const p = g.plies[i - 1];
    out.push(fenTurn(fen) === 'w' ? `${fenFull(fen)}. ${p.san}` : i === 1 ? `${fenFull(fen)}... ${p.san}` : p.san);
  }
  return out.join(' ');
}
function annotatedMoves(g) {
  const rows = [];
  for (let k = 1; k <= g.plies.length; k++) {
    const p = g.plies[k - 1],
      c = g.cls[k],
      a = g.pos[k - 1],
      b = g.pos[k];
    let row = `ply ${k}: ${moveText(g.fens[k - 1], p.san)} (${p.color === g.userColor ? 'student' : 'opponent'})`;
    if (c) row += ` ${KINDS[c.kind].label.toUpperCase()}, eval ${fmtEval(a)} to ${fmtEval(playedPos(a, b))}`;
    if (c && BAD.has(c.kind) && a && a.b) {
      const s = sanLine(g.fens[k - 1], a.b, 1)[0];
      if (s) row += `, best was ${s}`;
    }
    rows.push(row);
  }
  return rows.join('\n');
}
function describePieces(list) {
  return list.map(a => `${PNAME[a.type]} on ${a.sq}`).join(', ');
}
function moveFacts(g, k) {
  const p = g.plies[k - 1];
  const fenB = g.fens[k - 1],
    fenA = g.fens[k];
  const mover = p.color,
    opp = other(mover);
  const f = [];
  let what = `${colorName(mover)} moved the ${PNAME[p.piece]} from ${p.from} to ${p.to}`;
  if (p.flags.includes('k')) what = `${colorName(mover)} castled kingside`;
  else if (p.flags.includes('q')) what = `${colorName(mover)} castled queenside`;
  if (p.captured) what += `, capturing a ${PNAME[p.captured]}`;
  if (p.promotion) what += `, promoting to a ${PNAME[p.promotion]}`;
  if (p.san.includes('#')) what += ', delivering checkmate';
  else if (p.san.includes('+')) what += ', giving check';
  f.push(what + '.');
  const tg = targetsOf(fenA, p.to).filter(t => t.type !== 'p' || VAL[p.piece] <= 1);
  if (tg.length) f.push(`The ${PNAME[p.piece]} on ${p.to} now attacks: ${describePieces(tg)}.`);
  for (const l of loosePieces(fenA, mover).slice(0, 3))
    f.push(
      `After the move, ${colorName(mover)}'s ${PNAME[l.type]} on ${l.sq} is attacked by ${describePieces(l.attackers)} and ${l.defenders.length ? `defended by ${describePieces(l.defenders)}` : 'not defended at all'}.`,
    );
  for (const l of loosePieces(fenA, opp).slice(0, 2))
    f.push(
      `${colorName(opp)}'s ${PNAME[l.type]} on ${l.sq} is attacked by ${describePieces(l.attackers)} and ${l.defenders.length ? `defended by ${describePieces(l.defenders)}` : 'not defended'}.`,
    );
  const before = loosePieces(fenB, mover);
  if (before.length && !p.captured) {
    const saved = before.filter(l => l.sq === p.from);
    if (saved.length) f.push(`Before the move, this ${PNAME[p.piece]} on ${p.from} was itself under attack.`);
  }
  const m = material(fenA);
  f.push(`Material now: White ${m.w}, Black ${m.b} (pawn 1, knight or bishop 3, rook 5, queen 9).`);
  f.push(`Game phase: ${phaseOf(fenB, k)}.`);
  return f;
}
function engineFacts(g, k) {
  const p = g.plies[k - 1],
    c = g.cls[k],
    a = g.pos[k - 1],
    b = g.pos[k];
  const out = [];
  if (!a || !b || !c) return ['Engine data is not available for this move.'];
  const mover = p.color,
    s = mover === 'w' ? 1 : -1;
  out.push(
    `Engine verdict: ${KINDS[c.kind].label}. ${colorName(mover)}'s winning chances went from ${c.before.toFixed(0)}% to ${c.after.toFixed(0)}%. Evaluation before ${fmtEval(a)}, after ${fmtEval(playedPos(a, b))} (in pawns, + favors White).`,
  );
  const pp = playedPos(a, b);
  if (pp.m != null && Math.sign(pp.m) === -s)
    out.push(`After the played move, ${colorName(other(mover))} has a forced checkmate in ${Math.abs(pp.m)}.`);
  if (a.m != null && Math.sign(a.m) === s && c.kind !== 'best')
    out.push(`Before the move, ${colorName(mover)} had a forced checkmate in ${Math.abs(a.m)} and did not play it.`);
  if (a.b && c.kind !== 'best') {
    const bl = sanLine(g.fens[k - 1], a.p || a.b, 7);
    out.push(`Engine's best move instead: ${bl[0]}. Best line: ${lineText(g.fens[k - 1], bl)}.`);
    const sw = s * lineSwing(g.fens[k - 1], a.p, 5);
    if (sw >= 2) out.push(`That best line wins ${matWords(sw)} for ${colorName(mover)}.`);
  } else if (c.kind === 'best') out.push(`This was the engine's top choice.`);
  if (b.p) {
    const rl = sanLine(g.fens[k], b.p, 7);
    if (rl.length) out.push(`Best reply now for ${colorName(other(mover))}: ${rl[0]}. Line: ${lineText(g.fens[k], rl)}.`);
    const sw = -s * lineSwing(g.fens[k], b.p, 5);
    if (sw >= 2 && b.m == null) out.push(`That reply line wins ${matWords(sw)} for ${colorName(other(mover))}.`);
  }
  if (k >= 2 && g.cls[k - 1] && SERIOUS.has(g.cls[k - 1].kind))
    out.push(
      `Note: the previous move (${moveText(g.fens[k - 2], g.plies[k - 2].san)}) was a ${KINDS[g.cls[k - 1].kind].label.toLowerCase()}, so there was a chance to punish it.`,
    );
  if (k < g.plies.length && g.cls[k + 1])
    out.push(`What happened next in the game: ${moveText(g.fens[k], g.plies[k].san)}, graded ${KINDS[g.cls[k + 1].kind].label}.`);
  const sp = clockSpent(g, k);
  if (sp != null) out.push(`Time used on this move: ${fmtSpent(sp)}${p.clk != null ? `, with ${fmtClock(p.clk)} left on the clock` : ''}.`);
  return out;
}
function explainPrompt(g, k) {
  const p = g.plies[k - 1],
    c = g.cls[k];
  const mine = p.color === g.userColor;
  const kind = c ? c.kind : 'unknown';
  const len = !c ? '60 to 120 words' : BAD.has(kind) ? (kind === 'inaccuracy' ? '80 to 130 words' : '110 to 180 words') : '40 to 80 words';
  const who = mine ? `the student's own move` : `the opponent's move`;
  const focus = mine
    ? c && BAD.has(kind)
      ? 'Explain what the student was probably trying to do, why it does not work (cite the reply line), what the better move was and the idea behind it.'
      : 'Explain what the move accomplishes and why it is good; mention the idea the student should keep in mind for the next few moves.'
    : c && BAD.has(kind)
      ? "Explain what the opponent wanted, why it was an error, and exactly how the student could punish it (the engine's best reply)."
      : "Explain the idea behind the opponent's move and what the student should watch out for or respond with.";
  return `${PERSONA}

GAME: ${gameContext(g)}
MOVES SO FAR: ${moveListUpTo(g, k)}

MOVE TO EXPLAIN: ${moveText(g.fens[k - 1], p.san)}, ${who}.
Position before the move (FEN): ${g.fens[k - 1]}
Position after the move (FEN): ${g.fens[k]}

ENGINE (Stockfish):
- ${engineFacts(g, k).join('\n- ')}

BOARD FACTS:
- ${moveFacts(g, k).join('\n- ')}

TASK: ${focus}
Length: ${len}. Start directly with the explanation (no greeting, do not repeat the move header). Use one or two short paragraphs, optionally up to three short bullets. Finish with a separate line that starts with "**Takeaway:**" and gives one habit or principle the student can use in future games. Use **bold** sparingly. No headings.`;
}
function engineVerdict(g, k) {
  const p = g.plies[k - 1],
    c = g.cls[k],
    a = g.pos[k - 1],
    b = g.pos[k];
  if (!c) return '';
  const mover = p.color,
    s = mover === 'w' ? 1 : -1;
  const parts = [];
  if (c.kind === 'best') parts.push('The engine’s top choice.');
  else if (c.kind === 'excellent' || c.kind === 'good')
    parts.push(`${KINDS[c.kind].label} move. The engine slightly preferred ${sanLine(g.fens[k - 1], a.b, 1)[0] || 'another move'}.`);
  else {
    const best = a && a.b ? sanLine(g.fens[k - 1], a.b, 1)[0] : null;
    const pp = playedPos(a, b);
    if (b && b.p) {
      const rl = sanLine(g.fens[k], b.p, 1)[0];
      const sw = -s * lineSwing(g.fens[k], b.p, 5);
      const mate = pp && pp.m != null && Math.sign(pp.m) === -s;
      if (rl)
        parts.push(
          `After this, ${colorName(other(mover))}’s best reply is ${rl}${mate ? `, starting a forced checkmate in ${Math.abs(pp.m)}` : sw >= 2 ? `, winning ${matWords(sw)}` : ''}.`,
        );
    }
    if (best) parts.push(`Better was ${best}.`);
  }
  return parts.join(' ');
}
function coachTier(kind) {
  const s = App.profile.settings.coach;
  if (s === 'fast') return 'quick';
  if (s === 'thorough') return 'default';
  return BAD.has(kind) ? 'default' : 'quick';
}
function sampleErrorText(e) {
  switch (e && e.code) {
    case 'not_granted':
      return 'Claude is turned off for this page. Allow it from the artifact’s permissions to get coaching.';
    case 'sampling_disabled':
      return 'Claude isn’t available for this account, so coaching is off. Engine grades still work.';
    case 'rate_limited':
      return 'You’ve hit a usage limit for now. Wait a little, then try again.';
    case 'session_expired':
      return 'Your Claude session expired. Sign in again, then retry.';
    case 'refused':
      return 'The coach declined that request. Try asking it a different way.';
    case 'prompt_too_large':
      return 'That request was too long. Try a shorter question.';
    case 'empty_completion':
      return 'The coach returned nothing. Try again.';
    case 'tools_unavailable':
      return 'Engine checks from chat aren’t available here; ask again for an answer without them.';
    default:
      return 'The coach couldn’t answer just now. Try again in a moment.';
  }
}
