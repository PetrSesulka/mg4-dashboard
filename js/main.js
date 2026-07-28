// Hlavní řízení aplikace: tlačítka, stavy připojení, diagnostika.

(function () {
  const $ = id => document.getElementById(id);
  const statusEl = $('status');
  const btnConnect = $('btnConnect');
  const btnDemo = $('btnDemo');
  const btnStop = $('btnStop');
  const hintEl = $('hint');
  const logEl = $('log');
  const elmInfoEl = $('elmInfo');

  let mode = null; // null | 'demo' | 'live'
  let wakeLock = null;

  // ---------- diagnostický log ----------
  const logLines = [];
  function log(dir, text) {
    const t = new Date().toLocaleTimeString('cs-CZ');
    logLines.push('[' + t + '] ' + dir + ' ' + text);
    if (logLines.length > 300) logLines.shift();
    logEl.textContent = logLines.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---------- tabulka PID v diagnostice ----------
  const pidRows = {};
  function initPidTable() {
    const tbody = document.querySelector('#pidTable tbody');
    tbody.innerHTML = '';
    for (const pid of MG.PIDS) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (pid.req || pid.atCmd || '—') + '</td><td>' + pid.label + '</td>' +
        '<td class="raw">—</td><td>—</td><td>—</td>';
      tbody.appendChild(tr);
      pidRows[pid.key] = tr.querySelectorAll('td');
    }
  }

  MG.poller.onPidResult = (pid, stav, raw, v) => {
    const tds = pidRows[pid.key];
    if (!tds) return;
    tds[2].textContent = raw;
    tds[3].textContent = v !== null ? v.toFixed(2) + ' ' + pid.unit : '—';
    tds[4].textContent = stav;
    tds[4].className = stav === 'OK' ? 'ok' : (stav === 'vyřazen' ? 'dead' : '');
  };

  // ---------- stav připojení ----------
  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'badge ' + cls;
  }

  function showHint(text) {
    hintEl.textContent = text;
    hintEl.hidden = !text;
  }

  function setMode(m) {
    mode = m;
    btnConnect.hidden = m !== null;
    btnDemo.hidden = m !== null;
    btnStop.hidden = m === null;
    MG.charts.active = m !== null;
  }

  // ---------- zámek displeje (ať v autě nezhasíná) ----------
  async function keepScreenOn() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* nepodporováno — nevadí */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mode !== null) keepScreenOn();
  });

  // ---------- akce tlačítek ----------
  btnDemo.addEventListener('click', () => {
    MG.state.reset();
    MG.derived.reset();
    MG.charts.reset();
    MG.demo.start();
    setMode('demo');
    setStatus('Demo režim', 'demo');
    showHint('');
    keepScreenOn();
  });

  btnConnect.addEventListener('click', async () => {
    try {
      setStatus('Vybírám zařízení…', 'off');
      const name = await MG.ble.connect();
      setStatus('Inicializuji adaptér…', 'off');

      MG.elm.attach(MG.ble);
      MG.elm.onLog = log;
      log('SYS', 'BLE dvojice: ' + MG.ble.describeGatt());
      await MG.elm.init();
      elmInfoEl.textContent = name + ' · ' + MG.elm.version;

      MG.state.reset();
      MG.derived.reset();
      MG.charts.reset();
      MG.poller.start();
      setMode('live');
      setStatus('Připojeno: ' + name, 'on');
      showHint('');
      keepScreenOn();
    } catch (err) {
      MG.ble.disconnect();
      setMode(null);
      if (err && err.name === 'NotFoundError') {
        setStatus('Odpojeno', 'off');
        showHint('Výběr zařízení byl zrušen, nebo nebyl žádný adaptér nalezen. Adaptér musí být ' +
          'zapojený v OBD zásuvce, zapalování zapnuté a žádná jiná aplikace (Car Scanner!) ' +
          'k němu nesmí být připojená.');
      } else {
        setStatus('Chyba připojení', 'off');
        const detail = err && err.name ? err.name + ': ' + err.message : String(err);
        let tip = '';
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          tip = ' Nejspíš chybí povolení: iOS Nastavení → Bluefy → zapnout Bluetooth.';
        }
        showHint('Připojení selhalo — ' + detail + '.' + tip + ' (Přesný text chyby mi pošli, pomůže s laděním.)');
        log('ERR', detail);
      }
    }
  });

  btnStop.addEventListener('click', () => {
    MG.demo.stop();
    MG.poller.stop();
    MG.ble.disconnect();
    setMode(null);
    setStatus('Odpojeno', 'off');
  });

  MG.ble.onDisconnect(() => {
    if (mode === 'live') {
      MG.poller.stop();
      setMode(null);
      setStatus('Spojení ztraceno', 'off');
      showHint('Bluetooth spojení s adaptérem se přerušilo. Zkontroluj adaptér a připoj znovu.');
    }
  });

  $('btnTestAll').addEventListener('click', async (e) => {
    if (mode !== 'live') { showHint('Test PID funguje jen při živém připojení k autu.'); return; }
    e.target.disabled = true;
    e.target.textContent = 'Testuji…';
    await MG.poller.testAll();
    e.target.disabled = false;
    e.target.textContent = 'Otestovat všechny PID';
  });

  $('btnClearLog').addEventListener('click', () => {
    logLines.length = 0;
    logEl.textContent = '';
  });

  // ---------- start ----------
  MG.dashboard.init();
  MG.detail.init();
  MG.charts.init();
  initPidTable();
  MG.dashboard.render();

  if (!navigator.bluetooth) {
    btnConnect.disabled = true;
    showHint('Tento prohlížeč neumí Web Bluetooth. Na iPhonu otevři tuto stránku v aplikaci ' +
      '„Bluefy – Web BLE Browser" (zdarma na App Store). Na PC použij Chrome nebo Edge. ' +
      'Demo režim funguje všude.');
  }
})();
