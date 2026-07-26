// Definice ECU a PID pro MG4 (platforma SAIC MSP).
//
// Zdroje: komunitní reverse engineering — projekt OVMS (vehicle_mg4.cpp,
// mg_obd_pids.h), fórum mgevs.com ("OBD Data"), repo
// github.com/bugcoder76/MG4-EV-OBD-PID. MG4 má podle OVMS BMS na adrese
// 7E5/7ED (starší ZS EV mělo 781/789) a část hodnot čte standardními
// OBD dotazy. Každý PID se ověří v autě (sekce Diagnostika) a nefunkční
// poller automaticky vyřadí.
//
// Čtení: UDS "mode 22" (ReadDataByIdentifier) na konkrétní ECU,
// protokol ISO 15765-4 CAN 11bit/500k.
//
// Pozor: nikdy nedotazovat BCM (740) — u zamčeného auta spouští alarm!

MG.ECUS = {
  BMS: { tx: '7E5', rx: '7ED' }, // Battery Management System (MG4 "Mk2")
  VCU: { tx: '7E3', rx: '7EB' }, // Vehicle Control Unit (motor, DC-DC…) — na MG4 neověřeno
  ATC: { tx: '750', rx: '758' }, // klimatizace (teploty kabiny)
  STD: { tx: '7DF', rx: '7E?' }  // standardní OBD-II broadcast (mode 01), odpovídá 7E8–7EF
};

(function () {
  // A = bajt 0, B = bajt 1, ... (stejné značení jako v Torque vzorcích)
  const u16 = (d, i = 0) => (d[i] << 8) | d[i + 1];

  // group: 'fast' = každý cyklus, 'slow' = cca 1× za 10 s
  // min/max: rozsah věrohodnosti — hodnota mimo = špatně namapovaný PID, zahodí se
  // fallbackFor: čte se jen tehdy, když primární PID nefunguje
  MG.PIDS = [
    // ---- rychlá smyčka ----
    { key: 'battV',     label: 'Napětí baterie',      ecu: 'BMS', req: '22B042', unit: 'V',     group: 'fast', min: 200,  max: 500,
      decode: d => u16(d) / 4 },
    { key: 'battA',     label: 'Proud baterie',       ecu: 'BMS', req: '22B043', unit: 'A',     group: 'fast', min: -600, max: 600,
      decode: d => (u16(d) - 40000) / 40 },
    { key: 'battTemp',  label: 'Teplota baterie max', ecu: 'BMS', req: '22B056', unit: '°C',    group: 'fast', min: -40,  max: 80,
      decode: d => d[0] / 2 - 40 },
    { key: 'motorTemp', label: 'Teplota motoru',      ecu: 'VCU', req: '22B405', unit: '°C',    group: 'fast', min: -40,  max: 180,
      decode: d => d[0] - 40 },
    { key: 'speed',     label: 'Rychlost (VCU)',      ecu: 'VCU', req: '22BA00', unit: 'km/h',  group: 'fast', min: 0,    max: 250,
      decode: d => Math.abs((u16(d) - 20000) / 100) },
    { key: 'speedStd',  label: 'Rychlost (OBD std)',  ecu: 'STD', req: '010D',   unit: 'km/h',  group: 'fast', min: 0,    max: 250,
      decode: d => d[0], fallbackFor: 'speed' },

    // ---- pomalá smyčka ----
    { key: 'soc',         label: 'SoC (BMS)',            ecu: 'BMS', req: '22B046', unit: '%',   group: 'slow', min: 0,    max: 100,
      decode: d => u16(d) / 10 },
    { key: 'socStd',      label: 'SoC (OBD std)',        ecu: 'STD', req: '015B',   unit: '%',   group: 'slow', min: 0,    max: 100,
      decode: d => d[0] * 100 / 255, fallbackFor: 'soc' },
    { key: 'socVcu',      label: 'SoC (VCU/displej)',    ecu: 'VCU', req: '22B701', unit: '%',   group: 'slow', min: 0,    max: 100,
      decode: d => u16(d) / 10, fallbackFor: 'soc' },
    { key: 'insideTemp',  label: 'Vnitřní teplota (ATC)',ecu: 'ATC', req: '22E01C', unit: '°C',  group: 'slow', min: -30,  max: 75,
      decode: d => u16(d) / 10 - 40 },
    { key: 'soh',         label: 'SoH baterie',          ecu: 'BMS', req: '22B061', unit: '%',   group: 'slow', min: 50,   max: 110,
      decode: d => u16(d) / 100 },
    { key: 'battTempMin', label: 'Teplota baterie min',  ecu: 'BMS', req: '22B057', unit: '°C',  group: 'slow', min: -40,  max: 80,
      decode: d => d[0] / 2 - 40 },
    { key: 'battCoolant', label: 'Chladivo baterie',     ecu: 'BMS', req: '22B05C', unit: '°C',  group: 'slow', min: -40,  max: 80,
      decode: d => d[0] / 2 - 40 },
    { key: 'motorCoolant',label: 'Chladivo motoru',      ecu: 'VCU', req: '22B309', unit: '°C',  group: 'slow', min: -40,  max: 120,
      decode: d => d[0] - 40 },
    { key: 'cellMax',     label: 'Článek max',           ecu: 'BMS', req: '22B058', unit: 'V',   group: 'slow', min: 2.5,  max: 4.5,
      decode: d => u16(d) / 1000 },
    { key: 'cellMin',     label: 'Článek min',           ecu: 'BMS', req: '22B059', unit: 'V',   group: 'slow', min: 2.5,  max: 4.5,
      decode: d => u16(d) / 1000 },
    { key: 'outsideTemp', label: 'Venkovní teplota',     ecu: 'VCU', req: '22BB05', unit: '°C',  group: 'slow', min: -40,  max: 60,
      decode: d => d[0] - 40 },
    { key: 'outsideAtc',  label: 'Venkovní tepl. (ATC)', ecu: 'ATC', req: '22E01B', unit: '°C',  group: 'slow', min: -40,  max: 60,
      decode: d => u16(d) / 10 - 40, fallbackFor: 'outsideTemp' },
    { key: 'outsideStd',  label: 'Venkovní tepl. (std)', ecu: 'STD', req: '0146',   unit: '°C',  group: 'slow', min: -40,  max: 60,
      decode: d => d[0] - 40, fallbackFor: 'outsideTemp' },
    { key: 'aux12v',      label: '12V (výstup DC-DC)',   ecu: 'VCU', req: '22B584', unit: 'V',   group: 'slow', min: 5,    max: 20,
      decode: d => u16(d) / 10 },
    { key: 'motorRpm',    label: 'Otáčky motoru',        ecu: 'VCU', req: '22B402', unit: 'rpm', group: 'slow', min: -12000, max: 12000,
      decode: d => u16(d) - 32767 },
    { key: 'motorTorque', label: 'Moment motoru',        ecu: 'VCU', req: '22B401', unit: 'Nm',  group: 'slow', min: -400, max: 400,
      decode: d => (u16(d) - 32767) / 10 },
  ];
})();

