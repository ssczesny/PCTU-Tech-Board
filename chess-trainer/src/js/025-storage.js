/* ================= storage ================= */
/* Games and the profile live in the viewer's private area of the artifact database when it is available
   ("cloud"), otherwise in this browser's storage ("local"), otherwise only in memory.
   Local layout: one key per game, so saving an explanation rewrites that game and not the whole library:
     postmortem.v2.profile   postmortem.v2.ids (list of game ids)   postmortem.v2.g.<id> */
const LS2 = 'postmortem.v2.';
const Store = {
  mode: 'memory',
  mem: { profile: null, games: {} },
  warned: false,
  async init() {
    const c = window.claude;
    if (c && typeof c.use === 'function') {
      try {
        const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
        const uid = user ? await user.id() : null;
        if (db && uid) {
          this.profileRef = db.doc(`data/users/${uid}/profile`);
          this.gamesRef = this.profileRef.collection('games');
          this.mode = 'cloud';
          return;
        }
      } catch (e) {
        console.warn('storage init', e);
      }
    }
    try {
      localStorage.setItem(LS2 + 'probe', '1');
      localStorage.removeItem(LS2 + 'probe');
      this.mode = 'local';
      const ids = JSON.parse(localStorage.getItem(LS2 + 'ids') || 'null');
      if (Array.isArray(ids)) {
        this.mem.profile = JSON.parse(localStorage.getItem(LS2 + 'profile') || 'null');
        for (const id of ids) {
          try {
            const g = JSON.parse(localStorage.getItem(LS2 + 'g.' + id) || 'null');
            if (g && g.id) this.mem.games[g.id] = g;
          } catch {}
        }
      } else {
        // First run on this layout: carry over a library saved by the earlier single-key version.
        const old = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (old && typeof old === 'object') {
          this.mem = { profile: old.profile || null, games: old.games || {} };
          this._put('profile', this.mem.profile);
          for (const id of Object.keys(this.mem.games)) this._put('g.' + id, this.mem.games[id]);
          this._ids();
          if (!this.warned) localStorage.removeItem(LS_KEY);
        }
      }
    } catch {
      if (this.mode !== 'local') this.mode = 'memory';
    }
  },
  _put(key, value) {
    if (this.mode !== 'local') return;
    try {
      localStorage.setItem(LS2 + key, JSON.stringify(value));
    } catch {
      if (!this.warned) toast('This browser is out of storage space. Delete a few games from your library to keep saving.');
      this.warned = true;
    }
  },
  _ids() {
    this._put('ids', Object.keys(this.mem.games));
  },
  async loadProfile() {
    if (this.mode === 'cloud') {
      const s = await this.profileRef.get();
      return s.exists ? clone(s.data()) : null;
    }
    return clone(this.mem.profile);
  },
  saveProfile(p) {
    return serial('profile', async () => {
      if (this.mode === 'cloud') await this.profileRef.set(clone(p));
      else {
        this.mem.profile = clone(p);
        this._put('profile', this.mem.profile);
      }
    });
  },
  async listGames() {
    if (this.mode === 'cloud') {
      const s = await this.gamesRef.get();
      return s.docs.map(d => clone(d.data()));
    }
    return Object.values(this.mem.games || {}).map(clone);
  },
  putGame(rec) {
    return serial(rec.id, async () => {
      if (this.mode === 'cloud') await this.gamesRef.doc(rec.id).set(clone(rec));
      else {
        const isNew = !this.mem.games[rec.id];
        this.mem.games[rec.id] = clone(rec);
        this._put('g.' + rec.id, this.mem.games[rec.id]);
        if (isNew) this._ids();
      }
    });
  },
  patchGame(id, patch) {
    return serial(id, async () => {
      if (this.mode === 'cloud') await this.gamesRef.doc(id).update(clone(patch));
      else {
        const g = this.mem.games[id];
        if (g) {
          deepMerge(g, clone(patch));
          this._put('g.' + id, g);
        }
      }
    });
  },
  deleteGame(id) {
    return serial(id, async () => {
      if (this.mode === 'cloud') await this.gamesRef.doc(id).delete();
      else {
        delete this.mem.games[id];
        if (this.mode === 'local')
          try {
            localStorage.removeItem(LS2 + 'g.' + id);
          } catch {}
        this._ids();
      }
    });
  },
};
function storeError(e) {
  const code = e && e.code;
  if (code === 'quota_exceeded') toast('Your saved library is full. Delete some older games to keep saving.');
  else if (code === 'invalid_argument') toast('This view can’t save to your library, so changes stay in this tab.');
  else toast('Couldn’t save that change. It will be kept while this tab is open.');
}
