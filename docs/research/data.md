# Ricerca: livello dati e motore promemoria (local-first)

Data: 2026-10-07. Progetto: AutoGarage (Expo SDK 57 / RN 0.86, expo-sqlite, TypeScript). Documento di PROGETTAZIONE: le parti marcate "verificato" hanno URL; il resto e' una proposta di design (confidenza indicata).

## Sintesi

Progetto completo del livello dati e del motore promemoria di AutoGarage, **eseguito e testato** (240 controlli automatici passati: Node 24.19, SQLite 3.53.3). Cinque verifiche web per i punti incerti (sezione 0) e per il resto progettazione.

- **Schema** (sezione 1): 28 tabelle, 74 indici, 23 trigger, 3 viste, tutto `STRICT`, ULID, date di calendario, istanti UTC, centesimi, km interi, soft delete e cascata. Una sola tabella dei km con coerenza monotona garantita da trigger; regola/storico/occorrenza separati; polizze con garanzie e rate; allegati con un solo genitore e coda di cancellazione dei file; telemetria in forma stretta (25 byte/riga misurati).
- **Migrazioni** (sezione 2): runner transazionale con checksum, copia `VACUUM INTO`, rifiuto di DB piu' nuovi, ricetta di ricostruzione tabella provata, seed dei cataloghi (27 template indicativi, 13 categorie) con upsert idempotente.
- **Motore** (sezione 3): "il primo dei due", media km/giorno robusta con pochi dati, stati, snooze, completamento che ricalcola, serie di calendario (bollo, gomme), ricorrenze ancorate, ora legale; 53 vettori di test (e un bug di arrotondamento trovato e corretto).
- **Notifiche** (sezione 4): solo trigger `DATE`, finestra di 60 sotto il tetto iOS di 64, sentinella, diff idempotente, permessi, Android senza allarmi esatti.
- **Backup/privacy/unita'/architettura** (sezioni 5-8): ZIP+JSON+CSV con import transazionale e LWW; niente cloud in v1 (backup su cartella utente in v1.x); niente SQLCipher in v1 con motivazione; blocco app biometrico come gate di interfaccia; parsing e formattazione senza float; strati con regole di dipendenza verificate.
- **Non verificato** (elencato in "Domande aperte"): comportamento su dispositivi reali (notifiche, Hermes), versione SQLite di `expo-sqlite`, parere legale, valori reali dei template.


## 0. Verifiche web (cose incerte)

Cinque verifiche web (budget esaurito), piu' controlli `npm view` del 2026-10-07. Tutto il resto del documento e' progettazione; dove un'affermazione non e' verificata lo dico ("confidenza media/bassa").

### V1. SQLCipher con expo-sqlite  `[confidenza: alta sul come, media sulle conseguenze operative]`

- Si abilita con `useSQLCipher: true` nel config plugin di `expo-sqlite` (app.json) e poi `npx expo prebuild`; supportato su Android, iOS e macOS; **non** funziona in Expo Go (serve dev build/EAS). La chiave si imposta subito dopo l'apertura: `await db.execAsync("PRAGMA key = 'password'")`.
- Il supporto web di `expo-sqlite` e' ancora **alpha** (wasm, richiede header COOP/COEP e config Metro): per la UI sul PC Windows non e' una base affidabile e non ha SQLCipher. Conseguenza: sul PC si usa un adattatore diverso (`node:sqlite` per i test, in-memory/sql.js per la UI web), e il codice dati deve passare da una porta `SqlDatabase` (sezione 8).
- `expo-sqlite` 57.0.4 (npm, 2026-10-07). API utili alle migrazioni: `PRAGMA user_version`, `execAsync`, `withTransactionAsync`, `withExclusiveTransactionAsync`, `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`.
- Non verificato in questa sessione (da SQLCipher/Expo, confidenza media): passare da DB in chiaro a DB cifrato richiede `sqlcipher_export` verso un nuovo file; l'API `backupDatabaseAsync` di expo-sqlite esiste da qualche SDK ma non l'ho riverificata.
- Fonte: https://docs.expo.dev/versions/latest/sdk/sqlite/

### V2. Limiti delle notifiche locali (expo-notifications 57.0.22)  `[confidenza: alta sui limiti, media sull'esecuzione reale]`

- Trigger multipiattaforma: `DATE` (istante assoluto) e `TIME_INTERVAL`. `DAILY/WEEKLY/MONTHLY/YEARLY` sono **solo Android**; `CALENDAR` e' **solo iOS**. Decisione: usare solo trigger `DATE` calcolati dal dominio, cosi' il comportamento e' identico su tutte e due le piattaforme e testabile.
- iOS: massimo **64** notifiche locali pendenti; le eccedenti vengono scartate in silenzio.
- Android 13+: permesso runtime `POST_NOTIFICATIONS`; canali obbligatori da Android 8 (`setNotificationChannelAsync`); `SCHEDULE_EXACT_ALARM` serve solo per allarmi esatti (Android 12+). Le schedulate sopravvivono al riavvio perche' il modulo dichiara `RECEIVE_BOOT_COMPLETED`.
- Le notifiche **locali** funzionano in Expo Go; il push remoto su Android no, da SDK 53 (irrilevante: non usiamo push).
- Su iOS i trigger calendario accettano `timezone`; non e' documentato il comportamento sull'ora legale. Decisione: nessun trigger ricorrente nativo, solo `DATE` ricalcolati (sezione 3.8 e 4).
- Non verificato (confidenza media): Android limita a circa 500 allarmi concorrenti per app; un force-stop dell'utente cancella gli allarmi fino alla riapertura dell'app; `scheduleNotificationAsync` con `identifier` gia' esistente sostituisce la richiesta (comportamento iOS noto; su Android da testare).
- Fonte: https://docs.expo.dev/versions/latest/sdk/notifications/

### V3. Task in background (expo-background-task 57.0.21)  `[confidenza: alta]`

- iOS `BGTaskScheduler`, Android `WorkManager`. Intervallo minimo 15 minuti, default 12 ore, **nessuna garanzia** di esecuzione ("il sistema decide"); su Android il comportamento varia per produttore (dontkillmyapp.com); il simulatore iOS non lo supporta; se l'utente chiude l'app dallo switcher su iOS i task non girano piu' finche' non la riapre. Richiede `UIBackgroundModes: processing` e `BGTaskSchedulerPermittedIdentifiers` (gestiti da CNG/prebuild). Funziona in Expo Go.
- Decisione: il task in background e' solo un bonus; la ripianificazione avviene a ogni apertura/foreground e dopo ogni modifica dei dati (sezione 4).
- Fonte: https://docs.expo.dev/versions/latest/sdk/background-task/

### V4. Chiavi e biometria con expo-secure-store 57.0.4  `[confidenza: alta]`

- Valori: alcuni rilasci iOS rifiutano valori oltre ~2048 byte (basta per una chiave da 32 byte in hex). `requireAuthentication` **invalida i dati se l'utente cambia le biometrie**. Android: chiavi nel Keystore, **non sopravvivono alla disinstallazione**. iOS: Keychain, i dati **persistono alla disinstallazione** con lo stesso bundle id. Opzioni `keychainAccessible`: `WHEN_UNLOCKED` (default), `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `AFTER_FIRST_UNLOCK`, `ALWAYS_THIS_DEVICE_ONLY` (e varianti, non tutte elencate nella pagina letta).
- Conseguenze di design: la chiave DB (se mai usata) non va legata a `requireAuthentication`; il blocco app e' un gate di UI separato; un task in background con telefono bloccato non puo' leggere una chiave `WHEN_UNLOCKED`.
- Fonte: https://docs.expo.dev/versions/latest/sdk/securestore/

### V5. RC auto: "tolleranza di 15 giorni"  `[confidenza: media]`

- L'art. 170-bis del Codice delle Assicurazioni (citato dai risultati di ricerca) impone all'impresa di mantenere operante, **non oltre il quindicesimo giorno dopo la scadenza**, la garanzia del contratto precedente **fino all'effetto della nuova polizza**: e' un ponte quando si cambia compagnia, non una proroga gratuita. Il tacito rinnovo e' abolito dal 1 gennaio 2013 (DL 179/2012, L. 221/2012). Le fonti sono giornalistiche/assicurative, non il testo di legge ne' IVASS.
- Decisione: la scadenza mostrata e il promemoria usano **la data di fine polizza**, senza tolleranza; la tolleranza compare solo come nota informativa ("possibile copertura ponte fino a 15 giorni solo se stipuli la nuova polizza: non fare affidamento"). Nessuna regola hard-coded.
- Fonti: https://www.sicurauto.it/guide-utili/assicurazioni/tacito-rinnovo-e-tolleranza-di-15-giorni-dopo-la-scadenza/ , https://www.cheautocompro.it/motori-news/attualita/rc-auto-la-tolleranza-torna-15-giorni , https://www.sicurauto.it/news/codice-della-strada/rca-auto-scaduta-periodo-di-comporto-e-sanzioni/

### Versioni npm verificate (2026-10-07)

`expo-sqlite` 57.0.4, `expo-notifications` 57.0.22, `expo-background-task` 57.0.21, `expo-task-manager` 57.0.21, `expo-secure-store` 57.0.4, `expo-local-authentication` 57.0.3, `expo-file-system` 57.0.7, `expo-sharing` 57.0.22, `expo-document-picker` 57.0.3, `expo-crypto` 57.0.3, `expo-screen-capture` 57.0.4, `fflate` 0.8.3, `react-native-zip-archive` 9.5.2, `ulid` 3.0.2, `zod` 4.6.5, `drizzle-orm` 0.45.3, `dependency-cruiser` 18.5.0. Node 24.19.0 locale con `node:sqlite` (SQLite 3.53.3): usato per validare il DDL e gli esempi di questo documento.

## 1. Schema SQLite (DDL)

Il DDL qui sotto e' **eseguito e testato** (Node 24.19, `node:sqlite`, SQLite 3.53.3, 89 controlli tutti passati: vedi 1.4). In produzione gira su `expo-sqlite` 57.0.4: verificare con `select sqlite_version()` che sia >= 3.37 (serve per `STRICT`); se non lo fosse basta togliere la parola `STRICT` dalle `CREATE TABLE`, il resto non cambia (confidenza media: la versione SQLite inclusa in expo-sqlite non e' stata verificata).

### 1.1 Convenzioni (valgono per tutte le tabelle)

