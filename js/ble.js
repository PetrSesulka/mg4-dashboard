// Web Bluetooth vrstva — připojení k BLE OBD adaptéru (ELM327 kompatibilnímu).
//
// BLE adaptéry se tváří jako "sériová linka přes GATT": jedna charakteristika
// posílá data ven (write), druhá je přijímá (notify). Různí výrobci používají
// různé UUID a různé režimy zápisu — a Bluefy na iOS má v obou směrech mouchy.
// Proto po připojení posbíráme všechny použitelné dvojice charakteristik
// a ELM driver pak zkouší kombinace, dokud adaptér neodpoví.

MG.ble = {
  // Známé služby BLE OBD adaptérů — plné 128bit UUID (Bluefy má se
  // zkrácenými číselnými UUID problémy). Pořadí = pořadí zkoušení.
  KNOWN_SERVICES: [
    '0000fff0-0000-1000-8000-00805f9b34fb', // Veepeak, vGate iCar Pro BLE, vLinker, většina klonů
    '0000ffe0-0000-1000-8000-00805f9b34fb', // klony s HM-10 modulem
    '0000ffe5-0000-1000-8000-00805f9b34fb',
    '0000abf0-0000-1000-8000-00805f9b34fb', // některé ESP32 adaptéry
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Microchip Transparent UART (někteří výrobci)
  ],

  device: null,
  _server: null,
  _pairs: [],      // kandidátní dvojice {service, notify, write}
  _pairIdx: -1,
  _notifyChar: null,
  _writeChar: null,
  _ackWrite: true, // true = zápis s potvrzením (writeValue), false = bez potvrzení
  _onData: null,
  _onDisconnect: null,
  _decoder: new TextDecoder(),
  _handler: null,

  get connected() {
    return !!(this.device && this.device.gatt.connected && this._writeChar);
  },

  onData(cb) { this._onData = cb; },
  onDisconnect(cb) { this._onDisconnect = cb; },

  // Žádost o výběr zařízení — dvě varianty, protože Bluefy na iOS
  // nemusí podporovat acceptAllDevices (pak zkusíme filtr podle služeb).
  async _requestDevice() {
    try {
      return await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.KNOWN_SERVICES,
      });
    } catch (err) {
      if (err && err.name === 'NotFoundError') throw err; // uživatel zrušil výběr
      return await navigator.bluetooth.requestDevice({
        filters: this.KNOWN_SERVICES.map(s => ({ services: [s] })),
        optionalServices: this.KNOWN_SERVICES,
      });
    }
  },

  async connect() {
    this.device = await this._requestDevice();

    this.device.addEventListener('gattserverdisconnected', () => {
      this._writeChar = null;
      this._notifyChar = null;
      if (this._onDisconnect) this._onDisconnect();
    });

    this._server = await this.device.gatt.connect();
    await this._discover();
    if (this._pairs.length === 0) {
      this.disconnect();
      throw new Error('Adaptér nenabízí žádnou BLE službu s dvojicí čtení+zápis. Je to opravdu BLE OBD adaptér?');
    }
    await this.usePair(0);
    return this.device.name || '(bez názvu)';
  },

  // Projde služby adaptéru a posbírá použitelné dvojice charakteristik
  async _discover() {
    let services = [];
    // výčet všech služeb některé iOS prohlížeče neumějí — pak zkoušíme známé
    try { services = await this._server.getPrimaryServices(); } catch (e) { }
    if (!services || services.length === 0) {
      services = [];
      for (const uuid of this.KNOWN_SERVICES) {
        try { services.push(await this._server.getPrimaryService(uuid)); } catch (e) { }
      }
    }

    this._pairs = [];
    for (const svc of services) {
      let chars;
      try { chars = await svc.getCharacteristics(); } catch (e) { continue; }
      const notify = chars.find(c => c.properties.notify || c.properties.indicate);
      const write  = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (notify && write) this._pairs.push({ service: svc, notify, write });
    }

    // známé OBD služby zkoušej první
    const rank = u => { const i = this.KNOWN_SERVICES.indexOf(u); return i === -1 ? 99 : i; };
    this._pairs.sort((a, b) => rank(a.service.uuid) - rank(b.service.uuid));
  },

  pairCount() { return this._pairs.length; },

  // Přehled nalezených dvojic pro diagnostický log (zkrácená UUID)
  describeGatt() {
    const s = u => u.length > 8 ? u.slice(4, 8) : u;
    return this._pairs
      .map(p => s(p.service.uuid) + ' (čtení ' + s(p.notify.uuid) + ', zápis ' + s(p.write.uuid) + ')')
      .join('; ');
  },

  describeCurrent() {
    const p = this._pairs[this._pairIdx];
    if (!p) return '?';
    const s = u => u.slice(4, 8);
    return 'služba ' + s(p.service.uuid) + ', zápis ' + (this._ackWrite ? 's potvrzením' : 'bez potvrzení');
  },

  // Aktivuje i-tou dvojici: přepne notifikace na její čtecí charakteristiku
  async usePair(i) {
    const p = this._pairs[i];
    if (!p) return false;

    if (!this._handler) {
      this._handler = (e) => {
        const text = this._decoder.decode(e.target.value);
        if (this._onData) this._onData(text);
      };
    }

    // odhlásit předchozí dvojici
    if (this._notifyChar && this._notifyChar !== p.notify) {
      try { await this._notifyChar.stopNotifications(); } catch (e) { }
      this._notifyChar.removeEventListener('characteristicvaluechanged', this._handler);
    }

    this._pairIdx = i;
    this._notifyChar = p.notify;
    this._writeChar = p.write;
    this._ackWrite = !!p.write.properties.write; // preferuj spolehlivější potvrzovaný zápis

    // listener přidat DŘÍV, než se notifikace spustí (Bluefy je na pořadí citlivý)
    this._notifyChar.removeEventListener('characteristicvaluechanged', this._handler);
    this._notifyChar.addEventListener('characteristicvaluechanged', this._handler);
    try { await this._notifyChar.startNotifications(); } catch (e) { return false; }
    await new Promise(r => setTimeout(r, 300)); // nech BLE stack usadit

    return true;
  },

  // Režimy zápisu dostupné u aktuální dvojice (preferovaný první)
  writeModes() {
    if (!this._writeChar) return [];
    const w = this._writeChar.properties;
    const modes = [];
    if (w.write) modes.push('ack');
    if (w.writeWithoutResponse) modes.push('noack');
    return modes;
  },

  setWriteMode(mode) { this._ackWrite = (mode === 'ack'); },

  // Odeslání textu — po malých kouscích (BLE zvládne ~20 B na jeden zápis)
  async write(text) {
    if (!this._writeChar) throw new Error('BLE není připojeno');
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (this._ackWrite) {
        await this._writeChar.writeValue(chunk);
      } else {
        await this._writeChar.writeValueWithoutResponse(chunk);
      }
    }
  },

  disconnect() {
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    this.device = null;
    this._server = null;
    this._writeChar = null;
    this._notifyChar = null;
    this._pairs = [];
    this._pairIdx = -1;
  }
};
