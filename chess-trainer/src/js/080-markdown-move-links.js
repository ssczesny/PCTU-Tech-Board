/* ================= markdown & move links ================= */
function md(text) {
  const lines = esc(noDash(text)).split('\n');
  let html = '',
    list = false,
    para = [];
  const inline = s =>
    s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const flush = () => {
    if (para.length) {
      html += `<p>${inline(para.join(' '))}</p>`;
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    const li = /^[-*•]\s+(.*)$/.exec(line);
    if (li) {
      flush();
      if (!list) {
        html += '<ul>';
        list = true;
      }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }
    if (list) {
      html += '</ul>';
      list = false;
    }
    if (!line) {
      flush();
      continue;
    }
    const hd = /^#{1,6}\s+(.*)$/.exec(line);
    if (hd) {
      flush();
      html += `<p class="md-h">${inline(hd[1])}</p>`;
      continue;
    }
    para.push(line);
  }
  flush();
  if (list) html += '</ul>';
  return html;
}

/* Notation in running text: an optional move number ("15." or "15..."), then a move. */
const SAN_RE =
  /(?:^|[^\w])((?:(\d+)(\.\.\.|\.)\s?)?(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=?[QRBN])?|[a-h][1-8](?:=?[QRBN])?)[+#]?)(?![\w])/g;
/* A following move continues the previous one's line unless a sentence ended in between. */
const lineGapOK = gap => gap.length <= 48 && !/[A-Za-z)\]"’'][.!?](\s|$)/.test(gap);

/* Turn notation inside `container` into .mv links and, with opts.figs, add a strip of small boards under each
   paragraph or list item that walks through moves.
   bases: [{fen, ply, pre}] positions the text may be talking about, most likely first. `ply`/`pre` say how to
   reach the position on the main board (game ply, then extra moves); ply null = not on the main board.
   A move is matched against the line being followed first ("15. Rg1 Qe7 16. Qd2"), then against the bases. */
function linkMoves(container, bases, opts = {}) {
  if (!container || !bases || !bases.length) return;
  const orient = opts.orient || 'w';
  const seen = opts.seen || new Set();
  let budget = opts.figs ? (opts.maxFigs == null ? 10 : opts.maxFigs) : 0;
  let blocks = [...container.querySelectorAll('p, li')];
  if (!blocks.length) blocks = [container];
  for (const block of blocks) {
    const lines = linkBlock(block, bases);
    if (budget <= 0) continue;
    let figs = [];
    for (const ln of lines) {
      const frames = lineFigs(ln.base, ln.steps, { orient, max: 4, tone: 'coach' });
      if (frames.every(f => seen.has(f.key))) continue;
      frames.forEach(f => seen.add(f.key));
      figs = figs.concat(frames);
    }
    figs = figs.slice(0, budget);
    budget -= figs.length;
    if (!figs.length) continue;
    const html = figsHTML(figs);
    if (block.tagName === 'LI') block.insertAdjacentHTML('beforeend', html);
    else if (block === container) block.insertAdjacentHTML('beforeend', html);
    else block.insertAdjacentHTML('afterend', html);
  }
}
function linkBlock(block, bases) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.parentElement.closest('.mv, code, .figs')) nodes.push(n);
  }
  const lines = [];
  let line = null,
    gap = '';
  for (const node of nodes) {
    const s = node.nodeValue;
    SAN_RE.lastIndex = 0;
    let m,
      last = 0,
      any = false;
    const frag = document.createDocumentFragment();
    while ((m = SAN_RE.exec(s))) {
      const whole = m[1],
        num = m[2] ? +m[2] : null,
        dots = m[3],
        san = m[4];
      const start = m.index + m[0].indexOf(whole);
      if (/^[a-h][1-8]$/.test(san) && num == null) continue; // a bare square is not a move
      const color = dots ? (dots === '...' ? 'b' : 'w') : null;
      const fits = fen => (!color || fenTurn(fen) === color) && (num == null || fenFull(fen) === num);
      const here = gap + s.slice(last, start);
      let hit = null,
        base = null,
        cont = false;
      if (line && lineGapOK(here) && fits(line.fen) && (hit = legalSan(line.fen, san))) cont = true;
      if (!hit)
        for (const b of bases)
          if (fits(b.fen) && (hit = legalSan(b.fen, san))) {
            base = b;
            break;
          }
      if (!hit && line && fits(line.fen) && (hit = legalSan(line.fen, san))) cont = true;
      if (!hit) continue;
      const before = cont ? line.fen : base.fen;
      const after = fenAfter(before, hit);
      if (!after) continue;
      const step = { san: hit.san, from: hit.from, to: hit.to, color: hit.color, promotion: hit.promotion || null, fen: after };
      if (cont) line.steps.push(step);
      else {
        line = { base, steps: [step], fen: before };
        lines.push(line);
      }
      line.fen = after;
      const pre = (line.base.pre || []).concat(line.steps.slice(0, -1).map(x => x.san));
      frag.append(s.slice(last, start));
      const sp = document.createElement('span');
      sp.className = 'mv';
      sp.tabIndex = 0;
      sp.setAttribute('role', 'button');
      sp.dataset.fen = before;
      sp.dataset.from = hit.from;
      sp.dataset.to = hit.to;
      sp.dataset.san = hit.san;
      sp.dataset.ply = line.base.ply == null ? '' : line.base.ply;
      sp.dataset.pre = pre.join(' ');
      sp.textContent = whole;
      frag.append(sp);
      last = start + whole.length;
      gap = '';
      any = true;
    }
    gap += s.slice(last);
    if (any) {
      frag.append(s.slice(last));
      node.replaceWith(frag);
    }
  }
  return lines;
}

