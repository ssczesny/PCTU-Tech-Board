/* ================= PGN parsing ================= */
function splitPGN(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const games = [];
  let cur = { head: [], body: [] };
  let inBody = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^\[\w+\s+".*"\]$/.test(t)) {
      if (inBody) {
        games.push(cur);
        cur = { head: [], body: [] };
        inBody = false;
      }
      cur.head.push(t);
    } else {
      if (t) inBody = true;
      cur.body.push(line);
    }
  }
  games.push(cur);
  return games.map(g => (g.head.join('\n') + '\n\n' + g.body.join('\n')).trim()).filter(s => /[a-hNBRQKO][1-8x-]/.test(s.replace(/\[[^\]]*\]/g, '')));
}
function tokenize(s) {
  const out = [];
  let i = 0;
  const n = s.length;
  const attach = com => {
    const last = out[out.length - 1];
    if (!last) return;
    const m = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(com);
    if (m) last.clk = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  };
  while (i < n) {
    const c = s[i];
    if (c === '{') {
      const j = s.indexOf('}', i + 1);
      attach(s.slice(i + 1, j < 0 ? n : j));
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (c === ';') {
      const j = s.indexOf('\n', i);
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (c === '(') {
      let d = 1;
      i++;
      while (i < n && d > 0) {
        if (s[i] === '{') {
          const j = s.indexOf('}', i + 1);
          i = j < 0 ? n : j + 1;
          continue;
        }
        if (s[i] === '(') d++;
        else if (s[i] === ')') d--;
        i++;
      }
      continue;
    }
    if (/\s/.test(c) || c === ')') {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !/[\s{}();]/.test(s[j])) j++;
    let tok = s.slice(i, j);
    i = j;
    if (/^\$\d+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(tok)) continue;
    tok = tok.replace(/^\d+\.+/, '').replace(/^…/, '');
    if (!tok || /^\d+\.*$/.test(tok)) continue;
    tok = tok
      .replace(/[!?]+$/, '')
      .replace(/e\.p\.$/, '')
      .replace(/^0-0-0/, 'O-O-O')
      .replace(/^0-0/, 'O-O');
    if (tok) out.push({ san: tok, clk: null });
  }
  return out;
}
function parseGame(pgn) {
  const headers = {};
  const re = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
  let m;
  while ((m = re.exec(pgn))) headers[m[1]] = m[2].replace(/\\"/g, '"');
  const body = pgn.replace(re, '');
  let fen = START_FEN;
  if (headers.FEN) {
    // chess.js validates and normalises a custom start position; the moves are read by the fast rules module.
    const chess = new Chess();
    if (!chess.load(headers.FEN)) throw new Error('The FEN header is not a valid position.');
    fen = chess.fen();
  }
  const startFen = fen;
  const fens = [fen],
    plies = [];
  for (const t of tokenize(body)) {
    const info = buildInfo(fen);
    const mv = matchSan(info, t.san);
    if (!mv) {
      const n = Math.floor(plies.length / 2) + 1;
      throw new Error(`Could not read move "${t.san}" (around move ${n}).`);
    }
    fen = posFen(applyMove(info.P, mv));
    plies.push({
      san: mv.san,
      from: mv.from,
      to: mv.to,
      color: mv.color,
      piece: mv.piece,
      captured: mv.captured || null,
      promotion: mv.promotion || null,
      flags: mv.flags,
      clk: t.clk,
    });
    fens.push(fen);
  }
  if (!plies.length) throw new Error('No moves found in this game.');
  return { headers, plies, fens, startFen };
}
function timeControl(h) {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(h.TimeControl || '');
  return m ? { base: +m[1], inc: +(m[2] || 0) } : null;
}
function tcText(h) {
  const tc = timeControl(h);
  if (!tc) return '';
  const mins = tc.base / 60;
  return `${mins >= 1 ? +mins.toFixed(1) : tc.base + 's'}${mins >= 1 ? ' min' : ''}${tc.inc ? ` + ${tc.inc}s` : ''}`;
}
function openingName(h) {
  if (h.Opening && h.Opening !== '?') return h.Opening;
  if (h.ECOUrl) {
    const seg = decodeURIComponent(h.ECOUrl.split('/').pop() || '');
    return seg
      .replace(/-/g, ' ')
      .replace(/\s\d+\..*$/, '')
      .trim();
  }
  return '';
}
function gameDate(h) {
  const d = (h.UTCDate || h.Date || '').replace(/\./g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}
function fmtDate(d) {
  if (!d) return '';
  const [y, mo, da] = d.split('-').map(Number);
  return new Date(y, mo - 1, da).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function detectColor(h, names) {
  const ns = names.map(s => s.trim().toLowerCase()).filter(Boolean);
  if (ns.includes((h.White || '').toLowerCase())) return 'w';
  if (ns.includes((h.Black || '').toLowerCase())) return 'b';
  return null;
}
function resultFor(rec) {
  const r = rec.headers.Result;
  if (r === '1/2-1/2') return 'D';
  if (r === '1-0') return rec.userColor === 'w' ? 'W' : 'L';
  if (r === '0-1') return rec.userColor === 'b' ? 'W' : 'L';
  return '';
}
function opponentOf(rec) {
  const h = rec.headers;
  return rec.userColor === 'w' ? h.Black || 'Black' : h.White || 'White';
}
function opponentElo(rec) {
  const h = rec.headers;
  return rec.userColor === 'w' ? h.BlackElo : h.WhiteElo;
}
function userElo(rec) {
  const h = rec.headers;
  const v = rec.userColor === 'w' ? h.WhiteElo : h.BlackElo;
  return v && /^\d+$/.test(v) ? +v : null;
}
function gameTitle(rec) {
  return `${rec.example ? 'Example: ' : ''}vs ${opponentOf(rec)}${rec.headers && gameDate(rec.headers) ? ' · ' + fmtDate(gameDate(rec.headers)) : ''}`;
}
