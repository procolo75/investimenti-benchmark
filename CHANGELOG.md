# Changelog

## v1.3.2 — 17/11/2026
- La sezione dei tassi modificabili si chiama «Modifica i tassi che non si aggiornano da soli», spiega a cosa serve e mostra solo gli strumenti accesi in «Confronta anche».

## v1.3.1 — 17/11/2026
- Le note dei BTP dicono quanti mesi prima (o dopo) la fine della durata scade il titolo e cosa succede in quel periodo.
- Colonna «Netto meno inflazione, all'anno» e spiegazione separata del valore sul totale, anche nella guida.

## v1.3.0 — 17/11/2026
- Nuova **guida** (`guida.html`, pulsante «Guida» in alto): parole di base, strumenti, tasse, bollo, commissioni, inflazione, reinvestimento, garanzie, ISEE e successione, un esempio completo in euro e glossario.

## v1.2.3 — 17/11/2026
- Nelle note: i BTP pagano una cedola ogni 6 mesi (reinvestibile anche su durate brevi), i BOT non pagano cedole e danno il guadagno tutto alla scadenza.

## v1.2.2 — 17/11/2026
- Quando reinvestire non cambia nulla (es. BOT 12 mesi su 1 anno: si compra una volta e scade alla fine) la pagina lo dice invece di mostrare «+0 €».

## v1.2.1 — 17/11/2026
- Colonne rinominate «Netto all'anno» e «Netto meno inflazione», con una spiegazione ed esempio sopra la tabella.
- I costi mostrano il dettaglio: bollo, commissioni, spese del conto.

## v1.2.0 — 17/11/2026
- Nuova colonna **«Reinvestire vale»**: quanto in più si ottiene scegliendo Reinvesti invece di Incassa, per ogni strumento; e una scheda in alto per il migliore. Spiegato perché in pochi anni la differenza è piccola.
- Conti deposito ed ETF diventano opzionali (spenti all'inizio), insieme ai buoni postali: pulsanti «Confronta anche».

## v1.1.0 — 17/11/2026
- BOT a 3, 6 e 12 mesi come tre strategie separate, ognuna ricomprata all'asta a ogni scadenza fino alla fine della durata (con o senza reinvestire il guadagno).
- Tolti i menu per scegliere BTP e BTP indicizzato: cambiavano il risultato di pochi euro e confondevano. La pagina sceglie da sola il titolo e lo spiega nella riga.

## v1.0.0 — 17/11/2026
- Prima versione: confronto netto di BOT, BTP, BTP indicizzati, conti deposito, buoni postali, ETF e liquidità.
- Tasse, bollo, commissioni (preset o personalizzate), spese fisse del conto titoli, inflazione e rendimento reale.
- Tassi aggiornati da `aggiorna_tassi.py` e da una GitHub Action nei giorni feriali.