| Tema | Regola | Perche' |
|---|---|---|
| Chiavi | `id TEXT` = **ULID** di 26 caratteri generato nell'app (`CHECK (length(id)=26)`); i cataloghi (`service_templates`, `expense_categories`) usano slug con prefisso (`tpl_`, `sys_`) | ordinabile per tempo, nessun contatore, nessuna collisione fra dispositivi (sync futura), nessun bisogno di server |
| Date di calendario | `TEXT 'YYYY-MM-DD'` con `CHECK (date(x) IS x)` (rifiuta 2026-02-30 e 2026-10-7). Nessun fuso. Suffisso `_on` | "scade il 30/11" e' un giorno, non un istante: l'aritmetica sui giorni non puo' rompersi con ora legale e viaggi |
| Istanti | `TEXT` UTC ISO con millisecondi `'YYYY-MM-DDTHH:MM:SS.mmmZ'` con `CHECK (strftime(...) IS x)` (rifiuta l'istante senza millisecondi). Suffisso `_at` | solo per audit, sessioni OBD, snooze, notifiche |
| Denaro | `INTEGER` **centesimi di euro** (`*_cents`), `CHECK` 0..1e11; prezzo/litro in **millesimi di euro** (`unit_price_milli`, 1,859 EUR/L = 1859); nessuna colonna `currency` in v1 | niente float; i distributori italiani espongono 3 decimali |
| Distanze | `INTEGER` **km** (canonico), `CHECK` 0..2.000.000; la preferenza km/mi e' solo di visualizzazione (`vehicles.distance_unit`) | un solo formato nel DB; round-trip mi->km->mi esatto sugli interi (vedi sezione 7) |
| Quantita' | `INTEGER` in millesimi dell'unita' (`quantity_milli`: ml se L, Wh se kWh, g se kg) | niente float |
| Booleani | `INTEGER NOT NULL DEFAULT x CHECK (x IN (0,1))` | STRICT non ha BOOLEAN |
| Enumerazioni | stringhe inglesi in `CHECK (... IN (...))`; le etichette italiane stanno nell'i18n della UI | enum chiuse e stabili; per insiemi aperti (categorie spese, template) tabelle di catalogo |
| Audit | `created_at`, `updated_at` (trigger `trg_<tabella>_touch` li aggiorna **solo se il codice non li ha toccati**, cosi' l'import preserva i timestamp), `deleted_at` | base per sync LWW e per il cestino |
| Soft delete | `deleted_at` sulle entita' visibili all'utente (veicolo, intervento, rifornimento, spesa, polizza, promemoria, allegato, ...). Le righe figlie "di dettaglio" (`service_lines`, `insurance_coverages`, `telemetry_*`) si cancellano davvero. Indici e viste filtrano `deleted_at IS NULL` | cestino 30 giorni; "Elimina definitivamente" = `DELETE` fisico + cascata + coda file |
| Integrita' | `PRAGMA foreign_keys=ON` ad ogni connessione, `ON DELETE CASCADE` dai figli al veicolo, `SET NULL` per riferimenti "morbidi" (officina, adattatore) | cancellare un veicolo non lascia orfani (testato) |
| Tipi | `STRICT` ovunque (rifiuta `'abc'` in una colonna INTEGER, testato) | |

PRAGMA da eseguire all'apertura di **ogni** connessione (app e task in background):

```sql
PRAGMA foreign_keys = ON;      -- per connessione, fuori da transazioni
PRAGMA journal_mode = WAL;     -- persistente nel file; letture concorrenti al task in background
PRAGMA synchronous = NORMAL;   -- sicuro con WAL
PRAGMA busy_timeout = 5000;    -- app e background task condividono il file
PRAGMA secure_delete = ON;     -- GDPR: le pagine cancellate vengono azzerate
```

### 1.2 Mappa delle tabelle

| Area | Tabelle | Note di design |
|---|---|---|
| Infrastruttura | `migrations_log`, `app_settings` | versione schema in `PRAGMA user_version`, log con checksum; impostazioni chiave -> JSON |
| Veicoli | `vehicles`, `obd_adapters` | targa/VIN normalizzati maiuscoli senza spazi (unici fra i non cancellati); alimentazione primaria + secondaria (bifuel GPL/metano molto comune in Italia); `powertrain` per filtrare i template; `status` active/sold/scrapped/archived |
| Km | `odometer_readings` | **unica fonte dei km**: i rifornimenti, gli interventi, i controlli livelli e le sessioni OBD creano una lettura collegata (FK + indice unico); coerenza monotona garantita da trigger fra giorni diversi; `status='ignored'` esclude una lettura sbagliata senza perderla |
| Interventi | `workshops`, `service_records`, `service_lines` | una sola tabella righe per lavorazioni, ricambi, fluidi e spese accessorie (`line_type`), con `part_code`, `spec` (es. "5W-30 ACEA C3"), `fluid_kind`; il totale pagato sta sul record, le righe sono il dettaglio facoltativo |
| Regole | `service_templates` (catalogo da codice), `maintenance_items`, `maintenance_completions`, `reminders`, `notification_schedule` | **tre concetti separati**: la *regola* (item), lo *storico* (completions: log append-only, "ultimo fatto" = ultima riga) e l'*occorrenza* (reminder: un solo aperto per item, porta snooze/stato/cache di previsione) |
| Assicurazione | `insurance_policies`, `insurance_coverages`, `insurance_payments` | polizza + garanzie (massimale/franchigia/scoperto per garanzia) + rate; il premio annuale e' sempre materializzato in almeno una rata |
| Carburante e spese | `fuel_logs`, `expenses`, `expense_categories`, vista `v_costs` | i costi di interventi, rifornimenti, spese e rate pagate **non si duplicano**: la vista `v_costs` li unisce |
| Livelli | `fluid_checks` | olio/refrigerante/freni/lavavetri/AdBlue: `ok / low / topped_up / high`, `added_ml` solo se rabbocco |
| Pneumatici | `tyre_sets`, `tyre_fitments` | set con misura scomposta (serve per la regola "indice di velocita' inferiore al libretto"), DOT in JSON, montaggi con km (km montati = somma dei montaggi); FK composta `(tyre_set_id, vehicle_id)` e un solo set montato per veicolo |
| File | `attachments`, `pending_file_deletions` | metadati nel DB, file in `attachments/<ULID>.<ext>` nello storage dell'app; un genitore al massimo per allegato; **outbox** `pending_file_deletions` riempita da trigger: se l'app muore dopo il `DELETE` il file viene comunque rimosso al prossimo avvio |
| OBD | `obd_sessions`, `telemetry_samples`, `telemetry_rollups`, `dtc_events` | campioni in forma stretta con chiavi intere (25 byte/riga misurati contro 57 con chiavi testuali); rollup a 60 s per la retention |

Scelte che meritano una motivazione:

1. **Date vs istanti**: tutta la logica dei promemoria lavora su date di calendario, quindi ora legale e fusi orari entrano solo nello strato notifiche (sezione 3.8 e 4).
2. **Una sola tabella km**: evita le tre copie divergenti di "km all'intervento / al rifornimento / alla lettura" che hanno le app concorrenti; la media km/giorno e la coerenza si calcolano in un solo posto.
3. **item / completion / reminder**: ricalcolare "il prossimo" alla chiusura diventa "inserisci un completamento e riconcilia": nessuna data viene sovrascritta, l'annulla e' un soft delete del completamento.
4. **Costi non duplicati**: un tagliando da 210 EUR non deve diventare anche una riga in `expenses`.
5. **`CHECK` al posto delle tabelle enum**: aggiungere un valore a un `CHECK` in SQLite richiede la ricostruzione della tabella (vedi ricetta in sezione 2.3); e' accettabile perche' gli insiemi (fonti km, tipi di carburante, stati) sono chiusi e stabili.
6. **Colonne cache** (`reminders.forecast_on`, `effective_due_on`, `due_trigger`, `computed_at`, `forecast_confidence`) sono derivate dal motore: si ricostruiscono sempre, sono nel file di backup solo perche' servono a rispettare i `CHECK`, ma dopo l'import vengono **sempre ricalcolate** (sezione 5.2).
7. **Targa e VIN** vivono solo in `vehicles` (dati personali, sezione 6); le sessioni OBD registrano solo `vin_matches` (0/1), non il VIN letto.

### 1.3 Migrazione 0001 (codice eseguito e testato)

File `src/data/db/migrations/0001_init.ts` (in TypeScript basta aggiungere i tipi; qui e' `.mjs` perche' testato con Node). Gli helper (`ID`, `D`, `T`, `KM`, `CENTS`, `B`, `JSONC`, `REF`, `AUDIT`) espandono in SQL letterale: ad esempio `D('start_on', true)` diventa `start_on TEXT NOT NULL CHECK (date(start_on) IS start_on)`.

```js

// src/data/db/migrations/0001_init.ts  (nel progetto: stesso testo + tipo Migration)
// Helper che espandono in SQL letterale. Tutti gli ID sono ULID (26 char), le date di calendario
// sono 'YYYY-MM-DD' (nessun fuso), gli istanti sono UTC ISO 'YYYY-MM-DDTHH:MM:SS.mmmZ'.

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const ISO = (c) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${c}) IS ${c}`;

const ID = (c = 'id') => `${c} TEXT NOT NULL PRIMARY KEY CHECK (length(${c}) = 26)`;
const REF = (c, table, onDelete = 'CASCADE', req = true) =>
  `${c} TEXT${req ? ' NOT NULL' : ''} REFERENCES ${table}(id) ON DELETE ${onDelete}`;
const D = (c, req = false) => `${c} TEXT${req ? ' NOT NULL' : ''} CHECK (date(${c}) IS ${c})`; // data di calendario
const T = (c, req = false) => `${c} TEXT${req ? ' NOT NULL' : ''} CHECK (${ISO(c)})`; // istante UTC
const B = (c, def = 0) => `${c} INTEGER NOT NULL DEFAULT ${def} CHECK (${c} IN (0, 1))`;
const KM = (c, req = false) => `${c} INTEGER${req ? ' NOT NULL' : ''} CHECK (${c} BETWEEN 0 AND 2000000)`;
const CENTS = (c, req = false, def = '') =>
  `${c} INTEGER${req ? ' NOT NULL' : ''}${def} CHECK (${c} BETWEEN 0 AND 100000000000)`;
const JSONC = (c, req = false, def = '') =>
  `${c} TEXT${req ? ' NOT NULL' : ''}${def} CHECK (${c} IS NULL OR json_valid(${c}))`;
const AUDIT = `created_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('created_at')}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('updated_at')}),
  deleted_at TEXT CHECK (${ISO('deleted_at')})`;
const AUDIT_NOSOFT = `created_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('created_at')}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('updated_at')})`;

export const TOUCH_TABLES = [
  'vehicles', 'workshops', 'service_records', 'service_lines', 'maintenance_items', 'maintenance_completions',
  'insurance_policies', 'insurance_coverages', 'insurance_payments', 'reminders', 'fuel_logs', 'expenses',
  'expense_categories', 'fluid_checks', 'tyre_sets', 'tyre_fitments', 'attachments', 'obd_adapters',
  'obd_sessions', 'dtc_events',
];
export const touchTrigger = (t) =>
  `CREATE TRIGGER trg_${t}_touch AFTER UPDATE ON ${t} WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE ${t} SET updated_at = ${NOW} WHERE id = NEW.id; END`;

export const up = [
  // ---------------------------------------------------------------- infrastruttura
  `CREATE TABLE migrations_log (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  app_version TEXT,
  applied_at TEXT NOT NULL DEFAULT (${NOW})
) STRICT`,

  `CREATE TABLE app_settings (
  key TEXT NOT NULL PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (${NOW}) CHECK (${ISO('updated_at')})
) STRICT`,

  // ---------------------------------------------------------------- cataloghi (seed da codice, id = slug)
  `CREATE TABLE service_templates (
  id TEXT NOT NULL PRIMARY KEY CHECK (id GLOB 'tpl_*'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  name_it TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('legal','maintenance','check','tyres','other')),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('interval_last_done','interval_calendar','fixed_date')),
  interval_km INTEGER CHECK (interval_km BETWEEN 100 AND 1000000),
  interval_months INTEGER CHECK (interval_months BETWEEN 1 AND 240),
  period_end TEXT NOT NULL DEFAULT 'exact' CHECK (period_end IN ('exact','end_of_month')),
  anchor_month INTEGER CHECK (anchor_month BETWEEN 1 AND 12),
  anchor_day INTEGER CHECK (anchor_day BETWEEN 1 AND 31),
  soon_days INTEGER NOT NULL DEFAULT 30 CHECK (soon_days BETWEEN 0 AND 365),
  soon_km INTEGER NOT NULL DEFAULT 1500 CHECK (soon_km BETWEEN 0 AND 100000),
  ${JSONC('notify_offsets_days', true, " DEFAULT '[30,7,0]'")},
  ${JSONC('applies_to')},
  ${B('default_enabled', 1)},
  ${B('is_indicative', 1)},
  note_it TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  CHECK (schedule_type <> 'interval_last_done' OR interval_km IS NOT NULL OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'interval_calendar' OR interval_months IS NOT NULL),
  CHECK ((anchor_month IS NULL) = (anchor_day IS NULL)),
  CHECK (schedule_type <> 'fixed_date' OR (interval_km IS NULL AND interval_months IS NULL))
) STRICT`,

  `CREATE TABLE expense_categories (
  id TEXT NOT NULL PRIMARY KEY CHECK (id GLOB 'sys_*' OR length(id) = 26),
  name_it TEXT NOT NULL CHECK (length(name_it) BETWEEN 1 AND 40),
  icon TEXT,
  ${B('is_system')},
  sort_order INTEGER NOT NULL DEFAULT 100,
  ${AUDIT}
) STRICT`,

  // ---------------------------------------------------------------- adattatori OBD e veicoli
  `CREATE TABLE obd_adapters (
  ${ID()},
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  transport TEXT NOT NULL CHECK (transport IN ('ble','classic','wifi','simulator')),
  address TEXT NOT NULL,
  service_uuid TEXT, write_char_uuid TEXT, notify_char_uuid TEXT,
  ${B('write_without_response')},
  elm_version TEXT, elm_description TEXT,
  ${B('clone_suspected')},
  last_protocol TEXT,
  mtu INTEGER CHECK (mtu BETWEEN 20 AND 517),
  ${T('last_connected_at')},
  notes TEXT,
  ${AUDIT},
  UNIQUE (transport, address)
) STRICT`,

  `CREATE TABLE vehicles (
  ${ID()},
  nickname TEXT CHECK (length(nickname) <= 60),
  plate TEXT CHECK (length(plate) BETWEEN 2 AND 10 AND plate NOT GLOB '*[^A-Z0-9]*'),
  plate_country TEXT NOT NULL DEFAULT 'IT' CHECK (length(plate_country) = 2),
  vin TEXT CHECK (length(vin) BETWEEN 5 AND 17 AND vin NOT GLOB '*[^A-Z0-9]*'),
  make TEXT NOT NULL CHECK (length(make) BETWEEN 1 AND 40),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 60),
  trim TEXT CHECK (length(trim) <= 80),
  model_year INTEGER CHECK (model_year BETWEEN 1900 AND 2100),
  ${D('first_registration_on')},
  powertrain TEXT NOT NULL DEFAULT 'ice' CHECK (powertrain IN ('ice','mhev','hev','phev','bev','fcev')),
  fuel_primary TEXT NOT NULL CHECK (fuel_primary IN ('petrol','diesel','lpg','cng','electric','hydrogen')),
  fuel_secondary TEXT CHECK (fuel_secondary IN ('petrol','lpg','cng','electric')),
  engine_cc INTEGER CHECK (engine_cc BETWEEN 50 AND 20000),
  power_kw INTEGER CHECK (power_kw BETWEEN 1 AND 2000),
  euro_class TEXT CHECK (length(euro_class) <= 10),
  color TEXT CHECK (length(color) <= 30),
  transmission TEXT CHECK (transmission IN ('manual','automatic','cvt','dct','other')),
  tank_capacity_ml INTEGER CHECK (tank_capacity_ml BETWEEN 1000 AND 1000000),
  distance_unit TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km','mi')),
  annual_km_estimate INTEGER CHECK (annual_km_estimate BETWEEN 100 AND 200000),
  ${D('purchase_on')}, ${KM('purchase_km')}, ${CENTS('purchase_price_cents')},
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','scrapped','archived')),
  ${D('sold_on')}, ${KM('sold_km')}, ${CENTS('sold_price_cents')},
  ${REF('preferred_adapter_id', 'obd_adapters', 'SET NULL', false)},
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  ${AUDIT},
  CHECK (fuel_secondary IS NULL OR fuel_secondary <> fuel_primary),
  CHECK ((sold_on IS NULL AND sold_km IS NULL AND sold_price_cents IS NULL) OR status IN ('sold','scrapped')),
  CHECK (sold_on IS NULL OR purchase_on IS NULL OR sold_on >= purchase_on)
) STRICT`,

  `CREATE TABLE workshops (
  ${ID()},
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone TEXT, email TEXT, website TEXT, address TEXT, city TEXT, notes TEXT,
  ${B('is_favorite')},
  ${AUDIT}
) STRICT`,

  // ---------------------------------------------------------------- registri (rifornimenti, interventi, controlli livelli)
  `CREATE TABLE fuel_logs (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('filled_on', true)},
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('petrol','diesel','lpg','cng','electric','hydrogen','adblue')),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('L','kg','kWh')),
  unit_price_milli INTEGER CHECK (unit_price_milli BETWEEN 0 AND 100000000),
  ${CENTS('total_cents', true)},
  ${B('is_full', 1)},
  ${B('missed_before')},
  station TEXT CHECK (length(station) <= 80),
  notes TEXT,
  ${AUDIT},
  CHECK ((quantity_unit = 'L'   AND fuel_type IN ('petrol','diesel','lpg','adblue'))
      OR (quantity_unit = 'kg'  AND fuel_type IN ('cng','hydrogen'))
      OR (quantity_unit = 'kWh' AND fuel_type = 'electric'))
) STRICT`,

  `CREATE TABLE service_records (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('service_on', true)},
  kind TEXT NOT NULL CHECK (kind IN ('scheduled','repair','inspection','tyres','bodywork','accessories','diagnostic','other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  ${REF('workshop_id', 'workshops', 'SET NULL', false)},
  ${CENTS('total_cents', true, ' DEFAULT 0')},
  invoice_number TEXT CHECK (length(invoice_number) <= 40),
  ${D('paid_on')},
  ${D('warranty_until_on')},
  notes TEXT,
  ${AUDIT}
) STRICT`,

  `CREATE TABLE service_lines (
  ${ID()},
  ${REF('service_record_id', 'service_records')},
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  line_type TEXT NOT NULL CHECK (line_type IN ('labor','part','fluid','fee','other')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  quantity_milli INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli > 0),
  ${CENTS('unit_price_cents')},
  ${CENTS('amount_cents', true, ' DEFAULT 0')},
  part_code TEXT CHECK (length(part_code) <= 60),
  brand TEXT CHECK (length(brand) <= 60),
  spec TEXT CHECK (length(spec) <= 120),
  fluid_kind TEXT CHECK (fluid_kind IN ('engine_oil','coolant','brake_fluid','washer','adblue','gearbox_oil','power_steering','other')),
  warranty_months INTEGER CHECK (warranty_months BETWEEN 1 AND 240),
  ${AUDIT_NOSOFT},
  CHECK (fluid_kind IS NULL OR line_type = 'fluid')
) STRICT`,

  `CREATE TABLE fluid_checks (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('checked_on', true)},
  fluid TEXT NOT NULL CHECK (fluid IN ('engine_oil','coolant','brake_fluid','washer','adblue','power_steering','gearbox_oil','other')),
  level TEXT NOT NULL CHECK (level IN ('ok','low','topped_up','high')),
  added_ml INTEGER CHECK (added_ml BETWEEN 1 AND 100000),
  product TEXT CHECK (length(product) <= 80),
  notes TEXT,
  ${AUDIT},
  CHECK (added_ml IS NULL OR level = 'topped_up')
) STRICT`,

  `CREATE TABLE expenses (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('spent_on', true)},
  ${REF('category_id', 'expense_categories', 'RESTRICT')},
  ${CENTS('amount_cents', true)},
  description TEXT CHECK (length(description) <= 200),
  vendor TEXT CHECK (length(vendor) <= 80),
  notes TEXT,
  ${AUDIT}
) STRICT`,

  // ---------------------------------------------------------------- OBD (sessioni prima delle letture che le referenziano)
  `CREATE TABLE obd_sessions (
  ${ID()},
  seq INTEGER NOT NULL UNIQUE CHECK (seq >= 1),
  ${REF('vehicle_id', 'vehicles')},
  ${REF('adapter_id', 'obd_adapters', 'SET NULL', false)},
  kind TEXT NOT NULL CHECK (kind IN ('snapshot','live','diagnostic')),
  ${T('started_at', true)},
  ${T('ended_at')},
  end_reason TEXT CHECK (end_reason IN ('user','disconnect','error','timeout','app_closed')),
  protocol TEXT,
  vin_matches INTEGER CHECK (vin_matches IN (0, 1)),
  ${JSONC('supported_pids')},
  mil_on INTEGER CHECK (mil_on IN (0, 1)),
  dtc_count INTEGER CHECK (dtc_count BETWEEN 0 AND 255),
  ${JSONC('stats')},
  sample_interval_ms INTEGER CHECK (sample_interval_ms BETWEEN 50 AND 60000),
  ${T('samples_pruned_at')},
  app_version TEXT,
  ${AUDIT_NOSOFT},
  CHECK (ended_at IS NULL OR ended_at >= started_at)
) STRICT`,

  `CREATE TABLE telemetry_samples (
  session_seq INTEGER NOT NULL REFERENCES obd_sessions(seq) ON DELETE CASCADE,
  pid INTEGER NOT NULL CHECK (pid BETWEEN 0 AND 65535),
  t_ms INTEGER NOT NULL CHECK (t_ms >= 0),
  value REAL NOT NULL,
  PRIMARY KEY (session_seq, pid, t_ms)
) STRICT, WITHOUT ROWID`,

  `CREATE TABLE telemetry_rollups (
  session_seq INTEGER NOT NULL REFERENCES obd_sessions(seq) ON DELETE CASCADE,
  pid INTEGER NOT NULL CHECK (pid BETWEEN 0 AND 65535),
  bucket INTEGER NOT NULL CHECK (bucket >= 0),
  n INTEGER NOT NULL CHECK (n >= 1),
  v_min REAL NOT NULL, v_max REAL NOT NULL, v_avg REAL NOT NULL,
  PRIMARY KEY (session_seq, pid, bucket)
) STRICT, WITHOUT ROWID`,

  `CREATE TABLE dtc_events (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${REF('session_id', 'obd_sessions', 'SET NULL', false)},
  code TEXT NOT NULL CHECK (code GLOB '[PCBU][0-3][0-9A-F][0-9A-F][0-9A-F]'),
  kind TEXT NOT NULL CHECK (kind IN ('stored','pending','permanent')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','absent','cleared','ignored')),
  ${T('first_seen_at', true)},
  ${T('last_seen_at', true)},
  seen_count INTEGER NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  ${KM('odometer_km')},
  mil_on_when_seen INTEGER CHECK (mil_on_when_seen IN (0, 1)),
  ${JSONC('freeze_frame')},
  ${T('cleared_at')},
  title_it TEXT,
  user_note TEXT,
  ${AUDIT},
  CHECK (last_seen_at >= first_seen_at),
  CHECK ((state = 'cleared') = (cleared_at IS NOT NULL))
) STRICT`,

  // ---------------------------------------------------------------- odometro (fonte unica dei km)
  `CREATE TABLE odometer_readings (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  ${D('read_on', true)},
  ${KM('km', true)},
  source TEXT NOT NULL CHECK (source IN ('manual','obd','fuel','service','fluid_check','import')),
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','ignored')),
  ${REF('fuel_log_id', 'fuel_logs', 'CASCADE', false)},
  ${REF('service_record_id', 'service_records', 'CASCADE', false)},
  ${REF('fluid_check_id', 'fluid_checks', 'CASCADE', false)},
  ${REF('obd_session_id', 'obd_sessions', 'CASCADE', false)},
  note TEXT,
  ${AUDIT},
  CHECK ((source = 'fuel')        = (fuel_log_id IS NOT NULL)),
  CHECK ((source = 'service')     = (service_record_id IS NOT NULL)),
  CHECK ((source = 'fluid_check') = (fluid_check_id IS NOT NULL)),
  CHECK ((source = 'obd')         = (obd_session_id IS NOT NULL))
) STRICT`,

  // coerenza monotona: confronto solo con letture di giorni DIVERSI (stesso giorno = nessun vincolo)
  `CREATE TRIGGER trg_odo_mono_ins BEFORE INSERT ON odometer_readings
WHEN NEW.status = 'valid' AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ODO_NON_MONOTONIC') WHERE EXISTS (
    SELECT 1 FROM odometer_readings o
    WHERE o.vehicle_id = NEW.vehicle_id AND o.status = 'valid' AND o.deleted_at IS NULL
      AND ((o.read_on < NEW.read_on AND o.km > NEW.km) OR (o.read_on > NEW.read_on AND o.km < NEW.km)));
END`,
  `CREATE TRIGGER trg_odo_mono_upd BEFORE UPDATE OF vehicle_id, read_on, km, status, deleted_at ON odometer_readings
WHEN NEW.status = 'valid' AND NEW.deleted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'ODO_NON_MONOTONIC') WHERE EXISTS (
    SELECT 1 FROM odometer_readings o
    WHERE o.id <> NEW.id AND o.vehicle_id = NEW.vehicle_id AND o.status = 'valid' AND o.deleted_at IS NULL
      AND ((o.read_on < NEW.read_on AND o.km > NEW.km) OR (o.read_on > NEW.read_on AND o.km < NEW.km)));
END`,

  // ---------------------------------------------------------------- regole di manutenzione
  `CREATE TABLE maintenance_items (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  template_id TEXT REFERENCES service_templates(id) ON DELETE SET NULL,
  template_version INTEGER,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (category IN ('legal','maintenance','check','tyres','other')),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('interval_last_done','interval_calendar','fixed_date')),
  interval_km INTEGER CHECK (interval_km BETWEEN 100 AND 1000000),
  interval_months INTEGER CHECK (interval_months BETWEEN 1 AND 240),
  period_end TEXT NOT NULL DEFAULT 'exact' CHECK (period_end IN ('exact','end_of_month')),
  ${D('fixed_due_on')},
  ${D('baseline_on')},
  ${KM('baseline_km')},
  soon_days INTEGER NOT NULL DEFAULT 30 CHECK (soon_days BETWEEN 0 AND 365),
  soon_km INTEGER NOT NULL DEFAULT 1500 CHECK (soon_km BETWEEN 0 AND 100000),
  ${JSONC('notify_offsets_days', true, " DEFAULT '[30,7,0]'")},
  ${B('notify_enabled', 1)},
  ${B('is_active', 1)},
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  ${AUDIT},
  CHECK (schedule_type <> 'interval_last_done' OR interval_km IS NOT NULL OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'interval_calendar' OR interval_months IS NOT NULL),
  CHECK (schedule_type <> 'fixed_date' OR (interval_km IS NULL AND interval_months IS NULL))
) STRICT`,

  `CREATE TABLE maintenance_completions (
  ${ID()},
  ${REF('item_id', 'maintenance_items')},
  ${D('done_on', true)},
  ${KM('done_km')},
  ${D('prev_fixed_due_on')},   -- data fissa dell'item PRIMA del completamento (serve all'annulla)
  source TEXT NOT NULL CHECK (source IN ('service','check','manual','import')),
  ${REF('service_record_id', 'service_records', 'CASCADE', false)},
  ${REF('fluid_check_id', 'fluid_checks', 'CASCADE', false)},
  notes TEXT,
  ${AUDIT},
  CHECK ((source = 'service') = (service_record_id IS NOT NULL)),
  CHECK ((source = 'check')   = (fluid_check_id IS NOT NULL))
) STRICT`,

  // ---------------------------------------------------------------- assicurazioni
  `CREATE TABLE insurance_policies (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  kind TEXT NOT NULL CHECK (kind IN ('rca','kasko','furto_incendio','other')),
  company TEXT NOT NULL CHECK (length(company) BETWEEN 1 AND 80),
  agency_name TEXT,
  policy_number TEXT CHECK (length(policy_number) <= 40),
  ${D('start_on', true)},
  ${D('end_on', true)},
  ${CENTS('premium_cents', true, ' DEFAULT 0')},
  payment_frequency TEXT NOT NULL DEFAULT 'annual' CHECK (payment_frequency IN ('single','annual','semiannual','quarterly','monthly')),
  merit_class INTEGER CHECK (merit_class BETWEEN 1 AND 18),
  ${B('black_box')},
  claims_phone TEXT, claims_email TEXT, assistance_phone TEXT,
  agent_name TEXT, agent_phone TEXT, agent_email TEXT,
  ${REF('renewed_from_id', 'insurance_policies', 'SET NULL', false)},
  ${D('cancelled_on')},
  notes TEXT,
  ${AUDIT},
  CHECK (end_on > start_on),
  CHECK (cancelled_on IS NULL OR cancelled_on >= start_on)
) STRICT`,

  `CREATE TABLE insurance_coverages (
  ${ID()},
  ${REF('policy_id', 'insurance_policies')},
  code TEXT NOT NULL CHECK (code IN ('rca','kasko','furto','incendio','cristalli','eventi_naturali','atti_vandalici','assistenza','infortuni_conducente','tutela_legale','altro')),
  ${CENTS('limit_cents')},
  ${CENTS('deductible_cents')},
  deductible_bp INTEGER CHECK (deductible_bp BETWEEN 0 AND 10000),
  notes TEXT,
  ${AUDIT_NOSOFT},
  UNIQUE (policy_id, code)
) STRICT`,

  `CREATE TABLE insurance_payments (
  ${ID()},
  ${REF('policy_id', 'insurance_policies')},
  installment_no INTEGER NOT NULL CHECK (installment_no BETWEEN 1 AND 12),
  ${D('due_on', true)},
  ${CENTS('amount_cents', true)},
  ${D('paid_on')},
  notes TEXT,
  ${AUDIT},
  UNIQUE (policy_id, installment_no)
) STRICT`,

  // ---------------------------------------------------------------- promemoria (occorrenze)
  `CREATE TABLE reminders (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  origin TEXT NOT NULL CHECK (origin IN ('generated','manual')),
  ${REF('item_id', 'maintenance_items', 'CASCADE', false)},
  ${REF('policy_id', 'insurance_policies', 'CASCADE', false)},
  ${REF('payment_id', 'insurance_payments', 'CASCADE', false)},
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes TEXT,
  category TEXT NOT NULL DEFAULT 'maintenance' CHECK (category IN ('legal','maintenance','check','insurance','tyres','other')),
  ${D('due_on')},
  due_time TEXT CHECK (due_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  ${KM('due_km')},
  ${D('forecast_on')},
  forecast_confidence TEXT CHECK (forecast_confidence IN ('none','low','medium','high')),
  ${D('effective_due_on')},
  due_trigger TEXT CHECK (due_trigger IN ('time','km','both')),
  soon_days INTEGER NOT NULL DEFAULT 30 CHECK (soon_days BETWEEN 0 AND 365),
  soon_km INTEGER NOT NULL DEFAULT 1500 CHECK (soon_km BETWEEN 0 AND 100000),
  ${JSONC('notify_offsets_days', true, " DEFAULT '[30,7,0]'")},
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
  ${T('snoozed_until')},
  ${KM('snooze_until_km')},
  ${D('completed_on')},
  completion_id TEXT REFERENCES maintenance_completions(id) ON DELETE SET NULL,
  repeat_every INTEGER CHECK (repeat_every BETWEEN 1 AND 1000),
  repeat_unit TEXT CHECK (repeat_unit IN ('day','week','month','year')),
  ${D('repeat_origin_on')},
  ${T('computed_at')},
  ${AUDIT},
  CHECK ((origin = 'manual' AND item_id IS NULL AND policy_id IS NULL AND payment_id IS NULL)
      OR (origin = 'generated' AND (item_id IS NOT NULL) + (policy_id IS NOT NULL) + (payment_id IS NOT NULL) = 1)),
  CHECK (due_on IS NOT NULL OR due_km IS NOT NULL),
  CHECK ((repeat_every IS NULL) = (repeat_unit IS NULL)),
  CHECK (repeat_every IS NULL OR (origin = 'manual' AND repeat_origin_on IS NOT NULL)),
  CHECK (due_time IS NULL OR origin = 'manual'),
  CHECK ((status = 'open') = (completed_on IS NULL) OR status = 'skipped')
) STRICT`,

  // cache dello stato OS delle notifiche (la fonte di verita' resta il sistema operativo)
  `CREATE TABLE notification_schedule (
  key TEXT NOT NULL PRIMARY KEY CHECK (key GLOB 'ag1:*'),
  ${REF('reminder_id', 'reminders', 'CASCADE', false)},
  ${T('fire_at', true)},
  tz TEXT NOT NULL,
  hash TEXT NOT NULL,
  ${T('planned_at', true)}
) STRICT`,

  // ---------------------------------------------------------------- pneumatici
  `CREATE TABLE tyre_sets (
  ${ID()},
  ${REF('vehicle_id', 'vehicles')},
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  season TEXT NOT NULL CHECK (season IN ('summer','winter','all_season')),
  brand TEXT, model TEXT,
  width_mm INTEGER CHECK (width_mm BETWEEN 100 AND 450),
  aspect_pct INTEGER CHECK (aspect_pct BETWEEN 20 AND 90),
  rim_in INTEGER CHECK (rim_in BETWEEN 10 AND 26),
  load_index INTEGER CHECK (load_index BETWEEN 50 AND 130),
  speed_symbol TEXT CHECK (speed_symbol IN ('M','N','P','Q','R','S','T','U','H','V','W','Y')),
  ${B('m_s')},
  ${B('three_peak')},
  quantity INTEGER NOT NULL DEFAULT 4 CHECK (quantity BETWEEN 1 AND 6),
  ${JSONC('dot_codes')},
  ${D('purchased_on')},
  ${CENTS('purchase_price_cents')},
  storage_location TEXT CHECK (length(storage_location) <= 80),
  ${D('retired_on')},
  notes TEXT,
  ${AUDIT},
  UNIQUE (id, vehicle_id)
) STRICT`,

  `CREATE TABLE tyre_fitments (
  ${ID()},
  tyre_set_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  ${D('fitted_on', true)},
  ${KM('fitted_km')},
  ${D('removed_on')},
  ${KM('removed_km')},
  ${REF('workshop_id', 'workshops', 'SET NULL', false)},
  notes TEXT,
  ${AUDIT},
  FOREIGN KEY (tyre_set_id, vehicle_id) REFERENCES tyre_sets(id, vehicle_id) ON DELETE CASCADE,
  CHECK (removed_on IS NULL OR removed_on >= fitted_on),
  CHECK (removed_km IS NULL OR fitted_km IS NULL OR removed_km >= fitted_km)
) STRICT`,

  // ---------------------------------------------------------------- allegati (file nello storage dell'app, metadati qui)
  `CREATE TABLE attachments (
  ${ID()},
  ${REF('owner_vehicle_id', 'vehicles')},
  ${REF('service_record_id', 'service_records', 'CASCADE', false)},
  ${REF('policy_id', 'insurance_policies', 'CASCADE', false)},
  ${REF('fuel_log_id', 'fuel_logs', 'CASCADE', false)},
  ${REF('expense_id', 'expenses', 'CASCADE', false)},
  ${REF('fluid_check_id', 'fluid_checks', 'CASCADE', false)},
  ${REF('tyre_set_id', 'tyre_sets', 'CASCADE', false)},
  kind TEXT NOT NULL CHECK (kind IN ('photo','receipt','invoice','policy','registration_doc','inspection','other')),
  title TEXT CHECK (length(title) <= 80),
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL UNIQUE CHECK (stored_path GLOB 'attachments/*' AND stored_path NOT GLOB '*..*'),
  thumb_path TEXT CHECK (thumb_path GLOB 'attachments/*' AND thumb_path NOT GLOB '*..*'),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 268435456),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  width_px INTEGER, height_px INTEGER,
  ${B('is_cover')},
  ${AUDIT},
  CHECK ((service_record_id IS NOT NULL) + (policy_id IS NOT NULL) + (fuel_log_id IS NOT NULL)
       + (expense_id IS NOT NULL) + (fluid_check_id IS NOT NULL) + (tyre_set_id IS NOT NULL) <= 1),
  CHECK (is_cover = 0 OR kind = 'photo')
) STRICT`,

  `CREATE TABLE pending_file_deletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_path TEXT NOT NULL,
  queued_at TEXT NOT NULL DEFAULT (${NOW})
) STRICT`,
  `CREATE TRIGGER trg_attachments_gc AFTER DELETE ON attachments
BEGIN
  INSERT INTO pending_file_deletions (stored_path) VALUES (OLD.stored_path);
  INSERT INTO pending_file_deletions (stored_path) SELECT OLD.thumb_path WHERE OLD.thumb_path IS NOT NULL;
END`,

  // ---------------------------------------------------------------- indici
  `CREATE UNIQUE INDEX ux_vehicles_plate ON vehicles(plate) WHERE plate IS NOT NULL AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_vehicles_vin ON vehicles(vin) WHERE vin IS NOT NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_vehicles_status ON vehicles(status) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_vehicles_adapter ON vehicles(preferred_adapter_id) WHERE preferred_adapter_id IS NOT NULL`,
  `CREATE INDEX ix_odo_vehicle_day ON odometer_readings(vehicle_id, read_on DESC, km DESC) WHERE status = 'valid' AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_odo_fuel ON odometer_readings(fuel_log_id) WHERE fuel_log_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_odo_service ON odometer_readings(service_record_id) WHERE service_record_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_odo_fluid ON odometer_readings(fluid_check_id) WHERE fluid_check_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_odo_obd ON odometer_readings(obd_session_id) WHERE obd_session_id IS NOT NULL`,
  `CREATE INDEX ix_service_vehicle_date ON service_records(vehicle_id, service_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_service_workshop ON service_records(workshop_id) WHERE workshop_id IS NOT NULL`,
  `CREATE INDEX ix_lines_record ON service_lines(service_record_id, position)`,
  `CREATE INDEX ix_items_vehicle ON maintenance_items(vehicle_id) WHERE deleted_at IS NULL AND is_active = 1`,
  `CREATE INDEX ix_items_template ON maintenance_items(template_id) WHERE template_id IS NOT NULL`,
  `CREATE INDEX ix_completions_item ON maintenance_completions(item_id, done_on DESC) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_completion_record_item ON maintenance_completions(service_record_id, item_id) WHERE service_record_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_completion_fluid_item ON maintenance_completions(fluid_check_id, item_id) WHERE fluid_check_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_policies_vehicle ON insurance_policies(vehicle_id, end_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_payments_due ON insurance_payments(due_on) WHERE paid_on IS NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_coverages_policy ON insurance_coverages(policy_id)`,
  `CREATE UNIQUE INDEX ux_reminder_open_item ON reminders(item_id) WHERE status = 'open' AND item_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_reminder_open_policy ON reminders(policy_id) WHERE status = 'open' AND policy_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_reminder_open_payment ON reminders(payment_id) WHERE status = 'open' AND payment_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_reminders_due ON reminders(effective_due_on) WHERE status = 'open' AND deleted_at IS NULL`,
  `CREATE INDEX ix_reminders_vehicle ON reminders(vehicle_id, status) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_notif_reminder ON notification_schedule(reminder_id)`,
  `CREATE INDEX ix_fuel_vehicle_date ON fuel_logs(vehicle_id, filled_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_expenses_vehicle_date ON expenses(vehicle_id, spent_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_expenses_category ON expenses(category_id)`,
  `CREATE INDEX ix_fluid_vehicle ON fluid_checks(vehicle_id, fluid, checked_on DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_tyre_sets_vehicle ON tyre_sets(vehicle_id) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_fitments_set ON tyre_fitments(tyre_set_id, fitted_on DESC) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX ux_fitments_open ON tyre_fitments(vehicle_id) WHERE removed_on IS NULL AND deleted_at IS NULL`,
  `CREATE INDEX ix_att_owner ON attachments(owner_vehicle_id, created_at DESC) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_att_service ON attachments(service_record_id) WHERE service_record_id IS NOT NULL`,
  `CREATE INDEX ix_att_policy ON attachments(policy_id) WHERE policy_id IS NOT NULL`,
  `CREATE INDEX ix_att_fuel ON attachments(fuel_log_id) WHERE fuel_log_id IS NOT NULL`,
  `CREATE INDEX ix_att_expense ON attachments(expense_id) WHERE expense_id IS NOT NULL`,
  `CREATE INDEX ix_att_fluid ON attachments(fluid_check_id) WHERE fluid_check_id IS NOT NULL`,
  `CREATE INDEX ix_att_tyre ON attachments(tyre_set_id) WHERE tyre_set_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_att_cover ON attachments(owner_vehicle_id) WHERE is_cover = 1 AND deleted_at IS NULL`,
  `CREATE INDEX ix_obd_sessions_vehicle ON obd_sessions(vehicle_id, started_at DESC)`,
  `CREATE INDEX ix_dtc_vehicle_code ON dtc_events(vehicle_id, code, state) WHERE deleted_at IS NULL`,
  `CREATE INDEX ix_dtc_vehicle_seen ON dtc_events(vehicle_id, last_seen_at DESC) WHERE deleted_at IS NULL`,

  // ---------------------------------------------------------------- viste di lettura
  `CREATE VIEW v_vehicle_odometer AS
SELECT o.vehicle_id, o.read_on AS as_of, MAX(o.km) AS km
FROM odometer_readings o
WHERE o.status = 'valid' AND o.deleted_at IS NULL
  AND o.read_on = (SELECT MAX(p.read_on) FROM odometer_readings p
                   WHERE p.vehicle_id = o.vehicle_id AND p.status = 'valid' AND p.deleted_at IS NULL)
GROUP BY o.vehicle_id`,

  `CREATE VIEW v_item_last_done AS
SELECT i.id AS item_id,
       CASE WHEN c.id IS NOT NULL THEN c.done_on ELSE i.baseline_on END AS last_done_on,
       CASE WHEN c.id IS NOT NULL THEN c.done_km ELSE i.baseline_km END AS last_done_km
FROM maintenance_items i
LEFT JOIN maintenance_completions c ON c.id = (
  SELECT c2.id FROM maintenance_completions c2
  WHERE c2.item_id = i.id AND c2.deleted_at IS NULL
  ORDER BY c2.done_on DESC, c2.created_at DESC, c2.id DESC LIMIT 1)
WHERE i.deleted_at IS NULL`,

  `CREATE VIEW v_costs AS
SELECT vehicle_id, service_on AS on_date, 'service' AS source, id AS source_id, total_cents AS cents
  FROM service_records WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, filled_on, 'fuel', id, total_cents FROM fuel_logs WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, spent_on, 'expense', id, amount_cents FROM expenses WHERE deleted_at IS NULL
UNION ALL SELECT p.vehicle_id, ip.paid_on, 'insurance', ip.id, ip.amount_cents
  FROM insurance_payments ip JOIN insurance_policies p ON p.id = ip.policy_id
  WHERE ip.paid_on IS NOT NULL AND ip.deleted_at IS NULL AND p.deleted_at IS NULL`,

  ...TOUCH_TABLES.map(touchTrigger),
];
```

Note sul codice:

- I trigger `trg_<tabella>_touch` per le 20 tabelle con `updated_at` sono generati da `touchTrigger()` (ultima riga di `up`). Esempio espanso: `CREATE TRIGGER trg_vehicles_touch AFTER UPDATE ON vehicles WHEN NEW.updated_at IS OLD.updated_at BEGIN UPDATE vehicles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END`.
- Il codice applicativo imposta comunque `created_at/updated_at` dal `Clock` iniettato (testabilita'); il `DEFAULT` e il trigger sono la rete di sicurezza.
- Inserire una sessione OBD: `INSERT INTO obd_sessions (id, seq, ...) VALUES (?, (SELECT COALESCE(MAX(seq),0)+1 FROM obd_sessions), ...)` (atomico sotto il lock di scrittura di SQLite); `seq` e' la chiave intera usata da `telemetry_*`. Il PID e' memorizzato come intero `(mode << 8) | pid`, ad esempio `0x010C` = 268 (giri motore).
- `reminders` e `maintenance_items` hanno `soon_days/soon_km/notify_offsets_days` copiati dal template alla creazione: cambiare il catalogo in un aggiornamento dell'app **non** modifica le regole gia' personalizzate dall'utente.

### 1.4 Esiti dei test eseguiti sul DDL (Node 24.19, SQLite 3.53.3)

89 controlli, 0 falliti. Principali casi verificati:

- migrazione: 28 tabelle (29 con `sqlite_sequence`), 74 indici (inclusi gli automatici), 23 trigger, 3 viste; 27 template e 13 categorie inseriti senza violare i `CHECK`;
- validazione: rifiutati targa con spazio o minuscola, targa duplicata (ma riusabile dopo soft delete), VIN minuscolo, `2026-02-30`, `2026-10-7`, istante senza millisecondi, id non ULID, testo in colonna INTEGER (STRICT);
- odometro: 10.000 km (2026-01-01), 15.000 (2026-06-01), retrodatazione valida in mezzo (12.000 il 2026-03-01); rifiutati 16.000 il 2026-03-02 e 14.000 il 2026-07-01 con errore `ODO_NON_MONOTONIC`; stesso giorno senza vincolo; lettura `ignored` accettata; `UPDATE` che romperebbe la monotonia rifiutato; lettura `source='fuel'` senza `fuel_log_id` rifiutata; una sola lettura per rifornimento;
- promemoria: un solo reminder aperto per item (indice unico parziale), nuovo aperto consentito dopo il completamento, `generated` senza sorgente e `manual` con sorgente rifiutati, `done` senza `completed_on` rifiutato;
- assicurazioni: classe di merito 19 e `end_on <= start_on` rifiutati, rata duplicata rifiutata, massimale RCA 6.070.000 EUR (607.000.000 centesimi) accettato;
- pneumatici: due set montati insieme rifiutati, set di un altro veicolo rifiutato (FK composta), montaggio dopo smontaggio accettato;
- allegati: due genitori rifiutati, path traversal (`attachments/../..`) rifiutato, sha256 non esadecimale minuscolo rifiutato, seconda copertina rifiutata;
- OBD/DTC: adattatore duplicato rifiutato, `ended_at < started_at` rifiutato, `P4200` e `p0420` rifiutati, stato `cleared` senza `cleared_at` rifiutato, campione duplicato rifiutato;
- cascata: cancellando un veicolo scompaiono tutte le righe collegate (14 tabelle verificate a zero), la coda `pending_file_deletions` riceve i path dei file, `PRAGMA foreign_key_check` vuoto, `PRAGMA integrity_check` = ok.

Misure su telemetria (stessa macchina, 600.000 campioni = 100.000 istanti x 6 PID):

| Forma | Byte/riga | Dimensione | Note |
|---|---|---|---|
| Chiavi testuali `(session_id ULID, pid 4 char, t_ms)` | ~57 | 34 MB | scartata |
| Chiavi intere `(session_seq, pid, t_ms)` `WITHOUT ROWID` | ~25 | 15 MB | **adottata** |
| Inserimento in una transazione | | ~1,4 s per 600.000 righe | il recorder deve fare batch ogni 1-2 s |
| Downsampling a bucket di 60 s + `DELETE` dei grezzi | | ~1,5 s, 600.000 -> 10.002 righe | 60x meno righe |

Stima d'uso: 1 Hz x 8 PID = 28.800 righe/ora = ~0,7 MB/ora di guida registrata. Retention proposta (modificabile in `app_settings`): campioni grezzi 30 giorni **e** massimo 50 MB; poi rollup a 60 s (min/max/media) e `samples_pruned_at` valorizzato; le sessioni (statistiche) restano. Il live a 5 Hz non viene persistito a meno che l'utente scelga "Registra".

### 1.5 Seed dei cataloghi (codice eseguito e testato)

`src/data/seeds/catalog.ts`. I valori sono **indicativi** (confidenza bassa-media: sono tipici di mercato, non verificati su fonti primarie): il libretto di uso e manutenzione del costruttore prevale, e la UI lo dice (`is_indicative=1` mostra "valore indicativo"). Le regole di legge (revisione 4+2 anni a fine mese, bollo, bombole) e le date delle gomme provengono da `docs/research/features.md` sezione 17 (fonti li' elencate: sicurauto.it, lautomobile.aci.it, certifico.com, motor1.com).

```js

// src/data/seeds/catalog.ts
// Tag veicolo (derivati dal dominio): combustion | petrol | diesel | gas (GPL/metano primario o secondario) | bev | plugin
export const EXPENSE_CATEGORIES = [
  ['sys_insurance_other', 'Assicurazione (altro)', 'shield', 10],
  ['sys_road_tax', 'Bollo auto', 'receipt', 20],
  ['sys_inspection', 'Revisione', 'clipboard-check', 30],
  ['sys_parking', 'Parcheggio e sosta', 'parking', 40],
  ['sys_tolls', 'Pedaggi', 'road', 50],
  ['sys_fines', 'Multe', 'alert-triangle', 60],
  ['sys_washing', 'Lavaggio e cura', 'droplets', 70],
  ['sys_accessories', 'Accessori', 'package', 80],
  ['sys_fees', 'Pratiche e passaggi (ACI, PRA)', 'file-text', 90],
  ['sys_financing', 'Finanziamento / leasing / noleggio', 'landmark', 100],
  ['sys_garage', 'Box e rimessaggio', 'warehouse', 110],
  ['sys_purchase', 'Acquisto veicolo', 'shopping-cart', 120],
  ['sys_other', 'Altro', 'more-horizontal', 999],
];

// [id, nome, categoria, tipo, km, mesi, period_end, anchor(m,d), soonDays, soonKm, offsets, applies_to, default_enabled, is_indicative, note]
const L = 'interval_last_done', C = 'interval_calendar', F = 'fixed_date';
export const TEMPLATES = [
  // --- scadenze di legge
  ['tpl_inspection', 'Revisione periodica', 'legal', L, null, 24, 'end_of_month', null, 30, 0, [60, 30, 14, 7, 0], null, 1, 0,
    'Prima revisione 4 anni dopo l\'immatricolazione, poi ogni 2 anni, entro fine mese. Controlla sempre la data sull\'ultimo tagliando di revisione.'],
  ['tpl_road_tax', 'Bollo auto', 'legal', C, null, 12, 'exact', null, 30, 0, [30, 15, 7, 0], null, 1, 0,
    'Inserisci l\'ultimo giorno utile di pagamento (di norma fine del mese successivo a quello di scadenza). L\'importo non viene calcolato: usa i servizi ufficiali.'],
  ['tpl_gas_cylinder', 'Riqualifica bombola GPL/metano', 'legal', F, null, null, 'exact', null, 60, 0, [90, 30, 7, 0], ['gas'], 1, 0,
    'La scadenza e\' sul cartellino della bombola: inseriscila a mano (foto consigliata).'],
  ['tpl_gas_system_check', 'Controllo impianto GPL/metano', 'maintenance', L, null, 12, 'exact', null, 30, 0, [14, 3, 0], ['gas'], 1, 1,
    'Valore indicativo: verifica il libretto uso e manutenzione o l\'installatore.'],
  // --- manutenzione programmata (valori indicativi: il libretto uso e manutenzione del costruttore prevale)
  ['tpl_service_main', 'Tagliando', 'maintenance', L, 15000, 12, 'exact', null, 30, 1500, [14, 3, 0], null, 1, 1,
    'Intervallo indicativo: usa quello del libretto di uso e manutenzione.'],
  ['tpl_oil_change', 'Cambio olio motore e filtro', 'maintenance', L, 15000, 12, 'exact', null, 30, 1500, [14, 3, 0], ['combustion'], 1, 1,
    'Se il tuo tagliando comprende gia\' l\'olio, puoi disattivare questa voce.'],
  ['tpl_cabin_filter', 'Filtro abitacolo', 'maintenance', L, 15000, 12, 'exact', null, 30, 1500, [14, 0], null, 1, 1, null],
  ['tpl_air_filter', 'Filtro aria motore', 'maintenance', L, 30000, 24, 'exact', null, 30, 2000, [14, 0], ['combustion'], 1, 1, null],
  ['tpl_fuel_filter', 'Filtro carburante', 'maintenance', L, 30000, 24, 'exact', null, 30, 2000, [14, 0], ['diesel'], 1, 1, null],
  ['tpl_spark_plugs', 'Candele', 'maintenance', L, 60000, 48, 'exact', null, 60, 3000, [30, 7, 0], ['petrol'], 1, 1, null],
  ['tpl_timing_belt', 'Cinghia di distribuzione', 'maintenance', L, 120000, 60, 'exact', null, 90, 5000, [90, 30, 7, 0], ['combustion'], 0, 1,
    'Molto variabile (molte auto hanno la catena): attivala solo se il libretto la prevede e imposta tu l\'intervallo.'],
  ['tpl_brake_fluid', 'Liquido freni', 'maintenance', L, null, 24, 'exact', null, 30, 0, [30, 7, 0], null, 1, 1,
    'Di norma ogni 2 anni: verifica sul libretto uso e manutenzione.'],
  ['tpl_coolant', 'Liquido refrigerante', 'maintenance', L, 60000, 48, 'exact', null, 60, 3000, [30, 7, 0], ['combustion'], 1, 1, null],
  ['tpl_brake_inspection', 'Controllo freni (pastiglie e dischi)', 'maintenance', L, 20000, 12, 'exact', null, 30, 1500, [14, 0], null, 1, 1, null],
  ['tpl_battery_check', 'Controllo batteria 12V', 'maintenance', L, null, 12, 'exact', null, 30, 0, [14, 0], null, 1, 1, null],
  ['tpl_battery_replace', 'Sostituzione batteria 12V', 'maintenance', L, null, 60, 'exact', null, 60, 0, [60, 14, 0], null, 0, 1,
    'Durata tipica 4-6 anni, molto variabile.'],
  ['tpl_wipers', 'Spazzole tergicristallo', 'maintenance', L, null, 12, 'exact', null, 21, 0, [7, 0], null, 1, 1, null],
  ['tpl_ac_service', 'Climatizzatore: sanificazione/ricarica', 'maintenance', L, null, 24, 'exact', null, 30, 0, [14, 0], null, 0, 1, null],
  ['tpl_gearbox_oil', 'Olio cambio', 'maintenance', L, 90000, 72, 'exact', null, 60, 5000, [30, 7, 0], null, 0, 1,
    'Molto variabile e a volte "a vita": imposta tu l\'intervallo.'],
  ['tpl_ev_service', 'Controllo veicolo elettrico', 'maintenance', L, 30000, 24, 'exact', null, 30, 2000, [14, 3, 0], ['bev'], 1, 1, null],
  ['tpl_tyre_rotation', 'Rotazione pneumatici', 'tyres', L, 10000, null, 'exact', null, 14, 1000, [7, 0], null, 0, 1, null],
  // --- controlli a mano (non esistono PID OBD standard)
  ['tpl_check_oil_level', 'Controlla livello olio motore', 'check', L, 1000, 1, 'exact', null, 3, 200, [0], ['combustion'], 1, 1,
    'Motore freddo, auto in piano, con l\'astina. Registra OK / basso / rabboccato.'],
  ['tpl_check_tyre_pressure', 'Controlla pressione pneumatici (a freddo)', 'check', L, null, 1, 'exact', null, 3, 0, [0], null, 1, 1,
    'A freddo e prima dei viaggi lunghi; valori sul libretto o sull\'adesivo del montante.'],
  ['tpl_check_coolant_washer', 'Controlla refrigerante e lavavetri', 'check', L, null, 1, 'exact', null, 3, 0, [0], ['combustion'], 0, 1, null],
  ['tpl_check_adblue', 'Controlla AdBlue', 'check', L, 2000, null, 'exact', null, 0, 500, [0], ['diesel'], 0, 1,
    'Quando il cruscotto segnala meno di circa 2.000 km di autonomia.'],
  // --- cambio gomme stagionale (date di calendario annuali)
  ['tpl_tyres_winter', 'Montaggio gomme invernali', 'tyres', C, null, 12, 'exact', [11, 15], 21, 0, [14, 3, 0], null, 0, 0,
    'Obbligo invernali o catene a bordo dal 15 novembre al 15 aprile sulle strade con ordinanza.'],
  ['tpl_tyres_summer', 'Montaggio gomme estive', 'tyres', C, null, 12, 'exact', [4, 15], 21, 0, [14, 3, 0], null, 0, 0,
    'Se le invernali hanno indice di velocita\' inferiore al libretto vanno sostituite dal 15 maggio al 15 ottobre.'],
];

export const toRow = (t, i) => {
  const [id, name_it, category, schedule_type, interval_km, interval_months, period_end, anchor, soon_days, soon_km, offsets, applies, default_enabled, is_indicative, note_it] = t;
  return {
    id, name_it, category, schedule_type, interval_km, interval_months, period_end,
    anchor_month: anchor ? anchor[0] : null, anchor_day: anchor ? anchor[1] : null,
    soon_days, soon_km, notify_offsets_days: JSON.stringify(offsets), applies_to: applies ? JSON.stringify(applies) : null,
    default_enabled, is_indicative, note_it, sort_order: (i + 1) * 10, version: 1,
  };
};
```

Tutti i template in forma leggibile (generata dal codice sopra; `km`/`mesi` sono gli intervalli, "il primo dei due" se ci sono entrambi):

| id | nome | categoria | tipo | km | mesi | a fine mese | scad. annuale (g/m) | preavvisi (giorni prima) | si applica a | attivo di default | indicativo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tpl_inspection` | Revisione periodica | legale | dall'ultimo fatto | - | 24 | si | - | [60,30,14,7,0] | tutti | si | no |
| `tpl_road_tax` | Bollo auto | legale | serie di calendario | - | 12 | - | - | [30,15,7,0] | tutti | si | no |
| `tpl_gas_cylinder` | Riqualifica bombola GPL/metano | legale | data fissa | - | - | - | - | [90,30,7,0] | gas | si | no |
| `tpl_gas_system_check` | Controllo impianto GPL/metano | manut. | dall'ultimo fatto | - | 12 | - | - | [14,3,0] | gas | si | si |
| `tpl_service_main` | Tagliando | manut. | dall'ultimo fatto | 15000 | 12 | - | - | [14,3,0] | tutti | si | si |
| `tpl_oil_change` | Cambio olio motore e filtro | manut. | dall'ultimo fatto | 15000 | 12 | - | - | [14,3,0] | combustion | si | si |
| `tpl_cabin_filter` | Filtro abitacolo | manut. | dall'ultimo fatto | 15000 | 12 | - | - | [14,0] | tutti | si | si |
| `tpl_air_filter` | Filtro aria motore | manut. | dall'ultimo fatto | 30000 | 24 | - | - | [14,0] | combustion | si | si |
| `tpl_fuel_filter` | Filtro carburante | manut. | dall'ultimo fatto | 30000 | 24 | - | - | [14,0] | diesel | si | si |
| `tpl_spark_plugs` | Candele | manut. | dall'ultimo fatto | 60000 | 48 | - | - | [30,7,0] | petrol | si | si |
| `tpl_timing_belt` | Cinghia di distribuzione | manut. | dall'ultimo fatto | 120000 | 60 | - | - | [90,30,7,0] | combustion | no | si |
| `tpl_brake_fluid` | Liquido freni | manut. | dall'ultimo fatto | - | 24 | - | - | [30,7,0] | tutti | si | si |
| `tpl_coolant` | Liquido refrigerante | manut. | dall'ultimo fatto | 60000 | 48 | - | - | [30,7,0] | combustion | si | si |
| `tpl_brake_inspection` | Controllo freni (pastiglie e dischi) | manut. | dall'ultimo fatto | 20000 | 12 | - | - | [14,0] | tutti | si | si |
| `tpl_battery_check` | Controllo batteria 12V | manut. | dall'ultimo fatto | - | 12 | - | - | [14,0] | tutti | si | si |
| `tpl_battery_replace` | Sostituzione batteria 12V | manut. | dall'ultimo fatto | - | 60 | - | - | [60,14,0] | tutti | no | si |
| `tpl_wipers` | Spazzole tergicristallo | manut. | dall'ultimo fatto | - | 12 | - | - | [7,0] | tutti | si | si |
| `tpl_ac_service` | Climatizzatore: sanificazione/ricarica | manut. | dall'ultimo fatto | - | 24 | - | - | [14,0] | tutti | no | si |
| `tpl_gearbox_oil` | Olio cambio | manut. | dall'ultimo fatto | 90000 | 72 | - | - | [30,7,0] | tutti | no | si |
| `tpl_ev_service` | Controllo veicolo elettrico | manut. | dall'ultimo fatto | 30000 | 24 | - | - | [14,3,0] | bev | si | si |
| `tpl_tyre_rotation` | Rotazione pneumatici | gomme | dall'ultimo fatto | 10000 | - | - | - | [7,0] | tutti | no | si |
| `tpl_check_oil_level` | Controlla livello olio motore | controllo | dall'ultimo fatto | 1000 | 1 | - | - | [0] | combustion | si | si |
| `tpl_check_tyre_pressure` | Controlla pressione pneumatici (a freddo) | controllo | dall'ultimo fatto | - | 1 | - | - | [0] | tutti | si | si |
| `tpl_check_coolant_washer` | Controlla refrigerante e lavavetri | controllo | dall'ultimo fatto | - | 1 | - | - | [0] | combustion | no | si |
| `tpl_check_adblue` | Controlla AdBlue | controllo | dall'ultimo fatto | 2000 | - | - | - | [0] | diesel | no | si |
| `tpl_tyres_winter` | Montaggio gomme invernali | gomme | serie di calendario | - | 12 | - | 15/11 | [14,3,0] | tutti | no | no |
| `tpl_tyres_summer` | Montaggio gomme estive | gomme | serie di calendario | - | 12 | - | 15/4 | [14,3,0] | tutti | no | no |

Tag veicolo usati da `applies_to` (derivati nel dominio da `powertrain` e alimentazioni, **mai** salvati): `combustion` (non BEV/FCEV), `petrol`, `diesel`, `gas` (GPL o metano, primario o secondario), `bev`. Un template si applica se **almeno uno** dei suoi tag e' presente (`NULL` = tutti).

Upsert dei cataloghi (eseguito a ogni avvio dopo le migrazioni; idempotente, testato: due esecuzioni = 27 righe, stessa versione non sovrascrive, versione piu' alta si'). Gli item gia' creati dagli utenti non vengono toccati.

```sql
INSERT INTO service_templates
  (id, version, name_it, category, schedule_type, interval_km, interval_months, period_end, anchor_month, anchor_day,
   soon_days, soon_km, notify_offsets_days, applies_to, default_enabled, is_indicative, note_it, sort_order)
VALUES (:id, :version, :name_it, :category, :schedule_type, :interval_km, :interval_months, :period_end, :anchor_month, :anchor_day,
   :soon_days, :soon_km, :notify_offsets_days, :applies_to, :default_enabled, :is_indicative, :note_it, :sort_order)
ON CONFLICT(id) DO UPDATE SET
  version = excluded.version, name_it = excluded.name_it, category = excluded.category, schedule_type = excluded.schedule_type,
  interval_km = excluded.interval_km, interval_months = excluded.interval_months, period_end = excluded.period_end,
  anchor_month = excluded.anchor_month, anchor_day = excluded.anchor_day, soon_days = excluded.soon_days, soon_km = excluded.soon_km,
  notify_offsets_days = excluded.notify_offsets_days, applies_to = excluded.applies_to, default_enabled = excluded.default_enabled,
  is_indicative = excluded.is_indicative, note_it = excluded.note_it, sort_order = excluded.sort_order
WHERE excluded.version > service_templates.version;
```

Le categorie di spesa di sistema (`sys_*`) si caricano con lo stesso schema (`ON CONFLICT(id) DO UPDATE SET name_it=..., icon=..., sort_order=...`), mentre le categorie create dall'utente (id ULID, `is_system=0`) non vengono mai toccate.

**Istanziazione dei template su un veicolo** (wizard "Imposta le scadenze", use case `applyTemplates(vehicleId, templateIds)`):

- si propongono i template con `default_enabled=1` il cui `applies_to` e' compatibile; l'utente puo' spuntare/aggiungere gli altri;
- per ogni template scelto si crea un `maintenance_item` copiando regole e preavvisi (`template_id`, `template_version` per tracciare l'origine);
- **ultimo intervento** (`baseline_on/baseline_km`): il wizard chiede "quando l'hai fatto l'ultima volta?" con tre risposte: data e km noti / non lo so / mai fatto. Con "non lo so" non si inventa nulla: l'item resta *da configurare* e non produce notifiche;
- **revisione**: se esiste `first_registration_on` e il veicolo ha meno di 4 anni, si imposta `baseline_on = first_registration_on + 24 mesi` (cosi' la prima scadenza risulta immatricolazione + 48 mesi, a fine mese); se ha piu' di 4 anni l'utente inserisce la data dell'ultima revisione dal tagliando;
- **bollo, bombola, gomme stagionali** (`interval_calendar`/`fixed_date`): si chiede la prossima data utile; per i template con `anchor_month/day` (gomme) si propone la prossima occorrenza futura di quel giorno;
- **RC auto** non e' un template: il promemoria nasce dalla polizza (`insurance_policies.end_on`, sezione 3.9).

### 1.6 Query chiave (tutte eseguite sul DDL)

```sql
-- Home "Da fare": promemoria aperti, non rimandati, di veicoli attivi (usa ix_reminders_due)
SELECT r.*, v.nickname, v.make, v.model
FROM reminders r JOIN vehicles v ON v.id = r.vehicle_id
WHERE r.status = 'open' AND r.deleted_at IS NULL AND v.deleted_at IS NULL AND v.status = 'active'
  AND (r.snoozed_until IS NULL OR r.snoozed_until <= :now_iso)
ORDER BY r.effective_due_on IS NULL, r.effective_due_on
LIMIT 50;

-- Km attuali di un veicolo (stesso giorno: il piu' alto)
SELECT km, as_of FROM v_vehicle_odometer WHERE vehicle_id = ?;

-- Input per la media km/giorno: una lettura per giorno, solo valide
SELECT read_on, MAX(km) AS km FROM odometer_readings
WHERE vehicle_id = ? AND status = 'valid' AND deleted_at IS NULL GROUP BY read_on ORDER BY read_on;

-- Input del motore: regole + ultimo fatto
SELECT i.*, d.last_done_on, d.last_done_km
FROM maintenance_items i JOIN v_item_last_done d ON d.item_id = i.id
WHERE i.vehicle_id = ? AND i.is_active = 1 AND i.deleted_at IS NULL;

-- Input dei consumi (l'algoritmo e' nel dominio): rifornimenti con km collegati
SELECT f.id, f.filled_on, f.quantity_milli, f.is_full, f.missed_before, o.km
FROM fuel_logs f LEFT JOIN odometer_readings o ON o.fuel_log_id = f.id AND o.deleted_at IS NULL
WHERE f.vehicle_id = ? AND f.deleted_at IS NULL AND f.fuel_type = ?
ORDER BY f.filled_on, f.created_at, f.id;

-- Costi per anno e fonte
SELECT substr(on_date,1,4) AS anno, source, SUM(cents) AS cents
FROM v_costs WHERE vehicle_id = ? GROUP BY anno, source ORDER BY anno DESC;

-- Olio rabboccato nell'anno (indizio di consumo anomalo)
SELECT COALESCE(SUM(added_ml),0) FROM fluid_checks
WHERE vehicle_id = ? AND fluid = 'engine_oil' AND checked_on BETWEEN :from AND :to AND deleted_at IS NULL;
```

Piano della query Home verificato con `EXPLAIN QUERY PLAN`: `SCAN reminders USING INDEX ix_reminders_due` (nessun sort temporaneo). A questi volumi (decine di righe) ogni query e' sotto il millisecondo: non servono cache ne' ORM per le prestazioni.


## 2. Migrazioni e seed dei template

### 2.1 Principi

1. **Solo in avanti**: migrazioni numerate 1..N consecutive, ognuna in **una transazione esclusiva** che include anche l'inserimento in `migrations_log` e `PRAGMA user_version = N` (transazionale: verificato che il rollback riporta la versione indietro). Nessuna migrazione "down": si ripristina dalla copia di sicurezza.
2. **Mai modificare una migrazione gia' rilasciata**: `migrations_log.checksum` lo rileva (errore in sviluppo, avviso in produzione). Una correzione e' una nuova migrazione.
3. **Additivo per default** (`CREATE TABLE`, `CREATE INDEX`, `ADD COLUMN` con default): non richiede ricostruzioni. La ricostruzione di tabella serve solo per cambiare un `CHECK`, un tipo, una FK o una colonna (ricetta 2.3). Cambi distruttivi con **expand/contract**: aggiungi la nuova colonna, riempi, passa il codice, elimina la vecchia in una release successiva.
4. **Copia di sicurezza prima di migrare** un DB che contiene gia' dati: `VACUUM INTO '<dir>/backups/pre-v<from>-to-v<to>-<timestamp>.db'` (copia consistente anche in WAL, senza chiudere la connessione, verificato su SQLite 3.53.3; non puo' essere eseguito dentro una transazione). Si tengono le ultime 3 e si cancellano dopo 2 avvii riusciti. Il percorso di destinazione dentro expo-sqlite va verificato su dispositivo (confidenza media).
5. **App piu' vecchia del DB** (tipico dopo l'import di un backup fatto con una versione piu' nuova): `SchemaTooNewError` -> schermata "Aggiorna AutoGarage", nessuna scrittura.
6. **Un solo processo migra**: lo fa l'app all'avvio in primo piano, prima di qualsiasi lettura. Il task in background apre il DB, controlla che `user_version` sia l'ultimo noto e altrimenti esce senza fare nulla.
7. **Cataloghi e impostazioni di default non sono nelle migrazioni**: si caricano da codice con upsert idempotente a ogni avvio (1.5); le migrazioni contengono solo struttura e, se serve, trasformazioni di dati dell'utente.
8. **Formato di backup disaccoppiato dallo schema**: il JSON esportato ha il proprio `formatVersion` (sezione 5); lo schema puo' cambiare senza rompere i vecchi backup perche' l'import passa per upgrader del *formato*.

### 2.2 Il runner (codice eseguito e testato)

`src/data/db/migrate.ts`. Dipende solo dalla porta `SqlDatabase` (sezione 8); in produzione la implementa un adattatore su `expo-sqlite` (`withExclusiveTransactionAsync` per `transaction(fn,'exclusive')`), nei test un adattatore su `node:sqlite` (qui sotto, 20 righe).

```js
// src/data/db/migrate.ts  (stesso codice + tipi; SqlDatabase e' la porta del livello dati)
export class SchemaTooNewError extends Error {
  constructor(found, supported) {
    super(`DB schema v${found} piu' nuovo dell'app (supporta fino a v${supported})`);
    this.name = 'SchemaTooNewError';
  }
}

/**
 * @param db         SqlDatabase (exec/run/all/get/transaction)
 * @param migrations [{ version, name, up: string[], rebuildsTables?: boolean }], versioni 1..N consecutive
 * @param opts       { appVersion, hash(text)=>string, backup?(from,to)=>Promise<void>, strictChecksums? }
 */
export async function migrate(db, migrations, opts) {
  const ms = [...migrations].sort((a, b) => a.version - b.version);
  ms.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migrazioni non consecutive: atteso v${i + 1}, trovato v${m.version}`);
  });
  const latest = ms.length;
  const { user_version: current } = await db.get('PRAGMA user_version');
  if (current > latest) throw new SchemaTooNewError(current, latest);
  if (current === 0) {
    const { n } = await db.get(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
    if (n > 0) throw new Error('database non vuoto ma user_version = 0: file sconosciuto, non lo tocco');
  }
  const pending = ms.filter((m) => m.version > current);
  // copia di sicurezza PRIMA di toccare lo schema di un DB che contiene gia' dati
  if (pending.length > 0 && current > 0 && opts.backup) await opts.backup(current, latest);
  for (const m of pending) {
    if (m.rebuildsTables) await db.exec('PRAGMA foreign_keys = OFF'); // e' un no-op dentro una transazione: va fuori
    try {
      await db.transaction(async (tx) => {
        for (const sql of m.up) await tx.exec(sql);
        if (m.rebuildsTables) {
          const bad = await tx.all('PRAGMA foreign_key_check');
          if (bad.length > 0) throw new Error(`FK violate dopo la migrazione ${m.version}: ${JSON.stringify(bad[0])}`);
        }
        await tx.run('INSERT INTO migrations_log (version, name, checksum, app_version) VALUES (?, ?, ?, ?)', [
          m.version, m.name, opts.hash(m.up.join(';\n')), opts.appVersion,
        ]);
        await tx.exec(`PRAGMA user_version = ${m.version}`); // transazionale: torna indietro con il rollback
      }, 'exclusive');
    } finally {
      if (m.rebuildsTables) await db.exec('PRAGMA foreign_keys = ON');
    }
  }
  // rileva migrazioni gia' applicate e poi modificate nel sorgente (errore da sviluppatore)
  const applied = await db.all('SELECT version, checksum FROM migrations_log');
  for (const a of applied) {
    const m = ms[a.version - 1];
    if (m && opts.hash(m.up.join(';\n')) !== a.checksum) {
      const msg = `migrazione ${a.version} (${m.name}) modificata dopo l'applicazione`;
      if (opts.strictChecksums) throw new Error(msg);
      console.warn(msg);
    }
  }
  return { from: current, to: latest, applied: pending.map((m) => m.version) };
}
```

Adattatore di test su Node (stessa interfaccia che implementera' l'adattatore expo-sqlite; permette di eseguire migrazioni, repository e motore su un PC Windows senza Android SDK):

```js
// tests/support/nodeSqlite.ts: implementazione della porta SqlDatabase su node:sqlite (solo per test su PC)
import { DatabaseSync } from 'node:sqlite';

