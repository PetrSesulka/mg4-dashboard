// Smyčka dotazování: střídavě čte PID z auta a ukládá hodnoty do MG.state.
//
// - 'fast' PID se čtou pořád dokola, 'slow' cca 1× za 10 s
// - PID, který opakovaně selže, se označí za mrtvý a přeskakuje se
//   (zkusí se znovu za minutu — ECU se někdy probudí až se zapalováním)
// - hodnoty mimo rozsah věrohodnosti (min/max) se zahazují — na MG4 může být
//   PID namapovaný jinak než na ZS EV, ze kterého definice vychází

MG.poller = {
  DEAD_AFTER: 4,        // po kolika selháních PID vyřadit
  RETRY_DEAD_MS: 60000, // za jak dlouho zkusit mrtvý PID znovu
  SLOW_EVERY_MS: 10000, // perioda pomalé skupiny

  running: false,
  paused: false,
  onPidResult: null, // callback(pid, stav, rawText, hodnota) pro diagnostiku

  _fails: {},
  _deadSince: {},
  _lastSlow: 0,

  async start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this._fails = {};
    this._deadSince = {};
    this._lastSlow = 0;
    this._loop();
  },

  stop() { this.running = false; },

  isDead(key) { return this._deadSince[key] !== undefined; },

  async _loop() {
    while (this.running) {
      if (this.paused) { await this._sleep(200); continue; }

      for (const pid of MG.PIDS.filter(p => p.group === 'fast')) {
        if (!this.running || this.paused) break;
        await this._poll(pid);
      }

      if (this.running && !this.paused && Date.now() - this._lastSlow > this.SLOW_EVERY_MS) {
        this._lastSlow = Date.now();
        for (const pid of MG.PIDS.filter(p => p.group === 'slow')) {
          if (!this.running || this.paused) break;
          await this._poll(pid);
        }
      }

      MG.derived.update();
      MG.dashboard.render();
      await this._sleep(150);
    }
  },

  async _poll(pid, force = false) {
    if (!force) {
      // mrtvý PID přeskoč (a po čase mu dej další šanci)
      if (this.isDead(pid.key)) {
        if (Date.now() - this._deadSince[pid.key] < this.RETRY_DEAD_MS) return;
        delete this._deadSince[pid.key];
        this._fails[pid.key] = this.DEAD_AFTER - 1; // jeden pokus
      }
      // záložní PID čti jen když primární nefunguje
      if (pid.fallbackFor && !this.isDead(pid.fallbackFor)) return;
    }

    // PID s atCmd není dotaz do auta, ale příkaz samotnému adaptéru (např. ATRV)
    if (pid.atCmd) {
      const text = await MG.elm.cmd(pid.atCmd);
      const v = pid.parseText(text);
      if (typeof v !== 'number' || Number.isNaN(v) || v < pid.min || v > pid.max) {
        this._fail(pid, 'bez odpovědi', null);
        return;
      }
      this._fails[pid.key] = 0;
      MG.state.set(pid.key, v);
      if (this.onPidResult) this.onPidResult(pid, 'OK', text.replace(/[\r\n>]/g, ' ').trim(), v);
      return;
    }

    const data = await MG.elm.request(pid.ecu, pid.req);
    const payload = this._extract(pid, data);

    if (payload === null) {
      this._fail(pid, data ? 'jiná odpověď' : 'bez odpovědi', data);
      return;
    }

    const v = pid.decode(payload);
    if (typeof v !== 'number' || Number.isNaN(v) || v < pid.min || v > pid.max) {
      this._fail(pid, 'mimo rozsah (' + v + ')', data);
      return;
    }

    this._fails[pid.key] = 0;
    MG.state.set(pid.key, v);
    if (this.onPidResult) this.onPidResult(pid, 'OK', this._hex(data), v);
  },

  _fail(pid, reason, data) {
    this._fails[pid.key] = (this._fails[pid.key] || 0) + 1;
    if (this._fails[pid.key] >= this.DEAD_AFTER && !this.isDead(pid.key)) {
      this._deadSince[pid.key] = Date.now();
    }
    if (this.onPidResult) {
      this.onPidResult(pid, this.isDead(pid.key) ? 'vyřazen' : reason, this._hex(data), null);
    }
  },

  // Ověří, že odpověď patří k dotazu (mode+0x40 a stejný identifikátor),
  // a vrátí jen datové bajty
  _extract(pid, data) {
    if (!data) return null;
    const req = MG.elm._hexToBytes(pid.req);
    if (data[0] !== req[0] + 0x40) return null;
    for (let i = 1; i < req.length; i++) if (data[i] !== req[i]) return null;
    const payload = data.slice(req.length);
    return payload.length > 0 ? payload : null;
  },

  // Jednorázový test všech PID (i vyřazených) — pro diagnostiku v autě
  async testAll() {
    this.paused = true;
    await this._sleep(300); // nech doběhnout rozjetý dotaz
    for (const pid of MG.PIDS) {
      await this._poll(pid, true);
    }
    MG.derived.update();
    MG.dashboard.render();
    this.paused = false;
  },

  _hex(data) { return data ? data.map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase() : '—'; },
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
};
