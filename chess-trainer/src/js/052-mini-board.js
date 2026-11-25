/* ================= mini boards ================= */
/* Small static board pictures, built as HTML strings so they can be cached with the text around them.
   One element for the checkerboard (a CSS gradient), one per piece, an SVG for arrows. */
function mbXY(sq, orient) {
  const f = FILES.indexOf(sq[0]),
    r = +sq[1] - 1;
  return orient === 'b' ? [7 - f, r] : [f, 7 - r];
}
const validSq = s => typeof s === 'string' && /^[a-h][1-8]$/.test(s);
function mbArrow(a, orient) {
  if (!a || !validSq(a.from) || !validSq(a.to) || a.from === a.to) return '';
  const [x1, y1] = mbXY(a.from, orient),
    [x2, y2] = mbXY(a.to, orient);
  const sx = x1 * 10 + 5,
    sy = y1 * 10 + 5,
    ex = x2 * 10 + 5,
    ey = y2 * 10 + 5;
  const len = Math.hypot(ex - sx, ey - sy),
    ux = (ex - sx) / len,
    uy = (ey - sy) / len;
  const tx = ex - ux * 0.6,
    ty = ey - uy * 0.6,
    bx = tx - ux * 4.4,
    by = ty - uy * 4.4;
  const f = n => n.toFixed(1);
  return (
    `<g style="color:var(--arrow-${a.tone || 'coach'})" opacity=".88">` +
    `<line x1="${f(sx + ux * 1.6)}" y1="${f(sy + uy * 1.6)}" x2="${f(bx + ux * 0.4)}" y2="${f(by + uy * 0.4)}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `<polygon points="${f(tx)},${f(ty)} ${f(bx - uy * 3)},${f(by + ux * 3)} ${f(bx + uy * 3)},${f(by - ux * 3)}" fill="currentColor"/></g>`
  );
}
/* opts: orient 'w'|'b'; move {from,to} (highlighted, with an arrow in `tone`); arrows [{from,to,tone}];
   squares [sq] (outlined); badge {sq, kind} */
function miniBoardHTML(fen, opts = {}) {
  const orient = opts.orient === 'b' ? 'b' : 'w';
  const cell = (sq, cls) => {
    const [x, y] = mbXY(sq, orient);
    return `<i class="${cls}" style="left:${x * 12.5}%;top:${y * 12.5}%"></i>`;
  };
  let h = '<span class="mb" aria-hidden="true">';
  const mv = opts.move && validSq(opts.move.from) && validSq(opts.move.to) ? opts.move : null;
  if (mv) h += cell(mv.from, 'mh') + cell(mv.to, 'mh');
  for (const s of opts.squares || []) if (validSq(s)) h += cell(s, 'ms');
  for (const [sq, code] of fenPieces(fen)) h += cell(sq, 'mp pc-' + code);
  const arrows = (mv ? [{ from: mv.from, to: mv.to, tone: opts.tone || 'coach' }] : []).concat(opts.arrows || []);
  const svg = arrows.map(a => mbArrow(a, orient)).join('');
  if (svg) h += `<svg class="ma" viewBox="0 0 80 80">${svg}</svg>`;
  if (opts.badge && KINDS[opts.badge.kind] && validSq(opts.badge.sq)) {
    const [x, y] = mbXY(opts.badge.sq, orient);
    // The badge hangs off the square's top-right corner; on the right file or top rank it turns inward so it is not cut off.
    const edge = (x === 7 ? ' el' : '') + (y === 0 ? ' et' : '');
    h += `<b class="mg k-${opts.badge.kind}${edge}" style="left:${x * 12.5}%;top:${y * 12.5}%">${esc(KINDS[opts.badge.kind].glyph)}</b>`;
  }
  return h + '</span>';
}
function mbEl(fen, opts) {
  const t = document.createElement('template');
  t.innerHTML = miniBoardHTML(fen, opts);
  return t.content.firstChild;
}
/* A captioned board. `go` = {ply, line:[san]} makes it a button that opens that position on the main board. */
function figHTML(f) {
  const cap =
    (f.tag ? `<span class="ft${f.tagTone ? ' t-' + f.tagTone : ''}">${esc(f.tag)}</span>` : '') +
    `<span class="fc">${esc(f.cap || '')}${f.glyph ? `<span class="glyph k-${f.glyph}">${esc(KINDS[f.glyph].glyph)}</span>` : ''}</span>`;
  const board = miniBoardHTML(f.fen, f);
  if (f.go && f.go.ply != null)
    return `<button type="button" class="fig" data-go-ply="${f.go.ply}" data-go-line="${esc((f.go.line || []).join(' '))}" title="Show this position on the board" aria-label="${esc((f.tag ? f.tag + ': ' : '') + (f.cap || 'position'))}. Show on the board">${board}${cap}</button>`;
  return `<span class="fig still">${board}${cap}</span>`;
}
const figsHTML = (figs, cls) => (figs.length ? `<div class="figs${cls ? ' ' + cls : ''}">${figs.map(figHTML).join('')}</div>` : '');
/* Frames for a line of moves: one board per move, each showing the position after it.
   steps come from lineSteps()/sanSteps(); base = {fen, ply, pre:[san]} is where the line starts. */
function lineFigs(base, steps, { orient, max = 4, tone = 'coach', firstTag = '', firstTone = '', firstGlyph = null, firstBadge = null } = {}) {
  const out = [];
  let fen = base.fen;
  const sans = [];
  for (let i = 0; i < steps.length && i < max; i++) {
    const s = steps[i];
    sans.push(s.san);
    out.push({
      fen: s.fen,
      orient,
      move: { from: s.from, to: s.to },
      tone: i === 0 ? tone : 'line',
      cap: moveText(fen, s.san) + (i === max - 1 && steps.length > max ? ' …' : ''),
      tag: i === 0 ? firstTag : '',
      tagTone: i === 0 ? firstTone : '',
      glyph: i === 0 ? firstGlyph : null,
      badge: i === 0 && firstBadge ? { sq: s.to, kind: firstBadge } : null,
      go: base.ply != null ? { ply: base.ply, line: (base.pre || []).concat(sans) } : null,
      key: fen + s.from + s.to,
    });
    fen = s.fen;
  }
  return out;
}

/* Floating preview shown while a move in the text is hovered or focused. */
const Pop = { el: null, for: null };
function showPop(target, html) {
  if (!Pop.el) {
    Pop.el = el('div', { class: 'mv-pop', role: 'tooltip', hidden: true });
    document.body.append(Pop.el);
  }
  Pop.el.innerHTML = html;
  Pop.el.hidden = false;
  Pop.for = target;
  const r = target.getBoundingClientRect(),
    pw = Pop.el.offsetWidth,
    ph = Pop.el.offsetHeight;
  const vw = document.documentElement.clientWidth,
    vh = window.innerHeight;
  let x = clamp(r.left + r.width / 2 - pw / 2, 8, Math.max(8, vw - pw - 8));
  let y = r.top - ph - 8;
  if (y < 8) y = Math.min(vh - ph - 8, r.bottom + 8);
  Pop.el.style.left = x + 'px';
  Pop.el.style.top = Math.max(8, y) + 'px';
}
function hidePop() {
  if (Pop.el) Pop.el.hidden = true;
  Pop.for = null;
}
