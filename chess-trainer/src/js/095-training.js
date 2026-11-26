/* ================= training ================= */
/* Puzzles were generated from engine play with human-style mistakes and verified with Stockfish: one clearly best move at each step. */
const THEMES = {
  mine: { name: 'From your games', stage: 0, blurb: 'Positions where you went wrong. Find what you missed.' },
  hanging: { name: 'Free pieces', stage: 1, blurb: 'Something was left unprotected. Take it, after checking it really is free.' },
  defend: { name: 'Spot the threat', stage: 1, blurb: 'Your opponent is threatening something. Find the one move that holds.' },
  mate: { name: 'Checkmate', stage: 1, blurb: 'There is a forced mate. Checks first.' },
  backrank: { name: 'Back-rank mates', stage: 1, blurb: 'A king trapped behind its own pawns.' },
  fork: { name: 'Forks', stage: 2, blurb: 'One piece attacks two things at once.' },
  pin: { name: 'Pins', stage: 2, blurb: 'A piece can’t move without exposing something bigger behind it.' },
  skewer: { name: 'Skewers', stage: 2, blurb: 'Attack the big piece; win the one behind it.' },
  discovered: { name: 'Discovered attacks', stage: 2, blurb: 'Move one piece to unleash another.' },
  material: { name: 'Win material', stage: 2, blurb: 'A short forcing sequence that wins material.' },
  attack: { name: 'King attacks', stage: 3, blurb: 'Forcing moves against an exposed king.' },
  smothered: { name: 'Smothered mates', stage: 3, blurb: 'A knight mates a king boxed in by its own pieces.' },
  trap: { name: 'Opening traps', stage: 3, blurb: 'Famous traps to spring, and to avoid falling into.' },
  endgame: { name: 'Endgame technique', stage: 1, blurb: 'Play it out against Stockfish.' },
};
const STAGE_BAND = ['', '800 → 1000', '1000 → 1200', '1200 → 1400', '1400 → 1600'];
const BOX_DAYS = [1, 3, 7, 14, 30, 60];

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}
function training() {
  const p = App.profile;
  if (!p.training) p.training = {};
  const t = p.training;
  t.items = t.items || {};
  t.days = t.days || {};
  t.goal = t.goal || 10;
  if (t.rating === undefined) t.rating = null;
  return t;
}
function latestElo() {
  const recs = App.library.slice().sort((a, b) => (gameDate(b.headers) || '').localeCompare(gameDate(a.headers) || ''));
  for (const r of recs) {
    const e = userElo(r);
    if (e) return e;
  }
  return null;
}
function puzzleRating() {
  const t = training();
  return t.rating != null ? t.rating : clamp(latestElo() || 800, 600, 1800);
}
function currentStage() {
  return clamp(Math.floor(((latestElo() || puzzleRating()) - 800) / 200) + 1, 1, 4);
}
function streak() {
  const t = training();
  let d = localDay();
  if (!(t.days[d] && t.days[d].done)) d = addDays(d, -1);
  let n = 0;
  while (t.days[d] && t.days[d].done) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}
function todayDone() {
  const d = training().days[localDay()];
  return d ? d.done : 0;
}

function puzzleItem(p) {
  return { id: 'p:' + p.i, kind: 'puzzle', fen: p.f, last: p.l || null, line: p.s, theme: p.t, rating: p.r };
}
function lessonItem(x) {
  return {
    id: x.id,
    kind: x.kind === 'endgame' ? 'endgame' : 'lesson',
    fen: x.fen,
    last: null,
    line: x.line || [],
    theme: x.theme,
    rating: x.rating,
    title: x.title,
    idea: x.idea,
    goal: x.goal,
    limit: x.limit,
    stage: x.stage,
  };
}
/* A drill from one of the student's games. The game itself (item.g) is only read when the drill is opened. */
function gameItem(d) {
  return {
    id: `g:${d.rec.id}:${d.k}`,
    kind: 'game',
    fen: d.fen,
    last: d.last,
    line: [d.best],
    theme: 'mine',
    rec: d.rec,
    get g() {
      return runtimeFor(d.rec);
    },
    k: d.k,
    san: d.san,
    gradeKind: d.kind,
    rating: null,
  };
}
/* A game graded before drill summaries were saved has to be replayed once to find its mistakes. The result is
   written back, so it is paid once and not on every visit. */
function ensureDrills(rec, quiet) {
  if (rec.stats && Array.isArray(rec.stats.drills)) return rec.stats.drills;
  let list = [];
  try {
    list = drillsOf(buildRuntime(rec));
  } catch {}
  if (!rec.stats) return list;
  rec.stats.drills = list;
  if (!quiet && !rec.example) Store.patchGame(rec.id, { stats: rec.stats }).catch(() => {});
  return list;
}
/* After loading the library: do that replaying a game at a time while the browser is idle, so opening Train
   never has to do all of it at once. The lists are saved afterwards, one game at a time. */