// Odvozené (počítané) hodnoty — aktualizují se po každém cyklu čtení
MG.derived = {
  _emaCons: null, // klouzavý průměr spotřeby, ať číslo neskáče

  update() {
    const st = MG.state;
    const V = st.get('battV');
    const A = st.get('battA');

    // výkon baterie: kladný = vybíjení (jízda), záporný = rekuperace/nabíjení
    if (V !== null && A !== null) st.set('power', V * A / 1000);

    const p = st.get('power');
    const spd = st.get('speed') !== null ? st.get('speed') : st.get('speedStd');

    // okamžitá spotřeba jen za jízdy (při stání nedává smysl)
    if (p !== null && spd !== null && spd > 5) {
      const c = p / spd * 100; // kW / km/h * 100 = kWh/100 km
      this._emaCons = this._emaCons === null ? c : this._emaCons + (c - this._emaCons) * 0.3;
      st.set('consumption', this._emaCons);
    } else {
      this._emaCons = null;
      st.clear('consumption');
    }

    // SoC: primárně z BMS, jinak ze záložních zdrojů
    const soc = [st.get('soc'), st.get('socVcu'), st.get('socStd')].find(x => x !== null);
    if (soc !== undefined) st.set('socShown', soc);

    // venkovní teplota: VCU, jinak klimatizace, jinak standardní OBD
    const out = [st.get('outsideTemp'), st.get('outsideAtc'), st.get('outsideStd')].find(x => x !== null);
    if (out !== undefined) st.set('outsideShown', out);

    // rozdíl napětí článků (ukazatel balancu baterie)
    const cMax = st.get('cellMax');
    const cMin = st.get('cellMin');
    if (cMax !== null && cMin !== null) st.set('cellDelta', (cMax - cMin) * 1000);

    // nabíjení = energie teče do baterie a auto stojí
    if (p !== null) st.set('charging', (p < -1 && (spd === null || spd < 1)) ? 1 : 0);
  },

  reset() { this._emaCons = null; }
};
