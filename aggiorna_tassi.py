#!/usr/bin/env python3
"""Aggiorna tassi.json con i rendimenti correnti di BOT/BTP e i dati macro.

Fonti automatiche:
  - simpletoolsforinvestors.eu  -> rendimenti a scadenza di BOT, BTP, BTP€i, BTP Italia (MOT)
  - Eurostat (prc_hicp_minr)    -> inflazione Italia (IPCA) annua e media 12 mesi
  - BCE Data API                -> tasso sui depositi BCE, curva titoli di Stato area euro a 7 anni

Le sezioni "manuali" (conti deposito, buoni postali, ipotesi ETF) non sono scaricabili:
lo script le lascia come sono. Se una fonte non risponde, mantiene il valore precedente
e lo segnala in "avvisi".

Solo libreria standard. Uso:  python3 aggiorna_tassi.py
"""
import datetime as dt
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

FILE = Path(__file__).with_name("tassi.json")
UA = "Mozilla/5.0 (compatible; investimenti-benchmark/1.0)"

URL_TITOLI = "https://www.simpletoolsforinvestors.eu/yieldtable.php?datatype=EOD"
URL_INFLAZIONE = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr"
                  "?geo=IT&coicop18=TOTAL&lastTimePeriod=13&format=JSON")
URL_BCE_DFR = "https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?lastNObservations=1&format=csvdata"
URL_BCE_7Y = "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_C.SV_C_YM.SR_7Y?lastNObservations=1&format=csvdata"

# Titoli con cedole variabili/step-up o premi: il simulatore assume cedola fissa, quindi li escludiamo.
ESCLUDI = re.compile(r"STEP|FUTURA|VALORE|PIU'|ONE COUPON|CCT|USD|GBP", re.I)


def scarica(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


def num(s: str):
    s = s.strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def tipo_titolo(nome: str):
    n = nome.upper()
    if n.startswith("BOT "):
        return "BOT"
    if n.startswith("BTP ITALIA"):
        return "BTPItalia"
    if n.startswith("BTPI "):
        return "BTPi"
    if n.startswith("BTP "):
        return "BTP"
    return None


def leggi_titoli():
    s = scarica(URL_TITOLI)
    righe = re.findall(r"<tr>(.*?)(?=<tr>|</tbody>)", s, re.S)
    titoli = []
    for r in righe:
        c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip()
             for x in re.findall(r"<td[^>]*>(.*?)(?=<td|</tr>|$)", r, re.S)]
        if len(c) < 18 or c[2] != "EUR" or c[7] != "MOT":
            continue
        tipo = tipo_titolo(c[1])
        if not tipo or ESCLUDI.search(c[1]):
            continue
        ytm, ytm_netto, prezzo, cedola = num(c[11]), num(c[12]), num(c[8]), num(c[4])
        if ytm is None or prezzo is None or cedola is None:
            continue
        data = c[17]
        try:
            data = dt.datetime.strptime(data, "%d/%m/%Y").date().isoformat()
        except ValueError:
            pass
        titoli.append({
            "isin": c[0],
            "nome": re.sub(r"\s+", " ", c[1].replace("(senza indicizzazione)", "")).strip(),
            "tipo": tipo,
            "scadenza": c[3],
            "cedola": cedola,
            "prezzo": prezzo,
            "ytm_lordo": ytm,
            "ytm_netto": ytm_netto,
            "lotto": int(num(c[5]) or 1000),
            "volume_mln": num(c[9]),
            "data_prezzo": data,
        })
    oggi = dt.date.today().isoformat()
    titoli = [t for t in titoli if t["scadenza"] > oggi]
    titoli.sort(key=lambda t: (t["tipo"], t["scadenza"]))
    if len([t for t in titoli if t["tipo"] == "BTP"]) < 20:
        raise RuntimeError(f"troppo pochi BTP letti ({len(titoli)} titoli): pagina cambiata?")
    return titoli


def leggi_inflazione():
    d = json.loads(scarica(URL_INFLAZIONE))
    dims = d["id"]
    size = d["size"]
    unit_idx = d["dimension"]["unit"]["category"]["index"]
    time_idx = d["dimension"]["time"]["category"]["index"]
    n_time = size[dims.index("time")]
    # tutte le altre dimensioni hanno un solo valore, tranne unit e time
    def val(unit, t):
        v = d["value"].get(str(unit_idx[unit] * n_time + time_idx[t]))
        return v
    mesi = sorted(time_idx, reverse=True)
    ultimo = next(m for m in mesi if val("RCH_A", m) is not None)
    annue = [val("RCH_A", m) for m in sorted(time_idx)[-12:]]
    annue = [a for a in annue if a is not None]
    return {
        "annua_ultima": val("RCH_A", ultimo),
        "mese": ultimo,
        "media_12m": round(sum(annue) / len(annue), 2),
        "indice": "IPCA (HICP) Italia",
    }


def leggi_csv_ultimo(url: str):
    riga = scarica(url).strip().splitlines()[-1]
    campi = next(__import__("csv").reader([riga]))
    # in csvdata il periodo e il valore seguono le colonne delle dimensioni
    for i, c in enumerate(campi):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", c):
            return c, round(float(campi[i + 1]), 3)
    raise RuntimeError("formato BCE inatteso")


def main():
    vecchio = {}
    if FILE.exists():
        vecchio = json.loads(FILE.read_text(encoding="utf-8"))
    nuovo = dict(vecchio)
    avvisi = []
    oggi = dt.date.today().isoformat()

    passi = [
        ("titoli", leggi_titoli, "simpletoolsforinvestors.eu (prezzi MOT di fine giornata)"),
        ("inflazione", leggi_inflazione, "Eurostat prc_hicp_minr"),
    ]
    for chiave, fn, fonte in passi:
        try:
            nuovo[chiave] = fn()
            nuovo.setdefault("fonti", {})[chiave] = {"fonte": fonte, "aggiornato": oggi}
            n = len(nuovo[chiave]) if isinstance(nuovo[chiave], list) else ""
            print(f"ok  {chiave} {n}")
        except Exception as e:  # noqa: BLE001
            avvisi.append(f"{chiave}: {e} (mantenuto il valore precedente)")
            print(f"ERR {chiave}: {e}", file=sys.stderr)

    for chiave, url, fonte in [("bce_deposito", URL_BCE_DFR, "BCE - tasso sui depositi"),
                               ("gov_euro_7a", URL_BCE_7Y, "BCE - curva titoli di Stato area euro, 7 anni")]:
        try:
            data, v = leggi_csv_ultimo(url)
            nuovo[chiave] = v
            nuovo.setdefault("fonti", {})[chiave] = {"fonte": fonte, "aggiornato": data}
            print(f"ok  {chiave} {v}")
        except Exception as e:  # noqa: BLE001
            avvisi.append(f"{chiave}: {e} (mantenuto il valore precedente)")
            print(f"ERR {chiave}: {e}", file=sys.stderr)

    nuovo["aggiornato"] = oggi
    nuovo["avvisi"] = avvisi
    testo = json.dumps(nuovo, ensure_ascii=False, indent=1)
    FILE.write_text(testo + "\n", encoding="utf-8")
    # copia caricabile con <script>, così index.html funziona anche aperto con doppio clic (file://)
    FILE.with_suffix(".js").write_text("window.TASSI = " + testo + ";\n", encoding="utf-8")
    print(f"scritti tassi.json e tassi.js, {len(avvisi)} avvisi")
    return 0 if not avvisi or "titoli" in nuovo else 1


if __name__ == "__main__":
    sys.exit(main())
