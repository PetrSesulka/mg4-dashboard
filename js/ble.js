// Web Bluetooth vrstva — připojení k BLE OBD adaptéru (ELM327 kompatibilnímu).
//
// BLE adaptéry se tváří jako "sériová linka přes GATT": jedna charakteristika
// posílá data ven (write), druhá je přijímá (notify). Různí výrobci používají
// různé UUID, proto po připojení projdeme všechny služby a dvojici najdeme sami.

MG.ble = {
  // Známé služby BLE OBD adaptérů — musí být v optionalServices,
  // jinak k nim prohlížeč nepustí (bezpečnostní pravidlo Web Bluetooth).
  KNOWN_SERVICES: [
    0xfff0, // vGate iCar Pro BLE, vLinker, většina klonů
    0xffe0, // klony s HM-10 modulem
    0xffe5,
    0xabf0, // některé ESP32 adaptéry
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Microchip Transparent UART (někteří výrobci)
  ],

  device: null,
  _writeChar: null,
  _notifyChar: null,
  _onData: null,       // callback(text) — příchozí data
  _onDisconnect: null, // callback() — ztráta spojení
  _decoder: new TextDecoder(),

  get connected() {
    return !!(this.device && this.device.gatt.connected && this._writeChar);
  },

  onData(cb) { this._onData = cb; },
  onDisconnect(cb) { this._onDisconnect = cb; },

  async connect() {
    // Necháme uživatele vybrat zařízení ze seznamu (jména adaptérů se různí,
    // takže nefiltrujeme podle jména).
    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: this.KNOWN_SERVICES,
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this._writeChar = null;
      this._notifyChar = null;
      if (this._onDisconnect) this._onDisconnect();
    });

    const server = await this.device.gatt.connect();

    // Najdi službu, která má dvojici notify + write charakteristik
    const services = await server.getPrimaryServices();
    let found = null;
    for (const svc of services) {
      let chars;
      try { chars = await svc.getCharacteristics(); } catch (e) { continue; }
      const notify = chars.find(c => c.properties.notify || c.properties.indicate);
      const write  = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (notify && write) { found = { notify, write }; break; }
    }
    if (!found) {
      this.disconnect();
      throw new Error('Adaptér nemá očekávanou BLE službu (notify+write). Je to opravdu BLE OBD adaptér?');
    }

    this._notifyChar = found.notify;
    this._writeChar = found.write;

    await this._notifyChar.startNotifications();
    this._notifyChar.addEventListener('characteristicvaluechanged', (e) => {
      const text = this._decoder.decode(e.target.value);
      if (this._onData) this._onData(text);
    });

    return this.device.name || '(bez názvu)';
  },

  // Odeslání textu — po malých kouscích (BLE zvládne ~20 B na jeden zápis)
  async write(text) {
    if (!this._writeChar) throw new Error('BLE není připojeno');
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (this._writeChar.properties.writeWithoutResponse) {
        await this._writeChar.writeValueWithoutResponse(chunk);
      } else {
        await this._writeChar.writeValue(chunk);
      }
    }
  },

  disconnect() {
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    this.device = null;
    this._writeChar = null;
    this._notifyChar = null;
  }
};
