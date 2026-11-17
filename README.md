# Benchmark Investimenti

**Sito online:** https://procolo75.github.io/investimenti-benchmark/

Quanto ti resta davvero in tasca? Scegli importo, durata e se reinvestire cedole e interessi: la pagina confronta il **valore finale netto** (dopo tasse, bollo e commissioni) di:

- **BOT a 3, 6 e 12 mesi** comprati all'asta e ricomprati a ogni scadenza
- **BTP a tasso fisso** con scadenza più vicina alla durata (scelto in automatico)
- **BTP indicizzati all'inflazione** (BTP€i, BTP Italia)
- **Conto deposito** vincolato e libero
- **Buoni fruttiferi postali** (3x4, 4 anni Plus)
- **ETF** titoli di Stato area euro e azionario mondo (tre scenari)
- **Liquidità ferma**, come riferimento, e la linea del potere d'acquisto

Mostra classifica, rendimento netto e **reale** (al netto dell'inflazione), tasse e costi pagati, e un grafico del valore netto mese per mese. Funziona interamente nel browser.

## Uso

Il pulsante **Guida** apre `guida.html`, che spiega tasse, bollo, commissioni e i termini usati.

Apri `index.html` (anche con doppio clic) oppure il sito su GitHub Pages.

## Tassi

`aggiorna_tassi.py` (solo libreria standard Python) scrive `tassi.json` e `tassi.js`:

| Dato | Fonte | Aggiornamento |
|---|---|---|
| Rendimenti di BOT, BTP, BTP€i, BTP Italia | simpletoolsforinvestors.eu (prezzi MOT di fine giornata) | automatico |
| Inflazione Italia (IPCA) | Eurostat `prc_hicp_minr` | automatico |
| Tasso BCE sui depositi, rendimento titoli di Stato area euro a 7 anni | BCE Data API | automatico |
| Conti deposito, buoni postali, ipotesi ETF | — | a mano in `tassi.json` (o nella pagina) |

Se una fonte non risponde, lo script mantiene il valore precedente e lo segnala nella pagina. La GitHub Action `.github/workflows/aggiorna-tassi.yml` lo esegue nei giorni feriali e fa commit se i tassi cambiano.

## Regole di calcolo

- Tasse: 12,5% su titoli di Stato e buoni postali; 26% su conti deposito ed ETF azionari; ETF titoli di Stato ~12,5% (modificabile).
- Bollo 0,20% annuo sul valore; buoni postali esenti fino a 5.000 €.
- Commissioni del broker (% con minimo e massimo) su ogni acquisto e vendita; per i BOT all'asta al massimo il tetto di legge.
- Titoli comprati a lotti da 1.000 € di nominale; con «Reinvesti» cedole e interessi si reinvestono nello stesso strumento.
- Tassi costanti per tutta la durata; i titoli che scadono dopo la durata vengono venduti al prezzo stimato con lo stesso rendimento.

Non è consulenza finanziaria.

## Test

```
node test.js
```