export function openNodeDb(path = ':memory:') {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON');
  const api = {
    raw,
    async exec(sql) { raw.exec(sql); },
    async run(sql, params = []) { const r = raw.prepare(sql).run(...params); return { changes: Number(r.changes) }; },
    async all(sql, params = []) { return raw.prepare(sql).all(...params).map((r) => ({ ...r })); },
    async get(sql, params = []) { const r = raw.prepare(sql).get(...params); return r ? { ...r } : undefined; },
    async transaction(fn, mode = 'deferred') {
      raw.exec(mode === 'exclusive' ? 'BEGIN EXCLUSIVE' : 'BEGIN');
      try { const out = await fn(api); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
    async close() { raw.close(); },
  };
  return api;
}
```

### 2.3 Ricetta per ricostruire una tabella (codice eseguito e testato)

Esempio reale: aggiungere il tipo di carburante `lng` al `CHECK` di `fuel_logs`. Trappole verificate:

- `PRAGMA foreign_keys = OFF` va eseguito **fuori** dalla transazione (dentro e' un no-op): lo fa il runner quando `rebuildsTables: true`, e prima del COMMIT esegue `PRAGMA foreign_key_check` (se restituisce righe, rollback totale).
- Le **viste** che citano la tabella vanno eliminate e ricreate: verificato che altrimenti `ALTER TABLE ... RENAME` fallisce con `error in view ...: no such table`.
- `DROP TABLE` porta via indici e trigger: vanno ricreati (compreso `trg_<tabella>_touch`).
- Le FK delle altre tabelle verso quella ricostruita (qui `odometer_readings.fuel_log_id`, `attachments.fuel_log_id`) restano valide perche' puntano per nome; verificato che la cascata continua a funzionare.
- Elencare **sempre le colonne** nell'`INSERT ... SELECT`.

```js
// Esempio di migrazione 0002 con ricostruzione di tabella: aggiunge il tipo 'lng' al CHECK di fuel_logs.
// (SQLite non permette ALTER di un CHECK: ricetta ufficiale "12 passi" adattata, con viste da ricreare.)
export const m2 = {
  version: 2,
  name: 'fuel_type_lng',
  rebuildsTables: true, // il runner spegne foreign_keys fuori dalla transazione e fa foreign_key_check prima del COMMIT
  up: [
    `DROP VIEW v_costs`, // le viste che citano la tabella vanno eliminate e ricreate, altrimenti RENAME fallisce
    `CREATE TABLE fuel_logs_new (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 26),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  filled_on TEXT NOT NULL CHECK (date(filled_on) IS filled_on),
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('petrol','diesel','lpg','cng','lng','electric','hydrogen','adblue')),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('L','kg','kWh')),
  unit_price_milli INTEGER CHECK (unit_price_milli BETWEEN 0 AND 100000000),
  total_cents INTEGER NOT NULL CHECK (total_cents BETWEEN 0 AND 100000000000),
  is_full INTEGER NOT NULL DEFAULT 1 CHECK (is_full IN (0, 1)),
  missed_before INTEGER NOT NULL DEFAULT 0 CHECK (missed_before IN (0, 1)),
  station TEXT CHECK (length(station) <= 80),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  CHECK ((quantity_unit = 'L'   AND fuel_type IN ('petrol','diesel','lpg','adblue'))
      OR (quantity_unit = 'kg'  AND fuel_type IN ('cng','lng','hydrogen'))
      OR (quantity_unit = 'kWh' AND fuel_type = 'electric'))
) STRICT`,
    `INSERT INTO fuel_logs_new (id, vehicle_id, filled_on, fuel_type, quantity_milli, quantity_unit, unit_price_milli,
   total_cents, is_full, missed_before, station, notes, created_at, updated_at, deleted_at)
 SELECT id, vehicle_id, filled_on, fuel_type, quantity_milli, quantity_unit, unit_price_milli,
   total_cents, is_full, missed_before, station, notes, created_at, updated_at, deleted_at FROM fuel_logs`,
    `DROP TABLE fuel_logs`, // porta via anche i suoi indici e trigger: vanno ricreati
    `ALTER TABLE fuel_logs_new RENAME TO fuel_logs`,
    `CREATE INDEX ix_fuel_vehicle_date ON fuel_logs(vehicle_id, filled_on DESC) WHERE deleted_at IS NULL`,
    `CREATE TRIGGER trg_fuel_logs_touch AFTER UPDATE ON fuel_logs WHEN NEW.updated_at IS OLD.updated_at
BEGIN UPDATE fuel_logs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END`,
    `CREATE VIEW v_costs AS
SELECT vehicle_id, service_on AS on_date, 'service' AS source, id AS source_id, total_cents AS cents
  FROM service_records WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, filled_on, 'fuel', id, total_cents FROM fuel_logs WHERE deleted_at IS NULL
UNION ALL SELECT vehicle_id, spent_on, 'expense', id, amount_cents FROM expenses WHERE deleted_at IS NULL
UNION ALL SELECT p.vehicle_id, ip.paid_on, 'insurance', ip.id, ip.amount_cents
  FROM insurance_payments ip JOIN insurance_policies p ON p.id = ip.policy_id
  WHERE ip.paid_on IS NOT NULL AND ip.deleted_at IS NULL AND p.deleted_at IS NULL`,
  ],
};
```

### 2.4 Test delle migrazioni (18 controlli eseguiti, tutti passati)

Verificati con Node: installazione pulita 0 -> 1; upgrade 1 -> 2 con ricostruzione (dati preservati, `foreign_key_check` vuoto, `foreign_keys` di nuovo ON, nuovo valore del CHECK accettato, vista/indice/trigger ricreati, cascata ancora attiva); copia pre-migrazione con `VACUUM INTO` apribile e con `user_version = 1`; rieseguire = no-op; migrazione rotta a meta' -> rollback completo e `user_version` invariato; DB piu' nuovo dell'app -> `SchemaTooNewError`; migrazione modificata dopo l'applicazione -> errore; numerazione con buchi rifiutata; DB non vuoto con `user_version = 0` rifiutato.

Da mettere in CI (Vitest/Jest + `node:sqlite`):

1. **Snapshot dello schema**: applica 1..N su DB vuoto, esporta `SELECT type,name,sql FROM sqlite_master ORDER BY 1,2` e confrontalo con `schema.snapshot.sql` committato; una modifica involontaria a una migrazione vecchia fa fallire il test.
2. **Upgrade da fixture**: per ogni versione rilasciata si conserva un DB di esempio (`tests/fixtures/db/vN.sqlite`, con dati sintetici e **senza** targhe/VIN reali) che si migra fino all'ultima versione, poi `integrity_check`, `foreign_key_check` e le query chiave.
3. **Test sul DDL** (come quelli di 1.4) rieseguiti a ogni cambio di schema.

### 2.5 Sequenza di avvio (boot)

1. Apri il DB (con chiave solo se la protezione avanzata e' attiva, sezione 6) e imposta i PRAGMA (1.1).
2. `migrate()` (con copia di sicurezza). Errore -> schermata di recupero con "Esporta DB grezzo" e "Ripristina da backup", mai crash silenzioso.
3. Upsert cataloghi (template, categorie di sistema) e `INSERT OR IGNORE` delle impostazioni di default.
4. Manutenzione: svuota il cestino oltre 30 giorni, processa `pending_file_deletions`, applica la retention della telemetria (4.x/1.4).
5. `reconcileReminders()` (sezione 3.9) e poi `planNotifications()` (sezione 4).
6. Mostra la Home.

Impostazioni di default (`app_settings`, valori JSON; **nessun segreto**):

| chiave | default | note |
|---|---|---|
| `device.id` | ULID generato al primo avvio | serve alla sync futura e al tie-break LWW |
| `units.distance` | `"km"` | default per i nuovi veicoli |
| `notify.enabled` / `notify.time` | `true` / `"09:00"` | l'ora locale della notifica; 09:00 evita le finestre dell'ora legale (02:00-03:00) |
| `notify.privacy` | `"generic"` | `generic` non mostra la targa sul blocco schermo |
| `notify.maxScheduled` | `60` | sotto il tetto iOS di 64 (sezione 4) |
| `forecast.windowDays` / `forecast.halfLifeDays` | `180` / `90` | parametri della media km/giorno (sezione 3.4) |
| `forecast.defaultAnnualKm` | `12000` | **segnaposto a bassa confidenza**, usato solo come ultima risorsa e sempre etichettato "stima iniziale"; non verificato su una fonte |
| `telemetry.rawRetentionDays` / `telemetry.maxMb` | `30` / `50` | retention dei campioni grezzi |
| `trash.retentionDays` | `30` | cestino |
| `lock.enabled` / `lock.timeoutSeconds` | `false` / `60` | blocco app (sezione 6) |
| `backup.lastExportAt` / `backup.nudgeDays` | `null` / `30` | promemoria "fai un backup" |
| `onboarding.done` | `false` | |


## 3. Motore promemoria

Il motore e' **TypeScript puro** (`src/domain/`): nessun import da React, Expo o SQLite, nessun accesso all'orologio (`today` e' un parametro), nessun fuso orario (solo date di calendario). Il codice di riferimento in 3.11 e' stato eseguito con 53 controlli (vettori in 3.10), tutti passati; in produzione e' lo stesso codice con i tipi.

### 3.1 Concetti e invarianti

| Concetto | Tabella | Cosa e' | Chi lo scrive |
|---|---|---|---|
| **Regola** | `maintenance_items` | "Cambio olio: ogni 15.000 km o 12 mesi, il primo dei due" | utente / wizard |
| **Storico** | `maintenance_completions` | "fatto il 2026-03-01 a 40.000 km" (append-only, annullabile con soft delete) | casi d'uso (intervento salvato, "segna fatto") |
| **Occorrenza** | `reminders` | "il prossimo cambio olio: scade il ..., stato, snooze" (1 aperto per regola) | il **motore** (cache) + l'utente (snooze, saltato, manuali) |

Invarianti (testabili):

1. **I1** al massimo un promemoria `open` per item, per polizza e per rata (indici unici parziali nel DDL).
2. **I2** il motore non modifica mai dati inseriti dall'utente (km, interventi, regole): scrive solo le colonne cache dei promemoria *generati* (`due_on, due_km, forecast_on, forecast_confidence, effective_due_on, due_trigger, computed_at`) e crea/chiude promemoria generati.
3. **I3** nessun dato inventato: se manca un ingrediente il risultato e' `unknown` oppure la parte mancante viene ignorata con un codice in `reasons` (`NO_LAST_DONE`, `NO_LAST_KM`, `NO_FIXED_DATE`, `NO_ODOMETER`, `RATE_TOO_LOW`, `FORECAST_BEYOND_10Y`); la UI spiega cosa chiedere all'utente.
4. **I4** ogni calcolo e' una funzione pura di (regola, ultimo fatto, letture km, oggi): stesso input, stesso output; per questo si testa con vettori.
5. **I5** le cache dei promemoria si possono sempre buttare e ricostruire (`reconcileReminders`, 3.9).

### 3.2 I tre tipi di regola (`schedule_type`)

| Tipo | Scade quando | Dopo il completamento | Esempi |
|---|---|---|---|
| `interval_last_done` | **primo fra** (ultimo fatto + `interval_months`, con `period_end`) **e** (km dell'ultimo fatto + `interval_km`). Se c'e' un solo intervallo conta solo quello | la base diventa il nuovo fatto (data e km *reali*, non quelli teorici) | tagliando, olio, filtri, freni, revisione (24 mesi, fine mese) |
| `interval_calendar` | alla data `fixed_due_on`; la serie avanza di `interval_months` | `fixed_due_on` = prima data della serie **dopo** la data del completamento; la serie non scivola col ritardo | bollo, cambio gomme stagionale |
| `fixed_date` | alla data `fixed_due_on` | `fixed_due_on` diventa NULL (stato `unknown`) finche' l'utente non inserisce la nuova scadenza | riqualifica bombola, scadenze una tantum |

Il valore precedente di `fixed_due_on` si salva in `maintenance_completions.prev_fixed_due_on`, cosi' "annulla" lo ripristina esattamente.

### 3.3 Algoritmo di valutazione (`evaluateRule` / `evaluateThresholds`)

Input: regola, `lastDone` (ultimo completamento, oppure `baseline_on/baseline_km` dell'item), letture km, dati del veicolo, `today`.

1. **Tempo**: `dueOn = addMonths(lastDone.on, interval_months)` (con *clamp* a fine mese: 31 gen + 1 mese = 28 feb; 29 feb 2024 + 12 mesi = 28 feb 2025); se `period_end = end_of_month` si porta a fine mese (revisione). Per `interval_calendar` e `fixed_date` e' `fixed_due_on`. Mancano dati -> `dueOn = null` + motivo.
2. **Km**: `dueKm = lastDone.km + interval_km`. Se l'ultimo fatto non ha i km si **interpolano** dallo storico delle letture alla data (solo *dentro* l'intervallo delle letture, mai estrapolando); se non si puo', `dueKm = null` + `NO_LAST_KM`.
3. **Km attuali**: l'ultima lettura valida (una per giorno, la piu' alta). Se `curKm >= dueKm` i km sono **gia' raggiunti**: `forecastOn = data della lettura`, `kmReached = true`.
4. **Previsione**: altrimenti `forecastOn = data_ultima_lettura + ceil((dueKm - curKm) / kmPerDay)` con la media di 3.4 (oltre 10 anni -> nessuna previsione). Il `ceil` usa un epsilon: senza, 6440 / 40,000000000000007 diventava 162 invece di 161 giorni (bug trovato dal vettore V3).
5. **Il primo dei due**: `effectiveDueOn = min(dueOn, forecastOn)` ignorando i null; `trigger` = `time` | `km` | `both`; `estimated = true` se vince la previsione e i km non sono ancora raggiunti (la UI scrive "circa", "stima").
6. **Stato** (3.5).

Perche' la data di una scadenza a km e' una **stima ricalcolata**: l'utente non aggiorna i km ogni giorno. Le tre difese: (a) la previsione parte dall'ultima lettura e avanza col tempo, quindi un promemoria "per km" diventa comunque `overdue (stimato)` anche se nessuno aggiorna l'odometro (vettore V7); (b) la Home mostra "Aggiorna i km" quando l'ultima lettura ha piu' di 30 giorni e c'e' una scadenza a km entro 90 giorni; (c) l'OBD e i rifornimenti aggiungono letture gratis.

### 3.4 Media km/giorno robusta con pochi dati (`estimateKmPerDay`)

Obiettivo: una stima ragionevole gia' con 2 letture, che migliora da sola, senza mai oscillare per una gita o un errore di digitazione.

Parametri (modificabili in `app_settings`, default sotto):

| Parametro | Default | Ruolo |
|---|---|---|
| `windowDays` | 180 | finestra mobile: contano le letture degli ultimi 180 giorni **piu'** l'ultima lettura precedente (ancora) |
| `halfLifeDays` | 90 | decadimento esponenziale dei pesi: un segmento di 90 giorni fa pesa la meta' di uno di oggi |
| `minSegDays` | 7 | segmenti piu' corti si fondono col successivo: evita denominatori minuscoli (due letture a 1 giorno di distanza) |
| `clampMultiple` | 3 | con almeno 3 segmenti nessuno conta piu' di 3 volte la **mediana pesata** (taglia i picchi) |
| `fullTrustDays` | 90 | con meno di 90 giorni di dati la stima e' una miscela con il prior: `lambda = min(1, span/90)` |
| `maxKmPerDay` / `minKmPerDay` | 1500 / 0,5 | tetto di sanita'; sotto 0,5 km/g l'auto e' "ferma": nessuna previsione (`confidence = none`) |
| `defaultAnnualKm` | 12000 | prior di ultima istanza (segnaposto a bassa confidenza, sezione 2.5) |

Passi:

1. una lettura per giorno (la piu' alta), solo fino a oggi; si tengono quelle nella finestra piu' l'ancora;
2. segmenti fra letture consecutive (fusione dei segmenti < 7 giorni); tasso `r = deltaKm / giorni` per segmento;
3. peso `w = giorni * 0.5^(eta_del_segmento / 90)`: la media pesata per durata coincide con la pendenza fra gli estremi (km totali / giorni totali), quindi una gita *conta quanto dura*, non quanto e' intensa;
4. con >= 3 segmenti si fa **winsorizing**: `r = min(r, 3 * mediana_pesata)`;
5. `measured = sum(w*r) / sum(w)`;
6. **prior**, in ordine: stima dell'utente (`annual_km_estimate / 365`) > media dalla prima immatricolazione (`km / giorni`, solo se il veicolo ha almeno 1 anno) > `defaultAnnualKm / 365`;
7. **restringimento**: `rate = lambda * measured + (1 - lambda) * prior` con `lambda = min(1, span / 90)`; senza dati misurati `rate = prior`;
8. **confidenza**: `high` = span >= 120 giorni e >= 4 punti; `medium` = span >= 45 e >= 3 punti; altrimenti `low` (anche se si usa solo il prior); se l'ultima lettura ha piu' di 60 giorni la confidenza scende di un livello; `none` se `rate < 0,5`.

Alternative scartate: media mobile semplice sugli ultimi N rifornimenti (rumorosa e dipende dall'abitudine di registrare i pieni), regressione robusta Theil-Sen (corretta ma sovradimensionata per decine di punti e meno spiegabile), uso della telemetria OBD (non universale, non necessaria).

Risultati verificati (oggi = 2026-10-07):

| Caso | Dati | Risultato |
|---|---|---|
| 20 giorni di dati | 30.000 km il 17/09, 30.400 il 07/10, stima utente 12.000 km/anno | misurato 20 km/g, prior 32,88, `lambda = 0,222` -> **30,015 km/g**, `blended`, `low` |
| Una lettura sola | 30.400 km, stima utente | solo prior (32,88), `low` |
| Nessun dato | niente | 12000/365 = 32,877 km/g, `low` (default segnaposto) |
| Dalla prima immatricolazione | 60.000 km, immatricolata 2021-10-07 | 60000/1826 = 32,86 km/g (`lifetime_average`) |
| Auto ferma | 5.000 km invariati in 180 giorni | `confidence = none`, nessuna previsione |
| Gita breve | letture 07/04 20.000, 07/07 23.000, 07/08 24.000, 07/09 25.000, 15/09 26.500 (8 giorni, 187,5 km/g), 07/10 27.300 | con clamp **37,13 km/g**, senza clamp 42,22; confidenza `high` |

### 3.5 Stati

| Stato | Condizione | Etichetta UI | Note |
|---|---|---|---|
| `unknown` | `effectiveDueOn = null` | "Da configurare" | nessuna notifica; la scheda chiede "quando l'hai fatto l'ultima volta?" |
| `ok` | oltre le soglie | "In regola" | |
| `soon` | `daysLeft <= soon_days` **oppure** `kmLeft <= soon_km` (se `soon_km > 0`) | "In arrivo" | `soon_days` default 30, `soon_km` 1.500; `daysLeft = 0` e' "Scade oggi" (`dueToday`), **non** scaduto |
| `overdue` | `daysLeft < 0` **oppure** `kmReached` | "Scaduto" | il giorno dopo la scadenza; per le stime "Probabilmente scaduto" |

Ordinamento: `overdue` (piu' in ritardo prima), poi `soon`, poi `ok` per data. Lo stato **non e' salvato** (dipende da `today`): si calcola in lettura da `effective_due_on` e dai km correnti.

### 3.6 Snooze

- Preset: "Domani alle 09:00", "Fra 3 giorni", "Fra 1 settimana", "Dopo N km" (default +500).
- `snoozed_until` e' un **istante UTC** (`T`): la UI lo calcola come data/ora locale scelta -> UTC. Per "dopo N km" si salva `snooze_until_km = curKm + N` **e** un `snoozed_until` di sicurezza a +30 giorni (cosi' un promemoria non resta zittito per sempre se l'utente non aggiorna i km).
- Lo snooze **non cambia la scadenza**: nasconde il promemoria dalla lista "Da fare" e dalle notifiche fino alla fine; scaduto lo snooze torna visibile e una notifica "rimandata" parte nell'istante di fine snooze (`kind = snoozed` nel piano, vettore V12).
- Se nel frattempo diventa `overdue` per km lo snooze **non** si annulla (scelta esplicita dell'utente); lo stato e' comunque visibile nella scheda del veicolo.
- Si puo' rimandare piu' volte; non c'e' limite per i promemoria, ma la UI mostra "rimandato N volte" dopo la terza.

### 3.7 Completamento e ricalcolo del prossimo

Caso d'uso `completeItem(itemId, { doneOn, doneKm?, serviceRecordId?, fluidCheckId? })`, **una transazione**:

1. validazioni: `doneOn <= today`; se `doneKm` conflitta con le letture vicine (`checkMonotonic`) la UI propone "correggi", "ignora il km" o "e' un errore del contachilometri precedente";
2. se c'e' `doneKm` e non esiste gia' una lettura per quel giorno/km, crea `odometer_readings` (`source` = `service` / `fluid_check` / `manual` secondo l'origine);
3. inserisce `maintenance_completions` (con `prev_fixed_due_on` = valore corrente di `fixed_due_on`);
4. tipo `interval_calendar`: `fixed_due_on = nextFixedDue(...)`; tipo `fixed_date`: `fixed_due_on = NULL`;
5. il promemoria aperto passa a `done` (`completed_on`, `completion_id`);
6. `reconcileReminders(vehicleId)` crea il prossimo promemoria aperto calcolato dalla **nuova base**;
7. a commit avvenuto: `planNotifications()`.

Regole di ricalcolo:

- Il prossimo intervallo parte dai valori **reali** del completamento (olio fatto a 13.000 km invece di 15.000: il prossimo e' a 13.000 + intervallo). E' il comportamento corretto per gli intervalli del costruttore.
- Un completamento **retrodatato** (piu' vecchio dell'ultimo) non cambia la base: l'"ultimo fatto" e' sempre quello con `done_on` piu' recente (vista `v_item_last_done`).
- **Annulla**: soft delete del completamento, ripristino di `fixed_due_on` da `prev_fixed_due_on`, riapertura del promemoria e riconciliazione. Un intervento (`service_record`) cancellato (soft delete) annulla anche i suoi completamenti, nella stessa transazione.
- **Un intervento che completa piu' voci** (tagliando = olio + filtri): la schermata "Cosa hai fatto?" propone le voci attive e crea un completamento per ciascuna (indice unico `(service_record_id, item_id)`).
- **Serie di calendario**: bollo con scadenza 2026-08-31 pagato il 10/08, il 02/10 o con oltre 16 mesi di ritardo (2028-01-10) -> prossima 2027-08-31, 2027-08-31 e 2028-08-31 (vettore V10): la serie non scivola con il ritardo.
- **Revisione** (`interval_last_done`, 24 mesi, fine mese): la nuova scadenza parte dalla data effettiva della revisione. Se la regola ministeriale per revisioni anticipate fosse diversa, l'utente puo' correggere la data (confidenza media: non verificato sul testo di legge).

### 3.8 Ricorrenze, fusi orari, ora legale

- **Ricorrenze dei promemoria manuali** (`repeat_every` + `repeat_unit` in day|week|month|year + `repeat_origin_on`): le occorrenze sono ancorate all'**origine**, non alla precedente (31 gen, 28 feb, 31 mar, 30 apr, 31 mag..., senza deriva a 28; 29 feb 2024 -> 28 feb 2025, 28 feb 2026, **29 feb 2028**). Alla chiusura si crea la prima occorrenza **dopo max(scadenza, oggi)**: se l'utente e' in ritardo di tre mesi, le occorrenze perse vengono saltate (come un calendario).
- Le ricorrenze dei promemoria *generati* non esistono: la ricorrenza e' la regola (`interval_*`).
- **Date di calendario, mai istanti**: la scadenza "30 novembre" e' una stringa `YYYY-MM-DD`. La differenza fra due date si calcola con numeri di giorno UTC (`Date.UTC`), quindi il 25 ottobre 2026 (25 ore) o il 28 marzo 2027 (23 ore) non alterano mai un conteggio di giorni.
- **Fuso e ora legale entrano solo nello strato notifiche**: il dominio produce "2026-10-30 alle 09:00 locali"; l'infrastruttura le converte in istante con `new Date(y, m-1, d, hh, mm)` del dispositivo. Semantica di ECMAScript verificata con `TZ=Europe/Rome` su Node 24 (confidenza media su Hermes: da provare su un telefono reale):
  - 24/10/2026 09:00 -> 07:00Z (CEST); **25/10/2026 09:00 -> 08:00Z** (CET, fine ora legale); 27/03/2027 09:00 -> 08:00Z; **28/03/2027 09:00 -> 07:00Z**;
  - ora **inesistente** 28/03/2027 02:30 -> 03:30 CEST (01:30Z): si sposta in avanti; ora **ripetuta** 25/10/2026 02:30 -> prima occorrenza (00:30Z);
  - l'ora di default delle notifiche e' **09:00** proprio per non cadere mai nella finestra 02:00-03:00 del cambio ora.
- **Cambio fuso** (viaggio, impostazioni): a ogni ritorno in primo piano si confronta il fuso IANA corrente (`Intl.DateTimeFormat().resolvedOptions().timeZone`) con quello salvato nel piano; se differisce si ripianifica tutto.

### 3.9 Riconciliazione dei promemoria (`reconcileReminders`)

Idempotente; si chiama (a) dopo ogni scrittura che riguarda km, interventi, regole, polizze, rate, impostazioni di promemoria; (b) all'avvio e a ogni ritorno in primo piano (`today` puo' essere cambiato); (c) dal task in background. Pseudocodice:

```
reconcileReminders(vehicleId, today):
  carica veicolo (se status != 'active' -> non genera e non notifica), item attivi con v_item_last_done,
         letture km, polizze, rate non pagate, promemoria aperti del veicolo
  per ogni item attivo:
      ev = evaluateRule(...)
      se ev.dueOn == null e ev.dueKm == null -> chiudi/soft-delete l'eventuale aperto (stato 'unknown': nessun promemoria)
      altrimenti upsert del promemoria aperto (1 per item):
          campi = { title: item.name, category, due_on, due_km, forecast_on, forecast_confidence,
                    effective_due_on, due_trigger, soon_days, soon_km, notify_offsets_days, computed_at }
          INSERT se manca, UPDATE solo se cambia qualcosa (non toccare snoozed_until, notes)
  per ogni coppia (veicolo, kind) di polizze: prendi la polizza con end_on massimo (non cancellata, non annullata)
      -> promemoria 'Scadenza <kind> <compagnia>' due_on = end_on, category 'insurance', preavvisi [30,14,7,1,0]
      -> i promemoria delle polizze precedenti dello stesso tipo passano a 'done' (rinnovate)
  per ogni rata non pagata (paid_on NULL): promemoria 'Rata n/N' due_on = due_on, preavvisi [7,1,0]; pagata -> 'done'
  promemoria manuali: aggiorna solo effective_due_on / forecast (se hanno due_km) dalla stessa evaluateThresholds
  promemoria generati orfani (item/polizza cancellati o disattivati) -> soft delete
  ritorna le modifiche: i dati sono gia' nel DB; poi planNotifications() (sezione 4)
```

Rate del premio alla creazione di una polizza (`splitInstallments`, verificato): n = 1 (single/annual), 2 (semestrale), 4 (trimestrale), 12 (mensile); importo base = `floor(premio/n)`, il resto in centesimi va sulla **prima** rata (480,01 EUR trimestrale -> 120,01 + 3 x 120,00); scadenze a `start_on + k*12/n mesi` con clamp (31/01 -> 30/04 -> 31/07 -> 31/10). Una polizza ha sempre almeno la rata 1.

Anti-duplicato fra polizza e item: l'RC auto **non** si modella come `maintenance_item`; per tagliando, revisione e bollo non esistono polizze. Il promemoria "Scadenza assicurazione" mostra una nota informativa sulla tolleranza di 15 giorni (verifica V5) senza spostare la data.

### 3.10 Vettori di test (eseguiti, 53 controlli; oggi = 2026-10-07 salvo diversa indicazione)

Date:

| # | Input | Atteso |
|---|---|---|
| V1a | `addMonths(2026-01-31, +1)` / `(2024-02-29, +12)` / `(2026-03-31, -1)` / `(2026-11-30, +3)` / `(2026-01-15, -13)` | 2026-02-28 / 2025-02-28 / 2026-02-28 / 2027-02-28 / 2024-12-15 |
| V1b | `endOfMonth(2026-02-10)`, `(2028-02-10)` | 2026-02-28, 2028-02-29 |
| V1c | `diffDays(2026-10-26, 2026-10-24)`; `addDays(2027-03-27, 2)` (attraversano il cambio ora) | 2; 2027-03-29 |

Regole:

| # | Input | Atteso |
|---|---|---|
| V2a | revisione (24 m, fine mese), ultima 2024-06-10 | dueOn 2026-06-30, `overdue`, daysLeft -99 |
| V2b | auto immatricolata 2023-03-15, baseline = +24 mesi | dueOn 2027-03-31, `ok`, daysLeft 175 |
| V2c | revisione senza ultimo fatto | `unknown`, `NO_LAST_DONE` |
| V3 | olio 15.000 km/12 m, ultimo 2026-03-01 @ 40.000; letture 40.000 (01/03), 44.880 (01/07), 48.560 (01/10) = 40 km/g | dueKm 55.000; forecast **2027-03-11**; dueOn 2027-03-01 -> effective 2027-03-01, trigger `time`, `ok`, daysLeft 145, kmLeft 6.440, confidenza `medium` |
| V4 | come V3 ma 60 km/g (47.320 il 01/07, 52.840 il 01/10) | forecast 2026-11-06 < dueOn -> trigger `km`, `estimated`, `soon`, daysLeft 30, kmLeft 2.160 |
| V5 | come V3 ma 55.200 km il 01/10 | `overdue`, kmReached, effective 2026-10-01, daysLeft -6, non stimato |
| V5b | stessa regola, oggi 2027-03-01 / 2027-03-02 | `soon` con `dueToday` / `overdue` |
| V5c | ultimo fatto senza km (solo data), storico letture 40.000 -> 48.560 | dueKm 55.000 (interpolati) |
| V5d | nessuna lettura km | scade per tempo (2027-03-01), motivo `NO_ODOMETER` |
| V7 | solo km 7.000, ultimo 2026-01-10 @ 45.000, ultima lettura 2026-06-01 @ 50.000 (35,2 km/g, 128 giorni fa) | forecast 2026-07-28, `overdue` **stimato**, daysLeft -71, confidenza `low` |
| V10b | manuale a 60.000 km, 50.000 il 10/04 e 55.490 il 07/10 (30,5 km/g) | forecast 2027-03-04 (148 giorni), `ok` |

Serie, ricorrenze, rate, consumi:

| # | Input | Atteso |
|---|---|---|
| V9 | mensile da 2026-01-31, dopo 2026-02-28 / 2026-04-20 / 2026-04-30 | 2026-03-31 / 2026-04-30 / 2026-05-31 |
| V9b | annuale da 2024-02-29, dopo 2025-03-01 / dopo 2027-03-01 | 2026-02-28 / 2028-02-29 |
| V9c | ogni 2 settimane da 2026-10-01, dopo 2026-10-15 | 2026-10-29 |
| V10 | bollo (calendario 12 m, scadenza 2026-08-31), pagato 2026-08-10 / 2026-10-02 / 2028-01-10 | 2027-08-31 / 2027-08-31 / 2028-08-31 |
| V10a | bombola (`fixed_date`) completata | nuova scadenza NULL: la inserisce l'utente |
| V10c | premio 480,00 semestrale da 2026-05-10 | 240,00 il 2026-05-10 e 240,00 il 2026-11-10 |
| V10d | premio 480,01 trimestrale da 2026-01-31 | 120,01 (31/01), 120,00 (30/04), 120,00 (31/07), 120,00 (31/10) |
| V11 | pieni: A 10.000 km 40 L; B parziale 10.300 km 15 L; C pieno 10.700 km 30 L; D pieno 11.300 km 36 L; E pieno 11.900 km 33 L con `missed_before`; F pieno 12.500 km 38,4 L | C = **6,43 L/100 km** (700 km, 45 L), D = **6,00** (600 km, 36 L), E nessun valore (catena interrotta), F = **6,40** (600 km, 38,4 L) |

Pianificazione notifiche (oggi 2026-10-07 08:00 locale, ora di default 09:00, `maxScheduled = 6`; i promemoria: R1 revisione 30/10 preavvisi [30,14,7,0]; R2 tagliando 06/11 [14,3,0]; R3 pressione gomme 08/10 [0], categoria `check`; R4 RCA 10/05/2027 [30,14,7,1,0]):

| # | Atteso |
|---|---|
| V12a | selezionate 5: `R3:0` (08/10), `R1:14` (16/10), `R1:7` (23/10), `R2:14` (23/10), `R4:30` (10/04/2027); **sentinella** il 30/10 alle 09:00 (prima notifica rimasta fuori); 20 candidate escluse. Si noti che il piano prende **la prossima notifica di ogni promemoria** (anche R4, lontanissima) prima di riempire con le piu' vicine |
| V12b | con `maxScheduled = 60` entrano tutte, nessuna sentinella |
| V12c | R1 rimandata al 20/10 09:00: spariscono le sue notifiche precedenti, compare `R1:snz` il 20/10 poi 23/10 e 30/10 |
| V12d | promemoria `check` scaduto da mesi: nessuna notifica (i controlli non si ripetono a oltranza) |
| V12e | RCA scaduta il 27/09: restano le ripetizioni `+14` e `+30` (i preavvisi sono nel passato) |
| V12f | `diffScheduled`: stesso hash -> invariata; hash diverso -> riprogrammata; chiave assente dai desiderati -> cancellata; chiavi senza prefisso `ag1:` ignorate |

Fuso/ora legale: V13 (sezione 3.8, eseguito con `TZ=Europe/Rome`).

### 3.11 Codice di riferimento (eseguito e testato)

Moduli suggeriti: `dates.ts`, `odometer.ts`, `rate.ts`, `maintenance.ts`, `completion.ts`, `fuel.ts`, `insurance.ts`, `notificationPlan.ts` sotto `src/domain/`. Qui in un solo file JS per poterlo eseguire. **Eccezione**: `localToInstant` (ultima riga) dipende dal fuso del dispositivo e nel progetto va in `src/platform/clock/`, non nel dominio (sezione 8.3); tutto il resto del file e' dominio puro.

```js
// src/domain/** : TypeScript PURO (nessun import da react, expo, sqlite). Qui in JS per poterlo eseguire con Node.
// LocalDate = 'YYYY-MM-DD' (data di calendario, niente fusi). Tutta l'aritmetica usa numeri di giorno UTC: immune a ora legale.

// ---------------------------------------------------------------- dates.ts
const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmt = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
export const toDayNumber = (s) => { const { y, m, d } = parseDate(s); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const fromDayNumber = (n) => { const t = new Date(n * 86400000); return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
export const diffDays = (a, b) => toDayNumber(a) - toDayNumber(b); // a - b
export const addDays = (s, n) => fromDayNumber(toDayNumber(s) + n);
export const addMonths = (s, n) => {
  const { y, m, d } = parseDate(s);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (((t % 12) + 12) % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm))); // 31 gen + 1 mese = 28/29 feb
};
export const endOfMonth = (s) => { const { y, m } = parseDate(s); return fmt(y, m, daysInMonth(y, m)); };
export const minDate = (a, b) => (a == null ? b : b == null ? a : a <= b ? a : b);

// ---------------------------------------------------------------- odometer.ts
/** Una lettura per giorno (la piu' alta), solo fino a oggi, ordinate. */
export function dailyMax(readings, today) {
  const byDay = new Map();
  for (const r of readings) if (r.on <= today) byDay.set(r.on, Math.max(byDay.get(r.on) ?? -1, r.km));
  return [...byDay].map(([on, km]) => ({ on, km })).sort((a, b) => (a.on < b.on ? -1 : 1));
}
export const latestReading = (pts) => (pts.length ? pts[pts.length - 1] : null);
/** Interpola i km a una data fra due letture; fuori intervallo -> null (non inventa). */
export function kmAt(on, pts) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (on >= a.on && on <= b.on) {
      const span = diffDays(b.on, a.on);
      return span === 0 ? a.km : Math.round(a.km + ((b.km - a.km) * diffDays(on, a.on)) / span);
    }
  }
  const hit = pts.find((p) => p.on === on);
  return hit ? hit.km : null;
}
/** Validazione "gentile" (la regola dura e' il trigger SQL): ritorna null se ok, altrimenti i vicini che confliggono. */
export function checkMonotonic(pts, cand) {
  const prev = [...pts].filter((p) => p.on < cand.on).pop();
  const next = pts.find((p) => p.on > cand.on);
  if (prev && prev.km > cand.km) return { code: 'LOWER_THAN_PREVIOUS', neighbour: prev };
  if (next && next.km < cand.km) return { code: 'HIGHER_THAN_NEXT', neighbour: next };
  return null;
}