let backfilling = false;
const drillSaves = [];
let drillSaving = false;
async function saveDrillLists() {
  if (drillSaving) return;
  drillSaving = true;
  while (drillSaves.length) {
    const rec = drillSaves.shift();
    if (!App.library.includes(rec)) continue;
    try {
      await Store.patchGame(rec.id, { stats: rec.stats });
    } catch {
      drillSaves.length = 0; // storage is refusing writes; the lists stay in memory for this visit
    }
  }
  drillSaving = false;
}
async function backfillDrills() {
  if (backfilling) return;
  const todo = App.library.filter(r => r.analysis && r.analysis.complete && r.stats && !Array.isArray(r.stats.drills) && !r.broken);
  if (!todo.length) return;
  backfilling = true;
  while (todo.length) {
    await new Promise(res => whenIdle(res));
    const t0 = performance.now();
    while (todo.length && performance.now() - t0 < 10) {
      const rec = todo.pop();
      if (!App.library.includes(rec) || Array.isArray(rec.stats.drills)) continue;
      ensureDrills(rec, true);
      drillSaves.push(rec);
    }
    saveDrillLists();
  }
  backfilling = false;
  refreshDrillCount();
  if (App.tab === 'drills' && !Train.ex) renderTrain();
}
function collectDrills() {
  const out = [];
  const t0 = performance.now();
  let later = false;
  const recs = App.library.length ? App.library : [App.exampleRec];
  for (const rec of recs) {
    if (!rec || !rec.analysis || !rec.analysis.complete || rec.broken) continue;
    if (!(rec.stats && Array.isArray(rec.stats.drills)) && (backfilling || performance.now() - t0 > 40)) {
      later = true; // a big older library: the background pass fills these in and Train redraws itself
      continue;
    }
    const list = ensureDrills(rec);
    for (const d of list) out.push({ rec, k: d.k, kind: d.kind, drop: d.drop, fen: d.fen, san: d.san, last: d.last, best: d.best });
  }
  if (later) backfillDrills();
  return out.sort((a, b) => b.drop - a.drop);
}
function allItems() {
  const m = new Map();
  for (const p of PUZZLES) {
    const it = puzzleItem(p);
    m.set(it.id, it);
  }
  for (const x of LESSONS) {
    const it = lessonItem(x);
    m.set(it.id, it);
  }
  for (const d of collectDrills()) {
    const it = gameItem(d);
    m.set(it.id, it);
  }
  return m;
}
function themeStats() {
  const t = training();
  const items = allItems();
  const out = {};
  for (const [id, st] of Object.entries(t.items)) {
    const it = items.get(id);
    if (!it) continue;
    const s = out[it.theme] || (out[it.theme] = { seen: 0, first: 0, tries: 0 });
    s.seen++;
    s.tries += st.tries || 0;
    s.first += st.firstOk ? 1 : 0;
  }
  return out;
}
function weakThemes() {
  const tags = { hung: 0, tactic: 0, missed: 0 };
  for (const r of App.library) if (r.stats && r.stats.tags) for (const k in tags) tags[k] += r.stats.tags[k] || 0;
  const out = new Set();
  if (tags.hung) out.add('defend').add('hanging');
  if (tags.tactic) ['fork', 'pin', 'skewer', 'discovered', 'material'].forEach(x => out.add(x));
  if (tags.missed) out.add('hanging').add('material');
  for (const [th, s] of Object.entries(themeStats())) if (s.seen >= 3 && s.first / s.seen < 0.6) out.add(th);
  return [...out];
}
function dueCount() {
  const t = training();
  const day = localDay();
  const items = allItems();
  let n = 0;
  for (const [id, st] of Object.entries(t.items)) if (st.due <= day && items.has(id) && items.get(id).kind !== 'endgame' && !st.mastered) n++;
  return n;
}
function refreshDrillCount() {
  const left = Math.max(0, training().goal - todayDone());
  $('#drill-count').textContent = left ? String(left) : '';
}

/* Record one attempt: Leitner box scheduling, the puzzle rating, and the day's tally. */
function recordResult(item, firstTry) {
  const t = training();
  const day = localDay();
  const st = t.items[item.id] || (t.items[item.id] = { box: 0, due: day, tries: 0, ok: 0 });
  st.tries++;
  st.last = Date.now();
  if (st.tries === 1) st.firstOk = !!firstTry;
  if (firstTry) {
    st.ok++;
    st.box = Math.min(BOX_DAYS.length - 1, (st.box || 0) + 1);
    st.due = addDays(day, BOX_DAYS[st.box]);
    if (st.box >= 4) st.mastered = true;
  } else {
    st.box = 0;
    st.due = addDays(day, 1);
    st.mastered = false;
  }
  let delta = 0;
  if (item.rating && (item.kind === 'puzzle' || item.kind === 'lesson')) {
    const r = puzzleRating();
    const n = Object.keys(t.items).length;
    const expect = 1 / (1 + Math.pow(10, (item.rating - r) / 400));
    const K = n < 25 ? 40 : 24;
    delta = Math.round(K * ((firstTry ? 1 : 0) - expect));
    t.rating = clamp(r + delta, 400, 2400);
  }
  const d = t.days[day] || (t.days[day] = { done: 0, ok: 0 });
  d.done++;
  if (firstTry) d.ok++;
  for (const k of Object.keys(t.days)) if (k < addDays(day, -120)) delete t.days[k];
  if (item.kind === 'game') {
    const g = item.g;
    const e = { tries: st.tries, solved: firstTry || !!(g.drills[item.k] && g.drills[item.k].solved), at: Date.now() };
    g.drills[item.k] = e;
    saveGame(g, { drills: { [item.k]: e } });
  }
  saveProfile();
  refreshDrillCount();
  return delta;
}

const Train = { mode: 'today', session: null, list: null, ex: null };
function buildSession(size) {
  const t = training();
  const day = localDay();
  const items = allItems();
  const r = puzzleRating();
  const stage = currentStage();
  const used = new Set();
  const take = (arr, n) => {
    const out = [];
    for (const it of arr) {
      if (out.length >= n) break;
      if (used.has(it.id)) continue;
      used.add(it.id);
      out.push(it);
    }
    return out;
  };
  const all = [...items.values()];
  const due = all
    .filter(it => it.kind !== 'endgame' && t.items[it.id] && t.items[it.id].due <= day && !t.items[it.id].mastered)
    .sort((a, b) => t.items[a.id].due.localeCompare(t.items[b.id].due));
  const mine = all.filter(it => it.kind === 'game' && !t.items[it.id]);
  const weak = weakThemes();
  const fresh = all
    .filter(it => it.kind === 'puzzle' && !t.items[it.id])
    .map(it => ({ it, s: Math.abs(it.rating - r) - (weak.includes(it.theme) ? 150 : 0) + Math.random() * 160 }))
    .sort((a, b) => a.s - b.s)
    .map(x => x.it);
  const lessons = all
    .filter(it => (it.kind === 'lesson' || it.kind === 'endgame') && !(t.items[it.id] && t.items[it.id].ok) && it.stage <= stage + 1)
    .sort((a, b) => a.stage - b.stage || a.rating - b.rating);
  const a = take(due, Math.min(4, Math.ceil(size * 0.4)));
  const b = take(mine, Math.min(3, size - a.length));
  const c = size - a.length - b.length >= 4 ? take(lessons, 1) : [];
  const per = {};
  const varied = [];
  const rest = [];
  for (const it of fresh) {
    if ((per[it.theme] || 0) < 3) {
      per[it.theme] = (per[it.theme] || 0) + 1;
      varied.push(it);
    } else rest.push(it);
  }
  const d = take(varied.concat(rest), size - a.length - b.length - c.length);
  const queue = [];
  const lists = [a, b, d];
  while (lists.some(l => l.length)) for (const l of lists) if (l.length) queue.push(l.shift());
  if (c.length) queue.splice(Math.min(queue.length, Math.floor(queue.length / 2) + 1), 0, c[0]);
  return { queue, idx: 0, results: [], ratingStart: puzzleRating(), day };
}
function startSession(size) {
  Train.mode = 'today';
  Train.session = buildSession(size || Math.max(5, training().goal - todayDone()) || 5);
  Train.list = null;
  if (Train.session.queue.length) startItem(Train.session.queue[0]);
  else {
    Train.ex = null;
    renderTrain();
  }
}
function nextInSession() {
  const s = Train.session;
  if (!s) return;
  s.idx++;
  if (s.idx < s.queue.length) startItem(s.queue[s.idx]);
  else {
    Train.ex = null;
    renderTrain();
  }
}
function startItem(item) {
  if (Train.ex && Train.ex.ctl) Train.ex.ctl.abort();
  Train.ex = {
    item,
    fen: item.fen,
    step: 0,
    state: item.kind === 'endgame' ? 'playing' : 'solving',
    mistakes: 0,
    hints: 0,
    msg: null,
    reply: null,
    lastMove: item.last ? uciMove(item.last) : null,
    moves: 0,
    done: false,
    coach: null,
    me: fenTurn(item.fen),
    sans: [],
  };
  if (item.kind === 'endgame') Train.ex.msg = { html: `<b>Goal:</b> ${esc(goalText(item))}` };
  renderTrain();
}
function goalText(item) {
  return item.goal === 'mate'
    ? `checkmate within ${item.limit} moves. Stockfish defends.`
    : item.goal === 'promote'
      ? `promote your pawn safely within ${item.limit} moves. Stockfish defends.`
      : `hold the draw for ${item.limit} moves. Stockfish tries to win.`;
}

