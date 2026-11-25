/* ================= boot ================= */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => {
      s.remove();
      rej(new Error(src));
    };
    document.head.append(s);
  });
}
async function initClaude() {
  const c = window.claude;
  if (!c || typeof c.use !== 'function') {
    App.sampleReady = true;
    return;
  }
  try {
    const s = await c.use('sample');
    App.sample = s || null;
    if (s && s.limits) {
      try {
        const lim = await s.limits();
        App.toolsOk = !!(lim && lim.tools && lim.tools.maxCount >= 4);
      } catch {
        App.toolsOk = false;
      }
    }
  } catch {
    App.sample = null;
  }
  App.sampleReady = true;
  if (App.game) {
    renderCoach();
    renderChat();
    renderSuggestions();
    renderSummary();
  }
}
function bindUI() {
  $$('.tabs .tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $$('.side-tabs .stab').forEach(b => b.addEventListener('click', () => switchPane(b.dataset.pane)));
  $$('#dlg-games [data-dpane]').forEach(b => b.addEventListener('click', () => switchDPane(b.dataset.dpane)));
  $('#btn-library').addEventListener('click', () => openDialog('library'));
  $('#btn-import').addEventListener('click', () => openDialog('import'));
  $('#dlg-close').addEventListener('click', () => $('#dlg-games').close());
  $('#nav-first').addEventListener('click', () => go(0));
  $('#nav-prev').addEventListener('click', stepBack);
  $('#nav-next').addEventListener('click', stepForward);
  $('#nav-last').addEventListener('click', () => go(App.game.plies.length));
  $('#nav-flip').addEventListener('click', () => {
    App.view.orient = other(App.view.orient);
    updateReview();
  });
  $('#tog-best').addEventListener('click', () => {
    App.view.showBest = !App.view.showBest;
    renderDecor();
    renderToggles();
    renderCoachBody();
  });
  $('#tog-threat').addEventListener('click', () => {
    App.view.showThreat = !App.view.showThreat;
    renderDecor();
    renderToggles();
  });
  $('#tog-loose').addEventListener('click', () => {
    App.view.showLoose = !App.view.showLoose;
    renderDecor();
    renderToggles();
  });
  $('#tog-guess').addEventListener('click', () => {
    App.guess.on = !App.guess.on;
    if (App.guess.on) toast('Guess mode: before each of your moves is revealed, play what you think is best. Press → to skip.');
    renderToggles();
    renderDecor();
    renderCoach();
  });
  $('#graph').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    const N = App.game.plies.length;
    go(Math.round(((e.clientX - r.left) / r.width) * N));
  });
  $('#chat-form').addEventListener('submit', e => {
    e.preventDefault();
    askChat($('#chat-input').value);
  });
  $('#chat-input').addEventListener('input', autosize);
  $('#chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askChat($('#chat-input').value);
    }
  });
  $('#imp-go').addEventListener('click', importPGN);
  const drop = $('#pgn-drop');
  const readFiles = async files => {
    const texts = [];
    for (const f of files) texts.push(await f.text());
    $('#pgn-input').value = ($('#pgn-input').value.trim() + '\n\n' + texts.join('\n\n')).trim();
    $('#imp-result').textContent = `Loaded ${files.length} file${files.length === 1 ? '' : 's'}. Press Import to add them.`;
  };
  drop.addEventListener('dragover', e => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files.length) readFiles([...e.dataTransfer.files]);
  });
  $('#pgn-file').addEventListener('change', e => {
    if (e.target.files.length) readFiles([...e.target.files]);
    e.target.value = '';
  });
  $('#set-user').addEventListener('change', e => {
    App.profile.usernames = e.target.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    saveProfile();
    for (const r of App.library) {
      const c = detectColor(r.headers, App.profile.usernames);
      if (c && c !== r.userColor) {
        r.userColor = c;
        r.stats = null;
        App.runtimes.delete(r.id);
        Store.patchGame(r.id, { userColor: c }).catch(storeError);
        const g = runtimeFor(r);
        if (g.pos.every(Boolean)) {
          r.stats = computeStats(g);
          Store.patchGame(r.id, { stats: r.stats }).catch(storeError);
        }
      }
    }
    if (App.game && !App.game.example) openGame(App.game.id, App.view.ply);
    toast('Usernames saved.');
  });
  $$('input[name="set-strength"]').forEach(i =>
    i.addEventListener('change', () => {
      App.profile.settings.strength = i.value;
      saveProfile();
    }),
  );
  $$('input[name="set-coach"]').forEach(i =>
    i.addEventListener('change', () => {
      App.profile.settings.coach = i.value;
      saveProfile();
    }),
  );
  $$('input[name="set-goal"]').forEach(i =>
    i.addEventListener('change', () => {
      training().goal = +i.value;
      saveProfile();
      refreshDrillCount();
      if (App.tab === 'drills') renderTrain();
    }),
  );
  $('#set-reanalyze').addEventListener('click', () => {
    const g = App.game;
    if (!g) return;
    g.pos = new Array(g.fens.length).fill(null);
    computeCls(g);
    $('#dlg-games').close();
    Analyzer.start(g);
    updateReview();
    toast(`Re-analyzing at ${LEVELS[App.profile.settings.strength].label} strength.`);
  });
  // Moves pane: one click handler for every cell, and the List / Boards switch.
  $('#movelist').addEventListener('click', e => {
    const c = e.target.closest('[data-k]');
    if (c) go(+c.dataset.k);
  });
  $('#movelist').addEventListener('keydown', e => {
    const c = e.target.closest('[data-k]');
    if (c && c.tagName !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      go(+c.dataset.k);
    }
  });
  $$('#moves-view button').forEach(b =>
    b.addEventListener('click', () => {
      App.movesView = b.dataset.view;
      try {
        localStorage.setItem('postmortem.movesView', App.movesView);
      } catch {}
      renderMoveList(true);
    }),
  );
  bindMoveLinks();
  for (const type of ['pointerdown', 'keydown', 'wheel'])
    document.addEventListener(
      type,
      () => {
        Nav.userAt = performance.now();
      },
      { capture: true, passive: true },
    );
  for (const type of ['wheel', 'touchmove']) $('#coach-scroll').addEventListener(type, () => (ChatPin.on = false), { passive: true });
  $('#coach-scroll').addEventListener('scroll', () => (Nav.scrolled = true), { passive: true });
  // Stepping keys work from anywhere in Review except while typing or with a dialog open. Buttons, checkboxes
  // and links keep focus without swallowing the arrows.
  const typing = t => {
    if (!t || !t.closest) return false;
    if (t.id === 'chat-input' && !t.value) return false; // an empty question box has nothing for the arrows to do
    if (t.closest('textarea, select, [contenteditable]')) return true;
    return t.matches('input') && !/^(checkbox|radio|button|submit|range)$/i.test(t.type);
  };
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || App.tab !== 'review' || !App.game) return;
    if (typing(e.target) || document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepBack();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepForward();
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(App.game.plies.length);
    } else if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) {
      App.view.orient = other(App.view.orient);
      updateReview();
    }
  });
}
async function boot() {
  if (!window.Chess) {
    try {
      await loadScript(CHESS_FALLBACK);
    } catch {}
  }
  if (!window.Chess) {
    document.querySelector('main').innerHTML =
      '<div class="panel fatal"><h3 style="margin-top:0;font-family:var(--f-book)">The chess rules library didn’t load</h3><p>Check your connection, then reload the page.</p></div>';
    return;
  }
  board = createBoard($('#board'), { onMove: onBoardMove });
  drillBoard = createBoard($('#drill-board'), { onMove: trainMove });
  bindUI();
  App.exampleRec = {
    id: 'example',
    example: true,
    pgn: EXAMPLE_PGN,
    headers: parseGame(EXAMPLE_PGN).headers,
    userColor: 'w',
    importedAt: 0,
    analysis: null,
    stats: null,
    explanations: {},
    summary: null,
    drills: {},
    chat: [],
  };
  App.game = runtimeFor(App.exampleRec);
  App.view.orient = 'w';
  try {
    App.movesView = localStorage.getItem('postmortem.movesView') === 'boards' ? 'boards' : 'list';
  } catch {}
  updateTitle();
  updateReview();
  renderChat();
  renderStatus();
  initClaude();
  await Store.init();
  try {
    const prof = await Store.loadProfile();
    if (prof) App.profile = { ...App.profile, ...prof, settings: { ...App.profile.settings, ...(prof.settings || {}) } };
  } catch (e) {
    console.warn(e);
  }
  try {
    App.library = await Store.listGames();
  } catch (e) {
    console.warn(e);
    App.library = [];
  }
  App.library = App.library.filter(r => r && r.id && r.pgn);
  if (App.library.length) {
    const latest = App.library.slice().sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0))[0];
    openGame(latest.id);
  } else setGame(App.game);
  refreshDrillCount();
  // Handles for the test suite.
  window.__pm = App;
  window.__pmTrain = Train;
  window.__pmT = { legalSan, posInfo, buildInfo, fenAfter, lineSteps, sanSteps, checkSquare, lineSwing, miniBoardHTML, parseGame, movesOf };
}
boot();