// ---------------------------------------------------------------- rate.ts  (km medi al giorno)
export const RATE_DEFAULTS = {
  windowDays: 180, halfLifeDays: 90, minSegDays: 7, clampMultiple: 3, fullTrustDays: 90,
  maxKmPerDay: 1500, minKmPerDay: 0.5, defaultAnnualKm: 12000,
};
const weightedMedian = (items) => { // items: [{v, w}]
  const s = [...items].sort((a, b) => a.v - b.v), tot = s.reduce((x, i) => x + i.w, 0);
  let acc = 0;
  for (const i of s) { acc += i.w; if (acc >= tot / 2) return i.v; }
  return s[s.length - 1].v;
};
/**
 * @param readings [{on, km}]  (anche piu' letture al giorno)
 * @param vehicle  { annualKmEstimate?, firstRegistrationOn? }
 * @returns { kmPerDay, confidence: 'none'|'low'|'medium'|'high', source: 'measured'|'blended'|'prior', priorSource, spanDays, points, staleDays }
 */
export function estimateKmPerDay(readings, today, vehicle = {}, p = RATE_DEFAULTS) {
  const all = dailyMax(readings, today);
  const ws = addDays(today, -p.windowDays);
  const inWin = all.filter((r) => r.on >= ws);
  const anchor = [...all].filter((r) => r.on < ws).pop();
  const pts = anchor ? [anchor, ...inWin] : inWin;
  const last = latestReading(all);
  const staleDays = last ? diffDays(today, last.on) : null;

  // prior: stima dell'utente > media dalla prima immatricolazione > default (segnaposto)
  let prior, priorSource;
  if (vehicle.annualKmEstimate) { prior = vehicle.annualKmEstimate / 365; priorSource = 'user_estimate'; }
  else if (vehicle.firstRegistrationOn && last && diffDays(today, vehicle.firstRegistrationOn) >= 365) {
    prior = last.km / diffDays(today, vehicle.firstRegistrationOn); priorSource = 'lifetime_average';
  } else { prior = p.defaultAnnualKm / 365; priorSource = 'default'; }

  let measured = null, spanDays = 0;
  if (pts.length >= 2) {
    // segmenti fra letture consecutive; i segmenti piu' corti di minSegDays si fondono col successivo (evita denominatori minuscoli)
    const segs = [];
    let startIdx = 0;
    for (let i = 1; i < pts.length; i++) {
      const days = diffDays(pts[i].on, pts[startIdx].on);
      if (days >= p.minSegDays || i === pts.length - 1) {
        segs.push({ end: pts[i].on, days, dKm: pts[i].km - pts[startIdx].km });
        startIdx = i;
      }
    }
    if (segs.length >= 2 && segs[segs.length - 1].days < p.minSegDays) { // ultimo troppo corto: unisci al precedente
      const l = segs.pop(), q = segs[segs.length - 1];
      q.end = l.end; q.days += l.days; q.dKm += l.dKm;
    }
    spanDays = diffDays(pts[pts.length - 1].on, pts[0].on);
    let items = segs.filter((s) => s.days > 0).map((s) => ({
      v: Math.max(0, s.dKm / s.days),
      w: s.days * Math.pow(0.5, Math.max(0, diffDays(today, s.end)) / p.halfLifeDays),
    }));
    if (items.length >= 3) { // winsorize: nessun segmento conta piu' di clampMultiple x mediana pesata
      const med = weightedMedian(items);
      if (med > 0) items = items.map((i) => ({ ...i, v: Math.min(i.v, p.clampMultiple * med) }));
    }
    const tw = items.reduce((a, i) => a + i.w, 0);
    if (tw > 0) measured = items.reduce((a, i) => a + i.v * i.w, 0) / tw;
  }

  let rate, source;
  if (measured == null) { rate = prior; source = 'prior'; }
  else {
    const lambda = Math.min(1, spanDays / p.fullTrustDays); // restringimento verso il prior quando i dati sono pochi
    rate = lambda * measured + (1 - lambda) * prior;
    source = lambda >= 1 ? 'measured' : 'blended';
  }
  rate = Math.min(rate, p.maxKmPerDay);

  let confidence = 'low';
  if (source !== 'prior') {
    if (spanDays >= 120 && pts.length >= 4) confidence = 'high';
    else if (spanDays >= 45 && pts.length >= 3) confidence = 'medium';
    if (staleDays != null && staleDays > 60) confidence = confidence === 'high' ? 'medium' : 'low';
  }
  if (rate < p.minKmPerDay) confidence = 'none';
  return { kmPerDay: rate, confidence, source, priorSource, spanDays, points: pts.length, staleDays };
}

