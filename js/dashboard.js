// Dashboard — karty s aktuálními hodnotami.
// Karty se vytvoří jednou, pak se jen aktualizuje text (žádné překreslování DOM).

MG.dashboard = {
  // color: vrátí třídu podle hodnoty (good/warn/bad/cold), '' = výchozí barva
  CARDS: [
    {
      key: 'socShown', label: 'Baterie (SoC)', unit: '%', dec: 1,
      color: v => v < 15 ? 'bad' : v < 30 ? 'warn' : 'good',
      sub: st => st.get('soh') !== null ? 'SoH ' + st.get('soh').toFixed(1) + ' %' : '',
    },
    {
      key: 'consumption', label: 'Okamžitá spotřeba', unit: 'kWh/100 km', dec: 1,
      placeholder: 'stojíš',
      sub: () => '',
    },
    {
      key: 'power', label: 'Výkon baterie', unit: 'kW', dec: 1,
      color: v => v < -1 ? 'good' : '',
      sub: st => { const p = st.get('power'); return p !== null && p < -1 ? '⟲ rekuperace / nabíjení' : ''; },
    },
    {
      key: 'speed', altKey: 'speedStd', label: 'Rychlost', unit: 'km/h', dec: 0,
    },
    {
      key: 'battTemp', label: 'Teplota baterie', unit: '°C', dec: 1,
      color: v => v < 5 ? 'cold' : v < 40 ? 'good' : v < 48 ? 'warn' : 'bad',
      sub: st => {
        const mn = st.get('battTempMin'), ch = st.get('battCoolant');
        const parts = [];
        if (mn !== null) parts.push('min ' + mn.toFixed(1) + ' °C');
        if (ch !== null) parts.push('chladivo ' + ch.toFixed(1) + ' °C');
        return parts.join(' · ');
      },
    },
    {
      key: 'motorTemp', label: 'Teplota motoru', unit: '°C', dec: 0,
      color: v => v < 65 ? 'good' : v < 90 ? 'warn' : 'bad',
      sub: st => st.get('motorCoolant') !== null ? 'chladivo ' + st.get('motorCoolant').toFixed(0) + ' °C' : '',
    },
    {
      key: 'battV', label: 'Napětí baterie', unit: 'V', dec: 1,
      sub: st => st.get('battA') !== null ? st.get('battA').toFixed(1) + ' A' : '',
    },
    {
      key: 'cellDelta', label: 'Rozdíl článků', unit: 'mV', dec: 0,
      color: v => v < 30 ? 'good' : v < 60 ? 'warn' : 'bad',
      sub: st => {
        const mn = st.get('cellMin'), mx = st.get('cellMax');
        return (mn !== null && mx !== null) ? mn.toFixed(3) + ' – ' + mx.toFixed(3) + ' V' : '';
      },
    },
    {
      key: 'aux12v', label: '12V baterie', unit: 'V', dec: 1,
      color: v => v < 11.8 ? 'bad' : v < 12.4 ? 'warn' : 'good',
      sub: () => 'výstup DC-DC měniče',
    },
    {
      key: 'insideTemp', label: 'Vnitřní teplota', unit: '°C', dec: 1,
    },
    {
      key: 'outsideShown', label: 'Venkovní teplota', unit: '°C', dec: 0,
    },
    {
      key: 'charging', label: 'Nabíjení', unit: '', dec: 0,
      format: v => v ? 'ANO' : 'NE',
      color: v => v ? 'good' : '',
      sub: st => {
        const p = st.get('power');
        return (st.get('charging') && p !== null) ? Math.abs(p).toFixed(1) + ' kW' : '';
      },
    },
  ],

  _els: null,

  init() {
    const grid = document.getElementById('cards');
    grid.innerHTML = '';
    this._els = {};
    for (const c of this.CARDS) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        '<div class="label">' + c.label + '</div>' +
        '<div class="value"><span class="num">—</span><span class="unit">' + c.unit + '</span></div>' +
        '<div class="sub"></div>';
      grid.appendChild(card);
      this._els[c.key] = {
        card: card,
        num: card.querySelector('.num'),
        sub: card.querySelector('.sub'),
      };
    }
  },

  render() {
    if (!this._els) return;
    const st = MG.state;
    for (const c of this.CARDS) {
      const el = this._els[c.key];
      let v = st.get(c.key);
      let age = st.age(c.key);
      if (v === null && c.altKey) { v = st.get(c.altKey); age = st.age(c.altKey); }

      if (v === null) {
        // placeholder (např. „stojíš") dává smysl jen když data opravdu tečou
        el.num.textContent = (c.placeholder && MG.charts.active) ? c.placeholder : '—';
        el.card.className = 'card';
        el.sub.textContent = '';
        continue;
      }

      el.num.textContent = c.format ? c.format(v) : v.toFixed(c.dec);
      el.sub.textContent = c.sub ? c.sub(st) : '';

      let cls = 'card';
      if (c.color) { const cc = c.color(v); if (cc) cls += ' ' + cc; }
      if (age > 15000) cls += ' stale'; // stará hodnota — ztlumit
      el.card.className = cls;
    }
  }
};
