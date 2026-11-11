# Ricerca: App concorrenti, funzionalità e UX

> Stato: ricerca di un agente, NON ancora verificata da uno scettico indipendente (vedi sezione "Esito verifica" in fondo, se presente).

## Sintesi

Analisi basata su dati rilevati il 2026-10-06: metadati store (iTunes Lookup IT, Google Play IT/EN), circa 3.260 recensioni da 1-2 stelle (App Store RSS it/us/gb + Google Play it/en) per 9 app, siti ufficiali e fonti normative italiane. Quattro conclusioni. (1) Il mercato è spaccato in due: app di spese/manutenzione (Drivvo, Fuelio, Simply Auto, aCar, My Car) senza OBD, e app OBD (Car Scanner, Torque, OBD Fusion, Carly) senza gestione manutenzione/scadenze. Chi unisce le due cose (FIXD) è USA-centrico e costa 99,99 $/anno. (2) Le lamentele dominano per tema: soldi/paywall/abbonamenti (in testa in tutte le app), perdita dati e sync rotta (peggio nelle app garage: Simply Auto 47%, aCar 35%), abbandono e supporto assente (Simply Auto 38%), connessione OBD instabile (OBD Fusion 34%, Torque 23%, Carly 22%, Car Scanner 19%), poi pubblicità (Drivvo 21%) e compatibilità veicolo/PID a pagamento. (3) Finestra d'opportunità immediata: a settembre 2026 Drivvo (5M+ installazioni Android) è oggetto di un'ondata di recensioni negative per sync/backup/export diventati a pagamento, prezzo Pro quadruplicato secondo gli utenti, limite veicoli ridotto e avviso su condivisione dati di posizione. Gli utenti cercano alternative e il posizionamento 'dati tuoi, locali, esportabili, zero pubblicità, acquisto una tantum' è la risposta diretta. (4) Il requisito 'scaricare tutte le informazioni via Bluetooth' va ridimensionato onestamente: lo standard OBD-II/EOBD espone VIN, DTC, freeze frame, dati live, livello carburante % (se supportato), tensione, a volte odometro; NON espone livello olio, liquido freni/refrigerante/lavavetri né pressione gomme (TPMS) in modo standard. Su iOS funziona solo BLE o Wi-Fi (non Bluetooth Classic). Quindi i 'livelli' vanno gestiti con controlli manuali guidati + promemoria, e la lettura OBD va venduta come 'tutto ciò che la tua auto espone, con report di compatibilità prima dell'acquisto', evitando il pattern 'paghi e poi non è supportato' che genera la maggior parte delle recensioni da 1 stella sulle app OBD. Seguono: schede per ogni app, sintesi lamentele, vincoli tecnici/normativi, MoSCoW, pattern UX, differenziatori, monetizzazione, accessibilità/localizzazione, roadmap, rischi.

## Findings

### 1. Drivvo: leader per base installata, ma a settembre 2026 è in crisi di fiducia (paywall su sync/export, aumento prezzo, pubblicità invasiva)  `[confidenza: medium]`

DATI STORE: iOS IT 4,63 (682 voti), v11.2.2 del 30/09/2026; Android 4,47 su 115.390 voti, 5M+ installazioni, aggiornata 06/10/2026; la scheda Google Play IT dichiara 'Contiene annunci'. Sul sito ufficiale (personal use) promette uso personale 'free forever', sync tra dispositivi, export PDF/CSV, 60+ lingue, accesso web e offline. PREZZI (App Store IT): abbonamenti mensili 0,99-4,90 EUR, annuali 5,99-49,90 EUR, piani flotta 119,99-399,99 EUR/mese. FUNZIONI: carburante, spese/entrate, promemoria manutenzione, checklist, report e grafici, registro percorsi, ricariche EV/ibridi, multi-veicolo (auto, moto, camion, barche ecc.), web app; novità recenti: prezzi carburante da community, spese ricorrenti, modulo letture contatore, trasferimento storico veicolo tra venditore e acquirente. NON ha OBD/Bluetooth. LAMENTELE (recensioni Play ago-ott 2026, riportate da utenti, non confermate da annuncio ufficiale): sync, backup ed export diventati a pagamento anche per utenti storici (8-10 anni); prezzo Pro passato da circa 6-12 a 24,90 EUR/anno secondo vari utenti; limite veicoli gratuiti sceso da 3 a 2; richiesta obbligatoria di creare un account (con errore generico in registrazione); avviso Google Play su condivisione della posizione con terze parti per pubblicità; pubblicità a pieno schermo e con audio; sync web lenta; UI giudicata brutta; impossibile stampare registro manutenzioni. LAMENTELE iOS IT: login richiesto di continuo con perdita dati, notifiche promemoria che non arrivano su iOS, redesign v5.1 che ha nascosto l'ultimo consumo, calcolo km/L errato o assurdo, blocco se il km non è crescente o se due pieni (benzina+GPL) hanno lo stesso km, export Excel scadente, mancano serbatoi doppi/AdBlue. Tally mio su 307 recensioni 1-2 stelle: 42% prezzo/abbonamento, 21% pubblicità, 19% perdita dati/sync, 12% login/account (euristica keyword). Punti forti: gratuità storica, copertura piattaforme (anche web), 60+ lingue.

Fonti:
- https://itunes.apple.com/lookup?id=1206041425&country=it
- https://apps.apple.com/it/app/drivvo-gestione-spese-auto/id1206041425
- https://play.google.com/store/apps/details?id=br.com.ctncardoso.ctncar&hl=it
- https://drivvo.com/en/personal-use/
- https://itunes.apple.com/it/rss/customerreviews/id=1206041425/sortby=mostrecent/json

### 2. Fuelio: semplice e apprezzato, ma su iOS il Pro è in abbonamento e i dati dei distributori sono spesso vecchi; bug di ricalcolo e import  `[confidenza: high]`

DATI STORE: Android 4,37 su 135.787 voti, 5M+, nessuna pubblicità su Play IT, aggiornata 05/10/2026; iOS IT 4,44 (68 voti), v2.8.7 del 01/10/2026 (Sygic). PREZZI iOS (App Store IT): Fuelio Pro 3,99 EUR/mese o 14,99 EUR/anno; il Pro sblocca promemoria manutenzione, scansione ricevute, meteo, report avanzati. Il sito dichiara che dal 2015 (acquisizione Sygic) le funzioni Pro erano gratuite: è un'affermazione datata e i recensori iOS lamentano che la stessa app su Android era tutta inclusa. FUNZIONI: rifornimenti, costi per categoria, timeline unica, promemoria servizi, prezzi/mappa distributori (crowdsourcing), widget e CarPlay, trip diary automatico (novità), backup Google Drive/Dropbox/iCloud, import/export CSV. NON ha OBD. LAMENTELE: abbonamento per funzioni prima gratuite (manutenzione, grafici); prezzi distributori sbagliati/obsoleti (anche 100-300 giorni), HVO/100 ottani non filtrabili; crash e perdita storico rifornimenti; ricalcolo automatico che sporca le modifiche di un rifornimento; duplicati; backup Drive inaffidabile; CSV non standard che non importa dati altrui (import da Drivvo: 0 su 40 righe); manca valuta per veicolo, sconto in percentuale, aggiornamento odometro senza rifornimento; richiede posizione precisa; Android Auto difficile; media consumo 'partially filled' errata. Tally su 402 recensioni 1-2 stelle: 22% prezzo, 15% perdita dati/sync, 13% crash/bug, 9% UI.

Fonti:
- https://itunes.apple.com/lookup?id=1487753318&country=it
- https://apps.apple.com/it/app/fuelio-prezzi-benzina-costi/id1487753318
- https://play.google.com/store/apps/details?id=com.kajda.fuelio&hl=it
- https://fuel.io
- https://itunes.apple.com/it/rss/customerreviews/id=1487753318/sortby=mostrecent/json

### 3. Simply Auto: funzioni complete (reminder, trip, multi-driver, receipts) ma percepita come abbandonata; sync a pagamento che perde dati  `[confidenza: medium]`

DATI STORE: Android 4,58 su 24.343 voti, 500K+, ultimo aggiornamento 10/10/2024 (oltre 2 anni fa), contiene annunci; iOS v50.1.1.1 ultimo update 24/03/2022 (IT: 4,13 su 15 voti). PREZZI (sito ufficiale; le schede store riportano varianti, quindi confidence media): Free con limiti (4 veicoli, 10 task servizio, 15 viaggi auto/mese); Gold 9,99 USD una tantum; Platinum 9,99 USD/anno (listing store: anche 1,49 USD/mese e 29,99 USD una tantum); dichiara 700K download. FUNZIONI: rifornimenti, promemoria per km o data, spese, ricevute, trip GPS automatici (uso business/fiscale), backup cloud, web access, multi-driver, report email, input vocale, unità km/miglia. LAMENTELE (Play 2026): sviluppatore non risponde da mesi, cloud restore che non ripristina manutenzioni e ricevute anche per chi ha pagato; perdita dati cambiando telefono perché la sync chiede di sovrascrivere locale o cloud senza merge; reminder di servizio spostati dietro paywall dopo un update; auto-trip che non chiudono e si fondono; import Excel con struttura non conforme alla guida; nessun supporto per km/l e l/100km in alcune viste. Tally su 218 recensioni 1-2 stelle: 47% perdita dati/sync, 40% prezzo, 38% supporto/abbandono: il peggior profilo del campione.

