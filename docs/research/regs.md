# Scadenze e regole italiane per i promemoria di AutoGarage

> Ricerca verificata su fonti ufficiali. Data di riferimento: 2026-10-07.
> Stato del file: completo (tutte le sezioni 0-12 scritte). I vettori di test delle funzioni TypeScript sono stati eseguiti con uno script Node (tutti passati). Limite di ricerca (35 chiamate Web) raggiunto: vedi sez. 12 per i punti da verificare.
> Legenda confidenza: alta = confermata da fonte primaria/ufficiale letta in questa sessione; media = fonte secondaria autorevole o conoscenza consolidata non riletta; bassa = da verificare.
> VERIFICA SCETTICA INDIPENDENTE (2026-10-07): il file e' stato ricontrollato da un secondo agente (25 chiamate web nuove + lettura di copie locali di Normattiva/Brocardi/AdE). Marcatori usati nel testo: [CONFERMATO], [CORRETTO dalla verifica], [SMENTITO], [DA VERIFICARE]. L'elenco riassuntivo e' in fondo al file, sezione "## Esito verifica". Dove un marcatore contraddice una frase vicina, vale il marcatore.
> Avvertenza generale (da mostrare in app): le scadenze sono calcolate in base ai dati inseriti dall'utente e hanno valore puramente informativo. Non sostituiscono le comunicazioni ufficiali ne' i controlli sul Portale dell'Automobilista, ACI, Agenzia delle Entrate, IVASS o la Regione di residenza.

## Indice

0. Convenzioni di calcolo (date, fusi, mesi)
1. Revisione periodica
2. Bollo auto
3. Assicurazione RC auto
4. Pneumatici invernali, catene, battistrada, DOT
5. Bombole GPL e metano
6. Patente di guida
7. Passaggio di proprieta'
8. Bollino blu, limitazioni ambientali, ZTL
9. Manutenzione (indicativa, NON obbligo di legge) e regola UE sulla garanzia
10. Novita' recenti del Codice della Strada
11. Template di manutenzione proposto
12. Riepilogo gap e punti a confidenza bassa

## 0. Convenzioni di calcolo

Valide per tutte le funzioni di questo documento.

