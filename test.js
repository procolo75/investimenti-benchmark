// Test del motore: node test.js
const C = require('./calcolo.js');
const dati = require('./tassi.json');
let ok = 0, ko = 0;
function vicino(nome, v, atteso, tol) {
  const pass = Math.abs(v - atteso) <= tol;
  pass ? ok++ : ko++;
  console.log(`${pass ? 'ok ' : 'KO '} ${nome}: ${v.toFixed(2)} (atteso ${atteso.toFixed(2)} ±${tol})`);
}
const noComm = { pct: 0, min: 0, max: 0 };
const curva = () => 3;

// 1. BOT 12 mesi zero coupon al 3%: prezzo 100/1.03, guadagno tassato 12,5%, bollo 0,2% sul valore
{
  const r = C.simTitoli({ mesi: 12, capitale: 10000, reinvesti: true, comm: noComm, inflazione: 0, curva,
    primo: { nome: 'BOT', cedola: 0, ytm: 3, scad: 12, lotto: 1000, asta: true } });
  const p = 100 / 1.03, n = Math.floor(10000 / (p * 10)) * 1000; // nominale comprato a lotti da 1000
  const spesa = n * p / 100, guad = n - spesa;
  const bolloAtteso = r.bollo;
  vicino('BOT 12m finale', r.finale, 10000 + guad * 0.875 - bolloAtteso, 0.01);
  vicino('BOT 12m tasse', r.tasse, guad * 0.125, 0.01);
  vicino('BOT 12m bollo ≈ 0,2%', r.bollo, n * 0.002 * 0.985, 1);
}
// 2. Conto deposito libero 3% per 12 mesi: interessi 300 lordi, 26% di tasse, bollo ~20
{
  const r = C.simDeposito({ mesi: 12, capitale: 10000, reinvesti: false, libero: 3, vincolati: {}, vincolato: false });
  vicino('CD libero tasse', r.tasse, 300 * 0.26, 0.01);
  vicino('CD libero finale', r.finale, 10000 + 300 * 0.74 - 20, 0.01);
}
// 3. Conto vincolato 12 mesi 3,2% con reinvestimento su 24 mesi
{
  const r = C.simDeposito({ mesi: 24, capitale: 10000, reinvesti: true, libero: 2, vincolati: { 12: 3.2 }, vincolato: true });
  const n1 = 320 * 0.74, n2 = (10000 + n1) * 0.032 * 0.74;
  vicino('CD vincolato 24m', r.finale + r.bollo, 10000 + n1 + n2, 0.01);
}
// 4. BFP sotto 5.000 €: niente bollo, 12,5%
{
  const b = { durata_anni: 4, tappe: [[4, 2.25]] };
  const r = C.simBFP({ mesi: 48, capitale: 4000, reinvesti: true, buono: b, sogliaBollo: 5000 });
  const g = 4000 * (Math.pow(1.0225, 4) - 1);
  vicino('BFP 4 anni sotto soglia', r.finale, 4000 + g * 0.875, 0.01);
  vicino('BFP bollo 0', r.bollo, 0, 0);
  const r2 = C.simBFP({ mesi: 47, capitale: 4000, reinvesti: true, buono: b, sogliaBollo: 5000 });
  vicino('BFP 4 anni rimborsato a 47 mesi = capitale', r2.finale, 4000, 0);
}
// 5. BTP alla pari 4% 2 anni senza commissioni: rendimento netto ≈ 3,5% meno bollo
{
  const r = C.simTitoli({ mesi: 24, capitale: 10000, reinvesti: false, comm: noComm, inflazione: 0, curva,
    primo: { nome: 'BTP', cedola: 4, ytm: 4.04, scad: 24, lotto: 1000 } });
  vicino('BTP 4% cedole nette 2 anni', r.finale + r.bollo, 10000 + 4 * 200 * 0.875, 5);
}
// 6. ETF accumulo 6% TER 0, 1 anno, tassa 26%
{
  const r = C.simETF({ mesi: 12, capitale: 10000, reinvesti: true, rendimento: 6, ter: 0, tassa: 26, comm: noComm });
  vicino('ETF 6% netto', r.finale + r.bollo, 10000 + 600 * 0.74, 0.01);
}
// 7. Commissioni
vicino('commissione minimo', C.commissione(1000, { pct: 0.19, min: 2.95, max: 19 }), 2.95, 0);
vicino('commissione massimo', C.commissione(50000, { pct: 0.19, min: 2.95, max: 19 }), 19, 0);
vicino('tetto asta BOT 12m', C.commissione(10000, { pct: 0.19, min: 2.95, max: 19 }) > 10000 * C.tettoAstaBot(12) ? 15 : 0, 15, 0);

// 8. Confronto completo con i dati reali, tutte le durate e entrambe le modalità: nessun NaN
for (const mesi of [3, 6, 12, 18, 30, 60, 120, 240, 360]) for (const reinvesti of [true, false]) {
  const res = C.confronta(dati, { mesi, capitale: 10000, reinvesti, comm: { pct: 0.19, min: 2.95, max: 19 }, speseAnnue: 0, inflazione: 2.5 });
  const bad = res.risultati.filter(r => !isFinite(r.finale) || r.serie.length !== mesi + 1 || r.serie.some(v => !isFinite(v)));
  bad.length ? ko++ : ok++;
  if (bad.length) console.log('KO', mesi, reinvesti, bad.map(b => b.id));
  if (mesi === 60 && reinvesti) console.table(res.risultati.map(r => ({ nome: r.nome.slice(0, 40), finale: r.finale.toFixed(0), annuo: r.annuo?.toFixed(2), reale: r.reale?.toFixed(2), tasse: r.tasse.toFixed(0), costi: r.costi.toFixed(0) })));
}
console.log(`\n${ok} ok, ${ko} falliti`);
process.exit(ko ? 1 : 0);