Fonti:
- https://www.simplyauto.app
- https://apps.apple.com/us/app/simply-auto-mileage-tracker/id893278325
- https://play.google.com/store/apps/details?id=mrigapps.andriod.fuelcons&hl=en
- https://itunes.apple.com/lookup?id=893278325&country=it

### 4. AUTOsist: prodotto B2B per flotte (web + app), non concorrente diretto del consumer italiano  `[confidenza: medium]`

Software web di fleet maintenance: richieste di manutenzione, ispezioni, work order, parti, carburante, notifiche di scadenza, analisi spese, export Excel, trasferimento record, API, permessi. Prezzo da circa 6 USD/mese (Capterra), prova gratuita; Capterra 4,7/5 su 163 recensioni; app iOS 'AUTOsist Fleet Management' 5,0 su 3 voti, aggiornata 12/08/2026. Pubblico: fleet manager, logistica, edilizia. Lezione utile: work order/ispezioni con checklist e storico per officina/veicolo; ma interfaccia e prezzi non adatti all'automobilista privato italiano. I dati vengono da aggregatori (Capterra/GetApp), non dal sito ufficiale: confidence media.

Fonti:
- https://www.capterra.ca/software/157517/autosist
- https://www.getapp.co.uk/software/107209/autosist
- https://itunes.apple.com/search?term=AUTOsist&country=it&entity=software

### 5. aCar: app Android storica, oggi percepita come abbandonata e rovinata dall'integrazione forzata con Fuelly  `[confidenza: high]`

DATI STORE (Play): 2,91 su 21.082 voti, 1M+, ultimo aggiornamento 23/01/2025, con annunci. Comprata da Fuelly nel 2014 (fonte AndroidPolice). PREZZI: versione Pro storica a circa 5,99 USD una tantum; oggi abbonamento Fuelly. FUNZIONI: rifornimenti, servizi, spese, viaggi, incidenti, note, reminder a tempo/km, statistiche, più veicoli, backup/sync cloud Fuelly, import da altre app. LAMENTELE (2025-2026): login obbligatorio a Fuelly anche per ripristinare un backup locale; la licenza Pro/lifetime 'dimenticata' o revocata (utenti che avevano pagato nel 2010 devono ri-registrare ID o pagare ancora); backup/ripristino che duplica veicoli o mostra record vuoti dopo update 2023; crash su salvataggio; pubblicità anche con audio nonostante Pro; UI vecchia e piena di funzioni inutili; limite veicoli; app 'venduta e abbandonata'; alcuni utenti migrano a MyFuelLog2 citando assenza di abbonamento. Tally su 228 recensioni: 43% prezzo/licenza, 35% perdita dati/sync, 18% login/account, 14% pubblicità. Lezione: revocare una licenza lifetime distrugge la reputazione.

Fonti:
- https://play.google.com/store/apps/details?id=com.zonewalker.acar&hl=en
- https://www.androidpolice.com/2014/07/28/car-management-app-acar-receives-first-update-since-bought-fuelly-months-ago/
- https://apppricinglab.com/app/google_play/com.zonewalker.acar

### 6. Car Scanner ELM OBD2: miglior app OBD per rapporto qualità/prezzo, ma free tier svuotato, profili italiani mancanti e supporto assente  `[confidenza: high]`

DATI STORE: iOS IT 4,75 su 5.849 voti (v2.2.22, 05/10/2026); Android 4,62 su 363.430 voti, 10M+, aggiornata 20/07/2026, con annunci nella versione free. PREZZI (App Store IT): Pro 3,99 EUR/6 mesi, 5,49 EUR/anno, 8,99 EUR lifetime; un recensore Android cita 4,29 EUR/anno. FUNZIONI: dashboard personalizzabili, DTC lettura/cancellazione, freeze frame, readiness, PID custom, statistiche consumo, registrazione dati, coding VAG/Hyundai/Kia e funzioni di servizio su alcuni modelli, adattatori Bluetooth classic (solo Android), BLE 4.0 e Wi-Fi ELM327, 19 lingue, Android Auto. NON ha libretto manutenzione, scadenze, spese. LAMENTELE: dopo la transizione al modello Pro molti parametri mostrano solo 'Disponibile in Pro'; Pro che 'fa poco di più' del free; reset service/olio, rigenerazione DPF/FAP, ABS/SRS e temperatura cambio non funzionano su molte auto (Alfa Giulietta/Stelvio, Punto Evo, Citroen C3, Mercedes W177, Jeep, Renault) anche dopo l'acquisto; profili mancanti per auto comuni in Italia (Nissan Micra K14, Fiat Tipo, Giulietta diesel); traduzione italiana mista con russo; connessione BLE che richiede più tentativi o riavvio telefono; cloni ELM327 che muoiono; Android Auto con interruzioni; export CSV non automatico; assistenza che non risponde; rimborsi richiesti. Il sito stesso indica che il guasto dell'adattatore è la causa più comune di mancata connessione. Tally su 526 recensioni 1-2 stelle: 27% prezzo/Pro, 19% connessione, 17% crash/bug, 9% compatibilità/profili.

Fonti:
- https://apps.apple.com/it/app/car-scanner-elm-obd2/id1259933623
- https://itunes.apple.com/lookup?id=1259933623&country=it
- https://play.google.com/store/apps/details?id=com.ovz.carscanner&hl=en
- https://www.carscanner.info/2023/02/
- https://www.carscanner.info

### 7. Torque Pro: acquisto una tantum economico ma Android-only, datato e quasi fermo; la versione iOS omonima è contestata  `[confidenza: medium]`

DATI STORE (Play IT): Torque Pro 3,40 su 81.323 voti, 1M+, prezzo 3,55 EUR, ultimo aggiornamento 03/02/2025; Torque Lite 3,32 su 50.592 voti, ultimo update 13/01/2018. Review specializzata (aggiornata maggio 2026): 4,95 USD una tantum, gauge personalizzabili, plugin per costruttore, log GPS e CSV, installer leggero; contro: solo Android, richiede Bluetooth classic (non BLE), attrito permessi Android 14/15, UI datata con curva di apprendimento. LAMENTELE (Play 2026): app 'dimenticata', plugin non funzionano su telefoni nuovi, forum morto, nessun Android Auto, impossibile eliminare pagine/gauge, backup e restore impostazioni non funzionano, dati sparsi che scompaiono, PID transmission/oil temp non disponibili, Pro non riconosce auto che la Lite riconosceva. App iOS 'Torque Pro' (Collabrains Technologies, 4,40 su 48 voti IT; 73 recensioni su 76 recenti sono 3 stelle o meno): abbonamento obbligatorio anche per connettersi, accuse di essere un clone non ufficiale dell'app Android (accuse di utenti, non verificate: confidence bassa), addebiti settimanali, pubblicità truffa. Tally su 398 recensioni: 26% crash/bug, 23% connessione, 22% prezzo. Lezione: il prezzo una tantum basso è amatissimo, ma senza manutenzione l'app muore.

Fonti:
- https://play.google.com/store/apps/details?id=org.prowl.torque&hl=en
- https://obdadvisor.com/torque-pro-review/
- https://itunes.apple.com/lookup?id=6504351894&country=it
- https://itunes.apple.com/us/rss/customerreviews/id=6504351894/sortby=mostrecent/json

### 8. OBD Fusion: ottima base tecnica (BLE/Wi-Fi, CarPlay) ma add-on per costruttore a pagamento scoperti dopo l'acquisto e connessione instabile  `[confidenza: high]`

DATI STORE: iOS IT 9,99 EUR, 4,68 su 197 voti, v7.4.0 del 16/07/2026 (OCTech); Android 6,49 EUR (Play IT), 4,23 su 3.237 voti, aggiornata 20/07/2026. FUNZIONI: dashboard personalizzabili, lettura/cancellazione DTC, consumo (MPG, l/100km, km/l), prestazioni 0-100, CarPlay, GPS/mappa viaggi, data logging con export CSV; adattatori BLE e Wi-Fi su iOS (Veepeak BLE/BLE+, Carista BLE, OBDLink MX+/CX). LAMENTELE: pacchetti PID per costruttore a circa 15 USD (fino a 75 USD per template Nissan) che si scoprono incompleti solo dopo l'acquisto; nessun rimborso; add-on da riacquistare dopo ripristino; mancano modelli recenti (2025-2026) e funzioni EPB/ABS; grafici che si aggiornano 'a scatti' (utile per vedere il calo di tensione batteria all'avviamento); disconnessioni dal dongle BLE; CarPlay senza gauge; alcune accuse di addebiti settimanali (probabile confusione con cloni). Tally su 365 recensioni: 38% prezzo, 34% connessione (il più alto del campione), 17% compatibilità/PID.

Fonti:
- https://apps.apple.com/it/app/obd-fusion/id650684932
- https://itunes.apple.com/lookup?id=650684932&country=it
- https://play.google.com/store/apps/details?id=OCTech.Mobile.Applications.TouchScan&hl=en
- https://itunes.apple.com/us/rss/customerreviews/id=650684932/sortby=mostrecent/json

