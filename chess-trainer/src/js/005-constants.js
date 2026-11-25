/* ================= constants ================= */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SF_URLS = window.__PM_SF_URLS || [
  'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
  'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
];
const CHESS_FALLBACK = 'https://cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.js';
const LEVELS = {
  fast: { depth: 11, ms: 700, label: 'Fast' },
  standard: { depth: 13, ms: 1400, label: 'Standard' },
  deep: { depth: 16, ms: 3500, label: 'Deep' },
};
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const KINDS = {
  best: { label: 'Best', glyph: '!' },
  excellent: { label: 'Excellent', glyph: '✓' },
  good: { label: 'Good', glyph: '✓' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!' },
  mistake: { label: 'Mistake', glyph: '?' },
  blunder: { label: 'Blunder', glyph: '??' },
  miss: { label: 'Miss', glyph: '×' },
};
const BAD = new Set(['inaccuracy', 'mistake', 'blunder', 'miss']);
const SERIOUS = new Set(['mistake', 'blunder', 'miss']);
const FILES = 'abcdefgh';
const SVGNS = 'http://www.w3.org/2000/svg';
const LS_KEY = 'postmortem.v1';
const OFF_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);

// EXAMPLE_PGN, PUZZLES and LESSONS are defined by build.py from src/data/.