// ---------------------------------------------------------------- maintenance.ts  (valutazione di una regola)
/**
 * Parte comune a regole e promemoria manuali: dato (dueOn, dueKm) calcola previsione, "il primo dei due" e stato.
 * odometer: [{on, km}]   vehicle: { annualKmEstimate?, firstRegistrationOn? }
 */
export function evaluateThresholds({ today, dueOn, dueKm, soonDays = 30, soonKm = 1500, odometer = [], vehicle = {}, rateParams = RATE_DEFAULTS, reasons = [] }) {
  const pts = dailyMax(odometer, today);
  const cur = latestReading(pts);

  // previsione della data in cui si raggiungeranno i km (media km/giorno, sezione 3.4)
  let forecastOn = null, kmReached = false, rate = null;
  if (dueKm != null) {
    if (!cur) reasons.push('NO_ODOMETER');
    else if (cur.km >= dueKm) { forecastOn = cur.on; kmReached = true; }
    else {
      rate = estimateKmPerDay(odometer, today, vehicle, rateParams);
      if (rate.confidence === 'none') reasons.push('RATE_TOO_LOW');
      else {
        const days = Math.ceil((dueKm - cur.km) / rate.kmPerDay - 1e-9); // epsilon: 6440/40.000000000000007 non deve diventare 162 giorni
        if (days <= 3650) forecastOn = addDays(cur.on, days); else reasons.push('FORECAST_BEYOND_10Y');
      }
    }
  }

  // "il primo dei due"
  const effectiveDueOn = minDate(dueOn, forecastOn);
  const trigger = effectiveDueOn == null ? null : dueOn === forecastOn ? 'both' : effectiveDueOn === dueOn ? 'time' : 'km';
  const estimated = trigger === 'km' && !kmReached;

  // stato
  const daysLeft = effectiveDueOn ? diffDays(effectiveDueOn, today) : null;
  const kmLeft = dueKm != null && cur ? dueKm - cur.km : null;
  let state;
  if (effectiveDueOn == null) state = 'unknown';
  else if (kmReached || daysLeft < 0) state = 'overdue';
  else if (daysLeft <= soonDays || (kmLeft != null && soonKm > 0 && kmLeft <= soonKm)) state = 'soon';
  else state = 'ok';
  return {
    state, dueOn, dueKm, forecastOn, effectiveDueOn, trigger, estimated, kmReached, daysLeft, kmLeft,
    dueToday: daysLeft === 0, forecastConfidence: rate ? rate.confidence : dueKm != null ? 'none' : null,
    rate: rate ? Math.round(rate.kmPerDay * 100) / 100 : null, reasons,
  };
}

/**
 * Valutazione di una regola di manutenzione.
 * rule:     { scheduleType, intervalKm, intervalMonths, periodEnd, fixedDueOn, soonDays, soonKm }
 * lastDone: { on, km } | null     (ultimo completamento oppure baseline dell'item)
 */
export function evaluateRule({ today, rule, lastDone, odometer = [], vehicle = {}, rateParams = RATE_DEFAULTS }) {
  const reasons = [];
  const pts = dailyMax(odometer, today);

  // 1) scadenza per tempo
  let dueOn = null;
  if (rule.scheduleType === 'interval_last_done') {
    if (lastDone?.on && rule.intervalMonths) dueOn = addMonths(lastDone.on, rule.intervalMonths);
    else if (!lastDone) reasons.push('NO_LAST_DONE');
  } else if (rule.fixedDueOn) dueOn = rule.fixedDueOn;
  else reasons.push('NO_FIXED_DATE');
  if (dueOn && rule.periodEnd === 'end_of_month') dueOn = endOfMonth(dueOn);

  // 2) scadenza per km (solo regole "dall'ultimo fatto")
  let dueKm = null;
  if (rule.scheduleType === 'interval_last_done' && rule.intervalKm) {
    const baseKm = lastDone?.km ?? (lastDone?.on ? kmAt(lastDone.on, pts) : null);
    if (baseKm != null) dueKm = baseKm + rule.intervalKm;
    else reasons.push(lastDone ? 'NO_LAST_KM' : 'NO_LAST_DONE');
  }
  return evaluateThresholds({ today, dueOn, dueKm, soonDays: rule.soonDays, soonKm: rule.soonKm, odometer, vehicle, rateParams, reasons: [...new Set(reasons)] });
}

// ---------------------------------------------------------------- completion.ts
/** Nuova data fissa dopo un completamento (serie di calendario: bollo, gomme stagionali). */
export function nextFixedDue(rule, doneOn) {
  if (rule.scheduleType === 'interval_calendar') {
    if (!rule.fixedDueOn) return null;
    let next = addMonths(rule.fixedDueOn, rule.intervalMonths);
    while (next <= doneOn) next = addMonths(next, rule.intervalMonths); // salta i cicli gia' trascorsi
    return next;
  }
  return rule.scheduleType === 'fixed_date' ? null : rule.fixedDueOn ?? null; // fixed_date: la nuova data la inserisce l'utente
}
/** Promemoria manuale ricorrente: occorrenze ancorate all'origine (31 gen, 28 feb, 31 mar ...), la prossima e' > max(scadenza, oggi). */
export function nextOccurrence({ originOn, every, unit }, afterOn) {
  const occ = (k) => unit === 'year' ? addMonths(originOn, k * every * 12) : unit === 'month' ? addMonths(originOn, k * every)
    : addDays(originOn, k * every * (unit === 'week' ? 7 : 1));
  let k = 0;
  while (occ(k) <= afterOn) k++;
  return occ(k);
}

// ---------------------------------------------------------------- fuel.ts  (consumi pieno-a-pieno)
/** logs ordinati: { id, on, km|null, quantityMilli, isFull, missedBefore }. Ritorna i consumi per ogni pieno calcolabile. */
export function fullToFull(logs) {
  const out = [];
  let anchor = null, fuelSince = 0;
  for (const f of logs) {
    if (f.missedBefore) { anchor = null; fuelSince = 0; } // catena interrotta: si riparte da qui
    if (!f.isFull) { fuelSince += f.quantityMilli; continue; }
    if (f.km == null) { anchor = null; fuelSince = 0; out.push({ id: f.id, per100: null, reason: 'NO_KM' }); continue; }
    if (anchor && f.km > anchor.km) {
      const dist = f.km - anchor.km, liters = (fuelSince + f.quantityMilli) / 1000;
      out.push({ id: f.id, distanceKm: dist, quantity: liters, per100: Math.round((liters / dist) * 10000) / 100 });
    } else out.push({ id: f.id, per100: null, reason: anchor ? 'KM_NOT_INCREASING' : 'FIRST_FULL' });
    anchor = { km: f.km }; fuelSince = 0;
  }
  return out;
}

// ---------------------------------------------------------------- notificationPlan.ts
export const fnv1a = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const RANK = { legal: 0, insurance: 0, maintenance: 1, tyres: 1, other: 2, check: 3 };
export const OVERDUE_REPEAT = { legal: [1, 3, 7, 14, 30], insurance: [1, 3, 7, 14, 30], maintenance: [1, 3, 7], tyres: [1, 3, 7], other: [1, 3, 7], check: [] };
const cmpAt = (a, b) => (a.date + 'T' + a.time < b.date + 'T' + b.time ? -1 : a.date + 'T' + a.time > b.date + 'T' + b.time ? 1 : 0);

/**
 * reminders: [{ id, category, title, status, notifyEnabled, effectiveDueOn, notifyOffsetsDays, dueTime?, snoozedUntilLocal?: {date,time} }]
 * nowLocal:  { date, time } = data/ora locale del dispositivo adesso.  Restituisce { items, sentinel, overflow }.
 */
export function planNotifications({ reminders, nowLocal, notifyTime = '09:00', maxScheduled = 60 }) {
  const cand = [];
  for (const r of reminders) {
    if (r.status !== 'open' || !r.notifyEnabled || !r.effectiveDueOn) continue;
    const mk = (suffix, kind, date, time) => ({ key: `ag1:${r.id}:${suffix}`, reminderId: r.id, category: r.category, kind, date, time });
    for (const off of [...new Set(r.notifyOffsetsDays)].sort((a, b) => b - a))
      cand.push(mk(String(off), off === 0 ? 'due' : 'lead', addDays(r.effectiveDueOn, -off), off === 0 && r.dueTime ? r.dueTime : notifyTime));
    for (const d of OVERDUE_REPEAT[r.category] ?? [1, 3, 7]) cand.push(mk(`+${d}`, 'overdue', addDays(r.effectiveDueOn, d), notifyTime));
    if (r.snoozedUntilLocal && cmpAt(r.snoozedUntilLocal, nowLocal) > 0) {
      // rimandato: sparisce tutto cio' che cade prima della fine dello snooze e si aggiunge un promemoria alla fine
      for (let i = cand.length - 1; i >= 0; i--) if (cand[i].reminderId === r.id && cmpAt(cand[i], r.snoozedUntilLocal) < 0) cand.splice(i, 1);
      cand.push(mk('snz', 'snoozed', r.snoozedUntilLocal.date, r.snoozedUntilLocal.time));
    }
  }
  const future = cand.filter((c) => cmpAt(c, nowLocal) > 0)
    .sort((a, b) => cmpAt(a, b) || RANK[a.category] - RANK[b.category] || (a.key < b.key ? -1 : 1));
  if (future.length <= maxScheduled) return { items: future, sentinel: null, overflow: 0 };
  const cap = maxScheduled - 1; // uno slot e' riservato alla sentinella
  const chosen = new Set(), seen = new Set();
  for (const c of future) { // passata 1: la prossima notifica di OGNI promemoria
    if (chosen.size >= cap) break;
    if (!seen.has(c.reminderId)) { seen.add(c.reminderId); chosen.add(c.key); }
  }
  for (const c of future) { if (chosen.size >= cap) break; chosen.add(c.key); } // passata 2: le altre, in ordine di tempo
  const items = future.filter((c) => chosen.has(c.key));
  const overflow = future.filter((c) => !chosen.has(c.key));
  // sentinella: "apri l'app per aggiornare i promemoria", nell'istante della prima notifica che non ha trovato posto
  const sentinel = { key: 'ag1:sentinel', reminderId: null, kind: 'sentinel', date: overflow[0].date, time: overflow[0].time };
  return { items, sentinel, overflow: overflow.length };
}
export function diffScheduled(desired, existing) {
  const have = new Map(existing.filter((e) => e.key.startsWith('ag1:')).map((e) => [e.key, e.hash]));
  const want = new Map(desired.map((d) => [d.key, d]));
  return {
    cancel: [...have.keys()].filter((k) => !want.has(k) || want.get(k).hash !== have.get(k)),
    schedule: desired.filter((d) => have.get(d.key) !== d.hash),
  };
}
/** Data+ora locali -> istante, con la semantica di ECMAScript: ora inesistente (salto) -> avanti, ora ripetuta -> prima occorrenza. */
export const localToInstant = (date, time) => { const { y, m, d } = parseDate(date); const [hh, mm] = time.split(':').map(Number); return new Date(y, m - 1, d, hh, mm, 0, 0); };