### 9. Carly (e OBD Auto Doctor): modello hardware + abbonamento caro, rinnovi automatici contestati, supporto lamentato  `[confidenza: high]`

Carly: iOS IT 4,42 su 448 voti (v41.26, 17/09/2026; app 435,9 MB, iOS 16+); Android 3,77 su 34.263 voti, 1M+, aggiornata 16/09/2026. Lingue: italiano + FR/EN/PL/PT/ES/DE. PREZZI (App Store IT): abbonamenti annuali per marca 28,99-58,99 EUR, bundle 'All Brands' 73,99 EUR, 'Smart Mechanic' 35,99 EUR, combinazioni fino a 109,99 EUR; adattatore proprietario circa 70 EUR. FUNZIONI: diagnosi multi-centralina, dati live, coding (BMW, VAG, Mini, Toyota ecc.), guide riparazione, controllo batteria, rilevamento manipolazione km. Focus premium su BMW/VAG. LAMENTELE (it/us/de): rinnovo annuale da 95-150 EUR addebitato senza avviso e senza rimborso; funzioni di coding annunciate ma non disponibili per il proprio modello, scoperto solo dopo l'acquisto; supporto assente o con risposte automatiche in tedesco; app che non vede più il Wi-Fi dell'adattatore dopo aggiornamenti; spedizioni mancate; adattatore vecchio reso inutilizzabile. Tally su 716 recensioni 1-2 stelle: 56% prezzo/abbonamento (il più alto), 22% connessione, 18% supporto, 14% compatibilità. OBD Auto Doctor (Android 4,04 su 29.599; iOS IT 4,27): cancellare i codici è a pagamento, prova gratuita seguita da addebito annuale non voluto, 'solo funzioni base', alcune connessioni impossibili. FIXD (iOS, IT 3,90 su 29 voti; US 4,6 su 26K): sensore + app con promemoria manutenzione, DTC, AI mechanic; abbonamento 12,99 USD/mese, 99,99 USD/anno o 7,99 USD/settimana: dimostra che OBD + manutenzione ha mercato ma è costoso e USA-centrico.

Fonti:
- https://apps.apple.com/it/app/carly-obd2-auto-scanner/id467344155
- https://itunes.apple.com/lookup?id=467344155&country=it
- https://play.google.com/store/apps/details?id=com.iViNi.bmwhatLite&hl=en
- https://apps.apple.com/us/app/fixd-obd2-scanner/id957168651
- https://play.google.com/store/apps/details?id=com.obdautodoctor&hl=en
- https://itunes.apple.com/it/rss/customerreviews/id=467344155/sortby=mostrecent/json

### 10. My Car (KineApps): concorrente diretto 'garage' con web app, ma limiti veicoli e account premium che causano perdite di dati  `[confidenza: high]`

DATI STORE: iOS IT 4,63 su 870 voti (v5.2.314, 22/09/2026), Android 4,44 su 5.653 voti, 500K+, nessuna pubblicità su Play. PREZZI (App Store IT): Premium 1,49 EUR/mese o 11,99 EUR/anno, tier base 2,99 EUR, piani Business 5,99-119,99 EUR (10-400 veicoli); gratis fino a 3 veicoli, 6 con Premium. FUNZIONI: consumi, interventi, pneumatici, assicurazione, immatricolazione, pedaggi/parcheggi, EV/ibrido, diario viaggi, foto ricevute, filtri storico, web access. LAMENTELE: crash all'avvio dopo aggiornamenti iOS; scadenza abbonamento senza avviso con cancellazione di tutti i dati o dei dati inseriti da web; nessun backup automatico locale/Drive; sync 'non disponibile' dopo il pagamento; magic link non ricevuto; notifiche non funzionanti e nessun widget rifornimenti; mancano scadenzario personalizzabile per bollo/assicurazione e allegati PDF; limite a una sola promemoria custom nella versione gratuita; eliminazione veicolo senza conferma. Tally su 99 recensioni: 49% prezzo, 22% perdita dati/sync, 14% login/account.

Fonti:
- https://apps.apple.com/it/app/my-car-gestione-auto/id1165749302
- https://itunes.apple.com/lookup?id=1165749302&country=it
- https://play.google.com/store/apps/details?id=com.kineapps.mycar&hl=en
- https://itunes.apple.com/it/rss/customerreviews/id=1165749302/sortby=mostrecent/json

### 11. App italiane e istituzionali: coprono scadenze e documenti ma con login CIE/SPID, account obbligatori e nessuna cura del veicolo (olio, livelli, OBD)  `[confidenza: high]`

UnipolMove (iOS IT 4,69 su 45.475): Garage con scadenze di bollo, revisione, assicurazione e tagliando, spese con note spese, telepedaggio, strisce blu, soccorso, vetri; richiede account (clienti Unipol usano le credenziali); lamentele su fatturazione/dispositivi telepedaggio, app che rimanda al sito, impossibilità di aggiungere targhe dopo update, non adatta a clienti business. È il concorrente italiano più vicino come 'garage + scadenze' ed è gratuito grazie alla base assicurativa. ACI Space (4,06 su 2.300): soccorso ACI, sconti soci, ricerca per targa, dopo login i propri veicoli con situazione bollo e certificato di proprietà digitale; recensioni 1-3 stelle dominate da accesso con CIE/SPID che fallisce, lista veicoli in errore, sessione scaduta ad ogni apertura, mancato adeguamento al cambio di residenza. Scanner Veicoli (4,74 su 52.486; ultimo update 02/09/2024): ricerca per targa di copertura assicurativa, bollo, revisione e km all'ultima revisione, senza permessi invasivi. Easypol (4,72 su 9.065): paga bollo/PagoPA senza SPID, con promemoria. App IO/ACI: promemoria gratuito del bollo circa 15 giorni prima della scadenza e pagamento in-app (richiede SPID/CIE e almeno un mese di anticipo). Osservaprezzi Carburanti ufficiale MIMIT (iOS 2,38 su 104 voti, lanciata luglio 2026) e Prezzi Benzina (4,60 su 80.052, community, con pubblicità secondo recensioni). Prima Assicurazioni (4,78 su 107.228): polizze, scadenze e soccorso solo per i propri clienti. Implicazione: promemoria bollo è commodity gratuita (IO), ma nessuna di queste app registra tagliandi, livelli, documenti personali con foto o letture OBD, e nessuna esporta lo storico per la rivendita.

Fonti:
- https://apps.apple.com/it/app/unipolmove/id1609074315
- https://itunes.apple.com/lookup?id=1152912166&country=it
- https://itunes.apple.com/it/rss/customerreviews/id=1152912166/sortby=mostrecent/json
- https://itunes.apple.com/lookup?id=1247460491&country=it
- https://itunes.apple.com/lookup?id=1473791187&country=it
- https://it.motor1.com/features/496364/app-io-pagare-bollo-auto-aci-certificati/
- https://www.money.it/Come-pagare-bollo-auto-con-app-IO
- https://itunes.apple.com/lookup?id=6777092801&country=it

### 12. App dei costruttori (Stellantis/FIAT, MyPeugeot, My BMW, myAudi, Volkswagen): dati di fabbrica ma brand-locked, servizi a pagamento e login instabile  `[confidenza: high]`

FIAT (iOS IT 4,26 su 2.501; FCA Italy): richiede Uconnect Box e pacchetti connected a pagamento (Connect One ecc.); recensioni negative su Grande Panda elettrica: stato batteria, comandi remoti, posizione e login non affidabili, abbonamenti 'cervellotici', abbonamento 12 EUR/mese percepito come caro. MyPeugeot (4,48 su 42.382): prossime scadenze/interventi del piano manutenzione, avvisi tecnici, appuntamenti, viaggi; lamentele su login che si azzera di continuo o in loop, viaggi non registrati senza avviso, sezione manutenzione che si blocca, lentezza, servizi prima gratuiti ora a pagamento. My BMW (4,70 su 93.875; solo 24 su 150 recensioni recenti sotto le 4 stelle): livelli carburante e pressione gomme, posizione, comandi remoti; lamentele su viaggi non tracciati per rendicontazione aziendale e funzioni a pagamento. myAudi 4,51 (21.941), Volkswagen 4,61 (13.233). Implicazioni: (a) legate a un solo marchio e a una connettività che le auto vecchie o usate non hanno; (b) famiglie con auto di marche diverse devono usare 3-4 app; (c) lo storico non segue l'auto alla rivendita. Qui i 'livelli' (pressione gomme, carburante) sono disponibili perché il costruttore usa la telematica proprietaria, non l'OBD standard.

Fonti:
- https://itunes.apple.com/lookup?id=1497318484&country=it
- https://itunes.apple.com/it/rss/customerreviews/id=1497318484/sortby=mostrecent/json
- https://itunes.apple.com/lookup?id=1021587274&country=it
- https://itunes.apple.com/it/rss/customerreviews/id=1021587274/sortby=mostrecent/json
- https://itunes.apple.com/lookup?id=1519034860&country=it
- https://itunes.apple.com/it/rss/customerreviews/id=1519034860/sortby=mostrecent/json
- https://play.google.com/store/apps/details?id=com.volkswagen.weconnect&hl=it

