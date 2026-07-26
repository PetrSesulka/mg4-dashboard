// Grafy průběhu jízdy — výkon a teploty za posledních ~30 minut.
// Vzorkuje se 1× za sekundu do kruhového bufferu, překresluje se každé 2 s.

MG.charts = {
  MAX_POINTS: 1800, // 30 minut při 1 Hz

  _data: { labels: [], power: [], battTemp: [], motorTemp: [], outside: [] },
  _chartPower: null,
  _chartTemp: null,
  _sampleTimer: null,
  _drawTimer: null,
  active: false, // vzorkuje se jen když běží demo nebo živé čtení

  init() {
    const gridColor = 'rgba(255,255,255,0.06)';
    const tickColor = '#8b95a5';

    const common = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false },
      scales: {
        x: { ticks: { color: tickColor, maxTicksLimit: 6, autoSkip: true, maxRotation: 0 }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor }, grid: { color: gridColor } },
      },
    };

    this._chartPower = new Chart(document.getElementById('chartPower'), {
      type: 'line',
      data: {
        labels: this._data.labels,
        datasets: [{
          label: 'Výkon', data: this._data.power,
          borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.12)',
          fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.25,
        }],
      },
      options: Object.assign({}, common, { plugins: { legend: { display: false } } }),
    });

    this._chartTemp = new Chart(document.getElementById('chartTemp'), {
      type: 'line',
      data: {
        labels: this._data.labels,
        datasets: [
          { label: 'Baterie', data: this._data.battTemp, borderColor: '#fbbf24', borderWidth: 1.5, pointRadius: 0, tension: 0.25 },
          { label: 'Motor', data: this._data.motorTemp, borderColor: '#f87171', borderWidth: 1.5, pointRadius: 0, tension: 0.25 },
          { label: 'Venku', data: this._data.outside, borderColor: '#60a5fa', borderWidth: 1.5, pointRadius: 0, tension: 0.25 },
        ],
      },
      options: Object.assign({}, common, {
        plugins: { legend: { display: true, labels: { color: tickColor, boxWidth: 12, font: { size: 11 } } } },
      }),
    });

    this._sampleTimer = setInterval(() => { if (this.active) this._sample(); }, 1000);
    this._drawTimer = setInterval(() => { if (this.active) this._draw(); }, 2000);
  },

  _sample() {
    const d = this._data;
    const now = new Date();
    d.labels.push(now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    d.power.push(MG.state.get('power', 10000));
    d.battTemp.push(MG.state.get('battTemp'));
    d.motorTemp.push(MG.state.get('motorTemp'));
    d.outside.push(MG.state.get('outsideTemp'));

    if (d.labels.length > this.MAX_POINTS) {
      d.labels.shift(); d.power.shift(); d.battTemp.shift(); d.motorTemp.shift(); d.outside.shift();
    }
  },

  _draw() {
    if (this._chartPower) this._chartPower.update('none');
    if (this._chartTemp) this._chartTemp.update('none');
  },

  reset() {
    const d = this._data;
    d.labels.length = 0; d.power.length = 0; d.battTemp.length = 0; d.motorTemp.length = 0; d.outside.length = 0;
    this._draw();
  }
};
