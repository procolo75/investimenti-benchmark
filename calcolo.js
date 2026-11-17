// Motore di simulazione: funzioni pure, senza DOM. Usato da index.html e dai test (node test.js).
// Simulazione mese per mese. Tutti i tassi sono in % annue; gli importi in euro.
(function (root) {
  'use strict';

  const BOLLO = 0.002;          // imposta di bollo annua su conto titoli e conti deposito
  const TASSA_STATO = 0.125;    // titoli di Stato e Buoni postali
  const TASSA_ALTRO = 0.26;     // conti deposito, ETF, azioni

  const GIORNI_MESE = 30.4375;

  function mesiTra(daIso, aIso) {
    const ms = new Date(aIso + 'T00:00:00Z') - new Date(daIso + 'T00:00:00Z');
    return Math.round(ms / 86400000 / GIORNI_MESE);
  }

  // Commissione del broker: % dell'importo con minimo e massimo in euro (max 0 = nessun massimo).
  function commissione(importo, c) {
    if (!(importo > 0) || !c) return 0;
    let v = importo * (c.pct || 0) / 100;
    if (c.min > 0) v = Math.max(v, c.min);
    if (c.max > 0) v = Math.min(v, c.max);
    return v;
  }

  // Tetto di legge alle commissioni per i BOT comprati all'asta (DM Tesoro), in base alla durata.
  function tettoAstaBot(mesi) {
    const g = mesi * GIORNI_MESE;
    return g <= 80 ? 0.0003 : g <= 140 ? 0.0005 : g <= 270 ? 0.001 : 0.0015;
  }

  // Prezzo tel quel (con rateo) per 100 di nominale: cedole semestrali, capitalizzazione annua.
  function prezzo(ytm, cedola, mesiResidui) {
    if (mesiResidui <= 0) return 100 + (cedola > 0 && mesiResidui === 0 ? cedola / 2 : 0);
    const y = 1 + ytm / 100;
    let p = 100 / Math.pow(y, mesiResidui / 12);
    if (cedola > 0) for (let t = mesiResidui; t > 0; t -= 6) p += (cedola / 2) / Math.pow(y, t / 12);
    return p;
  }

  function annualizza(finale, iniziale, mesi) {
    if (!(finale > 0) || !(iniziale > 0) || !(mesi > 0)) return null;
    return (Math.pow(finale / iniziale, 12 / mesi) - 1) * 100;
  }

  // ---------------- Curve e scelta dei titoli ----------------

  function conMesi(titoli, oggi) {
    return titoli.map(t => Object.assign({}, t, { mesi: mesiTra(oggi, t.scadenza) })).filter(t => t.mesi >= 1);
  }

  // Rendimento BOT per una durata in mesi, interpolando i BOT quotati.
  function curvaBot(titoli, oggi) {
    const pts = conMesi(titoli.filter(t => t.tipo === 'BOT'), oggi)
      .map(t => [t.mesi, t.ytm_lordo]).sort((a, b) => a[0] - b[0]);
    // più BOT con la stessa durata in mesi: media
    const agg = [];
    for (const [m, y] of pts) {
      const u = agg[agg.length - 1];
      if (u && u[0] === m) { u[2].push(y); u[1] = u[2].reduce((a, b) => a + b) / u[2].length; } else agg.push([m, y, [y]]);
    }
    return function (mesi) {
      if (!agg.length) return 2;
      if (mesi <= agg[0][0]) return agg[0][1];
      for (let i = 1; i < agg.length; i++) {
        if (mesi <= agg[i][0]) {
          const [m0, y0] = agg[i - 1], [m1, y1] = agg[i];
          return y0 + (y1 - y0) * (mesi - m0) / (m1 - m0);
        }
      }
      return agg[agg.length - 1][1];
    };
  }

  // Titoli di un certo tipo ordinati per vicinanza della scadenza alla durata scelta;
  // a parità (entro 3 mesi dal più vicino) prima quello con rendimento netto più alto.
  function candidati(titoli, oggi, tipi, mesi) {
    const lista = conMesi(titoli.filter(t => tipi.includes(t.tipo)), oggi);
    if (!lista.length) return [];
    const dist = t => Math.abs(t.mesi - mesi);
    const best = Math.min(...lista.map(dist));
    // gruppo 0: vicini e con scadenza entro la durata (tenuti a scadenza); 1: vicini; 2: gli altri
    const gruppo = t => dist(t) - best > 3 ? 2 : t.mesi <= mesi + 1 ? 0 : 1;
    return lista.sort((a, b) => {
      const ga = gruppo(a), gb = gruppo(b);
      if (ga !== gb) return ga - gb;
      if (ga < 2) return (b.ytm_netto ?? b.ytm_lordo) - (a.ytm_netto ?? a.ytm_lordo);
      return dist(a) - dist(b);
    });
  }

  // Durata del prossimo BOT da comprare all'asta quando ne scade uno (al massimo "max" mesi).
  // Con meno di 3 mesi rimasti non si compra nulla: i soldi restano sul conto.
  function durataBot(restanti, max = 12) {
    return [12, 6, 3].find(d => d <= max && d <= restanti) || 0;
  }

  // ---------------- Titoli di Stato (BOT, BTP, BTP indicizzati) ----------------
  // o: { mesi, capitale, reinvesti, comm, speseAnnue, inflazione, primo: sec, curva: fn(mesi)->ytm }
  // sec: { nome, cedola, ytm, scad (mese assoluto di scadenza), indicizzato, lotto, asta }
  function simTitoli(o) {
    const T = o.mesi, tassa = TASSA_STATO;
    let cash = o.capitale, sec = null, units = 0, basis = 0, creditoRateo = 0, m0 = 0;
    let tasse = 0, commissioni = 0, bollo = 0, spese = 0;
    const acquisti = [];
    const serie = [o.capitale];

    const F = m => (sec && sec.indicizzato) ? Math.pow(1 + o.inflazione / 100, (m - m0) / 12) : 1;
    // scenario tassi: subito dopo l'acquisto iniziale i rendimenti di mercato si spostano di o.shift punti
    const sh = o.shift || 0;
    const pz = m => prezzo(sec.ytm + (m > 0 ? sh : 0), sec.cedola, sec.scad - m) * F(m);
    const commAcq = (x, m) => {
      const c = commissione(x, o.comm);
      return sec.asta ? Math.min(c, x * tettoAstaBot(sec.scad - m)) : c;
    };

    function compra(m, budget) {
      const p = pz(m) / 100, lotto = sec.lotto || 1000;
      let n = Math.floor(budget / (p * lotto));
      while (n > 0 && n * lotto * p + commAcq(n * lotto * p, m) > budget) n--;
      if (n <= 0) return false;
      const spesa = n * lotto * p, cm = commAcq(spesa, m);
      const left = sec.scad - m, mesiRateo = sec.cedola > 0 ? (6 - left % 6) % 6 : 0;
      const rateo = n * lotto / 100 * sec.cedola / 2 * mesiRateo / 6 * F(m);
      cash -= spesa + cm; commissioni += cm;
      units += n * lotto; basis += spesa - rateo + cm;
      creditoRateo += rateo * tassa;
      return true;
    }

    function apri(m, s, budget) {
      sec = s; m0 = sec.indicizzato && units === 0 ? m : m0;
      if (compra(m, budget)) acquisti.push({ mese: m, nome: s.nome, ytm: s.ytm, scadenzaMesi: s.scad });
      else sec = null;
    }

    function valoreTitoli(m, contabilizza) {
      if (!sec || units <= 0) return 0;
      const lordo = units / 100 * pz(m);
      const cm = commissione(lordo, o.comm);
      const g = lordo - cm - basis;
      const t = Math.max(0, g * tassa);
      if (contabilizza) { commissioni += cm; tasse += t; }
      return lordo - cm - t;
    }

    apri(0, o.primo, o.capitale);

    for (let m = 1; m <= T; m++) {
      if (sec && units > 0) bollo += units / 100 * pz(m - 1) * BOLLO / 12;
      spese += (o.speseAnnue || 0) / 12;

      if (sec && units > 0) {
        const left = sec.scad - m;
        if (sec.cedola > 0 && left >= 0 && left % 6 === 0) {
          const lordo = units / 100 * sec.cedola / 2 * F(m);
          let t = lordo * tassa;
          const cr = Math.min(creditoRateo, t);
          t -= cr; creditoRateo -= cr;
          tasse += t; cash += lordo - t;
        }
        if (left === 0) {
          const rimb = units * Math.max(F(m), 1);
          const g = rimb - basis, t = Math.max(0, g * tassa);
          tasse += t; cash += rimb - t;
          units = 0; basis = 0; creditoRateo = 0; sec = null;
          const rest = T - m, d = durataBot(rest, o.tenoreBot || 12);
          if (d > 0) {
            const budget = o.reinvesti ? cash : Math.min(cash, o.capitale);
            apri(m, { nome: `BOT ${d} mesi (rinnovo)`, cedola: 0, ytm: o.curva(d), scad: m + d, lotto: 1000, asta: true }, budget);
          }
        } else if (o.reinvesti && left >= 3 && cash > 0) {
          compra(m, cash);
        }
      }
      serie.push(cash + valoreTitoli(m, false) - bollo - spese);
    }
    const finale = cash + valoreTitoli(T, true) - bollo - spese;
    serie[T] = finale;
    return { serie, finale, tasse, costi: commissioni + bollo + spese, commissioni, bollo, acquisti };
  }

  // ---------------- Conto deposito ----------------
  // o: { mesi, capitale, reinvesti, libero, vincolati: {mesi: tasso}, vincolato: bool }
  function simDeposito(o) {
    const T = o.mesi, tassa = TASSA_ALTRO;
    const durate = Object.keys(o.vincolati || {}).map(Number).filter(d => o.vincolati[d] > 0).sort((a, b) => b - a);
    let B = o.capitale, cash = 0, tasse = 0, bollo = 0, maturato = 0;
    const serie = [B];
    const segmenti = [];
    let m = 0;
    while (m < T) {
      const rest = T - m;
      const d = o.vincolato ? durate.find(x => x <= rest) : null;
      // scenario tassi: i vincoli rinnovati e il conto libero usano il tasso spostato
      const sh = o.shift || 0;
      if (d) segmenti.push({ da: m, a: m + d, tasso: Math.max(0, o.vincolati[d] + (m > 0 ? sh : 0)), vincolo: d, ogni: Math.min(d, 12) });
      else segmenti.push({ da: m, a: T, tasso: Math.max(0, o.libero + sh), vincolo: 0, ogni: 3 });
      m = segmenti[segmenti.length - 1].a;
    }
    let s = 0;
    for (m = 1; m <= T; m++) {
      const seg = segmenti[s];
      bollo += B * BOLLO / 12;
      maturato += B * seg.tasso / 100 / 12;
      const passati = m - seg.da;
      if (passati % seg.ogni === 0 || m === seg.a) {
        const t = maturato * tassa;
        tasse += t;
        if (o.reinvesti) B += maturato - t; else cash += maturato - t;
        maturato = 0;
      }
      if (m === seg.a) s++;
      // valore se si esce oggi: nel libero si incassano gli interessi maturati, nel vincolato si perdono
      const extra = seg.vincolo ? 0 : maturato * (1 - tassa);
      serie.push(B + cash + extra - bollo);
    }
    const finale = B + cash - bollo;
    serie[T] = finale;
    return { serie, finale, tasse, costi: bollo, commissioni: 0, bollo, segmenti };
  }

  // ---------------- Buoni fruttiferi postali ----------------
  // o: { mesi, capitale, reinvesti, buono: {durata_anni, tappe: [[anni, tasso]]}, sogliaBollo }
  function simBFP(o) {
    const T = o.mesi, durata = o.buono.durata_anni * 12, tassa = TASSA_STATO;
    let rinnovato = false; // scenario tassi: i buoni riacquistati alla scadenza hanno tassi spostati
    const fattore = e => {
      let f = 1;
      for (const [anni, r] of o.buono.tappe) if (e >= anni * 12) f = Math.pow(1 + Math.max(0, r + (rinnovato ? (o.shift || 0) : 0)) / 100, anni);
      return f;
    };
    let cap = o.capitale, inizio = 0, cash = 0, tasse = 0, bollo = 0;
    const serie = [cap];
    const netto = (c, f) => c * f - Math.max(0, c * (f - 1)) * tassa;
    for (let m = 1; m <= T; m++) {
      const e = m - inizio;
      const val = cap * fattore(e - 1);
      if (val > o.sogliaBollo) bollo += val * BOLLO / 12;
      if (e === durata && m < T) {
        const f = fattore(e), t = cap * (f - 1) * tassa;
        tasse += t;
        const tot = cap * f - t;
        if (o.reinvesti) cap = tot; else { cash += tot - o.capitale; cap = o.capitale; }
        inizio = m; rinnovato = true;
        serie.push(cap + cash - bollo);
      } else {
        serie.push(netto(cap, fattore(e)) + cash - bollo);
      }
    }
    const fT = fattore(T - inizio);
    tasse += Math.max(0, cap * (fT - 1)) * tassa;
    const finale = netto(cap, fT) + cash - bollo;
    serie[T] = finale;
    return { serie, finale, tasse, costi: bollo, commissioni: 0, bollo };
  }

  // ---------------- ETF ----------------
  // o: { mesi, capitale, reinvesti, rendimento (totale lordo), distribuzione (% annua), ter, tassa, comm, speseAnnue }
  // reinvesti = ETF ad accumulazione; altrimenti a distribuzione (proventi tassati e incassati ogni anno).
  function simETF(o) {
    const T = o.mesi, tassa = o.tassa / 100;
    const dist = o.reinvesti ? 0 : (o.distribuzione || 0);
    const g = Math.pow(1 + (o.rendimento - o.ter - dist) / 100, 1 / 12);
    let commissioni = commissione(o.capitale, o.comm);
    let units = o.capitale - commissioni, prezzoQ = 1, basis = o.capitale;
    let cash = 0, tasse = 0, bollo = 0, spese = 0;
    const serie = [o.capitale];
    const liquida = (m, conta) => {
      const v = units * prezzoQ, cm = commissione(v, o.comm), t = Math.max(0, v - cm - basis) * tassa;
      if (conta) { commissioni += cm; tasse += t; }
      return v - cm - t;
    };
    for (let m = 1; m <= T; m++) {
      bollo += units * prezzoQ * BOLLO / 12;
      spese += (o.speseAnnue || 0) / 12;
      prezzoQ *= g;
      if (m === 1 && o.shock) prezzoQ *= 1 + o.shock / 100;
      if (dist && m % 12 === 0) {
        const p = units * prezzoQ * dist / 100, t = p * tassa;
        tasse += t; cash += p - t;
      }
      serie.push(cash + liquida(m, false) - bollo - spese);
    }
    const finale = cash + liquida(T, true) - bollo - spese;
    serie[T] = finale;
    return { serie, finale, tasse, costi: commissioni + bollo + spese, commissioni, bollo };
  }

  // ---------------- Confronto completo ----------------
  // dati: contenuto di tassi.json; inp: scelte dell'utente (vedi index.html)
  function confronta(dati, inp) {
    const T = inp.mesi, C = inp.capitale, oggi = inp.oggi || dati.aggiornato;
    const curva = curvaBot(dati.titoli, oggi);
    const sh = inp.shift || 0;
    const base = { mesi: T, capitale: C, reinvesti: inp.reinvesti, comm: inp.comm, speseAnnue: inp.speseAnnue, inflazione: inp.inflazione, curva, shift: sh };
    const out = [];
    const add = (id, nome, gruppo, garanzia, r, nota) => out.push(Object.assign({ id, nome, gruppo, garanzia, nota }, r));

    // BOT a 3, 6 e 12 mesi comprati all'asta e ricomprati a ogni scadenza fino alla fine della durata
    for (const d of [3, 6, 12]) {
      if (d > T && d !== 3) continue;
      const r = simTitoli(Object.assign({}, base, { tenoreBot: d,
        primo: { nome: `BOT ${d} mesi`, cedola: 0, ytm: curva(d), scad: d, lotto: 1000, asta: true } }));
      const volte = r.acquisti.length;
      const resto = T - r.acquisti.filter(a => a.nome.includes(`${d} mesi`)).length * d;
      let nota = `${fmtPct(curva(d))} lordo; non paga cedole: il guadagno arriva tutto alla scadenza; ${volte === 1 ? 'comprato una volta' : `comprato ${volte} volte di fila all'asta`}`;
      if (resto > 0 && volte > 1) nota += ` (l'ultimo pezzo di ${resto} mesi con un BOT più corto)`;
      if (d > T) nota += `; venduto prima della scadenza`;
      if (volte > 1) nota += inp.reinvesti ? '; a ogni rinnovo si reinveste anche il guadagno' : '; a ogni rinnovo si reinveste solo il capitale iniziale';
      add('bot' + d, `BOT ${d} mesi, rinnovati`, 'Titoli di Stato', 'Stato italiano', r, nota);
    }

    // BTP a tasso fisso
    const btp = trova(dati.titoli, oggi, ['BTP'], T, inp.btpIsin);
    if (btp) {
      const r = simTitoli(Object.assign({}, base, { primo: secDa(btp) }));
      add('btp', `BTP a tasso fisso (${btp.nome.replace(/^BTP\s*/, '')})`, 'Titoli di Stato', 'Stato italiano', r,
        `paga una cedola ogni 6 mesi (reinvestibile); scelto da solo: il BTP che scade più vicino alla durata con il miglior rendimento netto; ${notaTitolo(btp, T)}`);
    }
    // BTP indicizzati all'inflazione
    const btpi = trova(dati.titoli, oggi, ['BTPi', 'BTPItalia'], T, inp.btpiIsin);
    if (btpi) {
      const r = simTitoli(Object.assign({}, base, { primo: Object.assign(secDa(btpi), { indicizzato: true }) }));
      add('btpi', `BTP legato all'inflazione (${btpi.nome})`, 'Titoli di Stato', 'Stato italiano', r,
        `capitale e cedole crescono con l'inflazione: rende ${fmtPct(btpi.ytm_lordo)} lordo più l'inflazione che imposti; ` +
        notaTitolo(btpi, T).replace(/, cedola .*? lordo/, ''));
    }

    // Conti deposito
    const cd = inp.conti || dati.conti_deposito;
    add('cdv', 'Conto deposito vincolato', 'Conti e buoni', 'Fondo garanzia depositi (100.000 €)',
      simDeposito(Object.assign({}, base, { libero: cd.libero, vincolati: cd.vincolati, vincolato: true })),
      'vincoli più lunghi possibili entro la durata, poi rinnovati; il resto su conto libero');
    add('cdl', 'Conto deposito libero', 'Conti e buoni', 'Fondo garanzia depositi (100.000 €)',
      simDeposito(Object.assign({}, base, { libero: cd.libero, vincolati: {}, vincolato: false })),
      `${fmtPct(cd.libero)} lordo, interessi accreditati ogni 3 mesi`);

    // Buoni fruttiferi postali
    const bfp = inp.bfp || dati.bfp;
    for (const b of bfp.buoni) {
      const r = simBFP(Object.assign({}, base, { buono: b, sogliaBollo: bfp.soglia_bollo }));
      const tappe = b.tappe.map(([a, t]) => `${fmtPct(t)} a ${a} anni`).join(', ');
      add('bfp-' + b.id, b.nome, 'Conti e buoni', 'Stato italiano (CDP)', r,
        `${tappe}; tra una tappa e l'altra non matura nulla${T > b.durata_anni * 12 ? '; alla scadenza riacquistato' : ''}`);
    }

    // ETF
    const etf = inp.etf || dati.etf;
    const ob = etf.obbligazionario;
    const rendOb = ob.rendimento ?? dati.gov_euro_7a ?? 3;
    add('etf-obb', ob.nome, 'ETF', 'Mercato (prezzo variabile)',
      simETF(Object.assign({}, base, { rendimento: rendOb + sh, distribuzione: rendOb + sh, ter: ob.ter, tassa: ob.tasse, shock: -7 * sh })),
      `rendimento a scadenza ${fmtPct(rendOb)} lordo, TER ${fmtPct(ob.ter)}; ipotizza tassi stabili`);
    const az = etf.azionario;
    for (const [k, v] of Object.entries(az.scenari)) {
      add('etf-az-' + k, `${az.nome} (${k})`, 'ETF', 'Mercato (può perdere)',
        simETF(Object.assign({}, base, { rendimento: v, distribuzione: az.dividendi, ter: az.ter, tassa: az.tasse })),
        `scenario ${fmtPct(v)} annuo lordo, TER ${fmtPct(az.ter)}; non è una previsione`);
    }

    // Liquidità ferma
    add('cash', 'Liquidità ferma sul conto', 'Riferimenti', '—',
      { serie: Array.from({ length: T + 1 }, () => C), finale: C, tasse: 0, costi: 0, commissioni: 0, bollo: 0 },
      'nessun rendimento: perde potere d\'acquisto con l\'inflazione');

    const defl = Math.pow(1 + inp.inflazione / 100, T / 12);
    for (const r of out) {
      r.guadagno = r.finale - C;
      r.annuo = annualizza(r.finale, C, T);
      r.reale = annualizza(r.finale / defl, C, T);
      r.finaleReale = r.finale / defl;
    }
    out.sort((a, b) => b.finale - a.finale);
    return { risultati: out, inflazione: Array.from({ length: T + 1 }, (_, m) => C * Math.pow(1 + inp.inflazione / 100, m / 12)), btp, btpi };

    function trova(titoli, oggi, tipi, mesi, isin) {
      const c = candidati(titoli, oggi, tipi, mesi);
      return (isin && c.find(t => t.isin === isin)) || c[0] || null;
    }
    function secDa(t) {
      return { nome: t.nome, cedola: t.cedola, ytm: t.ytm_lordo, scad: t.mesi, lotto: t.lotto || 1000, asta: false };
    }
    function notaTitolo(t, T) {
      const pz = (Math.round(t.prezzo * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 });
      const s = `scadenza ${t.scadenza.split('-').reverse().join('/')}, cedola ${fmtPct(t.cedola)}, prezzo ${pz} (paghi ${pz} € per riavere 100 € alla scadenza), rendimento ${fmtPct(t.ytm_lordo)} lordo`;
      const diff = T - t.mesi, n = testoMesi(Math.abs(diff)), ultimi = Math.abs(diff) === 1 ? "l'ultimo mese" : `gli ultimi ${n}`;
      if (diff >= 3) return s + `; scade ${n} prima della fine della durata scelta: per ${ultimi} i soldi vanno in BOT`;
      if (diff > 0) return s + `; scade ${n} prima della fine della durata scelta: per ${ultimi} i soldi restano sul conto`;
      if (diff < 0) return s + `; scade ${n} dopo la fine della durata scelta: si vende prima, al prezzo stimato con i tassi di oggi`;
      return s + '; scade alla fine della durata scelta: tenuto fino a scadenza';
    }
  }

  function testoMesi(m) {
    const a = Math.floor(m / 12), r = m % 12;
    const ta = a ? (a === 1 ? '1 anno' : `${a} anni`) : '', tm = r ? (r === 1 ? '1 mese' : `${r} mesi`) : '';
    return [ta, tm].filter(Boolean).join(' e ') || '0 mesi';
  }

  function fmtPct(v) {
    return (Math.round(v * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  }

  const api = { BOLLO, TASSA_STATO, TASSA_ALTRO, mesiTra, commissione, tettoAstaBot, prezzo, annualizza, curvaBot, candidati, durataBot, simTitoli, simDeposito, simBFP, simETF, confronta };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calcolo = api;
})(typeof window !== 'undefined' ? window : globalThis);