### 13. Tassonomia delle lamentele ricorrenti (3.259 recensioni da 1-2 stelle, 9 app): soldi, dati, connessione, abbandono  `[confidenza: medium]`

Metodo: recensioni 1-2 stelle più recenti recuperate il 2026-10-06 da Google Play (it+en, fino a 100 per filtro/lingua) e App Store RSS (it/us/gb), classificate con regex multi-etichetta: è un'euristica, non un'analisi statistica rappresentativa, ma i ranking sono coerenti con la lettura manuale. Risultati complessivi: prezzo/paywall/abbonamento/rimborsi 37% (include il termine 'Pro', quindi sovrastima); crash/bug 16%; connessione OBD 15% (concentrata nelle app OBD: OBD Fusion 34%, Torque 23%, Carly 22%, Car Scanner 19%); supporto assente/abbandono 13% (Simply Auto 38%, Carly 18%); perdita dati/sync/import-export 12% (Simply Auto 47%, aCar 35%, My Car 22%, Drivvo 19%, Fuelio 15%); compatibilità veicolo/PID/profili 9% (OBD Fusion 17%, Carly 14%); pubblicità 6% (Drivvo 21%, aCar 14%); UI/UX 6%; login/account 5% (aCar 18%, My Car 14%, Drivvo 12%); notifiche/promemoria 2% come keyword ma emergono esplicitamente in recensioni di Drivvo iOS ('promemoria non arrivano'), My Car ('notifiche non funzionano') e MyPeugeot. Pattern qualitativi ripetuti: (1) bait-and-switch: funzioni gratuite spostate dietro paywall o abbonamento (Drivvo, Fuelio, Simply Auto, Car Scanner); (2) il dato dell'utente 'in ostaggio' (sync/export/ripristino a pagamento); (3) licenze lifetime/Pro dimenticate o revocate (aCar, OBD Fusion add-on); (4) cambio telefono = perdita dati; (5) pagare e scoprire che l'auto non è supportata; (6) cloni ELM327 e BLE vs classic mal spiegati; (7) rinnovi automatici non notificati (Carly, OBD Auto Doctor); (8) app abbandonate senza risposta dello sviluppatore (Simply Auto, aCar, Torque); (9) validazioni troppo rigide (km non decrescente, due pieni stesso km) e calcoli consumo errati con pieni parziali/mancati; (10) localizzazione scadente (italiano misto russo).

Fonti:
- https://play.google.com/store/apps/details?id=br.com.ctncardoso.ctncar&hl=it
- https://play.google.com/store/apps/details?id=com.ovz.carscanner&hl=en
- https://itunes.apple.com/it/rss/customerreviews/id=1206041425/sortby=mostrecent/json
- https://itunes.apple.com/us/rss/customerreviews/id=650684932/sortby=mostrecent/json

### 14. Gap di mercato: nessuna app unisce OBD via Bluetooth + libretto di manutenzione + scadenzario italiano con dati locali  `[confidenza: medium]`

Le app garage (Drivvo, Fuelio, Simply Auto, aCar, My Car) non hanno OBD; le app OBD (Car Scanner, Torque, OBD Fusion, Carly, OBD Auto Doctor) non hanno interventi, spese, documenti, scadenze; le app dei costruttori sono mono-marca; le app italiane di scadenze (UnipolMove, ACI Space, IO) richiedono account/identità digitale e non trattano olio, gomme, livelli o OBD; FIXD fa OBD+manutenzione ma a 99,99 USD/anno e solo con il proprio sensore. Un'app che al collegamento OBD aggiorna km, tensione batteria, DTC e livello carburante nello stesso storico dove vivono tagliandi e scadenze non esiste a prezzo accessibile in italiano. Evidenza indiretta: l'utente Play di Drivvo che scrive 'fanno schifo tutte le app per gestire i veicoli' (giugno 2025) e le richieste di widget rifornimenti e scadenziario bollo/assicurazione nelle recensioni My Car.

Fonti:
- https://apps.apple.com/us/app/fixd-obd2-scanner/id957168651
- https://apps.apple.com/it/app/unipolmove/id1609074315
- https://play.google.com/store/apps/details?id=br.com.ctncardoso.ctncar&hl=it
- https://itunes.apple.com/it/rss/customerreviews/id=1165749302/sortby=mostrecent/json

### 15. Cosa si legge davvero via OBD-II/EOBD e cosa NO: base per interpretare 'livello' e 'scaricare tutte le informazioni'  `[confidenza: high]`

