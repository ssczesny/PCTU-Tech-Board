/* ================= app state ================= */
const App = {
  profile: { usernames: [], settings: { strength: 'standard', coach: 'auto', autoCoach: true }, plan: null },
  library: [],
  runtimes: new Map(),
  game: null,
  view: { ply: 0, explore: null, orient: 'w', showBest: false, showThreat: false, showLoose: false },
  tab: 'review',
  pane: 'coach',
  movesView: 'list',
  sample: null,
  sampleReady: false,
  sampleOff: null,
  consented: false,
  toolsOk: false,
  jobs: [],
  autoPausedUntil: 0,
  coachArrows: [],
  coachSquares: [],
  hover: null,
  guess: { on: false, res: {} },
};
let board, drillBoard;

function buildRuntime(rec) {
  const p = parseGame(rec.pgn);
  const g = { rec, id: rec.id, userColor: rec.userColor, headers: p.headers, plies: p.plies, fens: p.fens, example: !!rec.example };
  const stored = rec.analysis && Array.isArray(rec.analysis.pos) && rec.analysis.pos.length === p.fens.length ? rec.analysis.pos : null;
  g.pos = stored ? stored.map(x => (x ? { ...x } : null)) : new Array(p.fens.length).fill(null);
  g.explanations = rec.explanations || (rec.explanations = {});
  g.drills = rec.drills || (rec.drills = {});
  g.chat = rec.chat || (rec.chat = []);
  g.summary = rec.summary || null;
  computeCls(g);
  return g;
}
function runtimeFor(rec) {
  let g = App.runtimes.get(rec.id);
  if (!g || g.rec !== rec) {
    g = buildRuntime(rec);
    App.runtimes.set(rec.id, g);
  }
  return g;
}
function saveGame(g, patch) {
  deepMerge(g.rec, clone(patch));
  if (g.example) return Promise.resolve();
  return Store.patchGame(g.id, patch).catch(storeError);
}
function saveAnalysis(g, final) {
  const patch = { analysis: { level: App.profile.settings.strength, pos: g.pos.map(p => p || null), complete: !!final } };
  if (final) patch.stats = computeStats(g);
  return saveGame(g, patch);
}
function saveProfile() {
  return Store.saveProfile(App.profile).catch(storeError);
}
