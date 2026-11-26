/* ================= board component ================= */
function createBoard(root, opts = {}) {
  root.classList.add('board');
  root.innerHTML = '';
  const sqL = el('div', { class: 'sq-layer' }),
    mkL = el('div', { class: 'mark-layer' }),
    pcL = el('div', { class: 'pc-layer' }),
    bdL = el('div', { class: 'badge-layer' });
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'arrow-layer');
  svg.setAttribute('viewBox', '0 0 800 800');
  svg.setAttribute('aria-hidden', 'true');
  const promo = el('div', { class: 'promo', hidden: true });
  root.append(sqL, mkL, pcL, svg, bdL, promo);
  let orient = 'w',
    pieces = new Map(),
    marks = [],
    arrows = [],
    badge = null,
    dests = null,
    destsFn = null,
    selected = null,
    drag = null,
    interactive = false,
    lastFen = null,
    promoDone = null;
  const xy = sq => {
    const f = FILES.indexOf(sq[0]),
      r = +sq[1] - 1;
    return orient === 'w' ? [f, 7 - r] : [7 - f, r];
  };
  const sqAt = (x, y) => {
    const f = orient === 'w' ? x : 7 - x,
      r = orient === 'w' ? 7 - y : y;
    return FILES[f] + (r + 1);
  };
  const place = (e, sq) => {
    const [x, y] = xy(sq);
    e.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  };
  function drawSquares() {
    sqL.innerHTML = '';
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const sq = sqAt(x, y),
          f = FILES.indexOf(sq[0]),
          r = +sq[1];
        const d = el('div', { class: 'sq ' + ((f + r) % 2 ? 'd' : 'l') });
        if (y === 7) d.append(el('span', { class: 'coord file', text: sq[0] }));
        if (x === 0) d.append(el('span', { class: 'coord rank', text: sq[1] }));
        sqL.append(d);
      }
  }
  /* animate=false snaps: pieces jump with no transition (held arrow key, long jumps). */
  function setPosition(fen, animate = true) {
    if (fen === lastFen && pieces.size) return;
    // The position is changing under the student's hand: let go of a held piece and close the promotion
    // picker first, so nothing is dropped back onto a square that now belongs to another position.
    if (drag) {
      drag.el.classList.remove('drag');
      place(drag.el, drag.from);
      try {
        root.releasePointerCapture(drag.id);
      } catch {}
      drag = null;
    }
    if (promoDone) promoDone(null);
    lastFen = fen;
    dests = null;
    root.classList.toggle('snap', !animate);
    for (const e of pcL.querySelectorAll('.gone')) e.remove();
    const next = fenPieces(fen);
    const kept = new Map();
    const left = [];
    for (const [sq, p] of pieces) {
      if (next.get(sq) === p.code) kept.set(sq, p);
      else left.push({ sq, ...p });
    }
    const dist = (a, b) => Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])) + Math.abs(+a[1] - +b[1]);
    for (const [sq, code] of next) {
      if (kept.has(sq)) continue;
      let bi = -1,
        bd = 99;
      left.forEach((l, i) => {
        if (!l.used && l.code === code) {
          const d = dist(l.sq, sq);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
      });
      if (bi >= 0 && animate) {
        const l = left[bi];
        l.used = true;
        place(l.el, sq);
        kept.set(sq, { el: l.el, code });
      } else {
        const e = el('div', { class: 'pc pc-' + code });
        place(e, sq);
        pcL.append(e);
        kept.set(sq, { el: e, code });
      }
    }
    for (const l of left)
      if (!l.used) {
        if (animate) {
          l.el.classList.add('gone');
          setTimeout(() => l.el.remove(), 170);
        } else l.el.remove();
      }
    pieces = kept;
    selected = null;
  }
  function drawMarks() {
    mkL.innerHTML = '';
    const add = (sq, kind) => {
      const e = el('div', { class: 'mk ' + kind });
      place(e, sq);
      mkL.append(e);
    };
    for (const m of marks) add(m.sq, m.kind);
    if (selected) {
      add(selected, 'sel');
      for (const t of (dests && dests.get(selected)) || []) add(t, pieces.has(t) ? 'cap' : 'dot');
    }
  }
  function drawArrows() {
    svg.innerHTML = '';
    for (const a of arrows) {
      if (!a || !a.from || !a.to || a.from === a.to) continue;
      const [x1, y1] = xy(a.from),
        [x2, y2] = xy(a.to);
      const sx = x1 * 100 + 50,
        sy = y1 * 100 + 50,
        ex = x2 * 100 + 50,
        ey = y2 * 100 + 50;
      const dx = ex - sx,
        dy = ey - sy,
        len = Math.hypot(dx, dy),
        ux = dx / len,
        uy = dy / len,
        px = -uy,
        py = ux;
      const head = 38,
        hw = 26,
        w = a.width || 15;
      const tx = ex - ux * 8,
        ty = ey - uy * 8,
        bx = tx - ux * head,
        by = ty - uy * head;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('opacity', a.opacity || 0.82);
      g.style.color = a.color;
      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', sx + ux * 16);
      line.setAttribute('y1', sy + uy * 16);
      line.setAttribute('x2', bx + ux * 2);
      line.setAttribute('y2', by + uy * 2);
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', w);
      line.setAttribute('stroke-linecap', 'round');
      const poly = document.createElementNS(SVGNS, 'polygon');
      poly.setAttribute('points', `${tx},${ty} ${bx + px * hw},${by + py * hw} ${bx - px * hw},${by - py * hw}`);
      poly.setAttribute('fill', 'currentColor');
      g.append(line, poly);
      svg.append(g);
    }
  }
  function drawBadge() {
    bdL.innerHTML = '';
    if (!badge) return;
    const e = el('div', { class: 'badge' }, el('span', { class: 'k-' + badge.kind, text: KINDS[badge.kind].glyph }));
    place(e, badge.sq);
    bdL.append(e);
  }
  const evSq = e => {
    const r = root.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * 8),
      y = Math.floor(((e.clientY - r.top) / r.height) * 8);
    return x < 0 || x > 7 || y < 0 || y > 7 ? null : sqAt(x, y);
  };
  async function tryMove(from, to) {
    const p = pieces.get(from);
    let pr;
    if (p && p.code[1] === 'P' && (to[1] === '8' || to[1] === '1')) {
      pr = await askPromo(p.code[0], to);
      if (!pr) {
        if (pieces.get(from) === p) place(p.el, from);
        drawMarks();
        return;
      }
    }
    let ok = false;
    try {
      ok = await opts.onMove(from, to, pr);
    } catch (e) {
      console.error(e);
    }
    if (!ok && p && pieces.get(from) === p) place(p.el, from);
    selected = null;
    drawMarks();
  }
  function askPromo(color, to) {
    return new Promise(res => {
      const [x, y] = xy(to);
      promo.innerHTML = '';
      promo.hidden = false;
      promo.style.left = x * 12.5 + '%';
      promo.style.top = y < 4 ? y * 12.5 + '%' : '';
      promo.style.bottom = y >= 4 ? (7 - y) * 12.5 + '%' : '';
      const done = v => {
        promo.hidden = true;
        promoDone = null;
        document.removeEventListener('pointerdown', outside, true);
        res(v);
      };
      promoDone = done;
      const outside = e => {
        if (!promo.contains(e.target)) done(null);
      };
      for (const t of 'qnrb')
        promo.append(
          el('button', { type: 'button', 'aria-label': 'Promote to ' + PNAME[t], class: 'pc-' + color + t.toUpperCase(), onclick: () => done(t) }),
        );
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    });
  }
  root.addEventListener('pointerdown', e => {
    if (!interactive || e.button > 0 || !promo.hidden) return;
    const sq = evSq(e);
    if (!sq) return;
    if (!dests && destsFn) dests = destsFn(); // legal moves are looked up on first touch, not on every step
    if (selected && dests && (dests.get(selected) || []).includes(sq)) {
      const f = selected;
      selected = null;
      tryMove(f, sq);
      return;
    }
    const p = pieces.get(sq);
    if (p && dests && dests.has(sq)) {
      selected = sq;
      drawMarks();
      drag = { from: sq, el: p.el, id: e.pointerId, r: root.getBoundingClientRect(), moved: false, x0: e.clientX, y0: e.clientY };
      try {
        root.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
    } else if (selected) {
      selected = null;
      drawMarks();
    }
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    drag.el.classList.add('drag');
    const s = drag.r.width / 8;
    const x = (e.clientX - drag.r.left) / s - 0.5,
      y = (e.clientY - drag.r.top) / s - 0.5;
    drag.el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  });
  const endDrag = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('drag');
    if (!d.moved) return;
    const sq = cancel ? null : evSq(e);
    if (sq && sq !== d.from && dests && (dests.get(d.from) || []).includes(sq)) {
      selected = null;
      tryMove(d.from, sq);
    } else {
      place(d.el, d.from);
    }
  };
  root.addEventListener('pointerup', e => endDrag(e, false));
  root.addEventListener('pointercancel', e => endDrag(e, true));
  drawSquares();
  return {
    setPosition,
    setOrientation(o) {
      if (o === orient) return;
      orient = o;
      drawSquares();
      for (const [sq, p] of pieces) place(p.el, sq);
      drawMarks();
      drawArrows();
      drawBadge();
    },
    get orientation() {
      return orient;
    },
    setDecor({ marks: m = [], arrows: a = [], badge: b = null } = {}) {
      marks = m;
      arrows = a;
      badge = b;
      drawMarks();
      drawArrows();
      drawBadge();
    },
    /* d: a Map of from-square -> [to-squares], or a function returning one (called lazily). */
    setInteractive(on, d) {
      interactive = on;
      destsFn = on && typeof d === 'function' ? d : null;
      dests = on && d && typeof d !== 'function' ? d : null;
      root.classList.toggle('interactive', on);
      if (!on && selected) {
        selected = null;
        drawMarks();
      }
    },
    get fen() {
      return lastFen;
    },
  };
}