// ---------------------------------------------------------------- insurance.ts
export const INSTALLMENTS = { single: 1, annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
/** Rate del premio: il resto in centesimi va sulla prima rata; scadenze ogni 12/n mesi dall'inizio polizza. */
export function splitInstallments(premiumCents, frequency, startOn) {
  const n = INSTALLMENTS[frequency], base = Math.floor(premiumCents / n), rem = premiumCents - base * n;
  return Array.from({ length: n }, (_, i) => ({ installmentNo: i + 1, dueOn: addMonths(startOn, (i * 12) / n), amountCents: base + (i === 0 ? rem : 0) }));
}
```


## 4. Pianificazione notifiche locali

Tutta la logica di selezione e' pura e testata (3.10 e 4.8); l'unica parte non eseguibile su PC e' l'adattatore `expo-notifications` (4.7), che resta sottile apposta.

### 4.1 Vincoli (da V2 e V3)

| Piattaforma | Vincolo | Conseguenza |
|---|---|---|
| iOS | max **64** notifiche locali pendenti, le altre scartate in silenzio | finestra mobile di **60** (`maxScheduled`), ripianificata di continuo |
| Android | nessun tetto documentato da Expo (limite OS non verificato, probabilmente ~500 allarmi) | stesso tetto di 60: comportamento identico e testabile |
| Entrambe | trigger multipiattaforma solo `DATE` e `TIME_INTERVAL` | si usano **solo `DATE`** con istanti calcolati dal dominio; niente trigger ricorrenti nativi |
| Entrambe | il task in background non e' garantito; su iOS non gira se l'utente chiude l'app dallo switcher | ripianificazione a ogni apertura e dopo ogni modifica; il task e' un extra |
| Android 13+ | `POST_NOTIFICATIONS` a runtime; canali obbligatori | richiesta in contesto, canali creati all'avvio |
| Android | allarmi esatti (`SCHEDULE_EXACT_ALARM`) opzionali | **non richiesti** (4.5) |

### 4.2 Architettura a tre livelli

```
domain/notifications/planNotifications()   PURO: reminders + "adesso locale" -> candidate selezionate (+ sentinella)
app/notifications/syncNotifications()      orchestra: permesso -> carica -> pianifica -> testo -> diff con l'OS -> applica
platform/notifications/ExpoNotificationScheduler   adattatore su expo-notifications (porta NotificationScheduler)
```

Porta (definita nel dominio/app, implementata nella piattaforma): `getPermission(): 'granted'|'denied'|'blocked'|'undetermined'`, `listScheduled(): {key, hash}[]`, `schedule(items, tz)`, `cancel(keys)`. Nei test c'e' un'implementazione finta che si comporta come l'OS.

### 4.3 Candidate: chiavi, preavvisi, ripetizioni

- **Chiave deterministica** (`identifier` della notifica): `ag1:<reminderId>:<offset>` con offset in giorni *prima* della scadenza (`30`, `7`, `0`), `+N` per le ripetizioni dopo la scadenza, `snz` per la fine dello snooze, `ag1:sentinel` per la sentinella, `ag1:test` per la prova. Il prefisso `ag1:` (versione 1 del formato) delimita le notifiche **nostre**: tutto il resto viene ignorato; cambiando il formato si cambia prefisso e si cancella il vecchio.
- **Preavvisi** (`notify_offsets_days`, per regola; default dal template): legali [60,30,14,7,0] o [30,14,7,0]; RC auto [30,14,7,1,0]; rate [7,1,0]; manutenzione [14,3,0]; controlli [0]. Ora: `notify.time` (09:00) oppure `due_time` del promemoria manuale solo per il giorno 0.
- **Ripetizioni dopo la scadenza** (se il promemoria e' ancora aperto quando scatta): legali e assicurazione +1, +3, +7, +14, +30 giorni; manutenzione e gomme +1, +3, +7; controlli nessuna. Poi silenzio: resta il banner in Home (il nag infinito fa disinstallare l'app).
- **Snooze**: le candidate prima della fine dello snooze spariscono e se ne aggiunge una (`snz`) all'istante di fine.
- **Hash di contenuto**: `fnv1a(data|ora|canale|titolo|testo)` nel `data` della notifica. Se cambia il testo o la data, la chiave e' la stessa ma l'hash no: viene riprogrammata. Se non cambia nulla, nessuna chiamata all'OS (verificato: seconda sincronizzazione = 0 operazioni).

### 4.4 Selezione sotto il tetto: "una per promemoria" poi "le piu' vicine"

1. Si ordinano le candidate **future** per (data, ora, rango di categoria, chiave): legale e assicurazione prima di manutenzione, poi controlli.
2. Se sono <= 60 entrano tutte.
3. Altrimenti si riserva 1 slot alla sentinella e **passata 1**: la prossima notifica di *ogni* promemoria (cosi' nessun promemoria resta senza avviso, anche se un altro ne ha dieci); **passata 2**: si riempie con le restanti in ordine di tempo.
4. **Sentinella** `ag1:sentinel`: "Apri l'app per aggiornare i tuoi promemoria", programmata nell'istante della **prima notifica rimasta fuori**. Se l'utente non apre l'app prima di quel momento riceve almeno un invito a ripianificare; se la apre, la finestra scorre e la sentinella si sposta.

Verificato (4.8): con 28 promemoria x ~9 candidate (2 veicoli x 14 voci) il piano contiene **60** notifiche (59 + sentinella), 143 candidate rimangono fuori, e **tutti i 28 promemoria** hanno almeno una notifica. Con 3 promemoria reali (revisione, tagliando, pressione gomme) entrano 15 notifiche e nessuna sentinella.

### 4.5 Android: canali, permessi, allarmi esatti, Doze, riavvio

- **Canali** (creati all'avvio con `setNotificationChannelAsync`; dopo la creazione solo l'utente puo' cambiarne l'importanza, quindi vanno scelti bene subito): `deadlines` "Scadenze di legge e assicurazione" (importanza alta), `maintenance` "Manutenzione" (default), `checks` "Controlli periodici" (bassa), `system` "Promemoria di sistema" (bassa).
- **Permesso** `POST_NOTIFICATIONS` (Android 13+): richiesto *in contesto* (4.9). Se l'utente rifiuta due volte il sistema non chiede piu': stato `blocked` -> pulsante "Apri impostazioni".
- **Allarmi esatti: non richiesti**. Una scadenza alle 09:00 tollera minuti di ritardo; `SCHEDULE_EXACT_ALARM` puo' essere revocato dall'utente e (non verificato, confidenza media) dalle versioni recenti non viene piu' concesso di default alle nuove installazioni, mentre `USE_EXACT_ALARM` e' riservato da Google Play ad app di sveglie/calendario. Se in futuro serviranno orari precisi, una schermata dedicata aprira' le impostazioni di sistema per l'autorizzazione.
- **Doze/risparmio energetico**: gli allarmi non esatti possono slittare quando il telefono e' fermo da molto (confidenza media sull'entita'); su alcuni produttori (Xiaomi, Huawei, Samsung, OnePlus) l'app puo' essere "addormentata" e perdere gli allarmi. Mitigazione: schermata "Verifica notifiche" (4.9) con link a dontkillmyapp.com (fonte V3) e invito a togliere l'app dall'ottimizzazione batteria.
- **Riavvio**: le schedulate sopravvivono perche' il modulo dichiara `RECEIVE_BOOT_COMPLETED` (verificato V2); i produttori che bloccano l'avvio automatico possono impedirlo, quindi alla prima apertura si ripianifica comunque.
- **Arresto forzato** dalle impostazioni: l'OS cancella gli allarmi dell'app fino alla riapertura (comportamento AOSP noto, confidenza media): nessuna mitigazione possibile oltre al banner "apri l'app".
- **Dopo un aggiornamento dell'app**: si ripianifica al primo avvio (comportamento dell'OS sugli allarmi dopo l'update non verificato, confidenza bassa).

### 4.6 iOS: permesso, persistenza, badge

- Il permesso si chiede una sola volta in modo esplicito (`requestPermissionsAsync` con alert, badge, suono): non si usa l'autorizzazione *provvisoria* perche' consegna in silenzio e per una scadenza di legge e' controproducente. Se negato, l'unica via e' `Linking.openSettings()`.
- Le notifiche locali programmate vivono nell'OS: scattano anche con l'app chiusa o il telefono riavviato (comportamento standard di `UNUserNotificationCenter`, confidenza media-alta: la pagina Expo letta non lo documenta).
- Il task in background su iOS non e' affidabile (V3): l'esperienza corretta e' "apri l'app almeno ogni tanto": la **sentinella** serve proprio a questo.
- **Badge**: numero di promemoria `overdue` o `soon` non rimandati, aggiornato a ogni sincronizzazione.
- Non si usano livelli di interruzione "time sensitive" (richiedono un'autorizzazione/entitlement non verificato qui).

### 4.7 Il codice dell'applicazione (eseguito e testato) e l'adattatore (schema, NON eseguito)

`src/app/notifications/syncNotifications.ts`: orchestrazione, testi italiani e coordinatore. Dipende solo dalla porta `scheduler` e dal dominio.

```js
// src/app/notifications/syncNotifications.ts  (livello "application": orchestra dominio + porta NotificationScheduler)
import { planNotifications, diffScheduled, fnv1a, diffDays } from './engine.mjs';

const it = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
export const formatDate = (ymd) => it.format(new Date(ymd + 'T00:00:00Z')); // 30/11/2026

/** Testo italiano della notifica. privacy = 'generic' non mostra mai la targa. Niente cifre di km: potrebbero essere vecchie al momento dello scatto. */
export function renderNotification(item, r, settings) {
  if (item.kind === 'sentinel') return { channel: 'system', title: 'AutoGarage', body: 'Apri l\'app per aggiornare i tuoi promemoria.' };
  const who = settings.privacy === 'full' && r.plate ? `${r.vehicleLabel} · ${r.plate}` : r.vehicleLabel;
  const est = r.trigger === 'km'; // la scadenza dipende dai km: e' una stima
  const days = diffDays(r.effectiveDueOn, item.date);
  let body;
  if (item.kind === 'due') body = r.trigger === 'km' ? 'Scadenza prevista oggi (stima in base ai km)' : 'Scade oggi';
  else if (item.kind === 'lead') body = est ? `Scadenza stimata il ${formatDate(r.effectiveDueOn)} (tra circa ${days} giorni)` : `Scade il ${formatDate(r.effectiveDueOn)} (tra ${days} giorni)`;
  else if (item.kind === 'overdue') body = `Scaduto da ${-days} giorni`;
  else body = 'Promemoria rimandato: e\' ora di occuparsene';
  const channel = r.category === 'legal' || r.category === 'insurance' ? 'deadlines' : r.category === 'check' ? 'checks' : 'maintenance';
  return { channel, title: r.title, body: `${who}: ${body}`, threadId: r.vehicleId, route: `autogarage://reminder/${r.id}` };
}

/**
 * scheduler: porta NotificationScheduler { getPermission, listScheduled, schedule, cancel }
 * loadReminders: () => promemoria aperti di veicoli attivi, gia' con vehicleLabel/plate
 */
export async function syncNotifications({ scheduler, loadReminders, nowLocal, tz, settings }) {
  const permission = await scheduler.getPermission();
  if (permission !== 'granted') return { status: 'no_permission', permission };
  const reminders = await loadReminders();
  const byId = new Map(reminders.map((r) => [r.id, r]));
  const plan = planNotifications({ reminders, nowLocal, notifyTime: settings.notifyTime, maxScheduled: settings.maxScheduled });
  const desired = [...plan.items, ...(plan.sentinel ? [plan.sentinel] : [])].map((p) => {
    const content = renderNotification(p, byId.get(p.reminderId), settings);
    return { ...p, ...content, hash: fnv1a([p.date, p.time, content.channel, content.title, content.body].join('|')) };
  });
  const { cancel, schedule } = diffScheduled(desired, await scheduler.listScheduled());
  if (cancel.length) await scheduler.cancel(cancel);
  if (schedule.length) await scheduler.schedule(schedule, tz); // l'adattatore converte data+ora locali in istante e usa key come identifier
  return { status: 'ok', scheduled: schedule.length, cancelled: cancel.length, kept: desired.length - schedule.length, overflow: plan.overflow };
}

/** Coalescenza: piu' richieste ravvicinate = al massimo un'esecuzione in corso + una successiva. Mai due sync in parallelo. */
export function makeSyncCoordinator(run) {
  let running = null, dirty = false;
  const request = (reason) => {
    dirty = true;
    if (running) return running;
    running = (async () => {
      let last;
      try { while (dirty) { dirty = false; last = await run(reason); } } finally { running = null; }
      return last;
    })();
    return running;
  };
  return { request };
}
```

Adattatore su `expo-notifications` 57.0.22 (**solo schema**, richiede un dispositivo; firme da riverificare sulla documentazione dell'SDK 57, confidenza media):

```ts
// src/platform/notifications/ExpoNotificationScheduler.ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { localToInstant } from '../../domain/dates';

const CHANNELS = {
  deadlines:   { name: 'Scadenze di legge e assicurazione', importance: Notifications.AndroidImportance.HIGH },
  maintenance: { name: 'Manutenzione',                      importance: Notifications.AndroidImportance.DEFAULT },
  checks:      { name: 'Controlli periodici',               importance: Notifications.AndroidImportance.LOW },
  system:      { name: 'Promemoria di sistema',             importance: Notifications.AndroidImportance.LOW },
} as const;

export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  for (const [id, c] of Object.entries(CHANNELS)) await Notifications.setNotificationChannelAsync(id, c);
}

export const expoScheduler: NotificationScheduler = {
  async getPermission() {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? (p.status === 'undetermined' ? 'undetermined' : 'denied') : 'blocked';
  },
  async listScheduled() {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.filter((n) => n.identifier.startsWith('ag1:'))
              .map((n) => ({ key: n.identifier, hash: String((n.content.data as any)?.hash ?? '') }));
  },
  async schedule(items) {
    for (const i of items) {
      await Notifications.scheduleNotificationAsync({
        identifier: i.key, // stessa chiave = sostituisce (iOS; su Android da provare)
        content: { title: i.title, body: i.body, data: { hash: i.hash, route: i.route }, threadIdentifier: i.threadId },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: localToInstant(i.date, i.time), channelId: i.channel },
      });
    }
  },
  async cancel(keys) { for (const k of keys) await Notifications.cancelScheduledNotificationAsync(k); },
};
```

Task in background (schema): `TaskManager.defineTask('ag-replan', ...)` apre il DB **senza migrare** (se `user_version` non e' quello atteso esce), chiama `reconcileReminders` e `syncNotifications` con il nuovo "adesso" e termina in pochi secondi; registrazione con `BackgroundTask.registerTaskAsync('ag-replan', { minimumInterval: 12 * 60 })` (unita' in minuti secondo la documentazione letta: 15 minuti minimo, 12 ore default). Il task apre una propria connessione: WAL e `busy_timeout = 5000` evitano conflitti con l'app.

### 4.8 Quando ripianificare e cosa e' stato verificato

| Evento | Perche' | Note |
|---|---|---|
| Avvio e ritorno in primo piano | `today` e' cambiato, rete di sicurezza | al massimo una volta al minuto |
| Dopo ogni scrittura che tocca promemoria, regole, km, polizze, rate, impostazioni | il piano deve restare coerente | coalescenza 1,5 s con `makeSyncCoordinator` |
| Task in background `ag-replan` | la finestra scorre anche senza aprire l'app | non garantito (V3) |
| Ritorno dalle impostazioni di sistema | il permesso puo' essere cambiato | |
| Fuso orario diverso da quello salvato nel piano | gli istanti calcolati sono sbagliati | ripianifica tutto |
| Import/ripristino di un backup | stato completamente nuovo | cancella tutte le `ag1:` e ricostruisce |
| Tap su una notifica | aprire la scheda (`autogarage://reminder/<id>`) | |

Verificato con 11 controlli su un OS finto: prima sincronizzazione programma 15 notifiche per 3 promemoria; seconda sincronizzazione = **0 operazioni**; completando R1 si cancellano solo le sue 8; spostando la previsione di R2 si riprogrammano solo le sue 6 e R3 resta invariata; con permesso negato **nessuna** chiamata di scheduling e stato `no_permission`; testo generico senza targa e testo completo con targa; scadenze stimate a km scritte come "stimata" e senza numeri di km; il coordinatore trasforma 5 richieste ravvicinate in **2 esecuzioni mai parallele**.

### 4.9 Permessi negati e "Verifica notifiche"

Quando chiedere: **non al primo avvio**. Dopo che l'utente ha creato il primo veicolo e almeno una scadenza compare una schermata "Vuoi che ti avvisi prima delle scadenze?" (cosa arriva, quanto spesso, nessuna pubblicita') e solo dopo il dialogo di sistema.

