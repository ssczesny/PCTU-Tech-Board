/* ================= library & import ================= */
function openDialog(pane) {
  const d = $('#dlg-games');
  switchDPane(pane || 'library');
  if (!d.open) d.showModal();
}
function switchDPane(p) {
  $$('#dlg-games [data-dpane]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.dpane === p)));
  for (const id of ['library', 'import', 'settings']) $('#dpane-' + id).hidden = id !== p;
  if (p === 'library') renderLibrary();
  if (p === 'settings') renderSettings();
  if (p === 'import') {
    $('#imp-user').value = App.profile.usernames.join(', ');
    setTimeout(() => $('#pgn-input').focus(), 30);
  }
}
function renderLibrary() {
  const box = $('#dpane-library');
  box.innerHTML = '';
  if (!App.library.length) {
    box.append(
      el(
        'div',
        { class: 'empty-state', style: 'padding:6px 0' },
        el('h3', { text: 'No games yet' }),
        el('p', {
          text: 'You’re looking at an example game. Import your own games from Chess.com or Lichess and they’ll be listed here, graded and ready to review.',
        }),
        el('button', { class: 'btn primary', onclick: () => switchDPane('import'), text: 'Import games' }),
      ),
    );
    return;
  }
  const list = el('div', { class: 'lib-list' });
  const sorted = App.library
    .slice()
    .sort((a, b) => (gameDate(b.headers) || '').localeCompare(gameDate(a.headers) || '') || (b.importedAt || 0) - (a.importedAt || 0));
  for (const r of sorted) {
    const res = resultFor(r);
    const s = r.stats;
    const sub = [
      fmtDate(gameDate(r.headers)),
      `${colorName(r.userColor)}`,
      tcText(r.headers),
      openingName(r.headers),
      s && s.acc != null ? `accuracy ${s.acc.toFixed(1)}` : Analyzer.game && Analyzer.game.id === r.id ? 'grading now' : 'waiting to be graded',
      s ? `${s.counts.blunder} blunder${s.counts.blunder === 1 ? '' : 's'}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const item = el(
      'div',
      { class: 'lib-item' + (App.game && App.game.id === r.id ? ' cur' : '') },
      el('span', { class: 'res ' + (res || 'D'), text: res || '?' }),
      el(
        'div',
        {
          class: 'li-main',
          onclick: () => {
            $('#dlg-games').close();
            switchTab('review');
            openGame(r.id);
          },
        },
        el('div', { class: 'li-title', text: `vs ${opponentOf(r)}${opponentElo(r) ? ` (${opponentElo(r)})` : ''}` }),
        el('div', { class: 'li-sub', text: sub }),
      ),
      el('div', { class: 'li-act' }),
    );
    const act = $('.li-act', item);
    const del = el('button', {
      class: 'btn small quiet',
      text: 'Delete',
      onclick: () => {
        act.replaceChildren(
          el('span', { class: 'note', text: 'Delete this game?' }),
          el('button', { class: 'btn small', text: 'Delete', onclick: () => deleteGame(r.id) }),
          el('button', { class: 'btn small quiet', text: 'Keep', onclick: () => renderLibrary() }),
        );
      },
    });
    act.append(
      el('button', {
        class: 'btn small',
        text: 'Open',
        onclick: () => {
          $('#dlg-games').close();
          switchTab('review');
          openGame(r.id);
        },
      }),
      del,
    );
    list.append(item);
  }
  box.append(list);
}
async function deleteGame(id) {
  App.library = App.library.filter(r => r.id !== id);
  App.runtimes.delete(id);
  try {
    await Store.deleteGame(id);
  } catch (e) {
    storeError(e);
  }
  if (App.game && App.game.id === id) {
    if (App.library.length) openGame(App.library[0].id);
    else openExample();
  }
  renderLibrary();
  refreshDrillCount();
  updateTitle();
}
function renderSettings() {
  $('#set-user').value = App.profile.usernames.join(', ');
  $$('input[name="set-strength"]').forEach(i => {
    i.checked = i.value === App.profile.settings.strength;
  });
  $$('input[name="set-coach"]').forEach(i => {
    i.checked = i.value === App.profile.settings.coach;
  });
  $$('input[name="set-goal"]').forEach(i => {
    i.checked = +i.value === training().goal;
  });
  $('#set-storage').textContent =
    Store.mode === 'cloud'
      ? 'Your games are saved to your Claude account and only you can see them.'
      : Store.mode === 'local'
        ? 'Your games are saved in this browser only.'
        : 'Saving isn’t available here, so games last until you close this tab.';
}
async function importPGN() {
  const text = $('#pgn-input').value;
  const out = $('#imp-result');
  out.className = 'import-result';
  const names = $('#imp-user')
    .value.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (names.length) {
    App.profile.usernames = names;
    saveProfile();
  }
  const side = ($('input[name="imp-side"]:checked') || {}).value || 'auto';
  const chunks = splitPGN(text);
  if (!chunks.length) {
    out.classList.add('err');
    out.textContent = 'No games found. Paste the PGN text, including the moves.';
    return;
  }
  const added = [],
    errors = [];
  let dupes = 0,
    unknownSide = 0;
  const goBtn = $('#imp-go');
  goBtn.disabled = true;
  for (let i = 0; i < chunks.length; i++) {
    const pgn = chunks[i];
    // A big archive is read in slices so the page keeps responding and shows where it is.
    if (i && i % 25 === 0) {
      out.textContent = `Reading game ${i} of ${chunks.length}…`;
      await new Promise(r => setTimeout(r, 0));
    }
    try {
      const p = parseGame(pgn);
      const id =
        'g' +
        hash(
          [p.headers.Link || '', p.headers.White, p.headers.Black, p.headers.Date, p.headers.UTCTime || '', p.plies.map(x => x.san).join(' ')].join(
            '|',
          ),
        );
      if (App.library.some(r => r.id === id) || added.some(r => r.id === id)) {
        dupes++;
        continue;
      }
      let uc = side === 'auto' ? detectColor(p.headers, App.profile.usernames) : side;
      if (!uc) {
        uc = 'w';
        unknownSide++;
      }
      added.push({
        id,
        pgn,
        headers: p.headers,
        userColor: uc,
        importedAt: Date.now(),
        analysis: null,
        stats: null,
        explanations: {},
        summary: null,
        drills: {},
        chat: [],
      });
    } catch (e) {
      errors.push(e.message);
    }
  }
  goBtn.disabled = false;
  for (const rec of added) {
    App.library.push(rec);
    Store.putGame(rec).catch(storeError);
  }
  const msg = [];
  if (added.length) msg.push(`Imported ${added.length} game${added.length === 1 ? '' : 's'}.`);
  if (dupes) msg.push(`${dupes} already in your library.`);
  if (unknownSide) msg.push(`Couldn’t tell your side in ${unknownSide}; assumed White. Add your username to fix that.`);
  if (errors.length) msg.push(`${errors.length} couldn’t be read: ${errors[0]}`);
  out.textContent = msg.join(' ');
  if (errors.length && !added.length) out.classList.add('err');
  if (added.length) {
    $('#pgn-input').value = '';
    if (!unknownSide && !errors.length) $('#dlg-games').close();
    switchTab('review');
    openGame(added[added.length - 1].id);
    toast(`Imported ${added.length} game${added.length === 1 ? '' : 's'}. Stockfish is grading the moves now.`);
  }
  refreshDrillCount();
  updateTitle();
}