- Le date sono "date di calendario" (stringa `YYYY-MM-DD`, fuso Europe/Rome). NON usare `Date` locale/UTC per sommare mesi o giorni: evita errori di fuso e di ora legale. Salvare nel DB come `TEXT 'YYYY-MM-DD'`.
- "Scadenza entro il mese" = ultimo giorno del mese (inclusivo). Una scadenza e' "superata" dal giorno successivo.
- Somma di mesi con aritmetica su (anno, mese); il giorno viene clampato all'ultimo giorno del mese di arrivo solo dove serve (es. 31 gennaio + 1 mese = 28/29 febbraio).
- Ogni funzione restituisce anche `basis` (da cosa e' stata calcolata) e `confidence` ('official' | 'practice' | 'indicative'), cosi' la UI puo' mostrare l'avvertenza giusta e permettere l'override manuale dell'utente (una scadenza letta sul documento ufficiale vince sempre sul calcolo).
- Importi delle sanzioni: sono quelli vigenti al 2026-10-07 e vanno tenuti in un file di configurazione versionato (non nel codice), perche' cambiano per legge (vedi sez. 10: l'adeguamento biennale ISTAT e' sospeso fino a tutto il 2026).

Helper TypeScript condivisi (pseudocodice eseguibile):

```ts
type ISODate = string; // 'YYYY-MM-DD'

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: ISODate) => ({ y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) });
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

function addMonthsYM(y: number, m: number, n: number) {
  const t = y * 12 + (m - 1) + n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}
function endOfMonth(y: number, m: number): ISODate {
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}
// somma mesi a una data, giorno clampato (31/01 + 1 mese = 28/02 o 29/02)
function addMonths(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = ymd(d);
  const t = addMonthsYM(y, m, n);
  return `${t.y}-${pad(t.m)}-${pad(Math.min(day, daysInMonth(t.y, t.m)))}`;
}
// differenza in giorni di calendario (UTC puro: nessun problema di DST)
function diffDays(a: ISODate, b: ISODate): number {
  const A = ymd(a), B = ymd(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86_400_000);
}
function addDays(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = ymd(d);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
```

Confidenza: alta (scelte di implementazione, non norme).

## 1. Revisione periodica

### 1.1 Regola (art. 80 Codice della Strada, D.Lgs. 285/1992)

| Punto | Regola | Confidenza | Fonte |
|---|---|---|---|
| Prima revisione | 4 anni dalla prima immatricolazione. [CORRETTO dalla verifica] Il testo di legge (art. 80 c.3, Normattiva) dice solo "entro quattro anni dalla data di prima immatricolazione e successivamente ogni due anni, nel rispetto delle specifiche decorrenze previste dalle direttive comunitarie": la formula "entro il mese" NON e' nella legge ma nella comunicazione MIT, che per la prima revisione scrive "entro il mese di rilascio della carta di circolazione" (in pratica il mese di immatricolazione); il Portale dell'Automobilista scrive soltanto "4 anni dopo la prima immatricolazione" | alta sui 4 anni; media sulla regola "fine mese" (prassi MIT, non testo di legge) | https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285 (art. 80 c.3, letto da copia locale); https://www.mit.gov.it/node/2789 ; https://www.ilportaledellautomobilista.it/web/portale-automobilista/veicoli/revisioni |
| Revisioni successive | ogni 2 anni "entro il mese corrispondente a quello in cui e' stata effettuata l'ultima revisione" [CONFERMATO: frase identica sulla pagina MIT; il riferimento e' il mese della revisione EFFETTIVAMENTE eseguita] | alta (testo MIT), media (come regola di legge: non e' nell'art. 80) | https://www.mit.gov.it/node/2789 |
| Veicoli coperti | autovetture, autoveicoli promiscui/uso speciale/merci fino a 3.500 kg, autocaravan M1, motoveicoli e ciclomotori [CORRETTO dalla verifica: il Portale scrive "Dal 2003 tali scadenze si applicano anche per motoveicoli e ciclomotori": il "dal 2003" vale per entrambi, non solo per i ciclomotori], rimorchi <= 3.500 kg | alta | https://www.ilportaledellautomobilista.it/web/portale-automobilista/veicoli/revisioni |
| Revisione ANNUALE (fuori target app) | taxi, NCC/autonoleggio con conducente, ambulanze, autobus e veicoli con piu' di 9 posti, veicoli merci oltre 3.500 kg | alta | https://aci.gov.it/codice-della-strada/art-80/ ; https://www.mit.gov.it/node/2789 |
| Termine ultimo | l'ultimo giorno del mese di scadenza; nessuna tolleranza oltre il mese | alta | https://www.lautomobile.aci.it/come-fare-per/revisione-auto-2024-2025-costi-scadenze-e-novita/ |
| Dove si fa | Motorizzazione civile (tariffa 45,00 EUR) o officina/centro privato autorizzato (circa 79 EUR IVA inclusa, tariffa nazionale; ritocchi possibili) | media (tariffe soggette a aggiornamento) | https://www.mit.gov.it/node/2789 ; https://www.lautomobile.aci.it/come-fare-per/revisione-auto-2024-2025-costi-scadenze-e-novita/ |
| Verifica ufficiale | servizio "Verifica revisioni effettuate" sul Portale dell'Automobilista (serve la targa) | alta | https://www.ilportaledellautomobilista.it/web/portale-automobilista/veicoli/revisioni |

### 1.2 Casi limite (e decisione di implementazione)

1. **Revisione fatta in anticipo / in ritardo.** La norma dice "mese corrispondente a quello dell'ultima revisione". La prassi (Motorizzazione) assume come riferimento la data/mese in cui la revisione e' stata effettivamente eseguita, riportata sul tagliando/ricevuta e nella banca dati. Decisione: `prossima = fine mese (data ultima revisione + 24 mesi)`. [CONFERMATO in parte dalla verifica: la pagina MIT dice "entro il mese corrispondente a quello in cui e' stata effettuata l'ultima revisione", quindi anche per una revisione anticipata il riferimento e' il mese della revisione eseguita (la fonte secondaria automobilista.it concorda: "nessun bonus per anticipi"); per una revisione eseguita IN RITARDO (oltre il mese di scadenza) non c'e' una fonte che dica diversamente, ma resta [DA VERIFICARE] su una circolare MIT.] Confidenza: MEDIA (la regola esatta per revisioni molto anticipate o tardive non e' stata trovata in una fonte primaria; fonti secondarie come https://www.automobilista.it/posso-fare-la-revisione-dellauto-prima-della-scadenza/ la descrivono in modo non uniforme). Mitigazione in app: permettere di inserire "scadenza letta sul portale/libretto" che sovrascrive il calcolo e invitare a verificare sul Portale dell'Automobilista.
2. **Prima immatricolazione vs immatricolazione in Italia (auto importate usate).** Si usa la "data di prima immatricolazione" della carta di circolazione. Per veicoli gia' immatricolati all'estero la questione (4 anni dalla prima immatricolazione estera o italiana) non e' stata verificata su fonte primaria: confidenza BASSA. L'app deve esporre il campo "data prima immatricolazione" modificabile e un avviso per le auto importate.
3. **Anno bisestile e fine mese.** Si ragiona su (anno, mese): la scadenza e' sempre l'ultimo giorno del mese (29/02 negli anni bisestili).
4. **Revisione dopo incidente (art. 80 c.7).** Se l'incidente causa gravi danni che fanno dubitare della sicurezza, la polizia stradale informa la Motorizzazione che dispone una "revisione singola". Non e' una scadenza calcolabile: l'app deve offrire solo un promemoria manuale "Revisione singola disposta dalla Motorizzazione" con la data indicata nella comunicazione. Fonte: testo del comma riportato in https://www.automobilista.it/quando-la-revisione-auto-puo-essere-disposta-dopo-un-incidente/ e https://aci.gov.it/codice-della-strada/art-80/ . Confidenza: alta sulla norma, nulla sul calcolo (non c'e' formula).
5. **Esiti della revisione.** `regolare` (nuova scadenza); `ripetere` [CORRETTO dalla verifica: MIT e Portale dell'Automobilista dicono riparazioni e "nuova revisione entro un mese" (un mese di calendario, non "30 giorni"); confidenza ALTA]; `sospeso` (serve una nuova richiesta di revisione per poter circolare; il veicolo puo' circolare solo "in giornata, per andare dal meccanico a una velocita' non superiore di 40 km/h" secondo il Portale: dettaglio dei 40 km/h omesso dal ricercatore; art. 80 c.14: l'organo accertatore annota la sospensione sul documento di circolazione; confidenza ALTA). Fonte per "sospeso": https://www.ilportaledellautomobilista.it/web/portale-automobilista/veicoli/revisioni . In app: stato manuale `esito` con promemoria "da ripetere".
6. **Veicoli storici/ultra-trentennali:** soggetti alla stessa revisione biennale (non esenzione generale). [DA VERIFICARE: ne' il Portale dell'Automobilista ne' il testo dell'art. 80 c.3-4 letto su Normattiva trattano i veicoli storici; l'affermazione resta non supportata.] Confidenza BASSA: non verificato in questa sessione. L'unica certezza e' che l'esenzione dal bollo (sez. 2) non coincide con l'esenzione dalla revisione.
7. **Controlli OBD alla revisione (novita' 2024).** Per M1/M2/N1 <= 3,5 t immatricolati dal 1/9/2009 il centro verifica via OBD (numero telaio nella centralina, chilometraggio, anomalie, spia motore); con spia motore accesa l'auto non supera la prova. Fonte: https://www.lautomobile.aci.it/come-fare-per/revisione-auto-2024-2025-costi-scadenze-e-novita/ (aggiornamento software dei centri 31/1/2024, scan tool obbligatorio dal 24/2/2024). Confidenza: media. **Rilevanza per AutoGarage**: l'app puo' suggerire "prima di prenotare la revisione, leggi i DTC/spia motore" (sinergia con il modulo OBD).

### 1.3 Sanzioni (art. 80 c.14 e seguenti)

| Violazione | Sanzione | Confidenza | Fonte |
|---|---|---|---|
| Circolare senza aver fatto la revisione nei termini | da 173 a 694 EUR, raddoppiabile in caso di revisione omessa piu' di una volta; il veicolo e' annotato come "sospeso dalla circolazione" fino a revisione, con circolazione consentita solo per recarsi alla revisione [CONFERMATO dalla verifica sul testo vigente Normattiva, art. 80 c.14, con le note di aggiornamento ISTAT] | alta (struttura e importi) | https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285 ; https://aci.gov.it/codice-della-strada/art-80/ ; https://www.lautomobile.aci.it/come-fare-per/revisione-auto-2024-2025-costi-scadenze-e-novita/ |
| Circolare con veicolo sospeso (in attesa di revisione) | da 1.998 a 7.993 EUR e fermo amministrativo di 90 giorni; in caso di reiterazione confisca amministrativa del veicolo (omessa dal ricercatore) [CONFERMATO: art. 80 c.14 Normattiva] | alta | https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285 ; https://aci.gov.it/codice-della-strada/art-80/ |
| Attestazione di revisione falsa prodotta agli organi competenti | da 430 a 1.731 EUR e ritiro della carta di circolazione [CONFERMATO: art. 80 c.17 Normattiva; la stessa fascia 430-1.731 vale al c.15 per le imprese di revisione che non rispettano termini/modalita', con revoca della concessione dopo 3 violazioni in 2 anni] | alta | https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285 |

Nota importi: alcuni siti secondari riportano 183-735 EUR come "nuovo CdS". La ricerca sull'adeguamento ISTAT indica che gli importi sono congelati (sospensione 2025 e 2026, DL 200/2025 conv. L. 26/2026): https://ildiritto.it/amministrativo/sanzioni-stradali-stop-aggiornamento-biennale/ ; https://www.motorionline.com/multe-auto-non-ci-saranno-aumenti-in-arrivo-per-il-2026/ . Quindi 173-694 EUR (testo ACI) e' il valore piu' coerente, ma conviene mostrare nell'app "da circa 173 a 694 EUR" e rimandare alla fonte. [CONFERMATO dalla verifica: il testo vigente su Normattiva (art. 80 c.14, annotato con gli adeguamenti ISTAT) riporta 173-694 EUR; le cifre 183-735 EUR dei siti secondari non risultano nel testo.] Confidenza: alta.

### 1.4 Novita' 2024-2026

- Controlli OBD in revisione (sopra). Confidenza media.
- UE: proposta della Commissione (pacchetto "roadworthiness") di rendere ANNUALE la revisione per auto e furgoni con piu' di 10 anni. La commissione Trasporti del Parlamento UE ha votato contro (mantenere biennale nei primi 10 anni), il Consiglio UE ha respinto la revisione annuale; il pacchetto non e' definitivo (parte sui documenti di registrazione digitali approvata dal Parlamento ad aprile 2026). Fonti: https://www.alvolante.it/news/no-del-consiglio-ue-alla-revisione-annuale-delle-auto-409751 ; https://it.motor1.com/news/795298/revisione-auto-nuove-regole-unione-europea-2026/ . **Implicazione**: oggi in Italia vale 4+2+2...; l'app deve tenere l'intervallo (24 mesi) in configurazione, non hardcoded. Confidenza: media (fonti giornalistiche, non il testo UE).
- Nessuna modifica all'art. 80 sul calendario 4+2 trovata da L. 177/2024 (le modifiche principali di quella legge riguardano altri articoli; vedi sez. 10). [CONFERMATO dalla verifica: il testo vigente di art. 80 c.3 su Normattiva prevede ancora "entro quattro anni dalla data di prima immatricolazione e successivamente ogni due anni"; c.4 conferma la revisione ANNUALE per >9 posti, merci/rimorchi >3,5 t, taxi, autoambulanze, NCC e veicoli atipici.] Confidenza: alta.

### 1.5 Funzione di calcolo

```ts
interface RevisioneInput {
  firstRegistration: ISODate;      // data prima immatricolazione (carta di circolazione)
  lastRevision?: ISODate;          // data ULTIMA revisione effettivamente eseguita (esito regolare)
  manualDueBy?: ISODate;           // eventuale scadenza letta sul portale: vince sempre
}
interface RevisioneResult {
  dueBy: ISODate;                  // ultimo giorno utile (inclusivo)
  basis: 'manual' | 'first' | 'last';
  confidence: 'official' | 'practice';
}

const REVISIONE_FIRST_MONTHS = 48;   // art. 80 c.4: configurabile
const REVISIONE_NEXT_MONTHS  = 24;

function nextRevisione(i: RevisioneInput): RevisioneResult {
  if (i.manualDueBy) return { dueBy: i.manualDueBy, basis: 'manual', confidence: 'official' };
  if (!i.lastRevision) {
    const { y, m } = ymd(i.firstRegistration);
    const t = addMonthsYM(y, m, REVISIONE_FIRST_MONTHS);
    return { dueBy: endOfMonth(t.y, t.m), basis: 'first', confidence: 'official' };
  }
  const { y, m } = ymd(i.lastRevision);
  const t = addMonthsYM(y, m, REVISIONE_NEXT_MONTHS);
  return { dueBy: endOfMonth(t.y, t.m), basis: 'last', confidence: 'practice' };
}

function revisioneStatus(today: ISODate, dueBy: ISODate) {
  const left = diffDays(today, dueBy);          // >=0 valida (0 = scade oggi)
  return left >= 0
    ? { state: left === 0 ? 'scade_oggi' : 'valida', daysLeft: left }
    : { state: 'scaduta', daysOverdue: -left };
}

// promemoria suggeriti: 60 gg prima, primo giorno del mese di scadenza, 7 gg prima, giorno stesso
function revisioneReminders(dueBy: ISODate): ISODate[] {
  const { y, m } = ymd(dueBy);
  return [addDays(dueBy, -60), `${y}-${pad(m)}-01`, addDays(dueBy, -7), dueBy];
}
```

### 1.6 Vettori di test

| # | Input | Output atteso |
|---|---|---|
| R1 | firstRegistration 2022-03-15, nessuna revisione | dueBy 2026-03-31, basis first |
| R2 | firstRegistration 2022-03-15, lastRevision 2026-03-10 | dueBy 2028-03-31, basis last |
| R3 | firstRegistration 2020-02-29 (bisestile), nessuna revisione | dueBy 2024-02-29 |
| R4 | firstRegistration 2022-06-10, lastRevision 2026-02-12 (anticipata) | dueBy 2028-02-29 (2028 e' bisestile) |
| R5 | lastRevision 2025-12-31 | dueBy 2027-12-31 |
| R6 | lastRevision 2026-01-31 | dueBy 2028-01-31 (conta il mese, non il giorno) |
| R7 | today 2026-03-31, dueBy 2026-03-31 | state scade_oggi, daysLeft 0 |
| R8 | today 2026-04-01, dueBy 2026-03-31 | state scaduta, daysOverdue 1 |
| R9 | manualDueBy 2027-05-31, qualunque altro input | dueBy 2027-05-31, basis manual |

### 1.7 Testo di avvertenza (UI)

"La scadenza e' calcolata dalla data di prima immatricolazione o dall'ultima revisione che hai inserito (art. 80 Codice della Strada: prima revisione dopo 4 anni, poi ogni 2 anni, entro l'ultimo giorno del mese). E' un promemoria: controlla sempre la data effettiva sul Portale dell'Automobilista (servizio 'Verifica revisioni effettuate'). Circolare con la revisione scaduta comporta una sanzione da circa 173 a 694 euro e il divieto di circolazione fino alla revisione. Se dopo un incidente la Motorizzazione dispone una revisione singola, segui la data indicata nella sua comunicazione."

## 2. Bollo auto (tassa automobilistica)

ATTENZIONE: il quadro normativo e' in movimento. Nel 2026 sono usciti due provvedimenti rilevanti (vedi 2.1) che l'app deve modellare come "regole con data di decorrenza", non come costanti.

### 2.1 Novita' 2026 (verificate su fonti ACI e fonti fiscali secondarie; NON ho letto la Gazzetta Ufficiale)

| Provvedimento | Contenuto | Stato al 2026-10-07 | Confidenza | Fonti |
|---|---|---|---|---|
| D.Lgs. 7 agosto 2026, n. 147 (GU 11/08/2026, in vigore dal 12/08/2026) - riordino tributi regionali e locali | Dal 1/1/2028: periodo di tassa fisso di 12 mesi dal mese di immatricolazione; primo pagamento entro l'ultimo giorno del mese SUCCESSIVO all'immatricolazione; rinnovi entro l'ultimo giorno del mese di immatricolazione. Dal 12/8/2026: la cessione a un rivenditore libera il venditore solo dopo la trascrizione al PRA (entro 60 giorni); il bollo e' dovuto anche con fermo amministrativo. Dal 1/1/2027: noleggio a lungo termine -> soggetto passivo l'utilizzatore; avvisi di accertamento diventano titolo esecutivo; esenzioni regionali non si estendono al superbollo statale; banca dati ANTA. Ravvedimento, sanzioni, rateizzazione NON modificati. [CONFERMATO dalla verifica: GU n. 185 dell'11/8/2026 (S.O. n. 30), in vigore dal 12/8/2026; dal 1/1/2028 periodo di 12 mesi, primo pagamento entro l'ultimo giorno del mese successivo all'immatricolazione, rinnovi entro l'ultimo giorno del mese di immatricolazione; i veicoli immatricolati entro il 31/12/2027 mantengono le scadenze precedenti (ACI "Bollo auto: tutte le novita' dal 2026 al 2028"). [DA VERIFICARE]: fiscoetasse.com riporta per il 2028 una "rateizzazione facoltativa, anche in quattro rate su base regionale": contraddice "rateizzazione NON modificata". Omesso dal ricercatore: chi esce da un'esenzione/sospensione dopo il 2027 paga dal mese della cessazione (ACI).] Veicoli immatricolati entro il 31/12/2027 mantengono le scadenze precedenti. | in vigore (con decorrenze differite) | media | https://www.lautomobile.aci.it/attualita/bollo-auto-tutte-le-novita-dal-2026-al-2028/ ; https://www.informazionefiscale.it/bollo-auto-novita-scadenze-obblighi-controlli |
| D.L. 17 settembre 2026, n. 162 ("decreto carburanti", GU n. 216 del 17/09/2026; CdM 16/09/2026) | Esenzione dal bollo per i versamenti con scadenza ordinaria dal 1/1 al 31/12/2027: persone fisiche, autovetture a benzina o gasolio (anche in combinazione con altra propulsione, quindi ibride) con potenza <= 80 kW; se piu' vetture idonee, esente UNA sola (quella con minore potenza kW; a parita' quella con tassa meno elevata). Secondo ACI e stampa riguarda anche tutti i motocicli. [CORRETTO dalla verifica, requisito omesso: il veicolo deve essere "regolarmente assicurato" (ACI "Addio al bollo auto" e testo del decreto citato da certifico.com/finanzaefisco.com); la norma e' l'art. 2 del D.L. 162/2026 e parla di "autovetture, motocicli e ciclomotori" con un solo veicolo esentato per persona fisica; nelle Regioni a statuto speciale e Province autonome si applica solo previo accordo con ciascuna. CONFERMATI: D.L. 17/9/2026 n. 162, GU Serie generale n. 216 del 17/9/2026; esenzione solo per i versamenti con scadenza ordinaria dall'1/1 al 31/12/2027. Termine di conversione: 17/9 + 60 giorni = 16/11/2026.] Compensazione alle Regioni 2.293,5 milioni di EUR. Nessun effetto sul 2026. | decreto-legge pubblicato: va convertito entro 60 giorni (entro il 16/11/2026): possibili modifiche. Misura per ora valida solo per il 2027 (fonti parlano di possibile misura strutturale con la prossima manovra: NON confermato) | media (dettagli su moto e superbollo non verificati) | https://www.lautomobile.aci.it/attualita/addio-al-bollo-auto/ ; https://www.mysolution.it/fisco/informazioni/news/2026/09/17/bollo-auto-dal-2027-esenzione-per-i-veicoli-fino-a-80-kw/ ; https://www.money.it/abolizione-bollo-auto-2027-dalle-regole-all-elenco-dei-veicoli-tutto-quello-che-c-e-da-sapere |

Implicazioni per l'app: (a) campo veicolo `powerKw` + alimentazione + "intestatario persona fisica" + "assicurazione in regola" (requisito del D.L. 162/2026, vedi [CORRETTO] sopra); (b) per le scadenze 2027 mostrare un'etichetta "Possibile esenzione 2027 (DL 162/2026): verifica requisiti" invece di cancellare il promemoria; (c) tenere le regole in una tabella `rules` con `validFrom/validTo` e `source`.

### 2.2 Regola di scadenza oggi in vigore (fino al 31/12/2027)

| Caso | Regola | Confidenza | Fonte |
|---|---|---|---|
| Primo pagamento (nuova immatricolazione) | entro il mese di immatricolazione; se l'immatricolazione cade negli ultimi 10 giorni del mese, entro il mese successivo (la tassa decorre comunque dal mese di immatricolazione). Eccezioni regionali: Lombardia e Piemonte (per i veicoli interessati dalla disciplina in vigore dal 2004), entro l'ultimo giorno del mese successivo; [CORRETTO dalla verifica, omissione] anche Province autonome di Bolzano e Trento: primo pagamento entro il mese successivo qualunque sia il giorno di immatricolazione. Lo stesso criterio vale per il primo versamento dopo l'uscita da un'esenzione/sospensione e dopo il rientro in possesso del veicolo (ACI, 28/08/2026) | alta (struttura, riletta su ACI 28/08/2026), media (elenco eccezioni regionali) | https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/ |
| Rinnovi | ogni anno nel mese anniversario di immatricolazione (ultimo giorno del mese); periodo di tassa annuale di 12 mesi. [CORRETTO dalla verifica, DISTINZIONE DECISIVA] La regola generale ACI (articolo del 28/08/2026 "Bollo auto: dove, come e quando si paga") e': "il rinnovo si paga entro l'ultimo giorno del mese SUCCESSIVO a quello di scadenza del bollo precedente" (es.: la tassa scade ad aprile, si paga entro fine maggio). La "scadenza" del bollo e' la fine del periodo coperto; il "termine di versamento" e' la fine del mese dopo. Per un'auto immatricolata a marzo il periodo coperto va da marzo a febbraio, il bollo "scade" a febbraio e si rinnova entro il 31 marzo: coincide con la regola "mese anniversario", ma l'app NON deve confondere "mese di fine validita'" con "mese di pagamento". Il calcolo ACI del rinnovo e' disponibile dal primo giorno del mese successivo alla scadenza | alta sulla regola generale; media su Lombardia/Piemonte (rinnovi "seguono il mese di immatricolazione", cioe' stessa data) | https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/ ; https://www.informazionefiscale.it/bollo-auto-novita-scadenze-obblighi-controlli |
| Regioni con pagamenti quadrimestrali | restano possibili per alcune categorie (Regioni possono autorizzarli) | media | https://www.informazionefiscale.it/bollo-auto-novita-scadenze-obblighi-controlli |
| Dal 1/1/2028 | primo pagamento: ultimo giorno del mese successivo all'immatricolazione; rinnovi: ultimo giorno del mese di immatricolazione; i veicoli immatricolati entro il 31/12/2027 restano con le regole precedenti | media | https://www.lautomobile.aci.it/attualita/bollo-auto-tutte-le-novita-dal-2026-al-2028/ |
| Termine che cade di sabato/domenica/festivo | per i versamenti tributari lo slittamento al primo giorno lavorativo successivo e' la regola generale (D.L. 70/2011, art. 7); [CORRETTO dalla verifica: fonti secondarie (investireoggi, fiscoetasse) confermano che per il bollo, se l'ultimo giorno utile cade di sabato o festivo, si puo' pagare senza sanzioni il primo giorno lavorativo successivo; nessuna fonte primaria letta] | media | https://www.investireoggi.it/scadenza-bollo-auto-i-30-giorni-in-piu-non-valgono-per-tutti/ ; https://www.fiscoetasse.com/rassegna-stampa/17573-bollo-auto-in-scadenza-oggi.html |

Il "mese di scadenza" reale di una targa dipende dal periodo di tassa effettivo (puo' differire dal mese di immatricolazione per veicoli passati di mano, riattivati dopo esportazione/radiazione, ecc.). [CORRETTO dalla verifica: nel campo di override l'utente va guidato a inserire il "MESE DI PAGAMENTO" (ultimo mese utile per versare), non il "mese di scadenza/fine validita'" mostrato dai servizi ACI, che e' il mese PRECEDENTE per un periodo di 12 mesi: confonderli sposta la scadenza di un mese.] L'app deve quindi consentire di inserire/sovrascrivere il "mese di pagamento" letto sul calcolo bollo ACI (https://online.aci.it/acinet/calcolobollo/index.asp).

### 2.3 Ravvedimento operoso, interessi, prescrizione

| Punto | Regola | Confidenza | Fonte |
|---|---|---|---|
| Ravvedimento (violazioni dal 1/9/2024) | entro 15 gg: bollo + 0,08% per ogni giorno di ritardo [CORRETTO dalla verifica: il valore esatto e' 1/10 di (12,5%/15) = 0,0833...% al giorno, cioe' giorni/12 in percentuale (AdE: "dopo soli due giorni la sanzione e' 0,17% (1/10 del 1,66%)"; 15 giorni = 1,25%, coerente con la fascia successiva; 0,08% e' un arrotondamento ACI che crea una discontinuita']; 16-30 gg: +1,25% [CONFERMATO AdE: 1/10 di 12,5%]; 31-90 gg: +1,39% [CONFERMATO: 1/9 di 12,5%]; 91 gg-1 anno: +3,13% [CONFERMATO: 1/8 di 25% = 3,125%]; oltre 1 anno: +3,75% [CORRETTO dalla verifica: la tabella AdE per le violazioni dal 1/9/2024 prevede 1/7 del minimo oltre un anno e fino alla comunicazione dello schema di atto, cioe' 1/7 di 25% = 3,57%; 3,75% e' il valore della vecchia disciplina (1/8 di 30%); resta [DA VERIFICARE] se Regioni/ACI applicano regole proprie]; piu' interessi legali (1,60% annuo dal 1/1/2026) [CONFERMATO AdE: formula imposta x tasso x giorni / 36500; tassi: 2% nel 2025, 1,6% dal 1/1/2026] calcolati pro rata temporis. Possibile anche oltre l'anno finche' non siano iniziati accertamenti (L. 157/2019). Le Regioni possono avere regole proprie (es. Trento estende fino alla notifica dell'accertamento) | media | https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/ |
| Prescrizione | 3 anni; il termine decorre dall'inizio dell'anno successivo a quello in cui il pagamento andava eseguito (cioe' scade il 31 dicembre del terzo anno successivo); si interrompe con notifica dell'avviso di accertamento [NON VERIFICATO nella verifica scettica: l'articolo ACI del 2026 e la scheda Agenzia delle Entrate letti non trattano la prescrizione; il calcolo B12 e' coerente con la regola dichiarata ma resta senza fonte primaria] | media-alta (sintesi di fonti ACI; testo di legge: art. 5 D.L. 953/1982, non riletto) | https://rivistagiuridica.aci.it/documento/termini-di-prescrizione-della-tassa-automobilistica.html (titolo noto, pagina non aperta) ; sintesi ACI nei risultati di ricerca |
| Dal 2027 | gli avvisi di accertamento diventano titolo esecutivo (riscossione piu' rapida): non contare sulla prescrizione come strategia | media | https://www.informazionefiscale.it/bollo-auto-novita-scadenze-obblighi-controlli |

### 2.4 Esenzioni e riduzioni

| Voce | Regola | Confidenza | Fonte |
|---|---|---|---|
| Auto elettriche (nazionale) | esenzione per 5 anni dalla prima immatricolazione, poi tassa ridotta al 25% (riduzione del 75%) | media | https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/ |
| Differenze regionali EV | Campania e Valle d'Aosta: 8 anni di esenzione; Lombardia e Piemonte: esenzione permanente per i veicoli elettrici (riportata da ACI). Altre Regioni: verificare. Le esenzioni regionali non coprono il superbollo (dal 2027) | media-bassa (le leggi regionali cambiano: verificare sempre la scheda regionale ACI) | stessa fonte; schede regionali: https://aci.gov.it/approfondimento/guida-al-bollo-auto/regioni-e-province-autonome-convenzionate/ |
| Metano/GPL | riduzione 75% (nazionale) per alimentazione esclusiva; doppia alimentazione: tariffa 2006, nessuna sovrattassa oltre 100 kW | media | stessa fonte ACI |
| Superbollo | 20 EUR per ogni kW oltre 185 kW; ridotto del 60% dopo 5 anni, 30% dopo 10, 15% dopo 15, non dovuto dopo 20 anni dalla costruzione | media | stessa fonte ACI |
| Veicoli storici ultratrentennali | esenzione automatica dalla tassa di proprieta'; se circolano su strada: tassa di circolazione forfettaria annua (nella scheda ACI di Trento: 25,82 EUR autoveicoli, 10,33 EUR motoveicoli) | media (importi e dettagli regionali da verificare) | https://www.aci.it/servizi/guide-utili/guida-al-bollo-auto/regioni-e-province-autonome-convenzionate-con-aci/provincia-autonoma-di-trento/veicoli-storici.html |
| Veicoli 20-29 anni con certificato di rilevanza storica (CRS) | agevolazioni subordinate al CRS (ASI, Storico Lancia, Italiano FIAT, Italiano Alfa Romeo, FMI, ACI Storico): esenzione per uso non professionale, riduzione 50% per uso professionale (secondo la scheda di Trento); il requisito va posseduto al primo giorno del periodo di tassa | bassa (da una sola scheda provinciale; verificare nella propria Regione) | stessa scheda ACI Trento |
| Tariffe e differenze regionali | base EUR/kW per classe Euro che varia per Regione (es. Abruzzo/Campania, Emilia-Romagna, Bolzano, Liguria +10% Euro 0-1, sconti per domiciliazione bancaria in Lombardia 15% e Lazio 10%) | media | https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/ |

Raccomandazione: l'app NON deve calcolare l'IMPORTO del bollo (troppe variabili regionali); deve calcolare la SCADENZA e rimandare al calcolo ufficiale ACI per l'importo (campo importo manuale opzionale).

### 2.5 Dove verificare lo stato / pagare

- Calcolo bollo ACI (importo e periodo): https://online.aci.it/acinet/calcolobollo/index.asp
- Pagina servizi ACI bollo: https://www.aci.it/-servizi/servizi-online/bollo-auto.html ; guida: https://aci.gov.it/servizi/bollo-auto/ ; BolloNet: https://aci.gov.it/servizio/bollonet-paga-il-bollo/
- Servizio ACI di promemoria (concorrente/riferimento di funzione): https://www.aci.it/servizi/ricordalascadenza/
- Canali di pagamento: PagoPA, app IO, ACI, tabaccherie/Poste/banche (https://www.pagopa.gov.it/ , https://ioapp.it/)
- Agenzia delle Entrate, scheda bollo auto: https://www.agenziaentrate.gov.it/portale/schede/pagamenti/bollo-auto/scheda-info-bollo-auto-2010
- Lo stato di pagamento per targa si consulta sui siti ACI/Regione competenti (nome esatto del servizio di "verifica pagamenti" non verificato: confidenza bassa).

### 2.6 Funzioni di calcolo

```ts
type Region = 'LOMBARDIA' | 'PIEMONTE' | 'TRENTO' | 'BOLZANO' | 'ALTRA'; // [CORRETTO: aggiunte Trento/Bolzano, primo pagamento nel mese successivo per tutti (ACI 28/08/2026)]

// Primo pagamento (nuova immatricolazione)
function bolloFirstDue(reg: ISODate, region: Region): ISODate {
  const { y, m, d } = ymd(reg);
  if (reg >= '2028-01-01') {                       // D.Lgs. 147/2026, dal 1/1/2028
    const t = addMonthsYM(y, m, 1); return endOfMonth(t.y, t.m);
  }
  const lastTenDays = d > daysInMonth(y, m) - 10;  // ultimi 10 giorni del mese
  if (region === 'LOMBARDIA' || region === 'PIEMONTE' || region === 'TRENTO' || region === 'BOLZANO' || lastTenDays) {
    const t = addMonthsYM(y, m, 1); return endOfMonth(t.y, t.m);
  }
  return endOfMonth(y, m);
}

// Rinnovo annuale: anniversario del mese di immatricolazione (o 'dueMonth' = MESE DI PAGAMENTO inserito dall'utente).
// [CORRETTO dalla verifica] NON passare qui il "mese di scadenza/fine validita'" dei servizi ACI: per ACI il rinnovo si
// paga entro la fine del mese SUCCESSIVO a quello di scadenza del bollo precedente.
function bolloRenewalDue(year: number, reg: ISODate, dueMonthOverride?: number): ISODate {
  const m = dueMonthOverride ?? ymd(reg).m;
  return endOfMonth(year, m);
}

// Slittamento al primo giorno lavorativo (regola generale per i versamenti: bassa-media confidenza sul bollo)
function nextBusinessDay(d: ISODate, isHoliday: (d: ISODate) => boolean): ISODate {
  let x = d;
  while (isWeekend(x) || isHoliday(x)) x = addDays(x, 1);
  return x;
}

// Ravvedimento: percentuale di sanzione (violazioni dal 1/9/2024; tabella ACI, media confidenza)
function ravvedimentoSanctionPct(daysLate: number): number {
  if (daysLate <= 0) return 0;
  if (daysLate <= 15) return daysLate / 12;         // % [CORRETTO: 0,0833...% al giorno = 1/10 di (12,5%/15); 15 gg = 1,25%]
  if (daysLate <= 30) return 1.25;
  if (daysLate <= 90) return 1.39;                  // 1/9 di 12,5% = 1,3889
  if (daysLate <= 365) return 3.125;                // 1/8 di 25%
  return 3.5714;                                    // oltre 1 anno: 1/7 di 25% (AdE) [CORRETTO; ACI riporta 3,75%: DA VERIFICARE]
}
// Interessi: importo * tassoLegale * giorni/365 (tasso annuo da tabella per anno: 2026 = 1,60%; spezzare se a cavallo d'anno)

// Prescrizione ordinaria (3 anni): ultimo giorno = 31/12 del terzo anno successivo a quello di scadenza
function bolloPrescriptionEnd(due: ISODate): ISODate { return `${ymd(due).y + 3}-12-31`; }
const bolloIsPrescribed = (today: ISODate, due: ISODate) => today > bolloPrescriptionEnd(due); // senza atti interruttivi
```

### 2.7 Vettori di test

| # | Input | Output atteso |
|---|---|---|
| B1 | rinnovo anno 2026, immatricolazione 2022-03-15 | 2026-03-31 |
| B2 | primo pagamento, reg 2026-03-05, regione ALTRA | 2026-03-31 |
| B3 | primo pagamento, reg 2026-03-25 (giorno 25 > 31-10=21: ultimi 10 giorni), ALTRA | 2026-04-30 |
| B4 | primo pagamento, reg 2026-03-05, LOMBARDIA | 2026-04-30 |
| B5 | primo pagamento, reg 2028-02-10 (regime 2028) | 2028-03-31 |
| B6 | primo pagamento, reg 2026-02-20 (febbraio 28 gg: 20 > 18), ALTRA | 2026-03-31 |
| B7 | primo pagamento, reg 2026-03-21 (21 > 21 falso) | 2026-03-31 |
| B8 | slittamento: scadenza 2026-05-31 (domenica) | 2026-06-01 [CONFERMATO il calcolo: il 31/5/2026 e' effettivamente una domenica; la regola dello slittamento e' media confidenza, vedi 2.2] |
| B9 | ravvedimento: bollo 200 EUR, pagato dopo 10 gg | [CORRETTO dalla verifica] sanzione 0,8333% = 1,67 EUR (+ interessi); la versione precedente (0,8% = 1,60 EUR) usava l'arrotondamento 0,08%/g |
| B10 | ravvedimento: bollo 200 EUR, dopo 20 gg | 1,25% = 2,50 EUR [CONFERMATO] |
| B11 | ravvedimento: bollo 200 EUR, dopo 400 gg | [CORRETTO dalla verifica, DA VERIFICARE] 3,5714% = 7,14 EUR secondo la tabella AdE (1/7 di 25%); la versione precedente (3,75% = 7,50 EUR) e' il valore ACI/vecchia disciplina |
| B12 | prescrizione: scadenza 2022-03-31 | ultimo giorno 2025-12-31; oggi 2025-12-31 non prescritto, oggi 2026-01-01 prescritto (senza interruzioni) |
| B13 | rinnovo con "mese di pagamento" inserito dall'utente = 5, anno 2027 | 2027-05-31 [CORRETTO dalla verifica: il vettore originale parlava di "mese di scadenza letto da ACI"; se quel mese fosse la FINE VALIDITA' del bollo precedente (terminologia ACI), il termine di versamento sarebbe 2027-06-30 (fine del mese successivo). Rinominare il campo ed evitare l'ambiguita'] |
| B14 | (nuovo) primo pagamento, reg 2026-03-05, TRENTO o BOLZANO | 2026-04-30 (mese successivo per tutti, ACI 28/08/2026) |

### 2.8 Testo di avvertenza (UI)

"Il bollo e' una tassa regionale: la scadenza mostrata e' calcolata dal mese di immatricolazione (o dal mese di scadenza che hai inserito) e puo' differire nella tua Regione. Per importo, periodo e stato dei pagamenti consulta il calcolo ufficiale ACI o il sito della tua Regione. Per il 2027 e' stata introdotta (D.L. 162/2026, in conversione) un'esenzione per le auto a benzina/gasolio fino a 80 kW (e per i motocicli) intestate a persone fisiche, per un solo veicolo per contribuente e solo se il veicolo e' regolarmente assicurato [CORRETTO dalla verifica: requisito dell'assicurazione omesso]: verifica i requisiti prima di non pagare. In caso di ritardo puoi regolarizzare con il ravvedimento operoso pagando una sanzione ridotta piu' gli interessi."

## 3. Assicurazione RC auto

### 3.1 Regole verificate

| Punto | Regola | Confidenza | Fonte |
|---|---|---|---|
| Durata e rinnovo | contratto RC auto di durata annuale [SMENTITO l'inciso "o inferiore a richiesta" + CORRETTO dalla verifica: l'art. 170-bis c.1 dice "annuale o, su richiesta dell'assicurato, di anno piu' frazione", NON "inferiore all'anno"], NON tacitamente rinnovabile (si risolve automaticamente alla scadenza naturale, in deroga all'art. 1899 c.c.; abolizione dal 1/1/2013 non riverificata); [CORRETTO dalla verifica: l'avviso di scadenza non e' una "prassi" ma un obbligo di legge: l'impresa e' "tenuta ad avvisare il contraente della scadenza del contratto con preavviso di almeno trenta giorni" (art. 170-bis c.1, testo letto su Brocardi)] | alta (testo di legge letto), media (data 1/1/2013) | https://www.ivass.it/consumatori/quesiti/r.c.auto/index.html ; https://bologna.aci.it/R-C-Auto-non-esiste-piu-il-rinnovo-tacito-delle-polizze ; https://www.ilportaledellautomobilista.it/web/portale-automobilista/-/rc-auto-mai-piu-rinnovo-tacito |
| Periodo di tolleranza (stato attuale) | art. 170-bis D.Lgs. 209/2005: l'impresa deve mantenere operante la garanzia del precedente contratto "non oltre il quindicesimo giorno successivo alla scadenza", fino all'effetto della nuova polizza. Durante l'emergenza Covid era stato portato a 30 giorni (DL 18/2020); dal 1/8/2020 e' tornato a 15 giorni. Vale solo in Italia, non all'estero. Le fonti consultate (2025-2026) lo danno ancora vigente, ma NON ho letto il testo su normattiva e la pagina IVASS delle FAQ non ne parla. [CONFERMATO dalla verifica: il testo dell'art. 170-bis c.1 (Brocardi, copia locale) dice che l'impresa deve "mantenere operante, non oltre il quindicesimo giorno successivo alla scadenza del contratto, la garanzia prestata con il precedente contratto assicurativo fino all'effetto della nuova polizza"; quindi ultimo giorno coperto = scadenza + 15 giorni (A1: 2026-03-10 -> 2026-03-25 corretto). Una ricerca web indipendente conferma che e' il testo vigente.] | alta | https://www.comparasemplice.it/informazioni/news/assicurazione-auto-scaduta-quanti-giorni-puoi-circolare-e-cosa-rischi ; https://www.sicurauto.it/news/codice-della-strada/rc-auto-dal-1-agosto-il-periodo-di-tolleranza-torna-di-15-giorni/ ; https://www.diritto.it/proroga-rca-ex-decreto-legge-cura-italia/ |
| Garanzie accessorie (furto, incendio, kasko, assistenza...) | niente tacito rinnovo anche per le garanzie accessorie (Legge Concorrenza 2017); non serve disdetta, il contratto danni accessorio si intende risolto alla scadenza [CONFERMATO in parte dalla verifica: art. 170-bis c.1-bis: la risoluzione automatica si estende ai rischi accessori solo "qualora lo stesso contratto, ovvero un altro contratto stipulato contestualmente, garantisca simultaneamente sia il rischio principale sia i rischi accessori"; polizze accessorie del tutto autonome non sono coperte da questa norma] | media | https://www.ivass.it/consumatori/quesiti/r.c.auto/index.html |
| Attestato di rischio | dematerializzato dal 1/7/2015 (non si riceve piu' su carta); consultabile online nell'area clienti della compagnia o via email, banca dati ANIA; resta valido 5 anni; la compagnia deve metterlo a disposizione circa 30 giorni prima della scadenza | alta (dematerializzazione, 5 anni), media (30 giorni) | https://www.ivass.it/consumatori/quesiti/r.c.auto/index.html ; https://bologna.aci.it/R-C-Auto-non-esiste-piu-il-rinnovo-tacito-delle-polizze |
| Uso dell'attestato dopo la scadenza | oltre 15 giorni dalla scadenza l'uso dell'attestato richiede una dichiarazione di non circolazione del veicolo; in assenza si rischia l'attribuzione della classe di merito peggiore | bassa (da risultato di ricerca di fonte non primaria; verificare nella guida IVASS) | https://www.ivass.it/consumatori/imparaconivass/guide/Guida_3_RC_Auto_versione_web.pdf (non letta) |
| Classe di merito (bonus-malus) | scala unica a 18 classi (CU); miglioramento di una classe per ogni anno senza sinistri con responsabilita' principale, peggioramento in caso di sinistro con colpa (entita' diversa da compagnia a compagnia); "bonus familiare" per ereditare la classe di un familiare convivente | media (conoscenza consolidata; dettagli non riletti) | https://www.ivass.it/consumatori/quesiti/r.c.auto/index.html (sezioni su bonus familiare e malus) |
| Fondo vittime | senza copertura, i danni a terzi sono risarciti dal Fondo di Garanzia per le Vittime della Strada (Consap) con rivalsa sul responsabile | media | https://www.comparasemplice.it/informazioni/news/assicurazione-auto-scaduta-quanti-giorni-puoi-circolare-e-cosa-rischi |
| Verifica della copertura | servizio "Verifica copertura assicurativa RCA" sul Portale dell'Automobilista (si sceglie il tipo di veicolo e si inserisce la targa); l'accertamento puo' avvenire anche per confronto tra le polizze e i dati dei rilevatori di infrazioni (L. 177/2024) | media (servizio citato da fonte secondaria; URL esatto non verificato) | https://www.comparasemplice.it/informazioni/news/assicurazione-auto-scaduta-quanti-giorni-puoi-circolare-e-cosa-rischi ; https://www.ilportaledellautomobilista.it |

### 3.2 Sanzioni (art. 193 CdS, testo vigente letto su aci.gov.it)

| Violazione | Sanzione | Confidenza | Fonte |
|---|---|---|---|
| Circolare senza copertura RC | da 866 a 3.464 EUR (importi congelati: adeguamento ISTAT sospeso fino a tutto il 2026) | alta | https://aci.gov.it/codice-della-strada/art-193/ |
| Riduzione se si regolarizza rapidamente | [CORRETTO dalla verifica, testo di legge letto verbatim su ACI art. 193 c.3] la sanzione e' ridotta ALLA META' (non a un quarto: [SMENTITO] la variante "un quarto" della fonte secondaria comparasemplice) "quando l'assicurazione del veicolo per la responsabilita' verso i terzi sia comunque resa operante nei quindici giorni successivi al termine di cui all'art. 1901, secondo comma, del codice civile" (art. 1901 c.2 c.c.: l'assicurazione resta sospesa dalle ore 24 del quindicesimo giorno dopo la scadenza). Quindi finestra complessiva = 15 giorni (art. 1901) + 15 giorni = circa 30 giorni dalla scadenza (somma dei due 15 giorni: deduzione mia, confidenza media): la formulazione "entro 30 giorni dalla scadenza" del ricercatore e' coerente. Importo dimezzato: 433-1.732 EUR (866/2 e 3.464/2). Omesso dal ricercatore: stessa riduzione alla meta' se, entro 30 giorni dalla contestazione, l'interessato, previa autorizzazione dell'organo accertatore, esprime la volonta' e provvede alla demolizione e alle formalita' di radiazione del veicolo. Non mostrare comunque l'importo ridotto in app | alta (meta'), media (computo dei giorni) | https://aci.gov.it/codice-della-strada/art-193/ |
| Sequestro/confisca | veicolo sequestrato; restituzione previa stipula di polizza di almeno 6 mesi e pagamento; confisca se non si pagano sanzione e spese di custodia | media | stessa fonte comparasemplice |
| Recidiva nel biennio | sanzione raddoppiata e sospensione della patente da 1 a 2 mesi; fermo amministrativo di 45 giorni nel caso descritto dal comma 2-bis [CONFERMATO dalla verifica: art. 193 c.2 "nei casi indicati dal comma 2-bis la sanzione e' raddoppiata"; c.2-bis: recidiva = almeno due violazioni in due anni, all'ultima consegue la sospensione della patente da uno a due mesi; fermo amministrativo accessorio se pagata in misura ridotta e versato il premio per almeno sei mesi] | alta | https://aci.gov.it/codice-della-strada/art-193/ |
| Documenti assicurativi falsi | confisca del veicolo e sospensione della patente per un anno | media | stessa fonte ACI |
| Veicolo fermo | l'obbligo vale per i veicoli in circolazione su strada (e per quelli in sosta su aree pubbliche); in area privata (garage, cortile) non c'e' obbligo | media | comparasemplice (sopra) |

### 3.3 Casi limite

1. La scadenza che conta e' quella stampata sul certificato/contrassegno digitale: l'app deve chiederla all'utente; il calcolo `inizio + 12 mesi` e' solo un default.
2. L'ora esatta di scadenza dipende dal contratto (spesso ore 24:00 del giorno indicato): chiedere all'utente di verificare; l'app tratta il giorno di scadenza come "ultimo giorno coperto".
3. La tolleranza di 15 giorni NON va usata come margine di sicurezza: il promemoria deve scattare prima della scadenza. Se la nuova polizza e' con un'altra compagnia, la copertura inizia alla data concordata: attenzione al "buco".
4. Polizze di durata inferiore all'anno (temporanee, "a rate"): usare la data di scadenza stampata. [DA VERIFICARE: l'art. 170-bis c.1 prevede durata annuale o "anno piu' frazione", non inferiore; le polizze temporanee sono un prodotto a parte e il pagamento "a rate" non cambia la scadenza della copertura (art. 1901 c.c.: sospensione dopo 15 giorni dal mancato pagamento della rata).]
5. Sospensione (veicolo fermo): dipende dalle condizioni della singola compagnia: campo libero `suspendedFrom/To`; durante la sospensione il veicolo non puo' circolare.
6. Obbligo assicurativo anche per veicoli in sosta su area pubblica: consiglio nell'avvertenza.

### 3.4 Funzione di calcolo

```ts
const RCA_TOLERANCE_DAYS = 15; // art. 170-bis D.Lgs. 209/2005 (configurabile)

// Default se l'utente non inserisce la scadenza: 12 mesi dalla decorrenza (29/02 -> 28/02)
function rcaDefaultExpiry(policyStart: ISODate): ISODate { return addMonths(policyStart, 12); }

type RcaState = 'valida' | 'scade_oggi' | 'in_tolleranza' | 'scoperta';

function rcaStatus(today: ISODate, expiry: ISODate) {
  const toleranceEnd = addDays(expiry, RCA_TOLERANCE_DAYS);
  const d = diffDays(today, expiry);              // >0 giorni alla scadenza
  if (d > 0)  return { state: 'valida' as RcaState, daysLeft: d, toleranceEnd };
  if (d === 0) return { state: 'scade_oggi' as RcaState, daysLeft: 0, toleranceEnd };
  if (today <= toleranceEnd) return { state: 'in_tolleranza' as RcaState, daysOverdue: -d, toleranceEnd };
  return { state: 'scoperta' as RcaState, daysOverdue: -d, toleranceEnd };
}

// Promemoria: confronto preventivi, attestato disponibile, ultimi giorni
const rcaReminders = (expiry: ISODate) => [-45, -30, -15, -7, -1, 0].map(n => addDays(expiry, n));
```

### 3.5 Vettori di test

| # | Input | Output atteso |
|---|---|---|
| A1 | decorrenza 2025-03-10 | scadenza default 2026-03-10; fine tolleranza 2026-03-25 |
| A2 | decorrenza 2024-02-29 | scadenza default 2025-02-28; fine tolleranza 2025-03-15 |
| A3 | oggi 2026-03-10, scadenza 2026-03-10 | scade_oggi, daysLeft 0 |
| A4 | oggi 2026-03-20, scadenza 2026-03-10 | in_tolleranza, daysOverdue 10 |
| A5 | oggi 2026-03-25, scadenza 2026-03-10 | in_tolleranza (ultimo giorno), daysOverdue 15 |
| A6 | oggi 2026-03-26, scadenza 2026-03-10 | scoperta, daysOverdue 16 |
| A7 | scadenza 2025-12-25 | fine tolleranza 2026-01-09 |
| A8 | promemoria per scadenza 2026-03-10 | 2026-01-24, 2026-02-08, 2026-02-23, 2026-03-03, 2026-03-09, 2026-03-10 |

### 3.6 Testo di avvertenza (UI)

"La data di scadenza della polizza RC auto e' quella indicata sul tuo contratto/certificato: controllala. La polizza non si rinnova automaticamente: se non ne stipuli una nuova, resti senza copertura. La legge prevede che la compagnia mantenga la garanzia fino a 15 giorni dopo la scadenza, ma non farci affidamento (non vale all'estero e puo' dipendere dal contratto). Circolare senza assicurazione comporta una sanzione da 866 a 3.464 euro, il sequestro del veicolo e, in caso di recidiva, la sospensione della patente. Puoi verificare la copertura di un veicolo sul Portale dell'Automobilista."

## 4. Pneumatici invernali, catene, battistrada, DOT

### 4.1 Regole

| Punto | Regola | Confidenza | Fonte |
|---|---|---|---|
| Obbligo invernali/catene | NON esiste un obbligo nazionale indistinto: l'art. 6 CdS consente agli enti proprietari/concessionari delle strade di imporre pneumatici invernali oppure catene a bordo dove c'e' segnaletica. La direttiva MIT del 16/1/2013 individua come stagione normale il 15 novembre - 15 aprile | alta | https://www.lautomobile.aci.it/attualita/gomme-invernali-2026-dal-15-ottobre-si-possono-montare-obbligo-date-e-multe/ ; https://www.poliziadistato.it/articolo/dal-15-novembre-scatta-l-obbligo-degli-pneumatici-invernali |
| Sanzioni | fuori dai centri abitati (art. 6): da 87 a 344 EUR; dentro i centri abitati (art. 7): da 42 a 173 EUR [CONFERMATO dalla verifica: stessi importi riletti sull'articolo ACI "Gomme invernali 2026"] | alta (importi congelati; testo ACI) | https://www.lautomobile.aci.it/attualita/gomme-invernali-2026-dal-15-ottobre-si-possono-montare-obbligo-date-e-multe/ |
| Riconoscimento | marcatura M+S e/o simbolo 3PMSF (montagna con fiocco di neve) | alta | https://www.poliziadistato.it/articolo/dal-15-novembre-scatta-l-obbligo-degli-pneumatici-invernali |
| Invernali con codice di velocita' inferiore a quello della carta di circolazione | ammessi dal 15 ottobre al 15 maggio, purche' l'indice non sia inferiore a Q (160 km/h) (circolare MIT n. 1049 del 2014 secondo ACI); se l'indice rispetta la carta di circolazione non ci sono limiti temporali [CONFERMATO dalla verifica su ACI "Gomme invernali 2026": montaggio possibile dal 15 ottobre; obbligo "dal 15 novembre al 15 aprile" solo dove c'e' ordinanza/segnaletica (non e' un obbligo nazionale generalizzato); invernali con indice di velocita' inferiore ammessi fino al 15 maggio purche' l'indice non scenda sotto Q; riferimento: circolare MIT n. 1049 del 17 gennaio 2014] | alta (periodi e indice Q), bassa (adesivo in abitacolo) | https://www.lautomobile.aci.it/attualita/gomme-invernali-2026-dal-15-ottobre-si-possono-montare-obbligo-date-e-multe/ |
| Catene | misura corretta per gli pneumatici montati, compatibili con il veicolo (indicazioni del costruttore), omologate. [CORRETTO dalla verifica, omissione: con pneumatici estivi sono ammessi anche "calze"/dispositivi antisdrucciolevoli conformi alla norma UNI EN 16662-1:2020] | media-alta | stessa fonte ACI |
| Battistrada minimo | 1,6 mm nelle scanalature principali (art. 237 Reg. esecuzione CdS, DPR 495/1992) | media (conoscenza consolidata; la norma non e' stata riletta in questa sessione) [DA VERIFICARE anche dopo la verifica: l'articolo ACI sulle gomme invernali 2026 non cita il minimo di 1,6 mm e la copia locale salvata dell'art. 237 Reg. non contiene il testo] | non verificato su fonte primaria |
| Battistrada consigliato | 3 mm (ACI/Polizia: sotto i 3 mm la tenuta cala, soprattutto sul bagnato); per l'uso invernale alcuni enti indicano 4 mm (soglia non verificata) | media (consiglio, non obbligo) | https://www.poliziadistato.it/articolo/dal-15-novembre-scatta-l-obbligo-degli-pneumatici-invernali |
| Eta'/DOT | il codice DOT (ultime 4 cifre WWYY = settimana + anno di produzione) permette di calcolare l'eta'. Non ho trovato un limite di eta' imposto dalla legge italiana per le auto: consigli dei costruttori/ETRMA = controllo specialistico dopo 5 anni, sostituzione consigliata a 10 anni | media-bassa (nessuna fonte primaria letta; trattare come consiglio) | non verificato |

Nota: durante la revisione vengono controllati lo stato e il battistrada: pneumatici usurati o danneggiati fanno fallire la prova (art. 79 CdS, importo sanzione non verificato).

### 4.2 Casi limite

- Ordinanze locali piu' restrittive o con date diverse (province di Bolzano/Trento, autostrade, strade ANAS): non modellabili; l'app deve mostrare il periodo standard e rimandare a segnaletica/ordinanza. Confidenza: alta sul fatto che dipendono dall'ente; nessun elenco verificato.
- Pneumatici all-season con 3PMSF/M+S: valgono come invernali ai fini dell'obbligo (se marcati M+S/3PMSF e con indice di velocita' idoneo). Confidenza: media.
- DOT a 3 cifre (prima del 2000) non gestito: input accettato solo a 4 cifre.

### 4.3 Funzioni

```ts
// Calendario stagione invernale (seasonStartYear = anno in cui inizia la stagione, es. 2026 per 2026/27)
function winterTyreCalendar(y: number) {
  return {
    mountAllowedFrom: `${y}-10-15`,       // montaggio consentito
    obligationFrom:   `${y}-11-15`,       // inizio periodo ordinanze
    obligationTo:     `${y + 1}-04-15`,   // fine periodo ordinanze
    lowSpeedIndexUntil: `${y + 1}-05-15`  // limite per invernali con indice inferiore (media confidenza)
  };
}
const winterTyreReminders = (y: number) =>
  [`${y}-10-01`, `${y}-11-08`, `${y}-11-15`, `${y + 1}-04-01`, `${y + 1}-04-15`];

function treadStatus(mm: number, winter: boolean) {
  if (mm < 1.6) return 'illegale';                    // obbligo di legge (media confidenza sul testo)
  if (mm < 3.0) return 'da_sostituire_presto';        // consiglio
  if (winter && mm < 4.0) return 'sconsigliato_inverno'; // consiglio, soglia non verificata
  return 'ok';
}

// DOT 'WWYY' -> data di produzione approssimata (lunedi' ~ della settimana: 1 gennaio + (WW-1)*7 giorni)
function dotProductionDate(dot4: string): ISODate {
  const ww = +dot4.slice(0, 2), yy = 2000 + +dot4.slice(2, 4);
  return addDays(`${yy}-01-01`, (ww - 1) * 7);
}
const tyreAgeYears = (dot4: string, today: ISODate) => diffDays(dotProductionDate(dot4), today) / 365.25;
// soglie (consigli): >=5 anni "fai controllare", >=10 anni "sostituzione consigliata"
```

### 4.4 Vettori di test

| # | Input | Output atteso |
|---|---|---|
| T1 | winterTyreCalendar(2026) | 2026-10-15, 2026-11-15, 2027-04-15, 2027-05-15 |
| T2 | treadStatus(1.5, false) | illegale |
| T3 | treadStatus(1.6, false) | da_sostituire_presto (al limite legale) |
| T4 | treadStatus(3.5, true) | sconsigliato_inverno |
| T5 | treadStatus(4.0, true) | ok |
| T6 | DOT '1219', oggi 2026-10-07 | produzione 2019-03-19, eta' ~ 7,55 anni (>= 5: "fai controllare") |
| T7 | DOT '4524', oggi 2026-10-07 | produzione 2024-11-04, eta' ~ 1,92 anni (ok) |

### 4.5 Testo di avvertenza (UI)

"Dal 15 novembre al 15 aprile, dove c'e' l'apposita segnaletica o ordinanza, devi avere pneumatici invernali montati oppure le catene a bordo. Non c'e' un obbligo valido ovunque: controlla le ordinanze del percorso. Il battistrada minimo di legge e' 1,6 mm, ma sotto i 3-4 mm la sicurezza cala molto. L'eta' dei pneumatici (codice DOT) e' un'indicazione prudenziale: controllali dopo 5 anni e valuta la sostituzione intorno ai 10. Sanzioni per la mancanza di dotazioni invernali: da 87 a 344 euro fuori dai centri abitati."

## 5. Bombole GPL e metano

### 5.1 Regole (fonti secondarie di settore: confidenza media; nessun testo di legge letto)

| Impianto | Regola | Confidenza | Fonte |
|---|---|---|---|
| Serbatoio GPL | scade dopo 10 anni dalla data di costruzione (stampata sul serbatoio); va sostituito, con collaudo presso la Motorizzazione. [DA VERIFICARE, fonti in conflitto: una fonte secondaria (missionline.it, ricerca web) dice che i 10 anni decorrono dall'immatricolazione dell'auto per impianti di primo equipaggiamento, oppure dalla data di installazione se l'impianto e' montato su auto usata, NON dalla data di costruzione del serbatoio; la funzione `gplTankExpiry` e il vettore G5 potrebbero quindi usare la data sbagliata] | media-bassa | https://www.sicurauto.it/news/codice-della-strada/auto-a-metano-con-bombola-scaduta-sanzioni-e-rischi/ (sezione GPL nei risultati) ; http://www.sicurauto.it/esperto-di-sicurauto/news/sostituzione-serbatoio-gpl-una-stangata-memorabile.html |
| Bombole metano omologazione nazionale (DGM) | riqualificazione ogni 5 anni | media | https://www.federmetano.it/revisione-bombole-metano/ |
| Bombole metano R110 (ECE/ONU) | riqualificazione ogni 4 anni; con il DM 13 maggio 2022 ogni 48 mesi dalla data di immatricolazione dell'autoveicolo (come da libretto) [CONFERMATO in parte dalla verifica: DM 13/5/2022 n. 144 sulla riqualificazione R110, in vigore dal 14/7/2022; R110 ogni 4 anni e DGM ogni 5 anni (fonti secondarie missionline.it/certifico.com, nessun testo del DM letto)] | media | https://www.sicurauto.it/news/codice-della-strada/revisione-bombole-metano-cosa-prevede-il-nuovo-decreto-13-5-2022/ ; https://www.federmetano.it/revisione-bombole-metano/bombole-metano-cng-4/ |
| Bombole metano R110 tipo IV (composito/fibra di carbonio) | prima riqualificazione a 4 anni dalla prima immatricolazione, poi ogni 2 anni [DA VERIFICARE: un titolo trovato nella verifica (motori.quotidiano.net: "MIT porta a 4 anni l'intervallo di riqualificazione periodica delle bombole CNG4 sui veicoli M1/N1") suggerisce che l'intervallo successivo sia ora 4 anni e non 2: articolo non letto, quindi non corretto; il vettore G4 e `cngNextDue` (24 mesi) vanno rivisti] | bassa | risultati ricerca (federmetano/sicurauto) |
| Vita massima bombole metano | sostituzione obbligatoria dopo 20 anni dall'installazione | media | stessa ricerca (federmetano/sicurauto) |
| Impianti a gas: revisione veicolo | la verifica dell'impianto rientra nella revisione periodica del veicolo (art. 80) | media-bassa | non verificato |

### 5.2 Casi limite

- Il tipo di omologazione (DGM, R110, R110 tipo IV) e la data di riferimento si leggono su targhetta bombola/libretto: l'app deve chiederli all'utente; senza il tipo non si calcola nulla ("da verificare").
- La convenzione "fine mese o giorno esatto" per la scadenza della riqualificazione non e' stata verificata: l'app usa la data esatta + mesi (conservativo: avvisare un mese prima). Confidenza: bassa.
- Vetture bifuel immatricolate con impianto di serie: stessa logica, riferita alla data di immatricolazione.

### 5.3 Funzioni

```ts
type CngType = 'DGM' | 'R110' | 'R110_TYPE_IV';

// baseDate = data di immatricolazione (primo ciclo) oppure data dell'ultima riqualificazione
function cngNextDue(type: CngType, baseDate: ISODate, isFirstCycle: boolean): ISODate {
  switch (type) {
    case 'DGM':          return addMonths(baseDate, 60);
    case 'R110':         return addMonths(baseDate, 48);
    case 'R110_TYPE_IV': return addMonths(baseDate, isFirstCycle ? 48 : 24);
  }
}
const cngEndOfLife = (installDate: ISODate) => addMonths(installDate, 240);   // 20 anni

// GPL: data di costruzione serbatoio 'YYYY-MM' -> scadenza = ultimo giorno del mese, +10 anni
function gplTankExpiry(constructionYM: string): ISODate {
  const y = +constructionYM.slice(0, 4), m = +constructionYM.slice(5, 7);
  return endOfMonth(y + 10, m);
}
```

### 5.4 Vettori di test

| # | Input | Output atteso |
|---|---|---|
| G1 | R110, immatricolazione 2020-06-15, primo ciclo | 2024-06-15 |
| G2 | R110, ultima riqualificazione 2024-05-20 | 2028-05-20 |
| G3 | DGM, ultima riqualificazione 2023-01-31 | 2028-01-31 |
| G4 | R110_TYPE_IV, immatricolazione 2021-03-10, primo ciclo | 2025-03-10; poi riqualificazione 2025-03-01 -> 2027-03-01 |
| G5 | serbatoio GPL costruito 2018-09 | scade 2028-09-30 |
| G6 | bombola metano installata 2012-02-29 | fine vita 2032-02-29 |

### 5.5 Testo di avvertenza (UI)

"Le bombole del metano e il serbatoio del GPL hanno scadenze di sicurezza (riqualificazione/collaudo/sostituzione) che dipendono dal tipo di omologazione e dalla data riportata su targhetta e libretto. Le date calcolate sono indicative: verificale con la tua officina autorizzata prima della scadenza. Circolare con bombole scadute e' pericoloso e sanzionato."

## 6. Patente di guida

### 6.1 Regole

| Punto | Regola | Confidenza | Fonte |
|---|---|---|---|
| Durata patente A/B (art. 126 CdS) | 10 anni fino a 50 anni di eta'; 5 anni da 50 a 70; 3 anni da 70 a 80; 2 anni oltre 80 [CONFERMATO nella struttura: art. 126 c.2 "valide per dieci anni; qualora siano rilasciate o confermate a chi ha superato il cinquantesimo anno di eta' sono valide per cinque anni ed a chi ha superato il settantesimo anno di eta' per tre anni"; c.6 "al compimento dell'ottantesimo anno di eta'... ogni due anni"; il MIT scrive "fino al compimento dei 50/70/80 anni"]. [DA VERIFICARE le soglie esatte: il testo di legge usa "ha superato" per 50 e 70 e "al compimento" per 80, il MIT usa "fino al compimento": chi rinnova il giorno esatto del 50o/70o compleanno resta nella fascia precedente secondo la lettera dell'art. 126 c.2, mentre il ricercatore (P6) assume la fascia successiva]. [CORRETTO dalla verifica, ERRORE DI CALCOLO] La scadenza NON e' "il compleanno dell'anno rinnovo + N": il Portale dell'Automobilista/MIT dice che alla conferma o al primo rilascio la validita' e' "prorogata fino alla data del compleanno del titolare immediatamente successiva alla scadenza ordinaria prevista dal Codice della strada". Quindi: scadenza ordinaria = data rinnovo + N anni; scadenza effettiva = primo compleanno successivo a tale data (non quello eventualmente precedente nello stesso anno). Vale solo per le patenti A/B (AM, A1, A2, A, B1, B, BE) con scadenza ordinaria, in vigore dal 17/9/2012; ESCLUSE le patenti C, D, CQC e le A/B rinnovate con visita medica locale o specialistica (omesso dal ricercatore) | alta (regola del compleanno e struttura), media (soglie esatte) | https://aci.gov.it/codice-della-strada/art-126/ ; https://www.ilportaledellautomobilista.it/web/portale-automobilista/-/mit-la-patente-scade-al-compleanno ; https://www.mit.gov.it/rinnovo-patente |
| Neopatentati (L. 177/2024) | per 3 anni dal conseguimento della patente B: niente veicoli con potenza specifica oltre 75 kW/t e, per le M1, potenza massima 105 kW (prima: 1 anno) | [CORRETTO dalla verifica] le nuove regole (3 anni; 75 kW/t; 105 kW per le M1) si applicano alle patenti conseguite a partire dal 14/12/2024, data di entrata in vigore della L. 177/2024 (fonte: ricerca web su sintesi ACI/stampa; per le patenti precedenti vale il regime previgente di 1 anno): `neopatentatoUntil` va applicata solo se issue >= 2024-12-14 | media-alta (applicabilita' dal 14/12/2024 e limiti confermati da piu' sintesi, testo di legge non letto) | https://salerno.aci.it/IMG/pdf/slide_legge_n._177_2024_-_modifiche_al_codice_della_strada_1_.pdf ; https://rivistagiuridica.aci.it/fileadmin/Documenti/2026/Dottrina_e_Approfondimenti/Limitazioni_per_i_neopatentati_versione_aggiornata.pdf |
| Direttiva (UE) 2025/2205 (nuove norme patenti) | approvata dal Parlamento UE il 21/10/2025, pubblicata in GUUE il 5/11/2025: patente A/B valida 15 anni (10 se vale come documento d'identita'), 5 anni per camion/autobus; Stati possono ridurre per over 65; patente digitale; 3 anni per recepire + 1 anno per applicare. Quindi in Italia NON cambia nulla fino al recepimento (circa 2028-2029) | media (fonte Parlamento UE; testo non letto) | https://www.europarl.europa.eu/news/it/press-room/20251016IPR30947/via-libera-alle-nuove-norme-di-guida-ue-per-migliorare-la-sicurezza-stradale ; https://rivistagiuridica.aci.it/documento/direttiva-sulla-patente-di-guida-2025.html |
| Sanzione patente scaduta | [SMENTITO il "173-694" ricordato dal ricercatore; CORRETTO dalla verifica] art. 126 c.11: da 158 a 638 EUR, con sanzione accessoria del ritiro della patente (testo letto su ACI e su Brocardi) | alta (testo di legge letto; importo senza verificare eventuali adeguamenti successivi) | https://aci.gov.it/codice-della-strada/art-126/ |
| Finestra di rinnovo / validita' certificato medico | certificato medico "in data non anteriore a tre mesi" alla data della domanda: [CONFERMATO, media: riportato da risultati di ricerca su fonti MIT/ACI, non ho letto la pagina specifica]; finestra di anticipo del rinnovo: [DA VERIFICARE] (la pagina MIT "Rinnovo patente" non la indica). Omessi dal ricercatore (testo art. 126): se la patente e' scaduta da piu' di 5 anni la conferma richiede anche un esperimento di guida (c.8-ter); durante la procedura presso la commissione medica locale si puo' ottenere un permesso provvisorio di guida (c.8-bis) | media | https://www.mit.gov.it/rinnovo-patente ; https://aci.gov.it/codice-della-strada/art-126/ |

### 6.2 Funzioni

```ts
function ageOn(birth: ISODate, on: ISODate): number {
  const b = ymd(birth), o = ymd(on);
  let a = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) a--;
  return a;
}
function patenteValidityYears(ageAtRenewal: number): number {
  if (ageAtRenewal < 50) return 10;   // soglia esatta a 50 anni: [DA VERIFICARE] art. 126 c.2 dice "ha superato il cinquantesimo anno" (a 50 anni esatti: 10 anni?), MIT "fino al compimento dei 50 anni"
  if (ageAtRenewal < 70) return 5;
  if (ageAtRenewal < 80) return 3;
  return 2;
}
// [CORRETTO dalla verifica] scadenza = PRIMO compleanno successivo alla scadenza ordinaria (rinnovo + N anni)
// (MIT/Portale: "compleanno immediatamente successivo alla scadenza ordinaria"). La versione precedente usava il
// compleanno dell'anno (anno rinnovo + N), che e' ERRATO quando il compleanno cade prima del giorno di rinnovo
// (es. nato 12/04/1985, rinnovo 01/06/2026: giusto 2037-04-12, la vecchia funzione dava 2036-04-12).
// Solo per patenti A/B con scadenza ordinaria (non CML/visita specialistica, non C/D).
// Ambiguita' residua [DA VERIFICARE]: se il compleanno coincide con la scadenza ordinaria si assume che valga quel giorno.
function patenteExpiry(birth: ISODate, issueOrRenewal: ISODate, manualExpiry?: ISODate): ISODate {
  if (manualExpiry) return manualExpiry;                // il campo 4b della patente vince sempre
  const age = ageOn(birth, issueOrRenewal);
  const ordinary = addMonths(issueOrRenewal, 12 * patenteValidityYears(age)); // scadenza ordinaria
  const { m, d } = ymd(birth);
  let year = ymd(ordinary).y;
  let cand = `${year}-${pad(m)}-${pad(Math.min(d, daysInMonth(year, m)))}`;   // 29/02 -> 28/02 negli anni non bisestili
  if (cand < ordinary) { year += 1; cand = `${year}-${pad(m)}-${pad(Math.min(d, daysInMonth(year, m)))}`; }
  return cand;
}
// Neopatentato: restrizioni potenza per 3 anni dal conseguimento, SOLO per patenti conseguite dal 14/12/2024
// [CORRETTO dalla verifica]; per quelle precedenti vale il regime previgente (1 anno).
const neopatentatoUntil = (issue: ISODate) => addMonths(issue, issue >= '2024-12-14' ? 36 : 12);
// Promemoria rinnovo: -120, -60, -30, -7 giorni
const patenteReminders = (exp: ISODate) => [-120, -60, -30, -7].map(n => addDays(exp, n));
```

### 6.3 Vettori di test

| # | Input | Output atteso |
|---|---|---|
| P1 | nato 1985-04-12, rinnovo 2026-03-01 (40 anni) | 2036-04-12 |
| P2 | nato 1970-09-30, rinnovo 2026-05-10 (55 anni) | 2031-09-30 |
| P3 | nato 1950-01-20, rinnovo 2026-01-10 (75 anni) | 2029-01-20 |
| P1-P3 | (invariati) | [CONFERMATI ricalcolando a mano con la regola corretta: scadenza ordinaria 2036-03-01 / 2031-05-10 / 2029-01-10, primo compleanno successivo 2036-04-12 / 2031-09-30 / 2029-01-20] |
| P4 | nato 1940-11-02, rinnovo 2026-06-01 (85 anni) | 2028-11-02 [DA VERIFICARE: oltre gli 80 anni il rinnovo avviene presso la commissione medica locale, e il MIT esclude dalla regola del compleanno le patenti A/B rinnovate con visita medica locale o specialistica; il valore 2028-11-02 potrebbe quindi essere 2028-06-01 o una data decisa dalla commissione] |
| P5 | nato 1988-02-29, rinnovo 2027-05-01 (39 anni) | [CORRETTO dalla verifica] 2038-02-28 (scadenza ordinaria 2037-05-01 -> primo compleanno successivo nel 2038, con clamp 29/02 -> 28/02); la versione precedente (2037-02-28) cadeva PRIMA della scadenza ordinaria. Il clamp 29/02->28/02 e' una scelta di implementazione [DA VERIFICARE] |
| P6 | nato 1976-06-15, rinnovo 2026-06-15 (50 anni esatti) | 2031-06-15 (assunto 5 anni) [DA VERIFICARE: per la lettera dell'art. 126 c.2 ("ha superato il cinquantesimo anno") a 50 anni esatti si resterebbe nella fascia 10 anni, quindi 2036-06-15; il MIT scrive "fino al compimento dei 50 anni"] |
| P7 | patente conseguita 2024-12-20 | limiti neopatentato fino al 2027-12-20 [CONFERMATO il calcolo; vale solo perche' 2024-12-20 >= 2024-12-14: per una patente conseguita prima del 14/12/2024 il limite e' 1 anno] |
| P8 | scadenza manuale 2030-03-04 | 2030-03-04 |
| P9 | (nuovo, controesempio) nato 1985-04-12, rinnovo 2026-06-01 (41 anni) | [CORRETTO dalla verifica] 2037-04-12 (scadenza ordinaria 2036-06-01 -> compleanno successivo 2037-04-12); la funzione precedente restituiva 2036-04-12 |
| P10 | (nuovo, controesempio) nato 1960-03-10, rinnovo 2026-09-20 (66 anni) | 2032-03-10 (scadenza ordinaria 2031-09-20 -> compleanno successivo 2032-03-10); la funzione precedente restituiva 2031-03-10 |

### 6.4 Testo di avvertenza (UI)

"La scadenza della patente e' calcolata dalla data di nascita e dall'ultimo rinnovo che hai inserito (10 anni fino a 50 anni di eta', 5 fino a 70, 3 fino a 80, 2 oltre) e, per le patenti A/B con scadenza ordinaria, cade nel giorno del compleanno successivo alla scadenza ordinaria [CORRETTO dalla verifica: aggiunta la regola del compleanno]. Verifica la data riportata sul documento (campo 4b). Le regole europee approvate nel 2025 (patente valida 15 anni) non sono ancora in vigore in Italia. Per i neopatentati valgono per 3 anni limiti alla potenza del veicolo."

## 7. Passaggio di proprieta'

### 7.1 Regole

| Punto | Regola | Confidenza | Fonte |
|---|---|---|---|
| Termine trascrizione al PRA | entro 60 giorni dalla data dell'autentica della firma del venditore sull'atto di vendita [CONFERMATO dalla verifica sul testo dell'art. 94 c.1 CdS: la richiesta dell'acquirente va fatta "entro sessanta giorni dalla data in cui la sottoscrizione dell'atto e' stata autenticata o giudizialmente accertata"; i vettori S1-S3 ricalcolati a mano: 2026-10-31, 2026-03-16, 2027-02-18, tutti corretti] | alta | https://aci.gov.it/pratica-auto/passaggio-di-proprieta-mancata-trascrizione-al-pra/ |
| Sanzione per ritardo (IPT) | oltre i 60 giorni: sanzione sull'Imposta Provinciale di Trascrizione: 30% per atti scaduti entro il 30/8/2024, 25% per atti con scadenza dal 1/9/2024, piu' interessi legali sulla sola IPT; riduzioni: meta' se il ritardo non supera 90 giorni, 1/15 per giorno se non supera 15 giorni; ravvedimento operoso con ulteriori riduzioni (1/10 fino al 75o giorno e fino al 90o, 1/9 dal 91o al 150o, 1/8 dal 151o) | media-alta (testo ACI sintetico; i dettagli delle riduzioni vanno verificati) | stessa pagina ACI |
| Cessione a rivenditore (D.Lgs. 147/2026, in vigore dal 12/8/2026) | il venditore resta obbligato al bollo finche' non e' trascritto il passaggio al PRA (entro 60 giorni) | media | https://www.informazionefiscale.it/bollo-auto-novita-scadenze-obblighi-controlli |
| Obblighi accessori art. 94 CdS (aggiornamento carta di circolazione/DU, notifica di vendita del venditore) | esistono termini ulteriori (ricordo 60 giorni per aggiornamenti al DU; notifica di vendita del venditore): non verificati. [CORRETTO dalla verifica, lettura del testo di art. 94 su ACI e Brocardi] c.1: l'aggiornamento della carta di circolazione/DU e la trascrizione al PRA avvengono "su richiesta avanzata dall'acquirente entro sessanta giorni dalla data in cui la sottoscrizione dell'atto e' stata autenticata o giudizialmente accertata" (vale anche per usufrutto e locazione con facolta' di acquisto); il testo NON prevede una "notifica di vendita" del venditore ([DA VERIFICARE] se altra norma, es. il regolamento PRA, la preveda). Sanzioni amministrative omesse dal ricercatore: c.3 da 727 a 3.629 EUR per chi non osserva le disposizioni dell'articolo; c.4 da 363 a 1.813 EUR per chi circola con un veicolo per cui non e' stato richiesto l'aggiornamento nel termine del c.1 (importi dal testo ACI/Brocardi; adeguamento ISTAT non verificato) | alta (60 giorni dall'autentica), media (importi) | https://aci.gov.it/codice-della-strada/art-94/ ; https://www.brocardi.it/codice-della-strada/titolo-iii/capo-iii/sezione-iii/art94.html |

### 7.2 Casi limite

- Il termine decorre dalla data di autentica (non dalla data di consegna del veicolo). Se manca l'autentica (atto privato), l'app deve chiedere la data dell'atto autenticato.
- Il termine "entro 60 giorni dalla data": giorno iniziale escluso (dies a quo non computatur): 60 giorni dopo la data di autentica. Se cade in giorno festivo, probabile slittamento al primo lavorativo (bassa confidenza).
- Usare anche per la vendita: promemoria al venditore "verifica che l'acquirente abbia registrato il passaggio".

### 7.3 Funzione e test

```ts
const PASSAGGIO_PRA_DAYS = 60;
const passaggioDeadline = (authDate: ISODate) => addDays(authDate, PASSAGGIO_PRA_DAYS);
const passaggioReminders = (authDate: ISODate) => [30, 45, 55, 60].map(n => addDays(authDate, n));
```

| # | Input | Output atteso |
|---|---|---|
| S1 | autentica 2026-09-01 | scadenza 2026-10-31 |
| S2 | autentica 2026-01-15 | scadenza 2026-03-16 |
| S3 | autentica 2026-12-20 | scadenza 2027-02-18 |
| S4 | autentica 2026-09-01, promemoria | 2026-10-01, 2026-10-16, 2026-10-26, 2026-10-31 |

### 7.4 Testo di avvertenza (UI)

"Dopo la vendita, la trascrizione del passaggio al PRA va richiesta entro 60 giorni dalla data di autentica della firma del venditore: oltre questo termine sono dovute sanzioni sull'imposta provinciale di trascrizione. Il venditore dovrebbe verificare che il passaggio sia stato registrato (per evitare responsabilita' su bollo e multe). Verifica sempre i dettagli con l'agenzia pratiche auto o l'ACI."

## 8. Bollino blu, limitazioni ambientali e ZTL

Principio: sono regole LOCALI (comune/Regione), variabili e a data; l'app non deve tentare di calcolarle in modo generale. Conviene: (a) raccogliere classe Euro, alimentazione e comune di residenza; (b) mandare un promemoria stagionale informativo; (c) lasciare scadenze manuali per bollino blu e permessi ZTL.

| Voce | Cosa risulta (2026-10-07) | Confidenza | Fonte |
|---|---|---|---|
| Limitazioni stagionali bacino padano | Piemonte: 15 settembre - 15 aprile, diesel Euro 3 e 4, feriali 8:00-18:30; Veneto: 1 ottobre - 30 aprile, diesel Euro 4 dal lunedi' al venerdi' (con livelli di allerta); Emilia-Romagna: 1 ottobre - 31 marzo, diesel Euro 4 nei comuni PAIR/pianura; Lombardia: 1 ottobre - 31 marzo, diesel Euro 4 lun-ven nei 209 comuni di Fascia 1 e nei comuni di Fascia 2 oltre 30.000 abitanti. Sul blocco dei diesel Euro 5 le fonti sono discordanti (la sintesi dice sia che non e' stato esteso, "con eccezione", sia che dal 1/10/2026 scatta in Emilia-Romagna): NON usare come dato certo | bassa-media (fonte giornalistica, sintesi di ricerca; non ho letto le ordinanze regionali) | https://www.sicurauto.it/news/blocco-diesel-euro-4-5-il-calendario-2026-2027-delle-regioni/ ; https://www.fleetmagazine.com/calendario-blocco-diesel-2026-euro-4-regioni/ |
| Bollino blu | non e' un obbligo nazionale: dipende da Regione/comune (controllo emissioni annuale del riscaldamento/auto in alcuni territori). Non ho verificato quali Regioni lo richiedano oggi ne' la validita' | bassa | non verificato |
| ZTL / Area B / Area C / LEZ | regole e orari per citta'; accesso con permesso o registrazione targa entro un termine definito dal singolo comune; sanzioni per varco non autorizzato (art. 7 CdS) con importi che variano | bassa (non verificato) | non verificato |

Raccomandazioni di prodotto:
1. Campo "scadenza bollino blu" e "scadenza permesso ZTL" liberi (data + nota + link al comune).
2. Promemoria annuale informativo al 1 ottobre e al 15 settembre (Piemonte): "Verifica le limitazioni antismog per la classe Euro del tuo veicolo nel tuo comune".
3. Mai affermare "puoi circolare" o "non puoi circolare": usare "potrebbero applicarsi limitazioni".

```ts
// Promemoria informativo stagionale: nessun calcolo normativo, solo avviso data-driven
function seasonalLowEmissionNotice(today: ISODate, euroClass: number, fuel: 'diesel' | 'benzina' | 'altro') {
  const m = ymd(today).m;
  const inSeason = m >= 10 || m <= 4;                    // 1 ott - 30 apr (Piemonte da 15 set)
  return inSeason && fuel === 'diesel' && euroClass <= 5; // true -> mostra avviso "verifica limitazioni"
}
```

| # | Input | Output atteso |
|---|---|---|
| L1 | oggi 2026-10-07, diesel Euro 4 | true (mostra avviso) |
| L2 | oggi 2026-07-15, diesel Euro 4 | false |
| L3 | oggi 2026-11-10, benzina Euro 4 | false (nessun avviso nell'implementazione base) |

## 9. Manutenzione indicativa e garanzia UE

REGOLA DI PRODOTTO: nell'app le scadenze di legge (sez. 1-7) e gli intervalli di manutenzione (questa sezione) devono avere categorie, colori e testi di avvertenza DIVERSI. Le prime hanno una norma e sanzioni; le seconde sono consigli tecnici: l'autorita' e' il "Libretto di uso e manutenzione" del costruttore, che prevale su qualunque default dell'app.

### 9.1 Obblighi di legge (NON manutenzione): riepilogo

| Obbligo | Sezione | Calendario |
|---|---|---|
| Revisione periodica | 1 | 4 anni, poi ogni 2, entro fine mese |
| Assicurazione RC auto | 3 | annuale, nessun tacito rinnovo |
| Bollo | 2 | annuale, mese di immatricolazione (regole regionali) |
| Pneumatici (battistrada >= 1,6 mm; invernali/catene dove prescritto) | 4 | 15/11 - 15/4 dove c'e' segnaletica |
| Bombole GPL/metano | 5 | 10 anni / 4-5 anni (secondo tipo) |
| Patente | 6 | 10/5/3/2 anni per fascia di eta' |
| Passaggio di proprieta' | 7 | 60 giorni |

### 9.2 Intervalli indicativi di manutenzione (NON obblighi)

Confidenza complessiva: MEDIA-BASSA. Sono valori tipici di mercato/prassi tecnica generale, NON verificati su manuali di costruttore in questa sessione (budget di ricerca esaurito sulle fonti normative). Vanno presentati come "default modificabile", con campo "intervallo del costruttore" prioritario. Regola di calcolo: scade al PRIMO dei due limiti (km o mesi).

| Voce | Intervallo tipico km | Intervallo tipico mesi | Note |
|---|---|---|---|
| Tagliando di manutenzione | 15.000-30.000 | 12-24 | uso urbano/brevi tragitti = "severo": accorciare; seguire il libretto |
| Olio motore + filtro olio | 10.000-20.000 | 12 | long-life fino a 30.000 km/24 mesi solo se prescritto dal costruttore; specifica dell'olio (ACEA/VW/MB...) da libretto |
| Filtro aria motore | 20.000-40.000 | 24 | |
| Filtro abitacolo (pollini) | 15.000-20.000 | 12 | |
| Filtro carburante | diesel 30.000-60.000; benzina spesso a vita/60.000+ | 24-48 | |
| Cinghia di distribuzione (+ pompa acqua) | 60.000-120.000 | 60-120 (5-10 anni) | vale il primo limite; la catena non ha di norma intervallo fisso (ispezione); rottura = danni gravi al motore |
| Liquido freni | - | 24 (ogni 2 anni) | igroscopico; DOT 4 tipico; indipendente dai km |
| Liquido refrigerante | 60.000-150.000 | 36-60 (long-life fino a 120) | specifica del costruttore |
| Batteria 12 V | - | vita media 48-72 mesi; test annuale dopo i 3-4 anni | AGM/EFB (start-stop) 60-84 mesi |
| Pastiglie freni | 25.000-60.000 | controllo a ogni tagliando | dipende da stile di guida/peso |
| Dischi freni | 60.000-120.000 | controllo a ogni tagliando | spessore minimo inciso sul disco |
| Candele (benzina) | 30.000-60.000 (iridio/platino 90.000-120.000) | 36-60 | |
| Pneumatici: inversione/bilanciatura | 10.000-15.000 | - | |
| Pneumatici: sostituzione per usura | 30.000-60.000 | controllo a 5 anni, max 10 | vedi sez. 4 |
| Olio cambio (manuale/automatico/DSG) | 60.000-120.000 | 48-72 | "a vita" dichiarato da alcuni costruttori: valutare |
| Spazzole tergicristallo | - | 12 | |
| Climatizzatore (sanificazione/ricarica gas) | - | 24 | |
| Cinghia servizi (accessori) | 60.000-100.000 | 60 | |
| Pressione pneumatici | - | controllo mensile e prima di viaggi | |
| Livelli (olio, refrigerante, lavavetri) | - | controllo mensile | |
| AdBlue (diesel Euro 6) | secondo spia/consumi | - | rifornire alla segnalazione |

### 9.3 Regola UE: il tagliando fuori rete non fa decadere la garanzia

| Punto | Contenuto | Confidenza | Fonte |
|---|---|---|---|
| Libera scelta dell'officina | il consumatore e' libero di far fare manutenzione e riparazioni da un'officina indipendente, anche con ricambi di qualita' equivalente, SENZA perdere la garanzia | alta | https://competition-policy.ec.europa.eu/system/files/2021-09/FAQ_application_of_EU_antitrust_rules_in_the_motor_vehicle_sector_en.pdf |
| Limite | il costruttore puo' rifiutare la garanzia solo per guasti dovuti a lavori eseguiti male dall'officina indipendente; puo' pretendere ricambi originali solo per lavori coperti dalla garanzia/richiami/tagliandi gratuiti pagati da lui | alta | stessa FAQ della Commissione UE |
| Base normativa | Regolamento (UE) n. 461/2010 (esenzione per categoria nel settore auto, MVBER), prorogato fino al 31/5/2028 dal Regolamento (UE) 2023/822; la Commissione deve valutarne il funzionamento entro il 31/5/2028 | alta | https://eur-lex.europa.eu/eli/reg/2010/461/2023-05-07/eng ; https://competition-policy.ec.europa.eu/sectors/motor-vehicles/legislation_en |
| Garanzie contrattuali/estese | l'uso di condizioni di garanzia per escludere le officine indipendenti e' una condotta da guardare con sospetto per il diritto antitrust, ma i termini di una garanzia estesa a pagamento vanno comunque letti (possono prevedere obblighi di documentare gli interventi) | media | stessa FAQ |
| Garanzia legale di conformita' italiana (24 mesi dalla consegna per i beni di consumo) | distinta dalla garanzia commerciale del costruttore; Codice del Consumo (D.Lgs. 206/2005 artt. 128 ss., aggiornato dal D.Lgs. 170/2021) | media (non riletto in questa sessione) | non verificato |

Consigli pratici per l'app: salvare per ogni intervento data, km, officina, fattura/ricevuta e specifica dei ricambi/olio usati (prova per eventuali contestazioni); promemoria "conserva la fattura del tagliando".

Testo di avvertenza (UI): "In base alla normativa europea sulla concorrenza nel settore auto, puoi fare il tagliando anche in un'officina indipendente senza perdere la garanzia del costruttore, purche' vengano rispettati gli interventi e le specifiche previste e il lavoro sia eseguito a regola d'arte. Conserva le fatture. Le condizioni di una garanzia estesa a pagamento possono prevedere regole proprie: leggi il contratto."

### 9.4 Funzione di calcolo (manutenzione)

```ts
interface MaintItem { id: string; everyKm?: number; everyMonths?: number }
interface MaintLast { km: number; date: ISODate }
interface Now { km: number; date: ISODate }

function maintDue(item: MaintItem, last: MaintLast, now: Now, soonKm = 1000, soonDays = 30) {
  const dueKm   = item.everyKm     ? last.km + item.everyKm : undefined;
  const dueDate = item.everyMonths ? addMonths(last.date, item.everyMonths) : undefined;
  const kmLeft   = dueKm   !== undefined ? dueKm - now.km : undefined;
  const daysLeft = dueDate !== undefined ? diffDays(now.date, dueDate) : undefined;
  const overdue = (kmLeft !== undefined && kmLeft < 0) || (daysLeft !== undefined && daysLeft < 0);
  const soon = !overdue && ((kmLeft !== undefined && kmLeft <= soonKm) || (daysLeft !== undefined && daysLeft <= soonDays));
  return { dueKm, dueDate, kmLeft, daysLeft, state: overdue ? 'scaduto' : soon ? 'in_scadenza' : 'ok' };
}
// Stima della data da km (opzionale): giorniRestanti ~= kmLeft / (km medi al giorno degli ultimi 90 giorni)
```

| # | Input | Output atteso |
|---|---|---|
| M1 | olio 15.000 km/12 mesi; ultimo 42.000 km il 2025-10-01; ora 55.000 km il 2026-10-07 | dueKm 57.000; dueDate 2026-10-01; kmLeft 2.000; daysLeft -6; scaduto (per il limite mesi) |
| M2 | olio 15.000/12; ultimo 30.000 il 2026-01-15; ora 33.000 il 2026-10-07 | dueKm 45.000; dueDate 2027-01-15; kmLeft 12.000; daysLeft 100; ok |
| M3 | pastiglie 40.000 km; ultimo 20.000 km il 2023-05-01; ora 61.000 km | dueKm 60.000; kmLeft -1.000; scaduto |
| M4 | liquido freni 24 mesi; ultimo 2024-10-20; ora 2026-10-07 | dueDate 2026-10-20; daysLeft 13; in_scadenza |
| M5 | intervallo 12 mesi; ultimo 2024-02-29 | dueDate 2025-02-28 |
| M6 | 10.000 km; ultimo 20.000; ora 29.000 | kmLeft 1.000; in_scadenza |

## 10. Novita' recenti del Codice della Strada e dintorni (2024-2026)

Tutte da trattare come "regole con data": nessuna e' stata letta in Gazzetta Ufficiale/Normattiva in questa sessione (Normattiva non e' interrogabile con gli strumenti disponibili); le sintesi vengono da ACI/MIT/Parlamento UE e stampa specializzata.

| Novita' | Contenuto rilevante per l'app | Stato | Confidenza | Fonte |
|---|---|---|---|---|
| Legge 25 novembre 2024, n. 177 (GU n. 280 del 29/11/2024, in vigore dal 14/12/2024, 36 articoli) | riforma del CdS: cellulare, neopatentati, assicurazione, ecc. | in vigore | alta sull'esistenza/date, media sui contenuti | https://www.mit.gov.it/comunicazione/news/sicurezza-stradale-e-vigore-il-decreto-con-modifiche-al-codice-della-strada ; https://salerno.aci.it/IMG/pdf/slide_legge_n._177_2024_-_modifiche_al_codice_della_strada_1_.pdf ; https://rivistagiuridica.aci.it/fileadmin/Documenti/2025/Dottrina_e_Approfondimenti/Codice_della_strada_novita_del_quadro_sanzionatorio_1_agosto_2025.pdf |
| Art. 193 (assicurazione) | sanzione 866-3.464 EUR; la mancanza di copertura puo' essere accertata anche incrociando i dati delle polizze con quelli dei rilevatori di infrazioni (es. semafori): meno margine per "dimenticanze" | in vigore | media-alta | https://aci.gov.it/codice-della-strada/art-193/ ; risultati ricerca ACI |
| Cellulare alla guida | sanzione da 250 a 1.000 EUR (prima 165-660) piu' sospensione della patente da 15 giorni a 2 mesi; recidiva nel biennio: 350-1.400 EUR e sospensione 1-3 mesi | in vigore | media | stessa ricerca (ACI/MIT) |
| Neopatentati | limiti di potenza estesi da 1 a 3 anni (75 kW/t; 105 kW per le M1) | in vigore | media | https://rivistagiuridica.aci.it/fileadmin/Documenti/2026/Dottrina_e_Approfondimenti/Limitazioni_per_i_neopatentati_versione_aggiornata.pdf |
| Importi sanzioni | l'adeguamento biennale ISTAT (art. 195 c.3 CdS) e' sospeso per tutto il 2026 (DL 31/12/2025 n. 200, conv. L. 26/2026); non e' noto se sara' prorogato anche per il 2027: importi in configurazione [CONFERMATO e integrato dalla verifica: l'art. 195 c.3 prevede che entro il 1 dicembre di ogni biennio il Ministro della Giustizia fissi i nuovi importi, efficaci dal 1 gennaio successivo; senza una nuova sospensione gli importi potrebbero aumentare dal 1/1/2027 (fonti: ildiritto.it, fleetmagazine.it): rivedere TUTTI gli importi della configurazione dopo il 1/12/2026] | in vigore | media | https://ildiritto.it/amministrativo/sanzioni-stradali-stop-aggiornamento-biennale/ ; https://www.motorionline.com/multe-auto-non-ci-saranno-aumenti-in-arrivo-per-il-2026/ |
| Revisione: controlli OBD e scan tool | dal 2024 verifica via OBD su M1/M2/N1 <= 3,5 t immatricolati dal 1/9/2009 | in vigore | media | https://www.lautomobile.aci.it/come-fare-per/revisione-auto-2024-2025-costi-scadenze-e-novita/ |
| Revisione: pacchetto UE (roadworthiness) | proposta di ispezione annuale oltre i 10 anni, contrastata da Parlamento (commissione TRAN) e Consiglio; non definitiva | in discussione | media | https://www.alvolante.it/news/no-del-consiglio-ue-alla-revisione-annuale-delle-auto-409751 |
| Bollo: D.Lgs. 147/2026 e D.L. 162/2026 | vedi sez. 2 (nuove scadenze dal 2028; esenzione 2027 per auto <= 80 kW) | vigenti con decorrenze; DL in conversione | media | sez. 2 |
| Patente: Direttiva (UE) 2025/2205 | patente 15 anni, digitale; recepimento entro circa novembre 2028 | non ancora applicabile | media | sez. 6 |
| RC auto: Direttiva (UE) 2021/2118 | recepita in Italia; FAQ MIMIT (non letta): https://www.mimit.gov.it/it/assistenza/domande-frequenti/rc-auto-direttiva-ue-2021-2118-domande-frequenti-faq | non verificato nel dettaglio | bassa | link indicato |
| Altre misure della L. 177/2024 (monopattini: contrassegno e assicurazione; alcol/droga; velocita'...) | non verificate in questa sessione; poco rilevanti per un'app di gestione auto | - | bassa | - |

## 11. Template di manutenzione proposto

Un template e' un insieme di voci precaricate per veicolo (modificabili). "Tipo" distingue LEGALE (promemoria di scadenza a data, sezioni 1-7) da INDICATIVO (km/mesi, sez. 9). Per le voci indicative si calcola `min(km, mesi)`. Valori di default da mostrare come "tipico: modifica secondo il libretto".

### 11.1 Voci legali (calcolo a data, non km)

| Voce | Tipo | Regola di calcolo | Preavvisi suggeriti |
|---|---|---|---|
| Revisione | LEGALE | 1a: fine mese (immatricolazione + 48 mesi); poi fine mese (ultima + 24 mesi) | 60 gg, 1o del mese di scadenza, 7 gg, giorno stesso |
| Assicurazione RC | LEGALE | scadenza polizza (inserita); nessun tacito rinnovo | 45, 30, 15, 7, 1, 0 gg |
| Bollo | LEGALE | fine del mese di immatricolazione ogni anno (o mese ACI) | 30 gg, 7 gg, giorno stesso |
| Pneumatici invernali/catene | LEGALE (locale) | 15/11 - 15/4 dove prescritto | 15/10, 8/11, 15/11, 1/4, 15/4 |
| Bombole metano / serbatoio GPL | LEGALE | per tipo (sez. 5) | 90, 30 gg |
| Patente | LEGALE | compleanno nell'anno di scadenza (sez. 6) | 120, 60, 30, 7 gg |
| Passaggio di proprieta' | LEGALE | autentica + 60 gg | 30, 45, 55, 60 gg dopo l'autentica |

### 11.2 Voci indicative (km/mesi)

| Voce | km | mesi | Si applica a | Preavviso |
|---|---|---|---|---|
| Tagliando | 20.000 | 12 | benzina, diesel, ibrida | 1.000 km / 30 gg |
| Tagliando | 30.000 | 24 | elettrica | 1.500 km / 30 gg |
| Olio motore + filtro olio | 15.000 | 12 | benzina, diesel, ibrida | 1.000 km / 30 gg |
| Filtro aria | 30.000 | 24 | benzina, diesel, ibrida | 1.500 km / 30 gg |
| Filtro abitacolo | 15.000 | 12 | tutte | 1.000 km / 30 gg |
| Filtro carburante | 45.000 (diesel) | 36 | diesel | 2.000 km / 30 gg |
| Cinghia distribuzione | 100.000 | 60 | motori a cinghia (valore da libretto) | 5.000 km / 90 gg |
| Liquido freni | - | 24 | tutte | 30 gg |
| Liquido refrigerante | 100.000 | 60 | tutte (elettrica: circuito batteria, da libretto) | 5.000 km / 60 gg |
| Batteria 12 V (controllo) | - | 12 dopo il 4o anno | tutte | 30 gg |
| Pastiglie freni (controllo) | 30.000 | - | tutte | 2.000 km |
| Dischi freni (controllo) | 60.000 | - | tutte | 3.000 km |
| Candele | 45.000 | 48 | benzina | 2.000 km / 30 gg |
| Inversione pneumatici | 12.000 | - | tutte | 1.000 km |
| Controllo eta' pneumatici (DOT) | - | 60 | tutte | 60 gg |
| Olio cambio | 90.000 | 72 | cambio automatico/DSG; manuale a seconda del libretto | 5.000 km / 90 gg |
| Spazzole tergicristallo | - | 12 | tutte | 30 gg |
| Climatizzatore (sanificazione) | - | 24 | tutte | 30 gg |
| Pressione pneumatici (controllo) | - | 1 | tutte | - |

### 11.3 Avvertenza per i template

"Gli intervalli di manutenzione proposti sono valori tipici indicativi e non obblighi di legge. Segui il libretto di uso e manutenzione della tua auto e le indicazioni dell'officina; l'app ti ricorda la scadenza che prima si verifica tra chilometri e mesi."

## 12. Riepilogo gap e punti a confidenza bassa

Budget di ricerca: 35 chiamate WebSearch/WebFetch utilizzate (limite rigido raggiunto). Normattiva/Brocardi non consultabili (la pagina non restituisce il testo degli articoli): i testi di legge sono stati letti attraverso ACI (aci.gov.it/codice-della-strada) quando possibile.

Da verificare prima di rilasciare la funzione corrispondente (priorita' decrescente):

1. Revisione: regola precisa per revisioni molto anticipate o tardive; auto importate (4 anni dalla prima immatricolazione estera o italiana?); esito "ripetere" (termine, di norma 30 giorni); revisione ultratrentennali/storici. [bassa-media]
2. Bollo: (a) conversione in legge del D.L. 162/2026 e dettagli (moto, ibride, superbollo, requisiti); (b) testo del D.Lgs. 147/2026 in GU; (c) regola esatta dei rinnovi e delle eccezioni regionali (Lombardia/Piemonte, quadrimestrali); (d) tabella ravvedimento (percentuali ACI non verificate sul testo di legge regionale); (e) esenzioni EV per ogni Regione (le leggi regionali cambiano); (f) veicoli storici 20-29 anni; (g) servizio ufficiale di verifica pagamento per targa; (h) slittamento festivi. [media/bassa]
3. RC auto: lettura del testo vigente dell'art. 170-bis (tolleranza 15 giorni) su Normattiva; regole sull'uso dell'attestato oltre i 15 giorni; riduzione sanzione art. 193 se si regolarizza entro 30 giorni (meta' o un quarto?); URL del servizio "Verifica copertura RCA". [media/bassa]
4. Pneumatici: testo art. 237 Reg. (1,6 mm), soglia consigliata invernali (3/4 mm), circolare MIT 1049/2014 (invernali con indice inferiore; periodo fino al 15/5 o 15/4?; adesivo), limite di eta' (nessuno trovato). [media/bassa]
5. Bombole: testo del DM 13/5/2022; GPL (sostituzione vs revisione dopo 10 anni); convenzione fine mese/giorno. [media]
6. Patente: art. 126 (soglie esatte 50/70/80, regola della scadenza al compleanno, sanzione patente scaduta, finestra di rinnovo, validita' certificato medico); applicabilita' del limite neopatentati a 3 anni alle patenti precedenti il 14/12/2024. [media/bassa]
7. Passaggio di proprieta': art. 94 CdS (aggiornamento DU, notifica di vendita, sanzioni) e responsabilita' solidale del venditore. [bassa]
8. Limitazioni ambientali, bollino blu, ZTL: ordinanze regionali/comunali 2026-27 (Euro 5 diesel discordante). [bassa]
9. Manutenzione: intervalli da verificare su manuali di costruttori reali per i modelli target; per EV/ibride specificita'. [media/bassa]
10. Altre modifiche L. 177/2024 non lette (monopattini, alcol/droga ecc.); sorveglianza sull'eventuale proroga del congelamento sanzioni oltre il 2026. [bassa]

Principi di implementazione che riducono il rischio legale:
- ogni scadenza deve poter essere sovrascritta manualmente dalla data letta sul documento ufficiale;
- ogni regola vive in una tabella con `validFrom`, `validTo`, `source`, `confidence`, `lastVerified`;
- mostrare sempre l'avvertenza della voce (testi forniti in ciascuna sezione) e un link al servizio ufficiale;
- non mostrare mai importi di sanzioni o bollo come "dovuti": solo come "indicativi";
- aggiungere un job periodico (manuale) di rilettura delle fonti ogni 6 mesi e prima di ogni rilascio.

## Esito verifica

Verifica scettica indipendente del 2026-10-07. Metodo: 25 chiamate web nuove (WebSearch/WebFetch) piu' lettura di copie locali, scaricate in precedenza nella cartella di lavoro della sessione, di fonti primarie (Normattiva: D.Lgs. 285/1992 art. 80; Agenzia delle Entrate: ravvedimento; ACI: "Bollo auto: dove, come e quando si paga" del 28/08/2026) e del testo di legge su Brocardi (art. 94, 126, 170-bis Cod. Ass., 193). Tutti i vettori di test sono stati ricalcolati sia a mano sia con uno script Node indipendente (non riusando le funzioni del ricercatore per i casi corretti): salvo quelli indicati sotto, i risultati coincidono con gli attesi.

### Confermato (verificato su fonte primaria o ufficiale)

- Revisione: art. 80 c.3 "entro quattro anni dalla data di prima immatricolazione e successivamente ogni due anni" (Normattiva); c.4 annuale per >9 posti, merci/rimorchi >3,5 t, taxi, autoambulanze, NCC, atipici; c.14 sanzioni 173-694 EUR (raddoppiabile), 1.998-7.993 EUR + fermo 90 giorni per chi circola da sospeso (+ confisca se reiterato); c.17 attestazione falsa 430-1.731 EUR + ritiro carta; c.5 e c.7 revisione singola. MIT: revisioni successive "entro il mese corrispondente a quello in cui e' stata effettuata l'ultima revisione"; tariffa Motorizzazione 45,00 EUR (PagoPA N046) e circa 79 EUR nei centri privati.
- Vettori R1-R9: confermati (4+2, fine mese, 29/02 negli anni bisestili, R4, R6).
- Bollo: primo pagamento entro il mese di immatricolazione; ultimi 10 giorni -> mese successivo; Lombardia/Piemonte mese successivo (ACI 28/08/2026); D.Lgs. 147/2026 (GU n. 185 dell'11/8/2026, S.O. n. 30, in vigore dal 12/8/2026) e regole 2028 (primo pagamento fine mese successivo, rinnovi fine mese di immatricolazione, veicoli immatricolati fino al 31/12/2027 invariati); D.L. 17/9/2026 n. 162 (GU n. 216, art. 2; esenzione 2027 per auto <= 80 kW, solo per versamenti dal 1/1 al 31/12/2027; 2.293,5 mln alle Regioni); fasce di ravvedimento 1,25% / 1,39% / 3,125% (AdE: 1/10, 1/9, 1/8 del minimo); interesse legale 1,60% dal 1/1/2026 e formula imposta x tasso x giorni / 36500 (AdE). Vettori B1-B8, B10, B12 (aritmetica; 31/5/2026 e' domenica).
- RC auto: art. 170-bis c.1 (testo letto): garanzia del vecchio contratto "non oltre il quindicesimo giorno successivo alla scadenza", preavviso di almeno 30 giorni, nessun tacito rinnovo; art. 193 c.2 sanzione 866-3.464 EUR; c.2-bis recidiva (raddoppio, sospensione patente 1-2 mesi, fermo); vettori A1-A8 (A2: 2025-02-28 e 2025-03-15; A8: 24/1, 8/2, 23/2, 3/3, 9/3, 10/3).
- Pneumatici: montaggio dal 15/10, periodo 15/11-15/4 solo dove c'e' ordinanza, fino al 15/5 per invernali con indice inferiore (min Q, circolare MIT 1049 del 17/1/2014), sanzioni 87-344 EUR (art. 6) e 42-173 EUR (art. 7); vettori T1-T7 (DOT 1219 -> 2019-03-19, 7,55 anni; DOT 4524 -> 2024-11-04, 1,92 anni).
- Patente: struttura 10/5/3/2 anni (art. 126 c.2, c.6); certificato medico non anteriore a 3 mesi (media); L. 177/2024: neopatentati 3 anni, 75 kW/t, 105 kW (M1).
- Passaggio di proprieta': 60 giorni dalla data di autentica (art. 94 c.1); S1-S4 corretti.
- Sanzioni ISTAT sospese per tutto il 2026 (DL 200/2025 conv. L. 26/2026).
- Aritmetica dei vettori sulle bombole (G1-G6), manutenzione (M1-M6) e antismog (L1-L3): corretta (le regole sottostanti restano a confidenza media/bassa).

### Corretto

1. PATENTE, errore di calcolo (il piu' grave): la scadenza e' il primo compleanno successivo alla scadenza ordinaria (rinnovo + N anni), non il compleanno dell'anno rinnovo + N. Funzione riscritta; P5 diventa 2038-02-28 (non 2037-02-28); nuovi controesempi P9 (2037-04-12) e P10 (2032-03-10). La regola vale solo per patenti A/B con scadenza ordinaria (esclusi C/D/CQC e rinnovi con visita medica locale/specialistica: P4 [DA VERIFICARE]).
2. Neopatentati: i limiti a 3 anni si applicano solo alle patenti conseguite dal 14/12/2024; prima vale 1 anno (`neopatentatoUntil` corretta).
3. Patente scaduta: sanzione art. 126 c.11 = 158-638 EUR + ritiro (non 173-694). Omissioni: esperimento di guida se scaduta da oltre 5 anni (c.8-ter), permesso provvisorio (c.8-bis).
4. BOLLO, termini di rinnovo: per ACI il rinnovo si paga entro l'ultimo giorno del mese SUCCESSIVO a quello di scadenza del bollo precedente. Il campo di override va chiamato "mese di pagamento": se l'utente inserisse il "mese di scadenza" ACI, il termine slitterebbe di un mese (B13 corretto). Province di Trento e Bolzano aggiunte (primo pagamento nel mese successivo per tutti; codice e vettore B14).
5. Ravvedimento: giornaliero 0,0833% (giorni/12) e non 0,08% (B9 = 1,67 EUR, non 1,60); oltre 1 anno 1/7 di 25% = 3,57% (AdE) e non 3,75% (B11 = 7,14 EUR) [DA VERIFICARE se le Regioni applicano il valore ACI].
6. D.L. 162/2026: requisito omesso, veicolo regolarmente assicurato; un solo veicolo (auto, moto o ciclomotore) per persona fisica; speciali/autonome solo previo accordo; conversione entro il 16/11/2026.
7. Revisione: esito "ripetere" = nuova revisione entro un mese (non "30 giorni"); "sospeso" = circolazione in giornata verso il meccanico a max 40 km/h; la regola "entro il mese" e' prassi MIT e non testo di legge (art. 80 c.3 non la contiene; MIT: "mese di rilascio della carta di circolazione" per la prima); "dal 2003" vale per motoveicoli e ciclomotori.
8. RC auto: durata "annuale o anno piu' frazione" (non inferiore); preavviso di almeno 30 giorni = obbligo di legge, non prassi; art. 193 c.3: riduzione ALLA META' (433-1.732 EUR) se la copertura e' operante nei 15 giorni successivi al termine dell'art. 1901 c.2 c.c. (cioe' circa 30 giorni dalla scadenza) e anche se si demolisce entro 30 giorni dalla contestazione.
9. Passaggio di proprieta': l'art. 94 prevede sanzioni 727-3.629 EUR (c.3) e 363-1.813 EUR (c.4); il testo letto non prevede la "notifica di vendita" del venditore.
10. Pneumatici: aggiunte le "calze" UNI EN 16662-1:2020.

### Smentito

- [SMENTITO] "contratto RC auto di durata ... inferiore a richiesta" (art. 170-bis: annuale o anno piu' frazione).
- [SMENTITO] "patente scaduta: ricordo 173-694 EUR" (158-638 EUR).
- [SMENTITO] la variante "riduzione a un quarto" dell'art. 193 (e' la meta').
- [SMENTITO] la formula della funzione `patenteExpiry` (compleanno dell'anno rinnovo + N) e il vettore P5.

### Da verificare (non risolto da questa verifica)

- Bollo: prescrizione triennale (non letta su fonte primaria); esistenza di una rateizzazione "in quattro rate" dal 2028 (fiscoetasse la riporta, il ricercatore dice che non cambia); eventuali regole regionali sul ravvedimento oltre un anno; conversione in legge e dettagli del D.L. 162/2026; slittamento festivo (solo fonti secondarie: media).
- Revisione: revisione eseguita in ritardo (stesso calcolo?); auto importate (4 anni dalla prima immatricolazione estera o italiana); veicoli storici/ultratrentennali; formula esatta "entro il mese" nelle circolari MIT.
- Patente: soglie esatte a 50 e 70 anni nel giorno del compleanno ("ha superato" vs "fino al compimento"; P6); finestra di anticipo del rinnovo; rinnovo ultraottantenni via commissione medica e regola del compleanno (P4); coincidenza compleanno/scadenza ordinaria; clamp del 29/02.
- Bombole: data di riferimento del serbatoio GPL (costruzione vs immatricolazione/installazione) e intervallo CNG4 (4 anni o 2 anni dopo la prima riqualificazione); nessun testo del DM 13/5/2022 letto.
- Non verificati affatto in questa verifica (restano alle confidenze originali): direttiva (UE) 2025/2205; pacchetto UE roadworthiness; art. 237 Reg. (1,6 mm) e soglie consigliate di battistrada/DOT; limitazioni antismog e bollino blu; attestato di rischio (5 anni, dematerializzazione); regola del bonus-malus; Reg. UE 461/2010 e garanzia; importi/regole delle esenzioni regionali EV e dei veicoli storici; intervalli di manutenzione (sez. 9 e 11).
- Importi delle sanzioni: gli importi possono cambiare dal 1/1/2027 (ISTAT, art. 195 c.3) se non verra' prorogata la sospensione: rivederli dopo il 1/12/2026.

### Fatti importanti omessi dal ricercatore

- Requisito dell'assicurazione in regola per l'esenzione bollo 2027 (D.L. 162/2026, art. 2).
- Distinzione "scadenza del bollo" (fine periodo) vs "termine di versamento" (fine del mese successivo): rischio di errore di un mese nel campo di override.
- Regola del compleanno della patente: solo A/B con scadenza ordinaria, dal 17/9/2012; esperimento di guida oltre 5 anni di scadenza; permesso provvisorio di guida.
- Revisione "sospeso": 40 km/h e circolazione solo in giornata; confisca amministrativa in caso di reiterazione della circolazione da sospeso.
- Art. 193 c.3: riduzione alla meta' anche per demolizione entro 30 giorni dalla contestazione; obbligo di preavviso di 30 giorni della compagnia (art. 170-bis).
- Art. 94: sanzioni per mancata richiesta di aggiornamento (727-3.629 EUR e 363-1.813 EUR); Trento e Bolzano per il primo bollo; calze antisdrucciolevoli UNI EN 16662-1:2020 per gli pneumatici.
- Conversione in legge del D.L. 162/2026 entro il 16/11/2026.