/* ---------- exercise logic ---------- */
function finishExercise(ex, firstTry, html) {
  if (ex.done) return;
  ex.done = true;
  const delta = recordResult(ex.item, firstTry);
  if (Train.session && Train.session.queue[Train.session.idx] === ex.item) Train.session.results.push({ id: ex.item.id, ok: firstTry, delta });
  ex.msg = { ok: firstTry, html: html + (delta ? ` <span class="mono">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span> puzzle rating.` : '') };
}
async function trainMove(from, to, promo) {
  const ex = Train.ex;
  if (!ex || !(ex.state === 'solving' || ex.state === 'playing')) return false;
  const c = new Chess(ex.fen);
  const m = c.move({ from, to, promotion: promo || 'q' });
  if (!m) return false;
  const u = from + to + (m.promotion || '');
  if (ex.item.kind === 'endgame') return endgameMove(ex, c, m);
  const want = ex.item.line[ex.step];
  if (u === want || c.in_checkmate()) return correctStep(ex, c, m);
  ex.state = 'checking';
  ex.show = c.fen();
  ex.showMove = { from, to };
  ex.msg = { html: `<span class="thinking"><span class="spinner"></span>Checking ${esc(m.san)} with Stockfish…</span>` };
  renderTrain();
  let accept = false,
    alt = null;
  if (!Engine.failed) {
    try {
      const [best, after] = await Promise.all([
        evalFen(ex.fen, { priority: 5, depth: 13, movetime: 1500 }),
        evalFen(c.fen(), { priority: 5, depth: 13, movetime: 1500 }),
      ]);
      const bw = winPct(povCp(best.pos.c, ex.me)),
        aw = winPct(povCp(after.pos.c, ex.me));
      alt = after.pos;
      accept = bw - aw <= (ex.item.kind === 'game' ? 5 : 3.5) && (ex.item.theme === 'defend' || ex.item.kind === 'game' || aw >= 75);
    } catch {}
  }
  if (Train.ex !== ex) return true;
  ex.show = null;
  if (accept) {
    ex.fen = c.fen();
    ex.lastMove = { from, to };
    ex.state = 'solved';
    const main = sanLine(ex.item.fen, ex.item.line.join(' '), 8);
    finishExercise(
      ex,
      ex.mistakes === 0 && !ex.hints,
      `<b>${esc(m.san)} works too.</b> It keeps the advantage (${esc(fmtEval(alt))}). The main line was <span class="mono">${esc(lineText(ex.item.fen, main))}</span>.`,
    );
  } else {
    ex.state = 'wrong';
    ex.mistakes++;
    ex.reply = alt && alt.b ? uciMove(alt.b) : null;
    ex.wrongFen = c.fen();
    ex.wrongMove = { from, to };
    const reply = alt ? sanLine(c.fen(), alt.p, 3) : [];
    ex.msg = {
      ok: false,
      html: `<b>${esc(m.san)} isn’t it.</b> ${reply.length ? `After it, the engine answers <span class="mono">${esc(lineText(c.fen(), reply))}</span> (${esc(fmtEval(alt))}).` : 'Look again: what does your opponent’s last move allow, or threaten?'}`,
    };
  }
  renderTrain();
  return true;
}
function correctStep(ex, c, m) {
  ex.fen = c.fen();
  ex.lastMove = { from: m.from, to: m.to };
  ex.step++;
  ex.sans.push(m.san);
  if (c.in_checkmate() || ex.step >= ex.item.line.length) {
    ex.state = 'solved';
    const cont = ex.item.kind === 'game' ? sanLine(ex.fen, (ex.item.g.pos[ex.item.k - 1].p || '').split(' ').slice(1).join(' '), 5) : [];
    finishExercise(
      ex,
      ex.mistakes === 0 && !ex.hints,
      `<b>${esc(m.san)}${c.in_checkmate() ? ' is checkmate' : ' is right'}.</b> ${ex.mistakes || ex.hints ? 'Solved, and it comes back for review tomorrow.' : 'Solved on the first try.'}${cont.length ? ` Line: <span class="mono">${esc(lineText(ex.fen, cont))}</span>.` : ''}`,
    );
    renderTrain();
    return true;
  }
  ex.state = 'reply';
  ex.msg = { ok: true, html: `<b>${esc(m.san)}</b>, good. Keep going.` };
  renderTrain();
  setTimeout(() => {
    if (Train.ex !== ex) return;
    const cc = new Chess(ex.fen);
    const mm = cc.move(uciMove(ex.item.line[ex.step]));
    ex.fen = cc.fen();
    ex.lastMove = { from: mm.from, to: mm.to };
    ex.step++;
    ex.state = 'solving';
    ex.sans.push(mm.san);
    ex.msg = { html: `${colorName(mm.color)} replies <b class="mono">${esc(mm.san)}</b>. Your move.` };
    renderTrain();
  }, 650);
  return true;
}
function retryStep() {
  const ex = Train.ex;
  ex.state = 'solving';
  ex.reply = null;
  ex.wrongFen = null;
  ex.msg = { html: 'Try again. Look at checks, captures and threats first.' };
  renderTrain();
}
function hintStep() {
  const ex = Train.ex;
  ex.hints++;
  if (ex.item.kind === 'endgame') {
    ex.state = 'thinking';
    renderTrain();
    evalFen(ex.fen, { priority: 5, depth: 14, movetime: 1500 })
      .then(r => {
        if (Train.ex !== ex) return;
        ex.state = 'playing';
        ex.hintArrow = r.pos.b ? uciMove(r.pos.b) : null;
        ex.msg = { html: 'The arrow shows Stockfish’s choice. ' + esc(ex.item.idea || '') };
        renderTrain();
      })
      .catch(() => {
        ex.state = 'playing';
        renderTrain();
      });
    return;
  }
  if (ex.state === 'wrong') retryStep();
  const mv = uciMove(ex.item.line[ex.step]);
  const piece = new Chess(ex.fen).get(mv.from);
  ex.hintSq = mv.from;
  ex.msg = {
    html: `Hint: move your ${esc(PNAME[piece.type])} on ${mv.from}.${ex.item.theme && THEMES[ex.item.theme] && ex.item.kind !== 'game' ? ` Theme: ${esc(THEMES[ex.item.theme].name.toLowerCase())}.` : ''}`,
  };
  renderTrain();
}
function revealStep() {
  const ex = Train.ex;
  if (ex.state === 'wrong') {
    ex.wrongFen = null;
    ex.reply = null;
  }
  const rest = sanLine(ex.fen, ex.item.line.slice(ex.step).join(' '), 10);
  ex.revealArrow = uciMove(ex.item.line[ex.step]);
  ex.state = 'revealed';
  finishExercise(ex, false, `The answer: <span class="mono">${esc(lineText(ex.fen, rest))}</span>. It comes back for review tomorrow.`);
  renderTrain();
}
async function endgameMove(ex, c, m) {
  ex.fen = c.fen();
  ex.lastMove = { from: m.from, to: m.to };
  ex.moves++;
  ex.hintArrow = null;
  ex.sans.push(m.san);
  if (endgameCheck(ex, c, m)) {
    renderTrain();
    return true;
  }
  ex.state = 'thinking';
  ex.msg = { html: `<span class="thinking"><span class="spinner"></span>Stockfish is thinking…</span>` };
  renderTrain();
  try {
    const r = await evalFen(ex.fen, { priority: 5, depth: 14, movetime: 900 });
    if (Train.ex !== ex) return true;
    const mine = povCp(r.pos.c, ex.me);
    if ((ex.item.goal === 'mate' || ex.item.goal === 'promote') && mine < 250 && !r.pos.over) {
      ex.state = 'failed';
      finishExercise(ex, false, `<b>The win slipped away</b> (engine: ${esc(fmtEval(r.pos))}). Restart and try again. ${esc(ex.item.idea || '')}`);
      renderTrain();
      return true;
    }
    if (ex.item.goal === 'draw' && mine < -400) {
      ex.state = 'failed';
      finishExercise(
        ex,
        false,
        `<b>That position is now lost</b> (engine: ${esc(fmtEval(r.pos))}). Restart and try again. ${esc(ex.item.idea || '')}`,
      );
      renderTrain();
      return true;
    }
    const cc = new Chess(ex.fen);
    const mm = cc.move(uciMove(r.pos.b));
    ex.fen = cc.fen();
    ex.lastMove = { from: mm.from, to: mm.to };
    ex.sans.push(mm.san);
    if (endgameCheck(ex, cc, mm)) {
      renderTrain();
      return true;
    }
    ex.state = 'playing';
    ex.msg = { html: `Stockfish played <b class="mono">${esc(mm.san)}</b>. Move ${ex.moves + 1} of ${ex.item.limit}.` };
  } catch {
    ex.state = 'playing';
    ex.msg = { html: 'The engine isn’t available, so this play-out can’t continue.' };
  }
  renderTrain();
  return true;
}
function endgameCheck(ex, c, m) {
  const goal = ex.item.goal,
    me = ex.me;
  const end = (ok, text) => {
    ex.state = ok ? 'solved' : 'failed';
    finishExercise(ex, ok && !ex.hints, text + (ok ? '' : ` ${esc(ex.item.idea || '')}`));
    return true;
  };
  if (c.in_checkmate())
    return c.turn() !== me
      ? end(goal !== 'draw', `<b>Checkmate in ${ex.moves} moves.</b> ${goal === 'mate' ? 'Clean technique.' : ''}`)
      : end(false, '<b>You were checkmated.</b>');
  if (c.in_stalemate())
    return end(
      goal === 'draw',
      goal === 'draw'
        ? '<b>Stalemate.</b> You held the draw.'
        : '<b>Stalemate, so it’s a draw.</b> Always leave the enemy king a square when you aren’t giving check.',
    );
  if (c.insufficient_material() || c.in_threefold_repetition())
    return end(goal === 'draw', goal === 'draw' ? '<b>Draw secured.</b> The win is gone for White.' : '<b>That’s a draw now.</b>');
  if (goal === 'promote' && m.color === me && m.promotion) return end(true, `<b>Promoted in ${ex.moves} moves.</b> The rest is a basic mate.`);
  if (goal === 'draw' && m.color !== me && m.promotion) return end(false, '<b>The pawn promoted.</b>');
  if (m.color === me && ex.moves >= ex.item.limit)
    return goal === 'draw'
      ? end(true, `<b>You held for ${ex.item.limit} moves.</b> That’s a draw with correct play.`)
      : end(false, `<b>Out of moves.</b> You have ${ex.item.limit} moves for this one.`);
  return false;
}
async function gameItemPrompt(item, extra) {
  return `${explainPrompt(item.g, item.k)}\n\nEXTRA CONTEXT: this position is now a training drill. ${extra} Focus on why the engine's best move works and which clue in the position points to it, so the student finds similar moves in future games.`;
}
function puzzlePrompt(item, ex) {
  const fen = item.fen;
  const line = sanLine(fen, item.line.join(' '), 10);
  const turn = fenTurn(fen);
  const lastSq = item.last ? uciMove(item.last) : null;
  const lastPiece = lastSq ? new Chess(fen).get(lastSq.to) : null;
  const facts = [];
  for (const col of [turn, other(turn)])
    for (const l of loosePieces(fen, col).slice(0, 3))
      facts.push(
        `${colorName(col)}'s ${PNAME[l.type]} on ${l.sq} is attacked by ${describePieces(l.attackers)} and ${l.defenders.length ? `defended by ${describePieces(l.defenders)}` : 'not defended'}.`,
      );
  return `${PERSONA}

TRAINING ${item.kind === 'endgame' ? 'ENDGAME' : 'PUZZLE'} (${item.title || (THEMES[item.theme] || {}).name || 'tactic'}).
Position (FEN): ${fen}. ${colorName(turn)} (the student) to move.
${lastSq && lastPiece ? `The opponent's last move brought their ${PNAME[lastPiece.type]} to ${lastSq.to} (from ${lastSq.from}).` : ''}
${item.kind === 'endgame' ? `Goal: ${goalText(item)}\nTechnique notes: ${item.idea || ''}\nMoves played so far in the student's attempt: ${ex.sans.join(' ') || 'none'}.` : `Solution (verified by Stockfish): ${lineText(fen, line)}.`}
${item.idea && item.kind !== 'endgame' ? `Lesson notes: ${item.idea}` : ''}
Student's attempt: ${ex.mistakes ? `${ex.mistakes} wrong tr${ex.mistakes === 1 ? 'y' : 'ies'} first` : 'no wrong moves'}${ex.hints ? ', used a hint' : ''}${ex.state === 'revealed' ? ', then asked for the answer' : ''}.
BOARD FACTS:
- ${facts.join('\n- ') || 'No loose pieces.'}

TASK: In 80 to 140 words, explain ${item.kind === 'endgame' ? 'the technique for this endgame and what the student should aim for move by move' : 'why the solution works: the pattern, the clue in the position that points to it, and what the opponent overlooked'}. Finish with a separate line that starts with "**Pattern to remember:**". No headings.`;
}
async function trainCoach() {
  const ex = Train.ex;
  if (!ex || !App.sample || App.sampleOff) return;
  const job = (ex.coach = { text: '' });
  ex.ctl = new AbortController();
  renderTrain();
  const prompt =
    ex.item.kind === 'game'
      ? await gameItemPrompt(ex.item, ex.mistakes ? `The student needed ${ex.mistakes + 1} tries.` : '')
      : puzzlePrompt(ex.item, ex);
  try {
    const res = await App.sample(prompt, {
      signal: ex.ctl.signal,
      modelTier: 'default',
      onText: ({ text }) => {
        job.text = text;
        const box = $('#train-coach');
        if (box && Train.ex === ex) box.innerHTML = md(text);
      },
    });
    App.consented = true;
    job.text = noDash(res.text);
    job.final = true;
  } catch (e) {
    if (e && OFF_CODES.has(e.code)) App.sampleOff = e.code;
    job.error = e && e.code !== 'cancelled' ? e : null;
    if (!job.error && !job.text) ex.coach = null;
  }
  if (App.tab === 'drills' && Train.ex === ex) renderTrain();
}

/* ---------- rendering ---------- */
function openDrills() {
  renderTrain();
}
function switchTrainMode(k) {
  if (Train.ex && Train.ex.ctl) Train.ex.ctl.abort();
  const s = Train.session;
  const wasToday = Train.mode === 'today';
  Train.mode = k;
  Train.list = null;
  if (k === 'today' && s && s.idx < s.queue.length) {
    if (!wasToday || !Train.ex) startItem(s.queue[s.idx]);
    else renderTrain();
    return;
  }
  Train.ex = null;
  renderTrain();
}
function trainStrips(item) {
  const top = $('#dplayer-top'),
    bottom = $('#dplayer-bottom');
  if (!item) {
    top.replaceChildren();
    bottom.replaceChildren();
    return;
  }
  const me = fenTurn(item.fen);
  if (item.kind === 'game') {
    const h = item.g.headers;
    const nm = c => (c === 'w' ? h.White || 'White' : h.Black || 'Black');
    top.replaceChildren(el('span', { class: 'side-swatch ' + other(me) }), el('span', { class: 'pname', text: nm(other(me)) }));
    bottom.replaceChildren(
      el('span', { class: 'side-swatch ' + me }),
      el('span', { class: 'pname', text: nm(me) }),
      el('span', { class: 'you', text: 'You' }),
    );
  } else {
    top.replaceChildren(
      el('span', { class: 'side-swatch ' + other(me) }),
      el('span', { class: 'pname', text: item.kind === 'endgame' ? 'Stockfish' : 'Opponent' }),
    );
    bottom.replaceChildren(el('span', { class: 'side-swatch ' + me }), el('span', { class: 'pname', text: `You · ${colorName(me)} to play` }));
  }
}
function renderTrainBoard() {
  const ex = Train.ex;
  if (!ex) {
    drillBoard.setPosition(START_FEN, false);
    drillBoard.setDecor({});
    drillBoard.setInteractive(false);
    trainStrips(null);
    return;
  }
  trainStrips(ex.item);
  drillBoard.setOrientation(ex.me);
  const fen = ex.wrongFen || ex.show || ex.fen;
  drillBoard.setPosition(fen, true);
  const marks = [],
    arrows = [];
  const lm = ex.wrongFen ? ex.wrongMove : ex.show ? ex.showMove : ex.lastMove;
  if (lm) marks.push({ sq: lm.from, kind: 'last' }, { sq: lm.to, kind: 'last' });
  const ck = checkSquare(fen);
  if (ck) marks.push({ sq: ck, kind: 'check' });
  if (ex.hintSq && ex.state === 'solving') marks.push({ sq: ex.hintSq, kind: 'hint' });
  if (ex.revealArrow) arrows.push({ ...ex.revealArrow, color: 'var(--arrow-best)' });
  if (ex.state === 'wrong' && ex.reply) arrows.push({ ...ex.reply, color: 'var(--arrow-threat)' });
  if (ex.hintArrow) arrows.push({ ...ex.hintArrow, color: 'var(--arrow-coach)' });
  drillBoard.setDecor({ marks, arrows });
  drillBoard.setInteractive(ex.state === 'solving' || ex.state === 'playing', destsOf(ex.fen));
}
function trainHeader() {
  const t = training();
  const s = streak();
  const done = todayDone();
  const head = el(
    'div',
    { class: 'train-head' },
    el(
      'div',
      { class: 'train-stats' },
      el('span', {}, el('span', { class: 'ts-l', text: 'Puzzle rating' }), el('b', { class: 'mono', text: String(puzzleRating()) })),
      el('span', {}, el('span', { class: 'ts-l', text: 'Streak' }), el('b', { class: 'mono', text: `${s} day${s === 1 ? '' : 's'}` })),
      el('span', {}, el('span', { class: 'ts-l', text: 'Today' }), el('b', { class: 'mono', text: `${done} / ${t.goal}` })),
      el('span', { class: 'goal-bar', title: `${done} of ${t.goal} today` }, el('i', { style: `width:${Math.min(100, (done / t.goal) * 100)}%` })),
    ),
    el(
      'div',
      { class: 'seg', role: 'tablist' },
      ...[
        ['today', 'Today'],
        ['mine', 'My mistakes'],
        ['themes', 'Puzzles by theme'],
        ['lessons', 'Lessons'],
      ].map(([k, label]) =>
        el('button', { type: 'button', role: 'tab', 'aria-selected': String(Train.mode === k), onclick: () => switchTrainMode(k), text: label }),
      ),
    ),
  );
  return head;
}
function renderTrain() {
  const panel = $('#drill-panel');
  panel.innerHTML = '';
  panel.append(trainHeader());
  renderTrainBoard();
  const ex = Train.ex;
  if (ex) {
    panel.append(exercisePanel(ex));
    return;
  }
  if (Train.mode === 'today') panel.append(todayCard());
  else if (Train.mode === 'mine') panel.append(mineList());
  else if (Train.mode === 'themes') panel.append(themesGrid());
  else panel.append(lessonsList());
}
function todayCard() {
  const s = Train.session;
  const box = el('div', { class: 'train-body' });
  if (s && s.idx >= s.queue.length && s.queue.length) {
    const ok = s.results.filter(r => r.ok).length;
    const r1 = puzzleRating();
    box.append(
      el('h3', { class: 'train-h', text: 'Session complete' }),
      el('p', {
        text: `${ok} of ${s.results.length} solved on the first try. Puzzle rating ${s.ratingStart} → ${r1}. Streak: ${streak()} day${streak() === 1 ? '' : 's'}.`,
      }),
      el('p', { class: 'note', text: 'Anything you missed comes back tomorrow; what you solved returns after a longer gap, so it sticks.' }),
      el(
        'div',
        { class: 'card-actions' },
        el('button', { class: 'btn primary', onclick: () => startSession(5), text: 'Five more' }),
        el('button', {
          class: 'btn',
          onclick: () => {
            Train.session = null;
            renderTrain();
          },
          text: 'Done for today',
        }),
      ),
    );
    return box;
  }
  const t = training();
  const due = dueCount();
  const mine = collectDrills().filter(d => !t.items[`g:${d.rec.id}:${d.k}`]).length;
  const left = Math.max(0, t.goal - todayDone());
  box.append(
    el('h3', { class: 'train-h', text: left ? 'Today’s training' : 'Daily goal reached' }),
    el('p', {
      text: left
        ? `${left} exercises, picked for you: reviews that are due, positions from your own games, puzzles near your rating (${puzzleRating()}) that lean toward your weak spots, and a lesson from your current stage.`
        : 'You hit today’s goal. Extra sessions still count toward your rating and reviews.',
    }),
    el(
      'ul',
      { class: 'mix' },
      el('li', {}, el('b', { class: 'mono', text: String(due) }), ' reviews due'),
      el('li', {}, el('b', { class: 'mono', text: String(mine) }), ' new positions from your games'),
      el('li', {}, el('b', { class: 'mono', text: String(PUZZLES.filter(p => !t.items['p:' + p.i]).length) }), ' unseen puzzles'),
      el('li', {}, el('b', { class: 'mono', text: String(LESSONS.filter(x => !(t.items[x.id] && t.items[x.id].ok)).length) }), ' lessons to finish'),
    ),
    el(
      'div',
      { class: 'card-actions' },
      el('button', { class: 'btn primary', onclick: () => startSession(left || 5), text: left ? 'Start today’s training' : 'Train five more' }),
    ),
  );
  const weak = weakThemes()
    .filter(x => THEMES[x])
    .slice(0, 4);
  if (weak.length)
    box.append(
      el('p', {
        class: 'note',
        text: `Leaning toward: ${weak.map(x => THEMES[x].name.toLowerCase()).join(', ')}, based on your games and puzzle results.`,
      }),
    );
  box.append(checklistEl());
  return box;
}
function checklistEl() {
  return el(
    'div',
    {},
    el('div', { class: 'checklist-h', text: 'Before you move, every move' }),
    el(
      'ol',
      { class: 'checklist' },
      el('li', { text: 'What did my opponent’s last move threaten?' }),
      el('li', { text: 'Checks, captures and attacks: for me and for them.' }),
      el('li', { text: 'Is the square I’m moving to safe? What did I stop defending?' }),
    ),
  );
}
function itemStatus(id) {
  const st = training().items[id];
  if (!st) return { cls: '', text: 'new' };
  if (st.mastered) return { cls: 'solved', text: 'mastered' };
  if (st.due <= localDay()) return { cls: 'tried', text: 'due' };
  return { cls: st.firstOk || st.ok ? 'solved' : 'tried', text: `next ${fmtDue(st.due)}` };
}
function fmtDue(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function startList(items, mode) {
  Train.mode = mode;
  Train.session = null;
  Train.list = { items, idx: 0 };
  startItem(items[0]);
}
function mineList() {
  const box = el('div', { class: 'train-body' });
  const items = collectDrills().map(gameItem);
  if (!items.length) {
    const analyzing = (App.library.length ? App.library : [App.exampleRec]).some(r => r && !(r.analysis && r.analysis.complete));
    box.append(
      el('h3', { class: 'train-h', text: analyzing ? 'Your mistakes appear after grading' : 'No mistakes to drill yet' }),
      el('p', {
        text: analyzing
          ? 'Every mistake, blunder and missed chance in your games becomes a position to solve here. Stockfish is still grading your games.'
          : 'None of your graded games has a mistake, blunder or missed chance. Import more games to build this set.',
      }),
    );
    return box;
  }
  box.append(
    el('h3', { class: 'train-h', text: `${items.length} positions from your games` }),
    el('p', { class: 'note', text: 'Each is a moment you went wrong. Solve it now; it returns on a schedule until it sticks.' }),
    el(
      'div',
      { class: 'card-actions' },
      el('button', {
        class: 'btn primary',
        onclick: () => {
          const t = training();
          const order = items.slice().sort((a, b) => ((t.items[a.id] || {}).due || '0').localeCompare((t.items[b.id] || {}).due || '0'));
          startList(order, 'mine');
        },
        text: 'Drill them in order',
      }),
    ),
  );
  const list = el('div', { class: 'tlist' });
  const SHOWN = 40;
  for (const it of items.slice(0, SHOWN)) {
    const st = itemStatus(it.id);
    list.append(
      el(
        'button',
        { type: 'button', class: 'trow pic', onclick: () => startList([it, ...items.filter(x => x !== it)], 'mine') },
        mbEl(it.fen, { orient: it.rec.userColor, move: it.last ? uciMove(it.last) : null, tone: 'line' }),
        el('span', { class: 'tdot ' + st.cls }),
        el('span', { class: 'tt' }, `${gameTitle(it.rec)} · move ${fenFull(it.fen)}`),
        el('span', { class: 'tm mono' }, it.san, el('span', { class: 'glyph k-' + it.gradeKind, text: KINDS[it.gradeKind].glyph })),
        el('span', { class: 'ts', text: st.text }),
      ),
    );
  }
  box.append(list);
  if (items.length > SHOWN)
    box.append(
      el('p', { class: 'note', text: `Showing your ${SHOWN} costliest mistakes of ${items.length}. “Drill them in order” covers all of them.` }),
    );
  return box;
}
function themesGrid() {
  const box = el('div', { class: 'train-body' });
  const t = training();
  const stats = themeStats();
  const r = puzzleRating();
  box.append(
    el('h3', { class: 'train-h', text: 'Puzzles by theme' }),
    el('p', { class: 'note', text: 'Pick a pattern to practice. Puzzles start near your rating and adjust as you go.' }),
  );
  const grid = el('div', { class: 'theme-grid' });
  const counts = {};
  for (const p of PUZZLES) counts[p.t] = (counts[p.t] || 0) + 1;
  for (const [key, th] of Object.entries(THEMES)) {
    if (!counts[key]) continue;
    const s = stats[key] || { seen: 0, first: 0 };
    const pct = s.seen ? Math.round((s.first / s.seen) * 100) : null;
    grid.append(
      el(
        'button',
        {
          type: 'button',
          class: 'theme-card',
          onclick: () => {
            const items = PUZZLES.filter(p => p.t === key)
              .map(puzzleItem)
              .sort((a, b) => !!t.items[a.id] - !!t.items[b.id] || Math.abs(a.rating - r) - Math.abs(b.rating - r));
            startList(items, 'themes');
          },
        },
        el('span', { class: 'tc-n', text: th.name }),
        el('span', { class: 'tc-b', text: th.blurb }),
        el(
          'span',
          { class: 'tc-s' },
          el('span', { class: 'mono', text: `${s.seen}/${counts[key]}` }),
          pct != null ? el('span', { text: ` · ${pct}% first try` }) : null,
          th.stage ? el('span', { class: 'tc-band', text: STAGE_BAND[th.stage] }) : null,
        ),
      ),
    );
  }
  box.append(grid);
  return box;
}
function lessonsList() {
  const box = el('div', { class: 'train-body' });
  const stage = currentStage();
  box.append(
    el('h3', { class: 'train-h', text: 'Lessons' }),
    el('p', { class: 'note', text: 'Classic patterns and endgames every club player needs. Endgames are played out against Stockfish.' }),
  );
  for (let s = 1; s <= 4; s++) {
    const xs = LESSONS.filter(x => x.stage === s).map(lessonItem);
    if (!xs.length) continue;
    box.append(el('div', { class: 'checklist-h', style: 'margin-top:6px', text: `${STAGE_BAND[s]}${s === stage ? ' · your stage' : ''}` }));
    const list = el('div', { class: 'tlist' });
    for (const it of xs) {
      const st = itemStatus(it.id);
      list.append(
        el(
          'button',
          {
            type: 'button',
            class: 'trow pic',
            onclick: () =>
              startList(
                [it, ...LESSONS.map(lessonItem).filter(x => x.id !== it.id && !(training().items[x.id] && training().items[x.id].ok))],
                'lessons',
              ),
          },
          mbEl(it.fen, { orient: fenTurn(it.fen) }),
          el('span', { class: 'tdot ' + st.cls }),
          el('span', { class: 'tt', text: it.title }),
          el('span', { class: 'tm', text: it.kind === 'endgame' ? 'Play it out' : THEMES[it.theme] ? THEMES[it.theme].name : '' }),
          el('span', { class: 'ts', text: st.text === 'new' ? '' : st.text }),
        ),
      );
    }
    box.append(list);
  }
  return box;
}
function exercisePanel(ex) {
  const item = ex.item;
  const box = el('div', { class: 'train-body' });
  const s = Train.session,
    L = Train.list;
  const pos = s && Train.mode === 'today' ? `${s.idx + 1} of ${s.queue.length}` : L ? `${L.items.indexOf(item) + 1} of ${L.items.length}` : '';
  const th = THEMES[item.theme];
  const title = item.kind === 'game' ? 'Find a better move' : item.title || (item.theme === 'defend' ? 'Spot the threat' : 'Find the best move');
  box.append(
    el(
      'div',
      { class: 'drill-top' },
      el('span', { class: 'drill-title', text: title }),
      pos ? el('span', { class: 'drill-meta', text: pos }) : null,
      item.kind !== 'game' && th
        ? el('span', {
            class: 'chip',
            style: 'background:var(--accent-soft);color:var(--accent)',
            text: ex.state === 'solving' && item.kind === 'puzzle' && !ex.hints ? (item.theme === 'defend' ? 'Defense' : 'Tactic') : th.name,
          })
        : null,
      item.rating && item.kind !== 'endgame' ? el('span', { class: 'drill-meta mono', text: String(item.rating) }) : null,
    ),
  );
  if (s && Train.mode === 'today') {
    const prog = el('div', { class: 'drill-progress' });
    s.queue.forEach((q, i) => {
      const r = s.results.find(x => x.id === q.id);
      prog.append(el('span', { class: 'pdot' + (r ? (r.ok ? ' solved' : ' tried') : '') + (i === s.idx ? ' cur' : '') }));
    });
    box.append(prog);
  }
  let prompt;
  if (item.kind === 'game') {
    const p = item.g.plies[item.k - 1];
    prompt = el(
      'div',
      { class: 'drill-prompt' },
      `${gameTitle(item.g.rec)}, move ${fenFull(item.fen)}. In the game you played `,
      el('b', { class: 'mono', text: p.san }),
      el('span', { class: 'glyph k-' + item.gradeKind, style: 'font-weight:700', text: KINDS[item.gradeKind].glyph }),
      item.gradeKind === 'miss' ? '. Your opponent had just erred. Find the move that punishes it.' : '. Find a stronger move.',
    );
  } else if (item.kind === 'endgame') prompt = el('div', { class: 'drill-prompt' }, el('b', { text: 'Goal: ' }), goalText(item));
  else {
    const lm = item.last ? uciMove(item.last) : null;
    const pc = lm ? new Chess(item.fen).get(lm.to) : null;
    prompt = el('div', {
      class: 'drill-prompt',
      text: `${colorName(ex.me)} to move. ${pc ? `Your opponent just moved their ${PNAME[pc.type]} to ${lm.to}. ` : ''}${item.theme === 'defend' ? 'They are threatening something. Find the only move that holds.' : item.kind === 'lesson' && item.line.length > 1 ? 'Find the forcing line.' : 'Find the best move.'}`,
    });
  }
  box.append(prompt);
  if (ex.msg) box.append(el('div', { class: 'drill-feedback ' + (ex.msg.ok ? 'ok' : ex.msg.ok === false ? 'bad' : ''), html: ex.msg.html }));
  if ((ex.state === 'solved' || ex.state === 'revealed' || ex.state === 'failed') && item.kind !== 'endgame') {
    const start = { fen: item.fen, ply: null, pre: [] };
    let html = '';
    if (item.kind === 'game') {
      const g = item.g,
        k = item.k,
        p = g.plies[k - 1];
      const best = lineFigs(start, lineSteps(item.fen, g.pos[k - 1].p || item.line[0], 4), {
        orient: ex.me,
        max: 4,
        tone: 'best',
        firstTag: 'Better',
        firstTone: 'best',
      });
      const played = lineFigs(start, [{ san: p.san, from: p.from, to: p.to, fen: g.fens[k] }], {
        orient: ex.me,
        tone: 'threat',
        firstTag: 'You played',
        firstGlyph: item.gradeKind,
        firstBadge: item.gradeKind,
      }).concat(
        g.pos[k] && g.pos[k].p
          ? lineFigs({ fen: g.fens[k], ply: null, pre: [] }, lineSteps(g.fens[k], g.pos[k].p, 2), {
              orient: ex.me,
              max: 2,
              tone: 'threat',
              firstTag: 'Best reply',
            })
          : [],
      );
      html = `<div class="figblock"><span class="fl">The stronger line</span>${figsHTML(best)}</div><div class="figblock"><span class="fl">In the game</span>${figsHTML(played)}</div>`;
    } else if (item.line.length) {
      const frames = lineFigs(start, lineSteps(item.fen, item.line.join(' '), 6), { orient: ex.me, max: 5, tone: 'best' });
      html = `<div class="figblock"><span class="fl">The solution, move by move</span>${figsHTML(frames)}</div>`;
    }
    if (html) box.append(el('div', { class: 'cc-figs', html }));
    if (item.idea) box.append(el('div', { class: 'lesson-idea' }, el('b', { text: 'The idea: ' }), item.idea));
  }
  if (ex.coach) {
    const c = el('div', { class: 'prose', id: 'train-coach' });
    if (ex.coach.text) {
      c.innerHTML = md(ex.coach.text);
      const bases = [{ fen: item.fen, ply: null, pre: [] }];
      if (item.kind === 'game') bases.push({ fen: item.g.fens[item.k], ply: null, pre: [] });
      linkMoves(c, bases, { figs: !!ex.coach.final, orient: ex.me, maxFigs: 8 });
    } else if (ex.coach.error) c.append(el('p', { class: 'note warn', text: sampleErrorText(ex.coach.error) }));
    else c.append(thinkingEl('The coach is writing…', () => ex.ctl && ex.ctl.abort()));
    box.append(c);
  }
  const acts = el('div', { class: 'card-actions' });
  const finished = ex.state === 'solved' || ex.state === 'revealed' || ex.state === 'failed';
  if (ex.state === 'wrong') acts.append(el('button', { class: 'btn primary', onclick: retryStep, text: 'Try again' }));
  if (!finished && ex.state !== 'checking' && ex.state !== 'reply' && ex.state !== 'thinking') {
    acts.append(el('button', { class: 'btn', onclick: hintStep, text: 'Hint' }));
    if (item.kind !== 'endgame') acts.append(el('button', { class: 'btn', onclick: revealStep, text: 'Show the answer' }));
  }
  if (item.kind === 'endgame' && (finished || ex.moves))
    acts.append(el('button', { class: finished && ex.state !== 'solved' ? 'btn primary' : 'btn', onclick: () => startItem(item), text: 'Restart' }));
  if (finished) {
    if (App.sample && !App.sampleOff && !ex.coach)
      acts.append(
        el('button', { class: 'btn', onclick: trainCoach, text: item.kind === 'endgame' ? 'Explain the technique' : 'Why does this work?' }),
      );
    if (item.kind === 'game')
      acts.append(
        el('button', {
          class: 'btn',
          onclick: () => {
            switchTab('review');
            openGame(item.g.id, item.k);
          },
          text: 'See it in the game',
        }),
      );
    acts.append(el('button', { class: 'btn primary', onclick: nextExercise, text: 'Next' }));
  }
  if (!finished && Train.list) acts.append(el('button', { class: 'btn quiet', onclick: nextExercise, text: 'Skip' }));
  box.append(acts);
  if (item.kind !== 'endgame') box.append(checklistEl());
  return box;
}
function nextExercise() {
  if (Train.mode === 'today' && Train.session) return nextInSession();
  const L = Train.list;
  if (!L) {
    Train.ex = null;
    renderTrain();
    return;
  }
  L.idx = L.items.indexOf(Train.ex.item) + 1;
  if (L.idx < L.items.length) startItem(L.items[L.idx]);
  else {
    Train.list = null;
    Train.ex = null;
    renderTrain();
    toast('That’s the whole set. Reviews come back on schedule.');
  }
}
