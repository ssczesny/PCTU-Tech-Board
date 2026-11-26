/* ================= chat ================= */
function chatRules(g) {
  return `${PERSONA}

You are chatting with the student while they review one of their games on an interactive board. Each student message comes with the position currently on their board and fresh engine data. Answer the question directly first, then explain the idea in plain words. Keep answers under about 170 words unless the student asks for more. When you compare moves, translate engine numbers into plain words ("about a pawn better for White").${
    App.toolsOk
      ? `
Tools: engine_eval checks any move or short line (from the current position, or as an alternative to the last move); top_moves lists Stockfish's top choices; draw_on_board puts arrows and square highlights on the student's board (use it when pointing at a plan, a threat or a tactic, it helps them see it); go_to_move jumps the board to a move of the game. Check concrete lines with engine_eval before you claim them, and do not call tools you do not need.`
      : ''
  }

GAME: ${gameContext(g)}
FULL GAME WITH ENGINE GRADES:
${annotatedMoves(g)}`;
}
function positionContext() {
  const g = App.game,
    v = App.view;
  const fen = curFen();
  const lines = [];
  if (v.explore) {
    const ex = v.explore;
    lines.push(
      `BOARD NOW: the student is exploring a side line that was NOT played in the game, starting ${ex.basePly ? 'after ' + moveText(g.fens[ex.basePly - 1], g.plies[ex.basePly - 1].san) : 'from the start'}: ${lineText(
        ex.fens[0],
        ex.moves.map(m => m.san),
      )}.`,
    );
    const pos = ex.evals[ex.evals.length - 1];
    if (pos) {
      lines.push(`Engine on this position: ${evalWords(pos)}.`);
      if (pos.b) lines.push(`Engine's best move here: ${lineText(fen, sanLine(fen, pos.p || pos.b, 5))}.`);
    }
    if (ex.basePly < g.plies.length)
      lines.push(
        `In the game, ${moveText(g.fens[ex.basePly], g.plies[ex.basePly].san)} was played instead (${g.cls[ex.basePly + 1] ? KINDS[g.cls[ex.basePly + 1].kind].label : 'ungraded'}, eval after ${fmtEval(g.pos[ex.basePly + 1])}).`,
      );
  } else if (v.ply === 0) {
    lines.push('BOARD NOW: the starting position, before the first move.');
  } else {
    const k = v.ply,
      p = g.plies[k - 1],
      c = g.cls[k];
    lines.push(
      `BOARD NOW: after ply ${k}, ${moveText(g.fens[k - 1], p.san)} (${p.color === g.userColor ? "the student's move" : "the opponent's move"}). ${colorName(fenTurn(fen))} to move.`,
    );
    if (c) lines.push(...engineFacts(g, k));
    lines.push(...moveFacts(g, k).slice(0, 5));
  }
  lines.push(`FEN now: ${fen}`);
  if (!v.explore && v.ply > 0) lines.push(`FEN before the last move: ${g.fens[v.ply - 1]}`);
  return lines.join('\n');
}
async function precheckMoves(text) {
  const g = App.game,
    v = App.view;
  const now = curFen();
  const before = !v.explore && v.ply > 0 ? g.fens[v.ply - 1] : null;
  const seen = new Set();
  const found = [];
  const re = /\b(O-O(?:-O)?|0-0(?:-0)?|[KQRBNkqrbn][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8])\b/g;
  let m;
  while ((m = re.exec(text)) && found.length < 3) {
    const tok = m[1];
    if (seen.has(tok)) continue;
    seen.add(tok);
    let mv = legalSan(now, tok),
      from = 'now';
    if (!mv && before) {
      mv = legalSan(before, tok);
      from = 'before';
    }
    if (mv) found.push({ mv, from });
  }
  if (!found.length || Engine.failed) return '';
  const rows = [];
  for (const f of found) {
    const base = f.from === 'now' ? now : before;
    const after = fenAfter(base, f.mv);
    if (!after) continue;
    const c = { fen: () => after };
    try {
      const r = await evalFen(after, { priority: 6, depth: 12, movetime: 1200 });
      const cont = sanLine(after, r.pos.p, 4);
      const same = f.from === 'before' && f.mv.san === g.plies[v.ply - 1].san;
      let row = `${f.mv.san} ${same ? '(this is the move played in the game)' : f.from === 'before' ? `(as an alternative to the game move ${g.plies[v.ply - 1].san}, from the position before it)` : '(from the current position)'}: eval after it ${fmtEval(r.pos)}${cont.length ? `; engine continues ${lineText(c.fen(), cont)}` : ''}.`;
      if (f.from === 'before' && !same && g.pos[v.ply - 1])
        row += ` For comparison, the game move led to ${fmtEval(playedPos(g.pos[v.ply - 1], g.pos[v.ply]))}.`;
      rows.push(row);
    } catch {}
  }
  return rows.length ? `ENGINE CHECK OF MOVES THE STUDENT MENTIONED:\n- ${rows.join('\n- ')}` : '';
}
function chatTools(ctx) {
  const g = ctx.g;
  const baseFen = from => (from === 'before_last_move' && ctx.before ? ctx.before : ctx.now);
  return [
    {
      name: 'engine_eval',
      description:
        'Check a move or a short line with Stockfish. Starts from the position on the student\'s board (from="now", default) or from the position before the last game move (from="before_last_move", to test alternatives to what was played). Returns legality, the evaluation after the moves (pawns, + favors White), the engine\'s best continuation in SAN and the material change.',
      inputSchema: {
        type: 'object',
        properties: {
          moves: { type: 'array', items: { type: 'string' }, description: 'SAN moves in order, e.g. ["Nf3"] or ["Bxf7+", "Kxf7", "Ng5+"]' },
          from: { type: 'string', enum: ['now', 'before_last_move'] },
        },
        required: ['moves'],
      },
      async execute(input, context) {
        const fen0 = baseFen(String(input.from || 'now'));
        const moves = Array.isArray(input.moves) ? input.moves.map(String).slice(0, 12) : [String(input.moves || '')];
        const c = new Chess(fen0);
        const played = [];
        for (const s of moves) {
          const m = legalSan(c.fen(), s);
          if (!m) throw new Error(`"${s}" is not legal there. Legal moves: ${c.moves().slice(0, 40).join(', ')}`);
          c.move(m.san);
          played.push(m.san);
        }
        ctx.status(`Checking ${played.join(' ')} with Stockfish…`);
        const r = await evalFen(c.fen(), { priority: 6, depth: 13, movetime: 1600 });
        if (context.signal.aborted) return 'cancelled';
        const cont = sanLine(c.fen(), r.pos.p, 6);
        const m0 = material(fen0),
          m1 = material(c.fen());
        return {
          line: lineText(fen0, played),
          evalAfter: fmtEval(r.pos),
          meaning: evalWords(r.pos),
          bestContinuation: lineText(c.fen(), cont),
          materialChangeWhiteMinusBlack: m1.w - m1.b - (m0.w - m0.b),
          fenAfter: c.fen(),
        };
      },
    },
    {
      name: 'top_moves',
      description:
        'Stockfish\'s top 3 moves for the side to move, with evaluations and short lines. from="now" (default) uses the student\'s board; from="before_last_move" uses the position before the last game move.',
      inputSchema: { type: 'object', properties: { from: { type: 'string', enum: ['now', 'before_last_move'] } } },
      async execute(input, context) {
        const fen = baseFen(String(input.from || 'now'));
        ctx.status('Asking Stockfish for its top moves…');
        const r = await evalFen(fen, { priority: 6, depth: 13, movetime: 2500, multipv: 3 });
        if (context.signal.aborted) return 'cancelled';
        if (!r.lines.length) return { note: 'No legal moves: the game is over in this position.' };
        return r.lines.map(L => ({ move: sanLine(fen, L.p, 1)[0], eval: fmtEval(L), line: lineText(fen, sanLine(fen, L.p, 6)) }));
      },
    },
    {
      name: 'draw_on_board',
      description:
        'Draw arrows and highlight squares on the student\'s board so they can see what you mean. Replaces your previous drawing. Squares are like "e4". Returns "shown" when drawn.',
      inputSchema: {
        type: 'object',
        properties: {
          arrows: {
            type: 'array',
            items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
          },
          squares: { type: 'array', items: { type: 'string' } },
        },
      },
      execute(input) {
        const ok = s => /^[a-h][1-8]$/.test(String(s));
        if (App.game !== g || curFen() !== ctx.now) return 'The student has moved the board to another position, so nothing was drawn.';
        App.coachArrows = (input.arrows || [])
          .filter(a => a && ok(a.from) && ok(a.to))
          .slice(0, 6)
          .map(a => ({ from: String(a.from), to: String(a.to) }));
        App.coachSquares = (input.squares || []).filter(ok).slice(0, 8).map(String);
        renderDecor();
        // Keep the drawing with the reply as a small board, so it is still there after the student moves on.
        if (App.coachArrows.length || App.coachSquares.length) {
          ctx.figs.push({
            fen: ctx.now,
            arrows: App.coachArrows.slice(),
            squares: App.coachSquares.slice(),
            ply: ctx.bases[0].ply,
            pre: ctx.bases[0].pre,
          });
          if (ctx.figs.length > 3) ctx.figs.shift();
        }
        return 'shown';
      },
    },
    {
      name: 'go_to_move',
      description:
        "Move the student's board to the position right after a ply of the game (1 = after White's first move, 2 = after Black's first move, and so on; 0 = start). Returns that move and its engine grade. Later tool calls then use that position.",
      inputSchema: { type: 'object', properties: { ply: { type: 'integer' } }, required: ['ply'] },
      execute(input) {
        if (App.game !== g) return 'The student has opened a different game, so the board was left alone.';
        const k = clamp(Math.round(Number(input.ply) || 0), 0, g.plies.length);
        go(k);
        ctx.now = g.fens[k];
        ctx.before = k > 0 ? g.fens[k - 1] : null;
        ctx.bases.unshift({ fen: g.fens[k], ply: k, pre: [] });
        if (k > 0) ctx.bases.splice(1, 0, { fen: g.fens[k - 1], ply: k - 1, pre: [] });
        if (k === 0) return { position: 'start' };
        const c = g.cls[k];
        return { move: moveText(g.fens[k - 1], g.plies[k - 1].san), grade: c ? KINDS[c.kind].label : 'not graded yet', evalAfter: fmtEval(g.pos[k]) };
      },
    },
  ];
}
function renderChat() {
  const g = App.game;
  const log = $('#chat-log');
  if (!g) return;
  log.innerHTML = '';
  if (!g.chat.length && !g.chatBusy) {
    log.append(
      el(
        'div',
        { class: 'chat-empty' },
        App.sample && !App.sampleOff
          ? 'Ask anything about this game: why a move was a mistake, what your opponent was threatening, what plan to follow, or why one move beats another. The coach can check lines with Stockfish and draw on your board.'
          : App.sampleReady || App.sampleOff
            ? 'Chat with the coach needs Claude, which isn’t available in this view. Engine grades, arrows and drills still work.'
            : 'Connecting to the coach…',
      ),
    );
  }
  for (const m of g.chat) log.append(chatMsgEl(m));
  if (g.chatBusy) log.append(g.chatBusy.el);
  const form = $('#chat-form');
  const off = !App.sample || !!App.sampleOff;
  $('#chat-input').disabled = off;
  $('#chat-send').disabled = off || !!g.chatBusy;
  form.hidden = false;
}
function chatMsgEl(m) {
  if (m.role === 'user') {
    const at = el('span', {
      class: 'at',
      text: m.label || 'start',
      title: 'Go to this position',
      onclick: () => {
        if (m.ply != null) go(m.ply);
      },
    });
    return el('div', { class: 'msg user' }, at, el('span', { text: m.text }));
  }
  return el(
    'div',
    { class: 'msg bot' },
    el('div', { class: 'prose', html: chatBodyHTML(m) }),
    m.error ? el('div', { class: 'err', text: m.error }) : null,
  );
}
/* A reply's text with linked notation, a strip of boards under each paragraph that walks a line, and any
   drawings the coach made. Cached per message, since the whole log is redrawn on every exchange. */
