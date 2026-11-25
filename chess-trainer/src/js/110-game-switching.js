/* ================= game switching ================= */
function updateTitle() {
  $('#game-title').textContent = App.game ? gameTitle(App.game.rec) : 'Your games';
}
function openGame(id, ply) {
  const rec = App.library.find(r => r.id === id);
  if (!rec) return;
  let g;
  try {
    g = runtimeFor(rec);
  } catch (e) {
    toast('That game couldn’t be opened: ' + e.message);
    return;
  }
  setGame(g, ply);
}
function openExample() {
  setGame(runtimeFor(App.exampleRec));
}
function setGame(g, ply) {
  App.game = g;
  App.view = {
    ply: ply != null ? ply : 0,
    explore: null,
    orient: g.userColor,
    showBest: App.view.showBest,
    showThreat: App.view.showThreat,
    showLoose: App.view.showLoose,
  };
  App.summaryBusy = null;
  App.coachArrows = [];
  App.coachSquares = [];
  App.guess.res = {};
  updateTitle();
  updateReview();
  renderChat();
  renderStatus();
  renderSummary();
  Analyzer.start(g);
  scheduleAutoExplain();
}
function onPositionAnalyzed(g, i) {
  if (App.game !== g) return;
  computeCls(g);
  if (App.tab !== 'review') return;
  renderStatus();
  renderGraph();
  const k = App.view.ply;
  if ((i === k || i === k - 1) && !App.view.explore) {
    renderDecor();
    renderEvalBar();
    coachHead();
    const job = jobFor(g, k);
    if (!Nav.dirty && !(job && job.status === 'running')) renderCoachBody();
    renderSuggestions();
  }
  if (!$('#pane-moves').hidden && i % 6 === 0) renderMoveList();
}
function onAnalysisDone(g) {
  refreshDrillCount();
  renderStatus();
  if (App.game === g) {
    renderGraph();
    renderMoveList();
    renderCoach();
    renderSummary();
  }
  if (App.tab === 'drills' && !Train.ex) renderTrain();
  if (App.tab === 'progress' && !App.planBusy) renderProgress();
  if (App.tab === 'review' && $('#dlg-games').open && !$('#dpane-library').hidden) renderLibrary();
  setTimeout(continueBackground, 250);
}
/* Once the open game is graded, keep grading the rest of the library so Drills and Progress fill in. */
function continueBackground() {
  if (Analyzer.error || !App.game || !App.game.pos.every(Boolean)) {
    renderStatus();
    return;
  }
  if (Analyzer.game && Analyzer.game !== App.game && !Analyzer.game.pos.every(Boolean)) return;
  const next = App.library.find(r => !(r.analysis && r.analysis.complete) && r.id !== App.game.id && !r.broken);
  if (!next) {
    Analyzer.game = App.game;
    renderStatus();
    return;
  }
  let g;
  try {
    g = runtimeFor(next);
  } catch {
    next.broken = true;
    continueBackground();
    return;
  }
  Analyzer.start(g);
  renderStatus();
}