/* One set of listeners for every move link and board picture on the page. */
const coarsePointer = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
const viewOrient = () => (App.tab === 'drills' ? (Train.ex ? Train.ex.me : 'w') : App.view.orient);
function mvData(e) {
  const d = e.dataset;
  return { fen: d.fen, from: d.from, to: d.to, san: d.san, ply: d.ply === '' || d.ply == null ? null : +d.ply, pre: d.pre ? d.pre.split(' ') : [] };
}
function previewMove(t) {
  const d = mvData(t);
  if (!d.fen || !validSq(d.from) || !validSq(d.to)) return;
  const mv = posInfo(d.fen).moves.find(
    x => x.from === d.from && x.to === d.to && (!x.promotion || x.san.replace(/[+#]/g, '') === d.san.replace(/[+#]/g, '')),
  );
  const after = mv ? fenAfter(d.fen, mv) : null;
  if (!after) return;
  showPop(
    t,
    miniBoardHTML(after, { orient: viewOrient(), move: { from: d.from, to: d.to }, tone: 'hover' }) +
      `<span class="fc">${esc(moveText(d.fen, d.san))}</span>` +
      (d.ply != null
        ? `<span class="pop-hint">${coarsePointer() ? 'Tap again to play it on the board' : 'Click to play it on the board'}</span>`
        : ''),
  );
  if (App.tab === 'review' && App.game && d.fen === curFen()) {
    App.hover = { from: d.from, to: d.to };
    renderDecor();
  }
}
function endPreview() {
  hidePop();
  if (App.hover) {
    App.hover = null;
    if (App.tab === 'review' && App.game) renderDecor();
  }
}
function playLink(d) {
  endPreview();
  if (d.ply == null || App.tab !== 'review') return;
  openLine(d.ply, d.pre.concat(d.san));
}
function bindMoveLinks() {
  const mvOf = e => (e.target && e.target.closest ? e.target.closest('.mv') : null);
  document.addEventListener('mouseover', e => {
    const t = mvOf(e);
    if (t && t !== Pop.for && !coarsePointer()) previewMove(t);
  });
  document.addEventListener('mouseout', e => {
    const t = mvOf(e);
    if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) endPreview();
  });
  document.addEventListener('focusin', e => {
    const t = mvOf(e);
    if (t && !coarsePointer()) previewMove(t);
  });
  document.addEventListener('focusout', e => {
    if (mvOf(e)) endPreview();
  });
  document.addEventListener('click', e => {
    const t = mvOf(e);
    if (t) {
      // Touch has no hover: the first tap shows the board, a second tap on the same move plays it.
      if (coarsePointer() && Pop.for !== t) {
        previewMove(t);
        return;
      }
      playLink(mvData(t));
      return;
    }
    if (Pop.for) endPreview();
    const f = e.target && e.target.closest ? e.target.closest('.fig[data-go-ply]') : null;
    if (f) openLine(+f.dataset.goPly, f.dataset.goLine ? f.dataset.goLine.split(' ') : []);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = mvOf(e);
    if (!t) return;
    e.preventDefault();
    playLink(mvData(t));
  });
  window.addEventListener('scroll', hidePop, true);
}