const CHAT_HTML = new WeakMap();
function chatBases(m) {
  const g = App.game;
  if (Array.isArray(m.ctx) && m.ctx.length) return m.ctx.filter(b => b && b.fen);
  // Replies saved before boards existed only kept the positions.
  return (m.fens || []).map(fen => {
    const i = g ? g.fens.indexOf(fen) : -1;
    return { fen, ply: i >= 0 ? i : null, pre: [] };
  });
}
function chatBodyHTML(m) {
  const orient = App.view.orient;
  const hit = CHAT_HTML.get(m);
  if (hit && hit.orient === orient) return hit.html;
  const tmp = document.createElement('div');
  tmp.innerHTML = md(m.text || '');
  linkMoves(tmp, chatBases(m), { figs: true, orient, maxFigs: 8 });
  let html = tmp.innerHTML;
  if (Array.isArray(m.figs) && m.figs.length)
    html += figsHTML(
      m.figs
        .filter(f => f && f.fen)
        .map(f => ({
          fen: f.fen,
          orient,
          arrows: (f.arrows || []).map(a => ({ from: a.from, to: a.to, tone: 'coach' })),
          squares: f.squares || [],
          tag: 'Coach’s drawing',
          cap: '',
          go: f.ply != null ? { ply: f.ply, line: f.pre || [] } : null,
        })),
    );
  CHAT_HTML.set(m, { orient, html });
  return html;
}
function renderSuggestions() {
  const box = $('#chat-suggest');
  box.innerHTML = '';
  const g = App.game,
    v = App.view;
  if (!g || !App.sample || App.sampleOff || g.chatBusy) return;
  const s = [];
  if (v.explore) s.push('Why is this line better than the game?', 'What is the plan in this line?');
  else if (v.ply > 0) {
    const p = g.plies[v.ply - 1],
      c = g.cls[v.ply];
    const mine = p.color === g.userColor;
    if (mine && c && BAD.has(c.kind)) {
      s.push(`Why was ${p.san} a ${KINDS[c.kind].label.toLowerCase()}?`, 'What should I have played?', 'How do I spot this next time?');
    } else if (!mine && c && BAD.has(c.kind)) s.push(`How do I punish ${p.san}?`);
    else s.push(`What is the idea behind ${p.san}?`);
    s.push(mine ? 'What is my opponent threatening now?' : 'What should I play here?', 'What’s the plan from here?');
  } else s.push('What should I aim for in this opening?');
  for (const q of s.slice(0, 4)) box.append(el('button', { class: 'sugg', type: 'button', onclick: () => askChat(q), text: q }));
}
async function askChat(text) {
  text = String(text || '').trim();
  const g = App.game;
  if (!text || !g || !App.sample || App.sampleOff || g.chatBusy) return;
  if (App.tab !== 'review') switchTab('review');
  if (App.pane !== 'coach') switchPane('coach');
  const v = App.view;
  const fenNow = curFen();
  const before = !v.explore && v.ply > 0 ? g.fens[v.ply - 1] : null;
  const label = v.explore
    ? `side line: ${lineText(
        v.explore.fens[0],
        v.explore.moves.map(m => m.san),
      )}`
    : v.ply
      ? `at ${moveText(g.fens[v.ply - 1], g.plies[v.ply - 1].san)}`
      : 'at the start';
  const um = { role: 'user', text, label, ply: v.explore ? v.explore.basePly : v.ply, at: Date.now() };
  g.chat.push(um);
  const ctl = new AbortController();
  const tooling = el(
    'div',
    { class: 'tooling' },
    el('span', { class: 'spinner' }),
    el('span', { text: 'Checking the position…' }),
    el('button', { class: 'btn small quiet', type: 'button', onclick: () => ctl.abort(), text: 'Stop' }),
  );
  const body = el('div', { class: 'prose' });
  g.chatBusy = { g, ctl, el: el('div', { class: 'msg bot' }, tooling, body) };
  $('#chat-input').value = '';
  autosize();
  if (coarsePointer()) $('#chat-input').blur(); // put the on-screen keyboard away so the answer is visible
  renderChat();
  renderSuggestions();
  ChatPin.on = true;
  pinChat(true);
  const exSans = v.explore ? v.explore.moves.map(m => m.san) : [];
  const ctx = {
    g,
    now: fenNow,
    before,
    // Where the notation in the reply can be played from: the board now, then the position before the last move.
    bases: [{ fen: fenNow, ply: v.explore ? v.explore.basePly : v.ply, pre: exSans }].concat(
      before ? [{ fen: before, ply: v.ply - 1, pre: [] }] : [],
    ),
    figs: [],
    status: t => {
      tooling.hidden = false;
      tooling.children[1].textContent = t;
    },
  };
  let final = null,
    err = null;
  try {
    const where = positionContext(); // captured now: the student may step on while the engine checks run
    const checks = await precheckMoves(text);
    ctx.status('The coach is thinking…');
    const history = g.chat
      .slice(0, -1)
      .filter(m => m.text && m.text.trim())
      .slice(-10)
      .map(m => ({ role: m.role, content: m.role === 'user' ? `[asked ${m.label}] ${m.text}` : m.text }));
    const turns = [
      { role: 'user', content: chatRules(g) },
      ...history,
      { role: 'user', content: `${where}${checks ? '\n' + checks : ''}\n\nSTUDENT'S QUESTION: ${text}` },
    ];
    const opts = {
      signal: ctl.signal,
      cache: false,
      onText: ({ text: t }) => {
        tooling.hidden = true;
        body.innerHTML = md(t);
        if (App.game === g) pinChat();
      },
    };
    if (App.toolsOk) opts.tools = chatTools(ctx);
    const res = await App.sample(turns, opts);
    App.consented = true;
    final = res.text;
  } catch (e) {
    if (e && OFF_CODES.has(e.code)) App.sampleOff = e.code;
    if (e && e.code === 'tools_unavailable') App.toolsOk = false;
    final = e && e.text && e.code !== 'refused' ? e.text : null;
    err = e && e.code === 'cancelled' ? (final ? 'Stopped.' : null) : sampleErrorText(e);
  }
  g.chatBusy = null;
  if (final)
    g.chat.push({
      role: 'assistant',
      text: noDash(final),
      ctx: ctx.bases.slice(0, 4),
      figs: ctx.figs.length ? ctx.figs : undefined,
      error: err || undefined,
      at: Date.now(),
    });
  else if (err) g.chat.push({ role: 'assistant', text: '', fens: [], error: err, at: Date.now() });
  else g.chat.pop();
  while (g.chat.length > 40) g.chat.shift();
  saveGame(g, { chat: g.chat.filter(m => m.text || m.role === 'user') });
  if (App.game === g) {
    renderChat();
    renderSuggestions();
    pinChat();
    ChatPin.on = false;
    if (App.sampleOff) renderCoachBody();
  }
}
/* While an answer is being written, keep the question at the top of the coach column so the answer can be
   read from its first line as it grows. Scrolling by hand releases the pin. On narrow screens the page
   scrolls instead, and the question sits just under the pinned board. */
const ChatPin = { on: false };
function pinChat() {
  if (!ChatPin.on) return;
  const qs = $$('#chat-log .msg.user');
  const q = qs[qs.length - 1];
  if (!q) return;
  const sc = $('#coach-scroll');
  if (sc.scrollHeight > sc.clientHeight + 1) sc.scrollTop += q.getBoundingClientRect().top - sc.getBoundingClientRect().top - 6;
  else if (ONE_COL.matches) q.scrollIntoView({ block: 'start' }); // lands below the board: see scroll-margin-top
}
function autosize() {
  const t = $('#chat-input');
  t.style.height = 'auto';
  t.style.height = Math.min(140, t.scrollHeight + 2) + 'px';
}