LEGGIBILE con PID standard SAE J1979 (se la centralina li supporta: va sempre interrogata la bitmap dei PID supportati): VIN (Mode 09 PID 02), DTC memorizzati (Mode 03) e cancellazione (Mode 04), freeze frame, readiness monitor, regime/velocità/carico, temperatura refrigerante (PID 0x05), temperatura olio motore (0x5C, spesso non supportata), temperatura aria ambiente (0x46), livello serbatoio carburante in % (0x2F), consumo istantaneo (0x5E, raro), tensione modulo di controllo (0x42), distanza dal reset DTC (0x31), odometro (0xA6, raramente implementato). NON standard (solo PID/UDS specifici del costruttore, quindi non 'tutto'): livello olio, livello refrigerante, liquido freni, lavavetri/AdBlue, pressione e temperatura gomme (TPMS), contatori degli intervalli service, stato batteria 12V/HV, molte funzioni di coding e reset. L'EOBD è obbligatorio in UE dal 2001 (benzina) e dal 2004 (diesel), quindi praticamente tutte le auto in circolazione da quegli anni sono leggibili in modo generico. Il TPMS è obbligatorio sulle nuove M1 in UE dal 1 novembre 2014 ma si legge solo sul cruscotto o con diagnosi costruttore. Il voltaggio all'adattatore (comando AT RV dell'ELM327) è un'alternativa pratica alla tensione batteria quando il PID 0x42 manca (nota tecnica da verificare sul campo). Implicazione di prodotto: promettere 'tutto' porterebbe alle stesse recensioni da 1 stella viste su Car Scanner e OBD Fusion; promettere 'tutto ciò che la tua auto espone, con report di compatibilità' no.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://en.wikipedia.org/wiki/On-board_diagnostics
- https://en.wikipedia.org/wiki/Tire-pressure_monitoring_system
- https://www.schradertpms.com/en-gb/node/1818791

### 16. Vincoli Bluetooth: iOS solo BLE o Wi-Fi; Android Classic+BLE con permessi Nearby Devices; serve build nativa (EAS), non Expo Go  `[confidenza: high]`

iOS non espone Bluetooth Classic (RFCOMM): gli ELM327 'Bluetooth 3.0' economici non funzionano; ok BLE 4.0 (Veepeak BLE/BLE+, Carista, Kiwi 3/4, LELink, OBDLink CX), Wi-Fi, oppure i pochi classici certificati MFi (OBDLink MX+, vLinker FS/MS). Android: Classic SPP e BLE; da Android 12 servono permessi Nearby devices (BLUETOOTH_SCAN/CONNECT), fino a Android 11 la posizione; per connessioni in background serve un foreground service di tipo connectedDevice (obbligatorio dichiarare il tipo dal target API 34). Cause di mancata connessione indicate dal produttore di Car Scanner: dispositivo sbagliato selezionato, più adattatori con stesso nome, confusione Classic/BLE, permessi, app OBD concorrenti, blocco del driver Bluetooth, e soprattutto adattatore guasto (cloni che durano da 1 uso a 1 anno). Wi-Fi: il telefono lascia la rete di casa e perde Internet, attrito su iOS. Per sviluppo senza hardware su PC Windows: interfaccia di trasporto astratta con adattatore ELM327 simulato (replay di sessioni registrate) per provare UI, parsing e flussi nell'ambiente web/emulatore; le librerie BLE native richiedono dev client/EAS build. Pacchetti npm verificati il 2026-10-06: expo 57.0.27 (dist-tag latest), react-native 0.87.1, react-native-ble-plx 3.5.1 (ultima pubblicazione 2026-02-18), react-native-bluetooth-classic 1.73.0-rc.17 (solo release candidate: rischio manutenzione), react-native-ble-manager 12.5.3, expo-notifications 57.0.22, expo-sqlite 57.0.4, expo-widgets 57.0.23, react-native-android-widget 0.22.1, @bacons/apple-targets 5.0.0, @react-native-ml-kit/text-recognition 2.0.0 (ultimo publish 2025-09-01), react-native-vision-camera 5.2.3, expo-camera 57.0.6, expo-print 57.0.2, expo-sharing 57.0.22, expo-file-system 57.0.7, expo-document-picker 57.0.3, expo-local-authentication 57.0.3, expo-secure-store 57.0.4, expo-background-task 57.0.21, i18next 26.4.2, date-fns 4.4.0, zod 4.6.5, drizzle-orm 0.45.3.

Fonti:
- https://www.carscanner.info/?p=69
- https://www.carscanner.info/2023/02/
- https://obdadvisor.com/torque-pro-review/
- https://developer.android.com/about/versions/14/behavior-changes-14
- https://www.npmjs.com/package/react-native-ble-plx
- https://www.npmjs.com/package/react-native-bluetooth-classic
- https://www.npmjs.com/package/expo

### 17. Scadenze italiane da precaricare (con regole verificate) per un'app 'perfetta' in Italia  `[confidenza: medium]`

REVISIONE auto: prima revisione 4 anni dopo l'immatricolazione (entro la fine del mese di immatricolazione), poi ogni 2 anni (entro il mese dell'ultima revisione); costo 2026: 79,02 EUR in centro autorizzato, circa 45 EUR in Motorizzazione. BOLLO: pagamento entro l'ultimo giorno del mese successivo a quello di scadenza (es. scade luglio, si paga entro il 31 agosto 2026); modalità: pagoPA/Bollonet, siti regionali, delegazioni ACI, tabaccai/Mooney, app IO; promemoria gratuito IO circa 15 giorni prima. L'importo dipende da Regione, kW ed Euro: meglio NON calcolarlo ma lasciare importo manuale e link ai servizi ufficiali. RC AUTO: tacito rinnovo abolito dal 2013 (DL 179/2012, L. 221/2012), polizza annuale, tolleranza di 15 giorni dopo la scadenza prevista dalle fonti consultate (da verificare su IVASS prima di hard-codare), attestato di rischio digitale/dinamico nella banca dati ANIA (BD-ATRC), classe di merito 1-18. GOMME: obbligo invernali o catene a bordo dal 15 novembre al 15 aprile sulle strade con ordinanza (circa il 30% della rete), multe 41-81 EUR; pneumatici M+S/invernali con indice di velocità inferiore a quello del libretto vanno sostituiti dal 15 maggio al 15 ottobre; sanzione 422-1.695 EUR. BOMBOLE: per il metano la scadenza è riportata sul cartellino GFBM di ogni bombola (cadenza dipende dall'omologazione, riqualifica R110 dal 14/07/2022): servono una data personalizzata e un campo foto del cartellino, non un'unica regola fissa. LIBRETTO/DU: campi standard UE per OCR: A targa, B data prima immatricolazione, E numero di telaio (VIN), D.1 marca, D.3 denominazione commerciale, P.1 cilindrata, P.2 potenza kW, P.3 alimentazione, V.7 CO2.

Fonti:
- https://www.sicurauto.it/news/codice-della-strada/revisione-auto-2026-chi-deve-sottoporsi-al-controllo/
- https://www.quotidianomotori.com/automobili/revisione-auto-2026-costo-scadenza-quando-farla/
- https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/
- https://www.altroconsumo.it/auto-e-moto/rc-auto/news/nuove-regole-per-le-polizze-rc-auto-sparisce-il-tacito-rinnovo
- https://www.sicurauto.it/guide-utili/tacito-rinnovo-e-tolleranza-di-15-giorni-dopo-la-scadenza/
- https://www.studiocataldi.it/articoli/28770-rc-auto-arriva-l-attestato-di-rischio-dinamico.asp
- https://certifico.com/trasporto/trasporto-strada/7221-pneumatici-invernali-o-catene-dal-15-novembre-al-15-aprile
- https://www.sicurauto.it/news/cambio-gomme-estive-chiarezza-sugli-pneumatici-di-tipo-ms/
- https://it.motor1.com/features/459094/revisione-bombole-gpl-metano-auto-quando-costi/
- https://www.automobilista.it/come-leggere-il-libretto-di-circolazione-dellauto-e-capire-tutti-i-dati/

### 18. Dati carburante ufficiali gratuiti (MIMIT, licenza IODL 2.0) permettono un prezzo carburante senza pubblicità né crowdsourcing  `[confidenza: high]`

Il Ministero (MIMIT) pubblica ogni giorno in CSV l'anagrafica degli impianti attivi e i prezzi praticati (valori in vigore alle 8 del giorno precedente), licenza IODL 2.0, dal 10/02/2026 con separatore '|'. Le app crowdsourced (Fuelio, Prezzi Benzina) sono criticate per prezzi vecchi o distributori mancanti e filtri carburante assenti (HVO, 100 ottani, GPL, metano); l'app ufficiale MIMIT ha 2,38 stelle (luglio 2026). Funzione 'Could' fattibile ma non banale: file voluminosi (tar.gz), serve pre-elaborazione lato server o un file ridotto per provincia; da non includere in v1.

Fonti:
- https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti
- https://itunes.apple.com/lookup?id=6777092801&country=it
- https://itunes.apple.com/lookup?id=373044013&country=it

### 19. MoSCoW - MUST (v1.0): il nucleo che soddisfa la richiesta dell'utente senza promesse irrealistiche  `[confidenza: medium]`

M1 Garage multi-veicolo senza limiti artificiali (costo marginale zero con dati locali; i concorrenti limitano a 2-3 gratis): targa, VIN, marca/modello/anno, alimentazione (benzina, gasolio, GPL, metano, bi-fuel, ibrido, EV), km attuali, foto. M2 Registro interventi/tagliandi fatti: data, km, officina, costo (ricambi/manodopera), note, foto/PDF fattura, tipi predefiniti (tagliando, cambio olio e filtri, freni, distribuzione, gomme, revisione, carrozzeria). M3 Scadenzario con semafori: RC auto (compagnia, n. polizza, premio, rate, scadenza), bollo, revisione (calcolo automatico 4+2 anni modificabile), tagliando e cambio olio (a km o mesi, vale il primo), gomme stagionali, scadenze personalizzate. M4 Promemoria locali affidabili (es. 30/7/1 giorni prima, azioni 'Fatto' e 'Posticipa'), previsione della data per scadenze a km in base ai km medi mensili, riepilogo a schermata. M5 Rifornimenti in meno di 10 secondi: litri, prezzo/l o totale (calcola il terzo), km, pieno/parziale/mancato, consumo corretto, due serbatoi (benzina+GPL/metano), carburanti italiani (HVO, 100 ottani, AdBlue), ricariche EV in kWh; validazione km con avviso e non blocco. M6 Spese e TCO: categorie, costo al km, costo mensile/annuo, grafici. M7 Documenti con foto/PDF (libretto, polizza, fatture, multe) con scadenza e blocco biometrico. M8 Dati locali, backup/ripristino visibile ('ultimo backup: oggi'), export CSV/JSON/PDF sempre gratuiti, import da CSV di Drivvo/Fuelio/Simply Auto/aCar/My Car. M9 Collegamento OBD Bluetooth: wizard adattatore (BLE su iOS/Android, Classic su Android, Wi-Fi come fallback), rilevamento protocollo e bitmap PID, lettura VIN, DTC con descrizioni in italiano, freeze frame, readiness, dati live essenziali (refrigerante, giri, velocità, carico, livello carburante %, tensione), cancellazione codici con avviso (non risolve la causa e azzera i monitor prima della revisione), snapshot salvato nella timeline, adattatore simulato per sviluppo/demo. M10 'Livelli': registro di controlli manuali (olio, refrigerante, freni, lavavetri, AdBlue, pressione gomme) con esito rapido OK/basso/rabboccato e promemoria; lettura automatica solo dove esiste (carburante %, temperature, tensione). M11 Italiano nativo, dark mode, accessibilità di base (vedi finding dedicato). M12 Zero pubblicità, zero tracker, nessun account obbligatorio.

Fonti:
- https://itunes.apple.com/it/rss/customerreviews/id=1206041425/sortby=mostrecent/json
- https://play.google.com/store/apps/details?id=com.kajda.fuelio&hl=en
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://www.carscanner.info/2023/02/

### 20. MoSCoW - SHOULD (v1.x, entro 3-6 mesi dal lancio)  `[confidenza: medium]`

S1 Scansione libretto/Documento Unico con OCR on-device (ML Kit su Android; Apple Vision o equivalente su iOS) per precompilare targa (A), VIN (E), prima immatricolazione (B), marca (D.1), modello (D.3), cilindrata (P.1), kW (P.2), alimentazione (P.3); stesso motore OCR per ricevute carburante e fatture (Fuelio lo offre solo nel Pro). S2 Widget iOS/Android 'Prossima scadenza' e 'Aggiungi rifornimento' + scorciatoie Siri/App Intents. S3 Sync automatico dell'odometro quando l'OBD è connesso (se PID 0xA6 supportato, altrimenti suggerimento da correggere a mano). S4 Esportazione PDF 'storico per rivendita' con timeline interventi, costi, scadenze, snapshot OBD e riepilogo coerenza km; versione con QR/hash di integrità. S5 Gomme: set estivo/invernale/4 stagioni (misura, DOT, età, km percorsi, deposito, battistrada), promemoria cambio stagionale, pressione consigliata. S6 Checklist pre-viaggio lungo: livelli, pressione gomme, luci, DTC e tensione batteria letti via OBD. S7 Condivisione con familiari tramite file/QR cifrato o backup condiviso su cloud personale (iCloud/Drive); S8 Report e grafici: costo al km per anno, consumo medio, spese per categoria, confronto tra veicoli. S9 Intervalli di manutenzione predefiniti generici e modificabili (non per modello: non esiste una fonte aperta affidabile). S10 Valore residuo stimato inserito dall'utente con curva di svalutazione e TCO a vita. S11 Calendario: esporta scadenze come eventi .ics (ridondanza se le notifiche vengono bloccate).

Fonti:
- https://www.automobilista.it/come-leggere-il-libretto-di-circolazione-dellauto-e-capire-tutti-i-dati/
- https://www.npmjs.com/package/expo-widgets
- https://www.npmjs.com/package/@react-native-ml-kit/text-recognition
- https://apps.apple.com/it/app/fuelio-prezzi-benzina-costi/id1487753318

### 21. MoSCoW - COULD e WON'T (esclusioni motivate)  `[confidenza: medium]`

COULD (dopo il PMF): prezzi carburante da dati MIMIT con filtri HVO/GPL/metano/self; diario viaggi GPS e rimborsi chilometrici; condivisione in tempo reale con sync E2E opzionale; CarPlay/Android Auto con cruscotto OBD in sola lettura; log OBD automatico in background con foreground service; profili PID esteso per le 3-5 marche più diffuse in Italia (Stellantis, VW Group) validati su auto reali; Apple Watch; promemoria scadenza bombola metano e scadenza patente/CQC; spiegazioni DTC assistite da AI con consenso esplicito (costo e privacy da valutare). WON'T (v1): coding/adattamenti e funzioni di servizio ECU (reset service, rigenerazione DPF, freno di stazionamento elettrico): sono la principale fonte di recensioni da 1 stella su Car Scanner, OBD Fusion e Carly, richiedono manutenzione per marca/modello e comportano rischi di responsabilità; pubblicità o vendita di dati e posizione (causa della rivolta contro Drivvo); account obbligatorio e cloud proprietario di default; ricerca per targa con scraping di servizi pubblici (rischio legale/privacy, dipendenza da terzi); preventivi assicurativi con lead generation; supporto Bluetooth Classic su iOS (impossibile senza MFi); funzioni flotta/B2B (AUTOsist, Drivvo Fleet presidiano già quel segmento); versione web.

Fonti:
- https://www.carscanner.info/?p=69
- https://play.google.com/store/apps/details?id=br.com.ctncardoso.ctncar&hl=en
- https://apps.apple.com/it/app/carly-obd2-auto-scanner/id467344155
- https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti

### 22. Interpretazione di 'livello': cosa è automatico via OBD e cosa va registrato a mano con promemoria  `[confidenza: medium]`

AUTOMATICO (se la bitmap PID lo conferma): livello carburante % (PID 0x2F), temperatura refrigerante (0x05), temperatura olio (0x5C, rara), tensione batteria/modulo (0x42 o AT RV), km (0xA6, rara). MANUALE GUIDATO (non esistono PID standard): livello olio (con astina a motore freddo, su piano), livello refrigerante, liquido freni, lavavetri, AdBlue, pressione gomme a freddo (il TPMS di serie è obbligatorio sulle nuove auto dal 2014 ma si legge solo sul cruscotto), battistrada. Template di promemoria proposti (tutti modificabili e collegati a km o data, vale il primo): 'Controlla livello olio ogni 1.000 km o prima di un viaggio lungo'; 'Pressione gomme a freddo ogni mese e prima di ogni viaggio, più dopo il cambio stagionale'; 'Liquido freni: sostituzione ogni 2 anni (valore indicativo, verificare sul libretto uso e manutenzione)'; 'Livello refrigerante e lavavetri: ogni mese o a ogni tagliando'; 'AdBlue: quando il cruscotto o l'app segnala meno di 2.000 km di autonomia'. UX: scheda 'Controllo livelli' con tre tap (livello OK/basso/rabboccato + quantità opzionale + foto opzionale), registro che alimenta il costo (litri di olio aggiunti ogni X km rivelano consumo anomalo) e un avviso quando la frequenza di rabbocchi aumenta. Per auto con sensore olio elettronico o TPMS leggibile via PID costruttore, mostrare 'lettura automatica disponibile' solo dopo validazione su veicolo reale.

Fonti:
- https://en.wikipedia.org/wiki/OBD-II_PIDs
- https://en.wikipedia.org/wiki/Tire-pressure_monitoring_system
- https://www.schradertpms.com/en-gb/node/1818791

### 23. Pattern UX vincenti (e anti-pattern da evitare) ricavati da recensioni e schede store  `[confidenza: medium]`

1) Home con hero 'Prossima scadenza' e semafori per categoria (verde/giallo/rosso con icona e testo 'Scaduta da 3 giorni', non solo colore): ripreso da Garage di UnipolMove e dal piano manutenzione di MyPeugeot. 2) Aggiunta rapida rifornimento (FAB o widget): tastiera numerica sempre visibile, valori precompilati (ultimo carburante, ultimo prezzo, km stimati dall'OBD), ricalcolo del terzo campo tra litri/prezzo/totale, sconto in % opzionale; evitare i difetti segnalati (tastiera che non compare, ricalcolo che altera le modifiche). 3) Onboarding in meno di 2 minuti: scansione libretto o targa+VIN manuale, alimentazione, km attuali, 3 scadenze iniziali (RC, bollo, revisione); chiedere permesso notifiche solo dopo la prima scadenza e il permesso Bluetooth solo al tap su 'Collega auto'. 4) Wizard OBD guidato: tipo adattatore, test di compatibilità, messaggi in italiano chiari ('adattatore trovato, l'auto non risponde: accendi il quadro'), elenco adattatori testati, modalità demo con adattatore simulato. 5) Timeline unificata per veicolo (rifornimenti, interventi, snapshot OBD, documenti): apprezzata in Fuelio. 6) Fiducia dei dati: backup automatico con stato visibile, annulla/cestino per ogni eliminazione, conferma esplicita prima di cancellare un veicolo (My Car cancellava senza avviso), export sempre accessibile. 7) Notifiche azionabili (Fatto, Posticipa 7 giorni), cumulate, con ore silenziose, più ridondanza con banner in-app e calendario (problema 'notifiche non arrivano' su Drivvo iOS e My Car). 8) Non rompere la UI con redesign che nascondono dati chiave (Drivvo v5.1) e non mostrare paywall prima del valore (Torque iOS blocca anche la connessione senza abbonamento). 9) Widget e scorciatoie come strumenti di inserimento, non solo di visualizzazione. 10) Un click per il PDF 'storico per rivendita'. 11) Mostrare costi/km nella scheda veicolo come numero guida, con spiegazione di come è calcolato.

