// Celoobrazovkový detail hodnoty s budíkem (ručičkovým ukazatelem).
//
// Klepnutím na kartu se otevře, klepnutím kamkoli se zavře. Budík je SVG
// oblouk 240° s barevnými zónami (stejné barvy jako karty) a ručičkou.
// Hodnota se obnovuje za běhu, stejně jako na dashboardu.

MG.detail = {
  // Konfigurace budíků: rozsah, popsané dílky stupnice, barevné zóny.
  // Karta bez záznamu (nabíjení) ukáže jen velké číslo/text bez budíku.
  GAUGES: {
    speed:        { min: 0,    max: 180, ticks: [0, 30, 60, 90, 120, 150, 180] },
    power:        { min: -60,  max: 160, ticks: [-60, 0, 40, 80, 120, 160],
                    zones: [{ to: 0, cls: 'good' }] },
    socShown:     { min: 0,    max: 100, ticks: [0, 25, 50, 75, 100],
                    zones: [{ to: 15, cls: 'bad' }, { to: 30, cls: 'warn' }, { to: 100, cls: 'good' }] },
    consumption:  { min: 0,    max: 50,  ticks: [0, 10, 20, 30, 40, 50] },
    battTemp:     { min: -10,  max: 60,  ticks: [-10, 0, 20, 40, 60],
                    zones: [{ to: 5, cls: 'cold' }, { to: 40, cls: 'good' }, { to: 48, cls: 'warn' }, { to: 60, cls: 'bad' }] },
    motorTemp:    { min: 0,    max: 120, ticks: [0, 40, 65, 90, 120],
                    zones: [{ to: 65, cls: 'good' }, { to: 90, cls: 'warn' }, { to: 120, cls: 'bad' }] },
    battV:        { min: 300,  max: 450, ticks: [300, 350, 400, 450] },
    cellDelta:    { min: 0,    max: 100, ticks: [0, 30, 60, 100],
                    zones: [{ to: 30, cls: 'good' }, { to: 60, cls: 'warn' }, { to: 100, cls: 'bad' }] },
    aux12vShown:  { min: 10,   max: 16,  ticks: [10, 12, 14, 16],
                    zones: [{ to: 11.8, cls: 'bad' }, { to: 12.4, cls: 'warn' }, { to: 15.5, cls: 'good' }, { to: 16, cls: 'warn' }] },
    insideShown:  { min: -20,  max: 50,  ticks: [-20, 0, 20, 50] },
    outsideShown: { min: -20,  max: 50,  ticks: [-20, 0, 20, 50] },
  },

  _key: null,   // klíč právě zobrazené karty (null = zavřeno)
  _card: null,  // definice karty z MG.dashboard.CARDS
  _timer: null,
  _els: null,

  init() {
    const overlay = document.getElementById('detail');
    this._els = {
      overlay: overlay,
      label: overlay.querySelector('.detail-label'),
      gauge: overlay.querySelector('.detail-gauge'),
      num: overlay.querySelector('.num'),
      unit: overlay.querySelector('.unit'),
      sub: overlay.querySelector('.detail-sub'),
    };
    overlay.addEventListener('click', () => this.close());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
  },

  open(key) {
    this._card = MG.dashboard.CARDS.find(c => c.key === key);
    if (!this._card) return;
    this._key = key;

    const g = this.GAUGES[key];
    this._els.gauge.innerHTML = g ? this._buildGauge(g) : '';
    this._els.label.textContent = this._card.label;
    this._els.unit.textContent = this._card.unit;
    this._els.overlay.hidden = false;

    this._render();
    this._timer = setInterval(() => this._render(), 300);
  },

  close() {
    this._key = null;
    clearInterval(this._timer);
    this._timer = null;
    this._els.overlay.hidden = true;
  },

  _render() {
    if (!this._key) return;
    const c = this._card;
    const st = MG.state;
    const { v, age } = MG.dashboard.valueFor(c);

    let cls = '';
    if (v === null) {
      this._els.num.textContent = (c.placeholder && MG.charts.active) ? c.placeholder : '—';
    } else {
      const decN = typeof c.dec === 'function' ? c.dec(v) : c.dec;
      this._els.num.textContent = c.format ? c.format(v) : v.toFixed(decN);
      if (c.color) cls = c.color(v) || '';
      if (age > 15000) cls += ' stale';
    }
    this._els.num.className = 'num ' + cls;
    this._els.sub.textContent = (v !== null && c.sub) ? c.sub(st) : '';

    // natočení ručičky
    const g = this.GAUGES[this._key];
    const needle = this._els.gauge.querySelector('.needle');
    if (g && needle) {
      const raw = v === null ? g.min : Math.min(g.max, Math.max(g.min, v));
      const t = (raw - g.min) / (g.max - g.min);
      needle.setAttribute('transform', 'rotate(' + (-120 + t * 240) + ' 100 100)');
      needle.style.opacity = v === null ? 0.25 : 1;
    }
  },

  // --- vykreslení SVG budíku ---

  // bod na kružnici; úhel ve stupních, 0° nahoře, kladné po směru ručiček
  _pt(r, deg) {
    const rad = deg * Math.PI / 180;
    return [100 + r * Math.sin(rad), 100 - r * Math.cos(rad)];
  },

  _arc(r, degFrom, degTo) {
    const [x1, y1] = this._pt(r, degFrom);
    const [x2, y2] = this._pt(r, degTo);
    const large = (degTo - degFrom) > 180 ? 1 : 0;
    return 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
      ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
  },

  _deg(g, val) { return -120 + (val - g.min) / (g.max - g.min) * 240; },

  _buildGauge(g) {
    const R = 82;
    let s = '<svg viewBox="0 0 200 178" xmlns="http://www.w3.org/2000/svg">';

    // podkladový oblouk celého rozsahu
    s += '<path class="g-base" d="' + this._arc(R, -120, 120) + '"/>';

    // barevné zóny
    if (g.zones) {
      let from = g.min;
      for (const z of g.zones) {
        s += '<path class="g-' + z.cls + '" d="' + this._arc(R, this._deg(g, from), this._deg(g, z.to)) + '"/>';
        from = z.to;
      }
    }

    // dílky stupnice s popisky
    for (const val of g.ticks) {
      const deg = this._deg(g, val);
      const [x1, y1] = this._pt(R - 8, deg);
      const [x2, y2] = this._pt(R + 6, deg);
      const [tx, ty] = this._pt(R - 20, deg);
      const strong = val === 0 && g.min < 0; // nula u výkonu ať je vidět
      s += '<line class="g-tick' + (strong ? ' strong' : '') + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
        '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
      s += '<text class="g-label" x="' + tx.toFixed(1) + '" y="' + (ty + 3).toFixed(1) + '" text-anchor="middle">' + val + '</text>';
    }

    // ručička (kreslená svisle nahoru, natáčí se transformem) + středový bod
    s += '<g class="needle"><line x1="100" y1="100" x2="100" y2="' + (100 - (R - 12)) + '"/></g>';
    s += '<circle class="g-hub" cx="100" cy="100" r="5"/>';
    s += '</svg>';
    return s;
  }
};
