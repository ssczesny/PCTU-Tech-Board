/* ================= tabs ================= */
function switchTab(t) {
  App.tab = t;
  $$('.tabs .tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $('#view-review').hidden = t !== 'review';
  $('#view-drills').hidden = t !== 'drills';
  $('#view-progress').hidden = t !== 'progress';
  if (t === 'drills') openDrills();
  if (t === 'progress') renderProgress();
  if (t === 'review' && App.game) updateReview();
}
function switchPane(p) {
  App.pane = p;
  $$('.side-tabs .stab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === p)));
  for (const id of ['coach', 'moves', 'summary']) $('#pane-' + id).hidden = id !== p;
  if (p === 'moves') renderMoveList();
  if (p === 'summary') renderSummary();
}
