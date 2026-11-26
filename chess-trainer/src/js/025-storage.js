/* ================= storage ================= */
/* Games and the profile live in the viewer's private area of the artifact database when it is available
   ("cloud"), otherwise in this browser's storage ("local"), otherwise only in memory.
   Local layout: one key per game, so saving an explanation rewrites that game and not the whole library:
     postmortem.v2.profile   postmortem.v2.g.<id>
   The library is whatever game keys exist. There is no separate index that a second tab could overwrite,
   and a browser that is out of space can still read what it saved earlier. */
const LS2 = 'postmortem.v2.';
const Store = {
  mode: 'memory',
  mem: { profile: null, games: {} },
  full: false, // the last local write failed for lack of space
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
    // Being able to read is what makes this "local": a full disk only stops new saves (see _put).
    const read = key => {
      try {
        return JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        return null;
      }
    };
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    } catch {
      this.mode = 'memory';
      return;
    }
    this.mode = 'local';
    this.mem.profile = read(LS2 + 'profile');
    for (const key of keys) {
      if (!key || !key.startsWith(LS2 + 'g.')) continue;
      const g = read(key);
      if (g && g.id && g.pgn) this.mem.games[g.id] = g;
    }
    try {
      localStorage.removeItem(LS2 + 'ids'); // index kept by an earlier build
    } catch {}
    // A library saved by the first, single-key version is carried over once.
    const old = read(LS_KEY);
    if (old && typeof old === 'object') {
      if (!this.mem.profile && old.profile) this.mem.profile = old.profile;
      const missing = Object.keys(old.games || {}).filter(id => !this.mem.games[id]);
      for (const id of missing) this.mem.games[id] = old.games[id];
      let ok = this._put('profile', this.mem.profile);
      for (const id of missing) ok = this._put('g.' + id, this.mem.games[id]) && ok;
      try {
        localStorage.removeItem(LS_KEY);
      } catch {}
      if (!ok) {
        // There was no room for both copies. With the old one gone (everything is in memory) write again.
        this._put('profile', this.mem.profile);
        for (const id of Object.keys(this.mem.games)) this._put('g.' + id, this.mem.games[id]);
      }
    }
  },
  /* Returns false when the browser refused the write (out of space). Callers turn that into an error the
     student sees: nothing is ever dropped quietly. */
  _put(key, value) {
    if (this.mode !== 'local') return true;
    try {
      localStorage.setItem(LS2 + key, JSON.stringify(value));
      this.full = false;
      return true;
    } catch {
      this.full = true;
      return false;
    }
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
        if (!this._put('profile', this.mem.profile)) throw { code: 'local_full' };
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
        this.mem.games[rec.id] = clone(rec);
        if (!this._put('g.' + rec.id, this.mem.games[rec.id])) throw { code: 'local_full' };
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
          if (!this._put('g.' + id, g)) throw { code: 'local_full' };
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
      }
    });
  },
};
function storeError(e) {
  const code = e && e.code;
  if (code === 'local_full')
    toast('This browser is out of storage space, so that change was not saved. Delete a few games from your library to make room.', 7000);
  else if (code === 'quota_exceeded') toast('Your saved library is full. Delete some older games to keep saving.');
  else if (code === 'invalid_argument') toast('This view can’t save to your library, so changes stay in this tab.');
  else toast('Couldn’t save that change. It will be kept while this tab is open.');
}
