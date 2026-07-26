// Globální jmenný prostor aplikace + jednoduché úložiště aktuálních hodnot.
// Každá hodnota si pamatuje čas poslední aktualizace, aby šlo poznat zastaralá data.
window.MG = window.MG || {};

MG.state = {
  _vals: {}, // klíč -> { v: hodnota, t: čas uložení v ms }

  set(key, v) {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    this._vals[key] = { v: v, t: Date.now() };
  },

  // Vrátí hodnotu, nebo null pokud chybí / je starší než maxAgeMs
  get(key, maxAgeMs = 30000) {
    const rec = this._vals[key];
    if (!rec) return null;
    if (Date.now() - rec.t > maxAgeMs) return null;
    return rec.v;
  },

  // Stáří hodnoty v ms (Infinity = nikdy nenastavena)
  age(key) {
    const rec = this._vals[key];
    return rec ? Date.now() - rec.t : Infinity;
  },

  clear(key) { delete this._vals[key]; },

  reset() { this._vals = {}; }
};