Fonti:
- https://apps.apple.com/it/app/unipolmove/id1609074315
- https://itunes.apple.com/lookup?id=1021587274&country=it
- https://itunes.apple.com/it/rss/customerreviews/id=1206041425/sortby=mostrecent/json
- https://itunes.apple.com/it/rss/customerreviews/id=1165749302/sortby=mostrecent/json
- https://apps.apple.com/it/app/fuelio-prezzi-benzina-costi/id1487753318

### 24. Differenziatori realistici e sostenibili per uno sviluppatore singolo (in ordine di rapporto valore/sforzo)  `[confidenza: medium]`

D1 'I tuoi dati restano tuoi': local-first (SQLite), nessun account, export CSV/JSON documentato e gratuito, importatori dai concorrenti. Costo basso, impatto alto soprattutto nella finestra post-rivolta Drivvo di settembre 2026; promessa pubblica 'se smettiamo di aggiornare, l'export resta' (risposta ad abbandono di Simply Auto, aCar, Torque). D2 Scadenzario italiano pronto all'uso (RC 12 mesi senza tacito rinnovo, bollo a mese+1, revisione 4+2, gomme 15/11-15/4, bombola metano) con link a pagoPA/app IO/ACI e scheda 'In caso di incidente' (n. polizza, assistenza, targa). D3 OBD + libretto in un'unica timeline (snapshot, DTC, tensione e carburante storicizzati) con solo funzioni standard: manutenzione limitata, nessun coding. D4 Report di compatibilità OBD prima di pagare e lettura base sempre gratis (VIN, DTC, cancellazione): elimina il pattern 'pagato ma l'auto non è supportata' e 'cancellare i codici è a pagamento'. D5 OCR del libretto on-device: nessun concorrente consumer lo ha per il Documento Unico; la privacy è un valore aggiunto. D6 Storico per rivendita in PDF con QR di verifica (Drivvo ha appena aggiunto un trasferimento storico, ma dentro il proprio cloud). D7 Prezzi chiari: acquisto una tantum, nessun peggioramento retroattivo ('grandfathering'). D8 Famiglia/multi-marca: un'unica app per tutte le auto di casa, neutra rispetto ai costruttori. Differenziatori da NON inseguire all'inizio: dati per modello (non esiste una fonte aperta), profili PID per marca, cloud proprio, app web, flotta.

Fonti:
- https://play.google.com/store/apps/details?id=br.com.ctncardoso.ctncar&hl=en
- https://play.google.com/store/apps/details?id=mrigapps.andriod.fuelcons&hl=en
- https://apps.apple.com/it/app/drivvo-gestione-spese-auto/id1206041425
- https://it.motor1.com/features/496364/app-io-pagare-bollo-auto-aci-certificati/

### 25. Monetizzazione eticamente corretta (default: nessuna pubblicità, dati locali) con benchmark di prezzo  `[confidenza: medium]`

