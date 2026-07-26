// Demo režim — generuje věrohodná data, aby šel dashboard vyzkoušet bez auta.
// Simuluje jízdu: rozjezdy, brzdění (rekuperace), ohřívání baterie a motoru.

MG.demo = {
  running: false,
  _timer: null,

  _s: null, // vnitřní stav simulace

  start() {
    if (this.running) return;
    this.running = true;
    this._s = {
      speed: 0, target: 50,
      soc: 78.4, battTemp: 22, battTempMin: 21, motorTemp: 28,
      battCoolant: 21, motorCoolant: 26, power: 0,
    };
    this._timer = setInterval(() => this._tick(), 500);
  },

  stop() {
    this.running = false;
    clearInterval(this._timer);
  },

  _tick() {
    const s = this._s;
    const rnd = (a, b) => a + Math.random() * (b - a);

    // občas změň cílovou rychlost (simulace provozu)
    if (Math.random() < 0.03) s.target = [0, 30, 50, 70, 90, 110, 130][Math.floor(Math.random() * 7)];

    const accel = Math.max(-6, Math.min(4, (s.target - s.speed) * 0.15)); // km/h za tik
    s.speed = Math.max(0, s.speed + accel + rnd(-0.3, 0.3));

    // výkon: valivý+aero odpor + akcelerace; brzdění = záporný (rekuperace)
    const drag = 0.0011 * s.speed * s.speed + 0.06 * s.speed;
    const accPower = accel * s.speed * 0.11;
    s.power = Math.max(-60, Math.min(150, drag + accPower + rnd(-1, 1)));
    if (s.speed < 1) s.power = rnd(0.3, 0.8); // klimatizace apod.

    // napětí klesá se SoC a mírně s zátěží; proud dopočítáme z výkonu
    const battV = 330 + s.soc * 0.9 - s.power * 0.05 + rnd(-0.5, 0.5);
    const battA = s.power * 1000 / battV;

    // odběr energie ze SoC (61,7 kWh využitelných)
    s.soc = Math.max(0, Math.min(100, s.soc - (s.power * 0.5 / 3600) / 61.7 * 100));

    // teploty se pomalu blíží k hodnotě dané zátěží
    const drift = (cur, target, tau) => cur + (target - cur) / tau;
    s.battTemp = drift(s.battTemp, 20 + Math.abs(s.power) * 0.12, 400);
    s.battTempMin = drift(s.battTempMin, s.battTemp - 1.5, 100);
    s.motorTemp = drift(s.motorTemp, 28 + Math.abs(s.power) * 0.45, 120);
    s.battCoolant = drift(s.battCoolant, s.battTemp - 1, 100);
    s.motorCoolant = drift(s.motorCoolant, s.motorTemp - 8, 100);

    // napětí článků podle SoC ± drobný nesoulad
    const cellBase = 3.25 + s.soc * 0.0085;

    const st = MG.state;
    st.set('battV', battV);
    st.set('battA', battA);
    st.set('speed', s.speed);
    st.set('battTemp', s.battTemp);
    st.set('battTempMin', s.battTempMin);
    st.set('motorTemp', s.motorTemp);
    st.set('battCoolant', s.battCoolant);
    st.set('motorCoolant', s.motorCoolant);
    st.set('soc', s.soc);
    st.set('soh', 97.6);
    st.set('cellMax', cellBase + 0.011);
    st.set('cellMin', cellBase - 0.008);
    st.set('outsideTemp', 21);
    st.set('insideTemp', 23.5 + rnd(-0.3, 0.3));
    st.set('aux12v', 14.2 + rnd(-0.1, 0.1));
    st.set('motorRpm', s.speed * 72);
    st.set('motorTorque', s.power > 0 ? s.power * 9549 / Math.max(s.speed * 72, 500) : 0);

    MG.derived.update();
    MG.dashboard.render();
  }
};