| Stato | Comportamento |
|---|---|
| `granted` | piano completo |
| `undetermined` | nessuna notifica, banner "Attiva gli avvisi" in Home |
| `denied` (si puo' richiedere ancora) | banner con pulsante "Riprova", al massimo 1 richiesta ogni 30 giorni |
| `blocked` | banner con "Apri impostazioni"; la UI non insiste |
| qualunque stato negativo | l'app resta pienamente usabile: la Home "Da fare" e il badge in-app sono la fonte primaria; il banner ricorda "senza notifiche potresti perdere una scadenza"; esportazione `.ics` (v1.x) e widget "prossima scadenza" come ridondanza |

Schermata **Verifica notifiche** (impostazioni): stato del permesso; per Android lo stato dei 4 canali (importanza `NONE` = silenziato); numero di notifiche attese (dal piano) contro quelle presenti nell'OS (`getAllScheduledNotificationsAsync`); data/ora della prossima; esito dell'ultima sincronizzazione (`notify.lastSync`); pulsante "Invia una notifica di prova fra 10 secondi" (`ag1:test`); pulsante "Ripianifica adesso"; guida all'ottimizzazione batteria (Android).

### 4.10 Contenuto e privacy delle notifiche

- Titolo = nome del promemoria ("Revisione"), corpo = "<veicolo>: Scade il 30/11/2026 (tra 14 giorni)". Con `notify.privacy = generic` (default) il veicolo e' il **soprannome** ("Panda") e mai la targa, perche' le notifiche compaiono sul blocco schermo; con `full` si aggiunge la targa.
- Nessun numero di km nel testo (potrebbe essere superato al momento dello scatto); le scadenze a km si scrivono "Scadenza stimata".
- `threadIdentifier` = id del veicolo per raggruppare; il tap apre `autogarage://reminder/<id>`.
- Azioni rapide ("Fatto", "Rimanda"): rimandate a v1.x; l'esecuzione di codice JS a app chiusa dalle azioni di notifica non e' affidabile (confidenza bassa), quindi il tap apre sempre l'app.

### 4.11 Checklist di prova su dispositivo reale (non automatizzabile su PC)

1. Android 13+ e 12: permesso concesso, negato una volta, negato due volte.
2. Programma una notifica fra 2 minuti con app in primo piano, in background e chiusa dallo switcher.
3. Riavvio del telefono con notifiche programmate (Android e iOS).
4. Cambio fuso orario (es. Europe/Rome -> Europe/London) e ritorno all'app: il piano si ripianifica.
5. Notte del cambio ora (25/10/2026, 28/03/2027): notifiche delle 09:00 a 08:00Z e 07:00Z (vettore V13).
6. Piu' di 64 candidate: iOS con 28 promemoria (vettore di 4.8) senza perdere avvisi.
7. Android con risparmio energetico aggressivo su almeno un dispositivo Xiaomi o Samsung: l'allarme delle 09:00 arriva?
8. Arresto forzato (Android) e swipe dallo switcher (iOS): cosa resta.
9. Aggiornamento dell'app (installazione sopra) con notifiche pendenti.
10. Data di sistema cambiata a mano di un mese avanti: allo `AppState` attivo il piano si ricalcola.


## 5. Backup, ripristino, esportazione, sync

Principio: in un'app local-first **il backup e' la funzione piu' importante**: se il telefono si rompe i dati spariscono. Quindi esportazione e importazione sono in v1 (non "premium"), e l'app ricorda di fare il backup. Il codice sotto e' stato eseguito (27 controlli, tutti passati; `fflate` 0.8.3 per lo ZIP).

### 5.1 I tre formati

| Formato | Contenuto | A cosa serve | Importabile |
|---|---|---|---|
| **ZIP completo** `AutoGarage-AAAA-MM-GG.zip` | `manifest.json` + `data.json` + `attachments/<ULID>.<ext>` (+ `csv/*.csv` facoltativi) | backup/ripristino e cambio telefono | si |
| **JSON versionato** `data.json` | tutti i dati senza i file | backup leggero, debug, import da altre app in futuro | si |
| **CSV** (uno per entita') | tabelle leggibili in Excel/Fogli | analisi, commercialista, valutazione in vendita | no (solo uscita) |

Si condivide con il foglio di condivisione del sistema (`expo-sharing` 57.0.22) e si importa con il selettore di documenti (`expo-document-picker` 57.0.3): l'utente sceglie dove tenerlo (iCloud Drive, Google Drive, mail, PC). **Non** si lascia il backup solo nello storage dell'app: sparisce con la disinstallazione.

### 5.2 JSON versionato

```json
{
  "format": "autogarage.backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "exportedAt": "2026-10-07T12:00:00.000Z",
  "sourceDeviceId": "<ULID del dispositivo>",
  "includesTrash": false,
  "counts": { "vehicles": 1, "service_records": 1, "...": 0 },
  "settings": { "notify.time": "09:00", "units.distance": "km" },
  "data": { "vehicles": [ { "id": "01M4...", "plate": "AB123CD", "...": "..." } ], "fuel_logs": [], "...": [] },
  "files": [ { "attachmentId": "01M4...", "path": "attachments/01M4....jpg", "sha256": "<64 hex>", "size": 12345 } ]
}
```

Regole:

- **`formatVersion`** (del file) e' separato da **`schemaVersion`** (del DB): lo schema puo' cambiare senza invalidare i vecchi backup perche' l'import fa passare il documento in una catena di *upgrader del formato* (`UPGRADERS[n]`: da n a n+1; verificato l'ordine v1 -> v2 -> v3). Un backup con `formatVersion` piu' alto dell'app -> errore `BACKUP_TOO_NEW` ("aggiorna l'app"); file non riconosciuto -> `NOT_A_BACKUP`.
- Righe esportate: tabelle utente in ordine di dipendenza; **cestino escluso** di default (`includesTrash` per includerlo); i figli di un genitore escluso non si esportano (potatura); i dati di riferimento citati da altre righe (`workshops`, `obd_adapters`, categorie utente) si esportano **sempre per intero**, anche se cancellati, per non lasciare riferimenti penzolanti; i puntatori "morbidi" a righe escluse (`renewed_from_id`, `completion_id`) diventano `NULL`, come farebbe `ON DELETE SET NULL`.
- **Esclusi**: telemetria (`telemetry_samples/rollups`, voluminosa e rigenerabile; opzione "includi telemetria" in v1.x), `notification_schedule`, `pending_file_deletions`, `migrations_log`, cataloghi di sistema (ripartono dal seed), `app_settings` locali (`device.id`, `backup.lastExportAt`, `notify.lastSync`) e `obd_sessions.seq` (si riassegna all'import).
- Le colonne **cache** dei promemoria (`forecast_on`, `effective_due_on`, ...) *sono* nel file (servono a rispettare i `CHECK`) ma dopo l'import si esegue `reconcileReminders` che le ricalcola.
- Date e istanti restano nei formati del DB (`YYYY-MM-DD`, ISO UTC con millisecondi); importi in centesimi interi: nessuna conversione, nessuna perdita.
- Il roundtrip e' verificato: `export(import(export(DB)))` produce un JSON **identico**. Dimensione di riferimento: 21 righe = circa 10 KB (decine di migliaia di righe restano ben sotto 10 MB).

### 5.3 ZIP: integrita' e sicurezza

- `manifest.json` elenca ogni file con `sha256` e dimensione. In scrittura un allegato alterato blocca l'export (`HASH_MISMATCH`); in lettura si ricontrolla ogni hash.
- **Zip-slip**: si rifiuta qualunque voce con `..`, percorso assoluto, `\` o lettera di unita' (`UNSAFE_PATH`, verificato con uno ZIP costruito ad arte) e ogni file allegato deve essere `attachments/<nome>` senza sottocartelle. Si impone un tetto di 2 GB.
- ZIP senza `manifest.json` o `data.json` -> `NOT_A_BACKUP`.
- **Memoria**: `fflate` lavora in memoria; va bene per la tipica libreria (qualche MB di JSON + foto di scontrini), ma centinaia di MB di foto possono mandare in crisi JS. Per librerie grandi usare un compressore nativo con stream (`react-native-zip-archive` 9.5.2; non verificato qui) o ridimensionare le foto in ingresso (lato lungo 2048 px, JPEG ~80%: tipicamente 300-600 KB, confidenza media). Decisione v1: **`fflate` + ridimensionamento delle foto in ingresso**; passare a nativo solo se un utente reale supera la soglia.
- Cifratura del backup con passphrase (AES-GCM con una KDF, ad es. con librerie pure JS tipo `@noble/ciphers`/`@noble/hashes`, non verificate qui): **v1.x**; in v1 la schermata di esportazione avverte che il file contiene targhe e VIN **in chiaro** e va conservato di conseguenza.

### 5.4 CSV

- File: `veicoli.csv`, `letture_km.csv`, `interventi.csv`, `voci_intervento.csv`, `rifornimenti.csv`, `spese.csv`, `assicurazioni.csv`, `rate_assicurazione.csv`, `scadenze.csv` (regole + prossima scadenza calcolata), `gomme.csv`, `controlli_livelli.csv`, `codici_errore.csv`. Intestazioni in italiano, una riga per record, ID ULID in prima colonna per poter collegare i file.
- Due varianti per ogni esportazione: **Excel (it-IT)**: separatore `;`, UTF-8 con BOM, date `gg/mm/aaaa`, importi con virgola decimale (`1234,56`), "si/no"; **Dati (machine)**: separatore `,`, date ISO, importi con punto, 0/1, senza BOM. Importi sempre in **euro** (colonna "Importo (EUR)"), derivati dai centesimi con aritmetica intera (nessun float).
- **Protezione da CSV injection** (OWASP): le celle di *testo* che iniziano con `=`, `+`, `-`, `@`, tab o a-capo ricevono un apice davanti; i numeri e gli importi negativi (colonne numeriche) non vengono toccati. Verificato: `=cmd|' /C calc'!A0` -> `'=cmd|' /C calc'!A0`.
- Campi con `;`, virgolette o a-capo sono racchiusi tra virgolette con raddoppio (verificato).

### 5.5 Importazione

Due modalita':

| Modalita' | Comportamento | Uso |
|---|---|---|
| **Sostituisci** | svuota le tabelle utente e inserisce tutto dal file, in **una transazione** | nuovo telefono, ripristino dopo un guasto |
| **Unisci** | upsert per `id`; se esiste la stessa riga vince quella con `updated_at` piu' recente (LWW); non cancella mai | unire due dispositivi, riportare dentro dati da un backup piu' vecchio |

Flusso (schermata con riepilogo prima di confermare: "Il file contiene 3 veicoli, 214 interventi, 36 allegati; creato il ... con la versione ..."):

1. leggi `manifest.json`/`data.json`, controlla `format`, `formatVersion` (upgrade se piu' vecchio, errore se piu' nuovo) e gli hash;
2. **copia di sicurezza automatica del DB attuale** con `VACUUM INTO` (come nelle migrazioni, sezione 2.1): se qualcosa va storto "Annulla importazione" ripristina;
3. transazione esclusiva con `PRAGMA defer_foreign_keys = ON` (l'ordine di inserimento non conta; le FK si verificano al COMMIT) e `foreign_key_check` finale: qualsiasi violazione -> **rollback totale**;
4. copia degli allegati in una cartella temporanea, verifica hash, poi spostamento in `attachments/` **dopo** il commit; in "Sostituisci" i vecchi file finiscono nella coda `pending_file_deletions`;
5. `reconcileReminders` + `syncNotifications`, poi riepilogo ("inseriti 214, aggiornati 3, mantenuti i locali 12").

Casi verificati: ripristino in un DB nuovo (il dato locale sparisce, `foreign_key_check` vuoto, `seq` delle sessioni riassegnato); unione dove la riga locale e' piu' recente (il valore locale resta), dove e' piu' vecchia (vince il backup) e dove la riga e' nuova (inserita); **conflitto di targa** (stessa targa con ULID diverso) -> errore dell'indice unico e **rollback completo** (nessuna riga a meta'); in quel caso la UI propone di scegliere "Sostituisci" o di eliminare il veicolo locale. Non importa i file mancanti: segnala quali allegati non erano nel file e li lascia senza anteprima.

### 5.6 Promemoria di backup e cambio telefono

- **Nudge**: se `backup.lastExportAt` e' vuoto da oltre `backup.nudgeDays` (30) giorni *e* ci sono state almeno 5 modifiche, banner in Home "Fai un backup"; dopo un'importazione o un'esportazione il contatore riparte. Nessuna notifica push per questo: un banner basta.
- **Android Auto Backup**: in v1 impostare `android.allowBackup = false` nella configurazione Expo. Motivo: la copia automatica dei file del DB mentre e' aperto (WAL) puo' produrre un ripristino incoerente e, se un domani il DB sara' cifrato, ripristinerebbe un file illeggibile perche' la chiave nel Keystore non migra (V4). Il cambio telefono passa dal file di backup (confidenza media: comportamento di Auto Backup non verificato qui).
- **iOS**: la cartella dei dati dell'app e' inclusa nel backup di iCloud/iTunes per default; utile ma non e' una garanzia (l'utente puo' averlo disattivato): il backup esplicito resta la via ufficiale.

### 5.7 Sincronizzazione cloud: raccomandazione

| Fase | Cosa | Perche' |
|---|---|---|
| **v1** | nessuna sync; backup manuale + nudge | un solo sviluppatore, nessun server da gestire, nessun account, dati locali = promessa di privacy |
| **v1.x** | **backup automatico su una cartella scelta dall'utente** (iCloud Drive / Google Drive / qualsiasi provider di documenti, tramite il selettore di sistema; su Android con lo Storage Access Framework), con rotazione degli ultimi N file e, opzionalmente, cifratura con passphrase | risolve il vero rischio (perdere il telefono) con zero infrastruttura, zero account, zero costi e senza diventare titolari di dati altrui; e' il formato di 5.2 con un pulsante in piu' |
| **v2 (solo se c'e' domanda: famiglia, due conducenti, uso su piu' dispositivi)** | sincronizzazione **per riga** con cifratura end-to-end, LWW su `updated_at` con tie-break su `device.id`, soft delete come *tombstone* | il modello dati e' gia' pronto: ULID, `updated_at`, `deleted_at`, `device.id`, allegati identificati dall'hash, e la modalita' "Unisci" verificata in 5.5 e' esattamente il passo di merge |

Cose da decidere/valutare solo quando si arrivera' alla v2 (**non verificate in questa ricerca**, servira' una ricerca dedicata): backend (CloudKit solo iOS, Firebase, Supabase, un servizio di sync per SQLite), costi e obblighi GDPR da titolare/responsabile, gestione account, sync degli allegati su storage a oggetti. Principi gia' fissati: i dati calcolati (cache dei promemoria, stato delle notifiche, telemetria) **non** si sincronizzano; la sync di base **non va a pagamento** (le recensioni dei concorrenti, in `docs/research/features.md`, mostrano che paywall su sync ed esportazione sono tra le lamentele principali: si monetizza altrove).

### 5.8 Codice (eseguito e testato)

`src/data/backup/{export,import,zip,csv}.ts` (qui in un file JS). Dipende da `SqlDatabase` e da `fflate`; `sha256Hex` in produzione usa `expo-crypto` (qui il Web Crypto di Node).

```js
// src/data/backup/*.ts : esportazione/importazione. Dipende dalla porta SqlDatabase (exec/run/all/get/transaction).
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export const FORMAT = 'autogarage.backup';
export const FORMAT_VERSION = 1;
export class BackupError extends Error { constructor(code, msg) { super(msg ?? code); this.code = code; this.name = 'BackupError'; } }

// Ordine di dipendenza + genitori per la potatura delle righe orfane (es. figli di un veicolo nel cestino).
// "soft": ha deleted_at. Le tabelle cache/volatili (telemetria, notification_schedule, outbox, log migrazioni) NON si esportano.
export const TABLES = [
  { name: 'obd_adapters', soft: true, ref: true, parents: [] }, // 'ref': dati di riferimento, esportati sempre per intero (anche cancellati) perche' altre righe li citano
  { name: 'workshops', soft: true, ref: true, parents: [] },
  { name: 'expense_categories', soft: true, ref: true, parents: [], where: 'is_system = 0' }, // le categorie di sistema arrivano dal seed
  { name: 'vehicles', soft: true, parents: [] },
  { name: 'fuel_logs', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'service_records', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'service_lines', soft: false, parents: [['service_record_id', 'service_records']] },
  { name: 'fluid_checks', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'expenses', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'obd_sessions', soft: false, parents: [['vehicle_id', 'vehicles']], omit: ['seq'] }, // seq e' locale: si riassegna all'import
  { name: 'odometer_readings', soft: true, parents: [['vehicle_id', 'vehicles']], optionalParents: [['fuel_log_id', 'fuel_logs'], ['service_record_id', 'service_records'], ['fluid_check_id', 'fluid_checks'], ['obd_session_id', 'obd_sessions']] },
  { name: 'maintenance_items', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'maintenance_completions', soft: true, parents: [['item_id', 'maintenance_items']], optionalParents: [['service_record_id', 'service_records'], ['fluid_check_id', 'fluid_checks']] },
  { name: 'insurance_policies', soft: true, parents: [['vehicle_id', 'vehicles']], nullRefs: [['renewed_from_id', 'insurance_policies']] },
  { name: 'insurance_coverages', soft: false, parents: [['policy_id', 'insurance_policies']] },
  { name: 'insurance_payments', soft: true, parents: [['policy_id', 'insurance_policies']] },
  { name: 'reminders', soft: true, parents: [['vehicle_id', 'vehicles']], nullRefs: [['completion_id', 'maintenance_completions']], optionalParents: [['item_id', 'maintenance_items'], ['policy_id', 'insurance_policies'], ['payment_id', 'insurance_payments']] },
  { name: 'tyre_sets', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'tyre_fitments', soft: true, parents: [['tyre_set_id', 'tyre_sets']] },
  { name: 'dtc_events', soft: true, parents: [['vehicle_id', 'vehicles']] },
  { name: 'attachments', soft: true, parents: [['owner_vehicle_id', 'vehicles']], optionalParents: [['service_record_id', 'service_records'], ['policy_id', 'insurance_policies'], ['fuel_log_id', 'fuel_logs'], ['expense_id', 'expenses'], ['fluid_check_id', 'fluid_checks'], ['tyre_set_id', 'tyre_sets']] },
];
const SETTINGS_EXCLUDED = new Set(['device.id', 'backup.lastExportAt', 'notify.lastSync']);

export async function exportData(db, { appVersion, schemaVersion, deviceId, nowIso, includeTrash = false }) {
  const data = {}, ids = {};
  for (const t of TABLES) {
    const conds = [];
    if (t.soft && !includeTrash && !t.ref) conds.push('deleted_at IS NULL');
    if (t.where) conds.push(t.where);
    let rows = await db.all(`SELECT * FROM ${t.name}${conds.length ? ' WHERE ' + conds.join(' AND ') : ''} ORDER BY ${t.name === 'service_lines' ? 'service_record_id, position, id' : 'id'}`);
    const selfIds = new Set(rows.map((r) => r.id));
    rows = rows.filter((r) => t.parents.every(([col, p]) => ids[p]?.has(r[col])) && (t.optionalParents ?? []).every(([col, p]) => r[col] == null || ids[p]?.has(r[col])));
    for (const r of rows) for (const [col, p] of t.nullRefs ?? []) if (r[col] != null && !(p === t.name ? selfIds : ids[p]).has(r[col])) r[col] = null; // come ON DELETE SET NULL
    if (t.omit) rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !t.omit.includes(k))));
    data[t.name] = rows;
    ids[t.name] = new Set(rows.map((r) => r.id));
  }
  const settings = {};
  for (const s of await db.all('SELECT key, value FROM app_settings ORDER BY key')) if (!SETTINGS_EXCLUDED.has(s.key)) settings[s.key] = JSON.parse(s.value);
  const files = data.attachments.map((a) => ({ attachmentId: a.id, path: a.stored_path, sha256: a.sha256, size: a.size_bytes }));
  return { format: FORMAT, formatVersion: FORMAT_VERSION, schemaVersion, appVersion, exportedAt: nowIso, sourceDeviceId: deviceId, includesTrash: includeTrash,
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), settings, data, files };
}

// upgrader del FORMATO (non dello schema): upgraders[n] porta un documento dalla versione n alla n+1
export const UPGRADERS = {};
export function upgradeBackup(doc, upgraders = UPGRADERS, target = FORMAT_VERSION) {
  if (doc?.format !== FORMAT) throw new BackupError('NOT_A_BACKUP', 'file non riconosciuto');
  if (!Number.isInteger(doc.formatVersion) || doc.formatVersion < 1) throw new BackupError('BAD_VERSION');
  if (doc.formatVersion > target) throw new BackupError('BACKUP_TOO_NEW', `backup v${doc.formatVersion}: aggiorna l'app (supporta fino a v${target})`);
  let d = doc;
  while (d.formatVersion < target) {
    const up = upgraders[d.formatVersion];
    if (!up) throw new BackupError('NO_UPGRADER', `manca l'upgrader v${d.formatVersion}->v${d.formatVersion + 1}`);
    d = { ...up(d), formatVersion: d.formatVersion + 1 };
  }
  return d;
}

const qIdent = (s) => `"${s.replace(/"/g, '""')}"`;
/** mode 'replace': svuota le tabelle utente e inserisce; 'merge': upsert per id, vince updated_at piu' recente (LWW), non cancella mai. */
export async function importData(db, rawDoc, { mode }) {
  const doc = upgradeBackup(rawDoc);
  const stats = { inserted: 0, updatedNewer: 0, keptLocal: 0 };
  await db.transaction(async (tx) => {
    await tx.exec('PRAGMA defer_foreign_keys = ON'); // l'ordine non conta: le FK si controllano al COMMIT
    if (mode === 'replace') {
      for (const t of [...TABLES].reverse()) await tx.exec(`DELETE FROM ${t.name}${t.where ? ' WHERE ' + t.where : ''}`);
    }
    for (const t of TABLES) {
      const rows = doc.data[t.name] ?? [];
      for (const r of rows) {
        const cols = Object.keys(r);
        const names = cols.map(qIdent).join(', ');
        const marks = cols.map(() => '?').join(', ');
        const vals = cols.map((c) => r[c]);
        const extra = t.name === 'obd_sessions' ? { n: ', seq', v: ', (SELECT COALESCE(MAX(seq),0)+1 FROM obd_sessions)' } : { n: '', v: '' };
        if (mode === 'replace') {
          await tx.run(`INSERT INTO ${t.name} (${names}${extra.n}) VALUES (${marks}${extra.v})`, vals);
          stats.inserted++;
        } else {
          const exists = await tx.get(`SELECT updated_at AS u FROM ${t.name} WHERE id = ?`, [r.id]);
          if (!exists) { await tx.run(`INSERT INTO ${t.name} (${names}${extra.n}) VALUES (${marks}${extra.v})`, vals); stats.inserted++; }
          else if (r.updated_at && r.updated_at > exists.u) {
            const sets = cols.filter((c) => c !== 'id').map((c) => `${qIdent(c)} = ?`).join(', ');
            await tx.run(`UPDATE ${t.name} SET ${sets} WHERE id = ?`, [...cols.filter((c) => c !== 'id').map((c) => r[c]), r.id]);
            stats.updatedNewer++;
          } else stats.keptLocal++;
        }
      }
    }
    for (const [k, v] of Object.entries(doc.settings ?? {})) {
      if (mode === 'replace') await tx.run(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, JSON.stringify(v)]);
      else await tx.run(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`, [k, JSON.stringify(v)]);
    }
    const bad = await tx.all('PRAGMA foreign_key_check');
    if (bad.length) throw new BackupError('FK_VIOLATION', `riferimenti rotti: ${JSON.stringify(bad[0])}`);
  }, 'exclusive');
  return stats;
}

// ------------------------------------------------------------------ ZIP: manifest + dati + allegati (+ CSV opzionali)
const MAX_TOTAL_BYTES = 2 * 1024 ** 3;
const safeName = (n) => !n.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(n) && !n.includes('\\') && !/^[A-Za-z]:/.test(n);
export async function sha256Hex(bytes) { // in RN: expo-crypto; qui il Web Crypto di Node
  const d = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function buildZip(doc, fileBytes /* Map(stored_path -> Uint8Array) */, csv = {} /* nome -> stringa */) {
  const entries = { 'data.json': strToU8(JSON.stringify(doc)) };
  const manifest = { format: FORMAT, formatVersion: doc.formatVersion, exportedAt: doc.exportedAt, files: [] };
  for (const f of doc.files) {
    const bytes = fileBytes.get(f.path);
    if (!bytes) throw new BackupError('MISSING_FILE', `file mancante nello storage: ${f.path}`);
    if ((await sha256Hex(bytes)) !== f.sha256) throw new BackupError('HASH_MISMATCH', `file alterato: ${f.path}`);
    entries[f.path] = bytes; manifest.files.push({ path: f.path, sha256: f.sha256, size: bytes.length });
  }
  for (const [name, text] of Object.entries(csv)) entries[`csv/${name}`] = strToU8(text);
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(entries, { level: 6 });
}
export async function readZip(bytes) {
  if (bytes.length > MAX_TOTAL_BYTES) throw new BackupError('TOO_BIG');
  const entries = unzipSync(bytes);
  let total = 0;
  for (const [name, b] of Object.entries(entries)) {
    if (!safeName(name)) throw new BackupError('UNSAFE_PATH', `percorso non ammesso nello ZIP: ${name}`); // zip-slip
    total += b.length; if (total > MAX_TOTAL_BYTES) throw new BackupError('TOO_BIG');
  }
  if (!entries['manifest.json'] || !entries['data.json']) throw new BackupError('NOT_A_BACKUP');
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])), doc = JSON.parse(strFromU8(entries['data.json']));
  const files = new Map();
  for (const f of manifest.files) {
    const b = entries[f.path];
    if (!b) throw new BackupError('MISSING_FILE', f.path);
    if ((await sha256Hex(b)) !== f.sha256) throw new BackupError('HASH_MISMATCH', f.path);
    if (!/^attachments\/[^/]+$/.test(f.path)) throw new BackupError('UNSAFE_PATH', f.path);
    files.set(f.path, b);
  }
  return { doc, files };
}

// ------------------------------------------------------------------ CSV
const EUR = (c, mode) => (c == null ? '' : `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}${mode === 'it' ? ',' : '.'}${String(Math.abs(c) % 100).padStart(2, '0')}`);
const DATE = (d, mode) => (d == null ? '' : mode === 'it' ? d.split('-').reverse().join('/') : d);
const guard = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s); // CSV injection (OWASP): le celle che iniziano con = + - @ vengono neutralizzate
/**
 * columns: [{ key, label, type: 'text'|'int'|'cents'|'date'|'bool' }]. mode 'it' = Excel italiano (; e virgola decimale, gg/mm/aaaa, BOM); 'machine' = , . ISO.
 */
export function toCsv(rows, columns, mode = 'it') {
  const sep = mode === 'it' ? ';' : ',';
  const q = (s) => (/[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cell = (v, c) => {
    if (v == null) return '';
    if (c.type === 'cents') return EUR(v, mode);
    if (c.type === 'date') return DATE(v, mode);
    if (c.type === 'bool') return v ? (mode === 'it' ? 'si' : '1') : (mode === 'it' ? 'no' : '0');
    if (c.type === 'int') return String(v);
    return q(guard(String(v)));
  };
  const lines = [columns.map((c) => q(c.label)).join(sep), ...rows.map((r) => columns.map((c) => cell(r[c.key], c)).join(sep))];
  return (mode === 'it' ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
```


## 6. Privacy, GDPR, cifratura, blocco app

Sintesi legale: **non e' una consulenza**; per il rilascio sugli store serve il parere di un legale (come gia' annotato in `docs/research/obd.md` sezione 29). Le affermazioni sotto sono di confidenza media e vengono da fonti secondarie.

### 6.1 Quali dati, e quanto sono "personali"

| Dato | Dove | Valutazione | Trattamento |
|---|---|---|---|
| **Targa** | `vehicles.plate` | riconducibile al proprietario tramite i registri (PRA/ACI): trattarla come dato personale (confidenza media, non verificato in questa sessione) | solo locale; mai nei log, mai nelle notifiche di default, mai in URL |
| **VIN** | `vehicles.vin` | la CGUE (C-319/22, 9/11/2023, fonti in `obd.md` sezione 29) ha detto che non e' di per se' dato personale ma lo diventa per chi ha mezzi ragionevoli per associarlo a una persona: in un'app con i dati del proprietario si assume personale | solo locale; le sessioni OBD salvano solo `vin_matches` (0/1) |
| Soprannome, note, officina, polizze (compagnia, n. polizza, contatti), costi, km | varie tabelle | dati personali dell'utente (abitudini, spese) | solo locale |
| **Allegati** (libretto/DU, polizza PDF, scontrini, foto) | `attachments` + file | il libretto/DU e la polizza contengono intestatario e residenza: **i piu' sensibili** | storage dell'app; non nell'archivio condiviso del telefono; nessuna copia in galleria |
| Indirizzo dell'adattatore Bluetooth/Wi-Fi | `obd_adapters.address` | identificatore di un dispositivo | solo locale |
| Telemetria e DTC | `telemetry_*`, `dtc_events` | comportamento di guida | solo locale, con retention (1.4); mai posizione GPS |
| `device.id` | `app_settings` | ULID casuale, non e' un identificatore hardware | serve alla sync futura; non esce dal dispositivo |

Non si raccolgono: posizione, contatti, identificatori pubblicitari, nome e cognome dell'utente (non esiste un account).

### 6.2 Principi di progetto

1. **Locale per impostazione predefinita**: nessun server, nessun account, nessuna chiamata di rete con dati dell'utente. Se l'utente non invia nulla, l'app non "raccoglie" nulla.
2. **Nessun SDK di analytics o pubblicita' in v1.** Un'eventuale segnalazione degli arresti anomali e' **opt-in**, con redazione di targa/VIN e senza dati dell'utente (valutare solo se serve davvero).
3. **Minimizzazione**: ogni campo opzionale resta opzionale (targa e VIN compresi: si puo' usare l'app con "Panda di Marco"); niente telefono, indirizzo o codice fiscale dell'utente.
4. **Esenzione domestica** (art. 2(2)(c) GDPR): per l'utente che gestisce le proprie auto il trattamento e' personale/domestico; se i dati non lasciano il dispositivo lo sviluppatore non riceve dati personali (valutazione di confidenza media: da confermare con un legale). Le dichiarazioni degli store (Apple *App Privacy*, Google *Data safety*) possono dire "nessun dato raccolto" **solo se e' vero**, quindi niente SDK di terze parti che trasmettono dati senza controllo.
5. **Informativa privacy** accessibile in app e sullo store, in italiano e in linguaggio semplice: cosa si salva, dove, come esportare e cancellare, cosa succede condividendo un backup.
6. **Se arrivera' una funzione di rete** (sync, prezzi carburante): finestra di consenso dedicata, dati minimi, nessuna targa/VIN verso terzi, e si aggiorna l'informativa prima del rilascio.
7. **Log e diagnostica**: un `redact()` centrale sostituisce targa e VIN (`AB***CD`, `ZFA*************6`) in qualunque log, errore o export di diagnostica; in release il logger e' silenzioso per default.

### 6.3 Diritti dell'utente e cancellazione completa

- **Accesso e portabilita'** (artt. 15 e 20): l'esportazione ZIP/JSON/CSV di 5.1 e' gia' il diritto di accesso e portabilita' in formato strutturato e leggibile.
- **Cancellazione a livelli**:
  1. *Elimina veicolo*: soft delete, finisce nel cestino per 30 giorni (`trash.retentionDays`);
  2. *Elimina definitivamente* (veicolo o singolo record): `DELETE` fisico con cascata; i trigger riempiono `pending_file_deletions` e i file vengono rimossi; `PRAGMA secure_delete = ON` azzera le pagine liberate e un `wal_checkpoint(TRUNCATE)` finale evita residui nel WAL (nota: `secure_delete` non cancella il passato dai backup/copie gia' fatti);
  3. *Cancella tutti i dati e reimposta l'app*: procedura sotto.
- **Pulizie periodiche**: cestino oltre 30 giorni, copie `backups/pre-v*.db` (2.1) dopo 2 avvii riusciti, file temporanei di esportazione subito dopo la condivisione (e comunque all'avvio successivo), cache delle miniature.

```
wipeAllData()   // richiede conferma digitando una parola; con blocco app attivo richiede anche l'autenticazione
  1. Notifications.cancelAllScheduledNotificationsAsync(); BackgroundTask.unregisterTaskAsync('ag-replan')
  2. chiudi la connessione al DB (e i task)
  3. elimina: <db>.sqlite, -wal, -shm  |  attachments/  |  backups/  |  cartella temporanea di esportazione/importazione
  4. SecureStore: elimina le chiavi (chiave DB se presente)
  5. azzera le preferenze locali (AsyncStorage/localStorage) e lo stato in memoria
  6. verifica: elenca la cartella dei documenti dell'app e controlla che sia vuota; mostra l'esito
  7. riavvia dall'onboarding
```

Avviso in UI: i backup gia' esportati e condivisi (cloud, mail, PC) **non** si possono cancellare dall'app.

### 6.4 Cifratura a riposo

| Livello | Cosa offre | Stato |
|---|---|---|
| Sandbox dell'app | gli altri processi non leggono i file | sempre |
| Cifratura del dispositivo (iOS Data Protection, Android File-Based Encryption) | file illeggibili a telefono spento/bloccato senza il codice; da Android 10 la cifratura e' obbligatoria sui dispositivi nuovi (confidenza media: non verificato qui) | sempre, gratis |
| **SQLCipher** (`useSQLCipher: true`, V1) | cifra l'intero file DB con una chiave dell'app | **non in v1, opzionale in v1.x** |
| Allegati | i file restano in chiaro nello storage dell'app (SQLCipher non li copre) | cifratura per file (AES-GCM) valutabile in v2 |

**Raccomandazione: v1 senza SQLCipher**, per cinque motivi concreti:

1. **Il rischio principale per questi utenti e' perdere i dati, non una fuga dei dati**: SQLCipher aggiunge un modo nuovo di perderli (chiave sparita = DB irrecuperabile). Dalle verifiche V4: la chiave nel Keystore Android **non sopravvive alla disinstallazione**; su iOS il Keychain **persiste** dopo la disinstallazione (DB nuovo con chiave vecchia: incoerenza gestibile ma da progettare); legarla a `requireAuthentication` la **invalida** se cambiano le biometrie.
2. Il **task in background** deve poter aprire il DB a telefono bloccato: richiede `AFTER_FIRST_UNLOCK` e non `WHEN_UNLOCKED` (default).
3. Il **cambio telefono** e i backup di sistema: con la chiave in un'area che non migra (ThisDeviceOnly/Keystore) un DB ripristinato dal backup di sistema e' illeggibile; sarebbe obbligatorio disattivare Auto Backup e fare solo export (gia' deciso in 5.6).
4. **Attrito di sviluppo**: `useSQLCipher` richiede prebuild/dev build (V1); la UI su PC con `expo-sqlite` web (alpha) non ha SQLCipher: si svilupperebbe su una configurazione diversa da quella di produzione.
5. **Protezione parziale**: gli allegati (che contengono i dati piu' sensibili) non sarebbero cifrati comunque.

Il codice di apertura del DB accetta gia' un parametro `key?`; quando (v1.x) si offrira' "Protezione avanzata":

- chiave = 32 byte casuali (`expo-crypto`) in esadecimale, salvata in `expo-secure-store` con `keychainAccessible: AFTER_FIRST_UNLOCK` (**non** `*_THIS_DEVICE_ONLY`, per consentire la migrazione con backup cifrati su iOS: confidenza media), **senza** `requireAuthentication`; apertura con `PRAGMA key = '<chiave>'` subito dopo `openDatabaseAsync` (sintassi verificata in V1);
- attivazione guidata: (1) obbliga a fare un backup ZIP, (2) crea un nuovo file cifrato con la procedura standard di SQLCipher (`ATTACH ... KEY` + `sqlcipher_export`, **da verificare** sulla build effettiva), (3) confronta i conteggi, (4) sostituisce il file e cancella quello in chiaro;
- schermata di recupero se l'apertura con la chiave fallisce: "I dati non sono leggibili su questo dispositivo. Ripristina da un backup";
- `android.allowBackup = false` resta obbligatorio.

### 6.5 Blocco app con biometria

Obiettivo: impedire a chi ha in mano il telefono sbloccato di aprire lo storico. **E' un blocco dell'interfaccia, non cifratura.**

- Libreria: `expo-local-authentication` 57.0.3 (verificata solo la versione; firme da confermare sulla documentazione): `hasHardwareAsync`, `isEnrolledAsync`, `authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: false })`. Si lascia **attivo il ripiego sul codice del dispositivo**: niente PIN proprio (richiederebbe custodire segreti e gestire il brute force). Se il dispositivo non ha ne' biometria ne' codice, l'opzione e' disattivata con spiegazione.
- Impostazioni: `lock.enabled` (default off) e `lock.timeoutSeconds` in {0, 30, 60, 300, 900} (default 60).
- Macchina a stati: avvio a freddo con blocco attivo -> **sempre bloccato**; `AppState` va in background -> si salva `backgroundedAt` (in memoria, non persistito); al ritorno in primo piano si blocca se `ora - backgroundedAt > timeoutSeconds`; sblocco riuscito -> navigazione normale; 3 fallimenti consecutivi -> pausa di 30 secondi (la gestione dei tentativi e' del sistema, qui solo UX).
- **Copertura nello switcher**: con blocco attivo, quando l'app diventa `inactive/background` si mostra una schermata neutra sopra i contenuti, cosi' l'anteprima nel selettore delle app non mostra dati. Opzione "Blocca anche gli screenshot" con `expo-screen-capture` 57.0.4 (default off).
- Azioni **protette da una nuova autenticazione** anche a app sbloccata: esporta backup, cancella tutti i dati, disattiva il blocco.
- Cosa il blocco **non** copre: le notifiche (vedi `notify.privacy`), i backup gia' condivisi, il task in background.
- Su PC/web e nei test si usa un'implementazione finta della porta `Authenticator` (`authenticate(): Promise<boolean>`).


## 7. Unita' di misura e valuta

### 7.1 Regole

| Grandezza | Canonico nel DB | Visualizzazione | Note |
|---|---|---|---|
| Distanza | **km interi** (`INTEGER`, 0..2.000.000) | km o miglia per veicolo (`vehicles.distance_unit`), default da `units.distance` | intervalli di manutenzione sempre in km; l'utente inglese che scrive "10.000 mi" salva 16.093 km |
| Volume/quantita' | **millesimi** dell'unita': ml per i litri, Wh per i kWh, g per i kg (`quantity_milli`) | `40,000 L`, `12,350 kWh`, `9,100 kg` | unita' e carburante coerenti per `CHECK` (metano e idrogeno in kg, elettrico in kWh, il resto in L) |
| Prezzo unitario | **millesimi di euro** (`unit_price_milli`) | `1,859 EUR/L` | i distributori mostrano 3 decimali |
| Denaro | **centesimi di euro interi** (`*_cents`) | `1.234,56 €` | nessuna colonna `currency` in v1: aggiungerla in futuro e' una `ADD COLUMN ... DEFAULT 'EUR'` |
| Consumo | calcolato, non salvato | L/100 km (default), km/L, mpg US/UK; per l'elettrico kWh/100 km | pieno-a-pieno (3.10, V11) |
| Date | `YYYY-MM-DD` | `gg/mm/aaaa`, settimana da lunedi' | formattazione manuale (`formatDateIt`) |
| Temperatura, pressione | solo visualizzazione (telemetria) | °C/°F, bar/psi | non entrano nel DB come preferenza di dominio |

### 7.2 Perche' km interi: round-trip esatto

`miToKm(mi) = round(mi x 1,609344)` e `kmToMi(km) = round(km / 1,609344)`. Verificato per **ogni** intero da 0 a 500.000 miglia: `kmToMi(miToKm(mi)) = mi` (0 errori), perche' due miglia intere distano ~1,6 km, piu' della risoluzione di 1 km. Non vale il contrario (km -> mi -> km: 757.258 interi su 2.000.001 cambiano di +-1 km): per questo **non si risalva mai un valore convertito per la visualizzazione**; si converte una sola volta, quando l'utente scrive.

### 7.3 Soldi senza float

- Input: `parseEuroToCents('1.234,56') = 123456`; accetta `1.234,56`, `1,234.56`, `1234,56`, `1234.56`, `12`, `12,5`, `EUR 12,50`, spazi e NBSP, segno meno; **rifiuta** (restituisce `null`) `12,345` (troppi decimali per i centesimi: nessun arrotondamento silenzioso, la UI chiede), `1.2.3`, `12,5,5`, testo. Per i millesimi (`parseMilli`) il punto e' sempre decimale: `1.859` = 1,859 EUR/L e `45.500` = 45,500 L (per gli euro "1.234" significa milleduecentotrentaquattro euro, all'italiana).
- Coerenza dello scontrino: `totale_atteso = round(quantita' x prezzo)` in centesimi con **BigInt** (`40,000 L x 1,859 = 74,36 EUR`, `35,500 x 1,789 = 63,5095 -> 6351`); si accettano 2 centesimi di scarto, oltre la UI chiede conferma.
- Somme e medie in interi; il costo al chilometro si calcola al momento della visualizzazione (la divisione in virgola mobile e' solo per mostrare).
- Importi esportati in CSV come euro decimali costruiti con aritmetica intera (5.4).
- IVA: i totali inseriti sono lordi; nessun calcolo fiscale in v1 (nessun uso professionale o detraibilita').

### 7.4 Visualizzazione italiana

Formattazione **manuale** (migliaia con punto, decimali con virgola, simbolo dopo l'importo) invece di `Intl`: deterministica su Hermes e su Node, nessun NBSP inatteso, nessuna dipendenza dai dati di localizzazione del telefono; `Intl.DateTimeFormat`/`NumberFormat` restano usabili per testi lunghi (data estesa) se la piattaforma li fornisce.

### 7.5 Codice e test (42 controlli, tutti passati)

`src/domain/units/`: conversioni, formattazione, parsing, coerenza di totale e consumi (`per100ToMpgUS(6,43) = 36,6`, `per100ToMpgUK = 43,9`, `per100ToKmPerL = 15,55`).

```js
// src/domain/units/*.ts : puro. Canonico: km interi, millilitri/millesimi interi, centesimi interi. Mai float nel DB.

// ---------------- distanze
export const KM_PER_MI = 1.609344; // esatto per definizione
export const miToKm = (mi) => Math.round(mi * KM_PER_MI);       // input utente in miglia -> km interi canonici
export const kmToMi = (km) => Math.round(km / KM_PER_MI);       // solo per la visualizzazione
export const toDisplayDistance = (km, unit) => (unit === 'mi' ? kmToMi(km) : km);
export const fromDisplayDistance = (v, unit) => (unit === 'mi' ? miToKm(v) : Math.round(v));

// ---------------- formattazione senza Intl (deterministica su Hermes/Node, nessun NBSP a sorpresa)
const group = (intStr) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const formatInt = (n) => (n < 0 ? '-' : '') + group(String(Math.abs(Math.trunc(n))));
export function formatScaled(v, scale, { grouping = true } = {}) { // v intero scalato (es. centesimi, scale 2)
  const neg = v < 0, a = Math.abs(v), p = 10 ** scale;
  const int = Math.floor(a / p), frac = String(a % p).padStart(scale, '0');
  return (neg ? '-' : '') + (grouping ? group(String(int)) : String(int)) + (scale ? ',' + frac : '');
}
export const formatEuro = (cents) => `${formatScaled(cents, 2)} €`;            // 1.234,56 EUR (simbolo euro)
export const formatPricePerUnit = (milli) => formatScaled(milli, 3, { grouping: false }); // 1,859
export const formatQuantity = (milli) => formatScaled(milli, 3, { grouping: false });      // 40,000 (L)
export const formatDateIt = (ymd) => ymd.split('-').reverse().join('/');                  // 07/10/2026

// ---------------- parsing di numeri scritti dall'utente -> interi scalati (nessun parseFloat)
/**
 * scale = decimali del risultato (2: centesimi, 3: millesimi). thousands 'auto' riconosce 1.234,56 e 1.234 (migliaia);
 * 'none' tratta il punto sempre come decimale (prezzi al litro: "1.859" = 1,859). Troppi decimali o testo ambiguo -> null (nessun arrotondamento silenzioso).
 */
export function parseScaled(input, scale, { thousands = 'auto' } = {}) {
  if (input == null) return null;
  let s = String(input).replace(/[\s  ]/g, '').replace(/[€$]|eur|euro/gi, '');
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const neg = s.startsWith('-'); if (neg) s = s.slice(1);
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length;
  let intPart, fracPart = '';
  if (dots && commas) { // l'ultimo separatore e' il decimale, l'altro le migliaia
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.', th = dec === ',' ? '.' : ',';
    const parts = s.split(dec); if (parts.length !== 2) return null;
    intPart = parts[0].split(th).join(''); fracPart = parts[1];
    if (!/^\d{1,3}(\Q\E)?/.test('0') ) return null;
    if (parts[0].split(th).slice(1).some((g) => g.length !== 3)) return null;
  } else if (commas) { if (commas > 1) return null; [intPart, fracPart] = s.split(','); }
  else if (dots) {
    if (dots > 1) { if (thousands === 'none' || !/^\d{1,3}(\.\d{3})+$/.test(s)) return null; intPart = s.split('.').join(''); }
    else if (thousands === 'auto' && /^\d{1,3}\.\d{3}$/.test(s)) intPart = s.replace('.', ''); // 1.234 -> 1234
    else [intPart, fracPart] = s.split('.');
  } else intPart = s;
  if (!/^\d+$/.test(intPart || '0') || !/^\d*$/.test(fracPart)) return null;
  if (fracPart.length > scale) return null;
  const v = Number(intPart || '0') * 10 ** scale + Number(fracPart.padEnd(scale, '0') || '0');
  return Number.isSafeInteger(v) ? (neg ? -v : v) : null;
}
export const parseEuroToCents = (s) => parseScaled(s, 2, { thousands: 'auto' });
export const parseMilli = (s) => parseScaled(s, 3, { thousands: 'none' });

// ---------------- carburante e consumi
/** totale atteso = quantita' x prezzo, in centesimi, con BigInt (niente overflow ne' float). */
export const expectedTotalCents = (quantityMilli, unitPriceMilli) => Number((BigInt(quantityMilli) * BigInt(unitPriceMilli) + 5000n) / 10000n);
/** tolleranza di validazione: lo scontrino puo' differire di 1-2 centesimi dall'arrotondamento. */
export const totalLooksConsistent = (total, q, p, tol = 2) => Math.abs(total - expectedTotalCents(q, p)) <= tol;
export const per100ToKmPerL = (x) => 100 / x;
export const per100ToMpgUS = (x) => 235.215 / x;
export const per100ToMpgUK = (x) => 282.481 / x;
```


## 8. Struttura moduli e confini tra layer

Obiettivo: poter sviluppare e **testare quasi tutto sul PC Windows** (senza Android SDK, Java o Xcode) e toccare un dispositivo reale solo per Bluetooth, notifiche e biometria. La regola e': il dominio non conosce nessuno, i casi d'uso conoscono solo le porte, gli adattatori implementano le porte.

### 8.1 Strati

| Strato | Cartella | Cosa contiene | Puo' importare |
|---|---|---|---|
| **domain** (puro) | `src/domain/` | tipi, date di calendario, unita', regole di manutenzione, media km/giorno, ricorrenze, piano notifiche, consumi, formato di backup/CSV, **porte** (interfacce) | solo se stesso |
| **app** (casi d'uso) | `src/app/` | `completeItem`, `addServiceRecord`, `addOdometerReading`, `reconcileReminders`, `syncNotifications`, `exportBackup`, `importBackup`, `wipeAllData` ...: orchestrano dominio e porte, aprono le transazioni, emettono eventi | domain |
| **data** | `src/data/` | adattatori SQLite (`expo-sqlite`, `node:sqlite` per i test, `sql.js` per il web su PC), migrazioni, seed, repository/query SQL, export/import, `AttachmentStore` | domain |
| **platform** | `src/platform/` | adattatori Expo: notifiche, task in background, SecureStore, biometria, condivisione file, selettore documenti, crypto, orologio | domain |
| **obd** | `src/obd/` | `protocol/` (parser e registro PID **puri**), `transports/` (BLE, Classic, Wi-Fi, **simulato**), `session/` (registratore che scrive tramite una porta) | domain |
| **ui** | `app/` (expo-router) + `src/ui/` | schermate sottili, componenti, tema, `it.ts` (stringhe), hook di lettura | domain, app |
| **bootstrap** | `src/bootstrap/` | **composition root**: l'unico punto che importa data, platform e obd e collega gli adattatori ai casi d'uso | tutto |

### 8.2 Struttura delle cartelle

```
AutoGarage/
  app/                         expo-router: solo schermate sottili (layout, tab, dettagli)
  src/
    domain/
      ports/                   SqlDatabase, Clock, IdGenerator, FileStore, NotificationScheduler, Authenticator, SecureKeyStore, EventBus
      dates/ units/ odometer/  LocalDate, km/mi, centesimi, parsing, coerenza km
      maintenance/             regole, evaluateRule/evaluateThresholds, rate (media km/giorno), completion, template (tipi)
      reminders/               ricorrenze, notificationPlan (planNotifications, diffScheduled)
      fuel/ insurance/ tyres/ fluids/ costs/ diagnostics/
      backup/                  tipi del formato, upgrader, CSV
    app/
      maintenance/ vehicles/ odometer/ service/ fuel/ insurance/ notifications/ backup/ privacy/
    data/
      db/                      open.ts, pragmas.ts, migrate.ts, migrations/0001_init.ts ...
      adapters/                expoSqlite.ts, nodeSqlite.ts (solo test), sqlJs.ts (web su PC)
      repositories/            query SQL tipizzate che restituiscono tipi di dominio
      seeds/ backup/ files/
    platform/
      notifications/ background/ security/ (secure-store, local-auth) share/ crypto/ clock/
    obd/
      protocol/ transports/ session/
    ui/                        componenti, tema, i18n/it.ts, hook
    bootstrap/                 root.ts: costruisce gli adattatori e le dipendenze (Deps)
  tests/
    unit/                      domain/, app/ (con adattatori finti)
    integration/               data/ (node:sqlite: DDL, migrazioni, backup), obd/ (trascrizioni ELM327)
    architecture/              dependency-cruiser + purezza del dominio
    fixtures/db/               un DB per ogni versione rilasciata (dati sintetici)
  docs/research/
```

### 8.3 Regole di dipendenza (verificate con dependency-cruiser 18.5.0)

Configurazione provata su un mini-progetto con 5 import sbagliati e 2 corretti: ha segnalato esattamente i 5 sbagliati (`ui -> data`, `obd -> platform`, `domain -> data`, `domain -> pacchetto npm`, `data -> app`) e nessuno dei corretti (`bootstrap` che importa tutto, `obd -> domain`). **Attenzione**: dependency-cruiser 18.5.0 supporta TypeScript >= 2 e < 7 (con TypeScript 7.0.2 ha cruisato 0 moduli); in progetto va usato il TypeScript pinnato da Expo (verificato con 6.0.3).

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: 'domain-e-puro', severity: 'error', comment: 'domain importa solo domain: niente pacchetti, niente altri strati',
      from: { path: '^src/domain' }, to: { pathNot: '^src/domain' } },
    { name: 'app-solo-domain', severity: 'error', comment: 'i casi d\'uso parlano con le porte, mai con gli adattatori',
      from: { path: '^src/app' }, to: { path: '^src/(data|platform|obd|ui|bootstrap)' } },
    { name: 'data-non-risale', severity: 'error', from: { path: '^src/data' }, to: { path: '^src/(app|platform|obd|ui|bootstrap)' } },
    { name: 'platform-non-risale', severity: 'error', from: { path: '^src/platform' }, to: { path: '^src/(app|data|obd|ui|bootstrap)' } },
    { name: 'obd-non-risale', severity: 'error', from: { path: '^src/obd' }, to: { path: '^src/(app|data|platform|ui|bootstrap)' } },
    { name: 'ui-senza-infrastruttura', severity: 'error', comment: 'la UI usa casi d\'uso e tipi del dominio; gli adattatori entrano solo da bootstrap',
      from: { path: '^(src/ui|app)/' }, to: { path: '^src/(data|platform|obd)' } },
    { name: 'niente-cicli', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: { tsConfig: { fileName: 'tsconfig.json' }, doNotFollow: { path: 'node_modules' }, includeOnly: '^src|^node_modules/typescript' },
};
```

Il dominio e' anche **deterministico**: nessuna lettura dell'orologio, nessuna casualita', nessuna rete, nessun `console`. Test di purezza (eseguito sui file di riferimento di questo documento: `ok`; su un file con `Date.now()`, `new Date()` e `console.log` segnala le 3 righe). La conversione "data+ora locali -> istante" (`localToInstant`) dipende dal fuso del dispositivo e quindi vive in `platform/clock/`, non nel dominio.

```js
// tests/architecture/domainPurity.test.ts : il dominio non legge l'orologio, non e' casuale, non fa I/O
import { readFileSync } from 'node:fs';
const FORBIDDEN = [
  [/\bDate\.now\s*\(/, 'Date.now(): usa Clock'],
  [/\bnew Date\s*\(\s*\)/, 'new Date() senza argomenti: usa Clock'],
  [/\bMath\.random\s*\(/, 'Math.random(): usa IdGenerator'],
  [/\bperformance\.now\s*\(/, 'performance.now()'],
  [/\bconsole\./, 'console.*: usa un logger iniettato'],
  [/\bfetch\s*\(/, 'fetch(): il dominio non usa la rete'],
  [/from\s+['"](react|react-native|expo|node:|fs|path)/, 'import di piattaforma'],
];
export function checkPurity(file) {
  const src = readFileSync(file, 'utf8').split('\n');
  const hits = [];
  src.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, ''); // ignora i commenti di riga
    for (const [re, why] of FORBIDDEN) if (re.test(code)) hits.push(`${file}:${i + 1} ${why}`);
  });
  return hits;
}
if (process.argv[1].endsWith('purity.mjs')) {
  const files = process.argv.slice(2);
  const all = files.flatMap(checkPurity);
  console.log(all.length ? all.join('\n') : `ok: ${files.length} file di dominio senza orologio, casualita' o I/O`);
  process.exit(all.length ? 1 : 0);
}
```

### 8.4 Le porte (codice TypeScript verificato con `tsc --strict` 6.0.3)

```ts
// src/domain/ports/index.ts : contratti verso il mondo esterno. Il dominio li dichiara, gli altri strati li implementano.
export type LocalDate = string; // 'YYYY-MM-DD'
export type SqlValue = string | number | null | Uint8Array;

export interface SqlDatabase {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  transaction<T>(fn: (tx: SqlDatabase) => Promise<T>, mode?: 'deferred' | 'exclusive'): Promise<T>;
}

export interface Clock {
  nowIso(): string; // istante UTC con millisecondi
  todayLocal(): LocalDate; // data di calendario del dispositivo
  nowLocal(): { date: LocalDate; time: string }; // 'HH:MM'
  timeZone(): string; // IANA, es. 'Europe/Rome'
}
export interface IdGenerator { ulid(): string }

export interface FileStore {
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
  sha256(path: string): Promise<string>;
}

export type PermissionState = 'granted' | 'denied' | 'blocked' | 'undetermined';
export interface PlannedNotification {
  key: string; hash: string; date: LocalDate; time: string; channel: string;
  title: string; body: string; threadId?: string; route?: string;
}
export interface NotificationScheduler {
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  listScheduled(): Promise<{ key: string; hash: string }[]>;
  schedule(items: PlannedNotification[], timeZone: string): Promise<void>;
  cancel(keys: string[]): Promise<void>;
}

export interface Authenticator {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}
export interface SecureKeyStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Eventi di dominio emessi dai casi d'uso DOPO il commit; li ascoltano la UI (invalidazione) e la sincronizzazione notifiche. */
export type DomainEvent =
  | { type: 'data-changed'; scope: 'vehicles' | 'odometer' | 'service' | 'fuel' | 'insurance' | 'reminders' | 'settings'; vehicleId?: string }
  | { type: 'backup-imported' };
export interface EventBus { emit(e: DomainEvent): void; on(fn: (e: DomainEvent) => void): () => void }

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export type DomainError =
  | { code: 'ITEM_NOT_FOUND' }
  | { code: 'FUTURE_DATE' }
  | { code: 'ODO_NON_MONOTONIC'; message: string }
  | { code: 'DUPLICATE_PLATE' };
```

### 8.5 Un caso d'uso completo (verificato con `tsc --strict`; il corpo SQL e' uno schema)

Il caso d'uso riceve le dipendenze per parametro (niente singleton, niente import di Expo): nei test si passa `nodeSqlite` + un `Clock` fisso + `EventBus` finto. Gli errori dei vincoli SQL (`ODO_NON_MONOTONIC` del trigger, indice unico della targa) vengono tradotti in **errori di dominio tipizzati**: la UI non legge mai testi di SQLite.

```ts
// src/app/maintenance/completeItem.ts : caso d'uso. Dipende solo da dominio e porte; le dipendenze si iniettano.
import type { Clock, DomainError, EventBus, IdGenerator, LocalDate, Result, SqlDatabase } from '../../domain/ports';

export interface Deps { db: SqlDatabase; clock: Clock; ids: IdGenerator; events: EventBus }
export interface CompleteItemInput {
  itemId: string; doneOn: LocalDate; doneKm?: number | null; serviceRecordId?: string | null; fluidCheckId?: string | null;
}

/** Traduce gli errori dei trigger/vincoli SQL in errori di dominio tipizzati (la UI non legge mai messaggi SQLite). */
export function mapSqlError(e: unknown): DomainError | null {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes('ODO_NON_MONOTONIC')) return { code: 'ODO_NON_MONOTONIC', message: m };
  if (m.includes('UNIQUE constraint failed: vehicles.plate')) return { code: 'DUPLICATE_PLATE' };
  return null;
}

export async function completeItem(d: Deps, input: CompleteItemInput): Promise<Result<{ completionId: string }, DomainError>> {
  if (input.doneOn > d.clock.todayLocal()) return { ok: false, error: { code: 'FUTURE_DATE' } };
  try {
    const completionId = await d.db.transaction(async (tx) => {
      const item = await tx.get<{ id: string; vehicle_id: string; schedule_type: string; fixed_due_on: string | null }>(
        'SELECT id, vehicle_id, schedule_type, fixed_due_on FROM maintenance_items WHERE id = ? AND deleted_at IS NULL', [input.itemId]);
      if (!item) throw Object.assign(new Error('ITEM_NOT_FOUND'), { domain: { code: 'ITEM_NOT_FOUND' } });
      const id = d.ids.ulid(), now = d.clock.nowIso();
      const source = input.serviceRecordId ? 'service' : input.fluidCheckId ? 'check' : 'manual';
      await tx.run(
        `INSERT INTO maintenance_completions (id, item_id, done_on, done_km, prev_fixed_due_on, source, service_record_id, fluid_check_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.id, input.doneOn, input.doneKm ?? null, item.fixed_due_on, source, input.serviceRecordId ?? null, input.fluidCheckId ?? null, now, now]);
      // ... lettura km (se doneKm), nuova fixed_due_on per i tipi di calendario, chiusura del promemoria aperto, reconcileReminders(item.vehicle_id)
      return id;
    }, 'exclusive');
    d.events.emit({ type: 'data-changed', scope: 'reminders' });
    return { ok: true, value: { completionId } };
  } catch (e) {
    const domain = (e as { domain?: DomainError }).domain ?? mapSqlError(e);
    if (domain) return { ok: false, error: domain };
    throw e; // errore imprevisto: non lo nascondiamo
  }
}
```

### 8.6 Composition root e adattatori per ambiente

| Porta | Produzione (telefono) | Test su PC (Node) | UI su PC (Expo web) |
|---|---|---|---|
| `SqlDatabase` | `expo-sqlite` (transazioni esclusive con `withExclusiveTransactionAsync`) | `node:sqlite` (adattatore di 2.2) | `sql.js` o in-memory (il web di `expo-sqlite` e' alpha, V1) |
| `Clock` | orologio del dispositivo | orologio fisso | orologio del browser |
| `FileStore` | `expo-file-system` (57.0.7) | cartella temporanea | memoria |
| `NotificationScheduler` | `expo-notifications` (4.7) | OS finto (4.8) | scheduler che **stampa il piano** in console |
| `Authenticator` | `expo-local-authentication` | finto | pulsante "sblocca" |
| `SecureKeyStore` | `expo-secure-store` | memoria | memoria |
| Trasporto OBD | BLE/Classic/Wi-Fi reali | `MockTransport` con trascrizioni | `SimulatedTransport` (`docs/research/obd.md` sezione 27) |

`bootstrap/root.ts` sceglie il set in base a `Platform.OS` e a un flag di sviluppo. Un solo posto cambia fra "vero" e "simulato".

### 8.7 Accesso ai dati

- **SQL a mano nei repository**, nessun ORM in v1: lo schema ha trigger, indici parziali, `STRICT`, viste e `CHECK` che un ORM non esprime; le migrazioni sono SQL e la fonte di verita'. Drizzle ORM (0.45.3) ha un driver `expo-sqlite` ma andrebbe comunque affiancato da SQL scritto a mano per quelle parti: da rivalutare solo se la quantita' di query diventa un peso (valutazione, non provato).
- I repository restituiscono **tipi di dominio** (mappatura riga -> oggetto con validazione, ad esempio con `zod` 4.6.5, verificato solo come versione) e non espongono `SqlValue` alla UI.
- Un solo oggetto `SqlDatabase` condiviso per processo; il task in background apre una **propria** connessione (WAL + `busy_timeout`).
- Dopo il commit i casi d'uso emettono un `DomainEvent`; ascoltano (a) la UI per invalidare le letture e (b) un sottoscrittore che chiama `reconcileReminders` + `syncNotifications` con il coordinatore di 4.7. Nessun trigger SQL "intelligente": la logica sta in codice testabile.
- Le letture della UI passano da funzioni di query dei casi d'uso (view model), non da SQL sparso nei componenti.

### 8.8 OBD

`obd/protocol/` e' **puro** come il dominio (decodifica PID, DTC, bitmask, ISO-TP: vedi `obd.md` sezioni 9-15 e 26) e si testa con trascrizioni. `obd/session/ObdRecorder` riceve due porte del dominio: `TelemetryWriter` (batch ogni 1-2 s, 1.4) e `OdometerWriter` (una lettura `source='obd'` a fine sessione, solo se il PID `01A6` o un PID costruttore validato e' disponibile). L'OBD non scrive mai direttamente nelle tabelle dei km: passa dal caso d'uso, cosi' vale la coerenza monotona.

### 8.9 Test: piramide e cosa e' gia' stato eseguito in questa ricerca

| Livello | Dove | Eseguito qui |
|---|---|---|
| DDL, vincoli, trigger, viste, cascata | `tests/integration/data` (`node:sqlite`) | 89 controlli |
| Migrazioni (runner, ricostruzione tabella, rollback, copia pre-migrazione) | idem | 18 controlli |
| Motore promemoria, media km, ricorrenze, rate, consumi, piano notifiche, fuso/ora legale | `tests/unit/domain` | 53 controlli |
| Sincronizzazione notifiche con OS finto, testi, coordinatore | `tests/unit/app` | 11 controlli |
| Backup: export/import, ZIP, zip-slip, CSV, LWW, rollback | `tests/integration/data` | 27 controlli |
| Unita', parsing e formattazione | `tests/unit/domain` | 42 controlli |
| Architettura: dipendenze e purezza | `tests/architecture` | verificato su un mini-progetto |
| **Totale** | | **240 controlli, 0 falliti** (Node 24.19, SQLite 3.53.3, `fflate` 0.8.3, TypeScript 6.0.3) |
| Da fare su dispositivo | | Hermes (`Date`, `Intl`), versione SQLite di `expo-sqlite`, notifiche (4.11), biometria, BLE |

Ordine di implementazione suggerito: (1) `domain/{dates,units,maintenance,reminders}` copiando il codice di 3.11 e 7.5 e i suoi test; (2) `data/db` (apertura, PRAGMA, runner, `0001`, seed) con l'adattatore Node; (3) repository e casi d'uso `addVehicle`, `addOdometerReading`, `addServiceRecord`, `completeItem`, `reconcileReminders`; (4) `syncNotifications` con lo scheduler che stampa, poi l'adattatore reale; (5) export/import; (6) UI. Fino al primo rilascio pubblico **si puo' riscrivere `0001_init`** (nessuna installazione da migrare); dal rilascio in poi vale la regola "mai modificare una migrazione".


## Raccomandazioni

Ordinate per impatto. Confidenza in parentesi; tutte le decisioni tecniche sono state provate con codice eseguito salvo dove indicato.

1. **Dati** (alta): `expo-sqlite` + SQL a mano + migrazioni in moduli TypeScript con runner transazionale e copia `VACUUM INTO` prima di migrare; `STRICT`; ULID; **date di calendario** per tutto il dominio e istanti UTC solo per audit/sessioni; denaro in **centesimi**, prezzi in **millesimi**, distanze in **km interi**.
2. **Una sola tabella dei km** (`odometer_readings`) come fonte unica, con trigger di coerenza monotona fra giorni diversi e stato `ignored` per le letture errate (alta). Rifornimenti, interventi, controlli e OBD vi aggiungono letture collegate.
3. **Tre concetti separati**: regola (`maintenance_items`), storico (`maintenance_completions`, annullabile) e occorrenza (`reminders`, un solo aperto per regola). Lo **stato** (ok/in arrivo/scaduto) non si salva: si calcola da `today` (alta).
4. **Il primo dei due** = minimo fra scadenza per tempo e data prevista per i km; la previsione usa una media km/giorno **pesata per durata con decadimento (emivita 90 giorni), clamp 3x sulla mediana e restringimento verso un prior** quando i dati sono meno di 90 giorni; le stime si mostrano sempre come "stima" e l'app chiede di aggiornare i km quando sono vecchi (media: i parametri vanno tarati con dati reali).
5. **Notifiche locali solo con trigger `DATE`**, finestra di **60**, selezione "una per promemoria poi le piu' vicine", **sentinella** per le escluse, diff idempotente per chiave+hash, ripianificazione a ogni apertura e dopo ogni modifica, task in background come extra; **nessun allarme esatto** su Android; schermata "Verifica notifiche" (media-alta: da provare su dispositivi reali).
6. **Backup in v1** (ZIP con allegati e hash, JSON versionato con upgrader, CSV it-IT/machine anti-iniezione), import "Sostituisci"/"Unisci" transazionale; promemoria di backup; `android.allowBackup = false`. **Sync cloud: no in v1**; v1.x backup automatico su una **cartella scelta dall'utente**; v2 sync per riga end-to-end solo se emerge la domanda (media).
7. **Privacy**: nessun analytics/ads in v1, notifiche con soprannome (non targa) di default, cancellazione a livelli con "Cancella tutti i dati" verificabile, `secure_delete` (media: serve parere legale).
8. **Niente SQLCipher in v1** (rischio di perdita chiave > rischio di fuga; attrito di sviluppo; protezione parziale): opzione "Protezione avanzata" in v1.x. **Blocco app** con `expo-local-authentication` come gate di interfaccia con ripiego sul codice del dispositivo, copertura nello switcher e riautenticazione per esporta/cancella (media).
9. **Architettura a porte e adattatori** con dependency-cruiser (5/5 violazioni rilevate nel test) e test di purezza del dominio; test su Node con `node:sqlite`; UI su PC con `sql.js`/in-memory e trasporto OBD simulato (alta).
10. **Prima di costruire la UI**: spike di 1-2 giorni su un telefono reale per (a) `select sqlite_version()` e `STRICT` in `expo-sqlite` 57, (b) semantica di `new Date(y,m,d,h,mm)` su Hermes nei salti di ora legale, (c) `scheduleNotificationAsync` con identificatore ripetuto e `channelId` su Android, (d) notifica con app chiusa e dopo riavvio, (e) percorso di `VACUUM INTO` (alta priorita').
11. **Seed dei template**: gli intervalli sono generici e dichiarati "indicativi"; validarli con i libretti di manutenzione di 3-5 auto italiane diffuse prima del rilascio e permettere sempre la modifica (media-bassa sui valori).
12. Implementare per fasi: nucleo v1 = veicoli, km, interventi, regole/completamenti/promemoria, rifornimenti, spese, polizze+rate, allegati, impostazioni, backup. `obd_*`, telemetria, DTC, pneumatici e controlli livelli sono gia' nello schema ma la loro UI puo' seguire.


## Rischi

| # | Rischio | Probabilita'/impatto | Mitigazione |
|---|---|---|---|
| 1 | Intervalli dei template sbagliati per un'auto specifica; l'utente si fida | alta / media | etichetta "indicativo", wizard che chiede l'ultimo intervento, valori sempre modificabili, rimando al libretto, nessuna regola presentata come obbligo se non e' di legge |
| 2 | Previsione km imprecisa perche' l'utente non aggiorna l'odometro | alta / media | stima sempre etichettata, previsione che avanza col tempo, invito "Aggiorna i km", letture gratuite da rifornimenti/OBD, confidenza visibile |
| 3 | Notifiche non consegnate (risparmio energetico dei produttori Android, arresto forzato, iOS 64, permesso negato) | media / **alta** (e' il cuore della promessa) | finestra 60 + sentinella, ripianificazione continua, schermata "Verifica notifiche", banner in Home come fonte primaria, prova su dispositivi reali (4.11) |
| 4 | Perdita del telefono = perdita dei dati | media / alta | export in v1, nudge di backup, v1.x backup su cartella cloud dell'utente, avviso su Android Auto Backup disattivato |
| 5 | Migrazioni con ricostruzione di tabella che falliscono su DB reali | bassa / alta | runner transazionale con rollback, copia `VACUUM INTO`, `foreign_key_check`, test su fixture per ogni versione rilasciata, snapshot dello schema |
| 6 | `STRICT` o altre funzioni non disponibili nella versione di SQLite di `expo-sqlite` | bassa / media | spike iniziale; fallback documentato (togliere `STRICT`) |
| 7 | Differenze di Hermes su `Date`/`Intl` (ora legale, locale) | media / media | dominio su date di calendario, formattazione manuale, conversione locale->istante isolata in `platform`, test su dispositivo |
| 8 | ZIP in memoria con molte foto -> out of memory | media / media | ridimensionamento in ingresso, soglia con avviso, passaggio a compressore nativo se necessario |
| 9 | Aspetti legali (GDPR, etichette store, uso del VIN) valutati solo da fonti secondarie | media / media | parere di un legale prima del rilascio; nessun dato esce dal dispositivo in v1 |
| 10 | Android Auto Backup disattivato: cambio telefono piu' macchinoso per utenti poco tecnici | media / media | guida passo-passo nell'app, nudge, in futuro backup su cartella |
| 11 | Over-engineering: 28 tabelle per uno sviluppatore singolo | media / media | implementare per fasi (raccomandazione 12), riscrivere `0001` fino al primo rilascio, UI minima per le aree secondarie |
| 12 | Volume della telemetria OBD | bassa / media | forma stretta (25 byte/riga), retention a 30 giorni/50 MB, rollup a 60 s, il live non si persiste di default |
| 13 | Una libreria di terzi (dependency-cruiser, fflate, node:sqlite sperimentale) cambia comportamento | bassa / bassa | versioni verificate al 2026-10-07 e fissate; `node:sqlite` e' usato solo nei test |


## Domande aperte

1. **Valori reali dei template**: quali intervalli di tagliando/olio/cinghia usano davvero le auto italiane piu' diffuse? (confidenza bassa sui seed attuali; servono i libretti).
2. **Revisione anticipata**: se la revisione si fa prima del mese di scadenza, da quando decorrono i due anni successivi? Il codice usa la data effettiva (modificabile): verificare sulla normativa/Motorizzazione.
3. **Bollo**: l'ultimo giorno utile per il pagamento e' calcolabile in modo affidabile (fine del mese successivo alla scadenza, da `features.md`) o conviene sempre far inserire la data? Oggi la fa inserire.
4. **Tolleranza di 15 giorni dell'RC auto**: leggere il testo dell'art. 170-bis e le indicazioni IVASS per formulare correttamente la nota informativa (V5, confidenza media).
5. **`expo-sqlite` 57**: versione di SQLite inclusa, supporto `STRICT`, `VACUUM INTO`, percorso dei file di backup, comportamento di `backupDatabaseAsync` (non verificati).
6. **Hermes**: semantica di `new Date(y,m,d,h,mm)` nei salti di ora e disponibilita' di `Intl` su Android e iOS (da provare).
7. **expo-notifications**: sostituzione di una richiesta con lo stesso `identifier` su Android, `channelId` nel trigger `DATE`, tetto reale di allarmi su Android, comportamento dopo l'aggiornamento dell'app, tap e deep link con app chiusa.
8. **Contachilometri sostituito o azzerato** (quadro cambiato): serve un "epoch" o un offset per veicolo? Oggi si usa `status = ignored` e una nuova serie; e' raro ma reale.
9. **Rimborsi/storni** (rimborso assicurativo, reso): gli importi sono `>= 0`; serve un tipo "rimborso" o importi negativi?
10. **Ora delle notifiche per singola regola** (es. 18:00 per le scadenze serali) o solo globale (09:00)?
11. **Telemetria nel backup**: includerla (opzione) o sempre esclusa?
12. **Famiglia/piu' conducenti**: e' un requisito di v1 o v2? Decide se la sync serve davvero (5.7).
13. **Prior di ultima istanza** `forecast.defaultAnnualKm = 12000`: sostituirlo con un valore documentato (ACI/ISTAT) o toglierlo e chiedere sempre all'utente "quanti km fai all'anno?".
14. **Scheda storico per il compratore** (PDF/CSV senza dati personali) alla vendita: in v1.x?
15. **Cifratura degli allegati** (AES-GCM per file) e del backup con passphrase: priorita' dopo la v1?
16. **Strumenti**: quale versione di TypeScript fissa Expo SDK 57 e se e' compatibile con dependency-cruiser 18.5.0 (richiede TypeScript < 7).

