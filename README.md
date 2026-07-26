# MG4 Dashboard

Webová aplikace, která přes Bluetooth (BLE) OBD adaptér čte živá data z elektromobilu
**MG4** a zobrazuje je na přehledném dashboardu: SoC, teplotu baterie a motoru,
okamžitou spotřebu, výkon, napětí článků, 12V baterii a další — včetně grafů
průběhu jízdy.

## Co potřebuješ

1. **BLE OBD adaptér** — s iPhonem fungují *jen* adaptéry s Bluetooth Low Energy:
   - vGate iCar Pro **Bluetooth 4.0 (BLE)** — ověřený, ~700 Kč
   - vLinker MC+ — ~1000 Kč
   - OBDLink CX

   ⚠️ Klasické levné Bluetooth ELM327 adaptéry („jen Android") s iPhonem nefungují.
   WiFi adaptéry s touto aplikací nefungují vůbec.

2. **Na iPhonu:** aplikaci **Bluefy – Web BLE Browser** (zdarma na App Store).
   Safari totiž Web Bluetooth neumí, Bluefy ano.

3. **Na PC:** stačí Chrome nebo Edge (Web Bluetooth umí přímo).

## Jak to spustit

1. Zapoj adaptér do OBD zásuvky (u MG4 pod volantem) a zapni zapalování.
2. Otevři aplikaci (adresa GitHub Pages, nebo lokálně `index.html`)
   — na iPhonu **v Bluefy**, na PC v Chrome.
3. Klepni na **Připojit** a vyber adaptér ze seznamu.
4. Hodnoty se začnou načítat; grafy se plní během jízdy.

Bez auta si můžeš vše prohlédnout v **Demo** režimu (simulovaná jízda).

## Diagnostika (důležité pro první jízdu)

PID kódy vycházejí z komunitního reverse engineeringu platformy SAIC
(ZS EV / MG5 / MG4 — fórum [mgevs.com](https://www.mgevs.com/threads/obd-data.8909/),
repo [MG4-EV-OBD-PID](https://github.com/bugcoder76/MG4-EV-OBD-PID)). Na MG4 nemusí
fungovat všechny:

- Sekce **Diagnostika** (dole) ukazuje u každého PID surovou odpověď auta a stav.
- Tlačítko **Otestovat všechny PID** projede celý seznam naráz — výsledek ukáže,
  co tvoje konkrétní auto podporuje.
- PID, který opakovaně neodpovídá, aplikace sama vyřadí a za minutu zkusí znovu.

## Upozornění

- **Nenechávej adaptér v autě trvale zapojený** — vybíjí 12V baterii a u některých
  kusů MG4 spouští alarm.
- Neoficiální nástroj, bez záruky. Čte pouze data (UDS ReadDataByIdentifier),
  do auta nic nezapisuje.
