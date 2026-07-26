// Driver pro ELM327 čip v OBD adaptéru.
//
// ELM327 je "překladač": posíláme mu textové příkazy (AT... pro nastavení,
// hex pro dotazy do auta) a on vrací textové odpovědi ukončené znakem '>'.
// Vždy smí běžet jen jeden příkaz naráz — proto fronta (_queue).

MG.elm = {
  onLog: null,     // callback(směr, text) pro diagnostický log
  version: '',     // identifikace čipu z ATZ (např. "ELM327 v1.5")

  _rxBuf: '',
  _pending: null,  // { resolve, timer } právě běžícího příkazu
  _queue: Promise.resolve(),
  _currentEcu: null,

  // Napojení na BLE vrstvu — příchozí data tečou sem
  attach(ble) {
    ble.onData(chunk => this._onChunk(chunk));
    this._rxBuf = '';
    this._pending = null;
    this._queue = Promise.resolve();
    this._currentEcu = null;
  },

  _log(dir, text) { if (this.onLog) this.onLog(dir, text); },

  _onChunk(text) {
    this._rxBuf += text;
    // '>' = ELM je připraven na další příkaz -> odpověď je kompletní
    if (this._rxBuf.includes('>') && this._pending) {
      const resp = this._rxBuf;
      this._rxBuf = '';
      const p = this._pending;
      this._pending = null;
      clearTimeout(p.timer);
      this._log('RX', resp.replace(/>/g, '').trim());
      p.resolve(resp);
    }
  },

  // Pošle příkaz a počká na kompletní odpověď (serializovaně přes frontu)
  cmd(command, timeoutMs = 4000) {
    const run = () => new Promise((resolve) => {
      this._rxBuf = '';
      this._pending = {
        resolve,
        timer: setTimeout(() => {
          // timeout — vrátíme co přišlo, ať se dá aspoň diagnostikovat
          const partial = this._rxBuf;
          this._rxBuf = '';
          this._pending = null;
          this._log('RX', '(timeout) ' + partial.trim());
          resolve(partial);
        }, timeoutMs),
      };
      this._log('TX', command);
      MG.ble.write(command + '\r').catch(err => {
        const p = this._pending;
        if (p) { clearTimeout(p.timer); this._pending = null; p.resolve(''); }
        this._log('ERR', String(err));
      });
    });
    this._queue = this._queue.then(run, run);
    return this._queue;
  },

  // Oťukání spojení: zkouší kombinace BLE dvojic a režimů zápisu,
  // dokud adaptér neodpoví na ATZ (reset). Vrací text odpovědi, nebo null.
  async _probe() {
    for (let i = 0; i < MG.ble.pairCount(); i++) {
      if (!(await MG.ble.usePair(i))) continue;
      for (const mode of MG.ble.writeModes()) {
        MG.ble.setWriteMode(mode);
        this._log('SYS', 'Zkouším ' + MG.ble.describeCurrent());
        const r = await this.cmd('ATZ', 3500);
        if (r && r.replace(/[\r\n>\0\s]/g, '').length > 0) return r;
      }
    }
    return null;
  },

  // Základní nastavení adaptéru po připojení
  async init() {
    const atz = await this._probe();
    if (atz === null) {
      throw new Error('adaptér je přes Bluetooth připojen, ale neodpovídá na příkazy ' +
        '(vyzkoušeny všechny kombinace). Vytáhni adaptér ze zásuvky, zasuň zpět, ' +
        'vypni a zapni Bluetooth v telefonu a zkus to znovu.');
    }
    const m = atz.match(/ELM327[^\r\n>]*/i);
    this.version = m ? m[0].trim() : atz.replace(/[\r\n>\0]/g, ' ').trim();

    await this.cmd('ATE0');   // vypnout echo příkazů
    await this.cmd('ATL0');   // bez znaků LF
    await this.cmd('ATS0');   // bez mezer v hex odpovědích
    await this.cmd('ATH1');   // zobrazovat CAN hlavičky (nutné pro parsování)
    await this.cmd('ATSP6');  // vynutit ISO 15765-4 CAN 11bit/500k (klíčové pro MG4!)
    await this.cmd('ATST96'); // timeout odpovědi auta ~600 ms
    this._currentEcu = null;
  },

  // Přepnutí na jinou ECU: nastaví hlavičku dotazu a filtr odpovědí.
  // rx s '?' na konci (broadcast) = filtr vypnout, odpovědět smí víc ECU.
  async _setEcu(name) {
    if (this._currentEcu === name) return;
    const e = MG.ECUS[name];
    await this.cmd('ATSH' + e.tx);
    if (e.rx.endsWith('?')) {
      await this.cmd('ATAR'); // zrušit filtr přijímací adresy
    } else {
      await this.cmd('ATCRA' + e.rx);
    }
    this._currentEcu = name;
  },

  // Pošle dotaz (např. '22B046') na danou ECU a vrátí payload jako pole bajtů,
  // nebo null když auto neodpovědělo / vrátilo chybu.
  async request(ecuName, reqHex, timeoutMs = 2500) {
    await this._setEcu(ecuName);
    const text = await this.cmd(reqHex, timeoutMs);
    return this._parse(text, MG.ECUS[ecuName].rx);
  },

  // Poskládá odpověď z CAN rámců (ISO-TP): jednorámcové i vícerámcové zprávy
  _parse(text, rxHeader) {
    if (!text) return null;
    const clean = text.replace(/>/g, '');
    if (/NO DATA|CAN ERROR|BUS INIT|UNABLE|STOPPED|\?/i.test(clean)) return null;

    const lines = clean.split(/[\r\n]+/).map(s => s.trim().replace(/\s+/g, ''))
      .filter(s => s.length > 0);

    // zajímají nás jen rámce od naší ECU (hlavička = 3 hex znaky u 11bit CAN);
    // '?' v rx znamená "libovolný poslední znak" (broadcast, např. 7E8–7EF)
    const prefix = rxHeader.replace('?', '').toUpperCase();
    const frames = [];
    for (const line of lines) {
      if (line.toUpperCase().startsWith(prefix) && /^[0-9A-Fa-f]+$/.test(line)) {
        frames.push(this._hexToBytes(line.slice(3))); // 3 znaky = 11bit hlavička
      }
    }
    if (frames.length === 0) return null;

    let data = null;
    const first = frames[0];
    const pciType = first[0] >> 4;

    if (pciType === 0) {
      // Single Frame: [0x0L, data...] — L = počet bajtů
      const len = first[0] & 0x0f;
      data = first.slice(1, 1 + len);
    } else if (pciType === 1) {
      // First Frame: [0x1L, LL, data...] + Consecutive Frames [0x2N, data...]
      const total = ((first[0] & 0x0f) << 8) | first[1];
      data = first.slice(2);
      for (let i = 1; i < frames.length; i++) {
        const f = frames[i];
        if ((f[0] >> 4) === 2) data = data.concat(f.slice(1));
      }
      data = data.slice(0, total);
    } else {
      return null;
    }

    // 0x7F = negativní odpověď (ECU dotaz odmítla)
    if (data.length === 0 || data[0] === 0x7f) return null;
    return data;
  },

  _hexToBytes(hex) {
    const out = [];
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
    return out;
  }
};