BENCHMARK (EUR salvo diversa indicazione): Torque Pro 3,55 una tantum (Android); Car Scanner 8,99 lifetime o 5,49/anno; OBD Fusion 9,99 iOS / 6,49 Android + add-on circa 15 USD l'uno; Simply Auto Gold 9,99 USD una tantum, Platinum 29,99 USD una tantum o 9,99 USD/anno; My Car 11,99/anno; Fuelio Pro iOS 14,99/anno; Drivvo Pro 24,90/anno secondo gli utenti; Carly 73,99 All Brands + adattatore circa 70; FIXD 99,99 USD/anno e 7,99 USD/settimana. PROPOSTA: (1) Gratis per sempre: tutto il registro dati (veicoli illimitati, interventi, scadenze, rifornimenti, spese, documenti, livelli), backup ed export, OBD lettura base (collegamento, VIN, DTC, cancellazione, dati live essenziali). (2) 'Pro' una tantum 14,99-19,99 EUR (acquisto non consumabile, con Family Sharing dove possibile): OCR libretto/ricevute, widget e scorciatoie, PDF rivendita brandizzato, log OBD avanzato con grafici ed export, temi/icone, condivisione famiglia via file/QR. (3) Opzionale solo se esiste un costo reale di server: 'Sync cifrato E2E' 1,99 EUR/mese o 14,99 EUR/anno, con l'app pienamente funzionante senza. (4) Sostenitore/mancia una tantum (2-5 EUR). (5) Link affiliato dichiarato e opzionale a 2-3 adattatori BLE testati (riduce i resi e il supporto). REGOLE ETICHE: mai bloccare lettura/export/backup dei dati dell'utente; mai pubblicità né vendita/condivisione di posizione; prezzo bloccato per chi ha già acquistato e nessuna revoca di licenze; niente abbonamenti settimanali, trial con addebito a sorpresa o rinnovi non notificati (promemoria 7 giorni prima); rimborso semplice entro 14 giorni; trasparenza su ciò che è in Pro prima dell'acquisto. Da evitare: lead generation assicurativa come ricavo primario (conflitto di interessi con l'utente).

Fonti:
- https://apps.apple.com/it/app/car-scanner-elm-obd2/id1259933623
- https://apps.apple.com/it/app/obd-fusion/id650684932
- https://apps.apple.com/it/app/my-car-gestione-auto/id1165749302
- https://apps.apple.com/it/app/fuelio-prezzi-benzina-costi/id1487753318
- https://apps.apple.com/it/app/drivvo-gestione-spese-auto/id1206041425
- https://apps.apple.com/it/app/carly-obd2-auto-scanner/id467344155
- https://www.simplyauto.app
- https://obdadvisor.com/torque-pro-review/

### 26. Accessibilità e localizzazione italiana: requisiti concreti  `[confidenza: medium]`

FORMATI it-IT: data gg/mm/aaaa (24 h, settimana da lunedì), numeri con virgola decimale e punto per le migliaia (1.234,56), valuta 1.234,56 € con spazio non separabile, km con separatore migliaia (123.456 km), carburante in litri con prezzo/l a 3 decimali (es. 1,789 €/l: i dati MIMIT riportano tre decimali), consumo selezionabile tra km/l (uso comune) e l/100 km (etichette UE/WLTP), EV in kWh/100 km, valuta e unità per singolo veicolo (richiesta ricorrente su Fuelio), input numerico che accetti sia la virgola sia il punto (verificare su tastiere iOS/Android). Usare Intl/i18next con plurali corretti, nessuna concatenazione di stringhe, traduzione completa di DTC, categorie e PID in italiano (evitare il misto italiano/russo di Car Scanner). TERMINOLOGIA: tagliando, revisione, bollo, RC auto/RCA, kasko, furto e incendio, assistenza stradale, carta di circolazione/Documento Unico, targa, telaio (VIN), pieno, self/servito, GPL, metano, gasolio, HVO, AdBlue, gomme invernali/estive/4 stagioni, deposito gomme, classe di merito, scatola nera. ACCESSIBILITÀ: obiettivo WCAG 2.2 AA / EN 301 549; l'European Accessibility Act è applicabile dal 28/06/2025 (D.Lgs. 82/2022, linee guida AgID 2026) con esenzione per microimprese di servizi (meno di 10 addetti e fino a 2 milioni EUR), quindi probabilmente non obbligatorio per un singolo sviluppatore ma è un valore competitivo. Checklist: etichette VoiceOver/TalkBack su ogni controllo, compresi gauge e grafici (con alternativa tabellare), supporto Dynamic Type/ridimensionamento font fino al 200% senza troncamenti, contrasto 4,5:1 anche in dark mode, bersagli minimi 44 pt iOS / 48 dp Android, i semafori sempre con icona e testo, nessuna informazione solo a colore, reduce motion, notifiche con testo chiaro ('Assicurazione Fiat Panda scade tra 7 giorni'), messaggi di errore in italiano semplice, input vocale/Siri per rifornimento, interfaccia OBD pensata per auto ferma (nessuna interazione complessa alla guida), ottimizzazione a una mano con navigazione in basso.

Fonti:
- https://www.agendadigitale.eu/?p=266695
- https://www.osborneclarke.com/it/insights/eu-accessibility-act-e-ora-di-avviare-i-progetti-interni-di-compliance
- https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti
- https://itunes.apple.com/it/rss/customerreviews/id=1259933623/sortby=mostrecent/json
- https://www.lautomobile.aci.it/attualita/bollo-auto-2026-scadenze-tariffe-ed-esenzioni-la-guida-completa/

### 27. Affidabilità delle notifiche locali: prerequisito per 'scadenze' credibili  `[confidenza: medium]`

Le recensioni citano promemoria che non arrivano (Drivvo iOS e versione free, My Car, MyPeugeot) e scadenze che non avvisano. Mitigazioni progettuali: notifiche locali (nessun server) con finestra mobile (iOS limita a 64 notifiche locali pendenti: rischedulare all'apertura e con un task in background), multi-preavviso, azioni rapide, banner in-app sulla Home, esportazione .ics nel calendario di sistema, schermata 'Verifica notifiche' che testa i permessi e guida a disattivare il risparmio batteria dove serve (Android: Doze e limitazioni dei produttori; allarmi esatti con permessi specifici dalle ultime versioni), e widget con 'prossima scadenza' come ridondanza.

Fonti:
- https://itunes.apple.com/it/rss/customerreviews/id=1206041425/sortby=mostrecent/json
- https://itunes.apple.com/it/rss/customerreviews/id=1165749302/sortby=mostrecent/json
- https://itunes.apple.com/it/rss/customerreviews/id=1021587274/sortby=mostrecent/json
- https://www.npmjs.com/package/expo-notifications

## Raccomandazioni

- Posizionamento: 'Il libretto di manutenzione digitale e il cruscotto OBD della tua auto: dati tuoi, locali, esportabili, zero pubblicità'. Messaggio di lancio sul tema 'il tuo storico non è in ostaggio', mirato agli utenti in fuga da Drivvo e agli utenti iOS di Fuelio, con importatori CSV dai principali concorrenti già in v1.0.
- Roadmap realistica per sviluppatore singolo: Fase 0 (2-3 settimane) UI completa su PC/web con adattatore OBD simulato e dati demo; Fase 1 (6-8 settimane) garage, interventi, scadenzario italiano, notifiche locali, rifornimenti, spese/TCO, documenti, backup/export/import; Fase 2 (4-6 settimane) OBD reale su Android (Classic+BLE) e iOS (BLE) con report di compatibilità e snapshot nella timeline, via dev client/EAS build e beta chiusa su dispositivi reali (TestFlight e test interni Play); Fase 3 OCR libretto/ricevute, widget, PDF rivendita, gomme, checklist pre-viaggio; Fase 4 sync/condivisione familiare, prezzi carburante MIMIT, CarPlay/Android Auto.
- Decisione di prodotto sul requisito 'scaricare tutte le informazioni': comunicare ovunque 'tutto ciò che la tua auto espone via OBD standard', con schermata 'Cosa legge la tua auto' (bitmap PID supportati) prima di qualsiasi acquisto; mettere nei Won't coding e reset service/DPF/EPB; niente promesse per marca.
- Per i 'livelli': implementare un modulo 'Controlli' con 3 tap e promemoria predefiniti (olio ogni 1.000 km o prima di un viaggio lungo, pressione gomme mensile, liquidi), e usare l'OBD solo per carburante %, temperature e tensione; trattare olio, freni, refrigerante, lavavetri e TPMS come manuali finché non validati su auto reali.
- Architettura dati: SQLite locale (expo-sqlite) con schema versionato, soft-delete/cestino, backup automatico (file locale + iCloud/Drive) con stato visibile, export JSON/CSV documentato, import da CSV dei concorrenti; mai sync con sovrascrittura silenziosa (lezione Simply Auto: merge o scelta esplicita).
- OBD: strato di trasporto astratto (BLE, Classic, Wi-Fi, Mock) con parser ELM327 testato su log registrati; lista pubblica di adattatori testati; messaggi d'errore diagnostici in italiano; nessun ritentativo infinito; rilevamento del clone e avviso sul rischio di perdita di connessione; funzioni di scrittura (cancellazione DTC) con doppia conferma e testo su revisione/monitor.
- Scadenzario: precaricare regole italiane (revisione 4+2 da data immatricolazione e ultima revisione, bollo mese+1, RC annuale, gomme 15/11-15/4 con avviso di cambio stagionale, tagliando a km o mesi) tutte editabili e con data del 'ultimo aggiornamento regole' mostrata; non calcolare l'importo del bollo; link ai servizi ufficiali (pagoPA/app IO/ACI).
- Prezzo: Gratis (tutti i dati e OBD base) + Pro una tantum 14,99-19,99 EUR; sync E2E opzionale solo a costo reale; dichiarare nelle schede store 'Nessuna pubblicità, nessun tracciamento'; politica pubblica di non-revoca delle licenze e di export permanente; rimborso in 14 giorni.
- Accessibilità fin dal giorno 1: componenti con etichette e ruoli, test con VoiceOver/TalkBack e font al 200%, semafori con icona+testo, alternative tabellari ai grafici, tastiera numerica con virgola/punto; localizzazione it-IT con Intl e i18next, DTC e PID tradotti.
- Validazione prima di investire: 10-15 interviste a automobilisti italiani (con 2 clienti con auto GPL/metano e 2 con auto EV/ibride), landing page con lista d'attesa per misurare interesse su 'storico per rivendita' e 'condivisione familiare', beta con 20-30 utenti che portino i propri adattatori per misurare tasso di successo di connessione e raccogliere i PID realmente supportati.
- Piano di manutenzione dichiarato: aggiornamento a ogni SDK Expo (circa ogni 4 mesi, SDK 57 attuale), test su ultime versioni iOS/Android, pagina 'Stato del progetto' con data dell'ultimo aggiornamento e canale di supporto con tempi di risposta: l'abbandono è la prima lamentela di Simply Auto, aCar e Torque.

## Rischi

- Over-promise OBD: 'scarica tutte le informazioni' non è mantenibile con PID standard; senza report di compatibilità e messaggi onesti si riproduce il pattern 'ho pagato ma la mia auto non è supportata' (Car Scanner, OBD Fusion, Carly), con recensioni da 1 stella, rimborsi e carico di supporto insostenibile per uno sviluppatore singolo.
- Supporto hardware: adattatori ELM327 clone instabili, differenza Classic/BLE, Wi-Fi che toglie Internet, permessi Android 12+, foreground service e limiti in background: la connessione OBD è la prima causa di frustrazione nelle app OBD (19-34% delle recensioni negative) e sarà anche la prima nelle recensioni della tua app; mitigare con lista adattatori testati, wizard e diagnostica integrata.
- Piattaforma iOS: nessun Bluetooth Classic, quindi molti dongle economici già posseduti dagli utenti non funzioneranno; rischio di recensioni negative per hardware incompatibile se non è spiegato prima dell'installazione.
- Dipendenze native: react-native-bluetooth-classic è solo release candidate (1.73.0-rc.17) e react-native-ble-plx ha ultimo publish a febbraio 2026; il wrapper ML Kit ha ultimo publish a settembre 2025; con Expo SDK 57 / React Native 0.87 possibili incompatibilità e dover mantenere patch o fork; senza Android SDK/Java/Xcode locali ogni test nativo passa da EAS cloud o dispositivo reale, con cicli lenti.
- Perdita dati con approccio local-first: telefono perso o rotto = storico perso (lezione My Car, Simply Auto, aCar); serve backup automatico semplice e sempre visibile, test di ripristino, gestione conflitti di sync senza sovrascritture silenziose e import/export verificati con dataset reali.
- Affidabilità delle notifiche: limiti iOS (64 notifiche locali), Doze e restrizioni dei produttori Android, permessi revocati; se un solo promemoria di assicurazione o revisione non arriva, l'utente perde fiducia (lamentela presente su Drivvo, My Car, MyPeugeot).
- Accuratezza normativa: scadenze (revisione, bollo, RC, gomme, bombole) cambiano per regolamento, regione o ordinanza locale; fonti consultate in parte giornalistiche; un errore di calcolo può causare multe; richiede testi con disclaimer, regole editabili, data di aggiornamento visibile e revisione periodica.
- Responsabilità e sicurezza OBD: cancellare i DTC azzera i monitor e può nascondere problemi prima della revisione; funzioni di scrittura/coding possono danneggiare centraline; mantenere l'app in sola lettura più cancellazione DTC con avvisi, nessuna scrittura costruttore specifica.
- Privacy/GDPR: targa, VIN, polizza, posizioni, foto di documenti sono dati personali; serve informativa chiara, cifratura locale (secure store, blocco biometrico), controllo di ciò che entra nei backup cloud e compilazione corretta di privacy label Apple e data safety Google Play; la promessa 'nessun tracker' va mantenuta anche con librerie di terze parti.
- Sostenibilità economica: acquisto una tantum e nessuna pubblicità riducono il flusso di cassa mentre i costi di manutenzione (aggiornamenti SDK, OS nuovi, supporto) restano; rischio di diventare l'ennesima app abbandonata. Mitigazione: costi fissi minimi (niente server di default), Pro una tantum a prezzo adeguato, sync opzionale a costo reale, roadmap ristretta.
- Reazione dei concorrenti e finestra temporale: Drivvo o Fuelio possono ripristinare funzioni gratuite o ridurre i prezzi; UnipolMove è gratuita e sostenuta dalla base assicurativa; app IO copre il promemoria bollo gratuitamente; la finestra post-rivolta Drivvo (settembre 2026) è breve, quindi importatori e messaggio sui dati vanno pronti al lancio.
- Limiti metodologici di questa analisi: le recensioni sono i campioni più recenti accessibili (App Store RSS fino a circa 500 per app, Play fino a 100 per filtro/lingua), classificate con regex (euristica), non rappresentativi del totale e con bias verso gli insoddisfatti; i prezzi di alcune app (Simply Auto, AUTOsist, Drivvo) derivano da store/aggregatori/utenti e possono differire per Paese; Google Play non permette di leggere l'elenco completo degli acquisti in-app via scraping.
- Rischio legale/di marchio: non usare nomi simili a Torque, Drivvo o Fuelio nell'icona o nel titolo; non fare confronti non verificati nel marketing (ad esempio il presunto uso dei dati di posizione da parte di Drivvo) senza fonti ufficiali; evitare ricerca targa tramite scraping di servizi pubblici.

## Domande aperte

- Quali adattatori ELM327 supportare ufficialmente (BLE per iOS/Android, Wi-Fi fallback) e a che prezzo? Servono 2-3 dongle reali (es. BLE 4.0 economico, OBDLink o vLinker) e almeno un'auto EOBD italiana (benzina e diesel) per testare stabilità, protocollo, tempi di risposta e riconnessione.
- Quanto sono supportati davvero PID 0x2F (livello carburante), 0x5C (temperatura olio), 0x42 e 0xA6 (odometro) sulle auto più diffuse in Italia (Stellantis, VW Group, Renault, Toyota)? Solo la prova su veicoli reali o una raccolta di report anonimi degli utenti può rispondere; non esiste un elenco pubblico affidabile.
- Il prezzo Pro di Drivvo (24,90 EUR/anno), la rimozione di sync/export dal piano gratuito e l'avviso sui dati di posizione sono riportati dagli utenti nelle recensioni di agosto-ottobre 2026 ma non sono confermati da un annuncio ufficiale; il sito dichiara ancora 'free forever'. Va verificato nell'app e nell'informativa privacy prima di usare la cosa nel marketing.
- Tolleranza di 15 giorni sulla RC auto e regole sul tacito rinnovo: le fonti consultate (Altroconsumo, SicurAuto, Facile.it, Assicurazione.it) sono giornalistiche; verificare su IVASS/normativa vigente 2026 prima di inserire testi o calcoli nell'app.
- Architettura per la condivisione con familiari senza server proprio: file/QR cifrato, cartella condivisa su iCloud/Drive, CloudKit sharing (solo iOS), o sync E2E con backend minimo? Ogni scelta cambia costi, supporto e promessa di privacy.
- Qualità reale dell'OCR on-device sul Documento Unico (ologrammi, riflessi, font): serve un corpus di test di libretti (anche vecchi formati) e la scelta tra ML Kit (ultimo publish del wrapper npm 2025-09-01) e API native iOS/Android.
- Come vengono trattati dagli store i prodotti OBD: requisiti Apple su accessori Bluetooth, privacy label e Google Play data safety per VIN/targa (dati personali ai sensi del GDPR) e foto di documenti; la politica sui dati deve essere scritta prima del lancio.
- L'app iOS 'Torque Pro' di Collabrains è davvero non ufficiale? Le accuse degli utenti non sono verificate; non usare il nome Torque o claim comparativi finché non confermato.
- Domanda di mercato per 'storico per rivendita' e per la condivisione familiare: nessun dato quantitativo nelle fonti consultate; va validata con 10-15 interviste o un test di landing page prima di investire.
- Per le app mono-marca (Stellantis/VW/BMW) non è stato possibile verificare se offrano un registro manutenzioni importabile/esportabile o API per utenti privati: da controllare per eventuali integrazioni future.

